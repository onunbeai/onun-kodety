import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  assertWordPressPluginVersion,
  assertWordPressReleaseVersion,
} from './wordpress-package-contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [packageJson, packageLock] = await Promise.all([
  readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
]);
const version = assertWordPressReleaseVersion(packageJson, packageLock);
if (!/^\d+(?:\.\d+){1,3}$/.test(version)) {
  throw new Error(`Versão inválida em package.json: ${version || '(vazia)'}.`);
}

const unknownArguments = process.argv.slice(2);
if (unknownArguments.length) throw new Error(`Argumentos desconhecidos: ${unknownArguments.join(', ')}.`);

const archiveName = `${version.replaceAll('.', '_')}.zip`;
const topLevel = 'kodety';
const entry = 'kodety.php';
const source = path.join(root, 'Wordpress', 'dist', archiveName);
const archive = await readFile(source).catch(() => null);
if (!archive) throw new Error(`Wordpress/dist/${archiveName} não existe. Execute npm run wordpress:zip primeiro.`);

const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
const bootstrapEntry = zip.file(`${topLevel}/${entry}`);
if (!bootstrapEntry) throw new Error(`${archiveName} não contém ${topLevel}/${entry}.`);
assertWordPressPluginVersion(await bootstrapEntry.async('string'), version);
const changelogEntry = zip.file(`${topLevel}/changelog.json`);
if (!changelogEntry) throw new Error(`${archiveName} não contém changelog.json.`);
const changelog = JSON.parse(await changelogEntry.async('string'));
const release = Array.isArray(changelog.releases)
  ? changelog.releases.find(item => item && String(item.version) === version)
  : null;
if (!release) throw new Error(`Adicione a versão ${version} ao changelog antes de preparar uma release.`);

const sha256 = createHash('sha256').update(archive).digest('hex');
const items = Array.isArray(release.items)
  ? release.items.map(item => String(item).trim()).filter(Boolean).slice(0, 30)
  : [];
const releaseDraft = {
  version,
  sha256,
  releasedAt: String(release.date || ''),
  summary: String(release.summary || release.title || `Onun Kodety ${version}`),
  changelog: items,
};
console.log(JSON.stringify(releaseDraft, null, 2));
console.log(`Release ${version} pronta: envie Wordpress/dist/${archiveName} nas Releases do repositório da organização Onun.`);
