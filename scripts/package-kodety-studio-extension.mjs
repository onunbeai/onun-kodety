import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(repositoryRoot, 'ChromeExtension/kodety-studio/dist');
const outputRoot = path.join(repositoryRoot, 'ChromeExtension/dist');
const outputDirectory = path.join(outputRoot, 'kodety-studio');
const outputArchive = path.join(outputRoot, 'kodety-studio.zip');
const archiveDate = new Date('2000-01-01T00:00:00.000Z');

const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const kodetyVersion = packageJson.kodety?.wordpressVersion;
assert.match(kodetyVersion || '', /^\d+\.\d+\.\d+$/);

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
      zip.file(relative, await fs.readFile(absolute), {
        date: archiveDate,
        createFolders: false,
      });
    }
  }
}

const sourceManifest = JSON.parse(await fs.readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'));
assert.equal(sourceManifest.manifest_version, 3, 'Run npm run studio:build before packaging.');

const authoritativeArchivePath = path.join(
  repositoryRoot,
  `Wordpress/dist/${kodetyVersion.replaceAll('.', '_')}.zip`,
);
const authoritativePlugin = await fs.readFile(authoritativeArchivePath);
const builtPlugin = await fs.readFile(path.join(sourceDirectory, 'assets/kodety.zip'));
assert.deepEqual(
  builtPlugin,
  authoritativePlugin,
  'Refusing to package a build that does not contain the authoritative Kodety plugin ZIP.',
);

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
await fs.cp(sourceDirectory, outputDirectory, {
  recursive: true,
  filter: source => path.basename(source) !== '.DS_Store',
});
await fs.writeFile(outputArchive, archiveBytes);

const packagedZip = await JSZip.loadAsync(archiveBytes);
const packagedFiles = Object.values(packagedZip.files).filter(entry => !entry.dir);
for (const requiredPath of ['manifest.json', 'index.html', 'background.js', 'assets/kodety.zip']) {
  assert.ok(packagedZip.file(requiredPath), `Packaged extension is missing ${requiredPath}.`);
}
assert.ok(
  packagedFiles.every(entry => !entry.name.startsWith('kodety-studio/')),
  'The installable archive must expose manifest.json at its root.',
);
const packagedPlugin = await packagedZip.file('assets/kodety.zip').async('nodebuffer');
assert.deepEqual(packagedPlugin, authoritativePlugin);

const digest = createHash('sha256').update(archiveBytes).digest('hex');
console.log(`Kodety Studio directory: ${outputDirectory}`);
console.log(`Kodety Studio archive: ${outputArchive}`);
console.log(`Archive SHA-256: ${digest}`);
