'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface GapValueControlProps {
  label?: string;
  mode: 'all' | 'individual';
  value: string;
  columnGap: string;
  rowGap: string;
  onValueChange(value: string): void;
  onColumnGapChange(value: string): void;
  onRowGapChange(value: string): void;
  onModeToggle(): void;
}

type GapAxis = 'both' | 'horizontal' | 'vertical';

function AxisGlyph({ axis }: { axis: GapAxis }) {
  if (axis === 'both') {
    return (
      <span className="relative block size-4" aria-hidden="true">
        <span className="absolute left-0 top-0 size-1.5 rounded-tl-[4px] border-l border-t border-current" />
        <span className="absolute right-0 top-0 size-1.5 rounded-tr-[4px] border-r border-t border-current" />
        <span className="absolute bottom-0 left-0 size-1.5 rounded-bl-[4px] border-b border-l border-current" />
        <span className="absolute bottom-0 right-0 size-1.5 rounded-br-[4px] border-b border-r border-current" />
        <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
      </span>
    );
  }

  const horizontal = axis === 'horizontal';
  return (
    <span className="relative block size-4" aria-hidden="true">
      <span className={cn('absolute rounded-full bg-current', horizontal ? 'bottom-0 top-0 left-0 w-px' : 'left-0 right-0 top-0 h-px')} />
      <span className={cn('absolute rounded-full bg-current', horizontal ? 'bottom-0 top-0 right-0 w-px' : 'bottom-0 left-0 right-0 h-px')} />
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="absolute size-0.5 rounded-full bg-current"
          style={horizontal
            ? { left: `${5 + index * 3}px`, top: '7px' }
            : { left: '7px', top: `${5 + index * 3}px` }}
        />
      ))}
    </span>
  );
}

function GapMetric({
  axis,
  value,
  onChange,
  divided = false,
  className,
}: {
  axis: GapAxis;
  value: string;
  onChange(value: string): void;
  divided?: boolean;
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
    setIsDragging(false);
    if (scrub.moved) flushScrubValue();
    if (!scrub.moved) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const handleGapKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
        'group/gap-metric flex min-w-0 items-center gap-1.5 px-2 transition-colors hover:bg-white/[.025] focus-within:bg-white/[.03]',
        divided && 'border-t border-white/[.055]',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-5 shrink-0 touch-none select-none place-items-center text-white/35 transition-colors',
          'cursor-ew-resize group-hover/gap-metric:text-[var(--kodety-accent-hover)] group-focus-within/gap-metric:text-[var(--kodety-accent-hover)]',
          isDragging && 'text-[var(--kodety-accent-hover)]',
        )}
        role="button"
        tabIndex={-1}
        aria-label="Arraste para ajustar o espaço"
        title="Arraste para ajustar · Shift = ×10"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishScrub}
        onPointerCancel={finishScrub}
        onContextMenu={(event) => event.preventDefault()}
      >
        <AxisGlyph axis={axis} />
      </span>
      <div className="min-w-0 flex-1">
        <Input
          ref={inputRef}
          inputMode="decimal"
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleGapKeyDown}
          aria-label={axis === 'horizontal' ? 'Espaço horizontal' : axis === 'vertical' ? 'Espaço vertical' : 'Espaço entre elementos'}
          className="!h-8 !rounded-none !border-0 !bg-transparent !px-1 text-right text-[12px] tabular-nums !shadow-none focus-visible:!ring-0"
        />
      </div>
    </div>
  );
}

export function GapValueControl({
  label = 'Gap',
  mode,
  value,
  columnGap,
  rowGap,
  onValueChange,
  onColumnGapChange,
  onRowGapChange,
  onModeToggle,
}: GapValueControlProps) {
  return (
    <div
      className="grid min-w-0 grid-cols-3 items-start"
    >
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">{label}</span>
      <div
        className={cn(
          'col-span-2 grid min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]',
          mode === 'all'
            ? 'h-8 grid-cols-[minmax(0,1fr)_32px]'
            : 'h-16 grid-cols-[minmax(0,1fr)_32px] grid-rows-2',
        )}
      >
        {mode === 'all' ? (
          <GapMetric axis="both" value={value} onChange={onValueChange} />
        ) : (
          <>
            <GapMetric axis="horizontal" value={columnGap} onChange={onColumnGapChange} className="col-start-1 row-start-1" />
            <GapMetric axis="vertical" value={rowGap} onChange={onRowGapChange} divided className="col-start-1 row-start-2" />
          </>
        )}
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onModeToggle();
          }}
          aria-label={mode === 'all' ? 'Separar espaços horizontal e vertical' : 'Vincular espaços horizontal e vertical'}
          title={mode === 'all' ? 'Separar eixos' : 'Vincular eixos'}
          className={cn(
            'grid h-full w-8 place-items-center border-y-0 border-l border-r-0 border-white/[.055] bg-black/10 p-0 text-white/40 outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-accent-hover)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)]',
            mode === 'individual' && 'col-start-2 row-span-2 row-start-1',
          )}
        >
          <Icon name={mode === 'all' ? 'link' : 'detach'} className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
