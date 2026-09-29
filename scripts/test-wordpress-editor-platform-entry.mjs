import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entryPath = path.join(root, 'Wordpress/editor/main.tsx');
const entryConfigPath = path.join(root, 'Wordpress/editor/wordpress-entry-config.ts');
const wordpressTransportPath = path.join(
  root,
  'Wordpress/editor/wordpress-font-library-transport.ts',
);

const [entrySource, entryConfigSource, wordpressTransportSource, currentPackage] = await Promise.all([
  readFile(entryPath, 'utf8'),
  readFile(entryConfigPath, 'utf8'),
  readFile(wordpressTransportPath, 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
]);

function parse(source, fileName = 'wordpress-entry.tsx') {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function runtimeModuleSpecifiers(source, fileName) {
  const specifiers = [];
  const ast = parse(source, fileName);
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const onlyTypeBindings = clause
        && !clause.name
        && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.every(element => element.isTypeOnly);
      if (!clause?.isTypeOnly && !onlyTypeBindings) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node)
      && !node.isTypeOnly
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return specifiers;
}

function callCount(source, name) {
  let count = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return count;
}

function canonical(value) {
  return String(value).replaceAll('\\/', '/').replaceAll('\\', '/');
}

function staticStringValue(node) {
  if (ts.isParenthesizedExpression(node)) return staticStringValue(node.expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    return left === null || right === null ? null : `${left}${right}`;
  }
  return null;
}

function assertNoLegacyRuntimeSource(source, fileName, { inspectRoutes = true } = {}) {
  const ast = parse(source, fileName);
  const specifiers = runtimeModuleSpecifiers(source, fileName);
  const nextImports = specifiers.filter(specifier => (
    /(^|\/)next(?:\/|$)/i.test(specifier)
    || /node_modules\/next/i.test(specifier)
    || /(?:install-next-editor-platform-services|next-font-library-transport)/i.test(specifier)
  ));
  assert.deepEqual(nextImports, [], `${fileName} reaches a Next-only runtime: ${nextImports.join(', ')}`);

  if (!inspectRoutes) return;

  const visit = node => {
    const value = staticStringValue(node);
    if (value !== null && canonical(value).toLowerCase().includes('/kodety/api/')) {
      assert.fail(`${fileName} contains a legacy browser route: ${canonical(value)}`);
    }
    if (
      ts.isTemplateExpression(node)
      && canonical(node.head.text).toLowerCase().includes('/kodety/api/')
    ) {
      assert.fail(`${fileName} contains a legacy browser route template`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

function assertEntryComposition(source, configSource) {
  assert.match(
    configSource,
    /\bnonce: string;/,
    'the canonical WordPress entry config must expose the REST nonce',
  );
  assert.match(
    configSource,
    /\bgoogleFontsUrl\?: string;/,
    'the canonical WordPress entry config must expose the Google catalog endpoint',
  );
  assert.match(
    configSource,
    /\bmediaUploadUrl\?: string;/,
    'the canonical WordPress entry config must expose the media upload endpoint',
  );
  assertNoLegacyRuntimeSource(source, 'Wordpress/editor/main.tsx');
  assertNoLegacyRuntimeSource(wordpressTransportSource, 'wordpress-font-library-transport.ts');

  const imports = runtimeModuleSpecifiers(source, 'Wordpress/editor/main.tsx');
  assert.ok(
    imports.includes('../../lib/editor-platform-services'),
    'the WordPress entry must install through the transport-neutral registry',
  );
  assert.ok(
    imports.includes('./wordpress-font-library-transport'),
    'the WordPress entry must import only the WordPress font transport',
  );
  assert.equal(callCount(source, 'createWordPressFontLibraryTransport'), 1);
  assert.equal(callCount(source, 'installFontLibraryTransport'), 1);
  assert.doesNotMatch(source, /__resetFontLibraryTransportForTests/);

  assert.match(
    source,
    /createWordPressFontLibraryTransport\(\{\s*googleFontsUrl: entryConfig\?\.googleFontsUrl,\s*adobeFontsUrl: entryConfig\?\.adobeFontsUrl,\s*adobeFontsSyncUrl: entryConfig\?\.adobeFontsSyncUrl,\s*mediaUploadUrl: entryConfig\?\.mediaUploadUrl,\s*nonce: entryConfig\?\.nonce,\s*\}, \{[\s\S]*?fetch: \(input, init\) => window\.fetch\(input, init\),[\s\S]*?getItem: key => window\.localStorage\.getItem\(key\),[\s\S]*?setItem: \(key, value\) => window\.localStorage\.setItem\(key, value\)/,
    'the WordPress transport must receive only injected config, intercepted fetch and lazy storage access',
  );
  const creationStart = source.indexOf('const wordpressFontLibraryTransport = createWordPressFontLibraryTransport(');
  const installStart = source.indexOf('installFontLibraryTransport(wordpressFontLibraryTransport);');
  const fetchWrapperStart = source.indexOf('window.fetch = async ');
  const fetchWrapperEnd = source.indexOf('\n};', fetchWrapperStart);
  assert.ok(fetchWrapperStart >= 0 && fetchWrapperEnd > fetchWrapperStart);
  assert.ok(creationStart > fetchWrapperEnd, 'transport creation must follow the complete fetch wrapper');
  assert.ok(installStart > creationStart, 'the created transport must be installed exactly once');

  for (const lazyConsumer of [
    'const HtmlProjectEditor = lazy(',
    'const WordPressCmsWorkspace = lazy(',
    'const WordPressSettingsWorkspace = lazy(',
    'const WordPressAnalyticsWorkspace = lazy(',
  ]) {
    const lazyStart = source.indexOf(lazyConsumer);
    assert.ok(lazyStart > installStart, `${lazyConsumer} must be declared only after transport installation`);
  }
  assert.doesNotMatch(
    source.slice(creationStart, installStart),
    /\bnativeFetch\b/,
    'the transport must not bypass nonce refresh, lock, sharing or observability interception',
  );
}

assertEntryComposition(entrySource, entryConfigSource);

const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
async function resolveLocalSource(fromFile, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const clean = specifier.replace(/\?.*$/, '');
  const base = clean.startsWith('@/')
    ? path.join(root, clean.slice(2))
    : path.resolve(path.dirname(fromFile), clean);
  const explicitExtension = path.extname(base);
  if (explicitExtension && !sourceExtensions.includes(explicitExtension)) return null;
  const candidates = explicitExtension
    ? [base]
    : [
        ...sourceExtensions.map(extension => `${base}${extension}`),
        ...sourceExtensions.map(extension => path.join(base, `index${extension}`)),
      ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}

async function wordpressSourceClosure() {
  const pending = [entryPath];
  const visited = new Set();
  const predecessor = new Map([[entryPath, null]]);
  const routeSensitiveSources = new Set([
    'Wordpress/editor/main.tsx',
    'Wordpress/editor/wordpress-font-library-transport.ts',
    'lib/editor-platform-services.ts',
    'stores/useFontsStore.ts',
  ]);
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, 'utf8');
    const relative = path.relative(root, current);
    assertNoLegacyRuntimeSource(source, relative, {
      inspectRoutes: routeSensitiveSources.has(relative),
    });
    for (const specifier of runtimeModuleSpecifiers(source, current)) {
      const resolved = await resolveLocalSource(current, specifier);
      if (resolved && !visited.has(resolved)) {
        if (!predecessor.has(resolved)) predecessor.set(resolved, { from: current, specifier });
        pending.push(resolved);
      }
    }
  }
  return { predecessor, visited };
}

function dependencyChain(target, predecessor) {
  const chain = [];
  let current = target;
  while (current) {
    const edge = predecessor.get(current);
    chain.push(path.relative(root, current));
    current = edge?.from || null;
  }
  return chain.reverse().join(' -> ');
}

const { predecessor: sourcePredecessor, visited: sourceClosure } = await wordpressSourceClosure();
for (const forbiddenRelativePath of [
  'lib/api.ts',
  'lib/install-next-editor-platform-services.ts',
  'lib/next-font-library-transport.ts',
  'lib/version-tracking.ts',
  'lib/client/cssGenerator.ts',
  'hooks/use-undo-redo.ts',
  'stores/useColorVariablesStore.ts',
  'stores/useComponentsStore.ts',
  'stores/useLayerStylesStore.ts',
  'stores/usePagesStore.ts',
  'stores/useVersionsStore.ts',
]) {
  const forbiddenPath = path.join(root, forbiddenRelativePath);
  assert.equal(
    sourceClosure.has(forbiddenPath),
    false,
    `the WordPress source closure reaches ${forbiddenRelativePath}: ${dependencyChain(forbiddenPath, sourcePredecessor)}`,
  );
}
assert.ok(
  sourceClosure.has(path.join(root, 'stores/useFontsStore.ts')),
  'the source closure test must exercise the real fail-closed font store consumer',
);
assert.ok(
  sourceClosure.has(wordpressTransportPath),
  'the source closure must include the WordPress font transport',
);
assert.equal(
  [...sourceClosure].some(file => file.endsWith('lib/next-font-library-transport.ts')),
  false,
  'the WordPress source closure must not include the Next font transport',
);

const gateScript = currentPackage.scripts?.['editor-platform:test'] || '';
for (const testFile of [
  'test-editor-platform-services.mjs',
  'test-wordpress-editor-platform-entry.mjs',
  'test-sizing-controls-boundary.mjs',
  'test-color-variable-capability.mjs',
  'test-font-library-store.mjs',
  'test-font-picker-delete.mjs',
]) {
  assert.ok(gateScript.includes(testFile), `${testFile} must remain in editor-platform:test`);
}
assert.match(
  currentPackage.scripts?.['wordpress:quality:test'] || '',
  /npm run editor-platform:test/,
  'the WordPress quality gate must execute the platform seam and entry regressions',
);

const withoutInstall = entrySource.replace(
  'installFontLibraryTransport(wordpressFontLibraryTransport);',
  '',
);
assert.notEqual(withoutInstall, entrySource);
assert.throws(
  () => assertEntryComposition(withoutInstall, entryConfigSource),
  /Expected values to be strictly equal|installed exactly once/,
  'removing the pre-lazy installation must fail the regression',
);

const lazyEditorMatch = entrySource.match(
  /const HtmlProjectEditor = lazy\(\(\) =>\s*import\('\.\.\/\.\.\/app\/\(builder\)\/kodety\/html-editor\/components\/HtmlProjectEditor'\),\s*\);/,
);
assert.ok(lazyEditorMatch, 'the canonical lazy editor declaration must be identifiable');
const earlyLazyConsumer = `${lazyEditorMatch[0]}\n${entrySource.replace(lazyEditorMatch[0], '')}`;
assert.throws(
  () => assertEntryComposition(earlyLazyConsumer, entryConfigSource),
  /must be declared only after transport installation/,
  'moving a lazy font consumer before installation must fail the regression',
);

const nativeFetchMutation = entrySource.replace(
  'fetch: (input, init) => window.fetch(input, init),',
  'fetch: (input, init) => nativeFetch(input, init),',
);
assert.notEqual(nativeFetchMutation, entrySource);
assert.throws(
  () => assertEntryComposition(nativeFetchMutation, entryConfigSource),
  /intercepted fetch|must not bypass/,
  'bypassing the canonical fetch wrapper must fail the regression',
);

assert.throws(
  () => assertEntryComposition(
    `${entrySource}\nvoid import('../../lib/next-font-library-transport');`,
    entryConfigSource,
  ),
  /Next-only runtime/,
  'a Next transport import must fail the WordPress entry boundary',
);
assert.throws(
  () => assertNoLegacyRuntimeSource(
    `${wordpressTransportSource}\nvoid fetch('/kodety' + '/api/fonts');`,
    'legacy-route-mutation.ts',
  ),
  /legacy browser route/,
  'a hidden legacy fallback must fail the WordPress transport boundary',
);
assert.throws(
  () => assertEntryComposition(
    entrySource,
    entryConfigSource.replace('  googleFontsUrl?: string;\n', ''),
  ),
  /must expose the Google catalog/,
  'removing googleFontsUrl from the canonical entry config must fail the regression',
);

console.log(`WordPress editor platform entry passed (${sourceClosure.size} source modules, zero legacy/Next runtime edges).`);
