import type { AnalyticsBreakdownItem } from './analytics';

export type AnalyticsSourceVisual =
  | 'direct'
  | 'search'
  | 'email'
  | 'referral'
  | 'google'
  | 'facebook'
  | 'instagram'
  | 'youtube'
  | 'linkedin'
  | 'tiktok'
  | 'x'
  | 'pinterest'
  | 'whatsapp'
  | 'telegram';

export type AnalyticsDeviceVisual = 'desktop' | 'mobile' | 'tablet' | 'unknown';

type BreakdownIdentity = Pick<AnalyticsBreakdownItem, 'key' | 'label' | 'secondaryLabel'>;

const COUNTRY_NAME_ALIASES: Record<string, string> = {
  alemanha: 'DE',
  argentina: 'AR',
  australia: 'AU',
  austria: 'AT',
  belgica: 'BE',
  belgium: 'BE',
  brasil: 'BR',
  brazil: 'BR',
  canada: 'CA',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  coreia: 'KR',
  denmark: 'DK',
  dinamarca: 'DK',
  espanha: 'ES',
  estadosunidos: 'US',
  finland: 'FI',
  finlandia: 'FI',
  france: 'FR',
  franca: 'FR',
  germany: 'DE',
  india: 'IN',
  indonesia: 'ID',
  israel: 'IL',
  italy: 'IT',
  italia: 'IT',
  japan: 'JP',
  japao: 'JP',
  mexico: 'MX',
  netherlands: 'NL',
  noruega: 'NO',
  norway: 'NO',
  paisesbaixos: 'NL',
  poland: 'PL',
  polonia: 'PL',
  portugal: 'PT',
  reinounido: 'GB',
  russia: 'RU',
  russiafederation: 'RU',
  saudiaarabia: 'SA',
  southkorea: 'KR',
  spain: 'ES',
  suecia: 'SE',
  sweden: 'SE',
  thailand: 'TH',
  thailandia: 'TH',
  turkey: 'TR',
  turquia: 'TR',
  ucrania: 'UA',
  ukraine: 'UA',
  unitedkingdom: 'GB',
  unitedstates: 'US',
  vietnam: 'VN',
};

function normalizeLookup(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function countryCodeFrom(value: string | undefined) {
  const candidate = value?.trim() || '';
  if (!candidate) return '';

  const parts = candidate.split(/[|,]/).map(part => part.trim()).filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (/^[a-z]{2}$/i.test(parts[index])) return parts[index].toUpperCase();
  }

  return COUNTRY_NAME_ALIASES[normalizeLookup(candidate)] || '';
}

export function resolveAnalyticsCountryCode(item: BreakdownIdentity) {
  return countryCodeFrom(item.secondaryLabel)
    || countryCodeFrom(item.key)
    || countryCodeFrom(item.label);
}

export function countryCodeToFlagEmoji(value: string) {
  const countryCode = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return '';
  return String.fromCodePoint(
    ...Array.from(countryCode).map(character => 127397 + character.charCodeAt(0)),
  );
}

function sourceText(item: BreakdownIdentity) {
  return [item.key, item.label, item.secondaryLabel]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeLookup)
    .join(' ');
}

function includesAny(value: string, aliases: string[]) {
  return aliases.some(alias => value.includes(alias));
}

export function resolveAnalyticsSourceVisual(item: BreakdownIdentity): AnalyticsSourceVisual | null {
  const value = sourceText(item);
  if (!value) return null;

  if (includesAny(value, ['__direct__', 'direto', 'direct', 'none'])) return 'direct';
  if (includesAny(value, ['google', 'googleadservices', 'googlesyndication'])) return 'google';
  if (includesAny(value, ['facebook', 'fbcom', 'meta'])) return 'facebook';
  if (includesAny(value, ['instagram'])) return 'instagram';
  if (includesAny(value, ['youtube'])) return 'youtube';
  if (includesAny(value, ['linkedin', 'lnkdin'])) return 'linkedin';
  if (includesAny(value, ['tiktok'])) return 'tiktok';
  if (includesAny(value, ['twitter', 'xcom', 'tco'])) return 'x';
  if (includesAny(value, ['pinterest', 'pinit'])) return 'pinterest';
  if (includesAny(value, ['whatsapp', 'wame'])) return 'whatsapp';
  if (includesAny(value, ['telegram', 'tme'])) return 'telegram';
  if (includesAny(value, ['organic', 'buscaorganica', 'search', 'bing', 'yahoo', 'duckduckgo', 'ecosia', 'yandex', 'baidu'])) return 'search';
  if (includesAny(value, ['email', 'e-mail', 'newsletter', 'mailchimp'])) return 'email';
  if (includesAny(value, ['referral', 'referencia', 'referencias'])) return 'referral';
  return null;
}

export function resolveAnalyticsDeviceVisual(item: BreakdownIdentity): AnalyticsDeviceVisual {
  const value = sourceText(item);
  if (includesAny(value, ['tablet', 'ipad'])) return 'tablet';
  if (includesAny(value, ['mobile', 'phone', 'smartphone', 'celular', 'movel', 'iphone', 'android'])) return 'mobile';
  if (includesAny(value, ['desktop', 'computer', 'computador', 'notebook', 'laptop', 'pc'])) return 'desktop';
  return 'unknown';
}
