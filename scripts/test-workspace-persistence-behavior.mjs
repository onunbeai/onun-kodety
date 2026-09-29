import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';
import JSZip from 'jszip';

const server = await createServer({ logLevel: 'silent', appType: 'custom', server: { middlewareMode: true } });
const browser = await chromium.launch({ headless: true });
const http = createHttpServer((_request, response) => { response.end('<!doctype html><title>Persistence regression</title>'); });
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
try {
  const { mergeWorkspaceConflict } = await server.ssrLoadModule('/lib/html-editor/collaborative-merge.ts');
  const { resolveWordPressReplacementUpload } = await server.ssrLoadModule('/lib/html-editor/wordpress-workspace-replacement.ts');
  const { uploadWordPressDraftArchive } = await server.ssrLoadModule('/lib/html-editor/editor-wordpress-helpers.ts');
  const { projectTransportDigest } = await server.ssrLoadModule('/lib/html-editor/css-integrity.ts');
  const project = (id, html = '<main></main>') => ({
    name: id, rootPath: '', mainHtmlPath: 'index.html', openedAt: 1,
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: html },
      '.incode/project.json': { path: '.incode/project.json', mimeType: 'application/json', text: JSON.stringify({ version: 1, projectId: id }) },
    },
  });
  const base = project('a', '<main><h1>Title</h1><p>Copy</p></main>');
  const local = project('a', '<main><h1>Local</h1><p>Copy</p></main>');
  const remote = project('a', '<main><h1>Title</h1><p>Remote</p></main>');
  const untouched = JSON.stringify([base, local, remote]);
  assert.match(mergeWorkspaceConflict(base, local, remote).project.files['index.html'].text, /Local.*Remote/);
  for (const projects of [[base, local, project('b')], [base, project('b'), remote], [project('b'), local, remote], [base, local, project('')]]) {
    assert.throws(() => mergeWorkspaceConflict(...projects), error => error.name === 'WorkspaceProjectIdentityConflictError' && error.retryable === false);
  }
  assert.equal(JSON.stringify([base, local, remote]), untouched, 'merge never mutates its inputs');
  assert.equal(mergeWorkspaceConflict(project('A'), project('a'), project('a')).recoveredPaths.length, 0);

  const blank = project('b');
  const digest = await projectTransportDigest(blank);
  const cssDigest = 'a'.repeat(64);
  const zip = new JSZip();
  for (const file of Object.values(blank.files)) zip.file(file.path, file.text);
  const archive = new Blob([await zip.generateAsync({ type: 'uint8array' })], { type: 'application/zip' });
  let committed;
  let writes = 0;
  let reads = 0;
  globalThis.window = globalThis;
  globalThis.fetch = async (_url, options) => {
    writes++;
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/zip');
    const parsed = await JSZip.loadAsync(await options.body.arrayBuffer());
    committed = project(JSON.parse(await parsed.file('.incode/project.json').async('string')).projectId, await parsed.file('index.html').async('string'));
    throw new TypeError('ACK lost after committing the ZIP');
  };
  const readReceipt = async () => {
    reads++;
    return { projectId: committed.name, projectDigest: await projectTransportDigest(committed), workspaceRevision: 2, cssDigest, templateDigest: 'b'.repeat(64) };
  };
  const options = {
    upload: () => uploadWordPressDraftArchive({ archive, projectUrl: 'http://wordpress.test/project', headers: {}, chunkThresholdBytes: 1e6, chunkBytes: 1e6, fallbackChunkBytes: 1e6 }),
    readReceipt, projectId: 'b', projectDigest: digest, baseRevision: 1, assertCurrent() {},
  };
  const recovered = await resolveWordPressReplacementUpload(options);
  assert.equal(recovered.payload.projectId, 'b');
  assert.equal(recovered.payload.projectDigest, digest);
  assert.equal(recovered.payload.workspaceRevision, 2);
  assert.equal(writes, 1, 'lost ACK must not upload a compensating project or repeat a committed ZIP');
  assert.equal(reads, 1);
  const ambiguous = new TypeError('offline');
  for (const receipt of [
    { ...await readReceipt(), projectId: 'a' },
    { ...await readReceipt(), projectDigest: 'f'.repeat(64) },
    { ...await readReceipt(), workspaceRevision: 1 },
    { ...await readReceipt(), cssDigest: '' },
  ]) {
    await assert.rejects(resolveWordPressReplacementUpload({ ...options, upload: async () => { throw ambiguous; }, readReceipt: async () => receipt }), error => error === ambiguous);
  }
  await assert.rejects(resolveWordPressReplacementUpload({ ...options, upload: async () => { throw ambiguous; }, readReceipt: async () => { throw new Error('offline GET'); } }), error => error === ambiguous);
  const conflict = { response: new Response(null, { status: 409 }), payload: { code: 'kodety_workspace_conflict' } };
  assert.equal((await resolveWordPressReplacementUpload({ ...options, upload: async () => conflict })).payload.success, true, 'a retry conflict is reconciled against the exact committed snapshot');
  const gatewayTimeout = { response: new Response(null, { status: 408 }), payload: null };
  assert.equal((await resolveWordPressReplacementUpload({ ...options, upload: async () => gatewayTimeout })).payload.success, true, 'a gateway timeout can hide a committed ZIP just like a lost connection');
  const rejected = { response: new Response(null, { status: 403 }), payload: { message: 'Read only' } };
  assert.equal(await resolveWordPressReplacementUpload({ ...options, upload: async () => rejected, readReceipt: async () => { assert.fail('definite rejection does not need a recovery download'); } }), rejected);
  let current = true;
  await assert.rejects(resolveWordPressReplacementUpload({ ...options, upload: async () => { throw ambiguous; }, assertCurrent: () => { if (!current) throw new Error('superseded'); }, readReceipt: async () => { current = false; return readReceipt(); } }), /superseded/);

  const editor = await readFile(new URL('../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx', import.meta.url), 'utf8');
  const receiptStart = editor.indexOf('            readReceipt: async () => {');
  const receiptEnd = editor.indexOf('            },\n          });', receiptStart);
  assert.ok(receiptStart >= 0 && receiptEnd > receiptStart);
  const receiptSource = editor.slice(receiptStart, receiptEnd + '            }'.length).replace(/^\s*readReceipt:\s*/, '');
  const receiptCode = ts.transpileModule(`return (${receiptSource});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const cache of ['warm', 'cold']) {
    const files = { ...blank.files, '.incode/template.json': { path: '.incode/template.json', mimeType: 'application/json', text: '{"serverOwned":true}' } };
    if (cache === 'cold') files['.incode/preview-files.json'] = { path: '.incode/preview-files.json', mimeType: 'application/json', text: '{"pages":["index.html"]}' };
    const expanded = { ...blank, files };
    assert.notEqual(await projectTransportDigest(expanded), digest, 'server download manifests must change the exact transport graph');
    const snapshot = { project: expanded, receivedProjectId: 'b', receivedProjectDigest: digest, workspaceRevision: 2, cssDigest, templateDigest: 'b'.repeat(64) };
    const environment = {
      withWordPressDraftConflictRecoveryTimeout: callback => callback(),
      downloadWordPressProjectSnapshot: async () => snapshot, config: {}, signal: undefined,
      assertCurrentWorkspaceWrite() {}, wordPressWorkspaceProjectId: project => project.name, projectTransportDigest,
    };
    const actualReadReceipt = new Function(...Object.keys(environment), receiptCode)(...Object.values(environment));
    const recovered = await resolveWordPressReplacementUpload({ ...options, upload: async () => { throw ambiguous; }, readReceipt: actualReadReceipt });
    assert.equal(recovered.payload.projectDigest, digest, `${cache} download proves the original full upload digest through its revision-bound receipt`);
    for (const mutation of [ { receivedProjectId: 'a' }, { receivedProjectDigest: 'f'.repeat(64) }, { receivedProjectDigest: '' }, { workspaceRevision: 1 } ]) {
      const candidate = { ...snapshot, ...mutation };
      const modified = { ...environment, downloadWordPressProjectSnapshot: async () => candidate };
      const read = new Function(...Object.keys(modified), receiptCode)(...Object.values(modified));
      await assert.rejects(resolveWordPressReplacementUpload({ ...options, upload: async () => { throw ambiguous; }, readReceipt: read }), error => error === ambiguous, 'incorrect or missing receipt must never authorize replacement');
    }
  }
  const matchStart = editor.indexOf('const localSnapshotMatchesWordPressWorkspace =');
  const matchEnd = editor.indexOf('const requestedWordPressStartupProject =', matchStart);
  const matchCode = ts.transpileModule(`${editor.slice(matchStart, matchEnd)}\nreturn localSnapshotMatchesWordPressWorkspace;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const matches = new Function('wordPressWorkspaceKey', 'wordPressWorkspaceProjectId', matchCode)(config => config.siteUrl, project => project.name.toLowerCase());
  assert.equal(matches({ project: base, workspaceKey: 'site-a' }, { siteUrl: 'site-a', projectId: 'a' }), true);
  assert.equal(matches({ project: base, workspaceKey: 'site-a' }, { siteUrl: 'site-a' }), false, 'missing server identity is recovery-only until revalidation');
  assert.equal(matches({ project: base, workspaceKey: 'site-a' }, { siteUrl: 'site-a', projectId: 'b' }), false);
  assert.equal(matches({ project: base, workspaceKey: 'site-a' }, { siteUrl: 'site-b', projectId: 'a' }), false);
  assert.equal(matches({ project: base }, { siteUrl: 'site-a', projectId: 'a' }), false);
  const callbackStart = editor.indexOf('  const openBlankProject = useCallback');
  const callbackEnd = editor.indexOf('\n\n  const createNewProject = useCallback', callbackStart);
  const callback = ts.transpileModule(`${editor.slice(callbackStart, callbackEnd)}\nreturn openBlankProject;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const fail of [false, true]) {
    let active = base;
    const fence = { workspaceEpoch: 1, projectId: 'b' };
    const calls = [];
    const env = {
      useCallback: callback => callback,
      ensureProjectIdentity: p => p, sanitizeProjectPriorities: p => p, createBlankProject: () => blank,
      isWordPressRuntime: true, publishAbortControllerRef: { current: null }, pendingTemplateImportRef: { current: true },
      advanceWordPressWorkspaceWriteFence: p => ({ ...fence, projectId: p.name }),
      persistExactWordPressDraft: async p => { calls.push(p); if (fail) throw ambiguous; },
      isCurrentWorkspaceWrite: () => true, wordPressWorkspaceProjectId: p => p.name,
      createWordPressWorkspaceWriteSupersededError: () => new Error('superseded'),
      lastWordPressDraftSavedAtRef: { current: 1 }, projectRef: { get current() { return active; } },
      openProject: p => { active = p; }, setMode() {}, setSavedAt() {},
      persistLocalProjectSnapshot: async () => { throw new Error('quota exceeded'); },
      localSnapshotContentRef: { current: null }, toast: { warning() {} },
      scheduleWordPressDraftWrite() {},
      lastWordPressDraftSignatureRef: { current: '' }, hasUnsavedWordPressDraftRef: { current: false },
    };
    const open = new Function(...Object.keys(env), callback)(...Object.values(env));
    if (fail) await assert.rejects(open(), error => error === ambiguous);
    else await open();
    assert.deepEqual(calls, [blank], 'creation must never enqueue an implicit rollback of A');
    assert.equal(active, fail ? base : blank, 'local quota failure cannot undo a confirmed remote project');
  }

  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${http.address().port}`);
  const storageSource = await readFile(new URL('../lib/html-editor/project-storage.ts', import.meta.url), 'utf8');
  const storageCode = ts.transpileModule(storageSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  await page.evaluate(code => {
    const exports = {};
    new Function('exports', code)(exports);
    globalThis.projectStorage = exports;
  }, storageCode);
  const extractCallback = (name, next) => {
    const start = editor.indexOf(`  const ${name} = useCallback`);
    const end = editor.indexOf(next, start);
    assert.ok(start >= 0 && end > start);
    return ts.transpileModule(`${editor.slice(start, end)}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  };
  const failedReplacement = await page.evaluate(async ({ base, local, blank, callback, advanceCode, persistLocalCode }) => {
    const storage = globalThis.projectStorage;
    const ref = current => ({ current });
    const scope = 'https://site.test/offline-replacement';
    const signature = project => JSON.stringify(project.files);
    const config = { siteUrl: scope };
    const localWrites = [];
    const remoteWrites = [];
    let lateTimerFired = false;
    await storage.saveProjectSnapshot(base, {
      projectId: 'a', workspaceKey: scope, workspaceRevision: 1,
      workspaceTemplateDigest: 'd'.repeat(64), workspaceCssDigest: 'c'.repeat(64),
      projectSignature: signature(base), acknowledgedProjectSignature: signature(base),
    });
    const env = {
      useCallback: fn => fn, window, isWordPressRuntime: true, workspaceRef: ref(null),
      createWordPressWorkspaceWriteSupersededError: () => new Error('superseded'),
      wordPressWorkspaceProjectId: project => project.name,
      wordpressWorkspaceWriteEpochRef: ref(1), wordpressWorkspaceWriteProjectIdRef: ref('a'),
      wordpressAuthorityFenceRef: ref(null), wordpressPendingReplacementRef: ref(null),
      wordpressDraftTimerRef: ref(null), wordpressDraftTimerDeadlineRef: ref(0),
      wordpressDraftIdleCancelRef: ref(null), wordpressDraftRetryTimerRef: ref(null),
      wordpressDraftZipBuilderRef: ref(null), pendingWordPressDraftProjectRef: ref(local),
      explicitWordPressDraftProjectRef: ref(null), pendingLocalSnapshotRef: ref(local),
      localSnapshotContentRef: ref(local), localSnapshotTimerRef: ref(setTimeout(() => { lateTimerFired = true; }, 60_000)),
      wordpressDraftDeltaRequestRef: ref(null), wordpressDraftRetryCountRef: ref(0),
      localizationDraftTimerRef: ref(null), pendingLocalizationDraftProjectRef: ref(null), localizationDraftWaitersRef: ref([]),
      ensureProjectIdentity: project => project, sanitizeProjectPriorities: project => project, createBlankProject: () => blank,
      publishAbortControllerRef: ref(null), pendingTemplateImportRef: ref(false),
      persistExactWordPressDraft: async project => { remoteWrites.push(project.name); throw new Error('offline before local debounce'); },
      lastWordPressDraftSavedAtRef: ref(1), projectRef: ref(local),
      openProject() { throw new Error('failed replacement cannot change the active project'); }, setMode() {}, setSavedAt() {},
      toast: { warning() {} }, scheduleWordPressDraftWrite() {},
      lastWordPressDraftSignatureRef: ref(signature(base)), hasUnsavedWordPressDraftRef: ref(true),
      recoveryPendingDecisionRef: ref(null), wordpressConfig: () => config, wordPressWorkspaceKey: () => scope,
      projectSignature: signature, projectTransportSize: () => 1,
      saveProjectSnapshot: storage.saveProjectSnapshot, wordpressWorkspaceRevisionRef: ref(1),
      wordpressTemplateDigestRef: ref('d'.repeat(64)), wordpressCssDigestRef: ref('c'.repeat(64)),
      recoverableProjectRef: ref(null), latestLocalProjectRef: ref(null), setRecoverableProject() {}, setRecoveryPendingDecision() {},
    };
    env.isCurrentWorkspaceWrite = fence => fence.workspaceEpoch === env.wordpressWorkspaceWriteEpochRef.current && fence.projectId === env.wordpressWorkspaceWriteProjectIdRef.current;
    env.advanceWordPressWorkspaceWriteFence = new Function(...Object.keys(env), advanceCode)(...Object.values(env));
    const persistLocal = new Function(...Object.keys(env), persistLocalCode)(...Object.values(env));
    env.persistLocalProjectSnapshot = project => {
      const promise = persistLocal(project);
      localWrites.push(promise);
      return promise;
    };
    const open = new Function(...Object.keys(env), callback)(...Object.values(env));
    let error = '';
    try { await open(); } catch (caught) { error = caught.message; }
    await Promise.all(localWrites);
    return {
      error, remoteWrites, localWrites: localWrites.length, lateTimerFired,
      pendingTimer: env.localSnapshotTimerRef.current, active: env.projectRef.current.name,
      reloaded: await storage.loadLatestProjectSnapshot(scope),
    };
  }, {
    base, local, blank, callback,
    advanceCode: extractCallback('advanceWordPressWorkspaceWriteFence', '\n\n  const persistWordPressDraft'),
    persistLocalCode: extractCallback('persistLocalProjectSnapshot', '\n\n  useEffect('),
  });
  assert.equal(failedReplacement.error, 'offline before local debounce');
  assert.deepEqual(failedReplacement.remoteWrites, ['b'], 'failure never restores A through a replacement ZIP');
  assert.equal(failedReplacement.active, 'a');
  assert.equal(failedReplacement.pendingTimer, null);
  assert.equal(failedReplacement.lateTimerFired, false);
  assert.equal(failedReplacement.localWrites, 1, 'failed replacement immediately checkpoints the preserved edit without awaiting the old debounce');
  assert.equal(failedReplacement.reloaded.project.files['index.html'].text, local.files['index.html'].text, 'reload retains the latest local A edit after an offline replacement failure');
  assert.equal(failedReplacement.reloaded.projectId, 'a');
  assert.equal(failedReplacement.reloaded.workspaceRevision, 1);
  assert.equal(failedReplacement.reloaded.acknowledgedProjectSignature, '', 'a recovery write cannot invent a server acknowledgement');
  const result = await page.evaluate(async ({ base, blank }) => {
    const storage = globalThis.projectStorage;
    const scopeA = 'https://site.test/a';
    const scopeB = 'https://site.test/b';
    const authority = (id, revision, scope = scopeA) => ({ projectId: id, projectSignature: id, acknowledgedProjectSignature: id, workspaceKey: scope, workspaceRevision: revision, workspaceTemplateDigest: 'd'.repeat(64), workspaceCssDigest: 'c'.repeat(64) });
    const queueA = 'https://site.test/queue-a';
    const queueB = 'https://site.test/queue-b';
    await Promise.all([
      storage.saveProjectSnapshot(base, authority('a', 1, queueA)),
      storage.saveProjectSnapshot({ ...base, name: 'a-two' }, authority('a', 2, queueA)),
      storage.saveProjectSnapshot(blank, authority('b', 1, queueB)),
      storage.saveProjectSnapshot({ ...blank, name: 'b-two' }, authority('b', 2, queueB)),
    ]);
    const queuedA = (await storage.loadProjectSnapshots(undefined, queueA)).latest.project.name;
    const queuedB = (await storage.loadProjectSnapshots(undefined, queueB)).latest.project.name;
    await storage.saveProjectSnapshot(base, authority('a', 1));
    await storage.saveProjectSnapshot(blank, authority('b', 1, scopeB));
    // The small confirmed B authority survives a failed full snapshot write.
    await storage.saveProjectSnapshotAuthority(authority('b', 2));
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (value?.project?.name === 'b' && value.workspaceKey === scopeA) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    };
    let quotaRejected = false;
    try { await storage.saveProjectSnapshot(blank, authority('b', 2)); } catch { quotaRejected = true; }
    IDBObjectStore.prototype.put = originalPut;
    // An old write finishing after the B receipt cannot downgrade authority.
    await storage.saveProjectSnapshot(base, authority('a', 1));
    const afterFailure = await storage.loadProjectSnapshots(undefined, scopeA);
    const otherSite = await storage.loadProjectSnapshots(undefined, scopeB);
    await storage.saveProjectSnapshot(blank, authority('b', 2));
    const restored = await storage.loadProjectSnapshots(undefined, scopeA);
    await storage.saveProjectSnapshot(base, { ...authority('a', 3), preserveRecovery: otherSite.latest });
    await storage.saveProjectSnapshot(blank, { ...authority('b', 2, scopeB), preserveRecovery: otherSite.latest });
    await storage.clearProjectRecoverySnapshot(scopeA);
    const cleared = await storage.loadProjectSnapshots(undefined, scopeA);
    const retained = await storage.loadProjectSnapshots(undefined, scopeB);
    return { queuedA, queuedB, quotaRejected, latestAfterFailure: afterFailure.latest, recoveryAfterFailure: afterFailure.recovery?.project.name, otherSite: otherSite.latest?.project.name, restored: restored.latest?.project.name, cleared: cleared.recovery, retained: retained.recovery?.project.name };
  }, { base, blank });
  assert.equal(result.queuedA, 'a-two');
  assert.equal(result.queuedB, 'b-two');
  assert.equal(result.quotaRejected, true);
  assert.equal(result.latestAfterFailure, null);
  assert.equal(result.recoveryAfterFailure, 'a');
  assert.equal(result.otherSite, 'b');
  assert.equal(result.restored, 'b');
  assert.equal(result.cleared, null);
  assert.equal(result.retained, 'b');
  console.log('PASS workspace persistence: isolated identities, real ZIP lost ACK, creation rollback prevention, scoped Chromium IndexedDB and quota recovery');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  await browser.close();
  await server.close();
  await new Promise(resolve => http.close(resolve));
}
