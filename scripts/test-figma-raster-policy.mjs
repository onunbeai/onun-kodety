import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const code = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M2 2h20v20H2z" fill="black"/></svg>';
function fixture() {
  const calls = [];
  const source = (id, overrides = {}) => ({
    id, name: id, type: 'VECTOR', visible: true, width: 48, height: 48, x: 0, y: 0,
    opacity: 1, rotation: 0, fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    strokes: [], effects: [], getSharedPluginData() { return ''; },
    async exportAsync(settings) { calls.push({ id, settings }); return settings.format === 'PNG' ? png : svg; },
    ...overrides,
  });
  const figma = { mixed: Symbol('mixed'), command: '', root: { name: 'Raster fixtures' },
    currentPage: { id: 'page', selection: [], on() {}, off() {} },
    ui: { postMessage() {}, onmessage: null }, showUI() {}, on() {} };
  const plugin = { figma, __html__: '', console, setTimeout, clearTimeout,
    btoa: value => Buffer.from(value, 'binary').toString('base64') };
  vm.runInNewContext(code, plugin);
  const context = () => ({
    sourceId: 'raster', exportId: 'test', assets: [], assetBytes: 0, warnings: [], diagnostics: [],
    options: { responsiveMode: 'pixel' }, restNodesById: new Map(), geometryLayoutCache: new Map(),
    rules: [], baseOverrides: [], responsiveRules: { notebook: [], tablet: [], mobile: [] },
    imageHashes: new Map(), pendingImageHashes: new Set(), failedImageHashes: new Set(),
    variableCssNames: new Map(), fonts: new Map(), fontUsage: new Map(),
    rootBounds: { x: 0, y: 0, width: 1440, height: 900 },
    nodeCount: 0, selectionCount: 1, estimatedNodes: 10, richTextSegments: 0,
    semanticNodes: 0, rasterizedNodes: 0, vectorFallbackNodes: 0, imageFallbackNodes: 0,
    absoluteRootNames: [],
  });
  return { plugin, source, context, calls };
}

test('medium and large vectors become ordinary PNG assets without SVG attempts or warnings', async () => {
  const { plugin, source, context, calls } = fixture();
  for (const size of [25, 48, 512, 1440, 3000]) {
    const state = context();
    const node = source(`vector-${size}`, { width: size, height: size });
    const html = await plugin.renderNode(node, null, state);
    assert.match(html, /^<img /);
    assert.equal(state.assets.length, 1);
    assert.equal(state.assets[0].mimeType, 'image/png');
    assert.equal(state.rasterizedNodes, 1);
    assert.equal(state.vectorFallbackNodes, 0);
    assert.deepEqual(state.warnings, []);
    assert.deepEqual(state.diagnostics, []);
    assert.match(state.rules[0], /padding:0;/);
    assert.match(state.rules[0], /object-fit:fill/);
  }
  assert.ok(calls.every(call => call.settings.format === 'PNG'));
  assert.deepEqual(calls.map(call => call.settings.constraint.value), [4, 4, 4, 2, 1]);
});

test('only small, simple icons retain SVG; effects, masks and gradients use PNG', async () => {
  const { plugin, source, context, calls } = fixture();
  const small = { width: 24, height: 24 };
  const candidates = [
    source('simple', small),
    source('mask', { ...small, isMask: true }),
    source('shadow', { ...small, effects: [{ type: 'DROP_SHADOW' }] }),
    source('blend', { ...small, blendMode: 'MULTIPLY' }),
    source('gradient', { ...small, fills: [{ type: 'GRADIENT_LINEAR' }] }),
    source('image', { ...small, fills: [{ type: 'IMAGE', imageHash: 'bitmap' }] }),
    source('overflow', { ...small, absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
      absoluteRenderBounds: { x: -4, y: -4, width: 32, height: 32 } }),
  ];
  for (const node of candidates) await plugin.renderNode(node, null, context());
  assert.deepEqual(calls.map(call => call.settings.format), ['SVG_STRING', 'PNG', 'PNG', 'PNG', 'PNG', 'PNG', 'PNG']);
});

test('a small SVG failure followed by a successful PNG does not create warning spam', async () => {
  const { plugin, source, context } = fixture();
  const state = context();
  const node = source('tiny-fallback', { width: 16, height: 16,
    async exportAsync(settings) { return settings.format === 'PNG' ? png : '<svg><use href="#missing"/></svg>'; } });
  await plugin.renderNode(node, null, state);
  assert.equal(state.assets[0].mimeType, 'image/png');
  assert.deepEqual(state.warnings, []);
  assert.deepEqual(state.diagnostics, []);
});

test('vector artwork stays one composition while ordinary text groups stay editable', async () => {
  const { plugin, source, context, calls } = fixture();
  const artwork = source('artwork', { type: 'GROUP', children: [source('left'), source('right')] });
  const state = context();
  const html = await plugin.renderNode(artwork, null, state);
  assert.equal(state.assets.length, 1);
  assert.deepEqual(calls.map(call => call.id), ['artwork']);
  assert.doesNotMatch(html, /data-figma-id="(?:left|right)"/);
  const text = source('copy', { type: 'TEXT', characters: 'Still editable', fontSize: 18,
    fontName: { family: 'Sora', style: 'Regular' }, getStyledTextSegments() { return []; } });
  const content = source('content', { type: 'GROUP', children: [text, source('icon')] });
  const contentHtml = await plugin.renderNode(content, null, context());
  assert.match(contentHtml, /Still editable/);
  assert.equal(calls.some(call => call.id === 'content' || call.id === 'copy'), false);
});

test('render bounds preserve shadow/cap geometry without internal padding or paint duplication', async () => {
  const { plugin, source, context, calls } = fixture();
  const node = source('shadowed', { width: 100, height: 80, paddingLeft: 30, paddingTop: 20,
    absoluteBoundingBox: { x: 50, y: 60, width: 100, height: 80 },
    absoluteRenderBounds: { x: 42, y: 56, width: 116, height: 92 } });
  const state = context();
  const html = await plugin.renderNode(node, null, state);
  assert.match(html, /^<div [^>]+><img /);
  assert.equal(calls[0].settings.useAbsoluteBounds, false);
  assert.match(state.rules.join('\n'), /left:-8%;top:-5%;width:116%;height:115%/);
  assert.ok(state.rules.every(rule => rule.includes('padding:0')));
  assert.doesNotMatch(state.rules.join('\n'), /padding:(?:20|30)|box-shadow/);
  assert.equal(state.assets[0].width, 116);
  assert.equal(state.assets[0].height, 92);
});

test('PNG retries high resolution progressively and reports only a real complete failure', async () => {
  const { plugin, source, context } = fixture();
  const scales = [];
  const node = source('retry', { async exportAsync(settings) {
    scales.push(settings.constraint.value);
    if (settings.constraint.value === 4) throw new Error('Render limit');
    return png;
  } });
  const state = context();
  await plugin.renderNode(node, null, state);
  assert.deepEqual(scales, [4, 2]);
  assert.deepEqual(state.warnings, []);
  const failed = context();
  await plugin.renderNode(source('failure', { async exportAsync() { throw new Error('Native export failed'); } }), null, failed);
  assert.equal(failed.assets.length, 0);
  assert.equal(failed.warnings.length, 1);
  assert.match(failed.warnings[0], /exact PNG export failed/);
  assert.doesNotMatch(failed.warnings.join(''), /SVG/);
});
