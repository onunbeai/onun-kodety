'use client';

import { normalizeCssControlInput } from '@/lib/html-editor/visual-style-adapter';

import { memo, useState, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import Icon from './ui/icon';
import SettingsPanel from './SettingsPanel';
import { useHtmlCssDesignSync as useDesignSync } from './use-html-css-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { useEditorStore } from '@/stores/useEditorStore';
import { extractMillisecondsValue } from '@/lib/measurement-utils';

import type { Layer } from '@/types';
import {
  VisualMeasurementField,
  VisualSelectField,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';

interface TransitionControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const TRANSITION_PROPERTY_OPTIONS: VisualStyleOption[] = [
  { value: 'none', label: 'None' },
  { value: 'all', label: 'All' },
  { value: 'default', label: 'Default' },
  { value: 'colors', label: 'Colors' },
  { value: 'opacity', label: 'Opacity' },
  { value: 'shadow', label: 'Shadow' },
  { value: 'transform', label: 'Transform' },
];

const EASING_OPTIONS: VisualStyleOption[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'in', label: 'Ease In' },
  { value: 'out', label: 'Ease Out' },
  { value: 'in-out', label: 'Ease In Out' },
];

const TransitionControls = memo(function TransitionControls({ layer, onLayerUpdate }: TransitionControlsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const activeBreakpoint = useEditorStore((state) => state.activeBreakpoint);
  const activeUIState = useEditorStore((state) => state.activeUIState);
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  const transitionProperty = getDesignProperty('transitions', 'transitionProperty') || '';
  const duration = getDesignProperty('transitions', 'duration') || '';
  const easing = getDesignProperty('transitions', 'easing') || '';
  const delay = getDesignProperty('transitions', 'delay') || '';

  // Track which optional rows are explicitly active so they stay visible when
  // the user temporarily clears their inputs. Reseeded whenever the layer or
  // active breakpoint/state changes.
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const next = new Set<string>();
    if (easing) next.add('easing');
    if (delay) next.add('delay');
    setActiveKeys(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, activeBreakpoint, activeUIState]);

  const hasEasing = activeKeys.has('easing') || !!easing;
  const hasDelay = activeKeys.has('delay') || !!delay;

  const inputs = useControlledInputs({ duration, delay }, extractMillisecondsValue);

  const createTimingHandler = useCallback(
    (property: string, setter: (v: string) => void) => (value: string) => {
      let sanitized = normalizeCssControlInput(value);
      if (sanitized.endsWith('s') && !sanitized.endsWith('ms')) {
        sanitized = String(parseFloat(sanitized) * 1000);
      }
      setter(sanitized);
      debouncedUpdateDesignProperty('transitions', property, sanitized || null);
    },
    [debouncedUpdateDesignProperty]
  );

  const handleDurationChange = createTimingHandler('duration', inputs.duration[1]);
  const handleDelayChange = createTimingHandler('delay', inputs.delay[1]);

  const handlePropertyChange = useCallback((value: string) => {
    updateDesignProperty('transitions', 'transitionProperty', value || null);
  }, [updateDesignProperty]);

  const handleEasingChange = useCallback((value: string) => {
    updateDesignProperty('transitions', 'easing', value || null);
  }, [updateDesignProperty]);

  const activate = useCallback((id: string) => {
    setActiveKeys(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const deactivate = useCallback((id: string) => {
    setActiveKeys(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleAddEasing = useCallback(() => {
    activate('easing');
    updateDesignProperty('transitions', 'easing', 'linear');
  }, [activate, updateDesignProperty]);

  const handleAddDelay = useCallback(() => {
    activate('delay');
    inputs.delay[1]('0');
    updateDesignProperty('transitions', 'delay', '0');
  }, [activate, inputs.delay, updateDesignProperty]);

  const handleRemoveEasing = useCallback(() => {
    deactivate('easing');
    updateDesignProperty('transitions', 'easing', null);
  }, [deactivate, updateDesignProperty]);

  const handleRemoveDelay = useCallback(() => {
    deactivate('delay');
    inputs.delay[1]('');
    updateDesignProperty('transitions', 'delay', null);
  }, [deactivate, inputs.delay, updateDesignProperty]);

  const renderRemoveButton = (id: string, onRemove: () => void) => (
    <button
      type="button"
      aria-label={`Remove ${id}`}
      className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <Icon name="x" className="size-2.5" />
    </button>
  );

  return (
    <SettingsPanel
      title="Transition"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleAddEasing} disabled={hasEasing}>
              Easing
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleAddDelay} disabled={hasDelay}>
              Delay
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <VisualSelectField
        label="Property"
        value={transitionProperty || 'none'}
        options={TRANSITION_PROPERTY_OPTIONS}
        onValueChange={handlePropertyChange}
        ariaLabel="Transition property"
        property="transition-property"
      />

      {/* Duration */}
      <VisualMeasurementField
        label="Duration"
        glyph="duration"
        value={inputs.duration[0]}
        onChange={handleDurationChange}
        ariaLabel="Transition duration"
        placeholder="150"
        min={0}
        step={10}
        suffix="ms"
        property="transition-duration"
      />

      {/* Easing */}
      {hasEasing && (
        <VisualSelectField
          label="Easing"
          value={easing || 'linear'}
          options={EASING_OPTIONS}
          onValueChange={handleEasingChange}
          ariaLabel="Transition easing"
          property="transition-timing-function"
          action={renderRemoveButton('easing', handleRemoveEasing)}
        />
      )}

      {/* Delay */}
      {hasDelay && (
        <VisualMeasurementField
          label="Delay"
          glyph="delay"
          value={inputs.delay[0]}
          onChange={handleDelayChange}
          ariaLabel="Transition delay"
          placeholder="0"
          min={0}
          step={10}
          suffix="ms"
          property="transition-delay"
          action={renderRemoveButton('delay', handleRemoveDelay)}
        />
      )}
    </SettingsPanel>
  );
});

export default TransitionControls;
