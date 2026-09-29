import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const source = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
let sequence = 0;
const solid = color => [{ type: 'SOLID', color }];
function frame(overrides = {}) {
  return { id: `responsive:${++sequence}`, type: 'FRAME', name: 'Content', visible: true,
    x: 0, y: 0, width: 1158, height: 400, opacity: 1, layoutMode: 'VERTICAL',
    layoutPositioning: 'AUTO', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'HUG',
    primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER',
    primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED', itemSpacing: 24,
    paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0,
    fills: [], strokes: [], children: [], getSharedPluginData: () => '',
    getCSSAsync: async () => ({}), ...overrides };
}
function text(characters, overrides = {}) {
  return frame({ name: 'Copy', type: 'TEXT', layoutMode: 'NONE', width: 605, height: 60,
    characters, fontSize: 18, fontName: { family: 'Arial', style: 'Regular' },
    fontWeight: 400, textAutoResize: 'HEIGHT', lineHeight: { unit: 'PIXELS', value: 25 },
    fills: solid({ r: 1, g: 1, b: 1 }), getStyledTextSegments: () => [], ...overrides });
}
function fixture() {
  const icon = frame({ name: 'Icon', type: 'RECTANGLE', layoutMode: 'NONE', width: 14, height: 14,
    layoutSizingVertical: 'FIXED', fills: solid({ r: 1, g: 1, b: 1 }) });
  const label = text('Explorar recursos', { width: 139, height: 20, fontSize: 16,
    textAutoResize: 'WIDTH_AND_HEIGHT', lineHeight: { unit: 'PIXELS', value: 20 } });
  const button = frame({ name: 'Primary CTA', width: 201, height: 48, layoutMode: 'HORIZONTAL',
    layoutSizingVertical: 'FIXED', itemSpacing: 12, paddingTop: 14, paddingBottom: 14,
    paddingLeft: 18, paddingRight: 18, cornerRadius: 12,
    fills: solid({ r: 0.44, g: 0.33, b: 0.95 }), children: [icon, label] });
  const heading = text('Tudo o que você precisa para criar', { name: 'Heading', width: 605,
    height: 160, fontSize: 64, textAutoResize: 'WIDTH_AND_HEIGHT', lineHeight: { unit: 'PIXELS', value: 80 } });
  const hero = frame({ name: 'Hero content', width: 1158, height: 380, children: [
    frame({ width: 605, children: [heading, text('Um editor visual completo para sites, conteúdo e experiências.', { width: 479 })] }),
    button,
  ] });
  const cards = Array.from({ length: 3 }, (_, index) => frame({ name: `Feature card ${index + 1}`,
    width: 385, height: 290, paddingTop: 24, paddingBottom: 24, paddingLeft: 24, paddingRight: 24,
    fills: solid({ r: 0.14, g: 0.14, b: 0.18 }), cornerRadius: 16,
    children: [text(`Recurso ${index + 1}`, { width: 337, height: 35, fontSize: 28 }),
      text('Gerencie conteúdos, coleções e campos em um CMS completo e flexível para projetos.', { width: 337 })] }));
  const row = frame({ name: 'Feature cards', layoutMode: 'HORIZONTAL', width: 1204,
    height: 290, itemSpacing: 24, children: cards });
  const notification = frame({ name: 'Announcement', width: 1920, height: 58, layoutMode: 'HORIZONTAL',
    layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
    paddingTop: 19, paddingBottom: 19, paddingLeft: 726, paddingRight: 726, itemSpacing: 19,
    children: [text('Novidades da plataforma', { width: 390, height: 20, fontSize: 16,
      textAutoResize: 'WIDTH_AND_HEIGHT' }), frame({ name: 'Arrow', width: 10, height: 6,
      layoutMode: 'NONE', layoutSizingVertical: 'FIXED' })] });
  const root = frame({ name: 'Section', width: 1920, height: 1200, itemSpacing: 70,
    paddingTop: 120, paddingBottom: 120, fills: solid({ r: 0.05, g: 0.05, b: 0.07 }),
    children: [notification, hero, row] });
  return { root, row, cards, button, icon, label, heading, hero, notification };
}
function environment(mode = 'safe') {
  const plugin = { figma: { mixed: Symbol('mixed'), command: '', currentPage: { selection: [] },
    root: { name: 'Responsive fixtures' }, ui: { postMessage() {} }, on() {}, showUI() {} },
  __html__: '', console, setTimeout, clearTimeout, btoa, atob };
  vm.runInNewContext(source, plugin);
  const context = { options: { responsiveMode: mode }, assets: [], assetBytes: 0, rules: [], baseOverrides: [],
    warnings: [], nodeCount: 0, estimatedNodes: 30, selectionCount: 1,
    responsiveRules: { notebook: [], tablet: [], mobile: [] },
    restNodesById: new Map(), geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
    imageHashes: new Map(), failedImageHashes: new Set(), pendingImageHashes: new Set(),
    variableCssNames: new Map(), backgroundAssets: new Map(), fonts: new Map(), fontUsage: new Map(),
    sourceId: 'responsive', exportId: 'responsive-test', richTextSegments: 0, semanticNodes: 0,
    rootBounds: { x: 0, y: 0, width: 1920, height: 1200 }, absoluteRootNames: [] };
  return { plugin, context };
}
async function render(mode = 'safe', model = fixture()) {
  const { plugin, context } = environment(mode);
  const before = JSON.stringify(model.root);
  const html = await plugin.renderNode(model.root, null, context);
  assert.equal(JSON.stringify(model.root), before);
  const css = [...context.rules, ...context.baseOverrides,
    ...[['notebook', context.responsiveNotebookMaxWidth || 1200], ['tablet', 810], ['mobile', 410]].map(([breakpoint, width]) =>
      `@media(max-width:${width}px){${context.responsiveRules[breakpoint].join('')}}`)].join('\n');
  return { plugin, context, html, css, ...model };
}

for (const mode of ['safe', 'smart']) {
  test(`${mode}: explicit Auto Layout gains bounded widths, card columns, spacing and HUG wrapping`, async () => {
    const result = await render(mode);
    assert.match(result.context.responsiveRules.notebook.join(''), /max-width:100%/);
    assert.match(result.css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(result.context.responsiveRules.mobile.join(''), /grid-template-columns:minmax\(0,1fr\)/);
    assert.match(result.context.responsiveRules.tablet.join(''), /padding:19px 32px 19px 32px/);
    assert.match(result.context.responsiveRules.notebook.join(''), /white-space:pre-wrap/);
    assert.doesNotMatch(result.context.baseOverrides.join(''), /max-width:100%/,
      'adaptive bounds must not change the original 1920px composition');
  });
}

test('compact button and icon-label rows never stack or stretch their children', async () => {
  const result = await render();
  assert.equal(result.plugin.responsiveRowPlan(result.button, result.button, result.context), null);
  const classes = [];
  const visit = node => {
    if (node.attrs?.some(attr => attr.name === 'data-figma-id' && [result.icon.id, result.label.id].includes(attr.value))) {
      classes.push(node.attrs.find(attr => attr.name === 'class').value);
    }
    (node.childNodes || []).forEach(visit);
  };
  visit(parseFragment(result.html));
  assert.equal(classes.length, 2);
  for (const rule of Object.values(result.context.responsiveRules).flat()) {
    if (classes.some(name => rule.startsWith(`.${name}{`))) assert.doesNotMatch(rule, /(?:^|[;{])width:100%/);
  }
});

test('two short paragraph columns are content, not compact controls', () => {
  const { plugin, context } = environment();
  const row = frame({ width: 700, height: 72, layoutMode: 'HORIZONTAL', children: [
    text('Um parágrafo completo da primeira coluna que precisa adaptar ao celular.', { width: 300, height: 72 }),
    text('Um parágrafo completo da segunda coluna que precisa adaptar ao celular.', { width: 300, height: 72 }),
  ] });
  assert.equal(plugin.responsiveRowPlan(row, row, context), 'stack');
});

test('fixed vertical icon frames and compact grid items keep dimensions while grid placement resets', () => {
  for (const mode of ['safe', 'smart']) {
    const { plugin, context } = environment(mode);
    const parent = frame({ layoutMode: 'GRID', gridColumnCount: 4 });
    for (const [tag, overrides] of [
      ['div', { width: 24, height: 24, layoutMode: 'VERTICAL', children: [frame({ width: 8, height: 8 })] }],
      ['img', { width: 24, height: 24, layoutMode: 'NONE', type: 'VECTOR' }],
      ['button', { name: 'Button', width: 112, height: 64, layoutMode: 'VERTICAL' }],
    ]) {
      const child = frame({ layoutSizingVertical: 'FIXED', gridColumnAnchorIndex: 3, gridRowAnchorIndex: 2, ...overrides });
      plugin.registerResponsiveRules(child, parent, context, `compact-${child.id}`, tag);
      const rules = Object.values(context.responsiveRules).flat().filter(rule => rule.startsWith(`.compact-${child.id}{`)).join('');
      assert.doesNotMatch(rules, /(?:[;{])(?:width:100%|height:auto)/);
      assert.match(rules, /grid-column-start:auto/);
      assert.match(rules, /grid-row-start:auto/);
    }
  }
});

test('wide fixed-height nav/menu keeps its row and height but adapts desktop padding', () => {
  for (const mode of ['safe', 'smart']) for (const name of ['Nav', 'Menu']) {
    const { plugin, context } = environment(mode);
    const root = frame({ width: 1920 });
    const navigation = frame({ name, width: 1920, height: 58, layoutMode: 'HORIZONTAL',
      layoutSizingVertical: 'FIXED', paddingTop: 19, paddingBottom: 19, paddingLeft: 726, paddingRight: 726 });
    plugin.registerResponsiveRules(navigation, root, context, 'wide-nav', 'nav');
    for (const [breakpoint, side] of [['notebook', 48], ['tablet', 32], ['mobile', 20]]) {
      const css = context.responsiveRules[breakpoint].join('');
      assert.match(css, new RegExp(`padding:19px ${side}px 19px ${side}px`));
      assert.doesNotMatch(css, /height:auto|flex-direction:column/);
    }
  }
});

test('pixel emits no responsive changes and preserves root dimensions', async () => {
  const result = await render('pixel');
  assert.equal(Object.values(result.context.responsiveRules).flat().length, 0);
  assert.equal(result.context.baseOverrides.length, 0);
  assert.match(result.css, /width:1920px/);
});

test('absolute artwork subtrees, rails and authored size constraints remain protected', () => {
  const { plugin, context } = environment();
  const root = frame();
  const art = frame({ width: 1113, layoutPositioning: 'ABSOLUTE' });
  const inside = frame({ width: 900, paddingLeft: 140, children: [frame(), frame()] });
  plugin.registerResponsiveRules(root, null, context, 'root', 'div');
  plugin.registerResponsiveRules(art, root, context, 'art', 'div');
  plugin.registerResponsiveRules(inside, art, context, 'inside', 'div');
  assert.ok(Object.values(context.responsiveRules).flat().every(rule => !/^\.(?:art|inside)\{/.test(rule)));
  const rail = frame({ name: 'Testimonials carousel', layoutMode: 'HORIZONTAL', children: [frame(), frame(), frame()] });
  assert.equal(plugin.responsiveRowPlan(rail, rail, context), null);
  const constrained = frame({ minWidth: 500, maxWidth: 900 });
  plugin.registerResponsiveRules(constrained, root, context, 'authored', 'div');
  assert.doesNotMatch(Object.values(context.responsiveRules).flat().filter(rule => rule.startsWith('.authored{')).join(''),
    /max-width:100%|min-width:0/);
});

test('cancel during PNG export stops before storing the result or retrying', async () => {
  const { plugin, context } = environment();
  let attempts = 0;
  const sourceNode = frame({ exportAsync: async () => {
    attempts++;
    vm.runInNewContext('cancelled = true', plugin);
    throw new Error('Native export interrupted');
  } });
  await assert.rejects(plugin.exportPngNode(sourceNode, context, 3));
  assert.equal(attempts, 1);
  assert.equal(context.assets.length, 0);
});

test('Builder import preserves the source-derived 1919px media query and card grids', async () => {
  const result = await render();
  assert.equal(result.context.responsiveNotebookMaxWidth, 1919);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
    resolve: { alias: { '@': root } }, plugins: [codeComponentReactRuntimePlugin()],
    server: { middlewareMode: true } });
  try {
    const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
    const { createBlankProject } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
    const { KODETY_FIGMA_SIGNATURE, KODETY_FIGMA_VERSION } = await server.ssrLoadModule('/lib/figma/types.ts');
    const imported = await importKodetyFigmaPayload(createBlankProject('Responsive round trip'), {
      signature: KODETY_FIGMA_SIGNATURE, version: KODETY_FIGMA_VERSION, source: 'figma-plugin',
      engine: { version: 5, sceneFormat: 'JSON_REST_V1' }, exportId: 'responsive-round-trip',
      exportedAt: new Date().toISOString(), documentName: 'Responsive fixture', pageName: 'Page',
      html: result.html, css: result.css, assets: [], fonts: [], variables: [], warnings: [],
      stats: { nodes: result.context.nodeCount, assets: 0, bytes: result.html.length + result.css.length },
    }, { targetPath: '0', preferredStylesheetPath: 'styles.css' });
    const css = imported.project.files['styles.css'].text;
    assert.match(css, /@media\s*\(max-width:\s*1919px\)/);
    assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(imported.project.files['index.html'].text, /Explorar recursos/);
  } finally { await server.close(); }
});

if (process.argv.includes('--visual')) {
  test('Chromium: engine HTML adapts 1920 / 1366 / 810 / 390 without global overflow or scaling', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const screenshots = await mkdtemp(join(tmpdir(), 'kodety-responsive-'));
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort());
      const measurements = [];
      for (const mode of ['safe', 'smart']) {
        const result = await render(mode);
        for (const width of [1920, 1366, 810, 390]) {
          await page.setViewportSize({ width, height: 1200 });
          // The host page only removes its own body margin. Every descendant
          // style comes from renderNode, including native button resets.
          await page.setContent(`<style>body{margin:0}${result.css}</style>${result.html}`);
          const measured = await page.evaluate(ids => {
            const element = id => document.querySelector(`[data-figma-id="${id}"]`);
            const rect = id => { const box = element(id).getBoundingClientRect();
              return { x: box.x, y: box.y, width: box.width, height: box.height }; };
            const cards = ids.cards.map(rect);
            return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
              cards, columns: cards.filter(card => Math.abs(card.y - cards[0].y) < 1).length,
              button: rect(ids.button), icon: rect(ids.icon), label: rect(ids.label),
              buttonDirection: getComputedStyle(element(ids.button)).flexDirection,
              heading: rect(ids.heading), hero: rect(ids.hero),
              transform: getComputedStyle(element(ids.root)).transform };
          }, { cards: result.cards.map(card => card.id), button: result.button.id, icon: result.icon.id,
            label: result.label.id, heading: result.heading.id, hero: result.hero.id, root: result.root.id });
          measurements.push({ mode, ...measured });
          assert.ok(measured.scrollWidth <= width, JSON.stringify(measured));
          assert.equal(measured.columns, width === 1920 ? 3 : width > 410 ? 2 : 1);
          assert.equal(measured.transform, 'none');
          assert.equal(measured.buttonDirection, 'row');
          assert.equal(measured.icon.width, 14);
          assert.ok(Math.abs(measured.icon.y + measured.icon.height / 2
            - measured.label.y - measured.label.height / 2) < 1);
          assert.ok(measured.button.width < 250);
          if (width < 1920) assert.ok(measured.heading.width <= measured.hero.width + 1);
          await page.screenshot({ path: join(screenshots, `${mode}-${width}.png`), fullPage: true });
        }
        const model = fixture();
        model.cards.push(frame({ name: 'Feature card 4', width: 283, height: 172,
          children: [text('Quarto recurso', { width: 235 })] }));
        Object.assign(model.row, { layoutMode: 'GRID', gridColumnCount: 4, gridRowCount: 1,
          gridColumnsSizing: 'repeat(4,283px)', gridColumnGap: 24, gridRowGap: 24 });
        model.cards.forEach((card, index) => {
          Object.assign(card, { width: 283, gridColumnAnchorIndex: index, gridRowAnchorIndex: 0,
            gridColumnSpan: 1, gridRowSpan: 1 });
          card.children.forEach(child => { child.width = 235; });
        });
        const gridResult = await render(mode, model);
        for (const width of [1920, 810, 390]) {
          await page.setViewportSize({ width, height: 1200 });
          await page.setContent(`<style>body{margin:0}${gridResult.css}</style>${gridResult.html}`);
          const grid = await page.evaluate(ids => {
            const row = document.querySelector(`[data-figma-id="${ids.row}"]`);
            const positions = ids.cards.map(id => {
              const box = document.querySelector(`[data-figma-id="${id}"]`).getBoundingClientRect();
              return { x: box.x, y: box.y, right: box.right };
            });
            return { scrollWidth: document.documentElement.scrollWidth,
              columns: getComputedStyle(row).gridTemplateColumns.split(' ').length,
              firstRow: positions.filter(position => Math.abs(position.y - positions[0].y) < 1).length,
              positions };
          }, { row: model.row.id, cards: model.cards.map(card => card.id) });
          const expected = width === 1920 ? 4 : width === 810 ? 2 : 1;
          assert.equal(grid.columns, expected, 'no implicit desktop columns may survive the reduced template');
          assert.equal(grid.firstRow, expected);
          assert.ok(grid.scrollWidth <= width);
          assert.ok(grid.positions.every(position => position.x >= 0 && position.right <= width));
          measurements.push({ mode, viewport: width, explicitGrid: grid });
          await page.screenshot({ path: join(screenshots, `${mode}-grid-${width}.png`), fullPage: true });
        }
        const glyph = frame({ name: 'Glyph', type: 'RECTANGLE', layoutMode: 'NONE', width: 8, height: 8,
          layoutSizingVertical: 'FIXED', fills: solid({ r: 1, g: 1, b: 1 }) });
        const iconFrame = frame({ name: 'Icon frame', width: 24, height: 24, layoutSizingVertical: 'FIXED',
          primaryAxisAlignItems: 'CENTER', children: [glyph] });
        const vector = frame({ name: 'Vector icon', type: 'VECTOR', layoutMode: 'NONE', width: 24, height: 24,
          layoutSizingVertical: 'FIXED', fills: solid({ r: 1, g: 1, b: 1 }),
          exportAsync: async () => new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64')) });
        const verticalButton = frame({ name: 'Button vertical', width: 112, height: 64,
          layoutSizingVertical: 'FIXED', primaryAxisAlignItems: 'CENTER',
          children: [text('Ação', { width: 50, height: 20, fontSize: 14 })] });
        const compactItems = [iconFrame, vector, verticalButton, text('Legenda', { width: 80, height: 20, fontSize: 14 })];
        compactItems.forEach((item, index) => Object.assign(item, { gridColumnAnchorIndex: index,
          gridRowAnchorIndex: 0, gridColumnSpan: 1, gridRowSpan: 1 }));
        const compactGrid = frame({ layoutMode: 'GRID', width: 1204, height: 160,
          gridColumnCount: 4, gridRowCount: 1, gridColumnGap: 24, gridRowGap: 24, children: compactItems });
        const compactRoot = frame({ width: 1920, children: [compactGrid] });
        const compactResult = await render(mode, { root: compactRoot });
        let compactHtml = compactResult.html;
        for (const asset of compactResult.context.assets) compactHtml = compactHtml.replaceAll(
          `figma-asset://${asset.id}`, `data:${asset.mimeType};base64,${asset.dataBase64}`);
        assert.ok(compactResult.context.assets.length > 0, 'the vector must pass through the native media export path');
        for (const width of [1920, 810, 390]) {
          await page.setViewportSize({ width, height: 1200 });
          await page.setContent(`<style>body{margin:0}${compactResult.css}</style>${compactHtml}`);
          const sizes = await page.evaluate(ids => ids.map(id => {
            const box = document.querySelector(`[data-figma-id="${id}"]`).getBoundingClientRect();
            return { width: box.width, height: box.height };
          }), [iconFrame.id, vector.id, verticalButton.id, glyph.id]);
          assert.deepEqual(sizes, [{ width: 24, height: 24 }, { width: 24, height: 24 },
            { width: 112, height: 64 }, { width: 8, height: 8 }], `${mode} at ${width}px`);
          measurements.push({ mode, viewport: width, compactSizes: sizes });
        }
        for (const name of ['Nav', 'Menu']) {
          const navigationModel = fixture();
          Object.assign(navigationModel.notification, { name, height: 58, layoutSizingVertical: 'FIXED' });
          navigationModel.notification.children[0].lineHeight = { unit: 'PIXELS', value: 20 };
          const navigationResult = await render(mode, navigationModel);
          for (const width of [1366, 390]) {
            await page.setViewportSize({ width, height: 1200 });
            await page.setContent(`<style>body{margin:0}${navigationResult.css}</style>${navigationResult.html}`);
            const navigation = await page.evaluate(id => {
              const node = document.querySelector(`[data-figma-id="${id}"]`);
              const style = getComputedStyle(node);
              const box = node.getBoundingClientRect();
              return { width: box.width, height: box.height, paddingLeft: style.paddingLeft,
                paddingRight: style.paddingRight, direction: style.flexDirection,
                scrollWidth: document.documentElement.scrollWidth };
            }, navigationModel.notification.id);
            assert.equal(navigation.height, 58);
            assert.equal(navigation.width, width);
            assert.equal(navigation.paddingLeft, width === 390 ? '20px' : '48px');
            assert.equal(navigation.paddingRight, navigation.paddingLeft);
            assert.equal(navigation.direction, 'row');
            assert.ok(navigation.scrollWidth <= width);
            measurements.push({ mode, viewport: width, name, navigation });
          }
        }
      }
      console.log(JSON.stringify({ screenshots, measurements }));
    } finally { await browser.close(); }
  });
}
