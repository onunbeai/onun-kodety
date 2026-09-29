'use client';

import { DisclosureSummary } from '@/components/ui/disclosure-summary';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  ArrowUpRight,
  Calendar,
  Check,
  CircleUserRound,
  Clock3,
  Copy,
  FlaskConical,
  Gauge,
  Globe2,
  Laptop,
  Link2,
  Loader2,
  Monitor,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  SlidersHorizontal,
  Smartphone,
  Square,
  Trash2,
  Trophy,
  Users,
  Zap,
} from '@/components/ui/gravity-icons';
import { TestTubeIcon as SolarTestTubeIcon } from '@solar-icons/react/bold-duotone/test-tube';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  type AnalyticsTargetSelectorType,
  type AnalyticsTrackingTarget,
} from '@/lib/html-editor/analytics';
import type {
  HtmlExperiment,
  HtmlExperimentOptions,
} from '@/lib/html-editor/experiments';
import type { AnalyticsPageOption } from './HtmlAnalyticsFunnels';
import { cn } from '@/lib/utils';
import { getAdminDateTimeFormatter, getAdminNumberFormatter } from '@/lib/admin-ui-locale';
import {
  AnalyticsEmptyState,
  AnalyticsPageHeader,
  AnalyticsSectionHeader,
  AnalyticsSurface,
} from './HtmlAnalyticsUi';
import { HtmlDatePicker } from './HtmlDatePicker';

export type HtmlAbTestStatus = 'draft' | 'running' | 'paused' | 'completed';

export interface HtmlAbVariantMetrics {
  views: number | null;
  conversions: number | null;
  conversionRate: number | null;
  lift: number | null;
  confidence: number | null;
}

export interface HtmlAbVariantViewModel {
  id: string;
  name: string;
  /** Human-facing slug (its "link"); defaults to the physical id. */
  slug: string;
  /** Slug currently live on the published runtime, when known. */
  deployedSlug?: string;
  pagePath: string;
  isControl: boolean;
  enabled: boolean;
  weight: number;
  metrics?: HtmlAbVariantMetrics | null;
}

export interface HtmlAbTestViewModel {
  id: string;
  name: string;
  sourcePagePath: string;
  goalTrackingId: string;
  goalTargetType: AnalyticsTargetSelectorType;
  goalTargetValue: string;
  status: HtmlAbTestStatus;
  variants: HtmlAbVariantViewModel[];
  winnerVariantId?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Status confirmed by the currently published WordPress runtime. */
  deployedStatus?: HtmlAbTestStatus | null;
  options: HtmlExperimentOptions;
}

export interface HtmlAbTestCreateInput {
  name: string;
  sourcePagePath: string;
  goalTrackingId: string;
  goalTargetType: AnalyticsTargetSelectorType;
  goalTargetValue: string;
}

export interface HtmlAbTestRuntimeState {
  startedAt?: string | null;
  completedAt?: string | null;
  deployedStatus?: HtmlAbTestStatus | null;
  /** Physical variant id → the slug it is currently published under. */
  deployedVariantSlugs?: Record<string, string>;
}

/**
 * Normalize any experiment status into the vocabulary the A/B UI works in.
 *
 * The editor's `HtmlExperiment` model and the WordPress REST API both speak the
 * "client" vocabulary (`active`/`archived`), while the UI and runtime-state
 * layer speak `running`/`completed`. Everything that reads a status from those
 * sources must funnel through here so local and deployed statuses can be
 * compared directly — otherwise a running, published test never reconciles and
 * is stuck reporting "Aguardando publicação". Returns `null` for anything
 * unrecognized so callers can distinguish "no status" from a real one.
 */
export function normalizeAbTestStatus(status: unknown): HtmlAbTestStatus | null {
  switch (typeof status === 'string' ? status : '') {
    case 'active':
    case 'running':
      return 'running';
    case 'archived':
    case 'completed':
      return 'completed';
    case 'paused':
      return 'paused';
    case 'draft':
      return 'draft';
    default:
      return null;
  }
}

export function htmlExperimentToAbTestViewModel(
  experiment: HtmlExperiment,
  metrics: Record<string, HtmlAbVariantMetrics | null | undefined> = {},
  runtime: HtmlAbTestRuntimeState = {},
  trackingTargets: AnalyticsTrackingTarget[] = [],
): HtmlAbTestViewModel {
  const status = normalizeAbTestStatus(experiment.status) ?? 'draft';
  const clickGoal = experiment.goal.type === 'click' ? experiment.goal : null;
  const goalTrackingId = clickGoal?.trackingId || '';
  const encodedTarget = /^(id|class):(.+)$/.exec(goalTrackingId);
  const declaredTargetType = clickGoal?.targetType
    || (encodedTarget?.[1] === 'class' ? 'class' : encodedTarget?.[1] === 'id' ? 'id' : undefined);
  const declaredTargetValue = clickGoal?.targetValue?.trim() || encodedTarget?.[2]?.trim() || '';
  const goalTarget = trackingTargets.find(target => (
    declaredTargetType
    && declaredTargetValue
    && abGoalTargetType(target) === declaredTargetType
    && abGoalTargetValue(target) === declaredTargetValue
  )) || trackingTargets.find(target => (
    target.id === goalTrackingId
    || Boolean(declaredTargetValue && target.id === declaredTargetValue)
  ));
  return {
    id: experiment.id,
    name: experiment.name,
    sourcePagePath: experiment.pagePath,
    goalTrackingId,
    goalTargetType: declaredTargetType || abGoalTargetType(goalTarget || {
      id: goalTrackingId,
      label: goalTrackingId,
      type: 'click',
    }),
    goalTargetValue: declaredTargetValue || (goalTarget ? abGoalTargetValue(goalTarget) : goalTrackingId),
    status,
    variants: experiment.variants.map(variant => ({
      id: variant.id,
      name: variant.name,
      slug: variant.slug && variant.slug.trim() ? variant.slug : variant.id,
      deployedSlug: runtime.deployedVariantSlugs?.[variant.id],
      pagePath: variant.pagePath,
      isControl: variant.kind === 'control',
      enabled: variant.status === 'active',
      weight: variant.weight,
      metrics: metrics[variant.id] ?? null,
    })),
    winnerVariantId: experiment.winnerVariantId,
    createdAt: experiment.createdAt,
    startedAt: runtime.startedAt,
    completedAt: runtime.completedAt,
    deployedStatus: runtime.deployedStatus,
    options: {
      trafficPercent: experiment.trafficPercent,
      allocationMode: experiment.allocationMode,
      deliveryMode: experiment.deliveryMode,
      stickyDays: experiment.stickyDays,
      audience: { ...experiment.audience },
      autoStop: { ...experiment.autoStop },
    },
  };
}

export interface HtmlAnalyticsAbTestsProps {
  tests: HtmlAbTestViewModel[];
  pages?: AnalyticsPageOption[];
  trackingTargets?: AnalyticsTrackingTarget[];
  /** Public WordPress root, including a possible subdirectory. */
  siteUrl?: string;
  selectedId?: string | null;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  onRefresh?: () => void;
  onCreateTest?: (input: HtmlAbTestCreateInput) => Promise<HtmlAbTestViewModel>;
  onDeleteTest?: (testId: string) => void | Promise<void>;
  onRenameTest?: (testId: string, name: string) => void | Promise<void>;
  onGoalChange?: (
    testId: string,
    trackingId: string,
    targetType?: AnalyticsTargetSelectorType,
    targetValue?: string,
  ) => void | Promise<void>;
  onOptionsChange?: (
    testId: string,
    options: Partial<HtmlExperimentOptions>,
  ) => void | Promise<void>;
  onCreateVariant?: (testId: string, sourceVariantId: string) => void | Promise<void>;
  onDuplicateVariant?: (testId: string, variantId: string) => void | Promise<void>;
  onRemoveVariant?: (testId: string, variantId: string) => void | Promise<void>;
  onRenameVariant?: (testId: string, variantId: string, name: string) => void | Promise<void>;
  onVariantSlugChange?: (testId: string, variantId: string, slug: string) => void | Promise<void>;
  onToggleVariant?: (testId: string, variantId: string, enabled: boolean) => void | Promise<void>;
  onWeightChange?: (testId: string, variantId: string, weight: number) => void | Promise<void>;
  onEqualizeWeights?: (testId: string, weights: Record<string, number>) => void | Promise<void>;
  onStart?: (testId: string) => void | Promise<void>;
  onPause?: (testId: string) => void | Promise<void>;
  onResume?: (testId: string) => void | Promise<void>;
  onComplete?: (testId: string) => void | Promise<void>;
  onPromoteWinner?: (testId: string, variantId: string) => void | Promise<void>;
  onOpenVariant?: (test: HtmlAbTestViewModel, variant: HtmlAbVariantViewModel) => void;
}

const STATUS_COPY: Record<HtmlAbTestStatus, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'text-[var(--kodety-text-tertiary)]' },
  running: { label: 'Em execução', className: 'text-[var(--kodety-success)]' },
  paused: { label: 'Pausado', className: 'text-[var(--kodety-warning)]' },
  completed: { label: 'Concluído', className: 'text-[var(--kodety-accent)]' },
};

const DEFAULT_AB_TEST_OPTIONS: HtmlExperimentOptions = {
  trafficPercent: 100,
  allocationMode: 'manual',
  deliveryMode: 'redirect',
  stickyDays: 180,
  audience: { device: 'all', visitor: 'all' },
  autoStop: {},
};

const AB_SURFACE_CLASS = 'rounded-[9px] border border-white/[.055] bg-white/[.018]';
const AB_CONTROL_CLASS = 'h-9 w-full min-w-0 rounded-[9px] border-transparent bg-white/[.05] text-[11px] shadow-none hover:bg-white/[.067] focus-visible:border-[var(--kodety-focus)] focus-visible:ring-0';
const AB_LABEL_CLASS = 'text-[10px] font-medium text-[var(--kodety-text-secondary)]';
const AB_INFO_CLASS = 'text-balance text-[9px] leading-4 text-[var(--kodety-info-copy)]';
const AB_META_CHIP_CLASS = 'inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-full bg-white/[.045] px-2 text-[8px] font-medium text-[var(--kodety-text-tertiary)]';

export function abGoalTargetType(target: AnalyticsTrackingTarget): AnalyticsTargetSelectorType {
  return target.selectorType === 'class' ? 'class' : 'id';
}

export function abGoalTargetValue(target: AnalyticsTrackingTarget): string {
  return target.selectorValue?.trim() || target.id;
}

function normalizeTargetSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

/** Pure filtering contract shared by both create and edit pickers. */
export function filterAbGoalTargets(
  targets: AnalyticsTrackingTarget[],
  selectorType: AnalyticsTargetSelectorType,
  query = '',
) {
  const normalizedQuery = normalizeTargetSearch(query);
  return targets.filter(target => {
    if (
      target.type !== 'click'
      || target.enabled === false
      || !target.selectorType
      || abGoalTargetType(target) !== selectorType
    ) return false;
    if (!normalizedQuery) return true;
    return normalizeTargetSearch([
      target.label,
      target.id,
      abGoalTargetValue(target),
      target.pagePath || '',
    ].join(' ')).includes(normalizedQuery);
  });
}

function finiteWeight(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value * 100) / 100)) : 0;
}

/** Confidence at/above which a result is treated as statistically significant. */
export const AB_SIGNIFICANCE_THRESHOLD = 95;
/** Minimum views per compared variant before a verdict is trustworthy. */
export const AB_MIN_SAMPLE = 100;

export type AbTestVerdict = 'no-data' | 'insufficient' | 'leading' | 'significant';

export interface AbTestSummary {
  totalViews: number;
  totalConversions: number;
  control: HtmlAbVariantViewModel | null;
  leader: HtmlAbVariantViewModel | null;
  /** Relative change in conversion rate of the leader vs Control, in percent. */
  uplift: number | null;
  /** Leader confidence against Control, in percent. */
  confidence: number | null;
  verdict: AbTestVerdict;
}

/**
 * Synthesize the per-variant metrics into one actionable verdict: who leads,
 * by how much, how confident we are, and whether there is enough data to trust
 * it. Pure and deterministic so it can be unit-tested and rendered anywhere.
 */
export function summarizeAbTest(test: HtmlAbTestViewModel): AbTestSummary {
  const control = test.variants.find(variant => variant.isControl) || null;
  const rate = (variant: HtmlAbVariantViewModel | null): number | null =>
    variant?.metrics?.conversionRate ?? null;
  const views = (variant: HtmlAbVariantViewModel | null): number =>
    variant?.metrics?.views ?? 0;
  const totalViews = test.variants.reduce((sum, variant) => sum + views(variant), 0);
  const totalConversions = test.variants.reduce((sum, variant) => sum + (variant.metrics?.conversions ?? 0), 0);

  // Leader = highest conversion rate among variants that received traffic.
  const contenders = test.variants.filter(variant => views(variant) > 0 && rate(variant) !== null);
  const leader = contenders.reduce<HtmlAbVariantViewModel | null>((best, variant) => {
    if (!best) return variant;
    return (rate(variant) ?? 0) > (rate(best) ?? 0) ? variant : best;
  }, null);

  const controlRate = rate(control);
  const leaderRate = rate(leader);
  const uplift = leader && control && !leader.isControl && controlRate !== null && controlRate > 0 && leaderRate !== null
    ? ((leaderRate - controlRate) / controlRate) * 100
    : null;
  const confidence = leader && !leader.isControl ? leader.metrics?.confidence ?? null : null;

  let verdict: AbTestVerdict = 'no-data';
  if (totalViews > 0 && leader) {
    const enoughData = leader.isControl
      ? views(leader) >= AB_MIN_SAMPLE
      : views(leader) >= AB_MIN_SAMPLE && views(control) >= AB_MIN_SAMPLE;
    if (!enoughData) verdict = 'insufficient';
    else if (!leader.isControl && confidence !== null && confidence >= AB_SIGNIFICANCE_THRESHOLD) verdict = 'significant';
    else verdict = 'leading';
  }

  return { totalViews, totalConversions, control, leader, uplift, confidence, verdict };
}

export function abTestEnabledWeight(test: HtmlAbTestViewModel) {
  return Math.round(test.variants.filter(variant => variant.enabled).reduce((sum, variant) => sum + finiteWeight(variant.weight), 0) * 100) / 100;
}

export function validateAbTestForStart(test: HtmlAbTestViewModel): string | null {
  if (!test.goalTrackingId.trim()) return 'Selecione um ID ou classe para a conversão.';
  const enabled = test.variants.filter(variant => variant.enabled);
  const enabledControls = enabled.filter(variant => variant.isControl);
  if (enabledControls.length !== 1) return 'Mantenha exatamente uma variante Control ativa.';
  if (enabled.length < 2) return 'Ative pelo menos duas variantes.';
  if (enabled.some(variant => finiteWeight(variant.weight) <= 0)) return 'Toda variante ativa precisa receber tráfego.';
  if (Math.abs(abTestEnabledWeight(test) - 100) > .01) return 'A distribuição das variantes ativas precisa totalizar 100%.';
  return null;
}

export function equalAbVariantWeights(test: HtmlAbTestViewModel): Record<string, number> {
  const enabled = test.variants.filter(variant => variant.enabled);
  if (!enabled.length) return {};
  const base = Math.floor((100 / enabled.length) * 100) / 100;
  let assigned = 0;
  return Object.fromEntries(enabled.map((variant, index) => {
    const weight = index === enabled.length - 1 ? Math.round((100 - assigned) * 100) / 100 : base;
    assigned += weight;
    return [variant.id, weight];
  }));
}

export function abVariantPublicUrl(siteUrl: string | undefined, slug: string) {
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, '');
  const suffix = cleanSlug ? `/${cleanSlug}` : '/';
  const base = siteUrl?.trim();
  if (!base) return suffix;
  try {
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${suffix}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return `${base.replace(/\/+$/, '')}${suffix}`;
  }
}

function GoalTargetPicker({
  targets,
  targetType,
  trackingId,
  targetValue,
  disabled = false,
  onTargetTypeChange,
  onSelect,
}: {
  targets: AnalyticsTrackingTarget[];
  targetType: AnalyticsTargetSelectorType;
  trackingId: string;
  targetValue: string;
  disabled?: boolean;
  onTargetTypeChange: (type: AnalyticsTargetSelectorType) => void;
  onSelect: (target: AnalyticsTrackingTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => filterAbGoalTargets(targets, targetType, query),
    [query, targetType, targets],
  );
  useEffect(() => setQuery(''), [targetType]);
  const selectedValue = targetValue?.trim() || '';
  return (
    <div className="w-full overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.018]">
      <div className="grid gap-2 p-2 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex items-center gap-0.5 rounded-[8px] bg-black/[.12] p-1">
          {(['id', 'class'] as const).map(type => (
            <Button
              key={type}
              type="button"
              size="xs"
              variant={targetType === type ? 'secondary' : 'ghost'}
              aria-pressed={targetType === type}
              disabled={disabled}
              className={cn(
                'h-7 flex-1 rounded-[6px] border-0 text-[10px] shadow-none',
                targetType === type
                  ? 'bg-white/[.11] text-white hover:bg-white/[.13]'
                  : 'bg-transparent text-[var(--kodety-text-tertiary)] hover:bg-white/[.05] hover:text-white',
              )}
              onClick={() => onTargetTypeChange(type)}
            >
              {type === 'id' ? 'ID' : 'Classe'}
            </Button>
          ))}
        </div>
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-white/30" />
          <Input
            type="search"
            value={query}
            disabled={disabled}
            disableKeyboardStep
            onChange={event => setQuery(event.target.value)}
            aria-label={`Buscar por ${targetType === 'id' ? 'ID' : 'classe'}`}
            placeholder={targetType === 'id' ? 'Buscar IDs…' : 'Buscar classes…'}
            className={cn(AB_CONTROL_CLASS, 'pl-9 pr-3 text-[10px]')}
          />
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto border-t border-white/[.045] p-1.5" role="listbox" aria-label={targetType === 'id' ? 'IDs disponíveis' : 'Classes disponíveis'}>
        {filtered.map(target => {
          const selectorValue = abGoalTargetValue(target);
          const selectorType = abGoalTargetType(target);
          const key = `${selectorType}:${selectorValue}:${target.id}`;
          const selected = selectorType === targetType
            && selectorValue === selectedValue
            && (
              target.id === trackingId
              || `${selectorType}:${selectorValue}` === trackingId
              || !trackingId
            );
          const count = typeof target.matchCount === 'number' && Number.isFinite(target.matchCount)
            ? Math.max(0, Math.floor(target.matchCount))
            : null;
          return (
            <button
              key={`${target.pagePath || '*'}:${key}`}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => onSelect(target)}
              className={cn(
                'flex min-h-10 w-full items-center gap-2.5 rounded-[8px] border border-transparent px-2.5 text-left outline-none transition-colors focus-visible:border-[var(--kodety-focus)] disabled:opacity-50',
                selected ? 'bg-white/[.085]' : 'hover:bg-white/[.045]',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-medium text-[var(--kodety-text-secondary)]">{target.label}</span>
                <span className="mt-0.5 block truncate font-mono text-[8px] text-[var(--kodety-info-copy)]">
                  {targetType === 'id' ? '#' : '.'}{selectorValue}
                  {count !== null ? ` · ${count} ${count === 1 ? 'elemento' : 'elementos'}` : ''}
                </span>
              </span>
              {selected && <Check className="size-3 shrink-0 text-white/70" aria-hidden="true" />}
            </button>
          );
        })}
        {!filtered.length && (
          <p className="px-2 py-6 text-center text-[9px] text-[var(--kodety-info-copy)]">
            Nenhum {targetType === 'id' ? 'ID' : 'classe'} encontrado.
          </p>
        )}
      </div>
    </div>
  );
}

function formatMetric(value: number | null | undefined, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${getAdminNumberFormatter({ maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function statusTime(test: HtmlAbTestViewModel) {
  const source = test.status === 'completed' ? test.completedAt : test.status === 'running' || test.status === 'paused' ? test.startedAt : test.createdAt;
  if (!source) return '';
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? '' : getAdminDateTimeFormatter({ day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}

function EmptyTests({ onCreate }: { onCreate?: () => void }) {
  return (
    <AnalyticsEmptyState
      icon={FlaskConical}
      title="Crie seu primeiro teste A/B"
      description="Compare versões reais da página e acompanhe conversão, confiança e distribuição de tráfego em um só lugar."
      action={onCreate ? <Button size="sm" onClick={onCreate}><Plus />Novo teste</Button> : undefined}
      className="h-full min-h-[440px]"
    />
  );
}

function NewTestForm({
  pages,
  trackingTargets,
  saving,
  persistenceAvailable,
  onCancel,
  onCreate,
}: {
  pages: AnalyticsPageOption[];
  trackingTargets: AnalyticsTrackingTarget[];
  saving: boolean;
  persistenceAvailable: boolean;
  onCancel: () => void;
  onCreate: (input: HtmlAbTestCreateInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [sourcePagePath, setSourcePagePath] = useState(pages[0]?.path || '');
  const [goalTrackingId, setGoalTrackingId] = useState('');
  const [goalTargetType, setGoalTargetType] = useState<AnalyticsTargetSelectorType>('id');
  const [goalTargetValue, setGoalTargetValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedPage = pages.find(page => page.path === sourcePagePath);
  const availableTargets = trackingTargets.filter(target =>
    target.enabled !== false
    && (!selectedPage?.runtimePath || !target.pagePath || target.pagePath === selectedPage.runtimePath),
  );
  const submit = async () => {
    if (!name.trim()) {
      setError('Informe o nome do teste.');
      return;
    }
    if (!sourcePagePath) {
      setError('Selecione a página original.');
      return;
    }
    if (!goalTrackingId || !goalTargetValue) {
      setError('Selecione um ID ou classe para a conversão.');
      return;
    }
    setError(null);
    await onCreate({
      name: name.trim(),
      sourcePagePath,
      goalTrackingId,
      goalTargetType,
      goalTargetValue,
    });
  };
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-7 sm:px-7 lg:px-9">
      <AnalyticsPageHeader
        icon={FlaskConical}
        title="Novo teste A/B"
        description="Escolha a página original e o evento de conversão."
      />
      <AnalyticsSurface className={cn(AB_SURFACE_CLASS, 'mt-5')}>
        <div className="grid gap-5 p-5 sm:p-6">
        <div className="space-y-2">
          <Label className={AB_LABEL_CLASS}>Nome do teste</Label>
          <Input autoFocus value={name} onChange={event => setName(event.target.value)} className={AB_CONTROL_CLASS} placeholder="Homepage — headline" />
        </div>
        <div className="space-y-2">
          <Label className={AB_LABEL_CLASS}>Página original</Label>
          <Select value={sourcePagePath} onValueChange={(value) => {
            setSourcePagePath(value);
            const page = pages.find(candidate => candidate.path === value);
            const targetStillAvailable = trackingTargets.some(target =>
              target.id === goalTrackingId
              && abGoalTargetType(target) === goalTargetType
              && abGoalTargetValue(target) === goalTargetValue
              && (!page?.runtimePath || !target.pagePath || target.pagePath === page.runtimePath),
            );
            if (!targetStillAvailable) {
              setGoalTrackingId('');
              setGoalTargetValue('');
            }
          }}>
            <SelectTrigger className={AB_CONTROL_CLASS} aria-label="Página do teste"><SelectValue placeholder="Selecione uma página" /></SelectTrigger>
            <SelectContent>{pages.map(page => <SelectItem key={page.path} value={page.path}>{page.label}</SelectItem>)}</SelectContent>
          </Select>
          {!pages.length && <p className="text-[9px] text-[var(--kodety-warning)]">O projeto aberto não forneceu páginas.</p>}
        </div>
        <div className="space-y-2 border-t border-white/[.055] pt-5">
          <div>
            <Label className={AB_LABEL_CLASS}>Elemento de conversão</Label>
            <p className="mt-1 text-[9px] text-[var(--kodety-info-copy)]">Selecione o ID ou a classe acionada quando o objetivo for concluído.</p>
          </div>
          <GoalTargetPicker
            targets={availableTargets}
            targetType={goalTargetType}
            trackingId={goalTrackingId}
            targetValue={goalTargetValue}
            disabled={saving}
            onTargetTypeChange={type => {
              setGoalTargetType(type);
              setGoalTrackingId('');
              setGoalTargetValue('');
            }}
            onSelect={target => {
              setGoalTrackingId(target.id);
              setGoalTargetType(abGoalTargetType(target));
              setGoalTargetValue(abGoalTargetValue(target));
            }}
          />
          <p className={AB_INFO_CLASS}>
            A conversão é registrada quando o visitante aciona o {goalTargetType === 'id' ? 'ID' : 'elemento com a classe'} selecionado.
          </p>
        </div>
        {error && <p role="alert" className="rounded-[8px] border border-[var(--kodety-danger)]/25 bg-[var(--kodety-danger)]/[.055] px-3 py-2.5 text-[9px] text-[var(--kodety-info-copy)]">{error}</p>}
        {!persistenceAvailable && <p className="rounded-[8px] border border-[var(--kodety-warning)]/25 bg-[var(--kodety-warning)]/[.045] px-3 py-2.5 text-[9px] text-[var(--kodety-info-copy)]">Conecte `onCreateTest` para persistir experimentos.</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/[.055] px-5 py-4 sm:px-6">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" disabled={saving || !persistenceAvailable} onClick={submit}>{saving ? <Loader2 className="animate-spin" /> : <Plus />}Criar teste</Button>
        </footer>
      </AnalyticsSurface>
    </div>
  );
}

function VariantMetrics({ variant, isWinner }: { variant: HtmlAbVariantViewModel; isWinner: boolean }) {
  const metrics = variant.metrics;
  return (
    <div className="grid grid-cols-2 gap-px bg-white/[.055] sm:grid-cols-5">
      {[
        ['Visualizações', formatMetric(metrics?.views)],
        ['Conversões', formatMetric(metrics?.conversions)],
        ['Conversão', formatMetric(metrics?.conversionRate, '%')],
        ['Lift', formatMetric(metrics?.lift, '%')],
        ['Confiança', formatMetric(metrics?.confidence, '%')],
      ].map(([label, value]) => (
        <div key={label} className="min-w-0 bg-[var(--kodety-panel)] px-3.5 py-3">
          <span className="block truncate text-[8px] font-medium text-[var(--kodety-text-tertiary)]">{label}</span>
          <strong className="mt-1 block truncate text-[14px] font-semibold tracking-[-.02em] tabular-nums text-[var(--kodety-text)]">{value}</strong>
        </div>
      ))}
      {isWinner && <span className="col-span-full flex items-center gap-1.5 border-t border-white/[.055] px-3 py-2 text-[9px] font-semibold text-[var(--kodety-success)]"><Trophy className="size-3" />Vencedora promovida</span>}
    </div>
  );
}

function TestResultsSummary({ test, onPromoteWinner }: { test: HtmlAbTestViewModel; onPromoteWinner?: (variantId: string) => void }) {
  const summary = summarizeAbTest(test);
  if (summary.verdict === 'no-data') return null;
  const compact = (value: number) => getAdminNumberFormatter({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  const leaderName = summary.leader?.name ?? '';
  const leaderIsControl = Boolean(summary.leader?.isControl);
  const upliftText = summary.uplift !== null ? ` · ${signed(summary.uplift)} vs Control` : '';
  let headline: string;
  let detail: string;
  let tone: 'success' | 'accent' | 'muted';
  if (summary.verdict === 'insufficient') {
    tone = 'muted';
    headline = 'Colete mais dados';
    detail = `Amostra insuficiente para uma conclusão confiável (mín. ${AB_MIN_SAMPLE} visualizações por variante).`;
  } else if (leaderIsControl) {
    tone = 'muted';
    headline = 'Control ainda lidera';
    detail = 'Nenhuma variante superou o Control no período.';
  } else if (summary.verdict === 'significant') {
    tone = 'success';
    headline = `${leaderName} venceu`;
    detail = `${(summary.confidence ?? 0).toFixed(0)}% de confiança${upliftText}.`;
  } else {
    tone = 'accent';
    headline = `${leaderName} lidera`;
    detail = `${summary.confidence !== null ? `${summary.confidence.toFixed(0)}% de confiança` : 'Sem significância estatística ainda'}${upliftText}.`;
  }
  const toneClass = tone === 'success'
    ? 'text-[var(--kodety-success)]'
    : tone === 'accent'
      ? 'text-[var(--kodety-accent-hover)]'
      : 'text-white/36';
  const canPromote = summary.verdict === 'significant'
    && !leaderIsControl
    && summary.leader
    && onPromoteWinner
    && test.status !== 'completed'
    && test.winnerVariantId !== summary.leader.id;
  return (
    <AnalyticsSurface className={cn(AB_SURFACE_CLASS, 'mt-5 flex flex-col gap-4 p-4 sm:flex-row sm:items-center')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.05]', toneClass)}>
          {tone === 'success' ? <Trophy className="size-4" /> : <Gauge className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[var(--kodety-text)]">{headline}</p>
          <p className="mt-0.5 text-[9px] leading-4 text-[var(--kodety-info-copy)]">{detail}</p>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <div className="text-right"><p className="text-[8px] uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">Participantes</p><p className="mt-0.5 text-[14px] font-semibold tabular-nums text-[var(--kodety-text)]">{compact(summary.totalViews)}</p></div>
        <div className="text-right"><p className="text-[8px] uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">Conversões</p><p className="mt-0.5 text-[14px] font-semibold tabular-nums text-[var(--kodety-text)]">{compact(summary.totalConversions)}</p></div>
        {canPromote && summary.leader && (
          <Button size="xs" onClick={() => onPromoteWinner?.(summary.leader!.id)}><Trophy />Promover</Button>
        )}
      </div>
    </AnalyticsSurface>
  );
}

function CommitNumberField({
  value,
  min,
  max,
  suffix,
  disabled,
  label,
  onCommit,
}: {
  value?: number;
  min: number;
  max: number;
  suffix?: string;
  disabled?: boolean;
  label: string;
  onCommit: (value?: number) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    if (!text.trim()) {
      setText('');
      onCommit(undefined);
      return;
    }
    const parsed = Number(text.replace(',', '.'));
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
    setText(next === undefined ? '' : String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <div className="relative w-full">
      <Input
        value={text}
        inputMode="numeric"
        disabled={disabled}
        aria-label={label}
        onChange={event => {
          if (/^\d*$/.test(event.target.value)) setText(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setText(value === undefined ? '' : String(value));
            event.currentTarget.blur();
          }
        }}
        className={cn(AB_CONTROL_CLASS, 'tabular-nums', suffix && 'pr-10')}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--kodety-text-disabled)]">{suffix}</span>}
    </div>
  );
}

type AudienceChoice<T extends string> = {
  value: T;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  descriptionClassName?: string;
};

function AudienceChoiceGroup<T extends string>({
  label,
  value,
  choices,
  columnsClassName,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  choices: Array<AudienceChoice<T>>;
  columnsClassName?: string;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className={cn(AB_LABEL_CLASS, 'mb-2 block')}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          'grid gap-1 rounded-[9px] border border-white/[.05] bg-black/[.1] p-1',
          columnsClassName || 'grid-cols-3',
        )}
      >
        {choices.map(choice => {
          const Icon = choice.icon;
          const selected = choice.value === value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              className={cn(
                'flex h-fit min-h-11 min-w-0 flex-col items-start justify-center rounded-[7px] border px-2.5 py-2 text-left outline-none transition-[border-color,background-color,color] focus-visible:border-[var(--kodety-focus)] disabled:cursor-not-allowed disabled:opacity-45',
                selected
                  ? 'border-white/[.09] bg-white/[.09] text-[var(--kodety-text)]'
                  : 'border-transparent text-[var(--kodety-text-tertiary)] hover:bg-white/[.04] hover:text-[var(--kodety-text-secondary)]',
              )}
              onClick={() => onChange(choice.value)}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[9px] font-medium">
                <Icon className={cn('size-3.5 shrink-0', selected ? 'text-white/62' : 'text-white/28')} />
                <span className="truncate">{choice.label}</span>
              </span>
              <span className={cn(
                'mt-1 line-clamp-2 text-[8px] leading-3 text-[var(--kodety-info-copy)]',
                choice.descriptionClassName,
              )}>
                {choice.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AudienceRuleField({
  label,
  hint,
  icon: Icon,
  defaultValue,
  placeholder,
  disabled,
  onCommit,
  className,
}: {
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  defaultValue: string;
  placeholder: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className={cn(AB_LABEL_CLASS, 'mb-2 block')}>{label}</span>
      <span className="relative block">
        <Icon className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-white/28" />
        <Input
          defaultValue={defaultValue}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(AB_CONTROL_CLASS, 'pl-9')}
          onBlur={event => onCommit(event.currentTarget.value.trim())}
        />
      </span>
      <span className="mt-1.5 block text-[8px] leading-3.5 text-[var(--kodety-info-copy)]">{hint}</span>
    </label>
  );
}

function ExperimentControls({
  test,
  saving,
  onChange,
}: {
  test: HtmlAbTestViewModel;
  saving: boolean;
  onChange?: (options: Partial<HtmlExperimentOptions>) => void;
}) {
  const mutable = test.status !== 'completed' && Boolean(onChange);
  const options = test.options || DEFAULT_AB_TEST_OPTIONS;
  const audience = options.audience;
  const autoStop = options.autoStop;
  const patchAudience = (patch: Partial<HtmlExperimentOptions['audience']>) => {
    onChange?.({ audience: { ...audience, ...patch } });
  };
  const patchAutoStop = (patch: Partial<HtmlExperimentOptions['autoStop']>) => {
    onChange?.({ autoStop: { ...autoStop, ...patch } });
  };
  const endAtValue = autoStop.endAt ? autoStop.endAt.slice(0, 16) : '';
  return (
    <section data-kodety-onboarding="analytics-ab-delivery" className="border-b border-[var(--kodety-divider)] py-6">
      <AnalyticsSectionHeader
        icon={SlidersHorizontal}
        title="Distribuição e entrega"
        description="Defina participação, divisão do tráfego, entrega e persistência."
        className="mb-3"
      />

      <AnalyticsSurface className={cn(AB_SURFACE_CLASS, 'grid divide-y divide-white/[.055] md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4')}>
        <label className="block p-4">
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[var(--kodety-text-secondary)]"><Gauge className="size-3.5 text-white/38" />Participação</span>
          <CommitNumberField
            value={options.trafficPercent}
            min={1}
            max={100}
            suffix="%"
            label="Porcentagem de visitantes no teste"
            disabled={!mutable || saving}
            onCommit={value => value !== undefined && onChange?.({ trafficPercent: value })}
          />
          <span className={cn('mt-2 block', AB_INFO_CLASS)}>O restante vê a página original.</span>
        </label>
        <label className="block p-4">
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[var(--kodety-text-secondary)]"><Zap className="size-3.5 text-white/38" />Distribuição</span>
          <Select
            value={options.allocationMode}
            disabled={!mutable || saving}
            onValueChange={value => onChange?.({
              allocationMode: value as HtmlExperimentOptions['allocationMode'],
            })}
          >
            <SelectTrigger className={AB_CONTROL_CLASS}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="equal">Igual entre variantes</SelectItem>
              <SelectItem value="adaptive">Automática por conversão</SelectItem>
            </SelectContent>
          </Select>
          <span className={cn('mt-2 block', AB_INFO_CLASS)}>
            {options.allocationMode === 'adaptive'
              ? 'Aprende com as conversões e mantém tráfego de exploração.'
              : options.allocationMode === 'equal'
                ? 'Cada variante ativa recebe a mesma parcela.'
                : 'Você controla a porcentagem de cada variante.'}
          </span>
        </label>
        <label className="block p-4">
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[var(--kodety-text-secondary)]"><Route className="size-3.5 text-white/38" />Entrega</span>
          <Select
            value={options.deliveryMode}
            disabled={!mutable || saving}
            onValueChange={value => onChange?.({
              deliveryMode: value as HtmlExperimentOptions['deliveryMode'],
            })}
          >
            <SelectTrigger className={AB_CONTROL_CLASS}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="redirect">Redirecionar automaticamente</SelectItem>
              <SelectItem value="server">Manter URL original</SelectItem>
            </SelectContent>
          </Select>
          <span className={cn('mt-2 block', AB_INFO_CLASS)}>
            {options.deliveryMode === 'redirect'
              ? 'A variante usa sua URL pública e um redirecionamento 302.'
              : 'O servidor troca o conteúdo sem alterar a URL no navegador.'}
          </span>
        </label>
        <label className="block p-4">
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[var(--kodety-text-secondary)]"><Users className="size-3.5 text-white/38" />Persistência</span>
          <CommitNumberField
            value={options.stickyDays}
            min={1}
            max={365}
            suffix="dias"
            label="Dias de persistência da variante"
            disabled={!mutable || saving}
            onCommit={value => value !== undefined && onChange?.({ stickyDays: value })}
          />
          <span className={cn('mt-2 block', AB_INFO_CLASS)}>Mantém a variante do visitante.</span>
        </label>
      </AnalyticsSurface>

      <details className={cn(AB_SURFACE_CLASS, 'group mt-3 overflow-hidden')}>
        <DisclosureSummary data-kodety-onboarding="analytics-ab-audience-disclosure" data-kodety-onboarding-reveal data-kodety-onboarding-toggle className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 text-[10px] font-medium text-[var(--kodety-text-secondary)] outline-none focus-visible:border-[var(--kodety-focus)]">
          Audiência e encerramento
          {(audience.device !== 'all' || audience.visitor !== 'all' || audience.queryParameter || audience.referrerHost || autoStop.endAt || autoStop.maxExposures) && (
            <span className="ml-auto rounded-full bg-white/[.085] px-2 py-0.5 text-[8px] text-[var(--kodety-text-secondary)]">Regras ativas</span>
          )}
        </DisclosureSummary>
        <div className="grid border-t border-white/[.055] xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,.8fr)] xl:divide-x xl:divide-white/[.055]">
          <section data-kodety-onboarding="analytics-ab-audience" className="min-w-0 p-4 sm:p-5">
            <header className="mb-4 flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/35">
                <Users className="size-3.5" />
              </span>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-[10px] font-medium text-[var(--kodety-text-secondary)]">Quem participa</h3>
                <p className="mt-1 text-[9px] leading-4 text-[var(--kodety-info-copy)]">Combine perfil e origem para definir quem pode entrar no teste.</p>
              </div>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <AudienceChoiceGroup
                label="Dispositivo"
                value={audience.device}
                disabled={!mutable || saving}
                choices={[
                  { value: 'all', label: 'Todos', description: 'Qualquer tela', icon: Monitor },
                  { value: 'desktop', label: 'Desktop', description: 'Computadores', icon: Laptop },
                  { value: 'mobile', label: 'Mobile', description: 'Celular e tablet', icon: Smartphone },
                ]}
                onChange={device => patchAudience({ device })}
              />
              <AudienceChoiceGroup
                label="Visitante"
                value={audience.visitor}
                disabled={!mutable || saving}
                columnsClassName="grid-cols-[1.16fr_.84fr_1fr]"
                choices={[
                  {
                    value: 'all',
                    label: 'Todos',
                    description: 'Novos e recorrentes',
                    descriptionClassName: 'whitespace-nowrap',
                    icon: Users,
                  },
                  { value: 'new', label: 'Novos', description: 'Primeira visita', icon: CircleUserRound },
                  { value: 'returning', label: 'Recorrentes', description: 'Já visitaram', icon: Clock3 },
                ]}
                onChange={visitor => patchAudience({ visitor })}
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <AudienceRuleField
                key={`referrer-${test.id}-${audience.referrerHost ?? ''}`}
                label="Domínio de referência"
                hint="Restringe a origem do acesso; vazio aceita qualquer site."
                icon={Globe2}
                defaultValue={audience.referrerHost ?? ''}
                placeholder="ex.: google.com"
                disabled={!mutable || saving}
                onCommit={value => patchAudience({ referrerHost: value || undefined })}
                className="sm:col-span-2"
              />
              <AudienceRuleField
                key={`query-${test.id}-${audience.queryParameter ?? ''}`}
                label="Parâmetro da campanha"
                hint="Nome do parâmetro presente na URL."
                icon={Link2}
                defaultValue={audience.queryParameter ?? ''}
                placeholder="ex.: utm_campaign"
                disabled={!mutable || saving}
                onCommit={value => patchAudience({ queryParameter: value || undefined })}
              />
              <AudienceRuleField
                key={`query-value-${test.id}-${audience.queryValue ?? ''}`}
                label="Valor esperado"
                hint="Deixe vazio para aceitar qualquer valor."
                icon={Search}
                defaultValue={audience.queryValue ?? ''}
                placeholder="ex.: lançamento"
                disabled={!mutable || saving || !audience.queryParameter}
                onCommit={value => patchAudience({ queryValue: value || undefined })}
              />
            </div>
          </section>

          <section data-kodety-onboarding="analytics-ab-stop" className="min-w-0 border-t border-white/[.055] p-4 sm:p-5 xl:border-t-0">
            <header className="mb-4 flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/35">
                <Clock3 className="size-3.5" />
              </span>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-[10px] font-medium text-[var(--kodety-text-secondary)]">Encerramento automático</h3>
                <p className="mt-1 text-[9px] leading-4 text-[var(--kodety-info-copy)]">Finalize por data, volume de exposição ou pela primeira regra atingida.</p>
              </div>
            </header>

            <div className="grid gap-4">
              <div>
                <span className={cn(AB_LABEL_CLASS, 'mb-2 block')}>Data e hora</span>
                <HtmlDatePicker
                  label="Encerrar teste em"
                  includeTime
                  value={endAtValue}
                  disabled={!mutable || saving}
                  onChange={value => patchAutoStop({
                    endAt: value ? new Date(value).toISOString() : undefined,
                  })}
                />
                <span className="mt-1.5 block text-[8px] leading-3.5 text-[var(--kodety-info-copy)]">O teste para automaticamente neste horário.</span>
              </div>
              <div>
                <span className={cn(AB_LABEL_CLASS, 'mb-2 block')}>Limite de exposições</span>
                <CommitNumberField
                  value={autoStop.maxExposures}
                  min={1}
                  max={10_000_000}
                  label="Limite de exposições"
                  disabled={!mutable || saving}
                  onCommit={value => patchAutoStop({ maxExposures: value })}
                />
                <span className="mt-1.5 block text-[8px] leading-3.5 text-[var(--kodety-info-copy)]">Cada entrada elegível contabiliza uma exposição.</span>
              </div>
              {!autoStop.endAt && !autoStop.maxExposures && (
                <p className="rounded-[8px] border border-white/[.05] bg-black/[.1] px-3 py-2.5 text-[8px] leading-3.5 text-[var(--kodety-info-copy)]">
                  Sem regra automática. O teste continua até ser concluído manualmente.
                </p>
              )}
            </div>
          </section>
        </div>
      </details>
    </section>
  );
}

function VariantRow({
  test,
  variant,
  siteUrl,
  saving,
  onRename,
  onSlugChange,
  onToggle,
  onWeight,
  onOpen,
  onDuplicate,
  onRemove,
  onPromote,
  allocationMode,
}: {
  test: HtmlAbTestViewModel;
  variant: HtmlAbVariantViewModel;
  siteUrl?: string;
  saving: boolean;
  onRename?: (name: string) => void;
  onSlugChange?: (slug: string) => void;
  onToggle?: (enabled: boolean) => void;
  onWeight?: (weight: number) => void;
  onOpen?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  onPromote?: () => void;
  allocationMode: HtmlExperimentOptions['allocationMode'];
}) {
  const [name, setName] = useState(variant.name);
  const [slug, setSlug] = useState(variant.slug ?? variant.id);
  const [weightText, setWeightText] = useState(String(finiteWeight(variant.weight)));
  useEffect(() => setName(variant.name), [variant.name]);
  useEffect(() => setSlug(variant.slug ?? variant.id), [variant.slug, variant.id]);
  useEffect(() => setWeightText(String(finiteWeight(variant.weight))), [variant.weight]);
  const winner = test.winnerVariantId === variant.id;
  const mutable = test.status !== 'completed';
  const commitWeight = () => {
    const parsed = Number.parseFloat(weightText.replace(',', '.'));
    const next = finiteWeight(parsed);
    setWeightText(String(next));
    if (next !== finiteWeight(variant.weight)) onWeight?.(next);
  };
  const manualAllocation = allocationMode === 'manual';
  return (
    <article className={cn(AB_SURFACE_CLASS, 'overflow-hidden transition-colors', !variant.enabled && 'opacity-55')}>
      <header className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div data-ab-variant-identity className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] bg-white/[.045] text-white/36">
            <Route className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-4 items-center gap-1.5">
              <span className="text-[8px] font-medium uppercase tracking-[.1em] text-[var(--kodety-text-tertiary)]">
                {variant.isControl ? 'Página original' : 'Variante'}
              </span>
              {variant.isControl && <span className="shrink-0 rounded-full bg-white/[.075] px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-text-secondary)]">Control</span>}
              {winner && <span className="inline-flex items-center gap-1 text-[8px] font-medium text-[var(--kodety-success)]"><Trophy className="size-2.5" />Vencedora</span>}
            </div>
            <label className="group/title relative mt-0.5 block max-w-lg">
              <span className="sr-only">Nome da variante</span>
              <input
                aria-label={`Nome da variante ${variant.name}`}
                value={name}
                disabled={!mutable || !onRename}
                onChange={event => setName(event.target.value)}
                onBlur={() => {
                  const next = name.trim();
                  if (next && next !== variant.name) onRename?.(next);
                  else setName(variant.name);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    setName(variant.name);
                    event.currentTarget.blur();
                  }
                }}
                className="h-7 w-full min-w-0 border-0 border-b border-transparent bg-transparent p-0 pr-7 text-[12px] font-semibold tracking-[-.015em] text-[var(--kodety-text)] outline-none transition-colors hover:border-white/[.08] focus:border-[var(--kodety-focus)] disabled:cursor-default"
              />
              {mutable && onRename ? <Pencil className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-white/0 transition-colors group-hover/title:text-white/28 group-focus-within/title:text-white/38" /> : null}
            </label>
          {variant.isControl ? (
            <button
              data-ab-variant-address
              type="button"
              onClick={onOpen}
              disabled={!onOpen}
              className="mt-2 flex h-8 max-w-xl items-center overflow-hidden rounded-[8px] border border-white/[.05] bg-black/[.1] text-left text-[9px] text-[var(--kodety-info-copy)] outline-none transition-colors hover:border-white/[.08] hover:bg-white/[.025] hover:text-[var(--kodety-text-secondary)] focus-visible:border-[var(--kodety-focus)] disabled:pointer-events-none"
              title={test.sourcePagePath}
            >
              <span className="flex h-full shrink-0 items-center border-r border-white/[.05] px-2.5 text-[7px] font-medium uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">Origem</span>
              <Route className="ml-2.5 size-3 shrink-0 text-white/28" />
              <span className="min-w-0 flex-1 truncate px-2">{test.sourcePagePath}</span>
              {onOpen ? <span className="grid size-8 shrink-0 place-items-center border-l border-white/[.05] text-white/30"><ArrowUpRight className="size-2.5" /></span> : null}
            </button>
          ) : (
            <div data-ab-variant-address className="mt-2 flex h-8 min-w-0 max-w-xl items-center overflow-hidden rounded-[8px] border border-white/[.05] bg-black/[.1] text-[9px] text-[var(--kodety-info-copy)] transition-colors hover:border-white/[.08] focus-within:border-[var(--kodety-focus)] focus-within:bg-white/[.025]">
              <span className="flex h-full shrink-0 items-center border-r border-white/[.05] px-2.5 text-[7px] font-medium uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">URL</span>
              <Link2 className="ml-2.5 size-3 shrink-0 text-white/28" />
              <span className="select-none text-[var(--kodety-text-disabled)]">/</span>
              <input
                aria-label={`Link da variante ${variant.name}`}
                value={slug}
                disabled={!mutable || !onSlugChange}
                onChange={event => setSlug(event.target.value)}
                onBlur={() => {
                  const next = slug.trim();
                  if (next && next !== (variant.slug ?? variant.id)) onSlugChange?.(next);
                  else setSlug(variant.slug ?? variant.id);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    setSlug(variant.slug ?? variant.id);
                    event.currentTarget.blur();
                  }
                }}
                placeholder={variant.id}
                spellCheck={false}
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-1.5 font-mono text-[9px] text-[var(--kodety-text-secondary)] outline-none placeholder:text-[var(--kodety-text-disabled)] disabled:cursor-default"
              />
              {variant.deployedSlug !== undefined && variant.deployedSlug !== variant.slug && (
                <span className="mr-2 shrink-0 whitespace-nowrap rounded-full bg-[var(--kodety-warning)]/[.09] px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-[.06em] text-[var(--kodety-warning)]" title={`Publicada em /${variant.deployedSlug}. Publique para ativar /${variant.slug}.`}>Publicar</span>
              )}
              <a
                href={abVariantPublicUrl(siteUrl, variant.slug ?? variant.id)}
                target="_blank"
                rel="noreferrer"
                title="Abrir a URL pública da variante (após publicar)"
                aria-label={`Abrir a URL pública da variante ${variant.name}`}
                className="grid size-8 shrink-0 place-items-center border-l border-white/[.05] text-white/30 transition-colors hover:bg-white/[.045] hover:text-[var(--kodety-text-secondary)]"
              ><ArrowUpRight className="size-2.5" /></a>
            </div>
          )}
          </div>
        </div>
        <div className="flex w-full shrink-0 items-end gap-2 sm:w-auto">
          <div className="w-24">
            <span className="mb-1.5 block text-[8px] font-medium uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">
              {manualAllocation ? 'Tráfego' : allocationMode === 'equal' ? 'Igual' : 'Automático'}
            </span>
            <div className="relative">
              <Input
                type="text"
                inputMode="decimal"
                value={weightText}
                disabled={!mutable || !variant.enabled || !onWeight || !manualAllocation}
                onChange={event => {
                  const next = event.target.value;
                  if (/^\d{0,3}(?:[.,]\d{0,4})?$/.test(next)) setWeightText(next);
                }}
                onBlur={commitWeight}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    setWeightText(String(finiteWeight(variant.weight)));
                    event.currentTarget.blur();
                  }
                }}
                className={cn(AB_CONTROL_CLASS, 'pr-7 text-right tabular-nums')}
                aria-label={`Tráfego de ${variant.name}`}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--kodety-text-tertiary)]">%</span>
            </div>
          </div>
          <span className="grid h-9 place-items-center px-1.5">
            <Switch
              checked={variant.enabled}
              disabled={!mutable || !onToggle || saving || Boolean(variant.isControl && variant.enabled)}
              onCheckedChange={onToggle}
              aria-label={variant.isControl ? 'A variante Control deve permanecer ativa' : `Ativar ${variant.name}`}
              title={variant.isControl && variant.enabled ? 'A variante Control deve permanecer ativa' : undefined}
            />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button className="mb-0.5" variant="ghost" size="icon-xs" aria-label={`Ações de ${variant.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {onOpen && <DropdownMenuItem onClick={onOpen}><ArrowUpRight />Editar página</DropdownMenuItem>}
              {onDuplicate && <DropdownMenuItem onClick={onDuplicate}><Copy />Duplicar variante</DropdownMenuItem>}
              {test.status === 'completed' && onPromote && <DropdownMenuItem onClick={onPromote}><Trophy />Promover vencedora</DropdownMenuItem>}
              {onRemove && !variant.isControl && <><DropdownMenuSeparator /><DropdownMenuItem className="text-[var(--kodety-danger)]" onClick={onRemove}><Trash2 />Remover</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="border-t border-white/[.055]">
        <VariantMetrics variant={variant} isWinner={winner} />
      </div>
    </article>
  );
}

function LifecycleActions({
  test,
  saving,
  validationError,
  onStart,
  onPause,
  onResume,
  onComplete,
}: {
  test: HtmlAbTestViewModel;
  saving: boolean;
  validationError: string | null;
  onStart?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onComplete?: () => void;
}) {
  if (test.status === 'draft') return <Button size="xs" disabled={saving || Boolean(validationError) || !onStart} onClick={onStart}><Play />Iniciar teste</Button>;
  if (test.status === 'running') return <div className="flex gap-1.5"><Button variant="secondary" size="xs" disabled={saving || !onPause} onClick={onPause}><Pause />Pausar</Button><Button variant="ghost" size="xs" disabled={saving || !onComplete} onClick={onComplete}><Square />Concluir</Button></div>;
  if (test.status === 'paused') return <div className="flex gap-1.5"><Button size="xs" disabled={saving || Boolean(validationError) || !onResume} onClick={onResume}><Play />Retomar</Button><Button variant="ghost" size="xs" disabled={saving || !onComplete} onClick={onComplete}><Square />Concluir</Button></div>;
  return <span className="flex items-center gap-1.5 text-[9px] font-medium text-[var(--kodety-success)]"><Check className="size-3" />Resultados finalizados</span>;
}

function SelectedTest({
  test,
  pages,
  trackingTargets,
  siteUrl,
  saving,
  onRenameTest,
  onGoalChange,
  onOptionsChange,
  onDeleteTest,
  onCreateVariant,
  onDuplicateVariant,
  onRemoveVariant,
  onRenameVariant,
  onVariantSlugChange,
  onToggleVariant,
  onWeightChange,
  onEqualizeWeights,
  onStart,
  onPause,
  onResume,
  onComplete,
  onPromoteWinner,
  onOpenVariant,
}: {
  test: HtmlAbTestViewModel;
  pages: AnalyticsPageOption[];
  trackingTargets: AnalyticsTrackingTarget[];
  siteUrl?: string;
  saving: boolean;
} & Pick<HtmlAnalyticsAbTestsProps,
  'onRenameTest' | 'onGoalChange' | 'onOptionsChange' | 'onDeleteTest' | 'onCreateVariant' | 'onDuplicateVariant' | 'onRemoveVariant' |
  'onRenameVariant' | 'onVariantSlugChange' | 'onToggleVariant' | 'onWeightChange' | 'onEqualizeWeights' | 'onStart' | 'onPause' | 'onResume' |
  'onComplete' | 'onPromoteWinner' | 'onOpenVariant'>) {
  const [testName, setTestName] = useState(test.name);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const resolvedGoalTargetType: AnalyticsTargetSelectorType = test.goalTargetType === 'class' ? 'class' : 'id';
  const encodedGoalTarget = /^(id|class):(.+)$/.exec(test.goalTrackingId);
  const resolvedGoalTargetValue = test.goalTargetValue?.trim()
    || encodedGoalTarget?.[2]?.trim()
    || test.goalTrackingId;
  const [goalTargetType, setGoalTargetType] = useState<AnalyticsTargetSelectorType>(resolvedGoalTargetType);
  useEffect(() => {
    setTestName(test.name);
    setDeleteConfirm(false);
  }, [test.id, test.name]);
  useEffect(() => {
    setGoalTargetType(resolvedGoalTargetType);
  }, [resolvedGoalTargetType, test.id]);
  const enabledWeight = abTestEnabledWeight(test);
  const validationError = validateAbTestForStart(test);
  const equalWeights = () => {
    const weights = equalAbVariantWeights(test);
    if (onEqualizeWeights) onEqualizeWeights(test.id, weights);
    else Object.entries(weights).forEach(([variantId, weight]) => onWeightChange?.(test.id, variantId, weight));
  };
  const status = STATUS_COPY[test.status];
  const deployedStatus = test.deployedStatus ? STATUS_COPY[test.deployedStatus] : null;
  // A slug edited after the last publish is not live yet — its public URL still
  // 404s or points at the old value until the site is republished.
  const slugPublishPending = test.variants.some(
    variant => !variant.isControl && variant.deployedSlug !== undefined && variant.deployedSlug !== variant.slug,
  );
  const publishPending = !deployedStatus || test.deployedStatus !== test.status || slugPublishPending;
  const sourceVariant = test.variants.find(variant => variant.isControl) || test.variants[0];
  const options = test.options || DEFAULT_AB_TEST_OPTIONS;
  const sourcePage = pages.find(page => page.path === test.sourcePagePath);
  const testTrackingTargets = trackingTargets.filter(target =>
    target.enabled !== false
    && (!sourcePage?.runtimePath || !target.pagePath || target.pagePath === sourcePage.runtimePath),
  );
  return (
    <main className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[var(--kodety-panel)]">
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-12 pt-7 sm:px-7 lg:px-9">
        <header className="pb-5">
          <div className="flex w-full min-w-0 flex-col items-start">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/42">
              <FlaskConical className="size-4" />
            </span>
            <div className="mt-3 min-w-0 w-full flex-1">
              <Input
                variant="rename"
                value={testName}
                disabled={!onRenameTest || test.status === 'completed'}
                onChange={event => setTestName(event.target.value)}
                onBlur={() => {
                  const next = testName.trim();
                  if (next && next !== test.name) onRenameTest?.(test.id, next);
                  else setTestName(test.name);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    setTestName(test.name);
                    event.currentTarget.blur();
                  }
                }}
                aria-label="Nome do teste A/B"
                className="h-9 w-full rounded-[7px] border border-transparent bg-transparent px-2 text-[18px] font-semibold tracking-[-.025em] shadow-none hover:bg-white/[.035] focus-visible:border-[var(--kodety-focus)] focus-visible:bg-white/[.055] focus-visible:ring-0"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={cn(AB_META_CHIP_CLASS, status.className)}>
                  <span className="size-1.5 shrink-0 rounded-full bg-current" />
                  {status.label}
                </span>
                {publishPending && (
                  <span
                    className={cn(AB_META_CHIP_CLASS, 'text-[var(--kodety-warning)]')}
                    title={slugPublishPending && test.deployedStatus === test.status
                      ? 'Publique para ativar a nova URL da variante'
                      : deployedStatus
                        ? `Aguardando publicação · estado online: ${deployedStatus.label}`
                        : 'Aguardando publicação'}
                  >
                    <RefreshCw className="size-2.5 shrink-0" />
                    {slugPublishPending && test.deployedStatus === test.status
                      ? 'Nova URL pendente'
                      : 'Aguardando publicação'}
                  </span>
                )}
                <span className={AB_META_CHIP_CLASS} title={test.sourcePagePath}>
                  <Route className="size-2.5 shrink-0" />
                  <span className="max-w-48 truncate">{test.sourcePagePath}</span>
                </span>
                {statusTime(test) && (
                  <span className={AB_META_CHIP_CLASS}>
                    <Calendar className="size-2.5 shrink-0" />
                    {statusTime(test)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {deleteConfirm && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-[9px] border border-[var(--kodety-danger)]/25 bg-[var(--kodety-danger)]/[.05] px-3 py-2 text-[9px] text-[var(--kodety-info-copy)]"><span>Abra o menu novamente para confirmar a exclusão.</span><Button variant="ghost" size="xs" onClick={() => setDeleteConfirm(false)}>Cancelar</Button></div>}

        <TestResultsSummary test={test} onPromoteWinner={onPromoteWinner ? variantId => onPromoteWinner(test.id, variantId) : undefined} />


        <section data-kodety-onboarding="analytics-ab-goal" className="border-b border-[var(--kodety-divider)] py-6">
          <AnalyticsSurface className={cn(AB_SURFACE_CLASS, 'overflow-hidden')}>
            <div className="flex flex-wrap items-center gap-3 border-b border-white/[.055] px-4 py-4">
              <div className="flex min-w-[220px] flex-[1_1_320px] items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/38">
                  <Trophy className="size-3.5" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <h2 className="text-[10px] font-medium text-[var(--kodety-text-secondary)]">Objetivo</h2>
                  <p className="mt-1 max-w-2xl text-[9px] leading-4 text-[var(--kodety-info-copy)]">
                    Defina o ID ou a classe acionada quando o visitante conclui a conversão.
                  </p>
                </div>
              </div>
              <div data-ab-test-actions className="ml-auto flex min-w-0 flex-[1_1_360px] flex-wrap items-center justify-end gap-2">
                <div className="flex min-w-[180px] max-w-full flex-[1_1_210px] items-center gap-2 rounded-[8px] bg-black/[.12] px-2.5 py-2">
                  <span className="shrink-0 text-[8px] font-medium uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">Alvo atual</span>
                  <code className="min-w-0 flex-1 truncate text-[9px] font-medium text-[var(--kodety-text-secondary)]">
                    {resolvedGoalTargetValue
                      ? `${resolvedGoalTargetType === 'class' ? '.' : '#'}${resolvedGoalTargetValue}`
                      : 'Não selecionado'}
                  </code>
                </div>
                <LifecycleActions
                  test={test}
                  saving={saving}
                  validationError={validationError}
                  onStart={onStart ? () => onStart(test.id) : undefined}
                  onPause={onPause ? () => onPause(test.id) : undefined}
                  onResume={onResume ? () => onResume(test.id) : undefined}
                  onComplete={onComplete ? () => onComplete(test.id) : undefined}
                />
                {onDeleteTest && <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Mais ações do teste"><MoreHorizontal /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-[var(--kodety-danger)]" onClick={() => {
                      if (deleteConfirm) onDeleteTest(test.id);
                      else setDeleteConfirm(true);
                    }}><Trash2 />{deleteConfirm ? 'Confirmar exclusão' : 'Excluir teste'}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>}
              </div>
            </div>
            <div className="p-3">
              <GoalTargetPicker
                targets={testTrackingTargets}
                targetType={goalTargetType}
                trackingId={goalTargetType === resolvedGoalTargetType ? test.goalTrackingId : ''}
                targetValue={goalTargetType === resolvedGoalTargetType ? resolvedGoalTargetValue : ''}
                disabled={!onGoalChange || test.status === 'completed'}
                onTargetTypeChange={setGoalTargetType}
                onSelect={target => {
                  const targetType = abGoalTargetType(target);
                  const targetValue = abGoalTargetValue(target);
                  setGoalTargetType(targetType);
                  onGoalChange?.(test.id, target.id, targetType, targetValue);
                }}
              />
            </div>
          </AnalyticsSurface>
        </section>

        <ExperimentControls
          test={test}
          saving={saving}
          onChange={onOptionsChange ? options => onOptionsChange(test.id, options) : undefined}
        />

        <section data-kodety-onboarding="analytics-ab-variants" className="py-6">
          <header className="mb-3 flex min-h-11 flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-[11px] font-semibold text-[var(--kodety-text)]">Variantes</h2>
              <p className="mt-0.5 text-[9px] text-[var(--kodety-info-copy)]">
                {test.variants.filter(variant => variant.enabled).length} ativas · {formatMetric(options.trafficPercent, '%')} de participação
              </p>
            </div>
            {options.allocationMode === 'manual' && <Button className="ml-auto" variant="ghost" size="xs" disabled={test.status === 'completed' || !onEqualizeWeights && !onWeightChange} onClick={equalWeights}><RotateCcw />Distribuir igualmente</Button>}
            <Button
              className={cn(options.allocationMode !== 'manual' && 'ml-auto')}
              variant="secondary"
              size="xs"
              disabled={test.status === 'completed' || !sourceVariant || !onCreateVariant}
              onClick={() => sourceVariant && onCreateVariant?.(test.id, sourceVariant.id)}
            ><Plus />Adicionar variante</Button>
          </header>

          {validationError && test.status !== 'completed' && <p role="status" className="mb-3 rounded-[9px] border border-[var(--kodety-warning)]/25 bg-[var(--kodety-warning)]/[.045] px-3 py-2.5 text-[9px] text-[var(--kodety-info-copy)]">{validationError}</p>}

          <AnalyticsSurface className={cn(AB_SURFACE_CLASS, 'mb-3 grid overflow-hidden sm:grid-cols-3')}>
            <div className="p-3.5">
              <span className="block text-[8px] uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">Participação</span>
              <strong className="mt-1 block text-[10px] font-medium tabular-nums text-[var(--kodety-text)]">{formatMetric(options.trafficPercent, '%')}</strong>
            </div>
            <div className="border-t border-white/[.055] p-3.5 sm:border-l sm:border-t-0">
              <span className="block text-[8px] uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">Divisão</span>
              <strong className="mt-1 block text-[10px] font-medium text-[var(--kodety-text)]">
                {options.allocationMode === 'adaptive' ? 'Otimização automática' : options.allocationMode === 'equal' ? 'Partes iguais' : `${formatMetric(enabledWeight, '%')} alocado`}
              </strong>
            </div>
            <div className="border-t border-white/[.055] p-3.5 sm:border-l sm:border-t-0">
              <span className="block text-[8px] uppercase tracking-[.08em] text-[var(--kodety-text-tertiary)]">Entrega</span>
              <strong className="mt-1 block text-[10px] font-medium text-[var(--kodety-text)]">
                {options.deliveryMode === 'redirect' ? 'Redirecionamento 302' : 'Troca no servidor'}
              </strong>
            </div>
          </AnalyticsSurface>

          <div className="grid gap-2">
            {test.variants.map(variant => (
              <VariantRow
                key={variant.id}
                test={test}
                variant={variant}
                siteUrl={siteUrl}
                saving={saving}
                allocationMode={options.allocationMode}
                onRename={onRenameVariant ? name => onRenameVariant(test.id, variant.id, name) : undefined}
                onSlugChange={onVariantSlugChange ? slug => onVariantSlugChange(test.id, variant.id, slug) : undefined}
                onToggle={onToggleVariant ? enabled => onToggleVariant(test.id, variant.id, enabled) : undefined}
                onWeight={onWeightChange ? weight => onWeightChange(test.id, variant.id, weight) : undefined}
                onOpen={onOpenVariant ? () => onOpenVariant(test, variant) : undefined}
                onDuplicate={onDuplicateVariant ? () => onDuplicateVariant(test.id, variant.id) : undefined}
                onRemove={onRemoveVariant ? () => onRemoveVariant(test.id, variant.id) : undefined}
                onPromote={onPromoteWinner ? () => onPromoteWinner(test.id, variant.id) : undefined}
              />
            ))}
            {!test.variants.length && <AnalyticsEmptyState icon={FlaskConical} title="Nenhuma variante" description="Adicione uma variante para começar a comparação." className={cn(AB_SURFACE_CLASS, 'min-h-56')} />}
          </div>
        </section>
      </div>
    </main>
  );
}

export function HtmlAnalyticsAbTests({
  tests,
  pages = [],
  trackingTargets = [],
  siteUrl,
  selectedId,
  loading = false,
  saving = false,
  error,
  onSelectedIdChange,
  onRefresh,
  onCreateTest,
  onDeleteTest,
  onRenameTest,
  onGoalChange,
  onOptionsChange,
  onCreateVariant,
  onDuplicateVariant,
  onRemoveVariant,
  onRenameVariant,
  onVariantSlugChange,
  onToggleVariant,
  onWeightChange,
  onEqualizeWeights,
  onStart,
  onPause,
  onResume,
  onComplete,
  onPromoteWinner,
  onOpenVariant,
}: HtmlAnalyticsAbTestsProps) {
  const selected = tests.find(test => test.id === selectedId) || null;
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && tests.length && !creating) onSelectedIdChange?.(tests[0].id);
  }, [creating, onSelectedIdChange, selectedId, tests]);
  const filteredTests = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? tests.filter(test => `${test.name} ${test.sourcePagePath}`.toLocaleLowerCase().includes(normalized)) : tests;
  }, [query, tests]);
  const create = async (input: HtmlAbTestCreateInput) => {
    if (!onCreateTest) return;
    setActionError(null);
    try {
      const created = await onCreateTest(input);
      onSelectedIdChange?.(created.id);
      setCreating(false);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Não foi possível criar o teste.');
    }
  };
  if (loading && !tests.length) return <div className="grid h-full min-h-72 place-items-center bg-[var(--kodety-panel)] text-[10px] text-[var(--kodety-info-copy)]" role="status"><span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" />Carregando testes A/B…</span></div>;
  return (
    <section data-kodety-analytics-fill-fields data-kodety-onboarding="analytics-ab-tests-body" className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[var(--kodety-panel)] md:grid-cols-[224px_minmax(0,1fr)] md:grid-rows-1" aria-label="Testes A/B">
      <aside className="flex min-h-0 flex-col border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] md:border-b-0 md:border-r">
        <header className="flex h-[52px] min-h-[52px] items-center border-b border-[var(--kodety-divider)] px-3">
          <span className="grid size-7 place-items-center rounded-[7px] bg-white/[.045] text-white/40"><SolarTestTubeIcon className="size-4" /></span>
          <div className="ml-2 min-w-0">
            <h1 className="text-[10px] font-semibold text-[var(--kodety-text)]">Testes A/B</h1>
            <p className="text-[8px] text-[var(--kodety-info-copy)]">Experimentos e conversão</p>
          </div>
          <Button className="ml-auto" variant="ghost" size="icon-xs" aria-label="Novo teste A/B" title="Novo teste" onClick={() => {
            setCreating(true);
            onSelectedIdChange?.(null);
          }}><Plus /></Button>
        </header>
        <div className="border-b border-white/[.045] p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
            <Input value={query} onChange={event => setQuery(event.target.value)} className={cn(AB_CONTROL_CLASS, 'pl-9 pr-3')} placeholder="Buscar testes…" aria-label="Buscar testes A/B" />
          </div>
        </div>
        <div className="max-h-48 flex-1 space-y-1 overflow-y-auto p-2 md:max-h-none">
          {filteredTests.map(test => {
            const status = STATUS_COPY[test.status];
            return (
              <button
                key={test.id}
                type="button"
                onClick={() => {
                  setCreating(false);
                  onSelectedIdChange?.(test.id);
                }}
                className={cn(
                  'relative flex min-h-11 w-full items-center gap-2.5 rounded-[8px] border border-transparent px-2.5 text-left outline-none transition-colors focus-visible:border-[var(--kodety-focus)]',
                  selected?.id === test.id && !creating
                    ? 'bg-white/[.085] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-[var(--kodety-accent-hover)]'
                    : 'hover:bg-white/[.045]',
                )}
              >
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-[7px] bg-white/[.04]', status.className)}><SolarTestTubeIcon className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-medium text-[var(--kodety-text-secondary)]">{test.name}</span><span className="mt-0.5 block truncate text-[8px] text-[var(--kodety-info-copy)]">{status.label} · {test.sourcePagePath}</span></span>
              </button>
            );
          })}
          {!filteredTests.length && tests.length > 0 && <p className="px-2 py-6 text-center text-[9px] text-[var(--kodety-info-copy)]">Nenhum teste encontrado.</p>}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {(error || actionError) && <div role="alert" className="flex min-h-11 items-center gap-3 border-b border-[var(--kodety-danger)]/20 bg-[var(--kodety-danger)]/[.035] px-4 text-[9px] text-[var(--kodety-info-copy)]"><span className="min-w-0 flex-1 truncate">{actionError || error}</span>{onRefresh && <Button variant="ghost" size="icon-xs" aria-label="Atualizar testes" onClick={onRefresh}><RefreshCw /></Button>}</div>}
        <div data-kodety-onboarding-navigation-draft={creating || selected ? 'ab-test' : undefined} className="min-h-0 flex-1 overflow-hidden">
          {creating ? (
            <div className="h-full overflow-y-auto overscroll-contain">
              <NewTestForm pages={pages} trackingTargets={trackingTargets} saving={saving} persistenceAvailable={Boolean(onCreateTest)} onCancel={() => {
                setCreating(false);
                onSelectedIdChange?.(tests[0]?.id || null);
              }} onCreate={create} />
            </div>
          ) : selected ? (
            <SelectedTest
              test={selected}
              pages={pages}
              trackingTargets={trackingTargets}
              siteUrl={siteUrl}
              saving={saving}
              onDeleteTest={onDeleteTest}
              onRenameTest={onRenameTest}
              onGoalChange={onGoalChange}
              onOptionsChange={onOptionsChange}
              onCreateVariant={onCreateVariant}
              onDuplicateVariant={onDuplicateVariant}
              onRemoveVariant={onRemoveVariant}
              onRenameVariant={onRenameVariant}
              onVariantSlugChange={onVariantSlugChange}
              onToggleVariant={onToggleVariant}
              onWeightChange={onWeightChange}
              onEqualizeWeights={onEqualizeWeights}
              onStart={onStart}
              onPause={onPause}
              onResume={onResume}
              onComplete={onComplete}
              onPromoteWinner={onPromoteWinner}
              onOpenVariant={onOpenVariant}
            />
          ) : <EmptyTests onCreate={onCreateTest ? () => {
            setCreating(true);
            onSelectedIdChange?.(null);
          } : undefined} />}
        </div>
      </div>
    </section>
  );
}
