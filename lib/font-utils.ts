/**
 * Font Utilities
 *
 * Shared utilities for building font CSS (Google Fonts @import, custom @font-face),
 * generating Tailwind-compatible class names, and font URL construction.
 */

import type { Font, FontAxis } from '@/types';
import { normalizeAdobeFontsStylesheetUrl } from './adobe-fonts';

/** Built-in system fonts available without loading */
export const BUILT_IN_FONTS: Font[] = [
  {
    id: 'system-sans',
    name: 'sans',
    family: 'Sans Serif',
    type: 'default',
    variants: ['100', '200', '300', 'regular', '500', '600', '700', '800', '900'],
    weights: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
    category: 'sans-serif',
    is_published: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  },
  {
    id: 'system-serif',
    name: 'serif',
    family: 'Serif',
    type: 'default',
    variants: ['regular', '700'],
    weights: ['400', '700'],
    category: 'serif',
    is_published: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  },
  {
    id: 'system-mono',
    name: 'mono',
    family: 'Monospace',
    type: 'default',
    variants: ['regular', '700'],
    weights: ['400', '700'],
    category: 'monospace',
    is_published: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  },
];

/** All available font weight values */
export const FONT_WEIGHTS = [
  { value: '100', label: 'Thin' },
  { value: '200', label: 'Extra Light' },
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi Bold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra Bold' },
  { value: '900', label: 'Black' },
];

/** Allowed font file extensions */
export const ALLOWED_FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];
export const ALLOWED_FONT_MIME_TYPES = [
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/font-woff',
  'application/font-woff2',
  'application/octet-stream', // Common fallback for font files
];

/**
 * Convert a font family name to a Tailwind-compatible class name.
 * e.g., "Open Sans" → "font-[Open_Sans]"
 */
export function getFontClassName(family: string): string {
  // Built-in font families use standard Tailwind classes
  if (family === 'Sans Serif' || family === 'sans') return 'font-sans';
  if (family === 'Serif' || family === 'serif') return 'font-serif';
  if (family === 'Monospace' || family === 'mono') return 'font-mono';

  // Custom/Google fonts use arbitrary value syntax with underscores
  const sanitized = family.replace(/\s+/g, '_');
  return `font-[${sanitized}]`;
}

/**
 * Convert a font family name to the value stored in layer.design.typography.fontFamily
 */
export function getFontFamilyValue(font: Font): string {
  if (font.type === 'default') {
    return font.name; // 'sans', 'serif', 'mono'
  }
  if (font.type === 'adobe' && font.cssStack?.trim()) {
    return font.cssStack.trim();
  }
  return font.family;
}

/** Human-facing label; Adobe kit CSS names are intentionally kept out of UI copy. */
export function getFontDisplayName(font: Font): string {
  return font.displayName?.trim() || font.family;
}

/**
 * Splits a CSS font-family stack without breaking quoted names or functional
 * values. Keeping this here gives every design surface the same selection
 * semantics for values such as `"Neue Haas", Helvetica, sans-serif`.
 */
export function parseCssFontFamilyList(value: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (let index = 0; index < String(value || '').length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\' && index + 1 < value.length) {
        current += value[index + 1];
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = '';
        continue;
      }
      current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === ',' && depth === 0) {
      if (current.trim()) families.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) families.push(current.trim());
  return families;
}

/** Canonical comparison key used for CSS values, catalog names and aliases. */
export function normalizeFontFamilyName(value: string): string {
  const family = parseCssFontFamilyList(String(value || ''))[0] || '';
  return family
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/**
 * A saved design value may be a complete CSS fallback stack while a catalog
 * option stores only its primary family. Compare the primary family and the
 * optional project aliases so a generic fallback never makes two options
 * appear selected at once.
 */
export function fontFamilyValueMatches(
  value: string,
  font: Pick<Font, 'family' | 'name' | 'type'> & {
    aliases?: string[];
    cssNames?: string[];
    cssStack?: string | null;
    displayName?: string;
  },
): boolean {
  const primaryKey = normalizeFontFamilyName(parseCssFontFamilyList(value)[0] || '');
  if (!primaryKey) return false;
  const candidates = [
    font.family,
    font.name,
    font.displayName || '',
    ...(font.aliases || []),
    ...(font.cssNames || []),
    ...parseCssFontFamilyList(font.cssStack || ''),
    ...(font.type === 'default' && font.name === 'sans'
      ? ['Sans Serif', 'ui-sans-serif', 'system-ui', 'sans-serif']
      : []),
    ...(font.type === 'default' && font.name === 'serif'
      ? ['Serif', 'ui-serif', 'serif']
      : []),
    ...(font.type === 'default' && font.name === 'mono'
      ? ['Monospace', 'ui-monospace', 'monospace']
      : []),
  ];
  return candidates.some(candidate => primaryKey === normalizeFontFamilyName(candidate));
}

/**
 * Build a Google Fonts CSS2 API URL for a font.
 * Variants describe real style/weight pairs, not an italic × weight product.
 * Only explicit variable-axis metadata grants permission to request a range.
 */
export function buildGoogleFontUrl(font: Font): string {
  const family = encodeURIComponent(font.family.trim()).replace(/%20/g, '+');
  const axes = googleFontAxes(font.axes);
  const weightAxis = axes.get('wght');
  const italicAxis = axes.get('ital');
  const variants = Array.isArray(font.variants) ? font.variants : [];
  let styles = variants.flatMap(variant => {
    if (typeof variant !== 'string') return [];
    const normalized = variant.trim().toLowerCase();
    if (normalized === 'regular') return [{ italic: 0, weight: 400 }];
    if (normalized === 'italic') return [{ italic: 1, weight: 400 }];
    const match = normalized.match(/^(\d{1,4})(italic)?$/);
    const weight = match ? Number(match[1]) : 0;
    return weight >= 1 && weight <= 1000 ? [{ italic: match![2] ? 1 : 0, weight }] : [];
  });
  // Catalog variants are authoritative. The weight-only legacy field cannot
  // tell us which weights exist in italic, so use it only without variants.
  if (!styles.length && Array.isArray(font.weights)) {
    styles = font.weights.flatMap(value => {
      const weight = typeof value === 'string' && /^\d{1,4}$/.test(value.trim()) ? Number(value) : 0;
      return weight >= 1 && weight <= 1000 ? [{ italic: italicAxis?.start === 1 ? 1 : 0, weight }] : [];
    });
  }
  const hasWeight = Boolean(weightAxis || styles.length);
  if (italicAxis) {
    styles = styles.filter(style => style.italic >= italicAxis.start && style.italic <= italicAxis.end);
  }
  if (!styles.length) {
    const italicValues = italicAxis
      ? [0, 1].filter(value => value >= italicAxis.start && value <= italicAxis.end)
      : [0];
    styles = italicValues.map(italic => ({ italic, weight: 400 }));
  }
  const tags = new Set(axes.keys());
  if (hasWeight) tags.add('wght');
  if (styles.some(style => style.italic === 1)) tags.add('ital');
  const orderedTags = [...tags].sort(googleFontAxisOrder);
  if (!orderedTags.length) return `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  const tuples = [...new Set(styles.map(style => orderedTags.map(tag => {
    if (tag === 'ital') return String(style.italic);
    if (tag === 'wght' && !weightAxis) return String(style.weight);
    const axis = axes.get(tag)!;
    return axis.start === axis.end ? String(axis.start) : `${axis.start}..${axis.end}`;
  }).join(',')))].sort((left, right) => {
    const a = left.split(',').map(parseFloat);
    const b = right.split(',').map(parseFloat);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
  });
  return `https://fonts.googleapis.com/css2?family=${family}:${orderedTags.join(',')}@${tuples.join(';')}&display=swap`;
}

function googleFontAxes(value: Font['axes']): Map<string, FontAxis> {
  const axes = new Map<string, FontAxis>();
  for (const axis of Array.isArray(value) ? value : []) {
    if (!axis || typeof axis.tag !== 'string' || !/^[a-zA-Z]{4}$/.test(axis.tag)
      || !Number.isFinite(axis.start) || !Number.isFinite(axis.end) || axis.start > axis.end) continue;
    if (axis.tag === 'wght' && (axis.start < 1 || axis.end > 1000)) continue;
    if (axis.tag === 'ital' && (axis.start < 0 || axis.end > 1 || (axis.start > 0 && axis.end < 1))) continue;
    if (['opsz', 'wdth'].includes(axis.tag) && axis.start <= 0) continue;
    // Duplicate catalog axes must not produce duplicate columns or overlapping
    // range tuples. Keep the first valid definition, without widening ranges.
    if (!axes.has(axis.tag)) axes.set(axis.tag, axis);
  }
  return axes;
}

function googleFontAxisOrder(left: string, right: string) {
  // CSS2 places registered lowercase axes before uppercase custom axes. The
  // official Material Symbols example is opsz,wght,FILL,GRAD, not GRAD,...wght.
  const leftCustom = /^[A-Z]/.test(left);
  const rightCustom = /^[A-Z]/.test(right);
  if (leftCustom !== rightCustom) return Number(leftCustom) - Number(rightCustom);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Extract numeric weights from variant names (e.g., "700italic" → "700", "regular" → "400") */
function extractWeightsFromVariants(variants: string[]): string[] {
  const weights = new Set<string>();
  for (const v of variants) {
    if (v === 'regular' || v === 'italic') {
      weights.add('400');
    } else if (!isNaN(Number(v))) {
      weights.add(v);
    } else {
      const match = v.match(/^(\d+)/);
      if (match) weights.add(match[1]);
    }
  }
  return Array.from(weights);
}

/**
 * Get available Tailwind weights for a font.
 * Variable fonts derive weights from the wght axis range.
 */
export function getFontAvailableWeights(font: Font): string[] {
  const wghtAxis = font.axes?.find(a => a.tag === 'wght');
  if (wghtAxis) {
    const weights: string[] = [];
    for (let w = Math.max(wghtAxis.start, 100); w <= Math.min(wghtAxis.end, 900); w += 100) {
      weights.push(String(w));
    }
    return weights;
  }

  if (font.weights && font.weights.length > 0) {
    return font.weights;
  }

  return extractWeightsFromVariants(font.variants || []);
}

/**
 * Map file extension to CSS @font-face format string
 */
export function mapExtensionToFontFormat(extension: string): string | null {
  switch (extension.toLowerCase()) {
    case 'eot': return 'embedded-opentype';
    case 'otf': return 'opentype';
    case 'ttf': return 'truetype';
    case 'woff': return 'woff';
    case 'woff2': return 'woff2';
    default: return null;
  }
}

/**
 * Build CSS for loading all installed fonts.
 * Generates @import rules for Google fonts and @font-face for custom fonts.
 */
export function buildFontsCss(fonts: Font[]): string {
  let css = '';
  const importedAdobeStylesheets = new Set<string>();

  for (const font of fonts) {
    if (font.type === 'google') {
      const url = buildGoogleFontUrl(font);
      css += `@import url('${url}');`;
    }

    if (font.type === 'adobe') {
      const url = buildAdobeFontStylesheetUrl(font);
      if (url && !importedAdobeStylesheets.has(url)) {
        importedAdobeStylesheets.add(url);
        css += `@import url('${url}');`;
      }
    }

    if (font.type === 'custom' && font.url) {
      const family = font.family.replace(/"/g, '\\"');
      const format = font.kind || 'woff2';
      css += `@font-face {font-family: "${family}";src: url("${font.url}") format("${format}");font-display: swap;}`;
    }
  }

  return css;
}

/** Get Google Font stylesheet URLs for <link> elements (more reliable than @import) */
export function getGoogleFontLinks(fonts: Font[]): string[] {
  return fonts
    .filter(f => f.type === 'google')
    .map(f => buildGoogleFontUrl(f));
}

export type FontStylesheetProvider = 'google' | 'adobe';

export interface FontStylesheetResource {
  provider: FontStylesheetProvider;
  family: string;
  href: string;
  version: string;
}

/**
 * Build the browser URL from a backend-validated Adobe host and an internal
 * cache generation. Query strings supplied by the backend are never accepted.
 */
export function buildAdobeFontStylesheetUrl(font: Font): string {
  if (font.type !== 'adobe') return '';
  const baseUrl = normalizeAdobeFontsStylesheetUrl(
    font.stylesheet_url,
    font.provider_project_id,
  );
  if (!baseUrl) return '';
  const version = String(font.stylesheet_version || '').trim();
  if (!version) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set('v', version.slice(0, 200));
  return url.href;
}

/** Stylesheet resources for every supported hosted provider, de-duplicated. */
export function getFontStylesheetResources(fonts: Font[]): FontStylesheetResource[] {
  const resources = new Map<string, FontStylesheetResource>();
  fonts.forEach(font => {
    if (font.type === 'google') {
      const href = buildGoogleFontUrl(font);
      resources.set(`google:${href}`, {
        provider: 'google',
        family: font.family,
        href,
        version: '',
      });
      return;
    }
    if (font.type !== 'adobe') return;
    const href = buildAdobeFontStylesheetUrl(font);
    if (!href) return;
    const projectId = String(font.provider_project_id || href);
    resources.set(`adobe:${projectId}`, {
      provider: 'adobe',
      family: font.family,
      href,
      version: String(font.stylesheet_version || ''),
    });
  });
  return Array.from(resources.values());
}

export function getFontStylesheetLinks(fonts: Font[]): string[] {
  return getFontStylesheetResources(fonts).map(resource => resource.href);
}

/**
 * Keep Canvas font loading scoped to families that the rendered surface can
 * actually reference. The installed catalog is a picker library, not a page
 * dependency list; loading every entry turns one selected Google face into a
 * fan-out of unrelated stylesheet and WOFF requests.
 */
export function fontsReferencedBySources(fonts: Font[], sources: string[]): Font[] {
  const haystack = sources.join('\n').toLocaleLowerCase();
  if (!haystack) return [];

  return fonts.filter(font => {
    if (font.type === 'default') return true;
    const family = String(font.family || '').trim();
    const name = String(font.name || '').trim();
    const references = [
      family,
      name,
      font.displayName || '',
      ...(font.aliases || []),
      ...(font.cssNames || []),
      ...parseCssFontFamilyList(font.cssStack || ''),
      getFontFamilyValue(font),
      getFontClassName(family),
      family.replace(/\s+/g, '_'),
      family.replace(/\s+/g, '-'),
    ];
    return references.some(reference => (
      reference && haystack.includes(reference.toLocaleLowerCase())
    ));
  });
}

/**
 * Modern Chrome User-Agent. Google Fonts varies its CSS response by UA —
 * sending a recent Chrome UA reliably returns woff2 with `unicode-range`
 * subset rules, which is what we want to inline.
 */
const MODERN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Fetch the resolved @font-face rules for the given Google Fonts CSS URLs and
 * return them as a single CSS string suitable for inlining in <style>.
 *
 * Inlining the CSS skips the round-trip to fonts.googleapis.com — the browser
 * can start fetching the woff2 binaries directly while parsing the document.
 *
 * Returns an empty string if any URL fails to fetch so the caller can fall
 * back to <link rel="stylesheet"> without partially breaking font loading.
 */
export async function fetchGoogleFontsCss(urls: string[]): Promise<string> {
  if (urls.length === 0) return '';

  try {
    const responses = await Promise.all(
      urls.map((url) =>
        fetch(url, {
          headers: { 'User-Agent': MODERN_UA },
          signal: AbortSignal.timeout(5000),
        }),
      ),
    );

    if (responses.some((r) => !r.ok)) return '';

    const cssBlocks = await Promise.all(responses.map((r) => r.text()));
    return cssBlocks.join('\n');
  } catch {
    return '';
  }
}

/** Build CSS for custom fonts only (@font-face rules, no @import) */
export function buildCustomFontsCss(fonts: Font[]): string {
  let css = '';

  for (const font of fonts) {
    if (font.type === 'custom' && font.url) {
      const family = font.family.replace(/"/g, '\\"');
      const format = font.kind || 'woff2';
      css += `@font-face {font-family: "${family}";src: url("${font.url}") format("${format}");font-display: swap;}`;
    }
  }

  return css;
}

/**
 * Build CSS class rules for font-family declarations.
 * Creates Tailwind-compatible CSS rules that map class names to font-family values.
 */
export function buildFontClassesCss(fonts: Font[]): string {
  let css = '';

  for (const font of fonts) {
    if (font.type === 'default') continue; // Built-in fonts handled by Tailwind defaults

    const { family, category } = font;
    const className = getFontClassName(family);

    let fontFamilyValue = font.type === 'adobe' && font.cssStack?.trim()
      ? font.cssStack.trim()
      : `"${family}"`;
    if (category && !(font.type === 'adobe' && font.cssStack?.trim())) {
      fontFamilyValue += `, ${category}`;
    }

    // Base class
    css += `.${escapeClassName(className)} { font-family: ${fontFamilyValue}; } `;

    // Pseudo-state variants
    const states = ['hover', 'focus', 'active', 'disabled', 'current'];
    for (const state of states) {
      css += `.${state}\\:${escapeClassName(className)}:${state} { font-family: ${fontFamilyValue}; } `;
    }
  }

  return css;
}

/**
 * Build complete font CSS (imports + class rules)
 */
export function buildAllFontsCss(fonts: Font[]): string {
  return buildFontsCss(fonts) + buildFontClassesCss(fonts);
}

/**
 * Escape CSS class name for use in selectors
 */
function escapeClassName(className: string): string {
  return className
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}
