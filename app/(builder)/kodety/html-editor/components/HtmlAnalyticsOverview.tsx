'use client';

import { useId, type ComponentType, type ReactNode } from 'react';
import {
  Activity,
  AppWindow,
  FileText,
  Globe2,
  Hash,
  Laptop,
  Link2,
  Mail,
  MapPin,
  Monitor,
  MousePointer2,
  MousePointerClick,
  Search,
  Smartphone,
  Tablet,
} from '@/components/ui/gravity-icons';
import { getAdminDateTimeFormatter, getAdminNumberFormatter } from '@/lib/admin-ui-locale';
import type {
  AnalyticsBreakdownItem,
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsSeriesPoint,
} from '@/lib/html-editor/analytics';
import {
  countryCodeToFlagEmoji,
  resolveAnalyticsCountryCode,
  resolveAnalyticsDeviceVisual,
  resolveAnalyticsSourceVisual,
  type AnalyticsSourceVisual,
} from '@/lib/html-editor/analytics-display';
import { localeFlagAssetUrl } from '@/lib/html-editor/locale-flag-assets';
import {
  AnalyticsEmptyState,
  AnalyticsMetric,
  AnalyticsPageHeader,
  AnalyticsPeriodPicker,
  AnalyticsRefreshButton,
  AnalyticsSectionHeader,
  AnalyticsSurface,
} from './HtmlAnalyticsUi';

function formatNumber(value: number | null) {
  return value === null ? '—' : getAdminNumberFormatter({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDuration(value: number | null) {
  if (value === null) return '—';
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}h${minutes.toString().padStart(2, '0')}m` : minutes ? `${minutes}m${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${getAdminNumberFormatter({ maximumFractionDigits: 1 }).format(value)}%`;
}

function EmptyChart() {
  return (
    <AnalyticsEmptyState
      className="min-h-64"
      icon={Activity}
      title="Ainda não há tráfego neste período"
      description="O gráfico aparecerá assim que eventos reais forem recebidos."
    />
  );
}

function pointsFor(points: AnalyticsSeriesPoint[], key: 'uniqueVisitors' | 'pageviews') {
  if (!points.length) return '';
  const width = 1000;
  const height = 220;
  const values = points.flatMap(point => [point.uniqueVisitors, point.pageviews]);
  const maximum = Math.max(...values, 1);
  return points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - (point[key] / maximum) * (height - 20);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function firstLastDate(points: AnalyticsSeriesPoint[]) {
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : getAdminDateTimeFormatter({ day: '2-digit', month: 'short' }).format(parsed);
  };
  return points.length ? [date(points[0].timestamp), date(points[points.length - 1].timestamp)] : ['', ''];
}

function TrafficChart({ points }: { points: AnalyticsSeriesPoint[] }) {
  const gradientId = useId().replace(/:/g, '');
  if (!points.length) return <EmptyChart />;
  const [startDate, endDate] = firstLastDate(points);
  const visitors = pointsFor(points, 'uniqueVisitors');
  const pageviews = pointsFor(points, 'pageviews');
  const single = points.length === 1;
  const singleVisitor = visitors.split(' ')[0]?.split(',') || [];
  const singlePageview = pageviews.split(' ')[0]?.split(',') || [];
  return (
    <figure className="px-4 pb-4" aria-label="Visitantes únicos e visualizações ao longo do período">
      <div className="mb-2 flex items-center gap-5 text-[9px] text-[var(--kodety-info-copy)]">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--kodety-success)]" />Visualizações</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--kodety-accent)]" />Visitantes únicos</span>
      </div>
      <svg
        viewBox="0 0 1000 240"
        preserveAspectRatio="none"
        className="h-56 w-full overflow-visible"
        role="img"
      >
        <title>Tráfego no período selecionado</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--kodety-success)" stopOpacity=".15" />
            <stop offset="100%" stopColor="var(--kodety-success)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 75, 130, 185, 220].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="var(--kodety-divider)" strokeWidth="1" />)}
        {!single && <>
          <polyline points={`0,220 ${pageviews} 1000,220`} fill={`url(#${gradientId})`} stroke="none" />
          <polyline points={pageviews} fill="none" stroke="var(--kodety-success)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <polyline points={visitors} fill="none" stroke="var(--kodety-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </>}
        {single && <>
          <circle cx={singlePageview[0]} cy={singlePageview[1]} r="5" fill="var(--kodety-success)" />
          <circle cx={singleVisitor[0]} cy={singleVisitor[1]} r="5" fill="var(--kodety-accent)" />
        </>}
      </svg>
      <figcaption className="flex justify-between text-[9px] text-[var(--kodety-text-tertiary)]">
        <span>{startDate}</span><span>{endDate}</span>
      </figcaption>
    </figure>
  );
}

type BreakdownVisual = 'source' | 'country' | 'location' | 'device';

const SOURCE_BRAND_PATHS: Partial<Record<AnalyticsSourceVisual, string>> = {
  google: 'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z',
  facebook: 'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  instagram: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
  youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  x: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
  pinterest: 'M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z',
  whatsapp: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z',
  telegram: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
};

function ItemIconFrame({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center text-[#a3a3a3]">{children}</span>;
}

function CountryFlag({ item, location = false }: { item: AnalyticsBreakdownItem; location?: boolean }) {
  const countryCode = resolveAnalyticsCountryCode(item);
  const assetUrl = localeFlagAssetUrl(countryCode);
  if (assetUrl) {
    return (
      <ItemIconFrame>
        <img
          src={assetUrl}
          alt=""
          className="block h-3 w-4 rounded-[2px] object-cover ring-1 ring-white/10"
          draggable={false}
        />
      </ItemIconFrame>
    );
  }
  const emoji = countryCodeToFlagEmoji(countryCode);
  if (emoji) return <ItemIconFrame><span className="text-[13px] leading-none">{emoji}</span></ItemIconFrame>;
  const FallbackIcon = location ? MapPin : Globe2;
  return <ItemIconFrame><FallbackIcon className="size-3.5" /></ItemIconFrame>;
}

function SourceIcon({ item }: { item: AnalyticsBreakdownItem }) {
  const visual = resolveAnalyticsSourceVisual(item);
  const brandPath = visual ? SOURCE_BRAND_PATHS[visual] : '';
  if (brandPath) {
    return (
      <ItemIconFrame>
        <svg viewBox="0 0 24 24" className="size-3.5 fill-current" focusable="false">
          <path d={brandPath} />
        </svg>
      </ItemIconFrame>
    );
  }
  const Icon = visual === 'direct'
    ? MousePointer2
    : visual === 'search'
      ? Search
      : visual === 'email'
        ? Mail
        : visual === 'referral'
          ? Link2
          : Globe2;
  return <ItemIconFrame><Icon className="size-3.5" /></ItemIconFrame>;
}

function DeviceIcon({ item }: { item: AnalyticsBreakdownItem }) {
  const device = resolveAnalyticsDeviceVisual(item);
  const Icon = device === 'mobile'
    ? Smartphone
    : device === 'tablet'
      ? Tablet
      : device === 'desktop'
        ? Monitor
        : Laptop;
  return <ItemIconFrame><Icon className="size-3.5" /></ItemIconFrame>;
}

function BreakdownItemIcon({
  item,
  visual,
  fallbackIcon: FallbackIcon,
}: {
  item: AnalyticsBreakdownItem;
  visual?: BreakdownVisual;
  fallbackIcon: ComponentType<{ className?: string }>;
}) {
  if (visual === 'source') return <SourceIcon item={item} />;
  if (visual === 'country') return <CountryFlag item={item} />;
  if (visual === 'location') return <CountryFlag item={item} location />;
  if (visual === 'device') return <DeviceIcon item={item} />;
  return <ItemIconFrame><FallbackIcon className="size-3.5" /></ItemIconFrame>;
}

function Breakdown({
  title,
  items,
  icon: Icon,
  itemIcon,
  emptyLabel,
  visual,
}: {
  title: string;
  items: AnalyticsBreakdownItem[];
  icon: ComponentType<{ className?: string }>;
  itemIcon?: ComponentType<{ className?: string }>;
  emptyLabel: string;
  visual?: BreakdownVisual;
}) {
  const maximum = Math.max(...items.map(item => item.value), 1);
  return (
    <section className="min-w-0 bg-[var(--kodety-panel)] px-4 pb-4 pt-1">
      <AnalyticsSectionHeader icon={Icon} title={title} />
      {items.length ? (
        <ol className="space-y-0.5">
          {items.slice(0, 8).map(item => (
            <li key={item.key} className="relative grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-[6px] bg-[#181818] px-2.5">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 bg-[#242424]"
                style={{ width: `${Math.max(3, (item.value / maximum) * 100)}%` }}
              />
              <span className="relative flex min-w-0 items-center gap-2 text-[10px] text-[var(--kodety-text-secondary)]">
                <BreakdownItemIcon
                  item={item}
                  visual={visual}
                  fallbackIcon={itemIcon || Icon}
                />
                <span className="min-w-0 truncate" title={item.label}>{item.label}</span>
              </span>
              <span className="relative text-[10px] font-medium tabular-nums text-[var(--kodety-text)]">{getAdminNumberFormatter().format(item.value)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="py-8 text-center text-[10px] text-[var(--kodety-info-copy)]">{emptyLabel}</p>}
    </section>
  );
}

export interface AnalyticsOverviewPanelProps {
  overview: AnalyticsOverview;
  period: AnalyticsPeriod;
  loading?: boolean;
  error?: string | null;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  onRetry?: () => void;
}

export function AnalyticsOverviewPanel({
  overview,
  period,
  loading = false,
  error,
  onPeriodChange,
  onRetry,
}: AnalyticsOverviewPanelProps) {
  return (
    <div data-kodety-onboarding="analytics-overview-body" className="mx-auto w-full max-w-[1180px] px-4 pb-12 pt-6 sm:px-7 lg:px-9">
      <AnalyticsPageHeader
        className="border-b-0"
        icon={Activity}
        title="Visão geral"
        description="Tráfego e comportamento reais do site."
        meta={<span>Métricas no fuso {period.timezone || 'local'}</span>}
        actions={(
          <div data-kodety-onboarding="analytics-overview-period"><AnalyticsPeriodPicker period={period} onChange={onPeriodChange} compact /></div>
        )}
      />

      {error && (
        <AnalyticsSurface className="mt-4 !bg-[var(--kodety-panel)] border-l-2 !border-l-[var(--kodety-danger)]">
          <div role="alert" className="flex items-center justify-between gap-4 px-4 py-3">
            <div><p className="text-[11px] font-medium text-[var(--kodety-text)]">Não foi possível carregar o Analytics</p><p className="mt-0.5 text-[10px] text-[var(--kodety-info-copy)]">{error}</p></div>
            {onRetry ? <AnalyticsRefreshButton label="Tentar novamente" loading={loading} onClick={onRetry} /> : null}
          </div>
        </AnalyticsSurface>
      )}

      <div aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <AnalyticsSurface onboardingId="analytics-overview-metrics" className="mt-5">
          <div data-kodety-analytics-metric-grid className="grid grid-cols-2 gap-px bg-[var(--kodety-divider)] sm:grid-cols-3 lg:grid-cols-6">
            <AnalyticsMetric label="Visitantes ao vivo" value={formatNumber(overview.liveVisitors)} live tone="accent" />
            <AnalyticsMetric label="Visitantes únicos" value={formatNumber(overview.uniqueVisitors)} />
            <AnalyticsMetric label="Sessões" value={formatNumber(overview.totalSessions)} />
            <AnalyticsMetric label="Visualizações" value={formatNumber(overview.pageviews)} />
            <AnalyticsMetric label="Taxa de rejeição" value={formatPercent(overview.bounceRate)} />
            <AnalyticsMetric label="Sessão média" value={formatDuration(overview.averageSessionSeconds)} />
          </div>
        </AnalyticsSurface>

        <AnalyticsSurface onboardingId="analytics-overview-trend" className="mt-4">
          <AnalyticsSectionHeader className="px-4" icon={Activity} title="Tráfego" />
          <TrafficChart points={overview.series} />
        </AnalyticsSurface>

        <AnalyticsSurface onboardingId="analytics-overview-breakdowns" className="mt-4 bg-[var(--kodety-divider)]!">
          <div className="grid gap-px lg:grid-cols-2">
            <Breakdown title="Fontes" items={overview.sources} icon={Globe2} emptyLabel="Nenhuma fonte registrada" visual="source" />
            <Breakdown title="Páginas" items={overview.pages} icon={FileText} emptyLabel="Nenhuma página visualizada" />
            <Breakdown title="Países" items={overview.countries} icon={Globe2} emptyLabel="Nenhum país identificado" visual="country" />
            <Breakdown title="Dispositivos" items={overview.devices} icon={Laptop} emptyLabel="Nenhum dispositivo identificado" visual="device" />
            <Breakdown title="Cidades e regiões" items={overview.locations} icon={MapPin} emptyLabel="Nenhuma localização aproximada identificada" visual="location" />
            <Breakdown title="Navegadores" items={overview.browsers} icon={AppWindow} emptyLabel="Nenhum navegador identificado" />
            <Breakdown title="Sistemas operacionais" items={overview.operatingSystems} icon={Monitor} emptyLabel="Nenhum sistema identificado" />
            <Breakdown title="Tracking IDs" items={overview.tracking} icon={MousePointerClick} itemIcon={Hash} emptyLabel="Nenhum Tracking ID recebeu eventos" />
          </div>
        </AnalyticsSurface>
      </div>
      {loading && !error && <p className="sr-only" role="status">Carregando métricas de Analytics.</p>}
    </div>
  );
}
