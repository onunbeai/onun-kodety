'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

interface TransformOriginControlProps {
  value: string;
  onPresetChange(value: string): void;
  onInputChange(value: string): void;
}

const ORIGIN_POINTS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top', label: 'Top' },
  { value: 'top-right', label: 'Top right' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'bottom-right', label: 'Bottom right' },
] as const;

const ORIGIN_LABELS = Object.fromEntries(
  ORIGIN_POINTS.map(point => [point.value, point.label]),
) as Record<string, string>;

function normalizeOriginToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

export function TransformOriginControl({
  value,
  onPresetChange,
  onInputChange,
}: TransformOriginControlProps) {
  const [draft, setDraft] = useState(value || 'center');
  const activeToken = normalizeOriginToken(value || 'center');
  const activeLabel = ORIGIN_LABELS[activeToken] || 'Custom';

  useEffect(() => {
    setDraft(value || 'center');
  }, [value]);

  const selectPreset = (next: string) => {
    setDraft(next);
    onPresetChange(next);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 min-w-0 items-center text-[11px] text-muted-foreground">Origin</span>
      <div
        className="col-span-2 grid h-16 min-w-0 grid-cols-[64px_minmax(0,1fr)] overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.055]"
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="grid grid-cols-3 grid-rows-3 gap-0.5 border-r border-white/[.055] p-1.5">
          {ORIGIN_POINTS.map(point => {
            const active = activeToken === point.value;
            return (
              <button
                key={point.value}
                type="button"
                title={point.label}
                aria-label={`Set transform origin to ${point.label.toLowerCase()}`}
                aria-pressed={active}
                className={cn(
                  'group/origin-point grid min-h-0 min-w-0 place-items-center rounded-[4px] text-white/28 outline-none transition-[color,background-color]',
                  'hover:bg-white/[.055] hover:text-[var(--kodety-accent-hover)] focus-visible:bg-white/[.065] focus-visible:text-[var(--kodety-accent-hover)]',
                  active && 'bg-[var(--kodety-accent-muted)] text-[var(--kodety-accent-hover)]',
                )}
                onPointerDown={event => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={event => {
                  event.stopPropagation();
                  selectPreset(point.value);
                }}
              >
                <span
                  className={cn(
                    'size-1 rounded-full bg-current transition-transform',
                    active && 'scale-125 ring-2 ring-[var(--kodety-focus)]/20',
                  )}
                />
              </button>
            );
          })}
        </div>
        <label className="flex min-w-0 flex-col justify-center px-2.5">
          <span className="mb-0.5 truncate text-[9px] uppercase tracking-[0.13em] text-white/32">
            {activeLabel}
          </span>
          <input
            type="text"
            value={draft}
            aria-label="Transform origin"
            placeholder="center"
            className="h-5 min-w-0 border-0 bg-transparent p-0 text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
            onChange={event => {
              const next = event.target.value;
              setDraft(next);
              onInputChange(next);
            }}
            onKeyDown={handleInputKeyDown}
          />
        </label>
      </div>
    </div>
  );
}
