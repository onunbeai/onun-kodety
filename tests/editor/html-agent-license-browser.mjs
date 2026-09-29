import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit, expect } from '@playwright/test';

const engine = process.env.BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { HtmlAgentPanel } from './app/(builder)/kodety/html-editor/components/HtmlAgentPanel';
    import { HtmlAgentSettings } from './app/(builder)/kodety/html-editor/components/HtmlAgentSettings';
    import { HtmlWorkspaceAgentProvider } from './lib/html-editor/agent-host';
    import { createKodetyProductAccess } from './lib/html-editor/product-access';
    const fixture = window.licenseFixture = { calls: [], held: [], checks: [], licensed: false, runtimeFails: false, first: true };
    const checkLicense = async () => {
      const licensed = await new Promise((resolve, reject) => fixture.checks.push({ resolve, reject }));
      fixture.setLicensed(licensed);
      return licensed;
    };
    const binding = { key: 'webcontainer:license-fixture', createBackend(callbacks) {
      return { remote: false, cancelAll() {}, async uploadAttachment() { throw new Error('unused'); },
        async request(suffix, options = {}) {
          options.signal?.throwIfAborted();
          fixture.calls.push(suffix);
          if (suffix === 'config' || suffix === 'config/retry') {
            const licensed = fixture.licensed;
            const allowed = !fixture.runtimeDenies;
            const config = { enabled: allowed, licenseRequired: !allowed, available: allowed,
              transport: 'webcontainer', capabilities: { attachments: false, skills: false, figma: false } };
            if (fixture.first && fixture.holdFirst) {
              fixture.first = false;
              await new Promise((resolve, reject) => {
                fixture.held.push(resolve);
                options.signal?.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
              });
            }
            options.signal?.throwIfAborted();
            if (fixture.runtimeFails) throw Object.assign(new Error('O navegador não pôde iniciar o Agent.'), { code: 'agent_browser_fixture_unavailable' });
            callbacks.onConfig?.(config);
            return config;
          }
          if (suffix === 'rpc' && options.body?.method === 'account/read') return { account: null };
          throw new Error('Unexpected fixture request: ' + suffix + ':' + options.body?.method);
        },
      };
    } };
    function App({ surface, initialLicensed, native, initiallyVisible }) {
      const [product, setProduct] = useState(() => createKodetyProductAccess({ licensed: initialLicensed }));
      const [visible, setVisible] = useState(initiallyVisible);
      fixture.setVisible = setVisible;
      fixture.setLicensed = value => { fixture.licensed = value; setProduct(createKodetyProductAccess({ licensed: value })); };
      return <HtmlWorkspaceAgentProvider kind={native ? 'wordpress' : 'html'} licensed={product.licensed} agent={native ? undefined : binding} checkLicense={native ? undefined : checkLicense} onOpenSettings={() => {}}>
        <output data-testid="builder-license">{product.licensed ? 'Pro ativo' : 'Free'}</output>
        {surface === 'settings' ? <HtmlAgentSettings agentUrl="https://license-fixture.test/agents" nonce="fixture" /> : <HtmlAgentPanel visible={visible} />}
      </HtmlWorkspaceAgentProvider>;
    }
    fixture.mount = ({ surface = 'panel', licensed = false, holdFirst = false, runtimeFails = false, runtimeDenies = false, native = false, visible = true } = {}) => {
      fixture.licensed = licensed; fixture.holdFirst = holdFirst; fixture.runtimeFails = runtimeFails;
      fixture.runtimeDenies = runtimeDenies;
      if (native) window.kodetyWordPress = { agentUrl: 'https://license-fixture.test/agents', nonce: 'fixture', product: { licensed } };
      createRoot(document.getElementById('root')).render(<App surface={surface} initialLicensed={licensed} native={native} initiallyVisible={visible} />);
    };
    fixture.release = () => fixture.held.splice(0).forEach(resolve => resolve());
  ` },
  absWorkingDir: root, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.wasm': 'binary' },
  define: { 'process.env.NODE_ENV': '"development"' },
});
const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
async function fixture(options, run) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().endsWith('/agents/config')
    ? route.fulfill({ json: { enabled: false, licenseRequired: true, available: false } })
    : route.fulfill({ status: 200, contentType: 'text/html', body: '<html lang="pt-BR"><body><div id="root"></div></body></html>' }));
  try {
    await page.goto('https://license-fixture.test/');
    if (options.locale) await page.evaluate(locale => { document.documentElement.lang = locale; }, options.locale);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(options => window.licenseFixture.mount(options), options);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
try {
  for (const surface of ['panel', 'settings']) {
    if (engine === 'webkit') {
      for (const locale of ['pt-BR', 'en']) test(`${engine}: ${surface} explains browser compatibility without paid activation`, async () => {
        await fixture({ surface, locale }, async page => {
          const notice = page.locator('[data-agent-browser-notice]');
          await expect(notice).toBeVisible();
          await expect(notice.getByRole('heading')).toHaveText(locale === 'en' ? 'Use a compatible browser' : 'Use um navegador compatível');
          assert.deepEqual(await page.evaluate(() => window.licenseFixture.calls), []);
          assert.deepEqual(await page.evaluate(() => window.licenseFixture.checks), []);
        });
      });
    } else {
      test(`${engine}: ${surface} connects runtime without product activation and ignores old license changes`, async () => {
        await fixture({ surface }, async page => {
          await expect.poll(() => page.evaluate(() => window.licenseFixture.calls.filter(call => call === 'rpc').length)).toBeGreaterThan(0);
          await expect(page.getByRole('button', { name: /Ativar licença|Verificar licença/ })).toHaveCount(0);
          await expect(page.getByText(/Disponível apenas para usuários Pro|Agent disponível apenas no Kodety Pro/)).toHaveCount(0);
          await page.evaluate(() => window.licenseFixture.setLicensed(false));
          await expect(page.getByRole('button', { name: /Ativar licença|Verificar licença/ })).toHaveCount(0);
          assert.equal(await page.evaluate(() => window.licenseFixture.checks.length), 0);
        });
      });
      test(`${engine}: ${surface} preserves runtime failures without a paywall`, async () => {
        await fixture({ surface, runtimeDenies: true }, async page => {
          await expect(page.getByRole('alert')).toBeVisible();
          await expect(page.getByRole('button', { name: /Ativar licença|Verificar licença/ })).toHaveCount(0);
          assert.deepEqual(await page.evaluate(() => window.licenseFixture.calls), ['config'], 'unavailable runtime must not receive account RPCs');
        });
      });
    }
    test(`${engine}: ${surface} respects an unavailable WordPress runtime without paid activation`, async () => {
      await fixture({ surface, native: true }, async page => {
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('button', { name: /Ativar licença|Verificar licença/ })).toHaveCount(0);
        assert.equal(await page.evaluate(() => window.licenseFixture.checks.length), 0);
      });
    });
  }
} finally {
  test.after(async () => browser.close());
}
