import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import sharp from 'sharp';

const code = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const gif = new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
const secondFrameStart = gif.indexOf(0x2c, 13);
const animatedGif = new Uint8Array([...gif.slice(0, -1), ...gif.slice(secondFrameStart)]);
const calls = [];
const embeddedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs><clipPath id="clip"><rect width="200" height="100"/></clipPath></defs><g clip-path="url(#clip)"><image width="400" height="200" transform="matrix(1.7 .3 -.2 1.2 -100 -40)" href="data:image/png;base64,AA=="/></g></svg>';
function node(id, overrides = {}) {
  return {
    id, name: id, type: 'RECTANGLE', visible: true, width: 200, height: 100, x: 0, y: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    opacity: 1, rotation: 0, fills: [], strokes: [], effects: [],
    getSharedPluginData: () => '', getCSSAsync: async () => ({}),
    async exportAsync(settings) {
      calls.push([id, settings]);
      if (settings.format === 'JSON_REST_V1') return { document: { id, type: this.type } };
      if (settings.format === 'PNG') return png;
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 208 12"><path d="M4 6H204" stroke="black" stroke-width="8" stroke-linecap="round"/></svg>';
    },
    ...overrides,
  };
}
const crop = node('crop', {
  fills: [{ type: 'IMAGE', imageHash: 'crop-source', scaleMode: 'CROP', imageTransform: [[.5, .1, .2], [-.2, .7, .1]] }],
  async exportAsync(settings) {
    calls.push(['crop', settings]);
    if (settings.format === 'JSON_REST_V1') return { document: { id: 'crop', type: 'RECTANGLE' } };
    if (settings.format === 'PNG') return png;
    return embeddedSvg;
  },
});
const tile = node('tile', {
  fills: [{ type: 'IMAGE', imageHash: 'tile-source', scaleMode: 'TILE', scalingFactor: .25 }],
  paddingTop: 50, paddingLeft: 50, layoutMode: 'HORIZONTAL',
});
const animated = node('gif', { fills: [{ type: 'IMAGE', imageHash: 'gif-source', scaleMode: 'FILL' }] });
const layeredImage = node('layered-image', {
  fills: [{ type: 'IMAGE', imageHash: 'layered-image-source', scaleMode: 'FILL' }],
  strokes: [
    { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: .75 },
    { type: 'SOLID', color: { r: 0, g: 0, b: 1 }, opacity: .25 },
  ],
  strokeWeight: 4, strokeAlign: 'INSIDE',
  async exportAsync(settings) {
    calls.push(['layered-image', settings]);
    if (settings.format === 'JSON_REST_V1') return { document: { id: 'layered-image', type: 'RECTANGLE' } };
    assert.equal(settings.format, 'PNG', 'Layered strokes on an image must use the complete native PNG composition');
    return png;
  },
});
const line = node('line', {
  type: 'LINE', width: 200, height: 0, strokeWeight: 8,
  absoluteBoundingBox: { x: 50, y: 100, width: 200, height: 0 },
  absoluteRenderBounds: { x: 46, y: 96, width: 208, height: 8 },
  async exportAsync(settings) {
    calls.push(['line', settings]);
    if (settings.format === 'JSON_REST_V1') return { document: { id: 'line', type: 'LINE' } };
    if (settings.format === 'PNG') return png;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="208" height="8" viewBox="0 0 208 8"><path d="M4 4H204" stroke="black" stroke-width="8" stroke-linecap="round"/></svg>';
  },
});
const group = node('artwork', { type: 'GROUP', children: [node('path-a', { type: 'VECTOR' }), node('path-b', { type: 'VECTOR' })] });
const groupWithText = node('content', { type: 'GROUP', children: [node('paragraph', { type: 'TEXT', characters: 'Editable copy' })] });
const figma = {
  mixed: Symbol('mixed'), showUI() {}, command: '', on() {},
  root: { name: 'Media fidelity fixtures' },
  currentPage: { id: 'page', name: 'Page', selection: [crop, tile, animated, layeredImage, line, group], on() {} },
  ui: { postMessage() {} },
  variables: { getLocalVariablesAsync: async () => [], getLocalVariableCollectionsAsync: async () => [] },
  getImageByHash(hash) {
    assert.notEqual(hash, 'crop-source', 'Native crop export should not duplicate the original bitmap');
    assert.notEqual(hash, 'layered-image-source', 'Original-image shortcut must not bypass the layered stroke export');
    return {
      getBytesAsync: async () => hash === 'gif-source' ? gif : png,
      getSizeAsync: async () => ({ width: 800, height: 400 }),
    };
  },
};
const sandbox = { figma, __html__: '', console, setTimeout, clearTimeout, btoa: value => Buffer.from(value, 'binary').toString('base64') };
vm.runInNewContext(code, sandbox, { filename: 'FigmaPlugin/code.js' });
const payload = await sandbox.buildPayload({ responsiveMode: 'pixel' });
const classFor = id => payload.html.match(new RegExp(`class="([^"]+)"[^>]*data-figma-id="${id}"`))[1];
const ruleFor = id => payload.css.match(new RegExp(`\\.${classFor(id)}\\{([^}]+)\\}`))[1];

assert.ok(payload.assets.some(asset => asset.mimeType === 'image/png'), 'Crop must keep the native pixels after affine sampling and clipping');
assert.deepEqual(calls.filter(([id, settings]) => id === 'crop' && settings.format !== 'JSON_REST_V1').map(([, settings]) => settings.format), ['PNG']);
assert.equal(sandbox.shouldUseOriginalImageNode(crop), false, 'CROP must never fall into the cover/focal approximation');
assert.match(ruleFor('tile'), /background-size:200px 100px/, 'Tile dimensions must multiply natural pixels by scalingFactor');
assert.match(ruleFor('tile'), /background-repeat:repeat/);
assert.match(ruleFor('tile'), /padding:0(?:;|$)/);
assert.doesNotMatch(ruleFor('tile'), /padding:50|display:flex/);
assert.ok(payload.assets.some(asset => asset.mimeType === 'image/gif'), 'Ordinary GIF keeps its original animated bytes');
assert.equal(calls.some(([id, settings]) => id === 'gif' && settings.format !== 'JSON_REST_V1'), false);
assert.equal(sandbox.shouldUseOriginalImageNode(layeredImage), false, 'Multiple solid strokes make the raw-image shortcut lossy');
assert.deepEqual(calls.filter(([id, settings]) => id === 'layered-image' && settings.format !== 'JSON_REST_V1').map(([, settings]) => settings.format), ['PNG']);
const layeredImageAsset = payload.assets.find(asset => asset.mimeType === 'image/png');
assert.ok(layeredImageAsset, 'The snapshot asset must retain the bitmap and both stroke paints with their individual alpha');
assert.match(payload.html, new RegExp(`data-figma-id="layered-image"[^>]*src="figma-asset://${layeredImageAsset.id}"`));
assert.match(ruleFor('layered-image'), /padding:0(?:;|$)/);
assert.doesNotMatch(ruleFor('layered-image'), /border:(?!0(?:;|$))/, 'Snapshot strokes must not be repainted as a single CSS border');

assert.match(payload.html, new RegExp(`<div class="${classFor('line')}"[^>]+><img class="${classFor('line')}-paint"`));
assert.match(ruleFor('line'), /width:200px/);
assert.match(ruleFor('line'), /overflow:visible/);
assert.match(ruleFor('line'), /min-height:0(?:;|$)/, 'Visible stroke must not add an artificial gap to zero-height line layout');
assert.match(payload.css, /left:-2%;top:-4px;width:104%;height:8px/, 'The line cap pixels must sit outside its unchanged layout footprint');
assert.equal(calls.find(([id, settings]) => id === 'line' && settings.format === 'PNG')[1].useAbsoluteBounds, false);
assert.equal(sandbox.shouldExportSvg(group), true, 'Vector-only artwork groups stay intact as one native asset');
assert.equal(sandbox.shouldExportSvg(groupWithText), false, 'Content groups must retain editable text');
assert.equal(sandbox.shouldExportSvg(node('shape-layout', { type: 'GROUP', children: [node('card-shape')] })), false, 'Plain shape groups must remain editable rather than being mistaken for vector artwork');
assert.equal(payload.html.includes('data-figma-id="path-a"'), false, 'Artwork descendants must not drift apart into independent boxes');

const assetsContext = { assets: [], assetBytes: 0, imageHashes: new Map(), failedImageHashes: new Set(), warnings: [] };
const firstId = await sandbox.materializeImageHash('duplicate-a', assetsContext);
const secondId = await sandbox.materializeImageHash('duplicate-b', assetsContext);
assert.equal(firstId, secondId, 'Identical image bytes reuse one asset even with different source hashes');
assert.equal(assetsContext.assets.length, 1);
assert.equal(assetsContext.assetBytes, png.length, 'Reused assets must consume the budget once');
const pngContext = { assets: [], assetBytes: 0, warnings: [] };
assert.equal(await sandbox.exportPngNode(node('raster-a'), pngContext), await sandbox.exportPngNode(node('raster-b'), pngContext));
assert.equal(pngContext.assets.length, 1);
assert.equal(pngContext.assetBytes, png.length);
pngContext.assetBytes = 64 * 1024 * 1024;
assert.equal(await sandbox.exportPngNode(node('raster-budget-reuse'), pngContext), pngContext.assets[0].id, 'Reusing existing PNG remains valid at the exact asset budget');
const svgContext = { assets: [], assetBytes: 0, warnings: [] };
assert.equal(await sandbox.exportSvgNode(node('vector-a'), svgContext), await sandbox.exportSvgNode(node('vector-b'), svgContext));
assert.equal(svgContext.assets.length, 1);
svgContext.assetBytes = 64 * 1024 * 1024;
assert.equal(await sandbox.exportSvgNode(node('svg-budget-reuse'), svgContext), svgContext.assets[0].id, 'Reusing existing SVG remains valid at the exact asset budget');
assert.equal(sandbox.isAnimatedGif(gif), false, 'A single-frame GIF must not raise a lost-animation warning');
assert.equal(sandbox.isAnimatedGif(animatedGif), true, 'Animated GIF must be detected by image blocks, not MIME alone');
const animationDiagnostics = [];
sandbox.emitConversionDiagnostic = (...args) => animationDiagnostics.push(args);
figma.getImageByHash = () => ({ getBytesAsync: async () => animatedGif });
await sandbox.warnCroppedAnimationSnapshot(crop, {});
assert.equal(animationDiagnostics[0][2], 'animation-snapshot');
assert.equal(animationDiagnostics[0][4], 'diagnosticAnimationSnapshot');
const chainedSvg = '<svg viewBox="0 0 20 20"><defs><image id="bitmap" href="data:image/png;base64,AA=="/><g id="imageGroup"><use href="#bitmap"/></g><pattern id="basePattern"><use href="#imageGroup"/></pattern><pattern id="inheritedPattern" href="#basePattern"/><linearGradient id="baseGradient"><stop stop-color="red"/></linearGradient><linearGradient id="inheritedGradient" href="#baseGradient"/><path id="shape" d="M0 0h20v20H0z"/><clipPath id="clip"><use href="#shape"/></clipPath><mask id="mask"><use href="#shape" fill="white"/></mask><filter id="baseFilter"><feGaussianBlur stdDeviation="1"/></filter><filter id="filter" href="#baseFilter"/></defs><g clip-path="url(#clip)" mask="url(#mask)" filter="url(#filter)"><rect width="20" height="20" fill="url(#inheritedPattern)" stroke="url(#inheritedGradient)"/></g></svg>';
assert.equal(sandbox.usableSvgText(chainedSvg, true), true, 'Legitimate nested uses and inherited paint/filter resources must remain vector');
assert.equal(sandbox.usableSvgText(chainedSvg.replace('fill="url(#inheritedPattern)"', 'style="fill:url(\'#inheritedPattern\')"'), true), true, 'Quoted CSS fragment URLs preserve their resource links');
for (const [description, svgSource] of [
  ['empty export', '<svg></svg>'],
  ['definitions without rendered content', '<svg><defs><path id="unused" d="M0 0h10v10z"/></defs></svg>'],
  ['missing clip', '<svg><path clip-path="url(#missing)" d="M0 0h10v10z"/></svg>'],
  ['missing mask', '<svg><path mask="url(#missing)" d="M0 0h10v10z"/></svg>'],
  ['missing paint', '<svg><path fill="url(#missing)" d="M0 0h10v10z"/></svg>'],
  ['empty gradient', '<svg><defs><linearGradient id="empty"/></defs><path fill="url(#empty)" d="M0 0h10v10z"/></svg>'],
  ['cyclic use', '<svg><defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/></svg>'],
  ['HTML stripped by Builder', '<svg><foreignObject><div>Missing after import</div></foreignObject></svg>'],
  ['nested SVG removed by Builder', '<svg><image href="data:image/svg+xml;base64,AA=="/></svg>'],
  ['missing nested image', chainedSvg.replace('href="#bitmap"', 'href="#missing"')],
]) assert.equal(sandbox.usableSvgText(svgSource, false), false, `Unusable SVG (${description}) must trigger native fallback before import`);
assert.equal(sandbox.usableSvgText('<svg><defs><pattern id="unused"/></defs><path d="M0 0h10v10z"/></svg>', false), true, 'Unused empty definitions do not damage the visible SVG');
const stretchSource = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><rect width="100" height="100" fill="red"/></svg>';
const stretchNode = node('responsive-background', { exportAsync: async () => stretchSource });
const stretchContext = { assets: [], assetBytes: 0, warnings: [] };
const artworkId = await sandbox.exportSvgNode(stretchNode, stretchContext);
const backgroundId = await sandbox.exportSvgNode(stretchNode, stretchContext, true);
assert.notEqual(artworkId, backgroundId, 'Stretched paint must never reuse and mutate ordinary SVG artwork');
assert.equal(stretchContext.assets[0].text, stretchSource);
assert.match(stretchContext.assets[1].text, /viewBox="0 0 100 100"/);
assert.match(stretchContext.assets[1].text, /preserveAspectRatio="none"/);
assert.doesNotMatch(stretchContext.assets[1].text, /xMidYMid meet/);
assert.equal(await sandbox.exportSvgNode(stretchNode, stretchContext), artworkId);
assert.equal(await sandbox.exportSvgNode(stretchNode, stretchContext, true), backgroundId);
assert.equal(stretchContext.assets.length, 2);
assert.equal(stretchContext.assetBytes, Buffer.byteLength(stretchSource) + Buffer.byteLength(stretchContext.assets[1].text), 'Normalization must precede asset budgeting and deduplication');
const normalPixels = await sharp(Buffer.from(stretchSource)).ensureAlpha().raw().toBuffer();
const stretchPixels = await sharp(Buffer.from(stretchContext.assets[1].text)).ensureAlpha().raw().toBuffer();
assert.equal(normalPixels[3], 0, 'Ordinary SVG aspect ratio preserves intentional letterboxing');
assert.equal(stretchPixels[3], 255, 'Sampled background must paint the full resized viewport without letterboxing');
const nestedAspect = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMinYMin slice"><image preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,AA=="/></svg>';
assert.match(sandbox.stretchSvgBackground(nestedAspect), /<image preserveAspectRatio="xMidYMid meet"/, 'Only the root aspect ratio changes');
console.log('Figma media fidelity: native PNG crop, small SVG validation, natural tile sizing, GIF, render bounds, vector groups and asset reuse passed.');
