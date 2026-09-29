import { once } from 'node:events';

export const AGENT_NETWORK_PATH = '/__kodety_agent__/network';
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const OPERATIONS = Object.freeze({
  'device-code': ['POST', 'https://auth.openai.com/api/accounts/deviceauth/usercode'],
  'device-token': ['POST', 'https://auth.openai.com/api/accounts/deviceauth/token'],
  'oauth-token': ['POST', 'https://auth.openai.com/oauth/token'],
  responses: ['POST', 'https://chatgpt.com/backend-api/codex/responses'],
  usage: ['GET', 'https://chatgpt.com/backend-api/wham/usage'],
});
const REQUEST_HEADERS = new Set(['authorization', 'chatgpt-account-id', 'content-type', 'content-encoding', 'accept', 'openai-beta', 'originator', 'user-agent', 'session-id', 'x-client-request-id', 'x-codex-turn-state', 'version']);
const RESPONSE_HEADERS = ['content-type', 'retry-after', 'retry-after-ms', 'x-codex-turn-state', 'x-request-id'];
const responseHeaders = {
  'Cache-Control': 'no-store',
  'X-Kodety-Agent-Relay': '1',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Accel-Buffering': 'no',
};
const fail = (status, code) => Object.assign(new Error(code), { status, code });

/** Resolve an operation, never a caller-controlled URL. Credentials only live
 * for this request and are never saved, logged, or forwarded through redirects. */
export function decodeAgentNetworkRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['operation', 'headers', 'body'].includes(key))
    || typeof input.operation !== 'string' || !Object.hasOwn(OPERATIONS, input.operation)) throw fail(400, 'agent_network_request');
  if (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)
    || Object.keys(input.headers).length > 40 || typeof input.body !== 'string') throw fail(400, 'agent_network_request');
  if (input.body.length > Math.ceil(MAX_BODY_BYTES / 3) * 4) throw fail(413, 'agent_network_size');
  if (input.body.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input.body)) throw fail(400, 'agent_network_request');
  const body = Buffer.from(input.body, 'base64');
  if (body.length > MAX_BODY_BYTES) throw fail(413, 'agent_network_size');
  if (body.toString('base64') !== input.body) throw fail(400, 'agent_network_request');
  const [method, url] = OPERATIONS[input.operation];
  if (method === 'GET' && body.length) throw fail(400, 'agent_network_request');
  const headers = {};
  let headerBytes = 0;
  for (const [name, value] of Object.entries(input.headers)) {
    const key = name.toLowerCase();
    if (!REQUEST_HEADERS.has(key)) continue;
    if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 16384) throw fail(400, 'agent_network_request');
    headerBytes += key.length + value.length;
    if (headerBytes > 32768) throw fail(400, 'agent_network_request');
    headers[key] = value;
  }
  if (['responses', 'usage'].includes(input.operation) && !/^Bearer [^\s]+$/.test(headers.authorization || '')) throw fail(401, 'agent_auth_required');
  // Cookies and hop-by-hop browser headers are intentionally excluded above.
  return { method, url, headers, ...(method === 'POST' ? { body } : {}) };
}

export function createAgentNetwork({ fetch: fetcher = globalThis.fetch, now = Date.now } = {}) {
  const rates = new Map();
  let active = 0;
  function send(response, status, code) {
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) { response.destroy(); return; }
    response.writeHead(status, { ...responseHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: code }));
  }
  return {
    async handle(request, response, pathname, origin) {
      if (pathname !== AGENT_NETWORK_PATH) return false;
      let controller;
      let timer;
      let onClose;
      let acquired = false;
      try {
        if (request.method === 'GET') {
          response.writeHead(200, { ...responseHeaders, 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ available: true }));
          return true;
        }
        // The Builder performs this fetch on its own origin. No CORS grant is
        // issued, including for WebContainer frames or unrelated websites.
        if (request.method !== 'POST') throw fail(405, 'agent_network_method');
        if (request.headers.origin !== origin || request.headers['x-kodety-agent-network'] !== '1'
          || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')
          || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) throw fail(403, 'agent_network_origin');
        for (const [key, entry] of rates) if (entry.until <= now()) rates.delete(key);
        const ip = request.socket.remoteAddress || 'unknown';
        const rate = rates.get(ip) || { until: now() + 60_000, count: 0 };
        if (active >= 64 || rate.count >= 180 || rates.size >= 2048 && !rates.has(ip)) throw fail(429, 'agent_network_busy');
        rate.count += 1;
        rates.set(ip, rate);
        active += 1;
        acquired = true;
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > MAX_ENVELOPE_BYTES) throw fail(413, 'agent_network_size');
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'agent_network_request'); }
        const { url, ...options } = decodeAgentNetworkRequest(input);
        controller = new AbortController();
        onClose = () => controller.abort();
        response.once('close', onClose);
        timer = setTimeout(() => controller.abort(), input.operation === 'responses' ? 300_000 : 45_000);
        timer.unref?.();
        const upstream = await fetcher(url, { ...options, redirect: 'error', credentials: 'omit', signal: controller.signal });
        // A mocked/custom fetch must obey the same redirect boundary as fetch.
        if (upstream.status >= 300 && upstream.status < 400) throw fail(502, 'agent_network_redirect');
        if (response.destroyed) return true;
        const headers = { ...responseHeaders };
        for (const name of RESPONSE_HEADERS) {
          const value = upstream.headers.get(name);
          if (value && !/[\r\n\0]/.test(value)) headers[name] = value;
        }
        response.writeHead(upstream.status, headers);
        response.flushHeaders();
        let received = 0;
        if (upstream.body) for await (const chunk of upstream.body) {
          received += chunk.byteLength;
          if (received > MAX_RESPONSE_BYTES) throw fail(502, 'agent_network_response_size');
          if (response.destroyed) break;
          if (!response.write(chunk)) await once(response, 'drain', { signal: controller.signal });
        }
        if (!response.destroyed) response.end();
      } catch (error) {
        controller?.abort();
        send(response, error?.status || 502, error?.code?.startsWith('agent_') ? error.code : 'agent_network_unavailable');
      } finally {
        clearTimeout(timer);
        if (onClose) response.removeListener('close', onClose);
        if (acquired) active -= 1;
      }
      return true;
    },
  };
}
