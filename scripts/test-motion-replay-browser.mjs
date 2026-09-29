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
const output = argument('--output') || path.join(root, 'artifacts/kodety-performance-2026-09/motion-replay');
await mkdir(output, { recursive: true });


const bundle = await build({
  stdin: { contents: `import {buildPreview} from './lib/html-editor/preview'; window.buildPreview=buildPreview;`, resolveDir: root, loader: 'ts' },
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
const browser = await browserType.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
    const html=`<!doctype html><html><head><style>.owned{opacity:.75}main{display:grid;grid-template-columns:repeat(10,1fr)}</style></head><body><main>${Array.from({length:240},(_,index)=>`<section data-reveal><h2 data-kodety-motion class="owned" id="node-${index}" style="opacity:.2!important">Item ${index}</h2><p>Content</p></section>`).join('')}</main></body></html>`;
    const project={name:'Motion replay',mainHtmlPath:'index.html',rootPath:'',openedAt:1,files:{'index.html':{path:'index.html',text:html,mimeType:'text/html'}}};
    const preview=window.buildPreview(project,true,[],false,[],true,null,'motion-replay',1,true);
    window.messages=[];addEventListener('message',event=>window.messages.push(event.data));
    const iframe=document.createElement('iframe');iframe.id='canvas';iframe.setAttribute('sandbox','allow-scripts');iframe.srcdoc=preview.html;iframe.style.cssText='width:1400px;height:900px';document.body.append(iframe);
  });
  await page.waitForFunction(()=>window.messages.some(message=>message.type==='html-editor-canvas-ready'));
  const frame=page.frames().find(candidate=>candidate.parentFrame());
  const settle=()=>page.waitForTimeout(350);
  await settle();
  await frame.evaluate(()=>{
    window.replays=0;window.mutations=0;
    const reapply=window.__KODETY_REAPPLY_EDITOR_LIVE_STATE__;
    window.__KODETY_REAPPLY_EDITOR_LIVE_STATE__=(...args)=>{window.replays++;return reapply(...args)};
    window.mutationObserver=new MutationObserver(mutations=>window.mutations+=mutations.length);
    window.mutationObserver.observe(document.body,{subtree:true,attributes:true,childList:true});
  });
  await settle();
  const idle=await frame.evaluate(()=>({replays:window.replays,mutations:window.mutations}));
  await settle();
  assert.deepEqual(await frame.evaluate(()=>({replays:window.replays,mutations:window.mutations})),idle,'motion normalization must converge even with no editor-owned properties');
  await page.evaluate(()=>document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-view-state',generation:'motion-replay',state:{protocol:1,kind:'snapshot',epoch:1,version:1,revision:1,stylesheets:[],patches:[],attributes:[],texts:[],ownerships:[{scope:'selector',target:'.owned',property:'opacity',owned:true}]}},'*'));
  await settle();
  assert.equal(await frame.locator('#node-0').evaluate(element=>getComputedStyle(element).opacity),'0.75','rule ownership must remove the original important inline declaration');
  const idempotence=await frame.evaluate(()=>{
    window.mutationObserver.takeRecords();
    window.__KODETY_REAPPLY_EDITOR_LIVE_STATE__(document);
    return window.mutationObserver.takeRecords().length;
  });
  assert.equal(idempotence,0,'replaying the same complete state must not mutate attributes or styles');
  await frame.evaluate(()=>{
    window.replays=0;
    document.querySelectorAll('section').forEach(element=>element.style.transitionProperty='all');
  });
  await settle();
  const batch=await frame.evaluate(()=>({replays:window.replays,mutations:window.mutations}));
  assert.ok(batch.replays<=3,`240 changed roots must share one global authority replay (observed ${batch.replays})`);
  await settle();
  assert.deepEqual(await frame.evaluate(()=>({replays:window.replays,mutations:window.mutations})),batch,'settlement must converge, with no idle mutation/replay feedback');
  await frame.evaluate(()=>{
    const target=document.querySelector('#node-0');
    target.style.setProperty('opacity','0','important');
  });
  await settle();
  assert.equal(await frame.locator('#node-0').evaluate(element=>getComputedStyle(element).opacity),'0.75','late runtime styles must not override editor rule authority');
  await page.evaluate(()=>document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-view-state',generation:'motion-replay',state:{protocol:1,kind:'snapshot',epoch:1,version:2,revision:2,stylesheets:[],patches:[],attributes:[],texts:[],ownerships:[]}},'*'));
  await settle();
  const restored=await frame.locator('#node-0').evaluate(element=>({value:element.style.getPropertyValue('opacity'),priority:element.style.getPropertyPriority('opacity'),marker:element.hasAttribute('data-html-editor-canvas-rule-property-opacity')}));
  assert.deepEqual(restored,{value:'0.2',priority:'important',marker:false},'releasing rule ownership must restore the exact authored inline priority');
  const targetPath=await frame.locator('#node-0').getAttribute('data-html-editor-path');
  await page.evaluate(targetPath=>document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-view-state',generation:'motion-replay',state:{protocol:1,kind:'snapshot',epoch:1,version:3,revision:3,stylesheets:[],patches:[{path:targetPath,property:'--Gap',value:'13px'},{path:targetPath,property:'--gap',value:'7px'},{path:targetPath,property:'color',value:'rgb(1,2,3)'},{path:targetPath,property:'padding',value:'0'}],attributes:[],texts:[],ownerships:[]}},'*'),targetPath);
  await settle();
  assert.deepEqual(await frame.locator('#node-0').evaluate(element=>[element.style.getPropertyValue('--Gap'),element.style.getPropertyValue('--gap')]),['13px','7px'],'custom-property atoms with distinct case must not overwrite each other');
  await frame.locator('#node-0').evaluate(element=>element.style.removeProperty('--Gap'));
  await settle();
  assert.deepEqual(await frame.locator('#node-0').evaluate(element=>[element.style.getPropertyValue('--Gap'),element.style.getPropertyValue('--gap')]),['13px','7px'],'mutation recovery must preserve both custom-property atoms');
  const normalizedIdempotence=await frame.evaluate(()=>{
    window.mutationObserver.takeRecords();
    window.__KODETY_REAPPLY_EDITOR_LIVE_STATE__(document);
    return window.mutationObserver.takeRecords().length;
  });
  assert.equal(normalizedIdempotence,0,'equivalent CSSOM serialization (compact rgb and unitless zero) must be idempotent');
  assert.deepEqual(errors,[]);
  const report={sourceSha256:createHash('sha256').update(source).digest('hex'),browser:browser.version(),idempotentMutations:idempotence,batch,restored};
  await writeFile(path.join(output,'motion-replay-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {await browser.close();}
