import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

try {
  const css = await server.ssrLoadModule('/lib/html-editor/css-patcher.ts');
  const breakpointManager = await server.ssrLoadModule('/lib/html-editor/breakpoint-manager.ts');
  const codeComponents = await server.ssrLoadModule('/lib/html-editor/code-components.ts');
  const responsivePublication = await server.ssrLoadModule('/lib/html-editor/responsive-publication.ts');
  const projectIo = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const breakpoints = [
    { id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 },
    { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 },
  ];
  const primary = {
    target: 'rule',
    selector: '.card',
    cssFilePath: 'styles.css',
    pseudo: 'base',
    breakpoint: 'base',
  };
  const mobile = { ...primary, breakpoint: 'mobile' };

  assert.equal(css.CURRENT_BREAKPOINT_SCHEMA_VERSION, 2);
  assert.deepEqual(
    css.DEFAULT_BREAKPOINTS.find(breakpoint => breakpoint.id === 'mobile'),
    { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 480 },
    'new projects must cover current 440px phones with the stock Mobile tier',
  );
  assert.equal(css.isLegacyStockBreakpointRegistry(css.LEGACY_STOCK_BREAKPOINTS), true);
  assert.equal(
    css.isLegacyStockBreakpointRegistry(
      css.LEGACY_STOCK_BREAKPOINTS.map(({ id, width }) => ({ id, width })),
    ),
    true,
    'early stock metadata may omit labels and modes while retaining the exact ids/order/widths',
  );
  assert.equal(
    css.isLegacyStockBreakpointRegistry([
      { id: 'mobile', label: 'Phone', mode: 'max-width', width: 410 },
    ]),
    false,
    'an authored 410px registry is user data, not the old stock registry',
  );

  let stylesheet = css.patchCssDeclaration('', primary, 'opacity', '1', breakpoints, {
    authoritative: true,
  });
  stylesheet = css.patchCssDeclaration(stylesheet, mobile, 'opacity', '0.35', breakpoints, {
    authoritative: true,
  });

  assert.equal(css.readCssRuleDeclarations(stylesheet, primary, breakpoints).opacity, '1');
  assert.equal(css.readCssRuleDeclarations(stylesheet, mobile, breakpoints).opacity, '0.35');
  assert.match(stylesheet, /\.card[^{}]*\{[^}]*opacity:\s*1/);
  assert.match(stylesheet, /@media \(max-width: 410px\)[\s\S]*?opacity:\s*0\.35/);

  stylesheet = css.patchCssDeclaration(stylesheet, mobile, 'opacity', '', breakpoints, {
    authoritative: true,
  });
  assert.equal(css.readCssRuleDeclarations(stylesheet, mobile, breakpoints).opacity, undefined);
  assert.equal(
    css.readInheritedCssRuleDeclarations(stylesheet, mobile, 410, breakpoints).opacity,
    '1',
  );

  assert.equal(css.changeCssEditingTarget, undefined, 'Inline authoring must not exist in the CSS API');
  assert.deepEqual(
    css.normalizeBreakpointRegistry([{ id: 'tablet', label: 'Tablet antigo', width: 810 }]),
    [{ id: 'tablet', label: 'Tablet antigo', mode: 'max-width', width: 810 }],
  );
  assert.deepEqual(
    css.normalizePrimaryBreakpoint({ id: 'desktop-old', label: 'Desktop', width: '1440' }),
    { id: 'base', label: 'Desktop', mode: 'max-width', width: 1440 },
    'the effective primary viewport must be canonical across canvas and publication',
  );

  const mobileDraft = breakpointManager.editBreakpointDraft(breakpoints[1]);
  assert.deepEqual(
    mobileDraft,
    {
      intent: 'edit',
      originalId: 'mobile',
      label: 'Mobile',
      mode: 'max-width',
      width: '410',
    },
    'editing Mobile must prefill the draft from the persisted breakpoint',
  );
  const untouchedMobile = breakpointManager.commitBreakpointDraft(mobileDraft, breakpoints);
  assert.equal(untouchedMobile.ok, true);
  assert.equal(untouchedMobile.changed, false, 'Done without edits must not create a history entry');
  assert.equal(untouchedMobile.breakpoints, breakpoints);
  const editedMobileDraft = { ...mobileDraft, label: 'Phone', width: '390' };
  assert.equal(breakpoints[1].label, 'Mobile', 'typing in a breakpoint draft must not mutate the registry');
  assert.equal(breakpoints[1].width, 410, 'typing a width must remain transient until Done');
  const editedMobile = breakpointManager.commitBreakpointDraft(editedMobileDraft, breakpoints);
  assert.equal(editedMobile.ok, true);
  assert.equal(editedMobile.changed, true);
  assert.deepEqual(breakpoints[1], { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 });
  assert.deepEqual(editedMobile.breakpoints[1], { id: 'mobile', label: 'Phone', mode: 'max-width', width: 390 });

  const newDraft = breakpointManager.createBreakpointDraft(breakpoints);
  assert.equal(breakpoints.length, 2, 'opening Add breakpoint must not persist a placeholder row');
  assert.deepEqual(newDraft, {
    intent: 'create',
    originalId: null,
    label: 'Breakpoint 3',
    mode: 'max-width',
    width: '640',
  });
  assert.equal(
    breakpointManager.resolveBreakpointSelection('breakpoint-3', breakpoints),
    'base',
    'an uncommitted draft id must never become the active breakpoint',
  );
  const added = breakpointManager.commitBreakpointDraft(newDraft, breakpoints);
  assert.equal(added.ok, true);
  assert.equal(added.changed, true);
  assert.equal(added.breakpoints.length, 3);
  assert.equal(added.breakpoint.id, 'breakpoint-3');
  assert.equal(
    breakpointManager.resolveBreakpointSelection(added.breakpoint.id, added.breakpoints),
    added.breakpoint.id,
  );
  assert.equal(
    breakpointManager.resolveBreakpointSelection(added.breakpoint.id, breakpoints),
    'base',
    'Undo/removal must normalize an active id that no longer exists',
  );

  const editorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  const inspectorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
    'utf8',
  );
  const breakpointControlSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBreakpointControl.tsx'),
    'utf8',
  );
  const infiniteCanvasSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInfiniteCanvas.tsx'),
    'utf8',
  );
  const canvasStageSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
    'utf8',
  );
  assert.match(
    editorSource,
    /const authoredCssContext: CssEditingContext = \{[\s\S]*?target: 'rule',[\s\S]*?breakpoint: activeViewportBreakpoint/,
  );
  assert.match(
    editorSource,
    /const componentAuthoringCssPath = editingHtmlComponent\?\.component\.bundle\?\.styleFilePath \|\| '';[\s\S]*?const cssFiles = componentAuthoringCssPath[\s\S]*?\[componentAuthoringCssPath\]/,
  );
  assert.match(
    editorSource,
    /const updateLayerVisibility[\s\S]*?pendingResponsiveLayerVisibilityRef\.current = \{ path, visible \}[\s\S]*?updateVisibility\(pending\.visible\)/,
  );
  assert.doesNotMatch(inspectorSource, /Inline style|kodety-editor-context-tabs|Ou use #id \/ tag/);
  assert.match(inspectorSource, /<HtmlClassSelector[\s\S]*?>State<\/span>/);
  assert.doesNotMatch(editorSource, /html-editor:css-target-preference|target:\s*saved/);
  assert.match(
    editorSource,
    /directStyleCommitRef\.current[\s\S]*?cssContextSelectionPathRef\.current === path[\s\S]*?updateStyle\(property, committedValue\)/,
  );
  assert.match(
    editorSource,
    /never[\s\S]*?mutate the element's style attribute as a recovery path[\s\S]*?type: 'html-editor-select'/,
  );
  const addStart = inspectorSource.indexOf('const add = () => {');
  const editStart = inspectorSource.indexOf('const beginBreakpointEdit', addStart);
  assert.ok(addStart >= 0 && editStart > addStart, 'the breakpoint draft creation boundary must exist');
  const addSource = inspectorSource.slice(addStart, editStart);
  assert.match(addSource, /setBreakpointDraft\(createBreakpointDraft\(breakpoints\)\)/);
  assert.doesNotMatch(
    addSource,
    /\bonChange\s*\(|\bonSelect\??\.\s*\(/,
    'Add must only open a draft; persistence and activation belong to Done',
  );
  assert.match(
    inspectorSource,
    /const beginBreakpointEdit[\s\S]*?setBreakpointDraft\(editBreakpointDraft\(breakpoint\)\)[\s\S]*?const cancelBreakpointEdit[\s\S]*?setBreakpointDraft\(null\)[\s\S]*?const commitCustomBreakpointEdit[\s\S]*?commitBreakpointDraft\(breakpointDraft, breakpoints\)[\s\S]*?result\.changed\) onChange\(result\.breakpoints\)/,
    'existing edits must prefill an isolated draft and only commit it through Done',
  );
  assert.match(
    inspectorSource,
    /event\.key === 'Escape'\) cancelBreakpointEdit\(\)[\s\S]*?value=\{breakpointDraft\.label\}[\s\S]*?value=\{breakpointDraft\.width\}/,
    'the visible form must be controlled by the draft and Escape must cancel it',
  );
  assert.match(
    editorSource,
    /useLayoutEffect\(\(\) => \{[\s\S]*?resolveBreakpointSelection\(requestedViewport, breakpoints\)[\s\S]*?viewportRef\.current = safeViewport[\s\S]*?resolveBreakpointSelection\(currentContext\.breakpoint, breakpoints\)[\s\S]*?setCssContext\(nextContext\)/,
    'registry changes, including Undo, must repair viewport and CSS selection before paint',
  );
  assert.match(
    editorSource,
    /const selectCanvasBreakpoint = \(id: string\) => \{[\s\S]*?readEditorMetadata\(currentProject\)\.breakpoints[\s\S]*?resolveBreakpointSelection\(id, availableBreakpoints\)[\s\S]*?setViewport\(selectedId\)/,
    'selection must validate against the synchronously committed project registry',
  );
  assert.match(
    breakpointControlSource,
    /const safeActiveId = resolveBreakpointSelection\(activeId, breakpoints\)[\s\S]*?activeId=\{safeActiveId\}/,
    'the breakpoint control must never render an orphan active tab',
  );
  const changeBreakpointsStart = editorSource.indexOf('  const changeBreakpoints = (');
  const changeBreakpointsEnd = editorSource.indexOf('\n  const ', changeBreakpointsStart + 10);
  assert.ok(
    changeBreakpointsStart >= 0 && changeBreakpointsEnd > changeBreakpointsStart,
    'the breakpoint registry commit boundary must exist',
  );
  const changeBreakpointsSource = editorSource.slice(changeBreakpointsStart, changeBreakpointsEnd);
  assert.match(
    changeBreakpointsSource,
    /updateEditorMetadata\(updated, metadata => \(\{[\s\S]*?breakpoints: next,[\s\S]*?\}\)\)/,
    'changeBreakpoints must commit the registry through the schema-sealing metadata helper',
  );

  const openProjectStart = editorSource.indexOf('  const openProject = useCallback(');
  const openProjectEnd = editorSource.indexOf('\n  const openProjectRef =', openProjectStart);
  assert.ok(
    openProjectStart >= 0 && openProjectEnd > openProjectStart,
    'the common project-open boundary must exist',
  );
  const openProjectSource = editorSource.slice(openProjectStart, openProjectEnd);
  assert.match(
    openProjectSource,
    /migrateLegacyStockBreakpointProject\(next\)[\s\S]*?breakpointMigrationChanged[\s\S]*?projectRef\.current = next/,
    'local and remote snapshots must migrate before the project becomes visible to React or the canvas',
  );
  assert.match(
    openProjectSource,
    /const localBootstrapIsAcknowledged = Boolean\([\s\S]*?!breakpointMigrationChanged[\s\S]*?localBootstrap\.projectSignature === localBootstrap\.acknowledgedProjectSignature/,
    'a migrated IndexedDB bootstrap is a new local draft, never an ACK of the old remote bytes',
  );
  assert.match(
    openProjectSource,
    /lastWordPressDraftSignatureRef\.current =[\s\S]*?breakpointMigrationChanged\s*\?\s*''/,
    'a migrated bootstrap cannot retain the stale acknowledged signature',
  );
  assert.match(
    openProjectSource,
    /if \([\s\S]*?breakpointMigrationChanged[\s\S]*?\) \{[\s\S]*?scheduleWordPressDraftWrite\(next\)/,
    'migration must schedule the normalized snapshot even when it came from localBootstrap',
  );
  const infiniteResizeStart = infiniteCanvasSource.indexOf('  const startFrameResize = (');
  const infiniteResizeEnd = infiniteCanvasSource.indexOf('\n  const markActiveDocumentReady =', infiniteResizeStart);
  assert.ok(
    infiniteResizeStart >= 0 && infiniteResizeEnd > infiniteResizeStart,
    'the Infinite Canvas frame resize gesture boundary must exist',
  );
  const infiniteResizeSource = infiniteCanvasSource.slice(infiniteResizeStart, infiniteResizeEnd);
  assert.match(
    infiniteCanvasSource,
    /onResizeFrame\?: \([\s\S]*?phase: 'preview' \| 'commit',[\s\S]*?\) => void/,
    'Infinite Canvas resize events must distinguish transient preview from persistence',
  );
  assert.match(
    infiniteResizeSource,
    /let finalWidth = frame\.width;[\s\S]*?let finalHeight = frame\.height;[\s\S]*?const onMove = \(moveEvent: PointerEvent\) => \{[\s\S]*?finalWidth = frame\.width \+ \(moveEvent\.clientX - start\.x\) \/ scale;[\s\S]*?onResizeFrame\(frame\.id, 'width', finalWidth, 'preview'\)[\s\S]*?finalHeight = frame\.height \+ \(moveEvent\.clientY - start\.y\) \/ scale;[\s\S]*?onResizeFrame\(frame\.id, 'height', finalHeight, 'preview'\)/,
    'pointer movement must resize the rendered frame through preview samples only',
  );
  const infiniteResizeMoveStart = infiniteResizeSource.indexOf('    const onMove = (moveEvent: PointerEvent) => {');
  const infiniteResizeUpStart = infiniteResizeSource.indexOf('    const onUp = ', infiniteResizeMoveStart);
  assert.ok(
    infiniteResizeMoveStart >= 0 && infiniteResizeUpStart > infiniteResizeMoveStart,
    'Infinite Canvas resize must expose separate move and completion handlers',
  );
  assert.doesNotMatch(
    infiniteResizeSource.slice(infiniteResizeMoveStart, infiniteResizeUpStart),
    /'commit'/,
    'drag movement must never persist breakpoint metadata before pointer completion',
  );
  assert.match(
    infiniteResizeSource.slice(infiniteResizeUpStart),
    /if \(finished\) return;[\s\S]*?finished = true;[\s\S]*?onResizeFrame\(frame\.id, 'width', finalWidth, 'commit'\)[\s\S]*?onResizeFrame\(frame\.id, 'height', finalHeight, 'commit'\)/,
    'gesture completion must emit the final sample exactly once through the commit phase',
  );

  assert.match(
    infiniteResizeSource.slice(infiniteResizeMoveStart, infiniteResizeUpStart),
    /if \(moveEvent\.pointerId !== pointerId \|\| finished\) return;/,
    'resize movement must ignore other pointers and completed gestures',
  );
  const resizeCompletionSource = infiniteResizeSource.slice(infiniteResizeUpStart);
  assert.match(
    resizeCompletionSource,
    /if \(endEvent && 'pointerId' in endEvent && endEvent\.pointerId !== pointerId\) return;/,
    'another pointer cannot finish the active frame resize',
  );
  const resizeScopeGuard = resizeCompletionSource.indexOf('if (scope !== gestureScopeRef.current) return;');
  const resizeFirstCommit = resizeCompletionSource.indexOf("onResizeFrame(frame.id, 'width', finalWidth, 'commit')");
  assert.ok(
    resizeScopeGuard >= 0 && resizeScopeGuard < resizeFirstCommit,
    'resize completion must reject a changed canvas context before persisting frame dimensions',
  );

  const infiniteResizeBindingStart = canvasStageSource.indexOf("          onResizeFrame={(id, property, value, phase) => {");
  const infiniteResizeBindingEnd = canvasStageSource.indexOf('\n          onDragInsertPreview=', infiniteResizeBindingStart);
  assert.ok(
    infiniteResizeBindingStart >= 0 && infiniteResizeBindingEnd > infiniteResizeBindingStart,
    'the Infinite Canvas resize binding must exist in the canvas stage',
  );
  const infiniteResizeBindingSource = canvasStageSource.slice(
    infiniteResizeBindingStart,
    infiniteResizeBindingEnd,
  );
  assert.match(
    infiniteResizeBindingSource,
    /const next = Math\.max\(limits\[0\], Math\.min\(limits\[1\], Math\.round\(value\)\)\);[\s\S]*?setViewportSizes\([\s\S]*?\[property\]: next,[\s\S]*?if \(phase !== 'commit' \|\| property !== 'width'\) return;/,
    'preview and commit must render the clamped width, while only a committed width may reach breakpoint metadata',
  );
  const registryCommitBoundary = infiniteResizeBindingSource.indexOf(
    "if (phase !== 'commit' || property !== 'width') return;",
  );
  assert.ok(registryCommitBoundary >= 0, 'the breakpoint registry commit gate must exist');
  assert.doesNotMatch(
    infiniteResizeBindingSource.slice(0, registryCommitBoundary),
    /changePrimaryBreakpoint|changeBreakpoints/,
    'preview samples must remain visual-only and cannot mutate the breakpoint registry',
  );
  const registryCommitSource = infiniteResizeBindingSource.slice(registryCommitBoundary);
  assert.match(
    registryCommitSource,
    /if \(id === 'base'\)[\s\S]*?primaryBreakpoint\.width !== next[\s\S]*?changePrimaryBreakpoint\(\{ \.\.\.primaryBreakpoint, width: next \}\)/,
    'committing the rendered base frame width must update the primary breakpoint registry entry',
  );
  assert.match(
    registryCommitSource,
    /breakpoints\.find\(breakpoint => breakpoint\.id === id\)[\s\S]*?active\.width !== next[\s\S]*?changeBreakpoints\([\s\S]*?breakpoint\.id === id \? \{ \.\.\.breakpoint, width: next \} : breakpoint/,
    'committing a rendered child frame width must update that exact breakpoint registry entry',
  );

  const responsiveSource = '<!doctype html><html><head><title>Parity</title></head><body><main class="card">Mobile</main></body></html>';
  const responsiveProject = {
    name: 'Breakpoint publication parity',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 0,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: responsiveSource,
      },
      'styles.css': {
        path: 'styles.css',
        mimeType: 'text/css',
        text: '.card { display: grid; }\n@media (max-width: 390px) { .card { display: block; } }\n',
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          primaryBreakpoint: { id: 'legacy-desktop', label: 'Desktop', width: 1440 },
          breakpoints: [{ id: 'mobile', label: 'Phone', width: 390 }],
        }),
      },
    },
  };
  assert.equal(
    responsivePublication.projectNeedsResponsiveViewportNormalization(responsiveProject),
    true,
    'a legacy page without a device-width viewport cannot publish through the raw workspace fast path',
  );
  const responsiveTransport = projectIo.prepareProjectForTransport(responsiveProject);
  assert.match(
    responsiveTransport.files['index.html'].text,
    /<meta name="viewport" content="width=device-width, initial-scale=1">/,
    'publication must make the real mobile layout viewport equal to the canvas width',
  );
  assert.equal(
    responsiveTransport.files['styles.css'].text,
    responsiveProject.files['styles.css'].text,
    'responsive publication must preserve the exact authored media query',
  );
  assert.equal(
    responsivePublication.projectNeedsResponsiveViewportNormalization(responsiveTransport),
    false,
    'the responsive publication repair must be idempotent',
  );

  const preservedViewportExtras = responsivePublication.ensureResponsiveViewportMeta(
    '<!doctype html><html><head><meta name="viewport" content="width=980, viewport-fit=cover"><meta name="viewport" content="width=700"></head><body></body></html>',
  );
  assert.equal((preservedViewportExtras.match(/name="viewport"/g) || []).length, 1);
  assert.match(
    preservedViewportExtras,
    /content="width=device-width, initial-scale=1, viewport-fit=cover"/,
    'conflicting duplicate viewport tags must collapse without losing safe authored directives',
  );

  const draftTransport = projectIo.prepareProjectForDraftTransport(
    responsiveProject,
    '2026-08-30T00:00:00.000Z',
  );
  const persistedMetadata = JSON.parse(draftTransport.files['.incode/project.json'].text);
  assert.deepEqual(
    persistedMetadata.primaryBreakpoint,
    { id: 'base', label: 'Desktop', mode: 'max-width', width: 1440 },
  );
  assert.deepEqual(
    persistedMetadata.breakpoints,
    [{ id: 'mobile', label: 'Phone', mode: 'max-width', width: 390 }],
    'draft persistence must store the exact registry resolved by the canvas',
  );

  const publishPackage = await projectIo.projectToPublishPackage(responsiveProject, {
    fast: true,
    updatedAt: '2026-08-30T00:00:00.000Z',
  });
  const publishZip = await JSZip.loadAsync(await publishPackage.zip.arrayBuffer());
  assert.match(await publishZip.file('index.html').async('string'), /width=device-width/);
  assert.equal(
    await publishZip.file('styles.css').async('string'),
    responsiveProject.files['styles.css'].text,
  );

  const overlayPackage = await projectIo.projectToMaterializedPublishOverlayPackage(
    responsiveProject,
    { fast: true },
  );
  const overlayZip = await JSZip.loadAsync(await overlayPackage.zip.arrayBuffer());
  const overlayManifest = JSON.parse(
    await overlayZip.file('.incode/publish-overlay.json').async('string'),
  );
  assert.deepEqual(
    overlayManifest.upserts.map(file => file.path),
    ['index.html'],
    'a static project must publish the viewport repair as a bounded HTML overlay',
  );
  assert.match(await overlayZip.file('index.html').async('string'), /width=device-width/);
  assert.match(
    editorSource,
    /const requiresResponsiveViewport = projectNeedsResponsiveViewportNormalization\(current\);[\s\S]*?requiresMaterializedPublish[\s\S]*?\|\| requiresResponsiveViewport;/,
    'the publish flow must leave the raw-workspace fast path whenever mobile viewport parity needs repair',
  );

  const legacyResponsiveCss = [
    '.hero { width: 66%; display: flex; }',
    '@media (max-width: 410px) {',
    '  .hero { width: 91%; display: none; }',
    '}',
  ].join('\n');
  const legacyStockProject = {
    name: 'Legacy stock Mobile 410',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 0,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><main class="hero"></main></body></html>',
      },
      'styles.css': {
        path: 'styles.css',
        mimeType: 'text/css',
        text: legacyResponsiveCss,
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          breakpoints: css.LEGACY_STOCK_BREAKPOINTS,
        }),
      },
    },
  };
  const migratedStockProject = projectIo.migrateLegacyStockBreakpointProject(legacyStockProject);
  const migratedStockMetadata = projectIo.readEditorMetadata(migratedStockProject);
  const migratedStockCss = migratedStockProject.files['styles.css'].text;
  assert.equal(
    JSON.parse(legacyStockProject.files['.incode/project.json'].text).breakpointSchemaVersion,
    undefined,
    'migration must not mutate the loaded legacy snapshot',
  );
  assert.equal(legacyStockProject.files['styles.css'].text, legacyResponsiveCss);
  assert.equal(migratedStockMetadata.breakpointSchemaVersion, css.CURRENT_BREAKPOINT_SCHEMA_VERSION);
  assert.deepEqual(
    migratedStockMetadata.breakpoints,
    css.DEFAULT_BREAKPOINTS,
    'stock legacy metadata and its authored CSS must advance in the same project revision',
  );
  assert.match(migratedStockCss, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(migratedStockCss, /@media \(max-width: 410px\)/);
  assert.match(migratedStockCss, /width:\s*91%/);
  assert.match(migratedStockCss, /display:\s*none/);
  const openedStockProject = projectIo.sanitizeProjectPriorities(legacyStockProject);
  assert.equal(openedStockProject.files['styles.css'].text, migratedStockCss);
  assert.deepEqual(
    projectIo.readEditorMetadata(openedStockProject).breakpoints,
    css.DEFAULT_BREAKPOINTS,
    'the normal project-open boundary must apply the stock migration',
  );

  const migratedAgain = projectIo.migrateLegacyStockBreakpointProject(migratedStockProject);
  assert.equal(migratedAgain, migratedStockProject, 'a sealed stock migration must be a reference no-op');
  assert.equal(migratedAgain.files['styles.css'].text, migratedStockCss);
  assert.equal(
    migratedAgain.files['.incode/project.json'].text,
    migratedStockProject.files['.incode/project.json'].text,
    'running the migration again must be byte-idempotent',
  );

  const customResponsiveCss = [
    '.hero { width: 66%; display: flex; }',
    '@media (max-width: 410px) { .hero { width: 77%; display: none; } }',
  ].join('\n');
  const custom410Project = {
    ...legacyStockProject,
    name: 'Custom Mobile 410',
    files: {
      ...legacyStockProject.files,
      'styles.css': {
        ...legacyStockProject.files['styles.css'],
        text: customResponsiveCss,
      },
      '.incode/project.json': {
        ...legacyStockProject.files['.incode/project.json'],
        text: JSON.stringify({
          version: 1,
          breakpoints: [
            { id: 'mobile', label: 'Phone', mode: 'max-width', width: 410 },
          ],
        }),
      },
    },
  };
  const preservedCustomProject = projectIo.migrateLegacyStockBreakpointProject(custom410Project);
  assert.equal(
    preservedCustomProject,
    custom410Project,
    'opening a custom legacy registry must be a reference no-op and cannot manufacture autosave work',
  );
  const preservedCustomMetadata = projectIo.readEditorMetadata(preservedCustomProject);
  assert.deepEqual(
    preservedCustomMetadata.breakpoints,
    [{ id: 'mobile', label: 'Phone', mode: 'max-width', width: 410 }],
  );
  assert.equal(
    preservedCustomProject.files['styles.css'].text,
    customResponsiveCss,
    'a custom 410px tier must never be reinterpreted as stock Mobile',
  );
  assert.equal(preservedCustomMetadata.breakpointSchemaVersion, undefined);
  assert.equal(
    preservedCustomProject.files['.incode/project.json'].text,
    custom410Project.files['.incode/project.json'].text,
    'custom metadata must remain byte-identical until a legitimate edit or transport write',
  );
  const explicitlyEditedCustomProject = projectIo.updateEditorMetadata(
    custom410Project,
    metadata => ({
      ...metadata,
      breakpoints: metadata.breakpoints.map(breakpoint => (
        breakpoint.id === 'mobile'
          ? { ...breakpoint, label: 'Phone custom' }
          : breakpoint
      )),
    }),
  );
  assert.equal(
    projectIo.readEditorMetadata(explicitlyEditedCustomProject).breakpointSchemaVersion,
    css.CURRENT_BREAKPOINT_SCHEMA_VERSION,
    'a real custom breakpoint edit must seal the current schema',
  );
  assert.equal(explicitlyEditedCustomProject.files['styles.css'].text, customResponsiveCss);
  assert.equal(
    projectIo.migrateLegacyStockBreakpointProject(explicitlyEditedCustomProject),
    explicitlyEditedCustomProject,
    'a sealed explicit 410px choice must never enter the stock migration again',
  );

  const futureSchemaProject = projectIo.updateEditorMetadata(custom410Project, metadata => ({
    ...metadata,
    breakpointSchemaVersion: css.CURRENT_BREAKPOINT_SCHEMA_VERSION + 1,
  }));
  assert.equal(
    projectIo.migrateLegacyStockBreakpointProject(futureSchemaProject),
    futureSchemaProject,
    'a current or future schema marker must preserve an intentional 410px registry',
  );

  const metadataLessProject = {
    ...legacyStockProject,
    files: Object.fromEntries(
      Object.entries(legacyStockProject.files).filter(([filePath]) => filePath !== '.incode/project.json'),
    ),
  };
  assert.equal(
    projectIo.migrateLegacyStockBreakpointProject(metadataLessProject),
    metadataLessProject,
    'plain imported HTML/CSS has no evidence that a 410px query was an old Kodety default',
  );
  const identifiedMetadataLessProject = projectIo.ensureProjectIdentity(metadataLessProject);
  const identifiedMetadataLessMetadata = projectIo.readEditorMetadata(identifiedMetadataLessProject);
  assert.equal(
    identifiedMetadataLessMetadata.breakpointSchemaVersion,
    css.CURRENT_BREAKPOINT_SCHEMA_VERSION,
  );
  assert.deepEqual(identifiedMetadataLessMetadata.breakpoints, css.DEFAULT_BREAKPOINTS);
  assert.equal(identifiedMetadataLessProject.files['styles.css'].text, legacyResponsiveCss);
  assert.equal(
    projectIo.migrateLegacyStockBreakpointProject(identifiedMetadataLessProject),
    identifiedMetadataLessProject,
    'identity creation must seal a raw import so reopening cannot reinterpret authored 410px CSS',
  );
  const metadataLessDraftTransport = projectIo.prepareProjectForDraftTransport(
    metadataLessProject,
    '2026-08-30T00:00:00.000Z',
  );
  const metadataLessDraftMetadata = projectIo.readEditorMetadata(metadataLessDraftTransport);
  assert.equal(metadataLessDraftTransport.files['styles.css'].text, legacyResponsiveCss);
  assert.equal(
    metadataLessDraftMetadata.breakpointSchemaVersion,
    css.CURRENT_BREAKPOINT_SCHEMA_VERSION,
  );
  assert.deepEqual(
    metadataLessDraftMetadata.breakpoints,
    css.DEFAULT_BREAKPOINTS,
    'direct transport of a raw import must persist current defaults without rewriting authored CSS',
  );

  const implicitLegacyProject = {
    ...legacyStockProject,
    files: {
      ...legacyStockProject.files,
      '.incode/project.json': {
        ...legacyStockProject.files['.incode/project.json'],
        text: JSON.stringify({ version: 1 }),
      },
    },
  };
  assert.deepEqual(
    projectIo.readEditorMetadata(
      projectIo.migrateLegacyStockBreakpointProject(implicitLegacyProject),
    ).breakpoints,
    css.DEFAULT_BREAKPOINTS,
    'projects that implicitly used the old stock registry must receive the new stock registry',
  );

  const invalidLegacyCss = '@media (max-width: 410px) { .broken { width: 91%; /*';
  const invalidLegacyProject = {
    ...legacyStockProject,
    files: {
      ...legacyStockProject.files,
      'broken.css': {
        path: 'broken.css',
        mimeType: 'text/css',
        text: invalidLegacyCss,
      },
    },
  };
  assert.equal(
    projectIo.migrateLegacyStockBreakpointProject(invalidLegacyProject),
    invalidLegacyProject,
    'a parse failure must abort the whole migration instead of sealing metadata beside stale CSS',
  );
  const invalidLegacyDraft = projectIo.prepareProjectForDraftTransport(
    invalidLegacyProject,
    '2026-08-30T00:00:00.000Z',
  );
  const invalidLegacyDraftMetadata = projectIo.readEditorMetadata(invalidLegacyDraft);
  assert.equal(invalidLegacyDraft.files['broken.css'].text, invalidLegacyCss);
  assert.equal(invalidLegacyDraftMetadata.breakpointSchemaVersion, undefined);
  assert.deepEqual(
    invalidLegacyDraftMetadata.breakpoints,
    css.LEGACY_STOCK_BREAKPOINTS,
    'draft transport cannot normalize a registry whose managed CSS migration failed',
  );
  const invalidLegacyPublishPackage = await projectIo.projectToPublishPackage(
    invalidLegacyProject,
    { fast: true, updatedAt: '2026-08-30T00:00:00.000Z' },
  );
  const invalidLegacyPublishZip = await JSZip.loadAsync(
    await invalidLegacyPublishPackage.zip.arrayBuffer(),
  );
  assert.equal(await invalidLegacyPublishZip.file('broken.css').async('string'), invalidLegacyCss);
  const invalidLegacyPublishMetadata = JSON.parse(
    await invalidLegacyPublishZip.file('.incode/project.json').async('string'),
  );
  assert.equal(invalidLegacyPublishMetadata.breakpointSchemaVersion, undefined);
  assert.deepEqual(invalidLegacyPublishMetadata.breakpoints, css.LEGACY_STOCK_BREAKPOINTS);

  const invalidImplicitLegacyProject = {
    ...invalidLegacyProject,
    files: {
      ...invalidLegacyProject.files,
      '.incode/project.json': {
        ...invalidLegacyProject.files['.incode/project.json'],
        text: JSON.stringify({ version: 1 }),
      },
    },
  };
  const invalidImplicitDraft = projectIo.prepareProjectForDraftTransport(
    invalidImplicitLegacyProject,
    '2026-08-30T00:00:00.000Z',
  );
  const invalidImplicitDraftMetadata = projectIo.readEditorMetadata(invalidImplicitDraft);
  assert.equal(invalidImplicitDraft.files['broken.css'].text, invalidLegacyCss);
  assert.equal(invalidImplicitDraftMetadata.breakpointSchemaVersion, undefined);
  assert.deepEqual(
    invalidImplicitDraftMetadata.breakpoints,
    css.LEGACY_STOCK_BREAKPOINTS,
    'failed implicit migration must materialize legacy 410 metadata so reopening matches the untouched CSS',
  );
  const reopenedInvalidImplicitDraft = projectIo.sanitizeProjectPriorities(invalidImplicitDraft);
  assert.equal(reopenedInvalidImplicitDraft.files['broken.css'].text, invalidLegacyCss);
  assert.equal(
    projectIo.readEditorMetadata(reopenedInvalidImplicitDraft).breakpoints
      .find(breakpoint => breakpoint.id === 'mobile')?.width,
    410,
    'retry-eligible metadata must reopen on Mobile 410 until the CSS can migrate atomically',
  );
  const invalidImplicitPublishPackage = await projectIo.projectToPublishPackage(
    invalidImplicitLegacyProject,
    { fast: true, updatedAt: '2026-08-30T00:00:00.000Z' },
  );
  const invalidImplicitPublishZip = await JSZip.loadAsync(
    await invalidImplicitPublishPackage.zip.arrayBuffer(),
  );
  assert.equal(
    await invalidImplicitPublishZip.file('broken.css').async('string'),
    invalidLegacyCss,
  );
  const invalidImplicitPublishMetadata = JSON.parse(
    await invalidImplicitPublishZip.file('.incode/project.json').async('string'),
  );
  assert.equal(invalidImplicitPublishMetadata.breakpointSchemaVersion, undefined);
  assert.deepEqual(invalidImplicitPublishMetadata.breakpoints, css.LEGACY_STOCK_BREAKPOINTS);

  const mixedLegacyCss = [
    '@media (max-width: 410px) { .canonical { display: none; } }',
    '@media(max-width:410px) { .compact-authored { display: none; } }',
    '@media screen and (max-width: 410px) { .screen-authored { display: none; } }',
    '@media (width <= 410px) { .range-authored { display: none; } }',
    '@container (max-width: 410px) { .container-authored { display: none; } }',
  ].join('\n');
  const mixedLegacyProject = {
    ...legacyStockProject,
    files: {
      ...legacyStockProject.files,
      'styles.css': {
        ...legacyStockProject.files['styles.css'],
        text: mixedLegacyCss,
      },
    },
  };
  const migratedMixedCss = projectIo
    .migrateLegacyStockBreakpointProject(mixedLegacyProject)
    .files['styles.css'].text;
  assert.match(migratedMixedCss, /@media \(max-width: 480px\)/);
  assert.match(migratedMixedCss, /@media\(max-width:410px\)/);
  assert.match(migratedMixedCss, /@media screen and \(max-width: 410px\)/);
  assert.match(migratedMixedCss, /@media \(width <= 410px\)/);
  assert.match(migratedMixedCss, /@container \(max-width: 410px\)/);

  const migratedMobileContext = {
    ...primary,
    selector: '.hero',
    breakpoint: 'mobile',
  };
  for (const [viewportWidth, expectedWidth, expectedDisplay, expectedMobileOwner] of [
    [440, '91%', 'none', true],
    [480, '91%', 'none', true],
    [481, '66%', 'flex', false],
  ]) {
    for (const [property, expectedValue] of [
      ['width', expectedWidth],
      ['display', expectedDisplay],
    ]) {
      const inspection = css.inspectCssRuleAtViewport(
        migratedStockCss,
        migratedMobileContext,
        property,
        viewportWidth,
        migratedStockMetadata.breakpoints,
      );
      assert.equal(inspection.propertyOwner?.value, expectedValue);
      assert.equal(inspection.propertyOwnerBelongsToBreakpoint, expectedMobileOwner);
    }
  }

  const codeComponentBreakpoints = codeComponents.toCodeComponentBreakpoints(
    css.DEFAULT_PRIMARY_BREAKPOINT,
    migratedStockMetadata.breakpoints,
  );
  assert.deepEqual(
    codeComponentBreakpoints.find(breakpoint => breakpoint.id === 'mobile'),
    { id: 'mobile', width: 480, mode: 'max-width', parentId: 'tablet' },
  );
  const responsiveInstance = {
    schemaVersion: '1.0.0',
    id: 'responsive-instance',
    componentId: 'responsive.test',
    componentVersion: '1.0.0',
    props: {},
    responsiveProps: {},
    bindings: {},
    slots: {},
    sizing: { widthMode: 'fill', heightMode: 'hug' },
    metadata: {},
  };
  const codeComponentRuntime = codeComponents.compileCodeComponentRuntime(
    '<!doctype html><body><div data-coday-code-instance="responsive-instance"></div></body>',
    {
      schemaVersion: '1.0.0',
      components: [{
        id: 'responsive.test',
        version: '1.0.0',
        schemaVersion: '1.0.0',
        bundle: 'export function mountCodayComponent() {}',
        manifest: {
          schemaVersion: '1.0.0',
          id: 'responsive.test',
          name: 'ResponsiveTest',
          displayName: 'Responsive Test',
          version: '1.0.0',
          exportName: 'ResponsiveTest',
          controls: {},
          defaultProps: {},
          sizing: { width: 'fill', height: 'hug' },
          dependencies: [],
          capabilities: [],
        },
        publishedAt: '2026-08-30T00:00:00.000Z',
        author: 'test',
        dependencies: [],
      }],
      instances: [responsiveInstance],
    },
    '',
    codeComponentBreakpoints,
  );
  const runtimeStatement = pattern => {
    const match = codeComponentRuntime.match(pattern);
    assert.ok(match, `missing Code Component runtime statement: ${pattern}`);
    return match[0];
  };
  const runtimeBreakpointResolver = new Function(
    'document',
    'innerWidth',
    [
      runtimeStatement(/const config=.*?;\n/),
      runtimeStatement(/const breakpointById=.*?;\n/),
      runtimeStatement(/const baseBreakpoint=.*?;\n/),
      runtimeStatement(/const activeBreakpoint=.*?;\n/),
      'return activeBreakpoint();',
    ].join(''),
  );
  const runtimeDocument = { documentElement: { dataset: {} } };
  assert.equal(runtimeBreakpointResolver(runtimeDocument, 440), 'mobile');
  assert.equal(runtimeBreakpointResolver(runtimeDocument, 480), 'mobile');
  assert.equal(runtimeBreakpointResolver(runtimeDocument, 481), 'tablet');

  const migratedDraftTransport = projectIo.prepareProjectForDraftTransport(
    migratedStockProject,
    '2026-08-30T00:00:00.000Z',
  );
  assert.equal(migratedDraftTransport.files['styles.css'].text, migratedStockCss);
  assert.equal(
    projectIo.readEditorMetadata(migratedDraftTransport).breakpoints
      .find(breakpoint => breakpoint.id === 'mobile')?.width,
    480,
  );
  const migratedPublishPackage = await projectIo.projectToPublishPackage(migratedStockProject, {
    fast: true,
    updatedAt: '2026-08-30T00:00:00.000Z',
  });
  const migratedPublishZip = await JSZip.loadAsync(
    await migratedPublishPackage.zip.arrayBuffer(),
  );
  assert.equal(await migratedPublishZip.file('styles.css').async('string'), migratedStockCss);
  const migratedPublishMetadata = JSON.parse(
    await migratedPublishZip.file('.incode/project.json').async('string'),
  );
  assert.equal(
    migratedPublishMetadata.breakpoints.find(breakpoint => breakpoint.id === 'mobile')?.width,
    480,
    'draft and publish transport must retain the migrated breakpoint and its width/display CSS',
  );

  console.log('Responsive breakpoint regression tests passed');
} finally {
  await server.close();
}
