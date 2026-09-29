import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createBrowserAgentNetworkFetch } from '../../../lib/html-editor/browser-agent-network-runtime.mjs';
const bundle = await build({ entryPoints: [new URL('../../../lib/html-editor/browser-agent-network.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'browser', format: 'esm' });
const { createBrowserAgentNetwork, fetchAgentNetwork, validAgentNetworkRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const url = 'https://chatgpt.com/backend-api/codex/responses';
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = { operation: 'responses', headers: { authorization: 'Bearer fixture' }, body: Buffer.from('{"stream":true}').toString('base64') };

test('WebContainer fetch crosses the bridge with binary bodies and streaming SSE in order', async () => {
  const sent = [];
  const network = createBrowserAgentNetworkFetch(message => sent.push(message));
  const responsePromise = network.fetch(url, { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-encoding': 'zstd' }, body: new Uint8Array([0, 127, 255]) });
  await tick();
  const message = sent[0];
  assert.equal(message.request.operation, 'responses');
  assert.equal(message.request.body, 'AH//');
  assert.equal(message.request.headers.authorization, 'Bearer fixture');
  network.receive({ requestId: message.requestId, action: 'headers', status: 200, headers: { 'content-type': 'text/event-stream' } });
  const response = await responsePromise;
  const reader = response.body.getReader();
  network.receive({ requestId: message.requestId, action: 'chunk', chunk: Buffer.from('data: first\n\n').toString('base64') });
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  network.receive({ requestId: message.requestId, action: 'chunk', chunk: Buffer.from('data: second\n\n').toString('base64') });
  network.receive({ requestId: message.requestId, action: 'end' });
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: second\n\n');
  assert.equal((await reader.read()).done, true);
  network.dispose();
});

test('provider cancellation stops the parent request and rejects the response stream', async () => {
  const messages = [];
  const network = createBrowserAgentNetworkFetch(message => messages.push(message));
  const controller = new AbortController();
  const pending = network.fetch(url, { method: 'POST', body: '{}', signal: controller.signal });
  await tick();
  network.receive({ requestId: messages[0].requestId, action: 'headers', status: 200 });
  const response = await pending;
  controller.abort();
  await assert.rejects(response.text(), { name: 'AbortError' });
  assert.equal(messages.at(-1).action, 'cancel');
  network.dispose();
});

test('runtime only permits exact provider destinations and reports sanitized network errors', async () => {
  const messages = [];
  const network = createBrowserAgentNetworkFetch(message => messages.push(message));
  for (const input of ['https://attacker.test/', url + '?token=private', 'http://chatgpt.com/backend-api/codex/responses']) {
    await assert.rejects(network.fetch(input, { method: 'POST' }), { code: 'agent_network' });
  }
  assert.equal(messages.length, 0);
  const response = network.fetch(url, { method: 'POST' });
  await tick();
  network.receive({ requestId: messages[0].requestId, action: 'error', message: 'PRIVATE_SECRET' });
  await assert.rejects(response, error => error.code === 'agent_network' && !error.message.includes('PRIVATE'));
  network.dispose();
});

test('renderer validates operations and license before fetching, then preserves upstream status and chunks', async t => {
  const original = { fetch: globalThis.fetch, document: globalThis.document, location: globalThis.location };
  t.after(() => Object.assign(globalThis, original));
  globalThis.document = { baseURI: 'https://studio.example.test/project/editor' };
  globalThis.location = new URL('https://studio.example.test/');
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://studio.example.test/__kodety_agent__/network');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['X-Kodety-Agent-Network'], '1');
    assert.deepEqual(JSON.parse(options.body), request);
    return new Response('denied fixture', { status: 401, headers: { 'X-Kodety-Agent-Relay': '1', 'Content-Type': 'application/json' } });
  };
  const sent = [];
  let allowed = false;
  const parent = createBrowserAgentNetwork({}, async message => sent.push(message), () => allowed);
  parent.receive({ action: 'request', requestId: 'denied', request });
  await tick();
  assert.equal(calls, 0);
  assert.deepEqual(sent.pop(), { action: 'error', requestId: 'denied' });
  allowed = true;
  parent.receive({ action: 'request', requestId: 'valid', request });
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(sent.map(message => message.action), ['headers', 'chunk', 'end']);
  assert.equal(sent[0].status, 401);
  assert.equal(Buffer.from(sent[1].chunk, 'base64').toString(), 'denied fixture');
  assert.equal(validAgentNetworkRequest({ ...request, operation: '__proto__' }), false);
  assert.equal(validAgentNetworkRequest({ ...request, body: 'not base64' }), false);
  await assert.rejects(fetchAgentNetwork(request, { url: 'https://foreign.example.test/network' }, new AbortController().signal), { code: 'agent_browser_network_unavailable' });
  globalThis.fetch = async () => new Response('<html>static fallback</html>');
  await assert.rejects(fetchAgentNetwork(request, {}, new AbortController().signal), { code: 'agent_browser_network_unavailable' });
  parent.dispose();
});
