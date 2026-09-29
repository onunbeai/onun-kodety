import { parse, type DefaultTreeAdapterMap } from 'parse5';
import {
  normalizeSocialImageTemplateId,
  normalizeSocialImageTemplateLibrary,
  persistableMediaUrl,
  sanitizeSocialImageTemplateMediaUrls,
  type SocialImageTemplate,
} from './social-image';

export interface SiteSeoSettings {
  siteTitle?: string;
  description?: string;
  language?: string;
  baseUrl?: string;
  titleTemplate?: string;
  socialImage?: string;
  /** Versioned visual source used to generate per-content Open Graph images.
   * `socialImage` remains the manual/runtime fallback for older projects. */
  socialImageTemplate?: SocialImageTemplate;
  /** Shared reusable Social Image catalog. Legacy embedded templates above
   * remain readable and are migrated only when explicitly edited/selected. */
  socialImageTemplates?: SocialImageTemplate[];
  /** Site-wide assignment into `socialImageTemplates`. */
  socialImageTemplateId?: string;
  faviconLight?: string;
  faviconDark?: string;
  googleAnalyticsId?: string;
  googleTagManagerId?: string;
  microsoftClarityId?: string;
  metaPixelId?: string;
  plausibleDomain?: string;
  analyticsConsentMode?: 'immediate' | 'consent';
  analyticsRespectDnt?: boolean;
  organizationName?: string;
  organizationType?: 'Organization' | 'Corporation' | 'LocalBusiness' | 'ProfessionalService' | 'NGO' | 'EducationalOrganization';
  organizationUrl?: string;
  organizationLogo?: string;
  organizationSameAs?: string[];
  websiteSchema?: boolean;
  websiteSearchUrlTemplate?: string;
  globalSchemaJsonLd?: string;
  googleSiteVerification?: string;
  bingSiteVerification?: string;
  pinterestSiteVerification?: string;
  defaultRobots?: SeoRobotsDirectives;
  robotsTxtRules?: string;
  blockAiTrainingBots?: boolean;
  sitemapEnabled?: boolean;
  reducedMotion?: boolean;
  preserveQueryParameters?: boolean;
  rightToLeft?: boolean;
  defaultIndex?: boolean;
  defaultFollow?: boolean;
  betaFeatures?: {
    /** Alpha: reusable HTML components/variants studio. Hidden by default. */
    /** Experimental: allow mutations of a locally hydrated Framer runtime. */
    framerSiteEditing?: boolean;
    /** Unstable Beta: opt-in access to the multi-breakpoint Infinite Canvas. */
    infiniteCanvas?: boolean;
  };
}

const JSON_LD_MEDIA_PROPERTIES = new Set([
  'associatedmedia',
  'audio',
  'contenturl',
  'embedurl',
  'encoding',
  'image',
  'logo',
  'photo',
  'primaryimageofpage',
  'screenshot',
  'thumbnail',
  'thumbnailurl',
  'video',
]);

const JSON_LD_MEDIA_TYPES = new Set([
  '3dmodel',
  'audioobject',
  'imagegallery',
  'imageobject',
  'mediaobject',
  'photograph',
  'videoobject',
]);

function jsonLdTypeIsMedia(value: unknown) {
  const types = Array.isArray(value) ? value : [value];
  return types.some(type => {
    if (typeof type !== 'string') return false;
    const normalized = type.trim().replace(/[\/#]+$/, '').split(/[\/#]/).at(-1)?.toLowerCase() || '';
    return JSON_LD_MEDIA_TYPES.has(normalized);
  });
}

function sanitizeJsonLdMediaValue(
  value: unknown,
  valueIsMediaUrl = false,
  objectRoleIsMedia = false,
): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    return valueIsMediaUrl && /^blob:/i.test(value.trim())
      ? { value: '', changed: true }
      : { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const entries = value.map(entry => {
      const sanitized = sanitizeJsonLdMediaValue(entry, valueIsMediaUrl, objectRoleIsMedia);
      changed ||= sanitized.changed;
      return sanitized.value;
    });
    return changed ? { value: entries, changed } : { value, changed };
  }
  if (!value || typeof value !== 'object') return { value, changed: false };

  const source = value as Record<string, unknown>;
  const currentObjectIsMedia = objectRoleIsMedia || jsonLdTypeIsMedia(source['@type']);
  let changed = false;
  const entries = Object.entries(source).map(([key, entry]) => {
    const normalizedKey = key.toLowerCase();
    const propertyIsMedia = JSON_LD_MEDIA_PROPERTIES.has(normalizedKey);
    const sanitized = sanitizeJsonLdMediaValue(
      entry,
      propertyIsMedia || (normalizedKey === 'url' && currentObjectIsMedia),
      propertyIsMedia,
    );
    changed ||= sanitized.changed;
    return [key, sanitized.value] as const;
  });
  return changed
    ? { value: Object.fromEntries(entries), changed }
    : { value, changed };
}

/** Strip document-scoped object URLs only from JSON-LD media properties.
 * Invalid JSON and valid documents without transient media stay byte-identical. */
export function sanitizeJsonLdMediaForPersistence(value: string | undefined) {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    const sanitized = sanitizeJsonLdMediaValue(parsed);
    return sanitized.changed ? JSON.stringify(sanitized.value) : value;
  } catch {
    return value;
  }
}

export function sanitizeSiteSeoMediaForPersistence(
  site: SiteSeoSettings,
): SiteSeoSettings {
  if (!site || typeof site !== 'object') return site;
  const socialImageTemplates = Array.isArray(site.socialImageTemplates)
    ? site.socialImageTemplates.map(sanitizeSocialImageTemplateMediaUrls)
    : site.socialImageTemplates;
  return {
    ...site,
    socialImage: persistableMediaUrl(site.socialImage) || undefined,
    faviconLight: persistableMediaUrl(site.faviconLight) || undefined,
    faviconDark: persistableMediaUrl(site.faviconDark) || undefined,
    organizationLogo: persistableMediaUrl(site.organizationLogo) || undefined,
    globalSchemaJsonLd: sanitizeJsonLdMediaForPersistence(site.globalSchemaJsonLd),
    socialImageTemplate: site.socialImageTemplate
      ? sanitizeSocialImageTemplateMediaUrls(site.socialImageTemplate)
      : undefined,
    socialImageTemplates,
  };
}

export type SeoSchemaType =
  | 'WebPage'
  | 'AboutPage'
  | 'ContactPage'
  | 'Article'
  | 'BlogPosting'
  | 'NewsArticle'
  | 'Product'
  | 'FAQPage'
  | 'Event'
  | 'Service'
  | 'LocalBusiness'
  | 'SoftwareApplication'
  | 'Course'
  | 'Recipe'
  | 'JobPosting'
  | 'Person'
  | 'Organization'
  | 'none';

export interface SeoRobotsDirectives {
  noArchive?: boolean;
  noImageIndex?: boolean;
  noSnippet?: boolean;
  noTranslate?: boolean;
  maxSnippet?: number;
  maxImagePreview?: 'none' | 'standard' | 'large';
  maxVideoPreview?: number;
}

export interface PageSeoSettings {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  socialTitle?: string;
  socialDescription?: string;
  socialImage?: string;
  /** Page/CMS override for the site's Social Image Builder template. */
  socialImageTemplate?: SocialImageTemplate;
  /** Reusable catalog assignment. Missing means inherit the site assignment. */
  socialImageTemplateId?: string;
  index?: boolean;
  follow?: boolean;
  includeInSitemap?: boolean;
  robots?: SeoRobotsDirectives;
  schemaType?: SeoSchemaType;
  /** Custom JSON-LD. CMS templates may use {{field}} expressions at any
   * depth; the WordPress singular runtime resolves them before output. */
  schemaJsonLd?: string;
}

export function sanitizePageSeoMediaForPersistence(
  page: PageSeoSettings,
): PageSeoSettings {
  if (!page || typeof page !== 'object') return page;
  return {
    ...page,
    socialImage: persistableMediaUrl(page.socialImage) || undefined,
    schemaJsonLd: sanitizeJsonLdMediaForPersistence(page.schemaJsonLd),
    socialImageTemplate: page.socialImageTemplate
      ? sanitizeSocialImageTemplateMediaUrls(page.socialImageTemplate)
      : undefined,
  };
}

/** CMS template pages may use {{binding}} expressions in any textual SEO
 * value. The WordPress runtime resolves them against the singular item before
 * returning the final HTML to visitors and crawlers. */
export function cmsSeoToken(binding: string) {
  return `{{${binding}}}`;
}

export function resolveCmsSeoTemplate(
  template: string,
  values: Record<string, unknown> = {},
) {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_match, binding: string) => {
    const value = values[binding.trim()];
    if (Array.isArray(value)) return value.map(String).join(', ');
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return String(object.url ?? object.value ?? object.label ?? '');
    }
    return value === undefined || value === null ? '' : String(value);
  });
}

function escapeText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string) {
  return escapeText(value).replaceAll('"', '&quot;');
}

function decodeEntities(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function ensureHead(html: string) {
  if (/<head\b[^>]*>/i.test(html)) return html;
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, '$&\n<head></head>');
  return `<!doctype html>\n<html>\n<head></head>\n<body>\n${html}\n</body>\n</html>`;
}

const MANAGED_FAVICON_ROLES = ['light', 'dark', 'fallback'] as const;
type ManagedFaviconRole = typeof MANAGED_FAVICON_ROLES[number];
type SeoHtmlElement = DefaultTreeAdapterMap['element'];

function siteFaviconTags(site: SiteSeoSettings): Partial<Record<ManagedFaviconRole, string>> {
  const light = persistableMediaUrl(site.faviconLight)
    || persistableMediaUrl(site.faviconDark);
  if (!light) return {};
  const dark = persistableMediaUrl(site.faviconDark) || light;
  return {
    light: `<link rel="icon" href="${escapeAttribute(light)}" media="(prefers-color-scheme: light)" data-kodety-favicon="light">`,
    dark: `<link rel="icon" href="${escapeAttribute(dark)}" media="(prefers-color-scheme: dark)" data-kodety-favicon="dark">`,
    fallback: `<link rel="shortcut icon" href="${escapeAttribute(light)}" data-kodety-favicon="fallback">`,
  };
}

function managedVariantFaviconTags(site: SiteSeoSettings) {
  const tags = siteFaviconTags(site);
  const hrefs = [
    persistableMediaUrl(site.faviconLight) || persistableMediaUrl(site.faviconDark),
    persistableMediaUrl(site.faviconDark) || persistableMediaUrl(site.faviconLight),
  ].filter((href): href is string => Boolean(href));
  if (hrefs.some(href => !/^(?:https?:\/\/|data:image\/)/i.test(href))) return null;
  return tags;
}

/**
 * Apply the current global favicon only to A/B snapshots that still carry
 * Kodety's explicit provenance marker. Manual/imported icons and snapshots
 * that intentionally removed the marker remain byte-identical.
 */
export function synchronizeManagedVariantFaviconHtml(
  source: string,
  site: SiteSeoSettings,
): string {
  if (!/data-kodety-favicon/i.test(source)) return source;
  const expected = managedVariantFaviconTags(site);
  if (expected === null) return source;
  const document = parse(source, { sourceCodeLocationInfo: true });
  const root = document.childNodes.find(node => node.nodeName === 'html') as SeoHtmlElement | undefined;
  const head = root?.childNodes.find(node => node.nodeName === 'head') as SeoHtmlElement | undefined;
  if (!head) return source;
  const managed = head.childNodes.flatMap(node => {
    if (!('tagName' in node) || node.tagName.toLowerCase() !== 'link') return [];
    const role = node.attrs.find(attribute => attribute.name.toLowerCase() === 'data-kodety-favicon')
      ?.value.trim().toLowerCase() as ManagedFaviconRole | undefined;
    if (!role || !MANAGED_FAVICON_ROLES.includes(role) || !node.sourceCodeLocation) return [];
    return [{ element: node, role, location: node.sourceCodeLocation }];
  });
  if (!managed.length) return source;

  const retainedRoles = new Set<ManagedFaviconRole>();
  const missingRoles = MANAGED_FAVICON_ROLES.filter(role => expected[role] && !managed.some(item => item.role === role));
  const lastManaged = managed.at(-1)?.element;
  const edits = managed.map(item => {
    const duplicate = retainedRoles.has(item.role);
    retainedRoles.add(item.role);
    let text = duplicate ? '' : (expected[item.role] || '');
    if (item.element === lastManaged && missingRoles.length) {
      const additions = missingRoles.map(role => expected[role]).filter(Boolean).join('\n  ');
      text += `${text ? '\n  ' : ''}${additions}`;
    }
    return {
      start: item.location.startOffset,
      end: item.location.endOffset,
      text,
    };
  });
  let result = source;
  edits.sort((left, right) => right.start - left.start || right.end - left.end).forEach(edit => {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  });
  return result;
}

function safeScriptValue(value: string) {
  return JSON.stringify(value).replaceAll('</script', '<\\/script');
}

function parseJsonLd(value: string | undefined): Record<string, unknown> | unknown[] | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown> | unknown[]
      : undefined;
  } catch {
    return undefined;
  }
}

export function jsonLdError(value: string | undefined) {
  if (!value?.trim()) return '';
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? ''
      : 'O Schema precisa ser um objeto ou uma lista JSON.';
  } catch {
    return 'O Schema contém JSON inválido.';
  }
}

export function schemaStarter(
  type: Exclude<SeoSchemaType, 'none'>,
  dynamic = false,
) {
  const title = dynamic ? '{{title}}' : 'Título da página';
  const description = dynamic ? '{{excerpt}}' : 'Descrição da página';
  const url = dynamic ? '{{permalink}}' : 'https://example.com/pagina';
  const image = dynamic ? '{{featured_image}}' : 'https://example.com/imagem.jpg';
  const common = {
    '@context': 'https://schema.org',
    '@type': type,
    name: title,
    description,
    url,
  } as Record<string, unknown>;
  if (['Article', 'BlogPosting', 'NewsArticle'].includes(type)) {
    return { ...common, headline: title, image, datePublished: dynamic ? '{{date}}' : '', author: { '@type': 'Person', name: dynamic ? '{{author}}' : '' } };
  }
  if (type === 'Product') return { ...common, image, sku: dynamic ? '{{field:sku}}' : '', offers: { '@type': 'Offer', url, priceCurrency: dynamic ? '{{field:currency}}' : 'BRL', price: dynamic ? '{{field:price}}' : '', availability: 'https://schema.org/InStock' } };
  if (type === 'Event') return { ...common, image, startDate: dynamic ? '{{field:start_date}}' : '', endDate: dynamic ? '{{field:end_date}}' : '', location: { '@type': 'Place', name: dynamic ? '{{field:location}}' : '' } };
  if (type === 'JobPosting') return { ...common, title, datePosted: dynamic ? '{{date}}' : '', hiringOrganization: { '@type': 'Organization', name: dynamic ? '{{field:company}}' : '' } };
  if (type === 'Recipe') return { ...common, image, author: { '@type': 'Person', name: dynamic ? '{{author}}' : '' } };
  return common;
}

export function robotsContent(
  site: SiteSeoSettings,
  page: PageSeoSettings,
) {
  const advanced = { ...(site.defaultRobots || {}), ...(page.robots || {}) };
  const values = [
    (page.index ?? site.defaultIndex ?? true) ? 'index' : 'noindex',
    (page.follow ?? site.defaultFollow ?? true) ? 'follow' : 'nofollow',
    advanced.noArchive ? 'noarchive' : '',
    advanced.noImageIndex ? 'noimageindex' : '',
    advanced.noSnippet ? 'nosnippet' : '',
    advanced.noTranslate ? 'notranslate' : '',
    !advanced.noSnippet && Number.isFinite(advanced.maxSnippet) ? `max-snippet:${Math.max(-1, Math.round(advanced.maxSnippet!))}` : '',
    advanced.maxImagePreview ? `max-image-preview:${advanced.maxImagePreview}` : '',
    Number.isFinite(advanced.maxVideoPreview) ? `max-video-preview:${Math.max(-1, Math.round(advanced.maxVideoPreview!))}` : '',
  ];
  return values.filter(Boolean).join(',');
}

function integrationScript(code: string, name: string, deferred: boolean, src?: string) {
  const attributes = [
    `data-kodety-integration="${name}"`,
    deferred ? 'type="text/plain" data-kodety-consent="analytics"' : '',
    src ? `${deferred ? 'data-src' : 'src'}="${escapeAttribute(src)}"` : '',
    src ? 'async' : '',
  ].filter(Boolean).join(' ');
  return `<script ${attributes}>${code}</script>`;
}

function analyticsMarkup(site: SiteSeoSettings) {
  const ga = /^G-[A-Z0-9]+$/i.test(site.googleAnalyticsId?.trim() || '') ? site.googleAnalyticsId!.trim().toUpperCase() : '';
  const gtm = /^GTM-[A-Z0-9]+$/i.test(site.googleTagManagerId?.trim() || '') ? site.googleTagManagerId!.trim().toUpperCase() : '';
  const clarity = /^[a-z0-9]+$/i.test(site.microsoftClarityId?.trim() || '') ? site.microsoftClarityId!.trim() : '';
  const pixel = /^\d+$/.test(site.metaPixelId?.trim() || '') ? site.metaPixelId!.trim() : '';
  const plausible = /^[a-z0-9.-]+$/i.test(site.plausibleDomain?.trim() || '') ? site.plausibleDomain!.trim().toLowerCase() : '';
  const needsGate = site.analyticsConsentMode === 'consent' || Boolean(site.analyticsRespectDnt);
  const scripts: string[] = [];
  if (ga) {
    scripts.push(integrationScript('', 'google-analytics-library', needsGate, `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga)}`));
    scripts.push(integrationScript(`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${safeScriptValue(ga)},{anonymize_ip:true});`, 'google-analytics', needsGate));
  }
  if (gtm) scripts.push(integrationScript(`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer',${safeScriptValue(gtm)});`, 'google-tag-manager', needsGate));
  if (clarity) scripts.push(integrationScript(`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,'clarity','script',${safeScriptValue(clarity)});`, 'microsoft-clarity', needsGate));
  if (pixel) scripts.push(integrationScript(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=true;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=true;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');var kodetyMetaEventId=window.__kodetyMetaPageViewEventId||(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));window.__kodetyMetaPageViewEventId=kodetyMetaEventId;if(window.__kodetyAnalyticsConsentGranted===true)fbq('consent','grant');fbq('init',${safeScriptValue(pixel)});fbq('track','PageView',{}, {eventID:kodetyMetaEventId});window.__kodetyMetaPixelPageViewSent=true;window.dispatchEvent(new CustomEvent('kodety:meta-pixel-ready',{detail:{pixelId:${safeScriptValue(pixel)},eventId:kodetyMetaEventId}}));`, 'meta-pixel', needsGate));
  if (plausible) scripts.push(integrationScript('', 'plausible', needsGate, `https://plausible.io/js/script.js` ).replace('<script ', `<script defer data-domain="${escapeAttribute(plausible)}" `));
  if (needsGate && scripts.length) {
    const consentRequired = site.analyticsConsentMode === 'consent';
    const respectDnt = Boolean(site.analyticsRespectDnt);
    scripts.push(`<script data-kodety-integration="consent-loader">(function(){var activated=false;function deniedByDnt(){return ${respectDnt ? "navigator.doNotTrack==='1'||window.doNotTrack==='1'" : 'false'}}function activate(){if(activated||deniedByDnt())return;activated=true;document.querySelectorAll('script[data-kodety-consent="analytics"]').forEach(function(old){var next=document.createElement('script');Array.from(old.attributes).forEach(function(attribute){if(!['type','data-kodety-consent','data-src'].includes(attribute.name))next.setAttribute(attribute.name,attribute.value)});if(old.dataset.src)next.src=old.dataset.src;next.text=old.text;old.replaceWith(next)})}function applyConsent(granted){var allowed=granted===true&&!deniedByDnt();window.__kodetyAnalyticsConsentGranted=allowed;try{localStorage.setItem('kodety-analytics-consent',allowed?'granted':'denied')}catch(e){}if(allowed){activate();if(typeof window.fbq==='function')window.fbq('consent','grant')}else if(typeof window.fbq==='function')window.fbq('consent','revoke')}window.kodetyAnalyticsConsent=applyConsent;window.addEventListener('kodety:analytics-consent',function(event){applyConsent(event.detail===true||event.detail==='granted')});var remembered='';try{remembered=localStorage.getItem('kodety-analytics-consent')||''}catch(e){}var initiallyGranted=${consentRequired ? "remembered==='granted'" : '!deniedByDnt()'};window.__kodetyAnalyticsConsentGranted=initiallyGranted;if(initiallyGranted){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){if(window.__kodetyAnalyticsConsentGranted===true)applyConsent(true)},{once:true});else applyConsent(true)}})();</script>`);
  }
  const body = gtm && !needsGate ? `<noscript data-kodety-integration="google-tag-manager"><iframe src="https://www.googletagmanager.com/ns.html?id=${escapeAttribute(gtm)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : '';
  return { head: scripts.join('\n  '), body };
}

function upsertHeadTag(html: string, pattern: RegExp, tag: string) {
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace(/<\/head\s*>/i, `  ${tag}\n</head>`);
}

function metaPattern(attribute: 'name' | 'property', value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["']${escaped}["'])[^>]*>`, 'i');
}

function readTagAttribute(tag: string, attribute: string) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return decodeEntities(tag.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, 'i'))?.[1] || '');
}

function readMetaValue(html: string, attribute: 'name' | 'property', value: string) {
  return readTagAttribute(html.match(metaPattern(attribute, value))?.[0] || '', 'content');
}

/** Read site-wide settings already authored by Webflow, Framer, hand-written
 * HTML or a previous Kodety publish. Stored editor metadata is merged over this
 * result by the caller, so an explicit user edit always wins. */
export function readSiteSeoFromHtml(html: string): SiteSeoSettings {
  const title = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '');
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || '';
  const canonicalTag = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i)?.[0] || '';
  const canonical = readTagAttribute(canonicalTag, 'href');
  const iconTags = Array.from(html.matchAll(/<link\b[^>]*>/gi), match => match[0]).filter(tag => {
    const rel = readTagAttribute(tag, 'rel').toLowerCase().split(/\s+/);
    return rel.includes('icon') || (rel.includes('shortcut') && rel.includes('icon'));
  });
  const iconByKodetyRole = (role: string) => iconTags.find(tag => readTagAttribute(tag, 'data-kodety-favicon') === role);
  const iconByScheme = (scheme: string) => iconTags.find(tag => readTagAttribute(tag, 'media').toLowerCase().includes(`prefers-color-scheme: ${scheme}`));
  const generalIcon = iconTags.find(tag => !readTagAttribute(tag, 'media')) || iconTags[0];
  const faviconLight = readTagAttribute(iconByKodetyRole('light') || iconByScheme('light') || generalIcon || '', 'href');
  const faviconDark = readTagAttribute(iconByKodetyRole('dark') || iconByScheme('dark') || '', 'href');
  const robots = readMetaValue(html, 'name', 'robots').toLowerCase().split(',').map(value => value.trim());
  let baseUrl = '';
  try { if (/^https?:\/\//i.test(canonical)) baseUrl = new URL(canonical).origin; } catch { /* Keep an invalid imported canonical page-local only. */ }

  return {
    siteTitle: readMetaValue(html, 'property', 'og:site_name') || readMetaValue(html, 'name', 'application-name') || readMetaValue(html, 'property', 'og:title') || title,
    description: readMetaValue(html, 'name', 'description') || readMetaValue(html, 'property', 'og:description') || readMetaValue(html, 'name', 'twitter:description'),
    language: readTagAttribute(htmlTag, 'lang') || undefined,
    baseUrl: baseUrl || undefined,
    socialImage: persistableMediaUrl(readMetaValue(html, 'property', 'og:image') || readMetaValue(html, 'name', 'twitter:image')) || undefined,
    faviconLight: persistableMediaUrl(faviconLight) || undefined,
    faviconDark: persistableMediaUrl(faviconDark) || undefined,
    defaultIndex: robots.length === 1 && robots[0] === '' ? undefined : !robots.includes('noindex'),
    defaultFollow: robots.length === 1 && robots[0] === '' ? undefined : !robots.includes('nofollow'),
  };
}

function absolutePageUrl(baseUrl: string, pagePath: string) {
  if (!baseUrl.trim()) return '';
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const cleanPath = pagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const route = /(^|\/)index\.html?$/i.test(cleanPath)
    ? cleanPath.replace(/index\.html?$/i, '')
    : cleanPath.replace(/\.html?$/i, '');
  return `${normalizedBase}/${route}`.replace(/\/+$/, '/')
}

export function readPageSeoFromHtml(html: string): PageSeoSettings {
  const readMeta = (attribute: 'name' | 'property', value: string) => {
    const tag = html.match(metaPattern(attribute, value))?.[0] || '';
    return decodeEntities(tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] || '');
  };
  const robots = readMeta('name', 'robots').toLowerCase().split(',').map((item) => item.trim());
  const directiveValue = (name: string) => robots.find(item => item.startsWith(`${name}:`))?.split(':').slice(1).join(':');
  const canonicalTag = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i)?.[0] || '';
  return {
    title: decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ''),
    description: readMeta('name', 'description'),
    canonicalUrl: decodeEntities(canonicalTag.match(/\bhref=["']([^"']*)["']/i)?.[1] || ''),
    socialTitle: readMeta('property', 'og:title') || readMeta('name', 'twitter:title'),
    socialDescription: readMeta('property', 'og:description') || readMeta('name', 'twitter:description'),
    socialImage: persistableMediaUrl(readMeta('property', 'og:image') || readMeta('name', 'twitter:image')) || undefined,
    index: !robots.includes('noindex'),
    follow: !robots.includes('nofollow'),
    robots: {
      noArchive: robots.includes('noarchive'),
      noImageIndex: robots.includes('noimageindex'),
      noSnippet: robots.includes('nosnippet'),
      noTranslate: robots.includes('notranslate'),
      ...(directiveValue('max-snippet') !== undefined ? { maxSnippet: Number(directiveValue('max-snippet')) } : {}),
      ...(directiveValue('max-image-preview') ? { maxImagePreview: directiveValue('max-image-preview') as SeoRobotsDirectives['maxImagePreview'] } : {}),
      ...(directiveValue('max-video-preview') !== undefined ? { maxVideoPreview: Number(directiveValue('max-video-preview')) } : {}),
    },
    includeInSitemap: true,
    schemaType: 'WebPage',
  };
}

export function applySeoToHtml(
  source: string,
  pagePath: string,
  site: SiteSeoSettings,
  page: PageSeoSettings,
) {
  let html = ensureHead(source);
  const pageTitle = page.title?.trim() || readPageSeoFromHtml(source).title || 'Página';
  const titleTemplate = site.titleTemplate?.trim() || '%page% · %site%';
  const resolvedTitle = site.siteTitle?.trim()
    ? titleTemplate.replaceAll('%page%', pageTitle).replaceAll('%site%', site.siteTitle.trim())
    : pageTitle;
  const description = page.description?.trim() || site.description?.trim() || '';
  const canonical = page.canonicalUrl?.trim() || absolutePageUrl(site.baseUrl || '', pagePath);
  const index = page.index ?? site.defaultIndex ?? true;
  const follow = page.follow ?? site.defaultFollow ?? true;
  const socialTitle = page.socialTitle?.trim() || resolvedTitle;
  const socialDescription = page.socialDescription?.trim() || description;
  const socialImage = persistableMediaUrl(page.socialImage)
    || persistableMediaUrl(site.socialImage);
  const socialImageTemplateIds = new Set(
    normalizeSocialImageTemplateLibrary(site.socialImageTemplates)
      .map(template => template.id),
  );
  const hasGeneratedSocialImage = Boolean(
    socialImageTemplateIds.has(
      normalizeSocialImageTemplateId(page.socialImageTemplateId),
    )
    || page.socialImageTemplate
    || socialImageTemplateIds.has(
      normalizeSocialImageTemplateId(site.socialImageTemplateId),
    )
    || site.socialImageTemplate,
  );
  const faviconTags = siteFaviconTags(site);
  const organizationLogo = persistableMediaUrl(site.organizationLogo);

  html = html.replace(/<html\b([^>]*)>/i, (_match, attributes: string) => {
    const withoutLang = attributes.replace(/\s+lang=["'][^"']*["']/i, '').replace(/\s+dir=["'][^"']*["']/i, '');
    const language = escapeAttribute(site.language?.trim() || 'pt-BR');
    return `<html${withoutLang} lang="${language}"${site.rightToLeft ? ' dir="rtl"' : ''}>`;
  });
  html = upsertHeadTag(html, /<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeText(resolvedTitle)}</title>`);
  html = upsertHeadTag(html, metaPattern('name', 'description'), `<meta name="description" content="${escapeAttribute(description)}">`);
  html = upsertHeadTag(html, metaPattern('name', 'robots'), `<meta name="robots" content="${escapeAttribute(robotsContent(site, { ...page, index, follow }))}">`);
  const verificationTags = [
    site.googleSiteVerification?.trim() ? `<meta name="google-site-verification" content="${escapeAttribute(site.googleSiteVerification.trim())}">` : '',
    site.bingSiteVerification?.trim() ? `<meta name="msvalidate.01" content="${escapeAttribute(site.bingSiteVerification.trim())}">` : '',
    site.pinterestSiteVerification?.trim() ? `<meta name="p:domain_verify" content="${escapeAttribute(site.pinterestSiteVerification.trim())}">` : '',
  ];
  html = html.replace(/\s*<meta\b(?=[^>]*\bdata-kodety-verification)[^>]*>/gi, '');
  verificationTags.filter(Boolean).forEach(tag => {
    html = html.replace(/<\/head\s*>/i, `  ${tag.replace('>', ' data-kodety-verification>')}\n</head>`);
  });
  if (canonical) html = upsertHeadTag(html, /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i, `<link rel="canonical" href="${escapeAttribute(canonical)}">`);
  html = upsertHeadTag(html, metaPattern('property', 'og:type'), `<meta property="og:type" content="${page.schemaType === 'Article' ? 'article' : 'website'}">`);
  html = upsertHeadTag(html, metaPattern('property', 'og:title'), `<meta property="og:title" content="${escapeAttribute(socialTitle)}">`);
  html = upsertHeadTag(html, metaPattern('property', 'og:description'), `<meta property="og:description" content="${escapeAttribute(socialDescription)}">`);
  if (canonical) html = upsertHeadTag(html, metaPattern('property', 'og:url'), `<meta property="og:url" content="${escapeAttribute(canonical)}">`);
  if (socialImage) html = upsertHeadTag(html, metaPattern('property', 'og:image'), `<meta property="og:image" content="${escapeAttribute(socialImage)}">`);
  else html = html.replace(new RegExp(`\\s*${metaPattern('property', 'og:image').source}`, 'i'), '');
  html = upsertHeadTag(html, metaPattern('name', 'twitter:card'), `<meta name="twitter:card" content="${socialImage || hasGeneratedSocialImage ? 'summary_large_image' : 'summary'}">`);
  html = upsertHeadTag(html, metaPattern('name', 'twitter:title'), `<meta name="twitter:title" content="${escapeAttribute(socialTitle)}">`);
  html = upsertHeadTag(html, metaPattern('name', 'twitter:description'), `<meta name="twitter:description" content="${escapeAttribute(socialDescription)}">`);
  if (socialImage) html = upsertHeadTag(html, metaPattern('name', 'twitter:image'), `<meta name="twitter:image" content="${escapeAttribute(socialImage)}">`);
  else html = html.replace(new RegExp(`\\s*${metaPattern('name', 'twitter:image').source}`, 'i'), '');
  // Normalize imported and Kodety-authored favicons alike. Otherwise editing a
  // Webflow/hand-written favicon would append a second active icon declaration.
  // apple-touch-icon remains untouched because it has no dedicated field yet.
  html = html.replace(/\s*<link\b(?=[^>]*\brel=["'](?:icon|shortcut\s+icon)["'])[^>]*>/gi, '');
  if (faviconTags.light) {
    const links = MANAGED_FAVICON_ROLES.map(role => faviconTags[role]).filter(Boolean).join('\n  ');
    html = html.replace(/<\/head\s*>/i, `  ${links}\n</head>`);
  }
  html = html.replace(/\s*<(?:script|noscript)\b(?=[^>]*\bdata-kodety-integration(?:=(?:["'][^"']*["']|[^\s>]+))?)[\s\S]*?<\/(?:script|noscript)>/gi, '');
  const integrations = analyticsMarkup(site);
  if (integrations.head) html = html.replace(/<\/head\s*>/i, `  ${integrations.head}\n</head>`);
  if (integrations.body) html = html.replace(/<body\b[^>]*>/i, `$&\n  ${integrations.body}`);

  const schemaType = page.schemaType || 'WebPage';
  if (schemaType !== 'none') {
    let schemaOrigin = '';
    try {
      const originSource = /^https?:\/\//i.test(site.baseUrl?.trim() || '')
        ? site.baseUrl!.trim()
        : /^https?:\/\//i.test(canonical)
          ? canonical
          : '';
      if (originSource) schemaOrigin = new URL(originSource).origin;
    } catch { /* Keep fragment-only IDs when a CMS expression is unresolved. */ }
    const organizationId = schemaOrigin ? `${schemaOrigin}/#organization` : '#organization';
    const websiteId = schemaOrigin ? `${schemaOrigin}/#website` : '#website';
    const organization = site.organizationName ? {
      '@type': site.organizationType || 'Organization',
      '@id': organizationId,
      name: site.organizationName,
      ...(site.organizationUrl?.trim() || site.baseUrl?.trim() ? { url: site.organizationUrl?.trim() || site.baseUrl?.trim() } : {}),
      ...(organizationLogo ? { logo: { '@type': 'ImageObject', url: organizationLogo } } : {}),
      ...(site.organizationSameAs?.filter(Boolean).length ? { sameAs: site.organizationSameAs.filter(Boolean) } : {}),
    } : undefined;
    const website = (site.websiteSchema ?? true) ? {
      '@type': 'WebSite',
      '@id': websiteId,
      name: site.siteTitle || pageTitle,
      ...(site.baseUrl?.trim() ? { url: site.baseUrl.trim() } : {}),
      ...(organization ? { publisher: { '@id': organizationId } } : {}),
      ...(site.websiteSearchUrlTemplate?.trim() ? {
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: site.websiteSearchUrlTemplate.trim() },
          'query-input': 'required name=search_term_string',
        },
      } : {}),
    } : undefined;
    const customPageSchema = parseJsonLd(sanitizeJsonLdMediaForPersistence(page.schemaJsonLd));
    const automaticPageSchema = {
      '@type': schemaType,
      '@id': canonical ? `${canonical.replace(/#.*$/, '')}#webpage` : '#webpage',
      name: pageTitle,
      ...(description ? { description } : {}),
      ...(canonical ? { url: canonical } : {}),
      ...(website ? { isPartOf: { '@id': websiteId } } : {}),
      ...(organization && ['Article', 'BlogPosting', 'NewsArticle', 'Product', 'Service'].includes(schemaType) ? { publisher: { '@id': organizationId } } : {}),
    };
    const globalCustom = parseJsonLd(sanitizeJsonLdMediaForPersistence(site.globalSchemaJsonLd));
    const globalEntities = Array.isArray(globalCustom)
      ? globalCustom
      : globalCustom && Array.isArray((globalCustom as Record<string, unknown>)['@graph'])
        ? (globalCustom as Record<string, unknown>)['@graph'] as unknown[]
        : globalCustom
          ? [globalCustom]
          : [];
    const globalTypes = new Set(globalEntities.flatMap(entity => {
      if (!entity || typeof entity !== 'object') return [];
      const type = (entity as Record<string, unknown>)['@type'];
      return Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
    }));
    const organizationTypes = new Set(['Organization', 'Corporation', 'LocalBusiness', 'ProfessionalService', 'NGO', 'EducationalOrganization']);
    const graph = [
      organization && !Array.from(globalTypes).some(type => organizationTypes.has(type)) ? organization : undefined,
      website && !globalTypes.has('WebSite') ? website : undefined,
      ...globalEntities,
      ...(Array.isArray(customPageSchema) ? customPageSchema : customPageSchema ? [customPageSchema] : [automaticPageSchema]),
    ].filter(Boolean);
    const schema = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': graph,
    }).replaceAll('</', '<\\/');
    html = upsertHeadTag(
      html,
      /<script\b(?=[^>]*\bdata-kodety-seo(?:=["'][^"']*["'])?)[^>]*>[\s\S]*?<\/script>/i,
      `<script type="application/ld+json" data-kodety-seo>${schema}</script>`,
    );
  } else {
    html = html.replace(/\s*<script\b(?=[^>]*\bdata-kodety-seo(?:=["'][^"']*["'])?)[^>]*>[\s\S]*?<\/script>/i, '');
  }

  const reducedMotionPattern = /<style\b(?=[^>]*\bdata-kodety-reduced-motion)[^>]*>[\s\S]*?<\/style>/i;
  if (site.reducedMotion ?? true) {
    html = upsertHeadTag(html, reducedMotionPattern, '<style data-kodety-reduced-motion>@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto; animation-duration: 0.01ms; animation-iteration-count: 1; transition-duration: 0.01ms; } }</style>');
  } else html = html.replace(/\s*<style\b(?=[^>]*\bdata-kodety-reduced-motion)[^>]*>[\s\S]*?<\/style>/i, '');

  const preserveQueryPattern = /<script\b(?=[^>]*\bdata-kodety-preserve-query)[^>]*>[\s\S]*?<\/script>/i;
  if (site.preserveQueryParameters) {
    const script = `<script data-kodety-preserve-query>(function(){function sync(){var q=location.search;if(!q)return;document.querySelectorAll('a[href]').forEach(function(a){try{var u=new URL(a.href,location.href);if(u.origin===location.origin){new URLSearchParams(q).forEach(function(v,k){if(!u.searchParams.has(k))u.searchParams.set(k,v)});a.href=u.href}}catch(e){}})}document.readyState==='loading'?document.addEventListener('DOMContentLoaded',sync):sync()})()</script>`;
    html = upsertHeadTag(html, preserveQueryPattern, script);
  } else html = html.replace(/\s*<script\b(?=[^>]*\bdata-kodety-preserve-query)[^>]*>[\s\S]*?<\/script>/i, '');
  return html;
}
