'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Minus, Plus } from '@/components/ui/gravity-icons';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { useEditorStore } from '@/stores/useEditorStore';
import { extractMeasurementValue } from '@/lib/measurement-utils';
import { cn, removeSpaces } from '@/lib/utils';
import type { Layer } from '@/types';
import SettingsPanel from './SettingsPanel';
import { VisualMeasurementControl, VisualSelectControl, type VisualStyleOption } from './VisualStyleField';

interface PositionControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  /** Explicit CSS pins. Computed inset values may still be shown while inactive. */
  activeInsetSides?: InsetSide[];
  /** The HTML adapter preserves CSS syntax; legacy class controls compact it. */
  normalizeInput?: (value: string) => string;
}

type PositionMode = 'static' | 'relative' | 'absolute' | 'sticky' | 'fixed';
type InsetSide = 'top' | 'right' | 'bottom' | 'left';
type PositionAxis = 'horizontal' | 'vertical';
type PositionAlignment = 'start' | 'center' | 'end';

const INSET_META: Record<InsetSide, { label: string; shortLabel: string }> = {
  top: { label: 'Top', shortLabel: 'T' },
  right: { label: 'Right', shortLabel: 'R' },
  bottom: { label: 'Bottom', shortLabel: 'B' },
  left: { label: 'Left', shortLabel: 'L' },
};

const STICKY_OPTIONAL_SIDES: InsetSide[] = ['bottom', 'left', 'right'];
const INSET_SIDES: InsetSide[] = ['top', 'right', 'bottom', 'left'];
const POSITION_OPTIONS: VisualStyleOption[] = [
  { value: 'static', label: 'Static', glyph: 'position-static', description: 'Fluxo normal' },
  { value: 'relative', label: 'Relative', glyph: 'position-relative', description: 'Desloca do ponto original' },
  { value: 'absolute', label: 'Absolute', glyph: 'position-absolute', description: 'Posição no ancestral' },
  { value: 'sticky', label: 'Sticky', glyph: 'position-sticky', description: 'Fixa na rolagem' },
  { value: 'fixed', label: 'Fixed', glyph: 'position-fixed', description: 'Fixa na tela' },
];

function isInsetActive(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && normalized !== 'auto');
}

function sanitizeInset(value: string, normalizeInput = removeSpaces) {
  const sanitized = normalizeInput(value);
  return sanitized || null;
}

function stepInsetValue(value: string, delta: number) {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return String(delta);
  const next = Number(match[1]) + delta;
  return `${Number.isInteger(next) ? next : Number(next.toFixed(3))}${match[2]}`;
}

function PositionAlignmentGlyph({
  axis,
  alignment,
}: {
  axis: PositionAxis;
  alignment: PositionAlignment;
}) {
  if (axis === 'horizontal') {
    return (
      <span aria-hidden="true" className="relative block h-4 w-5">
        <span
          className={cn(
            'absolute top-0 h-4 w-px rounded-full bg-current opacity-75',
            alignment === 'start' ? 'left-0' : alignment === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0',
          )}
        />
        <span
          className={cn(
            'absolute top-1/2 h-1.5 w-2.5 -translate-y-1/2 rounded-[2px] border border-current',
            alignment === 'start' ? 'left-1' : alignment === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-1',
          )}
        />
      </span>
    );
  }

  return (
    <span aria-hidden="true" className="relative block h-5 w-4">
      <span
        className={cn(
          'absolute left-0 h-px w-4 rounded-full bg-current opacity-75',
          alignment === 'start' ? 'top-0' : alignment === 'center' ? 'top-1/2 -translate-y-1/2' : 'bottom-0',
        )}
      />
      <span
        className={cn(
          'absolute left-1/2 h-2.5 w-1.5 -translate-x-1/2 rounded-[2px] border border-current',
          alignment === 'start' ? 'top-1' : alignment === 'center' ? 'top-1/2 -translate-y-1/2' : 'bottom-1',
        )}
      />
    </span>
  );
}

function ZIndexDepthGlyph() {
  return (
    <span aria-hidden="true" className="relative block h-4 w-[18px]">
      <span className="absolute left-1/2 top-[1px] h-[3px] w-[10px] -translate-x-1/2 rounded-full bg-current opacity-45" />
      <span className="absolute left-1/2 top-[6px] h-[3px] w-[14px] -translate-x-1/2 rounded-full bg-current opacity-70" />
      <span className="absolute bottom-[1px] left-1/2 h-[3px] w-[18px] -translate-x-1/2 rounded-full bg-current" />
    </span>
  );
}

function PositionInsetField({
  side,
  value,
  onChange,
  className,
}: {
  side: InsetSide;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const meta = INSET_META[side];
  return (
    <label
      className={cn(
        'relative block h-7 min-w-0 overflow-hidden rounded-[7px] border border-border/55 bg-foreground/[0.065] transition-colors focus-within:border-[var(--kodety-focus)]/80 focus-within:bg-foreground/[0.09]',
        className,
      )}
    >
      <span className="sr-only">{meta.label}</span>
      <input
        aria-label={meta.label}
        value={value}
        placeholder="0"
        onChange={event => onChange(event.target.value)}
        className="h-full w-full min-w-0 bg-transparent pl-2 pr-6 text-[10px] tabular-nums text-foreground outline-none placeholder:text-muted-foreground/70"
        spellCheck={false}
      />
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-medium text-muted-foreground/70">
        {meta.shortLabel}
      </span>
    </label>
  );
}

const PositionControls = memo(function PositionControls({ layer, onLayerUpdate, activeInsetSides, normalizeInput = removeSpaces }: PositionControlsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const activeBreakpoint = useEditorStore(state => state.activeBreakpoint);
  const activeUIState = useEditorStore(state => state.activeUIState);
  const {
    updateDesignProperty,
    updateDesignProperties,
    debouncedUpdateDesignProperty,
    cancelPendingDesignProperties,
    getDesignProperty,
  } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  const position = (getDesignProperty('positioning', 'position') || 'static') as PositionMode;
  const top = getDesignProperty('positioning', 'top') || '';
  const right = getDesignProperty('positioning', 'right') || '';
  const bottom = getDesignProperty('positioning', 'bottom') || '';
  const left = getDesignProperty('positioning', 'left') || '';
  const zIndex = getDesignProperty('positioning', 'zIndex') || '';
  const translateX = getDesignProperty('transforms', 'translateX') || '';
  const translateY = getDesignProperty('transforms', 'translateY') || '';

  const inputs = useControlledInputs({ top, right, bottom, left, zIndex }, extractMeasurementValue);
  const [topInput, setTopInput] = inputs.top;
  const [rightInput, setRightInput] = inputs.right;
  const [bottomInput, setBottomInput] = inputs.bottom;
  const [leftInput, setLeftInput] = inputs.left;
  const [zIndexInput, setZIndexInput] = inputs.zIndex;
  const inputValues: Record<InsetSide, string> = {
    top: topInput,
    right: rightInput,
    bottom: bottomInput,
    left: leftInput,
  };
  const inputSetters: Record<InsetSide, (value: string) => void> = {
    top: setTopInput,
    right: setRightInput,
    bottom: setBottomInput,
    left: setLeftInput,
  };
  const activeInsetSignature = activeInsetSides
    ? INSET_SIDES.filter(side => activeInsetSides.includes(side)).join('|')
    : null;
  const [activeInsets, setActiveInsets] = useState<Set<InsetSide>>(() => new Set(
    activeInsetSides ?? INSET_SIDES.filter(side => isInsetActive(inputValues[side])),
  ));

  useEffect(() => {
    setActiveInsets(new Set(
      activeInsetSides ?? INSET_SIDES.filter(side => isInsetActive(inputValues[side])),
    ));
    // Computed inset measurements change as the element moves. They must not
    // reactivate a pin that the user explicitly disabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInsetSignature, layer?.id, position]);

  const [stickyAddedSides, setStickyAddedSides] = useState<InsetSide[]>([]);

  useEffect(() => {
    if (position !== 'sticky') return;
    setStickyAddedSides(STICKY_OPTIONAL_SIDES.filter(side => {
      const value = { right, bottom, left }[side as 'right' | 'bottom' | 'left'];
      return Boolean(value && value.trim().toLowerCase() !== 'auto');
    }));
    if (!top.trim() || top.trim().toLowerCase() === 'auto') {
      setTopInput('0');
      updateDesignProperty('positioning', 'top', '0');
    }
    // Reset the visible Sticky properties only when the selection or mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, position]);

  const visibleStickySides = useMemo(
    () => new Set<InsetSide>(['top', ...stickyAddedSides]),
    [stickyAddedSides],
  );

  const changeInset = (side: InsetSide, value: string, immediate = false) => {
    inputSetters[side](value);
    const nextValue = sanitizeInset(value, normalizeInput);
    setActiveInsets(current => {
      const next = new Set(current);
      if (isInsetActive(value)) next.add(side);
      else next.delete(side);
      return next;
    });
    if (immediate) updateDesignProperty('positioning', side, nextValue);
    else debouncedUpdateDesignProperty('positioning', side, nextValue);
  };

  const changeZIndex = (value: string, immediate = false) => {
    setZIndexInput(value);
    const nextValue = normalizeInput(value) || null;
    if (immediate) {
      cancelPendingDesignProperties(['zIndex']);
      updateDesignProperty('positioning', 'zIndex', nextValue);
    } else {
      debouncedUpdateDesignProperty('positioning', 'zIndex', nextValue);
    }
  };

  const toggleInset = (side: InsetSide) => {
    cancelPendingDesignProperties([side]);
    if (activeInsets.has(side)) {
      setActiveInsets(current => {
        const next = new Set(current);
        next.delete(side);
        return next;
      });
      inputSetters[side]('');
      updateDesignProperty('positioning', side, null);
      return;
    }
    const displayedValue = inputValues[side].trim();
    changeInset(side, isInsetActive(displayedValue) ? displayedValue : '0', true);
  };

  const activateAllInsets = () => {
    cancelPendingDesignProperties(INSET_SIDES);
    const nextValues = Object.fromEntries(INSET_SIDES.map(side => {
      const displayedValue = inputValues[side].trim();
      return [side, isInsetActive(displayedValue) ? displayedValue : '0'];
    })) as Record<InsetSide, string>;
    setActiveInsets(new Set(INSET_SIDES));
    INSET_SIDES.forEach(side => inputSetters[side](nextValues[side]));
    updateDesignProperties(INSET_SIDES.map(side => ({
      category: 'positioning',
      property: side,
      value: sanitizeInset(nextValues[side], normalizeInput),
    })));
  };

  const handlePositionChange = (value: string) => {
    const nextPosition = value as PositionMode;
    updateDesignProperty('positioning', 'position', nextPosition);
    if (nextPosition === 'sticky' && (!topInput.trim() || topInput.trim().toLowerCase() === 'auto')) {
      changeInset('top', '0', true);
    }
  };

  const toggleStickySide = (side: InsetSide, visible: boolean) => {
    setStickyAddedSides(current => visible
      ? Array.from(new Set([...current, side]))
      : current.filter(currentSide => currentSide !== side));
    if (visible && (!inputValues[side].trim() || inputValues[side].trim().toLowerCase() === 'auto')) {
      changeInset(side, '0', true);
    } else if (!visible) {
      changeInset(side, '', true);
    }
  };

  const applyPositionAlignment = (axis: PositionAxis, alignment: PositionAlignment) => {
    const sides: InsetSide[] = axis === 'horizontal' ? ['left', 'right'] : ['top', 'bottom'];
    const startSide = axis === 'horizontal' ? 'left' : 'top';
    const endSide = axis === 'horizontal' ? 'right' : 'bottom';
    const translateProperty = axis === 'horizontal' ? 'translateX' : 'translateY';
    const startValue = alignment === 'center' ? '50%' : alignment === 'start' ? '0%' : '';
    const endValue = alignment === 'end' ? '0%' : '';

    cancelPendingDesignProperties(sides);
    inputSetters[startSide](startValue);
    inputSetters[endSide](endValue);
    setActiveInsets(current => {
      const next = new Set(current);
      next.delete(startSide);
      next.delete(endSide);
      if (startValue) next.add(startSide);
      if (endValue) next.add(endSide);
      return next;
    });
    updateDesignProperties([
      { category: 'positioning', property: startSide, value: startValue || null },
      { category: 'positioning', property: endSide, value: endValue || null },
      {
        category: 'transforms',
        property: translateProperty,
        value: alignment === 'center' ? '-50%' : null,
      },
    ]);
  };

  const normalized = (value: string) => value.trim().toLowerCase().replace(/^0(?:px|rem|em)?$/, '0%');
  const positionAlignmentIsActive = (axis: PositionAxis, alignment: PositionAlignment) => {
    const start = normalized(axis === 'horizontal' ? leftInput : topInput);
    const end = normalized(axis === 'horizontal' ? rightInput : bottomInput);
    const translation = normalized(axis === 'horizontal' ? translateX : translateY);
    if (alignment === 'center') return start === '50%' && !isInsetActive(end) && translation === '-50%';
    const unshifted = !translation || translation === '0%';
    if (alignment === 'start') return start === '0%' && !isInsetActive(end) && unshifted;
    return end === '0%' && !isInsetActive(start) && unshifted;
  };

  const showInsetDiagram = position === 'absolute' || position === 'fixed';
  const positionSelect = (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2">
      <Label variant="muted">Type</Label>
      <VisualSelectControl
        value={position}
        options={POSITION_OPTIONS}
        onValueChange={handlePositionChange}
        ariaLabel="Position type"
        property="position"
      />
    </div>
  );

  return (
    <SettingsPanel
      title="Position"
      onboardingId="design-style-position"
      isOpen={isOpen}
      onToggle={() => setIsOpen(current => !current)}
      collapsible
      action={position === 'sticky' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Adicionar offset ao Sticky" title="Adicionar offset">
              <Plus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            {STICKY_OPTIONAL_SIDES.map(side => (
              <DropdownMenuCheckboxItem
                key={side}
                checked={visibleStickySides.has(side)}
                onCheckedChange={checked => toggleStickySide(side, Boolean(checked))}
              >
                {INSET_META[side].label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : undefined}
    >
      <div data-position-mode={position} className="flex min-w-0 flex-col gap-3">
        {showInsetDiagram && (
          <div
            data-position-inset-diagram
            className="w-full overflow-hidden rounded-[10px] border border-white/[.065] bg-white/[.025]"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] grid-rows-[28px_64px_28px] gap-2 p-3">
              <PositionInsetField side="top" value={topInput} onChange={value => changeInset('top', value)} className="col-start-2 row-start-1" />
              <PositionInsetField side="left" value={leftInput} onChange={value => changeInset('left', value)} className="col-start-1 row-start-2 self-center" />
              <div className="relative col-start-2 row-start-2 rounded-[7px] border border-border/45 bg-foreground/[0.065]">
                <button
                  type="button"
                  aria-label="Ancorar no topo"
                  aria-pressed={activeInsets.has('top')}
                  data-position-inset-side="top"
                  title="Topo"
                  onClick={() => toggleInset('top')}
                  className="group absolute inset-x-[21px] top-0 z-10 h-[22px] outline-none"
                >
                  <span className={cn('absolute left-1/2 top-2 h-4 w-px -translate-x-1/2 rounded-full bg-muted-foreground/65 transition-colors group-hover:bg-[var(--kodety-accent-hover)]', activeInsets.has('top') && 'bg-[var(--kodety-accent)]')} />
                </button>
                <button
                  type="button"
                  aria-label="Ancorar à direita"
                  aria-pressed={activeInsets.has('right')}
                  data-position-inset-side="right"
                  title="Direita"
                  onClick={() => toggleInset('right')}
                  className="group absolute bottom-[21px] right-0 top-[21px] z-10 w-[22px] outline-none"
                >
                  <span className={cn('absolute right-2 top-1/2 h-px w-4 -translate-y-1/2 rounded-full bg-muted-foreground/65 transition-colors group-hover:bg-[var(--kodety-accent-hover)]', activeInsets.has('right') && 'bg-[var(--kodety-accent)]')} />
                </button>
                <button
                  type="button"
                  aria-label="Ancorar embaixo"
                  aria-pressed={activeInsets.has('bottom')}
                  data-position-inset-side="bottom"
                  title="Embaixo"
                  onClick={() => toggleInset('bottom')}
                  className="group absolute inset-x-[21px] bottom-0 z-10 h-[22px] outline-none"
                >
                  <span className={cn('absolute bottom-2 left-1/2 h-4 w-px -translate-x-1/2 rounded-full bg-muted-foreground/65 transition-colors group-hover:bg-[var(--kodety-accent-hover)]', activeInsets.has('bottom') && 'bg-[var(--kodety-accent)]')} />
                </button>
                <button
                  type="button"
                  aria-label="Ancorar à esquerda"
                  aria-pressed={activeInsets.has('left')}
                  data-position-inset-side="left"
                  title="Esquerda"
                  onClick={() => toggleInset('left')}
                  className="group absolute bottom-[21px] left-0 top-[21px] z-10 w-[22px] outline-none"
                >
                  <span className={cn('absolute left-2 top-1/2 h-px w-4 -translate-y-1/2 rounded-full bg-muted-foreground/65 transition-colors group-hover:bg-[var(--kodety-accent-hover)]', activeInsets.has('left') && 'bg-[var(--kodety-accent)]')} />
                </button>
                <button
                  type="button"
                  aria-label="Ancorar em todos os lados"
                  aria-pressed={INSET_SIDES.every(side => activeInsets.has(side))}
                  title="Ativar todos os lados"
                  onClick={activateAllInsets}
                  className={cn(
                    'absolute left-1/2 top-1/2 z-20 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] border border-border/60 bg-foreground/[0.13] outline-none transition-colors hover:border-[var(--kodety-accent-hover)]/70 hover:bg-foreground/[0.18] focus-visible:border-[var(--kodety-focus)]',
                    INSET_SIDES.every(side => activeInsets.has(side)) && 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/15',
                  )}
                >
                  <span className="size-1.5 rounded-full bg-[var(--kodety-accent)]" />
                </button>
              </div>
              <PositionInsetField side="right" value={rightInput} onChange={value => changeInset('right', value)} className="col-start-3 row-start-2 self-center" />
              <PositionInsetField side="bottom" value={bottomInput} onChange={value => changeInset('bottom', value)} className="col-start-2 row-start-3" />
            </div>
            <div className="flex h-9 items-stretch gap-0.5 border-t border-white/[.065] bg-black/10 p-1">
              {(['start', 'center', 'end'] as PositionAlignment[]).map(alignment => (
                <button
                  key={`horizontal-${alignment}`}
                  type="button"
                  aria-label={alignment === 'start' ? 'Alinhar à esquerda' : alignment === 'center' ? 'Centralizar horizontalmente' : 'Alinhar à direita'}
                  aria-pressed={positionAlignmentIsActive('horizontal', alignment)}
                  title={alignment === 'start' ? 'Alinhar à esquerda' : alignment === 'center' ? 'Centralizar horizontalmente' : 'Alinhar à direita'}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => applyPositionAlignment('horizontal', alignment)}
                  className={cn(
                    'grid min-w-0 flex-1 place-items-center rounded-[6px] text-white/36 outline-none transition-[color,background-color] hover:bg-white/[.055] hover:text-white/65 focus-visible:bg-white/[.065] focus-visible:text-[var(--kodety-accent-hover)]',
                    positionAlignmentIsActive('horizontal', alignment) && 'bg-[var(--kodety-accent)]/15 text-[var(--kodety-accent-hover)]',
                  )}
                >
                  <PositionAlignmentGlyph axis="horizontal" alignment={alignment} />
                </button>
              ))}
              <span aria-hidden="true" className="mx-0.5 my-1 w-px shrink-0 bg-white/[.08]" />
              {(['start', 'center', 'end'] as PositionAlignment[]).map(alignment => (
                <button
                  key={`vertical-${alignment}`}
                  type="button"
                  aria-label={alignment === 'start' ? 'Alinhar ao topo' : alignment === 'center' ? 'Centralizar verticalmente' : 'Alinhar embaixo'}
                  aria-pressed={positionAlignmentIsActive('vertical', alignment)}
                  title={alignment === 'start' ? 'Alinhar ao topo' : alignment === 'center' ? 'Centralizar verticalmente' : 'Alinhar embaixo'}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => applyPositionAlignment('vertical', alignment)}
                  className={cn(
                    'grid min-w-0 flex-1 place-items-center rounded-[6px] text-white/36 outline-none transition-[color,background-color] hover:bg-white/[.055] hover:text-white/65 focus-visible:bg-white/[.065] focus-visible:text-[var(--kodety-accent-hover)]',
                    positionAlignmentIsActive('vertical', alignment) && 'bg-[var(--kodety-accent)]/15 text-[var(--kodety-accent-hover)]',
                  )}
                >
                  <PositionAlignmentGlyph axis="vertical" alignment={alignment} />
                </button>
              ))}
            </div>
          </div>
        )}

        {!showInsetDiagram && positionSelect}

        {position === 'sticky' && (
          <div className="flex flex-col gap-2">
            {(['top', 'bottom', 'left', 'right'] as InsetSide[]).filter(side => visibleStickySides.has(side)).map(side => (
              <div key={side} className="grid grid-cols-[88px_minmax(0,1fr)_92px] items-center gap-2">
                <Label variant="muted">{INSET_META[side].label}</Label>
                <label className="relative block h-9 min-w-0 overflow-hidden rounded-xl bg-foreground/[0.075] focus-within:bg-foreground/[0.1]">
                  <span className="sr-only">{INSET_META[side].label}</span>
                  <input
                    aria-label={`${INSET_META[side].label} sticky offset`}
                    value={inputValues[side]}
                    placeholder="0"
                    onChange={event => changeInset(side, event.target.value)}
                    className="h-full w-full min-w-0 bg-transparent px-3 text-[12px] tabular-nums text-foreground outline-none placeholder:text-muted-foreground/75"
                    spellCheck={false}
                  />
                </label>
                <div className="grid h-9 grid-cols-[1fr_1px_1fr] items-center overflow-hidden rounded-xl bg-foreground/[0.075]">
                  <button
                    type="button"
                    aria-label={`Diminuir ${INSET_META[side].label}`}
                    className="flex h-full items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
                    onClick={() => changeInset(side, stepInsetValue(inputValues[side], -1), true)}
                  ><Minus className="size-3.5" /></button>
                  <span className="h-5 w-px bg-border/70" />
                  <button
                    type="button"
                    aria-label={`Aumentar ${INSET_META[side].label}`}
                    className="flex h-full items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
                    onClick={() => changeInset(side, stepInsetValue(inputValues[side], 1), true)}
                  ><Plus className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showInsetDiagram && positionSelect}

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2" data-position-z-index>
          <Label variant="muted">Z-index</Label>
          <VisualMeasurementControl
            glyph="position-relative"
            icon={<ZIndexDepthGlyph />}
            value={zIndexInput}
            onChange={changeZIndex}
            ariaLabel="Z-index"
            placeholder="auto"
            inputMode="numeric"
            step={1}
            className="h-9 rounded-[9px] bg-foreground/[0.075] hover:bg-foreground/[0.09] focus-within:border-[var(--kodety-focus)]/80 focus-within:bg-foreground/[0.1]"
            action={(
              <button
                type="button"
                aria-label="Usar Z-index automático"
                title="Usar Z-index automático"
                aria-pressed={!zIndexInput.trim()}
                className={cn(
                  'text-[8px] font-semibold tracking-[0.08em] text-white/28 transition-colors hover:text-white/70',
                  !zIndexInput.trim() && 'text-white/52',
                )}
                onPointerDown={event => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={event => {
                  event.stopPropagation();
                  changeZIndex('', true);
                }}
              >
                Auto
              </button>
            )}
            actionClassName="w-11 bg-black/10"
          />
        </div>
      </div>
    </SettingsPanel>
  );
});

export default PositionControls;
