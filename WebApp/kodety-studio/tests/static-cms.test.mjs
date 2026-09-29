import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from '../../../scripts/vite-code-component-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const vite = await createServer({ root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
const { prepareStaticCmsProject, StaticCmsPublicationError } = await vite.ssrLoadModule('/lib/html-editor/static-cms.ts');
const { prepareStaticHtmlProject } = await vite.ssrLoadModule('/lib/html-editor/static-project.ts');
const { updateEditorMetadata } = await vite.ssrLoadModule('/lib/html-editor/project-io.ts');
const { defaultLocalization, createLocale } = await vite.ssrLoadModule('/lib/html-editor/localization.ts');
after(() => vite.close());

const type = (slug = 'posts', overrides = {}) => ({ slug, name: slug, singular: slug, urlSlug: slug, collection: true, fields: [{ key: 'field:body', label: 'Body', type: 'richtext', source: 'kodety' }], ...overrides });
const item = (id, overrides = {}) => ({ id, type: 'posts', label: `Item ${id}`, status: 'publish', revision: `item-${id}`, dateIso: `2026-09-${String(id).padStart(2, '0')}T12:00:00Z`, modifiedIso: '2026-09-20T12:00:00Z', values: { title: `Title ${id}`, slug: `item-${id}`, content: `<p>Content ${id}</p>`, ...overrides.values }, ...overrides });
function project({ types = [type()], items = [item(1)], templates = { posts: 'templates/post.html' }, files = {} } = {}) {
  const source = {
    'index.html': '<!doctype html><html><head><title>Home</title></head><body><div data-kodety-collection="posts" data-kodety-repeat="child"><article data-kodety-collection-item><h2 data-kodety-bind="title">Sample</h2><a data-kodety-bind-href="permalink">Read</a></article><p data-kodety-empty-state>Empty</p></div></body></html>',
    'templates/post.html': '<!doctype html><html><head><title>{{title}} · Site</title><link rel="stylesheet" href="../style.css"></head><body><h1 data-kodety-bind="title">Template</h1><div data-kodety-bind-content="content"></div><img src="../assets/image.bin"><script type="module">import "../module.js"; const comparison = 2 < 3;</script></body></html>',
    'style.css': 'body{color:red}', 'module.js': 'export const value=1;',
    '.incode/cms/schema.json': JSON.stringify({ version: 1, revision: 'schema-1', types, templates, customFields: { active: true, plugin: 'Kodety' } }),
    ...Object.fromEntries(items.map(value => [`.incode/cms/items/${value.type}/${value.id}.json`, JSON.stringify(value)])),
    ...files,
  };
  return { name: 'CMS', mainHtmlPath: 'index.html', rootPath: '', openedAt: 1, files: {
    ...Object.fromEntries(Object.entries(source).map(([path, text]) => [path, { path, text, mimeType: path.endsWith('.html') ? 'text/html' : path.endsWith('.json') ? 'application/json' : 'text/plain' }])),
    'assets/image.bin': { path: 'assets/image.bin', mimeType: 'application/octet-stream', data: Uint8Array.from([0, 255, 17]) },
  } };
}
const attr = (node, name) => node.attrs?.find(attribute => attribute.name === name)?.value;
function nodes(source) { const result = []; const visit = node => { result.push(node); node.childNodes?.forEach(visit); }; visit(parse(source)); return result; }
const content = node => node?.value || (node?.childNodes || []).map(content).join('');
const byTag = (source, tag, predicate = () => true) => nodes(source).find(node => node.tagName === tag && predicate(node));

test('published items generate physical pages; drafts, trash, CMS JSON and dedicated templates stay out of public output', () => {
  const source = project({ items: [item(1), item(2, { status: 'draft', values: { title: 'PRIVATE DRAFT', slug: 'private' } }), item(3, { status: 'trash' })] });
  const before = JSON.stringify(source), output = prepareStaticCmsProject(source);
  assert.equal(JSON.stringify(source), before, 'canonical editable files must remain untouched');
  assert.ok(output.files['posts/item-1/index.html']);
  assert.equal(output.files['posts/private/index.html'], undefined);
  assert.equal(output.files['posts/item-3/index.html'], undefined);
  assert.equal(output.files['templates/post.html'], undefined);
  assert.equal(Object.keys(output.files).some(path => path.startsWith('.incode/cms/')), false);
  assert.equal(JSON.stringify(output).includes('PRIVATE DRAFT'), false);
  assert.equal(content(byTag(output.files['posts/item-1/index.html'].text, 'h1')), 'Title 1');
  assert.deepEqual(output.files['assets/image.bin'].data, source.files['assets/image.bin'].data);
});

test('repeaters preserve nested collection contexts, child/self templates, ordering and empty states', () => {
  const home = '<html><body><section data-kodety-collection="posts" data-kodety-repeat="child" data-kodety-orderby="title" data-kodety-order="ASC" data-kodety-limit="1"><article data-kodety-collection-item><h2 data-kodety-bind="title"></h2><ul data-kodety-collection="tags" data-kodety-repeat="child"><li data-kodety-collection-item data-kodety-bind="title"></li></ul></article><p data-kodety-empty-state>Empty posts</p></section><aside data-kodety-collection="empty"><p data-kodety-empty-state>Nothing here</p><b>Sample</b></aside></body></html>';
  const output = prepareStaticCmsProject(project({
    types: [type(), type('tags'), type('empty')], templates: {},
    items: [item(1, { values: { title: 'Zed', slug: 'zed' } }), item(2, { values: { title: 'Alpha', slug: 'alpha' } }), item(3, { type: 'tags', values: { title: 'Nested tag', slug: 'nested' } })],
    files: { 'index.html': home },
  }));
  const rendered = output.files['index.html'].text;
  assert.deepEqual(nodes(rendered).filter(node => node.tagName === 'h2').map(content), ['Alpha']);
  assert.deepEqual(nodes(rendered).filter(node => node.tagName === 'li').map(content), ['Nested tag']);
  assert.match(rendered, /Nothing here/);
  assert.doesNotMatch(rendered, /Empty posts|>Sample</);
  assert.equal(attr(byTag(rendered, 'aside'), 'data-kodety-empty'), 'true');
});

test('binding targets escape plain text, sanitize rich text and block executable URLs without altering authored scripts', () => {
  const template = '<html><head><title>{{title}}</title></head><body><h1 data-kodety-bind="title"></h1><div id="rich" data-kodety-bind-content="field:body"></div><a id="bad" href="before" data-kodety-bind-href="field:url">Link</a><a id="slug" data-kodety-bind="slug"></a><img id="image" srcset="old 2x" data-kodety-bind-src="field:image" data-kodety-bind-alt="field:image"><script>const authored = 1 < 2;</script></body></html>';
  const output = prepareStaticCmsProject(project({ items: [item(1, { values: {
    title: '<img onerror="alert(1)"> & Text', slug: 'safe', 'field:url': 'javascript:alert(1)',
    'field:body': '<p>Rich <strong>bold</strong><script>alert(1)</script><img src="assets/image.bin" onerror="bad()"><a href="jav&#x61;script:bad()">bad</a></p>',
    'field:image': { url: 'assets/image.bin', alt: 'My & image', focalX: 200, focalY: 25, crop: 'portrait' },
  } })], files: { 'templates/post.html': template } }));
  const source = output.files['posts/safe/index.html'].text;
  assert.equal(content(byTag(source, 'h1')), '<img onerror="alert(1)"> & Text');
  assert.match(source, /<strong>bold<\/strong>/);
  assert.equal(attr(byTag(source, 'a', node => attr(node, 'id') === 'bad'), 'href'), undefined);
  assert.equal(attr(byTag(source, 'a', node => attr(node, 'id') === 'slug'), 'href'), '../posts/safe/index.html');
  const image = byTag(source, 'img', node => attr(node, 'id') === 'image');
  assert.equal(attr(image, 'alt'), 'My & image');
  assert.equal(attr(image, 'src'), '../assets/image.bin');
  assert.equal(attr(image, 'srcset'), undefined);
  assert.equal(attr(image, 'style'), 'object-position:100% 25%;aspect-ratio:4/5;object-fit:cover;');
  const scripts = nodes(source).filter(node => node.tagName === 'script').map(content);
  assert.deepEqual(scripts, ['const authored = 1 < 2;']);
  assert.equal(nodes(source).some(node => (node.attrs || []).some(attribute => attribute.name.startsWith('on'))), false);
  assert.equal(nodes(source).some(node => (node.attrs || []).some(attribute => ['href', 'src'].includes(attribute.name) && attribute.value.startsWith('javascript:'))), false);
});

test('generated routes preserve nested template assets and participate in localization, SEO and sitemap', () => {
  let source = project({ items: [item(1), item(2)] });
  source = updateEditorMetadata(source, metadata => ({ ...metadata,
    siteSettings: { siteTitle: 'Example', baseUrl: 'https://example.test/site', sitemapEnabled: true },
    pageSettings: { 'templates/post.html': { title: '{{title}}', description: '{{excerpt}}' } },
    pageStatuses: { 'templates/post.html': 'draft' },
    localization: { ...defaultLocalization('pt-BR'), locales: [createLocale('pt-BR'), { ...createLocale('en-US'), slug: 'en' }], translations: { 'en-US': { pages: { 'templates/post.html': { title: '{{title}} English', entries: {} } } } } },
  }));
  const output = prepareStaticHtmlProject(source), page = output.files['en/posts/item-1/index.html'].text;
  assert.equal(output.files['templates/post.html'], undefined);
  const base = new URL(attr(byTag(page, 'base'), 'href'), 'https://example.test/site/en/posts/item-1/index.html');
  assert.equal(new URL(attr(byTag(page, 'link', node => attr(node, 'rel') === 'stylesheet'), 'href'), base).href, 'https://example.test/site/style.css');
  assert.equal(new URL(attr(byTag(page, 'img'), 'src'), base).href, 'https://example.test/site/assets/image.bin');
  assert.equal(new URL('../module.js', base).href, 'https://example.test/site/module.js');
  assert.match(page, /const comparison = 2 < 3/);
  assert.match(content(byTag(page, 'title')), /Title 1 English/);
  assert.match(content(byTag(output.files['en/posts/item-2/index.html'].text, 'title')), /Title 2 English/);
  assert.equal(attr(byTag(page, 'link', node => attr(node, 'rel') === 'canonical'), 'href'), 'https://example.test/site/en/posts/item-1/');
  assert.match(output.files['sitemap.xml'].text, /https:\/\/example\.test\/site\/en\/posts\/item-1\//);
  assert.equal(Object.keys(output.files).some(path => path.startsWith('.incode/cms/')), false);
});

test('missing templates, invalid route slugs and duplicate item/static paths fail before publication', () => {
  assert.throws(() => prepareStaticCmsProject(project({ templates: { posts: 'missing.html' } })), /modelo|template|encontrad/i);
  assert.throws(() => prepareStaticCmsProject(project({ items: [item(1, { values: { slug: '../escape' } })] })), /slug|caminho|CMS|inválid/i);
  assert.throws(() => prepareStaticCmsProject(project({ items: [item(1), item(2, { values: { slug: 'item-1' } })] })), /URL|slug|duplicad/i);
  assert.throws(() => prepareStaticCmsProject(project({ files: { 'posts/item-1/index.html': '<p>Existing</p>' } })), error => {
    assert.ok(error instanceof StaticCmsPublicationError);
    assert.ok(error.cause instanceof Error);
    assert.match(error.message, /URL/);
    assert.equal(error.message, error.cause.message);
    return true;
  });
  assert.throws(() => prepareStaticCmsProject(project({ templates: { posts: 'index.html' } })), /inicial/);
});

test('materialized base keeps fragment links, query links and empty form actions on the generated item page', () => {
  const output = prepareStaticCmsProject(project({ files: { 'templates/post.html': '<html><head></head><body><a id="fragment" href="#section">Section</a><a id="query" href="?view=full#section">Full</a><a id="self" href="post.html#section">Self</a><form action=""><button formaction="?save=1">Save</button></form><h2 id="section">Section</h2></body></html>' } }));
  const source = output.files['posts/item-1/index.html'].text;
  const location = 'https://example.test/site/posts/item-1/index.html';
  const base = new URL(attr(byTag(source, 'base'), 'href'), location);
  for (const id of ['fragment', 'self']) assert.equal(new URL(attr(byTag(source, 'a', node => attr(node, 'id') === id), 'href'), base).href, location + '#section');
  assert.equal(new URL(attr(byTag(source, 'a', node => attr(node, 'id') === 'query'), 'href'), base).href, location + '?view=full#section');
  assert.equal(new URL(attr(byTag(source, 'form'), 'action'), base).href, location);
  assert.equal(new URL(attr(byTag(source, 'button'), 'formaction'), base).href, location + '?save=1');
});

test('singular SEO expressions preserve entities and JSON-LD escaping while collection cards keep their own item', () => {
  const template = '<html><head><title>{{title}} &amp; Brand</title><meta name="description" content="{{excerpt}}"><script type="application/ld+json" data-kodety-seo>{"name":"{{title}}"}</script></head><body><h1 data-kodety-bind="title"></h1><aside data-kodety-collection="posts" data-kodety-order="ASC" data-kodety-repeat="child"><b data-kodety-collection-item data-kodety-bind="title"></b></aside></body></html>';
  const output = prepareStaticCmsProject(project({ items: [item(1, { values: { slug: 'first', title: 'A & </script>', excerpt: '"Description"' } }), item(2, { values: { slug: 'second', title: 'Second' } })], files: { 'templates/post.html': template } }));
  const source = output.files['posts/second/index.html'].text;
  assert.equal(content(byTag(source, 'title')), 'Second & Brand');
  assert.deepEqual(nodes(source).filter(node => node.tagName === 'b').map(content), ['A & </script>', 'Second']);
  const first = output.files['posts/first/index.html'].text;
  const json = content(byTag(first, 'script', node => attr(node, 'data-kodety-seo') !== undefined));
  assert.equal(JSON.parse(json).name, 'A & </script>');
  assert.equal(json.includes('</script>'), false);
});

test('projects with no CMS preserve their existing HTML and assets', () => {
  const source = project({ templates: {}, items: [], types: [] });
  delete source.files['.incode/cms/schema.json'];
  delete source.files['templates/post.html'];
  source.files['index.html'].text = '<!doctype html><title>Exact source</title><script>const x = 1 < 2;</script>';
  assert.deepEqual(prepareStaticCmsProject(source), source);
});
