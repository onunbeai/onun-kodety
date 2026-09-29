import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateReleasePerformanceBudget } from './performance-budget.mjs';

function requiredEnvironment(name) {
  const value = process.env[name]?.trim() || '';
  if (!value) {
    throw new Error(`Defina ${name}; a matriz não inventa fixture, URL ou credencial.`);
  }
  return value;
}

function requiredArgv(name) {
  const source = requiredEnvironment(name);
  let argv;
  try {
    argv = JSON.parse(source);
  } catch {
    throw new Error(`${name} deve ser um array JSON de strings.`);
  }
  if (
    !Array.isArray(argv)
    || argv.length === 0
    || argv.some(value => typeof value !== 'string' || value.length === 0)
  ) {
    throw new Error(`${name} deve ser um array JSON não vazio de strings.`);
  }
  return argv;
}

function boundedOptionalInteger(name, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
}

function compileOptionalAllowlist(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return;
  let entries;
  if (raw.startsWith('[')) {
    try {
      entries = JSON.parse(raw);
    } catch {
      throw new Error(`${name} deve ser um array JSON de expressões regulares.`);
    }
  } else {
    entries = raw.split(/\r?\n/);
  }
  if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) {
    throw new Error(`${name} deve conter apenas expressões regulares em texto.`);
  }
  for (const entry of entries.filter(Boolean)) {
    try {
      new RegExp(entry, 'i');
    } catch {
      throw new Error(`${name} contém uma expressão regular inválida.`);
    }
  }
}

function run(argv, environment, label) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} foi interrompido por ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${label} falhou com status ${result.status}.`);
}

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportedNode = (nodeMajor === 22 && nodeMinor >= 12)
  || nodeMajor === 24
  || nodeMajor === 26;
if (!supportedNode) {
  throw new Error(
    `A matriz de release exige Node.js 22.12+, 24 ou 26; recebido ${process.version}.`,
  );
}

for (const name of [
  'KODETY_E2E_BASE_URL',
  'KODETY_E2E_USER',
  'KODETY_E2E_PASSWORD',
  'KODETY_E2E_SMALL_PROJECT_FINGERPRINT',
  'KODETY_E2E_LARGE_PROJECT_FINGERPRINT',
  'KODETY_E2E_LEGACY_PROJECT_FINGERPRINT',
  'KODETY_E2E_INSTALLED_FINGERPRINT_URL',
  'KODETY_E2E_PUBLISHED_URL',
  'KODETY_E2E_PUBLISHED_MARKER',
  'KODETY_E2E_PUBLISHED_INTERACTION_SELECTOR',
  'KODETY_E2E_SMALL_BUILDER_URL',
  'KODETY_E2E_LARGE_BUILDER_URL',
  'KODETY_E2E_LEGACY_BUILDER_URL',
  'KODETY_E2E_BUILDER_INTERACTION_SELECTOR',
  'KODETY_E2E_SETTINGS_INTERACTION_SELECTOR',
  'KODETY_E2E_CMS_INTERACTION_SELECTOR',
  'KODETY_E2E_ANALYTICS_INTERACTION_SELECTOR',
  'KODETY_E2E_LOCALIZATION_INTERACTION_SELECTOR',
  'KODETY_E2E_EMAIL_INTERACTION_SELECTOR',
  'KODETY_E2E_FILE_SYSTEM_INTERACTION_SELECTOR',
  'KODETY_E2E_SETTINGS_TRIGGER_SELECTOR',
  'KODETY_E2E_SETTINGS_LAZY_RESOURCE_REGEX',
  'KODETY_E2E_CMS_TRIGGER_SELECTOR',
  'KODETY_E2E_CMS_LAZY_RESOURCE_REGEX',
  'KODETY_E2E_ANALYTICS_TRIGGER_SELECTOR',
  'KODETY_E2E_ANALYTICS_LAZY_RESOURCE_REGEX',
  'KODETY_E2E_LOCALIZATION_TRIGGER_SELECTOR',
  'KODETY_E2E_LOCALIZATION_LAZY_RESOURCE_REGEX',
  'KODETY_E2E_EMAIL_TRIGGER_SELECTOR',
  'KODETY_E2E_EMAIL_LAZY_RESOURCE_REGEX',
  'KODETY_E2E_FILE_SYSTEM_TRIGGER_SELECTOR',
  'KODETY_E2E_FILE_SYSTEM_LAZY_RESOURCE_REGEX',
  'KODETY_E2E_PERF_BUDGET_PATH',
  'KODETY_E2E_SOAK_OPEN_SELECTOR',
  'KODETY_E2E_SOAK_CLOSE_SELECTOR',
]) {
  requiredEnvironment(name);
}

if (
  requiredEnvironment('KODETY_E2E_SOAK_OPEN_SELECTOR')
  === requiredEnvironment('KODETY_E2E_SOAK_CLOSE_SELECTOR')
) {
  throw new Error('Os seletores de abrir e fechar o soak precisam ser distintos.');
}

let siteBase;
try {
  const rawBase = requiredEnvironment('KODETY_E2E_BASE_URL');
  siteBase = new URL(rawBase.endsWith('/') ? rawBase : `${rawBase}/`);
} catch {
  throw new Error('KODETY_E2E_BASE_URL deve ser uma URL HTTP(S) válida.');
}
if (!['http:', 'https:'].includes(siteBase.protocol) || siteBase.username || siteBase.password) {
  throw new Error('KODETY_E2E_BASE_URL deve ser HTTP(S) e não pode conter credenciais.');
}
for (const name of [
  'KODETY_E2E_INSTALLED_FINGERPRINT_URL',
  'KODETY_E2E_PUBLISHED_URL',
  'KODETY_E2E_SMALL_BUILDER_URL',
  'KODETY_E2E_LARGE_BUILDER_URL',
  'KODETY_E2E_LEGACY_BUILDER_URL',
  'KODETY_E2E_LOGIN_URL',
  'KODETY_E2E_SETTINGS_URL',
  'KODETY_E2E_CMS_URL',
  'KODETY_E2E_ANALYTICS_URL',
  'KODETY_E2E_LOCALIZATION_URL',
  'KODETY_E2E_EMAIL_URL',
  'KODETY_E2E_FILE_SYSTEM_URL',
]) {
  const raw = process.env[name]?.trim();
  if (!raw) continue;
  let resolved;
  try {
    resolved = new URL(raw.replace(/^\/(?!\/)/, ''), siteBase);
  } catch {
    throw new Error(`${name} deve ser uma URL HTTP(S) válida.`);
  }
  if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== siteBase.origin) {
    throw new Error(`${name} deve permanecer na origem de KODETY_E2E_BASE_URL.`);
  }
}
boundedOptionalInteger('KODETY_E2E_LOADING_TIMEOUT_MS', 1_000, 10 * 60_000);
boundedOptionalInteger('KODETY_E2E_PERF_SETTLE_MS', 500, 10_000);
boundedOptionalInteger('KODETY_E2E_SOAK_DURATION_MS', 30 * 60_000, 2 * 60 * 60_000);
boundedOptionalInteger('KODETY_E2E_SOAK_CYCLE_MS', 1_000, 60_000);
compileOptionalAllowlist('KODETY_E2E_CONSOLE_ERROR_ALLOWLIST');
compileOptionalAllowlist('KODETY_E2E_HTTP_ERROR_ALLOWLIST');

const performanceBudgetPath = requiredEnvironment('KODETY_E2E_PERF_BUDGET_PATH');
let performanceBudgetSource;
try {
  performanceBudgetSource = readFileSync(performanceBudgetPath, 'utf8');
} catch {
  throw new Error(`Não foi possível ler KODETY_E2E_PERF_BUDGET_PATH: ${performanceBudgetPath}.`);
}
validateReleasePerformanceBudget({ budget: performanceBudgetSource });

const expectedFingerprints = [
  requiredEnvironment('KODETY_E2E_SMALL_PROJECT_FINGERPRINT').toLowerCase(),
  requiredEnvironment('KODETY_E2E_LARGE_PROJECT_FINGERPRINT').toLowerCase(),
  requiredEnvironment('KODETY_E2E_LEGACY_PROJECT_FINGERPRINT').toLowerCase(),
];
if (!expectedFingerprints.every(value => /^[a-f0-9]{64}$/.test(value))) {
  throw new Error('Os fingerprints small/large devem ser SHA-256 hexadecimais.');
}
if (new Set(expectedFingerprints).size !== expectedFingerprints.length) {
  throw new Error('As fixtures small, large e legacy devem ter fingerprints distintos.');
}
for (const workspace of ['SETTINGS', 'CMS', 'ANALYTICS', 'LOCALIZATION', 'EMAIL', 'FILE_SYSTEM']) {
  const name = `KODETY_E2E_${workspace}_LAZY_RESOURCE_REGEX`;
  try {
    new RegExp(requiredEnvironment(name), 'i');
  } catch {
    throw new Error(`${name} deve ser uma expressão regular válida.`);
  }
}

const jobs = [
  {
    profile: 'small',
    setup: requiredArgv('KODETY_E2E_SMALL_SETUP_ARGV'),
  },
  {
    profile: 'large',
    setup: requiredArgv('KODETY_E2E_LARGE_SETUP_ARGV'),
  },
  {
    profile: 'legacy',
    setup: requiredArgv('KODETY_E2E_LEGACY_SETUP_ARGV'),
  },
];
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const releaseThrottles = ['slow4g', 'fast3g'];

for (const throttle of releaseThrottles) {
  for (const job of jobs) {
    const environment = {
      ...process.env,
      KODETY_E2E_PROJECT_PROFILE: job.profile,
      KODETY_E2E_PERF_THROTTLE_PROFILE: throttle,
      KODETY_E2E_PERF_EVIDENCE: 'all',
    };
    const setupEnvironment = { ...environment };
    delete setupEnvironment.KODETY_E2E_USER;
    delete setupEnvironment.KODETY_E2E_PASSWORD;
    run(job.setup, setupEnvironment, `setup ${job.profile}/${throttle}`);
    run(
      [npmExecutable, 'run', 'wordpress:e2e:performance'],
      environment,
      `performance ${job.profile}/${throttle}`,
    );
  }
}
