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
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const [localizedCss, cssPatcher, editCoalescing] = await Promise.all([
    server.ssrLoadModule('/lib/html-editor/localized-css.ts'),
    server.ssrLoadModule('/lib/html-editor/css-patcher.ts'),
    server.ssrLoadModule('/lib/html-editor/edit-coalescing.ts'),
  ]);
  const projectEditorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );

  const stylesheetPath = localizedCss.localizedPageStylesheetPath('pages/about.html', 'en-US');
  assert.match(stylesheetPath, /^pages\/kodety-l10n-en-us-[a-z0-9]+\.css$/);
  assert.equal(localizedCss.localizedPageStylesheetPath('pages/about.html', 'en-US'), stylesheetPath);
  assert.equal(localizedCss.localizedPageStylesheetPath('pages/about.html', 'en-us'), stylesheetPath);
  assert.equal(localizedCss.localizedStylesheetHref('pages/about.html', stylesheetPath), path.basename(stylesheetPath));
  assert.equal(localizedCss.normalizeLocalizedStylesheetPath('../private.css'), '');
  assert.equal(localizedCss.normalizeLocalizedStylesheetPath('.incode/private.css'), '');
  assert.equal(localizedCss.normalizeLocalizedStylesheetPath('styles/<unsafe>.css'), '');

  const headingKey = 'id:heading';
  const cardKey = 'id:card';
  const headingSelector = localizedCss.localizedElementStyleSelector(headingKey);
  const cardSelector = localizedCss.localizedElementStyleSelector(cardKey);
  assert.match(headingSelector, /data-kodety-l10n-id="heading"/);
  assert.match(headingSelector, /#__kodety_l10n_specificity_a/);

  let css = localizedCss.createLocalizedPageStylesheetSource();
  css = cssPatcher.patchCssDeclaration(css, {
    target: 'rule',
    selector: headingSelector,
    cssFilePath: stylesheetPath,
    pseudo: 'base',
    breakpoint: 'base',
  }, 'width', '320px', cssPatcher.DEFAULT_BREAKPOINTS, { authoritative: true });
  css = cssPatcher.patchCssDeclaration(css, {
    target: 'rule',
    selector: headingSelector,
    cssFilePath: stylesheetPath,
    pseudo: 'hover',
    breakpoint: 'mobile',
  }, 'width', '100%', cssPatcher.DEFAULT_BREAKPOINTS, { authoritative: true });
  css = cssPatcher.patchCssDeclaration(css, {
    target: 'rule',
    selector: cardSelector,
    cssFilePath: stylesheetPath,
    pseudo: 'base',
    breakpoint: 'base',
  }, 'opacity', '0.8 !important', cssPatcher.DEFAULT_BREAKPOINTS, {
    authoritative: true,
    localizedPriority: true,
  });

  assert.match(css, /width:\s*320px/);
  assert.match(css, /:hover/);
  assert.match(css, /@media/);
  assert.match(css, /opacity:\s*0\.8\s*!important/);
  assert.equal(localizedCss.localizedStylesheetHasRules(css), true);
  assert.equal(localizedCss.localizedStylesheetHasElementRules(css, headingKey), true);
  assert.equal(localizedCss.localizedStylesheetHasElementRules(css, cardKey), true);
  assert.equal(
    localizedCss.localizedStylesheetHasElementRules(css, 'id:missing'),
    false,
    'Reset must stay disabled when only another translated element owns localized CSS',
  );

  const resetHeading = localizedCss.removeLocalizedElementStyleRules(css, headingKey);
  assert.doesNotMatch(resetHeading, /data-kodety-l10n-id="heading"/);
  assert.equal(localizedCss.localizedStylesheetHasElementRules(resetHeading, headingKey), false);
  assert.match(resetHeading, /data-kodety-l10n-id="card"/);
  assert.equal(localizedCss.localizedStylesheetHasRules(resetHeading), true);
  const resetAll = localizedCss.removeLocalizedElementStyleRules(resetHeading, cardKey);
  assert.equal(localizedCss.localizedStylesheetHasRules(resetAll), false);
  assert.match(resetAll, /Kodety localized page styles/);

  const localizedMultiSelectionPreview = editCoalescing.updateCanvasStylePreviewDraft(
    null,
    ['0/2', '0/1'],
    'width',
    '320px',
    '',
  );
  assert.deepEqual(
    localizedMultiSelectionPreview,
    {
      targetKey: '0/1\u00000/2',
      paths: ['0/1', '0/2'],
      declarations: { width: '320px' },
    },
    'localized multi-selection previews must retain their selected paths instead of acquiring a shared class selector',
  );
  const serializedLocalizedMultiSelectionPreview = editCoalescing.serializeCanvasStylePreview(
    localizedMultiSelectionPreview,
  );
  assert.match(serializedLocalizedMultiSelectionPreview, /data-html-editor-path="0\/1"/);
  assert.match(serializedLocalizedMultiSelectionPreview, /data-html-editor-path="0\/2"/);
  assert.doesNotMatch(
    serializedLocalizedMultiSelectionPreview,
    /\.shared-card/,
    'a localized transient paint must remain bounded to the selected translated elements',
  );

  const localizedBranchStart = projectEditorSource.indexOf(
    "resolvedActiveLocale !== localization.sourceLocale\n      && (membershipPreviewLayer === 'base' || activeTimelineKeyframe)",
  );
  const globalCssBranchStart = projectEditorSource.indexOf('    const currentPosition = (', localizedBranchStart);
  assert.ok(localizedBranchStart >= 0 && globalCssBranchStart > localizedBranchStart);
  const localizedBranch = projectEditorSource.slice(localizedBranchStart, globalCssBranchStart);
  assert.match(localizedBranch, /localizedPageStylesheetPath[\s\S]*?patchCssDeclaration[\s\S]*?cssPath: stylesheetPath/);
  assert.match(
    localizedBranch,
    /directStylesheetPath && directStylesheetPath !== stylesheetPath[\s\S]*?LOCALIZED_PAGE_STYLESHEET_HEADER/,
    'locale authoring must never trust metadata that points at a base/user stylesheet',
  );
  assert.match(
    localizedBranch,
    /const preservePriority = Boolean\(value\)[\s\S]*?localizedPriority: preservePriority/,
    'every authored locale value must remain authoritative even when the source selector is complex or important',
  );
  assert.doesNotMatch(
    localizedBranch,
    /resolveCssAuthoringOrigin|authoringRootCssPaths/,
    'localized scrubs must return before the global source-CSS resolver',
  );
  const localizedLiveStylesheetStart = localizedBranch.indexOf('const liveStylesheet = resolvePreviewStylesheet');
  const localizedLiveStylesheetEnd = localizedBranch.indexOf('finishVisualEdit();', localizedLiveStylesheetStart);
  assert.ok(
    localizedLiveStylesheetStart >= 0 && localizedLiveStylesheetEnd > localizedLiveStylesheetStart,
    'localized CSS commits must expose a bounded live-stylesheet bridge block',
  );
  const localizedLiveStylesheetBridge = localizedBranch.slice(
    localizedLiveStylesheetStart,
    localizedLiveStylesheetEnd,
  );
  assert.match(
    localizedBranch,
    /CANVAS_MOTION_AUTHORITY_PROPERTIES\.has\((?:normalizedProperty|name\.trim\(\)\.toLowerCase\(\))\)[\s\S]*?localizedTargets\.map/,
    'localized motion-authority properties must create one ownership patch per translated target',
  );
  assert.match(
    localizedBranch,
    /scope:\s*'selector'[\s\S]*?target:\s*target\.selector/,
    'localized motion ownership must follow its persisted selector so CSS-only Undo/Redo can replay it',
  );
  assert.match(
    localizedBranch,
    /readCss(?:Authoring|Rule)Declarations\([\s\S]*?const effectiveValue[\s\S]*?owned:\s*Boolean\(stripImportantPriority\(effectiveValue\)/,
    'localized motion ownership must reflect the effective declaration after the stylesheet patch',
  );
  assert.doesNotMatch(
    localizedBranch,
    /owned:\s*Boolean\(value\)/,
    'localized motion ownership must not ignore a declaration that still wins through a fallback rule',
  );
  assert.match(
    localizedLiveStylesheetBridge,
    /enqueueCanvasLiveStyle\(\{[\s\S]*?ownerships\s*:/,
    'localized CSS commits must send ownership patches so motion cannot overwrite the live translated edit',
  );
  const localeCommitStart = projectEditorSource.indexOf('  const commitLocaleElementOverride = useCallback');
  const localeCommitEnd = projectEditorSource.indexOf('  const commitLocaleInsertionSourceMutation', localeCommitStart);
  const localeCommit = projectEditorSource.slice(localeCommitStart, localeCommitEnd);
  assert.match(localeCommit, /const liveDom = refreshCanvas\s*\?/);
  assert.doesNotMatch(
    localeCommit.slice(localeCommit.indexOf('const liveDom = refreshCanvas'), localeCommit.indexOf('commitProject(')),
    /const nextRenderedSource\s*=|const liveDom\s*=\s*diffCanvasLiveDom/,
    'refreshCanvas=false must not eagerly build and diff a second localized document',
  );

  const previewCanvasStyleStart = projectEditorSource.indexOf('  const previewCanvasStyle = useCallback');
  const previewCanvasStyleEnd = projectEditorSource.indexOf(
    '  useLayoutEffect(() => {\n    previewCanvasStyleRef.current = previewCanvasStyle;',
    previewCanvasStyleStart,
  );
  assert.ok(
    previewCanvasStyleStart >= 0 && previewCanvasStyleEnd > previewCanvasStyleStart,
    'the realtime visual preview callback must remain discoverable as one bounded source block',
  );
  const previewCanvasStyleSource = projectEditorSource.slice(previewCanvasStyleStart, previewCanvasStyleEnd);
  assert.match(
    previewCanvasStyleSource,
    /editingLocalizedPage[\s\S]{0,240}?\?\s*''\s*:/,
    'localized previews must deliberately suppress the source class selector and paint the selected paths only',
  );
  assert.match(
    previewCanvasStyleSource,
    /updateCanvasStylePreviewDraft\([\s\S]*?paths,[\s\S]*?property,[\s\S]*?value/,
    'localized path-scoped previews must still use the coalesced canvas preview pipeline',
  );

  const localeSelectionStart = projectEditorSource.indexOf('  const localeSelectionKey = useMemo');
  const localeSelectionEnd = projectEditorSource.indexOf('  const pageMembershipGateRoots = useMemo', localeSelectionStart);
  assert.ok(
    localeSelectionStart >= 0 && localeSelectionEnd > localeSelectionStart,
    'localized selection ownership must remain grouped with the locale editing context',
  );
  const localeSelectionSource = projectEditorSource.slice(localeSelectionStart, localeSelectionEnd);
  assert.match(
    localeSelectionSource,
    /localizedElementStyleSelector\(localeSelectionKey\)/,
    'Reset availability must resolve the selected element selector used by the localized stylesheet',
  );
  const directStyleRuleStart = localeSelectionSource.indexOf('  const directLocalizedStylesheetPath =');
  const directStyleRuleEnd = localeSelectionSource.indexOf('  const localeEditingContext =', directStyleRuleStart);
  assert.ok(
    directStyleRuleStart >= 0 && directStyleRuleEnd > directStyleRuleStart,
    'direct localized Reset ownership must remain a bounded selection-level source block',
  );
  const directStyleRuleSource = localeSelectionSource.slice(directStyleRuleStart, directStyleRuleEnd);
  assert.match(
    directStyleRuleSource,
    /directLocalizedStylesheetSource[\s\S]*?localizedStylesheetHasElementRules\(/,
    'Reset availability must inspect the selected element rule in the direct localized stylesheet',
  );
  assert.doesNotMatch(
    directStyleRuleSource,
    /resolveLocalizationStylesheets\(/,
    'an inherited fallback rule must not masquerade as a direct Resettable override in the active locale',
  );
  assert.match(
    localeSelectionSource,
    /hasDirectOverride:\s*Boolean\([\s\S]{0,240}?localeSelectionHasDirectStyleRule/,
    'a CSS-only localized rule must enable the Inspector Reset action',
  );

  assert.match(
    projectEditorSource,
    /resolveLocalizationStylesheets\(/,
    'localized Inspector reads must resolve the locale fallback stylesheet chain',
  );
  const cssRuleStylesStart = projectEditorSource.indexOf('  const effectiveCssContext = useMemo');
  const pseudoPreviewStart = projectEditorSource.indexOf('  const selectedPathsSignature =', cssRuleStylesStart);
  assert.ok(
    cssRuleStylesStart >= 0 && pseudoPreviewStart > cssRuleStylesStart,
    'localized CSS reads must be defined before the Inspector and pseudo preview consume them',
  );
  const localizedInspectorReadSource = projectEditorSource.slice(cssRuleStylesStart, pseudoPreviewStart);
  assert.match(
    localizedInspectorReadSource,
    /selector:\s*localizedSelectionStyleSelector/,
    'localized Inspector reads must address the stable translated element selector',
  );
  assert.match(
    localizedInspectorReadSource,
    /localizedStylesheetPaths[\s\S]*?readCss(?:Authoring|Rule)Declarations/,
    'localized Inspector reads must load declarations from locale stylesheets in fallback order',
  );
  assert.match(
    localizedInspectorReadSource,
    /const cssRuleStyles = useMemo[\s\S]*?localized/i,
    'the Inspector rule-style map must include localized declarations',
  );
  assert.match(
    localizedInspectorReadSource,
    /const baseBreakpointRuleStyles = useMemo[\s\S]*?localized/i,
    'responsive Inspector inheritance must include localized declarations from wider breakpoints',
  );
  const pseudoPreviewEnd = projectEditorSource.indexOf('  const postAgentActivityToFrame =', pseudoPreviewStart);
  assert.ok(
    pseudoPreviewStart >= 0 && pseudoPreviewEnd > pseudoPreviewStart,
    'the forced pseudo-state projection must remain discoverable as one bounded source block',
  );
  const pseudoPreviewSource = projectEditorSource.slice(pseudoPreviewStart, pseudoPreviewEnd);
  assert.match(
    pseudoPreviewSource,
    /declarations:\s*\{[\s\S]*?\.\.\.baseBreakpointRuleStyles,[\s\S]*?\.\.\.cssRuleStyles/,
    'forced hover/focus previews must consume the same localized Inspector style maps',
  );
  const copyCurrentStylesStart = projectEditorSource.indexOf('  const copyCurrentStyles = () =>');
  const copyCurrentStylesEnd = projectEditorSource.indexOf('  const copyStyleProperty =', copyCurrentStylesStart);
  const copyCurrentStylesSource = projectEditorSource.slice(copyCurrentStylesStart, copyCurrentStylesEnd);
  assert.match(
    copyCurrentStylesSource,
    /winningSelectionAuthoredStyles\(\)[\s\S]*?\.\.\.(?:localized|cssRuleStyles)/i,
    'Copy styles must apply localized declarations after browser-reported base stylesheet origins',
  );
  const copyStylesForPathStart = projectEditorSource.indexOf('  const copyStylesForPath = (path: string) =>');
  const copyStylesForPathEnd = projectEditorSource.indexOf(
    '  const commitStyleClipboardBatch =',
    copyStylesForPathStart,
  );
  assert.ok(
    copyStylesForPathStart >= 0 && copyStylesForPathEnd > copyStylesForPathStart,
    'context-menu style copy must remain discoverable as one bounded source block',
  );
  const copyStylesForPathSource = projectEditorSource.slice(copyStylesForPathStart, copyStylesForPathEnd);
  assert.match(
    copyStylesForPathSource,
    /localeElementKeyForPath\(localizedSource, path\)[\s\S]*?localizedElementStyleSelector\(localizedKey\)/,
    'copying an unselected translated layer must resolve its own stable localized selector',
  );
  assert.match(
    copyStylesForPathSource,
    /readCssAuthoringDeclarations\([\s\S]*?localizedStylesheetPaths[\s\S]*?\.\.\.localizedRuleStylesForPath/,
    'context-menu style copy must load and apply the target layer locale overlay last',
  );

  console.log('Localized page CSS contracts passed.');
} finally {
  await server.close();
}
