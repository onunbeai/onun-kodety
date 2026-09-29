import { parse, type DefaultTreeAdapterMap } from 'parse5';
import geistUrl from '../../../lib/html-editor/fonts/geist/Geist-Regular.ttf?url';
import { isLocalizationPageFile, normalizeLocalization } from '../../../lib/html-editor/localization';
import { readEditorMetadata } from '../../../lib/html-editor/project-io';
import { resolveProjectPath } from '../../../lib/html-editor/project-path';
import { staticHtmlRoutes } from '../../../lib/html-editor/static-project';
import {
  normalizeSocialImageTemplate, normalizeSocialImageTemplateId,
  normalizeSocialImageTemplateLibrary, resolveSocialImageValue,
  socialImageAutoHeightLimit, socialImageElementRect, socialImageStackRects,
  type SocialImageElement, type SocialImageElementRect, type SocialImageIconName,
  type SocialImageObjectFit, type SocialImageTemplate, type SocialImageTextElement,
} from '../../../lib/html-editor/social-image';
import type { HtmlProject, HtmlProjectFile } from '../../../lib/html-editor/types';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
export interface HtmlSocialImageRenderRequest {
  project: HtmlProject;
  referencePath: string;
  template: SocialImageTemplate;
  variables: Record<string, unknown>;
}
export interface HtmlSocialImageOptions {
  /** Canonical source before locale routes/home-page aliases were materialized. */
  sourceProject?: HtmlProject;
  render?: (request: HtmlSocialImageRenderRequest) => Promise<Uint8Array>;
}
const MAX_RESOURCE_BYTES = 20_000_000;
const MAX_IMAGE_PIXELS = 24_000_000;
const RESOURCE_TIMEOUT = 15_000;

function elements(node: Node): Element[] {
  return [...('tagName' in node ? [node] : []), ...('childNodes' in node ? node.childNodes.flatMap(elements) : [])];
}
function attr(node: Element, key: string) { return node.attrs.find(item => item.name === key)?.value || ''; }
function readMeta(nodes: Element[], key: string) {
  return attr(nodes.find(node => node.tagName === 'meta' && (attr(node, 'property') === key || attr(node, 'name') === key)) || { attrs: [] } as unknown as Element, 'content');
}
function nodeText(node: Node): string {
  return 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(nodeText).join('') : '';
}
function httpUrl(value: string): URL | null {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; }
  catch { return null; }
}
function assetUrl(path: string, base: string | undefined, canonical: string, pagePath: string): string {
  let url = base ? httpUrl(base) : null;
  if (!url) {
    url = httpUrl(canonical);
    if (url) {
      // An imported page canonical can establish a mount path without silently
      // sending its assets to the origin root (e.g. GitHub project pages).
      const routes = [pagePath, pagePath.replace(/index\.html?$/i, ''), pagePath.replace(/\.html?$/i, '')]
        .map(route => route.split('/').map(encodeURIComponent).join('/'));
      const suffix = routes.find(route => route && url!.pathname.endsWith(`/${route}`));
      url.pathname = suffix ? url.pathname.slice(0, -suffix.length)
        : routes.includes('') && url.pathname.endsWith('/') ? url.pathname : '/';
    }
  }
  if (!url) throw new Error('Configure a URL pública do site para publicar os templates de Social Image em HTML.');
  url.hash = ''; url.search = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return new URL(path.split('/').map(encodeURIComponent).join('/'), url).href;
}
function updateImageTags(source: string, nodes: Element[], url: string, template: SocialImageTemplate): string {
  const head = nodes.find(node => node.tagName === 'head');
  const insertion = head?.sourceCodeLocation?.endTag?.startOffset;
  if (insertion === undefined) throw new Error('A página precisa conter <head> para publicar a Social Image.');
  const keys = new Set(['og:image', 'og:image:url', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'twitter:image', 'twitter:image:src', 'twitter:card']);
  const edits = nodes.filter(node => node.tagName === 'meta' && keys.has(attr(node, 'property') || attr(node, 'name')))
    .flatMap(node => node.sourceCodeLocation ? [{ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, value: '' }] : []);
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const tags = [
    ['property', 'og:image', url], ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', String(template.width)], ['property', 'og:image:height', String(template.height)],
    ['name', 'twitter:image', url], ['name', 'twitter:card', 'summary_large_image'],
  ].map(([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escape(value)}">`).join('\n');
  edits.push({ start: insertion, end: insertion, value: `${tags}\n` });
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}
async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)), value => value.toString(16).padStart(2, '0')).join('');
}
function sameBytes(a: Uint8Array | undefined, b: Uint8Array) { return a?.length === b.length && a.every((byte, index) => byte === b[index]); }

/** Materialize real PNGs after the shared static compiler, before any release
 * reaches the folder, ZIP or GitHub. Editor metadata remains the visual source. */
export async function prepareHtmlSocialImages(project: HtmlProject, options: HtmlSocialImageOptions = {}): Promise<HtmlProject> {
  const metadata = readEditorMetadata(project);
  const site = metadata.siteSettings || {};
  const library = new Map(normalizeSocialImageTemplateLibrary(site.socialImageTemplates).map(template => [template.id, template]));
  const assigned = (settings: { socialImageTemplateId?: string; socialImageTemplate?: SocialImageTemplate } | undefined) => {
    const linked = library.get(normalizeSocialImageTemplateId(settings?.socialImageTemplateId));
    return linked || (settings?.socialImageTemplate ? normalizeSocialImageTemplate(settings.socialImageTemplate) : undefined);
  };
  const siteTemplate = assigned(site);
  if (!siteTemplate && !Object.values(metadata.pageSettings || {}).some(settings => assigned(settings))) return project;
  const routes = options.sourceProject ? staticHtmlRoutes(options.sourceProject) : [];
  const sources = new Map(routes.map(route => [route.outputPath, route]));
  const localization = metadata.localization ? normalizeLocalization(metadata.localization) : undefined;
  const files = { ...project.files };
  for (const file of Object.values(project.files).filter(isLocalizationPageFile)) {
    const route = sources.get(file.path);
    const referencePath = route?.sourcePath || file.path;
    const page = metadata.pageSettings?.[referencePath];
    const template = assigned(page) || siteTemplate;
    if (!template) continue;
    const nodes = elements(parse(file.text!, { sourceCodeLocationInfo: true }));
    const canonical = attr(nodes.find(node => node.tagName === 'link' && attr(node, 'rel').split(/\s+/).includes('canonical')) || { attrs: [] } as unknown as Element, 'href');
    const title = readMeta(nodes, 'og:title') || readMeta(nodes, 'twitter:title') || nodeText(nodes.find(node => node.tagName === 'title') || { nodeName: '#text', value: '' } as Node);
    const description = readMeta(nodes, 'og:description') || readMeta(nodes, 'description');
    const featuredImage = page?.socialImage || readMeta(nodes, 'og:image') || site.socialImage || '';
    let localizedSiteName = '';
    let locale = route?.locale;
    const seen = new Set<string>();
    while (localization && locale && locale !== localization.sourceLocale && !seen.has(locale)) {
      seen.add(locale);
      localizedSiteName = localization.translations[locale]?.siteTitle?.trim() || '';
      if (localizedSiteName) break;
      locale = localization.locales.find(item => item.code === locale)?.fallback;
    }
    const variables = {
      'page.title': title, 'page.excerpt': description, 'page.url': canonical,
      'page.featured_image': featuredImage,
      'page.date': readMeta(nodes, 'article:published_time') || attr(nodes.find(node => node.tagName === 'time' && attr(node, 'datetime')) || { attrs: [] } as unknown as Element, 'datetime'),
      'author.name': readMeta(nodes, 'author'), 'author.avatar': readMeta(nodes, 'author:avatar'),
      'site.name': localizedSiteName || readMeta(nodes, 'og:site_name') || site.siteTitle || project.name,
      'site.logo': site.organizationLogo || site.faviconLight || '',
      'product.price': readMeta(nodes, 'product:price:amount'), 'product.image': featuredImage,
      'category.name': readMeta(nodes, 'article:section'),
    };
    // Validate the public URL before loading fonts/media or rendering pixels.
    assetUrl('kodety-social/image.png', site.baseUrl, canonical, file.path);
    try {
      const data = await (options.render || renderHtmlSocialImage)({ project, referencePath, template, variables });
      if (data.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => data[index] === value)) throw new Error('O renderizador não produziu um PNG válido.');
      const id = (await digest(new TextEncoder().encode(file.path))).slice(0, 16);
      const path = `kodety-social/${id}-${(await digest(data)).slice(0, 24)}.png`;
      const existing = files[path];
      if (existing && !sameBytes(existing.data, data)) throw new Error(`A imagem gerada conflita com o arquivo ${path}.`);
      files[path] = { path, mimeType: 'image/png', data };
      files[file.path] = { ...file, text: updateImageTags(file.text!, nodes, assetUrl(path, site.baseUrl, canonical, file.path), template) };
    } catch (error) {
      throw new Error(`Social Image de ${file.path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return { ...project, files };
}

function projectAsset(project: HtmlProject, referencePath: string, source: string): HtmlProjectFile | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) return undefined;
  let direct = source.split(/[?#]/, 1)[0].replace(/^\/+/, '');
  try { direct = decodeURIComponent(direct); } catch { /* Keep authored path. */ }
  const relative = resolveProjectPath(referencePath, source, project.rootPath);
  return (source.startsWith('/') ? project.files[direct] : undefined)
    || (relative ? project.files[relative] : undefined) || project.files[direct]
    || project.files[[project.rootPath, direct].filter(Boolean).join('/')]
    || project.files[[project.rootPath, 'public', direct].filter(Boolean).join('/')];
}
async function resourceBytes(request: HtmlSocialImageRenderRequest, source: string): Promise<Blob> {
  const file = projectAsset(request.project, request.referencePath, source);
  if (file) {
    const bytes = file.data || new TextEncoder().encode(file.text || '');
    if (bytes.byteLength > MAX_RESOURCE_BYTES) throw new Error(`A mídia ${source} excede 20 MB.`);
    return new Blob([Uint8Array.from(bytes).buffer], { type: file.mimeType });
  }
  if (!httpUrl(source) && !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);/i.test(source)) throw new Error(`Mídia ou fonte ausente nos arquivos do projeto: ${source}`);
  let response: Response;
  try { response = await fetch(source, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(RESOURCE_TIMEOUT) }); }
  catch (error) { throw new Error(`Não foi possível carregar ${source}. Importe a mídia para o projeto ou habilite CORS na origem.`, { cause: error }); }
  if (!response.ok) throw new Error(`Não foi possível carregar ${source} (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_RESOURCE_BYTES) throw new Error(`A mídia ${source} excede 20 MB.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`A mídia ${source} não contém dados.`);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESOURCE_BYTES) { await reader.cancel(); throw new Error(`A mídia ${source} excede 20 MB.`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks.map(chunk => Uint8Array.from(chunk).buffer), { type: response.headers.get('content-type') || '' });
}
function canvas(width: number, height: number) {
  const node = document.createElement('canvas'); node.width = width; node.height = height;
  const context = node.getContext('2d');
  if (!context) throw new Error('Este navegador não disponibiliza Canvas 2D para gerar a Social Image.');
  return { node, context };
}
function rounded(context: CanvasRenderingContext2D, width: number, height: number, radius: number, inset = 0) {
  context.beginPath(); context.roundRect(inset, inset, Math.max(0, width - inset * 2), Math.max(0, height - inset * 2), Math.max(0, Math.min(radius, width / 2, height / 2) - inset));
}
function elementOutline(context: CanvasRenderingContext2D, element: SocialImageElement, rect: SocialImageElementRect, inset = 0) {
  if (element.type === 'shape' && element.shape === 'ellipse') {
    context.beginPath(); context.ellipse(rect.width / 2, rect.height / 2, Math.max(0, rect.width / 2 - inset), Math.max(0, rect.height / 2 - inset), 0, 0, Math.PI * 2);
  } else rounded(context, rect.width, rect.height, element.border.radius, inset);
}
function fitImage(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, fit: SocialImageObjectFit, focalX = 50, focalY = 50) {
  const scale = fit === 'contain' ? Math.min(width / image.naturalWidth, height / image.naturalHeight) : Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = fit === 'fill' ? width : image.naturalWidth * scale;
  const h = fit === 'fill' ? height : image.naturalHeight * scale;
  context.drawImage(image, (width - w) * focalX / 100, (height - h) * focalY / 100, w, h);
}
function graphemes(value: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), entry => entry.segment);
}
export function wrapSocialImageText(context: Pick<CanvasRenderingContext2D, 'measureText'>, value: string, width: number, letterSpacing: number): string[] {
  const measure = (text: string) => context.measureText(text).width + Math.max(0, graphemes(text).length - 1) * letterSpacing;
  return value.replace(/\r\n?/g, '\n').split('\n').flatMap(paragraph => {
    const lines: string[] = []; let line = '';
    for (const token of paragraph.match(/\s+|\S+/g) || []) {
      if (line && measure(line + token) > width) { lines.push(line); line = ''; }
      if (measure(token) <= width) { line += token; continue; }
      for (const character of graphemes(token)) {
        if (line && measure(line + character) > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line); return lines;
  });
}
const ICON_PATHS: Record<SocialImageIconName, string[]> = {
  'arrow-up-right': ['M7 17 17 7', 'M7 7h10v10'], check: ['m20 6-11 11-5-5'],
  play: ['m6 3 14 9-14 9V3Z'],
  star: ['m12 3 2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.34l-5.62 2.96 1.07-6.27L2.9 9.6l6.3-.9L12 3Z'],
  heart: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z'],
  sparkles: ['m12 3 1.91 5.81L20 11l-6.09 2.19L12 19l-1.91-5.81L4 11l6.09-2.19L12 3Z', 'M5 3v4M3 5h4M19 14v6M16 17h6'],
};

/** Browser-native renderer; all I/O is read-only and canvas stays origin-clean. */
export async function renderHtmlSocialImage(request: HtmlSocialImageRenderRequest): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') throw new Error('A geração de Social Image requer um navegador com Canvas e FontFace.');
  const template = normalizeSocialImageTemplate(request.template);
  const { node, context } = canvas(template.width, template.height);
  const faces: FontFace[] = [];
  const urls: string[] = [];
  const images = new Map<string, HTMLImageElement>();
  const fonts = new Map<string, string>();
  const textLayouts = new Map<string, { lines: string[]; family: string }>();
  const heights = new Map<string, number>();
  const resolve = (value: string) => resolveSocialImageValue(value, request.variables).trim();
  async function loadImage(source: string) {
    if (!source) return undefined;
    const cached = images.get(source); if (cached) return cached;
    const blob = await resourceBytes(request, source);
    const image = new Image(); const url = URL.createObjectURL(blob); urls.push(url);
    image.src = url;
    try { await image.decode(); } catch (error) { throw new Error(`Não foi possível decodificar a imagem ${source}.`, { cause: error }); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) throw new Error(`A imagem ${source} é inválida ou excede 24 megapixels.`);
    images.set(source, image); return image;
  }
  async function loadFont(element: SocialImageTextElement) {
    const key = `${element.fontFile || 'bundled-geist'}:${element.fontFileWeight || 400}`;
    const cached = fonts.get(key); if (cached) return cached;
    const family = `Kodety Social Export ${crypto.randomUUID()}`;
    const face = new FontFace(family, element.fontFile
      ? await (await resourceBytes(request, element.fontFile)).arrayBuffer()
      : `url(${JSON.stringify(geistUrl)})`, { weight: String(element.fontFile ? element.fontFileWeight || element.fontWeight : 400), style: 'normal' });
    try { await face.load(); } catch (error) { throw new Error(`Não foi possível carregar a fonte ${element.fontFile || 'Geist'}.`, { cause: error }); }
    document.fonts.add(face); faces.push(face); fonts.set(key, family); return family;
  }
  const setFont = (ctx: CanvasRenderingContext2D, element: SocialImageTextElement, family: string) => {
    ctx.font = `${element.fontFile ? element.fontWeight : 400} ${element.fontSize}px "${family}"`;
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  };
  try {
    for (const element of template.elements.filter(element => element.visible)) {
      if (element.type === 'image') await loadImage(resolve(element.source));
      if (element.type !== 'text') continue;
      const family = await loadFont(element); setFont(context, element, family);
      const rect = socialImageElementRect(element, template.width, template.height);
      const lines = wrapSocialImageText(context, resolveSocialImageValue(element.text, request.variables), Math.max(1, rect.width - element.border.width * 2), element.letterSpacing);
      textLayouts.set(element.id, { lines, family });
      if (element.autoHeight) heights.set(element.id, Math.max(1, Math.min(socialImageAutoHeightLimit(element, template.height), Math.ceil(lines.length * element.fontSize * element.lineHeight + element.border.width * 2))));
    }
    const bg = template.background;
    context.fillStyle = bg.color; context.fillRect(0, 0, template.width, template.height);
    if (bg.gradient.enabled) {
      const angle = bg.gradient.angle * Math.PI / 180;
      const dx = Math.sin(angle); const dy = -Math.cos(angle);
      const length = Math.abs(template.width * dx) + Math.abs(template.height * dy);
      const gradient = context.createLinearGradient(template.width / 2 - dx * length / 2, template.height / 2 - dy * length / 2, template.width / 2 + dx * length / 2, template.height / 2 + dy * length / 2);
      gradient.addColorStop(0, bg.gradient.from); gradient.addColorStop(1, bg.gradient.to);
      context.fillStyle = gradient; context.fillRect(0, 0, template.width, template.height);
    }
    const background = await loadImage(resolve(bg.image));
    if (background) { context.save(); context.globalAlpha = bg.imageOpacity; fitImage(context, background, template.width, template.height, bg.imageFit); context.restore(); }
    const stacks = socialImageStackRects(template, heights);
    for (const element of template.elements.filter(element => element.visible)) {
      const rect = stacks.get(element.id) || socialImageElementRect(element, template.width, template.height, heights.get(element.id));
      const layer = canvas(rect.width, rect.height); const ctx = layer.context;
      ctx.save(); elementOutline(ctx, element, rect); ctx.clip();
      if (element.type === 'shape') drawShape(ctx, element, rect);
      else if (element.type === 'image') {
        const image = images.get(resolve(element.source));
        if (image) { const inset = element.border.width; ctx.translate(inset, inset); fitImage(ctx, image, Math.max(1, rect.width - inset * 2), Math.max(1, rect.height - inset * 2), element.fit, element.focalX, element.focalY); }
      } else if (element.type === 'text') {
        const layout = textLayouts.get(element.id)!; setFont(ctx, element, layout.family);
        ctx.fillStyle = element.color;
        const lineHeight = element.fontSize * element.lineHeight;
        const innerHeight = rect.height - element.border.width * 2;
        const offset = element.autoHeight || element.verticalAlign === 'top' ? 0 : element.verticalAlign === 'middle' ? (innerHeight - lineHeight * layout.lines.length) / 2 : innerHeight - lineHeight * layout.lines.length;
        const metrics = ctx.measureText('Mg');
        const ascent = metrics.fontBoundingBoxAscent || element.fontSize * .8;
        const descent = metrics.fontBoundingBoxDescent || element.fontSize * .2;
        layout.lines.forEach((line, index) => {
          const characters = graphemes(line);
          const width = ctx.measureText(line).width + Math.max(0, characters.length - 1) * element.letterSpacing;
          const available = rect.width - element.border.width * 2;
          let x = element.border.width + (element.align === 'center' ? (available - width) / 2 : element.align === 'right' ? available - width : 0);
          const y = element.border.width + offset + index * lineHeight + (lineHeight - ascent - descent) / 2 + ascent;
          const paint = (text: string, left: number) => {
            ctx.fillText(text, left, y);
            if (!element.fontFile && element.fontWeight >= 600) ctx.fillText(text, left + 1, y);
            if (!element.fontFile && element.fontWeight >= 800) ctx.fillText(text, left + 2, y);
          };
          if (!element.letterSpacing) paint(line, x);
          else for (const character of characters) { paint(character, x); x += ctx.measureText(character).width + element.letterSpacing; }
        });
      } else {
        const inset = element.border.width;
        const size = Math.max(1, Math.min(rect.width, rect.height) - inset * 2);
        ctx.translate((rect.width - size) / 2, (rect.height - size) / 2); ctx.scale(size / 24, size / 24);
        ctx.lineWidth = element.strokeWidth; ctx.strokeStyle = element.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const path of ICON_PATHS[element.icon]) ctx.stroke(new Path2D(path));
      }
      ctx.restore();
      if (element.border.width && !(element.type === 'shape' && element.shape === 'line')) {
        elementOutline(ctx, element, rect, element.border.width / 2);
        ctx.strokeStyle = element.border.color; ctx.lineWidth = element.border.width; ctx.stroke();
      }
      context.save(); context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2); context.rotate(element.rotation * Math.PI / 180); context.globalAlpha = element.opacity;
      if (element.shadow.enabled) {
        const rgb = element.shadow.color.match(/\w\w/g)!.map(value => parseInt(value, 16));
        context.shadowColor = `rgba(${rgb.join(',')},${element.shadow.opacity})`;
        context.shadowBlur = element.shadow.blur; context.shadowOffsetX = element.shadow.offsetX; context.shadowOffsetY = element.shadow.offsetY;
      }
      context.drawImage(layer.node, -rect.width / 2, -rect.height / 2); context.restore();
      layer.node.width = 0; layer.node.height = 0;
    }
    const blob = await new Promise<Blob>((resolve, reject) => node.toBlob(value => value ? resolve(value) : reject(new Error('Falha ao codificar o PNG da Social Image.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    urls.forEach(url => URL.revokeObjectURL(url)); faces.forEach(face => document.fonts.delete(face));
    node.width = 0; node.height = 0;
  }
}

function drawShape(context: CanvasRenderingContext2D, element: Extract<SocialImageElement, { type: 'shape' }>, rect: SocialImageElementRect) {
  context.fillStyle = element.fill;
  if (element.shape === 'ellipse') { context.beginPath(); context.ellipse(rect.width / 2, rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2); context.fill(); }
  else if (element.shape === 'line') { const thickness = Math.max(1, element.border.width || Math.min(rect.height, 4)); context.fillRect(0, (rect.height - thickness) / 2, rect.width, thickness); }
  else context.fillRect(0, 0, rect.width, rect.height);
}
