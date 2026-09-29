'use client';

import { normalizeCssControlInput } from '@/lib/html-editor/visual-style-adapter';

import React, { useState, useEffect, memo } from 'react';
import { Label } from './ui/label';
import Icon from './ui/icon';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider } from './ui/slider';
import { useHtmlCssDesignSync as useDesignSync } from './use-html-css-design-sync';
import { useEditorStore } from '@/stores/useEditorStore';

import type { Layer } from '@/types';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import ColorPicker from './ColorPicker';
import MaskControls from './MaskControls';
import {
  VisualSegmentedField,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from './ui/dropdown-menu';

interface EffectControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
}

const SHADOW_POSITION_OPTIONS: VisualStyleOption[] = [
  { value: 'outside', label: 'Outside' },
  { value: 'inside', label: 'Inside' },
];

const FILTER_DEFINITIONS = [
  { property: 'brightness', label: 'Brightness', defaultValue: 100, min: 0, max: 200, unit: '%' },
  { property: 'contrast', label: 'Contrast', defaultValue: 100, min: 0, max: 200, unit: '%' },
  { property: 'grayscale', label: 'Grayscale', defaultValue: 0, min: 0, max: 100, unit: '%' },
  { property: 'hueRotate', label: 'Hue', defaultValue: 0, min: 0, max: 360, unit: 'deg' },
  { property: 'invert', label: 'Invert', defaultValue: 0, min: 0, max: 100, unit: '%' },
  { property: 'saturate', label: 'Saturate', defaultValue: 100, min: 0, max: 200, unit: '%' },
  { property: 'sepia', label: 'Sepia', defaultValue: 0, min: 0, max: 100, unit: '%' },
] as const;

type FilterProperty = (typeof FILTER_DEFINITIONS)[number]['property'];
type FilterDefinition = (typeof FILTER_DEFINITIONS)[number];

function numericFilterValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function FilterEffectRow({
  definition,
  value,
  onInputChange,
  onValueChange,
  onRemove,
}: {
  definition: FilterDefinition;
  value: string;
  onInputChange(value: string): void;
  onValueChange(value: string): void;
  onRemove(): void;
}) {
  const currentValue = numericFilterValue(value, definition.defaultValue);
  const [input, setInput] = useState(String(currentValue));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setInput(String(currentValue));
  }, [currentValue, focused]);

  const formatValue = (next: number) => `${next}${definition.unit}`;

  return (
    <div className="grid grid-cols-3">
      <Label variant="muted">{definition.label}</Label>
      <div className="col-span-2 min-w-0">
        <Slider
          value={[currentValue]}
          inputValue={input}
          onInputValueChange={next => {
            setInput(next);
            const parsed = Number.parseFloat(next);
            if (!Number.isFinite(parsed)) return;
            const clamped = Math.max(definition.min, Math.min(definition.max, parsed));
            onInputChange(formatValue(clamped));
          }}
          onInputFocus={() => setFocused(true)}
          onInputBlur={() => {
            setFocused(false);
            if (input.trim() && Number.isFinite(Number.parseFloat(input))) return;
            setInput(String(definition.defaultValue));
            onValueChange(formatValue(definition.defaultValue));
          }}
          onValueChange={values => {
            const next = values[0];
            setInput(String(next));
            onValueChange(formatValue(next));
          }}
          min={definition.min}
          max={definition.max}
          step={1}
          unit={definition.unit === 'deg' ? '°' : definition.unit}
          action={(
            <button
              type="button"
              title={`Remove ${definition.label.toLowerCase()}`}
              aria-label={`Remove ${definition.label.toLowerCase()}`}
              className="grid size-6 shrink-0 place-items-center text-white/32 outline-none transition-colors hover:text-white/70 focus-visible:text-[var(--kodety-accent-hover)]"
              onPointerDown={event => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={event => {
                event.stopPropagation();
                onRemove();
              }}
            >
              <Icon name="x" className="size-2.5" />
            </button>
          )}
        />
      </div>
    </div>
  );
}

const EffectControls = memo(function EffectControls({ layer, onLayerUpdate, activeTextStyleKey }: EffectControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const showTextStyleControls = useEditorStore((state) => state.showTextStyleControls());
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  // Get current values from layer (no inheritance - only exact breakpoint values)
  const opacity = getDesignProperty('effects', 'opacity') || '100';
  const boxShadow = getDesignProperty('effects', 'boxShadow') || '';
  const blur = getDesignProperty('effects', 'blur') || '';
  const backdropBlur = getDesignProperty('effects', 'backdropBlur') || '';
  const filterValues: Record<FilterProperty, string> = {
    brightness: getDesignProperty('effects', 'brightness') || '',
    contrast: getDesignProperty('effects', 'contrast') || '',
    grayscale: getDesignProperty('effects', 'grayscale') || '',
    hueRotate: getDesignProperty('effects', 'hueRotate') || '',
    invert: getDesignProperty('effects', 'invert') || '',
    saturate: getDesignProperty('effects', 'saturate') || '',
    sepia: getDesignProperty('effects', 'sepia') || '',
  };

  // Shadow interface
  interface Shadow {
    id: string;
    position: 'outside' | 'inside';
    color: string;
    x: number;
    y: number;
    blur: number;
    spread: number;
  }

  // Parse existing shadows from boxShadow property
  const parseExistingShadows = (shadowString: string): Shadow[] => {
    if (!shadowString) return [];

    try {
      // Split by comma followed by underscore (our separator for multiple shadows)
      const shadowStrings = shadowString.split(',_');

      return shadowStrings.map((shadowStr, index) => {
        const isInset = shadowStr.startsWith('inset_');
        const cleanShadow = isInset ? shadowStr.replace('inset_', '') : shadowStr;

        // Parse: 0px_9px_4px_0px_rgba(0,0,0,0.25)
        // Match pattern: number+unit, number+unit, number+unit, number+unit, color
        const parts = cleanShadow.split('_');

        if (parts.length >= 5) {
          const x = parseInt(parts[0]) || 0;
          const y = parseInt(parts[1]) || 0;
          const blur = parseInt(parts[2]) || 0;
          const spread = parseInt(parts[3]) || 0;
          // Color is everything after the 4th underscore
          let color = parts.slice(4).join('_');
          if (color.startsWith('var(--')) {
            color = `color:${color}`;
          }

          return {
            id: `shadow-${Date.now()}-${index}`,
            position: isInset ? 'inside' : 'outside',
            color,
            x,
            y,
            blur,
            spread,
          };
        }

        // Fallback for invalid format
        return {
          id: `shadow-${Date.now()}-${index}`,
          position: 'outside',
          color: 'rgba(0,0,0,0.25)',
          x: 0,
          y: 9,
          blur: 4,
          spread: 0,
        };
      });
    } catch (error) {
      console.error('Error parsing shadows:', error);
      return [];
    }
  };

  const [shadows, setShadows] = useState<Shadow[]>([]);
  const [editingShadowId, setEditingShadowId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Sync shadows when layer changes (not when boxShadow updates during editing)
  useEffect(() => {
    const currentBoxShadow = getDesignProperty('effects', 'boxShadow') || '';

    if (currentBoxShadow) {
      // Parse and load existing shadows
      const parsed = parseExistingShadows(currentBoxShadow);
      setShadows(parsed);
    } else {
      // Clear shadows when no boxShadow
      setShadows([]);
    }
    // Reset editing state when layer changes
    setEditingShadowId(null);
    setPopoverOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, activeBreakpoint, activeUIState]);

  // Extract numeric value (0-100)
  const extractOpacity = (prop: string): number => {
    if (!prop) return 100;
    const match = prop.match(/(\d+)/);
    return match ? parseInt(match[1]) : 100;
  };

  const opacityValue = extractOpacity(opacity);

  // Local input state allows empty field while editing
  const [opacityInput, setOpacityInput] = useState(String(opacityValue));
  const [isOpacityFocused, setIsOpacityFocused] = useState(false);

  useEffect(() => {
    if (!isOpacityFocused) {
      setOpacityInput(String(opacityValue));
    }
  }, [opacityValue, isOpacityFocused]);

  const handleOpacityChange = (value: string) => {
    setOpacityInput(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      const numValue = Math.max(0, Math.min(100, parsed));
      debouncedUpdateDesignProperty('effects', 'opacity', `${numValue}`);
    }
  };

  const handleOpacityBlur = () => {
    setIsOpacityFocused(false);
    if (opacityInput.trim() === '' || isNaN(parseInt(opacityInput))) {
      updateDesignProperty('effects', 'opacity', null);
      setOpacityInput('100');
    }
  };

  // Handle opacity slider change (immediate - slider interaction)
  const handleOpacitySliderChange = (values: number[]) => {
    setOpacityInput(String(values[0]));
    updateDesignProperty('effects', 'opacity', `${values[0]}`);
  };

  // Extract blur value (in pixels)
  const extractBlur = (prop: string): number => {
    if (!prop) return 0;
    const match = prop.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const blurValue = extractBlur(blur);

  const [blurInput, setBlurInput] = useState(String(blurValue));
  const [isBlurFocused, setIsBlurFocused] = useState(false);

  useEffect(() => {
    if (!isBlurFocused) {
      setBlurInput(String(blurValue));
    }
  }, [blurValue, isBlurFocused]);

  const handleBlurChange = (value: string) => {
    setBlurInput(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      const numValue = Math.max(0, parsed);
      debouncedUpdateDesignProperty('effects', 'blur', `${numValue}px`);
    }
  };

  const handleBlurInputBlur = () => {
    setIsBlurFocused(false);
    if (blurInput.trim() === '' || isNaN(parseInt(blurInput))) {
      updateDesignProperty('effects', 'blur', null);
      setBlurInput('0');
    }
  };

  // Handle blur slider change (immediate - slider interaction)
  const handleBlurSliderChange = (values: number[]) => {
    setBlurInput(String(values[0]));
    updateDesignProperty('effects', 'blur', `${values[0]}px`);
  };

  // Add blur effect
  const handleAddBlur = () => {
    updateDesignProperty('effects', 'blur', '5px');
  };

  // Remove blur effect
  const handleRemoveBlur = () => {
    updateDesignProperty('effects', 'blur', null);
  };

  // Extract backdrop blur value (in pixels)
  const extractBackdropBlur = (prop: string): number => {
    if (!prop) return 0;
    const match = prop.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const backdropBlurValue = extractBackdropBlur(backdropBlur);

  const [backdropBlurInput, setBackdropBlurInput] = useState(String(backdropBlurValue));
  const [isBackdropBlurFocused, setIsBackdropBlurFocused] = useState(false);

  useEffect(() => {
    if (!isBackdropBlurFocused) {
      setBackdropBlurInput(String(backdropBlurValue));
    }
  }, [backdropBlurValue, isBackdropBlurFocused]);

  const handleBackdropBlurChange = (value: string) => {
    setBackdropBlurInput(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      const numValue = Math.max(0, parsed);
      debouncedUpdateDesignProperty('effects', 'backdropBlur', `${numValue}px`);
    }
  };

  const handleBackdropBlurInputBlur = () => {
    setIsBackdropBlurFocused(false);
    if (backdropBlurInput.trim() === '' || isNaN(parseInt(backdropBlurInput))) {
      updateDesignProperty('effects', 'backdropBlur', null);
      setBackdropBlurInput('0');
    }
  };

  // Handle backdrop blur slider change (immediate - slider interaction)
  const handleBackdropBlurSliderChange = (values: number[]) => {
    setBackdropBlurInput(String(values[0]));
    updateDesignProperty('effects', 'backdropBlur', `${values[0]}px`);
  };

  // Add backdrop blur effect
  const handleAddBackdropBlur = () => {
    updateDesignProperty('effects', 'backdropBlur', '5px');
  };

  // Remove backdrop blur effect
  const handleRemoveBackdropBlur = () => {
    updateDesignProperty('effects', 'backdropBlur', null);
  };

  const handleAddFilter = (definition: FilterDefinition) => {
    updateDesignProperty(
      'effects',
      definition.property,
      `${definition.defaultValue}${definition.unit}`,
    );
  };

  const handleFilterInputChange = (property: FilterProperty, value: string) => {
    debouncedUpdateDesignProperty('effects', property, value);
  };

  const handleFilterValueChange = (property: FilterProperty, value: string) => {
    updateDesignProperty('effects', property, value);
  };

  const handleRemoveFilter = (property: FilterProperty) => {
    updateDesignProperty('effects', property, null);
  };

  // Handle box shadow change (debounced for text input)
  const handleBoxShadowChange = (value: string) => {
    const sanitized = normalizeCssControlInput(value);
    debouncedUpdateDesignProperty('effects', 'boxShadow', sanitized || null);
  };

  // Generate shadow CSS value from shadow object
  const generateShadowString = (shadow: Shadow): string => {
    const inset = shadow.position === 'inside' ? 'inset_' : '';
    const color = shadow.color.startsWith('color:var(')
      ? shadow.color.replace('color:', '')
      : shadow.color;
    return `${inset}${shadow.x}px_${shadow.y}px_${shadow.blur}px_${shadow.spread}px_${color}`;
  };

  // Generate full shadows value for all shadows
  const generateFullShadowValue = (shadowsList: Shadow[]): string => {
    return shadowsList.map(generateShadowString).join(',_');
  };

  // Get currently editing shadow
  const editingShadow = shadows.find(s => s.id === editingShadowId);

  // Convert any color format to rgba
  const convertToRgba = (color: string): string => {
    if (color.startsWith('rgba')) return color;
    if (color.startsWith('rgb')) {
      return color.replace('rgb(', 'rgba(').replace(')', ',1)');
    }

    let r: number, g: number, b: number, a = 1;

    // Handle #hex/opacity format from ColorPicker (e.g. #000000/50)
    const hexOpacityMatch = color.match(/^#([0-9a-fA-F]{6})\/(\d+)$/);
    if (hexOpacityMatch) {
      r = parseInt(hexOpacityMatch[1].substring(0, 2), 16);
      g = parseInt(hexOpacityMatch[1].substring(2, 4), 16);
      b = parseInt(hexOpacityMatch[1].substring(4, 6), 16);
      a = parseInt(hexOpacityMatch[2]) / 100;
      return `rgba(${r},${g},${b},${a})`;
    }

    const hex = color.replace('#', '');

    if (hex.length === 8) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      a = parseInt(hex.substring(6, 8), 16) / 255;
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      return 'rgba(0,0,0,1)';
    }

    return `rgba(${r},${g},${b},${a})`;
  };

  // Open popover and create new shadow OR edit existing
  const handleOpenPopover = (open: boolean) => {
    if (open && !editingShadowId) {
      // Create new shadow with defaults
      const newShadow: Shadow = {
        id: Date.now().toString(),
        position: 'outside',
        color: 'rgba(0,0,0,0.25)',
        x: 0,
        y: 9,
        blur: 4,
        spread: 0,
      };

      const updatedShadows = [...shadows, newShadow];
      setShadows(updatedShadows);
      setEditingShadowId(newShadow.id);

      // Apply immediately
      const shadowValue = generateFullShadowValue(updatedShadows);
      updateDesignProperty('effects', 'boxShadow', shadowValue);
    } else if (!open) {
      // Close popover
      setEditingShadowId(null);
    }
    setPopoverOpen(open);
  };

  // Open popover to edit existing shadow
  const handleEditShadow = (shadowId: string) => {
    setEditingShadowId(shadowId);
    setPopoverOpen(true);
  };

  // Update shadow property in real-time
  const updateEditingShadow = (updates: Partial<Shadow>) => {
    if (!editingShadowId) return;

    const updatedShadows = shadows.map(s =>
      s.id === editingShadowId ? { ...s, ...updates } : s
    );
    setShadows(updatedShadows);

    // Apply immediately
    const shadowValue = generateFullShadowValue(updatedShadows);
    updateDesignProperty('effects', 'boxShadow', shadowValue);
  };

  // Remove shadow
  const handleRemoveShadow = (shadowId: string) => {
    const updatedShadows = shadows.filter(s => s.id !== shadowId);
    setShadows(updatedShadows);

    if (updatedShadows.length === 0) {
      updateDesignProperty('effects', 'boxShadow', null);
    } else {
      const shadowValue = generateFullShadowValue(updatedShadows);
      updateDesignProperty('effects', 'boxShadow', shadowValue);
    }
  };

  // Shadow value change handlers (update in real-time)
  const handleShadowPositionChange = (value: 'outside' | 'inside') => {
    updateEditingShadow({ position: value });
  };

  const handleShadowColorChange = (value: string) => {
    if (value.startsWith('color:var(')) {
      updateEditingShadow({ color: value });
    } else {
      updateEditingShadow({ color: convertToRgba(value) });
    }
  };

  const handleShadowXChange = (value: number) => {
    updateEditingShadow({ x: value });
  };

  const handleShadowYChange = (value: number) => {
    updateEditingShadow({ y: value });
  };

  const handleShadowBlurChange = (value: number) => {
    updateEditingShadow({ blur: value });
  };

  const handleShadowSpreadChange = (value: number) => {
    updateEditingShadow({ spread: value });
  };

  // Get display name for shadow
  const getShadowDisplayName = (shadow: Shadow): string => {
    const pos = shadow.position === 'inside' ? 'Inner' : 'Outer';
    return `${pos} ${shadow.x}px ${shadow.y}px ${shadow.blur}px`;
  };

  return (
    <div className="py-5" data-design-token-section="Effects" data-kodety-onboarding="design-style-effects">

      <header className="py-4 -mt-4 flex items-center justify-between">
        <Label>Effects</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Filters</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={handleAddBlur} disabled={!!blur}>Blur</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAddBackdropBlur} disabled={!!backdropBlur}>BG Blur</DropdownMenuItem>
                  {FILTER_DEFINITIONS.map(definition => (
                    <DropdownMenuItem
                      key={definition.property}
                      disabled={!!filterValues[definition.property]}
                      onClick={() => handleAddFilter(definition)}
                    >
                      {definition.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-col gap-2">

          <div className="grid grid-cols-3">
              <Label variant="muted">Opacity</Label>
              <div className="col-span-2">
                  <Slider
                    value={[opacityValue]}
                    inputValue={opacityInput}
                    onInputValueChange={handleOpacityChange}
                    onInputFocus={() => setIsOpacityFocused(true)}
                    onInputBlur={handleOpacityBlur}
                    onValueChange={handleOpacitySliderChange}
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                  />
              </div>
          </div>

          {(!showTextStyleControls || activeTextStyleKey === 'richTextImage') && (
            <div className="grid grid-cols-3 items-start">
              <Label variant="muted" className="py-2">Shadow</Label>
              <div className="col-span-2 *:w-full flex flex-col gap-2">

                  <Popover open={popoverOpen} onOpenChange={handleOpenPopover}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="input" size="sm"
                        className="justify-start"
                      >
                        <div className="kodety-transparency-preview -ml-1">
                          <div className="kodety-transparency-swatch absolute inset-0 z-10" />
                        </div>
                        <span className="dark:opacity-50">Add...</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="my-1 flex w-60 flex-col gap-2.5 p-3" align="end">
                      {editingShadow && (
                        <>
                          <div className="flex h-6 items-center justify-between">
                            <span className="text-[11px] font-medium text-foreground">Shadow</span>
                            <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/35">
                              {editingShadow.position === 'inside' ? 'Inner' : 'Outer'}
                            </span>
                          </div>

                          <div className="flex flex-col gap-2 border-t border-white/[.06] pt-2.5">
                            <VisualSegmentedField
                              label="Position"
                              value={editingShadow.position}
                              options={SHADOW_POSITION_OPTIONS}
                              onValueChange={(value) => handleShadowPositionChange(value as 'outside' | 'inside')}
                              property="box-shadow"
                            />

                            <div className="grid grid-cols-3">
                              <Label variant="muted">Color</Label>
                              <div className="col-span-2 *:w-full">
                                <ColorPicker
                                  value={editingShadow.color} onChange={handleShadowColorChange}
                                  solidOnly
                                />
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 border-t border-white/[.06] pt-2.5">
                            <div className="grid grid-cols-3">
                              <Label variant="muted">X</Label>
                              <div className="col-span-2">
                                <Slider
                                  value={[editingShadow.x]}
                                  onValueChange={(values) => handleShadowXChange(values[0])}
                                  min={-100}
                                  max={100}
                                  step={1}
                                  unit="px"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-3">
                              <Label variant="muted">Y</Label>
                              <div className="col-span-2">
                                <Slider
                                  value={[editingShadow.y]}
                                  onValueChange={(values) => handleShadowYChange(values[0])}
                                  min={-100}
                                  max={100}
                                  step={1}
                                  unit="px"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-3">
                              <Label variant="muted">Blur</Label>
                              <div className="col-span-2">
                                <Slider
                                  value={[editingShadow.blur]}
                                  onValueChange={(values) => handleShadowBlurChange(values[0])}
                                  min={0}
                                  max={100}
                                  step={1}
                                  unit="px"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-3">
                              <Label variant="muted">Spread</Label>
                              <div className="col-span-2">
                                <Slider
                                  value={[editingShadow.spread]}
                                  onValueChange={(values) => handleShadowSpreadChange(values[0])}
                                  min={0}
                                  max={100}
                                  step={1}
                                  unit="px"
                                />
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </PopoverContent>
                  </Popover>

                  {shadows.map((shadow) => (
                    <Button
                      key={shadow.id}
                      variant="input"
                      onClick={() => handleEditShadow(shadow.id)}
                    >
                      <Label variant="muted" className="cursor-pointer">{getShadowDisplayName(shadow)}</Label>
                      <span
                        role="button"
                        tabIndex={0}
                        className="ml-auto -mr-0.5 p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveShadow(shadow.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            handleRemoveShadow(shadow.id);
                          }
                        }}
                      >
                        <Icon name="x" className="size-2.5" />
                      </span>
                    </Button>
                  ))}

                  {/*<Select value={boxShadow || 'none'} onValueChange={handleBoxShadowChange}>*/}
                  {/*    <SelectTrigger>*/}
                  {/*        <SelectValue />*/}
                  {/*    </SelectTrigger>*/}
                  {/*    <SelectContent>*/}
                  {/*        <SelectGroup>*/}
                  {/*            <SelectItem value="none">None</SelectItem>*/}
                  {/*            <SelectItem value="sm">Small</SelectItem>*/}
                  {/*            <SelectItem value="md">Medium</SelectItem>*/}
                  {/*            <SelectItem value="lg">Large</SelectItem>*/}
                  {/*            <SelectItem value="xl">Extra Large</SelectItem>*/}
                  {/*            <SelectItem value="2xl">2X Large</SelectItem>*/}
                  {/*            <SelectItem value="inner">Inner</SelectItem>*/}
                  {/*        </SelectGroup>*/}
                  {/*    </SelectContent>*/}
                  {/*</Select>*/}

              </div>
            </div>
          )}

          <MaskControls layer={layer} onLayerUpdate={onLayerUpdate} />

          {blur && (
            <div className="grid grid-cols-3">
              <Label variant="muted">Blur</Label>
              <div className="col-span-2 min-w-0">
                <Slider
                  value={[blurValue]}
                  inputValue={blurInput}
                  onInputValueChange={handleBlurChange}
                  onInputFocus={() => setIsBlurFocused(true)}
                  onInputBlur={handleBlurInputBlur}
                  onValueChange={handleBlurSliderChange}
                  min={0}
                  max={100}
                  step={1}
                  unit="px"
                  action={(
                    <button
                      type="button"
                      aria-label="Remove blur"
                      className="grid size-6 shrink-0 place-items-center text-white/32 outline-none transition-colors hover:text-white/70 focus-visible:text-[var(--kodety-accent-hover)]"
                      onPointerDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={event => {
                        event.stopPropagation();
                        handleRemoveBlur();
                      }}
                    >
                      <Icon name="x" className="size-2.5" />
                    </button>
                  )}
                />
              </div>
            </div>
          )}

          {backdropBlur && (
            <div className="grid grid-cols-3">
              <Label variant="muted">BG Blur</Label>
              <div className="col-span-2 min-w-0">
                <Slider
                  value={[backdropBlurValue]}
                  inputValue={backdropBlurInput}
                  onInputValueChange={handleBackdropBlurChange}
                  onInputFocus={() => setIsBackdropBlurFocused(true)}
                  onInputBlur={handleBackdropBlurInputBlur}
                  onValueChange={handleBackdropBlurSliderChange}
                  min={0}
                  max={100}
                  step={1}
                  unit="px"
                  action={(
                    <button
                      type="button"
                      aria-label="Remove background blur"
                      className="grid size-6 shrink-0 place-items-center text-white/32 outline-none transition-colors hover:text-white/70 focus-visible:text-[var(--kodety-accent-hover)]"
                      onPointerDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={event => {
                        event.stopPropagation();
                        handleRemoveBackdropBlur();
                      }}
                    >
                      <Icon name="x" className="size-2.5" />
                    </button>
                  )}
                />
              </div>
            </div>
          )}

          {FILTER_DEFINITIONS.map(definition => {
            const value = filterValues[definition.property];
            if (!value) return null;
            return (
              <FilterEffectRow
                key={definition.property}
                definition={definition}
                value={value}
                onInputChange={next => handleFilterInputChange(definition.property, next)}
                onValueChange={next => handleFilterValueChange(definition.property, next)}
                onRemove={() => handleRemoveFilter(definition.property)}
              />
            );
          })}

      </div>

    </div>
  );
});
export default EffectControls;
