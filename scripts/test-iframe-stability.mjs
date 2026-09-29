import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = path => readFileSync(resolve(repositoryRoot, path), 'utf8');

const presenceSource = readSource(
  'app/(builder)/kodety/html-editor/hooks/use-html-collaboration-presence.ts',
);
const collaborationStoreSource = readSource('stores/useHtmlCollaborationStore.ts');
const editorLockNavigationSource = readSource('Wordpress/editor/editor-lock-navigation.ts');
const wordpressEntrySource = readSource('Wordpress/editor/main.tsx');
const bufferedIframeSource = readSource(
  'app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx',
);
const canvasStageSource = readSource(
  'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx',
);
const previewSource = readSource('lib/html-editor/preview.ts');
const editorSource = readSource(
  'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx',
);

const workspacePathPatternSource = editorLockNavigationSource.match(
  /const KODETY_WORKSPACE_PATH_PATTERN\s*=\s*\/(.+)\/;/u,
)?.[1];
assert.ok(workspacePathPatternSource, 'editor-lock workspace path matcher must be declared');
const workspacePathPattern = new RegExp(workspacePathPatternSource);
for (const path of [
  '/kodety/editor/',
  '/wordpress/kodety/cms/',
  '/clients/acme/kodety/analytics/',
  '/wordpress/kodety/share/abc_123/settings/',
]) {
  assert.equal(workspacePathPattern.test(path), true, `workspace handoff must support ${path}`);
}
for (const path of [
  '/kodety/',
  '/wordpress/wp-admin/',
  '/wordpress/kodety/preview/token/',
  '/not-kodety/editor/',
  '/kodety/share/token/preview/',
]) {
  assert.equal(workspacePathPattern.test(path), false, `workspace handoff must reject ${path}`);
}

assert.match(
  presenceSource,
  /const EDITOR_LOCK_HEARTBEAT_TIMEOUT_MS = 6_000;/,
  'editor-lock heartbeat must have a deadline below the server lease TTL',
);
assert.match(
  presenceSource,
  /signal: requestController\.signal/,
  'heartbeat fetch must use its deadline-bound request signal',
);
assert.match(
  presenceSource,
  /const nonceRef = useRef\(nonce\);[\s\S]*?nonceRef\.current = nonce;/,
  'nonce refreshes must flow through a ref without rotating the active lease',
);
assert.match(
  presenceSource,
  /'X-WP-Nonce': nonceRef\.current/,
  'every heartbeat and release must read the latest nonce without remounting',
);
assert.match(
  presenceSource,
  /\}, \[editorLockUrl, enabled\]\);/,
  'nonce changes must not tear down the editor-lock effect',
);
assert.match(
  presenceSource,
  /previousConfirmedMode === 'view' && nextConfirmedMode === 'edit'[\s\S]*?reloadWithEditorLockHandoff\(\)/,
  'a real server-confirmed handoff must reload the latest snapshot through the stable tab identity',
);
assert.doesNotMatch(
  presenceSource,
  /window\.location\.reload\(\)/,
  'editor-lock recovery must never use a raw reload that rotates the document identity',
);
const heartbeatCatch = presenceSource.match(/\} catch \(error\) \{([\s\S]*?)\n\s*\} finally \{/u)?.[1] || '';
assert.ok(heartbeatCatch, 'heartbeat transport-failure branch must be present');
assert.match(
  heartbeatCatch,
  /mode === null[\s\S]*?setConnectionStatus\([\s\S]*?'reconnecting'/,
  'an unconfirmed transport failure must remain fail-closed as reconnecting',
);
assert.doesNotMatch(
  heartbeatCatch,
  /setPresence|applyHtmlCollaborationPayload|mode:\s*'view'|location\.reload/,
  'a transport failure must never manufacture a server conflict or reload the document',
);
assert.match(
  presenceSource,
  /const armAuthorityExpiry = [\s\S]*?reportedExpiry[\s\S]*?response\.headers\.get\('Date'\)/,
  'the local edit authority deadline must follow the server-confirmed lease expiry',
);
assert.match(
  presenceSource,
  /confirmedEdit = false;[\s\S]*?setConnectionStatus\([\s\S]*?'reconnecting'[\s\S]*?heartbeatNow\(\)/,
  'an expired confirmed lease must fail closed and renew immediately without claiming a conflict',
);
assert.doesNotMatch(
  presenceSource,
  /authorityExpiryTimer = window\.setTimeout\([\s\S]*?mode:\s*'view'[\s\S]*?limited:\s*true/,
  'local lease expiry must not manufacture another-editor state',
);
assert.match(
  presenceSource,
  /if \(!isCurrentLease\(\)\) return;[\s\S]*?await response\.json[\s\S]*?if \(!isCurrentLease\(\)\) return;/,
  'a response must be rejected when its lease becomes obsolete across either await boundary',
);
assert.match(
  presenceSource,
  /payload\.sessionId[\s\S]*?!== sessionId[\s\S]*?payload\.leaseId[\s\S]*?!== leaseId/,
  'successful heartbeat identities must match the exact requested session and lease',
);
assert.match(
  presenceSource,
  /payload\.mode !== 'edit' && payload\.mode !== 'view'[\s\S]*?servidor respondeu sem confirmar o modo/,
  'a successful HTTP response without an explicit lock mode must fail closed',
);
assert.match(
  presenceSource,
  /addEventListener\('focus', heartbeatNow\)[\s\S]*?addEventListener\('online', heartbeatNow\)[\s\S]*?addEventListener\('visibilitychange', heartbeatWhenVisible\)/,
  'focus, online recovery and visible documents must renew the editor lease immediately',
);
assert.match(
  collaborationStoreSource,
  /'checking'[\s\S]*?'conflict'[\s\S]*?'reconnecting'[\s\S]*?setConnectionStatus[\s\S]*?current\.mode !== null[\s\S]*?next\.mode = null/,
  'transport state must remain distinct from a server-confirmed editing conflict',
);
assert.match(
  presenceSource,
  /event\.persisted[\s\S]*?reloadWithEditorLockHandoff\(\)/,
  'BFCache recovery must preserve the logical tab identity',
);
assert.match(
  editorLockNavigationSource,
  /consumeEditorLockHandoff[\s\S]*?searchParams\.delete\(EDITOR_LOCK_HANDOFF_PARAM\)[\s\S]*?history\.replaceState/,
  'a same-tab handoff must be consumed and removed from the settled URL immediately',
);
assert.match(
  editorLockNavigationSource,
  /editorLockHandoffUrl[\s\S]*?workspaceDestination\(raw\)[\s\S]*?kodetyEditorSession[\s\S]*?searchParams\.set\(EDITOR_LOCK_HANDOFF_PARAM, sessionId\)/,
  'only a validated Kodety workspace destination may carry the current tab session',
);
assert.match(
  editorLockNavigationSource,
  /reloadWithEditorLockHandoff[\s\S]*?window\.location\.replace\(editorLockHandoffUrl\(window\.location\.href\)\)/,
  'authoritative reloads must carry the current tab identity into the replacement document',
);
assert.match(
  editorLockNavigationSource,
  /event\.metaKey[\s\S]*?event\.ctrlKey[\s\S]*?event\.shiftKey[\s\S]*?event\.altKey[\s\S]*?event\.preventDefault\(\)[\s\S]*?requestWorkspaceNavigationWithEditorLockHandoff/,
  'modified clicks must remain independent new tabs while normal clicks await workspace guards and preserve same-tab identity',
);
assert.match(
  wordpressEntrySource,
  /editorSession = consumeEditorLockHandoff\(\);[\s\S]*?if \(!editorSession\)[\s\S]*?crypto\?\.randomUUID[\s\S]*?addEventListener\('click', interceptEditorLockWorkspaceNavigation\)/,
  'the WordPress entry must consume an intentional handoff before creating a fresh document session',
);

assert.match(
  bufferedIframeSource,
  /const MAX_RETAINED_SURFACES = 3;/,
  'the browsing-context working set must remain memory-bounded',
);
assert.doesNotMatch(
  bufferedIframeSource,
  /BUFFERED_VISUAL_READY_HOST_WATCHDOG_MS|schedulePaintReadyHostWatchdog|loadedDocumentMountKeysRef/,
  'iframe load alone must never become proof that the hidden document painted',
);
assert.match(
  bufferedIframeSource,
  /const handleVisualsReady[\s\S]*?isBufferedDocumentPaintReadyMessage\(event\.data\)[\s\S]*?markDocumentPaintReady\(document\.mountKey\)/,
  'the default pending iframe path must cross its paint gate through the strong visual-ready message',
);
assert.match(
  bufferedIframeSource,
  /progressiveSemanticNavigation[\s\S]*?semanticNavigation[\s\S]*?!paintReadyDocumentMountKeysRef\.current\.has\(document\.mountKey\)[\s\S]*?markDocumentPaintReady\(document\.mountKey\)/,
  'an explicit progressive semantic navigation may cross the paint gate on iframe load',
);
assert.match(
  bufferedIframeSource,
  /if \(retainDocument \|\| retainedDocumentsRef\.current\.size === 0\) return;[\s\S]*?retainedDocumentsRef\.current = new Map\(\)/,
  'disabling retention must synchronously discard every cached browsing context',
);
assert.match(
  bufferedIframeSource,
  /const retained = retainDocument[\s\S]*?retainedDocumentsRef\.current\.get\(surfaceKey\)[\s\S]*?: undefined/,
  'a non-retained target must never reactivate an older semantic surface',
);
assert.match(
  bufferedIframeSource,
  /cache\.delete\(document\.surfaceKey\);[\s\S]*?document\.retain[\s\S]*?visibleDocument\.retain[\s\S]*?cacheRetainedSurface\(cache, visibleDocument\)/,
  'the outgoing surface may enter the cache only when the incoming document also permits retention',
);
assert.match(
  bufferedIframeSource,
  /paintReadyDocumentMountKeysRef\.current\.forEach[\s\S]*?!mountedKeys\.has\(mountKey\)[\s\S]*?\.delete\(mountKey\)/,
  'readiness bookkeeping must be pruned with unmounted browsing contexts',
);

const localizedDesignCanvasStart = canvasStageSource.indexOf('data-page-editor-canvas-surface');
const localizedDesignCanvasEnd = canvasStageSource.indexOf('data-component-editor-canvas-surface');
const componentCanvasEnd = canvasStageSource.indexOf('data-runtime-preview-surface');
assert.ok(
  localizedDesignCanvasStart >= 0
    && localizedDesignCanvasEnd > localizedDesignCanvasStart
    && componentCanvasEnd > localizedDesignCanvasEnd,
  'missing isolated canvas surface boundaries',
);
const localizedDesignCanvasSource = canvasStageSource.slice(
  localizedDesignCanvasStart,
  localizedDesignCanvasEnd,
);
const componentCanvasSource = canvasStageSource.slice(localizedDesignCanvasEnd, componentCanvasEnd);
const runtimePreviewSource = canvasStageSource.slice(componentCanvasEnd);
assert.match(
  canvasStageSource,
  /const localizedDesignCanvas = resolvedActiveLocale !== localizationSourceLocale;/,
  'Design must derive its isolated lifecycle exclusively from a non-source locale',
);
assert.match(
  localizedDesignCanvasSource,
  /retainDocument=\{!localizedDesignCanvas\}[\s\S]*?pinRetainedDocument=\{!localizedDesignCanvas\}[\s\S]*?progressiveSemanticNavigation=\{localizedDesignCanvas\}/,
  'only localized page Design may promote on load and it must disable retained semantic surfaces',
);
assert.doesNotMatch(
  `${componentCanvasSource}\n${runtimePreviewSource}`,
  /progressiveSemanticNavigation/,
  'component Design and runtime Preview must keep their normal strong visual-readiness gate',
);

const runtimeResolverSource = previewSource.match(
  /const availableRuntimeAssetPaths =[\s\S]*?const runtimeAssetAliases = \{\};/u,
)?.[0] || '';
assert.ok(runtimeResolverSource, 'runtime asset resolver must be embedded in Preview');
assert.match(
  runtimeResolverSource,
  /const availableRuntimeAssetPathSet = new Set\(availableRuntimeAssetPaths\);/,
  'exact runtime asset lookups must use a Set',
);
assert.match(
  runtimeResolverSource,
  /const runtimeAssetUniqueSuffixCache = new Map\(\);/,
  'suffix fallback results must be cached',
);
assert.match(
  runtimeResolverSource,
  /const ambiguousRuntimeAssetBasenames = new Set\(\);/,
  'ambiguous basenames must remain explicitly unresolved',
);
assert.doesNotMatch(
  runtimeResolverSource,
  /availableRuntimeAssetPaths\.includes\(/,
  'the hot resolver path must not linearly scan for exact membership',
);
assert.doesNotMatch(
  runtimeResolverSource,
  /availableRuntimeAssetPaths\.filter\(/,
  'the hot resolver path must not allocate full-array suffix/basename filters',
);

const selectPathSource = editorSource.slice(
  editorSource.indexOf('const selectPath ='),
  editorSource.indexOf('const agentEditorContext ='),
);
assert.match(
  selectPathSource,
  /authoredElementByPath\.get\(path\)/,
  'layer selection must use the prebuilt authored-path index',
);
assert.match(
  selectPathSource,
  /lastCanvasSelectionAckPathRef\.current !== path[\s\S]*?postCanvasMessage/,
  'a delayed bridge ACK may retry the lightweight selection command',
);
assert.doesNotMatch(
  selectPathSource,
  /setCanvasReloadKey/,
  'a delayed selection ACK must never recreate the iframe',
);

console.log('Iframe stability contracts passed.');
