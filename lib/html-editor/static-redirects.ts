import { normalizeRedirectSettings, validateRedirectSettings, type RedirectEntry, type RedirectSettings } from './redirects';
import type { HtmlProject, HtmlProjectFile } from './types';

const START = '# Kodety redirects — generated';
const END = '# End Kodety redirects';
const MARKER = 'data-kodety-static-redirects';
const json = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const encodePath = (value: string) => value.split('/').map(part => encodeURIComponent(part)).join('/');
const patternEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function validated(value: unknown): RedirectSettings {
  const settings = normalizeRedirectSettings(value);
  const issues = validateRedirectSettings(settings);
  if (issues.length) throw new Error(issues[0].message);
  return { ...settings, entries: settings.entries.filter(entry => entry.enabled) };
}

function cloudflareLines(entry: RedirectEntry): string[] | null {
  // Pages cannot express an arbitrary source-query merge/drop policy. Keep
  // such rules in the browser fallback rather than changing their semantics.
  if (!entry.preserveQuery || entry.destination.includes('?') || entry.source.split('*').length > 2) return null;
  const source = entry.source.split('*').map(encodePath).join('*');
  const destination = entry.destination.replace('*', ':splat');
  if (entry.match === 'prefix') {
    const root = source.replace(/\/$/, '');
    const target = new URL(destination.replace(':splat', ''), 'https://kodety.invalid');
    if (!entry.destination.includes('*')) target.pathname = `${target.pathname.replace(/\/$/, '')}/:splat`;
    const nested = entry.destination.includes('*') ? destination : /^https?:/i.test(destination) ? target.href : `${target.pathname}${target.search}${target.hash}`;
    return [`${source} ${destination.replace(':splat', '')} ${entry.status}`, `${root}/* ${nested} ${entry.status}`];
  }
  return [`${source} ${destination} ${entry.status}`];
}

function vercelRules(entry: RedirectEntry): Array<Record<string, unknown>> {
  let index = 0;
  const source = entry.source.split('*').map(encodePath).join(':kodetyCapture(.*)');
  const destination = entry.destination.replace(/\*/g, () => `:kodety${index++}`);
  if (entry.match === 'prefix') {
    const prefix = source.replace(/\/$/, '');
    const target = new URL(entry.destination.replace('*', ':kodetyPath*'), 'https://kodety.invalid');
    if (!entry.destination.includes('*')) target.pathname = `${target.pathname.replace(/\/$/, '')}/:kodetyPath*`;
    return [
      { source, destination: entry.destination.replaceAll('*', ''), statusCode: entry.status },
      { source: `${prefix}/:kodetyPath*`, destination: /^https?:/i.test(entry.destination) ? target.href : `${target.pathname}${target.search}${target.hash}`, statusCode: entry.status },
    ];
  }
  index = 0;
  return [{ source: source.replace(/:kodetyCapture/g, () => `:kodety${index++}`), destination, statusCode: entry.status }];
}

/** Hosting warnings are returned to the UI as well as saved beside the export. */
export function staticRedirectWarnings(value: unknown): string[] {
  const entries = validated(value).entries;
  if (!entries.length) return [];
  const warnings = ['GitHub Pages e hospedagens genéricas usam redirecionamento no navegador; códigos HTTP 301/302/307/308 dependem da hospedagem. Regras já existentes na hospedagem têm prioridade.'];
  if (entries.some(entry => cloudflareLines(entry) === null)) warnings.push('Cloudflare Pages: regras que removem/mesclam parâmetros ou usam vários curingas precisam de uma Redirect Rule/Function para redirecionamento HTTP; a exportação mantém o fallback no navegador.');
  if (entries.some(entry => !entry.preserveQuery)) warnings.push('Vercel: regras com remoção dos parâmetros usam respostas Location em routes; as demais são adicionadas a redirects.');
  if (entries.some(entry => entry.match !== 'exact')) warnings.push('Prefixos e curingas no fallback dependem de a hospedagem servir o arquivo 404.html exportado. Configure a URL base do site para usar esse fallback em subpastas.');
  return warnings;
}

// Kept self-contained so the exported site requires neither WordPress nor a
// package manager. Exact, prefix, wildcard, query-merge and cycle semantics
// match the shared authoring model and are exercised against it in tests.
const RUNTIME = `(()=>{
  const script=document.currentScript;let cfg;
  try{cfg=JSON.parse(script.dataset.config)}catch(e){return}
  const root=cfg.base?new URL(cfg.base,location.href):new URL(cfg.fallback?'/':cfg.root,location.href);
  let current=new URL(location.href);
  if(!current.pathname.startsWith(root.pathname))return;
  const clean=value=>'/'+value.split('/').filter(Boolean).join('/');
  const trimEnd=value=>value.endsWith('/')?value.slice(0,-1):value;
  let request='/'+current.pathname.slice(root.pathname.length);
  const visited=new Set();let final=null;let exhausted=true;
  for(let step=0;step<=cfg.entries.length+1;step++){
    let path;try{path=clean(decodeURIComponent(request))}catch(e){return}
    const key=path.toLowerCase();if(visited.has(key))return;visited.add(key);
    let target=null;
    for(const entry of cfg.entries){
      const match=new RegExp(entry.pattern,'i').exec(path);if(!match)continue;
      let destination=entry.destination.split('*').map((part,index)=>index?(match[index]||'')+part:part).join('');
      if(entry.prefix&&!entry.destination.includes('*')&&match[1]){
        const part=new URL(destination,'https://kodety.invalid');
        part.pathname=trimEnd(part.pathname)+'/'+match[1].split('/').filter(Boolean).join('/');
        destination=destination.startsWith('http:')||destination.startsWith('https:')?part.href:part.pathname+part.search+part.hash;
      }
      target=new URL(destination.startsWith('/')?destination.slice(1):destination,root);
      if(entry.preserveQuery){const keys=new Set(target.searchParams.keys());current.searchParams.forEach((value,key)=>{if(!keys.has(key))target.searchParams.append(key,value)})}
      if(!target.hash)target.hash=current.hash;break;
    }
    if(!target){exhausted=false;break}
    final=target;
    if(target.origin!==root.origin||!target.pathname.startsWith(root.pathname)){exhausted=false;break}
    current=target;request='/'+target.pathname.slice(root.pathname.length);
  }
  if(!exhausted&&final&&final.href!==location.href)location.replace(final.href);
})();`;

function runtimeEntries(entries: RedirectEntry[]) {
  return entries.map(entry => ({
    pattern: entry.match === 'exact' ? `^${patternEscape(entry.source)}/?$` : entry.match === 'prefix' ? entry.source === '/' ? '^/(.*)$' : `^${patternEscape(entry.source)}(?:/(.*))?/?$` : `^${entry.source.split('*').map(patternEscape).join('(.*)')}/?$`,
    destination: entry.destination, preserveQuery: entry.preserveQuery, prefix: entry.match === 'prefix',
  }));
}

function injectRuntime(html: string, path: string, entries: RedirectEntry[], base: string, fallback = false) {
  const depth = path.split('/').length - 1;
  const config = { entries: runtimeEntries(entries), root: depth ? '../'.repeat(depth) : './', base, fallback };
  const script = `<script ${MARKER}="1" data-config="${escape(json(config))}">${RUNTIME}</script>`;
  const stripped = html.replace(new RegExp(`<script\\b(?=[^>]*\\b${MARKER})[^>]*>[\\s\\S]*?<\\/script>`, 'gi'), '');
  return /<head\b[^>]*>/i.test(stripped) ? stripped.replace(/<head\b[^>]*>/i, match => `${match}${script}`) : `${script}${stripped}`;
}

/** Merge native hosting rules and provide portable browser fallbacks. */
export function prepareStaticRedirects(project: HtmlProject, value: unknown, siteBaseUrl = ''): HtmlProject {
  const settings = validated(value);
  if (!settings.entries.length) return project;
  const files: Record<string, HtmlProjectFile> = { ...project.files };
  const browserEntries = settings.entries.map(entry => {
    if (!entry.destination.startsWith('/') || entry.destination.includes('*')) return entry;
    const target = new URL(entry.destination, 'https://kodety.invalid');
    const path = decodeURIComponent(target.pathname).replace(/^\/+|\/+$/g, '');
    if (path && !files[path] && files[`${path}.html`]) target.pathname = `${target.pathname.replace(/\/$/, '')}.html`;
    return { ...entry, destination: `${target.pathname}${target.search}${target.hash}` };
  });
  let base = '';
  try { const url = new URL(siteBaseUrl); if (['http:', 'https:'].includes(url.protocol)) base = `${url.pathname.replace(/\/$/, '')}/`; } catch { /* Root is inferred from each page. */ }
  const existingCloudflare = files['_redirects']?.text || '';
  const cleanedCloudflare = existingCloudflare.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`, 'g'), '');
  const existingCloudflareRules = cleanedCloudflare.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  const existingSources = new Set(existingCloudflareRules.map(line => line.trim().split(/\s+/)[0]));
  const cloudflare = settings.entries.flatMap(entry => cloudflareLines(entry) || []).filter(line => !existingSources.has(line.split(' ')[0]));
  const combined = [...existingCloudflareRules, ...cloudflare];
  const dynamicCount = combined.filter(line => /[*:]/.test(line.split(' ')[0])).length;
  if (combined.length > 2100 || dynamicCount > 100 || combined.length - dynamicCount > 2000 || combined.some(line => line.length > 1000)) throw new Error('As regras excedem os limites do arquivo _redirects do Cloudflare Pages. Reduza as regras ou use Bulk Redirects.');
  if (cloudflare.length) files['_redirects'] = { path: '_redirects', mimeType: 'text/plain', text: `${cleanedCloudflare}${cleanedCloudflare && !cleanedCloudflare.endsWith('\n') ? '\n' : ''}${START}\n${cloudflare.join('\n')}\n${END}\n` };

  let vercel: Record<string, unknown> = {};
  if (files['vercel.json']) {
    try { vercel = JSON.parse(files['vercel.json'].text || ''); } catch { throw new Error('Corrija o vercel.json existente antes de exportar redirecionamentos.'); }
    if (!vercel || typeof vercel !== 'object' || Array.isArray(vercel)) throw new Error('O vercel.json deve conter um objeto JSON.');
  }
  if (vercel.redirects !== undefined && !Array.isArray(vercel.redirects)) throw new Error('O campo redirects no vercel.json deve ser uma lista.');
  if (vercel.routes !== undefined && !Array.isArray(vercel.routes)) throw new Error('O campo routes no vercel.json deve ser uma lista.');
  const redirects = [...(vercel.redirects as Record<string, unknown>[] || [])];
  const rawRoutes = [...(vercel.routes as Record<string, unknown>[] || [])];
  for (const entry of settings.entries) {
    if (entry.preserveQuery) {
      for (const rule of vercelRules(entry)) if (!redirects.some(existing => existing.source === rule.source)) redirects.push(rule);
    } else {
      const runtime = runtimeEntries([entry])[0];
      let index = 0;
      let location = entry.destination.replace(/\*/g, () => `$${++index}`);
      if (entry.match === 'prefix' && !entry.destination.includes('*')) {
        const target = new URL(location, 'https://kodety.invalid'); target.pathname = `${target.pathname.replace(/\/$/, '')}/$1`;
        location = /^https?:/i.test(location) ? target.href : `${target.pathname}${target.search}${target.hash}`;
      }
      const rule = { src: runtime.pattern, headers: { Location: location }, status: entry.status };
      if (!rawRoutes.some(existing => existing.src === rule.src)) rawRoutes.push(rule);
    }
  }
  if (redirects.length > 1024) throw new Error('A exportação excede 1.024 redirecionamentos de configuração da Vercel. Use Bulk Redirects.');
  files['vercel.json'] = { path: 'vercel.json', mimeType: 'application/json', text: JSON.stringify({ ...vercel, ...(redirects.length ? { redirects } : {}), ...(rawRoutes.length ? { routes: rawRoutes } : {}) }, null, 2) };
  for (const file of Object.values(files)) {
    if (file.text === undefined || !/\.html?$/i.test(file.path) || file.path.startsWith('.')) continue;
    files[file.path] = { ...file, text: injectRuntime(file.text, file.path, browserEntries, base) };
  }
  for (const entry of settings.entries.filter(entry => entry.match === 'exact')) {
    const requested = entry.source.replace(/^\/+|\/+$/g, '');
    if (!requested || requested.split('/').some(part => part.startsWith('.'))) continue;
    const path = /\.html?$/i.test(requested) ? requested : `${requested}/index.html`;
    if (files[path]) continue;
    const target = entry.destination;
    const document = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Redirecionando</title></head><body><p><a href="${escape(target)}">Continuar para a página</a></p></body></html>`;
    files[path] = { path, mimeType: 'text/html', text: injectRuntime(document, path, browserEntries, base) };
  }
  if (!files['404.html']) files['404.html'] = { path: '404.html', mimeType: 'text/html', text: injectRuntime('<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Página não encontrada</title></head><body><h1>Página não encontrada</h1></body></html>', '404.html', browserEntries, base, true) };
  else if (files['404.html'].text !== undefined) files['404.html'] = { ...files['404.html'], text: injectRuntime(files['404.html'].text!, '404.html', browserEntries, base, true) };
  const notesPath = 'kodety-hosting-notes.txt';
  if (!files[notesPath]) files[notesPath] = { path: notesPath, mimeType: 'text/plain', text: `${staticRedirectWarnings(settings).join('\n\n')}\n\nhttps://developers.cloudflare.com/pages/configuration/redirects/\nhttps://vercel.com/docs/project-configuration/vercel-json\n` };
  return { ...project, files };
}
