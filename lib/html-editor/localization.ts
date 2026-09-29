import type { HtmlProject, HtmlProjectFile } from './types';
import { getAdminUiLocale } from '../admin-ui-locale';
import { parse, parseFragment, serialize } from 'parse5';
import {
  conflictingStyleProperties,
  parseStyleDeclarations,
  serializeStyleDeclarations,
  writeStyleDeclaration,
} from './style-utils';
import { inspectSourceElementIndex } from './source-patcher';
import {
  localizedPageStylesheetPath,
  localizedStylesheetHref,
  normalizeLocalizedStylesheetPath,
} from './localized-css';

export { localizedPageStylesheetPath } from './localized-css';

export type LocaleDirection = 'ltr' | 'rtl';

export interface LocalizationLocale {
  code: string;
  language: string;
  region?: string;
  name: string;
  slug: string;
  fallback?: string;
  enabled: boolean;
  direction: LocaleDirection;
  autoTranslate?: boolean;
  aiModel?: string;
  aiStyle?: string;
}

export interface LocalizationPageTranslation {
  path?: string;
  title?: string;
  description?: string;
  /** One direct, project-relative CSS overlay owned by this locale/page.
   * Fallback locale overlays are resolved separately and loaded first. */
  stylesheet?: string;
  entries: Record<string, string>;
  /** Locale-only mutations keyed by `id:<data-kodety-l10n-id>`,
   * `path:<legacy-element-path>`, `insertion:<id>` or `body`.
   *
   * Missing properties keep the authored source value. `null` is an explicit
   * tombstone for one attribute/style and therefore removes it from the
   * localized document without mutating the source locale. */
  overrides?: Record<string, LocalizationElementOverride>;
  /** Ordered locale-only roots. IDs are stable across fallback locales and
   * make replacement/removal deterministic without relying on DOM indexes. */
  insertions?: LocalizationInsertion[];
}

export interface LocalizationElementOverride {
  visible?: boolean;
  attributes?: Record<string, string | null>;
  styles?: Record<string, string | null>;
}

export type LocalizationInsertionPosition = 'before' | 'after' | 'prepend' | 'append';

export interface LocalizationInsertion {
  id: string;
  /** Element key (`id:…`, `path:…`, `insertion:…`) or the special `body`. */
  anchor: string;
  position: LocalizationInsertionPosition;
  html: string;
  /** Keep the locale section configured without rendering it. */
  enabled?: boolean;
  /** Tombstone that suppresses an insertion inherited from a fallback locale. */
  removed?: boolean;
}

export interface LocalizationLocaleTranslations {
  siteTitle?: string;
  siteDescription?: string;
  pages: Record<string, LocalizationPageTranslation>;
}

export interface LocalizationSettings {
  /** v1 contains text/SEO entries, v2 adds structural overrides, and v3 makes
   * automatic locale routing default-on while preserving an explicit opt-out. */
  version: 1 | 2 | 3;
  /** Language the imported HTML was authored in. Site Settings owns this
   * value; changing the site's language replaces the translation source. */
  sourceLocale: string;
  /** Locale served without an URL prefix and selected when the Builder opens. */
  defaultLocale: string;
  automaticLocale: boolean;
  rememberLocale: boolean;
  translatePagePaths: boolean;
  includePathsInAi: boolean;
  locales: LocalizationLocale[];
  translations: Record<string, LocalizationLocaleTranslations>;
}

export interface LocalizableEntry {
  key: string;
  path: string;
  kind: 'text' | 'text-node' | 'attribute';
  attribute?: string;
  /** Zero-based ordinal among the element's non-blank direct text nodes.
   * Mixed inline content uses this instead of replacing `innerHTML`, so tags
   * such as <strong>, links and authored comments remain untouched. */
  textNodeOrdinal?: number;
  source: string;
  label: string;
}

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string; prefix?: string; namespace?: string }>;
  childNodes?: ParsedNode[];
  parentNode?: ParsedNode;
  value?: string;
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
  } | null;
}

export const COMMON_LOCALES: Array<Pick<LocalizationLocale, 'code' | 'language' | 'region' | 'name' | 'direction'>> = [
  { code: 'pt-BR', language: 'pt', region: 'BR', name: 'Português (Brasil)', direction: 'ltr' },
  { code: 'pt-PT', language: 'pt', region: 'PT', name: 'Português (Portugal)', direction: 'ltr' },
  { code: 'en-US', language: 'en', region: 'US', name: 'English (United States)', direction: 'ltr' },
  { code: 'en-GB', language: 'en', region: 'GB', name: 'English (United Kingdom)', direction: 'ltr' },
  { code: 'es-ES', language: 'es', region: 'ES', name: 'Español (España)', direction: 'ltr' },
  { code: 'es-MX', language: 'es', region: 'MX', name: 'Español (México)', direction: 'ltr' },
  { code: 'fr-FR', language: 'fr', region: 'FR', name: 'Français', direction: 'ltr' },
  { code: 'de-DE', language: 'de', region: 'DE', name: 'Deutsch', direction: 'ltr' },
  { code: 'it-IT', language: 'it', region: 'IT', name: 'Italiano', direction: 'ltr' },
  { code: 'nl-NL', language: 'nl', region: 'NL', name: 'Nederlands', direction: 'ltr' },
  { code: 'pl-PL', language: 'pl', region: 'PL', name: 'Polski', direction: 'ltr' },
  { code: 'tr-TR', language: 'tr', region: 'TR', name: 'Türkçe', direction: 'ltr' },
  { code: 'ru-RU', language: 'ru', region: 'RU', name: 'Русский', direction: 'ltr' },
  { code: 'uk-UA', language: 'uk', region: 'UA', name: 'Українська', direction: 'ltr' },
  { code: 'ja-JP', language: 'ja', region: 'JP', name: '日本語', direction: 'ltr' },
  { code: 'ko-KR', language: 'ko', region: 'KR', name: '한국어', direction: 'ltr' },
  { code: 'zh-CN', language: 'zh', region: 'CN', name: '简体中文', direction: 'ltr' },
  { code: 'zh-TW', language: 'zh', region: 'TW', name: '繁體中文', direction: 'ltr' },
  { code: 'ar-SA', language: 'ar', region: 'SA', name: 'العربية', direction: 'rtl' },
  { code: 'he-IL', language: 'he', region: 'IL', name: 'עברית', direction: 'rtl' },
  { code: 'hi-IN', language: 'hi', region: 'IN', name: 'हिन्दी', direction: 'ltr' },
  { code: 'id-ID', language: 'id', region: 'ID', name: 'Bahasa Indonesia', direction: 'ltr' },
  { code: 'vi-VN', language: 'vi', region: 'VN', name: 'Tiếng Việt', direction: 'ltr' },
  { code: 'th-TH', language: 'th', region: 'TH', name: 'ไทย', direction: 'ltr' },
  { code: 'sv-SE', language: 'sv', region: 'SE', name: 'Svenska', direction: 'ltr' },
  { code: 'da-DK', language: 'da', region: 'DK', name: 'Dansk', direction: 'ltr' },
  { code: 'nb-NO', language: 'nb', region: 'NO', name: 'Norsk', direction: 'ltr' },
  { code: 'fi-FI', language: 'fi', region: 'FI', name: 'Suomi', direction: 'ltr' },
];

const TRANSLATABLE_ATTRIBUTES = ['alt', 'title', 'placeholder', 'aria-label'] as const;
const IGNORED_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template']);
const UNSAFE_INSERTION_TAGS = new Set([
  'script',
  'base',
  'object',
  'embed',
  'meta',
  'link',
  'style',
  'template',
]);
const URL_ATTRIBUTES = new Set(['href', 'src', 'srcset', 'poster', 'action', 'formaction']);
const STALE_IMAGE_CANDIDATE_ATTRIBUTES = [
  'srcset',
  'sizes',
  'data-src',
  'data-srcset',
  'data-lazy-src',
  'data-lazy-srcset',
  'data-original',
  'data-original-src',
] as const;
const LOCALE_INSERTION_ATTRIBUTE = 'data-kodety-locale-insertion';
const LOCALE_HIDDEN_ATTRIBUTE = 'data-kodety-locale-hidden';
const LOCALE_TEXT_ROOT_ATTRIBUTE = 'data-kodety-locale-text-root';
const MAX_LOCALIZATION_ID_LENGTH = 200;
const MAX_LOCALIZATION_CLASS_LENGTH = 2000;
const SAFE_LOCALIZATION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const SAFE_LOCALIZATION_ENTRY_KEY_PATTERN = /^(?:id:[A-Za-z0-9_.:-]{1,200}|path:(?:\d+(?:\/\d+)*)?):(?:text|text-node:\d+|attr:[a-zA-Z0-9_.:-]+)$/;
const localizationIdStampedFiles = new WeakSet<HtmlProjectFile>();

/** Persistence limits shared with the WordPress publisher. They are checked
 * before a candidate replaces editor metadata; normalization/loading remains
 * deliberately permissive so an older project can still be opened and
 * repaired instead of becoming unreadable. */
export const LOCALIZATION_PERSISTENCE_LIMITS = Object.freeze({
  locales: 100,
  translations: 100,
  pagesPerLocale: 5000,
  entriesPerPage: 20000,
  overridesPerPage: 5000,
  attributesPerOverride: 100,
  stylesPerOverride: 200,
  insertionsPerPage: 1000,
  scalarBytes: 2_000_000,
  htmlBytes: 2_000_000,
  styleValueBytes: 50_000,
  pagePathBytes: 1024,
  titleBytes: 10_000,
  descriptionBytes: 50_000,
  entryKeyBytes: 300,
});

export interface LocalizationPersistenceValidation {
  valid: boolean;
  errors: string[];
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function codePointLength(value: string) {
  return [...value].length;
}

function safeLocalizationId(value: unknown): value is string {
  return typeof value === 'string'
    && codePointLength(value) <= MAX_LOCALIZATION_ID_LENGTH
    && SAFE_LOCALIZATION_ID_PATTERN.test(value);
}

function normalizedLocalizationId(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return safeLocalizationId(normalized) ? normalized : '';
}

function safeLocalizationElementKey(value: unknown, allowBody = true) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (allowBody && key === 'body') return key;
  if (/^(?:id|insertion):/.test(key)) {
    const separator = key.indexOf(':');
    return safeLocalizationId(key.slice(separator + 1)) ? key : '';
  }
  return /^path:(?:\d+(?:\/\d+)*)?$/.test(key) ? key : '';
}

function elementChildren(node: ParsedNode) {
  return (node.childNodes || []).filter((child) => Boolean(child.tagName));
}

function parsedAttribute(node: ParsedNode, name: string) {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())?.value;
}

function parsedAttributes(node: ParsedNode) {
  return Object.fromEntries((node.attrs || []).map((attribute) => [attribute.name, attribute.value]));
}

function replaceParsedAttributes(node: ParsedNode, attributes: Record<string, string>) {
  node.attrs = Object.entries(attributes).map(([name, value]) => ({ name, value }));
}

function setParsedAttribute(node: ParsedNode, name: string, value: string) {
  const attributes = parsedAttributes(node);
  attributes[name] = value;
  replaceParsedAttributes(node, attributes);
}

function removeParsedAttribute(node: ParsedNode, name: string) {
  const attributes = parsedAttributes(node);
  setRecordAttribute(attributes, name, null);
  replaceParsedAttributes(node, attributes);
}

function parsedDocumentParts(source: string) {
  const document = parse(source) as unknown as ParsedNode;
  const html = elementChildren(document).find((node) => node.tagName === 'html') || null;
  const head = html && elementChildren(html).find((node) => node.tagName === 'head') || null;
  const body = html && elementChildren(html).find((node) => node.tagName === 'body') || null;
  return { document, html, head, body };
}

function parsedTextContent(node: ParsedNode): string {
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(parsedTextContent).join('');
}

function findParsedElementByPath(body: ParsedNode | null, path: string) {
  let element = body;
  for (const index of path.split('/').filter(Boolean).map(Number)) {
    element = element ? elementChildren(element)[index] || null : null;
  }
  return element;
}

function walkParsedElements(
  root: ParsedNode,
  visit: (element: ParsedNode, path: string) => void,
  includeRoot = true,
) {
  const walk = (element: ParsedNode, path: string, shouldVisit: boolean) => {
    if (IGNORED_TAGS.has((element.tagName || '').toLowerCase())) return;
    if (shouldVisit) visit(element, path);
    elementChildren(element).forEach((child, index) => {
      walk(child, path ? `${path}/${index}` : String(index), true);
    });
  };
  walk(root, '', includeRoot);
}

export function localeSlug(code: string) {
  return code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function canonicalLocaleCode(code: string) {
  const candidate = code.trim();
  if (!candidate) return '';
  try {
    return Intl.getCanonicalLocales(candidate)[0] || '';
  } catch {
    return '';
  }
}

export function isValidLocaleCode(code: string) {
  return canonicalLocaleCode(code) !== '';
}

function normalizePersistedLocalizationInsertions(value: unknown): LocalizationInsertion[] {
  if (!Array.isArray(value)) return [];
  const order: string[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, LocalizationInsertion>();
  value.forEach((rawInsertion) => {
    if (!rawInsertion || typeof rawInsertion !== 'object' || Array.isArray(rawInsertion)) return;
    const candidate = rawInsertion as Partial<LocalizationInsertion>;
    const id = normalizedLocalizationId(candidate.id);
    if (!id) return;
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
    if (candidate.removed === true) {
      byId.set(id, {
        id,
        anchor: safeLocalizationElementKey(candidate.anchor) || 'body',
        position: ['before', 'after', 'prepend', 'append'].includes(candidate.position || '')
          ? candidate.position as LocalizationInsertionPosition
          : 'append',
        html: typeof candidate.html === 'string' ? candidate.html : '',
        removed: true,
      });
      return;
    }
    const anchor = safeLocalizationElementKey(candidate.anchor);
    const position = candidate.position;
    if (
      !anchor
      || !position
      || !['before', 'after', 'prepend', 'append'].includes(position)
      || typeof candidate.html !== 'string'
    ) return;
    byId.set(id, {
      id,
      anchor,
      position,
      html: candidate.html,
      enabled: candidate.enabled !== false,
    });
  });
  return order.flatMap((id) => {
    const insertion = byId.get(id);
    return insertion ? [insertion] : [];
  });
}

/** Only authored public pages participate in localization. Component bundles,
 * A/B variants and other `.incode` documents are implementation details: if
 * they leak into the locale catalogue they duplicate content, make progress
 * incorrect and can turn enabling localization into a project-wide hot path. */
export function isLocalizationPageFile(
  file: Pick<HtmlProjectFile, 'path' | 'text'>,
): file is Pick<HtmlProjectFile, 'path' | 'text'> & { text: string } {
  const path = file.path.replaceAll('\\', '/').replace(/^\.\/+/, '');
  return !path.startsWith('.incode/')
    && !path.startsWith('.coday/')
    && /\.html?$/i.test(path)
    && file.text !== undefined;
}

function localizationDocumentPagePath(file: Pick<HtmlProjectFile, 'path' | 'text'>) {
  if (file.text === undefined) return '';
  const path = file.path.replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (isLocalizationPageFile(file)) return path;
  const experimentPage = path.match(
    /^\.incode\/experiments\/[^/]+\/[^/]+\/project\/(.+\.html?)$/i,
  );
  return experimentPage?.[1] || '';
}

export function createLocale(code: string): LocalizationLocale {
  const canonical = canonicalLocaleCode(code) || 'en-US';
  const match = COMMON_LOCALES.find((locale) => locale.code.toLowerCase() === canonical.toLowerCase());
  const normalized = match?.code || canonical;
  let language = normalized.split('-')[0].toLowerCase();
  let region = normalized.split('-').find((part, index) => (
    index > 0 && /^(?:[A-Za-z]{2}|[0-9]{3})$/.test(part)
  ));
  try {
    const parsed = new Intl.Locale(normalized);
    language = parsed.language;
    region = parsed.region || undefined;
  } catch {
    // `canonicalLocaleCode` already guards modern runtimes. Keep the structural
    // fallback for older embedded WebViews that expose getCanonicalLocales but
    // not Intl.Locale.
  }
  return {
    code: normalized,
    language: match?.language || language.toLowerCase(),
    region: match?.region || region?.toUpperCase(),
    name: match?.name || normalized,
    slug: localeSlug(normalized),
    enabled: true,
    direction: match?.direction || (['ar', 'fa', 'he', 'ur'].includes(language) ? 'rtl' : 'ltr'),
  };
}

/** Resolve the compact language values historically stored by Site Settings
 * to the canonical locale codes used by the localization workspace. */
export function siteLanguageLocaleCode(rawCode: string) {
  const code = rawCode.trim().replace(/_/g, '-') || 'pt-BR';
  const exact = COMMON_LOCALES.find((locale) => locale.code.toLowerCase() === code.toLowerCase());
  if (exact) return exact.code;
  if (!code.includes('-')) {
    const language = code.toLowerCase();
    const languageDefault = COMMON_LOCALES.find((locale) => locale.language === language);
    if (languageDefault) return languageDefault.code;
  }
  return code;
}

export function defaultLocalization(sourceLocale = 'pt-BR'): LocalizationSettings {
  const source = createLocale(sourceLocale);
  source.slug = '';
  return {
    version: 3,
    sourceLocale: source.code,
    defaultLocale: source.code,
    automaticLocale: true,
    rememberLocale: true,
    translatePagePaths: false,
    includePathsInAi: false,
    locales: [source],
    translations: {},
  };
}

export function normalizeLocalization(value?: Partial<LocalizationSettings> | null): LocalizationSettings {
  const sourceLocale = canonicalLocaleCode(
    typeof value?.sourceLocale === 'string' ? value.sourceLocale : '',
  ) || 'pt-BR';
  const fallback = defaultLocalization(sourceLocale);
  const rawLocales = Array.isArray(value?.locales) ? value.locales : fallback.locales;
  const seenLocaleCodes = new Set<string>();
  let locales: LocalizationLocale[] = rawLocales.flatMap<LocalizationLocale>((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const rawCode = typeof candidate.code === 'string'
      ? candidate.code
      : typeof candidate.language === 'string'
        ? candidate.language
        : '';
    const canonicalCode = canonicalLocaleCode(rawCode);
    if (!canonicalCode || seenLocaleCodes.has(canonicalCode.toLowerCase())) return [];
    seenLocaleCodes.add(canonicalCode.toLowerCase());
    const locale = createLocale(canonicalCode);
    return [{
      ...locale,
      ...candidate,
      code: locale.code,
      language: locale.language,
      region: typeof candidate.region === 'string' && candidate.region.trim()
        ? candidate.region.trim().toUpperCase()
        : locale.region,
      name: typeof candidate.name === 'string' && candidate.name.trim()
        ? candidate.name.trim()
        : locale.name,
      slug: typeof candidate.slug === 'string'
        ? localeSlug(candidate.slug || locale.code)
        : locale.slug,
      fallback: typeof candidate.fallback === 'string'
        ? canonicalLocaleCode(candidate.fallback) || undefined
        : undefined,
      enabled: candidate.enabled !== false,
      direction: candidate.direction === 'rtl' || candidate.direction === 'ltr'
        ? candidate.direction
        : locale.direction,
      autoTranslate: candidate.autoTranslate === true,
      aiModel: typeof candidate.aiModel === 'string' ? candidate.aiModel : undefined,
      aiStyle: typeof candidate.aiStyle === 'string' ? candidate.aiStyle : undefined,
    }];
  });
  if (!locales.some((locale) => locale.code === sourceLocale)) {
    locales.unshift(createLocale(sourceLocale));
  }
  // The authored/source locale is the final fallback for every localized
  // page and therefore cannot be unpublished, even if older/corrupt metadata
  // says otherwise.
  locales = locales.map((locale) => (
    locale.code === sourceLocale ? { ...locale, enabled: true } : locale
  ));
  const requestedDefault = canonicalLocaleCode(
    typeof value?.defaultLocale === 'string' ? value.defaultLocale : '',
  ) || sourceLocale;
  const defaultLocale = locales.some((locale) => locale.code === requestedDefault && locale.enabled)
    ? requestedDefault
    : sourceLocale;
  const enabledLocaleCodes = new Set(
    locales.filter((locale) => locale.enabled).map((locale) => locale.code),
  );
  locales = locales.map((locale) => ({
    ...locale,
    // Exactly one locale owns the unprefixed public URL. When a previous
    // default had an empty slug, restore its natural BCP-47 based prefix.
    slug: locale.code === defaultLocale
      ? ''
      : localeSlug(locale.slug || locale.code),
    // Removed/disabled/self-referential fallbacks cannot be resolved by the
    // public runtime. Repair them to the always-enabled source locale.
    fallback: locale.code === sourceLocale
      ? undefined
      : locale.fallback
        && canonicalLocaleCode(locale.fallback) !== locale.code
        && enabledLocaleCodes.has(canonicalLocaleCode(locale.fallback))
        ? canonicalLocaleCode(locale.fallback)
        : sourceLocale,
  }));
  const rawTranslations = value?.translations
    && typeof value.translations === 'object'
    && !Array.isArray(value.translations)
    ? value.translations
    : {};
  const configuredLocaleCodes = new Set(locales.map((locale) => locale.code));
  const translations: LocalizationSettings['translations'] = {};
  Object.entries(rawTranslations).forEach(([rawCode, rawTranslation]) => {
    const code = canonicalLocaleCode(rawCode);
    if (
      !code
      || !configuredLocaleCodes.has(code)
      || code === sourceLocale
      || !rawTranslation
      || typeof rawTranslation !== 'object'
      || Array.isArray(rawTranslation)
    ) return;
    const translationCandidate = rawTranslation as Partial<LocalizationLocaleTranslations>;
    const translation: LocalizationLocaleTranslations = { pages: {} };
    if (typeof translationCandidate.siteTitle === 'string') {
      translation.siteTitle = translationCandidate.siteTitle;
    }
    if (typeof translationCandidate.siteDescription === 'string') {
      translation.siteDescription = translationCandidate.siteDescription;
    }
    const rawPages = translationCandidate.pages
      && typeof translationCandidate.pages === 'object'
      && !Array.isArray(translationCandidate.pages)
      ? translationCandidate.pages
      : {};
    Object.entries(rawPages).forEach(([pagePath, rawPage]) => {
      if (
        unsafeLocalizationPath(pagePath, true)
        || !rawPage
        || typeof rawPage !== 'object'
        || Array.isArray(rawPage)
      ) return;
      const pageCandidate = rawPage as Partial<LocalizationPageTranslation>;
      const page: LocalizationPageTranslation = { entries: {} };
      if (typeof pageCandidate.path === 'string' && !unsafeLocalizationPath(pageCandidate.path, false)) {
        page.path = pageCandidate.path;
      }
      if (typeof pageCandidate.title === 'string') page.title = pageCandidate.title;
      if (typeof pageCandidate.description === 'string') page.description = pageCandidate.description;
      const stylesheet = normalizeLocalizedStylesheetPath(pageCandidate.stylesheet);
      if (stylesheet) page.stylesheet = stylesheet;
      const rawEntries = pageCandidate.entries
        && typeof pageCandidate.entries === 'object'
        && !Array.isArray(pageCandidate.entries)
        ? pageCandidate.entries
        : {};
      Object.entries(rawEntries).forEach(([entryKey, entryValue]) => {
        if (
          typeof entryValue === 'string'
          && SAFE_LOCALIZATION_ENTRY_KEY_PATTERN.test(entryKey)
        ) page.entries[entryKey] = entryValue;
      });
      const rawOverrides = pageCandidate.overrides
        && typeof pageCandidate.overrides === 'object'
        && !Array.isArray(pageCandidate.overrides)
        ? pageCandidate.overrides
        : {};
      const overrides: Record<string, LocalizationElementOverride> = {};
      Object.entries(rawOverrides).forEach(([rawKey, rawOverride]) => {
        const key = safeLocalizationElementKey(rawKey);
        if (!key || !rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride)) return;
        const candidateOverride = rawOverride as LocalizationElementOverride;
        const override: LocalizationElementOverride = {};
        if (typeof candidateOverride.visible === 'boolean') override.visible = candidateOverride.visible;
        const attributes = Object.fromEntries(Object.entries(
          candidateOverride.attributes
            && typeof candidateOverride.attributes === 'object'
            && !Array.isArray(candidateOverride.attributes)
            ? candidateOverride.attributes
            : {},
        ).filter(([name, attributeValue]) => (
          (typeof attributeValue === 'string' || attributeValue === null)
          && safeOverrideAttribute(name, attributeValue)
        )));
        if (Object.keys(attributes).length) override.attributes = attributes;
        const styles = Object.fromEntries(Object.entries(
          candidateOverride.styles
            && typeof candidateOverride.styles === 'object'
            && !Array.isArray(candidateOverride.styles)
            ? candidateOverride.styles
            : {},
        ).filter(([property, styleValue]) => (
          (typeof styleValue === 'string' || styleValue === null)
          && safeOverrideStyle(property, styleValue)
        )));
        if (Object.keys(styles).length) override.styles = styles;
        overrides[key] = override;
      });
      if (Object.keys(overrides).length) page.overrides = overrides;
      const insertions = normalizePersistedLocalizationInsertions(pageCandidate.insertions);
      if (insertions.length) page.insertions = insertions;
      translation.pages[pagePath] = page;
    });
    const existing = translations[code];
    if (!existing) {
      translations[code] = translation;
      return;
    }
    // Legacy/imported metadata can contain aliases or casing variants such as
    // `en-US` and `en-us`. Canonicalization must not let the later collection
    // silently erase the first one. Merge complementary data while keeping the
    // first authored value on an exact conflict; the next save emits one
    // canonical collection that the strict PHP boundary can validate.
    const pages: Record<string, LocalizationPageTranslation> = { ...translation.pages };
    Object.entries(existing.pages).forEach(([pagePath, existingPage]) => {
      pages[pagePath] = mergePageTranslation(translation.pages[pagePath] || null, existingPage)
        || existingPage;
    });
    translations[code] = {
      siteTitle: existing.siteTitle?.trim() ? existing.siteTitle : translation.siteTitle,
      siteDescription: existing.siteDescription?.trim()
        ? existing.siteDescription
        : translation.siteDescription,
      pages,
    };
  });
  return {
    ...fallback,
    ...value,
    version: 3,
    sourceLocale,
    defaultLocale,
    // v1/v2 serialized false as the old default, so that value cannot prove
    // an intentional opt-out. From v3 onward, literal false is user-authored.
    automaticLocale: value?.version === 3
      ? value.automaticLocale !== false
      : true,
    rememberLocale: value?.rememberLocale !== false,
    translatePagePaths: value?.translatePagePaths === true,
    includePathsInAi: value?.includePathsInAi === true,
    locales,
    translations,
  };
}

export function setDefaultLocale(
  rawSettings: LocalizationSettings,
  localeCode: string,
): LocalizationSettings {
  const settings = normalizeLocalization(rawSettings);
  if (!settings.locales.some((locale) => locale.code === localeCode)) return settings;
  return normalizeLocalization({ ...settings, defaultLocale: localeCode });
}

/** Make Site Settings' language the single authored/source locale.
 *
 * A language selected in General settings is not an extra translation: it
 * replaces the previous implicit source, becomes the public default, and has
 * no localized overlay of its own. Other explicitly configured locales stay
 * intact and are repaired to fall back to the new source. */
export function setLocalizationSiteLanguage(
  rawSettings: LocalizationSettings,
  rawLanguage: string,
): LocalizationSettings {
  const settings = normalizeLocalization(rawSettings);
  const localeCode = siteLanguageLocaleCode(rawLanguage);
  if (settings.sourceLocale === localeCode) {
    if (!settings.translations[localeCode]) return settings;
    const translations = { ...settings.translations };
    delete translations[localeCode];
    return normalizeLocalization({ ...settings, translations });
  }

  const previousSource = settings.sourceLocale;
  const existingSource = settings.locales.find((locale) => locale.code === localeCode);
  const source = {
    ...(existingSource || createLocale(localeCode)),
    code: localeCode,
    enabled: true,
    slug: '',
    fallback: undefined,
  };
  const locales = [
    source,
    ...settings.locales
      .filter((locale) => locale.code !== previousSource && locale.code !== localeCode)
      .map((locale) => ({
        ...locale,
        fallback: !locale.fallback
          || locale.fallback === previousSource
          || locale.fallback === locale.code
          ? localeCode
          : locale.fallback,
      })),
  ];
  const translations = { ...settings.translations };
  delete translations[previousSource];
  delete translations[localeCode];

  return normalizeLocalization({
    ...settings,
    sourceLocale: localeCode,
    defaultLocale: localeCode,
    locales,
    translations,
  });
}

function elementKey(element: ParsedNode, path: string) {
  const stable = parsedAttribute(element, 'data-kodety-l10n-id')?.trim();
  return stable && safeLocalizationId(stable) ? `id:${stable}` : `path:${path}`;
}

function localizableDirectTextNodes(element: ParsedNode) {
  return (element.childNodes || []).filter((child) => (
    child.nodeName === '#text' && (child.value || '').trim() !== ''
  ));
}

export function extractLocalizableEntries(source: string): LocalizableEntry[] {
  if (!source) return [];
  const { body } = parsedDocumentParts(source);
  if (!body) return [];
  const entries: LocalizableEntry[] = [];
  const walk = (element: ParsedNode, path: string) => {
    if (IGNORED_TAGS.has((element.tagName || '').toLowerCase())) return;
    const key = elementKey(element, path);
    const elementNodes = element.childNodes || [];
    const editableChildren = elementChildren(element)
      .map((child, index) => ({ child, index }))
      .filter(({ child }) => !IGNORED_TAGS.has((child.tagName || '').toLowerCase()));
    const canReplaceWholeText = elementNodes.every((child) => child.nodeName === '#text');
    if (canReplaceWholeText) {
      const text = parsedTextContent(element).trim();
      if (text) entries.push({ key: `${key}:text`, path, kind: 'text', source: text, label: text.slice(0, 64) });
    } else {
      localizableDirectTextNodes(element).forEach((textNode, textNodeOrdinal) => {
        const text = (textNode.value || '').trim();
        entries.push({
          key: `${key}:text-node:${textNodeOrdinal}`,
          path,
          kind: 'text-node',
          textNodeOrdinal,
          source: text,
          label: text.slice(0, 64),
        });
      });
    }
    TRANSLATABLE_ATTRIBUTES.forEach((attribute) => {
      const value = parsedAttribute(element, attribute)?.trim();
      if (value) entries.push({ key: `${key}:attr:${attribute}`, path, kind: 'attribute', attribute, source: value, label: `${attribute}: ${value.slice(0, 52)}` });
    });
    editableChildren.forEach(({ child, index }) => walk(child, path ? `${path}/${index}` : String(index)));
  };
  walk(body, '');
  return entries;
}

function mergeElementOverride(
  fallback: LocalizationElementOverride | undefined,
  direct: LocalizationElementOverride,
): LocalizationElementOverride {
  const merged: LocalizationElementOverride = {};
  if (fallback && Object.prototype.hasOwnProperty.call(fallback, 'visible')) {
    merged.visible = fallback.visible;
  }
  if (Object.prototype.hasOwnProperty.call(direct, 'visible')) {
    merged.visible = direct.visible;
  }
  const attributes = { ...(fallback?.attributes || {}), ...(direct.attributes || {}) };
  const styles = { ...(fallback?.styles || {}) };
  Object.entries(direct.styles || {}).forEach(([rawProperty, value]) => {
    const property = rawProperty.trim().toLowerCase();
    if (!property) return;
    // A nearer locale is a later cascade layer. Remove inherited shorthands
    // and longhands that could otherwise win merely because object spread
    // retained an older key position.
    conflictingStyleProperties(property).forEach((conflict) => {
      const current = Object.keys(styles).find((candidate) => candidate.toLowerCase() === conflict);
      if (current) delete styles[current];
    });
    styles[property] = value;
  });
  if (Object.keys(attributes).length) merged.attributes = attributes;
  if (Object.keys(styles).length) merged.styles = styles;
  return merged;
}

function mergeElementOverrides(
  fallback: Record<string, LocalizationElementOverride> = {},
  direct: Record<string, LocalizationElementOverride> = {},
) {
  const result: Record<string, LocalizationElementOverride> = {};
  const apply = (values: Record<string, LocalizationElementOverride>) => {
    Object.entries(values).forEach(([rawKey, override]) => {
      const key = safeLocalizationElementKey(rawKey);
      if (!key || !override || typeof override !== 'object') return;
      result[key] = mergeElementOverride(result[key], override);
    });
  };
  apply(fallback);
  apply(direct);
  return result;
}

/** Stable, order-preserving insertion merge. A direct locale replaces an
 * inherited insertion in place, appends a new ID, or removes it with a
 * tombstone. Multiple fallback levels can therefore be resolved without
 * reviving a section that a nearer locale removed. */
export function mergeLocalizationInsertions(
  fallback: LocalizationInsertion[] = [],
  direct: LocalizationInsertion[] = [],
): LocalizationInsertion[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, LocalizationInsertion>();
  const apply = (insertion: LocalizationInsertion) => {
    const id = normalizedLocalizationId(insertion?.id);
    if (!id) return;
    // The last valid occurrence owns the value, while the first occurrence
    // keeps its position. This is shared by preview, persistence and PHP.
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
    if (insertion.removed) {
      byId.delete(id);
      return;
    }
    const anchor = safeLocalizationElementKey(insertion.anchor);
    if (
      !anchor
      || !['before', 'after', 'prepend', 'append'].includes(insertion.position)
      || typeof insertion.html !== 'string'
    ) return;
    byId.set(id, { ...insertion, id, anchor, removed: undefined });
  };
  fallback.forEach(apply);
  direct.forEach(apply);
  return order.flatMap((id) => {
    const insertion = byId.get(id);
    return insertion ? [insertion] : [];
  });
}

function mergePageTranslation(
  fallback: LocalizationPageTranslation | null,
  direct: LocalizationPageTranslation | undefined,
): LocalizationPageTranslation | null {
  if (!fallback && !direct) return null;
  const directValues: LocalizationPageTranslation = direct ? { ...direct } : { entries: {} };
  if (typeof directValues.title === 'string' && directValues.title.trim() === '') delete directValues.title;
  if (typeof directValues.description === 'string' && directValues.description.trim() === '') {
    delete directValues.description;
  }
  const fallbackEntries = Object.fromEntries(
    Object.entries(fallback?.entries || {}).filter(([, value]) => value.trim() !== ''),
  );
  const directEntries = Object.fromEntries(
    Object.entries(direct?.entries || {}).filter(([, value]) => value.trim() !== ''),
  );
  return {
    ...(fallback || {}),
    ...directValues,
    entries: { ...fallbackEntries, ...directEntries },
    overrides: mergeElementOverrides(fallback?.overrides, direct?.overrides),
    insertions: mergeLocalizationInsertions(fallback?.insertions, direct?.insertions),
  };
}

export function resolveLocalizationPage(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  visited = new Set<string>(),
): LocalizationPageTranslation | null {
  if (visited.has(localeCode)) return null;
  const nextVisited = new Set(visited).add(localeCode);
  const locale = settings.locales.find((candidate) => candidate.code === localeCode);
  const fallback = locale?.fallback && locale.fallback !== settings.sourceLocale
    ? resolveLocalizationPage(settings, locale.fallback, pagePath, nextVisited)
    : null;
  const direct = settings.translations[localeCode]?.pages?.[pagePath];
  return mergePageTranslation(fallback, direct);
}

/** Resolve locale stylesheet overlays in cascade order. Unlike the merged page
 * payload, CSS overlays compose: the oldest fallback loads first and the
 * active locale's direct file loads last. */
export function resolveLocalizationStylesheets(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
) {
  if (!localeCode || localeCode === settings.sourceLocale) return [];
  const paths: string[] = [];
  const seenLocales = new Set<string>();
  const seenPaths = new Set<string>();
  const visit = (code: string) => {
    if (!code || code === settings.sourceLocale || seenLocales.has(code)) return;
    seenLocales.add(code);
    const locale = settings.locales.find((candidate) => candidate.code === code);
    if (!locale) return;
    if (locale.fallback && locale.fallback !== settings.sourceLocale) visit(locale.fallback);
    const path = normalizeLocalizedStylesheetPath(
      settings.translations[code]?.pages?.[pagePath]?.stylesheet,
    );
    if (path && !seenPaths.has(path)) {
      seenPaths.add(path);
      paths.push(path);
    }
  };
  visit(localeCode);
  return paths;
}

function parsedElementsByKey(body: ParsedNode, key: string) {
  if (key === 'body') return [body];
  if (key.startsWith('path:')) {
    const element = findParsedElementByPath(body, key.slice(5));
    return element ? [element] : [];
  }
  const [kind, value] = key.includes(':') ? [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] : ['id', key];
  const attribute = kind === 'insertion' ? LOCALE_INSERTION_ATTRIBUTE : kind === 'id' ? 'data-kodety-l10n-id' : '';
  if (!attribute || !value) return [];
  const matches: ParsedNode[] = [];
  walkParsedElements(body, (element) => {
    if (parsedAttribute(element, attribute) === value) matches.push(element);
  });
  return matches;
}

function setRecordAttribute(
  attributes: Record<string, string>,
  name: string,
  value: string | null,
) {
  const current = Object.keys(attributes).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (current) delete attributes[current];
  if (value !== null) attributes[name] = value;
}

function decodedAttributeValue(value: string) {
  const escaped = value
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const fragment = parseFragment(`<span data-kodety-value="${escaped}"></span>`) as unknown as ParsedNode;
  return parsedAttribute(elementChildren(fragment)[0] || fragment, 'data-kodety-value') || value;
}

function safeOverrideAttribute(name: string, value: string | null) {
  if (!/^[a-z_:][a-z0-9_.:-]*$/i.test(name)) return false;
  const normalized = name.toLowerCase();
  if (
    normalized.includes(':')
    ||
    normalized === 'style'
    || normalized === 'srcdoc'
    || normalized.startsWith('on')
    || normalized === 'data-kodety-l10n-id'
    || normalized.startsWith('data-kodety-bind-')
    || normalized.startsWith('data-kodety-locale-')
  ) return false;
  if (value === null) return true;
  if (normalized === 'id') {
    return codePointLength(value) > 0
      && codePointLength(value) <= MAX_LOCALIZATION_ID_LENGTH
      && value.trim() === value
      && !/[\s\u0000-\u001f\u007f<>"'`=]/.test(value);
  }
  if (normalized === 'class') {
    return codePointLength(value) <= MAX_LOCALIZATION_CLASS_LENGTH
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>"'`=]/.test(value);
  }
  return !URL_ATTRIBUTES.has(normalized) || !unsafeInsertionUrl(normalized, value);
}

function safeOverrideStyle(property: string, value: string | null) {
  const normalized = property.trim().toLowerCase();
  if (
    !/^(?:--[a-z0-9_-]+|[a-z][a-z0-9-]*)$/.test(normalized)
    || normalized === 'behavior'
    || normalized === '-moz-binding'
  ) return false;
  return value === null || !unsafeInsertionStyle(value);
}

function localizationPersistenceCountError(
  errors: string[],
  path: string,
  count: number,
  limit: number,
  label: string,
) {
  if (count <= limit) return;
  errors.push(`${path}: ${label} possui ${count.toLocaleString(getAdminUiLocale())} itens; o limite é ${limit.toLocaleString(getAdminUiLocale())}.`);
}

function localizationPersistenceScalarError(
  errors: string[],
  path: string,
  value: unknown,
  byteLimit: number = LOCALIZATION_PERSISTENCE_LIMITS.scalarBytes,
) {
  if (typeof value !== 'string') return;
  const bytes = utf8ByteLength(value);
  if (bytes <= byteLimit) return;
  errors.push(`${path}: o conteúdo usa ${bytes.toLocaleString(getAdminUiLocale())} bytes; o limite é ${byteLimit.toLocaleString(getAdminUiLocale())} bytes.`);
}

function decodedLocalizationPath(value: string) {
  let decoded = value;
  try {
    for (let pass = 0; pass < 2; pass += 1) decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  return decoded;
}

function unsafeLocalizationPath(value: unknown, authored: boolean) {
  if (typeof value !== 'string') return true;
  const path = value.trim().replaceAll('\\', '/');
  const decoded = decodedLocalizationPath(path);
  if (
    !decoded
    || /[\u0000-\u001f\u007f]/.test(path)
    || /[\u0000-\u001f\u007f]/.test(decoded)
    || /[\\?#]/.test(decoded)
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)
  ) return true;
  if (!authored) return false;
  const normalized = path.replace(/^\.\/+/, '');
  return path.startsWith('/')
    || normalized.toLowerCase().startsWith('.incode/')
    || normalized.toLowerCase().startsWith('.coday/')
    || !/\.html?$/i.test(normalized);
}

/** Validate a complete candidate without mutating, normalizing or truncating
 * it. Callers can render the first error in the UI and keep the previous
 * metadata untouched. */
export function validateLocalizationForPersistence(
  settings: LocalizationSettings,
): LocalizationPersistenceValidation {
  const errors: string[] = [];
  const limits = LOCALIZATION_PERSISTENCE_LIMITS;
  const locales = Array.isArray(settings.locales) ? settings.locales : [];
  const translations = settings.translations && typeof settings.translations === 'object'
    ? settings.translations
    : {};

  localizationPersistenceCountError(errors, 'locales', locales.length, limits.locales, 'A lista de idiomas');
  localizationPersistenceCountError(
    errors,
    'translations',
    Object.keys(translations).length,
    limits.translations,
    'A lista de traduções',
  );
  localizationPersistenceScalarError(errors, 'sourceLocale', settings.sourceLocale);
  localizationPersistenceScalarError(errors, 'defaultLocale', settings.defaultLocale);
  (['automaticLocale', 'rememberLocale', 'translatePagePaths', 'includePathsInAi'] as const)
    .forEach((key) => {
      if (typeof settings[key] !== 'boolean') errors.push(`${key}: use verdadeiro ou falso.`);
    });

  const localeCodes = new Set<string>();
  const enabledLocaleCodes = new Set<string>();
  const enabledSlugs = new Set<string>();

  locales.forEach((locale, localeIndex) => {
    const path = `locales[${localeIndex}]`;
    if (!locale || typeof locale !== 'object') {
      errors.push(`${path}: idioma inválido.`);
      return;
    }
    const canonicalCode = typeof locale.code === 'string' ? canonicalLocaleCode(locale.code) : '';
    if (!canonicalCode || canonicalCode !== locale.code || localeCodes.has(canonicalCode)) {
      errors.push(`${path}.code: código BCP 47 inválido, não canônico ou duplicado.`);
    } else {
      localeCodes.add(canonicalCode);
      if (locale.enabled) enabledLocaleCodes.add(canonicalCode);
    }
    if (typeof locale.slug !== 'string' || (locale.slug !== '' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(locale.slug))) {
      errors.push(`${path}.slug: prefixo de URL inválido.`);
    } else if (locale.enabled) {
      const slug = locale.slug.toLowerCase();
      if (enabledSlugs.has(slug)) errors.push(`${path}.slug: outro idioma publicado já usa este prefixo.`);
      enabledSlugs.add(slug);
    }
    ([
      ['code', locale.code],
      ['language', locale.language],
      ['region', locale.region],
      ['name', locale.name],
      ['slug', locale.slug],
      ['fallback', locale.fallback],
      ['aiModel', locale.aiModel],
      ['aiStyle', locale.aiStyle],
    ] as const).forEach(([key, value]) => {
      localizationPersistenceScalarError(errors, `${path}.${key}`, value);
    });
  });

  if (!localeCodes.has(settings.sourceLocale) || !enabledLocaleCodes.has(settings.sourceLocale)) {
    errors.push('sourceLocale: o idioma fonte precisa existir e estar publicado.');
  }
  if (!enabledLocaleCodes.has(settings.defaultLocale)) {
    errors.push('defaultLocale: o idioma padrão precisa existir e estar publicado.');
  }
  const defaultDefinition = locales.find((locale) => locale?.code === settings.defaultLocale);
  if (defaultDefinition?.slug !== '') errors.push('defaultLocale: o idioma padrão precisa usar a URL sem prefixo.');
  locales.forEach((locale, localeIndex) => {
    if (!locale || locale.code === settings.sourceLocale) return;
    if (
      typeof locale.fallback !== 'string'
      || locale.fallback === locale.code
      || !enabledLocaleCodes.has(locale.fallback)
    ) errors.push(`locales[${localeIndex}].fallback: selecione outro idioma publicado.`);
  });

  Object.entries(translations).forEach(([localeCode, localeTranslation]) => {
    const localePath = `translations[${JSON.stringify(localeCode)}]`;
    if (!localeCodes.has(localeCode) || localeCode === settings.sourceLocale) {
      errors.push(`${localePath}: a tradução não pertence a um idioma de destino configurado.`);
    }
    localizationPersistenceScalarError(errors, `${localePath}.code`, localeCode);
    localizationPersistenceScalarError(
      errors,
      `${localePath}.siteTitle`,
      localeTranslation?.siteTitle,
      limits.titleBytes,
    );
    localizationPersistenceScalarError(
      errors,
      `${localePath}.siteDescription`,
      localeTranslation?.siteDescription,
      limits.descriptionBytes,
    );
    const pages = localeTranslation?.pages && typeof localeTranslation.pages === 'object'
      && !Array.isArray(localeTranslation.pages)
      ? localeTranslation.pages
      : {};
    localizationPersistenceCountError(
      errors,
      `${localePath}.pages`,
      Object.keys(pages).length,
      limits.pagesPerLocale,
      'A lista de páginas',
    );

    const localizedRoutes = new Set<string>();
    Object.entries(pages).forEach(([pagePath, page]) => {
      const path = `${localePath}.pages[${JSON.stringify(pagePath)}]`;
      if (unsafeLocalizationPath(pagePath, true)) {
        errors.push(`${path}: caminho da página original inválido ou inseguro.`);
      }
      if (page?.path) {
        if (unsafeLocalizationPath(page.path, false)) {
          errors.push(`${path}.path: URL traduzida inválida ou insegura.`);
        } else {
          const decodedRoute = decodedLocalizationPath(page.path.trim().replace(/^\/+|\/+$/g, ''));
          const routeKey = decodedRoute?.replace(/\/{2,}/g, '/').toLocaleLowerCase() || '';
          if (routeKey && localizedRoutes.has(routeKey)) {
            errors.push(`${path}.path: outra página traduzida já usa esta URL.`);
          }
          if (routeKey) localizedRoutes.add(routeKey);
        }
      }
      localizationPersistenceScalarError(errors, `${path}.key`, pagePath, limits.pagePathBytes);
      localizationPersistenceScalarError(errors, `${path}.path`, page?.path, limits.pagePathBytes);
      localizationPersistenceScalarError(errors, `${path}.title`, page?.title, limits.titleBytes);
      localizationPersistenceScalarError(
        errors,
        `${path}.description`,
        page?.description,
        limits.descriptionBytes,
      );
      if (page?.stylesheet !== undefined) {
        const stylesheet = normalizeLocalizedStylesheetPath(page.stylesheet);
        if (!stylesheet || stylesheet !== page.stylesheet) {
          errors.push(`${path}.stylesheet: caminho de stylesheet localizado inválido ou inseguro.`);
        }
        localizationPersistenceScalarError(
          errors,
          `${path}.stylesheet`,
          page.stylesheet,
          limits.pagePathBytes,
        );
      }

      const entries = page?.entries && typeof page.entries === 'object' ? page.entries : {};
      localizationPersistenceCountError(
        errors,
        `${path}.entries`,
        Object.keys(entries).length,
        limits.entriesPerPage,
        'A lista de textos traduzidos',
      );
      Object.entries(entries).forEach(([entryKey, value]) => {
        if (!SAFE_LOCALIZATION_ENTRY_KEY_PATTERN.test(entryKey)) {
          errors.push(`${path}.entries[${JSON.stringify(entryKey)}]: chave de tradução inválida.`);
        }
        localizationPersistenceScalarError(
          errors,
          `${path}.entries.key`,
          entryKey,
          limits.entryKeyBytes,
        );
        localizationPersistenceScalarError(errors, `${path}.entries[${JSON.stringify(entryKey)}]`, value);
      });

      const overrides = page?.overrides && typeof page.overrides === 'object' ? page.overrides : {};
      localizationPersistenceCountError(
        errors,
        `${path}.overrides`,
        Object.keys(overrides).length,
        limits.overridesPerPage,
        'A lista de overrides',
      );
      Object.entries(overrides).forEach(([elementKey, override]) => {
        const overridePath = `${path}.overrides[${JSON.stringify(elementKey)}]`;
        if (!safeLocalizationElementKey(elementKey)) {
          errors.push(`${overridePath}: chave de layer inválida.`);
        }
        localizationPersistenceScalarError(errors, `${overridePath}.key`, elementKey);
        const attributes = override?.attributes && typeof override.attributes === 'object'
          ? override.attributes
          : {};
        localizationPersistenceCountError(
          errors,
          `${overridePath}.attributes`,
          Object.keys(attributes).length,
          limits.attributesPerOverride,
          'A lista de atributos',
        );
        Object.entries(attributes).forEach(([name, value]) => {
          if (!safeOverrideAttribute(name, value)) {
            errors.push(`${overridePath}.attributes[${JSON.stringify(name)}]: atributo inseguro ou reservado.`);
            return;
          }
          localizationPersistenceScalarError(errors, `${overridePath}.attributes.key`, name);
          localizationPersistenceScalarError(
            errors,
            `${overridePath}.attributes[${JSON.stringify(name)}]`,
            value,
          );
        });

        const styles = override?.styles && typeof override.styles === 'object'
          ? override.styles
          : {};
        localizationPersistenceCountError(
          errors,
          `${overridePath}.styles`,
          Object.keys(styles).length,
          limits.stylesPerOverride,
          'A lista de estilos',
        );
        Object.entries(styles).forEach(([property, value]) => {
          if (!safeOverrideStyle(property, value)) {
            errors.push(`${overridePath}.styles[${JSON.stringify(property)}]: propriedade ou valor CSS inseguro.`);
            return;
          }
          localizationPersistenceScalarError(errors, `${overridePath}.styles.key`, property);
          localizationPersistenceScalarError(
            errors,
            `${overridePath}.styles[${JSON.stringify(property)}]`,
            value,
            limits.styleValueBytes,
          );
        });
      });

      const insertions = Array.isArray(page?.insertions) ? page.insertions : [];
      localizationPersistenceCountError(
        errors,
        `${path}.insertions`,
        insertions.length,
        limits.insertionsPerPage,
        'A lista de seções exclusivas',
      );
      insertions.forEach((insertion, insertionIndex) => {
        const insertionPath = `${path}.insertions[${insertionIndex}]`;
        if (!safeLocalizationId(insertion?.id)) {
          errors.push(`${insertionPath}.id: identificador de seção inválido.`);
        }
        if (
          !insertion?.removed
          && (
            !safeLocalizationElementKey(insertion?.anchor)
            || !['before', 'after', 'prepend', 'append'].includes(insertion?.position)
          )
        ) {
          errors.push(`${insertionPath}: âncora ou posição inválida.`);
        }
        localizationPersistenceScalarError(errors, `${insertionPath}.id`, insertion?.id);
        localizationPersistenceScalarError(errors, `${insertionPath}.anchor`, insertion?.anchor);
        localizationPersistenceScalarError(errors, `${insertionPath}.position`, insertion?.position);
        localizationPersistenceScalarError(
          errors,
          `${insertionPath}.html`,
          insertion?.html,
          limits.htmlBytes,
        );
      });
    });
  });

  return { valid: errors.length === 0, errors };
}

export function assertLocalizationForPersistence(settings: LocalizationSettings) {
  const validation = validateLocalizationForPersistence(settings);
  if (validation.valid) return;
  const [first, ...remaining] = validation.errors;
  throw new Error(
    `A localização não foi salva. ${first}${remaining.length ? ` (+${remaining.length} problema${remaining.length === 1 ? '' : 's'})` : ''}`,
  );
}

/** Pure mutation primitive used by preview and by regression tests. Starting
 * from the authored attributes on every render is what makes locale switching
 * lossless: a missing field falls back to base, while `null` is an explicit
 * deletion in this locale only. */
export function applyLocaleElementOverrideToAttributes(
  authoredAttributes: Record<string, string>,
  override: LocalizationElementOverride,
) {
  const attributes = { ...authoredAttributes };
  Object.entries(override.attributes || {}).forEach(([rawName, value]) => {
    const name = rawName.trim().toLowerCase();
    if (!safeOverrideAttribute(name, value)) return;
    setRecordAttribute(attributes, name, value);
  });

  let styles = parseStyleDeclarations(attributes.style || '');
  Object.entries(override.styles || {}).forEach(([property, value]) => {
    if (!safeOverrideStyle(property, value)) return;
    styles = writeStyleDeclaration(styles, property, value || '', { authoritative: true });
  });

  if (override.visible === false) {
    setRecordAttribute(attributes, LOCALE_HIDDEN_ATTRIBUTE, '');
    setRecordAttribute(attributes, 'hidden', 'hidden');
    setRecordAttribute(attributes, 'aria-hidden', 'true');
    styles = writeStyleDeclaration(styles, 'display', 'none', { authoritative: true });
  } else if (override.visible === true) {
    // An explicit visible locale override is authoritative over both an
    // inherited hidden override and authored HTML visibility attributes.
    // Preserve a real base display (grid/flex/etc.) and remove only the
    // inline `display:none` value that would otherwise make the control lie.
    setRecordAttribute(attributes, LOCALE_HIDDEN_ATTRIBUTE, null);
    setRecordAttribute(attributes, 'hidden', null);
    setRecordAttribute(attributes, 'aria-hidden', null);
    const display = (styles.display || '').replace(/\s*!\s*important\s*$/i, '').trim();
    if (/^none$/i.test(display)) {
      styles = writeStyleDeclaration(styles, 'display', '', { authoritative: true });
    }
  }

  const serializedStyles = serializeStyleDeclarations(styles);
  setRecordAttribute(attributes, 'style', serializedStyles || null);
  return attributes;
}

function replaceParsedText(element: ParsedNode, value: string) {
  const text: ParsedNode = { nodeName: '#text', value, parentNode: element };
  element.childNodes = [text];
}

function replaceParsedDirectText(element: ParsedNode, ordinal: number, value: string) {
  const textNode = localizableDirectTextNodes(element)[ordinal];
  if (!textNode) return;
  const authored = textNode.value || '';
  const leadingWhitespace = authored.match(/^\s*/u)?.[0] || '';
  const trailingWhitespace = authored.match(/\s*$/u)?.[0] || '';
  textNode.value = `${leadingWhitespace}${value.trim()}${trailingWhitespace}`;
}

function legacyEntryKey(entry: LocalizableEntry) {
  if (entry.kind === 'text') return `path:${entry.path}:text`;
  if (entry.kind === 'text-node') return `path:${entry.path}:text-node:${entry.textNodeOrdinal || 0}`;
  return `path:${entry.path}:attr:${entry.attribute || ''}`;
}

function elementKeyForEntry(entry: LocalizableEntry) {
  const suffix = entry.kind === 'text'
    ? ':text'
    : entry.kind === 'text-node'
      ? `:text-node:${entry.textNodeOrdinal || 0}`
      : `:attr:${entry.attribute || ''}`;
  return entry.key.endsWith(suffix) ? entry.key.slice(0, -suffix.length) : '';
}

/** Read both stable v2 IDs and the original v1 path key. Adding structural
 * IDs to an old project must never orphan translations that were already
 * saved before the migration. */
export function translationValueForEntry(
  entries: Record<string, string>,
  entry: LocalizableEntry,
) {
  const legacyKey = legacyEntryKey(entry);
  for (const key of Array.from(new Set([entry.key, legacyKey]))) {
    const value = entries[key];
    if (Object.prototype.hasOwnProperty.call(entries, key) && value.trim() !== '') return value;
  }
  return undefined;
}

function applyEntryTranslations(
  body: ParsedNode,
  source: string,
  entries: Record<string, string>,
) {
  extractLocalizableEntries(source).forEach((entry) => {
    const value = translationValueForEntry(entries, entry);
    if (value === undefined) return;
    let element: ParsedNode | null = null;
    if (entry.key.startsWith('id:')) {
      const key = elementKeyForEntry(entry);
      element = key ? parsedElementsByKey(body, key)[0] || null : null;
    }
    element ||= findParsedElementByPath(body, entry.path);
    if (!element) return;
    if (entry.kind === 'text') replaceParsedText(element, value);
    else if (entry.kind === 'text-node' && entry.textNodeOrdinal !== undefined) {
      replaceParsedDirectText(element, entry.textNodeOrdinal, value);
    }
    else if (entry.attribute) setParsedAttribute(element, entry.attribute, value);
  });
}

function insertNodesAt(
  anchor: ParsedNode,
  nodes: ParsedNode[],
  position: LocalizationInsertionPosition,
  cursorByAnchor: WeakMap<ParsedNode, Partial<Record<LocalizationInsertionPosition, ParsedNode>>>,
) {
  if (!nodes.length) return;
  const cursor = cursorByAnchor.get(anchor) || {};
  if (position === 'prepend' || position === 'append') {
    anchor.childNodes ||= [];
    const previous = cursor[position];
    const index = position === 'prepend'
      ? previous ? anchor.childNodes.indexOf(previous) + 1 : 0
      : anchor.childNodes.length;
    nodes.forEach((node) => { node.parentNode = anchor; });
    anchor.childNodes.splice(Math.max(0, index), 0, ...nodes);
    cursor[position] = nodes[nodes.length - 1];
    cursorByAnchor.set(anchor, cursor);
    return;
  }
  const parent = anchor.parentNode;
  if (!parent?.childNodes) return;
  const previous = position === 'after' ? cursor.after : undefined;
  const reference = previous || anchor;
  const referenceIndex = parent.childNodes.indexOf(reference);
  if (referenceIndex < 0) return;
  const index = position === 'before' ? parent.childNodes.indexOf(anchor) : referenceIndex + 1;
  nodes.forEach((node) => { node.parentNode = parent; });
  parent.childNodes.splice(Math.max(0, index), 0, ...nodes);
  if (position === 'after') {
    cursor.after = nodes[nodes.length - 1];
    cursorByAnchor.set(anchor, cursor);
  }
}

function unsafeInsertionUrl(attribute: string, value: string) {
  const normalized = decodedAttributeValue(value).trim();
  const canonical = normalized.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (/(?:^|,)(?:javascript|vbscript):/i.test(canonical)) return true;
  if (!/^data:/i.test(canonical)) return false;
  if (!['src', 'srcset', 'poster'].includes(attribute)) return true;
  return /^data:(?!image\/)/i.test(canonical);
}

function unsafeInsertionStyle(value: string) {
  return /(?:expression\s*\(|javascript\s*:|vbscript\s*:)/i.test(value);
}

/** Locale-only sections are content/layout, not an executable-code channel.
 * Keep the preview and the WordPress runtime on the same trust boundary:
 * scripts belong in the audited Custom Code feature. */
function sanitizeLocalizationFragment(
  root: ParsedNode,
  usedLocalizationIds: Set<string>,
  usedDocumentIds: Set<string>,
) {
  const sanitizeChildren = (parent: ParsedNode) => {
    parent.childNodes = (parent.childNodes || []).filter((child) => {
      const tagName = (child.tagName || '').toLowerCase();
      if (tagName && UNSAFE_INSERTION_TAGS.has(tagName)) return false;
      if (tagName) {
        child.attrs = (child.attrs || []).filter((attribute) => {
          const name = attribute.name.toLowerCase();
          if (
            attribute.prefix
            || attribute.namespace
            || name.includes(':')
            || name.startsWith('on')
            || name === 'srcdoc'
          ) return false;
          if (name === 'data-kodety-l10n-id') {
            const id = attribute.value.trim();
            // Unique child IDs are useful for inherited element overrides.
            // A copied base ID or a duplicate across locale payloads would
            // target multiple elements, so retain only the first unique owner.
            if (
              !safeLocalizationId(id)
              || usedLocalizationIds.has(id)
            ) return false;
            attribute.value = id;
            usedLocalizationIds.add(id);
          }
          if (name === 'id') {
            const id = attribute.value;
            if (!safeOverrideAttribute(name, id) || usedDocumentIds.has(id)) return false;
            usedDocumentIds.add(id);
          }
          // Ownership is runtime-assigned. Payloads cannot forge either the
          // canonical marker or future marker extensions.
          if (name.startsWith('data-kodety-locale-')) return false;
          if (URL_ATTRIBUTES.has(name) && unsafeInsertionUrl(name, attribute.value)) return false;
          if (name === 'style' && unsafeInsertionStyle(attribute.value)) return false;
          return true;
        });
      }
      sanitizeChildren(child);
      return true;
    });
  };
  sanitizeChildren(root);
}

function localizationInsertionNodes(
  fragment: ParsedNode,
  insertionId?: string,
) {
  const nodes: ParsedNode[] = [];
  (fragment.childNodes || []).forEach((node) => {
    if (node.tagName) {
      // The marker is assigned only after the payload marker-cleaning pass.
      // Re-canonicalizing the generated wrapper is therefore idempotent while
      // arbitrary `data-kodety-locale-*` attributes never cross the boundary.
      if (
        node.tagName === 'span'
        && !elementChildren(node).length
        && parsedTextContent(node).trim()
      ) setParsedAttribute(node, LOCALE_TEXT_ROOT_ATTRIBUTE, '1');
      if (insertionId) setParsedAttribute(node, LOCALE_INSERTION_ATTRIBUTE, insertionId);
      nodes.push(node);
      return;
    }
    if (node.nodeName === '#text' && (node.value || '').trim()) {
      const wrapperFragment = parseFragment(
        `<span ${LOCALE_TEXT_ROOT_ATTRIBUTE}="1"></span>`,
      ) as unknown as ParsedNode;
      const wrapper = elementChildren(wrapperFragment)[0] || null;
      if (!wrapper) return;
      wrapper.childNodes = [node];
      node.parentNode = wrapper;
      if (insertionId) setParsedAttribute(wrapper, LOCALE_INSERTION_ATTRIBUTE, insertionId);
      nodes.push(wrapper);
      return;
    }
    // Preserve formatting whitespace/comments without presenting them as an
    // editable locale root. Any meaningful text always has an owner wrapper.
    nodes.push(node);
  });
  return nodes;
}

/** Canonical representation edited by the visual locale tools. Sanitizing
 * before path-based mutations keeps rendered paths identical to stored paths:
 * an unsafe sibling removed at preview time can no longer make a later edit
 * accidentally target the raw `<script>` instead. */
export function canonicalizeLocalizationInsertionHtml(html: string) {
  if (typeof html !== 'string' || !html) return '';
  const fragment = parseFragment(html) as unknown as ParsedNode;
  sanitizeLocalizationFragment(fragment, new Set(), new Set());
  const nodes = localizationInsertionNodes(fragment);
  fragment.childNodes = nodes;
  nodes.forEach((node) => { node.parentNode = fragment; });
  return serialize(fragment as never);
}

function applyLocalizationInsertions(body: ParsedNode, insertions: LocalizationInsertion[]) {
  const cursorByAnchor = new WeakMap<ParsedNode, Partial<Record<LocalizationInsertionPosition, ParsedNode>>>();
  const usedLocalizationIds = new Set<string>();
  const usedDocumentIds = new Set<string>();
  walkParsedElements(body, (element) => {
    const id = parsedAttribute(element, 'data-kodety-l10n-id')?.trim();
    if (id) usedLocalizationIds.add(id);
    const documentId = parsedAttribute(element, 'id');
    if (documentId) usedDocumentIds.add(documentId);
  });

  // Imported metadata can put a child before the insertion that provides its
  // anchor. Retry only unresolved records. A successful pass always consumes
  // at least one item; cycles and missing anchors stop deterministically.
  let pending = mergeLocalizationInsertions([], insertions)
    .filter((insertion) => insertion.enabled !== false);
  while (pending.length) {
    const next: LocalizationInsertion[] = [];
    let progressed = false;
    pending.forEach((insertion) => {
      const anchor = parsedElementsByKey(body, insertion.anchor)[0];
      if (!anchor) {
        next.push(insertion);
        return;
      }
      const fragment = parseFragment(anchor as never, insertion.html, {}) as unknown as ParsedNode;
      sanitizeLocalizationFragment(fragment, usedLocalizationIds, usedDocumentIds);
      const nodes = localizationInsertionNodes(fragment, insertion.id);
      insertNodesAt(anchor, nodes, insertion.position, cursorByAnchor);
      // Empty/fully-sanitized payloads are consumed: retrying cannot create
      // the anchor required by a dependent and would otherwise never finish.
      progressed = true;
    });
    if (!progressed) break;
    pending = next;
  }
}

function overridePriority(key: string) {
  if (key.startsWith('path:') || key === 'body') return 0;
  if (key.startsWith('id:')) return 1;
  if (key.startsWith('insertion:')) return 2;
  return 3;
}

function neutralizeStaleImageCandidates(element: ParsedNode) {
  STALE_IMAGE_CANDIDATE_ATTRIBUTES.forEach((attribute) => removeParsedAttribute(element, attribute));
  let picture = element.parentNode;
  while (picture && picture.tagName !== 'picture') picture = picture.parentNode;
  if (!picture) return;
  walkParsedElements(picture, (candidate) => {
    if (candidate.tagName !== 'source') return;
    ['src', ...STALE_IMAGE_CANDIDATE_ATTRIBUTES].forEach((attribute) => {
      removeParsedAttribute(candidate, attribute);
    });
  }, false);
}

function applyElementOverrides(
  body: ParsedNode,
  overrides: Record<string, LocalizationElementOverride>,
  afterInsertions: boolean,
  appliedKeys = new Set<string>(),
) {
  const candidates = Object.entries(overrides)
    .sort(([left], [right]) => overridePriority(left) - overridePriority(right) || left.localeCompare(right))
    .filter(([key]) => {
      const insertionTarget = key.startsWith('insertion:');
      if (!afterInsertions) return !insertionTarget;
      return insertionTarget || (key.startsWith('id:') && !appliedKeys.has(key));
    })
    .map(([key, override]) => ({
      key,
      override,
      elements: parsedElementsByKey(body, key),
    }));

  // Neutralize every picture first. A source element that also has an
  // explicit locale override is then restored by the normal application pass,
  // independently of object-key ordering.
  candidates.forEach(({ override, elements }) => {
    elements.forEach((element) => {
      if (
        element.tagName === 'img'
        && ['src', ...STALE_IMAGE_CANDIDATE_ATTRIBUTES].some((attribute) => (
          Object.prototype.hasOwnProperty.call(override.attributes || {}, attribute)
        ))
      ) neutralizeStaleImageCandidates(element);
    });
  });

  const documentIdOwners = new Map<string, Set<ParsedNode>>();
  walkParsedElements(body, (element) => {
    const id = parsedAttribute(element, 'id');
    if (!id) return;
    const owners = documentIdOwners.get(id) || new Set<ParsedNode>();
    owners.add(element);
    documentIdOwners.set(id, owners);
  });
  const removeIdOwner = (id: string | undefined, element: ParsedNode) => {
    if (!id) return;
    const owners = documentIdOwners.get(id);
    owners?.delete(element);
    if (!owners?.size) documentIdOwners.delete(id);
  };
  const addIdOwner = (id: string | undefined, element: ParsedNode) => {
    if (!id) return;
    const owners = documentIdOwners.get(id) || new Set<ParsedNode>();
    owners.add(element);
    documentIdOwners.set(id, owners);
  };

  candidates.forEach(({ key, override, elements }) => {
    elements.forEach((element) => {
      const currentAttributes = parsedAttributes(element);
      const requestedIdEntries = Object.entries(override.attributes || {})
        .filter(([name]) => name.trim().toLowerCase() === 'id');
      const requestedIdEntry = requestedIdEntries[requestedIdEntries.length - 1];
      const requestedId = requestedIdEntry?.[1];
      let effectiveOverride = override;
      if (typeof requestedId === 'string' && safeOverrideAttribute('id', requestedId)) {
        const owners = documentIdOwners.get(requestedId);
        const collides = elements.length > 1
          || Boolean(owners && [...owners].some((owner) => owner !== element));
        if (collides) {
          const attributes = { ...(override.attributes || {}) };
          requestedIdEntries.forEach(([name]) => { delete attributes[name]; });
          effectiveOverride = { ...override, attributes };
        }
      }
      const nextAttributes = applyLocaleElementOverrideToAttributes(currentAttributes, effectiveOverride);
      replaceParsedAttributes(element, nextAttributes);
      removeIdOwner(currentAttributes.id, element);
      addIdOwner(nextAttributes.id, element);
    });
    if (elements.length) appliedKeys.add(key);
  });
  return appliedKeys;
}

function firstParsedElement(root: ParsedNode, tagName: string): ParsedNode | null {
  let found: ParsedNode | null = null;
  const visit = (node: ParsedNode) => {
    if (found) return;
    if (node.tagName === tagName) { found = node; return; }
    (node.childNodes || []).forEach(visit);
  };
  visit(root);
  return found;
}

function createParsedElement(context: ParsedNode, markup: string) {
  const fragment = parseFragment(context as never, markup, {}) as unknown as ParsedNode;
  return elementChildren(fragment)[0] || null;
}

const LOCALIZED_STYLESHEET_ATTRIBUTE = 'data-kodety-localized-style';

function parsedHasAttribute(node: ParsedNode, name: string) {
  return node.attrs?.some((attribute) => attribute.name.toLowerCase() === name.toLowerCase()) === true;
}

function parsedLinkIsStylesheet(node: ParsedNode) {
  return node.tagName === 'link'
    && (parsedAttribute(node, 'rel') || '').toLowerCase().split(/\s+/).includes('stylesheet');
}

function injectLocalizedStylesheets(
  head: ParsedNode | null,
  pagePath: string,
  localeCode: string,
  settings: LocalizationSettings,
) {
  if (!head) return;
  const children = (head.childNodes || []).filter((node) => !(
    node.tagName === 'link' && parsedHasAttribute(node, LOCALIZED_STYLESHEET_ATTRIBUTE)
  ));
  const existingHrefs = new Set(
    children
      .filter(parsedLinkIsStylesheet)
      .map((node) => (parsedAttribute(node, 'href') || '').trim())
      .filter(Boolean),
  );
  const overlays = resolveLocalizationStylesheets(settings, localeCode, pagePath).flatMap((path) => {
    const href = localizedStylesheetHref(pagePath, path);
    if (!href || existingHrefs.has(href)) return [];
    existingHrefs.add(href);
    const link = createParsedElement(head, '<link>');
    if (!link) return [];
    setParsedAttribute(link, 'rel', 'stylesheet');
    setParsedAttribute(link, 'href', href);
    setParsedAttribute(link, LOCALIZED_STYLESHEET_ATTRIBUTE, path);
    link.parentNode = head;
    return [link];
  });
  // The live canvas appends localized CSS after every authored <link>/<style>.
  // Canonical preview and publication must use the same cascade order so a
  // value cannot win during a drag and then lose after the iframe reloads.
  if (overlays.length) children.push(...overlays);
  head.childNodes = children;
}

function resolveLocalizationMetadataValue(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  kind: 'title' | 'description',
): string | undefined {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = localeCode;
  while (current && current !== settings.sourceLocale && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = settings.locales.find((candidate) => candidate.code === current)?.fallback;
  }
  // A page-specific value is always more precise than a global value, even
  // when the page value comes from a fallback locale.
  for (const code of chain) {
    const pageValue = settings.translations[code]?.pages?.[pagePath]?.[kind];
    if (typeof pageValue === 'string' && pageValue.trim() !== '') return pageValue;
  }
  for (const code of chain) {
    const direct = settings.translations[code];
    const siteValue = kind === 'title' ? direct?.siteTitle : direct?.siteDescription;
    if (typeof siteValue === 'string' && siteValue.trim() !== '') return siteValue;
  }
  return undefined;
}

export function applyPageTranslations(source: string, pagePath: string, localeCode: string, settings: LocalizationSettings) {
  if (!source || localeCode === settings.sourceLocale) return source;
  const translations = resolveLocalizationPage(settings, localeCode, pagePath);
  const { document, html, head, body } = parsedDocumentParts(source);
  if (!html || !body) return source;

  // Legacy path entries and overrides resolve against the unmodified source
  // tree. Locale insertions can therefore never shift an old index selector.
  applyEntryTranslations(body, source, translations?.entries || {});
  const appliedOverrideKeys = applyElementOverrides(body, translations?.overrides || {}, false);
  applyLocalizationInsertions(body, translations?.insertions || []);
  applyElementOverrides(body, translations?.overrides || {}, true, appliedOverrideKeys);

  setParsedAttribute(html, 'lang', localeCode);
  const locale = settings.locales.find((candidate) => candidate.code === localeCode);
  setParsedAttribute(html, 'dir', locale?.direction || 'ltr');

  const localizedTitle = resolveLocalizationMetadataValue(settings, localeCode, pagePath, 'title');
  if (localizedTitle) {
    let title = firstParsedElement(head || html, 'title');
    if (!title && head) {
      title = createParsedElement(head, '<title></title>');
      if (title) {
        head.childNodes ||= [];
        title.parentNode = head;
        head.childNodes.push(title);
      }
    }
    if (title) replaceParsedText(title, localizedTitle);
  }

  const localizedDescription = resolveLocalizationMetadataValue(settings, localeCode, pagePath, 'description');
  if (localizedDescription && head) {
    let meta = elementChildren(head).find((node) =>
      node.tagName === 'meta' && parsedAttribute(node, 'name')?.toLowerCase() === 'description',
    ) || null;
    if (!meta) {
      meta = createParsedElement(head, '<meta name="description">');
      if (meta) {
        head.childNodes ||= [];
        meta.parentNode = head;
        head.childNodes.push(meta);
      }
    }
    if (meta) setParsedAttribute(meta, 'content', localizedDescription);
  }

  injectLocalizedStylesheets(head, pagePath, localeCode, settings);

  const rendered = serialize(document as never);
  return /^<!doctype\b/i.test(rendered) ? rendered : `<!doctype html>\n${rendered}`;
}

/** Materialize localized HTML files. Omitting `filePaths` keeps publication's
 * complete-project behavior; editor previews may target only their open file. */
export function translatedProject(
  project: HtmlProject,
  localeCode: string,
  settings: LocalizationSettings,
  filePaths?: readonly string[],
): HtmlProject {
  if (localeCode === settings.sourceLocale) return project;
  let files = project.files;
  const translateFile = (file: HtmlProjectFile) => {
    const pagePath = localizationDocumentPagePath(file);
    if (!pagePath || file.text === undefined) return;
    const text = applyPageTranslations(file.text, pagePath, localeCode, settings);
    if (text !== file.text) files = { ...files, [file.path]: { ...file, text } };
  };
  if (filePaths) {
    new Set(filePaths).forEach((filePath) => {
      const file = project.files[filePath];
      if (file) translateFile(file);
    });
  } else {
    Object.values(project.files).forEach(translateFile);
  }
  if (files === project.files) return project;
  return {
    ...project,
    files,
  };
}

export function updateTranslation(settings: LocalizationSettings, localeCode: string, pagePath: string, key: string, value: string): LocalizationSettings {
  const locale = settings.translations[localeCode] || { pages: {} };
  const page = locale.pages[pagePath] || { entries: {} };
  const entries = { ...page.entries };
  if (value.trim() === '') delete entries[key];
  else entries[key] = value;
  const next = {
    ...settings,
    translations: {
      ...settings.translations,
      [localeCode]: {
        ...locale,
        pages: { ...locale.pages, [pagePath]: { ...page, entries } },
      },
    },
  };
  assertLocalizationForPersistence(next);
  return next;
}

function updateDirectLocalePage(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  transform: (page: LocalizationPageTranslation) => LocalizationPageTranslation,
) {
  if (
    localeCode === settings.sourceLocale
    || !localeCode.trim()
    || !pagePath.trim()
  ) return settings;
  const locale = settings.translations[localeCode] || { pages: {} };
  const page = locale.pages[pagePath] || { entries: {} };
  const nextPage = transform(page);
  if (nextPage === page) return settings;
  const next = {
    ...settings,
    translations: {
      ...settings.translations,
      [localeCode]: {
        ...locale,
        pages: {
          ...locale.pages,
          [pagePath]: nextPage,
        },
      },
    },
  };
  assertLocalizationForPersistence(next);
  return next;
}

/** Point one locale/page at its direct CSS overlay. Passing null removes only
 * this locale's file reference so the page resumes inheriting fallback CSS. */
export function updateLocalePageVisualOverrides(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  patch: {
    stylesheet?: string | null;
    overrides?: Record<string, LocalizationElementOverride>;
  },
): LocalizationSettings {
  const patchesStylesheet = Object.prototype.hasOwnProperty.call(patch, 'stylesheet');
  const normalizedStylesheet = patch.stylesheet === null
    ? ''
    : patch.stylesheet === undefined
      ? ''
      : normalizeLocalizedStylesheetPath(patch.stylesheet);
  if (patchesStylesheet && patch.stylesheet !== null && !normalizedStylesheet) return settings;
  const normalizedOverrides = Object.entries(patch.overrides || {}).flatMap(([key, override]) => {
    const normalizedKey = safeLocalizationElementKey(key);
    return normalizedKey ? [[normalizedKey, override] as const] : [];
  });
  if (normalizedOverrides.length !== Object.keys(patch.overrides || {}).length) return settings;
  return updateDirectLocalePage(settings, localeCode, pagePath, (page) => {
    let changed = false;
    const nextPage = { ...page };
    if (patchesStylesheet && (page.stylesheet || '') !== normalizedStylesheet) {
      if (normalizedStylesheet) nextPage.stylesheet = normalizedStylesheet;
      else delete nextPage.stylesheet;
      changed = true;
    }
    if (normalizedOverrides.length) {
      const overrides = { ...(page.overrides || {}) };
      normalizedOverrides.forEach(([key, override]) => {
        overrides[key] = mergeElementOverride(overrides[key], override);
      });
      nextPage.overrides = overrides;
      changed = true;
    }
    if (!changed) return page;
    return nextPage;
  });
}

export function updateLocalePageStylesheet(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  stylesheet: string | null,
): LocalizationSettings {
  return updateLocalePageVisualOverrides(settings, localeCode, pagePath, { stylesheet });
}

/** Persist one direct-locale visual/media mutation without flattening values
 * inherited through the fallback chain. */
export function updateLocaleElementOverride(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  key: string,
  patch: LocalizationElementOverride,
) {
  const normalizedKey = safeLocalizationElementKey(key);
  if (!normalizedKey) return settings;
  return updateLocalePageVisualOverrides(settings, localeCode, pagePath, {
    overrides: { [normalizedKey]: patch },
  });
}

/** Reset only the active locale's override so the element resumes inheriting
 * from its fallback/source locale. */
export function removeLocaleElementOverride(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  key: string,
) {
  const normalizedKey = safeLocalizationElementKey(key);
  if (!normalizedKey) return settings;
  return updateDirectLocalePage(settings, localeCode, pagePath, (page) => {
    if (!Object.prototype.hasOwnProperty.call(page.overrides || {}, normalizedKey)) return page;
    const overrides = { ...(page.overrides || {}) };
    delete overrides[normalizedKey];
    return { ...page, overrides };
  });
}

/** Insert or replace a locale-owned section by stable ID. Replacing an
 * inherited ID promotes a direct copy while retaining its fallback order. */
export function upsertLocaleInsertion(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  insertion: LocalizationInsertion,
) {
  const id = normalizedLocalizationId(insertion.id);
  if (!id) return settings;
  if (
    !insertion.removed
    && typeof insertion.html === 'string'
    && utf8ByteLength(insertion.html) > LOCALIZATION_PERSISTENCE_LIMITS.htmlBytes
  ) {
    throw new Error(
      `A localização não foi salva. A seção exclusiva “${id}” ultrapassa o limite de ${LOCALIZATION_PERSISTENCE_LIMITS.htmlBytes.toLocaleString(getAdminUiLocale())} bytes.`,
    );
  }
  const anchor = insertion.removed ? insertion.anchor : safeLocalizationElementKey(insertion.anchor);
  if (
    !insertion.removed
    && (
      !anchor
      || !['before', 'after', 'prepend', 'append'].includes(insertion.position)
      || typeof insertion.html !== 'string'
    )
  ) return settings;
  return updateDirectLocalePage(settings, localeCode, pagePath, (page) => {
    const insertions = [...(page.insertions || [])];
    const index = insertions.findIndex((candidate) => candidate.id === id);
    const normalized = {
      ...insertion,
      id,
      ...(anchor ? { anchor } : {}),
      // This is the final persistence boundary for every caller, including
      // future creation flows outside HtmlProjectEditor. Tombstones preserve
      // their previous payload; an empty active fragment remains empty.
      html: insertion.removed
        ? insertion.html
        : canonicalizeLocalizationInsertionHtml(insertion.html),
    };
    if (index >= 0) {
      insertions[index] = normalized;
      for (let cursor = insertions.length - 1; cursor > index; cursor--) {
        if (insertions[cursor].id === id) insertions.splice(cursor, 1);
      }
    } else {
      insertions.push(normalized);
    }
    return { ...page, insertions };
  });
}

/** Suppress both direct and fallback locale sections with a durable
 * tombstone. Resetting the locale later removes this direct record. */
export function removeLocaleInsertion(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  insertionId: string,
) {
  const id = normalizedLocalizationId(insertionId);
  if (!id || localeCode === settings.sourceLocale) return settings;
  const direct = settings.translations[localeCode]?.pages?.[pagePath]
    ?.insertions?.find((candidate) => candidate.id === id);
  const resolved = resolveLocalizationPage(settings, localeCode, pagePath)
    ?.insertions?.find((candidate) => candidate.id === id);
  const insertion = direct || resolved;
  if (!insertion) return settings;
  return upsertLocaleInsertion(settings, localeCode, pagePath, {
    ...insertion,
    id,
    removed: true,
  });
}

export function entryForPath(source: string, path: string, kind: 'text' | 'attribute' = 'text', attribute?: string) {
  return extractLocalizableEntries(source).find((entry) => entry.path === path && entry.kind === kind && (!attribute || entry.attribute === attribute));
}

export function localizationProgress(project: HtmlProject, settings: LocalizationSettings, localeCode: string) {
  const pages = Object.values(project.files).filter(isLocalizationPageFile);
  const total = pages.reduce((sum, file) => sum + extractLocalizableEntries(file.text || '').length, 0);
  const translated = pages.reduce((sum, file) => {
    const values = settings.translations[localeCode]?.pages?.[file.path]?.entries || {};
    return sum + extractLocalizableEntries(file.text || '')
      .filter((entry) => translationValueForEntry(values, entry)?.trim())
      .length;
  }, 0);
  return { total, translated, percent: total ? Math.round((translated / total) * 100) : 100 };
}

function stableLocalizationId(pagePath: string, elementPath: string) {
  const value = `${pagePath}:${elementPath}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `k${(hash >>> 0).toString(36)}`;
}

/** Resolve the stable element key stored by locale overrides. Inserted content
 * deliberately collapses to its insertion ID because its HTML is owned by that
 * locale payload rather than by the base document. */
export function localeElementKeyForPath(source: string, path: string) {
  const indexes = path.split('/').filter(Boolean).map(Number);
  if (!indexes.every(index => Number.isInteger(index) && index >= 0)) return `path:${path}`;
  const normalizedPath = indexes.join('/');
  if (!normalizedPath) return 'body';
  const index = inspectSourceElementIndex(source);
  const element = index.byPath.get(normalizedPath);
  const implicitTargetExists = !element && index.elements.some(
    candidate => candidate.path.startsWith(`${normalizedPath}/`),
  );
  if (!element && !implicitTargetExists) return `path:${path}`;
  let ownerPath = normalizedPath;
  while (ownerPath) {
    const owner = index.byPath.get(ownerPath);
    const insertionId = owner?.attributes[LOCALE_INSERTION_ATTRIBUTE]?.trim();
    if (insertionId) return `insertion:${insertionId}`;
    ownerPath = ownerPath.includes('/')
      ? ownerPath.slice(0, ownerPath.lastIndexOf('/'))
      : '';
  }
  const stable = element?.attributes['data-kodety-l10n-id']?.trim();
  return stable && safeLocalizationId(stable) ? `id:${stable}` : `path:${path}`;
}

/** Assign an ID to every editable/anchor element, not only text leaves.
 * Structural locale overrides must survive reordering for empty sections,
 * media without alt text and layout-only wrappers as reliably as copy does.
 * Technical nodes are excluded and existing unique IDs are preserved. */
function localizationIdentitySignature(element: ParsedNode) {
  const tag = (element.tagName || '').toLowerCase();
  const attributes = ['id', 'name', 'href', 'src', 'alt', 'title', 'placeholder', 'data-name']
    .map((name) => [name, parsedAttribute(element, name)?.trim() || '']);
  const text = parsedTextContent(element).replace(/\s+/g, ' ').trim();
  const children = elementChildren(element).map((child) => child.tagName?.toLowerCase() || '');
  return JSON.stringify([tag, attributes, text, children]);
}

export function ensureProjectLocalizationIds(project: HtmlProject): HtmlProject {
  let files = project.files;
  const canonicalIds = new Map<string, {
    bySignature: Map<string, string | null>;
    ids: Set<string>;
  }>();
  const documents = Object.values(project.files)
    .map((file) => ({
      file,
      pagePath: localizationDocumentPagePath(file),
      authored: isLocalizationPageFile(file),
    }))
    .filter((document) => document.pagePath && document.file.text !== undefined)
    // Public pages establish canonical element identity for their A/B copies,
    // regardless of object insertion order in an imported project.
    .sort((left, right) => Number(right.authored) - Number(left.authored));

  // HtmlProject updates are immutable: changing only `.incode/project.json`
  // keeps every HTML file object by identity. Once the applicable documents
  // have been inspected/stamped, that identity is a safe zero-parse fast path
  // for localization settings edits. A WeakSet avoids retaining old projects.
  if (documents.every(({ file }) => localizationIdStampedFiles.has(file))) return project;

  documents.forEach(({ file, pagePath, authored }) => {
    if (!pagePath || file.text === undefined) return;
    const source = file.text;
    const document = parse(source, { sourceCodeLocationInfo: true }) as unknown as ParsedNode;
    const htmlElement = elementChildren(document).find((node) => node.tagName === 'html') || null;
    const body = htmlElement && elementChildren(htmlElement).find((node) => node.tagName === 'body') || null;
    if (!body) {
      localizationIdStampedFiles.add(file);
      return;
    }
    const anchors: Array<{ path: string; currentId: string; element: ParsedNode }> = [];
    walkParsedElements(body, (element, path) => {
      anchors.push({
        path,
        currentId: parsedAttribute(element, 'data-kodety-l10n-id')?.trim() || '',
        element,
      });
    }, false);
    if (!anchors.length) {
      localizationIdStampedFiles.add(file);
      return;
    }
    const canonical = canonicalIds.get(pagePath) || {
      bySignature: new Map<string, string | null>(),
      ids: new Set<string>(),
    };
    if (!canonicalIds.has(pagePath)) canonicalIds.set(pagePath, canonical);
    const used = new Set<string>();
    const patches: Array<{ start: number; end: number; value: string }> = [];
    anchors.forEach(({ path, currentId, element }) => {
      let id = '';
      if (authored && safeLocalizationId(currentId) && !used.has(currentId)) {
        id = currentId;
      } else if (
        !authored
        && safeLocalizationId(currentId)
        && canonical.ids.has(currentId)
        && !used.has(currentId)
      ) {
        // Preserve inherited IDs when a variant moved an element. Identity is
        // stronger than structural position once it matches the public page.
        id = currentId;
      } else {
        const canonicalBySignature = canonical.bySignature.get(localizationIdentitySignature(element));
        if (!authored && canonicalBySignature && !used.has(canonicalBySignature)) {
          id = canonicalBySignature;
        }
      }
      // A variant-only node must never steal the public ID that happens to
      // occupy the same structural path. Keep unmatched legacy nodes in their
      // private namespace; only a verified inherited/signature match may enter
      // the public namespace.
      const baseId = stableLocalizationId(authored || id ? pagePath : file.path, path);
      let suffix = 2;
      if (!id) id = baseId;
      while (used.has(id)) id = `${baseId}-${suffix++}`;
      used.add(id);
      if (authored) {
        canonical.ids.add(id);
        const signature = localizationIdentitySignature(element);
        if (!canonical.bySignature.has(signature)) canonical.bySignature.set(signature, id);
        else if (canonical.bySignature.get(signature) !== id) canonical.bySignature.set(signature, null);
      }
      if (currentId === id) return;
      const startTag = element.sourceCodeLocation?.startTag;
      if (!startTag) return;
      const attribute = element.sourceCodeLocation?.attrs?.['data-kodety-l10n-id'];
      const value = `data-kodety-l10n-id="${id}"`;
      if (attribute) {
        patches.push({ start: attribute.startOffset, end: attribute.endOffset, value });
        return;
      }
      const insertion = source[startTag.endOffset - 2] === '/'
        ? startTag.endOffset - 2
        : startTag.endOffset - 1;
      patches.push({ start: insertion, end: insertion, value: ` ${value}` });
    });
    if (!patches.length) {
      localizationIdStampedFiles.add(file);
      return;
    }
    let html = source;
    patches
      .sort((left, right) => right.start - left.start)
      .forEach(({ start, end, value }) => {
        html = html.slice(0, start) + value + html.slice(end);
      });
    if (html !== source) {
      const stampedFile = { ...file, text: html };
      localizationIdStampedFiles.add(stampedFile);
      files = { ...files, [file.path]: stampedFile };
    } else {
      localizationIdStampedFiles.add(file);
    }
  });
  return files === project.files ? project : { ...project, files };
}
