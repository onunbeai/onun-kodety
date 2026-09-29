// Compare the released HTML Builder's actual computed styles with the WordPress
// entry's shared stylesheets, on the same selected element and viewport.
// Run after studio:web:build: node WebApp/kodety-studio/tests/html-builder-parity-browser.mjs
// Uses a disposable Chromium profile and OPFS folder, never a user project.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

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
const reference = (await postcss([tailwindcss({ base: root })]).process([
  '@import "./app/globals.css";',
  '@import "./Wordpress/editor/wordpress-editor.css";',
  // Host geometry only; the Builder controls come from the two WP imports.
  '@import "./WebApp/kodety-studio/src/html-workspace.css";',
].join('\n'), { from: path.join(root, 'builder-parity-reference.css') })).css
  + '\n@font-face{font-family:"Kodety Inter";src:url("/assets/inter-latin-variable.woff2");font-weight:100 900}'
  + '#kodety-studio-root,.web-builder-host{height:100%;width:100%}';
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.KODETY_BROWSER_EXECUTABLE ? { executablePath: process.env.KODETY_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
const failed = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
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

  await page.getByText('Fixture heading', { exact: true }).click();
  await page.locator('[data-ycode-native-ui]').first().waitFor();
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.screenshot({ path: '/tmp/kodety-builder-parity-html.png', fullPage: true });
  const measure = () => [...document.querySelectorAll([
    '#kodety-root .kodety-editor-design-sidebar *',
    '#kodety-root .kodety-editor-left-sidebar *',
    '#kodety-root .kodety-editor-topbar *',
  ].join(','))].filter(el => el.getBoundingClientRect().width > 0).map((el, index) => {
    const style = getComputedStyle(el);
    const props = [
      'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
      'letterSpacing', 'padding', 'margin', 'gap', 'borderWidth', 'borderColor',
      'borderRadius', 'opacity', 'display', 'width', 'height',
    ];
    return {
      index, tag: el.tagName, classes: el.getAttribute('class'), text: el.textContent?.slice(0, 35),
      ...Object.fromEntries(props.map(prop => [prop, style[prop]])),
    };
  });
  const actual = await page.evaluate(measure);
  await page.evaluate(css => {
    for (const sheet of document.styleSheets) sheet.disabled = true;
    const node = document.createElement('style');
    node.textContent = css + '\n*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.append(node);
  }, reference);
  await page.screenshot({ path: '/tmp/kodety-builder-parity-wordpress.png', fullPage: true });
  const expected = await page.evaluate(measure);
  const diff = actual.flatMap((element, index) => {
    const baseline = expected[index];
    if (!baseline) return [{ index, missing: true }];
    const changes = Object.keys(element).filter(prop => {
      // A zero-width border cannot paint; its inherited color is immaterial.
      if (prop === 'borderColor' && element.borderWidth === '0px' && baseline.borderWidth === '0px') return false;
      return element[prop] !== baseline[prop];
    }).map(prop => [prop, element[prop], baseline[prop]]);
    return changes.length ? [{ index, tag: element.tag, text: element.text, classes: element.classes, changes }] : [];
  });
  await import('node:fs/promises').then(fs => fs.writeFile('/tmp/kodety-parity-results.json', JSON.stringify({ actual, expected, diff }, null, 2)));
  assert.deepEqual(errors, [], 'the Builder has no browser exceptions');
  assert.equal(actual.length, expected.length, 'both hosts expose the same control geometry');
  assert.deepEqual(diff, [], 'HTML must match the shared WordPress colors, fonts, spacing, icon sizes and visible borders');
  console.log(`Builder parity PASS: ${actual.length} elements, 17 computed styles each, zero visible differences.`);
} catch (error) {
  await page.screenshot({ path: '/tmp/kodety-html-workspace-failure.png', fullPage: true }).catch(() => undefined);
  console.error(JSON.stringify({ errors, failed, body: (await page.locator('body').innerText().catch(() => '')).slice(0, 8000), frames: page.frames().map(frame => frame.url()) }, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
