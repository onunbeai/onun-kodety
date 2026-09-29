import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');
let realTours = [];
if (process.env.KODETY_ONBOARDING_REAL_URL) {
  const catalog = await build({ entryPoints: [path.join(root, 'lib/html-editor/onboarding-tours.ts')], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  realTours = (await import(`data:text/javascript;base64,${Buffer.from(catalog.outputFiles[0].text).toString('base64')}`)).ONBOARDING_TOURS;
}
const globalsPath = path.join(root, 'app/globals.css');
const globals = (await postcss([tailwindcss({ base: root })]).process(await readFile(globalsPath, 'utf8'), { from: globalsPath })).css;
const wordpressCss = await readFile(path.join(root, 'Wordpress/editor/wordpress-editor.css'), 'utf8');
const fixture = await build({
  stdin: { resolveDir: root, loader: 'tsx', sourcefile: 'onboarding-browser-fixture.tsx', contents: `
    import React, { StrictMode, useEffect, useMemo, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { WordPressBuilderOnboarding } from './Wordpress/editor/WordPressBuilderOnboarding';
    import { WordPressWorkspaceLogoMenu } from './Wordpress/editor/WordPressWorkspaceLogoMenu';
    import { NAVIGATE_BUILDER_ONBOARDING } from './lib/html-editor/onboarding-events';
    import * as storage from './lib/html-editor/onboarding-state';
    import { createWorkspaceOnboardingStorageKey } from './lib/html-editor/onboarding-workspace';
    import { ONBOARDING_TOURS } from './lib/html-editor/onboarding-tours';
    import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog';
    import { builderOnboardingDialogProps, useBuilderOnboardingActive } from './lib/html-editor/onboarding-active';
    import { navigateWithEditorLockHandoff, interceptEditorLockWorkspaceNavigation } from './Wordpress/editor/editor-lock-navigation';
    const query = new URLSearchParams(location.search);
    const area = location.pathname.split('/').filter(Boolean)[1] || 'editor';
    const currentTour = area === 'editor' ? 'design' : area;
    const areaUrl = area => location.origin + '/kodety/' + area + '/' + location.search;
    const config = { appView: area, nonce: 'fixture-onboarding-nonce', siteUrl: location.origin + (query.get('site') || ''),
      editorUrl: areaUrl('editor'), cmsUrl: areaUrl('cms'), cmsItemsUrl: '/fixture/cms-items', settingsUrl: areaUrl('settings'),
      analyticsUrl: areaUrl('analytics'), canViewAnalytics: true, localizationUrl: areaUrl('localization'), localizationEntryUrl: query.has('without-localization') ? undefined : '/fixture/localization.js',
      updates: { currentVersion: '1.0.0', latestVersion: '1.0.0', updateAvailable: false, checkedAt: '', pageUrl: '/fixture/updates', statusUrl: '/fixture/updates/status', checkUrl: '/fixture/updates/check' },
      onboarding: { userId: 17, preference: query.get('preference') || 'unseen', preferenceUrl: '/fixture/onboarding-preference' } };
    const state = window.fixture = { ready: false, edits: [], viewActions: [], shortcuts: [], requests: [], navigation: [], allowNavigation: false, tourCount: ONBOARDING_TOURS.filter(tour => !['members', 'templates'].includes(tour.id)).length,
      key: query.has('workspace') ? createWorkspaceOnboardingStorageKey(location.origin + location.pathname, query.get('workspace')) : storage.createOnboardingStorageKey(config.siteUrl, 17), ...storage };
    window.fetch = async (url, options) => {
      if (url !== config.onboarding.preferenceUrl) throw new Error('Unexpected fixture request: ' + url);
      state.requests.push({ url, method: options.method, headers: options.headers, ...JSON.parse(options.body) });
      return new Response(JSON.stringify({ preference: JSON.parse(options.body).preference }), { status: 200 });
    };
    window.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Delete', 'z'].includes(event.key)) state.shortcuts.push(event.key); });
    window.addEventListener(NAVIGATE_BUILDER_ONBOARDING, event => {
      event.preventDefault(); state.navigation.push(event.detail.href);
      if (state.allowNavigation) navigateWithEditorLockHandoff(event.detail.href);
      // Native navigation can report false before a delayed next document
      // commits. A real pagehide, rather than that early result, owns transfer.
      event.detail.resolve(false);
    });
    document.addEventListener('click', interceptEditorLockWorkspaceNavigation);
    // The ownership regression uses two fixed nested targets so it remains
    // independent of copy changes in the full production Variables catalog.
    const fixtureVariableDetails = [
      { id: 'fixture-variables-search', target: '[data-kodety-onboarding="fixture-variables-search"]', title: 'Buscar uma variável', description: 'Encontre o valor reutilizável.' },
      { id: 'fixture-variables-modes', target: '[data-kodety-onboarding="fixture-variables-modes"]', title: 'Modos da coleção', description: 'Consulte os modos disponíveis.' },
    ];
    if (query.has('variable-details')) ONBOARDING_TOURS.find(tour => tour.id === 'design').steps.find(step => step.id === 'variables').details = fixtureVariableDetails;
    const tour = ONBOARDING_TOURS.find(tour => tour.id === currentTour) || ONBOARDING_TOURS[0];
    const anchors = tour.steps.map(step => ({ ...step, anchor: step.target.match(/data-kodety-onboarding="([^"]+)"/)?.[1],
      revealAnchor: query.has('variable-details') && step.id === 'inspector' ? undefined : step.reveal?.match(/data-kodety-onboarding="([^"]+)"/)?.[1],
      section: step.target.match(/data-kodety-onboarding-section="([^"]+)"/)?.[1],
    })).filter(step => step.anchor && !['workspace-navigation', 'design-canvas'].includes(step.anchor));
    const revealControls = Array.from(new Map(anchors.filter(step => step.revealAnchor).map(step => [step.revealAnchor, step])).values());
    function App() {
      const [mounted, setMounted] = useState(true);
      const [blocking, setBlocking] = useState(false);
      const [configRevision, setConfigRevision] = useState(0);
      const [activePanel, setActivePanel] = useState(null);
      const onboardingActive = useBuilderOnboardingActive();
      const activeConfig = useMemo(() => ({ ...config }), [configRevision]);
      const workspace = useMemo(() => query.has('workspace') ? { id: query.get('workspace'), currentArea: currentTour, enabledAreas: ['design', 'settings'], onNavigate: async () => false } : undefined, []);
      state.setMounted = setMounted; state.setBlocking = setBlocking;
      state.refreshConfig = () => setConfigRevision(value => value + 1);
      useEffect(() => { state.ready = true; }, []);
      const renderPanel = step => <section key={step.id} data-fixture-revealed-panel data-kodety-onboarding={step.anchor} data-kodety-onboarding-section={step.section}><h2>{step.title}</h2><p>Controles da área aberta</p>{step.revealAnchor === 'design-insert' && <input autoFocus aria-label="Busca do painel" onChange={() => state.edits.push('panel-search')}/>} {step.revealAnchor === 'design-variables' && <><label data-kodety-onboarding="fixture-variables-search">Buscar<input aria-label="Busca de variáveis"/></label><div data-kodety-onboarding="fixture-variables-modes">Modo padrão</div></>}</section>;
      return <><header className="fixture-header">
        <WordPressWorkspaceLogoMenu config={activeConfig}/>
        <nav data-kodety-onboarding="workspace-navigation">Design <span>CMS</span><span>Insights</span><span>Settings</span></nav>
        <button className="fixture-publish" onClick={() => state.edits.push('publish')}>Publicar</button>
      </header><main id="fixture-workspace" data-kodety-onboarding={currentTour + '-workspace'} data-kodety-project-settings={currentTour === 'settings' ? '' : undefined}>
        <aside className="fixture-sidebar"><small>PROJETO</small><h1>{tour.title}</h1>
          {revealControls.map(step => <button key={step.revealAnchor} data-kodety-onboarding={step.revealAnchor} data-kodety-onboarding-reveal
            data-kodety-onboarding-toggle={['design-insert', 'design-variables'].includes(step.revealAnchor) ? '' : undefined}
            aria-pressed={activePanel === step.revealAnchor} aria-expanded={activePanel === step.revealAnchor} onClick={() => { state.viewActions.push(step.revealAnchor); setActivePanel(current => current === step.revealAnchor ? null : step.revealAnchor); }}>Abrir {step.title}</button>)}
          {anchors.filter(step => !step.revealAnchor).map(step => <button key={step.id} data-kodety-onboarding={step.anchor} data-kodety-onboarding-section={step.section} onClick={() => state.edits.push(step.id)}>{step.title}</button>)}
          {anchors.filter(step => step.revealAnchor === activePanel).map(step => query.has('variable-dialog') && step.revealAnchor === 'design-variables'
            ? <Dialog key={step.id} open modal={false} onOpenChange={open => { if (!open) setActivePanel(null); }}><DialogContent {...builderOnboardingDialogProps(onboardingActive)}><DialogTitle>Painel de variáveis</DialogTitle>{renderPanel(step)}</DialogContent></Dialog>
            : renderPanel(step))}
        </aside><section className="fixture-canvas" data-kodety-onboarding={currentTour === 'design' ? 'design-canvas' : undefined}>
          <div className="fixture-page"><span className="fixture-tag">KODETY STUDIO</span><h2>Seu próximo projeto<br/>começa aqui.</h2><p>Uma experiência de criação com espaço para suas ideias.</p><label>Título do projeto<input id="project-title" defaultValue="Meu projeto" onChange={event => state.edits.push(event.target.value)}/></label><button id="project-action" onClick={() => state.edits.push('create')}>Criar conteúdo</button></div>
        </section>
      </main>{blocking && <div id="fixture-blocking-dialog" role="dialog" aria-label="Edição em andamento"><input aria-label="Campo do diálogo"/></div>}
      {mounted && <WordPressBuilderOnboarding config={activeConfig} workspace={workspace}/>}</>;
    }
    createRoot(document.getElementById('kodety-root')).render(<StrictMode><App/></StrictMode>);
  ` },
  bundle: true, write: false, outfile: 'onboarding-fixture.js', format: 'iife', platform: 'browser',
  alias: { '@': root }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
});
const script = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
const moduleCss = fixture.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
const fixtureCss = `
  body{margin:0;font-family:Inter,Arial,sans-serif;background:#141414;color:#ddd;overflow:hidden}
  .fixture-header{height:54px;background:#191919;border-bottom:1px solid #343434;display:flex;align-items:center;gap:38px;padding:0 16px}
  .fixture-header button{padding:7px 10px;border:1px solid #3a3a3a;border-radius:7px;color:#ddd;font-size:12px}
  .fixture-header nav{font-size:12px;display:flex;gap:25px}.fixture-header nav span{color:#888}.fixture-publish{margin-left:auto;background:#e9ab0d!important;color:#191919!important}
  #fixture-workspace{height:calc(100dvh - 54px);display:flex}.fixture-sidebar{width:250px;flex-shrink:0;overflow:auto;padding:22px 12px;background:#1a1a1a;border-right:1px solid #333}.fixture-sidebar small{color:#777;font-size:9px;letter-spacing:.1em;padding:10px}.fixture-sidebar h1{font-size:13px;font-weight:600;padding:10px;margin-bottom:15px}.fixture-sidebar button{display:block;text-align:left;font-size:11px;width:100%;padding:12px 10px;border-radius:7px;margin:2px 0;background:#222;color:#bbb}
  .fixture-canvas{flex:1;min-width:0;padding:54px 6%;overflow:auto;background:radial-gradient(#3d3d3d 1px,transparent 1px);background-size:20px 20px}.fixture-page{min-height:500px;background:#f2f0ea;color:#262821;border-radius:6px;padding:50px;box-shadow:0 8px 40px #0003}.fixture-tag{font-size:10px;letter-spacing:.18em}.fixture-page h2{font-size:42px;line-height:1.08;margin:35px 0 18px;font-weight:500}.fixture-page p{font-size:13px;color:#74786e;max-width:300px}.fixture-page label{display:block;margin-top:45px;font-size:11px}.fixture-page input{display:block;width:100%;max-width:240px;border:1px solid #bbc0b5;border-radius:6px;margin:7px 0 20px;padding:9px;font-size:12px;background:#fff}.fixture-page button{background:#323c2b;color:#fff;padding:10px 17px;border-radius:6px;font-size:11px}
  #fixture-blocking-dialog{position:fixed;inset:100px 25%;background:#222;z-index:9999;padding:30px;border:1px solid #777}
  @media(max-width:700px){.fixture-header{gap:15px}.fixture-header nav{display:none}.fixture-sidebar{width:116px;padding:15px 6px}.fixture-sidebar button{font-size:9px;padding:9px 6px}.fixture-sidebar h1{font-size:11px;padding:8px}.fixture-canvas{padding:15px}.fixture-page{padding:20px;min-height:460px}.fixture-page h2{font-size:25px}.fixture-page p{font-size:11px}.fixture-page input{min-width:0}.fixture-header button{font-size:10px}}
`;
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kodety onboarding fixture</title><style>${globals}\n${wordpressCss}\n${moduleCss}\n${fixtureCss}</style></head><body class="kodety-wordpress-editor"><div id="kodety-root"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

if (process.env.KODETY_ONBOARDING_SERVE === '1') {
  console.log(`Onboarding visual fixture: ${baseUrl}/kodety/editor/`);
  console.log('Real onboarding UI and CSS, simulated project controls; use the logo Onboarding button to reopen.');
  await new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await new Promise(resolve => server.close(resolve));
} else {
  const { chromium } = await import(process.env.KODETY_ONBOARDING_PLAYWRIGHT || '@playwright/test');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.KODETY_ONBOARDING_BROWSER_CHANNEL ? { channel: process.env.KODETY_ONBOARDING_BROWSER_CHANNEL } : {}) });
    console.log('Onboarding browser fixture compiled; browser ready.');
    const errors = [];
    const newPage = async (options = {}) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, reducedMotion: 'reduce', ...options });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on('pageerror', error => errors.push(error.message));
      return page;
    };
    const go = async (page, route = '/kodety/editor/') => {
      await page.goto(`${baseUrl}${route}`);
      await page.waitForFunction(() => window.fixture?.ready);
    };
    const invite = page => page.locator('[data-onboarding-invite]');
    const view = (page, kind) => page.locator(`[data-onboarding-view="${kind}"]`);
    const menuTrigger = page => page.getByRole('button', { name: 'Abrir menu do Onun Kodety', exact: true });
    const open = async page => {
      const previous = await page.locator('[data-onboarding-view]').count() ? await page.locator('[data-onboarding-view]').elementHandle() : null;
      await menuTrigger(page).click();
      const items = await page.getByRole('menuitem').allTextContents();
      const onboardingIndex = items.findIndex(text => text.trim() === 'Onboarding');
      assert.ok(onboardingIndex > 0 && items[onboardingIndex - 1].trim() === 'Buscar atualizações', 'Onboarding appears immediately below updates in the actual logo dropdown');
      await page.getByRole('menuitem', { name: 'Onboarding', exact: true }).click();
      await view(page, 'library').waitFor();
      await page.locator('[data-kodety-logo-menu]').waitFor({ state: 'hidden' });
      if (previous) await page.waitForFunction(element => !element.isConnected, previous);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[data-onboarding-view]')), true, 'the dropdown releases focus to the guide');
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none', 'the guide library does not block the editor');
    };
    const close = async page => {
      await page.getByRole('button', { name: 'Encerrar onboarding', exact: true }).click();
      await page.locator('[data-onboarding-view]').waitFor({ state: 'hidden' });
    };
    const quiet = async page => {
      await page.waitForTimeout(1500);
      assert.equal(await invite(page).count(), 0);
      assert.equal(await page.locator('[data-onboarding-view]').count(), 0);
    };
    const assertFits = async (page, locator) => {
      const box = await locator.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
        `onboarding fits viewport: ${JSON.stringify({ box, viewport })}`);
    };
    const walkRealDetails = async (page, definitions, requiredIds = []) => {
      const mainTitle = await view(page, 'tour').getByRole('heading').innerText();
      const expectedIds = await page.evaluate(steps => steps.filter(step => {
        const visible = [...document.querySelectorAll(step.target)].some(element => {
          const box = element.getBoundingClientRect();
          return box.width && box.height && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]');
        });
        return visible || (step.reveal && [...document.querySelectorAll(step.reveal)].some(control => control.hasAttribute('data-kodety-onboarding-reveal') && !control.matches(':disabled, [aria-disabled="true"]')));
      }).map(step => step.id), definitions);
      const visited = [];
      await page.getByRole('button', { name: 'Ver em detalhes', exact: true }).click();
      const firstTitle = definitions.find(step => step.id === expectedIds[0])?.title;
      assert.ok(firstTitle, 'at least one real detail is available before entering');
      await view(page, 'tour').getByRole('heading', { name: firstTitle, exact: true }).waitFor();
      for (let index = 0; index <= definitions.length; index++) {
        const title = await view(page, 'tour').getByRole('heading').innerText();
        const step = definitions.find(step => step.title === title);
        assert.ok(step, `detail matches the built catalog: ${title}`);
        assert.ok(!visited.includes(step.id), `detail does not repeat: ${step.id}`);
        visited.push(step.id);
        await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(element => {
          const box = element.getBoundingClientRect();
          return box.width && box.height && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]');
        }), step.target);
        const finish = page.getByRole('button', { name: 'Concluir detalhes', exact: true });
        if (await finish.count()) { await finish.click(); await view(page, 'tour').getByRole('heading', { name: mainTitle, exact: true }).waitFor(); break; }
        await page.getByRole('button', { name: 'Próximo', exact: true }).click();
      }
      assert.equal(await view(page, 'tour').getByRole('heading').innerText(), mainTitle, 'completing optional details resumes their original parent step');
      assert.deepEqual(visited, expectedIds, 'every available detail is presented in catalog order');
      for (const id of requiredIds) assert.ok(visited.includes(id), `required real detail is available: ${id}`);
      return visited;
    };

    if (process.env.KODETY_ONBOARDING_REAL_ONLY !== '1') {
    // Separate HTML projects and separate WordPress installations each get one
    // invitation; leaving it unanswered still must not cause repeat prompts.
    for (const kind of ['html', 'wordpress', 'studio-wordpress']) {
      const fresh = await newPage();
      const route = id => '/kodety/editor/?' + (kind === 'html' ? 'workspace=' + id : 'site=' + encodeURIComponent(kind === 'studio-wordpress' ? '/scope:kodety-studio-' + id : '/' + id));
      await go(fresh, route('first'));
      await invite(fresh).waitFor();
      assert.equal(await view(fresh, 'tour').count(), 0, kind + ': asking is not consent to start');
      await fresh.waitForFunction(() => localStorage.getItem(window.fixture.key) === 'offered');
      await fresh.reload();
      await fresh.waitForFunction(() => window.fixture?.ready);
      await quiet(fresh);
      await go(fresh, route('second'));
      await invite(fresh).waitFor();
      await fresh.getByRole('button', { name: 'Não preciso', exact: true }).click();
      await fresh.reload();
      await fresh.waitForFunction(() => window.fixture?.ready);
      await quiet(fresh);
      await open(fresh);
      await close(fresh);
      await go(fresh, route('third'));
      await invite(fresh).waitFor();
      await fresh.getByRole('button', { name: 'Conhecer o Kodety', exact: false }).click();
      await view(fresh, 'library').waitFor();
      await close(fresh);
      await fresh.reload();
      await fresh.waitForFunction(() => window.fixture?.ready);
      await quiet(fresh);
      await fresh.context().close();
      console.log('PASS: ' + kind + ' invitation once per project/installation, ignored invitation, refusal, acceptance and manual replay.');
    }
    const page = await newPage();
    await go(page);
    await invite(page).waitFor();
    await assertFits(page, invite(page));
    assert.equal(await page.locator('[data-onboarding-view]').count(), 0, 'an invitation never starts a tour without consent');
    await page.getByRole('button', { name: 'Não preciso', exact: true }).click();
    await invite(page).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.fixture.requests.some(request => request.preference === 'dismissed'));
    assert.deepEqual(await page.evaluate(() => ({ preference: localStorage.getItem(window.fixture.key), edits: window.fixture.edits,
      request: window.fixture.requests.at(-1) })), {
      preference: 'dismissed', edits: [], request: { url: '/fixture/onboarding-preference', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': 'fixture-onboarding-nonce' }, preference: 'dismissed' },
    });
    await page.evaluate(() => window.fixture.setMounted(false));
    await page.evaluate(() => window.fixture.setMounted(true));
    await quiet(page);
    console.log('PASS: invitation, refusal, persistence and remount.');
    await page.reload();
    await page.waitForFunction(() => window.fixture?.ready);
    await quiet(page);
    await open(page);
    assert.equal(await view(page, 'library').getByRole('button').filter({ hasText: /Iniciar guia|Explorar área/ }).count(), await page.evaluate(() => window.fixture.tourCount));
    assert.equal(await view(page, 'library').getByRole('button').filter({ hasText: /Área de Membros|Biblioteca de Templates/ }).count(), 0, 'excluded workspaces do not appear in the onboarding catalog');
    await open(page);
    await page.evaluate(() => {
      document.querySelector('[data-kodety-onboarding="design-layers"]')?.removeAttribute('data-kodety-onboarding-reveal');
      document.querySelector('[data-kodety-onboarding="design-pages"]')?.setAttribute('disabled', '');
      document.querySelector('[data-kodety-onboarding="design-assets"]')?.setAttribute('aria-disabled', 'true');
    });
    await page.getByRole('button', { name: /^Builder e Design/ }).click();
    await view(page, 'tour').waitFor();
    await open(page);
    await page.getByRole('button', { name: /^Builder e Design/ }).click();
    await view(page, 'tour').waitFor();
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none', 'tour highlights leave the real interface interactive');
    await assertFits(page, view(page, 'tour'));
    const firstTitle = await view(page, 'tour').getByRole('heading').innerText();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await view(page, 'tour').getByRole('heading').innerText(), firstTitle);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await view(page, 'tour').getByRole('heading').innerText(), firstTitle);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await page.evaluate(() => window.fixture.shortcuts), [], 'guide keyboard input never reaches editor shortcuts');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-fixture-revealed-panel][data-kodety-onboarding="design-insert-panel"]').waitFor();
    await page.waitForFunction(() => !!document.activeElement?.closest('[data-onboarding-view="tour"]'));
    assert.deepEqual(await page.evaluate(() => window.fixture.viewActions), ['design-insert'], 'entering a hidden panel step clicks its explicitly marked view control');
    await page.evaluate(() => document.querySelector('[data-kodety-onboarding="design-insert"]').click());
    await page.locator('[data-fixture-revealed-panel][data-kodety-onboarding="design-insert-panel"]').waitFor({ state: 'hidden' });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.fixture.viewActions), ['design-insert', 'design-insert'], 'closing the target manually must not cause the guide to reopen it');
    await page.locator('#project-title').focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'project-title', 'the user can keep using the editor while a tour is open');
    await view(page, 'tour').focus();
    await page.keyboard.press('Escape');
    await page.locator('[data-onboarding-view]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.matches('[data-editor-corner-menu-trigger]'));
    console.log('PASS: manual replay, keyboard isolation and focus restoration.');
    await open(page);
    await page.getByRole('button', { name: /^Builder e Design/ }).click();
    for (let step = 0; step < 30 && await view(page, 'tour').count(); step++) {
      await page.getByRole('button', { name: /^(Próximo|Concluir)$/ }).click();
    }
    await view(page, 'complete').waitFor();
    await page.getByRole('button', { name: /^Finalizar/ }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem(window.fixture.key)), 'dismissed', 'finishing a manual replay preserves the original refusal');
    assert.deepEqual(await page.evaluate(() => window.fixture.edits), [], 'tour navigation never changes content, settings or publication');
    assert.equal(await page.evaluate(() => window.fixture.viewActions.some(action => ['design-layers', 'design-pages', 'design-assets'].includes(action))), false, 'unmarked, disabled and aria-disabled controls are never auto-clicked');
    assert.equal(await page.locator('#project-title').inputValue(), 'Meu projeto');

    await open(page);
    await page.getByRole('button', { name: /^CMS e conteúdo/ }).click();
    await page.getByRole('status').filter({ hasText: 'A navegação foi interrompida' }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem(window.fixture.key + ':pending-tour')), null, 'cancelled navigation clears the queued tour');
    assert.ok(page.url().includes('/kodety/editor/'));
    await page.evaluate(() => { window.fixture.allowNavigation = true; });
    await page.getByRole('button', { name: /^CMS e conteúdo/ }).click();
    await page.waitForURL('**/kodety/cms/');
    await view(page, 'tour').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem(window.fixture.key + ':pending-tour')), null, 'StrictMode consumes the explicit route intent once');
    await close(page);
    await page.evaluate(() => window.fixture.refreshConfig());
    await quiet(page);
    await page.reload();
    await page.waitForFunction(() => window.fixture?.ready);
    await quiet(page);
    console.log('PASS: completion and guarded one-use cross-route navigation under StrictMode.');

    const nested = await newPage();
    await go(nested, '/kodety/editor/?preference=dismissed&variable-details=1&variable-dialog=1');
    await open(nested);
    await nested.getByRole('button', { name: /^Builder e Design/ }).click();
    for (let step = 0; step < 15 && !(await view(nested, 'tour').getByRole('heading').innerText()).startsWith('Variables:'); step++) {
      await nested.getByRole('button', { name: 'Próximo', exact: true }).click();
    }
    const nestedVariables = nested.locator('[data-fixture-revealed-panel][data-kodety-onboarding="design-variables-panel"]');
    await nestedVariables.waitFor();
    await nestedVariables.getByRole('textbox', { name: 'Busca de variáveis', exact: true }).fill('Cor principal');
    await nested.getByRole('button', { name: 'Ver em detalhes', exact: true }).click();
    assert.equal(await view(nested, 'tour').getByRole('heading').innerText(), 'Buscar uma variável');
    await nestedVariables.waitFor();
    await nested.getByRole('button', { name: 'Próximo', exact: true }).click();
    assert.equal(await view(nested, 'tour').getByRole('heading').innerText(), 'Modos da coleção');
    await nestedVariables.waitFor();
    await nested.getByRole('button', { name: 'Voltar ao guia', exact: true }).click();
    assert.match(await view(nested, 'tour').getByRole('heading').innerText(), /^Variables:/);
    await nestedVariables.waitFor();
    assert.equal(await nestedVariables.getByRole('textbox', { name: 'Busca de variáveis', exact: true }).inputValue(), 'Cor principal', 'nested steps and return do not unmount or reset the parent panel');
    assert.deepEqual(await nested.evaluate(() => window.fixture.viewActions.filter(action => action === 'design-variables')), ['design-variables']);
    await nested.getByRole('button', { name: 'Próximo', exact: true }).click();
    assert.equal(await view(nested, 'tour').getByRole('heading').innerText(), 'As propriedades da seleção');
    await nestedVariables.waitFor({ state: 'hidden' });
    assert.deepEqual(await nested.evaluate(() => window.fixture.viewActions.filter(action => action === 'design-variables')), ['design-variables', 'design-variables'], 'leaving the whole parent scope closes its owned toggle exactly once');
    assert.deepEqual(await nested.evaluate(() => window.fixture.edits), []);
    await nested.context().close();
    console.log('PASS: nested details retain their parent panel and close it only after leaving that part of the guide.');

    // Every progress scenario owns a fresh browser context: previous tour
    // completion and fixture invitation choices must not leak into this test.
    const reading = await newPage();
    await go(reading, '/kodety/editor/?preference=dismissed');
    await open(reading);
    await reading.getByRole('button', { name: /^Builder e Design/ }).click();
    const readingFirstTitle = await view(reading, 'tour').getByRole('heading').innerText();
    await reading.getByRole('button', { name: 'Próximo', exact: true }).click();
    await reading.getByRole('button', { name: 'Próximo', exact: true }).click();
    const savedReadingTitle = await view(reading, 'tour').getByRole('heading').innerText();
    assert.notEqual(savedReadingTitle, readingFirstTitle);
    assert.equal(await view(reading, 'tour').getByRole('progressbar').getAttribute('aria-valuenow'), '3');
    const readDesignProgress = page => page.evaluate(() => JSON.parse(localStorage.getItem(window.fixture.key + ':reading:v1') || '{}').design);
    assert.deepEqual(await readDesignProgress(reading), { stepId: 'insert', completed: false });
    await close(reading);
    await open(reading);
    const continuingCard = view(reading, 'library').getByRole('button', { name: /^Builder e Design/ });
    assert.match(await continuingCard.innerText(), /Em andamento/);
    assert.match(await continuingCard.innerText(), /Continuar guia/);
    await continuingCard.click();
    assert.equal(await view(reading, 'tour').getByRole('heading').innerText(), savedReadingTitle, 'reopening resumes the last main step');
    await close(reading);
    await reading.reload();
    await reading.waitForFunction(() => window.fixture?.ready);
    await open(reading);
    await view(reading, 'library').getByRole('button', { name: /^Builder e Design/ }).click();
    assert.equal(await view(reading, 'tour').getByRole('heading').innerText(), savedReadingTitle, 'the cursor survives a document reload');

    await reading.getByRole('button', { name: 'Ver etapas do guia', exact: true }).click();
    const readingIndex = reading.getByRole('navigation', { name: 'Etapas do guia', exact: true });
    await readingIndex.waitFor();
    assert.match(await readingIndex.locator('[aria-current="step"]').innerText(), /Comece pelo Insert/);
    await readingIndex.locator('[aria-current="step"]').focus();
    await reading.keyboard.press('Escape');
    await readingIndex.waitFor({ state: 'hidden' });
    await view(reading, 'tour').waitFor();
    assert.equal(await reading.getByRole('button', { name: 'Ver etapas do guia', exact: true }).evaluate(element => document.activeElement === element), true, 'Escape collapses the index and returns focus to its trigger');
    await reading.keyboard.press('Escape');
    await view(reading, 'tour').waitFor({ state: 'hidden' });
    await open(reading);
    await view(reading, 'library').getByRole('button', { name: /^Builder e Design/ }).click();
    await reading.getByRole('button', { name: 'Ver etapas do guia', exact: true }).click();
    await readingIndex.locator('[aria-current="step"]').click();
    await readingIndex.waitFor({ state: 'hidden' });
    assert.equal(await view(reading, 'tour').evaluate(element => document.activeElement === element), true, 'choosing the current index entry keeps keyboard focus inside the guide');
    await reading.getByRole('button', { name: 'Ver etapas do guia', exact: true }).click();
    await readingIndex.getByRole('button', { name: /Biblioteca de efeitos/ }).click();
    await readingIndex.waitFor({ state: 'hidden' });
    assert.equal(await view(reading, 'tour').getByRole('heading').innerText(), 'Biblioteca de efeitos', 'the index jumps directly to the chosen available step');
    assert.deepEqual(await readDesignProgress(reading), { stepId: 'effects', completed: false });
    assert.deepEqual(await reading.evaluate(() => window.fixture.edits), [], 'jumping in the index never clicks project content actions');
    assert.equal(await reading.locator('#project-title').inputValue(), 'Meu projeto');

    for (let step = 0; step < 30 && await view(reading, 'tour').count(); step++) {
      await reading.getByRole('button', { name: /^(Próximo|Concluir)$/ }).click();
    }
    await view(reading, 'complete').waitFor();
    assert.equal((await readDesignProgress(reading)).completed, true);
    await close(reading);
    await reading.reload();
    await reading.waitForFunction(() => window.fixture?.ready);
    await open(reading);
    const completedCard = view(reading, 'library').getByRole('button', { name: /^Builder e Design/ });
    assert.match(await completedCard.innerText(), /Concluído/);
    assert.match(await completedCard.innerText(), /Rever guia/);
    await completedCard.click();
    assert.equal(await view(reading, 'tour').getByRole('heading').innerText(), readingFirstTitle, 'replaying a completed tour starts at its first available step');
    assert.deepEqual(await readDesignProgress(reading), { stepId: 'workspace-navigation', completed: true }, 'replay preserves completion while updating the reading position');
    await close(reading);
    await open(reading);
    assert.match(await view(reading, 'library').getByRole('button', { name: /^Builder e Design/ }).innerText(), /Concluído/);
    assert.deepEqual(await reading.evaluate(() => window.fixture.edits), [], 'resume, index and replay never mutate the fixture project');
    await reading.context().close();
    console.log('PASS: reading progress resumes after close/reload, the index jumps safely, and completed guides replay from the start.');

    const readingDetails = await newPage();
    await go(readingDetails, '/kodety/editor/?preference=dismissed&variable-details=1');
    await open(readingDetails);
    await readingDetails.getByRole('button', { name: /^Builder e Design/ }).click();
    await readingDetails.getByRole('button', { name: 'Ver etapas do guia', exact: true }).click();
    await readingDetails.getByRole('navigation', { name: 'Etapas do guia', exact: true }).getByRole('button', { name: /Variables: consistência visual/ }).click();
    const readingParentTitle = await view(readingDetails, 'tour').getByRole('heading').innerText();
    const mainCursor = await readDesignProgress(readingDetails);
    assert.deepEqual(mainCursor, { stepId: 'variables', completed: false });
    await readingDetails.getByRole('button', { name: 'Ver em detalhes', exact: true }).click();
    await readingDetails.getByRole('button', { name: 'Próximo', exact: true }).click();
    assert.equal(await view(readingDetails, 'tour').getByRole('heading').innerText(), 'Modos da coleção');
    assert.deepEqual(await readDesignProgress(readingDetails), mainCursor, 'advancing optional details never overwrites the main cursor');
    await readingDetails.getByRole('button', { name: 'Ver etapas do guia', exact: true }).click();
    await readingDetails.getByRole('navigation', { name: 'Etapas do guia', exact: true }).getByRole('button', { name: /Buscar uma variável/ }).click();
    assert.equal(await view(readingDetails, 'tour').getByRole('heading').innerText(), 'Buscar uma variável');
    assert.deepEqual(await readDesignProgress(readingDetails), mainCursor, 'jumping through a detail index also preserves the main cursor');
    await close(readingDetails);
    await readingDetails.reload();
    await readingDetails.waitForFunction(() => window.fixture?.ready);
    await open(readingDetails);
    await view(readingDetails, 'library').getByRole('button', { name: /^Builder e Design/ }).click();
    assert.equal(await view(readingDetails, 'tour').getByRole('heading').innerText(), readingParentTitle, 'reopening after closing a detail returns to its parent main step');
    assert.deepEqual(await readDesignProgress(readingDetails), mainCursor);
    assert.deepEqual(await readingDetails.evaluate(() => window.fixture.edits), []);
    await readingDetails.context().close();
    console.log('PASS: optional detail navigation and index preserve the main tour cursor across reloads.');

    const readingMerge = await newPage();
    await go(readingMerge, '/kodety/editor/?preference=dismissed');
    await open(readingMerge);
    await readingMerge.getByRole('button', { name: /^Builder e Design/ }).click();
    await readingMerge.evaluate(() => {
      const key = window.fixture.key + ':reading:v1';
      const latest = JSON.parse(localStorage.getItem(key) || '{}');
      latest.design.completed = true;
      latest.settings = { stepId: 'seo', completed: true };
      localStorage.setItem(key, JSON.stringify(latest));
    });
    await readingMerge.getByRole('button', { name: 'Próximo', exact: true }).click();
    await readingMerge.getByRole('button', { name: 'Ver áreas', exact: true }).click();
    assert.match(await view(readingMerge, 'library').getByRole('button', { name: /^Builder e Design/ }).innerText(), /Concluído/, 'a verified merge updates the visible completion even when component state was stale');
    assert.match(await view(readingMerge, 'library').getByRole('button', { name: /^Settings do projeto/ }).innerText(), /Concluído/, 'a verified merge refreshes the latest completion of other areas');
    await readingMerge.context().close();
    console.log('PASS: a verified progress merge preserves and presents completion from a newer storage state.');

    const withoutLocalization = await newPage();
    await go(withoutLocalization, '/kodety/editor/?preference=dismissed&without-localization=1');
    await open(withoutLocalization);
    assert.equal(await view(withoutLocalization, 'library').getByRole('button').filter({ hasText: /Languages e localização/ }).count(), 0, 'an uninstalled Localization extension is omitted even when its route is configured');
    await withoutLocalization.context().close();

    const focused = await newPage();
    await go(focused);
    await focused.locator('#project-title').focus();
    await focused.waitForTimeout(1500);
    assert.equal(await invite(focused).count(), 0, 'an input focused during the invitation delay is not interrupted');
    await menuTrigger(focused).focus();
    await invite(focused).waitFor();
    await focused.getByRole('button', { name: 'Conhecer o Kodety', exact: false }).click();
    await view(focused, 'library').waitFor();
    await close(focused);
    await focused.reload();
    await focused.waitForFunction(() => window.fixture?.ready);
    await quiet(focused);

    const blockedByDialog = await newPage();
    await go(blockedByDialog);
    await blockedByDialog.evaluate(() => window.fixture.setBlocking(true));
    await blockedByDialog.waitForTimeout(1500);
    assert.equal(await invite(blockedByDialog).count(), 0, 'a dialog opened during the delay postpones the invitation');
    await blockedByDialog.evaluate(() => window.fixture.setBlocking(false));
    await invite(blockedByDialog).waitFor();

    const unavailableStorage = await newPage();
    await unavailableStorage.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
    await go(unavailableStorage);
    await quiet(unavailableStorage);
    await open(unavailableStorage);
    await unavailableStorage.getByRole('button', { name: /^Builder e Design/ }).click();
    await view(unavailableStorage, 'tour').waitFor();
    await close(unavailableStorage);

    const sibling = await blockedByDialog.context().newPage();
    sibling.on('pageerror', error => errors.push(error.message));
    await go(sibling);
    await quiet(sibling);
    await sibling.evaluate(() => window.fixture.writeOnboardingPreference(window.fixture.key, 'dismissed'));
    await invite(blockedByDialog).waitFor({ state: 'hidden' });

    for (const viewport of [{ width: 390, height: 720 }, { width: 390, height: 640 }, { width: 320, height: 480 }]) {
      const narrow = await newPage({ viewport });
      await go(narrow, '/kodety/editor/?preference=dismissed');
      await open(narrow);
      await assertFits(narrow, view(narrow, 'library'));
      await assertFits(narrow, narrow.getByRole('button', { name: 'Fechar guia', exact: true }));
      await narrow.getByRole('button', { name: /^Builder e Design/ }).click();
      await view(narrow, 'tour').waitFor();
      await assertFits(narrow, view(narrow, 'tour'));
      await narrow.getByRole('button', { name: 'Próximo', exact: true }).click();
      await assertFits(narrow, view(narrow, 'tour'));
      await close(narrow);
      assert.deepEqual(await narrow.evaluate(() => window.fixture.edits), []);
      await narrow.context().close();
    }
    }
    if (process.env.KODETY_ONBOARDING_REAL_URL) {
      if (process.env.KODETY_ONBOARDING_REAL_NAVIGATION_ONLY === '1' || (!process.env.KODETY_ONBOARDING_REAL_AREAS_ONLY && !process.env.KODETY_ONBOARDING_REAL_AREAS)) {
        for (const scenario of [
          { destination: 'cms', via: 'catalog', handoff: false },
          { destination: 'settings', via: 'catalog', handoff: false },
          { destination: 'cms', via: 'catalog', handoff: true },
          { destination: 'cms', via: 'catalog', handoff: false, autofocus: true },
          { destination: 'cms', via: 'native', handoff: false },
          { destination: 'settings', via: 'native', handoff: false },
        ]) {
          const page = await newPage({ viewport: { width: 1600, height: 1000 } });
          if (scenario.autofocus) await page.addInitScript(() => {
            if (!location.pathname.endsWith('/cms/')) return;
            const observer = new MutationObserver(() => {
              const landmark = document.querySelector('[data-kodety-onboarding="cms-collection-search"]');
              const input = landmark?.matches('input') ? landmark : landmark?.querySelector('input');
              if (input instanceof HTMLInputElement) {
                observer.disconnect(); input.focus();
                window.onboardingFixtureAutofocus = { applied: document.activeElement === input, beforeGuide: !document.querySelector('[data-onboarding-view]') };
              }
            });
            observer.observe(document, { subtree: true, childList: true });
          });
          // A navigation remains in the original document for more than a
          // zero-delay task; its pending guide must survive that interval.
          await page.route(/\/kodety\/(cms|settings)\/(\?.*)?$/, async route => {
            if (route.request().isNavigationRequest()) await new Promise(resolve => setTimeout(resolve, 300));
            await route.continue();
          });
          await page.goto(process.env.KODETY_ONBOARDING_REAL_URL);
          await page.locator('[data-kodety-onboarding="design-canvas"]').waitFor({ timeout: 45_000 });
          await open(page);
          if (scenario.handoff) await page.evaluate(() => { window.kodetyEditorSession = 'onboarding_fixture_handoff_123456'; });
          const destinationTour = realTours.find(tour => tour.id === scenario.destination);
          if (scenario.via === 'catalog') {
            await view(page, 'library').getByRole('button', { name: new RegExp(`^${destinationTour.title}`) }).click();
          } else {
            await view(page, 'library').getByRole('button', { name: /^Builder e Design/ }).click();
            await view(page, 'tour').waitFor();
            if (scenario.destination === 'cms') await page.getByRole('link', { name: 'CMS', exact: true }).click();
            else await page.locator('[data-kodety-onboarding="design-settings"]').click();
          }
          await page.waitForURL(url => url.pathname === `/kodety/${scenario.destination}/`, { timeout: 45_000 });
          await page.locator(scenario.destination === 'cms' ? '[data-kodety-onboarding="cms-workspace"]' : '[data-kodety-project-settings]').waitFor({ timeout: 45_000 });
          if (scenario.handoff) assert.equal(new URL(page.url()).searchParams.get('kodety_editor_handoff'), 'onboarding_fixture_handoff_123456', 'the target without a lock runtime retains the transient handoff parameter');
          await view(page, 'tour').waitFor();
          if (scenario.autofocus) assert.deepEqual(await page.evaluate(() => window.onboardingFixtureAutofocus), { applied: true, beforeGuide: true }, 'the CMS search actually took focus before the explicit destination guide started');
          assert.ok((await view(page, 'tour').innerText()).includes(destinationTour.title), 'the new document automatically opens the requested destination guide');
          assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.endsWith(':pending-tour')).length), 0, 'the cross-document intent is consumed once');
          await close(page);
          await page.reload();
          await page.locator(scenario.destination === 'cms' ? '[data-kodety-onboarding="cms-workspace"]' : '[data-kodety-project-settings]').waitFor({ timeout: 45_000 });
          await quiet(page);
          if (scenario.via === 'native' && scenario.destination === 'cms') {
            await page.getByRole('button', { name: 'Design', exact: true }).click();
            await page.waitForURL(url => url.pathname === '/kodety/editor/', { timeout: 45_000 });
            await page.locator('[data-kodety-onboarding="design-canvas"]').waitFor({ timeout: 45_000 });
            await quiet(page);
          }
          console.log(`PASS: real document navigation ${scenario.via} Design → ${scenario.destination}${scenario.handoff ? ' with editor handoff' : ''}${scenario.autofocus ? ' despite destination autofocus' : ''}, with no restart after close/reload.`);
          await page.context().close();
        }
      }
      if (process.env.KODETY_ONBOARDING_REAL_AREAS_ONLY !== '1' && process.env.KODETY_ONBOARDING_REAL_NAVIGATION_ONLY !== '1') {
      const real = await newPage({ viewport: { width: 1600, height: 1000 } });
      const realDesignTour = realTours.find(tour => tour.id === 'design');
      await real.goto(process.env.KODETY_ONBOARDING_REAL_URL);
      await real.locator('[data-kodety-onboarding="design-canvas"]').waitFor({ timeout: 45_000 });
      await real.locator('iframe').first().waitFor({ state: 'attached', timeout: 45_000 });
      await menuTrigger(real).click();
      await real.getByRole('menuitem', { name: 'Onboarding', exact: true }).click();
      await view(real, 'library').waitFor();
      assert.notEqual(await real.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none');
      await real.evaluate(() => {
        window.onboardingPreviewControlClicks = [];
        window.onboardingPreviewShortcutEvents = [];
        window.addEventListener('keydown', event => {
          if (['Delete', 'Backspace', 'z'].includes(event.key)) window.onboardingPreviewShortcutEvents.push(event.key);
        });
        document.addEventListener('click', event => {
          const control = event.target.closest?.('button');
          const fromGuide = event.composedPath().some(node => node instanceof Element && node.hasAttribute('data-kodety-onboarding-ui'));
          if (control && !fromGuide) window.onboardingPreviewControlClicks.push({
            anchor: control.getAttribute('data-kodety-onboarding'), safe: control.hasAttribute('data-kodety-onboarding-reveal'),
          });
        });
      });
      assert.equal(await real.locator('[data-kodety-onboarding="design-insert-panel"]').count(), 0, 'the real builder starts with its Insert panel closed');
      await real.getByRole('button', { name: /^Builder e Design/ }).click();
      await view(real, 'tour').waitFor();
      for (let step = 0; step < 5 && !(await view(real, 'tour').getByRole('heading').innerText()).includes('Comece pelo Insert'); step++) {
        await real.getByRole('button', { name: 'Próximo', exact: true }).click();
      }
      await real.locator('[data-kodety-onboarding="design-insert-panel"]').waitFor();
      await real.waitForFunction(() => !!document.activeElement?.closest('[data-onboarding-view="tour"]'));
      assert.deepEqual(await real.evaluate(() => window.onboardingPreviewControlClicks), [{ anchor: 'design-insert', safe: true }], 'the actual catalog step opens only the actual marked Insert control');
      assert.notEqual(await real.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none');
      const insertVisited = await walkRealDetails(real, realDesignTour.steps.find(step => step.id === 'insert').details, ['insert-search', 'insert-catalog']);
      await real.locator('[data-kodety-onboarding="design-insert-panel"]').waitFor();
      assert.deepEqual(await real.evaluate(() => window.onboardingPreviewControlClicks), [{ anchor: 'design-insert', safe: true }], 'Insert details preserve their parent without toggling it again');
      for (let step = 0; step < 10 && !(await view(real, 'tour').getByRole('heading').innerText()).startsWith('Variables:'); step++) {
        await real.getByRole('button', { name: 'Próximo', exact: true }).click();
      }
      const variables = real.locator('[data-kodety-onboarding="design-variables-panel"]');
      await variables.waitFor();
      await variables.getByPlaceholder('Buscar variáveis…', { exact: true }).fill('Filtro temporário');
      const variablesVisited = await walkRealDetails(real, realDesignTour.steps.find(step => step.id === 'variables').details, ['variables-collections', 'variables-tools']);
      assert.equal(await variables.getByPlaceholder('Buscar variáveis…', { exact: true }).inputValue(), 'Filtro temporário', 'real Variables retains its panel and search across all available details');
      await real.getByRole('button', { name: 'Próximo', exact: true }).click();
      await variables.waitFor({ state: 'hidden' });
      const inspectorTitle = await view(real, 'tour').getByRole('heading').innerText();
      assert.equal(inspectorTitle, 'As propriedades da seleção', 'the empty page can reveal an Inspector by safely selecting its existing Body');
      await real.waitForFunction(() => {
        const panel = document.querySelector('[data-kodety-onboarding="design-inspector-panel"]');
        return panel && [...panel.querySelectorAll('input, select, [role="combobox"]')].some(control => {
          const rect = control.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      });
      await real.getByRole('button', { name: 'Próximo', exact: true }).click();
      assert.match(await view(real, 'tour').getByRole('heading').innerText(), /^Style:/);
      await real.getByRole('button', { name: 'Ver em detalhes', exact: true }).click();
      assert.match(await view(real, 'tour').getByRole('heading').innerText(), /^Position:/);
      const position = real.locator('[data-kodety-onboarding="design-style-position"]');
      await position.waitFor();
      await position.getByRole('button', { name: 'Position type', exact: true }).waitFor();
      await real.waitForFunction(() => !!document.activeElement?.closest('[data-onboarding-view="tour"]'));
      await real.keyboard.press('Delete');
      await real.keyboard.press('Control+z');
      await real.keyboard.press('Meta+z');
      assert.deepEqual(await real.evaluate(() => window.onboardingPreviewShortcutEvents), [], 'delete and undo inside the real guide never reach editor shortcuts');
      await real.getByRole('button', { name: 'Próximo', exact: true }).click();
      assert.match(await view(real, 'tour').getByRole('heading').innerText(), /^Layout:/);
      const layout = real.locator('[data-kodety-onboarding="design-style-layout"]');
      await layout.waitFor();
      assert.ok(await layout.locator('input:visible, select:visible, [role="combobox"]:visible, button:visible').count(), 'the detailed Layout step highlights actual editable controls');
      await real.getByRole('button', { name: 'Voltar ao guia', exact: true }).click();
      assert.match(await view(real, 'tour').getByRole('heading').innerText(), /^Style:/, 'exiting optional details returns to the original Style step');
      const detailGroups = ['position', 'layout', 'spacing', 'sizing', 'typography', 'backgrounds', 'borders', 'effects', 'transform'];
      const styleDefinitions = realDesignTour.steps.find(step => step.id === 'style').details;
      const styleVisited = await walkRealDetails(real, styleDefinitions, detailGroups.map(group => `style-${group}`));
      for (let step = 0; step < 5 && !(await view(real, 'tour').getByRole('heading').innerText()).startsWith('Variables:'); step++) {
        await real.getByRole('button', { name: 'Passo anterior', exact: true }).click();
      }
      await variables.waitFor();
      const contents = await Promise.all(real.frames().filter(frame => frame.parentFrame()).map(frame => frame.locator('body').evaluate(body => {
        const copy = body.cloneNode(true);
        copy.querySelectorAll('script, style, link, [id^="__kodety"], [data-html-editor-agent-activity-root]').forEach(element => element.remove());
        return copy.textContent || '';
      })));
      assert.ok(contents.length > 0 && contents.every(text => !text.trim()), 'the actual project canvas remains empty after the guided reveal');
      await close(real);
      await variables.waitFor({ state: 'hidden' });
      await real.locator('[data-kodety-onboarding="design-insert-panel"]').waitFor({ state: 'hidden' });
      console.log(`PASS: actual WordPress Builder retains parent panels through ${insertVisited.length} Insert and ${variablesVisited.length} Variables details, closes Variables after next/close, selects existing Body for ${styleVisited.length} Style details, isolates shortcuts and preserves the empty canvas.`);
      await real.context().close();
      }
      const advanceToRealStep = async (page, tour, id) => {
        const expected = tour.steps.find(step => step.id === id);
        assert.ok(expected, `main catalog step exists: ${tour.id}/${id}`);
        for (let index = 0; index < tour.steps.length; index++) {
          if (await view(page, 'tour').getByRole('heading').innerText() === expected.title) {
            await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(element => {
              const box = element.getBoundingClientRect();
              return box.width && box.height && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]');
            }), expected.target);
            return expected;
          }
          await view(page, 'tour').getByRole('button', { name: 'Próximo', exact: true }).click();
        }
        assert.fail(`main step was not reached: ${tour.id}/${id}`);
      };
      const selectedAreas = process.env.KODETY_ONBOARDING_REAL_AREAS?.split(',');
      for (const area of ['settings', 'cms', 'analytics', 'localization'].filter(area => process.env.KODETY_ONBOARDING_REAL_NAVIGATION_ONLY !== '1' && (!selectedAreas || selectedAreas.includes(area)))) {
        const page = await newPage({ viewport: { width: 1600, height: 1000 } });
        const tour = realTours.find(tour => tour.id === area);
        const writes = [];
        page.on('request', request => {
          const url = new URL(request.url());
          if (url.pathname.startsWith('/__preview/') && !['GET', 'HEAD'].includes(request.method()) && !['/__preview/project', '/__preview/onboarding'].includes(url.pathname)) writes.push(`${request.method()} ${url.pathname}`);
        });
        await page.goto(new URL(`/kodety/${area}/`, process.env.KODETY_ONBOARDING_REAL_URL).href);
        await page.locator(area === 'settings' ? '[data-kodety-project-settings]' : `[data-kodety-onboarding="${area}-workspace"]`).waitFor({ timeout: 45_000 });
        await open(page);
        assert.equal(await view(page, 'library').getByRole('button').filter({ hasText: /Área de Membros|Biblioteca de Templates/ }).count(), 0);
        await page.getByRole('button', { name: new RegExp(`^${tour.title}`) }).click();
        await view(page, 'tour').waitFor();
        const totals = [];
        if (area === 'settings') {
          for (const id of ['general', 'seo']) {
            const step = await advanceToRealStep(page, tour, id);
            const visited = await walkRealDetails(page, step.details, [id === 'general' ? 'settings-identity' : 'settings-seo-metadata']);
            totals.push(`${id}:${visited.length}`);
          }
          const integrations = await advanceToRealStep(page, tour, 'integrations');
          const mcpToggle = page.locator('[data-kodety-onboarding="settings-integration-mcp-disclosure"]');
          await mcpToggle.waitFor();
          assert.equal(await mcpToggle.getAttribute('aria-expanded'), 'false', 'the real MCP accordion begins closed');
          const visited = await walkRealDetails(page, integrations.details, ['settings-integration-mcp']);
          await page.waitForFunction(() => document.querySelector('[data-kodety-onboarding="settings-integration-mcp-disclosure"]')?.getAttribute('aria-expanded') === 'false');
          totals.push(`integrations:${visited.length}`);
        } else if (area === 'cms') {
          for (const id of ['collections', 'fields']) {
            const step = await advanceToRealStep(page, tour, id);
            const visited = await walkRealDetails(page, step.details, [id === 'collections' ? 'cms-collections' : 'cms-fields-list']);
            totals.push(`${id}:${visited.length}`);
          }
          assert.equal(await page.locator('[data-kodety-onboarding="cms-field-label"]').count(), 0, 'native fields are inspected without creating a custom field');
        } else if (area === 'analytics') {
          const overview = await advanceToRealStep(page, tour, 'overview');
          const visited = await walkRealDetails(page, overview.details, ['analytics-overview-period', 'analytics-overview-metrics']);
          totals.push(`overview:${visited.length}`);
          await advanceToRealStep(page, tour, 'page-insights');
          await page.locator('[data-kodety-onboarding="analytics-content"][data-kodety-onboarding-section="page-insights"]').waitFor();
          assert.equal(await page.locator('[data-kodety-onboarding="analytics-page-insights"]').getAttribute('data-kodety-onboarding-reveal'), '', 'the tour reaches Page insights using its real safe view control');
        } else {
          const settings = await advanceToRealStep(page, tour, 'settings');
          const dialog = page.locator('[data-kodety-onboarding="localization-settings-body"]');
          await dialog.waitFor();
          assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none', 'Localization settings stays interactive during onboarding');
          assert.equal(await page.locator('[role="dialog"][aria-modal="true"]').count(), 0, 'Localization settings is nonmodal while its guide is open');
          const visited = await walkRealDetails(page, settings.details, ['localization-source-default', 'localization-routing-behavior']);
          totals.push(`settings:${visited.length}`);
          await dialog.waitFor();
          await view(page, 'tour').getByRole('button', { name: 'Próximo', exact: true }).click();
          await dialog.waitFor({ state: 'hidden' });
        }
        assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none');
        await close(page);
        assert.deepEqual(writes, [], `the ${area} walkthrough never submits configuration or content changes`);
        console.log(`PASS: real ${area} shell, logo replay and safe details (${totals.join(', ')}).`);
        await page.context().close();
      }
    }
    assert.deepEqual(errors, [], 'real onboarding UI must not produce browser runtime errors');
    console.log(process.env.KODETY_ONBOARDING_REAL_ONLY === '1' ? 'Real Builder onboarding smoke passed.' : 'Builder onboarding browser passed: optional invitation, durable refusal, manual replay, safe panel reveals, nonmodal interaction, guarded navigation, StrictMode one-use intent, focus/keyboard, blocked storage, cross-tab dismissal and narrow viewports.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
