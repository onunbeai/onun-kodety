import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const browserName = process.env.KODETY_TEST_BROWSER || 'chromium';
const browserType = new Map(Object.entries({ chromium, firefox, webkit })).get(browserName);
assert.ok(browserType, `Unsupported KODETY_TEST_BROWSER: ${browserName}`);
const vite = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
let browser;
let fixtureServer;
try {
  const imageUrls = await vite.ssrLoadModule('/lib/html-editor/css-image-url.ts');
  for (const value of ['', 'none', 'initial', 'INHERIT', 'unset', 'revert', 'revert-layer', 'var(--Image)', 'linear-gradient(red,blue)', 'url(a.png), url(b.png)']) {
    assert.equal(imageUrls.cssImagePreviewUrl(value),'','CSS expressions cannot become thumbnail requests');
  }
  for (const [value,url] of [['url("/a.png")','/a.png'],["url('/a b.png')",'/a b.png'],['url("/a(2).png")','/a(2).png'],['/a.png','/a.png']]) assert.equal(imageUrls.cssImagePreviewUrl(value),url);
  const masks = await vite.ssrLoadModule('/lib/html-editor/mask-utils.ts');
  for (const image of ['initial', 'inherit', 'unset', 'revert', 'revert-layer', 'var(--Mask)', 'image-set(url(a.png) 1x)']) {
    const layers = masks.parseMaskLayers({'mask-image':image});
    assert.equal(masks.maskPreviewBackground(layers[0]),image,'Mask previews must not fetch CSS keywords or bindings as image paths');
    assert.equal(masks.serializeMaskLayers(layers)['mask-image'],image,'Editing a mask property preserves its image binding');
  }
  const imageMask=masks.createDefaultMaskLayer(0,'image');
  imageMask.image='/assets/mask image.png';
  assert.equal(masks.maskPreviewBackground(imageMask),'url("/assets/mask image.png")');
  const classes = await vite.ssrLoadModule('/lib/html-editor/class-selector.ts');
  const css = String.raw`/* .hero */ [data-note=".hero"] .hero, .h\65 ro:hover, :is(.hero, .hero-long) { content: '.hero'; --literal: '.hero'; }
@media (width < 800px) { .hero.hero { color: red } }
@scope (.hero) to ([data-note=".hero"]) { :scope .hero { opacity: 1 } }
@supports selector(:is(.hero, :not(.hero-long))) { .hero { display: grid } }
@supports (--custom: "selector(.hero)") { .keep { color: red } }`;
  const renamed = classes.renameClassInCss(css, 'hero', 'banner');
  assert.equal(classes.renameClassInCss('[data-note="/* .hero"] .hero { color:red }', 'hero', 'banner'), '[data-note="/* .hero"] .banner { color:red }');
  assert.equal(classes.renameClassInCss(String.raw`.sm\:hover { color:red }`, 'sm:hover', 'mobile'), '.mobile { color:red }');
  assert.match(renamed, /\[data-note="\.hero"\] \.banner, \.banner:hover, :is\(\.banner, \.hero-long\)/);
  assert.match(renamed, /content: '\.hero'/);
  assert.match(renamed, /\/\* \.hero \*\//);
  assert.match(renamed, /@scope \(\.banner\)/);
  assert.match(renamed, /selector\(:is\(\.banner, :not\(\.hero-long\)\)\)/);
  assert.match(renamed, /--custom: "selector\(\.hero\)"/);
  const html = '<!doctype html><html><head><style media="screen">.hero {color:red}</style><script>const s = "<style>.hero{color:blue}</style>";</script></head><body><!-- <style>.hero{color:green}</style> --><main class="hero"><style>.h\\65 ro:hover{opacity:.5}</style><template><style>.hero{display:block}</style><section class="hero">Template</section></template></main></body></html>';
  const companion = JSON.stringify({version:2,canonical:true,interactions:[{id:'test',name:'Test',trigger:'click',triggerSelector:'[data-note=".hero"] .h\\65 ro',triggerLabel:'Hero',triggerTargetMode:'class',actions:[]}]});
  const project = {name:'Test',mainHtmlPath:'index.html',rootPath:'',openedAt:1,files:{'index.html':{path:'index.html',mimeType:'text/html',text:html},'style.css':{path:'style.css',mimeType:'text/css',text:css},'.incode/animations/index.html.json':{path:'.incode/animations/index.html.json',mimeType:'application/json',text:companion}}};
  const output = classes.renameProjectClassReferences(project, ['index.html','style.css'], 'hero','banner');
  assert.deepEqual(output.changedFilePaths,['.incode/animations/index.html.json','index.html','style.css']);
  assert.match(output.project.files['index.html'].text, /<style media="screen">\.banner/);
  assert.match(output.project.files['index.html'].text, /<main class="banner"><style>\.banner:hover/);
  assert.match(output.project.files['index.html'].text, /<template><style>\.banner/);
  assert.match(output.project.files['index.html'].text, /<section class="banner">Template<\/section>/);
  assert.match(output.project.files['index.html'].text, /const s = "<style>\.hero/);
  assert.match(output.project.files['index.html'].text, /<!-- <style>\.hero/);
  assert.equal(JSON.parse(output.project.files['.incode/animations/index.html.json'].text).interactions[0].triggerSelector, '[data-note=".hero"] .banner');
  assert.equal(project.files['index.html'].text, html);
  assert.throws(() => classes.renameProjectClassReferences({...project,files:{...project.files,'bad.html':{path:'bad.html',text:'<main class="hero"><style>.hero{color:red</style></main>'}}}, ['index.html','bad.html'],'hero','banner'));

  const repeatedElement = '<div class="hero other"><span>Content</span></div>';
  const largePrefix = '<!doctype html><html><head><style>.hero{color:red}</style></head><body><main>';
  const largeSuffix = '</main><!-- .hero is a comment --></body></html>';
  const largeMarkup = largePrefix + repeatedElement.repeat(10_000) + largeSuffix;
  assert.equal(
    classes.renameClassInHtml(largeMarkup, 'hero', 'banner'),
    largePrefix.replace('.hero', '.banner') + repeatedElement.replace('class="hero other"', 'class="banner other"').repeat(10_000) + largeSuffix,
    'large renames must preserve every original span and apply all class/style edits',
  );

  const cache = await vite.ssrLoadModule('/Wordpress/editor/wordpress-cms-schema-cache.ts');
  const storage = new Map();
  globalThis.window = {sessionStorage:{get length(){return storage.size},key:index=>[...storage.keys()][index] ?? null,getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}};
  const config = {cmsSchemaUrl:'https://example.test/schema',siteUrl:'https://example.test',nonce:'session-A',canManageCmsSchema:true};
  const scope = cache.cmsSchemaScope(config,'project-A',1,'template-A');
  const schema = {types:[{slug:'post',name:'Posts',fields:[]}],templates:{post:'blog.html'}};
  cache.cacheCmsSchema(scope,schema);
  assert.deepEqual(cache.readCmsSchemaCache(scope),schema);
  for (const other of [cache.cmsSchemaScope({...config,nonce:'session-B'},'project-A',1,'template-A'),cache.cmsSchemaScope(config,'project-B',1,'template-A'),cache.cmsSchemaScope(config,'project-A',2,'template-A'),cache.cmsSchemaScope(config,'project-A',1,'template-B'),cache.cmsSchemaScope({...config,canManageCmsSchema:false},'project-A',1,'template-A')]) assert.equal(cache.readCmsSchemaCache(other),null);
  const [key,value] = [...storage][0];
  const emptyTemplates = { types: [{ slug: 'post', name: 'Posts', fields: [] }], templates: [] };
  assert.deepEqual(cache.normalizeCmsSchemaResponse(emptyTemplates), { ...emptyTemplates, templates: {} }, 'A real WordPress site without templates returns an empty PHP array');
  assert.deepEqual(emptyTemplates.templates, [], 'Normalization must not mutate the response');
  for (const templates of [['post'], [null], [42], null, 'blog.html', {post: 42}]) {
    assert.equal(cache.normalizeCmsSchemaResponse({ ...emptyTemplates, templates }), null);
  }
  storage.set(key, JSON.stringify({...JSON.parse(value), schema: emptyTemplates}));
  assert.deepEqual(cache.readCmsSchemaCache(scope), {...emptyTemplates, templates: {} });

  assert.equal(cache.isCmsSchemaResponse({types:[{slug:'post',name:'Posts',restBase:'posts',fields:[{key:'title',label:'Title',type:'text',source:'native'}]}]}),true);
  for (const invalid of [{restBase:{}},{fields:[null]},{fields:{}},{fields:[{key:{},label:'Title'}]},{fields:[{key:'title',label:42}]},{fields:[{key:'title',label:'Title',type:{}}]},{fields:[{key:'title',label:'Title',source:0}]}]) {
    const invalidSchema={types:[{slug:'post',name:'Posts',...invalid}]};
    assert.equal(cache.isCmsSchemaResponse(invalidSchema),false,'malformed fresh fields cannot enter Settings');
    storage.set(key,JSON.stringify({...JSON.parse(value),schema:invalidSchema}));
    assert.equal(cache.readCmsSchemaCache(scope),null,'malformed cached fields cannot enter Settings');
  }
  storage.set(key,JSON.stringify({...JSON.parse(value),cachedAt:Date.now()-5*60_000}));
  assert.equal(cache.readCmsSchemaCache(scope),null,'expired cache cannot become an offline authority');
  storage.set(key,JSON.stringify({...JSON.parse(value),scope:'collision'}));
  assert.equal(cache.readCmsSchemaCache(scope),null,'scope envelope guards hash collisions');
  for (let revision=1; revision<=20; revision++) cache.cacheCmsSchema(cache.cmsSchemaScope(config,'project-A',revision,'template-A'),schema);
  assert.ok(storage.size<=8, 'schema revisions must not grow storage without a bound');
  delete globalThis.window;

  const fixture = await build({stdin:{contents:`
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Input} from './app/(builder)/kodety/html-editor/ycode-style/ui/input';
import {GapValueControl} from './app/(builder)/kodety/components/GapValueControl';
import {useControlledInput} from './hooks/use-controlled-input';
import {HtmlSitemapSettings} from './app/(builder)/kodety/html-editor/components/HtmlSitemapSettings';
import {HtmlEditorCodePanel} from './app/(builder)/kodety/html-editor/components/HtmlEditorCodePanel';
import {useHtmlEditorChromeStore} from './stores/useHtmlEditorChromeStore';
import {useHtmlStylePreviewTransaction} from './app/(builder)/kodety/html-editor/components/useHtmlStylePreviewTransaction';
import {useHtmlInspectorPanelStore,htmlInspectorActions,captureHtmlInspectorAction} from './stores/useHtmlInspectorPanelStore';
window.events=[];
const root=createRoot(document.getElementById('root'));
function InputHarness({options}) {const [value,setValue]=useState(options.initial ?? '0');return <Input aria-label="Value" {...options} ref={node=>window.inputNode=node} value={value} onChange={e=>{window.events.push(['change',e.target.value]);setValue(e.target.value)}} onStepperChange={value=>{window.events.push(['step',value]);setValue(value)}} onKeyDown={e=>{if(options.preventArrow)e.preventDefault()}} />}
function GestureHarness({scope}) {const transaction=useHtmlStylePreviewTransaction({onCommit:htmlInspectorActions.onStyleChange,onPreview:htmlInspectorActions.onStylePreview,onCancel:htmlInspectorActions.onStylePreviewCancel,scopeKey:scope,confirmedValues:{}});window.transaction=transaction;return <div ref={transaction.rootRef} {...transaction.interactionProps}><input aria-label="Style" onChange={event=>transaction.change('width',event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&window.normalizeOnEnter)transaction.change('width',event.currentTarget.value+'px')}}/><textarea aria-label="Multiline style" onChange={event=>transaction.change('content',event.target.value)}/><button id="inside">inside</button></div>}
window.input=(options)=>flushSync(()=>root.render(<InputHarness key={JSON.stringify(options)} options={options}/>));
function RapidGapField({external,onChange}) {
 const [value,setValue]=useControlledInput(external,undefined,false);
 window.gapTrace.push(['render',value,external]);
 return <GapValueControl mode="all" value={value} columnGap="" rowGap="" onValueChange={next=>{window.gapTrace.push(['input',next]);setValue(next);onChange('gap',next)}} onColumnGapChange={()=>{}} onRowGapChange={()=>{}} onModeToggle={()=>{}}/>;
}
function RapidGapHarness({scope}) {
 const [confirmed,setConfirmed]=useState('31px');
 const transaction=useHtmlStylePreviewTransaction({scopeKey:scope,confirmedValues:{gap:confirmed},onCommit:(_property,value)=>{window.events.push(['gap-commit',value]);setConfirmed(value)},onPreview:(_property,value)=>{window.previewGap=value}});
 return <div ref={transaction.rootRef} {...transaction.interactionProps}><RapidGapField external={transaction.optimisticValues.gap??confirmed} onChange={transaction.change}/></div>;
}
window.rapidGap=scope=>{window.events=[];window.gapTrace=[];flushSync(()=>root.render(<RapidGapHarness key={scope} scope={scope}/>))};
window.publish=(scope,overrides={})=>useHtmlInspectorPanelStore.getState().publish('owner',{styleEditScopeKey:scope,currentPage:'index.html',selection:{path:'0'},cssContext:{target:'rule',selector:'.hero',pseudo:'base',breakpoint:'base',cssFilePath:'styles.css'},activeBreakpoint:'base',onStyleChange:(...args)=>window.events.push(['commit',scope,...args]),onStylePreview:(...args)=>window.events.push(['preview',scope,...args]),onStylePreviewCancel:()=>window.events.push(['cancel',scope]),...overrides});
window.gesture=(scope)=>{window.publish(scope);flushSync(()=>root.render(<GestureHarness scope={scope}/>))};
window.capture=()=>captureHtmlInspectorAction(htmlInspectorActions.onStyleChange);
window.sitemap=()=>flushSync(()=>root.render(<HtmlSitemapSettings endpoint={location.origin+'/sitemap-status'} nonce="test-nonce"/>));
window.codePanel=()=>{
 const value=['const a = 1;','/* start','  broken',' end */',...Array.from({length:42},(_,i)=>'const line'+i+' = '+i+';')].join('\\n');
 const files={'code-components/example.tsx':{path:'code-components/example.tsx',text:value},'code-components/dependency.tsx':{path:'code-components/dependency.tsx',text:'first\\nsecond\\nthird'}};
 const project={name:'Code diagnostics',openedAt:1,mainHtmlPath:'code-components/example.tsx',files};
 window.codeValue=value;window.codeEdits=[];
 useHtmlEditorChromeStore.setState({showCode:true,codeFilePath:'code-components/example.tsx'});
 flushSync(()=>root.render(<HtmlEditorCodePanel mode="design" framerRuntimeReadOnly={false} isPreviewing={false} project={project} source={value} textFiles={Object.values(files)} sharedReadOnly={false} codeComponentCompileState={{'code-components/example.tsx':{diagnostics:[{code:'E1',severity:'error',line:3,column:3,message:'Broken declaration'},{code:'E2',severity:'error',line:40,column:7,message:'Long document error'},{code:'D1',severity:'warning',file:'code-components/dependency.tsx',line:2,column:3,message:'Imported warning'}]}}} openCodeFile={path=>useHtmlEditorChromeStore.getState().setCodeFilePath(path)} formatCodeFile={async()=>{}} changeCodeFile={(path,value)=>window.codeEdits.push([path,value])}/>));
};
window.ready=true;
`,resolveDir:root,sourcefile:'authoring-stability-fixture.tsx',loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':root},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const script = fixture.outputFiles[0].text;
  fixtureServer=http.createServer((request,response)=>{response.setHeader('content-type','text/html');response.end(`<div id="root"></div><button id="outside">outside</button><script>${script.replaceAll('</script','<\\/script')}</script>`)});
  await new Promise(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve));
  browser=await browserType.launch({headless:true});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${fixtureServer.address().port}`);
  await page.waitForFunction(()=>window.ready);
  const input=page.getByLabel('Value');
  for(let run=0;run<12;run++) {
    await page.evaluate(run=>window.rapidGap('rapid-'+run),run);
    const gap=page.getByRole('textbox',{name:'Espaço entre elementos'});
    await page.waitForFunction(()=>document.querySelector('input[aria-label="Espaço entre elementos"]')?.value==='31px');
    await gap.focus();
    for(let index=0;index<20;index++) await gap.press('ArrowUp',{delay:(index%4)*4});
    if(await gap.inputValue()!=='51px') console.log(JSON.stringify(await page.evaluate(()=>window.gapTrace)));
    assert.equal(await gap.inputValue(),'51px','Every rapid increment must survive an older scheduled preview render, run '+run);
    await gap.press('Tab');
    assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='gap-commit')),[['gap-commit','51px']],'The burst commits its final sample exactly once');
  }
  await page.evaluate(()=>window.input({initial:'0.2',step:0.1,min:0,max:1,type:'number'}));
  await input.press('ArrowUp');assert.equal(await input.inputValue(),'0.3');
  await input.press('Shift+ArrowDown');assert.equal(await input.inputValue(),'0');
  assert.equal(await input.getAttribute('min'),'0');assert.equal(await input.getAttribute('max'),'1');assert.equal(await input.getAttribute('step'),'0.1');
  await page.evaluate(()=>window.input({initial:'0',step:0.25,min:0,max:0,stepper:true}));
  await page.getByRole('button',{name:'Aumentar valor'}).click();assert.equal(await input.inputValue(),'0');
  await page.getByRole('button',{name:'Diminuir valor'}).click();assert.equal(await input.inputValue(),'0');
  await page.evaluate(()=>window.input({initial:'12px',step:0.5}));await input.press('ArrowDown');assert.equal(await input.inputValue(),'11.5px');
  await page.evaluate(()=>window.input({initial:'-',step:0.5}));await input.press('ArrowUp');assert.equal(await input.inputValue(),'-');
  await page.evaluate(()=>window.input({initial:'2',step:0.5,preventArrow:true}));await input.press('ArrowUp');assert.equal(await input.inputValue(),'2');
  await page.evaluate(()=>window.input({initial:'2',step:'any',stepper:true}));await page.getByRole('button',{name:'Aumentar valor'}).click();assert.equal(await input.inputValue(),'3');
  await input.focus();await page.getByRole('button',{name:'Diminuir valor'}).click();assert.equal(await input.inputValue(),'2');assert.equal(await input.evaluate(node=>node===document.activeElement),true,'step buttons retain the active input gesture');
  await page.evaluate(()=>window.input({initial:'2',step:0.5,readOnly:true,stepper:true}));await input.press('ArrowUp');assert.equal(await input.inputValue(),'2');assert.equal(await page.getByRole('button',{name:'Aumentar valor'}).count(),0);
  await page.evaluate(()=>{window.events=[];window.gesture('A')});
  await page.getByLabel('Style',{exact:true}).fill('25px');await page.locator('#outside').click();
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[['commit','A','width','25px']]);
  await page.evaluate(()=>{window.events=[];window.gesture('A');window.transaction.beginExternalInteraction();window.transaction.change('width','30px');window.oldChange=window.transaction.change;window.gesture('B');window.oldChange('width','99px');window.transaction.endExternalInteraction()});
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[],'scope change cancels old drafts and delayed callbacks');
  await page.evaluate(()=>{window.events=[];window.publish('A');window.captured=window.capture();window.publish('B');window.captured('height','40px')});
  assert.deepEqual(await page.evaluate(()=>window.events),[],'captured live facade cannot resolve to B');
  await page.evaluate(()=>{window.events=[];window.publish('A');window.captured=window.capture();window.captured('height','40px')});
  assert.deepEqual(await page.evaluate(()=>window.events),[['commit','A','height','40px']]);
  for(const context of [{currentPage:'other.html'},{selection:{path:'0/1'}},{activeBreakpoint:'mobile'},{cssContext:{target:'rule',selector:'.hero',pseudo:'hover',breakpoint:'base'}},{styleEditScopeKey:'project-B'}]) {
    await page.evaluate(context=>{window.events=[];window.publish('A');const captured=window.capture();window.publish('A',context);captured('width','40px')},context);
    assert.deepEqual(await page.evaluate(()=>window.events),[],'scope guards every editing dimension');
  }
  await page.evaluate(()=>{window.events=[];window.publish('A');const captured=window.capture();window.publish('B');window.publish('A');captured('width','40px')});
  assert.deepEqual(await page.evaluate(()=>window.events),[],'returning to a scope does not revive a previous gesture');
  await page.evaluate(()=>{window.events=[];window.normalizeOnEnter=true;window.gesture('enter-A')});
  const styleInput=page.getByLabel('Style',{exact:true});
  await styleInput.fill('31');await styleInput.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[['commit','enter-A','width','31px']],'Enter commits the final normalized input while it remains focused');
  assert.equal(await styleInput.evaluate(node=>node===document.activeElement),true);
  await styleInput.press('Tab');
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[['commit','enter-A','width','31px']],'blur after Enter must not duplicate history');
  await styleInput.fill('32');await styleInput.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[['commit','enter-A','width','31px'],['commit','enter-A','width','32px']],'typing after Enter creates a new gesture');
  await page.evaluate(()=>{window.events=[];window.normalizeOnEnter=false;window.gesture('ime-A')});
  await styleInput.fill('33');
  await styleInput.dispatchEvent('keydown',{key:'Enter',isComposing:true});
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[],'IME confirmation must not commit the style gesture');
  await styleInput.press('Escape');
  await page.evaluate(()=>{window.events=[];window.gesture('multiline-A')});
  await page.getByLabel('Multiline style').fill('line');await page.getByLabel('Multiline style').press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[],'Enter in multiline fields stays editable');
  await page.evaluate(()=>{window.events=[];window.gesture('stale-enter-A')});
  await styleInput.fill('34');
  await page.evaluate(()=>{document.querySelector('input[aria-label="Style"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));window.gesture('stale-enter-B')});
  assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='commit')),[],'a scope switch before the Enter microtask cannot commit another selection');

  let sitemapFailure = false;
  let sitemapPayload = {generated:true,enabled:true,url:'https://example.test/sitemap.xml',source:'kodety-publication',release:'release-42',urlCount:3,generatedAt:'2026-09-05T15:34:00Z',validationErrors:[],accessStatus:'unverified',googleSubmissionStatus:'unverified',googleProcessingStatus:'unverified'};
  await page.route('**/sitemap-status', route => route.fulfill({status:sitemapFailure ? 403 : 200,contentType:'application/json',body:JSON.stringify(sitemapPayload)}));
  await page.evaluate(()=>{window.kodetyAdminI18n={locale:'pt-BR'};window.sitemap()});
  await page.getByText('Sitemap gerado com as URLs da publicação Kodety.').waitFor();
  assert.equal(await page.getByRole('link',{name:'https://example.test/sitemap.xml'}).getAttribute('href'),'https://example.test/sitemap.xml');
  assert.equal(await page.getByText('release-42',{exact:true}).count(),1);
  assert.equal(await page.getByText('Publicação Kodety',{exact:true}).count(),1);
  assert.equal(await page.locator('time').getAttribute('datetime'),'2026-09-05T15:34:00.000Z');
  assert.equal(await page.locator('time').textContent(),await page.evaluate(()=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date('2026-09-05T15:34:00Z'))));
  assert.equal(await page.getByText('Não verificado',{exact:true}).count(),3,'generation does not claim public or Google fetch success');
  await page.evaluate(()=>{window.kodetyAdminI18n.locale='en-US'});
  sitemapPayload={...sitemapPayload,source:'<img src=x onerror=alert(1)>'};
  await page.getByRole('button',{name:'Atualizar diagnóstico'}).click();
  await page.getByText(sitemapPayload.source,{exact:true}).waitFor();
  assert.equal(await page.locator('section img').count(),0,'unknown origin remains safe plain text');
  assert.equal(await page.locator('time').textContent(),await page.evaluate(()=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short'}).format(new Date('2026-09-05T15:34:00Z'))));
  sitemapPayload={...sitemapPayload,generated:false,generatedAt:'',release:''};
  await page.getByRole('button',{name:'Atualizar diagnóstico'}).click();
  await page.getByText('O sitemap será gerado na próxima publicação.').waitFor();
  assert.equal(await page.locator('time').count(),0,'unpublished inventory has no generation date');
  assert.equal(await page.locator('dt').filter({hasText:'Gerado em'}).evaluate(node=>node.nextElementSibling.textContent),'');
  for(const invalid of [{source:{}},{generatedAt:123},{generatedAt:'invalid-date'},{accessStatus:{}}]) {
    const previous=sitemapPayload;
    sitemapPayload={...sitemapPayload,...invalid};
    await page.getByRole('button',{name:'Atualizar diagnóstico'}).click();
    await page.getByText('O diagnóstico do sitemap não respondeu corretamente.').waitFor();
    assert.equal(await page.locator('time').count(),0,'invalid responses clear the previous diagnostic');
    sitemapPayload=previous;
  }
  sitemapFailure = true;
  await page.getByRole('button',{name:'Atualizar diagnóstico'}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('release-42',{exact:true}).count(),0,'failed revalidation clears the previous diagnostic');
  await page.addStyleTag({content:'.sr-only{display:none}.code-editor-root{height:180px;overflow:auto;width:320px}'});
  await page.evaluate(()=>window.codePanel());
  const code = page.getByRole('textbox',{name:'Editor de código'});
  await page.getByRole('button',{name:/Broken declaration/}).click();
  const focused = await code.evaluate(node=>({value:node.value,start:node.selectionStart,end:node.selectionEnd,focused:node===document.activeElement}));
  const source = await page.evaluate(()=>window.codeValue);
  assert.equal(focused.value,source);assert.equal(focused.start,source.indexOf('  broken')+2);assert.equal(focused.start,focused.end);assert.equal(focused.focused,true);
  assert.equal(await page.locator('[data-code-editor-diagnostic-line="3"]').textContent(),'  broken');
  assert.notEqual(await page.locator('[data-code-editor-diagnostic-line="3"]').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.match(await page.locator('.token.comment').textContent(),/start\n··broken\n·end/,'multiline Prism tokens retain their markup');
  await page.getByRole('button',{name:/Long document error/}).click();
  assert.ok(await page.locator('.code-editor-root').evaluate(node=>node.scrollTop>0),'diagnostic navigation scrolls long source into view');
  await page.getByRole('button',{name:/Imported warning/}).click();
  await page.waitForFunction(()=>document.querySelector('.code-editor-root textarea')?.value==='first\nsecond\nthird');
  assert.equal(await code.evaluate(node=>node.selectionStart),8,'dependency diagnostics open and focus their own file');
  assert.deepEqual(await page.evaluate(()=>window.codeEdits),[],'focusing diagnostics never edits source or writes another file');
  assert.equal(await page.locator('[data-code-editor-diagnostic-line]').count(),0,'file switches discard old error highlights');
  assert.deepEqual(errors,[]);
  console.log(`Authoring stability tests passed (${browserName}): semantic rename, scoped CMS cache, mounted numeric controls and Inspector gestures.`);
} finally {
  delete globalThis.window;
  await browser?.close();
  if(fixtureServer) await new Promise(resolve=>fixtureServer.close(resolve));
  await vite.close();
}
