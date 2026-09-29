import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(repositoryRoot, 'WebApp/kodety-studio/dist');
const outputRoot = path.join(repositoryRoot, 'WebApp/dist');
const outputDirectory = path.join(outputRoot, 'kodety-studio-docker');
const outputArchive = path.join(outputRoot, 'kodety-studio-docker.zip');
const legacyOutputDirectory = path.join(outputRoot, 'kodety-studio-web');
const legacyOutputArchive = path.join(outputRoot, 'kodety-studio-web.zip');
async function addDirectory(zip, directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      await addDirectory(zip, absolute, relative);
    } else if (entry.isFile()) {
      const stats = await fs.stat(absolute);
      zip.file(relative, await fs.readFile(absolute), {
        // EasyPanel may retain an extracted file when its path, byte length and
        // archive timestamp are all unchanged. Vite's stable studio.js entry
        // can keep the same length while pointing at a different hashed chunk,
        // so preserve the real build timestamp to guarantee replacement.
        date: stats.mtime,
        createFolders: false,
      });
    }
  }
}

const indexPath = path.join(sourceDirectory, 'index.html');
assert.ok((await fs.stat(indexPath)).isFile(), 'Run npm run studio:web:build before packaging.');
assert.ok((await fs.stat(path.join(sourceDirectory, 'manifest.webmanifest'))).isFile());
assert.ok((await fs.stat(path.join(sourceDirectory, 'service-worker.js'))).isFile());

const zip = new JSZip();
await addDirectory(zip, sourceDirectory);
const archiveBytes = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX',
});

await fs.mkdir(outputRoot, { recursive: true });
await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.rm(outputArchive, { force: true });
await fs.rm(legacyOutputDirectory, { recursive: true, force: true });
await fs.rm(legacyOutputArchive, { force: true });
await fs.cp(sourceDirectory, outputDirectory, {
  recursive: true,
  filter: source => path.basename(source) !== '.DS_Store',
});
await fs.writeFile(outputArchive, archiveBytes);

const packagedZip = await JSZip.loadAsync(archiveBytes);
for (const requiredPath of [
  'Dockerfile',
  'nginx.conf',
  'server.mjs',
  'github-auth.mjs',
  'cloudflare-deploy.mjs',
  'agent-network.mjs',
  'index.html',
  'project-storage.html',
  'manifest.webmanifest',
  'service-worker.js',
  'assets/kodety.zip',
]) {
  assert.ok(packagedZip.file(requiredPath), `Packaged web app is missing ${requiredPath}.`);
}
assert.equal(packagedZip.file('manifest.json'), null, 'The Docker ZIP must not contain a Chrome extension manifest.');
assert.equal(packagedZip.file('background.js'), null, 'The Docker ZIP must not contain extension background code.');

const digest = createHash('sha256').update(archiveBytes).digest('hex');
console.log(`Onun Kodety Docker directory: ${outputDirectory}`);
console.log(`Onun Kodety Docker archive: ${outputArchive}`);
console.log(`Archive SHA-256: ${digest}`);
