import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from '../../../scripts/vite-code-component-runtime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { loadHtmlDirectory, createHtmlDirectorySession, authorizeHtmlDirectory, requestStoredHtmlDirectoryAccess, isPrivateHtmlPath, isPublicHtmlPath, publishHtmlDirectory } = await server.ssrLoadModule('/WebApp/kodety-studio/src/html-directory.ts');
const { writeChangedProjectFiles } = await server.ssrLoadModule('/lib/html-editor/local-folder-sync.ts');
after(() => server.close());
const originalIndexedDB = globalThis.indexedDB;
afterEach(() => { if (originalIndexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = originalIndexedDB; });

function folder(initial = {}) {
  const files = new Map(Object.entries(initial));
  const directories = new Set(['']);
  for (const path of files.keys()) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/')); }
  const writes = [];
  let permission = 'granted';
  let failPath = null;
  const missing = () => new DOMException('Missing', 'NotFoundError');
  const handle = (prefix = '') => ({
    name: prefix.split('/').at(-1) || 'site', kind: 'directory',
    async queryPermission() { return permission; },
    async requestPermission() { permission = 'granted'; return permission; },
    async getDirectoryHandle(name, { create = false } = {}) {
      assert.ok(name && !name.includes('/') && name !== '..');
      const full = prefix ? `${prefix}/${name}` : name;
      if (!directories.has(full) && !create) throw missing();
      if (create) directories.add(full);
      return handle(full);
    },
    async getFileHandle(name, { create = false } = {}) {
      assert.ok(name && !name.includes('/') && name !== '..');
      const full = prefix ? `${prefix}/${name}` : name;
      if (!files.has(full) && !create) throw missing();
      return {
        name, kind: 'file',
        async getFile() { if (!files.has(full)) throw missing(); return new File([files.get(full)], name); },
        async createWritable() {
          let pending;
          return {
            async write(value) { if (full === failPath) throw new Error('Disk full'); pending = value; },
            async close() { writes.push(full); files.set(full, pending); },
            async abort() {},
          };
        },
      };
    },
    async removeEntry(name) { const full = prefix ? `${prefix}/${name}` : name; if (!files.has(full)) throw missing(); files.delete(full); writes.push(`delete:${full}`); },
    async *entries() {
      const start = prefix ? `${prefix}/` : '';
      const names = new Set([...directories, ...files.keys()].filter(value => value.startsWith(start) && value !== prefix).map(value => value.slice(start.length).split('/')[0]));
      for (const name of names) { const full = start + name; yield [name, directories.has(full) ? handle(full) : await this.getFileHandle(name)]; }
    },
  });
  return { handle: handle(), files, writes, directories, revoke: () => { permission = 'prompt'; }, fail: (path) => { failPath = path; } };
}
const project = (files) => ({ name: 'Site', rootPath: '', mainHtmlPath: 'index.html', openedAt: 1, files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, { path, text, mimeType: path.endsWith('.html') ? 'text/html' : 'text/plain' }])) });

test('loads authored HTML with binary assets, excluding secrets and version control', async () => {
  const f = folder({ 'index.html': '<main>Hello</main>', 'img/photo.png': new Uint8Array([1, 2, 3]), '.git/config': 'private', '.env.production': 'TOKEN=secret', '.kodety/state.json': '{}' });
  const result = await loadHtmlDirectory(f.handle, 'Site');
  assert.deepEqual(Object.keys(result.files).sort(), ['img/photo.png', 'index.html']);
  assert.deepEqual([...result.files['img/photo.png'].data], [1, 2, 3]);
  assert.equal(f.writes.length, 0);
});

test('a truly empty folder creates real editable source immediately', async () => {
  const f = folder();
  const result = await loadHtmlDirectory(f.handle, 'Site');
  assert.ok(result.files['index.html']);
  assert.ok(f.files.has('index.html'));
  assert.ok(f.files.has('styles.css'));
});

test('nonempty folders without HTML are rejected without overwriting files', async () => {
  const f = folder({ 'README.md': 'Keep me' });
  await assert.rejects(loadHtmlDirectory(f.handle, 'Site'), /não contém HTML/);
  assert.deepEqual([...f.files], [['README.md', 'Keep me']]);
});

test('write preflight rejects traversal, mismatched paths and git internals before any mutation', async () => {
  for (const path of ['../outside.txt', '/absolute.html', 'nested/../outside.txt', '.git/config', 'C:/file.txt', 'nested\\outside.txt', 'a//b.txt']) {
    const f = folder();
    await assert.rejects(writeChangedProjectFiles(f.handle, null, project({ 'index.html': 'safe', [path]: 'no' })), /inválido/);
    assert.equal(f.writes.length, 0);
  }
  const f = folder();
  const bad = project({ 'index.html': 'safe' }); bad.files['index.html'].path = 'elsewhere.html';
  await assert.rejects(writeChangedProjectFiles(f.handle, null, bad), /inconsistente/);
});

test('only tracked removed files are deleted; unrelated files and directories survive', async () => {
  const f = folder({ 'index.html': 'old', 'old.txt': 'obsolete', 'README.md': 'manual' });
  await writeChangedProjectFiles(f.handle, project({ 'index.html': 'old', 'old.txt': 'obsolete' }), project({ 'index.html': 'new' }));
  assert.equal(f.files.get('README.md'), 'manual');
  assert.equal(f.files.get('index.html'), 'new');
  assert.equal(f.files.has('old.txt'), false);
});

test('serialized saves preserve the newest source and pause on revoked permission', async () => {
  const f = folder({ 'index.html': '<main>start</main>' });
  const initial = await loadHtmlDirectory(f.handle, 'Site');
  const session = createHtmlDirectorySession(f.handle, initial);
  const next = value => ({ ...initial, files: { ...initial.files, 'index.html': { ...initial.files['index.html'], text: `<main>${value}</main>` } } });
  await Promise.all([session.save(next('first')), session.save(next('last'))]);
  assert.match(String(f.files.get('index.html')), /last/);
  f.revoke();
  await assert.rejects(session.save(next('paused')), /permissão/);
  assert.match(String(f.files.get('index.html')), /last/);
  await authorizeHtmlDirectory(f.handle, true);
  await session.save(next('resumed'));
  assert.match(String(f.files.get('index.html')), /resumed/);
});

test('external edits and newly-created conflicting files cannot be overwritten', async () => {
  const f = folder({ 'index.html': '<main>original</main>' });
  const initial = await loadHtmlDirectory(f.handle, 'Site');
  const session = createHtmlDirectorySession(f.handle, initial);
  f.files.set('index.html', '<main>outside edit</main>');
  await assert.rejects(session.save(project({ 'index.html': '<main>builder edit</main>' })), /fora do Kodety/);
  assert.equal(f.files.get('index.html'), '<main>outside edit</main>');
  f.files.set('index.html', '<main>original</main>');
  f.files.set('new.txt', 'external new file');
  await assert.rejects(session.save(project({ 'index.html': '<main>original</main>', 'new.txt': 'builder new file' })), /já existe/);
  assert.equal(f.files.get('new.txt'), 'external new file');
});

test('a partial disk failure can retry without marking failed data acknowledged', async () => {
  const f = folder({ 'index.html': '<main>old</main>', 'z.txt': 'old' });
  const initial = await loadHtmlDirectory(f.handle, 'Site');
  const session = createHtmlDirectorySession(f.handle, initial);
  const next = project({ 'index.html': '<main>new</main>', 'z.txt': 'new' });
  f.fail('z.txt');
  await assert.rejects(session.save(next), /Disk full/);
  assert.equal(session.acknowledged, initial);
  f.fail(null);
  await session.save(next);
  assert.match(String(f.files.get('index.html')), /new/);
  assert.equal(f.files.get('z.txt'), 'new');
});

test('deploy exclusion recognizes private credentials without excluding public assets', () => {
  for (const path of ['.env', '.env.local', '.git/config', 'certs/private.key', 'id_ed25519', '.vercel/project.json']) assert.equal(isPrivateHtmlPath(path), true);
  for (const path of ['assets/main.js', '.incode/project.json', 'robots.txt', '.well-known/security.txt']) assert.equal(isPrivateHtmlPath(path), false);
});


test('static publishing uses only its owned output folder and cleans tracked obsolete files', async () => {
  const f = folder({ 'index.html': '<main>source</main>' });
  await publishHtmlDirectory(f.handle, 'project-one', project({ 'index.html': '<main>public</main>', 'en/index.html': '<main>English</main>' }));
  assert.equal(f.files.get('index.html'), '<main>source</main>');
  assert.equal(f.files.get('kodety-dist/en/index.html'), '<main>English</main>');
  f.files.set('kodety-dist/manual.txt', 'keep');
  await publishHtmlDirectory(f.handle, 'project-one', project({ 'index.html': '<main>updated</main>' }));
  assert.equal(f.files.has('kodety-dist/en/index.html'), false);
  assert.equal(f.files.get('kodety-dist/manual.txt'), 'keep');
  await assert.rejects(publishHtmlDirectory(f.handle, 'another-project', project({ 'index.html': 'no' })), /não pertence/);
  const reopened = await loadHtmlDirectory(f.handle, 'Site');
  assert.deepEqual(Object.keys(reopened.files), ['index.html']);
});

test('static publishing rejects an existing user-owned output directory without touching it', async () => {
  const f = folder({ 'index.html': 'source', 'kodety-dist/precious.txt': 'user data' });
  await assert.rejects(publishHtmlDirectory(f.handle, 'project-one', project({ 'index.html': 'no' })), /não pertence/);
  assert.equal(f.files.get('kodety-dist/precious.txt'), 'user data');
  assert.equal(f.writes.length, 0);
});


test('generated output never replaces untracked manually added files', async () => {
  const f = folder();
  await publishHtmlDirectory(f.handle, 'project-one', project({ 'index.html': 'first' }));
  f.files.set('kodety-dist/manual.txt', 'manual');
  await assert.rejects(publishHtmlDirectory(f.handle, 'project-one', project({ 'index.html': 'second', 'manual.txt': 'generated' })), /não foi gerado/);
  assert.equal(f.files.get('kodety-dist/index.html'), 'first');
  assert.equal(f.files.get('kodety-dist/manual.txt'), 'manual');
});


test('public export keeps executable runtime dependencies while excluding portable private metadata', () => {
  for (const path of ['.incode/project.json', '.coday/project.json', '.incode/publish-overlay.json', '.github/workflows/deploy.yml', '.kodety-output.json']) assert.equal(isPublicHtmlPath(path), false, path);
  for (const path of ['.coday/runtime/react.mjs', '.incode/components/button.js', 'assets/logo.svg']) assert.equal(isPublicHtmlPath(path), true, path);
});


function storedDirectory(handle) {
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const transaction = { objectStore() { return { get() {
          const read = {};
          queueMicrotask(() => { read.result = handle; transaction.oncomplete(); });
          return read;
        } }; } };
        return transaction;
      } };
      request.onsuccess();
    });
    return request;
  } };
}

test('stored folders reuse real grants and request readwrite only when the browser needs permission', async () => {
  const calls = [];
  let permission = 'granted';
  const handle = { async queryPermission(options) { calls.push(['query', options.mode]); return permission; }, async requestPermission(options) { calls.push(['request', options.mode]); permission = 'granted'; return permission; } };
  storedDirectory(handle);
  assert.equal(await requestStoredHtmlDirectoryAccess('project'), true);
  assert.deepEqual(calls, [['query', 'readwrite']]);
  permission = 'prompt';
  assert.equal(await requestStoredHtmlDirectoryAccess('project'), true);
  assert.deepEqual(calls.slice(1), [['query', 'readwrite'], ['request', 'readwrite']]);
  calls.length = 0;
  assert.equal(await requestStoredHtmlDirectoryAccess('project'), true);
  assert.deepEqual(calls, [['query', 'readwrite']], 'reopened handle queries the actual grant instead of prompting again');
});

test('denial, dismissal, missing handle or expired activation never manufacture a grant', async () => {
  storedDirectory(undefined);
  assert.equal(await requestStoredHtmlDirectoryAccess('project'), false);
  for (const result of ['denied', 'prompt', new DOMException('Activation expired', 'SecurityError'), new DOMException('Dismissed', 'AbortError')]) {
    const handle = { async queryPermission() { return 'prompt'; }, async requestPermission() { if (result instanceof Error) throw result; return result; } };
    storedDirectory(handle);
    assert.equal(await requestStoredHtmlDirectoryAccess('project'), false);
  }
  storedDirectory({ async queryPermission() { return 'prompt'; }, async requestPermission() { throw new Error('Storage unavailable'); } });
  await assert.rejects(requestStoredHtmlDirectoryAccess('project'), /Storage unavailable/);
});

test('the actual Open handler preserves legacy HTML bindings and permission activation before catalog updates', async () => {
  const { readFile } = await import('node:fs/promises');
  const ts = await import('typescript').then(module => module.default);
  const source = await readFile(path.join(root, 'WebApp/kodety-studio/src/app.tsx'), 'utf8');
  const ast = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openConfirmed') callback = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(callback);
  const compiled = ts.transpileModule(`const open = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const scenario of [
    { mode: 'html', storageMode: 'folder', supportsFolder: true },
    { mode: 'html', storageMode: 'browser', supportsFolder: false },
    { mode: 'wordpress', storageMode: 'browser', supportsFolder: false },
    { mode: 'wordpress', storageMode: 'folder', supportsFolder: true },
    { mode: 'wordpress', storageMode: 'folder', supportsFolder: false, fallback: true },
    { mode: 'wordpress', storageMode: 'folder', binding: 'folder', supportsFolder: true },
    { mode: 'wordpress', storageMode: 'folder', binding: 'browser', supportsFolder: false },
  ]) {
    const calls = []; let pending, entered, manual;
    const project = { id: 'project', mode: scenario.mode, storageMode: scenario.storageMode, initialized: false };
    const resolved = scenario.binding ? { ...project, mode: 'html', storageMode: scenario.binding } : project;
    const latest = { ...project, name: 'Concurrent rename' };
    const open = new Function('action', 'browserSupport', 'l', 'requestStoredHtmlDirectoryAccess', 'repository', 'setProjects', 'enterProject', 'navigator', 'resolveStoredProject', 'supportsHtmlDirectory', 'setManualBackupConfirmed', 'setManualBackupProject', `${compiled}\nreturn open;`)(
      operation => { pending = operation(); },
      (_l, mode) => { assert.equal(mode, resolved.mode); return null; },
      (_pt, en) => en,
      async () => { calls.push('request'); },
      { async patch(id, patch) { assert.equal(id, project.id); assert.deepEqual(Object.keys(patch), ['lastOpenedAt']); calls.push('patch'); return [latest]; } },
      () => {}, value => { calls.push('open'); entered = value; },
      { onLine: resolved.mode !== 'html' },
      async () => { calls.push('resolve'); return resolved; },
      () => scenario.supportsFolder, () => {}, value => { calls.push('manual'); manual = value; },
    );
    open(project);
    if (scenario.mode === 'html') assert.deepEqual(calls, ['request'], 'explicit HTML permission request starts in the click before any awaited legacy lookup');
    await pending;
    const expected = scenario.mode === 'html' ? [] : ['resolve'];
    if (scenario.fallback) {
      assert.deepEqual(calls, [...expected, 'manual']);
      assert.equal(manual, resolved);
      assert.equal(entered, undefined);
    } else {
      assert.deepEqual(calls, [...expected, ...(resolved.mode === 'html' ? ['request'] : []), 'patch', 'open']);
      assert.deepEqual(entered, { ...latest, mode: resolved.mode, storageMode: resolved.storageMode });
      assert.equal(manual, undefined, 'browser-owned legacy HTML must not enter the WordPress ZIP fallback');
    }
  }
});

test('HTML runtime metadata updates retain the resolved editor binding without migrating legacy catalog fields', async () => {
  const { readFile } = await import('node:fs/promises');
  const ts = await import('typescript').then(module => module.default);
  const source = await readFile(path.join(root, 'WebApp/kodety-studio/src/app.tsx'), 'utf8');
  const ast = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'updateRuntimeProject') callback = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(ast);
  const compiled = ts.transpileModule(`const update = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let active = { id: 'legacy-project', mode: 'html', storageMode: 'browser', name: 'Old name' };
  const latest = { ...active, mode: 'wordpress', storageMode: 'folder', name: 'Concurrent rename' };
  const update = new Function('repository', 'setProjects', 'setActiveProject', 'activeProject', `${compiled}\nreturn update;`)(
    { async patch(_id, patch) { assert.equal('mode' in patch, false); assert.equal('storageMode' in patch, false); return [latest]; } },
    () => {}, updater => { active = updater(active); }, active,
  );
  await update({ ...active, initialized: true });
  assert.deepEqual(active, { ...latest, mode: 'html', storageMode: 'browser' });
});
