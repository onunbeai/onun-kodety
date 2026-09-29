import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const aliases = {
  '@coday/components': path.join(root, 'packages/component-sdk/src/index.ts'),
  '@coday/control-schema': path.join(root, 'packages/control-schema/src/index.ts'),
  '@coday/component-runtime/vendor': path.join(root, 'packages/component-runtime/src/vendor.ts'),
  '@coday/component-runtime': path.join(root, 'packages/component-runtime/src/index.tsx'),
  '@coday/component-compiler': path.join(root, 'packages/component-compiler/src/index.ts'),
  '@coday/property-inspector': path.join(root, 'packages/property-inspector/src/index.tsx'),
  '@coday/canvas-bridge': path.join(root, 'packages/canvas-bridge/src/index.ts'),
  '@coday/asset-bridge': path.join(root, 'packages/asset-bridge/src/index.ts'),
  '@coday/cms-bridge': path.join(root, 'packages/cms-bridge/src/index.ts'),
  '@coday/component-registry': path.join(root, 'packages/component-registry/src/index.ts'),
  '@coday/component-sandbox': path.join(root, 'packages/component-sandbox/src/index.ts'),
};
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
  resolve: { alias: aliases },
});

function projectFile(pathname, mimeType, text) {
  return { path: pathname, mimeType, text };
}

try {
  const consent = await server.ssrLoadModule('/lib/html-editor/cookie-consent.ts');
  const projectIo = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const readyDefaults = {
    ...consent.DEFAULT_COOKIE_CONSENT_SETTINGS,
    enabled: true,
  };
  assert.equal(
    consent.cookieConsentSettingsError(readyDefaults),
    '',
    'the native Cookie Consent defaults must be ready to enable and save',
  );
  assert.deepEqual(
    readyDefaults.cookies.map(cookie => cookie.name),
    [
      'kodety_consent',
      'kodety_consent_analytics',
      'kodety_consent_marketing',
      'kodety_consent_experiments',
    ],
    'the first-party consent cookies must ship documented in the default inventory',
  );
  assert.deepEqual(
    consent.normalizeCookieConsentSettings({ ...readyDefaults, cookies: [] }).cookies.map(cookie => cookie.name),
    readyDefaults.cookies.map(cookie => cookie.name),
    'older settings with an empty inventory must receive the consent cookies that the runtime always creates',
  );
  const incompleteCookieSettings = {
    ...readyDefaults,
    cookies: [...readyDefaults.cookies, {
      id: 'incomplete_cookie',
      name: '',
      domain: '',
      provider: '',
      purpose: '',
      categoryId: 'analytics',
      duration: '',
      type: 'persistent',
      party: 'first',
    }],
  };
  const incompleteCookieIssues = consent.cookieConsentSettingsIssues(incompleteCookieSettings);
  assert.deepEqual(
    incompleteCookieIssues[0],
    {
      section: 'cookies',
      itemId: 'incomplete_cookie',
      fields: ['name', 'purpose'],
      message: 'Complete os dados obrigatórios do cookie “Cookie 5”.',
    },
    'validation must identify the exact cookie and fields that need attention',
  );
  const settings = {
    ...consent.DEFAULT_COOKIE_CONSENT_SETTINGS,
    enabled: true,
    services: [{
      id: 'custom_analytics',
      name: 'Custom Analytics',
      provider: 'Kodety Customer',
      categoryId: 'analytics',
      description: 'Measures product usage.',
      privacyPolicyUrl: 'https://example.com/privacy?source=kodety&mode=consent',
      cookies: ['custom_measurement'],
      dataRetention: '90 days',
      enabledPages: [],
      consentRequired: true,
      scriptIds: ['custom-analytics'],
    }],
    cookies: [{
      id: 'custom_measurement',
      name: 'custom_measurement',
      domain: '.example.com',
      provider: 'Kodety Customer',
      purpose: 'Measures product usage.',
      categoryId: 'analytics',
      duration: '90 days',
      type: 'persistent',
      party: 'first',
    }],
  };
  const authoredHtml = '<!doctype html><html><head>'
    + '<script data-kodety-integration="google-analytics" src="https://www.googletagmanager.com/gtag/js?id=G-TEST&amp;cx=c">window.gaLoaded=true</script>'
    + '<script data-kodety-integration="meta-pixel">window.metaLoaded=true</script>'
    + '</head><body>'
    + '<script type="text/plain" data-kodety-custom-code-consent="custom-analytics">window.customAnalyticsLoaded=true</script>'
    + '<iframe src="https://www.youtube.com/embed/example?rel=0&amp;origin=https%3A%2F%2Fexample.com"></iframe>'
    + '</body></html>';
  const project = {
    name: 'Cookie Consent fixture',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': projectFile('index.html', 'text/html', authoredHtml),
      '.incode/project.json': projectFile(
        '.incode/project.json',
        'application/json',
        JSON.stringify({ version: 1, cookieConsent: settings }),
      ),
      // Mirrors the large, already compressed media that exposed the live
      // WordPress proxy timeout. A materialized publish must not upload it a
      // second time when the saved workspace already contains these bytes.
      'media/hero.mp4': {
        path: 'media/hero.mp4',
        mimeType: 'video/mp4',
        data: Uint8Array.from({ length: 512 * 1024 }, (_, index) => (index * 131 + 17) % 251),
      },
    },
  };

  const materialized = consent.prepareCookieConsentProjectForTransport(project);
  const materializedHtml = materialized.files['index.html'].text;
  assert.match(materializedHtml, /kodety-cookie-consent:body-end:start/);
  assert.match(materializedHtml, /type="text\/plain"[^>]*data-category="analytics"/);
  assert.match(materializedHtml, /data-service="custom_analytics"/);
  assert.match(materializedHtml, /data-category="marketing"[^>]*data-service="kodety_meta_pixel"/);
  assert.match(materializedHtml, /data-kodety-consent-src="https:\/\/www\.youtube\.com\/embed\/example\?rel=0&amp;origin=/);
  assert.match(materializedHtml, /src="about:blank"/);
  assert.doesNotMatch(materializedHtml, /&amp;amp;/, 'HTML entities must not be escaped twice');
  assert.match(materializedHtml, /"domain":"\.example\.com"/, 'cookie auto-clear must preserve its domain');
  assert.match(materializedHtml, /kodety-consent-service-name/);
  assert.match(materializedHtml, /Retenção: 90 days/);
  assert.match(materializedHtml, /"layout":"box wide","position":"bottom center"/);
  assert.match(materializedHtml, /a\[href=\\?"#cookie-preferences\\?"\]/);
  assert.ok(materialized.files['assets/kodety-cookie-consent/cookieconsent.umd.js']);
  assert.ok(materialized.files['assets/kodety-cookie-consent/cookieconsent.css']);
  assert.match(materialized.files['assets/kodety-cookie-consent/LICENSE.txt'].text, /MIT License/i);
  const generatedConsentCss = materialized.files['assets/kodety-cookie-consent/cookieconsent.css'].text;
  assert.match(generatedConsentCss, /\.cm\.cm--box\.cm--wide \{[\s\S]*?max-width: min\(calc\(100vw - 32px\), 760px\);/, 'the published banner must honor the Kodety Max width control instead of the library 36em cap');
  assert.match(generatedConsentCss, /\.cm__body \{[\s\S]*?container-name: kodety-consent-banner;[\s\S]*?container-type: inline-size;/, 'the published banner must observe its own rendered width');
  assert.match(generatedConsentCss, /@container kodety-consent-banner \(max-width: 460px\) \{[\s\S]*?\.cm__btns[\s\S]*?grid-template-columns: 1fr;[\s\S]*?\.cm__btn \{ min-width: 0; width: 100%; \}/, 'narrow published banners must stack full-width actions independently of the page viewport');
  assert.match(generatedConsentCss, /\.cm__btn,[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;[\s\S]*?width: 100%;/, 'published action labels must stay on one line without overflowing narrow buttons');
  assert.match(generatedConsentCss, /\.cm__btn--close \{ display: none !important; \}/, 'the initial banner must not expose a dismiss-without-decision action');
  assert.match(generatedConsentCss, /\.cm__footer \{[\s\S]*?background: transparent;[\s\S]*?border-top: 0;/, 'policy links must not render inside the library gray strip');
  assert.match(generatedConsentCss, /\.pm__section--expandable \.pm__section-arrow svg \{[\s\S]*?stroke: #ffffff;/, 'category disclosure arrows must use the white Kodety accent contrast');
  assert.match(generatedConsentCss, /button:focus-visible,[\s\S]*?box-shadow: 0 0 0 3px var\(--kodety-cc-focus\)/, 'published controls must replace the native blue focus outline with the configured accent');
  assert.match(materializedHtml, /target=\\"_blank\\" rel=\\"noopener noreferrer\\"/, 'published policy links must open safely without inheriting the editor frame');

  const [overlayPackage, completePackage] = await Promise.all([
    projectIo.projectToMaterializedPublishOverlayPackage(project, { fast: true }),
    projectIo.projectToPublishPackage(project, { fast: true }),
  ]);
  const overlayZip = await JSZip.loadAsync(await overlayPackage.zip.arrayBuffer());
  const overlayManifest = JSON.parse(
    await overlayZip.file('.incode/publish-overlay.json').async('string'),
  );
  assert.equal(overlayManifest.schemaVersion, 1);
  assert.equal(overlayManifest.kind, 'kodety-materialized-publish-overlay');
  assert.ok(overlayManifest.upserts.some(entry => entry.path === 'index.html'));
  assert.ok(overlayManifest.upserts.some(entry => entry.path === 'assets/kodety-cookie-consent/cookieconsent.umd.js'));
  assert.ok(overlayManifest.upserts.every(entry => /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.equal(overlayZip.file('media/hero.mp4'), null, 'unchanged large media must stay server-side');
  assert.equal(overlayZip.file('.incode/project.json'), null, 'editable metadata must stay authoritative on WordPress');
  assert.equal(overlayPackage.cssDigest, completePackage.cssDigest, 'overlay and complete release must authenticate the same output');
  assert.ok(
    overlayPackage.zip.size < completePackage.zip.size / 2,
    'the release overlay must remain materially smaller than the complete project archive',
  );

  const repeated = consent.prepareCookieConsentProjectForTransport(materialized);
  assert.equal(
    repeated.files['index.html'].text,
    materializedHtml,
    'the transport compiler must be byte-for-byte idempotent',
  );

  const inline = consent.prepareCookieConsentProjectForTransport(
    project,
    settings,
    { inlineAssets: true },
  );
  const inlineHtml = inline.files['index.html'].text;
  assert.match(inlineHtml, /<style data-kodety-cookie-consent="styles">/);
  assert.match(inlineHtml, /<script data-kodety-cookie-consent="engine">/);
  assert.equal(
    Object.keys(inline.files).some(filePath => filePath.startsWith('assets/kodety-cookie-consent/')),
    false,
    'single-document Preview must not depend on emitted project assets',
  );

  const hookIndex = inlineHtml.indexOf('const installServiceHooks');
  const hookInstallIndex = inlineHtml.indexOf('installServiceHooks();', hookIndex);
  const managerRunIndex = inlineHtml.indexOf('await manager.run(data.config)', hookInstallIndex);
  assert.ok(
    hookIndex >= 0 && hookInstallIndex > hookIndex && managerRunIndex > hookInstallIndex,
    'Basic Consent Mode hooks must be installed before CookieConsent revives Google scripts',
  );
  assert.match(
    inlineHtml.slice(hookIndex, managerRunIndex),
    /service\.onAccept[\s\S]*?applyGoogleConsent\(\)/,
    'Google consent update must run in the service accept hook',
  );
  assert.match(
    inlineHtml,
    /manager\.reset\(true\);[\s\S]*?location\.reload\(\);/,
    'reset must reload because already executed scripts cannot be made inert in place',
  );
  assert.match(inlineHtml, /\^kodety_exp_\\d\+\$/i, 'generated cleanup regex must preserve its digit escape');

  const customMarketingSettings = {
    ...settings,
    categories: [...settings.categories, {
      id: 'paid_media',
      name: 'Paid media',
      description: 'Advertising attribution.',
      required: false,
      defaultEnabled: false,
      allowVisitorControl: true,
      order: 8,
    }],
    integrationCategories: { ...settings.integrationCategories, metaPixel: 'paid_media' },
  };
  const customMarketingHtml = consent.prepareCookieConsentProjectForTransport(
    project,
    customMarketingSettings,
    { inlineAssets: true },
  ).files['index.html'].text;
  assert.match(
    customMarketingHtml,
    /data-kodety-integration="meta-pixel"[^>]*data-category="paid_media"/,
    'Meta Pixel must honor a custom consent category',
  );

  const advancedGoogleHtml = consent.prepareCookieConsentProjectForTransport(
    project,
    { ...settings, googleConsentMode: { enabled: true, mode: 'advanced' } },
    { inlineAssets: true },
  ).files['index.html'].text;
  assert.match(advancedGoogleHtml, /data-kodety-cookie-consent="google-consent-default"/);
  assert.match(
    advancedGoogleHtml,
    /<script data-kodety-integration="google-analytics" src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST&amp;cx=c">/,
    'Advanced Consent Mode may load Google while preserving denied defaults',
  );

  const simpleHtml = consent.prepareCookieConsentProjectForTransport(
    project,
    { ...settings, bannerType: 'simple' },
  ).files['index.html'].text;
  assert.doesNotMatch(simpleHtml, /"showPreferencesBtn":/, 'Simple mode must not expose Customize');

  const restored = consent.prepareCookieConsentProjectForTransport(materialized, {
    ...settings,
    enabled: false,
  });
  const restoredHtml = restored.files['index.html'].text;
  assert.doesNotMatch(restoredHtml, /kodety-cookie-consent:/);
  assert.doesNotMatch(restoredHtml, /data-kodety-consent-managed/);
  assert.match(restoredHtml, /<script[^>]*data-kodety-integration="google-analytics"/);
  assert.match(restoredHtml, /<iframe[^>]*src="https:\/\/www\.youtube\.com\/embed\/example\?rel=0&amp;origin=/);
  assert.match(
    restoredHtml,
    /<script(?=[^>]*type="text\/plain")(?=[^>]*data-kodety-custom-code-consent="custom-analytics")[^>]*>/,
    'gated Custom Code must remain fail-closed when the manager is disabled',
  );
  assert.equal(
    Object.keys(restored.files).some(filePath => filePath.startsWith('assets/kodety-cookie-consent/')),
    false,
  );

  const [projectIoSource, previewSource, customCodeSource, settingsPreviewSource, settingsControlsSource, projectSettingsSource, editionSource, pluginSource] = await Promise.all([
    readFile(path.join(root, 'lib/html-editor/project-io.ts'), 'utf8'),
    readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8'),
    readFile(path.join(root, 'lib/html-editor/custom-code.ts'), 'utf8'),
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCookieConsentSettings.tsx'), 'utf8'),
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlSettingsControls.tsx'), 'utf8'),
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/includes/product-policy.json'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8'),
  ]);
  const transportCompiler = projectIoSource.slice(projectIoSource.indexOf('export function prepareProjectForTransport'));
  const materializedIndex = transportCompiler.indexOf('const materializedProject');
  const consentIndex = transportCompiler.indexOf('const cookieConsentProject', materializedIndex);
  const membershipIndex = transportCompiler.indexOf('prepareMembershipProjectForTransport(', consentIndex);
  assert.ok(
    materializedIndex >= 0 && consentIndex > materializedIndex && membershipIndex > consentIndex,
    'consent must gate fully materialized HTML before Membership protects the release artifact',
  );

  const previewCompiler = previewSource.slice(previewSource.indexOf('export function buildPreview'));
  const interactionsIndex = previewCompiler.indexOf('source = patchInteractionDocument(');
  const previewConsentIndex = previewCompiler.indexOf('const consentPreviewProject', interactionsIndex);
  const parserIndex = previewCompiler.indexOf("new DOMParser().parseFromString(source, 'text/html')", previewConsentIndex);
  assert.ok(
    interactionsIndex >= 0 && previewConsentIndex > interactionsIndex && parserIndex > previewConsentIndex,
    'executable Preview must gate hydrated component/interactions HTML immediately before parsing',
  );
  assert.match(
    previewCompiler.slice(interactionsIndex, parserIndex),
    /if \(!inspectionEnabled\)[\s\S]*?\{ inlineAssets: true \}/,
    'Design stays inspection-only while executable Preview receives self-contained consent assets',
  );
  assert.match(
    customCodeSource,
    /entry\.consent === 'required'[\s\S]*?consentRuntime\(/,
    'malformed gated Custom Code metadata must fail closed through the consent runtime',
  );
  assert.match(
    settingsPreviewSource,
    /absolute left-0\.5 top-0\.5 size-4[\s\S]*?checked \? 'translate-x-4' : 'translate-x-0'/,
    'the Settings preview switch must anchor its knob and move it inside the track',
  );
  assert.doesNotMatch(
    settingsPreviewSource,
    /translate-x-\[18px\]/,
    'the Settings preview switch must not translate beyond its 36px track',
  );
  assert.match(
    settingsPreviewSource,
    /const DEFAULT_APPEARANCE[^=]*= \{ \.\.\.DEFAULT_COOKIE_CONSENT_SETTINGS\.appearance \}/,
    'the Settings simulation must share its appearance defaults with the published runtime',
  );
  assert.match(
    settingsPreviewSource,
    /visualTheme === 'dark' && colorsAreDefaults[\s\S]*?background: '#171719'[\s\S]*?text: '#f6f6f7'[\s\S]*?mutedText: '#aaaab2'[\s\S]*?border: '#303036'/,
    'Dark simulation must render the native dark banner palette',
  );
  assert.match(
    settingsPreviewSource,
    /const COOKIE_CONSENT_STACKED_ACTIONS_MAX_WIDTH = 460;[\s\S]*?const panelMaxWidth = Math\.min\(appearance\.maxWidth, previewWidth - 32\);[\s\S]*?const actionsAreStacked = panelMaxWidth <= COOKIE_CONSENT_STACKED_ACTIONS_MAX_WIDTH;/,
    'the Settings preview must stack actions from the rendered card width, not only the viewport preset',
  );
  assert.match(
    settingsPreviewSource,
    /data-kodety-cookie-consent-actions-layout=\{actionsAreStacked \? 'vertical' : 'horizontal'\}[\s\S]*?gridTemplateColumns: actionsAreStacked \? '1fr'/,
    'the Settings preview must expose and render the same vertical narrow-card layout as publication',
  );
  assert.match(
    settingsPreviewSource,
    /label="Description"[\s\S]*?multiline[\s\S]*?label="Preferences description"[\s\S]*?multiline[\s\S]*?border-t/,
    'the two long copy fields must share one responsive row before compact labels',
  );
  for (const glyph of ['Square', 'CornerUpLeft', 'Circle', 'ChevronsExpandToLines', 'ArrowsExpandHorizontal', 'Layers3', 'Type', 'TextCursorInput', 'Frames']) {
    assert.match(settingsPreviewSource, new RegExp(`glyph=\\{${glyph}\\}`), `Appearance must use the ${glyph} semantic glyph`);
  }
  assert.match(settingsControlsSource, /glyph: Glyph[\s\S]*?Glyph \? <Glyph/, 'shared Settings controls must render custom semantic glyphs');
  assert.match(settingsPreviewSource, /issueCounts[\s\S]*?issueCount > 0/, 'validation must badge the affected section');
  assert.match(settingsPreviewSource, /Dados obrigatórios pendentes/, 'validation must flag the affected inventory item');
  assert.match(settingsPreviewSource, /fieldError\('cookies', 'purpose'/, 'validation must flag the exact affected field');
  assert.match(settingsPreviewSource, /selectedCookieIsManaged[\s\S]*?Managed by Kodety/, 'runtime-managed consent cookies must remain documented and non-removable');
  assert.match(
    settingsPreviewSource,
    /activationLocked[\s\S]*?data-kodety-cookie-consent-pro-gate[\s\S]*?>PRO<[\s\S]*?Somente usuários Pro/,
    'unlicensed users must see a clear Pro gate on activation while the editor remains available',
  );
  assert.match(
    projectSettingsSource,
    /cookieConsentActivationLocked\s*=\s*licenseInactive\s*\|\|\s*productFeatures\.cookieConsent\s*===\s*false[\s\S]*?activationLocked=\{cookieConsentActivationLocked\}/,
    'the activation gate must use the WordPress license entitlement',
  );
  assert.equal(JSON.parse(editionSource).features.cookieConsent, 'licensed', 'Cookie Consent must be a stable Pro entitlement in the shared policy');
  assert.match(
    pluginSource,
    /Kodety_Edition::assert_cookie_consent_activation\(\$html_files\)[\s\S]*?Kodety_Edition::assert_project_collection_connections/,
    'every extracted release must enforce the Cookie Consent entitlement before activation',
  );
  assert.match(
    pluginSource,
    /catch \(Throwable \$error\)[\s\S]*?instanceof Kodety_Pro_Feature_Exception[\s\S]*?'status'\s*=>\s*403[\s\S]*?'kodety_publish_failed'/,
    'the Pro gate must return a terminal 403 before the transient 503 publish retry path',
  );
  assert.match(
    projectIoSource,
    /projectToMaterializedPublishOverlayPackage[\s\S]*?MATERIALIZED_PUBLISH_OVERLAY_PATH/,
    'WordPress materialized publishing must expose the bounded overlay package',
  );

  console.log('Cookie Consent defaults, validation, overlay publishing, compiler, gating and Preview tests passed.');
} finally {
  await server.close();
}
