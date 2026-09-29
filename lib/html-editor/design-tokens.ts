import type { HtmlProject } from './types';
import { readEditorMetadata, updateEditorMetadata } from './project-io';

export const DESIGN_TOKEN_STYLE_ATTRIBUTE = 'data-kodety-design-tokens';
export const BASE_DESIGN_TOKEN_COLLECTION_ID = 'base';

export type HtmlDesignTokenType =
  | 'color'
  | 'size'
  | 'percentage'
  | 'number'
  | 'duration'
  | 'font-family'
  | 'string';

export interface HtmlDesignTokenCollection {
  id: string;
  name: string;
}

export interface HtmlDesignToken {
  id: string;
  collectionId: string;
  name: string;
  type: HtmlDesignTokenType;
  value: string;
  description?: string;
}

export interface HtmlDesignTokenDocument {
  version: 1;
  collections: HtmlDesignTokenCollection[];
  tokens: HtmlDesignToken[];
}

export const HTML_DESIGN_TOKEN_TYPES: Array<{
  value: HtmlDesignTokenType;
  label: string;
  symbol: string;
}> = [
  { value: 'color', label: 'Cor', symbol: '◐' },
  { value: 'size', label: 'Tamanho', symbol: '↗' },
  { value: 'percentage', label: 'Porcentagem', symbol: '%' },
  { value: 'number', label: 'Número', symbol: '#' },
  { value: 'duration', label: 'Duração', symbol: 'ms' },
  { value: 'font-family', label: 'Fonte (família)', symbol: 'Aa' },
  { value: 'string', label: 'Texto / opção CSS', symbol: 'T' },
];

const COLOR_PROPERTIES = new Set([
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'fill',
  'stroke',
]);

const SIZE_PROPERTIES = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'gap',
  'row-gap',
  'column-gap',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'top',
  'right',
  'bottom',
  'left',
  'font-size',
  'line-height',
  'letter-spacing',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'outline-width',
  'outline-offset',
  'text-decoration-thickness',
  'text-underline-offset',
  'translate',
  'transform-origin',
  'perspective',
  'object-position',
  'background-position',
  'background-size',
]);

const NUMBER_PROPERTIES = new Set([
  'opacity',
  'z-index',
  'font-weight',
  'order',
  'flex-grow',
  'flex-shrink',
  'line-height',
  'scale',
  'aspect-ratio',
  '-webkit-line-clamp',
]);

const DURATION_PROPERTIES = new Set([
  'transition-duration',
  'transition-delay',
  'animation-duration',
  'animation-delay',
]);

function safeId(value: unknown) {
  return typeof value === 'string'
    ? value.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
    : '';
}

function uniqueId(prefix: string, used: Set<string>) {
  let id = `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  while (used.has(id)) id = `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  used.add(id);
  return id;
}

export function createHtmlDesignTokenId() {
  return globalThis.crypto?.randomUUID?.()
    || `token-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createHtmlDesignTokenCollectionId() {
  return globalThis.crypto?.randomUUID?.()
    || `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyHtmlDesignTokenDocument(): HtmlDesignTokenDocument {
  return {
    version: 1,
    collections: [{ id: BASE_DESIGN_TOKEN_COLLECTION_ID, name: 'Base collection' }],
    tokens: [],
  };
}

export function normalizeHtmlDesignTokens(value: unknown): HtmlDesignTokenDocument {
  if (!value || typeof value !== 'object') return emptyHtmlDesignTokenDocument();
  const input = value as Partial<HtmlDesignTokenDocument>;
  const collectionIds = new Set<string>();
  const collections: HtmlDesignTokenCollection[] = [];

  (Array.isArray(input.collections) ? input.collections : []).forEach((collection) => {
    if (!collection || typeof collection !== 'object') return;
    let id = safeId(collection.id);
    if (!id || collectionIds.has(id)) id = uniqueId('collection', collectionIds);
    else collectionIds.add(id);
    collections.push({
      id,
      name: typeof collection.name === 'string' && collection.name.trim()
        ? collection.name.trim().slice(0, 80)
        : 'Collection',
    });
  });
  if (!collections.length) {
    collections.push({ id: BASE_DESIGN_TOKEN_COLLECTION_ID, name: 'Base collection' });
    collectionIds.add(BASE_DESIGN_TOKEN_COLLECTION_ID);
  }

  const tokenIds = new Set<string>();
  const validTypes = new Set<HtmlDesignTokenType>(
    HTML_DESIGN_TOKEN_TYPES.map(option => option.value),
  );
  const tokens: HtmlDesignToken[] = [];
  (Array.isArray(input.tokens) ? input.tokens : []).forEach((token) => {
    if (!token || typeof token !== 'object') return;
    let id = safeId(token.id);
    if (!id || tokenIds.has(id)) id = uniqueId('token', tokenIds);
    else tokenIds.add(id);
    const collectionId = safeId(token.collectionId);
    tokens.push({
      id,
      collectionId: collectionIds.has(collectionId) ? collectionId : collections[0].id,
      name: typeof token.name === 'string' && token.name.trim()
        ? token.name.trim().slice(0, 120)
        : 'Variable',
      type: validTypes.has(token.type as HtmlDesignTokenType)
        ? token.type as HtmlDesignTokenType
        : 'string',
      value: typeof token.value === 'string' ? token.value.trim().slice(0, 4000) : '',
      ...(typeof token.description === 'string' && token.description.trim()
        ? { description: token.description.trim().slice(0, 240) }
        : {}),
    });
  });
  return { version: 1, collections, tokens };
}

export function designTokenCssName(id: string) {
  return `--kodety-token-${safeId(id) || 'invalid'}`;
}

export function designTokenReference(id: string) {
  return `var(${designTokenCssName(id)})`;
}

export function designTokenIdFromReference(value: string) {
  return value
    .trim()
    .match(/^var\(\s*--kodety-token-([a-zA-Z0-9_-]+)(?:\s*,[^)]*)?\s*\)$/)?.[1]
    || null;
}

export function designTokenDefaultValue(type: HtmlDesignTokenType) {
  if (type === 'color') return '#000000';
  if (type === 'size') return '0px';
  if (type === 'percentage') return '100%';
  if (type === 'number') return '0';
  if (type === 'duration') return '0ms';
  if (type === 'font-family') return 'ui-sans-serif, system-ui, sans-serif';
  return 'initial';
}

export function designTokenTypeForProperty(
  property: string,
  currentValue = '',
): HtmlDesignTokenType {
  const normalized = property.trim().toLowerCase();
  if (COLOR_PROPERTIES.has(normalized) || normalized.endsWith('-color')) return 'color';
  if (normalized === 'font-family') return 'font-family';
  if (DURATION_PROPERTIES.has(normalized)) return 'duration';
  if (/%\s*$/.test(currentValue.trim())) return 'percentage';
  if (SIZE_PROPERTIES.has(normalized)) return 'size';
  if (NUMBER_PROPERTIES.has(normalized)) return 'number';
  return 'string';
}

export function isDesignTokenCompatible(
  token: HtmlDesignToken,
  property: string,
) {
  const preferred = designTokenTypeForProperty(property);
  if (preferred === 'duration') {
    return (
      token.type === 'duration'
      || token.type === 'size'
      || token.type === 'string'
    ) && isDesignTokenDurationValue(token.value);
  }
  if (token.type === 'string') return true;
  if (preferred === 'size') return token.type === 'size' || token.type === 'percentage';
  if (preferred === 'percentage') {
    return token.type === 'percentage' || token.type === 'size' || token.type === 'number';
  }
  if (preferred === 'number') return token.type === 'number' || token.type === 'percentage';
  return token.type === preferred;
}

const CSS_TIME_VALUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/i;

/** CSS time list accepted by transition/animation duration and delay fields. */
export function isDesignTokenDurationValue(value: string) {
  const entries = value.split(',').map(entry => entry.trim());
  return Boolean(entries.length && entries.every(entry => CSS_TIME_VALUE.test(entry)));
}

function escapeStyleText(value: string) {
  return value.replace(/<\/style/gi, '<\\/style');
}

export function serializeHtmlDesignTokenCss(document: HtmlDesignTokenDocument) {
  const normalized = normalizeHtmlDesignTokens(document);
  if (!normalized.tokens.length) return '';
  const declarations = normalized.tokens
    .map(token => `  ${designTokenCssName(token.id)}: ${escapeStyleText(token.value || 'initial')};`)
    .join('\n');
  return `:root {\n${declarations}\n}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeCompiledStyle(html: string) {
  return html.replace(
    new RegExp(
      `<style\\b[^>]*\\b${DESIGN_TOKEN_STYLE_ATTRIBUTE}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]+))?[^>]*>[\\s\\S]*?<\\/style>\\s*`,
      'gi',
    ),
    '',
  );
}

export function materializeHtmlDesignTokens(
  project: HtmlProject,
  document: HtmlDesignTokenDocument,
): HtmlProject {
  const css = serializeHtmlDesignTokenCss(document);
  let files = project.files;

  Object.entries(project.files).forEach(([path, file]) => {
    if (!/\.html?$/i.test(path) || typeof file.text !== 'string') return;
    let text = removeCompiledStyle(file.text);
    if (css) {
      const block = `<style ${DESIGN_TOKEN_STYLE_ATTRIBUTE}>\n${css}\n</style>\n`;
      if (/<\/head\s*>/i.test(text)) text = text.replace(/<\/head\s*>/i, `${block}</head>`);
      else text = `${block}${text}`;
    }
    if (text === file.text) return;
    if (files === project.files) files = { ...project.files };
    files[path] = { ...file, text };
  });

  return files === project.files ? project : { ...project, files };
}

function detachRemovedTokenReferences(
  project: HtmlProject,
  previous: HtmlDesignTokenDocument,
  next: HtmlDesignTokenDocument,
) {
  const nextIds = new Set(next.tokens.map(token => token.id));
  const removed = previous.tokens.filter(token => !nextIds.has(token.id));
  if (!removed.length) return project;
  let files = project.files;

  Object.entries(project.files).forEach(([path, file]) => {
    if (typeof file.text !== 'string' || !/\.(?:html?|css|svg)$/i.test(path)) return;
    let text = file.text;
    removed.forEach((token) => {
      const reference = `var\\(\\s*${escapeRegExp(designTokenCssName(token.id))}\\s*\\)`;
      text = text.replace(new RegExp(reference, 'g'), token.value || 'initial');
    });
    if (text === file.text) return;
    if (files === project.files) files = { ...project.files };
    files[path] = { ...file, text };
  });

  return files === project.files ? project : { ...project, files };
}

export function updateProjectDesignTokens(
  project: HtmlProject,
  value: HtmlDesignTokenDocument,
): HtmlProject {
  const previous = normalizeHtmlDesignTokens(readEditorMetadata(project).designTokens);
  const next = normalizeHtmlDesignTokens(value);
  const detached = detachRemovedTokenReferences(project, previous, next);
  const withMetadata = updateEditorMetadata(detached, metadata => ({
    ...metadata,
    designTokens: next,
  }));
  return materializeHtmlDesignTokens(withMetadata, next);
}
