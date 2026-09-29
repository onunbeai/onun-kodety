// Real Studio -> HTML Builder -> default Cloudflare Pages publishing -> direct
// deploy and manual ZIP. Uses an isolated OPFS project and mocked server transport;
// no user directory, browser profile, Cloudflare account, or real host is touched.
// Run after studio:web:build: node WebApp/kodety-studio/tests/html-cloudflare-deployment-browser.mjs
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
const fixtureId = 'cloudflare-publishing-fixture';
const token = 'private-cloudflare-browser-fixture-token';
const accountId = '0123456789abcdef0123456789abcdef';
const binary = new Uint8Array([0, 255, 17, 49, 128]);
const uploadToken = 'private-cloudflare-fixture-upload-token';
const deploymentId = '01234567-89ab-cdef-0123-456789abcdef';
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
    const errors = [], externalRequests = [], transportCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => { externalRequests.push(route.request().url()); return route.abort(); });
    // Cloudflare API calls originate from the server. Intercept only the browser's
    // fixed, same-origin deployment endpoint so the full frontend still runs.
    await page.route('**/__kodety_deploy__/cloudflare/request', async route => {
      const request = route.request();
      const envelope = request.postDataJSON();
      transportCalls.push({ ...envelope, headers: request.headers() });
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers()['x-kodety-deploy'], '1');
      assert.equal(request.headers().authorization, `Bearer ${envelope.route.startsWith('/pages/assets/') ? uploadToken : token}`);
      const projectRoute = `/accounts/${accountId}/pages/projects`;
      const project = name => ({ id: `project-${name}`, name, subdomain: `${name}.pages.dev`, production_branch: 'main' });
      const deployment = status => ({ id: deploymentId, url: 'https://preview.fixture-site.pages.dev', environment: 'production', latest_stage: { name: 'deploy', status }, stages: [{ name: 'deploy', status }] });
      let result, result_info;
      if (envelope.method === 'GET' && envelope.route.startsWith(projectRoute + '?')) {
        result = [project('fixture-site'), project('other-site')];
        result_info = { page: 1, per_page: 100, total_count: 2, total_pages: 1 };
      } else if (envelope.method === 'POST' && envelope.route === projectRoute) {
        result = { ...project(envelope.body.name), production_branch: envelope.body.production_branch };
      } else if (envelope.method === 'GET' && envelope.route === `${projectRoute}/fixture-site/upload-token`) {
        result = { jwt: uploadToken };
      } else if (envelope.method === 'POST' && envelope.route === '/pages/assets/check-missing') {
        result = envelope.body.hashes;
      } else if (envelope.method === 'POST' && ['/pages/assets/upload', '/pages/assets/upsert-hashes'].includes(envelope.route)) {
        result = null;
      } else if (envelope.method === 'POST' && envelope.route === `${projectRoute}/fixture-site/deployments`) {
        result = deployment('active');
      } else if (envelope.method === 'GET' && envelope.route === `${projectRoute}/fixture-site/deployments/${deploymentId}`) {
        result = deployment('success');
      } else {
        throw new Error(`Unexpected fixture transport request: ${envelope.method} ${envelope.route}`);
      }
      await route.fulfill({ status: 200, json: { success: true, result, ...(result_info ? { result_info } : {}) } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async ({ language, fixtureId, binary }) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixtureId, { create: true });
      for (const [name, contents] of Object.entries({
        'index.html': '<!doctype html><html><head><title>Cloudflare fixture</title><link rel="stylesheet" href="style.css"></head><body><h1>Cloudflare publishing fixture</h1></body></html>',
        'style.css': 'body{font-family:sans-serif}',
        'asset.bin': new Uint8Array(binary),
        '.env': 'PRIVATE-CLOUDFLARE-FIXTURE',
      })) {
        const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
        await writer.write(contents); await writer.close();
      }
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('kodety-studio-html-directories-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('directories');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('directories', 'readwrite');
          tx.objectStore('directories').put(directory, fixtureId);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
      const now = Date.now();
      localStorage.setItem('kodetyStudioProjectsV1', JSON.stringify([{ id: fixtureId, name: 'Cloudflare Publishing Fixture', mode: 'html', createdAt: now, updatedAt: now, initialized: true, lastOpenedAt: now, directoryName: directory.name, wordpressLocale: language === 'en' ? 'en_US' : 'pt_BR' }]));
      localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language, onboardingVersion: 2 }));
      localStorage.setItem('kodetyStudioWebOnboarding', '2');
    }, { language, fixtureId, binary: [...binary] });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('button').length > 2);
    if (await page.getByRole('radio', { name: /^HTML/ }).count()) await page.getByRole('radio', { name: /^HTML/ }).check();
    if (await page.getByRole('button', { name: l('Abrir biblioteca', 'Open library'), exact: true }).count()) await page.getByRole('button', { name: l('Abrir biblioteca', 'Open library'), exact: true }).click();
    await page.getByRole('button', { name: l('Abrir Cloudflare Publishing Fixture', 'Open Cloudflare Publishing Fixture'), exact: true }).click();
    await page.frameLocator('.web-html-builder iframe').first().getByRole('heading', { name: 'Cloudflare publishing fixture' }).waitFor();
    const openPublisher = async () => {
      await page.locator('[data-publish-trigger]').click();
      await page.getByRole('button', { name: new RegExp(l('^Publicar online', '^Publish online')) }).click();
    };
    await openPublisher();
    const dialog = page.getByRole('dialog', { name: l('Publicar HTML', 'Publish HTML'), exact: true });
    const workflows = dialog.getByRole('tablist', { name: l('Forma de publicação', 'Publishing workflow') });
    await expect(workflows.getByRole('tab', { name: /Cloudflare/ })).toHaveAttribute('aria-selected', 'true');
    await expect(workflows.getByRole('tab')).toHaveCount(5);
    const directMode = dialog.getByRole('tab', { name: l('Publicar direto', 'Direct deployment'), exact: true });
    const zipMode = dialog.getByRole('tab', { name: l('Enviar ZIP manualmente', 'Upload ZIP manually'), exact: true });
    await expect(directMode).toHaveAttribute('aria-selected', 'true');
    await expect(zipMode).toHaveAttribute('aria-selected', 'false');
    await expect(workflows.locator('svg')).toHaveCount(5);
    await workflows.getByRole('tab', { name: /Cloudflare/ }).focus();
    await page.keyboard.press('End');
    await expect(workflows.getByRole('tab', { name: 'WordPress', exact: true })).toBeFocused();
    await expect(dialog.getByRole('tabpanel', { name: 'WordPress', exact: true })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(workflows.getByRole('tab', { name: /Cloudflare/ })).toBeFocused();
    await expect(dialog.getByRole('tabpanel', { name: 'Cloudflare Pages', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(workflows.getByRole('tab', { name: 'GitHub', exact: true })).toBeFocused();
    await expect(dialog.getByRole('heading', { name: l('Conta GitHub', 'GitHub account'), exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await directMode.focus();
    await page.keyboard.press('ArrowRight');
    await expect(zipMode).toBeFocused();
    await expect(dialog.getByRole('tabpanel', { name: l('Enviar ZIP manualmente', 'Upload ZIP manually'), exact: true })).toBeVisible();
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await page.keyboard.press('Home');
    await expect(directMode).toBeFocused();
    assert.equal(await directMode.evaluate(tab => getComputedStyle(tab).outlineColor), 'rgb(182, 182, 182)', 'Keyboard focus is visible and neutral');
    assert.equal(transportCalls.length, 0, 'Navigating tabs never publishes or loads a provider account');
    const selectedStyle = await workflows.getByRole('tab', { selected: true }).evaluate(tab => ({ background: getComputedStyle(tab).backgroundColor, border: getComputedStyle(tab).borderWidth }));
    assert.deepEqual(selectedStyle, { background: 'rgb(43, 43, 43)', border: '0px' });
    await dialog.getByRole('heading', { name: l('Publicar HTML', 'Publish HTML'), exact: true }).click();
    await page.screenshot({ path: `/tmp/kodety-publication-tabs-desktop-${language}.png`, animations: 'disabled' });
    const tokenInput = dialog.getByLabel(l('Token da Cloudflare', 'Cloudflare API token'));
    const accountInput = dialog.getByLabel(l('ID da conta', 'Account ID'));
    const loadProjects = dialog.getByRole('button', { name: l('Carregar projetos', 'Load projects'), exact: true });
    const projectInput = dialog.getByRole('combobox', { name: l('Projeto', 'Project'), exact: true });
    const reviewButton = dialog.getByRole('button', { name: l('Revisar arquivos', 'Review files'), exact: true });
    const publishButton = dialog.getByRole('button', { name: l('Publicar no Cloudflare Pages', 'Deploy to Cloudflare Pages'), exact: true });
    await expect(tokenInput).toHaveAttribute('type', 'password');
    await expect(tokenInput).toHaveAttribute('autocomplete', 'off');
    await expect(reviewButton).toBeDisabled();
    await expect(publishButton).toBeDisabled();
    await tokenInput.fill(token);
    await accountInput.fill(accountId);
    await loadProjects.click();
    await dialog.getByText(l('Criar um projeto no Cloudflare Pages', 'Create a Cloudflare Pages project'), { exact: true }).click();
    await dialog.getByLabel(l('Nome do novo projeto', 'New project name'), { exact: true }).fill('fixture-created');
    await dialog.getByLabel(l('Branch de produção', 'Production branch'), { exact: true }).fill('release');
    await dialog.getByRole('button', { name: l('Criar projeto', 'Create project'), exact: true }).click();
    await expect(projectInput).toHaveText('fixture-created');
    const branchInput = dialog.getByLabel(l('Branch do deploy', 'Deployment branch'));
    await expect(branchInput).toHaveValue('release');
    const projectCreation = transportCalls.find(call => call.method === 'POST' && call.route === `/accounts/${accountId}/pages/projects`);
    assert.deepEqual(projectCreation.body, { name: 'fixture-created', production_branch: 'release' });
    assert.equal(transportCalls.some(call => call.route === '/pages/assets/upload'), false, 'Creating a project does not publish before review');
    await projectInput.click();
    await expect(page.locator('.web-publish-select-menu')).toBeVisible();
    await page.screenshot({ path: `/tmp/kodety-publication-select-${language}.png`, animations: 'disabled' });
    await page.keyboard.press('Home');
    await expect(page.getByRole('option', { name: l('Selecione um projeto', 'Select a project'), exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'fixture-site', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(projectInput).toHaveText('fixture-site');
    await reviewButton.click();
    await expect(dialog.locator('.web-html-deployment-file-list')).toContainText('index.html');
    await expect(dialog.locator('.web-html-deployment-file-list')).toContainText('asset.bin');
    await expect(dialog.locator('.web-html-deployment-file-list')).not.toContainText('.env');
    await dialog.getByRole('checkbox').check();
    await expect(publishButton).toBeEnabled();
    // A changed publishing destination must require a fresh review and consent.
    await projectInput.click();
    await page.getByRole('option', { name: 'other-site', exact: true }).click();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(publishButton).toBeDisabled();
    await projectInput.click();
    await page.getByRole('option', { name: 'fixture-site', exact: true }).click();
    await reviewButton.click();
    await dialog.getByRole('checkbox').check();
    await branchInput.fill('preview');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(publishButton).toBeDisabled();
    await branchInput.fill('main');
    await reviewButton.click();
    await dialog.getByRole('checkbox').check();
    await page.screenshot({ path: `/tmp/kodety-cloudflare-review-${language}.png`, animations: 'disabled' });
    await publishButton.click();
    const deploymentLink = dialog.getByRole('link', { name: l('Abrir endereço do deploy', 'Open deployment URL'), exact: true });
    await expect(deploymentLink).toHaveAttribute('href', 'https://preview.fixture-site.pages.dev');
    // The shared Builder's translation observer also recognizes this short label.
    await dialog.getByRole('button', { name: /^(?:Atualizar status|Status: Atualizar|Refresh status|Status: Refresh)$/ }).click();
    await expect(dialog.getByText(new RegExp(l('Cloudflare Pages.*Publicado', 'Cloudflare Pages.*Ready')))).toBeVisible();
    await page.screenshot({ path: `/tmp/kodety-cloudflare-published-${language}.png`, animations: 'disabled' });
    const creationCalls = transportCalls.filter(call => call.method === 'POST' && call.route.endsWith('/deployments'));
    assert.equal(creationCalls.length, 1, 'A confirmed review creates exactly one deployment');
    const published = creationCalls[0].body;
    const uploads = transportCalls.filter(call => call.route === '/pages/assets/upload').flatMap(call => call.body);
    assert.equal(published.branch, 'main');
    assert.ok(published.manifest['/index.html']);
    assert.ok(published.manifest['/asset.bin']);
    assert.equal(published.manifest['/.env'], undefined);
    assert.equal(published.manifest['/.incode/project.json'], undefined);
    const uploadedBinary = uploads.find(file => file.key === published.manifest['/asset.bin']);
    assert.ok(uploadedBinary, 'Binary file is actually uploaded before creating the deployment');
    assert.deepEqual(new Uint8Array(Buffer.from(uploadedBinary.value, 'base64')), binary);
    for (const file of uploads) assert.equal(Buffer.from(file.value, 'base64').toString().includes(token), false, 'Token must not appear in published files');

    // The alternate workflow remains a real, binary-safe public archive download.
    await zipMode.click();
    await expect(zipMode).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await reviewButton.click();
    await dialog.getByRole('checkbox').check();
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: l('Baixar ZIP para Cloudflare', 'Download Cloudflare ZIP'), exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'kodety-cloudflare-site.zip');
    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    assert.match(await zip.file('index.html').async('string'), /Cloudflare publishing fixture/);
    assert.deepEqual(await zip.file('asset.bin').async('uint8array'), binary);
    assert.equal(zip.file('.env'), null);
    assert.equal(zip.file('.incode/project.json'), null);
    for (const file of Object.values(zip.files)) {
      if (!file.dir) assert.equal((await file.async('string')).includes(token), false, `Token leaked into ZIP file ${file.name}`);
    }
    const persisted = await page.evaluate(async fixtureId => {
      const files = [];
      const walk = async (directory, prefix = '') => {
        for await (const [name, handle] of directory.entries()) {
          if (handle.kind === 'directory') await walk(handle, prefix + name + '/');
          else files.push({ path: prefix + name, contents: await (await handle.getFile()).text() });
        }
      };
      await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle(fixtureId));
      return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, files });
    }, fixtureId);
    assert.equal(persisted.includes(token), false, 'Token must remain only in dialog memory');
    await directMode.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await workflows.scrollIntoViewIfNeeded();
    for (const tab of await workflows.getByRole('tab').all()) {
      const bounds = await tab.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Every provider tab fits the mobile viewport');
      assert.equal(await tab.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Provider labels are not truncated');
    }
    await page.screenshot({ path: `/tmp/kodety-publication-tabs-mobile-${language}.png`, animations: 'disabled' });
    await publishButton.scrollIntoViewIfNeeded();
    for (const control of [publishButton, reviewButton]) {
      const bounds = await control.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Publishing controls fit the mobile viewport');
    }
    await page.screenshot({ path: `/tmp/kodety-cloudflare-mobile-${language}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openPublisher();
    await expect(tokenInput).toHaveValue('');
    await expect(accountInput).toHaveValue('');
    assert.deepEqual(errors, []);
    assert.equal(externalRequests.some(url => /api\.cloudflare\.com|api\.github\.com|api\.vercel\.com/.test(url)), false, 'Cloudflare credentials and deployments use only the same-origin endpoint');
    console.log(`${language}: Cloudflare default, direct publish and status, fresh review, manual ZIP, credential lifetime and mobile layout passed.`);
    await context.close();
  }
} catch (error) {
  console.error(await activePage?.locator('body').innerText().catch(() => ''));
  await activePage?.screenshot({ path: '/tmp/kodety-cloudflare-browser-failure.png', animations: 'disabled' }).catch(() => undefined);
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
