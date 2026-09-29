type LocalizationFlagWindow = typeof window & {
  kodetyWordPress?: {
    localizationFlagAssetUrl?: string;
  };
};

export function localeFlagAssetUrl(region: string) {
  const normalized = region.trim().toLowerCase();
  const source = (window as LocalizationFlagWindow).kodetyWordPress?.localizationFlagAssetUrl || '';
  if (!source || !/^[a-z]{2}$/.test(normalized)) return '';
  const url = new URL(source, window.location.href);
  url.searchParams.set('region', normalized);
  return url.href;
}
