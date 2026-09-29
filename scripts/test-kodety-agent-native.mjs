import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { createServer } from 'vite';
import { KODETY_NATIVE_DYNAMIC_TOOLS, loadNativeOperationCatalog } from '../Wordpress/kodety/agent-runtime/server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(await readFile(path.join(root, 'Wordpress/kodety/agent-runtime/native-operations.json'), 'utf8'));
const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'kodety-native-catalog-'));
try {
  const file = path.join(fixtureDirectory, 'native-operations.json');
  assert.throws(() => loadNativeOperationCatalog(file), error => error.code === 'KODETY_NATIVE_CATALOG_UNAVAILABLE');
  await writeFile(file, '{bad json');
  assert.throws(() => loadNativeOperationCatalog(file), /Reinstall the complete Kodety plugin/);
  await writeFile(file, JSON.stringify({ schemaVersion: 1, operations: [] }));
  assert.throws(() => loadNativeOperationCatalog(file), /missing or invalid/);
} finally { await rm(fixtureDirectory, { recursive: true, force: true }); }
assert.deepEqual(KODETY_NATIVE_DYNAMIC_TOOLS.find(tool => tool.name === 'kodety_native_call').inputSchema.properties.operation.enum,
  catalog.operations.map(operation => operation.name), 'Agent operation names come from the same shipped catalog as MCP');
const server = await createServer({ configFile: false, logLevel: 'silent', appType: 'custom',
  resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
try {
  const tools = await server.ssrLoadModule('/lib/html-editor/agent-native-tools.ts');
  const { invokeWordPressRemoteLocalization } = await server.ssrLoadModule('/Wordpress/editor/wordpress-agent-localization.ts');
  const config = { projectUrl: 'https://site.test/wp-json/kodety/v1/project', nonce: 'session-nonce' };
  let unavailableLocalizationRequests = 0;
  globalThis.fetch = async () => { unavailableLocalizationRequests++; throw new Error('must not reach transport'); };
  await assert.rejects(invokeWordPressRemoteLocalization('kodety_apply_localization_settings', { action: 'add' }, config,
    { assertCurrent() {}, beforeNativeOperation() { throw new Error('must not save or prepare an unavailable feature'); } }),
  error => error.code === 'kodety_localization_unavailable');
  assert.equal(unavailableLocalizationRequests, 0, 'disabled localization cannot bypass its feature boundary through generic project delta');
  globalThis.fetch = originalFetch;
  assert.equal(tools.agentNativeEndpoint(config, 'tools'), 'https://site.test/wp-json/kodety/v1/automation/tools');
  assert.equal(new URL(tools.agentNativeEndpoint({ ...config, projectUrl: 'https://site.test/?rest_route=/kodety/v1/project' }, 'call')).searchParams.get('rest_route'), '/kodety/v1/automation/call');
  assert.ok(tools.filterAgentNativeCatalog(catalog, 'cms').operations.every(operation => operation.name.startsWith('cms')));
  assert.deepEqual(tools.mergeAgentNativeSettings({ model: 'old', tone: 'old' }, { model: 'old', tone: 'local' }, { model: 'remote', tone: 'remote' }), { model: 'remote', tone: 'local' });
  let writes = 0;
  let current = true;
  let readOnly = false;
  let before = () => {};
  let after = () => {};
  let implementation = () => Response.json({ id: 12, revision: 'item-2' });
  const options = { config, assertCurrent() { assert.ok(current, 'owner changed'); }, readOnly: () => readOnly,
    beforeNativeOperation: (...args) => before(...args), afterNativeOperation: (...args) => after(...args),
    fetcher: async (url, init) => {
      assert.equal(init.headers['X-WP-Nonce'], config.nonce);
      if (url.endsWith('/tools')) return Response.json(catalog);
      writes++;
      const body = JSON.parse(init.body);
      assert.equal(body.operation, 'cms_create_item');
      assert.equal(body.arguments.expectedRevision, 'schema-1');
      return implementation();
    },
  };
  const args = { operation: 'cms_create_item', arguments: { post_type: 'post', expectedRevision: 'schema-1', values: { title: 'Article' } } };
  readOnly = true;
  await assert.rejects(tools.invokeAgentNativeTool('kodety_native_call', args, options), /somente leitura/);
  assert.equal(writes, 0);
  await tools.invokeAgentNativeTool('kodety_native_catalog', {}, options);
  readOnly = false;
  before = () => { readOnly = true; };
  await assert.rejects(tools.invokeAgentNativeTool('kodety_native_call', args, options), /somente leitura/);
  assert.equal(writes, 0, 'permissions are rechecked after queued preparation');
  readOnly = false;
  before = () => { current = false; };
  await assert.rejects(tools.invokeAgentNativeTool('kodety_native_call', args, options), /owner changed/);
  assert.equal(writes, 0);
  current = true;
  before = () => {};
  implementation = () => Response.json({ code: 'cms_revision_conflict', message: 'Revision changed', data: { currentRevision: 'schema-2' } }, { status: 409 });
  await assert.rejects(tools.invokeAgentNativeTool('kodety_native_call', args, options), error => error.code === 'cms_revision_conflict'
    && error.status === 409 && error.retryable === true && error.data.currentRevision === 'schema-2');
  assert.equal(writes, 1, 'a revision error is returned without replaying the mutation');
  implementation = () => { throw new TypeError('ACK lost'); };
  await assert.rejects(tools.invokeAgentNativeTool('kodety_native_call', args, options), error => error.code === 'KODETY_NATIVE_WRITE_UNCERTAIN' && error.retryable === false);
  assert.equal(writes, 2, 'ambiguous writes are never automatically repeated');
  implementation = () => ({ ok: true, json: () => new Promise(() => {}) });
  await assert.rejects(tools.invokeAgentNativeTool('kodety_native_call', args, { ...options, timeoutMs: 10 }), error => error.code === 'KODETY_NATIVE_WRITE_UNCERTAIN');
  assert.equal(writes, 3, 'the write deadline covers response body parsing');
  await assert.rejects(tools.readAgentNativeCatalog(config, async () => new Promise(() => {}), { timeoutMs: 10 }), error => error.name === 'TimeoutError');
  implementation = () => Response.json({ id: 12, revision: 'item-2' });
  after = () => { throw new Error('refresh failed'); };
  const committed = await tools.invokeAgentNativeTool('kodety_native_call', args, options);
  assert.equal(committed.committed, true);
  assert.equal(committed.result.id, 12);
  assert.equal(committed.refreshError, 'refresh failed');
  after = () => { throw Object.assign(new Error('Conflito externo preservado'), { data: { recoveredPaths: ['.incode/recovery/project.json'] } }); };
  const recovered = await tools.invokeAgentNativeTool('kodety_native_call', args, options);
  assert.equal(recovered.committed, true);
  assert.deepEqual(recovered.refreshDetails.recoveredPaths, ['.incode/recovery/project.json']);

  globalThis.window = Object.assign(new EventTarget(), { location: new URL('https://site.test/kodety/cms/'), kodetyWordPress: config });
  for (const interruption of ['abort', 'timeout']) {
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const installs = [];
    const events = [];
    const onEvent = () => events.push('changed');
    window.addEventListener(tools.AGENT_NATIVE_CHANGED_EVENT, onEvent);
    after = async (_operation, _result, context) => {
      entered();
      await blocked;
      context.assertCurrent();
      installs.push('stale-install-or-save');
    };
    const controller = new AbortController();
    const pending = tools.invokeAgentNativeTool('kodety_native_call', args, { ...options, signal: controller.signal, timeoutMs: interruption === 'timeout' ? 20 : 1000 });
    await started;
    if (interruption === 'abort') controller.abort();
    const interrupted = await pending;
    assert.equal(interrupted.committed, true);
    after = async (_operation, _result, context) => { context.assertCurrent(); installs.push('next'); };
    await tools.invokeAgentNativeTool('kodety_native_call', args, options);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(installs, ['next'], `${interruption} prevents stale callbacks from installing or saving after a following operation`);
    assert.deepEqual(events, ['changed'], `${interruption} prevents a late success event`);
    window.removeEventListener(tools.AGENT_NATIVE_CHANGED_EVENT, onEvent);
  }
  let releasePreparation;
  const preparation = new Promise(resolve => { releasePreparation = resolve; });
  let preparationWrites = 0;
  await assert.rejects(invokeWordPressRemoteLocalization('kodety_apply_localization_settings', {}, { ...config, localizationSaveUrl: 'https://site.test/localization' }, {
    timeoutMs: 10, assertCurrent() {},
    async beforeNativeOperation(_operation, context) { await preparation; context.assertCurrent(); preparationWrites++; },
  }), error => error.name === 'TimeoutError');
  releasePreparation();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(preparationWrites, 0, 'offscreen localization propagates the phase deadline into delayed lifecycle work');
  const { invokeHtmlAgentEditorTool, useHtmlAgentEditorBridgeStore } = await server.ssrLoadModule('/stores/useHtmlAgentEditorBridgeStore.ts');
  const store = useHtmlAgentEditorBridgeStore.getState();
  let complete;
  let invocations = 0;
  store.publish('cms-a', { readOnly: false, async invoke(tool) {
    invocations++;
    if (tool === 'slow') await new Promise(resolve => { complete = resolve; });
    if (tool === 'kodety_editor_context') return { editor: { workspace: 'cms', nativePanel: { required: true, tools: ['kodety_panel_snapshot'] } } };
    return { result: invocations };
  } });
  const meta = { requestId: 'request', callId: 'call', threadId: 'thread', turnId: 'turn' };
  const one = invokeHtmlAgentEditorTool('slow', {}, meta);
  const repeated = invokeHtmlAgentEditorTool('slow', {}, meta);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(invocations, 1, 'duplicate delivery joins the pending call');
  complete();
  assert.deepEqual(await one, await repeated);
  await assert.rejects(invokeHtmlAgentEditorTool('different', {}, meta), /outra operação/);
  const context = await invokeHtmlAgentEditorTool('kodety_editor_context', {}, { ...meta, callId: 'context' });
  assert.ok(context.editor.nativePanel.tools.includes('kodety_native_call'));
  assert.equal(context.nativeOperations.workspaceRequired, false);
  const blocked = invokeHtmlAgentEditorTool('slow', {}, { ...meta, callId: 'next' });
  await new Promise(resolve => setImmediate(resolve));
  const stale = invokeHtmlAgentEditorTool('never', {}, { ...meta, callId: 'stale' });
  const staleAssertion = assert.rejects(stale, /área do agente mudou/);
  store.publish('cms-b', { invoke() { throw new Error('must not run'); } });
  complete();
  await blocked;
  await staleAssertion;
  let nativeCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/tools')) return Response.json(catalog);
    nativeCalls++;
    assert.equal(JSON.parse(init.body).operation, 'cms_create_item');
    return Response.json({ id: 22 });
  };
  store.publish('cms-native', { invoke() { throw new Error('native tools bypass visual controls'); } });
  const nativeMeta = { ...meta, callId: 'native' };
  assert.deepEqual(await Promise.all([invokeHtmlAgentEditorTool('kodety_native_call', args, nativeMeta), invokeHtmlAgentEditorTool('kodety_native_call', args, nativeMeta)]), [{ id: 22 }, { id: 22 }]);
  assert.equal(nativeCalls, 1);
  store.resetOwner('cms-native');
  console.log('Agent native tools: shared catalog, scopes, revisions, read-only, owner fences, pending deduplication and settings draft merges passed.');
} finally {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
  await server.close();
}
