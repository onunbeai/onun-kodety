import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import type { HtmlProject, HtmlProjectFile } from '@/lib/html-editor/types';
import { withRequestTimeout } from '../request-timeout';

const WORDPRESS_DRAFT_DELTA_TIMEOUT_MS = 45_000;
const WORDPRESS_DRAFT_PART_TIMEOUT_MS = 45_000;
const WORDPRESS_DRAFT_COMMIT_TIMEOUT_MS = 120_000;
export const WORDPRESS_DRAFT_CONFLICT_RECOVERY_TIMEOUT_MS = 45_000;
export const WORDPRESS_EXACT_SNAPSHOT_CHANGED_CODE = 'kodety_exact_snapshot_changed';
export const WORDPRESS_WORKSPACE_WRITE_SUPERSEDED_CODE = 'kodety_workspace_write_superseded';

type WordPressPersistenceError = Error & {
  code?: string;
  retryable?: boolean;
};

export function createWordPressExactSnapshotChangedError() {
  const error = new Error('O WordPress preservou uma revisão externa; revise o projeto mesclado antes de publicar.') as
    WordPressPersistenceError;
  error.code = WORDPRESS_EXACT_SNAPSHOT_CHANGED_CODE;
  error.retryable = false;
  return error;
}

export interface WordPressWorkspaceWriteFence {
  workspaceEpoch: number;
  projectId: string;
}

const normalizedWordPressWorkspaceProjectId = (projectId: string) => projectId.trim().toLowerCase();

export function isCurrentWordPressWorkspaceWrite(
  write: WordPressWorkspaceWriteFence,
  current: WordPressWorkspaceWriteFence,
) {
  const currentProjectId = normalizedWordPressWorkspaceProjectId(current.projectId);
  return write.workspaceEpoch === current.workspaceEpoch
    && (
      !currentProjectId
      || normalizedWordPressWorkspaceProjectId(write.projectId) === currentProjectId
    );
}

export function selectLatestWordPressWorkspaceWrite<Write extends WordPressWorkspaceWriteFence>(
  pending: Write,
  next: Write,
  current: WordPressWorkspaceWriteFence,
) {
  const pendingIsCurrent = isCurrentWordPressWorkspaceWrite(pending, current);
  const nextIsCurrent = isCurrentWordPressWorkspaceWrite(next, current);
  if (pendingIsCurrent !== nextIsCurrent) return pendingIsCurrent ? pending : next;
  if (pending.workspaceEpoch !== next.workspaceEpoch) {
    return pending.workspaceEpoch > next.workspaceEpoch ? pending : next;
  }
  return next;
}

export function createWordPressWorkspaceWriteSupersededError() {
  const error = new Error(
    'Este salvamento pertence ao projeto anterior e foi descartado pela substituição do workspace.',
  ) as WordPressPersistenceError;
  error.code = WORDPRESS_WORKSPACE_WRITE_SUPERSEDED_CODE;
  error.retryable = false;
  return error;
}

export function isWordPressWorkspaceWriteSupersededError(error: unknown) {
  return error instanceof Error
    && (error as WordPressPersistenceError).code === WORDPRESS_WORKSPACE_WRITE_SUPERSEDED_CODE;
}

export function shouldRetryWordPressExactSave(error: unknown) {
  if (!(error instanceof Error)) return true;
  const persistenceError = error as WordPressPersistenceError;
  return error.name !== 'AbortError'
    && error.name !== 'TimeoutError'
    && persistenceError.retryable !== false
    && persistenceError.code !== WORDPRESS_EXACT_SNAPSHOT_CHANGED_CODE;
}

export function withWordPressDraftConflictRecoveryTimeout<Result>(
  operation: (signal: AbortSignal) => Promise<Result>,
  signal?: AbortSignal,
  timeoutMs = WORDPRESS_DRAFT_CONFLICT_RECOVERY_TIMEOUT_MS,
) {
  return withRequestTimeout(operation, {
    timeoutMs,
    timeoutMessage: 'O WordPress demorou demais para entregar a revisão usada na recuperação do conflito.',
    signal,
  });
}

/**
 * A localization write queued before a publish owns the earlier CAS revision
 * and must be allowed to finish while that publish waits for it. A write queued
 * during a publish captures that controller and waits only for that release.
 * Comparing the captured token (instead of any active token) prevents a second
 * publish from creating another circular wait with the same localization job.
 */
export async function waitForCapturedWordPressPublishRelease<PublishToken extends object>(
  capturedPublish: PublishToken | null,
  activePublish: () => PublishToken | null,
  options: { timeoutMs?: number; pollMs?: number } = {},
) {
  if (capturedPublish === null) return;
  const timeoutMs = Math.max(1, options.timeoutMs ?? 180_000);
  const pollMs = Math.max(1, options.pollMs ?? 250);
  const startedAt = Date.now();
  while (activePublish() === capturedPublish) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('A publicação não liberou a fila de idiomas dentro do limite esperado.');
    }
    await new Promise<void>(resolve => globalThis.setTimeout(resolve, pollMs));
  }
}

/**
 * Hold only writes that reached the serialized draft queue after Publish
 * acknowledged its exact snapshot. A write captured before that owner is
 * allowed to finish, avoiding a circular wait; once armed, followers cannot
 * advance the workspace revision until the release request settles.
 */
export function createWordPressPublishDraftBarrier<PublishToken extends object>() {
  let armedPublish: PublishToken | null = null;

  return {
    arm(publish: PublishToken | null) {
      if (publish) armedPublish = publish;
    },
    release(publish: PublishToken | null) {
      if (publish && armedPublish === publish) armedPublish = null;
    },
    async waitForRelease(
      capturedPublish: PublishToken | null,
      activePublish: () => PublishToken | null,
      options: { timeoutMs?: number; pollMs?: number } = {},
    ) {
      if (!capturedPublish || armedPublish !== capturedPublish) return;
      await waitForCapturedWordPressPublishRelease(capturedPublish, activePublish, options);
    },
  };
}

export function shouldDeferWordPressDraftRetry(
  activePublish: object | null,
  navigationPending: boolean,
) {
  return activePublish !== null || navigationPending;
}

export function wordpressConfig() {
  if (typeof window === 'undefined') return undefined;
  return (window as typeof window & { kodetyWordPress?: KodetyWordPressConfig }).kodetyWordPress;
}

export function waitForAbortableDelay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Publicação cancelada.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createWordPressPublishRequestId() {
  return `publish-${
    globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }`;
}

export function isRetryableWordPressPublishStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export interface WordPressDraftSavePayload {
  code?: string;
  message?: string;
  success?: boolean;
  projectId?: string;
  complete?: boolean;
  received?: number;
  total?: number;
  savedAt?: string;
  cssDigest?: string;
  workspaceDigest?: string;
  projectDigest?: string;
  templateDigest?: string;
  workspaceRevision?: number;
  transport?: 'delta' | 'zip';
  fallbackToZip?: boolean;
  safeToRetryAsZip?: boolean;
  data?: {
    status?: number;
    currentRevision?: number;
    expectedOffset?: number;
    retryable?: boolean;
    fallbackToZip?: boolean;
    safeToRetryAsZip?: boolean;
  };
}

interface UploadWordPressDraftDeltaOptions {
  body: string;
  projectDeltaUrl: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}

interface UploadWordPressDraftArchiveOptions {
  archive: Blob;
  projectUrl: string;
  projectChunkUrl?: string;
  headers: Record<string, string>;
  chunkThresholdBytes: number;
  chunkBytes: number;
  fallbackChunkBytes: number;
  signal?: AbortSignal;
}

function createWordPressDraftUploadId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replaceAll('-', '');
  const random = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return random.padEnd(32, '0').slice(0, 32);
}

function wordpressRetryAfterMilliseconds(response: Response, attempt: number) {
  const value = response.headers.get('Retry-After')?.trim() || '';
  const seconds = Number(value);
  const date = value && !Number.isFinite(seconds) ? Date.parse(value) : Number.NaN;
  const requested = Number.isFinite(seconds)
    ? seconds * 1000
    : Number.isFinite(date)
      ? date - Date.now()
      : 0;
  return Math.max(250 * (attempt + 1), Math.min(15_000, Math.max(0, requested)));
}

function waitForWordPressDraftRetry(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Operação cancelada.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function readWordPressDraftPayload(response: Response) {
  return (await response.json().catch(() => null)) as WordPressDraftSavePayload | null;
}

/** A ZIP replay is allowed only while the delta receiver is transactionally
 * known not to have committed. The delta endpoint returns 400/422 only before
 * commit or after a confirmed rollback, so those transport/validation errors
 * transparently fall back to the already-supported full archive. Revision
 * conflicts and server failures remain on their dedicated recovery paths. */
export function isSafeWordPressDraftDeltaFallback(
  response: Response,
  payload: WordPressDraftSavePayload | null,
) {
  if (
    response.status === 400
    || response.status === 404
    || response.status === 405
    || response.status === 422
    || response.status === 501
  ) return true;
  if (
    response.status === 409
    || response.status === 412
    || response.status >= 500
  ) return false;
  const fallbackToZip = payload?.fallbackToZip === true || payload?.data?.fallbackToZip === true;
  const safeToRetry = payload?.safeToRetryAsZip === true || payload?.data?.safeToRetryAsZip === true;
  return fallbackToZip && safeToRetry;
}

export async function uploadWordPressDraftDelta({
  body,
  projectDeltaUrl,
  headers,
  signal,
}: UploadWordPressDraftDeltaOptions): Promise<{
  response: Response;
  payload: WordPressDraftSavePayload | null;
}> {
  return withRequestTimeout(async requestSignal => {
    const response = await fetch(projectDeltaUrl, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body,
      signal: requestSignal,
    });
    return { response, payload: await readWordPressDraftPayload(response) };
  }, {
    timeoutMs: WORDPRESS_DRAFT_DELTA_TIMEOUT_MS,
    timeoutMessage: 'O WordPress não respondeu ao salvamento incremental dentro do limite.',
    signal,
  });
}

/**
 * Upload one exact editable archive. Large projects retain a stable upload id
 * while retrying an individual part, understand the receiver's resumable 409,
 * and fall back to 1 MB requests when a proxy rejects the normal 4 MB body.
 * A workspace-revision 409 is returned untouched for the caller's merge path.
 */
export async function uploadWordPressDraftArchive({
  archive,
  projectUrl,
  projectChunkUrl,
  headers,
  chunkThresholdBytes,
  chunkBytes,
  fallbackChunkBytes,
  signal,
}: UploadWordPressDraftArchiveOptions): Promise<{
  response: Response;
  payload: WordPressDraftSavePayload | null;
}> {
  if (!projectChunkUrl || archive.size < chunkThresholdBytes) {
    return withRequestTimeout(async requestSignal => {
      const response = await fetch(projectUrl, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...headers,
          'Content-Type': 'application/zip',
        },
        body: archive,
        signal: requestSignal,
      });
      return { response, payload: await readWordPressDraftPayload(response) };
    }, {
      timeoutMs: WORDPRESS_DRAFT_COMMIT_TIMEOUT_MS,
      timeoutMessage: 'O WordPress não confirmou o rascunho dentro do limite.',
      signal,
    });
  }

  const sizes = Array.from(new Set([
    Math.max(1, Math.floor(chunkBytes)),
    Math.max(1, Math.min(Math.floor(chunkBytes), Math.floor(fallbackChunkBytes))),
  ]));
  let lastResponse: Response | null = null;
  let lastPayload: WordPressDraftSavePayload | null = null;
  let lastNetworkError: unknown = null;

  for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex += 1) {
    const partSize = sizes[sizeIndex];
    const uploadId = createWordPressDraftUploadId();
    let offset = 0;
    let restartWithSmallerParts = false;

    while (offset < archive.size) {
      signal?.throwIfAborted();
      const end = Math.min(archive.size, offset + partSize);
      let partAccepted = false;

      for (let requestAttempt = 0; requestAttempt < 3; requestAttempt += 1) {
        let response: Response;
        let payload: WordPressDraftSavePayload | null;
        try {
          ({ response, payload } = await withRequestTimeout(async requestSignal => {
            const partResponse = await fetch(projectChunkUrl, {
              method: 'POST',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: {
                ...headers,
                'Content-Type': 'application/octet-stream',
                'X-Kodety-Upload-Id': uploadId,
                'X-Kodety-Upload-Offset': String(offset),
                'X-Kodety-Upload-Total': String(archive.size),
              },
              body: archive.slice(offset, end),
              signal: requestSignal,
            });
            return {
              response: partResponse,
              payload: await readWordPressDraftPayload(partResponse),
            };
          }, {
            timeoutMs: end === archive.size
              ? WORDPRESS_DRAFT_COMMIT_TIMEOUT_MS
              : WORDPRESS_DRAFT_PART_TIMEOUT_MS,
            timeoutMessage: end === archive.size
              ? 'O WordPress não confirmou a montagem do rascunho dentro do limite.'
              : 'Uma parte do rascunho não foi recebida dentro do limite.',
            signal,
          }));
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          lastNetworkError = error;
          if (requestAttempt < 2) {
            await waitForWordPressDraftRetry(250 * (requestAttempt + 1), signal);
            continue;
          }
          restartWithSmallerParts = sizeIndex < sizes.length - 1;
          break;
        }

        lastResponse = response;
        lastPayload = payload;
        if (response.ok) {
          if (end === archive.size) return { response, payload };
          const received = Number(payload?.received);
          const validIntermediateAck = payload?.success === true
            && payload.complete === false
            && Number.isSafeInteger(received)
            && received === end
            && Number(payload.total) === archive.size;
          if (!validIntermediateAck) {
            lastNetworkError = new Error('O WordPress não confirmou corretamente a parte recebida.');
            if (requestAttempt < 2) {
              await waitForWordPressDraftRetry(250 * (requestAttempt + 1), signal);
              continue;
            }
            restartWithSmallerParts = sizeIndex < sizes.length - 1;
            break;
          }
          offset = received;
          partAccepted = true;
          break;
        }

        const expectedOffset = Number(payload?.data?.expectedOffset);
        const resumableConflict = response.status === 409
          && payload?.code === 'kodety_draft_chunk_conflict'
          && Number.isSafeInteger(expectedOffset)
          && expectedOffset >= 0
          && expectedOffset <= archive.size;
        if (resumableConflict) {
          if (expectedOffset === 0 && offset > 0) {
            restartWithSmallerParts = true;
            break;
          }
          if (expectedOffset >= end) {
            offset = expectedOffset;
            partAccepted = true;
            break;
          }
          if (expectedOffset !== offset) {
            offset = expectedOffset;
            partAccepted = true;
            break;
          }
          if (requestAttempt < 2) {
            await waitForWordPressDraftRetry(250 * (requestAttempt + 1), signal);
            continue;
          }
          restartWithSmallerParts = sizeIndex < sizes.length - 1;
          break;
        }

        const proxyRejectedPart = (
          response.status === 413
          || (response.status >= 500 && !payload?.code)
        ) && end < archive.size;
        if (proxyRejectedPart && sizeIndex < sizes.length - 1) {
          restartWithSmallerParts = true;
          break;
        }
        // A coded WordPress failure came from the application after it had
        // already accepted this chunk. Retrying it as a transport failure can
        // erase the original error: the completed staging file may already be
        // gone, so the retry is reduced to a misleading expectedOffset=0
        // conflict. Only anonymous proxy/server failures are safe to replay.
        if (!payload?.code && isRetryableWordPressPublishStatus(response.status) && requestAttempt < 2) {
          await waitForWordPressDraftRetry(wordpressRetryAfterMilliseconds(response, requestAttempt), signal);
          continue;
        }
        return { response, payload };
      }

      if (restartWithSmallerParts) break;
      if (!partAccepted) {
        if (lastResponse) return { response: lastResponse, payload: lastPayload };
        throw lastNetworkError instanceof Error
          ? lastNetworkError
          : new Error('A conexão foi interrompida durante o upload do rascunho.');
      }
    }

    if (!restartWithSmallerParts && lastResponse) {
      return { response: lastResponse, payload: lastPayload };
    }
  }

  if (lastResponse) return { response: lastResponse, payload: lastPayload };
  throw lastNetworkError instanceof Error
    ? lastNetworkError
    : new Error('O WordPress não iniciou o upload do rascunho.');
}

export function analyticsPageLabel(path: string, homePath: string) {
  if (path === homePath) return 'Home';
  return (
    path
      .split('/')
      .pop()
      ?.replace(/\.html?$/i, '') || path
  );
}

export function decodeBase64Bytes(encoded: string) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function decodeBase64Text(encoded: string) {
  return new TextDecoder('utf-8').decode(decodeBase64Bytes(encoded));
}

export async function purgeKodetyCaches(config: KodetyWordPressConfig) {
  if ('caches' in window) {
    const names = await window.caches.keys().catch(() => [] as string[]);
    await Promise.all(
      names.filter(name => /kodety|wordpress/i.test(name)).map(name => window.caches.delete(name).catch(() => false)),
    );
  }
  if (!config.cachePurgeUrl) return;
  const response = await fetch(config.cachePurgeUrl, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-WP-Nonce': config.nonce },
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(result?.message || 'O WordPress não conseguiu limpar o cache.');
  }
}

export function cmsPreviewItemsEndpoint(base: string, postType: string, orderby = 'date', order = 'DESC') {
  const url = new URL(base, window.location.href);
  const suffix = `/${encodeURIComponent(postType)}`;
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute) url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}${suffix}`);
  else url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`;
  url.searchParams.set('per_page', '100');
  url.searchParams.set('orderby', orderby);
  url.searchParams.set('order', order);
  return url.toString();
}

export function readLocalPreference(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalPreference(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled by private browsing or an embedded-site policy.
    // Preferences are optional and must never make the editor unusable.
  }
}

export function removeLocalPreference(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See writeLocalPreference(): losing a preference is safe.
  }
}

const projectSignatureCache = new WeakMap<HtmlProject, string>();

const projectFileSignatureCache = new WeakMap<HtmlProjectFile, string>();

const projectTransportSizeCache = new WeakMap<HtmlProject, number>();

/**
 * Proves that a localization edit can use the small metadata endpoint instead
 * of rebuilding the complete workspace ZIP. Binary identity is deliberately
 * compared by reference: scanning a 100 MB asset to choose a fast path would
 * recreate the very pause this endpoint is meant to remove.
 */
export function projectHasOnlyLocalizationMetadataChange(
  previous: HtmlProject | null,
  next: HtmlProject,
) {
  if (
    !previous
    || previous.name !== next.name
    || previous.mainHtmlPath !== next.mainHtmlPath
    || previous.rootPath !== next.rootPath
  ) return false;
  const previousPaths = Object.keys(previous.files);
  const nextPaths = Object.keys(next.files);
  if (previousPaths.length !== nextPaths.length || previousPaths.some((path) => !(path in next.files))) {
    return false;
  }
  return nextPaths.every((path) => {
    if (path === '.incode/project.json') return true;
    const left = previous.files[path];
    const right = next.files[path];
    if (!left || !right) return false;
    if (left === right) return true;
    return left.path === right.path
      && left.mimeType === right.mimeType
      && left.text === right.text
      && left.data === right.data;
  });
}

export function projectTransportSize(project: HtmlProject) {
  const cached = projectTransportSizeCache.get(project);
  if (cached !== undefined) return cached;
  const size = Object.values(project.files).reduce(
    (total, file) => total + (file.data?.byteLength ?? (file.text ? file.text.length * 2 : 0)),
    0,
  );
  projectTransportSizeCache.set(project, size);
  return size;
}

export function projectSignature(project: HtmlProject) {
  const cached = projectSignatureCache.get(project);
  if (cached) return cached;
  let hash = 2166136261;
  const identity = `${project.name}:${project.mainHtmlPath}:${project.rootPath}`;
  for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  Object.values(project.files)
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach(file => {
      let fileHash = projectFileSignatureCache.get(file);
      if (fileHash === undefined) {
        let first = 2166136261;
        let second = 2246822519;
        const metadata = `${file.path}:${file.mimeType}:`;
        for (let index = 0; index < metadata.length; index += 1) {
          const value = metadata.charCodeAt(index);
          first = Math.imul(first ^ value, 16777619);
          second = Math.imul(second ^ value, 3266489917);
        }
        if (file.text !== undefined) {
          for (let index = 0; index < file.text.length; index += 1) {
            const value = file.text.charCodeAt(index);
            first = Math.imul(first ^ value, 16777619);
            second = Math.imul(second ^ value, 3266489917);
          }
        } else if (file.data) {
          // File objects are immutable in project updates, so this full byte hash
          // is paid once per replacement and cached. Length alone treated two
          // different images of the same size as an unchanged draft.
          for (let index = 0; index < file.data.byteLength; index += 1) {
            const value = file.data[index];
            first = Math.imul(first ^ value, 16777619);
            second = Math.imul(second ^ value, 3266489917);
          }
        }
        fileHash = `${first >>> 0}:${second >>> 0}`;
        projectFileSignatureCache.set(file, fileHash);
      }
      for (let index = 0; index < fileHash.length; index += 1) {
        hash = Math.imul(hash ^ fileHash.charCodeAt(index), 16777619);
      }
    });
  const signature = (hash >>> 0).toString(36);
  projectSignatureCache.set(project, signature);
  return signature;
}

export function encodedSiteUrl(siteUrl: string, route: string) {
  const base = siteUrl.replace(/\/+$/, '');
  const encoded = route.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return encoded ? `${base}/${encoded}` : `${base}/`;
}

export function publishedPageUrl(siteUrl: string, pagePath: string, rootPath = '', staticRoots: string[] = []) {
  let clean = pagePath.replace(/^\/+/, '').replace(/\\/g, '/');
  const strip = (segment: string) => {
    const normalized = segment.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
    if (!normalized) return;
    if (clean === normalized || clean.startsWith(`${normalized}/`)) {
      clean = clean.slice(normalized.length).replace(/^\/+/, '');
    }
  };
  strip(rootPath);
  staticRoots.forEach(strip);
  const route = /(^|\/)index\.html?$/i.test(clean)
    ? clean.replace(/index\.html?$/i, '')
    : clean.replace(/\.html?$/i, '');
  return encodedSiteUrl(siteUrl, route);
}

export function relativePageHref(from: string, to: string) {
  if (from === to) return '';
  const fromParts = from.split('/').filter(Boolean);
  fromParts.pop();
  const toParts = to.split('/').filter(Boolean);
  while (fromParts[0] && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => '..'), ...toParts].join('/') || './';
}

export function codeLanguage(path: string): 'html' | 'css' | 'javascript' | 'typescript' | 'json' | 'plain' {
  const extension = path.split('.').pop()?.toLowerCase();
  if (['html', 'htm', 'svg', 'xml'].includes(extension || '')) return 'html';
  if (extension === 'css') return 'css';
  if (['js', 'mjs', 'cjs', 'jsx'].includes(extension || '')) return 'javascript';
  if (['ts', 'tsx'].includes(extension || '')) return 'typescript';
  if (['json', 'map', 'webmanifest'].includes(extension || '')) return 'json';
  return 'plain';
}
