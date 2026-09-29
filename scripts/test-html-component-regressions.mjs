import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = relativePath => readFile(path.join(root, relativePath), 'utf8');
const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

const [
  componentRuntime,
  componentPanel,
  inspector,
  projectEditor,
  canvasStage,
  bufferedIframe,
  preview,
  projectIo,
  projectFonts,
  sharingRuntime,
  componentInteractions,
  interactionsRuntime,
  sourcePatcher,
  layersTree,
  componentBundle,
  insertMenu,
] = await Promise.all([
  read('lib/html-editor/html-components.ts'),
  read('app/(builder)/kodety/html-editor/components/HtmlComponentSystem.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx'),
  read('lib/html-editor/preview.ts'),
  read('lib/html-editor/project-io.ts'),
  read('lib/html-editor/project-fonts.ts'),
  read('Wordpress/kodety/includes/class-kodety-sharing.php'),
  read('app/(builder)/kodety/html-editor/components/HtmlComponentInteractions.tsx'),
  read('lib/html-editor/interactions.ts'),
  read('lib/html-editor/source-patcher.ts'),
  read('app/(builder)/kodety/html-editor/components/HtmlLayersTree.tsx'),
  read('lib/html-editor/component-bundle.ts'),
  read('app/(builder)/kodety/html-editor/components/HtmlInsertMenu.tsx'),
]);
const genericInteractionsPanel = await read(
  'app/(builder)/kodety/html-editor/components/HtmlInteractionsPanel.tsx',
);

const applyVariable = section(
  componentRuntime,
  'function applyVariable(',
  '/** Materialize a component',
);
assert.match(applyVariable, /const bindings = htmlComponentVariableBindings\(variable\)/);
assert.match(applyVariable, /variable\.type === 'variant' && !bindings\.length/);
assert.match(applyVariable, /binding\.attribute \|\| HTML_COMPONENT_VARIANT_ATTRIBUTE/);
assert.match(applyVariable, /target\.hasAttribute\('data-kodety-component-id'\)/);
assert.match(applyVariable, /bindings\.forEach/);
assert.match(applyVariable, /nodes\.get\(binding\.targetNodeId\)/);
assert.match(applyVariable, /target\.textContent = value/);

const refreshInstances = section(
  componentRuntime,
  'export function refreshHtmlComponentInstancesInSource(',
  'export function detachHtmlComponentInstance(',
);
assert.match(refreshInstances, /const runtime = preparedRuntime \|\| runtimeHtmlComponentLibrary/);
assert.equal(
  (refreshInstances.match(/runtimeHtmlComponentLibrary\(/g) || []).length,
  1,
  'a page refresh must prepare the component runtime once',
);
assert.match(refreshInstances, /renderHtmlComponentInstanceFromRuntime\(/);
assert.match(refreshInstances, /inspectSourceElements\(source\)/);
assert.match(refreshInstances, /patchReplaceLocatedElementsOuterHtml\(source, replacements\)/);
assert.match(refreshInstances, /claimedInstanceIds\.has\(instanceId\)/);
assert.match(refreshInstances, /instanceIdByPath\.get\(node\.path\)/);
assert.match(componentRuntime, /export function htmlComponentLiveReplacements\(/);
assert.match(componentRuntime, /projected === afterSource \? replacements : null/);

const renderRuntime = section(
  componentRuntime,
  'function renderRuntimeComponent(',
  '/**\n * Render an instance from an already prepared runtime library.',
);
assert.match(renderRuntime, /compiledRuntimeCache\.get\(runtime\)/);
assert.match(renderRuntime, /variantRoots\.get\(variant\.id\)\?\.cloneNode\(true\)/);
assert.match(renderRuntime, /parentElement\?\.closest\('\[data-kodety-component-id\]'\) === root/);
assert.match(renderRuntime, /data-kodety-component-state-variant/);

const instancePanel = section(
  componentPanel,
  'export function HtmlComponentInstancePanel(',
  'export function HtmlComponentVariablesDialog(',
);
assert.match(instancePanel, /onOverridesPreview\?\.\(overridesFromValues\(nextValues\)\)/);
assert.match(instancePanel, /data-component-property=\{variable\.type\}/);
assert.match(instancePanel, /HtmlComponentVariableLabel[\s\S]*?label="Variant"/);
assert.match(instancePanel, /createVariantVariable/);
assert.match(instancePanel, /htmlComponentVariableHasVariantBinding/);
assert.match(instancePanel, /HTML_COMPONENT_VARIANT_ATTRIBUTE/);
assert.match(instancePanel, /variantOptionsForVariable\?\.\(variable\) \|\| component\.variants/);
assert.match(instancePanel, /font-normal text-white\/38">Modified/);
assert.doesNotMatch(instancePanel, />Overridden</);

const componentCard = section(
  componentPanel,
  'export const HtmlComponentCard = memo(function HtmlComponentCard(',
  'export function HtmlCreateComponentDialog(',
);
assert.match(
  componentCard,
  /SolarWidgetIcon[\s\S]*?group-hover:text-\[var\(--kodety-accent-hover\)\]/,
  'reusable component cards must use the same gray-to-violet Solar icon treatment',
);
assert.match(
  componentCard,
  /hover:border-\[var\(--kodety-accent-hover\)\]\/70/,
  'reusable component cards must use the violet hover border',
);
assert.doesNotMatch(
  componentCard,
  /hover:-?translate-y/,
  'reusable component cards must remain spatially stable on hover',
);
assert.equal(
  (componentPanel.match(/type="file"/g) || []).length,
  1,
  'component media must expose one upload input instead of duplicate source controls',
);
assert.match(componentPanel, /onUploadAsset\(file, variable\)/);
assert.match(componentPanel, /mediaType === 'image'[\s\S]*?<img src=\{previewUrl\}/);

const componentVariablesDialog = section(
  componentPanel,
  'export function HtmlComponentVariablesDialog(',
  'export function HtmlComponentVariantsSection(',
);
assert.match(componentPanel, /DndContext[\s\S]*?PointerSensor[\s\S]*?useDraggable[\s\S]*?useDroppable/);
assert.match(componentVariablesDialog, /width="min\(1120px, calc\(100vw - 24px\)\)"/);
assert.match(componentVariablesDialog, /w-\[1120px\]/);
assert.match(componentVariablesDialog, /h-\[640px\] max-h-\[calc\(100dvh-144px\)\]/);
assert.match(componentVariablesDialog, /grid-cols-\[132px_minmax\(0,1fr\)\]/);
assert.match(componentVariablesDialog, /className="size-7 rounded-md"/);
assert.match(componentVariablesDialog, /type === 'variant' && variantPropertyTarget/);
assert.match(componentVariablesDialog, /variantPropertyTarget\?\.variantId/);
assert.match(componentVariablesDialog, /items-center justify-start gap-1 text-left/);
assert.match(componentPanel, /dropEdge === 'before' \? '-top-px' : '-bottom-px'/);
assert.match(componentVariablesDialog, /<DragOverlay dropAnimation=\{null\}>[\s\S]*?draggingVariable/);
assert.doesNotMatch(componentVariablesDialog, /\sdraggable(?:=|\s)/);

const componentVariantsSection = section(
  componentPanel,
  'export function HtmlComponentVariantsSection(',
  undefined,
);
assert.match(componentVariantsSection, /<DndContext/);
assert.match(componentVariantsSection, /<DragOverlay dropAnimation=\{null\}>[\s\S]*?draggingVariant/);
assert.doesNotMatch(componentVariantsSection, /\sdraggable(?:=|\s)/);

assert.match(inspector, /htmlComponentInstanceSelected = false/);
assert.match(inspector, /\{!htmlComponentInstanceSelected && \(/);

assert.match(instancePanel, /<Sparkles \/> Interações/);
assert.match(instancePanel, /onOpenInteractions/);
assert.match(componentPanel, /<Sparkles \/> Interações/);
assert.match(componentInteractions, /data-component-variant-event-editor/);
assert.match(componentInteractions, /createInteractionAction\('component-variant'\)/);
assert.match(componentInteractions, /eventRootPath \|\| instance\?\.rootPath \|\| selection\.path/);
assert.match(componentInteractions, /duplicateCount !== 1/);
assert.match(componentInteractions, /patchElementAttribute\([\s\S]*?'data-kodety-component-instance'/);
assert.match(componentInteractions, /<HtmlInteractionsPanel/);
assert.match(
  componentInteractions,
  /'click'[\s\S]*?'click-start'[\s\S]*?'appear'[\s\S]*?'mouse-enter'[\s\S]*?'mouse-leave'/,
  'component events must expose the five Ycode-style triggers',
);
assert.match(componentInteractions, /data-component-event-delay/);
assert.match(componentInteractions, /Diminuir delay em 0,1 segundo/);
assert.match(componentInteractions, /Aumentar delay em 0,1 segundo/);
assert.match(
  componentInteractions,
  /start: normalizedDelay\(delaySeconds\)/,
  'component event delay must persist in action.start seconds',
);
assert.match(
  componentInteractions,
  /clickAction: trigger === 'click' \? 'restart'/,
  'quick Click must be a one-way event instead of the legacy toggle behavior',
);
assert.match(
  interactionsRuntime,
  /'click', 'click-start', 'appear', 'mouse-enter', 'mouse-leave'/,
  'new triggers must be part of canonical normalization',
);
assert.match(
  genericInteractionsPanel,
  /value: 'click-start'[\s\S]*?value: 'appear'[\s\S]*?value: 'mouse-enter'[\s\S]*?value: 'mouse-leave'/,
  'generic interaction editing must retain labels and select options for component event triggers',
);
assert.match(projectEditor, /import \{ HtmlComponentInteractions \} from '\.\/HtmlComponentInteractions'/);
assert.match(projectEditor, /componentInteractions=\{[\s\S]*?<HtmlComponentInteractions/);
assert.match(projectEditor, /onOpenInteractions=\{\(\) => \{[\s\S]*?requestTab\('interactions'\)/);
assert.match(projectEditor, /selectPath\('0'\);[\s\S]*?requestTab\('interactions'\)/);
assert.match(inspector, /componentInteractions \|\| \(/);

const ensureInteractionSelector = section(
  interactionsRuntime,
  'export function ensureInteractionSelector(',
  'export function addInteraction(',
);
assert.match(ensureInteractionSelector, /data-kodety-component-instance/);
assert.match(ensureInteractionSelector, /body > :first-child/);
assert.match(ensureInteractionSelector, /data-kodety-component-editor/);
assert.match(ensureInteractionSelector, /authoredAttributeValueCount\([\s\S]*?componentInstanceId[\s\S]*?\) === 1/);
assert.match(ensureInteractionSelector, /quotedAttributeSelector\([\s\S]*?'data-kodety-component-instance'/);

const switchComponentVariant = section(
  interactionsRuntime,
  'const switchComponentVariant = (element, action, reversing) => {',
  'const perform = (action, elements, reversing) => {',
);
assert.match(switchComponentVariant, /action\.componentId && action\.componentId !== componentId/);
assert.match(switchComponentVariant, /const variant = component\.variants\?\.find\?\.\(item => item\.id === requestedVariantId\)/);
assert.doesNotMatch(switchComponentVariant, /\|\| component\.variants\?\.\[0\]/);
assert.match(switchComponentVariant, /__kodetyComponentVariantSnapshots/);
assert.match(switchComponentVariant, /controllingInteractionId/);
assert.match(switchComponentVariant, /root\.innerHTML = replacement\.innerHTML/);
assert.doesNotMatch(switchComponentVariant, /root\.replaceWith\(/);
assert.match(interactionsRuntime, /animateComponentVariantMutation/);
assert.match(interactionsRuntime, /document\.startViewTransition/);
assert.match(interactionsRuntime, /prefers-reduced-motion: reduce/);
assert.match(switchComponentVariant, /data-kodety-component-state-variant/);

const componentVariantTimeline = section(
  interactionsRuntime,
  'const perform = (action, elements, reversing) => {',
  'const run = (timeline, action) => {',
);
assert.match(componentVariantTimeline, /switchComponentVariant\(element, action, reversing\)/);
assert.match(componentVariantTimeline, /action\.kind === 'component-variant'[\s\S]*?start \+ Math\.max\(\.001, actionDuration\)/);

const duplicatedMarkup = section(
  sourcePatcher,
  'export function prepareDuplicatedMarkup(',
  'export function patchDuplicateElement(',
);
assert.match(duplicatedMarkup, /data-kodety-component-instance/);
assert.match(duplicatedMarkup, /uniqueDuplicateId\(value, reservedComponentInstanceIds\)/);
assert.doesNotMatch(duplicatedMarkup, /componentInstanceIdMap/);

const pruneTargets = section(
  interactionsRuntime,
  'export function pruneInteractionTargets(',
  'function cssEscapeEnd(',
);
assert.match(pruneTargets, /componentInstanceIds: Iterable<string>/);
assert.match(pruneTargets, /'data-kodety-component-instance'/);
assert.match(projectEditor, /removedComponentInstanceIds[\s\S]*?pruneInteractionTargets\([\s\S]*?removedComponentInstanceIds/);
assert.match(layersTree, /data-kodety-component-instance/);

const variantCommit = section(
  projectEditor,
  'const changeSelectedHtmlComponentVariant =',
  'const changeSelectedHtmlComponentOverrides =',
);
assert.match(variantCommit, /commitLiveStructure\(/);
assert.match(variantCommit, /operation: 'replace'/);
assert.doesNotMatch(variantCommit, /applyLivePatch\(/);

const overrideCommit = section(
  projectEditor,
  'const changeSelectedHtmlComponentOverrides =',
  'const previewSelectedHtmlComponentOverrides =',
);
assert.match(overrideCommit, /applyLivePatch\(/);
assert.doesNotMatch(overrideCommit, /changeSource\(/);

const overridePreview = section(
  projectEditor,
  'const previewSelectedHtmlComponentOverrides =',
  'const detachHtmlComponentAtPath =',
);
assert.match(overridePreview, /diffCanvasLiveDom\(/);
assert.match(overridePreview, /canApplyCanvasLiveDomDelta\(/);
assert.match(overridePreview, /enqueueCanvasLiveStyle\(/);
assert.doesNotMatch(overridePreview, /commitProject\(/);

const componentEditorOpen = section(
  projectEditor,
  'const openHtmlComponentEditor =',
  'const editHtmlComponentAtPath =',
);
assert.match(
  componentEditorOpen,
  /useHtmlEditorChromeStore\.getState\(\)\.closeNavigatorOverlays\(\)/,
  'opening a component must dismiss temporary Navigator overlays',
);
assert.match(
  componentEditorOpen,
  /useHtmlNavigatorStore\.getState\(\)\.setActivePanel\('layers'\)/,
  'every component entry point must reveal Layers without locking later navigation',
);

const variableUpdate = section(
  projectEditor,
  'const updateHtmlComponentVariables =',
  'const changeSelectedHtmlComponentVariant =',
);
assert.match(variableUpdate, /refreshProjectHtmlComponentPage\(/);
assert.doesNotMatch(variableUpdate, /refreshProjectHtmlComponentInstances\(/);
assert.match(variableUpdate, /commitPreparedProjectWithLiveDom\(next\)/);

const componentExit = section(
  projectEditor,
  'const primeComponentReturnCanvas =',
  'const selectHtmlComponentVariantEditor =',
);
assert.match(componentExit, /returnSurfacePreviewBootstrapRef\.current =/);
assert.match(componentExit, /window\.requestAnimationFrame\([\s\S]*?forceCanonicalCanvasRefresh/);
assert.match(componentExit, /baselineSignature === htmlComponentEditSignature/);
assert.match(componentExit, /!componentEditPersistenceDeferredRef\.current/);
assert.match(componentExit, /commitProject\(navigationProject, false, true, false, false\)/);
assert.match(componentExit, /queueHtmlComponentFinalization\([\s\S]*?activeComponent\.id,[\s\S]*?activeVariant\.id,[\s\S]*?returnPath,[\s\S]*?variantSources/);
assert.match(componentExit, /await yieldToComponentFinalization\(\)/);
assert.match(componentExit, /reconcileHtmlComponentVariantSession\(/);
assert.match(componentExit, /await yieldToReturnedPagePaint\(\)/);
assert.match(componentExit, /commitPreparedProjectWithLiveComponentInstances\(quickNext, false\)/);
assert.match(componentExit, /commitPreparedProjectWithLiveComponentInstances\(next\)/);
assert.doesNotMatch(componentExit, /forceCanonicalCanvasRefresh\(\);\n    toast\.success\('Component updated'\)/);
assert.match(preview, /const applyLiveElementReplaceMany = message =>/);
assert.match(preview, /event\.data\.operation === 'replace-many'/);
assert.match(projectEditor, /onResetComponentVariantLayerOverrides:[\s\S]*?resetHtmlComponentVariantLayerOverrides/);
assert.match(layersTree, /Resetar overrides da layer/);
assert.match(projectEditor, /scopeCssContextToHtmlComponentVariant/);
assert.match(projectEditor, /data-kodety-component-state-variant/);
assert.match(projectEditor, /withHtmlComponentVariantCssOverride/);
assert.match(projectEditor, /cssOverrides[\s\S]*?patchCssDeclaration/);
assert.match(projectEditor, /const interactionPath = interactionDocumentPath\(variant\.filePath\)/);
assert.match(projectEditor, /applyBoundComponentVariableTextRef\.current\(path, value, persistentInlineHtml\)/);
assert.match(projectEditor, /htmlComponentVariableBindings\(candidate\)\.some/);
assert.match(projectEditor, /candidate\.id === variable\.id \? \{ \.\.\.candidate, defaultValue \}/);

const componentCssTargetChange = section(
  projectEditor,
  'const changeCssContext = useCallback',
  'const startSidebarResize = useCallback',
);
assert.match(componentCssTargetChange, /editingComponentMaster/);
assert.match(componentCssTargetChange, /componentEditReturnRef\.current\?\.path \|\| getProjectHomePath\(currentProject\)/);
assert.match(componentCssTargetChange, /linkHtmlComponentStylesheet\(created\.project, created\.storagePath\)/);
assert.match(
  componentRuntime,
  /export function linkHtmlComponentStylesheet\([\s\S]*?!path\.startsWith\(`\$\{HTML_COMPONENTS_DIRECTORY\}\/`\)[\s\S]*?relativePageHref\(path, cssFilePath\)[\s\S]*?ensureCssLink\(file\.text, href\)/,
  'a component CSS rule must be stored publicly and linked to both masters and rendered pages',
);

assert.match(componentRuntime, /bundle\?: HtmlComponentBundleReference/);
assert.match(componentRuntime, /export function migrateLegacyHtmlComponentBundles\(/);
assert.match(componentRuntime, /export function repairNestedHtmlComponentBundles\(/);
assert.match(
  componentRuntime,
  /sourceStylesheets\.has\(parent\.bundle\.styleFilePath\)[\s\S]*?stylesheetReferencesComponentScope\(currentStyle, parent\.id\)[\s\S]*?data-kodety-component-id'[\s\S]*?createHtmlComponentBundle\(/,
  'opening an old nested component must rebuild its bundle from the owning parent source',
);
assert.match(componentRuntime, /rebaseHtmlComponentMarkup\([\s\S]*?targetPagePath/);
assert.match(componentRuntime, /variables: component\.variables\.map\(variable => \{/);
assert.match(componentRuntime, /runtimeValues/);
assert.match(componentBundle, /export function createHtmlComponentBundle\(/);
assert.match(componentBundle, /component\.css/);
assert.match(componentBundle, /component\.json/);
assert.match(componentBundle, /data-kodety-component-scope/);
assert.match(componentBundle, /scopeComponentStylesheet\(/);
assert.match(componentBundle, /htmlComponentDocumentRootDeclarationIsPortable\(/);
assert.doesNotMatch(
  section(
    componentBundle,
    'const HTML_COMPONENT_DOCUMENT_ROOT_PORTABLE_PROPERTY',
    '/**\n * Document-root rules provide inherited context',
  ),
  /background/,
  'document backgrounds must not be promoted to a component root declaration',
);
assert.doesNotMatch(
  section(
    componentBundle,
    'function scopeComponentStylesheet(',
    'function parseImportParams(',
  ),
  /!selectors\.some\(selector => \/:root/,
  ':root must receive the same safe inherited-property filter as html and body',
);
assert.match(componentBundle, /export function rebaseHtmlComponentStylesheetScope\(/);
assert.match(
  componentBundle,
  /parseFromString\(markup, 'text\/html'\)[\s\S]*?const rebasedMarkup = rebaseHtmlComponentMarkup/,
  'nested extraction must inventory the selected subtree before adding the child scope',
);
assert.match(
  componentBundle,
  /rebaseHtmlComponentStylesheetScope\([\s\S]*?prepared,[\s\S]*?sourceComponentId,[\s\S]*?component\.id,[\s\S]*?sourceVariantId,[\s\S]*?variant\.id,[\s\S]*?\)[\s\S]*?scopeComponentStylesheet\(rebasedScope, componentRoot, component\.id\)/,
  'nested component CSS must replace the parent scope before final scoping',
);
assert.match(componentBundle, /projectFiles: \[\.\.\.localFiles\]/);
assert.match(componentBundle, /export function attachHtmlComponentStylesheets\(/);
assert.match(componentBundle, /export function inlineHtmlComponentStyles\(/);
assert.match(componentBundle, /export function buildHtmlComponentPreviewDocument\(/);
assert.match(componentBundle, /projectFileDataUrl\(/);
assert.match(
  componentBundle,
  /const rootStyle = \(root as HTMLElement \| SVGElement\)\.style;[\s\S]*?rootStyle\.setProperty\('position', 'relative', 'important'\)/,
  'the Insert preview must project only the component root into normal flow',
);
assert.match(
  componentBundle,
  /'top',[\s\S]*?'right',[\s\S]*?'bottom',[\s\S]*?'left',[\s\S]*?rootStyle\.setProperty\(property, 'auto', 'important'\)/,
  'the isolated component root must not retain page positioning offsets',
);
assert.match(componentBundle, /export function htmlComponentSourceReferencePath\(/);
assert.match(componentBundle, /const sourceReferencePath = htmlComponentSourceReferencePath\(sourcePage, sourcePagePath\)/);
assert.match(componentBundle, /sourceDocument[\s\S]*?htmlComponentSourceReferencePath\(sourceDocument, variantFilePath\)/);
assert.match(componentRuntime, /mergeHtmlComponentBundleResults\([\s\S]*?variantBundles\.map/);
assert.match(componentBundle, /projectReferencePath\(project, referencePath, href\)/);
assert.match(componentBundle, /\^\(\?:https\?:\|mailto:\|tel:\|\\\/\\\/\)\/i/);
assert.doesNotMatch(componentBundle, /assets\/rubrika\.svg/);
assert.match(projectIo, /synchronizeHtmlComponentBundleManifests\(/);
assert.match(projectEditor, /createHtmlComponentBundleReference\(componentId\)/);
assert.match(
  projectEditor,
  /migrateLegacyHtmlComponentBundles\([\s\S]*?repairNestedHtmlComponentBundles\([\s\S]*?writeComponentLibrary\(repaired\.project, repaired\.library\)/,
  'component bundle upgrade must include nested-scope repair before opening the master',
);
assert.match(projectEditor, /createHtmlComponentBundle\([\s\S]*?componentEditorDocument\(source, bundle\.markup/);
assert.match(projectEditor, /buildHtmlComponentPreviewDocument\(project, component, variant\)/);
assert.match(projectEditor, /htmlComponentPreviewDependencyFiles\(project, component\)/);
assert.match(projectIo, /migrateLegacyHtmlComponentBundles\(/);
assert.match(projectIo, /inlineHtmlComponentStyles\(/);
assert.match(preview, /attachHtmlComponentStylesheets\(/);
assert.match(componentPanel, /srcDoc=\{previewDocument\}/);
assert.doesNotMatch(componentPanel, /function componentPreviewDocument\(/);
assert.match(
  componentPanel,
  /<DropdownMenuContent align="end" data-html-insert-menu-portal>/,
  'component card actions must identify their portalled menu as owned by Insert',
);
assert.match(
  insertMenu,
  /target\.closest\([\s\S]*?data-insert-panel-trigger[\s\S]*?data-html-insert-menu-portal/,
  'Insert outside-click handling must not unmount a portalled component action before selection',
);
assert.match(
  insertMenu,
  /onEdit=\{\(\) => \{\s*onEditComponent\?\.\(component\.id\);\s*\}\}/,
  'editing a component from Insert must not implicitly close the catalog',
);
assert.match(
  insertMenu,
  /onRename=\{\(\) => \{\s*onRenameComponent\?\.\(component\.id\);\s*\}\}/,
  'renaming a component from Insert must not implicitly close the catalog',
);
assert.match(
  projectEditor,
  /onEditComponent: componentId => openHtmlComponentEditor\([\s\S]*?preserveNavigatorOverlays: true/,
  'component editing launched inside Insert must preserve the originating sidebar panel',
);

assert.match(projectEditor, /return returnBootstrap\.preview/);
assert.match(bufferedIframe, /retained\.surfaceKey === surfaceKey/);
assert.match(bufferedIframe, /kind: 'reactivated'/);
assert.match(bufferedIframe, /cached\.pinned/);
assert.match(bufferedIframe, /!cached\.pinned/);
assert.match(canvasStage, /data-page-editor-canvas-surface/);
assert.match(canvasStage, /data-component-editor-canvas-surface/);
assert.match(canvasStage, /title="Canvas persistente da página HTML"/);
assert.match(canvasStage, /title="Canvas persistente do componente HTML"/);
assert.match(canvasStage, /pageCanvasIframeNodeRef/);
assert.match(canvasStage, /componentCanvasIframeNodeRef/);
assert.match(canvasStage, /activeEditorSurfaceIsComponentRef/);
assert.equal((canvasStage.match(/pinRetainedDocument/g) || []).length >= 2, true);
assert.match(bufferedIframe, /setPendingDocument\([\s\S]*?retained\.revision === documentRevision/);
assert.match(preview, /const needsCanvasModuleGraph = !freezeMotion/);
assert.match(preview, /const modulePaths = needsCanvasModuleGraph[\s\S]*?: \[\]/);
assert.match(preview, /const componentEditorCanvas = inspectionEnabled/);
assert.match(preview, /&& \(!inspectionEnabled \|\| sourceHasHtmlComponentInstances\)/);
assert.match(preview, /if \(!inspectionEnabled\) \{[\s\S]*?injectHtmlComponentRuntimeRegistry\(/);
assert.match(
  preview,
  /Component masters also use the editor-owned interaction runtime[\s\S]*?if \(freezeMotion\) \{[\s\S]*?const motionBootstrap/,
);
assert.doesNotMatch(preview, /if \(!componentEditorCanvas\) \{[\s\S]*?const motionBootstrap/);
assert.match(
  preview,
  /body\[data-kodety-component-editor\][^']*width:100%!important;max-width:100%!important/,
);
assert.match(
  preview,
  /body\[data-kodety-component-editor\]>:first-child\{position:relative!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important/,
  'the component editor must project only the master root as relative',
);
assert.match(
  componentRuntime,
  /body\[data-kodety-component-editor\]>:first-child\{position:relative!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important/,
  'new component master documents must carry the same root-only projection',
);
assert.doesNotMatch(preview, /data-html-editor-component-fit-width/);
assert.match(preview, /data-html-editor-component-fit-height/);
assert.match(preview, /intrinsicHeightProjection\.textContent = '[^']*height:fit-content!important/);
const componentMeasurement = section(
  preview,
  "if (document.body.hasAttribute('data-kodety-component-editor')) {",
  'let editorBridgeStarted = false;',
);
assert.doesNotMatch(componentMeasurement, /componentRoot\.querySelectorAll\('\*'\)/);
assert.doesNotMatch(componentMeasurement, /getComputedStyle\(element\)/);
assert.doesNotMatch(componentMeasurement, /document\.(?:body|documentElement)\.scrollHeight/);
assert.match(componentMeasurement, /Number\(innerWidth\) \|\| document\.documentElement\.clientWidth/);
assert.match(componentMeasurement, /componentRoot\.scrollHeight/);
assert.match(componentMeasurement, /componentRoot instanceof HTMLElement \|\| componentRoot instanceof SVGElement/);
assert.match(componentMeasurement, /rootFillsLayoutWidth \? layoutViewportWidth : intrinsicWidth/);
assert.match(componentMeasurement, /layoutWidth: layoutViewportWidth/);
assert.match(componentMeasurement, /layoutHeight: layoutViewportHeight/);
assert.match(componentMeasurement, /componentResizeObserver\?\.observe\(componentRoot\)/);
assert.match(
  componentMeasurement,
  /attributeFilter: \['style', 'class', 'hidden', 'width', 'height', 'src'\]/,
);
assert.match(componentMeasurement, /requestAnimationFrame\(\(\) => reportComponentSize\(true\)\)/);
assert.match(componentMeasurement, /const reportFallbackComponentSize = \(force = false\) =>/);
assert.match(componentMeasurement, /requestAnimationFrame\(\(\) => reportFallbackComponentSize\(true\)\)/);
assert.match(componentMeasurement, /componentInitialSizeReported = true;[\s\S]*?signalFirstContentReady\(\)/);
assert.match(projectEditor, /const componentMeasurementContextRef = useRef/);
assert.match(projectEditor, /const measurementContext = componentMeasurementContextRef\.current/);
assert.match(canvasStage, /const componentLayoutViewport = \{/);
assert.match(canvasStage, /const componentMeasurementCacheKey = \[/);
assert.match(canvasStage, /Math\.min\(componentLayoutViewport\.height, Math\.ceil\(effectiveComponentCanvasSize\.height\)\)/);
assert.match(
  canvasStage,
  /title="Canvas persistente do componente HTML"[\s\S]*?style=\{\{[\s\S]*?width: componentLayoutViewport\.width,[\s\S]*?height: componentLayoutViewport\.height/,
);
const componentCanvasHud = section(
  canvasStage,
  '{canvasToolbarHost && !isPreviewing',
  '), canvasToolbarHost)}',
);
assert.doesNotMatch(
  componentCanvasHud.slice(0, componentCanvasHud.indexOf('createPortal')),
  /!editingHtmlComponent/,
  'component editing must keep the normal canvas HUD mounted',
);
assert.match(
  componentCanvasHud,
  /role="tablist"[\s\S]*?aria-label="Breakpoints principais"[\s\S]*?mainCanvasBreakpointTabs\.map[\s\S]*?selectCanvasBreakpoint\(tab\.id\)/,
  'component editing must expose the same responsive breakpoint selector as the page canvas',
);
assert.match(
  componentCanvasHud,
  /\{!editingHtmlComponent && infiniteCanvasBetaEnabled && \(/,
  'only the page-specific Infinite Canvas control must stay hidden while editing a component',
);
assert.match(
  componentCanvasHud,
  /onClick=\{fitCanvas\}[\s\S]*?data-tooltip="Ajustar canvas"/,
  'component editing must retain the shared fit control beside the breakpoint selector',
);
assert.match(preview, /data-html-editor-deferred-google-font/);
assert.match(projectFonts, /latestProjectFontCatalogCache\?\.signature === sourceSignature/);
assert.match(projectFonts, /projectFontCatalogByFilesCache\.get\(filesCacheKey\)/);

assert.match(projectIo, /export function createLatestProjectZipBuilder\(/);
assert.match(projectIo, /activeController\?\.abort/);
assert.match(projectEditor, /createLatestProjectZipBuilder\(\{ fast: true \}\)/);
assert.match(sharingRuntime, /private const FEED_MAX_BYTES = 0/);
assert.match(sharingRuntime, /private const FEED_MAX_CHANGES = 0/);

console.log('HTML component regression contracts passed.');
