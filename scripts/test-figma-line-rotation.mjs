import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { parseFragment } from 'parse5';
import postcss from 'postcss';
import sharp from 'sharp';

const source = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const figma = { mixed: Symbol('mixed'), command: '', currentPage: { selection: [] },
  root: { name: 'Line geometry fixture' }, ui: { postMessage() {} }, showUI() {}, on() {} };
const plugin = { figma, __html__: '', console, setTimeout, clearTimeout,
  btoa: value => Buffer.from(value, 'binary').toString('base64') };
vm.runInNewContext(source, plugin);
const context = () => ({ options: { responsiveMode: 'pixel' }, nodeCount: 0, estimatedNodes: 4,
  rules: [], baseOverrides: [], responsiveRules: { notebook: [], tablet: [], mobile: [] },
  assets: [], assetBytes: 0, warnings: [], sourceId: 'lines', exportId: 'lines',
  restNodesById: new Map(), geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
  variableCssNames: new Map(), fonts: new Map(), fontUsage: new Map(), richTextSegments: 0,
  selectionCount: 1, absoluteRootNames: [], rootBounds: { x: 0, y: 0, width: 40, height: 40 },
});
const parent = { id: 'line-parent', name: 'Icon', type: 'FRAME', layoutMode: 'NONE',
  x: 100, y: 200, width: 40, height: 40, rotation: 0,
  absoluteBoundingBox: { x: 100, y: 200, width: 40, height: 40 },
  absoluteTransform: [[1, 0, 100], [0, 1, 200]], children: [] };
function line(degrees, extra = 0) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians)) < 1e-8 ? 0 : Math.cos(radians);
  const sin = Math.abs(Math.sin(radians)) < 1e-8 ? 0 : Math.sin(radians);
  const x = 20 - 9 * cos;
  const y = 20 + 9 * sin;
  const left = Math.min(x, x + 18 * cos);
  const top = Math.min(y, y - 18 * sin);
  const width = Math.abs(18 * cos);
  const height = Math.abs(18 * sin);
  const expansion = 1 + extra;
  const render = { x: left - expansion, y: top - expansion, width: width + 2 * expansion, height: height + 2 * expansion };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${render.width}" height="${render.height}" viewBox="0 0 ${render.width} ${render.height}"><path d="M${x - render.x} ${y - render.y}L${x + 18 * cos - render.x} ${y - 18 * sin - render.y}" stroke="#8877ff" stroke-width="2" stroke-linecap="round"/></svg>`;
  return { id: `line-${degrees}-${extra}`, name: `Line ${degrees}`, type: 'LINE', visible: true,
    x, y, width: 18, height: 0, rotation: degrees, opacity: 1, strokeWeight: 2,
    absoluteBoundingBox: { x: left + 100, y: top + 200, width, height },
    absoluteRenderBounds: { ...render, x: render.x + 100, y: render.y + 200 },
    relativeTransform: [[cos, sin, x], [-sin, cos, y]],
    absoluteTransform: [[cos, sin, x + 100], [-sin, cos, y + 200]],
    strokes: [{ type: 'SOLID', color: { r: 136 / 255, g: 119 / 255, b: 1 } }], fills: [], effects: [],
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    getSharedPluginData: () => '',
    exportAsync: async settings => {
      assert.equal(settings.useAbsoluteBounds, false, 'Native line bounds include caps and other pixels outside zero-height geometry');
      if (settings.format === 'SVG_STRING') return svg;
      if (settings.format === 'PNG') return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
      throw new Error(`Unexpected export ${settings.format}`);
    },
    expected: { x: left, y: top, width, height, paint: render }, svg };
}
async function renderLine(node, customParent = parent, renderer = plugin) {
  const fixtureContext = context();
  const html = await renderer.renderNode(node, customParent, fixtureContext);
  const root = parseFragment(html).childNodes[0];
  const className = root.attrs.find(attribute => attribute.name === 'class').value;
  const ast = postcss.parse(fixtureContext.rules.join('\n'));
  const declarations = selector => Object.fromEntries((ast.nodes.find(rule => rule.selector === selector)?.nodes || [])
    .filter(item => item.type === 'decl').map(item => [item.prop, item.value]));
  return { html, context: fixtureContext, css: fixtureContext.rules.join('\n'), root,
    base: declarations(`.${className}`), paint: declarations(`.${className}-paint`) };
}
for (const degrees of [0, 90, -90, 180]) {
  test(`${degrees} degree native LINE keeps the transformed zero-axis footprint and both caps`, async () => {
    const node = line(degrees);
    const result = await renderLine(node);
    assert.equal(result.root.tagName, 'div', 'Paint bounds require a layout wrapper');
    assert.equal(result.base.left, `${node.expected.x}px`);
    assert.equal(result.base.top, `${node.expected.y}px`);
    assert.equal(result.base.width, `${node.expected.width}px`);
    assert.equal(result.base.height, `${node.expected.height}px`);
    assert.equal(result.base.transform, undefined, 'Native pixels must not be rotated twice');
    assert.equal(result.base.overflow, 'visible');
    assert.equal(result.base[node.expected.width === 0 ? 'min-width' : 'min-height'], '0');
    assert.ok(result.paint.width && result.paint.height);
    assert.equal(result.context.assets[0].mimeType, 'image/svg+xml');
    assert.equal(result.context.assets[0].text, node.svg);
  });
}

test('extra paint bounds from arrows and shadows remain outside the rotated line footprint', async () => {
  const node = line(90, 4);
  const result = await renderLine(node);
  assert.equal(result.base.width, '0px');
  assert.equal(result.base.height, '18px');
  assert.equal(result.paint.left, '-5px');
  assert.equal(result.paint.width, '10px');
  assert.ok(Math.abs(parseFloat(result.paint.top) - (-5 / 18 * 100)) <= 0.01);
  assert.ok(Math.abs(parseFloat(result.paint.height) - (28 / 18 * 100)) <= 0.01);
  assert.equal(result.base.overflow, 'visible');
});

test('rotation correction is isolated from other assets, rotated parents and flow items', () => {
  const node = line(90);
  assert.equal(plugin.rotatedLineSnapshotGeometry({ ...node, type: 'VECTOR' }, parent, context()), null);
  assert.equal(plugin.rotatedLineSnapshotGeometry(node, { ...parent, absoluteTransform: [[0, 1, 100], [-1, 0, 200]] }, context()), null);
  assert.equal(plugin.rotatedLineSnapshotGeometry(node, { ...parent, layoutMode: 'HORIZONTAL' }, context()), null);
  assert.equal(plugin.rotatedLineSnapshotGeometry({ ...node, absoluteRenderBounds: null }, parent, context()), null);
  assert.equal(plugin.rotatedLineSnapshotGeometry(node, null, context()), null);
});

if (process.argv.includes('--visual')) {
  test('Chromium: separate horizontal and rotated lines form a centered plus, not an L', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 40, height: 40 }, deviceScaleFactor: 1 });
      await page.route('**/*', request => request.abort());
      const baseline = { ...plugin };
      vm.runInNewContext(source, baseline);
      // Disable only the new LINE correction in memory to reproduce the previous path.
      baseline.rotatedLineSnapshotGeometry = () => null;
      const artifacts = await mkdtemp(join(tmpdir(), 'figma-line-rotation-'));
      const renderScreenshot = async (renderer, name) => {
        const results = await Promise.all([renderLine(line(0), parent, renderer), renderLine(line(90), parent, renderer)]);
        const body = results.map(result => {
          let html = result.html;
          for (const asset of result.context.assets) html = html.replaceAll(`figma-asset://${asset.id}`, `data:image/svg+xml;base64,${Buffer.from(asset.text).toString('base64')}`);
          return html;
        }).join('');
        const document = `<style>html,body{margin:0;width:40px;height:40px;background:white;position:relative}${results.map(result => result.css).join('\n')}</style>${body}`;
        await page.setContent(document);
        await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
        const screenshot = await page.screenshot({ path: join(artifacts, `${name}.png`) });
        await writeFile(join(artifacts, `${name}.html`), document);
        const pixels = await sharp(screenshot).ensureAlpha().raw().toBuffer();
        return (x, y) => pixels[(y * 40 + x) * 4] < 200 && pixels[(y * 40 + x) * 4 + 2] > 200;
      };
      const paintedBefore = await renderScreenshot(baseline, 'before');
      assert.equal(paintedBefore(20, 12), false, 'Baseline reproduces the missing upper arm');
      assert.equal(paintedBefore(20, 27), false, 'Baseline reproduces the missing lower arm');
      assert.equal(paintedBefore(12, 20), true, 'Baseline retains the horizontal line');
      const painted = await renderScreenshot(plugin, 'after');
      for (const [x, y] of [[20, 12], [20, 27], [12, 20], [27, 20], [20, 20]]) assert.equal(painted(x, y), true, `Cross arm must exist at ${x},${y}`);
      for (const [x, y] of [[27, 12], [12, 12], [27, 27]]) assert.equal(painted(x, y), false, `No L/corner artifact at ${x},${y}`);
      console.log(`Native LINE before/after pixel artifacts: ${artifacts}`);
    } finally { await browser.close(); }
  });
}
