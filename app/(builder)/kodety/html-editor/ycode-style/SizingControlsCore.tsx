'use client';

import { useState, useEffect, memo } from 'react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import Icon from './ui/icon';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import SettingsPanel from './SettingsPanel';
import { useHtmlCssDesignSync as useDesignSync } from './use-html-css-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { extractMeasurementValue } from '@/lib/measurement-utils';
import { normalizeCssControlInput } from '@/lib/html-editor/visual-style-adapter';
import type { Layer } from '@/types';
import {
  VisualDimensionField,
  VisualMeasurementField,
  VisualSelectControl,
  VisualSelectField,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';

export interface SizingControlsCoreProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  parentHasGrid: boolean;
}

// Round only the outer corner of each grid corner cell so the 3x3 grid reads as one rounded block
const OBJECT_POSITION_CORNERS: Record<string, string> = {
  'left-top': 'rounded-tl-lg',
  'right-top': 'rounded-tr-lg',
  'left-bottom': 'rounded-bl-lg',
  'right-bottom': 'rounded-br-lg',
};

// 3x3 focal point grid: cell position maps to the image alignment value
const OBJECT_POSITIONS: { value: string; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { value: 'left-top', label: 'Top left', icon: 'arrow-left-up' },
  { value: 'top', label: 'Top center', icon: 'arrow-up' },
  { value: 'right-top', label: 'Top right', icon: 'arrow-right-up' },
  { value: 'left', label: 'Center left', icon: 'arrow-left' },
  { value: 'center', label: 'Center', icon: 'circle' },
  { value: 'right', label: 'Center right', icon: 'arrow-right' },
  { value: 'left-bottom', label: 'Bottom left', icon: 'arrow-left-down' },
  { value: 'bottom', label: 'Bottom center', icon: 'arrow-down' },
  { value: 'right-bottom', label: 'Bottom right', icon: 'arrow-right-down' },
];

const WIDTH_PRESETS: VisualStyleOption[] = [
  { value: 'w-[100%]', label: 'Fill', glyph: 'width', description: 'Preenche o espaço' },
  { value: 'w-fit-content', label: 'Fit', glyph: 'min-width', description: 'Ajusta ao conteúdo' },
  { value: 'w-[100vw]', label: 'Screen', glyph: 'max-width', description: 'Largura da tela' },
];
const HEIGHT_PRESETS: VisualStyleOption[] = [
  { value: 'h-[100%]', label: 'Fill', glyph: 'height', description: 'Preenche o espaço' },
  { value: 'h-fit-content', label: 'Fit', glyph: 'min-height', description: 'Ajusta ao conteúdo' },
  { value: 'h-[100svh]', label: 'Screen', glyph: 'max-height', description: 'Altura da tela' },
];
const HEIGHT_LIMIT_PRESETS = HEIGHT_PRESETS.filter(option => option.value !== 'h-fit-content');
const OVERFLOW_OPTIONS: VisualStyleOption[] = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'ellipsis', label: 'Ellipsis' },
  { value: 'auto', label: 'Auto' },
];
const OBJECT_FIT_OPTIONS: VisualStyleOption[] = [
  { value: 'contain', label: 'Contain', glyph: 'fit-contain' },
  { value: 'cover', label: 'Cover', glyph: 'fit-cover' },
  { value: 'fill', label: 'Fill', glyph: 'fit-fill' },
  { value: 'none', label: 'None', glyph: 'fit-none' },
  { value: 'scale-down', label: 'Scale down', glyph: 'fit-scale-down' },
];
const ASPECT_RATIO_PRESETS: VisualStyleOption[] = [
  { value: 'aspect-square', label: 'Square · 1:1', glyph: 'fit-fill' },
  { value: 'aspect-video', label: 'Video · 16:9', glyph: 'width' },
  { value: 'aspect-4/3', label: 'Landscape · 4:3', glyph: 'width' },
  { value: 'aspect-3/4', label: 'Portrait · 3:4', glyph: 'height' },
];

const SizingControlsCore = memo(function SizingControlsCore({
  layer,
  onLayerUpdate,
  parentHasGrid,
}: SizingControlsCoreProps) {
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
  });

  const [isOpen, setIsOpen] = useState(true);

  // Get current values from layer (with inheritance)
  const width = getDesignProperty('sizing', 'width') || '';
  const height = getDesignProperty('sizing', 'height') || '';
  const minWidth = getDesignProperty('sizing', 'minWidth') || '';
  const minHeight = getDesignProperty('sizing', 'minHeight') || '';
  const maxWidth = getDesignProperty('sizing', 'maxWidth') || '';
  const maxHeight = getDesignProperty('sizing', 'maxHeight') || '';
  const overflow = getDesignProperty('sizing', 'overflow') || 'visible';
  const aspectRatio = getDesignProperty('sizing', 'aspectRatio') || '';
  const objectFit = getDesignProperty('sizing', 'objectFit') || '';
  const objectPosition = getDesignProperty('sizing', 'objectPosition') || '';
  const gridColumnSpan = getDesignProperty('sizing', 'gridColumnSpan') || '';
  const gridRowSpan = getDesignProperty('sizing', 'gridRowSpan') || '';

  // Extract aspect ratio value for display (remove brackets)
  const extractAspectRatioValue = (value: string): string => {
    if (!value) return '';
    // Remove brackets: [16/9] → 16/9
    if (value.startsWith('[') && value.endsWith(']')) {
      return value.slice(1, -1);
    }
    return value;
  };

  // Local controlled inputs (prevents repopulation bug)
  const inputs = useControlledInputs({
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
  }, extractMeasurementValue);

  const [widthInput, setWidthInput] = inputs.width;
  const [heightInput, setHeightInput] = inputs.height;
  const [minWidthInput, setMinWidthInput] = inputs.minWidth;
  const [minHeightInput, setMinHeightInput] = inputs.minHeight;
  const [maxWidthInput, setMaxWidthInput] = inputs.maxWidth;
  const [maxHeightInput, setMaxHeightInput] = inputs.maxHeight;

  // Aspect ratio uses custom extraction to remove brackets
  const [aspectRatioInput, setAspectRatioInput] = useState(extractAspectRatioValue(aspectRatio));

  // Sync aspect ratio input when prop changes
  useEffect(() => {
    setAspectRatioInput(extractAspectRatioValue(aspectRatio));
  }, [aspectRatio]);

  // Handle width changes (debounced for text input)
  const handleWidthChange = (value: string) => {
    setWidthInput(value);
    debouncedUpdateDesignProperty('sizing', 'width', normalizeCssControlInput(value) || null);
  };

  // Get current width preset value (for Select display)
  const getWidthPresetValue = () => {
    if (widthInput === '100%') return 'w-[100%]';
    if (widthInput === 'fit') return 'w-fit-content';
    if (widthInput === '100vw') return 'w-[100vw]';
    return '';
  };

  // Preset changes are immediate (button clicks)
  const handleWidthPresetChange = (value: string) => {
    if (value === 'w-[100%]') {
      setWidthInput('100%');
      updateDesignProperty('sizing', 'width', '[100%]');
    } else if (value === 'w-fit-content') {
      setWidthInput('fit');
      updateDesignProperty('sizing', 'width', 'fit');
    } else if (value === 'w-[100vw]') {
      setWidthInput('100vw');
      updateDesignProperty('sizing', 'width', '[100vw]');
    }
  };

  // Handle height changes (debounced for text input)
  const handleHeightChange = (value: string) => {
    setHeightInput(value);
    debouncedUpdateDesignProperty('sizing', 'height', normalizeCssControlInput(value) || null);
  };

  // Get current height preset value (for Select display)
  const getHeightPresetValue = () => {
    if (heightInput === '100%') return 'h-[100%]';
    if (heightInput === 'fit') return 'h-fit-content';
    if (heightInput === '100svh') return 'h-[100svh]';
    return '';
  };

  // Preset changes are immediate (button clicks)
  const handleHeightPresetChange = (value: string) => {
    if (value === 'h-[100%]') {
      setHeightInput('100%');
      updateDesignProperty('sizing', 'height', '[100%]');
    } else if (value === 'h-fit-content') {
      setHeightInput('fit');
      updateDesignProperty('sizing', 'height', 'fit');
    } else if (value === 'h-[100svh]') {
      setHeightInput('100svh');
      updateDesignProperty('sizing', 'height', '[100svh]');
    }
  };

  // Get current min/max width preset values
  const getMinWidthPresetValue = () => {
    if (minWidthInput === '100%') return 'w-[100%]';
    if (minWidthInput === 'fit') return 'w-fit-content';
    if (minWidthInput === '100vw') return 'w-[100vw]';
    return '';
  };

  const getMaxWidthPresetValue = () => {
    if (maxWidthInput === '100%') return 'w-[100%]';
    if (maxWidthInput === 'fit') return 'w-fit-content';
    if (maxWidthInput === '100vw') return 'w-[100vw]';
    return '';
  };

  // Handle min/max width changes (debounced for text input)
  const handleMinWidthChange = (value: string) => {
    setMinWidthInput(value);
    debouncedUpdateDesignProperty('sizing', 'minWidth', normalizeCssControlInput(value) || null);
  };

  const handleMinWidthPresetChange = (value: string) => {
    if (value === 'w-[100%]') {
      setMinWidthInput('100%');
      updateDesignProperty('sizing', 'minWidth', '[100%]');
    } else if (value === 'w-fit-content') {
      setMinWidthInput('fit');
      updateDesignProperty('sizing', 'minWidth', 'fit');
    } else if (value === 'w-[100vw]') {
      setMinWidthInput('100vw');
      updateDesignProperty('sizing', 'minWidth', '[100vw]');
    }
  };

  const handleMaxWidthChange = (value: string) => {
    setMaxWidthInput(value);
    debouncedUpdateDesignProperty('sizing', 'maxWidth', normalizeCssControlInput(value) || null);
  };

  const handleMaxWidthPresetChange = (value: string) => {
    if (value === 'w-[100%]') {
      setMaxWidthInput('100%');
      updateDesignProperty('sizing', 'maxWidth', '[100%]');
    } else if (value === 'w-fit-content') {
      setMaxWidthInput('fit');
      updateDesignProperty('sizing', 'maxWidth', 'fit');
    } else if (value === 'w-[100vw]') {
      setMaxWidthInput('100vw');
      updateDesignProperty('sizing', 'maxWidth', '[100vw]');
    }
  };

  // Get current min/max height preset values
  const getMinHeightPresetValue = () => {
    if (minHeightInput === '100%') return 'h-[100%]';
    if (minHeightInput === '100svh') return 'h-[100svh]';
    return '';
  };

  const getMaxHeightPresetValue = () => {
    if (maxHeightInput === '100%') return 'h-[100%]';
    if (maxHeightInput === '100svh') return 'h-[100svh]';
    return '';
  };

  // Handle min/max height changes (debounced for text input)
  const handleMinHeightChange = (value: string) => {
    setMinHeightInput(value);
    debouncedUpdateDesignProperty('sizing', 'minHeight', normalizeCssControlInput(value) || null);
  };

  const handleMinHeightPresetChange = (value: string) => {
    if (value === 'h-[100%]') {
      setMinHeightInput('100%');
      updateDesignProperty('sizing', 'minHeight', '[100%]');
    } else if (value === 'h-[100svh]') {
      setMinHeightInput('100svh');
      updateDesignProperty('sizing', 'minHeight', '[100svh]');
    }
  };

  const handleMaxHeightChange = (value: string) => {
    setMaxHeightInput(value);
    debouncedUpdateDesignProperty('sizing', 'maxHeight', normalizeCssControlInput(value) || null);
  };

  const handleMaxHeightPresetChange = (value: string) => {
    if (value === 'h-[100%]') {
      setMaxHeightInput('100%');
      updateDesignProperty('sizing', 'maxHeight', '[100%]');
    } else if (value === 'h-[100svh]') {
      setMaxHeightInput('100svh');
      updateDesignProperty('sizing', 'maxHeight', '[100svh]');
    }
  };

  // Handle overflow change
  const handleOverflowChange = (value: string) => {
    updateDesignProperty('sizing', 'overflow', value);
  };

  // Handle aspect ratio changes (debounced for text input)
  const handleAspectRatioChange = (value: string) => {
    setAspectRatioInput(value);
    // Format as [16/9] for arbitrary values
    const formattedValue = value ? `[${value}]` : null;
    debouncedUpdateDesignProperty('sizing', 'aspectRatio', formattedValue);
  };

  // Get current aspect ratio preset value (for Select display)
  const getAspectRatioPresetValue = () => {
    if (aspectRatioInput === '16/9') return 'aspect-video';
    if (aspectRatioInput === '1/1') return 'aspect-square';
    if (aspectRatioInput === '4/3') return 'aspect-4/3';
    if (aspectRatioInput === '3/4') return 'aspect-3/4';
    return '';
  };

  // Preset changes are immediate (dropdown selection)
  const handleAspectRatioPresetChange = (value: string) => {
    if (value === 'aspect-video') {
      setAspectRatioInput('16/9');
      updateDesignProperty('sizing', 'aspectRatio', '[16/9]');
    } else if (value === 'aspect-square') {
      setAspectRatioInput('1/1');
      updateDesignProperty('sizing', 'aspectRatio', '[1/1]');
    } else if (value === 'aspect-4/3') {
      setAspectRatioInput('4/3');
      updateDesignProperty('sizing', 'aspectRatio', '[4/3]');
    } else if (value === 'aspect-3/4') {
      setAspectRatioInput('3/4');
      updateDesignProperty('sizing', 'aspectRatio', '[3/4]');
    } else if (value === 'aspect-auto') {
      setAspectRatioInput('');
      updateDesignProperty('sizing', 'aspectRatio', null);
    }
  };

  const handleAddAspectRatio = () => {
    setAspectRatioInput('1/1');
    updateDesignProperty('sizing', 'aspectRatio', '[1/1]');
  };

  const handleRemoveAspectRatio = () => {
    setAspectRatioInput('');
    updateDesignProperty('sizing', 'aspectRatio', null);
  };

  // Handle object-fit change
  const handleObjectFitChange = (value: string) => {
    updateDesignProperty('sizing', 'objectFit', value || null);
  };

  // Handle object-position change (center is the browser default, so clear it)
  const handleObjectPositionChange = (value: string) => {
    updateDesignProperty('sizing', 'objectPosition', value === 'center' ? null : value);
  };

  // Handle grid column span change
  const handleGridColumnSpanChange = (value: string) => {
    updateDesignProperty('sizing', 'gridColumnSpan', value || null);
  };

  // Handle grid row span change
  const handleGridRowSpanChange = (value: string) => {
    updateDesignProperty('sizing', 'gridRowSpan', value || null);
  };

  return (
    <SettingsPanel
      title="Sizing" isOpen={isOpen}
      onboardingId="design-style-sizing"
      onToggle={() => setIsOpen(!isOpen)}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={handleAddAspectRatio}
              disabled={!!aspectRatio}
            >
              Aspect ratio
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >

{parentHasGrid && (
        <div className="grid grid-cols-3 items-start">
          <Label variant="muted" className="h-8">Span</Label>
          <div className="col-span-2 grid grid-cols-2 gap-2">
            <Select value={gridColumnSpan} onValueChange={handleGridColumnSpanChange}>
              <SelectTrigger data-design-token-property="grid-column">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                  <SelectItem value="9">9</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="11">11</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="full">Full</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={gridRowSpan} onValueChange={handleGridRowSpanChange}>
              <SelectTrigger data-design-token-property="grid-row">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                  <SelectItem value="9">9</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="11">11</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="full">Full</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
)}

      <VisualDimensionField
        label="Width"
        axis="width"
        value={widthInput}
        minValue={minWidthInput}
        maxValue={maxWidthInput}
        onValueChange={handleWidthChange}
        onMinChange={handleMinWidthChange}
        onMaxChange={handleMaxWidthChange}
        presets={WIDTH_PRESETS}
        presetValue={getWidthPresetValue()}
        minPresetValue={getMinWidthPresetValue()}
        maxPresetValue={getMaxWidthPresetValue()}
        onPresetChange={handleWidthPresetChange}
        onMinPresetChange={handleMinWidthPresetChange}
        onMaxPresetChange={handleMaxWidthPresetChange}
        properties={{ value: 'width', min: 'min-width', max: 'max-width' }}
        icons={{
          value: <span className="text-[9px] font-medium">W</span>,
          min: <Icon name="minSize" className="size-3" />,
          max: <Icon name="maxSize" className="size-3" />,
        }}
      />

      <VisualDimensionField
        label="Height"
        axis="height"
        value={heightInput}
        minValue={minHeightInput}
        maxValue={maxHeightInput}
        onValueChange={handleHeightChange}
        onMinChange={handleMinHeightChange}
        onMaxChange={handleMaxHeightChange}
        presets={HEIGHT_PRESETS}
        minPresets={HEIGHT_LIMIT_PRESETS}
        maxPresets={HEIGHT_LIMIT_PRESETS}
        presetValue={getHeightPresetValue()}
        minPresetValue={getMinHeightPresetValue()}
        maxPresetValue={getMaxHeightPresetValue()}
        onPresetChange={handleHeightPresetChange}
        onMinPresetChange={handleMinHeightPresetChange}
        onMaxPresetChange={handleMaxHeightPresetChange}
        properties={{ value: 'height', min: 'min-height', max: 'max-height' }}
        icons={{
          value: <span className="text-[9px] font-medium">H</span>,
          min: <Icon name="minSize" className="size-3 rotate-90" />,
          max: <Icon name="maxSize" className="size-3 rotate-90" />,
        }}
      />

      <VisualSelectField
        label="Overflow"
        value={overflow}
        options={OVERFLOW_OPTIONS}
        onValueChange={handleOverflowChange}
        ariaLabel="Overflow"
        property="overflow"
      />

      {(['image', 'video'].includes(layer?.name || '')) && (
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Object fit</Label>
          <div className="col-span-2 flex items-center gap-1">
            <VisualSelectControl
              value={objectFit || 'fill'}
              options={OBJECT_FIT_OPTIONS}
              onValueChange={handleObjectFitChange}
              ariaLabel="Object fit"
              property="object-fit"
              className="flex-1"
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="input"
                  size="icon-sm"
                  className="rounded-lg"
                  aria-label="Object position"
                  title="Object position"
                  data-design-token-property="object-position"
                >
                  <Icon name={(OBJECT_POSITIONS.find((p) => p.value === (objectPosition || 'center'))?.icon) || 'circle'} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2 my-0.5" align="end">
                <div className="grid grid-cols-3 gap-1">
                  {OBJECT_POSITIONS.map((position) => {
                    const isActive = (objectPosition || 'center') === position.value;
                    return (
                      <Button
                        key={position.value}
                        variant={isActive ? 'secondary' : 'outline'}
                        size="icon-sm"
                        className={`rounded-none ${OBJECT_POSITION_CORNERS[position.value] || ''}`}
                        aria-label={position.label}
                        title={position.label}
                        onClick={() => handleObjectPositionChange(position.value)}
                      >
                        <Icon name={position.icon} className={isActive ? 'text-foreground' : 'opacity-40'} />
                      </Button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {aspectRatio && (
        <VisualMeasurementField
          label="Aspect ratio"
          glyph="fit-contain"
          value={aspectRatioInput}
          onChange={handleAspectRatioChange}
          options={ASPECT_RATIO_PRESETS}
          presetValue={getAspectRatioPresetValue()}
          onPresetChange={handleAspectRatioPresetChange}
          property="aspect-ratio"
          action={(
            <button
              type="button"
              className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
              onClick={handleRemoveAspectRatio}
            >
              <Icon name="x" className="size-2.5" />
            </button>
          )}
        />
      )}

    </SettingsPanel>
  );
});
export default SizingControlsCore;
