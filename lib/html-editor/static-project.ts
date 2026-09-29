import { parse, parseFragment, serialize } from 'parse5';
import {
  applyPageTranslations, createLocale, isLocalizationPageFile,
  normalizeLocalization, resolveLocalizationPage,
  type LocalizationSettings,
} from './localization';
import { prepareCookieConsentProjectForTransport } from './cookie-consent';
import { canonicalProjectForTransport, getProjectHomePath, prepareProjectForTransport, readEditorMetadata } from './project-io';
import { applySeoToHtml, readPageSeoFromHtml, type SiteSeoSettings } from './seo-settings';
import { prepareStaticRedirects } from './static-redirects';
import { prepareStaticCmsProject } from './static-cms';
import type { HtmlProject, HtmlProjectFile } from './types';

interface HtmlNode {
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode;
  value?: string;
}
export type StaticHtmlRoute = { sourcePath: string; locale: string; outputPath: string };

const STATIC_LOCALE_RUNTIME = `(()=>{const script=document.currentScript;let cfg;try{cfg=JSON.parse(script.dataset.config)}catch(e){return}const key=cfg.key;const resolve=code=>{const path=cfg.paths[code];if(!path)return null;const url=new URL(path,document.baseURI);if(cfg.preserveQuery){url.search=location.search;url.searchParams.delete('lang')}url.hash=location.hash;return url};document.addEventListener('click',event=>{const option=event.target.closest?.('[data-kodety-locale-option]');if(!option)return;const code=option.getAttribute('hreflang');if(!cfg.paths[code])return;if(cfg.remember)try{localStorage.setItem(key,code)}catch(e){}const url=resolve(code);if(url)option.href=url.href});const requested=new URLSearchParams(location.search).get('lang');let selected=requested&&cfg.paths[requested]?requested:'';if(!selected&&cfg.locale===cfg.default){if(cfg.remember)try{const remembered=localStorage.getItem(key);if(cfg.paths[remembered])selected=remembered}catch(e){}if(!selected&&cfg.automatic){for(const language of navigator.languages||[navigator.language]){const exact=Object.keys(cfg.paths).find(code=>code.toLowerCase()===language.toLowerCase());const family=Object.keys(cfg.paths).find(code=>code.split('-')[0].toLowerCase()===language.split('-')[0].toLowerCase());if(exact||family){selected=exact||family;break}}}}if(selected&&selected!==cfg.locale){const target=resolve(selected);if(target&&target.href!==location.href)location.replace(target.href)}})();`;

function attr(node: HtmlNode, name: string) { return node.attrs?.find(item => item.name === name)?.value; }
function setAttr(node: HtmlNode, name: string, value: string) {
  node.attrs ||= [];
  const current = node.attrs.find(item => item.name === name);
  if (current) current.value = value;
  else node.attrs.push({ name, value });
}
function walk(node: HtmlNode, visit: (node: HtmlNode) => void) { visit(node); node.childNodes?.forEach(child => walk(child, visit)); }
function find(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode | undefined {
  if (predicate(node)) return node;
  for (const child of node.childNodes || []) { const found = find(child, predicate); if (found) return found; }
}
function append(parent: HtmlNode, child: HtmlNode) { parent.childNodes ||= []; child.parentNode = parent; parent.childNodes.push(child); }
function fromMarkup(markup: string): HtmlNode { return (parseFragment(markup) as unknown as HtmlNode).childNodes![0]; }
function text(node: HtmlNode, value: string) { node.childNodes = [{ nodeName: '#text', value, parentNode: node } as HtmlNode]; }
function escape(value: string) { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function encoded(path: string) { return path.split('/').map(encodeURIComponent).join('/'); }
function relative(fromFile: string, toPath: string): string {
  const from = fromFile.split('/'); from.pop();
  const to = toPath.split('/');
  while (from.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/') || './';
}
function safePath(raw: string): string {
  const path = raw.trim().replace(/^\/+|\/+$/g, '');
  let decoded = path;
  try { decoded = decodeURIComponent(decoded); } catch { throw new Error(`Caminho de idioma inválido: ${raw}`); }
  if (!path || /[\\?#:\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error(`Caminho de idioma inválido: ${raw}`);
  return path;
}

function baseUrl(settings: SiteSeoSettings | undefined): string {
  try {
    const url = new URL(settings?.baseUrl || '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.search = ''; url.hash = '';
    return url.href.replace(/\/+$/, '');
  } catch { return ''; }
}
function routeUrl(base: string, path: string) { return `${base}/${encoded(path).replace(/(?:^|\/)index\.html?$/i, match => match.startsWith('/') ? '/' : '')}`; }

/** Physical .html routes work on ordinary static hosts without rewrite rules. */
export function staticHtmlRoutes(project: HtmlProject): StaticHtmlRoute[] {
  const metadata = readEditorMetadata(project);
  const localization = metadata.localization ? normalizeLocalization(metadata.localization) : undefined;
  const locales = localization ? localization.locales.filter(locale => locale.enabled) : [createLocale(metadata.siteSettings?.language || 'pt-BR')];
  const home = getProjectHomePath(project);
  const root = project.rootPath.replace(/^\/+|\/+$/g, '');
  const homeOutput = root ? `${root}/index.html` : 'index.html';
  const routes: StaticHtmlRoute[] = [];
  const destinations = new Map<string, string>();
  for (const file of Object.values(project.files).filter(isLocalizationPageFile)) {
    if (metadata.pageStatuses?.[file.path] === 'draft') continue;
    for (const locale of locales) {
      const prefix = localization && locale.code !== localization.defaultLocale ? safePath(locale.slug) : '';
      const translation = localization && locale.code !== localization.sourceLocale && localization.translatePagePaths
        ? resolveLocalizationPage(localization, locale.code, file.path)?.path?.trim() : '';
      const pagePath = translation ? safePath(translation) : file.path === home ? homeOutput : file.path;
      const physicalPath = /\.html?$/i.test(pagePath) ? pagePath : `${pagePath}/index.html`;
      const outputPath = prefix ? `${prefix}/${physicalPath}` : physicalPath;
      const owner = `${locale.code}:${file.path}`;
      if (destinations.has(outputPath.toLowerCase())) throw new Error(`Duas páginas usam a mesma URL: ${outputPath}. Ajuste o prefixo ou caminho traduzido.`);
      if (project.files[outputPath] && !isLocalizationPageFile(project.files[outputPath])) throw new Error(`A rota ${outputPath} conflita com um arquivo existente.`);
      destinations.set(outputPath.toLowerCase(), owner);
      routes.push({ sourcePath: file.path, locale: locale.code, outputPath });
    }
  }
  return routes;
}

function localizedSiteValue(settings: LocalizationSettings, localeCode: string, property: 'siteTitle' | 'siteDescription'): string | undefined {
  const seen = new Set<string>();
  let code: string | undefined = localeCode;
  while (code && !seen.has(code) && code !== settings.sourceLocale) {
    seen.add(code);
    const value = settings.translations[code]?.[property];
    if (value?.trim()) return value;
    code = settings.locales.find(locale => locale.code === code)?.fallback;
  }
}

function routeHtml(source: string, route: StaticHtmlRoute, routes: StaticHtmlRoute[], settings: LocalizationSettings | undefined, project: HtmlProject): string {
  const document = parse(source) as unknown as HtmlNode;
  const head = find(document, node => node.tagName === 'head')!;
  const body = find(document, node => node.tagName === 'body')!;
  const html = find(document, node => node.tagName === 'html')!;
  const locale = settings?.locales.find(item => item.code === route.locale);
  if (settings) { setAttr(html, 'lang', route.locale); setAttr(html, 'dir', locale?.direction || 'ltr'); }
  const originalBase = find(head, node => node.tagName === 'base' && attr(node, 'href') !== undefined);
  const originalUrl = new URL(encoded(route.sourcePath), 'https://kodety.invalid/');
  const authoredBase = originalBase ? new URL(attr(originalBase, 'href')!, originalUrl) : originalUrl;
  const basePath = decodeURIComponent(authoredBase.pathname).replace(/^\//, '');
  const baseDocument = authoredBase.pathname.endsWith('/') ? `${basePath}index.html` : basePath;
  const localBase = authoredBase.origin === originalUrl.origin;
  // Keep relative assets, CSS URLs, inline module imports and fetch() relative
  // to their authored location when the HTML moves into a locale directory.
  if (route.outputPath !== route.sourcePath && localBase) {
    const base = originalBase || fromMarkup('<base data-kodety-static-base="">');
    const baseDirectory = baseDocument.slice(0, baseDocument.lastIndexOf('/') + 1);
    const relativeBase = relative(route.outputPath, `${baseDirectory}index.html`).replace(/index\.html$/, '') || './';
    setAttr(base, 'href', encoded(relativeBase));
    if (!originalBase) { base.parentNode = head; head.childNodes!.unshift(base); }
  }
  const referenceFrom = localBase ? baseDocument : route.outputPath;
  const hrefFor = (target: string) => localBase ? encoded(relative(referenceFrom, target)) : routeUrl(baseUrl(readEditorMetadata(project).siteSettings), target);
  const routeForLink = (value: string): string | null => {
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return null;
    if (value.startsWith('#') || value.startsWith('?')) return `${hrefFor(route.outputPath)}${value}`;
    let url: URL;
    try { url = new URL(value, authoredBase); } catch { return null; }
    if (url.origin !== originalUrl.origin) return null;
    let path: string;
    try { path = decodeURIComponent(url.pathname).replace(/^\//, ''); } catch { return null; }
    const candidates = new Set([path, `${path}.html`, `${path.replace(/\/$/, '')}/index.html`]);
    if (!path) candidates.add(getProjectHomePath(project));
    const target = routes.find(item => item.locale === route.locale && candidates.has(item.sourcePath));
    return target ? `${hrefFor(target.outputPath)}${url.search}${url.hash}` : null;
  };
  walk(body, node => {
    for (const attribute of node.attrs || []) {
      if (!['href', 'action', 'formaction'].includes(attribute.name)) continue;
      const next = routeForLink(attribute.value);
      if (next) attribute.value = next;
    }
  });
  if (settings) {
    const alternates = routes.filter(item => item.sourcePath === route.sourcePath);
    walk(body, root => {
      if (attr(root, 'data-kodety-locale-selector') === undefined && attr(root, 'data-incode-component') !== 'locales-list') return;
      const current = find(root, node => attr(node, 'data-kodety-locale-current') !== undefined);
      if (current) text(current, locale?.name || route.locale);
      const options = find(root, node => attr(node, 'data-kodety-locale-options') !== undefined);
      if (!options) return;
      const template = find(options, node => node.tagName === 'a');
      if (!template) return;
      const templateHtml = serialize({ nodeName: '#document-fragment', childNodes: [template] } as never);
      options.childNodes = [];
      alternates.forEach(alternate => {
        const targetLocale = settings.locales.find(item => item.code === alternate.locale)!;
        const option = fromMarkup(templateHtml);
        text(option, targetLocale.name || targetLocale.code);
        setAttr(option, 'href', hrefFor(alternate.outputPath));
        setAttr(option, 'data-kodety-locale-option', '');
        setAttr(option, 'hreflang', alternate.locale);
        setAttr(option, 'lang', alternate.locale);
        setAttr(option, 'dir', targetLocale.direction);
        option.attrs = option.attrs?.filter(item => item.name !== 'aria-current');
        if (alternate.locale === route.locale) setAttr(option, 'aria-current', 'page');
        append(options, option);
      });
    });
    head.childNodes = head.childNodes?.filter(node => !(node.tagName === 'link' && attr(node, 'rel') === 'alternate' && attr(node, 'hreflang')));
    const base = baseUrl(readEditorMetadata(project).siteSettings);
    if (base) {
      for (const alternate of alternates) append(head, fromMarkup(`<link rel="alternate" hreflang="${escape(alternate.locale)}" href="${escape(routeUrl(base, alternate.outputPath))}">`));
      const fallback = alternates.find(item => item.locale === settings.defaultLocale);
      if (fallback) append(head, fromMarkup(`<link rel="alternate" hreflang="x-default" href="${escape(routeUrl(base, fallback.outputPath))}">`));
    }
    const metadata = readEditorMetadata(project);
    const config = { locale: route.locale, default: settings.defaultLocale, automatic: settings.automaticLocale, remember: settings.rememberLocale, preserveQuery: metadata.siteSettings?.preserveQueryParameters !== false, paths: Object.fromEntries(alternates.map(item => [item.locale, hrefFor(item.outputPath)])), key: `kodety-static-locale:${metadata.projectId || project.name}` };
    append(body, fromMarkup(`<script data-kodety-static-localization="1" data-config="${escape(JSON.stringify(config))}">${STATIC_LOCALE_RUNTIME}</script>`));
  }
  return serialize(document as never);
}

/** Shared static release compiler. WordPress keeps its server locale routes.
 * The caller retains the canonical source separately when writing this result
 * into an editable directory; these materialized pages must not be re-imported
 * as the source translations. Metadata is retained for portable ZIP restores. */
export function prepareStaticHtmlProject(source: HtmlProject): HtmlProject {
  const canonical = canonicalProjectForTransport(source);
  const prepared = prepareProjectForTransport(prepareStaticCmsProject(canonical));
  const metadata = readEditorMetadata(prepared);
  const settings = metadata.localization ? normalizeLocalization(metadata.localization) : undefined;
  const routes = staticHtmlRoutes(prepared);
  const site = metadata.siteSettings;
  const base = baseUrl(site);
  const files: Record<string, HtmlProjectFile> = { ...prepared.files };
  const sourcePages = Object.values(prepared.files).filter(isLocalizationPageFile);
  // Source-only/draft pages stay in the caller's canonical snapshot, not the static site.
  sourcePages.forEach(file => { delete files[file.path]; });
  for (const route of routes) {
    const file = prepared.files[route.sourcePath];
    let rendered = settings ? applyPageTranslations(file.text!, route.sourcePath, route.locale, settings) : file.text!;
    const translation = settings && route.locale !== settings.sourceLocale ? resolveLocalizationPage(settings, route.locale, route.sourcePath) : null;
    if (site || metadata.pageSettings?.[route.sourcePath] || settings) {
      const page = { ...readPageSeoFromHtml(file.text!), ...metadata.pageSettings?.[route.sourcePath] };
      const translatedSeo = readPageSeoFromHtml(rendered);
      const localizedTitle = translation?.title || (settings && localizedSiteValue(settings, route.locale, 'siteTitle') ? translatedSeo.title : undefined);
      const localizedDescription = translation?.description || (settings && localizedSiteValue(settings, route.locale, 'siteDescription') ? translatedSeo.description : undefined);
      const localizedSite = { ...site, ...(settings ? { language: route.locale, rightToLeft: settings.locales.find(locale => locale.code === route.locale)?.direction === 'rtl' } : {}), ...(settings && localizedSiteValue(settings, route.locale, 'siteTitle') ? { siteTitle: localizedSiteValue(settings, route.locale, 'siteTitle') } : {}), ...(settings && localizedSiteValue(settings, route.locale, 'siteDescription') ? { description: localizedSiteValue(settings, route.locale, 'siteDescription') } : {}) };
      if (!base && settings && route.locale !== settings.sourceLocale) {
        rendered = rendered.replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi, '').replace(/<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/gi, '');
      }
      rendered = applySeoToHtml(rendered, route.outputPath, localizedSite, {
        ...page,
        ...(localizedTitle ? { title: localizedTitle, socialTitle: localizedTitle } : {}),
        ...(localizedDescription ? { description: localizedDescription, socialDescription: localizedDescription } : {}),
        // Every generated language route identifies itself, never the source page.
        ...(base ? { canonicalUrl: settings ? routeUrl(base, route.outputPath) : page.canonicalUrl || routeUrl(base, route.outputPath) } : settings && route.locale !== settings.sourceLocale ? { canonicalUrl: '' } : {}),
      });
    }
    // Preserve imported browser-ready HTML when no routing or settings need a pass.
    if (settings || route.outputPath !== route.sourcePath) rendered = routeHtml(rendered, route, routes, settings, prepared);
    files[route.outputPath] = { ...file, path: route.outputPath, text: rendered };
  }
  if (site && base && site.sitemapEnabled !== false) {
    const urls = routes.filter(route => {
      const page = { ...readPageSeoFromHtml(prepared.files[route.sourcePath].text!), ...metadata.pageSettings?.[route.sourcePath] };
      return page.includeInSitemap !== false && (page.index ?? site.defaultIndex ?? true);
    }).map(route => `<url><loc>${escape(routeUrl(base, route.outputPath))}</loc></url>`);
    files['sitemap.xml'] = { path: 'sitemap.xml', mimeType: 'application/xml', text: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n` };
  }
  if (site && (base || site.robotsTxtRules !== undefined || site.blockAiTrainingBots)) {
    const rules = site.robotsTxtRules?.trim() || `User-agent: *\n${site.defaultIndex === false ? 'Disallow: /' : 'Allow: /'}`;
    const bots = site.blockAiTrainingBots ? '\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: Google-Extended\nDisallow: /' : '';
    files['robots.txt'] = { path: 'robots.txt', mimeType: 'text/plain', text: `${rules}${bots}${base && site.sitemapEnabled !== false ? `\n\nSitemap: ${base}/sitemap.xml` : ''}\n` };
  }
  const homePath = getProjectHomePath(prepared);
  const home = routes.find(route => route.sourcePath === homePath && (!settings || route.locale === settings.defaultLocale));
  return prepareStaticRedirects(prepareCookieConsentProjectForTransport({ ...prepared, files, mainHtmlPath: home?.outputPath || prepared.mainHtmlPath }, metadata.cookieConsent), metadata.redirects, site?.baseUrl);
}
