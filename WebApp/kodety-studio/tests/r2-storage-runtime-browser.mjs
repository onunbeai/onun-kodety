// Opt-in: downloads the real WebContainer engine but never contacts an R2 bucket.
// Run: node WebApp/kodety-studio/tests/r2-storage-runtime-browser.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { signR2Request } from '../src/r2-storage-runtime.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const server = await createServer({ configFile: `${root}/WebApp/kodety-studio/vite.config.ts`, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const r2Requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (request.url().includes('.r2.cloudflarestorage.com')) r2Requests.push(request.url()); });
  await page.goto(server.resolvedUrls.local[0]);
  const input = { config: { accountId: 'a'.repeat(32), accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64), bucket: 'test-bucket' },
    method: 'PUT', key: 'kodety-studio/v1/test/data.zip', contentType: 'application/zip', headers: { 'if-none-match': '*' },
    payloadHash: '9a608fc2ca8c23c90b5498152d73d6bb5e7ed2975315f1c47ad05f4e045912a4' };
  const result = await page.evaluate(async ({ root, input }) => {
    const { signR2InWebContainer, disposeR2Signer } = await import(`/@fs${root}/WebApp/kodety-studio/src/r2-storage-signer.ts`);
    const { getBrowserWebContainer } = await import(`/@fs${root}/lib/html-editor/browser-agent-webcontainer.ts`);
    const signal = AbortSignal.timeout(150_000);
    const signed = await signR2InWebContainer(input, signal);
    const container = await getBrowserWebContainer();
    if (container !== await getBrowserWebContainer()) throw new Error('Shared runtime instance changed');
    const files = await container.fs.readdir('.');
    const scripts = files.filter(name => name.startsWith('r2-signing-'));
    if (scripts.length !== 1) throw new Error('Expected exactly one R2 signing process source');
    for (const script of scripts) {
      const contents = await container.fs.readFile(script, 'utf8');
      if (contents.includes(input.config.secretAccessKey) || contents.includes(input.config.accessKeyId)) throw new Error('Credentials reached runtime filesystem');
    }
    disposeR2Signer();
    await container.fs.writeFile('still-shared.txt', 'Agent runtime survives R2 disconnect');
    const sharedAfterDispose = await container.fs.readFile('still-shared.txt', 'utf8');
    await container.fs.rm('still-shared.txt');
    return { signed, sharedAfterDispose };
  }, { root, input });
  const date = result.signed.headers['x-amz-date'];
  const timestamp = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
  assert.deepEqual(result.signed, signR2Request(input, timestamp));
  assert.equal(result.sharedAfterDispose, 'Agent runtime survives R2 disconnect');
  assert.deepEqual(r2Requests, [], 'The signing process must not make cloud/proxy requests');
  assert.deepEqual(errors, []);
  console.log('Real WebContainer signing passed: correct SigV4, shared Agent singleton, no credential files, no R2 requests and runtime survives signer disposal.');
} finally { await browser?.close(); await server.close(); }
