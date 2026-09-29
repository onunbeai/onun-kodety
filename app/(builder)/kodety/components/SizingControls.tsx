'use client';

import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupSeparator } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { TruncatedLabel } from '@/components/ui/truncated-label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SettingsPanel from './SettingsPanel';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { extractMeasurementValue, formatMeasurementValue } from '@/lib/measurement-utils';
import {
  commitSizingEditValue,
  cssSizingValueToControl,
  normalizeSizingInputForMode,
  sizingControlValueToCss,
  sizingValueForEditing,
  sizingValueMode,
  type SizingValueMode,
} from '@/lib/html-editor/sizing-values';
import type { Layer } from '@/types';

interface SizingControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  /** HTML/CSS source edits must be committed synchronously so no typed value is lost on refresh/selection change. */
  nativeCss?: boolean;
  /** Overflow lives in the compact Styles group in the HTML inspector. */
  hideOverflow?: boolean;
  /**
   * The HTML editor adapts a live DOM selection into a synthetic Layer that
   * does not exist in the page/component stores. Pass its live parent layout
   * explicitly so Grid child controls remain available there.
   */
  parentHasGrid?: boolean;
}

type SizingMeasurementProperty =
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'maxWidth'
  | 'maxHeight';

type OptionalSizingProperty = Exclude<SizingMeasurementProperty, 'width' | 'height'>;

interface ActiveSizingEdit {
  mode: SizingValueMode;
  draft: string;
  unit: string;
  original: string;
}

interface SizingPresetOption {
  value: string;
  label: string;
}

// Framer keeps the authored value and its sizing mode equally legible.  The
// previous fixed 6rem preset column could leave the numeric input with only a
// few visible characters once the inspector label column was accounted for.
const SIZING_VALUE_PRESET_GRID = 'grid min-w-0 grid-cols-2 gap-1';

const WIDTH_PRESET_OPTIONS: SizingPresetOption[] = [
  { value: 'w-fixed', label: 'Fixed' },
  { value: 'w-relative', label: 'Relative' },
  { value: 'w-fill', label: 'Fill' },
  { value: 'w-fit-content', label: 'Fit Content' },
  { value: 'w-[100vw]', label: 'Viewport' },
];

const HEIGHT_PRESET_OPTIONS: SizingPresetOption[] = [
  { value: 'h-fixed', label: 'Fixed' },
  { value: 'h-relative', label: 'Relative' },
  { value: 'h-fill', label: 'Fill' },
  { value: 'h-fit-content', label: 'Fit Content' },
  { value: 'h-[100svh]', label: 'Viewport' },
];

const MIN_MAX_WIDTH_PRESET_OPTIONS = WIDTH_PRESET_OPTIONS.filter((option) => option.value !== 'w-fill');
const MIN_MAX_HEIGHT_PRESET_OPTIONS = HEIGHT_PRESET_OPTIONS.filter((option) => option.value !== 'h-fill');

const OPTIONAL_SIZING_LABELS: Record<OptionalSizingProperty, string> = {
  minWidth: 'Min Width',
  maxWidth: 'Max Width',
  minHeight: 'Min Height',
  maxHeight: 'Max Height',
};

function sizingPresetDisplayLabel(value: string) {
  if (value.includes('relative')) return 'Rel';
  if (value.includes('fit-content')) return 'Fit';
  if (value.includes('fill')) return 'Fill';
  if (value.includes('100vw') || value.includes('100svh')) return 'Viewport';
  return 'Fixed';
}

function hasMeaningfulSizingConstraint(property: OptionalSizingProperty, value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s*!important\s*$/i, '');
  if (
    !normalized
    || ['none', 'auto', 'initial', 'unset', 'revert', 'revert-layer', 'normal'].includes(normalized)
  ) return false;
  // Computed CSS exposes min-size defaults as 0px even when the author never
  // configured them.  Hiding those no-op defaults is what keeps the panel as
  // calm as Framer's; a newly added blank/zero row is still kept by the local
  // addedSizingProperties flag while the user edits it.
  if (property === 'minWidth' || property === 'minHeight') {
    return !/^0(?:\.0+)?(?:px|rem|em|%|vw|vh|dvw|dvh|svw|svh|lvw|lvh)?$/.test(normalized);
  }
  return true;
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

const SizingControls = memo(function SizingControls({
  layer,
  onLayerUpdate,
  nativeCss = false,
  hideOverflow = false,
  parentHasGrid: explicitParentHasGrid,
}: SizingControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const {
    updateDesignProperty,
    debouncedUpdateDesignProperty,
    cancelPendingDesignProperties,
    getDesignProperty,
  } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
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
  const [addedSizingProperties, setAddedSizingProperties] = useState<
    Partial<Record<OptionalSizingProperty, true>>
  >({});
  const [activeSizingEdits, setActiveSizingEdits] = useState<
    Partial<Record<SizingMeasurementProperty, ActiveSizingEdit>>
  >({});
  // Input/focus events can happen in the same browser task (notably
  // select-all → type → Enter). React state is deliberately asynchronous, so
  // blur must not read the draft from the previous render. The ref is the
  // synchronous transaction record; state only drives the visual render.
  const activeSizingEditsRef = useRef<
    Partial<Record<SizingMeasurementProperty, ActiveSizingEdit>>
  >({});
  // A canvas selection snapshot contains computed dimensions. While an
  // authored CSS edit is travelling through source → stylesheet → iframe, a
  // stale snapshot can briefly report e.g. 1920px and switch Relative back to
  // Fixed. Keep the exact authored control value visible until the adapter
  // confirms it from the rebuilt declaration.
  const [pendingSizingCommits, setPendingSizingCommits] = useState<
    Partial<Record<SizingMeasurementProperty, string>>
  >({});
  const pendingSizingCommitsRef = useRef<
    Partial<Record<SizingMeasurementProperty, string>>
  >({});

  // A blank constraint added from the menu remains visible while it is being
  // authored.  Moving to another element/breakpoint must not carry that
  // ephemeral row with it; persisted constraints are independently detected
  // from their current values below.
  useEffect(() => {
    setAddedSizingProperties({});
    activeSizingEditsRef.current = {};
    pendingSizingCommitsRef.current = {};
    setActiveSizingEdits({});
    setPendingSizingCommits({});
  }, [layer?.id, activeBreakpoint, activeUIState]);

  const externalSizingValues: Record<SizingMeasurementProperty, string> = {
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
  };

  useEffect(() => {
    if (!nativeCss) return;
    setPendingSizingCommits((current) => {
      let changed = false;
      const next = { ...current };
      (Object.keys(current) as SizingMeasurementProperty[]).forEach((property) => {
        const expected = current[property];
        if (expected === undefined) return;
        const confirmed = extractMeasurementValue(externalSizingValues[property]);
        const becameDesignToken = /^var\(\s*--kodety-token-[a-zA-Z0-9_-]+\s*\)$/.test(confirmed);
        if (confirmed !== expected && !becameDesignToken) return;
        delete next[property];
        delete pendingSizingCommitsRef.current[property];
        changed = true;
      });
      return changed ? next : current;
    });
  }, [height, maxHeight, maxWidth, minHeight, minWidth, nativeCss, width]);

  const pendingSizingValue = (
    property: SizingMeasurementProperty,
    fallback: string,
  ) => pendingSizingCommitsRef.current[property]
    ?? pendingSizingCommits[property]
    ?? fallback;

  const getSizingMode = (property: SizingMeasurementProperty, inputValue: string) => (
    activeSizingEditsRef.current[property]?.mode
    ?? sizingValueMode(property, pendingSizingValue(property, inputValue))
  );

  const beginSizingEdit = (property: SizingMeasurementProperty, inputValue: string) => {
    const currentValue = pendingSizingValue(property, inputValue);
    const mode = sizingValueMode(property, currentValue);
    const editable = sizingValueForEditing(property, mode, currentValue);
    const edit = { mode, ...editable, original: currentValue };
    activeSizingEditsRef.current[property] = edit;
    setActiveSizingEdits((current) => ({
      ...current,
      [property]: edit,
    }));
  };

  const clearSizingEdit = (property: SizingMeasurementProperty) => {
    delete activeSizingEditsRef.current[property];
    setActiveSizingEdits((current) => {
      if (!current[property]) return current;
      const next = { ...current };
      delete next[property];
      return next;
    });
  };

  const retainPendingSizingCommit = (
    property: SizingMeasurementProperty,
    value: string | null,
  ) => {
    if (!nativeCss) return;
    // Presets retain their legacy Tailwind spelling (`[100%]`, `[100vw]`)
    // until the HTML adapter turns them into authored CSS. Normalize both
    // sides through that adapter so the pending guard displays `100%` now and
    // can be released when the canonical source reports the same value.
    const controlValue = extractMeasurementValue(cssSizingValueToControl(
      sizingControlValueToCss(property, value || ''),
    ));
    pendingSizingCommitsRef.current[property] = controlValue;
    setPendingSizingCommits((current) => (
      current[property] === controlValue
        ? current
        : { ...current, [property]: controlValue }
    ));
  };

  const updateMeasurementProperty = (
    property: SizingMeasurementProperty,
    value: string | null,
  ) => {
    if (nativeCss) {
      retainPendingSizingCommit(property, value);
      updateDesignProperty('sizing', property, value);
      return;
    }
    debouncedUpdateDesignProperty('sizing', property, value);
  };

  const commitMeasurementProperty = (
    property: SizingMeasurementProperty,
    value: string | null,
  ) => {
    cancelPendingDesignProperties([property]);
    retainPendingSizingCommit(property, value);
    updateDesignProperty('sizing', property, value);
  };

  const sizingInputValue = (
    property: SizingMeasurementProperty,
    fallback: string,
  ) => activeSizingEditsRef.current[property]?.draft
    ?? pendingSizingValue(property, fallback);

  const sizingInputUnit = (property: SizingMeasurementProperty) => (
    activeSizingEditsRef.current[property]?.unit || ''
  );

  const normalizeEditedMeasurement = (
    property: SizingMeasurementProperty,
    inputValue: string,
    previousValue: string,
  ) => {
    const activeEdit = activeSizingEditsRef.current[property];
    if (activeEdit) {
      return commitSizingEditValue(
        property,
        activeEdit.mode,
        inputValue,
        activeEdit.unit,
      );
    }
    return normalizeSizingInputForMode(
      property,
      getSizingMode(property, previousValue),
      inputValue,
    );
  };

  const updateSizingDraft = (
    property: SizingMeasurementProperty,
    value: string,
  ) => {
    const edit = activeSizingEditsRef.current[property];
    if (edit) {
      activeSizingEditsRef.current[property] = {
        ...edit,
        draft: value.replace(/\s+/g, ''),
      };
    }
    setActiveSizingEdits((current) => {
      const currentEdit = current[property];
      if (!currentEdit) return current;
      return {
        ...current,
        [property]: { ...currentEdit, draft: value.replace(/\s+/g, '') },
      };
    });
  };

  const finishSizingEdit = (
    property: SizingMeasurementProperty,
    setInput: (value: string) => void,
    domDraft?: string,
  ) => {
    const edit = activeSizingEditsRef.current[property];
    if (!edit) return;
    // The DOM owns the freshest characters. Reading it on blur closes the
    // Enter race even when React has not committed the last onChange render.
    const draft = domDraft === undefined ? edit.draft : domDraft;
    const normalized = commitSizingEditValue(property, edit.mode, draft, edit.unit);
    setInput(normalized);
    commitMeasurementProperty(property, formatMeasurementValue(normalized));
    clearSizingEdit(property);
  };

  const cancelSizingEdit = (
    property: SizingMeasurementProperty,
    setInput: (value: string) => void,
  ) => {
    const edit = activeSizingEditsRef.current[property];
    if (!edit) return;
    setInput(edit.original);
    commitMeasurementProperty(property, formatMeasurementValue(edit.original));
    clearSizingEdit(property);
  };

  const sizingInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    property: SizingMeasurementProperty,
    setInput: (value: string) => void,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelSizingEdit(property, setInput);
      const input = event.currentTarget;
      requestAnimationFrame(() => input.blur());
    }
  };

  // Aspect ratio uses custom extraction to remove brackets
  const [aspectRatioInput, setAspectRatioInput] = useState(extractAspectRatioValue(aspectRatio));

  // Sync aspect ratio input when prop changes
  useEffect(() => {
    setAspectRatioInput(extractAspectRatioValue(aspectRatio));
  }, [aspectRatio]);

  // Handle width changes (debounced for text input)
  const handleWidthChange = (value: string) => {
    updateSizingDraft('width', value);
    const normalized = normalizeEditedMeasurement('width', value, widthInput);
    setWidthInput(normalized);
    updateMeasurementProperty('width', formatMeasurementValue(normalized));
  };

  // Get current width preset value (for Select display)
  const getWidthPresetValue = () => {
    const mode = getSizingMode('width', widthInput);
    if (mode === 'fill') return 'w-fill';
    if (mode === 'relative') return 'w-relative';
    if (mode === 'fit') return 'w-fit-content';
    if (mode === 'screen') return 'w-[100vw]';
    return 'w-fixed';
  };

  // Preset changes are immediate (button clicks)
  const handleWidthPresetChange = (value: string) => {
    clearSizingEdit('width');
    if (value === 'w-fixed') {
      const fixed = /^-?\d*\.?\d+(?:px)?$/i.test(widthInput.trim()) ? widthInput : '100';
      setWidthInput(fixed);
      commitMeasurementProperty('width', formatMeasurementValue(fixed));
    } else if (value === 'w-fill') {
      setWidthInput('fill');
      commitMeasurementProperty('width', 'fill');
    } else if (value === 'w-relative') {
      const relative = /%$/.test(widthInput) ? widthInput : '100%';
      setWidthInput(relative);
      commitMeasurementProperty('width', `[${relative}]`);
    } else if (value === 'w-fit-content') {
      setWidthInput('fit');
      commitMeasurementProperty('width', 'fit');
    } else if (value === 'w-[100vw]') {
      setWidthInput('100vw');
      commitMeasurementProperty('width', '[100vw]');
    }
  };

  // Handle height changes (debounced for text input)
  const handleHeightChange = (value: string) => {
    updateSizingDraft('height', value);
    const normalized = normalizeEditedMeasurement('height', value, heightInput);
    setHeightInput(normalized);
    updateMeasurementProperty('height', formatMeasurementValue(normalized));
  };

  // Get current height preset value (for Select display)
  const getHeightPresetValue = () => {
    const mode = getSizingMode('height', heightInput);
    if (mode === 'fill') return 'h-fill';
    if (mode === 'relative') return 'h-relative';
    if (mode === 'fit') return 'h-fit-content';
    if (mode === 'screen') return 'h-[100svh]';
    return 'h-fixed';
  };

  // Preset changes are immediate (button clicks)
  const handleHeightPresetChange = (value: string) => {
    clearSizingEdit('height');
    if (value === 'h-fixed') {
      const fixed = /^-?\d*\.?\d+(?:px)?$/i.test(heightInput.trim()) ? heightInput : '100';
      setHeightInput(fixed);
      commitMeasurementProperty('height', formatMeasurementValue(fixed));
    } else if (value === 'h-fill') {
      setHeightInput('fill');
      commitMeasurementProperty('height', 'fill');
    } else if (value === 'h-relative') {
      const relative = /%$/.test(heightInput) ? heightInput : '100%';
      setHeightInput(relative);
      commitMeasurementProperty('height', `[${relative}]`);
    } else if (value === 'h-fit-content') {
      setHeightInput('fit');
      commitMeasurementProperty('height', 'fit');
    } else if (value === 'h-[100svh]') {
      setHeightInput('100svh');
      commitMeasurementProperty('height', '[100svh]');
    }
  };

  // Get current min/max width preset values
  const getMinWidthPresetValue = () => {
    const mode = getSizingMode('minWidth', minWidthInput);
    if (mode === 'relative') return 'w-relative';
    if (mode === 'fit') return 'w-fit-content';
    if (mode === 'screen') return 'w-[100vw]';
    return 'w-fixed';
  };

  const getMaxWidthPresetValue = () => {
    const mode = getSizingMode('maxWidth', maxWidthInput);
    if (mode === 'relative') return 'w-relative';
    if (mode === 'fit') return 'w-fit-content';
    if (mode === 'screen') return 'w-[100vw]';
    return 'w-fixed';
  };

  // Handle min/max width changes (debounced for text input)
  const handleMinWidthChange = (value: string) => {
    updateSizingDraft('minWidth', value);
    const normalized = normalizeEditedMeasurement('minWidth', value, minWidthInput);
    setMinWidthInput(normalized);
    updateMeasurementProperty('minWidth', formatMeasurementValue(normalized));
  };

  const handleMinWidthPresetChange = (value: string) => {
    clearSizingEdit('minWidth');
    if (value === 'w-fixed') {
      const fixed = /^-?\d*\.?\d+(?:px)?$/i.test(minWidthInput.trim()) ? minWidthInput : '0';
      setMinWidthInput(fixed);
      commitMeasurementProperty('minWidth', formatMeasurementValue(fixed));
    } else if (value === 'w-relative') {
      setMinWidthInput('100%');
      commitMeasurementProperty('minWidth', '[100%]');
    } else if (value === 'w-fit-content') {
      setMinWidthInput('fit');
      commitMeasurementProperty('minWidth', 'fit');
    } else if (value === 'w-[100vw]') {
      setMinWidthInput('100vw');
      commitMeasurementProperty('minWidth', '[100vw]');
    }
  };

  const handleMaxWidthChange = (value: string) => {
    updateSizingDraft('maxWidth', value);
    const normalized = normalizeEditedMeasurement('maxWidth', value, maxWidthInput);
    setMaxWidthInput(normalized);
    updateMeasurementProperty('maxWidth', formatMeasurementValue(normalized));
  };

  const handleMaxWidthPresetChange = (value: string) => {
    clearSizingEdit('maxWidth');
    if (value === 'w-fixed') {
      const fixed = /^-?\d*\.?\d+(?:px)?$/i.test(maxWidthInput.trim()) ? maxWidthInput : '100';
      setMaxWidthInput(fixed);
      commitMeasurementProperty('maxWidth', formatMeasurementValue(fixed));
    } else if (value === 'w-relative') {
      setMaxWidthInput('100%');
      commitMeasurementProperty('maxWidth', '[100%]');
    } else if (value === 'w-fit-content') {
      setMaxWidthInput('fit');
      commitMeasurementProperty('maxWidth', 'fit');
    } else if (value === 'w-[100vw]') {
      setMaxWidthInput('100vw');
      commitMeasurementProperty('maxWidth', '[100vw]');
    }
  };

  // Get current min/max height preset values
  const getMinHeightPresetValue = () => {
    const mode = getSizingMode('minHeight', minHeightInput);
    if (mode === 'relative') return 'h-relative';
    if (mode === 'fit') return 'h-fit-content';
    if (mode === 'screen') return 'h-[100svh]';
    return 'h-fixed';
  };

  const getMaxHeightPresetValue = () => {
    const mode = getSizingMode('maxHeight', maxHeightInput);
    if (mode === 'relative') return 'h-relative';
    if (mode === 'fit') return 'h-fit-content';
    if (mode === 'screen') return 'h-[100svh]';
    return 'h-fixed';
  };

  // Handle min/max height changes (debounced for text input)
  const handleMinHeightChange = (value: string) => {
    updateSizingDraft('minHeight', value);
    const normalized = normalizeEditedMeasurement('minHeight', value, minHeightInput);
    setMinHeightInput(normalized);
    updateMeasurementProperty('minHeight', formatMeasurementValue(normalized));
  };

  const handleMinHeightPresetChange = (value: string) => {
    clearSizingEdit('minHeight');
    if (value === 'h-fixed') {
      const fixed = /^-?\d*\.?\d+(?:px)?$/i.test(minHeightInput.trim()) ? minHeightInput : '0';
      setMinHeightInput(fixed);
      commitMeasurementProperty('minHeight', formatMeasurementValue(fixed));
    } else if (value === 'h-relative') {
      setMinHeightInput('100%');
      commitMeasurementProperty('minHeight', '[100%]');
    } else if (value === 'h-fit-content') {
      setMinHeightInput('fit');
      commitMeasurementProperty('minHeight', 'fit');
    } else if (value === 'h-[100svh]') {
      setMinHeightInput('100svh');
      commitMeasurementProperty('minHeight', '[100svh]');
    }
  };

  const handleMaxHeightChange = (value: string) => {
    updateSizingDraft('maxHeight', value);
    const normalized = normalizeEditedMeasurement('maxHeight', value, maxHeightInput);
    setMaxHeightInput(normalized);
    updateMeasurementProperty('maxHeight', formatMeasurementValue(normalized));
  };

  const handleMaxHeightPresetChange = (value: string) => {
    clearSizingEdit('maxHeight');
    if (value === 'h-fixed') {
      const fixed = /^-?\d*\.?\d+(?:px)?$/i.test(maxHeightInput.trim()) ? maxHeightInput : '100';
      setMaxHeightInput(fixed);
      commitMeasurementProperty('maxHeight', formatMeasurementValue(fixed));
    } else if (value === 'h-relative') {
      setMaxHeightInput('100%');
      commitMeasurementProperty('maxHeight', '[100%]');
    } else if (value === 'h-fit-content') {
      setMaxHeightInput('fit');
      commitMeasurementProperty('maxHeight', 'fit');
    } else if (value === 'h-[100svh]') {
      setMaxHeightInput('100svh');
      commitMeasurementProperty('maxHeight', '[100svh]');
    }
  };

  const optionalSizingValues: Record<OptionalSizingProperty, string> = {
    minWidth: minWidthInput,
    maxWidth: maxWidthInput,
    minHeight: minHeightInput,
    maxHeight: maxHeightInput,
  };

  const isOptionalSizingPropertyVisible = (property: OptionalSizingProperty) => (
    hasMeaningfulSizingConstraint(property, optionalSizingValues[property])
    || Boolean(addedSizingProperties[property])
  );

  const handleAddSizingProperty = (property: OptionalSizingProperty) => {
    setAddedSizingProperties((current) => ({ ...current, [property]: true }));
  };

  const handleRemoveSizingProperty = (property: OptionalSizingProperty) => {
    clearSizingEdit(property);
    setAddedSizingProperties((current) => {
      if (!current[property]) return current;
      const next = { ...current };
      delete next[property];
      return next;
    });

    if (property === 'minWidth') setMinWidthInput('');
    if (property === 'maxWidth') setMaxWidthInput('');
    if (property === 'minHeight') setMinHeightInput('');
    if (property === 'maxHeight') setMaxHeightInput('');
    commitMeasurementProperty(property, null);
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

  // Get store values
  const currentPageId = useEditorStore((s) => s.currentPageId);
  const editingComponentId = useEditorStore((s) => s.editingComponentId);
  const editingComponentVariantId = useEditorStore((s) => s.editingComponentVariantId);
  const draftsByPageId = usePagesStore((s) => s.draftsByPageId);
  const componentDrafts = useComponentsStore((s) => s.componentDrafts);

  // Check if parent layer has grid display
  const storeParentHasGrid = useMemo(() => {
    if (!layer) return false;

    let layers: Layer[] = [];
    if (editingComponentId) {
      const variantDrafts = componentDrafts[editingComponentId];
      const variantId = (editingComponentVariantId && variantDrafts?.[editingComponentVariantId])
        ? editingComponentVariantId
        : (variantDrafts ? Object.keys(variantDrafts)[0] : null);
      layers = (variantId && variantDrafts) ? variantDrafts[variantId] || [] : [];
    } else if (currentPageId) {
      const draft = draftsByPageId[currentPageId];
      layers = draft ? draft.layers : [];
    }

    if (!layers.length) return false;

    // Find parent layer
    const findParent = (tree: Layer[], targetId: string, parent: Layer | null = null): Layer | null => {
      for (const node of tree) {
        if (node.id === targetId) return parent;
        if (node.children) {
          const found = findParent(node.children, targetId, node);
          if (found !== null) return found;
        }
      }
      return null;
    };

    const parent = findParent(layers, layer.id);
    if (!parent) return false;

    // Check if parent has grid display
    const parentDisplay = parent.design?.layout?.display;
    return parentDisplay === 'Grid';
  }, [layer, currentPageId, editingComponentId, editingComponentVariantId, draftsByPageId, componentDrafts]);
  const parentHasGrid = explicitParentHasGrid ?? storeParentHasGrid;

  const renderSizingField = ({
    property,
    label,
    ariaLabel,
    inputValue,
    setInput,
    presetValue,
    onValueChange,
    onPresetChange,
    presetOptions,
    optional = false,
  }: {
    property: SizingMeasurementProperty;
    label: string;
    ariaLabel: string;
    inputValue: string;
    setInput: (value: string) => void;
    presetValue: string;
    onValueChange: (value: string) => void;
    onPresetChange: (value: string) => void;
    presetOptions: SizingPresetOption[];
    optional?: boolean;
  }) => {
    const row = (
      <div
        className="group/sizing-row grid grid-cols-3 items-center"
        data-sizing-property={property}
      >
        <div className="flex h-8 min-w-0 items-center">
          <TruncatedLabel variant="muted">
            {label}
          </TruncatedLabel>
        </div>
        <div className="col-span-2 min-w-0">
          <div
            className={SIZING_VALUE_PRESET_GRID}
            role="group"
            aria-label={ariaLabel}
            data-design-token-property={({
              width: 'width',
              height: 'height',
              minWidth: 'min-width',
              minHeight: 'min-height',
              maxWidth: 'max-width',
              maxHeight: 'max-height',
            } as Record<SizingMeasurementProperty, string>)[property]}
          >
            <InputGroup className="min-w-0">
              <InputGroupInput
                aria-label={`${ariaLabel} value`}
                className="min-w-0 px-2 font-medium tabular-nums"
                placeholder={optional ? 'Add…' : undefined}
                value={sizingInputValue(property, inputValue)}
                readOnly={['fit', 'fill'].includes(getSizingMode(property, inputValue))}
                onFocus={(event) => beginSizingEdit(property, event.currentTarget.value)}
                onBlur={(event) => finishSizingEdit(
                  property,
                  setInput,
                  event.currentTarget.value,
                )}
                onKeyDown={(event) => sizingInputKeyDown(event, property, setInput)}
                onChange={(event) => onValueChange(event.target.value)}
              />
              {sizingInputUnit(property) && (
                <InputGroupAddon align="inline-end" className="px-2 text-xs font-normal">
                  {sizingInputUnit(property)}
                </InputGroupAddon>
              )}
            </InputGroup>
            <Select value={presetValue} onValueChange={onPresetChange}>
              <SelectTrigger
                size="xs"
                className="!h-8 w-full min-w-0 px-2"
                aria-label={`${ariaLabel} preset`}
              >
                <SelectValue>{sizingPresetDisplayLabel(presetValue)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {presetOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );

    if (!optional) return row;
    return (
      <ContextMenu key={property}>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem
            variant="destructive"
            onSelect={() => handleRemoveSizingProperty(property as OptionalSizingProperty)}
          >
            <Icon name="trash" />
            Remove {label}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <SettingsPanel
      title="Size" isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      collapsible
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" aria-label="Add sizing property" title="Add sizing property">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(OPTIONAL_SIZING_LABELS) as OptionalSizingProperty[])
              .filter((property) => !isOptionalSizingPropertyVisible(property))
              .map((property) => (
                <DropdownMenuItem
                  key={property}
                  onClick={() => handleAddSizingProperty(property)}
                >
                  {OPTIONAL_SIZING_LABELS[property]}
                </DropdownMenuItem>
              ))}
            {!aspectRatio && (
              <DropdownMenuItem onClick={handleAddAspectRatio}>
                Aspect ratio
              </DropdownMenuItem>
            )}
            {(Object.keys(OPTIONAL_SIZING_LABELS) as OptionalSizingProperty[])
              .every(isOptionalSizingPropertyVisible) && aspectRatio && (
                <DropdownMenuItem disabled>All sizing properties added</DropdownMenuItem>
              )}
            {(Object.keys(OPTIONAL_SIZING_LABELS) as OptionalSizingProperty[])
              .some(isOptionalSizingPropertyVisible) && <DropdownMenuSeparator />}
            {(Object.keys(OPTIONAL_SIZING_LABELS) as OptionalSizingProperty[])
              .filter(isOptionalSizingPropertyVisible)
              .map((property) => (
                <DropdownMenuItem
                  key={`remove-${property}`}
                  variant="destructive"
                  onClick={() => handleRemoveSizingProperty(property)}
                >
                  <Icon name="trash" />
                  Remove {OPTIONAL_SIZING_LABELS[property]}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >

{parentHasGrid && (
        <div className="grid grid-cols-3 items-start">
          <Label variant="muted" className="h-8">Span</Label>
          <div className="col-span-2 grid grid-cols-2 gap-2">
            <Select value={gridColumnSpan} onValueChange={handleGridColumnSpanChange}>
              <SelectTrigger>
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
              <SelectTrigger>
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

      {renderSizingField({
        property: 'width',
        label: 'Width',
        ariaLabel: 'Width',
        inputValue: widthInput,
        setInput: setWidthInput,
        presetValue: getWidthPresetValue(),
        onValueChange: handleWidthChange,
        onPresetChange: handleWidthPresetChange,
        presetOptions: WIDTH_PRESET_OPTIONS,
      })}

      {renderSizingField({
        property: 'height',
        label: 'Height',
        ariaLabel: 'Height',
        inputValue: heightInput,
        setInput: setHeightInput,
        presetValue: getHeightPresetValue(),
        onValueChange: handleHeightChange,
        onPresetChange: handleHeightPresetChange,
        presetOptions: HEIGHT_PRESET_OPTIONS,
      })}

      {isOptionalSizingPropertyVisible('minWidth') && renderSizingField({
        property: 'minWidth',
        label: OPTIONAL_SIZING_LABELS.minWidth,
        ariaLabel: 'Minimum width',
        inputValue: minWidthInput,
        setInput: setMinWidthInput,
        presetValue: getMinWidthPresetValue(),
        onValueChange: handleMinWidthChange,
        onPresetChange: handleMinWidthPresetChange,
        presetOptions: MIN_MAX_WIDTH_PRESET_OPTIONS,
        optional: true,
      })}

      {isOptionalSizingPropertyVisible('maxWidth') && renderSizingField({
        property: 'maxWidth',
        label: OPTIONAL_SIZING_LABELS.maxWidth,
        ariaLabel: 'Maximum width',
        inputValue: maxWidthInput,
        setInput: setMaxWidthInput,
        presetValue: getMaxWidthPresetValue(),
        onValueChange: handleMaxWidthChange,
        onPresetChange: handleMaxWidthPresetChange,
        presetOptions: MIN_MAX_WIDTH_PRESET_OPTIONS,
        optional: true,
      })}

      {isOptionalSizingPropertyVisible('minHeight') && renderSizingField({
        property: 'minHeight',
        label: OPTIONAL_SIZING_LABELS.minHeight,
        ariaLabel: 'Minimum height',
        inputValue: minHeightInput,
        setInput: setMinHeightInput,
        presetValue: getMinHeightPresetValue(),
        onValueChange: handleMinHeightChange,
        onPresetChange: handleMinHeightPresetChange,
        presetOptions: MIN_MAX_HEIGHT_PRESET_OPTIONS,
        optional: true,
      })}

      {isOptionalSizingPropertyVisible('maxHeight') && renderSizingField({
        property: 'maxHeight',
        label: OPTIONAL_SIZING_LABELS.maxHeight,
        ariaLabel: 'Maximum height',
        inputValue: maxHeightInput,
        setInput: setMaxHeightInput,
        presetValue: getMaxHeightPresetValue(),
        onValueChange: handleMaxHeightChange,
        onPresetChange: handleMaxHeightPresetChange,
        presetOptions: MIN_MAX_HEIGHT_PRESET_OPTIONS,
        optional: true,
      })}

      <div className="grid grid-cols-3 items-center">
        <span aria-hidden="true" />
        <div className="col-span-2 min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="input"
                size="sm"
                className="h-8 w-full min-w-0 justify-start gap-2 px-2 text-xs font-normal text-muted-foreground"
                aria-label="Add size constraint"
              >
                <Icon name="minSize" className="size-3.5 shrink-0" />
                <span className="truncate">Add…</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(Object.keys(OPTIONAL_SIZING_LABELS) as OptionalSizingProperty[])
                .filter((property) => !isOptionalSizingPropertyVisible(property))
                .map((property) => (
                  <DropdownMenuItem
                    key={property}
                    onClick={() => handleAddSizingProperty(property)}
                  >
                    {OPTIONAL_SIZING_LABELS[property]}
                  </DropdownMenuItem>
                ))}
              {(Object.keys(OPTIONAL_SIZING_LABELS) as OptionalSizingProperty[])
                .every(isOptionalSizingPropertyVisible) && (
                  <DropdownMenuItem disabled>All constraints added</DropdownMenuItem>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!hideOverflow && <div className="grid grid-cols-3">
        <Label variant="muted">Overflow</Label>
        <div className="col-span-2 *:w-full">
          <Select value={overflow} onValueChange={handleOverflowChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="visible">Visible</SelectItem>
                <SelectItem value="hidden">Hidden</SelectItem>
                <SelectItem value="scroll">Scroll</SelectItem>
                <SelectItem value="ellipsis">Ellipsis</SelectItem>
                <SelectItem value="auto">Auto</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>}

      {(['img', 'image', 'picture', 'video', 'canvas', 'iframe'].includes((layer?.name || '').toLowerCase())) && (
        <div className="grid grid-cols-3 items-center">
          <Label variant="muted">Object fit</Label>
          <div className="col-span-2 flex items-center gap-1">
            <Select value={objectFit} onValueChange={handleObjectFitChange}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="contain">Contain</SelectItem>
                  <SelectItem value="cover">Cover</SelectItem>
                  <SelectItem value="fill">Fill</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="scale-down">Scale down</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="input"
                  size="icon-sm"
                  className="rounded-lg"
                  aria-label="Object position"
                  title="Object position"
                >
                  <Icon name={(OBJECT_POSITIONS.find((p) => p.value === (objectPosition || 'center'))?.icon) || 'circle'} />
                </Button>
              </PopoverTrigger>
              <PopoverContent panelTitle="Object position" className="w-auto p-2 my-0.5" align="end">
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
        <div className="grid grid-cols-3 items-start">
          <Label variant="muted" className="h-8">Aspect ratio</Label>
          <div className="col-span-2 flex items-center gap-2">
            <ButtonGroup className="flex-1">
              <Input
                value={aspectRatioInput}
                onChange={(e) => handleAspectRatioChange(e.target.value)}
              />
              <ButtonGroupSeparator />
              <Select value={getAspectRatioPresetValue()} onValueChange={handleAspectRatioPresetChange}>
                <SelectTrigger />
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="aspect-square">Square</SelectItem>
                    <SelectItem value="aspect-video">Video</SelectItem>
                    <SelectItem value="aspect-4/3">4:3</SelectItem>
                    <SelectItem value="aspect-3/4">3:4</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </ButtonGroup>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove aspect ratio"
              className="size-7 shrink-0 opacity-70 hover:opacity-100"
              onClick={handleRemoveAspectRatio}
            >
              <Icon name="x" className="size-2.5" />
            </Button>
          </div>
        </div>
      )}

    </SettingsPanel>
  );
});
export default SizingControls;
