import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ configFile: false, root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
  const {
    prepareAgentRuntime,
    agentRuntimeFailure,
    agentRuntimeUnavailable,
    readAgentRuntimeProgress,
    isAgentRuntimeTransientFailure,
    isAgentSetupAborted,
  } = await server.ssrLoadModule('/lib/html-editor/agent-runtime-setup.ts');
  const pending = {
    enabled: true, available: false, unavailableReason: 'runtime_installing', retryPath: 'config/retry',
    runtimeInstallation: { phase: 'download_node', message: 'Baixando Node.js em partes…', step: 1, stepCount: 10, downloadedBytes: 2_097_152, totalBytes: 4_194_304, retryAfterMs: 100 },
  };
  const ready = { enabled: true, available: true };
  const diagnostic = { code: 'exec_unavailable', message: 'O host bloqueia processos.', action: 'Consulte a hospedagem sobre exec().', retryable: false };
  const unavailable = { enabled: true, available: false, unavailableReason: diagnostic.code, runtimeDiagnostics: diagnostic };
  const dnsUnavailable = {
    ...pending,
    unavailableReason: 'runtime_download_dns',
    runtimeDiagnostics: {
      code: 'runtime_download_dns',
      message: 'DNS indisponível.',
      action: 'Confira a resolução DNS.',
      retryable: true,
    },
  };

  assert.deepEqual(agentRuntimeFailure(agentRuntimeUnavailable(unavailable)), diagnostic, 'the public reason and action must survive from config to UI');
  const browserUnavailable = { enabled: true, available: false, transport: 'webcontainer' };
  const browserFailure = agentRuntimeFailure(agentRuntimeUnavailable(browserUnavailable));
  assert.equal(browserFailure.code, 'agent_browser_unavailable', 'browser failures must never become sidecar failures');
  assert.match(browserFailure.message, /navegador/);
  assert.doesNotMatch(browserFailure.message + browserFailure.action, /hospedagem|WordPress|Cloud|MCP/);
  assert.equal(agentRuntimeFailure(agentRuntimeUnavailable({ ...browserUnavailable, enabled: false, licenseRequired: true })).code, 'kodety_license_agents_required');
  const browserCalls = [];
  assert.deepEqual(await prepareAgentRuntime(async (suffix, options) => {
    browserCalls.push([suffix, options.method]);
    return browserUnavailable;
  }, { force: true }), browserUnavailable);
  assert.deepEqual(browserCalls, [['config', 'GET']], 'browser retry uses its binding startup, never the server preparation loop');
  assert.deepEqual(agentRuntimeFailure({ payload: { data: { runtimeDiagnostics: diagnostic } } }), diagnostic, 'RPC errors must use the same public diagnostic');
  const raw = agentRuntimeFailure(Object.assign(new Error('/private/secret token=hidden'), { status: 502 }));
  assert.match(raw.message, /502/);
  assert.doesNotMatch(JSON.stringify(raw), /private|hidden/, 'unknown transport errors must not expose private details');
  assert.match(agentRuntimeFailure({ code: 'rest_cookie_invalid_nonce', status: 403 }).message, /sessão/i);
  assert.match(agentRuntimeFailure({ status: 403 }).message, /recusou/);
  assert.match(agentRuntimeFailure({ code: 'agent_invalid_response', status: 200 }).action, /JSON/);
  assert.match(agentRuntimeFailure(new TypeError('Failed to fetch')).action, /retomados/);
  assert.equal(readAgentRuntimeProgress({ runtimeInstallation: { phase: 'arbitrary' } }), null);
  assert.equal(readAgentRuntimeProgress(pending).downloadedBytes, 2_097_152);
  assert.equal(readAgentRuntimeProgress({ runtimeInstallation: { ...pending.runtimeInstallation, downloadedBytes: Infinity, totalBytes: NaN } }).totalBytes, null);
  assert.equal(isAgentRuntimeTransientFailure(dnsUnavailable), true, 'DNS failures must remain in automatic recovery');
  assert.equal(isAgentRuntimeTransientFailure(unavailable), false, 'permanent host execution blocks must still stop');

  const calls = [];
  const progress = [];
  const responses = [pending, { ...pending, runtimeInstallation: { ...pending.runtimeInstallation, downloadedBytes: 4_194_304 } }, ready];
  const request = async (suffix, options) => {
    calls.push([suffix, options.method]);
    return responses.shift();
  };
  assert.deepEqual(await prepareAgentRuntime(request, { force: true, onProgress: value => progress.push(value) }), ready);
  assert.deepEqual(calls, [['config', 'GET'], ['config/retry', 'POST'], ['config/retry', 'POST']], 'one POST advances each partial step');
  assert.equal(progress[0].downloadedBytes, 2_097_152);
  assert.equal(progress[1].downloadedBytes, 4_194_304);
  assert.equal(progress.at(-1), null, 'progress must clear only when ready');

  let readCalls = 0;
  assert.deepEqual(await prepareAgentRuntime(async (_suffix, options) => {
    assert.equal(options.method, 'GET'); readCalls++; return pending;
  }), pending);
  assert.equal(readCalls, 1, 'opening a panel must not start downloading');
  let licensedCalls = 0;
  await prepareAgentRuntime(async () => { licensedCalls++; return { enabled: false, available: false, licenseRequired: true }; }, { force: true });
  assert.equal(licensedCalls, 1, 'unlicensed users must never POST preparation requests');

  let failedCalls = 0;
  assert.deepEqual(await prepareAgentRuntime(async () => (++failedCalls === 1 ? pending : unavailable), { force: true }), unavailable);
  assert.equal(failedCalls, 2, 'an actual failure must stop the pump instead of repeatedly retrying');

  const retryProgress = [];
  const transientResponses = [pending, dnsUnavailable, ready];
  const transientCalls = [];
  assert.deepEqual(await prepareAgentRuntime(async (_suffix, options) => {
    transientCalls.push(options.method);
    return transientResponses.shift();
  }, { force: true, onProgress: value => retryProgress.push(value) }), ready);
  assert.deepEqual(transientCalls, ['GET', 'POST', 'POST'], 'a transient DNS error must retry the same resumable preparation step');
  assert.ok(
    retryProgress.some(value => /Nova tentativa automática/.test(value?.message || '')),
    'automatic network recovery must remain visible as progress instead of a terminal error card',
  );

  const interruptedProgress = [];
  const interruptedCalls = [];
  let interruptedStep = 0;
  assert.deepEqual(await prepareAgentRuntime(async (_suffix, options) => {
    interruptedCalls.push(options.method);
    interruptedStep += 1;
    if (interruptedStep === 1) return pending;
    if (interruptedStep === 2) throw new TypeError('Failed to fetch');
    return ready;
  }, { force: true, onProgress: value => interruptedProgress.push(value) }), ready);
  assert.deepEqual(interruptedCalls, ['GET', 'POST', 'GET'], 'a dropped write response must probe saved progress before another POST');
  assert.doesNotMatch(
    interruptedProgress.map(value => value?.message || '').join('\n'),
    /Conexão temporariamente indisponível/,
    'a recoverable response interruption must not replace valid download progress with a false outage warning',
  );

  let persistentDnsCalls = 0;
  assert.deepEqual(await prepareAgentRuntime(async () => {
    persistentDnsCalls += 1;
    return dnsUnavailable;
  }, { force: true, maxTransientFailures: 2 }), dnsUnavailable);
  assert.equal(persistentDnsCalls, 2, 'persistent host download failures must stop automatic retries and reach the explicit Cloud or MCP choice');

  const starting = { ...pending, unavailableReason: 'runtime_starting', runtimeInstallation: { ...pending.runtimeInstallation, phase: 'start_codex', step: 10 } };
  const startupCalls = [];
  await prepareAgentRuntime(async (_suffix, options) => { startupCalls.push(options.method); return startupCalls.length === 1 ? starting : ready; });
  assert.deepEqual(startupCalls, ['GET', 'GET'], 'read-only bootstrap may poll native startup but must not download or repeatedly restart it');
  const forcedStartup = [];
  await prepareAgentRuntime(async (_suffix, options) => {
    forcedStartup.push(options.method);
    return forcedStartup.length === 1 ? pending : forcedStartup.length === 2 ? starting : ready;
  }, { force: true });
  assert.deepEqual(forcedStartup, ['GET', 'POST', 'GET'], 'startup polling must not repeatedly force a new Codex process');

  const controller = new AbortController();
  let cancelledCalls = 0;
  await assert.rejects(prepareAgentRuntime(async (_suffix, options) => {
    assert.equal(options.signal, controller.signal);
    if (++cancelledCalls === 2) controller.abort();
    return pending;
  }, { force: true, signal: controller.signal }), isAgentSetupAborted);
  assert.equal(cancelledCalls, 2, 'unmount must stop advancing installation steps');
  await assert.rejects(prepareAgentRuntime(async () => pending, { force: true, maxSteps: 1 }), error => error.code === 'agent_setup_limit');
  await assert.rejects(prepareAgentRuntime(async () => null), error => error.code === 'agent_invalid_response');

  for (const component of ['HtmlAgentPanel', 'HtmlAgentSettings']) {
    const source = await readFile(new URL(`../app/(builder)/kodety/html-editor/components/${component}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /prepareAgentRuntime\(request/, `${component} must use the shared cancellable installer`);
    assert.match(source, /runtimePreparationRef\.current\?\.abort\(\)/, `${component} must cancel on unmount`);
    assert.match(source, /<HtmlAgentRuntimeStatus/, `${component} must render actionable diagnostics and progress`);
    if (component === 'HtmlAgentPanel') {
      assert.match(source, /\[accountLoading, setAccountLoading\] = useState\(true\)/, 'the sidebar must begin with preparation visible before its first response');
      assert.match(source, /active=\{accountLoading\}/, 'sidebar progress must follow preparation while Settings owns login');
      assert.match(source, /const bootstrap = async \(\) => \{[\s\S]*?setAccountLoading\(true\)[\s\S]*?await refreshRuntime\(\)[\s\S]*?finally[\s\S]*?setAccountLoading\(false\)/, 'sidebar bootstrap must keep preparation active until readiness settles');
    } else {
      assert.match(source, /\[loading, setLoading\] = useState\(true\)/, 'Settings must show preparation before its first response');
      assert.match(source, /active=\{loading \|\| busy === 'account'\}/, 'Settings progress must cover both readiness and its own account connection');
      assert.match(source, /const loadAll = useCallback\([\s\S]*?setLoading\(true\)[\s\S]*?await prepareAgentRuntime\(request[\s\S]*?finally[\s\S]*?setLoading\(false\)/, 'Settings must keep preparation active until the request settles');
    }
  }
  console.log('Agent setup UI: resumable retries, finite host-failure detection, cancellation and activity-aware startup polling OK.');
} finally {
  await server.close();
}
