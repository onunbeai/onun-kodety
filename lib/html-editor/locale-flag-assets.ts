// Optimized SVG equivalents of the Figma flag library used by the Localization UI:
// https://www.figma.com/design/2KwdbFSHVESyWRvoFK7aao/Untitled?node-id=1-19481
const LOCALE_FLAG_ASSETS = {
  BR: new URL('./locale-flags/br.svg', import.meta.url).href,
  PT: new URL('./locale-flags/pt.svg', import.meta.url).href,
  US: new URL('./locale-flags/us.svg', import.meta.url).href,
  GB: new URL('./locale-flags/gb.svg', import.meta.url).href,
  ES: new URL('./locale-flags/es.svg', import.meta.url).href,
  MX: new URL('./locale-flags/mx.svg', import.meta.url).href,
  FR: new URL('./locale-flags/fr.svg', import.meta.url).href,
  DE: new URL('./locale-flags/de.svg', import.meta.url).href,
  IT: new URL('./locale-flags/it.svg', import.meta.url).href,
  NL: new URL('./locale-flags/nl.svg', import.meta.url).href,
  PL: new URL('./locale-flags/pl.svg', import.meta.url).href,
  TR: new URL('./locale-flags/tr.svg', import.meta.url).href,
  RU: new URL('./locale-flags/ru.svg', import.meta.url).href,
  UA: new URL('./locale-flags/ua.svg', import.meta.url).href,
  JP: new URL('./locale-flags/jp.svg', import.meta.url).href,
  KR: new URL('./locale-flags/kr.svg', import.meta.url).href,
  CN: new URL('./locale-flags/cn.svg', import.meta.url).href,
  TW: new URL('./locale-flags/tw.svg', import.meta.url).href,
  SA: new URL('./locale-flags/sa.svg', import.meta.url).href,
  IL: new URL('./locale-flags/il.svg', import.meta.url).href,
  IN: new URL('./locale-flags/in.svg', import.meta.url).href,
  ID: new URL('./locale-flags/id.svg', import.meta.url).href,
  VN: new URL('./locale-flags/vn.svg', import.meta.url).href,
  TH: new URL('./locale-flags/th.svg', import.meta.url).href,
  SE: new URL('./locale-flags/se.svg', import.meta.url).href,
  DK: new URL('./locale-flags/dk.svg', import.meta.url).href,
  NO: new URL('./locale-flags/no.svg', import.meta.url).href,
  FI: new URL('./locale-flags/fi.svg', import.meta.url).href,
} as const;

export function localeFlagAssetUrl(region: string) {
  return LOCALE_FLAG_ASSETS[region.toUpperCase() as keyof typeof LOCALE_FLAG_ASSETS] || '';
}
