'use client';

import { cssImagePreviewUrl } from '@/lib/html-editor/css-image-url';

import { normalizeCssControlInput } from '@/lib/html-editor/visual-style-adapter';

import { useRef, useCallback, useMemo, memo } from 'react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { InputGroup } from './ui/input-group';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import Icon from './ui/icon';
import { useHtmlCssDesignSync as useDesignSync } from './use-html-css-design-sync';
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

import { getFontAvailableWeights, FONT_WEIGHTS } from '@/lib/font-utils';
import { buildBgImgVarName } from './html-css-compat';
import { isTextContentLayer } from '@/lib/layer-utils';
import type { Collection, CollectionField, Layer } from '@/types';
import type { FieldGroup } from '@/lib/collection-field-utils';
import ColorPropertyField from './ColorPropertyField';
import FontPicker from './FontPicker';
import TextBackgroundImageTab from './TextBackgroundImageTab';
import type { TextBackgroundImageTabHandle } from './TextBackgroundImageTab';
import {
  VisualMeasurementControl,
  VisualMeasurementField,
  VisualSelectField,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';

interface TypographyControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

type TypographyUnit = 'px' | 'rem' | 'em' | '%' | '';

const FONT_SIZE_UNITS: Array<{ value: TypographyUnit; label: string }> = [
  { value: 'px', label: 'Px' },
  { value: 'rem', label: 'Rem' },
  { value: 'em', label: 'Em' },
  { value: '%', label: '%' },
];

const LINE_HEIGHT_UNITS: Array<{ value: TypographyUnit; label: string }> = [
  { value: '', label: 'Unitless' },
  { value: 'px', label: 'Px' },
  { value: 'rem', label: 'Rem' },
  { value: 'em', label: 'Em' },
  { value: '%', label: '%' },
];

const LETTER_SPACING_UNIT_OPTIONS: Array<{ value: LetterSpacingUnit; label: string }> = [
  { value: 'px', label: 'Px' },
  { value: 'em', label: 'Em' },
  { value: 'rem', label: 'Rem' },
  { value: '%', label: '%' },
];

function parseTypographyMeasurement(value: string, defaultUnit: TypographyUnit) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%)?$/i);
  if (!match) return { numeric: trimmed, number: null, unit: defaultUnit };
  const unit = (match[2]?.toLowerCase() || defaultUnit) as TypographyUnit;
  return { numeric: match[1], number: Number.parseFloat(match[1]), unit };
}

function roundTypographyMeasurement(value: number) {
  return String(Number(value.toFixed(3)));
}

function fontSizeInPixels(value: string) {
  const parsed = parseTypographyMeasurement(value, 'px');
  if (parsed.number === null || !Number.isFinite(parsed.number)) return 16;
  if (parsed.unit === 'rem' || parsed.unit === 'em') return parsed.number * 16;
  if (parsed.unit === '%') return parsed.number * 0.16;
  return parsed.number;
}

function convertTypographyMeasurement(
  value: number,
  from: TypographyUnit,
  to: TypographyUnit,
  kind: 'font-size' | 'line-height',
  currentFontSize: string,
) {
  const fontPixels = Math.max(0.001, fontSizeInPixels(currentFontSize));
  const pixels = kind === 'font-size'
    ? from === 'rem' || from === 'em'
      ? value * 16
      : from === '%'
        ? value * 0.16
        : value
    : from === '' || from === 'em'
      ? value * fontPixels
      : from === 'rem'
        ? value * 16
        : from === '%'
          ? (value / 100) * fontPixels
          : value;

  if (kind === 'font-size') {
    if (to === 'rem' || to === 'em') return pixels / 16;
    if (to === '%') return pixels / 0.16;
    return pixels;
  }
  if (to === '' || to === 'em') return pixels / fontPixels;
  if (to === 'rem') return pixels / 16;
  if (to === '%') return (pixels / fontPixels) * 100;
  return pixels;
}

function TypographyMeasurementField({
  label,
  value,
  onChange,
  kind,
  units,
  defaultUnit,
  currentFontSize,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  kind: 'font-size' | 'line-height' | 'letter-spacing';
  units: Array<{ value: TypographyUnit; label: string }>;
  defaultUnit: TypographyUnit;
  currentFontSize: string;
}) {
  const parsed = kind === 'letter-spacing'
    ? parseLetterSpacingValue(value)
    : parseTypographyMeasurement(value, defaultUnit);
  const selectedUnit = units.some(option => option.value === parsed.unit) ? parsed.unit : defaultUnit;
  const selectedUnitLabel = units.find(option => option.value === selectedUnit)?.label || 'Px';
  const step = kind === 'letter-spacing'
    ? 0.1
    : selectedUnit === 'rem' || selectedUnit === 'em' || selectedUnit === ''
      ? 0.05
      : 1;

  const handleNumericChange = (nextValue: string) => {
    if (kind === 'letter-spacing') {
      onChange(serializeLetterSpacingDraft(nextValue, selectedUnit as LetterSpacingUnit));
      return;
    }
    const sanitized = normalizeCssControlInput(nextValue);
    if (!sanitized) {
      onChange('');
      return;
    }
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(sanitized)) {
      onChange(sanitized);
      return;
    }
    onChange(`${sanitized}${selectedUnit}`);
  };

  const handleUnitChange = (nextUnit: TypographyUnit) => {
    if (kind === 'letter-spacing') {
      onChange(convertLetterSpacingUnit(value, nextUnit as LetterSpacingUnit, currentFontSize));
      return;
    }
    const fallback = kind === 'font-size' ? 16 : 1.2;
    const currentNumber = parsed.number ?? fallback;
    const converted = convertTypographyMeasurement(currentNumber, selectedUnit, nextUnit, kind, currentFontSize);
    onChange(`${roundTypographyMeasurement(converted)}${nextUnit}`);
  };

  return (
    <div className="grid min-w-0 grid-cols-3 items-start">
      <Label variant="muted" className="h-8">{label}</Label>
      <div className="col-span-2 min-w-0">
        <VisualMeasurementControl
          glyph={kind}
          value={parsed.numeric}
          onChange={handleNumericChange}
          ariaLabel={label}
          min={kind === 'letter-spacing' ? undefined : 0}
          step={step}
          property={kind}
          inputMode={kind === 'letter-spacing' && parsed.number === null ? 'text' : 'decimal'}
          actionClassName="w-12"
          action={(
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Unit for ${label.toLowerCase()}: ${selectedUnitLabel}`}
                  className="flex h-full w-full items-center justify-center gap-1 text-[9px] font-medium text-white/48 outline-none transition-colors hover:bg-white/[.045] hover:text-white/82 data-[state=open]:bg-white/[.055] data-[state=open]:text-[var(--kodety-accent-hover)]"
                >
                  <span>{selectedUnit ? selectedUnitLabel : '—'}</span>
                  <Icon name="chevronDown" className="size-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-28">
                {units.map(option => (
                  <DropdownMenuItem
                    key={option.value || 'unitless'}
                    onSelect={() => handleUnitChange(option.value)}
                    disabled={kind === 'letter-spacing' && parsed.number === null}
                    className="min-h-8 text-[10px]"
                  >
                    <span className="min-w-0 flex-1">{option.label}</span>
                    {selectedUnit === option.value && <span className="text-[var(--kodety-accent-hover)]">✓</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      </div>
    </div>
  );
}

const TypographyControls = memo(function TypographyControls({ layer, onLayerUpdate, activeTextStyleKey, fieldGroups, allFields, collections }: TypographyControlsProps) {
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

  // Get current values from layer (with inheritance)
  const fontFamily = getDesignProperty('typography', 'fontFamily') || '';
  const fontWeightRaw = getDesignProperty('typography', 'fontWeight') || 'normal';
  const fontSize = getDesignProperty('typography', 'fontSize') || '';
  const textAlign = getDesignProperty('typography', 'textAlign') || 'left';
  const letterSpacing = getDesignProperty('typography', 'letterSpacing') || '';
  const lineHeight = getDesignProperty('typography', 'lineHeight') || '';
  const color = getDesignProperty('typography', 'color') || '';
  const textTransform = getDesignProperty('typography', 'textTransform') || 'none';
  const textDecoration = getDesignProperty('typography', 'textDecoration') || 'none';
  const textDecorationColor = getDesignProperty('typography', 'textDecorationColor') || '';
  const textDecorationThickness = getDesignProperty('typography', 'textDecorationThickness') || '';
  const underlineOffset = getDesignProperty('typography', 'underlineOffset') || '';
  const placeholderColor = getDesignProperty('typography', 'placeholderColor') || '';
  const lineClamp = getDesignProperty('typography', 'lineClamp') || '';

  // Get available weights for the selected font
  // Importing a project can register its Google/local faces after this
  // inspector mounts. Subscribe to the resolved font, not the stable action.
  const selectedFont = useFontsStore((state) => state.getFontByFamily(fontFamily));
  const availableWeights = selectedFont ? getFontAvailableWeights(selectedFont) : [];

  // Detect if underline is active
  const hasUnderline = textDecoration === 'underline';

  // Detect if text transform is active
  const hasTransform = textTransform !== 'none' && textTransform !== '';

  // Detect if line clamp is active
  const hasLineClamp = lineClamp !== '' && lineClamp !== 'none';

  // Local controlled inputs (prevents repopulation bug)
  const [fontSizeInput, setFontSizeInput] = useControlledInput(fontSize);
  const [letterSpacingInput, setLetterSpacingInput] = useControlledInput(letterSpacing, undefined, false);
  const [lineHeightInput, setLineHeightInput] = useControlledInput(lineHeight);
  const [decorationThicknessInput, setDecorationThicknessInput] = useControlledInput(textDecorationThickness, extractMeasurementValue);
  const [underlineOffsetInput, setUnderlineOffsetInput] = useControlledInput(underlineOffset, extractMeasurementValue);
  const [lineClampInput, setLineClampInput] = useControlledInput(lineClamp);

  // Map numeric font weights to named values
  const fontWeightMap: Record<string, string> = {
    '100': 'thin',
    '200': 'extralight',
    '300': 'light',
    '400': 'normal',
    '500': 'medium',
    '600': 'semibold',
    '700': 'bold',
    '800': 'extrabold',
    '900': 'black',
  };

  // Map named font weights to numeric values
  const fontWeightMapReverse: Record<string, string> = {
    'thin': '100',
    'extralight': '200',
    'light': '300',
    'normal': '400',
    'medium': '500',
    'semibold': '600',
    'bold': '700',
    'extrabold': '800',
    'black': '900',
  };

  // Convert numeric weight to named for the Select
  const fontWeight = fontWeightMap[fontWeightRaw] || fontWeightRaw;
  const weightOptions: VisualStyleOption[] = FONT_WEIGHTS
    .filter(weight => !availableWeights.length || availableWeights.includes(weight.value))
    .map(weight => ({
      value: fontWeightMap[weight.value] || weight.value,
      label: weight.label,
      icon: (
        <span
          aria-hidden="true"
          className="block w-3 text-center text-[12px] leading-none"
          style={{ fontWeight: Number(weight.value) }}
        >
          B
        </span>
      ),
    }));

  const transformOptions: VisualStyleOption[] = [
    { value: 'uppercase', label: 'Uppercase', glyph: 'text-transform' },
    { value: 'lowercase', label: 'Lowercase', glyph: 'text-transform' },
    { value: 'capitalize', label: 'Capitalize', glyph: 'text-transform' },
    { value: 'normal-case', label: 'Normal', glyph: 'text-transform' },
  ];

  // Handle font family change
  const handleFontFamilyChange = (value: string) => {
    updateDesignProperty('typography', 'fontFamily', value === 'inherit' ? null : value);
  };

  // Handle font weight change - convert named back to numeric
  const handleFontWeightChange = (value: string) => {
    const numericWeight = fontWeightMapReverse[value] || value;
    updateDesignProperty('typography', 'fontWeight', numericWeight);
  };

  // Handle font size change (debounced for text input)
  const handleFontSizeChange = (value: string) => {
    setFontSizeInput(value); // Update local state immediately (spaces auto-stripped by hook)
    const sanitized = normalizeCssControlInput(value);
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
    const sanitized = normalizeCssControlInput(value);
    debouncedUpdateDesignProperty('typography', 'lineHeight', sanitized || null);
  };

  // Debounced handler for keyboard-typed hex values
  const handleColorChange = (value: string) => {
    const sanitized = normalizeCssControlInput(value);
    debouncedUpdateDesignProperty('typography', 'color', sanitized || null);
  };

  // Immediate handler for programmatic changes
  const handleColorImmediate = (value: string) => {
    const sanitized = normalizeCssControlInput(value);
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

  const handleAddLineClamp = () => {
    updateDesignProperty('typography', 'lineClamp', '2');
  };

  const handleRemoveLineClamp = () => {
    updateDesignProperty('typography', 'lineClamp', null);
  };

  const handleLineClampChange = (value: string) => {
    setLineClampInput(value);
    const sanitized = normalizeCssControlInput(value);
    debouncedUpdateDesignProperty('typography', 'lineClamp', sanitized || null);
  };

  // Debounced handler for keyboard-typed hex values
  const handleDecorationColorChange = (value: string) => {
    const sanitized = normalizeCssControlInput(value);
    debouncedUpdateDesignProperty('typography', 'textDecorationColor', sanitized || null);
  };

  // Immediate handler for programmatic changes
  const handleDecorationColorImmediate = (value: string) => {
    const sanitized = normalizeCssControlInput(value);
    updateDesignProperty('typography', 'textDecorationColor', sanitized || null);
  };

  // Handle decoration thickness change (debounced for text input)
  const handleDecorationThicknessChange = (value: string) => {
    setDecorationThicknessInput(value);
    const sanitized = normalizeCssControlInput(value);
    debouncedUpdateDesignProperty('typography', 'textDecorationThickness', sanitized || null);
  };

  // Handle underline offset change (debounced for text input)
  const handleUnderlineOffsetChange = (value: string) => {
    setUnderlineOffsetInput(value);
    const sanitized = normalizeCssControlInput(value);
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
    return cssImagePreviewUrl(raw) || undefined;
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
    const sanitized = normalizeCssControlInput(value);
    debouncedUpdateDesignProperty('typography', 'placeholderColor', sanitized || null);
  };

  const handlePlaceholderColorImmediate = (value: string) => {
    const sanitized = normalizeCssControlInput(value);
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
    <div className="py-5" data-design-token-section="Typography" data-kodety-onboarding="design-style-typography">
      <header className="py-4 -mt-4 flex items-center justify-between">
        <Label>{isIcon ? 'Fill' : 'Typography'}</Label>
        {!isIcon && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs">
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="flex flex-col gap-2">
        {!isIcon && (
          <>
            <div className="grid grid-cols-3">
              <Label variant="muted">Font</Label>
              <div className="col-span-2">
                <FontPicker
                  value={fontFamily}
                  onChange={handleFontFamilyChange}
                />
              </div>
            </div>

            <VisualSelectField
              label="Weight"
              value={fontWeight}
              options={weightOptions}
              onValueChange={handleFontWeightChange}
              glyph="font-weight"
              ariaLabel="Font weight"
              property="font-weight"
            />

            <TypographyMeasurementField
              label="Size"
              value={fontSizeInput}
              onChange={handleFontSizeChange}
              kind="font-size"
              units={FONT_SIZE_UNITS}
              defaultUnit="px"
              currentFontSize={fontSizeInput}
            />
          </>
        )}

        <div className="grid grid-cols-3">
          <Label variant="muted">Color</Label>
          <div className="col-span-2 *:w-full">
            <ColorPropertyField
              solidOnly={isIcon}
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="left" className="px-2 text-xs" aria-label="Align left">
                        <Icon name="textAlignLeft" />
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Align left</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="center" className="px-2 text-xs" aria-label="Align center">
                        <Icon name="textAlignCenter" />
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Align center</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="right" className="px-2 text-xs" aria-label="Align right">
                        <Icon name="textAlignRight" />
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Align right</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="justify" className="px-2 text-xs" aria-label="Justify text">
                        <Icon name="textAlignJustify" />
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Justify text</TooltipContent>
                  </Tooltip>
                </TabsList>
              </Tabs>
            </div>
          </div>
        )}

        {!isIcon && (
          <TypographyMeasurementField
            label="Letter"
            value={letterSpacingInput}
            onChange={handleLetterSpacingChange}
            kind="letter-spacing"
            units={LETTER_SPACING_UNIT_OPTIONS}
            defaultUnit="em"
            currentFontSize={fontSizeInput}
          />
        )}

        {!isIcon && (
          <TypographyMeasurementField
            label="Line height"
            value={lineHeightInput}
            onChange={handleLineHeightChange}
            kind="line-height"
            units={LINE_HEIGHT_UNITS}
            defaultUnit=""
            currentFontSize={fontSizeInput}
          />
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

                <PopoverContent className="w-64 mr-4">
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
                        />
                      </div>
                    </div>

                  </div>
                </PopoverContent>
              </Popover>
              <button
                type="button"
                className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={handleRemoveUnderline}
              >
                <Icon name="x" className="size-2.5" />
              </button>
            </div>
          </div>
        )}

        {!isIcon && hasTransform && (
          <VisualSelectField
            label="Transform"
            value={textTransform}
            options={transformOptions}
            onValueChange={handleTransformChange}
            glyph="text-transform"
            ariaLabel="Text transform"
            property="text-transform"
            action={(
              <button
                type="button"
                className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={handleRemoveTransform}
              >
                <Icon name="x" className="size-2.5" />
              </button>
            )}
          />
        )}

        {!isIcon && hasLineClamp && (
          <VisualMeasurementField
            label="Line clamp"
            glyph="line-clamp"
            value={lineClampInput}
            onChange={handleLineClampChange}
            min={1}
            placeholder="2"
            property="-webkit-line-clamp"
            action={(
              <button
                type="button"
                className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={handleRemoveLineClamp}
              >
                <Icon name="x" className="size-2.5" />
              </button>
            )}
          />
        )}
      </div>
    </div>
  );
});
export default TypographyControls;
