// Real R2 settings/onboarding components with an isolated connection/sync boundary.
// No Cloudflare account or existing browser data is accessed.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { R2StoragePanel } from './WebApp/kodety-studio/src/r2-storage-panel';
    import { Onboarding } from './WebApp/kodety-studio/src/onboarding';
    import './WebApp/kodety-studio/src/webapp.css';
    const root = createRoot(document.getElementById('root'));
    window.mountFixture = (language, onboarding = false) => {
      root.render(onboarding ? <Onboarding language={language} initialMode="html" onLanguageChange={() => {}} onComplete={() => {}} onClose={() => {}} /> : <div className="web-app"><main className="fixture-settings"><R2StoragePanel language={language} /></main></div>);
    };
  ` },
  plugins: [{ name: 'r2-boundary-fixture', setup(build) {
    build.onResolve({ filter: /^\.\/r2-(?:storage|project-sync|project-restore)$/ }, args => ({ path: args.path, namespace: 'r2-fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'r2-fixture' }, ({ path }) => ({ loader: 'js', contents: path === './r2-storage' ? `
      const state = window.r2Fixture = { connection: null, info: null, calls: [], listeners: [], fail: false, syncing: {pending:0, active:false}, syncListeners:[], projects:[{id:'remote-one',name:'Site original',mode:'html',updatedAt:1800000000000,archiveKey:'archive-one',revision:'one'}] };
      export const getR2ConnectionInfo = () => state.info;
      export const getR2Connection = async () => state.connection;
      export const subscribeR2Connection = listener => { state.listeners.push(listener); return () => {state.listeners=state.listeners.filter(item=>item!==listener)}; };
      export const makeR2CorsPolicy = origin => [{AllowedOrigins:[origin],AllowedMethods:['GET','PUT','DELETE','HEAD'],AllowedHeaders:['authorization','content-type','x-amz-content-sha256','x-amz-date','if-match','if-none-match'],ExposeHeaders:['ETag'],MaxAgeSeconds:3600}];
      export async function connectR2(config, options) {
        state.calls.push({operation:'test-and-connect', config:{...config}, options});
        if(state.fail) throw Object.assign(new Error('fixture failed'),{code:'r2-auth'});
        state.connection={id:'fixture',config:{...config}};
        state.info={id:'fixture',accountId:config.accountId,bucket:config.bucket,remembered:options.remember,connectedAt:1800000000000};
        state.listeners.forEach(listener=>listener());
      }
      export async function testR2Connection(config) { state.calls.push({operation:'test',config:{...config}}); }
      export async function disconnectR2() { state.calls.push({operation:'disconnect'}); state.connection=null; state.info=null; state.listeners.forEach(listener=>listener()); }
    ` : path === './r2-project-sync' ? `
      export const getR2SyncState=()=>({...window.r2Fixture.syncing});
      export const retryR2Sync=async()=>{window.r2Fixture.calls.push({operation:'retry'})};
      export const subscribeR2Sync=listener=>{window.r2Fixture.syncListeners.push(listener);return()=>{window.r2Fixture.syncListeners=window.r2Fixture.syncListeners.filter(item=>item!==listener)}};
      export const listR2Projects=async()=>{window.r2Fixture.calls.push({operation:'list'});return window.r2Fixture.projects};
    ` : `
      export const restoreR2ProjectAsCopy=async project=>{window.r2Fixture.calls.push({operation:'restore',project});};
    ` }));
  } }],
  absWorkingDir: root, bundle: true, write: false, outdir: '/tmp/kodety-r2-ui', platform: 'browser', format: 'iife', jsx: 'automatic', logLevel: 'silent',
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'true' },
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const style = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const browser = await chromium.launch({ headless: true });
let activePage;
try {
  for (const language of ['pt', 'en']) {
    const l = (pt, en) => language === 'pt' ? pt : en;
    const page = activePage = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    const errors = [], unexpectedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() !== 'https://r2-ui.test/') unexpectedRequests.push(route.request().url());
      return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'});
    });
    await page.goto('https://r2-ui.test/');
    await page.addStyleTag({content:style+' .fixture-settings{box-sizing:border-box;width:min(100%,1050px);margin:auto;padding:40px}.web-app{height:auto;min-height:100vh}'});
    await page.addScriptTag({content:script});
    await page.evaluate(language => {
      localStorage.setItem('kodetyStudioProjectsV1', '[{"id":"untouched","name":"Original local"}]');
      window.mountFixture(language);
    }, language);
    const panel = page.getByRole('region', {name:l('Seu armazenamento R2','Your R2 storage')});
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(l('não move, apaga ou substitui arquivos existentes', 'does not move, delete, or replace existing files'));
    const fillConfig = async () => {
      await panel.getByLabel('Account ID', {exact:true}).fill('0123456789abcdef0123456789abcdef');
      await panel.getByLabel(l('Nome do bucket','Bucket name'),{exact:true}).fill('my-projects');
      await panel.getByLabel('Access Key ID',{exact:true}).fill('abcdef0123456789abcdef0123456789');
      await panel.getByLabel('Secret Access Key',{exact:true}).fill('a'.repeat(64));
    };
    await expect(panel.getByLabel('Secret Access Key',{exact:true})).toHaveAttribute('type','password');
    await expect(panel.getByRole('checkbox')).not.toBeChecked();
    await panel.getByText(l('Como preparar meu bucket e as chaves','How to prepare my bucket and keys'),{exact:true}).click();
    const policy = JSON.parse(await panel.getByLabel(l('Política CORS para este WebApp','CORS policy for this WebApp')).inputValue());
    assert.deepEqual(policy[0].AllowedOrigins, ['https://r2-ui.test']);
    assert.ok(policy[0].AllowedMethods.includes('PUT'));
    await expect(panel).toContainText('Object Read & Write');
    await fillConfig();
    await expect(panel).toContainText('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
    await page.evaluate(()=>{window.r2Fixture.fail=true});
    await panel.getByRole('button',{name:l('Testar e conectar','Test and connect'),exact:true}).click();
    await expect(panel.getByRole('alert')).toContainText(l('O R2 recusou o acesso','R2 denied access'));
    assert.equal(await page.evaluate(()=>window.r2Fixture.info), null);
    await expect(panel.getByRole('button',{name:l('Recuperar projetos do R2','Recover projects from R2'),exact:true})).toHaveCount(0);
    await page.evaluate(()=>{window.r2Fixture.fail=false});
    await panel.getByRole('button',{name:l('Testar e conectar','Test and connect'),exact:true}).click();
    await expect(panel.getByText(l('Bucket conectado','Bucket connected'),{exact:true})).toBeVisible();
    await expect(panel).toContainText(l('Somente nesta aba','Only in this tab'));
    assert.equal(await page.evaluate(()=>window.r2Fixture.info.remembered), false);
    assert.equal(await page.evaluate(()=>window.r2Fixture.calls.filter(call=>['restore','list'].includes(call.operation)).length),0,'Connecting must not recover or migrate existing projects');
    await panel.getByRole('button',{name:l('Testar conexão','Test connection'),exact:true}).click();
    await expect(panel).toContainText(l('Leitura e gravação verificadas','Reading and writing verified'));
    await page.evaluate(()=>{window.r2Fixture.syncing={pending:2,active:false,error:'private internal exception'};window.r2Fixture.syncListeners.forEach(listener=>listener())});
    await expect(panel).toContainText(l('2 cópias aguardando sincronização','2 copies waiting to sync'));
    await expect(panel).not.toContainText('private internal exception');
    await panel.getByRole('button',{name:l('Tentar sincronizar novamente','Retry synchronization'),exact:true}).click();
    assert.equal(await page.evaluate(()=>window.r2Fixture.calls.filter(call=>call.operation==='retry').length),1);
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'))});
    await expect(panel).toContainText(l('Você está offline','You are offline'));
    await expect(panel.getByRole('button',{name:l('Testar conexão','Test connection'),exact:true})).toBeDisabled();
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'))});
    await panel.getByRole('button',{name:l('Recuperar projetos do R2','Recover projects from R2'),exact:true}).click();
    await expect(panel.getByText('Site original',{exact:true})).toBeVisible();
    await panel.getByRole('button',{name:l('Recuperar como cópia','Recover as a copy'),exact:true}).click();
    await expect(panel).toContainText(l('recuperado como uma nova cópia','recovered as a new copy'));
    assert.equal(await page.evaluate(()=>window.r2Fixture.calls.filter(call=>call.operation==='restore').length),1);
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button',{name:l('Testar e atualizar conexão','Test and update connection'),exact:true}).click();
    await expect(panel).toContainText(l('Lembradas neste navegador','Remembered in this browser'));
    await page.screenshot({path:`/tmp/kodety-r2-settings-${language}.png`,fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    const connectButton=panel.getByRole('button',{name:l('Testar e atualizar conexão','Test and update connection'),exact:true});
    await connectButton.scrollIntoViewIfNeeded();
    const bounds=await connectButton.boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
    assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'R2 panel must fit mobile width');
    await page.screenshot({path:`/tmp/kodety-r2-settings-mobile-${language}.png`,animations:'disabled'});
    await panel.getByRole('button',{name:l('Desconectar R2','Disconnect R2'),exact:true}).click();
    await expect(panel).toContainText(l('Os projetos locais e as cópias no bucket foram preservados','Local projects and copies in the bucket were preserved'));
    await expect(panel.getByLabel('Secret Access Key',{exact:true})).toHaveValue('');
    assert.equal(await page.evaluate(()=>localStorage.getItem('kodetyStudioProjectsV1')),'[{"id":"untouched","name":"Original local"}]');
    await page.setViewportSize({width:1300,height:1000});
    await page.evaluate(language=>window.mountFixture(language,true),language);
    await page.getByRole('button',{name:new RegExp(l('Armazenamento e backup','Storage and backup'))}).click();
    await page.getByText(l('Adicionar meu Cloudflare R2 (opcional)','Add my Cloudflare R2 (optional)'),{exact:true}).click();
    await expect(page.getByRole('region',{name:l('Seu armazenamento R2','Your R2 storage')})).toBeVisible();
    await page.screenshot({path:`/tmp/kodety-r2-onboarding-${language}.png`,fullPage:true,animations:'disabled'});
    assert.deepEqual(errors,[]);
    assert.deepEqual(unexpectedRequests,[]);
    console.log(`${language}: R2 connection test/failure, scoped CORS, optional credentials, additional-copy guarantees, sync status, recovery, disconnect, WebApp onboarding and mobile passed.`);
    await page.close();
  }
} catch(error) {
  console.error(await activePage?.locator('body').innerText().catch(()=>''));
  await activePage?.screenshot({path:'/tmp/kodety-r2-ui-failure.png',fullPage:true}).catch(()=>{});
  throw error;
} finally { await browser.close(); }
