import * as React from 'react'

import { cn } from '@/lib/utils'
import { Icon } from './icon'

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
  const inputRef = internalRef;
  const setInputRef = React.useCallback((node: HTMLInputElement | null) => {
    internalRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const sizeClasses = {
    xs: 'h-8 text-xs px-2 py-1 rounded-lg',
    sm: 'h-10 text-sm px-3 py-1.5 rounded-xl',
  };

  const emitStep = (direction: 1 | -1, multiplier = 1, preferStepper = false) => {
    if (props.disabled || props.readOnly) return false;
    const currentValue = String(value ?? inputRef.current?.value ?? '').trim();
    // Keep CSS units intact; expressions and partial drafts stay editable.
    const numeric = currentValue.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([%a-z]*)$/i);
    if (currentValue && !numeric) return false;
    const amount = Number(numeric?.[1] || 0);
    if (!Number.isFinite(amount)) return false;
    const requestedStep = Number(step);
    const increment = Number.isFinite(requestedStep) && requestedStep > 0 ? requestedStep : 1;
    let next = amount + direction * increment * multiplier;
    const lower = min === undefined || min === '' ? -Infinity : Number(min);
    const upper = max === undefined || max === '' ? Infinity : Number(max);
    if (Number.isFinite(lower)) next = Math.max(next, lower);
    if (Number.isFinite(upper)) next = Math.min(next, upper);
    // Decimal stepping should not persist binary floating-point tails.
    next = Number(next.toPrecision(15));
    const nextValue = `${Object.is(next, -0) ? 0 : next}${numeric?.[2] || ''}`;
    const inputElement = inputRef.current;
    if (inputElement) inputElement.value = nextValue;
    if (preferStepper && onStepperChange) onStepperChange(nextValue);
    else if (onChange && inputElement) {
      onChange({ target: inputElement, currentTarget: inputElement } as React.ChangeEvent<HTMLInputElement>);
    } else if (onStepperChange) onStepperChange(nextValue);
    return true;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disableKeyboardStep || event.nativeEvent.isComposing) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (emitStep(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1)) {
      event.preventDefault();
    }
  };

  const handleIncrement = () => { emitStep(1, 1, true); };
  const handleDecrement = () => { emitStep(-1, 1, true); };

  if (stepper) {
    return (
      <div className="group relative w-full">
        <input
          ref={setInputRef}
          type={type}
          data-slot="input"
          min={min}
          max={max}
          step={step}
          className={cn(
            'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-input border-transparent w-full min-w-0 border transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-0',
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
        {!props.disabled && !props.readOnly && (
          <div className="absolute right-px top-px bottom-px items-center rounded-r-[10px] hidden group-hover:flex px-1.5">
            <div className="flex flex-col -gap-px">
              <button
                type="button"
                tabIndex={-1}
                className="p-0 opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
                aria-label="Aumentar valor"
                onMouseDown={event => event.preventDefault()}
                onClick={handleIncrement}
              >
                <Icon name="chevronUp" className="size-2.5" />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="p-0 opacity-50 hover:opacity-100 transition-opacity cursor-pointer -mt-0.5"
                aria-label="Diminuir valor"
                onMouseDown={event => event.preventDefault()}
                onClick={handleDecrement}
              >
                <Icon name="chevronDown" className="size-2.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const variantClasses = {
    default: cn(
      'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-input border-transparent w-full min-w-0 border transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:cursor-not-allowed disabled:opacity-50',
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
      min={min}
      max={max}
      step={step}
      className={cn(variantClasses[variant], className)}
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
});

export { Input }
