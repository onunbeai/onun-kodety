import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { createBrowserAgentRuntime } from '../../../lib/html-editor/browser-agent-runtime.mjs';
import { normalizeBrowserAgentUsage, readBrowserAgentRateLimits } from '../../../lib/html-editor/browser-agent-usage.mjs';
import { createBrowserAgentNetworkFetch } from '../../../lib/html-editor/browser-agent-network-runtime.mjs';

const token = suffix => `fixture.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_plan_type: 'plus' } })).toString('base64url')}.${suffix}`;
const credential = { type: 'oauth', access: token('EXPIRED-SECRET'), refresh: 'REFRESH-SECRET', expires: 0 };
const payload = {
  plan_type: 'plus',
  rate_limit: { allowed: true, limit_reached: false,
    primary_window: { used_percent: 42, limit_window_seconds: 18_000, reset_at: 1_790_000_000 },
    secondary_window: { used_percent: 5, limit_window_seconds: 604_800, reset_at: 1_790_600_000 } },
  additional_rate_limits: [{ metered_feature: 'codex_other', limit_name: 'Other', rate_limit: { primary_window: { used_percent: 88, limit_window_seconds: 3_600, reset_at: 1_790_000_100 } } }],
  ignored_private_field: 'DO-NOT-RETURN',
};
const rpc = runtime => (method, params = {}) => runtime.request('rpc', { body: { method, params } });

test('usage windows preserve used percentages, seconds-based resets and additional buckets', () => {
  const result = normalizeBrowserAgentUsage(payload);
  assert.deepEqual(result.rateLimits.primary, { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_790_000_000 });
  assert.deepEqual(result.rateLimits.secondary, { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1_790_600_000 });
  assert.equal(result.rateLimitsByLimitId.codex_other.primary.usedPercent, 88);
  assert.equal(result.rateLimitsByLimitId.codex_other.secondary, null);
  assert.equal(JSON.stringify(result).includes('DO-NOT-RETURN'), false);
});

test('missing windows and percentages stay unavailable, while explicit zero remains zero', () => {
  for (const value of [null, undefined, '', false]) {
    const result = normalizeBrowserAgentUsage({ rate_limit: { primary_window: { used_percent: value } } });
    assert.equal(result.rateLimits.primary, null);
    assert.equal(result.rateLimits.secondary, null);
  }
  const result = normalizeBrowserAgentUsage({ rate_limit: { primary_window: { used_percent: 0 } }, spend_control: { reached: true } });
  assert.deepEqual(result.rateLimits.primary, { usedPercent: 0, windowDurationMins: null, resetsAt: null });
  assert.equal(result.rateLimits.spendControlReached, true);
  assert.throws(() => normalizeBrowserAgentUsage({ error: 'PRIVATE' }), { code: 'agent_usage_unavailable' });
  assert.equal(normalizeBrowserAgentUsage({ rate_limit: null, rate_limit_reached_type: { type: 'workspace_member_usage_limit_reached' } }).rateLimits.rateLimitReachedType, 'workspaceMemberUsageLimitReached');
  const additionalLimit = normalizeBrowserAgentUsage({ rate_limit: null, additional_rate_limits: [{ metered_feature: 'codex_other', rate_limit: { limit_reached: true, primary_window: { used_percent: 100 } } }] });
  assert.equal(additionalLimit.rateLimitsByLimitId.codex_other.primary.usedPercent, 100);
  assert.equal(additionalLimit.rateLimitsByLimitId.codex_other.rateLimitReachedType, null, 'a separate model quota must not block all models');
});

test('runtime refreshes subscription OAuth then reads usage through the WebContainer network bridge', async () => {
  const saved = [];
  let refreshes = 0;
  let network;
  const calls = [];
  network = createBrowserAgentNetworkFetch(message => {
    if (message.action !== 'request') return;
    calls.push(message.request);
    queueMicrotask(() => {
      network.receive({ requestId: message.requestId, action: 'headers', status: 200, headers: { 'content-type': 'application/json' } });
      network.receive({ requestId: message.requestId, action: 'chunk', chunk: Buffer.from(JSON.stringify(payload)).toString('base64') });
      network.receive({ requestId: message.requestId, action: 'end' });
    });
  });
  const runtime = createBrowserAgentRuntime({ projectId: 'usage-fixture', licensed: true, fetch: network.fetch,
    onCredentialsChange: value => saved.push(value),
    dependencies: credentials => {
      const models = createModels({ credentials });
      const provider = openaiCodexProvider();
      models.setProvider({ ...provider, auth: { oauth: { name: 'Fixture',
        async refresh(previous) { refreshes++; return { ...previous, access: token('ROTATED-SECRET'), refresh: 'ROTATED-REFRESH', expires: Date.now() + 3_600_000 }; },
        async toAuth(value) { return { apiKey: value.access }; },
      } } });
      return { models };
    },
  });
  try {
    await runtime.restoreCredentials(credential);
    const result = await rpc(runtime)('account/rateLimits/read');
    assert.equal(refreshes, 1);
    assert.equal(saved[0].access, token('ROTATED-SECRET'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'usage');
    assert.equal(calls[0].body, '');
    assert.equal(calls[0].headers.authorization, `Bearer ${token('ROTATED-SECRET')}`);
    assert.equal(calls[0].headers['chatgpt-account-id'], 'fixture-account');
    assert.equal(100 - result.rateLimits.primary.usedPercent, 58);
    const { thread } = await rpc(runtime)('thread/start', { model: 'gpt-6-astra' });
    const exposed = JSON.stringify([result, runtime.snapshot(), await runtime.request('events', { body: { threadId: thread.id } })]);
    for (const secret of ['EXPIRED-SECRET', 'ROTATED-SECRET', 'REFRESH-SECRET', 'ROTATED-REFRESH', 'DO-NOT-RETURN']) assert.equal(exposed.includes(secret), false);
  } finally { network.dispose(); await runtime.dispose(); }
});

test('unauthenticated, expired, malformed and failed usage requests never return fake balances or raw errors', async () => {
  let calls = 0;
  await assert.rejects(readBrowserAgentRateLimits({ models: { getAuth: async () => undefined }, fetch: async () => { calls++; } }), { code: 'agent_auth_required' });
  assert.equal(calls, 0);
  const models = { getAuth: async () => ({ auth: { apiKey: token('SECRET') } }) };
  for (const [fetcher, code] of [
    [async () => new Response('SECRET', { status: 401 }), 'agent_auth_expired'],
    [async () => { throw new Error('SECRET'); }, 'agent_usage_unavailable'],
    [async () => new Response('SECRET'), 'agent_usage_unavailable'],
    [async () => Response.json({ error: 'SECRET' }), 'agent_usage_unavailable'],
  ]) {
    await assert.rejects(readBrowserAgentRateLimits({ models, fetch: fetcher }), cause => cause.code === code && !cause.message.includes('SECRET'));
  }
});

test('logout cancels a pending quota request instead of exposing an old account balance', async () => {
  let started;
  const fetching = new Promise(resolve => { started = resolve; });
  const runtime = createBrowserAgentRuntime({ projectId: 'usage-logout', licensed: true,
    dependencies: { models: { getAuth: async () => ({ auth: { apiKey: token('SECRET') } }), logout: async () => {} } },
    fetch: async (_url, { signal }) => {
      started();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  });
  try {
    const pending = assert.rejects(rpc(runtime)('account/rateLimits/read'), { code: 'agent_usage_unavailable' });
    await fetching;
    await rpc(runtime)('account/logout');
    await pending;
  } finally { await runtime.dispose(); }
});
