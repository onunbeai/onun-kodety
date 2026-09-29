import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createKodetyStudioServer } from '../public/server.mjs';
import { decodeAgentNetworkRequest } from '../public/agent-network.mjs';

const input = (operation = 'responses', body = '{"model":"test"}') => ({ operation, headers: { authorization: 'Bearer fixture-token', 'chatgpt-account-id': 'fixture-account', 'content-type': 'application/json', cookie: 'never-forward', host: 'attacker.invalid' }, body: Buffer.from(body).toString('base64') });
async function start(t, fetcher) {
  const server = createKodetyStudioServer({ agentNetwork: { fetch: fetcher } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { origin, send: (body = input(), overrides = {}) => fetch(`${origin}/__kodety_agent__/network`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'X-Kodety-Agent-Network': '1', ...overrides }, body: JSON.stringify(body) }) };
}

test('Studio relays bytes to fixed OpenAI endpoints without cookies, redirects or token storage', async t => {
  const requests = [];
  const { send } = await start(t, async (url, options) => {
    requests.push({ url, options });
    return new Response('data: {"type":"response.completed"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream', 'set-cookie': 'must-not-escape', 'retry-after': '3' } });
  });
  const response = await send();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-kodety-agent-relay'), '1');
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'data: {"type":"response.completed"}\n\n');
  assert.equal(requests[0].url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(requests[0].options.headers.authorization, 'Bearer fixture-token');
  assert.equal(requests[0].options.headers.cookie, undefined);
  assert.equal(requests[0].options.headers.host, undefined);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.body.toString(), '{"model":"test"}');
});

test('fixed operation map, compressed body, authentication and strict envelope', () => {
  const cases = [
    ['device-code', 'POST', 'https://auth.openai.com/api/accounts/deviceauth/usercode'],
    ['device-token', 'POST', 'https://auth.openai.com/api/accounts/deviceauth/token'],
    ['oauth-token', 'POST', 'https://auth.openai.com/oauth/token'],
    ['usage', 'GET', 'https://chatgpt.com/backend-api/wham/usage'],
  ];
  for (const [operation, method, url] of cases) {
    const result = decodeAgentNetworkRequest(input(operation, method === 'GET' ? '' : '{}'));
    assert.equal(result.url, url);
    assert.equal(result.method, method);
  }
  const binary = Buffer.from([0, 1, 255, 17]);
  assert.deepEqual(decodeAgentNetworkRequest({ ...input(), body: binary.toString('base64'), headers: { authorization: 'Bearer fixture', 'content-encoding': 'zstd' } }).body, binary);
  for (const body of [
    { ...input(), url: 'https://attacker.invalid' }, { ...input(), operation: '__proto__' },
    { ...input(), operation: 'https://attacker.invalid' }, { ...input(), body: '%%%=' },
    { ...input(), body: 'YQ=' }, { ...input(), body: 'YR==' },
    { ...input(), headers: { authorization: 'Bearer a\r\ncookie: x' } },
    { ...input(), headers: {} }, input('usage', '{}'),
  ]) assert.throws(() => decodeAgentNetworkRequest(body));
  assert.throws(() => decodeAgentNetworkRequest({ ...input(), body: 'A'.repeat(24 * 1024 * 1024) }), error => error.status === 413);
});

test('untrusted origins, missing custom header and arbitrary targets cannot call upstream', async t => {
  let calls = 0;
  const { send, origin } = await start(t, async () => { calls += 1; return new Response('{}'); });
  const availability = await fetch(`${origin}/__kodety_agent__/network`);
  assert.equal(availability.headers.get('x-kodety-agent-relay'), '1');
  assert.deepEqual(await availability.json(), { available: true });
  assert.equal((await send(input(), { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await send(input(), { 'X-Kodety-Agent-Network': '' })).status, 403);
  assert.equal((await send(input(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await send({ ...input(), url: 'https://attacker.invalid' })).status, 400);
  assert.equal((await fetch(`${origin}/__kodety_agent__/network`, { method: 'OPTIONS' })).status, 405);
  assert.equal(calls, 0);
});

test('upstream OAuth status is preserved and redirect/network diagnostics are sanitized', async t => {
  let mode = 'status';
  const { send } = await start(t, async () => {
    if (mode === 'throw') throw new Error('secret-token response body');
    return new Response(mode === 'redirect' ? '' : '{"error":"authorization_pending"}', { status: mode === 'redirect' ? 302 : 403, headers: { 'content-type': 'application/json', location: 'https://attacker.invalid' } });
  });
  const pending = await send(input('device-token', '{}'));
  assert.equal(pending.status, 403);
  assert.deepEqual(await pending.json(), { error: 'authorization_pending' });
  mode = 'redirect';
  const redirect = await send();
  assert.equal(redirect.status, 502);
  assert.equal(redirect.headers.get('location'), null);
  mode = 'throw';
  const failure = await send();
  assert.equal(failure.status, 502);
  assert.equal((await failure.text()).includes('secret-token'), false);
});

test('SSE is delivered before completion and closing the consumer cancels upstream', async t => {
  let release;
  let resolveAborted;
  const aborted = new Promise(resolve => { resolveAborted = resolve; });
  const { send } = await start(t, async (_url, options) => {
    options.signal.addEventListener('abort', () => { resolveAborted(); release?.(); });
    return new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
        await new Promise(resolve => { release = resolve; });
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const response = await send();
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  await reader.cancel();
  await Promise.race([aborted, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('upstream was not cancelled')), 2000); timer.unref(); })]);
});
