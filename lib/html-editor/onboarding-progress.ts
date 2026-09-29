/** Optional local reading progress, independent of the user's invitation choice. */
export interface OnboardingReadingProgress { stepId: string; completed: boolean }
export type OnboardingProgress = Record<string, OnboardingReadingProgress>;
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;
const areas = ['design', 'cms', 'settings', 'analytics', 'localization'];

function isReadingProgress(value: unknown): value is OnboardingReadingProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.stepId === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(entry.stepId) && typeof entry.completed === 'boolean';
}

function decodeProgress(encoded: string | null): OnboardingProgress {
  let raw: unknown;
  try { raw = JSON.parse(encoded || '{}'); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const progress: OnboardingProgress = {};
  for (const area of areas) {
    const entry = (raw as Record<string, unknown>)[area];
    if (isReadingProgress(entry)) progress[area] = { stepId: entry.stepId, completed: entry.completed };
  }
  return progress;
}

export function readOnboardingProgress(key: string, storage?: Pick<ProgressStorage, 'getItem'>): OnboardingProgress {
  if (!key) return {};
  try { return decodeProgress((storage ?? window.localStorage).getItem(`${key}:reading:v1`)); }
  catch { return {}; }
}

/** Merge the latest catalog so reading one area never removes another area's progress. */
export function writeOnboardingProgress(key: string, area: string, entry: OnboardingReadingProgress, storage?: ProgressStorage): boolean {
  if (!key || !areas.includes(area) || !isReadingProgress(entry)) return false;
  try {
    const target = storage ?? window.localStorage;
    // A blocked read is different from empty or malformed data: preserving an
    // unknown decision requires aborting before any write can replace it.
    const progress = decodeProgress(target.getItem(`${key}:reading:v1`));
    progress[area] = { stepId: entry.stepId, completed: Boolean(entry.completed || progress[area]?.completed) };
    const encoded = JSON.stringify(progress);
    target.setItem(`${key}:reading:v1`, encoded);
    return target.getItem(`${key}:reading:v1`) === encoded;
  } catch { return false; }
}
