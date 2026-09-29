import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import type { SettingsCmsCollection } from '@/app/(builder)/kodety/html-editor/components/HtmlProjectSettings';

export interface CmsSchemaResponse {
  types?: Array<{
    slug?: string;
    name?: string;
    restBase?: string;
    fields?: SettingsCmsCollection['fields'];
  }>;
  templates?: Record<string, string>;
}

const CMS_SCHEMA_CACHE_TTL_MS = 5 * 60_000;
const CMS_SCHEMA_CACHE_PREFIX = 'kodety:settings-cms-schema:v2:';

export function cmsSchemaScope(config: KodetyWordPressConfig, projectId: string, workspaceRevision: number, templateDigest: string) {
  return JSON.stringify({
    endpoint: config.cmsSchemaUrl,
    site: config.siteUrl,
    nonce: config.nonce,
    project: projectId,
    workspaceRevision,
    templateDigest,
    share: config.share,
    readOnly: Boolean(config.readOnly),
    canManageCmsSchema: Boolean(config.canManageCmsSchema),
    canManageCmsTemplates: Boolean(config.canManageCmsTemplates),
  });
}

function cmsSchemaCacheKey(scope: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < scope.length; index += 1) {
    hash = Math.imul(hash ^ scope.charCodeAt(index), 0x01000193);
  }
  return `${CMS_SCHEMA_CACHE_PREFIX}${(hash >>> 0).toString(16)}`;
}

export function isCmsSchemaResponse(value: unknown): value is CmsSchemaResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const schema = value as CmsSchemaResponse;
  return Array.isArray(schema.types)
    && schema.types.every(type => type && typeof type === 'object' && !Array.isArray(type)
      && typeof type.slug === 'string' && typeof type.name === 'string'
      && (type.restBase === undefined || typeof type.restBase === 'string')
      && (type.fields === undefined || (Array.isArray(type.fields) && type.fields.every(field =>
        field && typeof field === 'object' && !Array.isArray(field)
        && typeof field.key === 'string' && typeof field.label === 'string'
        && (field.type === undefined || typeof field.type === 'string')
        && (field.source === undefined || typeof field.source === 'string')))))
    && (schema.templates === undefined || (schema.templates !== null && typeof schema.templates === 'object'
      && !Array.isArray(schema.templates) && Object.values(schema.templates).every(path => typeof path === 'string')));
}

/** PHP serializes an empty associative array as [], including sites without CMS templates. */
export function normalizeCmsSchemaResponse(value: unknown): CmsSchemaResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const templates = (value as { templates?: unknown }).templates;
  const normalized = Array.isArray(templates) && templates.length === 0
    ? { ...value, templates: {} }
    : value;
  return isCmsSchemaResponse(normalized) ? normalized : null;
}

export function readCmsSchemaCache(scope: string): CmsSchemaResponse | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(cmsSchemaCacheKey(scope)) || '');
    const age = Date.now() - parsed.cachedAt;
    if (parsed.scope !== scope || !Number.isFinite(age) || age < 0 || age >= CMS_SCHEMA_CACHE_TTL_MS) return null;
    return normalizeCmsSchemaResponse(parsed.schema);
  } catch {
    return null;
  }
}

export function cacheCmsSchema(scope: string, schema: CmsSchemaResponse) {
  try {
    const storage = window.sessionStorage;
    const currentKey = cmsSchemaCacheKey(scope);
    storage.setItem(currentKey, JSON.stringify({ scope, cachedAt: Date.now(), schema }));
    // Revisions change after each save; keep this optional cache bounded during
    // long editing sessions instead of accumulating every historical schema.
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(CMS_SCHEMA_CACHE_PREFIX)));
    const entries = keys.map(key => {
      let cachedAt = 0;
      try { cachedAt = Number(JSON.parse(storage.getItem(key) || '').cachedAt) || 0; } catch { /* Evict corrupt entries first. */ }
      return { key, cachedAt };
    }).sort((left, right) => Number(right.key === currentKey) - Number(left.key === currentKey) || right.cachedAt - left.cachedAt);
    entries.forEach((entry, index) => {
      if (index >= 8 || Date.now() - entry.cachedAt >= CMS_SCHEMA_CACHE_TTL_MS) storage.removeItem(entry.key);
    });
  } catch {
    // Storage is optional; a later visit performs the bounded request again.
  }
}

export function invalidateCmsSchemaCache(scope: string) {
  try { window.sessionStorage.removeItem(cmsSchemaCacheKey(scope)); } catch { /* Optional cache. */ }
}
