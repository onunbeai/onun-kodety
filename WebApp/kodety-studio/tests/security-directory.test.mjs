import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-safety-test-'));
await build({
  entryPoints: {
    backup: path.join(root, 'ChromeExtension/kodety-studio/src/backup-storage.ts'),
    scheduler: path.join(root, 'ChromeExtension/kodety-studio/src/backup-scheduler.ts'),
    messages: path.join(root, 'ChromeExtension/kodety-studio/src/runtime-message.ts'),
  },
  outdir: scratch, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'runtime', setup(builder) {
    builder.onResolve({ filter: /^@wp-playground\/client$/ }, () => ({ path: 'client', namespace: 'fixture' }));
    builder.onResolve({ filter: /^\.\/playground-runtime$/ }, () => ({ path: 'runtime', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
      contents: name === 'client'
        ? 'export async function zipWpContent(client) { return client.export(); }'
        : 'export async function flushProject(client) { await client.flush(); }',
    }));
  } }],
});
const backup = await import(pathToFileURL(path.join(scratch, 'backup.mjs')).href);
const { createBackupScheduler } = await import(pathToFileURL(path.join(scratch, 'scheduler.mjs')).href);
const { isProjectRuntimeMessageSource } = await import(pathToFileURL(path.join(scratch, 'messages.mjs')).href);
const originalWindow = globalThis.window;
const originalIDB = globalThis.indexedDB;
const originalNow = Date.now;
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalIDB === undefined) delete globalThis.indexedDB;
  else globalThis.indexedDB = originalIDB;
  Date.now = originalNow;
});
after(() => rm(scratch, { recursive: true, force: true }));

function fixture() {
  const records = new Map();
  const trace = [];
  const clone = value => value && ({ ...value, projectFolders: { ...value.projectFolders }, lastBackups: { ...value.lastBackups } });
  const idb = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            const transaction = {
              objectStore() {
                return {
                  get(key) {
                    const read = {};
                    queueMicrotask(() => { read.result = clone(records.get(key)); read.onsuccess(); });
                    return read;
                  },
                  put(value) {
                    queueMicrotask(() => { records.set(value.key, clone(value)); transaction.oncomplete(); });
                  },
                };
              },
            };
            return transaction;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  function directory(name, parent = null) {
    const contents = new Map();
    const dir = {
      kind: 'directory', name, contents, permission: 'granted', failFile: '', requested: 0,
      async queryPermission() { return dir.permission; },
      requestPermission() { dir.requested += 1; dir.permission = 'granted'; return Promise.resolve('granted'); },
      async getDirectoryHandle(child) {
        if (!contents.has(child)) contents.set(child, directory(child, parent || dir));
        return contents.get(child);
      },
      async getFileHandle(child) {
        return { async createWritable() {
          let data;
          return {
            async write(value) {
              trace.push(['write', name, child]);
              if ((parent || dir).failFile === child) throw new Error('Disk full');
              data = value;
            },
            async close() { contents.set(child, { kind: 'file', name: child, data }); },
            async abort() {},
          };
        } };
      },
      async removeEntry(child) { contents.delete(child); },
      async *entries() { yield* contents.entries(); },
    };
    return dir;
  }
  const selected = directory('Selected folder');
  const client = {
    async flush() { trace.push(['flush']); },
    async export() { trace.push(['export']); return new Uint8Array([1, 2, 3, 4]); },
  };
  globalThis.indexedDB = idb;
  globalThis.window = { indexedDB: idb, showDirectoryPicker() { assert.equal(this, globalThis.window); trace.push(['picker']); return Promise.resolve(selected); } };
  return { records, trace, client, selected, directory };
}
const project = (name = 'Test') => ({ id: crypto.randomUUID(), name, wordpressVersion: '7.1', phpVersion: '8.3', kodetyVersion: '1.0.0', wordpressLocale: 'pt_BR' });
const strict = { requireProjectDirectory: true };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('folder picker is called in the click task, with the Window receiver', async () => {
  const f = fixture();
  const selection = backup.pickSecurityDirectory();
  assert.deepEqual(f.trace, [['picker']]);
  assert.equal(await selection, f.selected);
});

test('required projects never inherit the old global folder; separate bindings remain isolated', async () => {
  const f = fixture();
  await backup.connectSecurityDirectory();
  const a = project('A'); const b = project('B');
  assert.equal((await backup.getSecurityDirectoryStatus(a.id)).connected, true, 'legacy extension still recognizes its folder');
  assert.equal((await backup.getSecurityDirectoryStatus(a.id, strict)).connected, false);
  await assert.rejects(backup.saveProjectSnapshot(f.client, a, strict), /Conecte uma pasta/);
  await backup.bindProjectSecurityDirectory(a.id, f.selected);
  const second = f.directory('Another folder');
  await backup.bindProjectSecurityDirectory(b.id, second);
  await backup.saveProjectSnapshot(f.client, a, strict);
  assert.equal((await backup.getSecurityDirectoryStatus(a.id, strict)).directoryName, 'Selected folder');
  assert.equal((await backup.getSecurityDirectoryStatus(b.id, strict)).directoryName, 'Another folder');
  assert.equal((await backup.getSecurityDirectoryStatus(b.id, strict)).lastBackupAt, null);
  assert.equal(second.contents.size, 0);
});

test('denied binding cannot create a protected project record', async () => {
  const f = fixture(); const p = project();
  f.selected.permission = 'denied';
  await assert.rejects(backup.bindProjectSecurityDirectory(p.id, f.selected), /Autorize/);
  assert.equal(f.records.size, 0);
});

test('backups flush before exporting, retain five unique snapshots, and publish verified metadata', async () => {
  const f = fixture(); const p = project();
  await backup.bindProjectSecurityDirectory(p.id, f.selected);
  Date.now = () => 1789320000000;
  const results = [];
  for (let index = 0; index < 7; index++) results.push(await backup.saveProjectSnapshot(f.client, p, strict));
  assert.equal(new Set(results.map(result => result.snapshotName)).size, 7, 'same-millisecond saves cannot overwrite each other');
  assert.deepEqual(f.trace.slice(0, 2), [['flush'], ['export']]);
  const output = [...f.selected.contents.values()][0];
  const snapshots = output.contents.get('snapshots');
  assert.equal(snapshots.contents.size, 5);
  assert.deepEqual(output.contents.get('latest.zip').data, new Uint8Array([1, 2, 3, 4]));
  const metadata = JSON.parse(output.contents.get('project.json').data);
  assert.equal(metadata.projectId, p.id);
  assert.equal(metadata.latestSnapshot, `snapshots/${results.at(-1).snapshotName}`);
  assert.ok(snapshots.contents.has(results.at(-1).snapshotName), 'retention must keep the snapshot referenced by project.json');
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await backup.getSecurityDirectoryStatus(p.id, strict)).lastBackupAt, Date.now());
});

test('failed disk writes preserve the last successful timestamp and never report a new backup', async () => {
  const f = fixture(); const p = project();
  await backup.bindProjectSecurityDirectory(p.id, f.selected);
  f.selected.failFile = 'latest.zip';
  await assert.rejects(backup.saveProjectSnapshot(f.client, p, strict), /Disk full/);
  assert.equal((await backup.getSecurityDirectoryStatus(p.id, strict)).lastBackupAt, null);
  f.selected.failFile = '';
  const success = await backup.saveProjectSnapshot(f.client, p, strict);
  f.selected.failFile = 'latest.zip';
  Date.now = () => success.createdAt + 1000;
  await assert.rejects(backup.saveProjectSnapshot(f.client, p, strict), /Disk full/);
  assert.equal((await backup.getSecurityDirectoryStatus(p.id, strict)).lastBackupAt, success.createdAt);
});

test('background backups never prompt for permission; explicit access requests run before awaiting storage', async () => {
  const f = fixture(); const p = project();
  await backup.bindProjectSecurityDirectory(p.id, f.selected);
  f.selected.permission = 'prompt';
  await assert.rejects(backup.saveProjectSnapshot(f.client, p, strict), /Autorize novamente/);
  assert.equal(f.selected.requested, 0);
  assert.equal(f.trace.length, 0);
  const access = backup.requestSecurityDirectoryAccess(p.id, strict);
  assert.equal(f.selected.requested, 1);
  assert.equal((await access).connected, true);
});

test('rebinding waits for an active write and clears timestamps belonging to the previous folder', async () => {
  const f = fixture(); const p = project();
  await backup.bindProjectSecurityDirectory(p.id, f.selected);
  const started = deferred(); const release = deferred();
  f.client.export = async () => { started.resolve(); await release.promise; return new Uint8Array([4]); };
  const snapshot = backup.saveProjectSnapshot(f.client, p, strict);
  await started.promise;
  const second = f.directory('Rebound');
  const binding = backup.bindProjectSecurityDirectory(p.id, second);
  release.resolve();
  await Promise.all([snapshot, binding]);
  const status = await backup.getSecurityDirectoryStatus(p.id, strict);
  assert.equal(status.directoryName, 'Rebound');
  assert.equal(status.lastBackupAt, null);
  assert.equal(second.contents.size, 0);
});

test('autosave bursts coalesce, finish drains the timer, and edits during export get a serial second pass', async () => {
  const first = deferred(); const release = deferred();
  const states = [];
  let calls = 0; let active = 0; let maximum = 0;
  const scheduler = createBackupScheduler({
    delayMs: 100_000,
    async save() {
      calls++; active++; maximum = Math.max(maximum, active);
      if (calls === 1) { first.resolve(); await release.promise; }
      active--; return calls;
    },
    onProgress: state => states.push(state),
  });
  for (let index = 0; index < 20; index++) scheduler.schedule();
  const finishing = scheduler.finish();
  await first.promise;
  assert.equal(calls, 1);
  for (let index = 0; index < 20; index++) scheduler.schedule();
  assert.equal(states.includes('saved'), false);
  release.resolve();
  await finishing;
  assert.equal(calls, 2);
  assert.equal(maximum, 1);
  assert.equal(states.at(-1), 'saved');
  scheduler.dispose();
});

test('scheduler surfaces failures, recovers on retry, and cancellation cannot announce saved', async () => {
  const states = [];
  let fails = true;
  const scheduler = createBackupScheduler({
    save: async () => { if (fails) throw new Error('Permission denied'); return 1; },
    onProgress: (state, error) => states.push([state, error?.message]),
  });
  await assert.rejects(scheduler.flush(), /Permission denied/);
  assert.deepEqual(states.at(-1), ['error', 'Permission denied']);
  assert.equal(states.some(([state]) => state === 'saved'), false);
  fails = false;
  assert.equal(await scheduler.flush(), 1);
  assert.equal(states.at(-1)[0], 'saved');
  scheduler.schedule(); scheduler.dispose();
  await assert.rejects(scheduler.flush(), /encerrada/);
  assert.equal(states.at(-1)[0], 'pending');
});

test('runtime message boundary rejects siblings, detached windows, and MessagePorts', () => {
  const top = {}; top.parent = top;
  const frame = { parent: top };
  const child = { parent: frame };
  assert.equal(isProjectRuntimeMessageSource(frame, frame), true);
  assert.equal(isProjectRuntimeMessageSource({ parent: child }, frame), true);
  assert.equal(isProjectRuntimeMessageSource({ parent: top }, frame), false);
  assert.equal(isProjectRuntimeMessageSource(top, frame), false);
  assert.equal(isProjectRuntimeMessageSource({}, frame), false);
  assert.equal(isProjectRuntimeMessageSource(null, frame), false);
  assert.equal(isProjectRuntimeMessageSource({ get parent() { throw new Error('Detached'); } }, frame), false);
});
