'use client';

/**
 * Collapsible Settings Panel
 *
 * Reusable component for settings sections in the right sidebar
 */

import React from 'react';
import { Label } from './ui/label';
import { DisclosureChevron } from '@/components/ui/disclosure-summary';
import { cn } from '@/lib/utils';

interface SettingsPanelProps {
  title: string;
  className?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  action?: React.ReactNode; // Optional action button (like +)
  collapsible?: boolean; // Whether to show the disclosure chevron
  onboardingId?: string;
}

export default function SettingsPanel({
  title,
  className,
  isOpen,
  onToggle,
  children,
  action,
  collapsible = false,
  onboardingId,
}: SettingsPanelProps) {
  return (
    <div
      data-slot="inspector-section"
      data-kodety-onboarding={isOpen ? onboardingId : undefined}
      data-design-token-section={title?.toLowerCase()}
      className={cn('pt-5', className)}
    >
      {title && (
        <header
          className={cn(
            'relative w-full py-5 -mt-5 flex items-center justify-between gap-2',
            collapsible && 'pr-6'
          )}
        >
          {collapsible && (
            <button
              type="button"
              data-kodety-onboarding={onboardingId ? `${onboardingId}-disclosure` : undefined}
              data-kodety-onboarding-reveal={onboardingId ? '' : undefined}
              data-kodety-onboarding-toggle={onboardingId ? '' : undefined}
              aria-label={title}
              aria-expanded={isOpen}
              className="absolute inset-0 flex w-full items-center justify-end rounded-sm text-muted-foreground/55 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={onToggle}
            >
              <DisclosureChevron expanded={isOpen} className="size-3" />
            </button>
          )}
          <Label className={cn('relative min-w-0', collapsible && 'pointer-events-none')}>{title}</Label>
          <div
            className="relative z-10 ml-auto flex items-center gap-2 -my-2"
            onClick={(e) => e.stopPropagation()}
          >
            {action}
          </div>
        </header>
      )}

      {isOpen && children && (
        <div className="flex flex-col gap-2 pb-5">
          {children}
        </div>
      )}
    </div>
  );
}
