import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const plugin = { figma: { mixed: Symbol('mixed'), command: '', currentPage: { selection: [] },
  root: { name: 'Coordinate regressions' }, ui: { postMessage() {} }, on() {}, showUI() {} },
__html__: '', console, setTimeout, clearTimeout };
vm.runInNewContext(source, plugin, { filename: 'FigmaPlugin/code.js' });
const node = (overrides = {}) => ({ id: 'coordinate:node', type: 'RECTANGLE', name: 'Rectangle',
  x: 0, y: 0, width: 14, height: 14, opacity: 1, fills: [], strokes: [],
  getSharedPluginData() { return ''; }, ...overrides });
const context = { options: { responsiveMode: 'pixel' }, restNodesById: new Map() };
const declarations = values => Object.fromEntries(Array.from(values, value => {
  const separator = value.indexOf(':');
  return [value.slice(0, separator), value.slice(separator + 1)];
}));

test('Rectangle artwork never becomes a CTA because of an embedded substring', () => {
  for (const name of ['Rectangle', 'Rectangle 427', 'rectangle-icon', 'rectangular background', 'Contact']) {
    assert.equal(plugin.semanticTag(node({ name })), 'div', name);
  }
  for (const name of ['CTA', 'Primary CTA', 'CTA_primary', 'Button - Ver recurso anterior', 'Primary button']) {
    assert.equal(plugin.semanticTag(node({ name })), 'button', name);
  }
  assert.equal(plugin.semanticTag(node({ name: 'Rectangle #tag:button' })), 'button', 'explicit semantics win');
});

test('Figma line separators survive HTML as actual preserved newlines without changing attributes', () => {
  const text = 'Gerencie conteúdos\u2028em um CMS visual\u2028Tudo conectado.';
  assert.equal(plugin.escapeFigmaText(text), 'Gerencie conteúdos\nem um CMS visual\nTudo conectado.');
  assert.equal(plugin.escapeFigmaText('A\u2029B\r\nC\rD & <E>'), 'A\nB\nC\nD &amp; &lt;E&gt;');
  assert.ok(plugin.escapeAttribute(text).includes('\u2028'), 'layer labels are not rewritten as text content');
  const plain = node({ type: 'TEXT', characters: text, fontName: { family: 'Arial', style: 'Regular' },
    getStyledTextSegments: () => [] });
  const textContext = { ...context, fonts: new Map(), fontUsage: new Map(), richTextSegments: 0 };
  assert.equal(plugin.styledText(plain, textContext), plugin.escapeFigmaText(text));
  const rich = node({ type: 'TEXT', characters: text, fontName: { family: 'Arial', style: 'Regular' },
    getStyledTextSegments: () => [{ characters: text, fontName: { family: 'Arial', style: 'Regular' },
      fontSize: 14, fontWeight: 400, fills: [] }] });
  const html = plugin.styledText(rich, textContext);
  assert.match(html, /Gerencie conteúdos\nem um CMS visual\nTudo conectado\./);
  assert.doesNotMatch(html, /\u2028/);
});

test('group children use immediate-parent coordinates rather than their containing frame coordinates', () => {
  const parent = node({ type: 'GROUP', x: 21, y: 13, width: 13.857, height: 14.391 });
  for (const [x, y, expectedX, expectedY] of [[21, 13, 0, 0], [30.061, 22.594, 9.061, 9.594]]) {
    const child = node({ x, y, width: 4.797, height: 4.797 });
    assert.equal(declarations(plugin.axisConstraintDeclarations(child, parent, 'horizontal', context).declarations).left, `${expectedX}px`);
    assert.equal(declarations(plugin.axisConstraintDeclarations(child, parent, 'vertical', context).declarations).top, `${expectedY}px`);
  }
});

test('nested groups rebase absolute transforms only once even under a rotated containing frame', () => {
  const parent = node({ type: 'GROUP', x: 21, y: 13,
    absoluteTransform: [[0, -1, 487], [1, 0, 221]] });
  const child = node({ x: 30.061, y: 22.594,
    absoluteTransform: [[0, -1, 477.406], [1, 0, 230.061]] });
  const matrix = plugin.immediateParentTransform(child, parent);
  assert.ok(Math.abs(matrix[0][2] - 9.061) < 1e-9);
  assert.ok(Math.abs(matrix[1][2] - 9.594) < 1e-9);
  assert.ok(Math.abs(matrix[0][0] - 1) < 1e-9);
});

test('ordinary frame coordinates and constraints remain unchanged', () => {
  const parent = node({ type: 'FRAME', x: 400, y: 200, width: 100, height: 100, layoutMode: 'NONE' });
  const child = node({ x: 12, y: 18, constraints: { horizontal: 'MAX', vertical: 'STRETCH' } });
  assert.equal(declarations(plugin.axisConstraintDeclarations(child, parent, 'horizontal', context).declarations).right, '74px');
  assert.deepEqual(declarations(plugin.axisConstraintDeclarations(child, parent, 'vertical', context).declarations), { top: '18px', bottom: '68px' });
});

test('a flipped native icon uses its minimum corner, not its transformed right/bottom origin', () => {
  const parent = node({ type: 'FRAME', width: 44.978, height: 39.981, layoutMode: 'NONE' });
  const child = node({ type: 'VECTOR', x: 29.572, y: 27.1855,
    relativeTransform: [[-1, 0, 29.572], [0, -1, 27.1855]],
    constraints: { horizontal: 'CENTER', vertical: 'CENTER' } });
  const css = declarations(plugin.atomicMediaDeclarations(child, parent, context));
  assert.equal(css.left, 'calc(50% - 6.917px)');
  assert.equal(css.top, 'calc(50% - 6.805px)');
  assert.equal(css.width, '14px');
  assert.equal(css.height, '14px');
  assert.equal(css.padding, '0');
  assert.equal(css.transform, undefined, 'snapshot has already baked in the source flip');
});

test('the mirrored icon keeps MAX/STRETCH constraints and unmirrored assets do not move', () => {
  const parent = node({ type: 'FRAME', width: 100, height: 60, layoutMode: 'NONE' });
  const child = node({ type: 'VECTOR', x: 40, y: 10, relativeTransform: [[-1, 0, 40], [0, 1, 10]],
    constraints: { horizontal: 'MAX', vertical: 'STRETCH' } });
  const css = declarations(plugin.atomicMediaDeclarations(child, parent, context));
  assert.equal(css.right, '60px');
  assert.equal(css.top, '10px');
  assert.equal(css.bottom, '36px');
  const plain = declarations(plugin.atomicMediaDeclarations(node({ x: 7, y: 9 }), parent, context));
  assert.equal(plain.left, '7px');
  assert.equal(plain.top, '9px');
});
