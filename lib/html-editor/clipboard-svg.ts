import { parseFragment, serializeOuter } from 'parse5';
import { parseStyleDeclarations, serializeStyleDeclarations } from './style-utils';

export const MAX_CLIPBOARD_SVG_CHARACTERS = 384 * 1024;
const MAX_CLIPBOARD_SVG_NODES = 8_000;
const MAX_CLIPBOARD_SVG_DEPTH = 64;
const MAX_CLIPBOARD_SVG_DIMENSION = 100_000;

interface ParsedAttribute {
  name: string;
  value: string;
  prefix?: string;
}

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: ParsedAttribute[];
  childNodes?: ParsedNode[];
  parentNode?: ParsedNode;
}

type ClipboardSvgData = Pick<DataTransfer, 'files' | 'getData' | 'items' | 'types'>;

const FORBIDDEN_SVG_ELEMENTS = new Set([
  'a',
  'animate',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'audio',
  'base',
  'button',
  'canvas',
  'discard',
  'embed',
  'foreignobject',
  'form',
  'iframe',
  'image',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'select',
  'set',
  'style',
  'textarea',
  'video',
]);

// Inline icon styles are intentionally limited to SVG presentation and text
// properties. Layout/interaction CSS such as position, z-index and pointer
// events would otherwise let clipboard content cover or capture the Builder.
const SAFE_SVG_STYLE_PROPERTIES = new Set([
  'alignment-baseline',
  'baseline-shift',
  'clip-path',
  'clip-rule',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-rendering',
  'cx',
  'cy',
  'direction',
  'display',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'flood-color',
  'flood-opacity',
  'font',
  'font-family',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'height',
  'image-rendering',
  'isolation',
  'letter-spacing',
  'lighting-color',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'mix-blend-mode',
  'opacity',
  'paint-order',
  'r',
  'rx',
  'ry',
  'shape-rendering',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'transform',
  'transform-box',
  'transform-origin',
  'unicode-bidi',
  'vector-effect',
  'visibility',
  'white-space',
  'width',
  'word-spacing',
  'writing-mode',
  'x',
  'y',
]);

const URL_ATTRIBUTES = new Set([
  'action',
  'formaction',
  'href',
  'poster',
  'src',
  'srcset',
  'xlink:href',
  'xml:base',
]);

const NON_PAINT_VALUES = /^(?:none|transparent|currentcolor|inherit|context-fill|context-stroke)$/i;
const FORBIDDEN_RESOURCE_VALUE = /(?:\\|\/\*|\*\/|@import\b|(?:https?|data|blob|file|filesystem|javascript|vbscript)\s*:|image-set\s*\(|cross-fade\s*\(|element\s*\(|paint\s*\(|src\s*\(|attr\s*\(|var\s*\()/i;
let svgIdSequence = 0;

function attributeName(attribute: ParsedAttribute) {
  return `${attribute.prefix ? `${attribute.prefix}:` : ''}${attribute.name}`.toLowerCase();
}

function attributeValue(element: ParsedNode, name: string) {
  return element.attrs?.find(attribute => attributeName(attribute) === name.toLowerCase())?.value || '';
}

function setAttributeValue(element: ParsedNode, name: string, value: string) {
  const existing = element.attrs?.find(attribute => attributeName(attribute) === name.toLowerCase());
  if (existing) existing.value = value;
  else (element.attrs ||= []).push({ name, value });
}

function removeAttributeValue(element: ParsedNode, name: string) {
  const normalized = name.toLowerCase();
  element.attrs = (element.attrs || []).filter(attribute => attributeName(attribute) !== normalized);
}

function walkElements(root: ParsedNode, callback: (element: ParsedNode) => void) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.tagName) callback(node);
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
}

function looksLikeSvgPayload(source: string) {
  // Figma packages contain raw SVG markup inside JSON string fields. A large
  // package must not take the oversized-SVG shortcut merely because one of
  // its assets contains "<svg". A standalone SVG cannot start as a JSON object
  // or array, regardless of whether the JSON itself is well formed.
  if (/^[\s\uFEFF]*[\[{]/.test(source)) return false;
  return /<svg(?:\s|>)/i.test(source);
}

function findStandaloneSvg(source: string): ParsedNode | null {
  if (source.length > MAX_CLIPBOARD_SVG_CHARACTERS) return null;
  const normalized = source
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype\s+svg(?:\s[^>]*)?>/gi, '')
    .trim();
  if (!normalized || /<!entity\b/i.test(normalized)) return null;
  const fragment = parseFragment(normalized) as unknown as ParsedNode;
  const svgRoots: ParsedNode[] = [];
  const discoveryStack = [{ node: fragment, insideSvg: false, depth: 0 }];
  let nodeCount = 0;
  while (discoveryStack.length) {
    const { node, insideSvg, depth } = discoveryStack.pop()!;
    nodeCount += 1;
    if (nodeCount > MAX_CLIPBOARD_SVG_NODES || depth > MAX_CLIPBOARD_SVG_DEPTH) {
      throw new Error('O SVG excede o limite seguro de complexidade.');
    }
    const isSvg = node.tagName?.toLowerCase() === 'svg';
    if (isSvg && !insideSvg) svgRoots.push(node);
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index--) {
      discoveryStack.push({ node: children[index], insideSvg: insideSvg || isSvg, depth: depth + 1 });
    }
  }
  if (svgRoots.length !== 1) return null;
  const svg = svgRoots[0];
  const svgSubtree = new Set<ParsedNode>();
  const subtreeStack = [svg];
  while (subtreeStack.length) {
    const node = subtreeStack.pop()!;
    svgSubtree.add(node);
    (node.childNodes || []).forEach(child => subtreeStack.push(child));
  }
  const wrapperAncestors = new Set<ParsedNode>();
  let ancestor = svg.parentNode;
  while (ancestor) {
    wrapperAncestors.add(ancestor);
    ancestor = ancestor.parentNode;
  }
  const outsideStack = [fragment];
  while (outsideStack.length) {
    const node = outsideStack.pop()!;
    if (svgSubtree.has(node)) continue;
    if (!wrapperAncestors.has(node)) {
      if (node.nodeName === '#text' && node.value?.trim()) return null;
      if (node.tagName && node.tagName.toLowerCase() !== 'meta') return null;
    }
    (node.childNodes || []).forEach(child => outsideStack.push(child));
  }
  return svg;
}

function safeLocalUrls(value: string) {
  if (FORBIDDEN_RESOURCE_VALUE.test(value)) return false;
  const urlMatches = Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi));
  if (!urlMatches.length) return !/url\s*\(/i.test(value);
  if (!urlMatches.every(match => /^#[A-Za-z_][\w:.-]*$/.test(match[2].trim()))) return false;
  return !/url\s*\(/i.test(value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, ''));
}

function sanitizeStyle(value: string) {
  const styles = parseStyleDeclarations(value);
  Object.entries(styles).forEach(([property, propertyValue]) => {
    const normalizedProperty = property.toLowerCase();
    if (
      !SAFE_SVG_STYLE_PROPERTIES.has(normalizedProperty)
      || FORBIDDEN_RESOURCE_VALUE.test(propertyValue)
      || /expression\s*\(/i.test(propertyValue)
      || !safeLocalUrls(propertyValue)
    ) {
      delete styles[property];
    }
  });
  return styles;
}

function sanitizeTree(root: ParsedNode) {
  let nodeCount = 0;
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    nodeCount += 1;
    if (nodeCount > MAX_CLIPBOARD_SVG_NODES || depth > MAX_CLIPBOARD_SVG_DEPTH) {
      throw new Error('O SVG excede o limite seguro de complexidade.');
    }
    node.childNodes = (node.childNodes || []).filter(child => {
      const tag = child.tagName?.toLowerCase() || '';
      return !FORBIDDEN_SVG_ELEMENTS.has(tag);
    });
    node.attrs = (node.attrs || []).filter(attribute => {
      const name = attributeName(attribute);
      if (name.startsWith('on')) return false;
      if ([
        'accesskey',
        'autofocus',
        'class',
        'contenteditable',
        'cursor',
        'draggable',
        'overflow',
        'pointer-events',
        'popover',
        'tabindex',
      ].includes(name)) return false;
      if (name === 'style') {
        attribute.value = serializeStyleDeclarations(sanitizeStyle(attribute.value));
        return Boolean(attribute.value);
      }
      if (URL_ATTRIBUTES.has(name)) {
        return (name === 'href' || name === 'xlink:href')
          && /^#[A-Za-z_][\w:.-]*$/.test(attribute.value.trim());
      }
      return safeLocalUrls(attribute.value);
    });
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ node: children[index], depth: depth + 1 });
    }
  }
}

function freshSvgIdPrefix() {
  svgIdSequence += 1;
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10);
  return `kodety-svg-${random || `${Date.now().toString(36)}-${svgIdSequence.toString(36)}`}`;
}

function rewriteInternalIds(root: ParsedNode, requestedPrefix?: string) {
  const prefix = (requestedPrefix || freshSvgIdPrefix())
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[^A-Za-z_]+/, '') || 'kodety-svg';
  const aliases = new Map<string, string>();
  const used = new Set<string>();
  walkElements(root, element => {
    const id = attributeValue(element, 'id').trim();
    if (!id) return;
    if (aliases.has(id)) throw new Error('O SVG contém IDs duplicados e não pode ser colado com segurança.');
    const safeId = id.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
    let nextId = `${prefix}-${safeId}`;
    let suffix = 2;
    while (used.has(nextId)) nextId = `${prefix}-${safeId}-${suffix++}`;
    used.add(nextId);
    aliases.set(id, nextId);
    setAttributeValue(element, 'id', nextId);
  });
  const rewriteReferences = (value: string, allowBareFragment = false) => {
    let unresolved = false;
    let next = value.replace(/url\(\s*(['"]?)#([A-Za-z_][\w:.-]*)\1\s*\)/gi, (match, quote, id) => {
      const alias = aliases.get(id);
      if (!alias) {
        unresolved = true;
        return '';
      }
      return `url(${quote}#${alias}${quote})`;
    });
    if (unresolved) return null;
    if (allowBareFragment) {
      const trimmed = next.trim();
      if (/^#[A-Za-z_][\w:.-]*$/.test(trimmed)) {
        const alias = aliases.get(trimmed.slice(1));
        return alias ? `#${alias}` : null;
      }
    }
    return next;
  };
  walkElements(root, element => {
    element.attrs = (element.attrs || []).filter(attribute => {
      const name = attributeName(attribute);
      if (['aria-describedby', 'aria-labelledby'].includes(name)) {
        const rewrittenIds = attribute.value
          .trim()
          .split(/\s+/)
          .map(id => aliases.get(id))
          .filter(Boolean);
        if (!rewrittenIds.length) return false;
        attribute.value = rewrittenIds.join(' ');
        return true;
      }
      if (name === 'style') {
        const styles = sanitizeStyle(attribute.value);
        Object.entries(styles).forEach(([property, value]) => {
          const rewritten = rewriteReferences(value);
          if (rewritten === null) delete styles[property];
          else styles[property] = rewritten;
        });
        attribute.value = serializeStyleDeclarations(styles);
        return Boolean(attribute.value);
      }
      if (name === 'id') return true;
      const rewritten = rewriteReferences(
        attribute.value,
        name === 'href' || name === 'xlink:href',
      );
      if (rewritten === null) return false;
      attribute.value = rewritten;
      return true;
    });
  });
  return prefix;
}

function editablePaintValue(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed) && !NON_PAINT_VALUES.test(trimmed) && !/^url\s*\(/i.test(trimmed);
}

function connectPaintToCurrentColor(root: ParsedNode) {
  const flatPaints: string[] = [];
  let usesCurrentColor = false;
  const visitPaints = (mutate: boolean) => {
    walkElements(root, node => {
      const styleAttribute = attributeValue(node, 'style');
      const styles = styleAttribute ? sanitizeStyle(styleAttribute) : {};
      ['fill', 'stroke'].forEach(property => {
        // An inline style wins over the presentation attribute. Inspecting both
        // would classify a single visible paint as falsely multicolour.
        const styleOwnsPaint = Object.prototype.hasOwnProperty.call(styles, property);
        const value = (styleOwnsPaint ? styles[property] : attributeValue(node, property)).trim();
        if (/^currentcolor$/i.test(value)) usesCurrentColor = true;
        if (!editablePaintValue(value)) return;
        if (!mutate) flatPaints.push(value);
        else if (styleOwnsPaint) styles[property] = 'currentColor';
        else setAttributeValue(node, property, 'currentColor');
      });
      if (!mutate || !styleAttribute) return;
      const serialized = serializeStyleDeclarations(styles);
      if (serialized) setAttributeValue(node, 'style', serialized);
      else removeAttributeValue(node, 'style');
    });
  };
  const rootStyle = sanitizeStyle(attributeValue(root, 'style'));
  const rootFill = (rootStyle.fill || attributeValue(root, 'fill')).trim();
  const declaredRootColor = (rootStyle.color || attributeValue(root, 'color')).trim();
  visitPaints(false);
  const distinctPaints = new Set(flatPaints.map(value => value.toLowerCase().replace(/\s+/g, '')));
  const normalizedRootColor = declaredRootColor.toLowerCase().replace(/\s+/g, '');
  const normalizedFlatPaint = flatPaints[0]?.toLowerCase().replace(/\s+/g, '') || '';
  // Do not merge an inherited/currentColor paint with a different solid one.
  // That is a multicolour SVG even when only one literal paint appears.
  const currentColorMatchesSolid = !usesCurrentColor
    || !flatPaints.length
    || (normalizedRootColor && normalizedRootColor === normalizedFlatPaint);
  const monochrome = distinctPaints.size <= 1 && Boolean(currentColorMatchesSolid);
  if (monochrome) visitPaints(true);
  const addedImplicitFill = monochrome && !rootFill;
  if (addedImplicitFill) setAttributeValue(root, 'fill', 'currentColor');
  const nextRootStyle = sanitizeStyle(attributeValue(root, 'style'));
  if (monochrome && flatPaints.length) {
    nextRootStyle.color = flatPaints[0];
  } else if (monochrome && usesCurrentColor && editablePaintValue(declaredRootColor)) {
    nextRootStyle.color = declaredRootColor;
  } else if (addedImplicitFill && !usesCurrentColor) {
    // SVG's implicit fill is black and does not normally follow `color`.
    nextRootStyle.color = '#000000';
  }
  const serializedRootStyle = serializeStyleDeclarations(nextRootStyle);
  if (serializedRootStyle) setAttributeValue(root, 'style', serializedRootStyle);
  else removeAttributeValue(root, 'style');
}

function parseSvgPixelLength(value: string) {
  const match = value.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(?:px)?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSvgViewBox(value: string) {
  const parts = value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null;
  const [, , width, height] = parts;
  return width > 0 && height > 0 ? { width, height } : null;
}

function formatSvgDimension(value: number) {
  return String(Number(value.toFixed(6)));
}

function intrinsicSvgSize(root: ParsedNode) {
  const styles = sanitizeStyle(attributeValue(root, 'style'));
  const explicitWidth = parseSvgPixelLength(attributeValue(root, 'width'))
    || parseSvgPixelLength(styles.width || '');
  const explicitHeight = parseSvgPixelLength(attributeValue(root, 'height'))
    || parseSvgPixelLength(styles.height || '');
  const viewBox = parseSvgViewBox(attributeValue(root, 'viewbox'));
  let width = explicitWidth;
  let height = explicitHeight;
  if (width && !height && viewBox) height = width * (viewBox.height / viewBox.width);
  if (height && !width && viewBox) width = height * (viewBox.width / viewBox.height);
  width ||= viewBox?.width || null;
  height ||= viewBox?.height || null;
  if (!width || !height) {
    throw new Error('O SVG precisa ter width/height numéricos ou um viewBox válido para manter o tamanho real.');
  }
  if (width > MAX_CLIPBOARD_SVG_DIMENSION || height > MAX_CLIPBOARD_SVG_DIMENSION) {
    throw new Error('As dimensões do SVG são grandes demais para o canvas.');
  }
  const formattedWidth = formatSvgDimension(width);
  const formattedHeight = formatSvgDimension(height);
  styles.display = 'block';
  styles.width = `${formattedWidth}px`;
  styles.height = `${formattedHeight}px`;
  setAttributeValue(root, 'style', serializeStyleDeclarations(styles));
  setAttributeValue(root, 'width', formattedWidth);
  setAttributeValue(root, 'height', formattedHeight);
}

function hasSvgTitle(root: ParsedNode) {
  let found = false;
  walkElements(root, element => {
    if (found || element.tagName?.toLowerCase() !== 'title') return;
    const stack = [...(element.childNodes || [])];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.nodeName === '#text' && node.value?.trim()) {
        found = true;
        return;
      }
      (node.childNodes || []).forEach(child => stack.push(child));
    }
  });
  return found;
}

export function prepareClipboardSvgMarkup(source: string, idPrefix?: string) {
  if (source.length > MAX_CLIPBOARD_SVG_CHARACTERS) {
    throw new Error('O SVG é grande demais para colar diretamente no canvas.');
  }
  const root = findStandaloneSvg(source);
  if (!root) throw new Error('A área de transferência não contém um SVG isolado válido.');
  sanitizeTree(root);
  const uniquePrefix = rewriteInternalIds(root, idPrefix);
  const uniqueClass = `incode-svg-paste-${uniquePrefix.replace(/^kodety-svg-/, '')}`;
  setAttributeValue(root, 'class', uniqueClass);
  connectPaintToCurrentColor(root);
  intrinsicSvgSize(root);
  setAttributeValue(root, 'xmlns', 'http://www.w3.org/2000/svg');
  if (!attributeValue(root, 'data-label')) setAttributeValue(root, 'data-label', 'SVG Icon');
  const accessible = Boolean(
    attributeValue(root, 'aria-label')
    || attributeValue(root, 'aria-labelledby')
    || hasSvgTitle(root)
  );
  if (accessible) {
    removeAttributeValue(root, 'aria-hidden');
    if (!attributeValue(root, 'role')) setAttributeValue(root, 'role', 'img');
  } else {
    setAttributeValue(root, 'aria-hidden', 'true');
  }
  setAttributeValue(root, 'focusable', 'false');
  return serializeOuter(root as never);
}

function clipboardStrings(data: ClipboardSvgData) {
  return [
    data.getData('image/svg+xml'),
    data.getData('text/plain'),
    data.getData('text/html'),
  ].filter(Boolean);
}

function svgClipboardFiles(data: ClipboardSvgData) {
  const files = Array.from(data.files || []);
  Array.from(data.items || []).forEach(item => {
    if (item.kind !== 'file') return;
    const file = item.getAsFile();
    if (file && !files.includes(file)) files.push(file);
  });
  return files.filter(file => file.type.toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file.name));
}

export function clipboardContainsSvg(data: ClipboardSvgData | null | undefined) {
  if (!data) return false;
  if (svgClipboardFiles(data).length) return true;
  if (Array.from(data.types || []).some(type => type.toLowerCase() === 'image/svg+xml')) return true;
  return clipboardStrings(data).some(value => {
    if (!looksLikeSvgPayload(value)) return false;
    if (value.length > MAX_CLIPBOARD_SVG_CHARACTERS) return true;
    try {
      return Boolean(findStandaloneSvg(value));
    } catch {
      // Let the canonical read/prepare path surface the complexity error.
      return true;
    }
  });
}

export async function readClipboardSvgSource(data: ClipboardSvgData) {
  for (const value of clipboardStrings(data)) {
    if (!looksLikeSvgPayload(value)) continue;
    if (value.length > MAX_CLIPBOARD_SVG_CHARACTERS) {
      throw new Error('O SVG é grande demais para colar diretamente no canvas.');
    }
    if (findStandaloneSvg(value)) return value;
  }
  const file = svgClipboardFiles(data)[0];
  if (!file) return null;
  if (file.size > MAX_CLIPBOARD_SVG_CHARACTERS) {
    throw new Error('O SVG é grande demais para colar diretamente no canvas.');
  }
  const source = await file.text();
  if (source.length > MAX_CLIPBOARD_SVG_CHARACTERS) {
    throw new Error('O SVG é grande demais para colar diretamente no canvas.');
  }
  return source;
}
