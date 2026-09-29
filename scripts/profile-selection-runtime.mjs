import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildCodeComponentReactRuntime } from './vite-code-component-runtime.mjs';
import { createPerformanceProject } from './fixtures/performance-project.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const sourcePath = argument('--source') || path.join(root, 'lib/html-editor/preview.ts');
const source = await readFile(sourcePath, 'utf8');
const output = argument('--output') || path.join(root, 'artifacts/kodety-performance-2026-09/runtime-selection');
await mkdir(output, { recursive: true });
const archivePath = argument('--archive');
const profiles = archivePath ? ['archive'] : (argument('--profiles') || 'medium,large').split(',');
const samples = Number(argument('--samples') || 12);
assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 1000);
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
const browser = await chromium.launch({ headless: true });
const percentile = (values, rank) => [...values].sort((a,b) => a-b)[Math.ceil(values.length*rank)-1];
const summary = values => Object.fromEntries([['p50',.5],['p95',.95],['p99',.99]].map(([name,rank]) => [name, Math.round(percentile(values,rank)*100)/100]));
const report = { sourceSha256: createHash('sha256').update(source).digest('hex'), browser: browser.version(), samples, profiles: [] };
try {
  for (const profile of profiles) {
    const fixture = archivePath ? await (async () => {
      const zip = await JSZip.loadAsync(await readFile(archivePath));
      const files = {};
      for (const entry of Object.values(zip.files)) {
        if (!entry.dir && /\.(?:html?|css|js|mjs|json|svg)$/i.test(entry.name)) files[entry.name] = await entry.async('string');
      }
      return { files, manifest: { profile: 'archive', sourceArchiveSha256: createHash('sha256').update(await readFile(archivePath)).digest('hex'), textFiles: Object.keys(files).length } };
    })() : await createPerformanceProject(profile);
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const preparation = await page.evaluate(({files,profile}) => {
      const filesByPath=Object.fromEntries(Object.entries(files).map(([path,text])=>[path,{path,text,mimeType:path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.json')?'application/json':'text/javascript'}]));
      const project={name:'Selection '+profile,mainHtmlPath:'index.html',rootPath:'',openedAt:1,files:filesByPath};
      const started=performance.now();
      const preview=window.buildPreview(project,true,[],false,[],true,null,'selection-'+profile,1,true);
      window.messages=[];
      window.addEventListener('message',event=>window.messages.push({data:event.data,at:performance.timeOrigin+performance.now()}));
      const frame=document.createElement('iframe');frame.style.cssText='width:1500px;height:950px;border:0';frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=preview.html;document.body.append(frame);
      return {buildMs:performance.now()-started,bytes:preview.html.length};
    }, { files: fixture.files, profile });
    await page.waitForFunction(() => window.messages.some(item=>item.data.type==='html-editor-canvas-ready'), undefined, { timeout: 90000 });
    const frame = page.frames().find(candidate=>candidate.parentFrame());
    await frame.evaluate(() => {
      window.clicks=[];window.longTasks=[];
      new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask',buffered:false});
      window.addEventListener('click',event=>window.clicks.push({trusted:event.isTrusted,target:event.target.closest('[data-html-editor-path]')?.getAttribute('data-html-editor-path'),at:performance.timeOrigin+performance.now()}),true);
    });
    const metrics=[];
    const cdp=await context.newCDPSession(frame).catch(()=>context.newCDPSession(page));
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval',{interval:1000});
    await cdp.send('Profiler.start');
    for (let index=0;index<samples+2;index++) {
      const selector=archivePath ? (index%2?'main h1:visible':'main h2:visible') : (index%2?'#probe-title':'.product-card .card-body');
      const target=frame.locator(selector).first();
      const sourcePath=await target.getAttribute('data-html-editor-path');
      await target.click({position:{x:3,y:3}});
      const expectedPath=await target.evaluate(element=>element.closest('[data-html-editor-selected]')?.getAttribute('data-html-editor-path')||element.querySelector('[data-html-editor-selected]')?.getAttribute('data-html-editor-path')||element.getAttribute('data-html-editor-path'));
      const result=await page.waitForFunction(({expectedPath,index})=>{
        const data=window.messages.filter(item=>item.data.type==='html-editor-selection'&&item.data.detail==='computed');
        const latest=data.at(-1);
        return data.length>=index+1&&latest?.data.payload?.path===expectedPath?latest:null;
      },{expectedPath,index},{timeout:30000,polling:10});
      const computed=await result.jsonValue();await result.dispose();
      const click=await frame.evaluate(()=>window.clicks.at(-1));
      assert.equal(click.trusted,true);assert.ok(click.target,'trusted click must hit an annotated authoring node');
      const identity=await page.evaluate(({path,at})=>window.messages.find(item=>item.at>=at&&item.data.type==='html-editor-selection'&&item.data.detail==='identity'&&item.data.payload?.path===path),{path:expectedPath,at:click.at});
      metrics.push({selector,sourcePath,selectedPath:expectedPath,identityMs:identity.at-click.at,computedMs:computed.at-click.at,originCount:Object.keys(computed.data.payload.styleOrigins||{}).length});
    }
    const {profile:cpu}=await cdp.send('Profiler.stop');
    await writeFile(path.join(output,profile+'.cpuprofile'),JSON.stringify(cpu));
    const nodes=new Map(cpu.nodes.map(node=>[node.id,node]));const self=new Map();
    for (let index=0;index<(cpu.samples||[]).length;index++) {const id=cpu.samples[index];self.set(id,(self.get(id)||0)+(cpu.timeDeltas[index]||0));}
    const stacks=[...self].map(([id,microseconds])=>({function:nodes.get(id)?.callFrame.functionName||'(anonymous)',url:nodes.get(id)?.callFrame.url,line:nodes.get(id)?.callFrame.lineNumber,milliseconds:Math.round(microseconds/10)/100})).sort((a,b)=>b.milliseconds-a.milliseconds).slice(0,40);
    const measured=metrics.slice(2);
    const detail={manifest:fixture.manifest,preparation,samples:measured,identity:summary(measured.map(item=>item.identityMs)),computed:summary(measured.map(item=>item.computedMs)),longTasks:await frame.evaluate(()=>window.longTasks),stacks,errors};
    report.profiles.push(detail);
    await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({profile,identity:detail.identity,computed:detail.computed,stacks:stacks.slice(0,10)}));
    await context.close();
  }
} finally { await browser.close(); }
