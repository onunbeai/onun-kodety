import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ configFile: false, root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const options = { agentUrl: 'https://site.test/wp-json/kodety/v1/agents', nonce: 'wp-nonce', pageUrl: 'https://site.test/builder' };
try {
  const { AgentTransport, agentEndpoint } = await server.ssrLoadModule('/lib/html-editor/agent-transport.ts');
  assert.equal(new URL(agentEndpoint('https://site.test/?rest_route=/kodety/v1/agents', 'config', options.pageUrl)).searchParams.get('rest_route'), '/kodety/v1/agents/config');
  for (const foreign of ['https://foreign.test/agents', 'https://user:pass@site.test/agents']) assert.throws(() => agentEndpoint(foreign, 'config', options.pageUrl));
  const calls = [], configs = [];
  const local = new AgentTransport({ ...options, onConfig: value => configs.push(value), fetch: async (url, init) => {
    calls.push({ url, init });
    return json(url.endsWith('/config') && init.body === undefined ? { enabled: true, available: true } : { result: { result: { success: true } } });
  } });
  await local.request('config', { method: 'GET' });
  assert.equal(configs[0].transport, 'local');
  assert.deepEqual(await local.request('rpc', { body: { method: 'account/read', params: {} } }), { success: true });
  await local.request('config', { body: { model: 'model' } });
  assert.equal(configs.length, 1, 'saving preferences cannot replace runtime configuration');
  await local.uploadAttachment(new File(['hello'], 'brief.txt', { type: 'text/plain' }));
  assert(calls.every(call => call.init.credentials === 'same-origin' && call.init.headers['X-WP-Nonce'] === 'wp-nonce' && call.init.redirect === 'error'));
  assert(calls.at(-1).init.body instanceof FormData, 'local attachments remain multipart for PHP');
  assert.equal(local.remote, false);
  local.cancelAll();

  for (const status of [401, 403]) {
    let denied;
    const restricted = new AgentTransport({ ...options, onDenied: error => { denied = error; }, fetch: async () => json({ code: 'rest_forbidden', message: 'Access denied' }, status) });
    await assert.rejects(restricted.request('rpc'), error => error.status === status);
    assert.equal(denied.code, 'rest_forbidden', 'the normal WordPress authorization remains enforced');
  }
  let pendingSignal;
  const pending = new AgentTransport({ ...options, fetch: async (_url, init) => {
    pendingSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Interrupted', 'AbortError')), { once: true }));
  } });
  const request = pending.request('events').catch(error => error);
  pending.cancelAll();
  assert.equal(pendingSignal.aborted, true);
  assert.equal((await request).name, 'AbortError');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(local.request('rpc', { signal: controller.signal }), error => error.name === 'AbortError');
  console.log('Agent transport: same-origin auth, safe attachments, configuration and cancellation passed.');
} finally { await server.close(); }
