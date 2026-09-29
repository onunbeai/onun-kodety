import { startPlaygroundWeb, type PlaygroundClient } from '@wp-playground/client';
import { bootProject, flushProject, PLAYGROUND_REMOTE_ORIGIN } from '../../../ChromeExtension/kodety-studio/src/playground-runtime';
import { newProject, opfsPathForProject, type KodetyStudioProject } from '../../../ChromeExtension/kodety-studio/src/storage';

const FIXTURE_KEY = 'kodetyStudioSqliteDiagnosticFixtureV1';
const LOG_KEY = 'kodetyStudioSqliteDiagnosticLogV1';
const iframe = document.querySelector<HTMLIFrameElement>('#runtime')!;
const fixtureElement = document.querySelector<HTMLPreElement>('#fixture')!;
const logElement = document.querySelector<HTMLPreElement>('#log')!;
let client: PlaygroundClient | null = null;
let fixture: KodetyStudioProject | null = JSON.parse(localStorage.getItem(FIXTURE_KEY) || 'null');
logElement.textContent = localStorage.getItem(LOG_KEY) || '';

function log(label: string, value?: unknown) {
  const data = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const line = `${new Date().toISOString()} ${label}${data ? `\n${data}` : ''}\n\n`;
  logElement.textContent = `${logElement.textContent}${line}`.slice(-650_000);
  logElement.scrollTop = logElement.scrollHeight;
  localStorage.setItem(LOG_KEY, logElement.textContent);
}

function describeError(error: unknown, depth = 0): unknown {
  if (depth > 6) return String(error);
  if (error && typeof error === 'object') {
    const value = error as Error & { errors?: unknown[] };
    return {
      name: value.name, message: value.message, stack: value.stack,
      cause: value.cause ? describeError(value.cause, depth + 1) : undefined,
      errors: value.errors?.map(item => describeError(item, depth + 1)),
    };
  }
  return String(error);
}

function saveFixture(project: KodetyStudioProject) {
  fixture = project;
  localStorage.setItem(FIXTURE_KEY, JSON.stringify(project));
  fixtureElement.textContent = JSON.stringify(project, null, 2);
}
if (fixture) fixtureElement.textContent = JSON.stringify(fixture, null, 2);

function requireFixture() {
  if (!fixture || !fixture.name.startsWith('SQLite diagnostic ')) throw new Error('Crie um fixture de diagnóstico primeiro.');
  return fixture;
}

function requireClient() {
  if (!client) throw new Error('Não há cliente disponível. Use Reabrir em duas fases para diagnosticar um boot que falha.');
  return client;
}

async function closeRuntime() {
  if (client) {
    try { await flushProject(client); }
    catch (error) {
      if (!(error instanceof Error) || !/No OPFS mount found/.test(error.message)) throw error;
    }
  }
  client = null;
  iframe.src = 'about:blank';
}

async function runPhp(label: string, code: string) {
  const response = await requireClient().run({ code });
  log(label, { exitCode: response.exitCode, errors: response.errors, status: response.httpStatusCode, bytes: new TextDecoder().decode(response.bytes) });
  return response;
}

async function inspectDatabase() {
  const activeClient = requireClient();
  for (const path of ['/wordpress/.maintenance', '/wordpress/wp-content/debug.log']) {
    const exists = await activeClient.fileExists(path);
    log(`PRE-WP FILE ${path}`, exists ? (await activeClient.readFileAsText(path)).slice(-35000) : 'ABSENT');
  }
  const directory = '/wordpress/wp-content/database';
  if (!await activeClient.isDir(directory)) {
    log('DATABASE DIRECTORY MISSING', directory);
    return;
  }
  const entries = await activeClient.listFiles(directory, { prependPath: true });
  const files: { path: string; size: number; sqliteHeader: boolean; header: string }[] = [];
  const copied: string[] = [];
  for (const path of entries) {
    if (path === directory || await activeClient.isDir(path)) continue;
    const bytes = await activeClient.readFileAsBuffer(path);
    const header = new TextDecoder().decode(bytes.slice(0, 16));
    const sqliteHeader = header === 'SQLite format 3\0';
    files.push({ path, size: bytes.byteLength, sqliteHeader, header });
    if (sqliteHeader) {
      const target = `/tmp/kodety-diagnostic-${copied.length}.sqlite`;
      await activeClient.writeFile(target, bytes);
      copied.push(target);
    }
  }
  log('DATABASE FILES BEFORE WORDPRESS', files);
  for (const path of copied) {
    await runPhp(`QUICK_CHECK COPY ${path}`, `<?php
      try {
        $db = new PDO('sqlite:${path}');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $data = [
          'integrity' => $db->query('PRAGMA quick_check')->fetchAll(PDO::FETCH_COLUMN),
          'tables' => $db->query("SELECT name FROM sqlite_master WHERE type='table'")->fetchAll(PDO::FETCH_COLUMN),
        ];
        if (in_array('wp_options', $data['tables'], true)) {
          $data['options'] = $db->query("SELECT option_name, option_value FROM wp_options WHERE option_name IN ('active_plugins','template','stylesheet','kodety_onboarding_status','kodety_browser_runtime')")->fetchAll(PDO::FETCH_ASSOC);
        }
        echo json_encode($data);
      } catch (Throwable $e) { echo json_encode(['exception' => $e->getMessage(), 'trace' => $e->getTraceAsString()]); exit(1); }
    `);
  }
}

async function inspectWordPress() {
  const activeClient = requireClient();
  await runPhp('WP_LOAD HEALTH', `<?php
    ini_set('display_errors', '1');
    error_reporting(E_ALL);
    register_shutdown_function(function() { echo "\\nKODETY_SHUTDOWN:" . json_encode(error_get_last()); });
    try {
      require_once '/wordpress/wp-load.php';
      global $wpdb, $wp_version;
      echo "\\nKODETY_DIAGNOSTIC:" . json_encode([
        'wordpress' => $wp_version,
        'databaseClass' => get_class($wpdb),
        'connected' => $wpdb->check_connection(false),
        'lastError' => $wpdb->last_error,
        'databaseFile' => defined('FQDB') ? FQDB : null,
        'browserMarker' => defined('KODETY_BROWSER_STUDIO_RUNTIME') ? KODETY_BROWSER_STUDIO_RUNTIME : null,
        'activePlugins' => get_option('active_plugins'),
        'onboarding' => get_option('kodety_onboarding_status'),
        'requestUri' => $_SERVER['REQUEST_URI'] ?? null,
      ]);
    } catch (Throwable $e) { echo "\\nKODETY_EXCEPTION:" . json_encode(['class' => get_class($e), 'message' => $e->getMessage(), 'trace' => $e->getTraceAsString()]); exit(1); }
  `);
  for (const path of ['/wordpress/wp-content/debug.log', '/internal/shared/php-errors.log']) {
    if (await activeClient.fileExists(path)) log(`PHP LOG ${path}`, (await activeClient.readFileAsText(path)).slice(-35000));
  }
}

async function normalBoot(project: KodetyStudioProject) {
  await closeRuntime();
  log('NORMAL BOOT START', project);
  const result = await bootProject({
    iframe, project, language: 'pt',
    onStage: (stage, detail) => log(`STAGE ${stage}`, detail),
    onPersisted: async persisted => { saveFixture(persisted); log('PERSISTED BEFORE SETUP COMPLETE', persisted); },
  });
  client = result.client;
  saveFixture({ ...project, ...result.runtimeVersions, initialized: true, runtimeRevision: result.runtimeRevision, updatedAt: Date.now() });
  log('NORMAL BOOT READY', { initializedNow: result.initializedNow, versions: result.runtimeVersions });
}

async function twoPhaseBoot() {
  const project = requireFixture();
  if (!project.initialized) throw new Error('O fixture ainda não tem filesystem persistido.');
  await closeRuntime();
  log('TWO PHASE: TEMPORARY WORDPRESS WITHOUT OPFS', project.id);
  client = await startPlaygroundWeb({
    iframe, remoteUrl: `${PLAYGROUND_REMOTE_ORIGIN}/remote.html`,
    scope: `diagnostic-${project.id.replace(/[^a-z0-9]/gi, '').slice(0, 26)}`,
    disableProgressBar: true, detailedProgressCaptions: true,
    wordpressInstallMode: 'download-and-install',
    blueprint: { preferredVersions: { php: project.phpVersion, wp: project.wordpressVersion }, features: { networking: true } },
  });
  await client.defineConstant('KODETY_BROWSER_STUDIO_RUNTIME', project.id);
  log('TWO PHASE: MOUNTING EXISTING FILES INTO MEMORY');
  await client.mountOpfs({ device: { type: 'opfs', path: opfsPathForProject(project.id) }, mountpoint: '/wordpress', initialSyncDirection: 'opfs-to-memfs' });
  log('TWO PHASE: MOUNTED, NOW INSPECTING DATABASE BEFORE WP_LOAD');
  await inspectDatabase();
  await inspectWordPress();
}

function action(id: string, callback: () => Promise<void>) {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', async () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => !['hard-reload', 'clear-log'].includes(button.id));
    buttons.forEach(button => { button.disabled = true; });
    try { await callback(); }
    catch (error) { log(`ERROR ${id}`, describeError(error)); }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  });
}

action('create', async () => {
  const project = newProject(`SQLite diagnostic ${new Date().toISOString()}`, 'pt_BR');
  saveFixture(project);
  await normalBoot(project);
});
action('reopen', async () => normalBoot(requireFixture()));
action('old-wordpress-metadata', async () => {
  const project = requireFixture();
  saveFixture({ ...project, wordpressVersion: '7.0' });
  log('FIXTURE-ONLY STALE WORDPRESS METADATA', { stored: '7.0', databaseUnchanged: true });
});
action('two-phase', twoPhaseBoot);
action('database', inspectDatabase);
action('health', inspectWordPress);
action('flush', async () => { await closeRuntime(); log('FLUSH COMPLETE, RUNTIME CLOSED'); });
action('simulate-maintenance', async () => {
  requireFixture();
  const activeClient = requireClient();
  const content = `<?php $upgrading = ${Math.floor(Date.now() / 1000)};`;
  await activeClient.writeFile('/wordpress/.maintenance', content);
  await flushProject(activeClient);
  log('FIXTURE-ONLY MAINTENANCE SIMULATION CREATED', content);
});
action('remove-maintenance', async () => {
  requireFixture();
  const activeClient = requireClient();
  if (await activeClient.fileExists('/wordpress/.maintenance')) {
    await activeClient.unlink('/wordpress/.maintenance');
    await flushProject(activeClient);
  }
  log('FIXTURE-ONLY MAINTENANCE REMOVAL COMPLETE');
});
document.querySelector('#hard-reload')!.addEventListener('click', () => { log('IMMEDIATE PAGE RELOAD WITHOUT FLUSH'); location.reload(); });
document.querySelector('#clear-log')!.addEventListener('click', () => { logElement.textContent = ''; localStorage.removeItem(LOG_KEY); });
log('HARNESS LOADED', { origin: location.origin, fixtureId: fixture?.id || null });
