import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from '../../../scripts/vite-code-component-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { applyStaticLicenseOutput, assertStaticLicensePublication, staticLicenseSource, stripUnlicensedStaticHtml } = await server.ssrLoadModule('/lib/html-editor/static-license.ts');
const { prepareHtmlLicenseExport } = await server.ssrLoadModule('/WebApp/kodety-studio/src/html-license-export.ts');
const { updateEditorMetadata, readEditorMetadata, prepareProjectForDraftTransport, projectToZipBlob, importZip } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
const { attachStaticHtmlSource } = await server.ssrLoadModule('/lib/html-editor/static-source.ts');
const { defaultLocalization, createLocale } = await server.ssrLoadModule('/lib/html-editor/localization.ts');
const { createHtmlSiteZip } = await server.ssrLoadModule('/WebApp/kodety-studio/src/html-archives.ts');
after(() => server.close());
const features = Object.fromEntries(['advancedSeo', 'socialImageBuilder', 'redirects', 'cookieConsent', 'analyticsUtms', 'experiments', 'analyticsFunnels'].map(key => [key, true]));
const pro = { licensed: true, features };
// Legacy serialized product data must never restrict the open-source export.
const expired = { licensed: false, features, licenseStatus: 'expired' };
const free = { licensed: false, features: {} };
const html = '<!doctype html><html><head><title>Fonte</title><meta name="description" content="Basic SEO"><link rel="canonical" href="https://example.com"><meta property="og:title" content="Source"><meta property="og:image" content="/photo.png"><meta name="twitter:card" content="summary"><meta name="robots" content="INDEX,follow,max-image-preview:large,index"><script type="application/ld+json">{"@type":"WebPage"}</script></head><body><h1 data-kodety-l10n-id="heading">Olá</h1><script>window.authored=true</script></body></html>';
function project(metadata = {}, pages = {}) {
  return updateEditorMetadata({ name: 'Site', mainHtmlPath: 'index.html', rootPath: '', openedAt: 1, files: {
    'index.html': { path: 'index.html', text: html, mimeType: 'text/html' },
    'photo.png': { path: 'photo.png', data: Uint8Array.from([0, 1, 255]), mimeType: 'image/png' },
    ...Object.fromEntries(Object.entries(pages).map(([path, text]) => [path, { path, text, mimeType: 'text/html' }])),
  } }, current => ({ ...current, ...metadata }));
}
function localized() {
  return project({
    siteSettings: { siteTitle: 'Fonte', baseUrl: 'https://example.com', sitemapEnabled: false, robotsTxtRules: 'User-agent: secret-bot\nDisallow: /secret', blockAiTrainingBots: true, googleSiteVerification: 'secret-verification', socialImage: '/photo.png' },
    pageSettings: { 'index.html': { includeInSitemap: false, title: 'Início' } },
    localization: { ...defaultLocalization('pt-BR'), locales: [createLocale('pt-BR'), { ...createLocale('en-US'), slug: 'en' }], translations: { 'en-US': { pages: { 'index.html': { entries: { 'id:heading:text': 'Hello' }, title: 'Home' } } } } },
    redirects: { version: 1, entries: [{ id: 'old', source: '/old', destination: '/', match: 'exact', status: 301, preserveQuery: true, enabled: true }] },
  });
}

test('HTML output preserves all authored metadata and runtime attributes without a product grant', () => {
  const input = `${html}<meta name="google-site-verification" content="x"><form method="post" data-kodety-utm-enabled="true"><input name="email"></form>`;
  assert.equal(stripUnlicensedStaticHtml(input), input);
  const source = project();
  for (const product of [undefined, free, expired, pro]) {
    assert.strictEqual(applyStaticLicenseOutput(source, product), source);
    assert.strictEqual(staticLicenseSource(source, product), source);
  }
});

test('public static ZIP keeps localization, advanced SEO, redirects, robots rules and assets', async () => {
  const source = localized();
  const before = structuredClone(source);
  const output = await prepareHtmlLicenseExport(source, undefined, { publication: true });
  assert.deepEqual(source, before);
  assert.match(output.files['en/index.html'].text, />Hello</);
  assert.match(output.files['en/index.html'].text, /https:\/\/example.com\/en\//);
  assert.match(output.files['index.html'].text, /window.authored=true/);
  assert.match(output.files['index.html'].text, /application\/ld\+json|secret-verification/);
  assert.match(output.files['index.html'].text, /data-kodety-static-redirects/);
  assert.match(output.files['_redirects'].text, /\/old \/ 301/);
  assert.ok(output.files['vercel.json']);
  assert.equal(output.files['sitemap.xml'], undefined);
  assert.match(output.files['robots.txt'].text, /secret-bot|GPTBot/);
  assert.deepEqual(output.files['photo.png'].data, source.files['photo.png'].data);
  const siteZip = await JSZip.loadAsync(await (await createHtmlSiteZip(output)).arrayBuffer());
  assert.equal(siteZip.file('.incode/project.json'), null);
  assert.ok(siteZip.file('en/index.html'));
});

test('social-image templates remain configured without an activation', () => {
  const source = project({ siteSettings: { socialImageTemplate: { id: 'template', width: 1200, height: 630, elements: [] } }, pageSettings: { 'index.html': { socialImageTemplateId: 'template' } } });
  const projected = staticLicenseSource(source, free);
  assert.equal(readEditorMetadata(projected).siteSettings.socialImageTemplate.id, 'template');
  assert.equal(readEditorMetadata(projected).pageSettings['index.html'].socialImageTemplateId, 'template');
});

test('Cookie Consent can publish and an editable ZIP roundtrip retains its source', async () => {
  const source = prepareProjectForDraftTransport(project({ cookieConsent: { enabled: true }, siteSettings: { siteTitle: 'Local source' } }));
  const published = await prepareHtmlLicenseExport(source, undefined, { publication: true });
  assert.match(published.files['index.html'].text, /data-kodety-cookie-consent="runtime"/);
  const blob = await projectToZipBlob(attachStaticHtmlSource(source, published));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.match(await zip.file('index.html').async('string'), /data-kodety-cookie-consent="runtime"/);
  const imported = await importZip(new File([blob], 'editable.zip'));
  assert.deepEqual({ ...imported.files }, source.files);
  assert.equal(readEditorMetadata(imported).cookieConsent.enabled, true);
});

test('imported Cookie Consent, UTM and active Analytics need no commercial license', () => {
  const source = project({ analytics: { experiments: [{ status: 'running' }], funnels: [{ enabled: true }] } }, { 'other.html': '<form data-kodety-utm-enabled="true"></form><script data-kodety-cookie-consent="runtime">run()</script>' });
  assert.doesNotThrow(() => assertStaticLicensePublication(source, undefined));
  assert.strictEqual(staticLicenseSource(source, free), source);
});
