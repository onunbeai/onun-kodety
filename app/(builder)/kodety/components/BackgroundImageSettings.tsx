'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { UploadIcon } from '@solar-icons/react/bold-duotone/upload';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  /** Restrict sources when the host cannot provide Kodety assets/CMS bindings. */
  availableSources?: Exclude<BackgroundImageSourceType, 'none'>[];
  defaultSourceType?: Exclude<BackgroundImageSourceType, 'none'>;
}

/** Extracts a plain URL from a css url() value */
function extractImageUrl(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('url(')) {
    return raw.slice(4, -1).replace(/['"]/g, '');
  }
  return raw;
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
  const [pendingSourceType, setPendingSourceType] = useState<Exclude<BackgroundImageSourceType, 'none'> | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const effectiveSourceType = sourceType === 'none' ? pendingSourceType || 'none' : sourceType;
  const bgImageUrl = useMemo(() => extractImageUrl(backgroundImage), [backgroundImage]);
  const displayUrl = bgImageUrl;

  // Local state for custom URL input — syncs from prop, debounces updates to parent
  const [localUrl, setLocalUrl] = useState(bgImageUrl);
  useEffect(() => { setLocalUrl(bgImageUrl); }, [bgImageUrl]);
  useEffect(() => {
    if (sourceType !== 'none') setPendingSourceType(null);
  }, [sourceType]);

  const handleUrlInput = useCallback((value: string) => {
    setLocalUrl(value);
    onBackgroundImageChange(value.trim());
  }, [onBackgroundImageChange]);

  const isActive = effectiveSourceType !== 'none';

  const handleSourceChange = useCallback((type: BackgroundImageSourceType) => {
    setPendingSourceType(type === 'none' ? null : type);
    onSourceTypeChange(type);
  }, [onSourceTypeChange]);

  const handleAdd = useCallback(() => {
    const nextSource = availableSources.includes(defaultSourceType)
      ? defaultSourceType
      : availableSources[0];
    if (nextSource) handleSourceChange(nextSource);
  }, [availableSources, defaultSourceType, handleSourceChange]);

  return (
    <div className="grid grid-cols-3 items-start">
      <Label variant="muted" className="py-2">Image</Label>
      <div className="col-span-2">
        <div className="flex items-center gap-1">
        <Popover
          open={popoverOpen}
          onOpenChange={(open) => {
            setPopoverOpen(open);
            if (!open && sourceType === 'none') setPendingSourceType(null);
          }}
        >
          <PopoverTrigger asChild>
            {isActive ? (
              <Button
                type="button"
                variant="input"
                size="sm"
                className="min-w-0 flex-1 justify-start"
              >
                <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline outline-current/10 outline-offset-[-1px]">
                  <div className="kodety-transparency-swatch absolute inset-0 z-10" />
                  {displayUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={displayUrl}
                      className="absolute inset-0 w-full h-full object-cover z-20"
                      alt=""
                    />
                  )}
                </div>
                <span className="truncate">
                  {effectiveSourceType === 'file_manager' && (bgImageUrl ? 'Image' : 'File manager')}
                  {effectiveSourceType === 'custom_url' && (localUrl || 'Custom URL')}
                  {effectiveSourceType === 'cms' && 'CMS field'}
                </span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="input"
                size="sm"
                className="min-w-0 flex-1 justify-start"
                onClick={handleAdd}
              >
                <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline outline-current/10 outline-offset-[-1px]">
                  <div className="kodety-transparency-swatch absolute inset-0 z-10" />
                </div>
                <span className="dark:opacity-50">Add...</span>
              </Button>
            )}
          </PopoverTrigger>

          {isActive && (
            <PopoverContent panelTitle="Image" className="w-64 my-0.5 flex flex-col gap-2" align="end">
              <div className="grid grid-cols-3 items-center">
                <Label variant="muted">Source</Label>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={effectiveSourceType}
                    onValueChange={(value) => handleSourceChange(value as BackgroundImageSourceType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSources.includes('file_manager') && (
                        <SelectItem value="file_manager"><Icon name="folder" className="size-3" /> File manager</SelectItem>
                      )}
                      {availableSources.includes('custom_url') && (
                        <SelectItem value="custom_url"><Icon name="link" className="size-3" /> Custom URL</SelectItem>
                      )}
                      {availableSources.includes('cms') && (
                        <SelectItem value="cms" disabled={!hasCmsFields}><Icon name="database" className="size-3" /> CMS field</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
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

              <div className="grid grid-cols-3">
                <Label variant="muted">Size</Label>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={backgroundSize || 'cover'}
                    onValueChange={(v) => onBackgroundPropChange('backgroundSize', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="cover">Cover</SelectItem>
                        <SelectItem value="contain">Contain</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3">
                <Label variant="muted">Position</Label>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={backgroundPosition || 'center'}
                    onValueChange={(v) => onBackgroundPropChange('backgroundPosition', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="left-top">Top / Left</SelectItem>
                        <SelectItem value="top">Top / Center</SelectItem>
                        <SelectItem value="right-top">Top / Right</SelectItem>
                        <SelectItem value="left">Center / Left</SelectItem>
                        <SelectItem value="center">Center / Center</SelectItem>
                        <SelectItem value="right">Center / Right</SelectItem>
                        <SelectItem value="left-bottom">Bottom / Left</SelectItem>
                        <SelectItem value="bottom">Bottom / Center</SelectItem>
                        <SelectItem value="right-bottom">Bottom / Right</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3">
                <Label variant="muted">Repeat</Label>
                <div className="col-span-2 *:w-full">
                  <Select
                    value={backgroundRepeat || 'no-repeat'}
                    onValueChange={(v) => onBackgroundPropChange('backgroundRepeat', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="no-repeat">No repeat</SelectItem>
                        <SelectItem value="repeat">Repeat</SelectItem>
                        <SelectItem value="repeat-x">Repeat X</SelectItem>
                        <SelectItem value="repeat-y">Repeat Y</SelectItem>
                        <SelectItem value="repeat-round">Repeat round</SelectItem>
                        <SelectItem value="repeat-space">Repeat space</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </PopoverContent>
          )}
        </Popover>
        {isActive && (
          <Button
            type="button"
            variant="input"
            size="icon-sm"
            className="shrink-0"
            aria-label="Remover imagem de fundo"
            title="Remover imagem de fundo"
            onClick={() => {
              setPopoverOpen(false);
              handleSourceChange('none');
            }}
          >
            <Icon name="x" className="size-3" />
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}
