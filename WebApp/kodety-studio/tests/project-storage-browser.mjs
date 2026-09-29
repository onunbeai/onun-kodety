// Real helper UI, production response headers and service-worker offline route.
// Filesystem success/failure is injected; real OPFS is covered separately by
// project-deletion-runtime-browser.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createKodetyStudioServer } from '../public/server.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), 'kodety-project-storage-proof-'));
await mkdir(path.join(root, 'assets'));
const script = await build({
  stdin: { resolveDir: repository, contents: "import {renderProjectStorage} from './WebApp/kodety-studio/src/project-storage'; renderProjectStorage();" },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  plugins: [{ name: 'controlled-filesystem-outcome', setup(builder) {
    builder.onResolve({ filter: /(?:r2-project-sync|r2-project-restore|r2-storage)$/ }, args => ({ path: args.path, namespace: 'r2-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'r2-fixture' }, () => ({ loader: 'js', contents: `
      export const enqueueR2ProjectDeletion = async project => localStorage.setItem('queued-r2-delete', project.id);
      export const enqueueR2Snapshot = async () => {};
      export const recordR2SyncError = () => {};
      export const getR2Connection = async () => null;
      export const subscribeR2Connection = () => () => {};
      export const finalizeR2WordPressRestore = async () => {};
      export const restorePendingR2WordPress = async () => {};
    ` }));
    builder.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path, namespace: 'empty-virtual' }));
    builder.onResolve({ filter: /\?raw$/ }, args => ({ path: args.path, namespace: 'empty-virtual' }));
    builder.onLoad({ filter: /.*/, namespace: 'empty-virtual' }, () => ({ loader: 'js', contents: 'export default "";' }));
    builder.onLoad({ filter: /\?raw$/ }, () => ({ loader: 'js', contents: 'export default "";' }));
    builder.onLoad({ filter: /playground-runtime\.ts$/ }, () => ({ loader: 'ts', contents: `
      export async function destroyProjectData({project,onStage}) {
        const calls = Number(localStorage.getItem('deletion-calls') || 0) + 1;
        localStorage.setItem('deletion-calls', String(calls));
        onStage('Confirmando a exclusão no navegador');
        if (localStorage.getItem('fail-files') === '1') throw new Error('Falha de armazenamento simulada');
        localStorage.removeItem('project-files:' + project.id);
      }
      export const PLAYGROUND_REMOTE_ORIGIN='https://playground.wordpress.net';
      export const bootProject=()=>{}, flushProject=()=>{}, navigateProject=()=>{}, projectLockName=id=>id;
    ` }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: '' }));
  } }],
});
const assets = {
  'index.html': '<!doctype html><title>Library</title><h1>Biblioteca</h1>',
  'project-storage.html': '<!doctype html><div id="kodety-studio-root"></div><script type="module" src="./assets/helper.js"></script><script>navigator.serviceWorker.register("./service-worker.js")</script>',
  'assets/helper.js': script.outputFiles[0].text,
  'manifest.webmanifest': '{}',
  'manifest.en.webmanifest': '{}',
};
for (const [name, contents] of Object.entries(assets)) await writeFile(path.join(root, name), contents);
const integrity = Object.fromEntries(Object.entries(assets).map(([name, contents]) => [`./${name}`, createHash('sha256').update(contents).digest('hex')]));
integrity['./'] = integrity['./index.html'];
await writeFile(path.join(root, 'offline-manifest.json'), JSON.stringify({ version: 'helper-proof', files: Object.keys(integrity), integrity }));
await writeFile(path.join(root, 'service-worker.js'), (await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8')).replaceAll('__KODETY_BUILD_ID__', 'helper-proof'));
const backend = createKodetyStudioServer({ root });
// Pages canonicalizes HTML filenames. Exercise its redirects while retaining
// production headers on the final response and the helper's offline cache key.
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.local');
  if (url.pathname === '/index.html' || url.pathname === '/project-storage.html') {
    response.writeHead(301, { location: (url.pathname === '/index.html' ? '/' : '/project-storage') + url.search });
    response.end();
  } else backend.emit('request', request, response);
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  const id = 'disposable-project';
  const seed = async () => page.evaluate(id => {
    localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language: 'pt', onboardingVersion: 2 }));
    localStorage.setItem('kodetyStudioProjectsV1', JSON.stringify([{ id, name: 'Projeto de teste', mode: 'wordpress', initialized: false, createdAt: Date.now(), updatedAt: Date.now() }]));
    localStorage.setItem('project-files:' + id, 'saved files');
  }, id);
  const helperUrl = `${origin}/project-storage.html?project=${id}`;
  const library = () => page.waitForURL(`${origin}/#local`);
  await seed();
  const response = await page.goto(helperUrl);
  assert.equal(response.headers()['cross-origin-embedder-policy'], undefined);
  assert.equal(response.headers()['document-isolation-policy'], 'isolate-and-credentialless');
  const dialog = page.getByRole('dialog', { name: 'Excluir projeto', exact: true });
  await expect(dialog).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('deletion-calls')), null, 'opening a URL must never delete');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await library();
  assert.equal(await page.evaluate(id => localStorage.getItem('project-files:' + id), id), 'saved files');
  assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'returning to library preserves Agent isolation');

  await page.goto(helperUrl);
  await page.evaluate(() => localStorage.setItem('fail-files', '1'));
  await dialog.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Falha de armazenamento simulada');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')).length), 1);
  assert.equal(await page.evaluate(id => localStorage.getItem('project-files:' + id), id), 'saved files');
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeEnabled();
  await page.evaluate(() => localStorage.removeItem('fail-files'));
  await dialog.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
  await library();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')).length), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('queued-r2-delete')), null, 'Local deletion must not enqueue work in the removed personal R2 integration');

  await seed();
  await page.goto(helperUrl);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'kodetyStudioProjectsV1') throw new DOMException('Blocked', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await dialog.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Não foi possível atualizar a biblioteca');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')).length), 1, 'failed catalog write retains the project');
  await page.reload();
  await expect(dialog).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    while (!await caches.match('./__kodety_offline_ready__', { cacheName: 'kodety-studio-shell-v14-helper-proof' })) await new Promise(resolve => setTimeout(resolve, 30));
  });
  await context.setOffline(true);
  await page.goto(`${origin}/#projects`);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  const offline = await page.goto(helperUrl.replace('/project-storage.html', '/project-storage'));
  assert.equal(offline.headers()['document-isolation-policy'], 'isolate-and-credentialless');
  assert.equal(offline.headers()['cross-origin-embedder-policy'], undefined, 'offline helper must never receive the cached COEP index response');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
  await library();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')).length), 0);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  console.log('Project deletion helper passed: explicit confirmation, cancel, storage failure, metadata failure, retry, canonical Pages redirects and offline isolation.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
