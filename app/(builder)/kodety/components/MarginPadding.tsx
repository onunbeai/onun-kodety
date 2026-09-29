'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { composeCssLengthDraft, splitCssLengthDraft } from '@/lib/html-editor/css-length-draft';
import { cn } from '@/lib/utils';

export interface SpacingValues {
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
}

export type SpacingChanges = Partial<SpacingValues>;

interface MarginPaddingProps {
  values: SpacingValues;
  onChange: (property: keyof SpacingValues, value: string) => void;
  /**
   * Recebe alterações com modificador em uma única transação. Sem esse
   * callback, consumidores que guardam objetos aninhados podem sobrescrever
   * os primeiros lados com o snapshot antigo antes do React renderizar.
   */
  onBatchChange?: (changes: SpacingChanges) => void;
  mode?: 'all' | 'padding';
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  /**
   * Keeps authored CSS units intact while editing. The legacy builder passes
   * unitless values, so this is opt-in for the HTML editor.
   */
  nativeCss?: boolean;
}

type Side = 'top' | 'right' | 'bottom' | 'left';
type BoxType = 'margin' | 'padding';

interface DragEvent {
  delta: number;
  altKey: boolean;
  shiftKey: boolean;
}

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

type EdgeState = 'idle' | 'hover' | 'active';

const FACE_POLYGONS: Record<BoxType, Record<Side, string>> = {
  margin: {
    // The faces terminate on the exact inset used by the padding box below.
    // Keeping this geometry shared prevents the hover fill from floating away
    // from the visible stroke when the inspector changes width.
    top: '0,0 100,0 84,18 16,18',
    right: '100,0 100,100 84,82 84,18',
    bottom: '0,100 100,100 84,82 16,82',
    left: '0,0 16,18 16,82 0,100',
  },
  padding: {
    top: '0,0 100,0 60.5,34 39.5,34',
    right: '100,0 100,100 60.5,66 60.5,34',
    bottom: '0,100 100,100 60.5,66 39.5,66',
    left: '0,0 39.5,34 39.5,66 0,100',
  },
};

function SpacingGeometry({ box }: { box: BoxType }) {
  return (
    <div
      aria-hidden="true"
      data-spacing-geometry={box}
      className="pointer-events-none absolute inset-0 z-[1] size-full overflow-visible"
    >
      <span
        className={cn(
          'absolute inset-0 border',
          box === 'margin'
            ? 'rounded-[12px] border-dashed border-white/[.18]'
            : 'rounded-[10px] border-solid border-white/[.14]',
        )}
      />
      {box === 'padding' && (
        <span className="absolute left-1/2 top-1/2 aspect-square w-[21%] -translate-x-1/2 -translate-y-1/2 rounded-[8px] border border-white/[.05] bg-white/[.025]" />
      )}
    </div>
  );
}

function SpacingFace({
  box,
  side,
  edgeState,
  isDragActive,
  isSet = false,
  interactive = true,
  onHoverEnter,
  onHoverLeave,
}: {
  box: BoxType;
  side: Side;
  edgeState: EdgeState;
  isDragActive: boolean;
  isSet?: boolean;
  interactive?: boolean;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
}) {
  const fill = edgeState === 'idle'
    ? isSet ? 'rgb(255 255 255 / 0.012)' : 'transparent'
    : edgeState === 'hover'
      ? isDragActive ? 'rgb(147 147 255 / 0.12)' : 'rgb(255 255 255 / 0.045)'
      : 'rgb(147 147 255 / 0.07)';

  return (
    <svg
      aria-hidden="true"
      data-spacing-face={`${box}-${side}`}
      className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <polygon
        data-spacing-face-shape={side}
        points={FACE_POLYGONS[box][side]}
        fill={fill}
        className="transition-[fill] duration-150"
        style={{ pointerEvents: interactive ? 'all' : 'none' }}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
      />
    </svg>
  );
}

const SPACING_INPUT_CLASS = [
  // Keep the focused editor inside narrow margin/padding bands instead of
  // covering the adjacent drag edge on compact inspector widths.
  '!h-6 !w-[40px] !min-w-0 !rounded-[7px]',
  '!border-transparent !bg-transparent px-0',
  '!cursor-ew-resize focus-visible:!cursor-text',
  'text-center text-[11px] font-medium tabular-nums text-foreground/75 !shadow-none',
  'transition-[border-color,background-color,color,box-shadow] duration-150',
  'hover:text-foreground focus-visible:text-foreground focus-visible:!ring-1 focus-visible:!outline-none',
].join(' ');

const SPACING_INPUT_TONE_CLASS: Record<BoxType, string> = {
  margin: [
    'selection:bg-[#9393ff]/30',
    'hover:!border-white/10 hover:!bg-white/[.035]',
    'focus-visible:!border-[var(--kodety-focus)]/65 focus-visible:!bg-[var(--kodety-accent-muted)]',
    'focus-visible:!ring-[var(--kodety-focus)]/15',
  ].join(' '),
  padding: [
    'selection:bg-[#9393ff]/30',
    'hover:!border-white/10 hover:!bg-white/[.035]',
    'focus-visible:!border-[var(--kodety-focus)]/65 focus-visible:!bg-[var(--kodety-accent-muted)]',
    'focus-visible:!ring-[var(--kodety-focus)]/15',
  ].join(' '),
};

function SpacingValueDragger({
  box,
  side,
  children,
  className,
  onDrag,
  onHoverEnter,
  onHoverLeave,
  onDragStart,
  onDragEnd,
}: {
  box: BoxType;
  side: Side;
  children: React.ReactNode;
  className: string;
  onDrag: (e: DragEvent) => void;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointerPendingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const originRef = useRef({ x: 0, y: 0 });
  const lastPosRef = useRef({ x: 0, y: 0 });
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!pointerPendingRef.current) return;

      if (!isDraggingRef.current) {
        const distance = Math.hypot(
          e.clientX - originRef.current.x,
          e.clientY - originRef.current.y,
        );
        if (distance < 3) return;
        isDraggingRef.current = true;
        setIsDragging(true);
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && rootRef.current?.contains(activeElement)) {
          activeElement.blur();
        }
        onDragStartRef.current();
      }

      const deltaX = e.clientX - lastPosRef.current.x;
      const deltaY = e.clientY - lastPosRef.current.y;
      // Numeric scrubbing works in every direction: right/up increase and
      // left/down decrease. The dominant axis avoids diagonal double steps.
      const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : -deltaY;

      if (Math.abs(delta) >= 1) {
        lastPosRef.current = { x: e.clientX, y: e.clientY };
        onDragRef.current({ delta, altKey: e.altKey, shiftKey: e.shiftKey });
      }

      e.preventDefault();
    };

    const onUp = () => {
      if (!pointerPendingRef.current) return;
      pointerPendingRef.current = false;

      if (!isDraggingRef.current) {
        const input = rootRef.current?.querySelector('input');
        input?.focus();
        input?.select();
        return;
      }

      isDraggingRef.current = false;
      setIsDragging(false);
      onDragEndRef.current();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pointerPendingRef.current = true;
    isDraggingRef.current = false;
    originRef.current = { x: e.clientX, y: e.clientY };
    lastPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  return (
    <>
      <svg
        aria-hidden="true"
        data-spacing-face-activation={`${box}-${side}`}
        className={cn(
          'pointer-events-none absolute inset-0 z-10 size-full overflow-visible',
          isDragging && 'cursor-ew-resize',
        )}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polygon
          points={FACE_POLYGONS[box][side]}
          fill="transparent"
          className="pointer-events-auto cursor-ew-resize"
          onMouseDown={handleMouseDown}
          onMouseEnter={onHoverEnter}
          onMouseLeave={onHoverLeave}
          onContextMenu={event => event.preventDefault()}
        />
      </svg>
      <div
        ref={rootRef}
        data-spacing-value-dragger={side}
        className={cn(
          'absolute z-20 rounded-[7px]',
          isDragging && 'cursor-ew-resize [&_input]:!cursor-ew-resize',
          className,
        )}
        onMouseDown={handleMouseDown}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </div>

      {isDragging && createPortal(
        <div
          className="fixed inset-0 z-[9000] cursor-ew-resize"
        />,
        document.body,
      )}
    </>
  );
}

interface SpacingInputProps {
  box: BoxType;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  nativeCss?: boolean;
  label: string;
  min?: number;
}

function LegacySpacingInput({
  box,
  value,
  onChange,
  onFocus,
  onBlur,
  label,
}: SpacingInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={handleChange}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={label}
      placeholder="0"
      data-spacing-input
      className={cn(
        SPACING_INPUT_CLASS,
        SPACING_INPUT_TONE_CLASS[box],
        hasMeaningfulSpacing(value) && 'text-foreground/90',
      )}
    />
  );
}

function isExplicitCssLength(value: string): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[a-z]+|%)$/i.test(value.trim());
}

function isAdvancedCssLength(value: string): boolean {
  return /^(?:calc|min|max|clamp|var|env)\(/i.test(value.trim());
}

function hasMeaningfulSpacing(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !/^-?(?:0+(?:\.0+)?|\.0+)(?:[a-z]+|%)?$/.test(normalized);
}

function formatCssLength(value: string, unit: string): string {
  const composed = composeCssLengthDraft(value, unit);
  if (composed === null) return value;

  // The original box-model control shows pixel values without a noisy suffix.
  // Relative units stay visible whenever the field is not being edited.
  if (
    unit.toLowerCase() === 'px'
    && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
  ) {
    return value;
  }

  return composed;
}

function NativeCssSpacingInput({
  box,
  value,
  onChange,
  onFocus,
  onBlur,
  label,
  min,
}: SpacingInputProps) {
  const external = splitCssLengthDraft(value, { defaultUnit: 'px', emptyValue: '0' });
  const [draft, setDraft] = useState(external.value);
  const [unit, setUnit] = useState(external.unit);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);
  const externalRef = useRef(external);
  externalRef.current = external;

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(external.value);
    setUnit(external.unit);
  }, [external.unit, external.value]);

  const commitDraft = useCallback((nextDraft: string, nextUnit: string) => {
    const cssValue = composeCssLengthDraft(nextDraft, nextUnit);
    if (cssValue === null) return;

    if (min !== undefined) {
      const parsed = Number.parseFloat(nextDraft);
      if (Number.isFinite(parsed) && parsed < min) return;
    }

    onChange(cssValue);
  }, [min, onChange]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const typed = event.target.value;
    const typedParts = splitCssLengthDraft(typed, {
      defaultUnit: unit || 'px',
      emptyValue: '',
    });

    if (isExplicitCssLength(typed) || isAdvancedCssLength(typed)) {
      setDraft(typedParts.value);
      setUnit(typedParts.unit);
      commitDraft(typedParts.value, typedParts.unit);
      return;
    }

    setDraft(typed);
    commitDraft(typed, unit || 'px');
  }, [commitDraft, unit]);

  const stepDraft = useCallback((direction: 1 | -1, accelerated: boolean) => {
    const parsed = Number.parseFloat(draft);
    const current = Number.isFinite(parsed) ? parsed : 0;
    const step = accelerated ? 10 : 1;
    const next = min === undefined
      ? current + direction * step
      : Math.max(min, current + direction * step);
    const nextDraft = String(next);
    const nextUnit = unit || 'px';
    setDraft(nextDraft);
    setUnit(nextUnit);
    commitDraft(nextDraft, nextUnit);
  }, [commitDraft, draft, min, unit]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
    setIsFocused(true);
    onFocus?.();

    // After swapping the formatted display (`80%`) for its numeric draft
    // (`80`), select only that draft so replacement typing is predictable.
    requestAnimationFrame(() => inputRef.current?.select());
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    setIsFocused(false);

    const valid = composeCssLengthDraft(draft, unit || 'px');
    const parsed = Number.parseFloat(draft);
    const isBelowMinimum = min !== undefined
      && Number.isFinite(parsed)
      && parsed < min;
    if (valid === null || isBelowMinimum) {
      setDraft(externalRef.current.value);
      setUnit(externalRef.current.unit);
    } else if (!draft.trim()) {
      setDraft('0');
      setUnit(unit || 'px');
      onChange('');
    } else {
      // Re-assert the final local value after every keystroke. This makes the
      // inspector the last writer even if a delayed canvas/computed-style
      // refresh arrived while the input was focused.
      onChange(valid);
    }

    onBlur?.();
  }, [draft, min, onBlur, onChange, unit]);

  return (
    <Input
      ref={inputRef}
      value={isFocused ? draft : formatCssLength(draft, unit)}
      inputMode="decimal"
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          stepDraft(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
        } else if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(externalRef.current.value);
          setUnit(externalRef.current.unit);
          requestAnimationFrame(() => inputRef.current?.blur());
        }
      }}
      aria-label={label}
      placeholder="0"
      data-spacing-input
      className={cn(
        SPACING_INPUT_CLASS,
        SPACING_INPUT_TONE_CLASS[box],
        hasMeaningfulSpacing(value) && 'text-foreground/90',
      )}
    />
  );
}

function SpacingInput(props: SpacingInputProps) {
  return props.nativeCss
    ? <NativeCssSpacingInput {...props} />
    : <LegacySpacingInput {...props} />;
}

type SpacingProperty = keyof SpacingValues;

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const MARGIN_MAP: Record<Side, SpacingProperty> = {
  top: 'marginTop',
  right: 'marginRight',
  bottom: 'marginBottom',
  left: 'marginLeft',
};

const PADDING_MAP: Record<Side, SpacingProperty> = {
  top: 'paddingTop',
  right: 'paddingRight',
  bottom: 'paddingBottom',
  left: 'paddingLeft',
};

function applyDelta(
  current: string,
  delta: number,
  nativeCss: boolean,
  min?: number,
): string {
  if (nativeCss) {
    const currentDraft = splitCssLengthDraft(current, {
      defaultUnit: 'px',
      emptyValue: '0',
    });
    const numValue = Number.parseFloat(currentDraft.value);
    if (!Number.isFinite(numValue)) return current;
    const nextValue = min === undefined
      ? numValue + delta
      : Math.max(min, numValue + delta);
    return composeCssLengthDraft(
      String(nextValue),
      currentDraft.unit || 'px',
    ) ?? current;
  }

  const numValue = parseFloat(current) || 0;
  return String(numValue + delta);
}

type EdgeKey = `${BoxType}-${Side}`;

function edgeKey(box: BoxType, side: Side): EdgeKey {
  return `${box}-${side}`;
}

function useModifierKeys() {
  const [modifiers, setModifiers] = useState({ altKey: false, shiftKey: false });

  useEffect(() => {
    const update = (e: KeyboardEvent) => {
      setModifiers({ altKey: e.altKey, shiftKey: e.shiftKey });
    };
    const reset = () => {
      setModifiers({ altKey: false, shiftKey: false });
    };

    document.addEventListener('keydown', update);
    document.addEventListener('keyup', update);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('keydown', update);
      document.removeEventListener('keyup', update);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return modifiers;
}

export default function MarginPadding({
  values,
  onChange,
  onBatchChange,
  mode = 'all',
  onInteractionStart,
  onInteractionEnd,
  nativeCss = false,
}: MarginPaddingProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBatchChangeRef = useRef(onBatchChange);
  onBatchChangeRef.current = onBatchChange;

  const accumulators = useRef<Record<string, number>>({});

  const [hoveredEdge, setHoveredEdge] = useState<{ box: BoxType; side: Side } | null>(null);
  const [draggingEdge, setDraggingEdge] = useState<{ box: BoxType; side: Side } | null>(null);
  const [dragModifiers, setDragModifiers] = useState({ altKey: false, shiftKey: false });
  const { altKey, shiftKey } = useModifierKeys();

  const activeEdge = draggingEdge || hoveredEdge;
  const activeAlt = draggingEdge ? dragModifiers.altKey : altKey;
  const activeShift = draggingEdge ? dragModifiers.shiftKey : shiftKey;

  const highlightedEdges = new Set<EdgeKey>();
  if (activeEdge) {
    const { box, side } = activeEdge;
    highlightedEdges.add(edgeKey(box, side));
    if (activeShift) {
      for (const s of SIDES) highlightedEdges.add(edgeKey(box, s));
    } else if (activeAlt) {
      highlightedEdges.add(edgeKey(box, OPPOSITE[side]));
    }
  }

  const getEdgeState = (box: BoxType, side: Side): EdgeState => {
    if (!activeEdge) return 'idle';
    if (activeEdge.box === box && activeEdge.side === side) return 'hover';
    if (highlightedEdges.has(edgeKey(box, side))) return 'active';
    return 'idle';
  };

  const makeDragHandler = useCallback((side: Side, propMap: Record<Side, SpacingProperty>) => {
    return (e: DragEvent) => {
      setDragModifiers({ altKey: e.altKey, shiftKey: e.shiftKey });

      const primary = propMap[side];

      const siblings: SpacingProperty[] = [];
      if (e.shiftKey) {
        for (const s of SIDES) {
          const p = propMap[s];
          if (p !== primary) siblings.push(p);
        }
      } else if (e.altKey) {
        siblings.push(propMap[OPPOSITE[side]]);
      }

      const key = primary;
      if (!accumulators.current[key]) accumulators.current[key] = 0;
      accumulators.current[key] += e.delta;

      const stepped = Math.trunc(accumulators.current[key]);
      if (stepped !== 0) {
        accumulators.current[key] -= stepped;

        // Cada lado é incrementado a partir do próprio valor. Copiar o valor
        // do lado primário faria os demais saltarem para ele no primeiro pixel
        // do arraste e ainda descartaria a unidade que cada um tinha.
        const changes: SpacingChanges = {};
        for (const prop of [primary, ...siblings]) {
          changes[prop] = applyDelta(
            valuesRef.current[prop],
            stepped,
            nativeCss,
            prop.startsWith('padding') ? 0 : undefined,
          );
        }

        // O próximo mousemove pode chegar antes do React devolver as novas
        // props. Atualizar o snapshot local evita perder passos rápidos do
        // arraste ou recalcular todos os lados a partir do valor anterior.
        valuesRef.current = { ...valuesRef.current, ...changes };

        if (onBatchChangeRef.current) {
          onBatchChangeRef.current(changes);
        } else {
          for (const [prop, value] of Object.entries(changes)) {
            onChangeRef.current(prop as SpacingProperty, value);
          }
        }
      }
    };
  }, [nativeCss]);

  const dragMT = useCallback((e: DragEvent) => makeDragHandler('top', MARGIN_MAP)(e), [makeDragHandler]);
  const dragMR = useCallback((e: DragEvent) => makeDragHandler('right', MARGIN_MAP)(e), [makeDragHandler]);
  const dragMB = useCallback((e: DragEvent) => makeDragHandler('bottom', MARGIN_MAP)(e), [makeDragHandler]);
  const dragML = useCallback((e: DragEvent) => makeDragHandler('left', MARGIN_MAP)(e), [makeDragHandler]);
  const dragPT = useCallback((e: DragEvent) => makeDragHandler('top', PADDING_MAP)(e), [makeDragHandler]);
  const dragPR = useCallback((e: DragEvent) => makeDragHandler('right', PADDING_MAP)(e), [makeDragHandler]);
  const dragPB = useCallback((e: DragEvent) => makeDragHandler('bottom', PADDING_MAP)(e), [makeDragHandler]);
  const dragPL = useCallback((e: DragEvent) => makeDragHandler('left', PADDING_MAP)(e), [makeDragHandler]);

  const handleMT = useCallback((v: string) => onChange('marginTop', v), [onChange]);
  const handleMR = useCallback((v: string) => onChange('marginRight', v), [onChange]);
  const handleMB = useCallback((v: string) => onChange('marginBottom', v), [onChange]);
  const handleML = useCallback((v: string) => onChange('marginLeft', v), [onChange]);
  const handlePT = useCallback((v: string) => onChange('paddingTop', v), [onChange]);
  const handlePR = useCallback((v: string) => onChange('paddingRight', v), [onChange]);
  const handlePB = useCallback((v: string) => onChange('paddingBottom', v), [onChange]);
  const handlePL = useCallback((v: string) => onChange('paddingLeft', v), [onChange]);

  const hoverIn = useCallback((box: BoxType, side: Side) => () => setHoveredEdge({ box, side }), []);
  const hoverOut = useCallback(() => setHoveredEdge(null), []);
  const dragStart = useCallback((box: BoxType, side: Side) => () => {
    setDraggingEdge({ box, side });
    onInteractionStart?.();
  }, [onInteractionStart]);
  const dragEnd = useCallback(() => {
    setDraggingEdge(null);
    setDragModifiers({ altKey: false, shiftKey: false });
    onInteractionEnd?.();
  }, [onInteractionEnd]);
  const isDragActive = !!draggingEdge;

  return (
    <div className="flex min-w-0 flex-col items-center py-1">
      <div
        data-spacing-control
        className="relative mx-auto aspect-[10/7] w-full max-w-[320px] overflow-hidden rounded-[12px] bg-transparent"
        role="group"
        aria-label="Margin and padding"
      >
        {/* O fill pertence à face; a geometria compartilhada desenha cada stroke uma vez. */}
        {SIDES.map(side => (
          <SpacingFace
            key={`margin-face-${side}`}
            box="margin"
            side={side}
            edgeState={mode === 'all' ? getEdgeState('margin', side) : 'idle'}
            isDragActive={isDragActive}
            isSet={hasMeaningfulSpacing(values[MARGIN_MAP[side]])}
            interactive={mode === 'all'}
            onHoverEnter={mode === 'all' ? hoverIn('margin', side) : undefined}
            onHoverLeave={mode === 'all' ? hoverOut : undefined}
          />
        ))}
        <div className={cn('absolute inset-0', mode === 'padding' && 'opacity-35')}>
        <SpacingGeometry box="margin" />
        <span className="pointer-events-none absolute bottom-2 right-2.5 z-[3] select-none text-[8px] font-medium uppercase leading-none tracking-[0.08em] text-white/28">
          Margin
        </span>
        </div>

        {mode === 'all' && <>
          <SpacingValueDragger box="margin" side="top" className="left-1/2 top-[9%] -translate-x-1/2 -translate-y-1/2" onDrag={dragMT} onHoverEnter={hoverIn('margin', 'top')} onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'top')} onDragEnd={dragEnd}><SpacingInput box="margin" value={values.marginTop} onChange={handleMT} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Margem superior" /></SpacingValueDragger>
          <SpacingValueDragger box="margin" side="right" className="right-[8%] top-1/2 translate-x-1/2 -translate-y-1/2" onDrag={dragMR} onHoverEnter={hoverIn('margin', 'right')} onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'right')} onDragEnd={dragEnd}><SpacingInput box="margin" value={values.marginRight} onChange={handleMR} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Margem direita" /></SpacingValueDragger>
          <SpacingValueDragger box="margin" side="bottom" className="bottom-[9%] left-1/2 -translate-x-1/2 translate-y-1/2" onDrag={dragMB} onHoverEnter={hoverIn('margin', 'bottom')} onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'bottom')} onDragEnd={dragEnd}><SpacingInput box="margin" value={values.marginBottom} onChange={handleMB} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Margem inferior" /></SpacingValueDragger>
          <SpacingValueDragger box="margin" side="left" className="left-[8%] top-1/2 -translate-x-1/2 -translate-y-1/2" onDrag={dragML} onHoverEnter={hoverIn('margin', 'left')} onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'left')} onDragEnd={dragEnd}><SpacingInput box="margin" value={values.marginLeft} onChange={handleML} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Margem esquerda" /></SpacingValueDragger>
        </>}

        {/* Área interna de padding, embutida na margem. */}
        <div className="absolute inset-x-[16%] inset-y-[18%] z-10 overflow-hidden rounded-[10px] bg-black/[.06]">
          {SIDES.map(side => (
            <SpacingFace
              key={`padding-face-${side}`}
              box="padding"
              side={side}
              edgeState={getEdgeState('padding', side)}
              isDragActive={isDragActive}
              isSet={hasMeaningfulSpacing(values[PADDING_MAP[side]])}
              onHoverEnter={hoverIn('padding', side)}
              onHoverLeave={hoverOut}
            />
          ))}
          <SpacingGeometry box="padding" />

          <span className="pointer-events-none absolute bottom-2 right-2 z-[3] select-none text-[8px] font-medium uppercase leading-none tracking-[0.08em] text-white/34">
            Padding
          </span>
          <SpacingValueDragger box="padding" side="top" className="left-1/2 top-[17%] -translate-x-1/2 -translate-y-1/2" onDrag={dragPT} onHoverEnter={hoverIn('padding', 'top')} onHoverLeave={hoverOut} onDragStart={dragStart('padding', 'top')} onDragEnd={dragEnd}>
            <SpacingInput box="padding" value={values.paddingTop} onChange={handlePT} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Padding superior" min={0} />
          </SpacingValueDragger>
          <SpacingValueDragger box="padding" side="right" className="right-[19.75%] top-1/2 translate-x-1/2 -translate-y-1/2" onDrag={dragPR} onHoverEnter={hoverIn('padding', 'right')} onHoverLeave={hoverOut} onDragStart={dragStart('padding', 'right')} onDragEnd={dragEnd}>
            <SpacingInput box="padding" value={values.paddingRight} onChange={handlePR} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Padding direito" min={0} />
          </SpacingValueDragger>
          <SpacingValueDragger box="padding" side="bottom" className="bottom-[17%] left-1/2 -translate-x-1/2 translate-y-1/2" onDrag={dragPB} onHoverEnter={hoverIn('padding', 'bottom')} onHoverLeave={hoverOut} onDragStart={dragStart('padding', 'bottom')} onDragEnd={dragEnd}>
            <SpacingInput box="padding" value={values.paddingBottom} onChange={handlePB} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Padding inferior" min={0} />
          </SpacingValueDragger>
          <SpacingValueDragger box="padding" side="left" className="left-[19.75%] top-1/2 -translate-x-1/2 -translate-y-1/2" onDrag={dragPL} onHoverEnter={hoverIn('padding', 'left')} onHoverLeave={hoverOut} onDragStart={dragStart('padding', 'left')} onDragEnd={dragEnd}>
            <SpacingInput box="padding" value={values.paddingLeft} onChange={handlePL} onFocus={onInteractionStart} onBlur={onInteractionEnd} nativeCss={nativeCss} label="Padding esquerdo" min={0} />
          </SpacingValueDragger>
        </div>
      </div>
    </div>
  );
}
