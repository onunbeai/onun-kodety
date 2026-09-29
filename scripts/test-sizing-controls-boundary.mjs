import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const paths = {
  core: path.join(
    root,
    'app/(builder)/kodety/html-editor/ycode-style/SizingControlsCore.tsx',
  ),
  legacy: path.join(
    root,
    'app/(builder)/kodety/html-editor/ycode-style/SizingControls.tsx',
  ),
  htmlAdapter: path.join(
    root,
    'app/(builder)/kodety/html-editor/components/HtmlKodetyStyleControls.tsx',
  ),
};

const [coreSource, legacySource, htmlAdapterSource] = await Promise.all(
  Object.values(paths).map(filePath => readFile(filePath, 'utf8')),
);

function parse(source, fileName) {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function importedModules(source, fileName) {
  return parse(source, fileName).statements.flatMap(statement => (
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : []
  ));
}

const coreImports = importedModules(coreSource, paths.core);
const legacyImports = importedModules(legacySource, paths.legacy);
const htmlAdapterImports = importedModules(htmlAdapterSource, paths.htmlAdapter);

assert.equal(
  coreImports.some(specifier => specifier.startsWith('@/stores/')),
  false,
  'the prop-driven sizing core must not import editor stores',
);
assert.equal(
  htmlAdapterImports.some(specifier => specifier.endsWith('/SizingControls')),
  false,
  'the HTML/WordPress adapter must not pull the legacy store-backed wrapper',
);
assert.ok(
  htmlAdapterImports.some(specifier => specifier.endsWith('/SizingControlsCore')),
  'the HTML/WordPress adapter must import the prop-driven core directly',
);

for (const storeModule of [
  '@/stores/useEditorStore',
  '@/stores/usePagesStore',
  '@/stores/useComponentsStore',
]) {
  assert.ok(
    legacyImports.includes(storeModule),
    `the legacy sizing boundary must own ${storeModule}`,
  );
}

const coreAst = parse(coreSource, paths.core);
let requiredParentHasGrid = false;
for (const statement of coreAst.statements) {
  if (!ts.isInterfaceDeclaration(statement)) continue;
  if (statement.name.text !== 'SizingControlsCoreProps') continue;
  const property = statement.members.find(member => (
    ts.isPropertySignature(member)
    && ts.isIdentifier(member.name)
    && member.name.text === 'parentHasGrid'
  ));
  requiredParentHasGrid = Boolean(
    property
    && !property.questionToken
    && property.type?.kind === ts.SyntaxKind.BooleanKeyword,
  );
}
assert.equal(
  requiredParentHasGrid,
  true,
  'SizingControlsCore must require an explicit boolean parentHasGrid prop',
);

assert.match(
  legacySource,
  /export const LegacySizingControls = memo\(function LegacySizingControls/,
  'there must be one explicit legacy wrapper',
);
assert.equal(
  (legacySource.match(/function LegacySizingControls/g) || []).length,
  1,
  'the store-backed compatibility wrapper must be unique',
);
assert.match(
  legacySource,
  /parentHasGrid=\{explicitParentHasGrid \?\? storeParentHasGrid\}/,
  'the legacy wrapper must retain explicit-over-store grid precedence',
);
assert.match(
  htmlAdapterSource,
  /<SizingControlsCore[\s\S]*?parentHasGrid=\{props\.parentHasGrid \?\? false\}/,
  'the HTML/WordPress adapter must always supply the required grid contract',
);

for (const visualContract of [
  /<SettingsPanel[\s\S]*?title="Sizing"/,
  /<VisualDimensionField\s+label="Width"/,
  /<VisualDimensionField\s+label="Height"/,
  /<VisualSelectField[\s\S]*?label="Overflow"/,
  /data-design-token-property="grid-column"/,
  /data-design-token-property="grid-row"/,
  /<Label[^>]*>Object fit<\/Label>/,
  /label="Aspect ratio"/,
]) {
  assert.match(
    coreSource,
    visualContract,
    `the sizing visual contract must retain ${visualContract}`,
  );
}

for (const property of [
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'overflow',
  'aspectRatio',
  'objectFit',
  'objectPosition',
  'gridColumnSpan',
  'gridRowSpan',
]) {
  assert.match(
    coreSource,
    new RegExp(`getDesignProperty\\('sizing', '${property}'\\)`),
    `the sizing core must keep reading ${property}`,
  );
}

console.log('Sizing controls boundary tests passed.');
