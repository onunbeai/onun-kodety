import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { buildBrowserAgentRuntime } from '../../../scripts/vite-browser-agent.mjs';

const source = await readFile(new URL('../../../scripts/vite-browser-agent.mjs', import.meta.url), 'utf8');
const errorStart = source.indexOf('const publicErrors = ');
const errorEnd = source.indexOf('const lines = ', errorStart);
const publicError = new Function(source.slice(errorStart, errorEnd) + '\nreturn publicError;')();

test('bootstrap errors never relay provider bodies, tokens, or diagnostic payloads', () => {
  for (const code of [undefined, 'ERR_UNKNOWN', '__proto__', 'agent_auth_expired', 'usage_limit_reached']) {
    const error = publicError({ code, message: 'PRIVATE_ACCESS_TOKEN', payload: { refresh: 'PRIVATE_REFRESH_TOKEN' }, status: 401 });
    assert.equal(typeof error.message, 'string');
    assert.equal(error.status, 401);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_|refresh|payload/);
  }
});

test('the bundled private credential bridge restores during init and commits explicit logout before replying', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kodety-browser-agent-auth-'));
  const filename = path.join(directory, 'runtime.mjs');
  const preload = path.join(directory, 'offline.mjs');
  await writeFile(filename, await buildBrowserAgentRuntime());
  await writeFile(preload, 'globalThis.fetch=async()=>{throw new Error("Unexpected network access")};');
  const child = spawn(process.execPath, ['--import', preload, filename], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  const waits = new Map();
  const ready = new Promise(resolve => waits.set('ready', resolve));
  const actions = [];
  const publicMessages = [];
  const access = 'fixture.' + Buffer.from(JSON.stringify({ email: 'restored@example.test' })).toString('base64url') + '.signature';
  let saved = { type: 'oauth', access, refresh: 'PRIVATE-REFRESH', expires: Date.now() + 3600000 };
  let held = false;
  let sequence = 0;
  const write = (id, suffix, body) => child.stdin.write(JSON.stringify({ id, suffix, options: { body }, policy: { licensed: true } }) + '\n');
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.kind === 'credentials') {
      actions.push(message.action);
      const response = { requestId: message.requestId, ok: true };
      if (message.action === 'read') response.credentials = saved;
      else if (message.action === 'acquire') { assert.equal(held, false); held = true; response.lockId = 'fixture-lock'; response.credentials = saved; }
      else if (message.action === 'release') { assert.equal(message.lockId, 'fixture-lock'); held = false; }
      else if (message.action === 'write') { assert.equal(held, true); assert.equal(message.lockId, 'fixture-lock'); saved = message.credentials; }
      else assert.fail('Unexpected credential action');
      write(`storage-${sequence++}`, '__credentials/ack', response);
      return;
    }
    publicMessages.push(message);
    waits.get(message.kind === 'ready' ? 'ready' : message.id)?.(message);
  });
  const send = (id, suffix, body) => { const result = new Promise(resolve => waits.set(id, resolve)); write(id, suffix, body); return result; };
  const exit = new Promise(resolve => child.on('exit', resolve));
  await ready;
  assert.equal((await send('init', '__init', { projectId: 'restored-project', credentials: saved, credentialPersistence: true })).result.ready, true);
  const account = await send('account', 'rpc', { method: 'account/read', params: {} });
  assert.equal(account.result.account.email, 'restored@example.test');
  assert.deepEqual((await send('logout', 'rpc', { method: 'account/logout', params: {} })).result, {});
  assert.equal(saved, null);
  assert.equal(held, false);
  assert.ok(actions.includes('acquire') && actions.includes('write') && actions.includes('release'));
  assert.doesNotMatch(JSON.stringify(publicMessages), /PRIVATE-REFRESH|fixture\.[A-Za-z0-9_-]+\.signature/);
  child.stdin.end();
  assert.equal(await exit, 0);
});

test('the real bundle runs device OAuth, a Builder tool and an SSE continuation using fake credentials only', { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kodety-browser-agent-bootstrap-'));
  const filename = path.join(directory, 'runtime.mjs');
  const preload = path.join(directory, 'test-fetch.mjs');
  const artifact = await buildBrowserAgentRuntime();
  await writeFile(filename, artifact);
  // Exercise the bundled provider and OAuth loaders using local deterministic
  // responses. This subprocess cannot reach a real account or external network.
  await writeFile(preload, `
    import { zstdDecompressSync } from 'node:zlib';
    const access = 'fixture.' + Buffer.from(JSON.stringify({ email: 'fixture@example.test', 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_plan_type: 'plus' } })).toString('base64url') + '.signature';
    let devices = 0;
    let inference = 0;
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
      return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
    }
    globalThis.fetch = async (url, init) => {
      if (url === 'https://auth.openai.com/api/accounts/deviceauth/usercode') { devices++; return Response.json({ device_auth_id: 'PRIVATE_DEVICE_ID', user_code: 'TEST-1234', interval: 60 }); }
      if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') {
        if (devices === 1) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
        return Response.json({ authorization_code: 'PRIVATE_AUTHORIZATION_CODE', code_verifier: 'PRIVATE_CODE_VERIFIER' });
      }
      if (url === 'https://auth.openai.com/oauth/token') return Response.json({ access_token: access, refresh_token: 'PRIVATE_REFRESH_TOKEN', expires_in: 3600 });
      if (url === 'https://chatgpt.com/backend-api/codex/responses') {
        inference++;
        const headers = new Headers(init.headers);
        if (headers.get('authorization') !== 'Bearer ' + access) throw new Error('OAuth credential was not used');
        const body = JSON.parse(headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(init.body).toString() : init.body);
        if (inference === 1) {
          if (!body.instructions.includes('nativePanel.required') || !body.tools.some(tool => tool.name === 'kodety_editor_context')) throw new Error('Builder context or tool registry was not supplied');
          return sse({ type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'kodety_editor_context', arguments: '{}', status: 'completed' });
        }
        if (!body.input.some(item => item.type === 'function_call_output' && item.output.includes('selection-confirmed'))) throw new Error('Tool acknowledgement was lost');
        return sse({ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Seleção confirmada.', annotations: [] }] });
      }
      throw new Error('Unexpected test HTTP request');
    };
  `);
  const child = spawn(process.execPath, ['--import', preload, filename], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  const lines = createInterface({ input: child.stdout });
  const messages = [];
  const waits = new Map();
  const ready = new Promise(resolve => waits.set('ready', resolve));
  lines.on('line', line => {
    const message = JSON.parse(line);
    assert.equal(message.channel, 'kodety-agent');
    messages.push(message);
    const key = message.kind === 'ready' ? 'ready' : message.id;
    waits.get(key)?.(message);
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => { child.on('exit', code => resolve(code)); child.on('error', reject); });
  function send(id, suffix, body) {
    const promise = new Promise(resolve => waits.set(id, resolve));
    child.stdin.write(JSON.stringify({ id, suffix, options: { method: 'POST', body }, policy: { licensed: true, readOnly: false } }) + '\n');
    return promise;
  }
  await ready;
  const initial = send('init-1', '__init', { projectId: 'project-test' });
  const duplicate = send('init-2', '__init', { projectId: 'second-project' });
  const configuration = send('config-1', 'config');
  assert.equal((await initial).result.ready, true);
  assert.ok((await duplicate).error);
  assert.equal((await configuration).result.transport, 'webcontainer');
  const models = await send('models-1', 'rpc', { method: 'model/list', params: {} });
  assert.ok(models.result.data.length > 0);
  assert.ok(models.result.data.some(model => model.model === 'gpt-5.6-terra'));
  const login = await send('login-1', 'rpc', { method: 'account/login/start', params: {} });
  assert.equal(login.result?.type, 'chatgptDeviceCode', JSON.stringify(login.error));
  assert.equal(login.result.userCode, 'TEST-1234');
  assert.equal(login.result.verificationUrl, 'https://auth.openai.com/codex/device');
  const canceled = await send('cancel-1', 'rpc', { method: 'account/login/cancel', params: { loginId: login.result.loginId } });
  assert.equal(canceled.result.status, 'canceled');
  assert.equal((await send('account-1', 'rpc', { method: 'account/read', params: {} })).result.account, null);
  async function until(read, check) {
    for (let n = 0; n < 100; n++) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.fail('The bundled Agent did not finish its expected transition');
  }
  const authorized = await send('login-2', 'rpc', { method: 'account/login/start', params: {} });
  assert.equal(authorized.result.type, 'chatgptDeviceCode');
  await until(() => send('account-2', 'rpc', { method: 'account/read', params: {} }), value => value.result?.account?.type === 'chatgpt');
  const threadId = (await send('thread-1', 'rpc', { method: 'thread/start', params: {} })).result.thread.id;
  const turn = await send('turn-1', 'rpc', { method: 'turn/start', params: { threadId, prompt: 'Confira a seleção.' } });
  assert.equal(turn.result.turn.status, 'inProgress');
  const pending = (await until(() => send('events-1', 'events', { threadId }), value => value.result?.pending.length)).result.pending[0];
  assert.equal(pending.params.tool, 'kodety_editor_context');
  assert.equal((await send('respond-1', 'respond', { requestId: pending.requestId, result: { success: true, contentItems: [{ type: 'inputText', text: 'selection-confirmed' }] } })).result.ok, true);
  const finished = await until(() => send('thread-read', 'rpc', { method: 'thread/read', params: { threadId } }), value => value.result?.thread.turns.at(-1).status !== 'inProgress');
  assert.equal(finished.result.thread.turns.at(-1).status, 'completed');
  assert.ok(finished.result.thread.turns.at(-1).items.some(item => item.text === 'Seleção confirmada.'));
  const history = JSON.stringify(messages.filter(message => message.kind === 'history'));
  assert.doesNotMatch(history, /TEST-1234|PRIVATE_|fixture\.[A-Za-z0-9_-]+\.signature/);
  const unsupported = await send('bad-1', 'rpc', { method: 'PRIVATE_ARGUMENT', params: { refresh_token: 'PRIVATE_REFRESH_TOKEN' } });
  assert.equal(unsupported.error.code, 'agent_unsupported');
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_|refresh_token/);
  assert.equal(stderr, '');
  child.stdin.end();
  assert.equal(await exited, 0);
});
