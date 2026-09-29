// Opt-in integration test; requires internet to prime the real Playground runtime.
// Run: node WebApp/kodety-studio/tests/project-deletion-runtime-browser.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const server = await createServer({
  configFile: `${root}/WebApp/kodety-studio/vite.config.ts`,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  // This context has no connection to a user's browser profile or projects.
  const context = await browser.newContext();
  const page = await context.newPage();
  const diagnostics = [];
  page.on('requestfailed', request => diagnostics.push(`${request.failure()?.errorText}: ${request.url()}`));
  page.on('pageerror', error => diagnostics.push(String(error)));
  const response = await page.goto(new URL('project-storage.html', server.resolvedUrls.local[0]).href);
  assert.equal(response.headers()['document-isolation-policy'], 'isolate-and-credentialless');
  assert.equal(response.headers()['cross-origin-embedder-policy'], undefined,
    'COEP prevents the real Playground iframe from loading');
  assert.deepEqual(await page.evaluate(() => ({ isolated: crossOriginIsolated, sharedMemory: typeof SharedArrayBuffer })),
    { isolated: true, sharedMemory: 'function' });

  await page.evaluate(async repository => {
    const { startPlaygroundWeb } = await import(`/@fs${repository}/node_modules/@wp-playground/client/index.js`);
    const { destroyProjectData } = await import(`/@fs${repository}/ChromeExtension/kodety-studio/src/playground-runtime.ts`);
    const { opfsPathForProject } = await import(`/@fs${repository}/ChromeExtension/kodety-studio/src/storage.ts`);
    const iframe = document.createElement('iframe');
    // Match the persistent application iframe; credentialless would silently use
    // temporary storage and give a false positive by opening an empty project.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals');
    document.body.append(iframe);
    const deadline = async operation => {
      let timer;
      try {
        return await Promise.race([operation, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Real Playground operation exceeded 60 seconds')), 60_000);
        })]);
      } finally { clearTimeout(timer); }
    };
    const start = () => deadline(startPlaygroundWeb({
      iframe,
      remoteUrl: 'https://playground.wordpress.net/remote.html',
      scope: 'kodety-deletion-integration-test',
      disableProgressBar: true,
      wordpressInstallMode: 'do-not-attempt-installing',
      blueprint: { preferredVersions: { php: '8.3', wp: false } },
    }));
    const mount = async (client, project) => {
      if (!await client.isDir('/wordpress')) await client.mkdir('/wordpress');
      await client.mountOpfs({
        device: { type: 'opfs', path: opfsPathForProject(project.id) },
        mountpoint: '/wordpress', initialSyncDirection: 'opfs-to-memfs',
      });
    };
    const close = async client => {
      await client.unmountOpfs('/wordpress');
      iframe.src = 'about:blank';
    };
    window.deletionFixture = {
      async seed() {
        const project = { id: `deletion-test-${crypto.randomUUID()}`, phpVersion: '8.3', wordpressVersion: '6.8' };
        let client = await start();
        await mount(client, project);
        await client.writeFile('/wordpress/index.html', '<main>Synthetic non-WordPress project</main>');
        await client.mkdir('/wordpress/assets');
        await client.writeFile('/wordpress/assets/style.css', 'body { color: navy; }');
        await client.flushOpfs('/wordpress');
        await close(client);
        // Prove the synthetic files survived unloading the first runtime before
        // testing deletion, including a nested directory.
        client = await start();
        await mount(client, project);
        const persisted = await client.readFileAsText('/wordpress/index.html');
        await close(client);
        if (!persisted.includes('Synthetic non-WordPress')) throw new Error('Fixture did not persist');
        return project;
      },
      async removeAndVerify(project) {
        const stages = [];
        await deadline(destroyProjectData({ iframe, project, language: 'pt', onStage: stage => stages.push(stage) }));
        const client = await start();
        await mount(client, project);
        const remaining = await client.listFiles('/wordpress');
        await close(client);
        return { stages, remaining };
      },
    };
  }, root);

  for (const offline of [false, true]) {
    const project = await page.evaluate(() => window.deletionFixture.seed());
    await context.setOffline(offline);
    try {
      const result = await page.evaluate(project => window.deletionFixture.removeAndVerify(project), project);
      assert.deepEqual(result.remaining, [], `Project files remain after ${offline ? 'offline' : 'online'} deletion`);
      assert.equal(result.stages.length, 3);
      console.log(`${offline ? 'Offline' : 'Online'} deletion passed: persistent non-WordPress files and nested directory removed.`);
    } catch (error) {
      console.error(diagnostics.join('\n'));
      throw error;
    } finally { await context.setOffline(false); }
  }
} finally {
  await browser?.close();
  await server.close();
}
