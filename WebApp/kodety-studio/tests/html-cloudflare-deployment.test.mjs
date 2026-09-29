import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { blake3 } from '@noble/hashes/blake3.js';
import { createKodetyStudioServer } from '../public/server.mjs';

const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-cloudflare-'));
const require = createRequire(import.meta.url);
const modules = {};
for (const name of ['direct', 'cloudflare']) {
  const outfile = path.join(scratch, `${name}.cjs`);
  await build({ entryPoints: [fileURLToPath(new URL(`../src/html-deployment-${name}.ts`, import.meta.url))], outfile, platform: 'node', format: 'cjs', bundle: true, logLevel: 'silent' });
  modules[name] = require(outfile);
}
after(() => rm(scratch, { recursive: true, force: true }));
const cf = modules.cloudflare, direct = modules.direct;
const accountId = 'a'.repeat(32), id = '01234567-89ab-cdef-0123-456789abcdef';
const config = { accountId, project: { name: 'my-site', productionBranch: 'main' }, branch: 'main' };
const root = `/accounts/${accountId}/pages/projects`;
const apiDeployment = { id, url: 'https://01234567.my-site.pages.dev', latest_stage: { name: 'deploy', status: 'idle' } };
const envelope = (result, extra = {}) => Response.json({ success: true, result, ...extra });
const source = [{ path: 'index.html', content: '<h1>Olá</h1>' }, { path: 'assets/icon.PNG', content: Uint8Array.from([0, 255, 128]) }];
async function fixture(t, fetcher, options = {}) {
  const calls = [];
  const server = createKodetyStudioServer({ cloudflareDeploy: { fetch: async (url, init) => { calls.push({ url, init }); return fetcher(url, init); }, ...options } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(input, headers = {}, method = 'POST') {
    const response = await fetch(`${origin}/__kodety_deploy__/cloudflare/request`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Kodety-Deploy': '1', Authorization: 'Bearer api-secret', ...headers }, ...(method === 'POST' ? { body: typeof input === 'string' ? input : JSON.stringify(input) } : {}) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  const browserFetch = (url, init) => fetch(`${origin}${url}`, { ...init, headers: { ...init.headers, Origin: origin } });
  return { request, calls, browserFetch };
}

test('lists Pages projects with pagination and creates the explicit production branch', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const input = JSON.parse(init.body); calls.push({ url, init, input });
    if (input.method === 'GET') return envelope([{ name: 'my-site', production_branch: 'release/site', access_token: 'ignored' }, { name: 'git-site', production_branch: 'main', source: { type: 'github' } }], { result_info: { page: 2, total_pages: 3 } });
    return envelope({ name: input.body.name, production_branch: input.body.production_branch });
  };
  assert.deepEqual(await cf.listHtmlCloudflareProjects('token', accountId, 2, fetcher), { items: [{ name: 'my-site', productionBranch: 'release/site' }, { name: 'git-site', productionBranch: 'main' }], next: 3 });
  assert.deepEqual(await cf.createHtmlCloudflareProject('token', accountId, 'new-site', 'production', fetcher), { name: 'new-site', productionBranch: 'production' });
  assert.equal(calls[0].input.route, `${root}?page=2&per_page=100`);
  assert.equal(calls.every(call => call.url === '/__kodety_deploy__/cloudflare/request' && call.init.credentials === 'same-origin' && call.init.redirect === 'error' && call.init.cache === 'no-store'), true);
  await assert.rejects(cf.listHtmlCloudflareProjects('token', '../accounts/evil', 1, fetcher), { code: 'cloudflare-config' });
  await assert.rejects(cf.createHtmlCloudflareProject('token', accountId, 'invalid/name', 'main', fetcher), { code: 'cloudflare-config' });
});

test('publishes reviewed exact bytes using Wrangler hashes, JWT assets, reserved multipart files, and one deployment request', async t => {
  const review = await direct.reviewHtmlDirectDeployment([...source, { path: 'copy.PNG', content: source[1].content }, { path: '_headers', content: '/*\n  X-Frame-Options: DENY\n' }, { path: '_redirects', content: '/old /new 301\n' }]);
  const progress = [];
  let checked;
  const f = await fixture(t, async (url, init) => {
    if (url.endsWith('/upload-token')) { assert.equal(init.headers.Authorization, 'Bearer api-secret'); return envelope({ jwt: 'upload-jwt', refresh_token: 'never-return' }); }
    if (url.endsWith('/check-missing')) { checked = JSON.parse(init.body).hashes; assert.equal(init.headers.Authorization, 'Bearer upload-jwt'); return envelope(checked); }
    if (url.endsWith('/upload')) {
      assert.equal(init.headers.Authorization, 'Bearer upload-jwt');
      const [asset] = JSON.parse(init.body);
      const file = review.files.find(file => file.base64 === asset.value);
      assert.ok(file);
      const ext = path.extname(file.path).slice(1);
      assert.equal(asset.key, Buffer.from(blake3(Buffer.from(file.base64 + ext))).toString('hex').slice(0, 32));
      assert.equal(asset.metadata.contentType, file.path.endsWith('PNG') ? 'image/png' : 'text/html');
      assert.equal(asset.base64, true);
      return envelope(null);
    }
    if (url.endsWith('/upsert-hashes')) { assert.deepEqual(JSON.parse(init.body).hashes, checked); return envelope(null); }
    assert.equal(url, `https://api.cloudflare.com/client/v4${root}/my-site/deployments`);
    assert.equal(init.headers.Authorization, 'Bearer api-secret');
    assert.equal(init.headers['Content-Type'], undefined);
    assert.ok(init.body instanceof FormData);
    const manifest = JSON.parse(init.body.get('manifest'));
    assert.deepEqual(Object.keys(manifest).sort(), ['/assets/icon.PNG', '/copy.PNG', '/index.html']);
    assert.equal(manifest['/assets/icon.PNG'], manifest['/copy.PNG']);
    assert.equal(init.body.get('branch'), 'main');
    assert.equal(await init.body.get('_headers').text(), '/*\n  X-Frame-Options: DENY\n');
    assert.equal(await init.body.get('_redirects').text(), '/old /new 301\n');
    return envelope({ ...apiDeployment, env_vars: { SECRET: 'never-return' } });
  });
  const result = await cf.publishHtmlCloudflareDeployment(review, config, 'api-secret', f.browserFetch, (done, total) => progress.push([done, total]));
  assert.deepEqual(result, { id, url: apiDeployment.url, state: 'QUEUED' });
  assert.equal(f.calls.filter(call => call.url.endsWith('/upload')).length, 2, 'identical files share a single upload');
  assert.equal(f.calls.filter(call => call.url.endsWith('/deployments')).length, 1);
  assert.deepEqual(progress.at(-1), [5, 5]);
  assert.equal(f.calls.every(call => call.init.redirect === 'error' && call.init.credentials === 'omit' && call.init.cache === 'no-store' && call.init.signal), true);
});

test('cached assets skip upload and status requires final deploy success', async () => {
  const review = await direct.reviewHtmlDirectDeployment(source), routes = [];
  const fetcher = async (_url, init) => {
    const input = JSON.parse(init.body); routes.push(input.route);
    if (input.route.endsWith('/upload-token')) return envelope({ jwt: 'jwt' });
    if (input.route.endsWith('/check-missing')) return envelope([]);
    if (input.route.endsWith('/upsert-hashes')) return envelope(null);
    return envelope({ ...apiDeployment, latest_stage: { name: 'build', status: 'success' } });
  };
  assert.equal((await cf.publishHtmlCloudflareDeployment(review, config, 'token', fetcher)).state, 'BUILDING');
  assert.equal(routes.some(route => route.endsWith('/upload')), false);
  for (const [status, state] of [['success', 'READY'], ['failure', 'ERROR'], ['canceled', 'CANCELED'], ['active', 'BUILDING']]) {
    assert.equal((await cf.getHtmlCloudflareDeployment(id, config, 'token', async () => envelope({ ...apiDeployment, latest_stage: { name: 'deploy', status } }))).state, state);
  }
  await assert.rejects(cf.getHtmlCloudflareDeployment(id, config, 'token', async () => envelope({ ...apiDeployment, url: 'https://my-site.pages.dev@evil.example' })), { code: 'cloudflare-request' });
});

test('functions, Worker bundles, inconsistent snapshots and oversized files fail before requests', async () => {
  for (const pathname of ['functions/api.js', '_worker.js', '_worker.js/index.js', '_worker.bundle', '_routes.json']) {
    const review = await direct.reviewHtmlDirectDeployment([...source, { path: pathname, content: 'secret code' }]);
    await assert.rejects(cf.publishHtmlCloudflareDeployment(review, config, 'token', async () => { throw Error('must not fetch'); }), { code: 'cloudflare-functions' });
  }
  const review = await direct.reviewHtmlDirectDeployment(source);
  assert.throws(() => cf.validateHtmlCloudflareReview({ ...review, bytes: review.bytes + 1 }), { code: 'cloudflare-config' });
  assert.throws(() => cf.validateHtmlCloudflareReview({ ...review, files: [{ ...review.files[0], size: 26 * 1024 * 1024 }] }), { code: 'cloudflare-config' });
  for (const path of ['_headers', '_redirects']) {
    const oversizedConfig = await direct.reviewHtmlDirectDeployment([...source, { path, content: 'x'.repeat(1024 * 1024 + 1) }]);
    await assert.rejects(cf.publishHtmlCloudflareDeployment(oversizedConfig, config, 'token', async () => { throw Error('must not fetch'); }), { code: 'cloudflare-config-size' });
  }
});

test('client failure paths sanitize errors, identify static hosts and never retry uncertain deployment creation', async () => {
  await assert.rejects(cf.listHtmlCloudflareProjects('token', accountId, 1, async () => new Response('<html>app</html>')), { code: 'cloudflare-unavailable' });
  await assert.rejects(cf.listHtmlCloudflareProjects('token', accountId, 1, async () => { throw Error('secret token'); }), error => error.code === 'cloudflare-network' && !error.message.includes('secret'));
  const review = await direct.reviewHtmlDirectDeployment(source); let creations = 0;
  await assert.rejects(cf.publishHtmlCloudflareDeployment(review, config, 'token', async (_url, init) => {
    const input = JSON.parse(init.body);
    if (input.route.endsWith('/upload-token')) return envelope({ jwt: 'jwt' });
    if (input.route.endsWith('/check-missing')) return envelope([]);
    if (input.route.endsWith('/upsert-hashes')) return envelope(null);
    creations++; throw Error('provider secret');
  }), error => error.code === 'cloudflare-uncertain' && !error.message.includes('secret'));
  assert.equal(creations, 1);
});

test('proxy rejects cross-origin, preflight, unauthenticated and simple requests without CORS or upstream traffic', async t => {
  const f = await fixture(t, () => { throw Error('must not fetch'); });
  const input = { route: `${root}?page=1&per_page=100`, method: 'GET' };
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '' }, { 'X-Kodety-Deploy': '' }, { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const result = await f.request(input, headers);
    assert.equal(result.status, 403); assert.equal(result.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await f.request(input, {}, 'OPTIONS')).status, 405);
  assert.equal((await f.request(input, { Authorization: '' })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('proxy allowlist forbids arbitrary hosts, traversal, query injection, destructive methods and unsafe manifests', async t => {
  const f = await fixture(t, () => { throw Error('must not fetch'); });
  const invalid = [
    { route: 'https://evil.example', method: 'GET' }, { route: '//evil.example', method: 'GET' },
    { route: `${root}/my-site/../../tokens`, method: 'GET' }, { route: `${root}?page=1&per_page=100&url=https://evil.example`, method: 'GET' },
    { route: `${root}/my-site`, method: 'DELETE' }, { route: '/user/tokens', method: 'GET' },
    { route: `${root}`, method: 'POST', body: { name: 'safe', production_branch: 'main', source: {} } },
    { route: `${root}/my-site/deployments`, method: 'POST', body: { branch: 'main', manifest: { '/index.html': 'a'.repeat(32), '/.env': 'b'.repeat(32) } } },
    { route: '/pages/assets/upload', method: 'POST', body: [{ key: 'a'.repeat(32), value: '!!!!', base64: true, metadata: { contentType: 'text/html' } }] },
  ];
  for (const input of invalid) assert.equal((await f.request(input)).status, 400);
  assert.equal(f.calls.length, 0);
});

test('proxy strips secrets from success and failure responses and blocks redirects', async t => {
  const input = { route: `${root}?page=1&per_page=100`, method: 'GET' };
  let reply = envelope([{ name: 'my-site', production_branch: 'main', env_vars: { password: 'provider-secret' }, access_token: 'api-secret' }]);
  const f = await fixture(t, () => reply);
  const result = await f.request(input);
  assert.deepEqual(result.data.result, [{ name: 'my-site', production_branch: 'main' }]);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(result.data).includes('secret'), false);
  reply = Response.json({ success: false, errors: [{ message: 'provider-secret api-secret' }] }, { status: 403 });
  const failed = await f.request(input);
  assert.equal(failed.status, 403); assert.deepEqual(failed.data, { success: false, code: 'cloudflare-permission' });
  reply = new Response(null, { status: 302, headers: { Location: 'https://evil.example/?api-secret' } });
  const redirected = await f.request(input);
  assert.equal(redirected.status, 502); assert.equal(JSON.stringify(redirected.data).includes('secret'), false);
  assert.equal(f.calls.at(-1).init.redirect, 'error');
});

test('proxy bounds request/response bytes and malformed payloads before forwarding', async t => {
  const f = await fixture(t, () => envelope({ huge: 'x'.repeat(500) }), { maxBodyBytes: 256, maxResponseBytes: 256 });
  assert.equal((await f.request('x'.repeat(300))).status, 413);
  assert.equal((await f.request('{broken')).status, 400);
  assert.equal(f.calls.length, 0);
  const result = await f.request({ route: `${root}?page=1&per_page=100`, method: 'GET' });
  assert.equal(result.status, 502); assert.equal(result.data.code, 'cloudflare-request');
});

test('full provider upload failure never reaches creation; uncertain create is sanitized and sent once', async t => {
  let creations = 0, uploadFailure = true;
  const f = await fixture(t, async url => {
    if (url.endsWith('/upload-token')) return envelope({ jwt: 'jwt' });
    if (url.endsWith('/check-missing')) return envelope(uploadFailure ? ['0'.repeat(32)] : []);
    if (url.endsWith('/upsert-hashes')) return envelope(null);
    if (url.endsWith('/deployments')) { creations++; throw Error('token api-secret'); }
    throw Error('unexpected');
  });
  const review = await direct.reviewHtmlDirectDeployment(source);
  await assert.rejects(cf.publishHtmlCloudflareDeployment(review, config, 'api-secret', f.browserFetch), { code: 'cloudflare-request' });
  assert.equal(creations, 0);
  uploadFailure = false;
  await assert.rejects(cf.publishHtmlCloudflareDeployment(review, config, 'api-secret', f.browserFetch), error => error.code === 'cloudflare-uncertain' && !error.message.includes('api-secret'));
  assert.equal(creations, 1);
});
