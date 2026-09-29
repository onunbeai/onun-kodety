import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const extensionRoot = path.join(repositoryRoot, 'ChromeExtension/kodety-studio');
const sourceManifestPath = path.join(extensionRoot, 'public/manifest.json');
const builtDirectory = path.join(extensionRoot, 'dist');

const readText = file => fs.readFile(file, 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readConstant(source, name) {
  const value = source.match(new RegExp(`export const ${name} = ['\"]([^'\"]+)['\"] as const;`))?.[1];
  assert.ok(value, `Missing ${name} in product-versions.ts.`);
  return value;
}

const packageJson = JSON.parse(await readText(path.join(repositoryRoot, 'package.json')));
const packageLock = JSON.parse(await readText(path.join(repositoryRoot, 'package-lock.json')));
const kodetyVersion = packageJson.kodety?.wordpressVersion;
assert.match(
  kodetyVersion || '',
  /^\d+\.\d+\.\d+$/,
  'package.json must declare a semantic kodety.wordpressVersion.',
);

const authoritativeArchivePath = path.join(
  repositoryRoot,
  `Wordpress/dist/${kodetyVersion.replaceAll('.', '_')}.zip`,
);
const authoritativeArchive = await fs.readFile(authoritativeArchivePath);
const authoritativeDigest = sha256(authoritativeArchive);
const authoritativeZip = await JSZip.loadAsync(authoritativeArchive);
const authoritativeFiles = Object.values(authoritativeZip.files).filter(entry => !entry.dir);
assert.ok(authoritativeFiles.length > 0, 'The authoritative Kodety archive must not be empty.');
assert.ok(
  authoritativeFiles.every(entry => entry.name.startsWith('kodety/')),
  'The authoritative plugin archive must contain exactly one installable kodety/ root.',
);

const pluginEntry = authoritativeZip.file('kodety/kodety.php');
assert.ok(pluginEntry, 'The authoritative archive is missing kodety/kodety.php.');
const pluginSource = await pluginEntry.async('string');
assert.match(pluginSource, /Plugin Name:\s*Kodety Studio\b/, 'The plugin entry must identify Kodety Studio.');
assert.equal(
  pluginSource.match(/^\s*\*\s*Version:\s*([^\s]+)\s*$/m)?.[1],
  kodetyVersion,
  'The plugin header version must match package.json.',
);
assert.equal(
  pluginSource.match(/define\('KODETY_VERSION',\s*'([^']+)'\);/)?.[1],
  kodetyVersion,
  'KODETY_VERSION inside the authoritative ZIP must match package.json.',
);

const versionsSource = await readText(path.join(extensionRoot, 'src/product-versions.ts'));
const runtimeSource = await readText(path.join(extensionRoot, 'src/playground-runtime.ts'));
const storageSource = await readText(path.join(extensionRoot, 'src/storage.ts'));
const mainSource = await readText(path.join(extensionRoot, 'src/main.tsx'));
const viteSource = await readText(path.join(extensionRoot, 'vite.config.ts'));
const indexSource = await readText(path.join(extensionRoot, 'index.html'));
const backgroundSource = await readText(path.join(extensionRoot, 'public/background.js'));

assert.equal(
  readConstant(versionsSource, 'KODETY_PLUGIN_VERSION'),
  kodetyVersion,
  'The Studio product matrix must use the packaged Kodety version.',
);
const playgroundVersion = readConstant(versionsSource, 'KODETY_PLAYGROUND_CLIENT_VERSION');
const lockedPlaygroundVersion = packageLock.packages?.['node_modules/@wp-playground/client']?.version;
assert.ok(lockedPlaygroundVersion, 'package-lock.json must pin @wp-playground/client.');
assert.equal(
  packageJson.dependencies?.['@wp-playground/client'],
  playgroundVersion,
  'package.json must pin @wp-playground/client exactly; semver ranges are not allowed in the runtime matrix.',
);
assert.equal(
  packageLock.packages?.['']?.dependencies?.['@wp-playground/client'],
  playgroundVersion,
  'The root package-lock dependency must preserve the exact Playground client pin.',
);
assert.equal(
  playgroundVersion,
  lockedPlaygroundVersion,
  'The Studio product matrix must match the installed Playground client lock.',
);
assert.match(readConstant(versionsSource, 'KODETY_PHP_VERSION'), /^8\.\d+$/);
assert.match(readConstant(versionsSource, 'KODETY_WORDPRESS_VERSION'), /^\d+\.\d+$/);

assert.match(viteSource, /packageJson\.kodety\?\.wordpressVersion/);
assert.ok(
  viteSource.includes("`Wordpress/dist/${kodetyVersion.replaceAll('.', '_')}.zip`"),
  'The Vite build must derive the authoritative archive path from kodety.wordpressVersion.',
);
assert.match(viteSource, /path\.join\(assetDirectory, 'kodety\.zip'\)/);
assert.doesNotMatch(
  viteSource,
  /Wordpress\/dist\/kodety\.zip/,
  'The Studio build must never copy the stale floating Kodety archive.',
);

const manifest = JSON.parse(await readText(sourceManifestPath));
assert.equal(manifest.manifest_version, 3, 'Kodety Studio must remain a Manifest V3 extension.');
assert.equal(manifest.name, 'Kodety Studio');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.ok(Number(manifest.minimum_chrome_version) >= 109);
assert.deepEqual(
  [...manifest.permissions].sort(),
  ['storage'],
  'Studio permissions must stay limited to project metadata.',
);
assert.equal(manifest.host_permissions, undefined, 'Embedding the isolated runtime must not grant host access.');
assert.doesNotMatch(JSON.stringify(manifest), /<all_urls>|\"tabs\"|\"scripting\"/);
assert.equal(manifest.background?.type, 'module');
assert.equal(manifest.background?.service_worker, 'background.js');
assert.equal(manifest.action?.default_popup, undefined, 'The toolbar action opens the full Studio tab.');
const extensionCsp = manifest.content_security_policy?.extension_pages || '';
assert.match(extensionCsp, /script-src 'self';/);
assert.match(extensionCsp, /frame-src https:\/\/playground\.wordpress\.net/);
assert.doesNotMatch(extensionCsp, /script-src[^;]*https?:/);
assert.doesNotMatch(extensionCsp, /wasm-unsafe-eval|connect-src[^;]*https:|img-src[^;]*https:/);

assert.match(backgroundSource, /chrome\.runtime\.getURL\('index\.html'\)/);
assert.match(backgroundSource, /chrome\.tabs\.create\(/);
assert.match(backgroundSource, /chrome\.storage\.session/);
assert.match(backgroundSource, /chrome\.tabs\.update\(/);
assert.doesNotMatch(indexSource, /<script[^>]+src=['\"]https?:/i);
assert.doesNotMatch(indexSource, /<link[^>]+href=['\"]https?:/i);

assert.match(storageSource, /kodety-studio\/projects\/\$\{projectId\}/);
assert.match(storageSource, /typeof project\.wordpressVersion === 'string'/);
assert.match(storageSource, /typeof project\.kodetyVersion === 'string'/);
assert.match(storageSource, /thumbnailDataUrl/);
assert.match(runtimeSource, /initialSyncDirection/);
assert.match(runtimeSource, /'opfs-to-memfs'/);
assert.match(runtimeSource, /'memfs-to-opfs'/);
assert.match(runtimeSource, /restorePersistedProject/);
assert.match(runtimeSource, /setSiteLanguage/);
assert.match(runtimeSource, /project\.wordpressLocale === 'pt_BR'/);
assert.match(runtimeSource, /new File\(\[await pluginResponse\.arrayBuffer\(\)\], 'kodety\.zip'/);
assert.match(runtimeSource, /ifAlreadyInstalled:\s*'overwrite'/);
assert.match(runtimeSource, /activate:\s*true/);
assert.match(runtimeSource, /is_plugin_active\('kodety\/kodety\.php'\)/);
assert.match(runtimeSource, /defined\('KODETY_VERSION'\)/);
assert.match(runtimeSource, /wordpressVersion/);
assert.match(runtimeSource, /PHP_MAJOR_VERSION/);
assert.match(runtimeSource, /const WORDPRESS_ADMIN_PATH = '\/wp-admin\/'/);
assert.match(runtimeSource, /await client\.goTo\(isFirstBoot \? WORDPRESS_ADMIN_PATH : KODETY_BUILDER_PATH\)/);
assert.match(runtimeSource, /navigator\.locks\.request/);
assert.match(mainSource, /allow="clipboard-read \*; clipboard-write \*"/);
assert.match(runtimeSource, /await client\.rmdir\(path, \{ recursive: true \}\)/);
assert.match(runtimeSource, /await client\.flushOpfs\(WORDPRESS_MOUNTPOINT\)/);
assert.match(runtimeSource, /await client\.unmountOpfs\(WORDPRESS_MOUNTPOINT\)/);
assert.match(runtimeSource, /defineConstant\('KODETY_BROWSER_STUDIO_RUNTIME', project\.id\)/);
assert.match(runtimeSource, /kind:\s*'kodety-studio-browser'/);
assert.match(runtimeSource, /studioOrigin:\s*window\.location\.origin/);
assert.equal(
  runtimeSource.match(/https:\/\/playground\.wordpress\.net/g)?.length,
  1,
  'The runtime must use one explicit Playground host boundary.',
);
assert.equal(
  mainSource.match(/sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"/g)?.length,
  2,
  'Both hosted-runtime iframes must stay sandboxed away from extension APIs.',
);
assert.ok(
  mainSource.indexOf('await saveProjects(sorted)') < mainSource.indexOf('setProjects(sorted)'),
  'Project metadata must be persisted before the dashboard state is committed.',
);
assert.match(mainSource, /href="https:\/\/dash\.kodety\.com\/"[\s\S]*?rel="noopener noreferrer"/);
assert.match(mainSource, /href="https:\/\/kodety\.com\/discord"[\s\S]*?rel="noopener noreferrer"/);
assert.match(mainSource, /function DiscordLogo/);
assert.match(mainSource, /Comprar licença/);
assert.match(mainSource, /captureSiteThumbnail\(\)/);
assert.match(mainSource, /message\.type === 'project-published'/);
assert.match(mainSource, /project-preview-placeholder/);
assert.doesNotMatch(mainSource, /preview-builder-shell/);
const onboardingSource = mainSource.slice(mainSource.indexOf('function StudioOnboarding'), mainSource.indexOf('function ProjectWorkspace'));
assert.equal(
  onboardingSource.match(/\{ title: t\(/g)?.length,
  2,
  'The first-run Studio onboarding must stay condensed to two steps.',
);
assert.match(onboardingSource, /Seu Studio local/);
assert.match(onboardingSource, /ZIP e segurança/);
assert.match(mainSource, /RuntimeLoading stage=\{stage\} detail=\{detail\} restoring=\{initialRestoringRef\.current\}/);
assert.match(mainSource, /studioSitePreviewUrl\(project, language\)/);
assert.doesNotMatch(
  mainSource.slice(mainSource.indexOf('function ProjectWorkspace'), mainSource.indexOf('function StudioApp')),
  /<LanguageSwitcher/,
  'The project workspace must keep the global language switcher in the project library only.',
);

const builtManifest = JSON.parse(await readText(path.join(builtDirectory, 'manifest.json')));
assert.deepEqual(builtManifest, manifest, 'The built manifest must match the reviewed source manifest.');
for (const relativePath of [
  'index.html',
  'background.js',
  'manifest.json',
  'WORDPRESS-PLAYGROUND-LICENSE.txt',
  'assets/studio.js',
  'assets/studio.css',
  'assets/kodety.zip',
  'assets/kodety-icon.png',
  'assets/kodety-mark.svg',
  'assets/inter-latin-variable.woff2',
]) {
  const stats = await fs.stat(path.join(builtDirectory, relativePath));
  assert.ok(stats.isFile() && stats.size > 0, `Built artifact is missing ${relativePath}.`);
}

const builtPluginArchive = await fs.readFile(path.join(builtDirectory, 'assets/kodety.zip'));
assert.equal(
  sha256(builtPluginArchive),
  authoritativeDigest,
  `Built assets/kodety.zip must be byte-identical to Wordpress/dist/${kodetyVersion.replaceAll('.', '_')}.zip.`,
);

const builtIndex = await readText(path.join(builtDirectory, 'index.html'));
assert.doesNotMatch(builtIndex, /(?:src|href)=['\"]https?:/i, 'The extension page must load code and styles locally.');
assert.match(builtIndex, /\.\/assets\/studio\.js/);
assert.match(builtIndex, /\.\/assets\/studio\.css/);

console.log(
  `Kodety Studio contract passed: plugin ${kodetyVersion} (${authoritativeDigest}), Playground client ${playgroundVersion}.`,
);
