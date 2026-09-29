import { parse } from 'parse5';

export type AttachmentType = 'css' | 'js';

interface ParsedNode {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
}

function elementChildren(node: ParsedNode) {
  return (node.childNodes || []).filter(child => Boolean(child.tagName));
}

export function attachmentAttribute(type: AttachmentType) {
  return type === 'css' ? 'data-incode-css-files' : 'data-incode-js-files';
}

/** Parses the JSON file-list stored on an element's attachment attribute. */
export function readAttachedFiles(attributeValue: string | undefined | null): string[] {
  if (!attributeValue) return [];
  try {
    const parsed = JSON.parse(attributeValue) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Serializes a file list back to the attribute value (empty string clears the attribute). */
export function serializeAttachedFiles(files: string[]) {
  return files.length ? JSON.stringify(files) : '';
}

function elementsWithAttachments(source: string, type: AttachmentType): string[][] {
  const attribute = attachmentAttribute(type);
  const parsed = parse(source, { sourceCodeLocationInfo: false }) as ParsedNode;
  const results: string[][] = [];
  const walk = (node: ParsedNode) => {
    const value = node.attrs?.find(attr => attr.name === attribute)?.value;
    if (value) results.push(readAttachedFiles(value));
    elementChildren(node).forEach(walk);
  };
  walk(parsed);
  return results;
}

/** Whether any element in the document still lists this file for the given type. */
export function isFileReferenced(source: string, type: AttachmentType, filePath: string): boolean {
  return elementsWithAttachments(source, type).some(files => files.includes(filePath));
}

/** Every distinct file path attached to any element in the document, for the given type. */
export function allAttachedFiles(source: string, type: AttachmentType): string[] {
  return [...new Set(elementsWithAttachments(source, type).flat())];
}

/** Whether any element in the document has JS files attached at all. */
export function hasAnyJsAttachment(source: string): boolean {
  return elementsWithAttachments(source, 'js').some(files => files.length > 0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ensures a real `<link rel="stylesheet">` for this file exists in `<head>` —
 * inserted only once, and skipped entirely if any stylesheet link (hand
 * authored or previously generated) already references the same href. A real
 * persisted `<link>` (not a runtime-injected one) avoids a flash of unstyled
 * content for elements that depend on it.
 */
export function ensureCssLink(source: string, filePath: string): string {
  const hrefPattern = new RegExp(`<link\\b[^>]*rel=["']stylesheet["'][^>]*href=["']${escapeRegExp(filePath)}["']`, 'i');
  const hrefPatternReversed = new RegExp(`<link\\b[^>]*href=["']${escapeRegExp(filePath)}["'][^>]*rel=["']stylesheet["']`, 'i');
  if (hrefPattern.test(source) || hrefPatternReversed.test(source)) return source;
  const tag = `<link rel="stylesheet" href="${filePath}" data-incode-css-link="${filePath}">\n`;
  return /<\/head\s*>/i.test(source) ? source.replace(/<\/head\s*>/i, `  ${tag}</head>`) : `${tag}${source}`;
}

/** Removes the generated `<link>` for this file if no element references it anymore. */
export function removeCssLinkIfUnreferenced(source: string, filePath: string): string {
  if (isFileReferenced(source, 'css', filePath)) return source;
  const pattern = new RegExp(`\\s*<link\\b[^>]*data-incode-css-link=["']${escapeRegExp(filePath)}["'][^>]*>`, 'i');
  return source.replace(pattern, '');
}

const JS_BRIDGE_MARKER = 'data-incode-js-bridge';

/**
 * A single global runtime helper (inserted once) that discovers every element
 * with attached JS files and dynamic-imports each one, in document order,
 * once per element. A file that `export default`s a function receives the
 * element as its argument — the same "give the file a scoped handle to what
 * it's attached to" convention already used by the GSAP custom-code panel.
 * Files without a default export just run (plain "include this on this
 * element" — no scoping required).
 */
function buildJsBridge() {
  return `<script ${JS_BRIDGE_MARKER}="1">
(() => {
  const setup = () => {
    document.querySelectorAll('[data-incode-js-files]').forEach(element => {
      if (element.dataset.incodeJsReady) return;
      element.dataset.incodeJsReady = '1';
      let files = [];
      try { files = JSON.parse(element.getAttribute('data-incode-js-files') || '[]'); } catch { files = []; }
      files.forEach(path => {
        import(path).then(mod => { if (mod && typeof mod.default === 'function') mod.default(element); }).catch(() => {});
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
</script>`;
}

export function ensureJsBridge(source: string): string {
  if (new RegExp(`<script\\b[^>]*${JS_BRIDGE_MARKER}=`, 'i').test(source)) return source;
  const tag = `${buildJsBridge()}\n`;
  return /<\/body\s*>/i.test(source) ? source.replace(/<\/body\s*>/i, `  ${tag}</body>`) : `${source}\n${tag}`;
}

export function removeJsBridgeIfUnused(source: string): string {
  if (hasAnyJsAttachment(source)) return source;
  const pattern = new RegExp(`\\s*<script\\b[^>]*${JS_BRIDGE_MARKER}=["'][^"']*["'][^>]*>[\\s\\S]*?<\\/script>`, 'i');
  return source.replace(pattern, '');
}
