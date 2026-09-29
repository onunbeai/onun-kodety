import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, getSupportedThinkingLevels, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { createBrowserAgentAttachments } from '../../../lib/html-editor/browser-agent-attachments.mjs';
import { createBrowserAgentRuntime } from '../../../lib/html-editor/browser-agent-runtime.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const payload = (name, buffer) => ({ name, mimeType: 'application/octet-stream', contentBase64: buffer.toString('base64') });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rpcFor = runtime => (method, params = {}) => runtime.request('rpc', { body: { method, params } });
async function until(read, predicate) {
  for (let n = 0; n < 200; n++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Expected attachment runtime transition did not arrive');
}

test('browser attachments use the server image, TXT, DOC and DOCX parsers, persist separately and validate scope', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Brief &amp; referência</w:t></w:r></w:p></w:body></w:document>');
  const docx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const legacy = Buffer.alloc(2048);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(legacy);
  Buffer.from('Documento legado com referência de layout.', 'utf16le').copy(legacy, 1024);
  const store = createBrowserAgentAttachments({ projectId: 'project-1' });
  const uploaded = [];
  for (const [name, bytes] of [['image.png', png], ['brief.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Texto UTF-16 legível.', 'utf16le')])], ['brief.docx', docx], ['brief.doc', legacy]]) {
    const result = await store.upload(payload(name, bytes));
    uploaded.push(result.attachment);
    assert.equal(result.attachment.size, bytes.length);
    assert.equal(result.attachment.name, name);
    assert.match(result.attachment.id, /^[a-f0-9]{32}$/);
    assert.deepEqual(Object.keys(result.attachment).sort(), ['createdAt', 'id', 'kind', 'mime', 'name', 'size']);
  }
  const turn = store.turn(uploaded.map(entry => entry.id));
  assert.deepEqual(turn.images, [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }]);
  assert.match(turn.text, /Texto UTF-16 legível/);
  assert.match(turn.text, /Brief \\u0026 referência/);
  assert.match(turn.text, /Documento legado/);
  assert.match(turn.text, /untrusted="true"/);
  const restored = createBrowserAgentAttachments({ projectId: 'project-1' });
  restored.restore(store.snapshot());
  assert.deepEqual(restored.turn(turn.ids), turn);
  assert.throws(() => restored.read({ attachmentId: uploaded[1].id }, []), error => error.status === 403);
  assert.throws(() => createBrowserAgentAttachments({ projectId: 'different' }).restore(store.snapshot()), /não pertencem/);
  assert.throws(() => store.turn([...turn.ids, ...turn.ids]), /até 6/);
  await assert.rejects(store.upload(payload('fake.png', Buffer.from('not an image'))), /válido/);
  await assert.rejects(store.upload(payload('binary.txt', Buffer.from([0, 1, 2]))), /válido/);
  await assert.rejects(store.upload(payload('archive.zip', docx)), error => error.status === 415);
  const removable = uploaded[1].id;
  await store.remove(removable);
  assert.throws(() => store.turn([removable]), error => error.status === 404);
});

test('upload success waits for persistence and a failed browser commit does not leave an attached file', async () => {
  const gate = deferred();
  let started = false;
  let completed = false;
  const store = createBrowserAgentAttachments({ projectId: 'commit-test', persist: async () => { started = true; await gate.promise; } });
  const upload = store.upload(payload('image.png', png)).then(value => { completed = true; return value; });
  await until(() => started, Boolean);
  assert.equal(completed, false);
  assert.deepEqual(store.snapshot().files, []);
  gate.reject(Object.assign(new Error('Storage unavailable'), { code: 'agent_browser_attachments_storage' }));
  await assert.rejects(upload, error => error.code === 'agent_browser_attachments_storage');
  assert.deepEqual(store.snapshot().files, []);
});

test('real Pi Agent receives images and document ranges, and reload restores both without duplicating image data in history', async () => {
  const catalog = createModels(); catalog.setProvider(openaiCodexProvider());
  const model = catalog.getModel('openai-codex', 'gpt-5.6-terra');
  const credential = { type: 'oauth', access: `fixture.${Buffer.from(JSON.stringify({ email: 'attachment@example.test' })).toString('base64url')}.signature`, refresh: 'fixture-refresh', expires: Date.now() + 3600000 };
  const conversations = [];
  let documentId;
  let turnNumber = 0;
  const models = { getModels: () => [model], logout: async () => {}, streamSimple(chosen, conversation) {
    conversations.push(JSON.parse(JSON.stringify(conversation)));
    const content = turnNumber++ % 2 === 0
      ? { type: 'toolCall', id: `document-${turnNumber}`, name: 'kodety_attachment_read', arguments: { attachmentId: documentId, offset: 24000, maxChars: 1000 } }
      : { type: 'text', text: 'Li a referência e o restante do documento.' };
    const message = { role: 'assistant', content: [content], api: chosen.api, provider: chosen.provider, model: chosen.id, timestamp: Date.now(), stopReason: content.type === 'toolCall' ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream(); stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason, message }); return stream;
  } };
  const options = { projectId: 'attachment-turn', licensed: true, dependencies: { models, Agent, getSupportedThinkingLevels } };
  const runtime = createBrowserAgentRuntime(options);
  const restored = createBrowserAgentRuntime(options);
  const rpc = rpcFor(runtime);
  try {
    await runtime.restoreCredentials(credential);
    assert.equal((await runtime.request('config')).capabilities.attachments, true);
    const image = await runtime.request('attachments', { body: payload('reference.png', png) });
    const doc = await runtime.request('attachments', { body: payload('long.txt', Buffer.from('A'.repeat(24000) + 'THE_REMAINDER')) });
    documentId = doc.attachment.id;
    const threadId = (await rpc('thread/start')).thread.id;
    await rpc('turn/start', { threadId, attachments: [image.attachment.id, documentId] });
    await until(() => rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status === 'completed');
    const firstUser = conversations[0].messages.find(message => message.role === 'user');
    assert.ok(firstUser.content.some(block => block.type === 'image' && block.data === png.toString('base64')));
    assert.equal(JSON.stringify(firstUser).includes('THE_REMAINDER'), false, 'only initial excerpt enters the prompt');
    const readResult = conversations[1].messages.find(message => message.role === 'toolResult');
    assert.equal(JSON.parse(readResult.content[0].text).content, 'THE_REMAINDER');
    const history = runtime.snapshot();
    assert.equal(JSON.stringify(history).includes(png.toString('base64')), false);
    assert.ok(JSON.stringify(history).includes('kodetyAttachmentImage'));
    assert.equal(runtime.exportAttachments().files.find(entry => entry.id === image.attachment.id).data, png.toString('base64'));
    await restored.restoreCredentials(credential);
    restored.restoreAttachments(runtime.exportAttachments());
    restored.restore(history);
    const nextRpc = rpcFor(restored);
    await nextRpc('turn/start', { threadId, prompt: 'Leia novamente o restante do documento anterior.' });
    await until(() => nextRpc('thread/read', { threadId }), value => value.thread.turns.length === 2 && value.thread.turns.at(-1).status === 'completed');
    assert.ok(conversations[2].messages.some(message => message.role === 'user' && message.content.some(block => block.type === 'image' && block.data === png.toString('base64'))));
    assert.equal(JSON.parse(conversations[3].messages.filter(message => message.role === 'toolResult').at(-1).content[0].text).content, 'THE_REMAINDER');
    await assert.rejects(restored.request('attachments', { method: 'DELETE', body: { attachmentId: documentId } }), error => error.status === 409);
    await restored.setPolicy({ readOnly: true });
    await assert.rejects(restored.request('attachments', { body: payload('another.png', png) }), error => error.code === 'agent_read_only');
  } finally { await runtime.dispose(); await restored.dispose(); }
});
