import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import vm from 'node:vm';
import { createServer, transformWithEsbuild } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
after(() => server.close());
const clipboardSvg = await server.ssrLoadModule('/lib/html-editor/clipboard-svg.ts');
const protocol = await server.ssrLoadModule('/lib/html-editor/canvas-protocol.ts');
const { parseKodetyFigmaClipboard, importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
const { createBlankProject } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
const { inspectSourceElementIndex } = await server.ssrLoadModule('/lib/html-editor/source-patcher.ts');
const constantsSource = await readFile(new URL('../lib/html-editor/editor-constants.ts', import.meta.url), 'utf8');
const containerTags = constantsSource.match(/export const CONTAINER_TAGS = new Set\((\[[\s\S]*?\])\)/);
assert.ok(containerTags);
const CONTAINER_TAGS = vm.runInNewContext(`new Set(${containerTags[1]})`);
const preview = await readFile(new URL('../lib/html-editor/preview.ts', import.meta.url), 'utf8');
const handlerStart = preview.indexOf('    const standaloneClipboardSvg = value => {');
const handlerEnd = preview.indexOf("    document.addEventListener('keydown'", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'locate the actual clipboard runtime inside the preview template');
// Evaluate just the source template to obtain its real escaping. The tests
// below execute the actual canvas listener, not a duplicated routing helper.
const handlerScript = vm.runInNewContext('`' + preview.slice(handlerStart, handlerEnd) + '`');
const editorSource = await readFile(new URL('../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx', import.meta.url), 'utf8');
const importStart = editorSource.indexOf('    const importFigmaClipboard = async');
const importEnd = editorSource.indexOf('    const pasteListener = ', importStart);
assert.ok(importStart >= 0 && importEnd > importStart, 'locate the real parent import callback and its ref assignment');
const parentImportScript = (await transformWithEsbuild(editorSource.slice(importStart, importEnd),
  'figma-paste-callback.ts', { loader: 'ts', target: 'es2022' })).code;
const parentBranchStart = editorSource.indexOf("      if (message.type === 'html-editor-figma-paste') {");
const parentBranchEnd = editorSource.indexOf('\n      if (message.type === ', parentBranchStart + 1);
assert.ok(parentBranchStart >= 0 && parentBranchEnd > parentBranchStart);
const parentBridgeScript = (await transformWithEsbuild(`globalThis.forwardFigmaMessage = (message) => {\n${editorSource.slice(parentBranchStart, parentBranchEnd)}\n};`,
  'figma-paste-bridge.ts', { loader: 'ts', target: 'es2022' })).code;
const MAX_FIGMA_LENGTH = 96 * 1024 * 1024;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="M0 0h8v8H0z"/></svg>';
const makePayload = (extra = {}) => JSON.stringify({ signature: '__kodety_figma__', version: 4, source: 'figma-plugin',
  exportId: 'clipboard-test', exportedAt: '2026-09-04T00:00:00Z', documentName: 'Routing fixture', pageName: 'Page',
  html: '<div class="fixture"><img src="figma-asset://icon" alt=""/></div>', css: '.fixture{width:8px;height:8px}',
  assets: [{ id: 'icon', name: 'icon.svg', mimeType: 'image/svg+xml', text: svg, width: 8, height: 8 }],
  fonts: [], variables: [], warnings: [], stats: { nodes: 2, assets: 1, bytes: 256 }, ...extra });
const smallPayload = makePayload();
const largePayload = makePayload({ padding: 'x'.repeat(2 * 1024 * 1024) });
const clipboard = (text = '', html = '', directSvg = '') => ({
  files: [], items: [], types: [text && 'text/plain', html && 'text/html', directSvg && 'image/svg+xml'].filter(Boolean),
  getData(type) { return ({ 'text/plain': text, 'text/html': html, 'image/svg+xml': directSvg })[type] || ''; },
});

function dispatch(data, options = {}) {
  const listeners = {};
  const messages = [];
  const sandbox = { inspectionEnabled: options.inspectionEnabled ?? true,
    selected: options.noSelection ? null : { dataset: { htmlEditorPath: options.targetPath ?? '0/2' } },
    document: { addEventListener(name, callback) { listeners[name] = callback; } },
    postEditorMessage(message) { messages.push(message); },
  };
  vm.runInNewContext(handlerScript, sandbox, { filename: 'preview-clipboard-runtime.js' });
  let prevented = 0;
  let stopped = 0;
  listeners.paste({
    clipboardData: data,
    target: { closest(selector) { return options.nativeField && selector.includes('input, textarea') ? {} : null; } },
    preventDefault() { prevented += 1; }, stopImmediatePropagation() { stopped += 1; },
  });
  return { messages, prevented, stopped };
}

function parentHarness(options = {}) {
  const state = { imports: [], commits: [], toasts: [], sharedNotifications: [], importResults: [] };
  const sandbox = {
    Error, parseKodetyFigmaClipboard, inspectSourceElementIndex, CONTAINER_TAGS,
    useFontsStore: { getState: () => ({ googleFontsCatalog: [] }) },
    loadFigmaGoogleFontsCatalog: async () => [],
    mode: options.mode || 'design', isPreviewing: Boolean(options.preview),
    workspaceReadOnly: Boolean(options.readOnly), sharedReadOnly: Boolean(options.sharedReadOnly),
    resolvedActiveLocale: options.locale || 'pt-BR', localization: { sourceLocale: 'pt-BR' },
    projectRef: { current: createBlankProject('Parent clipboard integration') },
    projectRevisionRef: { current: 7 }, figmaImportInFlightRef: { current: Boolean(options.busy) },
    figmaPasteCapabilityRef: { current: { enabled: true, sourceLocale: 'pt-BR', activeLocale: 'pt-BR' } },
    pendingSelectionPathRef: { current: 'unchanged' }, pasteFigmaClipboardRef: { current: null },
    linkedCssFiles: ['styles.css'], cssFiles: [], getAdminUiLocale: () => 'pt-BR',
    notifySharedReadOnly(message) { state.sharedNotifications.push(message); },
    toast: Object.fromEntries(['success', 'error', 'info'].map(kind => [kind, (message, details) => {
      state.toasts.push({ kind, message, description: details?.description });
    }])),
    async importKodetyFigmaPayload(project, payload, settings) {
      state.imports.push({ settings, assetCount: payload.assets.length });
      const result = await importKodetyFigmaPayload(project, payload, settings);
      state.importResults.push(result);
      if (options.changeRevision) sandbox.projectRevisionRef.current += 1;
      if (options.changeProject) sandbox.projectRef.current = { ...project };
      if (options.disableCapability) sandbox.figmaPasteCapabilityRef.current.enabled = false;
      if (options.changeActiveLocale) sandbox.figmaPasteCapabilityRef.current.activeLocale = 'en-US';
      if (options.changeSourceLocale) sandbox.figmaPasteCapabilityRef.current.sourceLocale = 'en-US';
      return result;
    },
    commitProject(project) { state.commits.push(project); sandbox.projectRef.current = project; },
  };
  vm.runInNewContext(parentImportScript + '\n' + parentBridgeScript, sandbox, { filename: 'actual-parent-figma-callback.js' });
  const actualCallback = sandbox.pasteFigmaClipboardRef.current;
  assert.equal(typeof actualCallback, 'function');
  let pending = null;
  sandbox.pasteFigmaClipboardRef.current = (...args) => {
    pending = actualCallback(...args);
    return pending;
  };
  return { state, sandbox,
    async receive(text, messageOverrides = {}) {
      pending = null;
      const message = { type: 'html-editor-figma-paste', generation: 'parent-generation', text, html: '', targetPath: '0', ...messageOverrides };
      if (!protocol.isCanvasToEditorMessage(message, 'parent-generation')) return false;
      sandbox.forwardFigmaMessage(message);
      if (pending) await pending;
      return true;
    },
  };
}

for (const [label, payload] of [['small', smallPayload], ['large', largePayload]]) {
  test(`${label} Figma JSON with embedded SVG is never an isolated clipboard SVG`, async () => {
    for (const text of [payload, `\uFEFF \n${payload}`]) {
      assert.equal(clipboardSvg.clipboardContainsSvg(clipboard(text)), false);
      assert.equal(await clipboardSvg.readClipboardSvgSource(clipboard(text)), null);
    }
  });

  test(`${label} Figma JSON crosses the canvas Figma bridge without extracting its SVG asset`, () => {
    const result = dispatch(clipboard(payload));
    assert.equal(result.messages.length, 1);
    const message = result.messages[0];
    assert.equal(message.type, 'html-editor-figma-paste');
    assert.equal(message.text, payload);
    assert.equal(message.html, '');
    assert.equal(message.targetPath, '0/2');
    assert.equal(result.prevented, 1);
    assert.equal(result.stopped, 1);
  });
}

test('HTML-flavor Figma JSON and plain-text Figma JSON take priority over alternate SVG flavors', () => {
  for (const data of [clipboard('', smallPayload), clipboard(smallPayload, `<div>${svg}</div>`, svg)]) {
    const result = dispatch(data);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].type, 'html-editor-figma-paste');
    assert.equal(result.messages[0].text, data.getData('text/plain'));
    assert.equal(result.messages[0].html, data.getData('text/html'));
  }
});

test('unrelated JSON objects and arrays containing SVG are not standalone vectors either', async () => {
  for (const text of [JSON.stringify({ asset: svg, padding: 'x'.repeat(400 * 1024) }), JSON.stringify([svg])]) {
    assert.equal(clipboardSvg.clipboardContainsSvg(clipboard(text)), false);
    assert.equal(await clipboardSvg.readClipboardSvgSource(clipboard(text)), null);
    assert.equal(dispatch(clipboard(text)).messages[0].type, 'html-editor-command');
  }
});

test('genuine standalone SVG still pastes, including XML and normal HTML clipboard wrappers', async () => {
  for (const source of [svg, `<?xml version="1.0"?>${svg}`, `<meta charset="utf-8"><div>${svg}</div>`]) {
    const data = clipboard(source);
    assert.equal(clipboardSvg.clipboardContainsSvg(data), true);
    assert.ok(await clipboardSvg.readClipboardSvgSource(data));
    const result = dispatch(data);
    assert.equal(result.messages[0].type, 'html-editor-svg-paste');
    assert.match(result.messages[0].svg, /^<svg/);
    assert.equal(result.messages[0].targetPath, '0/2');
  }
  const oversizedSvg = `<svg width="8" height="8">${' '.repeat(384 * 1024)}</svg>`;
  assert.equal(clipboardSvg.clipboardContainsSvg(clipboard(oversizedSvg)), true);
  await assert.rejects(() => clipboardSvg.readClipboardSvgSource(clipboard(oversizedSvg)), /grande demais/i);
});

test('native editing fields, runtime Preview and an absent selection do not intercept Figma paste', () => {
  for (const options of [{ nativeField: true }, { inspectionEnabled: false }, { noSelection: true }]) {
    const result = dispatch(clipboard(smallPayload), options);
    assert.equal(result.messages.length, 0);
    assert.equal(result.prevented, 0);
  }
});

test('the Figma canvas protocol accepts large signed data only for the current generation and exact message shape', () => {
  const message = { type: 'html-editor-figma-paste', generation: 'routing-generation',
    text: largePayload, html: '', targetPath: '0/2' };
  const accepts = candidate => protocol.isCanvasToEditorMessage(candidate, 'routing-generation');
  assert.equal(accepts(message), true, 'a 2MB Figma package exceeds the generic message budget but is legitimate');
  assert.equal(accepts({ ...message, text: '', html: largePayload }), true, 'the signed package may use the HTML clipboard flavor');
  assert.equal(accepts({ ...message, text: 'x'.repeat(2 * 1024 * 1024) }), false, 'unsigned data cannot claim the expanded budget');
  assert.equal(accepts({ ...message, targetPath: '' }), true, 'Body is a valid paste target');
  assert.equal(accepts({ ...message, generation: 'stale' }), false);
  assert.equal(accepts({ ...message, targetPath: '../outside' }), false);
  assert.equal(accepts({ ...message, extra: 'unexpected' }), false);
  assert.equal(accepts({ ...message, html: null }), false);
  assert.equal(accepts({ ...message, text: ['not a string'] }), false);
  assert.equal(protocol.isCanvasToEditorMessage({ type: 'html-editor-svg-paste', generation: message.generation,
    svg: largePayload, targetPath: '0/2' }, message.generation), false, 'the SVG budget must not be enlarged');
  assert.equal(protocol.isCanvasToEditorMessage({ type: 'html-editor-command', generation: message.generation,
    command: 'paste-selection', text: largePayload }, message.generation), false, 'ordinary commands must retain their strict schema');
});

test('the Figma bridge bounds the combined text plus HTML size, not each flavor separately', () => {
  const text = smallPayload + ' '.repeat(MAX_FIGMA_LENGTH / 2 - smallPayload.length);
  const html = smallPayload + ' '.repeat(MAX_FIGMA_LENGTH / 2 - smallPayload.length);
  const message = { type: 'html-editor-figma-paste', generation: 'routing-generation', text, html, targetPath: '0' };
  assert.equal(protocol.isCanvasToEditorMessage(message, message.generation), true, 'the exact combined limit is valid');
  assert.equal(protocol.isCanvasToEditorMessage({ ...message, html: html + ' ' }, message.generation), false);
  const overflow = dispatch(clipboard(text, html + ' '));
  assert.equal(overflow.messages.length, 1);
  assert.equal(overflow.messages[0].type, 'html-editor-figma-paste');
  assert.equal(overflow.messages[0].text, '__kodety_figma__');
  assert.equal(overflow.messages[0].html, '');
});

test('a protocol-validated canvas message executes the actual parent ref and commits a real import', async () => {
  const fixture = parentHarness();
  assert.equal(await fixture.receive(smallPayload), true);
  assert.equal(fixture.state.imports.length, 1);
  assert.equal(fixture.state.imports[0].settings.targetPath, '0');
  assert.equal(fixture.state.importResults[0].importedAssets, 1);
  assert.equal(fixture.state.commits.length, 1);
  assert.equal(fixture.sandbox.pendingSelectionPathRef.current, fixture.state.importResults[0].selectionPath);
  assert.equal(fixture.sandbox.figmaImportInFlightRef.current, false);
  assert.equal(fixture.state.toasts.at(-1).kind, 'success');
});

for (const [label, options] of [
  ['read-only', { readOnly: true }], ['shared read-only', { readOnly: true, sharedReadOnly: true }],
  ['runtime Preview', { preview: true }], ['non-design mode', { mode: 'code' }],
  ['translated locale', { locale: 'en-US' }], ['concurrent import', { busy: true }],
]) {
  test(`the actual parent callback blocks ${label} without importing or committing`, async () => {
    const fixture = parentHarness(options);
    await fixture.receive(smallPayload);
    assert.equal(fixture.state.imports.length, 0);
    assert.equal(fixture.state.commits.length, 0);
    assert.equal(fixture.sandbox.pendingSelectionPathRef.current, 'unchanged');
    assert.equal(fixture.sandbox.figmaImportInFlightRef.current, Boolean(options.busy));
    assert.equal(fixture.state.toasts.some(toast => toast.kind === 'success'), false);
    if (options.sharedReadOnly) assert.equal(fixture.state.sharedNotifications.length, 1);
    else assert.ok(fixture.state.toasts.length > 0);
  });
}

for (const [label, options] of [['revision', { changeRevision: true }], ['project identity', { changeProject: true }]]) {
  test(`a ${label} change during real asynchronous import prevents stale parent commits`, async () => {
    const fixture = parentHarness(options);
    await fixture.receive(smallPayload);
    assert.equal(fixture.state.imports.length, 1);
    assert.equal(fixture.state.importResults.length, 1, 'the import completed but its result is now stale');
    assert.equal(fixture.state.commits.length, 0);
    assert.equal(fixture.sandbox.pendingSelectionPathRef.current, 'unchanged');
    assert.equal(fixture.sandbox.figmaImportInFlightRef.current, false);
    assert.match(fixture.state.toasts.at(-1).description, /projeto mudou durante a importação/i);
  });
}

for (const [label, options] of [
  ['permission or editing mode', { disableCapability: true }],
  ['active locale', { changeActiveLocale: true }], ['source locale', { changeSourceLocale: true }],
]) {
  test(`a ${label} change during import blocks commit even without a project revision change`, async () => {
    const fixture = parentHarness(options);
    await fixture.receive(smallPayload);
    assert.equal(fixture.state.importResults.length, 1);
    assert.equal(fixture.sandbox.projectRevisionRef.current, 7);
    assert.equal(fixture.state.commits.length, 0);
    assert.equal(fixture.sandbox.pendingSelectionPathRef.current, 'unchanged');
    assert.equal(fixture.sandbox.figmaImportInFlightRef.current, false);
    assert.match(fixture.state.toasts.at(-1).description, /modo, idioma ou permissão mudou/i);
  });
}

test('stale generations and missing captured targets cannot commit through the parent callback', async () => {
  const stale = parentHarness();
  assert.equal(await stale.receive(smallPayload, { generation: 'old-generation' }), false);
  assert.equal(stale.state.imports.length, 0);
  const missing = parentHarness();
  await missing.receive(smallPayload, { targetPath: '0/999' });
  assert.equal(missing.state.imports.length, 0);
  assert.equal(missing.state.commits.length, 0);
  assert.equal(missing.sandbox.figmaImportInFlightRef.current, false);
  assert.match(missing.state.toasts.at(-1).description, /layer selecionada mudou/i);
});

// Optional local reproduction: --payload /absolute/path/to/export.json.
// Do not commit users' exported assets or dump their embedded/base64 contents.
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] !== '--payload' || !process.argv[index + 1]) continue;
  const payloadPath = process.argv[++index];
  test(`real export routing from ${payloadPath.split('/').at(-1)}`, async () => {
    const raw = await readFile(payloadPath, 'utf8');
    const payload = parseKodetyFigmaClipboard(raw);
    assert.ok(payload, 'the real package is recognized by the canonical Figma parser');
    assert.equal(clipboardSvg.clipboardContainsSvg(clipboard(raw)), false);
    assert.equal(await clipboardSvg.readClipboardSvgSource(clipboard(raw)), null);
    const result = dispatch(clipboard(raw));
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].type, 'html-editor-figma-paste');
    assert.equal(result.messages[0].text, raw);
    assert.equal(protocol.isCanvasToEditorMessage({ ...result.messages[0], generation: 'real-generation' }, 'real-generation'), true);
    const imported = await importKodetyFigmaPayload(createBlankProject('Real clipboard regression'), payload,
      { targetPath: '0', preferredStylesheetPath: 'styles.css' });
    assert.ok(imported.importedNodes > 0, 'the real file must complete import, not merely reach the correct route');
    assert.equal(imported.importedAssets, payload.assets.length);
    const parent = parentHarness();
    assert.equal(await parent.receive(raw), true);
    assert.equal(parent.state.commits.length, 1, 'the real parent callback must commit the imported project');
    assert.equal(parent.state.importResults[0].importedAssets, payload.assets.length);
    assert.equal(parent.state.toasts.at(-1).kind, 'success');
  });
}
