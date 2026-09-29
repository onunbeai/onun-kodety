import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit,firefox} from 'playwright';
const browserName=process.env.KODETY_TEST_BROWSER||'chromium';
const browserType={chromium,webkit,firefox}[browserName];
assert.ok(browserType);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {HtmlInfiniteCanvas} from './app/(builder)/kodety/html-editor/components/HtmlInfiniteCanvas';
const root=createRoot(document.querySelector('#root'));
const source=(key,withAsset=false)=>'<html><body data-generation="'+key+'" style="margin:0;background:#235c41;color:white"><main>'+key+'</main>'+(withAsset?'<img id="pending-image">':'')+'<script>let released=false,decoded='+JSON.stringify(!withAsset||key==='A')+';const ready=()=>{if(released&&decoded)parent.postMessage({type:"html-editor-buffer-visuals-ready"},"*")};parent.postMessage({type:"html-editor-buffer-ready"},"*");addEventListener("message",event=>{const data=event.data;if(data?.type==="release-paint"){released=true;ready()}if(data?.type==="html-editor-runtime-assets"&&data.generation===document.body.dataset.generation){const image=document.querySelector("#pending-image");if(!image)return;image.onload=()=>{decoded=true;parent.postMessage({type:"fixture-asset-decoded",generation:data.generation,width:image.naturalWidth},"*");ready()};image.src=URL.createObjectURL(new Blob([data.assets[0].bytes],{type:data.assets[0].mimeType}))}});</scr'+'ipt></body></html>';
function Fixture({generation,active='base'}){
 const iframeRef=useRef(null);
 return <HtmlInfiniteCanvas frames={[{id:'base',label:'Desktop',detail:'900',width:900,height:700},{id:'tablet',label:'Tablet',detail:'800',width:800,height:700},{id:'mobile',label:'Mobile',detail:'400',width:400,height:700}]} activeId={active} documentKey={generation} html={source(generation,true)} passiveHtml={source(generation)} sandbox="allow-scripts" iframeRef={iframeRef} viewPreferenceKey="retained-fixture" onInfiniteCanvasChange={()=>{}} onSelectFrame={()=>{}} onActiveFrameLoad={()=>{}} onActiveFrameBufferedLoad={(node,key)=>{window.bufferedGenerations.push(key);node.contentWindow.postMessage({type:'html-editor-runtime-assets',generation:key,assets:[{path:'fixture.svg',mimeType:'image/svg+xml',bytes:new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="red"/></svg>')}]},'*')}} onPassiveFrameRegister={(node,registered,id)=>{window.registrations.push({node,registered,id})}} onPassiveFrameLoad={(node,id)=>{window.loads.push({node,id})}}/>
}
window.registrations=[];window.loads=[];window.bufferedGenerations=[];window.assetMessages=[];addEventListener("message",event=>{if(event.data?.type==="fixture-asset-decoded")window.assetMessages.push(event.data)});
window.render=(generation,active)=>flushSync(()=>root.render(<Fixture generation={generation} active={active}/>));
window.unmount=()=>flushSync(()=>root.render(null));
window.ready=true;
`},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
const server=http.createServer((req,res)=>res.writeHead(200,{'content-type':'text/html'}).end(`<style>#root{width:1100px;height:850px;position:relative}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.size-full{width:100%;height:100%}.block{display:block}[class*="opacity-[0.01]"]{opacity:.01}[class*="z-[1]"]{z-index:1}[class*="z-0"]{z-index:0}iframe{border:0}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await browserType.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready);
 const references=page.locator('iframe[title$="referência responsiva"]');
 await page.evaluate(()=>window.render('A'));
 await page.waitForFunction(()=>window.loads.length>=3);
 const release=()=>page.evaluate(()=>document.querySelectorAll('iframe').forEach(node=>node.contentWindow.postMessage({type:'release-paint'},'*')));
 await release();await page.waitForTimeout(100);
 await page.evaluate(()=>window.painted=Array.from(document.querySelectorAll('iframe[title$="referência responsiva"]')));
 await page.evaluate(()=>window.render('B'));
 await page.waitForFunction(()=>window.assetMessages.some(message=>message.generation==='B'&&message.width===60));
 assert.equal(await page.evaluate(()=>window.bufferedGenerations.includes('B')),true,'buffered active assets must use the original generation, excluding the React mount suffix');
 await page.waitForFunction(()=>document.querySelectorAll('iframe[title$="referência responsiva"]').length===6);
 assert.equal(await page.evaluate(()=>window.painted.every(node=>node.isConnected&&node.srcdoc.includes('data-generation="A"')&&node.className.includes('relative z-[1]'))),true,'each painted reference must stay mounted while the replacement loads');
 await page.evaluate(()=>window.pendingB=Array.from(document.querySelectorAll('iframe[title$="referência responsiva"]')).filter(node=>node.srcdoc.includes('data-generation="B"')));
 await page.evaluate(()=>window.render('C'));
 await page.waitForFunction(()=>window.assetMessages.some(message=>message.generation==='C'&&message.width===60));
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('iframe[title$="referência responsiva"]')).filter(node=>node.srcdoc.includes('data-generation="C"')).length===3);
 assert.equal(await page.evaluate(()=>window.pendingB.every(node=>!node.isConnected)),true,'superseded pending generations must be released immediately');
 await page.evaluate(()=>window.pendingB.forEach(node=>window.dispatchEvent(new MessageEvent('message',{source:node.contentWindow,data:{type:'html-editor-buffer-visuals-ready'}}))));
 await page.waitForTimeout(80);
 assert.equal(await page.evaluate(()=>window.painted.every(node=>node.isConnected)),true,'stale ready cannot replace the painted references');
 await release();
 await page.waitForFunction(()=>document.querySelectorAll('iframe[title$="referência responsiva"]').length===3);
 assert.equal(await page.evaluate(()=>window.painted.every(node=>!node.isConnected)),true,'promotion must release old reference browsing contexts');
 assert.equal(await references.evaluateAll(nodes=>nodes.every(node=>node.srcdoc.includes('data-generation="C"'))),true);
 await page.evaluate(()=>window.referencesC=Array.from(document.querySelectorAll('iframe[title$="referência responsiva"]')));
 await page.evaluate(()=>window.render('C','tablet'));
 assert.equal(await page.evaluate(()=>window.referencesC.every(node=>node.isConnected)),true,'switching the editable breakpoint must retain all references');
 await page.evaluate(()=>window.render('D','tablet'));await page.waitForTimeout(60);
 assert.ok(await references.count()<=6,'references retain at most one painted and one pending document per breakpoint');
 await release();await page.waitForFunction(()=>document.querySelectorAll('iframe[title$="referência responsiva"]').length===3);
 assert.equal(await page.evaluate(()=>window.bufferedGenerations.every(generation=>!generation.endsWith(':active-editor'))),true);
 await page.evaluate(()=>window.unmount());assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(errors,[]);
 console.log('Infinite Canvas passive buffering passed: previous surface, stale readiness, bounded retention, breakpoint switch, promotion and cleanup.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
