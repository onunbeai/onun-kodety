import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Execute the production host callbacks together with the real Settings leave
// callbacks. A pending draft is intentionally absent from the editor project
// until Settings receives its save ACK, reproducing a click before autosave.
async function readCallbacks(file, wanted) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && wanted.includes(node.name.text)) {
      const callback = node.initializer && ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      assert.ok(callback && ts.isArrowFunction(callback), `${node.name.text} must be a callable production implementation`);
      found.set(node.name.text, ts.transpileModule(`const callback = ${callback.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(found.size, wanted.length);
  return { found, tree };
}
const workspace = await readCallbacks('../src/html-workspace.tsx', ['flush', 'navigateAway', 'navigateView', 'close', 'openIntegrationSettings', 'downloadBackup', 'confirmExit', 'exportSnapshot', 'needsBackup', 'beforeUnload', 'background', 'saveBeforeBackground', 'draftChanged', 'exportSiteZip']);
const settings = await readCallbacks('../../../app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx', ['flushSettingsBeforeLeave', 'prepareSettingsLeave', 'beforeSettingsUnload']);
const editor = await readCallbacks('../../../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx', ['saveProjectNow', 'openHtmlPage']);
const registrySource = await readFile(new URL('../../../lib/html-editor/workspace-navigation.ts', import.meta.url), 'utf8');
const registryCode = ts.transpileModule(registrySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const registry = {};
new Function('exports', registryCode)(registry);
const instantiate = (map, name, bindings) => new Function('bindings', `with (bindings) { ${map.get(name)} return callback; }`)(bindings);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const ref = current => ({ current });

function environment({ invalid = false, folderFailure = false } = {}) {
  const events = [];
  const settingsAck = deferred();
  const folderAck = deferred();
  const current = ref({ title: 'Old saved title', files: {} });
  const draft = { title: 'Latest Settings title' };
  const settingsEnv = {
    cancelScheduledAutosave: () => events.push('cancel-debounce'),
    waitForSaveQueue: async () => events.push('drain-settings-queue'),
    settingsLeaveDraftRef: ref({ siteDraft: draft, siteDraftSignature: 'new', siteSaveError: invalid ? 'Invalid setting' : '', cookieConsentDraftSignature: 'saved', customCodeDraftSignature: 'saved', redirectDraftSignature: 'saved', selectedPage: '' }),
    isSiteSavedSignature: value => value !== 'new', isCookieConsentSavedSignature: () => true,
    isCustomCodeSavedSignature: () => true, isRedirectSavedSignature: () => true, isPageSavedSignature: () => true,
    onSaveSite: async value => { events.push(['settings-save', value]); await settingsAck.promise; current.current = { ...current.current, ...value }; settingsEnv.settingsLeaveDraftRef.current.siteDraftSignature = 'saved'; events.push('settings-commit'); },
    leavePreparationPromiseRef: ref(null), leavingSettingsRef: ref(false), setLeavingSettings: value => events.push(['settings-leaving', value]),
    toast: { error: (...args) => events.push(['settings-error', ...args]) },
  };
  settingsEnv.flushSettingsBeforeLeave = instantiate(settings.found, 'flushSettingsBeforeLeave', settingsEnv);
  settingsEnv.prepareSettingsLeave = instantiate(settings.found, 'prepareSettingsLeave', settingsEnv);
  const unregister = registry.registerWorkspaceNavigationGuard(settingsEnv.prepareSettingsLeave);
  const hostEnv = {
    navigation: ref(null), backgroundSave: ref(null), leaving: ref(false), viewRef: ref('settings'), dirty: ref(false),
    api: ref({ getProject: () => current.current }), latest: current,
    saveProject: async snapshot => { events.push(['folder-save', snapshot.title]); if (folderFailure) throw new Error('Folder revoked'); await folderAck.promise; },
    session: ref({ flush: async () => events.push('folder-ack') }), canonicalProjectForTransport: value => value,
    runWorkspaceNavigationGuards: registry.runWorkspaceNavigationGuards, cancelWorkspaceNavigation: () => events.push('navigation-cancelled'),
    setBusy: value => events.push(['busy', value]), setError: value => events.push(['error', value]), pt: false,
    setView: value => events.push(['view', value]), callbacks: ref({ onBack: () => events.push('library') }),
    browserStored: false, cloudStored: false, cloudSession: ref(null), cloudNotifications: ref(null), backupRevision: ref(0),
    setConfirmingExit: value => events.push(['exit-dialog', value]),
    setExitBusy: value => events.push(['exit-busy', value]), setExitError: value => events.push(['exit-error', value]),
  };
  for (const name of ['flush', 'navigateAway', 'navigateView', 'close']) hostEnv[name] = instantiate(workspace.found, name, hostEnv);
  return { events, settingsAck, folderAck, hostEnv, settingsEnv, unregister };
}

test('a backup releases Settings even when its draft was prepared by an earlier navigation', async () => {
  const env = environment();
  try {
    const prepared = env.settingsEnv.prepareSettingsLeave();
    env.settingsAck.resolve();
    assert.equal(await prepared, true);
    assert.equal(env.settingsEnv.leavingSettingsRef.current, true);
    assert.equal(await env.settingsEnv.prepareSettingsLeave('backup'), true);
    assert.equal(env.settingsEnv.leavingSettingsRef.current, false);
    assert.equal(env.settingsEnv.leavePreparationPromiseRef.current, null);
  } finally { env.unregister(); }
});

test('native document navigation protects Settings drafts and queues until real acknowledgements', () => {
  const f = environment();
  try {
    const bindings = { ...f.settingsEnv, activeSavePromiseRef: ref(null), saveQueueRef: ref([]) };
    const listener = instantiate(settings.found, 'beforeSettingsUnload', bindings);
    const warns = () => { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; listener(event); return event.defaultPrevented; };
    assert.equal(warns(), true, 'A draft that has not reached autosave must warn');
    bindings.settingsLeaveDraftRef.current.siteDraftSignature = 'saved';
    assert.equal(warns(), false, 'A synchronous ACK clears protection before React paints');
    bindings.activeSavePromiseRef.current = Promise.resolve();
    assert.equal(warns(), true, 'A pending save still protects the document');
    bindings.activeSavePromiseRef.current = null;
    bindings.saveQueueRef.current.push({}); assert.equal(warns(), true);
    bindings.saveQueueRef.current.length = 0; assert.equal(warns(), false);
    bindings.settingsLeaveDraftRef.current.selectedPage = 'index.html';
    bindings.isPageSavedSignature = () => false;
    assert.equal(warns(), true, 'Page-specific drafts use their own acknowledgement');
  } finally { f.unregister(); }
});

test('Design navigation commits pending Settings draft, then waits for folder ACK before unmount', async () => {
  const env = environment();
  try {
    const result = env.hostEnv.navigateView('editor');
    await tick();
    assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'view'), false);
    assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'folder-save'), false);
    env.settingsAck.resolve();
    await tick();
    assert.deepEqual(env.events.find(event => Array.isArray(event) && event[0] === 'folder-save'), ['folder-save', 'Latest Settings title']);
    assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'view'), false);
    env.folderAck.resolve();
    assert.equal(await result, true);
    assert.ok(env.events.indexOf('folder-ack') < env.events.findIndex(event => Array.isArray(event) && event[0] === 'view'));
    assert.deepEqual(env.events.at(-2), ['view', 'editor']);
  } finally { env.unregister(); }
});

test('return to library uses the same Settings barrier; already-prepared Settings navigation does not recurse', async () => {
  const env = environment();
  try {
    // Settings Back calls its own prepare first, then the host navigation.
    const prepared = env.settingsEnv.prepareSettingsLeave();
    env.settingsAck.resolve();
    assert.equal(await prepared, true);
    env.hostEnv.close();
    await tick();
    assert.equal(env.events.includes('library'), false);
    env.folderAck.resolve();
    assert.equal(await env.hostEnv.navigation.current, true);
    assert.ok(env.events.includes('library'));
    assert.equal(env.events.filter(event => Array.isArray(event) && event[0] === 'settings-save').length, 1);
  } finally { env.unregister(); }
});

test('invalid Settings drafts or failed filesystem writes keep the current view open', async () => {
  for (const options of [{ invalid: true }, { folderFailure: true }]) {
    const env = environment(options);
    try {
      const result = env.hostEnv.navigateView('localization');
      env.settingsAck.resolve(); env.folderAck.resolve();
      assert.equal(await result, false);
      assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'view'), false);
      assert.equal(env.hostEnv.viewRef.current, 'settings');
      assert.deepEqual(env.events.at(-1), ['busy', false]);
    } finally { env.unregister(); }
  }
});

function cloudEnvironment(options = {}) {
  const env = environment(options);
  const remoteAck = deferred();
  let status = options.status || 'pending';
  Object.assign(env.hostEnv, {
    cloudStored: true, needsBackup: () => false, document: { visibilityState: 'hidden' },
  });
  env.hostEnv.cloudSession.current = {
    getSnapshot: () => ({ status }),
    async sync() {
      env.events.push('cloud-start'); await remoteAck.promise;
      if (options.cloudFailure) { status = 'error'; throw new Error('Cloud offline'); }
      status = 'saved'; env.events.push('cloud-ack');
    },
  };
  env.hostEnv.cloudNotifications.current = { beginSave() {
    env.events.push('feedback-start');
    return { success: () => env.events.push('feedback-success'), cancel: () => env.events.push('feedback-cancel'), failure: () => env.events.push('feedback-error') };
  } };
  for (const name of ['saveBeforeBackground', 'beforeUnload', 'background']) env.hostEnv[name] = instantiate(workspace.found, name, env.hostEnv);
  return { ...env, remoteAck };
}

test('cloud page/area navigation waits for the local draft and remote ACK, and refuses an unconfirmed transition', async () => {
  for (const cloudFailure of [false, true]) {
    const env = cloudEnvironment({ cloudFailure });
    try {
      const pending = env.hostEnv.navigateView('editor');
      env.settingsAck.resolve(); env.folderAck.resolve(); await tick();
      assert.ok(env.events.indexOf('folder-ack') < env.events.indexOf('cloud-start'));
      assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'view'), false);
      env.remoteAck.resolve();
      assert.equal(await pending, !cloudFailure);
      assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'view'), !cloudFailure);
      if (cloudFailure) {
        assert.ok(env.events.includes('navigation-cancelled'));
        assert.ok(env.events.includes('feedback-error'));
        assert.equal(env.events.includes('feedback-success'), false);
      } else {
        assert.ok(env.events.indexOf('cloud-ack') < env.events.indexOf('feedback-success'));
        assert.ok(env.events.indexOf('feedback-success') < env.events.findIndex(event => Array.isArray(event) && event[0] === 'view'));
      }
    } finally { env.unregister(); }
  }
});

test('a failed cloud library exit retains the project and offers its recovery choices', async () => {
  const env = cloudEnvironment({ cloudFailure: true });
  try {
    env.hostEnv.close(); const pending = env.hostEnv.navigation.current;
    env.settingsAck.resolve(); env.folderAck.resolve(); env.remoteAck.resolve();
    assert.equal(await pending, false);
    assert.equal(env.events.includes('library'), false);
    assert.ok(env.events.some(event => Array.isArray(event) && event[0] === 'exit-dialog' && event[1]));
  } finally { env.unregister(); }
});

test('closing a cloud tab protects pending changes synchronously and attempts Settings, local, then cloud save', async () => {
  const env = cloudEnvironment();
  try {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    env.hostEnv.beforeUnload(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.returnValue, '');
    const attempt = env.hostEnv.backgroundSave.current;
    assert.equal(env.hostEnv.saveBeforeBackground(), attempt, 'Repeated close/background events coalesce');
    await tick();
    assert.equal(env.events.includes('cloud-start'), false);
    env.settingsAck.resolve(); await tick();
    assert.deepEqual(env.events.find(event => Array.isArray(event) && event[0] === 'folder-save'), ['folder-save', 'Latest Settings title']);
    assert.equal(env.events.includes('cloud-start'), false);
    env.folderAck.resolve(); await tick();
    assert.ok(env.events.includes('cloud-start'));
    env.remoteAck.resolve(); await attempt;
    assert.equal(env.settingsEnv.leavingSettingsRef.current, false);
    assert.ok(env.events.includes('navigation-cancelled'));
    const saved = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    env.hostEnv.beforeUnload(saved);
    assert.equal(saved.defaultPrevented, false, 'An acknowledged cloud project does not get a host unload warning');
    await env.hostEnv.backgroundSave.current;
  } finally { env.unregister(); }
});

test('a saved editor still flushes a Settings-only draft on background/close, with native protection in either listener order', async () => {
  for (const hostFirst of [false, true]) {
    const env = cloudEnvironment({ status: 'saved' });
    try {
      const beforeSettingsUnload = instantiate(settings.found, 'beforeSettingsUnload', { ...env.settingsEnv, activeSavePromiseRef: ref(null), saveQueueRef: ref([]) });
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const listener of hostFirst ? [env.hostEnv.beforeUnload, beforeSettingsUnload] : [beforeSettingsUnload, env.hostEnv.beforeUnload]) listener(event);
      assert.equal(event.defaultPrevented, true);
      const attempt = env.hostEnv.backgroundSave.current;
      env.hostEnv.background(); assert.equal(env.hostEnv.backgroundSave.current, attempt);
      env.settingsAck.resolve(); env.folderAck.resolve(); env.remoteAck.resolve(); await attempt;
      assert.ok(env.events.includes('settings-commit'));
      assert.ok(env.events.includes('cloud-ack'));
      assert.equal(env.settingsEnv.leavingSettingsRef.current, false);
    } finally { env.unregister(); }
  }
});

test('invalid background drafts stay editable and real navigation waits for an in-flight background flush', async () => {
  const invalid = cloudEnvironment({ invalid: true, status: 'saved' });
  try {
    await invalid.hostEnv.saveBeforeBackground();
    assert.equal(invalid.events.includes('cloud-start'), false);
    assert.equal(invalid.settingsEnv.leavingSettingsRef.current, false);
    assert.ok(invalid.events.includes('navigation-cancelled'));
  } finally { invalid.unregister(); }
  const env = cloudEnvironment();
  try {
    const attempt = env.hostEnv.saveBeforeBackground();
    const navigation = env.hostEnv.navigateView('editor');
    env.settingsAck.resolve(); env.folderAck.resolve(); await tick();
    assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'view'), false);
    env.remoteAck.resolve(); await attempt;
    assert.equal(await navigation, true);
    assert.equal(env.events.filter(event => Array.isArray(event) && event[0] === 'settings-save').length, 1);
    assert.ok(env.events.indexOf('navigation-cancelled') < env.events.findIndex(event => Array.isArray(event) && event[0] === 'view'));
  } finally { env.unregister(); }
});

test('repeat clicks share one save and same-view navigation preserves mounted Settings drafts', async () => {
  const env = environment();
  try {
    assert.equal(await env.hostEnv.navigateView('settings'), true);
    assert.deepEqual(env.events, []);
    const one = env.hostEnv.navigateView('editor');
    const two = env.hostEnv.navigateView('editor');
    assert.equal(one, two);
    env.settingsAck.resolve(); env.folderAck.resolve();
    assert.equal(await one, true);
    assert.equal(env.events.filter(event => Array.isArray(event) && event[0] === 'folder-save').length, 1);
  } finally { env.unregister(); }
});

test('shared topbar and onboarding both bind the guarded production view callback', () => {
  let hostBinding = false, guideBinding = false, pageBinding = false;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(workspace.tree) === 'onNavigateView') hostBinding ||= node.initializer.getText(workspace.tree) === 'navigateView';
    if (ts.isPropertyAssignment(node) && node.name.getText(workspace.tree) === 'onNavigate') guideBinding ||= /return navigateView\(/.test(node.initializer.getText(workspace.tree));
    if (ts.isPropertyAssignment(node) && node.name.getText(workspace.tree) === 'beforeNavigatePage') pageBinding ||= /cloudStored \? \(\) => navigateAway\('page'/.test(node.initializer.getText(workspace.tree));
    ts.forEachChild(node, visit);
  }
  visit(workspace.tree);
  assert.ok(hostBinding); assert.ok(guideBinding); assert.ok(pageBinding);
});

test('explicit editor Save forces cloud synchronization and reports success only after its ACK', async () => {
  for (const failure of [false, true]) {
    const events = [], remote = deferred();
    const bindings = {
      sharedReadOnly: false, projectRef: ref({ files: {} }), isWordPressRuntime: false,
      persistLocalProjectSnapshot: async () => { events.push('local-ack'); return 123; },
      workspaceRef: ref({ storageMode: 'cloud', syncProject: async () => { events.push('cloud-start'); await remote.promise; if (failure) throw new Error('Offline'); events.push('cloud-ack'); } }),
      setSavedAt: value => events.push(['saved-at', value]),
      toast: { success: (...args) => events.push(['success', ...args]), error: (...args) => events.push(['error', ...args]) },
      downloadUnsavedRecoveryZip: () => events.push('recovery'),
    };
    const save = instantiate(editor.found, 'saveProjectNow', bindings)();
    await tick(); assert.deepEqual(events, ['local-ack', 'cloud-start']);
    remote.resolve(); await save;
    assert.equal(events.some(event => Array.isArray(event) && event[0] === 'success'), !failure);
    assert.equal(events.some(event => Array.isArray(event) && event[0] === 'error'), failure);
    if (failure) { events.find(event => Array.isArray(event) && event[0] === 'error')[2].action.onClick(); assert.equal(events.at(-1), 'recovery'); }
  }
});

test('the editor keeps the previous HTML page mounted until its cloud navigation barrier confirms', async () => {
  for (const allowed of [true, false]) {
    const events = [], barrier = deferred(), frames = [], timers = [];
    const project = { mainHtmlPath: 'index.html', rootPath: '', files: { 'index.html': { text: '<main>Home</main>' }, 'about.html': { text: '<main>About</main>' } } };
    const bindings = {
      projectRef: ref(project), isPreviewingRef: ref(false), sharedReadOnly: false, pendingPagePathRef: ref(null),
      pageNavigationSequenceRef: ref(0), pageNavigationFrameRef: ref(null), pageNavigationTimerRef: ref(null),
      workspaceRef: ref({ beforeNavigatePage: () => { events.push('guard'); return barrier.promise; } }),
      cancelScheduledPageNavigation: () => undefined,
      clearPendingPageNavigation: path => events.push(['cancel', path]),
      clearCanvasSelectionForSurfaceChange: () => undefined, setCodeFilePath: () => undefined,
      setShowCode: () => undefined, setPendingPagePath: () => undefined, iframeRef: ref(null), toast: { info: () => undefined },
      activeExperimentEditSession: () => null, readEditorMetadata: () => ({}),
      commitProject: next => { bindings.projectRef.current = next; events.push(['commit', next.mainHtmlPath]); },
      window: { requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, setTimeout: callback => { timers.push(callback); return timers.length; } },
    };
    instantiate(editor.found, 'openHtmlPage', bindings)('about.html'); frames[0]();
    const pending = timers[0](); await tick();
    assert.equal(bindings.projectRef.current.mainHtmlPath, 'index.html');
    assert.deepEqual(events, ['guard']); barrier.resolve(allowed); await pending;
    assert.equal(bindings.projectRef.current.mainHtmlPath, allowed ? 'about.html' : 'index.html');
    assert.deepEqual(events.at(-1), allowed ? ['commit', 'about.html'] : ['cancel', 'about.html']);
  }
});

test('HTML MCP launcher opens native integrations only after the project save succeeds', async () => {
  for (const folderFailure of [false, true]) {
    const env = environment({ folderFailure });
    try {
      env.hostEnv.viewRef.current = 'editor';
      env.hostEnv.window = {
        location: { href: 'https://studio.test/?project=123' },
        history: { state: null, replaceState(_state, _title, url) { env.events.push(['url', url.href]); } },
      };
      env.hostEnv.useHtmlProjectSettingsStore = { getState: () => ({ open: section => env.events.push(['section', section]) }) };
      const open = instantiate(workspace.found, 'openIntegrationSettings', env.hostEnv);
      open('mcp');
      await tick();
      assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'section'), false);
      env.settingsAck.resolve();
      await tick();
      assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'url'), false);
      env.folderAck.resolve();
      await env.hostEnv.navigation.current;
      assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'section'), !folderFailure);
      if (!folderFailure) {
        assert.ok(env.events.some(event => Array.isArray(event) && event[0] === 'url' && event[1] === 'https://studio.test/?project=123&section=mcp'));
        assert.equal(env.hostEnv.viewRef.current, 'settings');
      } else assert.equal(env.hostEnv.viewRef.current, 'editor');
    } finally { env.unregister(); }
  }
});

const sidebarSource = await readFile(new URL('../../../app/(builder)/kodety/html-editor/components/HtmlEditorLeftSidebar.tsx', import.meta.url), 'utf8');
const sidebarCode = ts.transpileModule(sidebarSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const sidebarExports = {};
new Function('require', 'exports', sidebarCode)(name => {
  if (name === 'react') return { memo: value => value };
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  if (name.endsWith('/utils')) return { cn: (...values) => values.filter(Boolean).join(' ') };
  if (name.endsWith('/admin-ui-locale')) return { getAdminUiLocale: () => 'pt' };
  if (name.endsWith('/editor-constants')) return { SIDEBAR_LIMITS: { left: { min: 200, max: 500 } }, SIDEBAR_RAIL_BUTTON_CLASS: 'shared-rail-button' };
  if (name.endsWith('/useHtmlEditorChromeStore')) return { useHtmlEditorChromeStore: selector => selector({}) };
  return new Proxy({}, { get: (_target, key) => key });
}, sidebarExports);
function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
}
function sidebar(props = {}) {
  return descendants(sidebarExports.HtmlEditorLeftSidebar({ mcpConnected: false, mcpActivityLabel: 'MCP desativado', mcpTargetName: 'Projeto HTML', navigatorProps: {}, ...props }));
}
test('the shared MCP menu works in HTML without WordPress URLs and preserves WordPress save navigation', () => {
  const events = [];
  const html = sidebar({ onOpenMcpSettings: () => events.push('native-mcp') });
  assert.equal(html.filter(node => node.props?.['data-mcp-state'] === 'disconnected').length, 1);
  const actions = html.filter(node => node.type === 'a' && node.props?.href === '#mcp');
  assert.equal(actions.length, 2);
  for (const action of actions) action.props.onClick({ preventDefault: () => events.push('prevented'), currentTarget: { href: 'https://studio.test/#mcp' } });
  assert.deepEqual(events, ['prevented', 'native-mcp', 'prevented', 'native-mcp']);
  const wordpress = sidebar({ topbarWp: { mcpAdminUrl: '/wp-admin/mcp', mcpSettingsUrl: '/kodety/settings?section=mcp' }, mcpConnected: true, interceptSavedNavigation: (_event, href) => events.push(href) });
  assert.equal(wordpress.filter(node => node.props?.['data-mcp-state'] === 'connected').length, 1);
  const wpAction = wordpress.find(node => node.type === 'a' && node.props?.href === '/kodety/settings?section=mcp');
  wpAction.props.onClick({ currentTarget: { href: 'https://wp.test/kodety/settings?section=mcp' } });
  assert.equal(events.at(-1), 'https://wp.test/kodety/settings?section=mcp');
  assert.equal(sidebar().some(node => node.props?.['data-mcp-state']), false);
});

test('manual browser backup saves pending Settings and waits for project persistence before exporting the editable ZIP', async () => {
  const env = environment();
  try {
    env.hostEnv.exportSnapshot = async value => env.events.push(['backup', value.title]);
    const backup = instantiate(workspace.found, 'downloadBackup', env.hostEnv)();
    await tick();
    assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'backup'), false);
    env.settingsAck.resolve(); await tick();
    assert.deepEqual(env.events.find(event => Array.isArray(event) && event[0] === 'folder-save'), ['folder-save', 'Latest Settings title']);
    assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'backup'), false);
    env.folderAck.resolve(); await backup;
    assert.deepEqual(env.events.find(event => Array.isArray(event) && event[0] === 'backup'), ['backup', 'Latest Settings title']);
    assert.ok(env.events.indexOf('folder-ack') < env.events.findIndex(event => Array.isArray(event) && event[0] === 'backup'));
    assert.equal(env.settingsEnv.leavingSettingsRef.current, false, 'Backup must leave Settings editable');
  } finally { env.unregister(); }
});

test('a failed browser-storage save reports its error instead of presenting an older backup as current', async () => {
  const env = environment({ folderFailure: true });
  try {
    env.hostEnv.exportSnapshot = async () => assert.fail('A failed save cannot silently export an outdated project');
    const backup = instantiate(workspace.found, 'downloadBackup', env.hostEnv)();
    env.settingsAck.resolve(); await backup;
    assert.ok(env.events.some(event => Array.isArray(event) && event[0] === 'error' && event[1] === 'Folder revoked'));
  } finally { env.unregister(); }
});

test('Back offers manual-backup choices before saving or leaving the browser project', () => {
  const env = environment();
  try {
    env.hostEnv.browserStored = true;
    env.hostEnv.close();
    assert.deepEqual(env.events, [['exit-error', ''], ['exit-dialog', true]]);
    assert.equal(env.hostEnv.navigation.current, null);
  } finally { env.unregister(); }
});

test('download and leave waits for Settings, browser persistence, and ZIP initiation in order', async () => {
  const env = environment();
  const zipAck = deferred();
  try {
    env.hostEnv.needsBackup = () => false;
    env.hostEnv.exportSnapshot = async (snapshot, revision) => {
      env.events.push(['zip-start', snapshot.title, revision]);
      await zipAck.promise;
      env.events.push('zip-download-initiated');
    };
    const confirm = instantiate(workspace.found, 'confirmExit', env.hostEnv);
    const result = confirm(true);
    assert.equal(confirm(true), result, 'Repeat clicks must share one exit operation');
    await tick();
    assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'zip-start'), false);
    env.settingsAck.resolve(); await tick();
    assert.equal(env.events.includes('library'), false);
    env.folderAck.resolve(); await tick();
    assert.deepEqual(env.events.find(event => Array.isArray(event) && event[0] === 'zip-start'), ['zip-start', 'Latest Settings title', 0]);
    assert.equal(env.events.includes('library'), false);
    zipAck.resolve();
    assert.equal(await result, true);
    assert.ok(env.events.indexOf('folder-ack') < env.events.indexOf('zip-download-initiated'));
    assert.ok(env.events.indexOf('zip-download-initiated') < env.events.indexOf('library'));
  } finally { env.unregister(); }
});

test('Settings, persistence, and ZIP failures keep the exit dialog and project open', async () => {
  for (const options of [{ invalid: true }, { folderFailure: true }, { zipFailure: true }, { concurrentEdit: true }]) {
    const env = environment(options);
    try {
      env.hostEnv.needsBackup = () => !!options.concurrentEdit;
      env.hostEnv.exportSnapshot = async () => { if (options.zipFailure) throw new Error('ZIP failed'); };
      const pending = instantiate(workspace.found, 'confirmExit', env.hostEnv)(true);
      env.settingsAck.resolve(); env.folderAck.resolve();
      assert.equal(await pending, false);
      assert.equal(env.events.includes('library'), false);
      assert.equal(env.hostEnv.leaving.current, false, 'A failed exit must retain native unload protection');
      assert.equal(env.events.some(event => Array.isArray(event) && event[0] === 'exit-dialog' && event[1] === false), false);
      assert.ok(env.events.some(event => Array.isArray(event) && event[0] === 'exit-error' && event[1]));
      assert.equal(env.settingsEnv.leavingSettingsRef.current, false, 'The user can resume editing after a failed exit');
    } finally { env.unregister(); }
  }
});

test('leaving without downloading still commits Settings and browser files', async () => {
  const env = environment();
  try {
    env.hostEnv.exportSnapshot = async () => assert.fail('Leave without downloading must not generate a ZIP');
    const pending = instantiate(workspace.found, 'confirmExit', env.hostEnv)(false);
    env.settingsAck.resolve(); await tick();
    assert.equal(env.events.includes('library'), false);
    env.folderAck.resolve();
    assert.equal(await pending, true);
    assert.equal(env.hostEnv.leaving.current, true, 'Only the completed explicit leave may suppress a duplicate native prompt');
    assert.ok(env.events.indexOf('folder-ack') < env.events.indexOf('library'));
  } finally { env.unregister(); }
});

function backupEnvironment() {
  const events = [];
  const current = ref({ name: 'Project', rootPath: '', files: {} });
  const env = {
    pt: true, toast: { loading() {}, success() {}, dismiss() {} },
    api: ref({ getProject: () => current.current }), latest: current, backedUp: ref(null), backupRevision: ref(0),
    dirty: ref(false), leaving: ref(false), browserStored: true, cloudSession: ref(null), callbacks: ref({ project: { name: 'Project' } }),
    canonicalProjectForTransport: snapshot => snapshot,
    prepareProjectForDraftTransport: snapshot => snapshot,
    prepareExport: async snapshot => snapshot, StaticCmsPublicationError: class StaticCmsPublicationError extends Error {},
    attachStaticHtmlSource: snapshot => snapshot,
    projectToZipBlob: async snapshot => { events.push(['zip', snapshot]); return new Blob(['zip']); },
    downloadZipBlob: () => events.push('download-initiated'),
    setBusy: value => events.push(['busy', value]), setError: value => events.push(['error', value]),
  };
  for (const name of ['needsBackup', 'exportSnapshot', 'beforeUnload', 'draftChanged']) env[name] = instantiate(workspace.found, name, env);
  return { env, events, current };
}

test('native closing warns for an initial or edited manual project even after browser autosave', async () => {
  const { env, current } = backupEnvironment();
  const warns = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    env.beforeUnload(event);
    if (event.prevented) assert.equal(event.returnValue, '');
    return event.prevented;
  };
  assert.equal(warns(), true, 'An opened project initially has no acknowledged ZIP');
  await env.exportSnapshot(current.current);
  assert.equal(warns(), false);
  current.current = { ...current.current, files: { ...current.current.files, 'new.txt': {} } };
  env.dirty.current = false; // Browser autosave completed, but this edit has no ZIP.
  assert.equal(warns(), true);
  await env.exportSnapshot(current.current);
  assert.equal(warns(), false);
  env.draftChanged();
  assert.equal(warns(), true, 'Settings draft edits precede the next files snapshot');
  env.browserStored = false;
  assert.equal(warns(), false, 'Folder projects retain their existing filesystem warning');
  env.dirty.current = true;
  assert.equal(warns(), true);
  env.leaving.current = true;
  assert.equal(warns(), false, 'An explicit guarded exit has already saved or offered a backup');
});

test('editable ZIP acknowledges only its snapshot and draft revision after a successful download initiation', async () => {
  for (const mutation of ['files', 'name', 'rootPath', 'draft']) {
    const { env, current } = backupEnvironment();
    const generated = deferred();
    const original = current.current;
    env.projectToZipBlob = async () => generated.promise;
    const result = env.exportSnapshot(original);
    await tick();
    if (mutation === 'draft') env.draftChanged();
    else current.current = { ...original, [mutation]: mutation === 'files' ? { 'new.txt': {} } : 'changed' };
    generated.resolve(new Blob(['zip'])); await result;
    assert.equal(env.needsBackup(), true, `Concurrent ${mutation} must remain unbacked`);
    assert.equal(env.backedUp.current.files, original.files);
    await env.exportSnapshot(current.current);
    assert.equal(env.needsBackup(), false);
  }
});

test('a failed ZIP download preserves prior coverage and a draft change during flush is not acknowledged', async () => {
  const { env, current } = backupEnvironment();
  await env.exportSnapshot(current.current);
  const originalCoverage = env.backedUp.current;
  current.current = { ...current.current, files: { 'new.txt': {} } };
  env.downloadZipBlob = () => { throw new Error('Download failed'); };
  await assert.rejects(env.exportSnapshot(current.current), /Download failed/);
  assert.equal(env.backedUp.current, originalCoverage);
  assert.equal(env.needsBackup(), true);
  env.downloadZipBlob = () => undefined;
  const revisionBeforeFlush = env.backupRevision.current;
  env.draftChanged();
  await env.exportSnapshot(current.current, revisionBeforeFlush);
  assert.equal(env.needsBackup(), true);
});

test('public site ZIP never counts as an editable project backup', async () => {
  const { env, current } = backupEnvironment();
  Object.assign(env, {
    setPublicationError: () => undefined, flush: async () => current.current,
    createHtmlSiteZip: async () => new Blob(['public site']), project: { name: 'Project' },
    reportPublicationError: cause => { throw cause; },
  });
  await instantiate(workspace.found, 'exportSiteZip', env)();
  assert.equal(env.backedUp.current, null);
  assert.equal(env.needsBackup(), true);
});


test('an invalid CMS template cannot block an editable recovery ZIP', async () => {
  const { env, events, current } = backupEnvironment();
  const cmsSource = { text: '{"version":1,"templates":{"news":"missing.html"}}' };
  current.current.files['.incode/cms/schema.json'] = cmsSource;
  env.prepareExport = async () => { throw new env.StaticCmsPublicationError('Missing CMS template'); };
  await env.exportSnapshot(current.current);
  const zipped = events.find(event => Array.isArray(event) && event[0] === 'zip')[1];
  assert.equal(zipped.files['.incode/cms/schema.json'], cmsSource);
  assert.ok(events.includes('download-initiated'));
  assert.equal(env.needsBackup(), false);
});
