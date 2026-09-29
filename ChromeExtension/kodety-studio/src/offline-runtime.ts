/**
 * Runs inside the WordPress iframe, on the origin that owns Playground's SW.
 * Keep this function self-contained: its source is injected into the mu-plugin.
 */
export async function preparePlaygroundOfflineCache(phpVersion = ''): Promise<{ files: number }> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    throw new Error('Este navegador não oferece o cache necessário para reabrir o WordPress sem conexão.');
  }
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) throw new Error('O WordPress ainda não está sob controle do cache offline. Reabra o projeto enquanto estiver conectado.');
  const origin = window.location.origin;
  // Explicit referrer avoids Playground redirecting these application assets
  // into the current virtual WordPress /scope:…/ filesystem.
  const requestOptions: RequestInit = { referrer: `${origin}/remote.html`, credentials: 'same-origin' };
  const manifestUrl = `${origin}/assets-required-for-offline-mode.json`;
  let manifest: unknown;
  try {
    const response = await fetch(manifestUrl, requestOptions);
    if (!response.ok) throw new Error('O manifesto offline do WordPress não está disponível.');
    manifest = await response.json();
  } catch (error) {
    const cached = await caches.match(manifestUrl, { ignoreSearch: true });
    if (!cached) throw error;
    manifest = await cached.json();
  }
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 2_000 || manifest.some(path => typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('..'))) {
    throw new Error('O manifesto offline do WordPress é inválido.');
  }
  const names = (await caches.keys()).filter(name => name.startsWith('playground-cache-'));
  if (names.length !== 1) throw new Error('O WordPress está atualizando o cache offline. Reabra o projeto após a atualização.');
  const cache = await caches.open(names[0]);
  const paths = [...new Set(['/remote.html', ...manifest as string[]])].filter(path => path !== '/sw.js');
  // The service worker is registered by the browser, not served from its own
  // CacheStorage. All other executable chunks/assets must be present in full.
  for (const path of paths) {
    const url = `${origin}${path}`;
    if (await cache.match(url, { ignoreSearch: true })) continue;
    const response = await fetch(url, requestOptions);
    if (!response.ok) throw new Error(`Não foi possível preparar o arquivo offline do WordPress: ${path}`);
    await cache.put(url, response);
  }
  const cachedPaths = (await cache.keys()).map(request => new URL(request.url).pathname);
  const phpPrefix = phpVersion && /^\d+\.\d+$/.test(phpVersion) ? `php_${phpVersion.replace('.', '_')}-` : 'php_';
  if (!cachedPaths.some(path => path.includes(phpPrefix) && path.endsWith('.wasm'))
    || !cachedPaths.some(path => path.includes(phpPrefix) && path.endsWith('.js'))) {
    throw new Error('O PHP WebAssembly deste projeto ainda não está completamente no cache offline. Reabra o projeto enquanto estiver conectado.');
  }
  // Cache the manifest itself for this check on later offline sessions.
  await cache.put(manifestUrl, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
  const currentNames = (await caches.keys()).filter(name => name.startsWith('playground-cache-'));
  if (currentNames.length !== 1 || currentNames[0] !== names[0]) {
    throw new Error('O WordPress atualizou o runtime durante a preparação offline. Reabra o projeto para concluir.');
  }
  return { files: paths.length };
}
