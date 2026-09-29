import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import postcss from 'postcss';
import { chromium, expect } from '@playwright/test';
import { createPerformanceProject } from './fixtures/performance-project.mjs';
import { launchBrowserWithPageZoom } from './fixtures/browser-page-zoom.mjs';
import { createTimelineProject } from './fixtures/timeline-project.mjs';

const argv = process.argv.slice(2);
const arg = key => argv.includes(key) ? argv[argv.indexOf(key) + 1] : '';
const environmentPath = path.resolve(arg('--environment'));
const environment = JSON.parse(await readFile(environmentPath, 'utf8'));
const wpRoot = environment.KODETY_STABILITY_WP_ROOT;
const origin = new URL(environment.KODETY_E2E_BASE_URL).origin;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.ok(path.basename(wpRoot).startsWith('kodety-stability-wp-'));
assert.ok(path.relative(wpRoot, environmentPath).startsWith('..'));
const wp = (...args) => execFileSync('wp', [`--path=${wpRoot}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert.match(wp('config', 'get', 'DB_NAME'), /^kodety_stability_/);
assert.equal(wp('option', 'get', 'home'), origin);
const fixtureName = arg('--fixture') || 'deckdocs';
assert.ok(!arg('--rapid-edits') || !arg('--style-property'), 'Rapid replay verifies both earlier color and gap edits');
const selectionSamples = Number(arg('--selection-samples') || 10);
assert.ok(Number.isInteger(selectionSamples) && selectionSamples >= 0 && selectionSamples <= 1000);
const label = arg('--label') || 'baseline';
const output = path.resolve(arg('--output') || path.join(path.dirname(environmentPath), `performance-${label}-${fixtureName}`));
await mkdir(output, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const packageMetadata = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const defaultArtifact = `Wordpress/dist/${packageMetadata.kodety.wordpressVersion.replaceAll('.', '_')}.zip`;
const pluginZip = path.resolve(arg('--plugin-zip') || defaultArtifact);
const pluginBytes = await readFile(pluginZip);
const candidateHash = sha(pluginBytes);
assert.equal(candidateHash, arg('--expected-sha256'), 'Identify the exact baseline/candidate package');
if (argv.includes('--install')) wp('plugin', 'install', pluginZip, '--force', '--activate');
const pluginArchive = await JSZip.loadAsync(pluginBytes);
const installedVerification = {};
for (const entry of Object.values(pluginArchive.files).filter(entry => !entry.dir && (/\/includes\/class-kodety-plugin\.php$/.test(entry.name) || /\/assets\/assets\/HtmlProjectEditor-[^/]+\.js$/.test(entry.name)))) {
  const expected = sha(await entry.async('nodebuffer'));
  const installed = sha(await readFile(path.join(wpRoot, 'wp-content/plugins', entry.name)));
  assert.equal(installed, expected, `Installed artifact mismatch: ${entry.name}`);
  installedVerification[entry.name] = expected;
}
assert.ok(Object.keys(installedVerification).length >= 2);
let fixture;
if (fixtureName === 'timeline') fixture = await createTimelineProject();
else if (fixtureName === 'deckdocs') {
  const original = path.resolve(arg('--project-zip') || '/Users/matusaelfillipe/Documents/deckdocs-content/deckdocs-cms-ready.zip');
  const bytes = await readFile(original);
  const archive = await JSZip.loadAsync(bytes);
  const entries = Object.values(archive.files).filter(entry => !entry.dir && !entry.name.includes('__MACOSX'));
  const pages = entries.filter(entry => /\.html?$/i.test(entry.name) && !entry.name.startsWith('.incode/'));
  const cssEntries = entries.filter(entry => /\.css$/i.test(entry.name));
  const metadata = JSON.parse(await archive.file('.incode/project.json').async('string'));
  metadata.projectId = 'kst-performance-deckdocs';
  archive.file('.incode/project.json', JSON.stringify(metadata, null, 2));
  const manifest = { profile: 'deckdocs', original, originalSha256: sha(bytes), originalArchiveBytes: bytes.byteLength, files: entries.length, pages: pages.length, pagePaths: pages.map(entry => entry.name), pagesDetail: await Promise.all(pages.map(async entry => { const source = await entry.async('string'); return { path: entry.name, bytes: Buffer.byteLength(source), sourceElements: (source.match(/<[a-z][a-z0-9-]*(?:\s|>)/gi) || []).length }; })), cssFiles: cssEntries.length, cssBytes: (await Promise.all(cssEntries.map(async entry => (await entry.async('nodebuffer')).byteLength))).reduce((sum, bytes) => sum + bytes, 0), modification: 'Only .incode/project.json receives a stable disposable projectId; original files remain untouched.' };
  fixture = { archive: await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' }), manifest };
} else fixture = await createPerformanceProject(fixtureName);
const fixtureArchive = path.join(output, `kodety-performance-${fixtureName}.zip`);
await writeFile(fixtureArchive, fixture.archive, { mode: 0o600 });
await writeFile(path.join(output, 'fixture.json'), JSON.stringify(fixture.manifest, null, 2));
wp('--user=1', 'eval-file', fileURLToPath(new URL('./fixtures/performance-stage-project.php', import.meta.url)), fixtureArchive);
const report = { harnessSha256: sha(await readFile(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), label, candidateSha256: candidateHash, installedVerification, fixture: fixture.manifest, environment: { origin, wordpress: wp('core', 'version'), platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, profiling: !argv.includes('--no-profile'), timingMethod: 'Trusted input capture, native clocks and double requestAnimationFrame, parent panel mutation observers; polling results are upper bounds.', memoryGiB: Math.round(os.totalmem() / 2 ** 30), viewport: { width: 1600, height: 1000 } }, actions: [], errors: [], profiles: [] };
const browserZoom = Number(arg('--browser-zoom') || 1);
assert.ok(browserZoom >= 0.25 && browserZoom <= 3);
const zoomSession = arg('--browser-zoom') ? await launchBrowserWithPageZoom({ viewport: report.environment.viewport, deviceScaleFactor: 2 }) : null;
const browser = zoomSession ? zoomSession.context.browser() : await chromium.launch({ headless: true });
report.environment.browser = browser.version();
report.environment.browserZoom = { factor: browserZoom, method: zoomSession ? 'Real browser page zoom via chrome.tabs.setZoom; emulated base DPR2' : 'Default browser zoom, default DPR' };
const context = zoomSession?.context || await browser.newContext({ viewport: report.environment.viewport });
await context.addInitScript(() => {
  window.__benchClock = { now: performance.now.bind(performance), origin: performance.timeOrigin, raf: requestAnimationFrame.bind(window), timer: setTimeout.bind(window) };
  window.__benchLongTasks = [];
  new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__benchLongTasks.push({ at: performance.timeOrigin + entry.startTime, duration: entry.duration, name: entry.name }); }).observe({ type: 'longtask', buffered: true });
});
if (argv.includes('--diagnose-navigation')) await context.addInitScript(() => {
  const now = () => window.__benchClock.origin + window.__benchClock.now();
  const sourceIds = new WeakMap(); let nextSourceId = 1;
  window.__benchReadySignals = [];
  window.addEventListener('message', event => {
    if (typeof event.data?.type !== 'string' || !/^html-editor-.*ready$/.test(event.data.type)) return;
    const source = [...document.querySelectorAll('iframe')].find(frame => frame.contentWindow === event.source);
    if (source && !sourceIds.has(source)) sourceIds.set(source, nextSourceId++);
    window.__benchReadySignals.push({ at: now(), type: event.data.type, title: source?.title, sourceId: source ? sourceIds.get(source) : null, sourceState: source ? { inert: source.inert, ariaHidden: source.getAttribute('aria-hidden'), opacity: getComputedStyle(source).opacity, documentTitle: source.srcdoc.match(/<title[^>]*>([^<]*)/i)?.[1] } : null, timedOut: event.data.timedOut, timeoutReasons: event.data.timeoutReasons, revision: event.data.revision });
  });
  window.__benchAssetSnapshots = [];
  const snapshot = phase => {
    const assetPath = value => { try { const url = new URL(value, location.href); return url.protocol === 'blob:' ? 'blob:' : url.pathname; } catch { return String(value).slice(0, 120); } };
    window.__benchAssetSnapshots.push({ at: now(), phase, readyState: document.readyState, fontStatus: document.fonts?.status, fonts: [...(document.fonts || [])].map(font => ({ family: font.family, status: font.status })), stylesheets: [...document.querySelectorAll('link[rel~="stylesheet"]')].map(link => ({ path: assetPath(link.href), media: link.media, sheet: Boolean(link.sheet), state: link.getAttribute('data-html-editor-font-state') || link.getAttribute('data-html-editor-google-font-state') })), pendingVisibleImages: [...document.images].filter(image => { const rect = image.getBoundingClientRect(); const style = getComputedStyle(image); return !image.complete && rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && style.display !== 'none' && style.visibility !== 'hidden'; }).map(image => ({ path: assetPath(image.currentSrc || image.src), complete: image.complete, naturalWidth: image.naturalWidth })) });
  };
  window.addEventListener('DOMContentLoaded', () => snapshot('dom-content-loaded'), { once: true });
  for (const delay of [500, 2000, 5000, 8000]) window.__benchClock.timer(() => snapshot(`${delay}ms`), delay);
});
const page = await context.newPage();
report.httpErrors = [];
page.on('response', response => {
  if (response.status() < 400) return;
  report.httpErrors.push({ status: response.status(), path: new URL(response.url()).pathname, resourceType: response.request().resourceType() });
});
let authenticated = false;
page.setDefaultTimeout(60_000);
let leaseMode = '';
page.on('framenavigated', frame => { if (frame === page.mainFrame()) leaseMode = ''; });
page.on('response', async response => { if (response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/kodety/v1/editor-lock')) leaseMode = (await response.json().catch(() => ({}))).mode || ''; });
const sourceWrites = [];
page.on('request', request => {
  if (request.method() !== 'POST' || !request.url().includes('/kodety/v1/') || !request.headers()['content-type']?.includes('application/json')) return;
  let body; try { body = request.postDataJSON(); } catch { return; }
  if (Array.isArray(body?.upserts)) sourceWrites.push({ at: Date.now(), request, upserts: body.upserts });
});
const redact = value => String(value).split(environment.KODETY_E2E_PASSWORD).join('[REDACTED]').replace(/([?&](?:_wpnonce|nonce|token)=)[^&\s]+/gi, '$1[REDACTED]');
page.on('pageerror', error => report.errors.push({ kind: 'pageerror', message: redact(error.message) }));
page.on('console', message => { if (message.type() === 'error') report.errors.push({ kind: 'console', message: redact(message.text()).replace(/https?:\/\/\S+/g, '[url]') }); });
const frameSelector = 'iframe[title="Canvas persistente da página HTML"]:not([inert]):not([aria-hidden="true"]),[data-infinite-canvas-active-iframe] iframe:not([inert]):not([aria-hidden="true"]),iframe[title$="— editável"]:not([inert]):not([aria-hidden="true"])';
const iframe = () => page.locator(frameSelector).filter({ visible: true }).first();
const canvas = () => iframe().contentFrame();
async function frameHandle() {
  if (!await iframe().count()) return null;
  const element = await iframe().elementHandle({ timeout: 10_000 }).catch(() => null);
  return element ? element.contentFrame().catch(() => null) : null;
}
async function activeFrameMatches(predicate, value) {
  const frame = await frameHandle();
  if (!frame) return false;
  return frame.evaluate(predicate, value).catch(error => {
    if (/detached|destroyed|closed/i.test(error.message)) return false;
    throw error;
  });
}
async function ready() {
  await expect.poll(() => leaseMode, { timeout: 60_000 }).toBe('edit');
  await expect(iframe()).toBeVisible({ timeout: 180_000 });
  await expect(canvas().locator('main')).toBeAttached({ timeout: 180_000 });
  await expect(page.locator('[data-html-buffered-iframe-paint-shield]:visible')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.locator('[data-html-buffered-iframe-load-error]:visible')).toHaveCount(0);
  await page.waitForFunction(selector => { const node = Array.from(document.querySelectorAll(selector)).find(node => node.getBoundingClientRect().width); const now = window.__benchClock.now(); if (window.__benchStable?.node !== node) window.__benchStable = { node, since: now }; return node && now - window.__benchStable.since > 1200; }, frameSelector, { polling: 25, timeout: 60_000 });
}
async function persistReport() { await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
async function installObservers() {
  await page.evaluate(selector => {
    if (window.__benchParentObserversInstalled) return;
    window.__benchParentObserversInstalled = true;
    const now = () => window.__benchClock.origin + window.__benchClock.now();
    window.__benchMessages = [];
    window.__benchUi = [];
    window.__benchParentActions = [];
    window.__benchPaintAudit = [];
    const ids = new WeakMap(); let nextId = 1; let previousAudit = '';
    const audit = () => {
      const frames = [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().width > 0);
      const active = frames[0]; if (active && !ids.has(active)) ids.set(active, nextId++);
      const visualFrames = [...document.querySelectorAll('iframe[title="Canvas persistente da página HTML"], [data-infinite-canvas-active-iframe] iframe, iframe[title$="— editável"]')].filter(node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) >= 0.9; }).map(node => { if (!ids.has(node)) ids.set(node, nextId++); return { frame: ids.get(node), interactive: !node.inert && node.getAttribute('aria-hidden') !== 'true' }; });
      const state = { frame: active ? ids.get(active) : null, frames: frames.length, visualFrames, shield: Boolean(document.querySelector('[data-html-buffered-iframe-paint-shield]')), error: Boolean(document.querySelector('[data-html-buffered-iframe-load-error]')), opacity: active ? getComputedStyle(active).opacity : null };
      const fingerprint = JSON.stringify(state);
      if (fingerprint !== previousAudit) { window.__benchPaintAudit.push({ at: now(), ...state }); previousAudit = fingerprint; }
      // Controlled Settings inputs can change their DOM value without an
      // attribute mutation. Check the pending selection on the paint clock too.
      if (window.__benchPendingUi && !window.__benchPendingUi.scheduled) inspect();
      window.__benchClock.raf(audit);
    };
    window.__benchClock.raf(audit);

    window.addEventListener('message', event => {
      if (event.data?.type === '__kst-benchmark-trusted-input') {
        const action = window.__benchArmedAction;
        if (action && !action.started && event.source === action.beforeFrame?.contentWindow && event.data.kind === action.kind && event.data.eventType === action.eventType && event.data.trusted === true) {
          action.started = event.data.at; action.trusted = true; action.inputSurface = 'iframe'; inspect();
        }
        return;
      }
      if (event.data?.type !== 'html-editor-selection' || event.data.origin !== 'canvas') return;
      const message = { at: now(), sequence: event.data.selectionSequence, detail: event.data.detail, path: event.data.payload?.path, id: event.data.payload?.id || '', tag: event.data.payload?.tag, classes: event.data.payload?.classes || [], text: event.data.payload?.text, href: event.data.payload?.attributes?.href };
      window.__benchMessages.push(message);
      if (message.detail === 'identity') { window.__benchPendingUi = { ...message }; inspect(); }
    });
    function inspect() {
      const record = window.__benchPendingUi;
      if (record && !record.scheduled) {
        const context = document.querySelector('[data-html-inspector-selection-context]');
        const fingerprint = (context?.textContent || '').replace(/\s+/g, ' ');
        const target = record.id ? '#' + record.id : record.classes[0] || record.tag;
        const renderedTag = context?.firstElementChild?.firstElementChild?.textContent?.trim();
        const panel = document.querySelector('[data-ycode-inspector-tabs] [role="tab"][aria-selected="true"]')?.textContent?.trim();
        if (record.inspectorAt === undefined && panel === 'Style' && context?.getBoundingClientRect().height && renderedTag === record.tag && fingerprint.includes(target)) {
          record.inspectorAt = now(); record.panel = panel;
          record.inspectorProof = { tagMatches: true, targetMatches: true };
        }
        if (record.inspectorAt === undefined && panel === 'Settings') {
          const settings = document.querySelector('[data-html-inspector-settings-scroll][data-state="active"]');
          const tag = settings?.querySelector('[data-html-settings-control][data-field-kind="tag"][aria-label="Tag"]');
          const id = settings?.querySelector('input[aria-label="ID"]');
          const content = settings?.querySelector('textarea[aria-label="Content"], input[aria-label="Content"]');
          const url = settings?.querySelector('input[aria-label="URL"]');
          const actualTag = tag?.textContent?.trim().split(/[\s(]/)[0].toLowerCase();
          const tagMatches = actualTag === record.tag;
          const idMatches = Boolean(id && id.value === record.id);
          const textMatches = typeof record.text === 'string' && Boolean(content && content.value === record.text);
          const hrefMatches = record.href === undefined || Boolean(url && url.value === record.href);
          if (settings?.getBoundingClientRect().height && tagMatches && idMatches && textMatches && hrefMatches) {
            record.inspectorAt = now(); record.panel = panel;
            record.inspectorProof = { tagMatches, idMatches, textMatches, ...(record.href !== undefined ? { hrefMatches } : {}) };
          }
        }
        const row = document.querySelector(`[data-layer-path="${CSS.escape(record.path)}"][aria-selected="true"]`);
        if (record.layersAt === undefined && row && row.getBoundingClientRect().height) record.layersAt = now();
        if (record.inspectorAt !== undefined && record.layersAt !== undefined && !record.scheduled) {
          record.scheduled = true;
          window.__benchClock.raf(() => window.__benchClock.raf(() => { record.panelsPaintAt = now(); window.__benchUi.push({ ...record }); }));
        }
      }
      const action = window.__benchArmedAction;
      if (action?.started && !action.promotionAt) {
        const active = Array.from(document.querySelectorAll(selector)).find(node => node.getBoundingClientRect().width);
        if (active && active !== action.beforeFrame) { action.promotionAt = now(); window.__benchClock.raf(() => window.__benchClock.raf(() => { action.canvasPaintAt = now(); })); }
      }
    }
    new MutationObserver(inspect).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'aria-hidden', 'inert', 'title', 'style'] });
    for (const type of ['click', 'keydown', 'input']) window.addEventListener(type, event => { const action = window.__benchArmedAction; if (action?.started && event.isTrusted && type === 'keydown' && event.key === 'Enter' && action.kind.startsWith('style-')) action.enterAt = now(); if (!action || action.started || !event.isTrusted || event.type !== action.eventType) return; action.started = now(); action.trusted = event.isTrusted; }, true);
  }, frameSelector);
  let frame;
  await expect.poll(async () => Boolean(frame = await frameHandle()), { timeout: 60_000, intervals: [25] }).toBe(true);
  await frame.evaluate(() => {
    // Init scripts may run after Design has sealed the public clock. Observe
    // paints with the editor's native scheduler without releasing authored
    // motion or changing the captured performance origin/monotonic clock.
    const nativeClock = window.__KODETY_EDITOR_NATIVE_CLOCK__;
    if (typeof nativeClock?.requestAnimationFrame === 'function') window.__benchClock.raf = nativeClock.requestAnimationFrame;
    if (typeof nativeClock?.setTimeout === 'function') window.__benchClock.timer = nativeClock.setTimeout;
    if (window.__benchFrameObserversInstalled) return;
    window.__benchFrameObserversInstalled = true;
    const now = () => window.__benchClock.origin + window.__benchClock.now();
    window.__benchClicks = [];
    window.__benchTimelineControls = [];
    window.addEventListener('message', event => { if (event.data?.type === 'html-editor-interaction-control') window.__benchTimelineControls.push({ action: event.data.action, time: event.data.time, sequence: event.data.__kodetyTimelineSequence }); });
    for (const type of ['click', 'keydown', 'input']) window.addEventListener(type, event => {
      const action = window.__benchArmedInput;
      if (!action || action.started || !event.isTrusted || event.type !== action.eventType) return;
      action.started = now();
      parent.postMessage({ type: '__kst-benchmark-trusted-input', kind: action.kind, eventType: event.type, at: action.started, trusted: true }, '*');
    }, true);
    let styleCheckScheduled = false;
    const scheduleStyleCheck = () => {
      if (!window.__benchStyleCheck || window.__benchStyleCheck.appliedAt || styleCheckScheduled) return;
      styleCheckScheduled = true;
      window.__benchClock.raf(() => {
        styleCheckScheduled = false;
        const check = window.__benchStyleCheck;
        if (!check || check.appliedAt) return;
        const node = document.querySelector(check.selector);
        if (!node || getComputedStyle(node).getPropertyValue(check.property) !== check.expected) return;
        check.appliedAt = now();
        window.__benchClock.raf(() => window.__benchClock.raf(() => { check.paintAt = now(); }));
      });
    };
    window.addEventListener('message', scheduleStyleCheck);
    new MutationObserver(scheduleStyleCheck).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__benchRuntimeMutations = { style: 0, ruleOwnership: 0, total: 0, messages: {} };
    window.addEventListener('message', event => { const type = event.data?.type; if (typeof type === 'string' && type.startsWith('html-editor-')) window.__benchRuntimeMutations.messages[type] = (window.__benchRuntimeMutations.messages[type] || 0) + 1; });
    new MutationObserver(records => { for (const mutation of records) { const counts = window.__benchRuntimeMutations; counts.total++; if (mutation.attributeName === 'style') counts.style++; if (mutation.attributeName?.startsWith('data-html-editor-canvas-rule-property-')) counts.ruleOwnership++; } }).observe(document.documentElement, { subtree: true, attributes: true });

    window.addEventListener('click', event => { const element = event.target.closest?.('[data-html-editor-path]'); if (element) window.__benchClicks.push({ at: now(), trusted: event.isTrusted, path: element.dataset.htmlEditorPath, tag: element.tagName.toLowerCase(), id: element.id, classes: [...element.classList] }); }, true);
    new MutationObserver(() => {
      const record = window.__benchClicks.at(-1);
      if (record && record.highlightAt === undefined) { const clicked = document.querySelector(`[data-html-editor-path="${CSS.escape(record.path)}"]`); const selected = clicked?.closest('[data-html-editor-selected]'); if (selected) { record.selectedPath = selected.dataset.htmlEditorPath; record.selectedId = selected.id; record.highlightAt = now(); window.__benchClock.raf(() => window.__benchClock.raf(() => { record.paintAt = now(); })); } }
      const action = window.__benchStructure;
      if (action && !action.appliedAt) { const node = document.querySelector(action.selector); const matches = action.expectedExists !== undefined ? (action.expectedExists ? Boolean(node) && (action.expectedIndex === undefined || [...node.parentElement.children].indexOf(node) === action.expectedIndex) : !node) : action.kind === 'delete' ? !node : node && [...node.parentElement.children].indexOf(node) !== action.beforeIndex; if (matches) { action.appliedAt = now(); window.__benchClock.raf(() => window.__benchClock.raf(() => { action.paintAt = now(); })); } }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-html-editor-selected'] });
  });
  return frame;
}
function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map(); for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const self = new Map(); const total = new Map();
  for (const [index, id] of (profile.samples || []).entries()) { const ms = (profile.timeDeltas?.[index] || 1000) / 1000; self.set(id, (self.get(id) || 0) + ms); let cursor = id; while (cursor) { total.set(cursor, (total.get(cursor) || 0) + ms); cursor = parents.get(cursor); } }
  const top = values => [...values].map(([id, ms]) => ({ ...nodes.get(id).callFrame, milliseconds: Math.round(ms * 10) / 10 })).filter(node => !['(root)', '(idle)'].includes(node.functionName)).sort((a, b) => b.milliseconds - a.milliseconds).slice(0, 35);
  return { self: top(self), inclusive: top(total) };
}
async function profiled(name, action) {
  if (argv.includes('--no-profile')) return action();
  const sessions = [{ name: 'parent', session: await context.newCDPSession(page) }];
  try { sessions.push({ name: 'iframe', session: await context.newCDPSession(await frameHandle()) }); } catch {}
  const captures = [];
  const screenSession = sessions[0].session;
  if (name !== 'selection') {
    await screenSession.send('Page.enable');
    screenSession.on('Page.screencastFrame', event => { captures.push({ timestamp: event.metadata.timestamp, data: event.data }); void screenSession.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {}); });
    await screenSession.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 1000, maxHeight: 625, everyNthFrame: 3 });
  }
  for (const { session } of sessions) { await session.send('Profiler.enable'); await session.send('Profiler.setSamplingInterval', { interval: 1000 }); await session.send('Profiler.start'); }
  try { return await action(); } finally {
    if (name !== 'selection') {
      await screenSession.send('Page.stopScreencast').catch(() => {});
      const directory = path.join(output, `${name}-frames`); await mkdir(directory, { recursive: true });
      for (const [index, capture] of captures.entries()) await writeFile(path.join(directory, `${String(index).padStart(4, '0')}.jpg`), Buffer.from(capture.data, 'base64'));
      await writeFile(path.join(directory, 'timestamps.json'), JSON.stringify(captures.map(({ timestamp }, index) => ({ index, timestamp })), null, 2));
      report.profiles.push({ action: name, surface: 'compositor-screencast', directory: `${name}-frames`, frames: captures.length, method: 'Chrome compositor screencast, every third frame, JPEG 1000x625; no claim for flashes shorter than the sampling interval.' });
    }
    for (const { name: surface, session } of sessions) { const { profile } = await session.send('Profiler.stop'); const file = `${name}-${surface}.cpuprofile`; await writeFile(path.join(output, file), JSON.stringify(profile)); const summary = summarizeProfile(profile); await writeFile(path.join(output, `${name}-${surface}-hot-stacks.json`), JSON.stringify(summary, null, 2)); report.profiles.push({ action: name, surface, file, summary }); await session.detach(); }
    await persistReport();
  }
}
async function select(selector) {
  const frame = await frameHandle();
  const previous = await frame.evaluate(() => window.__benchClicks.length);
  await frame.locator(selector).click();
  await expect.poll(() => frame.evaluate(count => window.__benchClicks.length > count && Number.isFinite(window.__benchClicks.at(-1)?.paintAt), previous), { timeout: 30_000, intervals: [10] }).toBe(true);
  const click = await frame.evaluate(() => window.__benchClicks.at(-1));
  const result = await page.waitForFunction(click => { const messages = window.__benchMessages.filter(message => message.at >= click.at && message.path === (click.selectedPath || click.path)); const identity = messages.find(message => message.detail === 'identity'); const computed = messages.find(message => message.detail === 'computed' && message.sequence === identity?.sequence); const ui = window.__benchUi.find(record => record.sequence === identity?.sequence && record.at >= click.at); return identity && computed && ui ? { identity, computed, ui } : null; }, click, { polling: 10, timeout: 30_000 });
  const { identity, computed, ui } = await result.jsonValue(); await result.dispose();
  const metric = { kind: 'selection', selector, target: { path: click.selectedPath || click.path, clickedPath: click.path, id: click.selectedId || click.id, tag: click.tag }, trusted: click.trusted, started: click.at, highlightMs: click.highlightAt - click.at, canvasPaintMs: click.paintAt - click.at, identityMs: identity.at - click.at, computedMs: computed.at - click.at, inspectorMs: ui.inspectorAt - click.at, inspectorPanel: ui.panel, inspectorProof: ui.inspectorProof, layersMs: ui.layersAt - click.at, panelsPaintMs: ui.panelsPaintAt - click.at };
  report.actions.push(metric); console.log(JSON.stringify(metric)); await persistReport(); return metric;
}
async function arm(kind, eventType = 'keydown') {
  await page.evaluate(({ kind, eventType, selector }) => { window.__benchArmedAction = { kind, eventType, beforeFrame: Array.from(document.querySelectorAll(selector)).find(node => node.getBoundingClientRect().width) }; }, { kind, eventType, selector: frameSelector });
  const current = await frameHandle();
  if (current) await current.evaluate(action => { window.__benchArmedInput = action; }, { kind, eventType });
}
async function structure(kind, selector) {
  const frame = await frameHandle();
  const node = frame.locator(selector);
  const targetPath = await node.getAttribute('data-html-editor-path');
  const row = page.locator(`[data-layer-path="${targetPath}"]`);
  if (await row.count()) await row.click(); else await node.click({ position: { x: 2, y: 2 } });
  await expect(node).toHaveAttribute('data-html-editor-selected', '');
  const beforeIndex = await node.evaluate(node => [...node.parentElement.children].indexOf(node));
  await frame.evaluate(value => { window.__benchStructure = value; }, { kind, selector, beforeIndex });
  await arm(kind);
  await page.keyboard.press(kind === 'delete' ? 'Delete' : 'ArrowDown');
  await expect.poll(async () => activeFrameMatches(({ kind, selector, beforeIndex }) => { const node = document.querySelector(selector); return kind === 'delete' ? !node : node && [...node.parentElement.children].indexOf(node) !== beforeIndex; }, { kind, selector, beforeIndex }), { timeout: 60_000, intervals: [10] }).toBe(true);
  const parent = await page.evaluate(() => { const { beforeFrame, ...record } = window.__benchArmedAction; return record; });
  assert.ok(Number.isFinite(parent.started), 'The actual trusted structural input must have a native timestamp');
  const dom = await frame.evaluate(() => window.__benchStructure).catch(() => null);
  const observedAt = await page.evaluate(() => window.__benchClock.origin + window.__benchClock.now());
  const metric = { kind, selector, started: parent.started, trusted: parent.trusted, inputSurface: parent.inputSurface || 'parent', beforeIndex, sameIframe: !frame.isDetached() && frame === await frameHandle(), domMutationMs: dom?.appliedAt ? dom.appliedAt - parent.started : null, oldFramePaintMs: dom?.paintAt ? dom.paintAt - parent.started : null, promotionMs: parent.promotionAt ? parent.promotionAt - parent.started : null, observedCanvasMs: observedAt - parent.started };
  report.actions.push(metric); console.log(JSON.stringify(metric)); await persistReport();
  for (const command of ['undo', 'redo', 'undo']) {
    let beforeFrame;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        beforeFrame = await installObservers();
        await arm(`${kind}-${command}`);
        await beforeFrame.evaluate(action => { window.__benchStructure = action; }, { kind, selector, expectedExists: command === 'undo' || kind !== 'delete', expectedIndex: kind === 'move' ? (command === 'undo' ? beforeIndex : beforeIndex + 1) : undefined });
        if (!beforeFrame.isDetached() && beforeFrame === await frameHandle()) break;
      } catch (error) {
        if (!/detached|destroyed|closed/i.test(error.message)) throw error;
      }
      // A buffered document can settle between read-only setup calls. Rebind
      // observers before sending any input; never replay a user command.
      (report.setupDocumentChanges ||= []).push({ kind: `${kind}-${command}`, attempt: attempt + 1 });
      beforeFrame = null;
    }
    assert.ok(beforeFrame, 'The active document must settle before history input');
    await page.keyboard.press(command === 'redo' ? 'ControlOrMeta+Shift+z' : 'ControlOrMeta+z');
    const shouldExist = command === 'undo' || kind !== 'delete';
    await expect.poll(async () => activeFrameMatches(({ kind, command, selector, beforeIndex, shouldExist }) => { const element = document.querySelector(selector); if (!shouldExist) return !element; if (!element) return false; return kind !== 'move' || [...element.parentElement.children].indexOf(element) === (command === 'undo' ? beforeIndex : beforeIndex + 1); }, { kind, command, selector, beforeIndex, shouldExist }), { timeout: 90_000, intervals: [10] }).toBe(true);
    const timing = await page.evaluate(() => { const { beforeFrame, ...action } = window.__benchArmedAction; return { ...action, observedAt: window.__benchClock.origin + window.__benchClock.now() }; });
    assert.ok(Number.isFinite(timing.started), 'The actual trusted history input must have a native timestamp');
    const historyDom = await beforeFrame.evaluate(() => window.__benchStructure).catch(() => null);
    const historyMetric = { domMutationMs: historyDom?.appliedAt ? historyDom.appliedAt - timing.started : null, oldFramePaintMs: historyDom?.paintAt ? historyDom.paintAt - timing.started : null, kind: `${kind}-${command}`, started: timing.started, trusted: timing.trusted, inputSurface: timing.inputSurface || 'parent', observedCanvasMs: timing.observedAt - timing.started, promotionMs: timing.promotionAt ? timing.promotionAt - timing.started : null, iframeRetained: beforeFrame === await frameHandle() };
    report.actions.push(historyMetric); console.log(JSON.stringify(historyMetric)); await persistReport();
    await ready();
  }
  return metric;
}
const declarationCache = new WeakMap();
function sourceDeclarations(write, property, value) {
  let cache = declarationCache.get(write);
  if (!cache) declarationCache.set(write, cache = new Map());
  const key = `${property}:${value}`;
  if (cache.has(key)) return cache.get(key);
  const candidates = [];
  for (const file of write.upserts) {
    if (file.encoding !== 'utf8' || !file.path.endsWith('.css')) continue;
    const ast = postcss.parse(file.content);
    ast.walkDecls(property, declaration => {
      if (declaration.value.trim().toLowerCase() !== value.toLowerCase() || declaration.parent.type !== 'rule') return;
      const media = []; let ancestor = declaration.parent.parent;
      while (ancestor) { if (ancestor.type === 'atrule' && ancestor.name.toLowerCase() === 'media') media.push(ancestor.params); ancestor = ancestor.parent; }
      candidates.push({ path: file.path, bytes: file.byteLength, sha256: file.sha256, selector: declaration.parent.selector, media, expectedValuePresent: true });
    });
  }
  cache.set(key, candidates); return candidates;
}
async function waitForCanonicalSource(property, value, selector, firstWrite) {
  let proof = [];
  await expect.poll(async () => {
    const current = await frameHandle(); if (!current) return false;
    const confirmed = [];
    for (const write of sourceWrites.slice(firstWrite)) {
      const candidates = sourceDeclarations(write, property, value); if (!candidates.length) continue;
      const matching = await current.evaluate(({ selector, candidates }) => {
        const target = document.querySelector(selector); if (!target) return [];
        const loaded = new Set([...document.querySelectorAll('style[data-editor-source]')].filter(style => !style.sheet?.disabled && (!style.media || matchMedia(style.media).matches)).map(style => style.getAttribute('data-editor-source')));
        return candidates.filter(candidate => { try { return loaded.has(candidate.path) && target.matches(candidate.selector) && candidate.media.every(media => matchMedia(media).matches); } catch { return false; } }).map(candidate => ({ ...candidate, stylesheetLoaded: true, selectorMatchesTarget: true, mediaActive: true }));
      }, { selector, candidates }).catch(error => { if (/detached|destroyed|closed/i.test(error.message)) return []; throw error; });
      if (!matching.length) continue;
      const response = await write.request.response(); if (!response?.ok()) continue;
      const result = await response.json().catch(() => null); if (!result?.success) continue;
      confirmed.push({ at: write.at, responseStatus: response.status(), workspaceRevision: result.workspaceRevision, files: matching });
    }
    proof = confirmed; return confirmed.length > 0;
  }, { timeout: 90_000, intervals: [100] }).toBe(true);
  return proof;
}

async function selectLayerTarget(frame, selector) {
  const target = frame.locator(selector);
  const targetPath = await target.getAttribute('data-html-editor-path');
  const parts = targetPath.split('/');
  for (let depth = 1; depth < parts.length; depth++) {
    const ancestor = page.locator(`[data-layer-path="${parts.slice(0, depth).join('/')}"]`);
    const expand = ancestor.locator('button[aria-expanded="false"]');
    if (await expand.count()) await expand.click();
  }
  const row = page.locator(`[data-layer-path="${targetPath}"]`);
  await row.click();
  await expect(target).toHaveAttribute('data-html-editor-selected', '');
  return target;
}

async function styleEdit(property, selectorOverride) {
  const selector = selectorOverride || (property === 'color' ? (fixtureName === 'deckdocs' ? '#hero-title' : '#probe-title') : (fixtureName === 'deckdocs' ? '#top .hero__content' : '#section-0 .card-grid'));
  const frame = await installObservers();
  const target = await selectLayerTarget(frame, selector);
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  const original = await target.evaluate((node, property) => getComputedStyle(node).getPropertyValue(property), property);
  const expected = property === 'color' ? 'rgb(212, 63, 141)' : '31px';
  const value = property === 'color' ? '#d43f8d' : '31px';
  let input;
  if (property === 'color') {
    await page.locator('[data-design-token-section="Typography"]').getByText('Color', { exact: true }).locator('..').locator('[aria-haspopup="dialog"]').click();
    input = page.locator('[role="dialog"] input[type="text"]').filter({ visible: true }).first();
  } else {
    input = page.getByRole('textbox', { name: /^(Espaço entre elementos|Space between elements|Gap)$/ });
    if (!await input.count()) await page.getByRole('button', { name: /^(Vincular|Link|Bind).*horizontal.*vertical$/i }).click();
  }
  await expect(input).toBeVisible();
  const writeIndex = sourceWrites.length;
  report.pendingAction = { kind: `style-${property}`, selector, expected, stage: 'before-input' }; await persistReport();
  await frame.evaluate(check => { window.__benchStyleCheck = check; }, { selector, property, expected });
  await arm(`style-${property}`, 'input');
  await input.fill(value);
  await input.press('Enter');
  if (property === 'gap' && !argv.includes('--commit-by-blur')) await expect(input).toBeFocused();
  await expect.poll(() => activeFrameMatches(({ selector, property, expected }) => getComputedStyle(document.querySelector(selector)).getPropertyValue(property) === expected, { selector, property, expected }), { timeout: 60_000, intervals: [10] }).toBe(true);
  const timing = await page.evaluate(() => { const { beforeFrame, ...action } = window.__benchArmedAction; return { ...action, observedAt: window.__benchClock.origin + window.__benchClock.now() }; });
  report.pendingAction = { ...report.pendingAction, started: timing.started, stage: 'computed-confirmed', confirmedValue: expected }; await persistReport();
  const appliedFrame = await frameHandle();
  // Design can cancel iframe animation callbacks during reconciliation. This
  // polling upper bound uses the parent rendering clock after computed CSS was
  // observed; the independent iframe markers below retain their native times.
  const paintAt = await page.evaluate(() => new Promise(resolve => window.__benchClock.raf(() => window.__benchClock.raf(() => resolve(window.__benchClock.origin + window.__benchClock.now())))));
  const nativeStyle = await frame.evaluate(() => window.__benchStyleCheck).catch(() => null);
  if (property === 'color' || argv.includes('--commit-by-blur')) {
    await arm(`style-${property}-commit`, property === 'color' ? 'click' : 'keydown');
    if (property === 'color') await page.getByRole('button', { name: 'Fechar seletor de cor' }).click();
    else await input.press('Tab');
  }
  report.pendingAction = { ...report.pendingAction, stage: 'waiting-canonical-source', commitMethod: property === 'gap' && !argv.includes('--commit-by-blur') ? 'Enter, input remains focused' : 'blur/close' }; await persistReport();
  const proof = await waitForCanonicalSource(property, value, selector, writeIndex);
  if (property === 'gap' && !argv.includes('--commit-by-blur')) await expect(input).toBeFocused();
  const metric = { nativeComputedMs: nativeStyle?.appliedAt ? nativeStyle.appliedAt - timing.started : null, nativePaintMs: nativeStyle?.paintAt ? nativeStyle.paintAt - timing.started : null, kind: `style-${property}`, selector, original, expected, trusted: timing.trusted, started: timing.started, observedCanvasMs: timing.observedAt - timing.started, afterPaintMs: paintAt - timing.started, iframeRetained: frame === appliedFrame, codeTransportMs: proof[0].at - timing.started, firstSourceRequestAfterEnterMs: timing.enterAt ? proof[0].at - timing.enterAt : null, sourceProof: proof };
  report.actions.push(metric); delete report.pendingAction; console.log(JSON.stringify(metric)); await persistReport(); return metric;
}

async function rapidStyleEdits(count) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 100);
  const selector = fixtureName === 'deckdocs' ? '#top .hero__content' : '#section-0 .card-grid';
  const frame = await frameHandle();
  const input = page.getByRole('textbox', { name: /^(Espaço entre elementos|Space between elements|Gap)$/ });
  const initial = await frame.locator(selector).evaluate(node => getComputedStyle(node).gap);
  const initialValue = Number.parseFloat(await input.inputValue());
  assert.ok(Number.isFinite(initialValue));
  const waitForSource = async (value, firstWrite) => {
    const proof = await waitForCanonicalSource('gap', value, selector, firstWrite);
    return { workspaceRevision: proof[0].workspaceRevision, paths: proof.flatMap(write => write.files.map(file => file.path)) };
  };
  await input.focus();
  await page.evaluate(() => {
    window.__benchRapidKeys = [];
    window.__benchRapidValues = [];
    window.addEventListener('keydown', event => {
      if (!event.isTrusted || event.key !== 'ArrowUp' || !(event.target instanceof HTMLInputElement)) return;
      window.__benchRapidKeys.push(window.__benchClock.origin + window.__benchClock.now());
      const sample = { before: event.target.value };
      window.__benchRapidValues.push(sample);
      queueMicrotask(() => { sample.after = event.target.value; });
    }, true);
  });
  const writesBeforeBurst = sourceWrites.length;
  for (let index = 0; index < count; index++) await input.press('ArrowUp');
  const expected = `${initialValue + count}px`;
  await input.press('Tab');
  report.rapidInputTrace = await page.evaluate(() => window.__benchRapidValues);
  await persistReport();
  await expect.poll(() => activeFrameMatches(({ selector, expected }) => getComputedStyle(document.querySelector(selector)).gap === expected, { selector, expected }), { timeout: 60_000, intervals: [10] }).toBe(true);
  const keyTimes = await page.evaluate(() => window.__benchRapidKeys);
  assert.equal(keyTimes.length, count);
  const finalWrite = await waitForSource(expected, writesBeforeBurst);
  const writesBeforeUndo = sourceWrites.length;
  let undoCount = 0;
  let value = expected;
  while (undoCount < count && value !== initial) {
    const previous = value;
    await page.keyboard.press('ControlOrMeta+z'); undoCount++;
    await expect.poll(() => activeFrameMatches(({ selector, previous }) => getComputedStyle(document.querySelector(selector)).gap !== previous, { selector, previous }), { timeout: 60_000, intervals: [10] }).toBe(true);
    value = await (await frameHandle()).locator(selector).evaluate(node => getComputedStyle(node).gap);
  }
  assert.equal(value, initial, 'Undo must restore the value before the burst');
  const undoWrite = await waitForSource(initial, writesBeforeUndo);
  const retained = frame === await frameHandle();
  await captureDocumentDiagnostics('before-rapid-reload');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  await expect.poll(() => activeFrameMatches(({ selector, initial }) => getComputedStyle(document.querySelector(selector)).gap === initial, { selector, initial }), { timeout: 60_000, intervals: [10] }).toBe(true);
  await expect.poll(() => activeFrameMatches(selector => getComputedStyle(document.querySelector(selector)).color === 'rgb(212, 63, 141)', fixtureName === 'deckdocs' ? '#hero-title' : '#probe-title'), { timeout: 60_000, intervals: [10] }).toBe(true);
  const metric = { colorAfterReload: 'rgb(212, 63, 141)', kind: 'rapid-style-edits', property: 'gap', initial, expected, trustedInputs: keyTimes.length, inputBurstMs: keyTimes.at(-1) - keyTimes[0], undoCount, valueAfterUndoAndReload: initial, iframeRetainedBeforeReload: retained, sourceProof: { finalWrite, undoWrite } };
  report.actions.push(metric); console.log(JSON.stringify(metric)); await persistReport();
}

async function captureDocumentDiagnostics(label) {
  const current = await frameHandle();
  const entry = { label, paintAudit: await page.evaluate(() => window.__benchPaintAudit), runtimeMutations: current ? await current.evaluate(() => window.__benchRuntimeMutations) : null };
  (report.documents ||= []).push(entry);
  await persistReport();
}
async function verifyStylePersistence() {
  await captureDocumentDiagnostics('before-style-reload');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  const expectations = [];
  if (arg('--style-property') !== 'gap') expectations.push({ selector: fixtureName === 'deckdocs' ? '#hero-title' : '#probe-title', property: 'color', expected: 'rgb(212, 63, 141)' });
  if (arg('--style-property') !== 'color') expectations.push({ selector: fixtureName === 'deckdocs' ? '#top .hero__content' : '#section-0 .card-grid', property: 'gap', expected: '31px' });
  for (const expected of expectations) await expect.poll(() => activeFrameMatches(({ selector, property, expected }) => getComputedStyle(document.querySelector(selector)).getPropertyValue(property) === expected, expected), { timeout: 60_000, intervals: [10] }).toBe(true);
  report.actions.push({ kind: 'style-reload', expectations, passed: true }); await persistReport();
}

async function smokeImageHide() {
  assert.equal(fixtureName, 'deckdocs', 'The image isolation smoke uses the unmodified Deckdocs image classes');
  const selector = '#top .hero__press--business';
  const frame = await frameHandle();
  const target = frame.locator(selector);
  await target.click();
  await expect(target).toHaveAttribute('data-html-editor-selected', '');
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  const targetPath = await target.getAttribute('data-html-editor-path');
  const snapshot = () => activeFrameMatches(() => [...document.images].map(image => ({ path: image.getAttribute('data-html-editor-path'), display: getComputedStyle(image).display })));
  const before = await snapshot();
  assert.ok(Array.isArray(before) && before.length > 1);
  assert.notEqual(before.find(image => image.path === targetPath)?.display, 'none');
  await setLayoutVisibility(false);
  await expect.poll(() => activeFrameMatches(selector => getComputedStyle(document.querySelector(selector)).display, selector), { timeout: 30_000 }).toBe('none');
  const hidden = await snapshot();
  const changed = hidden.filter(image => before.find(previous => previous.path === image.path)?.display !== image.display);
  assert.deepEqual(changed.map(image => image.path), [targetPath], 'Hide must affect only the selected image class');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(snapshot, { timeout: 30_000 }).toEqual(before);
  report.actions.push({ kind: 'image-hide-isolation-smoke', selector, imagesChecked: before.length, changedImagePaths: changed.map(image => image.path), undoRestoredAllImageDisplays: true, passed: true });
  await persistReport();
}

async function setLayoutVisibility(visible) {
  const group = page.locator('[data-html-layout-visibility]');
  if (await group.count()) await group.getByRole('button', { name: visible ? /^(Yes|Sim)$/ : /^(No|Não)$/ }).click();
  else {
    assert.equal(visible, false, 'Restoring visibility must use the new Visible control');
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
  }
}

async function smokeMobileStyles() {
  assert.ok(arg('--project-zip'), 'Mobile regression smoke requires the private project fixture containing its original mobile rule');
  const selector = '.addons__intro';
  const read = () => activeFrameMatches(selector => {
    const element = document.querySelector(selector);
    const style = getComputedStyle(element);
    return { display: style.display, gap: style.gap, width: document.documentElement.getBoundingClientRect().width, innerWidth, max480: matchMedia('(max-width:480px)').matches, devicePixelRatio, visualViewportScale: visualViewport.scale };
  }, selector);
  const desktop = await read();
  const mobile = page.getByRole('tab', { name: /^Breakpoint Mobile, 480 pixels$/ });
  await mobile.click(); await ready();
  const frame = await installObservers();
  const initial = await read();
  report.pendingAction = { kind: 'mobile-styles-smoke', selector, stage: 'checking-original-mobile-rule', initial, desktop };
  await persistReport();
  assert.equal(initial.max480, true, 'The authored max-width:480px query must remain active at the selected 480px breakpoint');
  assert.equal(initial.display, 'none', 'The original mobile Hide rule must apply');
  await selectLayerTarget(frame, selector);
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  await setLayoutVisibility(true);
  await expect.poll(async () => (await read()).display, { timeout: 30_000 }).toBe('grid');
  await page.waitForTimeout(2100);
  assert.equal((await read()).display, 'grid', 'Grid must remain applied after preview reconciliation');
  await styleEdit('gap', selector);
  assert.equal((await read()).gap, '31px');
  const beforeHideWrite = sourceWrites.length;
  await setLayoutVisibility(false);
  await expect.poll(async () => (await read()).display, { timeout: 30_000 }).toBe('none');
  await page.waitForTimeout(2100);
  assert.equal((await read()).display, 'none', 'Hide must remain applied after preview reconciliation');
  const hideSource = await waitForCanonicalSource('display', 'none', selector, beforeHideWrite);
  await captureDocumentDiagnostics('before-mobile-reload');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  await page.getByRole('tab', { name: /^Breakpoint Mobile, 480 pixels$/ }).click(); await ready();
  const afterReload = await read();
  assert.equal(afterReload.max480, true); assert.equal(afterReload.display, 'none'); assert.equal(afterReload.gap, '31px');
  await selectLayerTarget(await installObservers(), selector);
  await page.getByRole('tab', { name: 'Style', exact: true }).click();
  const beforeRestoreWrite = sourceWrites.length;
  await setLayoutVisibility(true);
  await expect.poll(async () => (await read()).display, { timeout: 30_000 }).toBe('grid');
  await page.waitForTimeout(2100);
  const restoredAfterReload = await read(); assert.equal(restoredAfterReload.display, 'grid'); assert.equal(restoredAfterReload.gap, '31px');
  const restoredSource = await waitForCanonicalSource('display', 'grid', selector, beforeRestoreWrite);
  const beforeFinalHideWrite = sourceWrites.length;
  await setLayoutVisibility(false);
  await expect.poll(async () => (await read()).display, { timeout: 30_000 }).toBe('none');
  const finalHideSource = await waitForCanonicalSource('display', 'none', selector, beforeFinalHideWrite);
  const desktopTab = page.getByRole('tab', { name: /^Breakpoint (?:Primary|Desktop|Base), 1920 pixels$/ });
  await desktopTab.click(); await ready();
  const desktopAfter = await read();
  assert.equal(desktopAfter.display, desktop.display); assert.equal(desktopAfter.gap, desktop.gap, 'Mobile editing must preserve the desktop declaration');
  report.actions.push({ kind: 'mobile-styles-smoke', selector, initial, afterReload, restoredAfterReload, desktopBefore: desktop, desktopAfter, hideSource, restoredSource, finalHideSource, preservedAfterReconciliation: true, passed: true });
  delete report.pendingAction;
  await persistReport();
}

async function smokeTimeline() {
  assert.equal(fixtureName, 'timeline');
  const frame = await installObservers();
  await selectLayerTarget(frame, '#timeline-target');
  const read = () => activeFrameMatches(() => { const element = document.querySelector('#timeline-target'); const computed = getComputedStyle(element); return { at: window.__benchClock.origin + window.__benchClock.now(), opacity: Number(computed.opacity), x: new DOMMatrixReadOnly(computed.transform).m41, inlineOpacity: element.style.opacity, inlineTransform: element.style.transform, computedTransform: computed.transform, animationName: computed.animationName, animationPlayState: computed.animationPlayState, animationDuration: computed.animationDuration, transitionProperty: computed.transitionProperty, transitionDuration: computed.transitionDuration, animations: element.getAnimations().map(animation => ({ type: animation.constructor.name, name: animation.animationName || animation.transitionProperty, playState: animation.playState, currentTime: animation.currentTime, keyframes: animation.effect?.getKeyframes() })), preview: element.hasAttribute('data-html-editor-interaction-preview'), authoredScriptRuns: window.authoredScriptRuns || 0 }; });
  const approximately = (actual, expected, description) => assert.ok(Math.abs(actual - expected) < .035, `${description}: ${actual} differs from ${expected}`);
  const before = await read(); assert.equal(before.authoredScriptRuns, 0);
  report.pendingAction = { kind: 'timeline-ui-smoke', before, stage: 'opening-timeline' }; await persistReport();
  await page.getByRole('tab', { name: 'Interactions', exact: true }).first().click();
  await page.locator('[data-interaction-list]').getByRole('button', { name: /^Native timeline/ }).click();
  await page.getByRole('button', { name: /^Move and fade/ }).click();
  const playhead = page.locator('[data-timeline-playhead]');
  await expect(playhead).toBeVisible();
  await ready(); await installObservers();
  await playhead.focus();
  for (let step = 0; step < 5; step++) await playhead.press('Shift+ArrowRight');
  await expect(playhead).toHaveAttribute('aria-valuenow', '0.5');
  await expect.poll(async () => { const value = await read(); report.pendingAction = { ...report.pendingAction, stage: 'scrub', lastValue: value, observations: [...(report.pendingAction.observations || []), value], controls: await (await frameHandle()).evaluate(() => window.__benchTimelineControls) }; return Math.abs(value.opacity - .35) < .002 && Math.abs(value.x - 30) < .035; }, { timeout: 10_000 }).toBe(true);
  const scrub = await read(); approximately(scrub.x, 30, 'Scrub position');
  await page.getByRole('button', { name: /^(Reproduzir|Play)$/ }).click();
  await expect.poll(async () => (await read()).opacity, { timeout: 10_000 }).toBeGreaterThan(scrub.opacity + .04);
  const playing = await read();
  await page.getByRole('button', { name: /^(Pausar|Pause)$/ }).click();
  const pausedTime = Number(await playhead.getAttribute('aria-valuenow'));
  await expect.poll(async () => Math.abs((await read()).opacity - (.2 + .3 * pausedTime)), { timeout: 10_000 }).toBeLessThan(.003);
  const paused = await read(); await page.waitForTimeout(220);
  approximately((await read()).opacity, paused.opacity, 'Pause keeps the requested frame');
  await page.getByRole('button', { name: /^(Fim|End)$/ }).click();
  await expect.poll(async () => (await read()).opacity, { timeout: 10_000 }).toBe(.8);
  const end = await read(); approximately(end.x, 120, 'End position');
  await page.getByRole('button', { name: /^(Redefinir|Reset)$/ }).click();
  await expect.poll(async () => Math.abs((await read()).opacity - before.opacity), { timeout: 10_000 }).toBeLessThan(.035);
  const reset = await read();
  await page.getByRole('button', { name: /^(Fechar timeline|Close timeline)$/ }).click();
  await page.waitForTimeout(180);
  const closed = await read(); approximately(closed.opacity, before.opacity, 'Close releases native preview'); assert.equal(closed.authoredScriptRuns, 0); assert.equal(closed.preview, false);
  report.actions.push({ kind: 'timeline-ui-smoke', before, scrub, playing, paused, end, reset, closed, controls: ['keyboard scrub', 'Play', 'Pause', 'End', 'Reset/stop', 'Close'], passed: true });
  delete report.pendingAction;
  await persistReport();
}

try {
  const login = wp('eval', 'echo wp_login_url();');
  await page.goto(login);
  // WordPress may focus its username input shortly after load. Verify both
  // fields before submitting so delayed autofocus cannot redirect typing.
  let fieldsReady = false;
  for (let attempt = 0; attempt < 3 && !fieldsReady; attempt++) {
    await page.locator('#user_login').fill(environment.KODETY_E2E_USER);
    await page.locator('#user_pass').fill(environment.KODETY_E2E_PASSWORD);
    fieldsReady = await page.locator('#user_login').inputValue() === environment.KODETY_E2E_USER && await page.locator('#user_pass').inputValue() === environment.KODETY_E2E_PASSWORD;
  }
  assert.ok(fieldsReady, 'Login fields must remain stable before submission');
  await page.locator('#wp-submit').click(); await page.waitForURL('**/wp-admin/**', { waitUntil: 'domcontentloaded' });
  authenticated = true;
  if (zoomSession) await zoomSession.setPageZoom(page, browserZoom);
  console.log(`OPEN ${fixtureName} ${label}`);
  await page.goto(origin + '/kodety/editor/', { waitUntil: 'domcontentloaded' }); await ready();
  await installObservers();
  report.canvasMode = await iframe().evaluate(node => ({ title: node.title, infinite: Boolean(node.closest('[data-infinite-canvas-active-iframe]')) }));
  report.runtime = await (await frameHandle()).evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, elements: document.querySelectorAll('[data-html-editor-path]').length, domElements: document.querySelectorAll('*').length, styleSheets: document.styleSheets.length, cssRules: [...document.styleSheets].reduce((sum, sheet) => { try { return sum + sheet.cssRules.length; } catch { return sum; } }, 0), title: document.title }));
  await persistReport(); console.log(JSON.stringify({ fixture: report.fixture, runtime: report.runtime }));
  if (argv.includes('--timeline-smoke-only')) await smokeTimeline();
  else if (argv.includes('--mobile-smoke-only')) await smokeMobileStyles();
  else if (argv.includes('--smoke-only')) await smokeImageHide();
  else {
  const probes = fixtureName === 'deckdocs' ? ['#hero-title .hero__title-copy--default', '#top .hero__lede'] : ['#probe-title', '#probe-copy', '#section-0 .product-card:first-child .card-title a', '#section-1 .product-card:nth-child(2) .card-body > p:not(.eyebrow)'];
  await profiled('selection', async () => { for (let index = 0; index < selectionSamples; index++) await select(probes[index % probes.length]); });
  report.selectionRuntimeMutations = await (await frameHandle()).evaluate(() => window.__benchRuntimeMutations);
  await persistReport();
  if (!argv.includes('--selection-only')) {
    if (!argv.includes('--style-only') && !argv.includes('--skip-navigation')) await profiled('navigation', async () => {
      for (const target of [{ menu: fixtureName === 'deckdocs' ? /^about$/i : /^page.?02$/i, heading: fixtureName === 'deckdocs' ? /about/i : /page 2/i }, { menu: /^home$/i, heading: fixtureName === 'deckdocs' ? /Strategy and design/i : /page 1/i }].slice(0, argv.includes('--first-navigation-only') ? 1 : undefined)) {
        await page.getByTitle(/^(Mudar de página|Switch page|Change page)$/).click();
        await arm('navigation', 'click');
        await page.getByRole('menuitem', { name: target.menu }).click();
        await expect(canvas().locator('main')).toBeAttached({ timeout: 90_000 });
        await expect(canvas().locator('main')).toContainText(target.heading, { timeout: 90_000 });
        const timing = await page.evaluate(() => { const { beforeFrame, ...action } = window.__benchArmedAction; return { ...action, observedAt: window.__benchClock.origin + window.__benchClock.now() }; });
        const metric = { kind: 'navigation', target: String(target.menu), started: timing.started, trusted: timing.trusted, observedCanvasMs: timing.observedAt - timing.started, promotionMs: timing.promotionAt ? timing.promotionAt - timing.started : null, canvasPaintMs: timing.canvasPaintAt ? timing.canvasPaintAt - timing.started : null };
        report.actions.push(metric); console.log(JSON.stringify(metric)); await persistReport(); await ready();
      }
    });
    await installObservers();

    const section = fixtureName === 'deckdocs' ? '#four-ways' : '#section-0';
    if (!argv.includes('--style-only') && !argv.includes('--navigation-style-only')) {
      await profiled('move', () => structure('move', section));
      await installObservers();
      await profiled('delete', () => structure('delete', section));
    }
    if (!argv.includes('--skip-style')) {
      await installObservers();
      if (arg('--style-property') !== 'gap') await profiled('style-color', () => styleEdit('color'));
      if (arg('--style-property') !== 'color') await profiled('style-gap', () => styleEdit('gap'));
      if (arg('--rapid-edits')) await rapidStyleEdits(Number(arg('--rapid-edits')));
      else await verifyStylePersistence();
    }
  }
  }
  report.paintAudit = await page.evaluate(() => window.__benchPaintAudit);
  if (argv.includes('--diagnose-navigation')) report.navigationDiagnostics = { readySignals: await page.evaluate(() => window.__benchReadySignals), assetSnapshots: await (await frameHandle()).evaluate(() => window.__benchAssetSnapshots) };
  report.runtimeMutations = await (await frameHandle()).evaluate(() => window.__benchRuntimeMutations);
  report.longTasks = { parent: await page.evaluate(() => window.__benchLongTasks), iframe: await (await frameHandle()).evaluate(() => window.__benchLongTasks) };
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = redact(error.stack); if (authenticated) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
finally {
  report.paintAudit = await page.evaluate(() => window.__benchPaintAudit).catch(() => null);
  const lastFrame = await frameHandle().catch(() => null);
  report.runtimeMutations = await lastFrame?.evaluate(() => window.__benchRuntimeMutations).catch(() => null);
  report.longTasks = { parent: await page.evaluate(() => window.__benchLongTasks).catch(() => null), iframe: await lastFrame?.evaluate(() => window.__benchLongTasks).catch(() => null) };
  report.completedAt = new Date().toISOString(); await persistReport(); await page.goto('about:blank').catch(() => {}); if (zoomSession) await zoomSession.close(); else await browser.close(); }
