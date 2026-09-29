'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useControlledInput } from '@/hooks/use-controlled-input';
import { useEditorStore } from '@/stores/useEditorStore';
import { useFontsStore } from '@/stores/useFontsStore';
import { extractMeasurementValue } from '@/lib/measurement-utils';
import {
  convertLetterSpacingUnit,
  parseLetterSpacingValue,
  serializeLetterSpacingDraft,
  type LetterSpacingUnit,
} from '@/lib/letter-spacing-units';
import { removeSpaces } from '@/lib/utils';
import {
  BUILT_IN_FONTS,
  fontFamilyValueMatches,
  getFontFamilyValue,
} from '@/lib/font-utils';
import {
  fontPanelStyleOptions,
  fontPanelWeightOptions,
  nearestFontPanelStyle,
  nearestFontPanelWeight,
  normalizeFontPanelStyle,
  normalizeFontPanelWeight,
  type FontPanelFont,
} from '@/lib/font-panel-utils';
import { buildBgImgVarName } from '@/lib/tailwind-class-mapper';
import { isTextContentLayer } from '@/lib/layer-utils';
import type { Collection, CollectionField, Layer } from '@/types';
import type { FieldGroup } from '@/lib/collection-field-utils';
import ColorPropertyField from './ColorPropertyField';
import FontPicker from './FontPicker';
import TextBackgroundImageTab from './TextBackgroundImageTab';
import type { TextBackgroundImageTabHandle } from './TextBackgroundImageTab';
import SettingsPanel from './SettingsPanel';

interface TypographyControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onInteractionCancel?: () => void;
  /** The HTML editor writes native CSS and can retain complete fallback stacks. */
  nativeCss?: boolean;
}

const LETTER_SPACING_UNIT_OPTIONS: Array<{ value: LetterSpacingUnit; label: string }> = [
  { value: 'px', label: 'Px' },
  { value: 'em', label: 'Em' },
  { value: 'rem', label: 'Rem' },
  { value: '%', label: '%' },
];

function LetterSpacingControl({
  value,
  currentFontSize,
  onChange,
}: {
  value: string;
  currentFontSize: string;
  onChange(value: string): void;
}) {
  const parsed = parseLetterSpacingValue(value);
  const selectedUnitLabel = LETTER_SPACING_UNIT_OPTIONS.find(option => option.value === parsed.unit)?.label || 'Em';
  const handleDraftChange = (draft: string) => {
    onChange(serializeLetterSpacingDraft(draft, parsed.unit));
  };

  return (
    <div className="flex min-w-0 gap-1" data-design-token-property="letter-spacing">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <Tooltip>
            <TooltipTrigger>
              <Icon name="letterSpacing" className="size-3" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Letter spacing</p>
            </TooltipContent>
          </Tooltip>
        </InputGroupAddon>
        <InputGroupInput
          className="pr-0!"
          value={parsed.numeric}
          onChange={(event) => handleDraftChange(event.target.value)}
          onStepperChange={handleDraftChange}
          stepper
          step="0.1"
        />
      </InputGroup>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Unit for letter spacing: ${selectedUnitLabel}`}
            className="flex h-8 w-12 shrink-0 items-center justify-center gap-1 rounded-lg border border-border/70 bg-transparent text-[10px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
          >
            <span>{selectedUnitLabel}</span>
            <Icon name="chevronDown" className="size-2.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-28">
          {LETTER_SPACING_UNIT_OPTIONS.map(option => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(convertLetterSpacingUnit(value, option.value, currentFontSize))}
              disabled={parsed.number === null}
            >
              <span className="min-w-0 flex-1">{option.label}</span>
              {parsed.unit === option.value && <span className="text-primary">✓</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const TypographyControls = memo(function TypographyControls({ layer, onLayerUpdate, activeTextStyleKey, fieldGroups, allFields, collections, onInteractionStart, onInteractionEnd, onInteractionCancel, nativeCss = false }: TypographyControlsProps) {
  const [sectionOpen, setSectionOpen] = useState(false);
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const showTextStyleControls = useEditorStore((state) => state.showTextStyleControls());
  const { updateDesignProperty, updateDesignProperties, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  // Subscribe to both catalogs rather than only reading the stable store
  // action. ZIP fonts arrive after the inspector's first render, and the
  // weight/style controls must refresh as soon as that catalog is ready.
  const installedFonts = useFontsStore((state) => state.fonts);
  const projectFonts = useFontsStore((state) => state.projectFonts);
  const projectGoogleFonts = useFontsStore((state) => state.projectGoogleFonts);
  const adobeFonts = useFontsStore((state) => state.adobeFontsCatalog);

  // Get current values from layer (with inheritance)
  const fontFamily = getDesignProperty('typography', 'fontFamily') || '';
  const fontWeightRaw = getDesignProperty('typography', 'fontWeight') || 'normal';
  const fontStyleRaw = getDesignProperty('typography', 'fontStyle') || 'normal';
  const fontSize = getDesignProperty('typography', 'fontSize') || '';
  const textAlign = getDesignProperty('typography', 'textAlign') || 'left';
  const letterSpacing = getDesignProperty('typography', 'letterSpacing') || '';
  const lineHeight = getDesignProperty('typography', 'lineHeight') || '';
  const color = getDesignProperty('typography', 'color') || '';
  const textTransform = getDesignProperty('typography', 'textTransform') || 'none';
  const textWrap = getDesignProperty('typography', 'textWrap') || '';
  const textDecoration = getDesignProperty('typography', 'textDecoration') || 'none';
  const textDecorationColor = getDesignProperty('typography', 'textDecorationColor') || '';
  const textDecorationThickness = getDesignProperty('typography', 'textDecorationThickness') || '';
  const underlineOffset = getDesignProperty('typography', 'underlineOffset') || '';
  const placeholderColor = getDesignProperty('typography', 'placeholderColor') || '';
  const lineClamp = getDesignProperty('typography', 'lineClamp') || '';

  const fontCatalog = useMemo<FontPanelFont[]>(
    () => [...BUILT_IN_FONTS, ...projectFonts, ...projectGoogleFonts, ...installedFonts, ...adobeFonts] as FontPanelFont[],
    [installedFonts, projectFonts, projectGoogleFonts, adobeFonts],
  );
  const findFont = useCallback((family: string) => fontCatalog.find(font =>
    fontFamilyValueMatches(family, font)
    || getFontFamilyValue(font) === family
  ), [fontCatalog]);
  const resolveLiveFont = useCallback((family: string) => {
    const renderedFont = findFont(family);
    if (renderedFont) return renderedFont;
    const liveState = useFontsStore.getState();
    return (
      [...BUILT_IN_FONTS, ...liveState.projectFonts, ...liveState.projectGoogleFonts, ...liveState.fonts, ...liveState.adobeFontsCatalog] as FontPanelFont[]
    ).find(font =>
      fontFamilyValueMatches(family, font)
      || getFontFamilyValue(font) === family
    );
  }, [findFont]);
  const selectedFont = useMemo(() => findFont(fontFamily), [findFont, fontFamily]);
  const fontWeight = normalizeFontPanelWeight(fontWeightRaw);
  const fontStyle = normalizeFontPanelStyle(fontStyleRaw);
  const weightOptions = useMemo(
    () => fontPanelWeightOptions(selectedFont, fontWeightRaw),
    [fontWeightRaw, selectedFont],
  );
  const styleOptions = useMemo(
    () => fontPanelStyleOptions(selectedFont, fontWeight, fontStyleRaw),
    [fontStyleRaw, fontWeight, selectedFont],
  );

  // Detect if underline is active
  const hasUnderline = textDecoration === 'underline';

  // Detect if text transform is active
  const hasTransform = textTransform !== 'none' && textTransform !== '';

  // Detect if line clamp is active
  const hasLineClamp = lineClamp !== '' && lineClamp !== 'none';

  // Detect if text wrap is active. 'wrap' is the CSS default, so it reads as
  // "not set" — otherwise every text layer would show the control.
  const hasTextWrap = textWrap !== '' && textWrap !== 'wrap';

  // Local controlled inputs (prevents repopulation bug)
  const [fontSizeInput, setFontSizeInput] = useControlledInput(fontSize, extractMeasurementValue);
  const [letterSpacingInput, setLetterSpacingInput] = useControlledInput(letterSpacing, undefined, false);
  const [lineHeightInput, setLineHeightInput] = useControlledInput(lineHeight);
  const [decorationThicknessInput, setDecorationThicknessInput] = useControlledInput(textDecorationThickness, extractMeasurementValue);
  const [underlineOffsetInput, setUnderlineOffsetInput] = useControlledInput(underlineOffset, extractMeasurementValue);
  const [lineClampInput, setLineClampInput] = useControlledInput(lineClamp);

  // Handle font family change
  const handleFontFamilyChange = (value: string) => {
    if (value === 'inherit') {
      updateDesignProperty('typography', 'fontFamily', null);
      return;
    }
    const nextFont = resolveLiveFont(value);
    const nextWeight = nextFont
      ? nearestFontPanelWeight(nextFont, fontWeightRaw)
      : normalizeFontPanelWeight(fontWeightRaw);
    const nextStyle = nextFont
      ? nearestFontPanelStyle(nextFont, nextWeight, fontStyleRaw)
      : normalizeFontPanelStyle(fontStyleRaw);
    updateDesignProperties([
      { category: 'typography', property: 'fontFamily', value },
      { category: 'typography', property: 'fontWeight', value: nextWeight },
      { category: 'typography', property: 'fontStyle', value: nextStyle },
    ]);
  };

  // Keep the selected style valid when a family only ships italic or only
  // ships a subset of styles at a given weight.
  const handleFontWeightChange = (value: string) => {
    const nextWeight = normalizeFontPanelWeight(value);
    const nextStyle = nearestFontPanelStyle(selectedFont, nextWeight, fontStyleRaw);
    updateDesignProperties([
      { category: 'typography', property: 'fontWeight', value: nextWeight },
      { category: 'typography', property: 'fontStyle', value: nextStyle },
    ]);
  };

  const handleFontStyleChange = (value: string) => {
    updateDesignProperty('typography', 'fontStyle', normalizeFontPanelStyle(value));
  };

  // Handle font size change (debounced for text input)
  const handleFontSizeChange = (value: string) => {
    setFontSizeInput(value); // Update local state immediately (spaces auto-stripped by hook)
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'fontSize', sanitized || null);
  };

  // Handle text align change (immediate - button toggle)
  const handleTextAlignChange = (value: string) => {
    updateDesignProperty('typography', 'textAlign', value);
  };

  // Handle letter spacing change (debounced for text input)
  const handleLetterSpacingChange = (value: string) => {
    setLetterSpacingInput(value);
    const sanitized = value.trim();
    debouncedUpdateDesignProperty('typography', 'letterSpacing', sanitized || null);
  };

  // Handle line height change (debounced for text input)
  const handleLineHeightChange = (value: string) => {
    setLineHeightInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'lineHeight', sanitized || null);
  };

  // Handle line height stepper (round to 1 decimal to avoid floating point noise)
  const handleLineHeightStepper = (value: string) => {
    const num = parseFloat(value);
    const rounded = !isNaN(num) ? String(Math.round(num * 10) / 10) : value;
    handleLineHeightChange(rounded);
  };

  // Debounced handler for keyboard-typed hex values
  const handleColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'color', sanitized || null);
  };

  // Immediate handler for programmatic changes
  const handleColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('typography', 'color', sanitized || null);
  };

  // Add underline with defaults
  const handleAddUnderline = () => {
    updateDesignProperties([
      { category: 'typography', property: 'textDecoration', value: 'underline' },
      { category: 'typography', property: 'textDecorationThickness', value: '1px' },
      { category: 'typography', property: 'textDecorationColor', value: '#000000' },
      { category: 'typography', property: 'underlineOffset', value: '2px' },
    ]);
  };

  // Remove underline and all related properties
  const handleRemoveUnderline = () => {
    updateDesignProperties([
      { category: 'typography', property: 'textDecoration', value: null },
      { category: 'typography', property: 'textDecorationThickness', value: null },
      { category: 'typography', property: 'textDecorationColor', value: null },
      { category: 'typography', property: 'underlineOffset', value: null },
    ]);
  };

  const handleAddTransform = () => {
    updateDesignProperty('typography', 'textTransform', 'uppercase');
  };

  const handleRemoveTransform = () => {
    updateDesignProperty('typography', 'textTransform', null);
  };

  const handleTransformChange = (value: string) => {
    updateDesignProperty('typography', 'textTransform', value);
  };

  // Added as `balance`: it is the reason to reach for text-wrap in a layout
  // tool — evening out the last line of a heading.
  const handleAddTextWrap = () => {
    updateDesignProperty('typography', 'textWrap', 'balance');
  };

  const handleRemoveTextWrap = () => {
    updateDesignProperty('typography', 'textWrap', null);
  };

  const handleTextWrapChange = (value: string) => {
    updateDesignProperty('typography', 'textWrap', value);
  };

  const handleAddLineClamp = () => {
    updateDesignProperty('typography', 'lineClamp', '2');
  };

  const handleRemoveLineClamp = () => {
    updateDesignProperty('typography', 'lineClamp', null);
  };

  const handleLineClampChange = (value: string) => {
    setLineClampInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'lineClamp', sanitized || null);
  };

  // Debounced handler for keyboard-typed hex values
  const handleDecorationColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'textDecorationColor', sanitized || null);
  };

  // Immediate handler for programmatic changes
  const handleDecorationColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('typography', 'textDecorationColor', sanitized || null);
  };

  // Handle decoration thickness change (debounced for text input)
  const handleDecorationThicknessChange = (value: string) => {
    setDecorationThicknessInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'textDecorationThickness', sanitized || null);
  };

  // Handle underline offset change (debounced for text input)
  const handleUnderlineOffsetChange = (value: string) => {
    setUnderlineOffsetInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'underlineOffset', sanitized || null);
  };

  // Check if the layer is an icon or text-content element
  const isIcon = layer?.name === 'icon';
  const isText = isTextContentLayer(layer);

  const bgImageRef = useRef<TextBackgroundImageTabHandle>(null);
  const handleImageActivate = useCallback(() => bgImageRef.current?.activate(), []);
  const handleImageDeactivate = useCallback((solidColor: string) => bgImageRef.current?.deactivate(solidColor), []);

  const bgImageSrc = layer?.variables?.backgroundImage?.src;
  const textImagePreviewUrl = useMemo(() => {
    if (!isText) return undefined;
    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    const raw = layer?.design?.backgrounds?.bgImageVars?.[varName] || '';
    if (!raw) return undefined;
    const url = raw.startsWith('url(') ? raw.slice(4, -1).replace(/['"]/g, '') : raw;
    return url || undefined;
  }, [isText, layer?.design?.backgrounds?.bgImageVars, activeBreakpoint, activeUIState]);

  const textImageLabel = useMemo(() => {
    if (!isText || !bgImageSrc) return undefined;
    if (bgImageSrc.type === 'asset') return 'File manager';
    if (bgImageSrc.type === 'dynamic_text') return 'Custom URL';
    if (bgImageSrc.type === 'field') return 'CMS field';
    return 'Image';
  }, [isText, bgImageSrc]);

  // Check if the layer supports placeholder (input/textarea)
  const hasPlaceholder = layer?.name === 'input' || layer?.name === 'textarea';

  const handlePlaceholderColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'placeholderColor', sanitized || null);
  };

  const handlePlaceholderColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('typography', 'placeholderColor', sanitized || null);
  };

  // Inline text styles that don't support block-level properties like text-align
  // Dynamic styles (dts-*) are also inline
  const inlineTextStyles = ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'code'];
  const isInlineTextStyle = activeTextStyleKey && (
    inlineTextStyles.includes(activeTextStyleKey) ||
    activeTextStyleKey.startsWith('dts-')
  );

  // Hide block-level properties (like text align) when in text edit mode with default style
  const hideBlockLevelProperties = isInlineTextStyle || (showTextStyleControls && !activeTextStyleKey);

  return (
    <SettingsPanel
      title={isIcon ? 'Fill' : 'Typography'}
      isOpen={sectionOpen}
      onToggle={() => setSectionOpen(current => !current)}
      collapsible
      action={!isIcon ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" aria-label="Add typography property" title="Add typography property">
                <Icon name="plus" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleAddUnderline}
                disabled={hasUnderline}
              >
                Underline
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleAddTransform}
                disabled={hasTransform}
              >
                Transform
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleAddLineClamp}
                disabled={hasLineClamp}
              >
                Line clamp
              </DropdownMenuItem>
              {!hideBlockLevelProperties && (
                <DropdownMenuItem
                  onClick={handleAddTextWrap}
                  disabled={hasTextWrap}
                >
                  Text balance
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
      ) : undefined}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {!isIcon && (
          <>
            <div className="grid grid-cols-3">
              <Label variant="muted">Font</Label>
              <div className="col-span-2" data-design-token-property="font-family">
                <FontPicker
                  value={fontFamily}
                  onChange={handleFontFamilyChange}
                  preserveCssFallbacks={nativeCss}
                />
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Weight</Label>
              <div className="col-span-2 *:w-full" data-design-token-property="font-weight">
                <Select value={fontWeight} onValueChange={handleFontWeightChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {weightOptions.length > 0 ? (
                        weightOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))
                      ) : null}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Style</Label>
              <div className="col-span-2 *:w-full" data-design-token-property="font-style">
                <Select value={fontStyle} onValueChange={handleFontStyleChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {styleOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Size</Label>
              <div className="col-span-2 *:w-full">
                <InputGroup>
                  <InputGroupInput
                    value={fontSizeInput}
                    onChange={(e) => handleFontSizeChange(e.target.value)}
                    stepper
                    min="0"
                  />
                </InputGroup>
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-3">
          <Label variant="muted">Color</Label>
          <div className="col-span-2 *:w-full">
            <ColorPropertyField
              value={color}
              onChange={handleColorChange}
              onImmediateChange={handleColorImmediate}
              defaultValue="#1c70d7"
              layer={layer}
              onLayerUpdate={onLayerUpdate}
              designProperty="color"
              fieldGroups={fieldGroups}
              allFields={allFields}
              collections={collections}
              imageTab={isText ? (
                <TextBackgroundImageTab
                  ref={bgImageRef}
                  layer={layer}
                  onLayerUpdate={onLayerUpdate}
                  activeTextStyleKey={activeTextStyleKey}
                  fieldGroups={fieldGroups}
                  allFields={allFields}
                  collections={collections}
                />
              ) : undefined}
              onImageActivate={isText ? handleImageActivate : undefined}
              onImageDeactivate={isText ? handleImageDeactivate : undefined}
              imagePreviewUrl={textImagePreviewUrl}
              imageLabel={textImageLabel}
              onInteractionStart={onInteractionStart}
              onInteractionEnd={onInteractionEnd}
              onInteractionCancel={onInteractionCancel}
            />
          </div>
        </div>

        {hasPlaceholder && (
          <div className="grid grid-cols-3">
            <Label variant="muted">Placeholder</Label>
            <div className="col-span-2 *:w-full">
              <ColorPropertyField
                solidOnly
                value={placeholderColor}
                onChange={handlePlaceholderColorChange}
                onImmediateChange={handlePlaceholderColorImmediate}
                defaultValue="#9ca3af"
                layer={layer}
                onLayerUpdate={onLayerUpdate}
                designProperty="placeholderColor"
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
                onInteractionStart={onInteractionStart}
                onInteractionEnd={onInteractionEnd}
                onInteractionCancel={onInteractionCancel}
              />
            </div>
          </div>
        )}

        {!isIcon && !hideBlockLevelProperties && (
          <div className="grid grid-cols-3">
            <Label variant="muted">Align</Label>
            <div className="col-span-2">
              <Tabs
                value={textAlign} onValueChange={handleTextAlignChange}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="left" className="px-2 text-xs">
                    <Icon name="textAlignLeft" />
                  </TabsTrigger>
                  <TabsTrigger value="center" className="px-2 text-xs">
                    <Icon name="textAlignCenter" />
                  </TabsTrigger>
                  <TabsTrigger value="right" className="px-2 text-xs">
                    <Icon name="textAlignRight" />
                  </TabsTrigger>
                  <TabsTrigger value="justify" className="px-2 text-xs">
                    <Icon name="textAlignJustify" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        )}

        {!isIcon && (
          <div className="grid grid-cols-3">
            <Label variant="muted">Spacing</Label>
            <div className="col-span-2 grid grid-cols-2 gap-2">
              <LetterSpacingControl
                value={letterSpacingInput}
                currentFontSize={fontSizeInput}
                onChange={handleLetterSpacingChange}
              />
              <InputGroup>
                <InputGroupAddon>
                  <div className="flex">
                    <Tooltip>
                      <TooltipTrigger>
                        <Icon name="lineHeight" className="size-3" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Line height</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </InputGroupAddon>
                <InputGroupInput
                  className="pr-0!"
                  value={lineHeightInput}
                  onChange={(e) => handleLineHeightChange(e.target.value)}
                  onStepperChange={handleLineHeightStepper}
                  stepper
                  step="0.1"
                  min="0"
                />
              </InputGroup>
            </div>
          </div>
        )}

        {!isIcon && hasUnderline && (
          <div className="grid grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Underline</Label>
            <div className="col-span-2 flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <InputGroup className="flex-1 cursor-pointer">
                    <div className="w-full flex items-center gap-2 px-2.5">
                      <div
                        className="size-4 rounded shrink-0"
                        style={{ backgroundColor: textDecorationColor || '#000000' }}
                      />
                      <Label variant="muted">Underline</Label>
                    </div>
                  </InputGroup>
                </PopoverTrigger>

                <PopoverContent panelTitle="Underline" className="w-64 mr-4">
                  <div className="flex flex-col gap-2">

                    <div className="grid grid-cols-3 items-start">
                      <Label variant="muted" className="h-8">Offset</Label>
                      <div className="col-span-2">
                        <Input
                          stepper
                          min="0"
                          step="1"
                          value={underlineOffsetInput}
                          onChange={(e) => handleUnderlineOffsetChange(e.target.value)}
                          placeholder="2"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 items-start">
                      <Label variant="muted" className="h-8">Thickness</Label>
                      <div className="col-span-2">
                        <Input
                          stepper
                          min="0"
                          step="1"
                          value={decorationThicknessInput}
                          onChange={(e) => handleDecorationThicknessChange(e.target.value)}
                          placeholder="1"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3">
                      <Label variant="muted">Color</Label>
                      <div className="col-span-2 *:w-full">
                        <ColorPropertyField
                          solidOnly
                          value={textDecorationColor || '#000000'}
                          onChange={handleDecorationColorChange}
                          onImmediateChange={handleDecorationColorImmediate}
                          layer={layer}
                          onLayerUpdate={onLayerUpdate}
                          designProperty="textDecorationColor"
                          fieldGroups={fieldGroups}
                          allFields={allFields}
                          collections={collections}
                          onInteractionStart={onInteractionStart}
                          onInteractionEnd={onInteractionEnd}
                          onInteractionCancel={onInteractionCancel}
                        />
                      </div>
                    </div>

                  </div>
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove underline"
                className="size-7 shrink-0 opacity-70 hover:opacity-100"
                onClick={handleRemoveUnderline}
              >
                <Icon name="x" className="size-2.5" />
              </Button>
            </div>
          </div>
        )}

        {!isIcon && hasTransform && (
          <div className="grid grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Transform</Label>
            <div className="col-span-2 flex items-center gap-2">
              <Select
                value={textTransform}
                onValueChange={handleTransformChange}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="uppercase">Uppercase</SelectItem>
                    <SelectItem value="lowercase">Lowercase</SelectItem>
                    <SelectItem value="capitalize">Capitalize</SelectItem>
                    <SelectItem value="normal-case">Normal</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove text transform"
                className="size-7 shrink-0 opacity-70 hover:opacity-100"
                onClick={handleRemoveTransform}
              >
                <Icon name="x" className="size-2.5" />
              </Button>
            </div>
          </div>
        )}

        {!isIcon && hasLineClamp && (
          <div className="grid grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Line clamp</Label>
            <div className="col-span-2 flex items-center gap-2">
              <Input
                stepper
                min="1"
                step="1"
                value={lineClampInput}
                onChange={(e) => handleLineClampChange(e.target.value)}
                placeholder="2"
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove line clamp"
                className="size-7 shrink-0 opacity-70 hover:opacity-100"
                onClick={handleRemoveLineClamp}
              >
                <Icon name="x" className="size-2.5" />
              </Button>
            </div>
          </div>
        )}

        {!isIcon && !hideBlockLevelProperties && hasTextWrap && (
          <div className="grid grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Text wrap</Label>
            <div className="col-span-2 flex items-center gap-2">
              <Select
                value={textWrap}
                onValueChange={handleTextWrapChange}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="balance">Balance</SelectItem>
                    <SelectItem value="pretty">Pretty</SelectItem>
                    <SelectItem value="nowrap">Nowrap</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove text wrap"
                className="size-7 shrink-0 opacity-70 hover:opacity-100"
                onClick={handleRemoveTextWrap}
              >
                <Icon name="x" className="size-2.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingsPanel>
  );
});
export default TypographyControls;
