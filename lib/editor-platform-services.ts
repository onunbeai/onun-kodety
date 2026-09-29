import type { Font } from '@/types';
import type { AdobeFontsCatalogSnapshot } from './adobe-fonts';

export const EDITOR_CAPABILITY_UNSUPPORTED_CODE = 'kodety_capability_unsupported' as const;
export const EDITOR_PLATFORM_SERVICE_ALREADY_INSTALLED_CODE = 'kodety_service_already_installed' as const;

/** A missing platform implementation is an explicit capability boundary. */
export class EditorCapabilityUnsupportedError extends Error {
  readonly code = EDITOR_CAPABILITY_UNSUPPORTED_CODE;

  constructor(
    readonly capability: string,
    message = `A capability "${capability}" is not available in this runtime.`,
  ) {
    super(message);
    this.name = 'EditorCapabilityUnsupportedError';
  }
}

export function editorCapabilityUnsupported(capability: string, message?: string) {
  return new EditorCapabilityUnsupportedError(capability, message);
}

export function isEditorCapabilityUnsupportedError(
  value: unknown,
): value is EditorCapabilityUnsupportedError {
  return value instanceof EditorCapabilityUnsupportedError
    || Boolean(
      value
      && typeof value === 'object'
      && (value as { code?: unknown }).code === EDITOR_CAPABILITY_UNSUPPORTED_CODE,
    );
}

export class EditorPlatformServiceInstallationError extends Error {
  readonly code = EDITOR_PLATFORM_SERVICE_ALREADY_INSTALLED_CODE;

  constructor(readonly service: string) {
    super(`The editor platform service "${service}" is already installed.`);
    this.name = 'EditorPlatformServiceInstallationError';
  }
}

export interface EditorColorVariable {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly sortOrder?: number;
}

export interface ColorVariablePreviewOverride {
  readonly id: string;
  readonly value: string;
}

export interface ColorVariableCapability {
  readonly kind: string;
  readonly capabilities: Readonly<{
    list: boolean;
    get: boolean;
    subscribe: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    reorder: boolean;
    previewOverride: boolean;
  }>;

  /** Return the current immutable snapshot consumed by a picker. */
  list(): readonly EditorColorVariable[];
  get(id: string): EditorColorVariable | undefined;
  /** React adapters can bridge this with useSyncExternalStore without coupling this seam to React. */
  subscribe(listener: () => void): () => void;
  create(name: string, value: string): Promise<EditorColorVariable | null>;
  update(
    id: string,
    changes: Readonly<{ name?: string; value?: string }>,
  ): Promise<EditorColorVariable | null>;
  delete(id: string): Promise<boolean>;
  reorder(orderedIds: readonly string[]): Promise<void>;
  setPreviewOverride(override: ColorVariablePreviewOverride | null): void;
}

export type FontLibraryFont = Font;

export interface FontLibraryGoogleFont {
  readonly family: string;
  readonly variants: readonly string[];
  readonly category: string;
  readonly axes?: readonly Readonly<{
    tag: string;
    start: number;
    end: number;
  }>[];
}

export type FontLibraryTransportKind = 'wordpress' | 'next' | 'html' | 'test';

export interface FontLibraryTransportCapabilities {
  readonly synchronousInstalledFontsSnapshot: boolean;
  readonly readInstalledFonts: boolean;
  readonly persistInstalledFonts: boolean;
  readonly googleFontsCatalog: boolean;
  readonly adobeFontsCatalog: boolean;
  readonly resyncAdobeFontsCatalog: boolean;
  readonly installGoogleFont: boolean;
  readonly uploadCustomFonts: boolean;
  readonly removeFontAssociation: boolean;
  /** Association removal must never imply that the underlying media was deleted. */
  readonly deleteRemoteMedia: boolean;
}

export interface FontLibraryUploadResult {
  readonly installedFonts: FontLibraryFont[];
  readonly uploadedFonts: FontLibraryFont[];
}

export interface FontLibraryGoogleFontResult {
  readonly installedFonts: FontLibraryFont[];
  readonly font: FontLibraryFont | null;
  readonly added: boolean;
}

export interface FontLibraryRemovalResult {
  readonly installedFonts: FontLibraryFont[];
  readonly removed: boolean;
  readonly remoteMediaDeleted: boolean;
}

/**
 * Remote and persistent operations used by the current fonts store.
 * Search, CSS generation/injection, project-font hydration and family lookup
 * remain pure store/domain concerns and intentionally do not belong here.
 */
export interface FontLibraryTransport {
  readonly kind: FontLibraryTransportKind;
  readonly capabilities: Readonly<FontLibraryTransportCapabilities>;

  /** Needed by WordPress before the first canvas srcdoc is materialized. */
  readInstalledFontsSnapshot(): FontLibraryFont[];
  loadInstalledFonts(): Promise<FontLibraryFont[]>;
  replaceInstalledFonts(fonts: readonly FontLibraryFont[]): FontLibraryFont[];
  upsertInstalledFont(
    font: FontLibraryFont,
    installedFonts: readonly FontLibraryFont[],
  ): FontLibraryFont[];
  loadGoogleFontsCatalog(): Promise<FontLibraryGoogleFont[]>;
  loadAdobeFontsCatalog(): Promise<AdobeFontsCatalogSnapshot>;
  resyncAdobeFontsCatalog(): Promise<AdobeFontsCatalogSnapshot>;
  uploadCustomFonts(
    files: readonly File[],
    installedFonts: readonly FontLibraryFont[],
  ): Promise<FontLibraryUploadResult>;
  addGoogleFont(
    googleFont: FontLibraryGoogleFont,
    installedFonts: readonly FontLibraryFont[],
  ): Promise<FontLibraryGoogleFontResult>;
  removeFontAssociation(
    fontId: string,
    installedFonts: readonly FontLibraryFont[],
  ): Promise<FontLibraryRemovalResult>;
}

const FONT_LIBRARY_TRANSPORT_METHODS = [
  'readInstalledFontsSnapshot',
  'loadInstalledFonts',
  'replaceInstalledFonts',
  'upsertInstalledFont',
  'loadGoogleFontsCatalog',
  'loadAdobeFontsCatalog',
  'resyncAdobeFontsCatalog',
  'uploadCustomFonts',
  'addGoogleFont',
  'removeFontAssociation',
] as const;

const FONT_LIBRARY_TRANSPORT_CAPABILITIES = [
  'synchronousInstalledFontsSnapshot',
  'readInstalledFonts',
  'persistInstalledFonts',
  'googleFontsCatalog',
  'adobeFontsCatalog',
  'resyncAdobeFontsCatalog',
  'installGoogleFont',
  'uploadCustomFonts',
  'removeFontAssociation',
  'deleteRemoteMedia',
] as const;

function assertFontLibraryTransport(
  value: FontLibraryTransport,
): asserts value is FontLibraryTransport {
  if (!value || typeof value !== 'object' || typeof value.kind !== 'string') {
    throw new TypeError('A valid FontLibraryTransport is required.');
  }
  if (!value.capabilities || typeof value.capabilities !== 'object') {
    throw new TypeError('FontLibraryTransport capabilities are required.');
  }
  for (const capability of FONT_LIBRARY_TRANSPORT_CAPABILITIES) {
    if (typeof value.capabilities[capability] !== 'boolean') {
      throw new TypeError(`FontLibraryTransport.capabilities.${capability} must be boolean.`);
    }
  }
  for (const method of FONT_LIBRARY_TRANSPORT_METHODS) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`FontLibraryTransport.${method} must be a function.`);
    }
  }
}

let installedFontLibraryTransport: FontLibraryTransport | null = null;

/** Install once before a lazy editor imports a consumer of the transport. */
export function installFontLibraryTransport(
  transport: FontLibraryTransport,
): FontLibraryTransport {
  assertFontLibraryTransport(transport);
  if (installedFontLibraryTransport === transport) return transport;
  if (installedFontLibraryTransport) {
    throw new EditorPlatformServiceInstallationError('font-library');
  }
  installedFontLibraryTransport = transport;
  return transport;
}

/** Read fail-closed: this seam never supplies a default implementation. */
export function getFontLibraryTransport(): FontLibraryTransport {
  if (!installedFontLibraryTransport) {
    throw editorCapabilityUnsupported(
      'font-library',
      'No font library transport was installed for this editor runtime.',
    );
  }
  return installedFontLibraryTransport;
}

/** Test isolation only. Production lifecycles must install exactly once. */
export function __resetFontLibraryTransportForTests(): void {
  installedFontLibraryTransport = null;
}
