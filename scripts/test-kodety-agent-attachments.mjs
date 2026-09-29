import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';

import {
  extractDocxText,
  extractLegacyDocText,
  loadTurnAttachments,
  readAttachmentRange,
  redactRuntimePaths,
} from '../Wordpress/kodety/agent-runtime/server.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'kodety-agent-attachments-'));
const runtime = { attachmentRoot: root };

async function storeAttachment({ id, name, mime, kind, extension, buffer, createdAt = Math.floor(Date.now() / 1000) }) {
  await writeFile(path.join(root, `${id}.${extension}`), buffer, { mode: 0o600 });
  await writeFile(path.join(root, `${id}.json`), JSON.stringify({
    version: 1,
    id,
    name,
    mime,
    kind,
    extension,
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    createdAt,
  }), { mode: 0o600 });
}

try {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', [
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    '<w:p><w:r><w:t>Brief do componente</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Segunda linha &amp; detalhes.</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join(''));
  const docx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.match(extractDocxText(docx), /Brief do componente\nSegunda linha & detalhes\./);

  const legacyDoc = Buffer.alloc(2048);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(legacyDoc);
  Buffer.from('Conteúdo recuperado do documento DOC legado.', 'utf16le').copy(legacyDoc, 1024);
  assert.match(extractLegacyDocText(legacyDoc), /Conteúdo recuperado do documento DOC legado/);

  const textId = '11111111111111111111111111111111';
  const text = Buffer.from('Primeiro bloco do briefing.\nSegundo bloco com requisitos do projeto.\n', 'utf8');
  await storeAttachment({
    id: textId,
    name: 'brief.txt',
    mime: 'text/plain',
    kind: 'text',
    extension: 'txt',
    buffer: text,
  });
  const textTurn = await loadTurnAttachments(runtime, [textId]);
  assert.deepEqual(textTurn.ids, [textId]);
  assert.equal(textTurn.imageItems.length, 0);
  assert.equal(textTurn.documentItems.length, 1);
  assert.match(textTurn.documentItems[0].text, /Primeiro bloco do briefing/);
  const textRange = await readAttachmentRange(runtime, textId, 27, 1000);
  assert.equal(textRange.offset, 27);
  assert.match(textRange.content, /Segundo bloco/);
  assert.equal(textRange.hasMore, false);

  const utf16Id = '44444444444444444444444444444444';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Referência TXT em UTF-16.', 'utf16le')]);
  await storeAttachment({
    id: utf16Id,
    name: 'referencia-utf16.txt',
    mime: 'text/plain',
    kind: 'text',
    extension: 'txt',
    buffer: utf16,
  });
  const utf16Turn = await loadTurnAttachments(runtime, [utf16Id]);
  assert.match(utf16Turn.documentItems[0].text, /Referência TXT em UTF-16/);

  const docxId = '22222222222222222222222222222222';
  await storeAttachment({
    id: docxId,
    name: 'brief.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'docx',
    extension: 'docx',
    buffer: docx,
  });
  const docxTurn = await loadTurnAttachments(runtime, [docxId]);
  assert.equal(docxTurn.manifest[0].kind, 'docx');
  assert.match(docxTurn.documentItems[0].text, /Segunda linha/);

  const imageId = '33333333333333333333333333333333';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await storeAttachment({
    id: imageId,
    name: 'reference.png',
    mime: 'image/png',
    kind: 'image',
    extension: 'png',
    buffer: png,
  });
  const imageTurn = await loadTurnAttachments(runtime, [imageId]);
  assert.deepEqual(imageTurn.imageItems, [{
    type: 'localImage',
    path: path.join(root, `${imageId}.png`),
    detail: 'auto',
  }]);
  assert.equal(imageTurn.documentItems.length, 0);
  const redacted = redactRuntimePaths({
    thread: { cwd: root },
    content: [{ type: 'localImage', path: path.join(root, `${imageId}.png`) }],
  }, {
    cwd: root,
    codexHome: path.join(root, 'codex-home'),
    uploadRoot: path.join(root, 'skills'),
    attachmentRoot: root,
    skillRoots: [],
  });
  assert.equal(redacted.thread.cwd, '');
  assert.equal(redacted.content[0].path, '', 'private image paths must not reach the browser transcript');

  await assert.rejects(
    loadTurnAttachments(runtime, [textId, textId]),
    /attachment list is invalid/i,
    'duplicate ids must not be accepted as separate attachments',
  );
  await writeFile(path.join(root, `${textId}.txt`), Buffer.from('tampered', 'utf8'));
  await assert.rejects(
    readAttachmentRange(runtime, textId, 0, 1000),
    /unavailable|changed/i,
    'attachment metadata must bind the original size and digest',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('Anexos do Agent Kodety aprovados (imagem + TXT + DOC + DOCX).');
