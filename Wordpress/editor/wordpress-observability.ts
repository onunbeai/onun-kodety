export const KODETY_OPERATION_HEADER = 'X-Kodety-Operation-Id';

export const KODETY_PERFORMANCE_OPERATIONS = [
  'bootstrap',
  'config',
  'surface',
  'asset',
  'project_download',
  'unzip',
  'parse',
  'mount',
  'save',
  'publish',
  'project_download_body',
  'project_unzip',
  'project_parse',
  'project_first_canvas_visual_ready',
] as const;

export type KodetyPerformanceOperation = typeof KODETY_PERFORMANCE_OPERATIONS[number];

export interface KodetyPerformanceDebugConfig {
  enabled: true;
  traceId: string;
}

export interface KodetyPerformanceEndpointConfig {
  projectUrl?: string;
  projectSurfaceUrl?: string;
  projectSurfaceAssetUrl?: string;
  projectChunkUrl?: string;
  projectDeltaUrl?: string;
  projectDownloadUrl?: string;
  publishUrl?: string;
}

export interface KodetyPerformanceEntry {
  traceId: string;
  operationId: string;
  operation: KodetyPerformanceOperation;
  durationMs: number;
  result?: 'ok' | 'error' | 'aborted' | 'http_error' | 'not_modified' | 'correlation_error' | 'cache_hit' | 'cache_miss' | 'fallback' | 'skipped';
  status?: number;
  revision?: number;
  bytes?: number;
  attempt?: number;
  cache?: 'hit' | 'miss' | 'bypass';
  fallback?: 'none' | 'full_project' | 'archive';
  transport?: 'surface' | 'asset' | 'project' | 'delta' | 'archive' | 'chunk' | 'publish';
}

type KodetyPerformanceFields = Omit<
  KodetyPerformanceEntry,
  'traceId' | 'operationId' | 'operation' | 'durationMs'
>;

interface PerformanceLike {
  now(): number;
  mark?(name: string): void;
  measure?(name: string, startMark?: string, endMark?: string): void;
  clearMarks?(name?: string): void;
  clearMeasures?(name?: string): void;
}

interface CryptoLike {
  randomUUID?(): string;
  getRandomValues?<T extends ArrayBufferView | null>(array: T): T;
}

export interface KodetyObservabilityEnvironment {
  performance?: PerformanceLike;
  crypto?: CryptoLike;
  exposeEntries?: (entries: readonly KodetyPerformanceEntry[]) => void;
}

export interface KodetyPerformanceSpan {
  readonly operation: KodetyPerformanceOperation;
  readonly operationId: string;
  readonly startedAt: number;
  readonly startMark: string;
  readonly fields: KodetyPerformanceFields;
}

export interface KodetyObservedRequest {
  operationId: string;
  retry(): void;
  settle(response: Response): Promise<void>;
  finish(status: number): void;
  fail(aborted?: boolean): void;
}

export interface KodetyWordPressObservability {
  readonly enabled: boolean;
  begin(
    operation: KodetyPerformanceOperation,
    fields?: Record<string, unknown>,
    operationId?: string | null,
  ): KodetyPerformanceSpan | null;
  finish(span: KodetyPerformanceSpan | null, fields?: Record<string, unknown>): void;
  startRequest(
    requestUrl: string,
    method?: string,
    operationId?: string | null,
  ): KodetyObservedRequest | null;
  entries(): readonly KodetyPerformanceEntry[];
}

const OPERATION_SET = new Set<string>(KODETY_PERFORMANCE_OPERATIONS);
const RESULT_SET = new Set([
  'ok',
  'error',
  'aborted',
  'http_error',
  'not_modified',
  'correlation_error',
  'cache_hit',
  'cache_miss',
  'fallback',
  'skipped',
]);
const CACHE_SET = new Set(['hit', 'miss', 'bypass']);
const FALLBACK_SET = new Set(['none', 'full_project', 'archive']);
const TRANSPORT_SET = new Set(['surface', 'asset', 'project', 'delta', 'archive', 'chunk', 'publish']);
// Correlation identifiers are opaque fixed-width random values, never a free
// form carrier. Keeping the exact format in PHP and the browser prevents a
// caller from smuggling a token/PII value into headers, timings or debug logs.
const OPERATION_ID_PATTERN = /^(?:obs|trace)-[0-9a-f]{32}$/;
const MAX_ENTRIES = 200;
const EMPTY_ENTRIES: readonly KodetyPerformanceEntry[] = Object.freeze([]);

const DISABLED_OBSERVABILITY: KodetyWordPressObservability = Object.freeze({
  enabled: false,
  begin: () => null,
  finish: () => undefined,
  startRequest: () => null,
  entries: () => EMPTY_ENTRIES,
});
let activeObservability = DISABLED_OBSERVABILITY;

export function isKodetyOperationId(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number)) return undefined;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

export function sanitizeWordPressObservabilityFields(
  fields: Record<string, unknown> = {},
): KodetyPerformanceFields {
  const sanitized: KodetyPerformanceFields = {};
  if (typeof fields.result === 'string' && RESULT_SET.has(fields.result)) {
    sanitized.result = fields.result as KodetyPerformanceEntry['result'];
  }
  const status = boundedInteger(fields.status, 100, 599);
  if (status !== undefined) sanitized.status = status;
  const revision = boundedInteger(fields.revision, 0, Number.MAX_SAFE_INTEGER);
  if (revision !== undefined) sanitized.revision = revision;
  const bytes = boundedInteger(fields.bytes, 0, Number.MAX_SAFE_INTEGER);
  if (bytes !== undefined) sanitized.bytes = bytes;
  const attempt = boundedInteger(fields.attempt, 0, 100);
  if (attempt !== undefined) sanitized.attempt = attempt;
  if (typeof fields.cache === 'string' && CACHE_SET.has(fields.cache)) {
    sanitized.cache = fields.cache as KodetyPerformanceEntry['cache'];
  }
  if (typeof fields.fallback === 'string' && FALLBACK_SET.has(fields.fallback)) {
    sanitized.fallback = fields.fallback as KodetyPerformanceEntry['fallback'];
  }
  if (typeof fields.transport === 'string' && TRANSPORT_SET.has(fields.transport)) {
    sanitized.transport = fields.transport as KodetyPerformanceEntry['transport'];
  }
  return sanitized;
}

function safeNow(performanceApi?: PerformanceLike) {
  const value = performanceApi?.now();
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function createOperationId(cryptoApi?: CryptoLike) {
  try {
    const uuid = cryptoApi?.randomUUID?.();
    if (uuid) {
      const candidate = `obs-${uuid.replaceAll('-', '').toLowerCase()}`;
      if (isKodetyOperationId(candidate)) return candidate;
    }
    if (cryptoApi?.getRandomValues) {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      const candidate = `obs-${Array.from(bytes as Uint8Array, byte => byte.toString(16).padStart(2, '0')).join('')}`;
      if (isKodetyOperationId(candidate)) return candidate;
    }
  } catch {
    // Explicit debug mode may run in a restricted browser context. The local
    // fallback remains an opaque correlation id and is never an authenticator.
  }
  const fallback = Array.from(
    { length: 16 },
    () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('');
  return `obs-${fallback}`;
}

interface EndpointMatcher {
  origin: string;
  pathname: string;
  action: string;
  operation: KodetyPerformanceOperation;
  transport: NonNullable<KodetyPerformanceEntry['transport']>;
  projectMethod?: boolean;
}

function endpointMatcher(
  rawUrl: string | undefined,
  operation: KodetyPerformanceOperation,
  transport: NonNullable<KodetyPerformanceEntry['transport']>,
  baseUrl: string,
  projectMethod = false,
): EndpointMatcher | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, baseUrl);
    return {
      origin: url.origin,
      pathname: url.pathname,
      action: url.searchParams.get('action') || '',
      operation,
      transport,
      projectMethod,
    };
  } catch {
    return null;
  }
}

function requestResult(status: number): NonNullable<KodetyPerformanceEntry['result']> {
  if (status === 304) return 'not_modified';
  return status >= 200 && status < 400 ? 'ok' : 'http_error';
}

export function createWordPressObservability(
  debugConfig?: KodetyPerformanceDebugConfig | null,
  endpoints: KodetyPerformanceEndpointConfig = {},
  environment?: KodetyObservabilityEnvironment,
): KodetyWordPressObservability {
  // This guard intentionally precedes every access to crypto, Performance,
  // console, window, storage, URL parsing and allocation of the debug buffer.
  if (debugConfig?.enabled !== true || !isKodetyOperationId(debugConfig.traceId)) {
    return DISABLED_OBSERVABILITY;
  }

  const runtime = environment || {};
  const performanceApi = runtime.performance
    || (typeof performance === 'undefined' ? undefined : performance);
  const cryptoApi = runtime.crypto
    || (typeof crypto === 'undefined' ? undefined : crypto);
  const baseUrl = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
  const ring: KodetyPerformanceEntry[] = [];
  const issuedSpans = new WeakSet<KodetyPerformanceSpan>();
  const finishedSpans = new WeakSet<KodetyPerformanceSpan>();
  const matchers = [
    endpointMatcher(endpoints.projectSurfaceAssetUrl, 'asset', 'asset', baseUrl),
    endpointMatcher(endpoints.projectSurfaceUrl, 'surface', 'surface', baseUrl),
    endpointMatcher(endpoints.projectDownloadUrl, 'project_download', 'project', baseUrl),
    endpointMatcher(endpoints.projectChunkUrl, 'save', 'chunk', baseUrl),
    endpointMatcher(endpoints.projectDeltaUrl, 'save', 'delta', baseUrl),
    endpointMatcher(endpoints.projectUrl, 'project_download', 'project', baseUrl, true),
    endpointMatcher(endpoints.publishUrl, 'publish', 'publish', baseUrl),
  ].filter((matcher): matcher is EndpointMatcher => Boolean(matcher));

  const exposeEntries = runtime.exposeEntries || (
    typeof window === 'undefined'
      ? undefined
      : (entries: readonly KodetyPerformanceEntry[]) => {
          (window as typeof window & { __kodetyPerformance?: readonly KodetyPerformanceEntry[] })
            .__kodetyPerformance = entries;
        }
  );
  const publishRing = () => exposeEntries?.(Object.freeze(ring.slice()));
  publishRing();

  const begin: KodetyWordPressObservability['begin'] = (operation, fields = {}, operationId) => {
    if (!OPERATION_SET.has(operation)) return null;
    const safeOperationId = isKodetyOperationId(operationId)
      ? operationId
      : createOperationId(cryptoApi);
    const startMark = `kodety:${operation}:${safeOperationId}:start`;
    performanceApi?.mark?.(startMark);
    const span = Object.freeze({
      operation,
      operationId: safeOperationId,
      startedAt: safeNow(performanceApi),
      startMark,
      fields: Object.freeze(sanitizeWordPressObservabilityFields(fields)),
    });
    issuedSpans.add(span);
    return span;
  };

  const finish: KodetyWordPressObservability['finish'] = (span, fields = {}) => {
    if (!span || !issuedSpans.has(span) || finishedSpans.has(span)) return;
    if (
      !OPERATION_SET.has(span.operation)
      || !isKodetyOperationId(span.operationId)
      || span.startMark !== `kodety:${span.operation}:${span.operationId}:start`
      || !Number.isFinite(span.startedAt)
    ) return;
    finishedSpans.add(span);
    const endedAt = safeNow(performanceApi);
    const endMark = `kodety:${span.operation}:${span.operationId}:end`;
    const measureName = `kodety:${span.operation}`;
    performanceApi?.mark?.(endMark);
    performanceApi?.clearMeasures?.(measureName);
    try {
      performanceApi?.measure?.(measureName, span.startMark, endMark);
    } catch {
      // A browser may evict marks under pressure; the bounded ring remains the
      // canonical local diagnostic record.
    }
    performanceApi?.clearMarks?.(span.startMark);
    performanceApi?.clearMarks?.(endMark);
    const entry = Object.freeze({
      traceId: debugConfig.traceId,
      operationId: span.operationId,
      operation: span.operation,
      durationMs: Math.max(0, Math.round((endedAt - span.startedAt) * 100) / 100),
      ...sanitizeWordPressObservabilityFields(span.fields as Record<string, unknown>),
      ...sanitizeWordPressObservabilityFields(fields),
    }) as KodetyPerformanceEntry;
    ring.push(entry);
    if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
    publishRing();
  };

  const startRequest: KodetyWordPressObservability['startRequest'] = (
    requestUrl,
    method = 'GET',
    operationId,
  ) => {
    let request: URL;
    try {
      request = new URL(requestUrl, baseUrl);
    } catch {
      return null;
    }
    const matcher = matchers.find(candidate => (
      candidate.origin === request.origin
      && candidate.pathname === request.pathname
      && (!candidate.action || candidate.action === request.searchParams.get('action'))
    ));
    if (!matcher) return null;
    const normalizedMethod = method.trim().toUpperCase() || 'GET';
    const operation = matcher.projectMethod && normalizedMethod !== 'GET'
      ? 'save'
      : matcher.operation;
    const revisionSource = request.searchParams.get('revision');
    const revision = revisionSource && /^\d+$/.test(revisionSource)
      ? boundedInteger(Number(revisionSource), 0, Number.MAX_SAFE_INTEGER)
      : undefined;
    const span = begin(operation, {
      transport: matcher.transport,
      cache: 'bypass',
      fallback: 'none',
      ...(revision === undefined ? {} : { revision }),
    }, operationId);
    if (!span) return null;
    let finished = false;
    let attempts = 1;
    const close = (status: number, result: NonNullable<KodetyPerformanceEntry['result']>, fields = {}) => {
      if (finished) return;
      finished = true;
      finish(span, {
        status,
        result,
        attempt: attempts,
        cache: status === 304 ? 'hit' : 'miss',
        fallback: 'none',
        ...fields,
      });
    };
    return {
      operationId: span.operationId,
      retry() {
        if (!finished) attempts = Math.min(100, attempts + 1);
      },
      async settle(response) {
        if (finished) return;
        const echoedOperationId = response.headers.get(KODETY_OPERATION_HEADER);
        const result = echoedOperationId === span.operationId
          ? requestResult(response.status)
          : 'correlation_error';
        if (!response.body || response.status === 204 || response.status === 304) {
          close(response.status, result, { bytes: 0 });
          return;
        }
        let reader: ReadableStreamDefaultReader<Uint8Array>;
        try {
          reader = response.clone().body!.getReader();
        } catch {
          close(response.status, 'error');
          return;
        }
        let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value?.byteLength || 0;
          }
          close(response.status, result, { bytes });
        } catch (error) {
          if (finished) return;
          finished = true;
          finish(span, {
            result: error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'error',
            attempt: attempts,
            cache: 'bypass',
            fallback: 'none',
          });
        } finally {
          reader.releaseLock();
        }
      },
      finish(status) {
        close(status, requestResult(status));
      },
      fail(aborted = false) {
        if (finished) return;
        finished = true;
        finish(span, {
          result: aborted ? 'aborted' : 'error',
          attempt: attempts,
          cache: 'bypass',
          fallback: 'none',
        });
      },
    };
  };

  return Object.freeze({
    enabled: true,
    begin,
    finish,
    startRequest,
    entries: () => ring.slice(),
  });
}

export function initializeWordPressObservability(
  debugConfig?: KodetyPerformanceDebugConfig | null,
  endpoints: KodetyPerformanceEndpointConfig = {},
  environment?: KodetyObservabilityEnvironment,
) {
  activeObservability = createWordPressObservability(debugConfig, endpoints, environment);
  return activeObservability;
}

/** Shared module-local instance for lazy WordPress surfaces and import paths. */
export function wordpressObservability() {
  return activeObservability;
}
