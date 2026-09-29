import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGitHubAuth } from './github-auth.mjs';
import { createCloudflareDeploy } from './cloudflare-deploy.mjs';
import { createAgentNetwork } from './agent-network.mjs';

const STATIC_ROOT = path.dirname(fileURLToPath(import.meta.url));
const RELAY_PREFIX = '/__kodety_mcp__/v1/projects/';
const BRIDGE_STALE_MS = 45_000;
const POLL_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_MCP_BODY_BYTES = 40 * 1024 * 1024;
const MAX_BRIDGE_BODY_BYTES = 56 * 1024 * 1024;
const MAX_QUEUED_REQUESTS = 32;

const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.zip', 'application/zip'],
]);

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'authorization',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
]);

const FORWARDED_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-type',
  'mcp-session-id',
  'retry-after',
]);

function securityHeaders(cacheControl = 'no-store', projectStorage = false) {
  return {
    'Cache-Control': cacheControl,
    'Cross-Origin-Opener-Policy': 'same-origin',
    // WebContainer needs COEP on its entire ancestor chain. Only the separate
    // deletion document uses DIP to reach Playground's persistent iframe.
    ...(projectStorage ? { 'Document-Isolation-Policy': 'isolate-and-credentialless' } : { 'Cross-Origin-Embedder-Policy': 'credentialless' }),
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: blob: https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; frame-src 'self' blob: https:; connect-src 'self' https: blob: data:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(self "https://playground.wordpress.net"), clipboard-write=(self "https://playground.wordpress.net")',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

function relayCorsHeaders(request) {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '*';
  return {
    'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id, x-kodety-studio-bridge',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'content-type, mcp-session-id, retry-after',
    'Vary': 'Origin',
  };
}

function sendJson(request, response, status, payload, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    ...securityHeaders('no-store'),
    ...relayCorsHeaders(request),
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function sendEmpty(request, response, status = 204, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    ...securityHeaders('no-store'),
    ...relayCorsHeaders(request),
    ...extraHeaders,
  });
  response.end();
}

async function readBody(request, maximumBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

async function readJson(request, maximumBytes) {
  const bytes = await readBody(request, maximumBytes);
  if (bytes.length === 0) return {};
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.status = 400;
    throw error;
  }
}

function validProjectId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{8,80}$/i.test(value);
}

function validBridgeToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,96}$/.test(value);
}

function sameToken(left, right) {
  if (!validBridgeToken(left) || !validBridgeToken(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function publicOrigin(request) {
  const forwarded = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded === 'https' ? 'https' : 'http';
  return `${protocol}://${request.headers.host || '127.0.0.1'}`;
}

function normalizedHeaders(headers, allowlist) {
  const normalized = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const key = name.toLowerCase();
    if (!allowlist.has(key) || value === undefined) continue;
    normalized[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return normalized;
}

function requestJsonRpcId(bytes) {
  if (!bytes.length || bytes.length > 1_048_576) return null;
  try {
    const payload = JSON.parse(bytes.toString('utf8'));
    return payload && typeof payload === 'object' && 'id' in payload ? payload.id : null;
  } catch {
    return null;
  }
}

function finishPoll(session, status = 204) {
  const waiter = session.pollWaiter;
  if (!waiter) return;
  session.pollWaiter = null;
  clearTimeout(waiter.timer);
  sendEmpty(waiter.request, waiter.response, status);
}

function takeQueuedRequest(session) {
  while (session.queue.length > 0) {
    const requestId = session.queue.shift();
    const pending = session.pending.get(requestId);
    if (pending) return pending.envelope;
  }
  return null;
}

function deliverQueuedRequest(session) {
  if (!session.pollWaiter) return false;
  const envelope = takeQueuedRequest(session);
  if (!envelope) return false;
  const waiter = session.pollWaiter;
  session.pollWaiter = null;
  clearTimeout(waiter.timer);
  sendJson(waiter.request, waiter.response, 200, envelope);
  return true;
}

function rejectSessionPending(session, message, status = 503) {
  finishPoll(session);
  for (const pending of session.pending.values()) {
    clearTimeout(pending.timer);
    pending.resolve({
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '2' },
      body: Buffer.from(JSON.stringify({
        jsonrpc: '2.0',
        id: pending.jsonRpcId,
        error: { code: -32001, message },
      })),
    });
  }
  session.pending.clear();
  session.queue.length = 0;
}

function relayRoute(pathname) {
  if (!pathname.startsWith(RELAY_PREFIX)) return null;
  const suffix = pathname.slice(RELAY_PREFIX.length);
  const separator = suffix.indexOf('/');
  if (separator < 1) return null;
  const projectId = suffix.slice(0, separator);
  const action = suffix.slice(separator + 1);
  if (!validProjectId(projectId)) return null;
  if (!['bridge/connect', 'bridge/poll', 'bridge/respond', 'bridge/disconnect', 'mcp'].includes(action)) return null;
  return { projectId, action };
}

export function createKodetyStudioServer({ root = STATIC_ROOT, githubAuth: githubAuthOptions, agentNetwork: agentNetworkOptions, cloudflareDeploy: cloudflareDeployOptions } = {}) {
  const sessions = new Map();
  const githubAuth = createGitHubAuth(githubAuthOptions);
  const cloudflareDeploy = createCloudflareDeploy(cloudflareDeployOptions);
  const agentNetwork = createAgentNetwork(agentNetworkOptions);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', publicOrigin(request));
      if (await agentNetwork.handle(request, response, url.pathname, publicOrigin(request))) return;
      if (await githubAuth.handle(request, response, url.pathname, publicOrigin(request))) return;
      if (await cloudflareDeploy.handle(request, response, url.pathname, publicOrigin(request))) return;
      const relay = relayRoute(url.pathname);
      if (relay) {
        if (request.method === 'OPTIONS') {
          sendEmpty(request, response);
          return;
        }

        if (relay.action.startsWith('bridge/') && request.method !== 'POST') {
          sendJson(request, response, 405, { error: 'Method not allowed.' }, { Allow: 'POST, OPTIONS' });
          return;
        }

        if (relay.action === 'bridge/connect') {
          const payload = await readJson(request, 16_384);
          const mode = payload.mode === 'html' ? 'html' : 'wordpress';
          if (mode === 'html' && request.headers.origin && request.headers.origin !== publicOrigin(request)) {
            sendJson(request, response, 403, { error: 'HTML MCP bridge origin denied.' });
            return;
          }
          const suppliedToken = typeof payload.bridgeToken === 'string' ? payload.bridgeToken : '';
          let session = sessions.get(relay.projectId);
          const stale = session && Date.now() - session.lastSeenAt > BRIDGE_STALE_MS;
          if (session && !sameToken(session.bridgeToken, suppliedToken) && !stale) {
            sendJson(request, response, 409, { error: 'Este projeto já possui uma ponte MCP ativa.' });
            return;
          }
          if (session && stale && !sameToken(session.bridgeToken, suppliedToken)) {
            rejectSessionPending(session, 'A ponte anterior do Studio foi substituída. Reabra o projeto e tente novamente.');
            sessions.delete(relay.projectId);
            session = null;
          }
          if (!session) {
            session = {
              mode,
              bridgeToken: randomBytes(32).toString('base64url'),
              lastSeenAt: Date.now(),
              pending: new Map(),
              pollWaiter: null,
              queue: [],
            };
            sessions.set(relay.projectId, session);
          }
          if (session.mode !== mode) {
            sendJson(request, response, 409, { error: 'The project already has a bridge for another workspace mode.' });
            return;
          }
          session.lastSeenAt = Date.now();
          sendJson(request, response, 200, {
            bridgeToken: session.bridgeToken,
            mcpUrl: `${publicOrigin(request)}${RELAY_PREFIX}${relay.projectId}/mcp`,
            mode: session.mode,
          });
          return;
        }

        const session = sessions.get(relay.projectId);
        if (relay.action === 'bridge/poll') {
          const payload = await readJson(request, 16_384);
          if (!session || !sameToken(session.bridgeToken, payload.bridgeToken)) {
            sendJson(request, response, 401, { error: 'Ponte MCP inválida ou expirada.' });
            return;
          }
          session.lastSeenAt = Date.now();
          const envelope = takeQueuedRequest(session);
          if (envelope) {
            sendJson(request, response, 200, envelope);
            return;
          }
          finishPoll(session, 409);
          const timer = setTimeout(() => {
            if (session.pollWaiter?.response !== response) return;
            session.pollWaiter = null;
            sendEmpty(request, response);
          }, POLL_TIMEOUT_MS);
          session.pollWaiter = { request, response, timer };
          request.once('close', () => {
            if (session.pollWaiter?.response !== response) return;
            clearTimeout(timer);
            session.pollWaiter = null;
          });
          return;
        }

        if (relay.action === 'bridge/respond') {
          const payload = await readJson(request, MAX_BRIDGE_BODY_BYTES);
          if (!session || !sameToken(session.bridgeToken, payload.bridgeToken)) {
            sendJson(request, response, 401, { error: 'Ponte MCP inválida ou expirada.' });
            return;
          }
          session.lastSeenAt = Date.now();
          const pending = session.pending.get(String(payload.requestId || ''));
          if (!pending) {
            sendJson(request, response, 404, { error: 'A chamada MCP já expirou ou foi cancelada.' });
            return;
          }
          let body;
          try {
            body = payload.bodyBase64 ? Buffer.from(String(payload.bodyBase64), 'base64') : Buffer.alloc(0);
          } catch {
            body = Buffer.alloc(0);
          }
          if (body.length > MAX_MCP_BODY_BYTES) {
            sendJson(request, response, 413, { error: 'A resposta MCP ultrapassou o limite do relay.' });
            return;
          }
          session.pending.delete(pending.envelope.requestId);
          clearTimeout(pending.timer);
          pending.resolve({
            status: Number.isInteger(payload.status) && payload.status >= 100 && payload.status <= 599 ? payload.status : 502,
            headers: normalizedHeaders(payload.headers, FORWARDED_RESPONSE_HEADERS),
            body,
          });
          sendJson(request, response, 202, { accepted: true });
          return;
        }

        if (relay.action === 'bridge/disconnect') {
          const payload = await readJson(request, 16_384);
          if (!session || !sameToken(session.bridgeToken, payload.bridgeToken)) {
            sendEmpty(request, response);
            return;
          }
          rejectSessionPending(session, 'O projeto foi fechado no Onun Kodety. Abra-o novamente para usar o MCP.');
          sessions.delete(relay.projectId);
          sendEmpty(request, response);
          return;
        }

        if (relay.action === 'mcp') {
          const body = await readBody(request, MAX_MCP_BODY_BYTES);
          if (!session || Date.now() - session.lastSeenAt > BRIDGE_STALE_MS) {
            sendJson(request, response, 503, {
              jsonrpc: '2.0',
              id: requestJsonRpcId(body),
              error: {
                code: -32001,
                message: 'Este projeto não está aberto no Onun Kodety. Abra o projeto no navegador e tente novamente.',
              },
            }, { 'Retry-After': '2' });
            return;
          }
          if (session.pending.size >= MAX_QUEUED_REQUESTS) {
            sendJson(request, response, 429, {
              jsonrpc: '2.0',
              id: requestJsonRpcId(body),
              error: { code: -32002, message: 'O projeto já possui muitas chamadas MCP em andamento.' },
            }, { 'Retry-After': '2' });
            return;
          }

          const requestId = randomUUID();
          const envelope = {
            requestId,
            method: request.method || 'POST',
            path: session.mode === 'html' ? '/kodety/html/mcp' : '/wp-json/kodety/v1/mcp',
            headers: normalizedHeaders(request.headers, session.mode === 'html' ? new Set([...FORWARDED_REQUEST_HEADERS, 'origin']) : FORWARDED_REQUEST_HEADERS),
            bodyBase64: body.length ? body.toString('base64') : '',
          };
          const result = await new Promise(resolve => {
            const timer = setTimeout(() => {
              if (!session.pending.delete(requestId)) return;
              session.queue = session.queue.filter(queuedId => queuedId !== requestId);
              resolve({
                status: 504,
                headers: { 'content-type': 'application/json; charset=utf-8' },
                body: Buffer.from(JSON.stringify({
                  jsonrpc: '2.0',
                  id: requestJsonRpcId(body),
                  error: { code: -32003, message: session.mode === 'html' ? 'O Builder HTML não respondeu a tempo.' : 'O WordPress local não respondeu a tempo.' },
                })),
              });
            }, REQUEST_TIMEOUT_MS);
            session.pending.set(requestId, {
              envelope,
              jsonRpcId: requestJsonRpcId(body),
              resolve,
              timer,
            });
            session.queue.push(requestId);
            deliverQueuedRequest(session);
          });

          if (response.destroyed || response.writableEnded) return;
          response.writeHead(result.status, {
            ...securityHeaders('no-store'),
            ...relayCorsHeaders(request),
            ...result.headers,
          });
          response.end(result.body);
          return;
        }
      }

      if (url.pathname === '/_health') {
        sendJson(request, response, 200, { ok: true });
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        response.writeHead(400, securityHeaders());
        response.end('Bad Request');
        return;
      }
      const relative = pathname === '/' ? 'index.html' : pathname === '/project-storage' ? 'project-storage.html' : pathname.replace(/^\/+/, '');
      if (relative.split('/').some(part => part.startsWith('.')) || /^(?:server|studio-cloud(?:-auth|-r2|-store)?|github-auth|cloudflare-deploy|agent-network)\.mjs$/.test(relative)) {
        response.writeHead(404, securityHeaders()); response.end('Not Found'); return;
      }
      let filename = path.resolve(root, relative);
      if (!filename.startsWith(`${path.resolve(root)}${path.sep}`) && filename !== path.resolve(root, 'index.html')) {
        response.writeHead(403, securityHeaders());
        response.end('Forbidden');
        return;
      }
      let fileStats = await stat(filename).catch(() => null);
      if (!fileStats?.isFile()) {
        if (path.extname(relative) && !relative.startsWith('__kodety_preview__/')) {
          response.writeHead(404, securityHeaders());
          response.end('Not Found');
          return;
        }
        filename = path.resolve(root, 'index.html');
        fileStats = await stat(filename);
      }
      const basename = path.basename(filename);
      const immutable = relative.startsWith('assets/')
        && !['studio.js', 'studio.css', 'kodety.zip'].includes(basename);
      const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate';
      response.writeHead(200, {
        ...securityHeaders(cacheControl, relative === 'project-storage.html'),
        'Content-Length': fileStats.size,
        'Content-Type': MIME_TYPES.get(path.extname(filename).toLowerCase()) || 'application/octet-stream',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filename).pipe(response);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      sendJson(request, response, status, { error: status === 500 ? 'Internal server error.' : error.message });
    }
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [projectId, session] of sessions) {
      if (now - session.lastSeenAt <= BRIDGE_STALE_MS) continue;
      rejectSessionPending(session, 'A ponte com o navegador foi encerrada. Reabra o projeto no Onun Kodety.');
      sessions.delete(projectId);
    }
  }, 15_000);
  cleanup.unref();
  server.once('close', () => { clearInterval(cleanup); githubAuth.clear(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number.parseInt(process.env.PORT || '80', 10);
  createKodetyStudioServer().listen(port, '0.0.0.0', () => {
    process.stdout.write(`Onun Kodety listening on :${port}\n`);
  });
}
