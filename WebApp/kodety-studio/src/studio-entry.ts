import { loadStudioPreferences } from '../../../ChromeExtension/kodety-studio/src/storage';

/** These query values describe navigation and UI preferences, never identity. */
export function readStudioEntry(value: string) {
  const url = new URL(value);
  const language = url.searchParams.get('lang');
  const hash = new URLSearchParams(url.hash.slice(1));
  const callback = hash.has('studio_ticket') || hash.has('studio_state');
  return {
    language: language === 'pt' || language === 'en' ? language : undefined,
    fromDash: url.searchParams.get('from') === 'dash' && !callback,
    callback,
  } as const;
}

export function loadStudioEntryPreferences(value = window.location.href) {
  const preferences = loadStudioPreferences('en');
  return { ...preferences, language: readStudioEntry(value).language ?? preferences.language };
}

/** Consume the one-shot handoff before leaving, so Back cannot loop through SSO. */
export function consumedStudioEntryUrl(value: string): string {
  const url = new URL(value);
  if (url.searchParams.get('from') === 'dash') url.searchParams.delete('from');
  if (readStudioEntry(value).language) url.searchParams.delete('lang');
  return url.href;
}
