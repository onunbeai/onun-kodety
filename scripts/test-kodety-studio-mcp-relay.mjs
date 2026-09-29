import assert from 'node:assert/strict';
import { createKodetyStudioServer } from '../WebApp/kodety-studio/public/server.mjs';

const projectId = '04cc2286-1383-46a5-8055-8dac70d9';
const server = createKodetyStudioServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const projectBase = `${origin}/__kodety_mcp__/v1/projects/${projectId}/`;

  const connectionResponse = await fetch(`${projectBase}bridge/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(connectionResponse.status, 200);
  const connection = await connectionResponse.json();
  assert.match(connection.bridgeToken, /^[A-Za-z0-9_-]{32,96}$/);
  assert.equal(connection.mcpUrl, `${projectBase}mcp`);

  const jsonRpcRequest = {
    jsonrpc: '2.0',
    id: 7,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  };
  const externalRequest = fetch(`${projectBase}mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer kodety_test',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify(jsonRpcRequest),
  });

  const pollResponse = await fetch(`${projectBase}bridge/poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bridgeToken: connection.bridgeToken }),
  });
  assert.equal(pollResponse.status, 200);
  const envelope = await pollResponse.json();
  assert.equal(envelope.path, '/wp-json/kodety/v1/mcp');
  assert.equal(envelope.method, 'POST');
  assert.equal(envelope.headers.authorization, 'Bearer kodety_test');
  assert.equal(
    Buffer.from(envelope.bodyBase64, 'base64').toString('utf8'),
    JSON.stringify(jsonRpcRequest),
  );

  const jsonRpcResponse = { jsonrpc: '2.0', id: 7, result: { serverInfo: { name: 'kodety-wordpress' } } };
  const bridgeResponse = await fetch(`${projectBase}bridge/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bridgeToken: connection.bridgeToken,
      requestId: envelope.requestId,
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'must-not-leak=1' },
      bodyBase64: Buffer.from(JSON.stringify(jsonRpcResponse)).toString('base64'),
    }),
  });
  assert.equal(bridgeResponse.status, 202);

  const externalResponse = await externalRequest;
  assert.equal(externalResponse.status, 200);
  assert.match(externalResponse.headers.get('content-type') || '', /application\/json/);
  assert.equal(externalResponse.headers.get('set-cookie'), null);
  assert.deepEqual(await externalResponse.json(), jsonRpcResponse);

  const invalidPoll = await fetch(`${projectBase}bridge/poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bridgeToken: 'x'.repeat(43) }),
  });
  assert.equal(invalidPoll.status, 401);

  const disconnectResponse = await fetch(`${projectBase}bridge/disconnect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bridgeToken: connection.bridgeToken }),
  });
  assert.equal(disconnectResponse.status, 204);

  const offlineResponse = await fetch(`${projectBase}mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(jsonRpcRequest),
  });
  assert.equal(offlineResponse.status, 503);
  assert.match(JSON.stringify(await offlineResponse.json()), /não está aberto no Kodety Studio/);

  process.stdout.write('Kodety Studio MCP relay: public request, bearer forwarding, response filtering and offline state verified.\n');
} finally {
  await new Promise(resolve => server.close(resolve));
}
