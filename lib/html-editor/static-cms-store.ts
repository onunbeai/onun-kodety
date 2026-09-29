import { parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { HtmlProject, HtmlProjectFile } from './types';

export const STATIC_CMS_SCHEMA_PATH = '.incode/cms/schema.json';
const ITEM_PREFIX = '.incode/cms/items/';
const MEDIA_PREFIX = '.incode/cms/media/';
const EMPTY_REVISION = 'static-cms-empty-v1';
const FIELD_TYPES = new Set(['text', 'textarea', 'richtext', 'date', 'url', 'image', 'color', 'boolean', 'number']);
const STATUSES = new Set(['draft', 'publish', 'pending', 'private', 'trash']);
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface StaticCmsField {
  key: string; label: string; type: string; source: string;
  description?: string; required?: boolean; default?: unknown;
  min?: number | ''; max?: number | ''; step?: number; unit?: string;
}
export interface StaticCmsType {
  slug: string; name: string; singular: string; urlSlug: string;
  collection: boolean; fields: StaticCmsField[]; itemCount?: number;
  restBase?: string; readOnly?: boolean; capabilities?: { create?: boolean; publish?: boolean };
}
export interface StaticCmsSchema {
  version: 1; revision: string; types: StaticCmsType[];
  templates: Record<string, string>; customFields: { active: boolean; plugin: string };
}
export interface StaticCmsItem {
  id: number; type: string; status: string; label: string;
  values: Record<string, unknown>; revision: string;
  dateIso: string; modifiedIso: string; featuredImageId?: number; thumbnail?: string;
  capabilities?: { edit?: boolean; delete?: boolean; publish?: boolean };
}
export interface StaticCmsProduct {
  licensed?: boolean;
  features?: Record<string, boolean>;
  limits?: { collections?: number | null; itemsPerCollection?: number | null; connectedCollections?: number | null };
}
export interface StaticCmsCommitContext { baseProject: HtmlProject; changedPaths: string[]; deletedPaths: string[] }
export class StaticCmsError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'StaticCmsError'; }
}
const failure = (code: string, message: string, status = 400) => new StaticCmsError(code, message, status);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const revision = () => crypto.randomUUID();
const jsonFile = (path: string, value: unknown): HtmlProjectFile => ({ path, mimeType: 'application/json', text: JSON.stringify(value, null, 2) });
const safeCollection = (slug: unknown): slug is string => typeof slug === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(slug) && !RESERVED_KEYS.has(slug);
const safeSegment = (slug: unknown): slug is string => typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,159}$/.test(slug) && !RESERVED_KEYS.has(slug);
export const staticCmsSlug = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
function parseFile(project: HtmlProject, path: string): unknown {
  try { return JSON.parse(project.files[path]?.text || ''); }
  catch { throw failure('kodety_cms_invalid_data', `Não foi possível ler “${path}”. Os dados existentes foram preservados.`, 422); }
}
const emptySchema = (): StaticCmsSchema => ({ version: 1, revision: EMPTY_REVISION, types: [], templates: {}, customFields: { active: true, plugin: 'Kodety' } });

/** Pure reader shared by authoring and the static compiler. No browser globals,
 * network calls, migration writes, or UI runtime imports belong on this path. */
export function readStaticCms(project: HtmlProject): { schema: StaticCmsSchema; items: StaticCmsItem[] } {
  let schema = emptySchema();
  if (project.files[STATIC_CMS_SCHEMA_PATH]) {
    const stored = parseFile(project, STATIC_CMS_SCHEMA_PATH);
    if (!isRecord(stored) || stored.version !== 1 || typeof stored.revision !== 'string' || !stored.revision || !Array.isArray(stored.types) || !isRecord(stored.templates)) throw failure('kodety_cms_invalid_data', 'O schema do CMS é inválido. Os arquivos foram preservados.', 422);
    const slugs = new Set<string>(), urls = new Set<string>();
    for (const value of stored.types) {
      if (!isRecord(value) || !safeCollection(value.slug) || typeof value.name !== 'string' || typeof value.singular !== 'string' || !safeSegment(value.urlSlug) || !Array.isArray(value.fields) || slugs.has(value.slug) || urls.has(value.urlSlug)) throw failure('kodety_cms_invalid_data', 'Uma collection do CMS é inválida ou duplicada.', 422);
      const keys = new Set<string>();
      for (const field of value.fields) {
        if (!isRecord(field) || typeof field.key !== 'string' || !field.key || RESERVED_KEYS.has(field.key) || keys.has(field.key) || typeof field.label !== 'string' || typeof field.type !== 'string' || typeof field.source !== 'string') throw failure('kodety_cms_invalid_data', 'Um campo do CMS é inválido ou duplicado.', 422);
        keys.add(field.key);
      }
      slugs.add(value.slug); urls.add(value.urlSlug);
    }
    if (Object.entries(stored.templates).some(([key, value]) => !safeCollection(key) || typeof value !== 'string')) throw failure('kodety_cms_invalid_data', 'Os templates do CMS são inválidos.', 422);
    schema = structuredClone(stored) as unknown as StaticCmsSchema;
    schema.customFields = { active: true, plugin: 'Kodety' };
  }
  const items: StaticCmsItem[] = [];
  const ids = new Set<string>();
  for (const path of Object.keys(project.files).filter(path => path.startsWith(ITEM_PREFIX) && path.endsWith('.json')).sort()) {
    const stored = parseFile(project, path);
    if (!isRecord(stored) || !safeCollection(stored.type) || !Number.isSafeInteger(stored.id) || Number(stored.id) <= 0 || path !== `${ITEM_PREFIX}${stored.type}/${stored.id}.json`
      || typeof stored.status !== 'string' || !STATUSES.has(stored.status) || typeof stored.revision !== 'string' || !stored.revision
      || typeof stored.label !== 'string' || !isRecord(stored.values) || !safeSegment(stored.values.slug)
      || typeof stored.dateIso !== 'string' || typeof stored.modifiedIso !== 'string') throw failure('kodety_cms_invalid_data', `O item em “${path}” é inválido. Os dados foram preservados.`, 422);
    const identity = `${stored.type}/${stored.id}`;
    if (ids.has(identity)) throw failure('kodety_cms_invalid_data', 'Há itens de CMS duplicados.', 422);
    ids.add(identity);
    const item = structuredClone(stored) as unknown as StaticCmsItem;
    const type = schema.types.find(type => type.slug === item.type);
    if (type) item.values.permalink = staticCmsItemRoute(type, item).permalink;
    items.push(item);
  }
  schema.types = schema.types.map(type => ({ ...type, itemCount: items.filter(item => item.type === type.slug && item.status !== 'trash').length }));
  return { schema, items };
}

export function staticCmsItemRoute(type: Pick<StaticCmsType, 'urlSlug'>, item: Pick<StaticCmsItem, 'values'>): { path: string; permalink: string } {
  const slug = item.values.slug;
  if (!safeSegment(type.urlSlug) || !safeSegment(slug)) throw failure('kodety_cms_invalid_route', 'O endereço de um item do CMS é inválido.', 422);
  return { path: `${type.urlSlug}/${slug}/index.html`, permalink: `/${type.urlSlug}/${slug}/` };
}

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlElement = DefaultTreeAdapterMap['element'];
const RICH_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'figure', 'figcaption', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'span', 'div', 'sub', 'sup']);
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'template']);
function safeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!url) return '';
  if (/[\u0000-\u0020\u007f]/.test(url) || url.includes('\\') || /^(?:javascript|vbscript|data|blob|file):/i.test(url)) throw failure('kodety_cms_invalid_url', 'Use um endereço HTTP, HTTPS ou um caminho do projeto.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(?:https?|mailto|tel):/i.test(url)) throw failure('kodety_cms_invalid_url', 'O protocolo deste endereço não é permitido.');
  return url;
}
export function sanitizeStaticCmsRichText(value: string): string {
  const tree = parseFragment(value);
  const clean = (node: HtmlNode): HtmlNode[] => {
    if (node.nodeName === '#text') return [node];
    if (!('tagName' in node)) return [];
    const element = node as HtmlElement;
    if (DROP_TAGS.has(element.tagName)) return [];
    element.childNodes = element.childNodes.flatMap(clean) as typeof element.childNodes;
    if (!RICH_TAGS.has(element.tagName)) return element.childNodes;
    element.attrs = element.attrs.filter(attribute => {
      if (['title', 'alt', 'colspan', 'rowspan', 'width', 'height'].includes(attribute.name)) return true;
      if (attribute.name === 'href' && element.tagName === 'a' || attribute.name === 'src' && element.tagName === 'img') {
        try { attribute.value = safeUrl(attribute.value); return Boolean(attribute.value); } catch { return false; }
      }
      if (attribute.name === 'style') {
        attribute.value = attribute.value.split(';').filter(declaration => {
          const separator = declaration.indexOf(':');
          const property = declaration.slice(0, separator).trim().toLowerCase(), text = declaration.slice(separator + 1).trim();
          return ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'margin-left', 'padding-left', 'list-style-type'].includes(property)
            && !/[\\<>@]|url\s*\(|expression\s*\(/i.test(text);
        }).join(';');
        return Boolean(attribute.value);
      }
      return false;
    });
    return [element];
  };
  tree.childNodes = tree.childNodes.flatMap(clean) as typeof tree.childNodes;
  return serialize(tree);
}
function plainText(value: unknown, maximum = 500): string {
  const tree = parseFragment(String(value ?? ''));
  const text = (node: HtmlNode): string => node.nodeName === '#text' ? (node as DefaultTreeAdapterMap['textNode']).value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';
  return tree.childNodes.map(text).join('').trim().slice(0, maximum);
}
function assertRevision(expected: unknown, current: string) {
  if (typeof expected !== 'string' || !expected) throw failure('kodety_revision_required', 'Recarregue o CMS antes de salvar esta alteração.', 409);
  if (expected !== current) throw failure('kodety_revision_conflict', 'O CMS mudou em outra sessão. Seu formulário foi preservado; recarregue os dados antes de salvar.', 409);
}
function defaultFields(): StaticCmsField[] {
  return [
    { key: 'title', label: 'Título', type: 'text', source: 'kodety', required: true },
    { key: 'excerpt', label: 'Resumo', type: 'textarea', source: 'kodety' },
    { key: 'content', label: 'Conteúdo', type: 'richtext', source: 'kodety' },
    { key: 'featured_image', label: 'Imagem destacada', type: 'image', source: 'kodety' },
    { key: 'featured_image_alt', label: 'Texto alternativo da imagem', type: 'text', source: 'kodety' },
    { key: 'permalink', label: 'Link do item', type: 'url', source: 'kodety' },
    { key: 'date', label: 'Data de publicação', type: 'date', source: 'kodety' },
    { key: 'author', label: 'Autor', type: 'text', source: 'kodety' },
    { key: 'slug', label: 'Slug', type: 'text', source: 'kodety' },
  ];
}
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const itemPath = (item: Pick<StaticCmsItem, 'type' | 'id'>) => `${ITEM_PREFIX}${item.type}/${item.id}.json`;
const allocateId = (used: Set<number>) => {
  let id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  while (used.has(id)) id += 1;
  return id;
};

export function createStaticCmsTransport(options: {
  baseUrl: string;
  getProject(): HtmlProject;
  commitProject(project: HtmlProject, context: StaticCmsCommitContext): Promise<void>;
  getProduct?(): StaticCmsProduct | undefined;
}) {
  const base = new URL(options.baseUrl.replace(/\/$/, '') + '/', typeof location === 'undefined' ? 'https://studio.kodety.invalid' : location.href);
  const prefix = base.href.replace(/\/$/, '');
  const endpoint = (suffix: string) => prefix + '/' + suffix;
  let disposed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const previewByPath = new Map<string, { file: HtmlProjectFile; url: string }>();
  const canonicalByPreview = new Map<string, string>();
  const assertActive = (signal?: AbortSignal | null) => {
    if (disposed) throw new DOMException('O CMS deste projeto foi fechado.', 'AbortError');
    signal?.throwIfAborted();
  };
  const assertAllowed = () => {
    if (options.getProduct?.()?.features?.cms === false) throw failure('kodety_cms_unavailable', 'O CMS não está disponível neste projeto.', 403);
  };
  function mediaPreview(project: HtmlProject, path: string) {
    const canonical = path.replace(/^\//, '');
    const file = project.files[canonical];
    if (!file?.data && file?.text === undefined) return path;
    const previous = previewByPath.get(canonical);
    if (previous?.file === file) return previous.url;
    const blob = new Blob([file.text ?? Uint8Array.from(file.data || []).buffer], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    // Open forms may still hold an earlier preview URL after the editor
    // replaces immutable file objects. Keep those aliases until workspace
    // disposal so saving an image can always recover its canonical file path.
    previewByPath.set(canonical, { file, url }); canonicalByPreview.set(url, canonical);
    return url;
  }
  function mediaRecord(project: HtmlProject, id: number): { id: number; path: string } | null {
    const path = `${MEDIA_PREFIX}${id}.json`;
    if (!project.files[path]) return null;
    const value = parseFile(project, path);
    return isRecord(value) && value.id === id && typeof value.path === 'string' && project.files[value.path] ? { id, path: value.path } : null;
  }
  function richTextImages(value: string, source: (url: string) => string): string {
    const tree = parseFragment(value);
    const visit = (node: HtmlNode) => {
      if ('tagName' in node && node.tagName === 'img') {
        const attribute = node.attrs.find(attribute => attribute.name === 'src');
        if (attribute) attribute.value = source(attribute.value);
      }
      if ('childNodes' in node) node.childNodes.forEach(visit);
    };
    tree.childNodes.forEach(visit);
    return serialize(tree);
  }
  function canonicalImage(value: unknown): unknown {
    if (!isRecord(value)) return safeUrl(typeof value === 'string' ? canonicalByPreview.get(value) || value : value);
    const source = value.url ?? value.source_url ?? '';
    const url = safeUrl(typeof source === 'string' ? canonicalByPreview.get(source) || source : source);
    if (!url) return '';
    const focal = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 50;
    return { url, alt: plainText(value.alt, 1000), focalX: focal(value.focalX), focalY: focal(value.focalY), crop: ['square', 'landscape', 'portrait'].includes(String(value.crop)) ? value.crop : 'original' };
  }
  function presentItem(project: HtmlProject, item: StaticCmsItem, type: StaticCmsType): StaticCmsItem {
    const next = structuredClone(item);
    for (const field of type.fields) {
      const value = next.values[field.key];
      if (field.type === 'richtext' && typeof value === 'string') next.values[field.key] = richTextImages(sanitizeStaticCmsRichText(value), url => mediaPreview(project, url));
      if (field.type === 'image' && isRecord(value)) {
        try {
          const canonical = canonicalImage(value);
          next.values[field.key] = isRecord(canonical) ? { ...canonical, url: mediaPreview(project, String(canonical.url)) } : '';
        } catch { next.values[field.key] = ''; }
      }
      if (['image', 'url'].includes(field.type) && typeof value === 'string' && value) {
        try { next.values[field.key] = field.type === 'image' ? mediaPreview(project, safeUrl(value)) : safeUrl(value); }
        catch { next.values[field.key] = ''; }
      }
    }
    next.thumbnail = typeof next.values.featured_image === 'string' ? next.values.featured_image : '';
    next.capabilities = { edit: true, delete: true, publish: true };
    return next;
  }
  async function commit(baseProject: HtmlProject, changes: Record<string, HtmlProjectFile>, deletedPaths: string[] = [], signal?: AbortSignal | null) {
    assertActive(signal);
    const files = { ...baseProject.files, ...changes };
    deletedPaths.forEach(path => { delete files[path]; });
    await options.commitProject({ ...baseProject, files }, { baseProject, changedPaths: Object.keys(changes), deletedPaths });
    assertActive(signal);
  }
  function normalizeValues(project: HtmlProject, type: StaticCmsType, input: unknown, existing?: StaticCmsItem) {
    if (!isRecord(input)) throw failure('kodety_cms_invalid_values', 'Os dados do item são inválidos.');
    const values: Record<string, unknown> = { ...(existing?.values || {}) };
    const fields = new Map(type.fields.map(field => [field.key, field]));
    let featuredImageId = existing?.featuredImageId;
    for (const [key, original] of Object.entries(input)) {
      if (key === 'status') continue;
      if (RESERVED_KEYS.has(key) || !fields.has(key)) throw failure('kodety_cms_invalid_field', `O campo “${key}” não existe nesta collection.`);
      if (['permalink', 'author', 'date'].includes(key)) continue;
      const field = fields.get(key)!;
      let value: unknown = typeof original === 'string' ? canonicalByPreview.get(original) || original : original;
      if (field.type === 'image' && (typeof value === 'number' || value === '' || value === null)) {
        if (value === '' || value === null || value === 0) { if (key === 'featured_image') featuredImageId = undefined; value = ''; }
        else {
          const media = mediaRecord(project, Number(value));
          if (!media) throw failure('kodety_invalid_featured_image', 'A imagem selecionada não foi encontrada neste projeto.');
          if (key === 'featured_image') featuredImageId = media.id;
          value = media.path;
        }
      }
      if (field.type === 'boolean') value = typeof value === 'boolean' ? value : ['true', '1', 'yes'].includes(String(value).toLowerCase());
      else if (field.type === 'number') {
        if (value === '' || value === null) value = '';
        else { value = Number(value); if (!Number.isFinite(value) || typeof field.min === 'number' && Number(value) < field.min || typeof field.max === 'number' && Number(value) > field.max) throw failure('kodety_cms_invalid_number', `Revise o valor do campo “${field.label}”.`); }
      } else if (field.type === 'richtext') value = sanitizeStaticCmsRichText(richTextImages(String(value ?? ''), url => canonicalByPreview.get(url) || url));
      else if (field.type === 'image') value = canonicalImage(value);
      else if (field.type === 'url') value = safeUrl(value);
      else if (field.type === 'date') {
        value = String(value || ''); if (value && !Number.isFinite(Date.parse(String(value)))) throw failure('kodety_cms_invalid_date', `Revise a data do campo “${field.label}”.`);
      } else value = plainText(value, field.type === 'textarea' ? 100_000 : 10_000);
      values[key] = value;
    }
    for (const field of type.fields) {
      if (values[field.key] === undefined && field.default !== undefined) values[field.key] = field.default;
      if (field.required && (values[field.key] === undefined || values[field.key] === null || values[field.key] === '')) throw failure('kodety_cms_required', `Preencha o campo “${field.label}”.`);
    }
    const title = plainText(values.title, 500);
    if (!title) throw failure('kodety_cms_required', 'Digite um título para o item.');
    values.title = title;
    const slug = staticCmsSlug(String(values.slug || title));
    if (!safeSegment(slug)) throw failure('kodety_cms_invalid_slug', 'Digite um slug válido para o item.');
    values.slug = slug;
    const status = String(input.status ?? existing?.status ?? 'draft');
    if (!STATUSES.has(status)) throw failure('kodety_cms_invalid_status', 'O status deste item não é válido.');
    return { values, status, featuredImageId };
  }
  function makeItem(project: HtmlProject, type: StaticCmsType, values: unknown, items: StaticCmsItem[], existing?: StaticCmsItem): StaticCmsItem {
    const normalized = normalizeValues(project, type, values, existing);
    if (items.some(item => item.type === type.slug && item.id !== existing?.id && item.values.slug === normalized.values.slug && item.status !== 'trash')) throw failure('kodety_cms_slug_exists', 'Já existe um item com este endereço. Escolha outro slug.', 409);
    if (existing && normalized.status === existing.status && normalized.featuredImageId === existing.featuredImageId
      && JSON.stringify(normalized.values) === JSON.stringify(existing.values)) return existing;
    const now = new Date().toISOString();
    const item: StaticCmsItem = {
      id: existing?.id || allocateId(new Set(items.map(item => item.id))), type: type.slug,
      status: normalized.status, label: String(normalized.values.title), values: normalized.values,
      revision: revision(), dateIso: existing?.dateIso || now, modifiedIso: now,
      ...(normalized.featuredImageId ? { featuredImageId: normalized.featuredImageId } : {}),
    };
    item.values.permalink = staticCmsItemRoute(type, item).permalink;
    item.values.date = item.dateIso;
    return item;
  }
  async function handle(request: Request): Promise<Response> {
    assertActive(request.signal);
    assertAllowed();
    const url = new URL(request.url);
    if (!url.href.startsWith(prefix + '/')) return jsonResponse({ code: 'kodety_cms_scope', message: 'Este endereço não pertence ao CMS do projeto.' }, 404);
    const route = url.pathname.slice(base.pathname.length).split('/').filter(Boolean).map(value => decodeURIComponent(value));
    const method = request.method.toUpperCase();
    const input: unknown = method === 'GET' || method === 'HEAD' || route[0] === 'media' ? null : await request.json().catch(() => { throw failure('kodety_cms_invalid_request', 'A solicitação do CMS é inválida.'); });
    const body = isRecord(input) ? input : {};
    // Read after awaiting request bodies, so the mutation starts from the newest
    // editor snapshot rather than a document captured before media/JSON parsing.
    const project = options.getProject();
    const { schema, items } = readStaticCms(project);
    const product = options.getProduct?.();
    const limit = (key: 'collections' | 'itemsPerCollection') => product?.limits?.[key] ?? null;
    const type = route[1] ? schema.types.find(type => type.slug === route[1]) : undefined;
    if (route[0] === 'schema' && method === 'GET') return jsonResponse({ ...schema, types: schema.types.map(type => ({ ...type, capabilities: { create: limit('itemsPerCollection') === null || Number(type.itemCount) < Number(limit('itemsPerCollection')), publish: true } })) });
    if ((route[0] === 'items' || route[0] === 'fields') && route[1] && !type) throw failure('kodety_cms_collection_missing', 'A collection não foi encontrada.', 404);
    if (route[0] === 'collections') {
      assertRevision(body.expectedRevision, schema.revision);
      let next = { ...schema, revision: revision() };
      if (method === 'POST' && !route[1]) {
        if (limit('collections') !== null && schema.types.length >= Number(limit('collections'))) throw failure('kodety_cms_collection_limit', `Este projeto permite até ${limit('collections')} collections.`, 403);
        const name = plainText(body.name, 80), singular = plainText(body.singular || body.name, 80);
        const urlSlug = staticCmsSlug(String(body.slug || name)).slice(0, 64);
        const slug = 'kodety_' + urlSlug.replace(/-/g, '_');
        if (!name || !safeSegment(urlSlug) || !safeCollection(slug)) throw failure('kodety_cms_invalid_collection', 'Digite um nome e identificador válidos para a collection.');
        if (schema.types.some(type => type.slug === slug || type.urlSlug === urlSlug)) throw failure('kodety_cms_collection_exists', 'Já existe uma collection com este identificador.', 409);
        const created: StaticCmsType = { slug, name, singular, urlSlug, collection: true, fields: defaultFields(), capabilities: { create: true, publish: true } };
        next = { ...next, types: [...schema.types, created] };
        await commit(project, { [STATIC_CMS_SCHEMA_PATH]: jsonFile(STATIC_CMS_SCHEMA_PATH, next) }, [], request.signal);
        return jsonResponse({ ...created, revision: next.revision }, 201);
      }
      if (!type) throw failure('kodety_cms_collection_missing', 'A collection não foi encontrada.', 404);
      if (method === 'PUT' || method === 'PATCH') {
        const name = plainText(body.name, 80), singular = plainText(body.singular || body.name, 80);
        if (!name) throw failure('kodety_cms_invalid_collection', 'Digite um nome para a collection.');
        if (name === type.name && singular === type.singular) return jsonResponse({ slug: type.slug, revision: schema.revision });
        // Stable slug and urlSlug keep every binding and published URL intact.
        next.types = schema.types.map(entry => entry.slug === type.slug ? { ...entry, name, singular } : entry);
        await commit(project, { [STATIC_CMS_SCHEMA_PATH]: jsonFile(STATIC_CMS_SCHEMA_PATH, next) }, [], request.signal);
        return jsonResponse({ slug: type.slug, revision: next.revision });
      }
      if (method === 'DELETE') {
        if (body.confirmation !== type.slug || body.deleteItems !== false || items.some(item => item.type === type.slug && item.status !== 'trash')) throw failure('kodety_cms_collection_not_empty', 'Confirme a exclusão de uma collection vazia. Os itens existentes foram preservados.', 409);
        next.types = schema.types.filter(entry => entry.slug !== type.slug);
        next.templates = Object.fromEntries(Object.entries(schema.templates).filter(([slug]) => slug !== type.slug));
        await commit(project, { [STATIC_CMS_SCHEMA_PATH]: jsonFile(STATIC_CMS_SCHEMA_PATH, next) }, [], request.signal);
        return jsonResponse({ deleted: type.slug, deletedItems: 0, bindingsFallback: true, revision: next.revision });
      }
    }
    if (route[0] === 'templates' && method === 'POST') {
      const target = schema.types.find(type => type.slug === body.postType);
      if (!target || typeof body.htmlPath !== 'string') throw failure('kodety_cms_invalid_template', 'Selecione uma collection e uma página HTML.');
      if (body.expectedRevision !== undefined) assertRevision(body.expectedRevision, schema.revision);
      const htmlPath = body.htmlPath;
      if (htmlPath && (!project.files[htmlPath] || !/\.html?$/i.test(htmlPath) || htmlPath.startsWith('.incode/'))) throw failure('kodety_cms_invalid_template', 'A página HTML do template não foi encontrada.');
      if ((schema.templates[target.slug] || '') === htmlPath) return jsonResponse({ templates: schema.templates, revision: schema.revision });
      const templates = { ...schema.templates };
      if (htmlPath) templates[target.slug] = htmlPath; else delete templates[target.slug];
      const next = { ...schema, templates, revision: revision() };
      await commit(project, { [STATIC_CMS_SCHEMA_PATH]: jsonFile(STATIC_CMS_SCHEMA_PATH, next) }, [], request.signal);
      return jsonResponse({ templates, revision: next.revision });
    }
    if (route[0] === 'fields' && type) {
      const definitions = () => type.fields.filter(field => field.key.startsWith('field:')).map(({ key, source: _source, ...field }) => ({ ...field, name: key.slice(6) }));
      if (method === 'GET') return jsonResponse({ fields: definitions(), revision: schema.revision });
      if (method === 'POST') {
        assertRevision(body.expectedRevision, schema.revision);
        if (!Array.isArray(body.fields) || body.fields.length > 100) throw failure('kodety_cms_invalid_fields', 'A lista de campos é inválida.');
        const names = new Set<string>();
        const fields: StaticCmsField[] = body.fields.map(value => {
          if (!isRecord(value) || typeof value.name !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(value.name) || RESERVED_KEYS.has(value.name) || names.has(value.name) || !FIELD_TYPES.has(String(value.type))) throw failure('kodety_cms_invalid_field', 'Revise os identificadores e tipos dos campos.');
          names.add(value.name);
          let defaultValue: unknown = value.default ?? (value.type === 'boolean' ? false : '');
          if (value.type === 'richtext') defaultValue = sanitizeStaticCmsRichText(String(defaultValue));
          else if (value.type === 'image') defaultValue = canonicalImage(defaultValue);
          else if (value.type === 'url') defaultValue = safeUrl(defaultValue);
          else if (value.type === 'boolean') defaultValue = typeof defaultValue === 'boolean' ? defaultValue : ['true', '1', 'yes'].includes(String(defaultValue).toLowerCase());
          else if (value.type === 'number' && defaultValue !== '') {
            defaultValue = Number(defaultValue);
            if (!Number.isFinite(defaultValue) || typeof value.min === 'number' && Number(defaultValue) < value.min || typeof value.max === 'number' && Number(defaultValue) > value.max) throw failure('kodety_cms_invalid_number', 'Revise o valor padrão do campo numérico.');
          } else defaultValue = plainText(defaultValue, value.type === 'textarea' ? 100_000 : 10_000);
          return { key: `field:${value.name}`, label: plainText(value.label || value.name, 100), type: String(value.type), source: 'kodety', description: plainText(value.description, 1000), required: Boolean(value.required), default: defaultValue, min: typeof value.min === 'number' ? value.min : '', max: typeof value.max === 'number' ? value.max : '', step: typeof value.step === 'number' && value.step > 0 ? value.step : 1, unit: plainText(value.unit, 30) };
        });
        const next = { ...schema, revision: revision(), types: schema.types.map(entry => entry.slug === type.slug ? { ...entry, fields: [...defaultFields(), ...fields] } : entry) };
        await commit(project, { [STATIC_CMS_SCHEMA_PATH]: jsonFile(STATIC_CMS_SCHEMA_PATH, next) }, [], request.signal);
        return jsonResponse({ fields: fields.map(({ key, source: _source, ...field }) => ({ ...field, name: key.slice(6) })), revision: next.revision });
      }
    }
    if (route[0] === 'items' && type) {
      const selected = items.filter(item => item.type === type.slug);
      if (method === 'GET' && !route[2]) {
        const search = (url.searchParams.get('search') || '').toLocaleLowerCase();
        const status = url.searchParams.get('status') || '';
        const perPage = Math.max(1, Math.min(100, Number(url.searchParams.get('per_page')) || 20)), page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const order = url.searchParams.get('order') === 'ASC' ? 1 : -1, orderby = url.searchParams.get('orderby');
        const filtered = selected.filter(item => (status ? item.status === status : item.status !== 'trash') && (!search || JSON.stringify(item.values).toLocaleLowerCase().includes(search)));
        filtered.sort((a, b) => order * (orderby === 'title' ? a.label.localeCompare(b.label) : (orderby === 'date' ? a.dateIso : a.modifiedIso).localeCompare(orderby === 'date' ? b.dateIso : b.modifiedIso)));
        return jsonResponse({ items: filtered.slice((page - 1) * perPage, page * perPage).map(item => presentItem(project, item, type)), total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / perPage)), revision: schema.revision });
      }
      if (method === 'POST' && (!route[2] || route[2] === 'import')) {
        assertRevision(body.expectedRevision, schema.revision);
        const inputs = route[2] === 'import' ? body.items : [{ values: body.values }];
        if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000) throw failure('kodety_cms_invalid_items', 'O lote de itens é inválido.');
        if (limit('itemsPerCollection') !== null && selected.filter(item => item.status !== 'trash').length + inputs.length > Number(limit('itemsPerCollection'))) throw failure('kodety_cms_item_limit', `Esta collection permite até ${limit('itemsPerCollection')} itens.`, 403);
        const created: StaticCmsItem[] = [];
        for (const input of inputs) {
          if (!isRecord(input)) throw failure('kodety_cms_invalid_values', 'Os dados do item são inválidos.');
          created.push(makeItem(project, type, input.values, [...items, ...created]));
        }
        const nextSchema = { ...schema, revision: revision() };
        const changes = Object.fromEntries(created.map(item => [itemPath(item), jsonFile(itemPath(item), item)]));
        changes[STATIC_CMS_SCHEMA_PATH] = jsonFile(STATIC_CMS_SCHEMA_PATH, nextSchema);
        await commit(project, changes, [], request.signal);
        return jsonResponse(route[2] === 'import' ? { imported: created.length, revision: nextSchema.revision } : presentItem(options.getProject(), created[0], type), 201);
      }
      const item = selected.find(item => String(item.id) === route[2]);
      if (!item) throw failure('kodety_cms_item_missing', 'O item não foi encontrado.', 404);
      if (method === 'GET') return jsonResponse(presentItem(project, item, type));
      assertRevision(body.expectedRevision, item.revision);
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const updated = makeItem(project, type, body.values, items, item);
        if (updated === item) return jsonResponse(presentItem(project, item, type));
        await commit(project, { [itemPath(updated)]: jsonFile(itemPath(updated), updated) }, [], request.signal);
        return jsonResponse(presentItem(options.getProject(), updated, type));
      }
      if (method === 'DELETE') {
        if (item.status === 'trash') return jsonResponse({ deleted: item.id, status: 'trash', revision: item.revision });
        const updated = { ...item, status: 'trash', revision: revision(), modifiedIso: new Date().toISOString() };
        await commit(project, { [itemPath(updated)]: jsonFile(itemPath(updated), updated) }, [], request.signal);
        return jsonResponse({ deleted: item.id, status: 'trash', revision: updated.revision });
      }
    }
    if (route[0] === 'media' && method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob) || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(file.type) || file.size > 20 * 1024 * 1024) throw failure('kodety_cms_invalid_media', 'Envie uma imagem PNG, JPEG, WebP, GIF ou AVIF de até 20 MB.');
      const data = new Uint8Array(await file.arrayBuffer());
      const latest = options.getProject();
      const id = allocateId(new Set(Object.keys(latest.files).filter(path => path.startsWith(MEDIA_PREFIX)).map(path => Number(path.slice(MEDIA_PREFIX.length).replace(/\.json$/, '')))));
      const extension = file.type.split('/')[1].replace('jpeg', 'jpg');
      const path = `assets/cms/${id}.${extension}`, recordPath = `${MEDIA_PREFIX}${id}.json`;
      const asset: HtmlProjectFile = { path, mimeType: file.type, data };
      await commit(latest, { [path]: asset, [recordPath]: jsonFile(recordPath, { id, path, mimeType: file.type, title: plainText(form.get('title'), 200) }) }, [], request.signal);
      return jsonResponse({ id, source_url: mediaPreview(options.getProject(), path) }, 201);
    }
    return jsonResponse({ code: 'kodety_cms_route', message: 'Esta operação do CMS não está disponível.' }, 404);
  }
  const fetchLocal: typeof fetch = (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), base), init);
    const run = async () => {
      try { return await handle(request); }
      catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        return jsonResponse({ code: error instanceof StaticCmsError ? error.code : 'kodety_cms_save_failed', message: error instanceof Error ? error.message : 'Não foi possível salvar o CMS.' }, error instanceof StaticCmsError ? error.status : 500);
      }
    };
    // Reads wait for preceding mutations so a successful write is immediately
    // visible to all CMS panels. A failed write never changes the project.
    const result = tail.catch(() => undefined).then(run);
    tail = result;
    return result;
  };
  return {
    fetch: fetchLocal,
    config: { cmsSchemaUrl: endpoint('schema'), cmsItemsUrl: endpoint('items'), cmsCollectionsUrl: endpoint('collections'), cmsFieldsUrl: endpoint('fields'), cmsTemplatesUrl: endpoint('templates'), mediaUploadUrl: endpoint('media'), nonce: '', canManageCmsSchema: true, canManageCmsTemplates: true },
    dispose() { disposed = true; canonicalByPreview.forEach((_path, url) => URL.revokeObjectURL(url)); previewByPath.clear(); canonicalByPreview.clear(); },
  };
}
