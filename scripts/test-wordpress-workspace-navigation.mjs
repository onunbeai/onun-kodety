import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(path.join(root, relative), 'utf8');
const registryKey = '__kodetyWorkspaceNavigationGuards';

const [
  guardSource,
  lockNavigationSource,
  settingsSource,
  settingsHostSource,
  settingsStoreSource,
  editorSource,
  editorTopbarSource,
  localizationSource,
  cmsManagerSource,
  cmsWorkspaceSource,
] = await Promise.all([
  read('lib/html-editor/workspace-navigation.ts'),
  read('Wordpress/editor/editor-lock-navigation.ts'),
  read('app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx'),
  read('stores/useHtmlProjectSettingsStore.ts'),
  read('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlEditorTopbar.tsx'),
  read('Wordpress/editor/WordPressLocalizationWorkspace.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlCmsManager.tsx'),
  read('Wordpress/editor/WordPressCmsWorkspace.tsx'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `source must keep ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `source must keep the boundary ${end}`);
  return source.slice(startIndex, endIndex);
}

const publishToWordPressSource = sourceSection(
  editorSource,
  'const publishToWordPress = useCallback',
  'const cancelWordPressPublish = useCallback',
);

assert.match(
  guardSource,
  /globalThis[\s\S]*?Map<symbol, WorkspaceNavigationGuard>/,
  'independently emitted workspace chunks must share one navigation-guard registry',
);
assert.match(
  guardSource,
  /const guards = Array\.from\(workspaceNavigationGuards\(\)\.values\(\)\)[\s\S]*?for \(const guard of guards\)[\s\S]*?await guard\(destination\)[\s\S]*?=== false/,
  'workspace guards must run serially from a stable snapshot and stop on an explicit veto',
);
assert.match(
  lockNavigationSource,
  /requestWorkspaceNavigationWithEditorLockHandoff[\s\S]*?runWorkspaceNavigationGuards\(destination\.href\)[\s\S]*?if \(!allowed\) return false;[\s\S]*?navigateWithEditorLockHandoff\(destination\.href\)/,
  'same-tab navigation must await every workspace guard before carrying the editor-lock handoff',
);
assert.match(
  lockNavigationSource,
  /guardedNavigationRequest[\s\S]*?if \(guardedNavigationRequest\) return guardedNavigationRequest/,
  'rapid repeated clicks must share one save-and-navigation transaction',
);
assert.match(
  lockNavigationSource,
  /interceptEditorLockWorkspaceNavigation[\s\S]*?event\.preventDefault\(\)[\s\S]*?requestWorkspaceNavigationWithEditorLockHandoff\(anchor\.href\)/,
  'the document-level workspace interceptor must enter the guarded navigation path',
);
assert.match(
  settingsSource,
  /registerWorkspaceNavigationGuard\(destination => prepareSettingsLeaveRef\.current\(destination\)\)/,
  'standalone Settings must expose its current draft flush to topbar and document-level navigation',
);
assert.match(
  settingsSource,
  /const flushSettingsBeforeLeave[\s\S]*?cancelScheduledAutosave\(\);[\s\S]*?await waitForSaveQueue\(\)[\s\S]*?settingsLeaveDraftRef\.current[\s\S]*?isSiteSavedSignature\(latest\.siteDraftSignature\)[\s\S]*?isPageSavedSignature\(latest\.pageDraftSignature\)/,
  'Settings exit must cancel its two-second timer, drain Social Image transactions and inspect the post-ACK signatures',
);
assert.match(
  settingsSource,
  /data-kodety-project-settings[\s\S]*?aria-busy=\{leavingSettings \|\| undefined\}[\s\S]*?inert=\{leavingSettings\}/,
  'Settings must freeze draft controls while its final acknowledged snapshot is being flushed',
);
assert.match(
  settingsSource,
  /const enqueueSocialImageSiteAndPageSave[\s\S]*?await onSaveSite\(nextSite\);\s*await onSavePage\(path, nextPage, nextPath\);/,
  'a page Social Image catalog transaction must ACK both the site library and page assignment before exit',
);
assert.match(
  settingsSource,
  /const leaveSettings[\s\S]*?await prepareSettingsLeave\(\)[\s\S]*?const navigated = await onNavigate\(href\);[\s\S]*?navigated === false[\s\S]*?catch \(error\)[\s\S]*?leavePreparationPromiseRef\.current = null;[\s\S]*?setLeavingSettings\(false\)/,
  'Settings back must use the guarded handoff and unlock its inert surface when outer navigation fails',
);
assert.match(
  settingsHostSource,
  /onNavigate: navigateAfterSave/,
  'the Settings host must bind guarded panel exit to its ACK-aware WordPress navigation callback',
);
assert.match(
  settingsStoreSource,
  /SETTINGS_ACTION_KEYS[\s\S]*?'onNavigate'/,
  'the Settings bridge store must retain the guarded navigation callback across canonical model updates',
);
assert.match(
  editorSource,
  /const navigateAfterWordPressSave[\s\S]*?await runWorkspaceNavigationGuards\(href\)[\s\S]*?await persistExactWordPressDraft\(snapshot, false, signal\)[\s\S]*?navigateWithEditorLockHandoff\(href\)/,
  'builder-owned workspace exits must run panel guards before the final project flush and lock handoff',
);
assert.match(
  editorSource,
  /wordpressNavigationPromiseRef = useRef<Promise<boolean> \| null>\(null\)[\s\S]*?const navigateAfterWordPressSave[\s\S]*?if \(wordpressNavigationPromiseRef\.current\) return wordpressNavigationPromiseRef\.current;[\s\S]*?const navigation = \(async \(\): Promise<boolean> =>[\s\S]*?wordpressNavigationPromiseRef\.current = navigation;[\s\S]*?return navigation;/,
  'capture and component handlers must share the same in-flight save-and-navigation promise',
);
assert.match(
  editorSource,
  /void navigation\.then\([\s\S]*?navigated => \{[\s\S]*?if \(!navigated && wordpressNavigationPromiseRef\.current === navigation\)[\s\S]*?wordpressNavigationPromiseRef\.current = null;[\s\S]*?\(\) => \{[\s\S]*?wordpressNavigationPendingRef\.current = false;[\s\S]*?wordpressNavigationPromiseRef\.current === navigation[\s\S]*?wordpressNavigationPromiseRef\.current = null;/,
  'a veto, handled save failure or rejection must release the shared latch for an explicit retry',
);
assert.match(
  editorSource,
  /const navigateAfterWordPressSave[\s\S]*?if \(!canNavigate\)[\s\S]*?return false;[\s\S]*?navigateWithEditorLockHandoff\(href\);[\s\S]*?return true;[\s\S]*?catch \(error\)[\s\S]*?wordpressNavigationPendingRef\.current = false;[\s\S]*?return false;/,
  'the shared navigation promise must report veto and save failure to Settings and CMS',
);
assert.match(
  editorSource,
  /const wordpressAuthorityFenceRef = useRef<\{[\s\S]*?workspaceEpoch: number;[\s\S]*?projectId: string;[\s\S]*?const hasCurrentWordPressAuthority[\s\S]*?isCurrentWorkspaceWrite\(authority\)/,
  'publish authority must belong to the current project identity and workspace epoch',
);
assert.match(
  editorSource,
  /const advanceWordPressWorkspaceWriteFence[\s\S]*?wordpressWorkspaceWriteEpochRef\.current = fence\.workspaceEpoch;[\s\S]*?wordpressWorkspaceWriteProjectIdRef\.current = fence\.projectId;[\s\S]*?wordpressAuthorityFenceRef\.current = null;/,
  'project replacement and import must invalidate authority when advancing the workspace fence',
);
assert.equal(
  (editorSource.match(/markCurrentWordPressAuthority\(/g) || []).length,
  4,
  'only full-draft ACK, localization ACK and the two initial-snapshot branches may establish publish authority',
);
assert.match(
  editorSource,
  /wordpressWorkspaceRevisionRef\.current = savedRevision;[\s\S]*?wordpressAcknowledgedProjectRef\.current = candidate;[\s\S]*?markCurrentWordPressAuthority\(writeFence\)/,
  'a full project write may establish authority only after its revision and digest ACK are validated',
);
assert.match(
  editorSource,
  /downloadWordPressProjectSnapshot[\s\S]*?snapshot\.reusedLocalSnapshot[\s\S]*?markCurrentWordPressAuthority\(currentWordPressWorkspaceWriteFence\(\)\)[\s\S]*?openProjectRef\.current[\s\S]*?markCurrentWordPressAuthority\(currentWordPressWorkspaceWriteFence\(\)\)/,
  'both cached and downloaded initial snapshots must establish authority for their current fence',
);
assert.match(
  editorSource,
  /const persistExactLocalizationDraft[\s\S]*?result\?\.success !== true[\s\S]*?wordpressWorkspaceRevisionRef\.current = savedRevision;[\s\S]*?wordpressAcknowledgedProjectRef\.current = next;[\s\S]*?markCurrentWordPressAuthority\(writeFence\)/,
  'a validated metadata-only localization ACK must establish authority without requiring a full ZIP',
);
assert.match(
  editorSource,
  /const ensureCurrentWordPressPublishAuthority[\s\S]*?hasCurrentWordPressAuthority\(\)[\s\S]*?wordpressPublishAuthorityPromiseRef\.current[\s\S]*?currentWordPressWorkspaceWriteFence\(\)[\s\S]*?persistExactWordPressDraft\(snapshot, false, undefined, false, true, false, writeFence\)[\s\S]*?return hasCurrentWordPressAuthority\(\)/,
  'Publish must recover a failed startup read through the exact-save conflict path and require authority for that same fence',
);
assert.match(
  publishToWordPressSource,
  /isWordPressRuntime && \(isImporting \|\| !wordpressInitialLoadDone\)[\s\S]*?return false;[\s\S]*?await ensureCurrentWordPressPublishAuthority\(\)[\s\S]*?const publishSnapshot/,
  'Publish must block only startup loading/import, then establish current authority before selecting its fallback snapshot',
);
assert.doesNotMatch(
  publishToWordPressSource,
  /initialWordPressWorkspaceOpenedRef/,
  'a failed startup GET must not leave the Publish action permanently disabled',
);
assert.match(
  editorSource,
  /const wordpressPublishReady = !isWordPressRuntime \|\| Boolean\([\s\S]*?wordpressInitialLoadDone[\s\S]*?&& !isImporting[\s\S]*?\);[\s\S]*?publishReady=\{wordpressPublishReady\}/,
  'the editor must expose Publish after loading/import while authority recovery remains click-driven',
);
assert.match(
  editorTopbarSource,
  /publishReady: boolean;[\s\S]*?data-publish-trigger[\s\S]*?disabled=\{!publishReady \|\| isPublishing\}/,
  'the visible Publish trigger must stay disabled before hydration or during a release',
);
assert.match(
  editorSource,
  /publishAvailable=\{Boolean\([\s\S]*?topbarWp\?\.canPublish[\s\S]*?&& wordpressPublishReady[\s\S]*?&& !isShopifyThemeProject\(project\)/,
  'the publish overlay must remain unavailable behind the same WordPress readiness gate',
);
assert.match(
  localizationSource,
  /const flushLatestProject[\s\S]*?await flushPendingSave\(\);[\s\S]*?await activeAgentMutation;[\s\S]*?await flushPendingSave\(\);[\s\S]*?latest === acknowledgedProjectRef\.current[\s\S]*?agentMutationChainRef\.current === activeAgentMutation/,
  'Localization exit must wait for agent mutations and the latest acknowledged metadata revision',
);
assert.match(
  localizationSource,
  /const prepareNavigation[\s\S]*?await flushLatestProject\(\)[\s\S]*?catch \(error\)[\s\S]*?return false;[\s\S]*?registerWorkspaceNavigationGuard\(prepareNavigation\)/,
  'Localization must veto every workspace exit when its pending metadata save cannot be acknowledged',
);
assert.match(
  localizationSource,
  /const navigateAfterSave[\s\S]*?if \(!\(await prepareNavigation\(\)\)\) return;[\s\S]*?navigateWithEditorLockHandoff\(href\)/,
  'Localization back must reuse the same save barrier and preserve the editor-lock handoff',
);
assert.match(
  cmsManagerSource,
  /cellMutationChainsRef = useRef\(new Map<string, Promise<boolean>>\(\)\)[\s\S]*?const waitForInlineMutations[\s\S]*?while \(cellMutationChainsRef\.current\.size > 0\)[\s\S]*?Promise\.allSettled\(pending\)[\s\S]*?outcome\.status === 'rejected' \|\| outcome\.value === false[\s\S]*?cellMutationPendingCountRef\.current === 0/,
  'CMS exit must drain every chained inline mutation and veto after any failed write',
);
assert.match(
  cmsManagerSource,
  /cmsLeaveDraftRef\.current = \{ editingDirty, fieldsDirty, saveItem, saveFields \}[\s\S]*?const flushLatestCmsDrafts[\s\S]*?for \(let pass = 0; pass < 3; pass \+= 1\)[\s\S]*?saveItemInFlightRef\.current[\s\S]*?await waitForCmsStateCommit\(\)[\s\S]*?cmsLeaveDraftRef\.current[\s\S]*?!latest\.editingDirty[\s\S]*?await latest\.saveItem\(\)[\s\S]*?saveItemInFlightRef\.current[\s\S]*?cmsLeaveDraftRef\.current\.editingDirty[\s\S]*?return false/,
  'CMS exit must re-read newer item drafts after each ACK and veto if three drain passes cannot stabilize them',
);
assert.match(
  cmsManagerSource,
  /for \(let pass = 0; pass < 3; pass \+= 1\)[\s\S]*?saveFieldsInFlightRef\.current[\s\S]*?await waitForCmsStateCommit\(\)[\s\S]*?cmsLeaveDraftRef\.current[\s\S]*?!latest\.fieldsDirty[\s\S]*?await latest\.saveFields\(\)[\s\S]*?saveFieldsInFlightRef\.current[\s\S]*?cmsLeaveDraftRef\.current\.fieldsDirty[\s\S]*?return false/,
  'CMS exit must re-read newer field drafts after each ACK and veto if three drain passes cannot stabilize them',
);
assert.match(
  cmsManagerSource,
  /const saveBeforeWorkspaceNavigation[\s\S]*?leavePreparationPromiseRef\.current[\s\S]*?return flushLatestCmsDrafts\(\)[\s\S]*?prepareCmsLeaveRef\.current = saveBeforeWorkspaceNavigation[\s\S]*?if \(!open\) return;[\s\S]*?registerWorkspaceNavigationGuard\(\(\) => prepareCmsLeaveRef\.current\(\)\)[\s\S]*?unregister\(\)/,
  'CMS must register its save barrier only while mounted and unregister it on cleanup',
);
assert.match(
  cmsManagerSource,
  /data-kodety-cms-manager[\s\S]*?aria-busy=\{\(leavingCms \|\| saving \|\| fieldsSaving\) \|\| undefined\}[\s\S]*?inert=\{leavingCms \|\| saving \|\| fieldsSaving\}/,
  'CMS must freeze its drafts while an acknowledged leave transaction is draining them',
);
assert.match(
  cmsManagerSource,
  /const leaveManager[\s\S]*?const navigated = await onNavigate\(href\);[\s\S]*?if \(navigated === false\)[\s\S]*?leavePreparationPromiseRef\.current = null;[\s\S]*?setLeavingCms\(false\)/,
  'CMS must unlock its inert surface when the outer workspace navigation is vetoed or fails',
);
assert.match(
  cmsManagerSource,
  /const saveItem = useCallback\(\(\): Promise<boolean>[\s\S]*?const saveFields = useCallback\(\(\): Promise<boolean>/,
  'CMS item and field saves must expose acknowledgement status to the navigation guard',
);
assert.match(
  cmsWorkspaceSource,
  /function navigate[\s\S]*?requestWorkspaceNavigationWithEditorLockHandoff\(href \|\| fallback\)/,
  'the standalone CMS topbar must enter the guarded navigation path',
);

const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

const previousWindow = globalThis.window;
const previousRegistry = globalThis[registryKey];

try {
  delete globalThis[registryKey];
  const guardsA = await server.ssrLoadModule('/lib/html-editor/workspace-navigation.ts?guard-copy=a');
  const guardsB = await server.ssrLoadModule('/lib/html-editor/workspace-navigation.ts?guard-copy=b');

  const order = [];
  let releaseFirst;
  const firstPending = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const unregisterFirst = guardsA.registerWorkspaceNavigationGuard(async destination => {
    order.push(`first:${destination}`);
    await firstPending;
  });
  const unregisterSecond = guardsB.registerWorkspaceNavigationGuard(destination => {
    order.push(`second:${destination}`);
  });
  const orderedRun = guardsB.runWorkspaceNavigationGuards('https://kodety.test/kodety/editor/');
  await Promise.resolve();
  assert.deepEqual(
    order,
    ['first:https://kodety.test/kodety/editor/'],
    'a later guard must not overtake an earlier asynchronous save',
  );
  releaseFirst();
  assert.equal(await orderedRun, true);
  assert.deepEqual(order, [
    'first:https://kodety.test/kodety/editor/',
    'second:https://kodety.test/kodety/editor/',
  ]);
  unregisterFirst();
  unregisterSecond();

  let guardAfterVetoRan = false;
  const unregisterVeto = guardsA.registerWorkspaceNavigationGuard(() => false);
  const unregisterAfterVeto = guardsB.registerWorkspaceNavigationGuard(() => {
    guardAfterVetoRan = true;
  });
  assert.equal(
    await guardsA.runWorkspaceNavigationGuards('https://kodety.test/kodety/cms/'),
    false,
  );
  assert.equal(guardAfterVetoRan, false, 'a veto must stop navigation before later guards run');
  unregisterVeto();
  unregisterAfterVeto();
  assert.equal(
    await guardsB.runWorkspaceNavigationGuards('https://kodety.test/kodety/cms/'),
    true,
    'unmounted workspaces must leave no stale guard behind',
  );

  const assigned = [];
  const departures = [];
  const navigationEvents = new EventTarget();
  navigationEvents.addEventListener('kodety:builder-workspace-navigation', event => departures.push(event.detail.href));
  globalThis.window = {
    dispatchEvent: event => navigationEvents.dispatchEvent(event),
    location: {
      href: 'https://kodety.test/kodety/settings/?section=general',
      origin: 'https://kodety.test',
      pathname: '/kodety/settings/',
      search: '?section=general',
      hash: '',
      assign: destination => assigned.push(destination),
      replace: destination => assigned.push(destination),
    },
    history: { state: null, replaceState() {} },
    kodetyEditorSession: 'abcdefghijklmnop',
  };

  const lockNavigation = await server.ssrLoadModule(
    '/Wordpress/editor/editor-lock-navigation.ts?guard-runtime=pending',
  );
  const entryConfig = await server.ssrLoadModule('/Wordpress/editor/wordpress-entry-config.ts');
  for (const appView of ['editor', 'settings', 'localization', 'cms', 'analytics', 'members', 'templates', 'kodefy']) {
    const config = { appView, editorLockUrl: '/wp-json/kodety/v1/editor-lock', nonce: 'test' };
    assert.equal(
      entryConfig.wordpressEntryEditorLockEnabled(config, { pathname: `/kodety/${appView}/` }),
      appView === 'editor',
      `${appView} must acquire an editor lease only when it is the visual editor`,
    );
    assert.equal(
      new URL(lockNavigation.editorLockHandoffUrl(`/kodety/${appView}/?kodety_editor_handoff=stale_identity_1234`)).searchParams.has('kodety_editor_handoff'),
      appView === 'editor',
      `${appView} must receive a session handoff only when it is the visual editor`,
    );
  }
  assert.equal(entryConfig.wordpressEntryEditorLockEnabled(
    { appView: 'editor', editorLockUrl: '/lock', nonce: 'test' },
    { pathname: '/kodety/localization/' },
  ), false, 'the URL-owned Languages entry must ignore the editor lock from an older cached shell');
  assert.equal(entryConfig.wordpressEntryEditorLockEnabled(
    { appView: 'editor', nonce: 'test' }, { pathname: '/kodety/editor/' },
  ), false, 'an absent lock endpoint must not create a session');
  let releaseSave;
  let observedDestination = '';
  const pendingSave = new Promise(resolve => {
    releaseSave = resolve;
  });
  const unregisterPending = guardsA.registerWorkspaceNavigationGuard(async destination => {
    observedDestination = destination;
    await pendingSave;
  });
  const firstNavigation = lockNavigation.requestWorkspaceNavigationWithEditorLockHandoff(
    'https://kodety.test/kodety/editor/',
  );
  const repeatedNavigation = lockNavigation.requestWorkspaceNavigationWithEditorLockHandoff(
    'https://kodety.test/kodety/editor/',
  );
  assert.equal(repeatedNavigation, firstNavigation, 'rapid clicks must reuse the active request');
  await Promise.resolve();
  assert.equal(observedDestination, 'https://kodety.test/kodety/editor/');
  assert.deepEqual(assigned, [], 'location.assign must not run while the draft ACK is pending');
  assert.deepEqual(departures, [], 'onboarding must not prepare a departure before the save guard succeeds');
  releaseSave();
  assert.equal(await firstNavigation, true);
  assert.equal(assigned.length, 1);
  assert.deepEqual(departures, ['https://kodety.test/kodety/editor/'], 'native navigation prepares the requested workspace before adding the lease');
  assert.equal(
    new URL(assigned[0]).searchParams.get('kodety_editor_handoff'),
    'abcdefghijklmnop',
    'the guarded destination must preserve the logical editor tab identity',
  );
  unregisterPending();

  assigned.length = 0;
  departures.length = 0;
  const rejectedNavigation = await server.ssrLoadModule(
    '/Wordpress/editor/editor-lock-navigation.ts?guard-runtime=rejected',
  );
  const unregisterRejected = guardsB.registerWorkspaceNavigationGuard(() => false);
  assert.equal(
    await rejectedNavigation.requestWorkspaceNavigationWithEditorLockHandoff(
      'https://kodety.test/kodety/analytics/',
    ),
    false,
  );
  assert.deepEqual(assigned, [], 'a failed save must keep the current workspace mounted');
  assert.deepEqual(departures, [], 'a vetoed save must not prepare onboarding in another workspace');
  unregisterRejected();
  await Promise.resolve();
  assert.equal(
    await rejectedNavigation.requestWorkspaceNavigationWithEditorLockHandoff(
      'https://kodety.test/kodety/analytics/',
    ),
    true,
    'a vetoed request must release its latch so the author can retry',
  );
  assert.equal(assigned.length, 1);

  assigned.length = 0;
  const erroredNavigation = await server.ssrLoadModule(
    '/Wordpress/editor/editor-lock-navigation.ts?guard-runtime=errored',
  );
  const unregisterErrored = guardsA.registerWorkspaceNavigationGuard(() => {
    throw new Error('simulated save failure');
  });
  await assert.rejects(
    erroredNavigation.requestWorkspaceNavigationWithEditorLockHandoff(
      'https://kodety.test/kodety/cms/',
    ),
    /simulated save failure/,
  );
  assert.deepEqual(assigned, [], 'a thrown save failure must never fall through to location.assign');
  unregisterErrored();
  await Promise.resolve();
  assert.equal(
    await erroredNavigation.requestWorkspaceNavigationWithEditorLockHandoff(
      'https://kodety.test/kodety/cms/',
    ),
    true,
    'a rejected guard must also release the navigation latch for an explicit retry',
  );
  assert.equal(assigned.length, 1);

  assigned.length = 0;
  const externalNavigation = await server.ssrLoadModule(
    '/Wordpress/editor/editor-lock-navigation.ts?guard-runtime=external',
  );
  assert.equal(
    await externalNavigation.requestWorkspaceNavigationWithEditorLockHandoff(
      'https://external.test/kodety/editor/',
    ),
    false,
  );
  assert.deepEqual(assigned, [], 'the guarded helper must not navigate to an untrusted origin');
} finally {
  if (previousRegistry === undefined) delete globalThis[registryKey];
  else globalThis[registryKey] = previousRegistry;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  await server.close();
}

console.log('WordPress workspace navigation guards: serialization, veto, retry and lock handoff passed.');
