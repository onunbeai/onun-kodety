import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { isHydratedFramerProject } from './framer-project-detection';
import { ensureFramerVisualCleanup } from './framer-visual-cleanup';
import { resolveProjectPath } from './project-path';
import type { FramerHydratedSnapshot } from './framer-snapshot';
import type { HtmlProject, HtmlProjectFile } from './types';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type Edit = { start: number; end: number; text: string };
const FRAMER_MANIFEST = '.incode/framer-import.json';
const URL_MANIFEST = '.incode/url-import.json';
const OWNED_SCRIPTS = new Set(['data-kodety-framer-baseline', 'data-kodety-framer-edit-guard', 'data-kodety-framer-compat-runtime']);
const HYDRATION_ATTRIBUTES = new Set(['data-framer-hydrate-v2', ...OWNED_SCRIPTS]);

function jsonObject(text: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function elements(source: string): Element[] {
  const result: Element[] = [];
  const visit = (node: Node) => {
    if ('tagName' in node) result.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
    if ('content' in node) visit(node.content);
  };
  visit(parse(source, { sourceCodeLocationInfo: true }));
  return result;
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find(attribute => attribute.name === name)?.value;
}

function applyEdits(source: string, edits: Edit[]) {
  let right = source.length;
  let output = '';
  edits.sort((a, b) => b.start - a.start || b.end - a.end).forEach(edit => {
    if (edit.end > right || edit.start < 0) throw new Error('O HTML contém regiões sobrepostas e não pode ser convertido com segurança.');
    output = edit.text + source.slice(edit.end, right) + output;
    right = edit.start;
  });
  return source.slice(0, right) + output;
}

function rootElement(source: string): Element | undefined {
  const nodes = elements(source);
  return nodes.find(node => attr(node, 'id') === 'main')
    || nodes.find(node => attr(node, 'data-framer-root') !== undefined)
    || nodes.find(node => node.tagName === 'body' && node.sourceCodeLocation?.startTag);
}

export function framerConversionRootSelector(source: string): string {
  const root = rootElement(source);
  if (!root) throw new Error('Não foi possível identificar o documento Framer.');
  if (attr(root, 'id') === 'main') return '#main';
  if (attr(root, 'data-framer-root') !== undefined) return '[data-framer-root]';
  return 'body';
}

function preserveResponsiveAlternatives(source: string, snapshotHtml: string): string {
  const authored = elements(source);
  const captured = elements(snapshotHtml);
  const identity = (node: Element) => {
    for (const name of ['data-kodety-framer-node', 'id']) {
      const value = attr(node, name);
      if (value && authored.filter(item => attr(item, name) === value).length === 1) return { name, value };
    }
    return null;
  };
  const counterpart = (node: Element) => {
    const key = identity(node);
    if (key) return captured.find(item => attr(item, key.name) === key.value);
    const classes = attr(node, 'class');
    if (classes && authored.filter(item => item.tagName === node.tagName && attr(item, 'class') === classes).length === 1) {
      return captured.find(item => item.tagName === node.tagName && attr(item, 'class') === classes);
    }
    if (attr(node, 'data-framer-root') !== undefined) return captured.find(item => attr(item, 'data-framer-root') !== undefined);
    return node.tagName === 'body' ? captured.find(item => item.tagName === 'body') : undefined;
  };
  const edits = new Map<number, string[]>();
  authored.forEach(node => {
    if (!(attr(node, 'class') || '').split(/\s+/).includes('ssr-variant') || counterpart(node)) return;
    const location = node.sourceCodeLocation;
    const parent = node.parentNode && 'tagName' in node.parentNode ? counterpart(node.parentNode) : undefined;
    const insertion = parent?.sourceCodeLocation?.endTag?.startOffset;
    if (!location || insertion === undefined) return;
    const originals = edits.get(insertion) || [];
    originals.push(source.slice(location.startOffset, location.endOffset));
    edits.set(insertion, originals);
  });
  return applyEdits(snapshotHtml, Array.from(edits, ([start, html]) => ({ start, end: start, text: html.join('') })));
}

function materializeSnapshot(source: string, snapshot: FramerHydratedSnapshot, project: HtmlProject): string {
  if (snapshot.version !== 1 || snapshot.rootSelector !== framerConversionRootSelector(source)
    || typeof snapshot.rootHtml !== 'string' || snapshot.rootHtml.length > 12 * 1024 * 1024
    || !Array.isArray(snapshot.styles) || snapshot.styles.length > 2000) {
    throw new Error('A captura não corresponde à página Framer atual.');
  }
  const root = rootElement(source);
  const capturedRoot = rootElement(snapshot.rootHtml);
  if (!root?.sourceCodeLocation || !capturedRoot?.sourceCodeLocation || root.tagName !== capturedRoot.tagName) {
    throw new Error('A estrutura do Preview não corresponde ao documento atual.');
  }
  let next = source.slice(0, root.sourceCodeLocation.startOffset)
    + preserveResponsiveAlternatives(source, snapshot.rootHtml)
    + source.slice(root.sourceCodeLocation.endOffset);
  const sourceNodes = elements(source);
  const sourceStyles = sourceNodes.filter(node => node.tagName === 'style');
  const additionalStyles: { html: string; placement: 'head' | 'body' }[] = [];
  snapshot.styles.forEach(style => {
    if (!style || typeof style.css !== 'string' || style.css.length > 4 * 1024 * 1024
      || (style.embeddedIndex !== undefined && (!Number.isInteger(style.embeddedIndex) || style.embeddedIndex < 0))
      || (style.media !== undefined && (typeof style.media !== 'string' || style.media.length > 4096))
      || (style.sourcePath !== undefined && (typeof style.sourcePath !== 'string' || !project.files[style.sourcePath]))) {
      throw new Error('O CSS capturado não é válido.');
    }
    const css = style.css.replace(/<\/style/gi, '<\\/style');
    const media = style.disabled ? 'not all' : style.media || '';
    const styleHtml = `<style data-kodety-framer-materialized${media ? ` media="${media.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"` : ''}>${css}</style>`;
    const authoredStyle = style.sourcePath
      ? sourceNodes.find(node => node.tagName === 'link'
        && /(?:^|\s)stylesheet(?:\s|$)/i.test(attr(node, 'rel') || '')
        && resolveProjectPath(project.mainHtmlPath, attr(node, 'href') || '', project.rootPath) === style.sourcePath)
      : style.embeddedIndex === undefined ? undefined : sourceStyles[style.embeddedIndex];
    const location = authoredStyle?.sourceCodeLocation;
    const originalBlock = location ? source.slice(location.startOffset, location.endOffset) : '';
    if (originalBlock && next.includes(originalBlock)) {
      next = next.replace(originalBlock, styleHtml);
    } else {
      additionalStyles.push({ html: styleHtml, placement: style.placement === 'head' ? 'head' : 'body' });
    }
  });
  if (additionalStyles.length) {
    for (const placement of ['head', 'body'] as const) {
      const html = additionalStyles.filter(style => style.placement === placement).map(style => style.html).join('\n');
      if (!html) continue;
      const host = elements(next).find(node => node.tagName === placement);
      const insertion = host?.sourceCodeLocation?.endTag?.startOffset;
      if (insertion === undefined) throw new Error('O documento precisa de head e body válidos para preservar os estilos hidratados.');
      next = next.slice(0, insertion) + html + '\n' + next.slice(insertion);
    }
  }
  return next;
}

function runtimeEntrypoints(manifest: Record<string, unknown>): string[] {
  const embedded = jsonObject(JSON.stringify(manifest.embedded || {}));
  return [embedded.localizedRuntimeEntrypoint, ...(Array.isArray(embedded.runtimeEntrypoints) ? embedded.runtimeEntrypoints : [])]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
}

function stripHydration(source: string, path: string, project: HtmlProject, entries: string[]) {
  const edits: Edit[] = [];
  let removedScripts = 0;
  let removedUntil = -1;
  const sameEntrypoint = (value: string) => entries.some(entry => {
    if (value === entry || value.split(/[?#]/)[0] === entry.split(/[?#]/)[0]) return true;
    const resolved = resolveProjectPath(path, value, project.rootPath);
    return resolved !== null && resolved === entry.replace(/^\/+/, '').split(/[?#]/)[0];
  });
  elements(source).forEach(element => {
    const location = element.sourceCodeLocation;
    if (!location || location.startOffset < removedUntil) return;
    const type = (attr(element, 'type') || '').trim().toLowerCase();
    const owned = element.attrs.some(attribute => OWNED_SCRIPTS.has(attribute.name));
    const removeScript = element.tagName === 'script' && (
      owned || ['framer/appear', 'framer/handover'].includes(type)
      || Boolean(attr(element, 'src') && sameEntrypoint(attr(element, 'src')!))
    );
    const removePreload = element.tagName === 'link'
      && /(?:^|\s)(?:modulepreload|preload)(?:\s|$)/i.test(attr(element, 'rel') || '')
      && Boolean(attr(element, 'href') && sameEntrypoint(attr(element, 'href')!));
    if (removeScript || removePreload) {
      edits.push({ start: location.startOffset, end: location.endOffset, text: '' });
      removedUntil = location.endOffset;
      if (removeScript) removedScripts += 1;
      return;
    }
    element.attrs.forEach(attribute => {
      const position = location.attrs?.[attribute.name];
      if (position && HYDRATION_ATTRIBUTES.has(attribute.name)) edits.push({ start: position.startOffset, end: position.endOffset, text: '' });
    });
  });
  return { html: applyEdits(source, edits), removedScripts };
}

export interface FramerConversionResult {
  project: HtmlProject;
  report: { pages: number; removedScripts: number; liveSnapshot: boolean; backupPath: string };
}

export function hydratedFramerPagePaths(project: HtmlProject): string[] {
  if (!isHydratedFramerProject(project)) return [];
  const entries = runtimeEntrypoints(jsonObject(project.files[FRAMER_MANIFEST]?.text));
  return Object.values(project.files).filter(file => /\.html?$/i.test(file.path)
    && typeof file.text === 'string'
    && stripHydration(file.text, file.path, project, entries).removedScripts > 0).map(file => file.path);
}

/** Pure project transaction. The caller commits once, using normal draft/undo/publication plumbing. */
export function convertHydratedFramerProject(
  project: HtmlProject,
  options: { snapshot?: FramerHydratedSnapshot; snapshots?: Record<string, FramerHydratedSnapshot>; readOnly?: boolean } = {},
): FramerConversionResult {
  if (options.readOnly) throw new Error('Este projeto está em modo somente leitura.');
  const empty = { pages: 0, removedScripts: 0, liveSnapshot: false, backupPath: '' };
  if (!isHydratedFramerProject(project)) return { project, report: empty };
  const source = project.files[project.mainHtmlPath]?.text;
  if (!source?.trim()) throw new Error('O HTML da página atual não está disponível.');
  const manifest = jsonObject(project.files[FRAMER_MANIFEST]?.text);
  const imported = jsonObject(project.files[URL_MANIFEST]?.text);
  const entries = runtimeEntrypoints(manifest);
  const snapshots = { ...options.snapshots, ...(options.snapshot ? { [project.mainHtmlPath]: options.snapshot } : {}) };
  const missingPages = hydratedFramerPagePaths(project).filter(path => !snapshots[path]);
  if (missingPages.length) throw new Error(`A conversão precisa capturar o Preview de todas as páginas Framer: ${missingPages.slice(0, 3).join(', ')}.`);
  const changed: Record<string, HtmlProjectFile> = {};
  const originals: Record<string, HtmlProjectFile | null> = {};
  let pages = 0;
  let removedScripts = 0;
  const save = (path: string, text: string, mimeType = 'text/html') => {
    if (project.files[path]?.text === text) return;
    originals[path] = project.files[path] || null;
    changed[path] = { ...(project.files[path] || { path, mimeType }), text };
  };
  Object.values(project.files).forEach(file => {
    // Public pages and private locale/experiment documents are authored HTML;
    // the backup is JSON and can never become a routable page or execute.
    if (!/\.html?$/i.test(file.path) || typeof file.text !== 'string') return;
    let html = file.text;
    if (snapshots[file.path]) html = materializeSnapshot(html, snapshots[file.path], { ...project, mainHtmlPath: file.path });
    const converted = stripHydration(html, file.path, project, entries);
    const editableHtml = ensureFramerVisualCleanup(converted.html);
    save(file.path, editableHtml, file.mimeType);
    removedScripts += converted.removedScripts;
    if (editableHtml !== file.text) pages += 1;
  });
  if (!pages) throw new Error('Nenhum runtime Framer reconhecido foi encontrado para converter com segurança.');
  let backupPath = '.incode/framer-conversion-backup.json';
  for (let suffix = 2; project.files[backupPath]; suffix += 1) backupPath = `.incode/framer-conversion-backup-${suffix}.json`;
  const report = { pages, removedScripts, liveSnapshot: Object.keys(snapshots).length > 0, backupPath };
  save(FRAMER_MANIFEST, JSON.stringify({ ...manifest, version: 1, runtime: false, conversion: { version: 1, mode: 'static-editable', ...report } }, null, 2), 'application/json');
  save(URL_MANIFEST, JSON.stringify({ ...imported, platform: 'framer', framerMode: 'static', runtime: 'static-editable' }, null, 2), 'application/json');
  const backup = { version: 1, files: originals };
  changed[backupPath] = { path: backupPath, mimeType: 'application/json', text: JSON.stringify(backup) };
  return { project: { ...project, files: { ...project.files, ...changed } }, report };
}
