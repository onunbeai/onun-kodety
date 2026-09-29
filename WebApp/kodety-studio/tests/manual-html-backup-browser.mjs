// Production build integration with real OPFS, UI consent, canvas edits and ZIP downloads.
// BROWSER=webkit node WebApp/kodety-studio/tests/manual-html-backup-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, expect } from '@playwright/test';
import JSZip from 'jszip';

const engine = process.env.BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.join(root, 'WebApp/kodety-studio/dist');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${dist}/`)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
// WebKit ephemeral contexts refuse OPFS at getDirectory(); a fresh persistent
// temporary profile models a normal Safari window without using user data.
const profile = await mkdtemp(path.join(tmpdir(), 'kodety-manual-backup-profile-'));
const context = await ({ chromium, webkit })[engine].launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.addInitScript(() => {
  if (window.top !== window) return;
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
  localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language: 'pt', onboardingVersion: 2 }));
  localStorage.setItem('kodetyStudioWebOnboarding', '2');
});
const page = await context.newPage();
page.setDefaultTimeout(45_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let nativeCloseAction = 'accept';
const nativeCloseDialogs = [];
page.on('dialog', async dialog => {
  if (dialog.type() === 'beforeunload') {
    nativeCloseDialogs.push(dialog.type());
    if (nativeCloseAction === 'dismiss') { await dialog.dismiss(); return; }
  }
  await dialog.accept();
});
const base = `http://127.0.0.1:${server.address().port}`;
const blocksTabClose = () => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});
const openExit = async () => {
  await page.locator('[data-editor-corner-menu-trigger]').click();
  await page.getByRole('menuitem', { name: 'Voltar ao painel', exact: true }).click();
  return page.getByRole('dialog', { name: 'Baixar um backup antes de sair?', exact: true });
};
const readStored = async (projectId, filename) => page.evaluate(async ({ projectId, filename }) => {
  let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('kodety-studio-html-projects-v1');
  directory = await directory.getDirectoryHandle(projectId);
  const segments = filename.split('/');
  for (const name of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(name);
  return await (await (await directory.getFileHandle(segments.at(-1))).getFile()).text();
}, { projectId, filename });
try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).first().click();
  const form = page.getByRole('dialog', { name: 'Criar novo projeto', exact: true });
  await form.locator('#web-project-name').fill('Backup sem pasta');
  const confirm = form.getByRole('button', { name: 'Confirmar e criar projeto', exact: true });
  await expect(confirm).toBeDisabled();
  await expect(form.getByText('Backup por ZIP', { exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Escolher uma pasta', exact: true })).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1') || '[]')), []);
  await form.getByRole('checkbox').check();
  // Consent resets when switching modes and is never preselected.
  await form.getByText('WordPress', { exact: true }).click();
  await expect(form.getByRole('radio', { name: /^WordPress/ })).toBeChecked();
  await expect(confirm).toBeDisabled();
  await form.getByText('HTML', { exact: true }).click();
  await expect(form.getByRole('radio', { name: /^HTML/ })).toBeChecked();
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await form.getByRole('checkbox').check();
  console.log(`${engine}: consent required and mode selection verified`);
  await page.screenshot({ path: `/tmp/kodety-manual-backup-consent-${engine}.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  const mobileDialog = await form.boundingBox();
  assert.ok(mobileDialog.x >= 0 && mobileDialog.x + mobileDialog.width <= 390, 'Consent dialog fits a narrow screen');
  await page.screenshot({ path: `/tmp/kodety-manual-backup-consent-mobile-${engine}.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await confirm.click();
  await page.locator('.web-html-builder iframe').first().waitFor({ state: 'attached' });
  await expect(page.getByRole('button', { name: 'Baixar backup ZIP', exact: true })).toBeVisible();
  assert.ok(await page.locator('.web-html-builder').evaluate(element => element.getBoundingClientRect().height) >= 990, 'The shared Builder uses the full workspace without a backup banner');
  await expect(page.locator('.web-html-browser-storage,.web-html-publication,.web-html-error')).toHaveCount(0);
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1'))[0]);
  assert.equal(project.mode, 'html');
  assert.equal(project.storageMode, 'browser');
  assert.ok(project.manualBackupAcknowledgedAt > 0);
  assert.equal(project.directoryName, undefined);
  assert.match(await readStored(project.id, 'index.html'), /<html/i);
  console.log(`${engine}: project created in real OPFS`);
  // Fixture files are written into the storage actually created by the UI. Reopening
  // must resolve the persisted marker, not rely on a retained in-memory handle.
  await page.evaluate(async projectId => {
    const directory = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('kodety-studio-html-projects-v1')).getDirectoryHandle(projectId);
    const write = async (name, text) => {
      const file = await directory.getFileHandle(name, { create: true });
      const stream = await file.createWritable(); await stream.write(text); await stream.close();
    };
    await write('index.html', '<!doctype html><html lang="pt-BR"><head><title>Backup</title><style>body{margin:0;background:#f3f4f6}main{padding:32px}h1{font-family:Arial,sans-serif;font-size:48px;color:#115d8f}</style></head><body><main><h1 id="backup-heading">Projeto persistido no navegador</h1></main></body></html>');
    await write('backup-proof.txt', 'Arquivo preservado no ZIP manual.');
  }, project.id);
  await page.reload();
  await page.getByRole('button', { name: 'Abrir Backup sem pasta', exact: true }).click();
  const canvas = page.frameLocator('.web-html-builder iframe').first();
  await expect(canvas.locator('#backup-heading')).toHaveText('Projeto persistido no navegador');
  console.log(`${engine}: persisted project reopened`);
  await canvas.locator('#backup-heading').dblclick();
  await canvas.locator('#backup-heading').fill('Edição protegida pelo backup ZIP');
  await canvas.locator('#backup-heading').press('Enter');
  await expect.poll(() => readStored(project.id, 'index.html')).toContain('Edição protegida pelo backup ZIP');
  console.log(`${engine}: canvas edit saved`);
  assert.equal(await blocksTabClose(), true, 'Autosave in the browser must not clear the ZIP reminder');
  nativeCloseAction = 'dismiss';
  const beforeClose = nativeCloseDialogs.length;
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => nativeCloseDialogs.length).toBe(beforeClose + 1);
  assert.equal(page.isClosed(), false, 'Cancelling the native close keeps the work open');
  nativeCloseAction = 'accept';
  const exit = await openExit();
  await expect(exit.getByRole('button', { name: 'Baixar ZIP e sair', exact: true })).toBeVisible();
  await expect(exit.getByRole('button', { name: 'Sair sem baixar', exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/kodety-manual-backup-exit-${engine}.png`, fullPage: true });
  await exit.getByRole('button', { name: 'Continuar editando', exact: true }).last().click();
  await expect(exit).toHaveCount(0);
  assert.equal(await blocksTabClose(), true);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar backup ZIP', exact: true }).click();
  const download = await downloading;
  assert.equal(await download.failure(), null);
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  assert.equal(await zip.file('backup-proof.txt').async('string'), 'Arquivo preservado no ZIP manual.');
  assert.match(await zip.file('index.html').async('string'), /Edição protegida pelo backup ZIP/);
  assert.ok(zip.file('.incode/static-source.json'), 'Editable source manifest is included');
  await expect.poll(blocksTabClose).toBe(false);
  const backupToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Backup ZIP gerado' });
  await expect(backupToast).toBeVisible();
  await expect.poll(() => backupToast.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await expect.poll(() => backupToast.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(924.5);
  assert.equal(await backupToast.evaluate(element => getComputedStyle(element).borderRadius), '12px');
  await page.screenshot({ path: `/tmp/kodety-backup-toast-${engine}.png`, fullPage: true });
  console.log(`${engine}: editable backup ZIP downloaded`);
  await page.locator('[data-publish-trigger]').click();
  await expect(page.getByRole('button', { name: /Publicar na pasta/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `/tmp/kodety-manual-backup-workspace-${engine}.png`, fullPage: true });
  // Settings drafts invalidate the ZIP before their autosave reaches project files.
  await page.locator('[data-kodety-onboarding="design-settings"]').click();
  await page.locator('[data-kodety-project-settings]').waitFor();
  console.log(`${engine}: Settings opened`);
  const titleInput = page.getByPlaceholder('Backup sem pasta', { exact: true });
  await titleInput.fill('Título do backup em Settings');
  await expect.poll(blocksTabClose).toBe(true);
  const settingsDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar backup ZIP', exact: true }).click();
  const settingsDownload = await settingsDownloadEvent;
  const settingsZip = await JSZip.loadAsync(await readFile(await settingsDownload.path()));
  assert.match(await settingsZip.file('.incode/project.json').async('string'), /Título do backup em Settings/);
  await expect.poll(blocksTabClose).toBe(false);
  assert.equal(await titleInput.evaluate(element => !!element.closest('[inert]')), false, 'Settings remains editable after a backup');
  console.log(`${engine}: Settings draft included in ZIP and still editable`);
  await titleInput.fill('Título incluído no backup de saída');
  await expect.poll(blocksTabClose).toBe(true);
  // Leave directly from Settings so the exit action must flush its newest draft.
  const exitWithDraft = await openExit();
  const finalDownloadEvent = page.waitForEvent('download');
  await exitWithDraft.getByRole('button', { name: 'Baixar ZIP e sair', exact: true }).click();
  const finalDownload = await finalDownloadEvent;
  const exitZip = await JSZip.loadAsync(await readFile(await finalDownload.path()));
  assert.match(await exitZip.file('.incode/project.json').async('string'), /Título incluído no backup de saída/);
  await expect(page.getByRole('button', { name: 'Abrir Backup sem pasta', exact: true })).toBeVisible();
  assert.equal(await blocksTabClose(), false, 'Leaving removes the project unload guard');
  console.log(`${engine}: ZIP and exit completed with the latest Settings draft`);
  await page.getByRole('button', { name: 'Abrir Backup sem pasta', exact: true }).click();
  await expect(page.frameLocator('.web-html-builder iframe').first().locator('#backup-heading')).toHaveText('Edição protegida pelo backup ZIP');
  await page.reload();
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).first().click();
  const restoreForm = page.getByRole('dialog', { name: 'Criar novo projeto', exact: true });
  await restoreForm.locator('#web-project-name').fill('Restaurado do ZIP');
  await restoreForm.getByRole('checkbox').check();
  await restoreForm.getByRole('button', { name: 'Confirmar e criar projeto', exact: true }).click();
  await page.locator('.web-html-builder iframe').first().waitFor({ state: 'attached' });
  await page.getByLabel('Importar outro projeto ZIP', { exact: true }).setInputFiles(await download.path());
  await expect(page.frameLocator('.web-html-builder iframe').first().locator('#backup-heading')).toHaveText('Edição protegida pelo backup ZIP');
  const restoredId = await page.evaluate(() => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')).find(project => project.name === 'Restaurado do ZIP').id);
  await expect.poll(() => readStored(restoredId, 'backup-proof.txt').catch(() => ''), { timeout: 15_000 }).toBe('Arquivo preservado no ZIP manual.');
  await page.reload();
  await page.getByRole('button', { name: 'Abrir Restaurado do ZIP', exact: true }).click();
  await expect(page.frameLocator('.web-html-builder iframe').first().locator('#backup-heading')).toHaveText('Edição protegida pelo backup ZIP');
  // Losing internal files must show recovery instructions, never recreate an
  // empty project under the old library record.
  await page.evaluate(async projectId => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('kodety-studio-html-projects-v1');
    await directory.removeEntry(projectId, { recursive: true });
  }, project.id);
  await page.reload();
  await page.getByRole('button', { name: 'Abrir Backup sem pasta', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Os arquivos deste projeto não foram encontrados' })).toBeVisible();
  assert.equal(await page.evaluate(async projectId => {
    try {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('kodety-studio-html-projects-v1');
      await directory.getDirectoryHandle(projectId, { create: false });
      return true;
    } catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
  }, project.id), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', engine, projectId: project.id, checks: [
    'explicit consent', 'both mode choices', 'real OPFS creation', 'reload marker',
    'canvas edit autosave', 'native tab close warning and cancel', 'exit dialog and continue',
    'editable ZIP clears reminder', 'Settings draft re-arms reminder',
    'Settings backup includes latest draft and releases input', 'ZIP and exit directly from Settings',
    'no inaccessible folder publication', 'saved edit reopens',
    'ZIP restored through shared Builder and reopened', 'missing files show recovery without empty replacement',
  ], zipFiles: Object.keys(zip.files).length }, null, 2));
} catch (error) {
  await page.screenshot({ path: `/tmp/kodety-manual-backup-failure-${engine}.png`, fullPage: true }).catch(() => undefined);
  console.error(JSON.stringify({ engine, errors, body: (await page.locator('body').innerText().catch(() => '')).slice(0, 7000) }, null, 2));
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  await new Promise(resolve => server.close(resolve));
}
