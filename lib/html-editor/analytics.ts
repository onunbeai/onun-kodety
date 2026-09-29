export type AnalyticsPeriodPreset = 'today' | '7d' | '30d' | '90d' | 'custom';
export const KODETY_TRACKING_ATTRIBUTE = 'data-kodety-tracking-id';
export type AnalyticsTargetSelectorType = 'id' | 'class';

export interface AnalyticsPeriod {
  preset: AnalyticsPeriodPreset;
  from: string;
  to: string;
  timezone?: string;
}

export interface AnalyticsOverviewRequest {
  period: AnalyticsPeriod;
  signal?: AbortSignal;
}

export type AnalyticsDeviceFilter = 'all' | 'desktop' | 'mobile' | 'tablet';

export interface AnalyticsPageInsightRequest extends AnalyticsOverviewRequest {
  pagePath?: string;
  device?: AnalyticsDeviceFilter;
}

export interface AnalyticsSeriesPoint {
  timestamp: string;
  uniqueVisitors: number;
  pageviews: number;
}

export interface AnalyticsBreakdownItem {
  key: string;
  label: string;
  value: number;
  secondaryLabel?: string;
}

export interface AnalyticsTrackingTarget {
  id: string;
  label: string;
  type: 'click' | 'submit' | 'custom';
  pagePath?: string;
  enabled?: boolean;
  /**
   * Optional document selector metadata used by searchable Analytics pickers.
   * Older projects only provide `id`; those targets remain valid and are
   * presented as ID targets by the A/B workspace.
   */
  selectorType?: AnalyticsTargetSelectorType;
  /** Raw HTML id/class token, without a leading `#` or `.`. */
  selectorValue?: string;
  /** Number of source-document elements represented by this target. */
  matchCount?: number;
}

export interface AnalyticsOverview {
  liveVisitors: number | null;
  totalSessions: number | null;
  uniqueVisitors: number | null;
  pageviews: number | null;
  bounceRate: number | null;
  averageSessionSeconds: number | null;
  series: AnalyticsSeriesPoint[];
  sources: AnalyticsBreakdownItem[];
  pages: AnalyticsBreakdownItem[];
  countries: AnalyticsBreakdownItem[];
  locations: AnalyticsBreakdownItem[];
  devices: AnalyticsBreakdownItem[];
  browsers: AnalyticsBreakdownItem[];
  operatingSystems: AnalyticsBreakdownItem[];
  tracking: AnalyticsBreakdownItem[];
}

export interface AnalyticsScrollReach {
  depth: number;
  sessions: number;
  percentage: number;
}

export interface AnalyticsPageEvent {
  key: string;
  type: string;
  trackingId: string;
  selector: string;
  label: string;
  count: number;
  uniqueVisitors: number;
}

export interface AnalyticsPageInsight {
  pagePath: string;
  pageUrl: string;
  device: AnalyticsDeviceFilter;
  totalSessions: number | null;
  uniqueVisitors: number | null;
  pageviews: number | null;
  bounceRate: number | null;
  averageFoldPx: number | null;
  averageScrollDepth: number | null;
  scroll: AnalyticsScrollReach[];
  topEvents: AnalyticsPageEvent[];
}

export type AnalyticsFunnelStepType = 'page' | 'click' | 'submit' | 'custom' | 'experiment' | 'email' | 'webhook';

export interface AnalyticsFunnelStep {
  id: string;
  name: string;
  type: AnalyticsFunnelStepType;
  pagePath?: string;
  trackingId?: string;
  eventName?: string;
  experimentId?: string;
  variantId?: string;
  emailAction?: 'upsert-contact' | 'add-to-list';
  emailListId?: number;
  emailField?: string;
  nameField?: string;
  consentField?: string;
  webhookUrl?: string;
  webhookMethod?: 'POST' | 'PUT' | 'PATCH';
  webhookPayloadMode?: 'submission' | 'fields';
  webhookEvent?: string;
  /** Safe metadata used when the endpoint itself is hidden from read-only users. */
  webhookUrlConfigured?: boolean;
  webhookEndpoint?: string;
  /** New signing secret. It is write-only and is never returned by the API. */
  webhookSecret?: string;
  /** Safe API metadata indicating that a signing secret already exists. */
  webhookSecretConfigured?: boolean;
  /** Explicitly removes the stored signing secret on the next save. */
  webhookSecretClear?: boolean;
  position?: { x: number; y: number };
}

export interface AnalyticsFunnelConnection {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  label?: string;
  /** Earliest allowed transition after the source event. */
  minDelayMinutes?: number;
  /** Latest allowed transition; 0 inherits the funnel window. */
  maxDelayMinutes?: number;
  filters?: AnalyticsFunnelFilter[];
}

export interface AnalyticsFunnelCanvas {
  x: number;
  y: number;
  zoom: number;
}

export interface AnalyticsFunnelConnectionResult {
  connectionId: string;
  visitors: number;
  conversionRate: number | null;
}

export type AnalyticsFilterOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'not-contains'
  | 'starts-with'
  | 'ends-with';

export interface AnalyticsFunnelFilter {
  id: string;
  field: 'page' | 'referrer' | 'country' | 'device' | 'utm-source' | 'utm-campaign' | 'property';
  operator: AnalyticsFilterOperator;
  value: string;
  property?: string;
}

export interface AnalyticsFunnelStepResult {
  stepId: string;
  visitors: number;
  conversionRate: number | null;
}

export interface AnalyticsFunnel {
  id: string;
  name: string;
  enabled: boolean;
  steps: AnalyticsFunnelStep[];
  filters: AnalyticsFunnelFilter[];
  connections?: AnalyticsFunnelConnection[];
  canvas?: AnalyticsFunnelCanvas;
  /**
   * Conversion window in minutes: a visitor only counts toward the funnel if
   * every step is reached within this many minutes of entering the first step.
   * `0` (the default) means no time limit.
   */
  windowMinutes?: number;
  results?: AnalyticsFunnelStepResult[];
  connectionResults?: AnalyticsFunnelConnectionResult[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AnalyticsFunnelInput {
  name: string;
  enabled: boolean;
  steps: AnalyticsFunnelStep[];
  filters: AnalyticsFunnelFilter[];
  connections: AnalyticsFunnelConnection[];
  canvas: AnalyticsFunnelCanvas;
  windowMinutes?: number;
}

export const KODETY_FUNNEL_EXPORT_KIND = 'kodety-funnel';
export const KODETY_FUNNEL_EXPORT_VERSION = 1;

export interface KodetyFunnelExport {
  kind: typeof KODETY_FUNNEL_EXPORT_KIND;
  version: typeof KODETY_FUNNEL_EXPORT_VERSION;
  exportedAt: string;
  funnel: AnalyticsFunnelInput;
}

/** Upper bound for the funnel conversion window (30 days, in minutes). */
export const MAX_FUNNEL_WINDOW_MINUTES = 43200;

export function emptyAnalyticsOverview(): AnalyticsOverview {
  return {
    liveVisitors: null,
    totalSessions: null,
    uniqueVisitors: null,
    pageviews: null,
    bounceRate: null,
    averageSessionSeconds: null,
    series: [],
    sources: [],
    pages: [],
    countries: [],
    locations: [],
    devices: [],
    browsers: [],
    operatingSystems: [],
    tracking: [],
  };
}

export function emptyAnalyticsPageInsight(): AnalyticsPageInsight {
  return {
    pagePath: '/',
    pageUrl: '',
    device: 'all',
    totalSessions: null,
    uniqueVisitors: null,
    pageviews: null,
    bounceRate: null,
    averageFoldPx: null,
    averageScrollDepth: null,
    scroll: [],
    topEvents: [],
  };
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeBreakdown(items: unknown): AnalyticsBreakdownItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<AnalyticsBreakdownItem>;
    const value = finiteNonNegative(candidate.value);
    if (value === null) return [];
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    if (!label) return [];
    return [{
      key: typeof candidate.key === 'string' && candidate.key.trim() ? candidate.key : `${label}:${index}`,
      label,
      value,
      secondaryLabel: typeof candidate.secondaryLabel === 'string' ? candidate.secondaryLabel : undefined,
    }];
  });
}

export function normalizeAnalyticsOverview(value: unknown): AnalyticsOverview {
  if (!value || typeof value !== 'object') return emptyAnalyticsOverview();
  const candidate = value as Partial<AnalyticsOverview>;
  const series = Array.isArray(candidate.series)
    ? candidate.series.flatMap((point) => {
      if (!point || typeof point !== 'object') return [];
      const timestamp = typeof point.timestamp === 'string' ? point.timestamp : '';
      const uniqueVisitors = finiteNonNegative(point.uniqueVisitors);
      const pageviews = finiteNonNegative(point.pageviews);
      if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || uniqueVisitors === null || pageviews === null) return [];
      return [{ timestamp, uniqueVisitors, pageviews }];
    }).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    : [];
  return {
    liveVisitors: finiteNonNegative(candidate.liveVisitors),
    totalSessions: finiteNonNegative(candidate.totalSessions),
    uniqueVisitors: finiteNonNegative(candidate.uniqueVisitors),
    pageviews: finiteNonNegative(candidate.pageviews),
    bounceRate: finiteNonNegative(candidate.bounceRate),
    averageSessionSeconds: finiteNonNegative(candidate.averageSessionSeconds),
    series,
    sources: normalizeBreakdown(candidate.sources),
    pages: normalizeBreakdown(candidate.pages),
    countries: normalizeBreakdown(candidate.countries),
    locations: normalizeBreakdown(candidate.locations),
    devices: normalizeBreakdown(candidate.devices),
    browsers: normalizeBreakdown(candidate.browsers),
    operatingSystems: normalizeBreakdown(candidate.operatingSystems),
    tracking: normalizeBreakdown(candidate.tracking),
  };
}

export function normalizeAnalyticsPageInsight(value: unknown): AnalyticsPageInsight {
  if (!value || typeof value !== 'object') return emptyAnalyticsPageInsight();
  const candidate = value as Partial<AnalyticsPageInsight>;
  const device = candidate.device;
  const scroll = Array.isArray(candidate.scroll)
    ? candidate.scroll.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const depth = finiteNonNegative(item.depth);
      const sessions = finiteNonNegative(item.sessions);
      const percentage = finiteNonNegative(item.percentage);
      if (depth === null || sessions === null || percentage === null || depth > 100) return [];
      return [{ depth, sessions, percentage: Math.min(100, percentage) }];
    }).sort((left, right) => left.depth - right.depth)
    : [];
  const topEvents = Array.isArray(candidate.topEvents)
    ? candidate.topEvents.flatMap((item, index) => {
      if (!item || typeof item !== 'object') return [];
      const count = finiteNonNegative(item.count);
      const uniqueVisitors = finiteNonNegative(item.uniqueVisitors);
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      if (count === null || uniqueVisitors === null || !label) return [];
      return [{
        key: typeof item.key === 'string' && item.key ? item.key : `${label}:${index}`,
        type: typeof item.type === 'string' ? item.type : 'custom',
        trackingId: typeof item.trackingId === 'string' ? item.trackingId : '',
        selector: typeof item.selector === 'string' ? item.selector : '',
        label,
        count,
        uniqueVisitors,
      }];
    })
    : [];
  return {
    pagePath: typeof candidate.pagePath === 'string' && candidate.pagePath ? candidate.pagePath : '/',
    pageUrl: typeof candidate.pageUrl === 'string' ? candidate.pageUrl : '',
    device: device === 'desktop' || device === 'mobile' || device === 'tablet' ? device : 'all',
    totalSessions: finiteNonNegative(candidate.totalSessions),
    uniqueVisitors: finiteNonNegative(candidate.uniqueVisitors),
    pageviews: finiteNonNegative(candidate.pageviews),
    bounceRate: finiteNonNegative(candidate.bounceRate),
    averageFoldPx: finiteNonNegative(candidate.averageFoldPx),
    averageScrollDepth: finiteNonNegative(candidate.averageScrollDepth),
    scroll,
    topEvents,
  };
}

export function createAnalyticsId(prefix = 'analytics') {
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${randomId}`;
}

export function createEmptyFunnel(name = 'Novo funil'): AnalyticsFunnelInput {
  return {
    name,
    enabled: true,
    steps: [
      {
        id: createAnalyticsId('step'),
        name: 'Primeira etapa',
        type: 'page',
        pagePath: '/',
        position: { x: 80, y: 140 },
      },
    ],
    filters: [],
    connections: [],
    canvas: { x: 0, y: 0, zoom: 1 },
    windowMinutes: 0,
  };
}

export function funnelToInput(funnel: AnalyticsFunnel): AnalyticsFunnelInput {
  const steps = funnel.steps.map((step, index) => ({
    ...step,
    ...(step.type === 'email' ? {
      emailAction: step.emailAction === 'add-to-list' ? 'add-to-list' as const : 'upsert-contact' as const,
    } : {}),
    ...(step.type === 'webhook' ? {
      webhookMethod: step.webhookMethod === 'PUT' || step.webhookMethod === 'PATCH'
        ? step.webhookMethod
        : 'POST' as const,
      webhookPayloadMode: step.webhookPayloadMode === 'fields' ? 'fields' as const : 'submission' as const,
      webhookEvent: step.webhookEvent || 'form.submitted',
      webhookSecret: '',
      webhookSecretClear: false,
    } : {}),
    position: step.position || { x: 80 + index * 280, y: 140 },
  }));
  const declaredConnections = Array.isArray(funnel.connections) ? funnel.connections : [];
  const connections = declaredConnections.length
    ? declaredConnections.map(connection => ({
      ...connection,
      filters: connection.filters?.map(filter => ({ ...filter })),
    }))
    : steps.slice(1).map((step, index) => ({
      id: createAnalyticsId('connection'),
      sourceStepId: steps[index].id,
      targetStepId: step.id,
      minDelayMinutes: 0,
      maxDelayMinutes: 0,
      filters: [],
    }));
  return {
    name: funnel.name,
    enabled: funnel.enabled,
    steps,
    filters: funnel.filters.map(filter => ({ ...filter })),
    connections,
    canvas: funnel.canvas || { x: 0, y: 0, zoom: 1 },
    windowMinutes: normalizeFunnelWindowMinutes(funnel.windowMinutes),
  };
}

const PORTABLE_FUNNEL_STEP_TYPES = new Set<AnalyticsFunnelStepType>([
  'page',
  'click',
  'submit',
  'custom',
  'experiment',
  'email',
  'webhook',
]);
const PORTABLE_FUNNEL_FILTER_FIELDS = new Set<AnalyticsFunnelFilter['field']>([
  'page',
  'referrer',
  'country',
  'device',
  'utm-source',
  'utm-campaign',
  'property',
]);
const PORTABLE_FUNNEL_FILTER_OPERATORS = new Set<AnalyticsFilterOperator>([
  'equals',
  'not-equals',
  'contains',
  'not-contains',
  'starts-with',
  'ends-with',
]);

function portableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function portableText(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function portableFinite(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : fallback;
}

function importPortableFilter(value: unknown): AnalyticsFunnelFilter | null {
  const raw = portableRecord(value);
  if (!raw) return null;
  const field = portableText(raw.field) as AnalyticsFunnelFilter['field'];
  const operator = portableText(raw.operator) as AnalyticsFilterOperator;
  if (!PORTABLE_FUNNEL_FILTER_FIELDS.has(field) || !PORTABLE_FUNNEL_FILTER_OPERATORS.has(operator)) {
    return null;
  }
  return {
    id: createAnalyticsId('filter'),
    field,
    operator,
    value: portableText(raw.value),
    ...(field === 'property' ? { property: portableText(raw.property) } : {}),
  };
}

/**
 * Export only the portable authoring model. Runtime results, database IDs and
 * timestamps deliberately stay out of the file so importing cannot overwrite
 * an existing funnel or carry analytics data between sites.
 */
export function serializeFunnelExport(input: AnalyticsFunnelInput): string {
  const payload: KodetyFunnelExport = {
    kind: KODETY_FUNNEL_EXPORT_KIND,
    version: KODETY_FUNNEL_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    funnel: {
      ...input,
      steps: input.steps.map(step => {
        const portableStep = {
          ...step,
          position: step.position ? { ...step.position } : undefined,
        };
        delete portableStep.webhookSecret;
        delete portableStep.webhookSecretClear;
        delete portableStep.webhookSecretConfigured;
        delete portableStep.webhookUrlConfigured;
        delete portableStep.webhookEndpoint;
        return portableStep;
      }),
      filters: input.filters.map(filter => ({ ...filter })),
      connections: input.connections.map(connection => ({
        ...connection,
        filters: connection.filters?.map(filter => ({ ...filter })),
      })),
      canvas: { ...input.canvas },
      windowMinutes: normalizeFunnelWindowMinutes(input.windowMinutes),
    },
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Accept a versioned Kodety export or a legacy bare funnel object. Every node,
 * connection and filter receives a fresh local ID, and imported funnels always
 * start paused so merely opening a file can never activate an automation.
 */
export function parseFunnelImport(value: string | unknown): AnalyticsFunnelInput {
  let decoded: unknown = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      throw new Error('O arquivo não contém JSON válido.');
    }
  }
  const envelope = portableRecord(decoded);
  if (!envelope) throw new Error('O arquivo não contém um funil válido.');
  let rawFunnel: Record<string, unknown> | null = envelope;
  if ('kind' in envelope || 'funnel' in envelope) {
    if (envelope.kind !== KODETY_FUNNEL_EXPORT_KIND) {
      throw new Error('Este arquivo não é uma exportação de funil do Kodety.');
    }
    const version = Number(envelope.version);
    if (!Number.isInteger(version) || version < 1 || version > KODETY_FUNNEL_EXPORT_VERSION) {
      throw new Error('A versão deste funil ainda não é compatível.');
    }
    rawFunnel = portableRecord(envelope.funnel);
  }
  if (!rawFunnel) throw new Error('O arquivo não contém a configuração do funil.');
  const rawSteps = Array.isArray(rawFunnel.steps) ? rawFunnel.steps.slice(0, 100) : [];
  if (!rawSteps.length) throw new Error('O funil importado precisa ter pelo menos uma etapa.');

  const importedIds = new Map<string, string>();
  const steps = rawSteps.flatMap((value, index): AnalyticsFunnelStep[] => {
    const raw = portableRecord(value);
    if (!raw) return [];
    const type = portableText(raw.type) as AnalyticsFunnelStepType;
    if (!PORTABLE_FUNNEL_STEP_TYPES.has(type)) return [];
    const sourceId = portableText(raw.id) || `step-${index}`;
    const id = createAnalyticsId('step');
    if (!importedIds.has(sourceId)) importedIds.set(sourceId, id);
    const position = portableRecord(raw.position);
    const step: AnalyticsFunnelStep = {
      id,
      name: portableText(raw.name, 120) || `Etapa ${index + 1}`,
      type,
      position: {
        x: portableFinite(position?.x, 80 + index * 280, -100000, 100000),
        y: portableFinite(position?.y, 140, -100000, 100000),
      },
    };
    if (type === 'page') step.pagePath = portableText(raw.pagePath);
    if (type === 'click' || type === 'submit') step.trackingId = portableText(raw.trackingId);
    if (type === 'custom') step.eventName = portableText(raw.eventName);
    if (type === 'experiment') {
      step.experimentId = portableText(raw.experimentId);
      step.variantId = portableText(raw.variantId);
    }
    if (type === 'email') {
      step.emailAction = raw.emailAction === 'add-to-list' ? 'add-to-list' : 'upsert-contact';
      const listId = Number(raw.emailListId);
      if (Number.isInteger(listId) && listId > 0) step.emailListId = listId;
      step.emailField = portableText(raw.emailField);
      step.nameField = portableText(raw.nameField);
      step.consentField = portableText(raw.consentField);
    }
    if (type === 'webhook') {
      step.webhookUrl = portableText(raw.webhookUrl, 2048);
      step.webhookMethod = raw.webhookMethod === 'PUT' || raw.webhookMethod === 'PATCH'
        ? raw.webhookMethod
        : 'POST';
      step.webhookPayloadMode = raw.webhookPayloadMode === 'fields' ? 'fields' : 'submission';
      step.webhookEvent = portableText(raw.webhookEvent, 128) || 'form.submitted';
      step.webhookSecret = '';
      step.webhookSecretConfigured = false;
      step.webhookSecretClear = false;
    }
    return [step];
  });
  if (!steps.length) throw new Error('O funil não possui tipos de etapa compatíveis.');

  const rawConnections = Array.isArray(rawFunnel.connections)
    ? rawFunnel.connections.slice(0, 200)
    : [];
  const connections = rawConnections.flatMap((value): AnalyticsFunnelConnection[] => {
    const raw = portableRecord(value);
    if (!raw) return [];
    const sourceStepId = importedIds.get(portableText(raw.sourceStepId));
    const targetStepId = importedIds.get(portableText(raw.targetStepId));
    if (!sourceStepId || !targetStepId || sourceStepId === targetStepId) return [];
    return [{
      id: createAnalyticsId('connection'),
      sourceStepId,
      targetStepId,
      label: portableText(raw.label, 120),
      minDelayMinutes: normalizeFunnelWindowMinutes(raw.minDelayMinutes),
      maxDelayMinutes: normalizeFunnelWindowMinutes(raw.maxDelayMinutes),
      filters: (Array.isArray(raw.filters) ? raw.filters : [])
        .slice(0, 100)
        .flatMap(filter => {
          const imported = importPortableFilter(filter);
          return imported ? [imported] : [];
        }),
    }];
  });
  const resolvedConnections = connections.length || steps.length < 2
    ? connections
    : steps.slice(1).map((step, index) => ({
      id: createAnalyticsId('connection'),
      sourceStepId: steps[index].id,
      targetStepId: step.id,
      minDelayMinutes: 0,
      maxDelayMinutes: 0,
      filters: [],
    }));
  const rawCanvas = portableRecord(rawFunnel.canvas);
  return {
    name: portableText(rawFunnel.name, 120) || 'Funil importado',
    enabled: false,
    steps,
    filters: (Array.isArray(rawFunnel.filters) ? rawFunnel.filters : [])
      .slice(0, 100)
      .flatMap(filter => {
        const imported = importPortableFilter(filter);
        return imported ? [imported] : [];
      }),
    connections: resolvedConnections,
    canvas: {
      x: portableFinite(rawCanvas?.x, 0, -100000, 100000),
      y: portableFinite(rawCanvas?.y, 0, -100000, 100000),
      zoom: portableFinite(rawCanvas?.zoom, 1, 0.1, 4),
    },
    windowMinutes: normalizeFunnelWindowMinutes(rawFunnel.windowMinutes),
  };
}

/** Clamp a conversion window to a whole number of minutes within bounds. */
export function normalizeFunnelWindowMinutes(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(MAX_FUNNEL_WINDOW_MINUTES, Math.floor(numeric));
}

export function validateFunnelInput(input: AnalyticsFunnelInput): string | null {
  if (!input.name.trim()) return 'Informe um nome para o funil.';
  if (!input.steps.length) return 'Adicione pelo menos uma etapa.';
  for (const [index, step] of input.steps.entries()) {
    if (!step.name.trim()) return `Informe o nome da etapa ${index + 1}.`;
    if (step.type === 'page' && !step.pagePath?.trim()) return `Selecione a página da etapa ${index + 1}.`;
    if (step.type === 'click' && !step.trackingId?.trim()) return `Selecione o Tracking ID da etapa ${index + 1}.`;
    if (step.type === 'submit' && !step.trackingId?.trim()) return `Selecione o formulário da etapa ${index + 1}.`;
    if (step.type === 'custom' && !step.eventName?.trim()) return `Informe o evento da etapa ${index + 1}.`;
    if (step.type === 'experiment' && !step.experimentId?.trim()) return `Selecione o teste A/B da etapa ${index + 1}.`;
    if (step.type === 'email' && !step.emailAction) return `Selecione a ação de email da etapa ${index + 1}.`;
    if (step.type === 'email' && step.emailAction === 'add-to-list' && !step.emailListId) return `Selecione a lista da etapa ${index + 1}.`;
    if (step.type === 'webhook') {
      if (!step.webhookUrl?.trim()) return `Informe a URL do webhook da etapa ${index + 1}.`;
      try {
        const endpoint = new URL(step.webhookUrl);
        if (endpoint.protocol !== 'https:' || !endpoint.hostname) throw new Error('invalid');
      } catch {
        return `Use uma URL HTTPS válida no webhook da etapa ${index + 1}.`;
      }
      if (!step.webhookEvent?.trim()) return `Informe o evento do webhook da etapa ${index + 1}.`;
      if (step.webhookMethod && !['POST', 'PUT', 'PATCH'].includes(step.webhookMethod)) {
        return `Selecione um método válido no webhook da etapa ${index + 1}.`;
      }
    }
  }
  const stepIds = new Set(input.steps.map(step => step.id));
  for (const connection of input.connections) {
    if (
      !stepIds.has(connection.sourceStepId)
      || !stepIds.has(connection.targetStepId)
      || connection.sourceStepId === connection.targetStepId
    ) return 'Revise as conexões inválidas do funil.';
    for (const filter of connection.filters || []) {
      if (!filter.value.trim()) return 'Preencha ou remova as condições vazias das conexões.';
      if (filter.field === 'property' && !filter.property?.trim()) return 'Informe a propriedade da condição personalizada.';
    }
  }
  if (input.steps.length > 1) {
    const connected = new Set(input.connections.flatMap(connection => [
      connection.sourceStepId,
      connection.targetStepId,
    ]));
    if (input.steps.some(step => !connected.has(step.id))) return 'Conecte todas as etapas antes de salvar o funil.';
  }
  const webhookSteps = input.steps.filter(step => step.type === 'webhook');
  if (webhookSteps.length) {
    const stepById = new Map(input.steps.map(step => [step.id, step]));
    const reachableActions = new Set(
      input.steps.filter(step => step.type === 'submit').map(step => step.id),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const connection of input.connections) {
        const source = stepById.get(connection.sourceStepId);
        const target = stepById.get(connection.targetStepId);
        if (
          source
          && target
          && reachableActions.has(source.id)
          && (source.type === 'submit' || source.type === 'email' || source.type === 'webhook')
          && (target.type === 'email' || target.type === 'webhook')
          && !reachableActions.has(target.id)
        ) {
          reachableActions.add(target.id);
          changed = true;
        }
      }
    }
    if (webhookSteps.some(step => !reachableActions.has(step.id))) {
      return 'Conecte cada webhook a um envio de formulário ou a outra ação iniciada por formulário.';
    }
  }
  for (const filter of input.filters) {
    if (!filter.value.trim()) return 'Preencha ou remova os filtros vazios.';
    if (filter.field === 'property' && !filter.property?.trim()) return 'Informe a propriedade do filtro personalizado.';
  }
  if (input.windowMinutes !== undefined) {
    const numeric = Number(input.windowMinutes);
    if (!Number.isFinite(numeric) || numeric < 0) return 'A janela de conversão deve ser um número de minutos válido.';
    if (numeric > MAX_FUNNEL_WINDOW_MINUTES) return 'A janela de conversão é muito longa (máx. 30 dias).';
  }
  return null;
}
