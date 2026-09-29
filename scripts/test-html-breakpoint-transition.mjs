import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const stageSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
  'utf8',
);
const infiniteCanvasSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInfiniteCanvas.tsx'),
  'utf8',
);

assert.match(
  stageSource,
  /const breakpointRequiresAutoFit = lastAutoFittedBreakpointRef\.current !== viewport;[\s\S]*?breakpointRequiresAutoFit[\s\S]*?\? fittedCanvasZoom[\s\S]*?: Math\.min\(zoom, fittedCanvasZoom\)/,
  'a breakpoint change must use its final fitted zoom in the same render as its new viewport size',
);

assert.match(
  stageSource,
  /'transition-\[width,height\] duration-300 ease-out motion-reduce:transition-none'[\s\S]*?'will-change-\[width,height,transform\] transition-\[width,height,transform\] duration-300 ease-out motion-reduce:transition-none'/,
  'the scaled footprint and real iframe viewport must share one reduced-motion-safe resize transition',
);

assert.match(
  infiniteCanvasSource,
  /focusTransitioning[\s\S]*?focusInfiniteCanvasFrame\([\s\S]*?BREAKPOINT_FOCUS_TRANSITION_MS[\s\S]*?'transition-transform duration-300 ease-out motion-reduce:transition-none'/,
  'infinite-canvas breakpoint focus must animate the plane without delaying its final geometry',
);

assert.match(
  infiniteCanvasSource,
  /const cancelFocusTransition = useCallback\([\s\S]*?clearTimeout\(focusTransitionTimerRef\.current\)[\s\S]*?focusTransitionTimerRef\.current = null[\s\S]*?setFocusTransitioning\(false\)/,
  'manual canvas gestures need one shared cancellation path for breakpoint focus interpolation',
);

for (const [gesture, pattern] of [
  ['preset zoom', /const setSafeZoom = useCallback\([\s\S]*?userAdjustedViewRef\.current = true;\s*cancelFocusTransition\(\);/],
  ['wheel or pinch navigation', /const applyNavigationWheel = useCallback\([\s\S]*?userAdjustedViewRef\.current = true;\s*cancelFocusTransition\(\);/],
  ['canvas pan', /const startPan = \(event:[\s\S]*?userAdjustedViewRef\.current = true;\s*cancelFocusTransition\(\);/],
  ['frame resize', /const startFrameResize = \([\s\S]*?event\.stopPropagation\(\);\s*cancelFocusTransition\(\);/],
]) {
  assert.match(
    infiniteCanvasSource,
    pattern,
    `${gesture} must cancel an in-flight breakpoint focus transition before reading geometry`,
  );
}

assert.match(
  infiniteCanvasSource,
  /data-infinite-canvas-active-iframe[\s\S]*?'will-change-\[left,top,width,height\] transition-\[left,top,width,height\] duration-300 ease-out motion-reduce:transition-none'[\s\S]*?documentKey=\{`\$\{documentKey\}:active-editor`\}/,
  'the editable infinite-canvas iframe must resize in place instead of navigating or remounting for a breakpoint',
);

console.log('html-breakpoint-transition: ok');
