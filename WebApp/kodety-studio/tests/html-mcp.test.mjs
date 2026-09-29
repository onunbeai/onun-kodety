import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createKodetyStudioServer } from '../public/server.mjs';
import { readHtmlMcpToolCatalog } from '../../../scripts/vite-html-mcp-tools.mjs';

const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-html-mcp-'));
await build({ entryPoints: [fileURLToPath(new URL('../src/html-mcp-controller.ts', import.meta.url)), fileURLToPath(new URL('../src/html-mcp-protocol.ts', import.meta.url))], outdir: scratch, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, bundle: true, logLevel: 'silent' });
const { createHtmlMcpControllerCore } = await import(pathToFileURL(path.join(scratch, 'html-mcp-controller.mjs')));
const { createHtmlMcpRequestHandler } = await import(pathToFileURL(path.join(scratch, 'html-mcp-protocol.mjs')));
after(() => rm(scratch, { recursive: true, force: true }));
const tools = await readHtmlMcpToolCatalog();
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(overrides = {}) {
  const server = createKodetyStudioServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const siteUrl = `http://127.0.0.1:${server.address().port}/studio/`;
  const data = new Map();
  const operations = [];
  let available = true;
  let save = async () => { operations.push('saved'); };
  let availabilityChecks = 0;
  const options = {
    projectId: crypto.randomUUID(), projectName: 'HTML test', siteUrl, tools,
    storage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) },
    assertAvailable: async () => { availabilityChecks++; if (!available) throw new Error('Host unavailable'); },
    available: () => true,
    invoke: async (name, args, identity) => { operations.push({ name, args, identity }); return { revision: '2' }; },
    saveProject: () => save(),
    ...overrides,
  };
  const controller = createHtmlMcpControllerCore(options);
  const request = (config, message, session, extraHeaders = {}) => fetch(config.mcpServers['kodety-html'].url, {
    method: 'POST', headers: { ...config.mcpServers['kodety-html'].headers, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...(session ? { 'MCP-Session-Id': session } : {}), ...extraHeaders }, body: JSON.stringify(message),
  });
  const initialize = async config => {
    const response = await request(config, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.serverInfo.name, 'kodety-html');
    const session = response.headers.get('mcp-session-id');
    assert.ok(session);
    return session;
  };
  return { controller, operations, options, data, siteUrl, request, initialize,
    setAvailable: value => { available = value; },
    setSave: callback => { save = callback; },
    availabilityChecks: () => availabilityChecks,
    async close() { controller.dispose(); await tick(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

test('HTML MCP uses the shared Agent schemas while omitting WordPress services and runtime-only tools', () => {
  assert.equal(tools.length, 15);
  assert.equal(tools.some(tool => /native_call|native_catalog|attachment_read|progress_update/.test(tool.name)), false);
  const mutation = tools.find(tool => tool.name === 'kodety_apply_changes');
  assert.deepEqual(mutation.inputSchema.properties.changes.items.properties.type.enum, ['replaceSelectionHtml', 'replacePageSource', 'replaceTextFile']);
  assert.equal(mutation.inputSchema.required.includes('expectedRevision'), true);
  assert.equal(tools.find(tool => tool.name === 'kodety_component_snapshot').inputSchema.properties.includeInteractions.type, 'boolean');
});

test('the real Node relay routes HTML JSON-RPC to the live Builder and only stores credential hashes', async () => {
  const f = await fixture();
  try {
    const config = JSON.parse(await f.controller.createConnection());
    const session = await f.initialize(config);
    const list = await f.request(config, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
    assert.equal((await list.json()).result.tools.length, 15);
    const read = await f.request(config, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kodety_editor_context', arguments: {} } }, session);
    assert.equal((await read.json()).result.isError, false);
    assert.equal(f.operations[0].name, 'kodety_editor_context');
    assert.equal(f.operations.includes('saved'), false);
    const token = config.mcpServers['kodety-html'].headers.Authorization.slice(7);
    assert.equal([...f.data.values()].some(value => value.includes(token)), false);
    assert.equal(JSON.stringify(f.controller.getSnapshot()).includes(token), false);
    assert.equal(JSON.stringify(f.controller.getSnapshot()).includes('digest'), false);
    assert.equal(f.controller.getSnapshot().status.enabled, true);
    assert.ok(f.availabilityChecks() >= 5);
  } finally { await f.close(); }
});

test('a mutation is acknowledged only after the mandatory folder save, with no automatic reexecution', async () => {
  const f = await fixture();
  try {
    const config = JSON.parse(await f.controller.createConnection());
    const session = await f.initialize(config);
    const entered = deferred(), saved = deferred();
    f.setSave(async () => { entered.resolve(); await saved.promise; f.operations.push('saved'); });
    let answered = false;
    const response = f.request(config, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kodety_apply_changes', arguments: { expectedRevision: '1', summary: 'Change heading', changes: [{ type: 'replacePageSource', pagePath: 'index.html', source: '<h1>New</h1>' }] } } }, session).then(result => { answered = true; return result; });
    await entered.promise;
    assert.equal(answered, false);
    assert.equal(f.operations.filter(item => item.name === 'kodety_apply_changes').length, 1);
    saved.resolve();
    assert.equal((await (await response).json()).result.isError, false);
    assert.equal(f.operations.at(-1), 'saved');
    f.setSave(async () => { throw new Error('Folder permission denied'); });
    const failed = await f.request(config, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kodety_apply_changes', arguments: {} } }, session);
    const result = (await failed.json()).result;
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Folder permission denied/);
    assert.equal(f.operations.filter(item => item.name === 'kodety_apply_changes').length, 2);
  } finally { await f.close(); }
});

test('disabled host, revoked client credentials and foreign origins cannot execute Builder tools', async () => {
  const f = await fixture();
  try {
    const first = JSON.parse(await f.controller.createConnection());
    const firstId = f.controller.getSnapshot().connections[0].id;
    const second = JSON.parse(await f.controller.createConnection());
    const session = await f.initialize(second);
    await f.controller.revokeConnection(firstId);
    assert.equal((await f.request(first, { jsonrpc: '2.0', id: 1, method: 'initialize' })).status, 401);
    assert.equal((await f.request(second, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, session, { Origin: 'https://foreign.test' })).status, 403);
    f.setAvailable(false);
    assert.equal((await f.request(second, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kodety_editor_context' } }, session)).status, 403);
    await assert.rejects(f.controller.createConnection(), /unavailable/);
    assert.equal(f.operations.length, 0);
    await f.controller.changeConnection('disable');
    assert.equal(f.controller.getSnapshot().connections.length, 0, 'revocation stays available when the host is disabled');
  } finally { await f.close(); }
});

test('MCP session identities isolate clients and reused request IDs after reconnecting', async () => {
  const f = await fixture();
  try {
    const config = JSON.parse(await f.controller.createConnection());
    const firstSession = await f.initialize(config);
    const secondSession = await f.initialize(config);
    for (const session of [firstSession, secondSession]) await (await f.request(config, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kodety_editor_context' } }, session)).json();
    assert.notEqual(f.operations[0].identity.requestId, f.operations[1].identity.requestId);
    const other = JSON.parse(await f.controller.createConnection());
    assert.equal((await f.request(other, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, firstSession)).status, 404);
    assert.equal((await f.request(config, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).status, 400);
  } finally { await f.close(); }
});

test('dispose rejects new access until an explicit mount start, and does not silently revive old calls', async () => {
  const f = await fixture();
  try {
    f.controller.dispose();
    await assert.rejects(f.controller.createConnection(), /closed/);
    assert.equal(f.controller.getSnapshot().connections.length, 0);
    f.controller.start();
    const config = JSON.parse(await f.controller.createConnection());
    await f.initialize(config);
    assert.equal(f.controller.getSnapshot().status.enabled, true);
  } finally { await f.close(); }
});

test('suspending an available connection disconnects immediately without erasing its records and refresh resumes it', async () => {
  const f = await fixture();
  try {
    const config = JSON.parse(await f.controller.createConnection());
    await f.initialize(config);
    const records = f.controller.getSnapshot().connections;
    f.setAvailable(false);
    await f.controller.suspend();
    assert.equal(f.controller.getSnapshot().status.enabled, false);
    assert.deepEqual(f.controller.getSnapshot().connections, records);
    assert.equal((await f.request(config, { jsonrpc: '2.0', id: 1, method: 'initialize' })).status, 503);
    f.setAvailable(true);
    await f.controller.refresh();
    await f.initialize(config);
    assert.equal(f.controller.getSnapshot().status.enabled, true);
    assert.equal(f.controller.getSnapshot().connections.length, 1);
  } finally { await f.close(); }
});

test('a pending availability check from an obsolete mount cannot create a connection after StrictMode restarts', async () => {
  const f = await fixture();
  try {
    const check = deferred();
    f.options.assertAvailable = async () => check.promise;
    const oldRequest = f.controller.createConnection();
    await tick();
    f.controller.dispose();
    f.controller.start();
    check.resolve();
    await assert.rejects(oldRequest, /closed/);
    assert.equal(f.controller.getSnapshot().connections.length, 0);
    f.options.assertAvailable = async () => undefined;
    const config = JSON.parse(await f.controller.createConnection());
    await f.initialize(config);
  } finally { await f.close(); }
});

test('a remount waits for delayed disconnect before reopening the relay with its saved token', async () => {
  const disconnectEntered = deferred(), releaseDisconnect = deferred();
  let delayDisconnect = true;
  const actions = [];
  const f = await fixture({ fetcher: async (url, init) => {
    const action = new URL(url).pathname.split('/').at(-1);
    actions.push(action);
    if (action === 'disconnect' && delayDisconnect) {
      disconnectEntered.resolve();
      await releaseDisconnect.promise;
    }
    return fetch(url, init);
  } });
  try {
    const config = JSON.parse(await f.controller.createConnection());
    await f.initialize(config);
    f.controller.dispose();
    await disconnectEntered.promise;
    assert.equal(f.controller.getSnapshot().loading, false);
    f.controller.start();
    const reconnect = f.controller.refresh();
    await tick();
    assert.equal(actions.filter(action => action === 'connect').length, 1, 'a replacement connect must wait until the old disconnect has completed');
    delayDisconnect = false;
    releaseDisconnect.resolve();
    await reconnect;
    await f.initialize(config);
    assert.equal(f.controller.getSnapshot().status.enabled, true);
    assert.equal(f.controller.getSnapshot().loading, false);
    assert.equal(actions.filter(action => action === 'connect').length, 2);
  } finally { releaseDisconnect.resolve(); await f.close(); }
});

test('missing browser storage and static-only hosting do not advertise a working MCP connection', async () => {
  const data = new Map();
  const controller = createHtmlMcpControllerCore({ projectId: crypto.randomUUID(), projectName: 'HTML', siteUrl: 'https://static.test/', tools,
    assertAvailable: async () => undefined, available: () => true, invoke: async () => assert.fail('no tools without a relay'), saveProject: async () => undefined,
    fetcher: async () => new Response('<html>Static fallback</html>', { status: 200 }),
    storage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) },
  });
  await assert.rejects(controller.createConnection());
  assert.equal(controller.getSnapshot().status.enabled, false);
  assert.equal(controller.getSnapshot().connections.length, 0);
  controller.dispose();
  const missing = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  try {
    assert.doesNotThrow(() => createHtmlMcpControllerCore({ projectId: crypto.randomUUID(), projectName: 'HTML', siteUrl: 'https://static.test/', tools, assertAvailable: async () => undefined, available: () => true, invoke: async () => null, saveProject: async () => undefined }).dispose());
  } finally { if (missing) Object.defineProperty(globalThis, 'localStorage', missing); else delete globalThis.localStorage; }
});

test('the protocol rejects WordPress CMS operations before applying partial HTML edits', async () => {
  const handler = createHtmlMcpRequestHandler({ projectId: 'project-test', siteUrl: 'https://studio.test/', tools, authorize: async () => 'connection', available: () => true, invoke: async () => assert.fail('CMS cannot reach the HTML bridge'), saveProject: async () => assert.fail('CMS cannot save HTML') });
  const headers = { Authorization: `Bearer ${'a'.repeat(43)}`, 'Content-Type': 'application/json' };
  const initialized = await handler(new Request('https://studio.test/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }));
  headers['MCP-Session-Id'] = initialized.headers.get('mcp-session-id');
  const response = await handler(new Request('https://studio.test/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kodety_apply_changes', arguments: { changes: [{ type: 'replacePageSource' }, { type: 'upsertCmsItem' }] } } }) }));
  assert.equal((await response.json()).error.code, -32602);
});
