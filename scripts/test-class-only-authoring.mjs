import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = relative => readFile(path.join(root, relative), 'utf8');

const [patcher, editor, inspector, selector, selectorLogic, sourcePatcher, elementStyleIdentity] = await Promise.all([
  read('lib/html-editor/css-patcher.ts'),
  read('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
  read('app/(builder)/kodety/html-editor/components/HtmlClassSelector.tsx'),
  read('lib/html-editor/class-selector.ts'),
  read('lib/html-editor/source-patcher.ts'),
  read('lib/html-editor/element-style-identity.ts'),
]);

assert.match(patcher, /interface CssEditingContext[\s\S]*?target: 'rule';/);
assert.doesNotMatch(patcher, /changeCssEditingTarget|target: 'inline' \| 'rule'/);

assert.doesNotMatch(inspector, /Inline style|kodety-editor-context-tabs|Ou use #id \/ tag/);
assert.match(inspector, /data-html-inspector-selection-context[\s\S]*?<HtmlClassSelector[\s\S]*?>State<\/span>/);

assert.doesNotMatch(editor, /html-editor:css-target-preference|targetPreferenceSetRef|target:\s*saved/);
assert.match(
  editor,
  /const authoredCssContext: CssEditingContext = \{[\s\S]*?target: 'rule',[\s\S]*?breakpoint: activeViewportBreakpoint/,
);
assert.match(
  editor,
  /const needsStableSelector =[\s\S]*?!primaryClasses\.length[\s\S]*?generatedVisualClass\(node\)/,
);
assert.match(
  editor,
  /const inlineDetailsByPath =[\s\S]*?parseStyleDeclarationDetails[\s\S]*?const useDedicatedElementStyle =[\s\S]*?createElementStyleId\(reservedElementStyleIds\)[\s\S]*?patchElementAttribute\(html, path, ELEMENT_STYLE_ID_ATTRIBUTE, id\)/,
  'the first edit of imported inline CSS must materialize one private, project-unique element identity',
);
assert.match(
  editor,
  /if \(elementStyleIds\.size\)[\s\S]*?Object\.entries\(inline\)\.forEach[\s\S]*?patchCssDeclaration\(css, individualContext, property, propertyValue, breakpoints\)[\s\S]*?if \(elementStyleIds\.has\(path\)[\s\S]*?Object\.keys\(styles\)\.forEach/,
  'promotion must move the complete inline block before removing it from HTML',
);
assert.match(
  editor,
  /const preserveWinningRulePriority = Boolean\([\s\S]*?winningStyleOrigin\?\.important && !winningStyleOrigin\.inline[\s\S]*?preservePriority: preserveWinningRulePriority/,
  'an inline !important winner must not reintroduce priority into the promoted rule',
);
assert.match(
  editor,
  /const previewSelector = \([\s\S]*?editingLocalizedPage[\s\S]*?\|\| selectedOrigin\?\.inline[\s\S]*?\? ''/,
  'an inline-owned scrub must remain scoped to the selected path until promotion commits',
);
assert.match(elementStyleIdentity, /ELEMENT_STYLE_ID_ATTRIBUTE = 'data-kodety-style-id'/);
assert.match(elementStyleIdentity, /elementStyleSelector[\s\S]*?return `\$\{atom\}\$\{atom\}\$\{atom\}`/);
assert.doesNotMatch(editor, /ensureAbsoluteParentPositioningContext/);
assert.match(
  editor,
  /absoluteParentWrites[\s\S]*?generatedVisualClass\(parentNode\)[\s\S]*?patchCssDeclaration\(css, parentContext, 'position', 'relative'/,
);

const directControl = editor.match(
  /directStyleCommitRef\.current =[\s\S]*?\n  \};\n  \}\);/,
)?.[0] || '';
assert.ok(directControl, 'direct-control writer must exist');
assert.doesNotMatch(directControl, /patchElementStyleDeclaration|changeSource\(/);
assert.match(directControl, /cssContextSelectionPathRef\.current === path[\s\S]*?type: 'html-editor-select'/);

const stylePaste = editor.match(/const pasteStylesForPath =[\s\S]*?\n  \};\n\n  useEffect/)?.[0] || '';
assert.ok(stylePaste, 'layer style paste writer must exist');
assert.doesNotMatch(stylePaste, /patchElementStyleDeclaration|changeSource\(/);
assert.match(stylePaste, /pendingClassStylePasteRef\.current[\s\S]*?type: 'html-editor-select'/);

const visibility = editor.match(/const updateVisibility =[\s\S]*?\n  \};\n\n  const updateLayerVisibility/)?.[0] || '';
assert.ok(visibility, 'visibility writer must exist');
assert.doesNotMatch(visibility, /patchElementVisibility|changeSource\(/);
assert.match(visibility, /updateStyle\('display', visible \? '' : 'none', \{\s*visibility: \{ visible, fallbackDisplay, computedDisplay: computedVisibleDisplay \}/);

const anchorWrapper = sourcePatcher.match(/export function patchWrapElementWithAnchor[\s\S]*?\n\}/)?.[0] || '';
assert.ok(anchorWrapper, 'link wrapper must exist');
assert.doesNotMatch(anchorWrapper, /style=/);

assert.match(selector, /max-h-56[\s\S]*?Classes reutilizáveis/);
assert.match(
  selector,
  /overflow-hidden rounded-\[5px\][\s\S]*?Combo class[\s\S]*?border-t border-white\/\[\.1\][\s\S]*?Reutilizável/,
);
assert.equal((selector.match(/min-h-10 w-full flex-col/g) || []).length, 2);
assert.doesNotMatch(selector, /grid-cols-2[\s\S]*?Combo class/);
assert.match(selector, /Classes reutilizáveis[\s\S]*?gap-1 px-2 pb-2[\s\S]*?min-h-6[\s\S]*?px-2 py-1 text-\[9px\]/);
assert.match(selector, /<span className="min-w-0 truncate">\{name\}<\/span>/);
assert.doesNotMatch(selector, /\bShare2\b/);
assert.match(
  selectorLogic,
  /import \{ inspectSourceElementIndex, transformSourceClassAttributes, transformSourceStyleBlocks \} from '\.\/source-patcher'/,
  'class scans must share the source patcher parse5 index',
);
assert.doesNotMatch(
  selectorLogic,
  /from ['"]parse5['"]/,
  'class scans must not maintain a second whole-document parse path',
);
assert.match(
  selector,
  /const comboCandidates = useMemo[\s\S]*?if \(!open \|\| !stableChips\.length\) return \[\][\s\S]*?comboSuggestions[\s\S]*?\}, \[open, reusableSet, source, stableChips\]\)[\s\S]*?const suggestions = useMemo[\s\S]*?\[comboCandidates, draft\]/,
  'combo discovery must stay dormant while its popover is closed and must not rescan HTML on every draft keystroke',
);
assert.match(
  selector,
  /const usageCount = useMemo\([\s\S]*?countClassUsage\(source, activeChain\)[\s\S]*?\[activeChain, source\]/,
  'usage counting must be memoized across unrelated selector renders',
);

console.log('Class-only visual authoring regression tests passed');
