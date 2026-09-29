'use client';

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Layer,
  MaskComposite,
  MaskLayerDesign,
  MaskMode,
  MaskStop,
  MaskType,
} from '@/types';
import { useEditorStore } from '@/stores/useEditorStore';
import { ASSET_CATEGORIES, isAssetOfType } from '@/lib/asset-utils';
import {
  createDefaultMaskLayer,
  maskPreviewBackground,
} from '@/lib/html-editor/mask-utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from './ui/button';
import Icon from './ui/icon';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Slider } from './ui/slider';

interface MaskControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const TYPE_LABELS: Record<MaskType, string> = {
  linear: 'Linear',
  radial: 'Radial',
  conic: 'Conic',
  image: 'Image',
};

const COMPOSITE_LABELS: Record<MaskComposite, string> = {
  add: 'Add',
  subtract: 'Subtract',
  intersect: 'Intersect',
  exclude: 'Exclude',
};

const MASK_TYPES: MaskType[] = ['linear', 'radial', 'conic', 'image'];
const MASK_COMPOSITES: MaskComposite[] = ['add', 'subtract', 'intersect', 'exclude'];

function MaskTypeGlyph({ type, className }: { type: MaskType; className?: string }) {
  if (type === 'image') {
    return (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
        <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.2" fill="currentColor" opacity=".14" />
        <circle cx="5.25" cy="5.4" r="1.25" fill="currentColor" opacity=".75" />
        <path d="m3.6 12 3.1-3.3 1.75 1.7 1.65-1.75L12.65 12H3.6Z" fill="currentColor" />
      </svg>
    );
  }
  if (type === 'radial') {
    return (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
        <defs>
          <radialGradient id="mask-radial-glyph">
            <stop offset="0" stopColor="currentColor" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".06" />
          </radialGradient>
        </defs>
        <circle cx="8" cy="8" r="5.75" fill="url(#mask-radial-glyph)" stroke="currentColor" strokeOpacity=".24" />
      </svg>
    );
  }
  if (type === 'conic') {
    return (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
        <defs>
          <linearGradient id="mask-conic-glyph" x1="0" x2="1">
            <stop stopColor="currentColor" stopOpacity=".08" />
            <stop offset="1" stopColor="currentColor" />
          </linearGradient>
        </defs>
        <path d="M8 2.25A5.75 5.75 0 1 0 13.75 8H8V2.25Z" fill="url(#mask-conic-glyph)" />
        <path d="M8 2.25V8h5.75A5.75 5.75 0 0 0 8 2.25Z" fill="currentColor" opacity=".18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mask-linear-glyph" x1="0" x2="1">
          <stop stopColor="currentColor" stopOpacity=".08" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.2" fill="url(#mask-linear-glyph)" stroke="currentColor" strokeOpacity=".2" />
    </svg>
  );
}

function alphaGradient(stops: MaskStop[]) {
  const serialized = [...stops]
    .sort((left, right) => left.position - right.position)
    // White represents the visible portion of a mask in the editor. This keeps
    // the preview legible without turning the transparency checker into the
    // strongest element in the control.
    .map(stop => `rgb(255 255 255 / ${Math.max(0, Math.min(100, stop.alpha)) / 100}) ${Math.max(0, Math.min(100, stop.position))}%`)
    .join(', ');
  return `linear-gradient(90deg, ${serialized})`;
}

function interpolateAlpha(stops: MaskStop[], position: number) {
  const sorted = [...stops].sort((left, right) => left.position - right.position);
  const left = [...sorted].reverse().find(stop => stop.position <= position) || sorted[0];
  const right = sorted.find(stop => stop.position >= position) || sorted[sorted.length - 1];
  if (!left || !right) return 100;
  if (left.position === right.position) return left.alpha;
  const progress = (position - left.position) / (right.position - left.position);
  return Math.round(left.alpha + (right.alpha - left.alpha) * progress);
}

function OpacityGradientBar({
  stops,
  selectedIndex,
  onSelect,
  onChange,
}: {
  stops: MaskStop[];
  selectedIndex: number;
  onSelect(index: number): void;
  onChange(stops: MaskStop[], selectedIndex?: number): void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; index: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ index: number; position: number } | null>(null);

  const positionAt = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const flushPending = useCallback(() => {
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    onChange(stops.map((stop, index) => (
      index === pending.index ? { ...stop, position: Math.round(pending.position * 10) / 10 } : stop
    )));
  }, [onChange, stops]);

  const schedulePosition = useCallback((index: number, position: number) => {
    pendingRef.current = { index, position };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(flushPending);
  }, [flushPending]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <div className="border-t border-white/[.06] pt-2.5">
      <div
        ref={barRef}
        className="relative h-5 cursor-crosshair"
        onPointerDown={event => {
          if (event.button !== 0) return;
          const position = positionAt(event.clientX);
          const next: MaskStop = {
            id: `mask-stop-${Math.round(position * 1000)}`,
            position: Math.round(position * 10) / 10,
            alpha: interpolateAlpha(stops, position),
          };
          onChange([...stops, next], stops.length);
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-white/[.055]">
          <div className="kodety-transparency-swatch absolute inset-0 opacity-[.16]" />
          <div className="absolute inset-0" style={{ backgroundImage: alphaGradient(stops) }} />
        </div>
        {stops.map((stop, index) => (
          <button
            key={`${stop.id}-${index}`}
            type="button"
            aria-label={`Opacity stop ${index + 1}`}
            className={cn(
              'absolute top-1/2 z-10 grid size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border bg-[#171717] outline-none transition-[border-color,transform]',
              index === selectedIndex
                ? 'scale-105 border-[var(--kodety-accent-hover)]'
                : 'border-white/35 hover:border-white/65',
            )}
            style={{ left: `${stop.position}%` }}
            onPointerDown={event => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(index);
              dragRef.current = { pointerId: event.pointerId, index };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (dragRef.current?.pointerId !== event.pointerId) return;
              schedulePosition(dragRef.current.index, positionAt(event.clientX));
            }}
            onPointerUp={event => {
              if (dragRef.current?.pointerId !== event.pointerId) return;
              schedulePosition(dragRef.current.index, positionAt(event.clientX));
              dragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { dragRef.current = null; }}
          >
            <span
              className="size-[8px] overflow-hidden rounded-full"
              style={{
                backgroundImage: `linear-gradient(90deg, rgb(255 255 255 / .2) 0 50%, rgb(255 255 255 / ${stop.alpha / 100}) 50% 100%)`,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function CompactSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
}: {
  value: string;
  onValueChange(value: string): void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function stripCssUrl(value: string) {
  const match = value.trim().match(/^url\((['"]?)(.*)\1\)$/i);
  return match ? match[2] : value;
}

const MaskControls = memo(function MaskControls({ layer, onLayerUpdate }: MaskControlsProps) {
  const openFileManager = useEditorStore(state => state.openFileManager);
  const masks = layer?.design?.effects?.masks || [];
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);
  const [imageDraft, setImageDraft] = useState('');

  const editingMask = editingIndex === null ? null : masks[editingIndex] || null;
  const selectedStop = editingMask?.stops[selectedStopIndex] || editingMask?.stops[0] || null;

  useEffect(() => {
    setPopoverOpen(false);
    setEditingIndex(null);
    setSelectedStopIndex(0);
  }, [layer?.id]);

  useEffect(() => {
    if (editingIndex !== null && editingIndex >= masks.length) {
      setEditingIndex(masks.length ? masks.length - 1 : null);
    }
  }, [editingIndex, masks.length]);

  useEffect(() => {
    setImageDraft(editingMask ? stripCssUrl(editingMask.image) : '');
  }, [editingIndex, editingMask?.image]);

  const commitMasks = useCallback((nextMasks: MaskLayerDesign[]) => {
    if (!layer) return;
    onLayerUpdate(layer.id, {
      design: {
        ...layer.design,
        effects: {
          ...layer.design?.effects,
          isActive: true,
          masks: nextMasks,
        },
      },
    });
  }, [layer, onLayerUpdate]);

  const updateEditingMask = useCallback((updates: Partial<MaskLayerDesign>) => {
    if (editingIndex === null) return;
    commitMasks(masks.map((mask, index) => (
      index === editingIndex ? { ...mask, ...updates } : mask
    )));
  }, [commitMasks, editingIndex, masks]);

  const handleAddMask = useCallback(() => {
    const next = createDefaultMaskLayer(masks.length, 'linear');
    commitMasks([...masks, next]);
    setEditingIndex(masks.length);
    setSelectedStopIndex(0);
    setPopoverOpen(true);
  }, [commitMasks, masks]);

  const handleRemoveMask = useCallback((index: number) => {
    commitMasks(masks.filter((_, maskIndex) => maskIndex !== index));
    if (editingIndex === index) {
      setPopoverOpen(false);
      setEditingIndex(null);
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  }, [commitMasks, editingIndex, masks]);

  const handleTypeChange = (type: MaskType) => {
    if (!editingMask || type === editingMask.type) return;
    const defaults = createDefaultMaskLayer(editingIndex || 0, type);
    updateEditingMask({
      type,
      stops: type === 'image' ? editingMask.stops : editingMask.stops.length >= 2 ? editingMask.stops : defaults.stops,
      angle: type === 'conic' ? 0 : editingMask.angle || defaults.angle,
      mode: type === 'image' ? 'match-source' : 'alpha',
      size: type === 'image' ? 'cover' : '100% 100%',
      position: '50% 50%',
      repeat: 'no-repeat',
    });
    setSelectedStopIndex(0);
  };

  const preloadAndApplyImage = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      updateEditingMask({ image: '' });
      return;
    }
    if (typeof Image === 'undefined') {
      updateEditingMask({ image: trimmed });
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => updateEditingMask({ image: trimmed });
    image.onerror = () => toast.error('Unable to load mask image', {
      description: 'Check the URL or choose an image from Assets.',
    });
    image.src = trimmed;
  }, [updateEditingMask]);

  const handleBrowseImage = useCallback(() => {
    openFileManager(
      asset => {
        if (!asset.mime_type || !isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES)) {
          toast.error('Invalid asset type', { description: 'Choose an image file for the mask.' });
          return false;
        }
        if (!asset.public_url) {
          toast.error('Asset has no URL');
          return false;
        }
        setImageDraft(asset.public_url);
        preloadAndApplyImage(asset.public_url);
      },
      null,
      [ASSET_CATEGORIES.IMAGES],
    );
  }, [openFileManager, preloadAndApplyImage]);

  const moveMask = (direction: -1 | 1) => {
    if (editingIndex === null) return;
    const target = editingIndex + direction;
    if (target < 0 || target >= masks.length) return;
    const next = [...masks];
    [next[editingIndex], next[target]] = [next[target], next[editingIndex]];
    commitMasks(next);
    setEditingIndex(target);
  };

  const updateSelectedStop = (updates: Partial<MaskStop>) => {
    if (!editingMask) return;
    updateEditingMask({
      stops: editingMask.stops.map((stop, index) => (
        index === selectedStopIndex ? { ...stop, ...updates } : stop
      )),
    });
  };

  const removeSelectedStop = () => {
    if (!editingMask || editingMask.stops.length <= 2) return;
    updateEditingMask({
      stops: editingMask.stops.filter((_, index) => index !== selectedStopIndex),
    });
    setSelectedStopIndex(Math.max(0, selectedStopIndex - 1));
  };

  const previewStyle = useCallback((mask: MaskLayerDesign): React.CSSProperties => ({
    backgroundImage: mask.type === 'image'
      ? maskPreviewBackground(mask)
      : maskPreviewBackground(mask).replaceAll('rgb(0 0 0', 'rgb(255 255 255'),
    backgroundPosition: mask.position || 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: mask.type === 'image' ? mask.size || 'cover' : '100% 100%',
  }), []);

  const compositeOptions = MASK_COMPOSITES.map(value => ({ value, label: COMPOSITE_LABELS[value] }));

  return (
    <div className="grid grid-cols-3 items-start">
      <Label variant="muted" className="py-2">Mask</Label>
      <div className="col-span-2 flex min-w-0 flex-col gap-2">
        {masks.map((mask, index) => (
          <Button
            key={`${mask.id}-${index}`}
            variant="input"
            size="sm"
            className="group justify-start overflow-hidden"
            onClick={() => {
              setEditingIndex(index);
              setSelectedStopIndex(0);
              setPopoverOpen(true);
            }}
          >
            <span className="kodety-transparency-preview -ml-1 bg-white/[.055]">
              <span className="kodety-transparency-swatch absolute inset-0 opacity-[.16]" />
              <span className="absolute inset-0" style={previewStyle(mask)} />
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground/88">
              {TYPE_LABELS[mask.type]}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label={`Remove ${TYPE_LABELS[mask.type].toLowerCase()} mask`}
              className="grid size-5 shrink-0 place-items-center rounded-[5px] text-white/32 transition-colors hover:bg-white/[.06] hover:text-white/72"
              onPointerDown={event => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={event => {
                event.stopPropagation();
                handleRemoveMask(index);
              }}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                handleRemoveMask(index);
              }}
            >
              <Icon name="x" className="size-2.5" />
            </span>
          </Button>
        ))}

        <Popover
          open={popoverOpen}
          onOpenChange={open => {
            setPopoverOpen(open);
            if (!open) setEditingIndex(null);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="input"
              size="sm"
              className="justify-start"
              disabled={!layer}
              onClick={handleAddMask}
            >
              <span className="grid size-5 shrink-0 -ml-1 place-items-center rounded-[6px] border border-dashed border-white/16 text-white/45">
                <Icon name="plus" className="size-2.5" />
              </span>
              <span className="text-white/45">Add...</span>
            </Button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            side="left"
            sideOffset={10}
            className="my-1 flex w-[292px] max-h-[min(680px,calc(100vh-32px))] flex-col gap-2.5 overflow-y-auto p-2.5"
            onPointerDown={event => event.stopPropagation()}
          >
            {editingMask && (
              <>
                <div className="flex h-7 items-center gap-2 px-0.5">
                  <span className="text-[12px] font-medium text-foreground">Mask</span>
                  {masks.length > 1 && (
                    <span className="text-[9px] tabular-nums text-white/32">
                      {editingIndex! + 1} of {masks.length}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      title="Move mask up"
                      disabled={editingIndex === 0}
                      className="grid size-6 place-items-center rounded-[6px] text-white/36 outline-none transition hover:bg-white/[.06] hover:text-white/72 disabled:opacity-20"
                      onClick={() => moveMask(-1)}
                    >
                      <Icon name="chevronUp" className="size-2.5" />
                    </button>
                    <button
                      type="button"
                      title="Move mask down"
                      disabled={editingIndex === masks.length - 1}
                      className="grid size-6 place-items-center rounded-[6px] text-white/36 outline-none transition hover:bg-white/[.06] hover:text-white/72 disabled:opacity-20"
                      onClick={() => moveMask(1)}
                    >
                      <Icon name="chevronDown" className="size-2.5" />
                    </button>
                    <button
                      type="button"
                      title="Close mask editor"
                      aria-label="Close mask editor"
                      className="grid size-6 place-items-center rounded-[6px] text-white/36 outline-none transition hover:bg-white/[.06] hover:text-white/72 focus-visible:text-[var(--kodety-accent-hover)]"
                      onClick={() => setPopoverOpen(false)}
                    >
                      <Icon name="x" className="size-2.5" />
                    </button>
                  </div>
                </div>

                <div className="grid h-9 grid-cols-4 gap-0.5 rounded-[9px] bg-white/[.045] p-0.5">
                  {MASK_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      title={TYPE_LABELS[type]}
                      aria-label={`${TYPE_LABELS[type]} mask`}
                      aria-pressed={editingMask.type === type}
                      className={cn(
                        'grid place-items-center rounded-[7px] outline-none transition-[background-color,color] focus-visible:text-[var(--kodety-accent-hover)]',
                        editingMask.type === type
                          ? 'bg-white/[.12] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.055)]'
                          : 'text-white/38 hover:bg-white/[.055] hover:text-white/68',
                      )}
                      onClick={() => handleTypeChange(type)}
                    >
                      <MaskTypeGlyph type={type} className="size-4" />
                    </button>
                  ))}
                </div>

                {editingMask.type !== 'image' ? (
                  <>
                    <OpacityGradientBar
                      stops={editingMask.stops}
                      selectedIndex={selectedStopIndex}
                      onSelect={setSelectedStopIndex}
                      onChange={(stops, nextSelected) => {
                        updateEditingMask({ stops });
                        if (nextSelected !== undefined) setSelectedStopIndex(nextSelected);
                      }}
                    />

                    {selectedStop && (
                      <div className="flex flex-col gap-2 border-t border-white/[.06] pt-3">
                        <div className="grid grid-cols-3 items-center">
                          <Label variant="muted">Alpha</Label>
                          <div className="col-span-2 min-w-0">
                            <Slider
                              value={[selectedStop.alpha]}
                              onValueChange={values => updateSelectedStop({ alpha: values[0] })}
                              min={0}
                              max={100}
                              step={1}
                              unit="%"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-3 items-center">
                          <div className="flex items-center gap-1.5">
                            <Label variant="muted">Position</Label>
                            {editingMask.stops.length > 2 && (
                              <button
                                type="button"
                                title="Remove selected stop"
                                aria-label="Remove selected opacity stop"
                                className="grid size-5 place-items-center rounded-[5px] text-white/30 hover:bg-white/[.055] hover:text-white/65"
                                onClick={removeSelectedStop}
                              >
                                <Icon name="x" className="size-2" />
                              </button>
                            )}
                          </div>
                          <div className="col-span-2 min-w-0">
                            <Slider
                              value={[selectedStop.position]}
                              onValueChange={values => updateSelectedStop({ position: values[0] })}
                              min={0}
                              max={100}
                              step={1}
                              unit="%"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {(editingMask.type === 'linear' || editingMask.type === 'conic') && (
                      <div className="grid grid-cols-3 items-center border-t border-white/[.06] pt-3">
                        <Label variant="muted">Rotation</Label>
                        <div className="col-span-2 min-w-0">
                          <Slider
                            value={[editingMask.angle]}
                            onValueChange={values => updateEditingMask({ angle: values[0] })}
                            min={0}
                            max={360}
                            step={1}
                            unit="°"
                          />
                        </div>
                      </div>
                    )}

                    {(editingMask.type === 'radial' || editingMask.type === 'conic') && (
                      <div className="flex flex-col gap-2 border-t border-white/[.06] pt-3">
                        {editingMask.type === 'radial' && (
                          <div className="grid grid-cols-3 items-center">
                            <Label variant="muted">Shape</Label>
                            <div className="col-span-2 grid h-8 grid-cols-2 rounded-[8px] bg-white/[.045] p-1 text-[10px]">
                              {(['circle', 'ellipse'] as const).map(shape => (
                                <button
                                  key={shape}
                                  type="button"
                                  className={cn(
                                    'rounded-[6px] capitalize text-white/45 transition',
                                    editingMask.shape === shape && 'bg-white/[.12] text-white/90',
                                  )}
                                  onClick={() => updateEditingMask({ shape })}
                                >
                                  {shape}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-3 items-center">
                          <Label variant="muted">Center X</Label>
                          <div className="col-span-2 min-w-0">
                            <Slider
                              value={[editingMask.centerX]}
                              onValueChange={values => updateEditingMask({ centerX: values[0] })}
                              min={0}
                              max={100}
                              step={1}
                              unit="%"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-3 items-center">
                          <Label variant="muted">Center Y</Label>
                          <div className="col-span-2 min-w-0">
                            <Slider
                              value={[editingMask.centerY]}
                              onValueChange={values => updateEditingMask({ centerY: values[0] })}
                              min={0}
                              max={100}
                              step={1}
                              unit="%"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-2.5 border-t border-white/[.06] pt-3">
                    <div className="overflow-hidden rounded-[9px] border border-white/[.07] bg-white/[.035]">
                      <div className="flex h-9 items-center">
                        <Input
                          value={imageDraft}
                          onChange={event => setImageDraft(event.target.value)}
                          onBlur={() => preloadAndApplyImage(imageDraft)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                          placeholder="Image URL"
                          className="h-full flex-1 rounded-none border-0 bg-transparent px-2.5 focus-visible:border-0"
                        />
                        <button
                          type="button"
                          className="h-full shrink-0 border-l border-white/[.055] px-2.5 text-[10px] text-white/52 transition hover:bg-white/[.055] hover:text-white/82"
                          onClick={handleBrowseImage}
                        >
                          Browse
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 items-center">
                      <Label variant="muted">Mode</Label>
                      <div className="col-span-2">
                        <CompactSelect
                          value={editingMask.mode}
                          onValueChange={value => updateEditingMask({ mode: value as MaskMode })}
                          ariaLabel="Mask image mode"
                          options={[
                            { value: 'match-source', label: 'Auto' },
                            { value: 'alpha', label: 'Alpha' },
                            { value: 'luminance', label: 'Luminance' },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 items-center">
                      <Label variant="muted">Size</Label>
                      <div className="col-span-2">
                        <CompactSelect
                          value={editingMask.size || 'cover'}
                          onValueChange={value => updateEditingMask({ size: value })}
                          ariaLabel="Mask image size"
                          options={[
                            { value: 'cover', label: 'Cover' },
                            { value: 'contain', label: 'Contain' },
                            { value: 'auto', label: 'Original' },
                            { value: '100% 100%', label: 'Stretch' },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 items-center">
                      <Label variant="muted">Position</Label>
                      <div className="col-span-2">
                        <CompactSelect
                          value={editingMask.position || '50% 50%'}
                          onValueChange={value => updateEditingMask({ position: value })}
                          ariaLabel="Mask image position"
                          options={[
                            { value: '50% 50%', label: 'Center' },
                            { value: '50% 0%', label: 'Top' },
                            { value: '100% 50%', label: 'Right' },
                            { value: '50% 100%', label: 'Bottom' },
                            { value: '0% 50%', label: 'Left' },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 items-center">
                      <Label variant="muted">Repeat</Label>
                      <div className="col-span-2">
                        <CompactSelect
                          value={editingMask.repeat || 'no-repeat'}
                          onValueChange={value => updateEditingMask({ repeat: value })}
                          ariaLabel="Mask image repeat"
                          options={[
                            { value: 'no-repeat', label: 'No repeat' },
                            { value: 'repeat', label: 'Repeat' },
                            { value: 'repeat-x', label: 'Horizontal' },
                            { value: 'repeat-y', label: 'Vertical' },
                            { value: 'round', label: 'Round' },
                            { value: 'space', label: 'Space' },
                          ]}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {editingIndex !== null && editingIndex < masks.length - 1 && (
                  <div className="grid grid-cols-3 items-center border-t border-white/[.06] pt-3">
                    <div>
                      <Label variant="muted">Composite</Label>
                      <div className="mt-0.5 text-[8px] text-white/25">With layers below</div>
                    </div>
                    <div className="col-span-2">
                      <CompactSelect
                        value={editingMask.composite}
                        onValueChange={value => updateEditingMask({ composite: value as MaskComposite })}
                        ariaLabel="Mask composite mode"
                        options={compositeOptions}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
});

export default MaskControls;
