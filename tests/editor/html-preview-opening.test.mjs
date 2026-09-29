import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Execute the production callbacks rather than a test copy of their branching.
// The editor is intentionally not mounted: its renderer and WordPress runtime
// are independent of the host URL/persistence/window ordering covered here.
const source = await readFile(new URL('../../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('HtmlProjectEditor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
const wanted = new Set(['enterFocusedPreview', 'refreshFocusedPreview', 'copyPurePreviewUrl']);
let sizeRestoreEffect;
const compileCallback = initializer => ts.transpileModule(`const callback = ${initializer.getText(tree)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && wanted.has(node.name.text)) {
    assert.ok(node.initializer && ts.isArrowFunction(node.initializer), `${node.name.text} must remain an executable callback`);
    callbacks.set(node.name.text, compileCallback(node.initializer));
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' && node.arguments[0] && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].getText(tree).includes('workspacePreviewSizeRestoreRef.current')) sizeRestoreEffect = compileCallback(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(callbacks.size, wanted.size, 'all production preview callbacks were found');
assert.ok(sizeRestoreEffect, 'the production size restore effect was found');

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function ref(current) { return { current }; }
function element() {
  return { style: {}, children: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; } };
}

function environment({ host = true, workspaceUrl = '/tools/studio/?view=html&project=project-123&lang=en&kodety-preview-viewport=obsolete#canvas', runtimeRoute = '/wordpress/kodety/editor/?nonce=private&post=7#old', editorUrl = '/fallback/editor/?draft=1', popupBlocked = false, language = 'en-US' } = {}) {
  const events = [];
  const preparation = deferred();
  const save = deferred();
  const reload = deferred();
  const original = { name: 'Original', mainHtmlPath: 'index.html', files: { 'index.html': { content: 'old' } } };
  const canonical = { ...original, name: 'Current canvas', files: { 'index.html': { content: 'latest canvas' } } };
  const metadataViewport = () => ({ viewport: 'base', viewportSizes: { base: { width: 1920, height: 1080 } } });
  let viewportState = metadataViewport();
  const bindings = {
    viewportRef: ref('base'),
    breakpoints: [{ id: 'mobile' }, { id: 'tablet' }],
    projectRef: ref(original),
    workspaceRef: ref(host ? {
      previewUrl: workspaceUrl,
      preparePreview(project) { events.push(['prepare', project]); return preparation.promise; },
      reloadPreview() { events.push(['reload']); return reload.promise; },
    } : undefined),
    topbarWp: { editorUrl },
    studioRuntimeRouteUrl(config, path) { events.push(['wordpress-route', config, path]); return runtimeRoute; },
    materializeCanonicalCanvas() { events.push(['materialize']); bindings.projectRef.current = canonical; },
    saveProjectNow(options) { events.push(['save', options]); return save.promise; },
    focusedPreviewTabRef: ref(null),
    previewReviewWindowRef: ref(null),
    focusedPreviewRouteRef: ref(''),
    focusedPreviewSaveRef: ref(null),
    previewReviewModeRef: ref(true),
    workspacePreviewRefreshRef: ref(null),
    workspacePreviewSizeRestoreRef: ref(null),
    useHtmlViewportStore: { getState: () => viewportState },
    resolveBreakpointSelection: (id, breakpoints) => id === 'base' || breakpoints.some(item => item.id === id) ? id : 'base',
    setViewportSizes(sizes) { events.push(['viewport-sizes', sizes]); viewportState = { ...viewportState, viewportSizes: sizes }; },
    setViewport(viewport) { events.push(['viewport', viewport]); viewportState = { ...viewportState, viewport }; },
    pendingPreviewReviewUrlRef: ref(''),
    appliedPreviewReviewUrlRef: ref(''),
    acceptNextPreviewReviewUrlRef: ref(false),
    openProjectRef: ref((...args) => { events.push(['open-project', ...args]); bindings.projectRef.current = args[0]; viewportState = metadataViewport(); }),
    forceCanonicalCanvasRefresh() { events.push(['canvas-refresh']); },
    setHostedPreviewUrl(url) { events.push(['hosted-url', url]); },
    getAdminUiLocale: () => language,
    toast: { error: (...args) => events.push(['error', ...args]), success: (...args) => events.push(['success', ...args]) },
    navigator: { clipboard: { writeText: async value => { events.push(['clipboard', value]); } } },
    URL,
  };
  const makeTab = () => ({
    closed: false,
    document: { title: '', documentElement: element(), body: element(), createElement: element },
    location: { href: 'about:blank', replace(value) { events.push(['navigate', value]); this.href = value; } },
    focus() { events.push(['focus']); },
    close() { events.push(['close']); this.closed = true; },
  });
  const tab = makeTab();
  bindings.window = {
    location: { origin: 'https://studio.test' },
    opener: { postMessage: (...args) => events.push(['opener-message', ...args]) },
    open: (...args) => { events.push(['popup', ...args]); return popupBlocked ? null : tab; },
  };
  const handlers = Object.fromEntries([...callbacks].map(([name, code]) => [name, new Function(...Object.keys(bindings), `${code}\nreturn callback;`)(...Object.values(bindings))]));
  return {
    ...handlers, bindings, events, tab, makeTab, preparation, save, reload, canonical,
    setViewportState: next => { viewportState = next; },
    runSizeRestore(project = bindings.projectRef.current) { const effectBindings = { ...bindings, project }; new Function(...Object.keys(effectBindings), `${sizeRestoreEffect}\nreturn callback;`)(...Object.values(effectBindings))(); },
    calls: name => events.filter(event => event[0] === name),
  };
}

test('HTML reserves a popup before preparation and opens the exact host project route only after the canonical snapshot is saved', async () => {
  const f = environment();
  f.enterFocusedPreview('mobile');
  assert.deepEqual(f.events.map(event => event[0]), ['materialize', 'popup', 'prepare']);
  assert.deepEqual(f.calls('popup')[0], ['popup', 'about:blank', '_blank']);
  assert.equal(f.calls('prepare')[0][1], f.canonical);
  assert.equal(f.calls('save').length, 0, 'the mandatory host save owns this preview');
  assert.equal(f.calls('wordpress-route').length, 0, 'a host route never resolves through WordPress');
  assert.equal(f.tab.location.href, 'about:blank');
  assert.equal(f.bindings.focusedPreviewSaveRef.current, f.preparation.promise);
  f.preparation.resolve();
  await flush();
  assert.equal(f.calls('navigate').length, 1);
  const url = new URL(f.tab.location.href);
  assert.equal(url.origin, 'https://studio.test');
  assert.equal(url.pathname, '/tools/studio/');
  assert.deepEqual(Object.fromEntries(url.searchParams), { view: 'html', project: 'project-123', lang: 'en', 'kodety-preview-review': '1', 'kodety-preview-viewport': 'mobile' });
  assert.equal(url.hash, '');
  assert.equal(f.bindings.focusedPreviewSaveRef.current, null);
});

test('base and unknown viewports clear stale viewport parameters without dropping host identity', async () => {
  for (const viewport of ['base', 'unknown']) {
    const f = environment();
    f.enterFocusedPreview(viewport);
    f.preparation.resolve();
    await flush();
    const url = new URL(f.tab.location.href);
    assert.equal(url.searchParams.get('project'), 'project-123');
    assert.equal(url.searchParams.has('kodety-preview-viewport'), false);
  }
  const f = environment();
  f.bindings.viewportRef.current = 'tablet';
  f.enterFocusedPreview();
  f.preparation.resolve();
  await flush();
  assert.equal(new URL(f.tab.location.href).searchParams.get('kodety-preview-viewport'), 'tablet');
});

test('a failed HTML folder save closes the reserved shell and never navigates to an older preview', async () => {
  const f = environment();
  f.enterFocusedPreview('mobile');
  f.preparation.reject(new Error('Folder permission denied'));
  await flush();
  assert.equal(f.calls('navigate').length, 0);
  assert.equal(f.calls('save').length, 0);
  assert.equal(f.tab.closed, true);
  assert.equal(f.bindings.focusedPreviewTabRef.current, null);
  assert.equal(f.bindings.previewReviewWindowRef.current, null);
  assert.equal(f.bindings.focusedPreviewRouteRef.current, '');
  assert.equal(f.bindings.focusedPreviewSaveRef.current, null);
  assert.deepEqual(f.calls('error')[0], ['error', 'Could not prepare preview', { description: 'Folder permission denied' }]);
});

test('repeated clicks during preparation reuse the same popup and open the latest requested viewport once', async () => {
  const f = environment();
  f.enterFocusedPreview('mobile');
  f.enterFocusedPreview('tablet');
  assert.equal(f.calls('popup').length, 1);
  assert.equal(f.calls('prepare').length, 1);
  assert.equal(f.calls('navigate').length, 0, 'reuse must not bypass the pending folder save');
  assert.equal(f.calls('focus').length, 1);
  f.preparation.resolve();
  await flush();
  assert.equal(f.calls('navigate').length, 1);
  assert.equal(new URL(f.tab.location.href).searchParams.get('kodety-preview-viewport'), 'tablet');
  f.enterFocusedPreview('tablet');
  assert.equal(f.calls('popup').length, 1);
  assert.equal(f.calls('prepare').length, 1);
  assert.equal(f.calls('navigate').length, 1, 'an already-open review retains its current runtime until explicit refresh');
  assert.equal(f.calls('focus').length, 2);
});

test('a popup blocked by the browser does not start persistence or leave a pending preview', () => {
  const f = environment({ popupBlocked: true });
  f.enterFocusedPreview();
  assert.equal(f.calls('prepare').length, 0);
  assert.equal(f.calls('save').length, 0);
  assert.equal(f.calls('error').length, 1);
  assert.equal(f.bindings.focusedPreviewSaveRef.current, null);
  assert.equal(f.bindings.focusedPreviewTabRef.current, null);
});

test('closed/replaced popup references are not navigated when a pending preparation settles', async () => {
  for (const changed of ['closed', 'replaced']) {
    const f = environment();
    f.enterFocusedPreview();
    if (changed === 'closed') f.tab.closed = true;
    else f.bindings.previewReviewWindowRef.current = f.makeTab();
    f.preparation.resolve();
    await flush();
    assert.equal(f.calls('navigate').length, 0);
    assert.equal(f.calls('error').length, 0);
    assert.equal(f.bindings.focusedPreviewSaveRef.current, null);
  }
});

test('a rejected preparation from an earlier closed tab cannot clear the route of its replacement tab', async () => {
  const f = environment();
  f.enterFocusedPreview('mobile');
  f.tab.closed = true;
  const replacement = f.makeTab();
  const nextPreparation = deferred();
  f.bindings.window.open = (...args) => { f.events.push(['popup', ...args]); return replacement; };
  f.bindings.workspaceRef.current.preparePreview = project => { f.events.push(['prepare', project]); return nextPreparation.promise; };
  f.enterFocusedPreview('tablet');
  const replacementRoute = f.bindings.focusedPreviewRouteRef.current;
  f.preparation.reject(new Error('Earlier save failed'));
  await flush();
  assert.equal(f.bindings.focusedPreviewRouteRef.current, replacementRoute);
  assert.equal(f.bindings.focusedPreviewTabRef.current, replacement);
  assert.equal(f.bindings.previewReviewWindowRef.current, replacement);
  assert.equal(f.bindings.focusedPreviewSaveRef.current, nextPreparation.promise);
  assert.equal(f.calls('error').length, 0, 'an obsolete request must not report failure for the current preview');
  nextPreparation.resolve();
  await flush();
  assert.equal(replacement.location.href, replacementRoute);
  assert.equal(new URL(replacement.location.href).searchParams.get('kodety-preview-viewport'), 'tablet');
  assert.equal(f.calls('navigate').length, 1);
  assert.equal(f.bindings.focusedPreviewSaveRef.current, null);
});

test('an existing tab navigated away by authored content can be focused without reading or replacing its foreign document', () => {
  const f = environment();
  Object.defineProperty(f.tab, 'location', { get() { throw new Error('Cross-origin access blocked'); } });
  f.bindings.focusedPreviewTabRef.current = f.tab;
  assert.doesNotThrow(() => f.enterFocusedPreview());
  assert.equal(f.calls('focus').length, 1);
  assert.equal(f.calls('popup').length, 0);
  assert.equal(f.calls('prepare').length, 0);
});

test('native WordPress keeps its runtime route and silent save behavior on both save success and rejection', async () => {
  for (const fails of [false, true]) {
    const f = environment({ host: false });
    f.enterFocusedPreview('mobile');
    assert.deepEqual(f.calls('wordpress-route')[0], ['wordpress-route', f.bindings.topbarWp, '/kodety/editor/']);
    assert.deepEqual(f.calls('save')[0], ['save', { notifySuccess: false }]);
    assert.equal(f.calls('prepare').length, 0);
    assert.equal(f.calls('navigate').length, 0);
    if (fails) f.save.reject(new Error('Existing WordPress save failure'));
    else f.save.resolve();
    await flush();
    const url = new URL(f.tab.location.href);
    assert.equal(url.pathname, '/wordpress/kodety/editor/');
    assert.deepEqual(Object.fromEntries(url.searchParams), { 'kodety-preview-review': '1', 'kodety-preview-viewport': 'mobile' });
    assert.equal(url.hash, '');
    assert.equal(f.calls('navigate').length, 1, 'native WordPress retains its established save-failure fallback');
    assert.equal(f.tab.closed, false);
    assert.equal(f.calls('error').length, 0, 'the native save handler owns its error reporting');
    assert.equal(f.bindings.focusedPreviewSaveRef.current, null);
  }
});

test('native WordPress falls back to configured editor URL and then the existing default route', async () => {
  for (const [editorUrl, pathname] of [['/custom/editor/?private=1', '/custom/editor/'], ['', '/kodety/editor/']]) {
    const f = environment({ host: false, runtimeRoute: '', editorUrl });
    f.enterFocusedPreview();
    f.save.resolve();
    await flush();
    const url = new URL(f.tab.location.href);
    assert.equal(url.pathname, pathname);
    assert.equal(url.search, '?kodety-preview-review=1');
  }
});

test('HTML refresh coalesces clicks, loads the saved host snapshot, keeps the selected page and then restarts its canvas', async () => {
  const f = environment();
  f.bindings.projectRef.current = { ...f.canonical, mainHtmlPath: 'about.html' };
  const oldProject = f.bindings.projectRef.current;
  const sizes = { base: { width: 1920, height: 1080 }, tablet: { width: 800, height: 900 } };
  f.setViewportState({ viewport: 'tablet', viewportSizes: sizes });
  f.refreshFocusedPreview();
  f.refreshFocusedPreview();
  assert.equal(f.calls('reload').length, 1);
  assert.equal(f.calls('canvas-refresh').length, 0);
  const next = { name: 'New snapshot', mainHtmlPath: 'index.html', files: { 'index.html': {}, 'about.html': {} } };
  f.reload.resolve(next);
  await flush();
  assert.deepEqual(f.calls('open-project')[0], ['open-project', { ...next, mainHtmlPath: 'about.html' }, null, false, null, true]);
  assert.deepEqual(f.events.map(event => event[0]), ['reload', 'open-project', 'canvas-refresh']);
  assert.equal(f.calls('save').length, 0);
  assert.equal(f.calls('prepare').length, 0);
  assert.equal(f.calls('opener-message').length, 0);
  assert.equal(f.bindings.workspacePreviewRefreshRef.current, null);
  assert.deepEqual(f.bindings.workspacePreviewSizeRestoreRef.current, { project: f.bindings.projectRef.current, viewport: 'tablet', sizes });
  assert.notEqual(f.bindings.workspacePreviewSizeRestoreRef.current.project, oldProject);
  assert.equal(f.bindings.workspacePreviewSizeRestoreRef.current.project, f.calls('open-project')[0][1]);
  assert.equal(f.bindings.workspacePreviewSizeRestoreRef.current.sizes, sizes, 'capture the visitor sizes before openProject reapplies metadata');
});

test('HTML restores the visitor width after metadata only for the matching loaded project, then consumes the restore once', async () => {
  const f = environment();
  const oldProject = f.bindings.projectRef.current;
  const sizes = { base: { width: 800, height: 900 } };
  f.setViewportState({ viewport: 'base', viewportSizes: sizes });
  f.refreshFocusedPreview();
  f.reload.resolve({ name: 'Latest source', mainHtmlPath: 'index.html', files: { 'index.html': {} } });
  await flush();
  assert.equal(f.bindings.useHtmlViewportStore.getState().viewportSizes.base.width, 1920, 'fixture reproduces openProject applying authored breakpoint metadata');
  f.runSizeRestore(oldProject);
  assert.equal(f.calls('viewport-sizes').length, 0, 'the previous render must not consume a new project restore');
  assert.ok(f.bindings.workspacePreviewSizeRestoreRef.current);
  f.runSizeRestore();
  assert.equal(f.bindings.useHtmlViewportStore.getState().viewportSizes.base.width, 800);
  assert.equal(f.bindings.viewportRef.current, 'base');
  assert.equal(f.bindings.workspacePreviewSizeRestoreRef.current, null);
  f.runSizeRestore();
  assert.equal(f.calls('viewport-sizes').length, 1);
});

test('HTML refresh selects a valid fallback for a deleted page and preserves the current canvas when loading fails', async () => {
  const f = environment();
  f.bindings.projectRef.current.mainHtmlPath = 'deleted.html';
  f.refreshFocusedPreview();
  const next = { name: 'Snapshot', mainHtmlPath: 'index.html', files: { 'index.html': {} } };
  f.reload.resolve(next);
  await flush();
  assert.equal(f.calls('open-project')[0][1].mainHtmlPath, 'index.html');
  const broken = environment();
  const before = broken.bindings.projectRef.current;
  broken.refreshFocusedPreview();
  broken.reload.reject(new Error('Snapshot unavailable'));
  await flush();
  assert.equal(broken.bindings.projectRef.current, before);
  assert.equal(broken.calls('canvas-refresh').length, 0);
  assert.equal(broken.calls('open-project').length, 0);
  assert.deepEqual(broken.calls('error')[0], ['error', 'Could not refresh preview', { description: 'Snapshot unavailable' }]);
  assert.equal(broken.bindings.workspacePreviewRefreshRef.current, null);
  assert.equal(broken.bindings.workspacePreviewSizeRestoreRef.current, null);
});

test('native WordPress refresh still applies pending hosted URLs or asks its opener for a refreshed URL', () => {
  const pending = environment({ host: false });
  pending.bindings.pendingPreviewReviewUrlRef.current = 'https://site.test/published-preview/';
  pending.refreshFocusedPreview();
  assert.deepEqual(pending.events, [['canvas-refresh'], ['hosted-url', 'https://site.test/published-preview/']]);
  assert.equal(pending.bindings.pendingPreviewReviewUrlRef.current, '');
  assert.equal(pending.bindings.appliedPreviewReviewUrlRef.current, 'https://site.test/published-preview/');
  const f = environment({ host: false });
  f.refreshFocusedPreview();
  assert.deepEqual(f.events, [['canvas-refresh'], ['opener-message', { source: 'kodety-preview-review', type: 'refresh' }, '*']]);
  assert.equal(f.bindings.acceptNextPreviewReviewUrlRef.current, true);
  assert.equal(f.bindings.workspacePreviewSizeRestoreRef.current, null, 'native WordPress never enters the host viewport restore flow');
});

test('copy preview preserves the HTML host identity and subdirectory while native WordPress continues discarding runtime query state', async () => {
  for (const host of [true, false]) {
    const f = environment({ host });
    f.copyPurePreviewUrl();
    await flush();
    const url = new URL(f.calls('clipboard')[0][1]);
    assert.equal(url.pathname, host ? '/tools/studio/' : '/wordpress/kodety/editor/');
    assert.equal(url.searchParams.get('kodety-preview-review'), '1');
    assert.equal(url.searchParams.get('project'), host ? 'project-123' : null);
    assert.equal(url.searchParams.get('lang'), host ? 'en' : null);
    assert.equal(url.searchParams.has('nonce'), false);
    assert.equal(url.hash, '');
    assert.equal(f.calls('popup').length, 0);
    assert.equal(f.calls('success').length, 1);
  }
});
