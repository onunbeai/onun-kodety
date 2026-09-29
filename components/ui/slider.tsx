'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  label?: React.ReactNode;
  unit?: React.ReactNode;
  inputValue?: string | number;
  onInputValueChange?: (value: string) => void;
  onInputFocus?: React.FocusEventHandler<HTMLInputElement>;
  onInputBlur?: React.FocusEventHandler<HTMLInputElement>;
  showValueInput?: boolean;
  action?: React.ReactNode;
};

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  orientation = 'horizontal',
  label,
  unit,
  inputValue,
  onInputValueChange,
  onInputFocus,
  onInputBlur,
  showValueInput = true,
  action,
  onValueChange,
  onValueCommit,
  disabled,
  'aria-label': ariaLabel,
  ...props
}: SliderProps) {
  const controlled = Array.isArray(value);
  const initialValues = React.useMemo(
    () => Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min],
    [defaultValue, min, value],
  );
  const [internalValues, setInternalValues] = React.useState(initialValues);
  const externalValueKey = controlled ? value.join('\u001f') : '';
  const lastExternalValueKeyRef = React.useRef(externalValueKey);

  React.useLayoutEffect(() => {
    if (!controlled || externalValueKey === lastExternalValueKeyRef.current) return;
    lastExternalValueKeyRef.current = externalValueKey;
    setInternalValues(value);
  }, [controlled, externalValueKey, value]);

  // Keep the thumb and value local while the parent performs canvas/style
  // updates. The controlled value still reconciles whenever it truly changes.
  const values = internalValues;
  const currentValue = Number(values[0] ?? min);
  const resolvedInputValue = inputValue ?? currentValue;
  const [draftValue, setDraftValue] = React.useState(String(resolvedInputValue));
  const inputFocusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!inputFocusedRef.current) setDraftValue(String(resolvedInputValue));
  }, [resolvedInputValue]);

  const publishValues = React.useCallback((next: number[]) => {
    setInternalValues(next);
    if (!inputFocusedRef.current && inputValue === undefined && next.length === 1) {
      setDraftValue(String(next[0]));
    }
    React.startTransition(() => onValueChange?.(next));
  }, [inputValue, onValueChange]);

  const clampValue = React.useCallback((raw: number) => Math.min(max, Math.max(min, raw)), [max, min]);

  const updateFromInput = (nextDraft: string) => {
    setDraftValue(nextDraft);
    if (onInputValueChange) {
      onInputValueChange(nextDraft);
      return;
    }
    const parsed = Number(nextDraft.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    publishValues([clampValue(parsed), ...values.slice(1)]);
  };

  const commitInput = () => {
    if (onInputValueChange) {
      onValueCommit?.(values);
      return;
    }
    const parsed = Number(draftValue.replace(',', '.'));
    const committed = Number.isFinite(parsed) ? clampValue(parsed) : currentValue;
    const next = [committed, ...values.slice(1)];
    setDraftValue(String(committed));
    publishValues(next);
    onValueCommit?.(next);
  };

  const root = (
    <SliderPrimitive.Root
      data-slot="slider"
      value={values}
      min={min}
      max={max}
      step={step}
      orientation={orientation}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={publishValues}
      onValueCommit={onValueCommit}
      className={cn(
        'relative flex touch-none items-center select-none data-[disabled]:opacity-50',
        orientation === 'horizontal' ? 'h-full min-w-0 flex-1 cursor-ew-resize py-0.5 pl-0.5 pr-1.5' : 'h-full min-h-44 w-auto flex-col',
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          'relative grow overflow-hidden rounded-[6px]',
          orientation === 'horizontal' ? 'h-full w-full' : 'h-full w-1.5 bg-white/[.08]',
        )}
        style={orientation === 'horizontal' ? {
          backgroundImage: 'radial-gradient(circle at center, rgb(245 245 245 / 0.22) 1.2px, transparent 1.35px)',
          backgroundPosition: 'center',
          backgroundSize: '11px 100%',
        } : undefined}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            'absolute rounded-[6px] bg-[var(--kodety-accent)]/[.62]',
            orientation === 'horizontal' ? 'h-full' : 'w-full',
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className={cn(
            "relative block shrink-0 cursor-ew-resize border-0 bg-white/60 shadow-none outline-none transition-[background-color,box-shadow] after:absolute after:-inset-2 after:content-[''] hover:bg-white focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[var(--kodety-focus)]/35 disabled:cursor-not-allowed",
            orientation === 'horizontal' ? 'h-4 w-[2px] rounded-full' : 'size-2.5 rounded-full',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );

  if (orientation === 'vertical') return <div className={className}>{root}</div>;

  return (
    <div
      data-slot="slider-control"
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'flex h-8 w-full min-w-0 items-center overflow-hidden rounded-lg border border-transparent bg-input text-xs text-foreground transition-colors focus-within:border-ring',
        className,
      )}
    >
      {label !== undefined && (
        <span className="flex h-full max-w-[42%] shrink-0 items-center truncate bg-white/[.045] px-2 text-[10px] text-muted-foreground">
          {label}
        </span>
      )}
      {root}
      {showValueInput && values.length === 1 && (
        <label className="flex h-full w-[54px] shrink-0 items-center justify-end gap-0.5 px-1.5">
          <span className="sr-only">{typeof ariaLabel === 'string' ? `${ariaLabel}: valor` : 'Valor do controle'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draftValue}
            disabled={disabled}
            onChange={event => updateFromInput(event.target.value)}
            onFocus={event => {
              inputFocusedRef.current = true;
              event.currentTarget.select();
              onInputFocus?.(event);
            }}
            onBlur={event => {
              commitInput();
              inputFocusedRef.current = false;
              onInputBlur?.(event);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setDraftValue(String(resolvedInputValue));
                event.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-right text-[11px] tabular-nums text-foreground outline-none disabled:cursor-not-allowed"
          />
          {unit !== undefined && <span className="text-[9px] text-muted-foreground">{unit}</span>}
        </label>
      )}
      {action !== undefined && (
        <span className="grid h-full w-8 shrink-0 place-items-center border-l border-white/[.055] bg-black/10 text-white/42 [&>button]:grid [&>button]:size-full [&>button]:place-items-center [&>button]:rounded-none [&>button]:p-0">
          {action}
        </span>
      )}
    </div>
  );
}

export { Slider }
