import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = relativePath => readFile(path.join(root, relativePath), 'utf8');

const [
  canvasSource,
  stageSource,
  projectEditorSource,
  previewSource,
  runtimeSource,
] = await Promise.all([
  readSource('app/(builder)/kodety/html-editor/components/HtmlInfiniteCanvas.tsx'),
  readSource('app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
  readSource('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  readSource('lib/html-editor/preview.ts'),
  readSource('lib/html-editor/infinite-canvas-runtime.ts'),
]);

const transpiledRuntime = ts.transpileModule(runtimeSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
assert.equal(
  transpiledRuntime.diagnostics?.some(diagnostic => (
    diagnostic.category === ts.DiagnosticCategory.Error
  )),
  false,
  'the isolated infinite-canvas runtime must transpile without errors',
);
const runtimeModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiledRuntime.outputText).toString('base64')}`
);

const fixture = '<!doctype html><html><head><style>.hero{min-height:100vh}</style></head><body><main class="hero">Canvas</main></body></html>';
const activeDocument = runtimeModule.injectInfiniteCanvasRuntime(fixture, {
  defaultViewportHeight: 900,
});
const passiveDocument = runtimeModule.injectInfiniteCanvasPassiveRuntime(fixture);
assert.match(activeDocument, /infiniteCanvasRuntimeBootstrap/);
assert.match(passiveDocument, /infiniteCanvasPassiveRuntimeBootstrap/);
assert.ok(
  passiveDocument.length < activeDocument.length,
  'a passive breakpoint must inject less runtime code than the editable document',
);
assert.equal(
  runtimeModule.injectInfiniteCanvasPassiveRuntime(passiveDocument),
  passiveDocument,
  'passive runtime injection must be idempotent',
);
assert.equal(
  (passiveDocument.match(/data-kodety-infinite-canvas-runtime/g) || []).length,
  1,
  'a passive reference must contain exactly one infinite-canvas runtime',
);
assert.ok(
  passiveDocument.indexOf('data-kodety-infinite-canvas-runtime')
    < passiveDocument.toLowerCase().indexOf('</body>'),
  'the passive runtime must execute inside body before the document closes',
);

// The real preview bridge embeds complete iframe documents in JavaScript
// strings. Injection must target the structural closing body, not the first
// closing-body text it encounters inside that script.
const previewBridgeFixture = `<!doctype html><html><body><main>Canvas</main><script data-html-editor-bridge>const staticEmbedDocument = '<!doctype html><html><body><span>Embed</span></body></html>'; const freezeCanvasEmbed = element => element;</script></body></html>`;
for (const [label, injected] of [
  ['active', runtimeModule.injectInfiniteCanvasRuntime(previewBridgeFixture)],
  ['passive', runtimeModule.injectInfiniteCanvasPassiveRuntime(previewBridgeFixture)],
]) {
  const runtimeIndex = injected.indexOf('<script data-kodety-infinite-canvas-runtime>');
  const bridgeCloseIndex = injected.indexOf('</script>');
  const sentinelIndex = injected.indexOf('freezeCanvasEmbed');
  const structuralBodyCloseIndex = injected.toLowerCase().lastIndexOf('</body>');
  assert.ok(runtimeIndex > bridgeCloseIndex, `${label} runtime must be a sibling after the preview bridge`);
  assert.ok(runtimeIndex > sentinelIndex, `${label} runtime must not split the preview bridge source`);
  assert.ok(runtimeIndex < structuralBodyCloseIndex, `${label} runtime must stay inside the document body`);
  assert.equal(
    (injected.match(/<script\b[^>]*data-kodety-infinite-canvas-runtime(?:\s|=|>)/gi) || []).length,
    1,
    `${label} preview-shaped document must contain one infinite-canvas runtime`,
  );
}

const passiveRuntimeStart = runtimeSource.indexOf('function infiniteCanvasPassiveRuntimeBootstrap');
const passiveRuntimeEnd = runtimeSource.indexOf('export function injectInfiniteCanvasRuntime');
assert.ok(passiveRuntimeStart >= 0 && passiveRuntimeEnd > passiveRuntimeStart);
const passiveRuntimeSource = runtimeSource.slice(passiveRuntimeStart, passiveRuntimeEnd);
assert.match(
  passiveRuntimeSource,
  /rewriteViewportValue[\s\S]*?rewriteDeclarations[\s\S]*?walkRules/,
  'passive viewport units must be rewritten in their original declarations',
);
assert.match(
  runtimeSource,
  /function appendRuntimeToDocument[\s\S]*?closingBodyPattern = \/<\\\/body\\s\*>\/gi[\s\S]*?closingBodyIndex = match\.index[\s\S]*?html\.slice\(0, closingBodyIndex\)/,
  'runtime injection must use the final structural body closing tag',
);
assert.doesNotMatch(
  passiveRuntimeSource,
  /querySelectorAll\(selector\)|specificity\(/,
  'passive breakpoints must not repeat selector matching and specificity work',
);
assert.match(
  passiveRuntimeSource,
  /scrollExtent > physicalHeight[\s\S]*?Array\.from\(body\.children\)/,
  'complete passive height must use stable document overflow plus a bounded top-level fallback',
);

assert.match(
  canvasSource,
  /const passiveDocument = useMemo\([\s\S]*?injectInfiniteCanvasPassiveRuntime\(passiveHtml\)/,
  'all passive breakpoints must share one serialized document',
);
assert.match(
  stageSource,
  /data-persistent-infinite-page-canvas[\s\S]*?'flex min-h-0 min-w-0 flex-1 will-change-\[opacity\]'[\s\S]*?<HtmlInfiniteCanvas/,
  'the persistent infinite-canvas wrapper must fill its flex slot and give the absolute plane a non-zero height',
);
assert.match(
  canvasSource,
  /data-infinite-canvas[\s\S]*?'relative h-full min-h-0 w-full min-w-0 flex-1/,
  'the infinite-canvas viewport must explicitly fill its persistent wrapper',
);
assert.match(
  canvasSource,
  /html-editor:infinite-canvas-view:v3/,
  'the fixed geometry must not restore the 2% view persisted by the collapsed v2 viewport',
);
assert.match(
  canvasSource,
  /const fit = useCallback\([\s\S]*?clientWidth <= 1 \|\| container\.clientHeight <= 1/,
  'fit must ignore collapsed viewport geometry instead of persisting a false 2% view',
);
assert.match(
  canvasSource,
  /recoveredFromCollapsedLayout[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?fit\(\)[\s\S]*?new ResizeObserver\(updateViewportSize\)/,
  'a canvas mounted while hidden must refit as soon as its viewport receives real geometry',
);
assert.match(
  canvasSource,
  /layout\.frames\.map\(frame => \{[\s\S]*?<HtmlBufferedIframe[\s\S]*?documentKey=\{referenceDocumentKey\}[\s\S]*?loading="eager"[\s\S]*?srcDoc=\{passiveDocument\}/,
  'every breakpoint reference must prepare eagerly while retaining its previous painted document',
);
assert.doesNotMatch(
  canvasSource,
  /passiveHydrationState|mountedPassiveIdSet|requestIdleCallback|Preparando breakpoint/,
  'the canvas must not hide complete breakpoints behind an idle hydration queue',
);
assert.match(
  canvasSource,
  /heightCommitFrameRef[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?const settled = new Map/,
  'concurrent iframe measurements must collapse into one React update per paint',
);
assert.match(
  canvasSource,
  /pendingViewUpdatesRef[\s\S]*?scheduleViewUpdate[\s\S]*?requestAnimationFrame[\s\S]*?updates\.reduce/,
  'pan and zoom updates must be consolidated at the browser paint boundary',
);
assert.match(
  canvasSource,
  /viewPersistenceTimerRef[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?localStorage\.setItem[\s\S]*?180/,
  'canvas view persistence must stay off the hot input path',
);

assert.match(
  previewSource,
  /passiveBreakpointPreview[\s\S]*?inspectionEnabled = [^\n]*&& !passiveBreakpointPreview[\s\S]*?contentEditing = [^\n]*&& !passiveBreakpointPreview/,
  'passive documents must leave selection and content-editing services asleep',
);
assert.match(
  stageSource,
  /onActiveFrameLoad[\s\S]*?passiveCanvasFramesRef\.current\.forEach[\s\S]*?postViewportHeightSimulationsToFrame[\s\S]*?html-editor-infinite-canvas-refresh-height[\s\S]*?html-editor-runtime-assets-refresh/,
  'references loaded before active authority must receive state, measurement and pending-asset replays',
);
assert.match(
  previewSource,
  /html-editor-runtime-assets-refresh[\s\S]*?pendingRuntimeAssetRequests\.forEach\(enqueueRuntimeAssetRequest\)[\s\S]*?flushRuntimeAssetRequests\(\)/,
  'concurrent references must replay only assets already discovered before authority',
);
assert.match(
  projectEditorSource,
  /message\.type === 'html-editor-infinite-canvas-wheel'[\s\S]*?handleFrameWheel\(message\)/,
  'wheel navigation from the editable iframe must reach the infinite canvas',
);
assert.match(
  stageSource,
  /\{infiniteCanvasEnabled && !isPreviewing && \([\s\S]*?<HtmlInfiniteCanvas/,
  'the optimized topology must remain gated behind Infinite Canvas',
);
assert.match(
  stageSource,
  /\{\(!infiniteCanvasEnabled \|\| isPreviewing \|\| editingHtmlComponent\) && \(/,
  'the normal canvas must retain its independent render branch',
);

console.log('Infinite canvas regression tests passed.');
