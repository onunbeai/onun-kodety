'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Check,
  ChevronDown,
  Image,
  Search,
  Upload,
  X,
} from '@/components/ui/gravity-icons';
import { cn } from '@/lib/utils';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface CursorOption {
  value: string;
  label: string;
}

interface CursorGroup {
  label: string;
  options: CursorOption[];
}

const CURSOR_GROUPS: CursorGroup[] = [
  {
    label: 'General',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'default', label: 'Default' },
      { value: 'none', label: 'None' },
    ],
  },
  {
    label: 'Links & status',
    options: [
      { value: 'pointer', label: 'Pointer' },
      { value: 'not-allowed', label: 'Not allowed' },
      { value: 'wait', label: 'Wait' },
      { value: 'progress', label: 'Progress' },
      { value: 'help', label: 'Help' },
      { value: 'context-menu', label: 'Context menu' },
    ],
  },
  {
    label: 'Selection',
    options: [
      { value: 'cell', label: 'Cell' },
      { value: 'crosshair', label: 'Crosshair' },
      { value: 'text', label: 'Text' },
      { value: 'vertical-text', label: 'Vertical text' },
    ],
  },
  {
    label: 'Drag & drop',
    options: [
      { value: 'grab', label: 'Grab' },
      { value: 'grabbing', label: 'Grabbing' },
      { value: 'alias', label: 'Alias' },
      { value: 'copy', label: 'Copy' },
      { value: 'move', label: 'Move' },
    ],
  },
  {
    label: 'Zoom',
    options: [
      { value: 'zoom-in', label: 'Zoom in' },
      { value: 'zoom-out', label: 'Zoom out' },
    ],
  },
  {
    label: 'Resize',
    options: [
      { value: 'col-resize', label: 'Column' },
      { value: 'row-resize', label: 'Row' },
      { value: 'ew-resize', label: 'Horizontal' },
      { value: 'ns-resize', label: 'Vertical' },
      { value: 'nwse-resize', label: 'NW ↔ SE' },
      { value: 'nesw-resize', label: 'NE ↔ SW' },
      { value: 'n-resize', label: 'North' },
      { value: 'e-resize', label: 'East' },
      { value: 's-resize', label: 'South' },
      { value: 'w-resize', label: 'West' },
      { value: 'ne-resize', label: 'North east' },
      { value: 'nw-resize', label: 'North west' },
      { value: 'se-resize', label: 'South east' },
      { value: 'sw-resize', label: 'South west' },
    ],
  },
];

const ALL_CURSOR_OPTIONS = CURSOR_GROUPS.flatMap(group => group.options);
const CUSTOM_CURSOR_PATTERN = /^url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)\s*(\d+)?\s*(\d+)?\s*,\s*([a-z-]+)$/i;

function readCustomCursor(value: string) {
  const match = value.trim().match(CUSTOM_CURSOR_PATTERN);
  if (!match) return null;
  return {
    url: match[1] || match[2] || match[3] || '',
    x: match[4] || '0',
    y: match[5] || '0',
    fallback: match[6] || 'auto',
  };
}

function serializeCustomCursor(url: string, x: string, y: string) {
  const safeUrl = url.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeX = Math.max(0, Math.round(Number(x) || 0));
  const safeY = Math.max(0, Math.round(Number(y) || 0));
  return `url("${safeUrl}") ${safeX} ${safeY}, auto`;
}

function CursorPreview({ option, className }: { option?: CursorOption; className?: string }) {
  const cursor = (option?.value || 'auto') as CSSProperties['cursor'];
  return <span
    aria-hidden="true"
    title={option?.label || 'Auto'}
    style={{ cursor }}
    className={cn('inline-grid size-7 shrink-0 place-items-center rounded border border-current/15 text-[10px]', className)}
  >{cursor === 'none' ? '—' : '+'}</span>;
}

interface CursorControlsProps {
  value?: string;
  onChange(value: string): void;
}

export default function CursorControls({ value = 'auto', onChange }: CursorControlsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const parsedCustom = useMemo(() => readCustomCursor(value), [value]);
  const [customMode, setCustomMode] = useState(Boolean(parsedCustom));
  const [customUrl, setCustomUrl] = useState(parsedCustom?.url || '');
  const [hotspotX, setHotspotX] = useState(parsedCustom?.x || '0');
  const [hotspotY, setHotspotY] = useState(parsedCustom?.y || '0');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!parsedCustom) return;
    setCustomUrl(parsedCustom.url);
    setHotspotX(parsedCustom.x);
    setHotspotY(parsedCustom.y);
  }, [parsedCustom]);

  const selectedOption = ALL_CURSOR_OPTIONS.find(option => option.value === value);
  const selectedLabel = parsedCustom ? 'Custom image' : selectedOption?.label || value || 'Auto';
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = CURSOR_GROUPS.map(group => ({
    ...group,
    options: group.options.filter(option => (
      !normalizedQuery || option.label.toLowerCase().includes(normalizedQuery) || option.value.includes(normalizedQuery)
    )),
  })).filter(group => group.options.length > 0);

  const selectCursor = (nextValue: string) => {
    onChange(nextValue);
    setCustomMode(false);
    setOpen(false);
  };

  const handleFile = (file?: File) => {
    if (!file || (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.cur'))) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      setCustomUrl(reader.result);
      setCustomMode(true);
    };
    reader.readAsDataURL(file);
  };

  const applyCustomCursor = () => {
    if (!customUrl.trim()) return;
    onChange(serializeCustomCursor(customUrl, hotspotX, hotspotY));
    setOpen(false);
  };

  return (
    <div className="grid min-w-0 grid-cols-3 items-start py-5" data-design-token-section="Cursor">
      <Label variant="muted" className="flex h-8 items-center">Cursor</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="kodety-visual-style-control col-span-2 flex h-8 min-w-0 items-center gap-2 rounded-[8px] border border-transparent bg-white/[.05] px-2.5 text-left text-[11px] text-white/82 outline-none transition-[border-color,background-color] hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/70"
            aria-label={`Cursor: ${selectedLabel}`}
          >
            {parsedCustom && customUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={customUrl} alt="" className="size-4 shrink-0 object-contain" />
            ) : (
              <CursorPreview option={selectedOption} className="size-4 shrink-0 text-white/65" />
            )}
            <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
            <ChevronDown className="size-3 shrink-0 text-white/35" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="left"
          sideOffset={10}
          collisionPadding={12}
          className="flex max-h-[min(680px,calc(100dvh-24px))] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[14px] border-white/[.08] bg-[var(--kodety-panel)] p-0 shadow-[0_18px_48px_rgba(0,0,0,.38)]"
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <header className="flex h-12 shrink-0 items-center border-b border-white/[.065] px-3.5">
            <span className="text-[13px] font-medium text-white">Cursor</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto grid size-7 place-items-center rounded-[7px] text-white/42 outline-none hover:bg-white/[.055] hover:text-white/80 focus-visible:text-[var(--kodety-accent-hover)]"
              aria-label="Close cursor panel"
            >
              <X className="size-3.5" />
            </button>
          </header>

          <div className="shrink-0 border-b border-white/[.055] p-3">
            <label className="flex h-9 items-center gap-2 rounded-[9px] border border-transparent bg-white/[.045] px-2.5 focus-within:border-[var(--kodety-focus)]/65">
              <Search className="size-3.5 shrink-0 text-white/35" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search cursors..."
                className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-white/30"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="text-white/35 hover:text-white/75" aria-label="Clear search">
                  <X className="size-3" />
                </button>
              )}
            </label>
          </div>

          <div className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            {!normalizedQuery && (
              <section className="mb-4">
                <p className="mb-2 px-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-white/35">Custom</p>
                <button
                  type="button"
                  onClick={() => setCustomMode(current => !current)}
                  className={cn(
                    'flex h-[74px] w-full items-center gap-3 rounded-[10px] border border-transparent bg-white/[.035] px-3 text-left outline-none transition-[border-color,background-color] hover:bg-white/[.06]',
                    (customMode || parsedCustom) && 'border-[var(--kodety-focus)]/65 bg-[var(--kodety-accent)]/10',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-white/[.055] text-white/60">
                    {customUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={customUrl} alt="" className="size-6 object-contain" />
                    ) : (
                      <Image className="size-5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-medium text-white/84">Custom image</span>
                    <span className="mt-0.5 block truncate text-[9px] text-white/38">Upload or paste an image URL</span>
                  </span>
                  {parsedCustom && <Check className="size-3.5 text-[var(--kodety-accent-hover)]" />}
                </button>

                {customMode && (
                  <div className="mt-2 space-y-2 rounded-[10px] border border-white/[.06] bg-black/10 p-2.5">
                    <div className="flex gap-2">
                      <Input
                        value={customUrl}
                        onChange={event => setCustomUrl(event.target.value)}
                        placeholder="Image URL"
                        disableKeyboardStep
                        className="min-w-0 flex-1 border-transparent bg-white/[.045]"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.055] text-white/55 hover:bg-white/[.085] hover:text-white"
                        aria-label="Upload cursor image"
                      >
                        <Upload className="size-3.5" />
                      </button>
                      <input
                        ref={fileInputRef}
                        hidden
                        type="file"
                        accept="image/png,image/svg+xml,image/webp,image/gif,image/x-icon,.cur"
                        onChange={event => handleFile(event.target.files?.[0])}
                      />
                    </div>
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <label className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-white/32">X</span>
                        <Input type="number" min={0} value={hotspotX} onChange={event => setHotspotX(event.target.value)} className="border-transparent bg-white/[.045] pl-5" />
                      </label>
                      <label className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-white/32">Y</span>
                        <Input type="number" min={0} value={hotspotY} onChange={event => setHotspotY(event.target.value)} className="border-transparent bg-white/[.045] pl-5" />
                      </label>
                      <button
                        type="button"
                        disabled={!customUrl.trim()}
                        onClick={applyCustomCursor}
                        className="h-8 rounded-[8px] bg-[var(--kodety-accent)] px-3 text-[10px] font-medium text-white disabled:opacity-35"
                      >
                        Apply
                      </button>
                    </div>
                    <p className="px-0.5 text-[9px] leading-relaxed text-white/32">PNG, SVG, WebP or CUR · up to 64×64 recommended.</p>
                  </div>
                )}
              </section>
            )}

            {visibleGroups.map(group => (
              <section key={group.label} className="mb-4 last:mb-0">
                <p className="mb-2 px-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-white/35">{group.label}</p>
                <div className="grid grid-cols-3 gap-2">
                  {group.options.map(option => {
                    const active = !parsedCustom && value === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => selectCursor(option.value)}
                        style={{ cursor: option.value as CSSProperties['cursor'] }}
                        className={cn(
                          'relative grid min-h-[74px] place-items-center content-center gap-1.5 rounded-[10px] border border-transparent bg-white/[.035] px-1.5 text-white/45 outline-none transition-[border-color,background-color,color] hover:bg-white/[.065] hover:text-white/80 focus-visible:border-[var(--kodety-focus)]/65',
                          active && 'border-[var(--kodety-focus)]/70 bg-[var(--kodety-accent)]/12 text-[var(--kodety-accent-hover)]',
                        )}
                        title={option.value}
                      >
                        <CursorPreview option={option} />
                        <span className="max-w-full truncate text-[9px] font-medium">{option.label}</span>
                        {active && <Check className="absolute right-1.5 top-1.5 size-2.5" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}

            {visibleGroups.length === 0 && (
              <div className="grid min-h-28 place-items-center text-[10px] text-white/35">No cursor found.</div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
