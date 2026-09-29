import type { HtmlProject, HtmlProjectFile } from './types';

export type CustomCodeLanguage = 'html' | 'css' | 'javascript';
export type CustomCodePlacement = 'head-start' | 'head-end' | 'body-start' | 'body-end';
export type CustomCodeScope = 'all' | 'selected';
export type CustomCodeRun = 'once' | 'navigation';
export type CustomCodeConsent = 'always' | 'required';

export interface CustomCodeEntry {
  id: string;
  name: string;
  code: string;
  placement: CustomCodePlacement;
  scope: CustomCodeScope;
  pages: string[];
  run: CustomCodeRun;
  language: CustomCodeLanguage;
  enabled: boolean;
  /** Keep authored code inert until the visitor grants this category. */
  consent: CustomCodeConsent;
  consentCategory?: string;
}

export interface CustomCodeSettings {
  version: 1;
  entries: CustomCodeEntry[];
}

export const DEFAULT_CUSTOM_CODE_SETTINGS: CustomCodeSettings = {
  version: 1,
  entries: [],
};

const PLACEMENTS = new Set<CustomCodePlacement>([
  'head-start',
  'head-end',
  'body-start',
  'body-end',
]);
const LANGUAGES = new Set<CustomCodeLanguage>(['html', 'css', 'javascript']);
const RUN_MODES = new Set<CustomCodeRun>(['once', 'navigation']);
const SCOPES = new Set<CustomCodeScope>(['all', 'selected']);
const CONSENT_MODES = new Set<CustomCodeConsent>(['always', 'required']);
const CUSTOM_CODE_BLOCK_PATTERN =
  /(?:[ \t]*\r?\n)?[ \t]*<!--\s*kodety-custom-code:start\s+([A-Za-z0-9._:/-]+)\s*-->[\s\S]*?<!--\s*kodety-custom-code:end\s+\1\s*-->[ \t]*(?:\r?\n)?/gi;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizePagePath(value: unknown) {
  if (typeof value !== 'string') return '';
  const stack: string[] = [];
  value.trim().split(/[?#]/, 1)[0].replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  return stack.join('/');
}

/**
 * Experiment variants are stored below a private editor namespace, but page
 * scoped settings are intentionally authored against the public page path.
 * Preview/export must therefore compare `index.html` with `index.html`, not
 * with `.incode/experiments/<test>/<variant>/project/index.html`.
 */
function publicCustomCodePagePath(value: unknown) {
  const normalized = normalizePagePath(value);
  const privateVariant = normalized.match(
    /^\.incode\/experiments\/[^/]+\/[^/]+\/project\/(.+)$/i,
  );
  return privateVariant?.[1] || normalized;
}

function normalizeId(value: unknown, fallback: string) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return (candidate || fallback)
    .replace(/[^A-Za-z0-9._:/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || fallback;
}

function normalizeLegacyPlacement(value: unknown): CustomCodePlacement {
  if (PLACEMENTS.has(value as CustomCodePlacement)) return value as CustomCodePlacement;
  if (value === 'head') return 'head-end';
  if (value === 'body-start') return 'body-start';
  return 'body-end';
}

function normalizeRun(value: unknown): CustomCodeRun {
  if (RUN_MODES.has(value as CustomCodeRun)) return value as CustomCodeRun;
  return value === 'every-page-visit' || value === 'page-visit' ? 'navigation' : 'once';
}

function normalizeLanguage(value: unknown): CustomCodeLanguage {
  if (LANGUAGES.has(value as CustomCodeLanguage)) return value as CustomCodeLanguage;
  return value === 'js' ? 'javascript' : 'html';
}

export function normalizeCustomCodeSettings(value: unknown): CustomCodeSettings {
  const source = record(value);
  const rawEntries = Array.isArray(source.entries) ? source.entries : [];
  const usedIds = new Set<string>();
  const entries = rawEntries.map((rawEntry, index): CustomCodeEntry => {
    const entry = record(rawEntry);
    const fallbackId = `custom-code-${index + 1}`;
    const baseId = normalizeId(entry.id, fallbackId);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    const rawPages = Array.isArray(entry.pages)
      ? entry.pages
      : typeof entry.pagePath === 'string'
        ? [entry.pagePath]
        : [];
    const pages = Array.from(new Set(rawPages.map(normalizePagePath).filter(Boolean)));
    const legacyScope = entry.scope === 'site' ? 'all' : entry.scope === 'page' ? 'selected' : entry.scope;
    return {
      id,
      name: typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim().slice(0, 160)
        : `Código ${index + 1}`,
      code: typeof entry.code === 'string' ? entry.code : '',
      placement: normalizeLegacyPlacement(entry.placement ?? entry.position),
      scope: SCOPES.has(legacyScope as CustomCodeScope)
        ? legacyScope as CustomCodeScope
        : pages.length
          ? 'selected'
          : 'all',
      pages,
      run: normalizeRun(entry.run),
      language: normalizeLanguage(entry.language),
      enabled: !(
        entry.enabled === false
        || entry.enabled === 0
        || entry.enabled === 'false'
      ),
      consent: CONSENT_MODES.has(entry.consent as CustomCodeConsent)
        ? entry.consent as CustomCodeConsent
        : entry.requireConsent === true
          ? 'required'
          : 'always',
      consentCategory: normalizeId(entry.consentCategory ?? entry.category, ''),
    };
  });
  return { version: 1, entries };
}

export function customCodeSettingsError(settings: CustomCodeSettings): string {
  const missingName = settings.entries.find(entry => !entry.name.trim());
  if (missingName) return 'Dê um nome para todos os códigos.';
  const missingCode = settings.entries.find(entry => !entry.code.trim());
  if (missingCode) return `Adicione o conteúdo de “${missingCode.name}”.`;
  const missingPage = settings.entries.find(entry => entry.scope === 'selected' && entry.pages.length === 0);
  if (missingPage) return `Escolha ao menos uma página para “${missingPage.name}”.`;
  const missingConsentCategory = settings.entries.find(
    entry => entry.consent === 'required' && !entry.consentCategory,
  );
  if (missingConsentCategory)
    return `Escolha uma categoria de consentimento para “${missingConsentCategory.name}”.`;
  return '';
}

export function stripCustomCodeFromHtml(html: string) {
  return html.replace(CUSTOM_CODE_BLOCK_PATTERN, '');
}

export function resolveCustomCodeEntries(
  settings: unknown,
  pagePath: string,
): CustomCodeEntry[] {
  const normalizedPath = publicCustomCodePagePath(pagePath);
  return normalizeCustomCodeSettings(settings).entries.filter(entry =>
    entry.enabled
    && entry.code.trim().length > 0
    && (
      entry.scope === 'all'
      || entry.pages.some(path => publicCustomCodePagePath(path) === normalizedPath)
    ),
  );
}

function escapeAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function wrapEntryCode(entry: CustomCodeEntry) {
  if (entry.language === 'css' && !/^\s*<style\b/i.test(entry.code)) {
    const code = entry.code.replace(/<\/style/gi, '<\\/style');
    return `<style data-incode-custom-code="${escapeAttribute(entry.id)}">\n${code}\n</style>`;
  }
  if (entry.language === 'javascript' && !/^\s*<script\b/i.test(entry.code)) {
    const code = entry.code.replace(/<\/script/gi, '<\\/script');
    return `<script data-incode-custom-code="${escapeAttribute(entry.id)}">\n${code}\n</script>`;
  }
  return entry.code;
}

function jsonForInlineScript(value: string) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * Navigation snippets own a stable DOM range beside their authored placement.
 * Recreating script nodes is deliberate: scripts parsed through
 * `template.innerHTML` are inert until replaced by live nodes.
 */
function navigationRuntime(entry: CustomCodeEntry) {
  const id = jsonForInlineScript(entry.id);
  const markup = jsonForInlineScript(wrapEntryCode(entry));
  return `<script data-incode-custom-code-runtime="${escapeAttribute(entry.id)}">
(()=>{const id=${id},markup=${markup},script=document.currentScript;if(!script)return;
const root=window;const key="__incodeCustomCodeRuntimeV1";
const runtime=root[key]||(root[key]={entries:new Map(),bound:false,pending:false});
let start=document.createComment(" incode-custom-code-mounted:start "+id+" ");
let end=document.createComment(" incode-custom-code-mounted:end "+id+" ");
script.after(start,end);
const activateScripts=fragment=>{fragment.querySelectorAll("script").forEach(oldScript=>{const live=document.createElement("script");for(const attribute of oldScript.attributes)live.setAttribute(attribute.name,attribute.value);live.textContent=oldScript.textContent;oldScript.replaceWith(live);});};
const mount=()=>{let node=start.nextSibling;while(node&&node!==end){const next=node.nextSibling;node.remove();node=next;}const template=document.createElement("template");template.innerHTML=markup;const fragment=template.content.cloneNode(true);activateScripts(fragment);end.before(fragment);};
runtime.entries.set(id,mount);
const mountAll=()=>{runtime.pending=false;for(const apply of runtime.entries.values())apply();};
const schedule=()=>{if(runtime.pending)return;runtime.pending=true;queueMicrotask(mountAll);};
if(!runtime.bound){runtime.bound=true;addEventListener("kodety:navigation",schedule);addEventListener("popstate",schedule);addEventListener("hashchange",schedule);
for(const method of ["pushState","replaceState"]){const original=history[method];if(typeof original!=="function")continue;history[method]=function(...args){const result=original.apply(this,args);dispatchEvent(new Event("kodety:navigation"));return result;};}}
mount();
})();
</script>`;
}

/**
 * CookieConsent activates inert scripts carrying `data-category`. Wrapping the
 * complete authored payload (instead of only changing nested script tags)
 * keeps arbitrary HTML, CSS and navigation snippets from reaching the parser
 * before consent is granted.
 */
function consentRuntime(entry: CustomCodeEntry, payload: string) {
  const id = jsonForInlineScript(entry.id);
  const markup = jsonForInlineScript(payload);
  const category = escapeAttribute(entry.consentCategory || 'analytics');
  return `<script type="text/plain" data-category="${category}" data-service="kodety-custom-${escapeAttribute(entry.id)}" data-kodety-custom-code-consent="${escapeAttribute(entry.id)}">
(()=>{const id=${id},markup=${markup},script=document.currentScript;if(!script)return;
const template=document.createElement("template");template.innerHTML=markup;
const fragment=template.content.cloneNode(true);
fragment.querySelectorAll("script").forEach(oldScript=>{const live=document.createElement("script");for(const attribute of oldScript.attributes)live.setAttribute(attribute.name,attribute.value);live.textContent=oldScript.textContent;oldScript.replaceWith(live);});
script.before(fragment);window.dispatchEvent(new CustomEvent("kodety:custom-code-consent-loaded",{detail:{id,category:${jsonForInlineScript(category)}}}));})();
</script>`;
}

function materializeEntry(entry: CustomCodeEntry) {
  const authoredPayload = entry.run === 'navigation' ? navigationRuntime(entry) : wrapEntryCode(entry);
  const payload = entry.consent === 'required'
    ? consentRuntime(entry, authoredPayload)
    : authoredPayload;
  return `\n<!-- kodety-custom-code:start ${entry.id} -->${payload}<!-- kodety-custom-code:end ${entry.id} -->\n`;
}

function insertAfterOpeningTag(html: string, tag: 'head' | 'body', content: string) {
  const opening = new RegExp(`<${tag}\\b[^>]*>`, 'i');
  const match = opening.exec(html);
  if (match) {
    const index = match.index + match[0].length;
    return `${html.slice(0, index)}${content}${html.slice(index)}`;
  }
  if (tag === 'head') {
    const htmlOpening = /<html\b[^>]*>/i.exec(html);
    if (htmlOpening) {
      const index = htmlOpening.index + htmlOpening[0].length;
      return `${html.slice(0, index)}<head>${content}</head>${html.slice(index)}`;
    }
    return `<head>${content}</head>${html}`;
  }
  const closingHtml = /<\/html\s*>/i.exec(html);
  if (closingHtml)
    return `${html.slice(0, closingHtml.index)}<body>${content}</body>${html.slice(closingHtml.index)}`;
  return `${html}<body>${content}</body>`;
}

function insertBeforeClosingTag(html: string, tag: 'head' | 'body', content: string) {
  const closing = new RegExp(`</${tag}\\s*>`, 'i');
  const match = closing.exec(html);
  if (match) return `${html.slice(0, match.index)}${content}${html.slice(match.index)}`;
  const opening = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html);
  if (opening) {
    const searchFrom = opening.index + opening[0].length;
    const boundaryPattern = tag === 'head' ? /<body\b[^>]*>|<\/html\s*>/i : /<\/html\s*>/i;
    const boundary = boundaryPattern.exec(html.slice(searchFrom));
    const index = boundary ? searchFrom + boundary.index : html.length;
    return `${html.slice(0, index)}${content}${html.slice(index)}`;
  }
  return insertAfterOpeningTag(html, tag, content);
}

export function applyCustomCodeToHtml(
  html: string,
  settings: unknown,
  pagePath: string,
) {
  let next = stripCustomCodeFromHtml(html);
  const entries = resolveCustomCodeEntries(settings, pagePath);
  const forPlacement = (placement: CustomCodePlacement) =>
    entries.filter(entry => entry.placement === placement).map(materializeEntry).join('');

  const headStart = forPlacement('head-start');
  const headEnd = forPlacement('head-end');
  const bodyStart = forPlacement('body-start');
  const bodyEnd = forPlacement('body-end');
  if (headStart) next = insertAfterOpeningTag(next, 'head', headStart);
  if (headEnd) next = insertBeforeClosingTag(next, 'head', headEnd);
  if (bodyStart) next = insertAfterOpeningTag(next, 'body', bodyStart);
  if (bodyEnd) next = insertBeforeClosingTag(next, 'body', bodyEnd);
  return next;
}

export function applyCustomCodeToProject(
  project: HtmlProject,
  settings: unknown,
): HtmlProject {
  let changed = false;
  const files: Record<string, HtmlProjectFile> = {};
  Object.entries(project.files).forEach(([path, file]) => {
    if (!/\.html?$/i.test(path) || file.text === undefined) {
      files[path] = file;
      return;
    }
    const text = applyCustomCodeToHtml(file.text, settings, path);
    if (text !== file.text) changed = true;
    files[path] = text === file.text ? file : { ...file, text };
  });
  return changed ? { ...project, files } : project;
}

export function remapCustomCodePage(
  settings: unknown,
  fromPath: string,
  toPath: string,
): CustomCodeSettings {
  const current = normalizeCustomCodeSettings(settings);
  const from = normalizePagePath(fromPath);
  const to = normalizePagePath(toPath);
  if (!from || !to || from === to) return current;
  return {
    ...current,
    entries: current.entries.map(entry => ({
      ...entry,
      pages: Array.from(new Set(entry.pages.map(path => path === from ? to : path))),
    })),
  };
}

export function removeCustomCodePage(
  settings: unknown,
  pagePath: string,
): CustomCodeSettings {
  const current = normalizeCustomCodeSettings(settings);
  const target = normalizePagePath(pagePath);
  if (!target) return current;
  return {
    ...current,
    entries: current.entries.map(entry => ({
      ...entry,
      pages: entry.pages.filter(path => path !== target),
    })),
  };
}
