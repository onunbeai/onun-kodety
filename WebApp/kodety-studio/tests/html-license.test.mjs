import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(path.join(tmpdir(), 'onun-open-source-access-'));
await build({ entryPoints: [path.join(root, 'WebApp/kodety-studio/src/html-license.ts'), path.join(root, 'lib/html-editor/static-license.ts')], outdir: scratch, outbase: root, bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, logLevel: 'silent' });
const require = createRequire(import.meta.url);
const { createHtmlLicenseClient } = require(path.join(scratch, 'WebApp/kodety-studio/src/html-license.cjs'));
const output = require(path.join(scratch, 'lib/html-editor/static-license.cjs'));
after(() => rm(scratch, { recursive: true, force: true }));

test('opening and checking an editor needs no service, storage, or activation key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  try {
    const client = createHtmlLicenseClient('offline-project', 'http://localhost/');
    const loaded = await client.load();
    assert.equal(loaded.product.licensed, true);
    assert.equal(loaded.product.features.ai, true);
    assert.equal(loaded.product.features.mcp, true);
    assert.equal(loaded.product.features.cookieConsent, true);
    assert.equal(loaded.status.isTrial, false);
    assert.equal(loaded.status.expiresAt, '');
    assert.strictEqual(await client.check(), loaded);
    client.dispose();
  } finally { globalThis.fetch = originalFetch; }
});

test('HTML export preserves authored SEO, social images, forms and cookie consent without a product grant', () => {
  const html = '<html><head><script type="application/ld+json">{"@type":"WebSite"}</script><meta property="og:image" content="/cover.png"><meta name="robots" content="max-image-preview:large"></head><body><form data-kodety-utm-enabled="true"></form><script data-kodety-cookie-consent="runtime"></script></body></html>';
  const project = { files: { 'index.html': { path: 'index.html', text: html } } };
  assert.equal(output.stripUnlicensedStaticHtml(html), html);
  assert.strictEqual(output.staticLicenseSource(project), project);
  assert.strictEqual(output.applyStaticLicenseOutput(project), project);
  assert.doesNotThrow(() => output.assertStaticLicensePublication(project));
  for (const feature of ['advancedSeo', 'redirects', 'socialImageBuilder', 'analyticsUtms', 'experiments', 'analyticsFunnels']) assert.equal(output.staticLicenseHas(undefined, feature), true);
});
