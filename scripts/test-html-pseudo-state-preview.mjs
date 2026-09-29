import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const editorSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  'utf8',
);
const inspectorSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
  'utf8',
);
const previewSource = await readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');

assert.match(
  editorSource,
  /CANVAS_FORCEABLE_PSEUDO_STATES = new Set<[^>]+>\(\[\s*'hover',\s*'focus',\s*'focus-visible',\s*'active',\s*\]\)/,
  'the visual projection must cover the interactive pseudo-classes exposed by the Inspector',
);
assert.match(
  editorSource,
  /forceState = mode === 'design'[\s\S]*?!isPreviewing[\s\S]*?CANVAS_FORCEABLE_PSEUDO_STATES\.has\(cssContext\.pseudo\)[\s\S]*?serializeCanvasStylePreview\(\{[\s\S]*?paths,[\s\S]*?declarations: \{[\s\S]*?\.\.\.baseBreakpointRuleStyles,[\s\S]*?\.\.\.cssRuleStyles/,
  'Design mode must derive its disposable projection from the active state rule and selected paths',
);
assert.match(
  editorSource,
  /cssContext\.selector,\s*baseBreakpointRuleStyles,\s*cssRuleStyles,/,
  'an inherited state rule must repaint when its wider-breakpoint declaration changes',
);
assert.match(
  editorSource,
  /type: 'html-editor-pseudo-state-preview',[\s\S]*?cssText: nextCssText/,
  'the selected state must use a dedicated editor-to-canvas command',
);
assert.match(
  editorSource,
  /generation = activeCanvasAuthorityRef\.current\?\.generation\s*\|\| activeCanvasGenerationRef\.current/,
  'a pending buffered generation must not retarget commands away from the still-painted frame',
);
assert.match(
  editorSource,
  /canvasPseudoStatePreviewTargetsBreakpoint\(\s*targetBreakpoint,\s*passiveCanvasFrameIdsRef\.current\.get\(frame\),?\s*\)/,
  'Infinite Canvas must project a base state to every inheriting viewport and a child state only to its matching frame',
);
assert.match(
  editorSource,
  /flushCanvasPseudoStatePreviewRef\.current = flushProjection;[\s\S]*?return \(\) => \{[\s\S]*?clearGenerations = new Set\(\[paintedGeneration\]\)[\s\S]*?clearGenerations\.add\(cleanupGeneration\)[\s\S]*?postProjection\(frame, '', clearGeneration\)/,
  'state/context changes and unmount must atomically remove the prior canvas projection',
);
assert.match(
  editorSource,
  /const flushCanvasStylePreview = useCallback\(\(\) => \{\s*\/\/[\s\S]*?flushCanvasPseudoStatePreviewRef\.current\(\);/,
  'a passive breakpoint loaded later must receive the still-selected pseudo-state before control previews',
);
assert.match(
  editorSource,
  /activeCanvasAuthorityRef\.current = \{ node, frame, generation \};[\s\S]*?const pseudoStatePreview = canvasPseudoStatePreviewRef\.current;[\s\S]*?postCanvasPseudoStatePreviewToFrame\(frame, generation, pseudoStateCssText\)/,
  'the promoted/reactivated frame must receive the current projection with its exact generation',
);
assert.match(
  editorSource,
  /const hydrateCanvasIframe = \([^)]*\) => \{[\s\S]*?if \(!isPreviewingRef\.current\) \{[\s\S]*?postCanvasViewStateToFrame\([^)]*\);[\s\S]*?flushCanvasStylePreviewRef\.current\(\);/,
  'promotion/reactivation must replay the pseudo-state and active control draft after canonical View State',
);
assert.match(
  editorSource,
  /const pseudoStateCssText = surface === 'editor'[\s\S]*?\? pseudoStatePreview\.cssText\s*: ''/,
  'Preview activation and mismatched breakpoints must explicitly clear an old disposable projection',
);
const stateEffectDependencies = editorSource.slice(
  editorSource.indexOf("const postCanvasPseudoStatePreviewToFrame = useCallback"),
  editorSource.indexOf("const postAgentActivityToFrame = useCallback"),
);
assert.match(
  stateEffectDependencies,
  /useLayoutEffect\(\(\) => \{[\s\S]*?canvasPseudoStatePreviewRef\.current = \{ cssText, breakpoint: targetBreakpoint \}/,
  'the current projection snapshot must update before the next browser paint',
);
assert.match(
  stateEffectDependencies,
  /const selectedPathsSignature = JSON\.stringify\(selectedPaths\);[\s\S]*?const currentSelectedPaths = selectedPathsRef\.current/,
  'computed selection echoes with the same paths must not tear down and recreate the projection',
);
assert.match(
  stateEffectDependencies,
  /postCanvasPseudoStatePreviewToFrame,\s*selectedPathsSignature,\s*selection\?\.path,/,
  'the projection lifecycle must depend on selected path content rather than array identity',
);
assert.match(
  editorSource,
  /canvasPseudoStatePreviewPaintedFramesRef = useRef\(new Map<Window, string>\(\)\)/,
  'each painted frame must retain the generation that owns its disposable pseudo-state sheet',
);
assert.match(
  stateEffectDependencies,
  /const framesToClear = new Map<Window, Set<string>>\(\);[\s\S]*?rememberClearGeneration\(frame, paintedGeneration\)[\s\S]*?if \(!cssText\) \{[\s\S]*?rememberClearGeneration\(activeFrame, projectionGeneration\)[\s\S]*?passiveCanvasFramesRef\.current\.forEach\(frame => \{[\s\S]*?rememberClearGeneration\(frame, projectionGeneration\)/,
  'returning to Normal must explicitly clear the current active and passive generations, including frames absent from the old painted set',
);
assert.match(
  stateEffectDependencies,
  /framesToClear\.forEach\(\(clearGenerations, frame\) => \{[\s\S]*?clearGenerations\.forEach\(clearGeneration => \{[\s\S]*?postProjection\(frame, '', clearGeneration\)/,
  'a retired pseudo-state sheet must be cleared with both its painted and current generations when they differ',
);
assert.match(
  editorSource,
  /if \(postCanvasPseudoStatePreviewToFrame\(frame, generation, pseudoStateCssText\)\) \{\s*if \(pseudoStateCssText\) canvasPseudoStatePreviewPaintedFramesRef\.current\.set\(frame, generation\)/,
  'promotion must update the tracked generation before an older effect is allowed to clean up',
);
const applyStateStart = inspectorSource.indexOf('const applyState = (pseudo: CssPseudoState) => {');
const applyStateEnd = inspectorSource.indexOf('const commitTabsModel', applyStateStart);
assert.ok(applyStateStart >= 0 && applyStateEnd > applyStateStart, 'the Inspector state switch must remain inspectable');
const applyStateSource = inspectorSource.slice(applyStateStart, applyStateEnd);
assert.match(
  applyStateSource,
  /stylePreviewTransaction\.flush\(\);\s*onStylePreviewCancel\?\.\(\);\s*onCssContextChange\(current => pseudo === 'base'/,
  'pending state edits and their transient overlay must finish before the authoring context switches to Normal',
);
assert.match(
  editorSource,
  /changeResolvedCssContext = useCallback\(\(next: CssEditingContext \| \(\(current: CssEditingContext\) => CssEditingContext\)\) => \{\s*const previous = cssContextRef\.current;\s*const nextContext = typeof next === 'function' \? next\(previous\) : next;/,
  'the state switch must derive its next identity from the authoritative post-flush CSS context',
);
assert.doesNotMatch(
  stateEffectDependencies,
  /postCanvasPseudoStatePreviewToFrame,\s*selectedPaths,\s*selection\?\.path,/,
  'a fresh selectedPaths array carrying the same paths must not cause a clear/apply feedback loop',
);
assert.doesNotMatch(
  stateEffectDependencies,
  /activeSurfacePreview\?\.generation/,
  'buffer preparation alone must not clear the state from the outgoing painted iframe',
);

const bridgeStart = previewSource.indexOf("if (event.data?.type === 'html-editor-pseudo-state-preview')");
assert.notEqual(bridgeStart, -1, 'the canvas bridge must consume the state-preview command');
const bridgeEnd = previewSource.indexOf("if (event.data?.type === 'html-editor-capture-scroll')", bridgeStart);
assert.ok(bridgeEnd > bridgeStart, 'the state-preview handler must remain an isolated command branch');
const bridge = previewSource.slice(bridgeStart, bridgeEnd);
assert.match(bridge, /cssText\.length > 512 \* 1024/);
assert.match(bridge, /style\[data-html-editor-pseudo-state-preview\]/);
assert.match(bridge, /if \(!cssText\) \{[\s\S]*?style\?\.remove\(\)/);
assert.match(bridge, /style\.textContent = cssText/);
assert.match(
  bridge,
  /refreshPseudoStateInspection = \(\) => requestAnimationFrame\(refreshDirectControls\)/,
  'applying or clearing the state must refresh the canvas controls without echoing computed selection state',
);
assert.doesNotMatch(
  bridge,
  /pendingSelectionDetail|schedulePendingSelectionDetail|postEditorMessage/,
  'the disposable sheet must not feed a projected computed style back into React selection state',
);
assert.doesNotMatch(
  bridge,
  /\.focus\(|dispatchEvent\(|MouseEvent|PointerEvent|KeyboardEvent/,
  'forcing a visual state must not synthesize input, focus, or pointer activity',
);
assert.doesNotMatch(
  bridge,
  /postEditorMessage|mutationId|appliedEditorRevision|markLiveAtom|commitCanvasViewTransaction/,
  'the disposable state projection must not enter source, history, or mutation acknowledgements',
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
  const { serializeCanvasStylePreview } = await server.ssrLoadModule(
    '/lib/html-editor/edit-coalescing.ts',
  );
  const {
    inspectCssRuleAtViewport,
    patchCssDeclaration,
    readCssRuleDeclarations,
  } = await server.ssrLoadModule('/lib/html-editor/css-patcher.ts');
  const { canvasPseudoStatePreviewTargetsBreakpoint } = await server.ssrLoadModule(
    '/lib/html-editor/preview.ts',
  );
  assert.equal(canvasPseudoStatePreviewTargetsBreakpoint('base', 'tablet'), true);
  assert.equal(canvasPseudoStatePreviewTargetsBreakpoint('base', 'mobile'), true);
  assert.equal(canvasPseudoStatePreviewTargetsBreakpoint('tablet', 'tablet'), true);
  assert.equal(canvasPseudoStatePreviewTargetsBreakpoint('tablet', 'mobile'), false);
  assert.equal(canvasPseudoStatePreviewTargetsBreakpoint('tablet', 'base'), false);

  const firstSelectionPaths = ['0/2'];
  const computedEchoPaths = ['0/2'];
  assert.notEqual(firstSelectionPaths, computedEchoPaths);
  assert.equal(
    JSON.stringify(firstSelectionPaths),
    JSON.stringify(computedEchoPaths),
    'an equal computed selection echo must retain the same projection lifecycle key',
  );
  const cssText = serializeCanvasStylePreview({
    targetKey: 'pseudo-state\u0000hover\u00000/2',
    paths: ['0/2'],
    declarations: {
      'background-color': '#8b5cf6',
      transform: 'translateY(-2px)',
    },
  });
  assert.match(cssText, /\[data-html-editor-path="0\/2"\]/);
  assert.match(cssText, /background-color:#8b5cf6!important/);
  assert.match(cssText, /transform:translateY\(-2px\)!important/);
  assert.doesNotMatch(
    cssText,
    /:hover|:focus|:active/,
    'the editor sheet pins the chosen state without requiring native pseudo-class activation',
  );
  assert.equal(
    serializeCanvasStylePreview({
      targetKey: 'pseudo-state\u0000hover\u00000/2',
      paths: ['0/2'],
      declarations: {},
    }),
    '',
    'a state without authored declarations must not alter the canvas',
  );

  const makeBridgeDocument = () => {
    let pseudoStyle = null;
    const head = {
      append(style) {
        pseudoStyle = style;
      },
    };
    return {
      head,
      querySelector(selector) {
        return selector === 'style[data-html-editor-pseudo-state-preview]' ? pseudoStyle : null;
      },
      createElement(tagName) {
        assert.equal(tagName, 'style');
        return {
          textContent: '',
          setAttribute() {},
          remove() {
            pseudoStyle = null;
          },
        };
      },
      pseudoStyle: () => pseudoStyle,
    };
  };
  const runPseudoStateBridge = new Function(
    'event',
    'document',
    'requestAnimationFrame',
    'refreshDirectControls',
    'scheduleCanvasVisibilitySnapshot',
    bridge,
  );
  const makeFrame = generation => ({
    generation,
    document: makeBridgeDocument(),
    messages: [],
  });
  const dispatch = (frame, message) => {
    frame.messages.push(message);
    if (message.generation !== frame.generation) return false;
    runPseudoStateBridge(
      { data: message },
      frame.document,
      callback => callback(),
      () => undefined,
      () => undefined,
    );
    return true;
  };

  const cssContext = pseudo => ({
    target: 'rule',
    selector: '.headline',
    cssFilePath: 'styles.css',
    pseudo,
    breakpoint: 'base',
  });
  let authoredCss = '.headline { color: #111827; }\n';
  authoredCss = patchCssDeclaration(
    authoredCss,
    cssContext('hover'),
    'color',
    '#e74f4f',
    [],
    { authoritative: true },
  );
  const hoverDeclarations = readCssRuleDeclarations(authoredCss, cssContext('hover'), []);
  assert.equal(hoverDeclarations.color, '#e74f4f');
  assert.equal(readCssRuleDeclarations(authoredCss, cssContext('base'), []).color, '#111827');
  const hoverProjection = serializeCanvasStylePreview({
    targetKey: 'pseudo-state\u0000hover\u00000',
    paths: ['0'],
    declarations: hoverDeclarations,
  });
  const activeFrame = makeFrame('g1');
  const passiveFrame = makeFrame('g1');
  [activeFrame, passiveFrame].forEach(frame => {
    dispatch(frame, {
      type: 'html-editor-pseudo-state-preview',
      generation: 'g1',
      cssText: hoverProjection,
    });
    assert.match(frame.document.pseudoStyle()?.textContent || '', /#e74f4f/i);
  });

  activeFrame.generation = 'g2';
  passiveFrame.generation = 'g2';
  assert.equal(
    dispatch(activeFrame, {
      type: 'html-editor-pseudo-state-preview',
      generation: 'g1',
      cssText: '',
    }),
    false,
    'a cleanup addressed to the previous generation must be rejected',
  );
  assert.ok(activeFrame.document.pseudoStyle(), 'a stale-generation clear must leave the regression observable');
  [activeFrame, passiveFrame].forEach(frame => {
    assert.equal(dispatch(frame, {
      type: 'html-editor-pseudo-state-preview',
      generation: 'g2',
      cssText: '',
    }), true);
    assert.equal(
      frame.document.pseudoStyle(),
      null,
      'Normal must remove the disposable pseudo-state sheet from every current frame',
    );
  });

  authoredCss = patchCssDeclaration(
    authoredCss,
    cssContext('base'),
    'color',
    '#2563eb',
    [],
    { authoritative: true },
  );
  assert.equal(readCssRuleDeclarations(authoredCss, cssContext('base'), []).color, '#2563eb');
  assert.equal(readCssRuleDeclarations(authoredCss, cssContext('hover'), []).color, '#e74f4f');
  assert.equal(
    inspectCssRuleAtViewport(authoredCss, cssContext('base'), 'color', 1920, []).propertyOwner?.value,
    '#2563eb',
    'the base declaration edited after Hover must be the visible authored winner once the projection is cleared',
  );
  assert.doesNotMatch(authoredCss, /!important/i, 'the disposable preview priority must never enter authored CSS');
  console.log('HTML pseudo-state canvas preview tests passed.');
} finally {
  await server.close();
}
