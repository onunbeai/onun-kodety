import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const fixture = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useHtmlCollaborationPresence} from './app/(builder)/kodety/html-editor/hooks/use-html-collaboration-presence';
    import {useHtmlCollaborationStore} from './stores/useHtmlCollaborationStore';
    import {WordPressEditorLockStatus} from './Wordpress/editor/WordPressEditorLockStatus';
    import {WordPressProjectOpening} from './Wordpress/editor/WordPressProjectOpening';
    window.requests=[];window.notices=[];window.reloads=0;window.fail=false;window.hang=false;window.serverMode='view';window.limited=true;
    window.kodetyEditorSession='session_for_recovery_test';
    window.fetch=async (_url,options)=>{
      const identity=JSON.parse(options.body); window.requests.push({method:options.method,...identity});
      if(options.method==='DELETE')return new Response('{}');
      if(window.hang)return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
      if(window.fail)throw new TypeError('offline');
      return new Response(JSON.stringify({...identity,mode:window.serverMode,limited:window.limited,serverTime:Date.now()+120000,lock:{holderName:'Test Editor',expiresAt:Date.now()+140000}}));
    };
    function Presence(){useHtmlCollaborationPresence({enabled:true,editorLockUrl:'/lock',nonce:'test'});return <WordPressEditorLockStatus/>}
    function App(){const [kind,setKind]=useState('presence');const [loading,setLoading]=useState(false);window.mount=setKind;window.loading=setLoading;return kind==='presence'?<Presence/>:kind==='opening'?<WordPressProjectOpening loading={loading} dashboardUrl='/dashboard' onRetry={()=>setLoading(true)}/>:null}
    window.state=()=>useHtmlCollaborationStore.getState();createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle:true, write:false, format:'iife', platform:'browser', alias:{'@':process.cwd()}, define:{'process.env.NODE_ENV':'"production"'}, logLevel:'silent',
  plugins:[{name:'test-boundaries',setup(build){
    build.onResolve({filter:/^sonner$/},()=>({path:'toast',namespace:'test'}));
    build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const toast={info:(message,options)=>window.notices.push({message,...options}),dismiss:id=>window.notices=window.notices.filter(n=>n.id!==id)};`}));
    build.onLoad({filter:/editor-lock-navigation\.ts$/},()=>({contents:'export function reloadWithEditorLockHandoff(){window.reloads++}',loader:'ts'}));
  }}],
});
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script>'+fixture.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.state?.().status==='conflict');
  assert.equal(await page.getByRole('button',{name:'Verificar agora'}).count(),1);
  await page.evaluate(()=>{window.fail=true});
  await page.clock.runFor(21000);
  assert.deepEqual(await page.evaluate(()=>({status:window.state().status,mode:window.state().mode,holder:window.state().lock.name,notices:window.notices.length})),{status:'reconnecting',mode:null,holder:'',notices:0},'Expired conflict must not claim an absent editor is still present, even with server/client clock skew');
  await page.evaluate(()=>{window.fail=false;window.serverMode='edit';window.limited=false});
  await page.getByRole('button',{name:'Verificar agora'}).click();
  await page.waitForFunction(()=>window.reloads===1);
  assert.equal(await page.evaluate(()=>window.state().mode),'edit','Only a new server confirmation unlocks editing');
  await page.evaluate(()=>window.mount('none'));
  await page.waitForFunction(()=>window.state().status==='idle');
  await page.evaluate(()=>window.mount('presence'));
  await page.waitForFunction(()=>window.state().status==='editing');
  await page.evaluate(()=>{window.fail=true});
  await page.clock.runFor(21000);
  assert.equal(await page.evaluate(()=>window.state().status),'reconnecting','Editing authority also expires on network loss');
  assert.equal(await page.evaluate(()=>window.reloads),1,'Network loss must never trigger a reload or fake handoff');
  await page.evaluate(()=>{window.fail=false;window.hang=true;window.dispatchEvent(new Event('kodety-editor-lock-check'))});
  const before=await page.evaluate(()=>window.requests.filter(r=>r.method==='POST').length);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.clock.runFor(30000);
  assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='POST').length),before,'A departed document must stop heartbeats before releasing its lease');
  assert.ok(await page.evaluate(()=>window.requests.some(r=>r.method==='DELETE')));
  await page.evaluate(()=>window.mount('opening'));
  await page.waitForFunction(()=>document.querySelector('[data-kodety-project-opening]'));
  assert.equal(await page.getByRole('heading',{name:'Não foi possível abrir o projeto'}).count(),1);
  assert.equal(await page.locator('input[type=file]').count(),0);
  assert.equal(await page.getByRole('link',{name:'Voltar ao painel'}).getAttribute('href'),'/dashboard');
  await page.getByRole('button',{name:'Tentar novamente'}).click();
  await page.waitForFunction(()=>!document.querySelector('[role=alert]'));
  assert.equal(await page.locator('[data-kodety-project-opening]').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS: expired conflict/edit authority, offline recovery, explicit recheck, late heartbeat cancellation, WordPress-only opening/retry.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}

// Exercise the actual editor navigation callback, including a save/guard that
// completes after its deadline. It must not navigate later or leave a latch set.
const {readFile}=await import('node:fs/promises');
const ts=(await import('typescript')).default;
const source=await readFile('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx','utf8');
const start=source.indexOf('  const navigateAfterWordPressSave = useCallback(');
const end=source.indexOf('\n  useEffect(',start);
assert.ok(start>0&&end>start);
const compiled=ts.transpileModule(source.slice(start,end)+'\nreturn navigateAfterWordPressSave;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const timeoutSource=await readFile('lib/request-timeout.ts','utf8');
const timeoutCompiled=ts.transpileModule(timeoutSource.replaceAll('export ', '')+'\nreturn withRequestTimeout;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const deadline=new Function(timeoutCompiled)();
for(const pending of ['save','guard','none']) {
  let finish, signalUsed, navigations=0;
  const stalled=new Promise(resolve=>{finish=resolve});
  const environment={
    useCallback:fn=>fn,
    wordpressNavigationPromiseRef:{current:null},wordpressNavigationPendingRef:{current:false},
    explicitWordPressDraftProjectRef:{current:null},projectRef:{current:{id:'draft'}},pendingWordPressDraftProjectRef:{current:null},
    isWordPressRuntime:true,sharedReadOnly:false,projectSignature:project=>project.id,
    runWorkspaceNavigationGuards:()=>pending==='guard'?stalled:Promise.resolve(true),
    persistExactWordPressDraft:async (_snapshot,_replace,signal)=>{signalUsed=signal;if(pending==='save')await stalled},
    scheduleWordPressDraftWrite:()=>{},
    withRequestTimeout:(fn,options)=>deadline(fn,{...options,timeoutMs:25}),
    toast:{loading:()=>1,success:()=>{},error:()=>{},dismiss:()=>{}},
    window:{location:{href:'/editor'},setTimeout},
    navigateWithEditorLockHandoff:href=>{navigations++;environment.window.location.href=href},
  };
  const navigate=new Function(...Object.keys(environment),compiled)(...Object.values(environment));
  assert.equal(await navigate('/cms'),pending==='none');
  if(pending!=='none') {
    assert.equal(environment.wordpressNavigationPendingRef.current,false);
    assert.equal(environment.wordpressNavigationPromiseRef.current,null,'Failed navigation must remain retryable');
    if(signalUsed)assert.equal(signalUsed.aborted,true);
    finish(true);await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(navigations,0,'A late save/guard must never navigate after its transaction expired');
  }else assert.equal(navigations,1);
}
console.log('PASS: bounded navigation, exact save, late ACK/guard rejection and retry latch.');
