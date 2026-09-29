import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-r2-sync-'));
const outfile = path.join(scratch, 'sync.cjs');
await build({ entryPoints: [fileURLToPath(new URL('../src/r2-project-sync.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'transport', setup(build) {
  build.onResolve({ filter: /^\.\/r2-storage$/ }, () => ({ path: 'transport', namespace: 'mock' }));
  build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const R2_PREFIX='kodety-studio/v1/'; export const getR2Connection=()=>null; export const subscribeR2Connection=()=>()=>{}; export const r2Request=()=>{}; export const r2ListObjects=()=>{};` }));
} }] });
const { createR2ProjectSync } = createRequire(import.meta.url)(outfile);
after(() => rm(scratch, { recursive: true, force: true }));
const base = 'kodety-studio/v1/projects/project-one/';
const project = { id: 'project-one', name: 'Original', mode: 'html', createdAt: 1, updatedAt: 2, wordpressLocale: 'en_US', phpVersion: '8.3', wordpressVersion: '6.8', kodetyVersion: '1.0' };
const archive = data => new Blob([data], { type: 'application/zip' });
function fixture(extra = {}) {
  const state = { jobs: {}, links: {} }, objects = new Map(), calls = [];
  let connection = { id: 'account/bucket', config: {} }, online = true, hook, afterWrite;
  let nextEtag = 1;
  const request = async (_config, input) => {
    calls.push(input);
    if (!online) throw new Error('offline');
    await hook?.(input);
    const current = objects.get(input.key);
    if (input.method === 'GET') {
      if (!current) throw Object.assign(new Error('missing'), { status: 404 });
      return { ...current, status: 200 };
    }
    if (input.method === 'PUT') {
      if (input.headers?.['If-Match'] && current?.etag !== input.headers['If-Match']) throw Object.assign(new Error('conflict'), { status: 412 });
      if (input.headers?.['If-None-Match'] === '*' && current) throw Object.assign(new Error('conflict'), { status: 412 });
      const value = { body: new Uint8Array(input.body), etag: `"${nextEtag++}"` }; objects.set(input.key, value);
      await afterWrite?.(input);
      return { ...value, status: 200 };
    }
    objects.delete(input.key); return { body: new Uint8Array(), etag: null, status: 204 };
  };
  const engine = createR2ProjectSync({
    store: { read: async () => structuredClone(state), change: async operation => operation(state) },
    connection: async () => connection, request,
    list: async (_config, prefix) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key, size: objects.get(key).body.length, etag: objects.get(key).etag, lastModified: '' })), continuationToken: null }),
    exclusive: async operation => operation(), ...extra,
  });
  return { engine, state, objects, calls, setOnline: value => { online = value; }, setConnection: value => { connection = value; }, setHook: value => { hook = value; }, setAfterWrite: value => { afterWrite = value; },
    manifest: () => JSON.parse(new TextDecoder().decode(objects.get(base + 'project.json').body)) };
}
test('disconnected storage does not queue or mutate projects; connection alone never migrates local data', async () => {
  const f = fixture(); f.setConnection(null); const original = structuredClone(project);
  await f.engine.enqueue(project, archive('unchanged')); await f.engine.drain();
  assert.deepEqual(project, original); assert.deepEqual(f.state, { jobs: {}, links: {} }); assert.equal(f.calls.length, 0);
});
test('offline copies remain queued, resume exact bytes and only then publish the remote manifest', async () => {
  const f = fixture(); f.setOnline(false);
  await f.engine.enqueue(project, archive('draft Ω')); await f.engine.drain();
  assert.equal(f.engine.getState().pending, 1); assert.equal(f.engine.getState().error, 'offline');
  f.setOnline(true); await f.engine.drain();
  const manifest = f.manifest(); assert.equal(manifest.name, 'Original');
  assert.equal(new TextDecoder().decode(f.objects.get(manifest.archiveKey).body), 'draft Ω');
  assert.equal(f.engine.getState().pending, 0);
  const { archive: downloaded } = await f.engine.download((await f.engine.list())[0]); assert.equal(await downloaded.text(), 'draft Ω');
});
test('a destination change cannot redirect a previously queued snapshot', async () => {
  const f = fixture(); f.setOnline(false); await f.engine.enqueue(project, archive('A')); await f.engine.drain();
  f.setConnection({ id: 'other/bucket', config: {} }); f.setOnline(true); await f.engine.drain();
  assert.equal(f.objects.size, 0); assert.equal(Object.values(f.state.jobs)[0].connectionId, 'account/bucket');
});
test('newer saves arriving during upload survive and supersede the stale archive', async () => {
  const f = fixture(); let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  let first = true;
  f.setHook(async input => { if (first && input.method === 'PUT' && input.key.endsWith('.zip')) { first = false; started(); await barrier; } });
  await f.engine.enqueue(project, archive('old')); await began;
  await f.engine.enqueue({ ...project, name: 'Latest' }, archive('new'));
  release(); await f.engine.drain();
  assert.equal(f.manifest().name, 'Latest'); assert.equal(new TextDecoder().decode(f.objects.get(f.manifest().archiveKey).body), 'new');
  assert.equal(f.engine.getState().pending, 0);
});
test('remote conflicts do not overwrite cloud files or remove the queued local snapshot', async () => {
  const f = fixture(); await f.engine.enqueue(project, archive('one')); await f.engine.drain();
  const remote = f.objects.get(base + 'project.json'); remote.etag = '"someone-else"';
  await f.engine.enqueue(project, archive('two')); await f.engine.drain();
  assert.equal(f.objects.get(base + 'project.json').etag, '"someone-else"'); assert.equal(f.engine.getState().pending, 1);
  assert.match(f.engine.getState().error, /local project is preserved/);
});
test('delete while disconnected queues a tombstone for the original bucket and cannot resurrect on a late save', async () => {
  const f = fixture(); await f.engine.enqueue(project, archive('one')); await f.engine.drain();
  f.objects.set('unrelated/user-file.txt', { body: new Uint8Array([1]), etag: 'other' });
  f.setConnection(null); await f.engine.enqueue(project, undefined, true);
  assert.equal(Object.values(f.state.jobs)[0].deleted, true);
  f.setConnection({ id: 'account/bucket', config: {} }); await f.engine.enqueue(project, archive('late')); await f.engine.drain();
  assert.equal(f.manifest().deleted, true); assert.equal((await f.engine.list()).length, 0);
  assert.equal([...f.objects.keys()].some(key => key.endsWith('.zip')), false); assert.ok(f.objects.has('unrelated/user-file.txt'));
});
test('an upload racing deletion cannot publish a new live manifest', async () => {
  const f = fixture(); let release, started;
  const began = new Promise(resolve => { started = resolve; }); const barrier = new Promise(resolve => { release = resolve; });
  let first = true;
  f.setHook(async input => { if (first && input.method === 'PUT' && input.key.endsWith('.zip')) { first = false; started(); await barrier; } });
  await f.engine.enqueue(project, archive('first')); await began; await f.engine.enqueue(project, undefined, true); release(); await f.engine.drain();
  assert.equal((await f.engine.list()).length, 0); assert.equal(f.objects.size, 0); assert.equal(f.engine.getState().pending, 0);
});
test('download validates content integrity before any recovery copy can be created', async () => {
  const f = fixture(); await f.engine.enqueue(project, archive('original')); await f.engine.drain();
  f.objects.get(f.manifest().archiveKey).body = new TextEncoder().encode('tampered');
  await assert.rejects(f.engine.download((await f.engine.list())[0]), /integrity/);
});
test('rename keeps the archived bytes and synchronizes metadata without touching local storage', async () => {
  const f = fixture(); await f.engine.enqueue(project, archive('content')); await f.engine.drain();
  await f.engine.rename({ ...project, name: 'Renamed' }); await f.engine.drain();
  assert.equal(f.manifest().name, 'Renamed'); assert.equal(new TextDecoder().decode(f.objects.get(f.manifest().archiveKey).body), 'content');
  assert.equal(project.name, 'Original');
});
test('only the current and previous successful archive remain after three saves', async () => {
  const f = fixture();
  for (const content of ['one', 'two', 'three']) { await f.engine.enqueue(project, archive(content)); await f.engine.drain(); }
  assert.equal([...f.objects.keys()].filter(key => key.endsWith('.zip')).length, 2);
});
test('deleting before the first asynchronous archive is ready blocks its late enqueue', async () => {
  const f = fixture();
  await f.engine.enqueue(project, undefined, true);
  await f.engine.enqueue(project, archive('late first snapshot'));
  await f.engine.drain();
  assert.equal(f.objects.size, 0); assert.equal(Object.keys(f.state.jobs).length, 0);
});
test('disconnect after an archive upload stops publication and leaves the copy queued', async () => {
  const f = fixture();
  f.setHook(async input => { if (input.method === 'PUT' && input.key.endsWith('.zip')) f.setConnection(null); });
  await f.engine.enqueue(project, archive('local copy')); await f.engine.drain();
  assert.equal(f.objects.has(base + 'project.json'), false);
  assert.equal(Object.keys(f.state.jobs).length, 1);
});
test('a newer save reconciles our earlier manifest when its successful response was lost', async () => {
  const f = fixture(); let first = true;
  f.setAfterWrite(async input => {
    if (first && input.key.endsWith('project.json')) { first = false; throw new Error('Response lost after remote commit'); }
  });
  await f.engine.enqueue(project, archive('one')); await f.engine.drain();
  assert.equal(Object.keys(f.state.jobs).length, 1);
  assert.equal(Object.values(f.state.links)[0].pendingRevision, f.manifest().revision);
  await f.engine.enqueue(project, archive('two')); await f.engine.drain();
  assert.equal(new TextDecoder().decode(f.objects.get(f.manifest().archiveKey).body), 'two');
  assert.equal(Object.keys(f.state.jobs).length, 0);
});
test('optional cloud copies yield storage space to existing local project files', async () => {
  const f = fixture({ reserveLocalSpace: async () => { throw new Error('Local storage reserve'); } });
  await f.engine.enqueue(project, archive('large optional copy')); await f.engine.drain();
  assert.equal(Object.keys(f.state.jobs).length, 0); assert.equal(f.calls.length, 0);
});
