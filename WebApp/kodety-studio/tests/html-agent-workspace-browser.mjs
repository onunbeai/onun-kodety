// Full Studio -> HtmlWorkspace -> shared Settings navigation. Only the remote
// license source and WebContainer process are deterministic adapters; the host
// policy, React providers, settings route and packaged skill catalog are real.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import { readBrowserAgentSkills } from '../../../scripts/browser-agent-skill-catalog.mjs';
import { createBrowserAgentRuntime } from '../../../lib/html-editor/browser-agent-runtime.mjs';
import { normalizeBrowserAgentUsage } from '../../../lib/html-editor/browser-agent-usage.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const skills = await readBrowserAgentSkills();
assert.ok(skills.length >= 5);
const modelRuntime = createBrowserAgentRuntime({ projectId: 'menu-fixture', licensed: true });
const modelResponse = await modelRuntime.request('rpc', { body: { method: 'model/list' } });
await modelRuntime.dispose();
const usageResponse = normalizeBrowserAgentUsage({ rate_limit: {
  primary_window: { used_percent: 42, limit_window_seconds: 18_000, reset_at: 1_790_000_000 },
  secondary_window: { used_percent: 5, limit_window_seconds: 604_800, reset_at: 1_790_600_000 },
} });
const licenseFile = path.join(root, 'WebApp/kodety-studio/src/html-license.ts');
const bindingFile = path.join(root, 'lib/html-editor/browser-agent-webcontainer.ts');
const workspaceFile = path.join(root, 'WebApp/kodety-studio/src/html-workspace.tsx');
const fixturePlugin = {
  name: 'html-agent-host-regression-fixtures', enforce: 'pre',
  transform(source, id) {
    if (id.split('?')[0] === licenseFile) return source.replace('export function createHtmlLicenseClient(', 'function originalCreateHtmlLicenseClient(') + `
export function createHtmlLicenseClient() {
  const product=createKodetyProductAccess({licensed:true});
  window.agentHostFixture.product=product;
  const snapshot={product,status:{configured:true,valid:true,status:'active',plan:'pro',keyMask:'fixture',expiresAt:'',nextCheckAt:'',graceUntil:'',lastCheckedAt:'',isTrial:false,trialExpired:false},busy:false,error:'',errorPortuguese:''};
  return {getSnapshot:()=>snapshot,subscribe:()=>()=>{},load:async()=>snapshot,check:async()=>snapshot,activate:async()=>snapshot,deactivate:async()=>snapshot,dispose(){}};
}`;
    // Optional mutation verifies this test catches the original feature-key bug.
    if (id.split('?')[0] === workspaceFile && process.env.KODETY_TEST_LEGACY_AGENT_FLAG === '1') return source.replace('product.features.ai === true', 'product.features.agents === true');
    if (id.split('?')[0] !== bindingFile) return;
    return `
import { createBrowserAgentSkills } from ${JSON.stringify(path.join(root, 'lib/html-editor/browser-agent-skills.mjs'))};
const catalog=createBrowserAgentSkills(${JSON.stringify(skills)});
export function createBrowserAgentBinding(options) {
  const fixture=window.agentHostFixture;
  fixture.bindings++;
  let account=null;
  let enabledSkills=['kodety-editor'];
  let defaultModel='gpt-5.6-sol';
  const config=()=>({transport:'webcontainer',transportOptions:{selected:'webcontainer',canChange:false},
    available:options.isLicensed(),enabled:options.isLicensed(),licenseRequired:!options.isLicensed(),
    credentialStorage:'browser',defaultModel,defaultEffort:'medium',enabledSkills,
    capabilities:{browserAgent:true,skills:true,figma:false,attachments:false},canManageSkills:true});
  return {key:'webcontainer:'+options.projectId,refreshAccess:async()=>{},dispose(){},createBackend(callbacks){
    fixture.clients++;
    return {remote:false,cancelAll(){fixture.cancellations++;},uploadAttachment:async()=>{throw new Error('Unused upload');},async request(suffix,request={}){
      request.signal?.throwIfAborted();
      fixture.calls.push({suffix,body:request.body,licensed:options.isLicensed()});
      if(suffix==='config'||suffix==='config/retry'){
        if(fixture.runtimeFailure)throw Object.assign(new Error('Não foi possível iniciar o Agent neste navegador.'),{code:'agent_browser_start_failed'});
        if(request.body?.enabledSkills)enabledSkills=request.body.enabledSkills;
        if(request.body?.model)defaultModel=request.body.model;
        const value=config();callbacks.onConfig?.(value);return value;
      }
      if(!options.isLicensed())throw Object.assign(new Error('The actual HTML host rejected the product policy'),{code:'kodety_license_agents_required'});
      if(suffix==='ready')return {state:'ready',ready:true,...config()};
      if(suffix==='events')return {events:[],pending:[],nextCursor:0};
      const method=request.body?.method;
      if(method==='account/read')return {account};
      if(method==='account/login/start'){fixture.loginStarts++;fixture.finishLogin=()=>{account={type:'chatgpt',email:'html-host@example.test',planType:'pro'};};return {type:'chatgptDeviceCode',loginId:'host-login',userCode:'HOST-1234',verificationUrl:'https://auth.openai.com/codex/device'};}
      if(method==='account/login/cancel')return {status:'canceled'};
      if(method==='account/logout'){account=null;return {};}
      if(method==='skills/list')return {data:[{skills:catalog.list(),errors:[]}]};
      if(method==='model/list')return ${JSON.stringify(modelResponse)};
      if(method==='thread/list')return {data:[]};
      if(method==='account/rateLimits/read')return fixture.usageUnavailable ? {rateLimits:{primary:{usedPercent:null},secondary:null}} : ${JSON.stringify(usageResponse)};
      throw new Error('Unexpected host request '+suffix+':'+method);
    }};
  }};
}`;
  },
};
let server, browser, page;
try {
  server = await createServer({ configFile: path.join(root, 'WebApp/kodety-studio/vite.config.ts'), plugins: [fixturePlugin], logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const errors = [], legacy = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/agents\/(?:config|rpc|ready)|agent\.kodety\.com/.test(request.url())) legacy.push(request.url()); });
  await page.addInitScript(() => { window.agentHostFixture = { calls: [], bindings: 0, clients: 0, cancellations: 0, loginStarts: 0, runtimeFailure: false }; });
  await page.goto(base);
  console.log('Studio loaded; seeding OPFS project.');
  await page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('html-agent-host-fixture', { create: true });
    const writer = await (await directory.getFileHandle('index.html', { create: true })).createWritable();
    await writer.write('<!doctype html><html><head><title>Agent host fixture</title></head><body><h1>Agent host fixture</h1></body></html>'); await writer.close();
    await new Promise((resolve,reject) => {
      const request=indexedDB.open('kodety-studio-html-directories-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('directories');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result;const tx=db.transaction('directories','readwrite');tx.objectStore('directories').put(directory,'html-agent-host-fixture');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
    });
    const now=Date.now();
    localStorage.setItem('kodetyStudioProjectsV1',JSON.stringify([{id:'html-agent-host-fixture',name:'HTML Agent Host Fixture',mode:'html',createdAt:now,updatedAt:now,initialized:true,lastOpenedAt:now,directoryName:directory.name,wordpressLocale:'pt_BR'}]));
    localStorage.setItem('kodetyStudioPreferencesV1',JSON.stringify({language:'pt',onboardingVersion:2}));
    localStorage.setItem('kodetyStudioWebOnboarding','2');
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('button').length > 2);
  if (await page.getByRole('radio', { name: /^HTML/ }).count()) await page.getByRole('radio', { name: /^HTML/ }).check();
  if (await page.getByRole('button', { name: 'Abrir biblioteca', exact: true }).count()) await page.getByRole('button', { name: 'Abrir biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir HTML Agent Host Fixture', exact: true }).click();
  console.log('Opening actual HTML workspace.');
  await page.locator('.web-html-builder iframe').first().waitFor({ state: 'attached' });
  const policy = await page.evaluate(() => window.agentHostFixture.product);
  assert.equal(policy.features.ai, true);
  assert.equal(Object.hasOwn(policy.features, 'agents'), false, 'the fixture must use the real product policy, not invent an agents capability');
  await page.locator('[data-kodety-onboarding="design-settings"]').click();
  await page.locator('[data-kodety-project-settings]').waitFor();
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  console.log('Shared Agent settings opened.');
  await expect.poll(() => page.evaluate(() => window.agentHostFixture.calls.find(call => call.suffix === 'config')?.licensed), { message: 'HtmlWorkspace must authorize the existing ai feature from the real licensed product policy' }).toBe(true);
  await expect(page.getByRole('button', { name: 'Conectar conta', exact: true })).toBeVisible();
  await expect(page.getByText(`${skills.length} skills`, { exact: true })).toBeVisible();
  await expect(page.getByText('Onun Kodety Performance', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Onun Kodety', exact: true })).toBeChecked();
  await page.getByRole('switch', { name: 'Onun Kodety Performance', exact: true }).check();
  await expect.poll(() => page.evaluate(() => window.agentHostFixture.calls.some(call => call.body?.enabledSkills?.includes('kodety-performance')))).toBe(true);
  await page.screenshot({ path: '/tmp/kodety-html-agent-host-settings.png', fullPage: true });
  assert.equal(await page.getByText('O Agent local não roda dentro do navegador', { exact: false }).count(), 0);
  assert.equal(await page.getByText('No servidor', { exact: true }).count(), 0);
  assert.ok((await page.evaluate(() => window.agentHostFixture.calls)).every(call => call.licensed), 'the actual HtmlWorkspace must authorize the ai policy feature');
  await page.evaluate(() => { window.agentHostFixture.runtimeFailure = true; });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar conta OpenAI', exact: true })).toBeVisible();
  await expect(page.getByText(/O Agent local não roda dentro do navegador|Instalar Node|Kodety Cloud/)).toHaveCount(0);
  await page.evaluate(() => { window.agentHostFixture.runtimeFailure = false; });
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Conectar conta', exact: true })).toBeVisible();
  await expect(page.getByText(`${skills.length} skills`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conectar conta', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Copie seu código de acesso', exact: true })).toHaveValue('HOST-1234');
  await page.evaluate(() => window.agentHostFixture.finishLogin());
  await page.locator('[data-kodety-project-settings]').waitFor({ state: 'detached' });
  await page.locator('[data-kodety-onboarding="design-settings"]').click();
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  await expect(page.getByText('html-host@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText(`${skills.length} skills`, { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Onun Kodety Performance', exact: true })).toBeChecked();
  assert.equal(await page.evaluate(() => window.agentHostFixture.loginStarts), 1);
  await page.locator('[data-kodety-onboarding="settings-navigation"]').locator('button, a').first().click();
  await page.locator('[data-kodety-project-settings]').waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: 'Selecionar modelo', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Sol', exact: true })).toHaveAttribute('aria-checked', 'true');
  assert.deepEqual(await page.getByRole('menuitemradio').evaluateAll(items => items.filter(item => !item.getAttribute('aria-label')?.startsWith('Esforço ')).map(item => item.innerText.trim())), ['Astra', 'Sol', 'Terra', 'Luna', 'GPT-5.5']);
  await expect(page.getByText('58%', { exact: true })).toBeVisible();
  await expect(page.getByText('95%', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/kodety-agent-astra-usage.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('menuitemradio', { name: 'Astra', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Selecionar modelo', exact: true })).toHaveText('Astra');
  await expect.poll(() => page.evaluate(() => window.agentHostFixture.calls.filter(call => call.suffix === 'config' && call.body?.model).at(-1)?.body.model)).toBe('gpt-6-astra');
  await page.evaluate(() => { window.agentHostFixture.usageUnavailable = true; });
  await page.getByRole('button', { name: 'Selecionar modelo', exact: true }).click();
  await expect(page.getByText('Limites não informados pela conta.', { exact: true })).toBeVisible();
  await expect(page.getByText('100%', { exact: true })).toHaveCount(0);
  assert.deepEqual(legacy, [], 'HTML must never request the legacy WordPress/Cloud Agent transport');
  assert.deepEqual(errors, []);
  console.log(`Full HTML workspace Agent: real ai policy, browser host, ${skills.length} skills, device login, Settings reopen, ordered five-model menu, Sol default, Astra selection, remaining quota and unavailable balances passed.`);
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => ''));
  await page?.screenshot({ path: '/tmp/kodety-html-agent-host-regression.png', fullPage: true }).catch(() => undefined);
  console.error(error);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
