import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanOpfsReadOnly } from './storage-survey-remote.mjs';

function fixture(tree) {
  const calls = [];
  const forbidden = () => { throw new Error('Mutation or file-content read forbidden'); };
  function directory(entries, path = '') {
    const children = Object.entries(entries).map(([name, value]) => [name, typeof value === 'number' ? {
      kind: 'file',
      name,
      async getFile() {
        calls.push(['file-metadata', `${path}/${name}`]);
        return { size: value, text: forbidden, arrayBuffer: forbidden, stream: forbidden };
      },
      createWritable: forbidden,
      createSyncAccessHandle: forbidden,
      remove: forbidden,
      move: forbidden,
    } : directory(value, `${path}/${name}`)]);
    return {
      name: path.split('/').at(-1),
      kind: 'directory',
      async *entries() { for (const entry of children) yield entry; },
      async getDirectoryHandle(name, options) {
        calls.push(['directory', `${path}/${name}`, options]);
        assert.deepEqual(options, { create: false });
        const entry = children.find(([entryName]) => entryName === name)?.[1];
        if (!entry || entry.kind !== 'directory') throw new Error('Directory missing');
        return entry;
      },
      getFileHandle: forbidden,
      removeEntry: forbidden,
      remove: forbidden,
      move: forbidden,
    };
  }
  return { root: directory(tree), calls };
}

test('finds known and orphaned SQLite paths using only directory and file-size reads', async () => {
  const f = fixture({
    'kodety-studio': { projects: {
      'empty-project': {},
      'saved-project': { 'wp-config.php': 100, 'wp-content': { database: { '.ht.sqlite': 4096, '.ht.sqlite-journal': 512 } } },
    } },
    orphan: { nested: { 'wp-load.php': 90, 'wordpress.db': 8192, 'secret-config.txt': 900 } },
  });
  const report = await scanOpfsReadOnly(f.root);
  assert.deepEqual(report.sqliteCandidates.map(file => [file.path, file.size]).sort(), [
    ['/kodety-studio/projects/saved-project/wp-content/database/.ht.sqlite', 4096],
    ['/kodety-studio/projects/saved-project/wp-content/database/.ht.sqlite-journal', 512],
    ['/orphan/nested/wordpress.db', 8192],
  ]);
  assert.ok(report.projectRoots.some(root => root.path === '/kodety-studio/projects/empty-project' && root.entries.length === 0));
  assert.ok(report.projectRoots.some(root => root.path === '/orphan/nested'));
  assert.equal(f.calls.filter(([action]) => action === 'file-metadata').length, 3);
  assert.equal(report.stopped, null);
  assert.deepEqual(report.errors, []);
});

test('a directory depth bound prevents traversal beyond the limit', async () => {
  const f = fixture({ first: { second: { third: { 'hidden.sqlite': 1000 }, 'visible.sqlite': 2000 } } });
  const report = await scanOpfsReadOnly(f.root, { maxDepth: 2 });
  assert.deepEqual(report.sqliteCandidates.map(file => file.name), ['visible.sqlite']);
  assert.deepEqual(report.skippedAtDepthLimit, ['/first/second/third']);
  assert.ok(f.calls.every(([, path]) => !path.includes('/third')));
});

test('the entry limit ends enumeration without opening more directories or reading more metadata', async () => {
  const f = fixture({ 'a.sqlite': 100, 'b.sqlite': 200, 'c.sqlite': 300, tail: { 'd.sqlite': 400 } });
  const report = await scanOpfsReadOnly(f.root, { maxEntries: 2 });
  assert.equal(report.visitedEntries, 2);
  assert.equal(report.stopped, 'entry-limit');
  assert.deepEqual(f.calls, [['file-metadata', '/a.sqlite'], ['file-metadata', '/b.sqlite']]);
});

test('requested limits cannot exceed the hard safety bounds', async () => {
  const report = await scanOpfsReadOnly(fixture({}).root, { maxDepth: 99, maxEntries: 1_000_000 });
  assert.deepEqual(report.limits, { maxDirectoryDepth: 8, maxEntries: 50_000 });
});

test('disappearing directories are reported without recreating them', async () => {
  const f = fixture({ vanished: {} });
  f.root.getDirectoryHandle = async (_name, options) => {
    assert.deepEqual(options, { create: false });
    throw new DOMException('Directory disappeared', 'NotFoundError');
  };
  const report = await scanOpfsReadOnly(f.root);
  assert.deepEqual(report.errors, [{ path: '/vanished', name: 'NotFoundError', message: 'Directory disappeared' }]);
  assert.equal(report.visitedDirectories, 1);
});

test('cancelled scans do not enumerate or read filesystem entries', async () => {
  const f = fixture({ 'secret.sqlite': 500 });
  const signal = AbortSignal.abort();
  const report = await scanOpfsReadOnly(f.root, { signal });
  assert.equal(report.stopped, 'cancelled');
  assert.equal(report.visitedEntries, 0);
  assert.deepEqual(f.calls, []);
});
