import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React, { StrictMode } from 'react';
    import { createRoot } from 'react-dom/client';
    import { HtmlAgentSettings } from './app/(builder)/kodety/html-editor/components/HtmlAgentSettings';
    import { useHtmlAgentEditorBridgeStore } from './stores/useHtmlAgentEditorBridgeStore';
    window.setRunning = value => value ? useHtmlAgentEditorBridgeStore.getState().startTurnActivity('turn-1') : useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
    const root = createRoot(document.getElementById('root'));
    let selected = 'local', canChange = true, localHealthy = false, legacyConfig = false, revision = 0;
    window.requests = []; window.mcpNavigation = 0;
    const config = () => ({ enabled: true, available: selected === 'remote' || localHealthy,
      ...(legacyConfig ? { transportOptions: { canChange } } : { transport: selected, transportOptions: { selected, canChange, remoteLabel: 'Kodety Cloud' } }),
      ...(selected === 'remote' ? { remote: { sessionPath: 'remote/session' } } : localHealthy ? {} : {
        unavailableReason: 'exec_unavailable', runtimeDiagnostics: { code: 'exec_unavailable', message: 'Processos bloqueados.', action: 'Use um serviço remoto.', retryable: false }
      })
    });
    window.fetch = async (url, init = {}) => {
      window.requests.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
      const respond = value => Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
      if (String(url).endsWith('/config')) return respond(init.body ? { success: true, defaultModel: JSON.parse(init.body).model, defaultEffort: JSON.parse(init.body).effort, enabledSkills: JSON.parse(init.body).enabledSkills } : config());
      if (String(url).endsWith('/transport')) { selected = JSON.parse(init.body).transport; return respond(config()); }
      if (String(url).endsWith('/remote/session')) return respond({ gatewayUrl: 'https://agent.kodety.com', token: 'ticket.test.signature', expiresAt: Date.now() / 1000 + 300 });
      if (String(url).startsWith('https://agent.kodety.com/')) throw new TypeError('offline');
      if (String(url) === 'https://site.test/wp-json/kodety/v1/agents/rpc') {
        if (!localHealthy) throw new Error('A blocked local host must not receive RPC');
        const { method } = JSON.parse(init.body);
        if (method === 'account/read') return respond({ account: { type: 'chatgpt', email: 'local@example.test', planType: 'pro' } });
        if (method === 'skills/list') return respond({ data: [] });
        if (method === 'figma/status') return respond({ installed: false, connected: false });
        throw new Error('Unexpected local RPC: ' + method);
      }
      throw new Error('Unexpected request: ' + url);
    };
    window.mount = (allowed = true, readOnly = false, healthy = false, legacy = false) => {
      selected = 'local'; canChange = allowed; localHealthy = healthy; legacyConfig = legacy; revision++; window.requests = []; window.mcpNavigation = 0;
      root.render(<StrictMode><HtmlAgentSettings key={revision} agentUrl="https://site.test/wp-json/kodety/v1/agents" nonce="nonce-test" readOnly={readOnly} onUseMcp={() => { window.mcpNavigation++; }} /></StrictMode>);
    };
    window.mount();
  ` },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"development"' },
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://site.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }));
  await page.goto('https://site.test/builder');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const selector = page.getByRole('combobox', { name: 'Execução do Agent' });
  await expect(selector).toBeVisible();
  await expect(selector).toContainText('Neste servidor');
  await expect(page.getByRole('button', { name: 'Usar Kodety Cloud' })).toHaveCount(0);
  const mcp = page.getByRole('button', { name: 'Conectar via MCP', exact: true });
  await expect(mcp).toBeEnabled();
  await expect(page.getByText(/A execução No servidor depende dos recursos da hospedagem/)).toBeVisible();
  await expect(page.getByText(/pode apresentar instabilidade/)).toHaveCount(0);
  const cloudRequests = () => page.evaluate(() => window.requests.filter(request => request.url.endsWith('/transport') || request.url.endsWith('/remote/session') || request.url.startsWith('https://agent.kodety.com/')));
  assert.deepEqual(await cloudRequests(), [], 'a blocked shared host only offers Cloud; it never changes environment or requests a ticket automatically');
  await mcp.click();
  assert.equal(await page.evaluate(() => window.mcpNavigation), 1);
  assert.deepEqual(await cloudRequests(), [], 'MCP remains independent from Cloud authentication');
  await expect(selector).toBeDisabled();
  assert(!(await page.locator('input[type="url"]').count()), 'end users must never enter a private gateway URL');

  await page.evaluate(() => window.setRunning(true));
  await expect(selector).toBeDisabled();
  await page.evaluate(() => window.setRunning(false));
  await expect(selector).toBeDisabled();
  await page.evaluate(() => window.mount(false));
  await expect(selector).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Usar Kodety Cloud' })).toHaveCount(0);
  await page.evaluate(() => window.mount(true, true));
  await expect(selector).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Usar Kodety Cloud' })).toHaveCount(0);
  // Legacy config without transport fields and a healthy local server must
  // preserve local routing, including account synchronization on return.
  await page.evaluate(() => window.mount(true, false, true, true));
  await expect(selector).toContainText('Neste servidor');
  await expect(page.getByText('local@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trocar conta', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Usar Kodety Cloud' })).toHaveCount(0);
  await expect(mcp).toHaveCount(0);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
  await expect.poll(() => page.evaluate(() => window.requests.filter(request => request.url.endsWith('/rpc') && JSON.parse(request.body).method === 'account/read').length)).toBeGreaterThan(0);
  assert.deepEqual(await cloudRequests(), [], 'healthy local settings must never touch the gateway, even when an older config omits transport');
  assert.equal(await page.evaluate(() => window.requests.filter(request => request.body && /account\/(login|logout)/.test(JSON.parse(request.body).method)).length), 0, 'reading an existing local account must not start authentication');
  assert.deepEqual(errors, []);
  console.log('Agent settings: local account discovery, MCP fallback, no private cloud traffic, read-only and active-turn guards passed.');
} finally {
  await browser.close();
}
