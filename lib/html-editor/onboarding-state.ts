/** A refusal is permanent unless the user explicitly reopens a tour in the UI. */
export type OnboardingPreference = 'unseen' | 'offered' | 'started' | 'completed' | 'dismissed';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type TourStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface OnboardingTourIntent {
  tourId: string;
  destination: string;
}

const KEY_PREFIX = 'kodety:onboarding:';
const TOUR_TTL_MS = 2 * 60 * 1000;
const preferenceMemory = new Map<string, OnboardingPreference>();
const preferenceRank: Record<OnboardingPreference, number> = {
  unseen: 0,
  offered: 1,
  started: 2,
  completed: 3,
  dismissed: 4,
};

function isPreference(value: unknown): value is OnboardingPreference {
  return typeof value === 'string' && Object.hasOwn(preferenceRank, value);
}

/**
 * Site and user identity are deliberately independent of projects, nonces, and
 * guide versions. User 0 is reserved for an explicitly anonymous/local runtime.
 */
export function createOnboardingStorageKey(siteUrl: string, userId: number): string {
  if (!Number.isSafeInteger(userId) || userId < 0) return '';
  try {
    const site = new URL(siteUrl);
    if (site.protocol !== 'https:' && site.protocol !== 'http:') return '';
    const identity = `${site.origin}${site.pathname.replace(/\/+$/, '')}`;
    return `${KEY_PREFIX}${encodeURIComponent(identity)}:user:${userId}`;
  } catch {
    return '';
  }
}

/** Never allow a stale tab or a manual replay to undo a refusal. */
export function resolveOnboardingPreference(
  localPreference: unknown,
  serverPreference: unknown,
): OnboardingPreference | null {
  const local = isPreference(localPreference) ? localPreference : null;
  const server = isPreference(serverPreference) ? serverPreference : null;
  if (!local) return server;
  if (!server) return local;
  return preferenceRank[local] >= preferenceRank[server] ? local : server;
}

function rememberPreference(key: string, value: OnboardingPreference | null) {
  const resolved = resolveOnboardingPreference(preferenceMemory.get(key), value);
  // Knowing only "unseen" is insufficient when storage later becomes blocked.
  if (resolved && resolved !== 'unseen') preferenceMemory.set(key, resolved);
  return resolved;
}

/**
 * Only an explicit `unseen` result permits an automatic invitation. `null`
 * means the preference could not be established, so callers must stay quiet.
 */
export function readOnboardingPreference(
  key: string,
  serverPreference?: unknown,
  storage?: Pick<PreferenceStorage, 'getItem'>,
): OnboardingPreference | null {
  if (!key) return null;
  let local: OnboardingPreference | null = null;
  let localReadable = false;
  try {
    const stored = (storage ?? window.localStorage).getItem(key);
    local = stored === null ? 'unseen' : isPreference(stored) ? stored : null;
    localReadable = local !== null;
  } catch {
    // Privacy mode, blocked access, or SSR must never repeatedly invite a user.
  }
  const resolved = rememberPreference(key, resolveOnboardingPreference(local, serverPreference));
  if (resolved && resolved !== 'unseen') return resolved;
  if (!localReadable || (serverPreference !== undefined && !isPreference(serverPreference))) return null;
  return 'unseen';
}

/** Returns true only after the final preference was verified in durable storage. */
export function writeOnboardingPreference(
  key: string,
  preference: OnboardingPreference,
  storage?: PreferenceStorage,
): boolean {
  if (!key || !isPreference(preference)) return false;
  let targetStorage: PreferenceStorage | undefined;
  let storedPreference: unknown;
  let localReadable = false;
  try {
    targetStorage = storage ?? window.localStorage;
    storedPreference = targetStorage.getItem(key);
    localReadable = true;
  } catch {
    // Keep the decision for future mounts even if browser storage is unavailable.
  }
  const resolved = rememberPreference(key, resolveOnboardingPreference(storedPreference, preference)) ?? preference;
  try {
    if (!targetStorage || !localReadable) return false;
    targetStorage.setItem(key, resolved);
    return targetStorage.getItem(key) === resolved;
  } catch {
    return false;
  }
}

function siteFromKey(key: string): URL | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const match = /^(.+):user:(\d+)$/.exec(key.slice(KEY_PREFIX.length));
  if (!match) return null;
  try {
    return new URL(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function normalizeDestination(key: string, destination: string): string | null {
  const site = siteFromKey(key);
  if (!site || typeof destination !== 'string' || !destination.trim()) return null;
  try {
    const url = new URL(destination, `${site.href.replace(/\/$/, '')}/`);
    if (url.origin !== site.origin || url.username || url.password) return null;
    // The editor lease is transport metadata, not a workspace selection. Some
    // read-only destinations do not consume it before mounting their guide.
    url.searchParams.delete('kodety_editor_handoff');
    // Parameter order does not change the route; other values and hash do.
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

function isTourId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
}

/** Queue only an explicit user action immediately before navigating to its route. */
export function queueOnboardingTour(
  key: string,
  intent: OnboardingTourIntent,
  storage?: TourStorage,
): boolean {
  const destination = normalizeDestination(key, intent.destination);
  if (!destination || !isTourId(intent.tourId)) return false;
  try {
    const targetStorage = storage ?? window.sessionStorage;
    const value = JSON.stringify({ tourId: intent.tourId, destination, createdAt: Date.now() });
    targetStorage.setItem(`${key}:pending-tour`, value);
    return targetStorage.getItem(`${key}:pending-tour`) === value;
  } catch {
    return false;
  }
}

/**
 * Consume once, even for expired, invalid, or mismatched destinations. A later
 * reload or unrelated route cannot unexpectedly revive a previously queued tour.
 */
export function consumeOnboardingTour(
  key: string,
  currentUrl: string,
  storage?: TourStorage,
): OnboardingTourIntent | null {
  if (!key) return null;
  try {
    const targetStorage = storage ?? window.sessionStorage;
    const storageKey = `${key}:pending-tour`;
    const raw = targetStorage.getItem(storageKey);
    if (raw === null) return null;
    targetStorage.removeItem(storageKey);
    // Without confirmed removal, replay after a reload cannot be ruled out.
    if (targetStorage.getItem(storageKey) !== null) return null;
    const intent: unknown = JSON.parse(raw);
    if (!intent || typeof intent !== 'object') return null;
    const candidate = intent as Record<string, unknown>;
    if (!isTourId(candidate.tourId) || typeof candidate.destination !== 'string' || typeof candidate.createdAt !== 'number') return null;
    const age = Date.now() - candidate.createdAt;
    if (!Number.isFinite(age) || age < 0 || age >= TOUR_TTL_MS) return null;
    const destination = normalizeDestination(key, candidate.destination);
    if (!destination || normalizeDestination(key, currentUrl) !== destination) return null;
    return { tourId: candidate.tourId, destination };
  } catch {
    return null;
  }
}

export function clearOnboardingTour(key: string, storage?: Pick<TourStorage, 'removeItem'>): void {
  if (!key) return;
  try {
    (storage ?? window.sessionStorage).removeItem(`${key}:pending-tour`);
  } catch {
    // A queued tour is never required for regular navigation or manual replay.
  }
}
