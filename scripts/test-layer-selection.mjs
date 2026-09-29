import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
import { createPerformanceProject } from './fixtures/performance-project.mjs';

const vite=await createServer({configFile:false,logLevel:'silent',server:{middlewareMode:true}});
try {
 const {indexHtmlLayerSelection,createHtmlLayerSelectionState}=await vite.ssrLoadModule('/lib/html-editor/layer-selection.ts');
 const {inspectSourceElementIndex}=await vite.ssrLoadModule('/lib/html-editor/source-patcher.ts');
 const entries=[
  {path:'0',depth:0,canHaveChildren:true,hasVisibleChildren:true},
  {path:'0/0',depth:1,canHaveChildren:true,hasVisibleChildren:true},
  {path:'0/0/0',depth:2,canHaveChildren:false,hasVisibleChildren:false},
  {path:'0/1',depth:1,canHaveChildren:true,hasVisibleChildren:false},
  {path:'1',depth:0,canHaveChildren:false,hasVisibleChildren:false},
 ];
 const index=indexHtmlLayerSelection(entries);
 assert.equal(index.get('0').lastVisibleDescendant,'0/1');
 assert.equal(index.get('0/0').lastVisibleDescendant,'0/0/0');
 assert.equal(index.get('0/1').lastVisibleDescendant,null,'a collapsed container has no visible descendant');
 for(const selected of [['0'],['0/0'],['0','0/0'],['0/0','0'],['0/1','1'],[],['missing']]){
  const selection=createHtmlLayerSelectionState(index,new Set(selected));
  for(const entry of entries){
   const ancestor=selected.find(path=>entry.path!==path&&entry.path.startsWith(path+'/'));
   const descendants=ancestor?entries.filter(candidate=>candidate.path!==ancestor&&candidate.path.startsWith(ancestor+'/')):[];
   assert.deepEqual(selection.get(entry.path),{
    isSelected:selected.includes(entry.path),isChildOfSelected:ancestor!==undefined,
    isLastVisibleDescendant:ancestor!==undefined&&descendants.at(-1)?.path===entry.path,
    hasVisibleChildren:entry.hasVisibleChildren,
   },'selection, overlap order, collapsed rows and descendant rails must retain their behavior');
  }
 }
 const measurements=[];
 for(const profile of ['medium','large']){
  const {files}=await createPerformanceProject(profile);
  const entries=inspectSourceElementIndex(files['index.html']).elements.filter(e=>e.path).map(e=>({path:e.path,depth:e.path.split('/').length-1,canHaveChildren:['main','section','article','div'].includes(e.tagName),hasVisibleChildren:['main','section','article','div'].includes(e.tagName)}));
  const index=indexHtmlLayerSelection(entries);
  const selected=new Set(entries.filter((_,i)=>i%17===0).map(e=>e.path));
  // Reference mirrors the previous all-row traversal so timing describes the
  // removed work; assertions compare its visible row results with production.
  const legacy=()=>{
   const last=new Map([...selected].map(path=>[path,entries.filter(e=>e.path!==path&&e.path.startsWith(path+'/')).at(-1)?.path]));
   return new Map(entries.map(e=>{const ancestor=[...selected].find(path=>e.path!==path&&e.path.startsWith(path+'/'));return [e.path,{isSelected:selected.has(e.path),isChildOfSelected:ancestor!==undefined,isLastVisibleDescendant:ancestor!==undefined&&last.get(ancestor)===e.path,hasVisibleChildren:e.hasVisibleChildren}]}));
  };
  const start=performance.now(),old=legacy(),legacyMs=performance.now()-start;
  const nextStart=performance.now(),next=createHtmlLayerSelectionState(index,selected);
  const visible=entries.slice(Math.floor(entries.length/2),Math.floor(entries.length/2)+60).map(e=>next.get(e.path));
  const currentMs=performance.now()-nextStart;
  for(const entry of entries)assert.deepEqual(next.get(entry.path),old.get(entry.path));
  measurements.push({profile,rows:entries.length,selected:selected.size,renderedRows:visible.length,legacyMs,currentMs});
 }
 console.log(JSON.stringify({layerSelection:measurements},null,2));
 console.log('Layer selection/visible descendant behavior passed');
} finally {await vite.close()}
