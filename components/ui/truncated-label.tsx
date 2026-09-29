'use client';

import type { ComponentProps } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface TruncatedLabelProps extends ComponentProps<typeof Label> {
  tooltip?: string;
}

/**
 * Keeps the label in its assigned grid column and exposes the complete copy on
 * hover without inserting a wrapper that could move or resize the control next
 * to it. The ellipsis is therefore presentation-only; the full accessible text
 * remains available through the tooltip and the label's own contents.
 */
export function TruncatedLabel({
  children,
  className,
  tooltip = typeof children === 'string' ? children : undefined,
  ...props
}: TruncatedLabelProps) {
  return (
    <Label
      className={cn('min-w-0 truncate', className)}
      title={tooltip}
      {...props}
    >
      {children}
    </Label>
  );
}
