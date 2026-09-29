import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {HtmlBufferedIframe} from './app/(builder)/kodety/html-editor/components/HtmlBufferedIframe';
const root=createRoot(document.querySelector('#root'));
let props={key:'A',ready:true};
const motion={effect:'slide-left',duration:.6,easing:'ease-in-out'};
const active=node=>window.activeNode=node;
window.events=[];
window.render=(next={})=>{props={...props,...next};flushSync(()=>root.render(<HtmlBufferedIframe documentKey={props.key} surfaceKey={props.key} documentRevision={1} srcDoc={'<main>'+props.key+'</main>'} iframeRef={active} title="Motion fixture" sandbox="allow-scripts" style={{width:800,height:500,border:0}} visualReady={props.ready} promotionTransition={motion} onInitialVisualReady={(_,key)=>window.events.push(['initial',key])} onPromote={(_,key)=>window.events.push(['promote',key])}/>))};
window.unmount=()=>flushSync(()=>root.render(null));window.render();window.ready=true;
` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
const server=http.createServer((req,res)=>res.writeHead(200,{'content-type':'text/html'}).end(`<style>#root{width:800px;height:500px;position:relative}.absolute{position:absolute}.inset-0{inset:0}.relative{position:relative}.pointer-events-none{pointer-events:none}.z-0{z-index:0}[class*="z-[1]"]{z-index:1}[class*="z-[3]"]{z-index:3}[class*="opacity-[0.01]"]{opacity:.01}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
 const signal=async(key,type='html-editor-buffer-visuals-ready')=>{
  await page.waitForFunction(key=>Array.from(document.querySelectorAll('iframe')).some(node=>node.srcdoc===`<main>${key}</main>`),key);
  for(const candidate of page.frames().filter(frame=>frame.parentFrame()))if(await candidate.locator('main').textContent().catch(()=>null)===key){await candidate.evaluate(type=>parent.postMessage({type},'*'),type);return;}
  throw new Error('Missing frame '+key);
 };
 const paints=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await signal('A');await page.waitForFunction(()=>window.events.some(([kind,key])=>kind==='initial'&&key==='A'));
 await page.evaluate(()=>window.render({key:'B',ready:false}));await signal('B','html-editor-buffer-ready');await paints();
 assert.equal(await page.evaluate(()=>window.activeNode.srcdoc),'<main>A</main>');
 assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='promote')),[],'DOM-ready alone cannot promote a buffered page');
 await signal('B');await paints();
 assert.equal(await page.evaluate(()=>window.activeNode.srcdoc),'<main>A</main>','host visualReady=false must retain the outgoing document');
 await page.evaluate(()=>window.render({ready:true}));
 await page.waitForFunction(()=>{const incoming=Array.from(document.querySelectorAll('iframe')).find(node=>node.srcdoc==='<main>B</main>');const opacity=Number(getComputedStyle(incoming).opacity);return opacity>.1&&opacity<.9;});
 assert.equal(await page.evaluate(()=>window.activeNode.srcdoc),'<main>A</main>','intermediate interpolation must not change command ownership');
 const intermediate=await page.evaluate(()=>Array.from(document.querySelectorAll('iframe')).map(node=>({doc:node.srcdoc,opacity:Number(getComputedStyle(node).opacity),transform:getComputedStyle(node).transform})));
 assert.ok(intermediate.some(value=>value.opacity>0&&value.opacity<1&&value.transform!=='none'));
 await page.waitForFunction(()=>window.events.some(([kind,key])=>kind==='promote'&&key==='B'));
 assert.equal(await page.locator('iframe').count(),1);
 assert.equal(await page.locator('iframe').evaluate(node=>getComputedStyle(node).opacity),'1');
 await page.evaluate(()=>window.render({key:'C'}));await signal('C');
 await page.waitForFunction(()=>document.getAnimations().some(animation=>animation.playState==='running'));
 await page.evaluate(()=>{window.staleWindow=Array.from(document.querySelectorAll('iframe')).find(node=>node.srcdoc==='<main>C</main>').contentWindow;window.render({key:'D'});});
 await paints();
 assert.equal(await page.evaluate(()=>window.activeNode.srcdoc),'<main>B</main>');
 assert.equal(await page.evaluate(()=>getComputedStyle(window.activeNode).opacity),'1','superseding an animation must restore the outgoing frame');
 await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.staleWindow,data:{type:'html-editor-buffer-visuals-ready'}})));
 await signal('D');await page.waitForFunction(()=>window.events.some(([kind,key])=>kind==='promote'&&key==='D'));
 assert.equal(await page.evaluate(()=>window.events.some(([kind,key])=>kind==='promote'&&key==='C')),false,'superseded frame cannot promote from late callbacks');
 assert.equal(await page.evaluate(()=>window.activeNode.srcdoc),'<main>D</main>');
 assert.equal(await page.locator('iframe').count(),1);
 await page.evaluate(()=>window.unmount());
 assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
 assert.deepEqual(errors,[]);
 console.log('Buffered Motion passed: strong readiness, intermediate frames, command ownership, superseded navigation, stale messages and unmount cleanup.');
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
