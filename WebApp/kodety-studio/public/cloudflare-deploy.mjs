export const CLOUDFLARE_DEPLOY_PREFIX = '/__kodety_deploy__/cloudflare/';
const API_ORIGIN = 'https://api.cloudflare.com/client/v4';
const FILE_LIMIT = 25 * 1024 * 1024;
const BODY_LIMIT = 36 * 1024 * 1024;
const PROJECT = '[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?';
const PROJECTS = '/accounts/[a-fA-F0-9]{32}/pages/projects';
const PROJECT_ROUTE = `${PROJECTS}/${PROJECT}`;
const UUID = '[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}';
const HASH = /^[a-f0-9]{32}$/;
const ERROR_CODES = new Set(['cloudflare-config', 'cloudflare-token', 'cloudflare-permission', 'cloudflare-network', 'cloudflare-request', 'cloudflare-uncertain', 'cloudflare-unavailable', 'cloudflare-rate-limit', 'cloudflare-project-exists']);
function failure(status, code) { return Object.assign(new Error(code), { status, code }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) { return object(value) && Object.keys(value).every(key => allowed.includes(key)); }
function branch(value) { return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\s\u0000-\u001f\u007f]/.test(value); }
function base64(value, limit = FILE_LIMIT) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length <= limit && bytes.toString('base64') === value;
}
function hashes(value) { return keys(value, ['hashes']) && Array.isArray(value.hashes) && value.hashes.length <= 1000 && value.hashes.every(hash => typeof hash === 'string' && HASH.test(hash)); }
function assetPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 1025 || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  const relative = value.slice(1), parts = relative.toLowerCase().split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || ['.git', '.github', '.kodety', '.kodety-deployment.json', 'node_modules', '.npmrc', '.pypirc'].includes(part) || part === '.env' || part.startsWith('.env.') || /^(id_rsa|id_ed25519)(\.|$)/.test(part) || /\.(pem|key|p12|pfx)$/.test(part))) return false;
  return !/^(?:functions(?:\/|$)|_worker(?:\.[^/]+)?(?:\/|$)|_routes\.json$|_headers$|_redirects$|(?:\.incode|\.coday)\/(?:project|template|publish-overlay)\.json$)/i.test(relative);
}
function route(input) {
  if (!keys(input, ['route', 'method', 'body']) || typeof input.route !== 'string' || input.route.length > 512) throw failure(400, 'cloudflare-config');
  const { route: pathname, method, body } = input;
  if (method === 'GET' && body === undefined) {
    if (new RegExp(`^${PROJECTS}\\?page=([1-9][0-9]{0,4})&per_page=100$`).test(pathname)) {
      const page = Number(new URLSearchParams(pathname.split('?')[1]).get('page'));
      if (page > 10000) throw failure(400, 'cloudflare-config');
      return { type: 'projects', method, pathname };
    }
    if (new RegExp(`^${PROJECT_ROUTE}/upload-token$`).test(pathname)) return { type: 'token', method, pathname };
    if (new RegExp(`^${PROJECT_ROUTE}/deployments/${UUID}$`).test(pathname)) return { type: 'deployment', method, pathname };
  }
  if (method !== 'POST') throw failure(400, 'cloudflare-config');
  if (new RegExp(`^${PROJECTS}$`).test(pathname) && keys(body, ['name', 'production_branch']) && typeof body.name === 'string' && new RegExp(`^${PROJECT}$`).test(body.name) && branch(body.production_branch)) return { type: 'project', creation: true, method, pathname, body: JSON.stringify(body) };
  if (['/pages/assets/check-missing', '/pages/assets/upsert-hashes'].includes(pathname) && hashes(body)) return { type: pathname.endsWith('check-missing') ? 'missing' : 'assets', method, pathname, body: JSON.stringify(body) };
  // One file per upload bounds memory and gives the browser accurate progress.
  if (pathname === '/pages/assets/upload' && Array.isArray(body) && body.length === 1) {
    const asset = body[0];
    if (keys(asset, ['key', 'value', 'metadata', 'base64']) && typeof asset.key === 'string' && HASH.test(asset.key) && asset.base64 === true && keys(asset.metadata, ['contentType']) && typeof asset.metadata.contentType === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(asset.metadata.contentType) && asset.metadata.contentType.length < 100 && base64(asset.value)) return { type: 'assets', method, pathname, body: JSON.stringify(body) };
  }
  if (new RegExp(`^${PROJECT_ROUTE}/deployments$`).test(pathname) && keys(body, ['manifest', 'branch', 'headers', 'redirects']) && branch(body.branch) && object(body.manifest)) {
    const entries = Object.entries(body.manifest);
    if (!entries.length || entries.length > 1000 || !Object.hasOwn(body.manifest, '/index.html') || entries.some(([name, hash]) => !assetPath(name) || typeof hash !== 'string' || !HASH.test(hash)) || body.headers !== undefined && !base64(body.headers, 1024 * 1024) || body.redirects !== undefined && !base64(body.redirects, 1024 * 1024)) throw failure(400, 'cloudflare-config');
    const form = new FormData();
    form.append('manifest', JSON.stringify(body.manifest));
    form.append('branch', body.branch);
    for (const [key, name] of [['headers', '_headers'], ['redirects', '_redirects']]) if (body[key] !== undefined) form.append(name, new Blob([Buffer.from(body[key], 'base64')], { type: 'text/plain' }), name);
    return { type: 'deployment', creation: true, method, pathname, body: form };
  }
  throw failure(400, 'cloudflare-config');
}
function project(value) {
  if (!object(value) || typeof value.name !== 'string' || !new RegExp(`^${PROJECT}$`).test(value.name) || !branch(value.production_branch)) throw failure(502, 'cloudflare-request');
  return { name: value.name, production_branch: value.production_branch, ...(value.source ? { source: true } : {}) };
}
function sanitize(input, kind) {
  const result = input.result;
  if (kind === 'projects') {
    if (!Array.isArray(result) || result.length > 100) throw failure(502, 'cloudflare-request');
    const info = {};
    for (const key of ['page', 'per_page', 'total_pages', 'total_count']) if (Number.isSafeInteger(input.result_info?.[key]) && input.result_info[key] >= 0) info[key] = input.result_info[key];
    return { success: true, result: result.map(project), result_info: info };
  }
  if (kind === 'project') return { success: true, result: project(result) };
  if (kind === 'token') {
    if (typeof result?.jwt !== 'string' || !result.jwt || result.jwt.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(result.jwt)) throw failure(502, 'cloudflare-request');
    return { success: true, result: { jwt: result.jwt } };
  }
  if (kind === 'missing') {
    if (!Array.isArray(result) || result.length > 1000 || result.some(hash => typeof hash !== 'string' || !HASH.test(hash))) throw failure(502, 'cloudflare-request');
    return { success: true, result };
  }
  if (kind === 'deployment') {
    if (!object(result) || typeof result.id !== 'string' || !new RegExp(`^${UUID}$`).test(result.id) || typeof result.url !== 'string' || !/^https:\/\/[a-z\d](?:[a-z\d.-]*[a-z\d])?\.pages\.dev\/?$/i.test(result.url) || !['queued', 'initialize', 'clone_repo', 'build', 'deploy'].includes(result.latest_stage?.name) || !['idle', 'active', 'success', 'failure', 'canceled', 'cancelled'].includes(result.latest_stage?.status)) throw failure(502, 'cloudflare-request');
    return { success: true, result: { id: result.id, url: result.url, latest_stage: { name: result.latest_stage.name, status: result.latest_stage.status } } };
  }
  return { success: true, result: null };
}
async function readRequest(request, limit) {
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw failure(413, 'cloudflare-config');
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw failure(413, 'cloudflare-config'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { throw failure(400, 'cloudflare-config'); }
}
async function readResponse(response, limit) {
  if (Number(response.headers.get('content-length') || 0) > limit) throw failure(502, 'cloudflare-request');
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) { size += chunk.length; if (size > limit) throw failure(502, 'cloudflare-request'); chunks.push(Buffer.from(chunk)); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { throw failure(502, 'cloudflare-request'); }
}

/** Fixed Cloudflare Pages routes only. Credentials live solely in this request. */
export function createCloudflareDeploy({ fetch: fetcher = globalThis.fetch, maxBodyBytes = BODY_LIMIT, maxResponseBytes = 2 * 1024 * 1024 } = {}) {
  let active = 0;
  function send(response, status, payload) {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' });
    response.end(JSON.stringify(payload));
  }
  return {
    async handle(request, response, pathname, origin) {
      if (!pathname.startsWith(CLOUDFLARE_DEPLOY_PREFIX)) return false;
      if (pathname !== `${CLOUDFLARE_DEPLOY_PREFIX}request`) { send(response, 404, { success: false, code: 'cloudflare-unavailable' }); return true; }
      if (request.method !== 'POST') { send(response, 405, { success: false, code: 'cloudflare-config' }); return true; }
      if (request.headers.origin !== origin || request.headers['x-kodety-deploy'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) { send(response, 403, { success: false, code: 'cloudflare-permission' }); return true; }
      const authorization = request.headers.authorization;
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_.-]{1,4096}$/.test(authorization)) { send(response, 401, { success: false, code: 'cloudflare-token' }); return true; }
      if (active >= 4) { send(response, 429, { success: false, code: 'cloudflare-rate-limit' }); return true; }
      active++;
      let target;
      try {
        target = route(await readRequest(request, Math.min(BODY_LIMIT, maxBodyBytes)));
        const upstream = await fetcher(`${API_ORIGIN}${target.pathname}`, {
          method: target.method, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(90_000),
          headers: { Authorization: authorization, Accept: 'application/json', ...(typeof target.body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
          ...(target.body === undefined ? {} : { body: target.body }),
        });
        if (upstream.status >= 300 && upstream.status < 400) throw failure(502, target.creation ? 'cloudflare-uncertain' : 'cloudflare-request');
        if (!upstream.ok) {
          await upstream.body?.cancel();
          const status = [400, 401, 403, 409, 429].includes(upstream.status) ? upstream.status : 502;
          const code = status === 401 ? 'cloudflare-token' : status === 403 ? 'cloudflare-permission' : status === 429 ? 'cloudflare-rate-limit' : status === 409 && target.type === 'project' ? 'cloudflare-project-exists' : target.creation && upstream.status >= 500 ? 'cloudflare-uncertain' : 'cloudflare-request';
          throw failure(status, code);
        }
        const payload = await readResponse(upstream, maxResponseBytes);
        if (payload?.success !== true) {
          const status = [400, 401, 403, 409, 429].includes(upstream.status) ? upstream.status : 502;
          const code = status === 401 ? 'cloudflare-token' : status === 403 ? 'cloudflare-permission' : status === 429 ? 'cloudflare-rate-limit' : status === 409 && target.type === 'project' ? 'cloudflare-project-exists' : target.creation && upstream.status >= 500 ? 'cloudflare-uncertain' : 'cloudflare-request';
          throw failure(status, code);
        }
        send(response, 200, sanitize(payload, target.type));
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 502;
        const code = target?.creation && status >= 500 ? 'cloudflare-uncertain' : ERROR_CODES.has(error?.code) ? error.code : 'cloudflare-network';
        send(response, status, { success: false, code });
      } finally { active--; }
      return true;
    },
  };
}
