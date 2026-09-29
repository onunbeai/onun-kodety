import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-project-deletion-'));
await build({
  entryPoints: [new URL('../../../ChromeExtension/kodety-studio/src/playground-runtime.ts', import.meta.url).pathname],
  outfile: path.join(scratch, 'runtime.mjs'), platform: 'node', format: 'esm', bundle: true, logLevel: 'silent',
  plugins: [{ name: 'deletion-runtime', setup(builder) {
    builder.onResolve({ filter: /^@wp-playground\/client$/ }, () => ({ path: 'client', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const startPlaygroundWeb = options => globalThis.__deletionFixture.start(options);
      export const installPlugin = () => { throw new Error('Deletion must never install WordPress'); };
      export const login = installPlugin;
      export const setSiteLanguage = installPlugin;
    ` }));
  } }],
});
const { destroyProjectData } = await import(pathToFileURL(path.join(scratch, 'runtime.mjs')));
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
after(() => rm(scratch, { recursive: true, force: true }));
afterEach(() => {
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
  else delete globalThis.navigator;
  delete globalThis.__deletionFixture;
});

function fixture(files = ['/wordpress/index.html', '/wordpress/assets/style.css']) {
  const f = { saved: new Set(files), memory: new Set(), trace: [], options: null, available: true, holding: false };
  const client = {
    async mkdir(directory) { assert.equal(directory, '/wordpress'); f.trace.push('mkdir'); },
    async mountOpfs(mount) {
      f.trace.push('mount');
      assert.equal(mount.mountpoint, '/wordpress');
      assert.equal(mount.initialSyncDirection, 'opfs-to-memfs');
      f.memory = new Set(f.saved);
    },
    async listFiles() { f.trace.push('list'); return ['/wordpress', ...f.memory]; },
    async isDir() { return false; },
    async unlink(file) { f.trace.push('unlink'); f.memory.delete(file); },
    async rmdir() { throw new Error('Unexpected directory deletion'); },
    async flushOpfs() { f.trace.push('flush'); f.saved = new Set(f.memory); },
    async unmountOpfs() { f.trace.push('unmount'); },
  };
  f.client = client;
  f.start = async options => {
    f.options = options; f.trace.push('start');
    assert.equal(options.blueprint.preferredVersions.wp, false, 'deletion cannot depend on valid WordPress files');
    assert.equal(options.wordpressInstallMode, 'do-not-attempt-installing');
    assert.equal(options.mounts, undefined, 'saved files must not be present during runtime boot');
    return client;
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    async request(name, options, operation) {
      assert.equal(name, 'kodety-studio:project:project-test');
      assert.equal(options.ifAvailable, true);
      f.holding = true;
      try { return await operation(f.available ? {} : null); }
      finally { f.holding = false; }
    },
  } } });
  globalThis.__deletionFixture = f;
  f.iframe = { src: 'fixture' };
  f.run = () => destroyProjectData({ iframe: f.iframe, project: { id: 'project-test', phpVersion: '8.3', wordpressVersion: '7.1' }, language: 'pt', onStage() {} });
  return f;
}

test('an imported non-WordPress folder is deleted with a PHP-only runtime', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual([...f.saved], []);
  assert.deepEqual(f.trace, ['start', 'mkdir', 'mount', 'list', 'unlink', 'unlink', 'list', 'flush', 'unmount']);
  assert.equal(f.iframe.src, 'about:blank');
  assert.equal(f.holding, false);
});

test('empty and incomplete projects can be deleted without a WordPress install', async () => {
  for (const files of [[], ['/wordpress/wp-content/incomplete.txt']]) {
    const f = fixture(files);
    await f.run();
    assert.equal(f.saved.size, 0);
  }
});

test('files are not persisted as deleted after a failed filesystem operation', async () => {
  const f = fixture();
  f.client.unlink = async () => { throw new Error('Storage denied'); };
  await assert.rejects(f.run(), /Storage denied/);
  assert.equal(f.saved.size, 2);
  assert.equal(f.trace.includes('flush'), false);
  assert.equal(f.trace.includes('unmount'), false);
  assert.equal(f.iframe.src, 'about:blank');
  assert.equal(f.holding, false);
});

test('a failed durable flush is surfaced before metadata may be removed', async () => {
  const f = fixture();
  f.client.flushOpfs = async () => { throw new Error('Disk full'); };
  let metadataRemoved = false;
  await assert.rejects(f.run().then(() => { metadataRemoved = true; }), /Disk full/);
  assert.equal(metadataRemoved, false);
  assert.equal(f.trace.includes('unmount'), false);
  assert.equal(f.iframe.src, 'about:blank');
});

test('an open project cannot be deleted in another tab', async () => {
  const f = fixture(); f.available = false;
  await assert.rejects(f.run(), /aberto em outra aba/);
  assert.deepEqual(f.trace, []);
  assert.equal(f.saved.size, 2);
});

test('a stalled runtime releases the dialog and cannot delete files after late resolution', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let resolveStart;
  f.start = () => new Promise(resolve => { resolveStart = resolve; });
  const pending = assert.rejects(f.run(), /exclusão demorou/);
  t.mock.timers.tick(60_000);
  await pending;
  assert.equal(f.iframe.src, 'about:blank');
  assert.equal(f.holding, false);
  resolveStart(f.client);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.trace, []);
  assert.equal(f.saved.size, 2);
});
