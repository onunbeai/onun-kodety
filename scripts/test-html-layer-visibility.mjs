import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(path.join(root, relative), 'utf8');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  const protocol = await server.ssrLoadModule('/lib/html-editor/canvas-protocol.ts');
  const source = await server.ssrLoadModule('/lib/html-editor/source-patcher.ts');
  const generation = 'visibility-generation';
  const snapshot = protocol.withCanvasGeneration(generation, {
    type: 'html-editor-visibility-snapshot',
    breakpointId: 'mobile',
    hiddenPaths: ['0/1', '0/4/2'],
    revision: 7,
    sequence: 3,
  });
  assert.equal(protocol.isCanvasToEditorMessage(snapshot, generation), true);
  assert.equal(protocol.isCanvasToEditorMessage(snapshot, 'stale-generation'), false);
  assert.equal(
    protocol.isCanvasToEditorMessage({ ...snapshot, hiddenPaths: ['0/1', '0/1'] }, generation),
    false,
  );

  const builderVisibleSource =
    '<!doctype html><html><body><section class="hero">Builder visibility</section></body></html>';
  const builderHiddenSource = source.patchElementBuilderHidden(
    builderVisibleSource,
    '0',
    true,
  );
  assert.match(
    builderHiddenSource,
    /data-kodety-builder-hidden="true"/,
    'Hidden on Builder must persist an explicit author marker',
  );
  assert.equal(
    source.patchElementBuilderHidden(builderHiddenSource, '0', false),
    builderVisibleSource,
    'showing a Builder-hidden layer must restore the original public markup',
  );

  assert.equal(
    protocol.isCanvasToEditorMessage({ ...snapshot, breakpointId: '' }, generation),
    false,
  );
  assert.equal(
    protocol.isCanvasToEditorMessage({ ...snapshot, sequence: 0 }, generation),
    false,
  );
  assert.equal(
    protocol.isCanvasToEditorMessage({
      ...snapshot,
      hiddenPaths: Array.from({ length: 8193 }, (_, index) => `0/${index}`),
    }, generation),
    false,
  );

  const [preview, editor, navigator, layers, store] = await Promise.all([
    read('lib/html-editor/preview.ts'),
    read('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    read('app/(builder)/kodety/html-editor/components/HtmlNavigator.tsx'),
    read('app/(builder)/kodety/html-editor/components/HtmlLayersTree.tsx'),
    read('stores/useHtmlNavigatorStore.ts'),
  ]);

  assert.match(preview, /const publishCanvasVisibilitySnapshot = \(\) =>/);
  assert.match(preview, /type: 'html-editor-visibility-snapshot'[\s\S]*?breakpointId: canvasViewBreakpointId/);
  assert.match(preview, /canvasReadySent = true;[\s\S]*?scheduleCanvasVisibilitySnapshot\(\)/);
  assert.match(preview, /finalizeLiveStructure[\s\S]*?scheduleCanvasVisibilitySnapshot\(\)/);
  assert.match(preview, /type === 'html-editor-view-state'[\s\S]*?scheduleCanvasVisibilitySnapshot\(\)/);
  assert.match(preview, /addEventListener\('resize', scheduleCanvasVisibilitySnapshot/);
  assert.match(preview, /if \(hiddenPaths\.length > 8192\) return;[\s\S]*?hiddenPaths,/);
  assert.doesNotMatch(preview, /hiddenPaths:\s*hiddenPaths\.slice\(/);
  const inspectionStyleStart = preview.indexOf(
    "if (inspectionEnabled) {\n    const editorStyle = document.createElement('style');",
  );
  const inspectionStyleEnd = preview.indexOf(
    'document.head.appendChild(editorStyle);',
    inspectionStyleStart,
  );
  const builderVisibilityRule = '[${BUILDER_HIDDEN_ATTRIBUTE}="true"]';
  const builderVisibilityRuleIndex = preview.indexOf(builderVisibilityRule);
  assert.ok(inspectionStyleStart >= 0 && inspectionStyleEnd > inspectionStyleStart);
  assert.ok(
    builderVisibilityRuleIndex > inspectionStyleStart
      && builderVisibilityRuleIndex < inspectionStyleEnd,
    'Hidden on Builder must be interpreted only inside the Design inspection stylesheet',
  );
  assert.equal(
    preview.indexOf(builderVisibilityRule, builderVisibilityRuleIndex + 1),
    -1,
    'Preview/public code must not receive a second Builder visibility rule',
  );
  assert.match(
    layers,
    /const solidAccentSelection =[\s\S]*?isSelected && !componentInstance && !codeComponentInstance;[\s\S]*?solidAccentSelection && "\[&_svg\]:text-current \[&_svg\]:opacity-100"/,
    'a seleção roxa sólida de Layers deve manter todos os ícones brancos e com opacidade total',
  );
  assert.match(
    preview,
    /appliedEditorRevision = Math\.max\(appliedEditorRevision, event\.data\.revision\);[\s\S]*?!transientPreview\) scheduleCanvasVisibilitySnapshot\(\)/,
  );

  assert.match(editor, /message\.type === 'html-editor-visibility-snapshot'/);
  assert.match(editor, /message\.breakpointId !== viewportRef\.current/);
  assert.match(editor, /message\.revision < projectRevisionRef\.current/);
  assert.match(editor, /current\.sequence >= message\.sequence/);
  assert.match(
    editor,
    /useHtmlViewportStore\.subscribe\(\(state, previous\)[\s\S]*?state\.viewport === previous\.viewport[\s\S]*?postCanvasViewStateToFrame\(activeCanvasAuthorityRef\.current\?\.frame\)/,
  );
  assert.match(editor, /optimisticallySetCanvasLayerVisibility\(targets, visible\)/);
  assert.match(editor, /effectiveHiddenPaths:[\s\S]*?canvasVisibilitySnapshot\.hiddenPaths/);
  assert.match(navigator, /effectiveHiddenPaths=\{effectiveHiddenPaths\}/);
  assert.match(store, /'effectiveHiddenPaths'/);
  assert.match(
    layers,
    /if \(effectiveHidden !== undefined\) return effectiveHidden;[\s\S]*?node\.attributes\.hidden/,
  );
  assert.match(layers, /effectiveHiddenPathSet\.has\(entry\.node\.path\)/);
  assert.match(layers, /<Paintbrush \/> Estilo[\s\S]*?<ContextMenuSubContent/);
  assert.match(layers, /<ArrowUpDown \/> Mover para[\s\S]*?Fora do container/);
  assert.match(layers, /Hidden on Builder[\s\S]*?data-layer-indicator="builder-hidden"/);
  assert.match(
    layers,
    /collectBuilderHiddenDescendantPaths[\s\S]*?builderHidden \|\| builderHiddenByParent \? undefined : effectiveHidden/,
    'Builder-hidden containers must not make descendant public visibility controls report a false hidden state',
  );
  assert.match(editor, /onToggleBuilderHidden: updateLayerBuilderHidden/);

  console.log('HTML Layers effective visibility tests passed');
} finally {
  await server.close();
}
