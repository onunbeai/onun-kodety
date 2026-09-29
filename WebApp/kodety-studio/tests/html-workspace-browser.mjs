// Opt-in isolated Chromium integration using the current production build.
// Run after studio:web:build: node WebApp/kodety-studio/tests/html-workspace-browser.mjs
// OPFS supplies an actual browser FileSystemDirectoryHandle without opening or
// changing any user directory or persistent browser profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = path.join(root, 'WebApp/kodety-studio/dist');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(dist, `.${requested === '/' ? '/index.html' : requested}`);
    if (!file.startsWith(`${dist}/`)) { response.statusCode = 403; response.end(); return; }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end(); }
});
let sourceServer;
if (process.env.KODETY_HTML_BROWSER_SOURCE === '1') {
  const { createServer: createViteServer } = await import('vite');
  sourceServer = await createViteServer({ configFile: path.join(root, 'WebApp/kodety-studio/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await sourceServer.listen();
} else await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
const failed = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  const base = sourceServer?.resolvedUrls?.local[0] || `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  const font = Array.from(await readFile(path.join(root, 'lib/html-editor/fonts/geist/Geist-Regular.ttf')));
  const seeded = await page.evaluate(async font => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('html-browser-fixture', { create: true });
    const write = async (name, contents) => {
      const handle = await directory.getFileHandle(name, { create: true });
      const stream = await handle.createWritable(); await stream.write(contents); await stream.close();
    };
    await write('index.html', '<!doctype html><html lang="pt-BR"><head><title>Fixture</title><link rel="stylesheet" href="styles.css"></head><body><main id="html-workspace-proof"><h1 id="fixture-heading">Arquivo local</h1><p>HTML, CSS e fonte da pasta</p></main></body></html>');
    await write('styles.css', '@font-face{font-family:"Fixture";src:url("fixture.ttf") format("truetype");font-weight:400;font-style:normal}body{margin:0;background:#f3f4f6}#html-workspace-proof{padding:32px}#fixture-heading{font-family:"Fixture",serif;font-size:48px;font-weight:400;color:rgb(17,93,143)}');
    await write('fixture.ttf', new Uint8Array(font));
    const id = 'html-browser-fixture';
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('kodety-studio-html-directories-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('directories');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('directories', 'readwrite'); tx.objectStore('directories').put(directory, id);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
    const now = Date.now();
    localStorage.setItem('kodetyStudioProjectsV1', JSON.stringify([{ id, name: 'HTML Browser Fixture', mode: 'html', createdAt: now, updatedAt: now, initialized: true, lastOpenedAt: now, directoryName: directory.name, wordpressLocale: 'pt_BR' }]));
    localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language: 'pt', onboardingVersion: 2 }));
    localStorage.setItem('kodetyStudioWebOnboarding', '2');
    return { kind: directory.kind, type: directory.constructor.name, permission: await directory.queryPermission({ mode: 'readwrite' }) };
  }, font);
  assert.deepEqual(seeded, { kind: 'directory', type: 'FileSystemDirectoryHandle', permission: 'granted' });
  await page.reload();
  await page.getByRole('radio', { name: /^HTML/ }).check();
  await page.getByRole('button', { name: 'Abrir biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir HTML Browser Fixture', exact: true }).click();
  await page.locator('.web-html-builder iframe').first().waitFor({ state: 'attached' });
  console.log('Actual OPFS handle opened; shared Builder iframe mounted.');
  let frame;
  await page.frameLocator('.web-html-builder iframe').first().locator('#fixture-heading').waitFor();
  for (const candidate of page.frames()) if (await candidate.locator('#fixture-heading').count()) { frame = candidate; break; }
  assert.ok(frame, 'The shared Builder renders the real project HTML canvas');
  const style = await frame.locator('#fixture-heading').evaluate(async heading => {
    await document.fonts.ready;
    const computed = getComputedStyle(heading);
    return { color: computed.color, font: computed.fontFamily, size: computed.fontSize, fixtureFontLoaded: [...document.fonts].some(face => face.family.replaceAll('"', '') === 'Fixture' && face.status === 'loaded') };
  });
  assert.equal(style.color, 'rgb(17, 93, 143)');
  assert.equal(style.size, '48px');
  assert.match(style.font, /Fixture/);
  assert.equal(style.fixtureFontLoaded, true);
  console.log('Project HTML, CSS and local binary font verified in the canvas.');
  const editor = await page.evaluate(async () => {
    await document.fonts.ready;
    const root = document.querySelector('#kodety-root');
    const heading = document.querySelector('#kodety-root main');
    const toolbar = document.querySelector('.kodety-editor-topbar');
    return { bodyClass: document.body.classList.contains('kodety-wordpress-editor'), dark: document.documentElement.classList.contains('dark'), font: getComputedStyle(heading).fontFamily, interLoaded: [...document.fonts].some(face => face.family.includes('Kodety Inter') && face.status === 'loaded'), rootHeight: root.getBoundingClientRect().height, toolbarDisplay: getComputedStyle(toolbar).display, duplicateToolbar: Boolean(document.querySelector('.web-html-toolbar')), nativePublishCount: document.querySelectorAll('[data-publish-trigger]').length, shellAncestor: Boolean(root.closest('.web-app')), rootFontSize: getComputedStyle(document.documentElement).fontSize, buttons: root.querySelectorAll('button').length, alert: document.querySelector('.web-html-error')?.textContent || '' };
  });
  assert.equal(editor.bodyClass, true); assert.equal(editor.dark, true);
  assert.match(editor.font, /Kodety Inter/); assert.equal(editor.interLoaded, true);
  assert.ok(editor.rootHeight > 400); assert.equal(editor.toolbarDisplay, 'flex'); assert.ok(editor.buttons > 20);
  assert.equal(editor.alert, '');
  assert.equal(editor.duplicateToolbar, false); assert.equal(editor.nativePublishCount, 1);
  assert.equal(editor.shellAncestor, false); assert.equal(editor.rootFontSize, '16px');
  assert.equal(await page.getByRole('link', { name: 'Languages', exact: true }).count(), 0);
  await page.screenshot({ path: '/tmp/kodety-html-workspace-browser.png', fullPage: true });
  await frame.locator('#fixture-heading').dblclick();
  await frame.locator('#fixture-heading').fill('Edição salva direto no HTML');
  await frame.locator('#fixture-heading').press('Enter');
  await page.waitForFunction(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('html-browser-fixture');
    const file = await (await directory.getFileHandle('index.html')).getFile();
    return (await file.text()).includes('Edição salva direto no HTML');
  });
  console.log('Canvas text edit autosaved directly to the real index.html file.');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('[data-kodety-project-settings]').waitFor();
  await page.getByPlaceholder('HTML Browser Fixture', { exact: true }).fill('Alteração persistida no HTML');
  await page.getByRole('button', { name: 'Salvar configurações', exact: true }).click();
  await page.waitForFunction(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const project = await root.getDirectoryHandle('html-browser-fixture');
      const metadata = await (await (await project.getDirectoryHandle('.incode')).getFileHandle('project.json')).getFile();
      return JSON.parse(await metadata.text()).siteSettings?.siteTitle === 'Alteração persistida no HTML';
    } catch { return false; }
  });
  console.log('Shared Settings saved site metadata through the actual directory handle.');
  await page.screenshot({ path: '/tmp/kodety-html-workspace-settings-browser.png', fullPage: true });
  await page.getByRole('link', { name: 'Design', exact: true }).click();
  await page.locator('[data-editor-corner-menu-trigger]').click();
  await page.getByRole('menuitem', { name: 'Extensões', exact: true }).click();
  const extensionDialog = page.getByRole('dialog', { name: 'Extensões', exact: true });
  await extensionDialog.locator('input[type="file"]').setInputFiles(path.join(root, 'Wordpress/dist/extensions/kodety-localization.zip'));
  await extensionDialog.getByRole('button', { name: 'Instalar ZIP', exact: true }).click();
  await extensionDialog.getByRole('button', { name: 'Ativar', exact: true }).click();
  await extensionDialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('link', { name: 'Languages', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar idioma', exact: true }).first().waitFor();
  await page.screenshot({ path: '/tmp/kodety-html-workspace-locales-browser.png', fullPage: true });
  assert.deepEqual(errors, [], `Unexpected browser exceptions: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ result: 'PASS', seeded, style, editor, failedRequests: failed }, null, 2));
} catch (error) {
  await page.screenshot({ path: '/tmp/kodety-html-workspace-failure.png', fullPage: true }).catch(() => undefined);
  console.error(JSON.stringify({ errors, failed, body: (await page.locator('body').innerText().catch(() => '')).slice(0, 8000), frames: page.frames().map(frame => frame.url()) }, null, 2));
  throw error;
} finally {
  await browser.close();
  if (sourceServer) await sourceServer.close();
  else await new Promise(resolve => server.close(resolve));
}
