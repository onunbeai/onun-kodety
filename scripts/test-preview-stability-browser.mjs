import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { buildCodeComponentReactRuntime } from './vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserName = process.env.KODETY_TEST_BROWSER || 'chromium';
const browserType = new Map(Object.entries({ chromium, firefox, webkit })).get(browserName);
assert.ok(browserType, `Unsupported KODETY_TEST_BROWSER: ${browserName}`);
const require = createRequire(import.meta.url);
const editorSource = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8');
const moveStart = editorSource.indexOf('  const moveLayer = (');
const moveEnd = editorSource.indexOf('\n  useLayoutEffect(() => {', moveStart);
const keyboardMoveStart = editorSource.indexOf('  const moveSelectedLayer = (');
const keyboardMoveEnd = editorSource.indexOf('\n  const membershipPreviewLabel', keyboardMoveStart);
const assetsStart = editorSource.indexOf('  const getRuntimeAssetPathIndex = useCallback(');
const assetResetStart = editorSource.indexOf('    runtimeAssetFramesRef.current = new WeakSet();');
const assetResetEnd = editorSource.indexOf('    if (canvasMutationReplayTimerRef.current', assetResetStart);
const assetsEnd = editorSource.indexOf('\n  useLayoutEffect(() => {', assetsStart);
const assetRouteStart = editorSource.indexOf('      const bufferedAssetContext = event.source');
const assetRouteEnd = editorSource.indexOf('      if (!isCanvasToEditorMessage(event.data, expectedGeneration)) return;', assetRouteStart);
assert.ok(assetsStart > 0 && assetsEnd > assetsStart && assetRouteEnd > assetRouteStart);
assert.ok(moveStart > 0 && moveEnd > moveStart && keyboardMoveStart > moveEnd && keyboardMoveEnd > keyboardMoveStart);
const historyReader = direction => {
  const start = editorSource.indexOf(`  const ${direction} = useCallback(() => {`) + `  const ${direction} = useCallback(() => {`.length;
  const end = editorSource.indexOf('    historyIndexRef.current = index;', start);
  assert.ok(start > 0 && end > start);
  return `() => {${editorSource.slice(start, end)} return liveProjection; }`;
};
const bundle = await build({
  stdin: { contents: `
    import {buildPreview, resolvePreviewStylesheet} from './lib/html-editor/preview';
    import {inlinePreviewCssImports, rewritePreviewSrcset} from './lib/html-editor/preview-content';
    import {injectInfiniteCanvasRuntime, injectInfiniteCanvasPassiveRuntime} from './lib/html-editor/infinite-canvas-runtime';
    import {patchMoveElement, remapPathAfterMove, inspectSourceElementIndex} from './lib/html-editor/source-patcher';
    import {canMoveStaticCanvasElement, canReplayLiveStructureHistory, liveStructureInverse} from './lib/html-editor/editor-live-dom-helpers';
    import {createCanvasViewStateStore, commitCanvasViewTransaction, snapshotCanvasViewState, remapCanvasViewStatePaths} from './lib/html-editor/canvas-view-state';
    import {withCanvasGeneration, isCanvasToEditorMessage} from './lib/html-editor/canvas-protocol';
    const createBufferedAssetHarness = (project, activeSurfacePreview, activeFrame) => {
      const useCallback = callback => callback;
      const previewProjectRef = {current: project};
      const previewAssetProjectsRef = {current: new WeakMap([[activeSurfacePreview, project]])};
      const activeCanvasGenerationRef = {current: 'stability-1'};
      const runtimeAssetFramesRef = {current: new WeakSet()};
      const runtimeFontAssetFramesRef = {current: new WeakSet()};
      const runtimeAssetPathsSentFramesRef = {current: new WeakMap()};
      const bufferedRuntimeAssetFramesRef = {current: new WeakMap()};
      const runtimeAssetPathIndexRef = {current: null};
      const pageEditorCanvasSurfaceRef = {current: {preview: activeSurfacePreview}};
      const componentEditorCanvasSurfaceRef = {current: null};
      const editorCanvasPreviewCacheRef = {current: {preview: activeSurfacePreview}};
      const returnSurfacePreviewBootstrapRef = {current: null};
      ${editorSource.slice(assetsStart, assetsEnd)}
      const receive = event => {
        const authority = {frame: activeFrame};
        const expectedGeneration = activeCanvasGenerationRef.current;
        ${editorSource.slice(assetRouteStart, assetRouteEnd)}
      };
      return {receive, register: (frame, generation = activeSurfacePreview.generation, phase = 'fonts') => sendRuntimeAssetsToFrame(frame, phase, generation),
        activateComponent: (nextProject, nextPreview, nextFrame) => {
          previewProjectRef.current = nextProject;
          previewAssetProjectsRef.current.set(nextPreview, nextProject);
          activeSurfacePreview = nextPreview;
          activeCanvasGenerationRef.current = nextPreview.generation;
          activeFrame = nextFrame;
          componentEditorCanvasSurfaceRef.current = {preview: nextPreview};
          editorCanvasPreviewCacheRef.current = {preview: nextPreview};
          ${editorSource.slice(assetResetStart, assetResetEnd)}
        },
        replaceCurrentProject: () => { previewProjectRef.current = {...project, files: {...project.files,
          'media/hero.svg': {...project.files['media/hero.svg'], text: '<svg xmlns="http://www.w3.org/2000/svg" width="999" height="40"/>'}}}; },
        sent: frame => Array.from(runtimeAssetPathsSentFramesRef.current.get(frame) || [])};
    };
    const createMoveHandler = harness => {
      const {editorSourceRef, commitLiveStructure, changeSource, reconcileCanvasSelectionForStructure, animatedCanvas, hydratedFramerProject} = harness;
      const resolvedActiveLocale = 'pt-BR';
      const localization = {sourceLocale: 'pt-BR'};
      const toast = {error: message => { throw new Error(message); }};
      ${editorSource.slice(moveStart, moveEnd)}
      return moveLayer;
    };
    const createKeyboardMoveHandler = harness => {
      const {selection, tree, authoredElementByPath, moveLayer} = harness;
      ${editorSource.slice(keyboardMoveStart, keyboardMoveEnd)}
      return moveSelectedLayer;
    };
    const createHistoryReaders = harness => {
      const {history, historyIndexRef, projectRef, liveHistoryTransitionsRef, canvasSemanticSurfaceKeyRef, synchronizeLiveStructure} = harness;
      const prepareLiveVisualHistoryProjection = () => null;
      return {undo: ${historyReader('undo')}, redo: ${historyReader('redo')}};
    };
    window.testPreview = {buildPreview, resolvePreviewStylesheet, inlinePreviewCssImports, rewritePreviewSrcset, injectInfiniteCanvasRuntime, injectInfiniteCanvasPassiveRuntime, createMoveHandler, createKeyboardMoveHandler, createHistoryReaders, createBufferedAssetHarness, inspectSourceElementIndex, liveStructureInverse, canMoveStaticCanvasElement, createCanvasViewStateStore, commitCanvasViewTransaction, snapshotCanvasViewState, remapCanvasViewStatePaths};
  `, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  plugins: [{ name: 'preview-browser-test', setup(builder) {
    builder.onResolve({ filter: /^virtual:coday-react-runtime$/ }, () => ({ path: 'runtime', namespace: 'test-runtime' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-runtime' }, async () => ({ contents: `export default ${JSON.stringify(await buildCodeComponentReactRuntime())}` }));
    builder.onResolve({ filter: /\?raw$/ }, args => ({
      path: args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path.slice(0, -4)) : require.resolve(args.path.slice(0, -4)), namespace: 'test-raw',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'test-raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});

const browser = await browserType.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://**/*', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const preparation = await page.evaluate(() => {
    const { buildPreview, resolvePreviewStylesheet, rewritePreviewSrcset, inlinePreviewCssImports } = window.testPreview;
    const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const srcset = `${image} 1x, /large.gif 2x`;
    const rewritten = rewritePreviewSrcset(srcset, url => url === '/large.gif' ? 'blob:fixture' : null);
    const inputCss = '@import "theme.css" layer(theme) supports(display: grid) screen and (min-width: 600px);';
    const html = `<!doctype html><html><head><style>${inputCss}</style></head><body>Previous body text<main><section class="hero">Previous section</section><img src="${image}" srcset="${image} 1x"></main></body></html>`;
    const file = (path, text, mimeType) => ({ path, text, mimeType });
    const project = { name: 'Stability fixture', mainHtmlPath: 'index.html', rootPath: '', openedAt: 1, files: {
      'index.html': file('index.html', html, 'text/html'),
      'theme.css': file('theme.css', '.hero{color:rgb(255,0,0)}', 'text/css'),
    } };
    window.fixtureProject = project;
    const css = resolvePreviewStylesheet(project, 'index.html', inputCss).cssText;
    const preview = buildPreview(project, true, [], false, [], true, null, 'stability-1', 1, true);
    window.fixturePreview = preview;
    window.messages = [];
    window.addEventListener('message', event => window.messages.push(event.data));
    const iframe = document.createElement('iframe');
    iframe.id = 'canvas';
    iframe.style.cssText = 'width:900px;height:700px';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = preview.html;
    document.body.append(iframe);
    return {
      rewritten, srcset, image, css,
      untouched: inlinePreviewCssImports('/* @import "theme.css"; */ .x{content:"@import theme.css;"}', () => 'bad'),
    };
  });
  assert.equal(preparation.rewritten, `${preparation.image} 1x, blob:fixture 2x`);
  assert.match(preparation.css, /@layer theme/);
  assert.match(preparation.css, /@supports \(display: grid\)/);
  assert.match(preparation.css, /@media screen and \(min-width: 600px\)/);
  assert.equal(preparation.untouched, '/* @import "theme.css"; */ .x{content:"@import theme.css;"}');
  const conditions = await page.evaluate(async () => {
    const cases = [
      ['', 'rgb(255, 0, 0)'],
      ['layer(theme)', 'rgb(255, 0, 0)'],
      ['layer', 'rgb(255, 0, 0)'],
      ['supports(display: grid)', 'rgb(255, 0, 0)'],
      ['supports(not (display: grid))', 'rgb(0, 0, 0)'],
      ['layer(theme) supports(display: grid) screen and (min-width: 600px)', 'rgb(255, 0, 0)'],
      ['screen and (max-width: 200px)', 'rgb(0, 0, 0)'],
    ];
    const results = [];
    for (const [suffix, expected] of cases) {
      const css = window.testPreview.inlinePreviewCssImports(`@import "theme.css" ${suffix};`, () => '.hero{color:rgb(255,0,0)}');
      const frame = document.createElement('iframe');
      frame.style.width = '900px';
      const loaded = new Promise(resolve => frame.onload = resolve);
      frame.srcdoc = `<style>${css}</style><div class="hero">Condition</div>`;
      document.body.append(frame);await loaded;
      results.push([suffix, frame.contentWindow.getComputedStyle(frame.contentDocument.querySelector('.hero')).color, expected]);
      frame.remove();
    }
    const external = `data:text/css,${encodeURIComponent('.hero {color: rgb(0,0,255)}')}`;
    const mixed = window.testPreview.inlinePreviewCssImports(`@import "theme.css"; @import "${external}";`, url => url === 'theme.css' ? '.hero{color:red}' : null);
    const frame = document.createElement('iframe');
    const loaded = new Promise(resolve => frame.onload = resolve);
    frame.srcdoc = `<style>${mixed}</style><div class="hero">Mixed import</div>`;
    document.body.append(frame);await loaded;
    results.push(['local before external',frame.contentWindow.getComputedStyle(frame.contentDocument.querySelector('.hero')).color,'rgb(0, 0, 255)']);
    frame.remove();
    return results;
  });
  for (const [name, actual, expected] of conditions) assert.equal(actual, expected, `computed import semantics: ${name}`);
  await page.waitForFunction(() => window.messages.some(message => message.type === 'html-editor-buffer-ready'));
  const frame = page.frames().find(candidate => candidate.parentFrame());
  assert.ok(frame);
  assert.equal(await frame.locator('.hero').evaluate(element => getComputedStyle(element).color), 'rgb(255, 0, 0)', 'initial preview must preserve import conditions');
  await frame.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
  assert.equal(await frame.locator('img').getAttribute('srcset'), `${preparation.image} 1x`, 'responsive image bytes must survive preview construction');

  for (const [index, markup] of ['<main></main>', '<header>New</header><main><p>Current</p></main>', '', '<main><section>Restored explicitly</section></main>'].entries()) {
    const mutationId = `body-${index}`;
    await page.evaluate(({ markup, mutationId, index }) => document.querySelector('#canvas').contentWindow.postMessage({
      type: 'html-editor-live-structure', operation: 'replace-body', markup,
      generation: 'stability-1', revision: index + 2, mutationId,
    }, '*'), { markup, mutationId, index });
    await page.waitForFunction(id => window.messages.some(message => message.mutationId === id), mutationId);
    const reply = await page.evaluate(id => window.messages.find(message => message.mutationId === id), mutationId);
    assert.equal(reply.type, 'html-editor-live-structure-applied');
    assert.equal(await frame.evaluate(() => Array.from(document.body.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()), '', 'body text from the previous revision must be removed');
    assert.equal(await frame.locator('body').count(), 1, 'body and bridge must survive every replacement, including intentional empty content');
    assert.equal(await frame.locator('script[data-html-editor-bridge]').count(), 1);
    const actual = await frame.evaluate(() => Array.from(document.body.children).filter(element => /^\d+$/.test(element.getAttribute('data-html-editor-path') || '')).map(element => element.textContent).join('|'));
    const expected = ['','New|Current','','Restored explicitly'][index];
    assert.equal(actual, expected, await frame.evaluate(() => JSON.stringify(Array.from(document.body.children).filter(e=>e.hasAttribute('data-html-editor-path')).map(e=>e.outerHTML.slice(0,300)))));
    assert.equal(await frame.locator('body').getAttribute('data-html-editor-path'), '');
  }
  // Run the actual editor callbacks against the generated bridge. This checks
  // source order, stable DOM identity, remapped addresses and reversible moves
  // without mistaking postMessage delivery for an applied mutation.
  await page.evaluate(() => {
    window.structureSource = '<!doctype html><html><head></head><body><section id="alpha"><h2>A</h2><p>Alpha</p></section><section id="beta"><h2>B</h2></section><section id="gamma"><p>C</p></section></body></html>';
    window.structureRevision = 10;
    window.moveDecisions = [];
  });
  const moveBody = await page.evaluate(() => window.structureSource.match(/<body>([\s\S]*)<\/body>/)[1]);
  await page.evaluate(markup => document.querySelector('#canvas').contentWindow.postMessage({
    type: 'html-editor-live-structure', operation: 'replace-body', markup,
    generation: 'stability-1', revision: 10, mutationId: 'move-fixture',
  }, '*'), moveBody);
  await page.waitForFunction(() => window.messages.some(message => message.mutationId === 'move-fixture'));
  await frame.evaluate(() => { window.originalAlpha = document.querySelector('#alpha'); });
  const assertStructure = async (expectedIds, expectedSource) => {
    assert.deepEqual(await frame.locator('body > section').evaluateAll(nodes => nodes.map(node => node.id)), expectedIds);
    const expectedPaths = await page.evaluate(source => [...window.testPreview.inspectSourceElementIndex(source).byPath.values()].filter(node => node.attributes.id).map(node => [node.attributes.id, node.path]), expectedSource);
    assert.deepEqual(await frame.locator('body > section').evaluateAll(nodes => nodes.map(node => [node.id, node.getAttribute('data-html-editor-path')])), expectedPaths);
    assert.equal(await frame.evaluate(() => window.originalAlpha === document.querySelector('#alpha')), true, 'move/undo/redo must retain the mounted element');
  };
  const moved = await page.evaluate(() => {
    const {createMoveHandler, createKeyboardMoveHandler, liveStructureInverse} = window.testPreview;
    const before = window.structureSource;
    const moveLayer = createMoveHandler({
      editorSourceRef: {current: before}, animatedCanvas: false, hydratedFramerProject: false,
      reconcileCanvasSelectionForStructure: () => { throw new Error('Static move unexpectedly rebuilt'); },
      changeSource: () => { throw new Error('Static move unexpectedly rebuilt'); },
      commitLiveStructure: (source, message) => {
        window.structureSource = source;
        window.forwardMove = message;
        window.inverseMove = liveStructureInverse(before, message).message;
        document.querySelector('#canvas').contentWindow.postMessage({...message, type: 'html-editor-live-structure', generation: 'stability-1', revision: ++window.structureRevision, mutationId: 'static-move'}, '*');
      },
    });
    const body = {path: '', children: [{path: '0'}, {path: '1'}, {path: '2'}]};
    createKeyboardMoveHandler({selection: {path: '0'}, tree: [body], authoredElementByPath: new Map([['', body]]), moveLayer})('down');
    return {before, after: window.structureSource};
  });
  await page.waitForFunction(() => window.messages.some(message => message.mutationId === 'static-move' && message.type === 'html-editor-live-structure-applied'));
  assert.notEqual(moved.before, moved.after, 'keyboard movement of a direct body child must change canonical source');
  await assertStructure(['beta', 'alpha', 'gamma'], moved.after);
  for (const [name, field, source, ids] of [
    ['undo-move', 'inverseMove', moved.before, ['alpha', 'beta', 'gamma']],
    ['redo-move', 'forwardMove', moved.after, ['beta', 'alpha', 'gamma']],
  ]) {
    await page.evaluate(({name, field}) => document.querySelector('#canvas').contentWindow.postMessage({...window[field], type: 'html-editor-live-structure', generation: 'stability-1', revision: ++window.structureRevision, mutationId: name}, '*'), {name, field});
    await page.waitForFunction(id => window.messages.some(message => message.mutationId === id && message.type === 'html-editor-live-structure-applied'), name);
    await assertStructure(ids, source);
  }
  const moveGuards = await page.evaluate(() => {
    const {createMoveHandler, canMoveStaticCanvasElement} = window.testPreview;
    const decisions = [];
    const run = (options, source = window.structureSource) => {
      createMoveHandler({editorSourceRef: {current: source},
        reconcileCanvasSelectionForStructure: () => {},
        changeSource: () => decisions.push('canonical'),
        commitLiveStructure: () => decisions.push('live'),
        ...options,
      })('0', '2', 'after');
    };
    run({animatedCanvas: true, hydratedFramerProject: false});
    run({animatedCanvas: false, hydratedFramerProject: true});
    run({animatedCanvas: false, hydratedFramerProject: false}, window.structureSource.replace('</head>', '<script data-kodety-framer-responsive-runtime></script></head>'));
    const component = '<body><section data-coday-code-instance="instance"><div><p>Owned</p></div></section><aside>Outside</aside></body>';
    return {decisions, ownedSource: canMoveStaticCanvasElement(component, '0/0', '1'), ownedTarget: canMoveStaticCanvasElement(component, '1', '0/0')};
  });
  assert.deepEqual(moveGuards, {decisions: ['canonical', 'canonical', 'canonical'], ownedSource: false, ownedTarget: false}, 'runtime-owned surfaces must retain canonical recovery');
  const historyScopes = await page.evaluate(() => {
    const from = {mainHtmlPath: 'index.html', rootPath: '', openedAt: 1, files: {}};
    const to = {...from, files: {'index.html': {text: 'edited'}}};
    const forward = {source: 'edited', message: {operation: 'remove'}, remapPath: path => path};
    const backward = {source: 'original', message: {operation: 'restore'}, remapPath: path => path};
    const transition = {previous: from, surfaceKey: 'index:pt:public', forward, backward};
    const result = [];
    for (const direction of ['undo', 'redo']) {
      for (const scope of ['same', 'page', 'locale', 'audience', 'session']) {
        const current = direction === 'undo' ? {...to} : from;
        if (scope === 'page' && direction === 'undo') current.mainHtmlPath = 'about.html';
        if (scope === 'session' && direction === 'undo') current.openedAt = 2;
        const target = direction === 'redo' && scope === 'page' ? {...to, mainHtmlPath: 'about.html'}
          : direction === 'redo' && scope === 'session' ? {...to, openedAt: 2} : to;
        const history = [from, direction === 'undo' ? current : target];
        const transitions = new WeakMap([[direction === 'undo' ? current : target, transition]]);
        let posted = 0;
        const readers = window.testPreview.createHistoryReaders({history,
          historyIndexRef: {current: direction === 'undo' ? 1 : 0}, projectRef: {current},
          liveHistoryTransitionsRef: {current: transitions},
          canvasSemanticSurfaceKeyRef: {current: scope === 'locale' ? 'index:en:public' : scope === 'audience' ? 'index:pt:member' : 'index:pt:public'},
          synchronizeLiveStructure: () => { posted++; return true; },
        });
        const projection = readers[direction]();
        result.push({direction, scope, posted, source: projection?.source || null});
      }
    }
    return result;
  });
  for (const result of historyScopes) {
    assert.equal(result.posted, result.scope === 'same' ? 1 : 0, `${result.direction}/${result.scope}: positional history must only run in its original semantic document`);
    assert.equal(result.source, result.scope === 'same' ? result.direction === 'undo' ? 'original' : 'edited' : null);
  }
  const customProperties = await page.evaluate(() => {
    const api = window.testPreview;
    const store = api.createCanvasViewStateStore();
    api.commitCanvasViewTransaction(store, {patches: [
      {path: '0', property: '--Gap', value: '14px'},
      {path: '0', property: '--gap', value: '28px'},
      {path: '0', property: 'gap', value: 'var(--Gap)'},
    ]}, 20);
    api.remapCanvasViewStatePaths(store, path => path === '0' ? '1' : path, 21);
    const state = api.snapshotCanvasViewState(store);
    document.querySelector('#canvas').contentWindow.postMessage({type: 'html-editor-view-state', state, generation: 'stability-1', breakpointId: 'base'}, '*');
    window.customPropertyStore = store;
    return state.patches.map(({path, property, value}) => [path, property, value]);
  });
  assert.deepEqual(customProperties, [['1', '--Gap', '14px'], ['1', '--gap', '28px'], ['1', 'gap', 'var(--Gap)']], 'compaction and structural remapping must preserve distinct CSS variable names');
  const {expect} = await import('@playwright/test');
  await expect.poll(() => frame.locator('#alpha').evaluate(element => {
    const style = getComputedStyle(element);
    return [style.getPropertyValue('--Gap'), style.getPropertyValue('--gap'), style.gap];
  })).toEqual(['14px', '28px', '14px']);
  assert.deepEqual(errors, [], 'actual generated preview must execute without runtime errors');
  // Pending pages must receive their requested assets before they become the
  // editing authority. Waiting for promotion here deadlocked visual readiness
  // until its eight-second recovery deadline on a cold page navigation.
  await page.evaluate(() => {
    const project = {name: 'Pending page assets', mainHtmlPath: 'about.html', rootPath: '', openedAt: 2, files: {
      'about.html': {path: 'about.html', mimeType: 'text/html', text: '<!doctype html><html><body><img src="media/hero.svg" width="60" height="40"></body></html>'},
      'media/hero.svg': {path: 'media/hero.svg', mimeType: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="red"/></svg>'},
      'media/unrequested.svg': {path: 'media/unrequested.svg', mimeType: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"/>'},
    }};
    const preview = window.testPreview.buildPreview(project, true, [], false, [], true, null, 'pending-assets', 1, true);
    const pending = document.createElement('iframe');
    pending.id = 'pending-assets';
    pending.style.cssText = 'position:fixed;top:0;left:0;width:480px;height:400px;opacity:0.01;pointer-events:none';
    pending.setAttribute('sandbox', 'allow-scripts');
    const harness = window.testPreview.createBufferedAssetHarness(project, preview, document.querySelector('#canvas').contentWindow);
    window.pendingAssetHarness = harness;
    window.pendingAssetMessages = [];
    window.addEventListener('message', event => {
      if (event.source === pending.contentWindow) window.pendingAssetMessages.push(event.data);
      harness.receive(event);
    });
    pending.srcdoc = preview.html;
    document.body.append(pending);
  });
  await page.waitForFunction(() => window.pendingAssetMessages.some(message => message.type === 'html-editor-runtime-assets-request'));
  assert.deepEqual(await page.evaluate(() => window.pendingAssetHarness.sent(document.querySelector('#pending-assets').contentWindow)), []);
  await page.evaluate(() => {
    window.pendingAssetHarness.replaceCurrentProject();
    window.pendingAssetHarness.register(document.querySelector('#pending-assets').contentWindow, 'obsolete-generation');
  });
  assert.deepEqual(await page.evaluate(() => window.pendingAssetHarness.sent(document.querySelector('#pending-assets').contentWindow)), [], 'a late load cannot register an unrelated generation');
  await page.evaluate(() => window.pendingAssetHarness.register(document.querySelector('#pending-assets').contentWindow));
  await page.waitForFunction(() => window.pendingAssetMessages.some(message => message.type === 'html-editor-buffer-visuals-ready'), null, {timeout: 4000});
  const bufferedAssets = await page.evaluate(() => {
    const frame = document.querySelector('#pending-assets').contentWindow;
    const before = window.pendingAssetHarness.sent(frame);
    window.pendingAssetHarness.receive({source: {}, data: {type: 'html-editor-runtime-assets-request', generation: 'pending-assets', paths: ['media/unrequested.svg']}});
    window.pendingAssetHarness.receive({source: frame, data: {type: 'html-editor-runtime-assets-request', generation: 'obsolete-generation', paths: ['media/unrequested.svg']}});
    return {before, after: window.pendingAssetHarness.sent(frame), ready: window.pendingAssetMessages.find(message => message.type === 'html-editor-buffer-visuals-ready')};
  });
  assert.deepEqual(bufferedAssets.before, ['media/hero.svg']);
  assert.deepEqual(bufferedAssets.after, bufferedAssets.before, 'unregistered frames and stale generations cannot request project assets');
  assert.equal(bufferedAssets.ready.timedOut, false, 'requested pending-page assets must settle before the recovery deadline');
  await expect.poll(() => page.frameLocator('#pending-assets').locator('img').evaluate(image => ({
    complete: image.complete,
    width: image.naturalWidth,
    ownBlob: image.src.startsWith('blob:'),
  }))).toEqual({complete: true, width: 60, ownBlob: true});
  // A retained page can finish loading while its component editor is active.
  // Its load callback and subsequent requests must keep the bytes and path
  // metadata from that page generation, even when the component has homonyms.
  await page.evaluate(() => {
    const image = (width, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="40"><rect width="100%" height="40" fill="${fill}"/></svg>`;
    const project = {name: 'Retained page B', mainHtmlPath: 'b.html', rootPath: '', openedAt: 3, files: {
      'b.html': {path: 'b.html', mimeType: 'text/html', text: '<!doctype html><html><body><img src="media/hero.svg" width="60" height="40"></body></html>'},
      'media/hero.svg': {path: 'media/hero.svg', mimeType: 'image/svg+xml', data: new TextEncoder().encode(image(60, 'red'))},
      'media/Late.svg': {path: 'media/Late.svg', mimeType: 'image/svg+xml', data: new TextEncoder().encode(image(75, 'orange'))},
    }};
    const preview = window.testPreview.buildPreview(project, true, [], false, [], false, null, 'retained-page-b', 1, true);
    const component = {...project, mainHtmlPath: 'component.html', files: {
      'component.html': {path: 'component.html', mimeType: 'text/html', text: '<!doctype html><html><body><img src="media/hero.svg"></body></html>'},
      'media/hero.svg': {...project.files['media/hero.svg'], data: new TextEncoder().encode(image(999, 'blue'))},
      'media/late.svg': {path: 'media/late.svg', mimeType: 'image/svg+xml', data: new TextEncoder().encode(image(999, 'blue'))},
    }};
    const componentPreview = window.testPreview.buildPreview(component, true, [], false, [], false, null, 'active-component-c', 1, true);
    const pending = document.createElement('iframe');
    pending.id = 'retained-page-b';
    pending.style.cssText = 'position:fixed;top:0;left:0;width:480px;height:400px;opacity:0.01;pointer-events:none';
    pending.setAttribute('sandbox', 'allow-scripts');
    const harness = window.testPreview.createBufferedAssetHarness(project, preview, document.querySelector('#canvas').contentWindow);
    window.retainedPageHarness = harness;
    window.retainedPageMessages = [];
    window.addEventListener('message', event => {
      if (event.source === pending.contentWindow) window.retainedPageMessages.push(event.data);
      harness.receive(event);
    });
    pending.srcdoc = preview.html;
    document.body.append(pending);
    // Register before C becomes active, then exercise the real generation
    // reset effect. A WeakMap reset here would revoke B's in-flight requests.
    harness.register(pending.contentWindow, preview.generation);
    harness.activateComponent(component, componentPreview, document.querySelector('#canvas').contentWindow);
    // Also cover a load callback that arrives only after C became active. This
    // mock Window records transfers without letting the requested-asset route
    // hide an incorrect eager path/font selection or stale file index.
    const sent = [];
    const lateFrame = {postMessage: message => sent.push(message)};
    harness.register(lateFrame, preview.generation, 'all');
    window.retainedPageEagerAssets = sent.flatMap(message => (message.assets || []).map(asset => ({
      path: asset.path, text: new TextDecoder().decode(asset.bytes), generation: message.generation,
    })));
    window.retainedPageProject = project;
  });
  await page.waitForFunction(() => window.retainedPageMessages.some(message => message.type === 'html-editor-buffer-visuals-ready'), null, {timeout: 4000});
  assert.equal(await page.evaluate(() => window.retainedPageMessages.find(message => message.type === 'html-editor-buffer-visuals-ready').timedOut), false, 'B must settle while component C owns the editor');
  await expect.poll(() => page.frameLocator('#retained-page-b').locator('img').evaluate(image => image.naturalWidth)).toBe(60);
  const retainedEager = await page.evaluate(() => window.retainedPageEagerAssets);
  assert.ok(retainedEager.some(asset => asset.path === 'media/hero.svg' && asset.text.includes('width="60"') && asset.generation === 'retained-page-b'), 'late B load must use B preview metadata and bytes while C is active');
  assert.ok(retainedEager.every(asset => !asset.text.includes('width="999"')), 'C asset bytes cannot leak into retained B');
  const retainedScope = await page.evaluate(() => {
    const frame = document.querySelector('#retained-page-b').contentWindow;
    const harness = window.retainedPageHarness;
    const before = harness.sent(frame);
    harness.receive({source: {}, data: {type: 'html-editor-runtime-assets-request', generation: 'retained-page-b', paths: ['media/Late.svg']}});
    harness.receive({source: frame, data: {type: 'html-editor-runtime-assets-request', generation: 'active-component-c', paths: ['media/Late.svg']}});
    const rejected = harness.sent(frame);
    harness.receive({source: frame, data: {type: 'html-editor-runtime-assets-request', generation: 'retained-page-b', paths: ['MEDIA/LATE.SVG']}});
    return {before, rejected, accepted: harness.sent(frame)};
  });
  assert.deepEqual(retainedScope.rejected, retainedScope.before, 'retention must preserve wrong-generation and unregistered Window rejection');
  assert.ok(retainedScope.accepted.includes('media/late.svg'), 'B retains its own case-insensitive asset index after C becomes active');
  assert.deepEqual(errors, [], 'pending media transfer must not introduce runtime errors');
  console.log(`Preview stability browser passed (${browserName}): real generated bridge, empty/body replacement, source/DOM move and undo/redo, retained node identity, history surface guards, CSS import conditions, responsive data images and pending-page asset settlement.`);
} finally {
  await browser.close();
}
