import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const storePath = path.join(root, 'stores/useFontsStore.ts');
const nextTransportPath = path.join(root, 'lib/next-font-library-transport.ts');
const nextCompositionPath = path.join(root, 'lib/install-next-editor-platform-services.ts');
const [storeSource, nextTransportSource, nextCompositionSource] = await Promise.all([
  readFile(storePath, 'utf8'),
  readFile(nextTransportPath, 'utf8'),
  readFile(nextCompositionPath, 'utf8'),
]);

assert.match(storeSource, /getFontLibraryTransport\(\)/);
assert.match(storeSource, /readInstalledFontsSnapshot\(\)/);
for (const method of [
  'loadInstalledFonts',
  'replaceInstalledFonts',
  'upsertInstalledFont',
  'loadGoogleFontsCatalog',
  'uploadCustomFonts',
  'addGoogleFont',
  'removeFontAssociation',
]) {
  assert.match(storeSource, new RegExp(`fontLibraryTransport\\.${method}\\(`));
}
assert.doesNotMatch(
  storeSource,
  /\/kodety\/api\/fonts|\bfetch\s*\(|kodetyWordPress|localStorage|next-font-library-transport/,
  'the shared store must not select, configure, or import a platform transport',
);
assert.match(nextTransportSource, /\/kodety\/api\/fonts/);
assert.match(nextCompositionSource, /createNextFontLibraryTransport/);
assert.doesNotMatch(
  nextCompositionSource,
  /useFontsStore|stores\/useFontsStore/,
  'composition must install before a caller dynamically imports the store',
);

function font(overrides = {}) {
  return {
    id: 'google-inter',
    name: 'inter',
    family: 'Inter',
    type: 'google',
    variants: ['regular', '700'],
    weights: ['400', '700'],
    category: 'sans-serif',
    is_published: false,
    created_at: '2026-08-30T12:00:00.000Z',
    updated_at: '2026-08-30T12:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function mergeFonts(current, incoming) {
  const ids = new Set(incoming.map(entry => entry.id));
  return [...current.filter(entry => !ids.has(entry.id)), ...incoming];
}

function createTestServer() {
  return createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    appType: 'custom',
    plugins: [codeComponentReactRuntimePlugin()],
    resolve: { alias: { '@': root } },
    server: { middlewareMode: true },
  });
}

const server = await createTestServer();

let resetRegistry = () => undefined;
try {
  const seam = await server.ssrLoadModule('/lib/editor-platform-services.ts');
  resetRegistry = seam.__resetFontLibraryTransportForTests;
  const calls = [];
  const initialFont = font();
  const loadedFont = font({ id: 'google-loaded', name: 'loaded', family: 'Loaded' });
  let uploadBarrier = null;
  const catalogFont = {
    family: 'Roboto Flex',
    variants: ['regular', '700'],
    category: 'sans-serif',
    axes: [{ tag: 'wght', start: 100, end: 900 }],
  };
  const fakeTransport = {
    kind: 'test',
    capabilities: {
      synchronousInstalledFontsSnapshot: true,
      readInstalledFonts: true,
      persistInstalledFonts: true,
      googleFontsCatalog: true,
      adobeFontsCatalog: false,
      resyncAdobeFontsCatalog: false,
      installGoogleFont: true,
      uploadCustomFonts: true,
      removeFontAssociation: true,
      deleteRemoteMedia: false,
    },
    readInstalledFontsSnapshot() {
      calls.push(['snapshot']);
      return [initialFont];
    },
    async loadInstalledFonts() {
      calls.push(['load']);
      return [loadedFont];
    },
    replaceInstalledFonts(fonts) {
      calls.push(['replace', fonts.map(entry => entry.id)]);
      return [...fonts];
    },
    upsertInstalledFont(entry, installedFonts) {
      calls.push(['upsert', entry.id, installedFonts.map(fontEntry => fontEntry.id)]);
      return mergeFonts(installedFonts, [entry]);
    },
    async loadGoogleFontsCatalog() {
      calls.push(['catalog']);
      return [catalogFont];
    },
    async loadAdobeFontsCatalog() { throw new Error('Adobe catalog is unavailable in this transport fixture'); },
    async resyncAdobeFontsCatalog() { throw new Error('Adobe sync is unavailable in this transport fixture'); },
    async uploadCustomFonts(files, installedFonts) {
      calls.push(['upload', files.map(file => file.name)]);
      if (uploadBarrier) await uploadBarrier;
      const uploadedFont = font({
        id: 'custom-brand',
        name: 'brand',
        family: 'Brand',
        type: 'custom',
        kind: 'woff2',
        url: 'https://cdn.example.test/brand.woff2',
      });
      return {
        installedFonts: mergeFonts(installedFonts, [uploadedFont]),
        uploadedFonts: [uploadedFont],
      };
    },
    async addGoogleFont(googleFont, installedFonts) {
      calls.push(['add-google', googleFont.family]);
      const addedFont = font({
        id: 'google-roboto-flex',
        name: 'roboto-flex',
        family: googleFont.family,
        axes: googleFont.axes,
      });
      return {
        installedFonts: mergeFonts(installedFonts, [addedFont]),
        font: addedFont,
        added: true,
      };
    },
    async removeFontAssociation(fontId, installedFonts) {
      calls.push(['remove', fontId]);
      return {
        installedFonts: installedFonts.filter(entry => entry.id !== fontId),
        removed: installedFonts.some(entry => entry.id === fontId),
        remoteMediaDeleted: false,
      };
    },
  };

  seam.installFontLibraryTransport(fakeTransport);
  const { useFontsStore } = await server.ssrLoadModule('/stores/useFontsStore.ts');
  assert.deepEqual(useFontsStore.getState().fonts.map(entry => entry.id), ['google-inter']);
  assert.equal(useFontsStore.getState().isLoaded, true);
  assert.match(useFontsStore.getState().fontsCss, /Inter/);
  assert.deepEqual(calls, [['snapshot']]);

  useFontsStore.setState({ isLoaded: false });
  await useFontsStore.getState().loadFonts();
  assert.deepEqual(useFontsStore.getState().fonts.map(entry => entry.id), ['google-loaded']);

  useFontsStore.getState().setFonts([initialFont]);
  const manuallyAdded = font({ id: 'custom-manual', name: 'manual', family: 'Manual', type: 'custom' });
  useFontsStore.getState().addFont(manuallyAdded);
  assert.deepEqual(
    useFontsStore.getState().fonts.map(entry => entry.id),
    ['google-inter', 'custom-manual'],
  );
  await useFontsStore.getState().removeFont('custom-manual');
  assert.deepEqual(useFontsStore.getState().fonts.map(entry => entry.id), ['google-inter']);

  let releaseUpload;
  uploadBarrier = new Promise(resolve => { releaseUpload = resolve; });
  const uploadPromise = useFontsStore.getState().uploadCustomFonts([
    new File([new Uint8Array([1, 2, 3])], 'brand.woff2', { type: 'font/woff2' }),
  ]);
  const concurrentFont = font({
    id: 'custom-concurrent',
    name: 'concurrent',
    family: 'Concurrent',
    type: 'custom',
  });
  useFontsStore.getState().addFont(concurrentFont);
  releaseUpload();
  const uploaded = await uploadPromise;
  uploadBarrier = null;
  assert.deepEqual(uploaded.map(entry => entry.id), ['custom-brand']);
  assert.equal(useFontsStore.getState().fonts.some(entry => entry.id === 'custom-brand'), true);
  assert.equal(
    useFontsStore.getState().fonts.some(entry => entry.id === 'custom-concurrent'),
    true,
    'an upload result must merge into the latest store snapshot',
  );

  const addedGoogle = await useFontsStore.getState().addGoogleFont(catalogFont);
  assert.equal(addedGoogle?.id, 'google-roboto-flex');
  assert.equal(useFontsStore.getState().fonts.some(entry => entry.id === 'google-roboto-flex'), true);

  await useFontsStore.getState().loadGoogleFontsCatalog();
  useFontsStore.getState().searchGoogleFonts('flex');
  assert.deepEqual(
    useFontsStore.getState().googleSearchResults.map(entry => entry.family),
    ['Roboto Flex'],
  );
  await useFontsStore.getState().deleteFont('google-roboto-flex');
  assert.equal(useFontsStore.getState().fonts.some(entry => entry.id === 'google-roboto-flex'), false);
  assert.deepEqual(
    calls.map(call => call[0]),
    ['snapshot', 'load', 'replace', 'upsert', 'remove', 'upload', 'upsert', 'add-google', 'catalog', 'remove'],
    'each persistence action must cross the installed transport exactly once',
  );

  const { createNextFontLibraryTransport } = await server.ssrLoadModule(
    '/lib/next-font-library-transport.ts',
  );
  const requests = [];
  const remoteFont = font({ id: 'custom/remote', name: 'remote', family: 'Remote', type: 'custom' });
  const uploadedFont = font({ id: 'custom-uploaded', name: 'uploaded', family: 'Uploaded', type: 'custom' });
  const nextGoogleFont = font({ id: 'google-roboto-flex', name: 'roboto-flex', family: 'Roboto Flex' });
  const nextTransport = createNextFontLibraryTransport({
    fetch: async (input, init = {}) => {
      requests.push({ input, init });
      if (input === '/kodety/api/fonts' && !init.method) {
        return Response.json({ data: [remoteFont] });
      }
      if (input === '/kodety/api/fonts/google') {
        return Response.json({ error: 'use metadata fallback' }, { status: 503 });
      }
      if (input === 'https://fonts.google.com/metadata/fonts') {
        return Response.json({
          familyMetadataList: [{
            family: 'Roboto Flex',
            fonts: { 400: {}, '700i': {} },
            category: 'Sans Serif',
            axes: [{ tag: 'wght', min: 100, max: 900 }],
          }],
        });
      }
      if (input === '/kodety/api/fonts' && init.body instanceof FormData) {
        return Response.json({ data: [uploadedFont] }, { status: 201 });
      }
      if (input === '/kodety/api/fonts' && init.headers?.['Content-Type'] === 'application/json') {
        return Response.json({ data: nextGoogleFont }, { status: 201 });
      }
      if (input === '/kodety/api/fonts/custom%2Fremote' && init.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${input}`);
    },
  });

  assert.equal(nextTransport.kind, 'next');
  assert.equal(nextTransport.capabilities.synchronousInstalledFontsSnapshot, false);
  assert.deepEqual(nextTransport.readInstalledFontsSnapshot(), []);
  assert.deepEqual(
    (await nextTransport.loadInstalledFonts()).map(entry => entry.id),
    ['custom/remote'],
  );
  assert.deepEqual(
    (await nextTransport.loadGoogleFontsCatalog())[0],
    {
      family: 'Roboto Flex',
      variants: ['regular', '700italic'],
      category: 'sans-serif',
      axes: [{ tag: 'wght', start: 100, end: 900 }],
    },
  );
  const nextUpload = await nextTransport.uploadCustomFonts(
    [new File([], 'uploaded.woff2')],
    [remoteFont],
  );
  assert.deepEqual(nextUpload.installedFonts.map(entry => entry.id), ['custom/remote', 'custom-uploaded']);
  const nextGoogle = await nextTransport.addGoogleFont(catalogFont, nextUpload.installedFonts);
  assert.equal(nextGoogle.font?.id, 'google-roboto-flex');
  const nextRemoval = await nextTransport.removeFontAssociation('custom/remote', nextGoogle.installedFonts);
  assert.equal(nextRemoval.removed, true);
  assert.equal(nextRemoval.remoteMediaDeleted, false);
  assert.equal(nextRemoval.installedFonts.some(entry => entry.id === 'custom/remote'), false);

  const uploadRequest = requests.find(request => request.init.body instanceof FormData);
  assert.ok(uploadRequest);
  assert.equal(uploadRequest.init.body.get('file').name, 'uploaded.woff2');
  const googleRequest = requests.find(request => request.init.headers?.['Content-Type'] === 'application/json');
  assert.deepEqual(JSON.parse(googleRequest.init.body).weights, [
    '100', '200', '300', '400', '500', '600', '700', '800', '900',
  ]);

  resetRegistry();
  assert.throws(() => seam.getFontLibraryTransport(), /No font library transport/);

  const unsupportedServer = await createTestServer();
  try {
    await assert.rejects(
      unsupportedServer.ssrLoadModule('/stores/useFontsStore.ts'),
      error => error?.code === 'kodety_capability_unsupported',
      'importing the store without a composition root must fail closed',
    );
  } finally {
    await unsupportedServer.close();
  }

  const compositionServer = await createTestServer();
  try {
    const composition = await compositionServer.ssrLoadModule(
      '/lib/install-next-editor-platform-services.ts',
    );
    const loadedStoreModule = await composition.loadNextEditorConsumer(
      () => compositionServer.ssrLoadModule('/stores/useFontsStore.ts'),
    );
    const compositionSeam = await compositionServer.ssrLoadModule(
      '/lib/editor-platform-services.ts',
    );
    const installed = compositionSeam.getFontLibraryTransport();
    assert.equal(installed.kind, 'next');
    assert.equal(composition.installNextEditorPlatformServices(), installed);
    assert.deepEqual(loadedStoreModule.useFontsStore.getState().fonts, []);
    assert.equal(loadedStoreModule.useFontsStore.getState().isLoaded, false);
  } finally {
    await compositionServer.close();
  }

  console.log('Font store transport boundary and Next compatibility leaf passed.');
} finally {
  resetRegistry();
  await server.close();
}
