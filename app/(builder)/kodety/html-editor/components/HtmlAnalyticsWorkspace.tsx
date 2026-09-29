'use client';

import {
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  BarChart3,
  Funnel,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
} from '@/components/ui/gravity-icons';
import { EyeIcon as SolarEyeIcon } from '@solar-icons/react/bold-duotone/eye';
import { FilterIcon as SolarFilterIcon } from '@solar-icons/react/bold-duotone/filter';
import { Home2Icon as SolarHomeIcon } from '@solar-icons/react/bold-duotone/home-2';
import { LinkIcon as SolarLinkIcon } from '@solar-icons/react/bold-duotone/link';
import { TestTubeIcon as SolarTestTubeIcon } from '@solar-icons/react/bold-duotone/test-tube';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  emptyAnalyticsPageInsight,
  emptyAnalyticsOverview,
  type AnalyticsDeviceFilter,
  type AnalyticsFunnel,
  type AnalyticsFunnelInput,
  type AnalyticsOverview,
  type AnalyticsPageInsight,
  type AnalyticsPeriod,
  type AnalyticsTrackingTarget,
} from '@/lib/html-editor/analytics';
import {
  createHtmlAnalyticsClient,
  type HtmlAnalyticsApiConfig,
  type HtmlAnalyticsDataSource,
} from '@/lib/html-editor/analytics-client';
import { createAnalyticsDemoDataSource, isAnalyticsDemoMode } from '@/lib/html-editor/analytics-demo';
import { cn } from '@/lib/utils';
import { HtmlAnalyticsDemoAbTests } from './HtmlAnalyticsDemoAbTests';
import { AnalyticsOverviewPanel } from './HtmlAnalyticsOverview';
import { HtmlAnalyticsPageInsights } from './HtmlAnalyticsPageInsights';
import {
  AnalyticsFeatureAccessProvider,
  AnalyticsPlanBanner,
  AnalyticsProFeatureGate,
  AnalyticsRefreshButton,
  analyticsPeriodPresetAllowed,
  resolveAnalyticsFeatureAccess,
  type AnalyticsFeatureAccess,
  type AnalyticsFeatureAccessSource,
} from './HtmlAnalyticsUi';
import type {
  AnalyticsEmailAutomationOptions,
  AnalyticsExperimentOption,
  AnalyticsPageOption,
} from './HtmlAnalyticsFunnels';

const AnalyticsFunnelsPanel = lazy(() =>
  import('./HtmlAnalyticsFunnels').then(module => ({ default: module.AnalyticsFunnelsPanel })),
);

export type HtmlAnalyticsWorkspaceView = 'overview' | 'page-insights' | 'funnels' | 'ab-tests' | 'utms';

interface HtmlAnalyticsAbTestsSlotInjection {
  analyticsPeriod?: AnalyticsPeriod;
  analyticsRefreshKey?: number;
  featureAccess?: AnalyticsFeatureAccess;
}

interface HtmlAnalyticsUtmSlotInjection {
  activationLocked?: boolean;
  licenseUrl?: string;
  upgradeUrl?: string;
}

function localDate(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function defaultPeriod(access: AnalyticsFeatureAccess): AnalyticsPeriod {
  const to = new Date();
  const from = new Date(to);
  const useFreeWindow = !analyticsPeriodPresetAllowed('30d', access);
  from.setDate(from.getDate() - (useFreeWindow ? 6 : 29));
  return {
    preset: useFreeWindow ? '7d' : '30d',
    from: localDate(from),
    to: localDate(to),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function periodForPreset(period: AnalyticsPeriod): AnalyticsPeriod {
  if (period.preset === 'custom') return period;
  const to = new Date();
  const from = new Date(to);
  const days = period.preset === 'today' ? 0 : period.preset === '7d' ? 6 : period.preset === '90d' ? 89 : 29;
  from.setDate(from.getDate() - days);
  return { ...period, from: localDate(from), to: localDate(to) };
}

function SidebarButton({
  active,
  icon,
  children,
  onClick,
  locked = false,
  onboardingId,
}: {
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  locked?: boolean;
  onboardingId?: string;
}) {
  return (
    <button
      type="button"
      data-kodety-onboarding={onboardingId}
      data-kodety-onboarding-reveal={onboardingId ? '' : undefined}
      data-kodety-onboarding-navigation={onboardingId ? '' : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex h-9 w-auto shrink-0 min-w-0 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[11px] font-medium outline-none transition-[background-color,color] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]/70 md:w-full',
        active
          ? 'bg-white/[.085] text-[var(--kodety-text)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-[var(--kodety-accent-hover)]'
          : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.055] hover:text-[var(--kodety-text)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-5 shrink-0 place-items-center transition-colors [&>svg]:size-[18px]',
          active ? 'text-[var(--kodety-accent-hover)]' : 'text-current group-hover:text-white/80',
        )}
      >
        {icon}
      </span>
      <span className="truncate">{children}</span>
      {locked ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--kodety-accent)]/[.09] px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-accent-hover)]">
          <LockKeyhole className="size-2.5" />Pro
        </span>
      ) : null}
    </button>
  );
}

function WorkspaceError({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="grid h-full min-h-72 place-items-center px-5 text-center" role="alert">
      <div className="max-w-sm">
        <span className="mx-auto grid size-10 place-items-center rounded-[10px] bg-white/[.045] text-white/32"><BarChart3 className="size-4" /></span>
        <h1 className="mt-3 text-[12px] font-semibold text-[var(--kodety-text)]">{title}</h1>
        <p className="mx-auto mt-1 max-w-sm text-[10px] leading-4 text-[var(--kodety-info-copy)]">{message}</p>
        {onRetry && <Button className="mt-4" size="xs" variant="secondary" onClick={onRetry}><RefreshCw />Tentar novamente</Button>}
      </div>
    </div>
  );
}

export interface HtmlAnalyticsWorkspaceProps {
  projectName?: string;
  api?: HtmlAnalyticsApiConfig;
  dataSource?: HtmlAnalyticsDataSource;
  /** Server-provided demo flag for routed/embedded WordPress surfaces. */
  demoMode?: boolean;
  pages?: AnalyticsPageOption[];
  trackingTargets?: AnalyticsTrackingTarget[];
  experiments?: AnalyticsExperimentOption[];
  initialView?: HtmlAnalyticsWorkspaceView;
  view?: HtmlAnalyticsWorkspaceView;
  onViewChange?: (view: HtmlAnalyticsWorkspaceView) => void;
  onClose?: () => void;
  abTestsSlot?: ReactNode;
  utmSlot?: ReactNode;
  /** Server-derived product access. This controls UX, never API authority. */
  featureAccess?: AnalyticsFeatureAccessSource;
  liveRefreshMs?: number | false;
}

/**
 * Complete Analytics surface. Supply either `dataSource` callbacks or `api`
 * URLs. When neither is present it deliberately renders empty states instead
 * of fabricated metrics. The explicit `?value=teste` URL enables an isolated,
 * read-only visual demo without replacing or mutating the real data source.
 */
export function HtmlAnalyticsWorkspace({
  projectName = 'Projeto',
  api,
  dataSource,
  demoMode: forcedDemoMode,
  pages = [],
  trackingTargets = [],
  experiments = [],
  initialView = 'overview',
  view: controlledView,
  onViewChange,
  onClose,
  abTestsSlot,
  utmSlot: suppliedUtmSlot,
  featureAccess,
  liveRefreshMs = false,
}: HtmlAnalyticsWorkspaceProps) {
  const demoMode = useMemo(
    () => forcedDemoMode ?? isAnalyticsDemoMode(),
    [forcedDemoMode],
  );
  const demoDataSource = useMemo(() => createAnalyticsDemoDataSource(), []);
  const resolvedFeatureAccess = useMemo(
    () => demoMode
      ? resolveAnalyticsFeatureAccess()
      : resolveAnalyticsFeatureAccess(featureAccess),
    [demoMode, featureAccess],
  );
  const apiClient = useMemo(
    () => api ? createHtmlAnalyticsClient(api) : undefined,
    [
      api?.baseUrl,
      api?.credentials,
      api?.emailOptionsUrl,
      api?.funnelItemUrl,
      api?.funnelsUrl,
      api?.nonce,
      api?.nonceHeader,
      api?.overviewUrl,
      api?.pageInsightsUrl,
      api?.readOnly,
      api?.requestTimeoutMs,
    ],
  );
  const source = demoMode ? demoDataSource : dataSource || apiClient;
  const [internalView, setInternalView] = useState<HtmlAnalyticsWorkspaceView>(initialView);
  const activeView = controlledView || internalView;
  const setView = (next: HtmlAnalyticsWorkspaceView) => {
    if (!controlledView) setInternalView(next);
    onViewChange?.(next);
  };

  const [period, setPeriod] = useState<AnalyticsPeriod>(() => defaultPeriod(resolvedFeatureAccess));
  const resolvedPeriod = useMemo(() => periodForPreset(period), [period]);
  const [overview, setOverview] = useState<AnalyticsOverview>(() => emptyAnalyticsOverview());
  const [pageInsight, setPageInsight] = useState<AnalyticsPageInsight>(() => emptyAnalyticsPageInsight());
  const [insightPagePath, setInsightPagePath] = useState(() => pages[0]?.runtimePath || pages[0]?.path || '');
  const [insightDevice, setInsightDevice] = useState<AnalyticsDeviceFilter>('all');
  const [funnels, setFunnels] = useState<AnalyticsFunnel[]>([]);
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [funnelsLoading, setFunnelsLoading] = useState(false);
  const [funnelDetailsLoading, setFunnelDetailsLoading] = useState(false);
  const [funnelSaving, setFunnelSaving] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [funnelsError, setFunnelsError] = useState<string | null>(null);
  const [emailOptionsError, setEmailOptionsError] = useState<string | null>(null);
  const [emailOptions, setEmailOptions] = useState<AnalyticsEmailAutomationOptions>({ lists: [] });
  const [overviewReload, setOverviewReload] = useState(0);
  const [insightReload, setInsightReload] = useState(0);
  const [funnelsReload, setFunnelsReload] = useState(0);
  const loadedFunnelResultKeysRef = useRef(new Map<string, string>());
  const funnelResultsRequestKey = `${resolvedPeriod.preset}:${resolvedPeriod.from}:${resolvedPeriod.to}:${resolvedPeriod.timezone || ''}:${funnelsReload}`;

  useEffect(() => {
    if (analyticsPeriodPresetAllowed(period.preset, resolvedFeatureAccess)) return;
    setPeriod(defaultPeriod(resolvedFeatureAccess));
  }, [period.preset, resolvedFeatureAccess]);

  useEffect(() => {
    if (resolvedFeatureAccess.licensed) return;
    setOverview(emptyAnalyticsOverview());
  }, [resolvedFeatureAccess.historyDays, resolvedFeatureAccess.licensed]);

  useEffect(() => {
    if (resolvedFeatureAccess.pageInsights) return;
    setPageInsight(emptyAnalyticsPageInsight());
    setInsightLoading(false);
    setInsightError(null);
  }, [resolvedFeatureAccess.pageInsights]);

  useEffect(() => {
    if (resolvedFeatureAccess.funnels) return;
    loadedFunnelResultKeysRef.current.clear();
    setFunnels(current => current.map(funnel => ({
      ...funnel,
      enabled: false,
      results: undefined,
      connectionResults: undefined,
    })));
    setFunnelsLoading(false);
    setFunnelDetailsLoading(false);
    setFunnelsError(null);
  }, [resolvedFeatureAccess.funnels]);

  useEffect(() => {
    loadedFunnelResultKeysRef.current.clear();
  }, [source]);

  useEffect(() => {
    if (!resolvedFeatureAccess.funnels || activeView !== 'funnels' || !api?.emailOptionsUrl || api.readOnly || demoMode) {
      setEmailOptions({ lists: [] });
      setEmailOptionsError(null);
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, api.requestTimeoutMs || 20_000));
    const headers = new Headers({ Accept: 'application/json' });
    if (api.nonce) headers.set(api.nonceHeader || 'X-WP-Nonce', api.nonce);
    fetch(api.emailOptionsUrl, {
      credentials: api.credentials || 'same-origin',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    }).then(async response => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error('Não foi possível carregar as listas de email.');
      const candidate = payload && typeof payload === 'object' ? payload as Partial<AnalyticsEmailAutomationOptions> : {};
      setEmailOptions({
        lists: Array.isArray(candidate.lists) ? candidate.lists : [],
      });
      setEmailOptionsError(null);
    }).catch(error => {
      if (disposed) return;
      setEmailOptionsError(timedOut
        ? 'As listas de email demoraram demais para responder. Tente novamente.'
        : error instanceof Error ? error.message : 'Não foi possível conectar o email marketing.');
    }).finally(() => {
      window.clearTimeout(timeout);
    });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeView, api?.credentials, api?.emailOptionsUrl, api?.nonce, api?.nonceHeader, api?.readOnly, api?.requestTimeoutMs, demoMode, resolvedFeatureAccess.funnels]);
  const [abTestsReload, setAbTestsReload] = useState(0);
  const [createRequestKey, setCreateRequestKey] = useState(0);
  // User-configurable live auto-refresh cadence, persisted across sessions.
  // 0 = manual only. Falls back to the host-provided default.
  const [refreshMs, setRefreshMs] = useState<number>(() => {
    const fallback = liveRefreshMs === false ? 0 : liveRefreshMs;
    if (typeof window === 'undefined') return fallback;
    const stored = Number(window.localStorage.getItem('kodety.analytics.refreshMs'));
    return Number.isFinite(stored) && [0, 10_000, 30_000, 60_000].includes(stored) ? stored : fallback;
  });
  const changeRefreshMs = (value: number) => {
    setRefreshMs(value);
    try { window.localStorage.setItem('kodety.analytics.refreshMs', String(value)); } catch { /* storage unavailable */ }
  };

  useEffect(() => {
    if (!source || activeView !== 'overview') return;
    const controller = new AbortController();
    setOverviewLoading(true);
    setOverviewError(null);
    source.loadOverview({ period: resolvedPeriod, signal: controller.signal })
      .then(value => {
        if (!controller.signal.aborted) setOverview(value);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setOverviewError(error instanceof Error ? error.message : 'Não foi possível carregar as métricas.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setOverviewLoading(false);
      });
    return () => controller.abort();
  }, [activeView, overviewReload, resolvedPeriod, source]);

  useEffect(() => {
    if (insightPagePath || !pages.length) return;
    setInsightPagePath(pages[0].runtimePath || pages[0].path);
  }, [insightPagePath, pages]);

  useEffect(() => {
    if (!resolvedFeatureAccess.pageInsights || !source?.loadPageInsights || activeView !== 'page-insights') return;
    const controller = new AbortController();
    setInsightLoading(true);
    setInsightError(null);
    source.loadPageInsights({
      period: resolvedPeriod,
      pagePath: insightPagePath || undefined,
      device: insightDevice,
      signal: controller.signal,
    }).then(value => {
      if (controller.signal.aborted) return;
      setPageInsight(value);
      if (!insightPagePath && value.pagePath) setInsightPagePath(value.pagePath);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setInsightError(error instanceof Error ? error.message : 'Não foi possível carregar a visão da página.');
    }).finally(() => {
      if (!controller.signal.aborted) setInsightLoading(false);
    });
    return () => controller.abort();
  }, [activeView, insightDevice, insightPagePath, insightReload, resolvedFeatureAccess.pageInsights, resolvedPeriod, source]);

  useEffect(() => {
    if (!source || activeView !== 'overview' || refreshMs < 5_000) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') setOverviewReload(value => value + 1);
    }, refreshMs);
    return () => window.clearInterval(interval);
  }, [activeView, refreshMs, source]);

  useEffect(() => {
    // `loadFunnels` uses the definition-only `summary=1` endpoint. Free may
    // inspect and edit drafts, but calculated conversion results stay absent.
    if (!source) return;
    const controller = new AbortController();
    setFunnelsLoading(true);
    setFunnelsError(null);
    source.loadFunnels({ period: resolvedPeriod, signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        const safeValue = resolvedFeatureAccess.funnels
          ? value
          : value.map(funnel => ({
              ...funnel,
              enabled: false,
              results: undefined,
              connectionResults: undefined,
            }));
        setFunnels(current => {
          const currentById = new Map(current.map(funnel => [funnel.id, funnel]));
          return safeValue.map(funnel => {
            const existing = currentById.get(funnel.id);
            return resolvedFeatureAccess.funnels && existing?.results !== undefined
              ? { ...funnel, results: existing.results, connectionResults: existing.connectionResults }
              : funnel;
          });
        });
        setSelectedFunnelId(current => current && safeValue.some(funnel => funnel.id === current) ? current : safeValue[0]?.id || null);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setFunnelsError(error instanceof Error ? error.message : 'Não foi possível carregar os funis.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setFunnelsLoading(false);
      });
    return () => controller.abort();
  }, [funnelsReload, resolvedFeatureAccess.funnels, resolvedPeriod, source]);

  useEffect(() => {
    if (!resolvedFeatureAccess.funnels) {
      setFunnelDetailsLoading(false);
      return;
    }
    if (!source?.loadFunnel || activeView !== 'funnels' || !selectedFunnelId) {
      setFunnelDetailsLoading(false);
      return;
    }
    if (loadedFunnelResultKeysRef.current.get(selectedFunnelId) === funnelResultsRequestKey) {
      setFunnelDetailsLoading(false);
      return;
    }
    const controller = new AbortController();
    setFunnelDetailsLoading(true);
    setFunnelsError(null);
    source.loadFunnel(selectedFunnelId, { period: resolvedPeriod, signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        loadedFunnelResultKeysRef.current.set(value.id, funnelResultsRequestKey);
        setFunnels(current => current.some(funnel => funnel.id === value.id)
          ? current.map(funnel => funnel.id === value.id ? value : funnel)
          : [...current, value]);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setFunnelsError(error instanceof Error ? error.message : 'Não foi possível calcular o funil selecionado.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setFunnelDetailsLoading(false);
      });
    return () => controller.abort();
  }, [activeView, funnelResultsRequestKey, resolvedFeatureAccess.funnels, resolvedPeriod, selectedFunnelId, source]);

  const reloadFunnelAfterMutation = useCallback(async (
    fallback: AnalyticsFunnel,
  ): Promise<AnalyticsFunnel> => {
    const safeFallback = resolvedFeatureAccess.funnels ? fallback : {
      ...fallback,
      enabled: false,
      results: undefined,
      connectionResults: undefined,
    };
    if (!source || !resolvedFeatureAccess.funnels) {
      setFunnels(current => current.some(funnel => funnel.id === safeFallback.id)
        ? current.map(funnel => funnel.id === safeFallback.id ? safeFallback : funnel)
        : [...current, safeFallback]);
      return safeFallback;
    }
    try {
      const resolved = source.loadFunnel
        ? await source.loadFunnel(fallback.id, { period: resolvedPeriod })
        : (await source.loadFunnels({ period: resolvedPeriod })).find(funnel => funnel.id === fallback.id) || fallback;
      if (resolved.results !== undefined) {
        loadedFunnelResultKeysRef.current.set(resolved.id, funnelResultsRequestKey);
      }
      setFunnels(current => current.some(funnel => funnel.id === fallback.id)
        ? current.map(funnel => funnel.id === fallback.id ? resolved : funnel)
        : [...current, resolved]);
      setFunnelsError(null);
      return resolved;
    } catch (error) {
      setFunnels(current => {
        return current.some(funnel => funnel.id === fallback.id)
          ? current.map(funnel => funnel.id === fallback.id ? fallback : funnel)
          : [...current, fallback];
      });
      setFunnelsError(
        `Alterações salvas, mas os resultados não puderam ser atualizados: ${
          error instanceof Error ? error.message : 'falha ao recarregar o funil'
        }`,
      );
      return fallback;
    }
  }, [funnelResultsRequestKey, resolvedFeatureAccess.funnels, resolvedPeriod, source]);

  const createFunnel = useCallback(async (input: AnalyticsFunnelInput) => {
    if (!source?.createFunnel) throw new Error('A criação de funis não foi conectada.');
    setFunnelSaving(true);
    try {
      const created = await source.createFunnel(resolvedFeatureAccess.funnels ? input : { ...input, enabled: false });
      return await reloadFunnelAfterMutation(created);
    } finally {
      setFunnelSaving(false);
    }
  }, [reloadFunnelAfterMutation, resolvedFeatureAccess.funnels, source]);

  const updateFunnel = useCallback(async (id: string, input: AnalyticsFunnelInput) => {
    if (!source?.updateFunnel) throw new Error('A edição de funis não foi conectada.');
    setFunnelSaving(true);
    try {
      const updated = await source.updateFunnel(id, resolvedFeatureAccess.funnels ? input : { ...input, enabled: false });
      const previous = funnels.find(funnel => funnel.id === id);
      const fallback = updated.results === undefined && previous?.results !== undefined
        ? { ...updated, results: previous.results }
        : updated;
      return await reloadFunnelAfterMutation(fallback);
    } finally {
      setFunnelSaving(false);
    }
  }, [funnels, reloadFunnelAfterMutation, resolvedFeatureAccess.funnels, source]);

  const deleteFunnel = useCallback(async (id: string) => {
    if (!source?.deleteFunnel) throw new Error('A exclusão de funis não foi conectada.');
    setFunnelSaving(true);
    try {
      await source.deleteFunnel(id);
      loadedFunnelResultKeysRef.current.delete(id);
      setFunnels(current => current.filter(funnel => funnel.id !== id));
    } finally {
      setFunnelSaving(false);
    }
  }, [source]);

  const resolvedAbTestsSlot = useMemo(() => {
    if (!isValidElement(abTestsSlot) || typeof abTestsSlot.type === 'string') return abTestsSlot;
    return cloneElement(
      abTestsSlot as ReactElement<HtmlAnalyticsAbTestsSlotInjection>,
      {
        analyticsPeriod: resolvedPeriod,
        analyticsRefreshKey: abTestsReload,
        featureAccess: resolvedFeatureAccess,
      },
    );
  }, [abTestsReload, abTestsSlot, resolvedFeatureAccess, resolvedPeriod]);

  const utmSlot = useMemo(() => {
    if (!isValidElement(suppliedUtmSlot) || typeof suppliedUtmSlot.type === 'string') return suppliedUtmSlot;
    return cloneElement(
      suppliedUtmSlot as ReactElement<HtmlAnalyticsUtmSlotInjection>,
      {
        activationLocked: !resolvedFeatureAccess.utms,
        licenseUrl: resolvedFeatureAccess.licenseUrl,
        upgradeUrl: resolvedFeatureAccess.upgradeUrl,
      },
    );
  }, [resolvedFeatureAccess, suppliedUtmSlot]);

  const refreshActiveView = () => {
    if (activeView === 'overview') {
      setOverviewReload(value => value + 1);
      return;
    }
    if (activeView === 'page-insights') {
      setInsightReload(value => value + 1);
      return;
    }
    if (activeView === 'funnels') {
      setFunnelsReload(value => value + 1);
      return;
    }
    setAbTestsReload(value => value + 1);
  };
  const activeViewLoading = activeView === 'overview'
    ? overviewLoading
    : activeView === 'page-insights'
      ? insightLoading
    : activeView === 'funnels'
      ? funnelsLoading || funnelDetailsLoading
      : false;
  const activeViewCanRefresh = activeView === 'overview'
    || (activeView === 'page-insights' && resolvedFeatureAccess.pageInsights)
    || (activeView === 'funnels' && resolvedFeatureAccess.funnels)
    || (activeView === 'ab-tests' && resolvedFeatureAccess.abTests);

  return (
    <AnalyticsFeatureAccessProvider value={resolvedFeatureAccess}>
    <section data-kodety-analytics data-kodety-onboarding="analytics-workspace" data-kodety-analytics-demo={demoMode ? 'true' : undefined} className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--kodety-panel)] text-[var(--kodety-text)]" aria-label="Kodety Analytics">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kodety-divider)] px-2.5 sm:px-3">
        {onClose && <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Voltar ao editor" title="Voltar ao editor"><ArrowLeft /></Button>}
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/40"><BarChart3 className="size-4" /></span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold">Analytics</p>
          <p data-kodety-no-i18n className="hidden truncate text-[9px] text-[var(--kodety-info-copy)] sm:block">{projectName}</p>
        </div>
        {demoMode ? <span className="shrink-0 rounded-full border border-[var(--kodety-accent-border)] bg-[var(--kodety-accent)]/[.08] px-2 py-1 text-[8px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-accent-hover)]">Demo · dados simulados</span> : null}
        <div data-kodety-onboarding="analytics-refresh" className="ml-auto flex min-w-0 items-center gap-2">
          {activeView === 'overview' && (
            <Select value={String(refreshMs)} onValueChange={value => changeRefreshMs(Number(value))}>
              <SelectTrigger aria-label="Intervalo de atualização automática" title="Atualização automática do painel" className="hidden w-28 text-[11px] sm:flex"><SelectValue /></SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="0">Manual</SelectItem>
                <SelectItem value="10000">10 segundos</SelectItem>
                <SelectItem value="30000">30 segundos</SelectItem>
                <SelectItem value="60000">1 minuto</SelectItem>
              </SelectContent>
            </Select>
          )}
          {activeViewCanRefresh ? <AnalyticsRefreshButton onClick={refreshActiveView} loading={activeViewLoading} label="Atualizar painel" /> : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[224px_minmax(0,1fr)] md:grid-rows-1">
        <aside data-kodety-analytics-sidebar className="min-w-0 border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] md:border-b-0 md:border-r">
          <div className="hidden px-3 pb-2 pt-4 md:block">
            <p className="text-[10px] font-semibold text-[var(--kodety-text-secondary)]">Relatórios</p>
            <p className="mt-1 max-w-40 text-balance text-[9px] leading-4 text-[var(--kodety-info-copy)]">Tráfego, jornadas e experimentos.</p>
          </div>
          <nav data-kodety-onboarding="analytics-navigation" className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:px-3" aria-label="Seções do Analytics">
            <SidebarButton onboardingId="analytics-overview" active={activeView === 'overview'} icon={<SolarHomeIcon />} onClick={() => setView('overview')}>Visão geral</SidebarButton>
            {source?.loadPageInsights || !resolvedFeatureAccess.pageInsights ? (
              <SidebarButton onboardingId="analytics-page-insights" active={activeView === 'page-insights'} locked={!resolvedFeatureAccess.pageInsights} icon={<SolarEyeIcon />} onClick={() => setView('page-insights')}>Visão de página</SidebarButton>
            ) : null}
            <SidebarButton onboardingId="analytics-funnels" active={activeView === 'funnels'} locked={!resolvedFeatureAccess.funnels} icon={<SolarFilterIcon />} onClick={() => setView('funnels')}>Funis</SidebarButton>
            {abTestsSlot || demoMode || !resolvedFeatureAccess.abTests ? (
              <SidebarButton onboardingId="analytics-ab-tests" active={activeView === 'ab-tests'} locked={!resolvedFeatureAccess.abTests} icon={<SolarTestTubeIcon />} onClick={() => setView('ab-tests')}>Testes A/B</SidebarButton>
            ) : null}
            {utmSlot || !resolvedFeatureAccess.utms ? (
              <SidebarButton onboardingId="analytics-utms" active={activeView === 'utms'} locked={!resolvedFeatureAccess.utms} icon={<SolarLinkIcon />} onClick={() => setView('utms')}>Central de UTMs</SidebarButton>
            ) : null}
          </nav>
          <div className="mx-3 hidden border-t border-[var(--kodety-divider)] py-3 md:block">
            <div className="flex h-8 items-center px-2">
              <span className="text-[10px] font-semibold text-[var(--kodety-text-secondary)]">Funis salvos</span>
              {!resolvedFeatureAccess.funnels ? <span className="ml-1.5 text-[7px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-accent-hover)]">Pro</span> : null}
              {source?.createFunnel ? <Button className="ml-auto" variant="ghost" size="icon-xs" aria-label="Criar funil" title="Criar funil" onClick={() => {
                setView('funnels');
                setCreateRequestKey(value => value + 1);
              }}><Plus /></Button> : null}
            </div>
            <div className="mt-1 space-y-1">
              {funnels.map(funnel => (
                <button
                  key={funnel.id}
                  type="button"
                  onClick={() => {
                    setView('funnels');
                    setSelectedFunnelId(funnel.id);
                  }}
                  className={cn(
                    'relative flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[10px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]/70',
                    activeView === 'funnels' && funnel.id === selectedFunnelId
                      ? 'bg-white/[.08] text-[var(--kodety-text)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-[var(--kodety-accent-hover)]'
                      : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.045] hover:text-[var(--kodety-text-secondary)]',
                  )}
                >
                  <Funnel className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{funnel.name}</span>
                  <span className={cn('size-1.5 rounded-full', funnel.enabled && resolvedFeatureAccess.funnels ? 'bg-[var(--kodety-success)]' : 'bg-[var(--kodety-text-disabled)]')} aria-label={funnel.enabled && resolvedFeatureAccess.funnels ? 'Ativo' : 'Pausado'} />
                </button>
              ))}
              {!funnels.length && <p className="px-2 py-3 text-[9px] leading-4 text-[var(--kodety-info-copy)]">{resolvedFeatureAccess.funnels ? 'Nenhum funil ainda.' : 'Crie e configure rascunhos. A coleta exige o Pro.'}</p>}
            </div>
          </div>
        </aside>

        <div data-kodety-onboarding="analytics-content" data-kodety-onboarding-section={activeView} className="min-h-0 min-w-0 overflow-hidden bg-[var(--kodety-panel)]">
          {utmSlot ? (
            <div className={activeView === 'utms' ? 'h-full min-h-0' : 'hidden'} aria-hidden={activeView === 'utms' ? undefined : true}>
              {utmSlot}
            </div>
          ) : null}
          {activeView === 'utms' ? null : activeView === 'page-insights' && !resolvedFeatureAccess.pageInsights ? (
            <AnalyticsProFeatureGate
              access={resolvedFeatureAccess}
              title="Visão de página"
              description="Entenda como as pessoas percorrem cada página publicada sem expor métricas bloqueadas no navegador."
              metricLabels={['Sessões', 'Visitantes únicos', 'Visualizações', 'Profundidade de scroll']}
              bullets={['Mapa de scroll por dispositivo', 'Eventos mais acionados', 'Comparação entre páginas', 'Métricas de atenção']}
            />
          ) : activeView === 'ab-tests' && !resolvedFeatureAccess.abTests && !resolvedAbTestsSlot ? (
            <AnalyticsProFeatureGate
              access={resolvedFeatureAccess}
              title="Testes A/B"
              description="Prepare variações e objetivos como rascunho. Publicar, iniciar e retomar experimentos exige uma licença Pro ativa."
              metricLabels={['Visualizações', 'Conversões', 'Taxa de conversão', 'Confiança']}
              bullets={['Distribuição de tráfego', 'Variantes por página', 'Objetivos rastreados', 'Escolha de vencedor']}
            />
          ) : !source && activeView !== 'ab-tests' ? (
            <WorkspaceError title="Analytics ainda não conectado" message="Passe `api` com URLs reais ou um `dataSource` controlado. O Kodety não exibe métricas simuladas." />
          ) : activeView === 'overview' ? (
            <div className="h-full overflow-y-auto">
              {!resolvedFeatureAccess.licensed ? (
                <div className="px-4 pt-4 sm:px-6">
                  <AnalyticsPlanBanner access={resolvedFeatureAccess} />
                </div>
              ) : null}
              <AnalyticsOverviewPanel
                overview={overview}
                period={resolvedPeriod}
                loading={overviewLoading}
                error={overviewError}
                onPeriodChange={setPeriod}
                onRetry={() => setOverviewReload(value => value + 1)}
              />
            </div>
          ) : activeView === 'page-insights' ? (
            source?.loadPageInsights ? (
              <HtmlAnalyticsPageInsights
                insight={pageInsight}
                pages={pages}
                period={resolvedPeriod}
                pagePath={insightPagePath || pageInsight.pagePath}
                device={insightDevice}
                loading={insightLoading}
                error={insightError}
                onPagePathChange={setInsightPagePath}
                onDeviceChange={setInsightDevice}
                onPeriodChange={setPeriod}
                onRetry={() => setInsightReload(value => value + 1)}
              />
            ) : (
              <WorkspaceError title="Visão de página indisponível" message="Conecte o endpoint de insights para sobrepor scroll e eventos à página publicada." />
            )
          ) : activeView === 'funnels' ? (
            <div className="flex h-full min-h-0 flex-col">
              <Suspense
                fallback={(
                  <div className="grid h-full min-h-72 place-items-center text-[var(--kodety-text-tertiary)]" role="status">
                    <Loader2 className="size-5 animate-spin" />
                    <span className="sr-only">Carregando funis</span>
                  </div>
                )}
              >
                <AnalyticsFunnelsPanel
                  funnels={funnels}
                  period={resolvedPeriod}
                  pages={pages}
                  trackingTargets={trackingTargets.filter(target => !target.selectorType)}
                  experiments={experiments}
                  emailOptions={emailOptions}
                  loading={funnelsLoading || funnelDetailsLoading}
                  saving={funnelSaving}
                  error={funnelsError || emailOptionsError}
                  selectedId={selectedFunnelId}
                  createRequestKey={createRequestKey}
                  featureAccess={resolvedFeatureAccess}
                  onPeriodChange={setPeriod}
                  onSelectedIdChange={setSelectedFunnelId}
                  onRefresh={resolvedFeatureAccess.funnels ? () => setFunnelsReload(value => value + 1) : undefined}
                  onCreate={source?.createFunnel ? createFunnel : undefined}
                  onUpdate={source?.updateFunnel ? updateFunnel : undefined}
                  onDelete={source?.deleteFunnel ? deleteFunnel : undefined}
                />
              </Suspense>
            </div>
          ) : demoMode ? (
            <HtmlAnalyticsDemoAbTests period={resolvedPeriod} />
          ) : resolvedAbTestsSlot ? (
            <div className="h-full min-h-0">{resolvedAbTestsSlot}</div>
          ) : (
            <WorkspaceError title="Testes A/B" message="O workspace aceita o painel de experimentos por `abTestsSlot`, mantendo Analytics e variantes desacoplados." />
          )}
          {activeView === 'utms' && !utmSlot ? (
            <AnalyticsProFeatureGate
              access={resolvedFeatureAccess}
              title="Central de UTMs"
              description="Crie modelos de links e checkout, repasse parâmetros e preserve a atribuição durante a sessão."
              bullets={['Modelos de links e checkouts', 'Repasse e memória de UTMs', 'Aplicação nos formulários', 'Biblioteca compartilhada no projeto']}
            />
          ) : null}
        </div>
      </div>
    </section>
    </AnalyticsFeatureAccessProvider>
  );
}
