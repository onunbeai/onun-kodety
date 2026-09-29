import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
      import React, { StrictMode, useEffect } from 'react';
      import { createRoot } from 'react-dom/client';
      import { WordPressAgentProvider } from './Wordpress/editor/WordPressAgentProvider';
      import { HtmlAgentSettings } from './app/(builder)/kodety/html-editor/components/HtmlAgentSettings';
      import { useHtmlWorkspaceAgentHost } from './lib/html-editor/agent-host';
      import { WORDPRESS_LICENSE_CHANGED } from './Wordpress/editor/wordpress-trial-runtime';
      import { OPEN_HTML_AGENT_PANEL_EVENT } from './lib/html-editor/agent-panel-events';

      const fixture = window.agentProviderFixture = { bindings: [], host: null, documentToken: crypto.randomUUID(), panelOpenEvents: 0 };
      window.addEventListener(OPEN_HTML_AGENT_PANEL_EVENT, () => { fixture.panelOpenEvents++; });
      let root;
      function Probe() {
        const host = useHtmlWorkspaceAgentHost();
        useEffect(() => { fixture.host = host; }, [host]);
        return <output data-testid="host">{host?.kind}:{host?.execution?.selected}:{String(host?.licensed)}</output>;
      }
      fixture.mount = (config, standalone = false, scenario = {}) => {
        window.kodetyWordPress = config;
        fixture.runtimeReady = scenario.ready === true;
        fixture.accountConnected = false;
        root = createRoot(document.getElementById('root'));
        root.render(<StrictMode><WordPressAgentProvider><Probe />{standalone && <HtmlAgentSettings />}</WordPressAgentProvider></StrictMode>);
      };
      fixture.notifyLicense = () => window.dispatchEvent(new Event(WORDPRESS_LICENSE_CHANGED));
      fixture.unmount = () => { root.unmount(); fixture.host = null; };
      fixture.settle = async () => {
        // Let deferred disposal run; a StrictMode remount must cancel it first.
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
      };
      fixture.snapshot = () => ({
        documentToken: fixture.documentToken,
        panelOpenEvents: fixture.panelOpenEvents,
        host: fixture.host ? {
          kind: fixture.host.kind,
          licensed: fixture.host.licensed,
          selected: fixture.host.execution?.selected,
          changing: fixture.host.execution?.changing,
          key: fixture.host.agent?.key,
          bindingId: fixture.host.agent?.fixtureId,
        } : null,
        bindings: fixture.bindings.map(record => ({
          id: record.id,
          projectId: record.options.projectId,
          runtimeUrl: record.options.runtimeUrl,
          licensed: record.options.isLicensed(),
          readOnly: record.options.isReadOnly(),
          refreshCalls: record.refreshCalls,
          refreshPolicies: record.refreshPolicies,
          disposeCalls: record.disposeCalls,
          clients: record.clients,
        })),
      });
    `,
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.woff2': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{
    name: 'browser-agent-binding-fixture',
    setup(build) {
      // The Provider, context, license hook and navigation modules remain real.
      build.onLoad({ filter: /[/\\]browser-agent-webcontainer\.ts$/ }, () => ({
        loader: 'js',
        contents: `
          export function createBrowserAgentBinding(options) {
            const records = window.agentProviderFixture.bindings;
            const record = { id: records.length + 1, options, refreshCalls: 0, refreshPolicies: [], disposeCalls: 0, clients: [] };
            records.push(record);
            return {
              key: 'webcontainer:' + options.projectId,
              fixtureId: record.id,
              createBackend(callbacks = {}) {
                const client = { id: record.clients.length + 1, calls: [], cancelCalls: 0 };
                record.clients.push(client);
                return {
                  remote: false,
                  async request(suffix, request = {}) {
                    request.signal?.throwIfAborted();
                    client.calls.push({ suffix, body: request.body });
                    const fixture = window.agentProviderFixture;
                    if (fixture.runtimeReady && suffix === 'rpc') {
                      const method = request.body?.method;
                      if (method === 'account/read') return { account: fixture.accountConnected ? { type: 'chatgpt', email: 'agent-provider@example.test', planType: 'pro' } : null };
                      if (method === 'account/login/start') return { type: 'chatgptDeviceCode', loginId: 'fixture-login', userCode: 'ABCD-1234', verificationUrl: 'https://auth.openai.com/codex/device' };
                      if (method === 'account/login/cancel') return { status: 'canceled' };
                      throw new Error('Unexpected provider fixture RPC: ' + method);
                    }
                    if (suffix !== 'config' && !(fixture.runtimeReady && suffix === 'config/retry')) throw new Error('The unavailable modal must not authenticate or call: ' + suffix);
                    const config = {
                      enabled: true, available: fixture.runtimeReady, transport: 'webcontainer',
                      capabilities: { attachments: false, skills: false, figma: false },
                      transportOptions: { selected: 'webcontainer', canChange: false },
                      ...fixture.runtimeReady ? {} : {
                        unavailableReason: 'browser_agent_fixture_unavailable',
                        runtimeDiagnostics: { code: 'browser_agent_fixture_unavailable', message: 'Runtime indisponível na fixture.', action: 'Confira a configuração do Agent.', retryable: false },
                      },
                    };
                    callbacks.onConfig?.(config);
                    return config;
                  },
                  async uploadAttachment() { throw new Error('No attachment request belongs to this fixture.'); },
                  cancelAll() { client.cancelCalls++; },
                };
              },
              async refreshAccess() {
                record.refreshCalls++;
                record.refreshPolicies.push({ licensed: options.isLicensed(), readOnly: options.isReadOnly() });
              },
              dispose() { record.disposeCalls++; },
            };
          }
        `,
      }));
    },
  }],
});

function config(selected = 'webcontainer', overrides = {}, origin = 'https://wordpress.test') {
  return {
    appView: 'editor',
    projectId: 'project-7',
    agentUrl: `${origin}/wp-json/kodety/v1/agents`,
    agentNonce: 'fixture-nonce',
    nonce: 'fixture-nonce',
    settingsUrl: `${origin}/kodety/settings/?project=project-7`,
    editorUrl: `${origin}/kodety/editor/?project=project-7`,
    agentBrowser: { selected, userId: 42, runtimeUrl: `${origin}/private/browser-agent.mjs` },
    product: { edition: 'pro', licensed: true, features: { ai: true }, limits: {}, licenseUrl: '', upgradeUrl: '' },
    ...overrides,
  };
}

await test('WordPress Agent Provider browser integration', async t => {
  const browser = await chromium.launch({ headless: true });
  const unexpectedRequests = [];
  const navigationRequests = [];
  const pageErrors = [];
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (route.request().isNavigationRequest() && /^https:\/\/(wordpress|other-wordpress)\.test\/kodety\/(editor|settings)\/(?:\?.*)?$/.test(route.request().url())) {
        navigationRequests.push(route.request().url());
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' });
      }
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    async function pageFor(bootstrap, origin = 'https://wordpress.test', search = '', standalone = false, scenario = {}) {
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(`${origin}/kodety/${bootstrap.appView === 'settings' ? 'settings' : 'editor'}/${search}`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(({ bootstrap, standalone, scenario }) => window.agentProviderFixture.mount(bootstrap, standalone, scenario), { bootstrap, standalone, scenario });
      await page.waitForFunction(() => window.agentProviderFixture.host !== null);
      return page;
    }
    const snapshot = page => page.evaluate(() => window.agentProviderFixture.snapshot());
    const settle = page => page.evaluate(() => window.agentProviderFixture.settle());

    await t.test('server selection exposes a WordPress host without allocating a browser binding', async () => {
      const page = await pageFor(config('server'));
      try {
        await settle(page);
        const state = await snapshot(page);
        assert.deepEqual(state.host, { kind: 'wordpress', licensed: true, selected: 'server', changing: false, key: undefined, bindingId: undefined });
        assert.deepEqual(state.bindings, []);
      } finally { await page.close(); }
    });

    await t.test('browser scope includes the current origin, user and project and receives the private runtime URL', async () => {
      const page = await pageFor(config('webcontainer', {}, 'https://other-wordpress.test'), 'https://other-wordpress.test');
      try {
        const state = await snapshot(page);
        const active = state.bindings.find(binding => binding.id === state.host.bindingId);
        assert.equal(state.host.kind, 'wordpress');
        assert.equal(state.host.selected, 'browser');
        assert.equal(state.host.licensed, true);
        assert.equal(active.projectId, 'wordpress:https://other-wordpress.test:42:project-7');
        assert.equal(state.host.key, 'webcontainer:wordpress:https://other-wordpress.test:42:project-7');
        assert.equal(active.runtimeUrl, 'https://other-wordpress.test/private/browser-agent.mjs');
        assert.equal(active.licensed, true);
        assert.equal(active.readOnly, false);
      } finally { await page.close(); }
    });

    await t.test('policy callbacks read the current bootstrap and license events refresh access and host licensing', async () => {
      const page = await pageFor(config());
      try {
        await settle(page);
        const initial = await snapshot(page);
        const id = initial.host.bindingId;
        const before = initial.bindings.find(binding => binding.id === id).refreshCalls;
        await page.evaluate(() => {
          window.kodetyWordPress = { ...window.kodetyWordPress, readOnly: true, product: { ...window.kodetyWordPress.product, features: { ai: false } } };
        });
        const changed = await snapshot(page);
        assert.equal(changed.host.licensed, true, 'the context has not received its license event yet');
        assert.equal(changed.bindings.find(binding => binding.id === id).licensed, false, 'callbacks must not retain the original bootstrap object');
        assert.equal(changed.bindings.find(binding => binding.id === id).readOnly, true);
        await page.evaluate(() => window.agentProviderFixture.notifyLicense());
        await page.waitForFunction(({ id, before }) => {
          const fixture = window.agentProviderFixture;
          return fixture.host.licensed === false && fixture.bindings.find(binding => binding.id === id).refreshCalls > before;
        }, { id, before });
        const revoked = await snapshot(page);
        assert.equal(revoked.host.bindingId, id, 'policy changes update the current binding');
        assert.deepEqual(revoked.bindings.find(binding => binding.id === id).refreshPolicies.at(-1), { licensed: false, readOnly: true });
        const refreshAfterRevocation = revoked.bindings.find(binding => binding.id === id).refreshCalls;
        await page.evaluate(() => {
          window.kodetyWordPress = { ...window.kodetyWordPress, readOnly: false, product: { ...window.kodetyWordPress.product, features: { ai: true } } };
          window.agentProviderFixture.notifyLicense();
        });
        await page.waitForFunction(({ id, before }) => {
          const fixture = window.agentProviderFixture;
          return fixture.host.licensed === true && fixture.bindings.find(binding => binding.id === id).refreshCalls > before;
        }, { id, before: refreshAfterRevocation });
        const restored = await snapshot(page);
        assert.equal(restored.host.bindingId, id);
        assert.deepEqual(restored.bindings.find(binding => binding.id === id).refreshPolicies.at(-1), { licensed: true, readOnly: false });
      } finally { await page.close(); }
    });

    await t.test('manual license verification updates the same WordPress product and browser policy', async () => {
      const source = 'https://wordpress.test/wp-json/kodety/v1/license/runtime';
      const product = { ...config().product, licensed: false, features: { ai: false }, licenseStatusUrl: source };
      const page = await pageFor(config('webcontainer', { product }));
      try {
        const before = await snapshot(page);
        let requests = 0;
        await page.route(source, route => {
          requests++;
          assert.equal(route.request().headers()['x-wp-nonce'], 'fixture-nonce');
          return route.fulfill({ json: { ...product, licensed: true, features: { ai: true } } });
        });
        assert.equal(await page.evaluate(() => window.agentProviderFixture.host.checkLicense()), true);
        await expect(page.getByTestId('host')).toHaveText('wordpress:browser:true');
        const after = await snapshot(page);
        assert.equal(after.host.bindingId, before.host.bindingId);
        assert.equal(after.bindings.find(binding => binding.id === after.host.bindingId).licensed, true);
        assert.equal(await page.evaluate(() => window.kodetyWordPress.product.licensed), true);
        assert.equal(requests, 1);
        await page.route(source, route => route.fulfill({ status: 503, json: {} }));
        assert.match(await page.evaluate(async () => {
          try { await window.agentProviderFixture.host.checkLicense(); return ''; }
          catch (error) { return error.message; }
        }), /Não foi possível verificar a licença/);
        assert.equal((await snapshot(page)).host.licensed, true, 'network failure does not replace trusted product access');
      } finally { await page.close(); }
    });

    await t.test('changing runtime, user or project replaces the binding and disposes the previous active instance once', async () => {
      const page = await pageFor(config());
      try {
        for (const change of [
          { runtimeUrl: 'https://wordpress.test/private/browser-agent-v2.mjs' },
          { userId: 99 },
          { projectId: 'project-8' },
        ]) {
          const oldId = (await snapshot(page)).host.bindingId;
          await page.evaluate(change => {
            const previous = window.kodetyWordPress;
            const { projectId, ...agentBrowser } = change;
            window.kodetyWordPress = {
              ...previous,
              projectId: projectId || previous.projectId,
              agentBrowser: { ...previous.agentBrowser, ...agentBrowser },
            };
            window.agentProviderFixture.notifyLicense();
          }, change);
          await page.waitForFunction(id => window.agentProviderFixture.host.agent.fixtureId !== id, oldId);
          await settle(page);
          const state = await snapshot(page);
          const active = state.bindings.find(binding => binding.id === state.host.bindingId);
          assert.equal(state.bindings.find(binding => binding.id === oldId).disposeCalls, 1);
          assert.equal(active.disposeCalls, 0);
          if (change.runtimeUrl) assert.equal(active.runtimeUrl, change.runtimeUrl);
          if (change.userId) assert.equal(active.projectId, 'wordpress:https://wordpress.test:99:project-7');
          if (change.projectId) assert.equal(active.projectId, 'wordpress:https://wordpress.test:99:project-8');
        }
      } finally { await page.close(); }
    });

    await t.test('the settings query opens the real modal in the Builder and closing it preserves the active binding', async () => {
      const page = await pageFor(config(), 'https://wordpress.test', '?project=project-7&kodety_agent_runtime=webcontainer&kodety_agent_settings=1&kodety_panel=agent');
      try {
        const navigationCount = navigationRequests.length;
        const dialog = page.getByRole('dialog', { name: 'Agent no navegador', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Precisa de atenção', { exact: true })).toBeVisible();
        const opened = await snapshot(page);
        const id = opened.host.bindingId;
        const active = opened.bindings.find(binding => binding.id === id);
        assert.ok(active.clients.some(client => client.calls.some(call => call.suffix === 'config')), 'the real shared Settings must read the injected backend config');
        assert.ok(active.clients.flatMap(client => client.calls).every(call => call.suffix === 'config'), 'an unavailable backend must not start OAuth');
        const url = new URL(page.url());
        assert.equal(url.searchParams.get('kodety_agent_settings'), null, 'the one-time modal request must be consumed');
        assert.equal(url.searchParams.get('project'), 'project-7');
        assert.equal(url.searchParams.get('kodety_agent_runtime'), 'webcontainer');
        assert.equal(url.searchParams.get('kodety_panel'), 'agent');
        const cancellations = active.clients.reduce((sum, client) => sum + client.cancelCalls, 0);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(page);
        const closed = await snapshot(page);
        const preserved = closed.bindings.find(binding => binding.id === id);
        assert.equal(closed.documentToken, opened.documentToken);
        assert.equal(closed.host.bindingId, id);
        assert.equal(closed.host.kind, 'wordpress');
        assert.equal(preserved.disposeCalls, 0);
        assert.ok(preserved.clients.reduce((sum, client) => sum + client.cancelCalls, 0) > cancellations, 'closing Settings must cancel its client waits');
        assert.equal(navigationRequests.length, navigationCount, 'modal open and close must keep the Editor document');
      } finally { await page.close(); }
    });

    await t.test('requesting Agent settings through the host opens the real dialog without page navigation or binding replacement', async () => {
      const page = await pageFor(config());
      try {
        const before = await snapshot(page);
        const navigationCount = navigationRequests.length;
        const initialUrl = page.url();
        const dialog = page.getByRole('dialog', { name: 'Agent no navegador', exact: true });
        await expect(dialog).toHaveCount(0);
        await page.evaluate(() => window.agentProviderFixture.host.onOpenSettings('agents'));
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Precisa de atenção', { exact: true })).toBeVisible();
        const opened = await snapshot(page);
        assert.equal(opened.documentToken, before.documentToken);
        assert.equal(opened.host.bindingId, before.host.bindingId);
        assert.equal(page.url(), initialUrl);
        assert.equal(navigationRequests.length, navigationCount);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await settle(page);
        const closed = await snapshot(page);
        assert.equal(closed.host.bindingId, before.host.bindingId);
        assert.equal(closed.bindings.find(binding => binding.id === before.host.bindingId).disposeCalls, 0);
      } finally { await page.close(); }
    });

    await t.test('standalone browser Settings offers the Builder action without creating an authentication client', async () => {
      const page = await pageFor(config('webcontainer', { appView: 'settings' }), 'https://wordpress.test', '?section=agents', true);
      try {
        await expect(page.getByRole('button', { name: 'Abrir Agent no Builder', exact: true })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await settle(page);
        const state = await snapshot(page);
        assert.equal(state.host.selected, 'browser');
        assert.ok(state.bindings.length > 0);
        assert.ok(state.bindings.every(binding => binding.clients.length === 0), 'standalone Settings must not mount the shared authentication backend');
      } finally { await page.close(); }
    });

    await t.test('a confirmed device login closes Settings and opens the Agent panel within the same Editor session', async () => {
      const page = await pageFor(config(), 'https://wordpress.test', '?project=project-7&kodety_agent_settings=1&kodety_panel=agent', false, { ready: true });
      try {
        const dialog = page.getByRole('dialog', { name: 'Agent no navegador', exact: true });
        const connect = dialog.getByRole('button', { name: 'Conectar conta', exact: true });
        await expect(connect).toBeEnabled();
        const before = await snapshot(page);
        const navigationCount = navigationRequests.length;
        const documentUrl = page.url();
        await connect.click();
        await expect(dialog.getByRole('textbox', { name: 'Copie seu código de acesso' })).toHaveValue('ABCD-1234');
        const pending = await snapshot(page);
        const calls = pending.bindings.find(binding => binding.id === before.host.bindingId).clients.flatMap(client => client.calls);
        assert.ok(calls.some(call => call.body?.method === 'account/login/start'));
        assert.equal(pending.panelOpenEvents, 0, 'starting authorization must not pretend it has connected');
        assert.equal(page.url(), documentUrl);
        await page.evaluate(() => {
          window.agentProviderFixture.accountConnected = true;
          window.dispatchEvent(new Event('focus'));
        });
        await expect(dialog).toHaveCount(0);
        await page.waitForFunction(() => window.agentProviderFixture.panelOpenEvents === 1);
        await settle(page);
        const connected = await snapshot(page);
        const binding = connected.bindings.find(candidate => candidate.id === before.host.bindingId);
        assert.equal(connected.documentToken, before.documentToken);
        assert.equal(connected.host.bindingId, before.host.bindingId);
        assert.equal(connected.host.selected, 'browser');
        assert.equal(binding.disposeCalls, 0, 'returning to chat must retain the runtime that owns the in-memory login');
        assert.equal(connected.panelOpenEvents, 1);
        assert.equal(page.url(), documentUrl);
        assert.equal(navigationRequests.length, navigationCount);
        assert.ok(binding.clients.flatMap(client => client.calls).every(call => !/^skills\/|^figma\//.test(call.body?.method || '')));
      } finally { await page.close(); }
    });

    await t.test('StrictMode cleanup retains the active binding and a real unmount disposes it exactly once', async () => {
      const page = await pageFor(config());
      try {
        await page.waitForFunction(() => {
          const fixture = window.agentProviderFixture;
          return fixture.bindings.find(binding => binding.id === fixture.host.agent.fixtureId).refreshCalls >= 2;
        });
        await settle(page);
        const mounted = await snapshot(page);
        const id = mounted.host.bindingId;
        assert.equal(mounted.bindings.find(binding => binding.id === id).disposeCalls, 0, 'the development effect replay must not terminate an active Agent');
        await page.evaluate(() => window.agentProviderFixture.unmount());
        await settle(page);
        const unmounted = await snapshot(page);
        assert.equal(unmounted.host, null);
        assert.equal(unmounted.bindings.find(binding => binding.id === id).disposeCalls, 1);
        await settle(page);
        assert.equal((await snapshot(page)).bindings.find(binding => binding.id === id).disposeCalls, 1);
      } finally { await page.close(); }
    });

    assert.deepEqual(unexpectedRequests, [], 'the Provider probe must not call any Agent, OAuth or WordPress endpoint');
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
