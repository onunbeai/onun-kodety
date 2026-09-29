import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await build({ entryPoints: [path.join(root, 'src/html-preview-bridge.ts')], bundle: true, write: false, format: 'iife', globalName: 'Bridge', logLevel: 'silent' });
function environment() {
  const listeners = new Map(); const timers = new Set();
  const window = { location: { origin: 'https://example.com', href: 'https://example.com/studio/' }, opener: null,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const context = { window, URL, crypto, setTimeout(callback) { timers.add(callback); return callback; }, clearTimeout(callback) { timers.delete(callback); } };
  vm.runInNewContext(built.outputFiles[0].text, context);
  return { ...context.Bridge, window, timers, listeners, emit(name, event = {}) { for (const callback of [...listeners.get(name) || []]) callback(event); } };
}
const source = (href = 'https://example.com/studio/?kodety-html-preview=project&kodety-preview-review=1') => ({ location: { href }, closed: false, replies: [], postMessage(value, origin) { this.replies.push({ value, origin }); } });
const message = (action = 'refresh') => ({ source: 'kodety-html-preview', type: 'request', projectId: 'project', action, requestId: crypto.randomUUID() });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('parent accepts only matching same-origin preview windows and waits for refresh completion before ACK', async () => {
  const env = environment(); let finish; let refreshes = 0; let publishes = 0;
  const stop = env.installHtmlPreviewBridge('project', { refresh() { refreshes++; return new Promise(resolve => { finish = resolve; }); }, publish() { publishes++; } });
  for (const invalid of [
    { origin: 'https://evil.test', source: source() },
    { origin: 'https://example.com', source: source('https://evil.test/?kodety-html-preview=project&kodety-preview-review=1') },
    { origin: 'https://example.com', source: source('https://example.com/studio/?kodety-html-preview=other&kodety-preview-review=1') },
    { origin: 'https://example.com', source: source('https://example.com/studio/?kodety-html-preview=project') },
    { origin: 'https://example.com', source: { get location() { throw new Error('cross origin'); } } },
  ]) env.emit('message', { ...invalid, data: message() });
  assert.equal(refreshes, 0);
  const preview = source(); const request = message();
  env.emit('message', { origin: 'https://example.com', source: preview, data: request });
  env.emit('message', { origin: 'https://example.com', source: preview, data: request });
  assert.equal(refreshes, 1);
  assert.equal(preview.replies.length, 0);
  finish(); await tick();
  assert.equal(preview.replies[0].value.ok, true);
  assert.equal(preview.replies[0].origin, 'https://example.com');
  env.emit('message', { origin: 'https://example.com', source: preview, data: message('publish') });
  await tick(); assert.equal(publishes, 1);
  stop(); assert.equal(env.listeners.get('message').size, 0);
});

test('parent cleanup or preview navigation cancels outstanding ACK without an error message', async () => {
  for (const cleanup of [true, false]) {
    const env = environment(); let finish; const preview = source();
    const stop = env.installHtmlPreviewBridge('project', { refresh() { return new Promise(resolve => { finish = resolve; }); }, publish() {} });
    env.emit('message', { origin: 'https://example.com', source: preview, data: message() });
    if (cleanup) stop(); else preview.location.href = 'https://example.com/other';
    finish(); await tick(); assert.equal(preview.replies.length, 0); stop();
  }
});

test('requests require ACK from the opener with matching origin, project, action and unique request ID', async () => {
  const env = environment(); const opener = source(); env.window.opener = opener;
  const response = env.requestHtmlPreviewAction('project', 'publish');
  const request = opener.replies[0].value;
  assert.match(request.requestId, /^[a-f0-9-]{36}$/);
  const data = { source: 'kodety-html-preview-parent', type: 'response', projectId: 'project', action: 'publish', requestId: request.requestId, ok: true };
  for (const event of [
    { origin: 'https://evil.test', source: opener, data },
    { origin: 'https://example.com', source: source(), data },
    { origin: 'https://example.com', source: opener, data: { ...data, projectId: 'other' } },
    { origin: 'https://example.com', source: opener, data: { ...data, requestId: crypto.randomUUID() } },
    { origin: 'https://example.com', source: opener, data: { ...data, action: 'refresh' } },
  ]) env.emit('message', event);
  assert.equal(env.listeners.get('message').size, 1);
  env.emit('message', { origin: 'https://example.com', source: opener, data });
  assert.equal(await response, true);
  assert.equal(env.listeners.get('message').size, 0);
  assert.equal(env.listeners.get('pagehide').size, 0);
  assert.equal(env.timers.size, 0);
});

test('detached previews, timeout and page close resolve false; parent failures reject and always clean listeners', async () => {
  const detached = environment(); assert.equal(await detached.requestHtmlPreviewAction('project', 'refresh'), false);
  for (const cancellation of ['timeout', 'pagehide', 'failure']) {
    const env = environment(); const opener = source(); env.window.opener = opener;
    const promise = env.requestHtmlPreviewAction('project', 'refresh');
    if (cancellation === 'timeout') [...env.timers][0]();
    else if (cancellation === 'pagehide') env.emit('pagehide');
    else {
      const request = opener.replies[0].value;
      env.emit('message', { origin: 'https://example.com', source: opener, data: { ...request, source: 'kodety-html-preview-parent', type: 'response', ok: false, error: 'Folder permission revoked' } });
    }
    if (cancellation === 'failure') await assert.rejects(promise, /permission revoked/); else assert.equal(await promise, false);
    assert.equal(env.listeners.get('message').size, 0);
    assert.equal(env.listeners.get('pagehide').size, 0);
    assert.equal(env.timers.size, 0);
  }
});
