import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-runtime-offline-test-'));
await build({ entryPoints: [path.join(root, 'ChromeExtension/kodety-studio/src/offline-runtime.ts')], outfile: path.join(scratch, 'offline.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { preparePlaygroundOfflineCache } = await import(pathToFileURL(path.join(scratch, 'offline.mjs')).href);
const originals = Object.fromEntries(['window', 'navigator', 'caches', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
after(() => rm(scratch, { recursive: true, force: true }));
function fixture() {
  const origin = 'https://playground.wordpress.net';
  const files = new Map([[`${origin}/assets/php_8_3-test.wasm`, new Response('wasm')], [`${origin}/assets/php_8_3-test.js`, new Response('js')]]); const fetched = [];
  const f = { manifest: ['/remote.html', '/assets/runtime.js', '/sw.js'], fail: '', offline: false, names: ['playground-cache-current'] };
  const cache = { async match(url) { return files.get(url)?.clone(); }, async put(url, response) { files.set(url, response.clone()); }, async keys() { return [...files.keys()].map(url => new Request(url)); } };
  const caches = { async keys() { return f.names; }, async open() { return cache; }, match: cache.match };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { ready: Promise.resolve(), controller: {} } } });
  globalThis.window = { location: { origin }, caches };
  globalThis.caches = caches;
  globalThis.fetch = async (url, options) => {
    fetched.push(url);
    assert.equal(options.referrer, `${origin}/remote.html`);
    if (f.offline) throw new Error('Offline');
    if (url.endsWith(f.fail) && f.fail) return new Response(null, { status: 503 });
    return new Response(url.endsWith('.json') ? JSON.stringify(f.manifest) : 'fixture', { headers: { 'Content-Type': 'text/plain' } });
  };
  return { ...f, control: f, files, fetched, origin };
}
test('prepares the exact official runtime asset manifest without fetching the worker itself', async () => {
  const f = fixture();
  assert.deepEqual(await preparePlaygroundOfflineCache(), { files: 2 });
  assert.ok(f.files.has(`${f.origin}/remote.html`));
  assert.ok(f.files.has(`${f.origin}/assets/runtime.js`));
  assert.equal(f.fetched.some(url => url.endsWith('/sw.js')), false);
  f.control.offline = true;
  assert.deepEqual(await preparePlaygroundOfflineCache(), { files: 2 }, 'cached manifest and all assets work without network');
});
test('missing or partially downloaded runtime assets cannot report offline readiness', async () => {
  const f = fixture(); f.control.fail = '/assets/runtime.js';
  await assert.rejects(preparePlaygroundOfflineCache(), /Não foi possível preparar o arquivo/);
  assert.equal(f.files.has(`${f.origin}/assets-required-for-offline-mode.json`), false);
});
test('uncontrolled runtime and concurrent cache versions fail explicitly', async () => {
  const f = fixture();
  navigator.serviceWorker.controller = null;
  await assert.rejects(preparePlaygroundOfflineCache(), /ainda não está sob controle/);
  navigator.serviceWorker.controller = {};
  f.control.names = ['playground-cache-old', 'playground-cache-new'];
  await assert.rejects(preparePlaygroundOfflineCache(), /atualizando o cache/);
});
test('manifest cannot introduce arbitrary origins or traversal paths', async () => {
  const f = fixture();
  for (const manifest of [[], ['//untrusted.test/file.js'], ['/assets/../private'], ['https://untrusted.test']]) {
    f.control.manifest = manifest;
    await assert.rejects(preparePlaygroundOfflineCache(), /manifesto offline.*inválido/);
  }
});

test('an HTML-only cache cannot claim the required PHP version is available offline', async () => {
  fixture();
  await assert.rejects(preparePlaygroundOfflineCache('8.4'), /PHP WebAssembly.*ainda não está/);
});
