'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { selectVariants } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import Icon from '@/components/ui/icon';
import { useFontsStore } from '@/stores/useFontsStore';
import {
  ALLOWED_FONT_EXTENSIONS,
  BUILT_IN_FONTS,
  fontFamilyValueMatches,
  getFontDisplayName,
  getFontFamilyValue,
  parseCssFontFamilyList,
} from '@/lib/font-utils';
import {
  fontFamilySelectionValue,
  fontPanelAliases,
  fontPanelAvailability,
  type FontPanelFont,
} from '@/lib/font-panel-utils';
import { loadGoogleFontPreview, resetGoogleFontPreview } from '@/lib/google-font-preview';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import type { Font } from '@/types';

const PAGE_SIZE = 50;
type FontFilter = 'all' | 'google' | 'adobe' | 'uploads';

interface FontPickerProps {
  value: string; // Current fontFamily value (e.g., 'sans', 'Open Sans')
  onChange: (value: string) => void;
  popoverContentClassName?: string;
  triggerClassName?: string;
  triggerIcon?: React.ReactNode;
  /** Native CSS surfaces retain an authored fallback stack when the family changes. */
  preserveCssFallbacks?: boolean;
}

export default function FontPicker({
  value,
  onChange,
  popoverContentClassName,
  triggerClassName,
  triggerIcon,
  preserveCssFallbacks = false,
}: FontPickerProps) {
  const isWordPressRuntime = typeof window !== 'undefined'
    && !!(window as typeof window & { kodetyWordPress?: unknown }).kodetyWordPress;
  const [isOpen, setIsOpen] = useState(false);
  const [fontFilter, setFontFilter] = useState<FontFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [fontToDelete, setFontToDelete] = useState<Font | null>(null);
  const [manualFontFamily, setManualFontFamily] = useState(value || 'inherit');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fontListRef = useRef<HTMLDivElement>(null);

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

  // Re-filter the complete Google catalog as the user types.
  useEffect(() => {
    if (isCatalogLoaded) {
      searchGoogleFonts(debouncedSearch);
      setVisibleCount(PAGE_SIZE);
      fontListRef.current?.scrollTo(0, 0);
    }
  }, [debouncedSearch, isCatalogLoaded, searchGoogleFonts]);

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

  // Infinite scroll for the Google portion of the unified font list.
  const handleFontListScroll = useCallback(() => {
    const el = fontListRef.current;
    if (!el || !hasMore) return;

    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      setVisibleCount(prev => prev + PAGE_SIZE);
    }
  }, [hasMore]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    fontListRef.current?.scrollTo(0, 0);
  }, [fontFilter]);

  // Load Google Font CSS for currently visible fonts
  useEffect(() => {
    if (paginatedGoogleResults.length > 0) {
      loadGoogleFontPreview(paginatedGoogleResults.map(f => f.family));
    }
  }, [paginatedGoogleResults]);

  useEffect(() => {
    setManualFontFamily(value || 'inherit');
  }, [value]);

  const commitManualFontFamily = useCallback(() => {
    const nextValue = manualFontFamily.trim() || 'inherit';
    setManualFontFamily(nextValue);
    if (nextValue !== value) onChange(nextValue);
  }, [manualFontFamily, onChange, value]);

  // Get display label for current value
  const getDisplayLabel = useCallback(() => {
    if (!value || value === 'inherit') return 'Inherit';

    // Check built-in fonts
    const builtIn = BUILT_IN_FONTS.find(f => fontFamilyValueMatches(value, f));
    if (builtIn) return builtIn.family;

    // Check project-local and installed fonts. The authored value may be a
    // complete CSS stack (`"Family", Arial, sans-serif`) rather than the bare
    // catalog family.
    const installed = [...projectFonts, ...projectGoogleFonts, ...fonts, ...adobeFontsCatalog].find(f =>
      fontFamilyValueMatches(value, f)
      || getFontFamilyValue(f) === value
    );
    if (installed) return getFontDisplayName(installed);

    // Format the primary family/slug into a readable name.
    return (parseCssFontFamilyList(value)[0] || value)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }, [value, fonts, projectFonts, projectGoogleFonts, adobeFontsCatalog]);

  // Filter and group installed fonts by type
  const filterBySearch = (font: Font) =>
    !searchQuery
    || font.family.toLowerCase().includes(searchQuery.toLowerCase())
    || (font.displayName || '').toLowerCase().includes(searchQuery.toLowerCase())
    || ('aliases' in font && Array.isArray(font.aliases)
      && font.aliases.some(alias => String(alias).toLowerCase().includes(searchQuery.toLowerCase())));

  const defaultFonts = BUILT_IN_FONTS.filter(filterBySearch);
  const localProjectFonts = projectFonts.filter(filterBySearch);
  const hostedProjectFonts = projectGoogleFonts.filter(filterBySearch);
  const customFonts = fonts.filter(f => f.type === 'custom' && filterBySearch(f));
  const installedGoogleFonts = fonts.filter(f => f.type === 'google' && filterBySearch(f));
  const adobeFonts = adobeFontsCatalog.filter(filterBySearch);
  const hasFilteredResults =
    (fontFilter === 'all' && defaultFonts.length > 0) ||
    ((fontFilter === 'all' || fontFilter === 'uploads') && (localProjectFonts.length > 0 || customFonts.length > 0)) ||
    ((fontFilter === 'all' || fontFilter === 'google') && (hostedProjectFonts.length > 0 || installedGoogleFonts.length > 0 || googleSearchResults.length > 0)) ||
    ((fontFilter === 'all' || fontFilter === 'adobe') && adobeFonts.length > 0);

  // Handle selecting a font
  const handleSelectFont = (font: Font) => {
    const familyValue = fontFamilySelectionValue(
      font as FontPanelFont,
      value,
      preserveCssFallbacks,
    );
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
        const familyValue = fontFamilySelectionValue(
          font as FontPanelFont,
          value,
          preserveCssFallbacks,
        );
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
        const familyValue = fontFamilySelectionValue(
          uploaded[0] as FontPanelFont,
          value,
          preserveCssFallbacks,
        );
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
    const wasSelected = isSelected(fontToDelete);
    await deleteFont(fontToDelete.id);
    if (wasSelected) onChange('inherit');
  };

  // Check if a font is currently selected
  const isSelected = (font: Font) => {
    const familyValue = getFontFamilyValue(font);
    return fontFamilyValueMatches(value, font) || value === familyValue;
  };

  /** Shared class for font option items (matches ShadCN SelectItem styling) */
  const optionClass = `group flex w-full items-center rounded-sm cursor-pointer select-none text-xs hover:bg-accent hover:text-accent-foreground`;

  /** Render a grouped section of fonts with a label */
  const renderFontSection = (
    label: string,
    sectionFonts: Font[],
    options?: {
      deletable?: boolean;
      detailed?: boolean;
      prepend?: React.ReactNode;
      action?: React.ReactNode;
    },
  ) => (
    <React.Fragment key={label}>
      <div className="flex items-center gap-2 px-2 pt-2.5 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 shrink-0">
          {label}
        </span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        {options?.action}
      </div>
      {options?.prepend}
      {sectionFonts.map((font) => {
        const active = isSelected(font);
        const panelFont = font as FontPanelFont;
        const aliases = fontPanelAliases(panelFont);
        const availability = fontPanelAvailability(panelFont);
        const tooltip = [
          getFontDisplayName(font),
          aliases.length ? `Aliases CSS: ${aliases.join(', ')}` : '',
          availability,
        ].filter(Boolean).join('\n');
        return (
          <div
            key={font.id}
            className={optionClass}
          >
            <button
              type="button"
              className={cn(
                'min-w-0 flex-1 cursor-pointer px-2 text-left text-xs',
                options?.detailed ? 'py-2' : 'py-1.5',
              )}
              title={tooltip}
              onClick={() => handleSelectFont(font)}
            >
              <span
                className="block truncate"
                style={{ fontFamily: getFontPreviewFamily(font) }}
              >
                {getFontDisplayName(font)}
              </span>
              {options?.detailed && (
                <>
                  {aliases.length > 0 && (
                    <span className="mt-0.5 block truncate text-[9px] leading-tight text-muted-foreground">
                      CSS: {aliases.join(', ')}
                    </span>
                  )}
                  <span className="mt-0.5 block truncate text-[9px] leading-tight text-muted-foreground">
                    {availability}
                  </span>
                </>
              )}
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
                aria-label={`Delete ${font.family}`}
                title={`Delete ${font.family}`}
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
            data-slot="select-trigger"
            data-variant="default"
            className={cn(
              selectVariants({ variant: 'default', size: 'sm' }),
              'w-full justify-between',
              triggerClassName,
            )}
            title={value || 'inherit'}
          >
            {triggerIcon && (
              <span className="grid size-4 shrink-0 place-items-center text-white/38">
                {triggerIcon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-left">{getDisplayLabel()}</span>
            <Icon name="chevronDown" className="size-2.5 opacity-50" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          panelTitle="Font"
          data-design-token-ui
          className={cn('w-72 p-0', popoverContentClassName)}
          align="end"
        >
          <div className="space-y-2 p-2">
            <div className="relative">
              <Input
                placeholder="Buscar fonte..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pr-8"
                aria-label="Buscar fontes"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="absolute right-1 top-1/2 size-6 -translate-y-1/2 p-0"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpar busca de fontes"
                >
                  <Icon name="x" className="size-3" />
                </Button>
              )}
            </div>

            <select
              value={fontFilter}
              onChange={(event) => setFontFilter(event.target.value as FontFilter)}
              className={cn(selectVariants({ variant: 'default', size: 'sm' }), 'h-8 w-full')}
              aria-label="Filtrar fontes"
            >
              <option value="all">Todos</option>
              <option value="google">Google</option>
              <option value="adobe">Adobe</option>
              <option value="uploads">Uploads</option>
            </select>
          </div>

          <div
            ref={fontListRef}
            className="max-h-80 overflow-y-auto px-1 pb-1"
            onScroll={handleFontListScroll}
          >
            {fontFilter === 'all' && defaultFonts.length > 0 && renderFontSection('Sistema', defaultFonts, {
              prepend: (
                <div className={optionClass}>
                  <button
                    type="button"
                    className="flex-1 cursor-pointer px-2 py-1.5 text-left text-xs"
                    onClick={handleSelectInherit}
                  >
                    Herdar
                  </button>
                  {(!value || value === 'inherit') && (
                    <Icon name="check" className="mr-2 size-3 shrink-0 opacity-50" />
                  )}
                </div>
              ),
            })}

            {(fontFilter === 'all' || fontFilter === 'uploads') && customFonts.length > 0 && (
              renderFontSection('Uploads', customFonts, { deletable: true })
            )}

            {(fontFilter === 'all' || fontFilter === 'uploads') && localProjectFonts.length > 0 && (
              renderFontSection('Fontes do projeto', localProjectFonts, { detailed: true })
            )}
            {(fontFilter === 'all' || fontFilter === 'google') && hostedProjectFonts.length > 0 && (
              renderFontSection('Google do projeto', hostedProjectFonts)
            )}

            {(fontFilter === 'all' || fontFilter === 'google') && installedGoogleFonts.length > 0 && (
              renderFontSection('Google instaladas', installedGoogleFonts, { deletable: true })
            )}

            {adobeFontsConfigured && (fontFilter === 'all' || fontFilter === 'adobe') && (
              renderFontSection('Adobe Fonts', adobeFonts, {
                detailed: true,
                action: (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-6 gap-1 px-1.5 text-[9px]"
                    disabled={isAdobeFontsLoading}
                    onClick={() => void resyncAdobeFontsCatalog()}
                    title="Ressincronizar catálogo do Adobe Fonts"
                  >
                    {isAdobeFontsLoading
                      ? <Spinner className="size-3" />
                      : <Icon name="refresh" className="size-3" />}
                    Ressincronizar
                  </Button>
                ),
                prepend: adobeFontsLastError ? (
                  <div className="px-2 py-1.5 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                    {adobeFontsLastError}
                  </div>
                ) : undefined,
              })
            )}

            {fontFilter === 'adobe' && isAdobeFontsLoading && !isAdobeFontsLoaded && (
              <div className="flex items-center justify-center py-8"><Spinner /></div>
            )}

            {!adobeFontsConfigured && isAdobeFontsLoaded && fontFilter === 'adobe' && (
              <div className="space-y-3 px-3 py-5 text-center">
                <div>
                  <p className="text-xs font-medium text-foreground">Adobe Fonts</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    Conecte um Web Project para usar suas famílias no Builder.
                  </p>
                </div>
                <Button size="sm" className="w-full" onClick={openAdobeFontsSettings}>
                  Conectar Adobe Fonts
                </Button>
              </div>
            )}

            {(fontFilter === 'all' || fontFilter === 'google') && !isCatalogLoaded && (
              <div className="flex items-center justify-center py-6"><Spinner /></div>
            )}

            {(fontFilter === 'all' || fontFilter === 'google') && isCatalogLoaded && paginatedGoogleResults.map((gFont) => {
              const installedFont = [...projectFonts, ...projectGoogleFonts, ...fonts]
                .find(f => fontFamilyValueMatches(gFont.family, f));
              if (installedFont) return null;

              return (
                <div key={gFont.family} className={optionClass}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer truncate px-2 py-1.5 text-left text-xs"
                    style={{ fontFamily: `'${gFont.family}'${categoryFallback(gFont.category)}` }}
                    title={gFont.family}
                    onClick={() => handleAddGoogleFont(gFont)}
                  >
                    {gFont.family}
                  </button>
                </div>
              );
            })}

            {(fontFilter === 'all' || fontFilter === 'google') && isCatalogLoaded && googleSearchResults.length === 0 && (
              <div className="px-2 py-5 text-center text-xs text-muted-foreground">
                {searchQuery ? 'Nenhuma fonte encontrada' : 'Nenhuma fonte Google disponível'}
              </div>
            )}

            {!hasFilteredResults && (searchQuery || fontFilter === 'uploads' || fontFilter === 'adobe')
              && !(fontFilter === 'adobe' && !adobeFontsConfigured) && (
              <div className="px-2 py-5 text-center text-xs text-muted-foreground">
                {fontFilter === 'uploads' && customFonts.length === 0 && localProjectFonts.length === 0
                  ? 'Nenhuma fonte enviada ou encontrada no projeto'
                  : fontFilter === 'adobe'
                    ? 'Nenhuma fonte Adobe disponível neste projeto'
                  : `Nenhuma fonte corresponde a “${searchQuery}”`}
              </div>
            )}

            {hasMore && (fontFilter === 'all' || fontFilter === 'google') && <div className="h-1" />}
          </div>

          {isWordPressRuntime && (
            <div className="border-t border-border/60 p-2">
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                Família CSS do projeto
              </label>
              <Input
                value={manualFontFamily}
                onChange={(event) => setManualFontFamily(event.target.value)}
                onBlur={commitManualFontFamily}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitManualFontFamily();
                  }
                  if (event.key === 'Escape') setManualFontFamily(value || 'inherit');
                }}
                placeholder="Minha Fonte, sans-serif"
                aria-label="Família CSS da fonte"
              />
              <p className="mt-1 text-[9px] leading-snug text-muted-foreground">
                Use uma família já declarada nos arquivos CSS do projeto.
              </p>
            </div>
          )}

          <div className="border-t border-border/60 p-2">
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
              Enviar fonte
            </Button>
          </div>
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
