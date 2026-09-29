import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit, firefox } from 'playwright';
import { buildCodeComponentReactRuntime } from './vite-code-component-runtime.mjs';
import JSZip from 'jszip';
import { createTimelineProject } from './fixtures/timeline-project.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const sourcePath = argument('--source') || path.join(root, 'lib/html-editor/preview.ts');
const source = await readFile(sourcePath, 'utf8');
const output = argument('--output') || path.join(root, 'artifacts/kodety-performance-2026-09/timeline-motion');
await mkdir(output, { recursive: true });
const fixtureArchive=await JSZip.loadAsync((await createTimelineProject()).archive);
const fixtureFiles=Object.fromEntries(await Promise.all(Object.values(fixtureArchive.files).filter(file=>!file.dir).map(async file=>[file.name,{path:file.name,text:await file.async('string'),mimeType:file.name.endsWith('.html')?'text/html':'application/json'}])));

const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {HtmlExactViewport} from './app/(builder)/kodety/html-editor/components/HtmlExactViewport';import {buildPreview} from './lib/html-editor/preview'; window.buildPreview=buildPreview;window.mountPreview=html=>{const host=document.createElement('div');document.body.append(host);const root=createRoot(host);flushSync(()=>root.render(<HtmlExactViewport width={1000} height={700}><iframe id="canvas" sandbox="allow-scripts" style={{width:1000,height:700,border:0}} srcDoc={html}/></HtmlExactViewport>))};`, resolveDir: root, loader: 'tsx' },
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
const browser=await browserType.launch({headless:true});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html style="zoom:1.21"><style>.absolute{position:absolute}.left-0{left:0}.top-0{top:0}.origin-top-left{transform-origin:0 0}</style><body></body></html>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(files=>{
    const preview=window.buildPreview({name:'Timeline isolation',mainHtmlPath:'index.html',rootPath:'',openedAt:1,files},true,[],false,[],true,null,'timeline-isolation',1,true);
    window.messages=[];addEventListener('message',event=>window.messages.push(event.data));
    window.mountPreview(preview.html);
  },fixtureFiles);
  await page.waitForFunction(()=>window.messages.some(message=>message.type==='html-editor-canvas-ready'));
  await page.waitForFunction(()=>Number.parseFloat(document.querySelector('[data-html-exact-viewport]>div').style.zoom)<.9);
  const frame=page.frames().find(candidate=>candidate.parentFrame());
  await frame.waitForFunction(()=>Boolean(window.__kodetyInteractions?.get('kst-timeline')));
  assert.equal(await frame.evaluate(()=>window.authoredScriptRuns||0),0,'authored JavaScript remains inert in Design');
  const read=()=>frame.locator('#timeline-target').evaluate(element=>({inlineOpacity:element.style.getPropertyValue('opacity'),opacity:Number(getComputedStyle(element).opacity),x:new DOMMatrixReadOnly(getComputedStyle(element).transform).m41,preview:element.hasAttribute('data-html-editor-interaction-preview')}));
  const baseline=await read();
  let sequence=0;
  const control=async(action,time)=>{
    sequence++;
    await page.evaluate(({action,time,sequence})=>document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-interaction-control',generation:'timeline-isolation',interactionIds:['kst-timeline'],action,...(time!==undefined?{time}:{}),__kodetyTimelineSequence:sequence},'*'),{action,time,sequence});
    await page.waitForFunction(sequence=>window.messages.some(message=>message.type==='html-editor-interaction-control-applied'&&message.timelineSequence===sequence),sequence);
  };
  const disturb=()=>process.argv.includes('--only-important')?Promise.resolve():frame.evaluate(()=>{
    document.querySelector('#unrelated').style.opacity='0';
    window.__KODETY_SETTLE_EDITOR_MOTION__(document);
  });
  const approximately=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<.025,`${label}: ${actual} ≠ ${expected}`);
  await control('seek',.5);
  // No global settlement here: it would cancel the CSS animation and hide a
  // BEGIN/observer defect. Hold the native playhead for two authored cycles.
  await page.waitForTimeout(2200);
  approximately((await read()).x,30,'scrub stays fixed without externally settling authored CSS');
  assert.deepEqual(await frame.locator('#timeline-target').evaluate(element=>element.getAnimations().filter(animation=>animation.constructor.name==='CSSAnimation'&&animation.playState==='running').map(animation=>animation.animationName)),[],'authored CSS animation must stay frozen during native Timeline authority');
  await frame.locator('#timeline-target').evaluate(element=>['animation-name','animation-play-state','transition-property'].forEach(property=>element.style.removeProperty(property)));
  await page.waitForTimeout(100);
  assert.deepEqual(await frame.locator('#timeline-target').evaluate(element=>{const style=getComputedStyle(element);return{animation:style.animationName,state:style.animationPlayState,transition:style.transitionProperty}}),{animation:'none',state:'paused',transition:'none'},'style snapshot restoration must repair only the CSS motion freeze while Timeline owns animated values');
  approximately((await read()).x,30,'CSS freeze repair preserves the paused GSAP transform');
  await disturb();await page.waitForTimeout(100);
  const seek=await read();approximately(seek.opacity,.35,'scrub .5s');approximately(seek.x,30,'scrub transform');assert.equal(seek.preview,true);
  await control('play',.5);await disturb();await page.waitForTimeout(220);const playing=await read();assert.ok(playing.opacity>seek.opacity+.035,'Play advances the actual GSAP timeline while source motion remains frozen');
  await control('pause');const paused=await read();await disturb();await page.waitForTimeout(180);approximately((await read()).opacity,paused.opacity,'Pause remains pinned');
  await control('seek',1.5);await disturb();approximately((await read()).opacity,.65,'scrub 1.5s');
  await control('seek',.8);await page.waitForTimeout(160);approximately((await read()).opacity,.44,'Timeline Stop pins the requested playhead');
  await control('restart');await page.waitForTimeout(100);const restarted=await read();assert.ok(restarted.opacity>=.2&&restarted.opacity<.35,'Restart returns to the initial frame and resumes');
  await control('reverse',1.5);await disturb();await page.waitForTimeout(180);assert.ok((await read()).opacity<.63,'Reverse continues across motion settlement');
  await control('reset');await page.waitForTimeout(160);const reset=await read();approximately(reset.opacity,baseline.opacity,'Reset restores pre-preview opacity');approximately(reset.x,baseline.x,'Reset restores pre-preview transform');assert.equal(reset.preview,false);
  await control('play',0);await page.waitForTimeout(80);await control('release');await page.waitForTimeout(160);approximately((await read()).opacity,baseline.opacity,'closing Timeline releases the preview');
  // A committed Design edit must be restored after preview, without allowing
  // its observer to overwrite animated frames while Play owns the target.
  const targetPath=await frame.locator('#timeline-target').getAttribute('data-html-editor-path');
  if(!process.argv.includes('--only-important')) {
  await page.evaluate(targetPath=>document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-view-state',generation:'timeline-isolation',state:{protocol:1,kind:'snapshot',epoch:1,version:1,revision:1,stylesheets:[],patches:[{path:targetPath,property:'opacity',value:'.7'}],attributes:[],texts:[],ownerships:[]}},'*'),targetPath);
  await page.waitForTimeout(120);approximately((await read()).opacity,.7,'committed opacity before preview');
  await control('seek',.5);await disturb();await page.waitForTimeout(120);approximately((await read()).opacity,.35,'manual Timeline frame survives committed-state observer');
  await control('play',.5);await disturb();await page.waitForTimeout(160);assert.ok((await read()).opacity<.65,'live committed-state protection must not force the Design opacity during Play');
  await control('release');await page.waitForTimeout(160);approximately((await read()).opacity,.7,'release restores the latest committed Design edit');
  }
  for(const priority of process.argv.includes('--only-important')?[' !important']:['']) {
    await page.evaluate(({targetPath,priority})=>document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-view-state',generation:'timeline-isolation',state:{protocol:1,kind:'snapshot',epoch:2,version:priority?2:1,revision:priority?3:2,stylesheets:[{path:'rule-edit.css',cssText:'#timeline-target{opacity:.7'+priority+';gap:12px;color:rgb(4,5,6)}'}],patches:[],attributes:[],texts:[],ownerships:[{scope:'selector',target:'#timeline-target',property:'opacity',owned:true}]}},'*'),{targetPath,priority});
    await page.waitForTimeout(160);approximately((await read()).opacity,.7,'rule edit before preview '+priority);
    await control('seek',.5);await disturb();await page.waitForTimeout(120);if(priority){const priorityFrame=await read();console.log(JSON.stringify({priorityFrame}));await writeFile(path.join(output,'timeline-legacy-important-limit.json'),JSON.stringify({status:'known-failure',sourceSha256:createHash('sha256').update(source).digest('hex'),browser:browser.version(),expectedTimelineOpacity:.35,priorityFrame,notes:'Explicit diagnostic outside the normal regression gate. The original 717 baseline reproduces this authored !important cascade limitation without induced settlement.'},null,2)+'\n');}approximately((await read()).opacity,.35,'rule ownership must yield to Timeline '+priority);
    await control('play',.5);await disturb();
    if(!priority) {
      await page.evaluate(targetPath=>document.querySelector('#canvas').contentWindow.postMessage({type:'html-editor-view-state',generation:'timeline-isolation',state:{protocol:1,kind:'delta',epoch:2,version:2,revision:3,stylesheets:[{path:'rule-edit.css',cssText:'#timeline-target{opacity:.7;gap:20px;color:rgb(9,8,7)}'}],patches:[],attributes:[{path:targetPath,name:'title',value:'Updated during Play'}],texts:[{path:targetPath,value:'Updated Timeline target'}],ownerships:[]}},'*'),targetPath);
    }
    await page.waitForTimeout(160);assert.ok((await read()).opacity<.65,'rule replay must not win during Play '+priority);
    if(!priority) assert.deepEqual(await frame.locator('#timeline-target').evaluate(element=>({gap:getComputedStyle(element).gap,color:getComputedStyle(element).color,title:element.title,text:element.textContent})),{gap:'20px',color:'rgb(9, 8, 7)',title:'Updated during Play',text:'Updated Timeline target'},'unanimated rule gap/color, attributes and text must remain live during Timeline preview');
    await control('release');await page.waitForTimeout(160);approximately((await read()).opacity,.7,'release restores rule authority '+priority);
  }
  assert.deepEqual(errors,[]);
  const report={sourceSha256:createHash('sha256').update(source).digest('hex'),browser:browser.version(),fixture:'scripts/fixtures/timeline-project.mjs',exactViewportHostZoom:1.21,baseline,seek,playing,paused,restarted,reset,cases:['Play','Pause','Stop pins playhead','scrub','restart','reverse','reset','release','authored scripts inert','CSS motion frozen for two cycles without manual settlement','CSS freeze repaired after style restoration','concurrent settlement','committed style isolation','rule ownership isolation','live unanimated CSS gap/color','live attributes/text']};
  await writeFile(path.join(output,'timeline-motion-isolation-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
