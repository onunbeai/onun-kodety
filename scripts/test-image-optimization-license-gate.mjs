import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
  resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
try {
  const access = await server.ssrLoadModule('/lib/html-editor/product-access.ts');
  for (const licensed of [false, true]) {
    const product = access.createKodetyProductAccess({ licensed,
      signedLimits: { collections: 1, itemsPerCollection: 1 },
      upgradeUrl: 'https://legacy.example.test/plans', licenseUrl: '/activate' });
    assert.equal(product.features.imageCompression, true);
    assert.equal(product.features.imageConversion, true);
    assert.equal(product.features.mcp, true);
    assert.ok(Object.values(product.limits).every(limit => limit === null));
    assert.equal(product.upgradeUrl, '');
    assert.equal(product.licenseUrl, '');
  }
  const navigator = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlNavigator.tsx'), 'utf8');
  const editor = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8');
  assert.doesNotMatch(navigator, /ImageOptimizationLicenseNotice|data-image-optimization-license-gate/);
  assert.match(navigator, /if \(!files\.length \|\| compressing\) return;/);
  assert.match(navigator, /if \(!totalCount \|\| converting\) return;/);
  assert.doesNotMatch(editor, /if \(imageOptimizationAccess\.(?:compression|conversion)Locked\)/);
  assert.match(editor, /compressProjectImage\(/);
  assert.match(editor, /convertProjectImage\(/);
  console.log('Open-source image optimization access passed.');
} finally {
  await server.close();
}
