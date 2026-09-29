import type {
  FontLibraryFont,
  FontLibraryGoogleFont,
  FontLibraryTransport,
} from './editor-platform-services';
import { editorCapabilityUnsupported } from './editor-platform-services';
import { normalizeAdobeFontsCatalogSnapshot } from './adobe-fonts';

export interface NextFontLibraryTransportDependencies {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  createFormData?: () => FormData;
}

interface GoogleMetadataFamily {
  family?: unknown;
  variants?: unknown;
  fonts?: unknown;
  category?: unknown;
  axes?: unknown;
}

function cloneFont(font: FontLibraryFont): FontLibraryFont {
  return {
    ...font,
    variants: [...font.variants],
    weights: [...font.weights],
    ...(font.axes ? { axes: font.axes.map(axis => ({ ...axis })) } : {}),
  };
}

function cloneFonts(fonts: readonly FontLibraryFont[]) {
  return fonts.map(cloneFont);
}

function isFont(value: unknown): value is FontLibraryFont {
  if (!value || typeof value !== 'object') return false;
  const font = value as Partial<FontLibraryFont>;
  return typeof font.id === 'string'
    && typeof font.name === 'string'
    && typeof font.family === 'string'
    && Array.isArray(font.variants)
    && Array.isArray(font.weights);
}

function normalizeFontList(value: unknown): FontLibraryFont[] {
  const candidates = Array.isArray(value) ? value : value ? [value] : [];
  return candidates.filter(isFont).map(cloneFont);
}

function mergeFonts(
  current: readonly FontLibraryFont[],
  incoming: readonly FontLibraryFont[],
) {
  const incomingIds = new Set(incoming.map(font => font.id));
  return [
    ...current.filter(font => !incomingIds.has(font.id)).map(cloneFont),
    ...incoming.map(cloneFont),
  ];
}

function normalizeCategory(value: unknown) {
  const category = String(value || 'sans-serif')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return ['serif', 'sans-serif', 'display', 'handwriting', 'monospace'].includes(category)
    ? category
    : 'sans-serif';
}

function normalizeAxes(value: unknown): NonNullable<FontLibraryGoogleFont['axes']> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const axis = candidate as {
      tag?: unknown;
      start?: unknown;
      end?: unknown;
      min?: unknown;
      max?: unknown;
    };
    const tag = typeof axis.tag === 'string' ? axis.tag.trim() : '';
    const start = axis.start ?? axis.min;
    const end = axis.end ?? axis.max;
    return tag
      && typeof start === 'number'
      && Number.isFinite(start)
      && typeof end === 'number'
      && Number.isFinite(end)
      ? [{ tag, start, end }]
      : [];
  });
}

function normalizeVariants(family: GoogleMetadataFamily) {
  if (Array.isArray(family.variants)) {
    const variants = family.variants
      .filter((variant): variant is string => typeof variant === 'string')
      .map(variant => variant.trim())
      .filter(Boolean);
    if (variants.length) return variants;
  }
  if (family.fonts && typeof family.fonts === 'object' && !Array.isArray(family.fonts)) {
    const variants = Object.keys(family.fonts).map(variant => {
      const italic = variant.match(/^(\d+)i$/);
      if (italic) return `${italic[1]}italic`;
      return variant === '400' ? 'regular' : variant;
    });
    if (variants.length) return variants;
  }
  return ['regular'];
}

function normalizeGoogleFont(value: unknown): FontLibraryGoogleFont | null {
  if (!value || typeof value !== 'object') return null;
  const family = value as GoogleMetadataFamily;
  const name = typeof family.family === 'string' ? family.family.trim() : '';
  if (!name) return null;
  const axes = normalizeAxes(family.axes);
  return {
    family: name,
    variants: normalizeVariants(family),
    category: normalizeCategory(family.category),
    ...(axes.length ? { axes } : {}),
  };
}

function normalizeGoogleCatalog(payload: unknown): FontLibraryGoogleFont[] {
  if (!payload || typeof payload !== 'object') return [];
  const candidate = payload as {
    data?: unknown;
    familyMetadataList?: unknown;
    family?: unknown;
  };
  const families = Array.isArray(candidate.data)
    ? candidate.data
    : Array.isArray(candidate.familyMetadataList)
      ? candidate.familyMetadataList
      : Array.isArray(candidate.family)
        ? candidate.family
        : [];
  return families
    .map(normalizeGoogleFont)
    .filter((font): font is FontLibraryGoogleFont => Boolean(font));
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function payloadData(payload: unknown): unknown {
  return payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : payload;
}

function payloadMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const message = (payload as { error?: unknown; message?: unknown }).error
    ?? (payload as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function googleFontWeights(font: FontLibraryGoogleFont) {
  const weightAxis = font.axes?.find(axis => axis.tag === 'wght');
  if (weightAxis) {
    const weights: string[] = [];
    for (
      let weight = Math.max(weightAxis.start, 100);
      weight <= Math.min(weightAxis.end, 900);
      weight += 100
    ) {
      weights.push(String(weight));
    }
    if (weights.length) return weights;
  }
  const weights = font.variants
    .map(variant => {
      if (variant === 'regular') return '400';
      if (variant === 'italic') return null;
      if (!Number.isNaN(Number(variant))) return variant;
      return variant.match(/^\d+/)?.[0] || null;
    })
    .filter((weight): weight is string => weight !== null)
    .filter((weight, index, values) => values.indexOf(weight) === index);
  return weights.length ? weights : ['400', '700'];
}

function assertDependencies(dependencies: NextFontLibraryTransportDependencies) {
  if (!dependencies || typeof dependencies.fetch !== 'function') {
    throw new TypeError('NextFontLibraryTransport requires an injected fetch implementation.');
  }
  if (dependencies.createFormData && typeof dependencies.createFormData !== 'function') {
    throw new TypeError('createFormData must be a function when provided.');
  }
}

/**
 * Compatibility leaf for the legacy web/Next font routes. Shared stores must
 * never import this module, otherwise the WordPress bundle regains those URLs.
 */
export function createNextFontLibraryTransport(
  dependencies: NextFontLibraryTransportDependencies,
): FontLibraryTransport {
  assertDependencies(dependencies);
  const createFormData = dependencies.createFormData || (() => new FormData());

  return Object.freeze<FontLibraryTransport>({
    kind: 'next',
    capabilities: Object.freeze({
      synchronousInstalledFontsSnapshot: false,
      readInstalledFonts: true,
      persistInstalledFonts: false,
      googleFontsCatalog: true,
      adobeFontsCatalog: true,
      resyncAdobeFontsCatalog: true,
      installGoogleFont: true,
      uploadCustomFonts: true,
      removeFontAssociation: true,
      deleteRemoteMedia: false,
    }),

    readInstalledFontsSnapshot() {
      return [];
    },

    async loadInstalledFonts() {
      const response = await dependencies.fetch('/kodety/api/fonts');
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Failed to fetch fonts'));
      }
      return normalizeFontList(payloadData(payload));
    },

    replaceInstalledFonts(fonts) {
      return cloneFonts(fonts);
    },

    upsertInstalledFont(font, installedFonts) {
      return mergeFonts(installedFonts, [font]);
    },

    async loadGoogleFontsCatalog() {
      let response = await dependencies.fetch('/kodety/api/fonts/google');
      if (!response.ok) {
        response = await dependencies.fetch('https://fonts.google.com/metadata/fonts');
      }
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Failed to load Google Fonts catalog'));
      }
      const fonts = normalizeGoogleCatalog(payload);
      if (!fonts.length) throw new Error('The Google Fonts catalog is empty.');
      return fonts;
    },

    async loadAdobeFontsCatalog() {
      const response = await dependencies.fetch('/kodety/api/fonts/adobe', {
        cache: 'no-store',
      });
      const payload = await responsePayload(response);
      if (response.status === 403 || response.status === 404) {
        throw editorCapabilityUnsupported(
          'font-library.adobe-catalog',
          'Adobe Fonts is not available in this runtime.',
        );
      }
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Failed to load the Adobe Fonts catalog'));
      }
      return normalizeAdobeFontsCatalogSnapshot(payload);
    },

    async resyncAdobeFontsCatalog() {
      const response = await dependencies.fetch('/kodety/api/fonts/adobe/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
        cache: 'no-store',
      });
      const payload = await responsePayload(response);
      if (response.status === 403 || response.status === 404) {
        throw editorCapabilityUnsupported(
          'font-library.adobe-resync',
          'Adobe Fonts sync is not available in this runtime.',
        );
      }
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Failed to resync the Adobe Fonts catalog'));
      }
      return normalizeAdobeFontsCatalogSnapshot(payload);
    },

    async uploadCustomFonts(files, installedFonts) {
      const body = createFormData();
      for (const file of files) body.append('file', file);
      const response = await dependencies.fetch('/kodety/api/fonts', {
        method: 'POST',
        body,
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Failed to upload fonts'));
      }
      const uploadedFonts = normalizeFontList(payloadData(payload));
      return {
        uploadedFonts,
        installedFonts: mergeFonts(installedFonts, uploadedFonts),
      };
    },

    async addGoogleFont(googleFont, installedFonts) {
      const slug = googleFont.family.toLowerCase().replace(/\s+/g, '-');
      const existing = installedFonts.find(font => font.name === slug);
      if (existing) {
        return {
          installedFonts: cloneFonts(installedFonts),
          font: cloneFont(existing),
          added: false,
        };
      }
      const response = await dependencies.fetch('/kodety/api/fonts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: slug,
          family: googleFont.family,
          type: 'google',
          variants: [...googleFont.variants],
          weights: googleFontWeights(googleFont),
          category: googleFont.category,
          ...(googleFont.axes?.length
            ? { axes: googleFont.axes.map(axis => ({ ...axis })) }
            : {}),
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Failed to add Google Font'));
      }
      const font = normalizeFontList(payloadData(payload))[0] || null;
      return {
        installedFonts: font ? mergeFonts(installedFonts, [font]) : cloneFonts(installedFonts),
        font,
        added: Boolean(font),
      };
    },

    async removeFontAssociation(fontId, installedFonts) {
      const response = await dependencies.fetch(
        `/kodety/api/fonts/${encodeURIComponent(fontId)}`,
        { method: 'DELETE' },
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Failed to delete font'));
      }
      const removed = installedFonts.some(font => font.id === fontId);
      return {
        installedFonts: installedFonts
          .filter(font => font.id !== fontId)
          .map(cloneFont),
        removed,
        // The legacy response does not prove that remote object storage was deleted.
        remoteMediaDeleted: false,
      };
    },
  });
}
