'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Spinner } from './ui/spinner';
import { ConfirmDialog } from './ui/confirm-dialog';
import Icon from './ui/icon';
import { useFontsStore } from '@/stores/useFontsStore';
import {
  ALLOWED_FONT_EXTENSIONS,
  BUILT_IN_FONTS,
  fontFamilyValueMatches,
  getFontDisplayName,
} from '@/lib/font-utils';
import { fontFamilySelectionValue } from '@/lib/font-panel-utils';
import { loadGoogleFontPreview, resetGoogleFontPreview } from '@/lib/google-font-preview';
import { useDebounce } from '@/hooks/use-debounce';
import type { Font } from '@/types';

const PAGE_SIZE = 50;

interface FontPickerProps {
  value: string; // Current fontFamily value (e.g., 'sans', 'Open Sans')
  onChange: (value: string) => void;
}

export default function FontPicker({ value, onChange }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'installed' | 'google' | 'adobe'>('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [fontToDelete, setFontToDelete] = useState<Font | null>(null);
  const debouncedSearch = useDebounce(searchQuery, 300);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const googleListRef = useRef<HTMLDivElement>(null);

  const {
    fonts,
    projectFonts,
    projectGoogleFonts,
    isLoaded,
    loadFonts,
    googleSearchResults,
    isCatalogLoaded,
    loadGoogleFontsCatalog,
    adobeFontsCatalog,
    adobeFontsConfigured,
    adobeFontsLastError,
    isAdobeFontsLoading,
    isAdobeFontsLoaded,
    loadAdobeFontsCatalog,
    resyncAdobeFontsCatalog,
    searchGoogleFonts,
    addGoogleFont,
    uploadCustomFonts,
    deleteFont,
  } = useFontsStore();

  // Load installed fonts + Google catalog on mount (not waiting for popover)
  useEffect(() => {
    if (!isLoaded) loadFonts();
    loadGoogleFontsCatalog();
    loadAdobeFontsCatalog();
  }, [isLoaded, loadAdobeFontsCatalog, loadFonts, loadGoogleFontsCatalog]);

  // Populate search results as soon as catalog is ready (enables preloading)
  useEffect(() => {
    if (isCatalogLoaded) {
      searchGoogleFonts('');
    }
  }, [isCatalogLoaded, searchGoogleFonts]);

  // Re-filter when search query changes on Google tab
  useEffect(() => {
    if (activeTab === 'google' && isCatalogLoaded) {
      searchGoogleFonts(debouncedSearch);
      setVisibleCount(PAGE_SIZE);
      googleListRef.current?.scrollTo(0, 0);
    }
  }, [activeTab, debouncedSearch, isCatalogLoaded, searchGoogleFonts]);

  // Preload first 50 Google Font faces once results are populated
  useEffect(() => {
    if (googleSearchResults.length > 0) {
      loadGoogleFontPreview(googleSearchResults.slice(0, 50).map(f => f.family));
    }
  }, [googleSearchResults]);

  // Reset pagination when popover closes; clean up font CSS on unmount
  useEffect(() => {
    if (!isOpen) {
      setVisibleCount(PAGE_SIZE);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => resetGoogleFontPreview();
  }, []);

  // Paginated Google results
  const paginatedGoogleResults = useMemo(
    () => googleSearchResults.slice(0, visibleCount),
    [googleSearchResults, visibleCount]
  );
  const hasMore = visibleCount < googleSearchResults.length;

  // Infinite scroll via scroll event on the Google list container
  const handleGoogleScroll = useCallback(() => {
    const el = googleListRef.current;
    if (!el || !hasMore) return;

    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      setVisibleCount(prev => prev + PAGE_SIZE);
    }
  }, [hasMore]);

  // Load Google Font CSS for currently visible fonts
  useEffect(() => {
    if (paginatedGoogleResults.length > 0) {
      loadGoogleFontPreview(paginatedGoogleResults.map(f => f.family));
    }
  }, [paginatedGoogleResults]);

  // Get display label for current value
  const getDisplayLabel = useCallback(() => {
    if (!value || value === 'inherit') return 'Inherit';

    // Check built-in fonts
    const builtIn = BUILT_IN_FONTS.find(f => fontFamilyValueMatches(value, f));
    if (builtIn) return builtIn.family;

    // Check installed fonts
    const installed = [...projectFonts, ...projectGoogleFonts, ...fonts, ...adobeFontsCatalog]
      .find(f => fontFamilyValueMatches(value, f));
    if (installed) return getFontDisplayName(installed);

    // Format slug (e.g. "open-sans" or "open_sans") into readable name
    return value
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }, [value, fonts, projectFonts, projectGoogleFonts, adobeFontsCatalog]);

  // Filter and group installed fonts by type
  const filterBySearch = (font: Font) =>
    !searchQuery
    || font.family.toLowerCase().includes(searchQuery.toLowerCase())
    || (font.displayName || '').toLowerCase().includes(searchQuery.toLowerCase())
    || (font.aliases || []).some(alias => alias.toLowerCase().includes(searchQuery.toLowerCase()));

  const defaultFonts = BUILT_IN_FONTS.filter(filterBySearch);
  const importedFonts = [...projectFonts, ...projectGoogleFonts].filter(filterBySearch);
  const customFonts = fonts.filter(f => f.type === 'custom' && filterBySearch(f));
  const googleFonts = fonts.filter(f => f.type === 'google' && filterBySearch(f));
  const adobeFonts = adobeFontsCatalog.filter(filterBySearch);
  const hasFilteredResults = defaultFonts.length > 0 || customFonts.length > 0 || googleFonts.length > 0 || importedFonts.length > 0;

  // Handle selecting a font
  const handleSelectFont = (font: Font) => {
    const familyValue = fontFamilySelectionValue(font, value, true);
    onChange(familyValue);
  };

  // Handle selecting "Inherit" (remove font)
  const handleSelectInherit = () => {
    onChange('inherit');
  };

  const openAdobeFontsSettings = () => {
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent('kodety:open-adobe-fonts-settings'));
  };

  // Handle adding a Google Font
  const handleAddGoogleFont = async (googleFont: { family: string; variants: string[]; category: string }) => {
    try {
      const font = await addGoogleFont(googleFont as any);
      if (font) {
        const familyValue = fontFamilySelectionValue(font, value, true);
        onChange(familyValue);
      }
    } catch (error) {
      console.error('Failed to add Google Font:', error);
    }
  };

  // Handle custom font upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    try {
      const uploaded = await uploadCustomFonts(files);
      if (uploaded.length > 0) {
        const familyValue = fontFamilySelectionValue(uploaded[0], value, true);
        onChange(familyValue);
      }
    } catch (error) {
      console.error('Failed to upload fonts:', error);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle deleting a font
  const handleDeleteFont = (e: React.MouseEvent, fontId: string) => {
    e.stopPropagation();
    const font = fonts.find(f => f.id === fontId);
    if (font) setFontToDelete(font);
  };

  const confirmDeleteFont = async () => {
    if (!fontToDelete) return;
    try {
      const wasSelected = isSelected(fontToDelete);
      await deleteFont(fontToDelete.id);
      if (wasSelected) onChange('inherit');
    } catch (error) {
      console.error('Failed to delete font:', error);
    }
  };

  // Check if a font is currently selected
  const isSelected = (font: Font) => {
    return fontFamilyValueMatches(value, font);
  };

  /** Shared class for font option items (matches ShadCN SelectItem styling) */
  const optionClass = `group flex w-full items-center rounded-sm cursor-pointer select-none text-xs hover:bg-accent hover:text-accent-foreground`;

  /** Render a grouped section of fonts with a label */
  const renderFontSection = (label: string, sectionFonts: Font[], options?: { deletable?: boolean; prepend?: React.ReactNode }) => (
    <React.Fragment key={label}>
      <div className="flex items-center gap-2 px-2 pt-2.5 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 shrink-0">
          {label}
        </span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
      </div>
      {options?.prepend}
      {sectionFonts.map((font) => {
        const active = isSelected(font);
        return (
          <div
            key={font.id}
            className={optionClass}
          >
            <button
              className="flex-1 text-left px-2 py-1.5 text-xs truncate cursor-pointer"
              style={{ fontFamily: getFontPreviewFamily(font) }}
              data-kodety-no-i18n title={font.family}
              onClick={() => handleSelectFont(font)}
            >
              {getFontDisplayName(font)}
            </button>

            {active && !options?.deletable && (
              <Icon name="check" className="size-3 opacity-50 shrink-0 mr-2" />
            )}

            {options?.deletable && (
              active ? (
                <Icon name="check" className="size-3 opacity-50 shrink-0 mr-2 group-hover:hidden" />
              ) : null
            )}
            {options?.deletable && (
              <Button
                variant="ghost"
                size="xs"
                className={`shrink-0 mr-1 ${active ? 'hidden group-hover:flex opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={(e) => handleDeleteFont(e, font.id)}
              >
                <Icon name="x" className="size-3" />
              </Button>
            )}
          </div>
        );
      })}
    </React.Fragment>
  );

  /** CSS font-family for an installed font (default fonts use system stacks) */
  const getFontPreviewFamily = (font: Font): string => {
    if (font.type === 'default') {
      switch (font.name) {
        case 'sans': return 'ui-sans-serif, system-ui, sans-serif';
        case 'serif': return 'ui-serif, Georgia, serif';
        case 'mono': return 'ui-monospace, monospace';
        default: {
          const fallback = font.category === 'serif' ? 'serif'
            : font.category === 'monospace' ? 'monospace'
              : 'sans-serif';
          return `'${font.family}', ${fallback}`;
        }
      }
    }
    if (font.type === 'adobe' && font.cssStack?.trim()) return font.cssStack;
    const fallback = font.category === 'serif' ? 'serif'
      : font.category === 'monospace' ? 'monospace' : 'sans-serif';
    return `'${font.family}', ${fallback}`;
  };

  /** CSS fallback stack per Google Font category */
  const categoryFallback = (category: string) => {
    switch (category) {
      case 'serif': return ', serif';
      case 'monospace': return ', monospace';
      case 'handwriting': return ', cursive';
      case 'display': return ', system-ui';
      default: return ', sans-serif';
    }
  };

  return (
    <>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setSearchQuery('');
        }}
        modal
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Font family"
            data-slot="select-trigger"
            data-variant="default"
            className="group/font-trigger flex h-8 w-full min-w-0 items-center overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] px-2 text-left text-[11px] text-foreground outline-none transition-[border-color,background-color] hover:bg-white/[.065] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:bg-white/[.065] data-[state=open]:border-[var(--kodety-focus)]/65 data-[state=open]:bg-white/[.065]"
          >
            <span
              aria-hidden="true"
              className="mr-2 grid size-4 shrink-0 place-items-center text-[9px] font-medium leading-none text-white/38 transition-colors group-hover/font-trigger:text-white/58 group-data-[state=open]/font-trigger:text-[var(--kodety-accent-hover)]"
              style={{ fontFamily: value && value !== 'inherit' ? value : 'inherit' }}
            >
              Aa
            </span>
            <span data-kodety-no-i18n={value && value !== 'inherit' ? true : undefined} title={value || undefined} className="min-w-0 flex-1 truncate">{getDisplayLabel()}</span>
            <Icon name="chevronDown" className="ml-2 size-3 shrink-0 text-white/32" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-56 p-0" align="end">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'installed' | 'google' | 'adobe')}
          >
            <div className="px-2 pt-2">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="installed">Installed</TabsTrigger>
                <TabsTrigger value="google">Google</TabsTrigger>
                <TabsTrigger value="adobe">Adobe</TabsTrigger>
              </TabsList>
            </div>

            <div className="relative px-2">
              <Input
                placeholder={activeTab === 'google'
                  ? 'Filter Google fonts...'
                  : activeTab === 'adobe'
                    ? 'Filter Adobe fonts...'
                    : 'Filter installed fonts...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pr-8"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="absolute right-4 top-1/2 -translate-y-1/2 size-6 p-0"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  <Icon name="x" className="size-3" />
                </Button>
              )}
            </div>

            {/* Installed Fonts Tab */}
            <TabsContent value="installed" className="mt-0">
              <div className="max-h-80 overflow-y-auto px-1 pb-1">
                {importedFonts.length > 0 && renderFontSection('Project', importedFonts)}
                {customFonts.length > 0 && renderFontSection('Custom', customFonts, { deletable: true })}
                {googleFonts.length > 0 && renderFontSection('Google', googleFonts, { deletable: true })}
                {defaultFonts.length > 0 && renderFontSection('Default', defaultFonts, {
                  prepend: (
                    <div className={optionClass}>
                      <button
                        className="flex-1 text-left px-2 py-1.5 text-xs cursor-pointer"
                        onClick={handleSelectInherit}
                      >
                        Inherit
                      </button>
                      {(!value || value === 'inherit') && (
                        <Icon name="check" className="size-3 opacity-50 shrink-0 mr-2" />
                      )}
                    </div>
                  ),
                })}

                {!hasFilteredResults && searchQuery && (
                  <div className="px-2 py-5 text-center text-xs">
                    No fonts match &quot;{searchQuery}&quot;
                  </div>
                )}
              </div>

              {/* Upload custom font */}
              <div className="p-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={ALLOWED_FONT_EXTENSIONS.map(ext => `.${ext}`).join(',')}
                  multiple
                  onChange={handleFileUpload}
                />
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload font
                </Button>
              </div>
            </TabsContent>

            {/* Google Fonts Tab */}
            <TabsContent value="google" className="mt-0">
              <div
                ref={googleListRef}
                className="max-h-80 overflow-y-auto px-1 pb-1"
                onScroll={handleGoogleScroll}
              >
                {!isCatalogLoaded && (
                  <div className="flex items-center justify-center py-6">
                    <Spinner />
                  </div>
                )}

                {isCatalogLoaded && googleSearchResults.length === 0 && (
                  <div className="px-2 py-4 text-center text-xs text-zinc-500">
                    {searchQuery ? 'No fonts found' : 'No Google Fonts available'}
                  </div>
                )}

                {isCatalogLoaded && paginatedGoogleResults.map((gFont) => {
                  const projectFont = [...projectFonts, ...projectGoogleFonts]
                    .find(f => fontFamilyValueMatches(gFont.family, f));
                  const installedFont = projectFont || fonts.find(f =>
                    f.family === gFont.family && f.type === 'google'
                  );

                  const handleClick = () => {
                    if (installedFont) {
                      onChange(fontFamilySelectionValue(installedFont, value, true));
                    } else {
                      handleAddGoogleFont(gFont);
                    }
                  };

                  return (
                    <div
                      key={gFont.family}
                      className="flex w-full items-center rounded-sm select-none text-xs cursor-pointer hover:bg-accent hover:text-accent-foreground"
                    >
                      <button
                        className="flex-1 text-left px-2 py-1.5 text-xs truncate min-w-0 cursor-pointer"
                        style={{ fontFamily: `'${gFont.family}'${categoryFallback(gFont.category)}` }}
                        onClick={handleClick}
                      >
                        <span data-kodety-no-i18n title={gFont.family}>{gFont.family}</span>
                        {installedFont && (
                          <span className="ml-1.5 text-[10px] opacity-50 font-sans">
                            {projectFont ? 'Project' : 'Installed'}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}

                {/* Spacer to trigger scroll near bottom */}
                {hasMore && <div className="h-1" />}
              </div>
            </TabsContent>

            <TabsContent value="adobe" className="mt-0">
              {isAdobeFontsLoading && !isAdobeFontsLoaded ? (
                <div className="flex items-center justify-center py-8"><Spinner /></div>
              ) : !adobeFontsConfigured ? (
                <div className="space-y-3 px-3 py-5 text-center">
                  <div>
                    <p className="text-xs font-medium text-foreground">Adobe Fonts</p>
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      Connect a Web Project to use its font families in the Builder.
                    </p>
                  </div>
                  <Button size="sm" className="w-full" onClick={openAdobeFontsSettings}>
                    Connect Adobe Fonts
                  </Button>
                </div>
              ) : (
                <>
                <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    {adobeFonts.length} {adobeFonts.length === 1 ? 'font' : 'fonts'}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-6 gap-1 px-1.5 text-[9px]"
                    disabled={isAdobeFontsLoading}
                    onClick={() => void resyncAdobeFontsCatalog()}
                    title="Resync Adobe Fonts catalog"
                  >
                    {isAdobeFontsLoading
                      ? <Spinner className="size-3" />
                      : <Icon name="refresh" className="size-3" />}
                    Resync
                  </Button>
                </div>
                {adobeFontsLastError && (
                  <div className="px-2 py-1.5 text-[10px] leading-snug text-amber-400">
                    {adobeFontsLastError}
                  </div>
                )}
                <div className="max-h-80 overflow-y-auto px-1 pb-1">
                  {adobeFonts.length > 0 && renderFontSection('Adobe Fonts', adobeFonts)}
                  {adobeFonts.length === 0 && !isAdobeFontsLoading && (
                    <div className="px-2 py-4 text-center text-xs text-zinc-500">
                      {searchQuery ? 'No fonts found' : 'No Adobe Fonts available'}
                    </div>
                  )}
                  {isAdobeFontsLoading && adobeFonts.length === 0 && (
                    <div className="flex items-center justify-center py-6"><Spinner /></div>
                  )}
                </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={!!fontToDelete}
        onOpenChange={(open) => { if (!open) setFontToDelete(null); }}
        title="Delete font"
        description={`Are you sure you want to remove the font "${fontToDelete?.family}"? All text elements using this font will no longer be able to display it.`}
        confirmLabel="Delete"
        onConfirm={confirmDeleteFont}
      />
    </>
  );
}
