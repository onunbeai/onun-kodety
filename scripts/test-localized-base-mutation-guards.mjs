import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectEditor = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  'utf8',
);

const editorAst = ts.createSourceFile('HtmlProjectEditor.tsx', projectEditor, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function variableSource(name) {
  const declarations = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(editorAst);
  assert.equal(declarations.length, 1, `expected one source declaration: ${name}`);
  assert.ok(declarations[0].initializer, `missing callback implementation: ${name}`);
  return declarations[0].initializer.getText(editorAst);
}

function assertGuardBefore(source, mutation, message) {
  const guardIndex = source.indexOf('rejectLocalizedBaseMutation(');
  const mutationIndex = source.indexOf(mutation);
  assert.ok(guardIndex >= 0, `${message}: missing localized mutation guard`);
  assert.ok(mutationIndex > guardIndex, `${message}: guard must run before ${mutation}`);
}

const guard = variableSource('rejectLocalizedBaseMutation');
assert.match(
  guard,
  /if \(!editingLocalizedPage\) return false;[\s\S]*?resolvedActiveLocale[\s\S]*?localization\.sourceLocale[\s\S]*?return true;/,
  'the shared guard must preserve source-locale behavior and identify both the active and source locales',
);
assert.match(
  guard,
  /texto, mídia e estilos visuais continuam isolados nesta tradução/,
  'the rejection must explain which locale-native visual edits remain available',
);

const codeComponentInsert = variableSource('insertCodeComponentInstance');
assertGuardBefore(
  codeComponentInsert,
  'patchInsertAdjacentElement(',
  'inserting a Code Component from a translation',
);

const codeFileChange = variableSource('changeCodeFile');
assertGuardBefore(codeFileChange, 'updateTextFile(', 'editing HTML, CSS or JavaScript from a translation');

const codeFormat = variableSource('formatCodeFile');
assertGuardBefore(codeFormat, 'commitProject(', 'formatting a code file from a translation');

const codeOpen = variableSource('openCodeFile');
assertGuardBefore(codeOpen, 'setCodeFilePath(', 'opening a concrete code file from a translation');

const globalCodeOpen = variableSource('openGlobalCodeEditor');
assertGuardBefore(
  globalCodeOpen,
  'resolveGlobalCodeEditorPath(',
  'opening the global code editor from a translation',
);

const layerRename = variableSource('renameLayer');
assertGuardBefore(layerRename, 'applyLivePatch(', 'renaming a layer from a translation');

const componentDetach = variableSource('detachHtmlComponentAtPath');
assertGuardBefore(
  componentDetach,
  'detachHtmlComponentInstance(',
  'detaching an HTML Component from a translation',
);

assert.match(
  projectEditor,
  /\{!editingLocalizedPage && \(\s*<HtmlEditorCodePanel[\s\S]*?changeCodeFile=\{changeCodeFile\}[\s\S]*?\)\}/,
  'the base-file code panel must not be exposed while a translated canvas is active',
);

const localizedStyleFlow = variableSource('updateStyle');
assert.doesNotMatch(
  localizedStyleFlow,
  /rejectLocalizedBaseMutation/,
  'locale-native visual style overrides must remain editable',
);

const mediaFlow = variableSource('updateMediaSource');
assert.doesNotMatch(
  mediaFlow,
  /rejectLocalizedBaseMutation/,
  'locale-native media overrides must remain editable',
);

console.log('Localized base-mutation guard contracts passed');
