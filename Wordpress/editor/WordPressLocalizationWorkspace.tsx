import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';
import { Button } from '@/components/ui/button';
import { Languages } from '@/components/ui/gravity-icons';
import { HtmlLocalizationManager } from '@/app/(builder)/kodety/html-editor/components/HtmlLocalizationManager';
import { HtmlWorkspaceAgentDock } from '@/app/(builder)/kodety/html-editor/components/HtmlWorkspaceAgentDock';
import {
  useHtmlAgentEditorBridgeStore,
  type HtmlAgentToolCallMeta,
} from '@/stores/useHtmlAgentEditorBridgeStore';
import {
  actOnAgentPanel,
  snapshotAgentPanel,
  type AgentPanelAction,
} from '@/lib/html-editor/agent-panel-tools';
import {
  applyAgentLocalizationChanges,
  applyAgentLocalizationSettings,
  snapshotAgentLocalization,
  type AgentLocalizationChange,
  type AgentLocalizationSettingsArgs,
} from '@/lib/html-editor/agent-localization-tools';
import type { HtmlProject } from '@/lib/html-editor/types';
import { mergeWorkspaceConflictStrict, rebaseQueuedWorkspaceProject } from '@/lib/html-editor/collaborative-merge';
import type { AgentNativeLifecycleContext } from '@/lib/html-editor/agent-native-tools';
import {
  WORDPRESS_DRAFT_UPLOAD_CHUNK_BYTES,
  WORDPRESS_DRAFT_UPLOAD_CHUNK_THRESHOLD_BYTES,
  WORDPRESS_DRAFT_UPLOAD_FALLBACK_CHUNK_BYTES,
} from '@/lib/html-editor/editor-constants';
import {
  projectHasOnlyLocalizationMetadataChange,
  uploadWordPressDraftArchive,
} from '@/lib/html-editor/editor-wordpress-helpers';
import {
  ensureProjectIdentity,
  getProjectHomePath,
  importZip,
  projectToZipBlob,
  readEditorMetadata,
  sanitizeProjectPriorities,
  updateEditorMetadata,
  updateTextFile,
} from '@/lib/html-editor/project-io';
import {
  assertLocalizationForPersistence,
  defaultLocalization,
  ensureProjectLocalizationIds,
  normalizeLocalization,
  setLocalizationSiteLanguage,
  siteLanguageLocaleCode,
  type LocalizationSettings,
} from '@/lib/html-editor/localization';
import { applySeoToHtml, readPageSeoFromHtml, readSiteSeoFromHtml } from '@/lib/html-editor/seo-settings';
import {
  loadProjectRecoverySnapshot,
  saveProjectSnapshot,
  type StoredHtmlProject,
} from '@/lib/html-editor/project-storage';
import {
  WORDPRESS_LOCALIZATION_PATH,
  takeLocalizationProjectPrefetch,
  wordpressEntryConfig,
  wordpressEntryReadOnly,
  type KodetyWordPressEntryConfig,
} from './wordpress-entry-config';
import { WORDPRESS_WORKSPACE_TOASTER_PROPS } from './wordpress-workspace-toaster';
import { navigateWithEditorLockHandoff } from './editor-lock-navigation';
import { WordPressWorkspaceLogoMenu } from './WordPressWorkspaceLogoMenu';
import { registerWorkspaceNavigationGuard } from '@/lib/html-editor/workspace-navigation';
import { withRequestTimeout } from '@/lib/request-timeout';

const LOCALIZATION_SAVE_IDLE_MS = 2000;
const LOCAL_SNAPSHOT_IDLE_MS = 700;
const LARGE_LOCAL_SNAPSHOT_IDLE_MS = 2000;
const WORDPRESS_RETRY_MAX_MS = 60_000;
const LOCALIZATION_PROJECT_LOAD_TIMEOUT_MS = 60_000;

interface ProjectPayload {
  data?: string;
  name?: string;
  projectName?: string;
  workspaceRevision?: number;
  cssDigest?: string;
  message?: string;
}

interface SaveWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface ProjectSaveResult {
  success?: boolean;
  code?: string;
  message?: string;
  savedAt?: string;
  workspaceRevision?: number;
  data?: { currentRevision?: number; retryable?: boolean };
}

class WorkspaceRevisionConflictError extends Error {
  readonly retryable = false;
  readonly preserveLocalDraft = true;
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceRevisionConflictError';
  }
}

class LocalizationSaveRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'LocalizationSaveRequestError';
  }
}

function shouldRetryLocalizationSave(error: unknown) {
  return error instanceof LocalizationSaveRequestError && error.retryable;
}

function decodeBase64Bytes(encoded: string) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeProjectHeader(response: Response, name: string, fallback = '') {
  const value = response.headers.get(name)?.trim() || '';
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeLoadedProject(project: HtmlProject, projectName?: string) {
  return ensureProjectIdentity(
    sanitizeProjectPriorities({
      ...project,
      name: projectName?.trim() || project.name,
    }),
  );
}

function projectSize(project: HtmlProject) {
  return Object.values(project.files).reduce(
    (total, file) => total + (file.data?.byteLength || (file.text?.length || 0) * 2),
    0,
  );
}

function localizationFromProject(project: HtmlProject) {
  const metadata = readEditorMetadata(project);
  const normalized = normalizeLocalization(
    metadata.localization || defaultLocalization(metadata.siteSettings?.language || 'pt-BR'),
  );
  return metadata.siteSettings?.language
    ? setLocalizationSiteLanguage(normalized, metadata.siteSettings.language)
    : normalized;
}

function projectWithLocalization(project: HtmlProject, nextLocalization: LocalizationSettings) {
  const normalized = normalizeLocalization(nextLocalization);
  assertLocalizationForPersistence(normalized);
  let next = ensureProjectLocalizationIds(project);
  const metadata = readEditorMetadata(next);
  const homePath = getProjectHomePath(next);
  const currentSiteSettings = {
    ...readSiteSeoFromHtml(next.files[homePath]?.text || ''),
    ...(metadata.siteSettings || {}),
  };
  const synchronizedSiteSettings = {
    ...currentSiteSettings,
    language: normalized.sourceLocale,
  };
  const previousLocalization = normalizeLocalization(
    metadata.localization || defaultLocalization(currentSiteSettings.language || 'pt-BR'),
  );
  const siteLanguageChanged =
    previousLocalization.sourceLocale !== normalized.sourceLocale ||
    siteLanguageLocaleCode(currentSiteSettings.language || previousLocalization.sourceLocale) !== normalized.sourceLocale;

  if (siteLanguageChanged) {
    Object.keys(next.files)
      .filter(path => !path.startsWith('.incode/') && /\.html?$/i.test(path))
      .forEach(path => {
        const pageSettings = {
          ...readPageSeoFromHtml(next.files[path]?.text || ''),
          ...(metadata.pageSettings?.[path] || {}),
        };
        next = updateTextFile(
          next,
          path,
          applySeoToHtml(next.files[path]?.text || '', path, synchronizedSiteSettings, pageSettings),
        );
      });
  }

  return normalizeLoadedProject(
    updateEditorMetadata(next, value => ({
      ...value,
      siteSettings: synchronizedSiteSettings,
      localization: normalized,
    })),
  );
}

async function fetchProject(config: KodetyWordPressEntryConfig, queryKey: string, signal?: AbortSignal) {
  if (!config.projectUrl) throw new Error('O projeto não está disponível para esta conta.');
  const binaryDownload = Boolean(config.projectDownloadUrl);
  const projectUrl = new URL(config.projectDownloadUrl || config.projectUrl, window.location.href);
  projectUrl.searchParams.set(queryKey, String(Date.now()));
  const prefetched = queryKey === '_kodety_project_revision'
    ? takeLocalizationProjectPrefetch(config, signal)
    : null;
  let response = prefetched ? await prefetched : null;
  if (signal?.aborted) throw signal.reason || new DOMException('Carregamento cancelado.', 'AbortError');
  response ||= await fetch(projectUrl, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-WP-Nonce': config.nonce },
    signal,
  });
  if (!response.ok) {
    const payload = binaryDownload
      ? null
      : (await response.json().catch(() => null)) as ProjectPayload | null;
    throw new Error(
      payload?.message ||
        (response.status === 404
          ? 'Importe um projeto ZIP no painel Onun Kodety primeiro.'
          : 'Não foi possível carregar o projeto publicado.'),
    );
  }
  if (binaryDownload) {
    const contentType = response.headers.get('Content-Type')?.toLowerCase() || '';
    if (!contentType.includes('application/zip')) {
      throw new Error('O WordPress não entregou um ZIP válido para a localização.');
    }
    const archive = await response.blob();
    if (archive.size <= 0) throw new Error('O WordPress entregou um projeto vazio.');
    const imported = await importZip(new File([
      archive,
    ], decodeProjectHeader(response, 'X-Kodety-Original-Name', 'site-kodety.zip'), {
      type: 'application/zip',
    }));
    return {
      project: normalizeLoadedProject(
        imported,
        decodeProjectHeader(response, 'X-Kodety-Project-Name', imported.name),
      ),
      workspaceRevision: Number(response.headers.get('X-Kodety-Workspace-Revision')) || 0,
    };
  }
  const payload = (await response.json().catch(() => null)) as ProjectPayload | null;
  if (!payload?.data) throw new Error('O WordPress não entregou os dados do projeto.');
  const imported = await importZip(
    new File([decodeBase64Bytes(payload.data)], payload.name || 'site-kodety.zip', {
      type: 'application/zip',
    }),
  );
  return {
    project: normalizeLoadedProject(imported, payload.projectName),
    workspaceRevision: Number(payload.workspaceRevision) || 0,
  };
}

export default function WordPressLocalizationWorkspace() {
  const config = wordpressEntryConfig();
  const agentEditorOwnerId = useId();
  const [project, setProject] = useState<HtmlProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadControllerRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const projectRef = useRef<HtmlProject | null>(null);
  const acknowledgedProjectRef = useRef<HtmlProject | null>(null);
  const authoredAcknowledgementsRef = useRef(new WeakMap<HtmlProject, HtmlProject>());
  const workspaceRevisionRef = useRef(0);
  const pendingSaveRef = useRef<HtmlProject | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveWaitersRef = useRef<SaveWaiter[]>([]);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const requestedRetryDelayRef = useRef(0);
  const localSnapshotTimerRef = useRef<number | null>(null);
  const protectedRecoveryRef = useRef<StoredHtmlProject | null>(null);
  const navigationPendingRef = useRef(false);
  const agentMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const agentMutationResultsRef = useRef(new Map<string, unknown>());
  const agentNativeBaseRef = useRef<HtmlProject | null>(null);
  const readOnly = wordpressEntryReadOnly(config);

  const installProject = useCallback((next: HtmlProject) => {
    acknowledgedProjectRef.current = next;
    projectRef.current = next;
    setProject(next);
    if (pendingSaveRef.current) pendingSaveRef.current = next;
  }, []);

  const preserveRejectedSnapshot = useCallback((snapshot: HtmlProject) => {
    // A rejected save never replaces the draft with the last acknowledged copy.
    // Keep the newest local snapshot available for retry and navigation guards.
    pendingSaveRef.current = projectRef.current || snapshot;
  }, []);

  const load = useCallback(async () => {
    if (!config) {
      setLoadError('A configuração do WordPress não está disponível.');
      setLoading(false);
      return;
    }
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const loaded = await withRequestTimeout(
        requestSignal => fetchProject(config, '_kodety_project_revision', requestSignal),
        {
          signal: controller.signal,
          timeoutMs: LOCALIZATION_PROJECT_LOAD_TIMEOUT_MS,
          timeoutMessage: 'O projeto demorou demais para abrir. Tente novamente.',
        },
      );
      if (generation !== loadGenerationRef.current) return;
      workspaceRevisionRef.current = loaded.workspaceRevision;
      installProject(loaded.project);
    } catch (error) {
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      setLoadError(error instanceof Error ? error.message : 'Não foi possível abrir o site.');
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [config, installProject]);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
      loadControllerRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    void loadProjectRecoverySnapshot()
      .then(snapshot => {
        protectedRecoveryRef.current = snapshot;
      })
      .catch(() => undefined);
  }, []);

  const persistProject = useCallback(
    async (requested: HtmlProject, nativeContext?: AgentNativeLifecycleContext, authored = requested) => {
      nativeContext?.assertCurrent();
      if (!config?.projectUrl || wordpressEntryReadOnly(config)) {
        return;
      }
      let expectedRevision = workspaceRevisionRef.current;
      let base = acknowledgedProjectRef.current;
      let candidate = requested;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response: Response;
        let result: ProjectSaveResult | null;
        let responseCode = '';
        try {
          if (
            config.localizationSaveUrl
            && projectHasOnlyLocalizationMetadataChange(base, candidate)
          ) {
            const localization = readEditorMetadata(candidate).localization;
            if (!localization) throw new Error('O projeto não contém a configuração de idiomas.');
            response = await fetch(config.localizationSaveUrl, {
              method: 'POST',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': config.nonce,
                'X-Kodety-Expected-Revision': String(expectedRevision),
              },
              body: JSON.stringify({ localization }),
              signal: nativeContext?.signal,
            });
            result = (await response.json().catch(() => null)) as ProjectSaveResult | null;
            nativeContext?.assertCurrent();
            responseCode = result?.code || '';
          } else {
            const archive = await projectToZipBlob(candidate, { fast: true, signal: nativeContext?.signal });
            nativeContext?.assertCurrent();
            const upload = await uploadWordPressDraftArchive({
              archive,
              projectUrl: config.projectUrl,
              projectChunkUrl: config.projectChunkUrl,
              headers: {
                'X-WP-Nonce': config.nonce,
                'X-Kodety-Expected-Revision': String(expectedRevision),
              },
              chunkThresholdBytes: WORDPRESS_DRAFT_UPLOAD_CHUNK_THRESHOLD_BYTES,
              chunkBytes: WORDPRESS_DRAFT_UPLOAD_CHUNK_BYTES,
              fallbackChunkBytes: WORDPRESS_DRAFT_UPLOAD_FALLBACK_CHUNK_BYTES,
              signal: nativeContext?.signal,
            });
            nativeContext?.assertCurrent();
            response = upload.response;
            result = upload.payload as ProjectSaveResult | null;
            responseCode = upload.payload?.code || '';
          }
        } catch (error) {
          nativeContext?.assertCurrent();
          throw new LocalizationSaveRequestError(
            error instanceof Error ? error.message : 'A conexão foi interrompida durante o salvamento.',
            (error as { retryable?: unknown } | null)?.retryable === true || error instanceof TypeError,
          );
        }

        if (response.status === 409 && responseCode === 'kodety_draft_chunk_conflict') {
          throw new LocalizationSaveRequestError(
            result?.message || 'O WordPress não conseguiu retomar o upload em partes.',
            false,
          );
        }

        if (response.status === 409) {
          if (attempt > 0 || !base) {
            throw new WorkspaceRevisionConflictError(
              'O projeto continua mudando em outra sessão. Suas alterações permanecem nesta tela e o conteúdo do servidor foi preservado.',
            );
          }
          const remotePayload = await fetchProject(config, '_kodety_revision_conflict', nativeContext?.signal);
          nativeContext?.assertCurrent();
          const merged = mergeWorkspaceConflictStrict(base, candidate, remotePayload.project);
          // Only this attempt receives the new baseline. A rejected merge must
          // never grant a later stale draft permission to overwrite the server.
          base = remotePayload.project;
          expectedRevision = remotePayload.workspaceRevision;
          candidate = merged.project;
          continue;
        }

        if (!response.ok) {
          const requestError = new LocalizationSaveRequestError(
            result?.message || 'O WordPress recusou o salvamento do rascunho.',
            response.status === 408
              || response.status === 425
              || response.status === 429
              || result?.data?.retryable === true
              || (response.status >= 500 && !responseCode),
          );
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After')?.trim() || '';
            const retrySeconds = Number(retryAfter);
            const retryDate = retryAfter && !Number.isFinite(retrySeconds) ? Date.parse(retryAfter) : Number.NaN;
            const requestedDelay = Number.isFinite(retrySeconds)
              ? retrySeconds * 1000
              : Number.isFinite(retryDate)
                ? retryDate - Date.now()
                : 0;
            requestedRetryDelayRef.current = Math.min(
              5 * 60_000,
              Math.max(15_000, requestedDelay),
            );
          }
          throw requestError;
        }

        const confirmedRevision = Number(result?.workspaceRevision);
        if (result?.success !== true || !Number.isSafeInteger(confirmedRevision) || confirmedRevision <= expectedRevision) {
          throw new LocalizationSaveRequestError('O WordPress não confirmou a revisão salva. Suas alterações permanecem nesta tela.', false);
        }
        const live = projectRef.current;
        const current = live && live !== authored
          ? mergeWorkspaceConflictStrict(authored, live, candidate).project
          : candidate;
        workspaceRevisionRef.current = confirmedRevision;
        acknowledgedProjectRef.current = candidate;
        projectRef.current = current;
        setProject(current);
        if (pendingSaveRef.current) pendingSaveRef.current = current;
        retryCountRef.current = 0;
        requestedRetryDelayRef.current = 0;
        return candidate;
      }
    },
    [config],
  );

  const queueWrite = useCallback(
    (snapshot: HtmlProject, nativeContext?: AgentNativeLifecycleContext) => {
      const queuedBase = acknowledgedProjectRef.current;
      const write = writeChainRef.current.catch(() => undefined).then(async () => {
        const acknowledged = acknowledgedProjectRef.current;
        const candidate = queuedBase && acknowledged
          ? rebaseQueuedWorkspaceProject(queuedBase, snapshot, acknowledged, authoredAcknowledgementsRef.current.get(acknowledged))
          : snapshot;
        const saved = await persistProject(candidate, nativeContext, snapshot);
        if (saved) authoredAcknowledgementsRef.current.set(saved, snapshot);
      });
      writeChainRef.current = write;
      return write;
    },
    [persistProject],
  );

  const scheduleRetry = useCallback(
    (snapshot: HtmlProject) => {
      pendingSaveRef.current = projectRef.current || snapshot;
      if (retryTimerRef.current !== null) return;
      const delay = Math.max(
        requestedRetryDelayRef.current,
        Math.min(WORDPRESS_RETRY_MAX_MS, 2000 * 2 ** retryCountRef.current),
      );
      retryCountRef.current = Math.min(retryCountRef.current + 1, 5);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        requestedRetryDelayRef.current = 0;
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        const pending = pendingSaveRef.current || projectRef.current;
        pendingSaveRef.current = null;
        if (!pending) return;
        const waiters = saveWaitersRef.current.splice(0);
        void queueWrite(pending)
          .then(() => waiters.forEach(waiter => waiter.resolve()))
          .catch(error => {
            if (shouldRetryLocalizationSave(error)) {
              // Keep the original UI promise pending. A successful retry can
              // then move the status from “Salvando…” to “Alterações salvas”
              // instead of leaving the Manager in a permanent queued state.
              saveWaitersRef.current.unshift(...waiters);
              scheduleRetry(pending);
              return;
            }
            waiters.forEach(waiter => waiter.reject(error));
            preserveRejectedSnapshot(pending);
          });
      }, delay);
    },
    [queueWrite, preserveRejectedSnapshot],
  );

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const snapshot = pendingSaveRef.current;
    pendingSaveRef.current = null;
    const waiters = saveWaitersRef.current.splice(0);
    if (!snapshot) {
      await writeChainRef.current;
      waiters.forEach(waiter => waiter.resolve());
      return;
    }
    try {
      await queueWrite(snapshot);
      waiters.forEach(waiter => waiter.resolve());
    } catch (error) {
      if (shouldRetryLocalizationSave(error)) {
        saveWaitersRef.current.unshift(...waiters);
        scheduleRetry(snapshot);
      } else {
        waiters.forEach(waiter => waiter.reject(error));
        preserveRejectedSnapshot(snapshot);
      }
      throw error;
    }
  }, [queueWrite, preserveRejectedSnapshot, scheduleRetry]);

  const flushLatestProject = useCallback(async () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const activeAgentMutation = agentMutationChainRef.current;
      // A mutating agent call may itself be waiting for the scheduled save.
      // Drain that waiter before joining the agent chain to avoid cancelling a
      // retry timer and then waiting forever for the cancelled retry.
      await flushPendingSave();
      await activeAgentMutation;
      await flushPendingSave();
      const latest = projectRef.current;
      if (
        (!latest || latest === acknowledgedProjectRef.current)
        && agentMutationChainRef.current === activeAgentMutation
      ) return;
      if (attempt === 2) {
        throw new Error('O projeto ainda está recebendo alterações. Aguarde o salvamento e tente novamente.');
      }
      if (latest) pendingSaveRef.current = latest;
    }
  }, [flushPendingSave]);

  const scheduleSave = useCallback(
    (snapshot: HtmlProject) => {
      pendingSaveRef.current = snapshot;
      const promise = new Promise<void>((resolve, reject) => {
        saveWaitersRef.current.push({ resolve, reject });
      });
      // A retry already owns the next write and always reads the newest
      // pending snapshot. Do not arm a parallel normal timer for the same
      // metadata revision.
      if (retryTimerRef.current !== null) return promise;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushPendingSave().catch(() => undefined);
      }, LOCALIZATION_SAVE_IDLE_MS);
      return promise;
    },
    [flushPendingSave],
  );

  const saveLocalization = useCallback(
    (settings: LocalizationSettings) => {
      const current = projectRef.current;
      if (!current) return Promise.reject(new Error('O projeto não está disponível.'));
      if (wordpressEntryReadOnly(config)) {
        return Promise.reject(new Error('Este acesso permite apenas visualizar a localização.'));
      }
      try {
        const next = projectWithLocalization(current, settings);
        projectRef.current = next;
        setProject(next);
        return scheduleSave(next);
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error('Não foi possível salvar as configurações de idiomas.'),
        );
      }
    },
    [config, scheduleSave],
  );

  useEffect(() => {
    if (!project) return;
    if (localSnapshotTimerRef.current !== null) window.clearTimeout(localSnapshotTimerRef.current);
    localSnapshotTimerRef.current = window.setTimeout(
      () => {
        localSnapshotTimerRef.current = null;
        void saveProjectSnapshot(project, {
          preserveRecovery: protectedRecoveryRef.current || undefined,
        }).catch(() => undefined);
      },
      projectSize(project) >= 10 * 1024 * 1024 ? LARGE_LOCAL_SNAPSHOT_IDLE_MS : LOCAL_SNAPSHOT_IDLE_MS,
    );
  }, [project]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      const current = projectRef.current;
      if (current) {
        void saveProjectSnapshot(current, {
          preserveRecovery: protectedRecoveryRef.current || undefined,
        }).catch(() => undefined);
      }
      void flushPendingSave().catch(() => undefined);
    };
    const flushOnPageHide = () => {
      const current = projectRef.current;
      if (current) {
        void saveProjectSnapshot(current, {
          preserveRecovery: protectedRecoveryRef.current || undefined,
        }).catch(() => undefined);
      }
      void flushPendingSave().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushOnPageHide);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushOnPageHide);
    };
  }, [flushPendingSave]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      if (localSnapshotTimerRef.current !== null) window.clearTimeout(localSnapshotTimerRef.current);
    },
    [],
  );

  const prepareNavigation = useCallback(async () => {
    if (navigationPendingRef.current) return false;
    navigationPendingRef.current = true;
    try {
      if (!readOnly) await flushLatestProject();
      return true;
    } catch (error) {
      navigationPendingRef.current = false;
      toast.error('Não foi possível sair antes de salvar o projeto', {
        description: error instanceof Error ? error.message : undefined,
      });
      return false;
    }
  }, [flushLatestProject, readOnly]);

  useEffect(
    () => registerWorkspaceNavigationGuard(prepareNavigation),
    [prepareNavigation],
  );

  const navigateAfterSave = useCallback(
    async (href: string) => {
      if (!(await prepareNavigation())) return;
      navigateWithEditorLockHandoff(href);
    },
    [prepareNavigation],
  );

  const settings = useMemo(() => (project ? localizationFromProject(project) : null), [project]);

  const executeAgentTool = useCallback(
    async (tool: string, args: Record<string, unknown>, _meta: HtmlAgentToolCallMeta) => {
      const current = projectRef.current;
      if (!current) throw new Error('Nenhum projeto está aberto na Localização.');
      const currentSettings = localizationFromProject(current);
      if (tool === 'kodety_editor_context') {
        const metadata = readEditorMetadata(current);
        const localizationTools = [
          'kodety_localization_snapshot',
          'kodety_apply_localization_settings',
          'kodety_apply_localization_translations',
        ];
        const canonicalUrl = config?.localizationUrl
          || new URL(WORDPRESS_LOCALIZATION_PATH, window.location.origin).href;
        return {
          revision: String(workspaceRevisionRef.current),
          project: {
            id: metadata.projectId || null,
            name: current.name,
            rootPath: current.rootPath,
            mainHtmlPath: current.mainHtmlPath,
            fileCount: Object.keys(current.files).length,
          },
          editor: {
            workspace: 'localization',
            pathname: window.location.pathname,
            canonicalPath: WORDPRESS_LOCALIZATION_PATH,
            canonicalUrl,
            readOnly,
            locale: currentSettings.defaultLocale,
            sourceLocale: currentSettings.sourceLocale,
            nativePanel: {
              required: true,
              surface: 'localization',
              tools: [
                ...localizationTools,
                'kodety_panel_snapshot',
                'kodety_panel_action',
              ],
              directSourceMutationAllowed: false,
            },
          },
          localization: {
            sourceLocale: currentSettings.sourceLocale,
            defaultLocale: currentSettings.defaultLocale,
            locales: currentSettings.locales.map(locale => ({
              code: locale.code,
              name: locale.name,
              region: locale.region,
              slug: locale.slug,
              fallback: locale.fallback,
              enabled: locale.enabled,
              direction: locale.direction,
              default: locale.code === currentSettings.defaultLocale,
              source: locale.code === currentSettings.sourceLocale,
            })),
            tools: localizationTools,
            workspaceRequired: false,
            canonicalUrl,
          },
          selection: null,
          selectedPaths: [],
        };
      }
      if (tool === 'kodety_localization_snapshot') {
        return snapshotAgentLocalization(
          current,
          currentSettings,
          String(workspaceRevisionRef.current),
          args,
        );
      }
      if (tool === 'kodety_panel_snapshot') return snapshotAgentPanel('localization', args);
      if (tool === 'kodety_panel_action') {
        if (readOnly) throw new Error('Esta localização está em modo somente leitura.');
        return actOnAgentPanel('localization', {
          expectedRevision: typeof args.expectedRevision === 'string' ? args.expectedRevision : '',
          controlId: typeof args.controlId === 'string' ? args.controlId : '',
          action: typeof args.action === 'string' ? args.action as AgentPanelAction['action'] : 'focus',
          ...(typeof args.value === 'string' ? { value: args.value } : {}),
          ...(typeof args.checked === 'boolean' ? { checked: args.checked } : {}),
          ...(args.confirmDestructive === true ? { confirmDestructive: true } : {}),
        });
      }
      if (
        tool !== 'kodety_apply_localization_settings'
        && tool !== 'kodety_apply_localization_translations'
      ) {
        throw new Error(`A ferramenta “${tool || 'sem nome'}” não está disponível na Localização.`);
      }
      if (readOnly) throw new Error('Esta localização está em modo somente leitura.');
      const expectedRevision = typeof args.expectedRevision === 'string' ? args.expectedRevision : '';
      const currentRevision = String(workspaceRevisionRef.current);
      if (expectedRevision !== currentRevision) {
        throw new Error(`Conflito de revisão: a localização mudou para ${currentRevision}. Leia o catálogo novamente.`);
      }
      if (tool === 'kodety_apply_localization_settings') {
        const result = applyAgentLocalizationSettings(
          currentSettings,
          args as unknown as AgentLocalizationSettingsArgs,
        );
        if (result.changed) await saveLocalization(result.settings);
        return {
          action: result.action,
          localeCode: result.localeCode || null,
          changed: result.changed,
          revision: String(workspaceRevisionRef.current),
          summary: typeof args.summary === 'string' ? args.summary : '',
        };
      }
      const localeCode = typeof args.localeCode === 'string' ? args.localeCode : '';
      const translations = Array.isArray(args.translations)
        ? args.translations.map((value) => {
            const record = value && typeof value === 'object' && !Array.isArray(value)
              ? value as Record<string, unknown>
              : {};
            return {
              target: typeof record.target === 'string' ? record.target : '',
              value: typeof record.value === 'string' ? record.value : '',
            } satisfies AgentLocalizationChange;
          })
        : [];
      const result = applyAgentLocalizationChanges(
        current,
        currentSettings,
        localeCode,
        translations,
        args.overwrite === true,
      );
      if (!result.applied) {
        return {
          applied: 0,
          preserved: result.preserved,
          changedPages: [],
          revision: currentRevision,
          summary: typeof args.summary === 'string' ? args.summary : '',
        };
      }
      await saveLocalization(result.settings);
      return {
        applied: result.applied,
        preserved: result.preserved,
        changedPages: result.changedPages,
        revision: String(workspaceRevisionRef.current),
        summary: typeof args.summary === 'string' ? args.summary : '',
      };
    },
    [readOnly, saveLocalization],
  );

  const invokeAgentTool = useCallback(
    (tool: string, args: Record<string, unknown>, meta: HtmlAgentToolCallMeta) => {
      const mutating = tool === 'kodety_apply_localization_settings'
        || tool === 'kodety_apply_localization_translations'
        || tool === 'kodety_panel_action';
      if (!mutating) return executeAgentTool(tool, args, meta);
      if (agentMutationResultsRef.current.has(meta.callId)) {
        return Promise.resolve(agentMutationResultsRef.current.get(meta.callId));
      }
      const run = agentMutationChainRef.current.then(async () => {
        if (agentMutationResultsRef.current.has(meta.callId)) {
          return agentMutationResultsRef.current.get(meta.callId);
        }
        const result = await executeAgentTool(tool, args, meta);
        agentMutationResultsRef.current.set(meta.callId, result);
        if (agentMutationResultsRef.current.size > 100) {
          const oldest = agentMutationResultsRef.current.keys().next().value;
          if (oldest) agentMutationResultsRef.current.delete(oldest);
        }
        return result;
      });
      agentMutationChainRef.current = run.then(() => undefined, () => undefined);
      return run;
    },
    [executeAgentTool],
  );

  useLayoutEffect(() => {
    useHtmlAgentEditorBridgeStore.getState().publish(agentEditorOwnerId, {
      readOnly,
      invoke: invokeAgentTool,
      getScope: () => projectRef.current ? String(readEditorMetadata(projectRef.current).projectId || '') : '',
      beforeNativeOperation: async (operation, context) => {
        if (!operation.affectsWorkspace && !['project_get_settings', 'localization_get'].includes(operation.name)) return;
        if (operation.readOnly && readOnly) return;
        await flushLatestProject();
        context.assertCurrent();
        agentNativeBaseRef.current = acknowledgedProjectRef.current;
      },
      afterNativeOperation: async (operation, _result, context) => {
        context.assertCurrent();
        if (!operation.affectsWorkspace || !config) return;
        const base = agentNativeBaseRef.current;
        const loaded = await fetchProject(config, '_kodety_agent_native_revision', context.signal);
        context.assertCurrent();
        context.assertCurrent();
        const current = projectRef.current;
        const merge = base && current && current !== base ? mergeWorkspaceConflictStrict(base, current, loaded.project) : { project: loaded.project, recoveredPaths: [] };
        const merged = merge.project;
        workspaceRevisionRef.current = loaded.workspaceRevision;
        installProject(loaded.project);
        if (merged !== loaded.project) {
          projectRef.current = merged;
          setProject(merged);
          if (pendingSaveRef.current) pendingSaveRef.current = merged;
          await queueWrite(merged, context);
        }
        context.assertCurrent();
      },
    });
  });
  useEffect(() => () => {
    useHtmlAgentEditorBridgeStore.getState().resetOwner(agentEditorOwnerId);
  }, [agentEditorOwnerId]);

  if (loading) return <KodetyLoadingScreen label="Carregando idiomas" className="h-screen min-h-0" />;
  if (!project || !settings || loadError) {
    return (
      <main className="dark grid h-screen place-items-center bg-[var(--kodety-panel)] p-8 text-center text-[var(--kodety-text)]">
        <div className="max-w-sm">
          <span className="mx-auto grid size-11 place-items-center rounded-[11px] bg-white/[.045] text-white/35">
            <Languages className="size-5" />
          </span>
          <h1 className="mt-3 text-[13px] font-semibold">Não foi possível abrir os idiomas</h1>
          <p className="mx-auto mt-1 max-w-72 text-balance text-[10px] leading-4 text-[var(--kodety-info-copy)]">{loadError || 'O projeto não está disponível.'}</p>
          <Button className="mt-4 h-8 rounded-[8px]" size="xs" onClick={() => void load()}>
            Tentar novamente
          </Button>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="dark flex h-screen min-h-0 overflow-hidden bg-background text-foreground">
        <div data-kodety-agent-surface="localization" className="min-w-0 flex-1">
          <HtmlLocalizationManager
            logoMenu={<WordPressWorkspaceLogoMenu config={config} />}
            project={project}
            settings={settings}
            backHref={config?.editorUrl || '/kodety/editor/'}
            aiGenerateUrl={config?.aiGenerateUrl}
            aiSettingsPageUrl={config?.aiSettingsPageUrl}
            nonce={config?.nonce}
            readOnly={readOnly}
            onChange={saveLocalization}
            onNavigate={href => void navigateAfterSave(href)}
          />
        </div>
        <HtmlWorkspaceAgentDock surfaceLabel="Idiomas" preferredSkill="kodety-languages" />
      </div>
      <Toaster {...WORDPRESS_WORKSPACE_TOASTER_PROPS} />
    </>
  );
}
