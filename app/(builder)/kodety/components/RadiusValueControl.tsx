'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export interface RadiusDesignTokenProperties {
  all?: string;
}

export interface RadiusValueControlProps {
  label?: string;
  mode: 'all' | 'individual';
  value: string;
  topLeft: string;
  topRight: string;
  bottomRight: string;
  bottomLeft: string;
  onValueChange(value: string): void;
  onTopLeftChange(value: string): void;
  onTopRightChange(value: string): void;
  onBottomRightChange(value: string): void;
  onBottomLeftChange(value: string): void;
  onModeToggle(): void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  designTokenProperties?: RadiusDesignTokenProperties;
}

type RadiusCorner = 'all' | 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

function RadiusGlyph({ corner }: { corner: RadiusCorner }) {
  if (corner === 'all') {
    return (
      <span className="relative block size-4" aria-hidden="true">
        <span className="absolute inset-0 rounded-[5px] border border-current" />
        <span className="absolute inset-[5px] rounded-[2px] bg-current" />
      </span>
    );
  }

  const cornerClass: Record<Exclude<RadiusCorner, 'all'>, string> = {
    topLeft: 'left-0 top-0 rounded-tl-[6px] border-l border-t',
    topRight: 'right-0 top-0 rounded-tr-[6px] border-r border-t',
    bottomRight: 'bottom-0 right-0 rounded-br-[6px] border-b border-r',
    bottomLeft: 'bottom-0 left-0 rounded-bl-[6px] border-b border-l',
  };

  return (
    <span className="relative block size-4" aria-hidden="true">
      <span className={cn('absolute size-3', cornerClass[corner])} />
      <span className="absolute left-1/2 top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current opacity-70" />
    </span>
  );
}

function RadiusMetric({
  corner,
  ariaLabel,
  value,
  onChange,
  onFocus,
  onBlur,
  designTokenProperty,
  className,
}: {
  corner: RadiusCorner;
  ariaLabel: string;
  value: string;
  onChange(value: string): void;
  onFocus?: () => void;
  onBlur?: () => void;
  designTokenProperty?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrubRef = useRef<{
    startX: number;
    startY: number;
    startValue: number;
    suffix: string;
    moved: boolean;
  } | null>(null);
  const scrubFrameRef = useRef<number | null>(null);
  const pendingScrubValueRef = useRef<string | null>(null);
  const lastScrubValueRef = useRef(value);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => {
    if (scrubFrameRef.current !== null) cancelAnimationFrame(scrubFrameRef.current);
  }, []);

  const scheduleScrubValue = (next: string) => {
    if (lastScrubValueRef.current === next) return;
    lastScrubValueRef.current = next;
    pendingScrubValueRef.current = next;
    if (scrubFrameRef.current !== null) return;
    scrubFrameRef.current = requestAnimationFrame(() => {
      scrubFrameRef.current = null;
      const pending = pendingScrubValueRef.current;
      pendingScrubValueRef.current = null;
      if (pending !== null) onChange(pending);
    });
  };

  const flushScrubValue = () => {
    if (scrubFrameRef.current !== null) {
      cancelAnimationFrame(scrubFrameRef.current);
      scrubFrameRef.current = null;
    }
    const pending = pendingScrubValueRef.current;
    pendingScrubValueRef.current = null;
    if (pending !== null) onChange(pending);
  };

  const handlePointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/);
    event.preventDefault();
    event.stopPropagation();
    scrubRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startValue: match ? Number.parseFloat(match[1]) : 0,
      suffix: match?.[2] || '',
      moved: false,
    };
    lastScrubValueRef.current = value;
    pendingScrubValueRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    const deltaX = event.clientX - scrub.startX;
    const deltaY = scrub.startY - event.clientY;
    const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
    if (!scrub.moved && Math.abs(delta) < 3) return;
    if (!scrub.moved) {
      scrub.moved = true;
      setIsDragging(true);
    }
    const multiplier = event.shiftKey ? 10 : 1;
    const next = Math.max(0, scrub.startValue + Math.round(delta / 2) * multiplier);
    scheduleScrubValue(`${next}${scrub.suffix}`);
  };

  const finishScrub = (event: PointerEvent<HTMLSpanElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (scrub.moved) {
      flushScrubValue();
      setIsDragging(false);
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handleRadiusKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/);
    if (!match) return;
    event.preventDefault();
    const current = Number.parseFloat(match[1]);
    if (!Number.isFinite(current)) return;
    const amount = event.shiftKey ? 10 : 1;
    const next = Math.max(0, current + (event.key === 'ArrowUp' ? amount : -amount));
    onChange(`${next}${match[2] || ''}`);
  };

  return (
    <div
      className={cn(
        'group/radius-metric flex min-w-0 items-center gap-1.5 transition-colors',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-5 shrink-0 touch-none select-none place-items-center text-white/32 outline-none transition-colors',
          'cursor-ew-resize group-hover/radius-metric:text-[var(--kodety-accent-hover)] group-focus-within/radius-metric:text-[var(--kodety-accent-hover)]',
          isDragging && 'text-[var(--kodety-accent-hover)]',
        )}
        role="button"
        tabIndex={-1}
        aria-label={`Arraste para ajustar ${ariaLabel.toLowerCase()}`}
        title="Arraste para ajustar · Shift = ×10"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishScrub}
        onPointerCancel={finishScrub}
        onContextMenu={(event) => event.preventDefault()}
      >
        <RadiusGlyph corner={corner} />
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        data-design-token-property={designTokenProperty}
        className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 text-center text-[11px] tabular-nums text-foreground outline-none placeholder:text-muted-foreground"
        value={value}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleRadiusKeyDown}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
      />
    </div>
  );
}

export function RadiusValueControl({
  label = 'Radius',
  mode,
  value,
  topLeft,
  topRight,
  bottomRight,
  bottomLeft,
  onValueChange,
  onTopLeftChange,
  onTopRightChange,
  onBottomRightChange,
  onBottomLeftChange,
  onModeToggle,
  onInteractionStart,
  onInteractionEnd,
  designTokenProperties,
}: RadiusValueControlProps) {
  const selectMode = (nextMode: RadiusValueControlProps['mode']) => {
    if (nextMode === mode) return;
    onInteractionStart?.();
    onModeToggle();
    onInteractionEnd?.();
  };
  const corners = [
    {
      key: 'topLeft',
      label: 'TL',
      ariaLabel: `${label} superior esquerdo`,
      value: topLeft,
      onChange: onTopLeftChange,
    },
    {
      key: 'topRight',
      label: 'TR',
      ariaLabel: `${label} superior direito`,
      value: topRight,
      onChange: onTopRightChange,
    },
    {
      key: 'bottomLeft',
      label: 'BL',
      ariaLabel: `${label} inferior esquerdo`,
      value: bottomLeft,
      onChange: onBottomLeftChange,
    },
    {
      key: 'bottomRight',
      label: 'BR',
      ariaLabel: `${label} inferior direito`,
      value: bottomRight,
      onChange: onBottomRightChange,
    },
  ] as const;

  return (
    <div
      className="kodety-radius-control grid min-w-0 grid-cols-3 items-start"
    >
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">{label}</span>
      {mode === 'all' ? (
        <div
          data-kodety-radius-field
          className="col-span-2 grid h-8 min-w-0 grid-cols-[minmax(0,1fr)_32px] overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]"
        >
          <RadiusMetric
            corner="all"
            ariaLabel={`${label} em todos os cantos`}
            value={value}
            onChange={onValueChange}
            onFocus={onInteractionStart}
            onBlur={onInteractionEnd}
            designTokenProperty={designTokenProperties?.all}
            className="px-2 [&_input]:pr-1 [&_input]:text-right [&_input]:text-[12px]"
          />
          <button
            type="button"
            className="grid h-full w-8 place-items-center border-0 bg-black/10 p-0 text-white/40 outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-accent-hover)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)]"
            title="Editar cantos individualmente"
            aria-label="Editar cantos individualmente"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              selectMode('individual');
            }}
          >
            <Icon name="individualBorders" className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative col-span-2 grid h-16 min-w-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.055]">
          {corners.map((corner, index) => (
            <RadiusMetric
              key={corner.key}
              corner={corner.key}
              ariaLabel={corner.ariaLabel}
              value={corner.value}
              onChange={corner.onChange}
              onFocus={onInteractionStart}
              onBlur={onInteractionEnd}
              className={cn(
                'bg-transparent px-1.5 hover:bg-white/[.025] focus-within:bg-white/[.03]',
                index === 0 && 'border-b border-r border-white/[.055] pr-3',
                index === 1 && 'flex-row-reverse border-b border-white/[.055] pl-3',
                index === 2 && 'border-r border-white/[.055] pr-3',
                index === 3 && 'flex-row-reverse pl-3',
              )}
            />
          ))}
          <button
            type="button"
            className="absolute left-1/2 top-1/2 z-10 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[7px] border border-white/[.065] bg-[#191919] p-0 text-white/42 outline-none transition-[color,background-color,border-color] hover:border-[var(--kodety-focus)]/45 hover:bg-[#242424] hover:text-[var(--kodety-accent-hover)] focus-visible:border-[var(--kodety-focus)]/55 focus-visible:bg-[#242424] focus-visible:text-[var(--kodety-accent-hover)]"
            title="Usar um valor em todos os cantos"
            aria-label="Usar um valor em todos os cantos"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              selectMode('all');
            }}
          >
            <Icon name="borders" className="size-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}
