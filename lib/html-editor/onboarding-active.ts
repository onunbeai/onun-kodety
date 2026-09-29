'use client';

import { useSyncExternalStore } from 'react';

let active = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The mounted guide controls this flag; opening a dialog never starts a tour. */
export function setBuilderOnboardingActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

export function useBuilderOnboardingActive(): boolean {
  return useSyncExternalStore(subscribe, () => active, () => false);
}

/** Keep guide controls usable without dismissing an inspected nonmodal dialog. */
export function builderOnboardingDialogProps(onboardingActive: boolean) {
  return {
    onInteractOutside(event: {
      target: EventTarget | null;
      detail?: { originalEvent?: { target: EventTarget | null } };
      preventDefault: () => void;
    }) {
      if (!onboardingActive) return;
      const target = event.detail?.originalEvent?.target ?? event.target;
      if (target instanceof Element && target.closest('[data-kodety-onboarding-ui]')) event.preventDefault();
    },
    onCloseAutoFocus(event: { preventDefault: () => void }) {
      if (onboardingActive) event.preventDefault();
    },
  };
}
