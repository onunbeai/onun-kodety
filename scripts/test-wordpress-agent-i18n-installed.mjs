import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import JSZip from 'jszip';

// A read-only browser smoke against a separately prepared disposable site.
// This runner neither installs the candidate nor stages/imports a project.
const args = process.argv.slice(2);
const argument = name => {
  const index = args.indexOf(name);
  assert.ok(index >= 0 && args[index + 1] && !args[index + 1].startsWith('--'), `Pass ${name}`);
  return args[index + 1];
};
const environmentPath = path.resolve(argument('--environment'));
const pluginZipPath = path.resolve(argument('--plugin-zip'));
const expectedHash = argument('--expected-sha256');
const outputPath = path.resolve(argument('--output'));
assert.match(expectedHash, /^[a-f0-9]{64}$/);
const environment = JSON.parse(await readFile(environmentPath, 'utf8'));
const privateValues = Object.entries(environment)
  .filter(([key, value]) => /PASSWORD|SECRET|TOKEN|KODETY_E2E_USER/.test(key) && typeof value === 'string' && value)
  .map(([, value]) => value);
const redact = value => privateValues.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value))
  .replace(/https?:\/\/[^\s)]+/g, '[url]');
const wp = (...command) => {
  try {
    return execFileSync('wp', [`--path=${wpRoot}`, ...command], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    }).trim();
  } catch {
    // Child-process exceptions can include command output or private arguments.
    throw new Error('The guarded WordPress CLI command failed; no private output was logged.');
  }
};
const outside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
let wpRoot;
let browser;
let activePage;
let localeSnapshot;
let userId;
let failure;
const report = {
  startedAt: new Date().toISOString(), status: 'running',
  scope: 'Installed browser UI, native read permissions and locale/layout smoke; no model or licensed bearer execution.',
  steps: [], screenshots: [], browserErrors: [],
};

async function installedCandidate() {
  const bytes = await readFile(pluginZipPath);
  assert.equal(sha256(bytes), expectedHash, 'The candidate ZIP must match the explicitly supplied SHA-256');
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const entries = Object.values(archive.files).filter(entry => !entry.dir);
  assert.ok(entries.length > 0);
  const pluginRoot = await realpath(path.join(wpRoot, 'wp-content/plugins/kodety'));
  assert.equal(pluginRoot, path.join(wpRoot, 'wp-content/plugins/kodety'), 'The installed plugin must not be a symlink');
  const expectedPaths = [];
  for (const entry of entries) {
    assert.equal(entry.unsafeOriginalName || entry.name, entry.name, 'ZIP traversal paths are not accepted');
    assert.ok(entry.name.startsWith('kodety/'));
    const relative = entry.name.slice('kodety/'.length);
    assert.ok(relative && !relative.split('/').some(part => part === '..' || part === '.') && !relative.includes('\\'));
    const installedPath = path.join(pluginRoot, relative);
    assert.equal(await realpath(installedPath), installedPath, `Installed file must not be a symlink: ${relative}`);
    assert.equal(sha256(await readFile(installedPath)), sha256(await entry.async('nodebuffer')), `Installed bytes differ: ${relative}`);
    expectedPaths.push(relative);
  }
  const installedPaths = [];
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), 'The installed plugin must not contain symlinks');
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else installedPaths.push(path.relative(pluginRoot, absolute).split(path.sep).join('/'));
    }
  };
  await walk(pluginRoot);
  assert.deepEqual(installedPaths.sort(), expectedPaths.sort(), 'The installed file inventory must match the ZIP');
  const header = await archive.file('kodety/kodety.php')?.async('string');
  const version = header?.match(/^\s*\*?\s*Version:\s*(\S+)/m)?.[1];
  assert.ok(version, 'Candidate has a WordPress version header');
  assert.equal(wp('plugin', 'get', 'kodety', '--field=version'), version);
  assert.equal(wp('plugin', 'get', 'kodety', '--field=status'), 'active');
  return { sha256: expectedHash, version, fileCount: expectedPaths.length, installedBytesMatch: true };
}

async function step(name, action) {
  console.log(`RUN ${name}`);
  let deadline;
  try {
    const details = await Promise.race([
      action(),
      new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error(`Browser step exceeded 150 seconds: ${name}`)), 150_000); }),
    ]);
    report.steps.push({ name, status: 'passed', ...(details ? { details } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.steps.push({ name, status: 'failed', message: redact(error.message) });
    throw error;
  } finally { clearTimeout(deadline); }
}

const labels = {
  'pt-BR': {
    settings: 'Ajustes', collections: 'Coleções', fields: 'Campos', site: 'Ajustes gerais', style: 'Estilo', interactions: 'Interações',
    editing: 'Editando', justify: 'Justificar', wrap: 'Quebra', sizing: 'Tamanho', general: 'Geral',
    redirects: 'Redirecionamentos', cookies: 'Consentimento', published: 'Publicado em', alt: 'Texto alternativo', updated: 'Atualizado',
  },
  en: {
    settings: 'Settings', collections: 'Collections', fields: 'Fields', site: 'Site Settings', style: 'Style', interactions: 'Interactions',
    editing: 'Editing', justify: 'Justify', wrap: 'Wrap', sizing: 'Sizing', general: 'General',
    redirects: 'Redirects', cookies: 'Cookie Consent', published: 'Published on', alt: 'Alt text', updated: 'Updated',
  },
};

async function localeReady(page, locale) {
  await expect.poll(() => page.evaluate(() => window.kodetyAdminI18n?.locale)).toBe(locale);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

async function bridgeContext(page, workspace) {
  await page.waitForFunction(() => {
    const runtime = window.__kodetyHtmlAgentEditorBridgeRuntimeV1;
    return runtime?.store?.getState().available && typeof runtime.activeBridge?.invoke === 'function';
  });
  const result = await page.evaluate(async () => {
    const runtime = window.__kodetyHtmlAgentEditorBridgeRuntimeV1;
    const value = await runtime.activeBridge.invoke('kodety_editor_context', {}, {
      requestId: 'installed-ui-read', callId: 'installed-ui-read', threadId: 'installed-ui-read', turnId: 'installed-ui-read',
    });
    return {
      available: runtime.store.getState().available,
      workspace: value?.editor?.workspace,
      nativeTools: value?.editor?.nativePanel?.tools || [],
      readOnly: runtime.store.getState().readOnly,
    };
  });
  assert.equal(result.available, true);
  if (workspace !== 'design') assert.equal(result.workspace, workspace);
  if (workspace === 'cms') {
    assert.ok(result.nativeTools.includes('kodety_native_catalog'));
    assert.ok(result.nativeTools.includes('kodety_native_call'));
  }
  return result;
}

async function layoutAndScreenshot(page, locale, surface, anchors) {
  await page.evaluate(async () => {
    await Promise.race([
      document.fonts.ready,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Interface fonts did not settle')), 15_000)),
    ]);
    await new Promise(resolve => window.__kodetySmokeNativeRaf(() => window.__kodetySmokeNativeRaf(resolve)));
  });
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    topbarHeight: document.querySelector('[data-workspace-topbar]')?.getBoundingClientRect().height ?? null,
    dockWidth: document.querySelector('[data-workspace-agent-dock]')?.getBoundingClientRect().width ?? null,
  }));
  assert.ok(Math.max(layout.document, layout.body) <= layout.viewport + 1, `${surface}/${locale} must not overflow horizontally`);
  for (const anchor of anchors) {
    await expect(anchor).toBeVisible();
    const box = await anchor.boundingBox();
    assert.ok(box && box.width > 0 && box.x >= -1 && box.x + box.width <= layout.viewport + 1, 'Interface anchor must fit inside the viewport');
    const clipped = await anchor.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim() || node.parentElement?.closest('.sr-only,[aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 1 && rect.height > 1 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) return true;
        }
      }
      return false;
    });
    assert.equal(clipped, false, 'The tested interface label must not be horizontally clipped');
  }
  const file = `${locale}-${surface}.png`;
  await page.screenshot({ path: path.join(outputPath, file), fullPage: false, animations: 'disabled' });
  report.screenshots.push(file);
  return layout;
}

async function nativeRead(page) {
  return page.evaluate(async () => {
    const config = window.kodetyWordPress;
    if (!config?.nonce || !(config.automationToolsUrl || config.projectUrl || config.cmsSchemaUrl)) {
      return { status: 'skipped', reason: 'Signed WordPress REST endpoint configuration was not exposed.' };
    }
    const endpoint = kind => {
      const configured = kind === 'tools' ? config.automationToolsUrl : config.automationCallUrl;
      if (configured) return configured;
      const url = new URL(config.projectUrl || config.cmsSchemaUrl, location.href);
      if (url.searchParams.get('rest_route')?.startsWith('/kodety/v1/')) {
        url.searchParams.set('rest_route', `/kodety/v1/automation/${kind}`);
      } else if (url.pathname.includes('/kodety/v1/')) {
        url.pathname = `${url.pathname.split('/kodety/v1/')[0]}/kodety/v1/automation/${kind}`;
      } else throw new Error('The signed endpoint does not expose the Kodety REST namespace');
      return url.href;
    };
    const toolsUrl = endpoint('tools');
    const callUrl = endpoint('call');
    for (const endpoint of [toolsUrl, callUrl]) {
      if (new URL(endpoint, location.href).origin !== location.origin) throw new Error('Native reads must remain on the disposable origin');
    }
    const signal = AbortSignal.timeout(20_000);
    const catalogResponse = await fetch(toolsUrl, {
      credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': config.nonce }, signal,
    });
    if (!catalogResponse.ok) throw new Error(`Native catalog HTTP ${catalogResponse.status}`);
    const catalog = await catalogResponse.json();
    const operation = catalog.operations?.find(entry => entry.name === 'cms_schema');
    if (catalog.schemaVersion !== 1 || operation?.readOnly !== true) throw new Error('The real catalog must declare cms_schema as read-only');
    const response = await fetch(callUrl, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'X-WP-Nonce': config.nonce, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'cms_schema', arguments: {} }),
    });
    if (!response.ok) throw new Error(`Native CMS read HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== 'object' || !data.revision) throw new Error('The native CMS read did not include its revision');
    // No nonce, credentials, authored CMS content or schema contents leave the page.
    return { status: 'passed', operation: 'cms_schema', catalogSize: catalog.operations.length, httpStatus: response.status, revisionPresent: true };
  });
}

try {
  wpRoot = await realpath(environment.KODETY_STABILITY_WP_ROOT);
  assert.ok(path.basename(wpRoot).startsWith('kodety-stability-wp-'), 'A disposable stability WordPress is required');
  const site = new URL(environment.KODETY_E2E_BASE_URL);
  assert.equal(site.protocol, 'http:');
  assert.equal(site.hostname, '127.0.0.1', 'Only loopback staging is supported');
  assert.ok(!site.username && !site.password && site.pathname === '/' && !site.search && !site.hash);
  assert.ok(outside(wpRoot, await realpath(environmentPath)), 'Credentials must stay outside the served WordPress');
  assert.ok(outside(wpRoot, outputPath), 'Reports must stay outside the served WordPress');
  await mkdir(outputPath, { recursive: true });
  assert.ok(outside(wpRoot, await realpath(outputPath)), 'Reports must stay outside the served WordPress');
  assert.match(wp('config', 'get', 'DB_NAME'), /^kodety_stability_/);
  assert.equal(wp('eval', 'echo wp_get_environment_type();'), 'local');
  assert.equal(wp('option', 'get', 'home'), site.origin);
  assert.equal(wp('option', 'get', 'siteurl'), site.origin);
  report.candidate = await installedCandidate();
  report.origin = site.origin;
  userId = Number(wp('user', 'get', environment.KODETY_E2E_USER, '--field=ID'));
  assert.ok(Number.isSafeInteger(userId) && userId > 0);
  const localeState = `echo wp_json_encode(['optionExists'=>get_option('kodety_admin_ui_locale', null)!==null,'option'=>get_option('kodety_admin_ui_locale', null),'userExists'=>metadata_exists('user',${userId},'locale'),'user'=>get_user_meta(${userId},'locale',true)]);`;
  localeSnapshot = JSON.parse(wp('eval', localeState));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => { window.__kodetySmokeNativeRaf = window.requestAnimationFrame.bind(window); });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(45_000);
  page.setDefaultNavigationTimeout(90_000);
  page.on('pageerror', error => report.browserErrors.push({ kind: 'pageerror', message: redact(error.message) }));
  const login = new URL(environment.KODETY_E2E_LOGIN_URL || wp('eval', 'echo wp_login_url();'));
  assert.equal(login.origin, site.origin, 'Login must remain on the disposable origin');
  await page.goto(login.href);
  await page.locator('#user_login').fill(environment.KODETY_E2E_USER);
  await page.locator('#user_pass').fill(environment.KODETY_E2E_PASSWORD);
  await page.locator('#wp-submit').click();
  await page.waitForURL(url => url.origin === site.origin && url.pathname.startsWith('/wp-admin/'));
  const layouts = {};
  for (const locale of ['pt-BR', 'en']) {
    // Explicit Kodety locale overrides the WordPress/user locale; leave both intact.
    wp('option', 'update', 'kodety_admin_ui_locale', locale);
    const copy = labels[locale];
    layouts[locale] = {};
    await step(`${locale}: Design renders translated navigation`, async () => {
      await page.goto(`${site.origin}/kodety/editor/`);
      await localeReady(page, locale);
      await expect(page.locator('[data-editor-corner-menu-trigger]')).toBeVisible({ timeout: 90_000 });
      const canvas = page.locator('iframe[title="Canvas persistente da página HTML"]:not([inert]):not([aria-hidden="true"]), iframe[title="Persistent HTML page canvas"]:not([inert]):not([aria-hidden="true"]), [data-infinite-canvas-active-iframe] iframe:not([inert]):not([aria-hidden="true"])')
        .filter({ visible: true }).first();
      await expect(canvas).toBeVisible({ timeout: 90_000 });
      // The visible authored document is observed only; none of its controls or text are edited.
      await expect(page.locator('[data-html-buffered-iframe-load-error]:visible')).toHaveCount(0);
      await expect(page.locator('[data-html-buffered-iframe-paint-shield]:visible')).toHaveCount(0, { timeout: 90_000 });
      const settings = page.getByRole('link', { name: copy.settings, exact: true });
      await expect(settings).toBeVisible();
      const inspector = page.locator('[data-ycode-html-inspector]');
      await expect(inspector.getByRole('tab', { name: copy.style, exact: true })).toBeVisible();
      const heroLabel = page.locator('[data-layer-name-source]').filter({ hasText: /^Hero$/ });
      const heroRow = page.locator('[data-layer-path]').filter({ has: heroLabel });
      await expect(heroRow).toHaveCount(1);
      await heroRow.click();
      await expect(heroRow).toHaveAttribute('aria-selected', 'true');
      await expect(heroLabel).toHaveText('Hero');
      await expect(inspector.locator('[data-html-inspector-selection-context]').getByText('#hero', { exact: true })).toBeVisible();
      const styleTab = inspector.getByRole('tab', { name: copy.style, exact: true });
      const settingsTab = inspector.getByRole('tab', { name: copy.settings, exact: true });
      const interactionsTab = inspector.getByRole('tab', { name: copy.interactions, exact: true });
      await expect(styleTab).toBeVisible();
      await expect(settingsTab).toBeVisible();
      await expect(interactionsTab).toBeVisible();
      await expect(inspector.getByText(`${copy.editing} .hero`, { exact: true })).toBeVisible();
      const inspectorFieldLabels = [copy.justify, copy.wrap, copy.sizing]
        .map(label => inspector.getByText(label, { exact: true }).filter({ visible: true }).first());
      for (const label of inspectorFieldLabels) await expect(label).toBeVisible();
      await expect(canvas.contentFrame().locator('#hero [data-kst-text="title"]')).toHaveText('Stability fixture title');
      const bridge = await bridgeContext(page, 'design');
      layouts[locale].design = await layoutAndScreenshot(page, locale, 'design', [settings, styleTab, settingsTab, interactionsTab, ...inspectorFieldLabels]);
      return { bridge, inspectorTranslated: true, authoredLabelPreserved: 'Hero', authoredIdPreserved: '#hero', authoredTitlePreserved: true, layout: layouts[locale].design };
    });
    await step(`${locale}: Design to CMS preserves the native Agent dock`, async () => {
      await page.getByRole('link', { name: 'CMS', exact: true }).click();
      await page.waitForURL('**/kodety/cms/**');
      await localeReady(page, locale);
      await expect(page.locator('[data-kodety-cms-manager]')).toBeVisible();
      await expect(page.locator('[data-workspace-agent-dock]')).toBeVisible();
      const collections = page.getByRole('tab', { name: copy.collections, exact: true });
      const fields = page.getByRole('tab', { name: copy.fields, exact: true });
      await expect(collections).toBeVisible();
      await expect(fields).toBeVisible();
      const builtinHeaders = [copy.published, copy.alt, copy.updated]
        .map(label => page.locator('[data-cms-items-grid] thead').getByText(label, { exact: true }));
      for (const header of builtinHeaders) await expect(header).toBeVisible();
      const bridge = await bridgeContext(page, 'cms');
      const native = await nativeRead(page);
      layouts[locale].cms = await layoutAndScreenshot(page, locale, 'cms', [collections, fields, ...builtinHeaders]);
      return { bridge, native, builtinHeaders: [copy.published, copy.alt, copy.updated], layout: layouts[locale].cms };
    });
    await step(`${locale}: CMS to Design to Settings renders translated settings`, async () => {
      await page.getByRole('button', { name: 'Design', exact: true }).click();
      await page.waitForURL('**/kodety/editor/**');
      await page.getByRole('link', { name: copy.settings, exact: true }).click();
      await page.waitForURL('**/kodety/settings/**');
      await localeReady(page, locale);
      await expect(page.locator('[data-kodety-light-workspace="settings"]')).toBeVisible();
      await expect(page.locator('[data-kodety-project-settings]')).toBeVisible();
      const siteLabel = page.locator('[data-kodety-project-settings] aside').getByText(copy.site, { exact: true });
      await expect(siteLabel).toBeVisible();
      const settingsRoot = page.locator('[data-kodety-project-settings]');
      const general = settingsRoot.getByRole('heading', { name: copy.general, exact: true });
      const generalNav = settingsRoot.locator('aside').getByRole('button', { name: copy.general, exact: true });
      const redirects = settingsRoot.locator('aside').getByRole('button', { name: copy.redirects, exact: true });
      const cookies = settingsRoot.locator('aside').getByRole('button', { name: copy.cookies, exact: true });
      const breadcrumb = settingsRoot.locator('fieldset header').getByText(`${copy.site} · Kodety Stability Fixture`, { exact: true });
      for (const label of [general, generalNav, redirects, cookies, breadcrumb]) await expect(label).toBeVisible();
      await expect(settingsRoot.locator('fieldset header [data-kodety-no-i18n]')).toHaveText('Kodety Stability Fixture');
      const bridge = await bridgeContext(page, 'settings');
      layouts[locale].settings = await layoutAndScreenshot(page, locale, 'settings', [siteLabel, general, generalNav, redirects, cookies, breadcrumb]);
      return { bridge, projectNamePreserved: true, breadcrumbTranslated: true, layout: layouts[locale].settings };
    });
  }
  await step('PT and EN keep the same CMS chrome dimensions', async () => {
    assert.equal(layouts['pt-BR'].cms.topbarHeight, layouts.en.cms.topbarHeight);
    assert.equal(layouts['pt-BR'].cms.dockWidth, layouts.en.cms.dockWidth);
    assert.ok(layouts.en.cms.dockWidth >= 40, 'The native Agent rail must remain usable');
    assert.equal(report.browserErrors.length, 0, 'No uncaught browser runtime errors are expected');
    return { topbarHeight: layouts.en.cms.topbarHeight, agentDockWidth: layouts.en.cms.dockWidth };
  });
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.error = redact(error.message);
  if (report.candidate && activePage && !activePage.isClosed()) {
    try {
      const url = new URL(activePage.url());
      if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/kodety/')) {
        await activePage.screenshot({ path: path.join(outputPath, 'failure.png'), fullPage: false, timeout: 10_000 });
        report.screenshots.push('failure.png');
        report.failureState = await activePage.evaluate(() => ({
          path: location.pathname, locale: window.kodetyAdminI18n?.locale,
          documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth,
          agentDockPresent: Boolean(document.querySelector('[data-workspace-agent-dock]')),
          bridgeAvailable: window.__kodetyHtmlAgentEditorBridgeRuntimeV1?.store?.getState().available === true,
          settingsPresent: Boolean(document.querySelector('[data-kodety-project-settings]')),
          cmsPresent: Boolean(document.querySelector('[data-kodety-cms-manager]')),
        }));
      }
    } catch { report.failureCaptureUnavailable = true; }
  }
} finally {
  try { await browser?.close(); } catch (error) { failure ||= error; report.status = 'failed'; }
  if (localeSnapshot) {
    try {
      const encoded = Buffer.from(JSON.stringify(localeSnapshot)).toString('base64');
      wp('eval', `$s=json_decode(base64_decode('${encoded}'),true); if($s['optionExists']) update_option('kodety_admin_ui_locale',$s['option']); else delete_option('kodety_admin_ui_locale'); if($s['userExists']) update_user_meta(${userId},'locale',$s['user']); else delete_user_meta(${userId},'locale');`);
      const restored = JSON.parse(wp('eval', `echo wp_json_encode(['optionExists'=>get_option('kodety_admin_ui_locale',null)!==null,'option'=>get_option('kodety_admin_ui_locale',null),'userExists'=>metadata_exists('user',${userId},'locale'),'user'=>get_user_meta(${userId},'locale',true)]);`));
      assert.deepEqual(restored, localeSnapshot);
      report.localesRestored = true;
    } catch (error) {
      failure ||= error;
      report.status = 'failed';
      report.localesRestored = false;
      report.cleanupError = redact(error.message);
    }
  }
  report.finishedAt = new Date().toISOString();
  // A rejected environment may not have passed the output-directory guard.
  if (report.candidate) await writeFile(path.join(outputPath, 'agent-i18n-installed.json'), JSON.stringify(report, null, 2));
}
if (failure) {
  console.error(`Installed Agent/i18n smoke failed: ${redact(failure.message)}`);
  process.exitCode = 1;
} else console.log('Installed Agent/i18n smoke passed; locale preferences restored.');
