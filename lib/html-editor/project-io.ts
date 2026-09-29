import { restoreStaticHtmlSource } from './static-source';
import JSZip from 'jszip';
import type { Font } from '@/types';
import type { HtmlProject, HtmlProjectFile } from './types';
import {
  CURRENT_BREAKPOINT_SCHEMA_VERSION,
  DEFAULT_BREAKPOINTS,
  LEGACY_STOCK_BREAKPOINTS,
  isLegacyStockBreakpointRegistry,
  normalizeBreakpointRegistry,
  normalizePrimaryBreakpoint,
  tryPatchBreakpointMediaQueries,
  type Breakpoint,
} from './css-patcher';
import {
  sanitizePageSeoMediaForPersistence,
  sanitizeSiteSeoMediaForPersistence,
  synchronizeManagedVariantFaviconHtml,
  type PageSeoSettings,
  type SiteSeoSettings,
} from './seo-settings';
import {
  ensureProjectLocalizationIds,
  normalizeLocalization,
  type LocalizationSettings,
} from './localization';
import { projectCssDigest } from './css-integrity';
import type { ComponentRegistrySnapshot } from '@coday/component-registry';
import { prepareCodeComponentProject, toCodeComponentBreakpoints } from './code-components';
import {
  applyCustomCodeToHtml,
  applyCustomCodeToProject,
  type CustomCodeSettings,
} from './custom-code';
import {
  prepareCookieConsentProjectForTransport,
  type CookieConsentSettings,
} from './cookie-consent';
import type { RedirectSettings } from './redirects';
import type { HtmlDesignTokenDocument } from './design-tokens';
import {
  interactionDocumentPath,
  interactionDocumentPathCandidates,
  patchInteractionDocument,
  readInteractionDocument,
  readInteractionDocumentFile,
  type SavedInteractionPreset,
} from './interactions';
import {
  hydrateMembershipProject,
  prepareMembershipProjectForTransport,
} from './membership-transport';
import type { MembershipSettings } from './membership';
import {
  hydrateCodedProject,
  prepareCodedProjectForTransport,
  projectRequiresCodedBuild,
} from './coded-project';
import { injectNativeComponentsRuntime } from './native-runtime';
import { preparePageTransitionsForTransport } from './page-transitions-runtime';
import {
  HTML_COMPONENTS_DIRECTORY,
  injectHtmlComponentRuntimeRegistry,
  migrateLegacyHtmlComponentBundles,
  normalizeHtmlComponentLibrary,
  refreshHtmlComponentInstancesInSource,
  type HtmlComponentLibrary,
} from './html-components';
import { compileHtmlComponentInstanceInteractions } from './component-interaction-runtime';
import {
  inlineHtmlComponentStyles,
  synchronizeHtmlComponentBundleManifests,
} from './component-bundle';
import {
  injectProjectGoogleFonts,
  normalizeProjectGoogleFonts,
  referencedProjectGoogleFonts,
  serializeProjectGoogleFonts,
  type ProjectGoogleFont,
} from './google-fonts';
import { discoverProjectFonts } from './project-fonts';
import { normalizeFontFamilyName } from '../font-utils';
import { prepareResponsiveProjectForTransport } from './responsive-publication';

export {
  ensureResponsiveViewportMeta,
  projectNeedsResponsiveViewportNormalization,
} from './responsive-publication';

export interface HtmlEditorMetadata {
  version: number;
  /** Stable workspace identity. Releases from another site must never share
   * rollback storage merely because both projects contain index.html. */
  projectId?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  mainHtmlPath?: string;
  homeHtmlPath?: string;
  /**
   * Publication is opt-out so projects created before this field existed keep
   * publishing every page. Only `draft` entries are persisted; an absent path
   * is an active page.
   */
  pageStatuses?: Record<string, HtmlPagePublicationStatus>;
  rootPath?: string;
  lockedLayers?: Record<string, string[]>;
  /** Independent CSS classes whose standalone rule can be attached to any
   * element. Unlike combo classes, they never depend on the element's base
   * class or participate in its compound selector. */
  reusableClasses?: string[];
  /**
   * Version of the breakpoint defaults already considered for this project.
   * It is intentionally independent from `version`: once sealed, a later
   * author-selected 410px registry must remain an explicit choice.
   */
  breakpointSchemaVersion?: number;
  primaryBreakpoint?: Breakpoint;
  breakpoints?: Breakpoint[];
  siteSettings?: SiteSeoSettings;
  pageSettings?: Record<string, PageSeoSettings>;
  localization?: LocalizationSettings;
  /** Versioned ESM bundles, manifests and JSON-only Code Component instances. */
  codeComponents?: ComponentRegistrySnapshot;
  /** Native HTML/CSS reusable components, variants and editable variables. */
  components?: HtmlComponentLibrary;
  /** Trusted scripts, styles and markup materialized only in preview/transport. */
  customCode?: CustomCodeSettings;
  /** Native banner, categories and script-gating policy compiled for Preview and publication. */
  cookieConsent?: CookieConsentSettings;
  /** Ordered redirect rules compiled into the published WordPress runtime. */
  redirects?: RedirectSettings;
  /** Project-scoped design values compiled to native CSS custom properties. */
  designTokens?: HtmlDesignTokenDocument;
  /** Google families used by this project, independent of the editor's font library. */
  googleFonts?: ProjectGoogleFont[];
  /**
   * Portable interaction timelines saved by the author for reuse on any page.
   * They are editor-only metadata and are never injected into the published
   * interaction runtime until the author explicitly applies one.
   */
  savedAnimations?: SavedInteractionPreset[];
  /**
   * Optional, project-scoped member-area authoring contract. Its absence is
   * the backwards-compatible fast path for ordinary sites and landing pages.
   */
  membership?: MembershipSettings;
}

export type HtmlPagePublicationStatus = 'active' | 'draft';

function createProjectId() {
  return globalThis.crypto?.randomUUID?.()
    || `kodety-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const TEXT_EXTENSIONS = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'json',
  'txt',
  'md',
  'svg',
  'xml',
  'webmanifest',
  'map',
  'ts',
  'tsx',
  'jsx',
  'liquid',
]);
const MAX_IMPORT_FILES = 10000;
const MAX_IMPORT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_IMPORT_TOTAL_BYTES = 768 * 1024 * 1024;
const IMPORT_CONCURRENCY = 6;
const IMPORT_YIELD_FILE_COUNT = 64;
const IMPORT_YIELD_BYTES = 16 * 1024 * 1024;
const IGNORED_IMPORT_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.cache',
  'dist-cache',
]);

type ProjectImportObservedPhase = 'project_unzip' | 'project_parse';
type ProjectImportPhaseOutcome = 'ok' | 'error' | 'aborted';

function beginProjectImportPhase(
  phase: ProjectImportObservedPhase,
) {
  const bridge = globalThis.__kodetyWordPressProjectObservability;
  if (!bridge) return null;
  try {
    const token = bridge.begin(phase, 'bypass');
    return token ? { bridge, token } : null;
  } catch {
    return null;
  }
}

function finishProjectImportPhase(
  observation: ReturnType<typeof beginProjectImportPhase>,
  outcome: ProjectImportPhaseOutcome,
) {
  if (!observation) return;
  try {
    observation.bridge.finish(observation.token, outcome);
  } catch {
    // Observability is optional and must never change project import behavior.
  }
}

function projectImportFailureOutcome(error: unknown): ProjectImportPhaseOutcome {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? Reflect.get(error, 'name')
    : null;
  return name === 'AbortError' ? 'aborted' : 'error';
}

async function observeAsyncProjectImportPhase<T>(
  phase: ProjectImportObservedPhase,
  operation: () => Promise<T>,
): Promise<T> {
  const observation = beginProjectImportPhase(phase);
  try {
    const result = await operation();
    finishProjectImportPhase(observation, 'ok');
    return result;
  } catch (error) {
    finishProjectImportPhase(observation, projectImportFailureOutcome(error));
    throw error;
  }
}

function observeProjectImportPhase<T>(
  phase: ProjectImportObservedPhase,
  operation: () => T,
): T {
  const observation = beginProjectImportPhase(phase);
  try {
    const result = operation();
    finishProjectImportPhase(observation, 'ok');
    return result;
  } catch (error) {
    finishProjectImportPhase(observation, projectImportFailureOutcome(error));
    throw error;
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index]);
    }
  });
  await Promise.all(workers);
}

function assertImportBudget(path: string, fileBytes: number, totalBytes: number) {
  if (fileBytes > MAX_IMPORT_FILE_BYTES)
    throw new Error(`O arquivo “${path}” ultrapassa o limite seguro de 256 MB.`);
  if (totalBytes > MAX_IMPORT_TOTAL_BYTES)
    throw new Error('O projeto ultrapassa o limite seguro de 768 MB para edição no navegador.');
}

/** JSZip keeps central-directory sizes on its private compressed-data record.
 * Reading the value is a best-effort preflight: the exact extracted size is
 * still checked below, but a ZIP bomb must be rejected before allocating its
 * first oversized output buffer whenever the declared size is available. */
function declaredZipEntryBytes(entry: JSZip.JSZipObject) {
  const value = (
    entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: unknown } }
  )._data?.uncompressedSize;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function yieldImportTurn() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

function extension(path: string) {
  return path.split('.').pop()?.toLowerCase() || '';
}

function mimeType(path: string) {
  const ext = extension(path);
  const types: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    liquid: 'text/x-liquid',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  };
  return types[ext] || 'application/octet-stream';
}

function normalizePath(path: string) {
  const stack: string[] = [];
  path
    .replaceAll('\\', '/')
    .split('/')
    .forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') stack.pop();
      else stack.push(part);
    });
  return stack.join('/');
}

function isMetadataPath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  return (
    normalized.startsWith('__MACOSX/') ||
    normalized.includes('/__MACOSX/') ||
    normalized.endsWith('/.DS_Store') ||
    normalized === '.DS_Store'
  );
}

function dirname(path: string) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function relativeProjectReference(fromPath: string, toPath: string) {
  const from = dirname(fromPath).split('/').filter(Boolean);
  const to = toPath.split('/').filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  const relative = [
    ...Array.from({ length: from.length - shared }, () => '..'),
    ...to.slice(shared),
  ].join('/');
  return relative || to.at(-1) || '';
}

function referenceBoundary(value: string | undefined, side: 'before' | 'after') {
  if (value === undefined) return true;
  return side === 'before'
    // A persisted override may retain a page-relative prefix (`./`, `../`) or
    // an escaped JSON slash even though it lives in a metadata document. The
    // full canonical asset path that follows that slash is still a safe token.
    ? /[\s"'`(){}\[\]=:,;\/\\]/.test(value)
    : /[\s"'`(){}\[\],;?#;=>]/.test(value);
}

function replaceBoundedReference(source: string, previous: string, next: string) {
  if (!previous || previous === next || !source.includes(previous)) return source;
  let cursor = 0;
  let result = '';
  while (cursor < source.length) {
    const index = source.indexOf(previous, cursor);
    if (index < 0) {
      result += source.slice(cursor);
      break;
    }
    const before = index > 0 ? source[index - 1] : undefined;
    const afterIndex = index + previous.length;
    const after = afterIndex < source.length ? source[afterIndex] : undefined;
    const externalUrlPrefix = before === '/'
      && /(?:[a-z][a-z\d+.-]*:)?\/\/[^\s"'`()<>]*\/$/i.test(
        source
          .slice(Math.max(0, index - 2048), index)
          .replaceAll('\\/', '/'),
      );
    result += source.slice(cursor, index);
    if (
      !externalUrlPrefix
      && referenceBoundary(before, 'before')
      && referenceBoundary(after, 'after')
    ) {
      result += next;
    } else {
      result += previous;
    }
    cursor = afterIndex;
  }
  return result;
}

function projectReferenceReplacements(
  sourcePath: string,
  previousPath: string,
  nextPath: string,
  rootPath = '',
) {
  const normalizedPrevious = normalizePath(previousPath);
  const normalizedNext = normalizePath(nextPath);
  const normalizedSource = normalizePath(sourcePath);
  const root = normalizePath(rootPath);
  const originalSourcePath =
    normalizedSource === normalizedNext ? normalizedPrevious : normalizedSource;
  const replacements = new Map<string, string>();
  const previousRelative = relativeProjectReference(
    originalSourcePath,
    normalizedPrevious,
  );
  const nextRelative = relativeProjectReference(normalizedSource, normalizedNext);
  replacements.set(previousRelative, nextRelative);
  if (!previousRelative.startsWith('.')) {
    replacements.set(`./${previousRelative}`, `./${nextRelative}`);
  }
  replacements.set(normalizedPrevious, normalizedNext);
  if (
    (!root || normalizedPrevious.startsWith(`${root}/`))
    && (!root || normalizedNext.startsWith(`${root}/`))
  ) {
    const previousRootPath = root
      ? normalizedPrevious.slice(root.length + 1)
      : normalizedPrevious;
    const nextRootPath = root
      ? normalizedNext.slice(root.length + 1)
      : normalizedNext;
    replacements.set(`/${previousRootPath}`, `/${nextRootPath}`);
  }

  Array.from(replacements.entries()).forEach(([previous, next]) => {
    const encodedPrevious = encodeURI(previous);
    const encodedNext = encodeURI(next);
    if (encodedPrevious !== previous) replacements.set(encodedPrevious, encodedNext);

    // JSON permits escaped forward slashes. After JSON.parse the canvas and
    // Inspector show "./image.png", while the stored project text may still
    // contain ".\/image.png". Rewrite the serialized form as well so locale,
    // component and membership metadata cannot restore a removed source path.
    const jsonPrevious = previous.replaceAll('/', '\\/');
    const jsonNext = next.replaceAll('/', '\\/');
    if (jsonPrevious !== previous) replacements.set(jsonPrevious, jsonNext);
  });
  return replacements;
}

/**
 * Rewrites one text/attribute value using the same path semantics as a project
 * file rename. Exported so optimistic Inspector state can stay synchronized
 * with the canonical project transaction.
 */
export function rewriteProjectFileReferenceText(
  source: string,
  sourcePath: string,
  previousPath: string,
  nextPath: string,
  rootPath = '',
) {
  let text = source;
  Array.from(
    projectReferenceReplacements(
      sourcePath,
      previousPath,
      nextPath,
      rootPath,
    ).entries(),
  )
    .sort(([left], [right]) => right.length - left.length)
    .forEach(([previous, next]) => {
      text = replaceBoundedReference(text, previous, next);
    });
  return text;
}

/**
 * Rename references authored as document-relative, project-root or canonical
 * project paths. Rewriting only delimiter-bounded tokens avoids changing a
 * similarly named word, hostname or longer file path in source code.
 */
export function rewriteProjectFileReferences(
  project: HtmlProject,
  previousPath: string,
  nextPath: string,
  options?: {
    shouldRewriteFile?: (path: string, file: HtmlProjectFile) => boolean;
  },
): HtmlProject {
  const normalizedPrevious = normalizePath(previousPath);
  const normalizedNext = normalizePath(nextPath);
  if (!normalizedPrevious || !normalizedNext || normalizedPrevious === normalizedNext) return project;
  let files = project.files;
  Object.entries(project.files).forEach(([filePath, file]) => {
    if (file.text === undefined) return;
    if (options?.shouldRewriteFile && !options.shouldRewriteFile(filePath, file)) return;
    const text = rewriteProjectFileReferenceText(
      file.text,
      filePath,
      normalizedPrevious,
      normalizedNext,
      project.rootPath,
    );
    if (text === file.text) return;
    if (files === project.files) files = { ...project.files };
    files[filePath] = { ...file, text };
  });
  return files === project.files ? project : { ...project, files };
}

function findMainHtml(files: Record<string, HtmlProjectFile>) {
  const html = Object.keys(files).filter((path) => /\.html?$/i.test(path));
  const index =
    html.find((path) => path.toLowerCase() === 'index.html') ||
    html.find((path) => path.toLowerCase().endsWith('/index.html'));
  const candidate = index || html.sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!candidate) throw new Error('Nenhum arquivo HTML foi encontrado no projeto.');
  return candidate;
}

interface EditorMetadataParseCacheEntry {
  text: string;
  metadata: HtmlEditorMetadata | null;
}

// Metadata is read from many independent editor projections during a render.
// Cache by the immutable project-file object, but retain the source text in the
// entry so an in-place update from an external integration still invalidates
// safely. Weak keys prevent closed projects from being retained in memory.
const editorMetadataParseCache = new WeakMap<
  HtmlProjectFile,
  EditorMetadataParseCacheEntry
>();

function parseEditorMetadataFile(
  files: Record<string, HtmlProjectFile>,
): HtmlEditorMetadata | null {
  const file = files['.incode/project.json'];
  const text = file?.text;
  if (!file || !text) return null;
  const cached = editorMetadataParseCache.get(file);
  if (cached?.text === text) return cached.metadata;
  let metadata: HtmlEditorMetadata | null;
  try {
    metadata = JSON.parse(text) as HtmlEditorMetadata;
  } catch {
    metadata = null;
  }
  editorMetadataParseCache.set(file, { text, metadata });
  return metadata;
}

function projectLocation(files: Record<string, HtmlProjectFile>) {
  const metadata = parseEditorMetadataFile(files);
  const declaredMain =
    typeof metadata?.mainHtmlPath === 'string' ? normalizePath(metadata.mainHtmlPath) : '';
  const mainHtmlPath =
    declaredMain && files[declaredMain] && /\.html?$/i.test(declaredMain)
      ? declaredMain
      : findMainHtml(files);
  const declaredRoot =
    typeof metadata?.rootPath === 'string' ? normalizePath(metadata.rootPath) : '';
  return {
    mainHtmlPath,
    rootPath: metadata?.rootPath === '' ? '' : declaredRoot || dirname(mainHtmlPath),
  };
}

export async function fileToProjectFile(path: string, file: Blob): Promise<HtmlProjectFile> {
  const normalized = normalizePath(path);
  const detectedMimeType = file.type || mimeType(normalized);
  if (TEXT_EXTENSIONS.has(extension(normalized))) {
    return {
      path: normalized,
      mimeType: detectedMimeType,
      // Import is a lossless boundary. CSS priority, whitespace and authored
      // runtime code belong to the uploaded project and must not be normalized
      // merely because the file was opened in the Builder.
      text: await file.text(),
    };
  }
  return {
    path: normalized,
    mimeType: detectedMimeType,
    data: new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * Legacy public helper retained for API compatibility.
 *
 * Project source is now lossless: `!important` participates in the authored
 * cascade and removing it can change layout, scroll ownership and animation
 * state. Visual edits may replace the declaration the user explicitly edits,
 * but opening, saving, exporting or publishing must never rewrite unrelated
 * source.
 */
export function sanitizeCssPriorities(source: string) {
  return source;
}

/** Lossless compatibility helper for authored HTML, SVG and Liquid. */
export function sanitizeMarkupPriorities(source: string) {
  return source;
}

export function sanitizeProjectTextPriorities(_path: string, source: string) {
  return source;
}

function stripProjectPriorities(project: HtmlProject): HtmlProject {
  return project;
}

/**
 * Preserve the historical API name while making project opening lossless.
 * No-op/custom projects retain object identity; the one versioned stock
 * breakpoint migration intentionally returns a new snapshot so its metadata
 * and managed CSS are persisted together after open.
 */
export function sanitizeProjectPriorities(project: HtmlProject): HtmlProject {
  return migrateLegacyStockBreakpointProject(
    hydrateMembershipProject(hydrateCodedProject(project)),
  );
}

export function ensureProjectIdentity(project: HtmlProject): HtmlProject {
  const current = readEditorMetadata(project);
  if (typeof current.projectId === 'string' && current.projectId.trim()) return project;
  const hasAuthoredMetadata = Boolean(parseEditorMetadataFile(project.files));
  return updateEditorMetadata(project, metadata => ({
    ...metadata,
    projectId: createProjectId(),
    ...(!hasAuthoredMetadata
      ? {
          breakpointSchemaVersion: CURRENT_BREAKPOINT_SCHEMA_VERSION,
          breakpoints: DEFAULT_BREAKPOINTS.map(breakpoint => ({ ...breakpoint })),
        }
      : {}),
  }));
}

export function createBlankProject(name = 'Meu site'): HtmlProject {
  const createdAt = new Date().toISOString();
  const projectId = createProjectId();
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main></main>
  <script src="script.js"></script>
</body>
</html>
`;
  const css = `* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  min-height: 100%;
}

body {
  font-family: Arial, sans-serif;
}
`;
  const files: Record<string, HtmlProjectFile> = {
    'index.html': { path: 'index.html', mimeType: 'text/html', text: html },
    'styles.css': { path: 'styles.css', mimeType: 'text/css', text: css },
    'script.js': { path: 'script.js', mimeType: 'text/javascript', text: '' },
    '.incode/project.json': {
      path: '.incode/project.json',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          version: 1,
          projectId,
          name,
          createdAt,
          mainHtmlPath: 'index.html',
          homeHtmlPath: 'index.html',
          rootPath: '',
          breakpointSchemaVersion: CURRENT_BREAKPOINT_SCHEMA_VERSION,
          breakpoints: DEFAULT_BREAKPOINTS.map(breakpoint => ({ ...breakpoint })),
        },
        null,
        2,
      ),
    },
  };
  return { name, files, mainHtmlPath: 'index.html', rootPath: '', openedAt: Date.now() };
}

export async function replaceProjectFile(
  project: HtmlProject,
  path: string,
  file: Blob,
): Promise<HtmlProject> {
  const replacement = await fileToProjectFile(path, file);
  return { ...project, files: { ...project.files, [path]: replacement } };
}

export async function addProjectAsset(project: HtmlProject, file: File): Promise<HtmlProject> {
  const basePath = normalizePath(`assets/${file.name}`);
  const extensionIndex = basePath.lastIndexOf('.');
  const stem = extensionIndex >= 0 ? basePath.slice(0, extensionIndex) : basePath;
  const suffix = extensionIndex >= 0 ? basePath.slice(extensionIndex) : '';
  let path = basePath;
  let counter = 2;
  while (project.files[path]) path = `${stem}-${counter++}${suffix}`;
  const asset = await fileToProjectFile(path, file);
  return { ...project, files: { ...project.files, [path]: asset } };
}

export function removeProjectFile(project: HtmlProject, path: string): HtmlProject {
  if (!project.files[path]) return project;
  if (path === project.mainHtmlPath) throw new Error('A página HTML ativa não pode ser removida.');
  if (path === getProjectHomePath(project))
    throw new Error(
      'A página inicial não pode ser removida. Defina outra página inicial primeiro.',
    );
  const files = { ...project.files };
  delete files[path];
  if (/\.html?$/i.test(path)) {
    interactionDocumentPathCandidates(path).forEach(companionPath => {
      const sharedCompanion = Object.keys(project.files).some(candidate => (
        candidate !== path
        && /\.html?$/i.test(candidate)
        && interactionDocumentPathCandidates(candidate).includes(companionPath)
      ));
      if (!sharedCompanion) delete files[companionPath];
    });
  }
  return { ...project, files };
}

function defaultTextForPath(path: string) {
  const ext = extension(path);
  if (ext === 'html' || ext === 'htm')
    return '<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Nova página</title>\n</head>\n<body>\n\n</body>\n</html>\n';
  if (ext === 'css') return '/* Styles */\n';
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx'].includes(ext)) return '// Code\n';
  if (ext === 'json') return '{}\n';
  if (ext === 'svg')
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n</svg>\n';
  return '';
}

export function addProjectTextFile(project: HtmlProject, requestedPath: string): HtmlProject {
  const path = normalizePath(requestedPath.trim());
  if (!path || path.startsWith('.incode/'))
    throw new Error('Informe um caminho de arquivo válido.');
  if (project.files[path]) throw new Error('Já existe um arquivo com este caminho.');
  const file: HtmlProjectFile = { path, mimeType: mimeType(path), text: defaultTextForPath(path) };
  return { ...project, files: { ...project.files, [path]: file } };
}

export function renameProjectFile(
  project: HtmlProject,
  currentPath: string,
  requestedPath: string,
  options?: {
    allowInternalPath?: boolean;
    rewriteReferences?: boolean;
    moveInteractionCompanion?: boolean;
  },
): HtmlProject {
  const path = normalizePath(requestedPath.trim());
  const current = project.files[currentPath];
  if (!current) throw new Error('O arquivo não existe mais no projeto.');
  if (!path || (path.startsWith('.incode/') && !options?.allowInternalPath))
    throw new Error('Informe um caminho de arquivo válido.');
  if (path !== currentPath && project.files[path])
    throw new Error('Já existe um arquivo com este caminho.');
  if (path === currentPath) return project;
  const files = { ...project.files };
  delete files[currentPath];
  files[path] = {
    ...current,
    path,
    mimeType: extension(path) === extension(currentPath) ? current.mimeType : mimeType(path),
  };
  if (
    options?.moveInteractionCompanion !== false
    && /\.html?$/i.test(currentPath)
  ) {
    const currentCompanionPath = interactionDocumentPathCandidates(currentPath)
      .find(candidate => Boolean(files[candidate]))
      || interactionDocumentPath(currentPath);
    const nextCompanionPath = /\.html?$/i.test(path)
      ? interactionDocumentPath(path)
      : '';
    const companion = files[currentCompanionPath];
    if (companion && currentCompanionPath !== nextCompanionPath) {
      if (nextCompanionPath && files[nextCompanionPath]) {
        throw new Error('Já existe um documento de animação para o novo caminho.');
      }
      const sharedCompanion = Object.keys(project.files).some(candidate => (
        candidate !== currentPath
        && /\.html?$/i.test(candidate)
        && interactionDocumentPathCandidates(candidate).includes(currentCompanionPath)
      ));
      if (!sharedCompanion) {
        interactionDocumentPathCandidates(currentPath).forEach(candidate => {
          delete files[candidate];
        });
      }
      if (nextCompanionPath) {
        files[nextCompanionPath] = {
          ...companion,
          path: nextCompanionPath,
        };
      }
    }
  }
  let next = {
    ...project,
    files,
    mainHtmlPath: project.mainHtmlPath === currentPath ? path : project.mainHtmlPath,
    rootPath: project.mainHtmlPath === currentPath ? dirname(path) : project.rootPath,
  };
  if (options?.rewriteReferences !== false) {
    next = rewriteProjectFileReferences(next, currentPath, path);
  }
  return getProjectHomePath(project) === currentPath ? setProjectHomePath(next, path) : next;
}

export function addProjectPage(project: HtmlProject) {
  let number = Object.keys(project.files).filter((path) => /\.html?$/i.test(path)).length + 1;
  let path = `page-${number}.html`;
  while (project.files[path]) path = `page-${++number}.html`;
  const title = `Page ${number}`;
  const projectFilePath = (candidates: string[]) => {
    const normalizedCandidates = new Set(candidates.map(candidate => normalizePath(candidate).toLowerCase()));
    return Object.keys(project.files).find(candidate => normalizedCandidates.has(normalizePath(candidate).toLowerCase())) || '';
  };
  const rootPrefix = project.rootPath ? `${normalizePath(project.rootPath)}/` : '';
  const stylesheetPath = projectFilePath([
    'styles.css',
    'kodety-styles.css',
    `${rootPrefix}styles.css`,
    `${rootPrefix}kodety-styles.css`,
  ]);
  const scriptPath = projectFilePath([
    'script.js',
    `${rootPrefix}script.js`,
  ]);
  const stylesheetMarkup = stylesheetPath
    ? `\n  <link rel="stylesheet" href="${escapeHtml(relativeProjectReference(path, stylesheetPath))}">`
    : '';
  const scriptMarkup = scriptPath
    ? `\n  <script src="${escapeHtml(relativeProjectReference(path, scriptPath))}"></script>`
    : '';
  const text = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>${stylesheetMarkup}
</head>
<body>
  <main></main>${scriptMarkup}
</body>
</html>
`;
  const page: HtmlProjectFile = { path, mimeType: 'text/html', text };
  return { project: { ...project, files: { ...project.files, [path]: page } }, path };
}

interface ShopifyPreviewSource {
  sourcePath: string;
  tokens: Record<string, string>;
  attributeBindings?: Record<string, {
    attribute: string;
    sourceValue: string;
    previewValue: string;
    /** Exact name/casing, equals spacing and quote form from the Liquid file. */
    sourceAttribute?: string;
  }>;
  tableControlGroups?: string[][];
  schemaBlock?: string;
  sourceDigest?: string;
  previewDigest?: string;
}

interface ShopifyThemeMetadata {
  version: 1;
  kind: 'shopify-theme';
  themeRoot: string;
  previewSources: Record<string, ShopifyPreviewSource>;
}

const SHOPIFY_THEME_METADATA_PATH = '.incode/shopify-theme.json';
const SHOPIFY_THEME_DIRECTORIES = new Set([
  'assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates',
]);

function shopifySourceDigest(value: string) {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(value);
  bytes.forEach(byte => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  });
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shopifyThemeRoot(files: Record<string, HtmlProjectFile>) {
  const layouts = Object.keys(files)
    .filter(path => /(?:^|\/)layout\/theme\.liquid$/i.test(path))
    .sort((left, right) => left.split('/').length - right.split('/').length);
  const layout = layouts[0];
  return layout ? layout.replace(/(?:^|\/)layout\/theme\.liquid$/i, '') : null;
}

function shopifyThemeName(files: Record<string, HtmlProjectFile>, root: string, fallback: string) {
  try {
    const path = root ? `${root}/config/settings_schema.json` : 'config/settings_schema.json';
    const schema = JSON.parse(files[path]?.text || '[]') as Array<{ name?: string; theme_name?: string }>;
    const candidate = schema.find(item => item && (item.theme_name || item.name));
    const value = String(candidate?.theme_name || candidate?.name || '').trim();
    if (value && !/^theme settings$/i.test(value)) return value;
  } catch {
    // The original settings file remains available in Code even when invalid.
  }
  return fallback.trim() || 'Tema Shopify';
}

const SHOPIFY_PREVIEW_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1200 1200%22%3E%3Crect width=%221200%22 height=%221200%22 fill=%22%23eceae4%22/%3E%3Cpath d=%22M330 760l170-190 120 120 120-150 170 220z%22 fill=%22%23c9c5ba%22/%3E%3Ccircle cx=%22440%22 cy=%22410%22 r=%2270%22 fill=%22%23d8ff64%22/%3E%3C/svg%3E';

function humanizeLiquidIdentifier(value: string) {
  return value
    .split(/[.|]/)[0]
    .split(/[_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface ShopifyPreviewConfiguration {
  type?: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, ShopifyPreviewConfiguration>;
  block_order?: string[];
}

interface ShopifyLiquidPreviewContext {
  files: Record<string, HtmlProjectFile>;
  themeRoot: string;
  sourcePath: string;
  configuration?: ShopifyPreviewConfiguration;
  depth?: number;
  stack?: Set<string>;
}

function parseShopifyJsonDocument(source: string) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function shopifySchemaPreviewConfiguration(schemaBlock: string): ShopifyPreviewConfiguration {
  const source = schemaBlock
    .replace(/^{%\s*schema\s*%}/i, '')
    .replace(/{%\s*endschema\s*%}$/i, '')
    .trim();
  const schema = parseShopifyJsonDocument(source);
  if (!schema) return {};
  const settings: Record<string, unknown> = {};
  const collectDefaults = (items: unknown) => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const setting = item as { id?: unknown; default?: unknown };
      const id = String(setting.id || '').trim();
      if (id && setting.default !== undefined && setting.default !== null) settings[id] = setting.default;
    });
  };
  collectDefaults(schema.settings);
  const presets = Array.isArray(schema.presets) ? schema.presets : [];
  const preset = presets.find(item => item && typeof item === 'object') as ShopifyPreviewConfiguration | undefined;
  return {
    settings: { ...settings, ...(preset?.settings || {}) },
    ...(preset?.blocks ? { blocks: preset.blocks } : {}),
    ...(preset?.block_order ? { block_order: preset.block_order } : {}),
  };
}

function mergeShopifyPreviewConfiguration(
  fallback: ShopifyPreviewConfiguration,
  configured?: ShopifyPreviewConfiguration,
): ShopifyPreviewConfiguration {
  if (!configured) return fallback;
  return {
    ...fallback,
    ...configured,
    settings: { ...(fallback.settings || {}), ...(configured.settings || {}) },
    blocks: configured.blocks && Object.keys(configured.blocks).length
      ? configured.blocks
      : fallback.blocks,
    block_order: configured.block_order?.length ? configured.block_order : fallback.block_order,
  };
}

function shopifySectionPreviewConfiguration(
  files: Record<string, HtmlProjectFile>,
  root: string,
  sectionType: string,
): ShopifyPreviewConfiguration | undefined {
  const prefix = root ? `${root}/` : '';
  const candidates = Object.keys(files)
    .filter(path => (
      files[path]?.text !== undefined
      && path.startsWith(prefix)
      && /(?:^|\/)(?:sections|templates)\/[^/]+\.json$/i.test(path)
    ))
    .sort((left, right) => {
      const score = (path: string) => {
        if (new RegExp(`/sections/${sectionType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-group\\.json$`, 'i').test(`/${path}`)) return 0;
        if (/\/templates\/index\.json$/i.test(`/${path}`)) return 1;
        if (/\/sections\/[^/]+-group\.json$/i.test(`/${path}`)) return 2;
        return 3;
      };
      return score(left) - score(right) || left.localeCompare(right);
    });
  for (const path of candidates) {
    const document = parseShopifyJsonDocument(files[path].text || '');
    const sections = document?.sections;
    if (!sections || typeof sections !== 'object' || Array.isArray(sections)) continue;
    const records = sections as Record<string, unknown>;
    const order = Array.isArray(document?.order)
      ? (document.order as unknown[]).map(String).filter(id => Object.hasOwn(records, id))
      : [];
    const ids = [...order, ...Object.keys(records).filter(id => !order.includes(id))];
    for (const id of ids) {
      const configuration = records[id];
      if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) continue;
      const candidate = configuration as ShopifyPreviewConfiguration;
      if (String(candidate.type || '').toLowerCase() === sectionType.toLowerCase()) return candidate;
    }
  }
  return undefined;
}

function shopifyPreviewSettings(configuration?: ShopifyPreviewConfiguration) {
  return Object.fromEntries(Object.entries(configuration?.settings || {}).map(([key, value]) => [
    key,
    typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '',
  ]));
}

function liquidPreviewValue(token: string, attribute = '', settings: Record<string, string> = {}) {
  const expression = token.replace(/^{{-?\s*|\s*-?}}$/g, '').trim().toLowerCase();
  const key = expression.match(/(?:section|block)\.settings\.([a-z0-9_-]+)/)?.[1] || '';
  let configured = key && settings[key] !== undefined ? settings[key] : undefined;
  if (configured !== undefined && /{{|{%/.test(configured)) {
    if (/color|background|foreground/.test(key)) configured = '#eceae4';
    else if (/gap|width|height|size|count|columns|padding|margin|radius|opacity/.test(key)) configured = '0';
    else configured = 'Conteúdo de exemplo';
  }
  if (configured !== undefined && /^t:/.test(configured.trim())) configured = 'Texto traduzido';
  if (attribute === 'src' || attribute === 'poster' || attribute === 'srcset') {
    return configured && /^(?:https?:|data:|\.{0,2}\/)/i.test(configured)
      ? configured
      : SHOPIFY_PREVIEW_IMAGE;
  }
  if (attribute === 'href' || attribute === 'action') {
    if (configured && /^(?:https?:|#|\/)/i.test(configured)) return configured;
    if (configured?.includes('collection')) return '/collections/colecao-em-destaque';
    if (configured?.includes('product')) return '/products/produto-de-exemplo';
    if (/cart/.test(expression)) return '/cart';
    if (/collection/.test(expression)) return '/collections/colecao-em-destaque';
    if (/product|url/.test(expression)) return '/products/produto-de-exemplo';
    return '#';
  }
  if (configured !== undefined) return configured;
  if (attribute === 'id' || attribute === 'for') return 'shopify-preview';
  if (attribute === 'class') return '';
  if (attribute === 'style') return '--kodety-liquid-preview:1';
  if (/compare_at_price|price|money|amount/.test(expression)) return 'R$ 189,00';
  if (/product\.title|card_product\.title/.test(expression)) return 'Produto de exemplo';
  if (/collection\.title/.test(expression)) return 'Coleção em destaque';
  if (/article\.title|blog\.title/.test(expression)) return 'Novidades da loja';
  if (/shop\.name/.test(expression)) return 'Minha loja';
  if (/vendor|brand/.test(expression)) return 'Marca Shopify';
  if (/variant\.title|option/.test(expression)) return 'Opção padrão';
  if (/description|content|body_html/.test(expression)) return 'Uma descrição clara e envolvente para apresentar este conteúdo.';
  if (/quantity|count|index|size/.test(expression)) return '1';
  if (/date|created_at|published_at/.test(expression)) return '2 de agosto de 2026';
  if (/image|media|featured/.test(expression)) return '';
  if (key) {
    if (/heading|title/.test(key)) return 'Título da seção';
    if (/button|label|link/.test(key)) return 'Saiba mais';
    if (/text|description|caption|subheading/.test(key)) return 'Conteúdo de exemplo para editar visualmente.';
    return humanizeLiquidIdentifier(key) || 'Conteúdo de exemplo';
  }
  if (/\|\s*t\b|translation/.test(expression)) return 'Texto traduzido';
  return 'Conteúdo de exemplo';
}

function shopifyPreviewSourcePath(root: string, directory: 'blocks' | 'snippets', name: string) {
  const safeName = name.trim().replace(/\.liquid$/i, '');
  if (!/^[a-z0-9_-]+$/i.test(safeName)) return '';
  return `${root ? `${root}/` : ''}${directory}/${safeName}.liquid`;
}

function stripShopifyProjectionBindings(source: string) {
  return source
    .replace(/<!--\/?KODETY_LIQUID_OUTPUT:[a-z0-9]+-->/gi, '')
    .replace(/<!--KODETY_LIQUID:[a-z0-9]+-->/gi, '')
    .replace(/<!--KODETY_LIQUID_SCHEMA_BLOCK-->/g, '')
    .replace(/\sdata-kodety-liquid-(?:attr|control|output-attribute|rcdata)-[a-z0-9]+=(?:"[^"]*"|'[^']*')/gi, '');
}

function projectStaticShopifyLiquid(source: string, settings: Record<string, string>) {
  const tokens: Record<string, string> = {};
  let tokenIndex = 0;
  const tokenized = source.replace(/{{[-]?[\s\S]*?[-]?}}|{%[-]?[\s\S]*?[-]?%}/g, token => {
    const id = (++tokenIndex).toString(36).padStart(3, '0');
    tokens[id] = token;
    return token.startsWith('{{')
      ? `__KODETY_LIQUID_OUTPUT_${id}__`
      : `__KODETY_LIQUID_CONTROL_${id}__`;
  });
  return stripShopifyProjectionBindings(projectLiquidPreview(tokenized, tokens, settings).html);
}

function shopifyPreviewFallbackBlock(configuration: ShopifyPreviewConfiguration, type: string) {
  const values = Object.values(configuration.settings || {})
    .filter(value => typeof value === 'string' && value.trim() && !/^t:/.test(value.trim()))
    .map(value => String(value).trim())
    .slice(0, 4);
  const content = values.map(value => /^\s*</.test(value) ? value : `<p>${escapeHtml(value)}</p>`).join('');
  return `<div data-label="${escapeHtml(humanizeLiquidIdentifier(type) || 'Shopify Block')}" data-kodety-shopify-block-preview="true">${content || 'Conteúdo do bloco'}</div>`;
}

function renderShopifyPreviewFragment(
  sourcePath: string,
  context: ShopifyLiquidPreviewContext,
  configuration: ShopifyPreviewConfiguration = {},
): string {
  const depth = context.depth || 0;
  if (depth > 10) return '';
  const stack = context.stack || new Set<string>();
  if (stack.has(sourcePath)) return '';
  const file = context.files[sourcePath];
  if (file?.text === undefined) return shopifyPreviewFallbackBlock(configuration, configuration.type || 'block');
  stack.add(sourcePath);
  try {
    let schemaBlock = '';
    let source = file.text.replace(/{%[-]?\s*schema\s*[-]?%}[\s\S]*?{%[-]?\s*endschema\s*[-]?%}/i, match => {
      schemaBlock = match;
      return '';
    });
    const resolvedConfiguration = mergeShopifyPreviewConfiguration(
      shopifySchemaPreviewConfiguration(schemaBlock),
      configuration,
    );
    const childContext: ShopifyLiquidPreviewContext = {
      ...context,
      sourcePath,
      configuration: resolvedConfiguration,
      depth: depth + 1,
      stack,
    };
    source = source
      .replace(/{%[-]?\s*stylesheet\s*[-]?%}([\s\S]*?){%[-]?\s*endstylesheet\s*[-]?%}/gi, (_match, css: string) => `<style data-kodety-shopify-stylesheet>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
      .replace(/{%[-]?\s*style\s*[-]?%}([\s\S]*?){%[-]?\s*endstyle\s*[-]?%}/gi, (_match, css: string) => `<style data-kodety-shopify-style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
      .replace(/{%[-]?\s*javascript\s*[-]?%}[\s\S]*?{%[-]?\s*endjavascript\s*[-]?%}/gi, '')
      .replace(/{%[-]?\s*doc\s*[-]?%}[\s\S]*?{%[-]?\s*enddoc\s*[-]?%}/gi, '')
      .replace(/{%[-]?\s*comment\s*[-]?%}[\s\S]*?{%[-]?\s*endcomment\s*[-]?%}/gi, '')
      .replace(/{%[-]?\s*capture\b[\s\S]*?[-]?%}[\s\S]*?{%[-]?\s*endcapture\s*[-]?%}/gi, '');
    source = source.replace(/{%[-]?\s*content_for\s+['"]blocks['"][\s\S]*?[-]?%}/gi, () => (
      renderShopifyPreviewBlocks(childContext, resolvedConfiguration)
    ));
    source = source.replace(/{%[-]?\s*content_for\s+['"]block['"]([\s\S]*?)[-]?%}/gi, (_match, argumentsSource: string) => {
      const type = argumentsSource.match(/\btype\s*:\s*['"]([a-z0-9_-]+)['"]/i)?.[1] || '';
      const id = argumentsSource.match(/\bid\s*:\s*['"]([a-z0-9_-]+)['"]/i)?.[1] || '';
      const block = (id && resolvedConfiguration.blocks?.[id]) || { type };
      return renderShopifyPreviewBlock(childContext, block, id || type);
    });
    source = source.replace(/{%[-]?\s*(?:render|include)\s+['"]([a-z0-9_-]+)['"][\s\S]*?[-]?%}/gi, (_match, name: string) => {
      const snippetPath = shopifyPreviewSourcePath(context.themeRoot, 'snippets', name);
      return snippetPath ? renderShopifyPreviewFragment(snippetPath, childContext, resolvedConfiguration) : '';
    });
    return projectStaticShopifyLiquid(source, shopifyPreviewSettings(resolvedConfiguration));
  } finally {
    stack.delete(sourcePath);
  }
}

function shopifySemanticBlockPreview(
  context: ShopifyLiquidPreviewContext,
  configuration: ShopifyPreviewConfiguration,
  type: string,
): string | null {
  const normalized = type.replace(/^_+/, '').toLowerCase();
  const settings = configuration.settings || {};
  const setting = (...keys: string[]) => {
    for (const key of keys) {
      const value = settings[key];
      if (typeof value === 'string' && value.trim() && !/^t:/.test(value.trim())) return value.trim();
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    }
    return '';
  };
  const textMarkup = (fallback: string, ...keys: string[]) => {
    const value = setting(...keys) || fallback;
    return /^\s*</.test(value) ? value : escapeHtml(value);
  };
  if (/^(?:group|content|content-without-appearance)$/.test(normalized)) {
    const direction = setting('content_direction') === 'row' ? 'row' : 'column';
    const gap = Math.max(0, Math.min(100, Number(setting('gap')) || 16));
    return `<div data-label="Shopify Group" style="display:flex;flex-direction:${direction};gap:${gap}px;align-items:flex-start;min-width:0">${renderShopifyPreviewBlocks(context, configuration)}</div>`;
  }
  if (/^(?:text|inline-text|heading|title|rich-text)$/.test(normalized) || /(?:^|-)title$/.test(normalized)) {
    return `<div data-label="Shopify Text" style="max-width:100%;color:inherit">${textMarkup(
      /heading|title/.test(normalized) ? '<h3>Título de exemplo</h3>' : '<p>Conteúdo de exemplo</p>',
      'text', 'heading', 'title', 'content', 'description', 'caption',
    )}</div>`;
  }
  if (/menu|link-list|footer-links/.test(normalized)) {
    return `<nav data-label="Shopify Menu" style="display:grid;gap:10px;min-width:140px"><strong>${escapeHtml(setting('heading', 'title') || 'Links')}</strong><a href="#" style="color:inherit">Novidades</a><a href="#" style="color:inherit">Produtos</a><a href="#" style="color:inherit">Contato</a></nav>`;
  }
  if (/^(?:image|media|collection-image|product-card-image|blog-post-image)$/.test(normalized) || /(?:^|-)image$/.test(normalized)) {
    return `<img data-label="Shopify Image" src="${SHOPIFY_PREVIEW_IMAGE}" alt="${escapeHtml(setting('alt', 'heading', 'title') || 'Imagem de exemplo')}" style="display:block;width:100%;min-height:180px;aspect-ratio:4/3;object-fit:cover;background:#eceae4">`;
  }
  if (/logo/.test(normalized)) {
    return `<strong data-label="Shopify Logo" style="display:inline-flex;align-items:center;min-height:36px;font-size:20px;letter-spacing:.08em">${escapeHtml(setting('text', 'heading') || 'MINHA LOJA')}</strong>`;
  }
  if (/button|add-to-cart|buy-buttons/.test(normalized)) {
    return `<a data-label="Shopify Button" href="#" style="display:inline-flex;min-height:44px;padding:10px 18px;align-items:center;justify-content:center;border-radius:6px;background:#171717;color:#fff;text-decoration:none">${escapeHtml(setting('label', 'text', 'button_label') || (/cart|buy/.test(normalized) ? 'Adicionar ao carrinho' : 'Saiba mais'))}</a>`;
  }
  if (/email-signup|newsletter/.test(normalized)) {
    return '<form data-label="Shopify Newsletter" style="display:flex;gap:8px;flex-wrap:wrap"><input type="email" placeholder="seu@email.com" style="min-height:44px;padding:10px 12px;border:1px solid #c8c8c8"><button type="button" style="min-height:44px;padding:10px 16px">Cadastrar</button></form>';
  }
  if (/divider/.test(normalized)) return '<hr data-label="Shopify Divider" style="width:100%;border:0;border-top:1px solid currentColor;opacity:.2">';
  if (/spacer/.test(normalized)) return '<div data-label="Shopify Spacer" style="height:32px"></div>';
  if (/social|payment-icons/.test(normalized)) {
    return '<div data-label="Shopify Icons" style="display:flex;gap:8px;flex-wrap:wrap"><span>●</span><span>●</span><span>●</span></div>';
  }
  if (/price/.test(normalized)) return '<strong data-label="Shopify Price">R$ 189,00</strong>';
  if (/product/.test(normalized)) return '<article data-label="Shopify Product" style="display:grid;gap:10px"><h3>Produto de exemplo</h3><p>R$ 189,00</p></article>';
  return null;
}

function renderShopifyPreviewBlock(
  context: ShopifyLiquidPreviewContext,
  configuration: ShopifyPreviewConfiguration,
  id: string,
): string {
  const type = String(configuration.type || '').trim();
  if (!type || type.startsWith('@')) return '';
  const blockPath = shopifyPreviewSourcePath(context.themeRoot, 'blocks', type);
  const semantic: string | null = shopifySemanticBlockPreview(context, configuration, type);
  const content: string = semantic ?? (blockPath
    ? renderShopifyPreviewFragment(blockPath, context, configuration)
    : shopifyPreviewFallbackBlock(configuration, type));
  return `<div data-label="${escapeHtml(humanizeLiquidIdentifier(type) || type)}" data-kodety-shopify-block="${escapeHtml(id || type)}">${content}</div>`;
}

function renderShopifyPreviewBlocks(
  context: ShopifyLiquidPreviewContext,
  configuration: ShopifyPreviewConfiguration,
): string {
  const blocks = configuration.blocks || {};
  const declaredOrder = Array.isArray(configuration.block_order) ? configuration.block_order : [];
  const order = [...declaredOrder, ...Object.keys(blocks).filter(id => !declaredOrder.includes(id))];
  return order.map(id => renderShopifyPreviewBlock(context, blocks[id] || {}, id)).join('\n');
}

function shopifyControlPreview(token: string, context: ShopifyLiquidPreviewContext) {
  const configuration = context.configuration || {};
  if (/^{%[-]?\s*content_for\s+['"]blocks['"]/i.test(token)) {
    return renderShopifyPreviewBlocks(context, configuration);
  }
  const block = token.match(/^{%[-]?\s*content_for\s+['"]block['"]([\s\S]*?)[-]?%}$/i);
  if (block) {
    const type = block[1].match(/\btype\s*:\s*['"]([a-z0-9_-]+)['"]/i)?.[1] || '';
    const id = block[1].match(/\bid\s*:\s*['"]([a-z0-9_-]+)['"]/i)?.[1] || '';
    return renderShopifyPreviewBlock(context, (id && configuration.blocks?.[id]) || { type }, id || type);
  }
  const snippet = token.match(/^{%[-]?\s*(?:render|include)\s+['"]([a-z0-9_-]+)['"][\s\S]*?[-]?%}$/i);
  if (snippet) {
    const snippetPath = shopifyPreviewSourcePath(context.themeRoot, 'snippets', snippet[1]);
    return snippetPath ? renderShopifyPreviewFragment(snippetPath, context, configuration) : '';
  }
  return null;
}

function restoreLiquidSentinels(value: string, tokens: Record<string, string>) {
  return value.replace(/__KODETY_LIQUID_(?:OUTPUT|CONTROL)_([a-z0-9]+)__/gi, (_match, id: string) => tokens[id] || _match);
}

/**
 * Split markup without treating `>` inside quoted attributes as the end of a
 * start tag. Script and style bodies are emitted as one inert text part so
 * JavaScript comparisons and CSS strings cannot be mistaken for HTML.
 */
function splitLiquidPreviewMarkup(source: string) {
  const parts: string[] = [];
  const lower = source.toLowerCase();
  let cursor = 0;
  let rawElement = '';
  while (cursor < source.length) {
    const tagStart = rawElement
      ? lower.indexOf(`</${rawElement}`, cursor)
      : source.indexOf('<', cursor);
    if (tagStart < 0) {
      parts.push(source.slice(cursor));
      break;
    }
    if (tagStart > cursor) parts.push(source.slice(cursor, tagStart));
    let tagEnd = -1;
    if (source.startsWith('<!--', tagStart)) {
      const commentEnd = source.indexOf('-->', tagStart + 4);
      tagEnd = commentEnd < 0 ? source.length : commentEnd + 3;
    } else {
      let quote = '';
      for (let index = tagStart + 1; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
          if (character === quote && source[index - 1] !== '\\') quote = '';
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === '>') {
          tagEnd = index + 1;
          break;
        }
      }
      if (tagEnd < 0) tagEnd = source.length;
    }
    const tag = source.slice(tagStart, tagEnd);
    parts.push(tag);
    const closing = tag.match(/^<\s*\/\s*(script|style|textarea|title)\b/i)?.[1]?.toLowerCase() || '';
    if (closing && closing === rawElement) rawElement = '';
    if (!rawElement && !/^<\s*\//.test(tag) && !/\/\s*>$/.test(tag)) {
      rawElement = tag.match(/^<\s*(script|style|textarea|title)\b/i)?.[1]?.toLowerCase() || '';
    }
    cursor = tagEnd;
  }
  return parts;
}

function projectLiquidPreview(
  source: string,
  tokens: Record<string, string>,
  settings: Record<string, string>,
  previewOverrides: Record<string, string> = {},
) {
  const attributeBindings: NonNullable<ShopifyPreviewSource['attributeBindings']> = {};
  let bindingIndex = 0;
  let rawElement = '';
  const previewValueFor = (id: string, attribute = '') => {
    if (!Object.hasOwn(previewOverrides, id)) return liquidPreviewValue(tokens[id] || '', attribute, settings);
    const value = previewOverrides[id] || '';
    if (attribute === 'style') return '--kodety-liquid-preview:1';
    if (attribute === 'class') return '';
    return attribute ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : value;
  };
  const parts = splitLiquidPreviewMarkup(source);
  // RCDATA elements parse comment syntax as visible text. Bind their entire
  // authored value on the owning element and show only the human projection;
  // export later restores through a plain sentinel after DOM serialization.
  parts.forEach((part, index) => {
    if (!/^<\s*(textarea|title)\b/i.test(part)) return;
    const value = parts[index + 1] || '';
    if (!/__KODETY_LIQUID_(?:OUTPUT|CONTROL)_[a-z0-9]+__/i.test(value)) return;
    const sourceValue = restoreLiquidSentinels(value, tokens);
    const previewValue = value
      .replace(/__KODETY_LIQUID_OUTPUT_([a-z0-9]+)__/gi, (_token, id: string) => (
        previewValueFor(id)
      ))
      .replace(/__KODETY_LIQUID_CONTROL_[a-z0-9]+__/gi, '');
    const bindingId = (++bindingIndex).toString(36).padStart(3, '0');
    attributeBindings[bindingId] = { attribute: '#rcdata', sourceValue, previewValue };
    parts[index] = part.replace(/(\s*\/?>)$/, ` data-kodety-liquid-rcdata-${bindingId}=""$1`);
    parts[index + 1] = escapeHtml(previewValue);
  });
  const html = parts.map(part => {
    if (part.startsWith('<')) {
      const lower = part.toLowerCase();
      if (/^<\s*(script|style|textarea|title)(?:\s|>)/.test(lower)) rawElement = lower.match(/^<\s*(script|style|textarea|title)/)?.[1] || '';
      if (rawElement && new RegExp(`^<\\s*\\/${rawElement}\\s*>`).test(lower)) rawElement = '';
      if (/^<\s*\//.test(part) || /^<!--/.test(part) || !part.includes('__KODETY_LIQUID_')) return part;
      const markers: string[] = [];
      const projectedQuoted = part.replace(
        /(\s)([^\s=/>]+)(\s*=\s*)(["'])([\s\S]*?)\4/g,
        (match, spacing: string, attribute: string, equals: string, quote: string, value: string) => {
          if (!/__KODETY_LIQUID_(?:OUTPUT|CONTROL)_[a-z0-9]+__/i.test(value)) return match;
          const sourceValue = restoreLiquidSentinels(value, tokens);
          const previewValue = value
            .replace(/__KODETY_LIQUID_OUTPUT_([a-z0-9]+)__/gi, (_token, id: string) => (
              previewValueFor(id, attribute.toLowerCase())
            ))
            .replace(/__KODETY_LIQUID_CONTROL_[a-z0-9]+__/gi, '');
          const bindingId = (++bindingIndex).toString(36).padStart(3, '0');
          attributeBindings[bindingId] = {
            attribute,
            sourceValue,
            previewValue,
            sourceAttribute: `${attribute}${equals}${quote}${sourceValue}${quote}`,
          };
          markers.push(` data-kodety-liquid-attr-${bindingId}="${escapeHtml(attribute.toLowerCase())}"`);
          const escaped = quote === '"' ? previewValue.replaceAll('"', '&quot;') : previewValue.replaceAll("'", '&#39;');
          return `${spacing}${attribute}${equals}${quote}${escaped}${quote}`;
        },
      );
      const projected = projectedQuoted.replace(
        /(\s)([^\s=/>]+)(\s*=\s*)([^\s"'=<>`]+)/g,
        (match, spacing: string, attribute: string, equals: string, value: string) => {
          if (!/__KODETY_LIQUID_(?:OUTPUT|CONTROL)_[a-z0-9]+__/i.test(value)) return match;
          const sourceValue = restoreLiquidSentinels(value, tokens);
          const previewValue = value
            .replace(/__KODETY_LIQUID_OUTPUT_([a-z0-9]+)__/gi, (_token, id: string) => (
              previewValueFor(id, attribute.toLowerCase())
            ))
            .replace(/__KODETY_LIQUID_CONTROL_[a-z0-9]+__/gi, '');
          const bindingId = (++bindingIndex).toString(36).padStart(3, '0');
          attributeBindings[bindingId] = {
            attribute,
            sourceValue,
            previewValue,
            sourceAttribute: `${attribute}${equals}${sourceValue}`,
          };
          markers.push(` data-kodety-liquid-attr-${bindingId}="${escapeHtml(attribute.toLowerCase())}"`);
          return `${spacing}${attribute}${equals}"${previewValue.replaceAll('"', '&quot;')}"`;
        },
      );
      const withControlBindings = projected
        .replace(
        /__KODETY_LIQUID_CONTROL_([a-z0-9]+)__/gi,
        (_match, id: string) => ` data-kodety-liquid-control-${id}="" `,
        )
        .replace(
          /__KODETY_LIQUID_OUTPUT_([a-z0-9]+)__/gi,
          (_match, id: string) => ` data-kodety-liquid-output-attribute-${id}="" `,
        );
      return markers.length ? withControlBindings.replace(/(\s*\/?>)$/, `${markers.join('')}$1`) : withControlBindings;
    }
    if (rawElement) return part;
    return part
      .replace(/__KODETY_LIQUID_OUTPUT_([a-z0-9]+)__/gi, (_match, id: string) => {
        const value = previewValueFor(id);
        const preview = /^\s*</.test(value) ? value : escapeHtml(value);
        return `<!--KODETY_LIQUID_OUTPUT:${id}-->${preview}<!--/KODETY_LIQUID_OUTPUT:${id}-->`;
      })
      .replace(/__KODETY_LIQUID_CONTROL_([a-z0-9]+)__/gi, '<!--KODETY_LIQUID:$1-->');
  }).join('');
  return { html, attributeBindings };
}

function liquidPreviewSource(source: string, context?: ShopifyLiquidPreviewContext) {
  let schemaBlock = '';
  let withoutSchema = source.replace(/{%[-]?\s*schema\s*[-]?%}[\s\S]*?{%[-]?\s*endschema\s*[-]?%}/i, match => {
    schemaBlock = match;
    return '<!--KODETY_LIQUID_SCHEMA_BLOCK-->';
  });
  const configuration = mergeShopifyPreviewConfiguration(
    shopifySchemaPreviewConfiguration(schemaBlock),
    context?.configuration,
  );
  const resolvedContext = context ? { ...context, configuration } : undefined;
  const tokens: Record<string, string> = {};
  const previewOverrides: Record<string, string> = {};
  let tokenIndex = 0;
  const previewToken = (token: string, preview: string) => {
    const id = (++tokenIndex).toString(36).padStart(3, '0');
    tokens[id] = token;
    previewOverrides[id] = preview;
    return `__KODETY_LIQUID_OUTPUT_${id}__`;
  };
  withoutSchema = withoutSchema
    .replace(/{%[-]?\s*stylesheet\s*[-]?%}([\s\S]*?){%[-]?\s*endstylesheet\s*[-]?%}/gi, (token, css: string) => (
      previewToken(token, `<style data-kodety-shopify-stylesheet>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
    ))
    .replace(/{%[-]?\s*style\s*[-]?%}([\s\S]*?){%[-]?\s*endstyle\s*[-]?%}/gi, (token, css: string) => (
      previewToken(token, `<style data-kodety-shopify-style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
    ))
    .replace(/{%[-]?\s*javascript\s*[-]?%}[\s\S]*?{%[-]?\s*endjavascript\s*[-]?%}/gi, token => (
      previewToken(token, '')
    ))
    .replace(/{%[-]?\s*doc\s*[-]?%}[\s\S]*?{%[-]?\s*enddoc\s*[-]?%}/gi, token => (
      previewToken(token, '')
    ))
    .replace(/{%[-]?\s*comment\s*[-]?%}[\s\S]*?{%[-]?\s*endcomment\s*[-]?%}/gi, token => (
      previewToken(token, '')
    ))
    .replace(/{%[-]?\s*capture\b[\s\S]*?[-]?%}[\s\S]*?{%[-]?\s*endcapture\s*[-]?%}/gi, token => (
      previewToken(token, '')
    ));
  if (resolvedContext) {
    withoutSchema = withoutSchema.replace(/{%[-]?[\s\S]*?[-]?%}/g, token => {
      const preview = shopifyControlPreview(token, resolvedContext);
      return preview === null ? token : previewToken(token, preview);
    });
  }
  const tokenized = withoutSchema.replace(/{{[-]?[\s\S]*?[-]?}}|{%[-]?[\s\S]*?[-]?%}/g, token => {
    const id = (++tokenIndex).toString(36).padStart(3, '0');
    tokens[id] = token;
    return token.startsWith('{{')
      ? `__KODETY_LIQUID_OUTPUT_${id}__`
      : `__KODETY_LIQUID_CONTROL_${id}__`;
  });
  const projected = projectLiquidPreview(
    tokenized,
    tokens,
    shopifyPreviewSettings(configuration),
    previewOverrides,
  );
  const tableControlGroups = Array.from(tokenized.matchAll(
    /((?:__KODETY_LIQUID_CONTROL_[a-z0-9]+__\s*)+)(?=<tr\b)/gi,
  )).map(match => Array.from(match[1].matchAll(
    /__KODETY_LIQUID_CONTROL_([a-z0-9]+)__/gi,
  ), token => token[1]));
  return { html: projected.html, tokens, attributeBindings: projected.attributeBindings, tableControlGroups, schemaBlock };
}

function shopifyStylesheetLinks(files: Record<string, HtmlProjectFile>, root: string, previewPath: string) {
  const assetPrefix = root ? `${root}/assets/` : 'assets/';
  return Object.keys(files)
    .filter(path => path.startsWith(assetPrefix) && /\.css$/i.test(path))
    .sort()
    .map(path => `<link rel="stylesheet" href="${escapeHtml(relativeProjectReference(previewPath, path))}">`)
    .join('\n  ');
}

function shopifyPreviewDocument(
  name: string,
  sourcePath: string,
  sourceHtml: string,
  stylesheets: string,
) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(name)} — Shopify</title>
  ${stylesheets}
</head>
<body data-label="Shopify Section Preview" data-kodety-shopify-preview="true">
  <main data-kodety-shopify-source-root data-kodety-shopify-source="${escapeHtml(sourcePath)}">
${sourceHtml}
  </main>
</body>
</html>`;
}

export function prepareShopifyThemeFiles(
  files: Record<string, HtmlProjectFile>,
  fallbackName: string,
): Record<string, HtmlProjectFile> {
  if (files[SHOPIFY_THEME_METADATA_PATH]?.text) return files;
  const themeRoot = shopifyThemeRoot(files);
  if (themeRoot === null) return files;
  const sectionPrefix = themeRoot ? `${themeRoot}/sections/` : 'sections/';
  const sections = Object.keys(files)
    .filter(path => path.startsWith(sectionPrefix) && /\.liquid$/i.test(path) && files[path]?.text !== undefined)
    .sort();
  if (!sections.length) return files;
  const preferred = sections.find(path => /\/(?:main-product|main-collection|featured-collection|image-banner)\.liquid$/i.test(`/${path}`)) || sections[0];
  const ordered = [preferred, ...sections.filter(path => path !== preferred)];
  const next = { ...files };
  const previewSources: Record<string, ShopifyPreviewSource> = {};
  const themeName = shopifyThemeName(files, themeRoot, fallbackName);
  ordered.slice(0, 160).forEach((sourcePath, index) => {
    const stem = sourcePath.split('/').pop()?.replace(/\.liquid$/i, '') || `section-${index + 1}`;
    const previewPath = index === 0 ? 'index.html' : `shopify-preview/${stem}.html`;
    const converted = liquidPreviewSource(files[sourcePath].text || '', {
      files,
      themeRoot,
      sourcePath,
      configuration: shopifySectionPreviewConfiguration(files, themeRoot, stem),
      stack: new Set<string>(),
    });
    const previewText = shopifyPreviewDocument(
      stem.replaceAll('-', ' '),
      sourcePath,
      converted.html,
      shopifyStylesheetLinks(files, themeRoot, previewPath),
    );
    next[previewPath] = {
      path: previewPath,
      mimeType: 'text/html',
      text: previewText,
    };
    previewSources[previewPath] = {
      sourcePath,
      tokens: converted.tokens,
      ...(Object.keys(converted.attributeBindings).length ? { attributeBindings: converted.attributeBindings } : {}),
      ...(converted.tableControlGroups.length ? { tableControlGroups: converted.tableControlGroups } : {}),
      sourceDigest: shopifySourceDigest(files[sourcePath].text || ''),
      previewDigest: shopifySourceDigest(previewText),
      ...(converted.schemaBlock ? { schemaBlock: converted.schemaBlock } : {}),
    };
  });
  const themeMetadata: ShopifyThemeMetadata = {
    version: 1,
    kind: 'shopify-theme',
    themeRoot,
    previewSources,
  };
  next[SHOPIFY_THEME_METADATA_PATH] = {
    path: SHOPIFY_THEME_METADATA_PATH,
    mimeType: 'application/json',
    text: JSON.stringify(themeMetadata, null, 2),
  };
  next['.incode/project.json'] = {
    path: '.incode/project.json',
    mimeType: 'application/json',
    text: JSON.stringify({
      version: 1,
      name: themeName,
      mainHtmlPath: 'index.html',
      homeHtmlPath: 'index.html',
      rootPath: '',
    }, null, 2),
  };
  return next;
}

function readShopifyThemeMetadata(project: HtmlProject): ShopifyThemeMetadata | null {
  try {
    const parsed = JSON.parse(project.files[SHOPIFY_THEME_METADATA_PATH]?.text || 'null') as ShopifyThemeMetadata | null;
    return parsed?.version === 1 && parsed.kind === 'shopify-theme' && parsed.previewSources
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function isShopifyThemeProject(project: HtmlProject | null | undefined) {
  return Boolean(project && readShopifyThemeMetadata(project));
}

function splitLiquidStyleDeclarations(value: string) {
  const declarations: Array<{ name: string; value: string; raw: string }> = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  const consume = (end: number) => {
    const raw = value.slice(start, end).trim();
    start = end + 1;
    if (!raw) return;
    let colon = -1;
    let innerQuote = '';
    let innerDepth = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const character = raw[index];
      if (innerQuote) {
        if (character === innerQuote && raw[index - 1] !== '\\') innerQuote = '';
        continue;
      }
      if (character === '"' || character === "'") innerQuote = character;
      else if (character === '(' || character === '[') innerDepth += 1;
      else if (character === ')' || character === ']') innerDepth = Math.max(0, innerDepth - 1);
      else if (character === ':' && innerDepth === 0) { colon = index; break; }
    }
    if (colon < 1) return;
    const name = raw.slice(0, colon).trim();
    const declarationValue = raw.slice(colon + 1).trim();
    if (name) declarations.push({ name, value: declarationValue, raw: `${name}:${declarationValue}` });
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ';' && depth === 0) consume(index);
  }
  consume(value.length);
  return declarations;
}

function mergeLiquidBoundAttribute(
  binding: NonNullable<ShopifyPreviewSource['attributeBindings']>[string],
  currentValue: string,
) {
  const attribute = binding.attribute.toLowerCase();
  if (attribute === 'class') {
    const baseline = new Set(binding.previewValue.split(/\s+/).filter(Boolean));
    const current = new Set(currentValue.split(/\s+/).filter(Boolean));
    const additions = Array.from(current).filter(value => !baseline.has(value));
    // Removing a projected class is ambiguous because that class may be
    // conditional Liquid. Preserve the source binding; safe additions still
    // become authored classes beside it.
    return additions.length
      ? `${binding.sourceValue.trim()} ${additions.join(' ')}`.trim()
      : binding.sourceValue;
  }
  if (attribute === 'style') {
    const baseline = new Map(splitLiquidStyleDeclarations(binding.previewValue).map(item => [item.name.toLowerCase(), item.value]));
    const overrides = splitLiquidStyleDeclarations(currentValue).filter(item => (
      item.name.toLowerCase() !== '--kodety-liquid-preview'
      && baseline.get(item.name.toLowerCase()) !== item.value
    ));
    if (!overrides.length) return binding.sourceValue;
    const source = binding.sourceValue.trim();
    return `${source}${source && !source.endsWith(';') ? ';' : ''}${overrides.map(item => item.raw).join(';')}`;
  }
  return null;
}

function liquidSourceAttribute(
  binding: NonNullable<ShopifyPreviewSource['attributeBindings']>[string],
  value: string,
) {
  if (binding.sourceAttribute) {
    const offset = binding.sourceAttribute.indexOf(binding.sourceValue);
    if (offset >= 0) {
      return `${binding.sourceAttribute.slice(0, offset)}${value}${binding.sourceAttribute.slice(offset + binding.sourceValue.length)}`;
    }
    return binding.sourceAttribute;
  }
  return `${binding.attribute}="${value}"`;
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function materializeShopifyPreview(project: HtmlProject, previewPath: string, source: ShopifyPreviewSource) {
  const currentSource = project.files[source.sourcePath]?.text;
  const preview = project.files[previewPath]?.text;
  if (preview === undefined) return currentSource || '';
  const sourceChanged = Boolean(
    source.sourceDigest
    && currentSource !== undefined
    && shopifySourceDigest(currentSource) !== source.sourceDigest
  );
  const previewChanged = !source.previewDigest || shopifySourceDigest(preview) !== source.previewDigest;
  if (sourceChanged && previewChanged) {
    throw new Error(`“${source.sourcePath}” foi alterado simultaneamente no Code e no canvas. Reabra a prévia após salvar o Liquid para escolher uma única versão antes de exportar.`);
  }
  if (sourceChanged || !previewChanged) return currentSource || '';
  const document = new DOMParser().parseFromString(preview, 'text/html');
  const root = document.querySelector('[data-kodety-shopify-source-root]');
  if (!root) throw new Error(`A área Liquid editável de “${source.sourcePath}” foi removida. Desfaça essa alteração antes de exportar.`);
  const attributeRestorations: Array<{ attribute: string; sentinel: string; sourceAttribute: string }> = [];
  const rcdataRestorations: Array<{ id: string; sourceValue: string }> = [];
  root.querySelectorAll('*').forEach(element => {
    Array.from(element.attributes).forEach(attribute => {
      const rcdataMatch = attribute.name.match(/^data-kodety-liquid-rcdata-([a-z0-9]+)$/i);
      if (rcdataMatch) {
        const binding = source.attributeBindings?.[rcdataMatch[1]];
        if (binding?.attribute === '#rcdata') {
          rcdataRestorations.push({ id: rcdataMatch[1], sourceValue: binding.sourceValue });
        }
        return;
      }
      const match = attribute.name.match(/^data-kodety-liquid-attr-([a-z0-9]+)$/i);
      if (!match) return;
      const binding = source.attributeBindings?.[match[1]];
      if (binding) {
        const currentValue = element.getAttribute(binding.attribute);
        const restoredValue = currentValue === binding.previewValue
          ? binding.sourceValue
          : mergeLiquidBoundAttribute(binding, currentValue || '');
        if (restoredValue !== null) {
          const sentinel = `__KODETY_LIQUID_ATTRIBUTE_${match[1]}__`;
          element.setAttribute(binding.attribute, sentinel);
          attributeRestorations.push({
            attribute: binding.attribute,
            sentinel,
            sourceAttribute: liquidSourceAttribute(binding, restoredValue),
          });
        }
      }
      element.removeAttribute(attribute.name);
    });
  });
  root.removeAttribute('data-kodety-shopify-source-root');
  root.removeAttribute('data-kodety-shopify-source');
  let liquid = root.innerHTML.trim();
  rcdataRestorations.forEach(restoration => {
    liquid = liquid.replace(
      new RegExp(`<((?:textarea|title))\\b([^>]*?)\\sdata-kodety-liquid-rcdata-${restoration.id}=(?:""|'')([^>]*)>[\\s\\S]*?<\\/\\1>`, 'i'),
      (_match, tag: string, before: string, after: string) => `<${tag}${before}${after}>${restoration.sourceValue}</${tag}>`,
    );
  });
  attributeRestorations.forEach(restoration => {
    liquid = liquid.replace(
      new RegExp(`${escapeRegularExpression(restoration.attribute)}="${restoration.sentinel}"`, 'i'),
      restoration.sourceAttribute,
    );
  });
  // HTML parsers insert an implicit tbody before a tr. Move only the exact
  // source control groups known to have preceded that tr into the generated
  // tbody, keeping loops/branches structurally valid after visual edits.
  (source.tableControlGroups || []).forEach(group => {
    if (!group.length) return;
    const markers = group
      .map(id => `<!--KODETY_LIQUID:${id}-->`)
      .join('\\s*');
    liquid = liquid.replace(
      new RegExp(`(${markers}\\s*)(<tbody\\b[^>]*>)`, 'i'),
      '$2$1',
    );
  });
  Object.entries(source.tokens).forEach(([id, token]) => {
    liquid = liquid
      .replace(new RegExp(`<!--KODETY_LIQUID_OUTPUT:${id}-->[\\s\\S]*?<!--\\/KODETY_LIQUID_OUTPUT:${id}-->`, 'g'), token)
      .replace(new RegExp(`\\s*data-kodety-liquid-control-${id}=(?:""|'')\\s*`, 'gi'), ` ${token} `)
      .replace(new RegExp(`\\s*data-kodety-liquid-output-attribute-${id}=(?:""|'')\\s*`, 'gi'), ` ${token} `)
      .replaceAll(`<!--KODETY_LIQUID:${id}-->`, token)
      .replaceAll(`__KODETY_LIQUID_OUTPUT_${id}__`, token)
      .replaceAll(`__KODETY_LIQUID_CONTROL_${id}__`, token)
      .replaceAll(`__KODETY_LIQUID_${id}__`, token);
  });
  if (source.schemaBlock) {
    liquid = liquid.includes('<!--KODETY_LIQUID_SCHEMA_BLOCK-->')
      ? liquid.replace('<!--KODETY_LIQUID_SCHEMA_BLOCK-->', source.schemaBlock)
      : `${liquid}\n${source.schemaBlock}`;
  }
  return `${liquid}\n`;
}

/**
 * Convert Builder-only Shopify previews back into their original Liquid files.
 * Normal exports and synchronized-folder writes both use this representation,
 * so Liquid behaves like any other project source instead of requiring a
 * separate export surface.
 */
export function materializeLiquidProject(project: HtmlProject): HtmlProject {
  const metadata = readShopifyThemeMetadata(project);
  if (!metadata) return project;
  const previewPaths = new Set(Object.keys(metadata.previewSources));
  const files: Record<string, HtmlProjectFile> = {};
  Object.values(project.files).forEach(file => {
    if (
      file.path === SHOPIFY_THEME_METADATA_PATH
      || file.path === '.incode/project.json'
      || previewPaths.has(file.path)
    ) return;
    files[file.path] = file;
  });
  Object.entries(metadata.previewSources).forEach(([previewPath, source]) => {
    const original = project.files[source.sourcePath];
    if (!original) return;
    files[source.sourcePath] = {
      path: original.path,
      mimeType: original.mimeType,
      text: materializeShopifyPreview(project, previewPath, source),
    };
  });
  return { ...project, files };
}

export async function shopifyThemeToZipBlob(project: HtmlProject) {
  project = stripProjectPriorities(project);
  const metadata = readShopifyThemeMetadata(project);
  if (!metadata) throw new Error('Este projeto não contém um tema Shopify importado.');
  const materializedProject = stripProjectPriorities(materializeLiquidProject(project));
  const editorMetadata = readEditorMetadata(project);
  const interactionIds = new Set<string>();
  const interactions = Object.keys(metadata.previewSources).flatMap(previewPath => (
    readInteractionDocumentFile(project, previewPath).interactions.filter(interaction => {
      if (interactionIds.has(interaction.id)) return false;
      interactionIds.add(interaction.id);
      return true;
    })
  ));
  const designTokenCss = editorMetadata.designTokens?.tokens
    .map(token => {
      const id = String(token.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      return id ? `  --kodety-token-${id}: ${String(token.value || 'initial').replace(/<\/style/gi, '<\\/style')};` : '';
    })
    .filter(Boolean)
    .join('\n') || '';
  const zip = new JSZip();
  const rootPrefix = metadata.themeRoot ? `${metadata.themeRoot}/` : '';
  const themeFiles = Object.values(materializedProject.files).filter(file => (
    !rootPrefix || file.path.startsWith(rootPrefix)
  ));
  const usesNativeComponents = themeFiles.some(file => (
    file.text !== undefined
    && /(?:data-kodety-overlay|data-kodety-lightbox|data-kodety-locale-selector)/.test(file.text)
  ));
  themeFiles.forEach(file => {
    if (rootPrefix && !file.path.startsWith(rootPrefix)) return;
    const relative = rootPrefix ? file.path.slice(rootPrefix.length) : file.path;
    const directory = relative.split('/')[0];
    if (!SHOPIFY_THEME_DIRECTORIES.has(directory)) return;
    let content = file.text ?? file.data ?? new Uint8Array();
    if (file.text !== undefined && /^layout\/[^/]+\.liquid$/i.test(relative)) {
      let layout = file.text;
      if (designTokenCss) {
        const style = `<style data-kodety-design-tokens>\n:root {\n${designTokenCss}\n}\n</style>\n`;
        layout = /<\/head\s*>/i.test(layout) ? layout.replace(/<\/head\s*>/i, `${style}</head>`) : `${style}${layout}`;
      }
      if (interactions.length) {
        const currentInteractions = readInteractionDocument(layout).interactions;
        const nextIds = new Set(interactions.map(interaction => interaction.id));
        layout = patchInteractionDocument(layout, {
          version: 2,
          interactions: [
            ...currentInteractions.filter(interaction => !nextIds.has(interaction.id)),
            ...interactions,
          ],
        });
      }
      // A reimported Shopify ZIP has no authoring metadata. In that case the
      // already-compiled blocks in theme.liquid are canonical and must remain.
      if (Object.prototype.hasOwnProperty.call(editorMetadata, 'customCode')) {
        layout = applyCustomCodeToHtml(layout, editorMetadata.customCode, project.mainHtmlPath);
      }
      const layoutUsesNativeComponents = usesNativeComponents
        || /(?:data-kodety-overlay|data-kodety-lightbox|data-kodety-locale-selector)/.test(layout);
      content = layoutUsesNativeComponents ? injectNativeComponentsRuntime(layout, true) : layout;
    }
    zip.file(relative, content);
  });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
}

function shopifyAssetName(path: string, used: Set<string>) {
  const normalized = normalizePath(path);
  const extensionMatch = normalized.match(/(\.[a-z0-9]{1,12})$/i);
  const suffix = extensionMatch?.[1].toLowerCase() || '';
  const stem = normalized
    .slice(0, suffix ? -suffix.length : undefined)
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'asset';
  let candidate = `${stem}${suffix}`;
  let index = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem}-${index++}${suffix}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function resolveLocalProjectPath(fromPath: string, reference: string) {
  const clean = reference.trim().replace(/^['"]|['"]$/g, '');
  if (!clean || /^(?:[a-z]+:|#|\/\/|data:|blob:|{{|{%)/i.test(clean)) return '';
  const pathOnly = clean.split(/[?#]/, 1)[0];
  return normalizePath(pathOnly.startsWith('/') ? pathOnly.slice(1) : `${dirname(fromPath)}/${pathOnly}`);
}

function rewriteShopifyAssetReferences(
  source: string,
  sourcePath: string,
  assets: Map<string, string>,
  liquid: boolean,
) {
  const replace = (reference: string) => {
    const resolved = resolveLocalProjectPath(sourcePath, reference);
    const asset = assets.get(resolved);
    if (!asset) return reference;
    return liquid ? `{{ '${asset}' | asset_url }}` : asset;
  };
  let next = source.replace(
    /\b(src|href|poster)=(['"])([^'"]+)\2/gi,
    (_match, attribute: string, quote: string, reference: string) => `${attribute}=${quote}${replace(reference)}${quote}`,
  );
  next = next.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (_match, quote: string, reference: string) => {
    const rewritten = replace(reference);
    return `url(${quote}${rewritten}${quote})`;
  });
  return next;
}

function shopifySectionType(path: string, index: number) {
  const stem = path.split('/').pop()?.replace(/\.html?$/i, '').toLowerCase() || `page-${index + 1}`;
  if (/^(?:index|home)$/.test(stem)) return 'kodety-home';
  if (/product/.test(stem)) return 'kodety-product';
  if (/collection|shop/.test(stem)) return 'kodety-collection';
  if (/cart/.test(stem)) return 'kodety-cart';
  if (/search/.test(stem)) return 'kodety-search';
  if (/404/.test(stem)) return 'kodety-404';
  return `kodety-page-${index + 1}`.slice(0, 25);
}

function shopifyTemplatePath(path: string, sectionType: string, isHome: boolean) {
  if (isHome) return 'templates/index.json';
  if (sectionType === 'kodety-product') return 'templates/product.json';
  if (sectionType === 'kodety-collection') return 'templates/collection.json';
  if (sectionType === 'kodety-cart') return 'templates/cart.json';
  if (sectionType === 'kodety-search') return 'templates/search.json';
  if (sectionType === 'kodety-404') return 'templates/404.json';
  const stem = path.split('/').pop()?.replace(/\.html?$/i, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'page';
  return `templates/page.${stem}.json`;
}

function materializeShopifyCommerce(document: Document) {
  const liquidTokens = new Map<string, string>();
  let tokenIndex = 0;
  const liquid = (source: string) => {
    const token = `__KODETY_SHOPIFY_LIQUID_${(++tokenIndex).toString(36).padStart(4, '0')}__`;
    liquidTokens.set(token, source);
    return token;
  };
  const setContent = (selector: string, source: string, root: ParentNode = document) => {
    root.querySelectorAll<HTMLElement>(selector).forEach(element => { element.textContent = liquid(source); });
  };
  const bindProduct = (root: ParentNode, variable: string, detail = false) => {
    setContent('[data-kodefy-product-title]', `{{ ${variable}.title }}`, root);
    setContent('[data-kodefy-product-vendor]', `{{ ${variable}.vendor }}`, root);
    setContent('[data-kodefy-product-price]', `{{ ${variable}.price | money }}`, root);
    setContent('[data-kodefy-product-compare-price]', `{{ ${variable}.compare_at_price | money }}`, root);
    root.querySelectorAll<HTMLElement>('[data-kodefy-product-compare-price]').forEach(element => {
      element.removeAttribute('hidden');
    });
    root.querySelectorAll<HTMLAnchorElement>('[data-kodefy-product-link]').forEach(link => {
      link.setAttribute('href', liquid(`{{ ${variable}.url }}`));
    });
    root.querySelectorAll<HTMLImageElement>('[data-kodefy-product-image], [data-kodefy-gallery-main]').forEach(image => {
      image.setAttribute('src', liquid(`{{ ${variable}.featured_image | image_url: width: 1600 }}`));
      image.setAttribute('alt', liquid(`{{ ${variable}.featured_image.alt | default: ${variable}.title | escape }}`));
    });
    if (detail) {
      root.querySelectorAll<HTMLElement>('[data-kodefy-product-description]').forEach(element => {
        element.textContent = liquid(`{{ ${variable}.description }}`);
      });
      root.querySelectorAll<HTMLSelectElement>('[data-kodefy-variant]').forEach(select => {
        select.name = 'id';
        select.innerHTML = liquid(`{% for variant in ${variable}.variants %}<option value="{{ variant.id }}"{% unless variant.available %} disabled{% endunless %}{% if variant == ${variable}.selected_or_first_available_variant %} selected{% endif %}>{{ variant.title }} — {{ variant.price | money }}</option>{% endfor %}`);
      });
      root.querySelectorAll<HTMLInputElement>('[data-kodefy-product-quantity]').forEach(input => {
        input.name = 'quantity';
        input.value = '1';
        input.min = '1';
      });
      setContent('[data-kodefy-inventory]', `{% if ${variable}.selected_or_first_available_variant.available %}Em estoque{% else %}Esgotado{% endif %}`, root);
    }
    root.querySelectorAll<HTMLButtonElement>('[data-kodefy-add]').forEach((button, index) => {
      button.type = 'submit';
      button.name = 'add';
      const existingForm = button.closest('form');
      const form = existingForm || document.createElement('form');
      form.method = 'post';
      form.action = '/cart/add';
      form.setAttribute('accept-charset', 'UTF-8');
      if (!existingForm && button.parentNode) {
        button.parentNode.insertBefore(form, button);
        form.append(button);
      }
      if (
        !form.querySelector('input[name="id"]')
        && !form.querySelector('select[name="id"]')
        && !(detail && root.querySelector('select[name="id"]'))
      ) {
        const variant = document.createElement('input');
        variant.type = 'hidden';
        variant.name = 'id';
        variant.value = liquid(`{{ ${variable}.selected_or_first_available_variant.id }}`);
        form.prepend(variant);
      }
      if (detail) {
        const formId = form.id || `kodety-product-form-${index + 1}`;
        form.id = formId;
        root.querySelectorAll<HTMLSelectElement>('[data-kodefy-variant]').forEach(select => select.setAttribute('form', formId));
        root.querySelectorAll<HTMLInputElement>('[data-kodefy-product-quantity]').forEach(input => input.setAttribute('form', formId));
        button.setAttribute('form', formId);
      }
    });
  };

  document.querySelectorAll<HTMLElement>('[data-kodefy-product-detail]').forEach(root => bindProduct(root, 'product', true));
  setContent('[data-kodefy-collection-title]', '{{ collection.title }}');
  setContent('[data-kodefy-collection-description]', '{{ collection.description }}');
  setContent('[data-kodefy-search-query]', '{{ search.terms | escape }}');
  document.querySelectorAll<HTMLFormElement>('[data-kodefy-search-form]').forEach(form => {
    form.method = 'get';
    form.action = '/search';
    const type = document.createElement('input');
    type.type = 'hidden';
    type.name = 'type';
    type.value = 'product';
    form.prepend(type);
  });
  setContent('[data-kodefy-cart-count]', '{{ cart.item_count }}');
  setContent('[data-kodefy-cart-total], [data-kodefy-checkout-total]', '{{ cart.total_price | money }}');
  document.querySelectorAll<HTMLElement>('[data-kodefy-cart-items], [data-kodefy-checkout-items]').forEach(container => {
    const item = container.querySelector<HTMLElement>('[data-kodefy-cart-item], [data-kodefy-checkout-item]');
    if (!item || !item.parentNode) return;
    item.removeAttribute('data-kodefy-template');
    item.removeAttribute('hidden');
    setContent('[data-kodefy-cart-item-title], [data-kodefy-checkout-item-title]', '{{ line_item.product.title }}', item);
    setContent('[data-kodefy-cart-item-options], [data-kodefy-checkout-item-options]', '{{ line_item.variant.title }} · {{ line_item.quantity }} item(ns)', item);
    setContent('[data-kodefy-cart-item-price], [data-kodefy-checkout-item-price]', '{{ line_item.final_line_price | money }}', item);
    item.querySelectorAll<HTMLAnchorElement>('[data-kodefy-cart-item-link]').forEach(link => link.setAttribute('href', liquid('{{ line_item.url }}')));
    item.querySelectorAll<HTMLImageElement>('[data-kodefy-cart-item-image], [data-kodefy-checkout-item-image]').forEach(image => {
      image.setAttribute('src', liquid('{{ line_item.image | image_url: width: 320 }}'));
      image.setAttribute('alt', liquid('{{ line_item.image.alt | default: line_item.product.title | escape }}'));
    });
    item.querySelectorAll<HTMLInputElement>('[data-kodefy-cart-quantity]').forEach(input => {
      input.name = 'updates[]';
      input.value = liquid('{{ line_item.quantity }}');
    });
    item.querySelectorAll<HTMLElement>('[data-kodefy-cart-remove]').forEach(control => {
      const anchor = document.createElement('a');
      Array.from(control.attributes).forEach(attribute => {
        if (attribute.name !== 'type') anchor.setAttribute(attribute.name, attribute.value);
      });
      anchor.href = liquid('/cart/change?id={{ line_item.key }}&quantity=0');
      anchor.innerHTML = control.innerHTML;
      control.replaceWith(anchor);
    });
    item.parentNode.insertBefore(document.createTextNode(liquid('{% for line_item in cart.items %}')), item);
    if (item.nextSibling) item.parentNode.insertBefore(document.createTextNode(liquid('{% else %}<p>Seu carrinho está vazio.</p>{% endfor %}')), item.nextSibling);
    else item.parentNode.appendChild(document.createTextNode(liquid('{% else %}<p>Seu carrinho está vazio.</p>{% endfor %}')));
  });
  document.querySelectorAll<HTMLElement>('[data-kodefy-checkout], [data-kodefy-checkout-confirm]').forEach(control => {
    const anchor = document.createElement('a');
    Array.from(control.attributes).forEach(attribute => {
      if (attribute.name !== 'type') anchor.setAttribute(attribute.name, attribute.value);
    });
    anchor.href = '/checkout';
    anchor.innerHTML = control.innerHTML;
    control.replaceWith(anchor);
  });

  document.querySelectorAll<HTMLElement>('[data-kodefy-products], [data-kodefy-collection-products], [data-kodefy-search-results]').forEach(container => {
    const card = container.querySelector<HTMLElement>('[data-kodefy-product-card]');
    if (!card || !card.parentNode) return;
    bindProduct(card, 'card_product');
    card.removeAttribute('data-kodefy-template');
    card.removeAttribute('hidden');
    const limit = Math.max(1, Math.min(50, Number(container.getAttribute('data-limit')) || 12));
    const empty = container.getAttribute('data-empty-message') || 'Nenhum produto disponível.';
    const collectionSource = container.hasAttribute('data-kodefy-collection-products')
      ? 'collection.products'
      : container.hasAttribute('data-kodefy-search-results')
        ? 'search.results'
        : 'collections.all.products';
    card.parentNode.insertBefore(document.createTextNode(liquid(`{% for card_product in ${collectionSource} limit: ${limit} %}{% if card_product.object_type == blank or card_product.object_type == 'product' %}`)), card);
    if (card.nextSibling) card.parentNode.insertBefore(document.createTextNode(liquid(`{% endif %}{% else %}<p>${escapeHtml(empty)}</p>{% endfor %}`)), card.nextSibling);
    else card.parentNode.appendChild(document.createTextNode(liquid(`{% endif %}{% else %}<p>${escapeHtml(empty)}</p>{% endfor %}`)));
  });

  return (source: string) => {
    let output = source;
    liquidTokens.forEach((value, token) => { output = output.replaceAll(token, value); });
    return output;
  };
}

/** Convert an ordinary Builder project into a valid Shopify Online Store 2.0
 * theme. The command is exposed by the UI only while the Shopify extension is
 * active; keeping the converter here lets the normal Export flow operate on
 * the exact unsaved canvas snapshot without uploading it to another endpoint. */
export async function convertProjectToShopifyThemeZip(project: HtmlProject) {
  if (isShopifyThemeProject(project)) return shopifyThemeToZipBlob(project);
  const source = prepareProjectForTransport(canonicalProjectForTransport(project));
  const htmlFiles = Object.values(source.files)
    .filter(file => /\.html?$/i.test(file.path) && file.text !== undefined)
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!htmlFiles.length) throw new Error('O projeto não contém páginas HTML para converter.');

  const homePath = getProjectHomePath(source);
  const usedAssets = new Set<string>();
  const assetNames = new Map<string, string>();
  Object.values(source.files)
    .filter(file => !/\.html?$/i.test(file.path) && !file.path.startsWith('.incode/'))
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach(file => assetNames.set(file.path, shopifyAssetName(file.path, usedAssets)));

  const zip = new JSZip();
  Object.values(source.files).forEach(file => {
    const name = assetNames.get(file.path);
    if (!name) return;
    const value = file.text !== undefined
      ? rewriteShopifyAssetReferences(file.text, file.path, assetNames, false)
      : file.data ?? new Uint8Array();
    zip.file(`assets/${name}`, value);
  });

  let layoutHead = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  let layoutHtmlAttributes = 'lang="{{ request.locale.iso_code }}"';
  let layoutBodyAttributes = '';
  const usedTemplates = new Set<string>();
  htmlFiles.forEach((file, index) => {
    const document = new DOMParser().parseFromString(file.text || '', 'text/html');
    const rewritten = rewriteShopifyAssetReferences(document.documentElement.outerHTML, file.path, assetNames, true);
    const normalized = new DOMParser().parseFromString(rewritten, 'text/html');
    const restoreLiquid = materializeShopifyCommerce(normalized);
    const isHome = file.path === homePath || (!source.files[homePath] && index === 0);
    if (isHome) {
      layoutHead = normalized.head.innerHTML || layoutHead;
      layoutHtmlAttributes = Array.from(normalized.documentElement.attributes)
        .map(attribute => `${attribute.name}="${escapeHtml(attribute.value)}"`).join(' ') || layoutHtmlAttributes;
      layoutBodyAttributes = Array.from(normalized.body.attributes)
        .map(attribute => `${attribute.name}="${escapeHtml(attribute.value)}"`).join(' ');
    }
    const sectionType = shopifySectionType(file.path, index);
    const sectionMarkup = `${restoreLiquid(normalized.body.innerHTML)}\n{% schema %}\n{"name":"${sectionType}","settings":[]}\n{% endschema %}\n`;
    zip.file(`sections/${sectionType}.liquid`, sectionMarkup);
    const templatePath = shopifyTemplatePath(file.path, sectionType, isHome);
    if (!usedTemplates.has(templatePath)) {
      usedTemplates.add(templatePath);
      zip.file(templatePath, JSON.stringify({ sections: { main: { type: sectionType, settings: {} } }, order: ['main'] }, null, 2));
    }
  });

  if (!usedTemplates.has('templates/index.json')) {
    const firstType = shopifySectionType(htmlFiles[0].path, 0);
    zip.file('templates/index.json', JSON.stringify({ sections: { main: { type: firstType, settings: {} } }, order: ['main'] }, null, 2));
  }
  zip.file('layout/theme.liquid', `<!doctype html>\n<html ${layoutHtmlAttributes}>\n<head>\n${layoutHead}\n{{ content_for_header }}\n</head>\n<body${layoutBodyAttributes ? ` ${layoutBodyAttributes}` : ''}>\n{{ content_for_layout }}\n</body>\n</html>\n`);
  zip.file('config/settings_schema.json', JSON.stringify([{ name: 'theme_info', theme_name: project.name || 'Kodety Theme', theme_version: '1.0.0', theme_author: 'Onun Kodety' }], null, 2));
  zip.file('config/settings_data.json', JSON.stringify({ current: {} }, null, 2));
  zip.file('locales/en.default.json', JSON.stringify({ general: { accessibility: { skip_to_text: 'Skip to content' } } }, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
}

export async function importZip(file: File): Promise<HtmlProject> {
  // JSZip's runtime type detection is inconsistent for File/Blob objects
  // across embedded Chromium and Node-backed webviews. ArrayBuffer is
  // supported everywhere and avoids a silent rejection after file selection.
  const archive = await file.arrayBuffer();
  const files = await observeAsyncProjectImportPhase('project_unzip', async () => {
    const zip = await JSZip.loadAsync(archive);
    const entries = Object.values(zip.files).filter(
      (entry) => !entry.dir && !isMetadataPath(entry.name),
    );
    if (entries.length > MAX_IMPORT_FILES)
      throw new Error('O ZIP possui arquivos demais para ser aberto com segurança no navegador.');
    let declaredTotalBytes = 0;
    entries.forEach(entry => {
      const declaredBytes = declaredZipEntryBytes(entry);
      if (declaredBytes === null) return;
      declaredTotalBytes += declaredBytes;
      assertImportBudget(entry.name, declaredBytes, declaredTotalBytes);
    });
    const extractedFiles: Record<string, HtmlProjectFile> = {};
    let totalBytes = 0;
    let filesSinceYield = 0;
    let bytesSinceYield = 0;
    // Extract sequentially: concurrent decompression of thousands of entries can
    // multiply peak memory and freeze the browser before limits are checked.
    for (const entry of entries) {
      const path = normalizePath(entry.name);
      const detectedMimeType = mimeType(path);
      const declaredBytes = declaredZipEntryBytes(entry);
      let projectFile: HtmlProjectFile;
      let fileBytes: number;
      if (TEXT_EXTENSIONS.has(extension(path))) {
        const text = await entry.async('string');
        fileBytes = declaredBytes ?? new TextEncoder().encode(text).byteLength;
        projectFile = { path, mimeType: detectedMimeType, text };
      } else {
        // Ask JSZip for the final representation directly. The former
        // Blob -> ArrayBuffer -> Uint8Array path temporarily duplicated every
        // binary and made asset-heavy imports much more likely to exhaust a tab.
        const data = await entry.async('uint8array');
        fileBytes = data.byteLength;
        projectFile = { path, mimeType: detectedMimeType, data };
      }
      totalBytes += fileBytes;
      assertImportBudget(entry.name, fileBytes, totalBytes);
      if (extractedFiles[projectFile.path])
        throw new Error(`O ZIP contém caminhos duplicados: ${projectFile.path}`);
      extractedFiles[projectFile.path] = projectFile;
      filesSinceYield += 1;
      bytesSinceYield += fileBytes;
      if (filesSinceYield >= IMPORT_YIELD_FILE_COUNT || bytesSinceYield >= IMPORT_YIELD_BYTES) {
        filesSinceYield = 0;
        bytesSinceYield = 0;
        await yieldImportTurn();
      }
    }
    return extractedFiles;
  });
  return observeProjectImportPhase('project_parse', () => {
    const preparedFiles = prepareShopifyThemeFiles(restoreStaticHtmlSource(files), file.name.replace(/\.zip$/i, ''));
    const { mainHtmlPath, rootPath } = projectLocation(preparedFiles);
    const metadata = parseEditorMetadataFile(preparedFiles);
    const savedName = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
    return {
      // Published projects are downloaded as kodety-editor.zip. The project name
      // lives in the editor metadata and must win over that transport filename.
      name: savedName || file.name.replace(/\.zip$/i, ''),
      files: preparedFiles,
      mainHtmlPath,
      rootPath,
      openedAt: Date.now(),
    };
  });
}

export async function importHtmlFile(file: File): Promise<HtmlProject> {
  if (!/\.html?$/i.test(file.name)) throw new Error('Selecione um arquivo HTML válido.');
  const path = normalizePath(file.name) || 'index.html';
  const projectFile = await fileToProjectFile(path, file);
  return {
    name: file.name.replace(/\.html?$/i, '') || 'Projeto HTML',
    files: { [path]: projectFile },
    mainHtmlPath: path,
    rootPath: dirname(path),
    openedAt: Date.now(),
  };
}

export async function importFolder(fileList: FileList): Promise<HtmlProject> {
  const inputFiles = Array.from(fileList).filter((file) => {
    const relative = file.webkitRelativePath || file.name;
    return !relative.split('/').some((part) => IGNORED_IMPORT_DIRECTORIES.has(part));
  });
  if (!inputFiles.length) throw new Error('A pasta está vazia.');
  if (inputFiles.length > MAX_IMPORT_FILES)
    throw new Error('A pasta possui arquivos demais para ser aberta com segurança no navegador.');
  let totalBytes = 0;
  inputFiles.forEach((file) => {
    totalBytes += file.size;
    assertImportBudget(file.webkitRelativePath || file.name, file.size, totalBytes);
  });
  const root = inputFiles[0].webkitRelativePath.split('/')[0] || 'Projeto HTML';
  const files: Record<string, HtmlProjectFile> = {};
  await mapWithConcurrency(inputFiles, IMPORT_CONCURRENCY, async (file) => {
    const relative = file.webkitRelativePath
      ? file.webkitRelativePath.split('/').slice(1).join('/')
      : file.name;
    const projectFile = await fileToProjectFile(relative, file);
    if (files[projectFile.path])
      throw new Error(`A pasta contém caminhos duplicados: ${projectFile.path}`);
    files[projectFile.path] = projectFile;
  });
  const preparedFiles = prepareShopifyThemeFiles(files, root);
  const { mainHtmlPath, rootPath } = projectLocation(preparedFiles);
  const metadata = parseEditorMetadataFile(preparedFiles);
  const savedName = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
  return { name: savedName || root, files: preparedFiles, mainHtmlPath, rootPath, openedAt: Date.now() };
}

export interface ProjectZipOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  /** Deterministic transport timestamp used by delta/ZIP equivalence tests and
   * by callers that need both representations of the same draft revision. */
  updatedAt?: string;
  /** Draft transport favors UI responsiveness. Binary assets are already
   * compressed and STORE prevents JSZip from monopolizing the canvas thread. */
  fast?: boolean;
}

function projectZipAbortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException('A preparação do ZIP foi cancelada.', 'AbortError');
}

function assertProjectZipActive(signal?: AbortSignal) {
  if (signal?.aborted) throw projectZipAbortError(signal);
}

export async function projectToZipBlob(project: HtmlProject, options?: ProjectZipOptions) {
  assertProjectZipActive(options?.signal);
  const transportProject = prepareProjectForDraftTransport(project, options?.updatedAt);
  return projectToPreparedZipBlob(
    transportProject,
    transportProject,
    options,
    transportProject.files['.incode/project.json']?.text,
  );
}

/**
 * Build only the newest requested project archive. Starting a newer build
 * aborts the previous JSZip stream before it can become an upload candidate.
 * Network persistence should still ACK a request that already reached the
 * server; this helper intentionally owns packaging only.
 */
export function createLatestProjectZipBuilder(
  defaults: Omit<ProjectZipOptions, 'signal'> = {},
) {
  let generation = 0;
  let activeController: AbortController | null = null;

  const cancel = (reason: unknown = new DOMException('ZIP substituído por uma revisão mais recente.', 'AbortError')) => {
    generation += 1;
    activeController?.abort(reason);
    activeController = null;
  };

  const build = async (project: HtmlProject, options: ProjectZipOptions = {}) => {
    const currentGeneration = generation + 1;
    generation = currentGeneration;
    activeController?.abort(new DOMException('ZIP substituído por uma revisão mais recente.', 'AbortError'));
    const controller = new AbortController();
    activeController = controller;
    const externalSignal = options.signal;
    const relayAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) relayAbort();
    else externalSignal?.addEventListener('abort', relayAbort, { once: true });
    try {
      const zip = await projectToZipBlob(project, {
        ...defaults,
        ...options,
        signal: controller.signal,
      });
      if (generation !== currentGeneration) {
        throw new DOMException('ZIP substituído por uma revisão mais recente.', 'AbortError');
      }
      return zip;
    } finally {
      externalSignal?.removeEventListener('abort', relayAbort);
      if (activeController === controller) activeController = null;
    }
  };

  return { build, cancel };
}

/**
 * An A/B variant is edited through a private namespaced entry point, but that
 * entry point is authoring-session state only. Compiler passes must always run
 * from the public project root while retaining every private variant file for
 * the WordPress analytics publisher.
 */
export function canonicalProjectForTransport(project: HtmlProject): HtmlProject {
  const isExperimentSession = project.mainHtmlPath.startsWith('.incode/experiments/')
    && Boolean(project.previewRootPath?.startsWith('.incode/experiments/'));
  const isComponentSession = project.mainHtmlPath.startsWith(`${HTML_COMPONENTS_DIRECTORY}/`);
  if (!isExperimentSession && !isComponentSession) return project;
  const metadata = readEditorMetadata(project);
  const metadataRoot = typeof metadata.rootPath === 'string'
    ? normalizePath(metadata.rootPath)
    : project.rootPath;
  return {
    ...project,
    mainHtmlPath: getProjectHomePath(project),
    rootPath: metadataRoot,
    previewRootPath: undefined,
  };
}

function sanitizeEditorMetadataSeoMediaForPersistence(
  metadata: HtmlEditorMetadata,
): HtmlEditorMetadata {
  return {
    ...metadata,
    ...(metadata.siteSettings
      ? { siteSettings: sanitizeSiteSeoMediaForPersistence(metadata.siteSettings) }
      : {}),
    ...(metadata.pageSettings
      ? {
        pageSettings: Object.fromEntries(
          Object.entries(metadata.pageSettings).map(([pagePath, settings]) => [
            pagePath,
            sanitizePageSeoMediaForPersistence(settings),
          ]),
        ),
      }
      : {}),
  };
}

function editorMetadataNeedsLegacyStockBreakpointMigration(metadata: HtmlEditorMetadata) {
  const schemaVersion = Number(metadata.breakpointSchemaVersion);
  if (Number.isFinite(schemaVersion) && schemaVersion >= CURRENT_BREAKPOINT_SCHEMA_VERSION) {
    return false;
  }
  return metadata.breakpoints === undefined
    || isLegacyStockBreakpointRegistry(metadata.breakpoints);
}

function projectTransportMetadata(
  publishProject: HtmlProject,
  sourceProject: HtmlProject,
  updatedAt = new Date().toISOString(),
): HtmlEditorMetadata {
  const currentMetadata = readEditorMetadata(publishProject);
  const homeHtmlPath = getProjectHomePath(publishProject);
  const storedBreakpointSchemaVersion = Number(currentMetadata.breakpointSchemaVersion);
  const pendingBreakpointMigration = Boolean(parseEditorMetadataFile(publishProject.files))
    && editorMetadataNeedsLegacyStockBreakpointMigration(currentMetadata);
  return sanitizeEditorMetadataSeoMediaForPersistence({
    ...currentMetadata,
    version: 1,
    projectId: currentMetadata.projectId || createProjectId(),
    name: sourceProject.name,
    updatedAt,
    // `mainHtmlPath` remains the public entry point for backwards compatibility.
    // The page/component/experiment currently open is authoring-session state.
    mainHtmlPath: homeHtmlPath,
    homeHtmlPath,
    rootPath: sourceProject.rootPath,
    // Persist the registry that the canvas actually resolved. Older projects
    // may omit `mode` (or the entire default registry); leaving that raw makes
    // Code Components and CSS choose different breakpoints after publication.
    primaryBreakpoint: normalizePrimaryBreakpoint(currentMetadata.primaryBreakpoint),
    ...(pendingBreakpointMigration
      ? (currentMetadata.breakpoints === undefined
          ? {
              // An implicit legacy registry still resolves to 410px. If its CSS
              // could not be parsed, materialize that old registry without a
              // schema marker so reopening does not fall through to the new
              // 480px default and a later retry remains migration-eligible.
              breakpoints: LEGACY_STOCK_BREAKPOINTS.map(breakpoint => ({ ...breakpoint })),
            }
          : {})
      : {
          breakpointSchemaVersion: Number.isFinite(storedBreakpointSchemaVersion)
            ? Math.max(CURRENT_BREAKPOINT_SCHEMA_VERSION, storedBreakpointSchemaVersion)
            : CURRENT_BREAKPOINT_SCHEMA_VERSION,
          breakpoints: normalizeBreakpointRegistry(currentMetadata.breakpoints),
        }),
  });
}

/**
 * Upgrades only the implicit or exact stock 410px registry used by older
 * Builder releases. Metadata and every editor-owned canonical media wrapper
 * are returned in one immutable project snapshot, so autosave/publication can
 * never observe a 480px registry beside stale managed 410px CSS.
 *
 * A valid project metadata document is required. Plain imported HTML/CSS has
 * no evidence that its 410px queries came from Kodety defaults and is therefore
 * left byte-for-byte untouched. Custom explicit registries are a strict no-op
 * at open time; a later legitimate breakpoint edit or transport write seals
 * the current schema without manufacturing an autosave merely by inspection.
 */
export function migrateLegacyStockBreakpointProject(project: HtmlProject): HtmlProject {
  const metadataFile = project.files['.incode/project.json'];
  if (!metadataFile?.text) return project;
  const metadata = parseEditorMetadataFile(project.files);
  if (!metadata) return project;
  if (!editorMetadataNeedsLegacyStockBreakpointMigration(metadata)) return project;
  const legacyMobile = LEGACY_STOCK_BREAKPOINTS.find(breakpoint => breakpoint.id === 'mobile');
  const legacyMobileParams = legacyMobile
    ? `(${legacyMobile.mode}: ${legacyMobile.width}px)`
    : '(max-width: 410px)';
  const cssPatches = Object.values(project.files).flatMap(file => {
    if (
      !/\.css$/i.test(file.path)
      || file.text === undefined
      // Do not parse/re-serialize unrelated vendor sheets. Only the canonical
      // condition generated by the old breakpoint editor is migration-owned.
      || !file.text.includes(legacyMobileParams)
    ) return [];
    const patch = tryPatchBreakpointMediaQueries(
      file.text,
      LEGACY_STOCK_BREAKPOINTS,
      DEFAULT_BREAKPOINTS,
    );
    return [{ file, patch }];
  });
  // A partially rewritten snapshot would permanently seal 480px metadata next
  // to an unparseable managed 410px sheet. Abort the entire migration instead.
  if (cssPatches.some(({ patch }) => !patch.ok)) return project;
  let migrated = project;
  cssPatches.forEach(({ file, patch }) => {
    if (patch.source !== file.text) migrated = updateTextFile(migrated, file.path, patch.source);
  });

  return updateEditorMetadata(migrated, current => ({
    ...current,
    breakpointSchemaVersion: CURRENT_BREAKPOINT_SCHEMA_VERSION,
    breakpoints: DEFAULT_BREAKPOINTS.map(breakpoint => ({ ...breakpoint })),
  }));
}

/**
 * Materialize the exact editable file graph persisted by a draft ZIP without
 * allocating that ZIP. Delta autosave and the compatibility archive share this
 * function so metadata, CSS priorities, text encoding and binary bytes cannot
 * silently diverge between transports.
 */
export function prepareProjectForDraftTransport(
  project: HtmlProject,
  updatedAt = new Date().toISOString(),
): HtmlProject {
  const canonicalProject = canonicalProjectForTransport(stripProjectPriorities(
    migrateLegacyStockBreakpointProject(project),
  ));
  const metadata = projectTransportMetadata(canonicalProject, canonicalProject, updatedAt);
  const metadataPath = '.incode/project.json';
  return {
    ...canonicalProject,
    files: {
      ...canonicalProject.files,
      [metadataPath]: {
        path: metadataPath,
        mimeType: 'application/json',
        text: JSON.stringify(metadata, null, 2),
      },
    },
  };
}

async function projectToPreparedZipBlob(
  publishProject: HtmlProject,
  sourceProject: HtmlProject,
  options?: ProjectZipOptions,
  metadataTextOverride?: string,
) {
  assertProjectZipActive(options?.signal);
  publishProject = stripProjectPriorities(publishProject);
  const zip = new JSZip();
  Object.values(publishProject.files).forEach((file) => {
    assertProjectZipActive(options?.signal);
    if (file.path === '.incode/project.json') return;
    // Images, video, audio, archives and fonts are already compressed. Running
    // DEFLATE over them can dominate publication time without reducing size.
    const store = options?.fast || /\.(?:avif|gif|jpe?g|png|webp|ico|mp[34]|m4[av]|webm|ogg|ogv|wav|pdf|zip|gz|woff2?|eot|otf|ttf|br)$/i.test(file.path);
    zip.file(file.path, file.text !== undefined ? file.text : file.data ?? new Uint8Array(), { compression: store ? 'STORE' : 'DEFLATE' });
  });
  const metadataText = metadataTextOverride || JSON.stringify(
    projectTransportMetadata(publishProject, sourceProject, options?.updatedAt),
    null,
    2,
  );
  zip.file('.incode/project.json', metadataText);
  assertProjectZipActive(options?.signal);
  return zip.generateAsync(
    { type: 'blob', compression: options?.fast ? 'STORE' : 'DEFLATE', compressionOptions: { level: 4 } },
    metadata => {
      assertProjectZipActive(options?.signal);
      options?.onProgress?.(Math.max(0, Math.min(100, metadata.percent || 0)));
    },
  );
}

/** Materialize only features the author explicitly enabled in Kodety.
 *
 * An imported, already executable HTML/CSS/JS site is a pass-through project:
 * its module paths, import graph, markup and styles reach Preview/export
 * byte-for-byte, apart from the responsive viewport contract required for a
 * real mobile browser to match the canvas. Legacy archives that contain a
 * generated coded-build manifest are first hydrated back to their recorded
 * originals. Code Components and other explicit Builder features are still
 * materialized below. */
export function prepareProjectForTransport(project: HtmlProject): HtmlProject {
  const canonicalProject = hydrateMembershipProject(canonicalProjectForTransport(stripProjectPriorities(
    migrateLegacyStockBreakpointProject(project),
  )));
  const sourceMetadata = readEditorMetadata(canonicalProject);
  const localizedProject = sourceMetadata.localization
    ? updateEditorMetadata(
      ensureProjectLocalizationIds(canonicalProject),
      (metadata) => ({
        ...metadata,
        localization: normalizeLocalization(metadata.localization),
      }),
    )
    : canonicalProject;
  // Imported browser-ready sites are a byte-preserving transport. Invoke the
  // legacy source compiler only when its exported fail-safe predicate proves
  // both an explicit Vite project and a reachable construct Vite must lower.
  const codedProject = projectRequiresCodedBuild(localizedProject)
    ? prepareCodedProjectForTransport(localizedProject)
    : hydrateCodedProject(localizedProject);
  const projectMetadata = readEditorMetadata(codedProject);
  const codeComponentBreakpoints = Boolean(parseEditorMetadataFile(codedProject.files))
    && editorMetadataNeedsLegacyStockBreakpointMigration(projectMetadata)
    ? LEGACY_STOCK_BREAKPOINTS.map(breakpoint => ({ ...breakpoint }))
    : normalizeBreakpointRegistry(projectMetadata.breakpoints);
  const codeComponentProject = projectMetadata.codeComponents
    ? prepareCodeComponentProject(
        codedProject,
        projectMetadata.codeComponents,
        toCodeComponentBreakpoints(
          normalizePrimaryBreakpoint(projectMetadata.primaryBreakpoint),
          codeComponentBreakpoints,
        ),
      )
    : codedProject;
  const customCodeProject = applyCustomCodeToProject(codeComponentProject, projectMetadata.customCode);
  const pageTransitionProject = preparePageTransitionsForTransport(
    customCodeProject,
    getProjectHomePath(customCodeProject),
  );
  const normalizedHtmlComponentLibrary = normalizeHtmlComponentLibrary(projectMetadata.components);
  const migratedHtmlComponents = migrateLegacyHtmlComponentBundles(
    pageTransitionProject,
    normalizedHtmlComponentLibrary,
  );
  const htmlComponentLibrary = migratedHtmlComponents.library;
  const htmlComponentMetadataProject = migratedHtmlComponents.project === pageTransitionProject
    ? pageTransitionProject
    : updateEditorMetadata(migratedHtmlComponents.project, metadata => ({
        ...metadata,
        components: htmlComponentLibrary,
      }));
  const htmlComponentProject = synchronizeHtmlComponentBundleManifests(
    htmlComponentMetadataProject,
    htmlComponentLibrary,
  );
  const googleFonts = projectGoogleFonts(htmlComponentProject);
  // Keep generated interaction runtime code out of the editable HTML while
  // still emitting a self-contained published page. The JSON animation
  // documents remain in the project archive as the canonical source of truth.
  let files = htmlComponentProject.files;
  Object.values(htmlComponentProject.files)
    .filter(file => /\.html?$/i.test(file.path) && file.text !== undefined)
    .forEach(file => {
      const pageAnimationDocument = readInteractionDocumentFile(
        htmlComponentProject,
        file.path,
      );
      const hydratedComponents = file.path.startsWith(`${HTML_COMPONENTS_DIRECTORY}/`)
        ? file.text || ''
        : refreshHtmlComponentInstancesInSource(
            file.text || '',
            htmlComponentProject,
            htmlComponentLibrary,
            undefined,
            file.path,
          );
      const withComponentStyles = file.path.startsWith(`${HTML_COMPONENTS_DIRECTORY}/`)
        ? hydratedComponents
        : inlineHtmlComponentStyles(
            hydratedComponents,
            htmlComponentProject,
            htmlComponentLibrary,
            file.path,
          );
      const withComponents = injectHtmlComponentRuntimeRegistry(
        withComponentStyles,
        htmlComponentProject,
        htmlComponentLibrary,
        undefined,
        file.path,
      );
      const animationDocument = file.path.startsWith(`${HTML_COMPONENTS_DIRECTORY}/`)
        ? pageAnimationDocument
        : compileHtmlComponentInstanceInteractions(
            htmlComponentProject,
            hydratedComponents,
            htmlComponentLibrary,
            pageAnimationDocument,
          );
      const withInteractions = animationDocument?.interactions.length
        ? patchInteractionDocument(withComponents, animationDocument)
        : withComponents;
      const materialized = injectProjectGoogleFonts(
        injectNativeComponentsRuntime(withInteractions),
        googleFonts,
      );
      if (materialized === file.text) return;
      files = { ...files, [file.path]: { ...file, text: materialized } };
    });
  const materializedProject = files === htmlComponentProject.files
    ? htmlComponentProject
    : { ...htmlComponentProject, files };
  // Consent is deliberately the penultimate pass: Custom Code, HTML
  // Components, native runtimes and their interactions must already be in the
  // release HTML so third-party scripts/embeds introduced by any of them are
  // gated. Membership remains last so its protected artifact is not exposed or
  // invalidated by a later HTML rewrite.
  const cookieConsentProject = prepareCookieConsentProjectForTransport(
    materializedProject,
    projectMetadata.cookieConsent,
  );
  const managedVariantFaviconProject = prepareManagedVariantFaviconsForTransport(
    cookieConsentProject,
    projectMetadata.siteSettings,
  );
  // Membership is the final compiler pass. This keeps runtime scripts/styles
  // inside whole-page protection while its editor snapshot remains the clean,
  // non-materialized source used when WordPress reopens the workspace.
  return stripProjectPriorities(prepareResponsiveProjectForTransport(
    prepareMembershipProjectForTransport(
      managedVariantFaviconProject,
      readEditorMetadata(localizedProject),
      localizedProject,
    ),
  ));
}

const MANAGED_VARIANT_HTML_PATTERN = /^\.incode\/experiments\/[^/]+\/[^/]+\/project\/.+\.html?$/i;

function prepareManagedVariantFaviconsForTransport(
  project: HtmlProject,
  siteSettings: SiteSeoSettings | undefined,
): HtmlProject {
  if (!siteSettings) return project;
  let files = project.files;
  Object.values(project.files).forEach(file => {
    if (
      file.text === undefined
      || !MANAGED_VARIANT_HTML_PATTERN.test(file.path)
      || !/data-kodety-favicon/i.test(file.text)
    ) return;
    const text = synchronizeManagedVariantFaviconHtml(file.text, siteSettings);
    if (text === file.text) return;
    if (files === project.files) files = { ...files };
    files[file.path] = { ...file, text };
  });
  return files === project.files ? project : { ...project, files };
}

export function projectNeedsManagedVariantFaviconSync(project: HtmlProject): boolean {
  const siteSettings = readEditorMetadata(project).siteSettings;
  if (!siteSettings) return false;
  return Object.values(project.files).some(file => (
    file.text !== undefined
    && MANAGED_VARIANT_HTML_PATTERN.test(file.path)
    && /data-kodety-favicon/i.test(file.text)
    && synchronizeManagedVariantFaviconHtml(file.text, siteSettings) !== file.text
  ));
}

export async function projectToPublishPackage(project: HtmlProject, options?: Parameters<typeof projectToZipBlob>[1]) {
  const sourceProject = canonicalProjectForTransport(project);
  const transportProject = prepareProjectForTransport(sourceProject);
  const [zip, cssDigest] = await Promise.all([
    projectToPreparedZipBlob(transportProject, sourceProject, options),
    projectCssDigest(transportProject),
  ]);
  return { zip, cssDigest };
}

const MATERIALIZED_PUBLISH_OVERLAY_PATH = '.incode/publish-overlay.json';
const MATERIALIZED_PUBLISH_OVERLAY_KIND = 'kodety-materialized-publish-overlay';
const MATERIALIZED_PUBLISH_OVERLAY_PROTECTED_PATHS = new Set([
  '.incode/project.json',
  '.incode/template.json',
  MATERIALIZED_PUBLISH_OVERLAY_PATH,
]);

function projectFileBytes(file: HtmlProjectFile) {
  return file.text !== undefined
    ? new TextEncoder().encode(file.text)
    : file.data ?? new Uint8Array();
}

function projectFileContentsEqual(left: HtmlProjectFile, right: HtmlProjectFile) {
  if (left.text !== undefined && right.text !== undefined) return left.text === right.text;
  if (left.data && right.data && left.data === right.data) return true;
  const leftBytes = projectFileBytes(left);
  const rightBytes = projectFileBytes(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function bytesToSha256Hex(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador não oferece SHA-256 para validar a publicação.');
  }
  return globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
    .then(digest => Array.from(
      new Uint8Array(digest),
      byte => byte.toString(16).padStart(2, '0'),
    ).join(''));
}

/**
 * Build a bounded release-only overlay instead of uploading the complete
 * editable project a second time. WordPress applies these authenticated file
 * changes to the exact workspace revision it already acknowledged, computes
 * the complete CSS/HTML digest, and only then activates the release.
 *
 * Hosted Preview and ZIP export deliberately keep using
 * `projectToPublishPackage()` because those consumers need a self-contained
 * archive rather than an overlay.
 */
export async function projectToMaterializedPublishOverlayPackage(
  project: HtmlProject,
  options?: Parameters<typeof projectToZipBlob>[1],
) {
  assertProjectZipActive(options?.signal);
  const sourceProject = canonicalProjectForTransport(project);
  const transportProject = prepareProjectForTransport(sourceProject);
  const sourceFiles = sourceProject.files;
  const upsertFiles = Object.values(transportProject.files)
    .filter(file => !MATERIALIZED_PUBLISH_OVERLAY_PROTECTED_PATHS.has(file.path))
    .filter(file => {
      const sourceFile = sourceFiles[file.path];
      return !sourceFile || !projectFileContentsEqual(sourceFile, file);
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const deletes = Object.keys(sourceFiles)
    .filter(path => !MATERIALIZED_PUBLISH_OVERLAY_PROTECTED_PATHS.has(path))
    .filter(path => !transportProject.files[path])
    .sort((left, right) => left.localeCompare(right));

  const zip = new JSZip();
  const upserts = await Promise.all(upsertFiles.map(async file => {
    assertProjectZipActive(options?.signal);
    const bytes = projectFileBytes(file);
    const sha256 = await bytesToSha256Hex(bytes);
    assertProjectZipActive(options?.signal);
    const store = options?.fast || /\.(?:avif|gif|jpe?g|png|webp|ico|mp[34]|m4[av]|webm|ogg|ogv|wav|pdf|zip|gz|woff2?|eot|otf|ttf|br)$/i.test(file.path);
    zip.file(file.path, file.text !== undefined ? file.text : bytes, {
      compression: store ? 'STORE' : 'DEFLATE',
      createFolders: false,
    });
    return { path: file.path, byteLength: bytes.byteLength, sha256 };
  }));
  const manifest = {
    schemaVersion: 1,
    kind: MATERIALIZED_PUBLISH_OVERLAY_KIND,
    upserts,
    deletes,
  };
  zip.file(MATERIALIZED_PUBLISH_OVERLAY_PATH, JSON.stringify(manifest), {
    compression: 'DEFLATE',
    createFolders: false,
  });
  assertProjectZipActive(options?.signal);
  const [blob, cssDigest] = await Promise.all([
    zip.generateAsync(
      { type: 'blob', compression: options?.fast ? 'STORE' : 'DEFLATE', compressionOptions: { level: 4 } },
      metadata => {
        assertProjectZipActive(options?.signal);
        options?.onProgress?.(Math.max(0, Math.min(100, metadata.percent || 0)));
      },
    ),
    projectCssDigest(transportProject),
  ]);
  assertProjectZipActive(options?.signal);
  return { zip: blob, cssDigest, upsertCount: upserts.length, deleteCount: deletes.length };
}

export function downloadZipBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = /\.zip$/i.test(name) ? name : `${name}.zip`;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // WebKit/webviews may begin consuming the object URL after click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportZip(project: HtmlProject, downloadName?: string) {
  const liquid = isShopifyThemeProject(project);
  const transportProject = liquid ? project : prepareProjectForTransport(project);
  downloadZipBlob(
    liquid ? await shopifyThemeToZipBlob(transportProject) : await projectToZipBlob(transportProject),
    downloadName || (
      liquid
        ? project.name.replace(/\s+—\s+manutenção Shopify$/i, '') || 'projeto-editado'
        : project.name || 'projeto-editado'
    ),
  );
}

export function updateTextFile(project: HtmlProject, path: string, text: string): HtmlProject {
  if (project.files[path]?.text === text) return project;
  return {
    ...project,
    files: { ...project.files, [path]: { ...project.files[path], text } },
  };
}

export function readEditorMetadata(project: HtmlProject): HtmlEditorMetadata {
  return parseEditorMetadataFile(project.files) ?? { version: 1, name: project.name };
}

/** Only referenced Google families are page dependencies; the picker is a library. */
export function projectGoogleFonts(project: HtmlProject, installedFonts: Font[] = []): Font[] {
  const metadata = readEditorMetadata(project);
  const fonts = normalizeProjectGoogleFonts([
    ...installedFonts.filter(font => font.type === 'google'),
    // Project dependencies are authoritative on save/reopen. An account copy
    // may contain only Regular; it must not erase imported weights or axes.
    ...(Array.isArray(metadata.googleFonts) ? metadata.googleFonts : []),
  ]);
  if (!fonts.length) return [];
  const referenced = referencedProjectGoogleFonts(project, fonts, [JSON.stringify({
    designTokens: metadata.designTokens,
    customCode: metadata.customCode,
    components: metadata.components,
    codeComponents: metadata.codeComponents,
  })]);
  if (!referenced.length) return referenced;
  // An imported/local face remains authoritative even if the account library
  // happens to contain a Google family with the same name.
  const localFamilies = new Set(discoverProjectFonts(project).fonts
    .filter(font => font.faces.some(face => face.sources.some(source => source.filePath)))
    .flatMap(font => [font.family, ...font.aliases].map(normalizeFontFamilyName)));
  return referenced.filter(font => !localFamilies.has(normalizeFontFamilyName(font.family)));
}

export function projectHasGoogleFonts(project: HtmlProject): boolean {
  return projectGoogleFonts(project).length > 0;
}

/** Capture choices on edit/save, so publication and reopening need no browser-local catalog. */
export function rememberProjectGoogleFonts(project: HtmlProject, installedFonts: Font[]): HtmlProject {
  const metadata = readEditorMetadata(project);
  const remembered = normalizeProjectGoogleFonts(metadata.googleFonts);
  const used = projectGoogleFonts(project, installedFonts);
  if (!used.length) return project;
  const googleFonts = serializeProjectGoogleFonts(normalizeProjectGoogleFonts([...remembered, ...used]));
  if (JSON.stringify(googleFonts) === JSON.stringify(metadata.googleFonts)) return project;
  return updateEditorMetadata(project, current => ({ ...current, googleFonts }));
}

export function getProjectHomePath(project: HtmlProject): string {
  const metadata = readEditorMetadata(project);
  const declared = normalizePath(metadata.homeHtmlPath || metadata.mainHtmlPath || '');
  if (declared && project.files[declared]?.text !== undefined && /\.html?$/i.test(declared))
    return declared;
  return findMainHtml(project.files);
}

export function getPagePublicationStatus(
  project: HtmlProject,
  path: string,
): HtmlPagePublicationStatus {
  const normalized = normalizePath(path);
  return readEditorMetadata(project).pageStatuses?.[normalized] === 'draft'
    ? 'draft'
    : 'active';
}

export function setPagePublicationStatus(
  project: HtmlProject,
  path: string,
  status: HtmlPagePublicationStatus,
): HtmlProject {
  const normalized = normalizePath(path);
  if (
    !normalized
    || project.files[normalized]?.text === undefined
    || !/\.html?$/i.test(normalized)
  ) {
    throw new Error('Selecione uma página HTML válida.');
  }
  if (status === 'draft' && getProjectHomePath(project) === normalized) {
    throw new Error('A página inicial não pode virar Draft. Defina outra página inicial primeiro.');
  }
  return updateEditorMetadata(project, metadata => {
    const pageStatuses = { ...(metadata.pageStatuses || {}) };
    if (status === 'draft') pageStatuses[normalized] = 'draft';
    else delete pageStatuses[normalized];
    return {
      ...metadata,
      pageStatuses: Object.keys(pageStatuses).length ? pageStatuses : undefined,
    };
  });
}

export function setProjectHomePath(project: HtmlProject, path: string): HtmlProject {
  const normalized = normalizePath(path);
  if (
    !normalized ||
    project.files[normalized]?.text === undefined ||
    !/\.html?$/i.test(normalized)
  ) {
    throw new Error('Selecione uma página HTML válida para usar como página inicial.');
  }
  if (getPagePublicationStatus(project, normalized) === 'draft') {
    throw new Error('Ative a página antes de defini-la como inicial.');
  }
  return updateEditorMetadata(project, (metadata) => ({
    ...metadata,
    version: 1,
    mainHtmlPath: normalized,
    homeHtmlPath: normalized,
  }));
}

export function updateEditorMetadata(
  project: HtmlProject,
  update: (metadata: HtmlEditorMetadata) => HtmlEditorMetadata,
): HtmlProject {
  const current = readEditorMetadata(project);
  const updated = update(current);
  const breakpointsChanged = JSON.stringify(updated.breakpoints) !== JSON.stringify(current.breakpoints);
  const storedBreakpointSchemaVersion = Number(updated.breakpointSchemaVersion);
  const metadata = sanitizeEditorMetadataSeoMediaForPersistence({
    ...updated,
    ...(breakpointsChanged
      ? {
          breakpointSchemaVersion: Number.isFinite(storedBreakpointSchemaVersion)
            ? Math.max(CURRENT_BREAKPOINT_SCHEMA_VERSION, storedBreakpointSchemaVersion)
            : CURRENT_BREAKPOINT_SCHEMA_VERSION,
        }
      : {}),
  });
  const path = '.incode/project.json';
  return {
    ...project,
    files: {
      ...project.files,
      [path]: { path, mimeType: 'application/json', text: JSON.stringify(metadata, null, 2) },
    },
  };
}
