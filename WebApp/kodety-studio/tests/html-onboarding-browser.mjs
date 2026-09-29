// Create real HTML projects through the production Studio UI in isolated OPFS.
// The only simulated API is the native folder picker, returning real handles.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dist = path.resolve(process.env.KODETY_STUDIO_DIST || path.join(root, 'WebApp/kodety-studio/dist'));
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
let activePage;
try {
  for (const language of process.env.KODETY_ONBOARDING_LANGUAGE ? [process.env.KODETY_ONBOARDING_LANGUAGE] : ['pt', 'en']) {
    const l = (pt, en) => language === 'pt' ? pt : en;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(language => {
      if (window.top !== window) return;
      localStorage.setItem('kodetyStudioPreferencesV1', JSON.stringify({ language, onboardingVersion: 2 }));
      localStorage.setItem('kodetyStudioWebOnboarding', '2');
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('tour-' + crypto.randomUUID(), { create: true });
    }, language);
    const page = activePage = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('https://**/*', route => route.abort());
    const invite = page.locator('[data-onboarding-invite]');
    const library = page.locator('[data-onboarding-view="library"]');
    const guide = page.locator('[data-onboarding-view="tour"]');
    const verifyLibrary = async () => {
      await expect(library.getByRole('heading')).toHaveText(l('Conheça as ferramentas.', 'Get to know your tools.'));
      await expect(library).toContainText(l('Explore no seu ritmo', 'Explore at your own pace'));
      await expect(library).toContainText(l('2 áreas para explorar', '2 areas to explore'));
      await expect(library).toContainText(l('Builder e Design', 'Builder and Design'));
      await expect(library).toContainText(l('Settings do projeto', 'Project Settings'));
      await expect(library).toContainText(l('Até 23 etapas', 'Up to 23 steps'));
      await expect(library).toContainText(l('Até 14 etapas', 'Up to 14 steps'));
      await expect(library).toContainText(l('Você está aqui', 'You are here'));
      await expect(library.getByRole('button', { name: l('Fechar guia', 'Close guide'), exact: true })).toBeVisible();
    };
    const create = async name => {
      await page.goto(base);
      await page.getByRole('button', { name: l('Novo projeto', 'New project'), exact: true }).first().click();
      const form = page.getByRole('dialog', { name: l('Criar novo projeto', 'Create a new project'), exact: true });
      await form.locator('#web-project-name').fill(name);
      await form.getByRole('button', { name: l('Escolher uma pasta', 'Choose a folder'), exact: false }).click();
      await form.getByRole('button', { name: l('Criar e abrir projeto', 'Create and open project'), exact: true }).click();
      await expect(invite).toBeVisible();
      await expect(invite.getByRole('heading')).toHaveText(l('Quer conhecer o builder?', 'Want a tour of the builder?'));
      await expect(invite.getByRole('button', { name: l('Não preciso', 'No thanks'), exact: true })).toBeVisible();
      await expect(page.locator('[data-onboarding-view]')).toHaveCount(0);
      const id = await page.evaluate(name => JSON.parse(localStorage.getItem('kodetyStudioProjectsV1')).find(project => project.name === name).id, name);
      await page.waitForFunction(id => Object.keys(localStorage).some(key => key.endsWith(':workspace:' + id) && localStorage.getItem(key) === 'offered'), id);
      return id;
    };
    const reopen = async (name, entry = '/') => {
      await page.goto(base + entry);
      await page.getByRole('button', { name: l('Abrir ', 'Open ') + name, exact: true }).click();
      await page.locator('[data-kodety-onboarding="design-canvas"]').waitFor();
      await page.waitForTimeout(1800);
      await expect(invite).toHaveCount(0);
      await expect(page.locator('[data-onboarding-view]')).toHaveCount(0);
    };
    await create('Tour dismissed');
    await page.screenshot({ path: `/tmp/kodety-new-project-tour-${language}.png`, animations: 'disabled' });
    await invite.getByRole('button').last().click();
    await reopen('Tour dismissed');
    await page.locator('[data-editor-corner-menu-trigger]').click();
    await page.getByRole('menuitem', { name: 'Onboarding', exact: true }).click();
    await verifyLibrary();
    await page.keyboard.press('Escape');
    await create('Tour accepted');
    await invite.getByRole('button').nth(1).click();
    await verifyLibrary();
    await page.screenshot({ path: `/tmp/kodety-tour-library-${language}.png`, animations: 'disabled' });
    await library.locator('button[data-current="true"]').click();
    await expect(guide.getByRole('heading')).toHaveText(l('As áreas do seu projeto', 'Your project areas'));
    await expect(guide).toContainText(l('Guia da área', 'Area guide'));
    await expect(guide).toContainText(l('NA PRÁTICA', 'IN PRACTICE'));
    await expect(guide).toContainText(l('Você pode continuar depois.', 'You can continue later.'));
    await expect(guide.getByRole('progressbar', { name: l('Progresso do guia', 'Guide progress') })).toBeVisible();
    await page.screenshot({ path: `/tmp/kodety-tour-step-${language}.png`, animations: 'disabled' });
    await guide.getByRole('button', { name: l('Próximo', 'Next'), exact: true }).click();
    await expect(guide.getByRole('heading')).toHaveText(l('Seu site no canvas', 'Your site on the canvas'));
    await guide.getByRole('button', { name: l('Ver etapas do guia', 'View guide steps'), exact: true }).click();
    const index = guide.getByRole('navigation', { name: l('Etapas do guia', 'Guide steps'), exact: true });
    await expect(index).toContainText(l('Ir para uma etapa', 'Go to a step'));
    await index.getByRole('button').filter({ hasText: l('Comece pelo Insert', 'Start with Insert') }).click();
    await expect(guide.getByRole('heading')).toHaveText(l('Comece pelo Insert', 'Start with Insert'));
    await guide.getByRole('button', { name: l('Ver em detalhes', 'View details'), exact: true }).click();
    await expect(guide).toContainText(l('Aprofundamento', 'Detailed guide'));
    await expect(guide.getByRole('heading')).not.toHaveText(l('Comece pelo Insert', 'Start with Insert'));
    if (language === 'en') await expect(guide).not.toContainText(/\b(Busque|Encontre|Escolha|Você|etapas|explicações|disponíveis)\b/);
    await page.screenshot({ path: `/tmp/kodety-tour-details-${language}.png`, animations: 'disabled' });
    await guide.getByRole('button', { name: l('Voltar ao guia', 'Back to guide'), exact: true }).click();
    await guide.getByRole('button', { name: l('Ver etapas do guia', 'View guide steps'), exact: true }).click();
    await index.getByRole('button').last().click();
    await guide.getByRole('button', { name: l('Concluir', 'Done'), exact: true }).click();
    const completion = page.locator('[data-onboarding-view="complete"]');
    await expect(completion.getByRole('heading')).toHaveText(l('Mais uma área para criar.', 'More tools to create with.'));
    await expect(completion).toContainText(l('Você conheceu os principais controles de Builder e Design. Use o que aprendeu no projeto ou continue explorando.', 'You explored the main controls in Builder and Design. Use what you learned in your project or keep exploring.'));
    await completion.getByRole('button', { name: l('Explorar outra área', 'Explore another area'), exact: true }).click();
    await expect(library).toContainText(l('1 de 2 áreas exploradas', '1 of 2 areas explored'));
    await expect(library).toContainText(l('Rever guia', 'Review guide'));
    await library.getByRole('button', { name: l('Fechar guia', 'Close guide'), exact: true }).click();
    await reopen('Tour accepted');
    await create('Tour unanswered');
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await invite.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
    await page.screenshot({ path: `/tmp/kodety-new-project-tour-mobile-${language}.png`, animations: 'disabled' });
    // A fresh Builder entry intentionally requires desktop width; only the
    // already-open guide is responsive on mobile.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reopen('Tour unanswered', '/index.html');
    assert.deepEqual(errors, []);
    console.log(`${language}: actual project creation, invitation, translated library, tour, index, nested details, completion, progress, manual replay, reload and mobile passed.`);
    await context.close();
  }
} catch (error) {
  console.error(await activePage?.locator('body').innerText().catch(() => ''));
  await activePage?.screenshot({ path: '/tmp/kodety-new-project-tour-failure.png' }).catch(() => undefined);
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
