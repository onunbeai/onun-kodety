import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import { signR2Request, validateR2Config, R2_PREFIX } from '../src/r2-storage-runtime.mjs';

const config = { accountId: 'a'.repeat(32), accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64), bucket: 'my-projects' };
const emptyHash = createHash('sha256').update('').digest('hex');
const now = new Date('2026-09-19T12:34:56Z');
const source = await readFile(new URL('../src/r2-storage.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(fetcher) {
  const module = {};
  const signing = [];
  new Function('exports', 'require', 'fetch', compiled)(module, name => {
    assert.equal(name, './r2-storage-signer');
    return { disposeR2Signer() {}, async signR2InWebContainer(request) { signing.push(request); return signR2Request(request, now); } };
  }, fetcher || (() => { throw new Error('Unexpected fetch'); }));
  return { ...module, signing };
}

test('S3 SigV4 matches the independent AWS SDK v3 fixture for encoded Unicode path and conditional PUT', () => {
  // Cross-checked with @smithy/signature-v4 + @aws-crypto/sha256-js using
  // uriEscapePath:false, service:s3, region:auto and this fixed signingDate.
  const body = Buffer.from('signed project snapshot');
  const result = signR2Request({ config, method: 'PUT', key: `${R2_PREFIX}proj A/ação+%.zip`, contentType: 'application/zip',
    headers: { 'if-none-match': '*' }, payloadHash: createHash('sha256').update(body).digest('hex') }, now);
  assert.equal(result.url, `https://${config.accountId}.r2.cloudflarestorage.com/my-projects/kodety-studio/v1/proj%20A/a%C3%A7%C3%A3o%2B%25.zip`);
  assert.equal(result.headers.authorization, `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/20260919/auto/s3/aws4_request, SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date, Signature=b0ab2f74604a8ba7389f0edaa0d090214ab7cdc1a0ea8a614526dc4581add187`);
  assert.equal(result.headers.host, undefined);
  assert.equal(JSON.stringify(result).includes(config.secretAccessKey), false);
});

test('signer permits only fixed R2 hosts and project namespace, never bucket enumeration or alternate headers', () => {
  assert.deepEqual(validateR2Config(config), config);
  for (const change of [{ accountId: 'evil.test/' }, { accessKeyId: 'api-token' }, { secretAccessKey: '\nsecret' }, { bucket: '../../other' }]) {
    assert.throws(() => validateR2Config({ ...config, ...change }), /r2-invalid-config/);
  }
  const input = { config, method: 'GET', key: `${R2_PREFIX}project/manifest.json`, payloadHash: emptyHash };
  for (const key of ['private.txt', `${R2_PREFIX}../private.txt`, `${R2_PREFIX}a\\b`, `${R2_PREFIX}a\u0000b`]) {
    assert.throws(() => signR2Request({ ...input, key }, now));
  }
  assert.throws(() => signR2Request({ ...input, key: undefined, query: {} }, now));
  assert.throws(() => signR2Request({ ...input, headers: { authorization: 'override' } }, now));
  assert.throws(() => signR2Request({ ...input, headers: { 'if-match': 'etag\r\nInjected:yes' } }, now));
  const list = signR2Request({ ...input, key: undefined, query: { 'list-type': '2', prefix: R2_PREFIX, 'continuation-token': 'a+b/==' } }, now);
  assert.equal(new URL(list.url).pathname, '/my-projects');
  assert.ok(list.url.includes('continuation-token=a%2Bb%2F%3D%3D'));
});


test('transfers send signed binary bodies directly to R2 with no cookies, redirects or Kodety proxy', async () => {
  const bytes = new Uint8Array([0, 255, 17, 32]);
  const requests = [];
  const api = fixture(async (url, options) => {
    requests.push({ url, options });
    return new Response(new Uint8Array([21, 22]), { headers: { etag: '"cloud-etag"' } });
  });
  const result = await api.r2Request(config, { method: 'PUT', key: `${R2_PREFIX}example/data.zip`, body: bytes, contentType: 'application/zip', headers: { 'if-match': '"old-etag"' } });
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(url.origin, `https://${config.accountId}.r2.cloudflarestorage.com`);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.mode, 'cors');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.deepEqual(options.body, bytes);
  assert.notEqual(options.body, bytes);
  assert.equal(options.headers['x-amz-content-sha256'], createHash('sha256').update(bytes).digest('hex'));
  assert.equal(options.headers['if-match'], '"old-etag"');
  assert.equal(api.signing[0].config.secretAccessKey, config.secretAccessKey);
  assert.equal(JSON.stringify(options.headers).includes(config.secretAccessKey), false);
  assert.deepEqual(result, { body: new Uint8Array([21, 22]), etag: '"cloud-etag"', status: 200 });
});

test('HTTP errors are sanitized and preserve status for missing manifests and concurrency conflicts', async () => {
  for (const [status, code] of [[401, 'r2-auth'], [403, 'r2-auth'], [404, 'r2-not-found'], [412, 'r2-conflict'], [500, 'r2-request']]) {
    const api = fixture(async () => new Response(`DO NOT LEAK ${config.secretAccessKey}`, { status }));
    await assert.rejects(api.r2Request(config, { method: 'GET', key: `${R2_PREFIX}manifest.json` }), error => {
      assert.equal(error.code, code); assert.equal(error.status, status);
      assert.equal(error.message.includes(config.secretAccessKey), false); return true;
    });
  }
  const api = fixture(async () => { throw new Error(`URL/secret: ${config.secretAccessKey}`); });
  await assert.rejects(api.r2Request(config, { method: 'GET', key: `${R2_PREFIX}manifest.json` }), { code: 'r2-network' });
});

test('invalid headers, namespace escapes and oversized requests are rejected before signing or network', async () => {
  const api = fixture();
  for (const request of [
    { method: 'GET', key: 'outside-prefix' },
    { method: 'GET', key: `${R2_PREFIX}../outside` },
    { method: 'GET', key: `${R2_PREFIX}file`, headers: { host: 'other.test' } },
    { method: 'GET', query: { 'list-type': '2', prefix: R2_PREFIX, delimiter: 'unexpected' } },
    { method: 'GET', key: `${R2_PREFIX}file`, body: new Uint8Array([1]) },
  ]) await assert.rejects(api.r2Request(config, request), { code: 'r2-invalid-config' });
  assert.equal(api.signing.length, 0);
  const cors = api.makeR2CorsPolicy('https://studio.kodety.com');
  assert.deepEqual(cors[0].AllowedOrigins, ['https://studio.kodety.com']);
  assert.deepEqual(cors[0].ExposeHeaders, ['ETag']);
  assert.ok(cors[0].AllowedHeaders.includes('if-match'));
  assert.throws(() => api.makeR2CorsPolicy('https://studio.kodety.com/another-path'));
});
