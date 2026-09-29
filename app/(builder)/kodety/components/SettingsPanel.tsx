'use client';

/**
 * Collapsible Settings Panel
 *
 * Reusable component for settings sections in the right sidebar
 */

import React from 'react';
import { Label, labelVariants } from '@/components/ui/label';
import { ChevronRight } from '@/components/ui/gravity-icons';
import { cn } from '@/lib/utils';

interface SettingsPanelProps {
  title: string;
  className?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  action?: React.ReactNode; // Optional action button (like +)
  collapsible?: boolean; // Whether to show collapse triangle icon
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
  const contentId = React.useId();
  const titleId = React.useId();
  return (
    <section
      data-slot="inspector-section"
      data-kodety-onboarding={isOpen ? onboardingId : undefined}
      className={cn('border-b border-border/70', className)}
    >
      {title && (
        <header className="flex min-h-11 w-full items-center justify-between gap-2">
          {collapsible ? (
            <button
              type="button"
              data-kodety-onboarding={onboardingId ? `${onboardingId}-disclosure` : undefined}
              data-kodety-onboarding-reveal={onboardingId ? '' : undefined}
              data-kodety-onboarding-toggle={onboardingId ? '' : undefined}
              className="group/section -ml-1 flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-controls={contentId}
            >
              <ChevronRight
                className={cn(
                  'size-3 shrink-0 text-muted-foreground/55 transition-[color,transform] duration-150 motion-reduce:transition-none group-hover/section:text-muted-foreground',
                  isOpen && 'rotate-90',
                )}
                aria-hidden="true"
              />
              <span id={titleId} className={labelVariants({ className: 'truncate text-[11px] font-semibold tracking-[-0.01em]' })}>{title}</span>
            </button>
          ) : (
            <Label id={titleId} className="text-[11px] font-semibold tracking-[-0.01em]">{title}</Label>
          )}
          <div className="flex min-h-7 shrink-0 items-center gap-0.5 [&_[data-slot=button]]:size-7 [&_[data-slot=button]]:border-transparent [&_[data-slot=button]]:bg-transparent [&_[data-slot=button]]:p-0 [&_[data-slot=button]]:text-muted-foreground [&_[data-slot=button]]:shadow-none">
            {action}
          </div>
        </header>
      )}

      {isOpen && children && (
        <div
          id={contentId}
          data-slot="inspector-section-content"
          role={title ? 'region' : undefined}
          aria-labelledby={title ? titleId : undefined}
          style={{
            '--inspector-control-label-width': 'var(--html-design-control-label-width, 88px)',
          } as React.CSSProperties}
          className={[
            'flex min-w-0 flex-col gap-2 pb-3 pt-0.5',
            '[&_.grid.grid-cols-3]:grid-cols-[var(--inspector-control-label-width)_minmax(0,1fr)]',
            '[&_.grid.grid-cols-3]:gap-x-2',
            '[&_.grid.grid-cols-3>.col-span-2]:col-span-1',
            '[&_.grid.grid-cols-3>.col-span-2]:min-w-0',
            '[&_[data-slot=label]]:min-w-0',
            '[&_[data-slot=label]]:text-[11px]',
            '[&_[data-slot=input-group]]:min-w-0',
            '[&_[data-slot=input]]:min-w-0',
            '[&_[data-slot=select-trigger]]:min-w-0',
            '[&_[data-slot=select-trigger]]:max-w-full',
          ].join(' ')}
        >
          {children}
        </div>
      )}
    </section>
  );
}
