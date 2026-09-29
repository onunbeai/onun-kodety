import { parseSrcsetCandidates, rewriteCssAssetUrls } from './asset-reference-syntax';
import { projectPublicFilePath } from './coded-project';
import { resolveProjectPath } from './project-path';
import type { HtmlProject, HtmlProjectFile } from './types';

export type ProjectAssetReferenceKind =
  | 'html-src'
  | 'html-srcset'
  | 'css-url'
  | 'seo'
  | 'social'
  | 'template';

export interface ProjectAssetReference {
  kind: ProjectAssetReferenceKind;
  /** Project file that owns the reference. */
  filePath: string;
  /** Short user-facing description; never contains authored source. */
  label: string;
  /** Attribute or metadata field, without the referenced value. */
  detail?: string;
}

export interface ProjectAssetRemovalGuard {
  allowed: boolean;
  requiresConfirmation: boolean;
  references: ProjectAssetReference[];
}

const KIND_ORDER: ProjectAssetReferenceKind[] = [
  'html-src',
  'html-srcset',
  'css-url',
  'seo',
  'social',
  'template',
];

const KIND_LABEL: Record<ProjectAssetReferenceKind, string> = {
  'html-src': 'Referência em HTML',
  'html-srcset': 'Imagem responsiva em HTML',
  'css-url': 'URL em estilo CSS',
  seo: 'Mídia de SEO',
  social: 'Imagem social',
  template: 'Template de imagem social',
};

interface ParsedAttribute {
  name: string;
  value: string;
}

interface MetadataContext {
  homeHtmlPath: string;
}

function normalizePath(value: string) {
  const stack: string[] = [];
  value.replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  return stack.join('/');
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&(?:amp|#0*38|#x0*26);/gi, '&')
    .replace(/&(?:quot|#0*34|#x0*22);/gi, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'");
}

function localReferencePath(value: string) {
  const trimmed = decodeHtmlEntities(value).trim();
  if (
    !trimmed
    || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(trimmed)
    || /^(?:var|env)\s*\(/i.test(trimmed)
    || trimmed.includes('{{')
    || trimmed.includes('${')
  ) return null;
  const suffixIndex = trimmed.search(/[?#]/);
  const encoded = suffixIndex >= 0 ? trimmed.slice(0, suffixIndex) : trimmed;
  if (!encoded) return null;
  let decoded = encoded;
  try { decoded = decodeURIComponent(encoded); }
  catch { /* Keep malformed-but-authored percent encoding for exact lookup. */ }
  return decoded.replaceAll('\\', '/');
}

function canonicalTargetPath(project: HtmlProject, assetPath: string) {
  const local = localReferencePath(assetPath);
  if (!local) return null;
  return projectPublicFilePath(project, normalizePath(local.replace(/^\/+/, '')));
}

function canonicalAuthoredPath(
  project: HtmlProject,
  sourcePath: string,
  authoredValue: string,
) {
  const local = localReferencePath(authoredValue);
  if (!local) return null;
  const rootPath = project.previewRootPath ?? project.rootPath;
  const resolved = resolveProjectPath(sourcePath, local, rootPath);
  return resolved ? projectPublicFilePath(project, resolved) : null;
}

function samePath(left: string | null, right: string) {
  return Boolean(left && left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US'));
}

function parseAttributes(source: string): ParsedAttribute[] {
  const attributes: ParsedAttribute[] = [];
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    attributes.push({
      name: match[1].toLowerCase(),
      value: decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ''),
    });
  }
  return attributes;
}

function attributeValue(attributes: ParsedAttribute[], name: string) {
  return attributes.find(attribute => attribute.name === name)?.value || '';
}

function srcsetUrls(value: string) {
  return parseSrcsetCandidates(value).map(candidate => candidate.url);
}

/** Share the rendering grammar so referenced image-set/font assets stay protected. */
function cssUrls(source: string) {
  const urls: string[] = [];
  rewriteCssAssetUrls(source, url => { urls.push(url); return null; });
  return urls;
}

function isHtmlFile(file: HtmlProjectFile) {
  return /\.html?$/i.test(file.path) || /(?:^|\/)html(?:;|$)/i.test(file.mimeType);
}

function isCssFile(file: HtmlProjectFile) {
  return /\.css$/i.test(file.path) || /(?:^|\/)css(?:;|$)/i.test(file.mimeType);
}

function metadataDetail(path: Array<string | number>) {
  return path.reduce<string>((result, part) => (
    typeof part === 'number'
      ? `${result}[${part}]`
      : `${result ? `${result}.` : ''}${part}`
  ), '');
}

function metadataKind(path: Array<string | number>): ProjectAssetReferenceKind | null {
  const stringParts = path.filter((part): part is string => typeof part === 'string');
  const leaf = stringParts.at(-1)?.toLowerCase() || '';
  const inTemplate = stringParts.some(part => /^socialimagetemplates?$/i.test(part));
  if (inTemplate && ['image', 'source', 'fontfile'].includes(leaf)) return 'template';
  if (leaf === 'socialimage') return 'social';
  if (['faviconlight', 'favicondark', 'organizationlogo'].includes(leaf)) return 'seo';
  return null;
}

function metadataBasePath(
  project: HtmlProject,
  context: MetadataContext,
  path: Array<string | number>,
) {
  return path[0] === 'pageSettings' && typeof path[1] === 'string'
    ? path[1]
    : context.homeHtmlPath || project.mainHtmlPath;
}

function jsonLdContainsAsset(
  project: HtmlProject,
  targetPath: string,
  basePath: string,
  value: unknown,
  path: Array<string | number> = [],
): boolean {
  if (typeof value === 'string') {
    const leaf = [...path].reverse().find(part => typeof part === 'string');
    return typeof leaf === 'string'
      && /^(?:image|logo|url|contenturl|thumbnailurl)$/i.test(leaf)
      && samePath(canonicalAuthoredPath(project, basePath, value), targetPath);
  }
  if (Array.isArray(value)) {
    return value.some((entry, index) => jsonLdContainsAsset(
      project,
      targetPath,
      basePath,
      entry,
      [...path, index],
    ));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) => jsonLdContainsAsset(
      project,
      targetPath,
      basePath,
      entry,
      [...path, key],
    ));
  }
  return false;
}

function parsedJson(value: string) {
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

/**
 * Find live project references to a local asset without mutating the project.
 * Results are canonicalized through the same public/root lookup used by the
 * preview/compiler, deduplicated by origin/kind/detail and stably ordered.
 */
export function findProjectAssetReferences(
  project: HtmlProject,
  assetPath: string,
): ProjectAssetReference[] {
  const targetPath = canonicalTargetPath(project, assetPath);
  if (!targetPath) return [];

  const references: ProjectAssetReference[] = [];
  const seen = new Set<string>();
  const record = (
    filePath: string,
    kind: ProjectAssetReferenceKind,
    detail?: string,
  ) => {
    const key = JSON.stringify([normalizePath(filePath), kind, detail || '']);
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ kind, filePath, label: KIND_LABEL[kind], ...(detail ? { detail } : {}) });
  };
  const matches = (sourcePath: string, value: string) => samePath(
    canonicalAuthoredPath(project, sourcePath, value),
    targetPath,
  );

  Object.values(project.files)
    .filter(file => file.text !== undefined && !samePath(normalizePath(file.path), targetPath))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .forEach(file => {
      const source = file.text || '';
      if (isCssFile(file)) {
        cssUrls(source).forEach(value => {
          if (matches(file.path, value)) record(file.path, 'css-url', 'url()');
        });
        return;
      }
      if (!isHtmlFile(file)) return;

      const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
      withoutComments.replace(
        /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
        (_block, css: string) => {
          cssUrls(css).forEach(value => {
            if (matches(file.path, value)) record(file.path, 'css-url', 'style[url()]');
          });
          return '';
        },
      );
      withoutComments.replace(
        /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
        (_block, attributeSource: string, body: string) => {
          const attributes = parseAttributes(attributeSource);
          if (attributeValue(attributes, 'type').toLowerCase() !== 'application/ld+json') return '';
          const json = parsedJson(body);
          if (json && jsonLdContainsAsset(project, targetPath, file.path, json)) {
            record(file.path, 'seo', 'script[type=application/ld+json]');
          }
          return '';
        },
      );
      const tagSource = withoutComments
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, '$1$2');
      const tagPattern = /<([a-z][\w:-]*)\b([^<>]*?)\/?\s*>/gi;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = tagPattern.exec(tagSource))) {
        const tag = tagMatch[1].toLowerCase();
        const attributes = parseAttributes(tagMatch[2]);
        const marker = (
          attributeValue(attributes, 'property')
          || attributeValue(attributes, 'name')
        ).toLowerCase();
        if (
          tag === 'meta'
          && /^(?:og|twitter):image(?::|$)/.test(marker)
          && matches(file.path, attributeValue(attributes, 'content'))
        ) record(file.path, 'social', `meta[${marker}]`);

        const rel = attributeValue(attributes, 'rel').toLowerCase().split(/\s+/).filter(Boolean);
        const isSeoIcon = tag === 'link' && rel.some(value => value === 'icon' || value.endsWith('-icon'));
        if (isSeoIcon && matches(file.path, attributeValue(attributes, 'href'))) {
          record(file.path, 'seo', 'link[rel=icon]');
        }

        const directAttributes = new Set([
          'src',
          'poster',
          'href',
          'xlink:href',
          'background',
          'data-src',
          'data-lazy-src',
          'data-original',
          'data-poster',
          'data-poster-url',
        ]);
        attributes.forEach(attribute => {
          const objectData = tag === 'object' && attribute.name === 'data';
          if (
            (directAttributes.has(attribute.name) || objectData)
            && !(isSeoIcon && attribute.name === 'href')
            && matches(file.path, attribute.value)
          ) record(file.path, 'html-src', `${tag}[${attribute.name}]`);

          if (
            ['srcset', 'data-srcset', 'data-lazy-srcset', 'imagesrcset'].includes(attribute.name)
            && srcsetUrls(attribute.value).some(value => matches(file.path, value))
          ) record(file.path, 'html-srcset', `${tag}[${attribute.name}]`);

          if (attribute.name === 'data-video-urls'
            && attribute.value.split(',').some(value => matches(file.path, value.trim()))) {
            record(file.path, 'html-src', `${tag}[data-video-urls]`);
          }

          if (attribute.name === 'style') {
            cssUrls(attribute.value).forEach(value => {
              if (matches(file.path, value)) record(file.path, 'css-url', `${tag}[style] url()`);
            });
          }
        });
      }
    });

  const metadataFile = project.files['.incode/project.json'];
  const metadata = metadataFile?.text ? parsedJson(metadataFile.text) : null;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const document = metadata as Record<string, unknown>;
    const context: MetadataContext = {
      homeHtmlPath: (
        typeof document.homeHtmlPath === 'string' && document.homeHtmlPath
      ) || (
        typeof document.mainHtmlPath === 'string' && document.mainHtmlPath
      ) || project.mainHtmlPath,
    };
    const visit = (value: unknown, path: Array<string | number>) => {
      if (typeof value === 'string') {
        const kind = metadataKind(path);
        const basePath = metadataBasePath(project, context, path);
        if (kind && matches(basePath, value)) {
          record(metadataFile.path, kind, metadataDetail(path));
          return;
        }
        const leaf = [...path].reverse().find(part => typeof part === 'string');
        if (typeof leaf === 'string' && /^(?:global)?schemajsonld$/i.test(leaf)) {
          const json = parsedJson(value);
          if (json && jsonLdContainsAsset(project, targetPath, basePath, json)) {
            record(metadataFile.path, 'seo', metadataDetail(path));
          }
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, [...path, index]));
        return;
      }
      if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => visit(entry, [...path, key]));
      }
    };
    visit(document, []);
  }

  return references.sort((left, right) => {
    if (left.filePath !== right.filePath) return left.filePath < right.filePath ? -1 : 1;
    const kindDifference = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
    if (kindDifference) return kindDifference;
    const leftDetail = left.detail || '';
    const rightDetail = right.detail || '';
    return leftDetail < rightDetail ? -1 : leftDetail > rightDetail ? 1 : 0;
  });
}

/** Compatibility name for callers that prefer the enumeration terminology. */
export const enumerateProjectAssetReferences = findProjectAssetReferences;

/** Pure preflight for the UI before it calls the existing project-file remover. */
export function projectAssetRemovalGuard(
  project: HtmlProject,
  assetPath: string,
  confirmed = false,
): ProjectAssetRemovalGuard {
  const references = findProjectAssetReferences(project, assetPath);
  return {
    allowed: references.length === 0 || confirmed,
    requiresConfirmation: references.length > 0 && !confirmed,
    references,
  };
}
