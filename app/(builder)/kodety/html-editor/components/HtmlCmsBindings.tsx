'use client';

import { cmsFetch, cmsHostConfig } from '@/lib/html-editor/cms-host';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Database, Link2, Loader2, Plus, Repeat2, Trash2, Unlink } from '@/components/ui/gravity-icons';
import { Button } from '../ycode-style/ui/button';
import { Label } from '../ycode-style/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ycode-style/ui/popover';
import SettingsPanel from '../ycode-style/SettingsPanel';
import { HtmlSettingsSelectControl, HtmlSettingsTextControl, HtmlSettingsToggleControl } from './HtmlSettingsControls';
import type { SelectionSnapshot } from '@/lib/html-editor/types';
import {
  CMS_FIELD_BINDING_TARGETS,
  cmsFieldBindingForTarget,
  isCmsFieldCompatible,
  shouldRenderCmsFieldBindingControl,
  type CmsFieldBindingTarget,
} from '@/lib/html-editor/cms-field-binding';
import {
  formFieldsFromMarkup,
  type CmsFormField,
} from '@/lib/html-editor/form-fields';

export { formFieldsFromMarkup } from '@/lib/html-editor/form-fields';
export type { CmsFormField } from '@/lib/html-editor/form-fields';

export interface CmsField { key: string; label: string; type: string; source: string; description?: string; required?: boolean; default?: unknown; min?: number | ''; max?: number | ''; step?: number; unit?: string }
export interface CmsType {
  slug: string;
  name: string;
  singular: string;
  restBase?: string;
  collection?: boolean;
  itemCount?: number;
  urlSlug?: string;
  readOnly?: boolean;
  fields: CmsField[];
  capabilities?: { create?: boolean; publish?: boolean };
}
export interface CmsSchema {
  types: CmsType[];
  templates: Record<string, string>;
  customFields: { active: boolean; plugin: string };
  /** Opaque schema CAS token returned by every CMS read. */
  revision: string;
}
interface CmsWordPressConfig {
  cmsSchemaUrl?: string;
  cmsTemplatesUrl?: string;
  cmsItemsUrl?: string;
  cmsCollectionsUrl?: string;
  mediaUploadUrl?: string;
  cmsTemplateMode?: boolean;
  nonce?: string;
}
export interface CmsItem {
  id: number;
  type?: string;
  status: string;
  label: string;
  editUrl?: string;
  dateIso?: string;
  modifiedIso?: string;
  featuredImageId?: number;
  thumbnail?: string;
  capabilities?: { edit?: boolean; delete?: boolean; publish?: boolean };
  values: Record<string, unknown>;
  /** Opaque item CAS token; never derive or compare its contents client-side. */
  revision: string;
}
function config() {
  return cmsHostConfig((window as typeof window & { kodetyWordPress?: CmsWordPressConfig }).kodetyWordPress);
}

const CMS_SCHEMA_CACHE_PREFIX = 'kodety:cms:schema:v1:';
const CMS_SCHEMA_CACHE_TTL_MS = 5 * 60_000;
const CMS_SCHEMA_CACHE_MAX_STALE_MS = 30 * 60_000;
const CMS_SCHEMA_REQUEST_TIMEOUT_MS = 12_000;
const CMS_SCHEMA_INVALIDATION_STORAGE_KEY = 'kodety:cms:schema:invalidation:v1';
export const CMS_SCHEMA_INVALIDATED_EVENT = 'kodety-cms-schema-invalidated';
export const CMS_SCHEMA_UPDATED_EVENT = 'kodety-cms-schema-updated';

// One in-flight/completed schema request shared by every panel instance. The
// inspector remounts these components on each selection change; without the
// cache the same schema was refetched dozens of times per editing session.
// A short sessionStorage cache also makes returning to CMS-backed panels
// immediate without keeping stale collection definitions indefinitely.
let cmsSchemaCache: { key: string; promise: Promise<CmsSchema>; expiresAt: number } | null = null;
let cmsSchemaCacheGeneration = 0;
let cmsSchemaInvalidationListenerInstalled = false;
let cmsSchemaInvalidationBroadcastedAt = 0;
const cmsSchemaRequests = new Map<string, Promise<CmsSchema>>();
const queuedCmsSchemaEvents = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCmsSchema(payload: unknown): CmsSchema | null {
  if (
    !isRecord(payload)
    || !Array.isArray(payload.types)
    || typeof payload.revision !== 'string'
    || !payload.revision.trim()
  ) return null;
  const types = payload.types.flatMap(rawType => {
    if (!isRecord(rawType) || typeof rawType.slug !== 'string' || !rawType.slug || !Array.isArray(rawType.fields)) return [];
    const fields = rawType.fields.flatMap(rawField => {
      if (!isRecord(rawField) || typeof rawField.key !== 'string' || !rawField.key) return [];
      return [{
        ...rawField,
        key: rawField.key,
        label: typeof rawField.label === 'string' && rawField.label ? rawField.label : rawField.key,
        type: typeof rawField.type === 'string' && rawField.type ? rawField.type : 'text',
        source: typeof rawField.source === 'string' && rawField.source ? rawField.source : 'wordpress',
      } as CmsField];
    });
    return [{
      ...rawType,
      slug: rawType.slug,
      name: typeof rawType.name === 'string' && rawType.name ? rawType.name : rawType.slug,
      singular: typeof rawType.singular === 'string' && rawType.singular ? rawType.singular : rawType.slug,
      fields,
    } as CmsType];
  });
  const templates = isRecord(payload.templates)
    ? Object.fromEntries(Object.entries(payload.templates).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};
  const customFields = isRecord(payload.customFields)
    ? {
        active: Boolean(payload.customFields.active),
        plugin: typeof payload.customFields.plugin === 'string' && payload.customFields.plugin
          ? payload.customFields.plugin
          : 'campos personalizados',
      }
    : { active: false, plugin: 'campos personalizados' };
  return { types, templates, customFields, revision: payload.revision };
}

function cmsSchemaIdentity(url: string, nonce: string) {
  const absoluteUrl = typeof window === 'undefined' ? url : new URL(url, window.location.href).toString();
  return `${absoluteUrl}\n${nonce}`;
}

function cmsSchemaStorageKey(identity: string) {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${CMS_SCHEMA_CACHE_PREFIX}${(hash >>> 0).toString(36)}`;
}

function readSessionCmsSchema(identity: string): { schema: CmsSchema; expiresAt: number; fresh: boolean } | null {
  if (typeof window === 'undefined') return null;
  const storageKey = cmsSchemaStorageKey(identity);
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const stored = JSON.parse(raw) as unknown;
    // The hash only locates the record. Comparing the complete identity makes a
    // collision a harmless cache miss instead of serving another site's schema.
    if (!isRecord(stored) || stored.version !== 1 || stored.identity !== identity || typeof stored.storedAt !== 'number') {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    const expiresAt = stored.storedAt + CMS_SCHEMA_CACHE_TTL_MS;
    const discardAt = stored.storedAt + CMS_SCHEMA_CACHE_MAX_STALE_MS;
    const schema = normalizeCmsSchema(stored.schema);
    if (!schema || discardAt <= Date.now()) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    return { schema, expiresAt, fresh: expiresAt > Date.now() };
  } catch {
    return null;
  }
}

function writeSessionCmsSchema(identity: string, schema: CmsSchema) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(cmsSchemaStorageKey(identity), JSON.stringify({
      version: 1,
      identity,
      storedAt: Date.now(),
      schema,
    }));
  } catch {
    // Storage can be disabled or full. The in-memory cache remains sufficient.
  }
}

function clearSessionCmsSchemaCache() {
  if (typeof window === 'undefined') return;
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index));
    keys.forEach(key => {
      if (key?.startsWith(CMS_SCHEMA_CACHE_PREFIX)) window.sessionStorage.removeItem(key);
    });
  } catch {
    // Storage may be unavailable; clearing the in-memory cache is still safe.
  }
}

function queueCmsSchemaEvent(type: string) {
  if (typeof window === 'undefined' || queuedCmsSchemaEvents.has(type)) return;
  queuedCmsSchemaEvents.add(type);
  queueMicrotask(() => {
    queuedCmsSchemaEvents.delete(type);
    window.dispatchEvent(new Event(type));
  });
}

function clearCmsSchemaCacheLocally(notify: boolean) {
  cmsSchemaCacheGeneration += 1;
  cmsSchemaCache = null;
  cmsSchemaRequests.clear();
  clearSessionCmsSchemaCache();
  if (notify) queueCmsSchemaEvent(CMS_SCHEMA_INVALIDATED_EVENT);
}

function ensureCmsSchemaInvalidationListener() {
  if (typeof window === 'undefined' || cmsSchemaInvalidationListenerInstalled) return;
  cmsSchemaInvalidationListenerInstalled = true;
  window.addEventListener('storage', event => {
    if (event.key !== CMS_SCHEMA_INVALIDATION_STORAGE_KEY || !event.newValue) return;
    clearCmsSchemaCacheLocally(true);
  });
}

async function requestCmsSchema(url: string, nonce: string): Promise<CmsSchema> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CMS_SCHEMA_REQUEST_TIMEOUT_MS);
  try {
    const response = await cmsFetch(url, {
      headers: { 'X-WP-Nonce': nonce },
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message : '';
      throw new Error(message || 'Não foi possível carregar o CMS.');
    }
    const schema = normalizeCmsSchema(payload);
    if (!schema) throw new Error('O WordPress retornou um schema de CMS inválido.');
    return schema;
  } catch (error) {
    if (timedOut) throw new Error('O CMS demorou mais de 12 segundos para responder. Tente novamente.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function requestAndCacheCmsSchema(url: string, nonce: string, identity: string) {
  const existing = cmsSchemaRequests.get(identity);
  if (existing) return existing;
  const generation = cmsSchemaCacheGeneration;
  let request: Promise<CmsSchema>;
  request = requestCmsSchema(url, nonce).then(schema => {
    if (generation === cmsSchemaCacheGeneration) {
      const promise = Promise.resolve(schema);
      cmsSchemaCache = {
        key: identity,
        promise,
        expiresAt: Date.now() + CMS_SCHEMA_CACHE_TTL_MS,
      };
      writeSessionCmsSchema(identity, schema);
      queueCmsSchemaEvent(CMS_SCHEMA_UPDATED_EVENT);
    }
    return schema;
  }).finally(() => {
    if (cmsSchemaRequests.get(identity) === request) cmsSchemaRequests.delete(identity);
  });
  cmsSchemaRequests.set(identity, request);
  return request;
}

export function fetchCmsSchema(url: string, nonce: string): Promise<CmsSchema> {
  ensureCmsSchemaInvalidationListener();
  const key = cmsSchemaIdentity(url, nonce);
  if (cmsSchemaCache?.key === key && cmsSchemaCache.expiresAt > Date.now()) return cmsSchemaCache.promise;
  const persisted = readSessionCmsSchema(key);
  if (persisted) {
    const promise = Promise.resolve(persisted.schema);
    cmsSchemaCache = { key, promise, expiresAt: persisted.expiresAt };
    if (!persisted.fresh) {
      // Stale-while-revalidate: paint the last validated schema immediately,
      // then refresh it without putting the whole CMS behind another spinner.
      void requestAndCacheCmsSchema(url, nonce, key).catch(() => undefined);
    }
    return promise;
  }
  const promise = requestAndCacheCmsSchema(url, nonce, key);
  // Infinity here means "in flight", not an immortal value. Resolution above
  // replaces it with the real TTL and rejection removes it below.
  cmsSchemaCache = { key, promise, expiresAt: Number.POSITIVE_INFINITY };
  promise.catch(() => {
    if (cmsSchemaCache?.promise === promise) cmsSchemaCache = null;
  });
  return promise;
}

export function invalidateCmsSchemaCache() {
  ensureCmsSchemaInvalidationListener();
  clearCmsSchemaCacheLocally(true);
  if (typeof window === 'undefined') return;
  // sessionStorage is tab-local. A small localStorage epoch invalidates other
  // tabs without persisting the nonce/schema or trusting a hashed identity.
  const now = Date.now();
  if (now - cmsSchemaInvalidationBroadcastedAt < 100) return;
  cmsSchemaInvalidationBroadcastedAt = now;
  try {
    const token = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(CMS_SCHEMA_INVALIDATION_STORAGE_KEY, `${now}:${token}`);
  } catch {
    // Local invalidation already happened; cross-tab storage may be disabled.
  }
}

function normalizeFormFieldName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function cmsFieldAcceptsFormValue(field: CmsField) {
  return ![
    'image', 'file', 'gallery', 'relationship', 'post_object', 'user', 'repeater',
    'flexible_content', 'group', 'accordion', 'tab', 'message',
  ].includes(field.type)
    && !['permalink', 'date', 'author', 'featured_image', 'featured_image_alt'].includes(field.key);
}

function suggestedCmsTarget(formField: CmsFormField, fields: CmsField[]) {
  const source = normalizeFormFieldName(formField.name);
  const aliases: Record<string, string[]> = {
    title: ['title', 'titulo', 'name', 'nome', 'fullname', 'nome completo'],
    excerpt: ['excerpt', 'resumo', 'summary'],
    content: ['content', 'conteudo', 'message', 'mensagem', 'description', 'descricao'],
    slug: ['slug'],
  };
  return fields.find(field => {
    const target = normalizeFormFieldName(field.key.replace(/^field:/, ''));
    if (target === source) return true;
    return (aliases[field.key] || []).some(alias => normalizeFormFieldName(alias) === source);
  })?.key || '';
}

export function HtmlCmsFormAction({
  selection,
  selectedOuterHtml,
  cmsAvailable,
  onAttributesChange,
}: {
  selection: SelectionSnapshot;
  selectedOuterHtml: string;
  cmsAvailable: boolean;
  onAttributesChange: (changes: Record<string, string>) => void;
}) {
  const [schema, setSchema] = useState<CmsSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const wp = config();
  const collectionSlug = selection.attributes['data-kodety-cms-collection'] || '';
  const enabled = Boolean(collectionSlug);
  const status = selection.attributes['data-kodety-cms-status'] || 'draft';
  const formFields = useMemo(() => formFieldsFromMarkup(selectedOuterHtml), [selectedOuterHtml]);
  const mapping = useMemo<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(selection.attributes['data-kodety-cms-map'] || '{}') as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {};
    } catch {
      return {};
    }
  }, [selection.attributes['data-kodety-cms-map']]);

  useEffect(() => {
    if (!cmsAvailable || !wp?.cmsSchemaUrl) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchCmsSchema(wp.cmsSchemaUrl, wp.nonce || '')
      .then(value => { if (!cancelled) setSchema(value); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar o CMS.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cmsAvailable, wp?.cmsSchemaUrl, wp?.nonce]);

  const collections = useMemo(
    () => (schema?.types || []).filter(type => type.collection && type.capabilities?.create !== false),
    [schema?.types],
  );
  const collection = collections.find(type => type.slug === collectionSlug);
  const fields = useMemo(() => (collection?.fields || []).filter(cmsFieldAcceptsFormValue), [collection?.fields]);
  const persistMapping = (next: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([source, target]) => source && target));
    onAttributesChange({ 'data-kodety-cms-map': Object.keys(clean).length ? JSON.stringify(clean) : '' });
  };
  const chooseCollection = (nextSlug: string) => {
    const nextCollection = collections.find(type => type.slug === nextSlug);
    const nextFields = (nextCollection?.fields || []).filter(cmsFieldAcceptsFormValue);
    const suggested = Object.fromEntries(formFields.flatMap(field => {
      const target = suggestedCmsTarget(field, nextFields);
      return target ? [[field.name, target]] : [];
    }));
    onAttributesChange({
      'data-kodety-cms-collection': nextSlug,
      'data-kodety-cms-status': 'draft',
      'data-kodety-cms-map': Object.keys(suggested).length ? JSON.stringify(suggested) : '',
      action: '',
      method: 'post',
      enctype: 'multipart/form-data',
    });
  };
  const toggle = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      onAttributesChange({
        'data-kodety-cms-collection': '',
        'data-kodety-cms-status': '',
        'data-kodety-cms-map': '',
        'data-kodety-cms-token': '',
      });
      return;
    }
    if (collections[0]) chooseCollection(collections[0].slug);
  };
  const mappedCount = Object.keys(mapping).filter(source => formFields.some(field => field.name === source)).length;

  return (
    <div data-ycode-native-ui className="space-y-3">
      <HtmlSettingsToggleControl
        label="Create CMS item"
        description="Create one item in the selected collection for each submission."
        kind="collection"
        checked={enabled}
        disabled={!cmsAvailable || loading || (!enabled && collections.length === 0)}
        onChange={toggle}
      />
      {!cmsAvailable && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200">Enable CMS to use this action.</p>}
      {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading collections…</div>}
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {cmsAvailable && !loading && !loadError && collections.length === 0 && (
        <p className="rounded-lg border border-border/70 bg-input/45 px-3 py-2.5 text-xs text-muted-foreground">Create a CMS collection before connecting this form.</p>
      )}
      {enabled && (
        <>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label variant="muted">Collection</Label>
            <div className="col-span-2">
              <HtmlSettingsSelectControl
                label="Collection"
                kind="collection"
                value={collectionSlug}
                onChange={chooseCollection}
                placeholder="Choose collection"
                options={collections.map(type => ({ value: type.slug, label: type.name }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label variant="muted">Item status</Label>
            <div className="col-span-2">
              <HtmlSettingsSelectControl
                label="Item status"
                kind="option"
                value={status}
                onChange={value => onAttributesChange({ 'data-kodety-cms-status': value })}
                allowUnset={false}
                options={[
                  { value: 'draft', label: 'Draft' },
                  { value: 'pending', label: 'Pending review' },
                  ...(collection?.capabilities?.publish !== false ? [{ value: 'publish', label: 'Published' }] : []),
                ]}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label variant="muted">Field mapping</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{mappedCount}/{formFields.length}</span>
            </div>
            {formFields.length === 0 ? (
              <p className="rounded-lg border border-border/70 bg-input/45 px-3 py-2.5 text-xs leading-4 text-muted-foreground">Add inputs with a <code>name</code> attribute to map them.</p>
            ) : formFields.map(formField => (
              <div key={formField.name} className="grid grid-cols-[minmax(0,.85fr)_12px_minmax(0,1fr)] items-center gap-1.5">
                <div className="min-w-0">
                  <p className="truncate text-[10px] text-foreground/90" title={formField.label}>{formField.label}</p>
                  <p className="truncate font-mono text-[8px] text-muted-foreground" title={formField.name}>{formField.name}</p>
                </div>
                <span className="text-center text-[10px] text-muted-foreground">→</span>
                <HtmlSettingsSelectControl
                  label={`${formField.label} target`}
                  kind="collection"
                  value={mapping[formField.name] || '__ignore__'}
                  onChange={target => persistMapping({ ...mapping, [formField.name]: target === '__ignore__' ? '' : target })}
                  allowUnset={false}
                  className="h-8 text-[10px]"
                  options={[
                    { value: '__ignore__', label: 'Do not send' },
                    ...fields.map(field => ({ value: field.key, label: field.label })),
                  ]}
                />
              </div>
            ))}
          </div>
          {mappedCount === 0 && formFields.length > 0 && (
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200">Connect at least one field to create the item.</p>
          )}
          <p className="text-xs leading-4 text-muted-foreground">Passwords, files and internal fields are never sent to CMS by this action.</p>
        </>
      )}
    </div>
  );
}

type CmsFilterOperator = 'contains' | 'equals' | 'starts_with' | 'gte' | 'lte';
interface CmsFilterMapping { field: string; operator: CmsFilterOperator; options?: 'cms' }

function filterOperatorOptions(type: string) {
  if (type === 'range') {
    return [
      { value: 'lte', label: 'At most' },
      { value: 'gte', label: 'At least' },
      { value: 'equals', label: 'Equals' },
    ];
  }
  if (['number', 'date', 'time', 'datetime-local'].includes(type)) {
    return [
      { value: 'equals', label: 'Equals' },
      { value: 'gte', label: 'At least' },
      { value: 'lte', label: 'At most' },
    ];
  }
  if (['checkbox', 'radio', 'select'].includes(type)) return [{ value: 'equals', label: 'Equals' }];
  return [
    { value: 'contains', label: 'Contains' },
    { value: 'equals', label: 'Equals' },
    { value: 'starts_with', label: 'Starts with' },
  ];
}

function suggestedFilterField(formField: CmsFormField, fields: CmsField[]) {
  const normalized = normalizeFormFieldName(formField.name);
  if (['q', 'query', 'search', 'busca', 'pesquisa'].includes(normalized)) {
    return fields.find(field => field.key === 'title')?.key || fields[0]?.key || '';
  }
  return suggestedCmsTarget(formField, fields) || fields[0]?.key || '';
}

function cmsFieldSupportsFilter(field: CmsField) {
  return ![
    'image', 'file', 'gallery', 'relationship', 'post_object', 'user', 'repeater',
    'flexible_content', 'group', 'accordion', 'tab', 'message',
  ].includes(field.type) && !['permalink', 'featured_image', 'featured_image_alt'].includes(field.key);
}

/** Configure a form as a client-side filter for one rendered CMS collection. */
export function HtmlCmsFilterAction({
  selection,
  selectedOuterHtml,
  cmsAvailable,
  onAttributesChange,
}: {
  selection: SelectionSnapshot;
  selectedOuterHtml: string;
  cmsAvailable: boolean;
  onAttributesChange: (changes: Record<string, string>) => void;
}) {
  const [schema, setSchema] = useState<CmsSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const wp = config();
  const enabled = selection.attributes['data-kodety-form-mode'] === 'filter';
  const collectionSlug = selection.attributes['data-kodety-filter-collection'] || '';
  const formFields = useMemo(() => formFieldsFromMarkup(selectedOuterHtml), [selectedOuterHtml]);
  const mapping = useMemo<Record<string, CmsFilterMapping>>(() => {
    try {
      const parsed = JSON.parse(selection.attributes['data-kodety-filter-map'] || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).flatMap(([name, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const candidate = value as Partial<CmsFilterMapping>;
        if (typeof candidate.field !== 'string' || typeof candidate.operator !== 'string') return [];
        return [[name, {
          field: candidate.field,
          operator: candidate.operator as CmsFilterOperator,
          ...(candidate.options === 'cms' ? { options: 'cms' as const } : {}),
        }]];
      }));
    } catch {
      return {};
    }
  }, [selection.attributes['data-kodety-filter-map']]);

  useEffect(() => {
    if (!cmsAvailable || !wp?.cmsSchemaUrl || (!enabled && !collectionSlug)) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchCmsSchema(wp.cmsSchemaUrl, wp.nonce || '')
      .then(value => { if (!cancelled) setSchema(value); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load CMS.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cmsAvailable, collectionSlug, enabled, wp?.cmsSchemaUrl, wp?.nonce]);

  const collections = useMemo(() => (schema?.types || []).filter(type => type.collection), [schema?.types]);
  const collection = collections.find(type => type.slug === collectionSlug);
  const fields = useMemo(() => (collection?.fields || []).filter(cmsFieldSupportsFilter), [collection?.fields]);
  const persistMapping = (next: Record<string, CmsFilterMapping>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([name, value]) => name && value.field));
    onAttributesChange({ 'data-kodety-filter-map': Object.keys(clean).length ? JSON.stringify(clean) : '' });
  };
  const chooseCollection = (nextSlug: string) => {
    const nextCollection = collections.find(type => type.slug === nextSlug);
    const nextFields = (nextCollection?.fields || []).filter(cmsFieldSupportsFilter);
    const nextMapping = Object.fromEntries(formFields.flatMap(field => {
      const target = suggestedFilterField(field, nextFields);
      if (!target) return [];
      const operator = filterOperatorOptions(field.type)[0]?.value as CmsFilterOperator || 'contains';
      return [[field.name, { field: target, operator, ...(field.type === 'select' ? { options: 'cms' as const } : {}) }]];
    }));
    onAttributesChange({
      'data-kodety-form-mode': 'filter',
      'data-kodety-capture': 'false',
      'data-kodety-filter-collection': nextSlug,
      'data-kodety-filter-map': JSON.stringify(nextMapping),
      'data-kodety-filter-on': selection.attributes['data-kodety-filter-on'] || 'input',
      'data-kodety-filter-url': selection.attributes['data-kodety-filter-url'] || 'true',
      action: '',
      method: 'get',
    });
  };
  const toggle = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      onAttributesChange({
        'data-kodety-form-mode': 'submission',
        'data-kodety-capture': '',
        'data-kodety-filter-collection': '',
        'data-kodety-filter-map': '',
        'data-kodety-filter-on': '',
        'data-kodety-filter-url': '',
      });
      return;
    }
    if (collections[0]) chooseCollection(collections[0].slug);
    else onAttributesChange({ 'data-kodety-form-mode': 'filter', 'data-kodety-capture': 'false', method: 'get', action: '' });
  };

  return (
    <div className="mt-1 space-y-2.5 border-t border-border/70 pt-3">
      <HtmlSettingsToggleControl
        label="Use as CMS filter"
        description="Search, select and range fields filter collection items instantly."
        kind="collection"
        checked={enabled}
        disabled={!cmsAvailable || loading}
        onChange={toggle}
      />
      {!cmsAvailable && <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-2.5 py-2 text-[9px] text-amber-200">Enable CMS to configure filters.</p>}
      {loading && <div className="flex items-center gap-2 text-[9px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading collections…</div>}
      {loadError && <p className="text-[9px] text-destructive">{loadError}</p>}
      {enabled && !loading && (
        <>
          <div className="grid gap-1.5">
            <Label variant="muted" className="text-[10px]">Collection</Label>
            <HtmlSettingsSelectControl
              label="Collection"
              kind="collection"
              value={collectionSlug}
              onChange={chooseCollection}
              placeholder="Choose collection"
              options={collections.map(type => ({ value: type.slug, label: type.name }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label variant="muted" className="text-[10px]">Apply filters</Label>
              <HtmlSettingsSelectControl
                label="Apply filters"
                kind="option"
                value={selection.attributes['data-kodety-filter-on'] || 'input'}
                onChange={value => onAttributesChange({ 'data-kodety-filter-on': value })}
                allowUnset={false}
                options={[{ value: 'input', label: 'While typing' }, { value: 'submit', label: 'On submit' }]}
              />
            </div>
            <HtmlSettingsToggleControl
              label="Sync URL"
              kind="link"
              checked={selection.attributes['data-kodety-filter-url'] !== 'false'}
              onChange={checked => onAttributesChange({ 'data-kodety-filter-url': checked ? 'true' : 'false' })}
            />
          </div>
          <div className="space-y-2 border-t border-border/60 pt-2.5">
            <div>
              <p className="text-[10px] font-medium">Field mapping</p>
              <p className="text-[9px] text-muted-foreground">Connect each named control to a CMS field and condition.</p>
            </div>
            {formFields.length === 0 && <p className="text-[9px] text-muted-foreground">Add a name to at least one form field.</p>}
            {formFields.map(formField => {
              const current: CmsFilterMapping = mapping[formField.name] || { field: '', operator: filterOperatorOptions(formField.type)[0]?.value as CmsFilterOperator || 'contains' };
              return (
                <div key={formField.name} className="space-y-1.5 rounded-lg border border-border/60 p-2">
                  <p className="truncate text-[10px] font-medium" title={formField.label}>{formField.label} <span className="font-normal text-muted-foreground">· {formField.name}</span></p>
                  <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-1.5">
                    <HtmlSettingsSelectControl
                      label={`${formField.label} CMS field`}
                      kind="collection"
                      value={current.field || '__none'}
                      onChange={field => persistMapping({ ...mapping, [formField.name]: { ...current, field: field === '__none' ? '' : field } })}
                      allowUnset={false}
                      className="h-8 text-[10px]"
                      options={[{ value: '__none', label: 'Not connected' }, ...fields.map(field => ({ value: field.key, label: field.label }))]}
                    />
                    <HtmlSettingsSelectControl
                      label={`${formField.label} operator`}
                      kind="option"
                      value={current.operator}
                      onChange={operator => persistMapping({ ...mapping, [formField.name]: { ...current, operator: operator as CmsFilterOperator } })}
                      allowUnset={false}
                      className="h-8 text-[10px]"
                      options={filterOperatorOptions(formField.type)}
                    />
                  </div>
                  {formField.type === 'select' && <div className="pt-0.5">
                    <HtmlSettingsToggleControl
                      label="Options from CMS values"
                      kind="collection"
                      checked={current.options === 'cms'}
                      onChange={checked => persistMapping({
                        ...mapping,
                        [formField.name]: { ...current, ...(checked ? { options: 'cms' } : { options: undefined }) },
                      })}
                    />
                  </div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export const CMS_BIND_TARGETS = CMS_FIELD_BINDING_TARGETS;
export type CmsBindTarget = CmsFieldBindingTarget;

function fieldSourceLabel(source: string) {
  if (source === 'wordpress') return 'WordPress';
  if (source === 'acf') return 'ACF';
  if (source === 'kodety') return 'Campos da collection';
  return source || 'Outros campos';
}

export function HtmlCmsFieldBinding({
  selection,
  target,
  kind,
  onAttributeChange,
  onAttributesChange,
  inheritedCollectionType = '',
}: {
  selection: SelectionSnapshot;
  target: 'content' | 'title' | 'href' | 'src' | 'alt';
  kind: 'text' | 'image' | 'link';
  onAttributeChange: (name: string, value: string) => void;
  onAttributesChange: (changes: Record<string, string>) => void;
  inheritedCollectionType?: string;
}) {
  const [schema, setSchema] = useState<CmsSchema | null>(null);
  const [open, setOpen] = useState(false);
  const [postType, setPostType] = useState(inheritedCollectionType || selection.attributes['data-kodety-bind-type'] || selection.attributes['data-kodety-collection'] || 'post');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const wp = config();
  const targetAttribute = `data-kodety-bind-${target}`;
  const activeBinding = cmsFieldBindingForTarget(selection, target);
  const active = Boolean(activeBinding);
  const hasBindingContext = Boolean(
    active
    || inheritedCollectionType
    || selection.attributes['data-kodety-collection']
    || wp?.cmsTemplateMode,
  );
  useEffect(() => {
    if (inheritedCollectionType) setPostType(inheritedCollectionType);
  }, [inheritedCollectionType]);
  const effectivePostType = inheritedCollectionType || postType;
  useEffect(() => {
    if (!hasBindingContext) {
      setSchema(null);
      setLoading(false);
      setLoadError('');
      return;
    }
    if (!wp?.cmsSchemaUrl) {
      setLoading(false);
      setLoadError('A integração do CMS não está disponível nesta página.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchCmsSchema(wp.cmsSchemaUrl, wp.nonce || '')
      .then(data => { if (!cancelled) setSchema(data); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os campos.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hasBindingContext, reload, wp?.cmsSchemaUrl, wp?.nonce]);
  useEffect(() => {
    if (!schema || schema.types.some(type => type.slug === effectivePostType)) return;
    setPostType(schema.types.find(type => type.slug === 'post')?.slug || schema.types[0]?.slug || 'post');
  }, [effectivePostType, schema]);
  const compatibleFields = useMemo(() => {
    const compatible = schema?.types.find(type => type.slug === effectivePostType)?.fields || [];
    return compatible.filter(field => isCmsFieldCompatible(field, kind));
  }, [effectivePostType, kind, schema?.types]);
  const fields = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return compatibleFields.filter(field =>
      !normalizedQuery || `${field.label} ${field.key} ${field.source}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [compatibleFields, query]);
  const fieldGroups = useMemo(() => {
    const groups = new Map<string, CmsField[]>();
    fields.forEach(field => groups.set(field.source || 'other', [...(groups.get(field.source || 'other') || []), field]));
    return Array.from(groups.entries()).sort(([left], [right]) => {
      const order = ['wordpress', 'kodety', 'acf'];
      return (order.indexOf(left) === -1 ? 99 : order.indexOf(left)) - (order.indexOf(right) === -1 ? 99 : order.indexOf(right));
    });
  }, [fields]);
  const legacyTarget = selection.attributes['data-kodety-bind-target']
    || (selection.tag === 'a' ? 'href' : ['img', 'source', 'video'].includes(selection.tag) ? 'src' : 'content');
  const legacyBinding = legacyTarget === target ? selection.attributes['data-kodety-bind'] || '' : '';
  const selectedField = schema?.types.find(type => type.slug === effectivePostType)?.fields.find(field => field.key === activeBinding);
  const invalidBinding = Boolean(active && schema && (!selectedField || !isCmsFieldCompatible(selectedField, kind)));
  const disconnect = () => {
    onAttributesChange({
      [targetAttribute]: '',
      ...(legacyBinding ? { 'data-kodety-bind': '', 'data-kodety-bind-target': '' } : {}),
    });
  };
  if (!shouldRenderCmsFieldBindingControl(activeBinding, compatibleFields.length)) return null;
  return (
    <Popover open={open} onOpenChange={nextOpen => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery('');
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          data-cms-connected={active ? 'true' : 'false'}
          className={`size-7 shrink-0 rounded-[5px] bg-transparent ${invalidBinding ? 'text-amber-300' : active ? 'text-[var(--kodety-accent)] hover:text-[var(--kodety-accent-hover)] [&_svg]:text-[var(--kodety-accent)]' : 'text-muted-foreground'}`}
          title={active ? `Conectado a ${selectedField?.label || activeBinding}` : 'Conectar campo do CMS'}
          aria-label="Conectar campo do CMS"
        >
          {invalidBinding ? <AlertTriangle className="size-3" /> : active ? <Link2 className="size-3" /> : <Plus className="size-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg p-0">
        <div className="border-b border-white/[0.08] px-3 py-2.5">
          <p className="text-xs font-medium">Conectar ao CMS</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Escolha um campo compatível com esta propriedade.</p>
        </div>
        {active && <div className={`flex items-center gap-2 border-b border-white/[0.08] px-3 py-2 ${invalidBinding ? 'text-amber-200' : 'text-[var(--kodety-accent-hover)]'}`}>
          {invalidBinding ? <AlertTriangle className="size-3.5 shrink-0" /> : <Link2 className="size-3.5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium">{selectedField?.label || activeBinding}</p>
            <p className="text-[9px] text-muted-foreground">{invalidBinding ? 'Campo não encontrado nesta collection' : 'Conexão ativa'}</p>
          </div>
          <Button
            type="button" size="icon-xs"
            variant="ghost" className="bg-transparent" title="Remover conexão"
            aria-label="Remover conexão do CMS"
            onClick={disconnect}
          ><Unlink /></Button>
        </div>}
        <div className="space-y-2 border-b border-white/[0.08] p-2">
          {!inheritedCollectionType && <HtmlSettingsSelectControl
            label="Collection"
            kind="collection"
            value={effectivePostType}
            onChange={setPostType}
            placeholder="Collection"
            options={(schema?.types || []).map(type => ({ value: type.slug, label: type.name }))}
          />}
          <HtmlSettingsTextControl
            value={query}
            onChange={setQuery}
            label="Buscar campo do CMS"
            kind="collection"
            placeholder="Buscar campo…"
          />
        </div>
        <div className="max-h-[min(320px,55vh)] overflow-y-auto p-1">
          {active && <button
            type="button" onClick={disconnect}
            className="flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[11px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                     ><Unlink className="size-3.5" /> Usar conteúdo fixo</button>}
          {loading && <p role="status" className="flex items-center justify-center gap-2 px-3 py-5 text-[10px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Carregando campos…</p>}
          {!loading && loadError && <div role="alert" className="px-3 py-4 text-center">
            <p className="text-[10px] leading-relaxed text-amber-300">{loadError}</p>
            {wp?.cmsSchemaUrl && <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => {
              invalidateCmsSchemaCache();
              setReload(value => value + 1);
            }}>Tentar novamente</Button>}
          </div>}
          {!loading && !loadError && fieldGroups.map(([source, sourceFields]) => <div key={source}>
            <p className="px-2 pb-1 pt-2 text-[9px] font-medium text-muted-foreground">{fieldSourceLabel(source)}</p>
            {sourceFields.map(field => {
              const checked = activeBinding === field.key;
              return <button
                key={field.key} type="button"
                aria-pressed={checked}
                onClick={() => {
                  onAttributesChange({
                    [targetAttribute]: field.key,
                    'data-kodety-bind-type': effectivePostType,
                    ...(legacyBinding ? { 'data-kodety-bind': '', 'data-kodety-bind-target': '' } : {}),
                  });
                  setOpen(false);
                }}
                className="flex min-h-7 w-full items-center gap-2 rounded-[5px] px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">{checked && <Check className="size-3.5 text-[var(--kodety-accent-hover)]" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px]">{field.label}</span><span className="block truncate text-[9px] text-muted-foreground">{field.type}</span></span>
              </button>;
            })}
          </div>)}
          {!loading && !loadError && !fields.length && <p role="status" className="px-2 py-5 text-center text-[10px] text-muted-foreground">{query ? 'Nenhum campo corresponde à busca.' : 'Nenhum campo compatível.'}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function HtmlCmsBindings({
  selection,
  currentPage,
  onAttributeChange,
  onAttributesChange,
  onCollectionChange,
  onCollectionModelChange,
  onCollectionRepeatSelf,
  onBindItemLink,
  integrated = false,
  inheritedCollectionType = '',
  inheritedCollectionLabel = '',
  inheritedCollectionOrderby = '',
  inheritedCollectionOrder = '',
  canBeCollectionModel = false,
  collectionModelActive = false,
  collectionModelLabel = '',
  collectionRepeatMode = 'self',
}: {
  selection: SelectionSnapshot;
  currentPage: string;
  onAttributeChange: (name: string, value: string) => void;
  onAttributesChange: (changes: Record<string, string>) => void;
  onCollectionChange?: (postType: string) => void;
  onCollectionModelChange?: (active: boolean) => void;
  onCollectionRepeatSelf?: () => void;
  onBindItemLink?: () => void;
  integrated?: boolean;
  inheritedCollectionType?: string;
  inheritedCollectionLabel?: string;
  inheritedCollectionOrderby?: string;
  inheritedCollectionOrder?: string;
  canBeCollectionModel?: boolean;
  collectionModelActive?: boolean;
  collectionModelLabel?: string;
  collectionRepeatMode?: 'self' | 'child';
}) {
  const [schema, setSchema] = useState<CmsSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(selection.attributes['data-kodety-limit'] || '6');
  const wp = config();

  useEffect(() => {
    if (!wp?.cmsSchemaUrl) {
      setLoading(false);
      setMessage('A integração do CMS não está disponível nesta página.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMessage('');
    fetchCmsSchema(wp.cmsSchemaUrl, wp.nonce || '')
      .then(data => {
        if (cancelled) return;
        setSchema(data);
      })
      .catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Erro ao carregar o CMS.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentPage, wp?.cmsSchemaUrl, wp?.nonce]);

  useEffect(() => setLimit(selection.attributes['data-kodety-limit'] || '6'), [selection.attributes, selection.path]);

  const collectionType = selection.attributes['data-kodety-collection'] || '';
  const collectionOrderby = selection.attributes['data-kodety-orderby'] || 'date';
  const collectionOrder = selection.attributes['data-kodety-order'] || 'DESC';
  const bindingType = selection.attributes['data-kodety-bind-type'] || '';
  const selectedType = useMemo(() => {
    const explicitType = inheritedCollectionType || bindingType || collectionType;
    return explicitType ? schema?.types.find(type => type.slug === explicitType) : schema?.types[0];
  }, [bindingType, collectionType, inheritedCollectionType, schema]);
  const defaultTarget = selection.tag === 'a' ? 'href' : ['img', 'source', 'video'].includes(selection.tag) ? 'src' : 'content';
  // A per-target attribute wins; the legacy pair only matters while no
  // data-kodety-bind-<target> exists yet.
  const boundTarget = CMS_BIND_TARGETS.find(target => selection.attributes[`data-kodety-bind-${target}`]);
  const bindingTarget = boundTarget || selection.attributes['data-kodety-bind-target'] || defaultTarget;
  const binding = selection.attributes[`data-kodety-bind-${bindingTarget}`] || selection.attributes['data-kodety-bind'] || '';
  const bindingKind = bindingTarget === 'src' ? 'image' : bindingTarget === 'href' ? 'link' : 'text';
  const availableBindingFields = useMemo(
    () => (selectedType?.fields || []).filter(field => isCmsFieldCompatible(field, bindingKind)),
    [bindingKind, selectedType?.fields],
  );
  const bindingField = selectedType?.fields.find(field => field.key === binding);
  const incompatibleBinding = Boolean(binding && schema && (!bindingField || !isCmsFieldCompatible(bindingField, bindingKind)));
  return (
    <SettingsPanel
      title="CMS" isOpen
      onToggle={() => {}}
    >
      <div className="divide-y divide-white/[0.07]">
        {!integrated && <div className="pb-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : <span className={`size-1.5 rounded-full ${schema ? 'bg-emerald-400' : 'bg-amber-400'}`} />}
            {loading ? 'Carregando WordPress' : schema ? 'WordPress conectado' : 'WordPress indisponível'}
          </div>
          {schema && <p className="mt-1 pl-3.5 text-[10px] leading-relaxed text-muted-foreground">Conecte propriedades visuais aos campos publicados no WordPress.</p>}
          {schema && !schema.customFields.active && <p className="mt-2 pl-3.5 text-[9px] text-amber-300">O {schema.customFields.plugin} está sendo instalado/ativado para liberar campos personalizados.</p>}
        </div>}

        <div className="space-y-3 py-3">
          <div className="flex items-center gap-2"><Database className="size-3.5 text-muted-foreground" /><span className="text-xs font-medium">Collection and repetition</span></div>

          {collectionType ? <>
            <div className="border-y border-white/[0.08] py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Collection deste container</p>
                  <p className="mt-0.5 truncate text-xs font-medium">{schema?.types.find(type => type.slug === collectionType)?.name || collectionType}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">{collectionRepeatMode === 'self' ? 'Este elemento será repetido.' : collectionModelLabel ? `Modelo interno: ${collectionModelLabel}` : 'Escolha qual elemento interno será repetido.'}</p>
                </div>
                <Button
                  type="button" size="icon-xs"
                  variant="ghost" className="shrink-0 text-red-300 hover:text-red-200"
                  title="Remover collection" aria-label="Remover collection"
                  onClick={() => onCollectionChange?.('')}
                ><Trash2 /></Button>
              </div>
              <HtmlSettingsSelectControl
                label="Collection"
                kind="collection"
                value={collectionType}
                onChange={value => onCollectionChange?.(value)}
                disabled={loading || !schema}
                allowUnset={false}
                className="mt-2"
                options={(schema?.types || []).filter(type => type.slug !== 'page').map(type => ({ value: type.slug, label: type.name }))}
              />
              {collectionRepeatMode === 'child' && <Button
                type="button" size="xs"
                variant="secondary" className="mt-2 w-full"
                onClick={onCollectionRepeatSelf}
                                                   ><Repeat2 className="size-3.5" /> Repetir o próprio elemento</Button>}
              {collectionRepeatMode === 'self' && onBindItemLink && (selection.attributes['data-kodety-bind-href'] === 'permalink' ? (
                <p className="mt-2 flex items-center gap-1.5 border-t pt-2 text-[10px] text-[var(--kodety-accent-hover)]"><Link2 className="size-3.5" /> Cada item repetido abre a própria página.</p>
              ) : (
                <Button
                  type="button" size="xs"
                  variant="secondary" className="mt-2 w-full"
                  onClick={onBindItemLink}
                >
                  <Link2 className="size-3.5" /> Conectar ao link da página do item
                </Button>
              ))}
            </div>

            <div className="space-y-3 border-y border-white/[0.08] py-3">
              <div className="space-y-1.5">
                <div><p className="text-xs font-medium">Máximo de itens</p><p className="text-[9px] text-muted-foreground">Entre 1 e 100 itens publicados. Arraste o ícone para ajustar.</p></div>
                <HtmlSettingsTextControl
                  value={limit}
                  label="Máximo de itens"
                  kind="number"
                  onChange={draft => {
                    const cleaned = draft.replace(/[^\d.-]/g, '');
                    setLimit(cleaned);
                    if (cleaned) onAttributeChange('data-kodety-limit', String(Math.max(1, Math.min(100, Number(cleaned)))));
                  }}
                  onCommit={committed => {
                    const next = String(Math.max(1, Math.min(100, Number(committed) || 6)));
                    setLimit(next);
                    onAttributeChange('data-kodety-limit', next);
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[9px] text-muted-foreground">Ordenar por
                  <HtmlSettingsSelectControl
                    label="Ordenar por"
                    kind="option"
                    value={collectionOrderby}
                    onChange={value => onAttributeChange('data-kodety-orderby', value)}
                    allowUnset={false}
                    className="mt-1"
                    options={[{ value: 'date', label: 'Data' }, { value: 'modified', label: 'Atualização' }, { value: 'title', label: 'Título' }, { value: 'menu_order', label: 'Ordem manual' }, { value: 'rand', label: 'Aleatório' }]}
                  />
                </label>
                <label className="text-[9px] text-muted-foreground">Direção
                  <HtmlSettingsSelectControl
                    label="Direção"
                    kind="option"
                    value={collectionOrder}
                    onChange={value => onAttributeChange('data-kodety-order', value)}
                    allowUnset={false}
                    className="mt-1"
                    options={[{ value: 'DESC', label: 'Decrescente' }, { value: 'ASC', label: 'Crescente' }]}
                  />
                </label>
              </div>
            </div>
          </> : inheritedCollectionType ? <>
            <div className="border-y border-white/[0.08] py-3">
              <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Contexto herdado</p>
              <p className="mt-0.5 text-xs font-medium">{schema?.types.find(type => type.slug === inheritedCollectionType)?.name || inheritedCollectionType}</p>
              <p className="mt-0.5 text-[9px] text-muted-foreground">Definida em {inheritedCollectionLabel || 'um container ancestral'}. Os campos deste elemento usam essa collection automaticamente.</p>
            </div>
            {canBeCollectionModel && <div className="border-b border-white/[0.08] py-3">
              <HtmlSettingsToggleControl
                label="Repetir este elemento"
                description="Ele vira o modelo visual de cada item. Só pode existir um modelo por collection."
                kind="collection"
                checked={collectionModelActive}
                onChange={checked => onCollectionModelChange?.(checked)}
              />
            </div>}
            {onBindItemLink && (selection.attributes['data-kodety-bind-href'] === 'permalink' ? (
              <p className="flex items-center gap-1.5 border-y border-white/[0.08] py-2 text-[10px] text-[var(--kodety-accent-hover)]"><Link2 className="size-3.5" /> Este elemento abre a página do item.</p>
            ) : (
              <Button
                type="button" size="xs"
                variant="secondary" className="w-full"
                onClick={onBindItemLink}
              >
                <Link2 className="size-3.5" /> Conectar ao link da página do item
              </Button>
            ))}
          </> : selection.hasElementChildren ? <>
            <Label variant="muted">Transformar este container em collection</Label>
            <HtmlSettingsSelectControl
              label="Escolher collection"
              kind="collection"
              value=""
              onChange={value => onCollectionChange?.(value)}
              disabled={loading || !schema}
              placeholder="Escolher collection"
              options={(schema?.types || []).filter(type => type.slug !== 'page').map(type => ({ value: type.slug, label: type.name }))}
            />
            <p className="text-[9px] leading-relaxed text-muted-foreground">Depois selecione qualquer descendente para defini-lo como modelo repetível.</p>
          </> : <p className="border-y border-white/[0.08] py-2 text-[9px] leading-relaxed text-muted-foreground">Este elemento pode receber campos dinâmicos. Para criar uma lista, selecione um container que possua elementos filhos.</p>}
        </div>

        {!integrated && <div className="space-y-3 py-3">
          <div className="flex items-center gap-2"><Link2 className="size-3.5 text-muted-foreground" /><span className="text-xs font-medium">Campo dinâmico</span></div>
          <HtmlSettingsSelectControl
            label="Campo dinâmico"
            kind="collection"
            value={binding}
            onChange={next => {
              onAttributesChange({
                [`data-kodety-bind-${bindingTarget}`]: next,
                ...(next && selectedType?.slug ? { 'data-kodety-bind-type': selectedType.slug } : {}),
                ...(selection.attributes['data-kodety-bind'] ? { 'data-kodety-bind': '', 'data-kodety-bind-target': '' } : {}),
              });
            }}
            disabled={loading || !selectedType}
            placeholder="Conteúdo fixo"
            options={[
              ...(incompatibleBinding ? [{ value: binding, label: `${bindingField?.label || binding} · incompatível`, disabled: true }] : []),
              ...availableBindingFields.map(field => ({ value: field.key, label: `${field.label}${field.source === 'acf' ? ' · ACF' : ''}` })),
            ]}
          />
          {incompatibleBinding && <p role="alert" className="flex items-start gap-1.5 text-[9px] leading-relaxed text-amber-300"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> O campo salvo não é compatível com {bindingTarget}. Escolha outro campo ou volte para conteúdo fixo.</p>}
          {binding && <>
            <Label variant="muted">Aplicar em</Label>
            <HtmlSettingsSelectControl
              label="Aplicar em"
              kind="collection"
              value={bindingTarget}
              allowUnset={false}
              onChange={value => {
                if (value === bindingTarget) return;
                onAttributesChange({
                  [`data-kodety-bind-${bindingTarget}`]: '',
                  [`data-kodety-bind-${value}`]: binding,
                  ...(selection.attributes['data-kodety-bind'] ? { 'data-kodety-bind': '', 'data-kodety-bind-target': '' } : {}),
                });
              }}
              options={[{ value: 'content', label: 'Conteúdo do elemento' }, { value: 'href', label: 'Link (href)' }, { value: 'src', label: 'Imagem/mídia (src)' }, { value: 'alt', label: 'Texto alternativo (alt)' }, { value: 'title', label: 'Atributo title' }]}
            />
          </>}
        </div>}

        {message && <p role="status" className="py-2 text-[9px] leading-relaxed text-amber-300">{message}</p>}
      </div>
    </SettingsPanel>
  );
}
