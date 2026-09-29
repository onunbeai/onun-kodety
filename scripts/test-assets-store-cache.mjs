import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalConsoleError = console.error;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  assert.fail(message);
}

function asset(id, publicUrl = `/uploads/${id}.svg`) {
  return {
    id,
    filename: `${id}.svg`,
    storage_path: null,
    public_url: publicUrl,
    file_size: 100,
    mime_type: 'image/svg+xml',
    source: 'test',
    is_published: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
  };
}

try {
  globalThis.window = {};
  console.error = () => undefined;

  const { useAssetsStore } = await server.ssrLoadModule('/stores/useAssetsStore.ts');

  // Successful requests leave no stale pending marker after the asset is removed.
  let successCalls = 0;
  globalThis.fetch = async () => {
    successCalls += 1;
    return { ok: true, json: async () => ({ data: asset('success') }) };
  };
  useAssetsStore.getState().reset();
  assert.equal(useAssetsStore.getState().getAsset('success'), null);
  assert.equal(useAssetsStore.getState().getAsset('success'), null);
  await waitFor(() => Boolean(useAssetsStore.getState().assetsById.success), 'successful fetch did not populate the cache');
  await flush();
  assert.equal(successCalls, 1, 'concurrent lookups must share one in-flight request');
  useAssetsStore.getState().removeAsset('success');
  useAssetsStore.getState().getAsset('success');
  await waitFor(() => successCalls === 2, 'a successful request left a stale pending marker');

  // Non-OK responses, rejected promises, and synchronous throws all permit retry.
  for (const [name, fetchImpl] of [
    ['http-error', async () => ({ ok: false, json: async () => ({}) })],
    ['rejection', async () => { throw new Error('network rejected'); }],
    ['sync-throw', () => { throw new Error('fetch threw synchronously'); }],
  ]) {
    let calls = 0;
    globalThis.fetch = (...args) => {
      calls += 1;
      return fetchImpl(...args);
    };
    useAssetsStore.getState().reset();
    useAssetsStore.getState().getAsset(name);
    await waitFor(() => calls === 1, `${name}: first request did not start`);
    await flush();
    useAssetsStore.getState().getAsset(name);
    await waitFor(() => calls === 2, `${name}: failed request did not release its pending marker`);
  }

  // A lookup that resolves after removeAsset cannot resurrect that asset. An
  // unrelated lookup remains valid, proving invalidation is scoped by asset.
  const removalResolvers = new Map();
  const removalResponsesRead = new Set();
  const removalCalls = new Map();
  globalThis.fetch = (url) => {
    const id = String(url).split('/').pop();
    removalCalls.set(id, (removalCalls.get(id) || 0) + 1);
    return new Promise(resolve => {
      removalResolvers.set(id, resolve);
    });
  };
  useAssetsStore.getState().reset();
  useAssetsStore.getState().getAsset('removed-race');
  useAssetsStore.getState().getAsset('unrelated-race');
  await waitFor(
    () => removalCalls.get('removed-race') === 1 && removalCalls.get('unrelated-race') === 1,
    'pre-removal requests did not start',
  );

  useAssetsStore.getState().removeAsset('removed-race');
  removalResolvers.get('removed-race')({
    ok: true,
    json: async () => {
      removalResponsesRead.add('removed-race');
      return { data: asset('removed-race', '/uploads/removed-stale.svg') };
    },
  });
  removalResolvers.get('unrelated-race')({
    ok: true,
    json: async () => {
      removalResponsesRead.add('unrelated-race');
      return { data: asset('unrelated-race', '/uploads/unrelated-current.svg') };
    },
  });
  await waitFor(
    () => removalResponsesRead.size === 2,
    'responses in the removal race were not consumed',
  );
  await waitFor(
    () => useAssetsStore.getState().assetsById['unrelated-race']?.public_url === '/uploads/unrelated-current.svg',
    'removing one asset invalidated an unrelated lookup',
  );
  assert.equal(
    useAssetsStore.getState().assetsById['removed-race'],
    undefined,
    'a request resolved after removeAsset must not resurrect the removed asset',
  );

  // Once removeAsset allows a refetch, the old request cannot clear the new
  // request's marker and accidentally permit a third duplicate lookup.
  const refetchResolvers = [];
  let refetchCalls = 0;
  let staleRefetchResponseRead = false;
  globalThis.fetch = () => {
    refetchCalls += 1;
    return new Promise(resolve => {
      refetchResolvers.push(resolve);
    });
  };
  useAssetsStore.getState().reset();
  useAssetsStore.getState().getAsset('refetch-race');
  await waitFor(() => refetchCalls === 1, 'initial refetch-race request did not start');

  useAssetsStore.getState().removeAsset('refetch-race');
  useAssetsStore.getState().getAsset('refetch-race');
  await waitFor(() => refetchCalls === 2, 'removeAsset did not allow a fresh lookup');

  refetchResolvers[0]({
    ok: true,
    json: async () => {
      staleRefetchResponseRead = true;
      return { data: asset('refetch-race', '/uploads/refetch-stale.svg') };
    },
  });
  await waitFor(() => staleRefetchResponseRead, 'stale refetch response was not consumed');
  await flush();
  assert.equal(
    useAssetsStore.getState().assetsById['refetch-race'],
    undefined,
    'an old response must not win over the current refetch',
  );

  useAssetsStore.getState().getAsset('refetch-race');
  await flush();
  assert.equal(refetchCalls, 2, 'old request cleanup released the current refetch marker');

  refetchResolvers[1]({
    ok: true,
    json: async () => ({ data: asset('refetch-race', '/uploads/refetch-current.svg') }),
  });
  await waitFor(
    () => useAssetsStore.getState().assetsById['refetch-race']?.public_url === '/uploads/refetch-current.svg',
    'the current refetch did not populate the cache',
  );

  // A paginated list captured before a local removal cannot reintroduce that
  // asset in either the returned page or the shared cache. Unrelated results
  // from the same response remain usable.
  let resolveListRemoval;
  let listRemovalCalls = 0;
  globalThis.fetch = () => {
    listRemovalCalls += 1;
    return new Promise(resolve => {
      resolveListRemoval = resolve;
    });
  };
  useAssetsStore.getState().reset();
  const staleListPromise = useAssetsStore.getState().fetchAssets({ page: 1, limit: 20 });
  await waitFor(() => listRemovalCalls === 1, 'list request before removal did not start');
  useAssetsStore.getState().removeAsset('list-removed');
  resolveListRemoval({
    ok: true,
    json: async () => ({
      data: [asset('list-removed'), asset('list-unrelated')],
      total: 2,
      page: 1,
      limit: 20,
      hasMore: false,
    }),
  });
  const staleListResult = await staleListPromise;
  assert.deepEqual(staleListResult.assets.map(entry => entry.id), ['list-unrelated']);
  assert.equal(staleListResult.total, 1, 'the stale removed row must not remain in the page total');
  assert.equal(useAssetsStore.getState().assetsById['list-removed'], undefined);
  assert.equal(useAssetsStore.getState().assetsById['list-unrelated']?.id, 'list-unrelated');

  // A local ACK that updates an asset while the list is pending wins over the
  // stale list value in both the result and cache.
  let resolveListUpdate;
  globalThis.fetch = () => new Promise(resolve => {
    resolveListUpdate = resolve;
  });
  useAssetsStore.getState().reset();
  const staleUpdatePromise = useAssetsStore.getState().fetchAssets({ page: 1 });
  await flush();
  useAssetsStore.getState().addAsset(asset('list-updated', '/uploads/list-current.svg'));
  resolveListUpdate({
    ok: true,
    json: async () => ({ data: [asset('list-updated', '/uploads/list-stale.svg')], total: 1 }),
  });
  const staleUpdateResult = await staleUpdatePromise;
  assert.equal(staleUpdateResult.assets[0]?.public_url, '/uploads/list-current.svg');
  assert.equal(useAssetsStore.getState().assetsById['list-updated']?.public_url, '/uploads/list-current.svg');

  // Two list requests may resolve out of order. The later-started snapshot is
  // authoritative even when the older response arrives last.
  const orderedListResolvers = [];
  globalThis.fetch = () => new Promise(resolve => {
    orderedListResolvers.push(resolve);
  });
  useAssetsStore.getState().reset();
  const olderList = useAssetsStore.getState().fetchAssets({ page: 1 });
  const newerList = useAssetsStore.getState().fetchAssets({ page: 1 });
  await waitFor(() => orderedListResolvers.length === 2, 'concurrent list requests did not start');
  orderedListResolvers[1]({
    ok: true,
    json: async () => ({ data: [asset('ordered-list', '/uploads/ordered-current.svg')], total: 1 }),
  });
  assert.equal((await newerList).assets[0]?.public_url, '/uploads/ordered-current.svg');
  orderedListResolvers[0]({
    ok: true,
    json: async () => ({ data: [asset('ordered-list', '/uploads/ordered-stale.svg')], total: 1 }),
  });
  assert.equal((await olderList).assets[0]?.public_url, '/uploads/ordered-current.svg');
  assert.equal(useAssetsStore.getState().assetsById['ordered-list']?.public_url, '/uploads/ordered-current.svg');

  // A result from the previous project/store generation is inert even when
  // the HTTP response arrives after reset.
  let resolveStaleListGeneration;
  globalThis.fetch = () => new Promise(resolve => {
    resolveStaleListGeneration = resolve;
  });
  useAssetsStore.getState().reset();
  const oldGenerationList = useAssetsStore.getState().fetchAssets({ page: 1 });
  await flush();
  useAssetsStore.getState().reset();
  resolveStaleListGeneration({
    ok: true,
    json: async () => ({ data: [asset('previous-project')], total: 1 }),
  });
  assert.deepEqual(await oldGenerationList, {
    assets: [],
    total: 0,
    page: 1,
    limit: 50,
    hasMore: false,
  });
  assert.equal(useAssetsStore.getState().assetsById['previous-project'], undefined);

  // Folder bootstrap belongs to the same project generation and must not mark
  // a freshly reset store as loaded when the old response arrives late.
  let resolveStaleFolders;
  globalThis.fetch = () => new Promise(resolve => {
    resolveStaleFolders = resolve;
  });
  useAssetsStore.getState().reset();
  const oldFolderLoad = useAssetsStore.getState().loadAssets();
  await flush();
  useAssetsStore.getState().reset();
  resolveStaleFolders({
    ok: true,
    json: async () => ({ data: [{ id: 'previous-folder', name: 'Previous project' }] }),
  });
  await oldFolderLoad;
  assert.deepEqual(useAssetsStore.getState().folders, []);
  assert.equal(useAssetsStore.getState().isLoaded, false);
  assert.equal(useAssetsStore.getState().isLoading, false);

  // Reset starts a clean generation: it retries immediately and ignores the old result.
  let resolveOld;
  let resolveCurrent;
  let resetCalls = 0;
  globalThis.fetch = () => {
    resetCalls += 1;
    return new Promise(resolve => {
      if (resetCalls === 1) resolveOld = resolve;
      else resolveCurrent = resolve;
    });
  };
  useAssetsStore.getState().reset();
  useAssetsStore.getState().getAsset('reset-race');
  await waitFor(() => resetCalls === 1, 'pre-reset request did not start');

  useAssetsStore.getState().reset();
  useAssetsStore.getState().getAsset('reset-race');
  await waitFor(() => resetCalls === 2, 'reset did not clear pending requests for retry');

  resolveOld({ ok: true, json: async () => ({ data: asset('reset-race', '/uploads/stale.svg') }) });
  await flush();
  await flush();
  assert.equal(
    useAssetsStore.getState().assetsById['reset-race'],
    undefined,
    'a response from before reset must not repopulate the new store generation',
  );
  useAssetsStore.getState().getAsset('reset-race');
  assert.equal(resetCalls, 2, 'the old request cleanup must not release the current request marker');

  resolveCurrent({ ok: true, json: async () => ({ data: asset('reset-race', '/uploads/current.svg') }) });
  await waitFor(
    () => useAssetsStore.getState().assetsById['reset-race']?.public_url === '/uploads/current.svg',
    'the current post-reset request did not populate the cache',
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  console.error = originalConsoleError;
  await server.close();
}

console.log('Assets store cache: retry, lookup/list races, and reset isolation approved.');
