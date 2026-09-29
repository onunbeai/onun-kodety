'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Minus, Plus } from '@/components/ui/gravity-icons';
import { cn } from '@/lib/utils';

interface GridValueControlProps {
  columns: string;
  rows: string;
  onColumnsChange(value: string): void;
  onRowsChange(value: string): void;
}

type GridAxis = 'columns' | 'rows';

const MIN_TRACKS = 1;
const MAX_TRACKS = 24;

function clampTracks(value: number) {
  return Math.min(MAX_TRACKS, Math.max(MIN_TRACKS, value));
}

function GridTrackGlyph({ axis }: { axis: GridAxis }) {
  return (
    <span aria-hidden="true" className="relative block size-4 rounded-[4px] border border-current opacity-90">
      {[1, 2].map(index => (
        <span
          key={index}
          className={cn(
            'absolute bg-current opacity-70',
            axis === 'columns'
              ? 'bottom-[2px] top-[2px] w-px'
              : 'left-[2px] right-[2px] h-px',
          )}
          style={axis === 'columns' ? { left: `${index * 33.333}%` } : { top: `${index * 33.333}%` }}
        />
      ))}
    </span>
  );
}

function GridTrackMetric({
  axis,
  value,
  onChange,
  divided = false,
}: {
  axis: GridAxis;
  value: string;
  onChange(value: string): void;
  divided?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrubRef = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const label = axis === 'columns' ? 'Columns' : 'Rows';

  const numericValue = () => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? clampTracks(parsed) : MIN_TRACKS;
  };

  const stepValue = (delta: number) => {
    onChange(String(clampTracks(numericValue() + delta)));
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    scrubRef.current = { startX: event.clientX, startValue: numericValue(), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    const delta = event.clientX - scrub.startX;
    if (!scrub.moved && Math.abs(delta) < 3) return;
    if (!scrub.moved) {
      scrub.moved = true;
      setDragging(true);
    }
    onChange(String(clampTracks(scrub.startValue + Math.round(delta / 10))));
  };

  const finishScrub = (event: PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    if (!scrub.moved) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    stepValue(event.key === 'ArrowUp' ? 1 : -1);
  };

  return (
    <div
      className={cn(
        'group/grid-track grid h-8 min-w-0 grid-cols-[28px_minmax(0,1fr)_24px_36px_24px] items-center transition-colors hover:bg-white/[.025] focus-within:bg-white/[.03]',
        divided && 'border-t border-white/[.055]',
      )}
      data-grid-axis={axis}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Arraste para ajustar ${label.toLowerCase()}`}
        title={`${label} · arraste para ajustar`}
        className={cn(
          'grid size-7 touch-none select-none place-items-center text-white/34 outline-none transition-colors hover:text-[var(--kodety-accent-hover)]',
          dragging && 'text-[var(--kodety-accent-hover)]',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishScrub}
        onPointerCancel={finishScrub}
      >
        <GridTrackGlyph axis={axis} />
      </button>
      <span className="min-w-0 truncate text-[10px] text-white/46">{label}</span>
      <button
        type="button"
        aria-label={`Diminuir ${label.toLowerCase()}`}
        className="grid size-6 place-items-center border-l border-white/[.045] text-white/30 outline-none transition-colors hover:bg-white/[.05] hover:text-white/65 focus-visible:text-[var(--kodety-accent-hover)]"
        onPointerDown={event => event.stopPropagation()}
        onClick={() => stepValue(-1)}
      >
        <Minus className="size-2.5" />
      </button>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        aria-label={`Número de ${label.toLowerCase()}`}
        value={value}
        placeholder="1"
        className="h-full min-w-0 border-x border-white/[.045] bg-transparent px-1 text-center text-[11px] tabular-nums text-foreground outline-none placeholder:text-white/30"
        onChange={event => {
          const next = event.target.value;
          if (next === '' || /^\d{1,2}$/.test(next)) onChange(next);
        }}
        onBlur={() => {
          if (!value || numericValue() !== Number.parseInt(value, 10)) onChange(String(numericValue()));
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        aria-label={`Aumentar ${label.toLowerCase()}`}
        className="grid size-6 place-items-center text-white/30 outline-none transition-colors hover:bg-white/[.05] hover:text-white/65 focus-visible:text-[var(--kodety-accent-hover)]"
        onPointerDown={event => event.stopPropagation()}
        onClick={() => stepValue(1)}
      >
        <Plus className="size-2.5" />
      </button>
    </div>
  );
}

export function GridValueControl({
  columns,
  rows,
  onColumnsChange,
  onRowsChange,
}: GridValueControlProps) {
  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">Grid</span>
      <div
        className="col-span-2 h-16 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.055]"
        onPointerDown={event => event.stopPropagation()}
      >
        <GridTrackMetric axis="columns" value={columns} onChange={onColumnsChange} />
        <GridTrackMetric axis="rows" value={rows} onChange={onRowsChange} divided />
      </div>
    </div>
  );
}
