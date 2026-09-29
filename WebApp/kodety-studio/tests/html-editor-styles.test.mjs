import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let stylesheet;
before(async () => {
  // Exercise the real PostCSS import/layer pipeline with the exact shared
  // stylesheets used by the Web App and WordPress entrypoints.
  const input = [
    '@import "./WebApp/kodety-studio/src/studio-shell.css";',
    '@import "./app/globals.css";',
    '@import "./Wordpress/editor/wordpress-editor.css";',
    '@import "./WebApp/kodety-studio/src/html-workspace.css";',
    '@source inline("size-4 text-xs border rounded-lg p-2 hidden");',
  ].join('\n');
  stylesheet = (await postcss([tailwindcss({ base: root })]).process(input, { from: path.join(root, 'html-editor-style-fixture.css') })).root;
});

function rules(selector) {
  const matching = [];
  stylesheet.walkRules(rule => { if (rule.selector === selector) matching.push(rule); });
  return matching;
}
function layer(rule) {
  for (let node = rule.parent; node; node = node.parent) if (node.type === 'atrule' && node.name === 'layer') return node.params;
  return null;
}
function declaration(rule, prop) { return rule.nodes.find(node => node.type === 'decl' && node.prop === prop)?.value; }

test('Studio resets compile below the shared Builder utilities instead of overriding borders, fonts and sizing', () => {
  const buttonReset = rules('button').find(rule => declaration(rule, 'border') === '0');
  assert.ok(buttonReset, 'the original Studio reset was imported');
  assert.equal(layer(buttonReset), 'base', 'a plain shell reset must never outrank Tailwind utilities');
  for (const selector of ['.border', '.text-xs', '.size-4', '.p-2', '.hidden']) {
    const rule = rules(selector)[0];
    assert.ok(rule, `${selector} exists in the actual generated shared stylesheet`);
    assert.equal(layer(rule), 'utilities');
  }
  assert.equal(declaration(rules('.border')[0], 'border-width'), '1px');
  assert.equal(declaration(rules('.size-4')[0], 'width'), 'calc(var(--spacing) * 4)');
  const layerOrder = stylesheet.nodes.find(node => node.type === 'atrule' && node.name === 'layer' && node.params.includes('utilities') && !node.nodes);
  assert.ok(layerOrder.params.indexOf('base') < layerOrder.params.indexOf('utilities'));
});

test('HTML editor uses WordPress rem and typography while the Studio library keeps its own scale', () => {
  const libraryRoot = rules(':root').find(rule => declaration(rule, 'font-size') === '12px');
  assert.ok(libraryRoot, 'the library keeps its shared 12px scale');
  assert.equal(layer(libraryRoot), 'base');
  const editorRoot = rules('html:has(> body.kodety-wordpress-editor)')[0];
  assert.equal(declaration(editorRoot, 'font-size'), '100%', 'editor restores the browser rem scale used by WordPress');
  assert.equal(layer(editorRoot), null, 'the editor activation scope overrides the shell root reset');
  const host = rules('.web-html-workspace')[0];
  assert.equal(declaration(host, 'font'), 'inherit', 'the HTML host must not invent a different Builder font/size');
  assert.ok(rules('body.kodety-wordpress-editor').some(rule => declaration(rule, 'font-size') === '12px'), 'the actual shared WordPress body rules are compiled');
});

test('HTML integration imports the same Builder theme files as WordPress and keeps the Studio CSS in its base wrapper', async () => {
  const [webEntry, wpEntry, app, wrapper] = await Promise.all([
    'WebApp/kodety-studio/src/html-workspace.tsx', 'Wordpress/editor/main.tsx',
    'WebApp/kodety-studio/src/app.tsx', 'WebApp/kodety-studio/src/studio-shell.css',
  ].map(file => readFile(path.join(root, file), 'utf8')));
  for (const suffix of ['app/globals.css', 'wordpress-editor.css']) {
    assert.ok(webEntry.includes(suffix), `HTML entry imports ${suffix}`);
    assert.ok(wpEntry.includes(suffix), `WordPress entry imports ${suffix}`);
  }
  assert.match(app, /import\s+["']\.\/studio-shell\.css["']/);
  assert.doesNotMatch(app, /import\s+["'][^"']*ChromeExtension[^"']*styles\.css["']/);
  assert.match(wrapper, /@import\s+["'][^"']*ChromeExtension\/kodety-studio\/src\/styles\.css["']\s+layer\(base\)/);
});

test('loading the shared WordPress workspace cannot add unlayered Studio resets to the HTML Builder', async () => {
  const [sharedWorkspace, extensionEntry, previewEntry] = await Promise.all([
    'ChromeExtension/kodety-studio/src/main.tsx',
    'ChromeExtension/kodety-studio/src/bootstrap.tsx',
    'WebApp/kodety-studio/src/preview.ts',
  ].map(file => readFile(path.join(root, file), 'utf8')));
  assert.doesNotMatch(sharedWorkspace, /import\s+["'][^"']*\.css["']/, 'shared workspace modules leave shell styles to their host entrypoint');
  assert.match(extensionEntry, /import\s+["']\.\/styles\.css["']/, 'the extension retains its original stylesheet');
  assert.match(previewEntry, /import\s+["']\.\/studio-shell\.css["']/, 'preview shares the layered shell because production combines every route stylesheet');
});
