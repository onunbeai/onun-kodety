import type { HtmlProject } from './types';
import {
  assertLocalizationForPersistence,
  canonicalLocaleCode,
  createLocale,
  extractLocalizableEntries,
  isLocalizationPageFile,
  localeSlug,
  localizationProgress,
  normalizeLocalization,
  setDefaultLocale,
  translationValueForEntry,
  updateTranslation,
  type LocalizationLocale,
  type LocalizationSettings,
} from './localization';
import {
  readPageSeoFromHtml,
  readSiteSeoFromHtml,
  type PageSeoSettings,
  type SiteSeoSettings,
} from './seo-settings';

const DEFAULT_BATCH_ITEMS = 60;
const MAX_BATCH_ITEMS = 120;
const MAX_BATCH_SOURCE_CHARACTERS = 48_000;
const MAX_ITEM_SOURCE_CHARACTERS = 20_000;

interface AgentLocalizationEditorMetadata {
  projectId?: string;
  mainHtmlPath?: string;
  homeHtmlPath?: string;
  siteSettings?: SiteSeoSettings;
  pageSettings?: Record<string, PageSeoSettings>;
}

export type AgentLocalizationTargetKind =
  | 'entry'
  | 'siteTitle'
  | 'siteDescription'
  | 'pageTitle'
  | 'pageDescription'
  | 'pagePath';

export interface AgentLocalizationTarget {
  target: string;
  kind: AgentLocalizationTargetKind;
  pagePath?: string;
  source: string;
  current: string;
  context: string;
}

export interface AgentLocalizationSnapshotArgs {
  localeCode?: unknown;
  pagePaths?: unknown;
  onlyMissing?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

export interface AgentLocalizationChange {
  target: string;
  value: string;
}

export interface AgentLocalizationLocaleInput {
  code: string;
  name?: string;
  region?: string;
  slug?: string;
  fallback?: string;
  enabled?: boolean;
  direction?: 'ltr' | 'rtl';
  autoTranslate?: boolean;
  aiModel?: string | null;
  aiStyle?: string | null;
}

export type AgentLocalizationLocalePatch = Omit<AgentLocalizationLocaleInput, 'code'>;

export interface AgentLocalizationPreferencesPatch {
  automaticLocale?: boolean;
  rememberLocale?: boolean;
  translatePagePaths?: boolean;
  includePathsInAi?: boolean;
}

export type AgentLocalizationSettingsOperation =
  | { action: 'add'; locale: AgentLocalizationLocaleInput }
  | { action: 'update'; localeCode: string; patch: AgentLocalizationLocalePatch }
  | { action: 'remove'; localeCode: string; confirmRemoval: boolean }
  | { action: 'setDefault'; localeCode: string }
  | { action: 'updatePreferences'; preferences: AgentLocalizationPreferencesPatch };

export type AgentLocalizationSettingsArgs = AgentLocalizationSettingsOperation;

export interface AgentLocalizationSettingsResult {
  settings: LocalizationSettings;
  action: AgentLocalizationSettingsOperation['action'];
  localeCode?: string;
  changed: boolean;
}

const AGENT_LOCALE_FIELDS = new Set([
  'code',
  'name',
  'region',
  'slug',
  'fallback',
  'enabled',
  'direction',
  'autoTranslate',
  'aiModel',
  'aiStyle',
]);
const AGENT_LOCALE_PATCH_FIELDS = new Set([...AGENT_LOCALE_FIELDS].filter((field) => field !== 'code'));
const AGENT_LOCALIZATION_PREFERENCE_FIELDS = new Set([
  'automaticLocale',
  'rememberLocale',
  'translatePagePaths',
  'includePathsInAi',
]);

function agentObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} precisa ser um objeto.`);
  }
  return value as Record<string, unknown>;
}

function assertAgentFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
) {
  const unsupported = Object.keys(value).find((field) => !allowed.has(field));
  if (unsupported) throw new Error(`${label}.${unsupported} não é um campo suportado.`);
}

function agentLocaleCode(rawCode: unknown, label = 'localeCode') {
  if (typeof rawCode !== 'string' || !rawCode.trim()) {
    throw new Error(`${label} precisa conter um código BCP 47.`);
  }
  const code = canonicalLocaleCode(rawCode);
  if (!code) throw new Error(`${label} precisa usar um código BCP 47 válido, como en-US.`);
  return code;
}

function configuredAgentLocale(
  settings: LocalizationSettings,
  rawCode: unknown,
  label = 'localeCode',
) {
  const code = agentLocaleCode(rawCode, label);
  const locale = settings.locales.find((candidate) => candidate.code === code);
  if (!locale) throw new Error(`O idioma “${code}” não está configurado.`);
  return locale;
}

function agentOptionalText(rawValue: unknown, label: string, allowEmpty = false) {
  if (rawValue === undefined) return undefined;
  if (rawValue === null) return null;
  if (typeof rawValue !== 'string') throw new Error(`${label} precisa ser texto.`);
  const value = rawValue.trim();
  if (!allowEmpty && !value) throw new Error(`${label} não pode ficar vazio.`);
  return value;
}

function agentBoolean(rawValue: unknown, label: string) {
  if (rawValue === undefined) return undefined;
  if (typeof rawValue !== 'boolean') throw new Error(`${label} precisa ser verdadeiro ou falso.`);
  return rawValue;
}

function agentFallback(
  settings: LocalizationSettings,
  localeCode: string,
  rawFallback: unknown,
) {
  const fallback = agentLocaleCode(rawFallback, 'fallback');
  if (fallback === localeCode) throw new Error('O fallback precisa apontar para outro idioma.');
  const fallbackLocale = settings.locales.find((locale) => locale.code === fallback);
  if (!fallbackLocale) throw new Error(`O idioma de fallback “${fallback}” não está configurado.`);
  if (!fallbackLocale.enabled) throw new Error(`O idioma de fallback “${fallback}” não está publicado.`);
  return fallback;
}

function assertAgentFallbackGraph(settings: LocalizationSettings) {
  const locales = new Map(settings.locales.map((locale) => [locale.code, locale]));
  for (const locale of settings.locales) {
    if (locale.code === settings.sourceLocale) continue;
    const visited = new Set([locale.code]);
    let current: LocalizationLocale | undefined = locale;
    while (current?.fallback && current.fallback !== settings.sourceLocale) {
      if (visited.has(current.fallback)) {
        throw new Error(`O fallback de “${locale.code}” forma um ciclo entre idiomas.`);
      }
      visited.add(current.fallback);
      current = locales.get(current.fallback);
    }
  }
}

function normalizeAndAssertAgentSettings(candidate: LocalizationSettings) {
  const settings = normalizeLocalization(candidate);
  assertAgentFallbackGraph(settings);
  assertLocalizationForPersistence(settings);
  return settings;
}

function agentLocalePatch(
  settings: LocalizationSettings,
  localeCode: string,
  rawPatch: unknown,
  allowEmpty = false,
) {
  const patch = agentObject(rawPatch, 'patch');
  assertAgentFields(patch, AGENT_LOCALE_PATCH_FIELDS, 'patch');
  if (!allowEmpty && !Object.keys(patch).length) {
    throw new Error('patch precisa alterar pelo menos um campo do idioma.');
  }
  const next: Partial<LocalizationLocale> = {};
  if ('name' in patch) next.name = agentOptionalText(patch.name, 'patch.name') as string;
  if ('region' in patch) {
    const region = agentOptionalText(patch.region, 'patch.region', true);
    if (region === null) throw new Error('patch.region precisa ser texto.');
    next.region = region ? region.toUpperCase() : undefined;
  }
  if ('slug' in patch) {
    const slug = agentOptionalText(patch.slug, 'patch.slug', true);
    if (slug === null) throw new Error('patch.slug precisa ser texto.');
    next.slug = localeSlug(slug || localeCode);
  }
  if ('fallback' in patch) {
    if (localeCode === settings.sourceLocale) {
      throw new Error('O idioma fonte não pode ter fallback.');
    }
    next.fallback = agentFallback(settings, localeCode, patch.fallback);
  }
  if ('enabled' in patch) {
    const enabled = agentBoolean(patch.enabled, 'patch.enabled');
    if (localeCode === settings.sourceLocale && enabled === false) {
      throw new Error('O idioma fonte não pode ser desativado.');
    }
    next.enabled = enabled;
  }
  if ('direction' in patch) {
    if (patch.direction !== 'ltr' && patch.direction !== 'rtl') {
      throw new Error('patch.direction precisa ser “ltr” ou “rtl”.');
    }
    next.direction = patch.direction;
  }
  if ('autoTranslate' in patch) next.autoTranslate = agentBoolean(patch.autoTranslate, 'patch.autoTranslate');
  if ('aiModel' in patch) {
    const aiModel = agentOptionalText(patch.aiModel, 'patch.aiModel', true);
    next.aiModel = aiModel || undefined;
  }
  if ('aiStyle' in patch) {
    const aiStyle = agentOptionalText(patch.aiStyle, 'patch.aiStyle', true);
    next.aiStyle = aiStyle || undefined;
  }
  return next;
}

function agentAddedLocale(settings: LocalizationSettings, rawLocale: unknown) {
  const input = agentObject(rawLocale, 'locale');
  assertAgentFields(input, AGENT_LOCALE_FIELDS, 'locale');
  const code = agentLocaleCode(input.code, 'locale.code');
  if (settings.locales.some((locale) => locale.code === code)) {
    throw new Error(`O idioma “${code}” já está configurado.`);
  }
  const created = createLocale(code);
  const patch = agentLocalePatch(settings, code, Object.fromEntries(
    Object.entries(input).filter(([field]) => field !== 'code'),
  ), true);
  const fallback = 'fallback' in input
    ? agentFallback(settings, code, input.fallback)
    : settings.sourceLocale;
  return {
    ...created,
    ...patch,
    code,
    language: created.language,
    name: patch.name || created.name,
    region: patch.region || created.region,
    slug: localeSlug(patch.slug || created.code),
    fallback,
  };
}

/** Apply exactly one locale/settings mutation through the same normalization
 * and persistence boundary used by the localization UI. The operation is pure:
 * translations survive every action except an explicitly confirmed removal of
 * their owning locale. */
export function applyAgentLocalizationSettings(
  rawSettings: LocalizationSettings,
  rawOperation: AgentLocalizationSettingsOperation,
): AgentLocalizationSettingsResult {
  const settings = normalizeLocalization(rawSettings);
  const operation = agentObject(rawOperation, 'operation');
  const action = operation.action;
  if (!['add', 'update', 'remove', 'setDefault', 'updatePreferences'].includes(String(action))) {
    throw new Error('operation.action precisa ser add, update, remove, setDefault ou updatePreferences.');
  }

  let candidate: LocalizationSettings;
  let localeCode: string | undefined;
  if (action === 'add') {
    const locale = agentAddedLocale(settings, operation.locale);
    localeCode = locale.code;
    candidate = { ...settings, locales: [...settings.locales, locale] };
  } else if (action === 'update') {
    const locale = configuredAgentLocale(settings, operation.localeCode);
    localeCode = locale.code;
    if (locale.code === settings.sourceLocale) {
      throw new Error('O idioma fonte é gerenciado pelas Configurações do site e não pode ser alterado aqui.');
    }
    const patch = agentLocalePatch(settings, locale.code, operation.patch);
    candidate = {
      ...settings,
      locales: settings.locales.map((candidateLocale) => (
        candidateLocale.code === locale.code ? { ...candidateLocale, ...patch } : candidateLocale
      )),
    };
  } else if (action === 'remove') {
    const locale = configuredAgentLocale(settings, operation.localeCode);
    localeCode = locale.code;
    if (locale.code === settings.sourceLocale) throw new Error('O idioma fonte não pode ser removido.');
    if (operation.confirmRemoval !== true) {
      throw new Error(`Confirme explicitamente a remoção de “${locale.name}” com confirmRemoval: true.`);
    }
    const translations = { ...settings.translations };
    delete translations[locale.code];
    candidate = {
      ...settings,
      locales: settings.locales.filter((candidateLocale) => candidateLocale.code !== locale.code),
      translations,
      defaultLocale: settings.defaultLocale === locale.code
        ? settings.sourceLocale
        : settings.defaultLocale,
    };
  } else if (action === 'setDefault') {
    const locale = configuredAgentLocale(settings, operation.localeCode);
    localeCode = locale.code;
    if (!locale.enabled) throw new Error(`O idioma padrão “${locale.code}” precisa estar publicado.`);
    candidate = setDefaultLocale(settings, locale.code);
  } else {
    const preferences = agentObject(operation.preferences, 'preferences');
    assertAgentFields(preferences, AGENT_LOCALIZATION_PREFERENCE_FIELDS, 'preferences');
    if (!Object.keys(preferences).length) {
      throw new Error('preferences precisa alterar pelo menos uma preferência.');
    }
    const patch = Object.fromEntries(Object.entries(preferences).map(([key, value]) => {
      const normalized = agentBoolean(value, `preferences.${key}`);
      return [key, normalized];
    })) as AgentLocalizationPreferencesPatch;
    candidate = { ...settings, ...patch };
  }

  const next = normalizeAndAssertAgentSettings(candidate);
  return {
    settings: next,
    action: action as AgentLocalizationSettingsOperation['action'],
    localeCode,
    changed: JSON.stringify(next) !== JSON.stringify(settings),
  };
}

function readLocalizationMetadata(project: HtmlProject): AgentLocalizationEditorMetadata {
  try {
    const text = project.files['.incode/project.json']?.text;
    if (!text) return {};
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as AgentLocalizationEditorMetadata
      : {};
  } catch {
    return {};
  }
}

function projectHomePath(project: HtmlProject, metadata: AgentLocalizationEditorMetadata) {
  const normalize = (value: unknown) => typeof value === 'string'
    ? value.replaceAll('\\', '/').replace(/^\.\/+|^\/+/, '')
    : '';
  for (const candidate of [metadata.homeHtmlPath, metadata.mainHtmlPath, project.mainHtmlPath]) {
    const path = normalize(candidate);
    if (path && project.files[path]?.text !== undefined && /\.html?$/i.test(path)) return path;
  }
  return Object.values(project.files)
    .filter(isLocalizationPageFile)
    .sort((left, right) => (
      Number(!/(?:^|\/)index\.html?$/i.test(left.path))
      - Number(!/(?:^|\/)index\.html?$/i.test(right.path))
      || left.path.split('/').length - right.path.split('/').length
    ))[0]?.path || project.mainHtmlPath;
}

function pageLabel(path: string) {
  const name = path.split('/').pop()?.replace(/\.html?$/i, '') || path;
  return name.toLowerCase() === 'index' ? 'Home' : name.replaceAll('-', ' ');
}

function encoded(value: string) {
  return encodeURIComponent(value);
}

function decoded(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function siteTarget(kind: 'siteTitle' | 'siteDescription') {
  return `site:${kind}`;
}

function pageTarget(kind: 'pageTitle' | 'pageDescription' | 'pagePath', pagePath: string) {
  return `page:${kind}:${encoded(pagePath)}`;
}

function entryTarget(pagePath: string, key: string) {
  return `entry:${encoded(pagePath)}:${encoded(key)}`;
}

function parseTarget(target: string):
  | { kind: 'siteTitle' | 'siteDescription' }
  | { kind: 'pageTitle' | 'pageDescription' | 'pagePath'; pagePath: string }
  | { kind: 'entry'; pagePath: string; key: string }
  | null {
  const site = target.match(/^site:(siteTitle|siteDescription)$/);
  if (site) return { kind: site[1] as 'siteTitle' | 'siteDescription' };
  const page = target.match(/^page:(pageTitle|pageDescription|pagePath):([^:]+)$/);
  if (page) {
    const pagePath = decoded(page[2]);
    return pagePath ? { kind: page[1] as 'pageTitle' | 'pageDescription' | 'pagePath', pagePath } : null;
  }
  const entry = target.match(/^entry:([^:]+):([^:]+)$/);
  if (entry) {
    const pagePath = decoded(entry[1]);
    const key = decoded(entry[2]);
    return pagePath && key ? { kind: 'entry', pagePath, key } : null;
  }
  return null;
}

function directPage(settings: LocalizationSettings, localeCode: string, pagePath: string) {
  return settings.translations[localeCode]?.pages?.[pagePath];
}

function directValue(
  settings: LocalizationSettings,
  localeCode: string,
  target: ReturnType<typeof parseTarget>,
) {
  if (!target) return '';
  const locale = settings.translations[localeCode];
  if (!('pagePath' in target)) {
    return locale?.[target.kind] || '';
  }
  const page = locale?.pages?.[target.pagePath];
  if (target.kind === 'entry') return page?.entries?.[target.key] || '';
  return page?.[target.kind === 'pageTitle'
    ? 'title'
    : target.kind === 'pageDescription'
      ? 'description'
      : 'path'] || '';
}

function withPageMetadata(
  settings: LocalizationSettings,
  localeCode: string,
  pagePath: string,
  field: 'title' | 'description' | 'path',
  value: string,
) {
  const locale = settings.translations[localeCode] || { pages: {} };
  const page = locale.pages[pagePath] || { entries: {} };
  return {
    ...settings,
    translations: {
      ...settings.translations,
      [localeCode]: {
        ...locale,
        pages: {
          ...locale.pages,
          [pagePath]: { ...page, [field]: value },
        },
      },
    },
  };
}

function withSiteMetadata(
  settings: LocalizationSettings,
  localeCode: string,
  field: 'siteTitle' | 'siteDescription',
  value: string,
) {
  const locale = settings.translations[localeCode] || { pages: {} };
  return {
    ...settings,
    translations: {
      ...settings.translations,
      [localeCode]: { ...locale, [field]: value },
    },
  };
}

function normalizePagePath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, '').replace(/\s+/g, '-');
}

function selectedLocale(settings: LocalizationSettings, rawCode: unknown) {
  const requested = typeof rawCode === 'string' ? rawCode.trim().toLowerCase() : '';
  if (!requested) return null;
  return settings.locales.find((locale) => locale.code.toLowerCase() === requested) || null;
}

function catalogTargets(
  project: HtmlProject,
  settings: LocalizationSettings,
  localeCode: string,
  pagePaths: Set<string> | null,
) {
  const metadata = readLocalizationMetadata(project);
  const homePath = projectHomePath(project, metadata);
  const homeSeo = readSiteSeoFromHtml(project.files[homePath]?.text || '');
  const siteSettings = { ...homeSeo, ...(metadata.siteSettings || {}) };
  const locale = settings.translations[localeCode];
  const targets: AgentLocalizationTarget[] = [];
  if (!pagePaths) {
    const siteTitle = siteSettings.siteTitle?.trim() || project.name.trim();
    if (siteTitle) {
      targets.push({
        target: siteTarget('siteTitle'),
        kind: 'siteTitle',
        source: siteTitle,
        current: locale?.siteTitle || '',
        context: 'Título global do site',
      });
    }
    const siteDescription = siteSettings.description?.trim() || '';
    if (siteDescription) {
      targets.push({
        target: siteTarget('siteDescription'),
        kind: 'siteDescription',
        source: siteDescription,
        current: locale?.siteDescription || '',
        context: 'Descrição global do site',
      });
    }
  }

  Object.values(project.files)
    .filter(isLocalizationPageFile)
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((file) => {
      if (pagePaths && !pagePaths.has(file.path)) return;
      const pageSettings = {
        ...readPageSeoFromHtml(file.text || ''),
        ...(metadata.pageSettings?.[file.path] || {}),
      };
      const page = directPage(settings, localeCode, file.path);
      const label = pageLabel(file.path);
      const title = pageSettings.title?.trim() || '';
      if (title) {
        targets.push({
          target: pageTarget('pageTitle', file.path),
          kind: 'pageTitle',
          pagePath: file.path,
          source: title,
          current: page?.title || '',
          context: `${label} · título SEO`,
        });
      }
      const description = pageSettings.description?.trim() || '';
      if (description) {
        targets.push({
          target: pageTarget('pageDescription', file.path),
          kind: 'pageDescription',
          pagePath: file.path,
          source: description,
          current: page?.description || '',
          context: `${label} · descrição SEO`,
        });
      }
      if (settings.translatePagePaths) {
        targets.push({
          target: pageTarget('pagePath', file.path),
          kind: 'pagePath',
          pagePath: file.path,
          source: label,
          current: page?.path || '',
          context: `${label} · caminho público sem barra inicial`,
        });
      }
      const entries = page?.entries || {};
      extractLocalizableEntries(file.text || '').forEach((entry) => {
        targets.push({
          target: entryTarget(file.path, entry.key),
          kind: 'entry',
          pagePath: file.path,
          source: entry.source,
          current: translationValueForEntry(entries, entry) || '',
          context: `${label} · ${entry.kind === 'attribute' ? entry.attribute || 'atributo' : 'conteúdo'}`,
        });
      });
    });
  return targets;
}

export function snapshotAgentLocalization(
  project: HtmlProject,
  rawSettings: LocalizationSettings,
  revision: string,
  args: AgentLocalizationSnapshotArgs = {},
) {
  const settings = normalizeLocalization(rawSettings);
  const locale = selectedLocale(settings, args.localeCode);
  const pages = Object.values(project.files)
    .filter(isLocalizationPageFile)
    .sort((left, right) => left.path.localeCompare(right.path));
  const locales = settings.locales.map((candidate) => ({
    code: candidate.code,
    name: candidate.name,
    region: candidate.region,
    slug: candidate.slug,
    fallback: candidate.fallback,
    enabled: candidate.enabled,
    direction: candidate.direction,
    default: candidate.code === settings.defaultLocale,
    source: candidate.code === settings.sourceLocale,
    ...localizationProgress(project, settings, candidate.code),
  }));
  if (!locale) {
    return {
      revision,
      sourceLocale: settings.sourceLocale,
      defaultLocale: settings.defaultLocale,
      locales,
      pages: pages.map((file) => ({ path: file.path, name: pageLabel(file.path) })),
      message: 'Escolha um localeCode configurado que não seja o idioma fonte para ler o catálogo.',
    };
  }
  if (locale.code === settings.sourceLocale) {
    throw new Error('O idioma fonte não recebe traduções. Escolha um idioma de destino configurado.');
  }
  const requestedPagePaths = Array.isArray(args.pagePaths)
    ? args.pagePaths
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const knownPages = new Set(pages.map((file) => file.path));
  const unknownPage = requestedPagePaths.find((path) => !knownPages.has(path));
  if (unknownPage) throw new Error(`A página “${unknownPage}” não existe no catálogo de localização.`);
  const pageScope = requestedPagePaths.length ? new Set(requestedPagePaths) : null;
  const onlyMissing = args.onlyMissing !== false;
  const allTargets = catalogTargets(project, settings, locale.code, pageScope)
    .filter((target) => !onlyMissing || !target.current.trim());
  const cursor = Number.isInteger(args.cursor) ? Math.max(0, Number(args.cursor)) : 0;
  const requestedLimit = Number.isInteger(args.limit) ? Number(args.limit) : DEFAULT_BATCH_ITEMS;
  const limit = Math.max(1, Math.min(MAX_BATCH_ITEMS, requestedLimit));
  const items: AgentLocalizationTarget[] = [];
  const oversized: Array<{ target: string; characters: number; context: string }> = [];
  let sourceCharacters = 0;
  let index = cursor;
  for (; index < allTargets.length && items.length < limit; index += 1) {
    const item = allTargets[index];
    if (item.source.length > MAX_ITEM_SOURCE_CHARACTERS) {
      oversized.push({ target: item.target, characters: item.source.length, context: item.context });
      continue;
    }
    if (items.length && sourceCharacters + item.source.length > MAX_BATCH_SOURCE_CHARACTERS) break;
    items.push(item);
    sourceCharacters += item.source.length;
  }
  return {
    revision,
    sourceLocale: settings.sourceLocale,
    locale: { code: locale.code, name: locale.name, direction: locale.direction },
    onlyMissing,
    pagePaths: requestedPagePaths,
    locales,
    pages: pages.map((file) => {
      const entries = extractLocalizableEntries(file.text || '');
      const translatedEntries = settings.translations[locale.code]?.pages?.[file.path]?.entries || {};
      const translated = entries.filter((entry) => translationValueForEntry(translatedEntries, entry)?.trim()).length;
      return {
        path: file.path,
        name: pageLabel(file.path),
        total: entries.length,
        translated,
        pending: Math.max(0, entries.length - translated),
      };
    }),
    batch: {
      cursor,
      items,
      itemCount: items.length,
      sourceCharacters,
      totalItems: allTargets.length,
      remainingItems: Math.max(0, allTargets.length - index),
      nextCursor: index < allTargets.length ? index : null,
      oversized,
    },
  };
}

export function applyAgentLocalizationChanges(
  project: HtmlProject,
  rawSettings: LocalizationSettings,
  localeCode: string,
  rawChanges: AgentLocalizationChange[],
  overwrite = false,
) {
  const settings = normalizeLocalization(rawSettings);
  const locale = selectedLocale(settings, localeCode);
  if (!locale || locale.code === settings.sourceLocale) {
    throw new Error('Escolha um idioma de destino configurado antes de aplicar traduções.');
  }
  if (!Array.isArray(rawChanges) || !rawChanges.length) {
    throw new Error('O Agent não enviou nenhuma tradução para aplicar.');
  }
  if (rawChanges.length > MAX_BATCH_ITEMS) {
    throw new Error(`Envie no máximo ${MAX_BATCH_ITEMS} traduções por lote.`);
  }
  const publicPages = new Map(
    Object.values(project.files)
      .filter(isLocalizationPageFile)
      .map((file) => [file.path, file] as const),
  );
  const seen = new Set<string>();
  let next = settings;
  let applied = 0;
  let preserved = 0;
  const changedPages = new Set<string>();
  for (const rawChange of rawChanges) {
    const targetId = typeof rawChange?.target === 'string' ? rawChange.target.trim() : '';
    const value = typeof rawChange?.value === 'string' ? rawChange.value.trim() : '';
    if (!targetId || !value) throw new Error('Cada tradução precisa de target e value não vazios.');
    if (seen.has(targetId)) throw new Error(`O alvo “${targetId}” aparece mais de uma vez no lote.`);
    seen.add(targetId);
    const target = parseTarget(targetId);
    if (!target) throw new Error(`O alvo de localização “${targetId}” é inválido.`);
    if ('pagePath' in target && !publicPages.has(target.pagePath)) {
      throw new Error(`A página “${target.pagePath}” não existe mais. Leia o catálogo novamente.`);
    }
    let current = directValue(next, locale.code, target);
    if (target.kind === 'entry') {
      const file = publicPages.get(target.pagePath);
      const entry = extractLocalizableEntries(file?.text || '').find((candidate) => candidate.key === target.key);
      if (!entry) throw new Error(`O texto “${target.key}” mudou ou não existe mais em ${target.pagePath}.`);
      current = translationValueForEntry(
        next.translations[locale.code]?.pages?.[target.pagePath]?.entries || {},
        entry,
      ) || '';
    }
    if (!overwrite && current.trim()) {
      preserved += 1;
      continue;
    }
    if (target.kind === 'entry') {
      next = updateTranslation(next, locale.code, target.pagePath, target.key, value);
      changedPages.add(target.pagePath);
    } else if (target.kind === 'siteTitle' || target.kind === 'siteDescription') {
      next = withSiteMetadata(next, locale.code, target.kind, value);
    } else if ('pagePath' in target) {
      const field = target.kind === 'pageTitle'
        ? 'title'
        : target.kind === 'pageDescription'
          ? 'description'
          : 'path';
      const cleanValue = field === 'path' ? normalizePagePath(value) : value;
      if (!cleanValue) throw new Error(`A tradução de “${targetId}” ficou vazia após a validação.`);
      next = withPageMetadata(next, locale.code, target.pagePath, field, cleanValue);
      changedPages.add(target.pagePath);
    } else {
      throw new Error(`O alvo de localização “${targetId}” não pôde ser resolvido.`);
    }
    applied += 1;
  }
  next = normalizeLocalization(next);
  assertLocalizationForPersistence(next);
  return {
    settings: next,
    localeCode: locale.code,
    applied,
    preserved,
    changedPages: [...changedPages],
  };
}

export function localizationAgentTargetValue(
  settings: LocalizationSettings,
  localeCode: string,
  targetId: string,
) {
  return directValue(normalizeLocalization(settings), localeCode, parseTarget(targetId));
}
