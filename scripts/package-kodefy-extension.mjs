import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve('extensions/kodefy');
const dist = path.join(root, 'dist');
const archiveDate = new Date('2000-01-01T00:00:00.000Z');

async function addDirectory(zip, directory, { prefix = '', skipDist = false, restoreLiquid = false, excludeRoot = [] } = {}) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (
      entry.name === '.DS_Store'
      || (skipDist && prefix === '' && entry.name === 'dist')
      || (prefix === '' && excludeRoot.includes(entry.name))
    ) continue;
    const absolute = path.join(directory, entry.name);
    let relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      await addDirectory(zip, absolute, { prefix: relative, skipDist, restoreLiquid, excludeRoot });
    } else if (entry.isFile()) {
      if (restoreLiquid && relative.endsWith('.liquid.txt')) relative = relative.slice(0, -4);
      zip.file(relative, await fs.readFile(absolute), { date: archiveDate });
    }
  }
}

async function packageDirectory(source, filename, options = {}) {
  const zip = new JSZip();
  await addDirectory(zip, source, options);
  const output = path.join(dist, filename);
  await fs.writeFile(output, await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
  }));
  console.log(`Created: ${output}`);
  return output;
}

async function openArchive(filename) {
  const bytes = await fs.readFile(filename);
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  return { bytes, zip, files };
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

await fs.mkdir(dist, { recursive: true });
await fs.rm(path.join(dist, 'noise-kodefy-commerce.zip'), { force: true });
const installablePath = await packageDirectory(root, 'kodefy-shopify.zip', { skipDist: true, excludeRoot: ['theme', 'themes'] });
const kitPath = await packageDirectory(path.join(root, 'kit'), 'kodefy-kodety-kit.zip');
const themePath = await packageDirectory(path.join(root, 'theme'), 'kodefy-shopify-theme.zip', { restoreLiquid: true });

const installable = await openArchive(installablePath);
assert.ok(installable.files.includes('includes/class-kodefy-checkout.php'), 'Installable ZIP is missing the checkout resolver.');
assert.ok(installable.files.includes('kodety-extension.json'), 'Installable ZIP is missing its manifest.');
assert.ok(!installable.files.some(name => /^(?:theme|themes)\//i.test(name)), 'Theme sources must remain outside the installable extension.');
assert.ok(!installable.files.some(name => /\.mp4$/i.test(name)), 'MP4 files are not allowed in the installable extension.');
const archivedManifest = JSON.parse(await installable.zip.file('kodety-extension.json').async('string'));
const sourceManifest = JSON.parse(await fs.readFile(path.join(root, 'kodety-extension.json'), 'utf8'));
const extensionPhp = await fs.readFile(path.join(root, 'extension.php'), 'utf8');
const extensionVersion = extensionPhp.match(/const VERSION = '([^']+)'/)?.[1] || '';
const workspacePackage = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
assert.equal(archivedManifest.version, sourceManifest.version, 'Installable ZIP has a stale manifest version.');
assert.equal(archivedManifest.version, extensionVersion, 'Extension PHP and manifest versions diverged.');
assert.equal(archivedManifest.requires?.kodety, `>=${workspacePackage.version}`, 'Installable ZIP has a stale core requirement.');

const kit = await openArchive(kitPath);
for (const page of ['index.html', 'cart.html']) {
  const entry = kit.zip.file(page);
  assert.ok(entry, `Kit ZIP is missing ${page}.`);
  assert.match(await entry.async('string'), /data-kodefy-checkout-overlay/, `${page} is missing the editable checkout overlay.`);
}

for (const archive of [installable, kit, await openArchive(themePath)]) {
  console.log(`SHA256 ${digest(archive.bytes)}`);
}
console.log(`Verified: installable extension excludes themes and contains checkout ${extensionVersion}; kit contains checkout overlays.`);
