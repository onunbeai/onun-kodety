import type { Font } from '@/types';
import { getFontLibraryTransport, type FontLibraryGoogleFont, type FontLibraryTransport } from '../editor-platform-services';
import { normalizeFontFamilyName } from '../font-utils';
import { normalizeProjectGoogleFonts, serializeProjectGoogleFonts } from '../html-editor/google-fonts';
import { discoverProjectFonts } from '../html-editor/project-fonts';
import { readEditorMetadata, updateEditorMetadata } from '../html-editor/project-io';
import type { HtmlProject } from '../html-editor/types';
import type { KodetyFigmaFont } from './types';

const catalogCache = new WeakMap<FontLibraryTransport, FontLibraryGoogleFont[]>();
const pendingCatalogs = new WeakMap<FontLibraryTransport, Promise<FontLibraryGoogleFont[]>>();

/** Read the platform's complete Google catalog, without installing account fonts. */
export async function loadFigmaGoogleFontsCatalog(): Promise<FontLibraryGoogleFont[]> {
  const transport = getFontLibraryTransport();
  const cached = catalogCache.get(transport);
  if (cached?.length) return cached;
  const pending = pendingCatalogs.get(transport);
  if (pending) return pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.race([
    transport.loadGoogleFontsCatalog(),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Google Fonts catalog timed out')), 8000);
    }),
  ]).then(catalog => {
    if (!catalog.length || catalog.length > 20_000) throw new Error('Google Fonts catalog unavailable');
    catalogCache.set(transport, catalog);
    return catalog;
  }).finally(() => {
    if (timer) clearTimeout(timer);
    pendingCatalogs.delete(transport);
  });
  pendingCatalogs.set(transport, request);
  return request;
}

export function googleFontSupportsFigmaFace(font: Font, requested: KodetyFigmaFont) {
  if (/oblique/i.test(requested.style)) return false;
  const italic = /italic/i.test(requested.style);
  const variants = font.variants || [];
  const weight = Math.round(requested.weight);
  const axis = font.axes?.find(item => item.tag === 'wght');
  const styleAvailable = variants.some(variant => /italic$/.test(variant) === italic);
  if (axis && styleAvailable && weight >= axis.start && weight <= axis.end) return true;
  return variants.some(variant => {
    const variantWeight = Number(variant.replace(/italic$/, '')) || 400;
    return /italic$/.test(variant) === italic && variantWeight === weight;
  });
}

/** Project-scoped dependencies survive reopen, preview and publication. */
export function registerFigmaGoogleFonts(
  project: HtmlProject,
  requested: KodetyFigmaFont[],
  catalog: readonly FontLibraryGoogleFont[],
) {
  const metadata = readEditorMetadata(project);
  const existing = normalizeProjectGoogleFonts(metadata.googleFonts);
  const available = normalizeProjectGoogleFonts(catalog);
  const byFamily = new Map(available.map(font => [normalizeFontFamilyName(font.family), font]));
  const localFamilies = new Set(discoverProjectFonts(project).fonts
    .filter(font => font.faces.some(face => face.sources.some(source => source.filePath)))
    .flatMap(font => [font.family, ...font.aliases].map(normalizeFontFamilyName)));
  requested.filter(font => font.assetId).forEach(font => localFamilies.add(normalizeFontFamilyName(font.family)));
  const additions = new Map<string, Font>();
  for (const face of requested) {
    const key = normalizeFontFamilyName(face.family);
    if (localFamilies.has(key)) continue;
    const match = byFamily.get(key);
    if (match && googleFontSupportsFigmaFace(match, face)) additions.set(key, match);
  }
  if (!additions.size) return project;
  const googleFonts = serializeProjectGoogleFonts(normalizeProjectGoogleFonts([...existing, ...additions.values()]));
  if (JSON.stringify(googleFonts) === JSON.stringify(metadata.googleFonts)) return project;
  return updateEditorMetadata(project, current => ({ ...current, googleFonts }));
}
