'use client';

import { useRef } from 'react';
import { BookBookmarkIcon } from '@solar-icons/react/bold-duotone/book-bookmark';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { openBuilderOnboarding } from '@/lib/html-editor/onboarding-events';

export function useOnboardingMenuLaunch() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requested = useRef(false);
  return {
    triggerRef,
    requestOnboarding: () => { requested.current = true; },
    onCloseAutoFocus: (event: Event) => {
      if (!requested.current) return;
      requested.current = false;
      // Open after Radix releases the menu, so its autofocus cannot steal the guide's focus.
      event.preventDefault();
      triggerRef.current?.focus({ preventScroll: true });
      openBuilderOnboarding();
    },
  };
}

export function HtmlOnboardingMenuItem({ onRequest }: { onRequest: () => void }) {
  return (
    <DropdownMenuItem onSelect={onRequest}>
      <BookBookmarkIcon aria-hidden="true" focusable="false" /> Onboarding
    </DropdownMenuItem>
  );
}
