import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// tabs.setZoom changes real browser page zoom. Device emulation alone changes
// density, and Emulation.setPageScaleFactor changes pinch zoom; neither can
// reproduce the fractional iframe media-query viewport by itself.
export async function launchBrowserWithPageZoom(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kodety-page-zoom-'));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Kodety local page zoom test', version: '1.0',
    permissions: ['tabs'], background: { service_worker: 'worker.js' },
  }));
  await writeFile(path.join(directory, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  let context;
  try {
    context = await chromium.launchPersistentContext('', {
      headless: true, ...options, channel: 'chromium',
      args: [...(options.args || []), `--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    return {
      context,
      async setPageZoom(page, factor) {
        const url = page.url();
        if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) throw new Error('Page zoom fixture only accepts a loopback page.');
        await worker.evaluate(async ({ url, factor }) => {
          const tab = (await chrome.tabs.query({})).find(candidate => candidate.url === url);
          if (!tab?.id) throw new Error('Local fixture tab was not found.');
          await chrome.tabs.setZoom(tab.id, factor);
        }, { url, factor });
      },
      async close() {
        try { await context.close(); } finally { await rm(directory, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
