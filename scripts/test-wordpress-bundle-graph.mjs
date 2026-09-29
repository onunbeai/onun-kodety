import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORDPRESS_ROUTE_BUDGETS } from './wordpress-performance-budget.mjs';

await import('./test-wordpress-integration-boundary.mjs');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, 'Wordpress/kodety/assets/manifest.json');
const manifestDirectory = path.dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const chunkModuleManifestPath = process.env.KODETY_WORDPRESS_CHUNK_MANIFEST || '';

const RAW_BUDGET_BYTES = WORDPRESS_ROUTE_BUDGETS.settings.javascript.rawBytes;
const GZIP_BUDGET_BYTES = WORDPRESS_ROUTE_BUDGETS.settings.javascript.gzipBytes;

const forbiddenEntryPattern = /(?:thumbnail-capture|apps[/\\]airtable|appSettingsRepository)/i;
const forbiddenEntries = Object.entries(manifest)
  .filter(([key, entry]) => forbiddenEntryPattern.test(
    [key, entry.name, entry.src, entry.file].filter(Boolean).join(' '),
  ))
  .map(([key]) => key);
assert.deepEqual(
  forbiddenEntries,
  [],
  `WordPress manifest contains removed integration entries: ${forbiddenEntries.join(', ')}`,
);

function findEntry(label) {
  const matches = Object.entries(manifest).filter(
    ([key, entry]) => key === label || entry.name === label || entry.src === label,
  );
  assert.equal(matches.length, 1, `Expected exactly one manifest entry for ${label}, found ${matches.length}.`);
  return matches[0][0];
}

const seedKeys = [
  findEntry('Wordpress/editor/main.tsx'),
  findEntry('WordPressSettingsWorkspace'),
  findEntry('HtmlProjectSettingsHost'),
  findEntry('HtmlProjectSettings'),
];
const settingsPanelKey = seedKeys.at(-1);

function manifestClosure(seeds, { includeDynamic = false } = {}) {
  const pending = [...seeds];
  const visited = new Set();

  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    const entry = manifest[key];
    assert.ok(entry, `Static import ${key} is missing from the WordPress manifest.`);
    visited.add(key);
    for (const importedKey of entry.imports ?? []) pending.push(importedKey);
    if (includeDynamic) {
      for (const importedKey of entry.dynamicImports ?? []) pending.push(importedKey);
    }
  }

  return visited;
}

const settingsClosure = manifestClosure(seedKeys);
const forbiddenChunkPattern =
  /project-io|editor-live-dom-helpers|motion-vendor|HtmlProjectEditor|useComponentsStore|useEditorStore|usePagesStore|code-editor-core/i;
const forbiddenChunks = [...settingsClosure].filter(key => {
  const entry = manifest[key];
  return forbiddenChunkPattern.test([key, entry.name, entry.src, entry.file].filter(Boolean).join(' '));
});

assert.deepEqual(
  forbiddenChunks,
  [],
  `Settings static closure contains builder-heavy chunks: ${forbiddenChunks.join(', ')}`,
);

let chunkModules = null;
if (chunkModuleManifestPath) {
  chunkModules = JSON.parse(await readFile(chunkModuleManifestPath, 'utf8'));
  assert.ok(
    chunkModules && typeof chunkModules === 'object' && !Array.isArray(chunkModules),
    'WordPress chunk module manifest must be an object.',
  );
  const manifestJavascriptFiles = [...new Set(
    Object.values(manifest)
      .map(entry => entry?.file)
      .filter(file => typeof file === 'string' && /\.m?js$/i.test(file)),
  )].sort();
  const moduleManifestFiles = Object.keys(chunkModules).sort();
  assert.deepEqual(
    moduleManifestFiles,
    manifestJavascriptFiles,
    'WordPress chunk module manifest is stale or does not cover every emitted JavaScript chunk.',
  );
  for (const [file, modules] of Object.entries(chunkModules)) {
    assert.ok(Array.isArray(modules), `WordPress chunk module entry must be an array: ${file}.`);
  }
  const forbiddenModulePattern = new RegExp([
    '/lib/html-editor/(?:project-io|editor-live-dom-helpers)\\.(?:ts|tsx)',
    '/app/\\(builder\\)/kodety/html-editor/components/HtmlProjectEditor\\.tsx',
    '/stores/(?:useComponentsStore|useEditorStore|usePagesStore)\\.ts',
    '/components/ui/code-editor\\.tsx',
    '/node_modules/(?:motion|swiper)/',
  ].join('|'), 'i');
  const forbiddenModules = [];
  for (const key of settingsClosure) {
    const file = manifest[key]?.file;
    if (typeof file !== 'string') continue;
    const modules = chunkModules[file];
    for (const moduleId of modules) {
      if (forbiddenModulePattern.test(String(moduleId).replaceAll('\\', '/'))) {
        forbiddenModules.push(`${file}: ${moduleId}`);
      }
    }
  }
  assert.deepEqual(
    forbiddenModules,
    [],
    `Settings static closure hides builder-heavy modules inside shared chunks:\n${forbiddenModules.join('\n')}`,
  );

  const forbiddenRuntimeModulePattern = new RegExp([
    '(?:^|/)lib/apps/airtable/',
    '(?:^|/)lib/client/thumbnail-capture\\.tsx',
    '(?:^|/)lib/repositories/appSettingsRepository\\.ts',
    '(?:^|/)lib/supabase-browser\\.ts',
    '(?:^|/)lib/supabase-server\\.ts',
    '(?:^|/)lib/realtime-channel\\.ts',
    '(?:^|/)lib/next-font-library-transport\\.ts',
    '(?:^|/)lib/install-next-editor-platform-services\\.ts',
    '(?:^|/)stores/useAuthStore\\.ts',
    '(?:^|/)node_modules/@supabase/',
    '(?:^|/)node_modules/next/',
  ].join('|'), 'i');
  const forbiddenRuntimeModules = [];
  for (const [file, modules] of Object.entries(chunkModules)) {
    for (const moduleId of modules) {
      if (forbiddenRuntimeModulePattern.test(String(moduleId).replaceAll('\\', '/'))) {
        forbiddenRuntimeModules.push(`${file}: ${moduleId}`);
      }
    }
  }
  assert.deepEqual(
    forbiddenRuntimeModules,
    [],
    `WordPress browser bundle contains non-WordPress backend modules:\n${forbiddenRuntimeModules.join('\n')}`,
  );
}

const runtimeEntryKeys = Object.entries(manifest)
  .filter(([, entry]) => entry?.isEntry === true)
  .map(([key]) => key);
assert.ok(runtimeEntryKeys.length > 0, 'WordPress manifest does not expose a runtime entry.');
const runtimeClosure = manifestClosure(runtimeEntryKeys, { includeDynamic: true });
const browserAgentAssets = Object.entries(manifest).filter(([, entry]) => /^assets\/browser-agent-runtime-[\w-]+\.mjs$/.test(entry?.file || ''));
assert.equal(browserAgentAssets.length, 1, 'The WordPress package must contain one browser Agent program.');
for (const [key, entry] of browserAgentAssets) {
  assert.ok(!runtimeClosure.has(key), 'The Node Agent program must never execute in the browser module graph.');
  const program = await readFile(path.join(manifestDirectory, entry.file), 'utf8');
  assert.match(program, /node:readline/, 'The Agent asset must retain its process protocol.');
  assert.match(program, /deviceauth\/usercode/, 'The Agent asset must bundle its device OAuth implementation.');
}
const emittedJavascriptFiles = new Set(
  [...runtimeClosure]
    .map(key => manifest[key]?.file)
    .filter(file => typeof file === 'string' && /\.m?js$/i.test(file)),
);
const emittedJavascript = new Map();
for (const file of emittedJavascriptFiles) {
  emittedJavascript.set(file, await readFile(path.join(manifestDirectory, file), 'utf8'));
}

const forbiddenCompiledPatterns = [
  ['Airtable API host', /api\.airtable\.com/i],
  [
    'legacy component thumbnail endpoint',
    /\/kodety\/api\/components\/(?:[^/\s"'`\\]+|\$\{[^}]+\})\/thumbnail/i,
  ],
];
for (const [label, pattern] of forbiddenCompiledPatterns) {
  const offenders = [...emittedJavascript]
    .filter(([, contents]) => pattern.test(contents))
    .map(([file]) => file);
  assert.deepEqual(
    offenders,
    [],
    `${label} remains in emitted WordPress JavaScript: ${offenders.join(', ')}`,
  );
}

const legacyApiRoutePattern = /\/kodety\/api\/[^\s"'`\\<>)]*/g;
assert.deepEqual(
  '/kodety/api/'.match(legacyApiRoutePattern),
  ['/kodety/api/'],
  'The legacy API detector must reject a dynamically concatenated route prefix.',
);
const legacyApiOffenders = [];
for (const [file, contents] of emittedJavascript) {
  const routes = [...new Set(contents.match(legacyApiRoutePattern) ?? [])].sort();
  if (routes.length === 0) continue;
  const modules = (chunkModules?.[file] ?? [])
    .map(moduleId => String(moduleId).replaceAll('\\', '/'))
    .slice(0, 40);
  legacyApiOffenders.push(
    `${file}\n  routes: ${routes.join(', ')}\n  modules: ${
      modules.length > 0 ? modules.join(', ') : '(chunk module manifest unavailable)'
    }`,
  );
}
assert.deepEqual(
  legacyApiOffenders,
  [],
  `Legacy /kodety/api/* routes remain in the compiled WordPress closure:\n${legacyApiOffenders.join('\n')}`,
);

for (const lazyPanelName of [
  'HtmlMcpSettingsContent',
  'HtmlCustomCodeSettings',
  'HtmlRedirectSettings',
  'HtmlSocialImageBuilder',
]) {
  const lazyPanelKey = findEntry(lazyPanelName);
  assert.ok(
    (manifest[settingsPanelKey].dynamicImports ?? []).includes(lazyPanelKey),
    `${lazyPanelName} must be a dynamic import of HtmlProjectSettings.`,
  );
  assert.ok(
    !settingsClosure.has(lazyPanelKey),
    `${lazyPanelName} must not belong to the Settings static closure.`,
  );

  const inboundReferences = [];
  for (const [ownerKey, entry] of Object.entries(manifest)) {
    for (const relation of ['imports', 'dynamicImports']) {
      if ((entry[relation] ?? []).includes(lazyPanelKey)) inboundReferences.push([ownerKey, relation]);
    }
  }
  assert.deepEqual(
    inboundReferences,
    [[settingsPanelKey, 'dynamicImports']],
    `${lazyPanelName} must only be referenced as a dynamic import of HtmlProjectSettings.`,
  );
}

const javascriptFiles = new Set(
  [...settingsClosure]
    .map(key => manifest[key].file)
    .filter(file => typeof file === 'string' && /\.m?js$/i.test(file)),
);
let rawBytes = 0;
let gzipBytes = 0;

for (const file of javascriptFiles) {
  const contents = await readFile(path.join(manifestDirectory, file));
  rawBytes += contents.byteLength;
  gzipBytes += gzipSync(contents).byteLength;
}

assert.ok(
  rawBytes <= RAW_BUDGET_BYTES,
  `Settings static JS closure is ${rawBytes} raw bytes; budget is ${RAW_BUDGET_BYTES}.`,
);
assert.ok(
  gzipBytes <= GZIP_BUDGET_BYTES,
  `Settings static JS closure is ${gzipBytes} gzip bytes; budget is ${GZIP_BUDGET_BYTES}.`,
);

console.log(
  `WordPress Settings bundle graph passed: ${settingsClosure.size} chunks, ${rawBytes} raw bytes, ${gzipBytes} gzip bytes.`,
);
