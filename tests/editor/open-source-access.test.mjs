import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'onun-open-source-access-'));
await build({ entryPoints: [path.join(root, 'lib/html-editor/product-access.ts'), path.join(root, 'lib/html-editor/static-license.ts')], outdir: scratch, bundle: true, platform: 'node', format: 'cjs', alias: { '@': root }, outExtension: { '.js': '.cjs' }, logLevel: 'silent' });
const require = createRequire(import.meta.url);
const { createKodetyProductAccess } = require(path.join(scratch, 'product-access.cjs'));
const output = require(path.join(scratch, 'static-license.cjs'));
after(() => rm(scratch, { recursive: true, force: true }));

test('shared WordPress product access needs no activation, service, or subscription', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  try {
    for (const licensed of [false, true]) {
      const access = createKodetyProductAccess({ licensed, localization: true, signedLimits: { pages: 1 } });
      assert.equal(access.licensed, true);
      assert.equal(access.licenseStatus, 'open-source');
      assert.equal(access.licensePlan, 'GPL-3.0-only');
      assert.equal(access.licenseUrl, '');
      assert.equal(access.upgradeUrl, '');
      assert.ok(Object.values(access.features).every(enabled => enabled === true));
      assert.ok(Object.values(access.limits).every(limit => limit === null));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('localization availability follows the installed integration', () => {
  assert.equal(createKodetyProductAccess({ licensed: false }).features.localization, false);
  assert.equal(createKodetyProductAccess({ licensed: false, localization: true }).features.localization, true);
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
