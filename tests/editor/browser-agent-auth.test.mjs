import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { Agent } from '@earendil-works/pi-agent-core';
import { createBrowserAgentRuntime } from '../../lib/html-editor/browser-agent-runtime.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let n = 0; n < 100; n++) { if (await check()) return; await tick(); } assert.fail('Account state did not arrive.'); }
const access = `fixture.${Buffer.from(JSON.stringify({ email: 'browser@example.test', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } })).toString('base64url')}.signature`;
const credential = { type: 'oauth', access, refresh: 'PRIVATE-REFRESH', expires: Date.now() + 3_600_000 };
function fixture({ persist = async () => {}, access: credentialAccess, initialRefresh, projectId = 'project-a' } = {}) {
  const authorize = deferred();
  let refreshes = 0;
  let models;
  const runtime = createBrowserAgentRuntime({ projectId, licensed: true, onCredentialsChange: persist, onCredentialsAccess: credentialAccess,
    dependencies: credentials => {
      models = createModels({ credentials, authContext: { env: async () => undefined, fileExists: async () => false } });
      const provider = openaiCodexProvider();
      models.setProvider({ ...provider, auth: { oauth: {
        name: 'Fixture subscription',
        async login(interaction) {
          interaction.notify({ type: 'device_code', userCode: 'TEST-CODE', verificationUri: 'https://auth.openai.com/codex/device' });
          await authorize.promise;
          interaction.signal.throwIfAborted();
          return credential;
        },
        async refresh(previous) { refreshes++; await initialRefresh?.(); return { ...previous, refresh: 'PRIVATE-ROTATED', expires: Date.now() + 3_600_000 }; },
        async toAuth(value) { return { apiKey: value.access }; },
      } } });
      return { models, Agent, getSupportedThinkingLevels };
    },
  });
  const rpc = (method, params = {}) => runtime.request('rpc', { body: { method, params } });
  return { runtime, rpc, authorize, get models() { return models; }, get refreshes() { return refreshes; } };
}

test('Pi login waits for the browser commit; reopen and full runtime reload preserve the account without history secrets', async () => {
  const commit = deferred();
  const saved = [];
  const f = fixture({ persist: async value => { await commit.promise; saved.push(value); } });
  const restored = fixture({ projectId: 'project-b' });
  try {
    await f.rpc('account/login/start');
    f.authorize.resolve();
    await tick();
    assert.equal((await f.rpc('account/read')).account, null);
    commit.resolve();
    await until(async () => (await f.rpc('account/read')).account);
    assert.equal(saved.length, 1);
    assert.equal((await f.rpc('account/read')).account.email, 'browser@example.test');
    assert.equal((await f.runtime.request('config')).credentialStorage, 'browser');
    const snapshot = JSON.stringify(f.runtime.snapshot());
    for (const secret of [access, 'PRIVATE-REFRESH', 'browser@example.test']) assert.equal(snapshot.includes(secret), false);
    await f.runtime.dispose();
    assert.equal(saved.length, 1, 'closing an editor must not delete the saved account');
    await restored.runtime.restoreCredentials(saved[0]);
    assert.equal((await restored.rpc('account/read')).account.email, 'browser@example.test');
    await restored.runtime.request('config');
    assert.equal((await restored.models.getAuth('openai-codex')).auth.apiKey, access);
  } finally { await f.runtime.dispose(); await restored.runtime.dispose(); }
});

test('Pi refresh is serialized, persists rotated tokens, and explicit logout removes the browser account', async () => {
  const refreshing = deferred();
  const saved = [];
  const f = fixture({ persist: async value => saved.push(value), initialRefresh: () => refreshing.promise });
  try {
    await f.runtime.restoreCredentials({ ...credential, expires: Date.now() - 1000 });
    await f.runtime.request('config');
    const first = f.models.getAuth('openai-codex');
    const second = f.models.getAuth('openai-codex');
    await until(() => f.refreshes === 1);
    refreshing.resolve();
    await Promise.all([first, second]);
    assert.equal(f.refreshes, 1);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].refresh, 'PRIVATE-ROTATED');
    await f.rpc('account/logout');
    assert.equal(saved.at(-1), null);
    assert.equal((await f.rpc('account/read')).account, null);
    assert.equal(await f.models.getAuth('openai-codex'), undefined);
  } finally { await f.runtime.dispose(); }
});

test('two independent Pi runtimes refresh a shared account once and both observe a later logout', async () => {
  let saved = { ...credential, expires: Date.now() - 1000 };
  let chain = Promise.resolve();
  const leases = new Map();
  const access = async (action, details) => {
    if (action === 'read') return { credentials: saved };
    if (action === 'release') { leases.get(details.lockId)(); leases.delete(details.lockId); return {}; }
    const previous = chain;
    const held = deferred();
    chain = previous.then(() => held.promise);
    await previous;
    const lockId = crypto.randomUUID();
    leases.set(lockId, held.resolve);
    return { lockId, credentials: saved };
  };
  const persist = async value => { saved = value; };
  const first = fixture({ persist, access });
  const second = fixture({ persist, access, projectId: 'project-b' });
  try {
    await Promise.all([first, second].map(async f => { await f.runtime.restoreCredentials(saved); await f.runtime.request('config'); }));
    await Promise.all([first.models.getAuth('openai-codex'), second.models.getAuth('openai-codex')]);
    assert.equal(first.refreshes + second.refreshes, 1);
    assert.equal(saved.refresh, 'PRIVATE-ROTATED');
    await first.rpc('account/logout');
    assert.equal((await second.rpc('account/read')).account, null);
    assert.equal(await second.models.getAuth('openai-codex'), undefined);
  } finally { await first.runtime.dispose(); await second.runtime.dispose(); }
});

test('failed persistence cannot publish a successful login or expose storage diagnostics', async () => {
  const f = fixture({ persist: async () => { throw new Error('PRIVATE-STORAGE-DETAIL'); } });
  try {
    await f.rpc('account/login/start');
    f.authorize.resolve();
    let failure;
    await until(async () => { try { await f.rpc('account/read'); } catch (error) { failure = error; return true; } });
    assert.doesNotMatch(failure.message, /PRIVATE-STORAGE/);
    assert.equal(await f.models.getAuth('openai-codex'), undefined);
  } finally { await f.runtime.dispose(); }
});

test('invalid saved credentials do not authenticate; canceled authorization cannot restore a logged-out account', async () => {
  const saved = [];
  const f = fixture({ persist: async value => saved.push(value) });
  try {
    await f.runtime.restoreCredentials({ type: 'api_key', key: 'PRIVATE-API-KEY' });
    assert.equal((await f.rpc('account/read')).account, null);
    const login = await f.rpc('account/login/start');
    await f.rpc('account/login/cancel', { loginId: login.loginId });
    f.authorize.resolve();
    await tick();
    assert.equal((await f.rpc('account/read')).account, null);
    assert.equal(saved.some(Boolean), false);
  } finally { await f.runtime.dispose(); }
});
