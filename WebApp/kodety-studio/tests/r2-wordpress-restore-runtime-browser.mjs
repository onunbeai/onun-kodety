// Opt-in real-runtime recovery proof. Uses a disposable browser profile and
// synthetic project IDs only; requires internet for Playground and WordPress.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const repository = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const server = await createServer({ configFile: `${repository}/WebApp/kodety-studio/vite.config.ts`, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(new URL('project-storage.html', server.resolvedUrls.local[0]).href);
  await page.exposeFunction('reportRestoreStage', value => console.log(value));
  const result = await page.evaluate(async repository => {
    const { startPlaygroundWeb, zipWpContent } = await import(`/@fs${repository}/node_modules/@wp-playground/client/index.js`);
    const { bootProject } = await import(`/@fs${repository}/ChromeExtension/kodety-studio/src/playground-runtime.ts`);
    const { opfsPathForProject } = await import(`/@fs${repository}/ChromeExtension/kodety-studio/src/storage.ts`);
    const { restorePendingR2WordPress } = await import('/src/r2-project-restore.ts');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals');
    document.body.append(iframe);
    const limit = async operation => {
      let timeout;
      try { return await Promise.race([operation, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Real recovery operation exceeded 90 seconds')), 90_000); })]); }
      finally { clearTimeout(timeout); }
    };
    const mount = id => ({ device: { type: 'opfs', path: opfsPathForProject(id) }, mountpoint: '/wordpress', initialSyncDirection: 'memfs-to-opfs' });
    const sourceId = `r2-source-${crypto.randomUUID()}`;
    const copyId = `r2-copy-${crypto.randomUUID()}`;
    const file = '/wordpress/wp-content/uploads/synthetic-recovery.txt';
    const marker = 'Original project and recovered copy';
    const source = await limit(startPlaygroundWeb({
      iframe, remoteUrl: 'https://playground.wordpress.net/remote.html', scope: 'kodety-r2-original-proof',
      disableProgressBar: true, wordpressInstallMode: 'download-and-install',
      blueprint: { preferredVersions: { php: '8.3', wp: '6.8' }, login: true },
    }));
    if (!await source.isDir('/wordpress/wp-content/uploads')) await source.mkdir('/wordpress/wp-content/uploads');
    await source.writeFile(file, marker);
    await source.run({ code: "<?php require '/wordpress/wp-load.php'; update_option('kodety_recovery_proof', 'preserved-option');" });
    await source.mountOpfs(mount(sourceId));
    await source.flushOpfs('/wordpress');
    const originalDatabase = Array.from(await source.readFileAsBuffer('/wordpress/wp-content/database/.ht.sqlite'));
    const archive = new Blob([await limit(zipWpContent(source))], { type: 'application/zip' });
    await source.unmountOpfs('/wordpress');
    iframe.src = 'about:blank';
    await window.reportRestoreStage('Synthetic WordPress source persisted and exported.');

    // Use the same durable pending archive store as recovery from R2, but no
    // external storage account, credentials or user project participates.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('kodety-r2-restore-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('archives');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('archives', 'readwrite');
        tx.objectStore('archives').put(archive, copyId);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    let restored = 0;
    const copy = await limit(bootProject({
      iframe,
      project: { id: copyId, name: 'Recovered disposable copy', mode: 'wordpress', initialized: false, phpVersion: '8.3', wordpressVersion: '6.8', wordpressLocale: 'en_US', createdAt: Date.now(), updatedAt: Date.now() },
      language: 'en', onStage: (_stage, message) => window.reportRestoreStage(message),
      restoreFirstBoot: async client => { restored++; await restorePendingR2WordPress(copyId, client); },
    }));
    const copiedFile = await copy.client.readFileAsText(file);
    const option = await copy.client.run({ code: "<?php require '/wordpress/wp-load.php'; echo get_option('kodety_recovery_proof');" });
    await copy.client.unmountOpfs('/wordpress');
    iframe.src = 'about:blank';
    await window.reportRestoreStage('Recovered new ID through the actual first-boot archive import.');

    const check = await limit(startPlaygroundWeb({
      iframe, remoteUrl: 'https://playground.wordpress.net/remote.html', scope: 'kodety-r2-preservation-proof',
      disableProgressBar: true, wordpressInstallMode: 'do-not-attempt-installing',
      blueprint: { preferredVersions: { php: '8.3', wp: false } },
    }));
    if (!await check.isDir('/wordpress')) await check.mkdir('/wordpress');
    await check.mountOpfs({ ...mount(sourceId), initialSyncDirection: 'opfs-to-memfs' });
    const sourceFile = await check.readFileAsText(file);
    const sourceDatabaseUnchanged = JSON.stringify(Array.from(await check.readFileAsBuffer('/wordpress/wp-content/database/.ht.sqlite'))) === JSON.stringify(originalDatabase);
    await check.unmountOpfs('/wordpress');
    return { distinctIds: sourceId !== copyId, restored, copiedFile, sourceFile, option: new TextDecoder().decode(option.bytes), sourceDatabaseUnchanged, initialized: copy.initializedNow };
  }, repository);
  assert.deepEqual(result, { distinctIds: true, restored: 1, copiedFile: 'Original project and recovered copy', sourceFile: 'Original project and recovered copy', option: 'preserved-option', sourceDatabaseUnchanged: true, initialized: true });
  console.log('Real WordPress recovery passed: new ID, restored file/database option, original persistent file and SQLite bytes unchanged.');
} finally {
  await browser?.close();
  await server.close();
}
