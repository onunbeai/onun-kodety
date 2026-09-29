import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../app/(builder)/kodety/html-editor/components/HtmlAgentPanel.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('HtmlAgentPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wrapper = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'HtmlAgentPanel');
assert.ok(wrapper, 'the real Agent host entry exists');
const code = ts.transpileModule(wrapper.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function fixture(host, agent, kind) {
  const navigations = [];
  const context = host === null ? null : { licensed: host, kind, onOpenSettings: section => navigations.push(section), ...(agent ? { agent } : {}) };
  const exports = {};
  const connected = () => assert.fail('The wrapper only selects the connected component; it does not execute its runtime');
  const Button = 'button';
  const require = name => {
    assert.equal(name, 'react/jsx-runtime');
    const render = (type, props) => ({ type, props });
    return { jsx: render, jsxs: render };
  };
  new Function('exports', 'require', 'useHtmlWorkspaceAgentHost', 'ConnectedHtmlAgentPanel', 'getAdminUiLocale', 'Sparkles', 'Button', 'Link2', 'agentBrowserNotice', code)(exports, require, () => context, connected, () => 'en-US', 'sparkles', Button, 'link', () => false);
  return { render: exports.HtmlAgentPanel, connected, navigations };
}
function nodes(node) { return !node || typeof node !== 'object' ? [node] : [node, ...[node.props?.children].flat().flatMap(nodes)]; }

test('HTML directs an unavailable runtime to Agent settings without paid activation', () => {
  const f = fixture(false);
  const result = f.render({ visible: true });
  const children = nodes(result);
  const text = children.filter(child => typeof child === 'string').join(' ');
  assert.match(text, /connection is unavailable/);
  assert.doesNotMatch(text, /MCP|Claude|WordPress/);
  children.find(child => child?.type === 'button').props.onClick();
  assert.deepEqual(f.navigations, ['agents']);
  assert.equal(f.render({ visible: false }), null);
});

test('licensed HTML without a backend reports the unavailable connection and opens Agent settings', () => {
  const f = fixture(true);
  const children = nodes(f.render({ visible: true }));
  const button = children.find(child => child?.type === 'button');
  assert.ok(nodes(button).includes('Open Agent settings'));
  assert.match(children.filter(child => typeof child === 'string').join(' '), /connection is unavailable/);
  button.props.onClick();
  assert.deepEqual(f.navigations, ['agents']);
});

test('native WordPress retains the original connected Agent component and exact navigation props', () => {
  const f = fixture(null);
  const props = { visible: true, preferredSkill: 'kodety-site-code', onNavigate: () => {} };
  const result = f.render(props);
  assert.equal(result.type, f.connected);
  assert.deepEqual(result.props, props);
});

test('HTML with an Agent adapter selects the shared panel and preserves its original props', () => {
  let created = 0;
  const agent = { key: 'html-project-test', createBackend: () => { created++; return {}; } };
  const f = fixture(true, agent);
  const props = { visible: true, preferredSkill: 'kodety-site-code', onNavigate: () => {} };
  const result = f.render(props);
  assert.equal(result.type, f.connected);
  assert.deepEqual(result.props, props);
  assert.equal(created, 0, 'backend creation belongs to the mounted shared panel, not its wrapper');
  assert.deepEqual(f.navigations, []);
});

test('a WordPress execution host preserves the server renderer before a browser backend is selected', () => {
  const f = fixture(true, undefined, 'wordpress');
  const props = { visible: true, preferredSkill: 'kodety-site-code', onNavigate: () => {} };
  const result = f.render(props);
  assert.equal(result.type, f.connected);
  assert.deepEqual(result.props, props);
});
