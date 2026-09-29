import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { mapExtensionToFontFormat, normalizeFontFamilyName } from '../font-utils';
import type { Font } from '../../types';
import type { HtmlProject, HtmlProjectFile } from './types';

const FONT_FILE_PATTERN = /\.(?:woff2?|ttf|otf)(?:[?#].*)?$/i;
const STYLE_FILE_PATTERN = /\.(?:css|scss|sass|less)$/i;
const HTML_FILE_PATTERN = /\.html?$/i;
const GENERIC_FONT_DIRECTORIES = new Set([
  'asset',
  'assets',
  'dist',
  'font',
  'fonts',
  'public',
  'src',
  'static',
  'webfont',
  'webfonts',
]);
const PRIVATE_FONT_PATH_SEGMENTS = new Set(['.incode', '.kodety-social']);
const fontBinarySignatureCache = new WeakMap<object, string>();
const fontDeclarationSignatureCache = new WeakMap<object, string>();
const fontBinaryMetadataCache = new WeakMap<object, FontBinaryMetadata>();
const projectFontSourceSignatureCache = new WeakMap<object, Map<string, string>>();
const projectFontCatalogByFilesCache = new WeakMap<object, Map<string, ProjectFontCatalog>>();
let latestProjectFontCatalogCache: {
  signature: string;
  catalog: ProjectFontCatalog;
} | null = null;

interface FontBinaryMetadata {
  family: string;
  subfamily: string;
  weight: string;
  style: string;
  category: 'serif' | 'sans-serif' | '';
}

export interface ProjectFontSource {
  /** The authored URL from the @font-face source, when one exists. */
  url: string;
  /** Canonical path of a binary file inside the imported project. */
  filePath?: string;
  format?: string;
}

export interface ProjectFontFace {
  family: string;
  sources: ProjectFontSource[];
  weight: string;
  style: string;
  stretch?: string;
  display?: string;
  unicodeRange?: string;
  /** Stylesheet or HTML file containing the declaration. */
  declaredIn?: string;
  /** True when this face was recovered from an otherwise-unreferenced font asset. */
  inferred?: boolean;
}

/**
 * Font metadata shared by the HTML visual controls and the Social Image
 * Builder. Project fonts deliberately remain separate from uploaded/account
 * fonts: they belong to the imported project and must never be persisted to
 * the global WordPress font list.
 */
export interface ProjectFont extends Font {
  projectSource: true;
  aliases: string[];
  faces: ProjectFontFace[];
}

export interface ProjectFontCatalog {
  fonts: ProjectFont[];
  faces: ProjectFontFace[];
  signature: string;
}

export interface ProjectFontRuntime extends ProjectFontCatalog {
  /** Browser-ready @font-face rules whose local sources are blob URLs. */
  css: string;
  objectUrls: string[];
  revoke: () => void;
}

type ProjectFontInput =
  | HtmlProject
  | Record<string, HtmlProjectFile>
  | null
  | undefined;

function asProject(input: ProjectFontInput): HtmlProject {
  if (
    input
    && typeof (input as HtmlProject).mainHtmlPath === 'string'
    && typeof (input as HtmlProject).rootPath === 'string'
    && (input as HtmlProject).files
  ) return input as HtmlProject;
  const files = (input || {}) as Record<string, HtmlProjectFile>;
  return {
    name: '',
    files,
    mainHtmlPath: Object.keys(files).find(path => HTML_FILE_PATTERN.test(path)) || 'index.html',
    rootPath: '',
    openedAt: 0,
  };
}

function normalizePath(value: string) {
  const result: string[] = [];
  value.replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') result.pop();
    else result.push(part);
  });
  return result.join('/');
}

function isPrivateFontPath(value: string) {
  return normalizePath(value)
    .split('/')
    .some(segment => PRIVATE_FONT_PATH_SEGMENTS.has(segment.toLowerCase()));
}

function projectFontRoot(project: HtmlProject) {
  const previewRoot = normalizePath(project.previewRootPath ?? '');
  if (previewRoot && !isPrivateFontPath(previewRoot)) return previewRoot;
  const root = normalizePath(project.rootPath ?? '');
  return isPrivateFontPath(root) ? '' : root;
}

function dirname(value: string) {
  const parts = normalizePath(value).split('/');
  parts.pop();
  return parts.join('/');
}

function basename(value: string) {
  return normalizePath(value).split('/').pop() || '';
}

interface FontFileLookupIndex {
  byLowerPath: Map<string, string>;
  uniqueSuffix: Map<string, string | null>;
  uniqueBasename: Map<string, string | null>;
}

const fontFileLookupIndexCache = new WeakMap<object, FontFileLookupIndex>();

function fontFileLookupIndex(files: Record<string, HtmlProjectFile>) {
  const cacheKey = files as object;
  const cached = fontFileLookupIndexCache.get(cacheKey);
  if (cached) return cached;
  const byLowerPath = new Map<string, string>();
  const uniqueSuffix = new Map<string, string | null>();
  const uniqueBasename = new Map<string, string | null>();
  const addUnique = (index: Map<string, string | null>, key: string, path: string) => {
    if (!key) return;
    const owner = index.get(key);
    if (owner === undefined) index.set(key, path);
    else if (owner !== path) index.set(key, null);
  };
  Object.keys(files).forEach(path => {
    if (isPrivateFontPath(path) || path.startsWith('kodety-build/')) return;
    const normalized = normalizePath(path).toLowerCase();
    if (!byLowerPath.has(normalized)) byLowerPath.set(normalized, path);
    const parts = normalized.split('/').filter(Boolean);
    parts.forEach((_, index) => addUnique(uniqueSuffix, parts.slice(index).join('/'), path));
    addUnique(uniqueBasename, parts.at(-1) || '', path);
  });
  const index = { byLowerPath, uniqueSuffix, uniqueBasename };
  fontFileLookupIndexCache.set(cacheKey, index);
  return index;
}

function withoutUrlSuffix(value: string) {
  const suffix = value.search(/[?#]/);
  return suffix < 0 ? value : value.slice(0, suffix);
}

function decodePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileByPath(files: Record<string, HtmlProjectFile>, requested: string) {
  if (isPrivateFontPath(requested)) return '';
  if (files[requested] && !isPrivateFontPath(files[requested].path)) return requested;
  return fontFileLookupIndex(files).byLowerPath.get(normalizePath(requested).toLowerCase()) || '';
}

/**
 * Mirrors the editor preview's forgiving project-asset resolution without
 * importing the full preview runtime into every font picker. It covers normal
 * relative URLs, Vite's public directory and ZIP/folder outer-directory drift.
 */
export function resolveProjectFontFile(
  projectInput: ProjectFontInput,
  referencePath: string,
  authoredUrl: string,
) {
  const project = asProject(projectInput);
  const raw = decodePath(withoutUrlSuffix(authoredUrl.trim())).replaceAll('\\', '/');
  if (
    !raw
    || raw.startsWith('#')
    || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)
  ) return '';

  const root = projectFontRoot(project);
  const relative = normalizePath(raw.replace(/^\/+/, ''));
  const directlyResolved = normalizePath(
    `${raw.startsWith('/') ? root : dirname(referencePath)}/${raw}`,
  );
  const candidates = [
    directlyResolved,
    relative,
    root ? `${root}/${relative}` : '',
    root ? `${root}/public/${relative}` : '',
    `public/${relative}`,
  ].map(normalizePath).filter(candidate =>
    Boolean(candidate) && !isPrivateFontPath(candidate));

  for (const candidate of new Set(candidates)) {
    const exact = fileByPath(project.files, candidate);
    if (exact) return exact;
  }

  const fileIndex = fontFileLookupIndex(project.files);
  const suffixes = Array.from(new Set([relative, directlyResolved]))
    .map(value => normalizePath(value).toLowerCase())
    .filter(value => value.includes('/'));
  for (const suffix of suffixes) {
    const match = fileIndex.uniqueSuffix.get(suffix);
    if (match) return match;
  }

  const requestedBasename = basename(relative).toLowerCase();
  if (!requestedBasename) return '';
  return fileIndex.uniqueBasename.get(requestedBasename) || '';
}

function unquoteCssValue(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed[0] === '"' && trimmed.at(-1) === '"')
      || (trimmed[0] === "'" && trimmed.at(-1) === "'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\(["'])/g, '$1').trim();
  }
  return trimmed;
}

function parseFontSources(
  value: string,
  project: HtmlProject,
  referencePath: string,
): ProjectFontSource[] {
  const parsed = valueParser(value);
  const sources: ProjectFontSource[] = [];
  parsed.nodes.forEach((node, index) => {
    if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
    const url = unquoteCssValue(valueParser.stringify(node.nodes));
    if (
      !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)
      && isPrivateFontPath(decodePath(withoutUrlSuffix(url)))
    ) return;
    const next = parsed.nodes.slice(index + 1).find(candidate =>
      candidate.type !== 'space' && candidate.type !== 'div',
    );
    const explicitFormat = next?.type === 'function' && next.value.toLowerCase() === 'format'
      ? unquoteCssValue(valueParser.stringify(next.nodes))
      : '';
    const filePath = resolveProjectFontFile(project, referencePath, url);
    const extension = withoutUrlSuffix(filePath || url).split('.').pop()?.toLowerCase() || '';
    sources.push({
      url,
      ...(filePath ? { filePath } : {}),
      ...(explicitFormat || mapExtensionToFontFormat(extension)
        ? { format: explicitFormat || mapExtensionToFontFormat(extension) || extension }
        : {}),
    });
  });
  return sources;
}

function parseFontFaceRules(
  css: string,
  referencePath: string,
  project: HtmlProject,
  allowBlockFallback = true,
): ProjectFontFace[] {
  let root: postcss.Root;
  try {
    root = postcss.parse(css, { from: referencePath });
  } catch {
    if (!allowBlockFallback) return [];
    // SCSS/Less files can contain syntax that the plain PostCSS parser cannot
    // understand even though their @font-face blocks are ordinary CSS. Parse
    // those blocks independently instead of dropping every project font.
    return fontFaceBlocks(css).flatMap<ProjectFontFace>(block => {
      try {
        return parseFontFaceRules(block, referencePath, project, false);
      } catch {
        return [];
      }
    });
  }
  const faces: ProjectFontFace[] = [];
  root.walkAtRules(/^font-face$/i, rule => {
    const declarations = new Map<string, string>();
    rule.walkDecls(declaration => {
      declarations.set(declaration.prop.trim().toLowerCase(), declaration.value.trim());
    });
    const family = unquoteCssValue(declarations.get('font-family') || '');
    if (!family) return;
    const sources = parseFontSources(declarations.get('src') || '', project, referencePath);
    // `local(...)`-only placeholders (common in Framer/Google fallbacks) do
    // not add a font binary to the project and must not masquerade as an
    // imported project font in the picker.
    if (!sources.length) return;
    const sourceFile = sources
      .map(source => source.filePath ? project.files[source.filePath] : undefined)
      .find((file): file is HtmlProjectFile => Boolean(file));
    const metadata = sourceFile ? fontBinaryMetadata(sourceFile) : null;
    const authoredWeight = declarations.get('font-weight') || '';
    const authoredStyle = declarations.get('font-style') || '';
    faces.push({
      family,
      sources,
      // An omitted descriptor means 400/normal to CSS, but imported projects
      // frequently omit it for a bold/italic binary. The binary metadata is a
      // safer recovery source than silently presenting every face as Regular.
      weight: normalizeFontWeightDescriptor(authoredWeight || metadata?.weight || '400'),
      style: normalizeFontStyleDescriptor(authoredStyle || metadata?.style || 'normal'),
      ...(declarations.get('font-stretch') ? { stretch: declarations.get('font-stretch') } : {}),
      ...(declarations.get('font-display') ? { display: declarations.get('font-display') } : {}),
      ...(declarations.get('unicode-range') ? { unicodeRange: declarations.get('unicode-range') } : {}),
      declaredIn: referencePath,
    });
  });
  return faces;
}

function styleSources(file: HtmlProjectFile) {
  if (file.text === undefined) return [] as string[];
  if (STYLE_FILE_PATTERN.test(file.path)) return [file.text];
  if (!HTML_FILE_PATTERN.test(file.path)) return [];
  return Array.from(file.text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi), match => match[1]);
}

function fontFaceBlocks(source: string) {
  const blocks: string[] = [];
  const matcher = /@font-face\b/gi;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source))) {
    const openingBrace = source.indexOf('{', matcher.lastIndex);
    if (openingBrace < 0) break;
    let quote = '';
    let comment = false;
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (comment) {
        if (character === '*' && next === '/') {
          comment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (character === '\\') {
          index += 1;
          continue;
        }
        if (character === quote) quote = '';
        continue;
      }
      if (character === '/' && next === '*') {
        comment = true;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '{') depth += 1;
      if (character !== '}') continue;
      depth -= 1;
      if (depth > 0) continue;
      blocks.push(source.slice(match.index, index + 1));
      matcher.lastIndex = index + 1;
      break;
    }
  }
  return blocks;
}

function fontDeclarationSignature(file: HtmlProjectFile) {
  const cacheKey = file as object;
  const cached = fontDeclarationSignatureCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const signature = styleSources(file).flatMap(fontFaceBlocks).join('\n');
  fontDeclarationSignatureCache.set(cacheKey, signature);
  return signature;
}

function uint16(data: Uint8Array, offset: number) {
  return offset + 1 < data.length ? (data[offset] << 8) | data[offset + 1] : 0;
}

function uint32(data: Uint8Array, offset: number) {
  return (
    data[offset] * 0x1000000
    + data[offset + 1] * 0x10000
    + data[offset + 2] * 0x100
    + data[offset + 3]
  ) >>> 0;
}

function tableTag(data: Uint8Array, offset: number) {
  return String.fromCharCode(...data.subarray(offset, offset + 4));
}

function decodeUtf16Be(data: Uint8Array) {
  let result = '';
  for (let index = 0; index + 1 < data.length; index += 2) {
    result += String.fromCharCode(uint16(data, index));
  }
  return result;
}

function decodeFontName(data: Uint8Array, platform: number) {
  let value = '';
  if (platform === 0 || platform === 3) {
    value = decodeUtf16Be(data);
  } else {
    try {
      value = new TextDecoder(platform === 1 ? 'macintosh' : 'latin1').decode(data);
    } catch {
      value = new TextDecoder('latin1').decode(data);
    }
  }
  return value
    .replaceAll('\0', '')
    .replace(/[\u0001-\u001f\u007f]/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

interface FontTable {
  bytes: Uint8Array;
  originalLength: number;
}

/**
 * Resolves an SFNT table from TTF/OTF and from uncompressed WOFF tables.
 * WOFF2 transforms and compressed WOFF tables deliberately stay out of this
 * synchronous browser helper; their authored CSS and filename remain valid
 * fallbacks.
 */
function fontTable(data: Uint8Array, wantedTag: string): FontTable | null {
  const signature = tableTag(data, 0);
  if (signature === 'wOFF') {
    const tableCount = uint16(data, 12);
    for (let index = 0; index < tableCount; index += 1) {
      const record = 44 + index * 20;
      if (record + 20 > data.length || tableTag(data, record) !== wantedTag) continue;
      const offset = uint32(data, record + 4);
      const compressedLength = uint32(data, record + 8);
      const originalLength = uint32(data, record + 12);
      if (
        !offset
        || !compressedLength
        || offset + compressedLength > data.length
        || compressedLength !== originalLength
      ) return null;
      return {
        bytes: data.subarray(offset, offset + compressedLength),
        originalLength,
      };
    }
    return null;
  }

  const isSfnt = signature === 'OTTO'
    || signature === 'true'
    || signature === 'typ1'
    || uint32(data, 0) === 0x00010000;
  if (!isSfnt) return null;
  const tableCount = uint16(data, 4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > data.length || tableTag(data, record) !== wantedTag) continue;
    const offset = uint32(data, record + 8);
    const length = uint32(data, record + 12);
    if (!offset || !length || offset + length > data.length) return null;
    return {
      bytes: data.subarray(offset, offset + length),
      originalLength: length,
    };
  }
  return null;
}

function sfntNames(data: Uint8Array) {
  const table = fontTable(data, 'name')?.bytes;
  if (!table || table.length < 6) return new Map<number, string>();
  const count = uint16(table, 2);
  const stringsOffset = uint16(table, 4);
  const choices = new Map<number, Array<{ value: string; score: number }>>();
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12;
    if (record + 12 > table.length) break;
    const platform = uint16(table, record);
    const language = uint16(table, record + 4);
    const nameId = uint16(table, record + 6);
    if (![1, 2, 16, 17].includes(nameId)) continue;
    const length = uint16(table, record + 8);
    const offset = stringsOffset + uint16(table, record + 10);
    if (offset < stringsOffset || offset + length > table.length) continue;
    const value = decodeFontName(table.subarray(offset, offset + length), platform);
    if (!value) continue;
    const records = choices.get(nameId) || [];
    records.push({
      value,
      score: (
        (language === 0x0409 || language === 0 ? 8 : 0)
        + (platform === 3 ? 4 : platform === 0 ? 3 : platform === 1 ? 2 : 0)
      ),
    });
    choices.set(nameId, records);
  }
  const names = new Map<number, string>();
  choices.forEach((records, nameId) => {
    names.set(nameId, records.sort((left, right) => right.score - left.score)[0]?.value || '');
  });
  return names;
}

/**
 * Reads family, typographic subfamily, weight and style metadata from ordinary
 * TTF/OTF files and compatible WOFF tables. This prevents filenames such as
 * `65Medium-Trial` from becoming a second fake family and prevents a bold or
 * italic face from being exposed as Regular merely because CSS omitted it.
 */
function fontBinaryMetadata(file: HtmlProjectFile): FontBinaryMetadata {
  const data = file.data;
  if (!data || data.length < 28) {
    return { family: '', subfamily: '', weight: '', style: '', category: '' };
  }
  const cacheKey = data as object;
  const cached = fontBinaryMetadataCache.get(cacheKey);
  if (cached) return cached;

  const names = sfntNames(data);
  const family = names.get(16) || names.get(1) || '';
  const subfamily = names.get(17) || names.get(2) || '';
  const os2 = fontTable(data, 'OS/2')?.bytes;
  const head = fontTable(data, 'head')?.bytes;
  const post = fontTable(data, 'post')?.bytes;
  const os2Weight = os2 && os2.length >= 6 ? uint16(os2, 4) : 0;
  const subfamilyWeight = descriptiveFontWeight(subfamily);
  const weight = os2Weight >= 1 && os2Weight <= 1000
    ? String(os2Weight)
    : subfamilyWeight
      ? String(subfamilyWeight)
      : '';
  const selection = os2 && os2.length >= 64 ? uint16(os2, 62) : 0;
  const macStyle = head && head.length >= 46 ? uint16(head, 44) : 0;
  const italicAngle = post && post.length >= 8 ? (uint32(post, 4) | 0) : 0;
  const style = (
    selection & 0x0001
    || selection & 0x0200
    || macStyle & 0x0002
    || italicAngle !== 0
    || /(?:italic|oblique)/i.test(subfamily)
  ) ? 'italic' : 'normal';
  const panoseFamily = os2 && os2.length >= 34 ? os2[32] : 0;
  const panoseSerif = os2 && os2.length >= 34 ? os2[33] : 0;
  const category = panoseFamily === 2 && panoseSerif >= 2 && panoseSerif <= 10
    ? 'serif'
    : panoseFamily === 2 && panoseSerif >= 11 && panoseSerif <= 15
      ? 'sans-serif'
      : '';
  const metadata: FontBinaryMetadata = {
    family,
    subfamily,
    weight,
    style,
    category,
  };
  fontBinaryMetadataCache.set(cacheKey, metadata);
  return metadata;
}

function wordsFromFilename(value: string) {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    // Commercial families commonly prefix their style with a face code
    // (`55Roman`, `65Medium`, `15XXThin`). It is not part of the family name.
    .replace(
      /\b\d{1,2}\s*x{0,2}(?=(?:thin|hairline|light|book|regular|normal|roman|medium|bold|black|heavy|italic|oblique))/gi,
      '',
    )
    .replace(
      /\b(?:extra\s*light|ultra\s*light|semi\s*bold|demi\s*bold|extra\s*bold|ultra\s*bold|thin|light|book|regular|normal|roman|medium|bold|black|heavy|italic|oblique|variable|vf|webfont)\b.*$/i,
      '',
    )
    .replace(/\b(?:[1-9]00|wght)\b.*$/i, '')
    .replace(/\b(?:trial|demo)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferredPathFamily(file: HtmlProjectFile) {
  const segments = normalizePath(file.path).split('/');
  const parent = segments.at(-2)?.trim() || '';
  if (
    parent
    && !GENERIC_FONT_DIRECTORIES.has(normalizeFontFamilyName(parent))
    && !parent.startsWith('.')
  ) return wordsFromFilename(parent) || parent;
  return wordsFromFilename(basename(file.path)) || basename(file.path).replace(/\.[^.]+$/, '');
}

function inferredFamily(file: HtmlProjectFile) {
  return fontBinaryMetadata(file).family || inferredPathFamily(file);
}

function inferredWeight(file: HtmlProjectFile) {
  const metadata = fontBinaryMetadata(file);
  if (metadata.weight) return metadata.weight;
  const value = basename(file.path).replace(/\.[^.]+$/, '').toLowerCase();
  const numeric = value.match(/(?:^|[-_\s])([1-9]00)(?:$|[-_\s])/);
  if (numeric) return numeric[1];
  if (/thin|hairline/.test(value)) return '100';
  if (/(?:extra|ultra)[-_\s]?light/.test(value)) return '200';
  if (/light/.test(value)) return '300';
  if (/book|regular|normal|roman/.test(value)) return '400';
  if (/medium/.test(value)) return '500';
  if (/semi[-_\s]?bold|demi[-_\s]?bold/.test(value)) return '600';
  if (/(?:extra|ultra)[-_\s]?bold/.test(value)) return '800';
  if (/black/.test(value)) return '900';
  if (/heavy|ultra/.test(value)) return '900';
  if (/bold/.test(value)) return '700';
  return '400';
}

function inferredStyle(file: HtmlProjectFile) {
  const metadata = fontBinaryMetadata(file);
  if (metadata.style) return metadata.style;
  return /(?:italic|oblique)/i.test(basename(file.path)) ? 'italic' : 'normal';
}

function keywordFontWeight(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const keywords: Record<string, number> = {
    thin: 100,
    hairline: 100,
    extralight: 200,
    ultralight: 200,
    light: 300,
    normal: 400,
    regular: 400,
    book: 400,
    roman: 400,
    medium: 500,
    semibold: 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    ultrabold: 800,
    black: 900,
    heavy: 900,
  };
  return keywords[normalized];
}

function descriptiveFontWeight(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const numeric = normalized.match(/(?:^|\s)([1-9]\d{1,2}|1000)(?:\s|$)/);
  if (numeric) {
    const weight = Number(numeric[1]);
    if (weight >= 1 && weight <= 1000) return weight;
  }
  if (/thin|hairline/.test(normalized)) return 100;
  if (/(?:extra|ultra)\s*light/.test(normalized)) return 200;
  if (/\blight\b/.test(normalized)) return 300;
  if (/book|regular|normal|roman/.test(normalized)) return 400;
  if (/\bmedium\b/.test(normalized)) return 500;
  if (/(?:semi|demi)\s*bold/.test(normalized)) return 600;
  if (/(?:extra|ultra)\s*bold/.test(normalized)) return 800;
  if (/black|heavy/.test(normalized)) return 900;
  if (/\bbold\b/.test(normalized)) return 700;
  return keywordFontWeight(value);
}

function normalizeFontWeightDescriptor(value: string) {
  const trimmed = value.trim();
  const keyword = keywordFontWeight(trimmed);
  return keyword ? String(keyword) : trimmed || '400';
}

function normalizeFontStyleDescriptor(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return 'normal';
  if (trimmed.startsWith('italic')) return 'italic';
  if (trimmed.startsWith('oblique')) return trimmed;
  return trimmed;
}

function standardWeights(value: string) {
  const numbers = Array.from(value.matchAll(/\b([1-9]00)\b/g), match => Number(match[1]));
  if (numbers.length >= 2) {
    const start = Math.min(numbers[0], numbers[1]);
    const end = Math.max(numbers[0], numbers[1]);
    const result: string[] = [];
    for (let weight = Math.max(100, Math.ceil(start / 100) * 100); weight <= Math.min(900, end); weight += 100) {
      result.push(String(weight));
    }
    return result;
  }
  if (numbers.length) return [String(numbers[0])];
  const exact = Number(value.trim());
  if (Number.isFinite(exact) && exact >= 1 && exact <= 1000) return [String(Math.round(exact))];
  const keyword = keywordFontWeight(value);
  return [String(keyword || 400)];
}

function slug(value: string) {
  return normalizeFontFamilyName(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function binarySignature(data: Uint8Array | undefined) {
  if (!data) return '';
  const cacheKey = data as object;
  const cached = fontBinarySignatureCache.get(cacheKey);
  if (cached) return cached;
  let hash = 2166136261;
  for (let index = 0; index < data.byteLength; index += 1) {
    hash ^= data[index];
    hash = Math.imul(hash, 16777619);
  }
  const signature = `${data.byteLength}:${(hash >>> 0).toString(36)}`;
  fontBinarySignatureCache.set(cacheKey, signature);
  return signature;
}

/**
 * Only font declarations/assets influence this signature. Ordinary HTML/CSS
 * editing therefore does not revoke and recreate every font blob on each
 * visual-control change.
 */
export function projectFontSourceSignature(input: ProjectFontInput) {
  const project = asProject(input);
  const root = projectFontRoot(project);
  const filesCacheKey = project.files as object;
  const cachedByRoot = projectFontSourceSignatureCache.get(filesCacheKey);
  const cached = cachedByRoot?.get(root);
  if (cached) return cached;
  const chunks: string[] = [
    root,
  ];
  Object.values(project.files)
    .filter(file =>
      !isPrivateFontPath(file.path)
      && (
        FONT_FILE_PATTERN.test(file.path)
        || (file.text !== undefined && (STYLE_FILE_PATTERN.test(file.path) || HTML_FILE_PATTERN.test(file.path)))
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach(file => {
      if (FONT_FILE_PATTERN.test(file.path)) {
        chunks.push(`${file.path}:${file.mimeType}:${binarySignature(file.data)}:${file.text?.length || 0}`);
        return;
      }
      // Retain only @font-face-bearing style blocks in the signature. A color,
      // width or text edit must not churn the object URLs.
      const declarations = fontDeclarationSignature(file);
      if (declarations) chunks.push(`${file.path}:${declarations}`);
    });
  const signature = stableHash(chunks.join('|'));
  const nextByRoot = cachedByRoot || new Map<string, string>();
  nextByRoot.set(root, signature);
  if (!cachedByRoot) projectFontSourceSignatureCache.set(filesCacheKey, nextByRoot);
  return signature;
}

function projectFontFamilyUsage(project: HtmlProject) {
  const usage = new Map<string, number>();
  Object.values(project.files)
    .filter(file => !isPrivateFontPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach(file => {
      styleSources(file).forEach(source => {
        let root: postcss.Root;
        try {
          root = postcss.parse(source, { from: file.path });
        } catch {
          return;
        }
        root.walkDecls(/^font-family$/i, declaration => {
          if (
            declaration.parent?.type === 'atrule'
            && declaration.parent.name.toLowerCase() === 'font-face'
          ) return;
          const parsed = valueParser(declaration.value);
          const divider = parsed.nodes.findIndex(node => node.type === 'div');
          const primaryNodes = divider < 0 ? parsed.nodes : parsed.nodes.slice(0, divider);
          const family = unquoteCssValue(valueParser.stringify(primaryNodes))
            || declaration.value.split(',')[0].trim();
          const key = normalizeFontFamilyName(family);
          if (key) usage.set(key, (usage.get(key) || 0) + 1);
        });
      });
    });
  return usage;
}

function fontFaceAliases(face: ProjectFontFace, project: HtmlProject) {
  const aliases = new Set<string>([face.family]);
  face.sources.forEach(source => {
    if (!source.filePath) return;
    const file = project.files[source.filePath];
    if (!file) return;
    const internal = fontBinaryMetadata(file).family;
    if (internal) aliases.add(internal);
    const pathFamily = inferredPathFamily(file);
    if (pathFamily) aliases.add(pathFamily);
  });
  return Array.from(aliases);
}

function projectFontCategory(faces: ProjectFontFace[], project: HtmlProject) {
  let serif = 0;
  let sans = 0;
  faces.forEach(face => {
    face.sources.forEach(source => {
      if (!source.filePath) return;
      const file = project.files[source.filePath];
      const category = file ? fontBinaryMetadata(file).category : '';
      if (category === 'serif') serif += 1;
      if (category === 'sans-serif') sans += 1;
    });
  });
  if (serif > sans) return 'serif';
  return 'sans-serif';
}

export function discoverProjectFonts(input: ProjectFontInput): ProjectFontCatalog {
  const project = asProject(input);
  const root = projectFontRoot(project);
  const filesCacheKey = project.files as object;
  const cachedForFiles = projectFontCatalogByFilesCache.get(filesCacheKey)?.get(root);
  if (cachedForFiles) return cachedForFiles;
  const sourceSignature = projectFontSourceSignature(project);
  if (latestProjectFontCatalogCache?.signature === sourceSignature) {
    return latestProjectFontCatalogCache.catalog;
  }
  const faces: ProjectFontFace[] = [];
  Object.values(project.files)
    .filter(file => !isPrivateFontPath(file.path))
    .forEach(file => {
      styleSources(file).forEach(source => {
        faces.push(...parseFontFaceRules(source, file.path, project));
      });
    });

  const referencedFiles = new Set(
    faces.flatMap(face => face.sources.flatMap(source => source.filePath ? [source.filePath] : [])),
  );
  Object.values(project.files)
    .filter(file =>
      !isPrivateFontPath(file.path)
      && FONT_FILE_PATTERN.test(file.path)
      && !referencedFiles.has(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach(file => {
      const family = inferredFamily(file);
      if (!family) return;
      const extension = file.path.split('.').pop()?.toLowerCase() || '';
      faces.push({
        family,
        sources: [{
          url: file.path,
          filePath: file.path,
          format: mapExtensionToFontFormat(extension) || extension,
        }],
        weight: inferredWeight(file),
        style: inferredStyle(file),
        inferred: true,
      });
    });

  // CSS aliases, internal SFNT names and duplicate asset paths can all refer
  // to the same physical family. Build connected components instead of one
  // exact-string Map so the picker exposes one family with searchable aliases.
  const parents = faces.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const ownerByIdentity = new Map<string, number>();
  faces.forEach((face, index) => {
    const identities = [
      ...fontFaceAliases(face, project)
        .map(alias => `family:${normalizeFontFamilyName(alias)}`)
        .filter(identity => identity !== 'family:'),
      ...face.sources.flatMap(source => source.filePath
        ? [`file:${normalizePath(source.filePath).toLowerCase()}`]
        : /^(?:https?:|data:|blob:|\/\/)/i.test(source.url)
          ? [`url:${source.url}`]
          : []),
    ];
    identities.forEach(identity => {
      const owner = ownerByIdentity.get(identity);
      if (owner === undefined) ownerByIdentity.set(identity, index);
      else union(index, owner);
    });
  });

  const groupFaces = new Map<number, ProjectFontFace[]>();
  faces.forEach((face, index) => {
    const root = find(index);
    groupFaces.set(root, [...(groupFaces.get(root) || []), face]);
  });
  const usage = projectFontFamilyUsage(project);
  const groups = Array.from(groupFaces.values()).map(group => {
    const aliases = new Set(group.flatMap(face => fontFaceAliases(face, project)));
    const candidates = Array.from(new Set(group.map(face => face.family)));
    const family = candidates
      .map((candidate, order) => ({
        candidate,
        order,
        usage: usage.get(normalizeFontFamilyName(candidate)) || 0,
        declared: group.some(face => !face.inferred && face.family === candidate),
      }))
      .sort((left, right) =>
        right.usage - left.usage
        || Number(right.declared) - Number(left.declared)
        || left.order - right.order,
      )[0]?.candidate || candidates[0] || '';
    return { family, aliases, faces: group };
  }).filter(group => Boolean(normalizeFontFamilyName(group.family)));

  const now = '';
  const fonts = groups
    .map<ProjectFont>(group => {
      const weights = Array.from(new Set(group.faces.flatMap(face => standardWeights(face.weight))))
        .sort((left, right) => Number(left) - Number(right));
      const variants = Array.from(new Set(group.faces.flatMap(face => {
        const faceWeights = standardWeights(face.weight);
        return faceWeights.map(weight =>
          /^(?:italic|oblique)/i.test(face.style)
            ? `${weight}italic`
            : weight === '400'
              ? 'regular'
              : weight,
        );
      })));
      const aliases = Array.from(group.aliases)
        .filter(alias =>
          normalizeFontFamilyName(alias) !== normalizeFontFamilyName(group.family),
        )
        .sort((left, right) => left.localeCompare(right));
      const firstSource = group.faces.flatMap(face => face.sources).find(source => source.filePath);
      return {
        id: `project-font-${slug(group.family) || stableHash(group.family)}`,
        name: slug(group.family) || group.family,
        family: group.family,
        type: 'custom',
        variants: variants.length ? variants : ['regular'],
        weights: weights.length ? weights : ['400'],
        category: projectFontCategory(group.faces, project),
        kind: firstSource?.format || null,
        storage_path: firstSource?.filePath || null,
        is_published: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        projectSource: true,
        aliases,
        faces: group.faces,
      };
    })
    .sort((left, right) => left.family.localeCompare(right.family));

  const catalog = {
    fonts,
    faces,
    signature: sourceSignature,
  };
  latestProjectFontCatalogCache = { signature: sourceSignature, catalog };
  const catalogsByRoot = projectFontCatalogByFilesCache.get(filesCacheKey)
    || new Map<string, ProjectFontCatalog>();
  catalogsByRoot.set(root, catalog);
  if (!projectFontCatalogByFilesCache.has(filesCacheKey)) {
    projectFontCatalogByFilesCache.set(filesCacheKey, catalogsByRoot);
  }
  return catalog;
}

function cssString(value: string) {
  return JSON.stringify(value);
}

function browserSourceUrl(
  source: ProjectFontSource,
  project: HtmlProject,
  urlByPath: Map<string, string>,
  objectUrls: string[],
) {
  if (source.filePath) {
    const cached = urlByPath.get(source.filePath);
    if (cached) return cached;
    const file = project.files[source.filePath];
    if (!file || (file.data === undefined && file.text === undefined)) return '';
    const body = file.data !== undefined
      ? new Uint8Array(file.data)
      : new TextEncoder().encode(file.text || '');
    if (
      typeof window === 'undefined'
      || typeof URL === 'undefined'
      || typeof URL.createObjectURL !== 'function'
    ) return '';
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    const url = URL.createObjectURL(new Blob([copy.buffer], {
      type: file.mimeType || 'application/octet-stream',
    }));
    objectUrls.push(url);
    urlByPath.set(source.filePath, url);
    return url;
  }
  return /^(?:https?:|data:|blob:|\/\/)/i.test(source.url) ? source.url : '';
}

/** Creates one lifecycle-owned set of blob URLs and matching @font-face CSS. */
export function createProjectFontRuntime(input: ProjectFontInput): ProjectFontRuntime {
  const project = asProject(input);
  const catalog = discoverProjectFonts(project);
  const objectUrls: string[] = [];
  const urlByPath = new Map<string, string>();
  const emittedFaces = new Set<string>();
  const runtimeFaces = catalog.fonts.flatMap(font =>
    font.faces.flatMap(face =>
      [font.family, ...font.aliases].map(family => ({ ...face, family })),
    ),
  );
  const css = runtimeFaces.flatMap(face => {
    const sources = face.sources.flatMap(source => {
      const url = browserSourceUrl(source, project, urlByPath, objectUrls);
      if (!url) return [];
      return [`url(${cssString(url)})${source.format ? ` format(${cssString(source.format)})` : ''}`];
    });
    if (!sources.length) return [];
    const signature = [
      normalizeFontFamilyName(face.family),
      face.weight,
      face.style,
      face.stretch || '',
      face.unicodeRange || '',
      sources.join(','),
    ].join('|');
    if (emittedFaces.has(signature)) return [];
    emittedFaces.add(signature);
    const declarations = [
      `font-family:${cssString(face.family)}`,
      `src:${sources.join(',')}`,
      `font-weight:${face.weight || '400'}`,
      `font-style:${face.style || 'normal'}`,
      face.stretch ? `font-stretch:${face.stretch}` : '',
      `font-display:${face.display || 'swap'}`,
      face.unicodeRange ? `unicode-range:${face.unicodeRange}` : '',
    ].filter(Boolean);
    return [`@font-face{${declarations.join(';')}}`];
  }).join('\n');
  let revoked = false;
  return {
    ...catalog,
    css,
    objectUrls,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    },
  };
}
