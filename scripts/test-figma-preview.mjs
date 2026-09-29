import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from 'parse5';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = await readFile(path.join(root, 'FigmaPlugin/ui.html'), 'utf8');
const script = ui.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'plugin UI script exists');
new vm.Script(script);

const uiNodes = [];
const visitUiNode = node => {
  if (node.tagName) uiNodes.push(node);
  for (const child of node.childNodes || []) visitUiNode(child);
};
visitUiNode(parse(ui));
const uiAttribute = (node, name) => node?.attrs?.find(attribute => attribute.name === name)?.value;
const uiHasClass = (node, className) => (uiAttribute(node, 'class') || '').split(/\s+/).includes(className);
const uiById = id => uiNodes.find(node => uiAttribute(node, 'id') === id);
const uiAncestor = (node, predicate) => {
  for (let current = node?.parentNode; current; current = current.parentNode) {
    if (predicate(current)) return current;
  }
};
const uiBefore = (first, second) => uiNodes.indexOf(first) < uiNodes.indexOf(second);
const uniqueIds = uiNodes.map(node => uiAttribute(node, 'id')).filter(Boolean);
assert.equal(new Set(uniqueIds).size, uniqueIds.length, 'compact UI keeps IDs unique');
assert.equal(uiNodes.filter(node => node.tagName === 'h1').length, 1, 'the brand is the single page heading');
assert.equal(uiNodes.some(node => ['page-intro', 'workflow', 'journey'].some(name => uiHasClass(node, name))), false,
  'redundant introduction and tutorial must be removed, not merely hidden at one viewport');
const selectionPanel = uiAncestor(uiById('selection-heading'), node => node.tagName === 'section');
assert.ok(selectionPanel, 'selection status remains a semantic region');
assert.equal(uiAttribute(selectionPanel, 'aria-live'), 'polite', 'selection changes remain announced');
assert.equal(uiNodes.some(node => uiHasClass(node, 'selection-label')), false, 'the redundant selection label stays removed');
const contentStack = selectionPanel.parentNode;
assert.equal((contentStack.childNodes || []).filter(node => node.tagName)[0], selectionPanel,
  'current selection is the first content panel');
const semanticDetails = uiAncestor(uiById('semantic-tag'), node => node.tagName === 'details');
assert.ok(semanticDetails, 'semantic controls stay available through native disclosure');
assert.equal(uiAttribute(semanticDetails, 'open'), undefined, 'semantic controls do not displace the initial preview');
const responsiveHelp = uiNodes.find(node => uiAttribute(node, 'data-i18n') === 'responsiveHelp');
const conversionDetails = uiAncestor(responsiveHelp, node => node.tagName === 'details');
assert.ok(conversionDetails, 'full responsive explanation remains available on demand');
assert.equal(uiAttribute(conversionDetails, 'open'), undefined, 'long conversion explanation is collapsed initially');
const conversionPreview = uiById('conversion-preview');
assert.ok(conversionPreview);
assert.equal(uiBefore(selectionPanel, conversionPreview), true);
assert.equal(uiBefore(uiById('responsive-mode'), conversionPreview), true, 'conversion mode remains easy to access');
for (const panel of [semanticDetails, conversionDetails, uiById('diagnostics'), uiById('font-panel')]) {
  assert.ok(panel, 'secondary information is retained');
  assert.equal(uiBefore(conversionPreview, panel), true, 'preview precedes secondary information');
}
assert.equal(uiAttribute(uiById('conversion-progress'), 'hidden'), '', 'idle progress does not occupy space');

// An inert HTML adapter lets the real preview sanitizer run in Node without
// introducing a second browser automation dependency into the source suite.
class HtmlNode {
  constructor(node) { this.node = node; }
  get tagName() { return this.node.tagName || ''; }
  get attributes() { return this.node.attrs || []; }
  get textContent() {
    const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
    return text(this.node);
  }
  set textContent(value) { this.node.childNodes = [{ nodeName: '#text', value, parentNode: this.node }]; }
  get innerHTML() { return serialize(this.node); }
  remove() {
    const parent = this.node.parentNode;
    if (parent) parent.childNodes = parent.childNodes.filter(child => child !== this.node);
  }
  setAttribute(name, value) {
    const existing = this.node.attrs.find(attribute => attribute.name === name);
    if (existing) existing.value = value;
    else this.node.attrs.push({ name, value });
  }
  removeAttribute(name) { this.node.attrs = this.node.attrs.filter(attribute => attribute.name !== name); }
  querySelectorAll(selector) {
    const names = new Set(selector.split(',').map(name => name.toLowerCase()));
    const result = [];
    const visit = node => (node.childNodes || []).forEach(child => {
      if (child.tagName && (names.has('*') || names.has(child.tagName.toLowerCase()))) result.push(new HtmlNode(child));
      visit(child);
    });
    visit(this.node);
    return result;
  }
}
class InertDOMParser {
  parseFromString(html) {
    const document = new HtmlNode(parse(html));
    document.body = document.querySelectorAll('body')[0];
    return document;
  }
}
const previewStart = script.indexOf('const previewState =');
const previewEnd = script.indexOf('    initializePreview();', previewStart);
assert.ok(previewStart > 0 && previewEnd > previewStart);
const sandbox = vm.createContext({
  DOMParser: InertDOMParser, document: {}, state: { basePayload: null }, t: key => key,
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
});
vm.runInContext(script.slice(previewStart, previewEnd), sandbox);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220"><rect width="300" height="220" rx="12" fill="#9393ff"/><path d="M45 112 120 52 258 168H45Z" fill="#ffffff"/></svg>';
const fontData = await readFile(path.join(root, 'Wordpress/kodety/admin/fonts/inter-latin-variable.woff2'));
const payload = {
  signature: 'kodety-figma', version: 5, source: 'figma', exportId: 'preview-fixture',
  documentName: 'Preview QA', pageName: 'Design',
  html: '<section class="hero"><div class="copy"><p class="eyebrow">FROM FIGMA TO KODETY</p><h1>Your ideas,<br>ready to build.</h1><p>Editable typography, local images and a layout that fits every screen.</p></div><img class="art" alt="Local vector illustration" src="figma-asset://illustration"></section>',
  css: '.hero{display:flex;align-items:center;gap:48px;width:100%;min-height:700px;padding:64px;background:#fbf5ef;color:#151515;font-family:PreviewInter,sans-serif}.copy{flex:1}.eyebrow{font-size:13px;letter-spacing:.12em;color:var(--fixture-accent)}h1{font-size:68px;line-height:1.05;letter-spacing:-.055em;margin:20px 0}p{font-size:20px;line-height:1.5}.art{width:300px;height:220px;object-fit:fill;padding:0}@media(max-width:600px){.hero{flex-direction:column;align-items:stretch;padding:28px;gap:24px}h1{font-size:44px}.art{width:100%;height:auto}}',
  assets: [
    { id: 'illustration', mimeType: 'image/svg+xml', text: svg },
    { id: 'inter', mimeType: 'font/woff2', dataBase64: fontData.toString('base64') },
  ],
  fonts: [{ family: 'PreviewInter', style: 'Regular', weight: 400, assetId: 'inter' }],
  variables: [{ cssName: '--fixture-accent', type: 'color', value: '#6f59e3' }],
  stats: { nodes: 7, assets: 2, bytes: fontData.byteLength, restSnapshotNodes: 7, responsiveRules: 3 },
  warnings: [],
  diagnostics: [{ nodeId: '7:1', nodeName: 'Hero illustration', severity: 'info', code: 'vector-preserved', message: 'Preserved as a crisp SVG image.' }],
  preview: { width: 1200, height: 700, referenceDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` },
};
sandbox.fixture = payload;
const output = vm.runInContext('previewDocument(fixture)', sandbox);
assert.match(output, /font-family:"PreviewInter";src:url\("data:font\/woff2;base64,/);
assert.match(output, /:root\{--fixture-accent:#6f59e3;\}/);
assert.match(output, /src="data:image\/svg\+xml;base64,/);
assert.doesNotMatch(output, /figma-asset:\/\//);
assert.match(output, /default-src 'none'; script-src 'none'/);
assert.match(ui, /<iframe[^>]+sandbox=""[^>]+referrerpolicy="no-referrer"/);
assert.match(output, /html,body\{margin:0;padding:0;background:transparent\}/);
assert.doesNotMatch(output, /min-height:100%;background:#fff/);

sandbox.hostile = {
  ...payload,
  html: '<script>parent.attack=true</script><iframe srcdoc="bad"></iframe><img onload="attack()" src="https://preview-blocked.invalid/image.png"><svg><foreignObject><iframe></iframe></foreignObject><path fill="url(#paint)"/></svg><a href="javascript:alert(1)" ping="https://preview-blocked.invalid/ping">Unsafe link</a><form action="https://preview-blocked.invalid/form"><button formaction="https://preview-blocked.invalid/form" onclick="attack()">Submit</button></form>',
  css: '@import "https://preview-blocked.invalid/font.css";.hero{background:url(https://preview-blocked.invalid/image.png)}',
};
const hostileOutput = vm.runInContext('previewDocument(hostile)', sandbox);
assert.doesNotMatch(hostileOutput, /<script|<iframe|foreignObject|onload=|onclick=|javascript:|formaction=|action=|ping=|preview-blocked/);
assert.match(hostileOutput, /fill="url\(#paint\)"/);
assert.equal(vm.runInContext('previewLocalUrl("https://example.com/image.png")', sandbox), '');
assert.equal(vm.runInContext('previewDimension(Infinity, 1440)', sandbox), 1440);
assert.equal(vm.runInContext('previewDimension(-50, 1440)', sandbox), 1440);
assert.equal(vm.runInContext('previewDimension(100000, 1440)', sandbox), 20000);
const previewNodes = {
  'preview-stage': { clientWidth: 410, clientHeight: 300, querySelector: () => ({ hidden: false }) },
  'preview-frame': { style: {}, srcdoc: '<html></html>' },
  'preview-reference': {}, 'preview-reference-image': { style: {} },
  'preview-dimensions': {}, 'preview-status': {},
};
sandbox.document.querySelector = selector => previewNodes[selector.slice(1)];
sandbox.document.querySelectorAll = () => [];
vm.runInContext('previewState.payload=fixture;previewState.width=1920;previewState.height=961;layoutPreview()', sandbox);
assert.equal(previewNodes['preview-frame'].style.width, '1920px', 'zoom does not change media query viewport width');
assert.equal(previewNodes['preview-frame'].style.height, '961px', 'short desktop frame ends at authored section height');
assert.equal(previewNodes['preview-dimensions'].textContent, '1920px · 21%');
vm.runInContext('previewState.height=3000;layoutPreview()', sandbox);
assert.equal(previewNodes['preview-frame'].style.height, '1405px', 'long desktop content remains scrollable within stage');
vm.runInContext('previewState.device="mobile";layoutPreview()', sandbox);
assert.equal(previewNodes['preview-frame'].style.width, '390px');
assert.equal(previewNodes['preview-frame'].style.height, '300px', 'mobile keeps a bounded scrollable viewport');
vm.runInContext('previewState.device="tablet";layoutPreview()', sandbox);
assert.equal(previewNodes['preview-frame'].style.width, '768px');
assert.equal(previewNodes['preview-frame'].style.height, '562px', 'tablet keeps a bounded scrollable viewport');
const actionElements = { 'primary-action': {}, 'primary-label': {} };
const actionState = { selectionCount: 0, phase: 'idle' };
const actionSandbox = vm.createContext({
  state: actionState, byId: id => actionElements[id], t: key => key,
  document: { querySelectorAll: () => [] },
});
vm.runInContext(script.slice(script.indexOf('    function renderPrimaryAction()'), script.indexOf('    function renderDiagnostics(')), actionSandbox);
for (const [selectionCount, phase, label, disabled] of [
  [0, 'idle', 'convertCopy', true],
  [1, 'idle', 'convertCopy', false],
  [1, 'converting', 'converting', true],
  [1, 'ready', 'copyBuilder', false],
  [1, 'copied', 'copyBuilder', false],
]) {
  Object.assign(actionState, { selectionCount, phase });
  vm.runInContext('renderPrimaryAction()', actionSandbox);
  assert.equal(actionElements['primary-label'].textContent, label, `the action describes the next explicit click in ${phase}`);
  assert.equal(actionElements['primary-action'].disabled, disabled, `the action preserves availability in ${phase}`);
}
const progressElements = Object.fromEntries(['conversion-progress', 'progress-bar', 'progress-value',
  'progress-label', 'progress-summary'].map(id => [id, { dataset: {}, style: {} }]));
const progressSandbox = vm.createContext({ byId: id => progressElements[id] });
vm.runInContext(script.slice(script.indexOf('    function setProgress('), script.indexOf('    function resetPayload()')), progressSandbox);
for (const [progress, kind, hidden, loading] of [
  [0, '', true, false], [25, '', false, true], [100, 'success', false, false], [0, 'error', false, false], [0, '', true, false],
]) {
  progressSandbox.fixture = { progress, kind };
  vm.runInContext('setProgress(fixture.progress, "QA status", "QA details", fixture.kind)', progressSandbox);
  assert.equal(progressElements['conversion-progress'].hidden, hidden, `${kind || 'normal'} status visibility at ${progress}%`);
  assert.equal(progressElements['conversion-progress'].dataset.loading, String(loading));
  assert.equal(progressElements['progress-value'].textContent, loading ? `${progress}%` : '', 'completed or idle status omits redundant percentage');
  assert.equal(progressElements['progress-summary'].textContent, 'QA details', 'details remain available even when status is compact');
}
assert.match(ui, /<details class="surface settings-section" aria-labelledby="semantic-title">/);
assert.match(ui, /<div class="metric"><span data-i18n="restNodesStat">[^<]+<\/span><strong id="rest-stat">/);
const diagnosticElement = () => ({ children: [], dataset: {},
  replaceChildren() { this.children = []; }, append(...nodes) { this.children.push(...nodes); },
  setAttribute() {}, addEventListener() {} });
const diagnosticElements = Object.fromEntries(['diagnostics', 'rest-stat', 'responsive-stat', 'fallback-stat',
  'warning-count', 'warnings', 'diagnostic-issues'].map(id => [id, diagnosticElement()]));
const diagnosticSandbox = vm.createContext({
  byId: id => diagnosticElements[id], previewElement: id => diagnosticElements[id],
  document: { createElement: diagnosticElement }, formatNumber: value => String(value || 0),
  t: (key, replacements = {}) => `${key}:${replacements.count || ''}`, send() {},
});
vm.runInContext(script.slice(script.indexOf('    function renderDiagnostics('), previewStart), diagnosticSandbox);
diagnosticSandbox.payload = { stats: { rasterizedNodes: 49, backgroundRasterizedNodes: 2 }, warnings: [],
  diagnostics: Array.from({ length: 49 }, (_, index) => ({ nodeId: String(index), severity: 'warning',
    code: 'raster-fallback', message: 'Normal PNG rendering is not a warning.' })) };
vm.runInContext('renderDiagnostics(payload)', diagnosticSandbox);
assert.equal(diagnosticElements['fallback-stat'].textContent, '51');
assert.equal(diagnosticElements['warning-count'].textContent, 'noWarnings:');
assert.equal(diagnosticElements['diagnostic-issues'].children.length, 0, 'ordinary image conversion must not produce 49 issue rows');
diagnosticSandbox.payload.diagnostics.push({ nodeId: 'real', severity: 'warning', code: 'crop-fallback', message: 'Precise crop export failed.' });
vm.runInContext('renderDiagnostics(payload)', diagnosticSandbox);
assert.equal(diagnosticElements['warning-count'].textContent, 'warningCountOne:1');
assert.equal(diagnosticElements['diagnostic-issues'].children.length, 1, 'actual export degradation stays visible');
console.log('Figma preview: compact hierarchy, explicit action states, local assets, fonts, variables, sanitization, sandbox, and dimension tests passed.');

if (process.argv.includes('--serve') || process.argv.includes('--screenshots')) {
  const port = Number(process.env.FIGMA_PREVIEW_PORT || 4197);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'FIGMA_PREVIEW_PORT must be a valid TCP port');
  const baseUrl = `http://127.0.0.1:${port}`;
  const plugin = await readFile(path.join(root, 'FigmaPlugin/code.js'), 'utf8');
  const messagesSource = plugin.match(/const I18N = Object\.freeze\([\s\S]*?\n\}\);/)?.[0];
  assert.ok(messagesSource, 'real plugin translations exist for visual QA');
  const translations = vm.runInNewContext(`${messagesSource}\nI18N`);
  const fixtureScript = `<script>
    window.addEventListener('message', event => {
      if (event.data && event.data.pluginMessage && event.data.pluginMessage.type === 'focus-node') document.querySelector('#fixture-status').textContent = 'Located ' + event.data.pluginMessage.nodeId;
    });
    window.addEventListener('load', () => {
      const locale = new URLSearchParams(location.search).get('locale') === 'pt-BR' ? 'pt-BR' : 'en';
      const messages = ${JSON.stringify(translations).replace(/</g, '\\u003c')}[locale];
      onmessage({data:{pluginMessage:{type:'i18n',locale,messages,selectionCount:1,selectionNames:['Hero / Testimonials'],selectionKey:'fixture'}}});
      onmessage({data:{pluginMessage:{type:'payload',selectionKey:'fixture',payload:${JSON.stringify(payload).replace(/</g, '\\u003c')}}}});
    });
  </script>`;
  const page = ui.replace(/\n<\/body>\n<\/html>\s*$/, `<div id="fixture-status" class="sr-only">Preview QA</div>${fixtureScript}</body></html>`);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.url === '/compiled' ? output : page);
  });
  server.listen(port, '127.0.0.1', () => console.log(`Preview fixture: ${baseUrl}`));
  if (process.argv.includes('--screenshots')) {
    await new Promise(resolve => server.once('listening', resolve));
    const { chromium } = await import('playwright');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const captures = await mkdtemp(path.join(tmpdir(), 'kodety-figma-plugin-ui-'));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 460, height: 720 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const assertFlatMouseTab = async selector => {
        const tab = page.locator(selector);
        await tab.click();
        const styles = await tab.evaluate(element => {
          const style = getComputedStyle(element);
          return { pressed: element.getAttribute('aria-pressed'), focused: element.matches(':focus'),
            keyboardFocus: element.matches(':focus-visible'), shadow: style.boxShadow,
            borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
            outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
        });
        assert.equal(styles.pressed, 'true', `${selector} is selected after a pointer click`);
        assert.equal(styles.focused, true, `${selector} keeps pointer focus for the visual check`);
        assert.equal(styles.keyboardFocus, false, `${selector} is checked without keyboard focus styling`);
        assert.deepEqual(styles.borders, ['0px', '0px', '0px', '0px'], `${selector} has no selected border`);
        assert.equal(styles.shadow, 'none', `${selector} has no selected box shadow`);
        assert.ok(styles.outlineStyle === 'none' || styles.outlineWidth === '0px', `${selector} has no pointer-focus outline`);
      };
      const assertKeyboardTabFocus = async selector => {
        const focus = await page.locator(selector).evaluate(element => {
          const style = getComputedStyle(element);
          return { visible: element.matches(':focus-visible'), width: parseFloat(style.outlineWidth), style: style.outlineStyle };
        });
        assert.equal(focus.visible, true, `${selector} remains keyboard-focusable`);
        assert.ok(focus.width >= 2 && focus.style !== 'none', `${selector} retains its visible keyboard focus ring`);
      };
      for (const { width, locale } of [460, 360].flatMap(width => ['pt-BR', 'en'].map(locale => ({ width, locale })))) {
        await page.setViewportSize({ width, height: 720 });
        await page.goto(`${baseUrl}/?locale=${locale}`);
        await page.locator('#primary-action:not([disabled])').waitFor();
        const dimensions = await page.evaluate(() => {
          const footer = document.querySelector('footer').getBoundingClientRect();
          const main = document.querySelector('main');
          main.scrollTop = 0;
          const selection = document.querySelector('#selection-heading').closest('section').getBoundingClientRect();
          const preview = document.querySelector('#conversion-preview').getBoundingClientRect();
          const stage = document.querySelector('#preview-stage').getBoundingClientRect();
          return { viewport: innerWidth, body: document.body.scrollWidth, footer: footer.bottom, height: innerHeight,
            scrollable: main.scrollHeight > main.clientHeight, selectionHeight: selection.height, previewTop: preview.top,
            visiblePreviewHeight: Math.min(stage.bottom, footer.top) - Math.max(stage.top, main.getBoundingClientRect().top) };
        });
        assert.equal(dimensions.body, width, `${width}px plugin has no page overflow`);
        assert.ok(dimensions.footer <= 720 && dimensions.footer >= 719, 'clipboard actions stay inside viewport');
        assert.ok(dimensions.scrollable, 'content scrolls without moving clipboard actions');
        assert.ok(dimensions.selectionHeight <= 58, `${locale} selection fits a compact status row: ${dimensions.selectionHeight}px`);
        assert.ok(dimensions.previewTop <= 300, `${locale} preview is not buried below introductory content: ${dimensions.previewTop}px`);
        assert.ok(dimensions.visiblePreviewHeight >= 200, `${locale} preview has at least 200px initially visible: ${dimensions.visiblePreviewHeight}px`);
        await page.screenshot({ path: path.join(captures, `plugin-${locale}-${width}x720.png`), animations: 'disabled' });
        const semanticSummary = page.locator('details[aria-labelledby="semantic-title"] > summary');
        await semanticSummary.click();
        assert.equal(await page.locator('#semantic-tag').isVisible(), true);
        await semanticSummary.click();
        await page.locator('#conversion-preview').scrollIntoViewIfNeeded();
        await page.locator('[data-preview-device="mobile"]').click();
        assert.equal(await page.locator('[data-preview-device="mobile"]').getAttribute('aria-pressed'), 'true');
        await page.screenshot({ path: path.join(captures, `plugin-preview-${locale}-${width}x720.png`), animations: 'disabled' });
        await page.evaluate(payload => onmessage({ data: { pluginMessage: { type: 'payload', selectionKey: 'fixture',
          payload: { ...payload, diagnostics: [{ nodeId: '7:1', severity: 'warning', code: 'crop-fallback',
            nodeName: 'QA diagnostic', message: 'Synthetic export failure to test Locate in Figma.' }] } } } }), payload);
        await page.locator('.diagnostic-issue').click();
        await page.waitForFunction(() => document.querySelector('#fixture-status').textContent === 'Located 7:1');
        assert.equal(await page.locator('#fixture-status').textContent(), 'Located 7:1');
        for (const mode of ['pixel', 'safe', 'smart']) await assertFlatMouseTab(`.segment[data-mode="${mode}"]`);
        assert.equal(await page.locator('#conversion-progress').isVisible(), false, 'changing conversion mode hides idle status');
        await page.evaluate(() => onmessage({ data: { pluginMessage: { type: 'progress', selectionKey: 'fixture',
          progress: 25, label: 'QA converting' } } }));
        assert.equal(await page.locator('#conversion-progress').isVisible(), true, 'active conversion status remains visible');
        assert.equal(await page.locator('#conversion-progress').getAttribute('data-loading'), 'true');
        await page.evaluate(() => onmessage({ data: { pluginMessage: { type: 'error', selectionKey: 'fixture',
          message: 'QA export failed: this error must remain visible.' } } }));
        assert.equal(await page.locator('#conversion-progress').isVisible(), true, 'zero-percent error status remains visible');
        assert.equal(await page.locator('#conversion-progress').getAttribute('data-loading'), 'false');
        assert.equal(await page.locator('#progress-summary.error').textContent(), 'QA export failed: this error must remain visible.');
        await page.evaluate(payload => onmessage({ data: { pluginMessage: { type: 'payload', selectionKey: 'fixture', payload } } }), payload);
        for (const device of ['desktop', 'tablet', 'mobile']) await assertFlatMouseTab(`.preview-control[data-preview-device="${device}"]`);
        for (const view of ['converted', 'reference']) await assertFlatMouseTab(`.preview-control[data-preview-view="${view}"]`);
        await page.keyboard.press('Shift+Tab');
        await assertKeyboardTabFocus('.preview-control[data-preview-view="converted"]');
        await page.locator('.segment[data-mode="pixel"]').click();
        await page.keyboard.press('Tab');
        await assertKeyboardTabFocus('.segment[data-mode="safe"]');
        console.log('Visual QA dimensions:', { locale, ...dimensions });
      }
      assert.deepEqual(errors, [], 'UI has no runtime errors');
      console.log('UI captures:', captures);
    } finally {
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
