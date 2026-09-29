import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from '../../../scripts/vite-code-component-runtime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { prepareProjectForDraftTransport, updateEditorMetadata, readEditorMetadata, projectToZipBlob, importZip } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
const { defaultLocalization, createLocale } = await server.ssrLoadModule('/lib/html-editor/localization.ts');
const { prepareStaticHtmlProject } = await server.ssrLoadModule('/lib/html-editor/static-project.ts');
const { attachStaticHtmlSource, restoreStaticHtmlSource, STATIC_SOURCE_MANIFEST } = await server.ssrLoadModule('/lib/html-editor/static-source.ts');
const { createHtmlSiteZip, createHtmlWordPressZip } = await server.ssrLoadModule('/WebApp/kodety-studio/src/html-archives.ts');
const { createHtmlFtpUpload } = await server.ssrLoadModule('/WebApp/kodety-studio/src/html-deployment-ftp.ts');
after(() => server.close());

function fixture() {
  const html = '<!doctype html><html lang="pt-BR"><head><title>Origem</title><link rel="stylesheet" href="style.css"></head><body><h1 data-kodety-l10n-id="heading">Olá</h1><img src="images/photo.png"></body></html>';
  const files = Object.fromEntries(Object.entries({ 'index.html': html, 'about.html': html, 'draft.html': '<h1>Rascunho privado</h1>', 'style.css': 'h1 { color: red !important; }', 'script.js': 'export const source = "original";' }).map(([path, text]) => [path, { path, text, mimeType: path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript' }]));
  files['images/photo.png'] = { path: 'images/photo.png', mimeType: 'image/png', data: new Uint8Array([0, 255, 17, 49]) };
  const source = { name: 'Fonte editável', rootPath: '', mainHtmlPath: 'index.html', openedAt: 1, files };
  return updateEditorMetadata(source, current => ({ ...current, projectId: 'archive-test', pageStatuses: { 'draft.html': 'draft' }, siteSettings: { siteTitle: 'Fonte', baseUrl: 'https://example.com' }, localization: {
    ...defaultLocalization('pt-BR'), defaultLocale: 'en-US', translatePagePaths: true,
    locales: [{ ...createLocale('pt-BR'), slug: 'pt' }, { ...createLocale('en-US'), slug: 'en' }],
    translations: { 'en-US': { siteTitle: 'English', pages: { 'index.html': { title: 'Home', entries: { 'id:heading:text': 'Hello' } }, 'about.html': { path: 'company', title: 'Company', entries: { 'id:heading:text': 'About us' } } } } },
  } }));
}
function assertFilesEqual(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], key);
}

test('editable ZIP roundtrips exact canonical files and metadata through real shared ZIP importer', async () => {
  const source = prepareProjectForDraftTransport(fixture(), '2026-09-13T12:00:00.000Z');
  const compiled = prepareStaticHtmlProject(source);
  assert.match(compiled.files['index.html'].text, />Hello</);
  assert.ok(compiled.files['company/index.html']);
  assert.equal(compiled.files['draft.html'], undefined);
  const portable = attachStaticHtmlSource(source, compiled);
  const blob = await projectToZipBlob(portable, { updatedAt: '2026-09-13T12:01:00.000Z' });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.match(await zip.file('index.html').async('string'), />Hello</);
  assert.ok(zip.file(STATIC_SOURCE_MANIFEST));
  const manifest = JSON.parse(await zip.file(STATIC_SOURCE_MANIFEST).async('string'));
  assert.equal(manifest.files.find(entry => entry.path === 'images/photo.png').override, undefined, 'unchanged binary is stored once');
  const restored = await importZip(new File([blob], 'site-editavel.zip'));
  assert.equal(restored.name, source.name);
  assert.equal(restored.mainHtmlPath, source.mainHtmlPath);
  assert.equal(restored.rootPath, source.rootPath);
  assertFilesEqual(restored.files, source.files);
  assert.deepEqual(readEditorMetadata(restored), readEditorMetadata(source));
  const nextBlob = await projectToZipBlob(attachStaticHtmlSource(source, prepareStaticHtmlProject(restored)));
  const twiceRestored = await importZip(new File([nextBlob], 'second.zip'));
  assertFilesEqual(twiceRestored.files, source.files);
});

test('site ZIP contains only deployable locales and assets without drafts or editable metadata', async () => {
  const source = prepareProjectForDraftTransport(fixture());
  const compiled = prepareStaticHtmlProject(source);
  // Even if given an editable archive graph, the public ZIP filters snapshots.
  const blob = await createHtmlSiteZip(attachStaticHtmlSource(source, compiled));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.values(zip.files).filter(file => !file.dir).map(file => file.name);
  assert.ok(names.includes('index.html'));
  assert.ok(names.includes('pt/index.html'));
  assert.ok(names.includes('company/index.html'));
  assert.ok(names.includes('images/photo.png'));
  assert.equal(names.some(name => /draft|static-source|\.incode\/project\.json/.test(name)), false);
  assert.match(await zip.file('index.html').async('string'), />Hello</);
});

test('WordPress ZIP preserves editable pages, drafts, fonts and settings through the shared importer', async () => {
  const source = fixture();
  source.files['assets/fonts/custom.woff2'] = { path: 'assets/fonts/custom.woff2', mimeType: 'font/woff2', data: new Uint8Array([119, 79, 70, 50, 0, 255]) };
  const original = structuredClone(source);
  const blob = await createHtmlWordPressZip(source);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.match(await zip.file('index.html').async('string'), />Olá</, 'WordPress receives the original language, before static compilation');
  assert.ok(zip.file('draft.html'), 'drafts remain editable after moving to WordPress');
  assert.equal(zip.file(STATIC_SOURCE_MANIFEST), null);
  assert.equal(zip.file('company/index.html'), null, 'WordPress generates localized routes from the original metadata');
  for (const file of Object.values(original.files).filter(file => file.path !== '.incode/project.json')) {
    assert.ok(zip.file(file.path), file.path);
    if (file.text !== undefined) assert.equal(await zip.file(file.path).async('string'), file.text, file.path);
    else assert.deepEqual(await zip.file(file.path).async('uint8array'), file.data, file.path);
  }
  const restored = await importZip(new File([blob], 'site-wordpress.zip'));
  assert.equal(restored.name, source.name);
  const metadata = readEditorMetadata(restored);
  for (const field of ['siteSettings', 'pageStatuses', 'localization']) assert.deepEqual(metadata[field], readEditorMetadata(source)[field], field);
  assert.deepEqual(source, original, 'WordPress export leaves the HTML project intact');
});

test('invalid or incomplete source manifests cannot silently lose canonical files', () => {
  const metadata = files => ({ [STATIC_SOURCE_MANIFEST]: { path: STATIC_SOURCE_MANIFEST, mimeType: 'application/json', text: JSON.stringify({ kind: 'kodety-static-source-v1', files }) } });
  assert.throws(() => restoreStaticHtmlSource(metadata([{ path: '../outside.html', mimeType: 'text/html', kind: 'text' }])), /caminhos inválidos/);
  assert.throws(() => restoreStaticHtmlSource(metadata([{ path: 'index.html', mimeType: 'text/html', kind: 'text', override: '0.txt' }])), /não contém a origem/);
  assert.throws(() => restoreStaticHtmlSource(metadata([{ path: 'index.html', mimeType: 'text/html', kind: 'text', override: '../../index.html' }])), /caminhos inválidos/);
});

test('FTP ZIP contains the same compiled public site, locales and binary assets as the existing site export', async () => {
  const compiled = attachStaticHtmlSource(fixture(), prepareStaticHtmlProject(fixture()));
  const input = Object.values(compiled.files).map(file => ({ path: file.path, content: file.text ?? file.data }));
  input.find(file => file.path === 'images/photo.png').content = new Blob([compiled.files['images/photo.png'].data]);
  input.push({ path: '.env', content: 'PRIVATE' }, { path: 'credentials.json', content: 'PRIVATE' });
  const ftp = await JSZip.loadAsync(await (await createHtmlFtpUpload(input)).arrayBuffer());
  const existing = await JSZip.loadAsync(await (await createHtmlSiteZip(compiled)).arrayBuffer());
  const names = zip => Object.values(zip.files).filter(file => !file.dir).map(file => file.name).sort();
  assert.deepEqual(names(ftp), names(existing));
  for (const name of names(existing)) assert.deepEqual(await ftp.file(name).async('uint8array'), await existing.file(name).async('uint8array'), name);
  assert.ok(ftp.file('index.html'));
  assert.ok(ftp.file('pt/index.html'));
  assert.equal(ftp.file('.env'), null);
  assert.equal(ftp.file('.incode/project.json'), null);
});

test('FTP ZIP rejects ambiguous paths and missing root pages without imposing the GitHub file-count limit', async () => {
  await assert.rejects(createHtmlFtpUpload([{ path: 'folder/index.html', content: 'Nested' }]), { code: 'direct-index' });
  await assert.rejects(createHtmlFtpUpload([{ path: '../index.html', content: 'Outside' }]), { code: 'invalid-path' });
  await assert.rejects(createHtmlFtpUpload([{ path: 'index.html', content: 'First' }, { path: 'index.html', content: 'Second' }]), { code: 'duplicate-path' });
  const files = [{ path: 'index.html', content: 'Home' }, ...Array.from({ length: 1001 }, (_, index) => ({ path: `pages/${index}.html`, content: 'Page' }))];
  const zip = await JSZip.loadAsync(await (await createHtmlFtpUpload(files)).arrayBuffer());
  assert.equal(Object.values(zip.files).filter(file => !file.dir).length, files.length);
});
