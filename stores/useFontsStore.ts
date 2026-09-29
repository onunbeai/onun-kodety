/**
 * Fonts Store
 *
 * Global store for managing installed fonts (Google + custom).
 * Handles font loading, CSS injection, and font selection.
 */

import { create } from 'zustand';
import {
  buildAllFontsCss,
  buildFontClassesCss,
  BUILT_IN_FONTS,
  fontFamilyValueMatches,
  getFontStylesheetResources,
  getFontFamilyValue,
  normalizeFontFamilyName,
} from '@/lib/font-utils';
import {
  getFontLibraryTransport,
  isEditorCapabilityUnsupportedError,
  type FontLibraryGoogleFont,
} from '@/lib/editor-platform-services';
import {
  createProjectFontRuntime,
  projectFontSourceSignature,
  type ProjectFont,
  type ProjectFontRuntime,
} from '@/lib/html-editor/project-fonts';
import { projectGoogleFonts as getProjectGoogleFonts } from '@/lib/html-editor/project-io';
import type { HtmlProject } from '@/lib/html-editor/types';
import type { Font } from '@/types';

interface GoogleFontResult {
  family: string;
  variants: string[];
  category: string;
  axes?: Array<{
    tag: string;
    start: number;
    end: number;
  }>;
}

function mutableGoogleFont(font: FontLibraryGoogleFont): GoogleFontResult {
  return {
    family: font.family,
    variants: [...font.variants],
    category: font.category,
    ...(font.axes ? { axes: font.axes.map(axis => ({ ...axis })) } : {}),
  };
}

function mergeInstalledFonts(current: readonly Font[], incoming: readonly Font[]): Font[] {
  const incomingIds = new Set(incoming.map(font => font.id));
  return [
    ...current.filter(font => !incomingIds.has(font.id)),
    ...incoming,
  ];
}

interface FontsState {
  fonts: Font[];
  projectFonts: ProjectFont[];
  projectGoogleFonts: Font[];
  projectFontsCss: string;
  projectFontsSignature: string;
  fontsCss: string;
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  googleFontsCatalog: GoogleFontResult[];
  googleSearchResults: GoogleFontResult[];
  isCatalogLoaded: boolean;
  adobeFontsCatalog: Font[];
  adobeFontsAvailable: boolean;
  adobeFontsConfigured: boolean;
  adobeFontsProjectId: string;
  adobeFontsStylesheetUrl: string;
  adobeFontsFamilyCount: number;
  adobeFontsSyncedAt: string | null;
  adobeFontsStale: boolean;
  adobeFontsLastError: string | null;
  isAdobeFontsLoading: boolean;
  isAdobeFontsLoaded: boolean;
}

interface FontsActions {
  loadFonts: () => Promise<void>;
  syncProjectFonts: (project: HtmlProject | null | undefined) => void;
  setFonts: (fonts: Font[]) => void;
  addFont: (font: Font) => void;
  removeFont: (fontId: string) => Promise<void>;
  uploadCustomFonts: (files: File[]) => Promise<Font[]>;
  addGoogleFont: (googleFont: GoogleFontResult) => Promise<Font | null>;
  deleteFont: (fontId: string) => Promise<void>;
  loadGoogleFontsCatalog: () => Promise<void>;
  loadAdobeFontsCatalog: (options?: { force?: boolean; refresh?: boolean }) => Promise<void>;
  resyncAdobeFontsCatalog: () => Promise<void>;
  searchGoogleFonts: (query: string) => void;
  rebuildCss: () => void;
  injectFontsCss: (iframeDocument?: Document | null) => void;
  getFontByFamily: (family: string) => Font | undefined;
  getRenderableFonts: () => Font[];
  reset: () => void;
}

type FontsStore = FontsState & FontsActions;

let activeProjectFontRuntime: ProjectFontRuntime | null = null;
let adobeFontsRequestGeneration = 0;
const fontLibraryTransport = getFontLibraryTransport();
const initialInstalledFonts = fontLibraryTransport.readInstalledFontsSnapshot();
const initialInstalledFontsLoaded =
  fontLibraryTransport.capabilities.synchronousInstalledFontsSnapshot;

const initialState: FontsState = {
  // A platform with a synchronous snapshot can hydrate before the first
  // Canvas srcdoc. Async platforms begin with an empty snapshot and load once.
  fonts: initialInstalledFonts,
  projectFonts: [],
  projectGoogleFonts: [],
  projectFontsCss: '',
  projectFontsSignature: '',
  fontsCss: initialInstalledFonts.length ? buildAllFontsCss(initialInstalledFonts) : '',
  isLoading: false,
  isLoaded: initialInstalledFontsLoaded,
  error: null,
  googleFontsCatalog: [],
  googleSearchResults: [],
  isCatalogLoaded: false,
  adobeFontsCatalog: [],
  adobeFontsAvailable: fontLibraryTransport.capabilities.adobeFontsCatalog,
  adobeFontsConfigured: false,
  adobeFontsProjectId: '',
  adobeFontsStylesheetUrl: '',
  adobeFontsFamilyCount: 0,
  adobeFontsSyncedAt: null,
  adobeFontsStale: false,
  adobeFontsLastError: null,
  isAdobeFontsLoading: false,
  isAdobeFontsLoaded: false,
};

export const useFontsStore = create<FontsStore>((set, get) => ({
  ...initialState,

  /** Load installed fonts through the runtime-owned transport. */
  loadFonts: async () => {
    if (get().isLoaded || get().isLoading) return;
    set({ isLoading: true, error: null });

    try {
      const fonts = await fontLibraryTransport.loadInstalledFonts();
      set({
        fonts,
        isLoading: false,
        isLoaded: true,
        error: null,
      });
      get().rebuildCss();
    } catch (error) {
      set({
        isLoading: false,
        isLoaded: false,
        error: error instanceof Error ? error.message : 'Failed to load fonts',
      });
    }
  },

  /**
   * Keep imported project files available to every design surface without
   * mixing them into the user's uploaded/account font collection.
   */
  syncProjectFonts: (project) => {
    const projectGoogleFonts = project ? getProjectGoogleFonts(project) : [];
    // Google dependencies can change in metadata without changing any local
    // @font-face declaration or binary. They belong to this project only.
    const signature = project
      ? `${projectFontSourceSignature(project)}\n${JSON.stringify(projectGoogleFonts)}`
      : '';
    if (signature === get().projectFontsSignature) return;

    const previousRuntime = activeProjectFontRuntime;
    const runtime = project ? createProjectFontRuntime(project) : null;
    activeProjectFontRuntime = runtime;
    set({
      projectFonts: runtime?.fonts || [],
      projectGoogleFonts,
      projectFontsCss: runtime?.css || '',
      projectFontsSignature: signature,
    });
    // Replace injected CSS before revoking its old blob URLs so the picker
    // never paints a frame whose selected font points at a revoked resource.
    get().rebuildCss();
    previousRuntime?.revoke();
  },

  /** Set fonts directly (e.g., from initial load) */
  setFonts: (fonts: Font[]) => {
    const installedFonts = fontLibraryTransport.replaceInstalledFonts(fonts);
    set({ fonts: installedFonts, isLoaded: true });
    get().rebuildCss();
  },

  /** Add a font to the store */
  addFont: (font: Font) => {
    const fonts = fontLibraryTransport.upsertInstalledFont(font, get().fonts);
    set({ fonts });
    get().rebuildCss();
  },

  /** Remove a font from the store */
  removeFont: async (fontId: string) => {
    await fontLibraryTransport.removeFontAssociation(fontId, get().fonts);
    set(state => ({ fonts: state.fonts.filter(font => font.id !== fontId) }));
    get().rebuildCss();
  },

  /** Upload custom font files */
  uploadCustomFonts: async (files: File[]): Promise<Font[]> => {
    try {
      const result = await fontLibraryTransport.uploadCustomFonts(files, get().fonts);
      set(state => ({
        fonts: mergeInstalledFonts(state.fonts, result.uploadedFonts),
      }));
      get().rebuildCss();
      return result.uploadedFonts;
    } catch (error) {
      console.error('Failed to upload fonts:', error);
      throw error;
    }
  },

  /** Add a Google Font from search results */
  addGoogleFont: async (googleFont: GoogleFontResult): Promise<Font | null> => {
    try {
      const result = await fontLibraryTransport.addGoogleFont(googleFont, get().fonts);
      const addedFont = result.font;
      if (addedFont) {
        set(state => ({
          fonts: mergeInstalledFonts(state.fonts, [addedFont]),
        }));
      }
      get().rebuildCss();
      return result.font;
    } catch (error) {
      console.error('Failed to add Google Font:', error);
      throw error;
    }
  },

  /** Delete a font */
  deleteFont: async (fontId: string) => {
    try {
      await get().removeFont(fontId);
    } catch (error) {
      console.error('Failed to delete font:', error);
      throw error;
    }
  },

  /** Load the static Google Fonts catalog (fetched once, cached in state) */
  loadGoogleFontsCatalog: async () => {
    if (get().isCatalogLoaded) return;

    try {
      const googleFontsCatalog = (
        await fontLibraryTransport.loadGoogleFontsCatalog()
      ).map(mutableGoogleFont);
      set({ googleFontsCatalog, isCatalogLoaded: true });
    } catch (error) {
      console.error('Failed to load Google Fonts catalog:', error);
      set({ googleFontsCatalog: [], isCatalogLoaded: true });
    }
  },

  /** Load the account's published Adobe web project without installing fonts individually. */
  loadAdobeFontsCatalog: async (options = {}) => {
    const force = options.force === true;
    if (!fontLibraryTransport.capabilities.adobeFontsCatalog) {
      set({
        adobeFontsAvailable: false,
        isAdobeFontsLoaded: true,
        isAdobeFontsLoading: false,
      });
      return;
    }
    if (!force && !options.refresh && (get().isAdobeFontsLoaded || get().isAdobeFontsLoading)) return;
    if (force && !fontLibraryTransport.capabilities.resyncAdobeFontsCatalog) {
      set({
        adobeFontsLastError: 'A ressincronização do Adobe Fonts não está disponível.',
      });
      return;
    }

    const generation = ++adobeFontsRequestGeneration;
    set({ isAdobeFontsLoading: true, adobeFontsLastError: null });
    try {
      const snapshot = force
        ? await fontLibraryTransport.resyncAdobeFontsCatalog()
        : await fontLibraryTransport.loadAdobeFontsCatalog();
      if (generation !== adobeFontsRequestGeneration) return;
      set({
        adobeFontsCatalog: snapshot.fonts,
        adobeFontsAvailable: true,
        adobeFontsConfigured: snapshot.configured,
        adobeFontsProjectId: snapshot.projectId,
        adobeFontsStylesheetUrl: snapshot.stylesheetUrl,
        adobeFontsFamilyCount: snapshot.familyCount,
        adobeFontsSyncedAt: snapshot.syncedAt,
        adobeFontsStale: snapshot.stale,
        adobeFontsLastError: snapshot.lastError,
        isAdobeFontsLoading: false,
        isAdobeFontsLoaded: true,
      });
      get().rebuildCss();
    } catch (error) {
      if (generation !== adobeFontsRequestGeneration) return;
      if (isEditorCapabilityUnsupportedError(error)) {
        set({
          adobeFontsCatalog: [],
          adobeFontsAvailable: false,
          adobeFontsConfigured: false,
          adobeFontsProjectId: '',
          adobeFontsStylesheetUrl: '',
          adobeFontsFamilyCount: 0,
          adobeFontsStale: false,
          adobeFontsLastError: null,
          isAdobeFontsLoading: false,
          isAdobeFontsLoaded: true,
        });
        get().rebuildCss();
        return;
      }
      set({
        adobeFontsLastError: error instanceof Error
          ? error.message
          : 'Não foi possível carregar o catálogo do Adobe Fonts.',
        isAdobeFontsLoading: false,
        isAdobeFontsLoaded: true,
      });
    }
  },

  resyncAdobeFontsCatalog: async () => {
    await get().loadAdobeFontsCatalog({ force: true });
  },

  /** Filter the cached catalog client-side (no limit — component handles pagination) */
  searchGoogleFonts: (query: string) => {
    const { googleFontsCatalog } = get();

    if (!query) {
      set({ googleSearchResults: googleFontsCatalog });
      return;
    }

    const lower = query.toLowerCase();
    const filtered = googleFontsCatalog
      .filter(f => f.family.toLowerCase().includes(lower));

    set({ googleSearchResults: filtered });
  },

  /** Rebuild font CSS from current font list */
  rebuildCss: () => {
    const { projectFonts, projectFontsCss } = get();
    const fonts = get().getRenderableFonts();
    const css = [
      buildAllFontsCss(fonts),
      projectFontsCss,
      buildFontClassesCss(projectFonts),
    ].filter(Boolean).join('\n');
    set({ fontsCss: css });

    // Auto-inject if already in browser
    if (typeof window !== 'undefined') {
      get().injectFontsCss();
    }
  },

  /**
   * Inject font CSS into the document and optionally into an iframe.
   * Uses <link> elements for Google Fonts (reliable cross-origin loading)
   * and <style> elements for @font-face and class rules.
   */
  injectFontsCss: (iframeDocument?: Document | null) => {
    const { fontsCss } = get();
    const fonts = get().getRenderableFonts();
    const styleId = 'kodety-fonts-style';

    // Inject into main document (builder)
    injectStyleIntoDocument(document, styleId, fontsCss);
    injectHostedFontLinks(document, fonts);

    // Inject into canvas iframe if provided
    if (iframeDocument) {
      injectStyleIntoDocument(iframeDocument, styleId, fontsCss);
      injectHostedFontLinks(iframeDocument, fonts);
    }
  },

  /** Get a font by its family value (as stored in layer.design.typography.fontFamily) */
  getFontByFamily: (family: string): Font | undefined => {
    const { projectFonts } = get();
    const fonts = get().getRenderableFonts();

    // Check built-in fonts first
    const builtIn = BUILT_IN_FONTS.find(f =>
      fontFamilyValueMatches(family, f)
    );
    if (builtIn) return builtIn;

    // Check installed and project-local fonts, including complete CSS fallback
    // stacks and aliases inferred from the project file names.
    return [...projectFonts, ...fonts].find(f =>
      fontFamilyValueMatches(family, f)
      || getFontFamilyValue(f) === family
    );
  },

  getRenderableFonts: () => {
    const { fonts, projectFonts, projectGoogleFonts, adobeFontsCatalog } = get();
    const localFamilies = new Set(projectFonts
      .filter(font => font.faces.some(face => face.sources.some(source => source.filePath)))
      .flatMap(font => [font.family, ...font.aliases].map(normalizeFontFamilyName)));
    const projectFamilies = new Set(projectGoogleFonts.map(font => normalizeFontFamilyName(font.family)));
    const accountFonts = fonts.filter(font => font.type !== 'google'
      || !projectFamilies.has(normalizeFontFamilyName(font.family)));
    const merged = mergeInstalledFonts(mergeInstalledFonts(accountFonts, projectGoogleFonts), adobeFontsCatalog);
    return merged.filter(font => font.type !== 'google'
      || !localFamilies.has(normalizeFontFamilyName(font.family)));
  },

  /** Reset store */
  reset: () => {
    activeProjectFontRuntime?.revoke();
    activeProjectFontRuntime = null;
    adobeFontsRequestGeneration += 1;
    set(initialState);
    if (typeof document !== 'undefined') {
      injectStyleIntoDocument(document, 'kodety-fonts-style', '');
      injectHostedFontLinks(document, []);
    }
  },
}));

/** Helper to inject/update a style element in a document */
function injectStyleIntoDocument(doc: Document, styleId: string, css: string) {
  let styleEl = doc.getElementById(styleId) as HTMLStyleElement | null;

  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = styleId;
    doc.head.appendChild(styleEl);
  }

  styleEl.textContent = css;
}

function isAllowedHostedFontResource(
  resource: ReturnType<typeof getFontStylesheetResources>[number],
) {
  try {
    const url = new URL(resource.href);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      return false;
    }
    if (resource.provider === 'google') {
      return url.hostname === 'fonts.googleapis.com' && /^\/css2?$/.test(url.pathname);
    }
    return url.hostname === 'use.typekit.net'
      && /^\/[a-z0-9]{1,64}\.css$/.test(url.pathname)
      && Array.from(url.searchParams.keys()).every(key => key === 'v');
  } catch {
    return false;
  }
}

/** Inject allowlisted hosted stylesheets into the builder and opaque canvases. */
function injectHostedFontLinks(doc: Document, fonts: Font[]) {
  const selector = 'link[data-kodety-font-stylesheet][href]';
  const existing = new Map(
    Array.from(doc.querySelectorAll<HTMLLinkElement>(selector))
      .map(link => [link.href, link] as const),
  );
  getFontStylesheetResources(fonts)
    .filter(isAllowedHostedFontResource)
    .forEach(resource => {
      const href = new URL(resource.href).href;
      const current = existing.get(href);
      if (current) {
        existing.delete(href);
        return;
      }
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.kodetyFontStylesheet = '';
      link.dataset.kodetyFontProvider = resource.provider;
      doc.head.appendChild(link);
    });
  existing.forEach(link => link.remove());
}
