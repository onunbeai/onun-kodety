import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manager = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsManager.tsx'),
  'utf8',
);
const csvImport = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsCsvImport.tsx'),
  'utf8',
);
const bindings = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsBindings.tsx'),
  'utf8',
);

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing contract boundary: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing contract boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

function includesAll(source, expectations, context) {
  for (const expectation of expectations) {
    assert.ok(source.includes(expectation), `${context}: missing ${JSON.stringify(expectation)}`);
  }
}

const revisionClassifier = section(manager, 'function isCmsRevisionError', '/** Build a REST URL');
includesAll(
  revisionClassifier,
  ["error.code === 'kodety_revision_conflict'", "error.code === 'kodety_revision_required'"],
  'explicit stale/missing revision classification',
);
assert.doesNotMatch(
  revisionClassifier,
  /error\.status\s*===\s*409/,
  'ordinary 409 responses such as collection_exists/not_empty must not be mistaken for stale revisions',
);

const conflictReadback = section(manager, 'const refreshAfterRevisionConflict = useCallback', 'useEffect(() => {');
includesAll(
  conflictReadback,
  [
    'Never retry a stale mutation automatically',
    'setRevisionConflict(true)',
    'if (!cmsLeaveDraftRef.current.fieldsDirty)',
    'setFieldsRefreshTick(tick => tick + 1)',
    'setRefreshTick(tick => tick + 1)',
    'await loadSchema(true)',
  ],
  '409 readback without automatic overwrite',
);
assert.doesNotMatch(conflictReadback, /setEditing\(null\)|setEditingCollection\(null\)|setEditingExpectedRevision\(''\)|setFieldsRevision\(''\)/, 'a conflict preserves the user draft and its original CAS revision until explicit discard');

const create = section(manager, 'const createCollection = useCallback', 'const beginEditingCollection = useCallback');
includesAll(
  create,
  [
    'expectedRevision: schema.revision',
    'const nextRevision = created.revision',
    'setSchema(current => current ? { ...current, revision: nextRevision } : current)',
    'if (isCmsRevisionError(error)) await refreshAfterRevisionConflict()',
  ],
  'collection create CAS lifecycle',
);

const beginRename = section(manager, 'const beginEditingCollection = useCallback', 'const updateCollection = useCallback');
includesAll(
  beginRename,
  [
    'if (!isCmsRevisionToken(schema?.revision))',
    'void loadSchema(true)',
    'revision: schema.revision',
  ],
  'collection edit snapshot',
);
assert.doesNotMatch(beginRename, /revision:\s*(?:''|schema\?\.revision\s*\|\|)/, 'collection editing must never manufacture an empty revision');

const rename = section(manager, 'const updateCollection = useCallback', 'const deleteCollection = useCallback');
includesAll(
  rename,
  [
    "method: 'PUT'",
    'encodeURIComponent(editingCollection.slug)',
    'name: editingCollection.name.trim()',
    'singular: editingCollection.singular.trim()',
    'expectedRevision: editingCollection.revision',
    'const nextRevision = updated.revision',
    '? { ...current, revision: nextRevision }',
    'const stableSlug = updated.slug || editingCollection.slug',
  ],
  'label-only collection rename',
);
assert.doesNotMatch(rename, /\n\s*(?:slug|urlSlug):/, 'rename must not send a new stable slug or URL slug');
assert.match(
  manager,
  /value=\{editingCollection\.urlSlug\}[\s\S]*?readOnly[\s\S]*?disabled/,
  'the published URL slug must remain visibly read-only',
);

const deletion = section(manager, 'const deleteCollection = useCallback', 'const saveFields = useCallback');
includesAll(
  deletion,
  [
    'if (editingCollection.itemCount > 0)',
    'Mova todos os itens desta collection para a lixeira antes de excluí-la.',
    "method: 'DELETE'",
    'confirmation: editingCollection.slug',
    'deleteItems: false',
    'expectedRevision: editingCollection.revision',
    'const nextRevision = deleted.revision',
  ],
  'empty-only collection deletion',
);

const fieldsSave = section(manager, 'const saveFields = useCallback', 'const editingItem =');
includesAll(
  fieldsSave,
  [
    'if (!fieldsRevision)',
    'expectedRevision: fieldsRevision',
    'const nextRevision = saved.revision',
    'setFieldsRevision(nextRevision)',
    'setSchema(current => current ? { ...current, revision: nextRevision } : current)',
    'if (isCmsRevisionError(error)) await refreshAfterRevisionConflict()',
  ],
  'field schema CAS lifecycle',
);

const itemSave = section(manager, 'const saveItem = useCallback', 'const closeItemEditor = useCallback');
includesAll(
  itemSave,
  [
    'if (!editingExpectedRevision)',
    'expectedRevision: editingExpectedRevision',
    'itemRevisionsRef.current.set(saved.id, saved.revision)',
    "if (editing === 'new') {",
    'const fresh = await loadSchema(true)',
    'if (isCmsRevisionError(error)) await refreshAfterRevisionConflict()',
  ],
  'item editor CAS lifecycle',
);

const inlineItemSave = section(manager, 'const updateItemField = useCallback', 'const addField = useCallback');
includesAll(
  inlineItemSave,
  [
    'const expectedRevision = itemRevisionsRef.current.get(item.id) || item.revision',
    'body: JSON.stringify({ values: { [key]: value }, expectedRevision })',
    'itemRevisionsRef.current.set(saved.id, saved.revision)',
    'if (isCmsRevisionError(error)) await refreshAfterRevisionConflict()',
  ],
  'serialized inline item CAS lifecycle',
);

const itemDeletion = section(manager, 'const deleteItem = useCallback', 'const createCollection = useCallback');
assert.ok(
  (itemDeletion.match(/const expectedRevision = itemRevisionsRef\.current\.get\(item\.id\) \|\| item\.revision/g) || []).length >= 2,
  'single and bulk item deletion must both use the latest acknowledged item revision',
);
assert.ok(
  (itemDeletion.match(/body: JSON\.stringify\(\{ expectedRevision \}\)/g) || []).length >= 2,
  'single and bulk item deletion must both send their captured revision',
);
assert.ok(
  (itemDeletion.match(/deleted\.status !== 'trash'/g) || []).length >= 2,
  'single and bulk item deletion must both validate the durable trash ACK',
);
assert.ok(itemDeletion.includes('hadRevisionConflict'), 'bulk deletion must force readback after any stale item');
assert.ok(!deletion.includes('deleteItems: true'), 'the UI must never request a destructive collection cascade');
assert.match(
  manager,
  /disabled=\{collectionSaving \|\| editingCollection\.itemCount > 0\}/,
  'the destructive control must be disabled while the collection has active items',
);

const workflow = section(csvImport, 'const runImport = useCallback', 'const optionsForColumn = useMemo');
includesAll(
  csvImport,
  [
    'const MAX_IMPORT_ROWS = 1000',
    'table.length - 1 > MAX_IMPORT_ROWS',
    'disabled={importing} onClick={() => onOpenChange(false)}',
    "{importing ? 'Confirmando lote…' : 'Cancelar'}",
  ],
  'bounded, non-interruptible CSV commit',
);
includesAll(
  workflow,
  [
    'const items = rows.map',
    '`/${encodeURIComponent(slug)}/import`',
    '{ items, expectedRevision }',
    "let createdCollectionSlug = ''",
    'error.detail?.rollbackFailed === true',
    'confirmation: createdCollectionSlug',
    'deleteItems: false',
    "newFieldColumns.length && mode === 'existing'",
    'let expectedRevision = startingRevision',
    'expectedRevision = created.revision',
    '{ fields: [...existing, ...additions], expectedRevision }',
    'expectedRevision = savedFields.revision',
    'expectedRevision = result.revision',
    'const cleanup = (await cleanupResponse.json())',
    'expectedRevision = cleanup.revision',
    'onImported(slug, expectedRevision)',
    'if (isCmsRevisionError(error))',
    'await onRevisionConflict(',
  ],
  'atomic CSV batch plus setup compensation',
);
includesAll(
  csvImport,
  ["mode === 'existing' && newFieldColumns.length", 'mapeie apenas campos já criados ou ignore a coluna'],
  'existing-collection schema preflight',
);
assert.ok(!workflow.includes('{ fields: previousFieldDefinitions }'), 'CSV failure must not replace another tab\'s schema with a stale snapshot');
assert.ok(!csvImport.includes('runPool'), 'CSV rows must not return to per-row concurrent requests');
assert.ok(!/\b(?:succeeded|failed)\s*\+=/.test(workflow), 'CSV must not report partial row success');
assert.ok(!csvImport.includes('Interromper'), 'the UI must not promise interruption after the batch commit starts');
includesAll(
  csvImport,
  [
    'schemaRevision: string',
    'onRevisionConflict: (message?: string) => void | Promise<void>',
    'const schemaRevisionSnapshotRef = useRef(schemaRevision)',
    'const startingRevision = schemaRevisionSnapshotRef.current',
    'const nested = cmsRecord(payload?.data)',
    'nested || payload',
  ],
  'CSV revision and WordPress error envelope contract',
);
assert.doesNotMatch(
  section(csvImport, 'function isCmsRevisionError', 'function normalizeHeader'),
  /error\.status\s*===\s*409/,
  'CSV must not treat a collection collision as a CAS conflict',
);

includesAll(bindings, ['urlSlug?: string', 'readOnly?: boolean', 'revision: string'], 'collection lifecycle metadata');
includesAll(
  bindings,
  [
    "typeof payload.revision !== 'string'",
    '!payload.revision.trim()',
    'return { types, templates, customFields, revision: payload.revision }',
  ],
  'schema read must preserve an opaque non-empty revision',
);

console.log('CMS collection lifecycle UI: safe rename/delete, atomic CSV and CAS contracts approved.');
