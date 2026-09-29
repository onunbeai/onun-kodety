import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

try {
  const seo = await server.ssrLoadModule('/lib/html-editor/seo-settings.ts');

  assert.equal(
    seo.robotsContent(
      { defaultIndex: true, defaultFollow: true, defaultRobots: { maxImagePreview: 'large', maxSnippet: -1, noArchive: true } },
      { robots: { noImageIndex: true, maxVideoPreview: 30 } },
    ),
    'index,follow,noarchive,noimageindex,max-snippet:-1,max-image-preview:large,max-video-preview:30',
  );
  assert.equal(seo.jsonLdError('{"@type":"Article"}'), '');
  assert.match(seo.jsonLdError('{"@type":'), /inválido/);
  assert.equal(seo.schemaStarter('Article', true).headline, '{{title}}');

  const html = seo.applySeoToHtml(
    '<!doctype html><html><head></head><body></body></html>',
    'posts/template.html',
    {
      siteTitle: 'Kodety',
      baseUrl: 'https://example.com',
      organizationName: 'Kodety Studio',
      organizationType: 'Corporation',
      websiteSchema: true,
      googleSiteVerification: 'google-code',
      defaultRobots: { maxImagePreview: 'large', maxSnippet: -1 },
    },
    {
      title: '{{title}}',
      description: '{{excerpt}}',
      canonicalUrl: '{{permalink}}',
      schemaType: 'Article',
      schemaJsonLd: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: '{{title}}',
        image: '{{featured_image}}',
        sku: '{{sku}}',
      }),
    },
  );
  assert.match(html, /name="robots" content="index,follow,max-snippet:-1,max-image-preview:large"/);
  assert.match(html, /name="google-site-verification" content="google-code" data-kodety-verification/);
  assert.match(html, /"@graph"/);
  assert.match(html, /"headline":"\{\{title\}\}"/);
  assert.match(html, /"sku":"\{\{sku\}\}"/);

  const consentHtml = seo.applySeoToHtml(
    '<!doctype html><html><head></head><body></body></html>',
    'index.html',
    {
      siteTitle: 'Kodety',
      metaPixelId: '123456789',
      analyticsConsentMode: 'consent',
    },
    {},
  );
  const consentLoader = consentHtml.match(
    /<script data-kodety-integration="consent-loader">([\s\S]*?)<\/script>/,
  );
  assert.ok(consentLoader, 'o loader explícito de consentimento deve ser publicado junto ao Meta Pixel');
  const consentStorage = new Map();
  const consentCalls = [];
  const consentListeners = new Map();
  const consentWindow = {
    doNotTrack: '0',
    fbq: (...args) => consentCalls.push(args),
    addEventListener: (type, listener) => consentListeners.set(type, listener),
  };
  vm.runInNewContext(consentLoader[1], {
    window: consentWindow,
    navigator: { doNotTrack: '0' },
    document: {
      readyState: 'complete',
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: key => consentStorage.get(key) || null,
      setItem: (key, value) => consentStorage.set(key, value),
    },
  });
  assert.equal(consentWindow.__kodetyAnalyticsConsentGranted, false);
  assert.equal(typeof consentWindow.kodetyAnalyticsConsent, 'function');
  assert.equal(typeof consentListeners.get('kodety:analytics-consent'), 'function');
  consentWindow.kodetyAnalyticsConsent(true);
  assert.equal(consentWindow.__kodetyAnalyticsConsentGranted, true);
  assert.equal(consentStorage.get('kodety-analytics-consent'), 'granted');
  assert.ok(consentCalls.some(call => call[0] === 'consent' && call[1] === 'grant'));
  consentWindow.kodetyAnalyticsConsent(false);
  assert.equal(consentWindow.__kodetyAnalyticsConsentGranted, false);
  assert.equal(consentStorage.get('kodety-analytics-consent'), 'denied');
  assert.ok(consentCalls.some(call => call[0] === 'consent' && call[1] === 'revoke'));

  const [settingsUi, aiBackend, runtime, plugin] = await Promise.all([
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-ai.php'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/theme-runtime/functions.php'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8'),
  ]);
  assert.match(settingsUi, /Gerar em um clique/);
  assert.match(settingsUi, /JSON-LD conectado/);
  assert.match(settingsUi, /blockAiTrainingBots/);
  assert.match(aiBackend, /'schema' => '\{"schemaType"/);
  assert.match(runtime, /function kodety_seo_runtime_settings/);
  assert.match(runtime, /function_exists\('get_field'\) \? get_field\(\$key, \$post->ID\)/);
  assert.match(plugin, /seo\.json/);
  assert.match(
    plugin,
    /\$seo_temporary[\s\S]*?file_put_contents\(\$seo_temporary, \$seo_json, LOCK_EX\)[\s\S]*?!rename\(\$seo_temporary, \$seo_path\)[\s\S]*?throw new RuntimeException/,
    'o contrato SEO publicado deve ser escrito atomicamente e abortar uma release incompleta',
  );

  console.log('Advanced SEO, robots, AI Schema and CMS bindings tests passed.');
} finally {
  await server.close();
}
