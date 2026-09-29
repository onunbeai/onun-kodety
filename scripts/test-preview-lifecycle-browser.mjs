import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const browserName = process.env.KODETY_TEST_BROWSER || 'chromium';
const browserType = new Map(Object.entries({ chromium, firefox, webkit })).get(browserName);
assert.ok(browserType, `Unsupported KODETY_TEST_BROWSER: ${browserName}`);

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React, {useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {HtmlOpaqueOriginBufferedIframe} from './app/(builder)/kodety/html-editor/components/HtmlBufferedIframe';
import {HtmlSnapshotPreview} from './app/(builder)/kodety/html-editor/components/HtmlSnapshotPreview';
import {HtmlInfiniteCanvas} from './app/(builder)/kodety/html-editor/components/HtmlInfiniteCanvas';
import {usePageTransitionPreview} from './app/(builder)/kodety/html-editor/hooks/use-page-transition-preview';
const root = createRoot(document.querySelector('#root'));
const render = element => flushSync(()=>root.render(element));
window.blockFactory = true;
window.addEventListener('load', event => {
  if (window.blockFactory && event.target?.title === 'Preparador isolado do Preview') event.stopImmediatePropagation();
}, true);
window.mountPlayer = (key) => render(<HtmlOpaqueOriginBufferedIframe documentKey={key} documentRevision={1} surfaceKey={key} srcDoc={'<main>'+key+'</main><iframe data-player="youtube.com"></iframe>'} title="Runtime fixture" sandbox="allow-scripts"/>);
window.mountSnapshot = (id='release-A') => render(<HtmlSnapshotPreview snapshot={{id,modified:'2026-09-05T00:00:00Z',current:false,previewUrl:'/preview/'+id}} nonce="fixture" readOnly restoring={false} onRestore={async()=>{throw Error('must not restore')}} onClose={()=>render(null)}/>);
function Navigation() {window.navigation=usePageTransitionPreview(true);return null}
window.mountNavigation = ()=>render(<Navigation/>);
function Infinite({scope='fixture'}) {
 const iframeRef=useRef(null);
 return <HtmlInfiniteCanvas ref={handle=>window.infinite=handle} frames={[{id:'base',label:'Desktop',detail:'900px',width:900,height:700}]} activeId="base" html="<main>Canvas</main>" passiveHtml="<main>Reference</main>" documentKey="infinite-1" sandbox="allow-scripts" iframeRef={iframeRef} localeLabel="pt" viewPreferenceKey={scope} onInfiniteCanvasChange={()=>{}} onSelectFrame={()=>{}} onActiveFrameLoad={()=>{}} onResizeFrame={(...args)=>window.resizes.push(args)}/>;
}
window.mountInfinite=()=>{window.resizes=[];localStorage.setItem('html-editor:infinite-canvas-view:v3:fixture',JSON.stringify({zoom:2,pan:{x:72,y:56}}));render(<Infinite/>)};
window.switchInfinite=()=>{localStorage.setItem('html-editor:infinite-canvas-view:v3:page-B',JSON.stringify({zoom:20,pan:{x:120,y:100}}));render(<Infinite scope="page-B"/>)};
window.unmount=()=>render(null);
window.ready=true;
` }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/historical')) return res.writeHead(200, { 'content-type': 'text/html' }).end('<main>Historical page</main>');
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<style>#root,[data-infinite-canvas]{width:1000px;height:800px;position:relative}iframe{width:900px;height:700px}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await browserType.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.mountPlayer('player-A'));
  await page.waitForFunction(() => document.querySelector('iframe[title="Runtime fixture"]')?.srcdoc.includes('<main>player-A</main>'), undefined, { timeout: 3000 });
  await page.evaluate(() => window.mountPlayer('player-B'));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('iframe[title="Runtime fixture"]')).some(frame => frame.srcdoc.includes('<main>player-B</main>')), undefined, { timeout: 3000 });
  await page.evaluate(() => { window.unmount(); window.mountNavigation(); window.destinations=[]; window.navigation.begin({duration:.2},()=>window.destinations.push('B')); window.navigation.begin({duration:.2},()=>window.destinations.push('C')); });
  assert.deepEqual(await page.evaluate(() => window.destinations), ['B','C'], 'navigation during a pending transition must execute the newest intent');
  await page.evaluate(() => { try {window.navigation.begin({duration:.2},()=>{throw Error('navigation failed')})} catch {} });
  await page.waitForFunction(() => window.navigation.phase === 'idle');

  let renewal = 0;
  await page.route('**/preview/**', async route => {
    const id = route.request().url().split('/').at(-1);
    renewal++;
    await route.fulfill({ json: { release: id, url: `/historical/home?token=${renewal}`, expiresAt: new Date(Date.now()+1000).toISOString(), pages: [
      {path:'index.html',url:`/historical/home?token=${renewal}`},{path:'about.html',url:`/historical/about?token=${renewal}`},
    ] } });
  });
  await page.evaluate(() => window.mountSnapshot());
  const pages = page.getByLabel('Página do snapshot');
  await pages.selectOption({ label: 'about.html' });
  await page.getByRole('button',{name:'Celular',exact:true}).click();
  await page.getByRole('button',{name:'Recarregar prévia'}).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="Página do snapshot"]')?.value === '/historical/about?token=2');
  assert.equal(await page.getByRole('button',{name:'Celular',exact:true}).getAttribute('aria-pressed'),'true');
  await page.waitForFunction(() => document.querySelector('select[aria-label="Página do snapshot"]')?.disabled);
  assert.match(await page.locator('[role="status"]').textContent(), /link expirou/);
  await page.route('**/preview/timeout', () => {});
  await page.evaluate(() => window.mountSnapshot('timeout'));
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('demorou demais'), undefined, { timeout: 18_000 });
  await page.evaluate(() => { window.unmount(); window.mountInfinite(); });
  await page.waitForFunction(() => document.querySelector('[data-infinite-canvas] > div')?.style.transform.includes('scale(0.02)'));
  const gesture = await page.evaluate(async () => {
    const canvas = document.querySelector('[data-infinite-canvas]');
    const plane = canvas.firstElementChild;
    const send = (target, type, pointerId, clientX) => target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId,clientX,clientY:50,button:1}));
    const paint = () => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const initial = plane.style.transform;
    send(canvas,'pointerdown',10,100);
    send(window,'pointermove',11,500);await paint();const wrongPointer=plane.style.transform;
    send(window,'pointermove',10,150);await paint();const moved=plane.style.transform;
    send(canvas,'lostpointercapture',10,150);
    send(window,'pointermove',10,250);await paint();const afterLost=plane.style.transform;
    window.infinite.setSpacePressed(true);await paint();
    send(canvas,'pointerdown',12,100);window.infinite.setSpacePressed(false);
    send(window,'pointermove',12,250);await paint();const afterSpace=plane.style.transform;
    const resize=document.querySelector('[aria-label="Redimensionar largura de Desktop"]');
    send(resize,'pointerdown',20,100);send(window,'pointermove',20,102);send(window,'pointerup',20,102);
    window.infinite.setFrameContentHeight('base',NaN);await paint();
    return {initial,wrongPointer,moved,afterLost,afterSpace,resizes:window.resizes,height:document.querySelector('[data-infinite-canvas-frame]').style.height};
  });
  assert.equal(gesture.wrongPointer,gesture.initial);
  assert.notEqual(gesture.moved,gesture.initial);
  assert.equal(gesture.afterLost,gesture.moved,'lost capture must end pan and remove listeners');
  assert.equal(gesture.afterSpace,gesture.afterLost,'Space release through the iframe bridge must end pan');
  assert.deepEqual(gesture.resizes.at(-1),['base','width',1000,'commit'],'resize must use the actual 2% scale');
  assert.equal(gesture.height,'736px','invalid height must not corrupt geometry');
  const switchedView = await page.evaluate(async () => {
    const canvas=document.querySelector('[data-infinite-canvas]');
    canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:30,clientX:100,clientY:50,button:1}));
    window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:30,clientX:250,clientY:50,button:1}));
    // Change pages synchronously while the outgoing pan still awaits its RAF.
    window.switchInfinite();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const matrix=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-infinite-canvas] > div')).transform);
    return {x:matrix.m41,y:matrix.m42,scale:matrix.m11};
  });
  assert.deepEqual(switchedView,{x:120,y:100,scale:.2},'a queued gesture must not overwrite the next page camera');
  await page.evaluate(() => window.unmount());
  assert.equal(await page.locator('iframe').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Preview lifecycle browser passed: factory never loads, per-document fallback, latest navigation, snapshot renewal/expiry/timeout, infinite pan capture, 2% resize and cleanup.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
