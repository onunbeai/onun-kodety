import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import JSZip from 'jszip';

// Deliberately requires a separately prepared disposable WordPress. This runner
// never reads production credentials or writes to the source checkout's site.
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const environmentFile = argument('--environment') || process.env.KODETY_STABILITY_ENV;
assert.ok(environmentFile, 'Pass --environment pointing to an external test-environment.json');
const environment = JSON.parse(await readFile(environmentFile, 'utf8'));
const wpRoot = environment.KODETY_STABILITY_WP_ROOT;
const site = new URL(environment.KODETY_E2E_BASE_URL);
assert.ok(path.basename(wpRoot || '').startsWith('kodety-stability-wp-'), 'Only a disposable stability installation is supported');
assert.equal(site.hostname, '127.0.0.1', 'Only loopback staging is supported');
const environmentRelativePath = path.relative(path.resolve(wpRoot), path.resolve(environmentFile));
assert.ok(environmentRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(environmentRelativePath), 'Credentials must remain outside the served WordPress directory');
const wp = (...command) => execFileSync('wp', [`--path=${wpRoot}`, ...command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert.equal(wp('option', 'get', 'home'), site.origin);
assert.match(wp('config', 'get', 'DB_NAME'), /^kodety_stability_/);
const reportDirectory = argument('--output') || path.join(path.dirname(path.resolve(environmentFile)), 'stability-results');
await mkdir(reportDirectory, { recursive: true });
const report = { startedAt: new Date().toISOString(), wordpress: wp('core', 'version'), origin: site.origin, fixture: 'small', host: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30) }, steps: [], selection: null, errors: [] };
const pluginZip = argument('--plugin-zip');
if (pluginZip) {
  const expectedHash = argument('--expected-sha256');
  assert.match(expectedHash, /^[a-f0-9]{64}$/);
  const actualHash = createHash('sha256').update(await readFile(pluginZip)).digest('hex');
  assert.equal(actualHash, expectedHash, 'Install only the exact candidate the caller identified');
  wp('plugin', 'install', path.resolve(pluginZip), '--force', '--activate');
  report.candidate = { zip: path.basename(pluginZip), sha256: actualHash };
}
if (!args.includes('--keep-fixture')) wp('--user=1', 'eval-file', fileURLToPath(new URL('./fixtures/stability-stage-project.php', import.meta.url)));
wp('user', 'meta', 'update', environment.KODETY_E2E_USER, 'locale', 'pt_BR');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript(() => {
  // Design intentionally suspends authored animation callbacks. Capture the
  // browser primitives before the preview wraps them, solely for observation.
  window.__kstNativeRaf = window.requestAnimationFrame.bind(window);
  window.__kstNativeNow = performance.now.bind(performance);
  window.__kstNativeTimeOrigin = performance.timeOrigin;
});
const page = await context.newPage();
let authenticated = false;
page.setDefaultTimeout(30_000);
const observedErrors = [];
let editorLeaseMode = '';
page.on('framenavigated', frame => { if (frame === page.mainFrame()) editorLeaseMode = ''; });
page.on('response', async response => {
  if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/wp-json/kodety/v1/editor-lock' || !response.ok()) return;
  const result = await response.json().catch(() => null);
  if (result?.mode) editorLeaseMode = result.mode;
});
let injectingNetworkLoss = false;
const redact = message => String(message).split(environment.KODETY_E2E_PASSWORD).join('[REDACTED]');
page.on('pageerror', error => observedErrors.push({ kind: 'pageerror', message: redact(error.message), faultInjection: injectingNetworkLoss }));
page.on('console', message => { if (message.type() === 'error') observedErrors.push({ kind: 'console', message: redact(message.text()).replace(/https?:\/\/\S+/g, '[url]'), faultInjection: injectingNetworkLoss }); });
const step = async (name, action) => {
  const startedAt = new Date().toISOString();
  console.log(`RUN ${name}`);
  try {
    const detail = await action();
    report.steps.push({ name, startedAt, status: 'passed', ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.steps.push({ name, startedAt, status: 'failed', message: redact(error.message) });
    throw error;
  }
};
const activeIframeSelector = 'iframe[title="Canvas persistente da página HTML"]:not([inert]):not([aria-hidden="true"]), [data-infinite-canvas-active-iframe] iframe:not([inert]):not([aria-hidden="true"]), iframe[title$="— editável"]:not([inert]):not([aria-hidden="true"])';
const activeIframe = () => page.locator(activeIframeSelector).filter({ visible: true }).first();
const frameLocator = () => activeIframe().contentFrame();
async function ready() {
  await expect.poll(() => editorLeaseMode, { timeout: 45_000, message: 'Wait for the native collaboration lease before editing' }).toBe('edit');
  await expect(page.locator('[data-editor-corner-menu-trigger]')).toBeVisible({ timeout: 90_000 });
  await expect(activeIframe()).toBeVisible({ timeout: 90_000 });
  // A valid empty main has zero height; document readiness is independent of
  // authored layout size. The active frame and paint shield prove visibility.
  await expect(frameLocator().locator('main')).toBeAttached({ timeout: 90_000 });
  await expect(page.getByText('Carregando projeto', { exact: true })).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('[data-html-buffered-iframe-paint-shield]:visible')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('[data-html-buffered-iframe-load-error]:visible')).toHaveCount(0);
  await stabilizeCanvas();
}
async function stabilizeCanvas() {
  await page.waitForFunction(selector => {
      const element = Array.from(document.querySelectorAll(selector)).find(node => node.getBoundingClientRect().width > 0);
      if (!element) return false;
      const now = window.__kstNativeNow();
      if (window.__kstStableIframe?.element !== element) window.__kstStableIframe = { element, since: now };
      return now - window.__kstStableIframe.since >= 750;
    }, activeIframeSelector, { polling: 25, timeout: 30_000 });
}
async function menuAction(name) {
  await stabilizeCanvas();
  const trigger = page.locator('[data-editor-corner-menu-trigger]');
  if (await trigger.getAttribute('data-state') !== 'open') await trigger.click();
  await page.getByRole('menuitem', { name }).click();
  await expect(trigger).toHaveAttribute('data-state', 'closed');
}
async function save() {
  const revision = Number(wp('option', 'get', 'kodety_workspace_revision'));
  const ack = page.waitForResponse(async response => {
    if (response.request().method() !== 'POST' || !response.ok()) return false;
    if (!/\/kodety\/v1\/project(?:\/delta|\/chunk)?\/?$/.test(new URL(response.url()).pathname)) return false;
    const result = await response.json().catch(() => null);
    return result?.success === true && result.workspaceRevision > revision;
  }, { timeout: 90_000 });
  await menuAction(/Salvar agora|Save now/i);
  await ack;
  return Number(wp('option', 'get', 'kodety_workspace_revision'));
}
async function selectLayer(selector) {
  const layerPath = await frameLocator().locator(selector).getAttribute('data-html-editor-path');
  assert.ok(layerPath, `Missing editor identity for ${selector}`);
  const row = page.locator(`[data-layer-path="${layerPath}"]`);
  if (await row.count() === 0) {
    await frameLocator().locator(selector).click({ position: { x: 12, y: 12 } });
  } else await row.click();
  await expect(frameLocator().locator(selector)).toHaveAttribute('data-html-editor-selected', '');
}
const percentile = (values, percentile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.ceil(sorted.length * percentile / 100) - 1] * 100) / 100 : null;
};
async function measureSelection(sessionCount = 5, sampleCount = 100, mode = 'conventional') {
  const sessions = [];
  for (let session = 0; session < sessionCount; session++) {
    if (session) { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
    if (mode === 'infinite') {
      await page.getByRole('button', { name: /^(Ativar Canvas Infinito Beta instável|Enable unstable Infinite Canvas Beta)$/ }).click();
      await expect(page.locator('[data-infinite-canvas]')).toBeVisible();
      await ready();
    }
    await page.evaluate(() => {
      const now = () => window.__kstNativeTimeOrigin + window.__kstNativeNow();
      window.__kstSelectionMessages = [];
      if (window.__kstSelectionListener) window.removeEventListener('message', window.__kstSelectionListener);
      window.__kstSelectionListener = event => {
        if (event.data?.type !== 'html-editor-selection' || event.data.origin !== 'canvas') return;
        window.__kstSelectionMessages.push({
          path: event.data.payload?.path, detail: event.data.detail,
          sequence: event.data.selectionSequence, at: now(),
        });
      };
      window.addEventListener('message', window.__kstSelectionListener);
    });
    await stabilizeCanvas();
    const iframe = await activeIframe().elementHandle();
    const frame = await iframe.contentFrame();
    await frame.evaluate(() => {
      const now = () => window.__kstNativeTimeOrigin + window.__kstNativeNow();
      window.__kstSelectionMetrics = [];
      window.addEventListener('click', event => {
        const element = event.target.closest?.('[data-html-editor-path]');
        if (!element?.matches('#hero h1, #hero > p')) return;
        window.__kstSelectionMetrics.push({ path: element.dataset.htmlEditorPath, started: now(), trusted: event.isTrusted });
      }, true);
      new MutationObserver(() => {
        const record = window.__kstSelectionMetrics.at(-1);
        if (!record || record.highlight !== undefined) return;
        const element = document.querySelector(`[data-html-editor-path="${CSS.escape(record.path)}"]`);
        if (!element?.hasAttribute('data-html-editor-selected')) return;
        record.highlight = now() - record.started;
        window.__kstNativeRaf(() => window.__kstNativeRaf(() => { record.afterPaint = now() - record.started; }));
      }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-html-editor-selected'] });
    });
    // Alternate targets so every click changes selection. Five warmups are
    // recorded and excluded explicitly; missing samples fail the measurement.
    const measured = [];
    for (let index = 0; index < sampleCount + 5; index++) {
      await frame.locator(index % 2 ? '#hero > p' : '#hero h1').click();
      // Design pauses iframe timers as well as authored RAF. Poll through
      // Playwright; measured timestamps remain the untouched native iframe clock.
      await expect.poll(() => frame.evaluate(expected => {
        const metrics = window.__kstSelectionMetrics;
        return metrics.length === expected && Number.isFinite(metrics.at(-1)?.afterPaint);
      }, index + 1), { timeout: 10_000, intervals: [10] }).toBe(true).catch(async error => {
        const state = await frame.evaluate(() => ({ records: window.__kstSelectionMetrics, selected: Array.from(document.querySelectorAll('[data-html-editor-selected]')).map(element => ({ tag: element.tagName, path: element.dataset.htmlEditorPath })), targets: Array.from(document.querySelectorAll('#hero h1, #hero > p')).map(element => ({ tag: element.tagName, path: element.dataset.htmlEditorPath })) })).catch(() => ({ detached: frame.isDetached() }));
        throw new Error(`${error.message}; session=${session} sample=${index} state=${JSON.stringify(state)}`);
      });
      const record = await frame.evaluate(() => window.__kstSelectionMetrics.at(-1)).catch(error => { throw new Error(`${mode} session=${session + 1} sample=${index}: ${error.message}`); });
      const confirmation = await page.waitForFunction(({ path, started }) => {
        const messages = window.__kstSelectionMessages;
        const identity = messages.find(message => message.detail === 'identity' && message.path === path && message.at >= started);
        if (!identity) return null;
        const computed = messages.find(message => message.detail === 'computed' && message.path === path && message.sequence === identity.sequence && message.at >= identity.at);
        return computed ? { identity: identity.at - started, computed: computed.at - started, sequence: identity.sequence } : null;
      }, record, { timeout: 10_000, polling: 10 });
      measured.push({ ...record, ...await confirmation.jsonValue() });
      await confirmation.dispose();
    }
    const records = measured.slice(5);
    assert.equal(records.length, sampleCount);
    assert.ok(records.every(record => record.trusted));
    const distributions = Object.fromEntries(['highlight', 'identity', 'afterPaint', 'computed'].map(metric => [metric, { p50: percentile(records.map(record => record[metric]), 50), p95: percentile(records.map(record => record[metric]), 95), p99: percentile(records.map(record => record[metric]), 99) }]));
    sessions.push({ session: session + 1, samples: sampleCount, warmups: 5, distributions, records });
    await writeFile(path.join(reportDirectory, `selection-${mode}-sessions.json`), JSON.stringify({ candidate: report.candidate, mode, sessions }, null, 2));
    console.log(`PASS ${mode} selection measurement session ${session + 1}/${sessionCount}`);
  }
  const records = sessions.flatMap(session => session.records);
  const aggregate = Object.fromEntries(['highlight', 'identity', 'afterPaint', 'computed'].map(metric => [metric, { p50: percentile(records.map(record => record[metric]), 50), p95: percentile(records.map(record => record[metric]), 95), p99: percentile(records.map(record => record[metric]), 99) }]));
  return { sessions, aggregate, environment: { browser: browser.version(), viewport: '1600x1000', mode, fixture: 'small', timing: 'iframe trusted click capture → selection MutationObserver → double requestAnimationFrame; parent identity/computed messages use timeOrigin+performance.now', sessions: `${sessionCount} consecutive document loads in one authenticated browser context; no shell timing`, limitation: 'Double requestAnimationFrame bounds the next rendering opportunity; no compositor presentation timestamp. No large or legacy fixture and no prolonged-use certification.' } };
}
try {
  await step('login and open isolated fixture', async () => {
    const loginUrl = new URL(environment.KODETY_E2E_LOGIN_URL || wp('eval', 'echo wp_login_url();'), site);
    assert.equal(loginUrl.origin, site.origin);
    await page.goto(loginUrl.href);
    let fieldsReady = false;
    for (let attempt = 0; attempt < 3 && !fieldsReady; attempt++) {
      await page.locator('#user_login').fill(environment.KODETY_E2E_USER);
      await page.locator('#user_pass').fill(environment.KODETY_E2E_PASSWORD);
      fieldsReady = await page.locator('#user_login').inputValue() === environment.KODETY_E2E_USER && await page.locator('#user_pass').inputValue() === environment.KODETY_E2E_PASSWORD;
    }
    assert.ok(fieldsReady, 'Login fields must remain stable before submission');
    await page.locator('#wp-submit').click();
    await page.waitForURL('**/wp-admin/**', { waitUntil: 'domcontentloaded' });
    authenticated = true;
    await page.goto(new URL('/kodety/editor/', site).href, { waitUntil: 'domcontentloaded' });
    await ready();
    await expect(frameLocator().locator('#hero h1')).toHaveText('Stability fixture title');
    return { projectId: wp('option', 'get', 'kodety_workspace_project_id') };
  });
  if (!args.includes('--skip-selection-measurement')) {
    const selectionSessions = Number(argument('--measurement-sessions') || 5);
    const selectionSamples = Number(argument('--measurement-samples') || 100);
    assert.ok(Number.isSafeInteger(selectionSessions) && selectionSessions >= 1 && selectionSessions <= 20);
    assert.ok(Number.isSafeInteger(selectionSamples) && selectionSamples >= 1 && selectionSamples <= 1000);
    await step('selection latency, 100 trusted clicks across each of five document sessions', async () => {
      const conventional = await measureSelection(selectionSessions, selectionSamples);
      report.selection = { conventional };
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      const infinite = await measureSelection(selectionSessions, selectionSamples, 'infinite');
      await page.getByRole('button', { name: /^(Desativar canvas infinito|Disable infinite canvas)$/ }).click();
      await ready();
      report.selection = { conventional, infinite };
      return { sessionsPerMode: selectionSessions, measuredActionsPerMode: selectionSessions * selectionSamples, measuredActions: selectionSessions * selectionSamples * 2 };
    });
  }
  if (!args.includes('--only-selection')) {
  const marker = `Stability saved ${Date.now()}`;
  if (!args.includes('--only-create')) {
  await step('edit text through inline canvas and save', async () => {
    const target = frameLocator().locator('#hero h1');
    await target.dblclick();
    const editor = frameLocator().locator('[data-html-editor-editing]');
    await expect(editor).toBeVisible();
    await editor.press('ControlOrMeta+A');
    await editor.pressSequentially(marker);
    await editor.press('Enter');
    await expect(frameLocator().locator('#hero h1')).toHaveText(marker);
    return { revision: await save() };
  });
  await step('change text color through Inspector and save', async () => {
    await selectLayer('#hero h1');
    const swatch = page.locator('[data-design-token-section="Typography"]').getByText('Color', { exact: true }).locator('..').locator('[aria-haspopup="dialog"]');
    await swatch.click();
    const hex = page.locator('[role="dialog"] input[type="text"]').filter({ visible: true }).first();
    await hex.fill('#d43f8d');
    await hex.press('Enter');
    report.colorPopover = await page.evaluate(() => {
      const close = document.querySelector('[aria-label="Fechar seletor de cor"]');
      const describe = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { tag: element.tagName, class: element.className, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, zIndex: style.zIndex, position: style.position, transform: style.transform }; };
      const rect = close.getBoundingClientRect();
      return { close: describe(close), ancestors: Array.from((function* () { let node = close.parentElement; while (node) { yield node; node = node.parentElement; } })()).map(describe), topbar: describe(document.querySelector('.kodety-editor-topbar')), hitStack: document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).map(describe) };
    });
    await writeFile(path.join(reportDirectory, 'color-popover.json'), JSON.stringify(report.colorPopover, null, 2));
    await page.getByRole('button', { name: 'Fechar seletor de cor' }).click();
    await expect(page.getByRole('button', { name: 'Fechar seletor de cor' })).toHaveCount(0);
    await expect.poll(() => frameLocator().locator('#hero h1').evaluate(element => getComputedStyle(element).color)).toBe('rgb(212, 63, 141)');
    return { revision: await save() };
  });
  await step('reopen saved text and color', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await expect(frameLocator().locator('#hero h1')).toHaveText(marker);
    await expect.poll(() => frameLocator().locator('#hero h1').evaluate(element => getComputedStyle(element).color)).toBe('rgb(212, 63, 141)');
  });
  await step('delete sections, undo, redo and retain an empty main', async () => {
    await selectLayer('#hero');
    await page.keyboard.press('Delete');
    await expect(frameLocator().locator('#hero')).toHaveCount(0);
    await menuAction(/Desfazer|Undo/i);
    await expect(frameLocator().locator('#hero h1')).toHaveText(marker);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect(frameLocator().locator('#hero')).toHaveCount(0);
    await selectLayer('main > section.card');
    await page.keyboard.press('Delete');
    await expect(frameLocator().locator('main > *')).toHaveCount(0);
    return { revision: await save() };
  });
  await step('reopen intentionally empty document', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await expect(frameLocator().locator('main > *')).toHaveCount(0);
    await expect(frameLocator().locator('#hero')).toHaveCount(0);
  });
  }
  await step('logo Create new survives lost ZIP ACK and local quota failure', async () => {
    injectingNetworkLoss = true;
    page.on('response', async response => {
      if (!response.url().includes('_kodety_replacement_receipt')) return;
      await writeFile(path.join(reportDirectory, 'replacement-receipt.zip'), await response.body());
      await writeFile(path.join(reportDirectory, 'replacement-receipt-headers.json'), JSON.stringify(Object.fromEntries(Object.entries(response.headers()).filter(([key]) => /^(content-type|x-kodety-(workspace-revision|template-digest|css-digest|received-project-digest|received-project-id))$/.test(key))), null, 2));
    });
    const previousProjectId = wp('option', 'get', 'kodety_workspace_project_id');
    let lostAck = false;
    const projectRoute = /\/wp-json\/kodety\/v1\/project(?:\?.*)?$/;
    await page.route(projectRoute, async route => {
      const request = route.request();
      if (lostAck || request.method() !== 'POST' || !request.headers()['content-type']?.includes('application/zip')) return route.continue();
      await writeFile(path.join(reportDirectory, 'replacement-upload.zip'), request.postDataBuffer());
      const committed = await route.fetch();
      await writeFile(path.join(reportDirectory, 'replacement-ack.json'), JSON.stringify(await committed.json(), null, 2));
      assert.equal(committed.ok(), true, 'The injected network loss must occur after a successful server commit');
      lostAck = true;
      await route.abort('failed');
    });
    await page.evaluate(previousId => {
      window.__kstInjectedQuotaFailures = 0;
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (value?.project && value.projectId && value.projectId !== previousId) {
          window.__kstInjectedQuotaFailures++;
          throw new DOMException('Injected local quota exhaustion', 'QuotaExceededError');
        }
        return original.call(this, value, key);
      };
    }, previousProjectId);
    await menuAction(/Criar novo projeto|Create new project/i);
    const confirmation = page.getByRole('button', { name: 'Descartar e criar novo', exact: true });
    await confirmation.click();
    await expect.poll(() => lostAck, { timeout: 90_000, message: 'Observe actual committed ZIP before waiting for replacement UI' }).toBe(true);
    await expect(confirmation).toHaveCount(0, { timeout: 90_000 });
    await ready();
    assert.equal(lostAck, true, 'The ZIP response-loss injection must actually run');
    const newProjectId = wp('option', 'get', 'kodety_workspace_project_id');
    assert.notEqual(newProjectId, previousProjectId);
    await expect(frameLocator().locator('main > *')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__kstInjectedQuotaFailures), { timeout: 10_000 }).toBeGreaterThan(0);
    const quotaFailures = await page.evaluate(() => window.__kstInjectedQuotaFailures);
    await page.unroute(projectRoute);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await expect(frameLocator().locator('main > *')).toHaveCount(0);
    assert.equal(wp('option', 'get', 'kodety_workspace_project_id'), newProjectId, 'The old project must not return after revalidation');
    assert.equal(await page.evaluate(() => window.kodetyWordPress?.projectId || window.kodetyConfig?.projectId || ''), newProjectId, 'The server must expose project identity without Membership');
    const downloadUrl = await page.evaluate(() => window.kodetyWordPress.projectDownloadUrl);
    const download = await context.request.get(downloadUrl);
    assert.equal(download.ok(), true);
    const archive = await JSZip.loadAsync(await download.body());
    assert.equal(archive.file('about.html'), null, 'Discarded pages must not survive in the new remote project');
    assert.equal(JSON.parse(await archive.file('.incode/project.json').async('string')).projectId, newProjectId);
    const html = await archive.file('index.html').async('string');
    assert.doesNotMatch(html, /Stability saved|id=["']hero|Second section/);
    return { previousProjectId, newProjectId, lostZipAcknowledgement: true, injectedIndexedDbQuota: true, quotaFailures, verifiedRemotePaths: Object.keys(archive.files).filter(name => !archive.files[name].dir) };
  });
  }
  report.errors = observedErrors.filter(error => !(error.kind === 'console' && error.faultInjection && /ERR_FAILED|Failed to fetch|NetworkError|net::/i.test(error.message)));
  assert.equal(report.errors.length, 0, 'No unexpected console or unhandled browser errors');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = redact(error.message);
  report.errors = observedErrors;
  if (authenticated) await page.screenshot({ path: path.join(reportDirectory, 'failure.png'), fullPage: true }).catch(() => {});
  throw new Error(redact(error.message));
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile(path.join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2));
  await page.goto('about:blank', { waitUntil: 'load' }).catch(() => {});
  await browser.close();
}
