import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
  resolve: { alias: { '@': root } },
});

try {
  const compiler = await server.ssrLoadModule('/lib/html-editor/component-interaction-runtime.ts');
  const interactions = await server.ssrLoadModule('/lib/html-editor/interactions.ts');
  const components = await server.ssrLoadModule('/lib/html-editor/html-components.ts');
  const canvasProtocol = await server.ssrLoadModule('/lib/html-editor/canvas-protocol.ts');

  const defaultVariantPath = '.incode/components/card/default.html';
  const alternateVariantPath = '.incode/components/card/alternate.html';
  const defaultCompanionPath = interactions.interactionDocumentPath(defaultVariantPath);
  const alternateCompanionPath = interactions.interactionDocumentPath(alternateVariantPath);
  const pageCompanionPath = interactions.interactionDocumentPath('index.html');
  const masterInteraction = {
    id: 'master-hover',
    name: 'Hover do master',
    trigger: 'hover',
    triggerSelector: 'body > :first-child',
    triggerTargetMode: 'element',
    scrollTriggerSelector: ':root body .card-title',
    actions: [
      {
        id: 'root-action',
        kind: 'component-variant',
        target: { selector: '', label: 'Trigger', scope: 'trigger', mode: 'element' },
        componentId: 'card',
        componentVariantId: 'alternate',
      },
      {
        id: 'title-action',
        kind: 'set',
        target: { selector: 'html body .card-title', label: '.card-title', scope: 'document', mode: 'class' },
        to: { opacity: 0.5 },
      },
    ],
  };
  const alternateInteraction = {
    ...masterInteraction,
    id: 'alternate-click',
    name: 'Clique da variante alternativa',
    trigger: 'click',
  };
  const pageInteraction = {
    id: 'page-load',
    name: 'Interação da página',
    trigger: 'load',
    triggerSelector: 'body',
    triggerTargetMode: 'selector',
    actions: [],
  };
  const files = {
    'index.html': { path: 'index.html', mimeType: 'text/html', text: '<!doctype html><html><body></body></html>' },
    [defaultVariantPath]: {
      path: defaultVariantPath,
      mimeType: 'text/html',
      text: '<!doctype html><html><body><article data-kodety-component-node="root" data-kodety-interaction-id="card-root"><h2 class="card-title">Card</h2></article></body></html>',
    },
    [alternateVariantPath]: {
      path: alternateVariantPath,
      mimeType: 'text/html',
      text: '<!doctype html><html><body><article data-kodety-component-node="root" data-kodety-interaction-id="card-root"><h2 class="card-title">Alt</h2></article></body></html>',
    },
    [defaultCompanionPath]: {
      path: defaultCompanionPath,
      mimeType: 'application/json',
      text: JSON.stringify({ version: 2, canonical: true, interactions: [masterInteraction] }),
    },
    [alternateCompanionPath]: {
      path: alternateCompanionPath,
      mimeType: 'application/json',
      text: JSON.stringify({ version: 2, canonical: true, interactions: [alternateInteraction] }),
    },
    [pageCompanionPath]: {
      path: pageCompanionPath,
      mimeType: 'application/json',
      text: JSON.stringify({ version: 2, canonical: true, interactions: [pageInteraction] }),
    },
  };
  const project = {
    name: 'Component interactions',
    files,
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
  };
  const library = {
    version: 1,
    components: [{
      id: 'card',
      name: 'Card',
      variants: [
        { id: 'default', name: 'Default', filePath: defaultVariantPath },
        { id: 'alternate', name: 'Alternate', filePath: alternateVariantPath },
      ],
      variables: [{
        id: 'variant-state',
        name: 'Variant',
        type: 'variant',
        targetNodeId: '',
        attribute: '',
        defaultValue: 'default',
      }],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }],
  };
  const targetedVariantVariable = {
    id: 'logo-state',
    name: 'Logo Variant',
    type: 'variant',
    bindings: [{
      targetNodeId: 'logo-slot',
      attribute: 'data-kodety-component-variant',
    }],
    targetNodeId: 'logo-slot',
    attribute: 'data-kodety-component-variant',
    defaultValue: 'logo-default',
  };
  const targetedLibrary = {
    version: 1,
    components: [
      {
        id: 'footer',
        name: 'Footer',
        variants: [{ id: 'home', name: 'Home', filePath: '.incode/components/footer/home.html' }],
        variables: [targetedVariantVariable],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      {
        id: 'logo',
        name: 'Logo',
        variants: [
          { id: 'logo-default', name: 'Default', filePath: '.incode/components/logo/default.html' },
          { id: 'logo-compact', name: 'Compact', filePath: '.incode/components/logo/compact.html' },
        ],
        variables: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ],
  };
  const targetedProject = {
    ...project,
    files: {
      ...files,
      '.incode/components/footer/home.html': {
        path: '.incode/components/footer/home.html',
        mimeType: 'text/html',
        text: '<html><body><footer data-kodety-component-node="footer-root"><div data-kodety-component-node="logo-slot" data-kodety-component-id="logo" data-kodety-component-variant="logo-default"></div></footer></body></html>',
      },
    },
  };
  assert.equal(
    components.htmlComponentVariableControlsRootVariant(targetedVariantVariable),
    false,
    'a bound Variant property must not switch the owning Footer variant',
  );
  assert.deepEqual(
    components.htmlComponentVariableVariantOptions(
      targetedProject,
      targetedLibrary,
      targetedLibrary.components[0],
      targetedVariantVariable,
    ),
    [
      { id: 'logo-default', name: 'Default' },
      { id: 'logo-compact', name: 'Compact' },
    ],
    'a bound Variant property must expose the nested component variants',
  );
  const pageDocument = interactions.readInteractionDocumentFile(project, 'index.html');
  const componentRootSelection = {
    path: '0',
    tag: 'article',
    id: '',
    classes: ['card'],
    attributes: { class: 'card' },
    text: 'Card',
    html: '<article class="card">Card</article>',
    styles: {},
  };
  const masterRootSelector = interactions.ensureInteractionSelector(
    '<!doctype html><html><body data-kodety-component-editor="card" data-kodety-component-variant-editor="default"><article class="card">Card</article></body></html>',
    '0',
    componentRootSelection,
    'element',
  );
  assert.equal(masterRootSelector.selector, 'body > :first-child');
  assert.equal(masterRootSelector.source.includes('data-kodety-interaction-id'), false);
  for (const trigger of ['click-start', 'appear', 'mouse-enter', 'mouse-leave']) {
    const added = interactions.addInteraction(
      '<!doctype html><html><body data-kodety-component-editor="card"><article class="card">Card</article></body></html>',
      '0',
      componentRootSelection,
      trigger,
      'element',
    );
    const persisted = interactions.readInteractionDocument(added.source).interactions[0];
    assert.equal(
      persisted.trigger,
      trigger,
      `${trigger} must persist without silently falling back to click`,
    );
  }
  const delayedEvent = interactions.addInteraction(
    '<!doctype html><html><body data-kodety-component-editor="card"><article class="card">Card</article></body></html>',
    '0',
    componentRootSelection,
    'click-start',
    'element',
  );
  const delayedAction = {
    ...interactions.createInteractionAction('component-variant'),
    start: 1.7,
    componentId: 'card',
    componentVariantId: 'alternate',
  };
  const delayedSource = interactions.updateInteraction(
    delayedEvent.source,
    delayedEvent.interaction.id,
    interaction => ({ ...interaction, actions: [delayedAction] }),
  );
  assert.equal(
    interactions.readInteractionDocument(delayedSource).interactions[0].actions[0].start,
    1.7,
    'component event delay must round-trip through action.start in seconds',
  );
  const pageWithTwoInstances = `<!doctype html><html><body>
    <article data-kodety-component-id="card" data-kodety-component-variant="default" data-kodety-component-instance="card-a" data-kodety-interaction-id="card-root"><h2 class="card-title">A</h2></article>
    <article data-kodety-component-id="card" data-kodety-component-variant="default" data-kodety-component-instance="card-b" data-kodety-interaction-id="card-root"><h2 class="card-title">B</h2></article>
  </body></html>`;
  const companionSnapshots = new Map([
    [defaultCompanionPath, files[defaultCompanionPath].text],
    [alternateCompanionPath, files[alternateCompanionPath].text],
  ]);
  const compiled = compiler.compileHtmlComponentInstanceInteractions(
    project,
    pageWithTwoInstances,
    library,
    pageDocument,
  );

  assert.equal(compiled.interactions.length, 5);
  assert.equal(compiled.interactions[0].id, 'page-load', 'page interactions must remain intact');
  const compiledComponentInteractions = compiled.interactions.slice(1);
  const first = compiledComponentInteractions.find(interaction => (
    interaction.id.includes('card@card-a')
    && interaction.id.includes('variant@default')
  ));
  const firstAlternate = compiledComponentInteractions.find(interaction => (
    interaction.id.includes('card@card-a')
    && interaction.id.includes('variant@alternate')
  ));
  const second = compiledComponentInteractions.find(interaction => (
    interaction.id.includes('card@card-b')
    && interaction.id.includes('variant@default')
  ));
  assert.ok(first);
  assert.ok(firstAlternate);
  assert.ok(second);
  assert.notEqual(first.id, second.id, 'each instance must receive an independent runtime ID');
  assert.match(first.id, /card@card-a/);
  assert.match(second.id, /card@card-b/);
  assert.match(first.triggerSelector, /card-a/);
  assert.match(first.triggerSelector, /data-kodety-component-state-variant="default"/);
  assert.match(firstAlternate.triggerSelector, /data-kodety-component-state-variant="alternate"/);
  assert.doesNotMatch(first.triggerSelector, /first-child/);
  assert.doesNotMatch(first.triggerSelector, /(?:^|[\s>+~,])(?:html|body)(?:$|[\s>+~.#[:])/i);
  assert.doesNotMatch(first.triggerSelector, /:root/);
  assert.doesNotMatch(first.triggerSelector, /card-b/);
  assert.match(second.triggerSelector, /card-b/);
  assert.doesNotMatch(second.triggerSelector, /card-a/);
  assert.equal(first.actions[0].target.scope, 'trigger', 'root quick actions must keep trigger scope');
  assert.equal(first.actions[0].target.selector, '');
  assert.match(first.actions[1].target.selector, /card-a/);
  assert.doesNotMatch(first.actions[1].target.selector, /(?:^|[\s>+~,])(?:html|body)(?:$|[\s>+~.#[:])/i);
  assert.doesNotMatch(first.actions[1].target.selector, /:root/);
  assert.match(first.scrollTriggerSelector, /card-a/);
  assert.doesNotMatch(first.scrollTriggerSelector, /(?:html|body|:root)/i);
  assert.doesNotMatch(first.actions[1].target.selector, /card-b/);
  assert.match(second.actions[1].target.selector, /card-b/);
  assert.notEqual(first.actions[0].id, second.actions[0].id, 'action IDs must also be namespaced');

  const encodedOverride = components.encodeHtmlComponentOverrides({
    'variant-state': 'alternate',
  });
  const overridden = compiler.compileHtmlComponentInstanceInteractions(
    project,
    `<!doctype html><html><body><article data-kodety-component-id="card" data-kodety-component-variant="default" data-kodety-component-instance="card-alt" data-kodety-component-overrides="${encodedOverride}" data-kodety-interaction-id="card-root"></article></body></html>`,
    library,
    { version: 2, interactions: [] },
  );
  assert.equal(overridden.interactions.length, 2);
  const overriddenDefault = overridden.interactions.find(interaction => (
    interaction.id.includes('variant@default')
  ));
  const overriddenAlternate = overridden.interactions.find(interaction => (
    interaction.id.includes('variant@alternate')
  ));
  assert.ok(overriddenDefault);
  assert.ok(overriddenAlternate);
  assert.equal(overriddenAlternate.name, 'Clique da variante alternativa');
  assert.equal(overriddenAlternate.trigger, 'click');
  assert.match(
    overriddenAlternate.triggerSelector,
    /data-kodety-component-state-variant="alternate"/,
    'the active state selector must expose only the matching variant companion',
  );
  assert.match(
    overriddenDefault.triggerSelector,
    /data-kodety-component-state-variant="default"/,
  );
  companionSnapshots.forEach((text, companionPath) => {
    assert.equal(files[companionPath].text, text, 'compilation must never rewrite a master companion');
  });

  const noPageInteractions = compiler.compileHtmlComponentInstanceInteractions(
    project,
    pageWithTwoInstances,
    library,
    { version: 2, interactions: [] },
  );
  assert.equal(noPageInteractions.interactions.length, 4, 'every component state runtime must exist without page interactions');

  const nested = compiler.compileHtmlComponentInstanceInteractions(
    project,
    `<!doctype html><html><body>
      <article data-kodety-component-id="card" data-kodety-component-variant="default" data-kodety-component-instance="outer" data-kodety-interaction-id="card-root">
        <article data-kodety-component-id="card" data-kodety-component-variant="default" data-kodety-component-instance="inner" data-kodety-interaction-id="card-root"></article>
      </article>
    </body></html>`,
    library,
    { version: 2, interactions: [] },
  );
  assert.equal(nested.interactions.length, 4);
  const innerInteractions = nested.interactions.filter(interaction => interaction.id.includes('card@inner'));
  assert.equal(innerInteractions.length, 2, 'every nested component state must be compiled');
  const inner = innerInteractions.find(interaction => interaction.id.includes('variant@default'));
  assert.ok(inner, 'nested component interaction must be compiled');
  assert.match(inner.triggerSelector, /outer/);
  assert.match(inner.triggerSelector, /inner/);
  assert.ok(
    inner.triggerSelector.indexOf('outer') < inner.triggerSelector.indexOf('inner'),
    'nested scope must preserve outer-to-inner ancestry',
  );

  let defaultCompanionReads = 0;
  let alternateCompanionReads = 0;
  const countedProject = {
    ...project,
    files: new Proxy(files, {
      get(target, property, receiver) {
        if (property === defaultCompanionPath) defaultCompanionReads += 1;
        if (property === alternateCompanionPath) alternateCompanionReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }),
  };
  const manyInstances = `<!doctype html><html><body>${Array.from(
    { length: 128 },
    (_, index) => `<article data-kodety-component-id="card" data-kodety-component-variant="default" data-kodety-component-instance="card-${index}" data-kodety-interaction-id="card-root"></article>`,
  ).join('')}</body></html>`;
  const manyCompiled = compiler.compileHtmlComponentInstanceInteractions(
    countedProject,
    manyInstances,
    library,
    { version: 2, interactions: [] },
  );
  assert.equal(manyCompiled.interactions.length, 256);
  assert.equal(defaultCompanionReads, 1, 'one shared companion must be parsed once per compile pass');
  assert.equal(alternateCompanionReads, 1, 'every shared variant companion must be parsed once per compile pass');

  const runtimeHtml = interactions.patchInteractionDocument(
    '<!doctype html><html><head></head><body><article data-kodety-component-id="card"></article></body></html>',
    { version: 2, interactions: [masterInteraction] },
  );
  const runtimeScript = runtimeHtml.match(
    /<script\b[^>]*data-kodety-interactions-runtime[^>]*>([\s\S]*?)<\/script>/i,
  )?.[1] || '';
  assert.ok(runtimeScript, 'generated interaction runtime must be present');
  assert.doesNotThrow(
    () => new Function(runtimeScript),
    'generated interaction runtime must remain valid JavaScript',
  );

  const [
    previewSource,
    projectIoSource,
    interactionRuntimeSource,
    compilerSource,
    motionTimelineSource,
    projectEditorSource,
    canvasProtocolSource,
    liveDomHelpersSource,
  ] = await Promise.all([
    readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8'),
    readFile(path.join(root, 'lib/html-editor/project-io.ts'), 'utf8'),
    readFile(path.join(root, 'lib/html-editor/interactions.ts'), 'utf8'),
    readFile(path.join(root, 'lib/html-editor/component-interaction-runtime.ts'), 'utf8'),
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlMotionTimeline.tsx'), 'utf8'),
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8'),
    readFile(path.join(root, 'lib/html-editor/canvas-protocol.ts'), 'utf8'),
    readFile(path.join(root, 'lib/html-editor/editor-live-dom-helpers.ts'), 'utf8'),
  ]);
  assert.match(
    previewSource,
    /compileHtmlComponentInstanceInteractions\([\s\S]*?componentSource[\s\S]*?pageAnimationDocument[\s\S]*?animationDocument\?\.interactions\.length[\s\S]*?patchInteractionDocument/,
    'Preview must inject a merged runtime even when only a component has interactions',
  );
  const designFreezeStart = previewSource.indexOf('if (freezeMotion) {');
  const initialScriptFreezeStart = previewSource.indexOf(
    "document.querySelectorAll('script').forEach(script => {",
    designFreezeStart,
  );
  const initialScriptFreezeEnd = previewSource.indexOf(
    '// Native media autoplay starts during parsing',
    initialScriptFreezeStart,
  );
  const initialScriptFreeze = previewSource.slice(initialScriptFreezeStart, initialScriptFreezeEnd);
  assert.match(
    initialScriptFreeze,
    /data-kodety-interactions-runtime[\s\S]*?data-kodety-interactions-dependency[\s\S]*?return;[\s\S]*?data-html-editor-frozen-script-type/,
    'Design must execute the editor interaction runtime and dependencies before freezing authored scripts',
  );
  assert.match(
    motionTimelineSource,
    /setPointerCapture\(pointerId\)[\s\S]*?pendingSeekTime[\s\S]*?requestAnimationFrame\(flushPendingSeek\)[\s\S]*?releasePointerCapture\(pointerId\)[\s\S]*?updateFromClientX\(upEvent\.clientX, true\)/,
    'Timeline scrubbing must retain pointer ownership, coalesce stale moves, and flush pointer-up exactly',
  );
  assert.match(
    motionTimelineSource,
    /const beginPlayback[\s\S]*?postInteractionControl\(interactionIds, 'play', next\)[\s\S]*?const tick[\s\S]*?const frameTime[\s\S]*?setPlayhead\(frameTime\)[\s\S]*?postInteractionControl\(interactionIds, 'pause', liveDuration\)/,
    'Timeline playback must start the native canvas clock once and pin the exact final frame',
  );
  const playbackTickSource = motionTimelineSource.slice(
    motionTimelineSource.indexOf('const tick = (now: number) => {', motionTimelineSource.indexOf('const beginPlayback')),
    motionTimelineSource.indexOf('animationFrame.current = requestAnimationFrame(tick);', motionTimelineSource.indexOf('const tick = (now: number) => {', motionTimelineSource.indexOf('const beginPlayback'))),
  );
  assert.doesNotMatch(
    playbackTickSource,
    /postInteractionControl\([^\n]+, 'seek'/,
    'Timeline Play must never enqueue one cross-frame Seek per display frame',
  );
  assert.match(
    projectEditorSource,
    /action: 'seek' \| 'play' \| 'reverse'[\s\S]*?startedAt: number[\s\S]*?const replayTime[\s\S]*?action: pinned\.action[\s\S]*?time: replayTime/,
    'a promoted canvas must resume a live Timeline from its elapsed frame',
  );
  assert.match(
    previewSource,
    /const acknowledgeInteractionControl[\s\S]*?html-editor-interaction-control-applied[\s\S]*?const applyInteractionControl[\s\S]*?__kodetyInteractions\?\.control\?\.\([\s\S]*?interactionIds,[\s\S]*?action,[\s\S]*?time[\s\S]*?const scheduleInteractionControlRetry[\s\S]*?acknowledgeInteractionControl\(pendingInteractionControl\.payload\)/,
    'the canvas must atomically apply, acknowledge, or retry the newest Timeline command',
  );
  assert.match(
    projectEditorSource,
    /timelineControlSequenceRef[\s\S]*?pendingTimelineControlRef[\s\S]*?ensureTimelineControlRetry[\s\S]*?__kodetyTimelineSequence: timelineSequence[\s\S]*?Every newest UI sample crosses immediately[\s\S]*?sendTimelineCanvasMessage\(message\)[\s\S]*?html-editor-interaction-control-applied/,
    'the editor must send every newest Timeline command immediately while retaining bounded reliability',
  );
  assert.match(
    previewSource,
    /latestObservedTimelineControlSequence[\s\S]*?queuedInteractionSeek[\s\S]*?queueInteractionSeek[\s\S]*?requestAnimationFrame\(flushQueuedInteractionSeek\)[\s\S]*?timelineSequence < latestObservedTimelineControlSequence[\s\S]*?clearQueuedInteractionSeek\(true\)/,
    'the canvas must reject cross-transport stale commands, paint only the newest Seek per frame, and let Play or Pause preempt it',
  );
  assert.match(
    previewSource,
    /const snapshotIdentity = el => \{[\s\S]*?computedStyle: \{\}[\s\S]*?const snapshot = el => \{[\s\S]*?selectionComputedProperties\.forEach[\s\S]*?const selectElement = \(el, additive, origin = 'canvas'\) => \{[\s\S]*?payload = snapshotIdentity\(selected\)[\s\S]*?breakpointId: canvasViewBreakpointId \|\| 'base'[\s\S]*?detail: 'identity'[\s\S]*?schedulePendingSelectionDetail\(\)/,
    'selection must publish paint-first identity before computed Inspector hydration',
  );
  assert.doesNotMatch(
    previewSource,
    /for \(let i = 0; i < computed\.length; i\+\+\)/,
    'selection must never enumerate the browser complete computed-style catalog',
  );
  assert.match(
    previewSource,
    /const schedulePendingSelectionDetail[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?runSelectionDetailWhenIdle[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?payload: snapshot\(pending\.element\)[\s\S]*?detail: 'computed'/,
    'computed selection detail must yield through paint and idle boundaries',
  );
  assert.match(
    previewSource,
    /const prioritizeInteractionControl[\s\S]*?action === 'play'[\s\S]*?selectionDetailSuspended = true[\s\S]*?clearScheduledSelectionDetail\(\)[\s\S]*?clearDirectDetail\(\)[\s\S]*?action === 'seek'[\s\S]*?selectionDetailResumeTimer = setTimeout/,
    'Play and Scrub must preempt pending Inspector and direct-geometry work',
  );
  assert.match(
    previewSource,
    /const refreshDirectControls[\s\S]*?getBoundingClientRect\(\)[\s\S]*?scheduleDirectDetail\(selected, rect\)[\s\S]*?const directChromeTokens/,
    'direct selection feedback must paint its bounding box before rich geometry',
  );
  assert.match(
    projectEditorSource,
    /const authoredElementByPath = useMemo[\s\S]*?elements\.set\(item\.path, item\)[\s\S]*?reconcileSelectionSnapshotWithElement\([\s\S]*?authoredElementByPath\.get\(message\.payload\.path\)/,
    'selection reconciliation must use the already parsed path index instead of reparsing HTML per click',
  );
  assert.match(
    liveDomHelpersSource,
    /export function reconcileSelectionSnapshotWithElement[\s\S]*?attributes: authored\.attributes[\s\S]*?reconcileSelectionSnapshotWithSource[\s\S]*?reconcileSelectionSnapshotWithElement\(snapshot, authored\)/,
    'source reconciliation must share the constant-time authored-element merge',
  );
  assert.match(
    canvasProtocolSource,
    /selectionSequence\?: number[\s\S]*?detail\?: 'identity' \| 'computed'[\s\S]*?value\.selectionSequence < 1[\s\S]*?value\.detail !== 'identity'[\s\S]*?value\.detail !== 'computed'/,
    'deferred selection detail must carry a bounded phase and sequence',
  );
  const phasedSelection = canvasProtocol.withCanvasGeneration('latency-generation', {
    type: 'html-editor-selection',
    breakpointId: 'base',
    payload: {
      path: '0',
      tag: 'main',
      id: '',
      classes: [],
      attributes: {},
      text: '',
      hasElementChildren: true,
      computedStyle: {},
    },
    selectedPaths: ['0'],
    revision: 1,
    selectionSequence: 7,
    detail: 'identity',
  });
  assert.equal(canvasProtocol.isCanvasToEditorMessage(phasedSelection, 'latency-generation'), true);
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage({ ...phasedSelection, detail: 'slow' }, 'latency-generation'),
    false,
  );
  assert.equal(
    canvasProtocol.isCanvasToEditorMessage(
      { ...phasedSelection, selectionSequence: undefined },
      'latency-generation',
    ),
    false,
  );
  assert.match(
    interactionRuntimeSource,
    /if \(action === 'seek' \|\| action === 'pause'\)[\s\S]*?renderGroupedPreviewTime\([\s\S]*?if \(action === 'pause'\) \{[\s\S]*?__publishPreviewDuration\(\)/,
    'scrubbing must not echo invariant duration telemetry for every rendered Seek',
  );
  assert.match(
    projectIoSource,
    /compileHtmlComponentInstanceInteractions\([\s\S]*?hydratedComponents[\s\S]*?pageAnimationDocument[\s\S]*?animationDocument\?\.interactions\.length[\s\S]*?patchInteractionDocument/,
    'publication must inject the same merged component runtime',
  );
  const runtimeVariantStart = interactionRuntimeSource.indexOf('const componentEditorRootFor = element => {');
  const runtimeVariantEnd = interactionRuntimeSource.indexOf('const perform = (action, elements, reversing) => {', runtimeVariantStart);
  assert.notEqual(runtimeVariantStart, -1);
  assert.notEqual(runtimeVariantEnd, -1);
  const runtimeVariant = interactionRuntimeSource.slice(runtimeVariantStart, runtimeVariantEnd);
  assert.match(runtimeVariant, /body\.firstElementChild/);
  assert.match(runtimeVariant, /data-kodety-component-editor/);
  assert.match(runtimeVariant, /\|\| editorComponent\.root/);
  assert.match(runtimeVariant, /effectiveComponentVariantId/);
  assert.match(runtimeVariant, /overrideVariantId/);
  assert.match(runtimeVariant, /data-kodety-component-variant-editor/);
  assert.ok(
    runtimeVariant.indexOf('if (variantExists(overrideVariantId))')
      < runtimeVariant.indexOf("root.getAttribute('data-kodety-component-variant')"),
    'variant overrides must win over the authored base variant snapshot',
  );
  assert.match(runtimeVariant, /__kodetyComponentRuntimeVariantId = variant\.id/);
  assert.match(
    runtimeVariant,
    /transition\.ready\.catch\(\(\) => undefined\)[\s\S]*?transition\.updateCallbackDone\.catch\(\(\) => undefined\)[\s\S]*?transition\.finished\.then\(cleanup, cleanup\)/,
    'replaced component view transitions must observe every rejecting lifecycle promise',
  );
  assert.match(interactionRuntimeSource, /document\.addEventListener\('kodety:component-variant', variantChanged\)/);
  assert.match(interactionRuntimeSource, /dynamicTriggerBindings/);
  assert.match(
    interactionRuntimeSource,
    /interaction\.trigger === 'click-start'[\s\S]*?event\.isPrimary === false[\s\S]*?event\.button !== 0[\s\S]*?addEventListener\('pointerdown', start\)[\s\S]*?removeEventListener\('pointerdown', start\)/,
    'Click Start must bind and clean up pointerdown',
  );
  assert.match(
    interactionRuntimeSource,
    /interaction\.trigger === 'appear'[\s\S]*?run\(timeline, 'restart'\)[\s\S]*?new IntersectionObserver[\s\S]*?entry\.isIntersecting[\s\S]*?observer\.disconnect\(\)/,
    'Appear must be a one-shot viewport observer with cleanup',
  );
  assert.match(
    interactionRuntimeSource,
    /interaction\.trigger === 'mouse-enter'[\s\S]*?interaction\.trigger === 'mouse-leave'[\s\S]*?\? 'mouseenter'[\s\S]*?: 'mouseleave'[\s\S]*?run\(timeline, 'restart'\)/,
    'Mouse Enter and Mouse Leave must remain separate one-way native events',
  );
  assert.match(
    interactionRuntimeSource,
    /interaction\.reducedMotion === 'end'[\s\S]*?timeline\.progress\(1, true\)\.pause\(\)/,
    'reduced motion must finish visual tracks while GSAP suppresses imperative callbacks',
  );
  assert.match(compilerSource, /componentAncestryIndex\(componentNodes\)/);
  assert.match(compilerSource, /const companionDocuments = new Map<string, InteractionDocument>\(\)/);

  console.log('HTML component interaction runtime contracts passed.');
} finally {
  await server.close();
}

// Keep the executable runtime regressions in the standard component-
// interactions test route without expanding package.json's script surface.
await import('./test-interactions-hardening.mjs');
