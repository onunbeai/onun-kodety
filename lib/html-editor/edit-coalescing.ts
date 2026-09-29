import { normalizeStylePropertyName } from './style-utils';

export interface CodeEditTransaction<T> {
  path: string;
  at: number;
  after: T | null;
}

export const CANVAS_STYLE_PREVIEW_PATH = '.kodety/canvas-style-preview.css';

export interface CanvasStylePreviewDraft {
  targetKey: string;
  paths: string[];
  selector?: string;
  declarations: Record<string, string>;
}

const CSS_PROPERTY_NAME = /^(?:--[a-z0-9_-]+|-?[a-z][a-z0-9-]*)$/i;

function normalizePreviewPaths(paths: readonly string[]) {
  // The document body is intentionally addressed by the empty path. Treating
  // it as falsy made body/root controls update only after their persisted
  // commit (or a later reload), while every numbered element scrubbed live.
  return Array.from(new Set(paths.filter(path => typeof path === 'string')))
    .sort();
}

function normalizePreviewProperty(property: string) {
  const normalized = normalizeStylePropertyName(property);
  return CSS_PROPERTY_NAME.test(normalized) ? normalized : '';
}

function normalizePreviewSelector(selector: string) {
  const normalized = selector.trim();
  if (
    !normalized
    || normalized.length > 4096
    || /[{}]/.test(normalized)
  ) return '';
  return normalized;
}

function previewTargetKey(paths: readonly string[], selector: string) {
  return selector
    ? `selector\u0000${selector}`
    : normalizePreviewPaths(paths).join('\u0000');
}

/**
 * Keeps only the latest visual value for each property. This draft is
 * deliberately independent from project revisions/history: persistence ACKs
 * do not clear it, so the exact realtime result remains painted until another
 * explicit preview context replaces or cancels it.
 */
export function updateCanvasStylePreviewDraft(
  current: CanvasStylePreviewDraft | null,
  paths: readonly string[],
  property: string,
  value: string,
  selector = '',
): CanvasStylePreviewDraft | null {
  const normalizedPaths = normalizePreviewPaths(paths);
  const normalizedSelector = normalizePreviewSelector(selector);
  const normalizedProperty = normalizePreviewProperty(property);
  if (
    (!normalizedPaths.length && !normalizedSelector)
    || !normalizedProperty
  ) return current;
  const targetKey = previewTargetKey(normalizedPaths, normalizedSelector);
  const declarations = current?.targetKey === targetKey
    ? { ...current.declarations }
    : {};
  const normalizedValue = value.replace(/\s*!\s*important\b/gi, '').trim();
  if (normalizedValue) declarations[normalizedProperty] = normalizedValue;
  else delete declarations[normalizedProperty];
  if (!Object.keys(declarations).length) return null;
  return {
    targetKey,
    paths: normalizedPaths,
    ...(normalizedSelector ? { selector: normalizedSelector } : {}),
    declarations,
  };
}

export function removeCanvasStylePreviewProperties(
  current: CanvasStylePreviewDraft | null,
  properties: readonly string[],
) {
  if (!current) return null;
  const declarations = { ...current.declarations };
  properties.forEach(property => {
    const normalized = normalizePreviewProperty(property);
    if (normalized) delete declarations[normalized];
  });
  return Object.keys(declarations).length
    ? { ...current, declarations }
    : null;
}

function cssAttributeString(value: string) {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\d ')
    .replace(/\n/g, '\\a ')
    .replace(/\f/g, '\\c ')}"`;
}

function splitPreviewSelectorList(selector: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      parts.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

const CANVAS_PREVIEW_AUTHORITY = Array.from(
  { length: 8 },
  (_, index) => `:not(#__kodety_canvas_preview_${index})`,
).join('');

function canvasPreviewAuthoritySelector(selector: string) {
  const pseudoElement = selector.match(/(::[-a-z0-9_]+(?:\([^)]*\))?)\s*$/i);
  if (!pseudoElement || pseudoElement.index === undefined) {
    return `${selector}${CANVAS_PREVIEW_AUTHORITY}`;
  }
  return `${selector.slice(0, pseudoElement.index)}${CANVAS_PREVIEW_AUTHORITY}${selector.slice(pseudoElement.index)}`;
}

/**
 * The bridge writes this text into a dedicated <style> node. Using an overlay
 * rather than disposable inline styles leaves authored-style markers intact
 * and lets one empty update remove every transient preview atomically.
 */
export function serializeCanvasStylePreview(
  draft: CanvasStylePreviewDraft | null,
) {
  if (!draft || (!draft.paths.length && !draft.selector)) return '';
  const declarations = Object.entries(draft.declarations)
    .filter(([property, value]) => CSS_PROPERTY_NAME.test(property) && value.trim())
    // This sheet is a disposable Builder projection, not authored project CSS.
    // Priority is required here so a scrub/drag remains visible even when the
    // imported source contains a legacy inline or stylesheet !important. The
    // committed writer edits/migrates the real winning declaration afterwards.
    .map(([property, value]) => `${property}:${value.replace(/\s*!\s*important\b/gi, '').trim()}!important`)
    .join(';');
  if (!declarations) return '';
  const selector = (
    draft.selector
      ? splitPreviewSelectorList(draft.selector)
      : draft.paths.map(path => `[data-html-editor-path=${cssAttributeString(path)}]`)
  ).map(canvasPreviewAuthoritySelector).join(',');
  return `${selector}{${declarations};}`;
}

export function isLiveCanvasStylesheetPath(path: string) {
  return /\.css(?:[?#].*)?$/i.test(path.trim());
}

/**
 * Coalesce only when the current project is exactly the result of the prior
 * keystroke. An undo/redo or any intervening command changes that identity and
 * must start a new history branch even inside the typing time window.
 */
export function shouldStartCodeEditTransaction<T>(
  previous: CodeEditTransaction<T> | null,
  current: T,
  path: string,
  now: number,
  windowMs = 900,
) {
  return !previous
    || previous.path !== path
    || previous.after !== current
    || now - previous.at > windowMs;
}
