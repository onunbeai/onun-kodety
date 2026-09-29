import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import { createKodetyStudioServer } from '../public/server.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'kodety-html-http-'));
await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Editor fixture</title>');
await writeFile(path.join(root, 'project-storage.html'), '<!doctype html><title>Deletion fixture</title>');
await writeFile(path.join(root, 'font.ttf'), new Uint8Array([0, 1, 0, 0]));
const server = createKodetyStudioServer({ root });
after(async () => { server.emit('close'); await rm(root, { recursive: true, force: true }); });

// Exercise the real server handler and streamed body without opening a port;
// restricted runners can still verify the production response policy.
function request(url = '/') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let status = 200;
    let headers = {};
    const response = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    response.writeHead = (code, values) => { status = code; headers = values; return response; };
    response.on('error', reject);
    response.on('finish', () => resolve(new Response(Buffer.concat(chunks), { status, headers })));
    server.emit('request', { url, method: 'GET', headers: { host: 'localhost' }, socket: {} }, response);
  });
}

test('production HTML response permits the actual sandboxed editor runtime and local project media', async () => {
  const response = await request();
  assert.equal(response.status, 200);
  const policy = response.headers.get('Content-Security-Policy');
  assert.ok(policy);
  const directives = new Map(policy.split(';').map(value => value.trim().split(/\s+/)).map(([name, ...values]) => [name, new Set(values)]));
  for (const [name, values] of Object.entries({ 'script-src': ["'unsafe-inline'", "'wasm-unsafe-eval'", 'blob:'], 'worker-src': ["'self'", 'blob:'], 'font-src': ["'self'", 'blob:'], 'media-src': ["'self'", 'blob:', 'data:', 'https:'], 'connect-src': ['https:', 'blob:', 'data:'] })) {
    for (const value of values) assert.ok(directives.get(name)?.has(value), `${name} must support ${value}`);
  }
  assert.deepEqual([...directives.get('object-src')], ["'none'"]);
  assert.deepEqual([...directives.get('frame-ancestors')], ["'self'"]);
  const nginx = await readFile(new URL('../public/nginx.conf', import.meta.url), 'utf8');
  assert.ok(nginx.includes(`Content-Security-Policy "${policy}"`), 'Node and nginx production behavior must agree');
});

test('bundled renderer fonts have the correct MIME for offline browser loading', async () => {
  const response = await request('/font.ttf');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'font/ttf');
  assert.equal((await response.arrayBuffer()).byteLength, 4);
});

test('Studio keeps WebContainer isolation and gives persistent deletion its own compatible document', async () => {
  const response = await request();
  assert.equal(response.headers.get('Document-Isolation-Policy'), null);
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'credentialless');
  const deletion = await request('/project-storage.html?project=fixture-project');
  assert.equal(deletion.status, 200);
  assert.equal(deletion.headers.get('Document-Isolation-Policy'), 'isolate-and-credentialless');
  assert.equal(deletion.headers.get('Cross-Origin-Embedder-Policy'), null);
  const canonical = await request('/project-storage?project=fixture-project');
  assert.equal(canonical.status, 200);
  assert.equal(canonical.headers.get('Document-Isolation-Policy'), 'isolate-and-credentialless');
  assert.equal(canonical.headers.get('Cross-Origin-Embedder-Policy'), null);
  for (const file of ['../public/nginx.conf', '../public/_headers', '../vite.config.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /Document-Isolation-Policy/);
    assert.match(source, /isolate-and-credentialless/);
    assert.match(source, /Cross-Origin-Embedder-Policy/);
    assert.match(source, /project-storage\.html/);
  }
});
