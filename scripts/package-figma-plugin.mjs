import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve('FigmaPlugin');
const dist = path.join(root, 'dist');
const pluginOutput = path.join(dist, 'figma-to-kodety.zip');
const pluginMirror = path.join(dist, 'figma-to-kodety');
const legacyBridgeOutput = path.join(dist, 'figma-to-kodety-bridge.zip');
const pluginFiles = [
  'manifest.json',
  'code.js',
  'ui.html',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
];
const archiveDate = new Date('2000-01-01T00:00:00.000Z');
const zipFileOptions = {
  createFolders: false,
  date: archiveDate,
  unixPermissions: 0o100644,
};
const zipOptions = {
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX',
  streamFiles: false,
};

async function buildPluginArchive() {
  const zip = new JSZip();
  const sources = new Map();
  for (const file of pluginFiles) {
    const source = await readFile(path.join(root, file));
    sources.set(file, source);
    zip.file(file, source, zipFileOptions);
  }

  await rm(pluginMirror, { recursive: true, force: true });
  await mkdir(pluginMirror, { recursive: true });
  for (const [file, source] of sources) {
    await writeFile(path.join(pluginMirror, file), source);
  }
  await writeFile(pluginOutput, await zip.generateAsync(zipOptions));
}

await mkdir(dist, { recursive: true });
await rm(legacyBridgeOutput, { force: true });
await buildPluginArchive();

console.log(`Figma plugin created: ${pluginOutput}`);
