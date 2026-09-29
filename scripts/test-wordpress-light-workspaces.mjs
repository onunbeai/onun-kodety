import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

const main = await read('Wordpress/editor/main.tsx');
const settings = await read('Wordpress/editor/WordPressSettingsWorkspace.tsx');
const analytics = await read('Wordpress/editor/WordPressAnalyticsWorkspace.tsx');
const cms = await read('Wordpress/editor/WordPressCmsWorkspace.tsx');
const transport = await read('Wordpress/editor/wordpress-project-surface.ts');
const settingsHost = await read('app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx');
const settingsPanel = await read('app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx');
const socialImageBuilder = await read('app/(builder)/kodety/html-editor/components/HtmlSocialImageBuilder.tsx');
const abPanel = await read('app/(builder)/kodety/html-editor/components/HtmlProjectAnalyticsAbTests.tsx');
const shell = await read('Wordpress/kodety/templates/editor-shell.php');
const plugin = await read('Wordpress/kodety/includes/class-kodety-plugin.php');

assert.match(main, /lazy\(\(\) => import\('\.\/WordPressSettingsWorkspace'\)\)/);
assert.match(main, /lazy\(\(\) => import\('\.\/WordPressAnalyticsWorkspace'\)\)/);
const entryAst = ts.createSourceFile('main.tsx', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const entry = entryAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WordPressEntry');
assert.ok(entry?.body, 'the WordPress entry component must exist');
const workspaceBranches = new Map();
const inspectEntry = node => {
  if (ts.isConditionalExpression(node) && (ts.isJsxSelfClosingElement(node.whenTrue) || ts.isJsxElement(node.whenTrue))) {
    const tag = ts.isJsxSelfClosingElement(node.whenTrue) ? node.whenTrue.tagName : node.whenTrue.openingElement.tagName;
    workspaceBranches.set(tag.getText(entryAst), node.condition.getText(entryAst).replace(/\s+/g, ' '));
  }
  ts.forEachChild(node, inspectEntry);
};
inspectEntry(entry.body);
const cmsAst = ts.createSourceFile('WordPressCmsWorkspace.tsx', cms, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const cmsSurfaces = [];
const inspectCmsSurface = node => {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(cmsAst) === 'data-kodety-agent-surface'
      && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'cms',
  )) cmsSurfaces.push(node);
  ts.forEachChild(node, inspectCmsSurface);
};
inspectCmsSurface(cmsAst);
assert.equal(cmsSurfaces.length, 1, 'CMS context needs exactly one native visual surface to snapshot.');
const cmsSurfaceComponents = [];
const collectCmsSurfaceComponents = node => {
  if (ts.isJsxSelfClosingElement(node)) cmsSurfaceComponents.push(node.tagName.getText(cmsAst));
  ts.forEachChild(node, collectCmsSurfaceComponents);
};
collectCmsSurfaceComponents(cmsSurfaces[0]);
assert.ok(cmsSurfaceComponents.includes('HtmlCmsManager'), 'CMS panel tools must target the mounted manager.');
assert.ok(!cmsSurfaceComponents.includes('HtmlWorkspaceAgentDock'), 'CMS panel tools must not target the Agent composer.');
assert.equal(workspaceBranches.get('WordPressSettingsWorkspace'), "appView === 'settings' || appView === 'kodefy'");
assert.equal(workspaceBranches.get('WordPressAnalyticsWorkspace'), "appView === 'analytics'");
assert.ok(
  main.indexOf("appView === 'analytics'") < main.indexOf('<HtmlProjectEditor runtime="wordpress" />'),
  'Analytics must resolve before the monolithic Builder fallback.',
);

assert.doesNotMatch(settings, /HtmlProjectEditor/);
assert.doesNotMatch(analytics, /HtmlProjectEditor/);
assert.match(settings, /lazy\(\(\) =>[\s\S]*?loadSettingsHost\(\)/);
assert.match(settings, /import\('\.\/wordpress-project-surface'\)/);
assert.doesNotMatch(
  settings,
  /from ['"]@\/lib\/html-editor\/project-io['"]/,
  'The initial Settings workspace chunk must not statically import project-io.',
);
assert.doesNotMatch(
  settings,
  /import(?!\s+type)\s*\{[^}]*\}\s*from ['"]\.\/wordpress-project-surface['"]/,
  'Settings transport must remain behind a dynamic import.',
);
assert.match(settings, /loadWordPressProjectSurface\(config, 'settings'\)/);
assert.match(settings, /persistWordPressProjectSurface\(config, previous, candidate/);
assert.match(settings, /rebaseQueuedWorkspaceProject\(queuedBase, nextProject, previous\.project, authoredAcknowledgementsRef\.current\.get\(previous\.project\)\)/);
assert.match(settings, /allowArchiveFallback: previous\.source === 'full-project'/);
assert.match(settings, /writeReadyRevisionRef\.current !== previous\.workspaceRevision/);
assert.match(settings, /const authoredEpoch = localEpochRef\.current[\s\S]*?writeReadyRevisionRef\.current = -1/);
assert.match(settings, /localEpochRef\.current !== authoredEpoch[\s\S]*?mergeWorkspaceConflictStrict\(nextProject, live, next\.project\)\.project/);
assert.match(settings, /fetchWordPressProjectSurfaceAsset\([\s\S]*?baseline\.workspaceRevision/);
assert.ok(
  settings.indexOf('writeReadyRevisionRef.current !== baseline.workspaceRevision')
    < settings.indexOf('const cachedFile = current?.files[path]'),
  'A cached font/asset must not start a conversion while a save ACK is pending.',
);
assert.match(settings, /fetchCmsSchema[\s\S]*?CMS_SCHEMA_TIMEOUT_MS/);
assert.doesNotMatch(settingsHost, /from ['"]@\/lib\/html-editor\/project-io['"]/);
assert.doesNotMatch(settingsHost, /from ['"]@\/lib\/html-editor\/(?:framer-import|page-rename|social-font-conversion)['"]/);
assert.match(settingsHost, /import\('@\/lib\/html-editor\/page-rename'\)/);
assert.match(settingsHost, /import\('@\/lib\/html-editor\/social-font-conversion'\)/);
assert.match(settingsHost, /sourceFile\.data === undefined && sourceFile\.text === undefined/);
assert.doesNotMatch(settingsPanel, /from ['"]@\/lib\/html-editor\/preview['"]/);
assert.doesNotMatch(settingsPanel, /ProgrammingIcon/);
assert.match(settingsPanel, /lazy\(\(\) =>[\s\S]*?HtmlCustomCodeSettings/);
assert.match(settingsPanel, /lazy\(\(\) =>[\s\S]*?HtmlRedirectSettings/);
assert.doesNotMatch(settingsPanel, /import \{[^}]*HtmlCustomCodeSettings[^}]*\} from/);
assert.doesNotMatch(settingsPanel, /import \{[^}]*HtmlRedirectSettings[^}]*\} from/);
assert.match(settingsPanel, /const HtmlAgentSettings = lazy\(/);
assert.doesNotMatch(settingsPanel, /import \{[^}]*HtmlAgentSettings[^}]*\} from/);
assert.doesNotMatch(settingsPanel, /import(?!\s+type)\s*\{[^}]*\}\s*from ['"]@\/lib\/html-editor\/agent-native-tools['"]/,
  'Settings observes native events without loading the Agent transport before a tool call.');
assert.match(analytics, /if \(view === 'overview'\) return;/);
assert.match(analytics, /view === 'ab-tests'[\s\S]*?loadFullProject\(\)/);
assert.match(analytics, /if \(view === 'ab-tests'\)[\s\S]*?if \(!readOnly[\s\S]*?return;/);
assert.match(analytics, /import\('\.\/wordpress-project-surface'\)/);
assert.match(analytics, /import\('\.\/wordpress-analytics-project-data'\)/);
assert.doesNotMatch(
  analytics,
  /from ['"]@\/lib\/html-editor\/(?:project-io|experiments|editor-live-dom-helpers)['"]/,
  'The initial Analytics workspace chunk must not statically import project-heavy helpers.',
);

assert.match(transport, /SURFACE_CACHE_TTL_MS = 5 \* 60_000/);
assert.match(transport, /wordpress-project-surface:v3/);
assert.match(transport, /surfaceCacheScope[\s\S]*?nonce: config\.nonce[\s\S]*?canEditWorkspace[\s\S]*?canManageAnalytics/);
assert.match(transport, /parsed\.scope !== surfaceCacheScope\(config, surface\)/);
assert.match(transport, /endpoint\.searchParams\.set\('revision', String\(cached\.workspaceRevision\)\)/);
assert.match(transport, /payload\.notModified === true/);
assert.match(transport, /payload\.requiresFullProject === true/);
assert.match(transport, /return loadFullWordPressProject\(config, signal\)/);
assert.match(transport, /SURFACE_REQUEST_TIMEOUT_MS = 12_000/);
assert.match(transport, /createWordPressDraftDelta\(previous\.project, nextProject/);
assert.match(transport, /allowArchiveFallback/);
assert.match(transport, /'X-Kodety-Delta-Root': 'project'/);
assert.match(transport, /endpoint\.searchParams\.set\('revision', String\(expectedRevision\)\)/);
assert.match(transport, /safeRevision\(payload\.workspaceRevision\) !== expectedRevision/);
assert.match(transport, /candidate\.lazyAsset !== true/);
assert.match(transport, /SURFACE_ASSET_REQUEST_TIMEOUT_MS = 30_000/);
assert.match(transport, /inFlightSurfaceAssetRequests/);
assert.match(settings, /cachedFile && \(cachedFile\.data !== undefined \|\| cachedFile\.text !== undefined\)/);
assert.match(settings, /useFontsStore\.getState\(\)\.syncProjectFonts\(project\)/);
assert.match(socialImageBuilder, /useFontsStore\.getState\(\)\.syncProjectFonts\(\{/);
assert.match(transport, /readCachedWordPressProjectSurface[\s\S]*?allowStale/);
assert.match(transport, /payload\?\.success !== true/);
assert.match(transport, /await import\('@\/lib\/html-editor\/project-io'\)/);
assert.match(
  transport,
  /const \{ importZip, sanitizeProjectPriorities \}[\s\S]*?sanitizeProjectPriorities\([\s\S]*?await importZip/,
  'The full fallback must hydrate coded-build and Membership transport projections before Settings can edit them.',
);
assert.match(transport, /import\('@\/lib\/html-editor\/wordpress-draft-delta'\)/);
assert.doesNotMatch(
  transport,
  /import(?!\s+type)\s*\{[^}]*\}\s*from ['"]@\/lib\/html-editor\/project-io['"]/,
  'ZIP/compiler code must not enter the lightweight transport chunk statically.',
);

assert.match(shell, /'projectSurfaceUrl'\s*=>/);
assert.match(shell, /'projectSurfaceAssetUrl'\s*=>/);
assert.match(plugin, /register_rest_route\('kodety\/v1', '\/project\/surface'/);
assert.match(plugin, /register_rest_route\('kodety\/v1', '\/project\/surface\/asset'/);
assert.match(plugin, /project_surface_includes_file/);
assert.match(plugin, /surfacePaths/);
assert.match(plugin, /'generatedBy' => 'kodety-server'/);
assert.match(plugin, /'version' => 3/);
assert.match(plugin, /'lazyAsset' => true/);
assert.match(plugin, /'notModified' => true/);
assert.match(plugin, /with_workspace_read_lock[\s\S]*?project_surface_locked/);
assert.match(plugin, /with_workspace_read_lock[\s\S]*?project_surface_asset_locked/);
assert.match(plugin, /microtime\(true\) \+ 3\.0[\s\S]*?LOCK_SH \| LOCK_NB/);
assert.match(plugin, /\.incode\/membership\/runtime\.json[\s\S]*?\.incode\/coded-build\.json/);
assert.match(plugin, /PROJECT_SURFACE_ASSET_MAX_BYTES = 20 \* 1024 \* 1024/);
assert.match(plugin, /write_preview_file_manifest\(\$staging_root\)/);
assert.match(plugin, /write_preview_file_manifest\(\$this->collapse_single_root\(\$workspace_staging\)\)/);
assert.match(plugin, /write_preview_file_manifest\(\$workspace_root\)/);
assert.match(plugin, /PROJECT_DELTA_MAX_BODY_BYTES/);
assert.match(plugin, /workspaceRevision/);
assert.match(abPanel, /setServerExperiments\(fetchedExperiments\)/);
assert.match(abPanel, /ANALYTICS_EXPERIMENT_REQUEST_TIMEOUT_MS = 20_000/);
assert.match(abPanel, /detailExperiments = selectedExperiment \? \[selectedExperiment\] : \[\]/);

const sourceExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
async function resolveSource(fromFile, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const clean = specifier.replace(/\?.*$/, '');
  const base = clean.startsWith('@/')
    ? path.join(root, clean.slice(2))
    : path.resolve(path.dirname(fromFile), clean);
  const candidates = [
    ...sourceExtensions.map(extension => `${base}${extension}`),
    ...sourceExtensions.slice(1).map(extension => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue resolving the local source module.
    }
  }
  return null;
}

async function localDependencyGraph(entry) {
  const pending = [path.join(root, entry)];
  const visited = new Set();
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, 'utf8');
    importPattern.lastIndex = 0;
    for (const match of source.matchAll(importPattern)) {
      const resolved = await resolveSource(current, match[1] || match[2] || '');
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return visited;
}

for (const entry of [
  'Wordpress/editor/WordPressSettingsWorkspace.tsx',
  'Wordpress/editor/WordPressAnalyticsWorkspace.tsx',
]) {
  const graph = await localDependencyGraph(entry);
  const monolith = [...graph].filter(file => path.basename(file).startsWith('HtmlProjectEditor.'));
  assert.deepEqual(monolith, [], `${entry} must own a chunk graph without HtmlProjectEditor.`);
}

console.log('WordPress lightweight Settings/Analytics workspace contracts passed.');
