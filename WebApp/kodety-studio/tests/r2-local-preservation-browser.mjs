// Chromium proof using the real R2 transport, credential storage, durable sync
// queue, HTML file sessions and restore implementation. Only the WebContainer
// signer and Cloudflare's network are substituted; IndexedDB/OPFS are real.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import JSZip from 'jszip';
import { buildCodeComponentReactRuntime } from '../../../scripts/vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const account = '0123456789abcdef0123456789abcdef';
const bucket = 'preservation-fixture';
const r2Origin = `https://${account}.r2.cloudflarestorage.com`;
const config = {accountId:account,bucket,accessKeyId:'a'.repeat(32),secretAccessKey:'b'.repeat(64)};
const bundle = await build({
  stdin: {resolveDir:root,loader:'ts',contents:`
    import * as r2 from './WebApp/kodety-studio/src/r2-storage';
    import * as sync from './WebApp/kodety-studio/src/r2-project-sync';
    import * as directory from './WebApp/kodety-studio/src/html-directory';
    import { browserProjectRepository, LIBRARY_KEY } from './WebApp/kodety-studio/src/project-library';
    import { scheduleHtmlR2Snapshot } from './WebApp/kodety-studio/src/r2-html-snapshot';
    import { restoreR2ProjectAsCopy } from './WebApp/kodety-studio/src/r2-project-restore';
    const ids={browser:'existing-html-browser',folder:'existing-html-folder',wordpress:'existing-wordpress-legacy'};
    const repository=browserProjectRepository();
    async function write(handle,name,contents){const file=await handle.getFileHandle(name,{create:true});const writer=await file.createWritable();await writer.write(contents);await writer.close()}
    async function readDb(name,store,key){const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).get(key);tx.oncomplete=()=>{db.close();resolve(req.result)};tx.onerror=()=>reject(tx.error)})}
    async function allFiles(handle,prefix=''){const result={};for await(const[name,entry]of handle.entries()){if(entry.kind==='directory')Object.assign(result,await allFiles(entry,prefix+name+'/'));else result[prefix+name]=[...new Uint8Array(await(await entry.getFile()).arrayBuffer())]}return result}
    async function seed(){
      const root=await navigator.storage.getDirectory();
      const browser=await directory.createManagedHtmlDirectory(ids.browser);
      const folder=await root.getDirectoryHandle('original-folder',{create:true});
      await directory.bindHtmlDirectory(ids.folder,folder);
      for(const [id,handle]of [[ids.browser,browser],[ids.folder,folder]]){
        await write(handle,'index.html','<!doctype html><html><head><title>Original</title></head><body><h1>'+id+'</h1></body></html>');
        await write(handle,'asset.bin',new Uint8Array([0,255,19,128,4]));
        await write(handle,'authored.css','h1 { color: red !important; }\\n');
      }
      const wordpress=await root.getDirectoryHandle('wordpress-legacy-opfs',{create:true});
      await write(wordpress,'database.sqlite',new Uint8Array([83,81,76,0,255,1]));
      await write(wordpress,'wp-config.php','<?php /* original legacy config */');
      const safety=await root.getDirectoryHandle('wordpress-safety-folder',{create:true});
      await write(safety,'original-backup.zip',new Uint8Array([80,75,3,4,0,255]));
      await new Promise((resolve,reject)=>{const req=indexedDB.open('kodetyStudioSecurityFolderV1',1);req.onupgradeneeded=()=>req.result.createObjectStore('settings',{keyPath:'key'});req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('settings','readwrite');tx.objectStore('settings').put({key:'security-folder:'+ids.wordpress,rootHandle:safety,projectFolders:{[ids.wordpress]:'old-project'},lastBackups:{[ids.wordpress]:1700000000000}});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});
      const now=1700000000000;
      localStorage.setItem(LIBRARY_KEY,JSON.stringify([
        {id:ids.browser,name:'Browser original',mode:'html',storageMode:'browser',initialized:true,createdAt:now,updatedAt:now,wordpressLocale:'pt_BR'},
        {id:ids.folder,name:'Folder original',mode:'html',storageMode:'folder',directoryName:'original-folder',initialized:true,createdAt:now,updatedAt:now,wordpressLocale:'en_US'},
        {id:ids.wordpress,name:'Legacy WordPress',initialized:true,createdAt:now,updatedAt:now,directoryName:'wordpress-safety-folder',wordpressLocale:'pt_BR',legacyMarker:'preserve me'}
      ]));
      window.originalHandles={browser,folder,safety};
      return snapshot();
    }
    async function snapshot(){
      const root=await navigator.storage.getDirectory();
      const browser=await directory.readHtmlDirectoryHandle(ids.browser),folder=await directory.readHtmlDirectoryHandle(ids.folder);
      const safety=await readDb('kodetyStudioSecurityFolderV1','settings','security-folder:'+ids.wordpress);
      return {catalog:localStorage.getItem(LIBRARY_KEY),projects:repository.read(),files:await allFiles(root),bindings:{browser:await directory.readHtmlDirectoryStorageMode(ids.browser),folder:await directory.readHtmlDirectoryStorageMode(ids.folder),sameBrowser:window.originalHandles?await browser.isSameEntry(window.originalHandles.browser):true,sameFolder:await folder.isSameEntry(await root.getDirectoryHandle('original-folder')),sameSafety:await safety.rootHandle.isSameEntry(await root.getDirectoryHandle('wordpress-safety-folder')),safety:{key:safety.key,projectFolders:safety.projectFolders,lastBackups:safety.lastBackups}}};
    }
    async function editAndSave(id,label){
      const project=repository.read().find(project=>project.id===id);
      const handle=await directory.readHtmlDirectoryHandle(id);
      const loaded=await directory.loadHtmlDirectory(handle,project.name);
      const session=directory.createHtmlDirectorySession(handle,loaded);
      const next={...loaded,files:{...loaded.files,'index.html':{...loaded.files['index.html'],text:'<!doctype html><html><head><title>Saved offline</title></head><body><h1>'+label+'</h1></body></html>'}}};
      await session.save(next);await session.flush();
      const saved=await(await handle.getFileHandle('index.html')).getFile();
      await scheduleHtmlR2Snapshot(project,next);
      return {text:await saved.text(),asset:[...new Uint8Array(await(await(await handle.getFileHandle('asset.bin')).getFile()).arrayBuffer())]};
    }
    window.fixture={r2,sync,directory,repository,ids,seed,snapshot,editAndSave,restoreR2ProjectAsCopy,readDb,allFiles};
  `},
  plugins:[{name:'isolated-signing-boundary',setup(build){
    build.onResolve({filter:/^virtual:coday-react-runtime$/},()=>({path:'runtime',namespace:'actual-react-runtime'}));
    build.onLoad({filter:/.*/,namespace:'actual-react-runtime'},async()=>({contents:`export default ${JSON.stringify(await buildCodeComponentReactRuntime())}`}));
    build.onResolve({filter:/\?raw$/},args=>({path:args.path.startsWith('.')?path.resolve(args.resolveDir,args.path.slice(0,-4)):require.resolve(args.path.slice(0,-4)),namespace:'raw-source'}));
    build.onLoad({filter:/.*/,namespace:'raw-source'},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}));
    build.onResolve({filter:/^\.\/r2-storage-signer$/},()=>({path:'signer',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`
      export async function signR2InWebContainer(input,signal){
        signal.throwIfAborted();
        const base='https://'+input.config.accountId+'.r2.cloudflarestorage.com';
        const path='/'+input.config.bucket+(input.key===undefined?'':'/'+input.key.split('/').map(encodeURIComponent).join('/'));
        const url=new URL(base+path);for(const[key,value]of Object.entries(input.query||{}))url.searchParams.set(key,value);
        return {url:url.href,method:input.method,headers:{Authorization:'AWS4-HMAC-SHA256 Fixture','x-amz-date':'20260919T120000Z','x-amz-content-sha256':input.payloadHash,...(input.contentType?{'content-type':input.contentType}:{}),...input.headers}};
      }
      export function disposeR2Signer(){}
    `}));
  }}],
  bundle:true,write:false,outdir:'/tmp/kodety-r2-preservation',platform:'browser',format:'esm',logLevel:'silent',
  loader:{'.wasm':'binary','.css':'empty','.svg':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},define:{'process.env.NODE_ENV':'"test"'},
});
const script=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const objects=new Map(),calls=[];
let offline=false;
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cors={'access-control-allow-origin':'https://r2-local.test','access-control-allow-methods':'GET,PUT,DELETE,HEAD,OPTIONS','access-control-allow-headers':'*','access-control-expose-headers':'ETag'};
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
const page=await context.newPage();
const errors=[],unexpected=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='https://r2-local.test')return route.fulfill({contentType:url.pathname==='/fixture.js'?'application/javascript':'text/html',body:url.pathname==='/fixture.js'?script:'<!doctype html><title>R2 local preservation</title><script type="module" src="/fixture.js"></script>'});
    if(url.origin!==r2Origin){unexpected.push(url.href);return route.abort()}
    const method=request.method();
    if(method==='OPTIONS')return route.fulfill({status:204,headers:cors});
    calls.push({method,url:url.href,headers:request.headers()});
    assert.ok(url.pathname===`/${bucket}`||url.pathname.startsWith(`/${bucket}/kodety-studio/v1/`),'R2 access stays inside the selected bucket and Studio prefix');
    if(offline)return route.abort('internetdisconnected');
    if(url.searchParams.get('list-type')==='2'){
      const prefix=url.searchParams.get('prefix');
      const contents=[...objects].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>`<Contents><Key>${xml(key)}</Key><Size>${value.body.length}</Size><ETag>${xml(value.etag)}</ETag><LastModified>2026-09-19T12:00:00Z</LastModified></Contents>`).join('');
      return route.fulfill({status:200,headers:cors,contentType:'application/xml',body:`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`});
    }
    const key=decodeURIComponent(url.pathname.slice(bucket.length+2));
    const existing=objects.get(key),headers=request.headers();
    if(method==='GET'||method==='HEAD')return route.fulfill({status:existing?200:404,headers:{...cors,...(existing?{etag:existing.etag}:{})},body:method==='HEAD'?'':existing?.body||''});
    if(method==='PUT'){
      if(headers['if-none-match']==='*'&&existing||headers['if-match']&&headers['if-match']!==existing?.etag)return route.fulfill({status:412,headers:cors});
      const body=request.postDataBuffer()||Buffer.alloc(0),etag='"'+createHash('sha256').update(body).digest('hex')+'"';
      objects.set(key,{body,etag});return route.fulfill({status:200,headers:{...cors,etag}});
    }
    if(method==='DELETE'){objects.delete(key);return route.fulfill({status:204,headers:cors})}
    throw new Error('Unexpected R2 operation '+method);
  });
  await page.goto('https://r2-local.test/');
  await page.waitForFunction(()=>!!window.fixture);
  const initial=await page.evaluate(()=>window.fixture.seed());
  assert.equal(initial.projects.length,3);
  await page.evaluate(config=>window.fixture.r2.connectR2(config,{remember:false}),config);
  assert.deepEqual(await page.evaluate(()=>window.fixture.snapshot()),initial,'Connecting preserves the exact existing catalog, handles and all OPFS bytes');
  assert.equal(objects.size,0,'Connection only probes its own temporary key; it does not migrate existing projects');
  await page.evaluate(()=>window.fixture.r2.disconnectR2());
  assert.deepEqual(await page.evaluate(()=>window.fixture.snapshot()),initial,'Disconnecting preserves every existing local project and binding');
  await page.evaluate(config=>window.fixture.r2.connectR2(config,{remember:true}),config);
  offline=true;
  for(const[id,label]of [['existing-html-browser','Browser saved offline'],['existing-html-folder','Folder saved offline']]){
    const saved=await page.evaluate(({id,label})=>window.fixture.editAndSave(id,label),{id,label});
    assert.match(saved.text,new RegExp(label));
    assert.deepEqual(saved.asset,[0,255,19,128,4]);
  }
  await expect.poll(()=>page.evaluate(()=>window.fixture.sync.getR2SyncState().pending)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>window.fixture.sync.getR2SyncState().active)).toBe(false);
  const savedOffline=await page.evaluate(()=>window.fixture.snapshot());
  assert.equal(savedOffline.catalog,initial.catalog,'An offline cloud failure cannot change the local project catalog');
  assert.deepEqual(savedOffline.bindings,initial.bindings);
  for(const[key,value]of Object.entries(initial.files))if(!key.includes('index.html'))assert.deepEqual(savedOffline.files[key],value,`Untouched original file remains byte-identical: ${key}`);
  assert.equal(objects.size,0,'Offline saves do not claim a remote copy exists');
  await page.reload();
  await page.waitForFunction(()=>!!window.fixture);
  await page.evaluate(()=>window.fixture.r2.getR2Connection());
  await expect.poll(()=>page.evaluate(()=>window.fixture.sync.getR2SyncState().pending)).toBe(2);
  const reloaded=await page.evaluate(()=>window.fixture.snapshot());
  assert.equal(reloaded.catalog,initial.catalog);
  assert.deepEqual(reloaded.files,savedOffline.files,'Original saved files survive full navigation while cloud copies are pending');
  offline=false;
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));return window.fixture.sync.retryR2Sync()});
  await expect.poll(()=>page.evaluate(()=>window.fixture.sync.getR2SyncState().pending)).toBe(0);
  const remote=await page.evaluate(()=>window.fixture.sync.listR2Projects());
  assert.equal(remote.length,2);
  for(const project of remote){
    const archive=await JSZip.loadAsync(objects.get(project.archiveKey).body);
    assert.match(await archive.file('index.html').async('string'),/saved offline/);
    assert.deepEqual([...await archive.file('asset.bin').async('uint8array')],[0,255,19,128,4]);
    for(const file of Object.values(archive.files))if(!file.dir)assert.equal((await file.async('string')).includes(config.secretAccessKey),false,'R2 credentials never enter project archives');
  }
  const beforeRestore=await page.evaluate(()=>window.fixture.snapshot());
  const recovered=await page.evaluate(remote=>window.fixture.restoreR2ProjectAsCopy(remote),remote.find(project=>project.id==='existing-html-browser'));
  assert.ok(!initial.projects.some(project=>project.id===recovered.id));
  assert.equal(recovered.storageMode,'browser');
  const afterRestore=await page.evaluate(()=>window.fixture.snapshot());
  assert.deepEqual(afterRestore.projects.filter(project=>project.id!==recovered.id),beforeRestore.projects,'Recovery adds a new ID and preserves every existing project record');
  assert.deepEqual(afterRestore.bindings,beforeRestore.bindings,'Recovery cannot rebind an existing local folder');
  for(const[key,value]of Object.entries(beforeRestore.files))assert.deepEqual(afterRestore.files[key],value,`Recovery cannot overwrite original bytes: ${key}`);
  const recoveredFiles=await page.evaluate(async id=>window.fixture.allFiles(await window.fixture.directory.readHtmlDirectoryHandle(id)),recovered.id);
  assert.match(new TextDecoder().decode(new Uint8Array(recoveredFiles['index.html'])),/Browser saved offline/);
  assert.deepEqual(recoveredFiles['asset.bin'],[0,255,19,128,4]);
  const remoteBeforeDisconnect=[...objects].map(([key,value])=>({key,etag:value.etag}));
  await page.evaluate(()=>window.fixture.r2.disconnectR2());
  assert.deepEqual(await page.evaluate(()=>window.fixture.snapshot()),afterRestore,'Disconnect after recovery preserves every local copy');
  assert.deepEqual([...objects].map(([key,value])=>({key,etag:value.etag})),remoteBeforeDisconnect,'Disconnect never deletes remote project copies');
  assert.equal(await page.evaluate(()=>window.fixture.r2.getR2Connection()),null);
  assert.deepEqual(errors,[]);
  assert.deepEqual(unexpected,[]);
  assert.ok(calls.every(call=>new URL(call.url).origin===r2Origin));
  console.log('R2 real Chromium PASS: three pre-existing local projects/catalog/OPFS bindings preserved on connect/disconnect; browser + folder edits saved offline; durable IDB queue survives navigation and syncs online; binary archives verified; recovery creates a new local ID without overwriting any original.');
}catch(error){console.error({errors,unexpected,calls:calls.map(call=>({method:call.method,url:call.url}))});throw error}finally{await browser.close()}
