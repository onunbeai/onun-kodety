import { parse } from '@babel/parser';
import { sha256 } from 'js-sha256';
import type { HtmlProject, HtmlProjectFile } from './types';

export const CODED_BUILD_DIRECTORY = 'kodety-build';
export const CODED_BUILD_MANIFEST = '.incode/coded-build.json';

interface CodedBuildManifest {
  version: 1 | 2;
  originals: Record<string, string>;
  generated: string[];
  entrypoints?: string[];
  modules?: Record<string, {
    bytes: number;
    sha256: string;
    dependencies: string[];
  }>;
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

function dirname(value: string) {
  const parts = normalizePath(value).split('/');
  parts.pop();
  return parts.join('/');
}

function splitLocalReference(value: string) {
  const trimmed = value.trim();
  if (
    !trimmed
    || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(trimmed)
    || /^(?:var|env)\s*\(/i.test(trimmed)
  ) return null;
  const suffixIndex = trimmed.search(/[?#]/);
  const encodedPath = suffixIndex >= 0 ? trimmed.slice(0, suffixIndex) : trimmed;
  if (!encodedPath) return null;
  let decodedPath = encodedPath;
  try { decodedPath = decodeURIComponent(encodedPath); }
  catch { /* Preserve a malformed-but-authored URL and try the literal path. */ }
  return {
    path: decodedPath.replaceAll('\\', '/'),
    suffix: suffixIndex >= 0 ? trimmed.slice(suffixIndex) : '',
  };
}

function resolvePath(baseFile: string, relative: string, rootPath: string) {
  const reference = splitLocalReference(relative);
  if (!reference) return null;
  const clean = reference.path;
  const base = clean.startsWith('/') ? rootPath : dirname(baseFile);
  return normalizePath(`${base}/${clean}`);
}

function relativeSpecifier(fromFile: string, toFile: string) {
  const from = dirname(fromFile).split('/').filter(Boolean);
  const to = normalizePath(toFile).split('/').filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const value = `${'../'.repeat(from.length)}${to.join('/')}`;
  return value.startsWith('.') ? value : `./${value}`;
}

/**
 * An A/B variant is authored under `.incode/experiments/<test>/<variant>/
 * project/` but published under `.kodety-experiments/<test>/<variant>/` — two
 * segments shallower. `kodety-build/` stays at the site root, so a document
 * relative specifier computed from the authored path walks up two levels too
 * many and lands outside the theme, where the module 404s.
 */
function publishedDocumentPath(path: string) {
  const normalized = normalizePath(path);
  const variant = normalized.match(
    /^\.incode\/experiments\/([^/]+)\/([^/]+)\/project\/(.+)$/i,
  );
  return variant ? `.kodety-experiments/${variant[1]}/${variant[2]}/${variant[3]}` : normalized;
}

interface ProjectFileLookupIndex {
  byLowerPath: Map<string, string>;
  uniqueSuffix: Map<string, string | null>;
  uniqueBasename: Map<string, string | null>;
}

const projectFileLookupIndexCache = new WeakMap<object, ProjectFileLookupIndex>();

function projectFileLookupIndex(files: Record<string, HtmlProjectFile>) {
  const cacheKey = files as object;
  const cached = projectFileLookupIndexCache.get(cacheKey);
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
    const lowerPath = path.toLowerCase();
    if (!byLowerPath.has(lowerPath)) byLowerPath.set(lowerPath, path);
    if (path.startsWith('.incode/') || path.startsWith(`${CODED_BUILD_DIRECTORY}/`)) return;
    const normalized = normalizePath(path).toLowerCase();
    const parts = normalized.split('/').filter(Boolean);
    parts.forEach((_, index) => addUnique(uniqueSuffix, parts.slice(index).join('/'), path));
    addUnique(uniqueBasename, parts.at(-1) || '', path);
  });
  const index = { byLowerPath, uniqueSuffix, uniqueBasename };
  projectFileLookupIndexCache.set(cacheKey, index);
  return index;
}

function fileByPath(files: Record<string, HtmlProjectFile>, requested: string) {
  if (files[requested]) return { path: requested, file: files[requested] };
  const path = projectFileLookupIndex(files).byLowerPath.get(requested.toLowerCase());
  return path ? { path, file: files[path] } : null;
}

function packageRoot(specifier: string) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function exactVersion(value: unknown) {
  const match = String(value || '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] || '';
}

export function projectDependencyVersions(project: HtmlProject) {
  const result: Record<string, string> = {};
  const rootPrefix = project.rootPath ? `${normalizePath(project.rootPath)}/` : '';
  const packageFile = fileByPath(project.files, `${rootPrefix}package.json`)
    || fileByPath(project.files, 'package.json');
  if (packageFile?.file.text) {
    try {
      const parsed = JSON.parse(packageFile.file.text) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      Object.entries({ ...parsed.devDependencies, ...parsed.dependencies }).forEach(([name, version]) => {
        const exact = exactVersion(version);
        if (exact) result[name] = exact;
      });
    } catch { /* malformed package metadata: unpinned CDN resolution remains available */ }
  }
  const lockFile = fileByPath(project.files, `${rootPrefix}package-lock.json`)
    || fileByPath(project.files, 'package-lock.json');
  if (lockFile?.file.text) {
    try {
      const parsed = JSON.parse(lockFile.file.text) as {
        packages?: Record<string, { version?: unknown }>;
        dependencies?: Record<string, { version?: unknown }>;
      };
      Object.entries(parsed.packages || {}).forEach(([path, entry]) => {
        const marker = 'node_modules/';
        const index = path.lastIndexOf(marker);
        if (index < 0) return;
        const name = path.slice(index + marker.length);
        if (!name || name.includes('/node_modules/')) return;
        const exact = exactVersion(entry?.version);
        if (exact) result[name] = exact;
      });
      Object.entries(parsed.dependencies || {}).forEach(([name, entry]) => {
        const exact = exactVersion(entry?.version);
        if (exact) result[name] = exact;
      });
    } catch { /* package.json versions are still usable */ }
  }
  return result;
}

export function isBareModuleSpecifier(specifier: string) {
  return Boolean(
    specifier
    && !specifier.startsWith('.')
    && !specifier.startsWith('/')
    && !/^(?:https?:|data:|blob:|#|node:)/i.test(specifier),
  );
}

export function moduleCdnUrl(specifier: string, versions: Record<string, string>) {
  const root = packageRoot(specifier);
  const subpath = specifier.slice(root.length);
  const version = versions[root];
  return `https://esm.sh/${root}${version ? `@${version}` : ''}${subpath}?bundle`;
}

/** Vite projects may relocate the static web root via `publicDir` (e.g.
 * `publicDir: "sequencia de imagem"`). The configuration file is authored
 * JavaScript, so only a literal string assignment can be honored statically;
 * anything else falls back to the conventional `public/` directory, which is
 * always tried as well. */
export function projectPublicDirectoryNames(project: HtmlProject): string[] {
  const names = new Set<string>(['public']);
  const rootPrefix = project.rootPath ? `${normalizePath(project.rootPath)}/` : '';
  ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.mts'].forEach(name => {
    const file = fileByPath(project.files, `${rootPrefix}${name}`) || fileByPath(project.files, name);
    const text = file?.file.text;
    if (!text) return;
    const match = text.match(/\bpublicDir\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/);
    const value = match ? normalizePath(match[2]) : '';
    if (value && value !== '.') names.add(value);
  });
  return Array.from(names);
}

export function projectPublicFilePath(project: HtmlProject, requestedPath: string) {
  const reference = splitLocalReference(requestedPath);
  const requested = normalizePath((reference?.path || requestedPath).replace(/^\/+/, ''));
  const root = normalizePath(project.previewRootPath ?? project.rootPath ?? '');
  const requestedLower = requested.toLowerCase();
  const rootLower = root.toLowerCase();
  const relative = root && requestedLower.startsWith(`${rootLower}/`)
    ? requested.slice(root.length + 1)
    : requested;
  const candidates = [
    requested,
    root && !requestedLower.startsWith(`${rootLower}/`) ? `${root}/${requested}` : '',
    ...projectPublicDirectoryNames(project).flatMap(directory => [
      `${root ? `${root}/` : ''}${directory}/${relative}`,
      `${directory}/${relative}`,
    ]),
  ].map(normalizePath).filter(Boolean);
  for (const candidate of new Set(candidates)) {
    const match = fileByPath(project.files, candidate);
    if (match) return match.path;
  }

  // A/B variants use copy-on-write for binary files. Their authored document
  // still resolves under `.incode/experiments/.../project/`, but an inherited
  // image/font/video/archive exists only once at its normal public path. Try
  // that exact overlay before the generic suffix/basename recovery below;
  // text files never fall back, so deleting a private stylesheet or script
  // cannot silently expose Control's implementation.
  const variantOverlay = requested.match(
    /^\.incode\/experiments\/[^/]+\/[^/]+\/project\/(.+)$/i,
  );
  if (variantOverlay) {
    const publicRequested = normalizePath(variantOverlay[1]);
    const publicRoot = normalizePath(project.rootPath || '');
    const publicRootLower = publicRoot.toLowerCase();
    const publicRelative = publicRoot
      && publicRequested.toLowerCase().startsWith(`${publicRootLower}/`)
      ? publicRequested.slice(publicRoot.length + 1)
      : publicRequested;
    const overlayCandidates = [
      publicRequested,
      publicRoot && !publicRequested.toLowerCase().startsWith(`${publicRootLower}/`)
        ? `${publicRoot}/${publicRequested}`
        : '',
      ...projectPublicDirectoryNames(project).flatMap(directory => [
        `${publicRoot ? `${publicRoot}/` : ''}${directory}/${publicRelative}`,
        `${directory}/${publicRelative}`,
      ]),
    ].map(normalizePath).filter(Boolean);
    for (const candidate of new Set(overlayCandidates)) {
      const match = fileByPath(project.files, candidate);
      if (match && match.file.text === undefined) return match.path;
    }
  }

  // Archives and folder pickers do not agree on whether their outer directory
  // is part of each relative path. A unique suffix (and, as a final recovery,
  // a unique basename) lets the same authored reference survive ZIP, folder,
  // drag/drop and reopened WordPress workspace transports without mutating the
  // user's source tree. Ambiguous matches are deliberately left unresolved.
  const fileIndex = projectFileLookupIndex(project.files);
  const suffixes = Array.from(new Set([relative, requested]))
    .map(value => normalizePath(value).toLowerCase())
    .filter(value => value.includes('/'));
  for (const suffix of suffixes) {
    const match = fileIndex.uniqueSuffix.get(suffix);
    if (match) return match;
  }
  const basename = requested.split('/').pop()?.toLowerCase() || '';
  if (!basename) return null;
  return fileIndex.uniqueBasename.get(basename) || null;
}

function publishedAssetPath(project: HtmlProject, sourcePath: string) {
  const root = normalizePath(project.rootPath);
  for (const directory of projectPublicDirectoryNames(project)) {
    const publicPrefix = `${root ? `${root}/` : ''}${directory}/`;
    if (sourcePath.toLowerCase().startsWith(publicPrefix.toLowerCase())) {
      return normalizePath(`${root ? `${root}/` : ''}${sourcePath.slice(publicPrefix.length)}`);
    }
  }
  return normalizePath(sourcePath);
}

function rewriteLocalReference(
  project: HtmlProject,
  fromFile: string,
  value: string,
) {
  const reference = splitLocalReference(value);
  if (!reference) return value;
  const resolved = resolvePath(fromFile, reference.path, project.rootPath);
  const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
  if (!canonical) return value;
  return `${relativeSpecifier(fromFile, publishedAssetPath(project, canonical))}${reference.suffix}`;
}

function rewriteSrcset(
  project: HtmlProject,
  fromFile: string,
  value: string,
) {
  // A data URL contains a significant comma and cannot be split as an ordinary
  // srcset candidate. It is already self-contained, so leave it untouched.
  if (/(?:^|,\s*)data:/i.test(value)) return value;
  return value.split(',').map(candidate => {
    const trimmed = candidate.trim();
    if (!trimmed) return trimmed;
    const parts = trimmed.split(/\s+/);
    const url = parts.shift() || '';
    return [rewriteLocalReference(project, fromFile, url), ...parts].join(' ');
  }).join(', ');
}

function rewriteCssAssetReferences(
  project: HtmlProject,
  cssPath: string,
  css: string,
) {
  let rewritten = css.replace(
    /url\(\s*(["']?)(.*?)\1\s*\)/gi,
    (match, quote: string, value: string) => {
      const next = rewriteLocalReference(project, cssPath, value.trim());
      return next === value.trim() ? match : `url(${quote}${next}${quote})`;
    },
  );
  rewritten = rewritten.replace(
    /(@import\s+)(["'])([^"']+)\2/gi,
    (match, before: string, quote: string, value: string) => {
      const next = rewriteLocalReference(project, cssPath, value);
      return next === value ? match : `${before}${quote}${next}${quote}`;
    },
  );
  return rewritten;
}

function rewriteMarkupAssetReferences(
  project: HtmlProject,
  markupPath: string,
  markup: string,
) {
  const rawPayloads: string[] = [];
  let rewritten = markup.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (_match, attributes: string, css: string) =>
      `<style${attributes}>${rewriteCssAssetReferences(project, markupPath, css)}</style>`,
  );
  rewritten = rewritten.replace(
    /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
    payload => {
      const marker = `___KODETY_CODED_RAW_${rawPayloads.length}___`;
      rawPayloads.push(payload);
      return marker;
    },
  );
  rewritten = rewritten.replace(/<meta\b[^>]*>/gi, tag => {
    if (!/\b(?:property|name|itemprop)\s*=\s*(["'])(?:og:image(?::url)?|twitter:image(?::src)?|image|logo|thumbnail)\1/i.test(tag)) {
      return tag;
    }
    return tag.replace(
      /\bcontent\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i,
      (match, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
        const value = quoted ?? bare ?? '';
        const next = rewriteLocalReference(project, markupPath, value);
        if (next === value) return match;
        return `content=${quote || '"'}${next}${quote || '"'}`;
      },
    );
  });

  const srcsetAttributes = [
    'data-lazy-srcset',
    'data-srcset',
    'imagesrcset',
    'srcset',
  ].join('|');
  rewritten = rewritten.replace(
    new RegExp(`\\b(${srcsetAttributes})\\s*=\\s*(?:(["'])(.*?)\\2|([^\\s>]+))`, 'gi'),
    (match, name: string, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
      const value = quoted ?? bare ?? '';
      const next = rewriteSrcset(project, markupPath, value);
      if (next === value) return match;
      return `${name}=${quote || '"'}${next}${quote || '"'}`;
    },
  );

  const assetAttributes = [
    'data-poster-url',
    'data-original-src',
    'data-lazy-src',
    'data-original',
    'data-src',
    'xlink:href',
    'formaction',
    'poster',
    'action',
    'href',
    'src',
    'data',
  ].join('|');
  rewritten = rewritten.replace(
    new RegExp(`\\b(${assetAttributes})\\s*=\\s*(?:(["'])(.*?)\\2|([^\\s>]+))`, 'gi'),
    (match, name: string, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
      const value = quoted ?? bare ?? '';
      const next = rewriteLocalReference(project, markupPath, value);
      if (next === value) return match;
      return `${name}=${quote || '"'}${next}${quote || '"'}`;
    },
  );
  rewritten = rewritten.replace(
    /\bstyle\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi,
    (match, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
      const value = quoted ?? bare ?? '';
      const next = rewriteCssAssetReferences(project, markupPath, value);
      if (next === value) return match;
      return `style=${quote || '"'}${next}${quote || '"'}`;
    },
  );
  rawPayloads.forEach((payload, index) => {
    rewritten = rewritten.replace(`___KODETY_CODED_RAW_${index}___`, payload);
  });
  return rewritten;
}

interface JavaScriptLexicalToken {
  kind: 'identifier' | 'string' | 'literal' | 'punctuator';
  value: string;
  start: number;
  end: number;
  depth: number;
  quote?: '"' | "'" | '`';
  valueStart?: number;
  valueEnd?: number;
  closesControl?: boolean;
  closesBlock?: boolean;
}

interface ModuleSpecifierOccurrence {
  kind: 'import' | 'export' | 'dynamic-import';
  specifier: string;
  start: number;
  end: number;
  quote: '"' | "'" | '`';
  declarationStart?: number;
  declarationEnd?: number;
  sideEffectOnly?: boolean;
  defaultBinding?: string;
}

function isJavaScriptIdentifierStart(character: string | undefined) {
  if (!character) return false;
  const codePoint = character.codePointAt(0) || 0;
  return /[A-Za-z_$]/.test(character) || codePoint > 0x7f;
}

function isJavaScriptIdentifierPart(character: string | undefined) {
  return isJavaScriptIdentifierStart(character) || Boolean(character && /[0-9]/.test(character));
}

function scanQuotedJavaScriptString(code: string, start: number) {
  const quote = code[start];
  let cursor = start + 1;
  while (cursor < code.length) {
    const character = code[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    cursor++;
    if (character === quote) return { end: cursor, closed: true };
    if (character === '\n' || character === '\r') break;
  }
  return { end: cursor, closed: false };
}

function scanJavaScriptRegexLiteral(code: string, start: number) {
  let cursor = start + 1;
  let inCharacterClass = false;
  while (cursor < code.length) {
    const character = code[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '\n' || character === '\r') return null;
    if (character === '[') inCharacterClass = true;
    else if (character === ']') inCharacterClass = false;
    else if (character === '/' && !inCharacterClass) {
      cursor++;
      while (isJavaScriptIdentifierPart(code[cursor])) cursor++;
      return cursor;
    }
    cursor++;
  }
  return null;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

function canStartJavaScriptRegex(previous: JavaScriptLexicalToken | undefined) {
  if (!previous) return true;
  if (previous.kind === 'identifier') return REGEX_PREFIX_KEYWORDS.has(previous.value);
  if (previous.kind === 'string' || previous.kind === 'literal') return false;
  if (previous.value === ')') return Boolean(previous.closesControl);
  if (previous.value === '}') return Boolean(previous.closesBlock);
  if (previous.value === ']' || previous.value === '.' || previous.value === '?.') return false;
  if (previous.value === '++' || previous.value === '--') return false;
  return true;
}

/** Skip an interpolated template as one lexical unit while retaining the
 * boundaries of its executable `${...}` expressions. Raw template text must
 * remain opaque, but real dynamic imports inside an expression are scanned in
 * a second pass. */
function scanJavaScriptTemplateLiteral(code: string, start: number): {
  end: number;
  closed: boolean;
  hasInterpolation: boolean;
  expressionRanges: Array<{ start: number; end: number }>;
} {
  let cursor = start + 1;
  let hasInterpolation = false;
  const expressionRanges: Array<{ start: number; end: number }> = [];
  while (cursor < code.length) {
    const character = code[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (character === '`') {
      return {
        end: cursor + 1,
        closed: true,
        hasInterpolation,
        expressionRanges,
      };
    }
    if (character !== '$' || code[cursor + 1] !== '{') {
      cursor++;
      continue;
    }

    hasInterpolation = true;
    cursor += 2;
    const expressionStart = cursor;
    let braceDepth = 1;
    let previous: JavaScriptLexicalToken | undefined;
    while (cursor < code.length && braceDepth > 0) {
      const expressionCharacter = code[cursor];
      if (/\s/.test(expressionCharacter)) {
        cursor++;
        continue;
      }
      if (expressionCharacter === '/' && code[cursor + 1] === '/') {
        const newline = code.indexOf('\n', cursor + 2);
        cursor = newline < 0 ? code.length : newline + 1;
        continue;
      }
      if (expressionCharacter === '/' && code[cursor + 1] === '*') {
        const close = code.indexOf('*/', cursor + 2);
        cursor = close < 0 ? code.length : close + 2;
        continue;
      }
      if (expressionCharacter === '"' || expressionCharacter === "'") {
        const scanned = scanQuotedJavaScriptString(code, cursor);
        previous = {
          kind: 'string',
          value: '',
          start: cursor,
          end: scanned.end,
          depth: 0,
        };
        cursor = scanned.end;
        continue;
      }
      if (expressionCharacter === '`') {
        const nested = scanJavaScriptTemplateLiteral(code, cursor);
        previous = {
          kind: 'literal',
          value: '',
          start: cursor,
          end: nested.end,
          depth: 0,
        };
        cursor = nested.end;
        continue;
      }
      if (expressionCharacter === '/' && canStartJavaScriptRegex(previous)) {
        const regexEnd = scanJavaScriptRegexLiteral(code, cursor);
        if (regexEnd !== null) {
          previous = {
            kind: 'literal',
            value: '',
            start: cursor,
            end: regexEnd,
            depth: 0,
          };
          cursor = regexEnd;
          continue;
        }
      }
      if (isJavaScriptIdentifierStart(expressionCharacter)) {
        const tokenStart = cursor++;
        while (isJavaScriptIdentifierPart(code[cursor])) cursor++;
        previous = {
          kind: 'identifier',
          value: code.slice(tokenStart, cursor),
          start: tokenStart,
          end: cursor,
          depth: 0,
        };
        continue;
      }
      if (/[0-9]/.test(expressionCharacter)) {
        const tokenStart = cursor++;
        while (cursor < code.length && /[0-9A-Za-z_.]/.test(code[cursor])) cursor++;
        previous = {
          kind: 'literal',
          value: code.slice(tokenStart, cursor),
          start: tokenStart,
          end: cursor,
          depth: 0,
        };
        continue;
      }
      if (expressionCharacter === '{') braceDepth++;
      else if (expressionCharacter === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          expressionRanges.push({ start: expressionStart, end: cursor });
          cursor++;
          break;
        }
      }
      const punctuator = code.slice(cursor, cursor + 2);
      const width = ['++', '--', '?.', '=>'].includes(punctuator) ? 2 : 1;
      previous = {
        kind: 'punctuator',
        value: code.slice(cursor, cursor + width),
        start: cursor,
        end: cursor + width,
        depth: 0,
      };
      cursor += width;
    }
  }
  return {
    end: cursor,
    closed: false,
    hasInterpolation,
    expressionRanges,
  };
}

function tokenizeJavaScriptForModules(code: string) {
  const tokens: JavaScriptLexicalToken[] = [];
  const templateExpressionRanges: Array<{ start: number; end: number }> = [];
  const parenContexts: boolean[] = [];
  const braceContexts: boolean[] = [];
  const controlKeywords = new Set(['catch', 'for', 'if', 'switch', 'while', 'with']);
  const blockPrefixKeywords = new Set(['do', 'else', 'finally', 'try']);
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let cursor = 0;
  let previous: JavaScriptLexicalToken | undefined;

  const currentDepth = () => parenDepth + bracketDepth + braceDepth;
  const add = (token: JavaScriptLexicalToken) => {
    tokens.push(token);
    previous = token;
  };

  while (cursor < code.length) {
    const character = code[cursor];
    if (/\s/.test(character)) {
      cursor++;
      continue;
    }
    if (character === '/' && code[cursor + 1] === '/') {
      const newline = code.indexOf('\n', cursor + 2);
      cursor = newline < 0 ? code.length : newline + 1;
      continue;
    }
    if (character === '/' && code[cursor + 1] === '*') {
      const close = code.indexOf('*/', cursor + 2);
      cursor = close < 0 ? code.length : close + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const start = cursor;
      const scanned = scanQuotedJavaScriptString(code, start);
      if (scanned.closed) {
        add({
          kind: 'string',
          value: code.slice(start + 1, scanned.end - 1),
          start,
          end: scanned.end,
          valueStart: start + 1,
          valueEnd: scanned.end - 1,
          quote: character,
          depth: currentDepth(),
        });
      } else {
        add({
          kind: 'literal',
          value: code.slice(start, scanned.end),
          start,
          end: scanned.end,
          depth: currentDepth(),
        });
      }
      cursor = scanned.end;
      continue;
    }
    if (character === '`') {
      const start = cursor;
      const scanned = scanJavaScriptTemplateLiteral(code, start);
      templateExpressionRanges.push(...scanned.expressionRanges);
      if (scanned.closed && !scanned.hasInterpolation) {
        add({
          kind: 'string',
          value: code.slice(start + 1, scanned.end - 1),
          start,
          end: scanned.end,
          valueStart: start + 1,
          valueEnd: scanned.end - 1,
          quote: '`',
          depth: currentDepth(),
        });
      } else {
        add({
          kind: 'literal',
          value: code.slice(start, scanned.end),
          start,
          end: scanned.end,
          depth: currentDepth(),
        });
      }
      cursor = scanned.end;
      continue;
    }
    if (character === '/' && canStartJavaScriptRegex(previous)) {
      const regexEnd = scanJavaScriptRegexLiteral(code, cursor);
      if (regexEnd !== null) {
        add({
          kind: 'literal',
          value: code.slice(cursor, regexEnd),
          start: cursor,
          end: regexEnd,
          depth: currentDepth(),
        });
        cursor = regexEnd;
        continue;
      }
    }
    if (isJavaScriptIdentifierStart(character)) {
      const start = cursor++;
      while (isJavaScriptIdentifierPart(code[cursor])) cursor++;
      add({
        kind: 'identifier',
        value: code.slice(start, cursor),
        start,
        end: cursor,
        depth: currentDepth(),
      });
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = cursor++;
      while (cursor < code.length && /[0-9A-Za-z_.]/.test(code[cursor])) cursor++;
      add({
        kind: 'literal',
        value: code.slice(start, cursor),
        start,
        end: cursor,
        depth: currentDepth(),
      });
      continue;
    }

    if (character === ')' && parenDepth > 0) parenDepth--;
    if (character === ']' && bracketDepth > 0) bracketDepth--;
    if (character === '}' && braceDepth > 0) braceDepth--;
    const pair = code.slice(cursor, cursor + 2);
    const width = ['++', '--', '?.', '=>'].includes(pair) ? 2 : 1;
    const token: JavaScriptLexicalToken = {
      kind: 'punctuator',
      value: code.slice(cursor, cursor + width),
      start: cursor,
      end: cursor + width,
      depth: currentDepth(),
    };
    if (character === ')') token.closesControl = parenContexts.pop() || false;
    if (character === '}') token.closesBlock = braceContexts.pop() || false;
    add(token);
    cursor += width;

    if (character === '(') {
      const before = tokens[tokens.length - 2];
      parenContexts.push(Boolean(
        before?.kind === 'identifier' && controlKeywords.has(before.value),
      ));
      parenDepth++;
    } else if (character === '[') {
      bracketDepth++;
    } else if (character === '{') {
      const before = tokens[tokens.length - 2];
      braceContexts.push(Boolean(
        !before
        || before.closesControl
        || before.value === '=>'
        || before.value === ';'
        || (before.kind === 'identifier' && blockPrefixKeywords.has(before.value))
        || before.value === ')',
      ));
      braceDepth++;
    }
  }
  return { tokens, templateExpressionRanges };
}

function moduleDeclarationEnd(
  tokens: JavaScriptLexicalToken[],
  sourceIndex: number,
  baseDepth: number,
) {
  const source = tokens[sourceIndex];
  let end = source.end;
  let cursor = sourceIndex + 1;
  const attribute = tokens[cursor];
  if (
    attribute?.kind === 'identifier'
    && attribute.depth === baseDepth
    && (attribute.value === 'assert' || attribute.value === 'with')
  ) {
    end = attribute.end;
    cursor++;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.depth < baseDepth) break;
      end = token.end;
      cursor++;
      if (token.value === '}' && token.depth === baseDepth) break;
    }
  }
  const semicolon = tokens[cursor];
  if (semicolon?.value === ';' && semicolon.depth === baseDepth) end = semicolon.end;
  return end;
}

function scanModuleSpecifiers(
  code: string,
  allowStaticDeclarations = true,
): ModuleSpecifierOccurrence[] {
  const { tokens, templateExpressionRanges } = tokenizeJavaScriptForModules(code);
  const occurrences: ModuleSpecifierOccurrence[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const keyword = tokens[index];
    if (
      keyword.kind !== 'identifier'
      || (keyword.value !== 'import' && keyword.value !== 'export')
    ) continue;
    const previous = tokens[index - 1];
    if (previous?.value === '.' || previous?.value === '?.') continue;
    const next = tokens[index + 1];

    if (keyword.value === 'import' && next?.value === '(') {
      const source = tokens[index + 2];
      if (
        source?.kind === 'string'
        && source.valueStart !== undefined
        && source.valueEnd !== undefined
        && source.quote
      ) {
        occurrences.push({
          kind: 'dynamic-import',
          specifier: source.value,
          start: source.valueStart,
          end: source.valueEnd,
          quote: source.quote,
        });
      }
      continue;
    }
    if (
      !allowStaticDeclarations
      || keyword.depth !== 0
      || !next
      || next.value === '.'
    ) continue;

    if (
      keyword.value === 'import'
      && next.kind === 'string'
      && next.quote !== '`'
      && next.valueStart !== undefined
      && next.valueEnd !== undefined
      && next.quote
    ) {
      occurrences.push({
        kind: 'import',
        specifier: next.value,
        start: next.valueStart,
        end: next.valueEnd,
        quote: next.quote,
        declarationStart: keyword.start,
        declarationEnd: moduleDeclarationEnd(tokens, index + 1, keyword.depth),
        sideEffectOnly: true,
      });
      continue;
    }

    let sourceIndex = -1;
    for (let cursor = index + 1; cursor < tokens.length; cursor++) {
      const token = tokens[cursor];
      if (token.depth < keyword.depth) break;
      if (token.value === ';' && token.depth === keyword.depth) break;
      if (
        token.kind === 'identifier'
        && token.value === 'from'
        && token.depth === keyword.depth
      ) {
        const source = tokens[cursor + 1];
        if (source?.kind === 'string' && source.quote !== '`') sourceIndex = cursor + 1;
        break;
      }
    }
    if (sourceIndex < 0) continue;
    const source = tokens[sourceIndex];
    if (
      source.valueStart === undefined
      || source.valueEnd === undefined
      || !source.quote
    ) continue;
    const bindingTokens = tokens.slice(index + 1, sourceIndex - 1);
    const defaultBinding = keyword.value === 'import'
      && bindingTokens.length === 1
      && bindingTokens[0].kind === 'identifier'
      ? bindingTokens[0].value
      : undefined;
    occurrences.push({
      kind: keyword.value,
      specifier: source.value,
      start: source.valueStart,
      end: source.valueEnd,
      quote: source.quote,
      declarationStart: keyword.start,
      declarationEnd: moduleDeclarationEnd(tokens, sourceIndex, keyword.depth),
      defaultBinding,
    });
  }
  templateExpressionRanges.forEach(range => {
    scanModuleSpecifiers(code.slice(range.start, range.end), false).forEach(occurrence => {
      occurrences.push({
        ...occurrence,
        start: occurrence.start + range.start,
        end: occurrence.end + range.start,
        declarationStart: occurrence.declarationStart === undefined
          ? undefined
          : occurrence.declarationStart + range.start,
        declarationEnd: occurrence.declarationEnd === undefined
          ? undefined
          : occurrence.declarationEnd + range.start,
      });
    });
  });
  return occurrences.sort((left, right) => left.start - right.start);
}

/** Rewrite only parsed ESM specifiers, leaving comments, string literals,
 * regular expressions and template raw text byte-identical. This is also used
 * by the Code Component materializer to migrate compatibility facades in
 * already-compiled browser modules without re-running user source. */
export function rewriteJavaScriptModuleSpecifierAliases(
  code: string,
  aliases: Readonly<Record<string, string>>,
) {
  const replacements = scanModuleSpecifiers(code).flatMap(occurrence => {
    const replacement = aliases[occurrence.specifier];
    if (replacement === undefined || replacement === occurrence.specifier) return [];
    if (!replacement || /[\\\0\r\n"'`]/.test(replacement)) {
      throw new Error(`O alias de módulo para “${occurrence.specifier}” não é um specifier literal seguro.`);
    }
    return [{ start: occurrence.start, end: occurrence.end, value: replacement }];
  });
  if (!replacements.length) return code;
  let rewritten = code;
  replacements.sort((left, right) => right.start - left.start).forEach(replacement => {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
  });
  return rewritten;
}

function moduleImports(code: string) {
  return scanModuleSpecifiers(code).map(occurrence => occurrence.specifier);
}

function reachableStylesheets(
  project: HtmlProject,
  modulePaths: string[],
  entryPaths: string[],
) {
  const moduleSet = new Set(modulePaths);
  const visited = new Set<string>();
  const styles = new Set<string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const code = project.files[path]?.text || '';
    moduleImports(code).forEach(specifier => {
      if (isBareModuleSpecifier(specifier)) return;
      const resolved = resolvePath(path, specifier, project.rootPath);
      const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
      if (!canonical) return;
      if (/\.css$/i.test(canonical)) styles.add(canonical);
      else if (moduleSet.has(canonical)) visit(canonical);
    });
  };
  entryPaths.forEach(visit);
  return Array.from(styles);
}

function generatedModuleGraph(
  project: HtmlProject,
  modulePaths: string[],
  entryPaths: string[],
) {
  const moduleSet = new Set(modulePaths);
  const dependencies = new Map<string, string[]>();
  Array.from(moduleSet).sort().forEach(path => {
    const localDependencies = Array.from(new Set(
      moduleImports(project.files[path]?.text || '').flatMap(specifier => {
        if (isBareModuleSpecifier(specifier)) return [];
        const reference = splitLocalReference(specifier);
        if (!reference) return [];
        const resolved = resolvePath(path, specifier, project.rootPath);
        const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
        if (canonical && moduleSet.has(canonical)) return [canonical];
        if (
          canonical
          || /\.css$/i.test(reference.path)
          || looksLikeAssetReference(reference.path)
        ) return [];
        throw new Error(
          `O grafo JavaScript está incompleto: ${path} referencia ${specifier}, que não existe no projeto. Nada foi publicado.`,
        );
      }),
    )).sort();
    dependencies.set(path, localDependencies);
  });
  const entries = Array.from(new Set(entryPaths))
    .filter(path => moduleSet.has(path))
    .sort();
  return { entries, dependencies };
}

function assertBrowserModuleSyntax(path: string, code: string) {
  try {
    parse(code, {
      sourceType: 'module',
      errorRecovery: false,
      allowAwaitOutsideFunction: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/\s*\(\d+:\d+\)\s*$/, '') : '';
    throw new Error(
      `O JavaScript gerado está malformado em ${path}${detail ? `: ${detail}` : ''}. Nada foi publicado.`,
    );
  }
}

function moduleAssetExpression(
  project: HtmlProject,
  modulePath: string,
  buildPath: string,
  value: string,
) {
  const reference = splitLocalReference(value);
  if (!reference) return null;
  const resolved = resolvePath(modulePath, reference.path, project.rootPath);
  const sourcePath = resolved ? projectPublicFilePath(project, resolved) : null;
  if (!sourcePath) return null;
  const publishedPath = publishedAssetPath(project, sourcePath);
  return `new URL(${JSON.stringify(`${relativeSpecifier(buildPath, publishedPath)}${reference.suffix}`)}, import.meta.url).href`;
}

function rewriteModuleTemplateAssets(
  project: HtmlProject,
  modulePath: string,
  buildPath: string,
  code: string,
) {
  return code.replace(/`(?:\\[\s\S]|[^`])*`/g, template => {
    let rewritten = template.replace(
      /\b(src|poster|data-src|data-lazy-src|data-original|data-poster-url)\s*=\s*(["'])([^"']+)\2/gi,
      (match, name: string, quote: string, value: string) => {
        const expression = moduleAssetExpression(project, modulePath, buildPath, value);
        return expression ? `${name}=${quote}\${${expression}}${quote}` : match;
      },
    );
    rewritten = rewritten.replace(
      /\b(srcset|data-srcset|data-lazy-srcset)\s*=\s*(["'])([^"']+)\2/gi,
      (match, name: string, quote: string, value: string) => {
        if (/(?:^|,\s*)data:/i.test(value)) return match;
        let changed = false;
        const candidates = value.split(',').map(candidate => {
          const parts = candidate.trim().split(/\s+/);
          const url = parts.shift() || '';
          const expression = moduleAssetExpression(project, modulePath, buildPath, url);
          if (!expression) return candidate.trim();
          changed = true;
          return `\${${expression}}${parts.length ? ` ${parts.join(' ')}` : ''}`;
        });
        return changed ? `${name}=${quote}${candidates.join(', ')}${quote}` : match;
      },
    );
    return rewritten;
  });
}

function looksLikeAssetReference(value: string) {
  const reference = splitLocalReference(value);
  return Boolean(
    reference
    && /\.(?:avif|gif|jpe?g|png|webp|svg|ico|bmp|tiff?|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac|woff2?|eot|ttf|otf|pdf|wasm|json|webmanifest)$/i.test(reference.path),
  );
}

function htmlAttributeValue(attributes: string, name: string) {
  const match = attributes.match(new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s"'=<>]+))`,
    'i',
  ));
  return match ? (match[2] ?? match[3] ?? '') : null;
}

function importMapKeys(value: unknown) {
  const keys = new Set<string>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return keys;
  const map = value as Record<string, unknown>;
  const collect = (imports: unknown) => {
    if (!imports || typeof imports !== 'object' || Array.isArray(imports)) return;
    Object.keys(imports as Record<string, unknown>).forEach(key => keys.add(key));
  };
  collect(map.imports);
  if (map.scopes && typeof map.scopes === 'object' && !Array.isArray(map.scopes)) {
    Object.values(map.scopes as Record<string, unknown>).forEach(collect);
  }
  return keys;
}

interface BrowserModulePage {
  entryPaths: string[];
  importMapKeys: Set<string>;
}

/** Read only authored external module entries. Inline modules are deliberately
 * excluded because the coded-project compiler does not transform their source. */
function browserModulePages(project: HtmlProject): BrowserModulePage[] {
  return Object.values(project.files)
    .filter(file => /\.html?$/i.test(file.path) && file.text !== undefined)
    .map(file => {
      const scripts: Array<{ attributes: string; body: string }> = [];
      const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(file.text || ''))) {
        scripts.push({ attributes: match[1] || '', body: match[2] || '' });
      }
      const mapped = new Set<string>();
      scripts.forEach(script => {
        if ((htmlAttributeValue(script.attributes, 'type') || '').toLowerCase() !== 'importmap') return;
        try {
          importMapKeys(JSON.parse(script.body)).forEach(key => mapped.add(key));
        } catch {
          // An invalid import map is authored runtime state. It is not evidence
          // that Kodety should rewrite an otherwise browser-owned module graph.
        }
      });
      const entryPaths = scripts.flatMap(script => {
        if ((htmlAttributeValue(script.attributes, 'type') || '').toLowerCase() !== 'module') return [];
        const source = htmlAttributeValue(script.attributes, 'src');
        if (!source || !splitLocalReference(source)) return [];
        const resolved = resolvePath(file.path, source, project.rootPath);
        const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
        return canonical && /\.(?:m?js)$/i.test(canonical) ? [canonical] : [];
      });
      return { entryPaths, importMapKeys: mapped };
    })
    .filter(page => page.entryPaths.length > 0);
}

function importMapResolves(specifier: string, keys: Set<string>) {
  return keys.has(specifier) || Array.from(keys).some(
    key => key.endsWith('/') && specifier.startsWith(key),
  );
}

function occurrenceUsesNativeType(
  code: string,
  occurrence: ModuleSpecifierOccurrence,
  type: string,
) {
  if (occurrence.declarationStart === undefined || occurrence.declarationEnd === undefined) return false;
  const declaration = code.slice(occurrence.declarationStart, occurrence.declarationEnd);
  return new RegExp(
    `\\b(?:assert|with)\\s*\\{[\\s\\S]*?\\btype\\s*:\\s*(["'])${type}\\1`,
    'i',
  ).test(declaration);
}

function usesViteImportMetaEnv(code: string) {
  const { tokens } = tokenizeJavaScriptForModules(code);
  return tokens.some((token, index) => (
    token.kind === 'identifier'
    && token.value === 'import'
    && tokens[index + 1]?.value === '.'
    && tokens[index + 2]?.value === 'meta'
    && tokens[index + 3]?.value === '.'
    && tokens[index + 4]?.value === 'env'
  ));
}

function projectHasExplicitViteSignature(project: HtmlProject) {
  const root = normalizePath(project.rootPath);
  const rootPrefix = root ? `${root}/` : '';
  const hasRootConfig = Object.keys(project.files).some(path => {
    const normalized = normalizePath(path);
    if (root && !normalized.toLowerCase().startsWith(rootPrefix.toLowerCase())) return false;
    const relative = root ? normalized.slice(rootPrefix.length) : normalized;
    return /^vite\.config\.(?:[cm]?[jt]s)$/i.test(relative);
  });
  if (hasRootConfig) return true;
  const packageFile = fileByPath(project.files, `${rootPrefix}package.json`)
    || (!root ? fileByPath(project.files, 'package.json') : null);
  if (!packageFile?.file.text) return false;
  try {
    const parsed = JSON.parse(packageFile.file.text) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      scripts?: Record<string, unknown>;
    };
    if (parsed.dependencies?.vite || parsed.devDependencies?.vite) return true;
    return Object.values(parsed.scripts || {}).some(value => (
      typeof value === 'string'
      && /(?:^|[\s;&|()])vite(?:\s|$)/.test(value)
    ));
  } catch {
    return false;
  }
}

function browserModulePageNeedsViteBuild(
  project: HtmlProject,
  page: BrowserModulePage,
) {
  const visited = new Set<string>();
  const visit = (path: string): boolean => {
    if (visited.has(path)) return false;
    visited.add(path);
    const code = project.files[path]?.text || '';
    if (usesViteImportMetaEnv(code)) return true;
    for (const occurrence of scanModuleSpecifiers(code)) {
      const specifier = occurrence.specifier;
      // URL schemes and import-map-owned bare names are already browser-native.
      if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) continue;
      if (isBareModuleSpecifier(specifier)) {
        if (!importMapResolves(specifier, page.importMapKeys)) return true;
        continue;
      }
      const reference = splitLocalReference(specifier);
      if (!reference) continue;
      if (
        occurrence.kind === 'import'
        && /\.css$/i.test(reference.path)
        && !occurrenceUsesNativeType(code, occurrence, 'css')
      ) return true;
      if (
        occurrence.kind === 'import'
        && occurrence.defaultBinding
        && looksLikeAssetReference(reference.path)
        && !(
          /\.json$/i.test(reference.path)
          && occurrenceUsesNativeType(code, occurrence, 'json')
        )
      ) return true;
      const resolved = resolvePath(path, specifier, project.rootPath);
      const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
      if (canonical && /\.(?:m?js)$/i.test(canonical) && visit(canonical)) return true;
    }
    return false;
  };
  return page.entryPaths.some(visit);
}

/**
 * Decide whether transport may invoke Kodety's legacy Vite-source compiler.
 *
 * This predicate is intentionally fail-safe: module syntax, package metadata,
 * bare imports or a Vite config alone never authorize source mutation. A build
 * is selected only when an explicit Vite project signature and a reachable
 * browser-incompatible source construct are both present. Import maps, CDN
 * URLs, local native ESM and final bundles therefore remain pass-through.
 */
export function projectRequiresCodedBuild(rawProject: HtmlProject) {
  const project = hydrateCodedProject(rawProject);
  if (!projectHasExplicitViteSignature(project)) return false;
  return browserModulePages(project).some(page => browserModulePageNeedsViteBuild(project, page));
}

/**
 * Convert local asset literals used by ordinary JavaScript (`img.src = ...`,
 * setAttribute(), fetch(), object values, variables) into URLs anchored to the
 * generated module. A small lexical scanner avoids touching comments,
 * templates, import specifiers and object keys; those need different syntax.
 */
function rewriteModuleAssetLiterals(
  project: HtmlProject,
  modulePath: string,
  buildPath: string,
  code: string,
) {
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let cursor = 0;
  while (cursor < code.length) {
    if (code[cursor] === '/' && code[cursor + 1] === '/') {
      cursor = code.indexOf('\n', cursor + 2);
      if (cursor < 0) break;
      continue;
    }
    if (code[cursor] === '/' && code[cursor + 1] === '*') {
      const end = code.indexOf('*/', cursor + 2);
      cursor = end < 0 ? code.length : end + 2;
      continue;
    }
    const quote = code[cursor];
    if (quote !== '"' && quote !== "'" && quote !== '`') {
      cursor++;
      continue;
    }
    const start = cursor++;
    let escaped = false;
    while (cursor < code.length) {
      const character = code[cursor];
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) break;
      cursor++;
    }
    if (cursor >= code.length) break;
    const end = cursor + 1;
    const value = code.slice(start + 1, cursor);
    cursor = end;
    if (escaped || value.includes('\\') || (quote === '`' && value.includes('${'))) continue;
    if (!looksLikeAssetReference(value)) continue;
    const before = code.slice(Math.max(0, start - 120), start);
    const after = code.slice(end);
    if (
      /(?:\bfrom|\bimport|\bexport)\s*$/i.test(before)
      || /\bnew\s+URL\s*\(\s*$/i.test(before)
      || /^\s*:/.test(after)
    ) continue;
    const expression = moduleAssetExpression(project, modulePath, buildPath, value);
    if (expression) replacements.push({ start, end, value: expression });
  }
  if (!replacements.length) return code;
  let rewritten = code;
  replacements.reverse().forEach(replacement => {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
  });
  return rewritten;
}

/**
 * Vite substitutes these expressions while bundling. Source projects execute
 * as native modules in the isolated Builder Preview, so both Preview and the
 * generated publish graph must apply the same deterministic production values.
 */
export function replaceViteImportMetaEnv(code: string) {
  return code
    .replace(/\bimport\.meta\.env\.BASE_URL\b/g, '"./"')
    .replace(/\bimport\.meta\.env\.MODE\b/g, '"production"')
    .replace(/\bimport\.meta\.env\.PROD\b/g, 'true')
    .replace(/\bimport\.meta\.env\.DEV\b/g, 'false')
    .replace(/\bimport\.meta\.env\.SSR\b/g, 'false')
    .replace(
      /\bimport\.meta\.env\b/g,
      '({ BASE_URL: "./", MODE: "production", PROD: true, DEV: false, SSR: false })',
    );
}

function transformModule(
  project: HtmlProject,
  modulePath: string,
  buildPath: string,
  code: string,
  versions: Record<string, string>,
) {
  const replaceSpecifier = (specifier: string) => {
    if (isBareModuleSpecifier(specifier)) return moduleCdnUrl(specifier, versions);
    const resolved = resolvePath(modulePath, specifier, project.rootPath);
    const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
    if (!canonical || !/\.(?:m?js)$/i.test(canonical)) return specifier;
    const suffix = splitLocalReference(specifier)?.suffix || '';
    return `${relativeSpecifier(buildPath, `${CODED_BUILD_DIRECTORY}/${canonical}`)}${suffix}`;
  };
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  scanModuleSpecifiers(code).forEach(occurrence => {
    if (
      occurrence.kind === 'import'
      && occurrence.sideEffectOnly
      && /\.css(?:[?#]|$)/i.test(occurrence.specifier)
      && occurrence.declarationStart !== undefined
      && occurrence.declarationEnd !== undefined
    ) {
      replacements.push({
        start: occurrence.declarationStart,
        end: occurrence.declarationEnd,
        value: '/* CSS extracted by Kodety build */',
      });
      return;
    }
    if (
      occurrence.kind === 'import'
      && occurrence.defaultBinding
      && looksLikeAssetReference(occurrence.specifier)
      && occurrence.declarationStart !== undefined
      && occurrence.declarationEnd !== undefined
    ) {
      const expression = moduleAssetExpression(
        project,
        modulePath,
        buildPath,
        occurrence.specifier,
      );
      if (expression) {
        replacements.push({
          start: occurrence.declarationStart,
          end: occurrence.declarationEnd,
          value: `const ${occurrence.defaultBinding} = ${expression};`,
        });
        return;
      }
    }
    const next = replaceSpecifier(occurrence.specifier);
    if (next !== occurrence.specifier) {
      replacements.push({ start: occurrence.start, end: occurrence.end, value: next });
    }
  });
  let transformed = code;
  replacements.sort((left, right) => right.start - left.start).forEach(replacement => {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.value}${transformed.slice(replacement.end)}`;
  });
  // `import.meta.env` is a Vite compile-time construct; in a native browser
  // module it is undefined and any property access throws, killing the whole
  // script. Vite itself substitutes these tokens textually, so the same
  // replacement is faithful. BASE_URL resolves through the document <base>.
  transformed = replaceViteImportMetaEnv(transformed);
  transformed = transformed.replace(
    /new\s+URL\(\s*(["'`])([^"'`]+)\1\s*,\s*import\.meta\.url\s*\)/g,
    (match, _quote: string, assetValue: string) => {
      const reference = splitLocalReference(assetValue);
      const resolved = resolvePath(modulePath, assetValue, project.rootPath);
      const sourcePath = resolved ? projectPublicFilePath(project, resolved) : null;
      return sourcePath
        ? `new URL(${JSON.stringify(`${relativeSpecifier(buildPath, publishedAssetPath(project, sourcePath))}${reference?.suffix || ''}`)}, import.meta.url)`
        : match;
    },
  );
  transformed = rewriteModuleAssetLiterals(
    project,
    modulePath,
    buildPath,
    transformed,
  );
  transformed = rewriteModuleTemplateAssets(
    project,
    modulePath,
    buildPath,
    transformed,
  );
  return transformed;
}

function injectStylesheets(
  html: string,
  htmlPath: string,
  stylesheetPaths: string[],
) {
  const links = stylesheetPaths
    .filter(path => !new RegExp(`<link\\b[^>]*href=["'][^"']*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(html))
    .map(path => `  <link rel="stylesheet" href="${relativeSpecifier(htmlPath, path)}" data-kodety-coded-style="${path}">`)
    .join('\n');
  if (!links) return html;
  return /<\/head\s*>/i.test(html)
    ? html.replace(/<\/head\s*>/i, `${links}\n</head>`)
    : `${links}\n${html}`;
}

function rewriteManifestAssetReferences(
  project: HtmlProject,
  manifestPath: string,
  text: string,
) {
  try {
    const parsed = JSON.parse(text) as unknown;
    const visit = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return rewriteLocalReference(project, manifestPath, value);
      }
      if (Array.isArray(value)) return value.map(visit);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .map(([key, child]) => [key, visit(child)]),
        );
      }
      return value;
    };
    return JSON.stringify(visit(parsed), null, 2);
  } catch {
    return text;
  }
}

export function hydrateCodedProject(project: HtmlProject): HtmlProject {
  const manifestFile = project.files[CODED_BUILD_MANIFEST];
  if (!manifestFile?.text) return project;
  try {
    const manifest = JSON.parse(manifestFile.text) as Partial<CodedBuildManifest>;
    if (
      ![1, 2].includes(Number(manifest.version))
      || !manifest.originals
      || !Array.isArray(manifest.generated)
    ) return project;
    const files = { ...project.files };
    Object.entries(manifest.originals).forEach(([path, text]) => {
      const current = files[path];
      files[path] = {
        path,
        mimeType: current?.mimeType || 'text/html',
        text: String(text),
      };
    });
    manifest.generated.forEach(path => { delete files[path]; });
    delete files[CODED_BUILD_MANIFEST];
    return { ...project, files };
  } catch {
    return project;
  }
}

export function prepareCodedProjectForTransport(rawProject: HtmlProject): HtmlProject {
  const project = hydrateCodedProject(rawProject);
  const versions = projectDependencyVersions(project);
  const modulePaths = Object.keys(project.files).filter(path =>
    /\.(?:m?js)$/i.test(path) && typeof project.files[path]?.text === 'string',
  );
  const generated: string[] = [];
  const originals: Record<string, string> = {};
  const moduleEntrypoints = new Set<string>();
  let files = { ...project.files };

  modulePaths.forEach(path => {
    const buildPath = `${CODED_BUILD_DIRECTORY}/${path}`;
    files[buildPath] = {
      path: buildPath,
      mimeType: 'text/javascript',
      text: transformModule(project, path, buildPath, project.files[path].text || '', versions),
    };
    generated.push(buildPath);
  });

  const root = normalizePath(project.rootPath);
  projectPublicDirectoryNames(project).forEach(directory => {
    const publicPrefix = `${root ? `${root}/` : ''}${directory}/`;
    Object.keys(project.files).filter(path => path.startsWith(publicPrefix)).forEach(path => {
      const alias = `${root ? `${root}/` : ''}${path.slice(publicPrefix.length)}`;
      if (!alias || files[alias]) return;
      files[alias] = { ...project.files[path], path: alias };
      generated.push(alias);
    });
  });

  const rememberOriginal = (path: string, text: string) => {
    if (project.files[path]?.text !== undefined && originals[path] === undefined) {
      originals[path] = text;
    }
  };

  // Process generated public aliases as well as their source documents. A
  // Vite public/cases.html page, for example, is published as cases.html and
  // needs the same module/style/asset repair as the original public copy.
  Object.values(files)
    .filter(file => /\.html?$/i.test(file.path) && file.text !== undefined)
    .forEach(file => {
      let html = file.text || '';
      const moduleEntries: string[] = [];
      html = html.replace(/<script\b[^>]*>/gi, tag => {
        if (!/\btype\s*=\s*(["'])module\1/i.test(tag)) return tag;
        const sourceMatch = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
        const source = sourceMatch?.[2] || '';
        const resolved = resolvePath(file.path, source, project.rootPath);
        const canonical = resolved ? projectPublicFilePath(project, resolved) : null;
        if (!canonical || !/\.(?:m?js)$/i.test(canonical)) return tag;
        moduleEntries.push(canonical);
        moduleEntrypoints.add(canonical);
        const built = `${CODED_BUILD_DIRECTORY}/${canonical}`;
        // Root-absolute URLs in authored documents belong to the project-root
        // namespace (e.g. `Arquivos/`), while `kodety-build/` lives beside it at
        // the archive root. Hosts such as the WordPress theme resolve `/...`
        // against the document's authored root, so only a document-relative
        // specifier reaches the generated module from every published path.
        const replacement = relativeSpecifier(publishedDocumentPath(file.path), built);
        return tag.replace(sourceMatch![0], `src=${sourceMatch![1]}${replacement}${sourceMatch![1]}`);
      });
      const stylesheetPaths = reachableStylesheets(project, modulePaths, moduleEntries);
      html = injectStylesheets(html, file.path, stylesheetPaths);
      html = rewriteMarkupAssetReferences(project, file.path, html);
      if (html === file.text) return;
      rememberOriginal(file.path, file.text || '');
      files[file.path] = { ...file, text: html };
    });

  Object.values(files)
    .filter(file => /\.css$/i.test(file.path) && file.text !== undefined)
    .forEach(file => {
      const css = rewriteCssAssetReferences(project, file.path, file.text || '');
      if (css === file.text) return;
      rememberOriginal(file.path, file.text || '');
      files[file.path] = { ...file, text: css };
    });

  Object.values(files)
    .filter(file => /\.svg$/i.test(file.path) && file.text !== undefined)
    .forEach(file => {
      const svg = rewriteMarkupAssetReferences(project, file.path, file.text || '');
      if (svg === file.text) return;
      rememberOriginal(file.path, file.text || '');
      files[file.path] = { ...file, text: svg };
    });

  Object.values(files)
    .filter(file => /(?:^|\/)(?:manifest\.json|[^/]+\.webmanifest)$/i.test(file.path) && file.text !== undefined)
    .forEach(file => {
      const manifestText = rewriteManifestAssetReferences(project, file.path, file.text || '');
      if (manifestText === file.text) return;
      rememberOriginal(file.path, file.text || '');
      files[file.path] = { ...file, text: manifestText };
    });

  if (!Object.keys(originals).length && !generated.length) return project;
  const moduleGraph = generatedModuleGraph(
    project,
    modulePaths,
    Array.from(moduleEntrypoints),
  );
  const encoder = new TextEncoder();
  const modules = Object.fromEntries(
    Array.from(moduleGraph.dependencies.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, dependencies]) => {
        const buildPath = `${CODED_BUILD_DIRECTORY}/${path}`;
        const code = files[buildPath]?.text || '';
        const bytes = encoder.encode(code);
        assertBrowserModuleSyntax(buildPath, code);
        return [buildPath, {
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          dependencies: dependencies.map(
            dependency => `${CODED_BUILD_DIRECTORY}/${dependency}`,
          ).sort(),
        }];
      }),
  );
  const manifest: CodedBuildManifest = {
    version: 2,
    originals,
    generated: Array.from(new Set(generated)).sort(),
    entrypoints: moduleGraph.entries.map(path => `${CODED_BUILD_DIRECTORY}/${path}`),
    modules,
  };
  files[CODED_BUILD_MANIFEST] = {
    path: CODED_BUILD_MANIFEST,
    mimeType: 'application/json',
    text: JSON.stringify(manifest),
  };
  return { ...project, files };
}
