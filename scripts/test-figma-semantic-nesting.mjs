import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const figma = { mixed: Symbol('mixed'), command: '', root: { name: 'Semantics fixtures' },
  currentPage: { selection: [] }, ui: { postMessage() {} }, showUI() {}, on() {},
  getImageByHash: () => ({ getBytesAsync: async () => png, getSizeAsync: async () => ({ width: 100, height: 100 }) }),
};
const plugin = { figma, __html__: '', console, setTimeout, clearTimeout,
  btoa: value => Buffer.from(value, 'binary').toString('base64') };
vm.runInNewContext(await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8'), plugin);
let sequence = 0;
function node(name, children = [], overrides = {}) {
  return { id: `semantic:${++sequence}`, name, type: 'FRAME', visible: true,
    x: 0, y: 0, width: 240, height: 48, opacity: 1, rotation: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 48 },
    layoutMode: 'HORIZONTAL', layoutPositioning: 'AUTO', layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED',
    paddingTop: 4, paddingRight: 8, paddingBottom: 4, paddingLeft: 8, itemSpacing: 8,
    primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER',
    fills: [], strokes: [], effects: [], children,
    getCSSAsync: async () => ({}), getSharedPluginData: () => '',
    exportAsync: async () => { throw new Error('Editable content must not become a snapshot'); },
    ...overrides };
}
function text(value, overrides = {}) {
  return node('Text', [], { type: 'TEXT', layoutMode: 'NONE', characters: value,
    width: 180, height: 20, fontSize: 16, fontName: { family: 'Arial', style: 'Regular' },
    textAutoResize: 'HEIGHT', fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    getStyledTextSegments: () => [], ...overrides });
}
function context() {
  return { assets: [], assetBytes: 0, warnings: [], rules: [], baseOverrides: [],
    imageHashes: new Map(), failedImageHashes: new Set(), pendingImageHashes: new Set(),
    options: { responsiveMode: 'pixel' }, restNodesById: new Map(),
    geometryLayoutCache: new Map(), geometryInferredLayoutIds: new Set(),
    responsiveRules: { notebook: [], tablet: [], mobile: [] }, backgroundAssets: new Map(),
    rootBounds: { x: 0, y: 0, width: 240, height: 48 }, selectionCount: 1,
    estimatedNodes: 20, nodeCount: 0, semanticNodes: 0, sourceId: 'semantics', exportId: 'semantics',
    fonts: new Map(), fontUsage: new Map(), variableCssNames: new Map(), richTextSegments: 0,
    absoluteRootNames: [], vectorFallbackNodes: 0, rasterizedNodes: 0, imageFallbackNodes: 0 };
}
function elements(root) {
  return (root.childNodes || []).flatMap(child => child.tagName ? [child, ...elements(child)] : []);
}
const attr = (element, name) => element.attrs?.find(attribute => attribute.name === name)?.value;
async function render(root) {
  const before = JSON.stringify(root);
  const fixtureContext = context();
  const html = await plugin.renderNode(root, null, fixtureContext);
  assert.equal(JSON.stringify(root), before, 'Do not mutate Figma layer names, groups or text');
  return { html, css: fixtureContext.rules.join('\n'), context: fixtureContext,
    elements: elements(parseFragment(html)) };
}

test('button preserves nested editable frames and text as phrasing spans', async () => {
  const label = text('Começar agora');
  const inner = node('SVG layout', [label]);
  const overlay = node('Overlay', [inner]);
  const result = await render(node('Button', [overlay]));
  assert.equal(result.elements[0].tagName, 'button');
  assert.equal(attr(result.elements[0], 'type'), 'button');
  for (const original of [overlay, inner, label]) {
    assert.equal(result.elements.find(element => attr(element, 'data-figma-id') === original.id)?.tagName, 'span');
  }
  assert.match(result.html, /Começar agora/);
  assert.doesNotMatch(result.html, /<(?:div|p|h[1-6])\b/);
  assert.match(result.css, /display:flex;flex-direction:row/);
  assert.match(result.css, /padding:4px 8px 4px 8px/);
  assert.equal(result.context.assets.length, 0);
});

test('interactive ancestors suppress deep links, buttons, labels and rich-text anchors', async () => {
  const linkedText = text('Still editable', { hyperlink: { type: 'URL', value: 'https://example.com/text' },
    getStyledTextSegments: () => [{ characters: 'Still editable', fontSize: 16,
      hyperlink: { type: 'URL', value: 'https://example.com/segment' } }] });
  const nestedButton = node('Button nested', [linkedText], {
    reactions: [{ action: { type: 'URL', url: 'https://example.com/reaction' } }],
  });
  const nestedLink = node('[a] Link', [node('Another group', [nestedButton])]);
  const root = node('Button', [node('Group', [nestedLink, node('[label] Label', [text('label')])])]);
  const result = await render(root);
  assert.equal(result.elements.filter(element => element.tagName === 'button').length, 1);
  assert.equal(result.elements.filter(element => ['a', 'label'].includes(element.tagName)).length, 0);
  assert.doesNotMatch(result.html, /href=|example\.com/);
  assert.match(result.html, /Still editable/);
  assert.ok(result.elements.some(element => attr(element, 'data-figma-segment') === '0'));
});

test('links keep their own action but cannot hide nested controls through groups', async () => {
  const root = node('[a] Card link', [node('Group', [node('Button', [text('Go')]), node('[label] Label')])], {
    reactions: [{ action: { type: 'URL', url: 'https://example.com/card' } }],
  });
  const result = await render(root);
  assert.equal(result.elements[0].tagName, 'a');
  assert.equal(attr(result.elements[0], 'href'), 'https://example.com/card');
  assert.equal(result.elements.filter(element => element.tagName === 'a').length, 1);
  assert.ok(!result.elements.some(element => ['button', 'label'].includes(element.tagName)));
  assert.ok(result.elements.some(element => element.tagName === 'div'), 'Flow content under a root link remains editable flow content');
});

test('phrasing propagates through transparent links and semantic text containers', async () => {
  for (const name of ['[h2] Heading', '[p] Paragraph', '[span] Text group', '[label] Label']) {
    const root = node(name, [node('[a] Link', [node('[section] Group', [text('Nested copy')])])]);
    const result = await render(root);
    assert.doesNotMatch(result.html, /<(?:div|section)\b/);
    assert.match(result.html, /Nested copy/);
  }
});

test('form and label nesting is rejected at every depth without flattening children', async () => {
  for (const tag of ['form', 'label']) {
    const result = await render(node(`[${tag}] Outer`, [node('Group', [node(`[${tag}] Inner`, [text('Deep text')])])]));
    assert.equal(result.elements.filter(element => element.tagName === tag).length, 1);
    assert.match(result.html, /Deep text/);
  }
});

test('snapshot render-bound wrappers are spans inside a nested button group', async () => {
  const line = node('Line', [], { type: 'LINE', layoutMode: 'NONE', width: 40, height: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 0 },
    absoluteRenderBounds: { x: -2, y: -2, width: 44, height: 4 },
    exportAsync: async settings => {
      assert.equal(settings.format, 'PNG');
      return png;
    } });
  const result = await render(node('Button', [node('Icon group', [line]), text('Editable label')]));
  const wrapper = result.elements.find(element => attr(element, 'data-figma-id') === line.id);
  assert.equal(wrapper.tagName, 'span');
  assert.equal(wrapper.childNodes[0].tagName, 'img');
  assert.equal(result.context.assets.length, 1);
  assert.match(result.html, /Editable label/);
  assert.doesNotMatch(result.html, /<div\b/);
});

test('original tiled image fallback keeps paint and zero padding in a span', async () => {
  const tile = node('Tile', [], { type: 'RECTANGLE', layoutMode: 'NONE',
    fills: [{ type: 'IMAGE', imageHash: 'tile', scaleMode: 'TILE', scalingFactor: 0.5 }] });
  const result = await render(node('Button', [node('Icon group', [tile]), text('Caption')]));
  const paintedBox = result.elements.find(element => attr(element, 'data-figma-id') === tile.id);
  assert.equal(paintedBox.tagName, 'span');
  assert.equal(attr(paintedBox, 'role'), 'img');
  assert.match(result.css, /background-repeat:repeat/);
  assert.match(result.css, /padding:0/);
  assert.doesNotMatch(result.html, /<div\b/);
});

test('Builder accepts generated nested button content and still rejects invalid div children', async () => {
  const result = await render(node('Button', [node('Overlay', [node('SVG layout', [text('Import test')])])]));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
    plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
  try {
    const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
    const { createBlankProject } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
    const { KODETY_FIGMA_SIGNATURE, KODETY_FIGMA_VERSION } = await server.ssrLoadModule('/lib/figma/types.ts');
    const payload = {
      signature: KODETY_FIGMA_SIGNATURE, version: KODETY_FIGMA_VERSION, source: 'figma-plugin',
      exportId: 'semantic-import', exportedAt: new Date().toISOString(), documentName: 'Semantics', pageName: 'Page',
      html: result.html, css: result.css, assets: [], fonts: [], variables: [], warnings: [],
      stats: { nodes: result.context.nodeCount, assets: 0, bytes: result.html.length + result.css.length },
    };
    const imported = await importKodetyFigmaPayload(createBlankProject('Semantic round trip'), payload,
      { targetPath: '0', preferredStylesheetPath: 'styles.css' });
    assert.match(imported.project.files['index.html'].text, /<button\b/);
    assert.match(imported.project.files['index.html'].text, /Import test/);
    await assert.rejects(importKodetyFigmaPayload(createBlankProject('Invalid button'), {
      ...payload, html: '<button type="button"><div>Still invalid</div></button>',
    }, { targetPath: '0' }), /HTML inválido.*button.*div/);
  } finally {
    await server.close();
  }
});

test('legacy Figma button groups recover with classes, text, SVG and authored display intact', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
    plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
  try {
    const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
    const { createBlankProject } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
    const { KODETY_FIGMA_SIGNATURE, KODETY_FIGMA_VERSION } = await server.ssrLoadModule('/lib/figma/types.ts');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 12H22" stroke="red" stroke-width="2"/></svg>';
    const legacyCss = '.legacy-group{display:flex;gap:8px;padding:4px 8px}.legacy-icon{position:relative;width:24px;height:24px}';
    const payload = {
      signature: KODETY_FIGMA_SIGNATURE, version: KODETY_FIGMA_VERSION, source: 'figma-plugin',
      exportId: 'legacy-semantic-import', exportedAt: new Date().toISOString(), documentName: 'Legacy', pageName: 'Page',
      html: '<div class="outside" data-figma-id="legacy:outside"><div data-figma-id="legacy:outside-child">Outside</div></div>'
        + '<button class="legacy-button" type="button"><div class="legacy-group" data-figma-id="legacy:group" data-label="Overlay">'
        + '<span>Editable label</span><div class="legacy-icon" data-figma-id="legacy:icon" style="opacity:.5">'
        + '<img src="figma-asset://glyph" alt="Arrow" width="24" height="24"></div></div></button>',
      css: legacyCss,
      assets: [{ id: 'glyph', name: 'arrow.svg', mimeType: 'image/svg+xml', text: svg, width: 24, height: 24 }],
      fonts: [], variables: [], warnings: [], stats: { nodes: 8, assets: 1, bytes: 1000 },
    };
    const imported = await importKodetyFigmaPayload(createBlankProject('Legacy round trip'), payload,
      { targetPath: '0', preferredStylesheetPath: 'styles.css' });
    const html = imported.project.files['index.html'].text;
    const importedElements = elements(parseFragment(html));
    for (const id of ['legacy:group', 'legacy:icon']) {
      const group = importedElements.find(element => attr(element, 'data-figma-id') === id);
      assert.equal(group.tagName, 'span');
      assert.notEqual(attr(group, 'data-kodety-figma-block'), undefined);
    }
    assert.equal(attr(importedElements.find(element => attr(element, 'data-figma-id') === 'legacy:group'), 'class'), 'legacy-group');
    assert.equal(attr(importedElements.find(element => attr(element, 'data-figma-id') === 'legacy:group'), 'data-label'), 'Overlay');
    assert.match(attr(importedElements.find(element => attr(element, 'data-figma-id') === 'legacy:icon'), 'style'), /opacity:\s*\.5/);
    for (const id of ['legacy:outside', 'legacy:outside-child']) {
      const outside = importedElements.find(element => attr(element, 'data-figma-id') === id);
      assert.equal(outside.tagName, 'div', 'Compatibility must not retag groups outside buttons');
      assert.equal(attr(outside, 'data-kodety-figma-block'), undefined);
    }
    assert.match(html, /Editable label/);
    assert.equal(importedElements.filter(element => element.tagName === 'img').length, 1);
    const importedSvg = Object.values(imported.project.files).find(file => file.mimeType === 'image/svg+xml');
    assert.equal(new TextDecoder().decode(importedSvg.data), svg);
    const css = imported.project.files['styles.css'].text;
    const compatibility = ':where(span[data-kodety-figma-block])';
    assert.ok(css.includes(compatibility));
    assert.ok(css.indexOf(compatibility) < css.indexOf('.legacy-group'));
    assert.match(css, /\.legacy-group\s*\{[^}]*display:\s*flex/);
    assert.match(css, /gap:\s*8px/);
    assert.match(css, /padding:\s*4px 8px/);
    assert.ok(imported.warnings.some(warning => /^2 grupo\(s\).*normalizados/.test(warning)));

    const invalidPayload = html => ({ ...payload, html, assets: [], css: '' });
    for (const html of [
      '<button><div data-figma-id="outer"><div>Unmarked deep group</div></div></button>',
      '<button><div data-figma-id="outer"><a href="https://example.com">Nested control</a></div></button>',
      '<button><div data-figma-id="outer"><input type="text"></div></button>',
      '<a href="#"><div data-figma-id="outer"><button>Nested control</button></div></a>',
    ]) {
      await assert.rejects(importKodetyFigmaPayload(createBlankProject('Still invalid'), invalidPayload(html),
        { targetPath: '0' }), /HTML inválido/);
    }
  } finally {
    await server.close();
  }
});

if (process.argv.includes('--visual')) {
  test('retagged non-Auto-Layout spans keep their block box in positioned and flex parents', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', request => request.abort());
      for (const layoutMode of ['NONE', 'HORIZONTAL', 'GRID']) {
        const group = node('No Auto Layout', [text('Editable')], {
          layoutMode: 'NONE', width: 120, height: 32,
          absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 32 },
        });
        const result = await render(node('Button', [group], { layoutMode }));
        await page.setContent(`<style>body{margin:0}${result.css}</style>${result.html}`);
        const measured = await page.locator(`[data-figma-id="${group.id}"]`).evaluate(element => ({
          tag: element.tagName, display: getComputedStyle(element).display,
          width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
        }));
        assert.deepEqual(measured, { tag: 'SPAN', display: 'block', width: 120, height: 32 }, layoutMode);
      }
    } finally {
      await browser.close();
    }
  });
}
