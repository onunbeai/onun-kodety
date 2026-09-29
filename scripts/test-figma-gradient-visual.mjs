import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from 'playwright';
import sharp from 'sharp';

// Real converter output, not hand-authored CSS. The browser is always a fresh,
// isolated process with no user profile and no external requests allowed.
const pluginCode = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const baseline = process.argv.includes('--baseline');
const destination = await mkdtemp(path.join(tmpdir(), baseline ? 'kodety-gradient-before-' : 'kodety-gradient-after-'));
const node = {
  id: 'visual:button', name: '[button] Continue to Kodety', type: 'FRAME',
  visible: true, x: 0, y: 0, width: 296, height: 64, opacity: 1,
  absoluteBoundingBox: { x: 0, y: 0, width: 296, height: 64 },
  layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
  primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
  layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED',
  paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0,
  cornerRadius: 16, strokeWeight: 2, strokeAlign: 'INSIDE',
  fills: [{ type: 'SOLID', color: { r: 102 / 255, g: 72 / 255, b: 218 / 255 }, opacity: 1 }],
  strokes: [{ type: 'GRADIENT_LINEAR', opacity: 1,
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { r: 1, g: 1, b: 1, a: 0.5 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } },
    ],
  }],
  effects: [{ type: 'INNER_SHADOW', visible: true, color: { r: 1, g: 1, b: 1, a: 0.24 },
    offset: { x: 0, y: 2 }, radius: 3, spread: 0 }],
  children: [{ id: 'visual:label', name: 'Label', type: 'TEXT', visible: true,
    x: 73, y: 22, width: 150, height: 20, opacity: 1,
    absoluteBoundingBox: { x: 73, y: 22, width: 150, height: 20 },
    characters: 'Continue to Kodety', fontSize: 16, fontWeight: 600,
    fontName: { family: 'Arial', style: 'Bold' }, textAutoResize: 'WIDTH_AND_HEIGHT',
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    getStyledTextSegments() { return []; }, getSharedPluginData() { return ''; },
  }],
  getSharedPluginData() { return ''; },
  exportAsync() { throw new Error('The button and its text must not be flattened'); },
};
const original = JSON.stringify(node);
const context = {
  assets: [], assetBytes: 0, warnings: [], rules: [], baseOverrides: [],
  options: { responsiveMode: 'pixel' },
  imageHashes: new Map(), failedImageHashes: new Set(), pendingImageHashes: new Set(),
  variableCssNames: new Map(), backgroundAssets: new Map(), restNodesById: new Map(),
  geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
  responsiveRules: { notebook: [], tablet: [], mobile: [] },
  rootBounds: { x: 0, y: 0, width: 296, height: 64 }, selectionCount: 1, estimatedNodes: 2,
  nodeCount: 0, sourceId: 'gradient-visual', exportId: 'gradient-visual',
  fonts: new Map(), fontUsage: new Map(), richTextSegments: 0, semanticNodes: 0, absoluteRootNames: [],
};
const figma = {
  mixed: Symbol('mixed'), command: '', root: { name: 'Gradient visual fixture' },
  currentPage: { id: 'visual:page', selection: [node], on() {}, off() {} },
  ui: { postMessage() {} }, showUI() {}, on() {},
};
const sandbox = { figma, __html__: '', console, setTimeout, clearTimeout,
  btoa: value => Buffer.from(value, 'binary').toString('base64') };
vm.runInNewContext(pluginCode, sandbox, { filename: 'FigmaPlugin/code.js' });
const html = await sandbox.renderNode(node, null, context);
const css = context.rules.join('\n');
assert.equal(JSON.stringify(node), original, 'conversion does not mutate source design');
assert.match(html, /Continue to Kodety/);
assert.doesNotMatch(html, /<img\b/);
assert.equal(context.assets.length, 0, 'button stays native and editable');
const document = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';img-src data:"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#111;color:white;font-family:Arial,sans-serif}body{display:grid;place-items:center;width:440px;height:200px}.fixture-canvas{position:relative;width:296px;height:64px}${css}</style></head><body><div class="fixture-canvas">${html}</div></body></html>`;
await writeFile(path.join(destination, 'generated.html'), document);
await writeFile(path.join(destination, 'generated.css'), css);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 440, height: 200 }, deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort());
  await page.setContent(document);
  const target = page.locator('[data-figma-id="visual:button"]');
  const screenshot = await target.screenshot({ path: path.join(destination, 'button.png'), animations: 'disabled' });
  await page.screenshot({ path: path.join(destination, 'button-context.png'), animations: 'disabled' });
  const computed = await target.evaluate(element => {
    const style = getComputedStyle(element);
    const border = getComputedStyle(element, '::after');
    return { opacity: style.opacity, background: style.backgroundColor, boxShadow: style.boxShadow,
      radius: style.borderRadius, borderBackground: border.backgroundImage, mask: border.maskImage,
      maskComposite: border.maskComposite, pointerEvents: border.pointerEvents, content: border.content,
      text: element.textContent, tag: element.tagName, width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height };
  });
  const png = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sample = (x, y) => [...png.data.subarray((y * png.info.width + x) * 4, (y * png.info.width + x) * 4 + 4)];
  const samples = { top: sample(Math.floor(png.info.width / 2), 0), bottom: sample(Math.floor(png.info.width / 2), png.info.height - 1),
    center: sample(24, Math.floor(png.info.height / 2)), topInner: sample(Math.floor(png.info.width / 2), 3) };
  assert.equal(computed.opacity, '1', 'stroke opacity never leaks onto button or label');
  assert.equal(computed.background, 'rgb(102, 72, 218)');
  assert.match(computed.boxShadow, /inset/);
  assert.deepEqual(samples.center, [102, 72, 218, 255], 'interior keeps authored opaque purple fill');
  if (!baseline) {
    assert.match(computed.borderBackground, /linear-gradient/);
    assert.match(computed.borderBackground, /rgba\(255, 255, 255, 0\)/);
    assert.notEqual(computed.mask, 'none');
    assert.equal(computed.pointerEvents, 'none');
    assert.ok(samples.top[0] >= 170 && samples.top[1] >= 140, 'top edge has intended translucent white highlight');
    assert.ok(Math.abs(samples.bottom[0] - 102) <= 3 && Math.abs(samples.bottom[1] - 72) <= 3,
      'bottom border fades to transparent, revealing purple fill');
  }
  await writeFile(path.join(destination, 'measurements.json'), JSON.stringify({ computed, samples }, null, 2));
  console.log(JSON.stringify({ baseline, destination, computed, samples }, null, 2));
} finally {
  await browser.close();
}
