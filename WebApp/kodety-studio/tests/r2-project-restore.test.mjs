import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import JSZip from 'jszip';
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-r2-restore-'));
const entry = fileURLToPath(new URL('../src/r2-project-restore.ts', import.meta.url));
const outfile = path.join(scratch, 'restore.cjs');
await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolate-archive-validation', setup(build) {
  build.onResolve({ filter: /.*/ }, args => args.importer === entry && args.path !== 'jszip' ? { path: args.path, namespace: 'mock' } : null);
  build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'module.exports = {};' }));
} }] });
const { validateWordPressArchive } = createRequire(import.meta.url)(outfile);
after(() => rm(scratch, { recursive: true, force: true }));
async function archive(file, options) { const zip = new JSZip(); zip.file(file, 'fixture', options); return new Blob([await zip.generateAsync({ type: 'uint8array', platform: 'UNIX', compression: 'DEFLATE' })]); }
test('WordPress backup accepts the exporter layout including binary database and config', async () => {
  const zip = new JSZip(); zip.file('wp-content/database/.ht.sqlite', new Uint8Array([0, 255, 128])); zip.file('wp-config.php', '<?php // fixture'); zip.file('playground-export.json', '{"formatVersion":2}');
  await validateWordPressArchive(new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })]));
});
test('path traversal and symlinks are rejected before importing into WordPress', async () => {
  await assert.rejects(validateWordPressArchive(await archive('wp-content/../../outside.php')), /path/);
  await assert.rejects(validateWordPressArchive(await archive('wp-content/link', { unixPermissions: 0o120777 })), /path/);
});
test('a declared oversized ZIP entry is rejected before decompression allocation', async () => {
  const bytes = Buffer.from(await (await archive('wp-content/large.bin')).arrayBuffer());
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  // Find the file (the archive also contains the directory entry).
  let cursor = central;
  while (bytes.readUInt32LE(cursor) === 0x02014b50) {
    const length = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + length).toString();
    if (name.endsWith('large.bin')) { bytes.writeUInt32LE(300 * 1024 * 1024, cursor + 24); break; }
    cursor += 46 + length + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  await assert.rejects(validateWordPressArchive(new Blob([bytes])), /too large/);
});
