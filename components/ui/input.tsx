import * as React from 'react'

import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'

interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: 'xs' | 'sm';
  variant?: 'default' | 'rename' | 'rename-selected';
  stepper?: boolean;
  onStepperChange?: (value: string) => void;
  /**
   * Disable the implicit ArrowUp/ArrowDown numeric-stepping behavior.
   * Use for text-only inputs (e.g. search fields) where pressing arrow keys
   * should be left to the parent for navigation/highlighting instead of
   * incrementing the value.
   */
  disableKeyboardStep?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({
  className,
  type,
  size = 'xs',
  variant = 'default',
  onKeyDown,
  value,
  onChange,
  stepper = false,
  onStepperChange,
  disableKeyboardStep = false,
  min,
  max,
  step = '1',
  ...props
}, forwardedRef) {
  const internalRef = React.useRef<HTMLInputElement>(null);
  const setInputRef = React.useCallback((node: HTMLInputElement | null) => {
    internalRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const sizeClasses = {
    xs: 'h-8 text-xs px-2.5 py-1 rounded-lg',
    sm: 'h-10 text-sm px-3 py-1.5 rounded-xl',
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Only handle arrow keys for numeric inputs
    if (
      !disableKeyboardStep
      && (type === 'number' || stepper)
      && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      const currentValue = typeof value === 'string' ? value : String(value || '');

      // Check if the value is a valid number or empty (treat empty as 0)
      const numValue = currentValue === '' ? 0 : parseFloat(currentValue);
      if (!isNaN(numValue) && isFinite(numValue)) {
        e.preventDefault();

        const baseStep = Number(step) || 1;
        const increment = e.shiftKey ? baseStep * 10 : baseStep;
        let newValue = e.key === 'ArrowUp'
          ? numValue + increment
          : numValue - increment;

        // Respect min/max constraints
        if (min !== undefined) {
          const minValue = Number(min);
          if (!isNaN(minValue)) {
            newValue = Math.max(newValue, minValue);
          }
        }
        if (max !== undefined) {
          const maxValue = Number(max);
          if (!isNaN(maxValue)) {
            newValue = Math.min(newValue, maxValue);
          }
        }

        // Create a synthetic event to trigger onChange
        if (internalRef.current && onChange) {
          const inputElement = internalRef.current;
          // Set the value on the input element
          inputElement.value = String(newValue);

          // Create event with the input element as both target and currentTarget
          const syntheticEvent = {
            target: inputElement,
            currentTarget: inputElement,
          } as unknown as React.ChangeEvent<HTMLInputElement>;

          onChange(syntheticEvent);
        }
        return;
      }
    }

    // Call original onKeyDown if provided
    onKeyDown?.(e);
  };

  const commitValue = (next: number) => {
    const stringValue = String(next);
    if (onStepperChange) {
      onStepperChange(stringValue);
    } else if (onChange && internalRef.current) {
      const inputElement = internalRef.current;
      inputElement.value = stringValue;
      const syntheticEvent = {
        target: inputElement,
        currentTarget: inputElement,
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      onChange(syntheticEvent);
    }
  };

  const clamp = (next: number) => {
    let result = next;
    if (min !== undefined && min !== '' && !isNaN(Number(min))) result = Math.max(result, Number(min));
    if (max !== undefined && max !== '' && !isNaN(Number(max))) result = Math.min(result, Number(max));
    return result;
  };

  const stepValue = Number(step) || 1;
  const handleIncrement = () => commitValue(clamp((Number(value) || 0) + stepValue));
  const handleDecrement = () => commitValue(clamp((Number(value) || 0) - stepValue));

  // Framer-style vertical scrub: press the stepper and drag up/down to change the
  // value continuously. A tiny movement threshold keeps a plain click working as
  // a single step. Applies to every numeric field that uses the stepper (padding,
  // border radius, sizing, …).
  const scrubRef = React.useRef<{ startY: number; startValue: number } | null>(null);
  const scrubMovedRef = React.useRef(false);
  const handleScrubDown = (e: React.PointerEvent<HTMLElement>) => {
    if (props.disabled) return;
    e.preventDefault();
    scrubRef.current = { startY: e.clientY, startValue: parseFloat(String(value ?? '')) || 0 };
    scrubMovedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleScrubMove = (e: React.PointerEvent<HTMLElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    const delta = scrub.startY - e.clientY;
    if (!scrubMovedRef.current && Math.abs(delta) < 3) return;
    scrubMovedRef.current = true;
    const stepValue = Number(step) || 1;
    const magnitude = e.shiftKey ? stepValue * 10 : stepValue;
    commitValue(clamp(scrub.startValue + Math.round(delta / 2) * magnitude));
  };
  const handleScrubUp = (e: React.PointerEvent<HTMLElement>) => {
    scrubRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const stepWithoutScrub = (action: () => void) => {
    if (scrubMovedRef.current) { scrubMovedRef.current = false; return; }
    action();
  };

  if (stepper) {
    return (
      <div className="group relative w-full">
        <input
          ref={setInputRef}
          type={type}
          data-slot="input"
          data-size={size}
          data-variant={variant}
          min={min}
          max={max}
          step={step}
          className={cn(
            'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-transparent border-border/70 w-full min-w-0 border transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[0px]',
            '',
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            sizeClasses[size],
            stepper && !props.disabled && 'pr-8',
            className
          )}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          {...props}
        />
        {!props.disabled && (
          <div
            aria-hidden="true"
            className="absolute right-px top-px bottom-px items-center rounded-r-[10px] hidden group-hover:flex group-focus-within:flex px-1.5 cursor-ns-resize touch-none select-none"
            title="Arraste para cima/baixo para ajustar (Shift = ×10)"
            onPointerDown={handleScrubDown}
            onPointerMove={handleScrubMove}
            onPointerUp={handleScrubUp}
            onPointerCancel={handleScrubUp}
          >
            <div className="flex flex-col -gap-px">
              <span
                className="p-0 opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => stepWithoutScrub(handleIncrement)}
              >
                <Icon name="chevronUp" className="size-2.5" />
              </span>
              <span
                className="p-0 opacity-50 hover:opacity-100 transition-opacity cursor-pointer -mt-0.5"
                onClick={() => stepWithoutScrub(handleDecrement)}
              >
                <Icon name="chevronDown" className="size-2.5" />
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  const variantClasses = {
    default: cn(
      'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-transparent border-border/70 w-full min-w-0 border transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[0px]',
      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
      '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
      sizeClasses[size],
    ),
    rename: 'bg-black/5 dark:bg-white/10 rounded px-1 py-0.5 outline-none min-w-0 text-xs font-medium text-foreground placeholder:text-muted-foreground',
    'rename-selected': 'bg-white/20 rounded px-1 py-0.5 outline-none min-w-0 text-xs font-medium text-white placeholder:text-white/40',
  };

  return (
    <input
      ref={setInputRef}
      type={type}
      data-slot="input"
      data-size={size}
      data-variant={variant}
      min={min}
      max={max}
      step={type === 'number' || type === 'range' ? step : undefined}
      className={cn(variantClasses[variant], className)}
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
});

export { Input }
