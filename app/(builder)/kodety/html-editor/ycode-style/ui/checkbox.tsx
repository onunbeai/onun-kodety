'use client';

import * as React from 'react';
import { Check } from '@/components/ui/gravity-icons';

import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean) => void;
}

function Checkbox({
  className,
  checked = false,
  onCheckedChange,
  onClick,
  disabled,
  ...props
}: CheckboxProps) {
  const active = checked === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
      data-state={active ? 'checked' : 'unchecked'}
      data-slot="checkbox"
      data-ycode-native-ui
      disabled={disabled}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) onCheckedChange?.(!active);
      }}
      className={cn(
        'peer bg-input border-transparent data-[state=checked]:bg-foreground/15 data-[state=checked]:text-foreground data-[state=checked]:border-transparent focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 cursor-pointer rounded-[4px] border outline-none transition-shadow disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {active && <span data-slot="checkbox-indicator" className="grid place-content-center text-current transition-none"><Check className="size-3.5" /></span>}
    </button>
  );
}

export { Checkbox };
