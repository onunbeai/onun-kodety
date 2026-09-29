import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import { parseFragment } from 'parse5';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const pluginCode = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const white = { r: 1, g: 1, b: 1 };
const gradientStroke = {
  type: 'GRADIENT_LINEAR', opacity: 0.5,
  gradientHandlePositions: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 0 }],
  gradientStops: [
    { position: 0, color: { ...white, a: 0.6 } },
    { position: 1, color: { ...white, a: 0 } },
  ],
};

async function renderFixture(overrides = {}, parent = null) {
  const text = {
    id: 'stroke:text', name: 'Label', type: 'TEXT', visible: true,
    x: 24, y: 16, width: 200, height: 24,
    characters: 'Começar agora', fontSize: 18, fontWeight: 600,
    fontName: { family: 'Inter', style: 'Semi Bold' },
    fills: [{ type: 'SOLID', color: white }], textAutoResize: 'WIDTH_AND_HEIGHT',
    getCSSAsync: async () => ({}), getStyledTextSegments: () => [],
    getSharedPluginData: () => '',
  };
  const button = {
    id: 'stroke:button', name: 'Button', type: 'FRAME', visible: true,
    x: 0, y: 0, width: 248, height: 56, opacity: 1, rotation: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: 248, height: 56 },
    layoutMode: 'HORIZONTAL', layoutWrap: 'NO_WRAP',
    primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
    itemSpacing: 8, paddingTop: 16, paddingRight: 24, paddingBottom: 16, paddingLeft: 24,
    fills: [{ type: 'SOLID', color: { r: 100 / 255, g: 64 / 255, b: 208 / 255 } }],
    strokes: [gradientStroke], strokeWeight: 1, strokeAlign: 'INSIDE', cornerRadius: 16,
    effects: [
      { type: 'INNER_SHADOW', visible: true, offset: { x: 0, y: 1 }, radius: 4, spread: 0, color: { ...white, a: 0.2 }, blendMode: 'NORMAL' },
      { type: 'DROP_SHADOW', visible: true, offset: { x: 0, y: 6 }, radius: 12, spread: -2, color: { r: 0, g: 0, b: 0, a: 0.25 }, blendMode: 'NORMAL' },
    ],
    children: [text],
    getSharedPluginData: () => '',
    getCSSAsync: async () => ({
      border: '1px solid rgb(255,255,255)', 'border-color': '#fff',
      'border-top-color': '#fff', outline: '1px solid white',
      'box-shadow': '0px 0px 0px 999px white',
    }),
    ...overrides,
  };
  const figma = {
    mixed: Symbol('mixed'), command: '',
    root: { name: 'Gradient stroke fixture' },
    currentPage: { id: 'page:stroke', selection: [button], on() {}, off() {} },
    ui: { postMessage() {}, onmessage: null }, showUI() {}, on() {},
  };
  const plugin = { figma, __html__: '', console, setTimeout, clearTimeout,
    btoa: value => Buffer.from(value, 'binary').toString('base64') };
  vm.runInNewContext(pluginCode, plugin, { filename: 'FigmaPlugin/code.js' });
  const context = {
    assets: [], assetBytes: 0, warnings: [], nodeCount: 0, estimatedNodes: 2,
    imageHashes: new Map(), failedImageHashes: new Set(), pendingImageHashes: new Set(),
    variableCssNames: new Map(), backgroundAssets: new Map(),
    options: { responsiveMode: 'safe' }, restNodesById: new Map(),
    geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
    rules: [], baseOverrides: [], responsiveRules: { notebook: [], tablet: [], mobile: [] },
    rootBounds: { x: 0, y: 0, width: 248, height: 56 },
    selectionCount: 1, sourceId: 'stroke-fixture', exportId: 'stroke-export',
    fonts: new Map(), fontUsage: new Map(), richTextSegments: 0,
    semanticNodes: 0, absoluteRootNames: [],
  };
  if (parent) parent.children = [button];
  const html = await plugin.renderNode(button, parent, context);
  const css = context.rules.join('\n');
  const ast = postcss.parse(css);
  const element = parseFragment(html).childNodes[0];
  const className = element.attrs.find(attribute => attribute.name === 'class').value;
  const baseRule = ast.nodes.find(rule => rule.selector === `.${className}`);
  const strokeRule = ast.nodes.find(rule => rule.selector === `.${className}::after`);
  const declarations = rule => Object.fromEntries((rule?.nodes || [])
    .filter(item => item.type === 'decl').map(item => [item.prop, item.value]));
  return { html, css, context, plugin, button, element, className, base: declarations(baseRule), stroke: declarations(strokeRule), strokeRule };
}

test('a fading gradient stroke stays a masked ring around an editable button', async () => {
  const result = await renderFixture();
  assert.equal(result.element.tagName, 'button');
  assert.match(result.html, /<span\b[^>]*data-figma-id="stroke:text"[^>]*>Começar agora<\/span>/);
  assert.equal(result.context.assets.length, 0, 'gradient strokes should not flatten the button into an asset');
  assert.ok(result.strokeRule, 'the stroke needs its own pseudo-element');
  assert.equal(result.stroke.content, '""');
  assert.equal(result.stroke['pointer-events'], 'none');
  assert.equal(result.stroke['mask-composite'], 'exclude');
  assert.equal(result.stroke['-webkit-mask-composite'], 'xor');
  assert.match(result.stroke.mask || '', /content-box/);
  assert.match(result.stroke['-webkit-mask'] || '', /content-box/);
  const paint = result.stroke['background-image'] || result.stroke.background || '';
  assert.match(paint, /linear-gradient\(/);
  assert.match(paint, /rgb\(255 255 255 \/ 30%\)/, 'stroke opacity and first-stop alpha must multiply');
  assert.match(paint, /rgb\(255 255 255 \/ 0%\)/, 'the bottom stop must remain transparent');
});

test('native solid-border CSS cannot replace the gradient; fill, padding, and radius stay authored', async () => {
  const { base, css } = await renderFixture();
  assert.equal(base['background-color'], 'rgb(100 64 208)');
  assert.equal(base.padding, '16px 24px 16px 24px');
  assert.equal(base['border-radius'], '16px');
  assert.equal(base.display, 'flex');
  assert.equal(base['flex-direction'], 'row');
  assert.notEqual(base.border, '1px solid rgb(255,255,255)');
  assert.notEqual(base['border-color'], '#fff');
  assert.notEqual(base['border-top-color'], '#fff');
  assert.notEqual(base.outline, '1px solid white');
  assert.ok(base.border === '0' || base.border === 'none' || /transparent/.test(base.border || '')
    || base['border-color'] === 'transparent' || /^(?:0(?:px)?\s*)+$/.test(base['border-width'] || '')
    || base['border-style'] === 'none', 'the authored ring must not reveal the browser default button border');
  assert.doesNotMatch(css, /999px white|!important/);
});

test('a gradient-stroked leaf anchors its ring locally when placed inside Auto Layout', async () => {
  const parent = { id: 'stroke:parent', name: 'Row', type: 'FRAME', layoutMode: 'HORIZONTAL',
    width: 600, height: 100, children: [], getSharedPluginData: () => '' };
  const { base, strokeRule } = await renderFixture({
    type: 'RECTANGLE', name: 'Gradient box', layoutMode: 'NONE', children: [],
  }, parent);
  assert.ok(strokeRule);
  assert.equal(base.position, 'relative');
});

for (const [alignment, expansion, radius] of [
  ['INSIDE', 0, 'inherit'],
  ['CENTER', 0.5, '20px 18px 18px 20px / 17px 17px 19px 19px'],
  ['OUTSIDE', 1, '24px 20px 20px 24px / 18px 18px 22px 22px'],
]) {
  for (const reserve of [false, true]) {
    test(`${alignment} asymmetric stroke ${reserve ? 'reserves' : 'does not reserve'} layout space without shifting its painted ring`, async () => {
      const weights = [2, 4, 6, 8];
      const { base, stroke, element, context } = await renderFixture({
        strokeAlign: alignment, strokeWeight: undefined,
        strokeTopWeight: weights[0], strokeRightWeight: weights[1],
        strokeBottomWeight: weights[2], strokeLeftWeight: weights[3],
        strokesIncludedInLayout: reserve,
        getCSSAsync: async () => ({}),
      });
      assert.equal(element.tagName, 'button');
      assert.equal(context.assets.length, 0);
      assert.equal(base['box-sizing'], 'border-box');
      assert.equal(base.width, '248px');
      assert.equal(base.height, '56px');
      assert.equal(base.padding, '16px 24px 16px 24px', 'a stroke must not be folded into authored padding');
      assert.equal(base['border-width'], (reserve ? weights : [0, 0, 0, 0]).map(value => `${value}px`).join(' '));
      assert.equal(base['border-style'], 'solid');
      assert.equal(base['border-color'], 'transparent');
      assert.equal(stroke.padding, '2px 4px 6px 8px');
      assert.equal(stroke.inset, weights.map(value => `${-value * (expansion + Number(reserve)) || 0}px`).join(' '),
        'the ring containing block starts inside the reserved border, so its inset must cancel that reserve');
      assert.equal(stroke['border-radius'], radius,
        'different horizontal/vertical stroke weights need independent corner radii to preserve the inner geometry');
    });
  }
}

for (const [alignment, expectedRadius] of [
  ['CENTER', '0px 12px 22px 32px'],
  ['OUTSIDE', '0px 14px 24px 34px'],
]) {
  test(`${alignment} uniform strokes preserve distinct authored corner radii and square corners`, async () => {
    const { base, stroke } = await renderFixture({
      strokeAlign: alignment, strokeWeight: 4,
      topLeftRadius: 0, topRightRadius: 10, bottomRightRadius: 20, bottomLeftRadius: 30,
      getCSSAsync: async () => ({}),
    });
    assert.equal(base['border-radius'], '0px 10px 20px 30px');
    assert.equal(stroke['border-radius'], expectedRadius);
  });
}

for (const alignment of ['CENTER', 'OUTSIDE']) {
  test(`${alignment} gradient strokes on clipped frames use a diagnosed native PNG without changing source clipping`, async () => {
    const calls = [];
    let exportedChildren;
    let exportedSource;
    const result = await renderFixture({
      clipsContent: true, strokeAlign: alignment,
      async exportAsync(settings) {
        assert.equal(this.clipsContent, true, 'native export must keep source child clipping enabled');
        exportedChildren = this.children;
        exportedSource = JSON.stringify(this);
        calls.push(settings);
        return new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
      },
    });
    assert.equal(calls.length, 1, 'a native PNG preserves the complete clipped composition in one pass');
    assert.equal(calls[0].format, 'PNG');
    assert.equal(calls[0].constraint.value, 4);
    assert.equal(result.context.assets.length, 1);
    assert.equal(result.context.assets[0].mimeType, 'image/png');
    assert.ok(result.context.assets[0].dataBase64, 'the native pixels include the unchanged source clipping');
    assert.match(result.html, /<img\b/);
    assert.doesNotMatch(result.html, /Começar agora/);
    assert.equal(result.strokeRule, undefined, 'a clipped CSS pseudo-element must not duplicate the native stroke');
    assert.equal(result.button.clipsContent, true);
    assert.equal(result.button.children, exportedChildren);
    assert.equal(result.button.children[0].characters, 'Começar agora');
    assert.equal(JSON.stringify(result.button), exportedSource, 'fallback conversion must not mutate the source node');
    const diagnostic = result.context.diagnostics?.find(entry => entry.code === 'stroke-snapshot');
    assert.ok(diagnostic, 'the loss of child editability needs a stroke-specific diagnosis');
    assert.equal(diagnostic.nodeId, result.button.id);
    assert.equal(diagnostic.severity, 'warning');
    assert.equal(result.context.diagnostics.some(entry => entry.code === 'stroke-clipping'), false);
  });
}

test('INSIDE gradient strokes retain editable clipped children without native snapshot fallback', async () => {
  let exports = 0;
  const result = await renderFixture({
    clipsContent: true, strokeAlign: 'INSIDE',
    async exportAsync() { exports += 1; throw new Error('INSIDE strokes do not need native snapshots'); },
  });
  assert.equal(exports, 0);
  assert.equal(result.context.assets.length, 0);
  assert.equal(result.element.tagName, 'button');
  assert.match(result.html, /Começar agora/);
  assert.ok(result.strokeRule);
  assert.equal(result.base.overflow, 'hidden');
  assert.equal(result.button.clipsContent, true);
  assert.equal(result.context.diagnostics?.some(entry => entry.code === 'stroke-snapshot') || false, false);
});

test('multiple inner and drop shadows keep alpha, signed spread, and ordering', async () => {
  const { base } = await renderFixture();
  assert.equal(base['box-shadow'], 'inset 0px 1px 4px 0px rgb(255 255 255 / 20%),0px 6px 12px -2px rgb(0 0 0 / 25%)');
});

test('ordinary solid strokes remain native borders rather than empty gradient pseudo-elements', async () => {
  const { base, strokeRule } = await renderFixture({
    strokes: [{ type: 'SOLID', color: white, opacity: 0.5 }],
    getCSSAsync: async () => ({}),
  });
  assert.equal(base.border, '1px solid rgb(255 255 255 / 50%)');
  assert.equal(strokeRule, undefined);
});

test('hidden strokes cannot create a visible gradient ring', async () => {
  const { strokeRule } = await renderFixture({ strokes: [{ ...gradientStroke, visible: false }], getCSSAsync: async () => ({}) });
  assert.equal(strokeRule, undefined);
});

test('Builder import preserves pseudo-element masks, empty content, gradient alpha, and editable button', async () => {
  const result = await renderFixture();
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
    plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
  try {
    const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
    const { createBlankProject } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
    const { KODETY_FIGMA_SIGNATURE, KODETY_FIGMA_VERSION } = await server.ssrLoadModule('/lib/figma/types.ts');
    const imported = await importKodetyFigmaPayload(createBlankProject('Stroke round trip'), {
      signature: KODETY_FIGMA_SIGNATURE, version: KODETY_FIGMA_VERSION, source: 'figma-plugin',
      engine: { version: 5, sceneFormat: 'JSON_REST_V1' }, exportId: 'stroke-round-trip',
      exportedAt: new Date().toISOString(), documentName: 'Stroke fixture', pageName: 'Page',
      html: result.html, css: result.css, assets: [], fonts: [], variables: [], warnings: [],
      stats: { nodes: 2, assets: 0, bytes: result.html.length + result.css.length },
    }, { targetPath: '0', preferredStylesheetPath: 'styles.css' });
    const css = imported.project.files['styles.css'].text;
    const parsed = postcss.parse(css);
    const rule = parsed.nodes.find(node => node.selector === `.${result.className}::after`);
    assert.ok(rule);
    const declarations = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
    for (const property of ['content', 'mask', '-webkit-mask', 'mask-composite', '-webkit-mask-composite']) {
      assert.equal(declarations[property], result.stroke[property], `Builder must preserve ${property}`);
    }
    assert.equal(declarations['background-image'] || declarations.background, result.stroke['background-image'] || result.stroke.background);
    assert.match(imported.project.files['index.html'].text, /<button\b/);
    assert.match(imported.project.files['index.html'].text, /Começar agora/);
  } finally {
    await server.close();
  }
});
