// Opt-in real-browser contract (downloads the official Playground runtime once).
// Run: node WebApp/kodety-studio/tests/wordpress-offline-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const versions = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const zipPath = path.join(root, `Wordpress/dist/${versions.kodety.wordpressVersion.replaceAll('.', '_')}.zip`);
const built = await build({
  stdin: {
    contents: `
      import {bootProject, flushProject, navigateProject} from './ChromeExtension/kodety-studio/src/playground-runtime.ts';
      import {newProject} from './ChromeExtension/kodety-studio/src/storage.ts';
      window.persisted = newProject('Offline browser regression', 'en_US');
      window.offlineSignals = [];
      window.addEventListener('message', event => {
        if(event.origin === 'https://playground.wordpress.net' && event.data?.type === 'offline-cache') { window.offlineSignals.push(event.data); console.log('offline-cache',JSON.stringify(event.data)); }
      });
      window.boot = async () => {
        document.querySelector('iframe')?.remove();
        const iframe = document.createElement('iframe'); document.body.append(iframe);
        const result = await bootProject({ iframe, project: window.persisted, language: 'en', prepareOffline: true,
          onStage(stage,detail) { console.log(stage,detail); },
          async onPersisted(project) { window.persisted = project; },
        });
        window.client = result.client;
        window.persisted = {...window.persisted, ...result.runtimeVersions, initialized:true,runtimeRevision:result.runtimeRevision};
        return await window.client.getCurrentURL();
      };
      window.flush = () => flushProject(window.client);
      window.editor = () => navigateProject(window.client, '/kodety/editor/');
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
});
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/probe.js') {
      response.setHeader('Content-Type', 'application/javascript'); response.end(built.outputFiles[0].contents);
    } else if (request.url === '/assets/kodety.zip') {
      response.setHeader('Content-Type', 'application/zip'); response.end(await readFile(zipPath));
    } else {
      response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><script type="module" src="/probe.js"></script>');
    }
  } catch (error) { response.statusCode = 500; response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(240_000);
page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
page.on('pageerror', error => console.log('Browser error:', error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  console.log('Online:', await page.evaluate(() => window.boot()));
  await page.waitForFunction(() => window.offlineSignals.length, undefined, { timeout: 60_000 });
  assert.equal((await page.evaluate(() => window.offlineSignals.at(-1))).status, 'ready');
  await page.evaluate(async () => {
    await window.client.writeFile('/wordpress/kodety-offline-proof.txt', 'Saved online');
    await window.flush();
  });
  await context.setOffline(true);
  await page.evaluate(() => { window.offlineSignals = []; });
  console.log('Offline:', await page.evaluate(() => window.boot()));
  assert.equal(await page.evaluate(() => window.client.readFileAsText('/wordpress/kodety-offline-proof.txt')), 'Saved online');
  await page.waitForFunction(() => window.offlineSignals.some(message => message.status === 'ready'));
  const editor = page.frames().find(frame => frame.url().includes('/kodety/editor/'));
  assert.ok(editor, 'Restored WordPress opens the actual Kodety Builder without network');
  await editor.waitForFunction(() => document.body.textContent.includes('Builder') || document.querySelector('[data-kodety-editor]'));
  await page.evaluate(async () => {
    await window.client.writeFile('/wordpress/kodety-offline-proof.txt', 'Edited offline');
    await window.flush();
  });
  await page.evaluate(() => window.boot());
  assert.equal(await page.evaluate(() => window.client.readFileAsText('/wordpress/kodety-offline-proof.txt')), 'Edited offline');
  console.log('PASS: WordPress + Kodety Builder boot, OPFS restoration, offline edits and a second offline reopen.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
