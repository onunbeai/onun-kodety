import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { webkit } from 'playwright';
import { launchBrowserWithPageZoom } from './fixtures/browser-page-zoom.mjs';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {HtmlExactViewport} from './app/(builder)/kodety/html-editor/components/HtmlExactViewport';
import {HtmlBufferedIframe} from './app/(builder)/kodety/html-editor/components/HtmlBufferedIframe';
const root=createRoot(document.querySelector('#root'));let props={width:480,key:'A',ready:true,exact:false};
const documents=new Map();window.events=[];
function doc(key){if(!documents.has(key))documents.set(key,'<!doctype html><style>html,body{margin:0}button{position:absolute;left:30px;top:20px;width:120px;height:40px}.addons__intro{display:grid}@media(max-width:480px){.addons__intro{display:none}}@media(min-width:480px){#min{color:rgb(1,2,3)}}</style><div class="addons__intro">Mobile Hide '+key+'</div><div id="min">Inclusive min</div><button>Click '+key+'</button><script>document.querySelector("button").onclick=()=>parent.postMessage({type:"clicked",key:'+JSON.stringify(key)+'},"*");parent.postMessage({type:"html-editor-buffer-visuals-ready"},"*");<\\/script>');return documents.get(key)}
const frameRef=node=>{window.activeNode=node};
window.render=(next={})=>{props={...props,...next};const frame=<HtmlBufferedIframe iframeRef={frameRef} documentKey={props.key} surfaceKey="same-page" srcDoc={doc(props.key)} title="Exact viewport" sandbox="allow-scripts" visualReady={props.ready} onPromote={(_,key)=>window.events.push(key)} className="frame"/>;flushSync(()=>root.render(<div id="shell" style={{width:props.width,height:333,position:'relative',transform:'scale(1.29)',transformOrigin:'0 0'}}>{props.exact?<HtmlExactViewport width={props.width} height={333}>{frame}</HtmlExactViewport>:frame}</div>))};
window.unmount=()=>flushSync(()=>root.render(null));window.messages=[];addEventListener('message',event=>window.messages.push(event.data));
window.render();window.ready=true;
` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
const server = http.createServer((req, res) => res.writeHead(200, {'content-type':'text/html'}).end(`<style>body{margin:0}.frame{width:100%;height:100%;border:0;display:block}.absolute{position:absolute}.left-0{left:0}.top-0{top:0}.inset-0{inset:0}.origin-top-left{transform-origin:0 0}.relative{position:relative}.pointer-events-none{pointer-events:none}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const evidence=[];
try {
  for(const density of (process.env.KODETY_TEST_BROWSER==='webkit'?[]:[1,1.25,2])){
    const session=await launchBrowserWithPageZoom({viewport:{width:1800,height:1100},deviceScaleFactor:density});
    try {
      const page=await session.context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>window.ready);
      await session.setPageZoom(page,1.21);
      await page.waitForFunction(density=>Math.abs(devicePixelRatio-density*1.21)<.001,density);
      const baseline=await page.frameLocator('iframe').locator('html').evaluate(n=>({rect:n.getBoundingClientRect().width,max:matchMedia('(max-width:480px)').matches}));
      assert.equal(baseline.max,false,'real browser zoom must reproduce the original media-query failure '+JSON.stringify({density,baseline}));
      await page.evaluate(()=>window.render({exact:true}));
      await page.waitForFunction(()=>document.querySelector('[data-html-exact-viewport]'));
      const frame=page.frameLocator('iframe');
      await frame.locator('html').evaluate(()=>{});
      const documentFrame=page.frames().find(candidate=>candidate.parentFrame());
      await page.evaluate(()=>window.originalFrame=window.activeNode.contentWindow);
      for(const zoom of [.67,1,1.1,1.21,1.37,1.75,2.5]){
        await session.setPageZoom(page,zoom);
        await page.waitForFunction(({density,zoom})=>Math.abs(devicePixelRatio-density*zoom)<.001,{density,zoom});
        for(const width of [375,480,810,1001]){
          await page.evaluate(width=>window.render({width}),width);
          await documentFrame.waitForFunction(width=>innerWidth===width,width,{timeout:3000});
          const measured=await frame.locator('html').evaluate((n,width)=>({rect:n.getBoundingClientRect().width,inner:innerWidth,min:matchMedia('(min-width:'+width+'px)').matches,max:matchMedia('(max-width:'+width+'px)').matches,height:matchMedia('(height:333px)').matches,display:getComputedStyle(document.querySelector('.addons__intro')).display,minColor:getComputedStyle(document.querySelector('#min')).color}),width);
          assert.equal(measured.min,true,JSON.stringify({density,zoom,width,measured}));assert.equal(measured.max,true,JSON.stringify({density,zoom,width,measured}));assert.equal(measured.height,true);
          assert.equal(measured.display,width<=480?'none':'grid');if(width>=480)assert.equal(measured.minColor,'rgb(1, 2, 3)');
          const rect=await page.locator('iframe').boundingBox();assert.ok(Math.abs(rect.width-width*1.29)<.1,'visual scale must remain unchanged');
          assert.equal(await page.evaluate(()=>window.activeNode.contentWindow===window.originalFrame),true,'zoom and breakpoint resizing must retain the document');
          evidence.push({density,zoom,width,inner:measured.inner,min:measured.min,max:measured.max});
        }
      }
      await session.setPageZoom(page,1.21);await page.evaluate(()=>window.render({width:480,key:'B',ready:false}));
      await page.waitForFunction(()=>document.querySelectorAll('iframe').length===2);
      assert.equal(await page.evaluate(()=>window.activeNode.contentWindow===window.originalFrame),true,'pending document cannot take command ownership');
      for(const child of page.frames().filter(frame=>frame.parentFrame())){
        await child.waitForFunction(()=>matchMedia('(width:480px)').matches&&getComputedStyle(document.querySelector('.addons__intro')).display==='none');
      }
      await page.evaluate(()=>window.render({ready:true}));await page.waitForFunction(()=>window.events.includes('B')&&document.querySelectorAll('iframe').length===1);
      await page.frameLocator('iframe').getByRole('button',{name:'Click B'}).click();await page.waitForFunction(()=>window.messages.some(message=>message.type==='clicked'&&message.key==='B'));
      assert.deepEqual(errors,[]);await page.evaluate(()=>window.unmount());assert.equal(await page.locator('iframe').count(),0);
    } finally {await session.close()}
  }
  // WebKit has the same fractional viewport under CSS zoom. This also checks
  // the measurement without depending on Chromium's tabs extension API.
  const browser=await webkit.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1800,height:1100},deviceScaleFactor:2});await page.goto(url);await page.waitForFunction(()=>window.ready);
    await page.evaluate(()=>{document.documentElement.style.zoom='1.21';window.render({exact:true,width:375})});
    await page.waitForFunction(()=>Number.parseFloat(document.querySelector('[data-html-exact-viewport]>div').style.zoom)<.9);
    const frame=page.frameLocator('iframe');await frame.locator('html').evaluate(()=>{});
    const webkitState=await frame.locator('html').evaluate(n=>({exact:matchMedia('(width:375px)').matches,inner:innerWidth,rect:n.getBoundingClientRect().width,dpr:devicePixelRatio}));
    assert.equal(webkitState.exact,true,JSON.stringify({webkitState,correction:await page.locator('[data-html-exact-viewport]>div').getAttribute('style')}));
    await page.evaluate(()=>window.render({width:480}));assert.equal(await frame.locator('html').evaluate(()=>matchMedia('(width:480px)').matches),true);
    assert.equal(await frame.locator('.addons__intro').evaluate(n=>getComputedStyle(n).display),'none');
  } finally {await browser.close()}
  const sourceSha256=createHash('sha256').update(await readFile('app/(builder)/kodety/html-editor/components/HtmlExactViewport.tsx')).digest('hex');
  const output='artifacts/kodety-performance-2026-09/exact-viewport'+(evidence.length?'':'-webkit');await mkdir(output,{recursive:true});await writeFile(output+'/exact-viewport-report.json',JSON.stringify({result:'passed',sourceSha256,finishedAt:new Date().toISOString(),mechanism:'chrome.tabs.setZoom (real browser page zoom)',cases:evidence,webkitCssZoom:true,bufferedPromotion:Boolean(evidence.length),pointerHitTesting:Boolean(evidence.length)},null,2)+'\n');
  console.log(evidence.length?'Exact viewport browser tests passed: '+evidence.length+' real page zoom/density/width cases, min/max boundaries, retained A/B, native pointer and WebKit CSS zoom.':'Exact viewport WebKit CSS zoom tests passed.');
} finally {await new Promise(resolve=>server.close(resolve))}
