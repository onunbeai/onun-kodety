import { mapExtensionToFontFormat } from '../../lib/font-utils';
import { normalizeAdobeFontsCatalogSnapshot } from '../../lib/adobe-fonts';
import {
  editorCapabilityUnsupported,
  type FontLibraryFont,
  type FontLibraryGoogleFont,
  type FontLibraryTransport,
} from '../../lib/editor-platform-services';

export const WORDPRESS_FONT_LIBRARY_STORAGE_KEY = 'kodety:wordpress-fonts';

export interface WordPressFontLibraryTransportConfig {
  googleFontsUrl?: string;
  adobeFontsUrl?: string;
  adobeFontsSyncUrl?: string;
  mediaUploadUrl?: string;
  nonce?: string;
}

export interface WordPressFontLibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WordPressFontLibraryTransportDependencies {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  storage: WordPressFontLibraryStorage;
  createFormData?: () => FormData;
  now?: () => number;
}

interface GoogleMetadataFamily {
  family?: unknown;
  variants?: unknown;
  fonts?: unknown;
  category?: unknown;
  axes?: unknown;
}

interface WordPressMediaResponse {
  id?: unknown;
  source_url?: unknown;
  slug?: unknown;
  title?: { rendered?: unknown };
  message?: unknown;
}

function configuredUrl(value: string | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function cloneFont(font: FontLibraryFont): FontLibraryFont {
  const candidate = font as FontLibraryFont & {
    variants?: unknown;
    weights?: unknown;
    axes?: unknown;
  };
  return {
    ...font,
    ...(Array.isArray(candidate.variants) ? { variants: [...candidate.variants] } : {}),
    ...(Array.isArray(candidate.weights) ? { weights: [...candidate.weights] } : {}),
    ...(Array.isArray(candidate.axes)
      ? { axes: candidate.axes.map(axis => (
        axis && typeof axis === 'object' ? { ...axis } : axis
      )) }
      : {}),
  } as FontLibraryFont;
}

function isStoredFont(value: unknown): value is FontLibraryFont {
  if (!value || typeof value !== 'object') return false;
  const font = value as Partial<FontLibraryFont>;
  return typeof font.id === 'string';
}

function normalizeInstalledFonts(value: unknown): FontLibraryFont[] {
  return Array.isArray(value)
    ? value.filter(isStoredFont).map(cloneFont)
    : [];
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

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function payloadMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const message = (payload as { message?: unknown; error?: unknown }).message
    ?? (payload as { error?: unknown }).error;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function assertDependencies(
  dependencies: WordPressFontLibraryTransportDependencies,
): void {
  if (!dependencies || typeof dependencies.fetch !== 'function') {
    throw new TypeError('WordPressFontLibraryTransport requires an injected fetch implementation.');
  }
  if (
    !dependencies.storage
    || typeof dependencies.storage.getItem !== 'function'
    || typeof dependencies.storage.setItem !== 'function'
  ) {
    throw new TypeError('WordPressFontLibraryTransport requires injected local storage.');
  }
  if (dependencies.createFormData && typeof dependencies.createFormData !== 'function') {
    throw new TypeError('createFormData must be a function when provided.');
  }
}

/**
 * WordPress owns only associations in the editor font library. Removing an
 * association never promises to delete the underlying Media Library item.
 */
export function createWordPressFontLibraryTransport(
  config: WordPressFontLibraryTransportConfig,
  dependencies: WordPressFontLibraryTransportDependencies,
): FontLibraryTransport {
  assertDependencies(dependencies);
  const googleFontsUrl = configuredUrl(config.googleFontsUrl);
  const adobeFontsUrl = configuredUrl(config.adobeFontsUrl);
  const adobeFontsSyncUrl = configuredUrl(config.adobeFontsSyncUrl);
  const mediaUploadUrl = configuredUrl(config.mediaUploadUrl);
  const nonce = typeof config.nonce === 'string' ? config.nonce : '';
  const now = dependencies.now || Date.now;
  const createFormData = dependencies.createFormData || (() => new FormData());

  const readInstalledFonts = () => {
    try {
      const raw = dependencies.storage.getItem(WORDPRESS_FONT_LIBRARY_STORAGE_KEY);
      return normalizeInstalledFonts(JSON.parse(raw || '[]'));
    } catch {
      return [];
    }
  };

  const persistInstalledFonts = (fonts: readonly FontLibraryFont[]) => {
    const snapshot = fonts.map(cloneFont);
    try {
      dependencies.storage.setItem(
        WORDPRESS_FONT_LIBRARY_STORAGE_KEY,
        JSON.stringify(snapshot),
      );
    } catch {
      // Matches the current WordPress behavior: storage pressure must not
      // block project CSS, whose files remain the canonical publication data.
    }
    return snapshot;
  };

  const requestAdobeFontsCatalog = async (force: boolean) => {
    const url = force ? adobeFontsSyncUrl : adobeFontsUrl;
    if (!url) {
      throw editorCapabilityUnsupported(
        force ? 'font-library.adobe-resync' : 'font-library.adobe-catalog',
        'O Adobe Fonts não está disponível neste WordPress.',
      );
    }
    const response = await dependencies.fetch(url, {
      ...(force
        ? {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-WP-Nonce': nonce,
            },
            body: JSON.stringify({ force: true }),
          }
        : {
            headers: { 'X-WP-Nonce': nonce },
          }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = await responsePayload(response);
    if (response.status === 403) {
      throw editorCapabilityUnsupported(
        force ? 'font-library.adobe-resync' : 'font-library.adobe-catalog',
        'O Adobe Fonts não está habilitado neste WordPress.',
      );
    }
    if (!response.ok) {
      throw new Error(payloadMessage(payload, force
        ? 'Não foi possível ressincronizar o Adobe Fonts.'
        : 'Não foi possível carregar o catálogo do Adobe Fonts.'));
    }
    return normalizeAdobeFontsCatalogSnapshot(payload);
  };

  const transport: FontLibraryTransport = {
    kind: 'wordpress',
    capabilities: Object.freeze({
      synchronousInstalledFontsSnapshot: true,
      readInstalledFonts: true,
      persistInstalledFonts: true,
      googleFontsCatalog: Boolean(googleFontsUrl),
      adobeFontsCatalog: Boolean(adobeFontsUrl),
      resyncAdobeFontsCatalog: Boolean(adobeFontsSyncUrl),
      installGoogleFont: true,
      uploadCustomFonts: Boolean(mediaUploadUrl),
      removeFontAssociation: true,
      deleteRemoteMedia: false,
    }),

    readInstalledFontsSnapshot() {
      return readInstalledFonts();
    },

    async loadInstalledFonts() {
      return readInstalledFonts();
    },

    replaceInstalledFonts(fonts) {
      return persistInstalledFonts(fonts);
    },

    upsertInstalledFont(font, installedFonts) {
      return persistInstalledFonts(mergeFonts(installedFonts, [font]));
    },

    async loadGoogleFontsCatalog() {
      if (!googleFontsUrl) {
        throw editorCapabilityUnsupported(
          'font-library.google-catalog',
          'O catálogo do Google Fonts não está disponível neste WordPress.',
        );
      }
      const response = await dependencies.fetch(googleFontsUrl, {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': nonce },
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(payloadMessage(payload, 'Não foi possível carregar o catálogo do Google Fonts.'));
      }
      const fonts = normalizeGoogleCatalog(payload);
      if (!fonts.length) throw new Error('O WordPress retornou um catálogo de fontes vazio.');
      return fonts;
    },

    async loadAdobeFontsCatalog() {
      return requestAdobeFontsCatalog(false);
    },

    async resyncAdobeFontsCatalog() {
      return requestAdobeFontsCatalog(true);
    },

    async uploadCustomFonts(files, installedFonts) {
      if (!mediaUploadUrl) {
        throw editorCapabilityUnsupported(
          'font-library.custom-upload',
          'O envio de fontes exige permissão para enviar mídia neste WordPress.',
        );
      }
      const uploadedFonts: FontLibraryFont[] = [];
      for (const file of files) {
        const body = createFormData();
        body.append('file', file);
        body.append('title', file.name.replace(/\.[^.]+$/, ''));
        const response = await dependencies.fetch(mediaUploadUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-WP-Nonce': nonce },
          body,
        });
        const payload = await responsePayload(response) as WordPressMediaResponse | null;
        if (!response.ok) {
          throw new Error(payloadMessage(payload, `Não foi possível enviar ${file.name}.`));
        }
        const mediaId = Number(payload?.id);
        const sourceUrl = typeof payload?.source_url === 'string'
          ? payload.source_url.trim()
          : '';
        if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !sourceUrl) {
          throw new Error(`O WordPress não retornou a URL de ${file.name}.`);
        }
        const extension = file.name.split('.').pop()?.toLowerCase() || 'woff2';
        const renderedTitle = typeof payload?.title?.rendered === 'string'
          ? payload.title.rendered
          : '';
        const mediaSlug = typeof payload?.slug === 'string' ? payload.slug : '';
        const family = (renderedTitle || mediaSlug || file.name.replace(/\.[^.]+$/, ''))
          .replace(/[-_]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const slug = family
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const timestamp = new Date(now()).toISOString();
        uploadedFonts.push({
          id: `wp-media-${mediaId}`,
          name: slug || `font-${mediaId}`,
          family: family || file.name,
          type: 'custom',
          variants: ['regular'],
          weights: ['400'],
          category: 'sans-serif',
          kind: mapExtensionToFontFormat(extension) || extension,
          url: sourceUrl,
          is_published: false,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
        });
      }
      const nextFonts = persistInstalledFonts(mergeFonts(installedFonts, uploadedFonts));
      return { installedFonts: nextFonts, uploadedFonts: uploadedFonts.map(cloneFont) };
    },

    async addGoogleFont(googleFont, installedFonts) {
      const existing = installedFonts.find(font => (
        font.type === 'google' && font.family === googleFont.family
      ));
      if (existing) {
        return {
          installedFonts: installedFonts.map(cloneFont),
          font: cloneFont(existing),
          added: false,
        };
      }
      const slug = googleFont.family.toLowerCase().replace(/\s+/g, '-');
      const timestamp = new Date(now()).toISOString();
      const font: FontLibraryFont = {
        id: `google-${slug}`,
        name: slug,
        family: googleFont.family,
        type: 'google',
        variants: [...googleFont.variants],
        weights: googleFont.variants
          .map(variant => (
            variant === 'regular' || variant === 'italic'
              ? '400'
              : variant.match(/^\d+/)?.[0] || ''
          ))
          .filter(Boolean),
        category: googleFont.category,
        axes: googleFont.axes?.map(axis => ({ ...axis })),
        is_published: false,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      };
      const nextFonts = persistInstalledFonts(mergeFonts(installedFonts, [font]));
      return { installedFonts: nextFonts, font: cloneFont(font), added: true };
    },

    async removeFontAssociation(fontId, installedFonts) {
      const removed = installedFonts.some(font => font.id === fontId);
      const nextFonts = persistInstalledFonts(
        installedFonts.filter(font => font.id !== fontId),
      );
      return {
        installedFonts: nextFonts,
        removed,
        remoteMediaDeleted: false,
      };
    },
  };

  return Object.freeze(transport);
}
