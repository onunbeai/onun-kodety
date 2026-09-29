import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { HtmlProject, HtmlProjectFile } from './types';

export const RESPONSIVE_VIEWPORT_CONTENT = 'width=device-width, initial-scale=1';

type HtmlElement = DefaultTreeAdapterMap['element'];
type HtmlNode = DefaultTreeAdapterMap['node'];

interface SourceEdit {
  start: number;
  end: number;
  text: string;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

function elementAttribute(element: HtmlElement, name: string) {
  const normalizedName = name.toLowerCase();
  return element.attrs.find(attribute => attribute.name.toLowerCase() === normalizedName)?.value;
}

function activeElements(node: HtmlNode, result: HtmlElement[] = []) {
  if (isElement(node)) result.push(node);
  if ('childNodes' in node) {
    node.childNodes.forEach(child => activeElements(child, result));
  }
  return result;
}

function isViewportMeta(element: HtmlElement) {
  return element.tagName.toLowerCase() === 'meta'
    && elementAttribute(element, 'name')?.trim().toLowerCase() === 'viewport';
}

function viewportDirectives(content: string) {
  return content
    .split(/[;,]/)
    .map(directive => directive.trim())
    .filter(Boolean);
}

function hasCanonicalLayoutViewport(content: string) {
  const directives = viewportDirectives(content);
  const widths = directives.flatMap(directive => {
    const match = /^width\s*=\s*(.+)$/i.exec(directive);
    return match ? [match[1].trim().toLowerCase()] : [];
  });
  const initialScales = directives.flatMap(directive => {
    const match = /^initial-scale\s*=\s*(.+)$/i.exec(directive);
    return match ? [Number(match[1].trim())] : [];
  });
  return widths.length === 1
    && widths[0] === 'device-width'
    && initialScales.length <= 1
    && initialScales.every(value => Number.isFinite(value) && value === 1);
}

function canonicalViewportContent(content: string) {
  const preserved = viewportDirectives(content).filter(
    directive => !/^(?:width|initial-scale)\s*=/i.test(directive),
  );
  return [RESPONSIVE_VIEWPORT_CONTENT, ...preserved].join(', ');
}

function escapeAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
}

function applySourceEdits(source: string, edits: SourceEdit[]) {
  let result = source;
  edits
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .forEach(edit => {
      result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    });
  return result;
}

function viewportInsertion(
  source: string,
  document: DefaultTreeAdapterMap['document'],
  root: HtmlElement | undefined,
  head: HtmlElement | undefined,
): SourceEdit {
  const markup = `<meta name="viewport" content="${RESPONSIVE_VIEWPORT_CONTENT}">`;
  const explicitHeadStart = head?.sourceCodeLocation?.startTag?.endOffset;
  if (explicitHeadStart !== undefined) {
    return { start: explicitHeadStart, end: explicitHeadStart, text: markup };
  }
  const explicitRootStart = root?.sourceCodeLocation?.startTag?.endOffset;
  if (explicitRootStart !== undefined) {
    return {
      start: explicitRootStart,
      end: explicitRootStart,
      text: `<head>${markup}</head>`,
    };
  }
  const doctype = document.childNodes.find(node => node.nodeName === '#documentType');
  const offset = doctype?.sourceCodeLocation?.endOffset ?? 0;
  const separator = offset > 0 && source[offset] === '\n' ? '' : '\n';
  return {
    start: offset,
    end: offset,
    text: `${separator}<head>${markup}</head>`,
  };
}

/**
 * Make CSS media queries observe the same CSS-pixel viewport used by the
 * Builder canvas. Mobile browsers otherwise default legacy documents to a
 * wide virtual layout viewport (commonly around 980px), so a canvas-authored
 * `(max-width: 480px)` rule never becomes active after publication.
 *
 * The patch is location-based: valid authored HTML, formatting, scripts and
 * unrelated head directives remain byte-identical. Extra viewport directives
 * such as `viewport-fit=cover` are preserved, while conflicting width/scale
 * values and duplicate active viewport tags are removed deterministically.
 */
export function ensureResponsiveViewportMeta(source: string): string {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const root = document.childNodes.find(node => node.nodeName === 'html') as HtmlElement | undefined;
  const head = root?.childNodes.find(node => node.nodeName === 'head') as HtmlElement | undefined;
  const viewportMetas = activeElements(document).filter(isViewportMeta);
  const headViewportMetas = head?.childNodes
    .filter((node): node is HtmlElement => isElement(node) && isViewportMeta(node)) || [];

  const canonical = headViewportMetas.length === 1
    && viewportMetas.length === 1
    && hasCanonicalLayoutViewport(elementAttribute(headViewportMetas[0], 'content') || '');
  if (canonical) return source;

  const retained = headViewportMetas[0];
  const edits: SourceEdit[] = [];
  viewportMetas.forEach(element => {
    if (element === retained) return;
    const location = element.sourceCodeLocation;
    if (!location) return;
    edits.push({ start: location.startOffset, end: location.endOffset, text: '' });
  });

  if (retained?.sourceCodeLocation?.startTag) {
    const currentContent = elementAttribute(retained, 'content') || '';
    const content = canonicalViewportContent(currentContent);
    const contentLocation = retained.sourceCodeLocation.attrs?.content;
    if (contentLocation) {
      edits.push({
        start: contentLocation.startOffset,
        end: contentLocation.endOffset,
        text: `content="${escapeAttribute(content)}"`,
      });
    } else {
      const endOffset = retained.sourceCodeLocation.startTag.endOffset;
      const insertionOffset = source[endOffset - 2] === '/' ? endOffset - 2 : endOffset - 1;
      edits.push({
        start: insertionOffset,
        end: insertionOffset,
        text: ` content="${escapeAttribute(content)}"`,
      });
    }
  } else {
    edits.push(viewportInsertion(source, document, root, head));
  }

  return applySourceEdits(source, edits);
}

export function projectNeedsResponsiveViewportNormalization(project: HtmlProject): boolean {
  return Object.values(project.files).some(file => (
    file.text !== undefined
    && /\.html?$/i.test(file.path)
    && ensureResponsiveViewportMeta(file.text) !== file.text
  ));
}

export function prepareResponsiveProjectForTransport(project: HtmlProject): HtmlProject {
  let files = project.files;
  Object.values(project.files).forEach(file => {
    if (file.text === undefined || !/\.html?$/i.test(file.path)) return;
    const text = ensureResponsiveViewportMeta(file.text);
    if (text === file.text) return;
    if (files === project.files) files = { ...project.files };
    files[file.path] = { ...file, text } as HtmlProjectFile;
  });
  return files === project.files ? project : { ...project, files };
}
