import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
  resolve: { alias: { '@': root } },
  plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true, hmr: false } });
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
let resetRegistry;
let fontStore;
function fakeDocument() {
  const children = [];
  return {
    head: { appendChild(element) { children.push(element); } },
    createElement(tag) {
      return { tag, dataset: {}, remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); } };
    },
    getElementById: id => children.find(element => element.id === id) || null,
    querySelectorAll: () => children.filter(element => element.tag === 'link' && 'kodetyFontStylesheet' in element.dataset),
    links: () => children.filter(element => element.tag === 'link').map(element => element.href),
  };
}
const font = (family, overrides = {}) => ({ id: `account-${family}`, name: family.toLowerCase(), family,
  type: 'google', variants: ['regular'], weights: ['400'], category: 'sans-serif',
  is_published: false, created_at: '', updated_at: '', deleted_at: null, ...overrides });
function project(families, googleFonts, extraFiles = {}) {
  return { name: 'Imported Figma', mainHtmlPath: 'index.html', rootPath: '', openedAt: 0, files: {
    'index.html': { path: 'index.html', mimeType: 'text/html', text: `<html><head></head><body>${families.map(family => `<p style='font-family:"${family}",sans-serif'>Text</p>`).join('')}</body></html>` },
    '.incode/project.json': { path: '.incode/project.json', mimeType: 'application/json',
      text: JSON.stringify({ version: 1, name: 'Imported Figma', googleFonts }) },
    ...extraFiles,
  } };
}
try {
  const seam = await server.ssrLoadModule('/lib/editor-platform-services.ts');
  resetRegistry = seam.__resetFontLibraryTransportForTests;
  const persisted = [];
  const installed = [font('Roboto'), font('Sora')];
  const denyPersistence = (...args) => { persisted.push(args); throw new Error('Project fonts must not mutate the account library'); };
  seam.installFontLibraryTransport({
    kind: 'test', capabilities: {
      synchronousInstalledFontsSnapshot: true, readInstalledFonts: true, persistInstalledFonts: true,
      googleFontsCatalog: true, adobeFontsCatalog: true, resyncAdobeFontsCatalog: true,
      installGoogleFont: true, uploadCustomFonts: true, removeFontAssociation: true, deleteRemoteMedia: false,
    },
    readInstalledFontsSnapshot: () => installed,
    loadInstalledFonts: async () => installed,
    replaceInstalledFonts: denyPersistence, upsertInstalledFont: denyPersistence,
    loadGoogleFontsCatalog: async () => [], loadAdobeFontsCatalog: async () => ({}), resyncAdobeFontsCatalog: async () => ({}),
    uploadCustomFonts: denyPersistence, addGoogleFont: denyPersistence, removeFontAssociation: denyPersistence,
  });
  ({ useFontsStore: fontStore } = await server.ssrLoadModule('/stores/useFontsStore.ts'));
  globalThis.document = fakeDocument();
  globalThis.window = {};
  const adobe = font('Adobe Family', { id: 'adobe-family', type: 'adobe',
    provider_project_id: 'abc1234', stylesheet_url: 'https://use.typekit.net/abc1234.css' });
  fontStore.setState({ adobeFontsCatalog: [adobe] });
  const sora = { family: 'Sora', variants: ['regular', '700'], weights: ['400', '700'], category: 'sans-serif',
    axes: [{ tag: 'wght', start: 100, end: 800 }] };
  const dmSans = { family: 'DM Sans', variants: ['regular', 'italic', '500', '500italic'], weights: ['400', '500'], category: 'sans-serif' };
  const firstProject = project(['Sora', 'DM Sans'], [sora, dmSans]);
  fontStore.getState().syncProjectFonts(firstProject);
  assert.deepEqual(fontStore.getState().projectGoogleFonts.map(entry => entry.family), ['Sora', 'DM Sans']);
  assert.equal(fontStore.getState().fonts, installed, 'Project sync must not replace the account catalog');
  assert.equal(fontStore.getState().getRenderableFonts().filter(entry => entry.family === 'Sora').length, 1);
  assert.deepEqual(fontStore.getState().getFontByFamily('"Sora", Arial, sans-serif').weights, ['400', '700']);
  assert.match(fontStore.getState().fontsCss, /DM Sans/);
  assert.ok(document.links().some(href => href.includes('family=DM+Sans')));
  assert.ok(document.links().some(href => href.includes('use.typekit.net/abc1234.css')));
  const signature = fontStore.getState().projectFontsSignature;
  const links = document.links();
  fontStore.getState().syncProjectFonts(firstProject);
  assert.equal(fontStore.getState().projectFontsSignature, signature);
  assert.deepEqual(document.links(), links, 'Repeated sync must not duplicate hosted links');

  const updatedMetadata = project(['Sora', 'DM Sans'], [{ ...sora, variants: ['regular', '600'], weights: ['400', '600'] }, dmSans]);
  fontStore.getState().syncProjectFonts(updatedMetadata);
  assert.notEqual(fontStore.getState().projectFontsSignature, signature, 'Metadata-only weight changes invalidate the store signature');
  assert.deepEqual(fontStore.getState().getFontByFamily('Sora').weights, ['400', '600']);

  const localProject = project(['Sora'], [sora], {
    'fonts/Sora.woff2': { path: 'fonts/Sora.woff2', mimeType: 'font/woff2', data: new Uint8Array([119, 79, 70, 50]) },
    'styles.css': { path: 'styles.css', mimeType: 'text/css', text: '@font-face{font-family:"Sora";src:url("fonts/Sora.woff2");font-weight:400;font-style:normal}' },
  });
  fontStore.getState().syncProjectFonts(localProject);
  assert.equal(fontStore.getState().getFontByFamily('Sora').projectSource, true, 'Local project faces win over hosted families');
  assert.ok(!fontStore.getState().getRenderableFonts().some(entry => entry.type === 'google' && entry.family === 'Sora'));
  assert.ok(!document.links().some(href => href.includes('family=Sora')));
  assert.ok(!document.links().some(href => href.includes('family=DM+Sans')), 'Switching projects removes previous hosted dependencies');
  assert.ok(document.links().some(href => href.includes('family=Roboto')), 'Account fonts survive project switching');

  const frameDocument = fakeDocument();
  fontStore.getState().syncProjectFonts(firstProject);
  fontStore.getState().injectFontsCss(frameDocument);
  assert.ok(frameDocument.links().some(href => href.includes('family=DM+Sans')), 'Project resources load into the canvas too');
  fontStore.getState().syncProjectFonts(null);
  fontStore.getState().injectFontsCss(frameDocument);
  assert.deepEqual(fontStore.getState().projectGoogleFonts, []);
  assert.deepEqual(fontStore.getState().projectFonts, []);
  assert.ok(!frameDocument.links().some(href => href.includes('family=DM+Sans')));
  assert.ok(fontStore.getState().getRenderableFonts().includes(adobe));
  assert.equal(fontStore.getState().fonts, installed);
  fontStore.getState().reset();
  assert.deepEqual(document.links(), [], 'Reset clears hosted resources as well as project state');
  assert.deepEqual(persisted, []);

  for (const relative of [
    'app/(builder)/kodety/components/FontPicker.tsx',
    'app/(builder)/kodety/html-editor/ycode-style/FontPicker.tsx',
  ]) {
    const source = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
    assert.match(source, /projectGoogleFonts/);
    assert.match(source, /\[\.\.\.projectFonts, \.\.\.projectGoogleFonts/);
    assert.match(source, /renderFontSection\('(?:Project|Google do projeto)'[^\n]*\)/);
    assert.doesNotMatch(source, /renderFontSection\('(?:Project|Google do projeto)'[^\n]*deletable:\s*true/);
  }
  const io = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
  const { KODETY_FIGMA_SIGNATURE, KODETY_FIGMA_VERSION } = await server.ssrLoadModule('/lib/figma/types.ts');
  const imported = await importKodetyFigmaPayload(io.createBlankProject('Save Sora'), {
    signature: KODETY_FIGMA_SIGNATURE, version: KODETY_FIGMA_VERSION, source: 'figma-plugin',
    exportId: 'save-sora', exportedAt: new Date().toISOString(), documentName: 'Sora', pageName: 'Page',
    html: '<p class="sora">Keep the exact face</p>', css: '.sora{font-family:"Sora",sans-serif;font-weight:600}',
    fonts: [{ family: 'Sora', style: 'SemiBold', weight: 600, missing: false }],
    assets: [], variables: [], warnings: [], stats: { nodes: 1, assets: 0, bytes: 100 },
  }, { targetPath: '0', googleFontsCatalog: [{ family: 'Sora', category: 'sans-serif',
    variants: ['100', '200', '300', 'regular', '500', '600', '700', '800'],
    axes: [{ tag: 'wght', start: 100, end: 800 }] }] });
  assert.deepEqual(imported.missingFonts, []);
  const importedSora = io.readEditorMetadata(imported.project).googleFonts.find(font => font.family === 'Sora');
  assert.ok(importedSora.variants.includes('600'));
  const saved = io.rememberProjectGoogleFonts(imported.project, [font('Sora')]);
  const savedSora = io.readEditorMetadata(saved).googleFonts.find(font => font.family === 'Sora');
  assert.deepEqual(savedSora, importedSora, 'Saving must not replace the project catalog with an account copy that only has weight 400');
  assert.deepEqual(io.projectGoogleFonts(saved, [font('Sora')])[0].weights, importedSora.weights);
  const newSelection = project(['Roboto'], []);
  assert.equal(io.readEditorMetadata(io.rememberProjectGoogleFonts(newSelection, [font('Roboto')])).googleFonts[0].family, 'Roboto',
    'An installed family not yet registered in the project must still be remembered');
  console.log('Project Google font store: metadata sync, weights, picker availability, hosted links, local precedence, project switch and zero account writes passed.');
} finally {
  fontStore?.getState().reset();
  resetRegistry?.();
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  await server.close();
}
