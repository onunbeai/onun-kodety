import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
async function moduleAt(file) {
  const exports = {};
  new Function('exports', compile(await readFile(new URL(file, import.meta.url), 'utf8')))(exports);
  return exports;
}
const media = await moduleAt('../../lib/html-editor/settings-media.ts');
const { resolveProjectPath } = await moduleAt('../../lib/html-editor/project-path.ts');
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 32]);
const file = (name = 'logo.png', type = 'image/png', bytes = png) => new File([bytes], name, { type });
const project = (files = {}, rootPath = '') => ({ name: 'Site', files, rootPath, mainHtmlPath: [rootPath, 'index.html'].filter(Boolean).join('/'), openedAt: 123 });
const ref = current => ({ current });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('settings uploads retain binary bytes, normalize known MIME types, and reject incompatible or empty files', async () => {
  const loaded = await media.readSettingsImageUpload(file('C:\\fakepath\\Logo.PNG', ''));
  assert.equal(loaded.path, 'Logo.PNG');
  assert.equal(loaded.mimeType, 'image/png');
  assert.deepEqual(loaded.data, png);
  assert.equal(loaded.text, undefined);
  assert.equal((await media.readSettingsImageUpload(file('photo.jpg', 'image/jpg'))).mimeType, 'image/jpeg');
  assert.equal((await media.readSettingsImageUpload(file('icon.svg', 'image/svg+xml', new TextEncoder().encode('<svg/>')))).mimeType, 'image/svg+xml');
  for (const rejected of [file('page.html', 'text/html'), file('code.php', 'image/png'), file('logo.png', 'text/plain'), file('logo.png', 'image/png', new Uint8Array()), file('..', 'image/png')]) {
    await assert.rejects(media.readSettingsImageUpload(rejected), /imagem/);
  }
});

test('uploaded images have persistent project URLs that resolve from home and nested pages', async () => {
  const image = await media.readSettingsImageUpload(file('logo verão #1%.png'));
  for (const rootPath of ['', 'website', 'packages/site']) {
    const original = project({}, rootPath);
    const added = media.addSettingsImageFile(original, image);
    const expectedPath = [rootPath, 'assets', image.path].filter(Boolean).join('/');
    assert.equal(added.file.path, expectedPath);
    assert.equal(Object.keys(original.files).length, 0);
    assert.deepEqual(added.project.files[expectedPath].data, png);
    const url = media.settingsImageAssetUrl(expectedPath, rootPath);
    assert.equal(url, '/assets/logo%20ver%C3%A3o%20%231%25.png');
    for (const page of ['index.html', 'about/index.html', 'blog/article.html']) {
      assert.equal(resolveProjectPath([rootPath, page].filter(Boolean).join('/'), url, rootPath), expectedPath);
    }
  }
});

test('uploads preserve colliding files and directories, including case-insensitive filesystems', async () => {
  const image = await media.readSettingsImageUpload(file());
  const existing = { path: 'site/assets/LOGO.PNG', mimeType: 'image/png', data: Uint8Array.of(9) };
  const files = {
    [existing.path]: existing,
    'site/assets/logo-2.png/child.jpg': { path: 'site/assets/logo-2.png/child.jpg', mimeType: 'image/jpeg', data: Uint8Array.of(8) },
  };
  const original = project(files, 'site');
  const added = media.addSettingsImageFile(original, image);
  assert.equal(added.file.path, 'site/assets/logo-3.png');
  assert.equal(added.project.files[existing.path], existing);
  assert.equal(added.project.files['site/assets/logo-2.png/child.jpg'], files['site/assets/logo-2.png/child.jpg']);
  assert.equal(original.files, files);
  assert.throws(() => media.addSettingsImageFile(project({ 'site/assets': { path: 'site/assets', mimeType: 'text/plain', text: 'keep me' } }, 'site'), image), /pasta de imagens/);
  assert.equal(media.isSettingsImageFile(existing), true);
  assert.equal(media.isSettingsImageFile({ ...existing, path: '.incode/assets/logo.png' }), false);
  assert.equal(media.isSettingsImageFile({ path: 'site/index.html', mimeType: 'text/html' }), false);
});

async function implementations(file, names) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map();
  const pickers = [];
  let imagePreview;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) {
      const expression = node.initializer;
      found.set(node.name.getText(tree), (ts.isCallExpression(expression) ? expression.arguments[0] : expression).getText(tree));
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'useSettingsImagePreview') imagePreview = node.getText(tree);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SettingsMediaPicker') {
      const attribute = name => node.attributes.properties.find(item => item.name?.getText(tree) === name)?.initializer;
      pickers.push({ onChange: attribute('onChange').expression.getText(tree), upload: attribute('onUploadProjectImage').expression.getText(tree) });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const name of names) assert.ok(found.has(name), `production callback ${name}`);
  return { found, pickers, imagePreview };
}
const settings = await implementations('../../app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx', ['drainSaveQueue', 'enqueueSave', 'uploadSettingsImage', 'waitForSaveQueue']);
const host = await implementations('../../app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx', ['uploadProjectImage']);
const evaluate = (source, bindings) => new Function('bindings', `with (bindings) { ${compile(`const value = ${source};`)} return value; }`)(bindings);

test('upload completion merges image selection into the latest edited site and page drafts', () => {
  assert.equal(settings.pickers.length, 4);
  for (const picker of settings.pickers) {
    let draft = { title: 'Latest title typed during upload', description: 'Unsaved description' };
    const setDraft = update => { draft = typeof update === 'function' ? update(draft) : update; };
    const change = evaluate(picker.onChange, { setSiteDraft: setDraft, setPageDraft: setDraft, siteDraft: { title: 'Stale title' }, pageDraft: { title: 'Stale page' } });
    change('/assets/logo.png');
    assert.equal(draft.title, 'Latest title typed during upload');
    assert.equal(draft.description, 'Unsaved description');
    assert.ok(Object.values(draft).includes('/assets/logo.png'));
    assert.equal(evaluate(picker.upload, { onUploadProjectImage: () => {}, uploadSettingsImage: 'queued-upload' }), 'queued-upload');
  }
});

function uploadEnvironment() {
  const events = [];
  const state = ref(project());
  const persisted = [];
  const queue = {
    readOnly: false, activeSaveRequestRef: ref(null), activeSavePromiseRef: ref(null), saveQueueRef: ref([]), drainSaveQueueRef: ref(null),
    setSavingScope: value => events.push(['scope', value]), toast: { error: (...args) => events.push(['error', ...args]) },
  };
  queue.drainSaveQueue = evaluate(settings.found.get('drainSaveQueue'), queue);
  queue.drainSaveQueueRef.current = queue.drainSaveQueue;
  queue.enqueueSave = evaluate(settings.found.get('enqueueSave'), queue);
  queue.onUploadProjectImage = evaluate(host.found.get('uploadProjectImage'), {
    readOnly: false, projectRef: state,
    readSettingsImageUpload: media.readSettingsImageUpload, addSettingsImageFile: media.addSettingsImageFile,
    commitProject: next => { events.push('image-commit'); state.current = next; },
    persistExactDraft: async next => { events.push('image-save'); persisted.push(next); },
  });
  return { events, state, persisted, queue, upload: evaluate(settings.found.get('uploadSettingsImage'), queue), flush: evaluate(settings.found.get('waitForSaveQueue'), queue) };
}

test('image upload shares the Settings save queue so preceding ACKs and following edits preserve its bytes', async () => {
  const env = uploadEnvironment();
  const firstAck = deferred();
  const first = { ...env.state.current, name: 'Saved title before upload' };
  env.queue.enqueueSave({ scope: 'site', origin: 'manual', signature: 'before', run: async () => { await firstAck.promise; env.state.current = first; env.events.push('preceding-ack'); } });
  const uploaded = env.upload(file());
  env.queue.enqueueSave({ scope: 'site', origin: 'manual', signature: 'after', run: async () => { const next = { ...env.state.current, name: 'Latest title after upload' }; env.state.current = next; env.persisted.push(next); env.events.push('following-save'); } });
  await tick();
  assert.equal(env.events.includes('image-commit'), false);
  firstAck.resolve();
  assert.equal(await uploaded, 'assets/logo.png');
  await env.flush();
  assert.ok(env.events.indexOf('preceding-ack') < env.events.indexOf('image-commit'));
  assert.ok(env.events.indexOf('image-save') < env.events.indexOf('following-save'));
  assert.equal(env.persisted[0].name, 'Saved title before upload');
  assert.equal(env.state.current.name, 'Latest title after upload');
  assert.deepEqual(env.state.current.files['assets/logo.png'].data, png);
  assert.deepEqual(env.persisted.at(-1).files['assets/logo.png'].data, png);
});

test('upload rejects persistence failures and switched projects without selecting an unacknowledged path', async () => {
  const read = deferred();
  const state = ref(project());
  const calls = [];
  const bindings = { readOnly: false, projectRef: state, readSettingsImageUpload: () => read.promise, addSettingsImageFile: media.addSettingsImageFile, commitProject: next => { calls.push('commit'); state.current = next; }, persistExactDraft: async () => { calls.push('persist'); throw new Error('Folder permission revoked'); } };
  const upload = evaluate(host.found.get('uploadProjectImage'), bindings);
  const switched = upload(file());
  state.current = { ...project(), openedAt: 456 };
  read.resolve(await media.readSettingsImageUpload(file()));
  await assert.rejects(switched, /projeto mudou/);
  assert.deepEqual(calls, []);
  await assert.rejects(upload(file()), /Folder permission revoked/);
  assert.deepEqual(calls, ['commit', 'persist']);
  const env = uploadEnvironment();
  env.queue.onUploadProjectImage = async () => { throw new Error('Write failed'); };
  await assert.rejects(env.upload(file()), /Write failed/);
  await env.flush();
  assert.equal(env.queue.activeSaveRequestRef.current, null);
});

function previewEnvironment() {
  const created = [], revoked = [], rendered = [];
  let cleanup;
  const bindings = {
    useState: () => ['', value => rendered.push(value)], useEffect: effect => { cleanup = effect(); }, resolveProjectPath,
    window: { location: { origin: 'https://studio.test', protocol: 'https:' } },
    URL: Object.assign(class extends URL {}, { createObjectURL: blob => { created.push(blob); return `blob:preview-${created.length}`; }, revokeObjectURL: value => revoked.push(value) }),
  };
  const hook = new Function('bindings', `with (bindings) { ${compile(settings.imagePreview)} return useSettingsImagePreview; }`)(bindings);
  return { hook, created, revoked, rendered, cleanup: () => cleanup?.() };
}
test('lazy binary previews resolve project paths, create typed blobs and release them on cleanup', async () => {
  const env = previewEnvironment();
  const pending = deferred();
  const files = { 'site/assets/logo.png': { path: 'site/assets/logo.png', mimeType: 'image/png' } };
  const requested = [];
  env.hook('/assets/logo.png', files, 'site/blog/article.html', 'site', '', path => { requested.push(path); return pending.promise; });
  assert.deepEqual(requested, ['site/assets/logo.png']);
  pending.resolve({ ...files[requested[0]], data: png });
  await tick();
  assert.equal(env.created.length, 1);
  assert.equal(env.created[0].type, 'image/png');
  assert.deepEqual(new Uint8Array(await env.created[0].arrayBuffer()), png);
  assert.equal(env.rendered.at(-1), 'blob:preview-1');
  env.cleanup();
  assert.deepEqual(env.revoked, ['blob:preview-1']);
  const stale = previewEnvironment(), old = deferred();
  stale.hook('/assets/logo.png', files, 'site/index.html', 'site', '', () => old.promise);
  stale.cleanup();
  old.resolve({ ...files[requested[0]], data: png });
  await tick();
  assert.equal(stale.created.length, 0);
});
