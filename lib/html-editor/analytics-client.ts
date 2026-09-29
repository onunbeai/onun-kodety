import {
  normalizeAnalyticsPageInsight,
  normalizeAnalyticsOverview,
  type AnalyticsFunnel,
  type AnalyticsFunnelInput,
  type AnalyticsOverview,
  type AnalyticsOverviewRequest,
  type AnalyticsPageInsight,
  type AnalyticsPageInsightRequest,
} from './analytics';

export interface HtmlAnalyticsApiConfig {
  baseUrl?: string;
  overviewUrl: string;
  pageInsightsUrl?: string;
  funnelsUrl: string;
  funnelItemUrl?: string;
  emailOptionsUrl?: string;
  nonce?: string;
  nonceHeader?: string;
  credentials?: RequestCredentials;
  readOnly?: boolean;
  requestTimeoutMs?: number;
}

export interface HtmlAnalyticsDataSource {
  loadOverview: (request: AnalyticsOverviewRequest) => Promise<AnalyticsOverview>;
  loadPageInsights?: (request: AnalyticsPageInsightRequest) => Promise<AnalyticsPageInsight>;
  loadFunnels: (request: AnalyticsOverviewRequest) => Promise<AnalyticsFunnel[]>;
  loadFunnel?: (id: string, request: AnalyticsOverviewRequest) => Promise<AnalyticsFunnel>;
  createFunnel?: (input: AnalyticsFunnelInput) => Promise<AnalyticsFunnel>;
  updateFunnel?: (id: string, input: AnalyticsFunnelInput) => Promise<AnalyticsFunnel>;
  deleteFunnel?: (id: string) => Promise<void>;
}

const DEFAULT_ANALYTICS_REQUEST_TIMEOUT_MS = 20_000;

function timedRequestSignal(parent: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose() {
      clearTimeout(timeout);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

function absoluteUrl(value: string, baseUrl?: string) {
  if (typeof window === 'undefined' && !baseUrl && !/^https?:\/\//i.test(value)) {
    throw new Error('baseUrl é obrigatório para URLs relativas fora do navegador.');
  }
  return new URL(value, baseUrl || window.location.href);
}

function itemUrl(config: HtmlAnalyticsApiConfig, id: string) {
  const encoded = encodeURIComponent(id);
  const template = config.funnelItemUrl;
  if (template) return template.includes('{id}') ? template.replaceAll('{id}', encoded) : `${template.replace(/\/$/, '')}/${encoded}`;
  const url = absoluteUrl(config.funnelsUrl, config.baseUrl);
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute) url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}/${encoded}`);
  else url.pathname = `${url.pathname.replace(/\/$/, '')}/${encoded}`;
  return url.toString();
}

async function requestJson<T>(
  config: HtmlAnalyticsApiConfig,
  url: string | URL,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (config.nonce) headers.set(config.nonceHeader || 'X-WP-Nonce', config.nonce);
  const request = timedRequestSignal(
    init.signal,
    config.requestTimeoutMs || DEFAULT_ANALYTICS_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      ...init,
      headers,
      credentials: config.credentials || 'same-origin',
      signal: request.signal,
    });
    const payload = await response.json().catch(error => {
      // Invalid/non-JSON error bodies are handled below, but an abort while
      // streaming the body must not be mistaken for a successful null payload.
      if (request.signal.aborted) throw error;
      return null;
    });
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message?: unknown }).message)
        : `Analytics respondeu com HTTP ${response.status}.`;
      throw new Error(message);
    }
    return payload as T;
  } catch (error) {
    if (request.didTimeOut()) {
      throw new Error('O Analytics demorou demais para responder. Tente novamente.');
    }
    throw error;
  } finally {
    request.dispose();
  }
}

function periodUrl(config: HtmlAnalyticsApiConfig, value: string, request: AnalyticsOverviewRequest) {
  const url = absoluteUrl(value, config.baseUrl);
  url.searchParams.set('preset', request.period.preset);
  url.searchParams.set('from', request.period.from);
  url.searchParams.set('to', request.period.to);
  if (request.period.timezone) url.searchParams.set('timezone', request.period.timezone);
  return url;
}

function unwrapFunnel(payload: unknown): AnalyticsFunnel {
  const value = payload && typeof payload === 'object' && 'funnel' in payload
    ? (payload as { funnel: unknown }).funnel
    : payload;
  if (!value || typeof value !== 'object' || typeof (value as Partial<AnalyticsFunnel>).id !== 'string') {
    throw new Error('O servidor retornou um funil inválido.');
  }
  return value as AnalyticsFunnel;
}

export function createHtmlAnalyticsClient(config: HtmlAnalyticsApiConfig): HtmlAnalyticsDataSource {
  const source: HtmlAnalyticsDataSource = {
    async loadOverview(request) {
      const payload = await requestJson<unknown>(
        config,
        periodUrl(config, config.overviewUrl, request),
        { signal: request.signal },
      );
      const value = payload && typeof payload === 'object' && 'overview' in payload
        ? (payload as { overview: unknown }).overview
        : payload;
      return normalizeAnalyticsOverview(value);
    },
    async loadFunnels(request) {
      const url = periodUrl(config, config.funnelsUrl, request);
      url.searchParams.set('summary', '1');
      const payload = await requestJson<unknown>(
        config,
        url,
        { signal: request.signal },
      );
      const value = payload && typeof payload === 'object' && 'funnels' in payload
        ? (payload as { funnels: unknown }).funnels
        : payload;
      return Array.isArray(value) ? value as AnalyticsFunnel[] : [];
    },
    async loadFunnel(id, request) {
      const payload = await requestJson<unknown>(
        config,
        periodUrl(config, itemUrl(config, id), request),
        { signal: request.signal },
      );
      return unwrapFunnel(payload);
    },
  };
  if (config.pageInsightsUrl) {
    source.loadPageInsights = async (request) => {
      const url = periodUrl(config, config.pageInsightsUrl || '', request);
      if (request.pagePath) url.searchParams.set('page', request.pagePath);
      if (request.device && request.device !== 'all') url.searchParams.set('device', request.device);
      const payload = await requestJson<unknown>(
        config,
        url,
        { signal: request.signal },
      );
      const value = payload && typeof payload === 'object' && 'insight' in payload
        ? (payload as { insight: unknown }).insight
        : payload;
      return normalizeAnalyticsPageInsight(value);
    };
  }
  if (!config.readOnly) {
    source.createFunnel = async (input) => {
      const payload = await requestJson<unknown>(
        config,
        absoluteUrl(config.funnelsUrl, config.baseUrl),
        { method: 'POST', body: JSON.stringify(input) },
      );
      return unwrapFunnel(payload);
    };
    source.updateFunnel = async (id, input) => {
      const payload = await requestJson<unknown>(
        config,
        absoluteUrl(itemUrl(config, id), config.baseUrl),
        { method: 'PUT', body: JSON.stringify(input) },
      );
      return unwrapFunnel(payload);
    };
    source.deleteFunnel = async (id) => {
      await requestJson<unknown>(
        config,
        absoluteUrl(itemUrl(config, id), config.baseUrl),
        { method: 'DELETE' },
      );
    };
  }
  return source;
}
