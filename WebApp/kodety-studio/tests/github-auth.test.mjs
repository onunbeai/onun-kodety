import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createKodetyStudioServer } from '../public/server.mjs';

async function fixture(t, { clientId = 'test_client', replies = [], startTime = 100_000, trustProxy = false } = {}) {
  let time = startTime;
  const calls = [];
  const server = createKodetyStudioServer({ githubAuth: {
    clientId, trustProxy, now: () => time,
    fetch: async (url, options) => {
      calls.push({ url, options });
      const reply = replies.shift();
      assert.ok(reply, `Unexpected upstream request: ${url}`);
      if (typeof reply === 'function') return reply();
      return Response.json(reply);
    },
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(action, body = {}, headers = {}, method = 'POST') {
    const response = await fetch(`${origin}/__kodety_deploy__/github/${action}`, {
      method,
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Kodety-Deploy': '1', ...headers },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  return { request, calls, advance: milliseconds => { time += milliseconds; } };
}
const device = () => ({ device_code: 'server_only_device_secret', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 });

test('login is opt-in and never falls through to the app shell', async t => {
  const f = await fixture(t, { clientId: '' });
  assert.deepEqual((await f.request('config', {}, {}, 'GET')).data, { available: false });
  assert.equal((await f.request('start')).status, 503);
  assert.equal(f.calls.length, 0);
});

test('cross-origin and simple-form login requests cannot obtain credentials', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { 'X-Kodety-Deploy': '' }, { 'Content-Type': 'text/plain' }]) {
    const response = await f.request('start', {}, headers);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await f.request('start', {}, {}, 'OPTIONS')).status, 405);
  assert.equal(f.calls.length, 0);
});

test('device flow protects the device secret, respects polling, and delivers the token once', async t => {
  const f = await fixture(t, { replies: [device(), { error: 'authorization_pending' }, { access_token: 'ghu_test_token', token_type: 'bearer', refresh_token: 'never_return_refresh' }] });
  const start = await f.request('start');
  assert.equal(start.status, 200);
  assert.match(start.data.sessionId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(start.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(start.data).includes('server_only'), false);
  const sessionId = start.data.sessionId;
  assert.equal((await f.request('poll', { sessionId })).data.status, 'pending');
  assert.equal(f.calls.length, 1, 'early poll does not reach GitHub');
  f.advance(5000);
  assert.equal((await f.request('poll', { sessionId })).data.status, 'pending');
  f.advance(5000);
  const complete = await f.request('poll', { sessionId });
  assert.deepEqual(complete.data, { status: 'complete', accessToken: 'ghu_test_token' });
  assert.equal((await f.request('poll', { sessionId })).status, 410);
  assert.equal(f.calls[0].url, 'https://github.com/login/device/code');
  assert.equal(f.calls[1].url, 'https://github.com/login/oauth/access_token');
  const params = new URLSearchParams(f.calls[1].options.body);
  assert.equal(params.get('device_code'), 'server_only_device_secret');
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(params.has('client_secret'), false);
  assert.equal(f.calls[1].options.redirect, 'error');
});

test('slow_down increases the interval and expiry prevents further upstream requests', async t => {
  const f = await fixture(t, { replies: [device(), { error: 'slow_down' }] });
  const { sessionId } = (await f.request('start')).data;
  f.advance(5000);
  assert.deepEqual((await f.request('poll', { sessionId })).data, { status: 'slow_down', interval: 10 });
  f.advance(5000);
  assert.equal((await f.request('poll', { sessionId })).data.status, 'pending');
  assert.equal(f.calls.length, 2);
  f.advance(900_000);
  assert.equal((await f.request('poll', { sessionId })).status, 410);
  assert.equal(f.calls.length, 2);
});

test('declining or cancelling invalidates a session without exposing provider payloads', async t => {
  const f = await fixture(t, { replies: [device(), { error: 'access_denied', error_description: 'do not relay provider secrets' }, device()] });
  const first = (await f.request('start')).data.sessionId;
  f.advance(5000);
  const denied = await f.request('poll', { sessionId: first });
  assert.equal(denied.status, 400);
  assert.doesNotMatch(JSON.stringify(denied.data), /secrets/);
  assert.equal((await f.request('poll', { sessionId: first })).status, 410);
  const second = (await f.request('start')).data.sessionId;
  assert.equal((await f.request('cancel', { sessionId: second })).data.status, 'cancelled');
  assert.equal((await f.request('poll', { sessionId: second })).status, 410);
});

test('upstream redirects or malformed login destinations are never sent to the user', async t => {
  const f = await fixture(t, { replies: [{ ...device(), verification_uri: 'https://evil.example/login' }] });
  const response = await f.request('start');
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(response.data), /evil|device_secret/);
});

test('start attempts are bounded before issuing upstream requests', async t => {
  const f = await fixture(t, { replies: Array.from({ length: 5 }, device) });
  for (let i = 0; i < 5; i++) assert.equal((await f.request('start')).status, 200);
  assert.equal((await f.request('start')).status, 429);
  assert.equal(f.calls.length, 5);
  assert.equal((await f.request('start', {}, { 'X-Forwarded-For': '192.0.2.2' })).status, 429, 'untrusted proxy headers cannot bypass the limit');
});

test('an explicitly trusted proxy can rate-limit clients independently', async t => {
  const f = await fixture(t, { trustProxy: true, replies: Array.from({ length: 6 }, device) });
  for (let i = 0; i < 5; i++) assert.equal((await f.request('start', {}, { 'X-Forwarded-For': '192.0.2.1' })).status, 200);
  assert.equal((await f.request('start', {}, { 'X-Forwarded-For': '192.0.2.1' })).status, 429);
  assert.equal((await f.request('start', {}, { 'X-Forwarded-For': '192.0.2.2' })).status, 200);
});

test('concurrent polls and cancellation cannot deliver a token twice', async t => {
  let release;
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const pending = new Promise(resolve => { release = () => resolve(Response.json({ access_token: 'ghu_test', token_type: 'bearer' })); });
  const f = await fixture(t, { replies: [device(), () => { reached(); return pending; }] });
  const { sessionId } = (await f.request('start')).data;
  f.advance(5000);
  const first = f.request('poll', { sessionId });
  await entered;
  assert.equal((await f.request('poll', { sessionId })).data.status, 'pending');
  await f.request('cancel', { sessionId });
  release();
  assert.equal((await first).status, 410);
  assert.equal(f.calls.length, 2);
});
