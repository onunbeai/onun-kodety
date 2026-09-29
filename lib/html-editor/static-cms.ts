import { parse, parseFragment, serialize } from 'parse5';
import { readEditorMetadata, updateEditorMetadata } from './project-io';
import { readStaticCms, sanitizeStaticCmsRichText, staticCmsItemRoute, type StaticCmsItem, type StaticCmsType } from './static-cms-store';
import type { HtmlProject } from './types';

interface Node {
  nodeName?: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  parentNode?: Node;
  value?: string;
  content?: Node;
}
const targets = ['content', 'title', 'href', 'src', 'alt'];
const collectionAttributes = ['data-kodety-collection', 'data-kodety-limit', 'data-kodety-orderby', 'data-kodety-order', 'data-kodety-repeat'];
const htmlFile = (path: string) => /\.html?$/i.test(path) && !path.startsWith('.incode/');
const attr = (node: Node, name: string) => node.attrs?.find(attribute => attribute.name === name)?.value;
const has = (node: Node, name: string) => attr(node, name) !== undefined;
function set(node: Node, name: string, value: string) {
  node.attrs ||= [];
  const existing = node.attrs.find(attribute => attribute.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}
function removeAttr(node: Node, name: string) { node.attrs = node.attrs?.filter(attribute => attribute.name !== name); }
function children(node: Node, next: Node[]) { node.childNodes = next; next.forEach(child => { child.parentNode = node; }); }
function text(node: Node, value: string) { children(node, [{ nodeName: '#text', value }]); }
function content(node: Node): string { return node.value || (node.childNodes || []).map(content).join(''); }
function walk(node: Node, visit: (node: Node) => void) { visit(node); [...node.childNodes || []].forEach(child => walk(child, visit)); }
function find(node: Node, predicate: (node: Node) => boolean): Node | undefined {
  if (predicate(node)) return node;
  for (const child of node.childNodes || []) { const result = find(child, predicate); if (result) return result; }
}
function detach(node: Node) { if (node.parentNode) children(node.parentNode, node.parentNode.childNodes!.filter(child => child !== node)); }
function clone(node: Node): Node {
  const next = { ...node, attrs: node.attrs?.map(attribute => ({ ...attribute })), parentNode: undefined };
  if (node.childNodes) children(next, node.childNodes.map(clone));
  if (node.content) next.content = clone(node.content);
  return next;
}
function stringify(node: Node): string { return serialize(node as never); }
function relative(fromFile: string, toPath: string) {
  const from = fromFile.split('/'); from.pop();
  const to = toPath.split('/');
  while (from.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/') || './';
}
const encoded = (value: string) => value.split('/').map(part => part === '..' || part === '.' ? part : encodeURIComponent(part)).join('/');
function scalar(value: unknown): string {
  if (Array.isArray(value)) return value.map(scalar).join(', ');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return scalar(record.url ?? record.value ?? record.label ?? '');
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : value === true ? '1' : '';
}
function safeUrl(value: string): string {
  const cleaned = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(cleaned) || /^(?:javascript|vbscript|file|blob|data):/i.test(cleaned)) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(cleaned) && !/^(?:https?|mailto|tel):/i.test(cleaned)) return '';
  return cleaned;
}

/** CMS rich text is data, not a second source of executable project markup. */
function richText(markup: string): Node[] {
  const fragment = parseFragment(sanitizeStaticCmsRichText(markup)) as unknown as Node;
  return fragment.childNodes || [];
}

type ItemContext = { type: StaticCmsType; item: StaticCmsItem };
type RenderContext = {
  project: HtmlProject; sourcePath: string; types: Map<string, StaticCmsType>;
  published: Map<string, StaticCmsItem[]>; singular?: ItemContext;
};
function itemValue(context: RenderContext, current: ItemContext, binding: string): unknown {
  if (binding === 'permalink') {
    const route = staticCmsItemRoute(current.type, current.item);
    return encoded(relative(context.sourcePath, route.path));
  }
  const values = current.item.values;
  if (Object.hasOwn(values, binding)) return values[binding];
  if (binding.startsWith('field:')) return values[binding.slice(6)] ?? '';
  return values['field:' + binding] ?? '';
}
function resolveTokens(value: string, context: RenderContext, current: ItemContext) {
  return value.replace(/\{\{([^{}]+)\}\}/g, (_, binding: string) => scalar(itemValue(context, current, binding.trim())));
}
function resolveMetadata<T>(value: T, context: RenderContext, current: ItemContext): T {
  if (typeof value === 'string') return resolveTokens(value, context, current) as T;
  if (Array.isArray(value)) return value.map(child => resolveMetadata(child, context, current)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveMetadata(child, context, current)])) as T;
  return value;
}
function applyBindings(root: Node, context: RenderContext, current: ItemContext, singular = false) {
  const apply = (node: Node, first = false) => {
    if ((!first && has(node, 'data-kodety-collection')) || (singular && (has(node, 'data-kodety-item-id') || has(node, 'data-kodety-rendered-collection')))) return;
    const bindings: Record<string, string> = {};
    const legacy = attr(node, 'data-kodety-bind');
    if (legacy) {
      let target = attr(node, 'data-kodety-bind-target') || 'auto';
      if (target === 'auto') target = node.tagName === 'a' ? 'href' : ['img', 'source', 'video'].includes(node.tagName || '') ? 'src' : 'content';
      if (targets.includes(target)) bindings[target] = legacy;
    }
    for (const target of targets) { const binding = attr(node, 'data-kodety-bind-' + target); if (binding) bindings[target] = binding; }
    for (const [target, binding] of Object.entries(bindings)) {
      let value = itemValue(context, current, target === 'href' && binding === 'slug' ? 'permalink' : binding);
      if (target === 'content') {
        const fieldKey = binding.replace(/^field:/, '');
        const field = current.type.fields.find(field => field.key === binding || field.key === fieldKey);
        if (binding === 'content' || ['wysiwyg', 'richtext', 'rich_text', 'rich-text', 'html'].includes(field?.type || '')) {
          children(node, richText(scalar(value)));
          walk(node, child => { for (const attribute of child.attrs || []) if (['src', 'href'].includes(attribute.name) && context.project.files[attribute.value]) attribute.value = encoded(relative(context.sourcePath, attribute.value)); });
        }
        else text(node, scalar(value));
      } else {
        if (target === 'alt' && value && typeof value === 'object' && !Array.isArray(value)) value = (value as Record<string, unknown>).alt ?? value;
        if (target === 'src' && value && typeof value === 'object' && !Array.isArray(value)) {
          const image = value as Record<string, unknown>;
          const focal = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
          const ratios: Record<string, string> = { square: '1/1', landscape: '16/9', portrait: '4/5' };
          const ratio = typeof image.crop === 'string' ? ratios[image.crop] : undefined;
          const previous = (attr(node, 'style') || '').trim().replace(/;+$/, '');
          set(node, 'style', `${previous ? previous + ';' : ''}object-position:${focal(image.focalX)}% ${focal(image.focalY)}%;${ratio ? `aspect-ratio:${ratio};object-fit:cover;` : ''}`);
        }
        let output = scalar(value);
        if (target === 'href' || target === 'src') {
          if (context.project.files[output]) output = encoded(relative(context.sourcePath, output));
          output = safeUrl(output);
        }
        if (output) set(node, target, output); else removeAttr(node, target);
        if (target === 'src') removeAttr(node, 'srcset');
      }
    }
    [...node.childNodes || []].forEach(child => apply(child));
  };
  apply(root, true);
}
function removeEmptyStates(root: Node) {
  for (const child of [...root.childNodes || []]) {
    if (has(child, 'data-kodety-collection')) continue;
    if (has(child, 'data-kodety-empty-state')) detach(child); else removeEmptyStates(child);
  }
}
function templateFor(container: Node): Node | undefined {
  const search = (node: Node): Node | undefined => {
    for (const child of node.childNodes || []) {
      if (has(child, 'data-kodety-collection')) continue;
      if (has(child, 'data-kodety-collection-item')) return child;
      const match = search(child); if (match) return match;
    }
  };
  return search(container);
}
function renderHtml(source: string, context: RenderContext): string {
  if (!context.singular && !/data-kodety-collection\s*=/i.test(source)) return source;
  const document = parse(source) as unknown as Node;
  let count = 0;
  while (true) {
    const container = find(document, node => has(node, 'data-kodety-collection'));
    if (!container) break;
    if (++count > 1000) throw new Error('O CMS excedeu o limite de coleções aninhadas nesta página.');
    const slug = attr(container, 'data-kodety-collection')!, type = context.types.get(slug);
    if (!type) throw new Error(`Coleção CMS não encontrada: ${slug}.`);
    const explicit = templateFor(container), repeatSelf = !explicit && attr(container, 'data-kodety-repeat') !== 'child';
    const template = explicit || (repeatSelf ? container : container.childNodes?.find(node => node.tagName && !has(node, 'data-kodety-empty-state')));
    if (!template?.parentNode) throw new Error(`A coleção ${type.name} não tem um elemento de modelo.`);
    const orderby = attr(container, 'data-kodety-orderby') || 'date', asc = attr(container, 'data-kodety-order')?.toUpperCase() === 'ASC';
    const items = [...context.published.get(slug) || []];
    items.sort((left, right) => {
      const key = (item: StaticCmsItem) => orderby === 'title' ? scalar(item.values.title) : orderby === 'menu_order' ? Number(item.values.menu_order || 0) : orderby === 'modified' ? item.modifiedIso || '' : item.dateIso || '';
      const a = key(left), b = key(right);
      const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
      return (asc ? 1 : -1) * (compared || left.id - right.id);
    });
    const limit = Math.max(1, Math.min(100, Number.parseInt(attr(container, 'data-kodety-limit') || '6', 10) || 6));
    const parent = template.parentNode, index = parent.childNodes!.indexOf(template);
    const clones = items.slice(0, limit).map(item => {
      const copy = clone(template);
      removeAttr(copy, 'data-kodety-collection-item');
      if (repeatSelf) collectionAttributes.forEach(name => removeAttr(copy, name));
      set(copy, 'data-kodety-item-id', String(item.id));
      removeEmptyStates(copy);
      applyBindings(copy, context, { type, item });
      return copy;
    });
    if (clones.length || !repeatSelf) {
      children(parent, [...parent.childNodes!.slice(0, index), ...clones, ...parent.childNodes!.slice(index + 1)]);
      if (!repeatSelf) {
        collectionAttributes.forEach(name => removeAttr(container, name));
        set(container, 'data-kodety-rendered-collection', slug);
        if (clones.length) removeEmptyStates(container); else set(container, 'data-kodety-empty', 'true');
      }
    } else {
      const empty = container.childNodes?.filter(node => has(node, 'data-kodety-empty-state')) || [];
      if (!empty.length) detach(container);
      else {
        children(container, empty); collectionAttributes.forEach(name => removeAttr(container, name));
        set(container, 'data-kodety-rendered-collection', slug); set(container, 'data-kodety-empty', 'true');
      }
    }
  }
  if (context.singular) {
    applyBindings(document, context, context.singular, true);
    const head = find(document, node => node.tagName === 'head');
    if (head) walk(head, node => {
      if (node.tagName === 'title') text(node, resolveTokens(content(node), context, context.singular!));
      for (const attribute of node.attrs || []) if ((node.tagName === 'meta' && attribute.name === 'content') || (node.tagName === 'link' && attribute.name === 'href')) attribute.value = resolveTokens(attribute.value, context, context.singular!);
      if (node.tagName === 'script' && has(node, 'data-kodety-seo')) {
        try {
          const value = JSON.parse((node.childNodes || []).map(child => child.value || '').join(''));
          text(node, JSON.stringify(resolveMetadata(value, context, context.singular!)).replace(/</g, '\\u003c'));
        } catch { /* An authored non-JSON script is left intact. */ }
      }
    });
  }
  return stringify(document);
}

function materializedBase(source: string, sourcePath: string, outputPath: string): string {
  const document = parse(source) as unknown as Node, head = find(document, node => node.tagName === 'head')!;
  const existing = find(head, node => node.tagName === 'base' && has(node, 'href'));
  const sourceUrl = new URL(encoded(sourcePath), 'https://kodety.invalid/');
  let target: URL;
  try { target = existing ? new URL(attr(existing, 'href')!, sourceUrl) : new URL('./', sourceUrl); }
  catch { throw new Error(`Base HTML inválida no modelo ${sourcePath}.`); }
  if (target.origin !== sourceUrl.origin) return source;
  const baseDocument = decodeURIComponent(target.pathname).replace(/^\//, '') + (target.pathname.endsWith('/') ? 'index.html' : '');
  const selfHref = encoded(relative(baseDocument, outputPath));
  const body = find(document, node => node.tagName === 'body');
  if (body) walk(body, node => {
    for (const attribute of node.attrs || []) {
      if (!['href', 'action', 'formaction'].includes(attribute.name)) continue;
      const value = attribute.value;
      if (!value || value.startsWith('#') || value.startsWith('?')) { attribute.value = selfHref + value; continue; }
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue;
      try {
        const resolved = new URL(value, target);
        if (resolved.origin === sourceUrl.origin && resolved.pathname === sourceUrl.pathname) attribute.value = selfHref + resolved.search + resolved.hash;
      } catch { /* Keep unrelated authored URLs untouched. */ }
    }
  });
  const href = encoded(relative(outputPath, baseDocument)).replace(/index\.html$/, '');
  if (existing) set(existing, 'href', href || './');
  else {
    const base = (parseFragment('<base data-kodety-static-cms-base="">') as unknown as Node).childNodes![0];
    set(base, 'href', href || './'); children(head, [base, ...head.childNodes || []]);
  }
  return stringify(document);
}

export class StaticCmsPublicationError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Não foi possível publicar as páginas do CMS.', { cause });
    this.name = 'StaticCmsPublicationError';
  }
}

/** Materialize only published CMS data on a copy. Canonical project files stay
 * editable and retain drafts; CMS JSON is never part of the public site. */
export function prepareStaticCmsProject(project: HtmlProject): HtmlProject {
  try { return materializeStaticCmsProject(project); }
  catch (cause) { throw new StaticCmsPublicationError(cause); }
}

function materializeStaticCmsProject(project: HtmlProject): HtmlProject {
  const { schema, items } = readStaticCms(project);
  const types = new Map(schema.types.map(type => [type.slug, type]));
  const published = new Map<string, StaticCmsItem[]>();
  for (const item of items.filter(item => item.status === 'publish')) {
    const type = types.get(item.type || '');
    if (!type) throw new Error(`A coleção do item CMS ${item.id} não existe.`);
    staticCmsItemRoute(type, item);
    published.set(type.slug, [...published.get(type.slug) || [], item]);
  }
  const templates = new Set(Object.values(schema.templates));
  for (const [type, template] of Object.entries(schema.templates)) {
    if (!types.has(type) || !htmlFile(template) || typeof project.files[template]?.text !== 'string') throw new Error(`Modelo CMS não encontrado: ${template}.`);
    if (template === project.mainHtmlPath) throw new Error('A página inicial não pode ser usada como modelo exclusivo de uma coleção CMS.');
  }
  const metadata = readEditorMetadata(project);
  const files = Object.fromEntries(Object.entries(project.files).filter(([path]) => !path.startsWith('.incode/cms/') && !templates.has(path)));
  const generated = new Map<string, { template: string; current: ItemContext; context: RenderContext }>();
  const claimed = new Set(Object.keys(files).map(path => path.toLowerCase()));
  for (const [slug, template] of Object.entries(schema.templates)) {
    const type = types.get(slug)!;
    for (const item of published.get(slug) || []) {
      const route = staticCmsItemRoute(type, item);
      if (claimed.has(route.path.toLowerCase()) || [...claimed].some(path => route.path.toLowerCase().startsWith(path + '/') || path.startsWith(route.path.toLowerCase() + '/'))) throw new Error(`Duas páginas ou arquivos usam a URL CMS ${route.path}.`);
      claimed.add(route.path.toLowerCase());
      const context: RenderContext = { project, sourcePath: template, types, published, singular: { type, item } };
      const rendered = renderHtml(project.files[template].text!, context);
      files[route.path] = { ...project.files[template], path: route.path, text: materializedBase(rendered, template, route.path) };
      generated.set(route.path, { template, current: { type, item }, context });
    }
  }
  for (const [path, file] of Object.entries(files)) {
    if (htmlFile(path) && typeof file.text === 'string' && !generated.has(path)) files[path] = { ...file, text: renderHtml(file.text, { project, sourcePath: path, types, published }) };
  }
  if (!generated.size) return { ...project, files };
  return updateEditorMetadata({ ...project, files }, current => {
    const next = { ...current, pageSettings: { ...metadata.pageSettings }, pageStatuses: { ...metadata.pageStatuses } };
    if (metadata.localization) next.localization = { ...metadata.localization, translations: { ...metadata.localization.translations } };
    for (const [outputPath, { template, current: item, context }] of generated) {
      if (metadata.pageSettings?.[template]) next.pageSettings[outputPath] = { ...resolveMetadata(metadata.pageSettings[template], context, item), canonicalUrl: '' };
      delete next.pageStatuses[outputPath];
      for (const [locale, translation] of Object.entries(metadata.localization?.translations || {})) {
        const page = translation.pages?.[template];
        if (page && next.localization) {
          const localized = next.localization.translations[locale] || translation;
          next.localization.translations[locale] = { ...localized, pages: { ...localized.pages, [outputPath]: { ...resolveMetadata(page, context, item), path: undefined } } };
        }
      }
    }
    return next;
  });
}
