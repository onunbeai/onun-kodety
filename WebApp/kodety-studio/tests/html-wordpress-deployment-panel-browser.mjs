// Exercise the source panel without rebuilding the Studio distribution.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Dialog } from './WebApp/kodety-studio/src/ui';
      import { HtmlWordPressDeploymentPanel } from './WebApp/kodety-studio/src/html-deployment-wordpress-panel';
      window.exportCalls = 0;
      function Fixture() {
        const language = new URLSearchParams(location.search).get('language');
        const [busy, setBusy] = useState(false);
        const [open, setOpen] = useState(true);
        return <main className="web-app">{open && <Dialog title="Publish fixture" closeLabel="Close fixture" className="web-html-deployment" busy={busy} onClose={() => setOpen(false)}>
          <div className="web-form-body web-html-deployment-body"><HtmlWordPressDeploymentPanel language={language} onBusy={setBusy} onExportWordPress={() => {
            window.exportCalls++;
            return new Promise((resolve, reject) => { window.finishExport = resolve; window.failExport = () => reject(new Error('internal-sensitive-detail')); });
          }} /></div>
        </Dialog>}</main>;
      }
      createRoot(document.getElementById('root')).render(<Fixture />);
    `,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', logLevel: 'silent',
});
const styles = (await Promise.all(['webapp.css', 'html-deployment.css'].map(name => readFile(path.join(root, 'WebApp/kodety-studio/src', name), 'utf8')))).join('\n');
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].contents); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${styles}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const language of ['pt', 'en']) {
    const l = (pt, en) => language === 'en' ? en : pt;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?language=${language}`);
    const dialog = page.getByRole('dialog', { name: 'Publish fixture' });
    const download = dialog.getByRole('button', { name: l('Baixar ZIP para WordPress', 'Download WordPress ZIP'), exact: true });
    const plugin = dialog.getByRole('link', { name: l('Baixar plugin Onun Kodety para WordPress', 'Download Onun Kodety plugin for WordPress'), exact: true });
    await expect(dialog.locator('ol > li')).toHaveCount(5);
    await expect(plugin).toHaveAttribute('href', './assets/kodety.zip');
    await expect(plugin).toHaveAttribute('target', '_blank');
    await expect(plugin).toHaveAttribute('rel', 'noreferrer');
    await expect(dialog.getByText(/Kodety → Atualizar HTML → Importar projeto → Arquivo ZIP|Kodety → Update HTML → Import project → ZIP file/)).toBeVisible();

    // Dispatch twice in one browser task to verify the in-flight ref lock,
    // including the interval before React renders the disabled button.
    await download.evaluate(button => { button.click(); button.click(); });
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('button', { name: 'Close fixture', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: l('Preparando ZIP…', 'Preparing ZIP…'), exact: true })).toBeDisabled();
    assert.equal(await page.evaluate(() => window.exportCalls), 1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await page.evaluate(() => window.failExport());
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    await expect(dialog.getByRole('alert')).toContainText(l('Não foi possível preparar o ZIP.', 'Could not prepare the ZIP.'));
    await expect(dialog.getByRole('alert')).not.toContainText('internal-sensitive-detail');
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(download).toBeEnabled();

    await download.click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await page.evaluate(() => window.finishExport());
    await expect(dialog.getByRole('status')).toContainText(l('ZIP preparado.', 'ZIP prepared.'));
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    assert.equal(await page.evaluate(() => window.exportCalls), 2);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const control of [download, plugin]) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, 'WordPress controls fit the mobile viewport');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(`${language}: WordPress guide, plugin link, async export lock, failure/retry, dialog busy state, and mobile controls passed.`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
