const FALLBACK_ADMIN_UI_LOCALE = 'pt-BR';

type KodetyAdminI18nWindow = Window & {
  kodetyAdminI18n?: {
    locale?: unknown;
  };
};

function canonicalLocale(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return Intl.getCanonicalLocales(value.trim())[0] || null;
  } catch {
    return null;
  }
}

/**
 * Locale selected for the Kodety administration UI.
 *
 * This deliberately does not inspect project/site localization settings:
 * those describe published content, while dates and numbers in editor chrome
 * must follow the current administrative interface language.
 */
export function getAdminUiLocale(): string {
  if (typeof window === 'undefined') return FALLBACK_ADMIN_UI_LOCALE;

  const configured = canonicalLocale((window as KodetyAdminI18nWindow).kodetyAdminI18n?.locale);
  if (configured) return configured;

  const documentLocale = typeof document === 'undefined'
    ? null
    : canonicalLocale(document.documentElement.dataset.kodetyUiLocale || document.documentElement.lang);
  return documentLocale || FALLBACK_ADMIN_UI_LOCALE;
}

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function getAdminNumberFormatter(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const locale = getAdminUiLocale();
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

export function getAdminDateTimeFormatter(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  const locale = getAdminUiLocale();
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}
