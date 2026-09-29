'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { Activity, LockKeyhole, RefreshCw } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AnalyticsPeriod, AnalyticsPeriodPreset } from '@/lib/html-editor/analytics';
import {
  resolveAnalyticsFeatureAccess,
  type AnalyticsFeatureAccess,
  type AnalyticsFeatureAccessSource,
} from '@/lib/html-editor/analytics-access';
import { cn } from '@/lib/utils';
import { HtmlSettingsFieldControl } from './HtmlProjectSettingsFieldControl';

type AnalyticsIcon = ComponentType<{ className?: string }>;

/**
 * Product access is intentionally separate from editor permissions. The
 * browser uses this descriptor only to render the correct UX; API/runtime
 * enforcement remains the server's responsibility.
 */
export { resolveAnalyticsFeatureAccess };
export type { AnalyticsFeatureAccess, AnalyticsFeatureAccessSource };

export const FULL_ANALYTICS_FEATURE_ACCESS: AnalyticsFeatureAccess = {
  licensed: true,
  historyDays: null,
  pageInsights: true,
  funnels: true,
  abTests: true,
  utms: true,
};

export function analyticsPeriodPresetAllowed(
  preset: AnalyticsPeriodPreset,
  access: AnalyticsFeatureAccess,
) {
  if (preset === 'today') return true;
  if (preset === 'custom') return access.historyDays === null;
  const requiredDays = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  return access.historyDays === null || access.historyDays >= requiredDays;
}

const AnalyticsFeatureAccessContext = createContext<AnalyticsFeatureAccess>(
  FULL_ANALYTICS_FEATURE_ACCESS,
);

export function AnalyticsFeatureAccessProvider({
  value,
  children,
}: {
  value: AnalyticsFeatureAccess;
  children: ReactNode;
}) {
  return (
    <AnalyticsFeatureAccessContext.Provider value={value}>
      {children}
    </AnalyticsFeatureAccessContext.Provider>
  );
}

export function useAnalyticsFeatureAccess(override?: AnalyticsFeatureAccess) {
  const contextual = useContext(AnalyticsFeatureAccessContext);
  return FULL_ANALYTICS_FEATURE_ACCESS;
}

export function AnalyticsPlanBanner(_props: {
  access?: AnalyticsFeatureAccess; compact?: boolean; showWhenLicensed?: boolean;
  title?: ReactNode; description?: ReactNode;
}) { return null; }

export function AnalyticsProFeatureGate(_props: {
  access?: AnalyticsFeatureAccess; title: ReactNode; description: ReactNode;
  bullets?: ReactNode[]; metricLabels?: ReactNode[];
}) { return null; }

export function AnalyticsPageHeader({
  icon: Icon,
  title,
  description,
  meta,
  actions,
  className,
}: {
  icon?: AnalyticsIcon;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-kodety-analytics-page-header
      className={cn('flex flex-col gap-5 border-b border-[var(--kodety-divider)] pb-5 sm:flex-row sm:items-end sm:justify-between', className)}
    >
      <div className="flex min-w-0 flex-1 flex-col items-start">
        {Icon ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/42">
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className={cn('min-w-0', Icon && 'mt-3')}>
          <h1 className="text-balance text-[18px] font-semibold tracking-[-0.025em] text-[var(--kodety-text)]">{title}</h1>
          {description ? <p data-kodety-analytics-description className="mt-1 max-w-xl text-balance text-[10px] leading-4 text-[var(--kodety-info-copy)]">{description}</p> : null}
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[8px] text-[var(--kodety-text-tertiary)] [&>span]:inline-flex [&>span]:min-h-6 [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-1.5 [&>span]:rounded-full [&>span]:bg-white/[.045] [&>span]:px-2 [&>span]:font-medium">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div> : null}
    </header>
  );
}

export function AnalyticsSectionHeader({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: AnalyticsIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex min-h-11 gap-2.5', description ? 'items-start' : 'items-center', className)}>
      {Icon ? <Icon className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" /> : null}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[11px] font-semibold text-[var(--kodety-text)]">{title}</h2>
        {description ? <p data-kodety-analytics-description className="mt-0.5 max-w-lg text-balance text-[9px] leading-4 text-[var(--kodety-info-copy)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0 self-start">{action}</div> : null}
    </header>
  );
}

export function AnalyticsMetric({
  label,
  value,
  detail,
  live = false,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  live?: boolean;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
  className?: string;
}) {
  const toneClass = {
    default: 'text-[var(--kodety-text)]',
    success: 'text-[var(--kodety-success)]',
    warning: 'text-[var(--kodety-warning)]',
    danger: 'text-[var(--kodety-danger)]',
    accent: 'text-[var(--kodety-accent-hover)]',
  }[tone];
  return (
    <div data-kodety-analytics-metric className={cn('min-w-0 px-3 py-3.5', className)}>
      <div className="flex items-center gap-1.5 text-[9px] font-medium text-[var(--kodety-text-tertiary)]">
        <span className="truncate">{label}</span>
        {live ? <span aria-label="Atualização ao vivo" className="size-1.5 shrink-0 rounded-full bg-[var(--kodety-success)]" /> : null}
      </div>
      <p className={cn('mt-1 truncate text-[21px] font-semibold tracking-[-0.035em] tabular-nums', toneClass)}>{value}</p>
      {detail ? <p className="mt-0.5 text-balance text-[9px] leading-4 text-[var(--kodety-info-copy)]">{detail}</p> : null}
    </div>
  );
}

export function AnalyticsSurface({
  children,
  className,
  onboardingId,
  interactive = false,
  variant = 'card',
}: {
  children: ReactNode;
  className?: string;
  onboardingId?: string;
  interactive?: boolean;
  variant?: 'card' | 'section' | 'plain';
}) {
  return (
    <section
      data-kodety-onboarding={onboardingId}
      data-kodety-analytics-card={variant === 'card' ? (interactive ? 'interactive' : '') : undefined}
      data-kodety-analytics-section={variant === 'section' ? '' : undefined}
      className={cn(
        'min-w-0',
        variant === 'card' && 'overflow-hidden',
        variant === 'section' && 'border-t border-[var(--kodety-divider)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function AnalyticsEmptyState({
  icon: Icon = Activity,
  title,
  description,
  action,
  className,
}: {
  icon?: AnalyticsIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-h-64 place-items-center px-6 py-10 text-center', className)}>
      <div className="max-w-sm">
        <span className="mx-auto grid size-9 place-items-center rounded-[9px] bg-white/[.045] text-white/32">
          <Icon className="size-4" />
        </span>
        <h2 className="mt-3 text-[12px] font-semibold text-[var(--kodety-text)]">{title}</h2>
        {description ? <p data-kodety-analytics-description className="mx-auto mt-1 max-w-xs text-balance text-[10px] leading-4 text-[var(--kodety-info-copy)]">{description}</p> : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

export function AnalyticsPeriodPicker({
  period,
  onChange,
  label = 'Período',
  compact = false,
  featureAccess: override,
}: {
  period: AnalyticsPeriod;
  onChange: (period: AnalyticsPeriod) => void;
  label?: string;
  compact?: boolean;
  featureAccess?: AnalyticsFeatureAccess;
}) {
  const featureAccess = useAnalyticsFeatureAccess(override);
  const updatePreset = (preset: AnalyticsPeriodPreset) => {
    if (!analyticsPeriodPresetAllowed(preset, featureAccess)) return;
    onChange({ ...period, preset });
  };
  const proLabel = (labelCopy: string, preset: AnalyticsPeriodPreset) => (
    <span className="flex w-full items-center justify-between gap-3">
      <span>{labelCopy}</span>
      {!analyticsPeriodPresetAllowed(preset, featureAccess) ? (
        <span className="text-[8px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-accent-hover)]">Pro</span>
      ) : null}
    </span>
  );
  return (
    <div data-kodety-analytics-period className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none">
      <HtmlSettingsFieldControl label={label} kind="time">
        <Select value={period.preset} onValueChange={value => updatePreset(value as AnalyticsPeriodPreset)}>
          <SelectTrigger
            aria-label={label}
            className={cn(
              'min-w-[11.5rem] flex-1 text-[11px] sm:flex-none',
              compact ? 'sm:w-[11.5rem]' : 'sm:w-52',
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="7d" disabled={!analyticsPeriodPresetAllowed('7d', featureAccess)}>{proLabel('Últimos 7 dias', '7d')}</SelectItem>
            <SelectItem value="30d" disabled={!analyticsPeriodPresetAllowed('30d', featureAccess)}>{proLabel('Últimos 30 dias', '30d')}</SelectItem>
            <SelectItem value="90d" disabled={!analyticsPeriodPresetAllowed('90d', featureAccess)}>{proLabel('Últimos 90 dias', '90d')}</SelectItem>
            <SelectItem value="custom" disabled={!analyticsPeriodPresetAllowed('custom', featureAccess)}>{proLabel('Personalizado', 'custom')}</SelectItem>
          </SelectContent>
        </Select>
      </HtmlSettingsFieldControl>
      {period.preset === 'custom' ? (
        <>
          <HtmlSettingsFieldControl label="Data inicial" kind="time">
            <Input aria-label="Data inicial" type="date" value={period.from} onChange={event => onChange({ ...period, from: event.target.value })} className="min-w-36 flex-1 text-[11px] sm:flex-none" />
          </HtmlSettingsFieldControl>
          <HtmlSettingsFieldControl label="Data final" kind="time">
            <Input aria-label="Data final" type="date" value={period.to} onChange={event => onChange({ ...period, to: event.target.value })} className="min-w-36 flex-1 text-[11px] sm:flex-none" />
          </HtmlSettingsFieldControl>
        </>
      ) : null}
    </div>
  );
}

export function AnalyticsRefreshButton({
  loading = false,
  onClick,
  label = 'Atualizar',
}: {
  loading?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
