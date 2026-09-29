import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
after(() => server.close());
const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
const io = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
const { injectProjectGoogleFonts } = await server.ssrLoadModule('/lib/html-editor/google-fonts.ts');
const { buildGoogleFontUrl } = await server.ssrLoadModule('/lib/font-utils.ts');
const { loadFigmaGoogleFontsCatalog } = await server.ssrLoadModule('/lib/figma/google-fonts.ts');
const fontServices = await server.ssrLoadModule('/lib/editor-platform-services.ts');
const catalog = [
  { family: 'Sora', variants: ['100', '200', '300', 'regular', '500', '600', '700', '800'], category: 'sans-serif', axes: [{ tag: 'wght', start: 100, end: 800 }] },
  { family: 'DM Sans', variants: ['regular', 'italic', '500', '500italic', '600'], category: 'sans-serif', axes: [{ tag: 'wght', start: 100, end: 1000 }] },
  { family: 'Inter', variants: ['regular', '500', '600', '700'], category: 'sans-serif', axes: [{ tag: 'wght', start: 100, end: 900 }] },
  { family: 'Spectral', variants: ['regular', 'italic', '600', '600italic'], category: 'serif' },
  { family: 'New Catalog Family', variants: ['regular', '700italic'], category: 'display' },
];
const face = (family, weight = 400, style = 'Regular') => ({ family, weight, style, missing: false });
function payload(fonts, extra = {}) {
  return { signature: '__kodety_figma__', version: 4, source: 'figma-plugin', exportId: 'google-import',
    exportedAt: '2026-09-04T00:00:00Z', documentName: 'Fonts', pageName: 'Page',
    html: '<section class="fonts">' + fonts.map((_, i) => `<p class="font-${i}">Editable text ${i}</p>`).join('') + '</section>',
    css: fonts.map((font, i) => `.font-${i}{font-family:"${font.family}",sans-serif;font-weight:${font.weight};font-style:${/italic/i.test(font.style) ? 'italic' : 'normal'};}`).join('\n'),
    fonts, assets: [], variables: [], warnings: [], stats: { nodes: fonts.length + 1, assets: 0, bytes: 0 }, ...extra };
}
const importFonts = (value, options = {}, project = io.createBlankProject('Fonts')) =>
  importKodetyFigmaPayload(project, value, { targetPath: '0', googleFontsCatalog: catalog, ...options });

test('all matching catalog families register automatically, including variable weights and italic', async () => {
  const value = payload([face('Sora', 600, 'SemiBold'), face('DM Sans', 450), face('Spectral', 600, 'SemiBold Italic'), face('New Catalog Family', 700, 'Bold Italic')]);
  const result = await importFonts(value);
  assert.deepEqual(result.missingFonts, []);
  assert.equal(result.googleFonts.length, 4);
  assert.equal(io.readEditorMetadata(result.project).googleFonts.length, 4);
  assert.match(result.project.files['styles.css'].text, /font-family:"Sora",sans-serif;font-weight:600/);
  const preview = injectProjectGoogleFonts(result.project.files['index.html'].text, io.projectGoogleFonts(result.project));
  assert.match(preview, /fonts\.googleapis\.com/);
  for (const font of io.projectGoogleFonts(result.project)) assert.ok(preview.includes(buildGoogleFontUrl(font).replace(/&/g, '&amp;')) || preview.includes(buildGoogleFontUrl(font)));
  const published = io.prepareProjectForTransport(result.project);
  assert.match(published.files['index.html'].text, /data-kodety-google-font/);
  assert.match(published.files['index.html'].text, /Sora/);
});

test('case and whitespace match but unknown families and unsupported faces are not silently replaced', async () => {
  const result = await importFonts(payload([face('sora', 400), face('Sora', 900), face('Sora', 400, 'Italic'), face('Private Brand Sans')]));
  assert.deepEqual(result.googleFonts, ['Sora']);
  assert.ok(result.missingFonts.some(font => font.includes('Private Brand Sans')));
  assert.ok(result.missingFonts.some(font => font.includes('Sora')));
  assert.match(result.project.files['styles.css'].text, /Private Brand Sans/);
});

test('repeated imports merge project dependencies and preserve existing unrelated fonts', async () => {
  const value = payload([face('Sora'), face('Sora', 600)]);
  const initial = io.updateEditorMetadata(io.createBlankProject('Fonts'), metadata => ({ ...metadata,
    googleFonts: [{ family: 'Existing Font', variants: ['regular'], weights: ['400'], category: 'serif' }] }));
  const first = await importFonts(value, {}, initial);
  const second = await importFonts(value, {}, first.project);
  const families = io.readEditorMetadata(second.project).googleFonts.map(font => font.family);
  assert.deepEqual(families, ['Existing Font', 'Sora']);
  assert.deepEqual(second.googleFonts, ['Sora']);
});

test('attached or existing local faces remain authoritative over the same Google family', async () => {
  const source = await readFile(new URL('../lib/html-editor/fonts/geist/Geist-Regular.ttf', import.meta.url));
  const value = payload([{ ...face('Sora'), assetId: 'font' }], {
    assets: [{ id: 'font', name: 'licensed.ttf', mimeType: 'font/ttf', dataBase64: source.toString('base64') }],
  });
  const first = await importFonts(value);
  assert.deepEqual(first.googleFonts, []);
  assert.deepEqual(first.missingFonts, []);
  const second = await importFonts(payload([face('Sora')], { exportId: 'second' }), {}, first.project);
  assert.deepEqual(second.googleFonts, []);
  assert.deepEqual(second.missingFonts, []);
});

test('catalog outages preserve content and authored family with an explicit warning', async () => {
  const result = await importFonts(payload([face('Sora')]), { googleFontsCatalog: [], googleFontsUnavailable: true });
  assert.deepEqual(result.googleFonts, []);
  assert.deepEqual(result.missingFonts, ['Sora']);
  assert.match(result.project.files['styles.css'].text, /font-family:"Sora"/);
  assert.ok(result.warnings.some(warning => warning.includes('consultar o Google Fonts')));
});

test('the complete platform catalog is cached, shared between concurrent imports and retried after failures', async () => {
  let requests = 0;
  let fail = true;
  const denied = () => { throw new Error('No account mutation is authorized by font detection'); };
  fontServices.__resetFontLibraryTransportForTests();
  fontServices.installFontLibraryTransport({
    kind: 'test', capabilities: {
      synchronousInstalledFontsSnapshot: true, readInstalledFonts: true, persistInstalledFonts: false,
      googleFontsCatalog: true, adobeFontsCatalog: false, resyncAdobeFontsCatalog: false,
      installGoogleFont: false, uploadCustomFonts: false, removeFontAssociation: false, deleteRemoteMedia: false,
    },
    readInstalledFontsSnapshot: () => [], loadInstalledFonts: async () => [],
    replaceInstalledFonts: denied, upsertInstalledFont: denied, addGoogleFont: denied,
    loadAdobeFontsCatalog: denied, resyncAdobeFontsCatalog: denied, uploadCustomFonts: denied, removeFontAssociation: denied,
    async loadGoogleFontsCatalog() { requests += 1; if (fail) throw new Error('offline'); return catalog; },
  });
  try {
    await assert.rejects(loadFigmaGoogleFontsCatalog(), /offline/);
    fail = false;
    const [one, two] = await Promise.all([loadFigmaGoogleFontsCatalog(), loadFigmaGoogleFontsCatalog()]);
    assert.equal(one, catalog);
    assert.equal(two, catalog);
    assert.equal(requests, 2, 'one failed request followed by one shared retry');
    assert.equal(await loadFigmaGoogleFontsCatalog(), catalog);
    assert.equal(requests, 2, 'successful catalogs are reused without network or account writes');
  } finally {
    fontServices.__resetFontLibraryTransportForTests();
  }
});

for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] !== '--payload') continue;
  const path = process.argv[++index];
  test('real exported Google fonts register without attaching files: ' + path.split('/').at(-1), async () => {
    const result = await importFonts(JSON.parse(await readFile(path, 'utf8')));
    assert.deepEqual(result.missingFonts, []);
    assert.ok(result.googleFonts.includes('Sora'));
    assert.ok(result.googleFonts.includes('DM Sans'));
  });
}
