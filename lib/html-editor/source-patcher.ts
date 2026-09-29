import { parse, parseFragment } from 'parse5';
import {
  parseStyleDeclarationDetails,
  parseStyleDeclarations,
  serializeStyleDeclarationDetails,
  serializeStyleDeclarations,
  writeStyleDeclarationDetails,
  writeStyleDeclaration,
  type StyleDeclarationWriteOptions,
} from './style-utils';
import { BUILDER_HIDDEN_ATTRIBUTE } from './builder-visibility';

interface SourceLocation {
  startOffset: number;
  endOffset: number;
  startTag?: { startOffset: number; endOffset: number };
  endTag?: { startOffset: number; endOffset: number };
  attrs?: Record<string, { startOffset: number; endOffset: number }>;
}

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  content?: ParsedNode;
  sourceCodeLocation?: SourceLocation;
}

/**
 * Lightweight authored-element snapshot backed by parse5 source offsets.
 *
 * Consumers that need both a tree walk and source replacement can inspect the
 * document once and splice by these offsets. This avoids the old DOMParser +
 * parse5 double parse on every component-canvas build.
 */
export interface SourceElementSnapshot {
  path: string;
  tagName: string;
  attributes: Record<string, string>;
  startOffset: number;
  endOffset: number;
}

// A selection message can ask for the same authored tree several times in one
// turn (component ancestry, layer identity and Inspector lookup). Parsing a
// multi-megabyte page for every consumer makes a single click scale with the
// number of panels that react to it. Source strings are immutable, so a small
// content-keyed LRU safely shares the exact offsets until the HTML changes.
// Keep the window deliberately small: cached source text and snapshots should
// never become another project-sized history.
const SOURCE_ELEMENT_CACHE_LIMIT = 3;
export interface SourceElementIndex {
  body?: SourceElementSnapshot;
  elements: SourceElementSnapshot[];
  byPath: Map<string, SourceElementSnapshot>;
}
type SourceElementCacheEntry = SourceElementIndex;
const sourceElementCache = new Map<string, SourceElementCacheEntry>();

export type ElementDropPosition = 'before' | 'inside' | 'after';

export interface MoveElementResult {
  source: string;
  path: string;
  /** Exact authored attributes of the moved root, when produced by patchMoveElement. */
  movedAttributes?: Record<string, string>;
}

export type InsertElementResult = MoveElementResult;

function elementChildren(node: ParsedNode) {
  return (node.childNodes || []).filter(child => Boolean(child.tagName));
}

interface SourceNodeContext {
  node: ParsedNode;
  parent: ParsedNode | null;
  /** Authored element chain from body through the direct parent. */
  ancestors: ParsedNode[];
}

const HTML_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

const HTML_PHRASING_ELEMENTS = new Set([
  'a', 'abbr', 'area', 'audio', 'b', 'bdi', 'bdo', 'br', 'button',
  'canvas', 'cite', 'code', 'data', 'datalist', 'del', 'dfn', 'em',
  'embed', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'map',
  'mark', 'math', 'meter', 'noscript', 'object', 'output', 'picture',
  'progress', 'q', 'ruby', 's', 'samp', 'script', 'select', 'slot',
  'small', 'span', 'strong', 'sub', 'sup', 'svg', 'template', 'textarea',
  'time', 'u', 'var', 'video', 'wbr',
]);

const HTML_PHRASING_ONLY_PARENTS = new Set([
  'abbr', 'b', 'bdi', 'bdo', 'button', 'cite', 'code', 'dfn', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'i', 'kbd', 'label', 'legend',
  'mark', 'meter', 'output', 'p', 'pre', 'progress', 'q', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'summary', 'sup', 'time', 'u', 'var',
]);

const HTML_DIRECT_CHILDREN = new Map<string, Set<string>>([
  ['ul', new Set(['li', 'script', 'template'])],
  ['ol', new Set(['li', 'script', 'template'])],
  ['menu', new Set(['li', 'script', 'template'])],
  ['dl', new Set(['dt', 'dd', 'div', 'script', 'template'])],
  ['table', new Set(['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'script', 'template'])],
  ['thead', new Set(['tr', 'script', 'template'])],
  ['tbody', new Set(['tr', 'script', 'template'])],
  ['tfoot', new Set(['tr', 'script', 'template'])],
  ['tr', new Set(['td', 'th', 'script', 'template'])],
  ['colgroup', new Set(['col', 'template'])],
  ['select', new Set(['option', 'optgroup', 'hr', 'script', 'template'])],
  ['optgroup', new Set(['option', 'script', 'template'])],
  ['picture', new Set(['source', 'img', 'script', 'template'])],
]);

const HTML_TEXT_ONLY_PARENTS = new Set(['option', 'textarea', 'title', 'style', 'script']);
const HTML_NO_MEANINGFUL_TEXT_PARENTS = new Set([
  ...HTML_DIRECT_CHILDREN.keys(),
]);

const HTML_REQUIRED_DIRECT_PARENTS = new Map<string, Set<string>>([
  ['li', new Set(['ul', 'ol', 'menu'])],
  ['dt', new Set(['dl', 'div'])],
  ['dd', new Set(['dl', 'div'])],
  ['caption', new Set(['table'])],
  ['colgroup', new Set(['table'])],
  ['thead', new Set(['table'])],
  ['tbody', new Set(['table'])],
  ['tfoot', new Set(['table'])],
  ['tr', new Set(['thead', 'tbody', 'tfoot'])],
  ['td', new Set(['tr'])],
  ['th', new Set(['tr'])],
  ['col', new Set(['colgroup'])],
  ['option', new Set(['select', 'optgroup', 'datalist'])],
  ['optgroup', new Set(['select'])],
  ['source', new Set(['picture', 'audio', 'video'])],
  ['track', new Set(['audio', 'video'])],
  ['figcaption', new Set(['figure'])],
  ['legend', new Set(['fieldset'])],
  ['summary', new Set(['details'])],
  ['area', new Set(['map'])],
]);

function nodeTag(node: ParsedNode | null | undefined) {
  return node?.tagName?.toLowerCase() || '';
}

function nodeAttribute(node: ParsedNode, name: string) {
  return node.attrs?.find(attribute => attribute.name.toLowerCase() === name.toLowerCase())?.value;
}

function meaningfulChildren(node: ParsedNode) {
  return (node.childNodes || []).filter(child =>
    Boolean(child.tagName) || (child.nodeName === '#text' && Boolean(child.value?.trim())),
  );
}

function findBody(root: ParsedNode) {
  const html = elementChildren(root).find(node => node.tagName === 'html');
  return html && elementChildren(html).find(node => node.tagName === 'body');
}

function findNodeContext(root: ParsedNode, path: string): SourceNodeContext {
  const body = findBody(root);
  if (!body) throw new Error('O documento não possui um elemento body válido.');
  const indexes = path.split('/').filter(Boolean).map(Number);
  let current = body;
  const ancestors: ParsedNode[] = [];
  for (const index of indexes) {
    const next = elementChildren(current)[index];
    if (!next) throw new Error('O elemento mudou de posição. Selecione-o novamente.');
    ancestors.push(current);
    current = next;
  }
  return {
    node: current,
    parent: ancestors.at(-1) || null,
    ancestors,
  };
}

function htmlStructureError(parentTag: string, childTag: string) {
  const child = childTag ? `<${childTag}>` : 'texto';
  return new Error(`A estrutura criaria HTML inválido: <${parentTag}> não pode conter ${child}.`);
}

function isInteractiveNode(node: ParsedNode) {
  const tag = nodeTag(node);
  if (['a', 'button', 'details', 'embed', 'iframe', 'label', 'select', 'textarea'].includes(tag)) return true;
  if (tag === 'input') return (nodeAttribute(node, 'type') || '').toLowerCase() !== 'hidden';
  if (tag === 'audio' || tag === 'video') return nodeAttribute(node, 'controls') !== undefined;
  if (tag === 'img') return nodeAttribute(node, 'usemap') !== undefined;
  return nodeAttribute(node, 'tabindex') !== undefined;
}

function subtreeSome(node: ParsedNode, predicate: (candidate: ParsedNode) => boolean): boolean {
  return predicate(node) || elementChildren(node).some(child => subtreeSome(child, predicate));
}

function nearestTransparentContentParent(ancestors: ParsedNode[]) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const tag = nodeTag(ancestors[index]);
    if (tag && tag !== 'a') return tag;
  }
  return 'body';
}

function assertDirectChildAllowed(parent: ParsedNode, child: ParsedNode, ancestors: ParsedNode[]) {
  const parentTag = nodeTag(parent);
  const childTag = nodeTag(child);
  if (HTML_VOID_ELEMENTS.has(parentTag)) throw htmlStructureError(parentTag, childTag);
  if (!childTag) {
    if (HTML_NO_MEANINGFUL_TEXT_PARENTS.has(parentTag)) throw htmlStructureError(parentTag, '');
    return;
  }
  if (HTML_TEXT_ONLY_PARENTS.has(parentTag)) throw htmlStructureError(parentTag, childTag);

  const allowedChildren = HTML_DIRECT_CHILDREN.get(parentTag);
  if (allowedChildren && !allowedChildren.has(childTag)) throw htmlStructureError(parentTag, childTag);

  const effectiveParent = parentTag === 'a'
    ? nearestTransparentContentParent(ancestors)
    : parentTag;
  if (HTML_PHRASING_ONLY_PARENTS.has(effectiveParent) && !HTML_PHRASING_ELEMENTS.has(childTag)) {
    throw htmlStructureError(effectiveParent, childTag);
  }

  const requiredParents = HTML_REQUIRED_DIRECT_PARENTS.get(childTag);
  if (requiredParents && !requiredParents.has(parentTag)) throw htmlStructureError(parentTag, childTag);
}

function assertNoInteractiveNesting(node: ParsedNode, ancestors: ParsedNode[]) {
  const ancestorTags = ancestors.map(nodeTag);
  if (ancestorTags.includes('a') && subtreeSome(node, isInteractiveNode)) {
    throw new Error('A estrutura criaria HTML inválido: links não podem conter links ou outros controles interativos.');
  }
  if (ancestorTags.includes('button') && subtreeSome(node, isInteractiveNode)) {
    throw new Error('A estrutura criaria HTML inválido: botões não podem conter outros controles interativos.');
  }
  if (ancestorTags.includes('label') && subtreeSome(node, candidate => nodeTag(candidate) === 'label')) {
    throw new Error('A estrutura criaria HTML inválido: labels não podem ser aninhadas.');
  }
  if (ancestorTags.includes('form') && subtreeSome(node, candidate => nodeTag(candidate) === 'form')) {
    throw new Error('A estrutura criaria HTML inválido: formulários não podem ser aninhados.');
  }
}

function assertContainerChildren(parent: ParsedNode, children: ParsedNode[], ancestors: ParsedNode[]) {
  const parentTag = nodeTag(parent);
  children.forEach(child => assertDirectChildAllowed(parent, child, ancestors));

  if (parentTag === 'picture') {
    const content = children.filter(child => !['script', 'template'].includes(nodeTag(child)));
    const imageIndexes = content.flatMap((child, index) => nodeTag(child) === 'img' ? [index] : []);
    if (imageIndexes.length !== 1 || content.some((child, index) => nodeTag(child) === 'source' && index > imageIndexes[0])) {
      throw new Error('A estrutura criaria HTML inválido: <picture> precisa de sources antes de uma única imagem final.');
    }
  }
}

function assertSemanticSubtree(node: ParsedNode, ancestors: ParsedNode[]) {
  if (!node.tagName) return;
  assertNoInteractiveNesting(node, ancestors);
  const children = meaningfulChildren(node);
  assertContainerChildren(node, children, ancestors);
  children.forEach(child => {
    if (child.tagName) assertSemanticSubtree(child, [...ancestors, node]);
  });
}

/**
 * Validates one structural mutation against the same HTML content-model rules
 * for insertion, wrapping and retagging. The source is spliced only after this
 * guard succeeds, so parse5/browser error recovery can never silently move or
 * discard the user's new layer.
 */
function assertValidHtmlPlacement(
  parent: ParsedNode,
  ancestors: ParsedNode[],
  index: number,
  removeCount: number,
  nodes: ParsedNode[],
) {
  const currentChildren = meaningfulChildren(parent);
  const nextChildren = [...currentChildren];
  nextChildren.splice(index, removeCount, ...nodes);
  assertContainerChildren(parent, nextChildren, ancestors);
  nodes.forEach(node => assertSemanticSubtree(node, [...ancestors, parent]));
}

function parseInsertedMarkup(markup: string) {
  const fragment = parseFragment(markup, { sourceCodeLocationInfo: true }) as ParsedNode;
  const nodes = meaningfulChildren(fragment);
  if (!nodes.length || nodes.some(node => !node.tagName)) {
    throw new Error('Insira ao menos um elemento HTML válido.');
  }
  return nodes;
}

function virtualElement(tag: string, children: ParsedNode[], attrs: ParsedNode['attrs'] = []): ParsedNode {
  return { nodeName: tag, tagName: tag, attrs, childNodes: children };
}

function validateWrapper(
  parsed: ParsedNode,
  path: string,
  tag: string,
  attrs: ParsedNode['attrs'] = [],
) {
  const normalizedTag = tag.toLowerCase();
  if (HTML_VOID_ELEMENTS.has(normalizedTag)) {
    throw new Error(`A tag <${normalizedTag}> não pode envolver conteúdo.`);
  }
  const context = findNodeContext(parsed, path);
  if (!context.parent) throw new Error('O Body não pode ser envolvido. Selecione um elemento dentro dele.');
  const parentAncestors = context.ancestors.slice(0, -1);
  const index = meaningfulChildren(context.parent).indexOf(context.node);
  if (index < 0) throw new Error('Não foi possível localizar este elemento no pai atual.');
  assertValidHtmlPlacement(
    context.parent,
    parentAncestors,
    index,
    1,
    [virtualElement(normalizedTag, [context.node], attrs)],
  );
  return { context, normalizedTag };
}

function findNode(root: ParsedNode, path: string) {
  return findNodeContext(root, path).node;
}

function inspectSourceDocument(source: string): SourceElementCacheEntry {
  const cached = sourceElementCache.get(source);
  if (cached) {
    sourceElementCache.delete(source);
    sourceElementCache.set(source, cached);
    return cached;
  }
  const document = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const html = elementChildren(document).find(node => node.tagName === 'html');
  const body = html && elementChildren(html).find(node => node.tagName === 'body');
  if (!body) {
    const empty: SourceElementCacheEntry = { elements: [], byPath: new Map() };
    sourceElementCache.set(source, empty);
    if (sourceElementCache.size > SOURCE_ELEMENT_CACHE_LIMIT) {
      sourceElementCache.delete(sourceElementCache.keys().next().value!);
    }
    return empty;
  }
  const bodyLocation = body.sourceCodeLocation;
  const bodySnapshot = bodyLocation ? {
    path: '',
    tagName: body.tagName || 'body',
    attributes: Object.fromEntries((body.attrs || []).map(attribute => [
      attribute.name,
      attribute.value,
    ])),
    startOffset: bodyLocation.startOffset,
    endOffset: bodyLocation.endOffset,
  } : undefined;
  const snapshots: SourceElementSnapshot[] = [];
  const walk = (node: ParsedNode, path: string) => {
    const location = node.sourceCodeLocation;
    if (node.tagName && location) {
      snapshots.push({
        path,
        tagName: node.tagName,
        attributes: Object.fromEntries((node.attrs || []).map(attribute => [
          attribute.name,
          attribute.value,
        ])),
        startOffset: location.startOffset,
        endOffset: location.endOffset,
      });
    }
    elementChildren(node).forEach((child, index) => {
      walk(child, path ? `${path}/${index}` : String(index));
    });
  };
  elementChildren(body).forEach((node, index) => walk(node, String(index)));
  const byPath = new Map(snapshots.map(snapshot => [snapshot.path, snapshot]));
  if (bodySnapshot) byPath.set('', bodySnapshot);
  const entry = { body: bodySnapshot, elements: snapshots, byPath };
  sourceElementCache.set(source, entry);
  if (sourceElementCache.size > SOURCE_ELEMENT_CACHE_LIMIT) {
    sourceElementCache.delete(sourceElementCache.keys().next().value!);
  }
  return entry;
}

/**
 * Cached authored-element index, including the body at the empty canvas path.
 * Consumers that need body-aware ancestry or repeated path lookups can share
 * this parse5 pass instead of rebuilding an independent DOM tree.
 */
export function inspectSourceElementIndex(source: string): SourceElementIndex {
  return inspectSourceDocument(source);
}

export function inspectSourceElements(source: string): SourceElementSnapshot[] {
  return inspectSourceDocument(source).elements;
}

function applySourceTextReplacements(source: string, replacements: Array<{ start: number; end: number; text: string }>): string {
  if (!replacements.length) return source;
  const parts: string[] = [];
  let offset = 0;
  // Build once from original offsets. Repeatedly slicing the whole document
  // makes a class rename copy the entire page once for every matching element.
  for (const replacement of replacements.sort((a, b) => a.start - b.start)) {
    parts.push(source.slice(offset, replacement.start), replacement.text);
    offset = replacement.end;
  }
  parts.push(source.slice(offset));
  return parts.join('');
}

/** Patch all authored class attributes in one parse, including head and templates. */
export function transformSourceClassAttributes(source: string, transform: (value: string) => string): string {
  const document = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const walk = (node: ParsedNode) => {
    const attribute = node.attrs?.find(candidate => candidate.name === 'class');
    const location = node.sourceCodeLocation?.attrs?.class;
    if (attribute && location) {
      const value = transform(attribute.value);
      if (value !== attribute.value) replacements.push({
        start: location.startOffset,
        end: location.endOffset,
        text: `class="${escapeAttribute(value)}"`,
      });
    }
    node.childNodes?.forEach(walk);
    if (node.content) walk(node.content);
  };
  walk(document);
  return applySourceTextReplacements(source, replacements);
}

/** Transform authored CSS without matching lookalike markup inside scripts/comments. */
export function transformSourceStyleBlocks(source: string, transform: (css: string) => string): string {
  const document = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const walk = (node: ParsedNode) => {
    if (node.tagName === 'style') {
      const type = node.attrs?.find(attribute => attribute.name === 'type')?.value || '';
      const location = node.sourceCodeLocation;
      if ((!type || type.trim().toLowerCase() === 'text/css') && location?.startTag) {
        const start = location.startTag.endOffset;
        const end = location.endTag?.startOffset ?? location.endOffset;
        const css = source.slice(start, end);
        const text = transform(css);
        if (text !== css) replacements.push({ start, end, text });
      }
    }
    node.childNodes?.forEach(walk);
    if (node.content) walk(node.content);
  };
  walk(document);
  return applySourceTextReplacements(source, replacements);
}

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

export function patchElementText(source: string, path: string, value: string) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  if (elementChildren(node).length) {
    throw new Error('Por segurança, textos com elementos internos devem ser editados no código.');
  }
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) throw new Error('Não foi possível localizar o texto no arquivo.');
  return source.slice(0, location.startTag.endOffset)
    + value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    + source.slice(location.endTag.startOffset);
}

/**
 * Replaces only an element's authored contents, retaining its own tag and
 * attributes. Callers must sanitize `html` before crossing this source
 * boundary; keeping this patcher deliberately syntax-only also lets inline
 * markup such as spans and soft breaks round-trip without being flattened.
 */
export function patchElementInnerHtml(source: string, path: string, html: string) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) {
    throw new Error('Não foi possível localizar o conteúdo do elemento no arquivo.');
  }
  return source.slice(0, location.startTag.endOffset)
    + html
    + source.slice(location.endTag.startOffset);
}

interface ParsedTextNode extends ParsedNode {
  value?: string;
}

function hasMeaningfulDirectText(node: ParsedNode) {
  return (node.childNodes || []).some(child => child.nodeName === '#text' && Boolean((child as ParsedTextNode).value?.trim()));
}

/**
 * True when a container can be safely edited as one combined text block: every
 * child is a non-void text wrapper (span/anchor/strong…) with no nested elements,
 * and the container itself holds no meaningful direct text. That last guard is
 * essential — `<p>Read <a>more</a> now</p>` must NOT qualify, or rewriting it
 * would destroy the "Read"/"now" text nodes.
 */
export function isCombinedTextContainer(source: string, path: string) {
  return getCombinedTextLines(source, path) !== null;
}

function decodeText(value: string) {
  const fragment = parseFragment(value) as ParsedNode;
  const collectText = (node: ParsedNode): string => node.nodeName === '#text'
    ? (node.value || '')
    : (node.childNodes || []).map(collectText).join('');
  return (fragment.childNodes || []).map(collectText).join('');
}

/**
 * The current text of each child wrapper, or null when the element is not a safe
 * combined-text container. Text is returned exactly (decoded), one entry per
 * child, so it can round-trip through {@link patchContainerLines}.
 */
export function getCombinedTextLines(source: string, path: string): string[] | null {
  let node: ParsedNode;
  try {
    node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  } catch {
    return null;
  }
  const children = elementChildren(node);
  if (!children.length || hasMeaningfulDirectText(node)) return null;
  const lines: string[] = [];
  for (const child of children) {
    const location = child.sourceCodeLocation;
    // Reject nested elements and void elements (img/br/input have no end tag).
    if (elementChildren(child).length || !location?.startTag || !location.endTag) return null;
    lines.push(decodeText(source.slice(location.startTag.endOffset, location.endTag.startOffset)));
  }
  return lines;
}

/**
 * Replaces the text of a container's child wrapper elements from a list of
 * lines (one per child), preserving each child's tag and attributes. Extra lines
 * clone the last child's tag/attributes; missing lines drop the trailing child.
 * This lets a heading split into styled <span> lines be retyped as a whole
 * without losing per-span styling — and never rewrites the rest of the file.
 */
export function patchContainerLines(source: string, path: string, lines: string[]) {
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const node = findNode(parsed, path);
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) throw new Error('Este elemento não pode ter o texto editado em conjunto.');
  const children = elementChildren(node);
  if (!children.length) throw new Error('Este elemento não possui segmentos de texto.');
  const templates = children.map(child => {
    const childLocation = child.sourceCodeLocation;
    if (elementChildren(child).length || !childLocation?.startTag || !childLocation.endTag) {
      throw new Error('Há elementos aninhados; edite este bloco pelo código.');
    }
    return {
      open: source.slice(childLocation.startTag.startOffset, childLocation.startTag.endOffset),
      close: source.slice(childLocation.endTag.startOffset, childLocation.endTag.endOffset),
    };
  });
  const firstStart = children[0].sourceCodeLocation!.startOffset;
  const firstLineStart = source.lastIndexOf('\n', firstStart - 1) + 1;
  const childIndentation = source.slice(firstLineStart, firstStart).match(/^\s*/)?.[0] || '';
  const parentLineStart = source.lastIndexOf('\n', location.startOffset - 1) + 1;
  const parentIndentation = source.slice(parentLineStart, location.startOffset).match(/^\s*/)?.[0] || '';
  const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const inner = lines.length
    ? `\n${lines.map((line, index) => {
      const template = templates[Math.min(index, templates.length - 1)];
      return `${childIndentation}${template.open}${escapeText(line)}${template.close}`;
    }).join('\n')}\n${parentIndentation}`
    : '';
  return source.slice(0, location.startTag.endOffset) + inner + source.slice(location.endTag.startOffset);
}

export function patchElementAttribute(source: string, path: string, name: string, value: string) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const location = node.sourceCodeLocation;
  if (!location?.startTag) throw new Error('Não foi possível localizar o atributo no arquivo.');
  const normalizedName = name.toLowerCase();
  const existing = location.attrs?.[normalizedName];
  // An explicit empty alt is meaningful: it marks a decorative image for
  // assistive technology. Other empty inspector values retain the existing
  // convention of removing the authored attribute.
  const preservesEmptyValue = normalizedName === 'alt' && ['img', 'area'].includes(nodeTag(node));
  if (!value && !preservesEmptyValue) {
    if (!existing) return source;
    let start = existing.startOffset;
    if (/\s/.test(source[start - 1] || '')) start--;
    return source.slice(0, start) + source.slice(existing.endOffset);
  }
  const replacement = `${name}="${escapeAttribute(value)}"`;
  if (existing) {
    return source.slice(0, existing.startOffset) + replacement + source.slice(existing.endOffset);
  }
  const insertion = source[location.startTag.endOffset - 2] === '/'
    ? location.startTag.endOffset - 2
    : location.startTag.endOffset - 1;
  return source.slice(0, insertion) + ` ${replacement}` + source.slice(insertion);
}

/**
 * Hides a layer from Design without changing the visibility of the published
 * element. The marker remains in the editable source so the Navigator can
 * restore the layer after the canvas stops painting it.
 */
export function patchElementBuilderHidden(
  source: string,
  path: string,
  hidden: boolean,
) {
  return patchElementAttribute(
    source,
    path,
    BUILDER_HIDDEN_ATTRIBUTE,
    hidden ? 'true' : '',
  );
}

/**
 * Atomically patches one declaration against the latest authored style
 * attribute. Keeping this at the source-patcher boundary prevents consecutive
 * canvas commands from rebuilding the attribute from an older render snapshot.
 */
export function patchElementStyleDeclaration(
  source: string,
  path: string,
  property: string,
  value: string,
  options: StyleDeclarationWriteOptions = {},
) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const style = node.attrs?.find(attribute => attribute.name.toLowerCase() === 'style')?.value || '';
  const declarations = writeStyleDeclarationDetails(
    parseStyleDeclarationDetails(style),
    property,
    value,
    options,
  );
  return patchElementAttribute(source, path, 'style', serializeStyleDeclarationDetails(declarations));
}

/**
 * Materializes the positioning context used by one or more absolutely
 * positioned children.
 *
 * The canvas can resolve a parent's `position: relative` from a linked rule,
 * while the published WordPress page also receives later plugin/theme styles.
 * Persisting the intended context inline keeps px, percentage and other inset
 * values anchored to the same parent in both surfaces. Existing non-static
 * inline positioning (absolute/fixed/sticky) is already a valid containing
 * block and is never replaced.
 */
export function ensureAbsoluteParentPositioningContext(
  source: string,
  childPaths: string[],
) {
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const parentPaths = Array.from(new Set(childPaths.map(path => {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return null;
    parts.pop();
    return parts.join('/');
  }).filter((path): path is string => path !== null)));

  const needsRelative = parentPaths.flatMap((path) => {
    const parent = findNode(parsed, path);
    const style = parent.attrs?.find(attribute => attribute.name.toLowerCase() === 'style')?.value || '';
    const authoredPosition = parseStyleDeclarationDetails(style).position;
    const position = (authoredPosition?.value || '').trim().toLowerCase();
    return ['relative', 'absolute', 'fixed', 'sticky'].includes(position)
      ? []
      : [{ path, authoritative: Boolean(authoredPosition?.important) }];
  });

  return needsRelative.reduce(
    (next, context) => patchElementStyleDeclaration(
      next,
      context.path,
      'position',
      'relative',
      { authoritative: context.authoritative },
    ),
    source,
  );
}

const HIDDEN_DISPLAY_BACKUP_ATTRIBUTE = 'data-kodety-hidden-display';
const HIDDEN_DISPLAY_UNSET = '__kodety_unset__';

/**
 * Applies the layer visibility command to an attribute snapshot.
 *
 * The HTML `hidden` attribute alone is not sufficient for an editor: imported
 * legacy sites can contain prioritized display declarations. Project loading
 * removes that priority, so visibility can persist a normal marked inline
 * `display: none` declaration as the canonical command.
 *
 * The previous inline display is kept in a private marker so Show restores the
 * exact layout mode instead of silently changing flex/grid/inline semantics.
 * A second Hide is idempotent and never replaces that backup with `none`.
 */
export function applyElementVisibilityAttributes(
  attributes: Record<string, string>,
  visible: boolean,
) {
  const next = { ...attributes };
  const styles = parseStyleDeclarations(next.style || '');
  const backup = next[HIDDEN_DISPLAY_BACKUP_ATTRIBUTE];

  if (!visible) {
    if (backup === undefined) {
      const authoredDisplay = styles.display || '';
      next[HIDDEN_DISPLAY_BACKUP_ATTRIBUTE] =
        authoredDisplay && !/^none(?:\s*!important)?$/i.test(authoredDisplay.trim())
          ? authoredDisplay
          : HIDDEN_DISPLAY_UNSET;
    }
    next.hidden = 'hidden';
    next['aria-hidden'] = 'true';
    next.style = serializeStyleDeclarations(writeStyleDeclaration(
      styles,
      'display',
      'none',
      { authoritative: true },
    ));
    return next;
  }

  delete next.hidden;
  delete next['aria-hidden'];
  delete next[HIDDEN_DISPLAY_BACKUP_ATTRIBUTE];
  if (backup !== undefined) {
    next.style = serializeStyleDeclarations(writeStyleDeclaration(
      styles,
      'display',
      backup === HIDDEN_DISPLAY_UNSET ? '' : backup,
      { preservePriority: true },
    ));
  } else if (/^none(?:\s*!important)?$/i.test((styles.display || '').trim())) {
    // Legacy projects may have the visibility override without the backup
    // marker. Show must still clear that stale display:none.
    next.style = serializeStyleDeclarations(writeStyleDeclaration(styles, 'display', ''));
  } else {
    next.style = serializeStyleDeclarations(styles);
  }
  if (!next.style) delete next.style;
  return next;
}

/** Atomically persists Hide/Show against the latest source node. */
export function patchElementVisibility(source: string, path: string, visible: boolean) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const attributes = Object.fromEntries(
    (node.attrs || []).map(attribute => [attribute.name.toLowerCase(), attribute.value]),
  );
  const nextAttributes = applyElementVisibilityAttributes(attributes, visible);
  return patchElementAttributes(source, path, {
    hidden: nextAttributes.hidden || '',
    'aria-hidden': nextAttributes['aria-hidden'] || '',
    [HIDDEN_DISPLAY_BACKUP_ATTRIBUTE]: nextAttributes[HIDDEN_DISPLAY_BACKUP_ATTRIBUTE] || '',
    style: nextAttributes.style || '',
  });
}

/**
 * Applies one logical attribute mutation to an element. CMS connections often
 * need to add the current binding and remove legacy attributes together; doing
 * that from a single source snapshot prevents partial bindings when React
 * remounts the inspector after the first attribute changes.
 */
export function patchElementAttributes(source: string, path: string, changes: Record<string, string>) {
  return Object.entries(changes).reduce(
    (next, [name, value]) => patchElementAttribute(next, path, name, value),
    source,
  );
}

const STALE_IMAGE_SOURCE_ATTRIBUTES = [
  'srcset',
  'data-src',
  'data-srcset',
  'data-lazy-src',
  'data-lazy-srcset',
  'data-original',
  'data-original-src',
];

const IMAGE_PLACEHOLDER_BACKGROUND_PROPERTIES = ['background', 'background-image'] as const;

/** Returns only inline background declarations owned by the empty-image placeholder. */
export function imagePlaceholderBackgroundProperties(style: string) {
  const declarations = parseStyleDeclarationDetails(style || '');
  return IMAGE_PLACEHOLDER_BACKGROUND_PROPERTIES.filter(property => (
    /\brepeating-linear-gradient\s*\(/i.test(declarations[property]?.value || '')
  ));
}

/** Removes the striped empty-image paint without touching sizing, fit or authored backgrounds. */
export function clearImagePlaceholderBackgroundStyle(style: string) {
  const properties = imagePlaceholderBackgroundProperties(style);
  if (!properties.length) return style;
  const declarations = properties.reduce(
    (next, property) => writeStyleDeclarationDetails(next, property, ''),
    parseStyleDeclarationDetails(style || ''),
  );
  return serializeStyleDeclarationDetails(declarations);
}

/**
 * Replaces the source the browser actually renders, rather than only the
 * fallback `src`. Imported Webflow/code images frequently retain `srcset` or
 * lazy-load attributes, and a surrounding `<picture>` can win over the img
 * source entirely. Clearing those stale candidates makes an inspector change
 * deterministic while preserving the picture/source nodes themselves.
 */
export function patchMediaSource(source: string, path: string, value: string) {
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const node = findNode(parsed, path);
  const tag = node.tagName?.toLowerCase();
  if (tag !== 'img') return patchElementAttribute(source, path, 'src', value);

  const staleSourceReset = Object.fromEntries(STALE_IMAGE_SOURCE_ATTRIBUTES.map(name => [name, '']));
  const imageReset = { ...staleSourceReset };
  if (value) {
    imageReset['data-kodety-empty-image'] = '';
    const ariaLabel = nodeAttribute(node, 'aria-label') || '';
    if (nodeAttribute(node, 'data-kodety-empty-image') !== undefined || /placeholder/i.test(ariaLabel)) {
      imageReset['aria-label'] = '';
    }
    const currentStyle = nodeAttribute(node, 'style') || '';
    const cleanedStyle = clearImagePlaceholderBackgroundStyle(currentStyle);
    if (cleanedStyle !== currentStyle) imageReset.style = cleanedStyle;
  }
  let next = patchElementAttributes(source, path, { src: value, ...imageReset });

  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return next;
  const parentPath = parts.slice(0, -1).join('/');
  const parent = findNode(parsed, parentPath);
  if (parent.tagName?.toLowerCase() !== 'picture') return next;

  elementChildren(parent).forEach((child, index) => {
    if (child.tagName?.toLowerCase() !== 'source') return;
    const sourcePath = parentPath ? `${parentPath}/${index}` : String(index);
    next = patchElementAttributes(next, sourcePath, {
      src: '',
      ...staleSourceReset,
    });
  });
  return next;
}

function parsedAttribute(node: ParsedNode, name: string) {
  return node.attrs?.find(attribute => attribute.name.toLowerCase() === name.toLowerCase())?.value;
}

/**
 * Selects the visual model repeated by a CMS collection without serializing the
 * collection subtree. Only the relevant attributes are patched, so authored
 * whitespace, scripts and animation markup remain byte-for-byte intact.
 * Nested collections are deliberately isolated: their model marker belongs to
 * them and must never be removed when the outer collection changes.
 */
export function patchCollectionModel(source: string, collectionPath: string, modelPath: string | null) {
  const collectionParts = pathParts(collectionPath);
  const modelParts = modelPath ? pathParts(modelPath) : null;
  if (modelParts && (!startsWithPath(modelParts, collectionParts) || modelParts.length <= collectionParts.length)) {
    throw new Error('Selecione uma layer interna desta coleção para repetir.');
  }

  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const collection = findNode(parsed, collectionPath);
  if (!parsedAttribute(collection, 'data-kodety-collection')) {
    throw new Error('O contêiner da coleção não foi encontrado.');
  }

  const markerPaths: string[] = [];
  let modelIsDirectChildOfCollection = !modelParts;
  const visit = (node: ParsedNode, parts: number[]) => {
    elementChildren(node).forEach((child, index) => {
      const childParts = [...parts, index];
      // A nested collection owns all of its descendants and markers.
      if (parsedAttribute(child, 'data-kodety-collection')) return;
      if (parsedAttribute(child, 'data-kodety-collection-item') !== undefined) {
        markerPaths.push(serializePath(childParts));
      }
      if (modelParts && serializePath(childParts) === serializePath(modelParts)) {
        modelIsDirectChildOfCollection = true;
      }
      visit(child, childParts);
    });
  };
  visit(collection, collectionParts);

  if (modelParts && !modelIsDirectChildOfCollection) {
    throw new Error('Esta layer pertence a uma coleção aninhada. Selecione uma layer da coleção atual.');
  }

  let next = source;
  markerPaths.forEach(path => { next = patchElementAttribute(next, path, 'data-kodety-collection-item', ''); });
  next = patchElementAttribute(next, collectionPath, 'data-kodety-repeat', modelPath ? 'child' : 'self');
  if (modelPath) next = patchElementAttribute(next, modelPath, 'data-kodety-collection-item', 'true');
  return next;
}

/**
 * Renames only the tag itself (`<div ...>` → `<section ...>`), preserving
 * every attribute, all children and their exact formatting — a semantic
 * "change element type" that never touches anything inside the element.
 * Void elements (no closing tag, e.g. `<img>`) are rejected: swapping their
 * tag would silently change void-ness with nothing to reconcile.
 */
export function patchElementTag(source: string, path: string, newTag: string) {
  if (!/^[a-z][a-z0-9-]*$/i.test(newTag)) throw new Error('Informe uma tag HTML válida.');
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const context = findNodeContext(parsed, path);
  const node = context.node;
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) throw new Error('Este elemento não pode ter a tag alterada.');
  const normalizedTag = newTag.toLowerCase();
  if (nodeTag(node) === normalizedTag) return source;
  if (HTML_VOID_ELEMENTS.has(normalizedTag)) {
    throw new Error(`A tag <${normalizedTag}> não pode substituir um elemento com conteúdo.`);
  }
  if (!context.parent) throw new Error('A tag Body não pode ser alterada.');
  const index = meaningfulChildren(context.parent).indexOf(node);
  if (index < 0) throw new Error('Não foi possível localizar este elemento no pai atual.');
  assertValidHtmlPlacement(
    context.parent,
    context.ancestors.slice(0, -1),
    index,
    1,
    [virtualElement(normalizedTag, node.childNodes || [], node.attrs)],
  );
  // Splice the end tag first: its offset is unaffected by the start-tag edit
  // (which comes earlier in the string) only as long as we apply it AFTER —
  // editing end-to-start means every offset used stays valid against the
  // string it's read from.
  const endText = source.slice(location.endTag.startOffset, location.endTag.endOffset);
  const newEndText = endText.replace(/^<\/[a-zA-Z][a-zA-Z0-9-]*/, `</${normalizedTag}`);
  let result = source.slice(0, location.endTag.startOffset) + newEndText + source.slice(location.endTag.endOffset);
  const startText = source.slice(location.startTag.startOffset, location.startTag.endOffset);
  const newStartText = startText.replace(/^<[a-zA-Z][a-zA-Z0-9-]*/, `<${normalizedTag}`);
  result = result.slice(0, location.startTag.startOffset) + newStartText + result.slice(location.startTag.endOffset);
  return result;
}

const NON_VISUAL_INSERT_TAGS = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'noscript', 'template', 'br']);
let insertionClassSequence = 0;

/**
 * Give every new editable layer a class before it reaches either the source or
 * the live canvas. Existing classes and all non-class markup stay untouched.
 * Component node identities keep missing classes consistent across variants;
 * ordinary inserts receive a fresh namespace independent of structural paths.
 */
export function ensureInsertedElementClasses(markup: string, componentId = '') {
  const fragment = parseFragment(markup, { sourceCodeLocationInfo: true }) as ParsedNode;
  const nodes: ParsedNode[] = [];
  const visit = (node: ParsedNode) => {
    const tag = nodeTag(node);
    if (NON_VISUAL_INSERT_TAGS.has(tag)) return;
    if (tag && node.sourceCodeLocation?.startTag) nodes.push(node);
    // The Designer exposes an SVG as one layer, not its drawing primitives.
    if (tag !== 'svg') elementChildren(node).forEach(visit);
  };
  elementChildren(fragment).forEach(visit);
  const missing = nodes.filter(node => !nodeAttribute(node, 'class')?.trim());
  if (!missing.length) return markup;

  const namespace = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
    || `${Date.now().toString(36)}-${(++insertionClassSequence).toString(36)}`;
  const reserved = new Set(nodes.flatMap(node => (nodeAttribute(node, 'class') || '').split(/\s+/).filter(Boolean)));
  const patches = missing.map((node, index) => {
    const tag = nodeTag(node);
    const componentNode = nodeAttribute(node, 'data-kodety-component-node') || '';
    const label = (componentNode ? tag : nodeAttribute(node, 'data-label') || tag)
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || tag;
    const identity = componentNode
      ? [componentId, componentNode].filter(Boolean).join('-').replace(/[^a-zA-Z0-9_-]+/g, '-')
      : `${namespace}-${index + 1}`;
    const base = `incode-${label}-${identity}`;
    let className = base;
    let suffix = 2;
    while (reserved.has(className)) className = `${base}-${suffix++}`;
    reserved.add(className);

    const location = node.sourceCodeLocation!;
    const existing = location.attrs?.class;
    if (existing) return { start: existing.startOffset, end: existing.endOffset, text: `class="${className}"` };
    // Insert after the tag name, so even an unquoted attribute immediately
    // before a void-element slash remains byte-for-byte intact.
    const startTag = location.startTag!;
    const nameLength = markup.slice(startTag.startOffset, startTag.endOffset).match(/^<[^\s/>]+/)?.[0].length || 0;
    const start = startTag.startOffset + nameLength;
    return { start, end: start, text: ` class="${className}"` };
  });
  const parts: string[] = [];
  let offset = 0;
  patches.sort((a, b) => a.start - b.start).forEach(patch => {
    parts.push(markup.slice(offset, patch.start), patch.text);
    offset = patch.end;
  });
  parts.push(markup.slice(offset));
  return parts.join('');
}

export function patchInsertElement(source: string, parentPath: string | null, markup: string) {
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const parentContext = findNodeContext(parsed, parentPath || '');
  const parent = parentContext.node;
  const location = parent.sourceCodeLocation;
  if (!location?.endTag) throw new Error('Não foi possível inserir um elemento neste local.');
  const insertedNodes = parseInsertedMarkup(markup);
  assertValidHtmlPlacement(
    parent,
    parentContext.ancestors,
    meaningfulChildren(parent).length,
    0,
    insertedNodes,
  );
  const depth = parentPath ? parentPath.split('/').filter(Boolean).length + 1 : 1;
  const indentation = '  '.repeat(depth);
  return source.slice(0, location.endTag.startOffset)
    + `\n${indentation}${markup}`
    + source.slice(location.endTag.startOffset);
}

export function getElementChildCount(source: string, parentPath: string | null) {
  const parsed = parse(source, { sourceCodeLocationInfo: false }) as ParsedNode;
  const html = elementChildren(parsed).find(node => node.tagName === 'html');
  const body = html && elementChildren(html).find(node => node.tagName === 'body');
  const parent = parentPath ? findNode(parsed, parentPath) : body;
  if (!parent) throw new Error('Não foi possível localizar o elemento pai.');
  return elementChildren(parent).length;
}

export function patchRemoveElement(source: string, path: string) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const location = node.sourceCodeLocation;
  if (!location) throw new Error('Não foi possível localizar o elemento no arquivo.');
  let start = location.startOffset;
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--;
  if (start > 0 && source[start - 1] === '\n') start--;
  const removedMarkup = source.slice(location.startOffset, location.endOffset);
  let next = source.slice(0, start) + source.slice(location.endOffset);
  const animationIds = Array.from(removedMarkup.matchAll(/\bdata-incode-animation-id=["']([^"']+)["']/gi), match => match[1]);
  animationIds.forEach(animationId => {
    const escaped = animationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`\\s*<script\\b[^>]*data-incode-gsap=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/script>`, 'gi'), '');
  });
  return next;
}

function uniqueDuplicateId(base: string, reserved: Set<string>) {
  const stem = `${base}-copy`;
  let candidate = stem;
  let suffix = 2;
  while (reserved.has(candidate)) candidate = `${stem}-${suffix++}`;
  reserved.add(candidate);
  return candidate;
}

/**
 * Makes copied markup safe to insert into the same document. DOM ids and all
 * common id references are rewritten together, while editor animation ids are
 * removed so a duplicate does not accidentally control the original timeline.
 */
export function prepareDuplicatedMarkup(source: string, markup: string) {
  const reserved = new Set(Array.from(source.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi), match => match[1]));
  const idMap = new Map<string, string>();
  for (const match of markup.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)) {
    if (!idMap.has(match[1])) idMap.set(match[1], uniqueDuplicateId(match[1], reserved));
  }
  const reservedComponentInstanceIds = new Set(Array.from(
    source.matchAll(/\sdata-kodety-component-instance\s*=\s*["']([^"']+)["']/gi),
    match => match[1],
  ));

  let next = markup
    .replace(/\sdata-incode-animation-id\s*=\s*["'][^"']+["']/gi, '')
    .replace(/\sdata-incode-motion-id\s*=\s*["'][^"']+["']/gi, '')
    .replace(/\sdata-kodety-interaction-id\s*=\s*["'][^"']+["']/gi, '')
    // Imported Framer nodes use these IDs to map authored DOM back onto the
    // hydrated React tree. A duplicate is a new authored subtree and must not
    // share the original IDs, or both sections would target the same runtime
    // nodes. Without the markers the compatibility bridge records the copy as
    // one self-contained addition and keeps it across future re-renders.
    .replace(/\sdata-kodety-framer-(?:node|added)\s*=\s*["'][^"']+["']/gi, '');

  next = next.replace(/(\sid\s*=\s*)(["'])([^"']+)(\2)/gi, (full, prefix: string, quote: string, value: string) => {
    const replacement = idMap.get(value);
    return replacement ? `${prefix}${quote}${replacement}${quote}` : full;
  });
  // Instance ids are also selector identities for component interactions.
  // A copied root (and every nested instance inside it) must get a fresh id so
  // an event authored for the original never controls both copies.
  next = next.replace(
    /(\sdata-kodety-component-instance\s*=\s*)(["'])([^"']+)(\2)/gi,
    (full, prefix: string, quote: string, value: string) => {
      const replacement = uniqueDuplicateId(value, reservedComponentInstanceIds);
      return `${prefix}${quote}${replacement}${quote}`;
    },
  );

  const tokenReferenceAttributes = 'for|aria-controls|aria-labelledby|aria-describedby|aria-owns|aria-activedescendant|headers|data-kodety-overlay-target|data-kodety-overlay-open|data-kodety-overlay-close|data-kodety-overlay-toggle|data-kodety-overlay-trigger';
  next = next.replace(new RegExp(`(\\s(?:${tokenReferenceAttributes})\\s*=\\s*)(["'])([^"']*)(\\2)`, 'gi'),
    (full, prefix: string, quote: string, value: string) => {
      const replaced = value.split(/\s+/).map(token => idMap.get(token) || token).join(' ');
      return `${prefix}${quote}${replaced}${quote}`;
    });

  const hashReferenceAttributes = 'href|xlink:href|data-target|data-bs-target';
  next = next.replace(new RegExp(`(\\s(?:${hashReferenceAttributes})\\s*=\\s*)(["'])#([^"']+)(\\2)`, 'gi'),
    (full, prefix: string, quote: string, value: string) => {
      const replacement = idMap.get(value);
      return replacement ? `${prefix}${quote}#${replacement}${quote}` : full;
    });

  // SVG masks, gradients and clip paths commonly reference ids through
  // url(#id) in style/presentation attributes.
  for (const [currentId, nextId] of idMap) {
    const escaped = currentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`url\\(\\s*#${escaped}\\s*\\)`, 'g'), `url(#${nextId})`);
  }
  return next;
}

export function patchDuplicateElement(source: string, path: string) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const location = node.sourceCodeLocation;
  if (!location) throw new Error('Não foi possível localizar o elemento no arquivo.');
  const markup = prepareDuplicatedMarkup(source, source.slice(location.startOffset, location.endOffset));
  const lineStart = source.lastIndexOf('\n', location.startOffset - 1) + 1;
  const indentation = source.slice(lineStart, location.startOffset).match(/^\s*/)?.[0] || '';
  return source.slice(0, location.endOffset)
    + `\n${indentation}${markup}`
    + source.slice(location.endOffset);
}

export function getElementOuterHtml(source: string, path: string) {
  const snapshot = inspectSourceDocument(source).byPath.get(path);
  if (!snapshot) throw new Error('Não foi possível copiar este elemento.');
  return source.slice(snapshot.startOffset, snapshot.endOffset);
}

/** Read the authored root attribute without reparsing its entire subtree. */
export function readSourceElementInlineStyles(
  source: string,
  path: string | undefined,
  runtimeStyle = '',
) {
  const snapshot = path === undefined ? undefined : inspectSourceDocument(source).byPath.get(path);
  // An existing source node with no style is authoritative too. Falling back
  // in that case would resurrect styles from a delayed iframe snapshot.
  return parseStyleDeclarations(snapshot ? snapshot.attributes.style || '' : runtimeStyle);
}

export function patchReplaceElementOuterHtml(source: string, path: string, markup: string) {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const location = node.sourceCodeLocation;
  if (!location) throw new Error('Não foi possível localizar este elemento.');
  return source.slice(0, location.startOffset) + markup + source.slice(location.endOffset);
}

/** Replace several non-overlapping elements with a single source parse. */
export function patchReplaceElementsOuterHtml(
  source: string,
  replacements: Array<{ path: string; markup: string }>,
) {
  if (!replacements.length) return source;
  const document = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const edits = replacements.map(replacement => {
    const location = findNode(document, replacement.path).sourceCodeLocation;
    if (!location) throw new Error('Não foi possível localizar um elemento do componente.');
    return {
      startOffset: location.startOffset,
      endOffset: location.endOffset,
      markup: replacement.markup,
    };
  });
  return patchReplaceLocatedElementsOuterHtml(source, edits);
}

/** Splice snapshots returned by inspectSourceElements without reparsing. */
export function patchReplaceLocatedElementsOuterHtml(
  source: string,
  replacements: Array<{ startOffset: number; endOffset: number; markup: string }>,
) {
  if (!replacements.length) return source;
  const edits = replacements.slice().sort((left, right) => right.startOffset - left.startOffset);
  let next = source;
  let previousStart = source.length;
  edits.forEach(edit => {
    if (
      !Number.isSafeInteger(edit.startOffset)
      || !Number.isSafeInteger(edit.endOffset)
      || edit.startOffset < 0
      || edit.endOffset < edit.startOffset
      || edit.endOffset > source.length
      || edit.endOffset > previousStart
    ) {
      throw new Error('As substituições de componentes não podem se sobrepor.');
    }
    next = next.slice(0, edit.startOffset) + edit.markup + next.slice(edit.endOffset);
    previousStart = edit.startOffset;
  });
  return next;
}

export function patchInsertAdjacentElement(
  source: string,
  targetPath: string,
  markup: string,
  position: Exclude<ElementDropPosition, 'inside'> = 'after',
): InsertElementResult {
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const context = findNodeContext(parsed, targetPath);
  const node = context.node;
  const location = node.sourceCodeLocation;
  if (!location) throw new Error('Não foi possível localizar o ponto de inserção.');
  if (!context.parent) throw new Error('Não é possível inserir uma layer ao lado do Body.');
  const siblingIndex = meaningfulChildren(context.parent).indexOf(node);
  if (siblingIndex < 0) throw new Error('Não foi possível localizar o ponto de inserção no pai atual.');
  assertValidHtmlPlacement(
    context.parent,
    context.ancestors.slice(0, -1),
    siblingIndex + (position === 'after' ? 1 : 0),
    0,
    parseInsertedMarkup(markup),
  );
  const parts = pathParts(targetPath);
  const index = parts.at(-1) ?? 0;
  const nextPath = serializePath([...parts.slice(0, -1), index + (position === 'after' ? 1 : 0)]);
  const lineStart = source.lastIndexOf('\n', location.startOffset - 1) + 1;
  const indentation = source.slice(lineStart, location.startOffset).match(/^\s*/)?.[0] || '';
  const offset = position === 'before'
    ? (/^\s*$/.test(source.slice(lineStart, location.startOffset)) ? lineStart : location.startOffset)
    : location.endOffset;
  const insertion = position === 'before'
    ? `${indentation}${markup}\n`
    : `\n${indentation}${markup}`;
  return { source: source.slice(0, offset) + insertion + source.slice(offset), path: nextPath };
}

export function patchWrapElement(source: string, path: string, tag = 'div'): MoveElementResult {
  if (!/^[a-z][a-z0-9-]*$/i.test(tag)) throw new Error('Informe uma tag HTML válida.');
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const { context, normalizedTag } = validateWrapper(parsed, path, tag);
  const node = context.node;
  const location = node.sourceCodeLocation;
  if (!location) throw new Error('Não foi possível envolver este elemento.');
  const markup = source.slice(location.startOffset, location.endOffset);
  const lineStart = source.lastIndexOf('\n', location.startOffset - 1) + 1;
  const indentation = source.slice(lineStart, location.startOffset).match(/^\s*/)?.[0] || '';
  const childIndentation = `${indentation}  `;
  const indentedMarkup = markup.replaceAll('\n', `\n${childIndentation}`);
  const wrapped = `<${normalizedTag}>\n${childIndentation}${indentedMarkup}\n${indentation}</${normalizedTag}>`;
  return {
    source: source.slice(0, location.startOffset) + wrapped + source.slice(location.endOffset),
    path,
  };
}

export function patchWrapElementWithAnchor(
  source: string,
  path: string,
  href: string,
  newTab = false,
  useNativeStyle = false,
): MoveElementResult {
  if (!href.trim()) throw new Error('Informe o destino do link.');
  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const { context } = validateWrapper(parsed, path, 'a', [
    { name: 'href', value: href.trim() },
    ...(newTab ? [{ name: 'target', value: '_blank' }, { name: 'rel', value: 'noopener noreferrer' }] : []),
  ]);
  const node = context.node;
  const location = node.sourceCodeLocation;
  if (!location) throw new Error('Não foi possível envolver este elemento com um link.');
  const markup = source.slice(location.startOffset, location.endOffset);
  const neutralStyle = useNativeStyle
    ? ''
    : ' data-kodety-neutral-link="true"';
  const attributes = `href="${escapeAttribute(href.trim())}"${newTab ? ' target="_blank" rel="noopener noreferrer"' : ''}${neutralStyle}`;
  return {
    source: source.slice(0, location.startOffset) + `<a ${attributes}>${markup}</a>` + source.slice(location.endOffset),
    path,
  };
}

export function patchUnwrapElement(source: string, path: string): MoveElementResult {
  const node = findNode(parse(source, { sourceCodeLocationInfo: true }) as ParsedNode, path);
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) throw new Error('Este elemento não pode ser desembrulhado.');
  let inner = source.slice(location.startTag.endOffset, location.endTag.startOffset);
  if (!inner.trim()) throw new Error('O elemento não possui conteúdo para preservar.');
  inner = inner.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
  const lineStart = source.lastIndexOf('\n', location.startOffset - 1) + 1;
  const indentation = source.slice(lineStart, location.startOffset).match(/^\s*/)?.[0] || '';
  const childIndentation = `${indentation}  `;
  inner = inner.split(/\r?\n/).map(line => line.startsWith(childIndentation) ? line.slice(2) : line).join('\n');
  return {
    source: source.slice(0, location.startOffset) + inner + source.slice(location.endOffset),
    path,
  };
}

function pathParts(path: string) {
  return path.split('/').filter(Boolean).map(Number);
}

function serializePath(parts: number[]) {
  return parts.join('/');
}

function startsWithPath(path: number[], prefix: number[]) {
  return prefix.every((part, index) => path[index] === part);
}

/**
 * Moves one element without serializing the full document. Only the source
 * slice belonging to the moved element is removed and reinserted, preserving
 * comments, attribute formatting, scripts and all unrelated author markup.
 */
export function patchMoveElement(source: string, sourcePath: string, targetPath: string, position: ElementDropPosition): MoveElementResult {
  if (sourcePath === targetPath) return { source, path: sourcePath };
  if (targetPath.startsWith(`${sourcePath}/`)) throw new Error('Uma layer não pode ser movida para dentro dela mesma.');

  const parsed = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  const sourceNode = findNode(parsed, sourcePath);
  const targetNode = findNode(parsed, targetPath);
  const sourceLocation = sourceNode.sourceCodeLocation;
  const targetLocation = targetNode.sourceCodeLocation;
  if (!sourceLocation || !targetLocation) throw new Error('Não foi possível localizar as layers no HTML.');
  if (position === 'inside' && !targetLocation.endTag) throw new Error('Esta layer não pode receber elementos.');

  const sourceParts = pathParts(sourcePath);
  const targetParts = pathParts(targetPath);
  const sourceParent = sourceParts.slice(0, -1);
  const sourceIndex = sourceParts.at(-1) ?? 0;
  const rawDestinationParent = position === 'inside' ? targetParts : targetParts.slice(0, -1);
  let destinationIndex = position === 'inside'
    ? elementChildren(targetNode).length
    : (targetParts.at(-1) ?? 0) + (position === 'after' ? 1 : 0);

  // Resolve the destination path after the source node has been removed.
  const destinationParent = [...rawDestinationParent];
  if (startsWithPath(destinationParent, sourceParent) && destinationParent.length > sourceParent.length) {
    const affectedIndex = destinationParent[sourceParent.length];
    if (affectedIndex > sourceIndex) destinationParent[sourceParent.length] = affectedIndex - 1;
  }
  if (serializePath(sourceParent) === serializePath(rawDestinationParent) && sourceIndex < destinationIndex) destinationIndex--;
  const nextPathParts = [...destinationParent, destinationIndex];

  let removalStart = sourceLocation.startOffset;
  const sourceLineStart = source.lastIndexOf('\n', sourceLocation.startOffset - 1) + 1;
  if (/^\s*$/.test(source.slice(sourceLineStart, sourceLocation.startOffset))) removalStart = sourceLineStart;
  let removalEnd = sourceLocation.endOffset;
  if (source[removalEnd] === '\r') removalEnd++;
  if (source[removalEnd] === '\n') removalEnd++;
  const markup = source.slice(sourceLocation.startOffset, sourceLocation.endOffset);

  let insertionOffset: number;
  let insertionText: string;
  if (position === 'before') {
    const lineStart = source.lastIndexOf('\n', targetLocation.startOffset - 1) + 1;
    const indentation = /^\s*$/.test(source.slice(lineStart, targetLocation.startOffset))
      ? source.slice(lineStart, targetLocation.startOffset)
      : '';
    insertionOffset = indentation ? lineStart : targetLocation.startOffset;
    insertionText = `${indentation}${markup}\n`;
  } else if (position === 'after') {
    const lineStart = source.lastIndexOf('\n', targetLocation.startOffset - 1) + 1;
    const indentation = source.slice(lineStart, targetLocation.startOffset).match(/^\s*/)?.[0] || '';
    insertionOffset = targetLocation.endOffset;
    insertionText = `\n${indentation}${markup}`;
  } else {
    const endTagStart = targetLocation.endTag!.startOffset;
    const closingLineStart = source.lastIndexOf('\n', endTagStart - 1) + 1;
    const parentLineStart = source.lastIndexOf('\n', targetLocation.startOffset - 1) + 1;
    const parentIndentation = source.slice(parentLineStart, targetLocation.startOffset).match(/^\s*/)?.[0] || '';
    const childIndentation = `${parentIndentation}  `;
    if (/^\s*$/.test(source.slice(closingLineStart, endTagStart))) {
      insertionOffset = closingLineStart;
      insertionText = `${childIndentation}${markup}\n`;
    } else {
      insertionOffset = endTagStart;
      insertionText = `\n${childIndentation}${markup}\n${parentIndentation}`;
    }
  }

  if (insertionOffset >= removalStart && insertionOffset <= removalEnd) return { source, path: sourcePath };
  const withoutSource = source.slice(0, removalStart) + source.slice(removalEnd);
  const adjustedOffset = insertionOffset > removalEnd ? insertionOffset - (removalEnd - removalStart) : insertionOffset;
  return {
    source: withoutSource.slice(0, adjustedOffset) + insertionText + withoutSource.slice(adjustedOffset),
    path: serializePath(nextPathParts),
    movedAttributes: Object.fromEntries(
      (sourceNode.attrs || []).map(attribute => [attribute.name.toLowerCase(), attribute.value]),
    ),
  };
}

/**
 * Returns the nearest still-existing path at or above `path`, walking up the
 * ancestor chain until `exists` accepts a candidate. Used to keep a selection
 * meaningful after code-panel edits remove or reshape the selected element:
 * instead of pointing at a stale/wrong node, selection gracefully falls back to
 * the closest surviving ancestor (worst case the body, path `''`).
 */
export function nearestExistingPath(path: string, exists: (candidate: string) => boolean): string | null {
  const parts = path.split('/').filter(Boolean);
  for (let length = parts.length; length >= 0; length--) {
    const candidate = parts.slice(0, length).join('/');
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Remaps an arbitrary element path through the same move operation. */
export function remapPathAfterMove(path: string, sourcePath: string, movedPath: string) {
  const parts = pathParts(path);
  const sourceParts = pathParts(sourcePath);
  const movedParts = pathParts(movedPath);
  const sourceParent = sourceParts.slice(0, -1);
  const sourceIndex = sourceParts.at(-1) ?? 0;

  if (startsWithPath(parts, sourceParts)) return serializePath([...movedParts, ...parts.slice(sourceParts.length)]);

  const afterRemoval = [...parts];
  if (startsWithPath(afterRemoval, sourceParent) && afterRemoval.length > sourceParent.length && afterRemoval[sourceParent.length] > sourceIndex) {
    afterRemoval[sourceParent.length]--;
  }

  const movedParent = movedParts.slice(0, -1);
  const movedIndex = movedParts.at(-1) ?? 0;
  if (startsWithPath(afterRemoval, movedParent) && afterRemoval.length > movedParent.length && afterRemoval[movedParent.length] >= movedIndex) {
    afterRemoval[movedParent.length]++;
  }
  return serializePath(afterRemoval);
}

/**
 * Remaps an arbitrary editor path after removing one authored element.
 *
 * Descendants of the removed element no longer have an address. Siblings that
 * followed it move back one slot, while every other path remains stable. This
 * is the same path transaction used by the live canvas, so a structural delete
 * does not need to navigate/reload the iframe just to obtain fresh indexes.
 */
export function remapPathAfterRemove(path: string, removedPath: string): string | null {
  const parts = pathParts(path);
  const removedParts = pathParts(removedPath);
  if (!removedParts.length) return null;
  if (startsWithPath(parts, removedParts)) return null;

  const parent = removedParts.slice(0, -1);
  const removedIndex = removedParts.at(-1) ?? 0;
  const next = [...parts];
  if (
    startsWithPath(next, parent)
    && next.length > parent.length
    && next[parent.length] > removedIndex
  ) {
    next[parent.length]--;
  }
  return serializePath(next);
}

/** Applies a batch in the same descending order used by patchRemoveElement. */
export function remapPathAfterRemovals(path: string, removedPaths: string[]): string | null {
  let next: string | null = path;
  for (const removedPath of removedPaths) {
    if (next === null) break;
    next = remapPathAfterRemove(next, removedPath);
  }
  return next;
}

/** Remaps an existing path after inserting a new sibling at `insertedPath`. */
export function remapPathAfterInsert(path: string, insertedPath: string) {
  const parts = pathParts(path);
  const insertedParts = pathParts(insertedPath);
  if (!insertedParts.length) return path;
  const parent = insertedParts.slice(0, -1);
  const insertedIndex = insertedParts.at(-1) ?? 0;
  const next = [...parts];
  if (
    startsWithPath(next, parent)
    && next.length > parent.length
    && next[parent.length] >= insertedIndex
  ) {
    next[parent.length]++;
  }
  return serializePath(next);
}

/** The wrapper takes the original address and moves the wrapped tree to child 0. */
export function remapPathAfterWrap(path: string, wrappedPath: string) {
  const parts = pathParts(path);
  const wrappedParts = pathParts(wrappedPath);
  if (!startsWithPath(parts, wrappedParts)) return path;
  return serializePath([...wrappedParts, 0, ...parts.slice(wrappedParts.length)]);
}

/**
 * Promotes an unwrapped element's children into its former sibling slot.
 * State owned by the removed wrapper disappears; following siblings advance by
 * the number of promoted authored children minus the wrapper they replace.
 */
export function remapPathAfterUnwrap(path: string, unwrappedPath: string, childCount: number): string | null {
  const parts = pathParts(path);
  const unwrappedParts = pathParts(unwrappedPath);
  if (!unwrappedParts.length || childCount < 0) return null;
  if (parts.length === unwrappedParts.length && startsWithPath(parts, unwrappedParts)) return null;
  const parent = unwrappedParts.slice(0, -1);
  const wrapperIndex = unwrappedParts.at(-1) ?? 0;
  if (startsWithPath(parts, unwrappedParts)) {
    if (childCount === 0) return null;
    const childIndex = parts[unwrappedParts.length];
    return serializePath([
      ...parent,
      wrapperIndex + childIndex,
      ...parts.slice(unwrappedParts.length + 1),
    ]);
  }
  const next = [...parts];
  if (
    startsWithPath(next, parent)
    && next.length > parent.length
    && next[parent.length] > wrapperIndex
  ) {
    next[parent.length] += childCount - 1;
  }
  return serializePath(next);
}
