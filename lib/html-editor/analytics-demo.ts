import type {
  AnalyticsBreakdownItem,
  AnalyticsFunnel,
  AnalyticsOverview,
  AnalyticsPageInsight,
  AnalyticsPeriod,
  AnalyticsSeriesPoint,
} from './analytics';
import type { HtmlAnalyticsDataSource } from './analytics-client';

const DEMO_QUERY_VALUE = 'teste';

export function isAnalyticsDemoMode(search?: string) {
  const resolvedSearch = search ?? (typeof window === 'undefined' ? '' : window.location.search);
  return new URLSearchParams(resolvedSearch).get('value') === DEMO_QUERY_VALUE;
}

function breakdown(entries: Array<[string, number]>, keys: string[] = []): AnalyticsBreakdownItem[] {
  return entries.map(([label, value], index) => ({
    key: keys[index] || `demo-${index}-${label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    value,
  }));
}

function seriesForPeriod(period: AnalyticsPeriod): AnalyticsSeriesPoint[] {
  const start = new Date(`${period.from}T12:00:00`);
  const end = new Date(`${period.to}T12:00:00`);
  const validRange = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end >= start;
  const resolvedStart = validRange ? start : new Date(Date.now() - 29 * 86_400_000);
  const resolvedEnd = validRange ? end : new Date();
  const days = Math.max(1, Math.round((resolvedEnd.getTime() - resolvedStart.getTime()) / 86_400_000) + 1);
  const pointCount = period.preset === 'today' ? 24 : Math.min(31, Math.max(2, days));
  const span = Math.max(3_600_000, resolvedEnd.getTime() - resolvedStart.getTime());

  return Array.from({ length: pointCount }, (_, index) => {
    const progress = pointCount === 1 ? 0 : index / (pointCount - 1);
    const timestamp = new Date(resolvedStart.getTime() + span * progress).toISOString();
    const wave = Math.sin(progress * Math.PI * 2.8) * 0.12;
    const momentum = progress * 0.18;
    const uniqueVisitors = Math.round((10_000_000 / pointCount) * (0.91 + wave + momentum));
    return {
      timestamp,
      uniqueVisitors,
      pageviews: Math.round(uniqueVisitors * (3.68 + Math.cos(progress * Math.PI * 2) * 0.18)),
    };
  });
}

function overviewForPeriod(period: AnalyticsPeriod): AnalyticsOverview {
  return {
    liveVisitors: 420,
    uniqueVisitors: 10_000_000,
    totalSessions: 13_200_000,
    pageviews: 38_700_000,
    bounceRate: 18.4,
    averageSessionSeconds: 402,
    series: seriesForPeriod(period),
    sources: breakdown([
      ['Busca orgânica', 4_200_000],
      ['Direto', 2_600_000],
      ['Instagram', 1_400_000],
      ['YouTube', 980_000],
      ['LinkedIn', 460_000],
      ['Referências', 310_000],
    ]),
    pages: breakdown([
      ['/', 3_800_000],
      ['/produto/', 2_900_000],
      ['/precos/', 2_100_000],
      ['/cases/', 1_600_000],
      ['/checkout/', 880_000],
    ]),
    countries: breakdown([
      ['Brasil', 6_800_000],
      ['Estados Unidos', 1_400_000],
      ['Portugal', 760_000],
      ['Reino Unido', 410_000],
      ['Alemanha', 330_000],
      ['México', 300_000],
    ], ['BR', 'US', 'PT', 'GB', 'DE', 'MX']),
    locations: breakdown([
      ['São Paulo', 2_400_000],
      ['Rio de Janeiro', 1_150_000],
      ['Belo Horizonte', 720_000],
      ['Curitiba', 590_000],
      ['Lisboa', 410_000],
      ['Miami', 320_000],
    ], ['São Paulo|São Paulo|BR', 'Rio de Janeiro|Rio de Janeiro|BR', 'Belo Horizonte|Minas Gerais|BR', 'Curitiba|Paraná|BR', 'Lisboa|Lisboa|PT', 'Miami|Florida|US']),
    devices: breakdown([
      ['Mobile', 6_200_000],
      ['Desktop', 3_400_000],
      ['Tablet', 400_000],
    ]),
    browsers: breakdown([
      ['Chrome', 6_500_000],
      ['Safari', 2_200_000],
      ['Edge', 740_000],
      ['Firefox', 410_000],
      ['Samsung Internet', 150_000],
    ]),
    operatingSystems: breakdown([
      ['Android', 3_800_000],
      ['iOS', 2_600_000],
      ['Windows', 2_100_000],
      ['macOS', 1_300_000],
      ['Linux', 200_000],
    ]),
    tracking: breakdown([
      ['hero-cta', 2_800_000],
      ['pricing-pro', 1_900_000],
      ['checkout-start', 1_350_000],
      ['lead-form', 980_000],
      ['nav-product', 760_000],
    ]),
  };
}

function pageInsight(pagePath = '/', device: AnalyticsPageInsight['device'] = 'all'): AnalyticsPageInsight {
  const normalizedPath = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  const pageUrl = typeof window === 'undefined' ? '' : new URL(normalizedPath, window.location.origin).toString();
  return {
    pagePath: normalizedPath,
    pageUrl,
    device,
    totalSessions: 4_800_000,
    uniqueVisitors: 3_700_000,
    pageviews: 11_200_000,
    bounceRate: 12.8,
    averageFoldPx: 820,
    averageScrollDepth: 76.4,
    scroll: [
      { depth: 25, sessions: 4_450_000, percentage: 92.7 },
      { depth: 50, sessions: 3_930_000, percentage: 81.9 },
      { depth: 75, sessions: 3_210_000, percentage: 66.9 },
      { depth: 90, sessions: 2_470_000, percentage: 51.5 },
      { depth: 100, sessions: 1_860_000, percentage: 38.8 },
    ],
    topEvents: [
      { key: 'demo-hero', type: 'click', trackingId: 'hero-cta', selector: '#hero-cta', label: 'CTA principal', count: 2_800_000, uniqueVisitors: 2_180_000 },
      { key: 'demo-pricing', type: 'click', trackingId: 'pricing-pro', selector: '#pricing-pro', label: 'Plano Pro', count: 1_900_000, uniqueVisitors: 1_420_000 },
      { key: 'demo-checkout', type: 'click', trackingId: 'checkout-start', selector: '#checkout-start', label: 'Iniciar checkout', count: 1_350_000, uniqueVisitors: 970_000 },
      { key: 'demo-lead', type: 'submit', trackingId: 'lead-form', selector: '#lead-form', label: 'Enviar formulário', count: 980_000, uniqueVisitors: 842_000 },
    ],
  };
}

function demoFunnels(): AnalyticsFunnel[] {
  return [
    {
      id: 'demo-acquisition-purchase',
      name: 'Aquisição → Compra',
      enabled: true,
      filters: [],
      windowMinutes: 1440,
      canvas: { x: 0, y: 0, zoom: 1 },
      steps: [
        { id: 'demo-landing', name: 'Landing page', type: 'page', pagePath: '/', position: { x: 80, y: 140 } },
        { id: 'demo-product', name: 'Produto', type: 'page', pagePath: '/produto/', position: { x: 360, y: 140 } },
        { id: 'demo-checkout', name: 'Checkout', type: 'click', trackingId: 'checkout-start', position: { x: 640, y: 140 } },
        { id: 'demo-purchase', name: 'Compra concluída', type: 'custom', eventName: 'purchase', position: { x: 920, y: 140 } },
      ],
      connections: [
        { id: 'demo-c1', sourceStepId: 'demo-landing', targetStepId: 'demo-product', filters: [] },
        { id: 'demo-c2', sourceStepId: 'demo-product', targetStepId: 'demo-checkout', filters: [] },
        { id: 'demo-c3', sourceStepId: 'demo-checkout', targetStepId: 'demo-purchase', filters: [] },
      ],
      results: [
        { stepId: 'demo-landing', visitors: 5_200_000, conversionRate: 100 },
        { stepId: 'demo-product', visitors: 3_680_000, conversionRate: 70.8 },
        { stepId: 'demo-checkout', visitors: 1_920_000, conversionRate: 36.9 },
        { stepId: 'demo-purchase', visitors: 842_000, conversionRate: 16.2 },
      ],
    },
    {
      id: 'demo-qualified-lead',
      name: 'Lead qualificado',
      enabled: true,
      filters: [],
      windowMinutes: 10080,
      canvas: { x: 0, y: 0, zoom: 1 },
      steps: [
        { id: 'demo-content', name: 'Conteúdo', type: 'page', pagePath: '/cases/', position: { x: 80, y: 140 } },
        { id: 'demo-form', name: 'Formulário', type: 'submit', trackingId: 'lead-form', position: { x: 360, y: 140 } },
        { id: 'demo-qualified', name: 'Lead qualificado', type: 'custom', eventName: 'lead.qualified', position: { x: 640, y: 140 } },
      ],
      connections: [
        { id: 'demo-c4', sourceStepId: 'demo-content', targetStepId: 'demo-form', filters: [] },
        { id: 'demo-c5', sourceStepId: 'demo-form', targetStepId: 'demo-qualified', filters: [] },
      ],
      results: [
        { stepId: 'demo-content', visitors: 4_400_000, conversionRate: 100 },
        { stepId: 'demo-form', visitors: 2_710_000, conversionRate: 61.6 },
        { stepId: 'demo-qualified', visitors: 1_340_000, conversionRate: 30.5 },
      ],
    },
    {
      id: 'demo-product-activation',
      name: 'Ativação do produto',
      enabled: true,
      filters: [],
      windowMinutes: 4320,
      canvas: { x: 0, y: 0, zoom: 1 },
      steps: [
        { id: 'demo-signup', name: 'Cadastro', type: 'submit', trackingId: 'signup-form', position: { x: 80, y: 140 } },
        { id: 'demo-onboarding', name: 'Onboarding', type: 'page', pagePath: '/onboarding/', position: { x: 360, y: 140 } },
        { id: 'demo-first-project', name: 'Primeiro projeto', type: 'custom', eventName: 'project.created', position: { x: 640, y: 140 } },
        { id: 'demo-publish', name: 'Primeira publicação', type: 'custom', eventName: 'project.published', position: { x: 920, y: 140 } },
      ],
      connections: [
        { id: 'demo-c6', sourceStepId: 'demo-signup', targetStepId: 'demo-onboarding', filters: [] },
        { id: 'demo-c7', sourceStepId: 'demo-onboarding', targetStepId: 'demo-first-project', filters: [] },
        { id: 'demo-c8', sourceStepId: 'demo-first-project', targetStepId: 'demo-publish', filters: [] },
      ],
      results: [
        { stepId: 'demo-signup', visitors: 3_100_000, conversionRate: 100 },
        { stepId: 'demo-onboarding', visitors: 2_360_000, conversionRate: 76.1 },
        { stepId: 'demo-first-project', visitors: 1_780_000, conversionRate: 57.4 },
        { stepId: 'demo-publish', visitors: 1_220_000, conversionRate: 39.4 },
      ],
    },
  ];
}

export function createAnalyticsDemoDataSource(): HtmlAnalyticsDataSource {
  return {
    async loadOverview({ period }) {
      return overviewForPeriod(period);
    },
    async loadPageInsights({ pagePath, device }) {
      return pageInsight(pagePath, device);
    },
    async loadFunnels() {
      return demoFunnels();
    },
    async loadFunnel(id) {
      const funnel = demoFunnels().find(candidate => candidate.id === id);
      if (!funnel) throw new Error('Funil demonstrativo não encontrado.');
      return funnel;
    },
  };
}
