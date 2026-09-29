import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import postcss from 'postcss';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const webRoot = path.join(repositoryRoot, 'WebApp/kodety-studio');
const sourceDirectory = path.join(webRoot, 'src');
const publicDirectory = path.join(webRoot, 'public');
const builtDirectory = path.join(webRoot, 'dist');
const sharedSourceDirectory = path.join(repositoryRoot, 'ChromeExtension/kodety-studio/src');
const sourceManifestPath = path.join(publicDirectory, 'manifest.webmanifest');
const builtManifestPath = path.join(builtDirectory, 'manifest.webmanifest');
const outputArchivePath = path.join(repositoryRoot, 'WebApp/dist/kodety-studio-docker.zip');
const builderSourcePath = path.join(repositoryRoot, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx');
const editorShellPath = path.join(repositoryRoot, 'Wordpress/kodety/templates/editor-shell.php');

const readText = file => fs.readFile(file, 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function fileExists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function listFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolute, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

async function readSources() {
  const candidates = [
    path.join(webRoot, 'index.html'),
    path.join(webRoot, 'vite.config.ts'),
    ...((await listFiles(sourceDirectory)).map(file => path.join(sourceDirectory, file))),
    ...((await listFiles(sharedSourceDirectory)).map(file => path.join(sharedSourceDirectory, file))),
    ...((await listFiles(publicDirectory))
      .filter(file => /\.(?:html|js|mjs|cjs|json|webmanifest|css|txt)$/i.test(file))
      .map(file => path.join(publicDirectory, file))),
  ];
  const sources = [];
  for (const file of candidates) {
    if (await fileExists(file)) {
      sources.push({ file, text: await readText(file) });
    }
  }
  return sources;
}

function assertPortableUrl(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string.`);
  assert.ok(value.length > 0, `${label} must not be empty.`);
  assert.doesNotMatch(value, /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i, `${label} must be deploy-relative, not ${value}.`);
  assert.doesNotMatch(value, /(?:^|\/)\.\.(?:\/|$)/, `${label} must not escape the deploy directory.`);
}

function htmlAssetUrls(html) {
  const urls = [];
  const tagPattern = /<(?:script|link|img|source)\b[^>]*>/gi;
  for (const tag of html.match(tagPattern) || []) {
    const attributePattern = /\b(?:src|href|srcset)=(["'])(.*?)\1/gi;
    for (const match of tag.matchAll(attributePattern)) {
      const value = match[2].trim();
      if (value) urls.push(value);
    }
  }
  return urls;
}

function cssAssetUrls(css) {
  return [...css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)]
    .map(match => match[2].trim())
    .filter(Boolean);
}

function iconSizes(icon) {
  return String(icon?.sizes || '')
    .split(/\s+/)
    .map(size => size.match(/^(\d+)x(\d+)$/i))
    .filter(Boolean)
    .map(match => [Number(match[1]), Number(match[2])]);
}

const packageJson = JSON.parse(await readText(path.join(repositoryRoot, 'package.json')));
const kodetyVersion = packageJson.kodety?.wordpressVersion;
assert.match(
  kodetyVersion || '',
  /^\d+\.\d+\.\d+$/,
  'package.json must declare a semantic kodety.wordpressVersion.',
);

for (const requiredDirectory of [webRoot, sourceDirectory, publicDirectory, builtDirectory, sharedSourceDirectory]) {
  assert.ok(
    (await fs.stat(requiredDirectory)).isDirectory(),
    `Missing ${path.relative(repositoryRoot, requiredDirectory)}. Build the Kodety Studio web app first.`,
  );
}

// A web build must not retain any privileged extension boundary. Keep this
// check focused on actual Chrome API entry points so ordinary copy mentioning
// the Chrome browser does not become a false positive.
const sourceFiles = await readSources();
const chromeApiPattern = /\bchrome\s*(?:\.|\[)\s*(?:action|runtime|storage|tabs|windows|scripting)\b|chrome-extension:\/\//i;
for (const { file, text } of sourceFiles) {
  assert.doesNotMatch(
    text,
    chromeApiPattern,
    `${path.relative(repositoryRoot, file)} must not depend on Chrome extension APIs.`,
  );
}
assert.equal(
  await fileExists(path.join(publicDirectory, 'background.js')),
  false,
  'The PWA must not ship an extension background service worker.',
);

// Validate the installable PWA contract at the reviewed source boundary.
const sourceManifest = JSON.parse(await readText(sourceManifestPath));
assert.match(sourceManifest.name || '', /Onun Kodety/i);
assert.match(sourceManifest.short_name || '', /Kodety/i);
assert.match(sourceManifest.description || '', /\S/);
assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(sourceManifest.display));
assert.match(sourceManifest.theme_color || '', /^#[\da-f]{6}$/i);
assert.match(sourceManifest.background_color || '', /^#[\da-f]{6}$/i);
for (const [key, fallback] of [
  ['id', './'],
  ['start_url', './'],
  ['scope', './'],
]) {
  const value = sourceManifest[key] || fallback;
  assertPortableUrl(value, `manifest.${key}`);
}
assert.ok(Array.isArray(sourceManifest.icons) && sourceManifest.icons.length > 0, 'The PWA manifest needs icons.');
for (const [index, icon] of sourceManifest.icons.entries()) {
  assertPortableUrl(icon.src, `manifest.icons[${index}].src`);
  assert.match(icon.type || '', /^image\/(?:png|webp|svg\+xml)$/i);
}
const declaredIconSizes = sourceManifest.icons.flatMap(iconSizes);
assert.ok(
  declaredIconSizes.some(([width, height]) => width === 192 && height === 192),
  'The PWA manifest must declare a 192x192 icon.',
);
assert.ok(
  declaredIconSizes.some(([width, height]) => width === 512 && height === 512),
  'The PWA manifest must declare a 512x512 icon.',
);

const sourceIndex = await readText(path.join(webRoot, 'index.html'));
assert.match(
  sourceIndex,
  /<link\b(?=[^>]*\brel=["'][^"']*manifest[^"']*["'])(?=[^>]*\bhref=["']\.\/manifest\.en\.webmanifest["'])[^>]*>/i,
  'index.html must link the deploy-relative PWA manifest.',
);
assert.doesNotMatch(sourceIndex, /<script[^>]+src=["']https?:/i);
assert.doesNotMatch(sourceIndex, /<link[^>]+href=["']https?:/i);

const combinedSource = sourceFiles.map(({ text }) => text).join('\n');
const builderSource = await readText(builderSourcePath);
const editorShellSource = await readText(editorShellPath);
const backupStorageSource = await readText(path.join(sharedSourceDirectory, 'backup-storage.ts'));
const runtimeSource = await readText(path.join(sharedSourceDirectory, 'playground-runtime.ts'));
assert.match(combinedSource, /navigator\.serviceWorker/);
assert.match(
  combinedSource,
  /\.register\(\s*['"]\.\/service-worker\.js['"]/,
  'The PWA service worker must be registered with a deploy-relative URL.',
);
assert.match(
  combinedSource,
  /navigator\.storage\.persisted\s*\(/,
  'The web app must inspect whether browser storage is persistent.',
);
assert.match(
  combinedSource,
  /navigator\.storage\.persist\s*\(/,
  'The web app must request persistent browser storage before relying on OPFS.',
);
assert.match(combinedSource, /type:\s*['"]opfs['"]/);
assert.match(combinedSource, /kodety-studio\/projects\/\$\{projectId\}/);
assert.match(combinedSource, /['"]opfs-to-memfs['"]/);
assert.match(combinedSource, /['"]memfs-to-opfs['"]/);
assert.match(combinedSource, /flushOpfs\s*\(/);
assert.match(combinedSource, /restorePersistedProject/);
assert.doesNotMatch(
  combinedSource,
  /chrome\.storage|ChromeStorageArea|ChromeLike/,
  'Project metadata must use browser storage directly, without an extension fallback.',
);
assert.match(
  combinedSource,
  /Transferir para hospedagem/,
  'The project screen must expose the hosting-transfer action.',
);
assert.match(
  combinedSource,
  /role=["']dialog["']/,
  'The hosting-transfer confirmation must be an accessible dialog.',
);
assert.match(combinedSource, /aria-modal(?:=|:)\s*["'{]true["'}]?/);
assert.match(
  backupStorageSource,
  /\bzipWpContent\b/,
  'Safety-folder snapshots must export a restorable local WordPress backup.',
);
assert.match(backupStorageSource, /import JSZip from 'jszip'/);
assert.match(backupStorageSource, /zipWpContentInJavaScript/);
assert.match(backupStorageSource, /playground-export\.json/);
assert.match(backupStorageSource, /wp-config\.php/);
assert.match(backupStorageSource, /generateAsync/);
assert.match(backupStorageSource, /showDirectoryPicker/);
assert.match(backupStorageSource, /latest\.zip/);
assert.match(backupStorageSource, /MAX_SNAPSHOTS\s*=\s*5/);
assert.match(combinedSource, /Baixe um backup antes de sair/);
assert.match(combinedSource, /saveProjectSnapshot/);
assert.match(runtimeSource, /kodety-studio-storage-persistence/);
assert.match(runtimeSource, /add_action\('admin_head'/);
assert.match(runtimeSource, /add_action\('template_redirect'/);
assert.match(runtimeSource, /kodety_studio_inject_storage_persistence_bridge/);
assert.match(runtimeSource, /type:\s*'storage-persistence'/);
assert.match(
  editorShellSource,
  /kodety_download_editor_project/,
  'The WordPress shell must expose the canonical editable-project ZIP endpoint.',
);
assert.match(builderSource, /persistExactWordPressDraft\(current, true\)/);
assert.match(builderSource, /project-export\.request/);
assert.match(builderSource, /new Blob|response\.blob\(\)/);
assert.match(combinedSource, /new MessageChannel\(\)/);
assert.match(combinedSource, /project-export\.request/);
assert.match(combinedSource, /respondToStudioPreviewRequest/);
assert.match(combinedSource, /client\.request\s*\(/, 'The live Site tab must proxy public WordPress requests through the active Playground runtime.');
assert.match(combinedSource, /__kodety_preview__/);
assert.match(combinedSource, /studioSitePreviewUrl\(project, language\)/);
assert.match(combinedSource, /allow="clipboard-read \*; clipboard-write \*; cross-origin-isolated \*"/);
assert.match(combinedSource, /RuntimeLoading stage=\{stage\} detail=\{detail\} restoring=\{initialRestoringRef\.current\}/);
assert.match(runtimeSource, /defineConstant\('KODETY_BROWSER_STUDIO_RUNTIME', project\.id\)/);
assert.match(combinedSource, /setSiteLanguage/);
assert.match(combinedSource, /project\.wordpressLocale === 'pt_BR'/);
assert.match(combinedSource, /StudioOnboarding/);
assert.match(combinedSource, /onboardingVersion/);
assert.match(combinedSource, /Português \(Brasil\)/);
assert.match(combinedSource, /English \(US\)/);
assert.match(combinedSource, /studioBridgeWindowRef/);
assert.match(combinedSource, /href="https:\/\/dash\.kodety\.com\/"[\s\S]*?rel="noopener noreferrer"/);
assert.match(combinedSource, /href="https:\/\/kodety\.com\/discord"[\s\S]*?rel="noopener noreferrer"/);
assert.match(combinedSource, /function DiscordLogo/);
assert.match(combinedSource, /Comprar licença/);
assert.match(combinedSource, /captureSiteThumbnail\(\)/);
assert.match(combinedSource, /message\.type === 'project-published'/);
assert.match(combinedSource, /project-preview-placeholder/);
assert.match(builderSource, /type: 'project-published'/);
assert.match(builderSource, /topbarWp\?\.studio\?\.enabled/);

// The production directory must be portable to an FTP subdirectory: shell
// assets, manifest entries and CSS dependencies all stay relative.
const builtManifest = JSON.parse(await readText(builtManifestPath));
assert.deepEqual(builtManifest, sourceManifest, 'The built PWA manifest must match the reviewed source manifest.');
const builtIndex = await readText(path.join(builtDirectory, 'index.html'));
for (const url of htmlAssetUrls(builtIndex)) {
  if (/^(?:data:|blob:|#)/i.test(url)) continue;
  for (const candidate of url.split(',').map(value => value.trim().split(/\s+/)[0]).filter(Boolean)) {
    assertPortableUrl(candidate, `dist/index.html asset ${candidate}`);
  }
}
const manifestUrls = [
  builtManifest.id,
  builtManifest.start_url,
  builtManifest.scope,
  ...(builtManifest.icons || []).map(icon => icon.src),
].filter(Boolean);
for (const url of manifestUrls) assertPortableUrl(url, `dist/manifest.webmanifest URL ${url}`);
for (const icon of builtManifest.icons || []) {
  const iconPath = path.join(builtDirectory, icon.src.replace(/^\.\//, ''));
  assert.ok(await fileExists(iconPath), `Built PWA icon is missing: ${icon.src}.`);
}

const serviceWorkerPath = path.join(builtDirectory, 'service-worker.js');
const serviceWorkerSource = await readText(serviceWorkerPath);
const offlineManifest = JSON.parse(await readText(path.join(builtDirectory, 'offline-manifest.json')));
assert.match(offlineManifest.version, /^[a-f\d]+$/);
assert.ok(serviceWorkerSource.includes(`const BUILD_ID = '${offlineManifest.version}'`), 'The worker must be pinned to this exact offline build.');
assert.doesNotMatch(serviceWorkerSource, /__KODETY_BUILD_ID__/);
assert.match(serviceWorkerSource, /kodety-studio-shell-v\d+-/);
assert.match(serviceWorkerSource, /\w+\.startsWith\('kodety-studio-shell-'\)/, 'Cache cleanup must preserve unrelated applications.');
const offlineFiles = new Set(offlineManifest.files);
for (const file of await listFiles(path.join(builtDirectory, 'assets'))) {
  assert.ok(offlineFiles.has(`./assets/${file}`), `Offline preparation must include the unopened editor asset ${file}.`);
}
for (const file of offlineFiles) {
  assertPortableUrl(file, `Offline asset ${file}`);
  const assetPath = path.join(builtDirectory, file === './' ? 'index.html' : file);
  assert.ok(await fileExists(assetPath), `Offline manifest refers to a missing file: ${file}.`);
  assert.equal(offlineManifest.integrity[file], sha256(await fs.readFile(assetPath)), `Offline integrity must match the published bytes: ${file}.`);
}
assert.match(serviceWorkerSource, /addEventListener\(\s*['"]install['"]/);
assert.match(serviceWorkerSource, /addEventListener\(\s*['"]activate['"]/);
assert.match(serviceWorkerSource, /addEventListener\(\s*['"]fetch['"]/);
assert.match(serviceWorkerSource, /proxyPreviewRequest/);
assert.match(serviceWorkerSource, /studio\\\.\(\?:js\|css\)\|kodety\\\.zip/);
assert.match(serviceWorkerSource, /kodety-studio-preview-service-worker/);
assert.match(serviceWorkerSource, /Cache-Control['"],?\s*['"]no-store/);
assert.doesNotMatch(serviceWorkerSource, chromeApiPattern);

for (const file of await listFiles(builtDirectory)) {
  if (!/\.(?:js|mjs|html|css|json|webmanifest)$/i.test(file)) continue;
  const text = await readText(path.join(builtDirectory, file));
  assert.doesNotMatch(text, chromeApiPattern, `Built file ${file} contains a Chrome extension API.`);
  if (file.endsWith('.css')) {
    // The production build combines CSS from lazy routes (including preview).
    // A second, unlayered shell import silently wins over Builder utilities.
    const stylesheet = postcss.parse(text);
    stylesheet.walkRules(rule => {
      if (!rule.selectors?.some(selector => /^(?:button|input|button:focus-visible|input:focus-visible|a:focus-visible)$/.test(selector))) return;
      const shellReset = rule.nodes?.some(node => node.type === 'decl' && (
        (node.prop === 'font' && node.value === 'inherit')
        || (node.prop === 'border' && node.value === '0')
        || (node.prop === 'box-shadow' && node.value.includes('--kodety-accent'))
      ));
      if (!shellReset) return;
      let layer = null;
      for (let node = rule.parent; node; node = node.parent) {
        if (node.type === 'atrule' && node.name === 'layer') { layer = node.params; break; }
      }
      assert.equal(layer, 'base', `${file}: global shell reset ${rule.selector} must not override the shared Builder.`);
    });
    for (const url of cssAssetUrls(text)) {
      if (/^(?:data:|blob:|#)/i.test(url)) continue;
      assertPortableUrl(url, `${file} asset ${url}`);
    }
  }
}

for (const requiredPath of [
  'Dockerfile',
  'nginx.conf',
  'server.mjs',
  'agent-network.mjs',
  'index.html',
  'manifest.webmanifest',
  'manifest.en.webmanifest',
  'service-worker.js',
  'offline-manifest.json',
  'assets/kodety.zip',
]) {
  const stats = await fs.stat(path.join(builtDirectory, requiredPath));
  assert.ok(stats.isFile() && stats.size > 0, `Built web app is missing ${requiredPath}.`);
}
const dockerfileSource = await readText(path.join(builtDirectory, 'Dockerfile'));
const nginxSource = await readText(path.join(builtDirectory, 'nginx.conf'));
const relayServerSource = await readText(path.join(builtDirectory, 'server.mjs'));
assert.match(dockerfileSource, /^FROM node:22-alpine/m);
assert.match(dockerfileSource, /COPY \. \/app\//);
assert.match(dockerfileSource, /EXPOSE 80/);
assert.match(dockerfileSource, /HEALTHCHECK[\s\S]*?http:\/\/127\.0\.0\.1\/_health/);
assert.match(dockerfileSource, /CMD \["node", "server\.mjs"\]/);
assert.match(nginxSource, /try_files \$uri \$uri\/ \/index\.html/);
assert.match(nginxSource, /frame-src 'self' blob: https:/, 'The shared HTML canvas and WordPress runtime must be allowed.');
assert.match(nginxSource, /connect-src 'self' https: blob: data:/, 'HTML preview resources and runtime APIs must be allowed.');
assert.match(nginxSource, /clipboard-read=\(self \\"https:\/\/playground\.wordpress\.net\\"\)/);
assert.match(nginxSource, /clipboard-write=\(self \\"https:\/\/playground\.wordpress\.net\\"\)/);
assert.match(nginxSource, /studio\\\.js\|studio\\\.css\|kodety\\\.zip/);
assert.match(relayServerSource, /__kodety_mcp__\/v1\/projects\//);
assert.match(relayServerSource, /bridge\/connect/);
assert.match(relayServerSource, /bridge\/poll/);
assert.match(relayServerSource, /bridge\/respond/);
assert.match(relayServerSource, /timingSafeEqual/);
assert.match(relayServerSource, /FORWARDED_REQUEST_HEADERS/);
assert.match(relayServerSource, /FORWARDED_RESPONSE_HEADERS/);
assert.equal(await fileExists(path.join(builtDirectory, 'manifest.json')), false, 'Do not package an extension manifest.');
assert.equal(await fileExists(path.join(builtDirectory, 'background.js')), false, 'Do not package extension background code.');

const authoritativeArchivePath = path.join(
  repositoryRoot,
  `Wordpress/dist/${kodetyVersion.replaceAll('.', '_')}.zip`,
);
const authoritativePlugin = await fs.readFile(authoritativeArchivePath);
const builtPlugin = await fs.readFile(path.join(builtDirectory, 'assets/kodety.zip'));
assert.equal(
  sha256(builtPlugin),
  sha256(authoritativePlugin),
  `Built assets/kodety.zip must be byte-identical to Wordpress/dist/${kodetyVersion.replaceAll('.', '_')}.zip.`,
);

// The Docker artifact is an exact, flat-root mirror of dist. This catches stale
// files, nested top-level folders and accidentally packaged development files.
const outputArchive = await fs.readFile(outputArchivePath);
const packagedZip = await JSZip.loadAsync(outputArchive);
const packagedFiles = Object.values(packagedZip.files)
  .filter(entry => !entry.dir)
  .map(entry => entry.name)
  .sort();
const builtFiles = (await listFiles(builtDirectory)).sort();
assert.deepEqual(packagedFiles, builtFiles, 'The Docker ZIP must contain exactly the current dist files at its root.');
assert.ok(packagedZip.file('index.html'), 'The Docker ZIP must expose index.html at its root.');
assert.ok(
  packagedZip.file('assets/studio.js')?.date.getFullYear() > 2020,
  'The Docker ZIP must preserve current build timestamps so EasyPanel replaces stable entry files.',
);
assert.ok(packagedZip.file('Dockerfile'), 'The deployment ZIP must expose Dockerfile at its root.');
assert.ok(packagedZip.file('nginx.conf'), 'The deployment ZIP must expose nginx.conf at its root.');
assert.ok(packagedZip.file('server.mjs'), 'The deployment ZIP must expose the MCP relay server at its root.');
assert.ok(packagedZip.file('cloudflare-deploy.mjs'), 'The deployment ZIP must include the Cloudflare Pages transport.');
assert.ok(packagedZip.file('manifest.webmanifest'));
assert.ok(packagedZip.file('LICENSE'), 'Deployments must include the project license.');
assert.ok(packagedZip.file('THIRD_PARTY_NOTICES.md'), 'Deployments must retain third-party notices.');
assert.ok(packagedFiles.every(file => !file.startsWith('studio-cloud')), 'Private hosted cloud modules must not ship.');
assert.ok(packagedZip.file('service-worker.js'));
assert.ok(packagedZip.file('assets/kodety.zip'));
assert.ok(packagedFiles.every(file => !file.startsWith('/') && !/(?:^|\/)\.\.(?:\/|$)/.test(file)));
assert.ok(packagedFiles.every(file => !file.startsWith('__MACOSX/') && !file.endsWith('/.DS_Store')));

for (const file of builtFiles) {
  const packagedEntry = packagedZip.file(file);
  assert.ok(packagedEntry, `Docker ZIP is missing ${file}.`);
  const [builtBytes, packagedBytes] = await Promise.all([
    fs.readFile(path.join(builtDirectory, file)),
    packagedEntry.async('nodebuffer'),
  ]);
  assert.equal(sha256(packagedBytes), sha256(builtBytes), `Docker ZIP contains stale bytes for ${file}.`);
}

console.log(
  `Kodety Studio web contract passed: ${builtFiles.length} deploy files, plugin ${kodetyVersion}, Docker ZIP ${sha256(outputArchive)}.`,
);
