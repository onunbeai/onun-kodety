import { devices, expect, test } from '@playwright/test';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance as nodePerformance } from 'node:perf_hooks';
import {
  diagnosticFingerprint,
  redactDiagnostic,
  redactedUrl,
  serializeRedactedArtifact,
} from './performance-artifact-redaction.mjs';
import { rounded, summarizeSamples } from './performance-statistics.mjs';
import {
  evaluatePerformanceBudget,
  evaluatePerformanceMeasurementsBudget,
  performanceBudgetFailureMessage,
} from './performance-budget.mjs';
import {
  createFixtureFingerprintContract,
  verifyInstalledFixtureFingerprint,
} from './wordpress-installed-fixture.mjs';
import { calculateSpeedIndex } from './speed-index.mjs';

const ARTIFACT_ROOT = path.resolve('artifacts/kodety-hardening/front-06/e2e/performance');
const SAMPLE_COUNT = 5;
const INP_PROBE_INTERACTIONS = 5;
const DEFAULT_LOADING_TIMEOUT_MS = 60_000;
const DEFAULT_SETTLE_MS = 2_500;
const MAX_MONITOR_FAILURES = 100;
const MAX_NETWORK_ENTRIES = 2_000;
const RESOURCE_TIMING_BUFFER_SIZE = 5_000;
const NETWORK_QUIET_MS = 500;
const DEFAULT_SOAK_DURATION_MS = 30 * 60_000;
const DEFAULT_SOAK_CYCLE_MS = 10_000;
const SOAK_CHECKPOINT_MS = 5 * 60_000;
const MAXIMUM_SPEED_INDEX_FRAMES = 120;

const THROTTLE_PROFILES = Object.freeze({
  desktop: Object.freeze({
    latencyMs: 40,
    downloadBitsPerSecond: 10_000_000,
    uploadBitsPerSecond: 5_000_000,
    cpuSlowdownMultiplier: 1,
    connectionType: 'wifi',
  }),
  mobile: Object.freeze({
    latencyMs: 150,
    downloadBitsPerSecond: 1_600_000,
    uploadBitsPerSecond: 750_000,
    cpuSlowdownMultiplier: 4,
    connectionType: 'cellular3g',
  }),
  slow4g: Object.freeze({
    latencyMs: 100,
    downloadBitsPerSecond: 4_000_000,
    uploadBitsPerSecond: 3_000_000,
    cpuSlowdownMultiplier: 2,
    connectionType: 'cellular4g',
  }),
  fast3g: Object.freeze({
    latencyMs: 150,
    downloadBitsPerSecond: 1_600_000,
    uploadBitsPerSecond: 750_000,
    cpuSlowdownMultiplier: 4,
    connectionType: 'cellular3g',
  }),
  none: Object.freeze({
    latencyMs: 0,
    downloadBitsPerSecond: 0,
    uploadBitsPerSecond: 0,
    cpuSlowdownMultiplier: 1,
    connectionType: 'none',
  }),
});

const SUMMARY_METRICS = Object.freeze([
  'ttfbMs',
  'fcpMs',
  'lcpMs',
  'cls',
  'domContentLoadedMs',
  'loadMs',
  'readyMs',
  'requestCount',
  'transferBytes',
  'encodedBodyBytes',
  'decodedBodyBytes',
  'longTaskCount',
  'longTaskTotalMs',
  'longTaskMaxMs',
  'blockingTimeUntilReadyMs',
  'tbtMs',
  'inpMs',
  'thirdPartyRequestCount',
  'thirdPartyTransferBytes',
  'cpuTaskDurationMs',
  'cpuScriptDurationMs',
  'cpuLayoutDurationMs',
  'jsHeapUsedDeltaBytes',
]);
const PUBLISHED_SUMMARY_METRICS = Object.freeze([
  ...SUMMARY_METRICS,
  'speedIndexMs',
]);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim() || '';
  if (!value) {
    throw new Error(
      `Defina ${name}; o perfil de performance não cria instalação nem inventa credenciais.`,
    );
  }
  return value;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

function sameOriginUrl(siteBase, environmentName, fallbackPath) {
  const configured = process.env[environmentName]?.trim() || fallbackPath;
  const resolved = new URL(configured.replace(/^\/(?!\/)/, ''), siteBase);
  if (!['http:', 'https:'].includes(resolved.protocol)) {
    throw new Error(`${environmentName} deve usar HTTP(S).`);
  }
  if (resolved.origin !== siteBase.origin) {
    throw new Error(`${environmentName} deve permanecer na origem de KODETY_E2E_BASE_URL.`);
  }
  resolved.username = '';
  resolved.password = '';
  return resolved.href;
}

function loadPerformanceEnvironment() {
  const baseValue = requiredEnvironment('KODETY_E2E_BASE_URL');
  const siteBase = new URL(baseValue.endsWith('/') ? baseValue : `${baseValue}/`);
  if (!['http:', 'https:'].includes(siteBase.protocol) || siteBase.username || siteBase.password) {
    throw new Error('KODETY_E2E_BASE_URL deve ser HTTP(S) e não pode conter credenciais.');
  }

  const profile = (process.env.KODETY_E2E_PROJECT_PROFILE || '').trim().toLowerCase();
  if (!['small', 'large', 'legacy'].includes(profile)) {
    throw new Error(
      'Defina KODETY_E2E_PROJECT_PROFILE como small, large ou legacy; os três perfis são gates separados.',
    );
  }
  const profileBuilderVariable = {
    small: 'KODETY_E2E_SMALL_BUILDER_URL',
    large: 'KODETY_E2E_LARGE_BUILDER_URL',
    legacy: 'KODETY_E2E_LEGACY_BUILDER_URL',
  }[profile];
  const builderFallback = process.env[profileBuilderVariable]?.trim()
    || process.env.KODETY_E2E_BUILDER_URL?.trim();
  if (!builderFallback) {
    throw new Error(
      `Defina ${profileBuilderVariable} (ou KODETY_E2E_BUILDER_URL) para a fixture ${profile} já instalada.`,
    );
  }

  const throttleName = (process.env.KODETY_E2E_PERF_THROTTLE_PROFILE || 'slow4g')
    .trim()
    .toLowerCase();
  const throttle = THROTTLE_PROFILES[throttleName];
  if (!throttle) {
    throw new Error(
      'KODETY_E2E_PERF_THROTTLE_PROFILE deve ser slow4g, fast3g, desktop, mobile ou none.',
    );
  }
  const evidenceMode = (process.env.KODETY_E2E_PERF_EVIDENCE || 'failure').trim().toLowerCase();
  if (!['failure', 'all'].includes(evidenceMode)) {
    throw new Error('KODETY_E2E_PERF_EVIDENCE deve ser failure ou all.');
  }
  const fixtureContract = createFixtureFingerprintContract({
    profile,
    siteBase,
    smallFingerprint: requiredEnvironment('KODETY_E2E_SMALL_PROJECT_FINGERPRINT'),
    largeFingerprint: requiredEnvironment('KODETY_E2E_LARGE_PROJECT_FINGERPRINT'),
    legacyFingerprint: requiredEnvironment('KODETY_E2E_LEGACY_PROJECT_FINGERPRINT'),
    receiptUrl: requiredEnvironment('KODETY_E2E_INSTALLED_FINGERPRINT_URL'),
  });

  return {
    runId: `${Date.now().toString(36)}-${process.pid}`,
    siteBase,
    profile,
    fixtureConfigured: Boolean(process.env.KODETY_E2E_PROJECT_FIXTURE?.trim()),
    ...fixtureContract,
    performanceBudgetPath: path.resolve(requiredEnvironment('KODETY_E2E_PERF_BUDGET_PATH')),
    username: requiredEnvironment('KODETY_E2E_USER'),
    password: requiredEnvironment('KODETY_E2E_PASSWORD'),
    loginUrl: sameOriginUrl(siteBase, 'KODETY_E2E_LOGIN_URL', 'wp-login.php'),
    throttleName,
    throttle,
    evidenceMode,
    loadingTimeoutMs: boundedInteger(
      'KODETY_E2E_LOADING_TIMEOUT_MS',
      DEFAULT_LOADING_TIMEOUT_MS,
      1_000,
      10 * 60_000,
    ),
    settleMs: boundedInteger('KODETY_E2E_PERF_SETTLE_MS', DEFAULT_SETTLE_MS, 500, 10_000),
    soakDurationMs: boundedInteger(
      'KODETY_E2E_SOAK_DURATION_MS',
      DEFAULT_SOAK_DURATION_MS,
      DEFAULT_SOAK_DURATION_MS,
      2 * 60 * 60_000,
    ),
    soakCycleMs: boundedInteger(
      'KODETY_E2E_SOAK_CYCLE_MS',
      DEFAULT_SOAK_CYCLE_MS,
      1_000,
      60_000,
    ),
    soakOpenSelector: requiredEnvironment('KODETY_E2E_SOAK_OPEN_SELECTOR'),
    soakCloseSelector: requiredEnvironment('KODETY_E2E_SOAK_CLOSE_SELECTOR'),
    targets: [
      {
        name: 'Builder',
        slug: 'builder',
        url: sameOriginUrl(siteBase, profileBuilderVariable, builderFallback),
        readySelector: '[data-workspace-topbar]',
        observabilityRequired: true,
        projectPhasesRequired: true,
        interactionSelector: requiredEnvironment('KODETY_E2E_BUILDER_INTERACTION_SELECTOR'),
      },
      {
        name: 'Settings',
        slug: 'settings',
        url: sameOriginUrl(siteBase, 'KODETY_E2E_SETTINGS_URL', 'kodety/settings/'),
        readySelector: 'main[data-kodety-light-workspace="settings"]',
        observabilityRequired: true,
        interactionSelector: requiredEnvironment('KODETY_E2E_SETTINGS_INTERACTION_SELECTOR'),
      },
      {
        name: 'CMS',
        slug: 'cms',
        url: sameOriginUrl(siteBase, 'KODETY_E2E_CMS_URL', 'kodety/cms/'),
        readySelector: 'main [data-workspace-topbar], main[data-kodety-read-only] [data-workspace-topbar]',
        observabilityRequired: true,
        interactionSelector: requiredEnvironment('KODETY_E2E_CMS_INTERACTION_SELECTOR'),
      },
      {
        name: 'Analytics',
        slug: 'analytics',
        url: sameOriginUrl(siteBase, 'KODETY_E2E_ANALYTICS_URL', 'kodety/analytics/'),
        readySelector: 'main[data-kodety-light-workspace="analytics"]',
        observabilityRequired: true,
        interactionSelector: requiredEnvironment('KODETY_E2E_ANALYTICS_INTERACTION_SELECTOR'),
      },
      {
        name: 'Localization',
        slug: 'localization',
        url: sameOriginUrl(siteBase, 'KODETY_E2E_LOCALIZATION_URL', 'kodety/localization/'),
        readySelector: '[data-kodety-agent-surface="localization"]',
        observabilityRequired: true,
        interactionSelector: requiredEnvironment('KODETY_E2E_LOCALIZATION_INTERACTION_SELECTOR'),
      },
      {
        name: 'Email',
        slug: 'email',
        url: sameOriginUrl(siteBase, 'KODETY_E2E_EMAIL_URL', 'wp-admin/admin.php?page=kodety-emails'),
        readySelector: '.wrap.kodety-emails',
        interactionSelector: requiredEnvironment('KODETY_E2E_EMAIL_INTERACTION_SELECTOR'),
      },
      {
        name: 'File System',
        slug: 'file-system',
        url: sameOriginUrl(siteBase, 'KODETY_E2E_FILE_SYSTEM_URL', 'kodety-files/'),
        readySelector: '#kodety-file-system-root',
        interactionSelector: requiredEnvironment('KODETY_E2E_FILE_SYSTEM_INTERACTION_SELECTOR'),
      },
    ],
  };
}

function loadPublishedTarget(environment) {
  return {
    name: 'Published Page',
    slug: 'published-page',
    url: sameOriginUrl(
      environment.siteBase,
      'KODETY_E2E_PUBLISHED_URL',
      requiredEnvironment('KODETY_E2E_PUBLISHED_URL'),
    ),
    readySelector: process.env.KODETY_E2E_PUBLISHED_READY_SELECTOR?.trim() || 'body',
    expectedMarker: requiredEnvironment('KODETY_E2E_PUBLISHED_MARKER'),
    observabilityRequired: false,
    visualMetricsRequired: true,
    interactionSelector: requiredEnvironment('KODETY_E2E_PUBLISHED_INTERACTION_SELECTOR'),
  };
}

function loadLazyTransitionTargets(environment) {
  const definitions = [
    ['Settings', 'KODETY_E2E_SETTINGS_TRIGGER_SELECTOR', 'KODETY_E2E_SETTINGS_LAZY_RESOURCE_REGEX'],
    ['CMS', 'KODETY_E2E_CMS_TRIGGER_SELECTOR', 'KODETY_E2E_CMS_LAZY_RESOURCE_REGEX'],
    ['Analytics', 'KODETY_E2E_ANALYTICS_TRIGGER_SELECTOR', 'KODETY_E2E_ANALYTICS_LAZY_RESOURCE_REGEX'],
    ['Localization', 'KODETY_E2E_LOCALIZATION_TRIGGER_SELECTOR', 'KODETY_E2E_LOCALIZATION_LAZY_RESOURCE_REGEX'],
    ['Email', 'KODETY_E2E_EMAIL_TRIGGER_SELECTOR', 'KODETY_E2E_EMAIL_LAZY_RESOURCE_REGEX'],
    ['File System', 'KODETY_E2E_FILE_SYSTEM_TRIGGER_SELECTOR', 'KODETY_E2E_FILE_SYSTEM_LAZY_RESOURCE_REGEX'],
  ];
  return definitions.map(([name, triggerEnvironment, resourceEnvironment]) => {
    const target = environment.targets.find(candidate => candidate.name === name);
    if (!target) throw new Error(`Alvo lazy ${name} não foi configurado.`);
    const source = requiredEnvironment(resourceEnvironment);
    let lazyResourcePattern;
    try {
      lazyResourcePattern = new RegExp(source, 'i');
    } catch {
      throw new Error(`${resourceEnvironment} deve ser uma expressão regular válida.`);
    }
    return {
      ...target,
      triggerSelector: requiredEnvironment(triggerEnvironment),
      lazyResourcePattern,
      triggerEnvironment,
      resourceEnvironment,
    };
  });
}

function compileAllowlist(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  let entries;
  if (raw.startsWith('[')) {
    try {
      entries = JSON.parse(raw);
    } catch {
      throw new Error(`${name} deve ser um array JSON de regexes.`);
    }
  } else {
    entries = raw.split(/\r?\n/);
  }
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) {
    throw new Error(`${name} deve conter apenas regexes em texto.`);
  }
  return entries.filter(Boolean).map(pattern => new RegExp(pattern, 'i'));
}

function allowed(value, patterns) {
  return patterns.some(pattern => pattern.test(value));
}

function artifactSecretPolicy(environment) {
  return {
    // Username de baixa entropia (por exemplo, "admin") precisa ser redigido
    // nos campos de origem, mas não pode ser procurado como substring global
    // porque faz parte de rotas legítimas como /wp-admin/.
    redact: [environment.username, environment.password],
    forbid: [environment.password],
  };
}

function diagnosticFingerprintLabel(fingerprint) {
  return fingerprint.category + ':' + fingerprint.sizeBytes + ':sha256:' + fingerprint.sha256;
}

function normalizedDiagnosticFingerprint(value, secrets) {
  if (
    value
    && typeof value === 'object'
    && ['empty', 'timeout', 'http', 'network', 'authorization', 'other'].includes(value.category)
    && Number.isInteger(value.sizeBytes)
    && value.sizeBytes >= 0
    && /^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    return value;
  }
  return diagnosticFingerprint(value, secrets);
}

async function writeArtifactSetAtomically(files) {
  const staged = files.map(file => ({
    ...file,
    temporaryPath: `${file.path}.${process.pid}.${Date.now()}.tmp`,
  }));
  const committed = [];
  try {
    const writeResults = await Promise.allSettled(staged.map(file => writeFile(
      file.temporaryPath,
      file.source,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    )));
    const rejectedWrite = writeResults.find(result => result.status === 'rejected');
    if (rejectedWrite) throw rejectedWrite.reason;
    for (const file of staged) {
      await rename(file.temporaryPath, file.path);
      committed.push(file.path);
    }
  } catch (error) {
    await Promise.allSettled([
      ...staged.map(file => rm(file.temporaryPath, { force: true })),
      ...committed.map(file => rm(file, { force: true })),
    ]);
    throw error;
  }
}

function createEvidenceRecorder(page, metadata, secrets, authorizedOrigin) {
  const consoleAllowlist = compileAllowlist('KODETY_E2E_CONSOLE_ERROR_ALLOWLIST');
  const httpAllowlist = compileAllowlist('KODETY_E2E_HTTP_ERROR_ALLOWLIST');
  const failures = [];
  const entries = [];
  const events = [];
  const requestEntries = new WeakMap();
  const pendingFinalizers = new Set();
  const inFlightRequests = new Set();
  const startedAt = nodePerformance.now();
  let lastNetworkActivityAt = startedAt;
  let droppedFailures = 0;
  let stopped = false;

  const addFailure = (label, rawValue, allowlist) => {
    const value = redactDiagnostic(rawValue, secrets);
    if (allowed(value, allowlist)) return;
    const fingerprint = diagnosticFingerprint(rawValue, secrets);
    if (failures.length < MAX_MONITOR_FAILURES - 1) {
      failures.push(`${label}: ${diagnosticFingerprintLabel(fingerprint)}`);
      return;
    }
    droppedFailures += 1;
    failures[MAX_MONITOR_FAILURES - 1] = `monitor: ${droppedFailures} falha(s) adicional(is) omitida(s)`;
  };
  const record = (name, data = {}) => {
    events.push({
      atMs: rounded(Math.max(0, nodePerformance.now() - startedAt)),
      name,
      data,
    });
  };
  const onConsole = message => {
    if (message.type() !== 'error') return;
    const value = redactDiagnostic(message.text(), secrets);
    record('console.error', { diagnostic: diagnosticFingerprint(value, secrets) });
    addFailure('console.error', value, consoleAllowlist);
  };
  const onRequest = request => {
    inFlightRequests.add(request);
    lastNetworkActivityAt = nodePerformance.now();
    const method = request.method().toUpperCase();
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(method)
      && new URL(request.url()).origin !== authorizedOrigin
    ) {
      addFailure('escrita cross-origin escapou do guard', `${method} ${redactedUrl(request.url())}`, []);
    }
    if (entries.length >= MAX_NETWORK_ENTRIES) return;
    const requestStartedAt = Date.now();
    const entry = {
      startedDateTime: new Date(requestStartedAt).toISOString(),
      time: 0,
      request: {
        method: request.method(),
        url: redactedUrl(request.url()),
        httpVersion: '',
        headers: [],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: 0,
        statusText: '',
        httpVersion: '',
        headers: [],
        cookies: [],
        content: { size: 0, mimeType: '' },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: -1, receive: 0 },
      _startedAt: requestStartedAt,
    };
    entries.push(entry);
    requestEntries.set(request, entry);
  };
  const onResponse = response => {
    const entry = requestEntries.get(response.request());
    if (entry) {
      entry.time = Math.max(0, Date.now() - entry._startedAt);
      entry.response.status = response.status();
      entry.response.statusText = redactDiagnostic(response.statusText(), secrets);
    }
    if (response.status() >= 400) {
      addFailure(
        'HTTP inesperado',
        `${response.status()} ${redactedUrl(response.url())}`,
        httpAllowlist,
      );
    }
  };
  const onRequestFailed = request => {
    inFlightRequests.delete(request);
    lastNetworkActivityAt = nodePerformance.now();
    const failure = request.failure()?.errorText || 'falha de rede';
    const entry = requestEntries.get(request);
    if (entry) {
      entry.time = Number.isFinite(entry._startedAt)
        ? Math.max(0, Date.now() - entry._startedAt)
        : entry.time;
      entry._failureText = diagnosticFingerprintLabel(
        diagnosticFingerprint(failure, secrets),
      );
      delete entry._startedAt;
    }
    addFailure('requestfailed', `${failure} ${redactedUrl(request.url())}`, httpAllowlist);
  };
  const finalizeRequest = async request => {
    const entry = requestEntries.get(request);
    if (!entry) return;
    const [sizes, response] = await Promise.all([request.sizes(), request.response()]);
    entry.request.headersSize = sizes.requestHeadersSize;
    entry.request.bodySize = sizes.requestBodySize;
    entry.response.headersSize = sizes.responseHeadersSize;
    entry.response.bodySize = sizes.responseBodySize;
    entry.response.content.size = sizes.responseBodySize;
    if (response) {
      entry.response.content.mimeType = redactDiagnostic(
        (await response.headerValue('content-type')) || '',
        secrets,
        200,
      );
    }
    const timing = request.timing();
    if (timing.responseEnd >= 0) {
      entry.time = Math.max(0, timing.responseEnd);
      entry.timings.dns = timing.domainLookupStart >= 0 && timing.domainLookupEnd >= 0
        ? Math.max(0, timing.domainLookupEnd - timing.domainLookupStart)
        : -1;
      entry.timings.connect = timing.connectStart >= 0 && timing.connectEnd >= 0
        ? Math.max(0, timing.connectEnd - timing.connectStart)
        : -1;
      entry.timings.ssl = timing.secureConnectionStart >= 0 && timing.connectEnd >= 0
        ? Math.max(0, timing.connectEnd - timing.secureConnectionStart)
        : -1;
      entry.timings.wait = timing.requestStart >= 0 && timing.responseStart >= 0
        ? Math.max(0, timing.responseStart - timing.requestStart)
        : -1;
      entry.timings.receive = timing.responseStart >= 0
        ? Math.max(0, timing.responseEnd - timing.responseStart)
        : -1;
    }
    delete entry._startedAt;
  };
  const onRequestFinished = request => {
    inFlightRequests.delete(request);
    lastNetworkActivityAt = nodePerformance.now();
    const pending = finalizeRequest(request);
    pendingFinalizers.add(pending);
    void pending.then(
      () => pendingFinalizers.delete(pending),
      error => {
        pendingFinalizers.delete(pending);
        addFailure('falha ao finalizar waterfall', error instanceof Error ? error.message : error, []);
      },
    );
  };
  page.on('console', onConsole);
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  page.on('requestfinished', onRequestFinished);
  record('sample-start', metadata);

  return {
    entries,
    events,
    failures,
    record,
    async waitForNetworkQuiet(
      quietMs = NETWORK_QUIET_MS,
      timeoutMs = 10_000,
    ) {
      const deadline = nodePerformance.now() + timeoutMs;
      while (true) {
        const now = nodePerformance.now();
        if (inFlightRequests.size === 0 && now - lastNetworkActivityAt >= quietMs) return;
        if (now >= deadline) {
          throw new Error(
            `A rede não ficou ociosa: ${inFlightRequests.size} request(s) ainda em voo.`,
          );
        }
        await page.waitForTimeout(Math.min(50, Math.max(1, deadline - now)));
      }
    },
    async settle() {
      while (pendingFinalizers.size > 0) {
        await Promise.allSettled([...pendingFinalizers]);
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (inFlightRequests.size > 0) {
        addFailure(
          'recorder encerrado com rede ativa',
          `${inFlightRequests.size} request(s) ainda em voo`,
          [],
        );
      }
      page.off('console', onConsole);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
      page.off('requestfinished', onRequestFinished);
    },
  };
}

function evidenceStem(environment, target, mode, sampleNumber) {
  return [
    environment.runId,
    environment.profile,
    environment.throttleName,
    target.slug,
    mode,
    String(sampleNumber).padStart(2, '0'),
  ].join('-');
}

async function writeRedactedEvidence({ environment, target, mode, sampleNumber, recorder, reason }) {
  await recorder.settle();
  await mkdir(ARTIFACT_ROOT, { recursive: true, mode: 0o700 });
  const stem = evidenceStem(environment, target, mode, sampleNumber);
  const tracePath = path.join(ARTIFACT_ROOT, `${stem}.trace.json`);
  const harPath = path.join(ARTIFACT_ROOT, `${stem}.har`);
  const safeReason = reason
    ? normalizedDiagnosticFingerprint(reason, [environment.username, environment.password])
    : null;
  const trace = {
    schemaVersion: 1,
    kind: 'kodety-redacted-playwright-diagnostic-trace',
    profile: environment.profile,
    target: target.name,
    mode,
    sample: sampleNumber,
    throttle: environment.throttleName,
    reason: safeReason,
    events: recorder.events,
  };
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'kodety-wordpress-performance', version: '1' },
      pages: [],
      entries: recorder.entries.map(({ _startedAt, ...entry }) => entry),
    },
  };
  const secretPolicy = artifactSecretPolicy(environment);
  // Todos os artefatos são redigidos e validados antes do primeiro write.
  const traceSource = serializeRedactedArtifact(trace, secretPolicy);
  const harSource = serializeRedactedArtifact(har, secretPolicy);
  await writeArtifactSetAtomically([
    { path: tracePath, source: traceSource },
    { path: harPath, source: harSource },
  ]);
  return { tracePath, harPath };
}

async function firstVisibleLocator(scope, selector, label, timeout) {
  const candidates = scope.locator(selector);
  let visibleIndex = -1;
  await expect.poll(async () => {
    visibleIndex = -1;
    const count = Math.min(await candidates.count(), 250);
    for (let index = 0; index < count; index += 1) {
      if (await candidates.nth(index).isVisible()) {
        visibleIndex = index;
        break;
      }
    }
    return visibleIndex;
  }, { message: `${label} deve ficar visível`, timeout }).toBeGreaterThanOrEqual(0);
  return candidates.nth(visibleIndex);
}

async function waitForWorkspaceReady(page, target, timeout) {
  const ready = await firstVisibleLocator(page, target.readySelector, target.name, timeout);
  await expect(ready, `${target.name} deve renderizar sua superfície real`).toBeVisible({ timeout });
  await page.waitForFunction(() => {
    const selectors = '.kodety-boot-loader, [data-kodety-loading-screen]';
    return [...document.querySelectorAll(selectors)].every(element => {
      if (element.getAttribute('aria-busy') === 'false') return true;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display === 'none'
        || style.visibility === 'hidden'
        || Number(style.opacity) === 0
        || rect.width === 0
        || rect.height === 0;
    });
  }, null, { timeout });
  await expect.poll(
    () => ready.evaluate(element => Boolean(
      element.querySelector('button, a, input, textarea, select, iframe, main, section, [role="main"]')
      || element.textContent?.trim(),
    )),
    { message: `${target.name} permaneceu vazio/loading`, timeout },
  ).toBe(true);
  if (target.expectedMarker) {
    await expect(
      page.locator('body'),
      `${target.name} deve corresponder à publicação da fixture`,
    ).toContainText(target.expectedMarker, { timeout });
  }
}

function assertSameOrigin(rawUrl, siteBase, label) {
  const resolved = new URL(rawUrl, siteBase);
  if (resolved.origin !== siteBase.origin) {
    throw new Error(`${label} saiu da origem autorizada ${siteBase.origin}.`);
  }
  return resolved;
}

async function blockCrossOriginWrites(context, siteBase) {
  const blocked = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const destination = new URL(request.url());
      if (destination.origin !== siteBase.origin) {
        blocked.push(`${method} ${redactedUrl(destination.href)}`);
        await route.abort('blockedbyclient');
        return;
      }
    }
    await route.continue();
  });
  return blocked;
}

async function installCrossOriginWriteGuard(context, siteBase) {
  await context.addInitScript(allowedOrigin => {
    const blocked = [];
    Object.defineProperty(window, '__KODETY_E2E_BLOCKED_WRITES__', {
      configurable: false,
      value: blocked,
    });
    const isBlocked = (method, rawUrl) => {
      const normalizedMethod = String(method || 'GET').toUpperCase();
      if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) return false;
      try {
        if (new URL(String(rawUrl), location.href).origin === allowedOrigin) return false;
      } catch {
        // URL de escrita que não pode ser validada também deve ser bloqueada.
      }
      blocked.push({ method: normalizedMethod });
      return true;
    };

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const method = init.method || (input instanceof Request ? input.method : 'GET');
      const url = input instanceof Request ? input.url : input;
      if (isBlocked(method, url)) {
        return Promise.reject(new TypeError('Cross-origin write blocked by E2E guard.'));
      }
      return nativeFetch(input, init);
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function guardedOpen(method, url, ...rest) {
      this.__kodetyE2eWrite = { method, url };
      return nativeOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function guardedSend(...args) {
      const request = this.__kodetyE2eWrite || {};
      if (isBlocked(request.method, request.url)) {
        throw new DOMException('Cross-origin write blocked by E2E guard.', 'SecurityError');
      }
      return nativeSend.apply(this, args);
    };

    const nativeBeacon = navigator.sendBeacon?.bind(navigator);
    if (nativeBeacon) {
      navigator.sendBeacon = (url, data) => {
        if (isBlocked('POST', url)) return false;
        return nativeBeacon(url, data);
      };
    }
    document.addEventListener('submit', event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (isBlocked(form.method || 'GET', form.action || location.href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }, siteBase.origin);
}

async function login(page, environment) {
  const response = await page.goto(environment.loginUrl, { waitUntil: 'domcontentloaded' });
  expect(response, 'Login WordPress deve responder').not.toBeNull();
  expect(response.status(), `Login WordPress respondeu ${response.status()}`).toBeLessThan(400);
  assertSameOrigin(page.url(), environment.siteBase, 'Redirect do login');
  const username = page.locator('#user_login, input[name="log"], input[name="username"]').first();
  const password = page.locator('#user_pass, input[name="pwd"], input[type="password"]').first();
  await expect(username, 'Campo de usuário do login real').toBeVisible();
  await expect(password, 'Campo de senha do login real').toBeVisible();
  const formAction = await username.evaluate(element => element.form?.action || '');
  if (!formAction) throw new Error('O formulário de login não expõe uma action verificável.');
  assertSameOrigin(formAction, environment.siteBase, 'Action do formulário de login');
  await username.fill(environment.username);
  await password.fill(environment.password);
  const loginPageUrl = page.url();
  await Promise.all([
    page.waitForURL(
      url => url.origin === environment.siteBase.origin && url.href !== loginPageUrl,
      { waitUntil: 'domcontentloaded' },
    ),
    page.locator('#wp-submit, button[type="submit"], input[type="submit"]').first().click(),
  ]);
  assertSameOrigin(page.url(), environment.siteBase, 'Redirect após autenticação');
  await expect(username, 'O WordPress permaneceu na tela de login').toBeHidden();
  const cookies = await page.context().cookies(environment.siteBase.href);
  expect(
    cookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_')),
    'Login real deve criar o cookie autenticado do WordPress',
  ).toBe(true);
}

async function installPerformanceObservers(context) {
  await context.addInitScript(({ resourceTimingBufferSize }) => {
    performance.setResourceTimingBufferSize?.(resourceTimingBufferSize);
    const state = {
      lcpMs: null,
      cls: 0,
      longTaskCount: 0,
      longTaskTotalMs: 0,
      longTaskMaxMs: 0,
      blockingTimeUntilReadyMs: 0,
      maxEventDurationMs: 0,
      interactionDurations: {},
      lcpElement: null,
      resourceTimingBufferSize,
      resourceTimingBufferOverflow: false,
      observerStatus: {},
    };
    Object.defineProperty(window, '__KODETY_E2E_PERFORMANCE__', {
      configurable: true,
      value: state,
    });
    const supported = new Set(PerformanceObserver.supportedEntryTypes || []);
    performance.addEventListener?.('resourcetimingbufferfull', () => {
      state.resourceTimingBufferOverflow = true;
    });
    const observe = (type, callback, options = {}) => {
      const status = {
        supported: supported.has(type),
        active: false,
        error: null,
      };
      state.observerStatus[type] = status;
      if (!status.supported) return;
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) callback(entry);
        });
        observer.observe({ type, buffered: true, ...options });
        status.active = true;
      } catch (error) {
        status.error = error instanceof Error ? error.name : 'ObserverError';
      }
    };
    observe('largest-contentful-paint', entry => {
      state.lcpMs = Math.max(state.lcpMs, entry.renderTime || entry.loadTime || entry.startTime || 0);
      const element = entry.element;
      if (element instanceof Element) {
        const rect = element.getBoundingClientRect();
        const image = element instanceof HTMLImageElement ? element : null;
        state.lcpElement = {
          tagName: element.tagName.toLowerCase(),
          renderedWidth: Math.round(Math.max(0, rect.width)),
          renderedHeight: Math.round(Math.max(0, rect.height)),
          intrinsicWidth: image?.naturalWidth || null,
          intrinsicHeight: image?.naturalHeight || null,
          hasWidthAttribute: element.hasAttribute('width'),
          hasHeightAttribute: element.hasAttribute('height'),
          fetchPriority: image?.fetchPriority || null,
          loading: image?.loading || null,
          startsInViewport: rect.top < innerHeight && rect.bottom > 0,
        };
      }
    });
    observe('layout-shift', entry => {
      if (!entry.hadRecentInput) state.cls += entry.value || 0;
    });
    observe('longtask', entry => {
      state.longTaskCount += 1;
      state.longTaskTotalMs += entry.duration || 0;
      state.longTaskMaxMs = Math.max(state.longTaskMaxMs, entry.duration || 0);
      state.blockingTimeUntilReadyMs += Math.max(0, (entry.duration || 0) - 50);
    });
    observe('event', entry => {
      state.maxEventDurationMs = Math.max(state.maxEventDurationMs, entry.duration || 0);
      const interactionId = Number(entry.interactionId || 0);
      if (Number.isSafeInteger(interactionId) && interactionId > 0) {
        state.interactionDurations[interactionId] = Math.max(
          state.interactionDurations[interactionId] || 0,
          entry.duration || 0,
        );
      }
    }, { durationThreshold: 16 });
  }, { resourceTimingBufferSize: RESOURCE_TIMING_BUFFER_SIZE });
}

async function applyThrottle(client, throttle) {
  await client.send('Network.enable');
  await client.send('Performance.enable');
  const downloadThroughput = throttle.downloadBitsPerSecond > 0
    ? throttle.downloadBitsPerSecond / 8
    : -1;
  const uploadThroughput = throttle.uploadBitsPerSecond > 0
    ? throttle.uploadBitsPerSecond / 8
    : -1;
  let networkApi = 'Network.emulateNetworkConditionsByRule';
  try {
    await client.send('Network.emulateNetworkConditionsByRule', {
      offline: false,
      matchedNetworkConditions: [{
        // O protocolo CDP define a string vazia como a regra global.
        urlPattern: '',
        latency: throttle.latencyMs,
        downloadThroughput,
        uploadThroughput,
      }],
    });
  } catch {
    // Uma implementação parcialmente compatível não pode deixar regra moderna
    // residual antes da aplicação do fallback legado.
    await client.send('Network.emulateNetworkConditionsByRule', {
      offline: false,
      matchedNetworkConditions: [],
    }).catch(() => {});
    networkApi = 'Network.emulateNetworkConditions';
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: throttle.latencyMs,
      downloadThroughput,
      uploadThroughput,
      connectionType: throttle.connectionType,
    });
  }
  if (networkApi === 'Network.emulateNetworkConditionsByRule') {
    try {
      await client.send('Network.overrideNetworkState', {
        offline: false,
        latency: throttle.latencyMs,
        downloadThroughput,
        uploadThroughput,
        connectionType: throttle.connectionType,
      });
    } catch {
      networkApi = 'Network.emulateNetworkConditionsByRule (navigator override indisponível)';
    }
  }
  await client.send('Emulation.setCPUThrottlingRate', {
    rate: throttle.cpuSlowdownMultiplier,
  });
  return networkApi;
}

async function readCdpPerformanceMetrics(client) {
  const { metrics } = await client.send('Performance.getMetrics');
  const result = Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
  for (const required of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'JSHeapUsedSize']) {
    if (!Number.isFinite(result[required])) {
      throw new Error(`Chromium não expôs a métrica CDP obrigatória ${required}.`);
    }
  }
  return result;
}

async function startInMemorySpeedIndexCapture(client) {
  const frames = [];
  let active = true;
  const appendFrame = data => {
    if (!active || typeof data !== 'string' || frames.length >= MAXIMUM_SPEED_INDEX_FRAMES - 1) {
      return;
    }
    const previousTimestamp = frames.at(-1)?.timestampSeconds ?? -1;
    frames.push({
      timestampSeconds: Math.max(nodePerformance.now() / 1_000, previousTimestamp + 0.000_001),
      data,
    });
  };
  const onFrame = event => {
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    appendFrame(event.data);
  };
  await client.send('Page.enable');
  const baseline = await client.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 45,
    fromSurface: true,
  });
  appendFrame(baseline.data);
  client.on('Page.screencastFrame', onFrame);
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 45,
    maxWidth: 1_440,
    maxHeight: 1_000,
    everyNthFrame: 1,
  });

  const stop = async calculate => {
    if (!active) return null;
    await client.send('Page.stopScreencast').catch(() => {});
    client.off('Page.screencastFrame', onFrame);
    const finalFrame = await client.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 45,
      fromSurface: true,
    }).catch(() => null);
    if (finalFrame?.data) {
      if (frames.length >= MAXIMUM_SPEED_INDEX_FRAMES) frames.pop();
      const previousTimestamp = frames.at(-1)?.timestampSeconds ?? -1;
      frames.push({
        timestampSeconds: Math.max(nodePerformance.now() / 1_000, previousTimestamp + 0.000_001),
        data: finalFrame.data,
      });
    }
    active = false;
    if (!calculate) {
      frames.length = 0;
      return null;
    }
    if (frames.length < 2) {
      throw new Error('A página publicada não produziu frames suficientes para Speed Index.');
    }
    const speedIndexMs = await calculateSpeedIndex(frames);
    frames.length = 0;
    return rounded(speedIndexMs);
  };
  return {
    finish: () => stop(true),
    abort: () => stop(false),
  };
}

function requiredCdpMetric(metrics, name) {
  const value = metrics[name];
  if (!Number.isFinite(value)) {
    throw new Error(`Chromium não expôs a métrica CDP obrigatória ${name}.`);
  }
  return value;
}

function cdpDelta(before, after, name, scale = 1) {
  const value = requiredCdpMetric(after, name) - requiredCdpMetric(before, name);
  return rounded(Math.max(0, value) * scale);
}

function cdpSignedDelta(before, after, name, scale = 1) {
  const value = requiredCdpMetric(after, name) - requiredCdpMetric(before, name);
  return rounded(value * scale);
}

async function navigateAndMeasure(page, client, target, environment, recorder, mode) {
  recorder.record('measured-navigation-start', { target: target.name });
  const cdpBefore = await readCdpPerformanceMetrics(client);
  const response = await page.goto(target.url, { waitUntil: 'commit' });
  expect(response, `${target.name} deve responder à navegação medida`).not.toBeNull();
  expect(response.status(), `${target.name} respondeu ${response.status()}`).toBeLessThan(400);
  assertSameOrigin(page.url(), environment.siteBase, `Redirect de ${target.name}`);
  const loadResult = page.waitForLoadState('load', { timeout: environment.loadingTimeoutMs })
    .then(() => null, error => error);
  await waitForWorkspaceReady(page, target, environment.loadingTimeoutMs);
  const readyMs = await page.evaluate(() => performance.now());
  const observedAtReady = await page.evaluate(() => {
    const observed = window.__KODETY_E2E_PERFORMANCE__ || {};
    return {
      longTaskCount: observed.longTaskCount || 0,
      longTaskTotalMs: observed.longTaskTotalMs || 0,
      longTaskMaxMs: observed.longTaskMaxMs || 0,
      blockingTimeUntilReadyMs: observed.blockingTimeUntilReadyMs || 0,
    };
  });
  recorder.record('workspace-ready', { readyMs: rounded(readyMs) });
  const loadError = await loadResult;
  if (loadError) throw loadError;
  await page.waitForTimeout(environment.settleMs);
  await recorder.waitForNetworkQuiet(
    NETWORK_QUIET_MS,
    Math.min(environment.loadingTimeoutMs, 10_000),
  );
  await recorder.settle();
  const blockedWriteCount = await page.evaluate(() => (
    Array.isArray(window.__KODETY_E2E_BLOCKED_WRITES__)
      ? window.__KODETY_E2E_BLOCKED_WRITES__.length
      : 0
  ));
  if (blockedWriteCount > 0) {
    throw new Error(`${target.name} tentou ${blockedWriteCount} escrita(s) cross-origin.`);
  }
  const cdpAfter = await readCdpPerformanceMetrics(client);

  const metrics = await page.evaluate(({ measuredReadyMs, readyLongTasks, siteOrigin, publishedAudit }) => {
    const round = (value, precision = 2) => {
      if (!Number.isFinite(value)) return null;
      const factor = 10 ** precision;
      return Math.round(value * factor) / factor;
    };
    const navigation = performance.getEntriesByType('navigation').at(-1);
    const resources = performance.getEntriesByType('resource');
    const isThirdParty = entry => {
      try {
        return new URL(entry.name).origin !== siteOrigin;
      } catch {
        return false;
      }
    };
    const thirdPartyResources = resources.filter(isThirdParty);
    const paints = performance.getEntriesByType('paint');
    const fcp = paints.find(entry => entry.name === 'first-contentful-paint');
    const observed = window.__KODETY_E2E_PERFORMANCE__ || {};
    const allowedOperations = new Set([
      'bootstrap', 'config', 'surface', 'asset', 'project_download',
      'unzip', 'parse', 'mount', 'save', 'publish',
      'project_download_body', 'project_unzip', 'project_parse',
      'project_first_canvas_visual_ready',
    ]);
    const allowedResults = new Set([
      'ok', 'error', 'aborted', 'http_error', 'not_modified',
      'correlation_error', 'cache_hit', 'cache_miss', 'fallback', 'skipped',
    ]);
    const allowedTransports = new Set([
      'surface', 'asset', 'project', 'delta', 'archive', 'chunk', 'publish',
    ]);
    const kodetyPhases = Array.isArray(window.__kodetyPerformance)
      ? window.__kodetyPerformance
        .filter(entry => allowedOperations.has(entry?.operation))
        .map(entry => ({
          operation: entry.operation,
          operationId: /^(?:obs|trace)-[0-9a-f]{32}$/.test(entry.operationId)
            ? entry.operationId
            : undefined,
          durationMs: round(entry.durationMs),
          result: allowedResults.has(entry.result) ? entry.result : undefined,
          status: Number.isSafeInteger(entry.status) ? entry.status : undefined,
          bytes: Number.isSafeInteger(entry.bytes) ? entry.bytes : undefined,
          attempt: Number.isSafeInteger(entry.attempt) && entry.attempt >= 0 && entry.attempt <= 100
            ? entry.attempt
            : undefined,
          cache: ['hit', 'miss', 'bypass'].includes(entry.cache) ? entry.cache : undefined,
          fallback: ['none', 'full_project', 'archive'].includes(entry.fallback)
            ? entry.fallback
            : undefined,
          transport: allowedTransports.has(entry.transport) ? entry.transport : undefined,
        }))
      : [];
    const sum = (entries, key) => entries.reduce((total, entry) => total + (entry[key] || 0), 0);
    const serverTiming = [navigation, ...resources].flatMap(entry => (
      Array.from(entry?.serverTiming || [], timing => ({
        name: /^[a-z0-9_-]{1,64}$/i.test(timing.name) ? timing.name : 'redacted',
        durationMs: round(timing.duration),
      }))
    ));
    return {
      ttfbMs: round(navigation?.responseStart),
      fcpMs: round(fcp?.startTime),
      lcpMs: round(observed.lcpMs),
      cls: round(observed.cls || 0, 4),
      domContentLoadedMs: round(navigation?.domContentLoadedEventEnd),
      loadMs: round(navigation?.loadEventEnd),
      readyMs: round(measuredReadyMs),
      requestCount: resources.length + (navigation ? 1 : 0),
      transferBytes: Math.round((navigation?.transferSize || 0) + sum(resources, 'transferSize')),
      encodedBodyBytes: Math.round((navigation?.encodedBodySize || 0) + sum(resources, 'encodedBodySize')),
      decodedBodyBytes: Math.round((navigation?.decodedBodySize || 0) + sum(resources, 'decodedBodySize')),
      cachedResourceCount: resources.filter(entry => (
        entry.transferSize === 0 && entry.encodedBodySize > 0
      )).length,
      longTaskCount: readyLongTasks.longTaskCount,
      longTaskTotalMs: round(readyLongTasks.longTaskTotalMs),
      longTaskMaxMs: round(readyLongTasks.longTaskMaxMs),
      blockingTimeUntilReadyMs: round(readyLongTasks.blockingTimeUntilReadyMs),
      tbtMs: round(readyLongTasks.blockingTimeUntilReadyMs),
      maxEventDurationMs: round(observed.maxEventDurationMs || 0),
      thirdPartyRequestCount: thirdPartyResources.length,
      thirdPartyTransferBytes: Math.round(sum(thirdPartyResources, 'transferSize')),
      resourceTimingEntryCount: resources.length,
      resourceTimingBufferSize: observed.resourceTimingBufferSize,
      resourceTimingBufferOverflow: observed.resourceTimingBufferOverflow === true,
      observerStatus: observed.observerStatus || {},
      serverTiming,
      kodetyPhases,
      siteAudit: publishedAudit ? (() => {
        const belowFoldMedia = Array.from(document.querySelectorAll('img, iframe')).filter(element => (
          element.getBoundingClientRect().top >= innerHeight
        ));
        const stylesheetLinks = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
        const fontEntries = resources.filter(entry => (
          entry.initiatorType === 'css' && /\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(entry.name)
        ));
        const resourceGroups = {};
        for (const entry of resources) {
          const kind = /\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(entry.name)
            ? 'font'
            : entry.initiatorType || 'other';
          const party = isThirdParty(entry) ? 'thirdParty' : 'firstParty';
          const key = `${party}:${kind}`;
          const group = resourceGroups[key] || { requests: 0, transferBytes: 0, encodedBodyBytes: 0 };
          group.requests += 1;
          group.transferBytes += Math.round(entry.transferSize || 0);
          group.encodedBodyBytes += Math.round(entry.encodedBodySize || 0);
          resourceGroups[key] = group;
        }
        return {
          lcpElement: observed.lcpElement || null,
          belowFoldMedia: {
            total: belowFoldMedia.length,
            images: belowFoldMedia.filter(element => element instanceof HTMLImageElement).length,
            iframes: belowFoldMedia.filter(element => element instanceof HTMLIFrameElement).length,
            lazy: belowFoldMedia.filter(element => element.getAttribute('loading') === 'lazy').length,
          },
          images: {
            total: document.images.length,
            explicitDimensions: Array.from(document.images).filter(image => (
              image.hasAttribute('width') && image.hasAttribute('height')
            )).length,
            highPriority: Array.from(document.images).filter(image => image.fetchPriority === 'high').length,
          },
          renderBlocking: {
            stylesheetLinks: stylesheetLinks.length,
            matchingStylesheetLinks: stylesheetLinks.filter(link => !link.media || matchMedia(link.media).matches).length,
            fontsStatus: document.fonts?.status || 'unsupported',
            fontEntries: fontEntries.length,
          },
          resourceGroups,
        };
      })() : null,
    };
  }, {
    measuredReadyMs: readyMs,
    readyLongTasks: observedAtReady,
    siteOrigin: environment.siteBase.origin,
    publishedAudit: target.visualMetricsRequired === true,
  });
  metrics.cpuTaskDurationMs = cdpDelta(cdpBefore, cdpAfter, 'TaskDuration', 1_000);
  metrics.cpuScriptDurationMs = cdpDelta(cdpBefore, cdpAfter, 'ScriptDuration', 1_000);
  metrics.cpuLayoutDurationMs = cdpDelta(cdpBefore, cdpAfter, 'LayoutDuration', 1_000);
  metrics.jsHeapUsedDeltaBytes = cdpSignedDelta(cdpBefore, cdpAfter, 'JSHeapUsedSize');

  for (const metric of ['ttfbMs', 'fcpMs', 'lcpMs', 'domContentLoadedMs', 'loadMs', 'readyMs']) {
    if (!Number.isFinite(metrics[metric]) || metrics[metric] <= 0) {
      throw new Error(`${target.name} não produziu a métrica obrigatória ${metric}.`);
    }
  }
  if (!Number.isFinite(metrics.cls) || metrics.cls < 0 || metrics.requestCount <= 0) {
    throw new Error(`${target.name} produziu métricas de navegação inválidas.`);
  }
  if (
    metrics.resourceTimingBufferSize !== RESOURCE_TIMING_BUFFER_SIZE
    || !Number.isSafeInteger(metrics.resourceTimingEntryCount)
    || metrics.resourceTimingBufferOverflow
    || metrics.resourceTimingEntryCount >= metrics.resourceTimingBufferSize
  ) {
    throw new Error(
      `${target.name} excedeu o buffer de Resource Timing; a amostra seria truncada.`,
    );
  }
  for (const observerType of ['largest-contentful-paint', 'layout-shift', 'longtask', 'event']) {
    const status = metrics.observerStatus[observerType];
    if (!status?.supported || !status.active || status.error) {
      throw new Error(`${target.name} não ativou o observer obrigatório ${observerType}.`);
    }
  }
  if (target.observabilityRequired) {
    for (const requiredOperation of ['config', 'bootstrap', 'mount']) {
      const phase = metrics.kodetyPhases.find(entry => entry.operation === requiredOperation);
      if (!phase || !Number.isFinite(phase.durationMs) || phase.durationMs < 0) {
        throw new Error(
          `${target.name} não expôs a fase ${requiredOperation}; habilite KODETY_PERFORMANCE_DEBUG no WordPress descartável.`,
        );
      }
      if (['error', 'http_error', 'aborted'].includes(phase.result)) {
        throw new Error(`${target.name} expôs ${requiredOperation} com resultado ${phase.result}.`);
      }
    }
  }
  const projectPhases = metrics.kodetyPhases.filter(entry => entry.operation.startsWith('project_'));
  for (const phase of projectPhases) {
    if (
      !phase.operationId
      || !Number.isFinite(phase.durationMs)
      || phase.durationMs < 0
      || !['ok', 'error', 'aborted'].includes(phase.result)
      || !['hit', 'miss', 'bypass'].includes(phase.cache)
    ) {
      throw new Error(
        `${target.name} expôs ${phase.operation} sem correlação, duração, cache ou outcome fechado válido.`,
      );
    }
  }
  if (target.projectPhasesRequired) {
    const downloads = projectPhases.filter(entry => entry.operation === 'project_download_body');
    if (downloads.length !== 1) {
      throw new Error(`${target.name} ${mode} deve expor exatamente um project_download_body.`);
    }
    const download = downloads[0];
    if (download.result !== 'ok') {
      throw new Error(`${target.name} ${mode} não concluiu project_download_body com sucesso.`);
    }
    const lifecycle = projectPhases.filter(entry => entry.operationId === download.operationId);
    const lifecycleNames = new Set(lifecycle.map(entry => entry.operation));
    if (download.cache === 'hit') {
      if (mode === 'cold') {
        throw new Error('Builder cold não pode reutilizar um snapshot IndexedDB de outro contexto.');
      }
      for (const forbiddenPhase of ['project_unzip', 'project_parse']) {
        if (lifecycleNames.has(forbiddenPhase)) {
          throw new Error(`Builder warm cache-hit não pode executar ${forbiddenPhase}.`);
        }
      }
    } else {
      const requiredLifecycle = [
        'project_download_body',
        'project_unzip',
        'project_parse',
        'project_first_canvas_visual_ready',
      ];
      let previousIndex = -1;
      for (const requiredPhase of requiredLifecycle) {
        const phaseIndex = projectPhases.findIndex(entry => (
          entry.operationId === download.operationId
          && entry.operation === requiredPhase
          && entry.result === 'ok'
        ));
        if (phaseIndex <= previousIndex) {
          throw new Error(
            `${target.name} ${mode} não concluiu em ordem a cadeia download→unzip→parse→visual-ready.`,
          );
        }
        previousIndex = phaseIndex;
      }
    }
  }
  if (recorder.failures.length > 0) {
    throw new Error(recorder.failures.join(' | '));
  }
  recorder.record('metrics-collected', metrics);
  return metrics;
}

async function measureLabInp(page, target, timeoutMs) {
  const initialUrl = page.url();
  await page.evaluate(() => {
    const state = window.__KODETY_E2E_PERFORMANCE__;
    if (!state) throw new Error('Estado de Event Timing ausente para o probe de INP.');
    state.interactionDurations = {};
  });
  const probe = await firstVisibleLocator(
    page,
    target.interactionSelector,
    `Probe de INP de ${target.name}`,
    timeoutMs,
  );
  for (let index = 0; index < INP_PROBE_INTERACTIONS; index += 1) {
    await probe.click();
    if (page.url() !== initialUrl) {
      throw new Error(`O probe de INP de ${target.name} não pode navegar ou alterar a URL.`);
    }
    await page.waitForFunction(
      expectedCount => Object.keys(
        window.__KODETY_E2E_PERFORMANCE__?.interactionDurations || {},
      ).length > expectedCount,
      index,
      { timeout: Math.min(timeoutMs, 10_000) },
    );
  }
  const durations = await page.evaluate(() => Object.values(
    window.__KODETY_E2E_PERFORMANCE__?.interactionDurations || {},
  ));
  if (
    durations.length < INP_PROBE_INTERACTIONS
    || durations.some(value => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error(`${target.name} não produziu cinco interações Event Timing válidas.`);
  }
  const sorted = durations.slice().sort((left, right) => left - right);
  const percentileIndex = Math.max(0, Math.ceil(sorted.length * 0.98) - 1);
  return {
    inpMs: rounded(sorted[percentileIndex]),
    inpInteractionCount: sorted.length,
  };
}

async function createAuthenticatedState(browser, environment) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const blockedWrites = await blockCrossOriginWrites(context, environment.siteBase);
    await login(page, environment);
    const fixtureReceipt = await verifyInstalledFixtureFingerprint(context.request, environment);
    expect(blockedWrites, 'Login não pode tentar POST cross-origin').toEqual([]);
    return {
      storageState: await context.storageState(),
      fixtureReceipt,
    };
  } finally {
    await context.close();
  }
}

async function collectTimedMode(
  page,
  client,
  testInfo,
  environment,
  target,
  mode,
  sampleNumber,
  navigateToBlankAfterMeasurement = false,
) {
  let recorder;
  let speedIndexCapture;
  try {
    recorder = createEvidenceRecorder(
      page,
      { target: target.name, mode, sample: sampleNumber },
      [environment.username, environment.password],
      environment.siteBase.origin,
    );
    if (target.visualMetricsRequired) {
      speedIndexCapture = await startInMemorySpeedIndexCapture(client);
    }
    const metrics = await navigateAndMeasure(page, client, target, environment, recorder, mode);
    if (speedIndexCapture) {
      metrics.speedIndexMs = await speedIndexCapture.finish();
      speedIndexCapture = null;
    }
    Object.assign(
      metrics,
      await measureLabInp(page, target, environment.loadingTimeoutMs),
    );
    recorder.record('inp-probe-complete', {
      inpMs: metrics.inpMs,
      interactionCount: metrics.inpInteractionCount,
    });
    if (navigateToBlankAfterMeasurement) {
      // A página medida é abandonada ainda sob monitoramento. Qualquer request
      // tardio abortado aqui invalida o cold, em vez de contaminar o warm.
      await page.goto('about:blank', { waitUntil: 'commit' });
    }
    recorder.stop();
    await recorder.settle();
    if (recorder.failures.length > 0) {
      throw new Error(recorder.failures.join(' | '));
    }
    if (environment.evidenceMode === 'all') {
      const evidence = await writeRedactedEvidence({
        environment,
        target,
        mode,
        sampleNumber,
        recorder,
        reason: null,
      });
      await testInfo.attach(`${evidenceStem(environment, target, mode, sampleNumber)}.trace.json`, {
        path: evidence.tracePath,
        contentType: 'application/json',
      });
      await testInfo.attach(`${evidenceStem(environment, target, mode, sampleNumber)}.har`, {
        path: evidence.harPath,
        contentType: 'application/json',
      });
    }
    return metrics;
  } catch (error) {
    const safeReason = diagnosticFingerprint(
      error instanceof Error ? error.message : error,
      [environment.username, environment.password],
    );
    if (recorder) {
      recorder.record('sample-failed', { reason: safeReason });
      recorder.stop();
      await recorder.settle();
      const evidence = await writeRedactedEvidence({
        environment,
        target,
        mode,
        sampleNumber,
        recorder,
        reason: safeReason,
      });
      await testInfo.attach('redacted-performance-trace', {
        path: evidence.tracePath,
        contentType: 'application/json',
      });
      await testInfo.attach('redacted-performance-har', {
        path: evidence.harPath,
        contentType: 'application/json',
      });
    }
    throw new Error(
      `${target.name} ${mode} amostra ${sampleNumber} falhou: ${diagnosticFingerprintLabel(safeReason)}`,
    );
  } finally {
    await speedIndexCapture?.abort().catch(() => {});
    recorder?.stop();
  }
}

async function collectPair(browser, testInfo, environment, authenticatedState, target, sampleNumber) {
  const contextOptions = {
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  };
  if (authenticatedState) contextOptions.storageState = authenticatedState;
  const context = await browser.newContext(contextOptions);
  let client;
  try {
    if (!authenticatedState) {
      const cookies = await context.cookies(environment.siteBase.href);
      expect(
        cookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_')),
        'A página publicada deve ser medida em contexto anônimo.',
      ).toBe(false);
    }
    await installCrossOriginWriteGuard(context, environment.siteBase);
    await installPerformanceObservers(context);
    const page = await context.newPage();
    client = await context.newCDPSession(page);
    const networkThrottleApi = await applyThrottle(client, environment.throttle);
    await client.send('Network.clearBrowserCache');
    await client.send('Network.setCacheDisabled', { cacheDisabled: false });

    const cold = await collectTimedMode(
      page,
      client,
      testInfo,
      environment,
      target,
      'cold',
      sampleNumber,
      true,
    );
    cold.networkThrottleApi = networkThrottleApi;
    const warm = await collectTimedMode(
      page,
      client,
      testInfo,
      environment,
      target,
      'warm',
      sampleNumber,
    );
    warm.networkThrottleApi = networkThrottleApi;
    if (!authenticatedState) {
      const cookies = await context.cookies(environment.siteBase.href);
      expect(
        cookies.some(cookie => cookie.name.startsWith('wordpress_logged_in_')),
        'A página publicada não pode autenticar o contexto durante a medição.',
      ).toBe(false);
    }
    return { cold, warm };
  } finally {
    await client?.detach().catch(() => {});
    await context.close();
  }
}

async function verifyLazyTransition(
  browser,
  testInfo,
  environment,
  authenticatedState,
  target,
) {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    storageState: authenticatedState,
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  let client;
  let recorder;
  try {
    await installCrossOriginWriteGuard(context, environment.siteBase);
    await installPerformanceObservers(context);
    const page = await context.newPage();
    client = await context.newCDPSession(page);
    await applyThrottle(client, environment.throttle);
    await client.send('Network.clearBrowserCache');
    await client.send('Network.setCacheDisabled', { cacheDisabled: false });
    recorder = createEvidenceRecorder(
      page,
      { target: target.name, mode: 'lazy-transition', sample: 1 },
      [environment.username, environment.password],
      environment.siteBase.origin,
    );

    const builder = environment.targets.find(candidate => candidate.name === 'Builder');
    const response = await page.goto(builder.url, { waitUntil: 'domcontentloaded' });
    expect(response, 'Builder deve responder antes da transição lazy').not.toBeNull();
    expect(response.status(), 'Builder deve responder sem erro antes da transição lazy')
      .toBeLessThan(400);
    await waitForWorkspaceReady(page, builder, environment.loadingTimeoutMs);
    await recorder.waitForNetworkQuiet(
      NETWORK_QUIET_MS,
      Math.min(environment.loadingTimeoutMs, 10_000),
    );
    const baseline = await page.evaluate(() => ({
      timeOrigin: performance.timeOrigin,
      resources: performance.getEntriesByType('resource').map(entry => entry.name),
    }));
    const trigger = await firstVisibleLocator(
      page,
      target.triggerSelector,
      `Controle Builder→${target.name}`,
      environment.loadingTimeoutMs,
    );
    recorder.record('lazy-trigger-click', { target: target.name });
    await Promise.all([
      page.waitForURL(target.url, {
        waitUntil: 'domcontentloaded',
        timeout: environment.loadingTimeoutMs,
      }),
      trigger.click(),
    ]);
    assertSameOrigin(page.url(), environment.siteBase, `Transição lazy para ${target.name}`);
    await waitForWorkspaceReady(page, target, environment.loadingTimeoutMs);
    await recorder.waitForNetworkQuiet(
      NETWORK_QUIET_MS,
      Math.min(environment.loadingTimeoutMs, 10_000),
    );
    await recorder.settle();
    const result = await page.evaluate(() => ({
      timeOrigin: performance.timeOrigin,
      resources: performance.getEntriesByType('resource').map(entry => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
      })),
    }));
    expect(
      result.timeOrigin,
      `${target.name} deve abrir pela navegação nativa isolada do Builder`,
    ).not.toBe(baseline.timeOrigin);
    const baselineResources = new Set(baseline.resources);
    const lazyResources = result.resources.filter(resource => (
      !baselineResources.has(resource.name)
      && ['script', 'link', 'fetch', 'xmlhttprequest'].includes(resource.initiatorType)
      && target.lazyResourcePattern.test(resource.name)
    ));
    expect(
      lazyResources.length,
      `${target.name} deve buscar ao menos um recurso lazy que corresponda ao contrato da fixture`,
    ).toBeGreaterThan(0);
    recorder.record('lazy-transition-complete', {
      target: target.name,
      matchingResourceCount: lazyResources.length,
    });
    recorder.stop();
    await recorder.settle();
    if (recorder.failures.length > 0) throw new Error(recorder.failures.join(' | '));
  } catch (error) {
    const safeReason = diagnosticFingerprint(
      error instanceof Error ? error.message : error,
      [environment.username, environment.password],
    );
    if (recorder) {
      recorder.record('lazy-transition-failed', { reason: safeReason });
      recorder.stop();
      await recorder.settle();
      const evidence = await writeRedactedEvidence({
        environment,
        target,
        mode: 'lazy-transition',
        sampleNumber: 1,
        recorder,
        reason: safeReason,
      });
      await testInfo.attach(`lazy-${target.slug}-redacted-trace`, {
        path: evidence.tracePath,
        contentType: 'application/json',
      });
      await testInfo.attach(`lazy-${target.slug}-redacted-har`, {
        path: evidence.harPath,
        contentType: 'application/json',
      });
    }
    throw error;
  } finally {
    recorder?.stop();
    await client?.detach().catch(() => {});
    await context.close();
  }
}

async function writePerformanceReport(report, testInfo, environment) {
  await mkdir(ARTIFACT_ROOT, { recursive: true, mode: 0o700 });
  const outputPath = path.join(
    ARTIFACT_ROOT,
    `wordpress-installed-performance-${report.runId}-${report.projectProfile}-${report.throttle.name}.json`,
  );
  const source = serializeRedactedArtifact(report, artifactSecretPolicy(environment));
  await writeArtifactSetAtomically([{ path: outputPath, source }]);
  await testInfo.attach('wordpress-installed-performance-report', {
    path: outputPath,
    contentType: 'application/json',
  });
}

async function readReviewedPerformanceBudget(environment) {
  try {
    return await readFile(environment.performanceBudgetPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Não foi possível ler KODETY_E2E_PERF_BUDGET_PATH: ${reason}`);
  }
}

async function readLeakSnapshot(client, startedAt) {
  const metrics = await readCdpPerformanceMetrics(client);
  const counters = await client.send('Memory.getDOMCounters');
  for (const key of ['documents', 'nodes', 'jsEventListeners']) {
    if (!Number.isSafeInteger(counters[key]) || counters[key] < 0) {
      throw new Error(`Chromium não expôs o contador obrigatório ${key}.`);
    }
  }
  return {
    atMs: rounded(nodePerformance.now() - startedAt),
    jsHeapUsedBytes: Math.round(requiredCdpMetric(metrics, 'JSHeapUsedSize')),
    documents: counters.documents,
    nodes: counters.nodes,
    jsEventListeners: counters.jsEventListeners,
  };
}

test('mede cinco pares cold/warm dos workspaces instalados', async ({ browser, browserName }, testInfo) => {
  expect(browserName, 'O perfil de performance requer Chromium/CDP').toBe('chromium');
  const environment = loadPerformanceEnvironment();
  const performanceBudget = await readReviewedPerformanceBudget(environment);
  testInfo.annotations.push({ type: 'project-profile', description: environment.profile });
  testInfo.annotations.push({ type: 'throttle-profile', description: environment.throttleName });
  const report = {
    schemaVersion: 1,
    runId: environment.runId,
    status: 'running',
    generatedAt: new Date().toISOString(),
    projectProfile: environment.profile,
    expectedProjectFingerprint: environment.expectedProjectFingerprint,
    verifiedInstalledProjectFingerprint: null,
    fixtureVerificationSource: null,
    fixtureConfigured: environment.fixtureConfigured,
    sampleCountPerMode: SAMPLE_COUNT,
    modes: ['cold', 'warm'],
    throttle: {
      name: environment.throttleName,
      ...environment.throttle,
    },
    measurement: {
      settleMs: environment.settleMs,
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    },
    runtime: {
      node: process.version,
      playwright: '1.62.1',
      platform: process.platform,
      architecture: process.arch,
      cpuModel: redactDiagnostic(
        os.cpus()[0]?.model || 'unknown',
        [environment.username, environment.password],
        200,
      ),
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      browser: browser.version(),
      headless: true,
      viewport: devices['Desktop Chrome'].viewport,
      deviceScaleFactor: devices['Desktop Chrome'].deviceScaleFactor,
    },
    targets: [],
  };

  try {
    const authentication = await createAuthenticatedState(browser, environment);
    report.verifiedInstalledProjectFingerprint = authentication.fixtureReceipt.fingerprint;
    report.fixtureVerificationSource = authentication.fixtureReceipt.source;
    for (const target of environment.targets) {
      const targetResult = {
        name: target.name,
        url: redactedUrl(target.url),
        samples: { cold: [], warm: [] },
        summary: {},
      };
      report.targets.push(targetResult);
      for (let sampleNumber = 1; sampleNumber <= SAMPLE_COUNT; sampleNumber += 1) {
        const pair = await collectPair(
          browser,
          testInfo,
          environment,
          authentication.storageState,
          target,
          sampleNumber,
        );
        targetResult.samples.cold.push(pair.cold);
        targetResult.samples.warm.push(pair.warm);
      }
      targetResult.summary.cold = summarizeSamples(
        targetResult.samples.cold,
        SUMMARY_METRICS,
        SAMPLE_COUNT,
      );
      targetResult.summary.warm = summarizeSamples(
        targetResult.samples.warm,
        SUMMARY_METRICS,
        SAMPLE_COUNT,
      );
    }
    report.performanceBudget = evaluatePerformanceBudget({
      budget: performanceBudget,
      projectProfile: environment.profile,
      throttle: environment.throttleName,
      reportKind: 'workspaces',
      targets: report.targets,
    });
    if (!report.performanceBudget.passed) {
      throw new Error(performanceBudgetFailureMessage(report.performanceBudget));
    }
    report.status = 'complete';
  } catch (error) {
    report.status = 'partial';
    report.failure = diagnosticFingerprint(
      error instanceof Error ? error.message : error,
      [environment.username, environment.password],
    );
    throw error;
  } finally {
    await writePerformanceReport(report, testInfo, environment);
  }

  expect(report.targets).toHaveLength(7);
  for (const target of report.targets) {
    expect(target.samples.cold).toHaveLength(SAMPLE_COUNT);
    expect(target.samples.warm).toHaveLength(SAMPLE_COUNT);
  }
});

test('mede cinco pares cold/warm da página publicada anônima', async ({ browser, browserName }, testInfo) => {
  expect(browserName, 'O perfil de performance requer Chromium/CDP').toBe('chromium');
  const environment = loadPerformanceEnvironment();
  const performanceBudget = await readReviewedPerformanceBudget(environment);
  const target = loadPublishedTarget(environment);
  const report = {
    schemaVersion: 1,
    runId: environment.runId,
    status: 'running',
    kind: 'published-page-performance',
    generatedAt: new Date().toISOString(),
    projectProfile: environment.profile,
    expectedProjectFingerprint: environment.expectedProjectFingerprint,
    verifiedInstalledProjectFingerprint: null,
    fixtureVerificationSource: null,
    sampleCountPerMode: SAMPLE_COUNT,
    modes: ['cold', 'warm'],
    throttle: { name: environment.throttleName, ...environment.throttle },
    measurement: {
      anonymousContext: true,
      settleMs: environment.settleMs,
      serviceWorkers: 'block',
    },
    runtime: {
      node: process.version,
      playwright: '1.62.1',
      platform: process.platform,
      architecture: process.arch,
      cpuModel: redactDiagnostic(
        os.cpus()[0]?.model || 'unknown',
        [environment.username, environment.password],
        200,
      ),
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      browser: browser.version(),
      headless: true,
      viewport: devices['Desktop Chrome'].viewport,
      deviceScaleFactor: devices['Desktop Chrome'].deviceScaleFactor,
    },
    targets: [{
      name: target.name,
      url: redactedUrl(target.url),
      samples: { cold: [], warm: [] },
      summary: {},
    }],
  };
  testInfo.annotations.push({ type: 'project-profile', description: environment.profile });
  testInfo.annotations.push({ type: 'surface', description: 'published-page-anonymous' });

  try {
    const authentication = await createAuthenticatedState(browser, environment);
    report.verifiedInstalledProjectFingerprint = authentication.fixtureReceipt.fingerprint;
    report.fixtureVerificationSource = authentication.fixtureReceipt.source;
    const targetResult = report.targets[0];
    for (let sampleNumber = 1; sampleNumber <= SAMPLE_COUNT; sampleNumber += 1) {
      const pair = await collectPair(
        browser,
        testInfo,
        environment,
        null,
        target,
        sampleNumber,
      );
      targetResult.samples.cold.push(pair.cold);
      targetResult.samples.warm.push(pair.warm);
    }
    targetResult.summary.cold = summarizeSamples(
      targetResult.samples.cold,
      PUBLISHED_SUMMARY_METRICS,
      SAMPLE_COUNT,
    );
    targetResult.summary.warm = summarizeSamples(
      targetResult.samples.warm,
      PUBLISHED_SUMMARY_METRICS,
      SAMPLE_COUNT,
    );
    report.performanceBudget = evaluatePerformanceBudget({
      budget: performanceBudget,
      projectProfile: environment.profile,
      throttle: environment.throttleName,
      reportKind: 'published-page',
      targets: report.targets,
    });
    if (!report.performanceBudget.passed) {
      throw new Error(performanceBudgetFailureMessage(report.performanceBudget));
    }
    report.status = 'complete';
  } catch (error) {
    report.status = 'partial';
    report.failure = diagnosticFingerprint(
      error instanceof Error ? error.message : error,
      [environment.username, environment.password],
    );
    throw error;
  } finally {
    await writePerformanceReport(report, testInfo, environment);
  }

  expect(report.targets[0].samples.cold).toHaveLength(SAMPLE_COUNT);
  expect(report.targets[0].samples.warm).toHaveLength(SAMPLE_COUNT);
});

test('prova transições lazy do Builder para cada workspace', async ({ browser, browserName }, testInfo) => {
  expect(browserName, 'O gate lazy requer Chromium/CDP').toBe('chromium');
  const environment = loadPerformanceEnvironment();
  const targets = loadLazyTransitionTargets(environment);
  const authentication = await createAuthenticatedState(browser, environment);
  testInfo.annotations.push({ type: 'project-profile', description: environment.profile });
  testInfo.annotations.push({ type: 'fixture-receipt', description: authentication.fixtureReceipt.source });
  for (const target of targets) {
    await test.step(`Builder → ${target.name}`, async () => {
      await verifyLazyTransition(
        browser,
        testInfo,
        environment,
        authentication.storageState,
        target,
      );
    });
  }
  expect(targets).toHaveLength(6);
});

test('executa soak de 30 minutos para heap e listeners no Builder', async ({ browser, browserName }, testInfo) => {
  expect(browserName, 'O soak requer Chromium/CDP').toBe('chromium');
  const environment = loadPerformanceEnvironment();
  test.setTimeout(environment.soakDurationMs + 15 * 60_000);
  const performanceBudget = await readReviewedPerformanceBudget(environment);
  const builder = environment.targets.find(target => target.name === 'Builder');
  if (!builder) throw new Error('O soak exige o alvo Builder.');
  const report = {
    schemaVersion: 1,
    runId: environment.runId,
    status: 'running',
    kind: 'builder-soak',
    generatedAt: new Date().toISOString(),
    projectProfile: environment.profile,
    expectedProjectFingerprint: environment.expectedProjectFingerprint,
    verifiedInstalledProjectFingerprint: null,
    fixtureVerificationSource: null,
    throttle: { name: environment.throttleName, ...environment.throttle },
    durationMs: environment.soakDurationMs,
    cycleMs: environment.soakCycleMs,
    checkpoints: [],
    cycles: 0,
  };
  let context;
  let client;
  let recorder;
  let page;
  try {
    const authentication = await createAuthenticatedState(browser, environment);
    report.verifiedInstalledProjectFingerprint = authentication.fixtureReceipt.fingerprint;
    report.fixtureVerificationSource = authentication.fixtureReceipt.source;
    context = await browser.newContext({
      ...devices['Desktop Chrome'],
      storageState: authentication.storageState,
      serviceWorkers: 'block',
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    await installCrossOriginWriteGuard(context, environment.siteBase);
    await installPerformanceObservers(context);
    page = await context.newPage();
    client = await context.newCDPSession(page);
    const networkThrottleApi = await applyThrottle(client, environment.throttle);
    recorder = createEvidenceRecorder(
      page,
      { target: builder.name, mode: 'soak', sample: 1 },
      [environment.username, environment.password],
      environment.siteBase.origin,
    );
    const response = await page.goto(builder.url, { waitUntil: 'domcontentloaded' });
    expect(response, 'Builder deve responder antes do soak').not.toBeNull();
    expect(response.status(), 'Builder deve responder sem erro antes do soak').toBeLessThan(400);
    assertSameOrigin(page.url(), environment.siteBase, 'Redirect do Builder no soak');
    await waitForWorkspaceReady(page, builder, environment.loadingTimeoutMs);
    await recorder.waitForNetworkQuiet(
      NETWORK_QUIET_MS,
      Math.min(environment.loadingTimeoutMs, 10_000),
    );
    const startedAt = nodePerformance.now();
    report.checkpoints.push(await readLeakSnapshot(client, startedAt));
    recorder.record('soak-started', {
      durationMs: environment.soakDurationMs,
      networkThrottleApi,
    });
    let nextCheckpointAt = SOAK_CHECKPOINT_MS;
    while (nodePerformance.now() - startedAt < environment.soakDurationMs) {
      const closedPanelControl = page.locator(environment.soakCloseSelector).first();
      await expect(
        closedPanelControl,
        'O controle de fechar deve estar invisível antes de abrir o painel do soak.',
      ).toBeHidden({ timeout: environment.loadingTimeoutMs });
      const openControl = await firstVisibleLocator(
        page,
        environment.soakOpenSelector,
        'Controle de abertura do ciclo de soak',
        environment.loadingTimeoutMs,
      );
      await openControl.click();
      await expect(
        closedPanelControl,
        'Abrir o painel deve tornar o controle de fechar visível.',
      ).toBeVisible({ timeout: environment.loadingTimeoutMs });
      await closedPanelControl.click();
      await expect(
        closedPanelControl,
        'Fechar o painel deve ocultar novamente o controle de fechar.',
      ).toBeHidden({ timeout: environment.loadingTimeoutMs });
      await expect(
        openControl,
        'O ciclo reversível deve devolver o controle de abertura.',
      ).toBeVisible({ timeout: environment.loadingTimeoutMs });
      report.cycles += 1;
      assertSameOrigin(page.url(), environment.siteBase, 'Ciclo do soak');
      const elapsed = nodePerformance.now() - startedAt;
      if (elapsed >= nextCheckpointAt) {
        const checkpoint = await readLeakSnapshot(client, startedAt);
        report.checkpoints.push(checkpoint);
        recorder.record('soak-checkpoint', checkpoint);
        nextCheckpointAt += SOAK_CHECKPOINT_MS;
      }
      const remaining = environment.soakDurationMs - (nodePerformance.now() - startedAt);
      if (remaining > 0) await page.waitForTimeout(Math.min(environment.soakCycleMs, remaining));
    }
    const finalCheckpoint = await readLeakSnapshot(client, startedAt);
    report.checkpoints.push(finalCheckpoint);
    const baseline = report.checkpoints[0];
    const maximumHeap = Math.max(...report.checkpoints.map(item => item.jsHeapUsedBytes));
    const maximumListeners = Math.max(...report.checkpoints.map(item => item.jsEventListeners));
    report.measurements = {
      heapGrowthBytes: Math.max(0, maximumHeap - baseline.jsHeapUsedBytes),
      listenerGrowth: Math.max(0, maximumListeners - baseline.jsEventListeners),
      nodeGrowth: Math.max(
        0,
        Math.max(...report.checkpoints.map(item => item.nodes)) - baseline.nodes,
      ),
      documentGrowth: Math.max(
        0,
        Math.max(...report.checkpoints.map(item => item.documents)) - baseline.documents,
      ),
    };
    report.performanceBudget = evaluatePerformanceMeasurementsBudget({
      budget: performanceBudget,
      projectProfile: environment.profile,
      throttle: environment.throttleName,
      reportKind: 'soak',
      target: 'Builder',
      mode: 'duration',
      measurements: report.measurements,
    });
    if (!report.performanceBudget.passed) {
      throw new Error(performanceBudgetFailureMessage(report.performanceBudget));
    }
    recorder.stop();
    await recorder.settle();
    if (recorder.failures.length > 0) throw new Error(recorder.failures.join(' | '));
    if (environment.evidenceMode === 'all') {
      await writeRedactedEvidence({
        environment,
        target: builder,
        mode: 'soak',
        sampleNumber: 1,
        recorder,
        reason: null,
      });
    }
    report.status = 'complete';
  } catch (error) {
    report.status = 'partial';
    report.failure = diagnosticFingerprint(
      error instanceof Error ? error.message : error,
      [environment.username, environment.password],
    );
    if (recorder && page) {
      recorder.record('soak-failed', { reason: report.failure });
      recorder.stop();
      await recorder.settle();
      await writeRedactedEvidence({
        environment,
        target: builder,
        mode: 'soak',
        sampleNumber: 1,
        recorder,
        reason: report.failure,
      });
    }
    throw error;
  } finally {
    recorder?.stop();
    await client?.detach().catch(() => {});
    await context?.close();
    await writePerformanceReport(report, testInfo, environment);
  }
  expect(report.status).toBe('complete');
  expect(report.cycles).toBeGreaterThan(0);
  expect(report.checkpoints.length).toBeGreaterThanOrEqual(7);
});
