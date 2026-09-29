import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ configFile: false, root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
  const { AgentTransport } = await server.ssrLoadModule('/lib/html-editor/agent-transport.ts');
  const calls = [];
  const transport = new AgentTransport({ agentUrl: 'https://site.test/wp-json/kodety/v1/agents', nonce: 'nonce', pageUrl: 'https://site.test/editor',
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ enabled: true, available: true, transport: 'remote', remote: { sessionPath: 'remote/session', gatewayUrl: 'https://private.example.test' } })); } });
  const config = await transport.request('config', { method: 'GET' });
  assert.equal(config.transport, 'local');
  assert.equal(config.remote, undefined);
  assert.equal(transport.remote, false);
  await transport.request('rpc', { body: { method: 'account/read' } });
  assert.ok(calls.every(({ url }) => new URL(url).origin === 'https://site.test'));
  const count = calls.length;
  await assert.rejects(transport.request('remote/session'), error => error.code === 'agent_remote_removed');
  await assert.rejects(transport.request('transport', { body: { transport: 'remote' } }), error => error.code === 'agent_remote_removed');
  assert.equal(calls.length, count, 'retired cloud actions must not contact any server');
  console.log('Legacy cloud configuration isolation passed.');
} finally { await server.close(); }
