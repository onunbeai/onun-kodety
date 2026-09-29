import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../../lib/html-editor/browser-agent-webcontainer.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('browser-agent-webcontainer.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const testSource = tree.statements.filter(node => !(ts.isFunctionDeclaration(node) && ['container', 'historyStore', 'credentialStore'].includes(node.name?.text))).map(node => node.getText(tree)).join('\n');
const compiled = ts.transpileModule(testSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const networkSource = await readFile(new URL('../../../lib/html-editor/browser-agent-network.ts', import.meta.url), 'utf8');
const networkExports = {};
new Function('exports', ts.transpileModule(networkSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(networkExports);
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await tick(); } assert.fail('Expected lifecycle transition did not occur'); }
const rpc = (method, params = {}) => ({ method: 'POST', body: { method, params } });
const isAbort = error => error?.name === 'AbortError';

function fixture(t, settings = {}) {
  const processExit = deferred();
  const commands = [];
  const removed = [];
  const saved = [];
  const savedCredentials = [];
  const savedAttachments = [];
  let controller;
  let ended = false;
  const process = {
    output: new ReadableStream({ start(value) { controller = value; } }),
    input: new WritableStream({ write(chunk) {
      for (const line of chunk.trim().split('\n')) {
        const command = JSON.parse(line); commands.push(command);
        const custom = settings.handle?.(command, process);
        if (custom === false) continue;
        process.reply(command, command.suffix === '__init' ? { ready: true } : command.suffix === 'config' ? { available: true, enabled: true, transport: 'webcontainer' } : { ok: true });
      }
    } }),
    exit: processExit.promise,
    killed: 0,
    kill() { this.killed++; if (!ended) { ended = true; controller.close(); processExit.resolve(0); } },
    emit(message) { if (!ended) controller.enqueue(JSON.stringify({ channel: 'kodety-agent', ...message }) + '\n'); },
    reply(command, result) { this.emit({ id: command.id, result }); },
  };
  const wc = {
    fs: { async writeFile() {}, async rm(filename) { removed.push(filename); } },
    spawnCount: 0,
    async spawn() { this.spawnCount++; if (settings.ready !== false) queueMicrotask(() => process.emit({ kind: 'ready' })); return process; },
  };
  let bootCalls = 0;
  let startupTimeout;
  let licensed = true;
  let readOnly = false;
  const exports = {};
  const historyStore = async (...args) => {
    if (args[3] === 'kodety-browser-agent-attachments-v1') {
      if (settings.attachments) return settings.attachments(...args);
      if (args[1] === 'write') savedAttachments.push(args[2]);
      return undefined;
    }
    if (settings.history) return settings.history(...args);
    if (args[1] === 'write') saved.push(args[2]);
    return undefined;
  };
  const credentialStore = async (...args) => {
    if (settings.credentials) return settings.credentials(...args);
    if (args[1] === 'write') savedCredentials.push(args[2]);
    return undefined;
  };
  const schedule = (callback, milliseconds) => {
    if (settings.manualStartupTimeout && milliseconds === 120_000) { startupTimeout = { callback, cleared: false }; return startupTimeout; }
    return setTimeout(callback, milliseconds);
  };
  const clear = timer => { if (timer?.callback) timer.cleared = true; else clearTimeout(timer); };
  new Function('exports', 'container', 'historyStore', 'credentialStore', 'fetch', 'document', 'location', 'setTimeout', 'clearTimeout', 'require', compiled)(
    exports, () => { bootCalls++; return settings.boot || Promise.resolve(wc); }, historyStore, credentialStore,
    settings.fetch || (async () => ({ ok: true, text: async () => 'runtime' })),
    { baseURI: 'https://studio.example.test/' }, { origin: 'https://studio.example.test' },
    schedule, clear, name => { assert.equal(name, './browser-agent-network'); return networkExports; },
  );
  const binding = exports.createBrowserAgentBinding({ projectId: 'project-1', credentialScope: settings.credentialScope, runtimeUrl: settings.runtimeUrl ?? '/runtime.mjs', isLicensed: () => licensed, isReadOnly: () => readOnly });
  t.after(() => binding.dispose());
  return { binding, process, wc, commands, removed, saved, savedCredentials, savedAttachments, get bootCalls() { return bootCalls; }, license(value) { licensed = value; }, readOnly(value) { readOnly = value; }, expireStartup() { assert.equal(startupTimeout?.cleared, false); startupTimeout.callback(); } };
}

test('account commits are acknowledged only after browser storage and restored across binding reloads', async t => {
  const database = new Map();
  const committing = deferred();
  const credentials = async (key, operation, value) => {
    if (operation === 'read') return database.get(key);
    await committing.promise;
    if (value === null) database.delete(key); else database.set(key, value);
  };
  const first = fixture(t, { credentials, credentialScope: 'wordpress:user-1' });
  const settings = first.binding.createBackend({});
  await settings.request('config');
  const credential = { type: 'oauth', access: 'PRIVATE-ACCESS', refresh: 'PRIVATE-REFRESH', expires: Date.now() + 3600000 };
  first.process.emit({ kind: 'credentials', requestId: 'save-1', credentials: credential });
  await tick();
  assert.equal(first.commands.some(command => command.suffix === '__credentials/ack'), false);
  committing.resolve();
  await until(() => first.commands.some(command => command.suffix === '__credentials/ack'));
  assert.deepEqual(first.commands.at(-1).options.body, { requestId: 'save-1', ok: true });
  settings.cancelAll();
  await first.binding.createBackend({}).request('config');
  assert.equal(first.process.killed, 0);
  first.binding.dispose();
  assert.deepEqual(database.get('wordpress:user-1'), credential);
  const reopened = fixture(t, { credentials, credentialScope: 'wordpress:user-1' });
  await reopened.binding.createBackend({}).request('config');
  const init = reopened.commands.find(command => command.suffix === '__init');
  assert.deepEqual(init.options.body.credentials, credential);
  assert.equal(JSON.stringify(init.options.body.snapshot || {}).includes('PRIVATE'), false);
  assert.equal(first.saved.length, 0);
  const other = fixture(t, { credentials, credentialScope: 'wordpress:user-2' });
  await other.binding.createBackend({}).request('config');
  assert.equal(other.commands.find(command => command.suffix === '__init').options.body.credentials, undefined);
  reopened.process.emit({ kind: 'credentials', requestId: 'logout-1', credentials: null });
  await until(() => reopened.commands.some(command => command.suffix === '__credentials/ack'));
  assert.equal(database.has('wordpress:user-1'), false);
});

test('account storage failures are reported privately and never acknowledged as committed', async t => {
  const f = fixture(t, { credentials: async (_key, operation) => {
    if (operation === 'write') throw new Error('PRIVATE-STORAGE-ERROR');
  } });
  await f.binding.createBackend({}).request('config');
  f.process.emit({ kind: 'credentials', requestId: 'failed-save', credentials: {} });
  await until(() => f.commands.some(command => command.suffix === '__credentials/ack'));
  const ack = f.commands.at(-1);
  assert.deepEqual(ack.options.body, { requestId: 'failed-save', ok: false });
  assert.doesNotMatch(JSON.stringify(ack), /PRIVATE-STORAGE/);
});

test('attachment upload waits for its private browser commit and restores separately from conversation history', async t => {
  const database = new Map();
  const committing = deferred();
  let originalUpload;
  const state = { version: 1, projectId: 'project-1', files: [{ id: 'attachment-fixture', data: 'PRIVATE_IMAGE_DATA' }] };
  const attachments = async (key, operation, value) => {
    if (operation === 'read') return database.get(key);
    await committing.promise;
    database.set(key, value);
  };
  const first = fixture(t, { attachments, handle(command, process) {
    if (command.suffix === 'attachments') {
      originalUpload = command;
      process.emit({ kind: 'attachments', requestId: 'commit-file', state });
      return false;
    }
    if (command.suffix === '__attachments/ack') {
      assert.equal(command.options.body.ok, true);
      process.reply(originalUpload, { attachment: { id: 'attachment-fixture', name: 'brief.txt', kind: 'text', mime: 'text/plain', size: 5 } });
    }
  } });
  const backend = first.binding.createBackend({});
  let finished = false;
  const upload = backend.uploadAttachment(new File(['Brief'], 'brief.txt', { type: 'text/plain' })).then(value => { finished = true; return value; });
  await until(() => Boolean(originalUpload));
  assert.equal(originalUpload.options.body.contentBase64, Buffer.from('Brief').toString('base64'));
  assert.equal(finished, false);
  assert.equal(first.commands.some(command => command.suffix === '__attachments/ack'), false);
  committing.resolve();
  assert.equal((await upload).attachment.name, 'brief.txt');
  assert.deepEqual(database.get('project-1'), state);
  assert.deepEqual(first.saved, [], 'attachment bytes do not enter the history store');
  first.binding.dispose();
  const reopened = fixture(t, { attachments });
  await reopened.binding.createBackend({}).request('config');
  const init = reopened.commands.find(command => command.suffix === '__init');
  assert.deepEqual(init.options.body.attachments, state);
  assert.equal(init.options.body.attachmentPersistence, true);
  assert.doesNotMatch(JSON.stringify(init.options.body.snapshot || {}), /PRIVATE_IMAGE_DATA/);
});

test('attachment storage failures are never acknowledged as an uploaded file', async t => {
  const f = fixture(t, { attachments: async (_key, operation) => {
    if (operation === 'write') throw new Error('PRIVATE-ATTACHMENT-STORAGE');
  } });
  await f.binding.createBackend({}).request('config');
  f.process.emit({ kind: 'attachments', requestId: 'failed-file', state: {} });
  await until(() => f.commands.some(command => command.suffix === '__attachments/ack'));
  const ack = f.commands.find(command => command.suffix === '__attachments/ack');
  assert.deepEqual(ack.options.body, { requestId: 'failed-file', ok: false });
  assert.doesNotMatch(JSON.stringify(ack), /PRIVATE-ATTACHMENT/);
});

test('an unreadable account store fails clearly instead of showing the user as logged out', async t => {
  const f = fixture(t, { credentials: async () => { throw new Error('PRIVATE-STORAGE-DETAIL'); } });
  await assert.rejects(f.binding.createBackend({}).request('config'), error => {
    assert.equal(error.code, 'agent_browser_credentials_unavailable');
    assert.doesNotMatch(error.message, /PRIVATE-STORAGE/);
    return true;
  });
  assert.equal(f.commands.some(command => command.suffix === '__init'), false);
});

test('different bindings lock their shared account and reread rotated credentials before the next refresh', async t => {
  const database = new Map([['shared-account', { type: 'oauth', access: 'ACCESS', refresh: 'OLD-REFRESH', expires: 1 }]]);
  const credentials = async (key, operation, value) => {
    if (operation === 'read') return database.get(key);
    if (value === null) database.delete(key); else database.set(key, value);
  };
  const first = fixture(t, { credentials, credentialScope: 'shared-account' });
  const second = fixture(t, { credentials, credentialScope: 'shared-account' });
  const third = fixture(t, { credentials, credentialScope: 'shared-account' });
  await Promise.all([first, second, third].map(f => f.binding.createBackend({}).request('config')));
  const ack = (f, requestId) => f.commands.find(command => command.suffix === '__credentials/ack' && command.options.body.requestId === requestId)?.options.body;
  first.process.emit({ kind: 'credentials', action: 'acquire', requestId: 'lock-first' });
  await until(() => ack(first, 'lock-first'));
  const lock = ack(first, 'lock-first');
  assert.equal(lock.credentials.refresh, 'OLD-REFRESH');
  second.process.emit({ kind: 'credentials', action: 'acquire', requestId: 'lock-second' });
  await tick();
  assert.equal(ack(second, 'lock-second'), undefined);
  first.process.emit({ kind: 'credentials', action: 'write', requestId: 'save-refresh', lockId: lock.lockId,
    credentials: { ...lock.credentials, refresh: 'ROTATED-REFRESH', expires: Date.now() + 3600000 } });
  await until(() => ack(first, 'save-refresh'));
  assert.equal(ack(first, 'save-refresh').ok, true);
  first.process.emit({ kind: 'credentials', action: 'release', requestId: 'release-first', lockId: lock.lockId });
  await until(() => ack(second, 'lock-second'));
  assert.equal(ack(second, 'lock-second').credentials.refresh, 'ROTATED-REFRESH');
  third.process.emit({ kind: 'credentials', action: 'acquire', requestId: 'lock-third' });
  await tick();
  assert.equal(ack(third, 'lock-third'), undefined);
  third.process.emit({ kind: 'credentials', action: 'cancel', requestId: 'cancel-third', cancelId: 'lock-third' });
  await until(() => ack(third, 'lock-third'));
  assert.equal(ack(third, 'lock-third').ok, false);
  third.process.emit({ kind: 'credentials', action: 'acquire', requestId: 'retry-third' });
  await tick();
  assert.equal(ack(third, 'retry-third'), undefined);
  second.binding.dispose();
  await until(() => ack(third, 'retry-third'));
  assert.equal(ack(third, 'retry-third').credentials.refresh, 'ROTATED-REFRESH');
});

test('a canceled consumer does not stop its sibling or duplicate the project worker', async t => {
  const boot = deferred();
  const f = fixture(t, { boot: boot.promise });
  const first = f.binding.createBackend({});
  const second = f.binding.createBackend({});
  const canceled = first.request('config');
  const active = second.request('config');
  first.cancelAll();
  await assert.rejects(canceled, isAbort);
  boot.resolve(f.wc);
  assert.equal((await active).available, true);
  assert.equal(f.bootCalls, 1);
  assert.equal(f.wc.spawnCount, 1);
  assert.equal(f.process.killed, 0);
  assert.equal((await first.request('config')).available, true);
});

test('dispose rejects waiting clients immediately without waiting for the shared WebContainer boot', async t => {
  const boot = deferred();
  const f = fixture(t, { boot: boot.promise });
  const request = f.binding.createBackend({}).request('config');
  f.binding.dispose();
  await assert.rejects(request, isAbort);
  boot.resolve(f.wc);
  await tick();
  assert.equal(f.wc.spawnCount, 0);
  await assert.rejects(f.binding.createBackend({}).request('config'), isAbort);
});

test('initialization waits for the process ready handshake before writing stdin', async t => {
  const f = fixture(t, { ready: false });
  const request = f.binding.createBackend({}).request('config');
  await until(() => f.wc.spawnCount === 1);
  assert.equal(f.commands.length, 0);
  f.process.emit({ kind: 'ready' });
  assert.equal((await request).available, true);
  assert.deepEqual(f.commands.map(command => command.suffix), ['__init', 'config']);
});

test('late canceled login and turn starts are cleaned up without killing the project worker', async t => {
  const f = fixture(t, { handle: command => ['account/login/start', 'turn/start'].includes(command.options.body?.method) ? false : undefined });
  const first = f.binding.createBackend({});
  const second = f.binding.createBackend({});
  await first.request('config');
  const login = first.request('rpc', rpc('account/login/start'));
  await until(() => f.commands.some(command => command.options.body?.method === 'account/login/start'));
  first.cancelAll();
  await assert.rejects(login, isAbort);
  f.process.reply(f.commands.find(command => command.options.body?.method === 'account/login/start'), { loginId: 'login-late', userCode: 'PRIVATE' });
  await until(() => f.commands.some(command => command.options.body?.method === 'account/login/cancel'));
  const canceledLogin = f.commands.find(command => command.options.body?.method === 'account/login/cancel');
  assert.deepEqual(canceledLogin.options.body.params, { loginId: 'login-late' });
  assert.doesNotMatch(JSON.stringify(canceledLogin), /PRIVATE/);
  const turn = first.request('rpc', rpc('turn/start', { threadId: 'thread-1' }));
  await until(() => f.commands.some(command => command.options.body?.method === 'turn/start'));
  first.cancelAll();
  await assert.rejects(turn, isAbort);
  f.process.reply(f.commands.find(command => command.options.body?.method === 'turn/start'), { turn: { id: 'turn-late' } });
  await until(() => f.commands.some(command => command.options.body?.method === 'turn/interrupt'));
  assert.deepEqual(f.commands.find(command => command.options.body?.method === 'turn/interrupt').options.body.params, { threadId: 'thread-1', turnId: 'turn-late' });
  assert.equal((await second.request('config')).available, true);
  assert.equal(f.process.killed, 0);
});

test('an aborted login request cannot cancel a duplicate login claimed by another consumer', async t => {
  const f = fixture(t, { handle: command => command.options.body?.method === 'account/login/start' ? false : undefined });
  const first = f.binding.createBackend({});
  const second = f.binding.createBackend({});
  await first.request('config');
  const one = first.request('rpc', rpc('account/login/start'));
  const two = second.request('rpc', rpc('account/login/start'));
  await until(() => f.commands.filter(command => command.options.body?.method === 'account/login/start').length === 2);
  first.cancelAll(); await assert.rejects(one, isAbort);
  const requests = f.commands.filter(command => command.options.body?.method === 'account/login/start');
  f.process.reply(requests[0], { loginId: 'shared-login' });
  await tick();
  assert.equal(f.commands.filter(command => command.options.body?.method === 'account/login/cancel').length, 0);
  f.process.reply(requests[1], { loginId: 'shared-login' });
  assert.equal((await two).loginId, 'shared-login');
  await tick();
  assert.equal(f.commands.filter(command => command.options.body?.method === 'account/login/cancel').length, 0);
});

test('history writes are serialized, report failures without raw errors, and clear their warning after recovery', async t => {
  const firstWrite = deferred();
  let writes = 0;
  const f = fixture(t, { history: async (_key, operation) => {
    if (operation === 'read') return;
    writes++;
    if (writes === 1) return firstWrite.promise;
  } });
  const configs = [];
  await f.binding.createBackend({ onConfig: config => configs.push(config) }).request('config');
  f.process.emit({ kind: 'history', snapshot: { marker: 1 } });
  f.process.emit({ kind: 'history', snapshot: { marker: 2 } });
  await until(() => writes === 1);
  assert.equal(writes, 1);
  firstWrite.reject(new Error('PRIVATE_DATABASE_DETAIL'));
  await until(() => writes === 2 && configs.some(config => config.historyWarning));
  await tick();
  assert.match(configs.find(config => config.historyWarning).historyWarning, /salvar o histórico/);
  assert.equal(configs.at(-1).historyWarning, null);
  assert.doesNotMatch(JSON.stringify(configs), /PRIVATE_DATABASE_DETAIL/);
});

test('a failed history read warns the user and does not overwrite unread conversations', async t => {
  let writes = 0;
  const f = fixture(t, { history: async (_key, operation) => {
    if (operation === 'read') throw new Error('PRIVATE_DATABASE_DETAIL');
    writes++;
  } });
  const result = await f.binding.createBackend({}).request('config');
  assert.match(result.historyWarning, /recuperar o histórico/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DATABASE_DETAIL/);
  f.process.emit({ kind: 'history', snapshot: { threads: [] } }); await tick();
  assert.equal(writes, 0);
});

test('read-only policy reaches the worker and old license state does not block provider requests', async t => {
  const f = fixture(t);
  const backend = f.binding.createBackend({});
  await backend.request('config');
  f.readOnly(true); await f.binding.refreshAccess();
  assert.equal(f.commands.at(-1).policy.readOnly, true);
  assert.equal(f.commands.at(-1).policy.licensed, true);
  f.license(false); await f.binding.refreshAccess();
  assert.equal(f.commands.at(-1).policy.licensed, true);
  await backend.request('rpc', rpc('account/read'));
  assert.equal(f.commands.at(-1).options.body.method, 'account/read');
  await backend.request('rpc', rpc('account/logout'));
  assert.equal(f.commands.at(-1).options.body.method, 'account/logout');
});

test('missing runtime assets fail before booting or fetching a page as JavaScript', async t => {
  const f = fixture(t, { runtimeUrl: '' });
  await assert.rejects(f.binding.createBackend({}).request('config'), error => error.code === 'agent_browser_assets_unavailable');
  assert.equal(f.bootCalls, 0);
});

test('the whole startup has a public timeout, permits retry, and cannot spawn a worker after timing out', async t => {
  const boot = deferred();
  const f = fixture(t, { boot: boot.promise, manualStartupTimeout: true });
  const backend = f.binding.createBackend({});
  const request = backend.request('config');
  await until(() => f.bootCalls === 1);
  f.expireStartup();
  await assert.rejects(request, error => error.code === 'agent_browser_start_failed' && error.name !== 'AbortError');
  boot.resolve(f.wc); await tick();
  assert.equal(f.wc.spawnCount, 0);
  assert.equal((await backend.request('config')).available, true);
  assert.equal(f.wc.spawnCount, 1);
});
