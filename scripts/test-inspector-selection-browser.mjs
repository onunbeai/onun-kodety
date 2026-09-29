import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium, firefox, webkit } from 'playwright';
import { createPerformanceProject } from './fixtures/performance-project.mjs';

const root = path.resolve(import.meta.dirname, '..');
const browserName = process.env.KODETY_TEST_BROWSER || 'chromium';
const browserType = {chromium, firefox, webkit}[browserName];
assert.ok(browserType, `Unsupported KODETY_TEST_BROWSER: ${browserName}`);
const inspectorSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'), 'utf8');
const ast = ts.createSourceFile('inspector.tsx', inspectorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tabsFunctions = ['readTabsModel', 'tabsSlug'].map(name => {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `The real Inspector must define ${name}`);
  return declaration.getText(ast);
}).join('\n');
const bundle = await build({stdin:{contents:`
import {inspectSourceElementIndex, getElementOuterHtml, readSourceElementInlineStyles} from './lib/html-editor/source-patcher';
${tabsFunctions}
window.api={inspectSourceElementIndex,getElementOuterHtml,readSourceElementInlineStyles,readTabsModel};
`,resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent'});
const browser = await browserType.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const correctness = await page.evaluate(() => {
    const api=window.api;
    const source='<!doctype html><html><body style="color:red;gap:12px 24px"><main style="color:blue"><table><tbody><tr style="height:31px"><td style="color:green">Cell</td></tr></tbody></table><p>No inline style</p></main></body></html>';
    const indexed=api.inspectSourceElementIndex(source).elements;
    const byTag=tag=>indexed.find(node=>node.tagName===tag);
    const oldBody=new DOMParser().parseFromString(api.getElementOuterHtml(source,''),'text/html').body.firstElementChild.getAttribute('style');
    const body=api.readSourceElementInlineStyles(source,'','color:purple');
    const row=api.readSourceElementInlineStyles(source,byTag('tr').path,'height:99px');
    const cell=api.readSourceElementInlineStyles(source,byTag('td').path);
    const plain=api.readSourceElementInlineStyles(source,byTag('p').path,'color:purple');
    const runtime=api.readSourceElementInlineStyles(source,'missing','color:purple');
    const calls=[];
    const parse=DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString=function(...args){calls.push(args);return parse.apply(this,args)};
    let tabs;
    try {
      for(let i=0;i<10;i++) api.readSourceElementInlineStyles(source,'');
      api.readTabsModel('<div><p>Ordinary selected container</p></div>',{});
      const ordinaryParses=calls.length;
      tabs=api.readTabsModel('<div><button role="t&#97;b" aria-controls="pane">First</button><div id="pane" role="tabpanel">Content</div></div>',{});
      return {oldBody,body,row,cell,plain,runtime,ordinaryParses,tabs};
    } finally {DOMParser.prototype.parseFromString=parse}
  });
  assert.equal(correctness.oldBody,'color:blue','fixture must reproduce the old body/child style confusion');
  assert.deepEqual(correctness.body,{color:'red',gap:'12px 24px'});
  assert.deepEqual(correctness.row,{height:'31px'});
  assert.deepEqual(correctness.cell,{color:'green'});
  assert.deepEqual(correctness.plain,{},'source without an inline declaration must beat a stale iframe value');
  assert.deepEqual(correctness.runtime,{color:'purple'},'runtime-only nodes keep their fallback');
  assert.equal(correctness.ordinaryParses,0,'selecting an ordinary container must not parse its descendants again');
  assert.equal(correctness.tabs.items[0].label,'First','the cheap tabs guard must retain entity-encoded role values');
  assert.equal(correctness.tabs.items[0].content,'Content');

  const measurements=[];
  for(const profile of ['medium','large']) {
    const {files,manifest}=await createPerformanceProject(profile);
    const result=await page.evaluate(({source})=>{
      const api=window.api,index=api.inspectSourceElementIndex(source);
      const main=index.elements.find(node=>node.tagName==='main');
      const markup=api.getElementOuterHtml(source,main.path);
      const legacy=()=>{
        new DOMParser().parseFromString(markup,'text/html').body.firstElementChild?.getAttribute('style');
        const tabsRoot=new DOMParser().parseFromString(markup,'text/html').body.firstElementChild;
        tabsRoot?.querySelectorAll('[role="tab"]');tabsRoot?.querySelectorAll('[role="tabpanel"]');
      };
      const current=()=>{api.readSourceElementInlineStyles(source,main.path);};
      const measure=fn=>{const values=[];for(let i=0;i<25;i++){const t=performance.now();fn();values.push(performance.now()-t)}values.sort((a,b)=>a-b);return {medianMs:values[12],p95Ms:values[23]}};
      return {legacy:measure(legacy),current:measure(current)};
    },{source:files['index.html']});
    measurements.push({profile,elements:manifest.sourceElementsPerPage,htmlBytes:manifest.htmlBytesPerPage,...result});
  }
  console.log(JSON.stringify({browser:browserName,inspectorSourceReads:measurements},null,2));
  console.log('Inspector authored inline values and selection parsing behavior passed');
} finally {await browser.close()}
