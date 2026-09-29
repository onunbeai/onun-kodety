'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

interface BorderWidthValueControlProps {
  mode: 'all' | 'individual';
  value: string;
  top: string;
  right: string;
  bottom: string;
  left: string;
  onValueChange(value: string): void;
  onTopChange(value: string): void;
  onRightChange(value: string): void;
  onBottomChange(value: string): void;
  onLeftChange(value: string): void;
  onModeToggle(): void;
}

type BorderSide = 'all' | 'top' | 'right' | 'bottom' | 'left';

function BorderWidthGlyph({ side }: { side: BorderSide }) {
  if (side === 'all') {
    return (
      <span aria-hidden="true" className="relative block size-4 rounded-[4px] border border-current">
        <span className="absolute inset-[3px] rounded-[2px] border border-current opacity-45" />
      </span>
    );
  }

  const sideClass: Record<Exclude<BorderSide, 'all'>, string> = {
    top: 'left-[2px] right-[2px] top-[2px] h-px',
    right: 'bottom-[2px] right-[2px] top-[2px] w-px',
    bottom: 'bottom-[2px] left-[2px] right-[2px] h-px',
    left: 'bottom-[2px] left-[2px] top-[2px] w-px',
  };

  return (
    <span aria-hidden="true" className="relative block size-4 rounded-[4px] border border-current/25">
      <span className={cn('absolute bg-current', sideClass[side])} />
    </span>
  );
}

function BorderWidthMetric({
  side,
  value,
  onChange,
  className,
}: {
  side: BorderSide;
  value: string;
  onChange(value: string): void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrubRef = useRef<{ startX: number; startValue: number; suffix: string; moved: boolean } | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);
  const lastRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const label = side === 'all' ? 'Border width' : `${side} border width`;

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const scheduleValue = (next: string) => {
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

  const flushValue = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) onChange(pending);
  };

  const handlePointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/);
    scrubRef.current = {
      startX: event.clientX,
      startValue: match ? Number.parseFloat(match[1]) : 0,
      suffix: match?.[2] || '',
      moved: false,
    };
    lastRef.current = value;
    pendingRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    const delta = event.clientX - scrub.startX;
    if (!scrub.moved && Math.abs(delta) < 3) return;
    if (!scrub.moved) {
      scrub.moved = true;
      setDragging(true);
    }
    const multiplier = event.shiftKey ? 10 : 1;
    const next = Math.max(0, scrub.startValue + Math.round(delta / 2) * multiplier);
    scheduleValue(`${next}${scrub.suffix}`);
  };

  const finishScrub = (event: PointerEvent<HTMLSpanElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (scrub.moved) {
      flushValue();
      setDragging(false);
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/);
    if (!match) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const current = Number.parseFloat(match[1]);
    const next = Math.max(0, current + (event.key === 'ArrowUp' ? amount : -amount));
    onChange(`${next}${match[2] || ''}`);
  };

  return (
    <div className={cn('group/border-width flex min-w-0 items-center gap-1.5 transition-colors', className)}>
      <span
        role="button"
        tabIndex={-1}
        aria-label={`Arraste para ajustar ${label.toLowerCase()}`}
        title={`${label} · arraste para ajustar · Shift = ×10`}
        className={cn(
          'grid size-5 shrink-0 cursor-ew-resize touch-none select-none place-items-center text-white/32 outline-none transition-colors',
          'group-hover/border-width:text-[var(--kodety-accent-hover)] group-focus-within/border-width:text-[var(--kodety-accent-hover)]',
          dragging && 'text-[var(--kodety-accent-hover)]',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishScrub}
        onPointerCancel={finishScrub}
        onContextMenu={event => event.preventDefault()}
      >
        <BorderWidthGlyph side={side} />
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        aria-label={label}
        placeholder="0"
        className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 text-center text-[11px] tabular-nums text-foreground outline-none placeholder:text-muted-foreground"
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

export function BorderWidthValueControl({
  mode,
  value,
  top,
  right,
  bottom,
  left,
  onValueChange,
  onTopChange,
  onRightChange,
  onBottomChange,
  onLeftChange,
  onModeToggle,
}: BorderWidthValueControlProps) {
  const sides = [
    { side: 'top', value: top, onChange: onTopChange },
    { side: 'right', value: right, onChange: onRightChange },
    { side: 'left', value: left, onChange: onLeftChange },
    { side: 'bottom', value: bottom, onChange: onBottomChange },
  ] as const;

  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">Width</span>
      {mode === 'all' ? (
        <div className="col-span-2 grid h-8 min-w-0 grid-cols-[minmax(0,1fr)_32px] overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]">
          <BorderWidthMetric
            side="all"
            value={value}
            onChange={onValueChange}
            className="px-2 [&_input]:pr-1 [&_input]:text-right [&_input]:text-[12px]"
          />
          <button
            type="button"
            title="Editar lados individualmente"
            aria-label="Editar lados individualmente"
            className="grid h-full w-8 place-items-center border-0 bg-black/10 p-0 text-white/40 outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-accent-hover)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)]"
            onPointerDown={event => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={event => {
              event.stopPropagation();
              onModeToggle();
            }}
          >
            <Icon name="individualBorders" className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative col-span-2 grid h-16 min-w-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.055]">
          {sides.map((item, index) => (
            <BorderWidthMetric
              key={item.side}
              side={item.side}
              value={item.value}
              onChange={item.onChange}
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
            title="Usar a mesma largura em todos os lados"
            aria-label="Usar a mesma largura em todos os lados"
            className="absolute left-1/2 top-1/2 z-10 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[7px] border border-white/[.065] bg-[#191919] p-0 text-white/42 outline-none transition-[color,background-color,border-color] hover:border-[var(--kodety-focus)]/45 hover:bg-[#242424] hover:text-[var(--kodety-accent-hover)] focus-visible:border-[var(--kodety-focus)]/55 focus-visible:bg-[#242424] focus-visible:text-[var(--kodety-accent-hover)]"
            onPointerDown={event => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={event => {
              event.stopPropagation();
              onModeToggle();
            }}
          >
            <Icon name="borders" className="size-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}
