import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Execute the production host boundary with an editor and durable-save ACK.
// The adapter cannot roll this boundary back by itself when browser storage fails.
const source = await readFile(new URL('../src/html-workspace.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('html-workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'commitProject' && ts.isArrowFunction(node.initializer)) callback = node.initializer.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(callback, 'The real CMS transport commit callback must be present');
const code = ts.transpileModule(`const callback = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const file = text => ({ text });
function setup(save) {
  const base = { name: 'CMS', files: { 'schema.json': file('old'), 'removed.json': file('retained'), 'index.html': file('canvas') } };
  let current = base;
  const environment = {
    api: { current: { getProject: () => current, applyProject: project => { current = project; } } },
    latest: { current: base }, opened: { initialProject: base },
    saveProject: snapshot => save(snapshot, project => { current = project; }),
  };
  const commit = new Function('bindings', `with (bindings) { ${code}; return callback; }`)(environment);
  const changed = { ...base, files: { ...base.files, 'schema.json': file('new'), 'created.json': file('created') } };
  delete changed.files['removed.json'];
  const delta = { baseProject: base, changedPaths: ['schema.json', 'created.json'], deletedPaths: ['removed.json'] };
  return { base, changed, delta, commit, current: () => current };
}

test('CMS commit waits for durable save and sends the applied delta snapshot', async () => {
  let resolve, saved;
  const ack = new Promise(yes => { resolve = yes; });
  const env = setup(async snapshot => { saved = snapshot; await ack; });
  let complete = false;
  const pending = env.commit(env.changed, env.delta).then(() => { complete = true; });
  assert.equal(complete, false);
  assert.equal(saved.files['schema.json'].text, 'new');
  resolve(); await pending;
  assert.equal(complete, true);
  assert.equal(env.current().files['removed.json'], undefined);
});

test('failed CMS save restores its revision and files without losing concurrent canvas changes', async () => {
  const env = setup(async (snapshot, update) => {
    update({ ...snapshot, files: { ...snapshot.files, 'index.html': file('new canvas') } });
    throw new Error('Browser quota');
  });
  await assert.rejects(env.commit(env.changed, env.delta), /Browser quota/);
  assert.equal(env.current().files['schema.json'], env.base.files['schema.json']);
  assert.equal(env.current().files['removed.json'], env.base.files['removed.json']);
  assert.equal(env.current().files['created.json'], undefined);
  assert.equal(env.current().files['index.html'].text, 'new canvas');
});

test('rollback never overwrites a newer edit of the same CMS file', async () => {
  const env = setup(async (snapshot, update) => {
    update({ ...snapshot, files: { ...snapshot.files, 'schema.json': file('concurrent revision') } });
    throw new Error('Browser unavailable');
  });
  await assert.rejects(env.commit(env.changed, env.delta), /Browser unavailable/);
  assert.equal(env.current().files['schema.json'].text, 'concurrent revision');
  assert.equal(env.current().files['created.json'], undefined);
});
