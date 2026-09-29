import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { buildCodeComponentReactRuntime } from './vite-code-component-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const browserName = process.env.KODETY_TEST_BROWSER || 'chromium';
const browserType = {chromium, firefox, webkit}[browserName];
assert.ok(browserType, `Unsupported KODETY_TEST_BROWSER: ${browserName}`);
const editorSource=await readFile(path.join(root,'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),'utf8');
function editorStage(start,end,after=0){
 const from=editorSource.indexOf(start,after),to=editorSource.indexOf(end,from);
 assert.ok(from>=0&&to>from,'The actual editor stage must exist: '+start);
 return editorSource.slice(from,to);
}
const originStage=editorStage('    const winningStyleOrigin = (','    const editKey = [');
const authoredContextStage=editorStage('    const currentCssContext = cssContextRef.current;','    const componentVariantCssScopeId =',editorSource.indexOf('  const updateStyle ='));
const stableSelectorStage=editorStage('        const selectorClassTokens = Array.from(','        const selectorIsUnique =');
const bundle=await build({stdin:{contents:`
import 'test:platform';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {HtmlKodetyLayoutControls,HtmlKodetySizingControls,HtmlKodetyTypographyControls,HtmlKodetyPositionControls,HtmlKodetySpacingControls} from './app/(builder)/kodety/html-editor/components/HtmlKodetyStyleControls';
import * as css from './lib/html-editor/css-patcher';
import * as styles from './lib/html-editor/style-utils';
import * as origins from './lib/html-editor/css-authoring-origin';
import * as source from './lib/html-editor/source-patcher';
import {generatedVisualClass,selectorForVisualClass,uniqueSourceElementId} from './lib/html-editor/editor-live-dom-helpers';
import {classEditingSelector} from './lib/html-editor/class-selector';
import {ELEMENT_STYLE_ID_ATTRIBUTE,elementStyleSelector,normalizeElementStyleId} from './lib/html-editor/element-style-identity';
import {normalizeCssControlInput} from './lib/html-editor/visual-style-adapter';
import {resolveInspectorStyleValues,resolveInspectorCustomProperties} from './lib/html-editor/inspector-style-values';
const context={target:'rule',selector:'.card',cssFilePath:'styles.css',pseudo:'base',breakpoint:'base'};
const breakpoints=[{id:'tablet',label:'Tablet',mode:'max-width',width:810}];
const reactRoot=createRoot(document.getElementById('controls'));
window.api={...css,...styles,...origins,...source,normalizeCssControlInput,context,breakpoints};
window.resolveVisualTarget=(project,selection,initialContext,name,forceAuthoredFallback=false)=>{
 const activeTimelineKeyframe=null,targetPaths=[selection.path],componentVariantCssScopeId='',normalizedProperty=styles.normalizeStylePropertyName(name);
 const projectRef={current:project},cssFiles=['reset.css','styles.css'],componentAuthoringCssPath='',primaryBreakpoint={width:1440};
 const editorSourceRef={current:project.files[project.mainHtmlPath].text};
 const cssContextRef={current:{...initialContext}},setCssContext=()=>{};
 const viewportRef={current:'base'},cssContextSelectionPathRef={current:forceAuthoredFallback?'obsolete':selection.path},reusableClasses=[];
 ${authoredContextStage}
 let activeCssContext={...authoredCssContext};
 const {cssAuthoringSelectorFromOrigin}=css,{resolveCssAuthoringOrigin}=origins;
 ${originStage}
 let html=project.files['index.html'].text;
 const targets=targetPaths,nodes=new Map(source.inspectSourceElementIndex(html).elements.map(node=>[node.path,{...node,tag:node.tagName,classes:(node.attributes.class||'').split(/\\s+/).filter(Boolean)}]));
 const primaryClasses=nodes.get(selection.path).classes,useDedicatedElementStyle=false;
 const autoClasses=new Map(),reservedVariantClassNames=[],editingHtmlComponent=null;
 const {patchElementAttribute}=source;
 let targetContext=activeCssContext,autoClass='';
 ${stableSelectorStage}
 return {context:targetContext,authoringContext:authoredCssContext,html,tracedStylesheetOrigin,autoClass,resolvedCssOrigin};
};
window.mountHideTarget=fixture=>{
 window.hideFixture={...fixture,context:{...context,selector:fixture.selector},commands:[],files:{'reset.css':fixture.reset,'styles.css':fixture.css,'index.html':fixture.html}};
 const indexed=source.inspectSourceElementIndex(fixture.html).elements;
 const node=indexed.find(item=>Object.prototype.hasOwnProperty.call(item.attributes,'data-test-hide-target'));
 window.hideSelection={path:node.path,tag:node.tagName,id:node.attributes.id||'',attributes:node.attributes,classes:(node.attributes.class||'').split(/\\s+/).filter(Boolean),styleOrigins:{[fixture.property||'display']:{selector:fixture.origin,cssPath:'reset.css',inline:false}}};
 let surface=document.getElementById('hide-surface');
 if(!surface){surface=document.createElement('div');surface.id='hide-surface';document.body.append(surface)}
 surface.innerHTML=new DOMParser().parseFromString(fixture.html,'text/html').body.innerHTML;
 document.getElementById('authored').textContent=fixture.reset+'\\n'+fixture.css;
 const apply=(property,value,visibility)=>{
  const state=window.hideFixture;
  const project={name:'Hide target',openedAt:1,rootPath:'',mainHtmlPath:'index.html',files:Object.fromEntries(Object.entries(state.files).map(([path,text])=>[path,{path,text}]))};
  const resolved=window.resolveVisualTarget(project,window.hideSelection,state.context,property,fixture.fallback&&!state.commands.length);
  state.commands.push({property,value});state.writeContext=resolved.context;
  state.context={...resolved.authoringContext,cssFilePath:resolved.context.cssFilePath,...(resolved.autoClass?{selector:resolved.context.selector}:{})};
  if(property===(fixture.property||'display'))state.result=resolved;
  state.files['index.html']=resolved.html;
  const options={authoritative:true,viewportWidth:1440,editActiveWinner:Boolean(resolved.resolvedCssOrigin)};
  const current=state.files[resolved.context.cssFilePath];
  if(visibility!==undefined){
   const restore=css.readCssDisplayRestoreState(current,resolved.context,breakpoints,1440);
   const computed=getComputedStyle(document.querySelector('[data-test-hide-target]')).display;
   state.files[resolved.context.cssFilePath]=css.patchCssDisplayVisibility(current,resolved.context,visibility,restore?.fallbackDisplay||(computed!=='none'?computed:'block'),breakpoints,{...options,computedDisplay:computed}).source;
  }else state.files[resolved.context.cssFilePath]=css.patchCssDeclaration(current,resolved.context,property,value,breakpoints,options);
  surface.innerHTML=new DOMParser().parseFromString(resolved.html,'text/html').body.innerHTML;
  document.getElementById('authored').textContent=state.files['reset.css']+'\\n'+state.files['styles.css'];
  const changedNode=source.inspectSourceElementIndex(resolved.html).byPath.get(node.path);
  window.hideSelection={...window.hideSelection,attributes:changedNode.attributes,classes:(changedNode.attributes.class||'').split(/\\s+/).filter(Boolean)};
  renderHide();
 };
 const renderHide=()=>{
  const computed=getComputedStyle(document.querySelector('[data-test-hide-target]'));
  const values=Object.fromEntries(Array.from(computed,property=>[property,computed.getPropertyValue(property)]));
  // This fixture authors one gap shorthand; computed derived axes are not
  // independent authored controls in the Inspector projection.
  delete values['row-gap'];delete values['column-gap'];
  const state=window.hideFixture;
  const restore=css.readCssDisplayRestoreState(state.files[state.context.cssFilePath],state.writeContext||state.context,breakpoints,1440);
  const visibleDisplay=restore?resolveInspectorCustomProperties(restore.previousValue||restore.fallbackDisplay,values):undefined;
  flushSync(()=>reactRoot.render(<HtmlKodetyLayoutControls key={'hide:'+fixture.selector+(window.hideReopen||0)} tag={node.tagName} scopeKey={'hide:'+fixture.selector} values={values} authoredValues={{}} visibleDisplay={visibleDisplay} onVisibilityChange={visible=>apply('display',visible?'':'none',visible)} onChange={(property,value)=>apply(property,value)}/>));
 };
 window.reopenHideTarget=()=>{window.hideFixture=JSON.parse(JSON.stringify(window.hideFixture));window.hideReopen=(window.hideReopen||0)+1;renderHide()};
 renderHide();
};
window.events=[];
window.mount=(text,family='layout')=>{window.events=[];window.css=text;window.family=family;window.scopeSequence=(window.scopeSequence||0)+1;render()};
function render(){
 document.getElementById('authored').textContent=window.css;
 const computed=getComputedStyle(document.querySelector('.card'));
 const projection=origins.readCssAuthoringDeclarations({name:'Controls',openedAt:1,rootPath:'',mainHtmlPath:'index.html',files:{'styles.css':{path:'styles.css',text:window.css}}},['styles.css'],context,breakpoints,1440);
 const authored=resolveInspectorStyleValues({pseudo:'base',computedFallback:Object.fromEntries(Array.from(computed,property=>[property,computed.getPropertyValue(property)])),ruleStyles:projection});
 const values=Object.fromEntries(Object.entries(authored).map(([property,value])=>[property,resolveInspectorCustomProperties(value,authored)]));
 const authoredValues=origins.cssAuthoringOwnDeclarations(projection);
 const Control={layout:HtmlKodetyLayoutControls,sizing:HtmlKodetySizingControls,typography:HtmlKodetyTypographyControls,position:HtmlKodetyPositionControls,spacing:HtmlKodetySpacingControls}[window.family];
 flushSync(()=>reactRoot.render(<Control key={window.family+window.scopeSequence} tag="div" scopeKey="test:card" parentHasGrid={false} values={values} authoredValues={authoredValues} onInteractionStart={()=>{}} onChange={(property,value)=>{
   window.events.push([property,value]);
   window.css=css.patchCssDeclaration(window.css,context,property,value,breakpoints,{authoritative:true,viewportWidth:1440});
   render();
 }}/>));
}
`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':root},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'visual-controls-browser',setup(builder){
 builder.onLoad({filter:/\.css$/},async args=>({contents:'const style=document.createElement("style");style.textContent='+JSON.stringify(await readFile(args.path,'utf8'))+';document.head.append(style);',loader:'js'}));
 builder.onResolve({filter:/^test:platform$/},()=>({path:'platform',namespace:'test-platform'}));
 builder.onLoad({filter:/.*/,namespace:'test-platform'},()=>({contents:`import {installFontLibraryTransport} from './lib/editor-platform-services';import {createWordPressFontLibraryTransport} from './Wordpress/editor/wordpress-font-library-transport';installFontLibraryTransport(createWordPressFontLibraryTransport({}, {fetch:()=>{throw new Error('Unexpected font request')},storage:{getItem:()=>null,setItem:()=>{}}}));`,resolveDir:root,loader:'ts'}));
 builder.onResolve({filter:/\?raw$/},args=>({path:args.path.startsWith('.')?path.resolve(args.resolveDir,args.path.slice(0,-4)):require.resolve(args.path.slice(0,-4)),namespace:'test-raw'}));
 builder.onLoad({filter:/.*/,namespace:'test-raw'},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}));
 builder.onResolve({filter:/^virtual:coday-react-runtime$/},()=>({path:'runtime',namespace:'test-runtime'}));
 builder.onLoad({filter:/.*/,namespace:'test-runtime'},async()=>({contents:'export default '+JSON.stringify(await buildCodeComponentReactRuntime())}));
}}]});
const browser=await browserType.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://visual.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><style id="authored"></style></head><body><div class="card" tabindex="0">Selected card</div><div class="sibling">Sibling card</div><div id="controls" style="width:320px"></div></body></html>'}));
 await page.goto('http://visual.test/');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 assert.deepEqual(errors,[]);
 const primitiveResults=await page.evaluate(()=>{
  const {patchCssDeclaration,readCssRuleDeclarations,parseStyleDeclarations,writeStyleDeclaration,serializeStyleDeclarations,context,breakpoints}=window.api;
  const original='.card { --Gap: 12px; --gap: 24px; gap: var(--Gap); all: initial; }';
  const patched=patchCssDeclaration(original,context,'--Gap','32px',breakpoints,{authoritative:true});
  const read=readCssRuleDeclarations(patched,context);
  const inline=parseStyleDeclarations('--Gap:12px;--gap:24px;gap:var(--Gap)');
  const changedInline=serializeStyleDeclarations(writeStyleDeclaration(inline,'--Gap','32px',{authoritative:true}));
  document.getElementById('authored').textContent=patched;
  return {patched,read,inline,changedInline,gap:getComputedStyle(document.querySelector('.card')).gap};
 });
 assert.deepEqual(primitiveResults.inline,{'--Gap':'12px','--gap':'24px',gap:'var(--Gap)'});
 assert.equal(primitiveResults.read['--Gap'],'32px');assert.equal(primitiveResults.read['--gap'],'24px');
 assert.match(primitiveResults.patched,/--Gap: 32px; --gap: 24px/);
 assert.match(primitiveResults.patched,/all: initial/,'editing a custom property must not consume all, which never resets variables');
 assert.match(primitiveResults.changedInline,/--gap: 24px/);assert.match(primitiveResults.changedInline,/--Gap: 32px/);

 const projected=await page.evaluate(()=>{
  const {readCssAuthoringDeclarations,cssAuthoringOwnDeclarations,context,breakpoints}=window.api;
  const cases=[
   {source:'.card{gap:24px!important;column-gap:3px}',expected:{'row-gap':'24px','column-gap':'24px'},absentOwn:['column-gap','row-gap']},
   {source:'.card{padding:20px!important;padding-top:3px}',expected:{'padding-top':'20px','padding-left':'20px'},absentOwn:['padding-top']},
   {source:'.card{margin:10px 20px!important;margin-left:3px}',expected:{'margin-top':'10px','margin-left':'20px'},absentOwn:['margin-left']},
   {source:'.card{border:2px solid rgb(11 22 33)!important;border-left-width:9px}',expected:{'border-left-width':'2px','border-top-color':'rgb(11, 22, 33)'},absentOwn:['border-left-width']},
   {source:'.card{font:italic 700 20px/1.5 "Times New Roman"!important;font-size:11px}',expected:{'font-size':'20px','font-weight':'700'},absentOwn:['font-size']},
   {source:'.card{background:rgb(11 22 33) linear-gradient(red, blue) no-repeat!important;background-color:red}',expected:{'background-color':'rgb(11, 22, 33)','background-repeat':'no-repeat'},absentOwn:['background-color']},
   {source:'.card{column-gap:3px}',second:'.card{gap:24px}',expected:{'row-gap':'24px','column-gap':'24px'},absentOwn:['column-gap','row-gap']},
   {source:'.card{gap:var(--Axis)!important;column-gap:3px}',expected:{gap:'var(--Axis)'},absent:['column-gap','row-gap'],absentOwn:['column-gap']},
  ];
  return cases.map(test=>{
   const files={'first.css':{path:'first.css',text:test.source},...(test.second?{'second.css':{path:'second.css',text:test.second}}:{})};
   const values=readCssAuthoringDeclarations({name:'Projection',openedAt:1,rootPath:'',mainHtmlPath:'index.html',files},Object.keys(files),context,breakpoints,1440);
   return {test,values,own:cssAuthoringOwnDeclarations(values)};
  });
 });
 for(const {test,values,own} of projected){
  for(const [property,value] of Object.entries(test.expected))assert.equal(values[property],value,'the Inspector must project the actual owner for '+property+' from '+test.source);
  for(const property of test.absent||[])assert.equal(values[property],undefined,'ambiguous variable shorthands must keep computed fallback');
  for(const property of test.absentOwn||[])assert.equal(own[property],undefined,'a losing/derived longhand must not claim independent authoring');
 }

 const priorityCases=await page.evaluate(()=>{
  const {patchCssDeclaration,context,breakpoints,readCssRuleDeclarations}=window.api;
  const card=document.querySelector('.card'),sibling=document.querySelector('.sibling'),sheet=document.getElementById('authored');
  const cases=[
   {source:'.card, .sibling { gap:24px !important; column-gap:30px; }',property:'row-gap',value:'32px',checks:{'row-gap':'32px','column-gap':'24px'},sibling:{'row-gap':'24px','column-gap':'24px'},gap:'32px 24px'},
   {source:':root{--Axis:24px 28px} .card, .sibling { gap:var(--Axis) !important; column-gap:30px; }',property:'row-gap',value:'32px',checks:{'row-gap':'32px','column-gap':'28px'},sibling:{'row-gap':'24px','column-gap':'28px'},gap:'var(--Axis)'},
   {source:'.card, .sibling { padding:24px !important; padding-top:30px; }',property:'padding-left',value:'32px',checks:{'padding-left':'32px','padding-top':'24px','padding-right':'24px','padding-bottom':'24px'},sibling:{'padding-left':'24px','padding-top':'24px'}},
   {source:'.card, .sibling { gap:12px } @media(min-width:1200px){.card, .sibling {gap:24px!important;column-gap:30px}}',property:'row-gap',value:'32px',checks:{'row-gap':'32px','column-gap':'24px'},sibling:{'row-gap':'24px','column-gap':'24px'},active:true},
  ];
  return cases.map(test=>{
   const patched=patchCssDeclaration(test.source,context,test.property,test.value,breakpoints,{authoritative:true,viewportWidth:1440,editActiveWinner:test.active});
   sheet.textContent=patched;
   const actual=Object.fromEntries(Object.keys(test.checks).map(property=>[property,getComputedStyle(card).getPropertyValue(property)]));
   const other=Object.fromEntries(Object.keys(test.sibling).map(property=>[property,getComputedStyle(sibling).getPropertyValue(property)]));
   return {test,patched,actual,other,read:readCssRuleDeclarations(patched,context)};
  });
 });
 for(const result of priorityCases){
  assert.deepEqual(result.actual,result.test.checks,'an edit must preserve every unedited winning axis under authored priority: '+result.patched);
  assert.deepEqual(result.other,result.test.sibling,'isolating a priority owner must preserve its grouped siblings');
  if(result.test.gap)assert.equal(result.read.gap,result.test.gap);
 }

 const roundtrips=await page.evaluate(()=>{
  const {patchCssDeclaration,readCssRuleDeclarations,normalizeCssControlInput,context,breakpoints}=window.api;
  const card=document.querySelector('.card'),sibling=document.querySelector('.sibling');
  const reference=document.createElement('div');reference.textContent='Selected card';document.body.append(reference);
  const stylesheet=document.getElementById('authored');
  const cases=[
   ['display','flex'],['visibility','hidden'],['flex-direction','column'],['align-items','center'],['align-self','end'],['justify-content','space-between'],['flex-wrap','wrap'],
   ['gap','calc(1rem + 2px) 24px'],['row-gap','0'],['column-gap','var(--Gap)'],['grid-template-columns','minmax(0, 1fr) 2fr'],['grid-template-rows','20px 30px'],
   ...['margin','padding'].flatMap(family=>['top','right','bottom','left'].map(side=>[family+'-'+side,'calc(1rem + 2px)'])),
   ['width','120px'],['height','40px'],['min-width','24px'],['max-width','400px'],['min-height','10px'],['max-height','500px'],['aspect-ratio','16 / 9'],['object-fit','contain'],['object-position','right top'],
   ['color','rgb(13 71 141 / 0.75)'],['background-color','hsl(210 50% 40% / 0.6)'],['background-image','linear-gradient(90deg, rgb(1 2 3), rgb(4 5 6))'],['background-position','right top'],['background-size','20px 30px'],['background-repeat','space'],
   ['font-family','"Times New Roman", serif'],['font-size','clamp(12px, 1rem + 2px, 24px)'],['font-weight','700'],['letter-spacing','0.1em'],['line-height','1.5'],['text-align','center'],['text-transform','uppercase'],['text-decoration-color','rgb(11 22 33)'],['text-decoration-thickness','3px'],['text-underline-offset','4px'],
   ['border-color','rgb(11 22 33)'],['border-width','2px'],['border-radius','4px 8px 12px 16px'],['border-top-left-radius','calc(1rem + 2px)'],['outline','2px solid rgb(22 33 44)'],['outline-offset','4px'],
   ['opacity','0.4'],['box-shadow','1px 2px 3px rgb(1 2 3 / 0.4)'],['filter','blur(2px) brightness(1.2)'],['backdrop-filter','blur(2px)'],['position','absolute'],['top','10px'],['right','20px'],['bottom','30px'],['left','40px'],['z-index','7'],
   ['transform','translateX(12px) rotate(10deg)'],['translate','12px 24px'],['rotate','10deg'],['scale','1.2 0.8'],['transform-origin','left top'],['transition-property','color, background-color'],['transition-duration','250ms'],['transition-delay','50ms'],['transition-timing-function','cubic-bezier(0.2, 0.4, 0.6, 0.8)'],
  ];
  const failures=[];
  for(const [property,value] of cases){
   if(!CSS.supports(property,value)){failures.push({property,value,error:'unsupported fixture value'});continue}
   const prefix='/* keep start */ :root { --Gap: 36px; --gap: 72px; } ';
   const original=prefix+'.card, .sibling { '+property+': initial; --untouched: keep; } /* keep end */';
   stylesheet.textContent=original;
   const siblingBefore=getComputedStyle(sibling).getPropertyValue(property);
   const normalized=normalizeCssControlInput(' '+value+' ');
   const patched=patchCssDeclaration(original,context,property,normalized,breakpoints,{authoritative:true});
   stylesheet.textContent=patched;
   reference.removeAttribute('style');reference.style.setProperty(property,value);
   const actual=getComputedStyle(card).getPropertyValue(property),expected=getComputedStyle(reference).getPropertyValue(property);
   const read=readCssRuleDeclarations(patched,context)[property];
   if(actual!==expected||read!==value||getComputedStyle(sibling).getPropertyValue(property)!==siblingBefore||!patched.startsWith(prefix)||!patched.endsWith('/* keep end */')) failures.push({property,value,read,actual,expected,patched});
  }
  reference.remove();
  return {count:cases.length,failures};
 });
 assert.deepEqual(roundtrips.failures,[],'every control family must write valid CSS and leave grouped siblings untouched');

 await page.evaluate(()=>window.mount('/* start */ .card { display:flex; gap:12px; color:rgb(1 2 3); } .sibling { gap:99px; } /* end */'));
 const unified=page.getByLabel('Espaço entre elementos',{exact:true});
 await unified.fill('24');await unified.press('Tab');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.card')).gap==='24px');
 assert.match(await page.evaluate(()=>window.css),/gap:24px; color:rgb\(1 2 3\)/,'Gap must update its authored declaration in place and preserve unrelated color');
 await page.getByLabel('Separar espaços horizontal e vertical',{exact:true}).click();
 const horizontal=page.getByLabel('Espaço horizontal',{exact:true});
 const vertical=page.getByLabel('Espaço vertical',{exact:true});
 await horizontal.fill('40');await horizontal.press('Tab');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.card')).columnGap==='40px');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.card')).rowGap),'24px');
 await vertical.fill('0');await vertical.press('Tab');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.card')).rowGap==='0px');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.card')).columnGap),'40px');
 await page.getByLabel('Vincular espaços horizontal e vertical',{exact:true}).click();
 await unified.fill('calc(1rem + 2px)');await unified.press('Tab');
 assert.match(await page.evaluate(()=>window.css),/gap:calc\(1rem \+ 2px\)/,'Gap must retain required whitespace inside CSS math');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.card')).gap),'18px');
 await page.evaluate(()=>window.mount(':root{--Axis:24px 28px} .card{display:flex;gap:var(--Axis)!important;column-gap:3px}'));
 await horizontal.fill('40');await horizontal.press('Tab');
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).columnGap),'40px','an axis edit must replace the actual important shorthand winner');
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).rowGap),'24px');
 assert.match(await page.evaluate(()=>window.css),/gap:var\(--Axis\)!important/,'an axis edit must preserve the other axis variable binding');
 for(const [family,label,property,value,expected] of [
  ['sizing','Width','width','calc(100px + 20px)','120px'],
  ['typography','Size','font-size','calc(1rem + 2px)','18px'],
  ['position','Top','top','calc(1rem + 2px)','18px'],
 ]) {
  await page.evaluate(({family})=>window.mount('.card { position:absolute; top:10px; width:100px; height:20px; font-size:16px; color:rgb(1 2 3) }',family),{family});
  if(family==='position')await page.getByRole('button',{name:'Position',exact:true}).click();
  const control=page.getByLabel(label,{exact:true});
  await control.fill(value);await control.press('Tab');
  await page.waitForFunction(({property,value})=>window.api.readCssRuleDeclarations(window.css,window.api.context)[property]===value,{property,value});
  assert.equal(await page.locator('.card').evaluate((node,property)=>getComputedStyle(node).getPropertyValue(property),property),expected,family+' must roundtrip required CSS math whitespace');
 }

 const hideCases=[
  {label:'contextual class owner',selector:'.context-card',origin:'.shell .context-card',classes:'context-card',reset:'img, svg { display:block; } .shell .context-card { display:block; }',css:'.context-card { object-fit:cover; }',traced:true,expectedSelector:'.shell .context-card',outside:true},
  {label:'contextual grouped class owner',selector:'.context-card',origin:'.shell .context-card, .sibling',classes:'context-card',reset:'img, svg { display:block; } .shell .context-card, .sibling { display:block; }',css:'.context-card { object-fit:cover; }',traced:true,expectedSelector:'.shell .context-card',outside:true},
  {label:'contextual type and modifier owner',selector:'.context-card',origin:'.shell img.context-card.active',classes:'context-card active',reset:'img, svg { display:block; } .shell img.context-card.active { display:block; }',css:'.context-card { object-fit:cover; }',traced:true,expectedSelector:'.shell img.context-card.active',outside:true},
  {label:'class under global image reset',selector:'.addons-visual__image',origin:'img, svg',classes:'addons-visual__image',reset:'img, svg { display:block; max-width:100%; }',css:'.addons-visual__image { object-fit:cover; }',traced:false},
  {label:'grouped class owner',selector:'.a',origin:'.a, .b',classes:'a',reset:'img, svg { display:block; } .a, .b { display:block; }',css:'.a { object-fit:cover; }',traced:true},
  {label:'combo under shared base class',selector:'.base.extra',origin:'.base',classes:'base extra',reset:'img, svg { display:block; } .base { display:block; }',css:'.base.extra { object-fit:cover; }',traced:false},
  {label:'ID image with no class',selector:'#hide-target',origin:'img, svg',classes:'',reset:'img, svg { display:block; }',css:'#hide-target { object-fit:cover; }',traced:false},
  {label:'authored ID winner with no class',selector:'#hide-target',origin:'#hide-target',classes:'',reset:'img, svg { display:block; } #hide-target {display:block}',css:'.unrelated { opacity:0.7; }',traced:true},
  {label:'contextual ID winner with no class',selector:'#hide-target',origin:'.shell #hide-target',classes:'',reset:'img, svg { display:block; } .shell #hide-target {display:block}',css:'.unrelated { opacity:0.7; }',traced:true,expectedSelector:'.shell #hide-target'},
  {label:'tag fallback recovered to authored ID',selector:'img',origin:'#hide-target',classes:'',reset:'img, svg { display:block; } #hide-target {display:block}',css:'.unrelated { opacity:0.7; }',traced:true,expectedSelector:'#hide-target'},
  {label:'stale context recovered to authored ID',selector:'img',origin:'#hide-target',classes:'',reset:'img, svg { display:block; } #hide-target {display:block}',css:'.unrelated { opacity:0.7; }',traced:true,expectedSelector:'#hide-target',fallback:true},
  {label:'bare image under global reset',selector:'img',origin:'img, svg',classes:'',reset:'img, svg { display:block; }',css:'.unrelated { opacity:0.7; }',traced:true,generated:true,noId:true},
 ];
 for(const fixture of hideCases){
  await page.evaluate(fixture=>window.mountHideTarget({...fixture,html:'<!doctype html><html><body><div class="shell"><img data-test-hide-target'+(fixture.noId?'':' id="hide-target"')+' class="'+fixture.classes+'"><img id="other-logo" class="logo"><img id="other-class" class="b base sibling"><img id="other-bare"><svg id="other-svg" width="20" height="20"></svg></div>'+(fixture.outside?'<img id="other-outside" class="'+fixture.classes+'">':'')+'</body></html>'}),fixture);
  const before=await page.locator('#hide-surface [id^="other-"]').evaluateAll(nodes=>nodes.map(node=>({id:node.id,display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,width:getComputedStyle(node).width,height:getComputedStyle(node).height})));
  assert.equal(await page.getByRole('button',{name:'Hide',exact:true}).count(),0,'Layout Type no longer contains Hide');
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'No',exact:true}).click();
  assert.equal(await page.locator('[data-test-hide-target]').evaluate(node=>getComputedStyle(node).display),'none',fixture.label+' must hide the selected element');
  const after=await page.locator('#hide-surface [id^="other-"]').evaluateAll(nodes=>nodes.map(node=>({id:node.id,display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,width:getComputedStyle(node).width,height:getComputedStyle(node).height})));
  assert.deepEqual(after,before,fixture.label+' must preserve every unrelated image and SVG');
  const state=await page.evaluate(()=>window.hideFixture);
  assert.ok(state.commands.some(command=>command.property==='display'&&command.value==='none'));
  assert.equal(state.result.tracedStylesheetOrigin,fixture.traced,fixture.label+' must only accept provenance whose subject retains the active identity');
  if(fixture.generated){
   assert.match(state.result.context.selector,/^\.incode-img-/,'a classless visual target must receive a stable generated class even with traced tag provenance');
   if(!fixture.noId)assert.match(state.files['index.html'],/id="hide-target"/,'generated selectors must retain authored IDs');
  }else assert.equal(state.result.context.selector,fixture.expectedSelector||fixture.selector,'provenance must retain the active identity and its authored context');
  const globalDisplay=await page.evaluate(()=>{const {cssFilePath,...base}=window.api.context;return window.api.readCssRuleDeclarations(window.hideFixture.files['reset.css'],{...base,selector:'img'}).display});
  assert.equal(globalDisplay,'block','the global reset itself must remain unchanged');
  await page.evaluate(()=>window.reopenHideTarget());
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'Yes',exact:true}).click();
  assert.equal(await page.locator('[data-test-hide-target]').evaluate(node=>getComputedStyle(node).display),'block',fixture.label+' must restore display after source reopen: '+JSON.stringify(await page.evaluate(()=>window.hideFixture)));
  assert.deepEqual(await page.locator('#hide-surface [id^="other-"]').evaluateAll(nodes=>nodes.map(node=>({id:node.id,display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,width:getComputedStyle(node).width,height:getComputedStyle(node).height}))),before);
 }
 for(const display of ['grid','inline-grid','flex','var(--Display, grid)']){
  await page.evaluate(display=>window.mountHideTarget({
   selector:'.card',origin:'.card',classes:'card',reset:'.card{--Display:grid;display:'+display+'!important;flex-direction:column-reverse;grid-template-columns:1fr 2fr;gap:31px}',css:'.other{display:block}',
   html:'<!doctype html><html><body><div data-test-hide-target id="hide-target" class="card">Target<div>A</div><div>B</div></div></body></html>',
  }),display);
  const before=await page.locator('[data-test-hide-target]').evaluate(node=>{const s=getComputedStyle(node);return {display:s.display,direction:s.flexDirection,columns:s.gridTemplateColumns,gap:s.gap}});
  const type=page.getByRole('button',{name:before.display.includes('grid')?'Grid':'Rows',exact:true});
  const selectedBefore=await type.getAttribute('aria-pressed');
  assert.equal(selectedBefore,'true');
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'No',exact:true}).click();
  await page.evaluate(()=>window.reopenHideTarget());
  assert.equal(await type.getAttribute('aria-pressed'),selectedBefore,'Layout Type remains stable while hidden after reopening');
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'Yes',exact:true}).click();
  assert.deepEqual(await page.locator('[data-test-hide-target]').evaluate(node=>{const s=getComputedStyle(node);return {display:s.display,direction:s.flexDirection,columns:s.gridTemplateColumns,gap:s.gap}}),before,'Visible restores display without changing grid, direction or gap');
  const saved=await page.evaluate(()=>window.hideFixture.files['reset.css']);
  assert.ok(saved.includes('display:'+display+'!important'),'restoration retains the exact display binding and priority');
  assert.doesNotMatch(saved,/visibility:|kodety-display-restore/);
 }
 for(const value of ['var(--Display)','var(--Missing, none)','inherit']){
  await page.evaluate(value=>window.mountHideTarget({
   selector:'.hidden-source',origin:'.hidden-source,.hidden-sibling',classes:'hidden-source',reset:':root{--Display:none}.hidden-parent{display:none}.hidden-source,.hidden-sibling{display:'+value+'!important}',css:'.other{display:block}',
   html:'<!doctype html><html><body>'+(value==='inherit'?'<section class="hidden-parent">':'')+'<div data-test-hide-target id="hide-target" class="hidden-source">Target</div><div id="hidden-sibling" class="hidden-sibling">Sibling</div>'+(value==='inherit'?'</section>':'')+'</body></html>',
  }),value);
  const readDisplay=()=>page.locator('[data-test-hide-target]').evaluate(node=>getComputedStyle(node).display);
  assert.equal(await readDisplay(),'none');
  const original=await page.evaluate(()=>window.hideFixture.files['reset.css']);
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'No',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.hideFixture.files['reset.css']),original,'repeated No must not snapshot an already hidden binding');
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'Yes',exact:true}).click();
  assert.equal(await readDisplay(),'block','Show overrides a computed-hidden binding only at the selected subject');
  assert.equal(await page.locator('#hidden-sibling').evaluate(node=>getComputedStyle(node).display),'none');
  assert.equal(await page.locator('[data-test-hide-target]').evaluate(node=>getComputedStyle(node).getPropertyValue('--Display')),'none','the shared variable remains untouched');
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'No',exact:true}).click();
  await page.evaluate(()=>window.reopenHideTarget());
  await page.locator('[data-html-layout-visibility]').getByRole('button',{name:'Yes',exact:true}).click();
  assert.equal(await readDisplay(),'block','the new explicit display survives No/source reopen/Yes');
  assert.equal(await page.locator('#hidden-sibling').evaluate(node=>getComputedStyle(node).display),'none');
 }
 await page.evaluate(()=>window.mountHideTarget({
  selector:'.context-card',origin:'.shell .context-card, .sibling',property:'gap',
  reset:'.shell .context-card, .sibling {display:flex;gap:20px}',css:'.context-card {gap:6px}',
  html:'<!doctype html><html><body><div class="shell"><div data-test-hide-target id="hide-target" class="context-card">Selected</div><div id="other-gap" class="sibling">Sibling</div></div><div id="other-outside" class="context-card">Outside</div></body></html>',
 }));
 const contextualGap=page.getByLabel('Espaço entre elementos',{exact:true});
 await contextualGap.fill('31');await contextualGap.press('Tab');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-test-hide-target]')).gap==='31px',{},{timeout:5000});
 assert.equal(await page.locator('[data-test-hide-target]').evaluate(node=>getComputedStyle(node).gap),'31px','Gap must edit the contextual winner instead of an ineffective lower-specificity class');
 assert.equal(await page.locator('#other-gap').evaluate(node=>getComputedStyle(node).gap),'20px','a contextual Gap edit must isolate the sibling selector');
 assert.equal(await page.locator('#other-outside').evaluate(node=>getComputedStyle(node).gap),'6px','a contextual Gap edit must preserve the class outside its authored ancestor');
 assert.equal(await page.evaluate(()=>window.hideFixture.files['styles.css']),'.context-card {gap:6px}','the lower-specificity declaration must remain in its original source file');
 await page.evaluate(()=>document.getElementById('hide-surface').remove());

 const scoped=await page.evaluate(()=>{
  const {patchCssDeclaration,context,breakpoints}=window.api;
  const original='.card { display:block; gap:12px; color:rgb(1 2 3) } .card:hover { gap:20px; color:rgb(2 3 4) } @media(max-width:810px){.card { gap:8px } .card:hover { gap:16px }}';
  const hover=patchCssDeclaration(original,{...context,pseudo:'hover'},'color','rgb(40 50 60)',breakpoints,{authoritative:true,viewportWidth:1440});
  const tablet=patchCssDeclaration(hover,{...context,breakpoint:'tablet'},'gap','34px',breakpoints,{authoritative:true,viewportWidth:760});
  window.scopedCss=tablet;document.getElementById('authored').textContent=tablet;
  return {hover,tablet};
 });
 assert.match(scoped.hover,/\.card \{ display:block; gap:12px; color:rgb\(1 2 3\) \}/);
 assert.match(scoped.hover,/\.card:hover \{ gap:20px; color:rgb\(40 50 60\) \}/);
 await page.locator('.card').hover();
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).color),'rgb(40, 50, 60)');
 await page.setViewportSize({width:760,height:1000});
 await page.mouse.move(700,900);
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).gap),'34px');
 await page.locator('.card').hover();
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).gap),'16px','tablet editing must leave its authored hover rule intact');
 await page.setViewportSize({width:1440,height:1000});
 await page.mouse.move(1400,900);
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).gap),'12px','editing tablet must preserve Primary');
 await page.evaluate(()=>{const {patchCssDeclaration,context,breakpoints}=window.api;document.getElementById('authored').textContent=patchCssDeclaration(window.scopedCss,{...context,breakpoint:'tablet'},'gap','',breakpoints,{authoritative:true,viewportWidth:760})});
 await page.setViewportSize({width:760,height:1000});
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).gap),'12px','clearing an exact responsive declaration must reveal its base fallback');

 await page.evaluate(()=>{
  const {patchCssDisplayVisibility,context}=window.api;
  const breakpoints=[{id:'tablet',label:'Tablet',mode:'max-width',width:810},{id:'mobile',label:'Mobile',mode:'max-width',width:480}];
  const initial='.card{--Display:inline-flex;display:var(--Display)!important;flex-direction:column-reverse}';
  const hidden=patchCssDisplayVisibility(initial,{...context,breakpoint:'tablet'},false,'inline-flex',breakpoints,{authoritative:true,viewportWidth:810}).source;
  // A source-only reopen must retain the Tablet snapshot while a Mobile
  // command creates its own visible override with the original binding.
  const reopened=JSON.parse(JSON.stringify(hidden));
  document.getElementById('authored').textContent=patchCssDisplayVisibility(reopened,{...context,breakpoint:'mobile'},true,'block',breakpoints,{authoritative:true,viewportWidth:480}).source;
 });
 for(const [width,display] of [[1000,'inline-flex'],[810,'none'],[480,'inline-flex']]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).display),display,'native responsive visibility at '+width+'px');
  assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).flexDirection),'column-reverse');
 }
 await page.evaluate(()=>{
  const {patchCssDisplayVisibility,context}=window.api;
  const breakpoints=[{id:'tablet',label:'Tablet',mode:'max-width',width:810},{id:'mobile',label:'Mobile',mode:'max-width',width:480}];
  const initial=':root{--Display:none}.card{display:grid}@media(max-width:810px){.card,.sibling{display:var(--Display)!important}}';
  const style=document.getElementById('authored');style.textContent=initial;
  const computedDisplay=getComputedStyle(document.querySelector('.card')).display;
  if(computedDisplay!=='none')throw new Error('Mobile must initially inherit a variable resolving to none');
  const shown=patchCssDisplayVisibility(initial,{...context,breakpoint:'mobile'},true,'inline-flex',breakpoints,{authoritative:true,viewportWidth:480,computedDisplay}).source;
  style.textContent=JSON.parse(JSON.stringify(shown));
 });
 for(const [width,display] of [[1000,'grid'],[810,'none'],[480,'inline-flex']]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).display),display,'Show of an inherited hidden variable remains scoped at '+width+'px after source reopen');
 }
 assert.equal(await page.locator('.sibling').evaluate(node=>getComputedStyle(node).display),'none');
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).getPropertyValue('--Display')),'none');

 const importFiles={
  'styles/root.css':'@layer components; @import "tokens.css"; @import "components/card.css" layer(components); .unrelated { opacity:0.5 }',
  'styles/tokens.css':':root { --Gap:18px; --gap:77px }',
  'styles/components/card.css':'.card, .sibling { gap:var(--Gap); color:rgb(10 20 30) } @media(min-width:1200px){.card, .sibling { gap:24px; color:rgb(40 50 60) }}',
 };
 await page.route('http://visual.test/styles/**',route=>{const key=new URL(route.request().url()).pathname.slice(1);return route.fulfill({contentType:'text/css',body:importFiles[key]||''})});
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(async()=>{document.getElementById('authored').textContent='';const link=document.createElement('link');link.id='imported';link.rel='stylesheet';link.href='/styles/root.css';const loaded=new Promise(resolve=>link.onload=resolve);document.head.append(link);await loaded});
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).gap),'24px');
 const importedPatch=await page.evaluate(files=>{
  const {resolveCssAuthoringOrigin,readCssAuthoringDeclarations,patchCssDeclaration,context,breakpoints}=window.api;
  const project={name:'Imports',openedAt:1,mainHtmlPath:'index.html',rootPath:'',files:Object.fromEntries(Object.entries(files).map(([path,text])=>[path,{path,text,mimeType:'text/css'}]))};
  const origin=resolveCssAuthoringOrigin(project,['styles/root.css'],context,'gap',breakpoints,1440);
  const read=readCssAuthoringDeclarations(project,['styles/root.css'],context,breakpoints,1440);
  const patched=patchCssDeclaration(files[origin.cssFilePath],{...context,cssFilePath:origin.cssFilePath},'gap','32px',breakpoints,{authoritative:true,viewportWidth:1440,editActiveWinner:true});
  return {origin,read,patched};
 },importFiles);
 assert.equal(importedPatch.origin.cssFilePath,'styles/components/card.css');
 assert.equal(importedPatch.read.gap,'24px');
 assert.match(importedPatch.patched,/\.card, \.sibling \{ gap:var\(--Gap\);/,'editing the active media owner must preserve the base variable binding and shared class');
 assert.match(importedPatch.patched,/@media\(min-width:1200px\)\{[^}]*gap:24px;[^}]*\}\.card \{ gap:32px;/);
 importFiles[importedPatch.origin.cssFilePath]=importedPatch.patched;
 await page.evaluate(async()=>{const old=document.getElementById('imported');old.remove();const link=document.createElement('link');link.rel='stylesheet';link.href='/styles/root.css?revision=2';const loaded=new Promise(resolve=>link.onload=resolve);document.head.append(link);await loaded});
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).gap),'32px','the browser must render the exact imported declaration edited by the source resolver');
 assert.equal(await page.locator('.sibling').evaluate(node=>getComputedStyle(node).gap),'24px','an active media winner grouped with another class must isolate only the selected class');
 await page.setViewportSize({width:760,height:1000});
 assert.equal(await page.locator('.card').evaluate(node=>getComputedStyle(node).gap),'18px','Primary winner edit must preserve the imported base binding at narrower widths');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Visual CSS source/control/browser roundtrip tests passed ('+browserName+', '+roundtrips.count+' property cases)');
} finally {await browser.close()}
