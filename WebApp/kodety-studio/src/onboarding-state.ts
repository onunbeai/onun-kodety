import type { StudioProjectMode } from './project-library';

// Completion is permanent across guide revisions. Existing users can reopen
// the guide explicitly from How it works. New projects always use HTML;
// older mode preferences never alter projects already in the library.
export const WEB_ONBOARDING_KEY = "kodetyStudioWebOnboarding";
export const WEB_ONBOARDING_VERSION = 2;
// Keep the key readable by older builds, but normalize future writes to HTML.
export const WEB_DEFAULT_PROJECT_MODE_KEY = "kodetyStudioWebLastMode";

export function shouldShowWebOnboarding(
  storage?: Pick<Storage, "getItem">,
): boolean {
  try {
    const source = storage ?? localStorage;
    const version = Number(source.getItem(WEB_ONBOARDING_KEY));
    if (Number.isSafeInteger(version) && version > 0) return false;
    const previous = JSON.parse(source.getItem("kodetyStudioPreferencesV1") || "null");
    const previousVersion = previous?.onboardingVersion;
    return !Number.isSafeInteger(previousVersion) || previousVersion < 1;
  } catch {
    return true;
  }
}

export function loadDefaultProjectMode(_storage?: Pick<Storage, "getItem">): "html" {
  return "html";
}

export function rememberDefaultProjectMode(_mode: StudioProjectMode, storage?: Pick<Storage, "setItem">): void {
  (storage ?? localStorage).setItem(WEB_DEFAULT_PROJECT_MODE_KEY, "html");
}

export function completeWebOnboarding(
  storage?: Pick<Storage, "setItem">,
): void {
  (storage ?? localStorage).setItem(
    WEB_ONBOARDING_KEY,
    String(WEB_ONBOARDING_VERSION),
  );
}
