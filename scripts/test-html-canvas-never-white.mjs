import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bufferedIframeSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx'),
  'utf8',
);
const canvasStageSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
  'utf8',
);
const projectEditorSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  'utf8',
);
const previewSource = await readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');

function extractSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing runtime section: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing runtime section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function dependenciesEqual(previous, next) {
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

function classNames(...values) {
  return values
    .flat(Infinity)
    .filter(value => typeof value === 'string' && value)
    .join(' ');
}

function createAnimationWindow() {
  let nextFrameId = 1;
  let currentTime = 0;
  const timers = new Map();
  const animationFrames = new Map();
  const listeners = new Map();
  return {
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || new Set();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchMessage(source, data) {
      [...(listeners.get('message') || [])].forEach(listener => listener({ source, data }));
    },
    setTimeout(callback, delay = 0) {
      const id = nextFrameId++;
      timers.set(id, { callback, deadline: currentTime + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advanceFrame() {
      currentTime += 16;
      for (const [id, timer] of timers) {
        if (timer.deadline > currentTime) continue;
        timers.delete(id);
        timer.callback();
      }
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      callbacks.forEach(callback => callback(Date.now()));
      return callbacks.length;
    },
  };
}

function compileBufferedIframeForRuntimeTest(animationWindow) {
  const typescript = require('typescript');
  let activeRenderer = null;
  const Fragment = Symbol('Fragment');
  const createNode = (type, props, key) => ({ type, props: props || {}, key: key ?? null });
  const react = {
    useState: initialValue => activeRenderer.useState(initialValue),
    useRef: initialValue => activeRenderer.useRef(initialValue),
    useCallback: (callback, dependencies) => activeRenderer.useCallback(callback, dependencies),
    useLayoutEffect: (effect, dependencies) => activeRenderer.useLayoutEffect(effect, dependencies),
    createElement(type, rawProps, ...children) {
      const { key = null, ...props } = rawProps || {};
      if (children.length === 1) props.children = children[0];
      else if (children.length > 1) props.children = children;
      return createNode(type, props, key);
    },
  };
  const jsxRuntime = {
    Fragment,
    jsx: createNode,
    jsxs: createNode,
  };
  const compiled = typescript.transpileModule(bufferedIframeSource, {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.CommonJS,
      jsx: typescript.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === 'react') return react;
      if (specifier === 'react/jsx-runtime') return jsxRuntime;
      if (specifier === '@/lib/utils') return { cn: classNames };
      if (specifier === '@/components/ui/kodety-loading-screen') {
        return { KodetyLoadingScreen: props => createNode('kodety-loading-screen', props) };
      }
      if (specifier === '../hooks/page-transition-preview-styles') {
        return { previewPageTransitionFrameStyle: (_transition, _direction, _active, style) => style };
      }
      throw new Error(`Unexpected HtmlBufferedIframe dependency: ${specifier}`);
    },
    window: animationWindow,
    console,
  });
  vm.runInContext(compiled, context, { filename: 'HtmlBufferedIframe.runtime.cjs' });
  return {
    Component: module.exports.HtmlBufferedIframe,
    Fragment,
    withRenderer(renderer, callback) {
      activeRenderer = renderer;
      try {
        return callback();
      } finally {
        activeRenderer = null;
      }
    },
  };
}

function compileEditorInitialVisualReadyGateForRuntimeTest() {
  const typescript = require('typescript');
  const acceptReady = extractSection(
    projectEditorSource,
    'const acceptEditorVisualReady = (',
    '  const handleEditorInitialVisualReady = (',
  );
  const promotionHandler = extractSection(
    projectEditorSource,
    '  const handleEditorCanvasPromotion = (',
    '  const handleRuntimePreviewPromotion = (',
  );
  const compiled = typescript.transpileModule(`
    export function evaluateInitialVisualReadyGate(input: {
      node: unknown;
      currentNode: unknown;
      generation: string;
      revision: number;
      surfaceKey: string;
      expectedGeneration: string;
      expectedRevision: number;
      expectedSurfaceKey: string;
      projectOpenedAt: number | null;
      viaPromotion?: boolean;
    }) {
      const editorCanvasPreview = input.expectedGeneration
        ? { generation: input.expectedGeneration, revision: input.expectedRevision }
        : null;
      const editorCanvasIframeRef = { current: input.currentNode };
      const editorCanvasSemanticSurfaceKey = input.expectedSurfaceKey;
      const projectRef = {
        current: input.projectOpenedAt === null ? null : { openedAt: input.projectOpenedAt },
      };
      let paintedProjectOpenedAt: number | null = null;
      const paintedProjectOpenedAtRef = { current: null as number | null };
      const setPaintedProjectOpenedAt = (openedAt: number) => {
        paintedProjectOpenedAt = openedAt;
      };
      const clearPendingPageNavigation = () => undefined;
      const clearPendingLocaleNavigation = () => undefined;
      const resolvedActiveLocale = 'en';
      const activateBufferedCanvasSurface = () => undefined;
      const cacheInitialWordPressWorkspaceAfterPaint = () => undefined;
      ${acceptReady}
      const handleEditorInitialVisualReady = acceptEditorVisualReady;
      ${promotionHandler}
      if (input.viaPromotion) {
        handleEditorCanvasPromotion(
          input.node as HTMLIFrameElement,
          input.generation,
          input.revision,
          input.surfaceKey,
          'buffered',
        );
      } else {
        handleEditorInitialVisualReady(
          input.node as HTMLIFrameElement,
          input.generation,
          input.revision,
          input.surfaceKey,
        );
      }
      return paintedProjectOpenedAt;
    }
  `, {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.CommonJS,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports }, {
    filename: 'HtmlProjectEditor.initial-visual-ready.runtime.cjs',
  });
  return module.exports.evaluateInitialVisualReadyGate;
}

function flattenNodes(node, Fragment, result = []) {
  if (Array.isArray(node)) {
    node.forEach(child => flattenNodes(child, Fragment, result));
    return result;
  }
  if (!node || typeof node !== 'object') return result;
  if (node.type !== Fragment) result.push(node);
  flattenNodes(node.props?.children, Fragment, result);
  return result;
}

class HookRenderer {
  constructor(runtime, animationWindow, Component, props) {
    this.runtime = runtime;
    this.animationWindow = animationWindow;
    this.Component = Component;
    this.props = props;
    this.hooks = [];
    this.cursor = 0;
    this.pendingEffects = [];
    this.dirty = true;
    this.tree = null;
    this.mountedFrames = new Map();
    this.flush();
  }

  useState(initialValue) {
    const index = this.cursor++;
    if (!this.hooks[index]) {
      const hook = {
        kind: 'state',
        value: typeof initialValue === 'function' ? initialValue() : initialValue,
        setValue: null,
      };
      hook.setValue = update => {
        const nextValue = typeof update === 'function' ? update(hook.value) : update;
        if (Object.is(nextValue, hook.value)) return;
        hook.value = nextValue;
        this.dirty = true;
      };
      this.hooks[index] = hook;
    }
    const hook = this.hooks[index];
    assert.equal(hook.kind, 'state');
    return [hook.value, hook.setValue];
  }

  useRef(initialValue) {
    const index = this.cursor++;
    if (!this.hooks[index]) this.hooks[index] = { kind: 'ref', value: { current: initialValue } };
    const hook = this.hooks[index];
    assert.equal(hook.kind, 'ref');
    return hook.value;
  }

  useCallback(callback, dependencies) {
    const index = this.cursor++;
    const previous = this.hooks[index];
    if (!previous || !dependenciesEqual(previous.dependencies, dependencies)) {
      this.hooks[index] = { kind: 'callback', value: callback, dependencies };
    }
    const hook = this.hooks[index];
    assert.equal(hook.kind, 'callback');
    return hook.value;
  }

  useLayoutEffect(effect, dependencies) {
    const index = this.cursor++;
    const previous = this.hooks[index];
    const changed = !previous || !dependenciesEqual(previous.dependencies, dependencies);
    if (!previous) {
      this.hooks[index] = {
        kind: 'effect',
        dependencies,
        cleanup: null,
        effect,
      };
    } else {
      assert.equal(previous.kind, 'effect');
      previous.dependencies = dependencies;
      previous.effect = effect;
    }
    if (changed) this.pendingEffects.push(index);
  }

  updateProps(nextProps) {
    this.props = { ...this.props, ...nextProps };
    this.dirty = true;
    this.flush();
  }

  renderOnce() {
    this.cursor = 0;
    this.pendingEffects = [];
    this.tree = this.runtime.withRenderer(this, () => this.Component(this.props));
    this.reconcileIframeRefs();
    const effects = this.pendingEffects;
    this.pendingEffects = [];
    effects.forEach(index => {
      const hook = this.hooks[index];
      hook.cleanup?.();
      hook.cleanup = hook.effect() || null;
    });
  }

  flush() {
    let renders = 0;
    while (this.dirty) {
      this.dirty = false;
      this.renderOnce();
      renders += 1;
      assert.ok(renders < 30, 'hook harness detected an update loop');
    }
  }

  reconcileIframeRefs() {
    const nextFrames = new Map();
    this.nodes('iframe').forEach(frame => {
      const identity = String(frame.key);
      const existing = this.mountedFrames.get(identity);
      const mounted = existing || {
        node: { contentWindow: { frame: identity }, blur() {} },
        ref: null,
      };
      if (mounted.ref !== frame.props.ref) {
        mounted.ref?.(null);
        frame.props.ref?.(mounted.node);
      }
      mounted.ref = frame.props.ref;
      mounted.vnode = frame;
      nextFrames.set(identity, mounted);
    });
    this.mountedFrames.forEach((mounted, identity) => {
      if (!nextFrames.has(identity)) mounted.ref?.(null);
    });
    this.mountedFrames = nextFrames;
  }

  nodes(type) {
    return flattenNodes(this.tree, this.runtime.Fragment).filter(node => node.type === type);
  }

  frameNode(key) {
    return this.mountedFrames.get(String(key))?.node;
  }

  fireLoad(key) {
    const mounted = this.mountedFrames.get(String(key));
    assert.ok(mounted, `iframe ${String(key)} is not mounted`);
    mounted.vnode.props.onLoad({ currentTarget: mounted.node });
    this.flush();
  }

  firePaintReady(key, type = 'html-editor-buffer-visuals-ready') {
    const mounted = this.mountedFrames.get(String(key));
    assert.ok(mounted, `iframe ${String(key)} is not mounted`);
    this.animationWindow.dispatchMessage(mounted.node.contentWindow, { type });
    this.flush();
  }

  advanceFrame() {
    this.animationWindow.advanceFrame();
    this.flush();
  }

  unmount() {
    this.mountedFrames.forEach(mounted => mounted.ref?.(null));
    this.mountedFrames.clear();
    this.hooks.forEach(hook => {
      if (hook?.kind === 'effect') hook.cleanup?.();
    });
  }
}

function hasClass(node, className) {
  return String(node.props.className || '').split(/\s+/).includes(className);
}

function visibleFrames(renderer) {
  return renderer.nodes('iframe').filter(frame => (
    !hasClass(frame, 'opacity-0') && !hasClass(frame, 'opacity-[0.01]')
  ));
}

function paintShield(renderer) {
  return flattenNodes(renderer.tree, renderer.runtime.Fragment).find(node => (
    node.props?.['data-html-buffered-iframe-paint-shield'] !== undefined
  ));
}

function assertNeverWhite(renderer, expectation) {
  const shield = paintShield(renderer);
  const paintedFrames = visibleFrames(renderer);
  if (shield) {
    const color = String(shield.props.style?.backgroundColor || '').toLowerCase();
    assert.ok(color, `${expectation}: paint shield must be opaque`);
    assert.ok(!['white', '#fff', '#ffffff', 'rgb(255,255,255)', 'rgba(255,255,255,1)'].includes(
      color.replace(/\s+/g, ''),
    ), `${expectation}: paint shield must never be white`);
    return;
  }
  assert.ok(paintedFrames.length > 0, `${expectation}: no painted iframe and no paint shield`);
  paintedFrames.forEach(frame => {
    assert.ok(
      String(frame.props.srcDoc || '').length > 0
        || !['', 'about:blank', 'about:srcdoc'].includes(String(frame.props.src || '').toLowerCase()),
      `${expectation}: an empty browsing context became visible`,
    );
  });
}

assert.match(
  bufferedIframeSource,
  /visibleDocumentHasContent[\s\S]*?if \(!visualReady \|\| !visibleDocumentHasContent\) return;[\s\S]*?data-html-buffered-iframe-paint-shield[\s\S]*?backgroundColor: paintShieldColor/,
  'an empty/about:blank first document must stay behind an opaque, non-white paint shield',
);
assert.match(
  bufferedIframeSource,
  /paintShieldColor = '#111315'/,
  'the first-paint shield must have an explicit non-white fallback color',
);
assert.match(
  bufferedIframeSource,
  /mountKey: `buffered-document-\$\{documentInstanceSequenceRef\.current\}`[\s\S]*?key=\{document\.mountKey\}/,
  'React iframe identity must be unique even when page and component generations collide',
);
assert.match(
  bufferedIframeSource,
  /fully transparent\/hidden subtree may be skipped[\s\S]*?document\.retained \|\| \(document\.pending && !incoming\)[\s\S]*?'opacity-\[0\.01\] will-change-\[opacity\]'/,
  'buffered generations must retain non-zero composited opacity before promotion',
);
assert.doesNotMatch(
  bufferedIframeSource,
  /\(document\.retained \|\| \(document\.pending && !incoming\)\) && 'invisible'/,
  'visibility:hidden must not prevent Chromium from painting the buffered iframe',
);
assert.match(
  bufferedIframeSource,
  /isBufferedDocumentPaintReadyMessage[\s\S]*?return type === 'html-editor-buffer-visuals-ready'[\s\S]*?paintReadyDocumentMountKeysRef[\s\S]*?if \(!visualReady \|\| promotionScheduled\) return;[\s\S]*?firstPromotionFrame = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?secondPromotionFrame = window\.requestAnimationFrame\(\(\) => \{[\s\S]*?promote\(\)/,
  'promotion must require an explicit bridge paint signal, caller readiness and two compositor frames',
);
assert.doesNotMatch(
  bufferedIframeSource,
  /return type === 'html-editor-first-content-ready'|return type === 'html-editor-canvas-ready'/,
  'DOM/metric-ready bridge messages must not reveal a surface before visual assets settle',
);
assert.doesNotMatch(
  bufferedIframeSource,
  /loadedDocumentMountKeysRef/,
  'iframe load alone must never be treated as proof that authored content painted',
);
assert.match(
  bufferedIframeSource,
  /role="status"[\s\S]*?aria-label="Renderizando projeto"[\s\S]*?Renderizando projeto…/,
  'cold start must show an explicit render state instead of a blank black/white canvas',
);
assert.match(
  bufferedIframeSource,
  /builderLoading \? \([\s\S]*?<KodetyLoadingScreen[\s\S]*?label="Carregando componente"/,
  'component loading must reuse the clean Builder loading screen',
);
assert.match(
  canvasStageSource,
  /visualReadyKey=\{editorSurfaceVisualReadyKey\}[\s\S]*?builderLoading[\s\S]*?title="Canvas persistente do componente HTML"/,
  'only the component canvas must opt into the clean Builder loading treatment',
);
assert.match(
  bufferedIframeSource,
  /const source = document\.src\.trim\(\)\.toLowerCase\(\);[\s\S]*?source !== 'about:blank'[\s\S]*?const handleVisibleLoad[\s\S]*?if \(!bufferedDocumentHasContent\(document\)\) return;[\s\S]*?onLoad\?\./,
  'about:blank must neither reveal nor trigger the expensive parent hydration path',
);
assert.match(
  bufferedIframeSource,
  /visualReadyKey,[\s\S]*?\]\);/,
  'a changing component measurement must restart the compositor barrier',
);

const iframeSurfaceHandshake = extractSection(
  previewSource,
  'let bridgeMessageListenersReady = false;',
  'const iframeRuntimeObjectUrls = new Map();',
);
const iframeSurfaceLifecycle = extractSection(
  previewSource,
  'let bridgeMessageListenersReady = false;',
  '    let editorBridgeStarted = false;',
);
assert.match(
  iframeSurfaceHandshake,
  /waitForDomReady[\s\S]*?DOMContentLoaded[\s\S]*?PREVIEW_SURFACE_DOM_SETTLE_MS/,
  'the iframe handshake must begin only after its authored DOM has parsed',
);
assert.match(
  iframeSurfaceHandshake,
  /waitForStylesheets[\s\S]*?link\[rel~="stylesheet"\]\[href\][\s\S]*?PREVIEW_SURFACE_STYLE_SETTLE_MS/,
  'stylesheet settlement must be observed with a bounded fail-open',
);
assert.match(
  iframeSurfaceHandshake,
  /waitForDocumentFonts[\s\S]*?document\.fonts\?\.ready[\s\S]*?PREVIEW_SURFACE_FONT_SETTLE_MS/,
  'font metrics must settle before paint readiness, without an unbounded wait',
);
assert.match(
  iframeSurfaceHandshake,
  /waitForTwoPaintFrames[\s\S]*?requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)[\s\S]*?\.then\(waitForTwoPaintFrames\)[\s\S]*?surfacePaintSettled = true/,
  'ready must cross two iframe-owned compositor frames before any surface signal',
);
assert.match(
  iframeSurfaceHandshake,
  /!surfacePaintSettled[\s\S]*?html-editor-first-content-ready[\s\S]*?html-editor-canvas-ready/,
  'all parent-consumed ready signals must share the paint-settled gate',
);
assert.match(
  iframeSurfaceHandshake,
  /surfaceAssetsReady = true;[\s\S]*?startSurfacePaintHandshake\(\)/,
  'runtime font assets or their bounded fail-open must precede the paint handshake',
);
assert.doesNotMatch(
  iframeSurfaceHandshake,
  /setTimeout\(postReady/,
  'a timer must never bypass the two-frame paint barrier',
);
assert.match(
  iframeSurfaceHandshake,
  /Promise\.race\(\[[\s\S]*?visibleImages\.map\(waitForImage\)[\s\S]*?PREVIEW_SURFACE_MEDIA_SETTLE_MS/,
  'optional media settlement must have a bounded fail-open',
);
assert.match(
  iframeSurfaceLifecycle,
  /let bufferedVisibleImagesSettled = false;[\s\S]*?scheduleBufferedVisualAssetSettlement\(\)/,
  'remote visible images must be inspected even without project asset placeholders',
);
assert.match(
  iframeSurfaceHandshake,
  /html-editor-buffer-visuals-ready'[\s\S]*?timedOut: timeoutReasons\.length > 0[\s\S]*?timeoutReasons/,
  'the strong visual-ready signal must explicitly report bounded settlement timeouts',
);
assert.match(
  iframeSurfaceLifecycle,
  /visualSettlementTimeoutReasons\.add\('runtime-fonts'\);[\s\S]*?bufferedFontsSettled = true;[\s\S]*?revealCanvasAndSignalReady\(\)/,
  'runtime-font fail-open must release the strong visual-ready gate and report its timeout',
);
assert.match(
  iframeSurfaceHandshake,
  /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{[\s\S]*?bufferedVisibleImagesSettled = true;[\s\S]*?maybeSignalBufferedVisualsReady\(\)/,
  'the strong ready signal must follow media settlement and two paint frames',
);

const iframeBridgeTemplate = extractSection(
  previewSource,
  'bridge.textContent = `',
  "`;\n  bridge.setAttribute('data-html-editor-bridge'",
).slice('bridge.textContent = `'.length);
const substitutedIframeBridgeTemplate = iframeBridgeTemplate
  .replaceAll("${inspectionEnabled ? \"'canvas'\" : \"'preview'\"}", "'canvas'")
  .replaceAll("${inspectionEnabled ? 'true' : 'false'}", 'true')
  .replaceAll("${contentEditing ? 'true' : 'false'}", 'false')
  .replaceAll("${freezeMotion ? 'true' : 'false'}", 'true')
  .replaceAll("${infiniteCanvasNavigation ? 'true' : 'false'}", 'false')
  .replaceAll('${serializedInitialScrollPositions}', '{}')
  .replaceAll('${serializedCanvasGeneration}', '"test-generation"')
  .replaceAll('${serializedCanvasRevision}', '1')
  .replaceAll('${serializedPreviewSiteUrl}', '""')
  .replaceAll('${serializedCssShorthandLonghands}', '{}')
  .replaceAll('${CANVAS_FONTS_RUNTIME}', '')
  .replaceAll('${serializedRuntimeAssets}', '{"urls":{},"pathAliases":{},"availablePaths":[],"baseFile":"index.html","rootPath":""}')
  .replaceAll('${serializedRuntimeFontAssetPaths}', '[]')
  .replaceAll('${PREVIEW_SURFACE_DOM_SETTLE_MS}', '1500')
  .replaceAll('${PREVIEW_SURFACE_STYLE_SETTLE_MS}', '3000')
  .replaceAll('${PREVIEW_SURFACE_FONT_SETTLE_MS}', '2500')
  .replaceAll('${PREVIEW_SURFACE_MEDIA_SETTLE_MS}', '5000')
  .replaceAll('${PREVIEW_SURFACE_TOTAL_SETTLE_MS}', '8000')
  .replaceAll('${PREVIEW_RUNTIME_FONT_SETTLE_MS}', '300')
  .replaceAll('${serializedAuthoredCmsBindingSnapshots}', '{}')
  .replaceAll('${serializedInitialCmsPreview}', 'null')
  .replaceAll('${PREVIEW_RUNTIME_FONT_FAIL_OPEN_MS}', '500');
assert.doesNotMatch(substitutedIframeBridgeTemplate, /\$\{/);
const generatedIframeBridge = new Function(
  'return `' + substitutedIframeBridgeTemplate + '`;',
)();
assert.doesNotThrow(
  () => new Function(generatedIframeBridge),
  'the generated iframe bridge must remain valid JavaScript',
);

assert.match(
  canvasStageSource,
  /measuredComponentCanvasSize[\s\S]*?componentCanvasSize\.generation === \(editorCanvasPreview\?\.generation \|\| ''\)[\s\S]*?effectiveComponentCanvasSize[\s\S]*?editorSurfaceVisualReady[\s\S]*?effectiveComponentCanvasSize/,
  'a component surface must use only its current measurement or a semantic-surface-scoped cached measurement',
);
assert.match(
  canvasStageSource,
  /const componentLayoutViewport = \{[\s\S]*?width: Math\.max\(1, Math\.ceil\(currentViewport\.width\)\),[\s\S]*?height: Math\.max\(1, Math\.ceil\(currentViewport\.height\)\)/,
  'the component iframe must keep a stable breakpoint layout viewport',
);
assert.match(
  canvasStageSource,
  /const componentMeasurementCacheKey = \[[\s\S]*?editorCanvasSemanticSurfaceKey,[\s\S]*?viewport,[\s\S]*?componentLayoutViewport\.width[\s\S]*?componentLayoutViewport\.height/,
  'component measurements must be scoped to the semantic surface and breakpoint geometry',
);
assert.match(
  canvasStageSource,
  /componentCanvasSize\.layoutWidth - componentLayoutViewport\.width[\s\S]*?componentCanvasSize\.layoutHeight - componentLayoutViewport\.height/,
  'measurements from a stale layout viewport must never reveal a component generation',
);
assert.match(
  canvasStageSource,
  /width: Math\.max\([\s\S]*?Math\.min\(componentLayoutViewport\.width, Math\.ceil\(effectiveComponentCanvasSize\.width\)\)[\s\S]*?height: Math\.max\([\s\S]*?Math\.min\(componentLayoutViewport\.height, Math\.ceil\(effectiveComponentCanvasSize\.height\)\)/,
  'the outer crop must use measured content bounds without growing past the stable layout viewport',
);
assert.match(
  canvasStageSource,
  /title="Canvas persistente do componente HTML"[\s\S]*?style=\{\{[\s\S]*?width: componentLayoutViewport\.width,[\s\S]*?height: componentLayoutViewport\.height/,
  'the actual component iframe must not feed its measured crop back into vh/vw layout',
);
// Evaluate the actual class expression, independent of line wrapping and
// additional transition properties such as transform.
const ts = require('typescript');
const stageAst = ts.createSourceFile('HtmlEditorCanvasStage.tsx', canvasStageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const transitionExpressions = [];
function collectTransitionExpressions(node) {
  if (ts.isCallExpression(node) && node.expression.getText(stageAst) === 'cn') {
    for (const argument of node.arguments) {
      if (/transition-\[width,height(?:,transform)?\]/.test(argument.getText(stageAst))) transitionExpressions.push(argument.getText(stageAst));
    }
  }
  ts.forEachChild(node, collectTransitionExpressions);
}
collectTransitionExpressions(stageAst);
assert.ok(transitionExpressions.length, 'find the real viewport transition expression');
for (const expression of transitionExpressions) {
  for (const editingHtmlComponent of [false, true]) {
    for (const resizingViewport of [false, true]) {
      const value = vm.runInNewContext(expression, { editingHtmlComponent, resizingViewport });
      assert.equal(Boolean(value), !editingHtmlComponent && !resizingViewport,
        'component measurements and dragging resize must apply immediately; page transitions remain enabled');
    }
  }
}
assert.match(
  canvasStageSource,
  /data-editor-canvas-surface[\s\S]*?aria-hidden=\{isPreviewing \|\| undefined\}[\s\S]*?data-runtime-preview-surface[\s\S]*?!runtimeSurfacePainted[\s\S]*?setRuntimeSurfacePainted\(true\)/,
  'Design must remain painted below runtime Preview until Preview has real content',
);
assert.match(
  canvasStageSource,
  /onInitialVisualReady=\{\(node, documentKey, documentRevision, surfaceKey\) => \{[\s\S]*?handleEditorInitialVisualReady\(node, documentKey, documentRevision, surfaceKey\)/,
  'each isolated editor canvas must report its first visual-ready identity to the global project gate',
);
assert.match(
  canvasStageSource,
  /const ownerChanged = previousEditorSurfaceOwnerKeyRef\.current !== editorSurfaceOwnerKey;[\s\S]*?if \(!ownerChanged && activated\?\.identity === identity && activated\.node === node\) return;[\s\S]*?queueMicrotask\(\(\) => \{[\s\S]*?activeEditorSurfaceOwnerKeyRef\.current !== editorSurfaceOwnerKey[\s\S]*?setEditorCanvasIframeNode\(node\);[\s\S]*?handleEditorCanvasPromotion\(/,
  'a retained page/component must reclaim canvas message authority after the parent surface reset, not before it',
);
assert.match(
  projectEditorSource,
  /canvasSemanticSurfaceKeyRef\.current = editorCanvasSemanticSurfaceKey;[\s\S]*?activeCanvasGenerationRef\.current = '';[\s\S]*?canvasReadyRef\.current = null;/,
  'a semantic surface switch must still quarantine the outgoing iframe before the retained surface is reactivated',
);
assert.match(
  projectEditorSource,
  /activeCanvasAuthorityRef = useRef<[\s\S]*?node: HTMLIFrameElement;[\s\S]*?frame: Window;[\s\S]*?generation: string;/,
  'active canvas frame and generation must be stored as one atomic authority',
);
assert.match(
  projectEditorSource,
  /promotedCanvasDocumentByNodeRef = useRef\(new WeakMap<HTMLIFrameElement,[\s\S]*?promotedCanvasDocumentByNodeRef\.current\.set\(node, promoted\)[\s\S]*?const promoted = promotedCanvasDocumentByNodeRef\.current\.get\(node\)/,
  'returning from a component must recover the generation promoted for the exact page iframe',
);
assert.match(
  projectEditorSource,
  /\}, \[activeSurfacePreview\?\.generation, editorCanvasSemanticSurfaceKey, isPreviewing\]\);/,
  'semantic page/component switches must synchronously restore the node-scoped canvas authority',
);
assert.match(
  projectEditorSource,
  /const authority = activeCanvasAuthorityRef\.current;[\s\S]*?isCanvasToEditorMessage\(event\.data, expectedGeneration\)[\s\S]*?event\.source !== authority\?\.frame/,
  'canvas messages must validate generation and source against the same promoted authority',
);
assert.match(
  projectEditorSource,
  /activeCanvasGenerationRef\.current = '';\s*activeCanvasAuthorityRef\.current = null;[\s\S]*?setCanvasVisibilitySnapshot\(null\);[\s\S]*?canvasReadyRef\.current = null;/,
  'surface quarantine must revoke the atomic canvas authority',
);

const noProjectFallbackIndex = projectEditorSource.indexOf('\n  if (!project) {');
const paintedProjectGateIndex = projectEditorSource.indexOf('{editorCanvasLoading && (');
assert.notEqual(noProjectFallbackIndex, -1, 'the editor must retain its no-project fallback');
assert.ok(
  paintedProjectGateIndex > noProjectFallbackIndex,
  'the first-paint loader must remain mounted inside the branch where project is already non-null',
);
assert.match(
  projectEditorSource,
  /const editorCanvasLoading = Boolean\([\s\S]*?!isPreviewing[\s\S]*?paintedProjectOpenedAt !== project\.openedAt[\s\S]*?\{editorCanvasLoading && \([\s\S]*?<KodetyLoadingScreen[\s\S]*?fixed inset-0 z-\[20000\][\s\S]*?label="Carregando projeto"/,
  'a loaded project must keep an opaque global loader until its canvas paints',
);
const editorCanvasLoadingSource = projectEditorSource.slice(
  projectEditorSource.indexOf('const editorCanvasLoading = Boolean('),
  projectEditorSource.indexOf('const importPublishPanelOpenedRef'),
);
assert.doesNotMatch(
  editorCanvasLoadingSource,
  /importPublishReviewPending/,
  'post-import review state must never disable the opaque canvas paint barrier',
);
assert.match(
  previewSource,
  /PREVIEW_SURFACE_TOTAL_SETTLE_MS = 8_000[\s\S]*?bufferedVisualsFailOpenTimer = setTimeout\([\s\S]*?visualSettlementTimeoutReasons\.add\('total'\)[\s\S]*?surfacePaintSettled = true[\s\S]*?bufferedFontsSettled = true[\s\S]*?bufferedInitialAssetSweepComplete = true[\s\S]*?bufferedVisibleImagesSettled = true[\s\S]*?maybeSignalBufferedVisualsReady\(\)/,
  'the canvas must fail open after one absolute visual deadline even when authored media keeps restarting settlement',
);
assert.match(
  projectEditorSource,
  /const acceptEditorVisualReady = \([\s\S]*?node !== editorCanvasIframeRef\.current[\s\S]*?generation !== expected\.generation[\s\S]*?revision !== expected\.revision[\s\S]*?surfaceKey !== editorCanvasSemanticSurfaceKey[\s\S]*?paintedProjectOpenedAtRef\.current = currentProject\.openedAt;[\s\S]*?setPaintedProjectOpenedAt\(currentProject\.openedAt\)/,
  'global readiness must validate the actual iframe, generation, revision and semantic surface',
);
assert.match(
  projectEditorSource,
  /if \(preservePaintedSurface\) \{[\s\S]*?paintedProjectOpenedAtRef\.current = next\.openedAt;[\s\S]*?setPaintedProjectOpenedAt\(next\.openedAt\);[\s\S]*?\} else if \(replaceWordPressWorkspace\)/,
  'a late startup refresh must keep the already-painted surface and prevent global loader re-entry',
);
assert.match(
  projectEditorSource,
  /if \(!localBootstrap && !preservePaintedSurface\) \{[\s\S]*?toast\.success\('Projeto carregado'/,
  'background revalidation must not announce the same project as a second user open',
);
assert.match(
  projectEditorSource,
  /const handleEditorInitialVisualReady = \([\s\S]*?if \(!acceptEditorVisualReady\(node, generation, revision, surfaceKey\)\) return false;[\s\S]*?revision >= observation\.minimumRevision[\s\S]*?finishWordPressFirstCanvasVisualReady\('ok'\);[\s\S]*?return true;[\s\S]*?const handleEditorCanvasPromotion = \([\s\S]*?activateBufferedCanvasSurface\([\s\S]*?acceptEditorVisualReady\(node, generation, revision, surfaceKey\)/,
  'the strong readiness callback must finish observability only after the shared identity-safe gate',
);
const editorPromotionSource = projectEditorSource.slice(
  projectEditorSource.indexOf('const handleEditorCanvasPromotion = ('),
  projectEditorSource.indexOf('  const handleRuntimePreviewPromotion = ('),
);
assert.doesNotMatch(
  editorPromotionSource,
  /finishWordPressFirstCanvasVisualReady/,
  'promotion or retained-surface reactivation must not impersonate a fresh visuals-ready signal',
);

// Execute the production gate itself. A late callback from the previous
// project/surface must never dismiss the full-screen loader for the current
// generation, even if React has already committed its newer callback props.
const evaluateInitialVisualReadyGate = compileEditorInitialVisualReadyGateForRuntimeTest();
const expectedCanvasNode = {};
const exactInitialReady = {
  node: expectedCanvasNode,
  currentNode: expectedCanvasNode,
  generation: 'generation-current',
  revision: 7,
  surfaceKey: 'surface-current',
  expectedGeneration: 'generation-current',
  expectedRevision: 7,
  expectedSurfaceKey: 'surface-current',
  projectOpenedAt: 731,
};
assert.equal(
  evaluateInitialVisualReadyGate(exactInitialReady),
  731,
  'the exact painted canvas identity must release the global project loader',
);
assert.equal(
  evaluateInitialVisualReadyGate({ ...exactInitialReady, viaPromotion: true }),
  731,
  'an exact buffered promotion must release the loader when a second project is opened',
);
for (const [label, staleIdentity] of [
  ['iframe', { node: {} }],
  ['generation', { generation: 'generation-old' }],
  ['revision', { revision: 6 }],
  ['semantic surface', { surfaceKey: 'surface-old' }],
]) {
  assert.equal(
    evaluateInitialVisualReadyGate({ ...exactInitialReady, ...staleIdentity }),
    null,
    `a stale ${label} callback must not release the current project loader`,
  );
  assert.equal(
    evaluateInitialVisualReadyGate({
      ...exactInitialReady,
      ...staleIdentity,
      viaPromotion: true,
    }),
    null,
    `a stale ${label} promotion must not release the current project loader`,
  );
}

// Exercise the production HtmlBufferedIframe state machine instead of only
// checking its source. The renderer implements the small React hook/ref subset
// used by this component and gives us deterministic control of paint frames.
const animationWindow = createAnimationWindow();
const bufferedRuntime = compileBufferedIframeForRuntimeTest(animationWindow);
const defaultProps = {
  surfaceKey: 'component:hero',
  documentRevision: 1,
  retainDocument: true,
  iframeRef: () => {},
  onLoad: () => {},
};

let emptyLoadCount = 0;
const emptyRenderer = new HookRenderer(
  bufferedRuntime,
  animationWindow,
  bufferedRuntime.Component,
  {
    ...defaultProps,
    documentKey: '',
    src: 'about:blank',
    srcDoc: '',
    onLoad: () => { emptyLoadCount += 1; },
  },
);
assertNeverWhite(emptyRenderer, 'empty initial document');
const [emptyFrame] = emptyRenderer.nodes('iframe');
assert.ok(
  hasClass(emptyFrame, 'opacity-[0.01]'),
  'the initial about:blank iframe must stay almost transparent but rasterizable behind the shield',
);
emptyRenderer.fireLoad(emptyFrame.key);
for (let frame = 0; frame < 4; frame += 1) emptyRenderer.advanceFrame();
assertNeverWhite(emptyRenderer, 'about:blank load fallback');
assert.equal(emptyLoadCount, 0, 'about:blank must not trigger parent canvas hydration');
emptyRenderer.unmount();

let initialVisualReadyPayload = null;
const measuredRenderer = new HookRenderer(
  bufferedRuntime,
  animationWindow,
  bufferedRuntime.Component,
  {
    ...defaultProps,
    documentKey: 'generation-1',
    srcDoc: '<!doctype html><main>Hero</main>',
    visualReady: false,
    visualReadyKey: '',
    onInitialVisualReady: (node, key, revision, readySurfaceKey) => {
      initialVisualReadyPayload = { node, key, revision, surfaceKey: readySurfaceKey };
    },
  },
);
const [measuringFrame] = measuredRenderer.nodes('iframe');
measuredRenderer.fireLoad(measuringFrame.key);
for (let frame = 0; frame < 4; frame += 1) measuredRenderer.advanceFrame();
assertNeverWhite(measuredRenderer, 'component waiting for its first measurement');
assert.ok(paintShield(measuredRenderer), 'load alone must not bypass visualReady');
measuredRenderer.firePaintReady(measuringFrame.key);
for (let frame = 0; frame < 2; frame += 1) measuredRenderer.advanceFrame();
assert.ok(
  paintShield(measuredRenderer),
  'a real paint signal must remain gated until the component measurement is ready',
);

measuredRenderer.updateProps({
  visualReady: true,
  visualReadyKey: 'generation-1:1440x457',
});
measuredRenderer.advanceFrame();
assert.ok(paintShield(measuredRenderer), 'the first compositor frame must keep the shield');
measuredRenderer.advanceFrame();
assertNeverWhite(measuredRenderer, 'measured component reveal');
assert.equal(paintShield(measuredRenderer), undefined, 'the shield should leave only after two frames');
assert.equal(visibleFrames(measuredRenderer).length, 1);
assert.deepEqual(initialVisualReadyPayload, {
  node: measuredRenderer.frameNode(measuringFrame.key),
  key: 'generation-1',
  revision: 1,
  surfaceKey: 'component:hero',
}, 'initial readiness must identify the exact painted browsing context');

measuredRenderer.updateProps({
  documentKey: 'generation-2',
  documentRevision: 2,
  srcDoc: '<!doctype html><main>Updated hero</main>',
  visualReady: false,
  visualReadyKey: '',
});
let frames = measuredRenderer.nodes('iframe');
assert.equal(frames.length, 2, 'the next document must mount beside the painted generation');
let painted = visibleFrames(measuredRenderer);
assert.equal(painted.length, 1);
assert.match(painted[0].props.srcDoc, />Hero</, 'the old generation must remain painted');
const pendingFrame = frames.find(frame => frame.props['aria-hidden'] === true);
assert.ok(pendingFrame);
assert.match(pendingFrame.props.srcDoc, /Updated hero/);
measuredRenderer.fireLoad(pendingFrame.key);
for (let frame = 0; frame < 4; frame += 1) measuredRenderer.advanceFrame();
assertNeverWhite(measuredRenderer, 'loaded update waiting for component measurement');
painted = visibleFrames(measuredRenderer);
assert.equal(painted.length, 1);
assert.match(painted[0].props.srcDoc, />Hero</, 'load must not reveal an unmeasured generation');

measuredRenderer.updateProps({
  visualReady: true,
  visualReadyKey: 'generation-2:1440x612',
});
for (let frame = 0; frame < 4; frame += 1) measuredRenderer.advanceFrame();
assert.match(
  visibleFrames(measuredRenderer)[0].props.srcDoc,
  />Hero</,
  'load plus layout readiness must not promote without a bridge paint signal',
);
animationWindow.dispatchMessage({ unrelated: true }, {
  type: 'html-editor-buffer-visuals-ready',
});
for (let frame = 0; frame < 4; frame += 1) measuredRenderer.advanceFrame();
assert.match(
  visibleFrames(measuredRenderer)[0].props.srcDoc,
  />Hero</,
  'a readiness signal from another browsing context must be ignored',
);
measuredRenderer.firePaintReady(pendingFrame.key, 'html-editor-first-content-ready');
measuredRenderer.firePaintReady(pendingFrame.key, 'html-editor-canvas-ready');
for (let frame = 0; frame < 4; frame += 1) measuredRenderer.advanceFrame();
assert.match(
  visibleFrames(measuredRenderer)[0].props.srcDoc,
  />Hero</,
  'DOM and metric readiness must not promote before visual asset settlement',
);
measuredRenderer.firePaintReady(pendingFrame.key);
measuredRenderer.advanceFrame();
assert.match(visibleFrames(measuredRenderer)[0].props.srcDoc, />Hero</);
measuredRenderer.advanceFrame();
assertNeverWhite(measuredRenderer, 'atomic measured-generation promotion');
painted = visibleFrames(measuredRenderer);
assert.equal(painted.length, 1);
assert.match(painted[0].props.srcDoc, /Updated hero/);
assert.equal(
  painted[0].props['aria-hidden'],
  true,
  'a newly painted generation must remain inert until the parent accepts its generation',
);
assert.ok(hasClass(painted[0], 'pointer-events-none'));
for (let frame = 0; frame < 4; frame += 1) measuredRenderer.advanceFrame();
painted = visibleFrames(measuredRenderer);
assert.notEqual(painted[0].props['aria-hidden'], true);
assert.ok(!hasClass(painted[0], 'pointer-events-none'));
assert.equal(paintShield(measuredRenderer), undefined);
measuredRenderer.unmount();

// Keep more than one semantic surface alive. This models the expensive path
// that used to evict the page iframe: page P -> component variant A -> variant
// B -> Done/P. Returning to P must reuse the exact already-painted browsing
// context, without mounting a replacement or waiting for another load.
const retainedPromotions = [];
const retainedRenderer = new HookRenderer(
  bufferedRuntime,
  animationWindow,
  bufferedRuntime.Component,
  {
    ...defaultProps,
    surfaceKey: 'page:P',
    documentKey: 'page-P-r1',
    srcDoc: '<!doctype html><main>Page P</main>',
    pinRetainedDocument: true,
    visualReady: true,
    visualReadyKey: 'page-P-r1',
    onPromote: (_node, key, _revision, promotedSurfaceKey, kind) => {
      retainedPromotions.push({ key, surfaceKey: promotedSurfaceKey, kind });
    },
  },
);
const pageFrame = retainedRenderer.nodes('iframe').find(frame => /Page P/.test(frame.props.srcDoc));
assert.ok(pageFrame);
const pageMountKey = pageFrame.key;
const pageBrowsingContext = retainedRenderer.frameNode(pageMountKey);
retainedRenderer.fireLoad(pageMountKey);
retainedRenderer.firePaintReady(pageMountKey);
for (let frame = 0; frame < 4; frame += 1) retainedRenderer.advanceFrame();

// Demote P's pin through another page transaction, then reactivate P. The
// current pin prop must be applied to the cached browsing context; otherwise a
// later long component-edit session can still evict the return page.
retainedRenderer.updateProps({
  surfaceKey: 'page:Q',
  documentKey: 'page-Q-r1',
  srcDoc: '<!doctype html><main>Page Q</main>',
  visualReadyKey: 'page-Q-r1',
  pinRetainedDocument: true,
});
let navigationFrame = retainedRenderer.nodes('iframe').find(frame => /Page Q/.test(frame.props.srcDoc));
assert.ok(navigationFrame);
retainedRenderer.fireLoad(navigationFrame.key);
retainedRenderer.firePaintReady(navigationFrame.key);
for (let frame = 0; frame < 4; frame += 1) retainedRenderer.advanceFrame();
retainedRenderer.updateProps({
  surfaceKey: 'component:q:temporary',
  documentKey: 'component-q-r1',
  srcDoc: '<!doctype html><main>Component Q</main>',
  visualReadyKey: 'component-q-r1',
  pinRetainedDocument: false,
});
navigationFrame = retainedRenderer.nodes('iframe').find(frame => /Component Q/.test(frame.props.srcDoc));
assert.ok(navigationFrame);
retainedRenderer.fireLoad(navigationFrame.key);
retainedRenderer.firePaintReady(navigationFrame.key);
for (let frame = 0; frame < 4; frame += 1) retainedRenderer.advanceFrame();
retainedRenderer.updateProps({
  surfaceKey: 'page:Q',
  documentKey: 'page-Q-r1',
  srcDoc: '<!doctype html><main>Page Q</main>',
  visualReadyKey: 'page-Q-r1',
  pinRetainedDocument: true,
});
for (let frame = 0; frame < 2; frame += 1) retainedRenderer.advanceFrame();
retainedRenderer.updateProps({
  surfaceKey: 'page:P',
  documentKey: 'page-P-r1',
  srcDoc: '<!doctype html><main>Page P</main>',
  visualReadyKey: 'page-P-r1',
  pinRetainedDocument: true,
});
assert.match(visibleFrames(retainedRenderer)[0].props.srcDoc, /Page P/);
assert.equal(retainedRenderer.frameNode(pageMountKey), pageBrowsingContext);
for (let frame = 0; frame < 2; frame += 1) retainedRenderer.advanceFrame();

retainedRenderer.updateProps({
  surfaceKey: 'component:hero:variant-A',
  documentKey: 'component-hero-A-r1',
  srcDoc: '<!doctype html><main>Variant A</main>',
  pinRetainedDocument: false,
  visualReadyKey: 'component-hero-A-r1',
});
let variantFrame = retainedRenderer.nodes('iframe').find(frame => /Variant A/.test(frame.props.srcDoc));
assert.ok(variantFrame, 'variant A must buffer beside page P');
retainedRenderer.fireLoad(variantFrame.key);
retainedRenderer.firePaintReady(variantFrame.key);
for (let frame = 0; frame < 4; frame += 1) retainedRenderer.advanceFrame();
assert.match(visibleFrames(retainedRenderer)[0].props.srcDoc, /Variant A/);
assert.equal(
  retainedRenderer.frameNode(pageMountKey),
  pageBrowsingContext,
  'opening variant A must keep page P mounted',
);

retainedRenderer.updateProps({
  surfaceKey: 'component:hero:variant-B',
  documentKey: 'component-hero-B-r1',
  srcDoc: '<!doctype html><main>Variant B</main>',
  pinRetainedDocument: false,
  visualReadyKey: 'component-hero-B-r1',
});
variantFrame = retainedRenderer.nodes('iframe').find(frame => /Variant B/.test(frame.props.srcDoc));
assert.ok(variantFrame, 'variant B must buffer without evicting earlier surfaces');
retainedRenderer.fireLoad(variantFrame.key);
retainedRenderer.firePaintReady(variantFrame.key);
for (let frame = 0; frame < 4; frame += 1) retainedRenderer.advanceFrame();
assert.match(visibleFrames(retainedRenderer)[0].props.srcDoc, /Variant B/);
assert.equal(
  retainedRenderer.frameNode(pageMountKey),
  pageBrowsingContext,
  'opening variant B must not dismantle page P',
);

for (const variantName of ['C', 'D', 'E', 'F', 'G', 'H']) {
  retainedRenderer.updateProps({
    surfaceKey: `component:hero:variant-${variantName}`,
    documentKey: `component-hero-${variantName}-r1`,
    srcDoc: `<!doctype html><main>Variant ${variantName}</main>`,
    visualReadyKey: `component-hero-${variantName}-r1`,
    pinRetainedDocument: false,
  });
  const nextVariantFrame = retainedRenderer.nodes('iframe').find(frame => (
    frame.props.srcDoc.includes(`Variant ${variantName}`)
  ));
  assert.ok(nextVariantFrame, `variant ${variantName} must enter the bounded cache`);
  retainedRenderer.fireLoad(nextVariantFrame.key);
  retainedRenderer.firePaintReady(nextVariantFrame.key);
  for (let frame = 0; frame < 4; frame += 1) retainedRenderer.advanceFrame();
  assert.equal(
    retainedRenderer.frameNode(pageMountKey),
    pageBrowsingContext,
    `variant ${variantName} must not evict the pinned return page`,
  );
}

retainedRenderer.updateProps({
  surfaceKey: 'page:P',
  documentKey: 'page-P-r1',
  srcDoc: '<!doctype html><main>Page P</main>',
  visualReadyKey: 'page-P-r1',
  pinRetainedDocument: true,
});
assertNeverWhite(retainedRenderer, 'instant Done return to page P');
assert.match(
  visibleFrames(retainedRenderer)[0].props.srcDoc,
  /Page P/,
  'Done must reveal the retained page synchronously',
);
assert.equal(
  retainedRenderer.frameNode(pageMountKey),
  pageBrowsingContext,
  'Done must reactivate the exact original page browsing context',
);
assert.equal(
  retainedRenderer.nodes('iframe').length,
  4,
  'the pinned page plus the three-surface LRU working set should remain mounted',
);
for (let frame = 0; frame < 2; frame += 1) retainedRenderer.advanceFrame();
assert.deepEqual(retainedPromotions.at(-1), {
  key: 'page-P-r1',
  surfaceKey: 'page:P',
  kind: 'reactivated',
});
retainedRenderer.unmount();

// Execute the exact viewport expressions used by HtmlEditorCanvasStage. The
// iframe keeps the selected breakpoint as its CSS layout viewport, while the
// surrounding editor surface crops to the measured component bounds. Keeping
// these two values separate prevents vh/vw feedback loops and giant canvases.
const componentViewportSource = extractSection(
  canvasStageSource,
  'const componentLayoutViewport =',
  'const editorSurfaceVisualReady =',
);
const componentViewportRuntimeSource = componentViewportSource.replace(
  'new Map<string, { width: number; height: number }>()',
  'new Map()',
);
const resolveComponentViewport = new Function(
  'editingHtmlComponent',
  'componentCanvasSize',
  'currentViewport',
  'editorCanvasSemanticSurfaceKey',
  'viewport',
  'editorCanvasPreview',
  'cachedMeasurement',
  `
    const useRef = value => ({ current: new Map(cachedMeasurement ? [[
      [editorCanvasSemanticSurfaceKey, viewport, Math.ceil(currentViewport.width) + 'x' + Math.ceil(currentViewport.height)].join('\\0'),
      cachedMeasurement,
    ]] : []) });
    const useLayoutEffect = callback => callback();
    ${componentViewportRuntimeSource}
    return { componentLayoutViewport, componentRuntimeViewport };
  `,
);
assert.deepEqual(
  resolveComponentViewport(
    true,
    { generation: 'g1', width: 1814.2, height: 457.1, layoutWidth: 1920, layoutHeight: 1080 },
    { width: 1920, height: 1080 },
    'component:hero',
    'primary',
    { generation: 'g1' },
    null,
  ),
  {
    componentLayoutViewport: { width: 1920, height: 1080 },
    componentRuntimeViewport: { width: 1815, height: 458 },
  },
  'a short component must crop immediately without changing its responsive layout viewport',
);
assert.deepEqual(
  resolveComponentViewport(
    true,
    { generation: 'g2', width: 2200, height: 1600, layoutWidth: 1920, layoutHeight: 1080 },
    { width: 1920, height: 1080 },
    'component:hero',
    'primary',
    { generation: 'g2' },
    null,
  ),
  {
    componentLayoutViewport: { width: 1920, height: 1080 },
    componentRuntimeViewport: { width: 1920, height: 1080 },
  },
  'oversized content must be bounded by the selected breakpoint instead of expanding the editor',
);
const pageViewport = { width: 1280, height: 720 };
assert.deepEqual(
  resolveComponentViewport(
    false,
    { generation: 'g3', width: 300, height: 200, layoutWidth: 1280, layoutHeight: 720 },
    pageViewport,
    'page:index',
    'primary',
    { generation: 'g3' },
    null,
  ),
  {
    componentLayoutViewport: { width: 1280, height: 720 },
    componentRuntimeViewport: pageViewport,
  },
  'ordinary pages must keep the selected viewport object',
);

// Execute the exact O(1) measurement function embedded in preview.ts. Poisoned
// page scroll metrics make the test fail immediately if a future regression
// lets the document/body height contaminate the isolated component size.
const componentMeasurementSource = extractSection(
  previewSource,
  'const reportComponentSize = (force = false) => {',
  'const scheduleComponentSize = () => {',
);
const createComponentMeasurement = new Function(
  'environment',
  `
    const { componentRoot, document, postEditorMessage, signalFirstContentReady } = environment;
    const innerWidth = environment.innerWidth;
    const innerHeight = environment.innerHeight;
    const fillWidthValue = value => /^(?:auto|stretch|fill|100(?:\\.0+)?%|100(?:d|s|l)?vw)$/i.test(
      String(value).trim(),
    );
    let componentSizeFrame = 99;
    let lastComponentWidth = -1;
    let lastComponentHeight = -1;
    let lastComponentLayoutWidth = -1;
    let lastComponentLayoutHeight = -1;
    let componentInitialSizeReported = false;
    ${componentMeasurementSource}
    return {
      reportComponentSize,
      state: () => ({ componentInitialSizeReported, componentSizeFrame }),
    };
  `,
);
const geometry = {
  connected: true,
  rect: { top: -20, bottom: 280, width: 768, height: 300 },
  bodyRect: { width: 768, height: 720 },
  scrollWidth: 768,
  offsetWidth: 768,
  scrollHeight: 240,
  offsetHeight: 250,
};
const componentMessages = [];
let componentReadySignals = 0;
const poisonedPageMetric = name => ({
  get() {
    throw new Error(`${name} must not participate in component sizing`);
  },
});
const componentRoot = {
  get isConnected() { return geometry.connected; },
  get scrollWidth() { return geometry.scrollWidth; },
  get offsetWidth() { return geometry.offsetWidth; },
  get scrollHeight() { return geometry.scrollHeight; },
  get offsetHeight() { return geometry.offsetHeight; },
  getBoundingClientRect() { return geometry.rect; },
  getAttribute(name) { return name === 'class' ? 'w-full' : ''; },
  style: { getPropertyValue: () => '' },
};
const fakeDocument = {
  body: Object.create(null, {
    getBoundingClientRect: { value: () => geometry.bodyRect },
    scrollHeight: poisonedPageMetric('document.body.scrollHeight'),
    offsetHeight: poisonedPageMetric('document.body.offsetHeight'),
  }),
  documentElement: Object.create(null, {
    clientWidth: { get: () => 768 },
    clientHeight: { get: () => 720 },
    scrollHeight: poisonedPageMetric('document.documentElement.scrollHeight'),
    offsetHeight: poisonedPageMetric('document.documentElement.offsetHeight'),
  }),
};
const measurement = createComponentMeasurement({
  componentRoot,
  document: fakeDocument,
  innerWidth: 768,
  innerHeight: 720,
  postEditorMessage: message => componentMessages.push(message),
  signalFirstContentReady: () => { componentReadySignals += 1; },
});
measurement.reportComponentSize();
assert.deepEqual(componentMessages, [{
  type: 'html-editor-component-size',
  width: 768,
  height: 300,
  layoutWidth: 768,
  layoutHeight: 720,
}]);
assert.deepEqual(measurement.state(), {
  componentInitialSizeReported: true,
  componentSizeFrame: 0,
});
assert.equal(componentReadySignals, 1, 'first-content-ready must follow the first real size');

measurement.reportComponentSize();
assert.equal(componentMessages.length, 1, 'unchanged geometry must not spam the parent');
geometry.rect = { top: 0, bottom: 310, width: 768, height: 310 };
geometry.scrollHeight = 412;
geometry.offsetHeight = 390;
measurement.reportComponentSize();
assert.deepEqual(componentMessages.at(-1), {
  type: 'html-editor-component-size',
  width: 768,
  height: 412,
  layoutWidth: 768,
  layoutHeight: 720,
});
assert.equal(componentReadySignals, 1, 'responsive remeasurements must not repeat first-ready');
geometry.connected = false;
measurement.reportComponentSize();
assert.equal(componentMessages.length, 2, 'detached masters must not publish stale geometry');

console.log('Canvas never-white runtime and sizing contracts passed.');
