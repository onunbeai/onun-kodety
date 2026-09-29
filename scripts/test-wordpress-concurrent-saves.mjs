import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import ts from 'typescript';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const storage = new Map();
globalThis.window = {
  location: new URL('https://kodety.test/wp-admin/admin.php?page=kodety-settings'),
  sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
  setTimeout, clearTimeout,
};
const metaPath = '.incode/project.json';
const file = (path, text, mimeType = 'text/html') => ({ path, text, mimeType });
const project = (metadata = {}, extra = {}) => ({ name: 'Shared', openedAt: 1, rootPath: '', mainHtmlPath: 'index.html', files: {
  'index.html': file('index.html', '<h1>Title</h1><p>Copy</p>'),
  [metaPath]: file(metaPath, JSON.stringify({ version: 1, projectId: 'shared', ...metadata }), 'application/json'),
  ...extra,
} });
const metadata = value => JSON.parse(value.files[metaPath].text);
const ref = current => ({ current });
try {
  const { mergeWorkspaceConflictStrict: merge, rebaseQueuedWorkspaceProject: rebase } = await server.ssrLoadModule('/lib/html-editor/collaborative-merge.ts');
  const base = project({ settings: { title: 'Before', description: 'Before', remove: true }, rows: [1, 2] });
  const local = project({ settings: { title: 'Local', description: 'Before', remove: true }, rows: [1, 2] }, { 'local.html': file('local.html', 'local') });
  const remote = project({ settings: { title: 'Before', description: 'Remote', remove: true }, rows: [1, 2] }, { 'remote.html': file('remote.html', 'remote') });
  const untouched = JSON.stringify([base, local, remote]);
  const composed = merge(base, local, remote);
  assert.deepEqual(metadata(composed.project).settings, { title: 'Local', description: 'Remote', remove: true });
  assert.equal(composed.project.files['local.html'].text, 'local');
  assert.equal(composed.project.files['remote.html'].text, 'remote');
  assert.deepEqual(composed.recoveredPaths, []);
  assert.equal(JSON.stringify([base, local, remote]), untouched, 'all source snapshots remain intact');
  const rejects = (b, l, r, expectedPath) => assert.throws(() => merge(b, l, r), error => {
    assert.equal(error.name, 'WorkspaceContentConflictError');
    assert.equal(error.retryable, false);
    assert.equal(error.preserveLocalDraft, true);
    assert.equal(error.local, l);
    assert.equal(error.remote, r);
    assert.ok(error.conflictingPaths.some(value => value.includes(expectedPath)));
    return true;
  });
  rejects(base, local, project({ settings: { title: 'Other', description: 'Before', remove: true }, rows: [1, 2] }), '/title');
  const deleted = project({ settings: { title: 'Before', description: 'Before' }, rows: [1, 2] });
  rejects(base, deleted, project({ settings: { title: 'Before', description: 'Before', remove: false }, rows: [1, 2] }), '/remove');
  const withoutHtml = { ...base, files: { [metaPath]: base.files[metaPath] } };
  rejects(base, withoutHtml, { ...base, files: { ...base.files, 'index.html': file('index.html', 'Remote') } }, 'index.html');
  rejects(base, { ...base, files: { ...base.files, 'index.html': file('index.html', 'Local') } }, { ...base, files: { ...base.files, 'index.html': file('index.html', 'Remote') } }, 'index.html');
  rejects(base, project({ settings: metadata(base).settings, rows: [1, 2, 3] }), project({ settings: metadata(base).settings, rows: [0, 1, 2] }), '/rows');
  const { prepareProjectForDraftTransport } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const normalizedBase = prepareProjectForDraftTransport(base, '2026-09-15T10:00:00.000Z');
  const normalizedLocal = prepareProjectForDraftTransport(local, '2026-09-15T10:01:00.000Z');
  const normalizedRemote = prepareProjectForDraftTransport(remote, '2026-09-15T10:02:00.000Z');
  assert.deepEqual(metadata(merge(normalizedBase, normalizedLocal, normalizedRemote).project).settings, { title: 'Local', description: 'Remote', remove: true }, 'generated timestamps and transport normalization cannot invent authored conflicts');
  const localText = { ...base, files: { ...base.files, 'index.html': file('index.html', '<h1>Local</h1><p>Copy</p>') } };
  const remoteText = { ...base, files: { ...base.files, 'index.html': file('index.html', '<h1>Title</h1><p>Remote</p>') } };
  assert.equal(merge(base, localText, remoteText).project.files['index.html'].text, '<h1>Local</h1><p>Remote</p>');
  const withCss = text => ({ ...base, files: { ...base.files, 'styles.css': file('styles.css', text, 'text/css') } });
  rejects(withCss('.box{width:100px}'), withCss('.box{width:120px}'), withCss('.box{width:101px}'), 'styles.css');
  assert.equal(merge(withCss('.box{width:100px;height:10px}'), withCss('.box{width:120px;height:10px}'), withCss('.box{width:100px;height:20px}')).project.files['styles.css'].text, '.box{width:120px;height:20px}');
  const withTag = text => ({ ...base, files: { ...base.files, 'index.html': file('index.html', text) } });
  rejects(withTag('<div data-size="100"></div>'), withTag('<div data-size="120"></div>'), withTag('<div data-size="101"></div>'), 'index.html');
  const sequential = project({ settings: { title: 'Local plus typing', description: 'Before', remove: true }, rows: [1, 2] }, { 'local.html': file('local.html', 'local') });
  assert.deepEqual(metadata(rebase(base, sequential, composed.project, local)).settings, { title: 'Local plus typing', description: 'Remote', remove: true }, 'a queued save preserves subsequent typing and changes merged into its own prior ACK');

  const transport = await server.ssrLoadModule('/Wordpress/editor/wordpress-project-surface.ts');
  const config = { nonce: 'concurrency', projectSurfaceUrl: 'https://kodety.test/project/surface', projectDeltaUrl: 'https://kodety.test/project/delta', siteUrl: 'https://kodety.test/' };
  const snapshot = p => ({ project: p, workspaceRevision: 7, workspaceDigest: 'a'.repeat(64), templateDigest: 'b'.repeat(64), loadedAt: 1, source: 'network' });
  for (const conflict of [false, true]) {
    storage.clear();
    const writes = [];
    const remoteProject = conflict ? project({ settings: { title: 'Other', description: 'Before', remove: true }, rows: [1, 2] }) : remote;
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') {
        writes.push({ revision: options.headers['X-Kodety-Expected-Revision'], body: JSON.parse(options.body) });
        if (writes.length === 1) return Response.json({ code: 'kodety_workspace_conflict', data: { currentRevision: 8 } }, { status: 409 });
        return Response.json({ success: true, workspaceRevision: 9, cssDigest: 'c'.repeat(64), savedAt: new Date().toISOString() });
      }
      return Response.json({ success: true, project: remoteProject, workspaceRevision: 8, workspaceDigest: 'd'.repeat(64), templateDigest: 'b'.repeat(64) });
    };
    if (conflict) {
      await assert.rejects(transport.persistWordPressProjectSurface(config, snapshot(base), local, { surface: 'settings' }), error => error.name === 'WorkspaceContentConflictError');
      assert.equal(writes.length, 1, 'conflicting metadata cannot trigger a second write');
    } else {
      const saved = await transport.persistWordPressProjectSurface(config, snapshot(base), local, { surface: 'settings' });
      assert.deepEqual(metadata(saved.project).settings, { title: 'Local', description: 'Remote', remove: true });
      assert.deepEqual(writes.map(write => write.revision), ['7', '8']);
      const savedMeta = JSON.parse(writes[1].body.upserts.find(entry => entry.path === metaPath).content);
      assert.equal(savedMeta.settings.description, 'Remote', 'retry payload, not just UI, retains remote changes');
      assert.ok(!writes[1].body.deletes.includes('remote.html'), 'retry cannot delete a remotely added file');
    }
  }

  for (const area of [
    { file: 'WordPressSettingsWorkspace.tsx', method: 'persistExactDraft', next: 'commitProject', ack: 'acknowledgedSnapshotRef', state: 'snapshotRef' },
    { file: 'WordPressAnalyticsWorkspace.tsx', method: 'persistFullProject', next: 'commitFullProject', ack: 'acknowledgedFullSnapshotRef', state: 'fullSnapshotRef' },
    { file: 'WordPressAnalyticsWorkspace.tsx', method: 'persistAnalyticsSurfaceProject', next: 'commitAnalyticsSurfaceProject', ack: 'acknowledgedSurfaceSnapshotRef', state: 'surfaceSnapshotRef' },
  ]) {
    const source = await readFile(path.join(root, 'Wordpress/editor', area.file), 'utf8');
    const start = source.indexOf(`  const ${area.method} = useCallback`);
    const end = source.indexOf(`\n\n  const ${area.next}`, start);
    assert.ok(start >= 0 && end > start, `${area.method} callback exists`);
    const implementation = source.slice(start, end)
      .replaceAll("import('./wordpress-project-surface')", 'Promise.resolve(injectedTransport)')
      .replaceAll("import('@/lib/html-editor/collaborative-merge')", 'Promise.resolve(mergeModule)');
    const compiled = ts.transpileModule(`${implementation}\nreturn ${area.method};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    let firstStarted;
    const started = new Promise(resolve => { firstStarted = resolve; });
    const sent = [];
    const env = {
      config: {}, readOnly: false, view: 'utm', useCallback: value => value,
      mergeModule: { mergeWorkspaceConflictStrict: merge, rebaseQueuedWorkspaceProject: rebase },
      injectedTransport: { persistWordPressProjectSurface: async (_config, previous, candidate) => {
        sent.push(candidate);
        if (sent.length === 1) { firstStarted(); await firstGate; }
        return { ...previous, project: sent.length === 1 ? merge(base, candidate, remote).project : candidate, workspaceRevision: previous.workspaceRevision + 1 };
      } },
      saveChainRef: ref(Promise.resolve()), authoredAcknowledgementsRef: ref(new WeakMap()), confirmedAuthoredProjectsRef: ref(new WeakSet()), localEpochRef: ref(0),
      projectRef: ref(local), fullProjectRef: ref(local),
      snapshotRef: ref({ ...snapshot(base), project: local }), fullSnapshotRef: ref(null), surfaceSnapshotRef: ref(null),
      acknowledgedSnapshotRef: ref(null), acknowledgedFullSnapshotRef: ref(null), acknowledgedSurfaceSnapshotRef: ref(null),
      writeReadyRevisionRef: ref(7), surfaceWriteReadyRevisionRef: ref(7),
      surfaceRequestEpochRef: ref(0), surfaceRequestRef: ref(null), fullRequestEpochRef: ref(0), fullRequestRef: ref(null),
      setWriteReady() {}, setSnapshot() {}, setFullSnapshot() {}, setSurfaceSnapshot() {}, setSurfaceDisplayProject() {},
      setSurfaceWriteReady() {}, setSurfaceError() {}, setSurfaceSaving() {}, setFullLoading() {},
      loadSurface() {}, loadFullProject() {},
    };
    env[area.ack].current = snapshot(base);
    env[area.state].current = { ...snapshot(base), project: local };
    const persist = new Function(...Object.keys(env), compiled)(...Object.values(env));
    const first = persist(local);
    await started;
    env.projectRef.current = sequential;
    env.fullProjectRef.current = sequential;
    env[area.state].current = { ...snapshot(base), project: sequential };
    env.localEpochRef.current++;
    const second = persist(sequential);
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(sent.length, 2);
    assert.deepEqual(metadata(sent[1]).settings, { title: 'Local plus typing', description: 'Remote', remove: true }, `${area.method}: queued write retains typing and prior remote changes`);
    assert.equal(metadata(env[area.state].current.project).settings.description, 'Remote', `${area.method}: the UI also preserves remote data`);
    if (area.method === 'persistExactDraft') {
      const commitStart = source.indexOf('  const commitProject = useCallback');
      const commitEnd = source.indexOf('\n\n  useWordPressNativePanelAgent', commitStart);
      const code = ts.transpileModule(`${source.slice(commitStart, commitEnd)}\nreturn commitProject;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const commit = new Function(...Object.keys(env), code)(...Object.values(env));
      commit(sequential);
      assert.equal(metadata(env.projectRef.current).settings.description, 'Remote', 'post-save commit cannot reinstall the stale requested snapshot');
      const requested = project({ settings: { title: 'Deferred commit', description: 'Remote', remove: true }, rows: [1, 2] });
      const beforeDeferredSave = env.projectRef.current;
      await persist(requested);
      assert.notEqual(env.projectRef.current, beforeDeferredSave);
      assert.equal(metadata(env.projectRef.current).settings.title, 'Deferred commit', 'a dialog that persists before committing keeps its newly saved value');
      commit(requested);
      assert.equal(metadata(env.projectRef.current).settings.title, 'Deferred commit');
    }

  }

  const visualSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8');
  const queueStart = visualSource.indexOf('  const wordpressDraftWriteQueue = useMemo(');
  const queueEnd = visualSource.indexOf('\n\n  const enqueueWordPressDraftWrite', queueStart);
  const queueCode = ts.transpileModule(`${visualSource.slice(queueStart, queueEnd)}\nreturn wordpressDraftWriteQueue;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const authoredExpression = visualSource.match(/let authoredCandidate = ([^;]+);/)?.[1];
  assert.ok(authoredExpression, 'the visual writer tracks original authored input');
  const authoredInput = new Function('writeFence', 'next', `return ${authoredExpression};`);
  const { createSerializedWriteQueue } = await server.ssrLoadModule('/lib/html-editor/project-storage.ts');
  let releaseVisualFirst;
  let visualStarted;
  const visualGate = new Promise(resolve => { releaseVisualFirst = resolve; });
  const visualFirst = new Promise(resolve => { visualStarted = resolve; });
  const visualWrites = [];
  const visualEnv = {
    useMemo: value => value(), createSerializedWriteQueue,
    rebaseQueuedWorkspaceProject: rebase,
    wordpressDraftActiveSignalRef: ref(null), wordpressAcknowledgedProjectRef: ref(base),
    wordpressAuthoredAcknowledgementsRef: ref(new WeakMap()), publishAbortControllerRef: ref(null),
    pendingWordPressDraftProjectRef: ref(null), wordpressDraftRetryTimerRef: ref(null),
    wordpressPublishDraftBarrier: { waitForRelease: async () => {}, arm() {} },
    WORDPRESS_PUBLISH_REQUEST_TIMEOUT_MS: 1000,
    isCurrentWorkspaceWrite: () => true, currentWordPressWorkspaceWriteFence: () => ({ workspaceEpoch: 1, projectId: 'shared' }),
    createWordPressWorkspaceWriteSupersededError: () => new Error('superseded'),
    selectLatestWordPressWorkspaceWrite: (_pending, next) => next,
    projectSignature: value => JSON.stringify(value), wordpressConfig: () => null,
    downloadUnsavedRecoveryZip() {}, isWordPressRuntime: true,
    persistWordPressDraft: async (candidate, _signal, _force, _defer, _replace, request) => {
      const saved = visualWrites.length === 0 ? merge(base, candidate, remote).project : candidate;
      visualWrites.push(saved);
      if (visualWrites.length === 1) { visualStarted(); await visualGate; }
      visualEnv.wordpressAcknowledgedProjectRef.current = saved;
      visualEnv.wordpressAuthoredAcknowledgementsRef.current.set(saved, authoredInput(request, candidate));
    },
  };
  const queue = new Function(...Object.keys(visualEnv), queueCode)(...Object.values(visualEnv));
  const finalTyping = project({ settings: { title: 'Third queued keystroke', description: 'Before', remove: true }, rows: [1, 2] }, { 'local.html': file('local.html', 'local') });
  const visualRequest = value => ({ project: value, baseProject: base, exact: true, workspaceEpoch: 1, projectId: 'shared' });
  const firstVisualWrite = queue.enqueueExact(visualRequest(local));
  await visualFirst;
  const secondVisualWrite = queue.enqueueExact(visualRequest(sequential));
  const thirdVisualWrite = queue.enqueueExact(visualRequest(finalTyping));
  releaseVisualFirst();
  await Promise.all([firstVisualWrite, secondVisualWrite, thirdVisualWrite]);
  assert.equal(visualWrites.length, 3);
  assert.deepEqual(metadata(visualWrites[2]).settings, { title: 'Third queued keystroke', description: 'Remote', remove: true }, 'third visual queued write retains the remote change from the first ACK');

  // The debounce can fire only after the in-flight merge receives its ACK.
  // Exercise the production 409 branch, timer callback and enqueue callback.
  const mergeStart = visualSource.indexOf('        const liveLocal = projectRef.current || candidate;');
  const mergeEnd = visualSource.indexOf('        beginWordPressFirstCanvasVisualReady();', mergeStart)
    + '        beginWordPressFirstCanvasVisualReady();'.length;
  assert.ok(mergeStart >= 0 && mergeEnd > mergeStart);
  const mergeCode = ts.transpileModule(`let candidate = requested; let authoredCandidate = originalAuthored;\n${visualSource.slice(mergeStart, mergeEnd)}\nreturn { candidate, authoredCandidate };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  visualEnv.wordpressAcknowledgedProjectRef.current = base;
  visualEnv.pendingWordPressDraftProjectRef.current = finalTyping;
  const debounceProjectRef = ref(finalTyping);
  const pendingLocalization = ref({ project: finalTyping, marker: 'preserve-envelope' });
  const recoveredStart = visualSource.indexOf('  const applyRecoveredProject = useCallback(');
  const recoveredEnd = visualSource.indexOf('\n\n  ', visualSource.indexOf('    [forceCanonicalCanvasRefresh],', recoveredStart));
  const recoveredCode = ts.transpileModule(`${visualSource.slice(recoveredStart, recoveredEnd)}\nreturn applyRecoveredProject;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const recoveredEnv = {
    useCallback: value => value, projectRef: debounceProjectRef,
    ensureProjectIdentity: value => value, sanitizeProjectPriorities: value => value,
    pendingWordPressDraftProjectRef: visualEnv.pendingWordPressDraftProjectRef,
    pendingLocalizationDraftProjectRef: pendingLocalization,
    wordpressDraftTransportSizeEstimateRef: ref(0), projectTransportSize: () => 1,
    projectRevisionRef: ref(1), canvasProjectRef: ref(finalTyping), canvasProjectRevisionRef: ref(1),
    historyIndexRef: ref(0), HISTORY_LIMIT: 20,
    setProject() {}, setCanvasProject() {}, setHistory: callback => callback([finalTyping]), setHistoryIndex() {},
    forceCanonicalCanvasRefresh() {}, toast: { warning() {} },
  };
  const applyRecovered = new Function(...Object.keys(recoveredEnv), recoveredCode)(...Object.values(recoveredEnv));
  const mergeEnv = {
    requested: local, originalAuthored: local, remote, result: { data: { currentRevision: 8 } }, expectedRevision: 7,
    remoteSnapshot: { project: remote, workspaceRevision: 8, cssDigest: 'c'.repeat(64), templateDigest: 'd'.repeat(64) },
    projectRef: debounceProjectRef, mergeWorkspaceConflictStrict: merge,
    wordpressAcknowledgedProjectRef: visualEnv.wordpressAcknowledgedProjectRef,
    pendingWordPressDraftProjectRef: visualEnv.pendingWordPressDraftProjectRef,
    wordpressWorkspaceRevisionRef: ref(7), wordpressCssDigestRef: ref(''), wordpressTemplateDigestRef: ref(''),
    applyRecoveredProject: applyRecovered, beginWordPressFirstCanvasVisualReady() {},
  };
  const recovered = new Function(...Object.keys(mergeEnv), mergeCode)(...Object.values(mergeEnv));
  const remoteTwice = {
    ...remote,
    files: {
      ...remote.files,
      [metaPath]: file(metaPath, JSON.stringify({ ...metadata(remote), settings: { ...metadata(remote).settings, remove: false } }), 'application/json'),
      'remote-second.html': file('remote-second.html', 'second remote change'),
    },
  };
  const liveAfterFirstMerge = {
    ...recovered.candidate,
    files: {
      ...recovered.candidate.files,
      [metaPath]: file(metaPath, JSON.stringify({ ...metadata(recovered.candidate), settings: { ...metadata(recovered.candidate).settings, title: 'Typing during second conflict' } }), 'application/json'),
    },
  };
  const secondLiveRef = ref(liveAfterFirstMerge);
  const secondMergeEnv = {
    ...mergeEnv, requested: recovered.candidate, originalAuthored: recovered.authoredCandidate,
    remote: remoteTwice, remoteSnapshot: { project: remoteTwice, workspaceRevision: 9 },
    projectRef: secondLiveRef, wordpressAcknowledgedProjectRef: ref(remote),
    applyRecoveredProject: next => { secondLiveRef.current = next; },
  };
  const recoveredTwice = new Function(...Object.keys(secondMergeEnv), mergeCode)(...Object.values(secondMergeEnv));
  assert.equal(metadata(recoveredTwice.authoredCandidate).settings.description, 'Before', 'provenance after the second 409 excludes the first remote change');
  assert.equal(recoveredTwice.authoredCandidate.files['remote.html'], undefined);
  const olderQueuedSnapshot = project({ settings: { title: 'Queued after two conflicts', description: 'Before', remove: true }, rows: [1, 2] }, { 'local.html': file('local.html', 'local') });
  const afterTwoConflicts = rebase(base, olderQueuedSnapshot, recoveredTwice.candidate, recoveredTwice.authoredCandidate);
  assert.deepEqual(metadata(afterTwoConflicts).settings, { title: 'Queued after two conflicts', description: 'Remote', remove: false }, 'an old queued snapshot after two 409 merges retains both remote updates');
  assert.equal(afterTwoConflicts.files['remote.html'].text, 'remote');
  assert.equal(afterTwoConflicts.files['remote-second.html'].text, 'second remote change');
  assert.equal(visualEnv.pendingWordPressDraftProjectRef.current, recovered.candidate, 'the pending debounce snapshot follows the live merge');
  assert.equal(pendingLocalization.current.project, recovered.candidate, 'the localization debounce follows the same merged canvas');
  assert.equal(pendingLocalization.current.marker, 'preserve-envelope');
  visualEnv.wordpressAcknowledgedProjectRef.current = recovered.candidate;
  visualEnv.wordpressAuthoredAcknowledgementsRef.current.set(recovered.candidate, recovered.authoredCandidate);
  const enqueueStart = visualSource.indexOf('  const enqueueWordPressDraftWrite = useCallback(');
  const enqueueEnd = visualSource.indexOf('\n\n  useEffect(', enqueueStart);
  const enqueueCode = ts.transpileModule(`${visualSource.slice(enqueueStart, enqueueEnd)}\nreturn enqueueWordPressDraftWrite;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const enqueueEnv = {
    useCallback: value => value, wordpressDraftQueuedCountRef: ref(0), wordpressWorkspaceWriteEpochRef: ref(1),
    wordPressWorkspaceProjectId: () => 'shared', wordpressPendingReplacementRef: ref(null),
    isCurrentWordPressWorkspaceWrite: () => true,
    wordpressAcknowledgedProjectRef: visualEnv.wordpressAcknowledgedProjectRef,
    publishAbortControllerRef: visualEnv.publishAbortControllerRef, wordpressDraftWriteQueue: queue,
    wordpressDraftIdlePromiseRef: ref(Promise.resolve()),
  };
  const enqueue = new Function(...Object.keys(enqueueEnv), enqueueCode)(...Object.values(enqueueEnv));
  const scheduleStart = visualSource.indexOf('  const scheduleWordPressDraftWrite = useCallback(');
  const timerStart = visualSource.indexOf('        const enqueuePending = () => {', scheduleStart);
  const timerEnd = visualSource.indexOf('        };', timerStart) + '        };'.length;
  const timerCode = ts.transpileModule(`${visualSource.slice(timerStart, timerEnd)}\nreturn enqueuePending;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const fireDebounce = new Function('pendingWordPressDraftProjectRef', 'enqueueWordPressDraftWrite', timerCode)(visualEnv.pendingWordPressDraftProjectRef, enqueue);
  fireDebounce();
  await enqueueEnv.wordpressDraftIdlePromiseRef.current;
  assert.deepEqual(metadata(visualWrites.at(-1)).settings, { title: 'Third queued keystroke', description: 'Remote', remove: true }, 'debounce after the merge ACK cannot send pre-merge bytes using the newly acknowledged base');
  assert.equal(enqueueEnv.wordpressDraftQueuedCountRef.current, 0);

  const exactStart = visualSource.indexOf('  const persistExactWordPressDraft = useCallback(');
  const exactEnd = visualSource.indexOf('\n\n  const holdWordPressDraftDuringComponentEdit', exactStart);
  const exactCode = ts.transpileModule(`${visualSource.slice(exactStart, exactEnd)}\nreturn persistExactWordPressDraft;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let releaseLocalizationBarrier;
  const localizationBarrier = new Promise(resolve => { releaseLocalizationBarrier = resolve; });
  const exactEnv = {
    useCallback: value => value, isWordPressRuntime: true, wordpressConfig: () => ({}),
    wordpressAcknowledgedProjectRef: visualEnv.wordpressAcknowledgedProjectRef,
    wordpressWorkspaceWriteEpochRef: ref(1), wordPressWorkspaceProjectId: () => 'shared',
    isCurrentWorkspaceWrite: () => true, createWordPressWorkspaceWriteSupersededError: () => new Error('superseded'),
    explicitWordPressDraftProjectRef: ref(null), projectSignature: visualEnv.projectSignature,
    pendingLocalizationDraftProjectRef: ref(null), localizationDraftTimerRef: ref(null), localizationDraftWaitersRef: ref([]),
    pendingWordPressDraftProjectRef: ref(null), projectRef: ref(finalTyping),
    localizationDraftInFlightRef: ref(localizationBarrier), enqueueWordPressDraftWrite: enqueue,
    lastWordPressDraftSignatureRef: ref('unacknowledged-exact-signature'), wordpressCssDigestRef: ref('c'.repeat(64)),
    createWordPressExactSnapshotChangedError: () => new Error('Exact snapshot safely merged'), isAbortError: () => false,
  };
  const persistExact = new Function(...Object.keys(exactEnv), exactCode)(...Object.values(exactEnv));
  visualEnv.wordpressAcknowledgedProjectRef.current = base;
  const exactPromise = persistExact(finalTyping, true).catch(error => error);
  // The localization ACK arrives after the exact request captured its draft.
  visualEnv.wordpressAcknowledgedProjectRef.current = recovered.candidate;
  visualEnv.wordpressAuthoredAcknowledgementsRef.current.set(recovered.candidate, recovered.authoredCandidate);
  releaseLocalizationBarrier();
  const exactResult = await exactPromise;
  assert.match(exactResult.message, /Exact snapshot safely merged/);
  assert.equal(exactEnv.explicitWordPressDraftProjectRef.current, null);
  assert.deepEqual(metadata(visualWrites.at(-1)).settings, { title: 'Third queued keystroke', description: 'Remote', remove: true }, 'an exact save captures its baseline before awaiting localization ACK');
  const exactCatchStart = visualSource.indexOf('      } catch (error) {', exactStart) + '      } catch (error) {'.length;
  const exactCatchEnd = visualSource.indexOf('        throw error;', exactCatchStart) + '        throw error;'.length;
  const exactCatchCode = ts.transpileModule(visualSource.slice(exactCatchStart, exactCatchEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const cleanupExactFailure = new Function('error', 'next', 'explicitWordPressDraftProjectRef', 'isAbortError', 'absorbedLocalizationWaiters', exactCatchCode);
  const failure = new Error('unresolved remote conflict');
  const rejectedWaiters = [];
  const explicit = ref(local);
  const waiters = [{ reject: error => rejectedWaiters.push(error) }];
  assert.throws(() => cleanupExactFailure(failure, local, explicit, () => false, waiters), error => error === failure);
  assert.equal(explicit.current, null, 'a failed exact write releases its stale checkpoint');
  assert.deepEqual(rejectedWaiters, [failure]);
  explicit.current = finalTyping;
  assert.throws(() => cleanupExactFailure(failure, local, explicit, () => false, []), error => error === failure);
  assert.equal(explicit.current, finalTyping, 'an older exact failure cannot clear a newer checkpoint');

  const visualLocalizationStart = visualSource.indexOf('  const persistLocalizationDraft = useCallback(');
  const visualLocalizationEnd = visualSource.indexOf('\n\n  const saveLocalization', visualLocalizationStart);
  const visualLocalizationCode = ts.transpileModule(`${visualSource.slice(visualLocalizationStart, visualLocalizationEnd)}\nreturn persistLocalizationDraft;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let releasePreviousLocalization;
  const previousLocalization = new Promise(resolve => { releasePreviousLocalization = resolve; });
  const localizationTimers = [];
  const localizationWrites = [];
  const localizationTimerEnv = {
    useCallback: value => value, workspaceRef: ref(null), isWordPressRuntime: true,
    wordpressWorkspaceWriteEpochRef: ref(1), wordPressWorkspaceProjectId: () => 'shared',
    isCurrentWorkspaceWrite: () => true, createWordPressWorkspaceWriteSupersededError: () => new Error('superseded'),
    pendingLocalizationDraftProjectRef: ref(null), localizationDraftTimerRef: ref(null), localizationDraftWaitersRef: ref([]),
    localizationDraftInFlightRef: ref(previousLocalization), publishAbortControllerRef: ref(null),
    wordpressAcknowledgedProjectRef: ref(base), wordpressAuthoredAcknowledgementsRef: ref(new WeakMap()),
    rebaseQueuedWorkspaceProject: rebase, waitForCapturedWordPressPublishRelease: async () => {},
    WORDPRESS_PUBLISH_REQUEST_TIMEOUT_MS: 1000, TEXT_EDIT_AUTOSAVE_IDLE_MS: 0,
    window: { setTimeout: callback => { localizationTimers.push(callback); return localizationTimers.length; }, clearTimeout() {} },
    persistExactLocalizationDraft: async (candidate, _epoch, _id, authored) => {
      localizationWrites.push({ candidate, authored });
      localizationTimerEnv.wordpressAcknowledgedProjectRef.current = candidate;
      localizationTimerEnv.wordpressAuthoredAcknowledgementsRef.current.set(candidate, authored);
    },
  };
  const persistVisualLocalization = new Function(...Object.keys(localizationTimerEnv), visualLocalizationCode)(...Object.values(localizationTimerEnv));
  const secondLocalization = persistVisualLocalization(sequential);
  localizationTimers.shift()();
  const thirdLocalization = persistVisualLocalization(finalTyping);
  localizationTimers.shift()();
  assert.equal(localizationWrites.length, 0, 'fired localization timers still await the previous write');
  const firstLocalizationAck = merge(base, local, remote).project;
  localizationTimerEnv.wordpressAcknowledgedProjectRef.current = firstLocalizationAck;
  localizationTimerEnv.wordpressAuthoredAcknowledgementsRef.current.set(firstLocalizationAck, local);
  releasePreviousLocalization();
  await Promise.all([secondLocalization, thirdLocalization]);
  assert.equal(localizationWrites.length, 2);
  assert.equal(localizationWrites[0].authored, sequential);
  assert.equal(localizationWrites[1].authored, finalTyping);
  assert.deepEqual(metadata(localizationWrites[1].candidate).settings, { title: 'Third queued keystroke', description: 'Remote', remove: true }, 'a localization timer already fired before ACK rebases its captured draft, including the third write');

  console.log('PASS WordPress concurrent saves: disjoint files/JSON, conflicting fields/arrays/deletes, queued typing, safe CAS retry, post-ACK debounce, shared localization queue rebasing');
} finally {
  await server.close();
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
}
