import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const storage = new Map();
const sessionStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

globalThis.window = {
  location: new URL('https://kodety.test/wp-admin/admin.php?page=kodety-settings'),
  sessionStorage,
};

const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

let surfaceRequests = 0;
let assetRequests = 0;
const fontBytes = new TextEncoder().encode('lazy-font-fixture');
const fontBase64 = Buffer.from(fontBytes).toString('base64');

globalThis.fetch = async input => {
  const url = input instanceof URL
    ? input
    : new URL(typeof input === 'string' ? input : input.url);
  if (url.pathname.endsWith('/project/surface/asset')) {
    assetRequests += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json({
      path: 'assets/brand.woff2',
      mimeType: 'font/woff2',
      data: fontBase64,
      workspaceRevision: 7,
    });
  }
  if (url.pathname.endsWith('/project/surface')) {
    surfaceRequests += 1;
    if (url.searchParams.get('revision') === '7') {
      return Response.json({
        success: true,
        notModified: true,
        workspaceRevision: 7,
        workspaceDigest: 'a'.repeat(64),
      });
    }
    return Response.json({
      success: true,
      project: {
        name: 'Surface runtime fixture',
        rootPath: '',
        mainHtmlPath: 'index.html',
        files: {
          'index.html': { path: 'index.html', mimeType: 'text/html', text: '<main>Fixture</main>' },
          'styles.css': {
            path: 'styles.css',
            mimeType: 'text/css',
            text: '@font-face{font-family:"Brand";src:url("assets/brand.woff2")}',
          },
          'assets/brand.woff2': {
            path: 'assets/brand.woff2',
            mimeType: 'font/woff2',
            lazyAsset: true,
          },
          'assets/rejected.woff2': {
            path: 'assets/rejected.woff2',
            mimeType: 'font/woff2',
            lazyAsset: false,
          },
        },
      },
      workspaceRevision: 7,
      workspaceDigest: 'a'.repeat(64),
      templateDigest: 'b'.repeat(64),
    });
  }
  throw new Error(`Unexpected request: ${url.href}`);
};

const config = {
  nonce: 'surface-runtime-nonce',
  projectName: 'Surface runtime fixture',
  projectSurfaceUrl: 'https://kodety.test/wp-json/kodety/v1/project/surface',
  projectSurfaceAssetUrl: 'https://kodety.test/wp-json/kodety/v1/project/surface/asset',
  siteUrl: 'https://kodety.test/',
  canEditWorkspace: true,
  canViewAnalytics: true,
  canManageAnalytics: true,
};

try {
  const transport = await server.ssrLoadModule('/Wordpress/editor/wordpress-project-surface.ts');
  const snapshot = await transport.fetchWordPressProjectSurface(config, 'settings');
  const descriptor = snapshot.project.files['assets/brand.woff2'];
  assert.ok(descriptor, 'the network snapshot must retain a lazy font path descriptor');
  assert.equal(descriptor.text, undefined);
  assert.equal(descriptor.data, undefined);
  assert.equal(snapshot.project.files['assets/rejected.woff2'], undefined);

  const cached = transport.readCachedWordPressProjectSurface(config, 'settings');
  const cachedDescriptor = cached?.project.files['assets/brand.woff2'];
  assert.ok(cachedDescriptor, 'the private session cache must retain lazy descriptors without bytes');
  assert.equal(cachedDescriptor.text, undefined);
  assert.equal(cachedDescriptor.data, undefined);

  const revalidated = await transport.fetchWordPressProjectSurface(config, 'settings');
  assert.equal(revalidated.workspaceRevision, 7);
  assert.ok(revalidated.project.files['assets/brand.woff2']);
  assert.equal(surfaceRequests, 2, 'the second surface request must revalidate the cached revision');

  const [firstAsset, secondAsset] = await Promise.all([
    transport.fetchWordPressProjectSurfaceAsset(config, 'assets/brand.woff2', 7),
    transport.fetchWordPressProjectSurfaceAsset(config, 'assets/brand.woff2', 7),
  ]);
  assert.equal(assetRequests, 1, 'concurrent requests for the same revision/path must share one transfer');
  assert.deepEqual(firstAsset.data, fontBytes);
  assert.deepEqual(secondAsset.data, fontBytes);
  assert.equal(firstAsset.path, 'assets/brand.woff2');
} finally {
  await server.close();
}

console.log('WordPress project surface runtime: cache, descriptors, CAS revalidation and asset dedupe passed.');
