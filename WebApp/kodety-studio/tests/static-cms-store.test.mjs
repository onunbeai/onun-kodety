import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { createStaticCmsTransport, readStaticCms, staticCmsItemRoute, sanitizeStaticCmsRichText, STATIC_CMS_SCHEMA_PATH } = await server.ssrLoadModule('/lib/html-editor/static-cms-store.ts');
after(() => server.close());
const textFile = (path, text) => ({ path, mimeType: path.endsWith('.html') ? 'text/html' : 'application/json', text });
function fixture(product = { features: { cms: true }, limits: { collections: 3, itemsPerCollection: 50 } }) {
  let project = { name: 'Site', mainHtmlPath: 'index.html', rootPath: '', openedAt: 1, files: {
    'index.html': textFile('index.html', '<main>Authored design</main>'),
    'styles.css': { path: 'styles.css', mimeType: 'text/css', text: 'main{color:purple}' },
    'photo.png': { path: 'photo.png', mimeType: 'image/png', data: new Uint8Array([1, 2, 3, 4]) },
  } };
  let fail = false;
  const commits = [];
  const transport = createStaticCmsTransport({ baseUrl: 'https://studio.test/__cms__/site', getProject: () => project, getProduct: () => product,
    async commitProject(next, context) { if (fail) throw new Error('Disk full'); commits.push(context); project = next; },
  });
  const request = async (route, method = 'GET', body) => {
    const response = await transport.fetch(`https://studio.test/__cms__/site/${route}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const schema = async () => (await request('schema')).body;
  const collection = async (name = 'Articles') => {
    const result = await request('collections', 'POST', { name, singular: 'Article', slug: name, expectedRevision: (await schema()).revision });
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
  };
  const createItem = async (type, values) => {
    const result = await request(`items/${type}`, 'POST', { values, expectedRevision: (await schema()).revision });
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
  };
  return { transport, request, schema, collection, createItem, commits,
    get project() { return project; },
    set project(next) { project = next; },
    set fail(value) { fail = value; },
  };
}

test('an empty HTML CMS has no WordPress post collection and missing reads never create data', async () => {
  const f = fixture(); const before = structuredClone(f.project);
  assert.deepEqual((await f.schema()).types, []);
  for (const endpoint of ['items/post', 'fields/post', 'items/kodety_missing', 'fields/kodety_missing']) {
    const response = await f.request(endpoint);
    assert.equal(response.status, 404); assert.equal(response.body.code, 'kodety_cms_collection_missing');
  }
  assert.equal(f.commits.length, 0);
  assert.deepEqual(f.project, before); f.transport.dispose();
});

test('empty project reads do not modify files; collection rename preserves identifiers, routes and original source', async () => {
  const f = fixture();
  assert.deepEqual(readStaticCms(f.project).schema.types, []); assert.equal(f.commits.length, 0);
  const type = await f.collection('Artigos de saúde');
  assert.equal(type.slug, 'kodety_artigos_de_saude'); assert.equal(type.urlSlug, 'artigos-de-saude');
  assert.deepEqual(f.commits[0].changedPaths, [STATIC_CMS_SCHEMA_PATH]);
  const renamed = await f.request(`collections/${type.slug}`, 'PUT', { name: 'Novidades', singular: 'Novidade', expectedRevision: (await f.schema()).revision });
  assert.equal(renamed.status, 200);
  const stored = readStaticCms(f.project).schema.types[0];
  assert.equal(stored.slug, type.slug); assert.equal(stored.urlSlug, type.urlSlug); assert.equal(stored.name, 'Novidades');
  assert.equal(f.project.files['index.html'].text, '<main>Authored design</main>');
  assert.deepEqual([...f.project.files['photo.png'].data], [1, 2, 3, 4]); f.transport.dispose();
});

test('each item update changes only its JSON file while metadata, other items and media remain intact', async () => {
  const f = fixture(); const type = await f.collection();
  const first = await f.createItem(type.slug, { title: 'First item', status: 'publish' });
  const second = await f.createItem(type.slug, { title: 'Second item', status: 'draft' });
  const schemaBefore = f.project.files[STATIC_CMS_SCHEMA_PATH];
  const secondPath = `.incode/cms/items/${type.slug}/${second.id}.json`, secondBefore = f.project.files[secondPath];
  f.commits.length = 0;
  const saved = await f.request(`items/${type.slug}/${first.id}`, 'POST', { values: { excerpt: 'Only this item changed' }, expectedRevision: first.revision });
  assert.equal(saved.status, 200); assert.notEqual(saved.body.revision, first.revision);
  assert.deepEqual(f.commits[0].changedPaths, [`.incode/cms/items/${type.slug}/${first.id}.json`]);
  assert.equal(f.project.files[STATIC_CMS_SCHEMA_PATH], schemaBefore); assert.equal(f.project.files[secondPath], secondBefore);
  assert.deepEqual(staticCmsItemRoute(type, saved.body), { path: 'articles/first-item/index.html', permalink: '/articles/first-item/' });
  assert.equal((await f.request(`items/${type.slug}?status=publish`)).body.items.length, 1); f.transport.dispose();
});

test('unchanged item saves do not create new revisions or upload-worthy file changes', async () => {
  const f = fixture(); const type = await f.collection(); const item = await f.createItem(type.slug, { title: 'Same item', status: 'publish' });
  f.commits.length = 0;
  const saved = await f.request(`items/${type.slug}/${item.id}`, 'POST', { values: { title: item.label, status: item.status }, expectedRevision: item.revision });
  assert.equal(saved.status, 200); assert.equal(saved.body.revision, item.revision); assert.equal(f.commits.length, 0); f.transport.dispose();
});

test('stale schema/item revisions are rejected without overwriting current changes', async () => {
  const f = fixture(); const initial = await f.schema();
  const [first, second] = await Promise.all([
    f.request('collections', 'POST', { name: 'News', expectedRevision: initial.revision }),
    f.request('collections', 'POST', { name: 'Products', expectedRevision: initial.revision }),
  ]);
  assert.equal(first.status, 201); assert.equal(second.status, 409); assert.equal(second.body.code, 'kodety_revision_conflict');
  const item = await f.createItem(first.body.slug, { title: 'Stable title' });
  const saved = await f.request(`items/${first.body.slug}/${item.id}`, 'POST', { values: { title: 'Newer title' }, expectedRevision: item.revision });
  assert.equal(saved.status, 200);
  const stale = await f.request(`items/${first.body.slug}/${item.id}`, 'POST', { values: { title: 'Stale title' }, expectedRevision: item.revision });
  assert.equal(stale.status, 409); assert.equal(readStaticCms(f.project).items[0].label, 'Newer title'); f.transport.dispose();
});

test('failed commits and invalid CSV batches leave the complete project unchanged', async () => {
  const f = fixture(); const type = await f.collection();
  const before = JSON.stringify(f.project); f.fail = true;
  const failed = await f.request(`items/${type.slug}`, 'POST', { values: { title: 'Not durable' }, expectedRevision: (await f.schema()).revision });
  assert.equal(failed.status, 500); assert.equal(JSON.stringify(f.project), before);
  f.fail = false;
  const invalid = await f.request(`items/${type.slug}/import`, 'POST', { items: [{ values: { title: 'First valid' } }, { values: { title: '' } }], expectedRevision: (await f.schema()).revision });
  assert.equal(invalid.status, 400); assert.equal(JSON.stringify(f.project), before);
  const imported = await f.request(`items/${type.slug}/import`, 'POST', { items: [{ values: { title: 'One' } }, { values: { title: 'Two' } }], expectedRevision: (await f.schema()).revision });
  assert.equal(imported.status, 201); assert.equal(imported.body.imported, 2); assert.equal(readStaticCms(f.project).items.length, 2); f.transport.dispose();
});

test('product collection and item limits are enforced in mutations as well as capabilities', async () => {
  const f = fixture({ features: { cms: true }, limits: { collections: 1, itemsPerCollection: 1 } });
  const type = await f.collection(); await f.createItem(type.slug, { title: 'Only item' });
  assert.equal((await f.schema()).types[0].capabilities.create, false);
  const extraItem = await f.request(`items/${type.slug}`, 'POST', { values: { title: 'Extra' }, expectedRevision: (await f.schema()).revision });
  assert.equal(extraItem.status, 403); assert.equal(extraItem.body.code, 'kodety_cms_item_limit');
  const extraCollection = await f.request('collections', 'POST', { name: 'Extra', expectedRevision: (await f.schema()).revision });
  assert.equal(extraCollection.status, 403); assert.equal(readStaticCms(f.project).schema.types.length, 1); f.transport.dispose();
});

test('custom fields validate values and sanitize rich text and URL payloads before persistence', async () => {
  const f = fixture(); const type = await f.collection();
  const fields = await f.request(`fields/${type.slug}`, 'POST', { expectedRevision: (await f.schema()).revision, fields: [
    { name: 'body', label: 'Body', type: 'richtext' }, { name: 'price', label: 'Price', type: 'number', min: 0, max: 100 }, { name: 'link', label: 'Link', type: 'url' },
    { name: 'safe_default', label: 'Safe default', type: 'richtext', default: '<p>Default<script>bad()</script></p>' },
  ] });
  assert.equal(fields.status, 200);
  const item = await f.createItem(type.slug, { title: '<b>Safe title</b>', 'field:body': '<p onclick="steal()">Hello <strong>world</strong><script>steal()</script><a href="javascript:steal()">bad</a></p>', 'field:price': 10 });
  assert.equal(item.label, 'Safe title');
  const body = readStaticCms(f.project).items[0].values['field:body'];
  assert.match(body, /<strong>world<\/strong>/); assert.ok(!/script|onclick|javascript|steal/.test(body));
  assert.equal(readStaticCms(f.project).items[0].values['field:safe_default'], '<p>Default</p>');
  const malicious = await f.request(`items/${type.slug}/${item.id}`, 'POST', { values: { 'field:link': 'javascript:alert(1)' }, expectedRevision: item.revision });
  assert.equal(malicious.status, 400);
  const tooMuch = await f.request(`items/${type.slug}/${item.id}`, 'POST', { values: { 'field:price': 101 }, expectedRevision: item.revision });
  assert.equal(tooMuch.status, 400); assert.equal(readStaticCms(f.project).items[0].values['field:price'], 10);
  assert.equal(sanitizeStaticCmsRichText('<svg><script>alert(1)</script></svg><p>Text</p>'), '<p>Text</p>'); f.transport.dispose();
});

test('uploaded images persist as project assets and canonical paths, never transient blob URLs', async () => {
  const f = fixture(); const type = await f.collection();
  await f.request(`fields/${type.slug}`, 'POST', { fields: [{ name: 'cover', label: 'Cover', type: 'image' }], expectedRevision: (await f.schema()).revision });
  const form = new FormData(); form.set('file', new File([new Uint8Array([137, 80, 78, 71, 4, 5])], 'image.png', { type: 'image/png' })); form.set('title', 'Cover');
  const upload = await f.transport.fetch(f.transport.config.mediaUploadUrl, { method: 'POST', body: form });
  assert.equal(upload.status, 201); const attachment = await upload.json(); assert.match(attachment.source_url, /^blob:/);
  const item = await f.createItem(type.slug, { title: 'With media', featured_image: attachment.id, 'field:cover': attachment.source_url });
  assert.equal(item.featuredImageId, attachment.id);
  const persisted = readStaticCms(f.project).items[0];
  assert.match(persisted.values.featured_image, /^assets\/cms\//); assert.equal(persisted.values['field:cover'], persisted.values.featured_image);
  assert.ok(f.project.files[persisted.values.featured_image]);
  assert.ok(!Object.values(f.project.files).filter(file => file.text !== undefined).some(file => file.text.includes('blob:')));
  f.project = structuredClone(f.project);
  const listed = (await f.request(`items/${type.slug}`)).body.items[0]; assert.match(listed.thumbnail, /^blob:/);
  const heldPreview = await f.request(`items/${type.slug}/${item.id}`, 'POST', { values: { 'field:cover': attachment.source_url }, expectedRevision: item.revision });
  assert.equal(heldPreview.status, 200, 'An open form can still save a preview alias created before immutable file replacement'); f.transport.dispose();
});

test('soft deletion retains data, refuses deleting populated collections, and leaves orphan trash recoverable', async () => {
  const f = fixture(); const type = await f.collection(); const item = await f.createItem(type.slug, { title: 'Retain me' });
  const populated = await f.request(`collections/${type.slug}`, 'DELETE', { confirmation: type.slug, deleteItems: false, expectedRevision: (await f.schema()).revision });
  assert.equal(populated.status, 409);
  const deleted = await f.request(`items/${type.slug}/${item.id}`, 'DELETE', { expectedRevision: item.revision });
  assert.equal(deleted.body.deleted, item.id); assert.equal(deleted.body.status, 'trash');
  assert.equal((await f.request(`items/${type.slug}`)).body.total, 0); assert.equal((await f.request(`items/${type.slug}?status=trash`)).body.total, 1);
  const removed = await f.request(`collections/${type.slug}`, 'DELETE', { confirmation: type.slug, deleteItems: false, expectedRevision: (await f.schema()).revision });
  assert.equal(removed.status, 200); assert.equal(readStaticCms(f.project).schema.types.length, 0);
  assert.equal(readStaticCms(f.project).items[0].label, 'Retain me'); f.transport.dispose();
});

test('Inspector attachment IDs work for custom images and rich text previews round-trip to durable paths', async () => {
  const f = fixture(); const type = await f.collection();
  await f.request(`fields/${type.slug}`, 'POST', { fields: [{ name: 'cover', label: 'Cover', type: 'image' }, { name: 'body', label: 'Body', type: 'richtext' }], expectedRevision: (await f.schema()).revision });
  const form = new FormData(); form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
  const upload = await f.transport.fetch(f.transport.config.mediaUploadUrl, { method: 'POST', body: form });
  const attachment = await upload.json();
  const item = await f.createItem(type.slug, { title: 'Images', 'field:cover': attachment.id, content: '<p>Hello<img src="photo.png" alt="Photo"></p>', 'field:body': '<img src="/photo.png"><img src="https://example.test/photo.png">' });
  assert.match(item.values['field:cover'], /^blob:/);
  assert.match(item.values.content, /src="blob:/);
  assert.match(item.values['field:body'], /src="blob:/);
  assert.match(item.values['field:body'], /src="https:\/\/example.test\/photo.png"/);
  assert.match(readStaticCms(f.project).items[0].values['field:cover'], /^assets\/cms\//);
  const saved = await f.request(`items/${type.slug}/${item.id}`, 'POST', { expectedRevision: item.revision, values: { content: item.values.content + '<p>Edited</p>', 'field:body': item.values['field:body'] } });
  assert.equal(saved.status, 200);
  const stored = readStaticCms(f.project).items[0];
  assert.match(stored.values.content, /src="photo.png"/);
  assert.match(stored.values.content, /<p>Edited<\/p>/);
  assert.ok(!JSON.stringify(stored).includes('blob:'));
  const rejected = await f.request(`items/${type.slug}/${item.id}`, 'POST', { expectedRevision: saved.body.revision, values: { 'field:cover': attachment.id + 1 } });
  assert.equal(rejected.status, 400, 'Unknown attachment IDs cannot erase the selected image');
  const structured = await f.request(`items/${type.slug}/${item.id}`, 'POST', { expectedRevision: saved.body.revision, values: { 'field:cover': { url: attachment.source_url, alt: '<b>Photo</b>', focalX: 25, focalY: 140, crop: 'square' } } });
  assert.equal(structured.status, 200);
  assert.match(structured.body.values['field:cover'].url, /^blob:/);
  const persistedImage = readStaticCms(f.project).items[0].values['field:cover'];
  assert.match(persistedImage.url, /^assets\/cms\//);
  assert.deepEqual({ ...persistedImage, url: '' }, { url: '', alt: 'Photo', focalX: 25, focalY: 100, crop: 'square' });
  const defaultImage = await f.request(`fields/${type.slug}`, 'POST', { expectedRevision: (await f.schema()).revision, fields: [{ name: 'cover', label: 'Cover', type: 'image', default: attachment.source_url }] });
  assert.equal(defaultImage.status, 200);
  assert.match(readStaticCms(f.project).schema.types[0].fields.find(field => field.key === 'field:cover').default, /^assets\/cms\//);
  f.transport.dispose();
});

test('template mapping changes only schema and rejects missing/private templates', async () => {
  const f = fixture(); const type = await f.collection();
  const saved = await f.request('templates', 'POST', { postType: type.slug, htmlPath: 'index.html' });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.templates, { [type.slug]: 'index.html' });
  assert.deepEqual(f.commits.at(-1).changedPaths, [STATIC_CMS_SCHEMA_PATH]);
  const invalid = await f.request('templates', 'POST', { postType: type.slug, htmlPath: '../outside.html' });
  assert.equal(invalid.status, 400); assert.equal(readStaticCms(f.project).schema.templates[type.slug], 'index.html'); f.transport.dispose();
});

test('corrupt stored CMS is reported without replacing files, and transport never escapes its project prefix', async () => {
  const f = fixture();
  f.project = { ...f.project, files: { ...f.project.files, [STATIC_CMS_SCHEMA_PATH]: textFile(STATIC_CMS_SCHEMA_PATH, '{broken') } };
  const response = await f.request('schema'); assert.equal(response.status, 422); assert.equal(f.commits.length, 0);
  assert.equal(f.project.files[STATIC_CMS_SCHEMA_PATH].text, '{broken');
  const outside = await f.transport.fetch('https://studio.test/__cms__/other/schema'); assert.equal(outside.status, 404);
  f.transport.dispose(); await assert.rejects(f.transport.fetch(f.transport.config.cmsSchemaUrl), error => error.name === 'AbortError');
});
