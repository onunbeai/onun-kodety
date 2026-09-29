// Opt-in network smoke: disposable browser, real WebContainer and bundled Pi.
// Requests a device code then cancels. Never logs codes or signs into an account.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildBrowserAgentRuntime } from '../../../scripts/vite-browser-agent.mjs';
import { createKodetyStudioServer } from '../public/server.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'kodety-browser-agent-smoke-'));
const runtimeArtifact = process.env.KODETY_AGENT_RUNTIME_ARTIFACT
  ? await readFile(process.env.KODETY_AGENT_RUNTIME_ARTIFACT, 'utf8') : await buildBrowserAgentRuntime();
const runtimeSha256 = createHash('sha256').update(runtimeArtifact).digest('hex');
await writeFile(path.join(directory, 'runtime.mjs'), runtimeArtifact);
const script = await build({ stdin: { resolveDir: root, contents: `
import { createBrowserAgentBinding } from './lib/html-editor/browser-agent-webcontainer';
const report = window.report = { stages: [], isolated: crossOriginIsolated, secure: isSecureContext };
const record = (stage, data = {}) => report.stages.push({stage, ...data});
let licensed = true;
const binding = createBrowserAgentBinding({projectId:'disposable-network-proof',runtimeUrl:'/runtime.mjs',isLicensed:()=>licensed});
const panel = binding.createBackend({});
const settings = binding.createBackend({});
window.done = false;
try {
 const config = await panel.request('config'); record('config',{available:config.available,transport:config.transport});
 const models = await settings.request('rpc',{method:'POST',body:{method:'model/list',params:{}}}); record('models',{count:models.data.length});
 const login = await settings.request('rpc',{method:'POST',body:{method:'account/login/start',params:{}}});
 record('device-code',{hasCode:typeof login.userCode==='string' && login.userCode.length>0,officialUrl:login.verificationUrl==='https://auth.openai.com/codex/device'});
 await settings.request('rpc',{method:'POST',body:{method:'account/login/cancel',params:{loginId:login.loginId}}});
 settings.cancelAll();
 const account = await panel.request('rpc',{method:'POST',body:{method:'account/read',params:{}}}); record('cancelled',{accountAbsent:account.account===null,siblingClientAlive:true});
 licensed=false;await binding.refreshAccess();
 const denied=await panel.request('config');record('license',{required:denied.licenseRequired,available:denied.available});
} catch(error) { report.failure={code:error.code || error.name,message:error.message}; }
finally {panel.cancelAll();binding.dispose();window.done=true;}
` }, bundle:true,write:false,platform:'browser',format:'esm',target:'es2022' });
await writeFile(path.join(directory, 'proof.js'), script.outputFiles[0].text);
await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Disposable Agent proof</title><script type="module" src="/proof.js"></script>');
const server = createKodetyStudioServer({ root: directory });
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const cspErrors=[];
  page.on('console',message=>{if(message.type()==='error' && /Content Security Policy|violates.*directive/.test(message.text()))cspErrors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>window.done,null,{timeout:150_000});
  const report=await page.evaluate(()=>window.report);
  const evidence={checkedAt:new Date().toISOString(),browser:browser.version(),runtimeSha256,...report,cspErrors};
  if(process.env.KODETY_AGENT_PROOF_OUTPUT)await writeFile(process.env.KODETY_AGENT_PROOF_OUTPUT,JSON.stringify(evidence,null,2)+'\n');
  assert.equal(report.failure,undefined,JSON.stringify(report));
  assert.equal(report.isolated,true);
  assert.deepEqual(report.stages.map(stage=>stage.stage),['config','models','device-code','cancelled','license']);
  assert.equal(report.stages[0].available,true);
  assert.equal(report.stages[0].transport,'webcontainer');
  assert.ok(report.stages[1].count>0);
  assert.equal(report.stages[2].hasCode,true);
  assert.equal(report.stages[2].officialUrl,true);
  assert.equal(report.stages[3].accountAbsent,true);
  assert.equal(report.stages[4].required,true);
  assert.equal(report.stages[4].available,false);
  assert.deepEqual(cspErrors,[]);
  console.log(JSON.stringify(evidence,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
