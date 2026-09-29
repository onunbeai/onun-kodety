import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let accessFactory;
let openingGuard;
const canvas = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'imageOptimizationAccess') accessFactory = `() => (${node.initializer.getText(tree)})`;
  if (ts.isIfStatement(node) && node.expression.getText(tree) === '!project && workspace') openingGuard = node.getText(tree);
  if (ts.isVariableDeclaration(node) && ['productAccess', 'infiniteCanvasLicensed', 'infiniteCanvasBetaEnabled', 'changeInfiniteCanvasEnabled'].includes(node.name.getText(tree)) && !canvas.has(node.name.getText(tree))) {
    const name = node.name.getText(tree);
    canvas.set(name, (name === 'changeInfiniteCanvasEnabled' ? node.initializer.arguments[0] : node.initializer).getText(tree));
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(accessFactory);
assert.ok(openingGuard);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
function access(runtime, licensed) {
  const visits = [];
  const workspace = runtime === 'html' ? { onNavigateView: view => visits.push(view) } : undefined;
  const window = { location: { href: 'https://studio.test/?project=123' }, history: { state: null, replaceState(_state, _title, url) { visits.push(url.href); } } };
  const product = licensed === undefined ? undefined : { licensed, features: { imageCompression: licensed, imageConversion: licensed }, licenseUrl: '?section=license' };
  const value = new Function('workspace', 'isWordPressRuntime', 'productAccess', 'window', `${compile(`const read = ${accessFactory};`)} return read();`)(workspace, runtime === 'wordpress', product, window);
  return { value, visits };
}
for (const runtime of ['wordpress', 'html']) {
  test(`${runtime} keeps optimization available without product activation`, () => {
    for (const licensed of [undefined, false]) {
      const { value } = access(runtime, licensed);
      assert.equal(value.compressionLocked, false);
      assert.equal(value.conversionLocked, false);
    }
    const { value } = access(runtime, true);
    assert.equal(value.compressionLocked, false);
    assert.equal(value.conversionLocked, false);
  });
}
test('HTML exposes no product activation action', () => {
  assert.equal(access('html', false).value.onActivate, undefined);
  assert.equal(access('wordpress', false).value.onActivate, undefined);
});
test('an HTML project in hydration renders loading instead of the import screen', () => {
  const render = new Function('project', 'workspace', 'React', 'KodetyLoadingScreen', `${compile(openingGuard)} return 'empty-project';`);
  const React = { createElement: (component, props) => ({ component, props }) };
  const loading = render(null, {}, React, 'shared-loader');
  assert.equal(loading.component, 'shared-loader');
  assert.equal(loading.props.className, 'h-full min-h-0');
  assert.equal(render(null, undefined, React, 'shared-loader'), 'empty-project');
  assert.equal(render({ files: {} }, {}, React, 'shared-loader'), 'empty-project');
});

const evaluate = (expression, bindings) => new Function('bindings', `with (bindings) { ${compile(`const value = ${expression};`)} return value; }`)(bindings);
function canvasAccess(runtime, product, optedIn) {
  const productAccess = evaluate(canvas.get('productAccess'), { workspace: runtime === 'html' ? { product } : undefined, topbarWp: runtime === 'wordpress' ? { product } : undefined });
  const infiniteCanvasLicensed = evaluate(canvas.get('infiniteCanvasLicensed'), { productAccess });
  const available = evaluate(canvas.get('infiniteCanvasBetaEnabled'), { infiniteCanvasLicensed, editorMetadataSnapshot: { siteSettings: { betaFeatures: { infiniteCanvas: optedIn } } } });
  return { productAccess, infiniteCanvasLicensed, available };
}
for (const runtime of ['wordpress', 'html']) {
  test(`${runtime} Infinite Canvas requires explicit Beta opt-in without a subscription`, () => {
    for (const product of [undefined, { licensed: false, features: { experiments: true } }, { licensed: true, features: {} }, { licensed: true, features: { experiments: false } }]) {
      assert.equal(canvasAccess(runtime, product, true).available, true);
    }
    const pro = { licensed: true, features: { experiments: true } };
    assert.equal(canvasAccess(runtime, pro, false).available, false);
    assert.equal(canvasAccess(runtime, pro, true).available, true);
  });
}
test('Infinite Canvas preserves Beta opt-in and can always turn off', () => {
  function setup(licensed, optedIn, enabled = false) {
    const events = [];
    const bindings = {
      infiniteCanvasEnabled: enabled, infiniteCanvasLicensed: licensed,
      projectRef: { current: {} }, readEditorMetadata: () => ({ siteSettings: { betaFeatures: { infiniteCanvas: optedIn } } }),
      workspace: { onOpenSettingsSection: section => events.push(['settings', section]) }, productAccess: {}, topbarWp: undefined,
      toast: { warning: (...args) => events.push(['warning', ...args]) },
      prepareCanvasTopologySwitchRef: { current: value => events.push(['switch', value]) },
      materializeCanonicalCanvas: () => events.push('materialize'), setInfiniteCanvasEnabled: value => events.push(['enabled', value]),
      writeLocalPreference: (_key, value) => events.push(['preference', value]), INFINITE_CANVAS_PREFERENCE: 'canvas',
      useHtmlProjectSettingsStore: { getState: () => ({ close: () => events.push('close-settings') }) },
      setShowCode: () => {}, setShowTimeline: () => {}, setCanvasContextMenu: () => {},
    };
    return { events, change: evaluate(canvas.get('changeInfiniteCanvasEnabled'), bindings) };
  }
  const included = setup(false, true);
  included.change(true);
  assert.deepEqual(included.events.slice(0, 3), [['switch', true], 'materialize', ['enabled', true]]);
  const beta = setup(true, false);
  beta.change(true);
  assert.deepEqual(beta.events[0], ['settings', 'beta']);
  assert.equal(beta.events.some(event => Array.isArray(event) && event[0] === 'switch'), false);
  const allowed = setup(true, true);
  allowed.change(true);
  assert.deepEqual(allowed.events.slice(0, 3), [['switch', true], 'materialize', ['enabled', true]]);
  const revoked = setup(false, true, true);
  revoked.change(false);
  assert.deepEqual(revoked.events.slice(0, 3), [['switch', false], 'materialize', ['enabled', false]]);
});

const settingsSource = await readFile(new URL('../../../app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx', import.meta.url), 'utf8');
const settingsTree = ts.createSourceFile('settings.tsx', settingsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let infiniteCanvasLocked;
let changeCanvasBeta;
let canvasLicenseGate = false;
function settingsVisit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(settingsTree) === 'infiniteCanvasLocked') infiniteCanvasLocked = node.initializer.getText(settingsTree);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(settingsTree) === 'SettingRow') {
    const attributes = node.attributes.properties;
    const title = attributes.find(attribute => attribute.name?.getText(settingsTree) === 'title');
    if (title?.initializer?.text === 'Disponibilizar Canvas Infinito') changeCanvasBeta = attributes.find(attribute => attribute.name?.getText(settingsTree) === 'onCheckedChange').initializer.expression.getText(settingsTree);
  }
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(settingsTree) === 'LicenseFeatureGate') canvasLicenseGate ||= node.attributes.properties.some(attribute => attribute.name?.getText(settingsTree) === 'locked' && attribute.initializer.expression?.getText(settingsTree) === 'infiniteCanvasLocked');
  ts.forEachChild(node, settingsVisit);
}
settingsVisit(settingsTree);
test('shared Settings permits Beta opt-in regardless of old product data', () => {
  assert.ok(canvasLicenseGate);
  for (const productAccess of [undefined, { licensed: false, features: { experiments: true } }, { licensed: true, features: {} }, { licensed: true, features: { experiments: true } }]) {
    const locked = evaluate(infiniteCanvasLocked, { productAccess, productFeatures: productAccess?.features || {} });
    const updates = [];
    const change = evaluate(changeCanvasBeta, { infiniteCanvasLocked: locked, siteDraft: {}, setSiteDraft: value => updates.push(value) });
    change(true);
    assert.equal(updates.length, locked ? 0 : 1);
  }
});
