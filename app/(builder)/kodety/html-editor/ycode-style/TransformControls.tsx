'use client';

import { normalizeCssControlInput } from '@/lib/html-editor/visual-style-adapter';

import { memo, useState, useCallback, useEffect } from 'react';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import Icon from './ui/icon';
import SettingsPanel from './SettingsPanel';
import { useHtmlCssDesignSync as useDesignSync } from './use-html-css-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { useEditorStore } from '@/stores/useEditorStore';
import { extractDegreesValue, extractMeasurementValue } from '@/lib/measurement-utils';
import { cn } from '@/lib/utils';
import type { Layer } from '@/types';
import {
  VisualMeasurementControl,
  VisualMetricPairField,
} from '@/app/(builder)/kodety/components/VisualStyleField';
import { TransformOriginControl } from '@/app/(builder)/kodety/components/TransformOriginControl';

interface TransformControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const XY_FIELDS = [
  { id: 'move', label: 'Move', keys: ['translateX', 'translateY'] },
  { id: 'skew', label: 'Skew', keys: ['skewX', 'skewY'] },
] as const;

const TransformControls = memo(function TransformControls({ layer, onLayerUpdate }: TransformControlsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const activeBreakpoint = useEditorStore((state) => state.activeBreakpoint);
  const activeUIState = useEditorStore((state) => state.activeUIState);
  const { updateDesignProperty, updateDesignProperties, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  const scale = getDesignProperty('transforms', 'scale') || '';
  const rotate = getDesignProperty('transforms', 'rotate') || '';
  const rotateX = getDesignProperty('transforms', 'rotateX') || '';
  const rotateY = getDesignProperty('transforms', 'rotateY') || '';
  const rotateZ = getDesignProperty('transforms', 'rotateZ') || '';
  const depth = getDesignProperty('transforms', 'depth') || '';
  const translateX = getDesignProperty('transforms', 'translateX') || '';
  const translateY = getDesignProperty('transforms', 'translateY') || '';
  const skewX = getDesignProperty('transforms', 'skewX') || '';
  const skewY = getDesignProperty('transforms', 'skewY') || '';
  const transformOrigin = getDesignProperty('transforms', 'transformOrigin') || '';
  const transformStyle = getDesignProperty('transforms', 'transformStyle') || '';
  const backfaceVisibility = getDesignProperty('transforms', 'backfaceVisibility') || '';
  const is3D = rotateX !== '' || rotateY !== '' || rotateZ !== '' || depth !== '' || transformStyle === 'preserve-3d';

  // Track which transform sections are explicitly active so a row stays
  // visible when the user temporarily clears its inputs. The set is reseeded
  // from existing stored values whenever the layer/breakpoint/state changes.
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const next = new Set<string>();
    if (scale) next.add('scale');
    if (rotate || is3D) next.add('rotate');
    if (translateX !== '' || translateY !== '') next.add('move');
    if (skewX || skewY) next.add('skew');
    setActiveKeys(next);
    // Only reseed when the layer or active breakpoint/state changes — not on
    // every value edit, otherwise clearing an input would reactivate the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, activeBreakpoint, activeUIState]);

  const visibility: Record<string, boolean> = {
    scale: activeKeys.has('scale') || !!scale,
    rotate: activeKeys.has('rotate') || !!rotate || is3D,
    move: activeKeys.has('move') || translateX !== '' || translateY !== '',
    skew: activeKeys.has('skew') || !!skewX || !!skewY,
  };

  const measurementInputs = useControlledInputs({
    scale, depth, translateX, translateY,
  }, extractMeasurementValue);
  const angleInputs = useControlledInputs({
    rotate, rotateX, rotateY, rotateZ, skewX, skewY,
  }, extractDegreesValue);
  const inputs = { ...measurementInputs, ...angleInputs };

  const createHandler = useCallback(
    (property: string, setter: (v: string) => void) => (value: string) => {
      setter(value);
      const sanitized = normalizeCssControlInput(value);
      debouncedUpdateDesignProperty('transforms', property, sanitized || null);
    },
    [debouncedUpdateDesignProperty]
  );

  const handlers: Record<string, (v: string) => void> = {
    scale: createHandler('scale', inputs.scale[1]),
    rotate: createHandler('rotate', inputs.rotate[1]),
    rotateX: createHandler('rotateX', inputs.rotateX[1]),
    rotateY: createHandler('rotateY', inputs.rotateY[1]),
    rotateZ: createHandler('rotateZ', inputs.rotateZ[1]),
    depth: createHandler('depth', inputs.depth[1]),
    translateX: createHandler('translateX', inputs.translateX[1]),
    translateY: createHandler('translateY', inputs.translateY[1]),
    skewX: createHandler('skewX', inputs.skewX[1]),
    skewY: createHandler('skewY', inputs.skewY[1]),
  };

  const handleScaleSliderChange = useCallback((values: number[]) => {
    const value = (values[0] / 100).toFixed(2);
    inputs.scale[1](value);
    updateDesignProperty('transforms', 'scale', value);
  }, [inputs.scale, updateDesignProperty]);

  const handleOriginChange = useCallback((value: string) => {
    updateDesignProperty('transforms', 'transformOrigin', value === 'center' ? null : value);
  }, [updateDesignProperty]);

  const handleOriginInputChange = useCallback((value: string) => {
    debouncedUpdateDesignProperty('transforms', 'transformOrigin', value || null);
  }, [debouncedUpdateDesignProperty]);

  const setRotationMode = useCallback((mode: '2d' | '3d') => {
    if (mode === '3d') {
      const z = inputs.rotate[0] && inputs.rotate[0] !== 'none' ? inputs.rotate[0] : '0';
      inputs.rotate[1]('');
      inputs.rotateX[1]('0');
      inputs.rotateY[1]('0');
      inputs.rotateZ[1](z);
      inputs.depth[1]('0');
      updateDesignProperties([
        { category: 'transforms', property: 'rotate', value: null },
        { category: 'transforms', property: 'rotateX', value: '0' },
        { category: 'transforms', property: 'rotateY', value: '0' },
        { category: 'transforms', property: 'rotateZ', value: z },
        { category: 'transforms', property: 'depth', value: '0' },
        { category: 'transforms', property: 'transformStyle', value: 'preserve-3d' },
        { category: 'transforms', property: 'backfaceVisibility', value: backfaceVisibility || 'visible' },
      ]);
      return;
    }
    const planar = inputs.rotateZ[0] || '0';
    inputs.rotate[1](planar);
    inputs.rotateX[1]('');
    inputs.rotateY[1]('');
    inputs.rotateZ[1]('');
    inputs.depth[1]('');
    updateDesignProperties([
      { category: 'transforms', property: 'rotate', value: planar },
      { category: 'transforms', property: 'rotateX', value: null },
      { category: 'transforms', property: 'rotateY', value: null },
      { category: 'transforms', property: 'rotateZ', value: null },
      { category: 'transforms', property: 'depth', value: null },
      { category: 'transforms', property: 'transformStyle', value: null },
      { category: 'transforms', property: 'backfaceVisibility', value: null },
    ]);
  }, [backfaceVisibility, inputs.depth, inputs.rotate, inputs.rotateX, inputs.rotateY, inputs.rotateZ, updateDesignProperties]);

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

  const addHandlers: Record<string, () => void> = {
    scale: () => { activate('scale'); inputs.scale[1]('1'); updateDesignProperty('transforms', 'scale', '1'); },
    rotate: () => { activate('rotate'); inputs.rotate[1]('0'); updateDesignProperty('transforms', 'rotate', '0'); },
    move: () => {
      activate('move');
      inputs.translateX[1]('0'); inputs.translateY[1]('0');
      updateDesignProperty('transforms', 'translateX', '0');
      updateDesignProperty('transforms', 'translateY', '0');
    },
    skew: () => {
      activate('skew');
      inputs.skewX[1]('0'); inputs.skewY[1]('0');
      updateDesignProperty('transforms', 'skewX', '0');
      updateDesignProperty('transforms', 'skewY', '0');
    },
  };

  const removeHandlers: Record<string, () => void> = {
    scale: () => { deactivate('scale'); inputs.scale[1](''); updateDesignProperty('transforms', 'scale', null); },
    rotate: () => {
      deactivate('rotate');
      inputs.rotate[1](''); inputs.rotateX[1](''); inputs.rotateY[1](''); inputs.rotateZ[1](''); inputs.depth[1]('');
      updateDesignProperties([
        { category: 'transforms', property: 'rotate', value: null },
        { category: 'transforms', property: 'rotateX', value: null },
        { category: 'transforms', property: 'rotateY', value: null },
        { category: 'transforms', property: 'rotateZ', value: null },
        { category: 'transforms', property: 'depth', value: null },
        { category: 'transforms', property: 'transformStyle', value: null },
        { category: 'transforms', property: 'backfaceVisibility', value: null },
      ]);
    },
    move: () => {
      deactivate('move');
      inputs.translateX[1](''); inputs.translateY[1]('');
      updateDesignProperty('transforms', 'translateX', null);
      updateDesignProperty('transforms', 'translateY', null);
    },
    skew: () => {
      deactivate('skew');
      inputs.skewX[1](''); inputs.skewY[1]('');
      updateDesignProperty('transforms', 'skewX', null);
      updateDesignProperty('transforms', 'skewY', null);
    },
  };

  const renderRemoveButton = (id: string) => (
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
        removeHandlers[id]();
      }}
    >
      <Icon name="x" className="size-2.5" />
    </button>
  );

  const scaleSliderValue = parseFloat(inputs.scale[0]) || 1;
  const depthSliderValue = Math.max(0, Math.min(2000, parseFloat(inputs.depth[0]) || 0));

  return (
    <SettingsPanel
      title="Transform"
      onboardingId="design-style-transform"
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
            {['scale', 'rotate', 'move', 'skew'].map((id) => (
              <DropdownMenuItem
                key={id}
                onClick={addHandlers[id]}
                disabled={visibility[id]}
              >
                {id.charAt(0).toUpperCase() + id.slice(1)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {/* Scale */}
      {visibility.scale && (
        <div className="grid grid-cols-3">
          <Label variant="muted">Scale</Label>
          <div className="col-span-2 min-w-0">
            <Slider
              value={[Math.round(scaleSliderValue * 100)]}
              inputValue={inputs.scale[0]}
              onInputValueChange={handlers.scale}
              onValueChange={handleScaleSliderChange}
              min={0}
              max={200}
              step={5}
              action={renderRemoveButton('scale')}
            />
          </div>
        </div>
      )}

      {/* Rotate */}
      {visibility.rotate && (
        <>
          <div className="grid min-w-0 grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Rotate</Label>
            <div
              className="col-span-2 min-w-0 overflow-hidden rounded-[9px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.055]"
              onPointerDown={event => event.stopPropagation()}
            >
              <div className="grid h-9 min-w-0 grid-cols-[minmax(0,1fr)_32px]">
                {is3D ? (
                  <span className="flex min-w-0 items-center gap-2 px-2.5 text-[10px] text-white/52">
                    <span className="relative block size-3.5 shrink-0 rounded-[4px] border border-current before:absolute before:inset-[3px] before:rounded-[2px] before:border before:border-current before:content-['']" />
                    <span className="truncate">Rotação 3D</span>
                  </span>
                ) : (
                  <VisualMeasurementControl
                    glyph="rotate"
                    value={inputs.rotate[0]}
                    onChange={handlers.rotate}
                    ariaLabel="Rotate 2D"
                    placeholder="0"
                    step={1}
                    suffix="°"
                    property="rotate"
                    className="h-full rounded-none border-0 bg-transparent focus-within:border-0 focus-within:bg-white/[.025]"
                  />
                )}
                <span className="grid place-items-center border-l border-white/[.055] bg-black/10 text-white/42">
                  {renderRemoveButton('rotate')}
                </span>
              </div>
              <div
                role="group"
                aria-label="Modo de rotação"
                className="grid h-9 grid-cols-2 gap-[2px] border-t border-white/[.055] bg-black/10 p-[3px]"
              >
                {(['2d', '3d'] as const).map(mode => {
                  const active = mode === (is3D ? '3d' : '2d');
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      className={cn(
                        'rounded-[5px] text-[10px] font-medium uppercase tracking-[.04em] text-white/42 outline-none transition-[background-color,color] hover:text-white/78 focus-visible:text-white',
                        active && 'bg-white/[.14] text-white/95',
                      )}
                      onPointerDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={() => setRotationMode(mode)}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
              {is3D && (
                <div className="grid h-10 grid-cols-3 border-t border-white/[.055]">
                  {([
                    ['X', 'rotateX', inputs.rotateX[0], handlers.rotateX],
                    ['Y', 'rotateY', inputs.rotateY[0], handlers.rotateY],
                    ['Z', 'rotateZ', inputs.rotateZ[0], handlers.rotateZ],
                  ] as const).map(([axis, property, value, onChange], index) => (
                    <VisualMeasurementControl
                      key={property}
                      glyph="rotate"
                      icon={<span className="text-[10px] font-semibold text-current">{axis}</span>}
                      value={value}
                      onChange={onChange}
                      ariaLabel={`Rotate ${axis}`}
                      placeholder="0"
                      step={1}
                      suffix="°"
                      property={property}
                      compact
                      className={cn(
                        'h-full rounded-none border-0 bg-transparent focus-within:border-0 focus-within:bg-white/[.035]',
                        index > 0 && 'border-l border-l-white/[.055]',
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {is3D && (
            <div className="grid min-w-0 grid-cols-3 items-start">
              <Label variant="muted" className="h-8">Depth</Label>
              <div className="col-span-2 min-w-0">
                <Slider
                  aria-label="Perspective depth"
                  value={[depthSliderValue]}
                  inputValue={inputs.depth[0] || '0'}
                  onInputValueChange={handlers.depth}
                  onValueChange={values => handlers.depth(String(values[0]))}
                  min={0}
                  max={2000}
                  step={10}
                  unit="px"
                />
              </div>
            </div>
          )}

          <TransformOriginControl
            value={transformOrigin || 'center'}
            onPresetChange={handleOriginChange}
            onInputChange={handleOriginInputChange}
          />

          {is3D && (
            <div className="grid min-w-0 grid-cols-3 items-start">
              <Label variant="muted" className="h-8">Backface</Label>
              <div
                role="group"
                aria-label="Backface visibility"
                className="col-span-2 grid h-8 grid-cols-2 gap-[2px] rounded-[8px] bg-white/[.05] p-[3px]"
              >
                {(['visible', 'hidden'] as const).map(value => {
                  const active = (backfaceVisibility || 'visible') === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      className={cn(
                        'rounded-[6px] text-[10px] capitalize text-white/42 outline-none transition-[background-color,color] hover:text-white/78 focus-visible:text-white',
                        active && 'bg-white/[.13] text-white/92',
                      )}
                      onPointerDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={() => updateDesignProperty('transforms', 'backfaceVisibility', value)}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Move & Skew */}
      {XY_FIELDS.map((field) => {
        if (!visibility[field.id]) return null;
        return (
          <VisualMetricPairField
            key={field.id}
            label={field.label}
            first={{
              glyph: field.id === 'move' ? 'move-x' : 'skew-x',
              value: inputs[field.keys[0]][0],
              onChange: handlers[field.keys[0]],
              ariaLabel: `${field.label} X`,
              placeholder: '0',
              suffix: field.id === 'skew' ? 'deg' : undefined,
              property: field.id === 'move' ? 'translate-x' : 'skew-x',
            }}
            second={{
              glyph: field.id === 'move' ? 'move-y' : 'skew-y',
              value: inputs[field.keys[1]][0],
              onChange: handlers[field.keys[1]],
              ariaLabel: `${field.label} Y`,
              placeholder: '0',
              suffix: field.id === 'skew' ? 'deg' : undefined,
              property: field.id === 'move' ? 'translate-y' : 'skew-y',
              action: renderRemoveButton(field.id),
            }}
          />
        );
      })}
    </SettingsPanel>
  );
});

export default TransformControls;
