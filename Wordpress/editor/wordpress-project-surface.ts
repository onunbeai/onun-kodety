import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import type { HtmlProject, HtmlProjectFile } from '@/lib/html-editor/types';
import type { WordPressDraftSavePayload } from '@/lib/html-editor/editor-wordpress-helpers';
import { withRequestTimeout } from '@/lib/request-timeout';

export type WordPressProjectSurface = 'settings' | 'analytics';

export interface WordPressProjectSurfaceSnapshot {
  project: HtmlProject;
  workspaceRevision: number;
  workspaceDigest: string;
  templateDigest: string;
  loadedAt: number;
  source: 'network' | 'session-cache' | 'full-project';
}

interface ProjectSurfaceResponse {
  success?: boolean;
  notModified?: boolean;
  requiresFullProject?: boolean;
  project?: {
    name?: unknown;
    rootPath?: unknown;
    mainHtmlPath?: unknown;
    files?: unknown;
  };
  workspaceRevision?: unknown;
  workspaceDigest?: unknown;
  templateDigest?: unknown;
  message?: unknown;
}

const SURFACE_CACHE_TTL_MS = 5 * 60_000;
const SURFACE_REQUEST_TIMEOUT_MS = 12_000;
const SURFACE_ASSET_REQUEST_TIMEOUT_MS = 30_000;
const FULL_PROJECT_REQUEST_TIMEOUT_MS = 45_000;
const SURFACE_DELTA_MAX_BYTES = 60 * 1024 * 1024;
const SURFACE_DELTA_MAX_OPERATIONS = 5_000;
const SURFACE_DELTA_MAX_PATH_BYTES = 4_096;
const SURFACE_CACHE_PREFIX = 'kodety:wordpress-project-surface:v3:';
const inFlightSurfaceAssetRequests = new Map<string, Promise<HtmlProjectFile>>();

function validDigest(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function safeRevision(value: unknown) {
  const revision = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : -1;
}

function normalizePath(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some(part => part === '..')) return '';
  return normalized;
}

function normalizeProjectFile(value: unknown, key: string): HtmlProjectFile | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    path?: unknown;
    mimeType?: unknown;
    text?: unknown;
    lazyAsset?: unknown;
  };
  const path = normalizePath(candidate.path) || normalizePath(key);
  const hasText = typeof candidate.text === 'string';
  if (!path || (!hasText && candidate.lazyAsset !== true)) return null;
  return {
    path,
    mimeType: typeof candidate.mimeType === 'string' && candidate.mimeType.trim()
      ? candidate.mimeType
      : 'text/plain',
    ...(hasText ? { text: candidate.text as string } : {}),
  };
}

function normalizeSurfaceResponse(payload: ProjectSurfaceResponse): WordPressProjectSurfaceSnapshot {
  if (payload.success !== true || !payload.project || typeof payload.project !== 'object') {
    throw new Error(typeof payload.message === 'string' ? payload.message : 'O WordPress não entregou os dados desta área.');
  }
  const workspaceRevision = safeRevision(payload.workspaceRevision);
  if (workspaceRevision < 0) throw new Error('O WordPress não confirmou a revisão desta área.');
  const filesCandidate = payload.project.files;
  const files = Object.fromEntries(
    filesCandidate && typeof filesCandidate === 'object'
      ? Object.entries(filesCandidate)
          .map(([key, value]) => normalizeProjectFile(value, key))
          .filter((file): file is HtmlProjectFile => Boolean(file))
          .map(file => [file.path, file])
      : [],
  );
  const mainHtmlPath = normalizePath(payload.project.mainHtmlPath)
    || Object.keys(files).find(path => /(?:^|\/)index\.html?$/i.test(path))
    || Object.keys(files).find(path => /\.html?$/i.test(path))
    || '';
  const project: HtmlProject = {
    name: typeof payload.project.name === 'string' && payload.project.name.trim()
      ? payload.project.name.trim()
      : 'Projeto',
    rootPath: normalizePath(payload.project.rootPath),
    mainHtmlPath,
    files,
    openedAt: Date.now(),
  };
  return {
    project,
    workspaceRevision,
    workspaceDigest: validDigest(payload.workspaceDigest),
    templateDigest: validDigest(payload.templateDigest),
    loadedAt: Date.now(),
    source: 'network',
  };
}

function surfaceCacheScope(config: KodetyWordPressConfig, surface: WordPressProjectSurface) {
  const endpoint = new URL(
    config.projectSurfaceUrl || config.projectUrl || window.location.pathname,
    window.location.href,
  ).href;
  // The REST nonce is user/session-bound in WordPress. Keep the exact scope in
  // the envelope as well as its compact key hash, so even a hash collision can
  // never expose a snapshot created under another identity or capability set.
  return JSON.stringify({
    surface,
    endpoint,
    nonce: config.nonce,
    project: config.projectName || config.share?.projectId || config.projectId || '',
    site: config.siteUrl || window.location.origin,
    readOnly: Boolean(config.readOnly || config.share?.mode === 'view'),
    canEditWorkspace: Boolean(config.canEditWorkspace),
    canViewAnalytics: Boolean(config.canViewAnalytics),
    canManageAnalytics: Boolean(config.canManageAnalytics),
    shareMode: config.share?.mode || '',
    shareToken: config.share?.token || '',
  });
}

function compactCacheScope(scope: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < scope.length; index += 1) {
    hash = Math.imul(hash ^ scope.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function surfaceCacheKey(config: KodetyWordPressConfig, surface: WordPressProjectSurface) {
  const scope = surfaceCacheScope(config, surface);
  return `${SURFACE_CACHE_PREFIX}${surface}:${compactCacheScope(scope)}`;
}

export function readCachedWordPressProjectSurface(
  config: KodetyWordPressConfig,
  surface: WordPressProjectSurface,
  allowStale = false,
) {
  try {
    const key = surfaceCacheKey(config, surface);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scope?: unknown; cachedAt?: unknown; payload?: ProjectSurfaceResponse };
    if (parsed.scope !== surfaceCacheScope(config, surface)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    const cachedAt = safeRevision(parsed.cachedAt);
    if (!allowStale && (cachedAt < 0 || Date.now() - cachedAt > SURFACE_CACHE_TTL_MS)) return null;
    const snapshot = normalizeSurfaceResponse(parsed.payload || {});
    return { ...snapshot, loadedAt: cachedAt, source: 'session-cache' as const };
  } catch {
    return null;
  }
}

export function cacheWordPressProjectSurface(
  config: KodetyWordPressConfig,
  surface: WordPressProjectSurface,
  snapshot: WordPressProjectSurfaceSnapshot,
) {
  try {
    // Session cache is a first-paint accelerator, not another full project
    // store. Never stringify Uint8Arrays from a lazy asset or A/B ZIP.
    const cacheableFiles = Object.fromEntries(
      Object.entries(snapshot.project.files)
        .filter(([, file]) => typeof file.text === 'string' || (file.text === undefined && file.data === undefined))
        .map(([path, file]) => [
          path,
          typeof file.text === 'string' ? file : { ...file, lazyAsset: true },
        ]),
    );
    window.sessionStorage.setItem(surfaceCacheKey(config, surface), JSON.stringify({
      scope: surfaceCacheScope(config, surface),
      cachedAt: Date.now(),
      payload: {
        success: true,
        project: { ...snapshot.project, files: cacheableFiles },
        workspaceRevision: snapshot.workspaceRevision,
        workspaceDigest: snapshot.workspaceDigest,
        templateDigest: snapshot.templateDigest,
      },
    }));
  } catch {
    // Privacy mode and storage pressure must not block a workspace.
  }
}

export async function fetchWordPressProjectSurface(
  config: KodetyWordPressConfig,
  surface: WordPressProjectSurface,
  signal?: AbortSignal,
) {
  if (!config.projectSurfaceUrl) throw new Error('O endpoint leve desta área não está disponível.');
  const cached = readCachedWordPressProjectSurface(config, surface, true);
  const endpoint = new URL(config.projectSurfaceUrl, window.location.href);
  endpoint.searchParams.set('surface', surface);
  if (cached) endpoint.searchParams.set('revision', String(cached.workspaceRevision));
  const result = await withRequestTimeout(async requestSignal => {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': config.nonce },
      signal: requestSignal,
    });
    const payload = (await response.json().catch(() => null)) as ProjectSurfaceResponse | null;
    if (!response.ok || !payload) {
      throw new Error(
        typeof payload?.message === 'string'
          ? payload.message
          : `O WordPress recusou os dados desta área (HTTP ${response.status}).`,
      );
    }
    if (payload.requiresFullProject === true) {
      return { requiresFullProject: true as const };
    }
    if (payload.notModified === true) {
      const confirmedRevision = safeRevision(payload.workspaceRevision);
      if (!cached || confirmedRevision !== cached.workspaceRevision) {
        throw new Error('O WordPress confirmou um cache incompatível com esta sessão.');
      }
      return {
        ...cached,
        workspaceDigest: validDigest(payload.workspaceDigest) || cached.workspaceDigest,
        templateDigest: validDigest(payload.templateDigest) || cached.templateDigest,
        loadedAt: Date.now(),
        source: 'session-cache' as const,
      };
    }
    return normalizeSurfaceResponse(payload);
  }, {
    timeoutMs: SURFACE_REQUEST_TIMEOUT_MS,
    timeoutMessage: 'O WordPress demorou demais para abrir esta área.',
    signal,
  });
  if ('requiresFullProject' in result) {
    try {
      window.sessionStorage.removeItem(surfaceCacheKey(config, surface));
    } catch {
      // A private/storage-restricted session can still use the full transport.
    }
    return loadFullWordPressProject(config, signal);
  }
  const snapshot = result;
  cacheWordPressProjectSurface(config, surface, snapshot);
  return snapshot;
}

export async function loadWordPressProjectSurface(
  config: KodetyWordPressConfig,
  surface: WordPressProjectSurface,
  signal?: AbortSignal,
) {
  const cached = readCachedWordPressProjectSurface(config, surface);
  if (cached) return cached;
  try {
    return await fetchWordPressProjectSurface(config, surface, signal);
  } catch (error) {
    const stale = readCachedWordPressProjectSurface(config, surface, true);
    if (stale) return stale;
    throw error;
  }
}

function originalProjectName(response: Response, fallback: string) {
  const header = response.headers.get('X-Kodety-Project-Name') || response.headers.get('X-Kodety-Original-Name') || '';
  try {
    return decodeURIComponent(header).replace(/\.zip$/i, '').trim() || fallback;
  } catch {
    return header.replace(/\.zip$/i, '').trim() || fallback;
  }
}

export async function loadFullWordPressProject(
  config: KodetyWordPressConfig,
  signal?: AbortSignal,
): Promise<WordPressProjectSurfaceSnapshot> {
  if (!config.projectDownloadUrl && !config.projectUrl) {
    throw new Error('O projeto completo não está disponível para esta conta.');
  }
  return withRequestTimeout(async requestSignal => {
    const binaryDownload = Boolean(config.projectDownloadUrl);
    const endpoint = new URL(config.projectDownloadUrl || config.projectUrl!, window.location.href);
    endpoint.searchParams.set('_kodety_surface_revision', String(Date.now()));
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': config.nonce },
      signal: requestSignal,
    });
    if (!response.ok) {
      const payload = binaryDownload ? null : await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(payload?.message || 'O WordPress não entregou o projeto completo.');
    }
    let archive: Blob;
    let workspaceRevision = safeRevision(response.headers.get('X-Kodety-Workspace-Revision'));
    let workspaceDigest = validDigest(response.headers.get('X-Kodety-CSS-Digest'));
    let templateDigest = validDigest(response.headers.get('X-Kodety-Template-Digest'));
    let projectName = originalProjectName(response, config.projectName || 'Projeto');
    if (binaryDownload) {
      archive = await response.blob();
    } else {
      const payload = await response.json() as {
        data?: string;
        projectName?: string;
        name?: string;
        workspaceRevision?: number;
        cssDigest?: string;
        templateDigest?: string;
      };
      if (!payload.data) throw new Error('O WordPress entregou um projeto vazio.');
      const binary = atob(payload.data);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      archive = new Blob([bytes], { type: 'application/zip' });
      workspaceRevision = safeRevision(payload.workspaceRevision);
      workspaceDigest = validDigest(payload.cssDigest);
      templateDigest = validDigest(payload.templateDigest);
      projectName = payload.projectName || payload.name?.replace(/\.zip$/i, '') || projectName;
    }
    // ZIP inflation is needed only by the A/B authoring compatibility path.
    // Keeping it behind this dynamic edge prevents Overview/Settings startup
    // from downloading the complete project-io/JSZip graph.
    const { importZip, sanitizeProjectPriorities } = await import('@/lib/html-editor/project-io');
    // Match the Builder's authoring boundary exactly. Membership transports
    // contain scrubbed public HTML plus private editorHtml, while legacy coded
    // builds contain generated HTML plus originals. Settings must never edit
    // either transport projection as though it were authored source.
    const project = sanitizeProjectPriorities(
      await importZip(new File([archive], `${projectName || 'projeto'}.zip`, { type: 'application/zip' })),
    );
    return {
      project: { ...project, name: projectName || project.name },
      workspaceRevision: Math.max(0, workspaceRevision),
      workspaceDigest,
      templateDigest,
      loadedAt: Date.now(),
      source: 'full-project',
    };
  }, {
    timeoutMs: FULL_PROJECT_REQUEST_TIMEOUT_MS,
    timeoutMessage: 'O projeto completo demorou demais para responder.',
    signal,
  });
}

function validateSaveAcknowledgement(
  payload: WordPressDraftSavePayload | null,
  expectedRevision: number,
) {
  const revision = safeRevision(payload?.workspaceRevision);
  const digest = validDigest(payload?.cssDigest || payload?.workspaceDigest);
  const confirmedAt = payload?.savedAt ? Date.parse(payload.savedAt) : Number.NaN;
  if (
    payload?.success !== true
    || revision <= expectedRevision
    || !digest
    || !Number.isFinite(confirmedAt)
  ) {
    throw new Error('O WordPress respondeu sem confirmar revisão, integridade e horário do projeto.');
  }
  return { revision, digest };
}

class WordPressSurfaceRevisionConflictError extends Error {
  readonly retryable = false;
  readonly preserveLocalDraft = true;
}

type SurfaceSaveOptions = { surface: WordPressProjectSurface; allowArchiveFallback?: boolean; signal?: AbortSignal };

export async function persistWordPressProjectSurface(
  config: KodetyWordPressConfig,
  previous: WordPressProjectSurfaceSnapshot,
  nextProject: HtmlProject,
  options: SurfaceSaveOptions,
): Promise<WordPressProjectSurfaceSnapshot> {
  try {
    return await persistWordPressProjectSurfaceOnce(config, previous, nextProject, options);
  } catch (error) {
    if (!(error instanceof WordPressSurfaceRevisionConflictError)) throw error;
    const remote = previous.source === 'full-project'
      ? await loadFullWordPressProject(config, options.signal)
      : await fetchWordPressProjectSurface(config, options.surface, options.signal);
    const { mergeWorkspaceConflictStrict } = await import('@/lib/html-editor/collaborative-merge');
    // Do not publish the newer revision to the caller until the draft has been
    // reconciled. A retry always contains both authors' independent changes.
    const merged = mergeWorkspaceConflictStrict(previous.project, nextProject, remote.project);
    return persistWordPressProjectSurfaceOnce(config, remote, merged.project, options);
  }
}

async function persistWordPressProjectSurfaceOnce(
  config: KodetyWordPressConfig,
  previous: WordPressProjectSurfaceSnapshot,
  nextProject: HtmlProject,
  options: SurfaceSaveOptions,
) {
  if (!config.projectDeltaUrl) throw new Error('O salvamento incremental não está disponível.');
  // Loading a read-only surface must not pay for ZIP creation or delta upload
  // code. These modules enter the graph only after the first authored save.
  const [draftTransport, draftDelta] = await Promise.all([
    import('@/lib/html-editor/editor-wordpress-helpers'),
    import('@/lib/html-editor/wordpress-draft-delta'),
  ]);
  const {
    isSafeWordPressDraftDeltaFallback,
    uploadWordPressDraftArchive,
    uploadWordPressDraftDelta,
  } = draftTransport;
  const {
    createWordPressDraftDelta,
    createWordPressDraftDeltaRequestId,
  } = draftDelta;
  const updatedAt = new Date().toISOString();
  const request = await createWordPressDraftDelta(previous.project, nextProject, {
    baseRevision: previous.workspaceRevision,
    ...(previous.workspaceDigest ? { baseDigest: previous.workspaceDigest } : {}),
    requestId: createWordPressDraftDeltaRequestId(),
    updatedAt,
    maxRawBytes: SURFACE_DELTA_MAX_BYTES,
    maxBodyBytes: SURFACE_DELTA_MAX_BYTES,
    maxOperations: SURFACE_DELTA_MAX_OPERATIONS,
    maxPathBytes: SURFACE_DELTA_MAX_PATH_BYTES,
  });
  const headers = {
    'X-WP-Nonce': config.nonce,
    'X-Kodety-Expected-Revision': String(previous.workspaceRevision),
    ...(previous.source === 'full-project' ? {} : { 'X-Kodety-Delta-Root': 'project' }),
  };
  let response: Response;
  let payload: WordPressDraftSavePayload | null;
  if (request.kind === 'delta') {
    ({ response, payload } = await uploadWordPressDraftDelta({
      body: request.body,
      projectDeltaUrl: config.projectDeltaUrl,
      headers,
      signal: options.signal,
    }));
    if (
      !response.ok
      && options.allowArchiveFallback
      && isSafeWordPressDraftDeltaFallback(response, payload)
      && config.projectUrl
    ) {
      const { projectToZipBlob } = await import('@/lib/html-editor/project-io');
      const archive = await projectToZipBlob(nextProject, { fast: true, updatedAt, signal: options.signal });
      ({ response, payload } = await uploadWordPressDraftArchive({
        archive,
        projectUrl: config.projectUrl,
        projectChunkUrl: config.projectChunkUrl,
        headers,
        chunkThresholdBytes: 12 * 1024 * 1024,
        chunkBytes: 4 * 1024 * 1024,
        fallbackChunkBytes: 1024 * 1024,
        signal: options.signal,
      }));
    }
  } else if (options.allowArchiveFallback && config.projectUrl) {
    const { projectToZipBlob } = await import('@/lib/html-editor/project-io');
    const archive = await projectToZipBlob(nextProject, { fast: true, updatedAt, signal: options.signal });
    ({ response, payload } = await uploadWordPressDraftArchive({
      archive,
      projectUrl: config.projectUrl,
      projectChunkUrl: config.projectChunkUrl,
      headers,
      chunkThresholdBytes: 12 * 1024 * 1024,
      chunkBytes: 4 * 1024 * 1024,
      fallbackChunkBytes: 1024 * 1024,
      signal: options.signal,
    }));
  } else {
    throw new Error('A alteração excede o limite seguro do salvamento leve. Abra o Builder para concluir esta operação.');
  }
  if (!response.ok) {
    if (response.status === 409 && ['kodety_workspace_conflict', 'kodety_workspace_digest_conflict', 'kodety_revision_conflict'].includes(payload?.code || '')) {
      throw new WordPressSurfaceRevisionConflictError(
        'O projeto mudou em outra sessão. Suas alterações continuam nesta tela; o conteúdo do servidor foi preservado.',
      );
    }
    throw new Error(payload?.message || `O WordPress recusou o salvamento (HTTP ${response.status}).`);
  }
  const acknowledgement = validateSaveAcknowledgement(payload, previous.workspaceRevision);
  const snapshot: WordPressProjectSurfaceSnapshot = {
    project: nextProject,
    workspaceRevision: acknowledgement.revision,
    workspaceDigest: acknowledgement.digest,
    templateDigest: validDigest(payload?.templateDigest) || previous.templateDigest,
    loadedAt: Date.now(),
    source: options.allowArchiveFallback ? 'full-project' : 'network',
  };
  if (!options.allowArchiveFallback) {
    cacheWordPressProjectSurface(config, options.surface, snapshot);
  }
  return snapshot;
}

export async function fetchWordPressProjectSurfaceAsset(
  config: KodetyWordPressConfig,
  path: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<HtmlProjectFile> {
  if (!config.projectSurfaceAssetUrl) throw new Error('Este asset não está disponível no modo leve.');
  if (safeRevision(expectedRevision) < 0) throw new Error('A revisão deste asset não está disponível.');
  const endpoint = new URL(config.projectSurfaceAssetUrl, window.location.href);
  endpoint.searchParams.set('path', path);
  endpoint.searchParams.set('revision', String(expectedRevision));
  const requestKey = `${endpoint.href}\n${config.nonce}`;
  if (!signal) {
    const pending = inFlightSurfaceAssetRequests.get(requestKey);
    if (pending) return pending;
  }
  const request = withRequestTimeout(async requestSignal => {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': config.nonce },
      signal: requestSignal,
    });
    const payload = await response.json().catch(() => null) as {
      path?: string;
      mimeType?: string;
      data?: string;
      workspaceRevision?: number;
      message?: string;
    } | null;
    if (!response.ok || !payload?.data) {
      throw new Error(payload?.message || 'O asset solicitado não está disponível.');
    }
    if (safeRevision(payload.workspaceRevision) !== expectedRevision) {
      throw new Error('O projeto mudou enquanto este asset era carregado. Tente novamente.');
    }
    const binary = atob(payload.data);
    return {
      path: normalizePath(payload.path) || normalizePath(path),
      mimeType: payload.mimeType || 'application/octet-stream',
      data: Uint8Array.from(binary, character => character.charCodeAt(0)),
    };
  }, {
    timeoutMs: SURFACE_ASSET_REQUEST_TIMEOUT_MS,
    timeoutMessage: 'O asset demorou demais para responder.',
    signal,
  });
  if (signal) return request;
  inFlightSurfaceAssetRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (inFlightSurfaceAssetRequests.get(requestKey) === request) {
      inFlightSurfaceAssetRequests.delete(requestKey);
    }
  }
}
