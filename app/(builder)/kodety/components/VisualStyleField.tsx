'use client';

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, ChevronDown } from '@/components/ui/gravity-icons';
import { cn } from '@/lib/utils';

export type VisualStyleGlyph =
  | 'width'
  | 'height'
  | 'min-width'
  | 'max-width'
  | 'min-height'
  | 'max-height'
  | 'font-size'
  | 'font-weight'
  | 'font-style'
  | 'letter-spacing'
  | 'line-height'
  | 'columns'
  | 'rows'
  | 'grid'
  | 'hidden'
  | 'align-start'
  | 'align-center'
  | 'align-end'
  | 'align-stretch'
  | 'justify-start'
  | 'justify-center'
  | 'justify-end'
  | 'justify-between'
  | 'justify-around'
  | 'justify-evenly'
  | 'wrap'
  | 'nowrap'
  | 'overflow-visible'
  | 'overflow-hidden'
  | 'overflow-scroll'
  | 'overflow-ellipsis'
  | 'overflow-auto'
  | 'fit-contain'
  | 'fit-cover'
  | 'fit-fill'
  | 'fit-none'
  | 'fit-scale-down'
  | 'image-size'
  | 'image-position'
  | 'image-repeat'
  | 'text-transform'
  | 'line-clamp'
  | 'value'
  | 'opacity'
  | 'scale'
  | 'repeat'
  | 'stagger'
  | 'curve'
  | 'rotate'
  | 'duration'
  | 'delay'
  | 'move-x'
  | 'move-y'
  | 'skew-x'
  | 'skew-y'
  | 'position-static'
  | 'position-relative'
  | 'position-absolute'
  | 'position-sticky'
  | 'position-fixed';

export interface VisualStyleOption {
  value: string;
  label: string;
  glyph?: VisualStyleGlyph;
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
}

function VisualGlyph({ kind, className }: { kind: VisualStyleGlyph; className?: string }) {
  if (kind === 'value') {
    return (
      <span aria-hidden="true" className={cn('relative flex size-4 items-center justify-center gap-[2px]', className)}>
        <span className="size-[2px] rounded-full bg-current" />
        <span className="size-[2px] rounded-full bg-current" />
        <span className="size-[2px] rounded-full bg-current" />
      </span>
    );
  }
  if (kind === 'opacity') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', className)}>
        <path d="M8 2.25S3.75 6.7 3.75 9.35a4.25 4.25 0 1 0 8.5 0C12.25 6.7 8 2.25 8 2.25Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M8 3v10.5a4.1 4.1 0 0 1 0-10.5Z" fill="currentColor" opacity=".38" />
      </svg>
    );
  }
  if (kind === 'scale') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', className)}>
        <path d="M6.25 3H3v3.25M9.75 3H13v3.25M6.25 13H3V9.75M9.75 13H13V9.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m3.4 3.4 3 3M12.6 3.4l-3 3M3.4 12.6l3-3M12.6 12.6l-3-3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".55" />
      </svg>
    );
  }
  if (kind === 'repeat') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', className)}>
        <path d="M12.6 6A4.9 4.9 0 0 0 4 4.6L2.7 6M3.4 10A4.9 4.9 0 0 0 12 11.4l1.3-1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M2.7 3.8V6h2.2M13.3 12.2V10h-2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'stagger') {
    return (
      <span aria-hidden="true" className={cn('flex size-4 items-center justify-center gap-[2px]', className)}>
        <span className="h-1 w-[2px] rounded-full bg-current opacity-45" />
        <span className="h-2 w-[2px] rounded-full bg-current opacity-70" />
        <span className="h-3 w-[2px] rounded-full bg-current" />
      </span>
    );
  }
  if (kind === 'curve') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', className)}>
        <path d="M2.5 12.5c3.25 0 3-9 11-9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <circle cx="2.5" cy="12.5" r="1" fill="currentColor" /><circle cx="13.5" cy="3.5" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'rotate') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', className)}>
        <path d="M12.7 5.1A5.25 5.25 0 1 0 13 9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M10.3 4.7h2.8V1.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'duration' || kind === 'delay') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', className)}>
        <circle cx="8" cy="8.5" r="4.75" stroke="currentColor" strokeWidth="1.25" />
        <path d="M8 5.5v3l2 1.25M6.5 2h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        {kind === 'delay' && <path d="M2 8.5h1.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />}
      </svg>
    );
  }
  if (kind === 'move-x' || kind === 'move-y') {
    const vertical = kind === 'move-y';
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', vertical && 'rotate-90', className)}>
        <path d="M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5 13.5 8 11 10.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'skew-x' || kind === 'skew-y') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={cn('size-4', kind === 'skew-y' && 'rotate-90', className)}>
        <path d="M4 3.5h8l-2 9H2l2-9Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'font-size') {
    return <span aria-hidden="true" className={cn('text-[13px] font-medium leading-none', className)}>A</span>;
  }
  if (kind === 'font-weight') {
    return <span aria-hidden="true" className={cn('text-[12px] font-bold leading-none', className)}>B</span>;
  }
  if (kind === 'font-style') {
    return <span aria-hidden="true" className={cn('text-[12px] italic leading-none', className)}>I</span>;
  }
  if (kind === 'text-transform') {
    return <span aria-hidden="true" className={cn('text-[9px] font-semibold leading-none', className)}>Aa</span>;
  }
  if (kind === 'line-clamp') {
    return (
      <span aria-hidden="true" className={cn('grid w-4 gap-[2px]', className)}>
        <span className="h-px w-full bg-current" />
        <span className="h-px w-full bg-current" />
        <span className="h-px w-2/3 bg-current" />
      </span>
    );
  }
  if (kind === 'letter-spacing') {
    return (
      <span aria-hidden="true" className={cn('relative flex w-4 items-center justify-between text-[7px] font-medium leading-none', className)}>
        <span>A</span><span>A</span>
        <span className="absolute inset-x-[5px] top-1/2 h-px bg-current opacity-65" />
      </span>
    );
  }
  if (kind === 'line-height') {
    return (
      <span aria-hidden="true" className={cn('relative grid w-4 gap-[3px]', className)}>
        <span className="h-px w-full bg-current" />
        <span className="h-px w-full bg-current" />
        <span className="absolute -left-[1px] inset-y-0 w-px bg-current opacity-65" />
      </span>
    );
  }
  if (kind === 'grid') {
    return (
      <span aria-hidden="true" className={cn('grid size-4 grid-cols-2 gap-[2px]', className)}>
        {Array.from({ length: 4 }, (_, index) => <span key={index} className="rounded-[1px] border border-current" />)}
      </span>
    );
  }
  if (kind.startsWith('position-')) {
    const mode = kind.slice('position-'.length);
    return (
      <span aria-hidden="true" className={cn('relative block size-4', className)}>
        <span className={cn(
          'absolute rounded-[3px] border border-current',
          mode === 'static' && 'inset-[2px]',
          mode === 'relative' && 'inset-[3px] -translate-x-[1px] translate-y-[1px]',
          mode === 'absolute' && 'inset-[4px]',
          mode === 'sticky' && 'bottom-[1px] left-[3px] right-[3px] top-[4px]',
          mode === 'fixed' && 'inset-[3px]',
        )} />
        {mode === 'relative' && <span className="absolute right-0 top-0 size-1 rounded-full bg-current" />}
        {mode === 'absolute' && <span className="absolute inset-0 rounded-[3px] border border-dashed border-current opacity-45" />}
        {mode === 'sticky' && <span className="absolute inset-x-[2px] top-[1px] h-px bg-current" />}
        {mode === 'fixed' && (
          <>
            <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-current opacity-45" />
            <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-current opacity-45" />
          </>
        )}
      </span>
    );
  }
  if (kind === 'hidden') {
    return (
      <span aria-hidden="true" className={cn('relative block size-4 rounded-[3px] border border-current', className)}>
        <span className="absolute left-[1px] top-1/2 h-px w-[13px] -translate-y-1/2 rotate-[-45deg] bg-current" />
      </span>
    );
  }
  if (kind.startsWith('align-')) {
    const position = kind === 'align-start' ? 'top-[2px]' : kind === 'align-end' ? 'bottom-[2px]' : 'top-1/2 -translate-y-1/2';
    return (
      <span aria-hidden="true" className={cn('relative block size-4 border-y border-current/60', className)}>
        {kind === 'align-stretch' ? (
          <span className="absolute inset-x-[3px] inset-y-[2px] rounded-[1px] border border-current" />
        ) : (
          <span className={cn('absolute left-[3px] right-[3px] h-[3px] rounded-[1px] bg-current', position)} />
        )}
      </span>
    );
  }
  if (kind.startsWith('justify-')) {
    const variant = kind.slice('justify-'.length);
    const layout = variant === 'start'
      ? 'justify-start'
      : variant === 'end'
        ? 'justify-end'
        : variant === 'center'
          ? 'justify-center'
          : variant === 'between'
            ? 'justify-between'
            : variant === 'around'
              ? 'justify-around'
              : 'justify-evenly';
    return (
      <span aria-hidden="true" className={cn('flex h-4 w-4 items-center border-x border-current/50', layout, className)}>
        <span className="h-2.5 w-[2px] rounded-full bg-current" />
        <span className="h-2.5 w-[2px] rounded-full bg-current" />
      </span>
    );
  }
  if (kind === 'wrap' || kind === 'nowrap') {
    return (
      <span aria-hidden="true" className={cn('relative block h-3.5 w-4', className)}>
        <span className={cn('absolute left-0 top-[2px] h-px bg-current', kind === 'wrap' ? 'w-3' : 'w-4')} />
        <span className={cn('absolute h-px bg-current', kind === 'wrap' ? 'bottom-[2px] left-0 w-2.5' : 'left-0 top-[7px] w-4')} />
        {kind === 'wrap' && <span className="absolute right-0 top-[2px] h-[7px] w-px border-r border-b border-current" />}
      </span>
    );
  }
  if (kind === 'overflow-visible' || kind === 'overflow-hidden' || kind === 'overflow-scroll' || kind === 'overflow-ellipsis' || kind === 'overflow-auto') {
    return (
      <span aria-hidden="true" className={cn('relative block size-4 rounded-[3px] border border-current', className)}>
        {kind === 'overflow-visible' && <span className="absolute -right-1 top-[3px] h-1.5 w-2 rounded-[1px] bg-current opacity-70" />}
        {kind === 'overflow-hidden' && <span className="absolute inset-[3px] rounded-[1px] bg-current opacity-55" />}
        {kind === 'overflow-scroll' && <span className="absolute bottom-[2px] right-[2px] top-[2px] w-px rounded-full bg-current" />}
        {kind === 'overflow-ellipsis' && <span className="absolute inset-x-[2px] top-[5px] text-center text-[8px] font-bold leading-none">…</span>}
        {kind === 'overflow-auto' && <span className="absolute inset-[3px] rounded-full border border-current opacity-70" />}
      </span>
    );
  }
  if (kind.startsWith('fit-')) {
    const innerClass = kind === 'fit-cover'
      ? '-inset-[1px]'
      : kind === 'fit-fill'
        ? 'inset-[2px]'
        : kind === 'fit-scale-down'
          ? 'inset-[4px]'
          : kind === 'fit-none'
            ? 'left-[5px] top-[5px] size-1.5'
            : 'inset-[3px]';
    return (
      <span aria-hidden="true" className={cn('relative block size-4 overflow-hidden rounded-[3px] border border-current', className)}>
        <span className={cn('absolute rounded-[2px] bg-current opacity-55', innerClass)} />
      </span>
    );
  }
  if (kind === 'image-size') {
    return <VisualGlyph kind="fit-cover" className={className} />;
  }
  if (kind === 'image-position') {
    return (
      <span aria-hidden="true" className={cn('relative block size-4 rounded-[3px] border border-current', className)}>
        <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
      </span>
    );
  }
  if (kind === 'image-repeat') {
    return (
      <span aria-hidden="true" className={cn('grid size-4 grid-cols-2 gap-[2px]', className)}>
        {Array.from({ length: 4 }, (_, index) => <span key={index} className="rounded-[1px] border border-current" />)}
      </span>
    );
  }

  const vertical = kind === 'height' || kind === 'min-height' || kind === 'max-height' || kind === 'rows';
  const isMin = kind === 'min-width' || kind === 'min-height';
  const isMax = kind === 'max-width' || kind === 'max-height';
  return (
    <span aria-hidden="true" className={cn('relative block size-4', className)}>
      <span className={cn(
        'absolute rounded-full bg-current opacity-75',
        vertical ? 'left-1/2 top-[2px] h-3 w-px -translate-x-1/2' : 'left-[2px] top-1/2 h-px w-3 -translate-y-1/2',
      )} />
      <span className={cn(
        'absolute border-current opacity-90',
        vertical ? 'inset-x-[3px] top-[1px] border-t' : 'inset-y-[3px] left-[1px] border-l',
        isMin && (vertical ? 'bottom-[5px] top-auto' : 'left-auto right-[5px]'),
      )} />
      <span className={cn(
        'absolute border-current opacity-90',
        vertical ? 'bottom-[1px] inset-x-[3px] border-b' : 'right-[1px] inset-y-[3px] border-r',
        isMax && (vertical ? 'bottom-auto top-[5px]' : 'left-[5px] right-auto'),
      )} />
    </span>
  );
}

function useScrubValue({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: string;
  onChange(value: string): void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrubRef = useRef<{
    startX: number;
    startY: number;
    startValue: number;
    suffix: string;
    precision: number;
    moved: boolean;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);
  const lastRef = useRef(value);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const clamp = (number: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, number));
  const schedule = (next: string) => {
    if (lastRef.current === next) return;
    lastRef.current = next;
    pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) onChange(pending);
    });
  };
  const flush = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) onChange(pending);
  };
  const parse = () => value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/);
  const precisionFor = (numericValue?: string) => {
    const valuePrecision = numericValue?.split('.')[1]?.length || 0;
    const stepPrecision = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
    return Math.max(valuePrecision, stepPrecision);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const match = parse();
    if (!match && value.trim()) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    scrubRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startValue: match ? Number.parseFloat(match[1]) : 0,
      suffix: match?.[2] || '',
      precision: precisionFor(match?.[1]),
      moved: false,
    };
    lastRef.current = value;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    const dx = event.clientX - scrub.startX;
    const dy = scrub.startY - event.clientY;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    if (!scrub.moved && Math.abs(delta) < 3) return;
    scrub.moved = true;
    setDragging(true);
    const multiplier = event.shiftKey ? 10 : 1;
    const next = clamp(scrub.startValue + Math.round(delta / 2) * step * multiplier);
    schedule(`${Number(next.toFixed(scrub.precision))}${scrub.suffix}`);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    if (scrub.moved) flush();
    else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const match = parse();
    if (!match) return;
    event.preventDefault();
    const current = Number.parseFloat(match[1]);
    if (!Number.isFinite(current)) return;
    const amount = step * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    onChange(`${Number(clamp(current + amount).toFixed(precisionFor(match[1])))}${match[2] || ''}`);
  };

  return { inputRef, dragging, onPointerDown, onPointerMove, finish, onKeyDown };
}

function PresetMenu({
  value,
  options,
  onValueChange,
  compact = false,
}: {
  value?: string;
  options?: VisualStyleOption[];
  onValueChange?(value: string): void;
  compact?: boolean;
}) {
  if (!options?.length || !onValueChange) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onPointerDown={event => event.stopPropagation()}
          data-visual-preset
          className={cn(
            'grid h-full shrink-0 place-items-center border-0 border-l border-white/[.055] bg-black/10 text-white/35 outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-accent-hover)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)] data-[state=open]:bg-white/[.07] data-[state=open]:text-[var(--kodety-accent-hover)]',
            compact ? 'w-5' : 'w-8',
          )}
          aria-label="Escolher valor predefinido"
        >
          <ChevronDown className={compact ? 'size-2.5' : 'size-3'} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-ycode-native-ui align="end" className="min-w-36 rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-none">
        {options.map(option => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onValueChange(option.value)}
            disabled={option.disabled}
            className="min-h-8 rounded-[6px] px-2 text-[10px]"
          >
            {option.glyph && <VisualGlyph kind={option.glyph} className="size-3.5 text-white/45" />}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {value === option.value && <Check className="size-3 text-[var(--kodety-accent-hover)]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MetricSlot({
  glyph,
  icon,
  value,
  onChange,
  ariaLabel,
  placeholder = '0',
  min,
  max,
  step,
  options,
  presetValue,
  onPresetChange,
  property,
  compactPreset,
  compact = false,
  constraint = false,
  suffix,
  action,
  actionClassName,
  className,
  inputMode = 'decimal',
}: {
  glyph: VisualStyleGlyph;
  icon?: ReactNode;
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: VisualStyleOption[];
  presetValue?: string;
  onPresetChange?(value: string): void;
  property?: string;
  compactPreset?: boolean;
  compact?: boolean;
  constraint?: boolean;
  suffix?: ReactNode;
  action?: ReactNode;
  actionClassName?: string;
  className?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
}) {
  const scrub = useScrubValue({ value, onChange, min, max, step });
  return (
    <div
      data-design-token-control
      data-design-token-property={property}
      data-visual-dimension-constraint={constraint || undefined}
      className={cn('kodety-visual-style-control group/visual-metric relative flex h-full min-w-0 items-center bg-transparent transition-colors hover:bg-white/[.025] focus-within:bg-white/[.03]', className)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            className={cn(
              'grid h-full shrink-0 touch-none select-none place-items-center border-0 bg-transparent text-white/32 outline-none transition-colors cursor-ew-resize group-hover/visual-metric:text-[var(--kodety-accent-hover)] group-focus-within/visual-metric:text-[var(--kodety-accent-hover)]',
              compact || constraint ? 'w-6' : 'w-8',
              scrub.dragging && 'text-[var(--kodety-accent-hover)]',
            )}
            aria-label={`Arraste para ajustar ${ariaLabel.toLowerCase()}`}
            onPointerDown={scrub.onPointerDown}
            onPointerMove={scrub.onPointerMove}
            onPointerUp={scrub.finish}
            onPointerCancel={scrub.finish}
            onContextMenu={event => event.preventDefault()}
          >
            {icon || <VisualGlyph kind={glyph} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{ariaLabel} · arraste para ajustar</TooltipContent>
      </Tooltip>
      <input
        ref={scrub.inputRef}
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={event => onChange(event.target.value)}
        onKeyDown={scrub.onKeyDown}
        className={cn(
          'h-full min-w-0 flex-1 appearance-none border-0 bg-transparent text-[11px] tabular-nums text-foreground outline-none placeholder:text-muted-foreground/65',
          compact
            ? 'px-0.5 text-center'
            : constraint
              ? 'px-0 text-left'
              : 'pl-1 pr-2.5 text-right',
        )}
      />
      {suffix && (
        <span className={cn(
          'pointer-events-none shrink-0 text-[9px] font-medium text-white/32',
          compact ? 'px-1' : 'px-2',
        )}>
          {suffix}
        </span>
      )}
      <PresetMenu value={presetValue} options={options} onValueChange={onPresetChange} compact={compactPreset} />
      {action && (
        <span className={cn(
          'grid h-full w-8 shrink-0 place-items-center border-l border-white/[.055] text-white/42 [&>button]:flex [&>button]:size-full [&>button]:items-center [&>button]:justify-center [&>button]:whitespace-nowrap [&>button]:rounded-none [&>button]:p-0',
          actionClassName,
        )}>
          {action}
        </span>
      )}
    </div>
  );
}

export function VisualMeasurementControl({
  glyph,
  value,
  onChange,
  ariaLabel,
  placeholder,
  min,
  max,
  step,
  property,
  icon,
  suffix,
  action,
  actionClassName,
  inputMode,
  compact,
  className,
}: {
  glyph: VisualStyleGlyph;
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  property?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  action?: ReactNode;
  actionClassName?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]',
        className,
      )}
      onPointerDown={event => event.stopPropagation()}
    >
      <MetricSlot
        glyph={glyph}
        icon={icon}
        value={value}
        onChange={onChange}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        property={property}
        compact={compact}
        suffix={suffix}
        action={action}
        actionClassName={actionClassName}
        inputMode={inputMode}
      />
    </div>
  );
}

export function VisualMeasurementField({
  label,
  glyph,
  value,
  onChange,
  ariaLabel = label,
  placeholder,
  min,
  max,
  step,
  options,
  presetValue,
  onPresetChange,
  property,
  icon,
  suffix,
  action,
  actionClassName,
}: {
  label: string;
  glyph: VisualStyleGlyph;
  value: string;
  onChange(value: string): void;
  ariaLabel?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: VisualStyleOption[];
  presetValue?: string;
  onPresetChange?(value: string): void;
  property?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  action?: ReactNode;
  actionClassName?: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">{label}</span>
      <div className="col-span-2 flex h-8 min-w-0 items-center">
        <div
          className="h-8 min-w-0 flex-1 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]"
          onPointerDown={event => event.stopPropagation()}
        >
          <MetricSlot
            glyph={glyph}
            icon={icon}
            value={value}
            onChange={onChange}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            min={min}
            max={max}
            step={step}
            options={options}
            presetValue={presetValue}
            onPresetChange={onPresetChange}
            property={property}
            suffix={suffix}
            action={action}
            actionClassName={actionClassName}
          />
        </div>
      </div>
    </div>
  );
}

export function VisualDimensionField({
  label,
  axis,
  value,
  minValue,
  maxValue,
  onValueChange,
  onMinChange,
  onMaxChange,
  presets,
  minPresets = presets,
  maxPresets = presets,
  presetValue,
  minPresetValue,
  maxPresetValue,
  onPresetChange,
  onMinPresetChange,
  onMaxPresetChange,
  properties,
  icons,
}: {
  label: string;
  axis: 'width' | 'height';
  value: string;
  minValue: string;
  maxValue: string;
  onValueChange(value: string): void;
  onMinChange(value: string): void;
  onMaxChange(value: string): void;
  presets: VisualStyleOption[];
  minPresets?: VisualStyleOption[];
  maxPresets?: VisualStyleOption[];
  presetValue?: string;
  minPresetValue?: string;
  maxPresetValue?: string;
  onPresetChange(value: string): void;
  onMinPresetChange(value: string): void;
  onMaxPresetChange(value: string): void;
  properties?: { value?: string; min?: string; max?: string };
  icons?: { value?: ReactNode; min?: ReactNode; max?: ReactNode };
}) {
  const vertical = axis === 'height';
  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">{label}</span>
      <div
        className="kodety-visual-dimension__surface col-span-2 grid h-16 min-w-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.055]"
        onPointerDown={event => event.stopPropagation()}
      >
        <MetricSlot
          glyph={axis}
          icon={icons?.value}
          value={value}
          onChange={onValueChange}
          ariaLabel={label}
          options={presets}
          presetValue={presetValue}
          onPresetChange={onPresetChange}
          property={properties?.value}
          className="col-span-2 border-b border-white/[.055] [&_input]:pr-2.5"
        />
        <MetricSlot
          glyph={vertical ? 'min-height' : 'min-width'}
          icon={icons?.min}
          value={minValue}
          onChange={onMinChange}
          ariaLabel={`Mínimo de ${label.toLowerCase()}`}
          placeholder="Min"
          options={minPresets}
          presetValue={minPresetValue}
          onPresetChange={onMinPresetChange}
          property={properties?.min}
          compactPreset
          constraint
          className="border-r border-white/[.055]"
        />
        <MetricSlot
          glyph={vertical ? 'max-height' : 'max-width'}
          icon={icons?.max}
          value={maxValue}
          onChange={onMaxChange}
          ariaLabel={`Máximo de ${label.toLowerCase()}`}
          placeholder="Max"
          options={maxPresets}
          presetValue={maxPresetValue}
          onPresetChange={onMaxPresetChange}
          property={properties?.max}
          compactPreset
          constraint
        />
      </div>
    </div>
  );
}

export function VisualMetricPairField({
  label,
  first,
  second,
}: {
  label: string;
  first: {
    glyph: VisualStyleGlyph;
    icon?: ReactNode;
    value: string;
    onChange(value: string): void;
    ariaLabel: string;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
    property?: string;
    suffix?: ReactNode;
  };
  second: {
    glyph: VisualStyleGlyph;
    icon?: ReactNode;
    value: string;
    onChange(value: string): void;
    ariaLabel: string;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
    property?: string;
    suffix?: ReactNode;
    action?: ReactNode;
  };
}) {
  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">{label}</span>
      <div
        className="col-span-2 grid h-8 min-w-0 grid-cols-2 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.055]"
        onPointerDown={event => event.stopPropagation()}
      >
        <MetricSlot {...first} className="border-r border-white/[.055] [&_input]:text-left" />
        <MetricSlot {...second} className="[&_input]:text-left" />
      </div>
    </div>
  );
}

export function VisualSelectControl({
  value,
  options,
  onValueChange,
  glyph,
  ariaLabel,
  property,
  className,
  contentClassName,
  contentDataDesignTokenUi = false,
}: {
  value: string;
  options: VisualStyleOption[];
  onValueChange(value: string): void;
  glyph?: VisualStyleGlyph;
  ariaLabel: string;
  property?: string;
  className?: string;
  contentClassName?: string;
  contentDataDesignTokenUi?: boolean;
}) {
  const selected = options.find(option => option.value === value);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onPointerDown={event => event.stopPropagation()}
          aria-label={ariaLabel}
          data-design-token-control
          data-design-token-property={property}
          title={selected?.label || value || ariaLabel}
          className={cn(
            'group/visual-select flex h-8 w-full min-w-0 items-center overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] px-2 text-left text-[11px] text-foreground outline-none transition-[border-color,background-color] hover:bg-white/[.065] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:bg-white/[.065] data-[state=open]:border-[var(--kodety-focus)]/65 data-[state=open]:bg-white/[.065]',
            className,
          )}
        >
          {(selected?.icon || glyph || selected?.glyph) && (
            <span className="mr-2 grid size-4 shrink-0 place-items-center text-white/38 transition-colors group-hover/visual-select:text-white/55 group-data-[state=open]/visual-select:text-[var(--kodety-accent-hover)]">
              {selected?.icon || <VisualGlyph kind={(glyph || selected?.glyph)!} />}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{selected?.label || value || 'Choose...'}</span>
          <ChevronDown className="ml-2 size-3 shrink-0 text-white/32" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-ycode-native-ui
        data-design-token-ui={contentDataDesignTokenUi || undefined}
        align="end"
        className={cn(
          'z-[110] min-w-44 rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-none',
          contentClassName,
        )}
      >
        {options.map(option => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onValueChange(option.value)}
            disabled={option.disabled}
            className="min-h-9 rounded-[6px] px-2 text-[10px]"
          >
            {option.icon || (option.glyph && <VisualGlyph kind={option.glyph} className="size-3.5 text-white/42" />)}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block truncate text-[9px] text-white/45" title={option.description}>
                  {option.description}
                </span>
              )}
            </span>
            {value === option.value && <Check className="size-3 text-[var(--kodety-accent-hover)]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VisualSelectField(props: Parameters<typeof VisualSelectControl>[0] & { label: string; action?: ReactNode }) {
  const { label, action, ...controlProps } = props;
  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">{label}</span>
      {action ? (
        <div
          className="kodety-visual-style-control col-span-2 flex h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]"
          data-design-token-control
          data-design-token-property={controlProps.property}
          onPointerDown={event => event.stopPropagation()}
        >
          <VisualSelectControl
            {...controlProps}
            className={cn('min-w-0 flex-1 !rounded-none !border-transparent !bg-transparent focus-visible:!border-transparent data-[state=open]:!border-transparent', controlProps.className)}
          />
          <span className="grid h-full w-8 shrink-0 place-items-center border-l border-white/[.055] text-white/42 [&>button]:grid [&>button]:size-full [&>button]:place-items-center [&>button]:rounded-none [&>button]:p-0">
            {action}
          </span>
        </div>
      ) : (
        <div className="col-span-2 flex min-w-0 items-center">
          <VisualSelectControl {...controlProps} className={cn('min-w-0 flex-1', controlProps.className)} />
        </div>
      )}
    </div>
  );
}

export function VisualSegmentedField({
  label,
  value,
  options,
  onValueChange,
  property,
  glyphClassName,
}: {
  label: string;
  value: string;
  options: VisualStyleOption[];
  onValueChange(value: string): void;
  property?: string;
  glyphClassName?: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">{label}</span>
      <div
        className="kodety-visual-style-control col-span-2 grid h-8 min-w-0 gap-0.5 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] p-0.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        data-design-token-control
        data-design-token-property={property}
      >
        {options.map(option => {
          const selected = value === option.value;
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onPointerDown={event => event.stopPropagation()}
                  aria-label={option.label}
                  aria-pressed={selected}
                  disabled={option.disabled}
                  onClick={() => onValueChange(option.value)}
                  className={cn(
                    'grid min-w-0 place-items-center rounded-[6px] border-0 bg-transparent text-white/38 outline-none transition-[background-color,color] hover:bg-white/[.055] hover:text-white/70 focus-visible:bg-white/[.07] focus-visible:text-white disabled:pointer-events-none disabled:opacity-30',
                    selected && 'bg-white/[.13] text-white shadow-none',
                  )}
                >
                  {option.icon ? (
                    <span className={cn('grid place-items-center', glyphClassName)}>{option.icon}</span>
                  ) : option.glyph ? (
                    <VisualGlyph kind={option.glyph} className={glyphClassName} />
                  ) : (
                    <span className="truncate px-1 text-[11px]">{option.label}</span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{option.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function VisualPropertySurface({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-[8px] border border-transparent bg-white/[.05]', className)}>{children}</div>;
}
