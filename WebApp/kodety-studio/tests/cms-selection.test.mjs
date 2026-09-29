import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../../lib/html-editor/cms-selection.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const { initialCmsCollection, resolveCmsCollection } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const types = [{ slug: 'kodety_news' }, { slug: 'kodety_products' }];

test('HTML waits for its schema even when the URL requests the WordPress post type', () => {
  for (const requested of ['', 'post', 'kodety_news']) assert.equal(initialCmsCollection(true, requested, 'post'), '');
  assert.equal(resolveCmsCollection([], '', 'post', 'post', true), '');
  assert.equal(resolveCmsCollection([], 'kodety_deleted', 'post', '', true), '');
});

test('HTML resolves valid requested collections and stale links only to real project collections', () => {
  assert.equal(resolveCmsCollection(types, '', 'kodety_products', '', true), 'kodety_products');
  assert.equal(resolveCmsCollection(types, '', 'post', '', true), 'kodety_news');
  assert.equal(resolveCmsCollection(types, '', 'kodety_removed', 'kodety_products', true), 'kodety_products');
  assert.equal(resolveCmsCollection(types, 'kodety_products', 'kodety_news', '', true), 'kodety_products');
  assert.equal(resolveCmsCollection([{ slug: 'page' }, ...types], '', 'page', '', true), 'kodety_news');
});

test('creation and deletion select saved collections without inventing a new type or mutating schema', () => {
  const first = structuredClone(types);
  assert.equal(resolveCmsCollection(first.slice(0, 1), '', 'post', '', true), 'kodety_news');
  assert.equal(resolveCmsCollection(first.slice(1), 'kodety_news', 'post', '', true), 'kodety_products');
  assert.equal(resolveCmsCollection([], 'kodety_products', 'post', '', true), '');
  assert.deepEqual(first, types);
});

test('native WordPress retains immediate post reads and its existing post preference', () => {
  assert.equal(initialCmsCollection(false), 'post');
  assert.equal(initialCmsCollection(false, 'product', 'post'), 'product');
  assert.equal(initialCmsCollection(false, '', 'product'), 'product');
  assert.equal(resolveCmsCollection([], 'post', '', '', false), 'post');
  assert.equal(resolveCmsCollection([...types, { slug: 'post' }], 'missing', '', '', false), 'post');
  assert.equal(resolveCmsCollection(types, '', '', '', false), 'kodety_news');
});
