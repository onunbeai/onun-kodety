import {
  parse,
  parseFragment,
  serialize,
  serializeOuter,
  type DefaultTreeAdapterTypes,
} from 'parse5';
import {
  patchElementAttribute,
  patchReplaceElementOuterHtml,
} from './source-patcher';
import {
  normalizeStylePropertyName,
  parseStyleDeclarations,
  serializeStyleDeclarations,
} from './style-utils';

export interface HtmlComponentVariantLayerOverride {
  /** Inline CSS declarations authored specifically in this variant. */
  styles?: string[];
  /** Non-style HTML attributes authored specifically in this variant. */
  attributes?: string[];
  tag?: boolean;
  content?: boolean;
  /** Direct child membership/order authored specifically in this variant. */
  children?: boolean;
  /** Responsive/state CSS declarations scoped to this variant. */
  css?: Record<string, HtmlComponentVariantCssOverride>;
}

export interface HtmlComponentVariantCssOverride {
  property: string;
  cssFilePath: string;
  selector: string;
  pseudo: string;
  breakpoint: string;
}

export type HtmlComponentVariantOverrides = Record<
  string,
  HtmlComponentVariantLayerOverride
>;

type AstDocument = DefaultTreeAdapterTypes.Document;
type AstElement = DefaultTreeAdapterTypes.Element;
type AstChild = DefaultTreeAdapterTypes.ChildNode;
type AstParent = DefaultTreeAdapterTypes.ParentNode;
type AstText = DefaultTreeAdapterTypes.TextNode;

interface IndexedElement {
  element: AstElement;
  key: string;
  path: string;
  parentKey: string;
  depth: number;
}

interface ParsedComponentSource {
  document: AstDocument;
  byKey: Map<string, IndexedElement>;
  byPath: Map<string, IndexedElement>;
}

const COMPONENT_NODE_ATTRIBUTE = 'data-kodety-component-node';
const NON_INHERITED_ATTRIBUTES = new Set([
  COMPONENT_NODE_ATTRIBUTE,
  'data-html-editor-path',
  'data-html-editor-original-style',
  'data-html-editor-leaf',
]);

function isElement(node: AstChild | AstParent): node is AstElement {
  return typeof (node as AstElement).tagName === 'string';
}

function isText(node: AstChild): node is AstText {
  return node.nodeName === '#text';
}

function elementChildren(element: AstParent) {
  return element.childNodes.filter(isElement);
}

function htmlBody(document: AstDocument) {
  const html = document.childNodes.find(isElement);
  return html ? elementChildren(html).find(element => element.tagName === 'body') || null : null;
}

function attributeValue(element: AstElement, name: string) {
  return element.attrs.find(attribute => attribute.name === name)?.value;
}

function setAttributeValue(element: AstElement, name: string, value: string | undefined) {
  const index = element.attrs.findIndex(attribute => attribute.name === name);
  if (value === undefined || value === '') {
    if (index >= 0) element.attrs.splice(index, 1);
    return;
  }
  if (index >= 0) element.attrs[index] = { ...element.attrs[index], value };
  else element.attrs.push({ name, value });
}

function elementKey(element: AstElement, path: string) {
  const id = attributeValue(element, COMPONENT_NODE_ATTRIBUTE)?.trim();
  return id ? `node:${id}` : `path:${path}`;
}

function parseComponentSource(source: string): ParsedComponentSource {
  const document = parse(source) as AstDocument;
  const body = htmlBody(document);
  const byKey = new Map<string, IndexedElement>();
  const byPath = new Map<string, IndexedElement>();
  const walk = (element: AstElement, path: string, parentKey: string, depth: number) => {
    const key = elementKey(element, path);
    const indexed = { element, key, path, parentKey, depth };
    byKey.set(key, indexed);
    byPath.set(path, indexed);
    elementChildren(element).forEach((child, index) => {
      walk(child, path ? `${path}/${index}` : String(index), key, depth + 1);
    });
  };
  if (body) {
    elementChildren(body).forEach((element, index) => {
      walk(element, String(index), '', 0);
    });
  }
  return { document, byKey, byPath };
}

function normalizedOverride(value: HtmlComponentVariantLayerOverride | undefined) {
  const styles = Array.from(new Set(value?.styles || [])).filter(Boolean).sort();
  const attributes = Array.from(new Set(value?.attributes || [])).filter(Boolean).sort();
  const css = Object.fromEntries(Object.entries(value?.css || {}).flatMap(([key, entry]) => {
    if (!key || !entry?.property || !entry.cssFilePath || !entry.selector) return [];
    return [[key, {
      property: normalizeStylePropertyName(entry.property),
      cssFilePath: entry.cssFilePath,
      selector: entry.selector,
      pseudo: entry.pseudo || 'base',
      breakpoint: entry.breakpoint || 'base',
    } satisfies HtmlComponentVariantCssOverride]];
  }));
  return {
    ...(styles.length ? { styles } : {}),
    ...(attributes.length ? { attributes } : {}),
    ...(value?.tag ? { tag: true } : {}),
    ...(value?.content ? { content: true } : {}),
    ...(value?.children ? { children: true } : {}),
    ...(Object.keys(css).length ? { css } : {}),
  } satisfies HtmlComponentVariantLayerOverride;
}

export function normalizeHtmlComponentVariantOverrides(
  value: unknown,
): HtmlComponentVariantOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      if (!key || !entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      const normalized = normalizedOverride({
        styles: Array.isArray(item.styles)
          ? item.styles.filter((name): name is string => typeof name === 'string')
          : [],
        attributes: Array.isArray(item.attributes)
          ? item.attributes.filter((name): name is string => typeof name === 'string')
          : [],
        tag: item.tag === true,
        content: item.content === true,
        children: item.children === true,
        css: item.css && typeof item.css === 'object' && !Array.isArray(item.css)
          ? Object.fromEntries(
              Object.entries(item.css as Record<string, unknown>).flatMap(([cssKey, cssValue]) => {
                if (!cssValue || typeof cssValue !== 'object' || Array.isArray(cssValue)) return [];
                const css = cssValue as Record<string, unknown>;
                return [[cssKey, {
                  property: typeof css.property === 'string' ? css.property : '',
                  cssFilePath: typeof css.cssFilePath === 'string' ? css.cssFilePath : '',
                  selector: typeof css.selector === 'string' ? css.selector : '',
                  pseudo: typeof css.pseudo === 'string' ? css.pseudo : 'base',
                  breakpoint: typeof css.breakpoint === 'string' ? css.breakpoint : 'base',
                }]];
              }),
            )
          : {},
      });
      return Object.keys(normalized).length ? [[key, normalized]] : [];
    }),
  );
}

function overrideDraft(
  overrides: HtmlComponentVariantOverrides,
  key: string,
) {
  return overrides[key] || {};
}

function setOverrideDraft(
  overrides: HtmlComponentVariantOverrides,
  key: string,
  value: HtmlComponentVariantLayerOverride,
) {
  if (!key) return;
  const normalized = normalizedOverride(value);
  if (Object.keys(normalized).length) overrides[key] = normalized;
  else delete overrides[key];
}

function attributeRecord(element: AstElement) {
  return Object.fromEntries(element.attrs.map(attribute => [attribute.name, attribute.value]));
}

function inheritableAttributeNames(left: AstElement, right: AstElement) {
  return Array.from(new Set([
    ...left.attrs.map(attribute => attribute.name),
    ...right.attrs.map(attribute => attribute.name),
  ])).filter(name => name !== 'style' && !NON_INHERITED_ATTRIBUTES.has(name));
}

function styleRecord(element: AstElement) {
  return parseStyleDeclarations(attributeValue(element, 'style') || '');
}

function directText(element: AstElement) {
  return element.childNodes.filter(isText).map(node => node.value).join('\u0000');
}

function directElementKeys(indexed: IndexedElement) {
  return elementChildren(indexed.element).map((element, index) => (
    elementKey(element, indexed.path ? `${indexed.path}/${index}` : String(index))
  ));
}

function markElementDifferences(
  reference: IndexedElement,
  variant: IndexedElement,
  overrides: HtmlComponentVariantOverrides,
) {
  const current = overrideDraft(overrides, variant.key);
  const styles = new Set(current.styles || []);
  const referenceStyles = styleRecord(reference.element);
  const variantStyles = styleRecord(variant.element);
  Array.from(new Set([...Object.keys(referenceStyles), ...Object.keys(variantStyles)]))
    .forEach(property => {
      if (referenceStyles[property] !== variantStyles[property]) styles.add(property);
    });
  const attributes = new Set(current.attributes || []);
  const referenceAttributes = attributeRecord(reference.element);
  const variantAttributes = attributeRecord(variant.element);
  inheritableAttributeNames(reference.element, variant.element).forEach(name => {
    if (referenceAttributes[name] !== variantAttributes[name]) attributes.add(name);
  });
  setOverrideDraft(overrides, variant.key, {
    ...current,
    styles: Array.from(styles),
    attributes: Array.from(attributes),
    tag: current.tag || reference.element.tagName !== variant.element.tagName,
    content: current.content || directText(reference.element) !== directText(variant.element),
    children: current.children || (
      directElementKeys(reference).join('\u0000') !== directElementKeys(variant).join('\u0000')
    ),
  });
}

/**
 * Detect authored differences and retain them as explicit override ownership.
 *
 * This is also the migration path for components created before override
 * metadata existed: their current visual differences become protected the
 * first time either the primary or that variant is edited.
 */
export function inferHtmlComponentVariantOverrides(
  referenceSource: string,
  variantSource: string,
  existing: HtmlComponentVariantOverrides = {},
) {
  const overrides = normalizeHtmlComponentVariantOverrides(existing);
  const reference = parseComponentSource(referenceSource);
  const variant = parseComponentSource(variantSource);
  variant.byKey.forEach((indexed, key) => {
    const referenceNode = reference.byKey.get(key);
    if (referenceNode) markElementDifferences(referenceNode, indexed, overrides);
    else if (indexed.parentKey) {
      const parent = overrideDraft(overrides, indexed.parentKey);
      setOverrideDraft(overrides, indexed.parentKey, { ...parent, children: true });
    }
  });
  reference.byKey.forEach((indexed, key) => {
    if (variant.byKey.has(key) || !indexed.parentKey) return;
    const parent = overrideDraft(overrides, indexed.parentKey);
    setOverrideDraft(overrides, indexed.parentKey, { ...parent, children: true });
  });
  return overrides;
}

/** Mark only what changed during an edit of a non-primary variant. */
export function recordHtmlComponentVariantEditOverrides(
  previousVariantSource: string,
  nextVariantSource: string,
  existing: HtmlComponentVariantOverrides = {},
) {
  return inferHtmlComponentVariantOverrides(
    previousVariantSource,
    nextVariantSource,
    existing,
  );
}

function cloneChild(node: AstChild): AstChild {
  const fragment = parseFragment(serializeOuter(node)) as DefaultTreeAdapterTypes.DocumentFragment;
  return fragment.childNodes[0] as AstChild;
}

function attachChildren(parent: AstElement, children: AstChild[]) {
  parent.childNodes = children;
  children.forEach(child => {
    if ('parentNode' in child) child.parentNode = parent;
  });
}

function syncDirectChildren(
  target: IndexedElement,
  source: IndexedElement,
  preserveText: boolean,
) {
  const targetElements = new Map(
    elementChildren(target.element).map((element, index) => [
      elementKey(element, target.path ? `${target.path}/${index}` : String(index)),
      element,
    ]),
  );
  const targetTexts = target.element.childNodes.filter(isText);
  let textIndex = 0;
  const children = source.element.childNodes.map(child => {
    if (isElement(child)) {
      const sourceElementIndex = elementChildren(source.element).indexOf(child);
      const key = elementKey(
        child,
        source.path ? `${source.path}/${sourceElementIndex}` : String(sourceElementIndex),
      );
      return targetElements.get(key) || cloneChild(child);
    }
    if (preserveText && isText(child) && targetTexts[textIndex]) {
      const text = targetTexts[textIndex];
      textIndex += 1;
      return text;
    }
    return cloneChild(child);
  });
  if (preserveText && textIndex < targetTexts.length) {
    children.push(...targetTexts.slice(textIndex));
  }
  attachChildren(target.element, children);
}

function syncDirectText(target: IndexedElement, source: IndexedElement) {
  const sourceTexts = source.element.childNodes.filter(isText);
  const targetTexts = target.element.childNodes.filter(isText);
  if (sourceTexts.length === targetTexts.length) {
    sourceTexts.forEach((text, index) => {
      targetTexts[index].value = text.value;
    });
    return;
  }
  syncDirectChildren(target, source, false);
}

/**
 * Apply a primary edit to one non-primary variant. Only properties without an
 * explicit variant owner are inherited. Structural synchronization reuses
 * matching child nodes, so a child color override survives when its parent
 * receives a new sibling or is reordered in the primary.
 */
export function inheritHtmlComponentPrimaryVariantEdit(
  previousPrimarySource: string,
  nextPrimarySource: string,
  variantSource: string,
  explicitOverrides: HtmlComponentVariantOverrides = {},
) {
  if (previousPrimarySource === nextPrimarySource) return variantSource;
  const overrides = normalizeHtmlComponentVariantOverrides(explicitOverrides);
  const previous = parseComponentSource(previousPrimarySource);
  const next = parseComponentSource(nextPrimarySource);
  let variant = parseComponentSource(variantSource);

  // Structure is inherited top-down before declaration merging. Matching
  // nodes are moved, not cloned, retaining every descendant override.
  Array.from(next.byKey.values())
    .sort((left, right) => left.depth - right.depth)
    .forEach(nextNode => {
      const previousNode = previous.byKey.get(nextNode.key);
      const variantNode = variant.byKey.get(nextNode.key);
      if (!previousNode || !variantNode || overrides[nextNode.key]?.children) return;
      if (directElementKeys(previousNode).join('\u0000') !== directElementKeys(nextNode).join('\u0000')) {
        syncDirectChildren(
          variantNode,
          nextNode,
          Boolean(overrides[nextNode.key]?.content),
        );
      }
    });
  variant = parseComponentSource(serialize(variant.document));

  next.byKey.forEach((nextNode, key) => {
    const previousNode = previous.byKey.get(key);
    const variantNode = variant.byKey.get(key);
    if (!previousNode || !variantNode) return;
    const ownership = overrides[key] || {};
    const ownedStyles = new Set(ownership.styles || []);
    const previousStyles = styleRecord(previousNode.element);
    const nextStyles = styleRecord(nextNode.element);
    const variantStyles = styleRecord(variantNode.element);
    Array.from(new Set([...Object.keys(previousStyles), ...Object.keys(nextStyles)]))
      .forEach(property => {
        if (previousStyles[property] === nextStyles[property] || ownedStyles.has(property)) return;
        if (nextStyles[property] === undefined) delete variantStyles[property];
        else variantStyles[property] = nextStyles[property];
      });
    setAttributeValue(
      variantNode.element,
      'style',
      serializeStyleDeclarations(variantStyles) || undefined,
    );

    const ownedAttributes = new Set(ownership.attributes || []);
    const previousAttributes = attributeRecord(previousNode.element);
    const nextAttributes = attributeRecord(nextNode.element);
    inheritableAttributeNames(previousNode.element, nextNode.element).forEach(name => {
      if (previousAttributes[name] === nextAttributes[name] || ownedAttributes.has(name)) return;
      setAttributeValue(variantNode.element, name, nextAttributes[name]);
    });
    if (!ownership.tag && previousNode.element.tagName !== nextNode.element.tagName) {
      variantNode.element.tagName = nextNode.element.tagName;
      variantNode.element.nodeName = nextNode.element.nodeName;
    }
    if (
      !ownership.content
      && directText(previousNode.element) !== directText(nextNode.element)
    ) syncDirectText(variantNode, nextNode);
  });
  return serialize(variant.document);
}

export function htmlComponentVariantNodeKeyAtPath(source: string, path: string) {
  return parseComponentSource(source).byPath.get(path)?.key || '';
}

function stableClassHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function classNamePart(value: string, fallback: string) {
  return value
    .replace(/^(?:node|path):/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || fallback;
}

function variantPropertyClassPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^--/, 'custom-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'style';
}

function variantPropertyClassPattern(property: string) {
  const prefix = `variant-${variantPropertyClassPart(property)}-`;
  return {
    prefix,
    pattern: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`),
  };
}

/** Short, semantic name for a visual override owned by a component variant. */
export function htmlComponentVariantPropertyClassName(property: string, sequence: number) {
  const { prefix } = variantPropertyClassPattern(property);
  return `${prefix}${String(Math.max(1, Math.floor(sequence) || 1)).padStart(2, '0')}`;
}

/**
 * Every visual edit in a secondary component variant owns a real reusable
 * class on that exact layer. The class name is deterministic, so repeated
 * edits reuse the same rule while the primary variant never receives it.
 */
export function htmlComponentVariantReusableClassName(
  variantId: string,
  nodeKey: string,
) {
  const identity = `${variantId}\u0000${nodeKey}`;
  return [
    'incode-variant',
    classNamePart(variantId, 'variant'),
    classNamePart(nodeKey, 'layer'),
    stableClassHash(identity),
  ].join('-');
}

/**
 * Adds or reuses the generated class for one property on one variant layer.
 * New editor calls provide `property` and receive compact semantic names;
 * omitting it retains the legacy deterministic name for saved integrations.
 */
export function ensureHtmlComponentVariantReusableClass(
  source: string,
  path: string,
  variantId: string,
  property?: string,
  reservedClassNames: Iterable<string> = [],
) {
  const parsed = parseComponentSource(source);
  const target = parsed.byPath.get(path);
  if (!target) throw new Error('A layer da variante mudou antes da edição.');
  const classes = new Set(
    (attributeValue(target.element, 'class') || '').split(/\s+/).filter(Boolean),
  );
  let className = htmlComponentVariantReusableClassName(variantId, target.key);
  if (property?.trim()) {
    const { pattern } = variantPropertyClassPattern(property);
    const existing = Array.from(classes).find(name => pattern.test(name));
    if (existing) {
      return { source, className: existing, nodeKey: target.key };
    }
    const usedNames = new Set(reservedClassNames);
    parsed.byPath.forEach(node => {
      (attributeValue(node.element, 'class') || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach(name => usedNames.add(name));
    });
    let sequence = 1;
    usedNames.forEach(name => {
      const match = name.match(pattern);
      if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
    });
    className = htmlComponentVariantPropertyClassName(property, sequence);
  }
  if (classes.has(className)) {
    return { source, className, nodeKey: target.key };
  }
  classes.add(className);
  return {
    source: patchElementAttribute(source, path, 'class', Array.from(classes).join(' ')),
    className,
    nodeKey: target.key,
  };
}

export function clearHtmlComponentVariantLayerOverride(
  overrides: HtmlComponentVariantOverrides,
  nodeKey: string,
) {
  const next = normalizeHtmlComponentVariantOverrides(overrides);
  delete next[nodeKey];
  return next;
}

export function recordHtmlComponentVariantCssOverride(
  overrides: HtmlComponentVariantOverrides,
  nodeKey: string,
  entry: HtmlComponentVariantCssOverride,
) {
  const next = normalizeHtmlComponentVariantOverrides(overrides);
  const current = next[nodeKey] || {};
  const key = [
    normalizeStylePropertyName(entry.property),
    entry.cssFilePath,
    entry.selector,
    entry.pseudo || 'base',
    entry.breakpoint || 'base',
  ].join('\u0000');
  setOverrideDraft(next, nodeKey, {
    ...current,
    css: {
      ...(current.css || {}),
      [key]: {
        ...entry,
        property: normalizeStylePropertyName(entry.property),
        pseudo: entry.pseudo || 'base',
        breakpoint: entry.breakpoint || 'base',
      },
    },
  });
  return next;
}

/** The generated secondary-variant class is owned immediately, not only when
 * the editing session later reconciles, so autosave/reload cannot let a
 * primary class change erase the isolation boundary. */
export function recordHtmlComponentVariantReusableClassOverride(
  overrides: HtmlComponentVariantOverrides,
  nodeKey: string,
) {
  const next = normalizeHtmlComponentVariantOverrides(overrides);
  const current = next[nodeKey] || {};
  setOverrideDraft(next, nodeKey, {
    ...current,
    attributes: [...(current.attributes || []), 'class'],
  });
  return next;
}

/**
 * Reset one layer to the primary while keeping independently overridden
 * descendants alive. The caller clears the matching ownership record in the
 * same project transaction.
 */
export function resetHtmlComponentVariantLayerSource(
  primarySource: string,
  variantSource: string,
  path: string,
) {
  const primary = parseComponentSource(primarySource);
  const variant = parseComponentSource(variantSource);
  const target = variant.byPath.get(path);
  const master = target ? primary.byKey.get(target.key) : undefined;
  if (!target || !master) {
    throw new Error('Esta layer não existe mais na variante primária.');
  }
  const identity = attributeValue(target.element, COMPONENT_NODE_ATTRIBUTE);
  target.element.attrs = master.element.attrs.map(attribute => ({ ...attribute }));
  if (identity) setAttributeValue(target.element, COMPONENT_NODE_ATTRIBUTE, identity);
  target.element.tagName = master.element.tagName;
  target.element.nodeName = master.element.nodeName;
  syncDirectChildren(target, master, false);
  return {
    nodeKey: target.key,
    source: patchReplaceElementOuterHtml(
      variantSource,
      path,
      serializeOuter(target.element),
    ),
  };
}
