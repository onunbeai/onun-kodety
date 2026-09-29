import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { Font, FontAxis } from '@/types';
import type { HtmlProject, HtmlProjectFile } from './types';
import {
  buildFontClassesCss,
  buildGoogleFontUrl,
  fontsReferencedBySources,
  normalizeFontFamilyName,
} from '../font-utils';

/** Portable font dependencies, without account IDs, timestamps or local storage. */
export type ProjectGoogleFont = Pick<
  Font,
  'family' | 'variants' | 'weights' | 'category' | 'axes'
>;

export function normalizeProjectGoogleFonts(value: unknown): Font[] {
  if (!Array.isArray(value)) return [];
  const fonts = new Map<string, Font>();
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      (entry.type && entry.type !== 'google')
    )
      continue;
    const family =
      typeof entry.family === 'string'
        ? entry.family.trim().replace(/\s+/g, ' ')
        : '';
    // These values become CSS strings and class names as well as a query value.
    if (
      !family ||
      family.length > 200 ||
      !/^[\p{L}\p{N} .&()+_-]+$/u.test(family)
    )
      continue;
    const variants = Array.isArray(entry.variants)
      ? entry.variants.filter(
          (variant: unknown): variant is string =>
            typeof variant === 'string' &&
            /^(?:regular|italic|\d{1,4}(?:italic)?)$/.test(variant),
        )
      : [];
    const weights = Array.isArray(entry.weights)
      ? entry.weights.filter(
          (weight: unknown): weight is string =>
            typeof weight === 'string' &&
            /^\d{1,4}$/.test(weight) &&
            Number(weight) >= 1 &&
            Number(weight) <= 1000,
        )
      : [];
    const axes = Array.isArray(entry.axes)
      ? entry.axes.flatMap((axis: unknown): FontAxis[] => {
          if (!axis || typeof axis !== 'object') return [];
          const candidate = axis as Partial<FontAxis>;
          return typeof candidate.tag === 'string' &&
            /^[a-zA-Z]{4}$/.test(candidate.tag) &&
            typeof candidate.start === 'number' &&
            Number.isFinite(candidate.start) &&
            typeof candidate.end === 'number' &&
            Number.isFinite(candidate.end) &&
            candidate.start <= candidate.end
            ? [
                {
                  tag: candidate.tag,
                  start: candidate.start,
                  end: candidate.end,
                },
              ]
            : [];
        })
      : [];
    const name = family.toLocaleLowerCase().replace(/\s+/g, '-');
    fonts.set(normalizeFontFamilyName(family), {
      id: `google-${name}`,
      name,
      family,
      type: 'google',
      variants: [...new Set<string>(variants)],
      weights: [...new Set<string>(weights)],
      category: [
        'serif',
        'sans-serif',
        'display',
        'handwriting',
        'monospace',
      ].includes(entry.category)
        ? entry.category
        : 'sans-serif',
      ...(axes.length ? { axes } : {}),
      is_published: false,
      created_at: '',
      updated_at: '',
      deleted_at: null,
    });
  }
  return Array.from(fonts.values());
}

export function serializeProjectGoogleFonts(
  fonts: Font[],
): ProjectGoogleFont[] {
  return fonts.map(({ family, variants, weights, category, axes }) => ({
    family,
    variants,
    weights,
    category,
    ...(axes?.length ? { axes } : {}),
  }));
}

// Font tracking also runs on style commits. Reuse unchanged file matches rather
// than joining the entire site into another large string on each keystroke.
const fileReferenceCache = new WeakMap<
  HtmlProjectFile,
  {
    text: string;
    catalogKey: string;
    families: string[];
  }
>();

export function referencedProjectGoogleFonts(
  project: HtmlProject,
  fonts: Font[],
  metadataSources: string[] = [],
) {
  if (!fonts.length) return [];
  const catalogKey = fonts
    .map((font) => `${font.family}\0${font.name}`)
    .join('\n');
  const referenced = new Set(
    fontsReferencedBySources(fonts, metadataSources).map((font) => font.family),
  );
  for (const file of Object.values(project.files)) {
    if (
      file.text === undefined ||
      !/\.(?:html?|css|[cm]?js|jsx|tsx?)$/i.test(file.path)
    )
      continue;
    let cached = fileReferenceCache.get(file);
    if (cached?.text !== file.text || cached.catalogKey !== catalogKey) {
      cached = {
        text: file.text,
        catalogKey,
        families: fontsReferencedBySources(fonts, [file.text]).map(
          (font) => font.family,
        ),
      };
      fileReferenceCache.set(file, cached);
    }
    cached.families.forEach((family) => referenced.add(family));
  }
  return fonts.filter((font) => referenced.has(font.family));
}

const FONT_LINK_ATTRIBUTE = 'data-kodety-google-font';
const FONT_CLASSES_ATTRIBUTE = 'data-kodety-google-font-classes';
type HtmlElement = DefaultTreeAdapterMap['element'];

/** Publish ordinary active stylesheets, never canvas-only print/JS deferral. */
export function injectProjectGoogleFonts(html: string, fonts: Font[]): string {
  if (!fonts.length && !html.includes(FONT_LINK_ATTRIBUTE)) return html;
  const document = parse(html, { sourceCodeLocationInfo: true });
  const root = document.childNodes.find((node) => node.nodeName === 'html') as
    HtmlElement | undefined;
  const head = root?.childNodes.find((node) => node.nodeName === 'head') as
    HtmlElement | undefined;
  if (!head) return html;
  const elements = head.childNodes.filter(
    (node): node is HtmlElement => 'tagName' in node,
  );
  const owned = elements.filter(
    (node) =>
      (node.tagName === 'link' &&
        node.attrs.some((attr) => attr.name === FONT_LINK_ATTRIBUTE)) ||
      (node.tagName === 'style' &&
        node.attrs.some((attr) => attr.name === FONT_CLASSES_ATTRIBUTE)),
  );
  const edits = owned.flatMap((node) =>
    node.sourceCodeLocation
      ? [
          {
            start: node.sourceCodeLocation.startOffset,
            end: node.sourceCodeLocation.endOffset,
            text: '',
          },
        ]
      : [],
  );
  const activeAuthoredUrls = new Set(
    elements
      .filter(
        (node) =>
          node.tagName === 'link' &&
          !owned.includes(node) &&
          node.attrs.some(
            (attr) =>
              attr.name === 'rel' &&
              attr.value.toLowerCase().split(/\s+/).includes('stylesheet'),
          ) &&
          !node.attrs.some(
            (attr) =>
              attr.name === 'disabled' ||
              (attr.name === 'media' &&
                !['', 'all', 'screen'].includes(attr.value.toLowerCase())),
          ),
      )
      .map((node) => node.attrs.find((attr) => attr.name === 'href')?.value),
  );
  const links = Array.from(new Set(fonts.map(buildGoogleFontUrl)))
    .filter((href) => !activeAuthoredUrls.has(href))
    .map(
      (href) =>
        `<link rel="stylesheet" ${FONT_LINK_ATTRIBUTE} href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`,
    )
    .join('');
  const classes = buildFontClassesCss(fonts);
  const content =
    links +
    (classes ? `<style ${FONT_CLASSES_ATTRIBUTE}>${classes}</style>` : '');
  if (content) {
    const explicitHead = head.sourceCodeLocation;
    const doctype = document.childNodes.find(
      (node) => node.nodeName === '#documentType',
    );
    const offset =
      explicitHead?.endTag?.startOffset ??
      explicitHead?.startTag?.endOffset ??
      root?.sourceCodeLocation?.startTag?.endOffset ??
      doctype?.sourceCodeLocation?.endOffset ??
      0;
    edits.push({
      start: offset,
      end: offset,
      text: explicitHead ? content : `<head>${content}</head>`,
    });
  }
  // Location-based edits preserve authored HTML, scripts, formatting and URLs.
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  }
  return html;
}
