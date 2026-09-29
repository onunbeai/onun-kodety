// Chromium exercises the real MessagePort bridge across different origins.
// The guarded message-handler prefix comes from the production Studio entry.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = new URL('../../../', import.meta.url).pathname;
const main = await readFile(new URL('../../../ChromeExtension/kodety-studio/src/main.tsx', import.meta.url), 'utf8');
const provider = await readFile(new URL('../../../Wordpress/editor/WordPressAgentProvider.tsx', import.meta.url), 'utf8');
assert.match(provider, /studio:\s*\{\s*origin:\s*config\.studio\.studioOrigin,\s*projectId:\s*config\.studio\.projectId/);
const guardStart = main.indexOf('const handleRuntimeMessage = (event: MessageEvent) => {');
const dispatch = "if (message.type === 'agent-network') { agentNetwork.receive(event); return; }";
const guardEnd = main.indexOf(dispatch, guardStart) + dispatch.length;
assert.ok(guardStart > 0 && guardEnd > guardStart);
const productionGuard = main.slice(guardStart, guardEnd) + '\n};';
const scripts = new Map();
const requests = [];
let canceled = 0;
const servers = [];
let browser;
const html = content => `<!doctype html><meta charset="utf-8">${content}`;
function serve() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/__kodety_agent__/network') {
      let body = ''; for await (const part of request) body += part;
      const message = JSON.parse(body);
      const scenario = Buffer.from(message.body, 'base64').toString();
      requests.push(scenario);
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Kodety-Agent-Relay': '1', 'Cache-Control': 'no-store' });
      response.write('data: first\n\n');
      if (scenario === 'cancel') {
        const timer = setInterval(() => response.write('data: waiting\n\n'), 20);
        response.on('close', () => { clearInterval(timer); canceled++; });
      } else setTimeout(() => response.end('data: second\n\n'), 20);
      return;
    }
    const asset = scripts.get(url.pathname);
    if (asset) { response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/html'); response.end(asset); return; }
    response.writeHead(404); response.end();
  });
  servers.push(server);
  return server;
}
async function bundle(contents) {
  return (await build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })).outputFiles[0].text;
}
try {
  const studio = serve(), child = serve(), foreign = serve();
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  const origin = server => `http://127.0.0.1:${server.address().port}`;
  const studioOrigin = origin(studio), childOrigin = origin(child), foreignOrigin = origin(foreign);
  scripts.set('/parent.js', await bundle(`
import { createStudioAgentNetworkBridge } from './lib/html-editor/browser-agent-studio-network';
import { isProjectRuntimeMessageSource } from './ChromeExtension/kodety-studio/src/runtime-message';
const agentNetwork=createStudioAgentNetworkBridge();
const iframeRef={current:document.querySelector('#active')};
const project={id:'project-a'};
const PLAYGROUND_REMOTE_ORIGIN=${JSON.stringify(childOrigin)};
${productionGuard}
window.addEventListener('message',handleRuntimeMessage);
window.bridgeReady=true;
window.disposeBridge=()=>agentNetwork.dispose();
`));
  scripts.set('/child.js', await bundle(`
import { createBrowserAgentNetwork } from './lib/html-editor/browser-agent-network';
window.framesReceived=[];
const networks=new Map(); const gates=new Map();
window.start=(id,scenario='stream',projectId='project-a',hold=true)=>{
  const gate=hold?new Promise(resolve=>gates.set(id,resolve)):Promise.resolve();
  const network=createBrowserAgentNetwork({studio:{origin:${JSON.stringify(studioOrigin)},projectId}},async message=>{
    window.framesReceived.push(message);
    if(message.action==='headers')await gate;
  },()=>true);
  networks.set(id,network);
  network.receive({action:'request',requestId:id,request:{operation:'responses',headers:{Authorization:'Bearer fixture'},body:btoa(scenario)}});
};
window.release=id=>{gates.get(id)?.();gates.delete(id);};
window.cancel=id=>networks.get(id)?.receive({action:'cancel',requestId:id});
window.childReady=true;
`));
  scripts.set('/child', html('<script type="module" src="/child.js"></script>'));
  scripts.set('/active', html(`<iframe name="nested" src="${childOrigin}/child"></iframe><iframe name="foreign" src="${foreignOrigin}/child"></iframe><script type="module" src="/child.js"></script>`));
  scripts.set('/', html(`<iframe id="active" name="active" src="${childOrigin}/active"></iframe><iframe name="sibling" src="${childOrigin}/child"></iframe><script type="module" src="/parent.js"></script>`));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(studioOrigin);
  await page.waitForFunction(() => window.bridgeReady === true);
  const frame = name => page.frames().find(item => item.name() === name);
  for (const name of ['active', 'nested', 'foreign', 'sibling']) await frame(name).waitForFunction(() => window.childReady === true);
  const active = frame('active');
  await active.evaluate(() => window.start('stream'));
  await active.waitForFunction(() => window.framesReceived.some(item => item.requestId === 'stream' && item.action === 'headers'));
  await page.waitForTimeout(80);
  assert.deepEqual(await active.evaluate(() => window.framesReceived.filter(item => item.requestId === 'stream').map(item => item.action)), ['headers'], 'chunks must wait for the consumer ACK');
  await active.evaluate(() => window.release('stream'));
  await active.waitForFunction(() => window.framesReceived.some(item => item.requestId === 'stream' && item.action === 'end'));
  const output = await active.evaluate(() => window.framesReceived.filter(item => item.requestId === 'stream' && item.action === 'chunk').map(item => atob(item.chunk)).join(''));
  assert.equal(output, 'data: first\n\ndata: second\n\n');
  await frame('nested').evaluate(() => window.start('nested', 'nested', 'project-a', false));
  await frame('nested').waitForFunction(() => window.framesReceived.some(item => item.requestId === 'nested' && item.action === 'end'));
  const beforeRejected = requests.length;
  await frame('sibling').evaluate(() => window.start('sibling', 'rejected-sibling', 'project-a', false));
  await frame('foreign').evaluate(() => window.start('foreign', 'rejected-origin', 'project-a', false));
  await active.evaluate(() => window.start('wrong-project', 'rejected-project', 'other-project', false));
  await page.waitForTimeout(120);
  assert.equal(requests.length, beforeRejected, 'sibling, foreign-origin descendant and different-project requests must not reach the relay');
  await active.evaluate(() => window.start('cancel', 'cancel'));
  await active.waitForFunction(() => window.framesReceived.some(item => item.requestId === 'cancel' && item.action === 'headers'));
  await active.evaluate(() => { window.cancel('cancel'); window.release('cancel'); });
  for (let n = 0; n < 100 && !canceled; n++) await page.waitForTimeout(10);
  assert.equal(canceled, 1, 'cancel must abort the parent HTTP response');
  await page.evaluate(() => window.disposeBridge());
  assert.deepEqual(errors, []);
  console.log('Chromium Studio bridge: cross-origin iframe + nested frame, streamed ACK, cancel, sibling/origin/project rejection passed.');
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
}
