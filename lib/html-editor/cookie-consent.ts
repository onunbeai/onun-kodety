import cookieConsentRuntimeSource from './vendor/vanilla-cookieconsent/cookieconsent.umd.js?raw';
import cookieConsentBaseCss from './vendor/vanilla-cookieconsent/cookieconsent.css?raw';
import cookieConsentLicense from './vendor/vanilla-cookieconsent/LICENSE?raw';
import type { HtmlProject, HtmlProjectFile } from './types';

export type CookieConsentBannerType = 'simple' | 'advanced';
export type CookieConsentTheme = 'light' | 'dark' | 'auto';
export type CookieConsentPosition = 'bottom' | 'bottom-left' | 'bottom-right' | 'center-modal';
export type CookieConsentRegion = 'global' | 'eu' | 'uk' | 'brazil' | 'us' | 'custom';
export type CookieConsentMode = 'basic' | 'advanced';

export interface CookieConsentCategory {
  id: string;
  name: string;
  description: string;
  required: boolean;
  defaultEnabled: boolean;
  allowVisitorControl: boolean;
  order: number;
  icon?: string;
}

export interface CookieConsentService {
  id: string;
  name: string;
  provider: string;
  categoryId: string;
  description: string;
  privacyPolicyUrl: string;
  cookies: string[];
  dataRetention: string;
  enabledPages: string[];
  consentRequired: boolean;
  /** IDs from Settings → Custom Code governed by this service toggle. */
  scriptIds: string[];
}

export interface CookieConsentCookie {
  id: string;
  name: string;
  domain: string;
  provider: string;
  purpose: string;
  categoryId: string;
  duration: string;
  type: 'session' | 'persistent';
  party: 'first' | 'third';
}

export interface CookieConsentSettings {
  version: 1;
  enabled: boolean;
  /** Incremented when purposes, services, policies or consent behavior change. */
  configurationVersion: number;
  bannerType: CookieConsentBannerType;
  theme: CookieConsentTheme;
  position: CookieConsentPosition;
  expirationDays: number;
  askAgainOnChange: boolean;
  privacyPolicyUrl: string;
  cookiePolicyUrl: string;
  disablePageInteraction: boolean;
  respectDnt: boolean;
  content: {
    title: string;
    description: string;
    acceptAllLabel: string;
    rejectAllLabel: string;
    settingsLabel: string;
    savePreferencesLabel: string;
    preferencesTitle: string;
    preferencesDescription: string;
    closeLabel: string;
    privacyPolicyLabel: string;
    cookiePolicyLabel: string;
    serviceDetailsLabel: string;
  };
  appearance: {
    background: string;
    text: string;
    mutedText: string;
    accent: string;
    accentText: string;
    border: string;
    borderWidth: number;
    borderRadius: number;
    buttonRadius: number;
    padding: number;
    maxWidth: number;
    shadow: 'none' | 'soft' | 'medium' | 'strong';
    overlay: boolean;
    fontFamily: 'system' | 'inter' | 'serif';
    fontSize: number;
  };
  categories: CookieConsentCategory[];
  services: CookieConsentService[];
  cookies: CookieConsentCookie[];
  integrationCategories: {
    kodetyAnalytics: string;
    googleAnalytics: string;
    googleTagManager: string;
    microsoftClarity: string;
    metaPixel: string;
    plausible: string;
    experiments: string;
  };
  googleConsentMode: {
    enabled: boolean;
    mode: CookieConsentMode;
  };
  privacyCenter: {
    enabled: boolean;
    floatingButton: boolean;
    buttonLabel: string;
  };
  advanced: {
    region: CookieConsentRegion;
    recordHistory: boolean;
    historyRetentionDays: number;
    debug: boolean;
    reconsentOnNewCategory: boolean;
    reconsentOnNewService: boolean;
    reconsentOnPolicyChange: boolean;
  };
}

export type CookieConsentSettingsSection =
  | 'general'
  | 'content'
  | 'categories'
  | 'services'
  | 'cookies';

export interface CookieConsentValidationIssue {
  section: CookieConsentSettingsSection;
  message: string;
  fields: string[];
  itemId?: string;
}

const DEFAULT_CATEGORIES: CookieConsentCategory[] = [
  {
    id: 'necessary',
    name: 'Necessários',
    description: 'Essenciais para o funcionamento, a segurança e as preferências de privacidade do site.',
    required: true,
    defaultEnabled: true,
    allowVisitorControl: false,
    order: 0,
    icon: 'shield-check',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Ajuda a entender como visitantes usam o site para melhorar conteúdo e desempenho.',
    required: false,
    defaultEnabled: false,
    allowVisitorControl: true,
    order: 1,
    icon: 'chart',
  },
  {
    id: 'functional',
    name: 'Funcionais',
    description: 'Ativa recursos adicionais, preferências e serviços de suporte.',
    required: false,
    defaultEnabled: false,
    allowVisitorControl: true,
    order: 2,
    icon: 'settings',
  },
  {
    id: 'personalization',
    name: 'Personalização',
    description: 'Permite adaptar conteúdo e experiências às preferências do visitante.',
    required: false,
    defaultEnabled: false,
    allowVisitorControl: true,
    order: 3,
    icon: 'magic-stick',
  },
  {
    id: 'marketing',
    name: 'Marketing e publicidade',
    description: 'Usado para publicidade, atribuição, mensuração de campanhas e remarketing.',
    required: false,
    defaultEnabled: false,
    allowVisitorControl: true,
    order: 4,
    icon: 'megaphone',
  },
  {
    id: 'embedded_content',
    name: 'Conteúdo incorporado',
    description: 'Permite carregar vídeos, mapas e outros conteúdos de serviços externos.',
    required: false,
    defaultEnabled: false,
    allowVisitorControl: true,
    order: 5,
    icon: 'play',
  },
];

const DEFAULT_CONSENT_COOKIES: CookieConsentCookie[] = [
  {
    id: 'kodety_consent',
    name: 'kodety_consent',
    domain: '',
    provider: 'Kodety',
    purpose: 'Armazena as escolhas de privacidade do visitante para que o site respeite o consentimento concedido ou recusado.',
    categoryId: 'necessary',
    duration: 'Conforme a expiração do consentimento',
    type: 'persistent',
    party: 'first',
  },
  {
    id: 'kodety_consent_analytics',
    name: 'kodety_consent_analytics',
    domain: '',
    provider: 'Kodety',
    purpose: 'Informa ao site se recursos de Analytics podem ser executados sem expor os dados brutos da decisão.',
    categoryId: 'necessary',
    duration: 'Conforme a expiração do consentimento',
    type: 'persistent',
    party: 'first',
  },
  {
    id: 'kodety_consent_marketing',
    name: 'kodety_consent_marketing',
    domain: '',
    provider: 'Kodety',
    purpose: 'Informa ao site se recursos de Marketing podem ser executados sem expor os dados brutos da decisão.',
    categoryId: 'necessary',
    duration: 'Conforme a expiração do consentimento',
    type: 'persistent',
    party: 'first',
  },
  {
    id: 'kodety_consent_experiments',
    name: 'kodety_consent_experiments',
    domain: '',
    provider: 'Kodety',
    purpose: 'Informa ao site se experiências e testes podem ser executados sem expor os dados brutos da decisão.',
    categoryId: 'necessary',
    duration: 'Conforme a expiração do consentimento',
    type: 'persistent',
    party: 'first',
  },
];

export const DEFAULT_COOKIE_CONSENT_SETTINGS: CookieConsentSettings = {
  version: 1,
  enabled: false,
  configurationVersion: 1,
  bannerType: 'advanced',
  theme: 'light',
  position: 'bottom',
  expirationDays: 180,
  askAgainOnChange: true,
  privacyPolicyUrl: '/privacy',
  cookiePolicyUrl: '/cookies',
  disablePageInteraction: false,
  respectDnt: true,
  content: {
    title: 'Sua privacidade importa',
    description: 'Usamos cookies para manter o site seguro, entender seu uso e oferecer uma experiência melhor. Você decide o que deseja permitir.',
    acceptAllLabel: 'Aceitar todos',
    rejectAllLabel: 'Recusar opcionais',
    settingsLabel: 'Personalizar',
    savePreferencesLabel: 'Salvar preferências',
    preferencesTitle: 'Preferências de privacidade',
    preferencesDescription: 'Escolha as finalidades que você permite. Cookies necessários permanecem ativos para o site funcionar.',
    closeLabel: 'Fechar',
    privacyPolicyLabel: 'Política de Privacidade',
    cookiePolicyLabel: 'Política de Cookies',
    serviceDetailsLabel: 'Ver serviços e cookies',
  },
  appearance: {
    background: '#ffffff',
    text: '#171717',
    mutedText: '#666666',
    accent: '#6d5dfc',
    accentText: '#ffffff',
    border: '#e6e6e6',
    borderWidth: 1,
    borderRadius: 20,
    buttonRadius: 10,
    padding: 24,
    maxWidth: 760,
    shadow: 'strong',
    overlay: true,
    fontFamily: 'inter',
    fontSize: 15,
  },
  categories: DEFAULT_CATEGORIES,
  services: [],
  cookies: DEFAULT_CONSENT_COOKIES,
  integrationCategories: {
    kodetyAnalytics: 'analytics',
    googleAnalytics: 'analytics',
    googleTagManager: 'analytics',
    microsoftClarity: 'analytics',
    metaPixel: 'marketing',
    plausible: 'analytics',
    experiments: 'personalization',
  },
  googleConsentMode: {
    enabled: true,
    mode: 'basic',
  },
  privacyCenter: {
    enabled: true,
    floatingButton: false,
    buttonLabel: 'Preferências de cookies',
  },
  advanced: {
    region: 'global',
    recordHistory: false,
    historyRetentionDays: 365,
    debug: false,
    reconsentOnNewCategory: true,
    reconsentOnNewService: true,
    reconsentOnPolicyChange: true,
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return fallback;
}

function stringValue(value: unknown, fallback: string, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function normalizeId(value: unknown, fallback: string) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (candidate || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function normalizeColor(value: unknown, fallback: string) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (/^#[0-9a-f]{3,8}$/i.test(candidate)) return candidate;
  if (/^(?:rgb|hsl)a?\(\s*[\d.%+\-,\s]+\)$/i.test(candidate)) return candidate;
  if (/^(?:transparent|currentColor)$/i.test(candidate)) return candidate;
  return fallback;
}

function normalizeStringArray(value: unknown, maxItems = 80) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return Array.from(new Set(source
    .filter(item => typeof item === 'string')
    .map(item => String(item).trim().slice(0, 240))
    .filter(Boolean)))
    .slice(0, maxItems);
}

function cloneDefaultCategories() {
  return DEFAULT_CATEGORIES.map(category => ({ ...category }));
}

function normalizeCategories(value: unknown): CookieConsentCategory[] {
  const source = Array.isArray(value) && value.length ? value : cloneDefaultCategories();
  const usedIds = new Set<string>();
  const categories = source.slice(0, 40).map((raw, index): CookieConsentCategory => {
    const category = record(raw);
    const fallback = index < DEFAULT_CATEGORIES.length ? DEFAULT_CATEGORIES[index] : undefined;
    const baseId = normalizeId(category.id, fallback?.id || `category_${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}_${suffix++}`;
    usedIds.add(id);
    const required = booleanValue(category.required, fallback?.required ?? false);
    return {
      id,
      name: stringValue(category.name, fallback?.name || `Categoria ${index + 1}`, 120),
      description: stringValue(category.description, fallback?.description || '', 1200),
      required,
      defaultEnabled: required || booleanValue(category.defaultEnabled, fallback?.defaultEnabled ?? false),
      allowVisitorControl: required ? false : booleanValue(category.allowVisitorControl, fallback?.allowVisitorControl ?? true),
      order: Math.round(finiteNumber(category.order, fallback?.order ?? index, 0, 999)),
      icon: stringValue(category.icon, fallback?.icon || '', 60) || undefined,
    };
  });
  const necessaryIndex = categories.findIndex(category => category.id === 'necessary');
  if (necessaryIndex < 0) categories.unshift({ ...DEFAULT_CATEGORIES[0] });
  else categories[necessaryIndex] = {
    ...categories[necessaryIndex],
    required: true,
    defaultEnabled: true,
    allowVisitorControl: false,
  };
  return categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function normalizeServices(value: unknown, categoryIds: Set<string>): CookieConsentService[] {
  const source = Array.isArray(value) ? value : [];
  const usedIds = new Set<string>();
  return source.slice(0, 200).map((raw, index): CookieConsentService => {
    const service = record(raw);
    const baseId = normalizeId(service.id, `service_${index + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}_${suffix++}`;
    usedIds.add(id);
    const categoryCandidate = normalizeId(service.categoryId ?? service.category, 'analytics');
    return {
      id,
      name: stringValue(service.name, `Serviço ${index + 1}`, 160),
      provider: stringValue(service.provider, '', 160),
      categoryId: categoryIds.has(categoryCandidate) ? categoryCandidate : 'necessary',
      description: stringValue(service.description, '', 1200),
      privacyPolicyUrl: stringValue(service.privacyPolicyUrl, '', 800),
      cookies: normalizeStringArray(service.cookies, 100),
      dataRetention: stringValue(service.dataRetention, '', 240),
      enabledPages: normalizeStringArray(service.enabledPages ?? service.pages, 500),
      consentRequired: booleanValue(service.consentRequired, true),
      scriptIds: normalizeStringArray(service.scriptIds ?? service.scripts, 200)
        .map(id => id.replace(/[^A-Za-z0-9._:/-]+/g, '-').slice(0, 120))
        .filter(Boolean),
    };
  });
}

function normalizeCookies(value: unknown, categoryIds: Set<string>): CookieConsentCookie[] {
  const authored = Array.isArray(value) ? value : [];
  const authoredNames = new Set(authored.map(raw => editableString(record(raw).name, '')));
  const source = [
    ...DEFAULT_CONSENT_COOKIES.filter(cookie => !authoredNames.has(cookie.name)),
    ...authored,
  ];
  const usedIds = new Set<string>();
  return source.slice(0, 500).map((raw, index): CookieConsentCookie => {
    const cookie = record(raw);
    const name = stringValue(cookie.name, `cookie_${index + 1}`, 240);
    const baseId = normalizeId(cookie.id, normalizeId(name, `cookie_${index + 1}`));
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}_${suffix++}`;
    usedIds.add(id);
    const categoryCandidate = normalizeId(cookie.categoryId ?? cookie.category, 'necessary');
    return {
      id,
      name,
      domain: stringValue(cookie.domain, '', 240),
      provider: stringValue(cookie.provider, '', 160),
      purpose: stringValue(cookie.purpose, '', 1200),
      categoryId: categoryIds.has(categoryCandidate) ? categoryCandidate : 'necessary',
      duration: stringValue(cookie.duration, '', 240),
      type: enumValue(cookie.type, ['session', 'persistent'], 'persistent'),
      party: enumValue(cookie.party, ['first', 'third'], 'first'),
    };
  });
}

export function normalizeCookieConsentSettings(value: unknown): CookieConsentSettings {
  const source = record(value);
  const content = record(source.content);
  const appearance = record(source.appearance);
  const integrations = record(source.integrationCategories);
  const googleConsentMode = record(source.googleConsentMode);
  const privacyCenter = record(source.privacyCenter);
  const advanced = record(source.advanced);
  const categories = normalizeCategories(source.categories);
  const categoryIds = new Set(categories.map(category => category.id));
  const category = (candidate: unknown, fallback: string) => {
    const normalized = normalizeId(candidate, fallback);
    return categoryIds.has(normalized) ? normalized : categoryIds.has(fallback) ? fallback : 'necessary';
  };
  const defaults = DEFAULT_COOKIE_CONSENT_SETTINGS;
  return {
    version: 1,
    enabled: booleanValue(source.enabled, defaults.enabled),
    configurationVersion: Math.max(1, Math.round(finiteNumber(source.configurationVersion, defaults.configurationVersion, 1, 999999))),
    bannerType: enumValue(source.bannerType, ['simple', 'advanced'], defaults.bannerType),
    theme: enumValue(source.theme, ['light', 'dark', 'auto'], defaults.theme),
    position: enumValue(source.position, ['bottom', 'bottom-left', 'bottom-right', 'center-modal'], defaults.position),
    expirationDays: Math.round(finiteNumber(source.expirationDays, defaults.expirationDays, 1, 7300)),
    askAgainOnChange: booleanValue(source.askAgainOnChange, defaults.askAgainOnChange),
    privacyPolicyUrl: stringValue(source.privacyPolicyUrl, defaults.privacyPolicyUrl, 800),
    cookiePolicyUrl: stringValue(source.cookiePolicyUrl, defaults.cookiePolicyUrl, 800),
    disablePageInteraction: booleanValue(source.disablePageInteraction, defaults.disablePageInteraction),
    respectDnt: booleanValue(source.respectDnt, defaults.respectDnt),
    content: {
      title: stringValue(content.title, defaults.content.title, 240),
      description: stringValue(content.description, defaults.content.description, 2400),
      acceptAllLabel: stringValue(content.acceptAllLabel, defaults.content.acceptAllLabel, 120),
      rejectAllLabel: stringValue(content.rejectAllLabel, defaults.content.rejectAllLabel, 120),
      settingsLabel: stringValue(content.settingsLabel, defaults.content.settingsLabel, 120),
      savePreferencesLabel: stringValue(content.savePreferencesLabel, defaults.content.savePreferencesLabel, 120),
      preferencesTitle: stringValue(content.preferencesTitle, defaults.content.preferencesTitle, 240),
      preferencesDescription: stringValue(content.preferencesDescription, defaults.content.preferencesDescription, 2400),
      closeLabel: stringValue(content.closeLabel, defaults.content.closeLabel, 120),
      privacyPolicyLabel: stringValue(content.privacyPolicyLabel, defaults.content.privacyPolicyLabel, 160),
      cookiePolicyLabel: stringValue(content.cookiePolicyLabel, defaults.content.cookiePolicyLabel, 160),
      serviceDetailsLabel: stringValue(content.serviceDetailsLabel, defaults.content.serviceDetailsLabel, 160),
    },
    appearance: {
      background: normalizeColor(appearance.background, defaults.appearance.background),
      text: normalizeColor(appearance.text, defaults.appearance.text),
      mutedText: normalizeColor(appearance.mutedText, defaults.appearance.mutedText),
      accent: normalizeColor(appearance.accent, defaults.appearance.accent),
      accentText: normalizeColor(appearance.accentText, defaults.appearance.accentText),
      border: normalizeColor(appearance.border, defaults.appearance.border),
      borderWidth: finiteNumber(appearance.borderWidth, defaults.appearance.borderWidth, 0, 12),
      borderRadius: finiteNumber(appearance.borderRadius, defaults.appearance.borderRadius, 0, 64),
      buttonRadius: finiteNumber(appearance.buttonRadius, defaults.appearance.buttonRadius, 0, 64),
      padding: finiteNumber(appearance.padding, defaults.appearance.padding, 8, 64),
      maxWidth: finiteNumber(appearance.maxWidth, defaults.appearance.maxWidth, 320, 1200),
      shadow: enumValue(appearance.shadow, ['none', 'soft', 'medium', 'strong'], defaults.appearance.shadow),
      overlay: booleanValue(appearance.overlay, defaults.appearance.overlay),
      fontFamily: enumValue(appearance.fontFamily, ['system', 'inter', 'serif'], defaults.appearance.fontFamily),
      fontSize: finiteNumber(appearance.fontSize, defaults.appearance.fontSize, 12, 22),
    },
    categories,
    services: normalizeServices(source.services, categoryIds),
    cookies: normalizeCookies(Array.isArray(source.cookies) ? source.cookies : defaults.cookies, categoryIds),
    integrationCategories: {
      kodetyAnalytics: category(integrations.kodetyAnalytics, defaults.integrationCategories.kodetyAnalytics),
      googleAnalytics: category(integrations.googleAnalytics, defaults.integrationCategories.googleAnalytics),
      googleTagManager: category(integrations.googleTagManager, defaults.integrationCategories.googleTagManager),
      microsoftClarity: category(integrations.microsoftClarity, defaults.integrationCategories.microsoftClarity),
      metaPixel: category(integrations.metaPixel, defaults.integrationCategories.metaPixel),
      plausible: category(integrations.plausible, defaults.integrationCategories.plausible),
      experiments: category(integrations.experiments, defaults.integrationCategories.experiments),
    },
    googleConsentMode: {
      enabled: booleanValue(googleConsentMode.enabled, defaults.googleConsentMode.enabled),
      mode: enumValue(googleConsentMode.mode, ['basic', 'advanced'], defaults.googleConsentMode.mode),
    },
    privacyCenter: {
      enabled: booleanValue(privacyCenter.enabled, defaults.privacyCenter.enabled),
      floatingButton: booleanValue(privacyCenter.floatingButton, defaults.privacyCenter.floatingButton),
      buttonLabel: stringValue(privacyCenter.buttonLabel, defaults.privacyCenter.buttonLabel, 160),
    },
    advanced: {
      region: enumValue(advanced.region, ['global', 'eu', 'uk', 'brazil', 'us', 'custom'], defaults.advanced.region),
      recordHistory: booleanValue(advanced.recordHistory, defaults.advanced.recordHistory),
      historyRetentionDays: Math.round(finiteNumber(advanced.historyRetentionDays, defaults.advanced.historyRetentionDays, 1, 3650)),
      debug: booleanValue(advanced.debug, defaults.advanced.debug),
      reconsentOnNewCategory: booleanValue(advanced.reconsentOnNewCategory, defaults.advanced.reconsentOnNewCategory),
      reconsentOnNewService: booleanValue(advanced.reconsentOnNewService, defaults.advanced.reconsentOnNewService),
      reconsentOnPolicyChange: booleanValue(advanced.reconsentOnPolicyChange, defaults.advanced.reconsentOnPolicyChange),
    },
  };
}

function validPolicyUrl(value: string) {
  return !value || /^(?:https?:\/\/|\/|#|\.\/|\.\.\/)/i.test(value);
}

function editableString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function cookieConsentSettingsIssues(settings: CookieConsentSettings): CookieConsentValidationIssue[] {
  const normalized = normalizeCookieConsentSettings(settings);
  if (!normalized.enabled) return [];

  const source = record(settings);
  const content = record(source.content);
  const issues: CookieConsentValidationIssue[] = [];
  const title = editableString(content.title, normalized.content.title);
  const description = editableString(content.description, normalized.content.description);
  const acceptAllLabel = editableString(content.acceptAllLabel, normalized.content.acceptAllLabel);
  const rejectAllLabel = editableString(content.rejectAllLabel, normalized.content.rejectAllLabel);
  const settingsLabel = editableString(content.settingsLabel, normalized.content.settingsLabel);

  if (!title) issues.push({ section: 'content', fields: ['title'], message: 'Adicione um título para o banner de cookies.' });
  if (!description) issues.push({ section: 'content', fields: ['description'], message: 'Adicione uma descrição para o banner de cookies.' });
  if (!acceptAllLabel || !rejectAllLabel) {
    issues.push({
      section: 'content',
      fields: [!acceptAllLabel ? 'acceptAllLabel' : '', !rejectAllLabel ? 'rejectAllLabel' : ''].filter(Boolean),
      message: 'Preencha os rótulos de aceitar e recusar.',
    });
  }
  if (normalized.bannerType === 'advanced' && !settingsLabel) {
    issues.push({ section: 'content', fields: ['settingsLabel'], message: 'Preencha o rótulo para abrir as preferências.' });
  }

  const privacyPolicyUrl = editableString(source.privacyPolicyUrl, normalized.privacyPolicyUrl);
  const cookiePolicyUrl = editableString(source.cookiePolicyUrl, normalized.cookiePolicyUrl);
  if (!validPolicyUrl(privacyPolicyUrl)) {
    issues.push({ section: 'general', fields: ['privacyPolicyUrl'], message: 'Use uma URL válida para a Política de Privacidade.' });
  }
  if (!validPolicyUrl(cookiePolicyUrl)) {
    issues.push({ section: 'general', fields: ['cookiePolicyUrl'], message: 'Use uma URL válida para a Política de Cookies.' });
  }

  const categories = Array.isArray(settings.categories) ? settings.categories : normalized.categories;
  const normalizedCategoryIds = categories.map((category, index) => normalizeId(category.id, `category_${index + 1}`));
  categories.forEach((category, index) => {
    const fields: string[] = [];
    if (!editableString(category.name, '')) fields.push('name');
    if (!editableString(category.description, '')) fields.push('description');
    const id = normalizedCategoryIds[index];
    if (normalizedCategoryIds.indexOf(id) !== index) fields.push('id');
    if (!fields.length) return;
    issues.push({
      section: 'categories',
      itemId: category.id,
      fields,
      message: fields.includes('id')
        ? `O ID da categoria “${id}” está duplicado.`
        : `Complete o nome e a descrição da categoria “${editableString(category.name, 'Sem nome')}”.`,
    });
  });

  const categoryIds = new Set(normalizedCategoryIds);
  const services = Array.isArray(settings.services) ? settings.services : normalized.services;
  services.forEach((service, index) => {
    const fields: string[] = [];
    const name = editableString(service.name, '');
    const categoryId = editableString(service.categoryId, '');
    if (!name) fields.push('name');
    if (!categoryId || !categoryIds.has(normalizeId(categoryId, ''))) fields.push('categoryId');
    const privacyUrl = editableString(service.privacyPolicyUrl, '');
    if (!validPolicyUrl(privacyUrl)) fields.push('privacyPolicyUrl');
    if (!fields.length) return;
    const label = name || `Serviço ${index + 1}`;
    issues.push({
      section: 'services',
      itemId: service.id,
      fields,
      message: fields.includes('privacyPolicyUrl')
        ? `Use uma URL de privacidade válida em “${label}”.`
        : `Complete o nome e a categoria do serviço “${label}”.`,
    });
  });

  const cookies = Array.isArray(settings.cookies) ? settings.cookies : normalized.cookies;
  cookies.forEach((cookie, index) => {
    const fields: string[] = [];
    const name = editableString(cookie.name, '');
    if (!name) fields.push('name');
    if (!editableString(cookie.purpose, '')) fields.push('purpose');
    const categoryId = editableString(cookie.categoryId, '');
    if (!categoryId || !categoryIds.has(normalizeId(categoryId, ''))) fields.push('categoryId');
    if (!fields.length) return;
    issues.push({
      section: 'cookies',
      itemId: cookie.id,
      fields,
      message: `Complete ${fields.length > 1 ? 'os dados obrigatórios' : 'o campo obrigatório'} do cookie “${name || `Cookie ${index + 1}`}”.`,
    });
  });

  return issues;
}

export function cookieConsentSettingsError(settings: CookieConsentSettings): string {
  return cookieConsentSettingsIssues(settings)[0]?.message || '';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Fields whose semantic change can invalidate a visitor's previous choice. */
export function cookieConsentRelevantSignature(settings: unknown) {
  const normalized = normalizeCookieConsentSettings(settings);
  return stableJson({
    enabled: normalized.enabled,
    bannerType: normalized.bannerType,
    expirationDays: normalized.expirationDays,
    askAgainOnChange: normalized.askAgainOnChange,
    policies: normalized.advanced.reconsentOnPolicyChange
      ? {
        privacyPolicyUrl: normalized.privacyPolicyUrl,
        cookiePolicyUrl: normalized.cookiePolicyUrl,
      }
      : undefined,
    respectDnt: normalized.respectDnt,
    categories: normalized.advanced.reconsentOnNewCategory ? normalized.categories : undefined,
    services: normalized.advanced.reconsentOnNewService ? normalized.services : undefined,
    cookies: normalized.advanced.reconsentOnNewService ? normalized.cookies : undefined,
    integrationCategories: normalized.integrationCategories,
    googleConsentMode: normalized.googleConsentMode,
    advanced: {
      region: normalized.advanced.region,
      reconsentOnNewCategory: normalized.advanced.reconsentOnNewCategory,
      reconsentOnNewService: normalized.advanced.reconsentOnNewService,
      reconsentOnPolicyChange: normalized.advanced.reconsentOnPolicyChange,
    },
  });
}

export interface CookieConsentScanFinding {
  id: string;
  kind: 'integration' | 'embed' | 'script' | 'cookie';
  name: string;
  provider: string;
  suggestedCategory: string;
  paths: string[];
  detail: string;
}

export interface CookieConsentScanResult {
  services: number;
  cookies: number;
  uncategorized: number;
  findings: CookieConsentScanFinding[];
}

const INTEGRATION_DEFINITIONS = {
  'google-analytics-library': {
    key: 'googleAnalytics', serviceId: 'kodety_google_analytics', label: 'Google Analytics 4', provider: 'Google',
  },
  'google-analytics': {
    key: 'googleAnalytics', serviceId: 'kodety_google_analytics', label: 'Google Analytics 4', provider: 'Google',
  },
  'google-tag-manager': {
    key: 'googleTagManager', serviceId: 'kodety_google_tag_manager', label: 'Google Tag Manager', provider: 'Google',
  },
  'microsoft-clarity': {
    key: 'microsoftClarity', serviceId: 'kodety_microsoft_clarity', label: 'Microsoft Clarity', provider: 'Microsoft',
  },
  'meta-pixel': {
    key: 'metaPixel', serviceId: 'kodety_meta_pixel', label: 'Meta Pixel', provider: 'Meta',
  },
  plausible: {
    key: 'plausible', serviceId: 'kodety_plausible', label: 'Plausible', provider: 'Plausible Analytics',
  },
} as const;

type IntegrationName = keyof typeof INTEGRATION_DEFINITIONS;
type IntegrationCategoryKey = keyof CookieConsentSettings['integrationCategories'];

const KNOWN_SCRIPT_SOURCES = [
  { pattern: /googletagmanager\.com\/(?:gtag\/js|gtm\.js)/i, name: 'Google Analytics / Tag Manager', provider: 'Google', category: 'analytics' },
  { pattern: /connect\.facebook\.net\/.*fbevents/i, name: 'Meta Pixel', provider: 'Meta', category: 'marketing' },
  { pattern: /clarity\.ms\/tag/i, name: 'Microsoft Clarity', provider: 'Microsoft', category: 'analytics' },
  { pattern: /plausible\.io\/js/i, name: 'Plausible', provider: 'Plausible Analytics', category: 'analytics' },
  { pattern: /hotjar\.com|static\.hotjar\.com/i, name: 'Hotjar', provider: 'Hotjar', category: 'analytics' },
  { pattern: /linkedin\.com\/insight|snap\.licdn\.com/i, name: 'LinkedIn Insight', provider: 'LinkedIn', category: 'marketing' },
  { pattern: /tiktok\.com\/i18n\/pixel|analytics\.tiktok\.com/i, name: 'TikTok Pixel', provider: 'TikTok', category: 'marketing' },
];

const KNOWN_EMBED_SOURCES = [
  { pattern: /(?:youtube(?:-nocookie)?\.com|youtu\.be)/i, name: 'YouTube', provider: 'Google' },
  { pattern: /player\.vimeo\.com/i, name: 'Vimeo', provider: 'Vimeo' },
  { pattern: /(?:google\.[^/]+\/maps|maps\.google\.)/i, name: 'Google Maps', provider: 'Google' },
];

function projectFileRecord(
  value: HtmlProject | Record<string, HtmlProjectFile> | HtmlProjectFile[] | undefined,
): Record<string, HtmlProjectFile> {
  if (!value) return {};
  if (Array.isArray(value)) return Object.fromEntries(value.map(file => [file.path, file]));
  const project = value as HtmlProject;
  if (project.files && typeof project.files === 'object') return project.files;
  return value as Record<string, HtmlProjectFile>;
}

/** Static, privacy-preserving authoring scan. It never executes the website. */
export function scanProjectConsentSources(
  value: HtmlProject | Record<string, HtmlProjectFile> | HtmlProjectFile[] | undefined,
): CookieConsentScanResult {
  const files = projectFileRecord(value);
  const findings = new Map<string, CookieConsentScanFinding>();
  const add = (finding: Omit<CookieConsentScanFinding, 'paths'>, path: string) => {
    const existing = findings.get(finding.id);
    if (existing) {
      if (!existing.paths.includes(path)) existing.paths.push(path);
      return;
    }
    findings.set(finding.id, { ...finding, paths: [path] });
  };
  Object.values(files).forEach(file => {
    if (file.text === undefined || !/\.(?:html?|js|mjs|cjs)$/i.test(file.path)) return;
    const source = file.text;
    Object.entries(INTEGRATION_DEFINITIONS).forEach(([name, definition]) => {
      if (!new RegExp(`data-kodety-integration=["']${name}["']`, 'i').test(source)) return;
      add({
        id: `integration:${definition.serviceId}`,
        kind: 'integration',
        name: definition.label,
        provider: definition.provider,
        suggestedCategory: name === 'meta-pixel' ? 'marketing' : 'analytics',
        detail: 'Integração nativa do Kodety',
      }, file.path);
    });
    KNOWN_SCRIPT_SOURCES.forEach(definition => {
      if (!definition.pattern.test(source)) return;
      add({
        id: `script:${normalizeId(definition.name, 'external_script')}`,
        kind: 'script',
        name: definition.name,
        provider: definition.provider,
        suggestedCategory: definition.category,
        detail: 'Script externo detectado estaticamente',
      }, file.path);
    });
    KNOWN_EMBED_SOURCES.forEach(definition => {
      if (!definition.pattern.test(source)) return;
      add({
        id: `embed:${normalizeId(definition.name, 'external_embed')}`,
        kind: 'embed',
        name: definition.name,
        provider: definition.provider,
        suggestedCategory: 'embedded_content',
        detail: 'Conteúdo incorporado detectado',
      }, file.path);
    });
    const cookiePattern = /document\.cookie\s*=\s*[`"']\s*([^=;`"']+)/gi;
    let match: RegExpExecArray | null;
    while ((match = cookiePattern.exec(source))) {
      const name = match[1].trim();
      if (!name || name.includes('${')) continue;
      add({
        id: `cookie:${normalizeId(name, 'custom_cookie')}`,
        kind: 'cookie',
        name,
        provider: 'Custom',
        suggestedCategory: 'necessary',
        detail: 'Cookie criado por código do projeto',
      }, file.path);
    }
  });
  const list = Array.from(findings.values()).sort((a, b) => a.name.localeCompare(b.name));
  return {
    services: list.filter(item => item.kind === 'integration' || item.kind === 'script' || item.kind === 'embed').length,
    cookies: list.filter(item => item.kind === 'cookie').length,
    uncategorized: list.filter(item => item.kind === 'script' && item.provider === 'Custom').length,
    findings: list,
  };
}

const GENERATED_ASSET_DIRECTORY = 'assets/kodety-cookie-consent';
const GENERATED_BLOCK_PATTERN = /\s*<!--\s*kodety-cookie-consent:(head-start|head-end|body-end):start\s*-->[\s\S]*?<!--\s*kodety-cookie-consent:\1:end\s*-->\s*/gi;

function normalizeProjectPath(path: string) {
  const stack: string[] = [];
  path.replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  return stack.join('/');
}

function joinProjectPath(...parts: string[]) {
  return normalizeProjectPath(parts.filter(Boolean).join('/'));
}

function dirname(path: string) {
  const parts = normalizeProjectPath(path).split('/');
  parts.pop();
  return parts.join('/');
}

function relativeProjectReference(fromPath: string, toPath: string) {
  const from = dirname(fromPath).split('/').filter(Boolean);
  const to = normalizeProjectPath(toPath).split('/').filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  return [
    ...Array.from({ length: from.length - shared }, () => '..'),
    ...to.slice(shared),
  ].join('/') || to.at(-1) || '';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function safeLink(value: string) {
  return validPolicyUrl(value) ? value : '';
}

function jsonForInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function insertAfterOpeningTag(html: string, tag: 'head' | 'body', content: string) {
  const opening = new RegExp(`<${tag}\\b[^>]*>`, 'i');
  const match = opening.exec(html);
  if (match) {
    const index = match.index + match[0].length;
    return `${html.slice(0, index)}${content}${html.slice(index)}`;
  }
  if (tag === 'head') {
    const htmlOpening = /<html\b[^>]*>/i.exec(html);
    if (htmlOpening) {
      const index = htmlOpening.index + htmlOpening[0].length;
      return `${html.slice(0, index)}<head>${content}</head>${html.slice(index)}`;
    }
    return `<head>${content}</head>${html}`;
  }
  const closingHtml = /<\/html\s*>/i.exec(html);
  if (closingHtml)
    return `${html.slice(0, closingHtml.index)}<body>${content}</body>${html.slice(closingHtml.index)}`;
  return `${html}<body>${content}</body>`;
}

function insertBeforeClosingTag(html: string, tag: 'head' | 'body', content: string) {
  const closing = new RegExp(`</${tag}\\s*>`, 'i');
  const match = closing.exec(html);
  if (match) return `${html.slice(0, match.index)}${content}${html.slice(match.index)}`;
  return insertAfterOpeningTag(html, tag, content);
}

function cssShadow(value: CookieConsentSettings['appearance']['shadow']) {
  if (value === 'none') return 'none';
  if (value === 'soft') return '0 8px 24px rgb(0 0 0 / 0.10)';
  if (value === 'medium') return '0 16px 44px rgb(0 0 0 / 0.14)';
  return '0 24px 72px rgb(0 0 0 / 0.20)';
}

function cookieConsentCss(settings: CookieConsentSettings) {
  const appearance = settings.appearance;
  const colorsAreDefaults = appearance.background === DEFAULT_COOKIE_CONSENT_SETTINGS.appearance.background
    && appearance.text === DEFAULT_COOKIE_CONSENT_SETTINGS.appearance.text
    && appearance.mutedText === DEFAULT_COOKIE_CONSENT_SETTINGS.appearance.mutedText
    && appearance.border === DEFAULT_COOKIE_CONSENT_SETTINGS.appearance.border;
  const dark = colorsAreDefaults
    ? { background: '#171719', text: '#f6f6f7', muted: '#aaaab2', border: '#303036' }
    : { background: appearance.background, text: appearance.text, muted: appearance.mutedText, border: appearance.border };
  const fontFamily = appearance.fontFamily === 'serif'
    ? 'ui-serif, Georgia, Cambria, "Times New Roman", serif'
    : appearance.fontFamily === 'system'
      ? 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      : 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  return `${cookieConsentBaseCss}\n/* Kodety Cookie Consent — generated design layer */
#cc-main {
  --cc-font-family: ${fontFamily};
  --cc-bg: ${appearance.background};
  --cc-primary-color: ${appearance.text};
  --cc-secondary-color: ${appearance.mutedText};
  --cc-link-color: ${appearance.accent};
  --cc-btn-primary-bg: ${appearance.accent};
  --cc-btn-primary-color: ${appearance.accentText};
  --cc-btn-primary-border-color: ${appearance.accent};
  --cc-btn-primary-hover-bg: color-mix(in srgb, ${appearance.accent} 86%, black);
  --cc-btn-primary-hover-border-color: color-mix(in srgb, ${appearance.accent} 86%, black);
  --cc-btn-secondary-bg: transparent;
  --cc-btn-secondary-color: ${appearance.text};
  --cc-btn-secondary-border-color: ${appearance.border};
  --cc-btn-secondary-hover-bg: color-mix(in srgb, ${appearance.text} 7%, transparent);
  --cc-btn-secondary-hover-border-color: ${appearance.border};
  --cc-separator-border-color: ${appearance.border};
  --cc-footer-bg: transparent;
  --cc-footer-color: ${appearance.mutedText};
  --cc-footer-border-color: ${appearance.border};
  --cc-cookie-category-block-bg: color-mix(in srgb, ${appearance.text} 4%, ${appearance.background});
  --cc-cookie-category-block-hover-bg: color-mix(in srgb, ${appearance.text} 7%, ${appearance.background});
  --cc-cookie-category-block-border: ${appearance.border};
  --cc-cookie-category-expanded-block-bg: color-mix(in srgb, ${appearance.text} 2%, ${appearance.background});
  --cc-cookie-category-expanded-block-hover-bg: ${appearance.border};
  --cc-toggle-on-bg: ${appearance.accent};
  --cc-toggle-off-bg: color-mix(in srgb, ${appearance.text} 34%, ${appearance.background});
  --cc-toggle-on-knob-bg: ${appearance.background};
  --cc-toggle-off-knob-bg: ${appearance.background};
  --cc-toggle-enabled-icon-color: ${appearance.accent};
  --cc-toggle-disabled-icon-color: color-mix(in srgb, ${appearance.text} 62%, ${appearance.background});
  --cc-toggle-readonly-bg: ${appearance.accent};
  --cc-toggle-readonly-knob-bg: ${appearance.accent};
  --cc-toggle-readonly-knob-icon-color: ${appearance.accentText};
  --cc-modal-border-radius: ${appearance.borderRadius}px;
  --cc-btn-border-radius: ${appearance.buttonRadius}px;
  --cc-overlay-bg: rgb(10 10 12 / ${appearance.overlay ? '0.62' : '0.38'});
  --kodety-cc-padding: max(18px, ${appearance.padding}px);
  --kodety-cc-subtle: color-mix(in srgb, var(--cc-primary-color) 4%, var(--cc-bg));
  --kodety-cc-subtle-hover: color-mix(in srgb, var(--cc-primary-color) 7%, var(--cc-bg));
  --kodety-cc-focus: color-mix(in srgb, ${appearance.accent} 28%, transparent);
  font-size: ${appearance.fontSize}px;
}
#cc-main.cc--darkmode {
  --cc-bg: ${dark.background};
  --cc-primary-color: ${dark.text};
  --cc-secondary-color: ${dark.muted};
  --cc-footer-color: ${dark.muted};
  --cc-btn-secondary-color: ${dark.text};
  --cc-btn-secondary-border-color: ${dark.border};
  --cc-btn-secondary-hover-border-color: color-mix(in srgb, ${dark.text} 18%, ${dark.border});
  --cc-separator-border-color: ${dark.border};
  --cc-footer-border-color: ${dark.border};
  --cc-cookie-category-block-border: ${dark.border};
  --cc-toggle-on-knob-bg: ${dark.background};
  --cc-toggle-off-knob-bg: ${dark.background};
}
#cc-main .cm,
#cc-main .pm {
  background: var(--cc-bg);
  border: ${appearance.borderWidth}px solid var(--cc-separator-border-color);
  box-shadow: ${cssShadow(appearance.shadow)};
}
#cc-main .cm,
#cc-main .cm.cm--box.cm--wide {
  max-width: min(calc(100vw - 32px), ${appearance.maxWidth}px);
}
#cc-main .cm {
  overflow: hidden;
  padding: 0;
}
#cc-main .cm__body { padding: 0; }
#cc-main .cm__body {
  container-name: kodety-consent-banner;
  container-type: inline-size;
}
#cc-main .cm__texts {
  justify-content: flex-start;
  padding: var(--kodety-cc-padding);
  padding-bottom: calc(var(--kodety-cc-padding) - 2px);
}
#cc-main .cm__title,
#cc-main .cm__desc { padding-left: 0; padding-right: 0; }
#cc-main .cm__title {
  font-size: clamp(1.18em, 2.2vw, 1.45em);
  font-weight: 680;
  line-height: 1.18;
}
#cc-main .cm__title + .cm__desc { margin-top: .72em; }
#cc-main .cm__desc {
  font-size: .94em;
  line-height: 1.58;
  max-height: min(34vh, 15em);
  max-width: 66ch;
  padding-bottom: 0;
}
#cc-main .cm__btns,
#cc-main .cm--box.cm--wide .cm__btns {
  border-top: 1px solid var(--cc-separator-border-color);
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  padding: 16px var(--kodety-cc-padding) 12px;
}
#cc-main .cm__btn-group,
#cc-main .cm--box.cm--wide .cm__btn-group { display: contents; }
#cc-main .cm .cm__btn + .cm__btn,
#cc-main .cm .cm__btn-group + .cm__btn-group { margin: 0; }
#cc-main .cm__btn,
#cc-main .pm__btn {
  font-size: .86em;
  font-weight: 650;
  letter-spacing: -0.012em;
  line-height: 1.2;
  min-height: 46px;
  min-width: 0;
  overflow: hidden;
  padding: .72em 1.15em;
  text-overflow: ellipsis;
  transition: background-color .18s ease, border-color .18s ease, box-shadow .18s ease, color .18s ease, transform .18s ease;
  white-space: nowrap;
  width: 100%;
}
#cc-main .cm__btn:not(.cm__btn--secondary):hover,
#cc-main .pm__btn:not(.pm__btn--secondary):hover {
  box-shadow: 0 8px 20px color-mix(in srgb, ${appearance.accent} 24%, transparent);
  transform: translateY(-1px);
}
#cc-main .cm__btn-group:last-child .cm__btn--secondary {
  background: color-mix(in srgb, ${appearance.accent} 8%, var(--cc-bg));
  border-color: color-mix(in srgb, ${appearance.accent} 30%, var(--cc-separator-border-color));
}
#cc-main .cm__btn-group:last-child .cm__btn--secondary:hover {
  background: color-mix(in srgb, ${appearance.accent} 13%, var(--cc-bg));
  border-color: color-mix(in srgb, ${appearance.accent} 54%, var(--cc-separator-border-color));
}
#cc-main .cm__title,
#cc-main .pm__title { letter-spacing: -0.025em; }
#cc-main .cm__btn--close { display: none !important; }
#cc-main .cm__footer {
  background: transparent;
  border-top: 0;
  padding: 0 var(--kodety-cc-padding) calc(var(--kodety-cc-padding) - 4px);
}
#cc-main .cm__links { padding: 0; }
#cc-main .cm__link-group {
  color: var(--cc-secondary-color);
  flex-wrap: wrap;
  font-size: .76em;
  gap: 8px 18px;
}
#cc-main .cm__link-group > * + * { margin-left: 0; }
#cc-main .cm__link-group .cc__link {
  background-image: none;
  color: inherit;
  font-weight: 560;
  opacity: .82;
  text-decoration: none;
  text-underline-offset: 3px;
}
#cc-main .cm__link-group .cc__link:hover {
  color: var(--cc-primary-color);
  opacity: 1;
  text-decoration: underline;
}
#cc-main button:focus { outline: none; }
#cc-main button:focus-visible,
#cc-main a:focus-visible {
  border-color: ${appearance.accent};
  box-shadow: 0 0 0 3px var(--kodety-cc-focus);
  outline: none;
}
#cc-main .pm__header {
  background: color-mix(in srgb, var(--cc-primary-color) 2%, var(--cc-bg));
  padding: 20px 24px;
}
#cc-main .pm__title {
  font-size: 1.12em;
  font-weight: 680;
  line-height: 1.25;
}
#cc-main .pm__close-btn {
  background: var(--kodety-cc-subtle);
  border-color: var(--cc-separator-border-color);
  height: 38px;
  width: 38px;
}
#cc-main .pm__close-btn:hover { background: var(--kodety-cc-subtle-hover); }
#cc-main .pm.pm--bar.pm--wide .pm__body { padding: 24px; }
#cc-main .pm__section:first-child {
  margin-bottom: 20px;
  padding: 0;
}
#cc-main .pm__section:first-child .pm__section-title-wrapper { display: none; }
#cc-main .pm__section:first-child .pm__section-desc-wrapper { margin-top: 0; }
#cc-main .pm__section--toggle {
  background: var(--kodety-cc-subtle);
  margin-bottom: 8px;
}
#cc-main .pm__section--toggle .pm__section-title {
  background: var(--kodety-cc-subtle);
  border-color: var(--cc-cookie-category-block-border);
  min-height: 64px;
  padding-bottom: 14px;
  padding-top: 14px;
}
#cc-main .pm__section--toggle .pm__section-title:hover { background: var(--kodety-cc-subtle-hover); }
#cc-main .pm__section--expandable .pm__section-title { padding-left: 54px; }
#cc-main .pm__section--expandable .pm__section-arrow {
  align-items: center;
  background: ${appearance.accent};
  height: 22px;
  left: 17px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
}
#cc-main .pm__section--expandable .pm__section-arrow svg {
  stroke: ${appearance.accentText};
  stroke-width: 2.4px;
  transform: scale(.5);
}
#cc-main .pm__section--toggle.is-expanded .pm__section-arrow svg { transform: scale(.5) rotate(180deg); }
#cc-main .section__toggle-wrapper {
  right: 18px;
  top: 50%;
  transform: translateY(-50%);
}
#cc-main .section__toggle:checked:disabled ~ .toggle__icon .toggle__icon-circle {
  background: var(--cc-toggle-readonly-knob-bg);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, ${appearance.accentText} 92%, transparent);
}
#cc-main .section__toggle:checked:disabled ~ .toggle__icon svg {
  stroke: ${appearance.accentText};
  stroke-width: 2.15px;
}
#cc-main .pm.pm--bar.pm--wide .pm__footer {
  background: color-mix(in srgb, var(--cc-primary-color) 2%, var(--cc-bg));
  gap: 10px;
  padding: 16px 24px 20px;
}
#cc-main .pm__btn { min-height: 44px; }
.kodety-consent-embed-placeholder {
  align-items: center; background: color-mix(in srgb, ${appearance.background} 95%, ${appearance.text});
  border: ${Math.max(1, appearance.borderWidth)}px solid ${appearance.border}; border-radius: ${appearance.borderRadius}px;
  color: ${appearance.text}; display: flex; flex-direction: column; gap: 12px; justify-content: center;
  min-height: 220px; padding: 28px; text-align: center; width: 100%;
}
.kodety-consent-embed-placeholder p { color: ${appearance.mutedText}; margin: 0; max-width: 42ch; }
.kodety-consent-embed-placeholder button,
.kodety-consent-floating-button {
  background: ${appearance.accent}; border: 0; border-radius: ${appearance.buttonRadius}px; color: ${appearance.accentText};
  cursor: pointer; font: 650 14px/1 ${fontFamily}; min-height: 40px; padding: 0 16px;
}
.kodety-consent-floating-button {
  bottom: 18px; box-shadow: ${cssShadow('soft')}; left: 18px; position: fixed; z-index: 2147483600;
}
#cc-main .kodety-consent-service-label { display: flex; flex-direction: column; gap: .2rem; padding-right: .8rem; }
#cc-main .kodety-consent-service-name { color: var(--cc-primary-color); display: block; font-weight: 650; line-height: 1.35; }
#cc-main .kodety-consent-service-description,
#cc-main .kodety-consent-service-meta { color: var(--cc-secondary-color); display: block; font-size: .82em; line-height: 1.4; }
#cc-main .kodety-consent-service-policy { color: var(--cc-link-color); font-weight: 650; }
html.show--consent .kodety-consent-floating-button,
html.show--preferences .kodety-consent-floating-button { display: none; }
iframe[data-kodety-consent-blocked="true"] { display: none !important; }
@container kodety-consent-banner (max-width: 460px) {
  #cc-main .cm__btns,
  #cc-main .cm--box.cm--wide .cm__btns { grid-template-columns: 1fr; }
  #cc-main .cm--box.cm--wide .cm__btn { min-width: 0; width: 100%; }
}
@media (max-width: 640px) {
  #cc-main { --kodety-cc-padding: max(18px, ${Math.max(16, appearance.padding - 4)}px); }
  #cc-main .cm { max-width: calc(100vw - 20px); }
  #cc-main .cm__btns,
  #cc-main .cm--box.cm--wide .cm__btns { grid-template-columns: 1fr; }
  #cc-main .cm__footer { padding-top: 2px; }
  #cc-main .pm__header,
  #cc-main .pm.pm--bar.pm--wide .pm__body,
  #cc-main .pm.pm--bar.pm--wide .pm__footer { padding-left: 18px; padding-right: 18px; }
  .kodety-consent-floating-button { bottom: 12px; left: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  #cc-main *, #cc-main *::before, #cc-main *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlAttribute(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity, digits: string) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isInteger(codePoint)
        && codePoint >= 0
        && codePoint <= 0x10ffff
        && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&#([0-9]+);/g, (entity, digits: string) => {
      const codePoint = Number.parseInt(digits, 10);
      return Number.isInteger(codePoint)
        && codePoint >= 0
        && codePoint <= 0x10ffff
        && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&(amp|apos|gt|lt|quot);/gi, (entity, name: string) => namedEntities[name.toLowerCase()] || entity);
}

function attributeValue(attributes: string, name: string) {
  const match = new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes);
  return match ? decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function hasAttribute(attributes: string, name: string) {
  return new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s*=|\\s|$)`, 'i').test(attributes);
}

function removeAttribute(attributes: string, name: string) {
  return attributes.replace(
    new RegExp(`\\s+${escapeRegExp(name)}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?(?=\\s|$)`, 'gi'),
    '',
  );
}

function setAttribute(attributes: string, name: string, value: string) {
  const clean = removeAttribute(attributes, name).trimEnd();
  return `${clean} ${name}="${escapeAttribute(value)}"`;
}

function makeManagedScriptInert(
  attributes: string,
  categoryId: string,
  serviceId: string,
) {
  const originalType = attributeValue(attributes, 'data-type') || attributeValue(attributes, 'type');
  const source = attributeValue(attributes, 'data-src') || attributeValue(attributes, 'src');
  let next = attributes;
  ['type', 'src', 'data-src', 'data-type', 'data-category', 'data-service', 'data-kodety-consent']
    .forEach(name => { next = removeAttribute(next, name); });
  next = setAttribute(next, 'type', 'text/plain');
  next = setAttribute(next, 'data-category', categoryId);
  next = setAttribute(next, 'data-service', serviceId);
  next = setAttribute(next, 'data-kodety-consent-managed', 'true');
  if (source) next = setAttribute(next, 'data-src', source);
  if (originalType && !/^(?:text\/(?:plain|javascript)|application\/javascript|module)$/i.test(originalType))
    next = setAttribute(next, 'data-type', originalType);
  else if (originalType === 'module') next = setAttribute(next, 'data-type', 'module');
  return next;
}

function makeManagedScriptLive(attributes: string) {
  const type = attributeValue(attributes, 'data-type');
  const source = attributeValue(attributes, 'data-src') || attributeValue(attributes, 'src');
  let next = attributes;
  ['type', 'src', 'data-src', 'data-type', 'data-category', 'data-service', 'data-kodety-consent', 'data-kodety-consent-managed']
    .forEach(name => { next = removeAttribute(next, name); });
  if (source) next = setAttribute(next, 'src', source);
  if (type) next = setAttribute(next, 'type', type);
  return next;
}

interface DetectedRuntimeService {
  id: string;
  label: string;
  provider: string;
  categoryId: string;
  cookieNames: string[];
}

const SERVICE_COOKIE_NAMES: Record<string, string[]> = {
  kodety_google_analytics: ['_ga', '_gid', '_gat'],
  kodety_microsoft_clarity: ['_clck', '_clsk', 'CLID', 'ANONCHK', 'MR', 'MUID', 'SM'],
  kodety_meta_pixel: ['_fbp', '_fbc'],
};

function integrationCategory(
  settings: CookieConsentSettings,
  key: IntegrationCategoryKey,
) {
  return settings.integrationCategories[key] || 'necessary';
}

function knownScriptDefinition(attributes: string, body: string) {
  const candidate = `${attributeValue(attributes, 'src')} ${attributeValue(attributes, 'data-src')} ${body.slice(0, 3000)}`;
  return KNOWN_SCRIPT_SOURCES.find(definition => definition.pattern.test(candidate));
}

function detectedRuntimeServices(project: HtmlProject, settings: CookieConsentSettings) {
  const result = new Map<string, DetectedRuntimeService>();
  const add = (service: DetectedRuntimeService) => {
    const existing = result.get(service.id);
    if (!existing) result.set(service.id, service);
    else existing.cookieNames = Array.from(new Set([...existing.cookieNames, ...service.cookieNames]));
  };
  add({
    id: 'kodety_native_analytics',
    label: 'Kodety Analytics',
    provider: 'Kodety',
    categoryId: settings.integrationCategories.kodetyAnalytics,
    cookieNames: [],
  });
  Object.values(project.files).forEach(file => {
    if (file.text === undefined || !/\.html?$/i.test(file.path)) return;
    file.text.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (full, attributes: string) => {
      const integrationName = attributeValue(attributes, 'data-kodety-integration') as IntegrationName;
      const integration = INTEGRATION_DEFINITIONS[integrationName];
      if (integration && integrationName !== 'google-analytics-library') {
        const categoryId = integrationCategory(settings, integration.key as IntegrationCategoryKey);
        add({
          id: integration.serviceId,
          label: integration.label,
          provider: integration.provider,
          categoryId,
          cookieNames: SERVICE_COOKIE_NAMES[integration.serviceId] || [],
        });
        return full;
      }
      const known = knownScriptDefinition(attributes, full);
      if (!known) return full;
      const id = `detected_${normalizeId(known.name, 'external_script')}`;
      add({ id, label: known.name, provider: known.provider, categoryId: known.category, cookieNames: [] });
      return full;
    });
  });
  return Array.from(result.values());
}

function shouldLoadGoogleImmediately(
  settings: CookieConsentSettings,
  integrationName: IntegrationName | '',
  knownProvider = '',
) {
  if (!settings.googleConsentMode.enabled || settings.googleConsentMode.mode !== 'advanced') return false;
  return integrationName === 'google-analytics-library'
    || integrationName === 'google-analytics'
    || integrationName === 'google-tag-manager'
    || knownProvider === 'Google';
}

function transformManagedScripts(html: string, settings: CookieConsentSettings) {
  let next = html.replace(
    /\s*<script\b(?=[^>]*\bdata-kodety-integration\s*=\s*(?:["']consent-loader["']|consent-loader))[^>]*>[\s\S]*?<\/script\s*>\s*/gi,
    '\n',
  );
  next = next.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, rawAttributes: string, rawBody: string) => {
    const customCodeId = attributeValue(rawAttributes, 'data-kodety-custom-code-consent');
    const linkedService = customCodeId
      ? settings.services.find(service => service.scriptIds.includes(customCodeId))
      : undefined;
    if (linkedService) {
      const attributes = !linkedService.consentRequired || linkedService.categoryId === 'necessary'
        ? makeManagedScriptLive(rawAttributes)
        : makeManagedScriptInert(rawAttributes, linkedService.categoryId, linkedService.id);
      return `<script${attributes}>${rawBody}</script>`;
    }
    const integrationName = attributeValue(rawAttributes, 'data-kodety-integration') as IntegrationName | '';
    const integration = integrationName ? INTEGRATION_DEFINITIONS[integrationName] : undefined;
    const existingCategory = attributeValue(rawAttributes, 'data-category');
    const known = !integration && !existingCategory ? knownScriptDefinition(rawAttributes, rawBody) : undefined;
    if (!integration && !known) return full;

    const categoryId = integration
      ? integrationCategory(settings, integration.key as IntegrationCategoryKey)
      : known!.category;
    const serviceId = integration
      ? integration.serviceId
      : `detected_${normalizeId(known!.name, 'external_script')}`;
    const loadImmediately = categoryId === 'necessary'
      || shouldLoadGoogleImmediately(settings, integrationName, known?.provider);
    let body = rawBody;
    if (integrationName === 'meta-pixel') {
      body = body.replace(
        /window\.__kodetyAnalyticsConsentGranted\s*===\s*true/g,
        `(window.kodety?.consent?.has?.(${JSON.stringify(categoryId)}) === true || window.__kodetyMarketingConsentGranted === true)`,
      );
    }
    const attributes = loadImmediately
      ? makeManagedScriptLive(rawAttributes)
      : makeManagedScriptInert(rawAttributes, categoryId, serviceId);
    return `<script${attributes}>${body}</script>`;
  });
  // A noscript iframe cannot be activated after a choice and would bypass the
  // manager. JavaScript-enabled visitors receive the consent-aware container.
  return next.replace(
    /\s*<noscript\b(?=[^>]*\bdata-kodety-integration\s*=\s*(?:["']google-tag-manager["']|google-tag-manager))[^>]*>[\s\S]*?<\/noscript\s*>\s*/gi,
    '\n',
  );
}

function transformManagedEmbeds(html: string, settings: CookieConsentSettings) {
  const categoryId = settings.categories.some(category => category.id === 'embedded_content')
    ? 'embedded_content'
    : settings.categories.find(category => !category.required)?.id || 'necessary';
  return html.replace(/<iframe\b([^>]*)>/gi, (full, rawAttributes: string) => {
    const previous = attributeValue(rawAttributes, 'data-kodety-consent-src');
    const source = previous || attributeValue(rawAttributes, 'src');
    if (!source || (!previous && !KNOWN_EMBED_SOURCES.some(definition => definition.pattern.test(source)))) return full;
    if (categoryId === 'necessary') return full;
    let attributes = rawAttributes;
    attributes = removeAttribute(attributes, 'src');
    attributes = setAttribute(attributes, 'src', 'about:blank');
    attributes = setAttribute(attributes, 'data-kodety-consent-src', source);
    attributes = setAttribute(attributes, 'data-kodety-consent-category', categoryId);
    attributes = setAttribute(attributes, 'data-kodety-consent-blocked', 'true');
    const className = attributeValue(attributes, 'class');
    attributes = setAttribute(attributes, 'class', `${className} kodety-consent-embed`.trim());
    return `<iframe${attributes}>`;
  });
}

function stripGeneratedBlocks(html: string) {
  // Each generated block already owns its surrounding newlines. Replacing it
  // with another newline would accumulate blank lines on every compile pass.
  return html.replace(GENERATED_BLOCK_PATTERN, '');
}

function cookieRowsForCategory(settings: CookieConsentSettings, categoryId: string) {
  return settings.cookies
    .filter(cookie => cookie.categoryId === categoryId)
    .map(cookie => ({
      name: escapeHtml(cookie.name),
      domain: escapeHtml(cookie.domain || '—'),
      purpose: escapeHtml(cookie.purpose),
      duration: escapeHtml(cookie.type === 'session' ? 'Sessão' : cookie.duration || '—'),
      party: cookie.party === 'third' ? 'Terceiro' : 'Próprio',
    }));
}

function activeManualServices(
  settings: CookieConsentSettings,
  pagePath: string,
) {
  return settings.services.filter(service =>
    service.enabledPages.length === 0
    || service.enabledPages.some(path => normalizeProjectPath(path) === normalizeProjectPath(pagePath)),
  );
}

function serviceDisclosureLabel(service: {
  name: string;
  provider?: string;
  description?: string;
  privacyPolicyUrl?: string;
  dataRetention?: string;
  cookies?: string[];
}) {
  const details = [
    service.provider ? `Provedor: ${escapeHtml(service.provider)}` : '',
    service.dataRetention ? `Retenção: ${escapeHtml(service.dataRetention)}` : '',
    service.cookies?.length ? `Cookies: ${service.cookies.map(escapeHtml).join(', ')}` : '',
  ].filter(Boolean);
  const privacyUrl = safeLink(service.privacyPolicyUrl || '');
  if (privacyUrl) {
    details.push(`<a class="kodety-consent-service-policy" href="${escapeAttribute(privacyUrl)}" target="_blank" rel="noopener noreferrer">Política de privacidade</a>`);
  }
  return [
    '<span class="kodety-consent-service-label">',
    `<span class="kodety-consent-service-name">${escapeHtml(service.name)}</span>`,
    service.description
      ? `<span class="kodety-consent-service-description">${escapeHtml(service.description)}</span>`
      : '',
    details.length
      ? `<span class="kodety-consent-service-meta">${details.join(' · ')}</span>`
      : '',
    '</span>',
  ].join('');
}

function buildCookieConsentConfig(
  settings: CookieConsentSettings,
  pagePath: string,
  detectedServices: DetectedRuntimeService[],
) {
  const categories: Record<string, Record<string, unknown>> = {};
  const manualServices = activeManualServices(settings, pagePath);
  settings.categories.forEach(category => {
    const categoryCookies = settings.cookies.filter(cookie => cookie.categoryId === category.id);
    const services: Record<string, Record<string, unknown>> = {};
    manualServices.filter(service => service.categoryId === category.id && service.consentRequired).forEach(service => {
      services[service.id] = {
        label: serviceDisclosureLabel(service),
        cookies: service.cookies.map(name => ({ name })),
      };
    });
    detectedServices.filter(service => service.categoryId === category.id).forEach(service => {
      if (services[service.id]) return;
      services[service.id] = {
        label: serviceDisclosureLabel({
          name: service.label,
          provider: service.provider,
          cookies: service.cookieNames,
        }),
        cookies: service.cookieNames.map(name => ({ name })),
      };
    });
    const autoClearCookies: Array<{ name: string; domain?: string }> = [];
    const autoClearKeys = new Set<string>();
    const addAutoClearCookie = (name: string, domain = '') => {
      if (!name) return;
      const key = `${name}\u0000${domain}`;
      if (autoClearKeys.has(key)) return;
      autoClearKeys.add(key);
      autoClearCookies.push({ name, ...(domain ? { domain } : {}) });
    };
    categoryCookies.forEach(cookie => addAutoClearCookie(cookie.name, cookie.domain));
    manualServices
      .filter(service => service.categoryId === category.id && service.consentRequired)
      .flatMap(service => service.cookies)
      .forEach(name => addAutoClearCookie(name));
    detectedServices
      .filter(service => service.categoryId === category.id)
      .flatMap(service => service.cookieNames)
      .forEach(name => addAutoClearCookie(name));
    categories[category.id] = {
      enabled: category.required || category.defaultEnabled,
      // CookieConsent treats every readOnly category as accepted. Never turn a
      // locked-off optional category into implicit consent.
      readOnly: category.required || (!category.allowVisitorControl && category.defaultEnabled),
      ...(Object.keys(services).length ? { services } : {}),
      ...(!category.required ? {
        // Reviving an inert script is irreversible in the current document.
        // Reload after revocation so integrations and Custom Code return to
        // their blocked state even when they set no known cookie.
        autoClear: { cookies: autoClearCookies, reloadPage: true },
      } : {}),
    };
  });

  const policyLinks = [
    settings.privacyPolicyUrl
      ? `<a class="cc__link" href="${escapeAttribute(safeLink(settings.privacyPolicyUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(settings.content.privacyPolicyLabel)}</a>`
      : '',
    settings.cookiePolicyUrl
      ? `<a class="cc__link" href="${escapeAttribute(safeLink(settings.cookiePolicyUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(settings.content.cookiePolicyLabel)}</a>`
      : '',
  ].filter(Boolean).join('');
  const sections: Record<string, unknown>[] = [{
    title: escapeHtml(settings.content.preferencesTitle),
    description: escapeHtml(settings.content.preferencesDescription),
  }];
  settings.categories.forEach(category => {
    const rows = cookieRowsForCategory(settings, category.id);
    sections.push({
      title: escapeHtml(category.name),
      description: escapeHtml(category.description),
      linkedCategory: category.id,
      ...(rows.length ? {
        cookieTable: {
          caption: escapeHtml(`${category.name}: cookies declarados`),
          headers: {
            name: 'Cookie', domain: 'Domínio', purpose: 'Finalidade', duration: 'Duração', party: 'Origem',
          },
          body: rows,
        },
      } : {}),
    });
  });

  const layout = settings.position === 'bottom'
    ? { layout: 'box wide', position: 'bottom center' }
    : settings.position === 'bottom-left'
      ? { layout: 'box', position: 'bottom left' }
      : settings.position === 'bottom-right'
        ? { layout: 'box', position: 'bottom right' }
        : { layout: 'box', position: 'middle center' };
  return {
    mode: 'opt-in',
    revision: settings.askAgainOnChange ? settings.configurationVersion : 0,
    autoShow: true,
    manageScriptTags: true,
    autoClearCookies: true,
    disablePageInteraction: settings.disablePageInteraction,
    hideFromBots: true,
    cookie: {
      name: 'kodety_consent',
      expiresAfterDays: settings.expirationDays,
      path: '/',
      sameSite: 'Lax',
      secure: true,
    },
    guiOptions: {
      consentModal: {
        ...layout,
        flipButtons: false,
        equalWeightButtons: false,
      },
      preferencesModal: {
        layout: 'bar wide',
        position: 'right',
        flipButtons: false,
        equalWeightButtons: false,
      },
    },
    categories,
    language: {
      default: 'pt-BR',
      translations: {
        'pt-BR': {
          consentModal: {
            title: escapeHtml(settings.content.title),
            description: escapeHtml(settings.content.description),
            acceptAllBtn: escapeHtml(settings.content.acceptAllLabel),
            acceptNecessaryBtn: escapeHtml(settings.content.rejectAllLabel),
            ...(settings.bannerType === 'advanced'
              ? { showPreferencesBtn: escapeHtml(settings.content.settingsLabel) }
              : {}),
            revisionMessage: 'As finalidades ou serviços deste site mudaram. Revise suas preferências.',
            footer: policyLinks,
          },
          preferencesModal: {
            title: escapeHtml(settings.content.preferencesTitle),
            acceptAllBtn: escapeHtml(settings.content.acceptAllLabel),
            acceptNecessaryBtn: escapeHtml(settings.content.rejectAllLabel),
            savePreferencesBtn: escapeHtml(settings.content.savePreferencesLabel),
            closeIconLabel: escapeHtml(settings.content.closeLabel),
            serviceCounterLabel: 'Serviço|Serviços',
            sections,
          },
        },
      },
    },
  };
}

function googleCategoryIsGrantedByDefault(settings: CookieConsentSettings, categoryId: string) {
  const category = settings.categories.find(candidate => candidate.id === categoryId);
  return category?.required === true;
}

function googleConsentStateMap(
  settings: CookieConsentSettings,
  has: (categoryId: string) => boolean,
) {
  const functionalCategory = settings.categories.some(category => category.id === 'functional')
    ? 'functional'
    : 'necessary';
  const personalizationCategory = settings.categories.some(category => category.id === 'personalization')
    ? 'personalization'
    : 'necessary';
  const status = (categoryId: string) => has(categoryId) ? 'granted' : 'denied';
  return {
    analytics_storage: status(settings.integrationCategories.googleAnalytics),
    ad_storage: status(settings.integrationCategories.metaPixel),
    ad_user_data: status(settings.integrationCategories.metaPixel),
    ad_personalization: status(settings.integrationCategories.metaPixel),
    functionality_storage: status(functionalCategory),
    personalization_storage: status(personalizationCategory),
    security_storage: 'granted',
  };
}

function googleConsentDefaultMarkup(settings: CookieConsentSettings) {
  if (!settings.googleConsentMode.enabled) return '';
  const state = googleConsentStateMap(
    settings,
    categoryId => googleCategoryIsGrantedByDefault(settings, categoryId),
  );
  const defaults = { ...state, wait_for_update: 500 };
  return `<script data-kodety-cookie-consent="google-consent-default">(function(w){w.dataLayer=w.dataLayer||[];w.gtag=w.gtag||function(){w.dataLayer.push(arguments)};w.gtag('consent','default',${jsonForInlineScript(defaults)});w.__kodetyGoogleConsentDefaultsSet=true;})(window);</script>`;
}

function cookieConsentRuntime(
  settings: CookieConsentSettings,
  pagePath: string,
  detectedServices: DetectedRuntimeService[],
) {
  const requiredIds = settings.categories.filter(category => category.required).map(category => category.id);
  const config = buildCookieConsentConfig(settings, pagePath, detectedServices);
  const googleServiceIds = Array.from(new Set(
    detectedServices.filter(service => service.provider === 'Google').map(service => service.id),
  ));
  const reloadOnRejectServiceIds = Array.from(new Set([
    ...detectedServices.map(service => service.id),
    ...activeManualServices(settings, pagePath)
      .filter(service => service.consentRequired && service.scriptIds.length > 0)
      .map(service => service.id),
  ]));
  const payload = {
    config,
    categoryIds: settings.categories.map(category => category.id),
    requiredIds,
    configurationVersion: settings.configurationVersion,
    expirationDays: settings.expirationDays,
    region: settings.advanced.region,
    recordHistory: settings.advanced.recordHistory,
    historyRetentionDays: settings.advanced.historyRetentionDays,
    debug: settings.advanced.debug,
    respectDnt: settings.respectDnt,
    theme: settings.theme,
    analyticsCategory: settings.integrationCategories.kodetyAnalytics,
    marketingCategory: settings.integrationCategories.metaPixel,
    experimentsCategory: settings.integrationCategories.experiments,
    googleConsentMode: settings.googleConsentMode,
    googleServiceIds,
    reloadOnRejectServiceIds,
    googleCategories: {
      analytics: settings.integrationCategories.googleAnalytics,
      marketing: settings.integrationCategories.metaPixel,
      functional: settings.categories.some(category => category.id === 'functional') ? 'functional' : 'necessary',
      personalization: settings.categories.some(category => category.id === 'personalization') ? 'personalization' : 'necessary',
    },
    integrationCategories: settings.integrationCategories,
    privacyCenter: settings.privacyCenter,
    embedBlockedText: 'Este conteúdo requer consentimento para conteúdo incorporado.',
    embedAllowLabel: 'Permitir e visualizar',
  };
  return `(() => {
  "use strict";
  const data = ${jsonForInlineScript(payload)};
  const manager = window.CookieConsent;
  if (!manager || typeof manager.run !== "function") return;
  const required = new Set(data.requiredIds);
  const listeners = new Map();
  let ready = false;
  let lastStateSignature = "";
  const consentRoot = window.kodety = window.kodety || {};
  const privacySignal = () => data.respectDnt === true && (
    navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true
  );
  const has = category => {
    if (required.has(category)) return true;
    try { return manager.acceptedCategory(category) === true; } catch (_) { return false; }
  };
  const state = () => {
    let cookie = null;
    let preferences = null;
    try { cookie = manager.getCookie(); } catch (_) {}
    try { preferences = manager.getUserPreferences(); } catch (_) {}
    const categories = Object.fromEntries(data.categoryIds.map(category => [category, has(category) ? "granted" : "denied"]));
    return {
      valid: (() => { try { return manager.validConsent() === true; } catch (_) { return false; } })(),
      consentId: cookie?.consentId || "",
      date: cookie?.lastConsentTimestamp || cookie?.consentTimestamp || "",
      configurationVersion: data.configurationVersion,
      region: data.region,
      categories,
      services: preferences?.acceptedServices || {},
    };
  };
  const emit = (eventName, detail) => {
    const call = name => {
      const callbacks = listeners.get(name);
      if (!callbacks) return;
      callbacks.forEach(callback => {
        try { callback(detail); } catch (error) { setTimeout(() => { throw error; }); }
      });
    };
    call(eventName);
    call("*");
  };
  const writeCategoryCookie = (name, granted) => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    const maxAge = Math.max(86400, Number(data.expirationDays || 180) * 86400);
    document.cookie = encodeURIComponent(name) + "=" + (granted ? "granted" : "denied") + "; Path=/; Max-Age=" + maxAge + "; SameSite=Lax" + secure;
  };
  const eraseCookie = name => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = encodeURIComponent(name) + "=; Path=/; Max-Age=0; SameSite=Lax" + secure;
  };
  const clearKodetyAnalyticsIdentity = () => {
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index) || "";
        if (key.startsWith("kodety.analytics.")) localStorage.removeItem(key);
      }
    } catch (_) {}
    document.cookie.split(";").forEach(part => {
      const name = decodeURIComponent((part.split("=")[0] || "").trim());
      if (/^kodety_analytics_(?:visitor|session)_/i.test(name)) eraseCookie(name);
    });
  };
  const clearKodetyExperiments = () => {
    document.cookie.split(";").forEach(part => {
      const name = decodeURIComponent((part.split("=")[0] || "").trim());
      if (name === "kodety_vid" || /^kodety_exp_\\d+$/i.test(name)) eraseCookie(name);
    });
  };
  const googleStates = () => {
    const status = category => has(category) ? "granted" : "denied";
    return {
      analytics_storage: status(data.googleCategories.analytics),
      ad_storage: status(data.googleCategories.marketing),
      ad_user_data: status(data.googleCategories.marketing),
      ad_personalization: status(data.googleCategories.marketing),
      functionality_storage: status(data.googleCategories.functional),
      personalization_storage: status(data.googleCategories.personalization),
      security_storage: "granted",
    };
  };
  const applyGoogleConsent = () => {
    if (!data.googleConsentMode.enabled || typeof window.gtag !== "function") return;
    window.gtag("consent", "update", googleStates());
  };
  let reloadScheduled = false;
  const scheduleReload = () => {
    if (reloadScheduled) return;
    reloadScheduled = true;
    setTimeout(() => location.reload(), 0);
  };
  const installServiceHooks = () => {
    const googleIds = new Set(data.googleServiceIds || []);
    const reloadIds = new Set(data.reloadOnRejectServiceIds || []);
    Object.values(data.config.categories || {}).forEach(category => {
      const services = category && typeof category === "object" ? category.services : null;
      if (!services || typeof services !== "object") return;
      Object.entries(services).forEach(([serviceId, service]) => {
        if (!service || typeof service !== "object") return;
        if (data.googleConsentMode.mode === "basic" && googleIds.has(serviceId)) {
          const previousAccept = service.onAccept;
          service.onAccept = () => {
            // CookieConsent 3.1 invokes service callbacks before it revives
            // matching data-category/data-service scripts.
            applyGoogleConsent();
            if (typeof previousAccept === "function") previousAccept();
          };
        }
        if (reloadIds.has(serviceId)) {
          const previousReject = service.onReject;
          service.onReject = () => {
            if (typeof previousReject === "function") previousReject();
            scheduleReload();
          };
        }
      });
    });
  };
  const recordHistory = snapshot => {
    if (!data.recordHistory || !snapshot.valid) return;
    try {
      const key = "kodety.consent.history";
      const now = Date.now();
      const retention = Math.max(1, Number(data.historyRetentionDays || 365)) * 86400000;
      const previous = JSON.parse(localStorage.getItem(key) || "[]");
      const records = Array.isArray(previous) ? previous.filter(item => now - Number(item?.timestamp || 0) <= retention) : [];
      const signature = JSON.stringify([snapshot.configurationVersion, snapshot.categories, snapshot.services]);
      if (records[0]?.signature !== signature) records.unshift({
        anonymousId: snapshot.consentId,
        timestamp: now,
        date: new Date(now).toISOString(),
        configurationVersion: snapshot.configurationVersion,
        region: snapshot.region,
        categories: snapshot.categories,
        services: snapshot.services,
        signature,
      });
      localStorage.setItem(key, JSON.stringify(records.slice(0, 50)));
    } catch (_) {}
  };
  const updateEmbeds = () => {
    document.querySelectorAll("iframe[data-kodety-consent-src]").forEach(iframe => {
      const category = iframe.getAttribute("data-kodety-consent-category") || "embedded_content";
      const source = iframe.getAttribute("data-kodety-consent-src") || "";
      let placeholder = iframe.nextElementSibling;
      if (!placeholder?.classList?.contains("kodety-consent-embed-placeholder")) placeholder = null;
      if (has(category)) {
        iframe.removeAttribute("data-kodety-consent-blocked");
        if (source && iframe.getAttribute("src") !== source) iframe.setAttribute("src", source);
        placeholder?.remove();
        return;
      }
      if (iframe.getAttribute("src") !== "about:blank") iframe.setAttribute("src", "about:blank");
      iframe.setAttribute("data-kodety-consent-blocked", "true");
      if (placeholder) return;
      placeholder = document.createElement("div");
      placeholder.className = "kodety-consent-embed-placeholder";
      placeholder.setAttribute("role", "region");
      const message = document.createElement("p");
      message.textContent = data.embedBlockedText;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = data.embedAllowLabel;
      button.addEventListener("click", () => consentApi.set(category, true));
      placeholder.append(message, button);
      iframe.after(placeholder);
    });
  };
  const sync = (reason, persistHistory = false) => {
    const snapshot = state();
    const analyticsGranted = has(data.analyticsCategory);
    const marketingGranted = has(data.marketingCategory);
    const experimentsGranted = has(data.experimentsCategory);
    window.__kodetyAnalyticsConsentGranted = analyticsGranted;
    window.__kodetyMarketingConsentGranted = marketingGranted;
    writeCategoryCookie("kodety_consent_analytics", analyticsGranted);
    writeCategoryCookie("kodety_consent_marketing", marketingGranted);
    writeCategoryCookie("kodety_consent_experiments", experimentsGranted);
    try { localStorage.setItem("kodety-analytics-consent", analyticsGranted ? "granted" : "denied"); } catch (_) {}
    if (!analyticsGranted) clearKodetyAnalyticsIdentity();
    if (!experimentsGranted) clearKodetyExperiments();
    if (typeof window.fbq === "function") window.fbq("consent", marketingGranted ? "grant" : "revoke");
    applyGoogleConsent();
    updateEmbeds();
    if (persistHistory) recordHistory(snapshot);
    const signature = JSON.stringify(snapshot.categories);
    if (signature !== lastStateSignature || reason !== "load") {
      lastStateSignature = signature;
      window.dispatchEvent(new CustomEvent("kodety:consent-change", { detail: snapshot }));
      window.dispatchEvent(new CustomEvent("kodety:analytics-consent", { detail: analyticsGranted ? "granted" : "denied" }));
      emit("change", snapshot);
    }
    if (data.debug) console.info("[Kodety Consent]", reason, snapshot);
    return snapshot;
  };
  const setCategory = (category, granted) => {
    if (!ready || required.has(category) || !data.categoryIds.includes(category)) return false;
    let accepted = [];
    try { accepted = manager.getUserPreferences()?.acceptedCategories || []; } catch (_) {}
    const next = new Set([...data.requiredIds, ...accepted]);
    if (granted) next.add(category); else next.delete(category);
    manager.acceptCategory(Array.from(next));
    return true;
  };
  const consentApi = {
    has,
    hasIntegration: integration => {
      const category = data.integrationCategories[integration] || integration;
      return has(category);
    },
    get: state,
    open: () => { if (!ready) return false; manager.showPreferences(); return true; },
    show: () => { if (!ready) return false; manager.show(true); return true; },
    close: () => {
      if (!ready) return false;
      manager.hidePreferences();
      manager.hide();
      return true;
    },
    set: setCategory,
    acceptAll: () => { if (!ready) return false; manager.acceptCategory("all"); return true; },
    rejectAll: () => { if (!ready) return false; manager.acceptCategory("necessary"); return true; },
    reset: () => {
      if (!ready) return false;
      ready = false;
      manager.reset(true);
      // Executed scripts cannot be made inert again in-place. A reload is the
      // only reliable reset for both the manager and already-loaded trackers.
      location.reload();
      return true;
    },
    on: (eventName, callback) => {
      if (typeof callback !== "function") return () => {};
      const name = String(eventName || "change");
      const callbacks = listeners.get(name) || new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
      return () => callbacks.delete(callback);
    },
    debugger: () => ({
      state: state(),
      blockedScripts: Array.from(document.querySelectorAll('script[type="text/plain"][data-category]')).map(script => ({
        category: script.getAttribute("data-category"),
        service: script.getAttribute("data-service") || "",
        source: script.getAttribute("data-src") || "inline",
      })),
      blockedEmbeds: Array.from(document.querySelectorAll('iframe[data-kodety-consent-blocked="true"]')).map(iframe => ({
        category: iframe.getAttribute("data-kodety-consent-category"),
        source: iframe.getAttribute("data-kodety-consent-src"),
      })),
    }),
  };
  consentRoot.consent = consentApi;
  window.kodetyAnalyticsConsent = granted => setCategory(data.analyticsCategory, granted === true || granted === "granted");
  window.kodetyMarketingConsent = granted => setCategory(data.marketingCategory, granted === true || granted === "granted");

  const applyTheme = () => {
    const root = document.getElementById("cc-main");
    if (!root) return;
    const dark = data.theme === "dark" || (data.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("cc--darkmode", dark);
  };
  const installPrivacyCenter = () => {
    if (!data.privacyCenter.enabled) return;
    document.addEventListener("click", event => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-kodety-consent-open], a[href="#cookie-preferences"], a[href="#privacy-preferences"]')
        : null;
      if (!target) return;
      event.preventDefault();
      consentApi.open();
    });
    if (!data.privacyCenter.floatingButton) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kodety-consent-floating-button";
    button.textContent = data.privacyCenter.buttonLabel;
    button.setAttribute("aria-label", data.privacyCenter.buttonLabel);
    button.addEventListener("click", consentApi.open);
    document.body.append(button);
  };
  const eraseStoredConsent = () => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = "kodety_consent=; Path=/; Max-Age=0; SameSite=Lax" + secure;
    try { localStorage.removeItem("kodety_consent"); } catch (_) {}
  };
  const start = async () => {
    if (privacySignal()) eraseStoredConsent();
    data.config.cookie.secure = location.protocol === "https:";
    data.config.onFirstConsent = () => sync("first-consent", true);
    data.config.onConsent = () => sync("consent", false);
    data.config.onChange = () => sync("change", true);
    data.config.onModalReady = applyTheme;
    installServiceHooks();
    await manager.run(data.config);
    ready = true;
    if (privacySignal() && !manager.validConsent()) manager.acceptCategory("necessary");
    applyTheme();
    installPrivacyCenter();
    sync("load");
    emit("ready", state());
    if (data.theme === "auto") {
      const media = matchMedia("(prefers-color-scheme: dark)");
      if (typeof media.addEventListener === "function") media.addEventListener("change", applyTheme);
    }
    new MutationObserver(applyTheme).observe(document.body, { childList: true, subtree: false });
  };
  start().catch(error => console.error("[Kodety Consent] Não foi possível iniciar o gerenciador.", error));
})();`;
}

function restoreManagedHtml(html: string) {
  let next = stripGeneratedBlocks(html);
  next = next.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attributes: string, body: string) => {
    if (attributeValue(attributes, 'data-kodety-consent-managed') !== 'true') return full;
    if (hasAttribute(attributes, 'data-kodety-custom-code-consent')) {
      return `<script${removeAttribute(attributes, 'data-kodety-consent-managed')}>${body}</script>`;
    }
    return `<script${makeManagedScriptLive(attributes)}>${body}</script>`;
  });
  next = next.replace(/<iframe\b([^>]*)>/gi, (full, rawAttributes: string) => {
    const source = attributeValue(rawAttributes, 'data-kodety-consent-src');
    if (!source) return full;
    let attributes = rawAttributes;
    ['src', 'data-kodety-consent-src', 'data-kodety-consent-category', 'data-kodety-consent-blocked']
      .forEach(name => { attributes = removeAttribute(attributes, name); });
    attributes = setAttribute(attributes, 'src', source);
    const className = attributeValue(attributes, 'class')
      .split(/\s+/)
      .filter(name => name && name !== 'kodety-consent-embed')
      .join(' ');
    if (className) attributes = setAttribute(attributes, 'class', className);
    else attributes = removeAttribute(attributes, 'class');
    return `<iframe${attributes}>`;
  });
  return next;
}

function metadataCookieConsent(project: HtmlProject) {
  const metadataFile = project.files['.incode/project.json'];
  if (!metadataFile?.text) return undefined;
  try {
    const metadata = JSON.parse(metadataFile.text) as Record<string, unknown>;
    return metadata.cookieConsent;
  } catch {
    return undefined;
  }
}

export interface CookieConsentTransportOptions {
  /** Preview uses one generated HTML string and therefore cannot resolve newly emitted project files. */
  inlineAssets?: boolean;
}

/**
 * Compiles authoring metadata into a self-contained privacy runtime. The pass
 * runs after Custom Code so no protected payload reaches the HTML parser first.
 */
export function prepareCookieConsentProjectForTransport(
  project: HtmlProject,
  rawSettings?: unknown,
  options?: CookieConsentTransportOptions,
): HtmlProject {
  const settings = normalizeCookieConsentSettings(
    rawSettings === undefined ? metadataCookieConsent(project) : rawSettings,
  );
  const assetRoot = joinProjectPath(project.rootPath, GENERATED_ASSET_DIRECTORY);
  const runtimePath = joinProjectPath(assetRoot, 'cookieconsent.umd.js');
  const stylesheetPath = joinProjectPath(assetRoot, 'cookieconsent.css');
  const licensePath = joinProjectPath(assetRoot, 'LICENSE.txt');
  const files: Record<string, HtmlProjectFile> = {};
  Object.entries(project.files).forEach(([path, file]) => {
    if (normalizeProjectPath(path).startsWith(`${assetRoot}/`)) return;
    files[path] = file;
  });
  const cleanProject = files === project.files ? project : { ...project, files };
  const detectedServices = detectedRuntimeServices(cleanProject, settings);
  let changed = Object.keys(files).length !== Object.keys(project.files).length;

  Object.entries(files).forEach(([path, file]) => {
    if (!/\.html?$/i.test(path) || file.text === undefined || normalizeProjectPath(path).startsWith('.incode/components/')) return;
    let html = restoreManagedHtml(file.text);
    if (settings.enabled) {
      html = transformManagedScripts(html, settings);
      html = transformManagedEmbeds(html, settings);
      const cssReference = relativeProjectReference(path, stylesheetPath);
      const runtimeReference = relativeProjectReference(path, runtimePath);
      const headDefault = googleConsentDefaultMarkup(settings);
      const headStart = `\n<!-- kodety-cookie-consent:head-start:start -->${headDefault}<!-- kodety-cookie-consent:head-start:end -->\n`;
      const stylesheet = options?.inlineAssets
        ? `<style data-kodety-cookie-consent="styles">${cookieConsentCss(settings).replace(/<\/style/gi, '<\\/style')}</style>`
        : `<link rel="stylesheet" href="${escapeAttribute(cssReference)}" data-kodety-cookie-consent="styles">`;
      const headEnd = `\n<!-- kodety-cookie-consent:head-end:start -->${stylesheet}<!-- kodety-cookie-consent:head-end:end -->\n`;
      const runtimeAsset = options?.inlineAssets
        ? `<script data-kodety-cookie-consent="engine">${cookieConsentRuntimeSource.replace(/<\/script/gi, '<\\/script')}</script>`
        : `<script src="${escapeAttribute(runtimeReference)}" data-kodety-cookie-consent="engine"></script>`;
      const init = `<script data-kodety-cookie-consent="runtime">${cookieConsentRuntime(settings, path, detectedServices).replace(/<\/script/gi, '<\\/script')}</script>`;
      const bodyEnd = `\n<!-- kodety-cookie-consent:body-end:start -->${runtimeAsset}${init}<!-- kodety-cookie-consent:body-end:end -->\n`;
      html = insertAfterOpeningTag(html, 'head', headStart);
      html = insertBeforeClosingTag(html, 'head', headEnd);
      html = insertBeforeClosingTag(html, 'body', bodyEnd);
    }
    if (html === file.text) return;
    changed = true;
    files[path] = { ...file, text: html };
  });

  if (!settings.enabled || options?.inlineAssets) return changed ? { ...project, files } : project;
  files[runtimePath] = {
    path: runtimePath,
    mimeType: 'text/javascript',
    text: cookieConsentRuntimeSource,
  };
  files[stylesheetPath] = {
    path: stylesheetPath,
    mimeType: 'text/css',
    text: cookieConsentCss(settings),
  };
  files[licensePath] = {
    path: licensePath,
    mimeType: 'text/plain',
    text: cookieConsentLicense,
  };
  return { ...project, files };
}
