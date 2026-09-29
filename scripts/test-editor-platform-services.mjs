import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seamPath = path.join(root, 'lib/editor-platform-services.ts');
const wordpressAdapterPath = path.join(
  root,
  'Wordpress/editor/wordpress-font-library-transport.ts',
);
const [seamSource, wordpressAdapterSource] = await Promise.all([
  readFile(seamPath, 'utf8'),
  readFile(wordpressAdapterPath, 'utf8'),
]);

function canonicalizeBoundarySource(source) {
  return source
    .replaceAll('\\/', '/')
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/');
}

function staticStringValue(node) {
  if (ts.isParenthesizedExpression(node)) return staticStringValue(node.expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    return left === null || right === null ? null : `${left}${right}`;
  }
  return null;
}

function assertTransportSourceBoundary(source) {
  const canonical = canonicalizeBoundarySource(source);
  assert.doesNotMatch(
    canonical,
    /\/kodety\/api(?:\/|["'`]\s*\+\s*["'`]\/)/i,
    'platform services must never contain a legacy browser route',
  );
  assert.doesNotMatch(
    canonical,
    /(?:useFontsStore|(?:^|\/)lib\/api(?:\.[cm]?[jt]sx?)?)/im,
    'platform services must not import a legacy store or API module',
  );

  const ast = ts.createSourceFile(
    'transport-boundary.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const visit = node => {
    const value = staticStringValue(node);
    if (
      value !== null
      && canonicalizeBoundarySource(value).toLowerCase().includes('/kodety/api')
    ) {
      assert.fail('platform services must never contain a legacy browser route');
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

function assertNoDefaultTransportInstallation(source) {
  const ast = ts.createSourceFile(
    'editor-platform-services.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let foundEmptyRegistry = false;
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      assert.ok(
        statement.importClause?.isTypeOnly,
        'the transport-neutral seam must not import a runtime or default implementation',
      );
      assert.doesNotMatch(
        statement.moduleSpecifier.text,
        /^react(?:\/|$)/,
        'the transport-neutral seam must remain React-neutral',
      );
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.name.text === 'installedFontLibraryTransport'
        ) {
          assert.ok(
            declaration.initializer
            && declaration.initializer.kind === ts.SyntaxKind.NullKeyword,
            'the font transport registry must start empty',
          );
          foundEmptyRegistry = true;
        }
      }
    }
  }
  assert.equal(foundEmptyRegistry, true, 'the font transport registry must be explicitly empty');
  const visit = node => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'installFontLibraryTransport'
    ) {
      assert.fail('the transport-neutral seam must not install a default transport');
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

assertTransportSourceBoundary(`${seamSource}\n${wordpressAdapterSource}`);
assert.doesNotMatch(
  `${seamSource}\n${wordpressAdapterSource}`,
  /\b(?:window|globalThis)\b/,
  'the seam and WordPress adapter must use injected dependencies instead of global lookup',
);
assertNoDefaultTransportInstallation(seamSource);

for (const mutation of [
  'fetch("/kodety/api/fonts");',
  'fetch("/kodety" + "/api/fonts");',
  'fetch("\\/kodety\\/api\\/fonts");',
  'fetch("\\x2fkodety\\x2fapi\\x2ffonts");',
  'fetch("\\u002fkodety\\u002fapi\\u002ffonts");',
]) {
  assert.throws(
    () => assertTransportSourceBoundary(`${wordpressAdapterSource}\n${mutation}`),
    /legacy browser route/,
    `route mutation survived: ${mutation}`,
  );
}
for (const mutation of [
  'installFontLibraryTransport({} as never);',
  'void installFontLibraryTransport({} as never);',
  'const defaultTransport = installFontLibraryTransport({} as never);',
  'queueMicrotask(() => installFontLibraryTransport({} as never));',
]) {
  assert.throws(
    () => assertNoDefaultTransportInstallation(`${seamSource}\n${mutation}`),
    /must not install a default transport/,
    `default transport mutation survived: ${mutation}`,
  );
}
assert.throws(
  () => assertNoDefaultTransportInstallation(
    `${seamSource}\nimport { createNextFontTransport } from './next-font-transport';`,
  ),
  /must not import a runtime or default implementation/,
);
const defaultInitializerMutation = seamSource.replace(
  'let installedFontLibraryTransport: FontLibraryTransport | null = null;',
  'let installedFontLibraryTransport: FontLibraryTransport | null = {} as FontLibraryTransport;',
);
assert.notEqual(defaultInitializerMutation, seamSource, 'default initializer mutation must apply');
assert.throws(
  () => assertNoDefaultTransportInstallation(defaultInitializerMutation),
  /registry must start empty/,
);

for (const member of [
  'interface ColorVariableCapability',
  'list():',
  'get(id: string)',
  'subscribe(listener:',
  'create(name:',
  'update(',
  'delete(id:',
  'reorder(orderedIds:',
  'setPreviewOverride(',
]) {
  assert.ok(seamSource.includes(member), `missing React-neutral color capability member: ${member}`);
}

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

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
    created_at: '2026-01-02T03:04:05.000Z',
    updated_at: '2026-01-02T03:04:05.000Z',
    deleted_at: null,
    ...overrides,
  };
}

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'silent',
  appType: 'custom',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

let resetRegistry = () => undefined;
try {
  const seam = await server.ssrLoadModule('/lib/editor-platform-services.ts');
  const wordpress = await server.ssrLoadModule(
    '/Wordpress/editor/wordpress-font-library-transport.ts',
  );
  const { buildAllFontsCss } = await server.ssrLoadModule('/lib/font-utils.ts');
  const {
    EDITOR_CAPABILITY_UNSUPPORTED_CODE,
    EDITOR_PLATFORM_SERVICE_ALREADY_INSTALLED_CODE,
    __resetFontLibraryTransportForTests,
    getFontLibraryTransport,
    installFontLibraryTransport,
    isEditorCapabilityUnsupportedError,
  } = seam;
  const {
    WORDPRESS_FONT_LIBRARY_STORAGE_KEY,
    createWordPressFontLibraryTransport,
  } = wordpress;
  resetRegistry = __resetFontLibraryTransportForTests;

  assert.throws(
    () => getFontLibraryTransport(),
    error => (
      isEditorCapabilityUnsupportedError(error)
      && error.code === EDITOR_CAPABILITY_UNSUPPORTED_CODE
      && error.capability === 'font-library'
    ),
    'reading before installation must fail closed',
  );

  const storage = new MemoryStorage();
  const initialFont = font();
  storage.setItem(
    WORDPRESS_FONT_LIBRARY_STORAGE_KEY,
    JSON.stringify([initialFont, { id: 'legacy-partial-font' }, null]),
  );
  const requests = [];
  const fetchDependency = async (input, init = {}) => {
    requests.push({ input, init });
    if (input === 'https://wp.example.test/wp-json/kodety/v1/fonts/google') {
      return new Response(JSON.stringify({
        data: [{
          family: 'Roboto Flex',
          variants: ['regular', '700'],
          category: 'sans-serif',
          axes: [{ tag: 'wght', start: 100, end: 900 }],
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (input === 'https://wp.example.test/wp-json/wp/v2/media') {
      return new Response(JSON.stringify({
        id: 42,
        source_url: 'https://wp.example.test/uploads/brand.woff2',
        slug: 'brand-font',
        title: { rendered: 'Brand Font' },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request: ${input}`);
  };
  const transport = createWordPressFontLibraryTransport({
    googleFontsUrl: 'https://wp.example.test/wp-json/kodety/v1/fonts/google',
    mediaUploadUrl: 'https://wp.example.test/wp-json/wp/v2/media',
    nonce: 'wp-rest-nonce',
  }, {
    fetch: fetchDependency,
    storage,
    now: () => Date.parse('2026-08-30T12:00:00.000Z'),
  });

  assert.deepEqual(transport.capabilities, {
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
  });
  assert.deepEqual(
    transport.readInstalledFontsSnapshot().map(entry => entry.id),
    ['google-inter', 'legacy-partial-font'],
    'the synchronous snapshot must preserve the current local-storage compatibility filter',
  );
  assert.deepEqual(
    (await transport.loadInstalledFonts()).map(entry => entry.id),
    ['google-inter', 'legacy-partial-font'],
  );

  const replacement = font({
    id: 'custom-local',
    name: 'local',
    family: 'Local',
    type: 'custom',
    axes: [{ tag: 'wght', start: 200, end: 800 }],
    kind: 'woff2',
    url: 'https://wp.example.test/uploads/local.woff2',
    storage_path: 'fonts/local.woff2',
    file_hash: 'sha256-file',
    content_hash: 'sha256-content',
  });
  assert.deepEqual(
    transport.replaceInstalledFonts([replacement]).map(entry => entry.id),
    ['custom-local'],
  );
  const upserted = transport.upsertInstalledFont(initialFont, [replacement]);
  assert.deepEqual(upserted.map(entry => entry.id), ['custom-local', 'google-inter']);
  assert.deepEqual(
    JSON.parse(storage.getItem(WORDPRESS_FONT_LIBRARY_STORAGE_KEY)).map(entry => entry.id),
    ['custom-local', 'google-inter'],
  );

  const catalog = await transport.loadGoogleFontsCatalog();
  assert.deepEqual(catalog, [{
    family: 'Roboto Flex',
    variants: ['regular', '700'],
    category: 'sans-serif',
    axes: [{ tag: 'wght', start: 100, end: 900 }],
  }]);
  assert.equal(requests[0].input, 'https://wp.example.test/wp-json/kodety/v1/fonts/google');
  assert.equal(requests[0].init.credentials, 'same-origin');
  assert.deepEqual(requests[0].init.headers, { 'X-WP-Nonce': 'wp-rest-nonce' });

  const failedCatalogRequests = [];
  const failedCatalogTransport = createWordPressFontLibraryTransport({
    googleFontsUrl: 'https://wp.example.test/wp-json/kodety/v1/fonts/failing',
  }, {
    fetch: async (input) => {
      failedCatalogRequests.push(input);
      return new Response(JSON.stringify({ message: 'configured catalog failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    storage: new MemoryStorage(),
  });
  await assert.rejects(
    () => failedCatalogTransport.loadGoogleFontsCatalog(),
    /configured catalog failed/,
  );
  assert.deepEqual(
    failedCatalogRequests,
    ['https://wp.example.test/wp-json/kodety/v1/fonts/failing'],
    'a configured endpoint failure must not fall back to a non-configured URL',
  );

  const googleResult = await transport.addGoogleFont(catalog[0], upserted);
  assert.equal(googleResult.added, true);
  assert.equal(googleResult.font.family, 'Roboto Flex');
  assert.deepEqual(googleResult.font.axes, [{ tag: 'wght', start: 100, end: 900 }]);
  assert.deepEqual(googleResult.font.weights, ['400', '700']);
  assert.deepEqual(
    JSON.parse(storage.getItem(WORDPRESS_FONT_LIBRARY_STORAGE_KEY)).map(entry => entry.id),
    googleResult.installedFonts.map(entry => entry.id),
    'a Google association must be persisted through the transport',
  );

  const uploadResult = await transport.uploadCustomFonts(
    [new File([new Uint8Array([1, 2, 3])], 'brand.woff2', { type: 'font/woff2' })],
    googleResult.installedFonts,
  );
  assert.equal(requests[1].input, 'https://wp.example.test/wp-json/wp/v2/media');
  assert.equal(requests[1].init.method, 'POST');
  assert.equal(requests[1].init.credentials, 'same-origin');
  assert.deepEqual(requests[1].init.headers, { 'X-WP-Nonce': 'wp-rest-nonce' });
  assert.ok(requests[1].init.body instanceof FormData);
  assert.equal(requests[1].init.body.get('title'), 'brand');
  assert.equal(requests[1].init.body.get('file').name, 'brand.woff2');
  assert.equal(uploadResult.uploadedFonts[0].id, 'wp-media-42');
  assert.equal(uploadResult.uploadedFonts[0].kind, 'woff2');
  assert.equal(uploadResult.uploadedFonts[0].url, 'https://wp.example.test/uploads/brand.woff2');
  assert.equal(uploadResult.uploadedFonts[0].created_at, '2026-08-30T12:00:00.000Z');
  assert.deepEqual(
    JSON.parse(storage.getItem(WORDPRESS_FONT_LIBRARY_STORAGE_KEY)).map(entry => entry.id),
    uploadResult.installedFonts.map(entry => entry.id),
    'uploaded font associations must be persisted only after upload succeeds',
  );

  const fetchCountBeforeRemoval = requests.length;
  const removal = await transport.removeFontAssociation(
    'wp-media-42',
    uploadResult.installedFonts,
  );
  assert.equal(removal.removed, true);
  assert.equal(removal.remoteMediaDeleted, false);
  assert.equal(removal.installedFonts.some(entry => entry.id === 'wp-media-42'), false);
  assert.deepEqual(
    JSON.parse(storage.getItem(WORDPRESS_FONT_LIBRARY_STORAGE_KEY)).map(entry => entry.id),
    removal.installedFonts.map(entry => entry.id),
    'association removal must update local persistence',
  );
  assert.equal(requests.length, fetchCountBeforeRemoval, 'association removal must not delete Media Library data');

  const reloadedTransport = createWordPressFontLibraryTransport({}, {
    fetch: fetchDependency,
    storage,
  });
  const reloadedCustomFont = reloadedTransport
    .readInstalledFontsSnapshot()
    .find(entry => entry.id === replacement.id);
  assert.deepEqual(
    reloadedCustomFont,
    replacement,
    'the complete Font model must survive a local persistence round-trip',
  );
  const roundTripCss = buildAllFontsCss([reloadedCustomFont]);
  assert.match(roundTripCss, /https:\/\/wp\.example\.test\/uploads\/local\.woff2/);
  assert.match(roundTripCss, /font-family:\s*"Local"/);

  const missingRequests = [];
  const missingStorage = new MemoryStorage();
  const missingCapabilities = createWordPressFontLibraryTransport({ nonce: 'nonce' }, {
    fetch: async (...args) => {
      missingRequests.push(args);
      throw new Error('fetch must not run');
    },
    storage: missingStorage,
    now: () => 0,
  });
  assert.equal(missingCapabilities.capabilities.googleFontsCatalog, false);
  assert.equal(missingCapabilities.capabilities.uploadCustomFonts, false);
  await assert.rejects(
    () => missingCapabilities.loadGoogleFontsCatalog(),
    error => (
      isEditorCapabilityUnsupportedError(error)
      && error.capability === 'font-library.google-catalog'
    ),
  );
  await assert.rejects(
    () => missingCapabilities.uploadCustomFonts(
      [new File([], 'blocked.woff2')],
      [],
    ),
    error => (
      isEditorCapabilityUnsupportedError(error)
      && error.capability === 'font-library.custom-upload'
    ),
  );
  assert.equal(missingRequests.length, 0, 'missing endpoint capabilities must fail before fetch');
  const localGoogle = await missingCapabilities.addGoogleFont(catalog[0], []);
  assert.equal(localGoogle.added, true);
  assert.equal(missingRequests.length, 0, 'local Google association must not require a remote endpoint');

  const installed = installFontLibraryTransport(transport);
  assert.equal(installed, transport);
  assert.equal(installFontLibraryTransport(transport), transport, 'installing the same reference must be idempotent');
  const lazyRead = async () => {
    const lazySeam = await server.ssrLoadModule('/lib/editor-platform-services.ts');
    return lazySeam.getFontLibraryTransport();
  };
  assert.equal(await lazyRead(), transport, 'a pre-lazy installation must be visible to lazy consumers');
  assert.throws(
    () => installFontLibraryTransport(missingCapabilities),
    error => error?.code === EDITOR_PLATFORM_SERVICE_ALREADY_INSTALLED_CODE,
    'a different transport must not overwrite the installed runtime',
  );
  assert.equal(getFontLibraryTransport(), transport);

  resetRegistry();
  assert.equal(
    JSON.parse(storage.getItem(WORDPRESS_FONT_LIBRARY_STORAGE_KEY)).length > 0,
    true,
    'the test-only registry reset must not clear persistent font associations',
  );

  console.log('Editor platform service and WordPress font transport contracts passed.');
} finally {
  resetRegistry();
  await server.close();
}
