// Real browser regression for imported local-folder and browser-owned projects.
// Run: node WebApp/kodety-studio/tests/project-deletion-browser.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ configFile: path.join(root, 'WebApp/kodety-studio/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on('dialog', dialog => dialog.accept());
const remoteRequests = [];
page.on('request', request => { if (request.url().includes('playground.wordpress.net')) remoteRequests.push(request.url()); });
await context.route('https://playground.wordpress.net/**', route => route.abort());
try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async () => {
    localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language: 'pt', onboardingVersion: 2 }));
    localStorage.setItem('kodetyStudioWebOnboarding', '2');
    const origin = await navigator.storage.getDirectory();
    const managed = await origin.getDirectoryHandle('kodety-studio-html-projects-v1', { create: true });
    const projects = [
      { id: 'folder-project', name: 'Pasta HTML', mode: 'html', storageMode: 'folder' },
      { id: 'legacy-project', name: 'Pasta antiga', storageMode: 'folder' },
      { id: 'legacy-browser-project', name: 'HTML antigo no navegador', storageMode: 'folder' },
      { id: 'browser-project', name: 'HTML no navegador', mode: 'html', storageMode: 'browser' },
      { id: 'failing-project', name: 'Falha de armazenamento', mode: 'html', storageMode: 'browser' },
    ];
    const bindings = [];
    for (const project of projects) {
      const browserStored = project.storageMode === 'browser' || project.id === 'legacy-browser-project';
      const directory = await (browserStored ? managed : origin).getDirectoryHandle(project.id, { create: true });
      const writer = await (await directory.getFileHandle('index.html', { create: true })).createWritable();
      await writer.write(`<!doctype html><html><head><title>${project.name}</title></head><body><main><h1 id="legacy-proof">${project.name}</h1></main></body></html>`); await writer.close();
      bindings.push([project.id, browserStored ? { kind: 'kodety-managed-html-directory-v1', projectId: project.id } : directory]);
    }
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('kodety-studio-html-directories-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('directories');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('directories', 'readwrite');
        for (const [id, binding] of bindings) tx.objectStore('directories').put(binding, id);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
    const now = Date.now();
    localStorage.setItem('kodetyStudioProjectsV1', JSON.stringify(projects.map(project => ({ ...project, createdAt: now, updatedAt: now, initialized: true, wordpressLocale: 'pt_BR' }))));
  });
  await page.reload();
  for (const [id, name, browserStored] of [['legacy-project', 'Pasta antiga', false], ['legacy-browser-project', 'HTML antigo no navegador', true]]) {
    if (browserStored) await page.evaluate(() => { window.showDirectoryPicker = undefined; });
    await page.getByRole('button', { name: `Abrir ${name}`, exact: true }).click();
    const canvas = page.frameLocator('.web-html-builder iframe').first();
    await expect(canvas.locator('#legacy-proof')).toHaveText(name);
    assert.equal(new URL(page.url()).pathname, '/', 'legacy HTML opens the existing HTML editor, not the WordPress helper');
    await expect(page.getByRole('dialog', { name: 'Continuar com backup ZIP?', exact: true })).toHaveCount(0);
    const invite = page.locator('[data-onboarding-invite]');
    if (await invite.isVisible()) await invite.getByRole('button', { name: 'Não preciso', exact: true }).click();
    await canvas.locator('#legacy-proof').dblclick();
    await canvas.locator('#legacy-proof').fill(`${name} editado`);
    await canvas.locator('#legacy-proof').press('Enter');
    await expect.poll(() => page.evaluate(async ({ id, browserStored }) => {
      let directory = await navigator.storage.getDirectory();
      if (browserStored) directory = await directory.getDirectoryHandle('kodety-studio-html-projects-v1');
      const file = await (await (await directory.getDirectoryHandle(id)).getFileHandle('index.html')).getFile();
      return file.text();
    }, { id, browserStored })).toContain(`${name} editado`);
    await page.reload();
  }
  assert.deepEqual(remoteRequests, [], 'legacy HTML open and edit never start a WordPress runtime');
  for (const name of ['Pasta HTML', 'Pasta antiga', 'HTML no navegador', 'HTML antigo no navegador']) {
    await page.getByRole('button', { name: `Excluir ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Remover da biblioteca', exact: true });
    await expect(dialog).toBeVisible();
    if (name.startsWith('Pasta')) await expect(dialog).toContainText('Os arquivos HTML permanecem na sua pasta.');
    else await expect(dialog).toContainText('O projeto salvo neste navegador será apagado.');
    await dialog.getByRole('button', { name: 'Remover da biblioteca', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    for (const id of ['folder-project', 'legacy-project']) {
      const file = await (await (await origin.getDirectoryHandle(id)).getFileHandle('index.html')).getFile();
      if (!file.size) throw new Error('Local folder contents were lost');
    }
    const managed = await origin.getDirectoryHandle('kodety-studio-html-projects-v1');
    try { await managed.getDirectoryHandle('browser-project'); throw new Error('Browser project was not deleted'); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
    const removeEntry = FileSystemDirectoryHandle.prototype.removeEntry;
    FileSystemDirectoryHandle.prototype.removeEntry = function(name, options) {
      if (name === 'failing-project') return Promise.reject(new DOMException('Denied', 'SecurityError'));
      return removeEntry.call(this, name, options);
    };
  });
  await page.getByRole('button', { name: 'Excluir Falha de armazenamento', exact: true }).click();
  const failure = page.getByRole('dialog', { name: 'Remover da biblioteca', exact: true });
  await failure.getByRole('button', { name: 'Remover da biblioteca', exact: true }).click();
  await expect(failure.getByRole('alert')).toContainText('O armazenamento deste navegador não está disponível.');
  await expect(failure.getByRole('button', { name: 'Cancelar', exact: true })).toBeEnabled();
  const remaining = await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')).map(project => project.id));
  assert.deepEqual(remaining, ['failing-project']);
  assert.deepEqual(remoteRequests, [], 'HTML removal never loads the WordPress runtime');
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('kodetyStudioProjectsV1', JSON.stringify([{ id: 'existing-wordpress', name: 'WordPress existente', mode: 'wordpress', storageMode: 'browser', initialized: true, createdAt: now, updatedAt: now, wordpressLocale: 'pt_BR' }]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Excluir WordPress existente', exact: true }).click();
  await page.waitForURL('**/project-storage.html?project=existing-wordpress');
  const wordpressDeletion = page.getByRole('dialog', { name: 'Excluir projeto', exact: true });
  await expect(wordpressDeletion).toBeVisible();
  assert.deepEqual(remoteRequests, [], 'navigation opens confirmation without starting deletion');
  await wordpressDeletion.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.waitForURL('**/#projects');
  await page.getByRole('button', { name: 'Abrir WordPress existente', exact: true }).click();
  await page.waitForURL('**/project-storage.html?project=existing-wordpress&action=open');
  await expect(page.getByTitle('WordPress local — WordPress existente', { exact: true })).toBeAttached();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1'))[0]);
  assert.equal(persisted.id, 'existing-wordpress');
  assert.equal(persisted.initialized, true);
  assert.equal(persisted.storageMode, 'browser');
  console.log('Project deletion browser regression passed: HTML/legacy storage preserved, OPFS removal and failure recovery, WordPress confirmation/open routed with original project identity.');
} finally {
  await browser.close();
  await server.close();
}
