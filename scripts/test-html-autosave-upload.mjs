import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const [
  constants,
  editor,
  types,
  shell,
  plugin,
  admin,
  projectStorage,
  wordpressHelpers,
  wordpressEntryConfig,
  wordpressMain,
  draftDelta,
  requestTimeout,
  cssIntegrity,
] = await Promise.all([
  readFile(new URL('../lib/html-editor/editor-constants.ts', import.meta.url), 'utf8'),
  readFile(
    new URL('../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx', import.meta.url),
    'utf8',
  ),
  readFile(new URL('../lib/html-editor/editor-types.ts', import.meta.url), 'utf8'),
  readFile(new URL('../Wordpress/kodety/templates/editor-shell.php', import.meta.url), 'utf8'),
  readFile(new URL('../Wordpress/kodety/includes/class-kodety-plugin.php', import.meta.url), 'utf8'),
  readFile(new URL('../Wordpress/kodety/admin/kodety-page.js', import.meta.url), 'utf8'),
  readFile(new URL('../lib/html-editor/project-storage.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/html-editor/editor-wordpress-helpers.ts', import.meta.url), 'utf8'),
  readFile(new URL('../Wordpress/editor/wordpress-entry-config.ts', import.meta.url), 'utf8'),
  readFile(new URL('../Wordpress/editor/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../lib/html-editor/wordpress-draft-delta.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/request-timeout.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/html-editor/css-integrity.ts', import.meta.url), 'utf8'),
]);

assert.match(
  constants,
  /WORDPRESS_DRAFT_AUTOSAVE_INTERVAL_MS = 30_000/,
  'background WordPress persistence must create a recovery checkpoint within 30 seconds',
);
assert.match(
  constants,
  /PROJECT_FIRST_AUTOSAVE_DELAY_MS = 15_000/,
  'the first automatic persistence pass must not leave a ten-minute data-loss window',
);
assert.match(
  editor,
  /projectAutosaveNotBeforeRef\.current = isWordPressRuntime[\s\S]*?Date\.now\(\) \+ PROJECT_FIRST_AUTOSAVE_DELAY_MS[\s\S]*?: 0/,
  'opening/importing a project must establish the first-autosave gate',
);

assert.match(
  projectStorage,
  /export async function loadProjectSnapshots\([\s\S]*?database\.transaction\(STORE_NAME, 'readonly'\)[\s\S]*?readScopedSnapshot<StoredHtmlProject>\(store, LATEST_KEY, workspaceKey[\s\S]*?readScopedSnapshot<StoredHtmlProject>\(store, RECOVERY_KEY, workspaceKey/,
  'startup must read latest and recovery snapshots in one IndexedDB transaction',
);
assert.match(
  editor,
  /const authoritativeWordPressStartup = Boolean\([\s\S]*?openPublishAfterImport === true[\s\S]*?shopifyThemeImport === true/,
  'a staged administrative import must be classified as an authoritative server startup',
);
assert.match(editor, /const authoritativeWordPressStartup = Boolean\([\s\S]*?restoredSnapshot === true/,
  'restaurar um snapshot deve ignorar a versão local anterior no primeiro carregamento');
assert.match(shell, /'restoredSnapshot' => !\$is_shared[\s\S]*?kodety_restored_snapshot/);
const localBootstrapStartup = editor.slice(
  editor.indexOf('const projectBackedView ='),
  editor.indexOf("void downloadWordPressProjectSnapshot(config, '_kodety_project_revision'"),
);
assert.match(
  localBootstrapStartup,
  /\|\| authoritativeWordPressStartup[\s\S]*?initialLocalBootstrapOpenedRef\.current = true;[\s\S]*?openProjectRef\.current\(requested, null, false, cached\)/,
  'ordinary navigation may paint the local workspace, but a staged ZIP import must never paint that stale snapshot',
);
assert.match(
  editor,
  /const matchingCache = !authoritativeWordPressStartup[\s\S]*?localSnapshotMatchesWordPressWorkspace\(cached, config\)[\s\S]*?downloadWordPressProjectSnapshot\(config, '_kodety_project_revision', signal, matchingCache\)/,
  'a staged ZIP import must force an unconditional authoritative ZIP download instead of permitting a local 304 reuse',
);
const stagedImportPaintGate = editor.slice(
  editor.indexOf('const editorCanvasLoading = Boolean('),
  editor.indexOf('const shopifyImportNoticeShownRef'),
);
assert.match(
  stagedImportPaintGate,
  /paintedProjectOpenedAt !== project\.openedAt[\s\S]*?setPublishPanelOpen\(true\)[\s\S]*?setImportPublishReviewPending\(false\)/,
  'post-import review must remain behind the opaque loader until the authoritative canvas paints',
);
assert.doesNotMatch(
  stagedImportPaintGate.slice(0, stagedImportPaintGate.indexOf('const importPublishPanelOpenedRef')),
  /importPublishReviewPending/,
  'post-import review state must never disable the authoritative canvas paint barrier',
);
assert.match(
  editor,
  /shopifyThemeImport[\s\S]*?paintedProjectOpenedAt !== project\.openedAt[\s\S]*?url\.searchParams\.delete\('kodety_shopify_theme'\)/,
  'Shopify imports must retain their authoritative-startup marker until the imported canvas paints',
);
assert.match(
  editor,
  /response\.status === 304 && reusableCache[\s\S]*?reusedLocalSnapshot: true/,
  'a current local workspace must bypass ZIP download and inflation',
);
const proxyCacheStart = editor.indexOf('if (binaryDownload && reusableCache) {');
const proxyCacheEnd = editor.indexOf('if (binaryDownload) {', proxyCacheStart + 1);
assert.ok(
  proxyCacheStart >= 0 && proxyCacheEnd > proxyCacheStart,
  'missing proxy-normalized cache-hit boundary',
);
const proxyNormalizedCacheHit = editor.slice(proxyCacheStart, proxyCacheEnd);
assert.match(proxyNormalizedCacheHit, /responseWorkspaceRevision === reusableCache\.workspaceRevision/);
assert.match(proxyNormalizedCacheHit, /responseTemplateDigest === reusableCache\.workspaceTemplateDigest/);
assert.match(proxyNormalizedCacheHit, /response\.body\?\.cancel\(\)/);
assert.match(proxyNormalizedCacheHit, /reusedLocalSnapshot: true/);
assert.match(
  proxyNormalizedCacheHit,
  /response\.body\?\.cancel\(\)[\s\S]*?observeWordPressProjectDownloadCacheHit\(projectObservability\);[\s\S]*?return \{[\s\S]*?reusedLocalSnapshot: true/,
);
assert.doesNotMatch(
  proxyNormalizedCacheHit,
  /observeWordPressProjectDownloadBody|response\.(?:blob|json)\(|importZip\(|\.begin\(|project_(?:unzip|parse)/,
  'a cache hit must cancel and return without reading a body or entering unzip/parse',
);
const binaryBodyRead = editor.indexOf('() => response.blob()', proxyCacheEnd);
const binaryInflation = editor.indexOf('const imported = await importZip(', binaryBodyRead);
assert.ok(
  binaryBodyRead > proxyCacheEnd && binaryInflation > binaryBodyRead,
  'a proxy-normalized cache hit must return before ZIP body allocation and inflation',
);
assert.match(
  editor,
  /snapshot\.reusedLocalSnapshot && projectRef\.current[\s\S]*?wordpressAcknowledgedProjectRef\.current = projectRef\.current[\s\S]*?return;/,
  '304 acknowledgement must preserve the already-painted canvas project',
);
assert.match(
  editor,
  /const openProjectRef = useRef\(openProject\);[\s\S]*?openProjectRef\.current = openProject;[\s\S]*?openProjectRef\.current\(requested, null, false, cached\)/,
  'startup effects must call the latest opener without subscribing to its changing callback identity',
);
assert.match(
  editor,
  /const preservePaintedSurface = !authoritativeWordPressStartup && Boolean\([\s\S]*?paintedProjectOpenedAtRef\.current === paintedProject\.openedAt[\s\S]*?openProjectRef\.current\([\s\S]*?preservePaintedSurface/,
  'ordinary revalidation may retain a painted canvas, but a staged import must hand off only to its authoritative surface',
);
assert.match(
  editor,
  /const revalidationBaseProject = projectRef\.current;[\s\S]*?const revalidationBaseRevision = projectRevisionRef\.current;[\s\S]*?const revalidationBaseSignature = revalidationBaseProject[\s\S]*?downloadWordPressProjectSnapshot\(config, '_kodety_project_revision'[\s\S]*?projectRevisionRef\.current !== revalidationBaseRevision[\s\S]*?liveProject !== revalidationBaseProject[\s\S]*?projectSignature\(liveProject\) !== revalidationBaseSignature[\s\S]*?hasUnsavedWordPressDraftRef\.current[\s\S]*?pendingWordPressDraftProjectRef\.current !== null[\s\S]*?wordpressDraftQueuedCountRef\.current > 0[\s\S]*?if \(projectChangedDuringRevalidation \|\| localWritePending\)[\s\S]*?return;[\s\S]*?openProjectRef\.current/,
  'initial WordPress revalidation must discard an obsolete download instead of replacing an edit made on the painted local bootstrap',
);
assert.match(editor, /'X-Kodety-Known-Workspace-Revision'/);
assert.match(editor, /'X-Kodety-Known-Template-Digest'/);
const conditionalDownload = plugin.slice(
  plugin.indexOf('public function admin_download_editor_project'),
  plugin.indexOf('/** @param array<string,string> $extra_headers */'),
);
assert.match(conditionalDownload, /status_header\(304\)/);
assert.ok(
  conditionalDownload.indexOf('status_header(304)') < conditionalDownload.indexOf('$this->prepare_project_download_archive()'),
  'WordPress must answer a matching conditional open before preparing the ZIP archive',
);
assert.match(conditionalDownload, /X-Kodety-Template-Digest/);
assert.match(
  editor,
  /const requestedDelay = Number\.isFinite\(delay\)[\s\S]*?const deadline = Date\.now\(\) \+ anchoredDelay[\s\S]*?wordpressDraftTimerDeadlineRef\.current <= deadline[\s\S]*?return;/,
  'later edits must preserve the earliest WordPress deadline while explicit short flushes remain effective',
);
assert.match(
  editor,
  /if \(isWordPressRuntime && localSnapshotTimerRef\.current !== null\) return;[\s\S]*?const delay = isWordPressRuntime[\s\S]*?WORDPRESS_DRAFT_AUTOSAVE_INTERVAL_MS[\s\S]*?: normalDelay/,
  'WordPress IndexedDB recovery must be anchored while standalone recovery keeps its short debounce',
);
assert.match(
  editor,
  /const persistExactWordPressDraft[\s\S]*?enqueueWordPressDraftWrite\(next, \{[\s\S]*?exact: true,[\s\S]*?signal,[\s\S]*?forceRoundTrip/,
  'manual Save and Publish must use an exact non-coalescing persistence path',
);
assert.match(
  editor,
  /type WordPressDraftWriteRequest = \{[\s\S]*?replaceWordPressWorkspace\?: boolean;[\s\S]*?persistWordPressDraft\([\s\S]*?request\.replaceWordPressWorkspace === true[\s\S]*?replaceWordPressWorkspace: explicitReplacement/,
  'an explicit workspace-replacement flag must survive the serialized draft pipeline',
);
assert.match(
  editor,
  /type WordPressDraftWriteRequest = \{[\s\S]*?workspaceEpoch: number;[\s\S]*?projectId: string;[\s\S]*?const advanceWordPressWorkspaceWriteFence[\s\S]*?wordpressWorkspaceWriteEpochRef\.current \+ 1[\s\S]*?wordpressWorkspaceWriteProjectIdRef\.current = fence\.projectId/,
  'every draft request must carry the replacement epoch and project identity that authorize its transport',
);
assert.match(
  editor,
  /const advanceWordPressWorkspaceWriteFence[\s\S]*?clearTimeout\(wordpressDraftTimerRef\.current\)[\s\S]*?wordpressDraftIdleCancelRef\.current\?\.\(\)[\s\S]*?clearTimeout\(wordpressDraftRetryTimerRef\.current\)[\s\S]*?wordpressDraftZipBuilderRef\.current\?\.cancel\(supersededError\)[\s\S]*?pendingWordPressDraftProjectRef\.current = null[\s\S]*?clearTimeout\(localizationDraftTimerRef\.current\)[\s\S]*?localizationDraftWaitersRef\.current[\s\S]*?waiter\.reject\(supersededError\)/,
  'advancing the replacement fence must invalidate every timer, retry, pending ZIP and localization waiter owned by the outgoing project',
);
assert.match(
  editor,
  /createSerializedWriteQueue\(async \(request: WordPressDraftWriteRequest\)[\s\S]*?!isCurrentWorkspaceWrite\(request\)[\s\S]*?persistWordPressDraft\([\s\S]*?request\.replaceWordPressWorkspace === true,[\s\S]*?request,[\s\S]*?selectLatestWordPressWorkspaceWrite\([\s\S]*?currentWordPressWorkspaceWriteFence\(\)/,
  'the serialized queue must drop stale requests and prevent a stale latest follower from coalescing over the current project',
);
assert.doesNotMatch(
  editor,
  /wordpressWorkspaceRestorationRef|restoresPreservedWorkspace/,
  'an ambiguous creation failure must not turn later saves into automatic destructive restoration writes',
);
assert.match(
  editor,
  /wordpressPendingReplacementRef\.current = advanceWordPressWorkspaceWriteFence\(next\)/,
  'an explicit Open or Import must retain its own replacement intent until acknowledged',
);
assert.match(
  editor,
  /const pendingReplacement = wordpressPendingReplacementRef\.current[\s\S]*?const explicitReplacement = Boolean\([\s\S]*?forceRoundTrip: options\.forceRoundTrip \|\| explicitReplacement[\s\S]*?replaceWordPressWorkspace: explicitReplacement/,
  'only a user-requested replacement may cross an ordinary project identity boundary',
);
assert.match(
  editor,
  /const scheduleWordPressDraftWrite = useCallback\([\s\S]*?if \(!isCurrentWorkspaceWrite\(\{[\s\S]*?wordPressWorkspaceProjectId\(next\)[\s\S]*?\}\)\) return;[\s\S]*?pendingWordPressDraftProjectRef\.current = next/,
  'a stale callback from the outgoing project must be rejected before it can replace pending state or mark the acknowledged replacement unsaved',
);
assert.match(
  editor,
  /if \(replaceWordPressWorkspace && !acknowledgedWordPressReplacement\) \{[\s\S]*?advanceWordPressWorkspaceWriteFence\(next\)[\s\S]*?wordpressWorkspaceWriteProjectIdRef\.current = wordPressWorkspaceProjectId\(next\)/,
  'every unacknowledged Open/Import replacement must advance its own fence while an acknowledged replacement reuses the confirmed epoch',
);
assert.match(
  projectStorage,
  /export function createSerializedWriteQueue[\s\S]*?enqueueLatest[\s\S]*?enqueueExact/,
  'exact writes and latest-wins background writes must have separate queue contracts',
);
assert.match(
  editor,
  /const projectBackedView =[\s\S]*?appView === 'settings'[\s\S]*?appView === 'analytics'[\s\S]*?openProjectRef\.current\(requested, null, false, cached\)/,
  'Settings and Analytics must paint the validated local workspace before remote ZIP revalidation',
);
assert.match(
  editor,
  /initialWorkspaceCacheRevisionRef\.current = workspaceRevision[\s\S]*?persistLocalProjectSnapshot\(pending\)[\s\S]*?}, 1_500\)/,
  'the acknowledged workspace must be cached shortly after first paint for fast panel navigation',
);
assert.match(
  editor,
  /const persistBeforePageHide[\s\S]*?enqueueCurrentLocalSnapshot\(\)[\s\S]*?Date\.now\(\) >= projectAutosaveNotBeforeRef\.current/,
  'pagehide must always open the local recovery transaction even during the remote startup grace period',
);
assert.match(
  editor,
  /result\?\.success !== true[\s\S]*?!Number\.isSafeInteger\(savedRevision\)[\s\S]*?!\/\^\[a-f0-9\]\{64\}\$\/i\.test\(savedDigest\)/,
  'HTTP 200 is not a save acknowledgement without success, revision, digest and timestamp',
);
assert.match(
  editor,
  /persistExactWordPressDraft\(current, false, controller\.signal, false, true, true\)[\s\S]*?withRequestTimeout[\s\S]*?WORDPRESS_PUBLISH_REQUEST_TIMEOUT_MS/,
  'Publish cancellation and timeout must cover both exact draft persistence and release confirmation',
);
assert.match(
  editor,
  /wordpressPublishDraftBarrier\.waitForRelease\([\s\S]*?persistWordPressDraft\([\s\S]*?wordpressPublishDraftBarrier\.arm\(publishOwner\)[\s\S]*?wordpressPublishDraftBarrier\.release\(controller\)/,
  'Publish must arm its draft barrier before resolving the exact ACK and release followers only after the release request settles',
);
assert.match(
  wordpressHelpers,
  /export function createWordPressPublishDraftBarrier[\s\S]*?armedPublish !== capturedPublish[\s\S]*?waitForCapturedWordPressPublishRelease/,
  'the publish barrier must let pre-owner jobs run and wait only after the exact owner arms it',
);
assert.match(
  editor,
  /withWordPressDraftConflictRecoveryTimeout\([\s\S]*?_kodety_external_revision[\s\S]*?requestSignal/,
  'CAS conflict recovery must have a hard deadline that also aborts its workspace download',
);
assert.match(
  editor,
  /response\.status === 409[\s\S]*?&& deferConflictsToPublish[\s\S]*?publishSnapshotFallback = true[\s\S]*?pendingWordPressDraftProjectRef\.current = current \|\| next/,
  'a publish-owned draft conflict must immediately defer reconciliation instead of holding the release behind CAS recovery',
);
assert.match(
  editor,
  /response\.status === 409[\s\S]*?&& deferConflictsToPublish[\s\S]*?&& !replaceWordPressWorkspace[\s\S]*?publishSnapshotFallback = true/,
  'an explicitly requested workspace replacement must retry its exact ZIP on 409 even when Publish is waiting behind it',
);
assert.match(
  editor,
  /catch \(error\) \{[\s\S]*?if \(isAbortError\(error\)\) throw error;[\s\S]*?publishSnapshotMode = true[\s\S]*?requiresMaterializedPublish = publishSnapshotMode[\s\S]*?'X-Kodety-Publish-Snapshot': '1'[\s\S]*?'X-Kodety-Workspace-Project-Id': publishProjectId/,
  'any unavailable pre-publish save must degrade to a self-contained snapshot release while cancellation remains authoritative',
);
assert.match(
  editor,
  /response\.status === 409 && !publishSnapshotMode[\s\S]*?switchToSnapshotPublication\(\)[\s\S]*?publishRequestId = createWordPressPublishRequestId\(\)[\s\S]*?continue;/,
  'a conflict discovered by the publish endpoint must rebuild/reuse a full snapshot and retry under a fresh idempotency key',
);
assert.match(
  editor,
  /if \(publishSnapshotMode\) \{[\s\S]*?forceAutosaveAfterPublish = projectRef\.current \|\| current[\s\S]*?hasUnsavedWordPressDraftRef\.current = true[\s\S]*?wordpressPublishDraftBarrier\.release\(controller\)[\s\S]*?persistExactWordPressDraft\(snapshotToReconcile, true, undefined, false, true\)/,
  'snapshot publication must ACK the release first, retain unsaved authority and force reconciliation only after releasing the publish barrier',
);
assert.match(
  editor,
  /wordpressDraftRetryTimerRef\.current !== null[\s\S]*?clearTimeout\(wordpressDraftRetryTimerRef\.current\)[\s\S]*?releaseWorkspaceRevision[\s\S]*?'X-Kodety-Expected-Revision': String\(releaseWorkspaceRevision\)/,
  'Publish must cancel a stale autosave backoff and freeze the acknowledged release revision',
);
assert.match(
  editor,
  /const publishBlockingThisWrite = publishAbortControllerRef\.current[\s\S]*?waitForCapturedWordPressPublishRelease\([\s\S]*?publishBlockingThisWrite/,
  'Localization must wait only for the publish captured when that write entered its queue',
);
assert.match(
  editor,
  /enqueueExact\(request, \{ signal: options\.signal \}\)[\s\S]*?isAbortError\(error\)[\s\S]*?pendingWordPressDraftProjectRef\.current =[\s\S]*?hasUnsavedWordPressDraftRef\.current = true/,
  'an aborted Publish must leave the queue promptly and restore its absorbed snapshot for autosave',
);
assert.match(requestTimeout, /controller\.abort[\s\S]*?timeoutError\.name = 'TimeoutError'/);

assert.match(constants, /WORDPRESS_DRAFT_UPLOAD_CHUNK_BYTES = 4 \* 1024 \* 1024/);
assert.match(constants, /WORDPRESS_DRAFT_UPLOAD_FALLBACK_CHUNK_BYTES = 1 \* 1024 \* 1024/);
assert.match(types, /projectChunkUrl\?: string/);
assert.match(types, /projectDeltaUrl\?: string/);
assert.match(types, /projectDownloadUrl\?: string/);
assert.match(wordpressEntryConfig, /localizationStyleUrl\?: string/);
assert.match(types, /localizationSaveUrl\?: string/);
assert.match(wordpressEntryConfig, /projectChunkUrl\?: string/);
assert.match(wordpressEntryConfig, /projectDeltaUrl\?: string/);
assert.match(wordpressEntryConfig, /projectDownloadUrl\?: string/);
assert.match(
  wordpressMain,
  /startLocalizationProjectPrefetch\(entryConfig\)[\s\S]*?data-kodety-localization-style[\s\S]*?const entryReady = import[\s\S]*?Promise\.all\(\[styleReady, entryReady\]\)[\s\S]*?mountLocalization/,
  'Localization must fetch its project and extension assets in parallel, then mount after CSS is ready',
);
assert.match(
  shell,
  /app_view === 'localization'[\s\S]*?localizationStyleUrl[\s\S]*?data-kodety-localization-style[\s\S]*?rel="modulepreload"[\s\S]*?localizationEntryUrl/,
  'the PHP shell must discover the private Localization CSS and module before the core entry executes',
);
assert.match(shell, /projectChunkUrl[^\n]+rest_url\('kodety\/v1\/project\/chunk'\)/);
assert.match(shell, /projectDeltaUrl[\s\S]*?rest_url\('kodety\/v1\/project\/delta'\)/);
assert.match(
  editor,
  /config\.projectDeltaUrl[\s\S]*?createWordPressDraftDelta\(acknowledged, candidate[\s\S]*?uploadWordPressDraftDelta\([\s\S]*?isSafeWordPressDraftDeltaFallback[\s\S]*?uploadArchive\(\)/,
  'the Builder must prefer a negotiated delta and construct ZIP only behind the explicit safe fallback gate',
);
assert.match(
  editor,
  /config\.projectDeltaUrl[\s\S]*?&& !replaceWordPressWorkspace[\s\S]*?createWordPressDraftDelta\(acknowledged, candidate/,
  'a workspace replacement must bypass delta and transport the complete exact ZIP',
);
assert.match(
  editor,
  /const replacementTransportUpdatedAt = replaceWordPressWorkspace[\s\S]*?const archiveUpdatedAt = replacementTransportUpdatedAt[\s\S]*?wordpressDraftZipBuilderRef\.current!\.build\(candidate/,
  'replacement retries must preserve one transport timestamp so every 409 attempt carries the same blank snapshot',
);
const replacementConflictBranch = editor.slice(
  editor.indexOf('        if (replaceWordPressWorkspace) {'),
  editor.indexOf('\n\n        const remoteSnapshot = await withWordPressDraftConflictRecoveryTimeout(', editor.indexOf('        if (replaceWordPressWorkspace) {')),
);
assert.match(
  replacementConflictBranch,
  /result\?\.data\?\.currentRevision[\s\S]*?wordpressWorkspaceRevisionRef\.current = reportedRevision[\s\S]*?continue;/,
  'a replacement 409 must advance the remote revision and retry the same candidate',
);
assert.doesNotMatch(
  replacementConflictBranch,
  /mergeWorkspaceConflict|candidate\s*=|applyRecoveredProject/,
  'a replacement conflict must never merge remote files into the blank snapshot',
);
assert.match(
  editor,
  /const replacementProjectId = replaceWordPressWorkspace[\s\S]*?const savedProjectId = String\(result\?\.projectId[\s\S]*?savedProjectId\.toLowerCase\(\) !== replacementProjectId\.toLowerCase\(\)[\s\S]*?wordpressAcknowledgedProjectRef\.current = candidate/,
  'a replacement may become authoritative only after WordPress confirms its projectId',
);
assert.match(
  editor,
  /if \(isAbortError\(error\)\) throw error;[\s\S]*?if \(request\.replaceWordPressWorkspace\) throw error;/,
  'a failed transactional replacement must return to its confirmation instead of entering background autosave retry',
);
assert.match(
  wordpressHelpers,
  /interface WordPressDraftSavePayload \{[\s\S]*?projectId\?: string;/,
  'draft ACK typing must expose the confirmed project identity',
);
assert.doesNotMatch(
  editor,
  /wordpressDraftDeltaUnavailableRef/,
  'a compatibility fallback must be scoped to one save; delta remains the primary transport on the next revision',
);
assert.match(
  editor,
  /projectTransportDigest\(prepareProjectForDraftTransport\(candidate, archiveUpdatedAt\)\)[\s\S]*?'X-Kodety-Project-Digest': projectDigest[\s\S]*?savedProjectDigest !== archiveProjectDigest\.toLowerCase\(\)/,
  'the complete ZIP fallback must not become an acknowledged delta base without a full-tree digest round trip',
);
assert.match(
  editor,
  /const baseDigest =[\s\S]*?const deltaRequestKey = `\$\{expectedRevision\}:\$\{baseDigest\}:\$\{signature\}`[\s\S]*?requestId: deltaRequest\.requestId[\s\S]*?updatedAt: deltaRequest\.updatedAt/,
  'idempotent retries must retain both request id and generated metadata timestamp',
);
assert.match(
  draftDelta,
  /path === METADATA_PATH[\s\S]*?sameTransportBytes[\s\S]*?maxRawBytes[\s\S]*?maxBodyBytes/,
  'delta generation must always include transport metadata and remain bounded before upload',
);
assert.match(
  shell,
  /projectDownloadUrl[\s\S]*?add_query_arg\(\[[\s\S]*?'action' => 'kodety_download_editor_project'[\s\S]*?'_wpnonce' => wp_create_nonce\('kodety_download_editor_project'\)/,
  'authenticated Builder surfaces must receive the nonce-protected binary ZIP URL',
);
assert.doesNotMatch(
  shell.match(/'projectDownloadUrl'[\s\S]*?'projectChunkUrl'/)?.[0] || '',
  /wp_nonce_url/,
  'the binary URL lives in JSON and must not HTML-escape its nonce separator',
);
assert.match(
  wordpressHelpers,
  /'X-Kodety-Upload-Offset'[\s\S]*?'X-Kodety-Upload-Total'[\s\S]*?archive\.slice\(offset, end\)/,
  'large Builder drafts must be sliced before they cross the request boundary',
);
assert.match(
  wordpressHelpers,
  /projectHasOnlyLocalizationMetadataChange[\s\S]*?path === '\.incode\/project\.json'[\s\S]*?left\.data === right\.data/,
  'metadata-only localization saves must prove that every authored file and binary is unchanged',
);
assert.match(
  editor,
  /const persistExactLocalizationDraft[\s\S]*?config\?\.localizationSaveUrl[\s\S]*?projectHasOnlyLocalizationMetadataChange[\s\S]*?JSON\.stringify\(\{ localization \}\)/,
  'the main Builder must use the same revisioned metadata-only localization endpoint',
);
assert.match(
  editor,
  /const retryable = \(error as \{ retryable\?: boolean \}[\s\S]*?if \(!retryable\)[\s\S]*?throw error/,
  'permanent WordPress validation errors must not enter the autosave retry loop',
);
assert.match(
  wordpressHelpers,
  /kodety_draft_chunk_conflict[\s\S]*?expectedOffset[\s\S]*?restartWithSmallerParts/,
  'a resumable chunk 409 must not be confused with a workspace revision conflict',
);
assert.match(
  editor,
  /downloadUnsavedRecoveryZip[\s\S]*?exportZip\(snapshot,[\s\S]*?Baixar ZIP atual/,
  'a failed in-memory save must expose an exact local recovery ZIP action',
);
assert.match(
  plugin,
  /register_rest_route\('kodety\/v1', '\/project\/chunk'[\s\S]*?save_project_draft_chunk/,
  'WordPress must expose the authenticated chunk receiver',
);
assert.match(
  plugin,
  /save_project_draft_chunk[\s\S]*?fopen\(\$upload_path, 'c\+b'\)[\s\S]*?flock\(\$handle, LOCK_EX\)[\s\S]*?\$stored !== \$offset[\s\S]*?persist_project_draft_archive/,
  'the server must serialize, order-check and validate a complete draft before activation',
);
assert.match(
  plugin,
  /prepare_project_archive_request[\s\S]*?wp_raise_memory_limit\('admin'\)[\s\S]*?set_time_limit\(300\)[\s\S]*?ignore_user_abort\(true\)/,
  'the final archive activation must not inherit a short front-end REST resource budget',
);
assert.match(
  plugin,
  /write_project_zip_cache_from_file[\s\S]*?@link\(\$source, \$temporary\)[\s\S]*?PROJECT_ZIP_CACHE_COPY_MAX_BYTES/,
  'large acknowledged drafts must not fail because a best-effort cache duplicates the complete ZIP',
);
assert.match(
  plugin,
  /data-direct-max-size=[\s\S]*?data-chunk-url=[\s\S]*?data-chunk-nonce=/,
  'the wp-admin importer must advertise its bounded transport',
);
assert.match(
  plugin,
  /\$extension_archive_limit = class_exists\('Kodety_Extensions'\)[\s\S]*?Kodety_Extensions::max_archive_bytes\(\)[\s\S]*?\$extension_upload_max_size/,
  'the larger project transport must not weaken the independent extension archive limit',
);
assert.match(
  admin,
  /'X-Kodety-Admin-Import': '1'[\s\S]*?file\.slice\(offset, end\)[\s\S]*?window\.location\.assign\(result\.redirectUrl\)/,
  'large dashboard ZIPs must use chunks and continue through the normal Builder import',
);
assert.match(
  plugin,
  /complete_chunked_admin_import[\s\S]*?SUBSTITUIR[\s\S]*?stage_builder_import[\s\S]*?kodety_open_publish/,
  'chunked dashboard imports must preserve replacement confirmation, snapshot staging and manual publish review',
);
assert.match(
  plugin,
  /admin_download_editor_project[\s\S]*?prepare_project_download_archive[\s\S]*?stream_project_archive[\s\S]*?fpassthru\(\$handle\)/,
  'the post-import handoff must stream the private ZIP instead of base64-encoding it',
);
assert.match(
  plugin,
  /admin_download_project_backup[\s\S]*?prepare_project_download_archive[\s\S]*?stream_project_archive/,
  'large project backups must reuse the same constant-memory archive stream',
);
function assertAllProjectResponseBodyReadsObserved(source) {
  const allReads = [...source.matchAll(/response\.(blob|json)\(\)/g)]
    .map(match => match[1]);
  assert.deepEqual(
    allReads,
    ['json', 'blob', 'json'],
    'the project download must contain exactly the legacy-error, ZIP and legacy-success body reads',
  );

  const observedReadPattern = /observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.(blob|json)\(\),\s*\)/g;
  const observedReads = [...source.matchAll(observedReadPattern)]
    .map(match => match[1]);
  assert.deepEqual(
    observedReads,
    allReads,
    'every project response body read must be the signal-aware callback of its observer',
  );
  assert.doesNotMatch(
    source.replace(observedReadPattern, ''),
    /response\.(?:blob|json)\(\)/,
    'no direct or discarded project response body read may survive outside the observer',
  );
}

const projectDownloadStart = editor.indexOf('async function downloadWordPressProjectSnapshot(');
const projectDownloadEnd = editor.indexOf('const HtmlCmsManager = lazy(', projectDownloadStart);
assert.ok(
  projectDownloadStart >= 0 && projectDownloadEnd > projectDownloadStart,
  'missing WordPress project download boundary',
);
const projectDownload = editor.slice(projectDownloadStart, projectDownloadEnd);
assertAllProjectResponseBodyReadsObserved(projectDownload);
assert.match(
  projectDownload,
  /if \(!response\.ok\) \{[\s\S]*?const payload = !binaryDownload[\s\S]*?observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.json\(\),\s*\)\.catch\(\(\) => null\)/,
);
assert.match(
  projectDownload,
  /if \(binaryDownload\) \{[\s\S]*?const archive = await observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.blob\(\),\s*\);/,
);
assert.match(
  projectDownload,
  /const payload = \(await observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.json\(\),\s*\)\) as/,
);
const binaryBranchStart = projectDownload.indexOf(
  'if (binaryDownload) {',
  projectDownload.indexOf('if (binaryDownload && reusableCache) {') + 1,
);
const binaryBranchEnd = projectDownload.indexOf(
  '  const payload = (await observeWordPressProjectDownloadBody(',
  binaryBranchStart,
);
assert.ok(binaryBranchStart >= 0 && binaryBranchEnd > binaryBranchStart);
const binaryBranch = projectDownload.slice(binaryBranchStart, binaryBranchEnd);
assert.match(
  projectDownload,
  /const binaryDownload = Boolean\(config\.projectDownloadUrl\);/,
  'projectDownloadUrl must select the binary workspace transport',
);
assert.match(
  binaryBranch,
  /const contentType = response\.headers\.get\('Content-Type'\)\?\.toLowerCase\(\) \|\| '';[\s\S]*?!contentType\.includes\('application\/zip'\)[\s\S]*?const archive = await observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.blob\(\),\s*\);/,
  'the binary response must validate ZIP content and read its body inside the observed signal-aware boundary',
);
assert.match(
  binaryBranch,
  /if \(archive\.size <= 0\) throw new Error\('O WordPress entregou um projeto vazio\.'\);[\s\S]*?const name = decodeWordPressProjectHeader\(response, 'X-Kodety-Original-Name', 'site-kodety\.zip'\);[\s\S]*?const imported = await importZip\(new File\(\[archive\], name, \{ type: 'application\/zip' \}\)\);/,
  'the observed archive must be non-empty and retain its original name before import',
);
assert.match(
  binaryBranch,
  /name:[\s\S]*?decodeWordPressProjectHeader\(response, 'X-Kodety-Project-Name', imported\.name\)[\s\S]*?cssDigest: response\.headers\.get\('X-Kodety-CSS-Digest'\)\?\.trim\(\) \|\| ''[\s\S]*?workspaceRevision: Number\(response\.headers\.get\('X-Kodety-Workspace-Revision'\)\) \|\| 0[\s\S]*?templateDigest: response\.headers\.get\('X-Kodety-Template-Digest'\)\?\.trim\(\) \|\| ''[\s\S]*?reusedLocalSnapshot: false/,
  'binary import must preserve project name and workspace integrity headers',
);
assert.match(
  editor,
  /downloadWordPressProjectSnapshot\(config, '_kodety_project_revision', signal, matchingCache\)/,
  'the initial binary request must carry the validated local cache contract',
);
assert.match(
  editor,
  /_kodety_external_revision[\s\S]*?remoteSnapshot\.workspaceRevision/,
  'CAS conflict recovery must use the external-revision snapshot without falling back to the oversized base64 response',
);

const compiledHelpers = ts.transpileModule(wordpressHelpers, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const compiledRequestTimeout = ts.transpileModule(requestTimeout, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const compiledCssIntegrity = ts.transpileModule(cssIntegrity, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const cssIntegrityModule = { exports: {} };
new Function('exports', 'module', compiledCssIntegrity)(
  cssIntegrityModule.exports,
  cssIntegrityModule,
);
const { projectTransportDigest } = cssIntegrityModule.exports;
const requestTimeoutModule = { exports: {} };
new Function('exports', 'module', compiledRequestTimeout)(
  requestTimeoutModule.exports,
  requestTimeoutModule,
);
const helperModule = { exports: {} };
new Function('exports', 'module', 'require', compiledHelpers)(
  helperModule.exports,
  helperModule,
  specifier => {
    if (specifier === '../request-timeout') return requestTimeoutModule.exports;
    throw new Error(`Unexpected runtime dependency in upload helper: ${specifier}`);
  },
);
const {
  createWordPressExactSnapshotChangedError,
  createWordPressPublishDraftBarrier,
  isCurrentWordPressWorkspaceWrite,
  isSafeWordPressDraftDeltaFallback,
  selectLatestWordPressWorkspaceWrite,
  shouldDeferWordPressDraftRetry,
  shouldRetryWordPressExactSave,
  uploadWordPressDraftArchive,
  uploadWordPressDraftDelta,
  waitForCapturedWordPressPublishRelease,
  withWordPressDraftConflictRecoveryTimeout,
} = helperModule.exports;
const compiledProjectStorage = ts.transpileModule(projectStorage, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const projectStorageModule = { exports: {} };
new Function('exports', 'module', 'require', compiledProjectStorage)(
  projectStorageModule.exports,
  projectStorageModule,
  specifier => {
    throw new Error(`Unexpected runtime dependency in project storage: ${specifier}`);
  },
);
const { createSerializedWriteQueue } = projectStorageModule.exports;
const queueWrites = [];
const exactQueue = createSerializedWriteQueue(async value => {
  queueWrites.push(value);
  await Promise.resolve();
  return value;
});
const firstBackground = exactQueue.enqueueLatest('background-a');
const exactSave = exactQueue.enqueueExact('exact-save-b');
const coalescedBackgroundA = exactQueue.enqueueLatest('background-c');
const coalescedBackgroundB = exactQueue.enqueueLatest('background-d');
assert.deepEqual(
  await Promise.all([firstBackground, exactSave, coalescedBackgroundA, coalescedBackgroundB]),
  ['background-a', 'exact-save-b', 'background-d', 'background-d'],
  'an exact save must retain its own ACK while only the pending background checkpoint coalesces',
);
assert.deepEqual(queueWrites, ['background-a', 'exact-save-b', 'background-d']);

let workspaceFence = { workspaceEpoch: 0, projectId: 'project-a' };
let releaseActiveWorkspaceWrite;
const fencedWorkspaceTransports = [];
const fencedWorkspaceQueue = createSerializedWriteQueue(async request => {
  if (!isCurrentWordPressWorkspaceWrite(request, workspaceFence)) return `dropped:${request.label}`;
  if (request.label === 'active-a') {
    await new Promise(resolve => {
      releaseActiveWorkspaceWrite = resolve;
    });
  }
  if (!isCurrentWordPressWorkspaceWrite(request, workspaceFence)) return `dropped:${request.label}`;
  fencedWorkspaceTransports.push(request.label);
  return request.label;
}, (pending, next) => selectLatestWordPressWorkspaceWrite(pending, next, workspaceFence));
const activeWorkspaceA = fencedWorkspaceQueue.enqueueLatest({
  label: 'active-a',
  workspaceEpoch: 0,
  projectId: 'project-a',
});
await Promise.resolve();
const retryWorkspaceA = fencedWorkspaceQueue.enqueueLatest({
  label: 'retry-a',
  workspaceEpoch: 0,
  projectId: 'project-a',
});
workspaceFence = { workspaceEpoch: 1, projectId: 'project-b' };
const exactReplacementB = fencedWorkspaceQueue.enqueueExact({
  label: 'replacement-b',
  workspaceEpoch: 1,
  projectId: 'project-b',
});
const staleFollowerA = fencedWorkspaceQueue.enqueueLatest({
  label: 'follower-a',
  // A callback that wakes after the fence can observe the new epoch, so the
  // project identity must remain part of the authority check.
  workspaceEpoch: 1,
  projectId: 'project-a',
});
const legitimateEditB = fencedWorkspaceQueue.enqueueLatest({
  label: 'edit-b',
  workspaceEpoch: 1,
  projectId: 'project-b',
});
releaseActiveWorkspaceWrite();
assert.deepEqual(
  await Promise.all([
    activeWorkspaceA,
    retryWorkspaceA,
    exactReplacementB,
    staleFollowerA,
    legitimateEditB,
  ]),
  ['dropped:active-a', 'dropped:retry-a', 'replacement-b', 'edit-b', 'edit-b'],
);
assert.deepEqual(
  fencedWorkspaceTransports,
  ['replacement-b', 'edit-b'],
  'A active/retry/follower writes must be fenced out while the exact B replacement and legitimate B edit persist in order',
);

const publishBarrier = createWordPressPublishDraftBarrier();
const publishToken = new AbortController();
let activePublishTokenForQueue = publishToken;
let releasePrePublishWrite;
const publishBarrierTrace = [];
const publishBarrierQueue = createSerializedWriteQueue(async request => {
  const ownsPublishCheckpoint = request.capturedPublish
    && request.signal === request.capturedPublish.signal;
  if (!ownsPublishCheckpoint) {
    publishBarrierTrace.push(`check:${request.label}`);
    await publishBarrier.waitForRelease(
      request.capturedPublish,
      () => activePublishTokenForQueue,
      { timeoutMs: 100, pollMs: 1 },
    );
  }
  publishBarrierTrace.push(`write:${request.label}`);
  if (request.label === 'active-before-publish') {
    await new Promise(resolve => {
      releasePrePublishWrite = resolve;
    });
  }
  if (ownsPublishCheckpoint) {
    publishBarrier.arm(request.capturedPublish);
    publishBarrierTrace.push(`arm:${request.label}`);
  }
  return request.label;
});
const prePublishWrite = publishBarrierQueue.enqueueLatest({
  label: 'active-before-publish',
  capturedPublish: null,
});
await Promise.resolve();
const writeAheadOfOwner = publishBarrierQueue.enqueueExact({
  label: 'save-before-owner',
  capturedPublish: publishToken,
});
const publishOwner = publishBarrierQueue.enqueueExact({
  label: 'publish-exact',
  capturedPublish: publishToken,
  signal: publishToken.signal,
});
let followerSettled = false;
const writeBehindOwner = publishBarrierQueue.enqueueLatest({
  label: 'save-after-owner',
  capturedPublish: publishToken,
}).then(value => {
  followerSettled = true;
  return value;
});
releasePrePublishWrite();
await prePublishWrite;
assert.equal(await writeAheadOfOwner, 'save-before-owner');
assert.equal(await publishOwner, 'publish-exact');
publishBarrierTrace.push('owner-resolved');
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(
  followerSettled,
  false,
  'a background save behind the publish checkpoint must not advance its revision before POST /publish settles',
);
assert.ok(
  publishBarrierTrace.indexOf('check:save-after-owner')
    < publishBarrierTrace.indexOf('owner-resolved'),
  'the serialized drain must observe the armed barrier before the publish owner promise continuation runs',
);
activePublishTokenForQueue = null;
publishBarrier.release(publishToken);
assert.equal(await writeBehindOwner, 'save-after-owner');
assert.deepEqual(
  publishBarrierTrace.filter(entry => entry.startsWith('write:')),
  [
    'write:active-before-publish',
    'write:save-before-owner',
    'write:publish-exact',
    'write:save-after-owner',
  ],
  'writes ahead of Publish must finish, while only followers wait for release',
);

let releaseBlockingWrite;
const cancellableQueueWrites = [];
const cancellableQueue = createSerializedWriteQueue(async value => {
  cancellableQueueWrites.push(value);
  if (value === 'active-background') {
    await new Promise(resolve => {
      releaseBlockingWrite = resolve;
    });
  }
  return value;
});
const activeBackground = cancellableQueue.enqueueLatest('active-background');
await Promise.resolve();
const queuedPublishController = new AbortController();
const cancelledPublish = cancellableQueue.enqueueExact(
  'cancelled-publish',
  { signal: queuedPublishController.signal },
);
const cancelledPublishAssertion = assert.rejects(
  cancelledPublish,
  error => error instanceof Error && error.name === 'AbortError',
  'cancelling Publish must reject before a preceding background write releases the queue',
);
queuedPublishController.abort();
await cancelledPublishAssertion;
assert.deepEqual(
  cancellableQueueWrites,
  ['active-background'],
  'a cancelled pending exact snapshot must never reach the transport',
);
releaseBlockingWrite();
await activeBackground;
assert.equal(await cancellableQueue.enqueueExact('next-exact'), 'next-exact');
assert.deepEqual(cancellableQueueWrites, ['active-background', 'next-exact']);

const exactSnapshotChanged = createWordPressExactSnapshotChangedError();
assert.equal(exactSnapshotChanged.code, 'kodety_exact_snapshot_changed');
assert.equal(exactSnapshotChanged.retryable, false);
assert.equal(
  shouldRetryWordPressExactSave(exactSnapshotChanged),
  false,
  'a 409 merge that changed the exact snapshot must stop Publish instead of overwriting the merge',
);
assert.equal(shouldRetryWordPressExactSave(new Error('temporary network failure')), true);
const draftTimeout = new Error('draft timeout');
draftTimeout.name = 'TimeoutError';
assert.equal(shouldRetryWordPressExactSave(draftTimeout), false);

let activePublishToken = null;
const localizationCapturedBeforePublish = activePublishToken;
const earlierLocalization = Promise.resolve().then(() =>
  waitForCapturedWordPressPublishRelease(
    localizationCapturedBeforePublish,
    () => activePublishToken,
    { timeoutMs: 20, pollMs: 1 },
  ));
activePublishToken = {};
await earlierLocalization;
const publishThatQueuedLocalization = activePublishToken;
let laterLocalizationReleased = false;
const laterLocalization = waitForCapturedWordPressPublishRelease(
  publishThatQueuedLocalization,
  () => activePublishToken,
  { timeoutMs: 40, pollMs: 1 },
).then(() => {
  laterLocalizationReleased = true;
});
await Promise.resolve();
assert.equal(
  laterLocalizationReleased,
  false,
  'localization queued during Publish must remain behind that captured release',
);
activePublishToken = null;
await laterLocalization;
assert.equal(laterLocalizationReleased, true);

assert.equal(shouldDeferWordPressDraftRetry({}, false), true);
assert.equal(shouldDeferWordPressDraftRetry(null, true), true);
assert.equal(shouldDeferWordPressDraftRetry(null, false), false);

await assert.rejects(
  withWordPressDraftConflictRecoveryTimeout(
    () => new Promise(() => undefined),
    undefined,
    10,
  ),
  error => error instanceof Error && error.name === 'TimeoutError',
  'a hung 409 recovery GET/body/import must release the serialized draft queue on deadline',
);

await assert.rejects(
  requestTimeoutModule.exports.withRequestTimeout(
    () => new Promise(() => undefined),
    { timeoutMs: 10, timeoutMessage: 'deadline test' },
  ),
  error => error instanceof Error && error.name === 'TimeoutError' && error.message === 'deadline test',
  'a hung fetch/body transaction must reject with a deterministic timeout',
);
const compiledDelta = ts.transpileModule(draftDelta, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const deltaModule = { exports: {} };
new Function('exports', 'module', 'require', compiledDelta)(
  deltaModule.exports,
  deltaModule,
  specifier => {
    if (specifier !== './project-io') throw new Error(`Unexpected delta dependency: ${specifier}`);
    return {
      prepareProjectForDraftTransport(project, updatedAt) {
        const metadataPath = '.incode/project.json';
        const metadata = JSON.parse(project.files[metadataPath]?.text || '{}');
        return {
          ...project,
          files: {
            ...project.files,
            [metadataPath]: {
              path: metadataPath,
              mimeType: 'application/json',
              text: JSON.stringify({
                ...metadata,
                name: project.name,
                updatedAt,
                mainHtmlPath: 'index.html',
                homeHtmlPath: 'index.html',
                rootPath: project.rootPath,
              }, null, 2),
            },
          },
        };
      },
    };
  },
);
const { createWordPressDraftDelta } = deltaModule.exports;
const sharedBinary = new Uint8Array([1, 2, 3]);
const baseProject = {
  name: 'Delta test',
  mainHtmlPath: 'index.html',
  rootPath: '',
  openedAt: 1,
  files: {
    '.incode/project.json': { path: '.incode/project.json', mimeType: 'application/json', text: '{"version":1}' },
    'index.html': { path: 'index.html', mimeType: 'text/html', text: '<main>old</main>' },
    'keep.bin': { path: 'keep.bin', mimeType: 'application/octet-stream', data: sharedBinary },
    'old-name.txt': { path: 'old-name.txt', mimeType: 'text/plain', text: 'move me' },
    'remove.css': { path: 'remove.css', mimeType: 'text/css', text: '.old{}' },
  },
};
const nextProject = {
  ...baseProject,
  files: {
    '.incode/project.json': baseProject.files['.incode/project.json'],
    'asset.bin': { path: 'asset.bin', mimeType: 'application/octet-stream', data: new Uint8Array([4, 5]) },
    'index.html': { path: 'index.html', mimeType: 'text/html', text: '<main>new</main>' },
    'keep.bin': baseProject.files['keep.bin'],
    'new-name.txt': { path: 'new-name.txt', mimeType: 'text/plain', text: 'move me' },
  },
};
const baseTransportDigest = await projectTransportDigest(baseProject);
const repeatedTransportDigest = await projectTransportDigest({
  ...baseProject,
  files: Object.fromEntries(Object.entries(baseProject.files).reverse()),
});
const changedScriptTransportDigest = await projectTransportDigest({
  ...baseProject,
  files: {
    ...baseProject.files,
    'app.js': { path: 'app.js', mimeType: 'text/javascript', text: 'window.__revision = "NEW";' },
  },
});
const goldenTransportDigest = await projectTransportDigest({
  name: 'Digest golden',
  mainHtmlPath: 'index.html',
  rootPath: '',
  openedAt: 1,
  files: {
    'index.html': { path: 'index.html', mimeType: 'text/html', text: '<main>new</main>' },
    'app.js': { path: 'app.js', mimeType: 'text/javascript', text: 'window.x=1;' },
  },
});
assert.match(baseTransportDigest, /^[a-f0-9]{64}$/);
assert.equal(
  goldenTransportDigest,
  '4b48cbaa042697043b1c9d2d4b113109bfce0a27a2df58bc7f7cc13d8fd2705c',
  'browser tree digest must match the PHP transport framing contract',
);
assert.equal(repeatedTransportDigest, baseTransportDigest, 'tree digest must not depend on object insertion order');
assert.notEqual(
  changedScriptTransportDigest,
  baseTransportDigest,
  'tree digest must cover arbitrary JS/files outside the CSS/HTML integrity subset',
);
const deltaPlan = await createWordPressDraftDelta(baseProject, nextProject, {
  baseRevision: 7,
  baseDigest: 'a'.repeat(64),
  requestId: 'draft-delta-test-request-0001',
  updatedAt: '2026-08-20T12:00:00.000Z',
  maxRawBytes: 1024 * 1024,
  maxBodyBytes: 2 * 1024 * 1024,
  maxOperations: 32,
  maxPathBytes: 1024,
});
assert.equal(deltaPlan.kind, 'delta');
assert.deepEqual(deltaPlan.request.moves, [{ from: 'old-name.txt', to: 'new-name.txt' }]);
assert.deepEqual(deltaPlan.request.deletes, ['remove.css']);
assert.deepEqual(
  deltaPlan.request.upserts.map(item => item.path),
  ['.incode/project.json', 'asset.bin', 'index.html'],
  'delta must carry only changed whole files plus the generated metadata file',
);
assert.equal(deltaPlan.request.upserts.find(item => item.path === 'asset.bin')?.content, 'BAU=');
assert.match(deltaPlan.request.upserts[0].sha256, /^[a-f0-9]{64}$/);
assert.equal(JSON.parse(deltaPlan.body).requestId, 'draft-delta-test-request-0001');

const boundedFallback = await createWordPressDraftDelta(baseProject, nextProject, {
  baseRevision: 7,
  requestId: 'draft-delta-test-request-0002',
  updatedAt: '2026-08-20T12:00:00.000Z',
  maxRawBytes: 1,
  maxBodyBytes: 128,
  maxOperations: 32,
  maxPathBytes: 1024,
});
assert.deepEqual(boundedFallback, { kind: 'zip', reason: 'limit' });

assert.equal(
  isSafeWordPressDraftDeltaFallback(new Response('', { status: 501 }), null),
  true,
  'an unavailable endpoint is a pre-mutation compatibility fallback',
);
assert.equal(
  isSafeWordPressDraftDeltaFallback(
    new Response('', { status: 413 }),
    { fallbackToZip: true, safeToRetryAsZip: true },
  ),
  true,
  'an explicitly pre-mutation oversized delta may use ZIP',
);
assert.equal(
  isSafeWordPressDraftDeltaFallback(
    new Response('', { status: 415 }),
    { fallbackToZip: true, safeToRetryAsZip: true },
  ),
  true,
  'an unsupported auxiliary file may use the negotiated compatibility ZIP fallback',
);
assert.equal(
  isSafeWordPressDraftDeltaFallback(
    new Response('', { status: 422 }),
    { code: 'kodety_invalid_project_delta' },
  ),
  true,
  'a transactionally rejected delta must transparently retry through the complete ZIP transport',
);
assert.equal(
  isSafeWordPressDraftDeltaFallback(new Response('', { status: 400 }), null),
  true,
  'a malformed delta rejected before staging may retry through the complete ZIP transport',
);
assert.equal(
  isSafeWordPressDraftDeltaFallback(
    new Response('', { status: 409 }),
    { fallbackToZip: true, safeToRetryAsZip: true },
  ),
  false,
  'revision conflicts must never become a blind full-project overwrite',
);
const originalFetch = globalThis.fetch;
const fourMb = 4 * 1024 * 1024;
const oneMb = 1024 * 1024;
const archive = new Blob([new Uint8Array(9 * oneMb)]);
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

try {
  let deltaCall = null;
  globalThis.fetch = async (url, options) => {
    deltaCall = { url, options };
    return jsonResponse({ success: true, workspaceRevision: 8, transport: 'delta' });
  };
  const uploadedDelta = await uploadWordPressDraftDelta({
    body: deltaPlan.body,
    projectDeltaUrl: '/project/delta',
    headers: { 'X-WP-Nonce': 'test', 'X-Kodety-Expected-Revision': '7' },
  });
  assert.equal(uploadedDelta.response.ok, true);
  assert.equal(deltaCall.url, '/project/delta');
  assert.equal(deltaCall.options.headers['Content-Type'], 'application/json');
  assert.equal(deltaCall.options.body, deltaPlan.body);

  const adaptiveCalls = [];
  globalThis.fetch = async (_url, options) => {
    const headers = options.headers;
    const offset = Number(headers['X-Kodety-Upload-Offset']);
    const bodySize = options.body.size;
    adaptiveCalls.push({ offset, bodySize });
    if (adaptiveCalls.length === 1) return new Response('', { status: 500 });
    const received = offset + bodySize;
    return jsonResponse(received === archive.size
      ? { success: true, workspaceRevision: 2 }
      : { success: true, complete: false, received, total: archive.size });
  };
  const adaptive = await uploadWordPressDraftArchive({
    archive,
    projectUrl: '/project',
    projectChunkUrl: '/project/chunk',
    headers: { 'X-WP-Nonce': 'test' },
    chunkThresholdBytes: 1,
    chunkBytes: fourMb,
    fallbackChunkBytes: oneMb,
  });
  assert.equal(adaptive.response.ok, true);
  assert.deepEqual(
    adaptiveCalls.slice(0, 2).map(call => call.bodySize),
    [fourMb, oneMb],
    'a generic proxy 500 on a non-final 4 MB part must restart with 1 MB parts',
  );

  const resumableCalls = [];
  globalThis.fetch = async (_url, options) => {
    const headers = options.headers;
    const offset = Number(headers['X-Kodety-Upload-Offset']);
    const bodySize = options.body.size;
    resumableCalls.push({ offset, bodySize });
    if (offset === fourMb) {
      return jsonResponse({
        code: 'kodety_draft_chunk_conflict',
        message: 'resume',
        data: { status: 409, expectedOffset: 2 * fourMb },
      }, 409);
    }
    const received = offset + bodySize;
    return jsonResponse(received === archive.size
      ? { success: true, workspaceRevision: 3 }
      : { success: true, complete: false, received, total: archive.size });
  };
  const resumed = await uploadWordPressDraftArchive({
    archive,
    projectUrl: '/project',
    projectChunkUrl: '/project/chunk',
    headers: { 'X-WP-Nonce': 'test' },
    chunkThresholdBytes: 1,
    chunkBytes: fourMb,
    fallbackChunkBytes: oneMb,
  });
  assert.equal(resumed.response.ok, true);
  assert.deepEqual(
    resumableCalls.map(call => call.offset),
    [0, fourMb, 2 * fourMb],
    'the receiver expectedOffset must resume the same archive without entering workspace merge',
  );

  const semanticFailureCalls = [];
  globalThis.fetch = async (_url, options) => {
    const headers = options.headers;
    const offset = Number(headers['X-Kodety-Upload-Offset']);
    const bodySize = options.body.size;
    semanticFailureCalls.push({ offset, bodySize });
    const received = offset + bodySize;
    if (received === archive.size) {
      return jsonResponse({
        code: 'kodety_draft_chunk_failed',
        message: 'Falha real ao ativar o ZIP.',
        data: { status: 500 },
      }, 500);
    }
    return jsonResponse({ success: true, complete: false, received, total: archive.size });
  };
  const semanticFailure = await uploadWordPressDraftArchive({
    archive,
    projectUrl: '/project',
    projectChunkUrl: '/project/chunk',
    headers: { 'X-WP-Nonce': 'test' },
    chunkThresholdBytes: 1,
    chunkBytes: fourMb,
    fallbackChunkBytes: oneMb,
  });
  assert.equal(semanticFailure.response.status, 500);
  assert.equal(semanticFailure.payload?.code, 'kodety_draft_chunk_failed');
  assert.deepEqual(
    semanticFailureCalls.map(call => call.offset),
    [0, fourMb, 2 * fourMb],
    'a coded finalization failure must surface immediately instead of replaying a removed upload',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Autosave delay and large ZIP upload contracts passed.');
