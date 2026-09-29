import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inspectorPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx',
);
const inspectorSource = await readFile(inspectorPath, 'utf8');

assert.match(
  inspectorSource,
  /resolveInspectorStyleValues\(\{[\s\S]*?pseudo: effectivePseudo,[\s\S]*?ruleStyles: cssRuleStyles,[\s\S]*?optimisticStyles: stylePreviewTransaction\.optimisticValues/,
  'the Inspector must resolve every visual control from the selected pseudo-state',
);
assert.match(
  inspectorSource,
  /\{ value: 'base', label: 'Normal' \}/,
  'the resting state must be named Normal in the selector',
);
assert.match(
  inspectorSource,
  /stylePreviewScopeKey = `\$\{selection\?\.path \|\| ''\}:\$\{cssContext\.target\}:\$\{cssContext\.selector\}:\$\{cssContext\.pseudo\}/,
  'optimistic edits must remain scoped to the active pseudo-state',
);
assert.doesNotMatch(
  inspectorSource,
  /scopeKey=\{`\$\{selection\.path\}:tokens-\$\{designTokenRevision\}`\}/,
  'visual controls must not reuse local input state across pseudo-states',
);
assert.match(
  inspectorSource,
  /scopeKey=\{`\$\{stylePreviewScopeKey\}:tokens-\$\{designTokenRevision\}`\}/,
  'visual controls must include pseudo-state, breakpoint, and tokens in their scope identity',
);

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const {
    resolveInspectorCustomProperties,
    resolveInspectorStyleValues,
  } = await server.ssrLoadModule(
    '/lib/html-editor/inspector-style-values.ts',
  );
  const resting = {
    'background-color': '#1e1e1e',
    color: '#ffffff',
    'font-size': '16px',
  };
  const authoredProjection = {
    'background-color': '#1e1e1e',
    height: '100svh',
  };

  const normal = resolveInspectorStyleValues({
    pseudo: 'base',
    computedFallback: resting,
    inlineStyles: { color: '#f8fafc' },
    ruleStyles: { 'background-color': '#1e1e1e', color: '#ef4444' },
    authoredProjectionStyles: authoredProjection,
  });
  assert.equal(normal['background-color'], '#1e1e1e');
  assert.equal(normal.color, '#f8fafc', 'authored inline CSS must remain visible above a losing class rule until promotion');

  const hover = resolveInspectorStyleValues({
    pseudo: 'hover',
    computedFallback: resting,
    authoredProjectionStyles: authoredProjection,
    ruleStyles: { 'background-color': '#8b5cf6' },
  });
  assert.equal(
    hover['background-color'],
    '#8b5cf6',
    'the selected Hover rule must beat the resting authored snapshot',
  );
  assert.equal(hover.color, '#ffffff', 'unset Hover properties must show their inherited base value');
  assert.equal(hover.height, '100svh', 'safe authored canvas projections remain visible as fallback');

  const focus = resolveInspectorStyleValues({
    pseudo: 'focus',
    computedFallback: resting,
    authoredProjectionStyles: authoredProjection,
    ruleStyles: { 'background-color': '#22c55e' },
  });
  assert.equal(focus['background-color'], '#22c55e');
  assert.equal(focus.color, '#ffffff');
  assert.equal(
    resolveInspectorStyleValues({
      pseudo: 'base',
      computedFallback: resting,
      ruleStyles: { 'background-color': '#1e1e1e' },
      authoredProjectionStyles: authoredProjection,
    })['background-color'],
    '#1e1e1e',
    'returning to Normal must not retain the previous pseudo-state value',
  );

  const inheritedHover = resolveInspectorStyleValues({
    pseudo: 'hover',
    computedFallback: resting,
    authoredProjectionStyles: authoredProjection,
    inheritedBreakpointStyles: { 'background-color': '#f59e0b' },
  });
  assert.equal(
    inheritedHover['background-color'],
    '#f59e0b',
    'an inherited Hover breakpoint must beat the resting/base projection',
  );

  const optimisticHover = resolveInspectorStyleValues({
    pseudo: 'hover',
    computedFallback: resting,
    ruleStyles: { 'background-color': '#8b5cf6' },
    liveStyles: { 'background-color': '#7c3aed' },
    optimisticStyles: { 'background-color': '#6d28d9' },
  });
  assert.equal(
    optimisticHover['background-color'],
    '#6d28d9',
    'the active control draft must remain the final display authority',
  );

  const hoverVariables = {
    '--accent': '#8b5cf6',
    '--nested-accent': 'var(--accent)',
    '--cyclic-a': 'var(--cyclic-b)',
    '--cyclic-b': 'var(--cyclic-a)',
  };
  assert.equal(
    resolveInspectorCustomProperties('var(--accent)', hoverVariables),
    '#8b5cf6',
    'a state colour backed by a regular CSS variable must display its effective value',
  );
  assert.equal(
    resolveInspectorCustomProperties('var(--nested-accent)', hoverVariables),
    '#8b5cf6',
    'nested custom properties must resolve for visual controls',
  );
  assert.equal(
    resolveInspectorCustomProperties('var(--missing, var(--accent))', hoverVariables),
    '#8b5cf6',
    'nested fallbacks must resolve without changing the authored reference',
  );
  assert.match(
    resolveInspectorCustomProperties('var(--cyclic-a)', hoverVariables),
    /^var\(--cyclic-/,
    'cycles must stay unresolved instead of hanging or inventing a value',
  );

  console.log('HTML Inspector state-value tests passed.');
} finally {
  await server.close();
}
