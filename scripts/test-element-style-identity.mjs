import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const identity = await server.ssrLoadModule('/lib/html-editor/element-style-identity.ts');
  const css = await server.ssrLoadModule('/lib/html-editor/css-patcher.ts');
  const source = await server.ssrLoadModule('/lib/html-editor/source-patcher.ts');

  const counts = identity.collectElementStyleIdCounts([
    '<!doctype html><html><body><div data-kodety-style-id="element-000003"></div></body></html>',
    '<main data-kodety-style-id="element-000007"><p data-kodety-style-id="element-000003"></p></main>',
  ]);
  assert.equal(counts.get('element-000003'), 2, 'copied identities must be detectable across pages');
  assert.equal(counts.get('element-000007'), 1);
  assert.equal(identity.normalizeElementStyleId(' element-000007 '), 'element-000007');
  assert.equal(identity.normalizeElementStyleId('element-7'), '', 'private identities must use the canonical padded form');
  assert.equal(identity.normalizeElementStyleId('element-000000'), '', 'zero is not a valid private identity');

  const reserved = new Set(counts.keys());
  assert.equal(identity.createElementStyleId(reserved), 'element-000008');
  assert.equal(identity.createElementStyleId(reserved), 'element-000009');
  assert.deepEqual(
    [...identity.collectReferencedElementStyleIds([
      '[data-kodety-style-id="element-000010"] { color: red; }',
    ])],
    ['element-000010'],
    'orphan stylesheet rules must reserve their identity against later reuse',
  );

  const selector = identity.elementStyleSelector('element-000008');
  assert.equal(
    selector,
    '[data-kodety-style-id="element-000008"]'.repeat(3),
    'the private selector must be stable and independent from the DOM path',
  );

  assert.deepEqual(
    identity.inlineStyleDeclarationsForPromotion(
      'color: red; padding: 8px 12px; color: blue !important; --surface: rgb(1 2 3)',
    ),
    {
      color: 'blue',
      padding: '8px 12px',
      '--surface': 'rgb(1 2 3)',
    },
    'promotion must retain the complete effective inline block while normalizing legacy priority',
  );

  const context = {
    target: 'rule',
    selector,
    cssFilePath: 'styles.css',
    pseudo: 'base',
    breakpoint: 'base',
  };
  const migrated = css.patchCssDeclaration(
    '',
    context,
    'color',
    'red !important',
  );
  assert.match(migrated, /color:\s*red/i);
  assert.doesNotMatch(
    migrated,
    /color:\s*red\s*!important/i,
    'inline promotion must normalize legacy priority instead of authoring !important',
  );

  let html = '<!doctype html><html><head></head><body><div class="asset" style="color: red; padding: 8px !important"></div><div class="asset"></div></body></html>';
  const promotedId = identity.createElementStyleId(new Set());
  const promotedSelector = identity.elementStyleSelector(promotedId);
  html = source.patchElementAttribute(html, '0', identity.ELEMENT_STYLE_ID_ATTRIBUTE, promotedId);
  let promotedCss = '.asset { color: black; }';
  Object.entries(identity.inlineStyleDeclarationsForPromotion('color: red; padding: 8px !important'))
    .forEach(([property, propertyValue]) => {
      promotedCss = css.patchCssDeclaration(
        promotedCss,
        { ...context, selector: promotedSelector },
        property,
        propertyValue,
      );
    });
  html = source.patchElementAttribute(html, '0', 'style', '');
  assert.match(html, /<div class="asset" data-kodety-style-id="element-000001"><\/div>/i);
  assert.equal((html.match(/data-kodety-style-id=/g) || []).length, 1, 'a shared class sibling must not inherit the private identity');
  assert.doesNotMatch(html, /style=/i, 'the complete inline block must leave HTML after CSS is ready');
  assert.match(promotedCss, /color:\s*red/i);
  assert.match(promotedCss, /padding:\s*8px/i);
  assert.doesNotMatch(promotedCss, /!important/i);

  console.log('Element style identity regression tests passed');
} finally {
  await server.close();
}
