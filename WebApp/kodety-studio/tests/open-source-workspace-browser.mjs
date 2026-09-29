import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect as baseExpect } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 60000 });
const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({ configFile: path.join(root, 'WebApp/kodety-studio/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const privateRequests = [], errors = [];
page.on('request', request => { if (/https?:\/\/(?:backend|dash|studio)\.kodety\.com/.test(request.url()) || /\/__kodety_cloud__\//.test(request.url())) privateRequests.push(request.url()); });
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(60000);
try {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('kodetyStudioWebOnboarding', '2');
    localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language: 'en', onboardingVersion: 2 }));
  });
  await page.goto(server.resolvedUrls.local[0]);
  await expect(page.getByText('Onun Kodety', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.web-cloud-login-gate')).toHaveCount(0);
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await page.locator('#web-project-name').fill('Open Source Smoke');
  await page.locator('#web-project-storage').selectOption('browser');
  await page.getByRole('button', { name: 'Create and open project', exact: true }).click();
  await expect(page.locator('.web-html-builder iframe').first()).toBeAttached();
  await expect(page.locator('.web-html-builder')).toBeVisible();
  const project = await page.evaluate(async () => {
    const item = JSON.parse(localStorage.getItem('kodetyStudioProjectsV1'))[0];
    const directory = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('kodety-studio-html-projects-v1')).getDirectoryHandle(item.id);
    const file = await (await directory.getFileHandle('index.html')).getFile();
    return { name: item.name, mode: item.mode, storageMode: item.storageMode, html: await file.text() };
  });
  assert.equal(project.name, 'Open Source Smoke');
  assert.equal(project.mode, 'html');
  assert.equal(project.storageMode, 'browser');
  assert.match(project.html, /<!doctype html>/i);
  await page.reload();
  await expect(page.locator('.web-html-builder iframe').first()).toBeAttached();
  assert.deepEqual(privateRequests, [], 'No request may contact the former private SaaS services');
  assert.deepEqual(errors, [], 'The library and editor must load without JavaScript errors');
  console.log('Open-source smoke passed: no login, local OPFS creation, editor open, reload, no private service calls.');
} catch (error) {
  await page.screenshot({ path: path.join(tmpdir(), 'onun-local-smoke-failure.png') });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await context.close(); await browser.close(); await server.close();
}
