/** Small, shared bridge: menus do not import the guide or the editor runtime. */
export const OPEN_BUILDER_ONBOARDING = 'kodety:open-builder-onboarding';
export const NAVIGATE_BUILDER_ONBOARDING = 'kodety:navigate-builder-onboarding';
/** Emitted after native save guards, immediately before changing documents. */
export const BUILDER_WORKSPACE_NAVIGATION = 'kodety:builder-workspace-navigation';

export interface OnboardingNavigationDetail {
  href: string;
  resolve: (allowed: boolean) => void;
}

export function openBuilderOnboarding() {
  window.dispatchEvent(new Event(OPEN_BUILDER_ONBOARDING));
}

/** Let the Design workspace flush its exact draft before the native handoff. */
export function navigateBuilderOnboarding(href: string, fallback: (href: string) => Promise<boolean>): Promise<boolean> {
  return new Promise(resolve => {
    const event = new CustomEvent<OnboardingNavigationDetail>(NAVIGATE_BUILDER_ONBOARDING, {
      cancelable: true,
      detail: { href, resolve },
    });
    if (window.dispatchEvent(event)) void fallback(href).then(resolve, () => resolve(false));
  });
}
