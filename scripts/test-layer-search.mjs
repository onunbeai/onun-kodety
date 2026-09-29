import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
async function realFunctions(file, names, bindings = {}) {
  const source = await readFile(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = names.map(name => {
    const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node, `Production function must exist: ${name}`);
    return node.getText(ast).replace(/^export\s+/, '');
  }).join('\n');
  const compiled = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return {${names.join(',')}};`)(...Object.values(bindings));
}
const presentation = await realFunctions('lib/html-editor/layer-presentation.ts', [
  'compactLayerName', 'humanizeHtmlLayerIdentity', 'resolveHtmlImageLayerNames', 'resolveHtmlLayerPresentation',
]);
const tree = await realFunctions('app/(builder)/kodety/html-editor/components/HtmlLayersTree.tsx', [
  'isCodeComponentNode', 'isNativeOverlayRootNode', 'isNativeOverlaySurfaceNode', 'isNativeOverlayBackdropNode',
  'getHtmlElementTypeName', 'filterLayerNodes', 'projectComponentLayerNodes',
], presentation);
const node = (path, values = {}) => ({ path, tag: 'div', label: 'div', id: '', classes: [], attributes: {}, text: '', hasElementChildren: false, children: [], ...values });
const images = Array.from({ length: 35 }, (_, index) => node(`0/${index}`, {
  tag: 'img', label: index === 34 ? 'addons-visual__image' : 'img',
  classes: index === 34 ? ['addons-visual__image'] : [],
  attributes: index === 34 ? { class: 'addons-visual__image' } : {},
}));
const nodes = [node('0', { tag: 'section', label: 'gallery', children: images }),
  node('1', { tag: 'img', id: 'hero-image', attributes: { id: 'hero-image' } }),
  node('2', { tag: 'img', attributes: { 'data-label': 'Cover photograph' } }),
  node('3', { attributes: { 'data-kodety-component-id': 'component-one' }, children: [node('3/0', { tag: 'img' })] }),
];
const projected = tree.projectComponentLayerNodes(nodes);
const names = presentation.resolveHtmlImageLayerNames(projected);
const original = JSON.stringify(nodes);
const search = query => tree.filterLayerNodes(projected, query, names);
const paths = entries => entries.flatMap(item => [item.path, ...paths(item.children)]);
assert.equal(names.get('0/34'), 'Image_35');
assert.deepEqual(paths(search('Image_35')), ['0', '0/34'], 'the exact displayed image name must find its source path and retain its ancestor');
assert.deepEqual(paths(search(' image_35 ')), ['0', '0/34'], 'display-name search must retain trimming and case-insensitive matching');
assert.equal(presentation.resolveHtmlLayerPresentation(search('Image_35')[0].children[0], 'Image', names.get('0/34')).name, 'Image_35', 'filtering must preserve numbering from the complete projected tree');
assert.deepEqual(paths(search('addons-visual')), ['0', '0/34'], 'technical class search must remain available');
assert.deepEqual(paths(search('Hero image')), ['1'], 'search must accept the humanized name actually displayed for an authored ID');
assert.deepEqual(paths(search('Cover photograph')), ['2'], 'explicit names remain searchable');
assert.deepEqual(paths(search('Image_36')), [], 'internal component DOM and named images must not invent extra numbered layers');
assert.equal(search(''), projected, 'empty search must return the complete existing tree without allocation');
assert.equal(JSON.stringify(nodes), original, 'search must never write presentation names into source nodes');
console.log('Layers search passed: displayed names, stable Image_35 numbering, source classes, ancestors and component projection.');
