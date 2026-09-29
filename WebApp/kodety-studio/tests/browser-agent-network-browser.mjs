// Real Chromium + WebContainer + bundled Pi + production relay. Only the
// upstream OpenAI service is replaced, with disposable credentials and SSE.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildBrowserAgentRuntime } from '../../../scripts/vite-browser-agent.mjs';
import { createKodetyStudioServer } from '../public/server.mjs';

const directory = await mkdtemp(path.join(tmpdir(), 'kodety-agent-network-browser-'));
const root = new URL('../../../', import.meta.url).pathname;
const requests = [];
let inference = 0;
const access = 'fixture.' + Buffer.from(JSON.stringify({ email: 'fixture@example.test', 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_plan_type: 'plus' } })).toString('base64url') + '.signature';
function sse(output) {
  const fn = output.type === 'function_call';
  const response = { id: 'resp_fixture', status: 'completed', output: [output], usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [
    { type: 'response.created', response: { id: response.id, status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...output, ...(fn ? { arguments: '' } : { content: [] }) } },
    ...(fn ? [
      { type: 'response.function_call_arguments.delta', output_index: 0, item_id: output.id, delta: output.arguments },
      { type: 'response.function_call_arguments.done', output_index: 0, item_id: output.id, arguments: output.arguments },
    ] : [
      { type: 'response.content_part.added', output_index: 0, item_id: output.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, item_id: output.id, content_index: 0, delta: output.content[0].text },
      { type: 'response.output_text.done', output_index: 0, item_id: output.id, content_index: 0, text: output.content[0].text },
    ]),
    { type: 'response.output_item.done', output_index: 0, item: output },
    { type: 'response.completed', response },
  ];
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ async start(controller) {
    for (const event of events) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      await new Promise(resolve => setTimeout(resolve, 4));
    }
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const server = createKodetyStudioServer({ root: directory, agentNetwork: { fetch: async (url, init) => {
  const endpoint = String(url);
  requests.push(endpoint);
  if (endpoint.endsWith('/deviceauth/usercode')) return Response.json({ device_auth_id: 'PRIVATE_DEVICE_ID', user_code: 'TEST-1234', interval: 1 });
  if (endpoint.endsWith('/deviceauth/token')) return Response.json({ authorization_code: 'PRIVATE_CODE', code_verifier: 'PRIVATE_VERIFIER' });
  if (endpoint.endsWith('/oauth/token')) return Response.json({ access_token: access, refresh_token: 'PRIVATE_REFRESH', expires_in: 3600 });
  if (endpoint.endsWith('/codex/responses')) {
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${access}`);
    const bytes = Buffer.from(init.body);
    const body = JSON.parse(new Headers(init.headers).get('content-encoding') === 'zstd' ? zstdDecompressSync(bytes).toString() : bytes.toString());
    assert.match(body.instructions, /kodety-editor/);
    inference++;
    if (inference % 2 === 1) return sse({ type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'kodety_editor_context', arguments: '{}', status: 'completed' });
    assert.ok(body.input.some(item => item.type === 'function_call_output' && item.output.includes('selection-confirmed')));
    return sse({ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Seleção confirmada.', annotations: [] }] });
  }
  throw new Error('Unexpected upstream operation');
} } });
let browser;
try {
  const runtimeArtifact = process.env.KODETY_AGENT_RUNTIME_ARTIFACT
    ? await readFile(process.env.KODETY_AGENT_RUNTIME_ARTIFACT, 'utf8') : await buildBrowserAgentRuntime();
  await writeFile(path.join(directory, 'runtime.mjs'), runtimeArtifact);
  const script = await build({ stdin: { resolveDir: root, contents: `
import { createBrowserAgentBinding } from './lib/html-editor/browser-agent-webcontainer';
const binding = createBrowserAgentBinding({projectId:'network-fixture',credentialScope:'network-fixture',runtimeUrl:'/runtime.mjs',isLicensed:()=>true});
const panel = binding.createBackend({});
let settings = binding.createBackend({});
const rpc = (method,params={}) => panel.request('rpc',{method:'POST',body:{method,params}});
async function until(read,check) { for(let n=0;n<300;n++){const value=await read();if(check(value))return value;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Expected agent transition did not arrive.'); }
window.agent = {
  config:()=>panel.request('config'),
  skills:()=>rpc('skills/list'),
  account:()=>rpc('account/read'),
  async login(){await settings.request('rpc',{method:'POST',body:{method:'account/login/start',params:{}}});return until(()=>rpc('account/read'),value=>value.account);},
  async reopenSettings(){settings.cancelAll();settings=binding.createBackend({});return settings.request('rpc',{method:'POST',body:{method:'account/read',params:{}}});},
  async turn(){
    const {thread}=await rpc('thread/start');
    await rpc('turn/start',{threadId:thread.id,prompt:'Confira a seleção.',skills:['kodety-editor']});
    const events=await until(()=>panel.request('events',{body:{threadId:thread.id,cursor:0}}),value=>value.pending.length);
    const call=events.pending[0];
    if(call.params.tool!=='kodety_editor_context')throw new Error('Wrong tool');
    await panel.request('respond',{body:{requestId:call.requestId,result:{success:true,contentItems:[{type:'inputText',text:'selection-confirmed'}]}}});
    const finished=await until(()=>rpc('thread/read',{threadId:thread.id}),value=>value.thread.turns.at(-1).status!=='inProgress');
    return finished.thread.turns.at(-1);
  },
  logout:()=>rpc('account/logout'),
  dispose:()=>{settings.cancelAll();panel.cancelAll();binding.dispose();},
};
` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  await writeFile(path.join(directory, 'proof.js'), script.outputFiles[0].text);
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Agent network regression</title><script type="module" src="/proof.js"></script>');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const directOpenAI = [];
  const errors = [];
  page.on('request', request => { if (/^https:\/\/(?:auth\.openai\.com|chatgpt\.com)\//.test(request.url())) directOpenAI.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const start = async () => {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.agent));
    return page.evaluate(() => window.agent.config());
  };
  const config = await start();
  assert.equal(config.capabilities.skills, true);
  const skills = await page.evaluate(() => window.agent.skills());
  assert.ok(skills.data[0].skills.some(skill => skill.name === 'kodety-editor'));
  assert.equal((await page.evaluate(() => window.agent.login())).account.email, 'fixture@example.test');
  assert.equal((await page.evaluate(() => window.agent.reopenSettings())).account.email, 'fixture@example.test');
  const first = await page.evaluate(() => window.agent.turn());
  assert.equal(first.status, 'completed', JSON.stringify(first));
  assert.ok(first.items.some(item => item.text === 'Seleção confirmada.'));
  await page.evaluate(() => window.agent.dispose());
  await start();
  assert.equal((await page.evaluate(() => window.agent.account())).account.email, 'fixture@example.test');
  assert.equal((await page.evaluate(() => window.agent.turn())).status, 'completed');
  await page.evaluate(() => window.agent.logout());
  await page.evaluate(() => window.agent.dispose());
  await start();
  assert.equal((await page.evaluate(() => window.agent.account())).account, null);
  await page.evaluate(() => window.agent.dispose());
  assert.equal(inference, 4);
  assert.equal(requests.filter(url => url.endsWith('/deviceauth/usercode')).length, 1);
  assert.deepEqual(directOpenAI, []);
  assert.deepEqual(errors, []);
  const proof = { checkedAt: new Date().toISOString(), runtimeSha256: createHash('sha256').update(runtimeArtifact).digest('hex'), browser: browser.version(), skills: skills.data[0].skills.length, inference, loginPersisted: true, logoutPersisted: true, directOpenAIRequests: 0, upstream: 'controlled fixture through production relay' };
  if (process.env.KODETY_AGENT_PROOF_OUTPUT) await writeFile(process.env.KODETY_AGENT_PROOF_OUTPUT, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
