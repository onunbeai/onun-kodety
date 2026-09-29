'use client';

import { cssImagePreviewUrl } from '@/lib/html-editor/css-image-url';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Icon } from './ui/icon';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { UploadIcon } from '@solar-icons/react/bold-duotone/upload';
import {
  VisualSegmentedField,
  VisualSelectControl,
  VisualSelectField,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';
import { cn } from '@/lib/utils';

/** Background image source types */
export type BackgroundImageSourceType = 'none' | 'file_manager' | 'custom_url' | 'cms';

interface BackgroundImageSettingsProps {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  sourceType: BackgroundImageSourceType;
  hasCmsFields: boolean;
  onBackgroundImageChange: (value: string, immediate?: boolean) => void;
  /** Generic handler for size, position, repeat changes */
  onBackgroundPropChange: (property: string, value: string) => void;
  onSourceTypeChange: (type: BackgroundImageSourceType) => void;
  onOpenFileManager: () => void;
  /** Render the CMS field selector dropdown */
  renderFieldSelector: () => React.ReactNode;
  /** Restrict sources to those supported by the active editor runtime. */
  availableSources?: Exclude<BackgroundImageSourceType, 'none'>[];
  defaultSourceType?: Exclude<BackgroundImageSourceType, 'none'>;
}

const BACKGROUND_SIZE_OPTIONS: VisualStyleOption[] = [
  { value: 'auto', label: 'Auto', glyph: 'fit-none' },
  { value: 'cover', label: 'Cover', glyph: 'fit-cover' },
  { value: 'contain', label: 'Contain', glyph: 'fit-contain' },
];
const BACKGROUND_SOURCE_OPTIONS: VisualStyleOption[] = [
  { value: 'file_manager', label: 'Media library', glyph: 'fit-cover', description: 'Biblioteca do WordPress' },
  { value: 'custom_url', label: 'Custom URL', glyph: 'width', description: 'Imagem externa' },
  { value: 'cms', label: 'CMS field', glyph: 'grid', description: 'Imagem dinâmica' },
];
const BACKGROUND_REPEAT_OPTIONS: VisualStyleOption[] = [
  { value: 'no-repeat', label: 'No repeat', glyph: 'image-repeat' },
  { value: 'repeat', label: 'Repeat', glyph: 'image-repeat' },
  { value: 'repeat-x', label: 'Repeat X', glyph: 'columns' },
  { value: 'repeat-y', label: 'Repeat Y', glyph: 'rows' },
  { value: 'repeat-round', label: 'Round', glyph: 'image-repeat' },
  { value: 'repeat-space', label: 'Space', glyph: 'image-repeat' },
];
const BACKGROUND_POSITIONS = [
  ['left-top', 'Top left'],
  ['top', 'Top center'],
  ['right-top', 'Top right'],
  ['left', 'Center left'],
  ['center', 'Center'],
  ['right', 'Center right'],
  ['left-bottom', 'Bottom left'],
  ['bottom', 'Bottom center'],
  ['right-bottom', 'Bottom right'],
] as const;

function BackgroundPositionField({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <span className="flex h-8 items-center text-[11px] text-muted-foreground">Position</span>
      <div
        className="kodety-visual-style-control col-span-2 grid h-[72px] min-w-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-[8px] border border-transparent bg-white/[.05] p-1 focus-within:border-[var(--kodety-focus)]/65"
        data-design-token-control
        data-design-token-property="background-position"
      >
        {BACKGROUND_POSITIONS.map(([position, label]) => {
          const selected = (value || 'center') === position;
          return (
            <Tooltip key={position}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => onChange(position)}
                  className={cn(
                    'group grid min-w-0 place-items-center rounded-[5px] border-0 bg-transparent text-white/28 outline-none transition-colors hover:bg-white/[.055] hover:text-white/65 focus-visible:bg-white/[.07] focus-visible:text-white',
                    selected && 'bg-white/[.13] text-white',
                  )}
                >
                  <span className={cn('size-1 rounded-full bg-current transition-transform', selected && 'scale-125')} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/** Background image source, preview, and size/position/repeat controls */
export default function BackgroundImageSettings({
  backgroundImage,
  backgroundSize,
  backgroundPosition,
  backgroundRepeat,
  sourceType,
  hasCmsFields,
  onBackgroundImageChange,
  onBackgroundPropChange,
  onSourceTypeChange,
  onOpenFileManager,
  renderFieldSelector,
  availableSources = ['file_manager', 'custom_url', 'cms'],
  defaultSourceType = 'file_manager',
}: BackgroundImageSettingsProps) {
  const bgImageUrl = useMemo(() => cssImagePreviewUrl(backgroundImage), [backgroundImage]);
  const [pendingSourceType, setPendingSourceType] = useState<Exclude<BackgroundImageSourceType, 'none'> | null>(null);
  const effectiveSourceType = pendingSourceType || (sourceType === 'none' ? null : sourceType);
  const displayUrl = bgImageUrl;

  // Local state for custom URL input — syncs from prop, debounces updates to parent
  const [localUrl, setLocalUrl] = useState(bgImageUrl);
  const [popoverOpen, setPopoverOpen] = useState(false);
  useEffect(() => { setLocalUrl(bgImageUrl); }, [bgImageUrl]);
  useEffect(() => {
    if (pendingSourceType && sourceType === pendingSourceType) setPendingSourceType(null);
  }, [pendingSourceType, sourceType]);

  const handleUrlInput = useCallback((value: string) => {
    setLocalUrl(value);
    onBackgroundImageChange(value.trim());
  }, [onBackgroundImageChange]);

  const isActive = effectiveSourceType !== null;

  const handleSourceChange = useCallback((type: BackgroundImageSourceType) => {
    setPendingSourceType(type === 'none' ? null : type);
    onSourceTypeChange(type);
  }, [onSourceTypeChange]);

  const handlePopoverOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && sourceType === 'none' && !pendingSourceType) {
      const nextSource = availableSources.includes(defaultSourceType)
        ? defaultSourceType
        : availableSources[0];
      if (nextSource) handleSourceChange(nextSource);
    }
    setPopoverOpen(nextOpen);
    if (!nextOpen && sourceType === 'none') setPendingSourceType(null);
  }, [availableSources, defaultSourceType, handleSourceChange, pendingSourceType, sourceType]);

  return (
    <div className="grid grid-cols-3 items-start">
      <Label variant="muted" className="py-2">Image</Label>
      <div className="col-span-2 *:w-full">
        <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
          <div
            className="kodety-visual-style-control flex h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]"
            data-design-token-control
            data-design-token-property="background-image"
          >
            {isActive ? (
              <>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="group/background-trigger flex h-full min-w-0 flex-1 items-center px-2.5 text-left text-[11px] text-foreground outline-none"
                    title="Editar imagem de fundo"
                  >
                    <span className="kodety-transparency-preview mr-2 -ml-1">
                      <span className="kodety-transparency-swatch absolute inset-0 z-10" />
                      {displayUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={displayUrl}
                          className="absolute inset-0 z-20 size-full object-cover"
                          alt=""
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {effectiveSourceType === 'file_manager' && (bgImageUrl ? 'Image' : 'Media library')}
                      {effectiveSourceType === 'custom_url' && (localUrl || 'Custom URL')}
                      {effectiveSourceType === 'cms' && 'CMS field'}
                    </span>
                    <Icon name="chevronDown" className="ml-2 size-3 shrink-0 text-white/32" />
                  </button>
                </PopoverTrigger>
                <button
                  type="button"
                  className="grid h-full w-8 shrink-0 place-items-center border-0 border-l border-white/[.055] bg-transparent text-white/36 outline-none transition-colors hover:bg-white/[.055] hover:text-white/75 focus-visible:bg-white/[.07] focus-visible:text-white"
                  aria-label="Remover imagem de fundo"
                  title="Remover imagem de fundo"
                  onClick={() => {
                    setPopoverOpen(false);
                    handleSourceChange('none');
                  }}
                >
                  <Icon name="x" className="size-2.5" />
                </button>
              </>
            ) : (
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center px-2.5 text-left text-[11px] text-muted-foreground outline-none"
                >
                  <span className="kodety-transparency-preview mr-2 -ml-1">
                    <span className="kodety-transparency-swatch absolute inset-0" />
                  </span>
                  <span>Add...</span>
                </button>
              </PopoverTrigger>
            )}
          </div>

            <PopoverContent className="w-64 my-0.5 flex flex-col gap-2" align="end">
              <div className="grid grid-cols-3 items-center">
                <Label variant="muted">Source</Label>
                <div className="col-span-2 *:w-full">
                  <VisualSelectControl
                    value={effectiveSourceType || defaultSourceType}
                    options={BACKGROUND_SOURCE_OPTIONS
                      .filter(option => availableSources.includes(option.value as Exclude<BackgroundImageSourceType, 'none'>))
                      .map(option => option.value === 'cms'
                        ? { ...option, disabled: !hasCmsFields }
                        : option)}
                    onValueChange={value => handleSourceChange(value as BackgroundImageSourceType)}
                    ariaLabel="Background image source"
                  />
                </div>
              </div>

              {effectiveSourceType === 'file_manager' && (
                <div className="grid grid-cols-3 items-start">
                  <Label variant="muted" className="pt-2">File</Label>
                  <div className="col-span-2">
                    <button
                      type="button"
                      data-background-image-upload
                      className="group flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-[8px] border border-white/[.075] bg-white/[.035] text-white/46 outline-none transition-[border-color,background-color,color] hover:border-[var(--kodety-accent-hover)]/70 hover:bg-white/[.055] hover:text-[var(--kodety-accent-hover)] focus-visible:border-[var(--kodety-accent-hover)]/70 focus-visible:bg-white/[.055] focus-visible:text-[var(--kodety-accent-hover)]"
                      onClick={onOpenFileManager}
                      aria-label={bgImageUrl ? 'Replace background image' : 'Upload background image'}
                    >
                      <span className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-white/[.09] bg-white/[.06] px-3 text-[11px] font-medium text-current transition-[border-color,background-color] group-hover:border-[var(--kodety-accent-hover)]/35 group-hover:bg-[var(--kodety-accent-hover)]/10 group-focus-visible:border-[var(--kodety-accent-hover)]/35 group-focus-visible:bg-[var(--kodety-accent-hover)]/10">
                        <UploadIcon className="size-4" />
                        Upload
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {effectiveSourceType === 'custom_url' && (
                <div className="grid grid-cols-3 items-start">
                  <Label variant="muted" className="pt-2">URL</Label>
                  <div className="col-span-2">
                    <Input
                      type="text"
                      value={localUrl}
                      onChange={(e) => handleUrlInput(e.target.value)}
                      placeholder="https://example.com/image.jpg"
                    />
                  </div>
                </div>
              )}

              {effectiveSourceType === 'cms' && (
                <div className="grid grid-cols-3 items-center">
                  <Label variant="muted">Field</Label>
                  <div className="col-span-2 w-full">
                    {renderFieldSelector()}
                  </div>
                </div>
              )}

              <VisualSegmentedField
                label="Size"
                value={backgroundSize || 'cover'}
                options={BACKGROUND_SIZE_OPTIONS}
                onValueChange={value => onBackgroundPropChange('backgroundSize', value)}
                property="background-size"
              />

              <BackgroundPositionField
                value={backgroundPosition || 'center'}
                onChange={value => onBackgroundPropChange('backgroundPosition', value)}
              />

              <VisualSelectField
                label="Repeat"
                value={backgroundRepeat || 'no-repeat'}
                options={BACKGROUND_REPEAT_OPTIONS}
                onValueChange={value => onBackgroundPropChange('backgroundRepeat', value)}
                glyph="image-repeat"
                ariaLabel="Background repeat"
                property="background-repeat"
              />
            </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
