import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

const vite = await createServer({ logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
const { preparePageTransitionsForTransport, PAGE_TRANSITIONS_RUNTIME_PATH } = await vite.ssrLoadModule('/lib/html-editor/page-transitions-runtime.ts');
const { writePageTransitionDocument, PAGE_TRANSITION_EFFECTS } = await vite.ssrLoadModule('/lib/html-editor/page-transitions.ts');
let effect = 'blur-zoom';
const markup = (heading, href, label) => `<!doctype html><html><head><title>${heading}</title><script>window.Motion = { authorOwned: true };</script><style>body{margin:0;background:#17233a;color:white;font:24px sans-serif;min-height:100vh}main{padding:8vw}a{color:white}</style></head><body><main><h1>${heading}</h1><a href="${href}">${label}</a></main></body></html>`;
function project() {
  const base = { name: 'Motion pages', mainHtmlPath: 'index.html', files: {
    'index.html': { path: 'index.html', mimeType: 'text/html', text: markup('Home', '/about', 'About') },
    'about.html': { path: 'about.html', mimeType: 'text/html', text: markup('About', '/', 'Home') },
  } };
  return preparePageTransitionsForTransport(writePageTransitionDocument(base, { version: 1, universal: { enabled: true, preload: false, effect, duration: .18, easing: 'ease-out' }, rules: [] }), 'index.html');
}
let files = project().files;
const http = createHttpServer((request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname;
  const file = files[route === '/' ? 'index.html' : route === '/about' ? 'about.html' : route.slice(1)];
  response.writeHead(file ? 200 : 404, { 'Content-Type': file?.mimeType || 'text/plain' });
  response.end(file?.text || 'Not found');
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${http.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  assert(!files[PAGE_TRANSITIONS_RUNTIME_PATH].text.includes('__ONUN_PAGE_MOTION_HELPERS__'));
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const preset of PAGE_TRANSITION_EFFECTS) {
    console.log('Checking', preset.value);
    effect = preset.value; files = project().files;
    await page.goto(origin);
    await page.waitForFunction(() => window.__KODETY_PAGE_TRANSITIONS__?.engine === 'motion');
    await page.evaluate(() => {
      window.motionCalls = 0; window.pageViews = 0; window.initialDocument = 'preserved';
      const original = window.__ONUN_MOTION__.animateView;
      window.__ONUN_MOTION__.animateView = (...args) => { window.motionCalls++; return original(...args); };
      document.addEventListener('kodety:page-view', () => window.pageViews++);
    });
    await page.getByRole('link', { name: 'About', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
    await page.waitForFunction(() => !window.__KODETY_PAGE_TRANSITIONS__.swup.navigating);
    assert.equal(await page.evaluate(() => window.motionCalls), 1, preset.value + ' must use Motion animateView');
    assert.equal(await page.evaluate(() => window.Motion.authorOwned), true, 'preserve author Motion global');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await page.waitForFunction(() => !window.__KODETY_PAGE_TRANSITIONS__.swup.navigating);
    assert.equal(await page.evaluate(() => window.motionCalls), 2, 'history must animate without reloading');
    assert.equal(await page.evaluate(() => window.initialDocument), 'preserved');
    assert.equal(await page.evaluate(() => window.pageViews), 2, 'exactly one replacement per navigation');
  }
  for (const mode of ['unsupported', 'reduced']) {
    const fallback = await browser.newContext({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    if (mode === 'unsupported') await fallback.addInitScript(() => { document.startViewTransition = undefined; });
    const tab = await fallback.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto(origin);
    await tab.waitForFunction(() => window.__ONUN_MOTION__);
    await tab.evaluate(() => {
      window.motionCalls = 0; window.viewCalls = 0;
      const animate = window.__ONUN_MOTION__.animate;
      window.__ONUN_MOTION__.animate = (...args) => { window.motionCalls++; return animate(...args); };
      const view = window.__ONUN_MOTION__.animateView;
      window.__ONUN_MOTION__.animateView = (...args) => { window.viewCalls++; return view(...args); };
    });
    await tab.getByRole('link', { name: 'About', exact: true }).click();
    await expect(tab.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
    await tab.waitForFunction(() => !window.__KODETY_PAGE_TRANSITIONS__.swup.navigating);
    assert.equal(await tab.evaluate(() => window.viewCalls), 0);
    assert.equal(await tab.evaluate(() => window.motionCalls), mode === 'unsupported' ? 2 : 0);
    assert.equal(await tab.evaluate(() => document.body.style.opacity), '');
    await fallback.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Motion page transitions: ${PAGE_TRANSITION_EFFECTS.length} presets, history, author globals, fallback and reduced motion passed.`);
  await context.close();
} finally {
  await browser.close();
  http.closeAllConnections();
  await new Promise(resolve => http.close(resolve));
  await vite.close();
}
