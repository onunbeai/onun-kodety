// Real Studio -> HTML Builder -> publishing chooser -> FTP guide -> downloaded
// public archive. Uses isolated OPFS projects and never connects to a host.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import JSZip from 'jszip';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dist = path.join(root, 'WebApp/kodety-studio/dist');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
let activePage;
try {
  for (const language of ['pt', 'en']) {
    const l = (pt, en) => language === 'en' ? en : pt;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: l('pt-BR', 'en-US'), acceptDownloads: true });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(30_000);
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => { externalRequests.push(route.request().url()); return route.abort(); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async language => {
      const id = 'ftp-publishing-fixture';
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(id, { create: true });
      for (const [name, contents] of Object.entries({ 'index.html': '<!doctype html><html><head><title>FTP fixture</title><link rel="stylesheet" href="style.css"></head><body><h1>FTP publishing fixture</h1></body></html>', 'style.css': 'body{font-family:sans-serif}', 'draft.html': '<h1>Editable draft</h1>', 'asset.bin': new Uint8Array([0, 255, 17, 49]), 'assets/fonts/custom.woff2': new Uint8Array([119, 79, 70, 50, 0, 255]), '.incode/project.json': JSON.stringify({ version: 1, name: 'FTP Publishing Fixture', mainHtmlPath: 'index.html', rootPath: '', pageStatuses: { 'draft.html': 'draft' }, siteSettings: { siteTitle: 'WordPress transfer title' } }), '.env': 'PRIVATE-FTP-FIXTURE' })) {
        const parts = name.split('/');
        let parent = directory;
        for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
        const writer = await (await parent.getFileHandle(parts.at(-1), { create: true })).createWritable();
        await writer.write(contents); await writer.close();
      }
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('kodety-studio-html-directories-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('directories');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('directories', 'readwrite');
          tx.objectStore('directories').put(directory, id);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
      const now = Date.now();
      localStorage.setItem('kodetyStudioProjectsV1', JSON.stringify([{ id, name: 'FTP Publishing Fixture', mode: 'html', createdAt: now, updatedAt: now, initialized: true, lastOpenedAt: now, directoryName: directory.name, wordpressLocale: language === 'en' ? 'en_US' : 'pt_BR' }]));
      localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language, onboardingVersion: 2 }));
      localStorage.setItem('kodetyStudioWebOnboarding', '2');
    }, language);
    await page.reload();
    await page.screenshot({ path: `/tmp/kodety-ftp-library-${language}.png`, animations: 'disabled' });
    await page.waitForFunction(() => document.querySelectorAll('button').length > 2);
    if (await page.getByRole('radio', { name: /^HTML/ }).count()) await page.getByRole('radio', { name: /^HTML/ }).check();
    if (await page.getByRole('button', { name: l('Abrir biblioteca', 'Open library'), exact: true }).count()) await page.getByRole('button', { name: l('Abrir biblioteca', 'Open library'), exact: true }).click();
    await page.getByRole('button', { name: l('Abrir FTP Publishing Fixture', 'Open FTP Publishing Fixture'), exact: true }).click();
    await page.frameLocator('.web-html-builder iframe').first().getByRole('heading', { name: 'FTP publishing fixture' }).waitFor();
    await page.locator('[data-publish-trigger]').click();
    await expect(page.getByRole('button', { name: /FTP \/ (outra hospedagem|other hosting)/ })).toBeVisible();
    await page.screenshot({ path: `/tmp/kodety-ftp-chooser-${language}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: /FTP \/ (outra hospedagem|other hosting)/ }).click();
    const dialog = page.getByRole('dialog', { name: l('Publicar HTML', 'Publish HTML'), exact: true });
    const workflows = dialog.getByRole('tablist', { name: l('Forma de publicação', 'Publishing workflow') });
    await expect(workflows.getByRole('tab', { name: /FTP \/ SFTP/ })).toHaveAttribute('aria-selected', 'true');
    await expect(workflows.getByRole('tab')).toHaveCount(5);
    await expect(dialog.locator('ol > li')).toHaveCount(5);
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await expect(dialog.getByText(/public_html, www ou httpdocs|public_html, www, or httpdocs/)).toBeVisible();
    await page.screenshot({ path: `/tmp/kodety-ftp-guide-${language}.png`, animations: 'disabled' });
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: l('Baixar ZIP para FTP', 'Download FTP ZIP'), exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'kodety-site-ftp.zip');
    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    assert.match(await zip.file('index.html').async('string'), /FTP publishing fixture/);
    assert.deepEqual(await zip.file('asset.bin').async('uint8array'), new Uint8Array([0, 255, 17, 49]));
    assert.equal(zip.file('.env'), null);
    assert.equal(zip.file('.incode/project.json'), null);
    await expect(dialog.getByText(l('ZIP preparado. Extraia os arquivos e continue os passos para colocar o site no ar.', 'ZIP prepared. Extract the files and continue the steps to put your site online.'), { exact: true })).toBeVisible();
    await workflows.getByRole('tab', { name: /GitHub/ }).click();
    await expect(dialog.getByRole('heading', { name: l('Conta GitHub', 'GitHub account'), exact: true })).toBeVisible();
    await workflows.getByRole('tab', { name: /FTP \/ SFTP/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const downloadButton = dialog.getByRole('button', { name: l('Baixar ZIP para FTP', 'Download FTP ZIP'), exact: true });
    await downloadButton.scrollIntoViewIfNeeded();
    const bounds = await downloadButton.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.screenshot({ path: `/tmp/kodety-ftp-guide-mobile-${language}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-publish-trigger]').click();
    await page.getByRole('button', { name: /^WordPress / }).click();
    await expect(workflows.getByRole('tab', { name: 'WordPress', exact: true })).toHaveAttribute('aria-selected', 'true');
    const plugin = dialog.getByRole('link', { name: l('Baixar plugin Onun Kodety para WordPress', 'Download Onun Kodety plugin for WordPress') });
    await expect(plugin).toHaveAttribute('href', './assets/kodety.zip');
    await expect(dialog.getByText(/Kodety → Atualizar HTML → Importar projeto → Arquivo ZIP|Kodety → Update HTML → Import project → ZIP file/)).toBeVisible();
    await page.screenshot({ path: `/tmp/kodety-wordpress-publish-${language}.png`, animations: 'disabled' });
    const wordpressDownloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: l('Baixar ZIP para WordPress', 'Download WordPress ZIP'), exact: true }).click();
    const wordpressDownload = await wordpressDownloadPromise;
    assert.equal(wordpressDownload.suggestedFilename(), 'FTP Publishing Fixture-wordpress.zip');
    const wordpressZip = await JSZip.loadAsync(await readFile(await wordpressDownload.path()));
    assert.match(await wordpressZip.file('index.html').async('string'), /FTP publishing fixture/);
    assert.match(await wordpressZip.file('draft.html').async('string'), /Editable draft/);
    assert.deepEqual(await wordpressZip.file('asset.bin').async('uint8array'), new Uint8Array([0, 255, 17, 49]));
    assert.deepEqual(await wordpressZip.file('assets/fonts/custom.woff2').async('uint8array'), new Uint8Array([119, 79, 70, 50, 0, 255]));
    const metadata = JSON.parse(await wordpressZip.file('.incode/project.json').async('string'));
    assert.equal(metadata.pageStatuses['draft.html'], 'draft');
    assert.equal(metadata.siteSettings.siteTitle, 'WordPress transfer title');
    assert.equal(wordpressZip.file('.incode/static-source.json'), null);
    await expect(dialog.getByText(l('ZIP preparado. Continue os passos abaixo para importar o projeto no WordPress.', 'ZIP prepared. Follow the steps below to import the project into WordPress.'), { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await plugin.scrollIntoViewIfNeeded();
    const pluginBounds = await plugin.boundingBox();
    assert.ok(pluginBounds.x >= 0 && pluginBounds.x + pluginBounds.width <= 390);
    await page.screenshot({ path: `/tmp/kodety-wordpress-publish-mobile-${language}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.equal(externalRequests.some(url => /api\.github\.com|api\.vercel\.com|filezilla/.test(url)), false);
    console.log(`${language}: FTP and WordPress publishing, public/editable ZIPs, plugin link, five workflows and mobile layout passed.`);
    await context.close();
  }
} catch (error) {
  console.error(await activePage?.locator('body').innerText().catch(() => ''));
  await activePage?.screenshot({ path: '/tmp/kodety-ftp-browser-failure.png', animations: 'disabled' }).catch(() => undefined);
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
