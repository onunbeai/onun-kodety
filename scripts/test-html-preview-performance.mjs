import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');
const bufferedIframeSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx'),
  'utf8',
);
const projectEditorSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  'utf8',
);
const canvasStageSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
  'utf8',
);
const infiniteCanvasSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInfiniteCanvas.tsx'),
  'utf8',
);

assert.doesNotMatch(
  bufferedIframeSource,
  /data-html-buffered-iframe-placeholder|Preparando canvas|Preparando Preview|kodety-loading-bar-indeterminate/,
  'Builder loading chrome must never cover Canvas or Preview',
);
assert.doesNotMatch(
  projectEditorSource,
  /label="Carregando breakpoints do Canvas"/,
  'Infinite Canvas must not cover the editable surface with a loading screen',
);

assert.match(
  source,
  /const pageAnimationDocument = readInteractionDocumentFile\([\s\S]*?if \(animationDocument\?\.interactions\.length\) \{[\s\S]*?patchInteractionDocument\([\s\S]*?animationDocument,[\s\S]*?false/,
  'Preview and Design must share one compiled interaction document so Timeline can play without a second compilation path',
);
assert.match(
  source,
  /if \(freezeMotion\) \{[\s\S]*?data-kodety-interactions-runtime[\s\S]*?data-kodety-interactions-dependency/,
  'Design must freeze authored code while keeping only the editor-owned interaction runtime available to Timeline',
);
assert.match(
  source,
  /authored motion[\s\S]*?private[\s\S]*?editor clock/,
  'the Design interaction exemption must remain bound to Timeline\'s private clock',
);

assert.match(
  bufferedIframeSource,
  /const lastMountableDocumentRef = useRef<[\s\S]*?const currentMountableDocument = !requiresPlayerPreparation[\s\S]*?documentRevision[\s\S]*?html: srcDoc[\s\S]*?surfaceKey[\s\S]*?useLayoutEffect\(\(\) => \{[\s\S]*?lastMountableDocumentRef\.current = currentMountableDocument[\s\S]*?currentMountableDocument \|\| lastMountableDocumentRef\.current/,
  'ordinary Preview pages must mount without a redundant state render and preserve only their committed full identity while a later player page is prepared',
);
assert.match(
  bufferedIframeSource,
  /\{requiresPlayerPreparation \? \([\s\S]*?title="Preparador isolado do Preview"[\s\S]*?\) : null\}/,
  'the isolated player factory must not allocate a second iframe when the page has no YouTube or Vimeo embed',
);
assert.match(
  bufferedIframeSource,
  /progressiveSemanticNavigation[\s\S]*?semanticNavigation[\s\S]*?markDocumentPaintReady\(document\.mountKey\)/,
  'buffering must keep progressive load promotion behind an explicit opt-in',
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
  'only a non-source locale may select the progressive Design lifecycle',
);
assert.match(
  pageDesignSource,
  /retainDocument=\{!localizedDesignCanvas\}[\s\S]*?pinRetainedDocument=\{!localizedDesignCanvas\}[\s\S]*?progressiveSemanticNavigation=\{localizedDesignCanvas\}/,
  'localized page Design must skip semantic retention and promote after load',
);
assert.doesNotMatch(
  `${componentDesignSource}\n${runtimePreviewSource}`,
  /progressiveSemanticNavigation/,
  'source/component Design and runtime Preview must not opt into load promotion',
);
assert.doesNotMatch(
  bufferedIframeSource,
  /BUFFERED_VISUAL_READY_HOST_WATCHDOG_MS|schedulePaintReadyHostWatchdog|loadedDocumentMountKeysRef/,
  'iframe load or a host timeout must never become proof that the hidden document painted',
);
assert.match(
  bufferedIframeSource,
  /function isBufferedDocumentPaintReadyMessage\(data: unknown\)[\s\S]*?return type === 'html-editor-buffer-visuals-ready';/,
  'the default buffered path must still require the strong visual-ready bridge signal',
);
assert.match(
  bufferedIframeSource,
  /!isBufferedDocumentPaintReadyMessage\(event\.data\)[\s\S]*?return;[\s\S]*?markDocumentPaintReady\(document\.mountKey\);[\s\S]*?schedulePromotion\(\);/,
  'buffer promotion must remain downstream of html-editor-buffer-visuals-ready',
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
  /<HtmlOpaqueOriginBufferedIframe[\s\S]*?onBufferedLoad=\{\(event, bufferedGeneration, _revision, _surfaceKey, semanticNavigation\) => \{[\s\S]*?semanticNavigation \? 'fonts' : 'all'/,
  'the existing callback must keep fonts-only semantic navigation and full same-page asset transfer without weakening promotion',
);
assert.match(
  infiniteCanvasSource,
  /const passiveDocument = useMemo\([\s\S]*?injectInfiniteCanvasPassiveRuntime\(passiveHtml\)[\s\S]*?srcDoc=\{passiveDocument\}/,
  'concurrent breakpoint rendering must serialize and inject one shared lightweight passive document per generation',
);
assert.doesNotMatch(
  infiniteCanvasSource,
  /passiveHydrationState|requestIdleCallback|Preparando breakpoint/,
  'complete breakpoint references must not wait behind a progressive hydration queue',
);

assert.doesNotMatch(
  source,
  /setCanvasOnlyAttribute\([^\n]*['"]loading['"][^\n]*['"]eager['"]|setAttribute\([^\n]*['"]loading['"][^\n]*['"]eager['"]/, 
  'Design must preserve authored lazy-loading semantics',
);
assert.doesNotMatch(
  source,
  /:root\[data-html-editor-motion-frozen\] \*:not\([^\n]+\) \{\s*content-visibility:\s*visible|:host\([^\n]+\),\s*\*:not\([^\n]+\) \{\s*content-visibility:\s*visible/,
  'Design must not disable content-visibility for the whole page or shadow tree',
);
assert.match(
  source,
  /const designMediaPayload[\s\S]*?HTMLVideoElement[\s\S]*?\['poster', 'data-poster', 'data-poster-url'\][\s\S]*?wrappedSetter[\s\S]*?designMediaPayload\(this, property\)/,
  'Design must keep video/audio payloads away from native URL setters while allowing a video poster',
);
assert.match(
  source,
  /NativeAssetIntersectionObserver[\s\S]*?rootMargin: '100% 50%'[\s\S]*?deferDesignRuntimeElement[\s\S]*?designAssetObserver\?\.observe/,
  'Design assets must be released only when visible or near the viewport',
);
assert.match(
  source,
  /if \(!designAssetObserver\) \{[\s\S]*?deferredDesignAssetsByTarget\.forEach/,
  'native IntersectionObserver must not be followed by an all-target geometry sweep on every scroll',
);
assert.match(
  source,
  /const runtimeSrcsetCandidate[\s\S]*?requiredWidth = renderedWidth \* density[\s\S]*?requestRuntimeAssetUrl\(candidate\.url/,
  'Design must choose and request one responsive image candidate',
);
assert.doesNotMatch(
  source,
  /authoredValue\.split\(','\)\.forEach[\s\S]{0,240}requestRuntimeAssetUrl|patch\.value\.split\(','\)\.forEach[\s\S]{0,240}requestRuntimeAssetUrl/,
  'srcset processing must not request every candidate',
);
assert.match(
  source,
  /const flushRuntimeAssetRequests[\s\S]*?for \(let offset = 0; offset < paths\.length; offset \+= 1024\)[\s\S]*?type: 'html-editor-runtime-assets-request',[\s\S]*?paths: paths\.slice\(offset, offset \+ 1024\)/,
  'Design and Preview must batch same-task asset discovery through the bounded parent protocol',
);
assert.doesNotMatch(
  source,
  /const flushRuntimeAssetRequests[\s\S]{0,1200}type: 'html-editor-runtime-asset-request'/,
  'Preview asset discovery must not emit one parent message per requested file',
);
assert.match(
  projectEditorSource,
  /sendRuntimeAssetsRef\.current = \(\) => \{[\s\S]*?sendRuntimeAssetsToFrame\(frame, isPreviewingRef\.current \? 'all' : 'fonts'\)[\s\S]*?runtimeAssetsSentRef\.current = Boolean\(frame\)/,
  'executable Preview must eagerly batch its referenced assets so authored preloaders cannot deadlock, while Design stays font-only',
);
assert.match(
  source,
  /replaceRuntimeAssetReferencesInStyles = replacements =>[\s\S]*?document\.querySelectorAll\('\[style\]'\)[\s\S]*?replaceRuntimeAssetUrl = \(path, oldUrl, nextUrl, aliases = \{\}, refreshDocument = true\)[\s\S]*?if \(!refreshDocument\) return[\s\S]*?const styleUrlReplacements = \[\][\s\S]*?replaceRuntimeAssetUrl\(path, oldUrl, nextUrl, aliases, false\)[\s\S]*?replaceRuntimeAssetReferencesInStyles\(styleUrlReplacements\)[\s\S]*?sweepRuntimeAssets\(document\.documentElement\)/,
  'one transferred asset batch must perform one consolidated document sweep instead of one sweep per path',
);
assert.match(
  source,
  /let bufferedFontsSettled = !runtimeFontAssetPaths\.length;[\s\S]*?let runtimeFontSettlementPending = false[\s\S]*?const maybeSettleRuntimeFontsAndCanvas[\s\S]*?if \(bufferedFontsSettled \|\| runtimeFontSettlementPending\) return[\s\S]*?runtimeFontSettlementPending = true[\s\S]*?settleRuntimeFontsAndCanvas\(\)/,
  'font settlement must be idempotent so image-only batches cannot rescan and relayout document.fonts',
);
assert.doesNotMatch(
  source,
  /runtimeAssetPayloadIncludesFont\([^\n]+\)\) refreshRuntimeFonts\(\)/,
  'asset installers must let the guarded settlement path own the single font refresh',
);
assert.match(
  source,
  /discoverVisibleDesignAssets[\s\S]*?elementsFromPoint[\s\S]*?getComputedStyle\(element, pseudo \|\| null\)[\s\S]*?requestDesignCssValue/,
  'CSS image discovery must inspect only viewport-hit elements and their ancestors',
);
assert.match(
  source,
  /replaceRuntimeAssetUrl[\s\S]*?Asset waiters update exactly the elements that asked for this path[\s\S]*?if \(motionFrozen\)[\s\S]*?scheduleVisibleDesignAssetDiscovery\(\)[\s\S]*?else \{[\s\S]*?sweepRuntimeAssets\(document\.documentElement\)/,
  'per-asset Design responses must avoid a global DOM sweep without changing executable Preview',
);
assert.match(
  source,
  /attributeFilter: \[\.\.\.RUNTIME_ASSET_ATTRIBUTES, 'style'\]/,
  'dynamic inline background changes must participate in viewport asset discovery',
);
assert.doesNotMatch(
  source,
  /selected\.querySelectorAll\?\.\(RUNTIME_ASSET_SELECTOR\)/,
  'selecting a section or body must not eagerly release every descendant asset',
);

console.log('Preview Design performance contracts passed.');
