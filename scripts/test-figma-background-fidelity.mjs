import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const pluginCode = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const pngBytes = () => new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64',
));
const gradientPaint = {
  type: 'GRADIENT_LINEAR',
  gradientTransform: [[0.6, -0.2, 0.1], [0.3, 0.8, -0.1]],
  gradientStops: [
    { position: 0, color: { r: 1, g: 0.5, b: 0, a: 1 } },
    { position: 1, color: { r: 0.2, g: 0.1, b: 0.8, a: 0.5 } },
  ],
};
const exactSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320" viewBox="0 0 600 320"><defs><linearGradient id="bg"><stop stop-color="#f80"/><stop offset="1" stop-color="#318" stop-opacity=".5"/></linearGradient></defs><path fill="url(#bg)" d="M0 0h600v320H0z"/></svg>';

function sourceNode(overrides = {}) {
  return {
    id: 'source:section', name: 'Gradient section', type: 'FRAME',
    visible: true, x: 20, y: 40, width: 600, height: 320,
    absoluteBoundingBox: { x: 20, y: 40, width: 600, height: 320 },
    layoutMode: 'VERTICAL', opacity: 0.6, rotation: 12,
    paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
    cornerRadius: 18, fills: structuredClone([gradientPaint]),
    strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    effects: [{ type: 'DROP_SHADOW', radius: 20, offset: { x: 4, y: 8 }, color: { r: 0, g: 0, b: 0, a: 0.4 } }],
    children: [{ id: 'source:text', type: 'TEXT', name: 'Heading', characters: 'Editable heading', visible: true,
      x: 24, y: 24, width: 552, height: 48, textAutoResize: 'HEIGHT', fontSize: 32, fontWeight: 700,
      fontName: { family: 'Inter', style: 'Bold' }, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
      getStyledTextSegments() { return []; }, getSharedPluginData() { return ''; } }],
    getSharedPluginData() { return ''; },
    exportAsync() { throw new Error('The source frame must never be flattened with its children'); },
    ...overrides,
  };
}

function fixture(options = {}) {
  const source = options.source || sourceNode();
  const messages = [];
  const eventHandlers = new Map();
  const temporary = [];
  const calls = [];
  const context = {
    assets: [], assetBytes: 0, warnings: [],
    imageHashes: new Map(), failedImageHashes: new Set(), pendingImageHashes: new Set(),
    variableCssNames: new Map(), backgroundAssets: new Map(),
    options: { responsiveMode: 'safe' },
    restNodesById: new Map(), geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
    rules: [], baseOverrides: [], responsiveRules: { notebook: [], tablet: [], mobile: [] },
    rootBounds: { x: 20, y: 40, width: 600, height: 320 },
    selectionCount: 1, estimatedNodes: 2, nodeCount: 0,
    sourceId: 'fixture-background', exportId: 'fixture-export',
    fonts: new Map(), fontUsage: new Map(), richTextSegments: 0,
    semanticNodes: 0, absoluteRootNames: [],
  };
  const figma = {
    mixed: Symbol('mixed'), command: '',
    root: { name: 'Background regression fixture' },
    currentPage: { id: 'page:background', selection: [source], children: [source], on() {}, off() {} },
    ui: { postMessage(message) { messages.push(message); }, onmessage: null },
    showUI() {}, on(eventName, handler) { eventHandlers.set(eventName, handler); },
    closeCalls: 0,
    closePlugin() { this.closeCalls += 1; },
    ...(options.variables ? { variables: options.variables } : {}),
    getImageByHash() { return { getBytesAsync: async () => pngBytes() }; },
    createRectangle() {
      const rectangle = {
        id: `temporary:${temporary.length + 1}`, name: 'Rectangle', type: 'RECTANGLE',
        visible: true, opacity: 1, rotation: 0, cornerRadius: 0,
        width: 100, height: 100, x: 0, y: 0, fills: [], strokes: [], effects: [],
        blendMode: 'NORMAL', removed: false, resizeCalls: [], removeCalls: 0, modeCalls: [],
        getSharedPluginData() { return ''; },
        resize(width, height) { this.width = width; this.height = height; this.resizeCalls.push([width, height]); },
        setExplicitVariableModeForCollection(collection, modeId) {
          this.modeCalls.push([collection, modeId]);
          if (options.modeSetter) options.modeSetter(collection, modeId);
        },
        remove() {
          this.removed = true;
          this.removeCalls += 1;
          figma.currentPage.children = figma.currentPage.children.filter(node => node !== this);
        },
        async exportAsync(settings) {
          calls.push({ settings, width: this.width, height: this.height,
            fills: structuredClone(this.fills), strokes: structuredClone(this.strokes),
            effects: structuredClone(this.effects), opacity: this.opacity,
            rotation: this.rotation, cornerRadius: this.cornerRadius });
          if (options.exportAsync) return options.exportAsync(settings, this, figma);
          return settings.format === 'SVG_STRING' ? exactSvg : pngBytes();
        },
      };
      temporary.push(rectangle);
      figma.currentPage.children.push(rectangle);
      return rectangle;
    },
  };
  const plugin = { figma, __html__: '', console, setTimeout: options.setTimeout || setTimeout, clearTimeout,
    btoa: value => Buffer.from(value, 'binary').toString('base64') };
  vm.createContext(plugin);
  vm.runInContext(pluginCode, plugin, { filename: 'FigmaPlugin/code.js' });
  return { plugin, figma, source, context, calls, temporary, messages, eventHandlers };
}

function assertCleanedUp(fixtureState) {
  assert.ok(fixtureState.temporary.every(node => node.removed && node.removeCalls === 1));
  assert.deepEqual(fixtureState.figma.currentPage.children, [fixtureState.source]);
  assert.deepEqual(fixtureState.figma.currentPage.selection, [fixtureState.source]);
}

test('complex-background eligibility preserves text and simple native paints', () => {
  const { plugin } = fixture();
  for (const fill of [
    gradientPaint,
    { type: 'GRADIENT_ANGULAR', gradientStops: gradientPaint.gradientStops },
    { type: 'GRADIENT_DIAMOND', gradientStops: gradientPaint.gradientStops },
    { type: 'IMAGE', imageHash: 'crop', scaleMode: 'CROP', imageTransform: [[1, 0, 0.2], [0, 1, 0]] },
    { type: 'IMAGE', imageHash: 'rotate', scaleMode: 'FILL', rotation: 20 },
    { type: 'IMAGE', imageHash: 'filtered', scaleMode: 'FILL', filters: { exposure: 0.4 } },
    { type: 'IMAGE', imageHash: 'translucent', scaleMode: 'FILL', opacity: 0.5 },
    { type: 'PATTERN', sourceNodeId: 'pattern:source' },
    { type: 'SHADER', shaderId: 'shader:source' },
  ]) {
    assert.equal(plugin.shouldMaterializeComplexBackground(sourceNode({ fills: [fill] })), true, fill.type);
  }
  for (const overrides of [
    { type: 'TEXT' },
    { fills: [] },
    { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] },
    { fills: [{ type: 'IMAGE', imageHash: 'simple', scaleMode: 'FILL', opacity: 1 }] },
    { fills: [{ ...gradientPaint, visible: false }] },
  ]) assert.equal(plugin.shouldMaterializeComplexBackground(sourceNode(overrides)), false);
});

test('only the background paints are exported; source text, layout, and effects stay editable', async () => {
  const state = fixture();
  const originalChildren = state.source.children;
  const before = JSON.stringify(state.source);
  const assetId = await state.plugin.materializeComplexBackground(state.source, state.context);
  assert.ok(assetId);
  assert.equal(state.context.backgroundAssets.get(state.source.id), assetId);
  assert.equal(state.context.assets.find(asset => asset.id === assetId).mimeType, 'image/png');
  assert.equal(state.context.assets.find(asset => asset.id === assetId).dataBase64, Buffer.from(pngBytes()).toString('base64'));
  assert.equal(JSON.stringify(state.source), before);
  assert.equal(state.source.children, originalChildren);
  assert.equal(state.source.children[0].characters, 'Editable heading');
  assert.equal(state.calls.length, 1);
  const snapshot = state.calls[0];
  assert.deepEqual([snapshot.width, snapshot.height], [600, 320]);
  assert.deepEqual(snapshot.fills, state.source.fills);
  assert.deepEqual(snapshot.strokes, []);
  assert.deepEqual(snapshot.effects, []);
  assert.equal(snapshot.opacity, 1);
  assert.equal(snapshot.rotation, 0);
  assert.equal(snapshot.cornerRadius, 0);
  assert.equal(snapshot.settings.format, 'PNG');
  assert.equal(snapshot.settings.constraint.value, 4);
  assert.equal(snapshot.settings.contentsOnly, true);
  assert.equal(snapshot.settings.useAbsoluteBounds, true);
  assertCleanedUp(state);
});

test('the materialized fill becomes a full-box background without replacing frame layout', async () => {
  const state = fixture();
  const assetId = await state.plugin.materializeComplexBackground(state.source, state.context);
  const declarations = Array.from(state.plugin.visualDeclarations(state.source, state.context));
  const css = declarations.join(';');
  assert.ok(css.includes(`figma-asset://${assetId}`));
  assert.match(css, /background-size:100% 100%/);
  assert.match(css, /background-repeat:no-repeat/);
  assert.match(css, /background-origin:border-box/);
  assert.match(css, /background-clip:border-box/);
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/, 'the sampled background must not be painted a second time in CSS');
  assert.match(css, /border-radius:18px/);
  assert.match(css, /box-shadow:/);
  const layout = Array.from(state.plugin.layoutDeclarations(state.source, null, state.context)).join(';');
  assert.match(layout, /display:flex/);
  assert.match(layout, /flex-direction:column/);
  assert.match(layout, /padding:24px 24px 24px 24px/);
  assertCleanedUp(state);
});

test('rendering a sampled section keeps its heading as editable HTML and its layout as CSS', async () => {
  const state = fixture();
  const html = await state.plugin.renderNode(state.source, null, state.context);
  assert.match(html, /<p\b[^>]*data-figma-id="source:text"[^>]*>Editable heading<\/p>/);
  assert.match(html, /data-figma-id="source:section"/);
  assert.doesNotMatch(html, /^<img\b/);
  const css = state.context.rules.join('');
  assert.match(css, /background-image:url\("figma-asset:\/\//);
  assert.match(css, /display:flex/);
  assert.match(css, /padding:24px 24px 24px 24px/);
  assertCleanedUp(state);
});

test('a composite image leaf uses one high-resolution PNG and needs no temporary background', async () => {
  const exportCalls = [];
  const source = sourceNode({
    children: [], fills: [gradientPaint, { type: 'IMAGE', imageHash: 'photo', scaleMode: 'FILL', opacity: 0.6 }],
    exportAsync: async settings => {
      exportCalls.push(settings);
      assert.equal(settings.format, 'PNG', 'complex image leaves use native pixels instead of SVG serialization');
      return pngBytes();
    },
  });
  const state = fixture({ source });
  const html = await state.plugin.renderNode(source, null, state.context);
  assert.match(html, /^<img\b/);
  assert.equal(exportCalls.length, 1);
  assert.equal(state.temporary.length, 0);
  assert.equal(state.context.assets.length, 1);
  assert.equal(state.context.assets[0].mimeType, 'image/png');
  assert.equal(state.context.assets[0].dataBase64, Buffer.from(pngBytes()).toString('base64'));
  assertCleanedUp(state);
});

test('background sampling resolves collection objects and reuses collection lookups', async () => {
  const collection = { id: 'collection:theme', name: 'Theme' };
  const lookups = [];
  const source = sourceNode({ resolvedVariableModes: { 'collection:theme': 'mode:dark' } });
  const state = fixture({ source, variables: {
    async getVariableCollectionByIdAsync(id) { lookups.push(id); return collection; },
  } });
  await state.plugin.materializeComplexBackground(source, state.context);
  await state.plugin.materializeComplexBackground(sourceNode({
    id: 'source:second', width: 620, resolvedVariableModes: { 'collection:theme': 'mode:dark' },
  }), state.context);
  assert.deepEqual(lookups, ['collection:theme']);
  assert.equal(state.temporary.length, 2);
  for (const sample of state.temporary) {
    assert.equal(sample.modeCalls.length, 1);
    assert.equal(sample.modeCalls[0][0], collection);
    assert.equal(sample.modeCalls[0][1], 'mode:dark');
  }
  assertCleanedUp(state);
});

test('legacy collection mode assignment uses the collection id without needing the newer resolver', async () => {
  const source = sourceNode({ resolvedVariableModes: { 'collection:theme': 'mode:dark' } });
  const state = fixture({ source });
  await state.plugin.materializeComplexBackground(source, state.context);
  assert.deepEqual(state.temporary[0].modeCalls, [['collection:theme', 'mode:dark']]);
  assert.ok(!(state.context.diagnostics || []).some(item => item.code === 'background-mode'));
  assertCleanedUp(state);
});

test('unavailable collection modes are diagnosed without discarding a usable sampled background', async () => {
  const source = sourceNode({ resolvedVariableModes: { 'collection:missing': 'mode:dark' } });
  const state = fixture({ source, variables: { getVariableCollectionByIdAsync: async () => null } });
  const assetId = await state.plugin.materializeComplexBackground(source, state.context);
  assert.ok(assetId);
  assert.ok(state.context.diagnostics.some(item => item.code === 'background-mode' && item.severity === 'warning'));
  assertCleanedUp(state);
});

test('blended paint warns when it depends on the backdrop but not when sealed by an opaque base', async () => {
  const blended = { ...gradientPaint, blendMode: 'MULTIPLY' };
  for (const opaqueBase of [false, true]) {
    const fills = [blended, ...(opaqueBase ? [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }] : [])];
    const state = fixture({ source: sourceNode({ fills }) });
    assert.ok(await state.plugin.materializeComplexBackground(state.source, state.context));
    const warning = (state.context.diagnostics || []).find(item => item.code === 'backdrop-blend');
    assert.equal(Boolean(warning), !opaqueBase);
    if (warning) assert.equal(warning.severity, 'warning');
    assertCleanedUp(state);
  }
});

test('solid overlays stay above image paints and only the bottom solid becomes background-color', () => {
  const state = fixture();
  const top = { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.5 };
  const bottom = { type: 'SOLID', color: { r: 0, g: 0, b: 1 } };
  state.context.imageHashes.set('fixture-photo', 'asset-photo');
  const local = { ...state.context, declarations: [] };
  const returned = state.plugin.fillCss([
    top, { type: 'IMAGE', imageHash: 'fixture-photo', scaleMode: 'FILL' }, bottom,
  ], local, state.source);
  const overlay = state.plugin.color(top.color, top.opacity);
  const background = state.plugin.color(bottom.color);
  assert.equal(returned, `background-color:${background}`);
  assert.equal(local.declarations.find(value => value.startsWith('background-image:')),
    `background-image:linear-gradient(${overlay},${overlay}),url("figma-asset://asset-photo")`);
  assert.ok(local.declarations.includes('background-size:auto,cover'));
  assert.ok(local.declarations.includes('background-origin:border-box'));
});

test('multiple translucent solids retain front-to-back order', () => {
  const state = fixture();
  const paints = [
    { type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.2 },
    { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 0.6 },
    { type: 'SOLID', color: { r: 0, g: 0, b: 1 } },
  ];
  const local = { ...state.context, declarations: [] };
  const returned = state.plugin.fillCss(paints, local, state.source);
  const colors = paints.map(paint => state.plugin.color(paint.color, paint.opacity));
  assert.equal(returned, `background-color:${colors[2]}`);
  assert.equal(local.declarations.find(value => value.startsWith('background-image:')),
    `background-image:linear-gradient(${colors[0]},${colors[0]}),linear-gradient(${colors[1]},${colors[1]})`);
});

test('PNG is a normal background render choice and creates no successful-export warnings', async () => {
  const state = fixture({ exportAsync: async settings => {
    if (settings.format !== 'PNG') throw new Error('SVG unavailable');
    return pngBytes();
  } });
  const assetId = await state.plugin.materializeComplexBackground(state.source, state.context);
  assert.ok(assetId);
  assert.equal(state.context.assets.find(asset => asset.id === assetId).mimeType, 'image/png');
  assert.deepEqual(state.calls.map(call => call.settings.format), ['PNG']);
  assert.deepEqual(state.context.warnings, []);
  assert.equal((state.context.diagnostics || []).length, 0);
  assert.equal(state.calls.at(-1).settings.constraint.type, 'SCALE');
  assertCleanedUp(state);
});

test('total export failure removes the temporary background and leaves the source intact', async () => {
  const state = fixture({ exportAsync: async () => { throw new Error('Unsupported paint export'); } });
  const before = JSON.stringify(state.source);
  const assetId = await state.plugin.materializeComplexBackground(state.source, state.context);
  assert.equal(assetId, null);
  assert.equal(state.context.backgroundAssets.has(state.source.id), false);
  assert.equal(JSON.stringify(state.source), before);
  assertCleanedUp(state);
});

test('a full asset budget never leaks a temporary rectangle or exceeds the limit', async () => {
  const state = fixture();
  state.context.assetBytes = 64 * 1024 * 1024;
  await assert.rejects(
    state.plugin.materializeComplexBackground(state.source, state.context),
    error => error.name === 'ExportAssetLimitError',
  );
  assert.equal(state.context.assetBytes, 64 * 1024 * 1024);
  assert.equal(state.context.assets.length, 0);
  assertCleanedUp(state);
});

test('cancellation during PNG export removes the temporary rectangle and never starts another attempt', async () => {
  const state = fixture({ exportAsync: async (settings, _rectangle, figma) => {
    figma.ui.onmessage({ type: 'cancel' });
    return pngBytes();
  } });
  await assert.rejects(state.plugin.materializeComplexBackground(state.source, state.context), /cancel/i);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].settings.format, 'PNG');
  assertCleanedUp(state);
});

test('temporary events do not invalidate export, but a mixed real source edit does', async () => {
  const state = fixture();
  await state.plugin.materializeComplexBackground(state.source, state.context);
  const temporaryNode = state.temporary[0];
  const before = vm.runInContext('documentRevision', state.plugin);
  // Figma may deliver creation/deletion together, after remove() has returned.
  state.plugin.handleCurrentPageNodeChange({ nodeChanges: [
    { type: 'CREATE', node: temporaryNode },
    { type: 'PROPERTY_CHANGE', node: temporaryNode, properties: ['fills'] },
    { type: 'DELETE', node: temporaryNode },
  ] });
  assert.equal(vm.runInContext('documentRevision', state.plugin), before);
  state.plugin.handleCurrentPageNodeChange({ nodeChanges: [
    { type: 'DELETE', node: temporaryNode },
    { type: 'PROPERTY_CHANGE', node: state.source.children[0], properties: ['characters'] },
  ] });
  assert.equal(vm.runInContext('documentRevision', state.plugin), before + 1);
  assertCleanedUp(state);
});

for (const closeMethod of ['ui', 'native']) {
  test(`${closeMethod} close removes the active sample before its asynchronous export finishes`, async () => {
    let releaseExport;
    const state = fixture({ exportAsync: () => new Promise(resolve => { releaseExport = resolve; }) });
    const work = state.plugin.materializeComplexBackground(state.source, state.context);
    assert.equal(state.temporary.length, 1);
    assert.equal(state.temporary[0].removed, false);
    if (closeMethod === 'ui') state.figma.ui.onmessage({ type: 'close' });
    else state.eventHandlers.get('close')();
    assertCleanedUp(state);
    assert.equal(state.figma.closeCalls, closeMethod === 'ui' ? 1 : 0);
    releaseExport(pngBytes());
    if (closeMethod === 'ui') await assert.rejects(work, /cancel/i);
    else await work;
    assertCleanedUp(state);
  });
}

test('an optional reference image times out without delaying the finished conversion', async () => {
  const delays = [];
  const source = sourceNode({ exportAsync: () => new Promise(() => {}) });
  const state = fixture({ source, setTimeout(callback, delay) {
    delays.push(delay);
    return setTimeout(callback, 0);
  } });
  const preview = await state.plugin.captureConversionPreview([source], state.context);
  assert.equal(preview.width, 600);
  assert.equal(preview.height, 320);
  assert.equal(preview.referenceDataUrl, undefined);
  assert.ok(delays.includes(4000));
  assert.equal(state.temporary.length, 0);
});
