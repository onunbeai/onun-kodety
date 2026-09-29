import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { codeComponentReactRuntimePlugin } from '../../../scripts/vite-code-component-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const api = await server.ssrLoadModule('/WebApp/kodety-studio/src/html-directory.ts');
const { projectForDeletion } = await server.ssrLoadModule('/WebApp/kodety-studio/src/project-deletion.ts');
const { projectToZipBlob } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
after(() => server.close());
const globals = Object.fromEntries(['window', 'navigator', 'indexedDB'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => { for (const [key, descriptor] of Object.entries(globals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
const assign = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

function storage() {
  const files = new Map();
  const directories = new Set(['']);
  const records = new Map();
  const missing = () => new DOMException('Missing', 'NotFoundError');
  const directory = (prefix = '') => ({
    kind: 'directory', name: prefix.split('/').at(-1) || 'origin',
    async getDirectoryHandle(name, { create = false } = {}) {
      assert.ok(name && !name.includes('/') && name !== '..');
      const full = prefix ? `${prefix}/${name}` : name;
      if (!directories.has(full)) { if (!create) throw missing(); directories.add(full); }
      return directory(full);
    },
    async getFileHandle(name, { create = false } = {}) {
      assert.ok(name && !name.includes('/') && name !== '..');
      const full = prefix ? `${prefix}/${name}` : name;
      if (!files.has(full)) { if (!create) throw missing(); files.set(full, new Uint8Array()); }
      return { name, kind: 'file', async getFile() { if (!files.has(full)) throw missing(); return new File([files.get(full)], name); },
        async createWritable() { let pending; return { async write(value) { pending = value; }, async close() { files.set(full, pending); }, async abort() {} }; } };
    },
    async removeEntry(name, { recursive = false } = {}) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (files.delete(full)) return;
      if (!directories.has(full)) throw missing();
      const children = [...files.keys(), ...directories].filter(value => value.startsWith(full + '/'));
      if (children.length && !recursive) throw new DOMException('Not empty', 'InvalidModificationError');
      directories.delete(full);
      for (const child of children) { files.delete(child); directories.delete(child); }
    },
    async *entries() {
      const start = prefix ? prefix + '/' : '';
      const names = new Set([...directories, ...files.keys()].filter(value => value.startsWith(start) && value !== prefix).map(value => value.slice(start.length).split('/')[0]));
      for (const name of names) yield [name, directories.has(start + name) ? await this.getDirectoryHandle(name) : await this.getFileHandle(name)];
    },
  });
  const database = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx = { objectStore() {
          const operation = run => { const result = {}; queueMicrotask(() => { result.result = run(); tx.oncomplete(); }); return result; };
          return { get: key => operation(() => structuredClone(records.get(key))), put: (value, key) => operation(() => { records.set(key, structuredClone(value)); return key; }), delete: key => operation(() => records.delete(key)) };
        } };
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  assign('window', { isSecureContext: true });
  assign('navigator', { storage: { getDirectory: async () => directory() } });
  assign('indexedDB', database);
  return { files, directories, records, directory };
}
const namespace = 'kodety-studio-html-projects-v1';

test('OPFS support is independent of local folder picker and requires only actual base capabilities', () => {
  storage();
  assert.equal(api.supportsHtmlDirectory(), false);
  assert.equal(api.supportsHtmlBrowserStorage(), true);
  window.showDirectoryPicker = () => {};
  assert.equal(api.supportsHtmlDirectory(), true);
  delete navigator.storage.getDirectory;
  assert.equal(api.supportsHtmlBrowserStorage(), false);
  assert.equal(api.supportsHtmlDirectory(), true);
  window.isSecureContext = false;
  assert.equal(api.supportsHtmlDirectory(), false);
});

test('managed files persist through rebinding, serialized saves, and editable ZIP export', async () => {
  const f = storage();
  const handle = await api.createManagedHtmlDirectory('project-one');
  assert.equal(handle.queryPermission, undefined, 'OPFS does not require a local permission API');
  assert.equal(await api.authorizeHtmlDirectory(handle), true);
  assert.deepEqual(f.records.get('project-one'), { kind: 'kodety-managed-html-directory-v1', projectId: 'project-one' });
  const initial = await api.loadHtmlDirectory(handle, 'My site');
  const session = api.createHtmlDirectorySession(handle, initial);
  const current = { ...initial, files: { ...initial.files,
    'index.html': { path: 'index.html', mimeType: 'text/html', text: '<main>Saved in this browser</main>' },
    'assets/logo.png': { path: 'assets/logo.png', mimeType: 'image/png', data: new Uint8Array([137, 80, 78, 71]) },
  } };
  await session.save(current); await session.flush();
  const reopened = await api.readHtmlDirectoryHandle('project-one');
  assert.notEqual(reopened, handle, 'reopening resolves a fresh handle from the persistent marker');
  assert.equal(await api.requestStoredHtmlDirectoryAccess('project-one'), true);
  const project = await api.loadHtmlDirectory(reopened, 'My site');
  assert.match(project.files['index.html'].text, /Saved in this browser/);
  assert.deepEqual([...project.files['assets/logo.png'].data], [137, 80, 78, 71]);
  const blob = await projectToZipBlob(project);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.match(await zip.file('index.html').async('string'), /Saved in this browser/);
  assert.deepEqual([...await zip.file('assets/logo.png').async('uint8array')], [137, 80, 78, 71]);
  assert.ok(Object.keys(zip.files).every(name => !name.includes(namespace) && !name.includes('storage-check')));
  assert.equal([...f.files.keys()].some(name => name.includes('storage-check')), false);
});

test('managed identity never grants permissions to unrelated local handles or another project', async () => {
  const f = storage();
  const one = await api.createManagedHtmlDirectory('project-one');
  assert.equal(await api.authorizeHtmlDirectory(f.directory('unrelated-local-folder')), false);
  await assert.rejects(api.bindHtmlDirectory('project-two', one), error => error.code === 'html_browser_project_invalid');
  assert.equal(f.records.has('project-two'), false);
  for (const id of ['../outside', '/absolute', 'a/b', '', 'a\\b']) await assert.rejects(api.createManagedHtmlDirectory(id), error => error.code === 'html_browser_project_invalid');
});

test('reopening or recreating a missing managed project never manufactures a new empty project', async () => {
  const f = storage();
  await api.createManagedHtmlDirectory('project-one');
  f.directories.delete(`${namespace}/project-one`);
  await assert.rejects(api.readHtmlDirectoryHandle('project-one'), error => error.code === 'html_browser_storage_missing');
  await assert.rejects(api.createManagedHtmlDirectory('project-one'), error => error.code === 'html_browser_storage_missing');
  assert.equal(f.directories.has(`${namespace}/project-one`), false);
  assert.equal([...f.files.keys()].some(name => name.endsWith('index.html')), false);
});

test('forgetting a project removes only its owned OPFS directory and persistent binding', async () => {
  const f = storage();
  for (const id of ['project-one', 'project-two']) await api.loadHtmlDirectory(await api.createManagedHtmlDirectory(id), id);
  f.files.set('unrelated.txt', 'keep');
  await api.forgetHtmlDirectory('project-one');
  assert.equal(f.records.has('project-one'), false);
  assert.equal([...f.files.keys()].some(name => name.startsWith(`${namespace}/project-one/`)), false);
  assert.ok(f.files.has(`${namespace}/project-two/index.html`));
  assert.equal(f.files.get('unrelated.txt'), 'keep');
});

test('legacy HTML deletion is routed by its binding without requiring folder access', async () => {
  const f = storage();
  const legacy = { id: 'project-one', mode: 'wordpress', storageMode: 'folder' };
  assert.equal(await projectForDeletion(legacy), legacy, 'ordinary WordPress projects retain their runtime');
  f.records.set(legacy.id, { kind: 'directory', name: 'local-site' });
  assert.deepEqual(await projectForDeletion(legacy), { ...legacy, mode: 'html', storageMode: 'folder' });
  f.files.set('local-site/index.html', 'keep the original folder');
  await api.forgetHtmlDirectory(legacy.id);
  assert.equal(f.records.has(legacy.id), false);
  assert.equal(f.files.get('local-site/index.html'), 'keep the original folder');

  await api.createManagedHtmlDirectory(legacy.id);
  // Even deleted OPFS files can be unlinked from the catalog; inspection must
  // not open the directory or try to start the WordPress runtime.
  f.directories.delete(`${namespace}/${legacy.id}`);
  assert.deepEqual(await projectForDeletion(legacy), { ...legacy, mode: 'html', storageMode: 'browser' });
  await api.forgetHtmlDirectory(legacy.id);
  assert.equal(f.records.has(legacy.id), false);
});

test('HTML deletion preserves the binding when browser-owned files cannot be removed', async () => {
  const f = storage();
  await api.loadHtmlDirectory(await api.createManagedHtmlDirectory('project-one'), 'One');
  navigator.storage.getDirectory = async () => { throw new DOMException('Denied', 'SecurityError'); };
  await assert.rejects(api.forgetHtmlDirectory('project-one'), error => error.code === 'html_browser_storage_unavailable');
  assert.equal(f.records.has('project-one'), true);
  assert.ok(f.files.has(`${namespace}/project-one/index.html`));
});

test('unavailable or denied OPFS reports storage-specific errors without assuming a browser brand', async () => {
  storage();
  delete navigator.storage.getDirectory;
  await assert.rejects(api.createManagedHtmlDirectory('project-one'), error => error.code === 'html_browser_storage_unavailable' && !/Chrome|Edge|Safari|Arc/.test(error.message));
  navigator.storage.getDirectory = async () => { throw new DOMException('Denied', 'SecurityError'); };
  await assert.rejects(api.createManagedHtmlDirectory('project-one'), error => error.code === 'html_browser_storage_unavailable');
});
