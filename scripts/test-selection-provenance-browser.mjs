import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit, firefox } from 'playwright';
import { buildCodeComponentReactRuntime } from './vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const sourcePath = argument('--source') || path.join(root, 'lib/html-editor/preview.ts');
const source = await readFile(sourcePath, 'utf8');
const output = argument('--output') || path.join(root, 'artifacts/kodety-performance-2026-09/provenance');
await mkdir(output, { recursive: true });

const bundle = await build({
  stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {buildPreview} from './lib/html-editor/preview';
import {HtmlBufferedIframe} from './app/(builder)/kodety/html-editor/components/HtmlBufferedIframe';
window.buildPreview=buildPreview;
window.setupBufferedHandoff=()=>{
  const host=document.createElement('div');host.style.cssText='position:relative;width:480px;height:700px';document.body.append(host);
  const styles=document.createElement('style');styles.textContent='.absolute{position:absolute}.inset-0{inset:0}.pointer-events-none{pointer-events:none}';document.head.append(styles);
  const root=createRoot(host), previews=new Map();
  const css='.addons__intro{display:grid;row-gap:38px}';
  const project={name:'Buffered Hide',mainHtmlPath:'index.html',rootPath:'',openedAt:1,files:{
    'index.html':{path:'index.html',mimeType:'text/html',text:'<!doctype html><html><head><link rel="stylesheet" href="components.css?v=pricing-dialog-dark-svg-1"></head><body><div class="addons__intro" data-kodety-interaction-id="addons-copy">Mobile content</div></body></html>'},
    'components.css':{path:'components.css',mimeType:'text/css',text:css}
  }};
  let latest={protocol:1,kind:'snapshot',epoch:1,version:1,revision:1,stylesheets:[{path:'components.css',cssText:css}],patches:[],attributes:[],texts:[],ownerships:[]};
  let authority=null;
  window.bufferedEvents=[];
  const hydrate=(node,key)=>{
    authority={node,key};window.bufferedAuthority=authority;
    node.contentWindow.postMessage({type:'html-editor-view-state',generation:key,breakpointId:'mobile',state:latest},'*');
    window.bufferedEvents.push({key,version:latest.version});
  };
  const ref=node=>{window.bufferedNode=node};
  window.renderBuffered=(key,ready)=>{
    if(!previews.has(key))previews.set(key,buildPreview(project,true,[],false,[],true,null,key,1,true).html);
    flushSync(()=>root.render(<HtmlBufferedIframe documentKey={key} surfaceKey="same-page" documentRevision={1} srcDoc={previews.get(key)} iframeRef={ref} title="Buffered mobile" sandbox="allow-scripts" style={{width:480,height:700,border:0}} visualReady={ready} onLoad={(event,key)=>hydrate(event.currentTarget,key)} onPromote={hydrate}/>));
  };
  window.hideBuffered=()=>{
    latest={...latest,version:2,revision:2,stylesheets:[{path:'components.css',cssText:css+'@media(max-width:480px){.addons__intro{display:none}}@media(max-width:767px){.addons__intro{row-gap:12px}}'}]};
    hydrate(authority.node,authority.key);
  };
  window.unmountBuffered=()=>flushSync(()=>root.unmount());
};
`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  plugins: [{ name: 'selection-profiler', setup(builder) {
    builder.onLoad({ filter: /lib\/html-editor\/preview\.ts$/ }, () => ({ contents: source, loader: 'ts', resolveDir: path.join(root, 'lib/html-editor') }));
    builder.onResolve({ filter: /^virtual:coday-react-runtime$/ }, () => ({ path: 'runtime', namespace: 'profile-runtime' }));
    builder.onLoad({ filter: /.*/, namespace: 'profile-runtime' }, async () => ({ contents: `export default ${JSON.stringify(await buildCodeComponentReactRuntime())}` }));
    builder.onResolve({ filter: /\?raw$/ }, options => ({ path: options.path.startsWith('.') ? path.resolve(options.resolveDir, options.path.slice(0, -4)) : require.resolve(options.path.slice(0, -4)), namespace: 'profile-raw' }));
    builder.onLoad({ filter: /.*/, namespace: 'profile-raw' }, async options => ({ contents: await readFile(options.path, 'utf8'), loader: 'text' }));
  } }],
});
const browserType={chromium,webkit,firefox}[process.env.KODETY_TEST_BROWSER||'chromium'];
assert.ok(browserType);
const browser = await browserType.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:950}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
    const files={
      'index.html':'<!doctype html><html><head><link rel="stylesheet" href="a.css?v=pricing-dialog-dark-svg-1"><link rel="stylesheet" href="b.css"></head><body><main class="outer"><div class="inner" style="container:card / inline-size;width:800px"><h1 id="target" class="target addons__intro" data-kodety-interaction-id="addons-copy" style="--InlineCase:4px">Cascade target</h1></div><p id="other">Other target</p></main></body></html>',
      'a.css':'@layer early,late; @layer early{#target{color:rgb(255,0,0)!important;--Gap:11px;--gap:22px}} @scope (.outer){#target{letter-spacing:1px}} @container card (min-width:600px){#target{padding-left:24px}} #target{margin-left:3px}',
      'b.css':'@layer late{#target{color:rgb(0,0,255)!important}} @scope (.inner){#target{letter-spacing:2px}} .target,#target{border-left-width:7px;border-left-style:solid} #target:hover{border-left-width:13px} @media(min-width:1000px){#target{margin-left:30px}}'
    };
    window.fixtureStyles=files;
    const project={name:'Cascade provenance',mainHtmlPath:'index.html',rootPath:'',openedAt:1,files:Object.fromEntries(Object.entries(files).map(([path,text])=>[path,{path,text,mimeType:path.endsWith('.css')?'text/css':'text/html'}]))};
    const preview=window.buildPreview(project,true,[],false,[],true,null,'provenance',1,true);
    window.messages=[];addEventListener('message',event=>window.messages.push(event.data));
    const iframe=document.createElement('iframe');iframe.id='canvas';iframe.style.cssText='width:1300px;height:850px';iframe.setAttribute('sandbox','allow-scripts');iframe.srcdoc=preview.html;document.body.append(iframe);
  });
  await page.waitForFunction(()=>window.messages.some(message=>message.type==='html-editor-canvas-ready'));
  const frame=page.frames().find(candidate=>candidate.parentFrame());
  let lastSequence=0;
  const snapshot=async()=>{
    await frame.locator('#other').click();
    await frame.locator('#target').click();
    const expected=await frame.locator('#target').getAttribute('data-html-editor-path');
    const handle=await page.waitForFunction(({expected,lastSequence})=>window.messages.findLast(message=>message.type==='html-editor-selection'&&message.detail==='computed'&&message.selectionSequence>lastSequence&&message.payload.path===expected),{expected,lastSequence});
    const message=await handle.jsonValue();await handle.dispose();lastSequence=message.selectionSequence;return message.payload;
  };
  const first=await snapshot();
  assert.equal(first.computedStyle.color,'rgb(255, 0, 0)');
  assert.deepEqual(first.styleOrigins.color,{selector:'#target',cssPath:'a.css',property:'color',important:true,inline:false},'earlier important layer must own color');
  assert.equal(first.computedStyle['letter-spacing'],'2px');assert.equal(first.styleOrigins['letter-spacing'].cssPath,'b.css','nearest @scope must win');
  assert.equal(first.computedStyle['padding-left'],'24px');assert.equal(first.styleOrigins['padding-left'].cssPath,'a.css');
  assert.equal(first.computedStyle['margin-left'],'30px');assert.equal(first.styleOrigins['margin-left'].cssPath,'b.css');
  assert.equal(first.styleOrigins['border-left-width'].selector,'#target','grouped selector uses strongest matching branch and incidental hover must not redirect the base edit');
  assert.equal(first.computedStyle['border-left-width'],'13px','computed truth must still reflect actual browser hover');
  assert.equal(first.computedStyle['--Gap'],'11px');assert.equal(first.computedStyle['--gap'],'22px');
  assert.equal(first.styleOrigins['--Gap'].property,'--Gap');assert.equal(first.styleOrigins['--gap'].property,'--gap');
  assert.equal(first.styleOrigins['--InlineCase'].inline,true);
  await frame.locator('.inner').evaluate(element=>element.style.width='400px');
  await page.locator('#canvas').evaluate(element=>element.style.width='750px');
  const resized=await snapshot();
  assert.equal(resized.computedStyle['padding-left'],'0px');assert.equal(resized.styleOrigins['padding-left'],undefined,'inactive container query must not keep stale ownership');
  assert.equal(resized.computedStyle['margin-left'],'3px');assert.equal(resized.styleOrigins['margin-left'].cssPath,'a.css','breakpoint change must resolve fresh browser cascade');
  await frame.evaluate(()=>document.querySelector('style[data-editor-source="a.css"]').sheet.disabled=true);
  const disabled=await snapshot();
  assert.equal(disabled.computedStyle.color,'rgb(0, 0, 255)');assert.equal(disabled.styleOrigins.color.cssPath,'b.css','disabled stylesheet cannot retain previous ownership');
  await page.evaluate(()=>{
    document.querySelector('#canvas').style.width='480px';
    const css=window.fixtureStyles['b.css']+' .addons__intro{display:grid;row-gap:38px}@media(max-width:480px){.addons__intro{display:none}}@media(max-width:767px){.addons__intro{row-gap:12px}}';
    document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-view-state',generation:'provenance',breakpointId:'mobile',state:{protocol:1,kind:'snapshot',epoch:1,version:1,revision:2,stylesheets:[{path:'b.css',cssText:css}],patches:[],attributes:[],texts:[],ownerships:[]}},'*');
  });
  await frame.waitForFunction(()=>innerWidth===480&&getComputedStyle(document.querySelector('.addons__intro')).display==='none');
  await frame.evaluate(()=>window.__KODETY_SETTLE_EDITOR_MOTION__(document));
  await page.waitForTimeout(100);
  assert.equal(await frame.locator('.addons__intro').evaluate(element=>getComputedStyle(element).display),'none','motion settling must preserve responsive Hide on an interaction-marked element');
  await page.locator('#canvas').evaluate(element=>element.style.width='810px');
  await frame.waitForFunction(()=>innerWidth===810&&getComputedStyle(document.querySelector('.addons__intro')).display==='grid');
  assert.equal(await frame.locator('.addons__intro').evaluate(element=>element.style.getPropertyValue('display')),'','responsive rule Hide must not leak an inline display atom to another breakpoint');
  await page.locator('#canvas').evaluate(element=>element.remove());
  await page.evaluate(()=>{window.messages=[];window.setupBufferedHandoff();window.renderBuffered('handoff-A',true)});
  await page.waitForFunction(()=>window.bufferedAuthority?.key==='handoff-A'&&window.messages.some(message=>message.type==='html-editor-canvas-ready'&&message.generation==='handoff-A'));
  const bufferedFrame=async key=>{
    const handles=await page.locator('iframe').elementHandles();
    for(const handle of handles){
      if((await handle.getAttribute('srcdoc')).includes('"'+key+'"'))return handle.contentFrame();
    }
    throw new Error('Missing buffered frame '+key);
  };
  const a=await bufferedFrame('handoff-A');
  await a.waitForFunction(()=>innerWidth===480&&getComputedStyle(document.querySelector('.addons__intro')).display==='grid');
  await page.evaluate(()=>window.renderBuffered('handoff-B',false));
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===2&&window.messages.some(message=>message.type==='html-editor-canvas-ready'&&message.generation==='handoff-B'));
  const b=await bufferedFrame('handoff-B');
  await b.waitForFunction(()=>getComputedStyle(document.querySelector('.addons__intro')).display==='grid');
  await page.evaluate(()=>window.hideBuffered());
  await a.waitForFunction(()=>getComputedStyle(document.querySelector('.addons__intro')).display==='none');
  assert.equal(await b.locator('.addons__intro').evaluate(element=>getComputedStyle(element).display),'grid','pending srcDoc deliberately predates the edit');
  assert.equal(await page.evaluate(()=>window.bufferedAuthority.key),'handoff-A','visible generation owns edits while its successor is held');
  await page.evaluate(()=>window.renderBuffered('handoff-B',true));
  await page.waitForFunction(()=>window.bufferedAuthority?.key==='handoff-B'&&window.bufferedEvents.some(event=>event.key==='handoff-B'&&event.version===2));
  await b.waitForFunction(()=>getComputedStyle(document.querySelector('.addons__intro')).display==='none');
  assert.equal(await page.locator('iframe').count(),1,'handoff releases the old browsing context');
  await b.evaluate(()=>window.__KODETY_SETTLE_EDITOR_MOTION__(document));
  assert.equal(await b.locator('.addons__intro').evaluate(element=>getComputedStyle(element).display),'none','promoted generation keeps the latest edit after motion settlement');
  await page.evaluate(()=>window.unmountBuffered());
  assert.deepEqual(errors,[]);
  const report={sourceSha256:createHash('sha256').update(source).digest('hex'),browser:browser.version(),cases:['layer important','scope proximity','container resize','media resize','grouped selector','hover base edit','case-sensitive variables','inline variable','disabled stylesheet','cache-query canonical stylesheet path','responsive Hide survives motion settlement','painted A edited during pending B; promotion hydrates latest mobile Hide snapshot']};
  await writeFile(path.join(output,'selection-provenance-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await browser.close();}
