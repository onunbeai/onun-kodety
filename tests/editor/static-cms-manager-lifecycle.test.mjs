import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const managerPath = '../../app/(builder)/kodety/html-editor/components/HtmlCmsManager.tsx';
async function callbacks(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const named = new Map(), effects = [];
  const compile = node => ts.transpileModule(`const callback = ${node.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      if (value && ts.isArrowFunction(value)) named.set(node.name.text, compile(value));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) effects.push(compile(node.arguments[0]));
    ts.forEachChild(node, visit);
  };
  visit(tree); return { named, effects };
}
const manager = await callbacks(managerPath);
const settings = await callbacks('../../app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx');
const instantiate = (code, bindings) => new Function('bindings', `with (bindings) { ${code} return callback; }`)(bindings);
const ref = current => ({ current });
const named = (name, bindings) => instantiate(manager.named.get(name), bindings);

test('HTML does not request item or field endpoints before its schema validates a collection', () => {
  for (const marker of ["if (!open || !wp?.cmsFieldsUrl", "if (!open || !wp?.cmsItemsUrl"]) {
    const effect = manager.effects.find(code => code.includes(marker));
    assert.ok(effect);
    const bindings = { open: true, wp: { cmsItemsUrl: '/items', cmsFieldsUrl: '/fields' }, activeType: 'post', collectionReady: false,
      fetchCmsJsonWithDeadline: () => { throw new Error('Requested a missing collection'); } };
    assert.equal(instantiate(effect, bindings)(), undefined);
  }
});

test('empty HTML CMS removes a stale collection query while preserving the project and other parameters', () => {
  const effect = manager.effects.find(code => code.includes("url.searchParams.set('collection', activeType)"));
  assert.ok(effect);
  let replaced;
  const current = 'https://studio.kodety.com/?project=fixture&source=local&collection=post&view=fields';
  const bindings = { standalone: true, open: true, staticRuntime: true, schema: { types: [] }, types: [], activeType: '', collectionReady: false, view: 'collections',
    window: { location: { href: current }, history: { state: { existing: true }, replaceState: (state, _unused, url) => { replaced = { state, url }; } } } };
  instantiate(effect, bindings)();
  const url = new URL(replaced.url);
  assert.equal(url.searchParams.get('collection'), null); assert.equal(url.searchParams.get('view'), null);
  assert.equal(url.searchParams.get('project'), 'fixture'); assert.equal(url.searchParams.get('source'), 'local');
  assert.deepEqual(replaced.state, { existing: true });
  replaced = undefined; bindings.schema = null;
  instantiate(effect, bindings)(); assert.equal(replaced, undefined, 'a pending schema must not erase a valid requested selection');
  bindings.schema = { types: [{ slug: 'kodety_news' }] }; bindings.types = bindings.schema.types;
  instantiate(effect, bindings)(); assert.equal(replaced, undefined, 'the URL must wait for schema selection before removing a requested fields view');
});

test('an HTML item cannot be opened or created without a real selected collection', () => {
  const bindings = { readOnly: false, collectionReady: false, setEditing: () => { throw new Error('Opened an orphan item'); } };
  assert.equal(named('startEditing', bindings)('new'), undefined);
});

test('a new-collection deep link is available in empty HTML without requiring a fake active type', () => {
  const effect = manager.effects.find(code => code.includes("action === 'new-collection'"));
  assert.ok(effect);
  let creating = false;
  const bindings = { open: true, activeType: '', staticRuntime: true, schema: { types: [] }, types: [], collectionReady: false,
    initialActionHandledRef: ref(false), canManageSchema: true, collectionLimitReached: false,
    window: { location: { search: '?project=fixture&action=new-collection' } },
    setCreatingCollection: value => { creating = value; }, startEditing: () => { throw new Error('Opened item without collection'); } };
  instantiate(effect, bindings)(); assert.equal(creating, true); assert.equal(bindings.initialActionHandledRef.current, true);
});

test('HTML fields deep links wait for a confirmed collection, and an empty schema stays in collection creation', () => {
  const effect = manager.effects.find(code => code.includes("requestedView === 'fields'"));
  assert.ok(effect);
  let view = 'collections';
  const bindings = { open: true, initialViewHandledRef: ref(false), staticRuntime: true, schema: null, types: [], collectionReady: false,
    canManageSchema: true, window: { location: { search: '?collection=post&view=fields' } }, setView: value => { view = value; } };
  instantiate(effect, bindings)(); assert.equal(view, 'collections'); assert.equal(bindings.initialViewHandledRef.current, false);
  bindings.schema = { types: [] }; instantiate(effect, bindings)();
  assert.equal(view, 'collections'); assert.equal(bindings.initialViewHandledRef.current, true);
  bindings.initialViewHandledRef.current = false; bindings.types = [{ slug: 'kodety_news' }];
  instantiate(effect, bindings)(); assert.equal(bindings.initialViewHandledRef.current, false);
  bindings.collectionReady = true; instantiate(effect, bindings)(); assert.equal(view, 'fields');
});

test('creating an item includes its uploaded featured image and refreshes schema before another creation', async () => {
  const events = [], snapshot = { title: 'A story', status: 'draft' };
  let submitted, fieldsRevision = 'old-schema';
  const bindings = {
    saveItemInFlightRef: ref(null), readOnly: false, wp: { cmsItemsUrl: '/items', nonce: '' }, activeType: 'kodety_news',
    editing: 'new', editingExpectedRevision: 'old-schema', formValues: snapshot, initialValues: {},
    featuredImage: { id: 123, url: 'blob:preview' }, initialFeaturedImage: { id: null, url: '' },
    itemDraftSignature: 'submitted', itemDraftSignatureRef: ref('submitted'), itemRevisionsRef: ref(new Map()),
    setSaving: value => events.push(['saving', value]), restEndpoint: (url, suffix) => url + suffix,
    cmsFetch: async (_url, init) => { submitted = JSON.parse(init.body); return new Response(JSON.stringify({ id: 45, revision: 'item-revision', values: snapshot })); },
    isCmsRevisionToken: value => typeof value === 'string' && value.length > 0,
    loadSchema: async force => { events.push(['schema-refresh', force]); return { revision: 'new-schema' }; },
    setFieldsRevision: apply => { fieldsRevision = apply(fieldsRevision); },
    window: { dispatchEvent: event => events.push(event.type) }, CustomEvent: class { constructor(type) { this.type = type; } },
    notifyItemsChanged: () => events.push('items-changed'), setRefreshTick: () => {},
    setEditing: value => events.push(['editing', value]), toast: { success: () => {}, error: error => { throw error; } },
  };
  assert.equal(await named('saveItem', bindings)(), true);
  assert.equal(submitted.expectedRevision, 'old-schema');
  assert.deepEqual(submitted.values, { ...snapshot, featured_image: 123 });
  assert.equal(fieldsRevision, 'new-schema');
  assert.ok(events.findIndex(event => Array.isArray(event) && event[0] === 'schema-refresh') < events.findIndex(event => Array.isArray(event) && event[0] === 'editing'));
  assert.equal(bindings.itemRevisionsRef.current.get(45), 'item-revision');
});

test('a conflicting CMS save keeps form values and their original revision until explicit discard', async () => {
  const events = [];
  const bindings = { cmsLeaveDraftRef: ref({ fieldsDirty: true }), setRevisionConflict: value => events.push(['conflict', value]),
    setFieldsRefreshTick: () => events.push('reload-fields'), setRefreshTick: () => events.push('reload-list'), loadSchema: async force => events.push(['reload-schema', force]),
    toast: { error: () => {} }, setEditing: () => { throw new Error('Lost item draft'); }, setEditingExpectedRevision: () => { throw new Error('Rebased stale item'); }, setEditingCollection: () => { throw new Error('Lost collection draft'); }, setFieldsRevision: () => { throw new Error('Rebased stale fields'); },
  };
  await named('refreshAfterRevisionConflict', bindings)();
  assert.deepEqual(events, [['conflict', true], 'reload-list', ['reload-schema', true]]);
});

test('closing or reloading warns for CMS drafts and pending writes, but a saved panel does not warn', () => {
  const bindings = { editingDirty: false, fieldsDirty: false, saving: false, fieldsSaving: false, uploadingField: '', collectionSaving: false, creatingCollection: false, editingCollection: null, bulkDeleting: false, deletingId: 0, cellMutationPendingCountRef: ref(0) };
  const beforeUnload = named('beforeUnload', bindings);
  const dispatch = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; beforeUnload(event); return event.prevented; };
  assert.equal(dispatch(), false);
  for (const key of ['editingDirty', 'fieldsDirty', 'saving', 'uploadingField', 'creatingCollection']) {
    bindings[key] = true; assert.equal(dispatch(), true, key); bindings[key] = false;
  }
  bindings.cellMutationPendingCountRef.current = 1; assert.equal(dispatch(), true);
});

test('cancelled host navigation releases CMS and Settings; a CMS backup also releases the mounted panel', async () => {
  for (const [source, kind] of [[manager, 'Cms'], [settings, 'Settings']]) {
    const browser = new EventTarget(), eventName = 'kodety:workspace-navigation-cancelled', state = ref(true), pending = ref(Promise.resolve(true));
    let guard, unregistered = false, inert = true;
    const bindings = { open: true, window: browser, WORKSPACE_NAVIGATION_CANCELLED_EVENT: eventName,
      leavePreparationPromiseRef: pending, ['leaving' + kind + 'Ref']: state, ['setLeaving' + kind]: value => { inert = value; },
      prepareCmsLeaveRef: ref(async () => { state.current = true; inert = true; pending.current = Promise.resolve(true); return true; }),
      registerWorkspaceNavigationGuard: callback => { guard = callback; return () => { unregistered = true; }; },
    };
    const effect = source.effects.find(code => code.includes('window.addEventListener(WORKSPACE_NAVIGATION_CANCELLED_EVENT'));
    assert.ok(effect);
    const cleanup = instantiate(effect, bindings)();
    browser.dispatchEvent(new Event(eventName));
    assert.equal(state.current, false); assert.equal(inert, false); assert.equal(pending.current, null);
    if (kind === 'Cms') { assert.equal(await guard('backup'), true); assert.equal(state.current, false); assert.equal(pending.current, null); }
    cleanup(); if (kind === 'Cms') assert.equal(unregistered, true);
    state.current = true; browser.dispatchEvent(new Event(eventName)); assert.equal(state.current, true, 'cleanup removes the old project listener');
  }
});
