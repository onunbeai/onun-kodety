import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { parseFragment } from 'parse5';

// Execute the shipped plugin, without starting an export or requiring Figma.
// These fixtures exercise the layout rules which previously made valid Figma
// sections overflow or collapse after the Builder changed viewport width.
const pluginCode = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const figma = {
  mixed: Symbol('mixed'),
  command: '',
  currentPage: { id: 'page:layout-fidelity', selection: [] },
  root: { name: 'Layout fidelity regression' },
  ui: { postMessage() {}, onmessage: null },
  showUI() {},
  on() {},
};
const plugin = { figma, __html__: '', console, setTimeout, clearTimeout };
vm.runInNewContext(pluginCode, plugin, { filename: 'FigmaPlugin/code.js' });

let nextId = 0;
function node(overrides = {}) {
  return {
    id: `fidelity:${++nextId}`,
    name: 'Content',
    type: 'FRAME',
    visible: true,
    x: 0,
    y: 0,
    width: 480,
    height: 240,
    layoutMode: 'NONE',
    layoutPositioning: 'AUTO',
    opacity: 1,
    fills: [],
    children: [],
    getSharedPluginData() { return ''; },
    ...overrides,
  };
}

function flexParent(layoutMode = 'HORIZONTAL', overrides = {}) {
  return node({
    name: 'Feature row',
    layoutMode,
    width: 1200,
    height: 600,
    layoutWrap: 'NO_WRAP',
    itemSpacing: 24,
    paddingTop: 32,
    paddingBottom: 32,
    paddingLeft: 32,
    paddingRight: 32,
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    ...overrides,
  });
}

function context(responsiveMode = 'smart') {
  return {
    options: { responsiveMode },
    restNodesById: new Map(),
    geometryLayoutCache: new Map(),
    geometryInferredLayoutIds: new Set(),
    responsiveRules: { notebook: [], tablet: [], mobile: [] },
    baseOverrides: [],
    absoluteRootNames: [],
    variableCssNames: new Map(),
    fonts: new Map(),
    fontUsage: new Map(),
    richTextSegments: 0,
    warnings: [],
    selectionCount: 1,
  };
}

function declarations(list) {
  return Object.fromEntries(Array.from(list, declaration => {
    const separator = declaration.indexOf(':');
    return [declaration.slice(0, separator), declaration.slice(separator + 1)];
  }));
}

function responsive(child, parent, tag = 'div', mode = 'smart') {
  const fixtureContext = context(mode);
  parent.children = [child, node({ width: 480, height: 240 })];
  plugin.registerResponsiveRules(parent, null, fixtureContext, 'fixture-parent', plugin.semanticTag(parent));
  plugin.registerResponsiveRules(child, parent, fixtureContext, 'fixture-child', tag);
  const rules = fixtureContext.responsiveRules.mobile
    .filter(rule => rule.startsWith('.fixture-child{'))
    .flatMap(rule => rule.slice(rule.indexOf('{') + 1, -1).split(';'));
  return { css: declarations(rules), fixtureContext };
}

for (const axis of ['HORIZONTAL', 'VERTICAL']) {
  test(`explicit ${axis} FILL shares remaining space without legacy layoutGrow`, () => {
    const parent = flexParent(axis);
    const child = node({
      layoutSizingHorizontal: axis === 'HORIZONTAL' ? 'FILL' : 'FIXED',
      layoutSizingVertical: axis === 'VERTICAL' ? 'FILL' : 'FIXED',
      layoutGrow: 0,
    });
    const css = declarations(plugin.layoutDeclarations(child, parent, context()));
    assert.equal(css['flex-grow'], '1');
    assert.equal(css['flex-basis'], '0');
    assert.equal(css['flex-shrink'], '1');
    assert.equal(css[axis === 'HORIZONTAL' ? 'min-width' : 'min-height'], '0');
  });

  test(`${axis} FILL preserves authored minimum dimensions`, () => {
    const parent = flexParent(axis);
    const child = node({
      layoutSizingHorizontal: 'FILL',
      layoutSizingVertical: 'FILL',
      layoutGrow: 1,
      minWidth: 160,
      minHeight: 96,
    });
    const css = declarations(plugin.layoutDeclarations(child, parent, context()));
    assert.equal(css['min-width'], '160px');
    assert.equal(css['min-height'], '96px');
  });
}

test('REST FILL sizing takes precedence over stale local fixed dimensions', () => {
  const parent = flexParent();
  const child = node({ layoutSizingHorizontal: 'FIXED', layoutGrow: 0 });
  const fixtureContext = context();
  fixtureContext.restNodesById.set(child.id, { layoutSizingHorizontal: 'FILL' });
  const css = declarations(plugin.layoutDeclarations(child, parent, fixtureContext));
  assert.equal(css['flex-grow'], '1');
  assert.equal(css['flex-basis'], '0');
});

test('fixed and HUG siblings keep their desktop intrinsic size', () => {
  for (const sizing of ['FIXED', 'HUG']) {
    const child = node({ layoutSizingHorizontal: sizing });
    const css = declarations(plugin.layoutDeclarations(child, flexParent(), context()));
    assert.equal(css['flex-grow'], '0');
    assert.equal(css['flex-shrink'], '0');
    assert.equal(css['flex-basis'], 'auto');
  }
});

test('FILL in a grid or absolute positioning does not become a growing flex item', () => {
  const child = node({ layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FILL' });
  const gridCss = declarations(plugin.layoutDeclarations(child, flexParent('GRID'), context()));
  assert.notEqual(gridCss['flex-grow'], '1');
  const absoluteCss = declarations(plugin.layoutDeclarations(
    { ...child, layoutPositioning: 'ABSOLUTE' }, flexParent(), context(),
  ));
  assert.equal(absoluteCss.position, 'absolute');
  assert.notEqual(absoluteCss['flex-grow'], '1');
});

test('smart stacking gives fixed desktop cards the available mobile width', () => {
  const { css, fixtureContext } = responsive(node({ width: 560 }), flexParent());
  assert.equal(css.width, '100%');
  assert.equal(css['flex-grow'], '0');
  assert.equal(css['flex-basis'], 'auto');
  assert.match(fixtureContext.responsiveRules.mobile.join(''), /flex-direction:column/);
});

test('smart stacking resets horizontal FILL growth without collapsing card height', () => {
  const { css } = responsive(node({ layoutSizingHorizontal: 'FILL', layoutGrow: 1 }), flexParent());
  assert.equal(css.width, '100%');
  assert.equal(css['flex-grow'], '0');
  assert.equal(css['flex-basis'], 'auto');
});

for (const tag of ['img', 'atomic-media']) {
  test(`smart stacking scales ${tag} proportionally without restoring padding`, () => {
    const child = node({ width: 600, height: 300, layoutMode: 'VERTICAL', paddingLeft: 24, paddingRight: 24 });
    const { css } = responsive(child, flexParent(), tag);
    assert.equal(css.width, '100%');
    assert.equal(css.height, 'auto');
    assert.equal(css['aspect-ratio'], '600 / 300');
    assert.ok(!Object.keys(css).some(property => /^padding(?:-|$)/.test(property)));
    assert.ok(!Object.keys(css).some(property => /^(?:gap|flex-direction|grid-template)/.test(property)));
  });
}

test('smart responsive leaves absolute children and intentional horizontal rails positioned', () => {
  const absolute = responsive(node({ layoutPositioning: 'ABSOLUTE' }), flexParent()).css;
  assert.notEqual(absolute.width, '100%');
  assert.notEqual(absolute['flex-basis'], 'auto');
  for (const name of ['Navigation menu', 'Testimonial carousel', 'Ticker track']) {
    const result = responsive(node(), flexParent('HORIZONTAL', { name }));
    assert.notEqual(result.css.width, '100%');
    assert.doesNotMatch(result.fixtureContext.responsiveRules.mobile.join(''), /flex-direction:column/);
  }
});

test('safe adapts explicit Auto Layout while pixel retains the source dimensions', () => {
  const safe = responsive(node({ width: 560 }), flexParent(), 'div', 'safe').css;
  assert.equal(safe.width, '100%');
  assert.equal(safe['flex-basis'], 'auto');
  const pixel = responsive(node({ width: 560 }), flexParent(), 'div', 'pixel').css;
  assert.notEqual(pixel.width, '100%');
  assert.notEqual(pixel['flex-basis'], 'auto');
});

test('smart heading scaling reaches ordinary Text nodes that have no Auto Layout', () => {
  const heading = node({ type: 'TEXT', fontSize: 64, textAutoResize: 'HEIGHT' });
  const { css } = responsive(heading, flexParent('VERTICAL'), 'h1');
  assert.match(css['font-size'] || '', /^clamp\(28px,8vw,64px\)$/);
  assert.equal(css.height, 'auto');
});

test('heading scaling does not change absolute artwork, small text, or safe mode', () => {
  for (const [overrides, mode] of [
    [{ fontSize: 64, layoutPositioning: 'ABSOLUTE' }, 'smart'],
    [{ fontSize: 24 }, 'smart'],
    [{ fontSize: 64 }, 'safe'],
    [{ fontSize: 64 }, 'pixel'],
  ]) {
    const heading = node({ type: 'TEXT', ...overrides });
    const { css } = responsive(heading, flexParent('VERTICAL'), 'h1', mode);
    assert.equal(css['font-size'], undefined);
  }
});

test('smart large text scales its parent line box even with no rich-text segments', () => {
  const heading = node({
    type: 'TEXT', fontSize: 64, lineHeight: { unit: 'PIXELS', value: 80 },
    characters: 'A heading without rich runs', getStyledTextSegments: () => [],
  });
  const { css, fixtureContext } = responsive(heading, flexParent('VERTICAL'), 'h1');
  assert.equal(css['line-height'], '1.25');
  assert.equal(plugin.styledText(heading, fixtureContext), heading.characters);
});

test('smart large HUG text can wrap inside the available mobile width', () => {
  const heading = node({ type: 'TEXT', fontSize: 64, textAutoResize: 'WIDTH_AND_HEIGHT' });
  const { css } = responsive(heading, flexParent('VERTICAL'), 'h1');
  assert.equal(css['max-width'], '100%');
  assert.equal(css['white-space'], 'pre-wrap');
});

test('smart grid children fit reduced columns without recreating authored desktop tracks', () => {
  const parent = flexParent('GRID', { gridColumnCount: 4, gridRowCount: 2 });
  const child = node({ width: 560, gridColumnAnchorIndex: 3, gridColumnSpan: 3, gridRowAnchorIndex: 1, gridRowSpan: 2 });
  const { css, fixtureContext } = responsive(child, parent);
  assert.equal(css.width, '100%');
  assert.equal(css['min-width'], '0');
  for (const property of ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end']) {
    assert.equal(css[property], 'auto');
  }
  const tablet = declarations(fixtureContext.responsiveRules.tablet
    .filter(rule => rule.startsWith('.fixture-child{'))
    .flatMap(rule => rule.slice(rule.indexOf('{') + 1, -1).split(';')));
  assert.equal(tablet.width, '100%');
  for (const property of ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end']) {
    assert.equal(tablet[property], 'auto');
  }
});

test('safe grids adapt columns while absolute grid children retain authored placements', () => {
  const safe = responsive(node({ width: 560, gridColumnAnchorIndex: 3 }),
    flexParent('GRID', { gridColumnCount: 4 }), 'div', 'safe').css;
  assert.equal(safe.width, '100%');
  assert.equal(safe['grid-column-start'], 'auto');
  for (const [overrides, mode] of [[{ layoutPositioning: 'ABSOLUTE' }, 'safe'], [{ layoutPositioning: 'ABSOLUTE' }, 'smart']]) {
    const child = node({ width: 560, gridColumnAnchorIndex: 3, ...overrides });
    const { css } = responsive(child, flexParent('GRID', { gridColumnCount: 4 }), 'div', mode);
    assert.notEqual(css.width, '100%');
    for (const property of ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end']) {
      assert.equal(css[property], undefined);
    }
  }
});

test('font style names distinguish Bold from Semi Bold without a numeric weight', () => {
  assert.equal(plugin.fontWeightCss(undefined, 'Bold'), 700);
  assert.equal(plugin.fontWeightCss(undefined, 'Bold Italic'), 700);
  assert.equal(plugin.fontWeightCss(undefined, 'Semi Bold'), 600);
  assert.equal(plugin.fontWeightCss(undefined, 'Demi Bold'), 600);
  assert.equal(plugin.fontWeightCss(undefined, 'Extra Bold'), 800);
});

test('fontName variation settings and disabled OpenType features survive text conversion', () => {
  const text = node({
    type: 'TEXT',
    fontName: { family: 'Variable Sans', style: 'Regular', variationSettings: { wght: 635, slnt: -8, opsz: 32 } },
    fontSize: 32,
    fontWeight: 635,
    openTypeFeatures: { LIGA: false, SS01: true },
  });
  const css = declarations(plugin.textDeclarations(text, context()));
  assert.match(css['font-variation-settings'] || '', /"wght" 635/);
  assert.match(css['font-variation-settings'] || '', /"slnt" -8/);
  assert.match(css['font-variation-settings'] || '', /"opsz" 32/);
  assert.match(css['font-feature-settings'] || '', /"liga" 0/);
  assert.match(css['font-feature-settings'] || '', /"ss01" 1/);
});

test('rich-text HTML keeps quoted family names, axes, features, and later CSS in one style attribute', () => {
  const segment = {
    characters: 'Type & spacing',
    fontName: { family: 'Studio "Display"', style: 'Regular', variationSettings: { wght: 635, wdth: 90 } },
    fontSize: 32,
    fontWeight: 635,
    letterSpacing: { unit: 'PIXELS', value: -0.75 },
    lineHeight: { unit: 'PIXELS', value: 40 },
    openTypeFeatures: { LIGA: false },
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
  };
  const text = node({ type: 'TEXT', characters: segment.characters, getStyledTextSegments: () => [segment] });
  const fragment = parseFragment(plugin.styledText(text, context()));
  const span = fragment.childNodes[0];
  assert.equal(span.tagName, 'span');
  assert.deepEqual(span.attrs.map(attribute => attribute.name).sort(), ['data-figma-segment', 'style']);
  const css = declarations(span.attrs.find(attribute => attribute.name === 'style').value.split(';'));
  assert.match(css['font-family'], /Studio.*Display/);
  assert.match(css['font-variation-settings'] || '', /"wdth" 90/);
  assert.match(css['font-feature-settings'] || '', /"liga" 0/);
  assert.equal(css['font-size'], '32px');
  assert.equal(css['letter-spacing'], '-0.75px');
  assert.equal(css['line-height'], '40px');
  assert.ok(css.color, 'color after the quoted font-family must remain in the style attribute');
  assert.equal(span.childNodes[0].value, segment.characters);
});

test('mixed rich-text runs scale with a smart heading while keeping their size ratios', () => {
  const segments = [
    { characters: 'Headline ', fontSize: 64, lineHeight: { unit: 'PIXELS', value: 80 } },
    { characters: 'accent', fontSize: 48, lineHeight: { unit: 'PIXELS', value: 60 } },
  ].map(segment => ({ ...segment, fontName: { family: 'Inter', style: 'Regular' }, fontWeight: 400, fills: [] }));
  const heading = node({ type: 'TEXT', fontSize: 64, getStyledTextSegments: () => segments });
  const { fixtureContext } = responsive(heading, flexParent('VERTICAL'), 'h1');
  const fragment = parseFragment(plugin.styledText(heading, fixtureContext));
  const styles = fragment.childNodes.map(span => declarations(
    span.attrs.find(attribute => attribute.name === 'style').value.split(';'),
  ));
  assert.equal(styles[0]['font-size'], '1em');
  assert.equal(styles[1]['font-size'], '0.75em');
  assert.equal(styles[0]['line-height'], '1.25');
  assert.equal(styles[1]['line-height'], '1.25');
});
