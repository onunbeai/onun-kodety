import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit, expect } from '@playwright/test';

const engine = process.env.BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine), 'BROWSER must be chromium or webkit');

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [workspaceCss, toastCss, interFont] = await Promise.all([
  readFile(`${root}/ChromeExtension/kodety-studio/src/styles.css`, 'utf8'),
  readFile(`${root}/lib/html-editor/toast.css`, 'utf8'),
  readFile(`${root}/Wordpress/kodety/admin/fonts/inter-latin-variable.woff2`),
]);
const styledWorkspaceCss = `${workspaceCss.replace(/^@import[^\n]*\n/gm, '').replaceAll('../../../Wordpress/kodety/admin/fonts/inter-latin-variable.woff2', `data:font/woff2;base64,${interFont.toString('base64')}`)}\n${toastCss}`;
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { ProjectWorkspace } from './ChromeExtension/kodety-studio/src/main';
      import { StudioI18nProvider } from './ChromeExtension/kodety-studio/src/i18n';
      import { newProject } from './ChromeExtension/kodety-studio/src/storage';
      import { toast } from 'sonner';

      const fixture = window.manualBackupFixture = {
        boots: [], snapshots: [], downloads: [], directoryCalls: [], persisted: [], draftSaves: [], flushes: 0, backCalls: 0,
        project: { ...newProject('Backup manual fixture', 'pt_BR'), id: 'manual-backup-fixture', initialized: true },
        client: { async onNavigation(listener) { fixture.onNavigation = listener; }, async captureSiteThumbnail() { return { mime: 'image/png', data: 'AA==' }; } },
      };
      const root = createRoot(document.getElementById('root'));
      fixture.mount = (options = {}) => {
        fixture.directoryConnected = options.directoryConnected === true;
        fixture.controlledSnapshots = options.controlledSnapshots === true;
        root.render(<StudioI18nProvider language="pt"><ProjectWorkspace project={fixture.project} language="pt"
          {...options} onBack={() => { fixture.backCalls++; root.render(<div data-testid="project-library">Projetos</div>); }}
          onProjectReady={async project => { fixture.persisted.push(project); }} /></StudioI18nProvider>);
      };
      fixture.unmount = () => root.render(<div data-testid="project-library">Projetos</div>);
      fixture.toastSnapshot = () => ({
        active: toast.getToasts().map(({ id, type, title, description, toasterId }) => ({ id, type, title, description, toasterId })),
        history: toast.getHistory().map(({ id, type, title, description, toasterId }) => ({ id, type, title, description, toasterId })),
      });
      fixture.completeDownload = (createdAt = 1726272000000) => {
        const download = fixture.downloads.at(-1);
        if (!download || download.settled) throw new Error('No pending fixture download.');
        download.settled = true;
        download.resolve({ createdAt, filename: 'manual-backup-fixture.zip', size: 128 });
      };
      fixture.failDownload = () => {
        const download = fixture.downloads.at(-1);
        if (!download || download.settled) throw new Error('No pending fixture download.');
        download.settled = true;
        download.reject(new Error('Falha de exportação na fixture. Tente novamente.'));
      };
      fixture.completeSnapshot = () => {
        const snapshot = fixture.snapshots.at(-1);
        if (!snapshot || snapshot.settled) throw new Error('No pending folder snapshot.');
        snapshot.settled = true;
        fixture.directoryLastBackupAt = 1726272000000;
        snapshot.resolve({ createdAt: fixture.directoryLastBackupAt, directoryName: 'Existing folder/manual-backup-fixture', snapshotName: 'snapshot-' + fixture.snapshots.length + '.zip', size: 128 });
      };
      fixture.failSnapshot = () => {
        const snapshot = fixture.snapshots.at(-1);
        if (!snapshot || snapshot.settled) throw new Error('No pending folder snapshot.');
        snapshot.settled = true;
        snapshot.reject(new Error('Falha de gravação na pasta da fixture.'));
      };
      fixture.nestedRuntimeWindow = () => {
        const runtimeFrame = document.querySelector('iframe');
        if (!fixture.nestedFrame) {
          const child = runtimeFrame.contentDocument.createElement('iframe');
          runtimeFrame.contentDocument.body.append(child);
          fixture.nestedFrame = child;
        }
        return fixture.nestedFrame.contentWindow;
      };
      fixture.notifySave = (type, detail = {}, sender = {}) => window.dispatchEvent(new MessageEvent('message', {
        origin: sender.origin || 'https://playground.wordpress.net',
        source: sender.unrelatedWindow ? window : sender.nestedWindow ? fixture.nestedRuntimeWindow() : document.querySelector('iframe').contentWindow,
        data: { source: 'kodety-studio-wordpress', version: 1, projectId: fixture.project.id, type, ...detail },
      }));
      fixture.probeUnload = () => {
        const event = new Event('beforeunload', { cancelable: true });
        const before = fixture.downloads.length;
        window.dispatchEvent(event);
        return { defaultPrevented: event.defaultPrevented, exportDelta: fixture.downloads.length - before };
      };
      fixture.persist = () => fixture.bootOptions.onPersisted({ ...fixture.project, updatedAt: Date.now() });
      fixture.flushOpfs = () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
      };
      fixture.enableDraftBridge = () => {
        // Only the Playground fixture is replaced: the workspace's real save
        // barrier still sends a request and waits for its MessagePort reply.
        document.querySelector('iframe').contentWindow.postMessage = (message, origin, ports) => {
          if (message.type !== 'project-save.request') throw new Error('Unexpected fixture bridge request: ' + message.type);
          fixture.draftSaves.push({ message, origin, port: ports[0], settled: false });
        };
        fixture.notifySave('bridge-ready');
      };
      fixture.completeDraftSave = () => {
        const save = fixture.draftSaves.at(-1);
        if (!save || save.settled) throw new Error('No pending draft save.');
        save.settled = true;
        fixture.notifySave('project-saved');
        save.port.postMessage({ type: 'done', requestId: save.message.requestId });
        save.port.close();
      };
      fixture.snapshot = () => ({
        boots: fixture.boots, snapshots: fixture.snapshots.map(({ projectId, options, settled }) => ({ projectId, options, settled })), directoryCalls: fixture.directoryCalls,
        downloads: fixture.downloads.map(({ client, project, settled }) => ({ sameClient: client === fixture.client, projectId: project.id, settled })),
        persisted: fixture.persisted.length, flushes: fixture.flushes, backCalls: fixture.backCalls,
        draftSaves: fixture.draftSaves.map(({ message, origin, settled }) => ({ type: message.type, origin, settled })),
        directoryPicker: typeof window.showDirectoryPicker,
      });
    `,
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{
    name: 'wordpress-runtime-and-backup-fixtures',
    setup(build) {
      build.onLoad({ filter: /[/\\]playground-runtime\.ts$/ }, () => ({ loader: 'js', contents: `
        export const PLAYGROUND_REMOTE_ORIGIN = 'https://playground.wordpress.net';
        export const projectLockName = id => 'manual-backup-test:' + id;
        export async function bootProject(options) {
          const fixture = window.manualBackupFixture;
          fixture.bootOptions = options;
          fixture.boots.push({ projectId: options.project.id, prepareOffline: options.prepareOffline });
          options.signal?.throwIfAborted();
          options.onStage('storage', 'Fixture pronta');
          return { client: fixture.client, initializedNow: false, runtimeVersions: {}, runtimeRevision: 14 };
        }
        export async function flushProject() { window.manualBackupFixture.flushes++; }
        export async function navigateProject(_client, path) { window.manualBackupFixture.onNavigation?.('https://playground.wordpress.net' + path); }
        export async function destroyProjectData() { throw new Error('This test never deletes a project.'); }
      ` }));
      build.onLoad({ filter: /[/\\]backup-storage\.ts$/ }, () => ({ loader: 'js', contents: `
        export async function getSecurityDirectoryStatus(projectId, options) {
          const fixture = window.manualBackupFixture;
          fixture.directoryCalls.push({ method: 'status', projectId, options });
          return { supported: fixture.controlledSnapshots, connected: fixture.directoryConnected, needsPermission: false, directoryName: fixture.directoryConnected ? 'Existing folder' : null, lastBackupAt: fixture.directoryLastBackupAt || null };
        }
        export async function connectSecurityDirectory() {
          window.manualBackupFixture.directoryCalls.push({ method: 'connect' });
          throw new Error('A folder picker is not available in this fixture.');
        }
        export async function requestSecurityDirectoryAccess() {
          window.manualBackupFixture.directoryCalls.push({ method: 'permission' });
          throw new Error('A folder picker is not available in this fixture.');
        }
        export async function saveProjectSnapshot(_client, project, options) {
          const fixture = window.manualBackupFixture;
          const snapshot = { projectId: project.id, options, settled: false };
          fixture.snapshots.push(snapshot);
          if (!fixture.controlledSnapshots) throw new Error('Manual backups must not write an automatic folder snapshot.');
          return new Promise((resolve, reject) => { snapshot.resolve = resolve; snapshot.reject = reject; });
        }
        export async function downloadProjectSnapshot(client, project) {
          const download = { client, project, settled: false };
          window.manualBackupFixture.downloads.push(download);
          return new Promise((resolve, reject) => { download.resolve = resolve; download.reject = reject; });
        }
      ` }));
    },
  }],
});

await test(`WordPress workspace manual ZIP backups (${engine})`, async t => {
  const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
  const pageErrors = [];
  const unexpectedRequests = [];
  try {
    const context = await browser.newContext({ timezoneId: 'UTC' });
    await context.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://studio.test' && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' });
      if (url.origin === 'https://studio.test' && url.pathname === '/assets/kodety-mark.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
      // Keep the unrelated MCP relay real, with a local unavailable response.
      if (url.origin === 'https://studio.test' && url.pathname.startsWith('/__kodety_mcp__/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      unexpectedRequests.push(url.href);
      return route.abort();
    });
    async function pageFor(options) {
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto('https://studio.test/');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(options => window.manualBackupFixture.mount(options), options);
      return page;
    }
    const snapshot = page => page.evaluate(() => window.manualBackupFixture.snapshot());
    const toasts = page => page.locator('[data-sonner-toast][data-removed="false"]');
    const errorToast = (page, message) => toasts(page).filter({ hasText: message });
    const toastSnapshot = page => page.evaluate(() => window.manualBackupFixture.toastSnapshot());
    const expectUnloadWarning = async (page, expected) => {
      await expect.poll(() => page.evaluate(() => window.manualBackupFixture.probeUnload())).toEqual({ defaultPrevented: expected, exportDelta: 0 });
    };
    const startZip = async page => {
      const before = (await snapshot(page)).downloads.length;
      await page.locator('.workspace-actions').getByRole('button', { name: 'Baixar backup ZIP', exact: true }).click();
      await page.waitForFunction(count => window.manualBackupFixture.downloads.length === count, before + 1);
    };
    const completeZip = async page => {
      await page.evaluate(() => window.manualBackupFixture.completeDownload());
      await expect(page.locator('.workspace-actions').getByRole('button', { name: 'Baixar backup ZIP', exact: true })).toBeEnabled();
    };
    const pendingAdminDraftMessage = 'Salve as alterações no WordPress antes de baixar o backup. Se a tela salva sem recarregar, recarregue a página depois de salvar.';

    await t.test('manual mode overrides a required directory and boots without a folder picker or automatic snapshots', async () => {
      const page = await pageFor({ manualBackup: true, requireSecurityDirectory: true, directoryConnected: true });
      try {
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Baixar backup ZIP', exact: true })).toBeEnabled();
        await expect(page.getByText('Este projeto precisa de uma pasta de segurança', { exact: true })).toHaveCount(0);
        assert.doesNotMatch(await page.locator('body').innerText(), /Use Chrome ou Edge|File System Access API/);
        await page.evaluate(() => {
          window.manualBackupFixture.notifySave('project-saved');
          window.manualBackupFixture.notifySave('project-published');
        });
        // The real backup scheduler would write after its two-second delay.
        await page.waitForTimeout(2_100);
        const state = await snapshot(page);
        assert.equal(state.directoryPicker, 'undefined');
        assert.equal(state.boots.length, 1);
        assert.equal(state.boots[0].prepareOffline, true, 'manual ZIP backups retain offline runtime preparation');
        assert.equal(state.persisted > 0, true);
        assert.deepEqual(state.snapshots, []);
        assert.deepEqual(state.downloads, []);
        assert.deepEqual(state.directoryCalls, [], 'manual mode must not inspect or request a backup folder');
      } finally { await page.close(); }
    });

    await t.test('the toolbar export publishes the ZIP timestamp only after success and a failed export can be retried', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        const toolbar = page.locator('.workspace-actions');
        const download = toolbar.getByRole('button', { name: 'Baixar backup ZIP', exact: true });
        await expect(download).toBeEnabled();
        await expect(download).toHaveAttribute('title', 'Último ZIP gerado: ainda não criado');
        await expect(toasts(page)).toHaveCount(0);
        await download.click();
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 1);
        await expect(toolbar.getByRole('button', { name: 'Preparando backup…', exact: true })).toBeDisabled();
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page)).toHaveAttribute('data-type', 'loading');
        await expect(toasts(page).getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
        await expect(toasts(page).locator('[data-title]')).toHaveText('Preparando backup…');
        const loadingToast = (await toastSnapshot(page)).active.find(toast => toast.id === 'wordpress:manual-backup-fixture:zip');
        assert.equal(loadingToast.toasterId, 'kodety-wordpress-workspace');
        await expect(toolbar.getByRole('button', { name: 'Preparando backup…', exact: true })).toHaveAttribute('title', 'Último ZIP gerado: ainda não criado');
        assert.deepEqual((await snapshot(page)).downloads, [{ sameClient: true, projectId: 'manual-backup-fixture', settled: false }]);
        await page.evaluate(() => window.manualBackupFixture.failDownload());
        await expect(errorToast(page, 'Falha de exportação na fixture.')).toBeVisible();
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page)).toHaveAttribute('data-type', 'error');
        await expect(download).toBeEnabled();
        await expect(download).toHaveAttribute('title', 'Último ZIP gerado: ainda não criado');
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await errorToast(page, 'Falha de exportação na fixture.').getByRole('button', { name: 'Tentar novamente', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 2);
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page)).toHaveAttribute('data-type', 'loading');
        await expect(toasts(page).getByRole('button', { name: 'Tentar novamente', exact: true })).toHaveCount(0);
        await expect(toasts(page).locator('[data-description]')).toHaveCount(0);
        await page.evaluate(() => window.manualBackupFixture.completeDownload(1726272000000));
        const expectedDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(1726272000000);
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page)).toHaveAttribute('data-type', 'success');
        await expect(toasts(page).locator('[data-title]')).toHaveText('Backup ZIP gerado');
        await expect(toasts(page).locator('[data-description]')).toHaveText('Confira o arquivo na pasta de downloads.');
        await expect(download).toHaveAttribute('title', `Último ZIP gerado: ${expectedDate}`);
        await expect(download).toBeEnabled();
        await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
        const finished = await toastSnapshot(page);
        assert.equal(finished.active.length, 1);
        assert.equal(finished.active[0].id, loadingToast.id, 'loading, error, retry and success update the same toast');
        assert.equal(finished.history.filter(toast => toast.id === loadingToast.id).length, 1);
        await expect(page.locator('[data-sonner-toaster]')).toHaveCount(1);
        await expect(page.locator('.workspace-backup-status, .workspace-backup-warning, .workspace-topbar [role="status"]')).toHaveCount(0);
        const state = await snapshot(page);
        assert.equal(state.downloads.length, 2);
        assert.ok(state.downloads.every(download => download.sameClient && download.projectId === 'manual-backup-fixture' && download.settled));
        assert.deepEqual(state.snapshots, []);
      } finally { await page.close(); }
    });

    await t.test('ZIP success uses the real workspace and shared toast styles without loading external assets', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.addStyleTag({ content: styledWorkspaceCss });
        await page.evaluate(() => document.fonts.ready);
        await startZip(page);
        await completeZip(page);
        const success = toasts(page).filter({ hasText: 'Backup ZIP gerado' });
        await expect(success).toBeVisible();
        await expect(success).toHaveAttribute('data-type', 'success');
        await success.hover();
        await expect(success.locator('[data-close-button]')).toBeVisible();
        await expect(page.locator('.workspace-backup-status, .workspace-backup-warning')).toHaveCount(0);
        await page.screenshot({ path: engine === 'chromium' ? '/private/tmp/kodety-wordpress-backup-toast.png' : `/private/tmp/kodety-wordpress-backup-toast-${engine}.png`, animations: 'disabled' });
      } finally { await page.close(); }
    });

    await t.test('backup options describe manual ZIPs and download through the same export without asking for a folder', async () => {
      const page = await pageFor({ manualBackup: true, requireSecurityDirectory: true });
      try {
        await expect(page.getByRole('button', { name: 'Opções de backup', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Opções de backup', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Backup manual em ZIP', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Baixe um ZIP completo deste WordPress e guarde o arquivo no computador. O backup é criado quando você solicita o download.', { exact: true })).toBeVisible();
        assert.doesNotMatch(await dialog.innerText(), /Chrome|Edge|File System Access|latest\.zip|snapshots|Escolha ou crie uma pasta/);
        await expect(dialog.getByRole('button', { name: /Selecionar pasta|Autorizar|Trocar pasta/ })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Baixar backup ZIP', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 1);
        await expect(dialog.getByRole('button', { name: 'Preparando backup…', exact: true })).toBeDisabled();
        await expect(dialog.getByRole('status').filter({ hasText: /Último ZIP gerado:/ })).toHaveCount(0);
        await page.evaluate(() => window.manualBackupFixture.completeDownload());
        await expect(dialog.getByRole('status').filter({ hasText: /Último ZIP gerado:/ })).toBeVisible();
        await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.workspace-actions').getByRole('button', { name: 'Baixar backup ZIP', exact: true })).toHaveAttribute('title', /Último ZIP gerado:.*2024/);
        await expect(page.getByRole('status').filter({ hasText: /Último ZIP gerado:/ })).toHaveCount(0);
        const state = await snapshot(page);
        assert.deepEqual(state.downloads, [{ sameClient: true, projectId: 'manual-backup-fixture', settled: true }]);
        assert.deepEqual(state.directoryCalls, []);
        assert.deepEqual(state.snapshots, []);
      } finally { await page.close(); }
    });

    await t.test('workspace toasts stay scoped, avoid duplicate status messages and are dismissed on unmount without layout banners', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await expect(toasts(page)).toHaveCount(0);
        await startZip(page);
        await completeZip(page);
        await expect(toasts(page).filter({ hasText: 'Backup ZIP gerado' })).toBeVisible();
        await page.evaluate(() => {
          for (let index = 0; index < 3; index++) {
            window.manualBackupFixture.mount({ manualBackup: true });
            window.manualBackupFixture.notifySave('storage-persistence', { status: 'granted' });
            window.manualBackupFixture.notifySave('project-changed');
          }
        });
        await expect(toasts(page)).toHaveCount(1);
        const zip = await toastSnapshot(page);
        assert.equal(zip.history.filter(toast => toast.id === 'wordpress:manual-backup-fixture:zip').length, 1);
        assert.ok(zip.active.every(toast => toast.toasterId === 'kodety-wordpress-workspace'));
        assert.equal((await snapshot(page)).boots.length, 1, 'a host rerender must keep the current runtime');

        await page.evaluate(() => window.manualBackupFixture.notifySave('offline-cache', { status: 'error', message: 'Preparação offline da fixture falhou.' }));
        const warning = toasts(page).filter({ hasText: 'WordPress offline precisa de atenção' });
        await expect(warning).toBeVisible();
        await expect(warning).toHaveAttribute('data-type', 'warning');
        await page.evaluate(() => {
          for (let index = 0; index < 3; index++) {
            window.manualBackupFixture.mount({ manualBackup: true });
            window.manualBackupFixture.notifySave('offline-cache', { status: 'error', message: 'Preparação offline da fixture falhou.' });
          }
        });
        await expect(warning).toHaveCount(1);
        const offline = await toastSnapshot(page);
        assert.equal(offline.active.filter(toast => toast.id === 'wordpress:manual-backup-fixture:offline').length, 1);
        assert.equal(offline.history.filter(toast => toast.id === 'wordpress:manual-backup-fixture:offline').length, 1);
        await expect(page.locator('[data-sonner-toaster]')).toHaveCount(1);
        await expect(page.locator('.workspace-backup-status, .workspace-backup-warning, .workspace-topbar [role="status"]')).toHaveCount(0);
        await warning.getByRole('button', { name: 'Revisar', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Backup manual em ZIP', exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
        await expect(dialog).toHaveCount(0);
        await page.evaluate(() => window.manualBackupFixture.notifySave('offline-cache', { status: 'ready' }));
        await expect(page.locator('[data-sonner-toast][data-type="warning"][data-removed="false"]')).toHaveCount(0);
        await page.evaluate(() => window.manualBackupFixture.unmount());
        await expect(page.getByTestId('project-library')).toBeVisible();
        await expect.poll(async () => (await toastSnapshot(page)).active.filter(toast => toast.toasterId === 'kodety-wordpress-workspace')).toEqual([]);
        await expect(page.locator('[data-sonner-toast], [data-sonner-toaster], .workspace-backup-status, .workspace-backup-warning')).toHaveCount(0);
      } finally { await page.close(); }
    });

    await t.test('folder snapshots update one progress toast, expose a recoverable error and report success after retry', async () => {
      const page = await pageFor({ manualBackup: false, requireSecurityDirectory: false, directoryConnected: true, controlledSnapshots: true });
      try {
        await page.waitForFunction(() => window.manualBackupFixture.snapshots.length === 1);
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page)).toHaveAttribute('data-type', 'loading');
        await expect(toasts(page).locator('[data-title]')).toHaveText('Atualizando pasta…');
        await page.evaluate(() => window.manualBackupFixture.completeSnapshot());
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await expect(toasts(page)).toHaveAttribute('data-type', 'success');
        await expect(toasts(page).locator('[data-title]')).toHaveText('Pasta atualizada');
        await page.evaluate(() => window.manualBackupFixture.notifySave('project-saved'));
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page)).toHaveAttribute('data-type', 'loading');
        await expect(toasts(page).locator('[data-title]')).toHaveText('Backup pendente…');
        await page.waitForFunction(() => window.manualBackupFixture.snapshots.length === 2);
        await expect(toasts(page).locator('[data-title]')).toHaveText('Atualizando pasta…');
        await page.evaluate(() => window.manualBackupFixture.failSnapshot());
        const failure = errorToast(page, 'A cópia na pasta de segurança não está atualizada.');
        await expect(failure).toBeVisible();
        await expect(failure).toHaveAttribute('data-type', 'error');
        await expect(toasts(page)).toHaveCount(1);
        await failure.getByRole('button', { name: 'Revisar pasta', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Pasta de segurança', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('alert')).toHaveText('Falha de gravação na pasta da fixture.');
        await dialog.getByRole('button', { name: 'Salvar snapshot agora', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.snapshots.length === 3);
        await expect(toasts(page)).toHaveCount(1);
        await expect(toasts(page)).toHaveAttribute('data-type', 'loading');
        await expect(toasts(page).locator('[data-title]')).toHaveText('Atualizando pasta…');
        await expect(toasts(page).getByRole('button', { name: 'Revisar pasta', exact: true })).toHaveCount(0);
        await page.evaluate(() => window.manualBackupFixture.completeSnapshot());
        await expect(toasts(page)).toHaveAttribute('data-type', 'success');
        await expect(toasts(page).locator('[data-title]')).toHaveText('Pasta atualizada');
        await expect(dialog.getByText('Snapshot salvo com segurança', { exact: true })).toBeVisible();
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        const state = await toastSnapshot(page);
        assert.equal(state.active.length, 1);
        assert.equal(state.active[0].id, 'wordpress:manual-backup-fixture:folder');
        assert.equal(state.active[0].toasterId, 'kodety-wordpress-workspace');
        assert.equal(state.history.filter(toast => toast.id === 'wordpress:manual-backup-fixture:folder').length, 1);
        assert.equal((await snapshot(page)).snapshots.length, 3);
        assert.deepEqual((await snapshot(page)).downloads, []);
        await expect(page.locator('.workspace-backup-status, .workspace-backup-warning')).toHaveCount(0);
      } finally { await page.close(); }
    });

    await t.test('ready manual projects warn on unload and browser persistence never counts as an external ZIP', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await expectUnloadWarning(page, true);
        await page.evaluate(async () => {
          await window.manualBackupFixture.persist();
          window.manualBackupFixture.flushOpfs();
          window.manualBackupFixture.notifySave('storage-persistence', { status: 'granted' });
          window.manualBackupFixture.notifySave('project-saved');
        });
        await expect(page.locator('.workspace-project-title > span')).toHaveAttribute('title', /Proteção local ativa/);
        await expectUnloadWarning(page, true);
        const state = await snapshot(page);
        assert.ok(state.persisted >= 2);
        assert.ok(state.flushes >= 1, 'the real visibility handler must flush browser storage');
        assert.deepEqual(state.downloads, [], 'probing unload and saving to browser storage must never start an export');
        assert.deepEqual(state.snapshots, []);
      } finally { await page.close(); }
    });

    await t.test('ZIP coverage starts after the Builder save barrier and excludes edits made while exporting or a failed ZIP', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        const toolbar = page.locator('.workspace-actions');
        await expect(toolbar.getByRole('button', { name: 'Baixar backup ZIP', exact: true })).toBeEnabled();
        await page.evaluate(() => window.manualBackupFixture.enableDraftBridge());
        await toolbar.getByRole('button', { name: 'Baixar backup ZIP', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.draftSaves.length === 1);
        assert.deepEqual((await snapshot(page)).downloads, [], 'export must wait for the Builder draft');
        await expectUnloadWarning(page, true);
        await page.evaluate(() => {
          window.manualBackupFixture.notifySave('project-changed');
          window.manualBackupFixture.completeDraftSave();
        });
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 1);
        await completeZip(page);
        await expectUnloadWarning(page, false);

        await page.evaluate(() => window.manualBackupFixture.notifySave('project-changed'));
        await expectUnloadWarning(page, true);
        await toolbar.getByRole('button', { name: 'Baixar backup ZIP', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.draftSaves.length === 2);
        await page.evaluate(() => window.manualBackupFixture.completeDraftSave());
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 2);
        await page.evaluate(() => window.manualBackupFixture.notifySave('project-changed'));
        await completeZip(page);
        await expectUnloadWarning(page, true);
        const outdated = toasts(page).filter({ hasText: 'ZIP gerado. Há alterações mais recentes.' });
        await expect(outdated).toBeVisible();
        await expect(outdated).toHaveAttribute('data-type', 'warning');

        await outdated.getByRole('button', { name: 'Baixar novo ZIP', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.draftSaves.length === 3);
        await page.evaluate(() => window.manualBackupFixture.completeDraftSave());
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 3);
        await page.evaluate(() => window.manualBackupFixture.failDownload());
        await expect(errorToast(page, 'Falha de exportação na fixture.')).toBeVisible();
        await expectUnloadWarning(page, true);

        await toolbar.getByRole('button', { name: 'Baixar backup ZIP', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.draftSaves.length === 4);
        await page.evaluate(() => window.manualBackupFixture.completeDraftSave());
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 4);
        await completeZip(page);
        await expectUnloadWarning(page, false);
        const state = await snapshot(page);
        assert.equal(state.downloads.length, 4);
        assert.ok(state.draftSaves.every(save => save.type === 'project-save.request' && save.origin === 'https://playground.wordpress.net' && save.settled));
        assert.deepEqual(state.snapshots, []);
      } finally { await page.close(); }
    });

    await t.test('changes, publications and legacy save notifications reactivate the warning, while canonical save acknowledgements do not', async () => {
      for (const type of ['project-changed', 'project-saved', 'project-published']) {
        const page = await pageFor({ manualBackup: true });
        try {
          await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
          await startZip(page);
          await completeZip(page);
          await expectUnloadWarning(page, false);
          await page.evaluate(type => window.manualBackupFixture.notifySave(type), type);
          await expectUnloadWarning(page, true);
          assert.equal((await snapshot(page)).downloads.length, 1, 'a change or unload probe must not export');
          if (type === 'project-changed') {
            await startZip(page);
            await completeZip(page);
            await expectUnloadWarning(page, false);
            await page.evaluate(() => {
              window.manualBackupFixture.notifySave('project-saved');
              window.manualBackupFixture.flushOpfs();
            });
            await expectUnloadWarning(page, false);
            assert.equal((await snapshot(page)).downloads.length, 2, 'a canonical save acknowledgement cannot invalidate an up-to-date ZIP');
          }
        } finally { await page.close(); }
      }
    });

    await t.test('unsaved WordPress input blocks toolbar export until its own admin document reloads, without trusting foreign or child-frame readiness', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        const download = page.locator('.workspace-actions').getByRole('button', { name: 'Baixar backup ZIP', exact: true });
        await expect(download).toBeEnabled();
        await startZip(page);
        await completeZip(page);
        await expectUnloadWarning(page, false);
        await page.evaluate(() => {
          window.manualBackupFixture.onNavigation('https://playground.wordpress.net/wp-admin/options-general.php');
          window.manualBackupFixture.notifySave('project-changed', { pendingAdminDraft: true });
        });
        await expectUnloadWarning(page, true);
        const assertExportBlocked = async () => {
          await download.click();
          await expect(errorToast(page, pendingAdminDraftMessage)).toBeVisible();
          await expect(download).toBeEnabled();
          assert.equal((await snapshot(page)).downloads.length, 1, 'an admin draft must be rejected before creating another ZIP');
          await expectUnloadWarning(page, true);
        };
        await assertExportBlocked();
        await page.evaluate(async () => {
          await window.manualBackupFixture.persist();
          window.manualBackupFixture.flushOpfs();
          window.manualBackupFixture.notifySave('project-saved');
          window.manualBackupFixture.notifySave('project-changed', { pendingAdminDraft: false });
        });
        await assertExportBlocked();
        for (const invalid of [
          { sender: { origin: 'https://unrelated.test' } },
          { sender: { unrelatedWindow: true } },
          { detail: { projectId: 'another-project' } },
          { detail: { source: 'another-runtime' } },
          { detail: { version: 2 } },
          { sender: { nestedWindow: true } },
        ]) {
          await page.evaluate(({ detail, sender }) => window.manualBackupFixture.notifySave('admin-document-ready', detail, sender), invalid);
          await assertExportBlocked();
        }
        await page.evaluate(() => window.manualBackupFixture.notifySave('admin-document-ready'));
        await expectUnloadWarning(page, true);
        assert.equal((await snapshot(page)).downloads.length, 1, 'loading the saved document must not create or pretend to create a ZIP');
        await startZip(page);
        await expectUnloadWarning(page, true);
        await completeZip(page);
        await expectUnloadWarning(page, false);
        await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
        assert.equal((await snapshot(page)).downloads.length, 2);
      } finally { await page.close(); }
    });

    await t.test('each pending admin frame must confirm its own replacement document before a ZIP can export', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        const download = page.locator('.workspace-actions').getByRole('button', { name: 'Baixar backup ZIP', exact: true });
        await expect(download).toBeEnabled();
        assert.equal(await page.evaluate(() => {
          const fixture = window.manualBackupFixture;
          const child = fixture.nestedRuntimeWindow();
          const runtime = document.querySelector('iframe').contentWindow;
          fixture.notifySave('project-changed', { pendingAdminDraft: true });
          fixture.notifySave('project-changed', { pendingAdminDraft: true }, { nestedWindow: true });
          fixture.notifySave('admin-document-ready');
          return child !== runtime && child.parent === runtime;
        }), true, 'the fixture must use a real descendant WindowProxy accepted by the runtime boundary');
        await download.click();
        await expect(errorToast(page, pendingAdminDraftMessage)).toBeVisible();
        await expect(download).toBeEnabled();
        assert.deepEqual((await snapshot(page)).downloads, [], 'the main document cannot acknowledge the child frame\'s pending draft');
        await expectUnloadWarning(page, true);
        await page.evaluate(() => window.manualBackupFixture.notifySave('admin-document-ready', {}, { nestedWindow: true }));
        await expectUnloadWarning(page, true);
        await startZip(page);
        await completeZip(page);
        await expectUnloadWarning(page, false);
        assert.equal((await snapshot(page)).downloads.length, 1);
      } finally { await page.close(); }
    });

    await t.test('download and exit keeps an unsaved admin draft open until the new document is confirmed and a fresh ZIP succeeds', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await page.evaluate(() => {
          window.manualBackupFixture.onNavigation('https://playground.wordpress.net/wp-admin/options-general.php');
          window.manualBackupFixture.notifySave('project-changed', { pendingAdminDraft: true });
        });
        await page.getByRole('button', { name: 'Voltar aos projetos', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Sair do projeto', exact: true });
        await dialog.getByRole('button', { name: 'Baixar ZIP e sair', exact: true }).click();
        await expect(dialog.getByRole('alert')).toHaveText(pendingAdminDraftMessage);
        await expect(dialog.getByRole('button', { name: 'Continuar editando', exact: true })).toBeEnabled();
        const blocked = await snapshot(page);
        assert.equal(blocked.backCalls, 0);
        assert.deepEqual(blocked.downloads, []);
        await expectUnloadWarning(page, true);
        await page.evaluate(() => window.manualBackupFixture.notifySave('admin-document-ready'));
        await expectUnloadWarning(page, true);
        await dialog.getByRole('button', { name: 'Baixar ZIP e sair', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 1);
        assert.equal((await snapshot(page)).backCalls, 0);
        await expectUnloadWarning(page, true);
        await page.evaluate(() => window.manualBackupFixture.completeDownload());
        await expect(page.getByTestId('project-library')).toBeVisible();
        await expectUnloadWarning(page, false);
        assert.equal((await snapshot(page)).backCalls, 1);
      } finally { await page.close(); }
    });

    await t.test('manual exit allows continuing or deliberately leaving without an automatic download', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Voltar aos projetos', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Sair do projeto', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Baixar ZIP e sair', exact: true })).toBeEnabled();
        await expect(dialog.getByRole('button', { name: 'Sair sem baixar', exact: true })).toBeEnabled();
        assert.match(await dialog.innerText(), /ZIP[\s\S]*pasta de segurança|pasta de segurança[\s\S]*ZIP/);
        assert.doesNotMatch(await dialog.innerText(), /Conectar pasta|Autorizar|Chrome|Edge|File System Access|snapshots recorrentes/);
        await dialog.getByRole('button', { name: 'Continuar editando', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expectUnloadWarning(page, true);
        assert.equal((await snapshot(page)).backCalls, 0);
        await page.getByRole('button', { name: 'Voltar aos projetos', exact: true }).click();
        await dialog.getByRole('button', { name: 'Sair sem baixar', exact: true }).click();
        await expect(page.getByTestId('project-library')).toBeVisible();
        await expectUnloadWarning(page, false);
        const state = await snapshot(page);
        assert.equal(state.backCalls, 1);
        assert.deepEqual(state.downloads, []);
      } finally { await page.close(); }
    });

    await t.test('download and exit requires a current successful ZIP and preserves editing after errors or changes during export', async () => {
      const page = await pageFor({ manualBackup: true });
      try {
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Voltar aos projetos', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Sair do projeto', exact: true });
        await dialog.getByRole('button', { name: 'Baixar ZIP e sair', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 1);
        assert.equal((await snapshot(page)).backCalls, 0);
        await expectUnloadWarning(page, true);
        await page.evaluate(() => window.manualBackupFixture.failDownload());
        await expect(dialog.getByRole('alert')).toContainText('Falha de exportação na fixture.');
        await expect(dialog.getByRole('button', { name: 'Continuar editando', exact: true })).toBeEnabled();
        await expectUnloadWarning(page, true);
        assert.equal((await snapshot(page)).backCalls, 0);
        await dialog.getByRole('button', { name: 'Baixar ZIP e sair', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 2);
        assert.equal((await snapshot(page)).backCalls, 0);
        await page.evaluate(() => window.manualBackupFixture.notifySave('project-changed'));
        await page.evaluate(() => window.manualBackupFixture.completeDownload());
        await expect(dialog.getByRole('alert')).toContainText('O projeto mudou enquanto o ZIP era gerado. Baixe um novo ZIP antes de sair.');
        await expectUnloadWarning(page, true);
        assert.equal((await snapshot(page)).backCalls, 0, 'a ZIP that missed a concurrent edit cannot authorize leaving');
        await dialog.getByRole('button', { name: 'Baixar ZIP e sair', exact: true }).click();
        await page.waitForFunction(() => window.manualBackupFixture.downloads.length === 3);
        await page.evaluate(() => window.manualBackupFixture.completeDownload());
        await expect(page.getByTestId('project-library')).toBeVisible();
        await expectUnloadWarning(page, false);
        assert.equal((await snapshot(page)).backCalls, 1);
      } finally { await page.close(); }
    });

    await t.test('nonmanual workspaces do not acquire the manual ZIP unload requirement', async () => {
      const page = await pageFor({});
      try {
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeEnabled();
        await expectUnloadWarning(page, false);
        await page.evaluate(() => {
          window.manualBackupFixture.notifySave('project-changed');
          window.manualBackupFixture.notifySave('project-saved');
        });
        await expectUnloadWarning(page, false);
        assert.deepEqual((await snapshot(page)).downloads, []);
      } finally { await page.close(); }
    });

    await t.test('the default folder mode still blocks runtime startup when its required directory is missing', async () => {
      const page = await pageFor({ requireSecurityDirectory: true });
      try {
        await expect(page.getByText('Este projeto precisa de uma pasta de segurança', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Builder', exact: true })).toBeDisabled();
        await expect(page.getByText('A seleção de pastas não está disponível. Volte aos projetos e escolha continuar com backups manuais em ZIP.', { exact: true })).toBeVisible();
        const state = await snapshot(page);
        assert.deepEqual(state.boots, []);
        assert.deepEqual(state.snapshots, []);
        assert.deepEqual(state.downloads, []);
      } finally { await page.close(); }
    });

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(unexpectedRequests, []);
  } finally { await browser.close(); }
});
