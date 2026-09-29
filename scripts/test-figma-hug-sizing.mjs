import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const figma = { mixed: Symbol('mixed'), command: '', currentPage: { selection: [] },
  root: { name: 'Hug sizing fixtures' }, ui: { postMessage() {} }, showUI() {}, on() {} };
const plugin = { figma, __html__: '', console, setTimeout, clearTimeout };
vm.runInNewContext(source, plugin);
let nextId = 0;
function frame(overrides = {}) {
  return { id: `hug:${++nextId}`, name: 'Frame', type: 'FRAME', visible: true,
    width: 385, height: 500, layoutMode: 'VERTICAL', layoutPositioning: 'AUTO',
    layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'HUG',
    primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN', itemSpacing: 17,
    paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0,
    opacity: 1, children: [], getSharedPluginData: () => '', ...overrides };
}
function context() {
  return { options: { responsiveMode: 'safe' }, restNodesById: new Map(),
    geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
    responsiveRules: { notebook: [], tablet: [], mobile: [] }, baseOverrides: [],
    warnings: [], absoluteRootNames: [], selectionCount: 1 };
}
const parent = frame({ layoutMode: 'HORIZONTAL', width: 1204, layoutSizingHorizontal: 'FIXED' });
const asObject = list => Object.fromEntries(Array.from(list, declaration => {
  const separator = declaration.indexOf(':');
  return [declaration.slice(0, separator), declaration.slice(separator + 1)];
}));
const cssFor = (node, fixtureContext = context(), ancestor = parent) =>
  asObject(plugin.layoutDeclarations(node, ancestor, fixtureContext));

test('Hug card with a Fill text container keeps its resolved width, not text max-content', () => {
  const card = frame({ children: [
    frame({ type: 'RECTANGLE', layoutMode: 'NONE', layoutSizingHorizontal: 'FIXED', width: 385 }),
    frame({ layoutSizingHorizontal: 'FILL' }),
  ] });
  const original = JSON.stringify(card);
  assert.equal(cssFor(card).width, '385px');
  assert.equal(cssFor(card).height, undefined, 'Text must continue to grow vertically');
  assert.equal(cssFor(card)['flex-shrink'], '0');
  assert.equal(plugin.sizingMode(card, parent, 'horizontal', false, context()), 'HUG');
  assert.equal(JSON.stringify(card), original, 'Never mutate the Figma source sizing');
});

test('Hug height with a Fill-height child breaks the same circular dependency', () => {
  const card = frame({ height: 240, children: [frame({ layoutSizingVertical: 'FILL' })] });
  assert.equal(cssFor(card).height, '240px');
  assert.equal(cssFor(card).width, undefined);
});

test('ordinary Hug buttons, fixed children and labels remain intrinsic', () => {
  const button = frame({ type: 'FRAME', layoutMode: 'HORIZONTAL', children: [
    frame({ type: 'TEXT', layoutMode: 'NONE', textAutoResize: 'WIDTH_AND_HEIGHT' }),
  ] });
  assert.equal(cssFor(button).width, undefined);
  assert.equal(cssFor(button).height, undefined);
  assert.equal(cssFor(frame({ children: [frame({ layoutSizingHorizontal: 'FIXED' })] })).width, undefined);
});

test('absolute or invisible Fill children do not freeze a Hug frame', () => {
  for (const overrides of [{ visible: false }, { layoutPositioning: 'ABSOLUTE' }]) {
    const card = frame({ children: [frame({ layoutSizingHorizontal: 'FILL', ...overrides })] });
    assert.equal(cssFor(card).width, undefined);
  }
});

test('legacy STRETCH and REST Fill metadata participate in the dependency check', () => {
  const legacyChild = frame({ layoutMode: 'NONE', layoutSizingHorizontal: undefined, layoutAlign: 'STRETCH' });
  assert.equal(cssFor(frame({ children: [legacyChild] })).width, '385px');
  const child = frame({ layoutSizingHorizontal: 'FIXED' });
  const card = frame({ children: [child] });
  const fixtureContext = context();
  fixtureContext.restNodesById.set(child.id, { layoutSizingHorizontal: 'FILL' });
  assert.equal(cssFor(card, fixtureContext).width, '385px');
  fixtureContext.restNodesById.set(child.id, { layoutSizingHorizontal: 'FIXED' });
  assert.equal(cssFor(card, fixtureContext).width, undefined);
});

test('Hug dependency keeps explicit bounds and excludes Dev Mode width overrides', async () => {
  const card = frame({ minWidth: 160, maxWidth: 420, children: [frame({ layoutSizingHorizontal: 'FILL' })],
    getCSSAsync: async () => ({ width: 'max-content', height: 'fit-content' }) });
  const css = cssFor(card);
  assert.equal(css.width, '385px');
  assert.equal(css['min-width'], '160px');
  assert.equal(css['max-width'], '420px');
  assert.deepEqual(Array.from(await plugin.nativeCssDeclarations(card, context(), parent)), []);
});

test('fixed and Fill frames include padding once regardless of stroke-layout mode', () => {
  for (const strokesIncludedInLayout of [false, true, undefined]) {
    for (const layoutMode of ['HORIZONTAL', 'VERTICAL', 'GRID']) {
      const card = frame({ layoutMode, strokesIncludedInLayout, layoutSizingHorizontal: 'FIXED',
        paddingLeft: 24, paddingRight: 24, paddingTop: 16, paddingBottom: 16 });
      assert.equal(cssFor(card)['box-sizing'], 'border-box');
      assert.equal(cssFor(card).width, '385px');
      assert.equal(cssFor(card).padding, '16px 24px 16px 24px');
      card.layoutSizingHorizontal = 'FILL';
      assert.equal(cssFor(card).width, '100%');
      assert.equal(cssFor(card)['box-sizing'], 'border-box');
    }
  }
});

// Optional browser regression; launches an isolated profile and blocks network.
// The fixture mirrors the real failing export: 385px fixed image, Hug card,
// Fill text frame, long Fill paragraph, horizontal rail, 17px spacing.
if (process.argv.includes('--visual')) {
  test('browser: card width is 385px rather than the paragraph intrinsic width', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.route('**/*', request => request.abort());
      const picture = frame({ type: 'RECTANGLE', layoutMode: 'NONE', height: 412,
        layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED' });
      const paragraph = frame({ type: 'TEXT', layoutMode: 'NONE', height: 34,
        layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG', textAutoResize: 'HEIGHT' });
      const textFrame = frame({ layoutSizingHorizontal: 'FILL', children: [paragraph] });
      const card = frame({ children: [picture, textFrame] });
      const fixtureContext = context();
      const rule = (selector, node, ancestor) => `${selector}{${plugin.layoutDeclarations(node, ancestor, fixtureContext).join(';')}}`;
      const cardCss = rule('.card', card, parent);
      const styles = `${rule('.rail', parent, null)}${cardCss}${rule('.picture', picture, card)}${rule('.copy', textFrame, card)}${rule('p', paragraph, textFrame)}`;
      const markup = `<div class="card"><img class="picture" width="385" height="412" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><div class="copy"><p>Gerencie conteúdos, coleções e campos em um CMS completo e flexível para projetos, conectado a todos os recursos da plataforma.</p></div></div>`;
      await page.setContent(`<style>body{margin:0;font:14px Arial}p{margin:0;white-space:pre-wrap;overflow-wrap:break-word}${styles}</style><div class="rail">${markup.repeat(4)}</div>`);
      const measure = () => page.locator('.card').evaluateAll(cards => cards.map(element => ({
        width: element.getBoundingClientRect().width, left: element.getBoundingClientRect().x,
        text: element.querySelector('p').getBoundingClientRect().width,
      })));
      const corrected = await measure();
      assert.ok(corrected.every(cardSize => cardSize.width === 385 && cardSize.text === 385));
      assert.equal(corrected[1].left - corrected[0].left, 402);
      await page.addStyleTag({ content: '.card{width:auto}' });
      const broken = await measure();
      assert.ok(broken[0].width > 650, 'The same content reproduces the previous max-content expansion');
      console.log(JSON.stringify({ correctedCardWidth: corrected[0].width, previousCardWidth: broken[0].width,
        correctedStep: corrected[1].left - corrected[0].left }));
    } finally {
      await browser.close();
    }
  });
}
