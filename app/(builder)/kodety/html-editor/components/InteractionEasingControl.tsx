'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, ChevronDown, Search, X } from '@/components/ui/gravity-icons';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type EditorTab = 'presets' | 'bezier' | 'spring';
type BezierPoints = [number, number, number, number];
type BezierDrafts = [string, string, string, string];
type SpringValues = [number, number, number];

interface InteractionEasingControlProps {
  value: string;
  duration: number;
  onValueChange: (value: string) => void;
  className?: string;
}

interface EaseGroup {
  label: string;
  values: string[];
}

const EASE_GROUPS: EaseGroup[] = [
  { label: 'Linear', values: ['none'] },
  { label: 'Entrada', values: ['power1.in', 'power2.in', 'power3.in', 'power4.in', 'expo.in', 'sine.in'] },
  { label: 'Saída', values: ['power1.out', 'power2.out', 'power3.out', 'power4.out', 'expo.out', 'sine.out'] },
  { label: 'Entrada e saída', values: ['power1.inOut', 'power2.inOut', 'power3.inOut', 'power4.inOut', 'expo.inOut', 'sine.inOut'] },
  { label: 'Expressivas', values: ['back.out(1.7)', 'bounce.out', 'elastic.out(1,0.3)', 'circ.out'] },
];

const DEFAULT_BEZIER: BezierPoints = [0.22, 1, 0.36, 1];
const DEFAULT_SPRING: SpringValues = [320, 28, 1];
const EDITOR_TABS: ReadonlyArray<{ value: EditorTab; label: string }> = [
  { value: 'presets', label: 'Predefinições' },
  { value: 'bezier', label: 'Bézier' },
  { value: 'spring', label: 'Mola' },
];
const BEZIER_POINT_LABELS = ['X1', 'Y1', 'X2', 'Y2'] as const;
const SPRING_PRESETS: Array<{ label: string; hint: string; value: SpringValues }> = [
  { label: 'Natural', hint: 'Equilibrada', value: [220, 22, 1] },
  { label: 'Suave', hint: 'Pouco rebote', value: [170, 26, 1] },
  { label: 'Rápida', hint: 'Resposta curta', value: [380, 30, 0.8] },
  { label: 'Elástica', hint: 'Mais energia', value: [260, 14, 0.9] },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const compactNumber = (value: number, precision = 3) => Number(value.toFixed(precision));
const bezierDrafts = (points: BezierPoints): BezierDrafts => points.map(value => String(compactNumber(value))) as BezierDrafts;
const springMatches = (left: SpringValues, right: SpringValues) => left.every((value, index) => Math.abs(value - right[index]) < 0.001);

function parseBezier(value: string): BezierPoints | null {
  const match = value.trim().match(/^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/i);
  if (!match) return null;
  const points = match.slice(1).map(Number) as BezierPoints;
  if (!points.every(Number.isFinite)) return null;
  return [clamp(points[0], 0, 1), clamp(points[1], -0.25, 1.25), clamp(points[2], 0, 1), clamp(points[3], -0.25, 1.25)];
}

function formatBezier(points: BezierPoints) {
  return `cubic-bezier(${points.map(value => compactNumber(value)).join(',')})`;
}

function parseSpring(value: string): SpringValues | null {
  const match = value.trim().match(/^spring\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/i);
  if (!match) return null;
  const values = match.slice(1).map(Number) as SpringValues;
  if (!values.every(Number.isFinite)) return null;
  return [clamp(values[0], 20, 500), clamp(values[1], 1, 60), clamp(values[2], 0.1, 3)];
}

function formatSpring(values: SpringValues) {
  return `spring(${compactNumber(values[0], 2)},${compactNumber(values[1], 2)},${compactNumber(values[2], 2)})`;
}

function bounceOut(progress: number) {
  const n = 7.5625;
  const d = 2.75;
  if (progress < 1 / d) return n * progress * progress;
  if (progress < 2 / d) {
    const value = progress - 1.5 / d;
    return n * value * value + 0.75;
  }
  if (progress < 2.5 / d) {
    const value = progress - 2.25 / d;
    return n * value * value + 0.9375;
  }
  const value = progress - 2.625 / d;
  return n * value * value + 0.984375;
}

function springProgress(progress: number, values: SpringValues, duration: number) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const [stiffness, damping, mass] = values;
  const time = progress * Math.max(0.001, duration || 0.5);
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(Math.max(0.0001, 1 - zeta * zeta));
    return 1 - Math.exp(-zeta * omega0 * time) * (
      Math.cos(omegaD * time) + (zeta * omega0 / omegaD) * Math.sin(omegaD * time)
    );
  }
  if (Math.abs(zeta - 1) < 0.001) {
    return 1 - Math.exp(-omega0 * time) * (1 + omega0 * time);
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega0 * (zeta - root);
  const r2 = -omega0 * (zeta + root);
  const a = r2 / (r1 - r2);
  const b = -1 - a;
  return 1 + a * Math.exp(r1 * time) + b * Math.exp(r2 * time);
}

function cubicCoordinate(a: number, b: number, progress: number) {
  const inverse = 1 - progress;
  return 3 * inverse * inverse * progress * a + 3 * inverse * progress * progress * b + progress * progress * progress;
}

function cubicBezierProgress(points: BezierPoints, x: number) {
  let lower = 0;
  let upper = 1;
  let parameter = x;
  for (let index = 0; index < 18; index += 1) {
    parameter = (lower + upper) / 2;
    const estimate = cubicCoordinate(points[0], points[2], parameter);
    if (estimate < x) lower = parameter;
    else upper = parameter;
  }
  return cubicCoordinate(points[1], points[3], parameter);
}

function namedEaseProgress(value: string, progress: number) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const bezier = parseBezier(value);
  if (bezier) return cubicBezierProgress(bezier, progress);
  const spring = parseSpring(value);
  if (spring) return springProgress(progress, spring, 0.5);
  if (value === 'none' || value === 'linear') return progress;
  const power = value.match(/^power([1-4])\.(in|out|inOut)$/);
  if (power) {
    const exponent = Number(power[1]) + 1;
    if (power[2] === 'in') return progress ** exponent;
    if (power[2] === 'out') return 1 - (1 - progress) ** exponent;
    return progress < 0.5
      ? ((2 * progress) ** exponent) / 2
      : 1 - ((2 * (1 - progress)) ** exponent) / 2;
  }
  const family = value.match(/^(expo|sine)\.(in|out|inOut)$/);
  if (family) {
    const baseIn = (input: number) => family[1] === 'expo'
      ? (input === 0 ? 0 : 2 ** (10 * input - 10))
      : 1 - Math.cos((input * Math.PI) / 2);
    if (family[2] === 'in') return baseIn(progress);
    if (family[2] === 'out') return 1 - baseIn(1 - progress);
    return progress < 0.5 ? baseIn(progress * 2) / 2 : 1 - baseIn((1 - progress) * 2) / 2;
  }
  if (value.startsWith('circ.')) {
    const input = value.endsWith('.in') ? progress : 1 - progress;
    const result = 1 - Math.sqrt(Math.max(0, 1 - input * input));
    return value.endsWith('.in') ? result : 1 - result;
  }
  if (value.startsWith('back.out')) {
    const amount = Number(value.match(/\(([^)]+)\)/)?.[1]) || 1.7;
    const shifted = progress - 1;
    return 1 + (amount + 1) * shifted ** 3 + amount * shifted ** 2;
  }
  if (value === 'bounce.out') return bounceOut(progress);
  if (value.startsWith('elastic.out')) {
    const args = value.match(/\(([^)]+)\)/)?.[1].split(',').map(Number) || [1, 0.3];
    const amplitude = Math.max(1, args[0] || 1);
    const period = Math.max(0.1, args[1] || 0.3);
    const phase = period / (2 * Math.PI) * Math.asin(1 / amplitude);
    return amplitude * 2 ** (-10 * progress) * Math.sin((progress - phase) * (2 * Math.PI) / period) + 1;
  }
  return 1 - (1 - progress) ** 2;
}

function currentTab(value: string): EditorTab {
  if (parseBezier(value)) return 'bezier';
  if (parseSpring(value)) return 'spring';
  return 'presets';
}

function displayEase(value: string) {
  if (parseBezier(value)) return 'Bézier personalizado';
  if (parseSpring(value)) return 'Mola personalizada';
  if (value === 'none') return 'Linear';
  return value || 'power1.out';
}

function graphPath(value: string, duration: number, width = 300, height = 160) {
  const left = 18;
  const right = width - 18;
  const compact = height <= 128;
  const bottom = height - (compact ? 18 : 24);
  const top = compact ? 18 : 28;
  const vertical = bottom - top;
  const spring = parseSpring(value);
  const points = Array.from({ length: 49 }, (_, index) => {
    const progress = index / 48;
    const result = spring
      ? springProgress(progress, spring, duration)
      : namedEaseProgress(value, progress);
    return [left + progress * (right - left), bottom - result * vertical];
  });
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${compactNumber(x, 2)},${compactNumber(y, 2)}`).join(' ');
}

function CurveGraph({ value, duration, className }: { value: string; duration: number; className?: string }) {
  return (
    <svg viewBox="0 0 300 120" role="img" aria-label={`Prévia da curva ${displayEase(value)}`} className={cn('h-24 w-full', className)}>
      <line x1="18" y1="102" x2="282" y2="102" className="stroke-white/[.08]" />
      <line x1="18" y1="18" x2="282" y2="18" className="stroke-white/[.055]" strokeDasharray="3 6" />
      <path d={graphPath(value, duration, 300, 120)} fill="none" className="stroke-white/70" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="102" r="3" className="fill-[var(--kodety-accent-hover)]" />
      <circle cx="282" cy="18" r="3" className="fill-[var(--kodety-accent-hover)]" />
    </svg>
  );
}

function MiniCurve({ value, duration = 0.5 }: { value: string; duration?: number }) {
  return (
    <svg viewBox="0 0 300 160" aria-hidden="true" className="size-4 shrink-0 overflow-visible">
      <path d={graphPath(value, duration)} fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" />
    </svg>
  );
}

function BezierGraph({
  points,
  onPointsChange,
  onCommit,
}: {
  points: BezierPoints;
  onPointsChange: (points: BezierPoints) => void;
  onCommit: (points: BezierPoints) => void;
}) {
  const graphRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<0 | 1 | null>(null);
  const dragStartRef = useRef<BezierPoints | null>(null);
  const left = 18;
  const right = 282;
  const bottom = 110;
  const vertical = 92;
  const controlOne = [left + points[0] * (right - left), bottom - points[1] * vertical];
  const controlTwo = [left + points[2] * (right - left), bottom - points[3] * vertical];

  const pointsFromEvent = (event: ReactPointerEvent<SVGSVGElement>, handle: 0 | 1) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewX = (event.clientX - rect.left) / Math.max(1, rect.width) * 300;
    const viewY = (event.clientY - rect.top) / Math.max(1, rect.height) * 128;
    const x = clamp((viewX - left) / (right - left), 0, 1);
    const y = clamp((bottom - viewY) / vertical, -0.25, 1.25);
    const next = [...points] as BezierPoints;
    next[handle * 2] = compactNumber(x);
    next[handle * 2 + 1] = compactNumber(y);
    return next;
  };

  const start = (handle: 0 | 1, event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = handle;
    dragStartRef.current = [...points] as BezierPoints;
    graphRef.current?.setPointerCapture(event.pointerId);
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current === null) return;
    onPointsChange(pointsFromEvent(event, dragRef.current));
  };

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current === null) return;
    const next = pointsFromEvent(event, dragRef.current);
    dragRef.current = null;
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onPointsChange(next);
    onCommit(next);
  };

  const cancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragStartRef.current) onPointsChange(dragStartRef.current);
    dragStartRef.current = null;
  };

  return (
    <svg
      ref={graphRef}
      viewBox="0 0 300 128"
      role="group"
      aria-label="Editor visual da curva Bézier"
      className="h-28 w-full touch-none select-none"
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
    >
      <line x1="18" y1="110" x2="282" y2="110" className="stroke-white/[.08]" />
      <line x1="18" y1="18" x2="282" y2="18" className="stroke-white/[.055]" strokeDasharray="3 6" />
      <line x1="18" y1="110" x2={controlOne[0]} y2={controlOne[1]} className="stroke-[var(--kodety-accent-hover)]/55" strokeWidth="1.5" />
      <line x1="282" y1="18" x2={controlTwo[0]} y2={controlTwo[1]} className="stroke-[var(--kodety-accent-hover)]/55" strokeWidth="1.5" />
      <path d={graphPath(formatBezier(points), 0.5, 300, 128)} fill="none" className="stroke-white/75" strokeWidth="3" strokeLinecap="round" />
      <circle cx="18" cy="110" r="3" className="fill-white/55" />
      <circle cx="282" cy="18" r="3" className="fill-white/55" />
      <circle cx={controlOne[0]} cy={controlOne[1]} r="7" className="cursor-grab fill-[var(--kodety-accent-hover)] stroke-[var(--kodety-panel-raised)] active:cursor-grabbing" strokeWidth="3" onPointerDown={event => start(0, event)} />
      <circle cx={controlTwo[0]} cy={controlTwo[1]} r="7" className="cursor-grab fill-[var(--kodety-accent-hover)] stroke-[var(--kodety-panel-raised)] active:cursor-grabbing" strokeWidth="3" onPointerDown={event => start(1, event)} />
    </svg>
  );
}

export default function InteractionEasingControl({
  value,
  duration,
  onValueChange,
  className,
}: InteractionEasingControlProps) {
  const normalizedValue = value || 'power1.out';
  const editorId = useId();
  const parsedBezier = useMemo(() => parseBezier(normalizedValue), [normalizedValue]);
  const parsedSpring = useMemo(() => parseSpring(normalizedValue), [normalizedValue]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<EditorTab>(() => currentTab(normalizedValue));
  const [search, setSearch] = useState('');
  const [bezier, setBezier] = useState<BezierPoints>(parsedBezier || DEFAULT_BEZIER);
  const [pointDrafts, setPointDrafts] = useState<BezierDrafts>(() => bezierDrafts(parsedBezier || DEFAULT_BEZIER));
  const [spring, setSpring] = useState<SpringValues>(parsedSpring || DEFAULT_SPRING);
  const skipBezierBlurCommitRef = useRef<number | null>(null);
  const tabRefs = useRef<Record<EditorTab, HTMLButtonElement | null>>({
    presets: null,
    bezier: null,
    spring: null,
  });

  useEffect(() => {
    if (parsedBezier) {
      setBezier(parsedBezier);
      setPointDrafts(bezierDrafts(parsedBezier));
    } else {
      setBezier(DEFAULT_BEZIER);
      setPointDrafts(bezierDrafts(DEFAULT_BEZIER));
    }
    setSpring(parsedSpring || DEFAULT_SPRING);
  }, [parsedBezier, parsedSpring]);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return EASE_GROUPS;
    return EASE_GROUPS.map(group => ({
      ...group,
      values: group.values.filter(option => `${option} ${group.label}`.toLowerCase().includes(query)),
    })).filter(group => group.values.length);
  }, [search]);

  const updateBezierDraft = (index: 0 | 1 | 2 | 3, value: string) => {
    const normalized = value.replace(',', '.').replace(/\s/g, '');
    if (!/^-?(?:\d+\.?\d*|\.\d*)?$/.test(normalized)) return;
    setPointDrafts(current => {
      const next = [...current] as BezierDrafts;
      next[index] = normalized;
      return next;
    });
  };

  const commitBezierPoint = (index: 0 | 1 | 2 | 3) => {
    const parsed = Number(pointDrafts[index]);
    if (!pointDrafts[index] || !Number.isFinite(parsed)) {
      setPointDrafts(bezierDrafts(bezier));
      return;
    }
    const next = [...bezier] as BezierPoints;
    next[index] = index % 2 === 0
      ? clamp(parsed, 0, 1)
      : clamp(parsed, -0.25, 1.25);
    setBezier(next);
    setPointDrafts(bezierDrafts(next));
    onValueChange(formatBezier(next));
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % EDITOR_TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + EDITOR_TABS.length) % EDITOR_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = EDITOR_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = EDITOR_TABS[nextIndex].value;
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const selectSpring = (next: SpringValues) => {
    setSpring(next);
    onValueChange(formatSpring(next));
  };

  const changeSpring = (index: 0 | 1 | 2, nextValue: number, commit = false) => {
    const next = [...spring] as SpringValues;
    next[index] = nextValue;
    setSpring(next);
    if (commit) onValueChange(formatSpring(next));
  };

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setTab(currentTab(normalizedValue));
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Editar curva da animação"
          title={normalizedValue}
          onPointerDown={event => event.stopPropagation()}
          className={cn(
            'flex h-8 w-full min-w-0 items-center overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] px-2.5 text-left outline-none transition-[border-color,background-color] hover:bg-white/[.065] focus-visible:border-[var(--kodety-focus)]/70 data-[state=open]:border-[var(--kodety-focus)]/70 data-[state=open]:bg-white/[.065]',
            className,
          )}
        >
          <span className="mr-2 grid size-4 shrink-0 place-items-center text-[var(--kodety-accent-hover)]"><MiniCurve value={normalizedValue} duration={duration} /></span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{displayEase(normalizedValue)}</span>
          <ChevronDown className="ml-2 size-3 shrink-0 text-white/35" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        sideOffset={8}
        collisionPadding={10}
        className="flex w-[min(320px,calc(100vw-20px))] max-w-none flex-col overflow-hidden rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-0 shadow-[var(--kodety-shadow-popover)] max-h-[min(520px,var(--radix-popover-content-available-height))]"
        onPointerDown={event => event.stopPropagation()}
      >
        <header className="flex h-11 shrink-0 items-center border-b border-white/[.065] px-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-foreground">Curva da animação</p>
            <p className="mt-0.5 truncate text-[8px] text-white/38">{normalizedValue}</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="Fechar editor de curva" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-[7px] text-white/42 outline-none hover:bg-white/[.055] hover:text-white/75 focus-visible:bg-white/[.065] focus-visible:text-[var(--kodety-accent-hover)]">
                <X className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Fechar editor de curva</TooltipContent>
          </Tooltip>
        </header>

        <div role="tablist" aria-label="Modos da curva" className="mx-2.5 mt-2.5 grid h-8 shrink-0 grid-cols-3 rounded-[8px] bg-white/[.055] p-0.5">
          {EDITOR_TABS.map(({ value: key, label }, index) => (
            <button
              key={key}
              ref={node => { tabRefs.current[key] = node; }}
              id={`${editorId}-${key}-tab`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`${editorId}-${key}-panel`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={event => handleTabKeyDown(event, index)}
              className={cn(
                'rounded-[6px] text-[9px] font-medium outline-none transition-colors focus-visible:text-[var(--kodety-accent-hover)]',
                tab === key ? 'bg-white/[.13] text-white shadow-[0_1px_2px_rgba(0,0,0,.22)]' : 'text-white/42 hover:bg-white/[.04] hover:text-white/70',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto p-2.5">
          {tab === 'presets' && (
            <div
              id={`${editorId}-presets-panel`}
              role="tabpanel"
              aria-labelledby={`${editorId}-presets-tab`}
              className="space-y-2.5"
            >
              <div className="overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.035] px-2"><CurveGraph value={normalizedValue} duration={duration} /></div>
              <label className="flex h-8 min-w-0 items-center overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]">
                <span className="sr-only">Buscar predefinições de curva</span>
                <span className="grid size-8 shrink-0 place-items-center text-white/35" aria-hidden="true">
                  <Search className="size-3.5" />
                </span>
                <Input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Buscar curva…"
                  className="!h-full min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !pl-0 !pr-2 text-[10px] !shadow-none focus-visible:!border-0 focus-visible:!ring-0"
                />
              </label>
              <div className="space-y-2">
                {filteredGroups.map(group => (
                  <section key={group.label}>
                    <p className="mb-1 text-[8px] font-medium uppercase tracking-[.1em] text-white/32">{group.label}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {group.values.map(option => {
                        const selected = normalizedValue === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onValueChange(option)}
                            className={cn(
                              'flex h-8 min-w-0 items-center gap-1.5 rounded-[7px] px-2 text-left text-white/58 outline-none transition-colors hover:bg-white/[.065] hover:text-white/80 focus-visible:bg-white/[.075] focus-visible:text-white',
                              selected ? 'bg-white/[.13] text-white' : 'bg-white/[.025]',
                            )}
                          >
                            <span className={cn('shrink-0', selected ? 'text-[var(--kodety-accent-hover)]' : 'text-white/42')}><MiniCurve value={option} /></span>
                            <span className="min-w-0 flex-1 truncate text-[9px]">{option === 'none' ? 'Linear' : option}</span>
                            {selected && <Check className="size-3 shrink-0 text-[var(--kodety-accent-hover)]" />}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {!filteredGroups.length && <p className="py-5 text-center text-[9px] text-white/35">Nenhuma predefinição encontrada.</p>}
              </div>
            </div>
          )}

          {tab === 'bezier' && (
            <div
              id={`${editorId}-bezier-panel`}
              role="tabpanel"
              aria-labelledby={`${editorId}-bezier-tab`}
              className="space-y-2.5"
            >
              <div className="overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.035] px-1">
                <BezierGraph
                  points={bezier}
                  onPointsChange={next => {
                    setBezier(next);
                    setPointDrafts(bezierDrafts(next));
                  }}
                  onCommit={next => onValueChange(formatBezier(next))}
                />
              </div>
              <div>
                <p id={`${editorId}-bezier-points-label`} className="mb-1.5 text-[8px] font-medium uppercase tracking-[.1em] text-white/35">Pontos de controle</p>
                <div
                  role="group"
                  aria-labelledby={`${editorId}-bezier-points-label`}
                  className="grid h-8 grid-cols-4 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]"
                >
                  {BEZIER_POINT_LABELS.map((label, rawIndex) => {
                    const index = rawIndex as 0 | 1 | 2 | 3;
                    return (
                      <label key={label} className="flex min-w-0 items-center border-l border-white/[.055] px-1.5 first:border-l-0">
                        <span className="mr-1 shrink-0 text-[8px] font-medium text-white/32">{label}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={index % 2 === 0 ? 0 : -0.25}
                          max={index % 2 === 0 ? 1 : 1.25}
                          step="0.01"
                          value={pointDrafts[index]}
                          aria-label={`Ponto ${label} da curva Bézier`}
                          onChange={event => updateBezierDraft(index, event.target.value)}
                          onBlur={() => {
                            if (skipBezierBlurCommitRef.current === index) {
                              skipBezierBlurCommitRef.current = null;
                              return;
                            }
                            commitBezierPoint(index);
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                              skipBezierBlurCommitRef.current = index;
                              setPointDrafts(bezierDrafts(bezier));
                              event.currentTarget.blur();
                            }
                          }}
                          spellCheck={false}
                          className="h-full min-w-0 flex-1 bg-transparent text-right font-mono text-[9px] tabular-nums text-foreground outline-none"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: 'Suave', value: [0.22, 1, 0.36, 1] as BezierPoints },
                  { label: 'Natural', value: [0.4, 0, 0.2, 1] as BezierPoints },
                  { label: 'Precisa', value: [0.44, 0, 0.56, 1] as BezierPoints },
                ].map(preset => {
                  const selected = Boolean(parsedBezier?.every((point, index) => Math.abs(point - preset.value[index]) < 0.001));
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setBezier(preset.value);
                        setPointDrafts(bezierDrafts(preset.value));
                        onValueChange(formatBezier(preset.value));
                      }}
                      className={cn(
                        'flex h-8 items-center justify-center gap-1 rounded-[7px] text-[9px] text-white/55 outline-none hover:bg-white/[.065] hover:text-white/80 focus-visible:bg-white/[.075] focus-visible:text-white',
                        selected ? 'bg-white/[.13] text-white' : 'bg-white/[.035]',
                      )}
                    >
                      {preset.label}
                      {selected && <Check className="size-3 text-[var(--kodety-accent-hover)]" />}
                    </button>
                  );
                })}
              </div>
              <p className="kodety-info-copy text-[9px] leading-4">Arraste os pontos ou edite X1, Y1, X2 e Y2. A curva é salva ao confirmar.</p>
            </div>
          )}

          {tab === 'spring' && (
            <div
              id={`${editorId}-spring-panel`}
              role="tabpanel"
              aria-labelledby={`${editorId}-spring-tab`}
              className="space-y-2.5"
            >
              <div className="overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.035] px-2"><CurveGraph value={formatSpring(spring)} duration={duration} /></div>
              <div className="grid grid-cols-2 gap-1">
                {SPRING_PRESETS.map(preset => {
                  const selected = springMatches(spring, preset.value);
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectSpring(preset.value)}
                      className={cn(
                        'flex min-h-9 items-center rounded-[7px] px-2 text-left outline-none transition-colors hover:bg-white/[.065] focus-visible:bg-white/[.075]',
                        selected ? 'bg-white/[.13]' : 'bg-white/[.035]',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[9px] font-medium', selected ? 'text-white' : 'text-white/72')}>{preset.label}</span>
                        <span className="mt-0.5 block text-[8px] text-white/32">{preset.hint}</span>
                      </span>
                      {selected && <Check className="ml-1.5 size-3 shrink-0 text-[var(--kodety-accent-hover)]" />}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <Slider label="Rigidez" value={[spring[0]]} min={20} max={500} step={5} aria-label="Rigidez da mola" onValueChange={values => changeSpring(0, values[0])} onValueCommit={values => changeSpring(0, values[0], true)} />
                <Slider label="Amortecimento" value={[spring[1]]} min={1} max={60} step={1} aria-label="Amortecimento da mola" onValueChange={values => changeSpring(1, values[0])} onValueCommit={values => changeSpring(1, values[0], true)} />
                <Slider label="Massa" value={[spring[2]]} min={0.1} max={3} step={0.1} aria-label="Massa da mola" onValueChange={values => changeSpring(2, values[0])} onValueCommit={values => changeSpring(2, values[0], true)} />
              </div>
              <p className="kodety-info-copy text-[9px] leading-4">A duração definida no painel determina quanto tempo a simulação física percorre.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
