'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  Eye,
  Maximize2,
  Monitor,
  MousePointerClick,
  Users,
} from '@/components/ui/gravity-icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAdminNumberFormatter } from '@/lib/admin-ui-locale';
import type {
  AnalyticsDeviceFilter,
  AnalyticsPageEvent,
  AnalyticsPageInsight,
  AnalyticsPeriod,
} from '@/lib/html-editor/analytics';
import type { AnalyticsPageOption } from './HtmlAnalyticsFunnels';
import {
  AnalyticsEmptyState,
  AnalyticsMetric,
  AnalyticsPageHeader,
  AnalyticsPeriodPicker,
  AnalyticsSectionHeader,
  AnalyticsSurface,
} from './HtmlAnalyticsUi';
import { HtmlSettingsFieldControl } from './HtmlProjectSettingsFieldControl';

const integerFormatter = () => getAdminNumberFormatter();
const decimalFormatter = () => getAdminNumberFormatter({ maximumFractionDigits: 1 });

interface InsightMarker {
  event: AnalyticsPageEvent;
  left: number;
  top: number;
  width: number;
  height: number;
}

const PUBLISHED_PREVIEW_FRAME_NAME = 'kodety-analytics-published-preview';
const PAGE_VIEWPORTS: Record<AnalyticsDeviceFilter, {
  width: number;
  height: number;
  label: string;
}> = {
  all: { width: 1920, height: 1080, label: 'Todos os dispositivos' },
  desktop: { width: 1920, height: 1080, label: 'Desktop' },
  tablet: { width: 768, height: 1024, label: 'Tablet' },
  mobile: { width: 390, height: 844, label: 'Mobile' },
};
const PAGE_VIEW_RAIL_WIDTH = 18;
const VIEWPORT_HEIGHT_PROPERTIES = [
  'height',
  'min-height',
  'max-height',
  'block-size',
  'min-block-size',
  'max-block-size',
] as const;
const VIEWPORT_HEIGHT_UNIT = /(?:^|[^a-z])(dvh|svh|lvh|vh)\b/i;

function scrollReachAtDepth(
  points: AnalyticsPageInsight['scroll'],
  depth: number,
) {
  const ordered = [
    { depth: 0, percentage: 100 },
    ...points
      .map(point => ({ depth: point.depth, percentage: point.percentage }))
      .filter(point => point.depth > 0)
      .sort((left, right) => left.depth - right.depth),
  ];
  const previous = [...ordered].reverse().find(point => point.depth <= depth) || ordered[0];
  const next = ordered.find(point => point.depth >= depth) || previous;
  if (!next || next.depth === previous.depth) return Math.max(0, Math.min(100, previous.percentage));
  const progress = (depth - previous.depth) / (next.depth - previous.depth);
  return Math.max(0, Math.min(100, previous.percentage + (next.percentage - previous.percentage) * progress));
}

function scrollRailGradient(_depth: number) {
  return 'linear-gradient(90deg, var(--kodety-accent), var(--kodety-accent-hover))';
}

function scrollRailTickColor(reach: number) {
  const strength = Math.round(30 + Math.max(0, Math.min(100, reach)) * 0.6);
  return `color-mix(in srgb, var(--kodety-accent-hover) ${strength}%, transparent)`;
}

function capPublishedViewportHeightSections(documentNode: Document, viewportHeight: number) {
  const candidates = new Map<Element, Set<string>>();
  const addCandidate = (element: Element, property: string) => {
    if (element === documentNode.documentElement || element === documentNode.body) return;
    const properties = candidates.get(element) || new Set<string>();
    properties.add(property);
    candidates.set(element, properties);
  };
  const viewportProperties = (style: CSSStyleDeclaration) => (
    VIEWPORT_HEIGHT_PROPERTIES.filter(property => VIEWPORT_HEIGHT_UNIT.test(style.getPropertyValue(property)))
  );
  documentNode.querySelectorAll<HTMLElement | SVGElement>('[style]').forEach(element => {
    viewportProperties(element.style).forEach(property => addCandidate(element, property));
  });
  const visitRules = (rules: CSSRuleList) => {
    Array.from(rules).forEach(rule => {
      if ('selectorText' in rule && 'style' in rule) {
        const styleRule = rule as CSSStyleRule;
        const properties = viewportProperties(styleRule.style);
        if (!properties.length) return;
        try {
          documentNode.querySelectorAll(styleRule.selectorText).forEach(element => {
            properties.forEach(property => addCandidate(element, property));
          });
        } catch {
          // Pseudo-elements and browser-specific selectors cannot be queried.
        }
        return;
      }
      if ('cssRules' in rule) {
        try {
          visitRules((rule as CSSGroupingRule).cssRules);
        } catch {
          // Cross-origin or disabled nested rules remain untouched.
        }
      }
    });
  };
  Array.from(documentNode.styleSheets).forEach(sheet => {
    try {
      visitRules(sheet.cssRules);
    } catch {
      // A published cross-origin stylesheet may not expose its rules.
    }
  });
  const view = documentNode.defaultView;
  if (!view) return;
  candidates.forEach((properties, element) => {
    if (!(element instanceof view.HTMLElement || element instanceof view.SVGElement)) return;
    const computed = view.getComputedStyle(element);
    properties.forEach(property => {
      const pixels = Number.parseFloat(computed.getPropertyValue(property));
      if (!Number.isFinite(pixels) || pixels < 0) return;
      element.style.setProperty(property, `${Math.min(viewportHeight, pixels)}px`);
    });
    element.setAttribute('data-kodety-analytics-vh-capped', String(viewportHeight));
  });
}

function publishedPageUrl(value: string) {
  if (!value || typeof window === 'undefined') return value;
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return value;
  }
}

function metric(value: number | null, suffix = '') {
  return value === null ? '—' : `${decimalFormatter().format(value)}${suffix}`;
}

function TopEvents({ events }: { events: AnalyticsPageEvent[] }) {
  const maximum = Math.max(...events.map(event => event.count), 1);
  return (
    <section data-kodety-onboarding="analytics-page-events" className="p-3">
      <AnalyticsSectionHeader icon={MousePointerClick} title="Principais eventos" description="Cliques e envios rastreados na página." />
      {events.length ? (
        <ol className="space-y-1">
          {events.slice(0, 16).map(event => (
            <li key={event.key} className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[6px] px-2 hover:bg-white/[.025]">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center justify-between gap-2 text-[9px]">
                  <span className="truncate text-[var(--kodety-text-secondary)]" title={event.label}>{event.label}</span>
                  <span className="shrink-0 tabular-nums text-[var(--kodety-text)]">{integerFormatter().format(event.count)}</span>
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full bg-[var(--kodety-accent)]" style={{ width: `${Math.max(4, event.count / maximum * 100)}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <AnalyticsEmptyState
          className="min-h-36 py-6"
          icon={MousePointerClick}
          title="Nenhum evento neste período"
          description="Os cliques e envios rastreados aparecerão aqui."
        />
      )}
    </section>
  );
}

export interface HtmlAnalyticsPageInsightsProps {
  insight: AnalyticsPageInsight;
  pages: AnalyticsPageOption[];
  period: AnalyticsPeriod;
  pagePath: string;
  device: AnalyticsDeviceFilter;
  loading?: boolean;
  error?: string | null;
  onPagePathChange: (pagePath: string) => void;
  onDeviceChange: (device: AnalyticsDeviceFilter) => void;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  onRetry: () => void;
}

export function HtmlAnalyticsPageInsights({
  insight,
  pages,
  period,
  pagePath,
  device,
  loading = false,
  error,
  onPagePathChange,
  onDeviceChange,
  onPeriodChange,
  onRetry,
}: HtmlAnalyticsPageInsightsProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRailRef = useRef<HTMLElement>(null);
  const previewTimersRef = useRef<number[]>([]);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [documentHeight, setDocumentHeight] = useState(PAGE_VIEWPORTS.all.height);
  const [markers, setMarkers] = useState<InsightMarker[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [scrollRailHover, setScrollRailHover] = useState<{
    depth: number;
    reach: number;
    top: number;
  } | null>(null);
  const viewport = PAGE_VIEWPORTS[device];
  const frameWidth = viewport.width;
  const naturalViewportHeight = viewport.height;
  const scale = canvasWidth > 0
    ? Math.min(1, Math.max(0.05, (canvasWidth - PAGE_VIEW_RAIL_WIDTH) / frameWidth))
    : 0.7;
  const scrollRailHeight = Math.max(1, documentHeight * scale);
  const frameUrl = useMemo(() => publishedPageUrl(insight.pageUrl), [insight.pageUrl]);
  const scrollRailTicks = useMemo(() => {
    const depths = [
      0,
      25,
      50,
      75,
      100,
      ...insight.scroll.map(item => Math.max(0, Math.min(100, item.depth))),
    ].sort((left, right) => left - right);
    return depths
      .filter((depth, index) => index === 0 || Math.abs(depth - depths[index - 1]) > 0.1)
      .map(depth => {
      const reach = scrollReachAtDepth(insight.scroll, depth);
      const major = depth % 25 === 0;
      return {
        depth,
        reach,
        width: major ? 8 : 5,
        color: scrollRailTickColor(reach),
        major,
      };
      });
  }, [insight.scroll]);
  const averageScrollDepth = insight.averageScrollDepth === null
    ? null
    : Math.max(0, Math.min(100, insight.averageScrollDepth));
  const averageFoldDepth = insight.averageFoldPx !== null && insight.averageFoldPx > 0
    ? Math.max(0, Math.min(100, insight.averageFoldPx / Math.max(1, documentHeight) * 100))
    : null;

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const update = () => setCanvasWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const clearPreviewTimers = useCallback(() => {
    previewTimersRef.current.forEach(timer => window.clearTimeout(timer));
    previewTimersRef.current = [];
  }, []);

  useEffect(() => {
    clearPreviewTimers();
    setDocumentHeight(naturalViewportHeight);
    setMarkers([]);
    setPreviewError(null);
  }, [clearPreviewTimers, frameUrl, frameWidth, naturalViewportHeight]);

  useEffect(() => clearPreviewTimers, [clearPreviewTimers]);

  const measurePreview = useCallback(() => {
    const frame = frameRef.current;
    try {
      const documentNode = frame?.contentDocument;
      if (!documentNode?.documentElement) throw new Error('A página publicada não permitiu a leitura visual.');
      capPublishedViewportHeightSections(documentNode, naturalViewportHeight);
      const body = documentNode.body;
      const height = Math.max(
        600,
        documentNode.documentElement.scrollHeight,
        documentNode.documentElement.offsetHeight,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
      );
      setDocumentHeight(Math.min(40_000, height));
      const nextMarkers = insight.topEvents.flatMap((event): InsightMarker[] => {
        if (!event.selector) return [];
        try {
          const element = documentNode.querySelector(event.selector);
          if (!element) return [];
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return [];
          return [{
            event,
            left: Math.max(0, rect.left),
            top: Math.max(0, rect.top + (frame?.contentWindow?.scrollY || 0)),
            width: rect.width,
            height: rect.height,
          }];
        } catch {
          return [];
        }
      });
      setMarkers(nextMarkers);
      setPreviewError(null);
    } catch (reason) {
      setMarkers([]);
      setPreviewError(reason instanceof Error ? reason.message : 'Não foi possível montar a visualização.');
    }
  }, [insight.topEvents, naturalViewportHeight]);

  const onFrameLoad = () => {
    clearPreviewTimers();
    // Let the exact published runtime hydrate and register its animation /
    // IntersectionObserver hooks against a normal device viewport first.
    // Expanding synchronously here makes the whole document the viewport and
    // skips the same entrance animation state visitors see on the live page.
    setDocumentHeight(naturalViewportHeight);
    previewTimersRef.current = [160, 700, 2200].map(delay => (
      window.setTimeout(measurePreview, delay)
    ));
  };
  const inspectScrollRail = (clientY: number) => {
    const rail = scrollRailRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const depth = Math.max(0, Math.min(100, (clientY - rect.top) / Math.max(1, rect.height) * 100));
    setScrollRailHover({
      depth,
      reach: scrollReachAtDepth(insight.scroll, depth),
      top: Math.max(18, Math.min(rect.height - 18, clientY - rect.top)),
    });
  };
  const navigateToScrollDepth = (clientY: number) => {
    const rail = scrollRailRef.current;
    const canvas = canvasRef.current;
    if (!rail || !canvas) return;
    const rect = rail.getBoundingClientRect();
    const depth = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
    const destination = depth * scrollRailHeight - canvas.clientHeight / 2;
    canvas.scrollTo({ top: Math.max(0, destination), behavior: 'smooth' });
  };

  return (
    <div data-kodety-onboarding="analytics-page-insights-body" className="flex h-full min-h-0 flex-col">
      <div data-kodety-onboarding="analytics-page-filters" className="shrink-0 bg-[var(--kodety-panel)] px-4 pt-5 sm:px-6">
        <AnalyticsPageHeader
          className="pb-3"
          icon={Eye}
          title="Visão de página"
          description="Eventos e profundidade sobre a página publicada."
          meta={(
            <>
              <span><Monitor className="size-2.5 shrink-0" />{viewport.label}</span>
              <span><Maximize2 className="size-2.5 shrink-0" />{frameWidth} × {naturalViewportHeight}</span>
            </>
          )}
          actions={(
            <>
              <HtmlSettingsFieldControl label="Página" kind="link">
                <Select value={pagePath || insight.pagePath} onValueChange={onPagePathChange}>
                  <SelectTrigger aria-label="Página analisada" className="w-full min-w-44 text-[11px] sm:w-56"><SelectValue placeholder="Selecione uma página" /></SelectTrigger>
                  <SelectContent>
                    {pages.map(page => (
                      <SelectItem key={page.path} value={page.runtimePath || page.path}>{page.label}</SelectItem>
                    ))}
                    {!pages.length && <SelectItem value={insight.pagePath || '/'}>{insight.pagePath || 'Página principal'}</SelectItem>}
                  </SelectContent>
                </Select>
              </HtmlSettingsFieldControl>
              <HtmlSettingsFieldControl label="Dispositivo" kind="option">
                <Select value={device} onValueChange={value => onDeviceChange(value as AnalyticsDeviceFilter)}>
                  <SelectTrigger aria-label="Filtro de dispositivo dos dados" className="w-full min-w-32 text-[11px] sm:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="desktop">Desktop</SelectItem>
                    <SelectItem value="tablet">Tablet</SelectItem>
                    <SelectItem value="mobile">Mobile</SelectItem>
                  </SelectContent>
                </Select>
              </HtmlSettingsFieldControl>
              <AnalyticsPeriodPicker period={period} onChange={onPeriodChange} compact />
            </>
          )}
        />
      </div>

      {(error || previewError) && (
        <div role="alert" className="shrink-0 border-b border-[var(--kodety-warning)]/20 bg-[var(--kodety-warning)]/[.055] px-4 py-2 text-[9px] text-[var(--kodety-warning)]">
          {error || previewError}
        </div>
      )}

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_292px]">
        <div ref={canvasRef} data-kodety-onboarding="analytics-page-preview" className="min-h-0 overflow-auto bg-[var(--kodety-workspace)]" aria-busy={loading}>
          {frameUrl ? (
            <div
              className="relative"
              style={{ width: PAGE_VIEW_RAIL_WIDTH + frameWidth * scale, height: documentHeight * scale }}
            >
              <aside
                ref={scrollRailRef}
                data-page-scroll-rail
                aria-label="Profundidade de scroll. Clique em uma posição para navegar pela página."
                className="group absolute inset-y-0 left-0 z-30 cursor-pointer select-none border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)]"
                style={{ width: PAGE_VIEW_RAIL_WIDTH }}
                onPointerMove={event => inspectScrollRail(event.clientY)}
                onPointerLeave={() => setScrollRailHover(null)}
                onClick={event => navigateToScrollDepth(event.clientY)}
              >
                <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-white/[.07]" />
                {scrollRailTicks.map(tick => (
                  <span
                    key={tick.depth}
                    className="pointer-events-none absolute right-[4px] h-px -translate-y-1/2 rounded-full"
                    style={{
                      top: `${tick.depth}%`,
                      width: tick.width,
                      background: tick.color,
                    }}
                  />
                ))}
                {averageFoldDepth !== null && (
                  <span
                    data-page-scroll-fold-marker
                    className="pointer-events-none absolute right-[2px] z-20 h-px w-[9px] -translate-y-1/2 rounded-full bg-white/45"
                    style={{ top: `${averageFoldDepth}%` }}
                    title={`Dobra média · ${integerFormatter().format(insight.averageFoldPx || 0)}px`}
                  >
                    <span className="absolute -right-px top-1/2 size-[3px] -translate-y-1/2 rounded-full bg-white/70" />
                  </span>
                )}
                {averageScrollDepth !== null && (
                  <span
                    data-page-scroll-average-marker
                    className="pointer-events-none absolute right-[2px] z-30 h-px w-[12px] -translate-y-1/2 rounded-full bg-[var(--kodety-accent-hover)]"
                    style={{ top: `${averageScrollDepth}%` }}
                    title={`Scroll médio · ${decimalFormatter().format(averageScrollDepth)}%`}
                  >
                    <span className="absolute -right-px top-1/2 size-1 -translate-y-1/2 rounded-full border border-[var(--kodety-accent-hover)] bg-[var(--kodety-panel)]" />
                  </span>
                )}
                {scrollRailHover && (
                  <span
                    className="pointer-events-none absolute left-[calc(100%+6px)] z-50 min-w-[112px] -translate-y-1/2 rounded-[7px] border border-white/[.08] bg-[var(--kodety-panel-raised)] px-2 py-1.5 text-left shadow-[var(--kodety-shadow-popover)]"
                    style={{ top: scrollRailHover.top }}
                  >
                    <span className="block text-[9px] font-semibold tabular-nums text-zinc-100">
                      {decimalFormatter().format(scrollRailHover.depth)}% da página
                    </span>
                    <span className="mt-0.5 block text-[8px] tabular-nums text-zinc-400">
                      {decimalFormatter().format(scrollRailHover.reach)}% chegaram aqui
                    </span>
                  </span>
                )}
              </aside>
              <div
                className="absolute top-0 origin-top-left overflow-hidden bg-white"
                data-page-preview-viewport={`${frameWidth}x${naturalViewportHeight}`}
                data-page-preview-device={device}
                style={{ left: PAGE_VIEW_RAIL_WIDTH, width: frameWidth, height: documentHeight, transform: `scale(${scale})` }}
              >
                <iframe
                  key={`${frameUrl}:${device}:${frameWidth}:${naturalViewportHeight}`}
                  ref={frameRef}
                  name={PUBLISHED_PREVIEW_FRAME_NAME}
                  data-kodety-published-page-preview="true"
                  title={`Analytics de ${insight.pagePath}`}
                  src={frameUrl}
                  width={frameWidth}
                  height={documentHeight}
                  className="pointer-events-none absolute inset-0 border-0 bg-white"
                  onLoad={onFrameLoad}
                />
                <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
                  {insight.averageFoldPx !== null && insight.averageFoldPx > 0 && (
                    <div className="absolute inset-x-0 border-t border-emerald-400/90" style={{ top: Math.min(documentHeight, insight.averageFoldPx) }}>
                      <span className="absolute right-2 top-1 rounded-[5px] bg-[var(--kodety-success)] px-2 py-1 text-[11px] font-semibold text-white">
                        Dobra média · {integerFormatter().format(insight.averageFoldPx)}px
                      </span>
                    </div>
                  )}
                  {markers.map(marker => (
                    <div
                      key={marker.event.key}
                      className="absolute border-2 border-[var(--kodety-accent)] bg-[var(--kodety-accent)]/10"
                      style={{ left: marker.left, top: marker.top, width: marker.width, height: marker.height }}
                    >
                      <span className="absolute -right-0.5 -top-0.5 -translate-y-full whitespace-nowrap rounded-t-[5px] border border-[var(--kodety-accent-border)] bg-[var(--kodety-panel-raised)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--kodety-accent-hover)]">
                        {marker.event.label} · {integerFormatter().format(marker.event.count)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <AnalyticsEmptyState
              className="h-full min-h-80"
              icon={Activity}
              title="A visão publicada ainda não está disponível"
              description="Publique o site para ativar a leitura visual sobre a página real."
            />
          )}
        </div>

        <aside className="min-h-0 overflow-y-auto border-t border-[var(--kodety-divider)] bg-[var(--kodety-panel)] p-3 xl:border-l xl:border-t-0">
          <AnalyticsSurface>
            <div data-kodety-analytics-metric-grid className="grid grid-cols-2 gap-px bg-[var(--kodety-divider)]">
              <AnalyticsMetric label="Sessões" value={metric(insight.totalSessions)} />
              <AnalyticsMetric label="Visitantes únicos" value={metric(insight.uniqueVisitors)} />
              <AnalyticsMetric label="Visualizações" value={metric(insight.pageviews)} />
              <AnalyticsMetric label="Taxa de rejeição" value={metric(insight.bounceRate, '%')} />
              <AnalyticsMetric label="Dobra média" value={metric(insight.averageFoldPx, 'px')} />
              <AnalyticsMetric label="Scroll médio" value={metric(insight.averageScrollDepth, '%')} />
            </div>
          </AnalyticsSurface>

          <AnalyticsSurface className="mt-3 !bg-[var(--kodety-panel)]">
            <section data-kodety-onboarding="analytics-page-scroll" className="p-3">
              <AnalyticsSectionHeader icon={Users} title="Profundidade de scroll" description="Sessões que alcançaram cada trecho." />
              <div className="space-y-2.5 py-1">
                {insight.scroll.map(item => (
                  <div key={item.depth} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 text-[9px]">
                    <span className="tabular-nums text-[var(--kodety-text-tertiary)]">{item.depth}%</span>
                    <div className="h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(item.sessions ? 3 : 0, item.percentage)}%`,
                          background: scrollRailGradient(item.depth),
                        }}
                      />
                    </div>
                    <span className="tabular-nums text-[var(--kodety-text-secondary)]">{integerFormatter().format(item.sessions)}</span>
                  </div>
                ))}
                {!insight.scroll.length ? (
                  <p className="py-5 text-center text-[9px] text-[var(--kodety-info-copy)]">Ainda sem dados de scroll.</p>
                ) : null}
              </div>
            </section>
          </AnalyticsSurface>

          <AnalyticsSurface className="mt-3 !bg-[var(--kodety-panel)]">
            <TopEvents events={insight.topEvents} />
          </AnalyticsSurface>
        </aside>
      </div>
    </div>
  );
}
