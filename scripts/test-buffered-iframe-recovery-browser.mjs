import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {HtmlBufferedIframe} from './app/(builder)/kodety/html-editor/components/HtmlBufferedIframe';
const root=createRoot(document.querySelector('#root'));
const nativeTimeout=window.setTimeout.bind(window), nativeClear=window.clearTimeout.bind(window);
const deadlines=new Map();let sequence=1000000;
window.setTimeout=(callback,delay,...args)=>{
  if(delay!==15000)return nativeTimeout(callback,delay,...args);
  const id=++sequence;deadlines.set(id,()=>callback(...args));return id;
};
window.clearTimeout=id=>{if(!deadlines.delete(id))nativeClear(id)};
window.expire=()=>{const callbacks=[...deadlines.values()];deadlines.clear();flushSync(()=>callbacks.forEach(callback=>callback()))};
window.captureTimers=()=>{window.staleTimers=[...deadlines.values()]};
window.replayTimers=()=>flushSync(()=>window.staleTimers.forEach(callback=>callback()));
window.timerCount=()=>deadlines.size;
window.events=[];
window.mount=(key,surface=key)=>flushSync(()=>root.render(<HtmlBufferedIframe documentKey={key} surfaceKey={surface} documentRevision={1} srcDoc={'<main contenteditable="true">'+key+'</main>'} iframeRef={node=>window.activeNode=node} title="Recovery fixture" sandbox="allow-scripts" onInitialVisualReady={(_,key)=>window.events.push(['initial',key])} onPromote={(_,key)=>window.events.push(['promote',key])}/>));
window.unmount=()=>flushSync(()=>root.render(null));
window.ready=true;
` }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<style>#root{width:900px;height:700px;position:relative}iframe{width:900px;height:700px}.pointer-events-none{pointer-events:none}.absolute{position:absolute}.inset-0{inset:0}</style><input id="outside" aria-label="Editor control"><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browserName = process.env.KODETY_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName));
const browser = await ({ chromium, firefox, webkit }[browserName]).launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready);
  const alert = () => page.locator('[data-html-buffered-iframe-load-error]');
  const frame = async key => {
    await page.waitForFunction(key => Array.from(document.querySelectorAll('iframe')).some(node => node.srcdoc.includes('>'+key+'</main>')), key);
    // Match the actual document, not the visible slot: pending is deliberately
    // covered while its bridge is missing.
    for (const candidate of page.frames()) {
      if (candidate === page.mainFrame()) continue;
      if (await candidate.locator('main').textContent().catch(() => '') === key) return candidate;
    }
    throw new Error('Missing mounted document '+key);
  };
  const signal = async (key, type = 'html-editor-buffer-visuals-ready') => (await frame(key)).evaluate(type => parent.postMessage({ type }, '*'), type);
  const painted = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  // No bridge script exists, although the actual iframe has loaded.
  await page.evaluate(() => window.mount('initial-A'));
  const first = await frame('initial-A');
  await first.locator('main').click();
  await page.evaluate(() => { window.expiredWindow=document.querySelector('iframe').contentWindow; window.expiredReadyEvent=new MessageEvent('message',{source:window.expiredWindow,data:{type:'html-editor-buffer-visuals-ready'}}); window.captureTimers(); window.expire(); });
  assert.equal(await alert().count(), 1);
  assert.equal(await page.locator('iframe').evaluate(node => node.inert), true);
  assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'IFRAME'), false, 'timeout must release existing iframe focus');
  await signal('initial-A');
  await painted();
  assert.deepEqual(await page.evaluate(() => window.events), [], 'late readiness cannot reveal an expired initial mount');
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await page.waitForFunction(() => document.querySelector('iframe').contentWindow !== window.expiredWindow);
  assert.equal(await alert().count(), 0);
  await page.evaluate(() => { window.replayTimers(); window.dispatchEvent(window.expiredReadyEvent); });
  await painted();
  assert.deepEqual(await page.evaluate(() => window.events), [], 'expired mount callbacks cannot reveal its retry');
  await signal('initial-A');
  await page.waitForFunction(() => window.events.some(event => event[0] === 'initial'));
  assert.equal(await page.evaluate(() => window.timerCount()), 0);

  // A pending same-surface generation times out while retaining its predecessor.
  await page.evaluate(() => { window.mount('pending-B','initial-A'); window.captureTimers(); });
  await frame('pending-B');
  await page.locator('#outside').focus();
  await page.evaluate(() => { window.pendingWindow=Array.from(document.querySelectorAll('iframe')).find(node=>node.srcdoc.includes('pending-B')).contentWindow; window.pendingReadyEvent=new MessageEvent('message',{source:window.pendingWindow,data:{type:'html-editor-buffer-visuals-ready'}}); window.expire(); });
  assert.equal(await alert().count(), 1);
  assert.equal(await page.locator('iframe').evaluateAll(nodes => nodes.every(node => node.inert)), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'outside', 'background failure must preserve focus in other editor controls');
  await signal('pending-B');
  await painted();
  assert.equal(await page.evaluate(() => window.activeNode.srcdoc.includes('initial-A')), true, 'failed destination must not become the command target');
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('iframe')).find(node=>node.srcdoc.includes('pending-B'))?.contentWindow !== window.pendingWindow);
  await page.evaluate(() => { window.replayTimers(); window.dispatchEvent(window.pendingReadyEvent); });
  assert.equal(await alert().count(), 0);
  await signal('pending-B');
  await page.waitForFunction(() => window.events.some(event => event[0] === 'promote' && event[1] === 'pending-B'));
  assert.equal(await page.locator('iframe').count(), 1);
  assert.equal(await page.evaluate(() => window.activeNode.srcdoc.includes('pending-B')), true);

  // A superseding page owns its full deadline; the obsolete timeout and source
  // window cannot fail or promote it, including after it has become ready.
  await page.evaluate(() => { window.mount('obsolete-C'); window.captureTimers(); });
  await frame('obsolete-C');
  await page.evaluate(() => { window.obsoleteWindow=Array.from(document.querySelectorAll('iframe')).find(node=>node.srcdoc.includes('obsolete-C')).contentWindow; window.obsoleteReadyEvent=new MessageEvent('message',{source:window.obsoleteWindow,data:{type:'html-editor-buffer-visuals-ready'}}); window.mount('current-D'); window.replayTimers(); });
  assert.equal(await alert().count(), 0);
  await signal('current-D');
  await page.waitForFunction(() => window.events.some(event => event[0] === 'promote' && event[1] === 'current-D'));
  await page.evaluate(() => { window.replayTimers(); window.dispatchEvent(window.obsoleteReadyEvent); });
  await painted();
  assert.equal(await alert().count(), 0);
  assert.equal(await page.evaluate(() => window.activeNode.srcdoc.includes('current-D')), true);
  assert.equal(await page.evaluate(() => window.events.some(event => event[1] === 'obsolete-C')), false);
  assert.equal(await page.evaluate(() => window.timerCount()), 0);
  await page.evaluate(() => window.unmount());
  assert.equal(await page.evaluate(() => window.timerCount()), 0);
  assert.deepEqual(errors, []);
  console.log('Buffered iframe recovery browser tests passed ('+browserName+'): initial/pending deadlines, inert focus, current-document retry and stale callback isolation.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
