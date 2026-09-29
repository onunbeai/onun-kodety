'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Braces,
  Component,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code2,
  Crosshair,
  Diamond,
  Gauge,
  ImagePlay,
  Maximize2,
  Minus,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Variable,
  X,
  Zap,
} from '@/components/ui/gravity-icons';
import type { LucideIcon } from '@/components/ui/gravity-icons';
import { Input } from '@/components/ui/input';
import { DisclosureChevron } from '@/components/ui/disclosure-summary';
import ColorPicker from '@/app/(builder)/kodety/components/ColorPicker';
import InteractionEasingControl from './InteractionEasingControl';
import {
  VisualMeasurementControl,
  VisualSelectControl,
  type VisualStyleGlyph,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  INTERACTION_ACTION_CATALOG_FOCUS_PREFIX,
  INTERACTION_PRESETS,
  INTERACTION_PROPERTY_GROUPS,
  INTERACTION_PROPERTIES,
  actionFromPreset,
  createInteractionAction,
  cssPropertyToInteraction,
  ensureInteractionSelector,
  interactionActionTargetMatchesSelectionPath,
  interactionActionEnd,
  interactionDuration,
  interactionKeyframesForDuration,
  interactionMatchesSelection,
  interactionProjectionIsCompleteForSelectionSubtree,
  interactionTimelineForSelection,
  interactionsInSelectionSubtree,
  interactionProperty,
  patchInteractionDocument,
  readInteractionDocument,
  updateInteraction,
  type InteractionAction,
  type InteractionActionKind,
  type InteractionDefinition,
  type InteractionTargetMode,
  type InteractionTargetScope,
} from '@/lib/html-editor/interactions';
import {
  buildTimelineRulerTicks,
  clampTimelineZoom,
  fitTimelineZoom,
  TIMELINE_DEFAULT_ZOOM,
  TIMELINE_END_PADDING,
  TIMELINE_LABEL_COLUMN_WIDTH,
  timelinePreviewInteractionIds,
  timelineTickPrecision,
} from '@/lib/html-editor/motion-timeline';
import type { EditorMode, SelectionSnapshot } from '@/lib/html-editor/types';
import {
  MOTION_TIMELINE_DEFAULT_MAX_HEIGHT,
  MOTION_TIMELINE_MIN_HEIGHT,
} from '@/lib/html-editor/editor-constants';
import { useHtmlTimelineStore } from '@/stores/useHtmlTimelineStore';

interface HtmlMotionTimelineProps {
  source: string;
  selection: SelectionSnapshot | null;
  mode: EditorMode;
  workspaceReadOnly: boolean;
  isPreviewing: boolean;
  editingLocalizedPage: boolean;
  canvasGeneration?: string;
  isActiveCanvasMessage?: (event: MessageEvent) => boolean;
  onCanvasMessage: (message: Record<string, unknown>) => void;
  onSourceChange: (source: string) => void;
  onBeginTargetPick: (onPick: (selection: SelectionSnapshot) => void) => void;
  componentOptions?: Array<{
    id: string;
    name: string;
    variants: Array<{ id: string; name: string }>;
  }>;
}

const TARGET_SCOPE_OPTIONS: VisualStyleOption[] = [
  { value: 'document', label: 'Documento', description: 'Busca no documento inteiro' },
  { value: 'trigger', label: 'Gatilho', description: 'Usa o elemento que disparou a interação' },
  { value: 'children', label: 'Filhos diretos' },
  { value: 'descendants', label: 'Descendentes' },
  { value: 'parent', label: 'Elemento pai' },
  { value: 'closest', label: 'Ancestral mais próximo' },
  { value: 'siblings', label: 'Elementos irmãos' },
  { value: 'next', label: 'Próximo elemento' },
  { value: 'previous', label: 'Elemento anterior' },
];

const STAGGER_ORIGIN_OPTIONS: VisualStyleOption[] = [
  { value: 'start', label: 'Início' },
  { value: 'center', label: 'Centro' },
  { value: 'end', label: 'Fim' },
  { value: 'edges', label: 'Bordas' },
  { value: 'random', label: 'Aleatório' },
];

const TEXT_SPLIT_OPTIONS: VisualStyleOption[] = [
  { value: 'none', label: 'Nenhum' },
  { value: 'chars', label: 'Caracteres' },
  { value: 'words', label: 'Palavras' },
  { value: 'lines', label: 'Linhas' },
];

function animationPropertyGlyph(property: string): VisualStyleGlyph {
  const normalized = property.toLowerCase();
  if (normalized === 'opacity') return 'opacity';
  if (normalized.startsWith('scale')) return 'scale';
  if (normalized.includes('rotation') || normalized === 'rotate') return 'rotate';
  if (normalized === 'x' || normalized === 'xpercent' || normalized.includes('translatex')) return 'move-x';
  if (normalized === 'y' || normalized === 'ypercent' || normalized.includes('translatey')) return 'move-y';
  if (normalized.includes('skewx')) return 'skew-x';
  if (normalized.includes('skewy')) return 'skew-y';
  if (normalized.includes('width')) return normalized.startsWith('min') ? 'min-width' : normalized.startsWith('max') ? 'max-width' : 'width';
  if (normalized.includes('height')) return normalized.startsWith('min') ? 'min-height' : normalized.startsWith('max') ? 'max-height' : 'height';
  if (normalized.includes('fontsize')) return 'font-size';
  if (normalized.includes('letterspacing')) return 'letter-spacing';
  if (normalized.includes('lineheight')) return 'line-height';
  return 'value';
}

const ACTION_CATALOG: Array<{ kind: InteractionActionKind; label: string; hint: string; icon: LucideIcon }> = [
  { kind: 'animate', label: 'Animar', hint: 'Interpola propriedades ao longo do tempo', icon: Sparkles },
  { kind: 'set', label: 'Definir', hint: 'Aplica valores imediatamente', icon: Zap },
  { kind: 'variable', label: 'Variável', hint: 'Anima uma variável CSS', icon: Variable },
  { kind: 'component-variant', label: 'Variante de componente', hint: 'Troca a variante de uma instância', icon: Component },
  { kind: 'class-add', label: 'Adicionar classe', hint: 'Adiciona uma classe ao alvo', icon: Braces },
  { kind: 'class-remove', label: 'Remover classe', hint: 'Remove uma classe do alvo', icon: Braces },
  { kind: 'class-toggle', label: 'Alternar classe', hint: 'Alterna uma classe no alvo', icon: Braces },
  { kind: 'spline', label: 'Spline', hint: 'Altera uma variável do Spline', icon: CircleDot },
  { kind: 'lottie', label: 'Lottie', hint: 'Reproduz ou controla um player', icon: ImagePlay },
  { kind: 'rive', label: 'Rive', hint: 'Dispara ou define uma entrada', icon: Gauge },
  { kind: 'event', label: 'Evento', hint: 'Dispara um evento no alvo', icon: Code2 },
];

const PRESET_LABELS: Record<string, string> = {
  'fade-in': 'Aparecer gradualmente',
  'fade-out': 'Desaparecer gradualmente',
  'slide-left': 'Deslizar da esquerda',
  'slide-right': 'Deslizar para a direita',
  'slide-up': 'Deslizar de baixo',
  'slide-down': 'Deslizar para baixo',
  'scale-in': 'Aumentar ao entrar',
  'pop-in': 'Surgir',
  'drop-in': 'Cair ao entrar',
  'stagger-fade-in': 'Cascata ao aparecer',
  'stagger-fade-out': 'Cascata ao desaparecer',
  'stagger-drop-in': 'Cascata de cima',
  'stagger-fall-out': 'Cascata para baixo',
  'random-stagger': 'Cascata aleatória',
};

const TIMELINE_MIN_CANVAS_HEIGHT = 260;
const TIMELINE_ACTION_DRAG_THRESHOLD_PX = 4;

interface TimelinePropertyFocusRequest {
  actionId: string;
  property: string;
  phase: 'from' | 'to';
  keyframeId: string;
  requestId: number;
}

const timelineActionPropertyKeys = (action: InteractionAction) => Array.from(new Set([
  ...Object.keys(action.from),
  ...Object.keys(action.to),
  ...action.keyframes.flatMap(frame => Object.keys(frame.values)),
]));

const timelineActionFrames = (action: InteractionAction) => action.keyframes.length >= 2
  ? action.keyframes
  : [
      { id: `${action.id}-from`, time: 0, values: action.from },
      { id: `${action.id}-to`, time: action.duration, values: action.to },
    ];

const timelinePropertyDisplayValue = (action: InteractionAction, property: string) => {
  const lastKeyframeValue = [...action.keyframes]
    .reverse()
    .find(frame => Object.hasOwn(frame.values, property))
    ?.values[property];
  const value = action.to[property] ?? lastKeyframeValue ?? action.from[property];
  if (value === undefined || value === '') return '';
  const unit = typeof value === 'number' ? interactionProperty(property).unit || '' : '';
  return `${String(value)}${unit}`;
};
const SELECTION_TIMELINE_SCOPE = '__selection-scope__';

function LooseButton({ title, danger = false, disabled, onClick, children }: { title: string; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={title}
          disabled={disabled}
          onClick={onClick}
          className={`${danger ? 'hover:text-[var(--kodety-danger)] focus-visible:text-[var(--kodety-danger)]' : 'hover:bg-white/[.055] hover:text-white focus-visible:text-white'} inline-flex size-7 items-center justify-center rounded-[6px] text-[var(--kodety-text-tertiary)] outline-none transition-[background-color,color] focus-visible:bg-white/[.07] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-30`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}

function numeric(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTimelineZoom(value: number) {
  if (!Number.isFinite(value)) return String(TIMELINE_DEFAULT_ZOOM);
  return value < 10
    ? value.toFixed(1).replace(/\.0$/, '')
    : String(Math.round(value));
}

function decimalDraftValue(value: string, allowPercent: boolean, percentAsUnit: boolean) {
  const normalized = value.replaceAll(',', '.').trim();
  const hasPercent = allowPercent && normalized.endsWith('%');
  const numberPart = hasPercent ? normalized.slice(0, -1) : normalized;
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(numberPart)) return null;
  const parsed = Number(numberPart);
  if (!Number.isFinite(parsed)) return null;
  return hasPercent && !percentAsUnit ? `${parsed}%` : parsed;
}

function DecimalInput({
  value,
  onValueChange,
  unit,
  allowPercent = false,
  min,
  className = '',
  ariaLabel,
  glyph = 'value',
  step,
}: {
  value: string | number | undefined;
  onValueChange: (value: string | number) => void;
  unit?: string;
  allowPercent?: boolean;
  min?: number;
  className?: string;
  ariaLabel?: string;
  glyph?: VisualStyleGlyph;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const editingRef = useRef(false);
  const cancelBlurRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setDraft(String(value ?? ''));
  }, [value]);

  const commit = (nextDraft: string, final = false) => {
    let candidate = nextDraft.replaceAll(',', '.').replace(/\s/g, '');
    if (final) candidate = candidate.replace(/\.$/, '');
    const parsed = decimalDraftValue(candidate, allowPercent, unit === '%');
    if (parsed === null) {
      if (final) setDraft(String(value ?? ''));
      return;
    }
    const next = typeof parsed === 'number' && min !== undefined ? Math.max(min, parsed) : parsed;
    onValueChange(next);
    if (final) setDraft(String(next));
  };

  const visibleUnit = draft.trim().endsWith('%') && unit !== '%' ? '' : unit;
  const draftPattern = allowPercent
    ? /^-?(?:\d+\.?\d*|\.\d*)?%?$/
    : /^-?(?:\d+\.?\d*|\.\d*)?$/;

  const updateDraft = (nextValue: string) => {
    const next = nextValue.replaceAll(',', '.').replace(/\s/g, '');
    if (!draftPattern.test(next)) return;
    setDraft(next);
    commit(next);
  };

  return (
    <div
      className={`min-w-0 ${className}`}
      onFocusCapture={() => { editingRef.current = true; }}
      onBlurCapture={event => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        editingRef.current = false;
        if (cancelBlurRef.current) {
          cancelBlurRef.current = false;
          setDraft(String(value ?? ''));
          return;
        }
        commit(draft, true);
      }}
      onKeyDownCapture={event => {
        if (!(event.target instanceof HTMLInputElement)) return;
        if (event.key === 'Enter') event.currentTarget.querySelector('input')?.blur();
        if (event.key === 'Escape') {
          cancelBlurRef.current = true;
          setDraft(String(value ?? ''));
          event.currentTarget.querySelector('input')?.blur();
        }
      }}
    >
      <VisualMeasurementControl
        glyph={glyph}
        value={draft}
        onChange={updateDraft}
        min={min}
        step={step}
        ariaLabel={ariaLabel || 'Valor'}
        suffix={visibleUnit}
      />
    </div>
  );
}

function ActionPicker({ search, onSearch, onAdd, onClose }: { search: string; onSearch: (value: string) => void; onAdd: (action: InteractionAction) => void; onClose: () => void }) {
  type PresetGroup = 'All' | (typeof INTERACTION_PRESETS)[number]['group'];
  const [tab, setTab] = useState<'presets' | 'actions'>('presets');
  const [presetGroup, setPresetGroup] = useState<PresetGroup>('All');
  const query = search.trim().toLowerCase();
  const catalog = ACTION_CATALOG.filter(item => `${item.label} ${item.hint}`.toLowerCase().includes(query));
  const presets = INTERACTION_PRESETS.filter(item => (
    (presetGroup === 'All' || item.group === presetGroup)
    && `${PRESET_LABELS[item.id] || item.label} ${item.label} ${item.group} ${item.ease}`.toLowerCase().includes(query)
  ));
  const presetGroups: Array<{ value: PresetGroup; label: string }> = [
    { value: 'All', label: 'Todos' },
    { value: 'Basic', label: 'Básico' },
    { value: 'Slide', label: 'Deslize' },
    { value: 'Scale', label: 'Escala' },
    { value: 'Stagger', label: 'Cascata' },
  ];
  const resultCount = tab === 'presets' ? presets.length : catalog.length;
  return (
    <aside
      id="interaction-action-catalog"
      data-interaction-action-catalog
      aria-label="Catálogo de ações da interação"
      className="flex h-full w-[304px] shrink-0 flex-col border-l border-[var(--kodety-divider)] bg-[var(--kodety-panel)] max-[980px]:absolute max-[980px]:inset-y-0 max-[980px]:right-0 max-[980px]:z-30 max-[980px]:w-[min(304px,calc(100vw-16px))] max-[980px]:shadow-2xl"
    >
      <h3 className="sr-only">Adicionar animação</h3>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] py-1.5 pl-2.5 pr-1.5">
        <div
          data-timeline-action-search
          className="flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]"
        >
          <span className="grid h-full w-8 shrink-0 place-items-center text-[var(--kodety-text-tertiary)]">
            <Search className="size-3.5" />
          </span>
          <input
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder="Buscar predefinições e ações"
            aria-label="Buscar predefinições e ações"
            className="h-full min-w-0 flex-1 border-0 bg-transparent pr-2.5 text-[10px] text-[var(--kodety-text)] outline-none placeholder:text-[var(--kodety-text-tertiary)] focus-visible:placeholder:text-[var(--kodety-text-disabled)]"
            autoFocus
          />
        </div>
        <LooseButton title="Fechar seletor" onClick={onClose}><X className="size-4" /></LooseButton>
      </div>
      <div
        data-action-picker-navigation
        className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-3"
      >
        <div role="tablist" aria-label="Tipo de animação" className="flex h-6 min-w-0 items-center gap-0.5 rounded-[7px] bg-white/[.05] p-0.5">
          {([
            ['presets', 'Predefinições'],
            ['actions', 'Ações'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`h-full min-w-0 rounded-[5px] px-2 text-[9px] font-medium outline-none transition-[background-color,color] ${tab === value ? 'bg-white/[.12] text-[var(--kodety-text)]' : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.04] hover:text-[var(--kodety-text-secondary)]'} focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]`}
            >
              <span className="block truncate">{label}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {tab === 'presets' && (
            <Select value={presetGroup} onValueChange={value => setPresetGroup(value as PresetGroup)}>
              <SelectTrigger
                size="xs"
                aria-label="Filtrar predefinições por categoria"
                className="h-6 w-auto min-w-[72px] max-w-[88px] justify-end gap-1 border-0 bg-transparent px-1 text-[8px] text-[var(--kodety-text-tertiary)] shadow-none hover:bg-white/[.035] hover:text-[var(--kodety-text-secondary)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className="min-w-32 bg-[var(--kodety-panel-raised)]">
                {presetGroups.map(group => <SelectItem key={group.value} value={group.value}>{group.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <span className="min-w-3 text-right font-mono text-[8px] tabular-nums text-[var(--kodety-text-disabled)]">{resultCount}</span>
        </div>
      </div>
      <div className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto bg-[var(--kodety-panel)]">
        {tab === 'presets' ? (
          <section aria-label="Predefinições" className="pb-1">
            <div className="divide-y divide-[var(--kodety-divider)]">
              {presets.map(preset => {
                const label = PRESET_LABELS[preset.id] || preset.label;
                const groupLabel = presetGroups.find(group => group.value === preset.group)?.label || preset.group;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onAdd({ ...actionFromPreset(preset.id), name: label })}
                    className="group flex h-10 w-full min-w-0 items-center gap-2.5 px-3 text-left outline-none transition-colors hover:bg-white/[.035] focus-visible:bg-white/[.055]"
                  >
                    <span className="grid size-5 shrink-0 place-items-center text-[var(--kodety-text-disabled)] transition-colors group-hover:text-[var(--kodety-text-secondary)]">
                      <Plus className="size-3.5 stroke-[1.5]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] font-medium leading-3.5 text-[var(--kodety-text-secondary)] group-hover:text-[var(--kodety-text)]">{label}</span>
                      <span className="mt-0.5 block truncate text-[8px] leading-3 text-[var(--kodety-text-tertiary)]">{groupLabel} · <span className="font-mono">{preset.ease}</span></span>
                    </span>
                    <span className="shrink-0 font-mono text-[8px] tabular-nums text-[var(--kodety-text-tertiary)]">{preset.duration.toFixed(2)}s</span>
                  </button>
                );
              })}
            </div>
            {!presets.length && (
              <p className="px-3 py-8 text-center text-[9px] text-[var(--kodety-text-tertiary)]">
                Nenhuma predefinição encontrada.
              </p>
            )}
          </section>
        ) : (
          <section aria-label="Ações" className="pb-1">
            <div className="divide-y divide-[var(--kodety-divider)]">
              {catalog.map(({ kind, label, hint, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  data-create-animation-from-scratch={kind === 'animate' || undefined}
                  onClick={() => onAdd({ ...createInteractionAction(kind), name: label })}
                  className="group flex h-10 w-full min-w-0 items-center gap-2.5 px-3 text-left outline-none transition-colors hover:bg-white/[.035] focus-visible:bg-white/[.055]"
                >
                  <span className="grid size-5 shrink-0 place-items-center text-[var(--kodety-text-tertiary)] transition-colors group-hover:text-[var(--kodety-text-secondary)]">
                    <Icon className="size-3.5 stroke-[1.5]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium leading-3.5 text-[var(--kodety-text-secondary)] group-hover:text-[var(--kodety-text)]">{label}</span>
                    <span className="mt-0.5 block truncate text-[8px] leading-3 text-[var(--kodety-text-tertiary)]">{hint}</span>
                  </span>
                  <ChevronRight className="size-3 shrink-0 text-[var(--kodety-text-disabled)] transition-colors group-hover:text-[var(--kodety-text-tertiary)]" />
                </button>
              ))}
            </div>
            {!catalog.length && (
              <p className="px-3 py-8 text-center text-[9px] text-[var(--kodety-text-tertiary)]">Nenhuma ação encontrada.</p>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function PropertyValue({ value, definitionKey, onChange }: { value: string | number | boolean | undefined; definitionKey: string; onChange: (value: string | number | boolean) => void }) {
  const definition = interactionProperty(definitionKey);
  if (definition.type === 'color') return <div className="min-w-0 *:w-full"><ColorPicker value={String(value || '#000000')} onChange={onChange} onImmediateChange={onChange} solidOnly /></div>;
  if (definition.type === 'number') return (
    <DecimalInput
      value={typeof value === 'boolean' ? Number(value) : value}
      onValueChange={onChange}
      unit={definition.unit}
      allowPercent
      ariaLabel={`${definition.label} value`}
      glyph={animationPropertyGlyph(definitionKey)}
    />
  );
  return (
    <VisualMeasurementControl
      glyph={animationPropertyGlyph(definitionKey)}
      value={String(value ?? '')}
      onChange={onChange}
      ariaLabel={`${definition.label} value`}
      inputMode="text"
    />
  );
}

function ActionInspector({
  source,
  interaction,
  action,
  selection,
  selectionBindingAllowed,
  onSourceChange,
  onSelectKeyframe,
  propertyFocusRequest,
  onBeginTargetPick,
  componentOptions = [],
  onClose,
}: {
  source: string;
  interaction: InteractionDefinition;
  action: InteractionAction;
  selection: SelectionSnapshot | null;
  selectionBindingAllowed: boolean;
  onSourceChange: (source: string) => void;
  onSelectKeyframe: (phase: 'from' | 'to') => void;
  propertyFocusRequest: TimelinePropertyFocusRequest | null;
  onBeginTargetPick: HtmlMotionTimelineProps['onBeginTargetPick'];
  componentOptions?: HtmlMotionTimelineProps['componentOptions'];
  onClose: () => void;
}) {
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyMenu, setPropertyMenu] = useState(false);
  const [openPropertyGroups, setOpenPropertyGroups] = useState<Record<string, boolean>>({ Transform: true });
  const sourceRef = useRef(source);
  const targetModeRef = useRef(action.target.mode);
  const propertyFieldRefs = useRef<Record<string, HTMLDivElement | null>>({});
  sourceRef.current = source;
  targetModeRef.current = action.target.mode;
  useEffect(() => {
    if (!propertyFocusRequest || propertyFocusRequest.actionId !== action.id) return;
    const frame = requestAnimationFrame(() => {
      const field = propertyFieldRefs.current[`${propertyFocusRequest.property}:${propertyFocusRequest.phase}`];
      if (!field) return;
      field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const control = field.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])');
      control?.focus({ preventScroll: true });
      if (control instanceof HTMLInputElement) control.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [action.id, propertyFocusRequest]);
  useEffect(() => {
    if (!propertyMenu) return;
    const closePropertyMenu = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPropertyMenu(false);
    };
    window.addEventListener('keydown', closePropertyMenu, true);
    return () => window.removeEventListener('keydown', closePropertyMenu, true);
  }, [propertyMenu]);
  const updateAction = (updater: (value: InteractionAction) => InteractionAction) => onSourceChange(updateInteraction(source, interaction.id, item => ({ ...item, actions: item.actions.map(current => current.id === action.id ? updater(current) : current) })));
  const update = (changes: Partial<InteractionAction>) => updateAction(current => {
    const next = { ...current, ...changes };
    if (changes.duration !== undefined && next.keyframes.length >= 2) {
      next.keyframes = interactionKeyframesForDuration(
        current,
        changes.duration,
      );
    }
    return next;
  });
  const updateTarget = (changes: Partial<InteractionAction['target']>) => updateAction(current => ({ ...current, target: { ...current.target, ...changes } }));
  const propertyKeys = Array.from(new Set([...Object.keys(action.from), ...Object.keys(action.to)]));
  const normalizedPropertySearch = propertySearch.trim().toLowerCase();
  const propertyGroups = INTERACTION_PROPERTY_GROUPS.map(group => ({
    group,
    properties: INTERACTION_PROPERTIES.filter(property => property.group === group && `${property.label} ${property.key}`.toLowerCase().includes(normalizedPropertySearch)),
  })).filter(entry => entry.properties.length);
  const addProperty = (property: string) => {
    const reset = interactionProperty(property).reset;
    updateAction(current => ({ ...current, from: { ...current.from, [property]: reset }, to: { ...current.to, [property]: reset } }));
    setPropertyMenu(false);
  };
  const changeProperty = (phase: 'from' | 'to', property: string, value: string | number | boolean) => updateAction(current => {
    const values = { ...current[phase], [property]: value };
    const keyframes = current.keyframes.map((keyframe, index) => {
      const isEndpoint = phase === 'from' ? index === 0 : index === current.keyframes.length - 1;
      return isEndpoint ? { ...keyframe, values } : keyframe;
    });
    return { ...current, [phase]: values, keyframes };
  });
  const removeProperty = (property: string) => updateAction(current => {
    const from = { ...current.from }; const to = { ...current.to };
    delete from[property]; delete to[property];
    return { ...current, from, to, keyframes: current.keyframes.map(keyframe => { const values = { ...keyframe.values }; delete values[property]; return { ...keyframe, values }; }) };
  });
  const changeTargetMode = (mode: InteractionTargetMode) => {
    if (mode === 'selector') { updateTarget({ mode }); return; }
    if (!selection || !selectionBindingAllowed) return;
    const resolved = ensureInteractionSelector(source, selection.path, selection, mode);
    onSourceChange(updateInteraction(resolved.source, interaction.id, item => ({
      ...item,
      actions: item.actions.map(current => current.id === action.id ? { ...current, target: { ...current.target, selector: resolved.selector, label: resolved.label, mode: resolved.mode, scope: 'document' } } : current),
    })));
  };
  const pickTarget = () => onBeginTargetPick(picked => {
    const mode = targetModeRef.current === 'class' ? 'class' : 'element';
    const resolved = ensureInteractionSelector(sourceRef.current, picked.path, picked, mode);
    onSourceChange(updateInteraction(resolved.source, interaction.id, item => ({
      ...item,
      actions: item.actions.map(current => current.id === action.id ? { ...current, target: { ...current.target, selector: resolved.selector, label: resolved.label, mode: resolved.mode, scope: 'document' } } : current),
    })));
  });

  return (
    <aside data-animation-properties-panel className="kodety-compact-scrollbar h-full w-[304px] shrink-0 overflow-y-auto border-l border-[var(--kodety-divider)] bg-[var(--kodety-panel)] max-[980px]:absolute max-[980px]:inset-y-0 max-[980px]:right-0 max-[980px]:z-30 max-[980px]:w-[min(304px,calc(100vw-16px))] max-[980px]:shadow-2xl">
      <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-3">
        <div className="min-w-0 flex-1">
          <input value={action.name} aria-label="Nome da ação" onChange={event => update({ name: event.target.value })} className="block w-full truncate bg-transparent text-[11px] font-medium text-[var(--kodety-text)] outline-none focus-visible:underline" />
          <p className="mt-0.5 text-[8px] text-[var(--kodety-text-tertiary)]">Propriedades da animação</p>
        </div>
        <LooseButton title="Fechar propriedades" onClick={onClose}><X className="size-4" /></LooseButton>
      </header>
      <div className="divide-y divide-[var(--kodety-divider)]">
        <section className="space-y-2.5 px-3 py-3">
          <div className="flex items-center justify-between"><span className="text-[9px] font-medium uppercase tracking-[.1em] text-[var(--kodety-text-tertiary)]">Alvo</span></div>
          <div
            data-animation-target-field
            className="flex h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]"
          >
            <input
              value={action.target.selector}
              placeholder={action.target.label || 'Seletor do alvo'}
              title={action.target.label || action.target.selector}
              onChange={event => updateTarget({
                label: event.target.value || 'Seletor vazio',
                selector: event.target.value,
                mode: 'selector',
                scope: action.target.scope === 'trigger'
                  ? 'document'
                  : action.target.scope,
              })}
              className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 font-mono text-[10px] text-[var(--kodety-text)] outline-none placeholder:text-[var(--kodety-text-tertiary)]"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Escolher alvo no canvas"
                  onClick={pickTarget}
                  className="grid h-full w-8 shrink-0 place-items-center border-l border-white/[.055] bg-black/10 text-white/38 outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-accent-hover)] focus-visible:text-[var(--kodety-accent-hover)]"
                >
                  <Crosshair className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Escolher alvo no canvas</TooltipContent>
            </Tooltip>
          </div>
            <div className="grid h-8 grid-cols-3 rounded-[10px] bg-white/[.065] p-[3px]">
              {(['element', 'class', 'selector'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  disabled={
                    mode !== 'selector' && (
                      !selectionBindingAllowed ||
                      !selection ||
                      (mode === 'class' && !selection.classes.length)
                    )
                  }
                  title={
                    mode !== 'selector' && !selectionBindingAllowed
                      ? 'Use a mira para escolher o alvo sem vincular a ação ao grupo por engano.'
                      : mode === 'class' && !selection?.classes.length
                        ? 'O elemento selecionado não possui classe'
                        : undefined
                  }
                  onClick={() => changeTargetMode(mode)}
                  className={`rounded-[7px] px-1 text-[9px] font-medium capitalize outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${action.target.mode === mode ? 'bg-white/[.13] text-foreground shadow-sm' : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.035] hover:text-[var(--kodety-text-secondary)]'} focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]`}
                >
                  {mode === 'element' ? 'elemento' : mode === 'class' ? 'classe' : 'seletor'}
                </button>
              ))}
          </div>
          {!selectionBindingAllowed && (
            <p className="kodety-info-copy text-[9px] leading-4">
              Esta ação não usa o elemento selecionado como alvo. Use a mira para escolher o alvo exato sem alterar o vínculo por engano.
            </p>
          )}
          <label className="block text-[9px] text-[var(--kodety-text-tertiary)]">
            Escopo
            <VisualSelectControl
              value={action.target.scope}
              options={TARGET_SCOPE_OPTIONS}
              onValueChange={value => updateTarget({ scope: value as InteractionTargetScope })}
              ariaLabel="Escopo do alvo"
              className="mt-1.5"
            />
          </label>
        </section>

        {(action.kind === 'animate' || action.kind === 'set' || action.kind === 'variable') && (
          <section data-animation-timing className="space-y-2.5 px-3 py-3">
            <h4 className="text-[9px] font-medium uppercase tracking-[.1em] text-[var(--kodety-text-tertiary)]">Tempo</h4>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">Duração<DecimalInput value={action.duration} onValueChange={duration => update({ duration: Number(duration) })} min={0} step={0.01} unit="s" glyph="duration" ariaLabel="Duração da animação em segundos" className="mt-1.5" /></label>
              <label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">Início<DecimalInput value={action.start} onValueChange={start => update({ start: Number(start) })} min={0} step={0.01} unit="s" glyph="delay" ariaLabel="Início da animação em segundos" className="mt-1.5" /></label>
            </div>
            {(action.kind === 'animate' || action.kind === 'variable') && (
              <label className="block text-[9px] text-[var(--kodety-text-tertiary)]">
                Curva
                <InteractionEasingControl value={action.ease} duration={action.duration} onValueChange={ease => update({ ease })} className="mt-1.5" />
              </label>
            )}
          </section>
        )}

        {(action.kind === 'animate' || action.kind === 'set') && (
          <section data-animation-properties className="relative space-y-2.5 px-3 py-3">
            <div className="flex items-center justify-between"><span className="text-[9px] font-medium uppercase tracking-[.1em] text-[var(--kodety-text-tertiary)]">Propriedades</span><LooseButton title="Adicionar propriedade" onClick={() => setPropertyMenu(value => !value)}><Plus className="size-3.5" /></LooseButton></div>
            <div className="grid grid-cols-[minmax(72px,.9fr)_minmax(0,1fr)_minmax(0,1fr)_22px] items-center gap-1 text-[8px] uppercase tracking-wide text-[var(--kodety-text-disabled)]">
              <span>Propriedade</span><button type="button" className="text-center hover:text-white" onClick={() => onSelectKeyframe('from')}>De <Diamond className="ml-0.5 inline size-2.5" /></button><button type="button" className="text-center hover:text-white" onClick={() => onSelectKeyframe('to')}>Para <Diamond className="ml-0.5 inline size-2.5" /></button><span />
            </div>
            {propertyKeys.map(property => {
              const focusedPhase = propertyFocusRequest?.actionId === action.id && propertyFocusRequest.property === property
                ? propertyFocusRequest.phase
                : null;
              return (
                <div
                  key={property}
                  data-animation-property-row={property}
                  data-keyframe-focus={focusedPhase || undefined}
                  className={`grid min-h-9 grid-cols-[minmax(72px,.9fr)_minmax(0,1fr)_minmax(0,1fr)_22px] items-center gap-1 rounded-[9px] transition-colors ${focusedPhase ? 'bg-[var(--kodety-accent)]/[.055]' : ''}`}
                >
                  <span className={`truncate text-[10px] ${focusedPhase ? 'font-medium text-[var(--kodety-accent-hover)]' : 'text-[var(--kodety-text-secondary)]'}`} title={property}>{interactionProperty(property).label}</span>
                  <div
                    ref={node => { propertyFieldRefs.current[`${property}:from`] = node; }}
                    data-animation-property-field={`${property}:from`}
                    className="min-w-0 rounded-[8px]"
                  >
                    <PropertyValue value={action.from[property]} definitionKey={property} onChange={value => changeProperty('from', property, value)} />
                  </div>
                  <div
                    ref={node => { propertyFieldRefs.current[`${property}:to`] = node; }}
                    data-animation-property-field={`${property}:to`}
                    className="min-w-0 rounded-[8px]"
                  >
                    <PropertyValue value={action.to[property]} definitionKey={property} onChange={value => changeProperty('to', property, value)} />
                  </div>
                  <LooseButton title="Remove property" danger onClick={() => removeProperty(property)}><span className="text-base leading-none">−</span></LooseButton>
                </div>
              );
            })}
            {!propertyKeys.length && <p className="border-y border-dashed border-[var(--kodety-divider)] px-2 py-3 text-center text-[9px] text-zinc-600">Adicione qualquer propriedade CSS ou GSAP.</p>}
            {propertyMenu && (
              <div className="absolute right-0 top-7 z-40 w-72 overflow-hidden rounded-[8px] border border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel-raised)] shadow-[var(--kodety-shadow-popover)]">
                <div className="flex items-center gap-1 border-b border-[var(--kodety-divider)] p-2">
                  <Input value={propertySearch} onChange={event => setPropertySearch(event.target.value)} placeholder="Buscar propriedades de design" className="h-7 min-w-0 flex-1" autoFocus />
                  <LooseButton title="Fechar propriedades disponíveis" onClick={() => setPropertyMenu(false)}><X className="size-3.5" /></LooseButton>
                </div>
                <div className="max-h-80 overflow-y-auto p-1.5 no-scrollbar">
                  {propertyGroups.map(({ group, properties }) => {
                    const expanded = Boolean(normalizedPropertySearch || openPropertyGroups[group]);
                    return (
                      <div key={group} className="border-b border-white/[.055] last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setOpenPropertyGroups(current => ({ ...current, [group]: !current[group] }))}
                          aria-expanded={expanded}
                          className="flex w-full items-center justify-between gap-1.5 py-2 text-left text-[9px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-white"
                        >
                          <span className="flex min-w-0 flex-1 items-center justify-between gap-1.5">
                            <span>{group}</span>
                            <span className="font-mono font-normal text-zinc-600">{properties.length}</span>
                          </span>
                          <DisclosureChevron expanded={expanded} className="size-3" />
                        </button>
                        {expanded && (
                          <div className="pb-1">
                            {properties.map(property => {
                              const added = propertyKeys.includes(property.key);
                              return (
                                <button
                                  key={property.key}
                                  type="button"
                                  disabled={added}
                                  onClick={() => addProperty(property.key)}
                                  className="flex w-full items-center gap-2 py-1.5 pl-4 text-left text-[10px] text-zinc-300 hover:text-white disabled:cursor-default disabled:text-zinc-600"
                                >
                                  <span className="min-w-0 flex-1 truncate">{property.label}</span>
                                  <span className="font-mono text-[8px] text-zinc-600">{added ? 'added' : property.key}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!propertyGroups.length && <p className="px-2 py-4 text-center text-[9px] text-zinc-600">Nenhuma propriedade encontrada.</p>}
                  {propertySearch
                    && !propertyKeys.includes(cssPropertyToInteraction(propertySearch.trim()))
                    && !INTERACTION_PROPERTIES.some(property => property.key.toLowerCase() === cssPropertyToInteraction(propertySearch.trim()).toLowerCase()) && (
                    <button type="button" onClick={() => addProperty(cssPropertyToInteraction(propertySearch.trim()))} className="mt-1 w-full border-t border-white/10 px-2 py-2 text-left text-[10px] text-[var(--kodety-accent-hover)]">
                      Adicionar “{cssPropertyToInteraction(propertySearch.trim())}”
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {action.kind.startsWith('class-') && <section className="px-3 py-3"><label className="text-[9px] text-[var(--kodety-text-tertiary)]">Nome da classe<Input value={action.className} onChange={event => update({ className: event.target.value.replace(/^\./, '') })} placeholder="is-active" className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] font-mono text-[10px]" /></label></section>}
        {action.kind === 'variable' && <section className="grid grid-cols-2 gap-2 px-3 py-3"><label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">Variável<Input value={action.variableName} onChange={event => update({ variableName: event.target.value })} className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] font-mono text-[10px]" /></label><label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">Valor<Input value={String(action.variableValue)} onChange={event => update({ variableValue: event.target.value })} className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] text-[10px]" /></label></section>}
        {action.kind === 'component-variant' && (
          <section className="space-y-2.5 px-3 py-3">
            <label className="block text-[9px] text-[var(--kodety-text-tertiary)]">
              Component
              <Select
                value={action.componentId}
                onValueChange={componentId => {
                  const component = componentOptions.find(option => option.id === componentId);
                  update({
                    componentId,
                    componentVariantId: component?.variants[0]?.id || '',
                  });
                }}
              >
                <SelectTrigger size="xs" className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] text-[10px]"><SelectValue placeholder="Select component" /></SelectTrigger>
                <SelectContent>
                  {componentOptions.map(component => (
                    <SelectItem key={component.id} value={component.id}>{component.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block text-[9px] text-[var(--kodety-text-tertiary)]">
              Variant
              <Select
                value={action.componentVariantId}
                onValueChange={componentVariantId => update({ componentVariantId })}
                disabled={!action.componentId}
              >
                <SelectTrigger size="xs" className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] text-[10px]"><SelectValue placeholder="Select variant" /></SelectTrigger>
                <SelectContent>
                  {(componentOptions.find(component => component.id === action.componentId)?.variants || []).map(variant => (
                    <SelectItem key={variant.id} value={variant.id}>{variant.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </section>
        )}
        {(action.kind === 'lottie' || action.kind === 'rive' || action.kind === 'spline') && <section className="grid grid-cols-2 gap-2 px-3 py-3"><label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">{action.kind === 'lottie' ? 'Comando' : 'Entrada / variável'}<Input value={action.inputName} onChange={event => update({ inputName: event.target.value })} placeholder={action.kind === 'lottie' ? 'play' : 'nome'} className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] text-[10px]" /></label><label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">Valor<Input value={String(action.inputValue)} onChange={event => update({ inputValue: event.target.value })} className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] text-[10px]" /></label></section>}
        {action.kind === 'event' && <section className="px-3 py-3"><label className="text-[9px] text-[var(--kodety-text-tertiary)]">Nome do evento<Input value={action.eventName} onChange={event => update({ eventName: event.target.value })} className="mt-1.5 h-8 w-full rounded-[8px] bg-black/[.08] font-mono text-[10px]" /></label></section>}

        {action.kind === 'animate' && (
          <section data-animation-sequence className="space-y-2.5 px-3 py-3">
            <h4 className="text-[9px] font-medium uppercase tracking-[.1em] text-[var(--kodety-text-tertiary)]">Sequência</h4>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">
                Repetições
                <DecimalInput value={action.repeat} onValueChange={repeat => update({ repeat: Math.max(-1, numeric(String(repeat))) })} min={-1} step={1} glyph="repeat" ariaLabel="Número de repetições" className="mt-1.5" />
              </label>
              <label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">
                Intervalo
                <DecimalInput value={action.repeatDelay} onValueChange={repeatDelay => update({ repeatDelay: Number(repeatDelay) })} min={0} step={0.01} unit="s" glyph="delay" ariaLabel="Intervalo entre repetições em segundos" className="mt-1.5" />
              </label>
            </div>
            <div className="flex min-h-8 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[10px] text-[var(--kodety-text-secondary)]"><ArrowRightLeft className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" /> Alternar direção</span>
              <Switch size="sm" checked={action.yoyo} onCheckedChange={yoyo => update({ yoyo })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">
                Stagger
                <DecimalInput value={action.stagger} onValueChange={stagger => update({ stagger: Number(stagger) })} step={0.01} unit="s" glyph="stagger" ariaLabel="Stagger em segundos" className="mt-1.5" />
              </label>
              <label className="min-w-0 text-[9px] text-[var(--kodety-text-tertiary)]">
                Origem
                <VisualSelectControl value={action.staggerFrom} options={STAGGER_ORIGIN_OPTIONS} onValueChange={value => update({ staggerFrom: value as InteractionAction['staggerFrom'] })} ariaLabel="Origem da sequência" className="mt-1.5" />
              </label>
            </div>
            <div className="grid grid-cols-2 items-center gap-2">
              <span className="text-[10px] text-[var(--kodety-text-secondary)]">Dividir texto</span>
              <VisualSelectControl value={action.textSplit} options={TEXT_SPLIT_OPTIONS} onValueChange={value => update({ textSplit: value as InteractionAction['textSplit'] })} ariaLabel="Divisão do texto" />
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function HtmlMotionTimelineImpl({
  source,
  selection,
  canvasGeneration,
  isActiveCanvasMessage,
  onCanvasMessage,
  onSourceChange,
  onBeginTargetPick,
  componentOptions = [],
}: HtmlMotionTimelineProps) {
  const setShowTimeline = useHtmlTimelineStore(state => state.setShowTimeline);
  const height = useHtmlTimelineStore(state => state.timelineHeight);
  const onHeightChange = useHtmlTimelineStore(state => state.setTimelineHeight);
  const focusInteractionId = useHtmlTimelineStore(state => state.timelineFocusTimelineId);
  const focusActionId = useHtmlTimelineStore(state => state.timelineFocusClipId);
  const setTimelineFocusTimelineId = useHtmlTimelineStore(state => state.setTimelineFocusTimelineId);
  const setTimelineFocusClipId = useHtmlTimelineStore(state => state.setTimelineFocusClipId);
  const activeTimelineKeyframe = useHtmlTimelineStore(state => state.activeTimelineKeyframe);
  const onKeyframeSelectionChange = useHtmlTimelineStore(state => state.setActiveTimelineKeyframe);
  const document = useMemo(() => readInteractionDocument(source), [source]);
  const selectionInteraction = useMemo(
    () => selection ? document.interactions.find(interaction =>
      interactionMatchesSelection(interaction, selection, source)) || null : null,
    [document.interactions, selection, source],
  );
  const selectionItemInteractions = useMemo(
    () => selection
      ? document.interactions.flatMap(interaction => {
        const selectedTimeline = interactionTimelineForSelection(
          interaction,
          selection,
          source,
        );
        return selectedTimeline ? [selectedTimeline] : [];
      })
      : [],
    [document.interactions, selection, source],
  );
  const selectionScopedInteractions = useMemo(
    () => selection?.hasElementChildren
      ? interactionsInSelectionSubtree(
        source,
        document.interactions,
        selection.path,
      )
      : [],
    [
      document.interactions,
      selection?.hasElementChildren,
      selection?.path,
      source,
    ],
  );
  const selectionScopeAvailable = Boolean(
    selection?.hasElementChildren && selectionScopedInteractions.length,
  );
  const selectionTimelineInteractions = selectionScopeAvailable
    ? selectionScopedInteractions
    : selectionItemInteractions;
  const selectionTimelineAvailable = selectionTimelineInteractions.length > 0;
  const [timelineScope, setTimelineScope] = useState<'selection' | 'element' | 'interaction'>(
    focusInteractionId
      ? 'interaction'
      : selectionScopeAvailable
        ? 'selection'
        : selectionTimelineAvailable
          ? 'element'
          : 'interaction',
  );
  const [activeInteractionId, setActiveInteractionId] = useState(
    focusInteractionId
    || selectionInteraction?.id
    || selectionScopedInteractions[0]?.id
    || document.interactions[0]?.id
    || '',
  );
  const [selectedActionId, setSelectedActionId] = useState<string | null>(focusActionId || null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(TIMELINE_DEFAULT_ZOOM);
  const [zoomDraft, setZoomDraft] = useState(String(TIMELINE_DEFAULT_ZOOM));
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [dragPreview, setDragPreview] = useState<{ id: string; start: number; duration: number } | null>(null);
  const [propertyFocusRequest, setPropertyFocusRequest] = useState<TimelinePropertyFocusRequest | null>(null);
  const [runtimeDurations, setRuntimeDurations] = useState<Map<string, number>>(() => new Map());
  const animationFrame = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const playbackDurationRef = useRef(0);
  const playbackInteractionIdsRef = useRef<string[]>([]);
  const controlledInteractionIdsRef = useRef<string[]>([]);
  const activeInteractionIdRef = useRef(activeInteractionId);
  const selectedPathRef = useRef(selection?.path || '');
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressedActionClickRef = useRef<{ actionId: string; at: number } | null>(null);
  const propertyFocusSequenceRef = useRef(0);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const timelinePanelRef = useRef<HTMLDivElement | null>(null);
  const timelineHeightRef = useRef(height);
  const zoomInputEditingRef = useRef(false);
  const skipZoomCommitRef = useRef(false);
  const startedAt = useRef(0);
  const scopedInteractions = timelineScope === 'selection'
    ? selectionScopeAvailable
      ? selectionScopedInteractions
      : []
    : timelineScope === 'element'
      ? selectionItemInteractions
      : [];
  const canonicalActiveInteraction =
    document.interactions.find(interaction => interaction.id === activeInteractionId) || null;
  const activeInteraction = timelineScope === 'interaction'
    ? canonicalActiveInteraction || (!selection ? document.interactions[0] || null : null)
    : scopedInteractions.find(interaction => interaction.id === activeInteractionId)
      || scopedInteractions[0]
      || null;
  const visibleInteractions = timelineScope === 'interaction'
    ? activeInteraction
      ? [activeInteraction]
      : []
    : scopedInteractions;
  const previewScopeHasHiddenActions = timelineScope !== 'interaction'
    && visibleInteractions.some(interaction => {
      const canonical = document.interactions.find(
        candidate => candidate.id === interaction.id,
      );
      return !canonical || !selection || !interactionProjectionIsCompleteForSelectionSubtree(
        source,
        canonical,
        interaction,
        selection.path,
      );
    });
  const showInteractionGroups = timelineScope === 'selection' && visibleInteractions.length > 0;
  const showSelectionTimeline = timelineScope !== 'interaction' && selectionTimelineAvailable;
  const selectionScopeLabel = selection?.attributes['data-label']
    || selection?.id
    || selection?.classes[0]
    || selection?.tag
    || 'Seleção';
  const selectionScopeActionCount = selectionTimelineInteractions.reduce(
    (total, interaction) => total + interaction.actions.length,
    0,
  );
  const selectedAction = activeInteraction?.actions.find(action => action.id === selectedActionId) || null;
  const selectedActionUsesSelection = Boolean(
    selection &&
    activeInteraction &&
    selectedAction &&
    interactionActionTargetMatchesSelectionPath(
      source,
      activeInteraction,
      selectedAction,
      selection.path,
    ),
  );
  const previewInteractionIds = timelinePreviewInteractionIds(
    timelineScope,
    activeInteraction?.id || '',
    visibleInteractions.map(interaction => interaction.id),
  );
  const previewInteractionIdsKey = previewInteractionIds.join('\u0000');
  const previewRuntimeDurationKeys = previewInteractionIds.flatMap(interactionId => {
    const runtimeInteraction = document.interactions.find(
      interaction => interaction.id === interactionId,
    );
    return runtimeInteraction
      ? [`${interactionId}\u0000${JSON.stringify(runtimeInteraction)}`]
      : [];
  });
  const previewRuntimeDurationKeysSignature = previewRuntimeDurationKeys.join('\u0001');
  const authoredDuration = visibleInteractions.length
    ? Math.max(...visibleInteractions.map(interactionDuration))
    : activeInteraction
      ? interactionDuration(activeInteraction)
      : 2;
  const measuredRuntimeDuration = Math.max(
    0,
    ...previewRuntimeDurationKeys.map(key => runtimeDurations.get(key) || 0),
  );
  const duration = Math.max(authoredDuration, measuredRuntimeDuration);
  playbackDurationRef.current = duration;
  const visibleTrackWidth = Math.max(0, timelineViewportWidth - TIMELINE_LABEL_COLUMN_WIDTH);
  const trackWidth = Math.max(320, visibleTrackWidth, duration * zoom + TIMELINE_END_PADDING);
  const fittedZoom = timelineViewportWidth > 0
    ? fitTimelineZoom(duration, timelineViewportWidth)
    : TIMELINE_DEFAULT_ZOOM;
  const [timelineMaxHeight, setTimelineMaxHeight] = useState(
    Math.max(
      MOTION_TIMELINE_MIN_HEIGHT,
      typeof window === 'undefined'
        ? MOTION_TIMELINE_DEFAULT_MAX_HEIGHT
        : window.innerHeight - TIMELINE_MIN_CANVAS_HEIGHT,
    ),
  );
  activeInteractionIdRef.current = activeInteractionId;
  timelineHeightRef.current = height;
  const postInteractionControl = useCallback((
    interactionIds: readonly string[],
    action: 'play' | 'pause' | 'restart' | 'reverse' | 'reset' | 'seek' | 'release',
    time?: number,
  ) => {
    const normalizedIds = timelinePreviewInteractionIds(
      'selection',
      '',
      interactionIds,
    );
    onCanvasMessage({
      type: 'html-editor-interaction-control',
      action,
      ...(normalizedIds.length > 1
        ? { interactionIds: normalizedIds }
        : { interactionId: normalizedIds[0] }),
      ...(time === undefined ? {} : { time }),
    });
  }, [onCanvasMessage]);
  const releaseInteractionPreview = useCallback((interactionIds?: readonly string[]) => {
    const targets = interactionIds?.length
      ? Array.from(interactionIds)
      : controlledInteractionIdsRef.current.length
        ? controlledInteractionIdsRef.current
        : activeInteractionIdRef.current
          ? [activeInteractionIdRef.current]
          : [];
    postInteractionControl(targets, 'release');
    controlledInteractionIdsRef.current = [];
    playbackInteractionIdsRef.current = [];
  }, [postInteractionControl]);

  useEffect(() => {
    const expectedDurationKeys = new Set(previewRuntimeDurationKeys);
    const receiveRuntimeDuration = (event: MessageEvent) => {
      const payload = event.data;
      if (
        payload?.type !== 'html-editor-interaction-duration'
        || payload.generation !== canvasGeneration
        || (isActiveCanvasMessage && !isActiveCanvasMessage(event))
        || typeof payload.interactionId !== 'string'
        || typeof payload.signature !== 'string'
        || !Number.isFinite(payload.duration)
        || payload.duration < 0
        || payload.duration > 86_400
      ) return;
      const measuredDuration = Math.max(0, Number(payload.duration));
      const key = `${payload.interactionId}\u0000${payload.signature}`;
      if (!expectedDurationKeys.has(key)) return;
      setRuntimeDurations(current => {
        if (current.get(key) === measuredDuration) return current;
        const next = new Map(current);
        next.set(key, measuredDuration);
        return next;
      });
    };
    window.addEventListener('message', receiveRuntimeDuration);
    return () => window.removeEventListener('message', receiveRuntimeDuration);
  }, [
    canvasGeneration,
    isActiveCanvasMessage,
    previewRuntimeDurationKeysSignature,
  ]);
  useEffect(() => {
    setRuntimeDurations(current => {
      if (!previewRuntimeDurationKeys.length) {
        return current.size ? new Map() : current;
      }
      const next = new Map(
        previewRuntimeDurationKeys.flatMap(key => {
          const measuredDuration = current.get(key);
          return measuredDuration === undefined ? [] : [[key, measuredDuration] as const];
        }),
      );
      if (
        next.size === current.size
        && Array.from(next).every(([key, value]) => current.get(key) === value)
      ) return current;
      return next;
    });
  }, [previewRuntimeDurationKeysSignature]);
  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const measure = () => setTimelineViewportWidth(viewport.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeInteraction?.id]);
  useLayoutEffect(() => {
    const workspace = timelinePanelRef.current?.parentElement;
    if (!workspace) return;
    const measure = () => {
      const maximum = Math.max(
        MOTION_TIMELINE_MIN_HEIGHT,
        Math.floor(workspace.clientHeight - TIMELINE_MIN_CANVAS_HEIGHT),
      );
      setTimelineMaxHeight(current => current === maximum ? current : maximum);
      if (timelineHeightRef.current > maximum) onHeightChange(maximum);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    observer?.observe(workspace);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [onHeightChange]);
  useEffect(() => {
    if (zoomMode !== 'fit' || timelineViewportWidth <= 0) return;
    setZoom(current => current === fittedZoom ? current : fittedZoom);
  }, [fittedZoom, timelineViewportWidth, zoomMode]);
  useEffect(() => {
    if (!zoomInputEditingRef.current) setZoomDraft(formatTimelineZoom(zoom));
  }, [zoom]);

  useEffect(() => {
    if (!focusInteractionId) return;
    const openActionCatalog = Boolean(
      focusActionId?.startsWith(
        INTERACTION_ACTION_CATALOG_FOCUS_PREFIX,
      ),
    );
    setTimelineScope('interaction');
    if (focusInteractionId !== activeInteractionIdRef.current) {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
      setPlaying(false);
      playheadRef.current = 0;
      setPlayhead(0);
      releaseInteractionPreview();
      setActiveInteractionId(focusInteractionId);
    }
    setSelectedActionId(openActionCatalog ? null : focusActionId || null);
    setPickerOpen(openActionCatalog);
    onKeyframeSelectionChange(null);
  }, [
    focusActionId,
    focusInteractionId,
    onKeyframeSelectionChange,
    releaseInteractionPreview,
  ]);
  useEffect(() => {
    const selectionCandidates = selectionScopeAvailable
      ? selectionScopedInteractions
      : selectionItemInteractions;
    const interactionId = selectionCandidates[0]?.id
      || (!selection ? document.interactions[0]?.id : undefined);
    const selectedPath = selection?.path || '';
    const selectionChanged = selectedPath !== selectedPathRef.current;
    selectedPathRef.current = selectedPath;
    const currentScopeCandidates = timelineScope === 'selection'
      ? selectionScopeAvailable
        ? selectionScopedInteractions
        : []
      : timelineScope === 'element'
        ? selectionItemInteractions
        : document.interactions;
    const activeStillValid = currentScopeCandidates.some(interaction =>
      interaction.id === activeInteractionIdRef.current);
    if (!selectionChanged && activeStillValid) return;
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    setPlaying(false);
    playheadRef.current = 0;
    setPlayhead(0);
    releaseInteractionPreview();
    setSelectedActionId(null);
    setPickerOpen(false);
    onKeyframeSelectionChange(null);
    setTimelineScope(
      selectionScopeAvailable
        ? 'selection'
        : selectionItemInteractions.length
          ? 'element'
          : 'interaction',
    );
    if (!interactionId) {
      setActiveInteractionId('');
      return;
    }
    if (interactionId === activeInteractionIdRef.current) return;
    setActiveInteractionId(interactionId);
  }, [
    document.interactions,
    onKeyframeSelectionChange,
    releaseInteractionPreview,
    selection,
    selectionItemInteractions,
    selectionScopeAvailable,
    selectionScopedInteractions,
    timelineScope,
  ]);
  useEffect(() => {
    if (
      selectedActionId &&
      !activeInteraction?.actions.some(action => action.id === selectedActionId)
    ) {
      setSelectedActionId(null);
      onKeyframeSelectionChange(null);
    }
  }, [activeInteraction, onKeyframeSelectionChange, selectedActionId]);
  useEffect(() => {
    if (
      !activeInteraction
      || activeInteraction.actions.length
      || showInteractionGroups
    ) return;
    setSelectedActionId(null);
    setPickerOpen(true);
  }, [activeInteraction?.id, showInteractionGroups]);
  useEffect(() => {
    if (!previewInteractionIds.length || previewScopeHasHiddenActions) return;
    // Build and pin the frozen GSAP session as soon as the Timeline is ready.
    // The previous duration-only Pause built the timelines merely to measure
    // them, tore them down, then rebuilt everything on the user's first Seek.
    // Prewarming at the visible playhead removes that first-interaction stall.
    postInteractionControl(
      previewInteractionIds,
      'seek',
      playheadRef.current,
    );
  }, [
    postInteractionControl,
    previewInteractionIdsKey,
    previewRuntimeDurationKeysSignature,
    previewScopeHasHiddenActions,
  ]);
  useEffect(() => () => {
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    releaseInteractionPreview();
    dragCleanupRef.current?.();
  }, [releaseInteractionPreview]);

  const control = (
    action: 'play' | 'pause' | 'restart' | 'reverse' | 'reset' | 'seek' | 'release',
    time?: number,
    interactionIds: readonly string[] = previewInteractionIds,
  ) => {
    postInteractionControl(interactionIds, action, time);
    if (
      action === 'reset'
      || action === 'release'
    ) {
      controlledInteractionIdsRef.current = [];
      return;
    }
    if (action !== 'pause' || time !== undefined) {
      controlledInteractionIdsRef.current = Array.from(interactionIds);
    }
  };
  const seek = (time: number) => {
    if (previewScopeHasHiddenActions) return;
    const next = Math.max(0, Math.min(duration, time));
    playheadRef.current = next;
    setPlayhead(next);
    control('seek', next);
  };
  const commitZoomDraft = () => {
    zoomInputEditingRef.current = false;
    if (skipZoomCommitRef.current) {
      skipZoomCommitRef.current = false;
      setZoomDraft(formatTimelineZoom(zoom));
      return;
    }
    const raw = zoomDraft.replace('%', '').trim();
    const parsed = raw === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(parsed)) {
      setZoomDraft(formatTimelineZoom(zoom));
      return;
    }
    const next = clampTimelineZoom(parsed, zoom);
    setZoomMode('manual');
    setZoom(next);
    setZoomDraft(formatTimelineZoom(next));
  };
  const fitTimeline = () => {
    zoomInputEditingRef.current = false;
    setZoomMode('fit');
    setZoom(fittedZoom);
    setZoomDraft(formatTimelineZoom(fittedZoom));
  };
  const adjustTimelineZoom = (direction: -1 | 1) => {
    const step = zoom < 10
      ? 0.5
      : zoom < 100
        ? 5
        : zoom < 400
          ? 25
          : zoom < 1_000
            ? 100
            : zoom < 4_000
              ? 250
              : 1_000;
    const next = clampTimelineZoom(zoom + direction * step, zoom);
    zoomInputEditingRef.current = false;
    setZoomMode('manual');
    setZoom(next);
    setZoomDraft(formatTimelineZoom(next));
  };
  const stopPlayback = () => {
    setPlaying(false);
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    const playbackInteractionIds = playbackInteractionIdsRef.current.length
      ? playbackInteractionIdsRef.current
      : controlledInteractionIdsRef.current.length
        ? controlledInteractionIdsRef.current
        : previewInteractionIds;
    if (playbackInteractionIds.length) {
      control('seek', playheadRef.current, playbackInteractionIds);
    }
    playbackInteractionIdsRef.current = [];
  };
  const resetPreview = () => {
    setPlaying(false);
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    const interactionIds = controlledInteractionIdsRef.current.length
      ? controlledInteractionIdsRef.current
      : previewScopeHasHiddenActions
        ? []
        : previewInteractionIds;
    playbackInteractionIdsRef.current = [];
    playheadRef.current = 0;
    setPlayhead(0);
    if (interactionIds.length) control('reset', undefined, interactionIds);
  };
  const closeTimeline = useCallback(() => {
    setPlaying(false);
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    playbackInteractionIdsRef.current = [];
    releaseInteractionPreview();
    dragCleanupRef.current?.();
    setShowTimeline(false);
    setTimelineFocusTimelineId(null);
    setTimelineFocusClipId(null);
  }, [releaseInteractionPreview, setShowTimeline, setTimelineFocusClipId, setTimelineFocusTimelineId]);
  const resizeTimeline = (nextHeight: number) => {
    onHeightChange(Math.max(
      MOTION_TIMELINE_MIN_HEIGHT,
      Math.min(timelineMaxHeight, Math.round(nextHeight)),
    ));
  };
  const startTimelineResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    const originY = event.clientY;
    const originHeight = timelineHeightRef.current;
    const previousCursor = globalThis.document.body.style.cursor;
    const previousUserSelect = globalThis.document.body.style.userSelect;
    globalThis.document.body.style.cursor = 'ns-resize';
    globalThis.document.body.style.userSelect = 'none';
    const move = (moveEvent: PointerEvent) => {
      resizeTimeline(originHeight + originY - moveEvent.clientY);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      globalThis.document.body.style.cursor = previousCursor;
      globalThis.document.body.style.userSelect = previousUserSelect;
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    const up = (upEvent: PointerEvent) => {
      resizeTimeline(originHeight + originY - upEvent.clientY);
      cleanup();
    };
    const cancel = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
  };
  const resizeTimelineWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') {
      resizeTimeline(MOTION_TIMELINE_MIN_HEIGHT);
      return;
    }
    if (event.key === 'End') {
      resizeTimeline(timelineMaxHeight);
      return;
    }
    const delta = event.shiftKey ? 48 : 16;
    resizeTimeline(height + (event.key === 'ArrowUp' ? delta : -delta));
  };
  const timelineResizeHandle = (
    <div
      role="separator"
      aria-label="Redimensionar altura da timeline"
      aria-orientation="horizontal"
      aria-valuemin={MOTION_TIMELINE_MIN_HEIGHT}
      aria-valuemax={timelineMaxHeight}
      aria-valuenow={height}
      aria-valuetext={`${height} pixels`}
      tabIndex={0}
      onPointerDown={startTimelineResize}
      onKeyDown={resizeTimelineWithKeyboard}
      className="group absolute inset-x-0 -top-2 z-50 flex h-4 touch-none cursor-ns-resize items-center justify-center outline-none"
    >
      <span className="h-px w-full bg-transparent transition-colors group-hover:bg-[var(--kodety-accent)] group-focus-visible:bg-[var(--kodety-accent)]" />
      <span className="absolute h-1 w-12 rounded-full bg-zinc-600 shadow transition-colors group-hover:bg-[var(--kodety-accent)] group-focus-visible:bg-[var(--kodety-accent)]" />
    </div>
  );
  const timelineTimeFromClientX = (clientX: number) => {
    const bounds = timelineTrackRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return Math.max(0, Math.min(duration, (clientX - bounds.left) / zoom));
  };
  const startPlayheadDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || previewScopeHasHiddenActions) return;
    event.preventDefault();
    event.stopPropagation();
    stopPlayback();
    dragCleanupRef.current?.();
    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // Window listeners below remain the fallback for older WebViews.
    }
    const previousUserSelect = globalThis.document.body.style.userSelect;
    globalThis.document.body.style.userSelect = 'none';
    let pendingSeekTime: number | null = null;
    let pendingSeekFrame: number | null = null;
    const flushPendingSeek = () => {
      pendingSeekFrame = null;
      if (pendingSeekTime === null) return;
      const next = pendingSeekTime;
      pendingSeekTime = null;
      control('seek', next);
    };
    const updateFromClientX = (clientX: number, flush = false) => {
      const next = timelineTimeFromClientX(clientX);
      if (next === null) return;
      playheadRef.current = next;
      setPlayhead(next);
      pendingSeekTime = next;
      if (flush) {
        if (pendingSeekFrame !== null) cancelAnimationFrame(pendingSeekFrame);
        flushPendingSeek();
      } else if (pendingSeekFrame === null) {
        // High-frequency pointers can emit far more events than the canvas can
        // paint. Deliver the newest exact time once per frame so old seeks can
        // never queue behind the user's hand and make scrubbing look sporadic.
        pendingSeekFrame = requestAnimationFrame(flushPendingSeek);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      if (pendingSeekFrame !== null) cancelAnimationFrame(pendingSeekFrame);
      pendingSeekFrame = null;
      pendingSeekTime = null;
      try {
        if (captureTarget.hasPointerCapture(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
      } catch {}
      globalThis.document.body.style.userSelect = previousUserSelect;
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updateFromClientX(moveEvent.clientX);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      updateFromClientX(upEvent.clientX, true);
      cleanup();
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
    };
    const blur = () => cleanup();
    // Apply the pressed frame synchronously. Subsequent moves are coalesced to
    // the display clock and pointer-up always flushes the final exact value.
    updateFromClientX(event.clientX, true);
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
  };
  const beginPlayback = useCallback((from: number) => {
    if (
      !activeInteraction
      || !previewInteractionIds.length
      || previewScopeHasHiddenActions
    ) return;
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    const next = Math.max(0, Math.min(duration, from));
    const interactionIds = Array.from(previewInteractionIds);
    playbackInteractionIdsRef.current = interactionIds;
    controlledInteractionIdsRef.current = interactionIds;
    playheadRef.current = next;
    setPlayhead(next);
    // Start the canvas once and let its private native clock render locally.
    // Sending a cross-window seek on every outer frame can outpace a complex
    // canvas and build a stale command queue, making the preview visibly chase
    // the playhead. The editor playhead remains a lightweight display clock;
    // Pause and completion pin the exact requested time below.
    postInteractionControl(interactionIds, 'play', next);
    setPlaying(true);
    startedAt.current = performance.now() - next * 1000;
    const tick = (now: number) => {
      const time = (now - startedAt.current) / 1000;
      const liveDuration = playbackDurationRef.current;
      const frameTime = Math.min(liveDuration, time);
      playheadRef.current = frameTime;
      setPlayhead(frameTime);
      if (time >= liveDuration) {
        setPlaying(false);
        animationFrame.current = null;
        // Pin the exact final frame in both the current canvas and any buffered
        // generation that may be promoted immediately after playback ends.
        postInteractionControl(interactionIds, 'pause', liveDuration);
        controlledInteractionIdsRef.current = interactionIds;
        playbackInteractionIdsRef.current = [];
        return;
      }
      animationFrame.current = requestAnimationFrame(tick);
    };
    animationFrame.current = requestAnimationFrame(tick);
  }, [
    activeInteraction,
    duration,
    postInteractionControl,
    previewInteractionIdsKey,
    previewScopeHasHiddenActions,
  ]);
  const play = () => {
    if (!activeInteraction) return;
    if (playing) { stopPlayback(); return; }
    const from = playheadRef.current >= duration ? 0 : playheadRef.current;
    beginPlayback(from);
  };
  useEffect(() => {
    const handleSpacePlay = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space'
        || event.repeat
        || event.metaKey
        || event.ctrlKey
        || event.altKey
      ) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      beginPlayback(0);
    };
    window.addEventListener('keydown', handleSpacePlay, true);
    return () => window.removeEventListener('keydown', handleSpacePlay, true);
  }, [beginPlayback]);
  const updateAction = (
    actionId: string,
    changes: Partial<InteractionAction>,
    interactionId = activeInteraction?.id,
  ) => {
    if (!interactionId) return;
    onSourceChange(updateInteraction(source, interactionId, interaction => ({
      ...interaction,
      actions: interaction.actions.map(action => {
        if (action.id !== actionId) return action;
        const next = { ...action, ...changes };
        if (changes.duration !== undefined && next.keyframes.length >= 2) {
          next.keyframes = interactionKeyframesForDuration(
            action,
            changes.duration,
          );
        }
        return next;
      }),
    })));
  };
  const selectTimelineAction = (interactionId: string, actionId: string) => {
    if (timelineScope !== 'interaction') setTimelineScope('interaction');
    const deselect = activeInteractionIdRef.current === interactionId
      && selectedActionId === actionId;
    if (activeInteractionIdRef.current !== interactionId) {
      stopPlayback();
      releaseInteractionPreview();
      playheadRef.current = 0;
      setPlayhead(0);
      setActiveInteractionId(interactionId);
    }
    setSelectedActionId(deselect ? null : actionId);
    setPickerOpen(false);
    onKeyframeSelectionChange(null);
  };
  const clickTimelineAction = (
    event: React.MouseEvent<HTMLButtonElement>,
    interactionId: string,
    actionId: string,
  ) => {
    const suppressed = suppressedActionClickRef.current;
    suppressedActionClickRef.current = null;
    if (
      suppressed?.actionId === actionId
      && Date.now() - suppressed.at < 600
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    selectTimelineAction(interactionId, actionId);
  };
  const focusTimelineInteraction = (interactionId: string) => {
    if (interactionId === activeInteractionIdRef.current) return;
    stopPlayback();
    releaseInteractionPreview();
    playheadRef.current = 0;
    setPlayhead(0);
    setActiveInteractionId(interactionId);
    setSelectedActionId(null);
    setPickerOpen(false);
    onKeyframeSelectionChange(null);
  };
  const addAction = (action: InteractionAction) => {
    if (!activeInteraction) return;
    const authoredInteraction = document.interactions.find(
      interaction => interaction.id === activeInteraction.id,
    );
    if (!authoredInteraction) return;
    const nextAction = {
      ...action,
      start: authoredInteraction.actions.length
        ? Math.max(...authoredInteraction.actions.map(interactionActionEnd))
        : 0,
    };
    onSourceChange(updateInteraction(source, authoredInteraction.id, interaction => ({
      ...interaction,
      actions: [...interaction.actions, nextAction],
    })));
    setTimelineScope('interaction');
    setActiveInteractionId(authoredInteraction.id);
    setSelectedActionId(nextAction.id); setPickerOpen(false); setSearch('');
  };
  const closeActionCatalog = () => {
    setPickerOpen(false);
    setSearch('');
  };
  const closeActionInspector = () => {
    setSelectedActionId(null);
    onKeyframeSelectionChange(null);
  };
  useEffect(() => {
    const closeTopLayer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (pickerOpen) {
        closeActionCatalog();
        return;
      }
      if (selectedActionId) {
        closeActionInspector();
        return;
      }
      closeTimeline();
    };
    window.addEventListener('keydown', closeTopLayer);
    return () => window.removeEventListener('keydown', closeTopLayer);
  }, [closeTimeline, onKeyframeSelectionChange, pickerOpen, selectedActionId]);
  const removeAction = (interactionId: string, actionId: string) => {
    onSourceChange(updateInteraction(source, interactionId, interaction => ({ ...interaction, actions: interaction.actions.filter(action => action.id !== actionId) })));
    if (selectedActionId === actionId) closeActionInspector();
  };
  const startDrag = (
    event: React.PointerEvent,
    interactionId: string,
    action: InteractionAction,
    kind: 'move' | 'start' | 'end',
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    dragCleanupRef.current?.();
    const originX = event.clientX;
    const originY = event.clientY;
    const origin = { start: action.start, duration: action.duration };
    let activated = false;
    let previousUserSelect = '';
    const activate = (moveEvent: PointerEvent) => {
      if (activated) return true;
      if (
        Math.hypot(
          moveEvent.clientX - originX,
          moveEvent.clientY - originY,
        ) < TIMELINE_ACTION_DRAG_THRESHOLD_PX
      ) return false;
      activated = true;
      moveEvent.preventDefault();
      if (activeInteractionIdRef.current !== interactionId) {
        stopPlayback();
        releaseInteractionPreview();
        playheadRef.current = 0;
        setPlayhead(0);
        setActiveInteractionId(interactionId);
      }
      setSelectedActionId(action.id);
      setPickerOpen(false);
      onKeyframeSelectionChange(null);
      setDragPreview({ id: action.id, ...origin });
      previousUserSelect = globalThis.document.body.style.userSelect;
      globalThis.document.body.style.userSelect = 'none';
      return true;
    };
    const previewAt = (clientX: number) => {
      const delta = (clientX - originX) / zoom;
      let start = origin.start; let actionDuration = origin.duration;
      if (kind === 'move') start = Math.max(0, origin.start + delta);
      if (kind === 'start') { const end = origin.start + origin.duration; start = Math.max(0, Math.min(end - .02, origin.start + delta)); actionDuration = end - start; }
      if (kind === 'end') actionDuration = Math.max(.02, origin.duration + delta);
      return { start, duration: actionDuration };
    };
    const move = (moveEvent: PointerEvent) => {
      if (!activate(moveEvent)) return;
      const preview = previewAt(moveEvent.clientX);
      setDragPreview({ id: action.id, ...preview });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      if (activated) {
        globalThis.document.body.style.userSelect = previousUserSelect;
      }
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    const up = (upEvent: PointerEvent) => {
      if (!activated) {
        cleanup();
        return;
      }
      upEvent.preventDefault();
      const preview = previewAt(upEvent.clientX);
      updateAction(
        action.id,
        {
          start: Number(preview.start.toFixed(3)),
          duration: Number(preview.duration.toFixed(3)),
        },
        interactionId,
      );
      const suppressedClick = { actionId: action.id, at: Date.now() };
      suppressedActionClickRef.current = suppressedClick;
      window.setTimeout(() => {
        if (suppressedActionClickRef.current === suppressedClick) {
          suppressedActionClickRef.current = null;
        }
      }, 0);
      setDragPreview(null);
      cleanup();
    };
    const cancel = () => {
      cleanup();
      if (activated) setDragPreview(null);
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
  };
  const selectTimelineKeyframe = (
    interaction: InteractionDefinition,
    action: InteractionAction,
    index: number,
    property?: string,
  ) => {
    const keyframes = timelineActionFrames(action).map(frame => ({ ...frame, values: { ...frame.values } }));
    if (action.keyframes.length < 2) updateAction(action.id, { keyframes }, interaction.id);
    const keyframe = keyframes[index];
    if (!keyframe) return;
    onKeyframeSelectionChange({ interactionId: interaction.id, actionId: action.id, keyframeId: keyframe.id, keyframeIndex: index, keyframeCount: keyframes.length, time: action.start + keyframe.time, values: keyframe.values });
    seek(action.start + keyframe.time);
    const phase = index === 0
      ? 'from'
      : index === keyframes.length - 1
        ? 'to'
        : null;
    if (property && phase) {
      propertyFocusSequenceRef.current += 1;
      setPropertyFocusRequest({
        actionId: action.id,
        property,
        phase,
        keyframeId: keyframe.id,
        requestId: propertyFocusSequenceRef.current,
      });
    } else {
      setPropertyFocusRequest(null);
    }
  };
  const selectKeyframe = (
    interaction: InteractionDefinition,
    action: InteractionAction,
    phase: 'from' | 'to',
  ) => selectTimelineKeyframe(
    interaction,
    action,
    phase === 'from' ? 0 : timelineActionFrames(action).length - 1,
  );

  if (!activeInteraction) return (
    <div
      data-kodety-motion-timeline
      data-kodety-onboarding="design-timeline"
      ref={timelinePanelRef}
      className="absolute inset-x-0 bottom-0 z-40 flex items-center justify-center border-t border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-4 text-center text-xs text-zinc-500"
      style={{ height }}
    >
      {timelineResizeHandle}
      Crie uma interação no painel Interações primeiro.
      <button type="button" onClick={closeTimeline} className="ml-3 flex items-center gap-1 text-zinc-400 transition-colors hover:text-white"><X className="size-3.5" /> Fechar timeline</button>
    </div>
  );

  const { step: rulerTickStep, ticks: rulerTicks } = buildTimelineRulerTicks(trackWidth, zoom);
  const rulerTickPrecision = timelineTickPrecision(rulerTickStep);
  const minorTickWidth = Math.max(8, (rulerTickStep * zoom) / 5);

  return (
    <div
      data-kodety-motion-timeline
      data-kodety-onboarding="design-timeline"
      ref={timelinePanelRef}
      className="absolute inset-x-0 bottom-0 z-40 isolate flex border-t border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)]"
      style={{ height }}
    >
      {timelineResizeHandle}
      <main className="relative flex min-w-0 flex-1 flex-col bg-[var(--kodety-panel)]">
        <header className="relative flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-2.5">
          <div className="min-w-0 shrink-0" style={{ width: TIMELINE_LABEL_COLUMN_WIDTH - 20 }}>
            <Select
              value={showSelectionTimeline ? SELECTION_TIMELINE_SCOPE : activeInteraction.id}
              onValueChange={value => {
                stopPlayback();
                releaseInteractionPreview();
                playheadRef.current = 0;
                setPlayhead(0);
                setSelectedActionId(null);
                setPickerOpen(false);
                onKeyframeSelectionChange(null);
                if (value === SELECTION_TIMELINE_SCOPE) {
                  setTimelineScope(selectionScopeAvailable ? 'selection' : 'element');
                  if (!selectionTimelineInteractions.some(interaction => interaction.id === activeInteractionIdRef.current)) {
                    setActiveInteractionId(selectionTimelineInteractions[0]?.id || '');
                  }
                  return;
                }
                setTimelineScope('interaction');
                setActiveInteractionId(value);
              }}
            >
              <SelectTrigger
                size="xs"
                className="h-7 w-full min-w-0 rounded-[7px] bg-white/[.035] [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:overflow-hidden [&_[data-slot=select-value]]:text-ellipsis [&_[data-slot=select-value]]:whitespace-nowrap"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" style={{ width: TIMELINE_LABEL_COLUMN_WIDTH - 20 }}>
                {selectionTimelineAvailable && (
                  <SelectGroup>
                    <SelectLabel>Seleção atual</SelectLabel>
                    <SelectItem value={SELECTION_TIMELINE_SCOPE}>
                      {selectionScopeLabel} · {selectionScopeActionCount} animação{selectionScopeActionCount === 1 ? '' : 'ões'}
                    </SelectItem>
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectLabel>Timelines</SelectLabel>
                  {document.interactions.map(interaction => (
                    <SelectItem key={interaction.id} value={interaction.id}>
                      {interaction.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <LooseButton title="Início" disabled={previewScopeHasHiddenActions} onClick={() => seek(0)}><ChevronLeft className="size-3.5" /></LooseButton>
            <button
              type="button"
              onClick={play}
              disabled={previewScopeHasHiddenActions}
              title={previewScopeHasHiddenActions
                ? 'Abra uma ação para visualizar a timeline completa antes de reproduzir'
                : undefined}
              className="inline-flex size-7 items-center justify-center text-zinc-300 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={playing ? 'Pausar' : 'Reproduzir'}
            >
              {playing ? <Pause className="size-4.5 fill-current" /> : <Play className="size-4.5 fill-current" />}
            </button>
            <LooseButton title="Fim" disabled={previewScopeHasHiddenActions} onClick={() => seek(duration)}><ChevronRight className="size-3.5" /></LooseButton>
            <span className="ml-1 hidden w-24 font-mono text-[10px] text-zinc-500 min-[1080px]:inline">{playhead.toFixed(2)} / {duration.toFixed(2)}</span>
            <LooseButton title="Redefinir" onClick={resetPreview}><RotateCcw className="size-3.5" /></LooseButton>
          </div>
          {previewScopeHasHiddenActions && (
            <span className="kodety-info-copy hidden max-w-52 truncate text-[8px] min-[1180px]:inline">
              Abra uma ação para reproduzir a timeline completa
            </span>
          )}
          <div data-timeline-toolbar-actions className="ml-auto flex shrink-0 items-center justify-end gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={fitTimeline}
                  aria-label="Ajustar timeline"
                  aria-pressed={zoomMode === 'fit'}
                  className={`inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[9px] font-medium outline-none transition-[background-color,color] hover:bg-white/[.055] focus-visible:bg-white/[.07] ${zoomMode === 'fit' ? 'bg-white/[.1] text-[var(--kodety-text)]' : 'text-[var(--kodety-text-tertiary)] hover:text-[var(--kodety-text-secondary)]'}`}
                >
                  <Maximize2 className="size-3" />
                  Fit
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Ajustar animações à área visível</TooltipContent>
            </Tooltip>
            <div
              data-timeline-zoom-control
              className="ml-1 flex h-7 items-center overflow-hidden rounded-[7px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Diminuir zoom da timeline"
                    onClick={() => adjustTimelineZoom(-1)}
                    className="grid h-full w-7 shrink-0 place-items-center text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-accent-hover)]"
                  >
                    <Minus className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Diminuir zoom</TooltipContent>
              </Tooltip>
              <label className="flex h-full min-w-0 items-center border-x border-white/[.065] px-1">
                <span className="sr-only">Zoom da timeline</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={zoomDraft}
                  onFocus={event => {
                    zoomInputEditingRef.current = true;
                    skipZoomCommitRef.current = false;
                    event.currentTarget.select();
                  }}
                  onChange={event => setZoomDraft(event.target.value)}
                  onBlur={commitZoomDraft}
                  onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      skipZoomCommitRef.current = true;
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-full w-12 border-0 bg-transparent px-0.5 text-center font-mono text-[9px] tabular-nums text-[var(--kodety-text-secondary)] outline-none"
                  aria-label="Zoom da timeline"
                />
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Aumentar zoom da timeline"
                    onClick={() => adjustTimelineZoom(1)}
                    className="grid h-full w-7 shrink-0 place-items-center text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-accent-hover)]"
                  >
                    <Plus className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Aumentar zoom</TooltipContent>
              </Tooltip>
            </div>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--kodety-divider)]" />
            <button
              type="button"
              onClick={() => pickerOpen ? closeActionCatalog() : setPickerOpen(true)}
              aria-label={pickerOpen ? 'Fechar catálogo de ações' : 'Abrir catálogo de ações'}
              aria-controls="interaction-action-catalog"
              aria-expanded={pickerOpen}
              title={pickerOpen ? 'Fechar catálogo de ações' : 'Adicionar ação'}
              className={`inline-flex size-7 items-center justify-center rounded-[6px] outline-none transition-colors focus-visible:bg-white/[.07] ${pickerOpen ? 'bg-white/[.1] text-[var(--kodety-text)]' : 'text-[var(--kodety-accent-hover)] hover:bg-white/[.045]'}`}
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={closeTimeline}
              aria-label="Fechar timeline"
              title="Fechar timeline"
              className="inline-flex size-7 items-center justify-center rounded-[6px] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.045] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.07]"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </header>
        <div ref={timelineViewportRef} data-timeline-viewport className="kodety-compact-scrollbar min-h-0 flex-1 overflow-auto bg-[var(--kodety-panel)]">
          <div className="flex min-h-full bg-[var(--kodety-panel)]" style={{ width: TIMELINE_LABEL_COLUMN_WIDTH + trackWidth }}>
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)] pt-[26px]"
              style={{ width: TIMELINE_LABEL_COLUMN_WIDTH }}
            >
              {visibleInteractions.map(interaction => (
                <div key={interaction.id}>
                  {showInteractionGroups && (
                    <button
                      type="button"
                      onClick={() => focusTimelineInteraction(interaction.id)}
                      className={`flex h-[26px] w-full min-w-0 items-center gap-1.5 border-b border-white/[.055] px-2.5 text-left outline-none transition-colors hover:bg-[var(--kodety-panel-hover)] focus-visible:bg-[var(--kodety-panel-hover)] ${activeInteraction.id === interaction.id ? 'bg-[var(--kodety-panel-raised)] text-[var(--kodety-text-secondary)]' : 'bg-[var(--kodety-panel)] text-[var(--kodety-text-tertiary)]'}`}
                      title={`${interaction.name} · ${interaction.triggerLabel}`}
                    >
                      <Zap className="size-2.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-[8px] font-semibold uppercase tracking-[.08em]">
                        {interaction.name}
                      </span>
                      <span className="shrink-0 text-[8px] tabular-nums opacity-60">
                        {interaction.actions.length}
                      </span>
                    </button>
                  )}
                  {interaction.actions.map(action => {
                    const selected = activeInteraction.id === interaction.id
                      && selectedActionId === action.id;
                    const animatedProperties = timelineActionPropertyKeys(action);
                    return (
                      <div key={action.id}>
                        <div className={`group flex h-[34px] w-full items-center border-b border-white/[.045] transition-colors ${selected ? 'bg-[var(--kodety-panel-raised)]' : 'bg-[var(--kodety-panel)] hover:bg-[var(--kodety-panel-hover)]'}`}>
                          <button type="button" onClick={() => selectTimelineAction(interaction.id, action.id)} className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2.5 text-left outline-none focus-visible:bg-white/[.04]">
                            <span className={`size-2 rounded-[3px] border ${selected ? 'border-[var(--kodety-accent)]/70 bg-[var(--kodety-accent)]/65' : 'border-white/[.15] bg-white/[.09]'}`} />
                            <span className={`min-w-0 flex-1 truncate text-[10px] ${selected ? 'font-medium text-[var(--kodety-text)]' : 'text-[var(--kodety-text-secondary)]'}`}>{action.name}</span>
                          </button>
                          <span className="mr-1">
                            <LooseButton title="Remover ação" danger onClick={() => removeAction(interaction.id, action.id)}><Trash2 className="size-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" /></LooseButton>
                          </span>
                        </div>
                        {selected && animatedProperties.map(property => (
                          <div key={property} data-timeline-property-label className="relative flex h-[25px] min-w-0 items-center gap-2 border-b border-white/[.035] bg-[var(--kodety-panel)] pl-8 pr-2.5 text-[9px]">
                            <span aria-hidden="true" className="absolute left-[18px] top-0 h-1/2 w-2.5 rounded-bl-[4px] border-b border-l border-white/[.12]" />
                            <span className="min-w-0 flex-1 truncate text-[var(--kodety-text-secondary)]" title={interactionProperty(property).label}>{interactionProperty(property).label}</span>
                            <Diamond className="size-2.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
                            <span className="max-w-16 shrink-0 truncate font-mono text-[8px] tabular-nums text-[var(--kodety-text-tertiary)]" title={timelinePropertyDisplayValue(action, property)}>{timelinePropertyDisplayValue(action, property)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {!interaction.actions.length && (
                    <div className="flex h-[34px] items-center border-b border-white/[.045] bg-[var(--kodety-panel)] px-2.5 text-[9px] text-[var(--kodety-text-disabled)]">
                      Nenhuma ação nesta interação.
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div ref={timelineTrackRef} data-timeline-lanes className="relative min-h-full shrink-0 overflow-hidden bg-[var(--kodety-panel)]" style={{ width: trackWidth }}>
              <div
                className={`sticky top-0 z-10 h-[26px] touch-none border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] ${previewScopeHasHiddenActions ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
                style={{
                  backgroundImage: 'linear-gradient(to right,rgba(255,255,255,.08) 1px,transparent 1px)',
                  backgroundSize: `${minorTickWidth}px 8px`,
                  backgroundPosition: 'left bottom',
                  backgroundRepeat: 'repeat-x',
                }}
                onPointerDown={startPlayheadDrag}
              >
                {rulerTicks.map(time => (
                  <span key={time} className="absolute bottom-0 h-2 border-l border-white/20" style={{ left: time * zoom }}>
                    <span className={`absolute bottom-2.5 whitespace-nowrap font-mono text-[8px] text-[var(--kodety-text-tertiary)] ${time === 0 ? 'translate-x-1' : '-translate-x-1/2'}`}>
                      {time.toFixed(rulerTickPrecision)}s
                    </span>
                  </span>
                ))}
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 top-[26px] z-0 opacity-55"
                style={{
                  backgroundImage: 'linear-gradient(to right,rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(to right,rgba(255,255,255,.018) 1px,transparent 1px)',
                  backgroundSize: `${rulerTickStep * zoom}px 100%,${minorTickWidth}px 100%`,
                  backgroundRepeat: 'repeat',
                }}
              />
              <div
                data-timeline-playhead
                role="slider"
                aria-label="Posição da timeline"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={Number(playhead.toFixed(3))}
                aria-disabled={previewScopeHasHiddenActions}
                tabIndex={previewScopeHasHiddenActions ? -1 : 0}
                onPointerDown={startPlayheadDrag}
                onKeyDown={event => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  stopPlayback();
                  const direction = event.key === 'ArrowRight' ? 1 : -1;
                  seek(playhead + direction * (event.shiftKey ? 0.1 : 0.01));
                }}
                className={`absolute inset-y-0 z-30 w-4 -translate-x-1/2 touch-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]/70 ${previewScopeHasHiddenActions ? 'cursor-not-allowed opacity-45' : 'cursor-ew-resize'}`}
                style={{ left: playhead * zoom }}
              >
                <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--kodety-accent)]" />
                <span className="pointer-events-none absolute left-1/2 top-0 size-2 -translate-x-1/2 rotate-45 bg-[var(--kodety-accent)]" />
              </div>
              {visibleInteractions.map(interaction => (
                <div key={interaction.id} className="relative z-[1]">
                  {showInteractionGroups && (
                    <div
                      className={`h-[26px] border-b border-white/[.055] ${activeInteraction.id === interaction.id ? 'bg-[var(--kodety-panel-raised)]' : 'bg-[var(--kodety-panel)]'}`}
                    />
                  )}
                  {interaction.actions.map(action => {
                    const preview = dragPreview?.id === action.id ? dragPreview : action;
                    const selected = activeInteraction.id === interaction.id
                      && selectedActionId === action.id;
                    const animatedProperties = timelineActionPropertyKeys(action);
                    const frames = timelineActionFrames(action);
                    return (
                      <div key={action.id}>
                        <div
                          className={`relative h-[34px] border-b border-white/[.045] ${selected ? 'bg-[var(--kodety-panel-raised)]' : 'bg-[var(--kodety-panel)]'}`}
                        >
                          <button
                            type="button"
                            data-timeline-action-clip
                            onClick={event => clickTimelineAction(event, interaction.id, action.id)}
                            onPointerDown={event => startDrag(event, interaction.id, action, 'move')}
                            className={`group/clip absolute top-1 flex h-[26px] cursor-grab items-center overflow-hidden rounded-[7px] border text-left text-[9px] outline-none transition-[background-color,border-color,color] active:cursor-grabbing focus-visible:border-white/70 ${selected ? 'border-transparent bg-[color-mix(in_srgb,var(--kodety-accent)_72%,#4338ca)] text-white' : dragPreview?.id === action.id ? 'border-[var(--kodety-accent)] bg-[var(--kodety-panel-raised)] text-[var(--kodety-text)]' : 'border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel-raised)] text-[var(--kodety-text-secondary)] hover:border-white/[.18] hover:bg-[var(--kodety-panel-hover)] hover:text-white'}`}
                            style={{ left: preview.start * zoom, width: Math.max(28, preview.duration * zoom) }}
                          >
                            <span
                              data-timeline-resize-handle="start"
                              onPointerDown={event => startDrag(event, interaction.id, action, 'start')}
                              className="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize"
                            >
                              <span className={`pointer-events-none absolute left-1.5 top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full transition-[background-color,opacity] ${selected || dragPreview?.id === action.id ? 'bg-white opacity-100' : 'bg-white/55 opacity-0 group-hover/clip:opacity-100'}`} />
                            </span>
                            <span className="block min-w-0 flex-1 truncate overflow-hidden px-3 font-medium">{action.name}</span>
                            <span
                              data-timeline-resize-handle="end"
                              onPointerDown={event => startDrag(event, interaction.id, action, 'end')}
                              className="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize"
                            >
                              <span className={`pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full transition-[background-color,opacity] ${selected || dragPreview?.id === action.id ? 'bg-white opacity-100' : 'bg-white/55 opacity-0 group-hover/clip:opacity-100'}`} />
                            </span>
                          </button>
                        </div>
                        {selected && animatedProperties.map(property => {
                          const propertyFrames = frames.flatMap((frame, frameIndex) => (
                            frameIndex === 0
                            || frameIndex === frames.length - 1
                            || Object.hasOwn(frame.values, property)
                              ? [{ frame, frameIndex }]
                              : []
                          ));
                          const framePosition = (frameTime: number) => {
                            const relativeProgress = action.duration > 0
                              ? frameTime / action.duration
                              : 0;
                            return Math.max(5, (preview.start + relativeProgress * preview.duration) * zoom);
                          };
                          const lineStart = framePosition(propertyFrames[0]?.frame.time ?? 0);
                          const lineEnd = framePosition(propertyFrames[propertyFrames.length - 1]?.frame.time ?? action.duration);
                          return (
                            <div
                              key={property}
                              data-timeline-property-row={property}
                              className="relative h-[25px] border-b border-white/[.035] bg-[var(--kodety-panel)]"
                            >
                              <span
                                aria-hidden="true"
                                className="absolute top-1/2 h-px -translate-y-1/2 opacity-70"
                                style={{ left: lineStart, width: Math.max(0, lineEnd - lineStart), background: 'color-mix(in srgb, var(--kodety-accent) 52%, transparent)' }}
                              />
                              {propertyFrames.map(({ frame, frameIndex }) => {
                                const focused = activeTimelineKeyframe?.interactionId === interaction.id
                                  && activeTimelineKeyframe.actionId === action.id
                                  && activeTimelineKeyframe.keyframeId === frame.id
                                  && propertyFocusRequest?.property === property;
                                return (
                                  <button
                                    key={`${property}-${frame.id}`}
                                    type="button"
                                    data-timeline-property-keyframe={`${property}:${frame.id}`}
                                    aria-label={`${interactionProperty(property).label}, keyframe ${frameIndex + 1}`}
                                    title={`${interactionProperty(property).label} · ${frame.time.toFixed(3)}s`}
                                    onClick={event => {
                                      event.stopPropagation();
                                      selectTimelineKeyframe(interaction, action, frameIndex, property);
                                    }}
                                    className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer rounded-[2px] border outline-none transition-[background-color,border-color,transform] hover:scale-110 focus-visible:border-[var(--kodety-accent-hover)] ${focused ? 'border-[var(--kodety-accent)] bg-[var(--kodety-accent)]' : 'border-white/35 bg-[var(--kodety-panel)] hover:border-[var(--kodety-accent)]/70'}`}
                                    style={{ left: framePosition(frame.time) }}
                                  />
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {!interaction.actions.length && (
                    <div className="h-[34px] border-b border-white/[.045] bg-[var(--kodety-panel)]" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      {pickerOpen
        ? <ActionPicker search={search} onSearch={setSearch} onAdd={addAction} onClose={closeActionCatalog} />
        : selectedAction
          ? <ActionInspector source={source} interaction={activeInteraction} action={selectedAction} selection={selection} selectionBindingAllowed={selectedActionUsesSelection} onSourceChange={onSourceChange} onSelectKeyframe={phase => selectKeyframe(activeInteraction, selectedAction, phase)} propertyFocusRequest={activeTimelineKeyframe?.keyframeId === propertyFocusRequest?.keyframeId ? propertyFocusRequest : null} onBeginTargetPick={onBeginTargetPick} componentOptions={componentOptions} onClose={closeActionInspector} />
          : (
            <aside className="flex h-full w-[304px] shrink-0 flex-col items-center justify-center border-l border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-7 text-center max-[980px]:hidden">
              <MousePointer2 className="size-5 stroke-[1.35] text-[var(--kodety-text-tertiary)] opacity-75" />
              <p className="mt-3 max-w-[232px] text-balance text-[11px] leading-[1.45] text-[var(--kodety-text-secondary)]">Selecione uma ação para editar alvo, tempo e propriedades.</p>
              <p className="mt-2 max-w-[218px] text-balance text-[9px] leading-[1.55] text-[var(--kodety-text-tertiary)]">Para criar uma, use Adicionar na barra da timeline.</p>
            </aside>
          )}
    </div>
  );
}

function HtmlMotionTimelineGate(props: HtmlMotionTimelineProps) {
  const showTimeline = useHtmlTimelineStore(state => state.showTimeline);
  if (
    !showTimeline ||
    props.mode !== 'design' ||
    props.workspaceReadOnly ||
    props.isPreviewing ||
    props.editingLocalizedPage
  ) return null;
  return <HtmlMotionTimelineImpl {...props} />;
}

export const HtmlMotionTimeline = memo(HtmlMotionTimelineGate);
