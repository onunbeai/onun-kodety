import test from 'node:test';
import assert from 'node:assert/strict';
import { zstdDecompressSync } from 'node:zlib';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { createBrowserAgentRuntime } from '../../../lib/html-editor/browser-agent-runtime.mjs';

const catalog = createModels();
catalog.setProvider(openaiCodexProvider());
const model = catalog.getModel('openai-codex', 'gpt-5.6-terra');
const token = `fixture.${Buffer.from(JSON.stringify({ email: 'fixture@example.test', 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_plan_type: 'plus' } })).toString('base64url')}.signature`;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(read, predicate = Boolean) {
  let value;
  for (let n = 0; n < 150; n++) { value = await read(); if (predicate(value)) return value; await tick(); }
  assert.fail(`Expected runtime state did not arrive: ${JSON.stringify(value)}`);
}
function sse(output) {
  const fn = output.type === 'function_call';
  const response = { id: 'resp_fixture', status: 'completed', output: [output], usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [
    { type: 'response.created', response: { id: response.id, status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...output, ...(fn ? { arguments: '' } : { content: [] }) } },
    ...(fn ? [
      { type: 'response.function_call_arguments.delta', output_index: 0, item_id: output.id, delta: output.arguments },
      { type: 'response.function_call_arguments.done', output_index: 0, item_id: output.id, arguments: output.arguments },
    ] : [
      { type: 'response.content_part.added', output_index: 0, item_id: output.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, item_id: output.id, content_index: 0, delta: output.content[0].text },
      { type: 'response.output_text.done', output_index: 0, item_id: output.id, content_index: 0, text: output.content[0].text },
    ]),
    { type: 'response.output_item.done', output_index: 0, item: output },
    { type: 'response.completed', response },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
const toolOutput = { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'kodety_apply_changes', arguments: '{"revision":"r1"}', status: 'completed' };
const textOutput = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Atualizei o título.', annotations: [] }] };

function fixture({ tools = true, blockedStream = false, providerFailure = false } = {}) {
  let finishLogin;
  let callCount = 0;
  let authenticated = false;
  const requests = [];
  const snapshots = [];
  const models = {
    getModels: () => [model],
    async login(provider, method, interaction) {
      assert.equal(provider, 'openai-codex'); assert.equal(method, 'oauth');
      assert.equal(await interaction.prompt({ type: 'select', options: [{ id: 'device_code' }] }), 'device_code');
      interaction.notify({ type: 'device_code', userCode: 'FIXTURE-CODE', verificationUri: 'https://auth.openai.com/codex/device', intervalSeconds: 5, expiresInSeconds: 900 });
      await new Promise((resolve, reject) => {
        finishLogin = resolve;
        interaction.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
      });
      interaction.signal.throwIfAborted();
      authenticated = true;
      return { type: 'oauth', access: token, refresh: 'fixture-refresh-secret', expires: Date.now() + 3600000 };
    },
    async logout() { authenticated = false; },
    streamSimple(selected, context, options) {
      assert.equal(authenticated, true);
      assert.equal(options.transport, 'sse');
      const stream = streamSimple(selected, context, { ...options, apiKey: token, fetch: async (url, init) => {
        assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
        const body = JSON.parse(init.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(init.body).toString() : init.body);
        requests.push(body);
        callCount++;
        if (providerFailure) return new Response(JSON.stringify({ error: { message: `fixture failure ${token} fixture-refresh-secret` } }), { status: 400 });
        if (blockedStream) await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
        return sse(tools && callCount === 1 ? toolOutput : textOutput);
      } });
      return stream;
    },
  };
  const runtime = createBrowserAgentRuntime({ projectId: 'fixture-project', licensed: true, readOnly: false, dependencies: { models, Agent, getSupportedThinkingLevels }, tools: [{ name: 'kodety_apply_changes', description: 'Apply a draft change', inputSchema: { type: 'object', properties: { revision: { type: 'string' } }, required: ['revision'] } }], onSnapshot: value => snapshots.push(value) });
  const rpc = (method, params = {}) => runtime.request('rpc', { body: { method, params } });
  return { runtime, rpc, snapshots, requests, finishLogin: () => finishLogin(), callCount: () => callCount, authenticated: () => authenticated };
}
async function signedIn(f) {
  const instructions = await f.rpc('account/login/start');
  assert.equal(instructions.userCode, 'FIXTURE-CODE');
  assert.equal((await f.rpc('account/read')).account, null);
  f.finishLogin();
  await until(() => f.rpc('account/read'), value => value.account);
  return instructions;
}
async function newThread(f) { return (await f.rpc('thread/start', { model: model.id })).thread.id; }

test('device login returns instructions before authentication; cancel, retry and logout keep credentials private', async () => {
  const f = fixture();
  try {
    const [first, duplicate] = await Promise.all([f.rpc('account/login/start'), f.rpc('account/login/start')]);
    assert.equal(first.loginId, duplicate.loginId);
    assert.equal((await f.rpc('account/read')).account, null);
    assert.equal(JSON.stringify(f.runtime.snapshot()).includes('FIXTURE-CODE'), false);
    await f.rpc('account/login/cancel', { loginId: first.loginId });
    await signedIn(f);
    const account = (await f.rpc('account/read')).account;
    assert.equal(account.email, 'fixture@example.test'); assert.equal(account.planType, 'plus');
    assert.equal(JSON.stringify(account).includes(token), false);
    await f.rpc('account/logout');
    assert.equal((await f.rpc('account/read')).account, null);
    assert.equal(f.authenticated(), false);
  } finally { await f.runtime.dispose(); }
});

test('real Pi SSE parser and Agent loop execute a Builder tool, wait for acknowledgement, then continue streaming', async () => {
  const f = fixture();
  try {
    await signedIn(f);
    const threadId = await newThread(f);
    const start = await f.rpc('turn/start', { threadId, model: model.id, prompt: 'Atualize o título', context: { selection: { id: 'title' } } });
    assert.equal(start.turn.status, 'inProgress');
    const batch = await until(() => f.runtime.request('events', { body: { threadId, cursor: 0 } }), value => value.pending.length === 1);
    assert.equal(f.callCount(), 1);
    const pending = batch.pending[0];
    assert.equal(pending.params.tool, 'kodety_apply_changes');
    assert.deepEqual(pending.params.arguments, { revision: 'r1' });
    await assert.rejects(f.runtime.request('respond', { body: { requestId: 'foreign-request', result: {} } }), error => error.status === 409);
    const body = { requestId: pending.requestId, result: { success: true, contentItems: [{ type: 'inputText', text: '{"saved":true}' }] } };
    assert.deepEqual(await f.runtime.request('respond', { body }), { ok: true });
    assert.deepEqual(await f.runtime.request('respond', { body }), { ok: true, alreadyResolved: true });
    const finished = await until(() => f.rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status !== 'inProgress');
    assert.equal(finished.thread.turns.at(-1).status, 'completed');
    assert.equal(f.callCount(), 2);
    assert.equal(f.requests[1].input.some(item => item.type === 'function_call_output' && item.output.includes('saved')), true);
    const finalEvents = await f.runtime.request('events', { body: { threadId, cursor: 0 } });
    assert.equal(finalEvents.events.some(event => event.message.method === 'item/agentMessage/delta' && event.message.params.delta === 'Atualizei o título.'), true);
    assert.equal(finished.thread.turns.at(-1).items.some(item => item.type === 'agentMessage' && item.text === 'Atualizei o título.'), true);
    const saved = JSON.stringify(f.runtime.snapshot());
    for (const secret of [token, 'fixture-refresh-secret', 'FIXTURE-CODE']) assert.equal(saved.includes(secret), false);
    assert.ok(f.snapshots.length >= 3);
  } finally { await f.runtime.dispose(); }
});

test('interrupt rejects pending tools, never continues a cancelled turn, and a duplicate turn/start is refused', async () => {
  const f = fixture();
  try {
    await signedIn(f);
    const threadId = await newThread(f);
    const started = await f.rpc('turn/start', { threadId, prompt: 'Atualize' });
    const batch = await until(() => f.runtime.request('events', { body: { threadId } }), value => value.pending.length);
    await assert.rejects(f.rpc('turn/start', { threadId, prompt: 'Duplicado' }), error => error.code === 'agent_turn_running');
    await f.rpc('turn/interrupt', { threadId, turnId: started.turn.id });
    const finished = await until(() => f.rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status !== 'inProgress');
    assert.equal(finished.thread.turns.at(-1).status, 'interrupted');
    assert.equal(f.callCount(), 1);
    assert.equal((await f.runtime.request('events', { body: { threadId } })).pending.length, 0);
    assert.deepEqual(await f.runtime.request('respond', { body: { requestId: batch.pending[0].requestId, result: {} } }), { ok: true, alreadyResolved: true });
  } finally { await f.runtime.dispose(); }
});

test('legacy product license does not gate the Agent while read-only policy still interrupts writes', async () => {
  const f = fixture();
  try {
    f.runtime.setPolicy({ licensed: false });
    assert.equal((await f.runtime.request('config', { method: 'GET' })).licenseRequired, false);
    f.runtime.setPolicy({ licensed: true }); await signedIn(f);
    const threadId = await newThread(f);
    await f.rpc('turn/start', { threadId, prompt: 'Atualize' });
    await until(() => f.runtime.request('events', { body: { threadId } }), value => value.pending.length);
    f.runtime.setPolicy({ readOnly: true });
    await assert.rejects(f.rpc('turn/start', { threadId, prompt: 'Atualize' }), error => error.code === 'agent_read_only');
    await until(() => f.rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status === 'interrupted');
    assert.equal(f.callCount(), 1);
    f.runtime.setPolicy({ licensed: false });
    assert.equal((await f.rpc('thread/read', { threadId })).thread.id, threadId);
    await f.rpc('account/logout');
    assert.equal(f.authenticated(), false);
  } finally { await f.runtime.dispose(); }
});

test('private history roundtrips without account state, rejects a different project and never replays interrupted turns', async () => {
  const f = fixture({ tools: false });
  const target = fixture({ tools: false });
  try {
    await signedIn(f);
    const threadId = await newThread(f);
    await f.rpc('turn/start', { threadId, prompt: 'Olá' });
    await until(() => f.rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status === 'completed');
    const snapshot = f.runtime.snapshot();
    assert.throws(() => target.runtime.restore({ ...snapshot, projectId: 'foreign-project' }));
    snapshot.threads[0].turns[0].status = 'inProgress';
    target.runtime.restore(snapshot);
    assert.equal((await target.rpc('account/read')).account, null);
    assert.equal((await target.rpc('thread/read', { threadId })).thread.turns[0].status, 'interrupted');
    assert.equal(target.callCount(), 0);
    assert.equal((await target.rpc('thread/list')).data[0].id, threadId);
  } finally { await f.runtime.dispose(); await target.runtime.dispose(); }
});

test('dispose cancels an in-flight SSE request and closes this runtime', async () => {
  const f = fixture({ blockedStream: true });
  await signedIn(f);
  const threadId = await newThread(f);
  await f.rpc('turn/start', { threadId, prompt: 'Olá' });
  await until(async () => f.callCount());
  await f.runtime.dispose();
  await assert.rejects(f.rpc('thread/list'), error => error.code === 'agent_closed');
  assert.equal(f.authenticated(), false);
});

test('provider response bodies and diagnostics never leak into public errors or persisted history', async () => {
  const f = fixture({ providerFailure: true });
  try {
    await signedIn(f);
    const threadId = await newThread(f);
    await f.rpc('turn/start', { threadId, prompt: 'Olá' });
    const finished = await until(() => f.rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status === 'failed');
    assert.equal(finished.thread.turns.at(-1).error.code, 'agent_browser_failed');
    const outputs = JSON.stringify([f.runtime.snapshot(), f.snapshots, await f.runtime.request('events', { body: { threadId } })]);
    for (const secret of [token, 'fixture-refresh-secret', 'FIXTURE-CODE']) assert.equal(outputs.includes(secret), false);
  } finally { await f.runtime.dispose(); }
});

test('restoring a tool awaiting acknowledgement records an interruption and does not execute it', async () => {
  const f = fixture();
  const target = fixture();
  try {
    await signedIn(f);
    const threadId = await newThread(f);
    await f.rpc('turn/start', { threadId, prompt: 'Atualize' });
    await until(() => f.runtime.request('events', { body: { threadId } }), value => value.pending.length);
    target.runtime.restore(f.runtime.snapshot());
    const saved = target.runtime.snapshot();
    const toolResult = saved.threads[0].messages.find(message => message.role === 'toolResult');
    assert.equal(toolResult.isError, true);
    assert.match(toolResult.content[0].text, /Do not assume it succeeded or replay it/);
    assert.equal(target.callCount(), 0);
    assert.equal(saved.threads[0].turns[0].status, 'interrupted');
  } finally { await f.runtime.dispose(); await target.runtime.dispose(); }
});

test('default models use explicit compatible preferences and never the last catalog entry', async () => {
  const expensive = { ...model, id: 'gpt-6-astra', name: 'Astra' };
  const compatible = { ...model, id: 'gpt-5.6-luna', name: 'Luna' };
  const runtime = createBrowserAgentRuntime({ projectId: 'default-model-test', licensed: true,
    dependencies: { models: { getModels: () => [compatible, expensive], async logout() {} }, Agent, getSupportedThinkingLevels } });
  try {
    assert.equal((await runtime.request('config')).defaultModel, 'gpt-5.6-luna');
    const listed = await runtime.request('rpc', { body: { method: 'model/list' } });
    assert.equal(listed.data.find(value => value.isDefault).model, 'gpt-5.6-luna');
  } finally { await runtime.dispose(); }
  const unknown = createBrowserAgentRuntime({ projectId: 'unknown-model-test', licensed: true,
    dependencies: { models: { getModels: () => [{ ...model, id: 'gpt-5.4-mini' }], async logout() {} }, Agent, getSupportedThinkingLevels } });
  try {
    assert.equal((await unknown.request('config')).defaultModel, '');
    await assert.rejects(unknown.request('rpc', { body: { method: 'thread/start' } }), error => error.code === 'agent_model_unavailable');
    await assert.rejects(unknown.request('rpc', { body: { method: 'thread/start', params: { model: 'gpt-5.4-mini' } } }), error => error.code === 'agent_model_unavailable');
  } finally { await unknown.dispose(); }
});

test('browser model menu exposes only Astra, Sol, Terra, Luna and GPT-5.5 in that order', async () => {
  const runtime = createBrowserAgentRuntime({ projectId: 'model-menu-test', licensed: true });
  try {
    const { data } = await runtime.request('rpc', { body: { method: 'model/list' } });
    assert.deepEqual(data.map(value => value.displayName), ['Astra', 'Sol', 'Terra', 'Luna', 'GPT-5.5']);
    assert.equal(data.find(value => value.isDefault).model, 'gpt-5.6-sol');
    await runtime.request('config', { body: { model: 'gpt-5.6-terra' } });
    assert.equal((await runtime.request('config')).defaultModel, 'gpt-5.6-terra', 'explicit choices must survive the new Sol default');
    for (const value of data) {
      assert.ok((await runtime.request('rpc', { body: { method: 'thread/start', params: { model: value.model } } })).thread.id);
    }
    await assert.rejects(runtime.request('rpc', { body: { method: 'thread/start', params: { model: 'gpt-5.3-codex-spark' } } }), { code: 'agent_model_unavailable' });
  } finally { await runtime.dispose(); }
});

test('native Codex and browser Agent use the same Builder instructions', async () => {
  const { KODETY_BUILDER_INSTRUCTIONS } = await import('../../../Wordpress/kodety/agent-runtime/builder-instructions.mjs');
  const { CodexClient } = await import('../../../Wordpress/kodety/agent-runtime/server.mjs');
  const nativePrompt = CodexClient.prototype.developerInstructions.call({ runtime: { readOnly: false } });
  const f = fixture({ tools: false });
  try {
    await signedIn(f);
    const threadId = await newThread(f);
    await f.rpc('turn/start', { threadId, prompt: 'Confira a seleção.' });
    await until(() => f.rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status !== 'inProgress');
    const browserPrompt = f.requests[0].instructions;
    for (const instruction of KODETY_BUILDER_INSTRUCTIONS) {
      assert.ok(nativePrompt.includes(instruction));
      assert.ok(browserPrompt.includes(instruction));
    }
    assert.match(browserPrompt, /nativePanel.required/);
    assert.match(browserPrompt, /kodety_apply_localization_translations/);
    assert.match(browserPrompt, /kodety_progress_update/);
    assert.match(browserPrompt, /Images attached to the turn/);
    assert.match(browserPrompt, /kodety_attachment_read/);
    assert.doesNotMatch(browserPrompt, /Figma capabilities come from/);
  } finally { await f.runtime.dispose(); }
});
