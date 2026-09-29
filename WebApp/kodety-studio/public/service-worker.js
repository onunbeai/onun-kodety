const BUILD_ID = '__KODETY_BUILD_ID__';
const CACHE_NAME = 'kodety-studio-shell-v14-__KODETY_BUILD_ID__';
const OFFLINE_MARKER = './__kodety_offline_ready__';
const SHELL_FILES = ['./', './index.html', './project-storage.html', './manifest.webmanifest', './manifest.en.webmanifest'];
const PREVIEW_REQUEST_SOURCE = 'kodety-studio-preview-service-worker';
const PREVIEW_RESPONSE_SOURCE = 'kodety-studio-preview-runtime';
const PREVIEW_SEGMENT = '__kodety_preview__';

async function notifyOffline(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ source: 'kodety-studio-offline', ...message });
}

async function cacheOfflineEditor() {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(OFFLINE_MARKER);
  const response = await fetch('./offline-manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Offline manifest unavailable');
  const manifest = await response.json();
  if (manifest.version !== BUILD_ID || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid offline manifest or changed deployment');
  const files = [...new Set([...SHELL_FILES, ...manifest.files])];
  const origin = new URL(self.registration.scope).origin;
  const prefix = new URL(self.registration.scope).pathname;
  for (const file of files) {
    const url = new URL(file, self.registration.scope);
    if (typeof file !== 'string' || !file.startsWith('./') || url.origin !== origin || !url.pathname.startsWith(prefix)) throw new Error('Invalid offline asset path');
    if (typeof manifest.integrity?.[file] !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.integrity[file])) throw new Error('Missing offline asset integrity');
  }
  let completed = 0;
  let cursor = 0;
  await notifyOffline({ status: 'preparing', completed, total: files.length });
  let failed = false;
  const results = await Promise.allSettled(Array.from({ length: 3 }, async () => {
    while (cursor < files.length) {
      if (failed) return;
      const file = files[cursor++];
      try {
        // Pages canonicalizes *.html to extensionless routes. Only these known
        // shell aliases may follow a redirect, and only within this same origin.
        const canonicalHtml = file === './index.html' || file === './project-storage.html';
        const asset = await fetch(file, { cache: 'reload', redirect: canonicalHtml ? 'follow' : 'error' });
        if (asset.redirected) {
          const destination = new URL(asset.url);
          const canonical = new URL(file === './index.html' ? './' : './project-storage', self.registration.scope);
          if (!canonicalHtml || destination.origin !== origin || destination.pathname !== canonical.pathname || destination.search) throw new Error('Unexpected offline document redirect');
        }
        if (!asset.ok) throw new Error('Offline asset unavailable: ' + file);
        // Stable entry names may change while a deployment is downloading.
        // Pin only bytes from this manifest, never a mixture of two builds.
        const bytes = await asset.clone().arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== manifest.integrity[file]) throw new Error('Offline asset changed during download: ' + file);
        // A redirected response cannot answer a navigation whose redirect mode
        // is "manual". Store verified bytes/headers as an ordinary response.
        await cache.put(file, asset.redirected
          ? new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: asset.headers })
          : asset);
      } catch (error) { failed = true; throw error; }
      completed++;
      if (completed % 10 === 0 || completed === files.length) await notifyOffline({ status: 'preparing', completed, total: files.length });
    }
  }));
  if (results.some(result => result.status === 'rejected')) throw new Error('Offline assets incomplete');
  await cache.put(OFFLINE_MARKER, new Response(JSON.stringify({ version: manifest.version, completed, files }), { headers: { 'Content-Type': 'application/json' } }));
  await notifyOffline({ status: 'ready', completed, total: files.length });
}

self.addEventListener('install', event => {
  event.waitUntil(cacheOfflineEditor().then(() => self.skipWaiting()).catch(async () => {
    await caches.delete(CACHE_NAME);
    await notifyOffline({ status: 'error' });
    // Keep any previous worker active when a download is incomplete. A partial
    // editor cache must never replace a working offline installation.
    throw new Error('Offline editor preparation incomplete');
  }));
});

async function completeCache(name, verifyAssets = false) {
  const marker = await caches.match(OFFLINE_MARKER, { cacheName: name });
  if (!marker) return false;
  try {
    const data = await marker.json();
    if (!data.version || !data.completed) return false;
    if (name === CACHE_NAME && (data.version !== BUILD_ID || !Array.isArray(data.files) || data.completed !== data.files.length)) return false;
    if (verifyAssets && Array.isArray(data.files)) {
      const assets = await Promise.all(data.files.map(file => caches.match(file, { cacheName: name })));
      if (assets.some(asset => !asset)) return false;
    }
    return true;
  } catch { return false; }
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Retain the previous version for tabs that still reference its lazy chunks.
    const names = (await caches.keys()).filter(name => name.startsWith('kodety-studio-shell-') && name !== CACHE_NAME);
    const ready = [];
    for (const name of names) if (await completeCache(name)) ready.push(name);
    const previous = ready.at(-1);
    await Promise.all(names.filter(name => name !== previous).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

let repairCache;
self.addEventListener('message', event => {
  if (!['kodety-offline-status', 'kodety-offline-prepare'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    let ready = await completeCache(CACHE_NAME, true);
    if (!ready && event.data.type === 'kodety-offline-prepare') {
      // Registering identical worker bytes does not run install again. Repair
      // an evicted/incomplete cache explicitly, and share concurrent retries.
      if (!repairCache) repairCache = cacheOfflineEditor().finally(() => { repairCache = undefined; });
      try { await repairCache; ready = true; } catch { await notifyOffline({ status: 'error' }); }
    }
    event.ports?.[0]?.postMessage({ source: 'kodety-studio-offline', status: ready ? 'ready' : 'error' });
  })());
});

function previewRoute(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  const prefix = `${scopePath}${PREVIEW_SEGMENT}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const remainder = url.pathname.slice(prefix.length);
  const separator = remainder.indexOf('/');
  if (separator < 0) return null;
  const projectId = decodeURIComponent(remainder.slice(0, separator));
  if (!/^[a-z0-9-]{8,80}$/i.test(projectId)) return null;
  const requestPath = `/${remainder.slice(separator + 1)}${url.search}`;
  const proxyBaseUrl = new URL(`${PREVIEW_SEGMENT}/${encodeURIComponent(projectId)}/`, self.registration.scope).toString();
  return { projectId, requestPath, proxyBaseUrl };
}

function requestFromStudioRuntime(payload, body) {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(`kodety-studio-preview:${payload.projectId}`);
    const timeout = setTimeout(() => {
      channel.close();
      reject(new Error('Onun Kodety preview timed out.'));
    }, 12000);
    channel.onmessage = event => {
      const response = event.data;
      if (
        !response
        || response.source !== PREVIEW_RESPONSE_SOURCE
        || response.version !== 1
        || response.requestId !== payload.requestId
      ) return;
      clearTimeout(timeout);
      channel.close();
      if (response.ok) resolve(response);
      else reject(new Error(response.message || 'Onun Kodety preview failed.'));
    };
    const clientBody = body ? body.slice(0) : undefined;
    channel.postMessage({ ...payload, body: clientBody });
  });
}

function escapedHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function previewUnavailable(language = 'pt', reason = '') {
  const english = language === 'en';
  const detail = reason
    ? `<details><summary>${english ? 'Technical details' : 'Detalhes técnicos'}</summary><code>${escapedHtml(reason)}</code></details>`
    : '';
  return new Response(`<!doctype html><html lang="${english ? 'en' : 'pt-BR'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${english ? 'Local preview unavailable' : 'Prévia local indisponível'}</title><style>html{background:#090909;color:#f5f5f5;font-family:Inter,system-ui,sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center}.card{max-width:460px;padding:28px;text-align:center}.card strong{font-size:18px}.card p{color:#999;line-height:1.6}details{margin-top:18px;color:#777;font-size:12px}summary{cursor:pointer}code{display:block;margin-top:8px;overflow-wrap:anywhere;line-height:1.5}</style><div class="card"><strong>${english ? 'Keep the project open in Onun Kodety' : 'Mantenha o projeto aberto no Onun Kodety'}</strong><p>${english ? 'This tab receives the local site from the active Builder tab. Return to Studio and open Site again.' : 'Esta guia recebe o site local da guia ativa do Builder. Volte ao Studio e abra Site novamente.'}</p>${detail}</div></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function rewrittenText(text, siteBaseUrl, proxyBaseUrl) {
  const siteBase = siteBaseUrl.endsWith('/') ? siteBaseUrl : `${siteBaseUrl}/`;
  const proxyBase = proxyBaseUrl.endsWith('/') ? proxyBaseUrl : `${proxyBaseUrl}/`;
  const replacements = [
    [siteBase, proxyBase],
    [siteBase.slice(0, -1), proxyBase.slice(0, -1)],
    [siteBase.replaceAll('/', '\\/'), proxyBase.replaceAll('/', '\\/')],
    [encodeURIComponent(siteBase), encodeURIComponent(proxyBase)],
    [encodeURIComponent(siteBase.slice(0, -1)), encodeURIComponent(proxyBase.slice(0, -1))],
  ];
  let output = text;
  for (const [source, target] of replacements) output = output.split(source).join(target);
  return output;
}

function responseHeaders(rawHeaders, siteBaseUrl, proxyBaseUrl) {
  const headers = new Headers();
  const blocked = new Set([
    'connection',
    'content-encoding',
    'content-length',
    'content-security-policy',
    'set-cookie',
    'transfer-encoding',
    'x-frame-options',
  ]);
  for (const [name, values] of Object.entries(rawHeaders || {})) {
    if (blocked.has(name.toLowerCase())) continue;
    for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
  }
  const location = headers.get('location');
  if (location) headers.set('location', rewrittenText(location, siteBaseUrl, proxyBaseUrl));
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Kodety-Studio-Preview', '1');
  return headers;
}

async function proxyPreviewRequest(request, route) {
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  const requestId = crypto.randomUUID();
  const payload = {
    source: PREVIEW_REQUEST_SOURCE,
    version: 1,
    type: 'request',
    requestId,
    projectId: route.projectId,
    url: route.requestPath,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
  };

  let runtimeResponse;
  try {
    runtimeResponse = await requestFromStudioRuntime(payload, body);
  } catch (error) {
    const language = new URL(request.referrer || self.registration.scope).searchParams.get('lang') || 'pt';
    return previewUnavailable(language, error instanceof Error ? error.message : String(error));
  }

  const headers = responseHeaders(runtimeResponse.headers, runtimeResponse.siteBaseUrl, route.proxyBaseUrl);
  const contentType = headers.get('content-type') || '';
  const isText = /(?:text\/|application\/(?:javascript|json|xml)|image\/svg\+xml)/i.test(contentType);
  let responseBody = runtimeResponse.body || new ArrayBuffer(0);
  if (isText && responseBody.byteLength > 0) {
    const text = new TextDecoder().decode(responseBody);
    responseBody = new TextEncoder().encode(rewrittenText(text, runtimeResponse.siteBaseUrl, route.proxyBaseUrl));
  }
  const status = Number(runtimeResponse.status) || 502;
  const emptyBody = request.method === 'HEAD' || [204, 205, 304].includes(status);
  return new Response(emptyBody ? null : responseBody, { status, headers });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const route = previewRoute(url);
  if (route) {
    event.respondWith(proxyPreviewRequest(request, route));
    return;
  }

  if (request.method !== 'GET') return;
  const scopePath = new URL(self.registration.scope).pathname;
  // The WordPress runtime and MCP relay have their own lifecycle. Never put
  // their navigations or authenticated responses into the Studio shell cache.
  const projectStorageNavigation = url.pathname === `${scopePath}project-storage.html` || url.pathname === `${scopePath}project-storage`;
  const shellNavigation = url.pathname === scopePath || url.pathname === `${scopePath}index.html` || projectStorageNavigation;
  const shellAsset = url.pathname.startsWith(`${scopePath}assets/`) || url.pathname === `${scopePath}manifest.webmanifest` || url.pathname === `${scopePath}manifest.en.webmanifest`;
  if (!shellNavigation && !shellAsset) return;

  // Local Vite modules are mutable and must stay live while the user previews
  // changes. Packaged deployments only reference versioned assets below.
  if (url.pathname.includes('/@') || url.pathname.includes('/src/') || url.pathname.includes('/node_modules/') || /\.(?:ts|tsx)$/.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    // The deletion document must retain its own DIP response while offline.
    // Falling back to the COEP index would block Playground again.
    const fallbackDocument = projectStorageNavigation ? './project-storage.html' : './index.html';
    event.respondWith(
      fetch(request)
        .then(async response => response.ok || response.type === 'opaqueredirect' ? response : (await caches.match(fallbackDocument, { cacheName: CACHE_NAME })) || response)
        .catch(() => caches.match(fallbackDocument, { cacheName: CACHE_NAME })),
    );
    return;
  }

  if (/\/assets\/(?:studio\.(?:js|css)|kodety\.zip|kodety-(?:mark|logo)\.svg)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then(async response => response.ok ? response : (await caches.match(request, { cacheName: CACHE_NAME })) || response)
        .catch(() => caches.match(request, { cacheName: CACHE_NAME })),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE_NAME }).then(async cached => {
      if (cached) return cached;
      const previous = (await caches.keys()).filter(name => name.startsWith('kodety-studio-shell-') && name !== CACHE_NAME).reverse();
      for (const name of previous) {
        if (!await completeCache(name)) continue;
        const asset = await caches.match(request, { cacheName: name });
        if (asset) return asset;
      }
      return fetch(request);
    }),
  );
});
