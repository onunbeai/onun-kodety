import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': root } },
});

try {
  const io = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const interactions = await server.ssrLoadModule('/lib/html-editor/interactions.ts');
  const code = await server.ssrLoadModule('/lib/html-editor/code-components.ts');
  const cookies = await server.ssrLoadModule('/lib/html-editor/cookie-consent.ts');
  const custom = await server.ssrLoadModule('/lib/html-editor/custom-code.ts');
  const coded = await server.ssrLoadModule('/lib/html-editor/coded-project.ts');
  const editorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );

  // Execute the Publish button's actual decision. Testing the compiler alone
  // missed this regression: it worked, but Publish never called it for motion.
  const decisionStart = editorSource.indexOf('const releaseMetadata = readEditorMetadata(current);');
  const decisionEnd = editorSource.indexOf('const materializedBuildLabel =', decisionStart);
  assert.ok(decisionStart >= 0 && decisionEnd > decisionStart);
  const selectPublishMode = new Function(
    'current',
    'config',
    'publishSnapshotMode',
    'readEditorMetadata',
    'normalizeCodeComponentRegistry',
    'normalizeCookieConsentSettings',
    'normalizeCustomCodeSettings',
    'projectHasNativeInteractions',
    'projectHasGoogleFonts',
    'projectRequiresCodedBuild',
    'projectNeedsResponsiveViewportNormalization',
    'projectNeedsManagedVariantFaviconSync',
    `${editorSource.slice(decisionStart, decisionEnd)}\nreturn requiresMaterializedPublish;`,
  );
  const requiresMaterialization = project => selectPublishMode(
    project,
    { projectId: '' },
    false,
    io.readEditorMetadata,
    code.normalizeCodeComponentRegistry,
    cookies.normalizeCookieConsentSettings,
    custom.normalizeCustomCodeSettings,
    interactions.projectHasNativeInteractions,
    io.projectHasGoogleFonts,
    coded.projectRequiresCodedBuild,
    io.projectNeedsResponsiveViewportNormalization,
    io.projectNeedsManagedVariantFaviconSync,
  );
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Motion publication</title></head><body>'
    + '<h1 data-kodety-interaction-id="title">Title</h1></body></html>';
  const file = (path, text, mimeType = 'text/html') => ({ path, text, mimeType });
  const baseProject = {
    name: 'Motion publication',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': file('index.html', html),
      'pages/about.html': file('pages/about.html', html),
      'assets/unchanged.svg': file('assets/unchanged.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'),
    },
  };
  const definition = trigger => ({
    id: `title-${trigger}`,
    name: `Title ${trigger}`,
    trigger,
    triggerSelector: '[data-kodety-interaction-id="title"]',
    actions: [{
      ...interactions.createInteractionAction(),
      id: `fade-${trigger}`,
      from: { opacity: 0, y: 24 },
      to: { opacity: 1, y: 0 },
      duration: 0.2,
    }],
  });
  const withDocument = (project, page, definitions, companionPath = interactions.interactionDocumentPath(page)) => ({
    ...project,
    files: {
      ...project.files,
      [companionPath]: file(companionPath, interactions.serializeInteractionDocument({
        version: 2,
        canonical: true,
        interactions: definitions,
      }), 'application/json'),
    },
  });

  assert.equal(requiresMaterialization(baseProject), false, 'ordinary static sites retain the saved-workspace path');
  const viteSourceProject = {
    ...baseProject,
    files: {
      ...baseProject.files,
      'index.html': file(
        'index.html',
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vite</title></head><body><main id="app">OLD</main><script type="module" src="./src/main.js"></script></body></html>',
      ),
      'src/main.js': file(
        'src/main.js',
        'import "./style.css"; document.querySelector("#app").textContent = "NEW";',
        'text/javascript',
      ),
      'src/style.css': file('src/style.css', '#app { display: block; }', 'text/css'),
      'vite.config.js': file('vite.config.js', 'export default { base: "./" };', 'text/javascript'),
    },
  };
  assert.equal(coded.projectRequiresCodedBuild(viteSourceProject), true);
  assert.equal(
    requiresMaterialization(viteSourceProject),
    true,
    'a ZIP-fallback Vite workspace must enter the release compiler instead of publishing raw source with old HTML',
  );
  const viteRelease = io.prepareProjectForTransport(viteSourceProject);
  assert.ok(viteRelease.files['kodety-build/src/main.js']);
  assert.match(viteRelease.files['index.html'].text, /kodety-build\/src\/main\.js/);
  assert.equal(
    requiresMaterialization(io.updateEditorMetadata(baseProject, metadata => ({
      ...metadata,
      membership: { version: 1, enabled: true, gates: {}, pages: {} },
    }))),
    true,
    'an enabled Membership contract must select the release compiler',
  );
  assert.equal(
    requiresMaterialization(io.updateEditorMetadata(baseProject, metadata => ({
      ...metadata,
      membership: { version: 1, enabled: false, gates: {}, pages: {} },
    }))),
    true,
    'a disabled Membership contract must still reach fail-closed validation',
  );
  assert.equal(
    requiresMaterialization({
      ...baseProject,
      files: {
        ...baseProject.files,
        'index.html': file('index.html', '<!doctype html><html><head></head><body>Legacy mobile page</body></html>'),
      },
    }),
    true,
    'a static page without a responsive viewport must select materialized publication',
  );

  const triggers = ['load', 'scroll', 'hover', 'click', 'mouse-move', 'custom', 'appear', 'mouse-enter', 'mouse-leave', 'click-start'];
  for (const trigger of triggers) {
    const project = withDocument(baseProject, 'index.html', [definition(trigger)]);
    assert.equal(
      requiresMaterialization(project),
      true,
      `${trigger} animation must select materialized publication without Code Components or Cookie Consent`,
    );
    const release = io.prepareProjectForTransport(project);
    assert.match(release.files['index.html'].text, /data-kodety-interactions-runtime/);
    assert.match(release.files['index.html'].text, /data-kodety-interactions-engine="motion"/);
    assert.equal(interactions.readInteractionDocument(release.files['index.html'].text).interactions[0].trigger, trigger);
    if (trigger === 'scroll') {
      assert.match(release.files['index.html'].text, /data-kodety-interactions-engine="onun-motion"/);
    }
  }

  const internalPage = withDocument(baseProject, 'pages/about.html', [definition('scroll')]);
  assert.equal(requiresMaterialization(internalPage), true, 'motion on an unopened internal page must still be published');
  const legacyCompanion = withDocument(
    baseProject,
    'pages/about.html',
    [definition('hover')],
    interactions.legacyInteractionDocumentPath('pages/about.html'),
  );
  assert.equal(requiresMaterialization(legacyCompanion), true, 'legacy companion names need the same compiler');

  const masterPath = '.incode/components/card/default.html';
  const componentProject = withDocument({
    ...baseProject,
    files: { ...baseProject.files, [masterPath]: file(masterPath, html) },
  }, masterPath, [definition('hover')]);
  assert.equal(requiresMaterialization(componentProject), true, 'component-master motion must not depend on page interactions');
  assert.equal(requiresMaterialization({ ...componentProject, mainHtmlPath: masterPath }), true, 'publishing from the component editor must retain motion');

  const experimentPath = '.incode/experiments/home/variant/index.html';
  const experimentProject = withDocument({
    ...baseProject,
    files: { ...baseProject.files, [experimentPath]: file(experimentPath, html) },
  }, experimentPath, [definition('load')]);
  assert.equal(requiresMaterialization(experimentProject), true, 'private experiment pages also require their runtime');

  const embeddedProject = {
    ...baseProject,
    files: {
      ...baseProject.files,
      'index.html': file('index.html', interactions.patchInteractionDocument(html, {
        version: 2,
        interactions: [definition('load')],
      })),
    },
  };
  assert.equal(requiresMaterialization(embeddedProject), true, 'legacy embedded motion must be regenerated through the same compiler');
  assert.equal(requiresMaterialization(withDocument(baseProject, 'index.html', [])), false, 'empty canonical documents keep the static fast path');
  assert.equal(requiresMaterialization(withDocument(baseProject, 'missing.html', [definition('load')])), false, 'orphan documents do not create a runtime for absent pages');
  assert.equal(requiresMaterialization(withDocument(baseProject, 'index.html', [{ ...definition('hover'), enabled: false }])), true, 'disabled definitions still use the canonical compiler output');

  const allMotion = withDocument(internalPage, 'index.html', [definition('load'), definition('hover')]);
  const original = JSON.stringify(allMotion);
  for (const enabled of [false, true]) {
    const project = io.updateEditorMetadata(allMotion, metadata => ({ ...metadata, cookieConsent: { enabled } }));
    assert.equal(requiresMaterialization(project), true, 'Cookie Consent must not determine whether motion is published');
  }
  assert.equal(requiresMaterialization(io.updateEditorMetadata(baseProject, metadata => ({
    ...metadata,
    cookieConsent: { enabled: true },
  }))), true, 'existing privacy compilation remains enabled');

  const draft = io.prepareProjectForDraftTransport(allMotion);
  assert.doesNotMatch(draft.files['index.html'].text, /data-kodety-interactions-runtime/);
  assert.ok(draft.files[interactions.interactionDocumentPath('index.html')]);
  const compiled = io.prepareProjectForTransport(allMotion);
  const full = await io.projectToPublishPackage(allMotion);
  const overlay = await io.projectToMaterializedPublishOverlayPackage(allMotion);
  const fullZip = await JSZip.loadAsync(await full.zip.arrayBuffer());
  const overlayZip = await JSZip.loadAsync(await overlay.zip.arrayBuffer());
  const manifest = JSON.parse(await overlayZip.file('.incode/publish-overlay.json').async('string'));
  for (const page of ['index.html', 'pages/about.html']) {
    const expected = compiled.files[page].text;
    assert.equal(await fullZip.file(page).async('string'), expected, 'compatibility ZIP must include the exact compiled page');
    assert.equal(await overlayZip.file(page).async('string'), expected, 'release overlay must include the exact compiled page');
    const entry = manifest.upserts.find(entry => entry.path === page);
    assert.ok(entry, 'the backend must receive the animated page in the overlay manifest');
    assert.equal(entry.byteLength, Buffer.byteLength(expected));
    assert.equal(entry.sha256, createHash('sha256').update(expected).digest('hex'));
    assert.deepEqual(
      interactions.readInteractionDocument(expected).interactions,
      interactions.readInteractionDocumentFile(allMotion, page).interactions,
      'publication must preserve the exact normalized motion definitions consumed by Preview',
    );
    for (const script of expected.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      assert.doesNotThrow(() => new Function(script[1]), 'published animation scripts must be valid JavaScript');
    }
  }
  assert.equal(full.cssDigest, overlay.cssDigest, 'both publication transports must confirm the same compiled digest');
  assert.equal(overlayZip.file('assets/unchanged.svg'), null, 'motion publication must not re-upload unchanged media');
  assert.equal(overlayZip.file(interactions.interactionDocumentPath('index.html')), null, 'unchanged source documents stay in the acknowledged workspace');
  assert.equal(JSON.stringify(allMotion), original, 'publication must never mutate editable motion or source HTML');

  // A selected family used to live only in the parent font store. The canvas
  // loaded it, but static Publish bypassed compilation and sent no stylesheet.
  const fontRuntime = await server.ssrLoadModule('/lib/html-editor/google-fonts.ts');
  const fontUtils = await server.ssrLoadModule('/lib/font-utils.ts');
  const google = (family, overrides = {}) => ({
    id: `google-${family}`, name: family.toLowerCase().replaceAll(' ', '-'), family,
    type: 'google', variants: ['regular'], weights: ['400'], category: 'serif',
    ...overrides,
  });
  const fontCatalog = [
    google('Adamina'),
    google('Advent Pro', {
      category: 'sans-serif', variants: ['regular', 'italic', '700', '700italic'], weights: ['400', '700'],
      axes: [{ tag: 'wght', start: 100, end: 900 }],
    }),
    google('Abril Fatface'),
    google('Unbounded'),
  ];
  const fontSource = {
    ...baseProject,
    files: {
      ...baseProject.files,
      'pages/about.html': file('pages/about.html', html.replace('</head>', '<link rel="stylesheet" href="../styles/type.css"></head>')),
      'styles/type.css': file('styles/type.css', 'input{font-family:"Adamina",serif}.title{font-family:"Advent Pro";font-weight:375;font-style:italic}', 'text/css'),
      [masterPath]: file(masterPath, '<p class="font-[Abril_Fatface]">Card</p>'),
    },
  };
  const fontOriginal = JSON.stringify(fontSource);
  assert.equal(io.rememberProjectGoogleFonts(baseProject, fontCatalog), baseProject, 'installing a font without using it must not dirty a project');
  const remembered = io.rememberProjectGoogleFonts(fontSource, fontCatalog);
  assert.deepEqual(io.readEditorMetadata(remembered).googleFonts.map(font => font.family), ['Adamina', 'Advent Pro', 'Abril Fatface']);
  assert.doesNotMatch(JSON.stringify(io.readEditorMetadata(remembered).googleFonts), /created_at|storage_path|is_published|"id":/, 'the project stores portable definitions, not browser/account state');
  assert.equal(io.rememberProjectGoogleFonts(remembered, fontCatalog), remembered, 'font tracking must not generate redundant edits/autosaves');
  for (const [path, originalFile] of Object.entries(fontSource.files)) {
    assert.equal(remembered.files[path], originalFile, 'remembering a dependency leaves authored HTML/CSS and canvas identity intact');
  }
  assert.equal(JSON.stringify(fontSource), fontOriginal);
  assert.equal(requiresMaterialization(remembered), true, 'font-only sites must not use the raw-workspace publish path');
  assert.equal(io.projectHasGoogleFonts(remembered), true, 'publication must work with an empty browser font library');
  const fontDraft = io.prepareProjectForDraftTransport(remembered);
  assert.doesNotMatch(fontDraft.files['index.html'].text, /data-kodety-google-font/, 'generated links stay out of the editable draft');
  assert.equal(io.readEditorMetadata(fontDraft).googleFonts.length, 3, 'draft persistence must carry fonts across browsers');

  const fontFull = await io.projectToPublishPackage(fontDraft);
  const fontOverlay = await io.projectToMaterializedPublishOverlayPackage(fontDraft);
  const fontZip = await JSZip.loadAsync(await fontFull.zip.arrayBuffer());
  const fontOverlayZip = await JSZip.loadAsync(await fontOverlay.zip.arrayBuffer());
  const fontManifest = JSON.parse(await fontOverlayZip.file('.incode/publish-overlay.json').async('string'));
  for (const page of ['index.html', 'pages/about.html', masterPath]) {
    const published = await fontZip.file(page).async('string');
    assert.equal(await fontOverlayZip.file(page).async('string'), published, 'full publish/hosted preview/export and overlay must receive identical font resources');
    assert.match(published, /<head>[\s\S]*<link rel="stylesheet" data-kodety-google-font href="https:\/\/fonts\.googleapis\.com\/css2\?family=Adamina:wght@400&amp;display=swap">[\s\S]*<\/head>/);
    assert.match(published, /family=Advent\+Pro:ital,wght@0,100\.\.900;1,100\.\.900/);
    assert.match(published, /font-family: "Abril Fatface"/);
    assert.doesNotMatch(published, /family=Unbounded|data-html-editor-deferred-google-font|media="print"/);
    const upsert = fontManifest.upserts.find(entry => entry.path === page);
    assert.equal(upsert.sha256, createHash('sha256').update(published).digest('hex'));
    assert.equal(upsert.byteLength, Buffer.byteLength(published));
    assert.equal(fontRuntime.injectProjectGoogleFonts(published, io.projectGoogleFonts(remembered)), published, 'font materialization must be byte-idempotent');
  }
  assert.equal(fontFull.cssDigest, fontOverlay.cssDigest, 'font links and class rules participate in the confirmed publication digest');
  assert.equal(fontOverlayZip.file('assets/unchanged.svg'), null);
  assert.equal(fontOverlayZip.file('styles/type.css'), null, 'font materialization must preserve authored stylesheet bytes');
  const reopenedMetadata = JSON.parse(await fontZip.file('.incode/project.json').async('string'));
  assert.equal(reopenedMetadata.googleFonts.length, 3, 'the portable archive retains the source definitions');

  const adaminaFonts = fontRuntime.normalizeProjectGoogleFonts([fontCatalog[0]]);
  const authoredLink = `<link rel="stylesheet" href="${fontUtils.buildGoogleFontUrl(fontCatalog[0])}">`;
  const authoredHead = html.replace('</head>', `${authoredLink}</head>`);
  const deduplicated = fontRuntime.injectProjectGoogleFonts(authoredHead, adaminaFonts);
  assert.equal((deduplicated.match(/fonts\.googleapis\.com/g) || []).length, 1, 'already-active authored font URLs are not duplicated');
  assert.ok(deduplicated.includes(authoredLink), 'authored tags are kept byte-for-byte');
  const deferred = fontRuntime.injectProjectGoogleFonts(authoredHead.replace('rel="stylesheet"', 'media="print" rel="stylesheet"'), adaminaFonts);
  assert.match(deferred, /<link rel="stylesheet" data-kodety-google-font/, 'a print-only authored sheet cannot satisfy a screen font dependency');
  for (const input of [html, '<!doctype html><html><body>Hello</body></html>', '<p>Hello</p>', '<html><head><title>Hello</title><body>Hello</body></html>']) {
    const output = fontRuntime.injectProjectGoogleFonts(input, adaminaFonts);
    assert.equal(fontRuntime.injectProjectGoogleFonts(output, adaminaFonts), output, 'implied and missing head tags must also be idempotent');
  }
  assert.equal(fontRuntime.injectProjectGoogleFonts(fontRuntime.injectProjectGoogleFonts(html, adaminaFonts), []), html, 'removing generated font dependencies must restore the original HTML');
  assert.deepEqual(fontRuntime.normalizeProjectGoogleFonts([{ family: '</style><script>alert(1)</script>' }, { family: 'Adamina', type: 'custom' }]), []);
  assert.match(fontUtils.buildGoogleFontUrl(google('A&B')), /family=A%26B:/, 'family names must not inject CSS API query parameters');
  const local = {
    ...remembered,
    files: {
      'index.html': file('index.html', '<style>@font-face{font-family:"Adamina";src:url("fonts/adamina.woff2")}p{font-family:"Adamina"}</style><p>Local</p>'),
      'fonts/adamina.woff2': { path: 'fonts/adamina.woff2', mimeType: 'font/woff2', data: new Uint8Array([1, 2, 3]) },
    },
  };
  assert.equal(io.rememberProjectGoogleFonts(local, fontCatalog), local, 'an imported local face must not be replaced by an account Google font of the same family');
  assert.match(editorSource, /rememberProjectGoogleFonts\(projectRef.current, useFontsStore.getState\(\)\.fonts\)[\s\S]*?const publishSnapshot = projectRef.current;[\s\S]*?persistExactWordPressDraft\(current/, 'older browser-local choices must be captured before the exact draft is acknowledged');
  const commitSource = editorSource.slice(editorSource.indexOf('const commitProject = useCallback('), editorSource.indexOf('const designTokens = useMemo('));
  assert.match(commitSource, /if \(!projectPageNavigation\)[\s\S]*?rememberProjectGoogleFonts[\s\S]*?useFontsStore.getState\(\)\.fonts/, 'actual font edits persist their dependency without changing read-only navigation');

  console.log(`animation-publication: ok (${triggers.length} triggers, internal pages, component masters, experiments, legacy, full ZIP and overlay)`);
  console.log('google-font-publication: ok (portable choices, static/variable fonts, form CSS, internal pages, components, active links, local faces, full ZIP and overlay parity)');
} finally {
  await server.close();
}
