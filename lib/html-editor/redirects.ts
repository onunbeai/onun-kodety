import { getAdminUiLocale } from '../admin-ui-locale';

export type RedirectMatch = 'exact' | 'prefix' | 'wildcard';
export type RedirectStatus = 301 | 302 | 307 | 308;

export interface RedirectEntry {
  id: string;
  source: string;
  destination: string;
  match: RedirectMatch;
  status: RedirectStatus;
  preserveQuery: boolean;
  enabled: boolean;
}

export interface RedirectSettings {
  version: 1;
  entries: RedirectEntry[];
}

export interface ResolvedRedirect {
  entry: RedirectEntry;
  location: string;
  status: RedirectStatus;
  external: boolean;
}

export interface RedirectValidationIssue {
  entryId?: string;
  code:
    | 'too-many-redirects'
    | 'source-required'
    | 'destination-required'
    | 'source-invalid'
    | 'destination-invalid'
    | 'source-too-long'
    | 'destination-too-long'
    | 'reserved-source'
    | 'wildcard-required'
    | 'wildcard-not-allowed'
    | 'duplicate-source'
    | 'self-redirect'
    | 'redirect-cycle';
  message: string;
}

export interface ProjectPageRouteCollision {
  /** Canonical public route shared by more than one authored HTML file. */
  route: string;
  /** Normalized authored paths that would compete for that route. */
  pagePaths: string[];
}

export class ProjectPageRouteCollisionError extends Error {
  readonly code = 'project-page-route-collision';

  constructor(readonly collisions: ProjectPageRouteCollision[]) {
    const details = collisions
      .map(collision => `“${collision.pagePaths.join('” e “')}” → “${collision.route}”`)
      .join('; ');
    super(`Mais de uma página usa a mesma rota pública: ${details}. Renomeie um dos arquivos antes de publicar.`);
    this.name = 'ProjectPageRouteCollisionError';
  }
}

export const DEFAULT_REDIRECT_SETTINGS: RedirectSettings = {
  version: 1,
  entries: [],
};

export const MAX_REDIRECT_ENTRIES = 2_000;
export const MAX_REDIRECT_SOURCE_BYTES = 2_048;
export const MAX_REDIRECT_DESTINATION_BYTES = 4_096;

const REDIRECT_MATCHES = new Set<RedirectMatch>(['exact', 'prefix', 'wildcard']);
const REDIRECT_STATUSES = new Set<RedirectStatus>([301, 302, 307, 308]);
const RESERVED_REDIRECT_PATHS = [
  '/wp-admin',
  '/wp-login.php',
  '/wp-json',
  '/xmlrpc.php',
  '/wp-content',
  '/wp-includes',
  '/kodety',
] as const;
const ABSOLUTE_HTTP_PATTERN = /^https?:\/\//i;
const UNSAFE_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const REDIRECT_ASSET_EXTENSIONS = new Set([
  'css', 'js', 'mjs', 'cjs', 'map', 'json', 'xml', 'txt', 'webmanifest',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'm4a', 'm4v', 'mov', 'webm', 'ogg', 'wav',
  'pdf', 'zip', 'gz', 'rar', '7z', 'wasm', 'bin',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeId(value: unknown, fallback: string) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return (candidate || fallback)
    .replace(/[^A-Za-z0-9._:/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || fallback;
}

function pathFromValue(value: string) {
  if (ABSOLUTE_HTTP_PATTERN.test(value)) {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  }
  return value.split(/[?#]/, 1)[0];
}

/**
 * Redirect paths are URL paths, not project file paths. Keeping this
 * normalization in one place makes editor preview and WordPress runtime share
 * the same matching contract.
 */
export function normalizeRedirectPath(value: unknown) {
  if (typeof value !== 'string') return '';
  const encoded = pathFromValue(value.trim()).replaceAll('\\', '/');
  let raw = encoded;
  try {
    raw = decodeURIComponent(encoded);
  } catch {
    // Keep malformed legacy paths visible to validation instead of throwing
    // while loading the project.
  }
  if (!raw) return '';
  const stack: string[] = [];
  raw.split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  const normalized = `/${stack.join('/')}`.replace(/\/{2,}/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : '/';
}

export function normalizeRedirectDestination(value: unknown) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (!candidate) return '';
  if (ABSOLUTE_HTTP_PATTERN.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) return candidate;
      return parsed.toString();
    } catch {
      return candidate;
    }
  }
  if (candidate.startsWith('//') || UNSAFE_SCHEME_PATTERN.test(candidate)) return candidate;
  try {
    const parsed = new URL(candidate.startsWith('/') ? candidate : `/${candidate}`, 'https://kodety.invalid');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return candidate;
  }
}

function normalizeMatch(value: unknown, source: string): RedirectMatch {
  if (REDIRECT_MATCHES.has(value as RedirectMatch)) return value as RedirectMatch;
  if (value === 'starts-with' || value === 'path-prefix') return 'prefix';
  if (value === 'glob' || value === 'pattern') return 'wildcard';
  // Legacy rules often expressed globbing only through `*`. Canonical rules,
  // however, keep an explicitly selected match mode so validation can explain
  // the mismatch instead of silently changing the author's choice.
  if (source.includes('*')) return 'wildcard';
  return 'exact';
}

function normalizeStatus(value: unknown): RedirectStatus {
  const numeric = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return REDIRECT_STATUSES.has(numeric as RedirectStatus)
    ? numeric as RedirectStatus
    : 301;
}

export function normalizeRedirectSettings(value: unknown): RedirectSettings {
  const source = record(value);
  const rawEntries = Array.isArray(source.entries)
    ? source.entries
    : Array.isArray(source.redirects)
      ? source.redirects
      : [];
  const usedIds = new Set<string>();
  const entries = rawEntries.map((rawEntry, index): RedirectEntry => {
    const entry = record(rawEntry);
    const sourcePath = normalizeRedirectPath(
      entry.source ?? entry.from ?? entry.sourcePath ?? entry.path,
    );
    const fallbackId = `redirect-${index + 1}`;
    const baseId = normalizeId(entry.id, fallbackId);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    return {
      id,
      source: sourcePath,
      destination: normalizeRedirectDestination(
        entry.destination ?? entry.to ?? entry.target ?? entry.targetPath,
      ),
      match: normalizeMatch(entry.match ?? entry.type, sourcePath),
      status: normalizeStatus(entry.status ?? entry.code ?? entry.statusCode),
      preserveQuery: !(
        entry.preserveQuery === false
        || entry.preserveQuery === 0
        || entry.preserveQuery === 'false'
      ),
      enabled: !(
        entry.enabled === false
        || entry.enabled === 0
        || entry.enabled === 'false'
      ),
    };
  });
  return { version: 1, entries };
}

export function isReservedRedirectPath(value: string) {
  const path = normalizeRedirectPath(value).toLocaleLowerCase();
  return RESERVED_REDIRECT_PATHS.some(reserved =>
    path === reserved || path.startsWith(`${reserved}/`),
  );
}

function isRedirectAssetPath(value: string) {
  const path = normalizeRedirectPath(value);
  const filename = path.split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop()?.toLocaleLowerCase() || '' : '';
  return Boolean(extension && !['html', 'htm'].includes(extension) && REDIRECT_ASSET_EXTENSIONS.has(extension));
}

function isValidDestination(destination: string) {
  if (!destination || /\s/.test(destination)) return false;
  if (destination.startsWith('//')) return false;
  if (ABSOLUTE_HTTP_PATTERN.test(destination)) {
    try {
      const parsed = new URL(destination);
      return (
        ['http:', 'https:'].includes(parsed.protocol)
        && !parsed.username
        && !parsed.password
        && Boolean(parsed.hostname)
      );
    } catch {
      return false;
    }
  }
  return destination.startsWith('/') && !UNSAFE_SCHEME_PATTERN.test(destination);
}

function destinationPath(destination: string) {
  try {
    const parsed = new URL(destination, 'https://kodety.invalid');
    return parsed.origin === 'https://kodety.invalid'
      ? normalizeRedirectPath(parsed.pathname)
      : '';
  } catch {
    return '';
  }
}

function canonicalExactPath(path: string) {
  return normalizeRedirectPath(path).toLocaleLowerCase();
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function validateRedirectSettings(value: unknown): RedirectValidationIssue[] {
  const settings = normalizeRedirectSettings(value);
  const issues: RedirectValidationIssue[] = [];
  const enabledSources = new Map<string, string>();
  const exactTargets = new Map<string, { entryId: string; target: string }>();

  if (settings.entries.length > MAX_REDIRECT_ENTRIES) {
    issues.push({
      code: 'too-many-redirects',
      message: `O projeto aceita no máximo ${MAX_REDIRECT_ENTRIES.toLocaleString(getAdminUiLocale())} redirects.`,
    });
  }

  settings.entries.forEach(entry => {
    // Disabled drafts are intentionally allowed to remain incomplete. They do
    // not participate in matching until the author enables and validates them.
    if (!entry.enabled) return;
    if (!entry.source) {
      issues.push({ entryId: entry.id, code: 'source-required', message: 'Informe a URL de origem.' });
      return;
    }
    if (!entry.destination) {
      issues.push({ entryId: entry.id, code: 'destination-required', message: 'Informe a URL de destino.' });
      return;
    }
    if (utf8ByteLength(entry.source) > MAX_REDIRECT_SOURCE_BYTES) {
      issues.push({
        entryId: entry.id,
        code: 'source-too-long',
        message: `A origem de “${entry.id}” ultrapassa ${MAX_REDIRECT_SOURCE_BYTES.toLocaleString(getAdminUiLocale())} bytes.`,
      });
    }
    if (utf8ByteLength(entry.destination) > MAX_REDIRECT_DESTINATION_BYTES) {
      issues.push({
        entryId: entry.id,
        code: 'destination-too-long',
        message: `O destino de “${entry.source}” ultrapassa ${MAX_REDIRECT_DESTINATION_BYTES.toLocaleString(getAdminUiLocale())} bytes.`,
      });
    }
    if (/\s/.test(entry.source) || !entry.source.startsWith('/')) {
      issues.push({ entryId: entry.id, code: 'source-invalid', message: `A origem “${entry.source}” não é um caminho válido.` });
    }
    if (!isValidDestination(entry.destination)) {
      issues.push({ entryId: entry.id, code: 'destination-invalid', message: `O destino de “${entry.source}” deve ser um caminho interno ou URL http/https válida.` });
    }
    if (isReservedRedirectPath(entry.source)) {
      issues.push({ entryId: entry.id, code: 'reserved-source', message: `“${entry.source}” é uma rota protegida do WordPress/Kodety.` });
    }
    if (entry.match === 'wildcard' && !entry.source.includes('*')) {
      issues.push({ entryId: entry.id, code: 'wildcard-required', message: `Adicione * à origem “${entry.source}” para usar wildcard.` });
    }
    if (entry.match !== 'wildcard' && entry.source.includes('*')) {
      issues.push({ entryId: entry.id, code: 'wildcard-not-allowed', message: `A origem “${entry.source}” só pode usar * no modo wildcard.` });
    }
    const key = `${entry.match}:${canonicalExactPath(entry.source)}`;
    const duplicate = enabledSources.get(key);
    if (duplicate) {
      issues.push({ entryId: entry.id, code: 'duplicate-source', message: `A origem “${entry.source}” está duplicada; a prioridade ficaria ambígua.` });
    } else {
      enabledSources.set(key, entry.id);
    }

    const targetPath = destinationPath(entry.destination);
    if (
      entry.match === 'exact'
      && targetPath
      && canonicalExactPath(entry.source) === canonicalExactPath(targetPath)
    ) {
      issues.push({ entryId: entry.id, code: 'self-redirect', message: `“${entry.source}” redireciona para ela mesma.` });
    }
    if (entry.match === 'exact' && targetPath) {
      exactTargets.set(canonicalExactPath(entry.source), {
        entryId: entry.id,
        target: canonicalExactPath(targetPath),
      });
    }
  });

  const completed = new Set<string>();
  const visiting = new Set<string>();
  const reportCycles = new Set<string>();
  const visit = (source: string, lineage: string[]) => {
    if (completed.has(source)) return;
    if (visiting.has(source)) {
      const cycleStart = lineage.indexOf(source);
      lineage.slice(Math.max(0, cycleStart)).forEach(path => {
        const entryId = exactTargets.get(path)?.entryId;
        if (!entryId || reportCycles.has(entryId)) return;
        reportCycles.add(entryId);
        issues.push({
          entryId,
          code: 'redirect-cycle',
          message: `O redirect de “${path}” cria um ciclo e nunca chegaria a uma página.`,
        });
      });
      return;
    }
    visiting.add(source);
    const target = exactTargets.get(source)?.target;
    if (target && exactTargets.has(target)) visit(target, [...lineage, source]);
    visiting.delete(source);
    completed.add(source);
  };
  exactTargets.forEach((_target, source) => visit(source, []));
  return issues;
}

function redirectRawSourceError(entry: RedirectEntry) {
  const source = entry.source.trim();
  if (!source) return 'Informe a URL de origem.';
  if (!source.startsWith('/') || source.startsWith('//')) {
    return 'A origem deve ser um caminho iniciado por “/”, sem domínio.';
  }
  if (/[?#]/.test(source)) {
    return 'A origem deve conter somente o caminho, sem query string ou fragmento.';
  }
  if (/\s/.test(source)) return 'A origem não pode conter espaços.';
  return '';
}

export function redirectSettingsError(settings: RedirectSettings): string {
  for (const entry of settings.entries) {
    if (!entry.enabled) continue;
    const error = redirectRawSourceError(entry);
    if (error) return `${entry.source.trim() || 'Não definido'}: ${error}`;
  }
  return validateRedirectSettings(settings)[0]?.message || '';
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchRedirectEntry(entry: RedirectEntry, requestPath: string) {
  const candidate = normalizeRedirectPath(requestPath);
  const source = normalizeRedirectPath(entry.source);
  if (entry.match === 'exact') {
    return canonicalExactPath(candidate) === canonicalExactPath(source) ? [] : null;
  }
  if (entry.match === 'prefix') {
    const candidateLower = candidate.toLocaleLowerCase();
    const sourceLower = source.toLocaleLowerCase();
    if (
      sourceLower !== '/'
      && candidateLower !== sourceLower
      && !candidateLower.startsWith(`${sourceLower}/`)
    ) return null;
    return [sourceLower === '/'
      ? candidate.replace(/^\/+/, '')
      : candidate.slice(source.length).replace(/^\/+/, '')];
  }
  const parts = source.split('*');
  const matcher = new RegExp(`^${parts.map(escapeRegExp).join('(.*)')}/?$`, 'i');
  const match = candidate.match(matcher);
  return match ? match.slice(1) : null;
}

function applyRedirectCaptures(destination: string, captures: string[]) {
  let index = 0;
  return destination.replace(/\*/g, () => captures[index++] ?? '');
}

function appendPrefixRemainder(
  destination: string,
  remainder: string,
  destinationConsumedCapture = false,
) {
  if (!remainder || destinationConsumedCapture) return destination;
  try {
    const absolute = ABSOLUTE_HTTP_PATTERN.test(destination);
    const parsed = new URL(destination, 'https://kodety.invalid');
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/${remainder.replace(/^\/+/, '')}`
      .replace(/\/{2,}/g, '/');
    return absolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return destination;
  }
}

function matchedRedirectDestination(entry: RedirectEntry, captures: string[]) {
  return appendPrefixRemainder(
    applyRedirectCaptures(entry.destination, captures),
    entry.match === 'prefix' ? captures[0] || '' : '',
    entry.destination.includes('*'),
  );
}

function mergeQueryString(destination: string, sourceUrl: URL, preserveQuery: boolean) {
  if (!preserveQuery || !sourceUrl.search) return destination;
  const absolute = ABSOLUTE_HTTP_PATTERN.test(destination);
  const parsed = new URL(destination, 'https://kodety.invalid');
  const authoredDestinationKeys = new Set(parsed.searchParams.keys());
  sourceUrl.searchParams.forEach((value, key) => {
    // Every value from a repeated source key is retained unless the author
    // explicitly set that key on the destination.
    if (!authoredDestinationKeys.has(key)) parsed.searchParams.append(key, value);
  });
  return absolute
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function firstMatchingRedirect(
  settings: RedirectSettings,
  requestPath: string,
  blockedEntries: ReadonlySet<string>,
) {
  for (const entry of settings.entries) {
    if (!entry.enabled || !entry.source || !entry.destination || blockedEntries.has(entry.id)) continue;
    const captures = matchRedirectEntry(entry, requestPath);
    if (captures !== null) return { entry, captures };
  }
  return null;
}

/**
 * Validation can identify static exact-path cycles, while prefix and wildcard
 * rules need the concrete request path to prove whether their chain terminates.
 * Preview therefore runs the same bounded, fail-closed simulation as WordPress.
 */
function hasConcreteRedirectCycle(
  settings: RedirectSettings,
  requestUrl: URL,
  blockedEntries: ReadonlySet<string>,
) {
  const visited = new Set<string>();
  let currentPath = normalizeRedirectPath(requestUrl.pathname);
  const limit = Math.max(2, settings.entries.length + 2);
  for (let step = 0; step < limit; step += 1) {
    const canonical = canonicalExactPath(currentPath);
    if (visited.has(canonical)) return true;
    visited.add(canonical);
    const matched = firstMatchingRedirect(settings, currentPath, blockedEntries);
    if (!matched) return false;
    const destination = matchedRedirectDestination(matched.entry, matched.captures);
    if (!isValidDestination(destination)) return false;
    let target: URL;
    try {
      target = new URL(destination, requestUrl);
    } catch {
      return false;
    }
    if (target.origin !== requestUrl.origin) return false;
    currentPath = normalizeRedirectPath(target.pathname);
    if (isReservedRedirectPath(currentPath) || isRedirectAssetPath(currentPath)) return false;
  }
  // A chain longer than the number of authored rules cannot terminate without
  // re-entering a rule; fail closed even when a prefix keeps growing the path.
  return true;
}

export function resolveRedirect(
  value: unknown,
  requestUrl: string,
): ResolvedRedirect | null {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(requestUrl, 'https://kodety.invalid');
  } catch {
    return null;
  }
  if (isReservedRedirectPath(sourceUrl.pathname) || isRedirectAssetPath(sourceUrl.pathname)) return null;
  const normalized = normalizeRedirectSettings(value);
  const settings: RedirectSettings = {
    version: 1,
    entries: normalized.entries.slice(0, MAX_REDIRECT_ENTRIES),
  };
  const blockedEntries = new Set(
    validateRedirectSettings(settings)
      .map(issue => issue.entryId)
      .filter((entryId): entryId is string => Boolean(entryId)),
  );
  if (hasConcreteRedirectCycle(settings, sourceUrl, blockedEntries)) return null;
  const matched = firstMatchingRedirect(settings, sourceUrl.pathname, blockedEntries);
  if (!matched) return null;
  const { entry, captures } = matched;
  {
    const capturedDestination = matchedRedirectDestination(entry, captures);
    if (!isValidDestination(capturedDestination)) return null;
    const location = mergeQueryString(capturedDestination, sourceUrl, entry.preserveQuery);
    const targetUrl = new URL(location, sourceUrl);
    const targetPath = normalizeRedirectPath(targetUrl.pathname);
    if (
      targetUrl.origin === sourceUrl.origin
      && canonicalExactPath(targetPath) === canonicalExactPath(sourceUrl.pathname)
    ) return null;
    return {
      entry,
      location,
      status: entry.status,
      external: ABSOLUTE_HTTP_PATTERN.test(location),
    };
  }
}

function normalizeProjectPagePath(path: string) {
  return path
    .trim()
    .replaceAll('\\', '/')
    .split(/[?#]/, 1)[0]
    .replace(/^\/+|\/+$/g, '');
}

/**
 * Return the intrinsic clean route produced by an authored HTML path. Unlike
 * `publicRouteForProjectPage`, this does not apply the selected-home alias and
 * can therefore be used to prove that two physical pages will not compete for
 * the same manifest key.
 */
export function intrinsicRouteForProjectPage(path: string) {
  const normalized = normalizeProjectPagePath(path);
  if (!normalized) return '/';
  const withoutIndex = normalized.replace(/(?:^|\/)index\.html?$/i, '');
  return normalizeRedirectPath(withoutIndex.replace(/\.html?$/i, '')) || '/';
}

export function findProjectPageRouteCollisions(
  paths: readonly string[],
): ProjectPageRouteCollision[] {
  const routes = new Map<string, { route: string; pagePaths: Set<string> }>();
  paths.forEach(rawPath => {
    const pagePath = normalizeProjectPagePath(rawPath);
    if (!pagePath || !/\.html?$/i.test(pagePath)) return;
    const route = intrinsicRouteForProjectPage(pagePath);
    const key = route.toLocaleLowerCase();
    const current = routes.get(key) || { route, pagePaths: new Set<string>() };
    current.pagePaths.add(pagePath);
    routes.set(key, current);
  });
  return Array.from(routes.values())
    .filter(candidate => candidate.pagePaths.size > 1)
    .map(candidate => ({
      route: candidate.route,
      pagePaths: Array.from(candidate.pagePaths).sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.route.localeCompare(right.route));
}

export function assertUniqueProjectPageRoutes(paths: readonly string[]) {
  const collisions = findProjectPageRouteCollisions(paths);
  if (collisions.length) throw new ProjectPageRouteCollisionError(collisions);
}

export function publicRouteForProjectPage(path: string, homePath = 'index.html') {
  const normalized = normalizeProjectPagePath(path);
  const home = normalizeProjectPagePath(homePath);
  if (!normalized || normalized === home) return '/';
  if (/\/index\.html?$/i.test(normalized)) {
    return normalizeRedirectPath(normalized.replace(/\/index\.html?$/i, ''));
  }
  return normalizeRedirectPath(normalized.replace(/\.html?$/i, ''));
}

/**
 * Redirect sources intentionally remain untouched when a page is renamed:
 * the old URL is often exactly what the author wants to keep redirecting.
 * Internal destinations, however, follow the renamed page.
 */
export function remapRedirectDestination(
  value: unknown,
  previousPagePath: string,
  nextPagePath: string,
  homePath = 'index.html',
): RedirectSettings {
  const previousRoute = publicRouteForProjectPage(previousPagePath, homePath);
  const nextRoute = publicRouteForProjectPage(nextPagePath, homePath);
  const settings = normalizeRedirectSettings(value);
  return {
    version: 1,
    entries: settings.entries.map(entry => {
      if (ABSOLUTE_HTTP_PATTERN.test(entry.destination)) return entry;
      const parsed = new URL(entry.destination || '/', 'https://kodety.invalid');
      if (canonicalExactPath(parsed.pathname) !== canonicalExactPath(previousRoute)) return entry;
      return {
        ...entry,
        destination: `${nextRoute}${parsed.search}${parsed.hash}`,
      };
    }),
  };
}

/**
 * Bulk editing happens in spreadsheets, so the CSV bridge below is deliberately
 * forgiving about what a spreadsheet actually exports: a semicolon delimiter,
 * a UTF-8 BOM, CRLF line endings, Portuguese or English headers, and no header
 * row at all. Every row that cannot become a rule is reported rather than
 * dropped silently — a redirect that vanishes on import is worse than one that
 * never imported.
 */
export interface RedirectCsvIssue {
  line: number;
  reason: string;
}

export interface RedirectCsvImport {
  entries: Array<Omit<RedirectEntry, 'id'>>;
  skipped: RedirectCsvIssue[];
}

const REDIRECT_CSV_HEADERS = {
  source: ['origem', 'source', 'from', 'de', 'caminho'],
  destination: ['destino', 'destination', 'to', 'para', 'target'],
  status: ['status', 'codigo', 'code', 'status_http'],
  match: ['correspondencia', 'match', 'tipo', 'type'],
  preserveQuery: ['preservar_parametros', 'preservequery', 'preserve_query', 'parametros', 'query'],
  enabled: ['ativo', 'enabled', 'active', 'habilitado'],
} as const;

type RedirectCsvField = keyof typeof REDIRECT_CSV_HEADERS;

const REDIRECT_CSV_FIELD_ORDER: RedirectCsvField[] = [
  'source',
  'destination',
  'status',
  'match',
  'preserveQuery',
  'enabled',
];

function csvHeaderKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function csvDelimiter(sample: string): string {
  const counts = [',', ';', '\t'].map(candidate => ({
    candidate,
    // Quoted sections can hold delimiters of their own; counting outside them
    // keeps a destination like "/a,b" from electing the wrong separator.
    total: sample.split('"').filter((_, index) => index % 2 === 0)
      .reduce((sum, chunk) => sum + chunk.split(candidate).length - 1, 0),
  }));
  return counts.sort((a, b) => b.total - a.total)[0].total > 0
    ? counts.sort((a, b) => b.total - a.total)[0].candidate
    : ',';
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  row.push(field);
  rows.push(row);
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

function csvBoolean(value: string, fallback: boolean) {
  const normalized = csvHeaderKey(value);
  if (normalized === '') return fallback;
  if (['1', 'sim', 'true', 'yes', 'x', 'v', 'verdadeiro'].includes(normalized)) return true;
  if (['0', 'nao', 'false', 'no', 'n', 'falso'].includes(normalized)) return false;
  return fallback;
}

export function parseRedirectCsv(text: string): RedirectCsvImport {
  const content = text.replace(/^\ufeff/, '');
  const rows = parseCsvRows(content, csvDelimiter(content.slice(0, 4_096)));
  const skipped: RedirectCsvIssue[] = [];
  const entries: Array<Omit<RedirectEntry, 'id'>> = [];
  if (!rows.length) return { entries, skipped };

  const headerKeys = rows[0].map(csvHeaderKey);
  const columns = new Map<RedirectCsvField, number>();
  headerKeys.forEach((key, index) => {
    (Object.keys(REDIRECT_CSV_HEADERS) as RedirectCsvField[]).forEach(field => {
      if (!columns.has(field) && (REDIRECT_CSV_HEADERS[field] as readonly string[]).includes(key)) {
        columns.set(field, index);
      }
    });
  });
  // Without a recognisable header the file is read positionally, so a bare
  // "/old,/new" export still imports.
  const hasHeader = columns.has('source') || columns.has('destination');
  if (!hasHeader) REDIRECT_CSV_FIELD_ORDER.forEach((field, index) => columns.set(field, index));

  rows.slice(hasHeader ? 1 : 0).forEach((cells, offset) => {
    const line = offset + (hasHeader ? 2 : 1);
    const cell = (field: RedirectCsvField) => {
      const index = columns.get(field);
      return index === undefined ? '' : (cells[index] ?? '').trim();
    };
    const source = cell('source');
    const destination = cell('destination');
    if (!source && !destination) return;
    if (!source) { skipped.push({ line, reason: 'origem vazia' }); return; }
    if (!destination) { skipped.push({ line, reason: 'destino vazio' }); return; }

    const normalizedSource = normalizeRedirectPath(source);
    const normalizedDestination = normalizeRedirectDestination(destination);
    if (normalizedSource === '' || normalizedSource === '/') {
      skipped.push({ line, reason: 'origem inválida' });
      return;
    }
    if (normalizedDestination === '') {
      skipped.push({ line, reason: 'destino inválido' });
      return;
    }
    entries.push({
      source: normalizedSource,
      destination: normalizedDestination,
      status: normalizeStatus(cell('status') || 301),
      match: normalizeMatch(csvHeaderKey(cell('match')), normalizedSource),
      preserveQuery: csvBoolean(cell('preserveQuery'), true),
      enabled: csvBoolean(cell('enabled'), true),
    });
  });

  return { entries, skipped };
}

function csvCell(value: string) {
  return /[",;\t\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function redirectsToCsv(entries: RedirectEntry[]): string {
  const header = ['origem', 'destino', 'status', 'correspondencia', 'preservar_parametros', 'ativo'];
  const rows = entries.map(entry => [
    entry.source,
    entry.destination,
    String(entry.status),
    entry.match,
    entry.preserveQuery ? 'sim' : 'nao',
    entry.enabled ? 'sim' : 'nao',
  ].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\n');
}

/** Sample file offered next to the importer so the shape is self-explanatory. */
export function redirectCsvTemplate(): string {
  return redirectsToCsv([
    { id: '1', source: '/pagina-antiga', destination: '/pagina-nova', status: 301, match: 'exact', preserveQuery: true, enabled: true },
    { id: '2', source: '/blog/antigo', destination: 'https://exemplo.com/blog', status: 302, match: 'prefix', preserveQuery: false, enabled: true },
    { id: '3', source: '/campanha/*', destination: '/promocoes', status: 301, match: 'wildcard', preserveQuery: true, enabled: false },
  ]);
}
