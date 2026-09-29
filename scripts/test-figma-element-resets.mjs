import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';
import { parseFragment } from 'parse5';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const code = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const solid = (r, g, b) => ({ type: 'SOLID', color: { r: r / 255, g: g / 255, b: b / 255 } });

async function render(overrides = {}) {
  const node = {
    id: 'reset:button', name: '[button] Previous', type: 'FRAME', visible: true,
    x: 0, y: 0, width: 45, height: 40, layoutMode: 'NONE', opacity: 1,
    fills: [], strokes: [], children: [], getSharedPluginData() { return ''; },
    getCSSAsync: async () => ({}), ...overrides,
  };
  const before = JSON.stringify(node);
  const figma = { mixed: Symbol('mixed'), command: '', root: { name: 'Element reset test' },
    currentPage: { id: 'reset:page', selection: [node] }, ui: { postMessage() {} }, showUI() {}, on() {} };
  const plugin = { figma, __html__: '', console, setTimeout, clearTimeout };
  vm.runInNewContext(code, plugin, { filename: 'FigmaPlugin/code.js' });
  const context = {
    options: { responsiveMode: 'pixel' }, assets: [], assetBytes: 0, rules: [], baseOverrides: [],
    warnings: [], nodeCount: 0, estimatedNodes: 1, selectionCount: 1,
    responsiveRules: { notebook: [], tablet: [], mobile: [] },
    restNodesById: new Map(), geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
    imageHashes: new Map(), failedImageHashes: new Set(), pendingImageHashes: new Set(),
    variableCssNames: new Map(), backgroundAssets: new Map(), fonts: new Map(), fontUsage: new Map(),
    sourceId: 'reset', exportId: 'reset-test', richTextSegments: 0, semanticNodes: 0,
    rootBounds: { x: 0, y: 0, width: node.width, height: node.height }, absoluteRootNames: [],
  };
  const html = await plugin.renderNode(node, null, context);
  assert.equal(JSON.stringify(node), before, 'normalizing CSS must not mutate the Figma source');
  const css = context.rules.join('\n');
  const element = parseFragment(html).childNodes[0];
  const className = element.attrs.find(attribute => attribute.name === 'class').value;
  const rule = postcss.parse(css).nodes.find(item => item.selector === `.${className}`);
  const declarations = Object.fromEntries(rule.nodes.filter(item => item.type === 'decl').map(item => [item.prop, item.value]));
  assert.doesNotMatch(css, /!important/);
  return { html, css, className, element, declarations, rule, context };
}

const authored = {
  name: '[button] Styled CTA', width: 160, height: 56,
  layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
  primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
  paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16,
  fills: [solid(102, 72, 218)], strokes: [solid(255, 255, 255)], strokeWeight: 2, strokeAlign: 'INSIDE',
  cornerRadius: 12,
  effects: [{ type: 'INNER_SHADOW', offset: { x: 0, y: 1 }, radius: 3, spread: 0, color: { r: 1, g: 1, b: 1, a: 0.2 } }],
  getCSSAsync: async () => ({ 'font-family': 'Arial', 'font-size': '20px', 'font-weight': '700', color: '#fff' }),
};

test('an unpainted semantic button exports its own reset rather than relying on a preview stylesheet', async () => {
  const result = await render();
  assert.equal(result.element.tagName, 'button');
  const style = result.declarations;
  for (const property of ['margin', 'padding', 'border']) assert.equal(style[property], '0', property);
  assert.equal(style.background, 'none');
  assert.equal(style.appearance, 'none');
  assert.equal(style['-webkit-appearance'], 'none');
  assert.equal(style.font, 'inherit');
  assert.equal(style.color, 'inherit');
  assert.equal(style['text-align'], 'inherit');
  assert.equal(style['border-radius'], '0');
  assert.equal(style['box-shadow'], 'none');
  assert.equal(style.outline, undefined, 'do not suppress the browser keyboard focus indicator');
  assert.ok(postcss.parse(result.css).nodes.every(rule => rule.selector.startsWith(`.${result.className}`)),
    'base resets belong to generated classes, never unrelated host-page buttons');
});

test('authored fill, solid stroke, radius, shadow, typography and Auto Layout padding override base resets', async () => {
  const { declarations: style, rule } = await render(authored);
  assert.equal(style['background-color'], 'rgb(102 72 218)');
  assert.equal(style.border, '2px solid rgb(255 255 255)');
  assert.equal(style['border-radius'], '12px');
  assert.match(style['box-shadow'], /^inset 0px 1px 3px 0px /);
  assert.equal(style.padding, '8px 16px 8px 16px');
  assert.equal(style['font-size'], '20px');
  assert.equal(style['font-weight'], '700');
  const resets = rule.nodes.findIndex(declaration => declaration.prop === 'border' && declaration.value === '0');
  const stroke = rule.nodes.findIndex(declaration => declaration.prop === 'border' && declaration.value.startsWith('2px solid'));
  assert.ok(resets >= 0 && resets < stroke, 'the reset must precede the authored border in the same rule');
});

test('an intentionally tagged 4.797px dot button is not given UA padding or borders', async () => {
  const { declarations: style } = await render({ name: '[button] Dot', type: 'RECTANGLE', width: 4.797, height: 4.797,
    fills: [solid(255, 255, 255)], cornerRadius: 10.793 });
  assert.equal(style.width, '4.797px');
  assert.equal(style.height, '4.797px');
  assert.equal(style.padding, '0');
  assert.equal(style.border, '0');
  assert.equal(style['background-color'], 'rgb(255 255 255)');
  assert.equal(style['border-radius'], '10.793px');
});

test('semantic lists lose browser bullets/indent while authored padding stays intact', async () => {
  const { declarations: style } = await render({ ...authored, name: '[ul] Navigation' });
  assert.equal(style['list-style'], 'none');
  assert.equal(style.margin, '0');
  assert.equal(style.padding, '8px 16px 8px 16px');
});

test('authored text color and underline override semantic anchor defaults', async () => {
  const { declarations: style } = await render({ type: 'TEXT', name: '[a] Documentation', characters: 'Documentation',
    fontName: { family: 'Arial', style: 'Regular' }, fontSize: 18, fontWeight: 400,
    fills: [solid(12, 34, 56)], textDecoration: 'UNDERLINE', textAutoResize: 'HEIGHT',
    getStyledTextSegments: () => [] });
  assert.equal(style.color, 'rgb(12 34 56)');
  assert.equal(style['text-decoration'], 'underline');
});

test('Builder import retains the semantic reset and authored override order', async () => {
  const result = await render(authored);
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', appType: 'custom',
    plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
  try {
    const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
    const { createBlankProject } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
    const { KODETY_FIGMA_SIGNATURE, KODETY_FIGMA_VERSION } = await server.ssrLoadModule('/lib/figma/types.ts');
    const imported = await importKodetyFigmaPayload(createBlankProject('Reset round trip'), {
      signature: KODETY_FIGMA_SIGNATURE, version: KODETY_FIGMA_VERSION, source: 'figma-plugin',
      engine: { version: 5, sceneFormat: 'JSON_REST_V1' }, exportId: 'reset-round-trip', exportedAt: new Date().toISOString(),
      documentName: 'Reset fixture', pageName: 'Page', html: result.html, css: result.css,
      assets: [], fonts: [], variables: [], warnings: [], stats: { nodes: 1, assets: 0, bytes: result.html.length + result.css.length },
    }, { targetPath: '0', preferredStylesheetPath: 'styles.css' });
    const rule = postcss.parse(imported.project.files['styles.css'].text).nodes.find(rule => rule.selector === `.${result.className}`);
    const style = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
    assert.equal(style.appearance, 'none');
    assert.equal(style.border, '2px solid rgb(255 255 255)');
    assert.equal(style.padding, '8px 16px 8px 16px');
    assert.equal(style['background-color'], 'rgb(102 72 218)');
  } finally { await server.close(); }
});

test('Chromium renders real converter output without external button resets', { skip: !process.argv.includes('--browser') }, async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    for (const [kind, overrides] of [
      ['plain', {}], ['authored', authored],
      ['dot', { name: '[button] Dot', type: 'RECTANGLE', width: 4.797, height: 4.797, fills: [solid(255, 255, 255)], cornerRadius: 10.793 }],
    ]) {
      const result = await render(overrides);
      // Deliberately no *, button, img, font, padding, border or appearance
      // reset here: a previous visual fixture hid the actual export defect.
      await page.setContent(`<!doctype html><html><head><style>${result.css}</style></head><body>${result.html}</body></html>`);
      const computed = await page.locator(`[data-figma-id="reset:button"]`).evaluate(element => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, border: style.borderTopWidth, padding: style.padding,
          appearance: style.appearance, fill: style.backgroundColor, radius: style.borderRadius,
          fontSize: style.fontSize, shadow: style.boxShadow };
      });
      assert.equal(computed.appearance, 'none');
      if (kind === 'authored') {
        assert.equal(computed.border, '2px');
        assert.equal(computed.padding, '8px 16px');
        assert.equal(computed.fill, 'rgb(102, 72, 218)');
        assert.equal(computed.radius, '12px');
        assert.equal(computed.fontSize, '20px');
        assert.match(computed.shadow, /inset/);
      } else {
        assert.equal(computed.border, '0px');
        assert.equal(computed.padding, '0px');
        assert.equal(computed.fill, kind === 'dot' ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0)');
      }
      assert.ok(Math.abs(computed.width - (overrides.width || 45)) < 0.05, `${kind}: no browser minimum width added`);
      assert.ok(Math.abs(computed.height - (overrides.height || 40)) < 0.05, `${kind}: no browser minimum height added`);
    }
  } finally { await browser.close(); }
});
