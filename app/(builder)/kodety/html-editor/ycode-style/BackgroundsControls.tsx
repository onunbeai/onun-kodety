'use client';

import { normalizeCssControlInput } from '@/lib/html-editor/visual-style-adapter';

import { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { Label } from './ui/label';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { useHtmlCssDesignSync as useDesignSync } from './use-html-css-design-sync';
import { useEditorStore } from '@/stores/useEditorStore';

import { buildBgImgVarName, buildStyledUpdate } from './html-css-compat';
import { IMAGE_FIELD_TYPES, filterFieldGroupsByType, flattenFieldGroups, buildMultiAssetVirtualFields, isVirtualAssetField } from '@/lib/collection-field-utils';
import { isFieldVariable } from '@/lib/variable-utils';
import { getCollectionVariable, isTextContentLayer } from '@/lib/layer-utils';
import { createDynamicTextVariable } from '@/lib/variable-utils';
import { toast } from 'sonner';
import { FieldSelectDropdown } from './CollectionFieldSelector';
import type { Collection, CollectionField, FieldVariable, Layer } from '@/types';
import type { FieldGroup, FieldSourceType } from '@/lib/collection-field-utils';
import type { BackgroundImageSourceType } from './BackgroundImageSettings';
import BackgroundImageSettings from './BackgroundImageSettings';
import ColorPropertyField from './ColorPropertyField';
import WordPressBackgroundMediaDialog, { hasWordPressMediaLibrary } from './WordPressBackgroundMediaDialog';

interface BackgroundsControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

/** Emit a quoted native CSS url() without corrupting valid URL whitespace. */
function wrapNativeCssUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^url\(/i.test(trimmed)) return trimmed;
  return `url("${trimmed.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}")`;
}

function extractImageUrl(value: string): string {
  const match = value.trim().match(/^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)$/i);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function isWordPressMediaImage(value: string): boolean {
  const rawUrl = extractImageUrl(value);
  if (!rawUrl || typeof window === 'undefined') return false;
  try {
    const url = new URL(rawUrl, window.location.href);
    return url.origin === window.location.origin && /\/wp-content\/uploads\//i.test(url.pathname);
  } catch {
    return /\/wp-content\/uploads\//i.test(rawUrl);
  }
}

/** Remove a key from a vars record; returns undefined when empty */
function removeVarEntry(vars: Record<string, string> | undefined, key: string): Record<string, string> | undefined {
  if (!vars) return undefined;
  const updated = { ...vars };
  delete updated[key];
  return Object.keys(updated).length > 0 ? updated : undefined;
}

/** Background image design properties that accompany the image URL */
const BG_IMAGE_PROPS = ['backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat'] as const;

const isTextLayer = isTextContentLayer;

const BackgroundsControls = memo(function BackgroundsControls({ layer, onLayerUpdate, activeTextStyleKey, fieldGroups, allFields, collections }: BackgroundsControlsProps) {
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [wordpressMediaAvailable, setWordpressMediaAvailable] = useState(false);
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  useEffect(() => {
    setWordpressMediaAvailable(hasWordPressMediaLibrary());
  }, []);

  // Get current values from layer (no inheritance - only exact breakpoint values)
  const backgroundSize = getDesignProperty('backgrounds', 'backgroundSize') || 'cover';
  const backgroundPosition = getDesignProperty('backgrounds', 'backgroundPosition') || 'center';
  const backgroundRepeat = getDesignProperty('backgrounds', 'backgroundRepeat') || 'no-repeat';
  const backgroundClip = getDesignProperty('backgrounds', 'backgroundClip') || '';

  // CSS variable name for the active breakpoint/state (shared by image + gradient)
  const bgImgVarName = buildBgImgVarName(activeBreakpoint, activeUIState);
  const bgImageVars = layer?.design?.backgrounds?.bgImageVars;
  const bgGradientVars = layer?.design?.backgrounds?.bgGradientVars;
  const backgroundImage = bgImageVars?.[bgImgVarName] || '';

  // Background color: gradient from bgGradientVars, solid color from design property
  const solidColor = getDesignProperty('backgrounds', 'backgroundColor') || '';
  const gradientValue = bgGradientVars?.[bgImgVarName] || '';
  const backgroundColor = gradientValue || solidColor;

  // Get the background image variable from the layer
  const bgImageVariable = layer?.variables?.backgroundImage?.src;

  // Derive source type from the variable type
  const sourceType = useMemo((): BackgroundImageSourceType => {
    if (!backgroundImage) return 'none';
    if (wordpressMediaAvailable && isWordPressMediaImage(backgroundImage)) return 'file_manager';
    if (bgImageVariable?.type === 'field') return 'cms';
    return 'custom_url';
  }, [backgroundImage, bgImageVariable, wordpressMediaAvailable]);

  // Include the layer's own collection fields if it is a collection layer
  // (fieldGroups from parent only includes ancestor collections, not the layer itself)
  const effectiveFieldGroups = useMemo((): FieldGroup[] | undefined => {
    const groups: FieldGroup[] = [...(fieldGroups || [])];

    const collectionVar = layer ? getCollectionVariable(layer) : null;
    const isMultiAssetLayer = collectionVar?.source_field_type === 'multi_asset';

    // Expose virtual per-asset fields whenever this layer (or its existing background
    // binding) is in a multi-asset context, so the picker stays consistent and the
    // current binding can always be restored.
    const bgIsVirtualAsset = !!(
      bgImageVariable && isFieldVariable(bgImageVariable) && bgImageVariable.data.field_id && isVirtualAssetField(bgImageVariable.data.field_id)
    );

    if (isMultiAssetLayer || bgIsVirtualAsset) {
      // Virtual asset field values live in the per-iteration item data only
      // (never in pageCollectionItemData). Always use 'collection' so the
      // value resolves correctly even if the parent multi-image field is page-bound.
      groups.unshift({
        fields: buildMultiAssetVirtualFields(),
        label: 'File fields',
        source: 'collection',
        layerId: layer?.id,
      });
    } else if (collectionVar?.id && allFields) {
      const ownFields = allFields[collectionVar.id] || [];
      const alreadyIncluded = groups.some(g =>
        g.fields.length > 0 && ownFields.length > 0 && g.fields[0]?.id === ownFields[0]?.id
      );
      if (ownFields.length > 0 && !alreadyIncluded) {
        groups.unshift({
          fields: ownFields,
          label: 'Collection fields',
          source: 'collection',
          layerId: layer!.id,
        });
      }
    }

    return groups.length > 0 ? groups : undefined;
  }, [fieldGroups, layer, allFields, bgImageVariable]);

  // Filter field groups to image-bindable types
  const imageFieldGroups = useMemo(() => {
    return filterFieldGroupsByType(effectiveFieldGroups, IMAGE_FIELD_TYPES, { excludeMultipleAsset: true });
  }, [effectiveFieldGroups]);

  const imageFields = useMemo(() => flattenFieldGroups(imageFieldGroups), [imageFieldGroups]);
  const hasCmsFields = imageFields.length > 0;

  /**
   * Atomically clear background design props and variables.
   * @param includeColor - Also clear backgroundColor (used by the X button)
   */
  const clearBackgroundImage = useCallback((includeColor = false) => {
    if (!layer) return;
    const propsToRemove = [...BG_IMAGE_PROPS, ...(includeColor ? ['backgroundColor'] as const : [])];

    // Clean design object and remove bgImageVars + bgGradientVars for the active breakpoint/state
    const cleanedBg = { ...(layer.design?.backgrounds || {}) };
    for (const prop of propsToRemove) {
      delete cleanedBg[prop as keyof typeof cleanedBg];
    }
    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    cleanedBg.bgImageVars = removeVarEntry(cleanedBg.bgImageVars, varName);
    if (includeColor) {
      cleanedBg.bgGradientVars = removeVarEntry(cleanedBg.bgGradientVars, varName);
    }

    // For text layers, also remove the clipping declaration.
    const typography = { ...(layer.design?.typography || {}) };
    if (isTextLayer(layer)) {
      delete cleanedBg.backgroundClip;
      if (typography.color === 'transparent') delete typography.color;
    }

    // Build variable updates — always remove backgroundImage variable
    const variableUpdates: Record<string, unknown> = { backgroundImage: undefined };

    // When clearing everything (X button), also remove CMS color design bindings
    if (includeColor) {
      const designVars = { ...layer.variables?.design } as Record<string, unknown> | undefined;
      if (designVars) delete designVars.backgroundColor;
      variableUpdates.design = (designVars && Object.keys(designVars).length > 0) ? designVars : undefined;
    }

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: cleanedBg, typography },
      variables: { ...layer.variables, ...variableUpdates },
    }));
  }, [layer, onLayerUpdate, activeBreakpoint, activeUIState]);

  /**
   * Update background color/gradient.
   * Solid colors stay in backgroundColor; gradients share the native image slot.
   */
  const handleBackgroundColorChange = useCallback((value: string, immediate = false) => {
    if (!layer) return;
    const sanitized = normalizeCssControlInput(value) || null;
    const isGradient = sanitized?.includes('gradient(');

    if (isGradient) {
      // Store gradient in bgGradientVars.
      const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
      const currentBg = layer.design?.backgrounds || {};
      const updatedBg = {
        ...currentBg,
        bgGradientVars: { ...currentBg.bgGradientVars, [varName]: sanitized! },
        isActive: true,
      };

      onLayerUpdate(layer.id, buildStyledUpdate(layer, {
        design: { ...layer.design, backgrounds: updatedBg },
      }));
    } else {
      // Solid color — clear gradient for this breakpoint/state if present
      const currentBg = layer.design?.backgrounds || {};
      const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
      const hadGradient = !!currentBg.bgGradientVars?.[varName];

      if (hadGradient) {
        const updatedBg = {
          ...currentBg,
          bgGradientVars: removeVarEntry(currentBg.bgGradientVars, varName),
        };
        onLayerUpdate(layer.id, buildStyledUpdate(layer, {
          design: { ...layer.design, backgrounds: { ...updatedBg, backgroundColor: sanitized || undefined } },
        }));
      } else {
        (immediate ? updateDesignProperty : debouncedUpdateDesignProperty)('backgrounds', 'backgroundColor', sanitized);
      }
    }
  }, [layer, onLayerUpdate, updateDesignProperty, debouncedUpdateDesignProperty, activeBreakpoint, activeUIState]);

  /**
   * Update the background image URL.
   * Stores the native URL value in bgImageVars.
   */
  const handleBackgroundImageChange = useCallback((value: string, immediate = false) => {
    if (!layer) return;
    const processedValue = wrapNativeCssUrl(value);

    // Build CSS variable name for the active breakpoint/state
    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    // Update design: store var name as backgroundImage and URL in bgImageVars
    const currentBg = layer.design?.backgrounds || {};
    const newVars = { ...currentBg.bgImageVars };
    if (processedValue) {
      newVars[varName] = processedValue;
    } else {
      delete newVars[varName];
    }
    const updatedBg = {
      ...currentBg,
      ...(processedValue && !currentBg.backgroundSize ? { backgroundSize: 'cover' } : {}),
      backgroundImage: varName,
      bgImageVars: Object.keys(newVars).length > 0 ? newVars : undefined,
      ...(processedValue ? { bgGradientVars: removeVarEntry(currentBg.bgGradientVars, varName) } : {}),
      isActive: true,
    };

    // Keep variable in sync for custom_url
    let variableUpdates: Partial<Layer['variables']> | undefined;
    if (bgImageVariable?.type === 'dynamic_text') {
      const plainUrl = processedValue.startsWith('url(') ? processedValue.slice(4, -1) : processedValue;
      variableUpdates = {
        ...layer.variables,
        backgroundImage: { src: createDynamicTextVariable(plainUrl) },
      };
    }

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: updatedBg },
      ...(variableUpdates ? { variables: variableUpdates } : {}),
    }));
  }, [layer, onLayerUpdate, activeBreakpoint, activeUIState, bgImageVariable]);

  /** Generic handler for any background design property (size, position, repeat) */
  const handleBackgroundPropChange = useCallback(
    (property: string, value: string) => updateDesignProperty('backgrounds', property, value),
    [updateDesignProperty],
  );

  /** Toggle native background-clip for text. */
  const handleBackgroundClipToggle = useCallback((clipToText: boolean) => {
    if (!layer) return;
    const bgDesign = { ...(layer.design?.backgrounds || {}) };

    if (clipToText) {
      bgDesign.backgroundClip = 'text';
    } else {
      delete bgDesign.backgroundClip;
    }
    const typography = { ...(layer.design?.typography || {}) };
    if (clipToText) typography.color = 'transparent';
    else if (typography.color === 'transparent') delete typography.color;

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: bgDesign, typography },
    }));
  }, [layer, onLayerUpdate, activeBreakpoint, activeUIState]);

  /** Source selection is UI state; the native CSS declaration is the authority. */
  const handleSourceTypeChange = useCallback((type: BackgroundImageSourceType) => {
    if (type === 'none') {
      clearBackgroundImage();
    }
  }, [clearBackgroundImage]);

  /** Open the real WordPress Media Library instead of the detached builder store. */
  const handleOpenFileManager = useCallback(() => {
    if (!hasWordPressMediaLibrary()) {
      toast.error('Biblioteca de Mídia indisponível', {
        description: 'Use uma URL personalizada para este projeto.',
      });
      return;
    }
    setMediaLibraryOpen(true);
  }, []);

  /** Handle CMS field selection. */
  const handleFieldSelect = useCallback((
    fieldId: string,
    relationshipPath: string[],
    source?: FieldSourceType,
    layerId?: string,
  ) => {
    if (!layer) return;
    const field = imageFields.find(f => f.id === fieldId);
    const fieldVar: FieldVariable = {
      type: 'field',
      data: {
        field_id: fieldId,
        relationships: relationshipPath,
        field_type: field?.type || null,
        source,
        collection_layer_id: layerId,
      },
    };

    const varName = buildBgImgVarName(activeBreakpoint, activeUIState);
    const currentBg = layer.design?.backgrounds || {};
    const updatedBg = {
      ...currentBg,
      ...(!currentBg.backgroundSize ? { backgroundSize: 'cover' } : {}),
      backgroundImage: varName,
      bgGradientVars: removeVarEntry(currentBg.bgGradientVars, varName),
      isActive: true,
    };

    onLayerUpdate(layer.id, buildStyledUpdate(layer, {
      design: { ...layer.design, backgrounds: updatedBg },
      variables: {
        ...layer.variables,
        backgroundImage: { src: fieldVar },
      },
    }));
  }, [layer, onLayerUpdate, imageFields, activeBreakpoint, activeUIState]);

  /** Render the CMS field selector dropdown */
  const renderFieldSelector = useCallback(() => (
    <FieldSelectDropdown
      fieldGroups={imageFieldGroups}
      allFields={allFields || {}}
      collections={collections || []}
      value={bgImageVariable?.type === 'field' ? (bgImageVariable as FieldVariable).data.field_id : null}
      onSelect={handleFieldSelect}
      placeholder="Select..."
      allowedFieldTypes={IMAGE_FIELD_TYPES}
    />
  ), [imageFieldGroups, allFields, collections, bgImageVariable, handleFieldSelect]);

  return (
    <>
      <div className="py-5" data-design-token-section="Backgrounds" data-kodety-onboarding="design-style-backgrounds">
        <header className="py-4 -mt-4">
          <Label>Backgrounds</Label>
        </header>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3">
            <Label variant="muted">Color</Label>
            <div className="col-span-2 *:w-full">
              <ColorPropertyField
                value={backgroundColor}
                onChange={(v) => handleBackgroundColorChange(v)}
                onImmediateChange={(v) => handleBackgroundColorChange(v, true)}
                defaultValue="#ffffff"
                layer={layer}
                onLayerUpdate={onLayerUpdate}
                designProperty="backgroundColor"
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
              />
            </div>
          </div>

          <BackgroundImageSettings
            backgroundImage={backgroundImage}
            backgroundSize={backgroundSize}
            backgroundPosition={backgroundPosition}
            backgroundRepeat={backgroundRepeat}
            sourceType={sourceType}
            hasCmsFields={hasCmsFields}
            onBackgroundImageChange={handleBackgroundImageChange}
            onBackgroundPropChange={handleBackgroundPropChange}
            onSourceTypeChange={handleSourceTypeChange}
            onOpenFileManager={handleOpenFileManager}
            renderFieldSelector={renderFieldSelector}
            availableSources={wordpressMediaAvailable ? ['file_manager', 'custom_url'] : ['custom_url']}
            defaultSourceType={wordpressMediaAvailable ? 'file_manager' : 'custom_url'}
          />

          {/*<div className="grid grid-cols-3 items-center">*/}
          {/*  <Label variant="muted">Clip text</Label>*/}
          {/*  <div className="col-span-2">*/}
          {/*    <Tabs*/}
          {/*      value={backgroundClip === 'text' ? 'yes' : 'no'}*/}
          {/*      onValueChange={(v) => handleBackgroundClipToggle(v === 'yes')}*/}
          {/*      className="w-full"*/}
          {/*    >*/}
          {/*      <TabsList className="w-full">*/}
          {/*        <TabsTrigger value="no">No</TabsTrigger>*/}
          {/*        <TabsTrigger value="yes">Yes</TabsTrigger>*/}
          {/*      </TabsList>*/}
          {/*    </Tabs>*/}
          {/*  </div>*/}
          {/*</div>*/}
        </div>
      </div>
      <WordPressBackgroundMediaDialog
        open={mediaLibraryOpen}
        onOpenChange={setMediaLibraryOpen}
        onSelect={url => handleBackgroundImageChange(url, true)}
      />
    </>
  );
});
export default BackgroundsControls;
