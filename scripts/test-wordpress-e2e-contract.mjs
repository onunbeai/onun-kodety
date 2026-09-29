import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(path.join(root, relative), 'utf8');
const [
  config,
  spec,
  performanceConfig,
  performanceSpec,
  performanceStatisticsSource,
  speedIndexSource,
  performanceMatrix,
  releaseSmokeRunner,
  guide,
  packageSource,
  lockSource,
] = await Promise.all([
  read('playwright.config.mjs'),
  read('e2e/wordpress-installed-smoke.spec.mjs'),
  read('e2e/playwright.performance.config.mjs'),
  read('e2e/wordpress-performance-profile.spec.mjs'),
  read('e2e/performance-statistics.mjs'),
  read('e2e/speed-index.mjs'),
  read('e2e/run-wordpress-performance-matrix.mjs'),
  read('e2e/run-wordpress-release-smoke.mjs'),
  read('docs/guides/wordpress-installed-e2e.md'),
  read('package.json'),
  read('package-lock.json'),
]);
const packageManifest = JSON.parse(packageSource);
const lockManifest = JSON.parse(lockSource);
const redaction = await import(
  pathToFileURL(path.join(root, 'e2e/performance-artifact-redaction.mjs')).href
);
const statistics = await import(
  pathToFileURL(path.join(root, 'e2e/performance-statistics.mjs')).href
);
const fixtureContract = await import(
  pathToFileURL(path.join(root, 'e2e/wordpress-installed-fixture.mjs')).href
);
const performanceBudget = await import(
  pathToFileURL(path.join(root, 'e2e/performance-budget.mjs')).href
);
const speedIndex = await import(
  pathToFileURL(path.join(root, 'e2e/speed-index.mjs')).href
);

const redactionSecrets = ['admin', 'senha-e2e-super-secreta'];
const redactedArtifact = redaction.serializeRedactedArtifact({
  url: 'https://example.test/wp-admin/share/0123456789abcdef0123456789abcdef?token=raw#secret',
  diagnostic: 'admin senha-e2e-super-secreta Authorization: Bearer token-cru {"nonce":"nonce-cru"} Cookie: wordpress_logged_in_hash=cookie-cru',
  nonce: 'nonce-estruturado-cru',
  accessToken: 'access-token-cru',
  refresh_token: 'refresh-token-cru',
  clientSecret: 'client-secret-cru',
  'x-wp-nonce': 'wp-nonce-cru',
  headers: [],
  cookies: [],
}, { redact: redactionSecrets, forbid: ['senha-e2e-super-secreta'] });
assert.doesNotMatch(
  redactedArtifact,
  /admin|senha-e2e-super-secreta|token-cru|nonce-cru|nonce-estruturado-cru|cookie-cru|access-token-cru|refresh-token-cru|client-secret-cru|wp-nonce-cru|[?&]token=raw|#secret/,
);
assert.match(redactedArtifact, /REDACTED/);
const aliasedDiagnostic = redaction.redactDiagnostic(
  'accessToken=alpha refreshToken:beta clientSecret=gamma x-wp-nonce:delta',
  [],
);
assert.doesNotMatch(aliasedDiagnostic, /alpha|beta|gamma|delta/);
assert.doesNotMatch(
  redaction.redactedUrl('https://example.test/accessToken/alpha-secret-value-that-is-long'),
  /alpha-secret-value-that-is-long/,
);
const privatePathUrl = redaction.redactedUrl(
  'https://user:password@example.test/wp-json/kodety/v1/project/cliente-confidencial?nome=segredo#fragmento',
);
assert.match(privatePathUrl, /^https:\/\/example\.test\/wp-json\/kodety\/v1\/project\//);
assert.doesNotMatch(privatePathUrl, /user|password|cliente|confidencial|nome|segredo|fragmento/);
assert.doesNotMatch(
  redaction.redactedUrl('https://example.test/%2573hare/%252Fprivate'),
  /share|private|%25/i,
);
const diagnosticFingerprint = redaction.diagnosticFingerprint(
  'console editorial-confidencial password=segredo',
  ['segredo'],
);
assert.deepEqual(Object.keys(diagnosticFingerprint), ['category', 'sizeBytes', 'sha256']);
assert.match(diagnosticFingerprint.sha256, /^[a-f0-9]{64}$/);
assert.doesNotMatch(JSON.stringify(diagnosticFingerprint), /editorial|confidencial|segredo/);
assert.doesNotThrow(() => redaction.serializeRedactedArtifact(
  { route: '/wp-admin/admin.php', headers: [], cookies: [] },
  { redact: [], forbid: ['senha-e2e-super-secreta'] },
));
assert.match(redaction.redactDiagnostic('x'.repeat(100), [], 10), /TRUNCATED/);
assert.throws(
  () => redaction.serializeRedactedArtifact({ headers: [{ name: 'x', value: 'y' }] }, []),
  /headers não vazio/,
);
assert.throws(
  () => redaction.serializeRedactedArtifact({ cookies: [{ name: 'x', value: 'y' }] }, []),
  /cookies não vazio/,
);
assert.throws(
  () => redaction.serializeRedactedArtifact({ postData: 'body' }, []),
  /postData/,
);
const statisticsSummary = statistics.summarizeSamples(
  [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 100 }],
  ['value'],
  5,
);
assert.deepEqual(statisticsSummary.value, {
  min: 1,
  median: 3,
  mad: 1,
  q1: 2,
  q3: 4,
  iqr: 2,
  max: 100,
  range: 99,
});
assert.throws(
  () => statistics.summarizeSamples([{ value: 1 }], ['value'], 5),
  /exatamente 5 amostras/,
);

const smallFingerprint = 'a'.repeat(64);
const largeFingerprint = 'b'.repeat(64);
const legacyFingerprint = 'c'.repeat(64);
const installedFixture = fixtureContract.createFixtureFingerprintContract({
  profile: 'small',
  siteBase: new URL('https://example.test/'),
  smallFingerprint,
  largeFingerprint,
  legacyFingerprint,
  receiptUrl: '/wp-json/kodety-e2e/v1/fixture-receipt',
});
assert.equal(installedFixture.expectedProjectFingerprint, smallFingerprint);
assert.equal(
  installedFixture.fingerprintReceiptUrl,
  'https://example.test/wp-json/kodety-e2e/v1/fixture-receipt',
);
let receiptRequestOptions;
const verifiedFixture = await fixtureContract.verifyInstalledFixtureFingerprint({
  async get(_url, options) {
    receiptRequestOptions = options;
    return {
      url: () => 'https://example.test/wp-json/kodety-e2e/v1/fixture-receipt',
      ok: () => true,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json; charset=utf-8' }),
      json: async () => ({ profile: 'small', fingerprint: smallFingerprint }),
    };
  },
}, {
  siteBase: new URL('https://example.test/'),
  profile: 'small',
  ...installedFixture,
});
assert.equal(receiptRequestOptions.maxRedirects, 0);
assert.equal(verifiedFixture.source, 'authenticated-same-origin-receipt');
assert.throws(() => fixtureContract.createFixtureFingerprintContract({
  profile: 'large',
  siteBase: new URL('https://example.test/'),
  smallFingerprint,
  largeFingerprint: smallFingerprint,
  legacyFingerprint,
  receiptUrl: '/receipt',
}), /distintos/);

const budgetSummary = Object.fromEntries(
  ['cold', 'warm'].map(mode => [mode, Object.fromEntries(
    performanceBudget.PERFORMANCE_GATE_METRICS.map(metric => [metric, { median: 12 }]),
  )]),
);
const budgetEntries = ['cold', 'warm'].flatMap(mode => (
  performanceBudget.PERFORMANCE_GATE_METRICS.map(metric => ({
    projectProfile: 'small',
    throttle: 'desktop',
    reportKind: 'workspaces',
    target: 'Builder',
    mode,
    metric,
    baselineMedian: 10,
    maximumMedian: 15,
    rationale: 'folga revisada do release anterior',
  }))
));
const budgetEvaluation = performanceBudget.evaluatePerformanceBudget({
  budget: { schemaVersion: 1, entries: budgetEntries },
  projectProfile: 'small',
  throttle: 'desktop',
  reportKind: 'workspaces',
  targets: [{ name: 'Builder', summary: budgetSummary }],
});
assert.equal(budgetEvaluation.passed, true);
const failingBudget = {
  schemaVersion: 1,
  entries: budgetEntries.map(entry => (
    entry.metric === 'readyMs' ? { ...entry, maximumMedian: 11 } : entry
  )),
};
const failingEvaluation = performanceBudget.evaluatePerformanceBudget({
  budget: failingBudget,
  projectProfile: 'small',
  throttle: 'desktop',
  reportKind: 'workspaces',
  targets: [{ name: 'Builder', summary: budgetSummary }],
});
assert.equal(failingEvaluation.passed, false);
assert.match(performanceBudget.performanceBudgetFailureMessage(failingEvaluation), /readyMs/);
const soakEvaluation = performanceBudget.evaluatePerformanceMeasurementsBudget({
  budget: {
    schemaVersion: 1,
    entries: [{
      projectProfile: 'small',
      throttle: 'desktop',
      reportKind: 'soak',
      target: 'Builder',
      mode: 'duration',
      metric: 'listenerGrowth',
      baselineMedian: 2,
      maximumMedian: 4,
      rationale: 'folga revisada do soak anterior',
    }],
  },
  projectProfile: 'small',
  throttle: 'desktop',
  reportKind: 'soak',
  target: 'Builder',
  mode: 'duration',
  measurements: { listenerGrowth: 3 },
});
assert.equal(soakEvaluation.passed, true);
const speedIndexSelfTest = await speedIndex.runSpeedIndexSelfTest();
assert.equal(speedIndexSelfTest.checks, 8);
assert.ok(Number.isFinite(speedIndexSelfTest.speedIndexMs));
assert.throws(
  () => performanceBudget.validateReleasePerformanceBudget({
    budget: { schemaVersion: 1, entries: budgetEntries },
  }),
  /Budget E2E de release incompleto/,
);

assert.match(config, /from ['"]@playwright\/test['"]/, 'a configuração deve usar @playwright/test');
assert.match(config, /artifacts\/kodety-hardening\/front-06\/e2e/);
assert.match(config, /trace:\s*['"]off['"]/);
assert.match(config, /screenshot:\s*['"]off['"]/);
assert.match(config, /video:\s*['"]off['"]/);
assert.doesNotMatch(config, /['"]html['"]/, 'relatório HTML nativo não passa pelo redator fail-closed');
assert.doesNotMatch(config, /recordHar/, 'HAR bruto não pode ser gravado em execuções aprovadas');

for (const required of [
  'KODETY_E2E_BASE_URL',
  'KODETY_E2E_USER',
  'KODETY_E2E_PASSWORD',
  'KODETY_E2E_SMALL_PROJECT_FINGERPRINT',
  'KODETY_E2E_LARGE_PROJECT_FINGERPRINT',
  'KODETY_E2E_LEGACY_PROJECT_FINGERPRINT',
  'KODETY_E2E_INSTALLED_FINGERPRINT_URL',
  'KODETY_E2E_STYLE_CONTROL_SELECTOR',
  'KODETY_E2E_STYLE_PROPERTY',
  'KODETY_E2E_STYLE_VALUE',
  'KODETY_E2E_STYLE_EXPECTED_COMPUTED_VALUE',
]) {
  assert.match(spec, new RegExp(`requiredEnvironment\\(['"]${required}['"]\\)`));
}
assert.doesNotMatch(spec, /KODETY_E2E_PASSWORD\s*\|\|\s*['"][^'"]+['"]/, 'senha não pode ter fallback');
assert.doesNotMatch(spec, /KODETY_E2E_USER\s*\|\|\s*['"][^'"]+['"]/, 'usuário não pode ter fallback');
assert.match(spec, /KODETY_E2E_LOGIN_URL/);
assert.match(spec, /#user_login/);
assert.match(spec, /#user_pass/);
assert.match(spec, /page\.on\(['"]console['"]/);
assert.match(spec, /message\.type\(\) !== ['"]error['"]/);
assert.match(spec, /page\.on\(['"]response['"]/);
assert.match(spec, /response\.status\(\) < 400/);
assert.match(spec, /page\.on\(['"]requestfailed['"]/);
assert.match(spec, /from ['"]\.\/performance-artifact-redaction\.mjs['"]/);
assert.match(spec, /serializeRedactedArtifact/);
assert.match(spec, /process\.env\.KODETY_E2E_USER/);
assert.match(spec, /process\.env\.KODETY_E2E_PASSWORD/);
assert.match(spec, /MAX_DIAGNOSTIC_LENGTH/);
assert.match(spec, /MAX_MONITOR_FAILURES/);
assert.doesNotMatch(spec, /\.filter\(\{\s*visible:/, 'o spec não deve depender do filtro visible recente');
assert.match(spec, /data-kodety-loading-screen/);
assert.match(spec, /\.kodety-boot-loader/);
assert.match(spec, /KODETY_E2E_CANVAS_SELECTOR/);
assert.match(spec, /KODETY_E2E_TEXT_SELECTOR/);
assert.match(spec, /h1, p/);
assert.match(spec, /InputEvent\(['"]input['"]/);
assert.match(spec, /waitForAutosaveAcknowledgement/);
assert.match(spec, /workspaceRevision/);
assert.match(spec, /page\.reload/);
assert.match(spec, /expectPersistedMarker/);
assert.match(spec, /editStyleThroughInspector/);
assert.match(spec, /expectPersistedStyle/);
assert.match(spec, /CSS\.supports/);
assert.match(spec, /A edição de estilo deve avançar workspaceRevision/);
assert.match(spec, /KODETY_E2E_ALLOW_PUBLISH !== ['"]1['"]/);
assert.match(spec, /KODETY_E2E_REQUIRE_PUBLISH === ['"]1['"]/);
assert.match(spec, /a autorização nunca é presumida/);
assert.match(spec, /KODETY_E2E_PUBLISHED_URL/);
assert.match(spec, /\/wp-json\\\/kodety\\\/v1\\\/publish/);
assert.match(spec, /KODETY_E2E_PROJECT_PROFILE/);
assert.match(spec, /KODETY_E2E_LARGE_BUILDER_URL/);
assert.match(spec, /KODETY_E2E_PROJECT_FIXTURE/);
assert.match(spec, /verifyInstalledFixtureFingerprint/);
assert.match(spec, /validatePublishedPageAnonymously/);
assert.match(spec, /browser\.newContext\(\{ serviceWorkers: ['"]block['"] \}\)/);
assert.match(spec, /A validação pública deve começar sem cookie autenticado/);
assert.match(spec, /A validação pública não pode adquirir cookie autenticado/);

for (const [workspace, environment] of [
  ['Settings', 'KODETY_E2E_SETTINGS_URL'],
  ['CMS', 'KODETY_E2E_CMS_URL'],
  ['Analytics', 'KODETY_E2E_ANALYTICS_URL'],
  ['Localization', 'KODETY_E2E_LOCALIZATION_URL'],
  ['Email', 'KODETY_E2E_EMAIL_URL'],
  ['File System', 'KODETY_E2E_FILE_SYSTEM_URL'],
]) {
  assert.match(spec, new RegExp(`name:\\s*['"]${workspace.replace(' ', '\\s+')}['"]`));
  assert.match(spec, new RegExp(environment));
}

assert.match(spec, /writeFailureHar/);
assert.match(spec, /mode:\s*0o600/);
assert.match(spec, /await rename\(temporaryPath, outputPath\)/);
assert.doesNotMatch(spec, /testInfo\.attach\(/, 'o runner não deve duplicar o HAR fora da escrita 0600');
assert.match(spec, /headers:\s*\[\]/);
assert.match(spec, /cookies:\s*\[\]/);
assert.doesNotMatch(spec, /postData\s*:/, 'HAR redigido não deve persistir corpo de request');
assert.match(spec, /testInfo\.status !== testInfo\.expectedStatus \|\| monitorFailures\.length > 0/);
assert.match(spec, /page\.waitForURL/);
assert.doesNotMatch(spec, /page\.waitForNavigation/, 'login não deve usar waitForNavigation racy');
assert.match(spec, /element\.form\?\.action/);
assert.match(spec, /blockCrossOriginWrites/);
assert.match(spec, /criticalRequest/);
assert.match(spec, /request\.resourceType\(\)/);
assert.match(spec, /confirmationPromise/);
assert.match(spec, /Promise\.race/);

assert.match(performanceConfig, /wordpress-performance-profile\\\.spec\\\.mjs/);
assert.match(performanceConfig, /browserName:\s*['"]chromium['"]/);
assert.match(performanceConfig, /workers:\s*1/);
assert.match(performanceConfig, /retries:\s*0/);
assert.match(performanceConfig, /trace:\s*['"]off['"]/);
assert.match(performanceConfig, /screenshot:\s*['"]off['"]/);
assert.match(performanceConfig, /video:\s*['"]off['"]/);

for (const required of [
  'KODETY_E2E_BASE_URL',
  'KODETY_E2E_USER',
  'KODETY_E2E_PASSWORD',
  'KODETY_E2E_SMALL_PROJECT_FINGERPRINT',
  'KODETY_E2E_LARGE_PROJECT_FINGERPRINT',
  'KODETY_E2E_LEGACY_PROJECT_FINGERPRINT',
  'KODETY_E2E_INSTALLED_FINGERPRINT_URL',
  'KODETY_E2E_PERF_BUDGET_PATH',
  'KODETY_E2E_BUILDER_INTERACTION_SELECTOR',
  'KODETY_E2E_SETTINGS_INTERACTION_SELECTOR',
  'KODETY_E2E_CMS_INTERACTION_SELECTOR',
  'KODETY_E2E_ANALYTICS_INTERACTION_SELECTOR',
  'KODETY_E2E_LOCALIZATION_INTERACTION_SELECTOR',
  'KODETY_E2E_EMAIL_INTERACTION_SELECTOR',
  'KODETY_E2E_FILE_SYSTEM_INTERACTION_SELECTOR',
  'KODETY_E2E_PUBLISHED_INTERACTION_SELECTOR',
  'KODETY_E2E_SOAK_OPEN_SELECTOR',
  'KODETY_E2E_SOAK_CLOSE_SELECTOR',
]) {
  assert.match(performanceSpec, new RegExp(`requiredEnvironment\\(['"]${required}['"]\\)`));
}
assert.match(performanceSpec, /verifyInstalledFixtureFingerprint/);
assert.match(performanceSpec, /expectedProjectFingerprint/);
assert.match(performanceSpec, /verifiedInstalledProjectFingerprint/);
assert.doesNotMatch(performanceSpec, /projectFingerprint:\s*environment\.projectFingerprint/);
assert.match(performanceSpec, /const SAMPLE_COUNT = 5/);
assert.match(performanceSpec, /collectPair/);
assert.match(performanceSpec, /storageState:\s*authenticatedState/);
assert.match(performanceSpec, /context\.storageState\(\)/);
assert.doesNotMatch(performanceSpec, /storageState\(\s*\{/, 'estado autenticado não pode ser escrito em disco');
assert.match(performanceSpec, /Network\.clearBrowserCache/);
assert.match(performanceSpec, /Network\.setCacheDisabled['"],\s*\{ cacheDisabled: false \}/);
assert.match(performanceSpec, /['"]cold['"]/);
assert.match(performanceSpec, /['"]warm['"]/);
assert.match(performanceSpec, /Network\.emulateNetworkConditionsByRule/);
assert.match(performanceSpec, /urlPattern:\s*['"]['"]/);
assert.match(performanceSpec, /Network\.overrideNetworkState/);
assert.match(performanceSpec, /Emulation\.setCPUThrottlingRate/);
assert.match(performanceSpec, /Performance\.getMetrics/);
assert.match(performanceSpec, /requiredCdpMetric/);
assert.doesNotMatch(performanceSpec, /after\[name\]\s*\?\?\s*0/);
assert.match(performanceSpec, /page\.on\(['"]requestfinished['"]/);
assert.match(performanceSpec, /request\.sizes\(\)/);
assert.match(performanceSpec, /waitForNetworkQuiet/);
assert.match(performanceSpec, /inFlightRequests/);
assert.doesNotMatch(performanceSpec, /pending\.finally\(/);
assert.match(performanceSpec, /setResourceTimingBufferSize/);
assert.match(performanceSpec, /resourcetimingbufferfull/);
assert.match(performanceSpec, /resourceTimingBufferOverflow/);
assert.match(performanceSpec, /observerStatus/);
assert.match(performanceSpec, /blockingTimeUntilReadyMs/);
assert.match(performanceSpec, /measureLabInp/);
assert.match(performanceSpec, /INP_PROBE_INTERACTIONS = 5/);
assert.match(performanceSpec, /inpInteractionCount/);
assert.match(performanceSpec, /observerType of \['largest-contentful-paint', 'layout-shift', 'longtask', 'event'\]/);
assert.match(performanceSpec, /ttfbMs/);
assert.match(performanceSpec, /fcpMs/);
assert.match(performanceSpec, /lcpMs/);
assert.match(performanceSpec, /domContentLoadedMs/);
assert.match(performanceSpec, /readyMs/);
assert.match(performanceSpec, /transferBytes/);
assert.match(performanceSpec, /cpuTaskDurationMs/);
assert.match(performanceSpec, /jsHeapUsedDeltaBytes/);
assert.match(performanceSpec, /thirdPartyRequestCount/);
assert.match(performanceSpec, /thirdPartyTransferBytes/);
assert.match(performanceSpec, /siteAudit/);
assert.match(performanceSpec, /lcpElement/);
assert.match(performanceSpec, /belowFoldMedia/);
assert.match(performanceSpec, /renderBlocking/);
assert.match(performanceSpec, /Page\.startScreencast/);
assert.match(performanceSpec, /Page\.captureScreenshot/);
assert.match(performanceSpec, /calculateSpeedIndex/);
assert.match(performanceSpec, /speedIndexMs/);
assert.match(performanceSpec, /kodetyPhases/);
for (const phase of [
  'project_download_body',
  'project_unzip',
  'project_parse',
  'project_first_canvas_visual_ready',
]) {
  assert.match(performanceSpec, new RegExp(phase));
}
assert.match(performanceSpec, /correlation_error/);
assert.match(performanceSpec, /operationId/);
assert.match(performanceSpec, /entry\.attempt/);
assert.match(performanceSpec, /entry\.fallback/);
assert.match(performanceSpec, /projectPhasesRequired:\s*true/);
assert.match(performanceSpec, /download\.cache === ['"]hit['"]/);
assert.match(performanceSpec, /Builder cold não pode reutilizar/);
assert.match(performanceSpec, /cache-hit não pode executar/);
assert.match(performanceSpec, /phase\.durationMs < 0/);
assert.match(performanceSpec, /phase\.result/);
assert.match(performanceSpec, /evaluatePerformanceBudget/);
assert.match(performanceSpec, /performanceBudgetFailureMessage/);
assert.match(performanceSpec, /executa soak de 30 minutos/);
assert.match(performanceSpec, /Memory\.getDOMCounters/);
assert.match(performanceSpec, /DEFAULT_SOAK_DURATION_MS = 30 \* 60_000/);
assert.match(performanceSpec, /evaluatePerformanceMeasurementsBudget/);
assert.match(performanceSpec, /deve estar invisível antes de abrir o painel do soak/);
assert.match(performanceSpec, /deve tornar o controle de fechar visível/);
assert.match(performanceSpec, /deve ocultar novamente o controle de fechar/);
assert.match(performanceSpec, /KODETY_PERFORMANCE_DEBUG/);
assert.match(performanceStatisticsSource, /median/);
assert.match(performanceStatisticsSource, /mad/);
assert.match(performanceStatisticsSource, /iqr/);
assert.doesNotMatch(performanceStatisticsSource, /\bp95\b/i, 'cinco amostras não sustentam p95');
assert.match(speedIndexSource, /import sharp from ['"]sharp['"]/);
assert.match(speedIndexSource, /raw or encoded frame data is never persisted/);
assert.doesNotMatch(speedIndexSource, /node:fs|writeFile|console\./);
assert.deepEqual(
  performanceBudget.PUBLISHED_PERFORMANCE_GATE_METRICS.slice(-3),
  ['speedIndexMs', 'thirdPartyRequestCount', 'thirdPartyTransferBytes'],
);

for (const [workspace, environment] of [
  ['Builder', 'KODETY_E2E_BUILDER_URL'],
  ['Settings', 'KODETY_E2E_SETTINGS_URL'],
  ['CMS', 'KODETY_E2E_CMS_URL'],
  ['Analytics', 'KODETY_E2E_ANALYTICS_URL'],
  ['Localization', 'KODETY_E2E_LOCALIZATION_URL'],
  ['Email', 'KODETY_E2E_EMAIL_URL'],
  ['File System', 'KODETY_E2E_FILE_SYSTEM_URL'],
]) {
  assert.match(performanceSpec, new RegExp(`name:\\s*['"]${workspace.replace(' ', '\\s+')}['"]`));
  assert.match(performanceSpec, new RegExp(environment));
}

assert.match(performanceSpec, /serializeRedactedArtifact/);
assert.match(performanceSpec, /writeRedactedEvidence/);
assert.match(performanceSpec, /normalizedDiagnosticFingerprint/);
assert.match(performanceSpec, /writeArtifactSetAtomically/);
assert.match(performanceSpec, /Promise\.allSettled\(staged\.map/);
assert.match(performanceSpec, /const traceSource = serializeRedactedArtifact/);
assert.match(performanceSpec, /const harSource = serializeRedactedArtifact/);
assert.match(performanceSpec, /forbid:\s*\[environment\.password\]/);
assert.match(performanceSpec, /\.trace\.json/);
assert.match(performanceSpec, /headers:\s*\[\]/);
assert.match(performanceSpec, /cookies:\s*\[\]/);
assert.doesNotMatch(performanceSpec, /recordHar/);
assert.doesNotMatch(performanceSpec, /context\.tracing/);
assert.doesNotMatch(performanceSpec, /postData\s*:/);

assert.match(performanceSpec, /página publicada anônima/);
assert.match(performanceSpec, /KODETY_E2E_PUBLISHED_MARKER/);
assert.match(performanceSpec, /anonymousContext:\s*true/);
assert.match(performanceSpec, /wordpress_logged_in_/);
assert.match(performanceSpec, /transições lazy do Builder/);
assert.match(performanceSpec, /performance\.timeOrigin/);
assert.match(performanceSpec, /\.not\.toBe\(baseline\.timeOrigin\)/);
assert.match(performanceSpec, /lazyResourcePattern/);
for (const prefix of ['SETTINGS', 'CMS', 'ANALYTICS', 'LOCALIZATION', 'EMAIL', 'FILE_SYSTEM']) {
  assert.match(performanceSpec, new RegExp(`KODETY_E2E_${prefix}_TRIGGER_SELECTOR`));
  assert.match(performanceSpec, new RegExp(`KODETY_E2E_${prefix}_LAZY_RESOURCE_REGEX`));
}

assert.match(performanceMatrix, /KODETY_E2E_SMALL_SETUP_ARGV/);
assert.match(performanceMatrix, /KODETY_E2E_LARGE_SETUP_ARGV/);
assert.match(performanceMatrix, /KODETY_E2E_LEGACY_SETUP_ARGV/);
assert.match(performanceMatrix, /profile:\s*['"]small['"]/);
assert.match(performanceMatrix, /profile:\s*['"]large['"]/);
assert.match(performanceMatrix, /profile:\s*['"]legacy['"]/);
assert.match(performanceMatrix, /shell:\s*false/);
assert.match(performanceMatrix, /wordpress:e2e:performance/);
assert.doesNotMatch(performanceMatrix, /shell:\s*true/);
assert.match(performanceMatrix, /nodeMajor === 22 && nodeMinor >= 12/);
assert.match(performanceMatrix, /nodeMajor === 24/);
assert.match(performanceMatrix, /nodeMajor === 26/);
assert.match(performanceMatrix, /delete setupEnvironment\.KODETY_E2E_USER/);
assert.match(performanceMatrix, /delete setupEnvironment\.KODETY_E2E_PASSWORD/);
assert.match(performanceMatrix, /const releaseThrottles = \[['"]slow4g['"], ['"]fast3g['"]\]/);
assert.match(performanceMatrix, /KODETY_E2E_PERF_EVIDENCE:\s*['"]all['"]/);
for (const requiredPreflight of [
  'KODETY_E2E_PERF_BUDGET_PATH',
  'KODETY_E2E_BUILDER_INTERACTION_SELECTOR',
  'KODETY_E2E_PUBLISHED_INTERACTION_SELECTOR',
  'KODETY_E2E_SOAK_OPEN_SELECTOR',
  'KODETY_E2E_SOAK_CLOSE_SELECTOR',
]) {
  assert.match(performanceMatrix, new RegExp(requiredPreflight));
}
assert.match(performanceMatrix, /validateReleasePerformanceBudget/);
assert.ok(
  performanceMatrix.indexOf('validateReleasePerformanceBudget')
    < performanceMatrix.indexOf('run(job.setup'),
  'O budget completo deve ser validado antes de qualquer setup mutacional.',
);
assert.match(performanceMatrix, /Os seletores de abrir e fechar o soak precisam ser distintos/);
assert.doesNotMatch(performanceMatrix, /\|\| ['"]none['"]/);

assert.match(releaseSmokeRunner, /KODETY_E2E_REQUIRE_PUBLISH:\s*['"]1['"]/);
assert.doesNotMatch(
  releaseSmokeRunner,
  /KODETY_E2E_ALLOW_PUBLISH:\s*['"]1['"]/,
  'O wrapper de release não pode autorizar publicação em nome do operador.',
);

assert.match(guide, /Node\.js 22\.12\+, 24 ou 26/i);
assert.match(guide, /@playwright\/test@1\.62\.1/);
assert.doesNotMatch(guide, /VERSAO_VALIDADA|versão validada/i);
assert.match(guide, /browsers?[\s\S]{0,100}fora do Git/i);
assert.match(guide, /KODETY_E2E_BASE_URL/);
assert.match(guide, /KODETY_E2E_USER/);
assert.match(guide, /KODETY_E2E_PASSWORD/);
assert.match(guide, /quick/i);
assert.match(guide, /smoke/i);
assert.match(guide, /release/i);
assert.match(guide, /MySQL/i);
assert.match(guide, /1\.1\.03/);
assert.match(guide, /1\.1\.10/);
assert.match(guide, /cinco pares|5 pares/i);
assert.match(guide, /cold/i);
assert.match(guide, /warm/i);
assert.match(guide, /KODETY_E2E_SMALL_PROJECT_FINGERPRINT/);
assert.match(guide, /KODETY_E2E_LARGE_PROJECT_FINGERPRINT/);
assert.match(guide, /KODETY_E2E_INSTALLED_FINGERPRINT_URL/);
assert.match(guide, /authenticated-same-origin-receipt|GET autenticado e same-origin/i);
assert.match(guide, /KODETY_E2E_PUBLISHED_MARKER/);
assert.match(guide, /TRIGGER_SELECTOR/);
assert.match(guide, /LAZY_RESOURCE_REGEX/);
assert.match(guide, /run-wordpress-performance-matrix\.mjs/);
assert.match(guide, /KODETY_E2E_SMALL_SETUP_ARGV/);
assert.match(guide, /80 amostras/);
assert.match(guide, /240 para small \+ large \+ legacy/);
assert.match(guide, /480 na passagem Slow 4G \+ Fast 3G/i);
assert.match(guide, /Slow 4G \+ Fast 3G|Slow 4G e Fast 3G/i);
assert.match(guide, /KODETY_E2E_PERF_BUDGET_PATH/);
assert.match(guide, /contexto anônimo/i);
assert.match(guide, /KODETY_E2E_PERF_THROTTLE_PROFILE/);
assert.match(guide, /wordpress:e2e:release/);
assert.match(guide, /Speed Index/i);
assert.match(guide, /thirdPartyRequestCount/);
assert.match(guide, /thirdPartyTransferBytes/);
assert.match(guide, /KODETY_E2E_BUILDER_INTERACTION_SELECTOR/);
assert.match(guide, /KODETY_E2E_PUBLISHED_INTERACTION_SELECTOR/);
assert.match(guide, /INP de laboratório/i);
assert.match(guide, /mediana/i);
assert.match(guide, /MAD/);
assert.match(guide, /IQR/);
assert.match(guide, /KODETY_PERFORMANCE_DEBUG/);

// O wiring global fica por último para que regressões do harness exclusivo
// continuem visíveis mesmo enquanto package/lock aguardam o merge coordenado.
assert.equal(packageManifest.devDependencies?.['@playwright/test'], '1.62.1');
assert.equal(lockManifest.packages?.['']?.devDependencies?.['@playwright/test'], '1.62.1');
assert.equal(lockManifest.packages?.['node_modules/@playwright/test']?.version, '1.62.1');
assert.match(packageManifest.scripts?.['wordpress:e2e:installed'] || '', /wordpress-installed-smoke\.spec\.mjs/);
assert.match(packageManifest.scripts?.['wordpress:e2e:release'] || '', /run-wordpress-release-smoke\.mjs/);
assert.match(
  packageManifest.scripts?.['wordpress:e2e:performance'] || '',
  /--config(?:=|\s+)e2e\/playwright\.performance\.config\.mjs/,
  'o comando de performance deve usar a configuração isolada, não a configuração/trace do smoke',
);

console.log('Contratos do smoke e do perfil E2E de performance aprovados sem carregar Playwright.');
