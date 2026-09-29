import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createHash, webcrypto } from "node:crypto";

const source = (await readFile(
  new URL("../public/service-worker.js", import.meta.url),
  "utf8",
)).replaceAll('__KODETY_BUILD_ID__', 'test');

function fixture() {
  const handlers = new Map();
  const calls = { cache: 0, network: 0 };
  runInNewContext(source, {
    URL,
    self: {
      location: { origin: "http://localhost:4173" },
      registration: { scope: "http://localhost:4173/" },
      addEventListener: (event, listener) => handlers.set(event, listener),
    },
    fetch: async () => {
      calls.network++;
      return new Response("fresh");
    },
    caches: {
      match: async () => {
        calls.cache++;
        return new Response("cached");
      },
      open: async () => ({ put: async () => undefined }),
    },
  });
  return {
    calls,
    request(pathname) {
      let response;
      handlers.get("fetch")({
        request: {
          url: `http://localhost:4173${pathname}`,
          method: "GET",
          mode: "cors",
        },
        respondWith: (result) => {
          response = result;
        },
      });
      return response;
    },
  };
}

test("WordPress runtime and relay navigations do not enter the Studio shell cache", () => {
  const f = fixture();
  for (const url of ["/playground/index.html", "/api/mcp/session", "/wp-admin/", "/offline-manifest.json"]) assert.equal(f.request(url), undefined);
  assert.deepEqual(f.calls, { cache: 0, network: 0 });
});

test("Vite source styles and modules bypass the service worker cache", () => {
  const f = fixture();
  for (const url of [
    "/src/webapp.css",
    "/src/app.tsx",
    "/@vite/client",
    "/node_modules/.vite/deps/react.js",
  ]) {
    assert.equal(f.request(url), undefined);
  }
  assert.deepEqual(f.calls, { cache: 0, network: 0 });
});

test("stable logo and entry filenames load fresh content instead of stale cached responses", async () => {
  const f = fixture();
  for (const url of [
    "/assets/kodety-logo.svg",
    "/assets/kodety-mark.svg",
    "/assets/studio.css",
    "/assets/studio.js",
  ]) {
    assert.equal(await (await f.request(url)).text(), "fresh");
  }
  assert.deepEqual(f.calls, { cache: 0, network: 4 });
});

test("versioned production chunks retain cache-first loading", async () => {
  const f = fixture();
  assert.equal(
    await (await f.request("/assets/bootstrap-contenthash.js")).text(),
    "cached",
  );
  assert.deepEqual(f.calls, { cache: 1, network: 0 });
});

function installationFixture({ failPath, changedPath, missingIntegrity, manifestVersion = 'test', networkStatus = 200 } = {}) {
  const handlers = new Map();
  const cacheData = new Map();
  const cacheName = 'kodety-studio-shell-v14-test';
  const cacheStores = new Map([[cacheName, cacheData]]);
  const fetched = [];
  const notifications = [];
  let skipped = false;
  let offline = false;
  const files = ['./', './index.html', './project-storage.html', './manifest.webmanifest', './manifest.en.webmanifest', './assets/editor-lazy.js', './assets/settings-lazy.js', './assets/compiler.wasm', './assets/studio.js'];
  const integrity = Object.fromEntries(files.map(file => [file, createHash('sha256').update('asset').digest('hex')]));
  if (missingIntegrity) delete integrity[missingIntegrity];
  const key = path => new URL(typeof path === 'string' ? path : path.url, 'https://studio.test/studio/').href;
  const entries = store => ({
    put: async (path, response) => store.set(key(path), response.clone()),
    delete: async path => store.delete(key(path)),
  });
  runInNewContext(source, {
    URL, Response, Promise, Set, Array, Error, crypto: webcrypto,
    self: {
      location: { origin: 'https://studio.test' },
      registration: { scope: 'https://studio.test/studio/' },
      clients: { matchAll: async () => [{ postMessage: value => notifications.push(value) }], claim: async () => undefined },
      addEventListener: (name, listener) => handlers.set(name, listener),
      skipWaiting: async () => { skipped = true; },
    },
    fetch: async url => {
      const path = typeof url === 'string' ? url : url.url;
      fetched.push(path);
      if (offline || path === failPath) throw new Error('Offline during download');
      if (path === './offline-manifest.json') return Response.json({ version: manifestVersion, files, integrity });
      return new Response(path === changedPath ? 'asset from different deployment' : 'asset', { status: networkStatus });
    },
    caches: {
      open: async name => { if (!cacheStores.has(name)) cacheStores.set(name, new Map()); return entries(cacheStores.get(name)); },
      match: async (path, { cacheName: name }) => cacheStores.get(name)?.get(key(path))?.clone(),
      keys: async () => [...cacheStores.keys()],
      delete: async name => cacheStores.delete(name),
    },
  });
  return {
    fetched, notifications, cacheStores,
    has: path => cacheStores.get(cacheName)?.has(key(path)),
    remove: path => cacheStores.get(cacheName)?.delete(key(path)),
    put: (path, value) => entries(cacheStores.get(cacheName)).put(path, new Response(value)),
    goOffline: () => { offline = true; },
    seed: (name, ready = true) => { cacheStores.set(name, new Map(ready ? [[key('./__kodety_offline_ready__'), Response.json({ version: 'old', completed: 1 })]] : [])); },
    skipped: () => skipped,
    install() { let promise; handlers.get('install')({ waitUntil: value => { promise = value; } }); return promise; },
    activate() { let promise; handlers.get('activate')({ waitUntil: value => { promise = value; } }); return promise; },
    request(path, mode = 'cors') { let response; handlers.get('fetch')({ request: { url: key(path), method: 'GET', mode }, respondWith: value => { response = value; } }); return response; },
    async status(prepare = false) {
      let reply, promise;
      handlers.get('message')({ data: { type: prepare ? 'kodety-offline-prepare' : 'kodety-offline-status' }, ports: [{ postMessage: value => { reply = value; } }], waitUntil: value => { promise = value; } });
      await promise;
      return reply;
    },
  };
}

test('offline installation downloads unopened editor/settings chunks and WASM before reporting ready', async () => {
  const f = installationFixture();
  await f.install();
  for (const asset of ['./assets/editor-lazy.js', './assets/settings-lazy.js', './assets/compiler.wasm', './index.html', './project-storage.html']) assert.equal(f.has(asset), true);
  assert.equal(f.skipped(), true);
  assert.equal((await f.status()).status, 'ready');
  assert.equal(f.notifications.at(-1).status, 'ready');
});

test('an interrupted offline installation never replaces the working worker or claims readiness', async () => {
  const f = installationFixture({ failPath: './assets/settings-lazy.js' });
  f.seed('kodety-studio-shell-previous');
  await assert.rejects(f.install(), /preparation incomplete/);
  assert.equal(f.skipped(), false);
  assert.equal(f.cacheStores.has('kodety-studio-shell-v14-test'), false);
  assert.equal(f.cacheStores.has('kodety-studio-shell-previous'), true);
  assert.equal((await f.status()).status, 'error');
  assert.equal(f.notifications.some(value => value.status === 'ready'), false);
});

test('an offline manifest from a changed deployment cannot mark this build ready', async () => {
  const f = installationFixture({ manifestVersion: 'new-build' });
  await assert.rejects(f.install(), /preparation incomplete/);
  assert.equal(f.fetched.length, 1);
  assert.equal(f.skipped(), false);
  assert.equal((await f.status()).status, 'error');
});

test('changed shell bytes or missing integrity prevent a mixed deployment from being marked ready', async () => {
  for (const options of [{ changedPath: './index.html' }, { changedPath: './assets/studio.js' }, { changedPath: './assets/settings-lazy.js' }, { missingIntegrity: './assets/compiler.wasm' }]) {
    const f = installationFixture(options);
    f.seed('kodety-studio-shell-previous');
    await assert.rejects(f.install(), /preparation incomplete/);
    assert.equal(f.skipped(), false);
    assert.equal(f.cacheStores.has('kodety-studio-shell-v14-test'), false);
    assert.equal(f.cacheStores.has('kodety-studio-shell-previous'), true);
    assert.equal((await f.status()).status, 'error');
    assert.equal(f.notifications.some(value => value.status === 'ready'), false);
  }
});

test('activation retains the last complete previous build, never a newer partial cache', async () => {
  const f = installationFixture();
  f.seed('kodety-studio-shell-old');
  f.seed('kodety-studio-shell-previous');
  f.seed('kodety-studio-shell-partial', false);
  f.seed('unrelated-application');
  await f.install();
  await f.activate();
  assert.deepEqual([...f.cacheStores.keys()], ['kodety-studio-shell-v14-test', 'kodety-studio-shell-previous', 'unrelated-application']);
});

test('readiness checks detect missing lazy assets and explicit repair recreates them', async () => {
  const f = installationFixture();
  await f.install();
  f.remove('./assets/settings-lazy.js');
  assert.equal((await f.status()).status, 'error');
  assert.equal((await f.status(true)).status, 'ready');
  assert.equal(f.has('./assets/settings-lazy.js'), true);
});

test('online shell refreshes never overwrite the complete offline build', async () => {
  const f = installationFixture();
  await f.install();
  await f.put('./index.html', 'complete-old-index');
  await f.put('./assets/studio.js', 'complete-old-entry');
  assert.equal(await (await f.request('./', 'navigate')).text(), 'asset');
  assert.equal(await (await f.request('./assets/studio.js')).text(), 'asset');
  f.goOffline();
  assert.equal(await (await f.request('./', 'navigate')).text(), 'complete-old-index');
  assert.equal(await (await f.request('./assets/studio.js')).text(), 'complete-old-entry');
  assert.equal((await f.status()).status, 'ready');
});

test('persistent project query routes preserve offline shell and WordPress document selection', async () => {
  const f = installationFixture();
  await f.install();
  await f.put('./index.html', 'studio-shell');
  await f.put('./project-storage.html', 'wordpress-isolated-document');
  f.goOffline();
  for (const target of ['./?project=cloud-one', './?project=local-one&source=local']) {
    assert.equal(await (await f.request(target, 'navigate')).text(), 'studio-shell');
  }
  assert.equal(await (await f.request('./project-storage.html?project=legacy&action=open', 'navigate')).text(), 'wordpress-isolated-document');
});

test('server errors for navigation or stable entries fall back to cached assets', async () => {
  const f = installationFixture({ networkStatus: 503 });
  await f.put('./index.html', 'cached-index');
  await f.put('./assets/studio.js', 'cached-entry');
  assert.equal(await (await f.request('./', 'navigate')).text(), 'cached-index');
  assert.equal(await (await f.request('./assets/studio.js')).text(), 'cached-entry');
});
