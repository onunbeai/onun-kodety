import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const white = { r: 1, g: 1, b: 1, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const red = { r: 1, g: 0, b: 0, a: 1 };
const collections = [
  { id: 'theme', name: 'Theme', defaultModeId: 'light', modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }] },
  { id: 'semantic', name: 'Semantic', defaultModeId: 'standard', modes: [{ modeId: 'standard', name: 'Standard' }] },
];
const alias = id => ({ type: 'VARIABLE_ALIAS', id });
const nativeConsumers = [];
const variables = [
  { id: 'color', name: 'Canvas', variableCollectionId: 'theme', resolvedType: 'COLOR', valuesByMode: { light: white, dark: black } },
  { id: 'text', name: 'Text', variableCollectionId: 'semantic', resolvedType: 'COLOR', valuesByMode: { standard: alias('color') } },
  { id: 'native', name: 'Workspace mode', variableCollectionId: 'theme', resolvedType: 'COLOR', valuesByMode: { light: white, dark: black }, resolveForConsumer(node) { nativeConsumers.push(node.id); return { resolvedType: 'COLOR', value: red }; } },
  { id: 'cycle-a', name: 'Cycle A', variableCollectionId: 'theme', resolvedType: 'COLOR', valuesByMode: { light: alias('cycle-b') } },
  { id: 'cycle-b', name: 'Cycle B', variableCollectionId: 'theme', resolvedType: 'COLOR', valuesByMode: { light: alias('cycle-a') } },
  { id: 'alpha', name: 'Translucent', variableCollectionId: 'theme', resolvedType: 'COLOR', valuesByMode: { light: { ...white, a: .5 } } },
];
const paint = (id, value, opacity = 1) => ({ type: 'SOLID', color: { r: value.r, g: value.g, b: value.b }, opacity, boundVariables: { color: alias(id) } });
function node(id, overrides = {}) {
  return {
    id, name: id, type: 'RECTANGLE', visible: true, width: 100, height: 40, x: 0, y: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 }, opacity: 1, rotation: 0,
    resolvedVariableModes: {}, fills: [], strokes: [], effects: [],
    getSharedPluginData: () => '', getCSSAsync: async () => ({}),
    exportAsync: async () => ({ document: { id, type: 'RECTANGLE' } }),
    ...overrides,
  };
}
const light = node('light', { fills: [paint('color', white)], resolvedVariableModes: { theme: 'light' } });
const dark = node('dark', { fills: [paint('color', black)], resolvedVariableModes: { theme: 'dark' } });
const aliasDark = node('alias-dark', { fills: [paint('text', black)], resolvedVariableModes: { theme: 'dark', semantic: 'standard' } });
const strokeDark = node('stroke-dark', { strokes: [paint('text', black)], strokeWeight: 2, resolvedVariableModes: { theme: 'dark', semantic: 'standard' } });
const richDark = node('rich-dark', {
  type: 'TEXT', characters: 'Dark text', fills: [paint('text', black)], fontSize: 16,
  fontName: { family: 'Arial', style: 'Regular' }, resolvedVariableModes: { theme: 'dark', semantic: 'standard' },
  getStyledTextSegments: () => [{ characters: 'Dark text', start: 0, end: 9, fontSize: 16, fills: [paint('text', black)] }],
});
const alpha = node('alpha', { fills: [paint('alpha', white, .5)] });
const halfOpacity = node('half-opacity', { fills: [paint('color', white, .5)] });
const native = node('native', { fills: [paint('native', red)] });
const inconsistent = node('inconsistent', { fills: [paint('color', red)], resolvedVariableModes: { theme: 'dark' } });
const cycle = node('cycle', { fills: [paint('cycle-a', red)] });
const unavailable = node('unavailable', { fills: [paint('unavailable', red)] });
const figma = {
  command: '', mixed: Symbol('mixed'), showUI() {}, on() {}, root: { name: 'Variable fixture' },
  currentPage: { id: 'page', name: 'Page', selection: [light, dark, aliasDark, strokeDark, richDark, alpha, halfOpacity, native, inconsistent, cycle, unavailable], on() {} },
  ui: { postMessage() {} },
  variables: { getLocalVariablesAsync: async () => variables, getLocalVariableCollectionsAsync: async () => collections, getVariableByIdAsync: async () => null },
};
const sandbox = { figma, __html__: '', console, setTimeout, clearTimeout, btoa: value => Buffer.from(value, 'binary').toString('base64') };
vm.runInNewContext(code, sandbox, { filename: 'FigmaPlugin/code.js' });
const payload = await sandbox.buildPayload({ responsiveMode: 'pixel' });
const classFor = id => payload.html.match(new RegExp(`class="([^"]+)"[^>]*data-figma-id="${id}"`))[1];
const ruleFor = id => payload.css.match(new RegExp(`\\.${classFor(id)}\\{([^}]+)\\}`))[1];
const referenceFor = id => ruleFor(id).match(/var\((--[^,]+),/)[1];
const tokenFor = id => payload.variables.find(variable => variable.cssName === referenceFor(id));
assert.equal(tokenFor('light').value, 'rgb(255 255 255)');
assert.equal(tokenFor('dark').value, 'rgb(0 0 0)');
assert.notEqual(referenceFor('light'), referenceFor('dark'), 'A mixed selection must not share one global theme value');
assert.equal(tokenFor('alias-dark').value, 'rgb(0 0 0)', 'Cross-collection alias must resolve the consumer theme, not the target default');
assert.equal(tokenFor('alias-dark').modeId, 'standard');
assert.match(tokenFor('alias-dark').modeName, /Dark/);
assert.equal(referenceFor('alias-dark'), referenceFor('stroke-dark'), 'Solid and stroke using the same resolved alias share the right mode token');
assert.equal(referenceFor('alias-dark'), referenceFor('rich-dark'));
assert.match(payload.html, new RegExp(`data-figma-segment="0" style="[^"]*var\\(${referenceFor('rich-dark')},rgb\\(0 0 0\\)\\)`), 'Rich text segments receive the consumer mode too');
assert.equal(tokenFor('alpha').value, 'rgb(255 255 255 / 50%)', 'Variable alpha already represented by paint opacity must not be applied twice');
assert.equal(tokenFor('half-opacity').value, 'rgb(255 255 255 / 50%)', 'Paint opacity must survive a fully opaque bound token');
assert.notEqual(referenceFor('half-opacity'), referenceFor('light'));
assert.equal(tokenFor('native').value, 'rgb(255 0 0)', 'Native consumer resolution wins over a stale/default metadata value');
assert.ok(nativeConsumers.includes('native'));
for (const id of ['inconsistent', 'cycle', 'unavailable']) {
  assert.doesNotMatch(ruleFor(id), /var\(/, `${id} must preserve its literal paint instead of binding an invented/wrong value`);
  assert.match(ruleFor(id), /rgb\(255 0 0\)/);
}
assert.equal(payload.variables.length, new Set(payload.variables.map(variable => variable.id)).size, 'Mode-specific token identities remain unique');
assert.equal(payload.variables.length, new Set(payload.variables.map(variable => variable.cssName)).size);
assert.ok(payload.variables.some(variable => variable.id.includes('@')), 'Actual-mode tokens appended during render must be present in the returned payload');
console.log('Figma variable fidelity: mixed modes, alias chains, native resolution, text/strokes, opacity and literal fallback passed.');
