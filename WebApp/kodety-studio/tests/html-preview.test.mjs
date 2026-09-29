import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
const testRoot = path.dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-html-preview-'));
await build({ entryPoints: [path.join(testRoot, '../src/html-preview-store.ts')], outfile: path.join(scratch, 'store.mjs'), platform: 'node', format: 'esm', bundle: true, logLevel: 'silent' });
const { writeHtmlPreview, readHtmlPreview, htmlPreviewUrl } = await import(pathToFileURL(path.join(scratch, 'store.mjs')).href);
const originalIDB = globalThis.indexedDB;
afterEach(() => { if (originalIDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = originalIDB; });
after(() => rm(scratch, { recursive: true, force: true }));

function fixture() {
  const records = new Map();
  const events = [];
  let failCommit = false;
  const idb = { open(name) {
    const request = {};
    events.push(['open', name]);
    queueMicrotask(() => {
      request.result = {
        close() { events.push(['close']); },
        transaction(_store, mode) {
          const transaction = { objectStore() {
            return {
              get(key) { const read = {}; queueMicrotask(() => { read.result = structuredClone(records.get(key)); read.onsuccess?.(); transaction.oncomplete(); }); return read; },
              put(value, key) {
                const write = {}; const copied = structuredClone(value);
                queueMicrotask(() => {
                  write.result = key; write.onsuccess?.();
                  if (failCommit) { failCommit = false; transaction.error = new DOMException('Quota full', 'QuotaExceededError'); transaction.onabort(); }
                  else { records.set(key, copied); events.push(['commit', mode, key]); transaction.oncomplete(); }
                }); return write;
              },
            };
          } }; return transaction;
        },
      };
      request.onsuccess();
    }); return request;
  } };
  globalThis.indexedDB = idb;
  return { records, events, failNextCommit() { failCommit = true; } };
}
function snapshot(label = 'Saved') {
  return { language: 'pt', activeExtensions: ['kodety-localization'], project: {
    name: 'Preview fixture', openedAt: 123, rootPath: '', previewRootPath: 'site', mainHtmlPath: 'site/about.html',
    files: {
      'index.html': { path: 'index.html', text: '<h1>Home</h1>', mimeType: 'text/html' },
      'site/about.html': { path: 'site/about.html', text: `<h1>${label}</h1>`, mimeType: 'text/html' },
      'assets/photo.png': { path: 'assets/photo.png', data: new Uint8Array([0, 128, 255]), mimeType: 'image/png' },
      '.incode/project.json': { path: '.incode/project.json', text: '{"localization":{"sourceLocale":"pt-BR"}}', mimeType: 'application/json' },
    },
  } };
}

test('preview snapshot retains exact selected page, roots, metadata, extensions and binary files in isolated storage', async () => {
  const f = fixture();
  const value = snapshot();
  value.project.directoryHandle = { forbidden: 'never transport file permissions' };
  await writeHtmlPreview('550e8400-e29b-41d4-a716-446655440000', value);
  value.project.files['assets/photo.png'].data[0] = 7;
  const restored = await readHtmlPreview('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(restored.project.mainHtmlPath, 'site/about.html');
  assert.equal(restored.project.previewRootPath, 'site');
  assert.equal(restored.project.rootPath, '');
  assert.deepEqual(restored.project.files['assets/photo.png'].data, new Uint8Array([0, 128, 255]));
  assert.equal(restored.project.files['.incode/project.json'].text, value.project.files['.incode/project.json'].text);
  assert.equal(restored.project.directoryHandle, undefined);
  assert.deepEqual(restored.activeExtensions, ['kodety-localization']);
  assert.equal(restored.language, 'pt');
  restored.project.files['assets/photo.png'].data[1] = 1;
  assert.equal((await readHtmlPreview('550e8400-e29b-41d4-a716-446655440000')).project.files['assets/photo.png'].data[1], 128);
  assert.ok(f.events.every(event => event[0] !== 'open' || event[1] === 'kodety-studio-html-previews-v1'));
});

test('writes serialize, preserve call-time binary state and readers wait for committed latest source', async () => {
  fixture();
  const first = snapshot('First');
  const one = writeHtmlPreview('ordered', first);
  first.project.files['assets/photo.png'].data[0] = 42;
  const two = writeHtmlPreview('ordered', snapshot('Second'));
  const latest = await readHtmlPreview('ordered');
  await Promise.all([one, two]);
  assert.equal(latest.project.files['site/about.html'].text, '<h1>Second</h1>');
  assert.equal(latest.project.files['assets/photo.png'].data[0], 0);
});

test('aborted storage commit rejects without replacing previous snapshot and later retry works', async () => {
  const f = fixture();
  await writeHtmlPreview('retry', snapshot('Committed'));
  f.failNextCommit();
  await assert.rejects(writeHtmlPreview('retry', snapshot('Failed')), { name: 'QuotaExceededError' });
  assert.equal((await readHtmlPreview('retry')).project.files['site/about.html'].text, '<h1>Committed</h1>');
  await writeHtmlPreview('retry', snapshot('Retried'));
  assert.equal((await readHtmlPreview('retry')).project.files['site/about.html'].text, '<h1>Retried</h1>');
});

test('missing or invalid snapshot, file graph and project IDs fail without any invented preview content', async () => {
  const f = fixture();
  assert.equal(await readHtmlPreview('missing'), undefined);
  for (const id of ['', '../outside', 'id?query', 'has space']) await assert.rejects(readHtmlPreview(id), /identifier/);
  const missingPage = snapshot(); delete missingPage.project.files['site/about.html'];
  await assert.rejects(writeHtmlPreview('invalid', missingPage), /selected preview page/);
  const traversal = snapshot(); traversal.project.files['../source.html'] = { path: '../source.html', text: 'bad', mimeType: 'text/html' };
  await assert.rejects(writeHtmlPreview('invalid', traversal), /invalid file/);
  const invalidData = snapshot(); invalidData.project.files['assets/photo.png'].data = [0, 1];
  await assert.rejects(writeHtmlPreview('invalid', invalidData), /invalid file/);
  f.records.set('invalid', { version: 88, snapshot: snapshot() });
  await assert.rejects(readHtmlPreview('invalid'), /version/);
  assert.equal(f.records.size, 1);
});

test('preview URL preserves the Studio deployment subpath and requires dedicated readonly review query', () => {
  for (const base of ['https://example.com/studio/', 'https://example.com/tools/kodety/index.html?kodety-preview=1#projects', 'http://localhost:4173/']) {
    const url = new URL(htmlPreviewUrl('preview-project', base));
    assert.equal(url.origin, new URL(base).origin);
    assert.equal(url.pathname, new URL(base).pathname);
    assert.equal(url.searchParams.get('kodety-html-preview'), 'preview-project');
    assert.equal(url.searchParams.get('kodety-preview-review'), '1');
    assert.equal(url.searchParams.size, 2);
    assert.equal(url.hash, '');
    assert.equal(url.pathname.includes('wp-admin'), false);
  }
  assert.throws(() => htmlPreviewUrl('project', 'javascript:alert(1)'), /HTTP/);
});

test('actual preview reload callback rejects stale and post-unmount reads before changing displayed source', async () => {
  const source = await readFile(path.join(testRoot, '../src/html-preview.tsx'), 'utf8');
  const ast = ts.createSourceFile('html-preview.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'reloadPreview') callback = node.initializer.arguments[0].getText(ast); ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(callback);
  const compiled = ts.transpileModule(`const callback = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const pending = []; const applied = []; const generation = { current: 0 }; const mounted = { current: true };
  const reload = new Function('generation', 'mounted', 'readHtmlPreview', 'projectId', 'setSnapshot', 'window', `${compiled}\nreturn callback;`)(generation, mounted, () => new Promise(resolve => pending.push(resolve)), 'project', value => applied.push(value), { opener: null });
  const old = reload(); const newest = reload();
  pending[1](snapshot('Newest')); await newest;
  pending[0](snapshot('Old')); await assert.rejects(old, { name: 'AbortError' });
  assert.equal(applied.length, 1);
  assert.equal(applied[0].project.files['site/about.html'].text, '<h1>Newest</h1>');
  const afterExit = reload(); mounted.current = false;
  pending[2](snapshot('After exit')); await assert.rejects(afterExit, { name: 'AbortError' });
  assert.equal(applied.length, 1);
});
