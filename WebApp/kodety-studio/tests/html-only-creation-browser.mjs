// Production-build regression: new projects are HTML-only while existing
// WordPress records and stored bytes survive library/form interactions.
// Run after studio:web:build: node WebApp/kodety-studio/tests/html-only-creation-browser.mjs
// Uses isolated Chromium storage and OPFS handles; never boots Playground or
// reads a user's profile, folders, projects, or WordPress runtime.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.resolve(process.env.KODETY_STUDIO_DIST || path.join(root, 'WebApp/kodety-studio/dist'));
const types = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__fixture-seed__') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Isolated storage fixture</title>');
      return;
    }
    const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
let activePage;

const legacyProjects = [
  { id: 'wordpress-explicit-legacy', name: 'WordPress existing', mode: 'wordpress', initialized: true, storageMode: 'browser', manualBackupAcknowledgedAt: 1720000000000, createdAt: 1720000000000, updatedAt: 1720000000100, lastOpenedAt: 1720000000050, wordpressLocale: 'pt_BR', phpVersion: '8.3', wordpressVersion: '6.8', kodetyVersion: '1.0.0', runtimeRevision: 7, favorite: true },
  { id: 'wordpress-missing-mode', name: 'WordPress older catalog', initialized: true, createdAt: 1710000000000, updatedAt: 1710000000100, lastOpenedAt: 1710000000050, wordpressLocale: 'en_US', phpVersion: '8.2', wordpressVersion: '6.7', kodetyVersion: '0.9.0', runtimeRevision: 3 },
];

// These origin-local sentinel files prove the library/new-project path does
// not perform storage cleanup. Real cross-origin Playground mounting is out
// of scope; neither legacy project is opened or booted by this test.
const readLegacyFiles = page => page.evaluate(async ids => {
  let parent = await navigator.storage.getDirectory();
  for (const name of ['kodety-studio', 'projects']) parent = await parent.getDirectoryHandle(name);
  const result = {};
  for (const id of ids) {
    const directory = await parent.getDirectoryHandle(id);
    result[id] = {};
    for (const name of ['wp-config.php', 'wp-load.php', 'database.sqlite']) {
      const file = await (await directory.getFileHandle(name)).getFile();
      result[id][name] = Array.from(new Uint8Array(await file.arrayBuffer()));
    }
  }
  return result;
}, legacyProjects.map(project => project.id));

try {
  for (const language of ['pt', 'en']) {
    for (const storageMode of ['folder', 'browser']) {
      const l = (pt, en) => language === 'pt' ? pt : en;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(storageMode => {
        if (window.top !== window) return;
        Object.defineProperty(window, 'showDirectoryPicker', {
          configurable: true,
          value: storageMode === 'folder'
            ? async () => (await navigator.storage.getDirectory()).getDirectoryHandle('new-html-source', { create: true })
            : undefined,
        });
      }, storageMode);
      const page = activePage = await context.newPage();
      page.setDefaultTimeout(30_000);
      const errors = [];
      const wordpressRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.hostname === 'playground.wordpress.net' || /\/project-storage(?:\.html)?$/.test(url.pathname)) wordpressRequests.push(url.href);
      });
      await context.route('https://**/*', route => route.abort());
      await page.goto(`${base}/__fixture-seed__`);
      const originalCatalog = JSON.stringify(legacyProjects, null, 2);
      await page.evaluate(async ({ language, catalog, ids }) => {
        localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language, onboardingVersion: 2 }));
        localStorage.setItem('kodetyStudioWebOnboarding', '2');
        localStorage.setItem('kodetyStudioWebLastMode', 'wordpress');
        localStorage.setItem('kodetyStudioProjectsV1', catalog);
        let parent = await navigator.storage.getDirectory();
        for (const name of ['kodety-studio', 'projects']) parent = await parent.getDirectoryHandle(name, { create: true });
        for (const id of ids) {
          const directory = await parent.getDirectoryHandle(id, { create: true });
          for (const [name, bytes] of Object.entries({
            'wp-config.php': new TextEncoder().encode(`<?php /* preserved config ${id} */`),
            'wp-load.php': new TextEncoder().encode(`<?php /* preserved loader ${id} */`),
            'database.sqlite': new Uint8Array([83, 81, 76, 105, 116, 101, 0, 1, 255, id.length]),
          })) {
            const file = await directory.getFileHandle(name, { create: true });
            const stream = await file.createWritable();
            await stream.write(bytes);
            await stream.close();
          }
        }
      }, { language, catalog: originalCatalog, ids: legacyProjects.map(project => project.id) });
      const originalFiles = await readLegacyFiles(page);
      await page.goto(`${base}/#projects`);
      const assertLibrary = async () => {
        for (const project of legacyProjects) {
          const open = page.getByRole('button', { name: l('Abrir ', 'Open ') + project.name, exact: true });
          await expect(open).toBeVisible();
          await expect(open.locator('.web-project-mode')).toHaveText('WordPress');
        }
      };
      const assertUntouchedCatalog = async () => {
        assert.equal(await page.evaluate(() => localStorage.getItem('kodetyStudioProjectsV1')), originalCatalog, 'Reading the library and cancelling forms must preserve the exact stored catalog');
        assert.deepEqual(await readLegacyFiles(page), originalFiles, 'Legacy stored bytes must remain unchanged');
      };
      const openCreate = async () => {
        await page.getByRole('button', { name: l('Novo projeto', 'New project'), exact: true }).first().click();
        const form = page.getByRole('dialog', { name: l('Criar novo projeto', 'Create a new project'), exact: true });
        await expect(form).toBeVisible();
        await expect(form.getByRole('radio')).toHaveCount(0);
        await expect(form.getByText('WordPress', { exact: true })).toHaveCount(0);
        await expect(form).toContainText(l('Crie em HTML', 'Create in HTML'));
        return form;
      };
      await assertLibrary();
      await assertUntouchedCatalog();
      const cancelled = await openCreate();
      await cancelled.locator('#web-project-name').fill('Cancelled project');
      await cancelled.getByRole('button', { name: l('Cancelar', 'Cancel'), exact: true }).click();
      await expect(cancelled).toHaveCount(0);
      await assertLibrary();
      await assertUntouchedCatalog();
      // Existing WordPress management remains available; inspecting/cancelling
      // a rename must not silently convert or migrate its catalog record.
      await page.getByRole('button', { name: l('Renomear ', 'Rename ') + legacyProjects[1].name, exact: true }).click();
      const rename = page.getByRole('dialog', { name: l('Renomear projeto', 'Rename project'), exact: true });
      await expect(rename.locator('#web-project-name')).toHaveValue(legacyProjects[1].name);
      await rename.getByRole('button', { name: l('Cancelar', 'Cancel'), exact: true }).click();
      await assertUntouchedCatalog();
      await page.screenshot({ path: `/tmp/kodety-html-only-library-${language}-${storageMode}.png`, animations: 'disabled' });

      const projectName = `HTML only ${language} ${storageMode}`;
      const form = await openCreate();
      await form.locator('#web-project-name').fill(projectName);
      const create = form.getByRole('button', { name: storageMode === 'folder' ? l('Criar e abrir projeto', 'Create and open project') : l('Confirmar e criar projeto', 'Confirm and create project'), exact: true });
      await expect(create).toBeDisabled();
      if (storageMode === 'folder') await form.getByRole('button', { name: l('Escolher uma pasta', 'Choose a folder'), exact: false }).click();
      else await form.getByRole('checkbox').check();
      await expect(create).toBeEnabled();
      await assertUntouchedCatalog();
      await page.screenshot({ path: `/tmp/kodety-html-only-create-${language}-${storageMode}.png`, animations: 'disabled' });
      await create.click();
      await page.locator('.web-html-builder iframe').first().waitFor({ state: 'attached' });
      const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')));
      assert.equal(projects.length, legacyProjects.length + 1);
      const created = projects.find(project => project.name === projectName);
      assert.ok(created, 'UI creation must persist the new project');
      assert.equal(created.mode, 'html', 'A stale WordPress preference must never create WordPress');
      assert.equal(created.storageMode, storageMode);
      for (const original of legacyProjects) {
        const preserved = projects.find(project => project.id === original.id);
        assert.ok(preserved, `Legacy project ${original.id} remains in the catalog`);
        for (const [key, value] of Object.entries(original)) assert.deepEqual(preserved[key], value, `${original.id}.${key} is preserved`);
        assert.equal(preserved.mode, 'wordpress', 'Missing historical mode still resolves as WordPress');
      }
      assert.deepEqual(await readLegacyFiles(page), originalFiles);
      const storedHtml = await page.evaluate(async ({ id, storageMode }) => {
        let directory = await navigator.storage.getDirectory();
        if (storageMode === 'folder') directory = await directory.getDirectoryHandle('new-html-source');
        else {
          directory = await directory.getDirectoryHandle('kodety-studio-html-projects-v1');
          directory = await directory.getDirectoryHandle(id);
        }
        return await (await (await directory.getFileHandle('index.html')).getFile()).text();
      }, { id: created.id, storageMode });
      assert.match(storedHtml, /<html\b/i, 'New HTML source must be persisted in the selected storage');
      assert.deepEqual(wordpressRequests, [], 'HTML creation and legacy listing must not boot or navigate to WordPress');
      assert.deepEqual(errors, []);
      console.log(`${language}/${storageMode}: HTML-only creation, ignored WordPress preference, legacy listing, exact catalog preservation on cancel, and preserved stored files passed.`);
      await context.close();
    }
  }
} catch (error) {
  console.error(await activePage?.locator('body').innerText().catch(() => ''));
  await activePage?.screenshot({ path: '/tmp/kodety-html-only-creation-failure.png', animations: 'disabled' }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
