import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const managerPath = path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsManager.tsx');
const manager = await readFile(managerPath, 'utf8');
const bindings = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsBindings.tsx'), 'utf8');
const datePicker = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlDatePicker.tsx'), 'utf8');
const csvImport = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsCsvImport.tsx'), 'utf8');
const wordpressPlugin = await readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8');
const wordpressEditorCss = await readFile(path.join(root, 'Wordpress/editor/wordpress-editor.css'), 'utf8');

function section(start, end) {
  const startIndex = manager.indexOf(start);
  assert.notEqual(startIndex, -1, `CMS manager must keep ${start}`);
  const endIndex = end ? manager.indexOf(end, startIndex + start.length) : manager.length;
  assert.notEqual(endIndex, -1, `CMS manager must keep the boundary ${end}`);
  return manager.slice(startIndex, endIndex);
}

function includesAll(source, expectations, context) {
  for (const expectation of expectations) {
    assert.ok(source.includes(expectation), `${context} must keep ${JSON.stringify(expectation)}`);
  }
}

const tableCell = section('function CmsTableCell', 'function RichHtmlEditor');
includesAll(
  tableCell,
  [
    'value={draft}',
    'useEffect(() => setDraft(text), [text])',
    'onClick={event => event.stopPropagation()}',
    'setDraft(next)',
    'onChange(next)',
    "if (event.key === 'Enter') event.currentTarget.blur()",
    "if (event.key === 'Escape')",
    'event.currentTarget.blur()',
    'border-0',
    'bg-transparent',
  ],
  'inline text cells',
);
assert.ok(
  !/\b(?:border|bg)-input\b/.test(tableCell.match(/data-cms-inline-editor[\s\S]*?className=\{`[\s\S]*?`\}/)?.[0] || ''),
  'inline table text cells must not regain a permanent input background or border',
);
const rawInlineEditor = tableCell.match(/return\s*\(?\s*<input[\s\S]*?data-cms-inline-editor[\s\S]*?className=\{`[\s\S]*?`\}/)?.[0] || '';
includesAll(rawInlineEditor, ['border-0', 'bg-transparent', 'outline-none', 'ring-0', 'focus-visible:outline-none'], 'raw inline editor visuals');
assert.match(tableCell, /field\.key === 'status'[\s\S]*?<Select[\s\S]*?onValueChange=\{onChange\}/, 'status cells must remain directly editable');
includesAll(tableCell, ['data-cms-inline-status', 'min-w-0', 'bg-transparent', 'shadow-none'], 'inline status visuals');
assert.match(
  wordpressEditorCss,
  /\[data-cms-inline-status\][\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/,
  'the WordPress control skin must not reintroduce a field background around inline CMS statuses',
);
assert.match(
  tableCell,
  /(?:field\.type === 'boolean'|\['boolean', 'true_false'\])[\s\S]*?<Switch[\s\S]*?onCheckedChange=\{onChange\}/,
  'boolean cells must remain directly editable',
);
assert.match(
  tableCell,
  /const complexValue = value !== null && typeof value === 'object'[\s\S]*?if \(complexValue\)[\s\S]*?data-cms-complex-value[\s\S]*?return\s*\(?\s*<input/,
  'arrays and object-backed fields must render as safe summaries instead of destructive text inputs',
);
assert.match(
  tableCell,
  /editOriginRef[\s\S]*?onFocus=[\s\S]*?editOriginRef\.current = text[\s\S]*?if \(event\.key === 'Escape'\)[\s\S]*?onChange\(origin\)/,
  'Escape must restore and persist the value that existed when inline editing started',
);

const imageEditor = section('function CmsImageEditor', 'function CmsFieldRow');
includesAll(
  imageEditor,
  [
    'const [draft, setDraft]',
    'if (!open) setDraft(normalizeCmsImage(value))',
    'accept="image/*"',
    "event.target.value = ''",
    'Math.max(0, Math.min(100',
    "onChange(draft.url ? draft : '')",
    'setOpen(false)',
  ],
  'CMS media editing',
);
assert.match(imageEditor, /onClick=\{\(\) => setOpen\(false\)\}>[\s\S]*?Cancelar/, 'cancelling media edits must close without mutating the item');
assert.match(
  imageEditor,
  /onClick=\{\(\) => \{[\s\S]*?onChange\(draft\.url \? draft : ''\);[\s\S]*?setOpen\(false\);[\s\S]*?\}\}[\s\S]*?Aplicar imagem/,
  'applying media edits must commit the complete image draft before closing',
);

const fieldEditor = section('function FieldEditor', 'function FieldDefinitionSettings');
for (const fieldType of ['textarea', 'image', 'number', 'date', 'color']) {
  assert.ok(fieldEditor.includes(`field.type === '${fieldType}'`), `${fieldType} fields must retain their purpose-built editor`);
}
includesAll(
  manager,
  [
    'HtmlDatePicker as CmsDatePicker',
    '<CmsDatePicker label={field.label}',
    'data-kodety-cms-color-control',
    'data-kodety-settings-control-inner',
    'function CmsColumnHeader',
    '<DropdownMenuSubTrigger',
    'Editar campo',
    'Ordenar por',
    'Ocultar',
    'collisionPadding={12}',
    "if (field.key === 'slug')",
    'function cmsSlugPreview',
    '<Globe aria-hidden="true"',
    'permalink={String(editingItem?.values.permalink || \'\')}',
    'className="text-balance"',
  ],
  'refined CMS date, number, color, slug, and balanced labels',
);
includesAll(
  datePicker,
  [
    'export function HtmlDatePicker',
    'data-kodety-cms-date-trigger',
    'data-kodety-cms-calendar',
    'formatDatePart',
  ],
  'shared CMS date picker implementation',
);
assert.ok(!manager.includes('type="date"'), 'CMS date fields must not reopen the browser-native calendar');
assert.ok(!datePicker.includes('type="date"'), 'the shared CMS date picker must not delegate back to the browser-native calendar');
assert.match(
  wordpressEditorCss + await readFile(path.join(root, 'app/globals.css'), 'utf8'),
  /\[data-kodety-cms-color-control\][\s\S]*?\[data-slot=['"]color-picker-trigger['"]\][\s\S]*?background:\s*var\(--kodety-cms-control-fill\)\s*!important;/,
  'CMS color controls must use the same authored-data fill as every other field',
);
assert.match(
  fieldEditor,
  /\['true_false', 'boolean'\][\s\S]*?<Switch[\s\S]*?onCheckedChange=\{next => onChange\(next\)\}/,
  'boolean form fields must persist toggle changes',
);
assert.match(
  fieldEditor,
  /type="number"[\s\S]*?onChange=\{event => onChange\(event\.target\.value === '' \? '' : Number\(event\.target\.value\)\)\}/,
  'number form fields must persist numeric values without coercing an empty draft to zero',
);

const cmsColorPickerCalls = manager.match(/<CmsColorPicker\b[\s\S]*?\/>/g) || [];
assert.equal(cmsColorPickerCalls.length, 2, 'CMS must keep one picker for item values and one for schema defaults');
for (const call of cmsColorPickerCalls) {
  assert.ok(call.includes('colorVariableCapability={null}'), 'standalone CMS color pickers must not inherit a legacy variable repository');
  assert.ok(call.includes('solidOnly'), 'CMS color values must remain concrete solid colors');
}
assert.doesNotMatch(
  manager,
  /(?:useColorVariablesStore|colorVariablesApi|nextColorVariableCapability|@\/lib\/api)/,
  'CMS color composition must not fetch or mutate the legacy color-variable repository',
);

const managerBody = section('export function HtmlCmsManager');
includesAll(
  bindings,
  [
    'CMS_SCHEMA_CACHE_TTL_MS',
    'CMS_SCHEMA_CACHE_MAX_STALE_MS',
    'CMS_SCHEMA_REQUEST_TIMEOUT_MS',
    'normalizeCmsSchema',
    'window.sessionStorage.getItem',
    'window.sessionStorage.setItem',
    'stored.identity !== identity',
    '!persisted.fresh',
    'requestAndCacheCmsSchema',
    'key?.startsWith(CMS_SCHEMA_CACHE_PREFIX)',
    'generation === cmsSchemaCacheGeneration',
    'cmsSchemaCacheGeneration += 1',
    "window.addEventListener('storage'",
    'window.localStorage.setItem(CMS_SCHEMA_INVALIDATION_STORAGE_KEY',
    'CMS_SCHEMA_INVALIDATED_EVENT',
    'CMS_SCHEMA_UPDATED_EVENT',
    'controller.abort()',
  ],
  'bounded, validated CMS schema cache',
);
includesAll(
  managerBody,
  [
    "useState(() => initialCollection || initialPostType || 'post')",
    'fetchCmsJsonWithDeadline<{ fields?: KodetyFieldDefinition[]; revision?: string }>',
    'fetchCmsJsonWithDeadline<{ items?: CmsItem[]; total?: number; totalPages?: number }>',
    'window.addEventListener(CMS_SCHEMA_INVALIDATED_EVENT, refreshSchema)',
    'window.addEventListener(CMS_SCHEMA_UPDATED_EVENT, refreshSchema)',
  ],
  'parallel CMS startup reads',
);
assert.ok(!managerBody.includes("const [activeType, setActiveType] = useState('')"), 'CMS startup must not wait for schema before requesting the default collection');
assert.match(
  manager,
  /CMS_READ_REQUEST_TIMEOUT_MS\s*=\s*12_000[\s\S]*?controller\.abort\(\)[\s\S]*?O CMS demorou mais de 12 segundos/,
  'CMS item and field reads must fail with an actionable deadline instead of loading indefinitely',
);
includesAll(
  managerBody,
  [
    'kodety:cms:columns:v2:',
    'columnCandidates.map(field => field.key)',
    'data-cms-items-grid',
    'data-cms-grid-cell={field.key}',
    'focus-within:bg-white/[0.025]',
    'focus-within:shadow-[inset_0_-1px_0_var(--kodety-accent)]',
    'border-r border-white/[.055]',
    'font-medium normal-case tracking-normal text-foreground/70',
    'hover:bg-white/[.018]',
    'data-cms-items-toolbar',
    "searchExpanded || search ? 'w-40 sm:w-56' : 'w-9'",
    '{tableItems.map(item => (',
    'Role horizontalmente para ver todos.',
  ],
  'structured CMS grid',
);
assert.ok(!managerBody.includes('m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px]'), 'the item table must use the CMS surface directly instead of a nested rounded card');
assert.ok(!managerBody.includes('border-r border-white/[0.065]'), 'the CMS item grid must use horizontal rhythm instead of spreadsheet-style vertical strokes');
includesAll(
  manager,
  [
    'data-kodety-cms-description',
    'Preenchido apenas na criação e continua editável.',
    'function CmsCheckbox',
    'appearance-none rounded-[4px]',
    'data-kodety-cms-search',
  ],
  'balanced field descriptions and native CMS controls',
);
includesAll(managerBody, ['className={`group relative my-0.5', 'bg-[var(--kodety-accent-muted)]'], 'contextual field navigation');
includesAll(
  managerBody,
  [
    'role="tablist"',
    'aria-label="Área do CMS"',
    "{ value: 'collections', label: 'Coleções' }",
    "{ value: 'fields', label: 'Campos' }",
    '<Plus /> Nova collection',
    '<FileSpreadsheet /> Importar conteúdo CSV',
    'border-t border-[var(--kodety-divider)] px-3 pb-4 pt-3',
    'h-9 w-full justify-center rounded-[7px] px-3',
    'sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4',
    'items-center gap-4 border-b',
  ],
  'CMS navigation, retained collection actions, and item-editor spacing',
);
assert.match(
  wordpressEditorCss,
  /\[data-kodety-cms-search\] \[data-slot="input"\][\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/,
  'the WordPress input skin must not reintroduce a nested search field surface',
);
assert.ok(!managerBody.includes('`${selectedType?.name || activeType} · WordPress`'), 'the item editor must not repeat collection and provider context');
assert.ok(!managerBody.includes("view === 'plugins'"), 'Plugins must not return as a CMS workspace tab');
assert.ok(
  !managerBody.includes('A visualização rápida aceita no máximo 5 campos.'),
  'the horizontally scrollable CMS grid must not cap the number of visible fields',
);
assert.ok(!/visibleFieldKeys\.length\s*[>=]+\s*5/.test(managerBody), 'the visible-columns control must allow every collection field');
const inlineMutation = section('const updateItemField = useCallback', 'const addField = useCallback');
includesAll(
  inlineMutation,
  [
    'const cellMutationKey = `${activeType}:${item.id}:${key}`',
    'const itemMutationKey = `${activeType}:${item.id}`',
    'const version = (cellMutationVersionsRef.current.get(cellMutationKey) || 0) + 1',
    'cellMutationVersionsRef.current.set(cellMutationKey, version)',
    'const previous = cellMutationChainsRef.current.get(itemMutationKey) || Promise.resolve()',
    'if (cellMutationVersionsRef.current.get(cellMutationKey) !== version) return',
    'const expectedRevision = itemRevisionsRef.current.get(item.id) || item.revision',
    "method: 'POST'",
    'body: JSON.stringify({ values: { [key]: value }, expectedRevision })',
    "if (!response.ok) throw await cmsMutationError(response, 'Não foi possível salvar a célula.')",
    'if (!isCmsRevisionToken(saved.revision))',
    'itemRevisionsRef.current.set(saved.id, saved.revision)',
    'cellMutationVersionsRef.current.delete(cellMutationKey)',
    'cellMutationChainsRef.current.set(itemMutationKey, mutation)',
    'cellMutationChainsRef.current.get(itemMutationKey) === mutation',
    'cellMutationChainsRef.current.delete(itemMutationKey)',
    'notifyItemsChanged()',
  ],
  'inline cell persistence',
);
assert.match(inlineMutation, /setItems\(current\s*=>\s*current\.map/, 'inline cell persistence must optimistically update the current item list');
assert.ok(
  inlineMutation.search(/setItems\(current\s*=>\s*current\.map/) < inlineMutation.indexOf('const previous = cellMutationChainsRef.current.get(itemMutationKey)'),
  'inline edits must update the table optimistically before waiting on WordPress',
);
assert.match(
  inlineMutation,
  /catch \(error\) \{[\s\S]*?cellMutationVersionsRef\.current\.get\(cellMutationKey\) !== version[\s\S]*?status: key === 'status' \? item\.status[\s\S]*?\[key\]: item\.values\[key\]/,
  'a failed latest inline mutation must roll back status, label, and field value',
);
assert.match(
  inlineMutation,
  /if \(isCmsRevisionError\(error\)\) await refreshAfterRevisionConflict\(\);\s*else toast\.error/,
  'an inline CAS conflict must refresh canonical state without retrying the stale write',
);
assert.match(
  inlineMutation,
  /cellMutationPendingCountRef\.current \+= 1[\s\S]*?finally \{[\s\S]*?cellMutationPendingCountRef\.current = Math\.max/,
  'every inline mutation must remain visible as pending until its serialized request settles',
);
assert.match(
  inlineMutation,
  /\.then\(async \(\) => \{[\s\S]*?try \{\s*if \(cellMutationVersionsRef\.current\.get\(cellMutationKey\) !== version\) return(?: true)?;\s*const expectedRevision[\s\S]*?const response = await cmsFetch/,
  'a superseded inline mutation must no-op inside try before reading or fetching CMS data',
);
assert.match(
  inlineMutation,
  /\} finally \{\s*if \(cellMutationVersionsRef\.current\.get\(cellMutationKey\) === version\) \{\s*cellMutationVersionsRef\.current\.delete\(cellMutationKey\);\s*\}\s*cellMutationPendingCountRef\.current = Math\.max\(0, cellMutationPendingCountRef\.current - 1\);\s*setCellMutationsPending\(cellMutationPendingCountRef\.current\);\s*\}/,
  'the inline queue must decrement pending state from inside finally, including superseded no-ops',
);
assert.match(
  managerBody,
  /const saveBeforeWorkspaceNavigation[\s\S]*?uploadingField \|\| collectionSaving \|\| creatingCollection \|\| bulkDeleting \|\| deletingId > 0[\s\S]*?Aguarde a operação atual antes de sair do CMS[\s\S]*?return false/,
  'CMS navigation must not unload a pending inline WordPress write',
);
assert.match(
  managerBody,
  /href=\{urlWithParam\(wp\.settingsUrl, 'section', 'mcp'\)\}[\s\S]*?event\.preventDefault\(\);[\s\S]*?void leaveManager\(urlWithParam\(wp\.settingsUrl!, 'section', 'mcp'\)\)/,
  'the CMS Settings shortcut must use the same dirty/pending navigation guard as Back',
);

includesAll(
  managerBody,
  [
    "if (event.key === 'Escape')",
    "if (event.key !== 'Tab' || !itemEditorRef.current) return",
    'if (editingDirty && !window.confirm',
    'JSON.stringify(initialValues[key]) !== JSON.stringify(value)',
    "editing === 'new' ? { ...formValues, ...(featuredImage.id !== null ? { featured_image: featuredImage.id } : {}) } : changed",
    'aria-live="polite"',
  ],
  'item editor keyboard and save behavior',
);
assert.match(
  managerBody,
  /<CmsTableCell[\s\S]*?onChange=\{value => void updateItemField\(item, field\.key, value\)\}/,
  'every inline cell control must reach the serialized WordPress mutation queue',
);
assert.match(
  managerBody,
  /<FieldEditor[\s\S]*?onChange=\{value\s*=>\s*setFormValues\(current\s*=>\s*\(\{\s*\.\.\.current,\s*\[field\.key\]: value,?\s*\}\)\s*\)\s*\}/,
  'all detailed item controls must update the dirty form state',
);
assert.match(
  managerBody,
  /onUploadImage=\{\(file, apply\) => void uploadImage\(file, apply, field\.key\)\}/,
  'media controls must keep the field key when uploading to WordPress',
);
assert.match(
  csvImport,
  /const canPublishTarget = mode === 'new' \|\| targetType\?\.capabilities\?\.publish !== false[\s\S]*?if \(!canPublishTarget && status === 'publish'\) setStatus\('draft'\)/,
  'CSV import must downgrade to draft when the destination collection cannot publish',
);
assert.match(
  csvImport,
  /\{canPublishTarget \? <SelectItem value="publish">Publicado<\/SelectItem> : null\}/,
  'CSV import must not offer a publish status without the destination capability',
);
assert.match(
  csvImport,
  /if \(newFieldColumns\.length && !wp\.cmsFieldsUrl\)[\s\S]*?Endpoint de campos indisponível/,
  'CSV import must fail before item creation when mapped fields cannot be provisioned',
);

const csvImportStart = csvImport.indexOf('const runImport = useCallback');
const csvImportEnd = csvImport.indexOf('const optionsForColumn = useMemo', csvImportStart);
assert.notEqual(csvImportStart, -1, 'CSV import must retain its commit workflow');
assert.notEqual(csvImportEnd, -1, 'CSV import must retain a bounded workflow section');
const csvImportWorkflow = csvImport.slice(csvImportStart, csvImportEnd);
includesAll(
  csvImport,
  [
    'const MAX_IMPORT_ROWS = 1000',
    'table.length - 1 > MAX_IMPORT_ROWS',
    'lotes de até ${MAX_IMPORT_ROWS} itens',
  ],
  'CSV row limits aligned with the WordPress batch contract',
);
includesAll(
  wordpressPlugin,
  [
    "'/cms/items/(?P<post_type>[a-zA-Z0-9_-]+)/import'",
    "'callback' => [$this, 'import_cms_items']",
    'if (count($items) > 1000)',
  ],
  'bounded WordPress CSV batch endpoint',
);
assert.match(
  csvImportWorkflow,
  /const items = rows\.map[\s\S]*?restEndpoint\(wp\.cmsItemsUrl, `\/\$\{encodeURIComponent\(slug\)\}\/import`\)[\s\S]*?\{ items, expectedRevision \}/,
  'CSV rows must be committed through one atomic /import request',
);
assert.ok(!csvImport.includes('runPool'), 'CSV import must not return to concurrent per-row requests');
assert.ok(!/\b(?:succeeded|failed)\s*\+=/.test(csvImportWorkflow), 'CSV import must not report a partially successful per-row commit');

includesAll(
  csvImportWorkflow,
  [
    "let createdCollectionSlug = ''",
    'error.detail?.rollbackFailed === true',
    'if (createdCollectionSlug && wp.cmsCollectionsUrl)',
    "method: 'DELETE'",
    'confirmation: createdCollectionSlug',
    'deleteItems: false',
    "newFieldColumns.length && mode === 'existing'",
  ],
  'CSV setup compensation without stale schema replacement',
);
includesAll(
  csvImport,
  ["mode === 'existing' && newFieldColumns.length", 'mapeie apenas campos já criados ou ignore a coluna'],
  'existing-collection schema preflight',
);
assert.ok(!csvImportWorkflow.includes('{ fields: previousFieldDefinitions }'), 'CSV failure must not restore a stale whole-schema snapshot over another tab');
assert.ok(!csvImportWorkflow.includes('deleteItems: true'), 'CSV compensation must never delete an unexpectedly non-empty collection');
includesAll(
  csvImport,
  ['disabled={importing} onClick={() => onOpenChange(false)}', "{importing ? 'Confirmando lote…' : 'Cancelar'}"],
  'non-interruptible atomic CSV commit feedback',
);
assert.ok(!csvImport.includes('Interromper'), 'the CSV UI must not promise that an in-flight atomic commit can be interrupted');

const collectionRename = section('const updateCollection = useCallback', 'const deleteCollection = useCallback');
includesAll(
  collectionRename,
  [
    "method: 'PUT'",
    'encodeURIComponent(editingCollection.slug)',
    'name: editingCollection.name.trim()',
    'singular: editingCollection.singular.trim()',
    'const stableSlug = updated.slug || editingCollection.slug',
  ],
  'collection display-name editing with a stable internal slug',
);
assert.ok(!/\n\s*slug:\s*editingCollection\.slug/.test(collectionRename), 'renaming a collection must not replace its internal binding identifier');
assert.ok(!/\n\s*urlSlug:/.test(collectionRename), 'renaming collection labels must not mutate the published URL slug');

const collectionDelete = section('const deleteCollection = useCallback', 'const saveFields = useCallback');
includesAll(
  collectionDelete,
  [
    'if (editingCollection.itemCount > 0)',
    'Mova todos os itens desta collection para a lixeira antes de excluí-la.',
    "method: 'DELETE'",
    'confirmation: editingCollection.slug',
    'deleteItems: false',
  ],
  'safe empty-collection deletion',
);
assert.ok(!collectionDelete.includes('deleteItems: true'), 'the manager must never request destructive deletion of collection items');
includesAll(
  managerBody,
  [
    '<Pencil /> Renomear collection',
    '<Trash2 /> Excluir collection…',
    'O ID <code>{editingCollection.slug}</code> e a URL permanecem estáveis',
    'disabled={collectionSaving || editingCollection.itemCount > 0}',
  ],
  'collection rename/delete controls and non-empty guard',
);
assert.match(
  managerBody,
  /value=\{editingCollection\.urlSlug\}[\s\S]*?readOnly[\s\S]*?disabled/,
  'collection display-name editing must keep the published URL slug read-only',
);
includesAll(bindings, ['urlSlug?: string', 'readOnly?: boolean'], 'collection lifecycle schema metadata');

console.log('CMS editor: inline editing, atomic CSV import, collection lifecycle, keyboard, selects, toggles and media contracts approved.');
