import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const transitions = await server.ssrLoadModule('/lib/html-editor/page-transitions.ts');
  const transitionRuntime = await server.ssrLoadModule('/lib/html-editor/page-transitions-runtime.ts');
  const projectIo = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const pageRename = await server.ssrLoadModule('/lib/html-editor/page-rename.ts');
  const codedProject = await server.ssrLoadModule('/lib/html-editor/coded-project.ts');
  const previewNavigation = await server.ssrLoadModule('/lib/html-editor/preview-navigation.ts');
  const previewRuntime = await server.ssrLoadModule('/lib/html-editor/preview.ts');
  const inspectorSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
    'utf8',
  );
  const panelSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlPageTransitionsPanel.tsx'),
    'utf8',
  );
  const globalStyles = await fs.readFile(path.join(root, 'app/globals.css'), 'utf8');
  const editorSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  const navigatorSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlNavigator.tsx'),
    'utf8',
  );
  const leftSidebarSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorLeftSidebar.tsx'),
    'utf8',
  );
  const previewHookSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/hooks/use-page-transition-preview.ts'),
    'utf8',
  );
  const bufferedIframeSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx'),
    'utf8',
  );
  const canvasStageSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
    'utf8',
  );
  const previewSource = await fs.readFile(
    path.join(root, 'lib/html-editor/preview.ts'),
    'utf8',
  );
  const previewTransitionStylesSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/hooks/page-transition-preview-styles.ts'),
    'utf8',
  );

  assert.match(inspectorSource, /data-kodety-i18n-root[\s\S]*?>Style<[\s\S]*?>Settings<[\s\S]*?>Interactions</);
  assert.match(inspectorSource, /kodety-page-transition-tabs[\s\S]*?h-full w-full[\s\S]*?h-full w-full/);
  assert.match(panelSource, /data-page-transitions-panel data-kodety-i18n-root/);
  assert.match(panelSource, /<span data-kodety-no-i18n>\{page.label\}<\/span>/);
  assert.match(panelSource, /grid h-9 w-full grid-cols-2 items-stretch/);
  assert.match(globalStyles, /kodety-page-transition-tabs[\s\S]*?width: 100% !important/);
  assert.doesNotMatch(panelSource, /(?:transição|página|animação|duração|configurá-la|regra específica)/i);
  assert.match(editorSource, /pageTransitionMotionForNavigation\([\s\S]*?beginPreviewPageTransition/);
  assert.match(editorSource, /canonicalCandidates = publicCandidates\.map\([\s\S]*?projectPublicFilePath/);
  assert.match(editorSource, /promotePreviewPageTransition\(\)/);
  assert.match(editorSource, /runtimePreviewSurfaceStyle=\{previewPageTransitionStyle\}/);
  assert.match(
    editorSource,
    /const sequence = pageNavigationSequenceRef\.current \+ 1;[\s\S]*?pendingPagePathRef\.current = path;[\s\S]*?setPendingPagePath\(path\)[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?window\.setTimeout\((?:async )?\(\) => \{[\s\S]*?pageNavigationSequenceRef\.current !== sequence[\s\S]*?pendingPagePathRef\.current !== path[\s\S]*?commitPage\(\)/,
    'page clicks must paint their optimistic selection before starting the expensive canvas rebuild',
  );
  assert.match(
    editorSource,
    /setPendingPagePath\(path\);[\s\S]*?toast\.info\('Carregando assets e layout', \{[\s\S]*?id: 'kodety-page-assets-loading'[\s\S]*?duration: 3_000[\s\S]*?\}\);[\s\S]*?iframeRef\.current\?\.blur\(\);/,
    'page switches must show a three-second informational toast without replacing the existing loader',
  );
  assert.match(
    editorSource,
    /visualActivePage: pendingPagePath \?\? project\.mainHtmlPath/,
    'the Navigator must expose the clicked page immediately while the canonical canvas is pending',
  );
  assert.match(editorSource, /data-kodety-page-navigation-pending=\{pendingPagePath\}/);
  assert.match(
    editorSource,
    /const switchCanvasLocale = useCallback\([\s\S]*?setPendingLocaleCode\(code\)[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?window\.setTimeout\((?:async )?\(\) => \{[\s\S]*?pendingLocaleCodeRef\.current !== code[\s\S]*?materializeCanonicalCanvas\(\);[\s\S]*?setActiveLocale\(code\)/,
    'locale switches must paint the shared canvas loader before rebuilding the translated document',
  );
  assert.match(
    editorSource,
    /\{\(pendingPagePath \|\| pendingLocaleCode\) && !isPreviewing && \([\s\S]*?data-kodety-page-navigation-pending=\{pendingPagePath\}[\s\S]*?data-kodety-locale-navigation-pending=\{pendingLocaleCode\}/,
    'page and locale changes must share the same blocking canvas feedback surface',
  );
  assert.match(
    editorSource,
    /acceptEditorVisualReady[\s\S]*?surfaceKey !== editorCanvasSemanticSurfaceKey[\s\S]*?clearPendingPageNavigation\(currentProject\.mainHtmlPath\);[\s\S]*?clearPendingLocaleNavigation\(resolvedActiveLocale\)/,
    'optimistic page and locale feedback must stay visible until the matching canvas generation is visually ready',
  );
  assert.match(
    navigatorSource,
    /localeFlagAssetUrl[\s\S]*?function NavigatorLocaleFlag[\s\S]*?data-kodety-locale-flag=\{locale\.code\}[\s\S]*?<img[\s\S]*?src=\{assetUrl\}/,
    'the locale picker must render committed flag assets instead of locale-code badges',
  );
  const localePickerStart = navigatorSource.indexOf('{locales.filter((locale) => locale.enabled).length > 1 && (');
  const localePickerEnd = navigatorSource.indexOf('<TabsContent', localePickerStart);
  const localePickerSource = navigatorSource.slice(localePickerStart, localePickerEnd);
  assert.match(
    localePickerSource,
    /<NavigatorLocaleFlag locale=\{activeLocaleDefinition\}[\s\S]*?\.map\(\(locale\) => \([\s\S]*?<NavigatorLocaleFlag locale=\{locale\}/,
    'the active locale and every menu choice must use their corresponding compact flag',
  );
  assert.doesNotMatch(
    localePickerSource,
    /activeLocale === sourceLocale \? 'Base' : activeLocale|\{locale\.language\}/,
    'locale codes must not return as redundant badges beside full language names',
  );
  assert.match(
    navigatorSource,
    /const displayedActivePage = visualActivePage \|\| activePage;[\s\S]*?<HtmlLayersTree[\s\S]*?key=\{activePage\}/,
    'optimistic page feedback must never retarget layer actions before the canonical project switches',
  );
  const workspaceNavigationStart = editorSource.indexOf("  type WorkspacePrimaryArea = 'design'");
  const workspaceNavigationEnd = editorSource.indexOf('  const workspaceBackupAction', workspaceNavigationStart);
  const workspaceNavigationSource = workspaceNavigationStart >= 0 && workspaceNavigationEnd > workspaceNavigationStart
    ? editorSource.slice(workspaceNavigationStart, workspaceNavigationEnd)
    : '';
  assert.ok(workspaceNavigationSource, 'missing primary workspace navigation');
  assert.match(
    workspaceNavigationSource,
    /<a[\s\S]*?href=\{topbarWp\?\.editorUrl \|\| '\/kodety\/editor\/'\}[\s\S]*?data-kodety-workspace-navigation="native"[\s\S]*?<span>Design<\/span>[\s\S]*?href=\{topbarWp\?\.cmsUrl \|\| '\/kodety\/cms\/'\}[\s\S]*?<span>CMS<\/span>[\s\S]*?href=\{topbarWp\?\.analyticsUrl \|\| '\/kodety\/analytics\/'\}[\s\S]*?<span>Insights<\/span>/,
    'Design, CMS and Insights must be native anchors with real href destinations',
  );
  assert.doesNotMatch(
    workspaceNavigationSource,
    /navigateAfterWordPressSave|openWorkspacePrimaryArea/,
    'native WordPress navigation must not wait for host persistence',
  );
  assert.equal(workspaceNavigationSource.match(/onClick=\{workspace \?[^\n]+: undefined\}/g)?.length, 3, 'Only the standalone HTML host may intercept workspace navigation; WordPress retains native anchors');
  assert.match(
    editorSource,
    /const persistBeforeAnchorNavigation[\s\S]*?anchor\.hasAttribute\('data-kodety-workspace-navigation'\)[\s\S]*?wordpressNativeNavigationStartedAtRef\.current = Date\.now\(\);[\s\S]*?return;[\s\S]*?event\.preventDefault\(\)/,
    'the document-level save interceptor must bypass native workspace anchors before preventDefault',
  );
  assert.match(
    editorSource,
    /\.catch\(error => \{[\s\S]*?Date\.now\(\) - wordpressNativeNavigationStartedAtRef\.current < 10_000;[\s\S]*?if \(!cancelled && !nativeWorkspaceNavigationInProgress\)[\s\S]*?toast\.error\('Não foi possível abrir o site'/,
    'a browser-cancelled source request during native workspace navigation must not emit a false site-open error',
  );
  const suppressionStart = editorSource.indexOf('const nativeWorkspaceNavigationInProgress =');
  const suppressionEnd = editorSource.indexOf('.finally(', suppressionStart);
  assert.ok(suppressionStart >= 0 && suppressionEnd > suppressionStart);
  assert.doesNotMatch(
    editorSource.slice(suppressionStart, suppressionEnd),
    /\.abort\(\)/,
    'false-error suppression must never abort the loader; effect cleanup can cancel an obsolete request',
  );
  assert.match(
    leftSidebarSource,
    /href=\{topbarWp\?\.localizationUrl \|\| "#localization"\}[\s\S]*?onClick=\{onOpenLocalization \?[\s\S]*?: undefined\}[\s\S]*?data-kodety-workspace-navigation="native"[\s\S]*?data-tooltip="Languages"/,
    'Languages must keep a native href unless the standalone HTML host supplies its local handler',
  );
  assert.match(
    navigatorSource,
    /href=\{localizationUrl\}[\s\S]*?data-kodety-workspace-navigation="native"[\s\S]*?>[\s\S]*?<Settings2 \/> Gerenciar traduções/,
    'the localization menu action must always follow its native href',
  );
  assert.match(
    previewSource,
    /const selectElement = \(el, additive, origin = 'canvas'\)[\s\S]*?type: 'html-editor-selection'[\s\S]*?origin[\s\S]*?selectElement\(el, Boolean\(event\.data\.additive\), 'editor'\)/,
    'selection messages must identify direct canvas gestures without confusing editor-driven selection sync',
  );
  assert.match(
    editorSource,
    /message\.detail === 'identity'[\s\S]*?message\.origin === 'canvas'[\s\S]*?setActivePanel\('layers'\)/,
    'a direct canvas selection must reveal its selected element in the Layers tab',
  );
  assert.match(
    editorSource,
    /const projectFilesIdentity = project\?\.files;[\s\S]*?const htmlPages = useMemo\([\s\S]*?\[projectFilesIdentity\][\s\S]*?const projectFiles = useMemo\([\s\S]*?experimentEditSession\?\.variantPrefix, projectFilesIdentity/,
    'route-only navigation must preserve project-wide page and file projections when authored files are unchanged',
  );
  assert.match(
    editorSource,
    /const assets = useMemo\([\s\S]*?\(\) => projectFiles[\s\S]*?\[projectFiles\]/,
    'asset options must derive from the shared visible-file projection instead of rebuilding and copying it again',
  );
  assert.match(
    editorSource,
    /const persistentContentUnchanged = Boolean\([\s\S]*?previousContent\.files === project\.files[\s\S]*?if \(persistentContentUnchanged\) \{[\s\S]*?if \(pendingLocalSnapshotRef\.current\) pendingLocalSnapshotRef\.current = project;[\s\S]*?return;/,
    'route-only navigation must not start or restart a complete IndexedDB project snapshot',
  );
  assert.match(
    bufferedIframeSource,
    /progressiveSemanticNavigation[\s\S]*?semanticNavigation[\s\S]*?markDocumentPaintReady\(document\.mountKey\)/,
    'buffered navigation must expose an explicit progressive handoff instead of weakening the default gate',
  );
  const pageDesignStart = canvasStageSource.indexOf('data-page-editor-canvas-surface');
  const componentDesignStart = canvasStageSource.indexOf('data-component-editor-canvas-surface');
  const runtimePreviewStart = canvasStageSource.indexOf('data-runtime-preview-surface');
  assert.ok(
    pageDesignStart >= 0 && componentDesignStart > pageDesignStart && runtimePreviewStart > componentDesignStart,
    'missing isolated canvas surface boundaries',
  );
  const pageDesignSource = canvasStageSource.slice(pageDesignStart, componentDesignStart);
  const componentDesignSource = canvasStageSource.slice(componentDesignStart, runtimePreviewStart);
  const runtimePreviewSource = canvasStageSource.slice(runtimePreviewStart);
  assert.match(
    canvasStageSource,
    /const localizedDesignCanvas = resolvedActiveLocale !== localizationSourceLocale;/,
    'the progressive lifecycle must be derived from a non-source Design locale',
  );
  assert.match(
    pageDesignSource,
    /retainDocument=\{!localizedDesignCanvas\}[\s\S]*?pinRetainedDocument=\{!localizedDesignCanvas\}[\s\S]*?progressiveSemanticNavigation=\{localizedDesignCanvas\}/,
    'localized page Design must promote progressively while refusing retained locale canvases',
  );
  assert.doesNotMatch(
    `${componentDesignSource}\n${runtimePreviewSource}`,
    /progressiveSemanticNavigation/,
    'component Design and runtime Preview must retain the strong visual-ready contract',
  );
  assert.match(
    bufferedIframeSource,
    /function isBufferedDocumentPaintReadyMessage\(data: unknown\)[\s\S]*?return type === 'html-editor-buffer-visuals-ready';/,
    'the default buffered path must still use only the visual-ready bridge signal',
  );
  assert.match(
    bufferedIframeSource,
    /!isBufferedDocumentPaintReadyMessage\(event\.data\)[\s\S]*?return;[\s\S]*?markDocumentPaintReady\(document\.mountKey\);[\s\S]*?schedulePromotion\(\);/,
    'buffer promotion must remain behind the strong visual-ready signal',
  );
  const pendingLoadStart = bufferedIframeSource.indexOf('  const handlePendingLoad = useCallback');
  const pendingLoadEnd = bufferedIframeSource.indexOf('  const retainedDocuments =', pendingLoadStart);
  const pendingLoadSource = pendingLoadStart >= 0 && pendingLoadEnd > pendingLoadStart
    ? bufferedIframeSource.slice(pendingLoadStart, pendingLoadEnd)
    : '';
  assert.ok(pendingLoadSource, 'missing buffered load callback');
  assert.match(pendingLoadSource, /onBufferedLoad\?\./);
  assert.doesNotMatch(
    pendingLoadSource,
    /schedulePromotion|promotePendingDocument|setTimeout/,
    'iframe load may mark an opted-in locale ready but must not promote directly or arm a timeout',
  );
  assert.match(
    canvasStageSource,
    /data-page-editor-canvas-surface[\s\S]*?onBufferedLoad=\{\(event, bufferedGeneration\)[\s\S]*?sendRuntimeAssetsToFrame\(event\.currentTarget\.contentWindow, 'fonts', bufferedGeneration\)/,
    'semantic Design navigation must transfer fonts while visual readiness remains pending',
  );
  assert.match(
    canvasStageSource,
    /data-runtime-preview-surface[\s\S]*?onBufferedLoad=\{\(event, bufferedGeneration, _revision, _surfaceKey, semanticNavigation\)[\s\S]*?semanticNavigation \? 'fonts' : 'all'/,
    'semantic Preview navigation transfers fonts and a same-surface refresh transfers all assets',
  );
  assert.match(
    previewSource,
    /interface AnnotationSummary[\s\S]*?const childSummaries =[\s\S]*?childSummaries\.some\(summary => summary\.hasTextOrBreak\)[\s\S]*?childSummaries\.every\(summary => summary\.allInlineText\)[\s\S]*?data-html-editor-rich-text/,
    'preview annotation must classify rich text bottom-up in one tree walk',
  );
  assert.doesNotMatch(
    previewSource,
    /const isRichTextHost[\s\S]{0,500}querySelectorAll\('\*'\)/,
    'page preview construction must not rescan every descendant for each rich-text host',
  );
  assert.match(
    previewSource,
    /projectInstalledFontReferenceCache[\s\S]*?get\(project\.files\)[\s\S]*?cached\?\.installedFonts === installedFonts[\s\S]*?projectReferencedInstalledFonts\(project, installedFonts\)[\s\S]*?fontsReferencedBySources\(installedFonts, \[source\]\)/,
    'route-only preview builds must reuse project-wide font reference discovery and scan only the active page HTML',
  );
  assert.match(
    previewSource,
    /runtimeAssetAvailablePathCache[\s\S]*?get\(project\.files\)[\s\S]*?roots\.set\(root, paths\)[\s\S]*?return \[\.\.\.cachedRuntimeAssetAvailablePaths\(project\)\][\s\S]*?availableRuntimeAssetPaths = componentEditorCanvas[\s\S]*?: cachedRuntimeAssetAvailablePaths\(project\)/,
    'page previews must share the runtime asset manifest and parent lookup identity across route-only builds',
  );
  assert.match(previewHookSource, /bufferedMotion: state\.phase === 'waiting'/);
  assert.match(bufferedIframeSource, /promotionTransition[\s\S]*?transitionDocumentKey/);
  assert.match(bufferedIframeSource, /incoming \? 'incoming' : 'outgoing'/);
  assert.match(bufferedIframeSource, /previewPageTransitionFrameStyle/);
  assert.match(bufferedIframeSource, /lastMountableDocument[\s\S]*?mountableDocument/);
  assert.match(previewTransitionStylesSource, /role: 'outgoing' \| 'incoming'/);
  assert.match(previewTransitionStylesSource, /pageTransitionKeyframes/);

  const normalized = transitions.normalizePageTransitionDocument({
    version: 99,
    universal: { enabled: true, effect: 'unknown', duration: 20, easing: 'invalid', preload: false },
    rules: [
      { id: 'first', from: '/index.html', to: 'pages/about.html', effect: 'slide-left', duration: 0.55 },
      { id: 'duplicate', from: 'index.html', to: 'pages/about.html', effect: 'fade' },
      { id: 'same-page', from: 'index.html', to: 'index.html' },
    ],
  });
  assert.equal(normalized.version, 1);
  assert.equal(normalized.universal.effect, 'fade');
  assert.equal(normalized.universal.duration, 3);
  assert.equal(normalized.universal.preload, false);
  assert.equal(normalized.rules.length, 1);
  assert.equal(normalized.rules[0].from, 'index.html');
  assert.equal(normalized.rules[0].effect, 'slide-left');

  const exactMotion = transitions.pageTransitionMotionForNavigation(
    normalized,
    'index.html',
    'pages/about.html',
  );
  assert.equal(exactMotion.effect, 'slide-left', 'a page rule must override the universal transition');
  const reverseMotion = transitions.pageTransitionMotionForNavigation(
    normalized,
    'pages/about.html',
    'index.html',
  );
  assert.equal(reverseMotion.effect, 'slide-right', 'returning through a page rule must invert its direction');
  const universalMotion = transitions.pageTransitionMotionForNavigation(
    normalized,
    'third.html',
    'index.html',
  );
  assert.equal(universalMotion.effect, 'fade', 'unmatched routes must use the universal transition');
  assert.equal(transitions.reversePageTransitionEffect('wipe-up'), 'wipe-down');
  assert.ok(
    transitions.PAGE_TRANSITION_EFFECTS.some(effect => effect.value === 'crossfade'),
    'Crossfade must be available in the effect selector',
  );

  const project = {
    name: 'Page transition test',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head><title>Home</title></head><body><main><a href="pages/about.html">About</a></main></body></html>',
      },
      'pages/about.html': {
        path: 'pages/about.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head><title>About</title></head><body><main><a href="../index.html">Home</a></main></body></html>',
      },
      'cases.html': {
        path: 'cases.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head><title>Cases</title></head><body><main><a href="/">Home</a></main></body></html>',
      },
    },
  };
  const casesNavigation = {
    ...project,
    mainHtmlPath: 'cases.html',
  };
  const publicRuntimeAssetManifest = previewRuntime.runtimeAssetAvailablePaths(project);
  publicRuntimeAssetManifest.splice(0);
  assert.equal(
    previewRuntime.runtimeAssetAvailablePaths(project).length,
    Object.keys(project.files).length,
    'public runtime asset inspection must not expose the shared page-preview manifest to mutation',
  );
  assert.equal(
    previewNavigation.isProjectPageNavigation(project, casesNavigation),
    true,
    'a strict route-only project update must be recognized as cheap page navigation',
  );
  assert.equal(
    previewNavigation.isReadOnlyPreviewNavigation(project, casesNavigation, true),
    true,
    'a read-only Preview must be able to navigate from Home to an existing project page',
  );
  assert.equal(
    previewNavigation.isReadOnlyPreviewNavigation(casesNavigation, project, true),
    true,
    'a read-only Preview must be able to navigate back from a project page to Home',
  );
  assert.equal(
    previewNavigation.isReadOnlyPreviewNavigation(project, casesNavigation, false),
    false,
    'the read-only navigation exception must exist only on the executable Preview surface',
  );
  assert.equal(
    previewNavigation.isReadOnlyPreviewNavigation(project, {
      ...casesNavigation,
      files: {
        ...project.files,
        'index.html': {
          ...project.files['index.html'],
          text: '<main>Mutated while navigating</main>',
        },
      },
    }, true),
    false,
    'a source mutation disguised as navigation must remain blocked',
  );
  assert.equal(
    previewNavigation.isReadOnlyPreviewNavigation(project, {
      ...casesNavigation,
      name: 'Mutated metadata',
    }, true),
    false,
    'persistent metadata changes must remain blocked in read-only Preview',
  );
  assert.equal(
    previewNavigation.isReadOnlyPreviewNavigation(project, { ...project }, true),
    false,
    'an identical clone without a route transition must not open a generic read-only bypass',
  );
  assert.equal(
    previewNavigation.isProjectPageNavigation(project, {
      ...casesNavigation,
      files: { ...project.files },
    }),
    false,
    'page navigation must lose its fast path as soon as authored file identity changes',
  );
  assert.match(
    editorSource,
    /const projectPageNavigation = isProjectPageNavigation\(previous, next\);[\s\S]*?const readOnlyPreviewNavigation = sharedReadOnly[\s\S]*?isReadOnlyPreviewNavigation\(previous, next, isPreviewingRef\.current\)[\s\S]*?if \(sharedReadOnly && !readOnlyPreviewNavigation\) return;[\s\S]*?if \(!projectPageNavigation\) \{\s*next = ensureProjectIdentity[\s\S]*?next = rememberProjectGoogleFonts\(next, useFontsStore.getState\(\)\.fonts\);\s*\}/,
    'route-only page changes must skip project normalization without weakening read-only guards',
  );
  const withDocument = transitions.writePageTransitionDocument(project, {
    ...normalized,
    rules: [
      transitions.createPageTransitionRule('index.html', 'pages/about.html', {
        effect: 'slide-left',
        duration: 0.55,
        easing: 'ease-in-out',
      }),
    ],
  });
  assert.ok(withDocument.files[transitions.PAGE_TRANSITIONS_DOCUMENT_PATH]);
  assert.deepEqual(
    transitions.readPageTransitionDocument(withDocument),
    transitions.parsePageTransitionDocument(withDocument.files[transitions.PAGE_TRANSITIONS_DOCUMENT_PATH].text),
  );

  const renamed = pageRename.renameProjectPage(withDocument, 'pages/about.html', 'pages/company.html').project;
  assert.equal(
    transitions.readPageTransitionDocument(renamed).rules[0].to,
    'pages/company.html',
    'renaming a page must keep transition rules connected',
  );
  const withoutDestination = transitions.removePageTransitionPage(renamed, 'pages/company.html');
  assert.equal(
    transitions.readPageTransitionDocument(withoutDestination).rules.length,
    0,
    'removing a page must prune its transition rules',
  );

  const materialized = transitionRuntime.preparePageTransitionsForTransport(withDocument, 'index.html');
  const runtime = materialized.files[transitionRuntime.PAGE_TRANSITIONS_RUNTIME_PATH]?.text || '';
  assert.match(runtime, /new window\.Swup\(/);
  assert.match(runtime, /SwupHeadPlugin/);
  assert.match(runtime, /SwupA11yPlugin/);
  assert.match(runtime, /visit\.history\.direction === 'backwards'/);
  assert.match(runtime, /'slide-left': 'slide-right'/);
  assert.match(runtime, /Motion\.animateView/);
  assert.match(runtime, /Motion\.animate\(/);
  assert.doesNotMatch(materialized.files['index.html'].text, /@keyframes kodety-page-/);
  assert.match(runtime, /__kodetyInteractions\?\.destroy/);
  assert.match(materialized.files['index.html'].text, /data-kodety-page-transition-container/);
  assert.match(materialized.files['index.html'].text, /src="kodety-runtime\/page-transitions-v1\.js"/);
  assert.match(materialized.files['pages/about.html'].text, /src="\.\.\/kodety-runtime\/page-transitions-v1\.js"/);
  assert.match(materialized.files['index.html'].text, /"fromRoute":"\/"/);
  assert.match(materialized.files['index.html'].text, /"toRoute":"\/pages\/about"/);

  const rootedProject = transitions.writePageTransitionDocument({
    name: 'Published route transition test',
    mainHtmlPath: 'Arquivo/index.html',
    rootPath: 'Arquivo',
    openedAt: Date.now(),
    files: {
      'Arquivo/index.html': {
        path: 'Arquivo/index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head></head><body><a href="/cases">Cases</a></body></html>',
      },
      'Arquivo/public/cases.html': {
        path: 'Arquivo/public/cases.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head></head><body><a href="/">Home</a></body></html>',
      },
    },
  }, {
    ...transitions.DEFAULT_PAGE_TRANSITION_DOCUMENT,
    universal: {
      ...transitions.DEFAULT_PAGE_TRANSITION_DOCUMENT.universal,
      enabled: true,
    },
    rules: [transitions.createPageTransitionRule(
      'Arquivo/index.html',
      'Arquivo/public/cases.html',
    )],
  });
  const rootedMaterialized = transitionRuntime.preparePageTransitionsForTransport(
    rootedProject,
    'Arquivo/index.html',
  );
  assert.match(rootedMaterialized.files['Arquivo/index.html'].text, /"toRoute":"\/cases"/);
  assert.match(rootedMaterialized.files['Arquivo/public/cases.html'].text, /"currentRoute":"\/cases"/);
  assert.doesNotMatch(
    rootedMaterialized.files['Arquivo/public/cases.html'].text,
    /\/Arquivo\/public\/cases/,
    'runtime routes must match the clean WordPress URLs after web and public roots are stripped',
  );
  assert.equal(
    codedProject.projectPublicFilePath(rootedProject, 'Arquivo/cases.html'),
    'Arquivo/public/cases.html',
    'Builder Preview must resolve a clean subpage route through the project public directory',
  );

  const timedDocument = {
    ...transitions.DEFAULT_PAGE_TRANSITION_DOCUMENT,
    universal: {
      ...transitions.DEFAULT_PAGE_TRANSITION_DOCUMENT.universal,
      enabled: true,
      duration: 0.4,
    },
  };
  const initiallyTimed = transitionRuntime.preparePageTransitionsForTransport(
    transitions.writePageTransitionDocument(project, timedDocument),
    'index.html',
  );
  assert.match(initiallyTimed.files['index.html'].text, /"duration":0\.4/);
  const staleMaterializedHtml = initiallyTimed.files['index.html'].text
    .replace(
      /<style\b[^>]*data-kodety-page-transitions-style[^>]*>[\s\S]*?<\/style\s*>/i,
      '<style data-kodety-page-transitions-style>stale transition styles</style>',
    )
    .replace(
      /<script\b[^>]*data-kodety-page-transitions-runtime[^>]*>[\s\S]*?<\/script\s*>/i,
      '<script data-kodety-page-transitions-runtime src="stale-runtime.js"></script>',
    );
  const retimedMaterialized = transitions.writePageTransitionDocument({
    ...initiallyTimed,
    files: {
      ...initiallyTimed.files,
      'index.html': {
        ...initiallyTimed.files['index.html'],
        text: staleMaterializedHtml,
      },
    },
  }, {
    ...timedDocument,
    universal: {
      ...timedDocument.universal,
      duration: 1.2,
    },
  });
  const rematerialized = transitionRuntime.preparePageTransitionsForTransport(
    retimedMaterialized,
    'index.html',
  );
  const rematerializedHtml = rematerialized.files['index.html'].text;
  assert.match(rematerializedHtml, /"duration":1\.2/);
  assert.doesNotMatch(rematerializedHtml, /"duration":0\.4|stale transition styles|stale-runtime\.js/);
  assert.match(rematerializedHtml, /prefers-reduced-motion/);
  assert.match(rematerializedHtml, /src="kodety-runtime\/page-transitions-v1\.js"/);
  for (const [marker, pattern] of [
    ['data-kodety-page-transition-container', /<body\b[^>]*data-kodety-page-transition-container/gi],
    ['data-kodety-page-transitions-config', /<script\b[^>]*data-kodety-page-transitions-config/gi],
    ['data-kodety-page-transitions-style', /<style\b[^>]*data-kodety-page-transitions-style/gi],
    ['data-kodety-page-transitions-runtime', /<script\b[^>]*data-kodety-page-transitions-runtime/gi],
  ]) {
    assert.equal(
      rematerializedHtml.match(pattern)?.length,
      1,
      `transport rematerialization must keep ${marker} unique`,
    );
  }

  const transport = projectIo.prepareProjectForTransport(withDocument);
  assert.ok(transport.files[transitionRuntime.PAGE_TRANSITIONS_RUNTIME_PATH]);
  assert.match(transport.files['index.html'].text, /data-kodety-page-transitions-runtime/);

  const disabled = transitionRuntime.preparePageTransitionsForTransport(project, 'index.html');
  assert.equal(disabled, project, 'projects without enabled transitions must stay byte-stable');
} finally {
  await server.close();
}

console.log('Page transitions tests passed.');
