import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../../lib/html-editor/workspace-draft.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(studio, embedded = true) {
  const messages = [], changes = [];
  const window = new EventTarget();
  window.top = embedded ? { postMessage: (...args) => messages.push(args) } : window;
  window.kodetyWordPress = { studio };
  const exports = {};
  new Function('window', 'exports', code)(window, exports);
  window.addEventListener(exports.WORKSPACE_DRAFT_CHANGED_EVENT, () => changes.push('draft'));
  return { ...exports, messages, changes };
}
test('unsaved Settings drafts notify HTML locally and only the enabled parent Studio', () => {
  const html = fixture(undefined, false);
  html.notifyWorkspaceDraftChanged();
  assert.deepEqual(html.changes, ['draft']);
  assert.deepEqual(html.messages, []);
  const studio = fixture({ enabled: true, projectId: 'workspace-123' });
  studio.notifyWorkspaceDraftChanged();
  assert.deepEqual(studio.messages, [[{ source: 'kodety-studio-wordpress', version: 1, type: 'project-changed', projectId: 'workspace-123' }, '*']]);
  for (const config of [undefined, { enabled: false, projectId: 'workspace-123' }, { enabled: true }]) {
    const ordinaryWordPress = fixture(config);
    ordinaryWordPress.notifyWorkspaceDraftChanged();
    assert.deepEqual(ordinaryWordPress.messages, []);
  }
});

test('the WordPress save bridge waits for Settings before capturing the project that enters the ZIP', async () => {
  const editorFile = '../../../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx';
  const editorSource = await readFile(new URL(editorFile, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(editorFile, editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleStudioMessage') handler = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(handler);
  const handlerCode = ts.transpileModule(`const handle = ${handler.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  for (const allowed of [true, false]) {
    let release;
    const guard = new Promise(resolve => { release = resolve; });
    const messages = [], writes = [];
    const top = {};
    const projectRef = { current: { title: 'Old title' } };
    const bindings = {
      window: { top }, studio: { projectId: 'workspace-123' }, projectRef,
      runWorkspaceNavigationGuards: destination => { assert.equal(destination, 'backup'); return guard; },
      persistExactWordPressDraft: async snapshot => writes.push(snapshot),
    };
    const handle = new Function('bindings', `with (bindings) { ${handlerCode} return handle; }`)(bindings);
    handle({ source: top, data: { source: 'kodety-studio', version: 1, type: 'project-save.request', projectId: 'workspace-123', requestId: 'backup-123' }, ports: [{ start() {}, close() {}, postMessage: message => messages.push(message) }] });
    await tick();
    assert.deepEqual(writes, []);
    assert.deepEqual(messages.map(message => message.type), ['accepted']);
    projectRef.current = { title: 'Latest pending Settings title' };
    release(allowed);
    await tick();
    assert.deepEqual(writes, allowed ? [{ title: 'Latest pending Settings title' }] : []);
    assert.equal(messages.at(-1).type, allowed ? 'done' : 'error');
  }
});
