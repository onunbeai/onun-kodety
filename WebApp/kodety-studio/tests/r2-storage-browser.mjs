import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { signR2Request } from '../src/r2-storage-runtime.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({ entryPoints: [`${root}/WebApp/kodety-studio/src/r2-storage.ts`], bundle: true, write: false,
  format: 'iife', globalName: 'r2Storage', platform: 'browser', logLevel: 'silent',
  plugins: [{ name: 'isolated-signer-fixture', setup(builder) {
    builder.onResolve({ filter: /r2-storage-signer$/ }, () => ({ path: 'signer', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const disposeR2Signer=()=>{}; export const signR2InWebContainer=(request)=>window.signR2ForTest(request);' }));
  } }],
});
const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body>R2 storage fixture</body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const config = { accountId: 'a'.repeat(32), accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64), bucket: 'my-projects' };
  const origin = `http://127.0.0.1:${server.address().port}`;
  const files = new Map();
  const requests = [];
  let rejectWrites = false;
  let holdRequest;
  let releaseRequest;
  await page.exposeFunction('signR2ForTest', request => signR2Request(request));
  await page.route('https://*.r2.cloudflarestorage.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'ETag', etag: '"fixture-etag"' };
    requests.push({ url: url.href, method: request.method(), headers: request.headers() });
    assert.equal(url.origin, `https://${config.accountId}.r2.cloudflarestorage.com`);
    assert.ok(request.headers().authorization.startsWith('AWS4-HMAC-SHA256 '));
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers().referer, undefined);
    const key = decodeURIComponent(url.pathname.replace(`/${config.bucket}/`, ''));
    if (holdRequest && key.endsWith('delayed.json')) { holdRequest(); await new Promise(resolve => { releaseRequest = resolve; }); }
    if (url.searchParams.has('list-type')) {
      assert.ok([`/${config.bucket}`, '/not-authorized'].includes(url.pathname));
      assert.ok(url.searchParams.get('prefix').startsWith('kodety-studio/v1/'));
      await route.fulfill({ headers: { ...headers, 'content-type': 'application/xml' }, body: '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated></ListBucketResult>' });
    } else if (request.method() === 'PUT') {
      if (rejectWrites) return route.fulfill({ status: 403, headers, body: 'raw PRIVATE error' });
      files.set(key, request.postDataBuffer());
      await route.fulfill({ headers, body: '' });
    } else if (request.method() === 'GET') {
      await route.fulfill({ status: files.has(key) ? 200 : 404, headers, body: files.get(key) || '' });
    } else if (request.method() === 'DELETE') {
      files.delete(key); await route.fulfill({ status: 204, headers });
    } else throw new Error(`Unexpected method ${request.method()}`);
  });
  const boot = async () => { await page.goto(origin); await page.addScriptTag({ content: bundle.outputFiles[0].text }); };
  const diskRecord = () => page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const opening = indexedDB.open('kodety-studio-r2-credentials-v1', 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction('connection'), request = tx.objectStore('connection').get('active');
        tx.oncomplete = () => { db.close(); resolve(request.result || null); };
      };
    });
  });
  await boot();
  await page.evaluate(() => localStorage.setItem('existing-local-project', 'unchanged'));
  await page.evaluate(config => window.r2Storage.connectR2(config, { remember: false }), config);
  assert.equal(files.size, 0, 'Connection probe must delete its random temporary object');
  assert.deepEqual(requests.map(request => request.method), ['GET', 'PUT', 'GET', 'DELETE']);
  let info = await page.evaluate(() => window.r2Storage.getR2ConnectionInfo());
  assert.equal(info.remembered, false);
  assert.equal(info.bucket, config.bucket);
  assert.equal(JSON.stringify(info).includes(config.secretAccessKey), false);
  assert.equal(await diskRecord(), null, 'Default connection must not persist outside this tab');
  await boot();
  assert.deepEqual(await page.evaluate(() => window.r2Storage.getR2Connection()), { id: `${config.accountId}/${config.bucket}`, config });
  assert.equal((await page.evaluate(() => window.r2Storage.getR2ConnectionInfo())).remembered, false);
  await page.evaluate(() => window.r2Storage.disconnectR2());
  await boot();
  assert.equal(await page.evaluate(() => window.r2Storage.getR2Connection()), null);
  await page.evaluate(config => window.r2Storage.connectR2(config, { remember: true }), config);
  assert.equal((await diskRecord()).config.secretAccessKey, config.secretAccessKey);
  await boot();
  const restored = await page.evaluate(() => window.r2Storage.getR2Connection());
  assert.deepEqual(restored, { id: `${config.accountId}/${config.bucket}`, config });
  assert.equal((await page.evaluate(() => window.r2Storage.getR2ConnectionInfo())).remembered, true);

  rejectWrites = true;
  const rejected = await page.evaluate(async config => {
    try { await window.r2Storage.connectR2({ ...config, bucket: 'not-authorized' }, { remember: true }); }
    catch (error) { return { code: error.code, message: error.message, info: window.r2Storage.getR2ConnectionInfo() }; }
  }, config);
  assert.equal(rejected.code, 'r2-auth');
  assert.equal(rejected.info.bucket, config.bucket, 'Failed connection must not replace the working configuration');
  assert.equal(rejected.message.includes('PRIVATE'), false);
  rejectWrites = false;

  const started = new Promise(resolve => { holdRequest = resolve; });
  const pending = page.evaluate(async config => {
    try { await window.r2Storage.r2Request(config, { method: 'GET', key: 'kodety-studio/v1/delayed.json' }); return 'unexpected success'; }
    catch (error) { return error.code; }
  }, config);
  await started;
  await page.evaluate(() => window.r2Storage.disconnectR2());
  assert.equal(await pending, 'r2-disconnected');
  releaseRequest();
  assert.equal(await diskRecord(), null);
  assert.equal(await page.evaluate(() => window.r2Storage.getR2ConnectionInfo()), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('existing-local-project')), 'unchanged');
  console.log('R2 browser checks passed: scoped probe, direct signed requests, tab session/IndexedDB remember/restore/disconnect, sanitized errors, canceled transfers, untouched local project.');
} finally { await browser.close(); server.close(); }
