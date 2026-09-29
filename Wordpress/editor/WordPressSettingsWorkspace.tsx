import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RefreshCw } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';
import type { SettingsCmsCollection } from '@/app/(builder)/kodety/html-editor/components/HtmlProjectSettings';
import { normalizeRedirectSettings } from '@/lib/html-editor/redirects';
import type { HtmlProject } from '@/lib/html-editor/types';
import type { AgentNativeLifecycleContext } from '@/lib/html-editor/agent-native-tools';
import { wordpressConfig } from '@/lib/html-editor/editor-wordpress-helpers';
import { withRequestTimeout } from '@/lib/request-timeout';
import { Toaster, toast } from 'sonner';
import type { WordPressProjectSurfaceSnapshot } from './wordpress-project-surface';
import {
  getLightProjectHomePath,
  readLightEditorMetadata,
} from './wordpress-light-project';
import { WORDPRESS_WORKSPACE_TOASTER_PROPS } from './wordpress-workspace-toaster';
import { WordPressWorkspaceBody, WordPressWorkspaceTopbar } from './WordPressWorkspaceChrome';
import { useWordPressNativePanelAgent } from './use-wordpress-native-panel-agent';
import { navigateWithEditorLockHandoff } from './editor-lock-navigation';
import {
  cacheCmsSchema, cmsSchemaScope, invalidateCmsSchemaCache, normalizeCmsSchemaResponse,
  readCmsSchemaCache, type CmsSchemaResponse,
} from './wordpress-cms-schema-cache';

const loadSettingsHost = () =>
  import('@/app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost');
const HtmlProjectSettingsStandaloneHost = lazy(() =>
  loadSettingsHost().then(module => ({ default: module.HtmlProjectSettingsStandaloneHost })),
);

const CMS_SCHEMA_TIMEOUT_MS = 12_000;

async function fetchCmsSchema(url: string, nonce: string, signal?: AbortSignal) {
  return withRequestTimeout(async requestSignal => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': nonce },
      signal: requestSignal,
    });
    const payload = normalizeCmsSchemaResponse(await response.json().catch(() => null));
    if (!response.ok || !payload) throw new Error('Não foi possível carregar as collections.');
    requestSignal.throwIfAborted();
    return payload;
  }, {
    timeoutMs: CMS_SCHEMA_TIMEOUT_MS,
    timeoutMessage: 'As collections demoraram demais para responder.',
    signal,
  });
}

function SettingsWorkspaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center" role="alert">
      <div className="max-w-sm">
        <h1 className="text-sm font-semibold text-foreground">Não foi possível abrir Settings</h1>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{message}</p>
        <Button className="mt-4" size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw /> Tentar novamente
        </Button>
      </div>
    </div>
  );
}

export default function WordPressSettingsWorkspace() {
  const config = wordpressConfig();
  const [snapshot, setSnapshot] = useState<WordPressProjectSurfaceSnapshot | null>(null);
  const [schemaState, setSchemaState] = useState<{ scope: string; value: CmsSchemaResponse | null; confirmed: boolean } | null>(null);
  const [schemaError, setSchemaError] = useState('');
  const [schemaRetry, setSchemaRetry] = useState(0);
  const schemaScope = config && snapshot
    ? cmsSchemaScope(config, String(readLightEditorMetadata(snapshot.project).projectId || config.share?.projectId || config.projectName || snapshot.project.name), snapshot.workspaceRevision, snapshot.templateDigest)
    : '';
  const schemaScopeRef = useRef(schemaScope);
  schemaScopeRef.current = schemaScope;
  // Cached schemas cannot drive mutations until this authorized context has
  // been revalidated. A changed scope hides the previous schema immediately.
  const schema = schemaState?.scope === schemaScope && schemaState.confirmed ? schemaState.value : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [writeReady, setWriteReady] = useState(false);
  const projectRef = useRef<HtmlProject | null>(null);
  const snapshotRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);
  const acknowledgedSnapshotRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const authoredAcknowledgementsRef = useRef(new WeakMap<HtmlProject, HtmlProject>());
  const confirmedAuthoredProjectsRef = useRef(new WeakSet<HtmlProject>());
  const localEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const writeReadyRevisionRef = useRef(-1);
  const agentNativeBaseRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);

  const readOnly = Boolean(
    config?.readOnly
    || config?.share?.mode === 'view',
  );

  const applySnapshot = useCallback((next: WordPressProjectSurfaceSnapshot, confirmed = true) => {
    snapshotRef.current = next;
    acknowledgedSnapshotRef.current = next;
    projectRef.current = next.project;
    writeReadyRevisionRef.current = confirmed ? next.workspaceRevision : -1;
    setWriteReady(confirmed);
    setSnapshot(next);
  }, []);

  const load = useCallback(async () => {
    if (!config) {
      setError('A configuração do WordPress não está disponível.');
      setLoading(false);
      return;
    }
    const epoch = localEpochRef.current;
    writeReadyRevisionRef.current = -1;
    setWriteReady(false);
    // Download the Settings controller while the small text-only request is in
    // flight, but keep it outside this route's static dependency graph.
    void loadSettingsHost();
    const transport = await import('./wordpress-project-surface');
    const cached = transport.readCachedWordPressProjectSurface(config, 'settings');
    if (cached && !projectRef.current) {
      applySnapshot(cached, false);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const next = config.projectSurfaceUrl
        ? cached
          ? await transport.fetchWordPressProjectSurface(config, 'settings')
          : await transport.loadWordPressProjectSurface(config, 'settings')
        : await transport.loadFullWordPressProject(config);
      if (!mountedRef.current || localEpochRef.current !== epoch) return;
      const base = acknowledgedSnapshotRef.current?.project;
      const current = projectRef.current;
      const { mergeWorkspaceConflictStrict } = await import('@/lib/html-editor/collaborative-merge');
      const merged = base && current && current !== base
        ? mergeWorkspaceConflictStrict(base, current, next.project).project
        : next.project;
      if (!mountedRef.current || localEpochRef.current !== epoch) return;
      applySnapshot(next);
      if (merged !== next.project) {
        const display = { ...next, project: merged };
        snapshotRef.current = display;
        projectRef.current = merged;
        setSnapshot(display);
      }
    } catch (caught) {
      if (!mountedRef.current) return;
      if (!snapshotRef.current) {
        setError(caught instanceof Error ? caught.message : 'Settings não respondeu.');
      } else {
        toast.warning('Settings abriu pelo cache local', {
          description: 'A revalidação com o WordPress falhou; tente atualizar antes de editar.',
        });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applySnapshot, config]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!config?.cmsSchemaUrl || !schemaScope) return;
    const controller = new AbortController();
    const cached = readCmsSchemaCache(schemaScope);
    setSchemaState({ scope: schemaScope, value: cached, confirmed: false });
    setSchemaError('');
    void fetchCmsSchema(config.cmsSchemaUrl, config.nonce, controller.signal)
      .then(next => {
        if (controller.signal.aborted || schemaScopeRef.current !== schemaScope) return;
        cacheCmsSchema(schemaScope, next);
        setSchemaState({ scope: schemaScope, value: next, confirmed: true });
      })
      .catch(() => {
        if (controller.signal.aborted || schemaScopeRef.current !== schemaScope) return;
        invalidateCmsSchemaCache(schemaScope);
        setSchemaState({ scope: schemaScope, value: null, confirmed: false });
        setSchemaError('Não foi possível consultar o CMS. As outras configurações continuam disponíveis.');
      });
    return () => controller.abort();
  }, [config?.cmsSchemaUrl, config?.nonce, schemaScope, schemaRetry]);

  const persistExactDraft = useCallback((nextProject: HtmlProject, _replacePending = false, nativeContext?: AgentNativeLifecycleContext) => {
    const queuedBase = acknowledgedSnapshotRef.current?.project;
    const authoredEpoch = localEpochRef.current;
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        nativeContext?.assertCurrent();
        if (!config || readOnly) throw new Error('Settings está em modo somente leitura.');
        const previous = acknowledgedSnapshotRef.current;
        if (!previous) throw new Error('O snapshot de Settings não está disponível.');
        if (writeReadyRevisionRef.current !== previous.workspaceRevision) {
          throw new Error('Aguarde o WordPress confirmar a revisão atual antes de salvar.');
        }
        // Prevent a new lazy asset/conversion from starting against a revision
        // whose ACK is still unknown. A conversion already in flight is kept
        // below by rebasing the acknowledgement onto the latest local project.
        writeReadyRevisionRef.current = -1;
        const cancelWriteReadiness = () => setWriteReady(false);
        nativeContext?.signal.addEventListener('abort', cancelWriteReadiness, { once: true });
        try {
          const [transport, { mergeWorkspaceConflictStrict, rebaseQueuedWorkspaceProject }] = await Promise.all([
            import('./wordpress-project-surface'), import('@/lib/html-editor/collaborative-merge'),
          ]);
          nativeContext?.assertCurrent();
          const candidate = queuedBase
            ? rebaseQueuedWorkspaceProject(queuedBase, nextProject, previous.project, authoredAcknowledgementsRef.current.get(previous.project))
            : nextProject;
          const next = await transport.persistWordPressProjectSurface(config, previous, candidate, {
            surface: 'settings',
            allowArchiveFallback: previous.source === 'full-project',
            signal: nativeContext?.signal,
          });
          nativeContext?.assertCurrent();
          const live = projectRef.current;
          const currentProject = live && localEpochRef.current !== authoredEpoch
            ? mergeWorkspaceConflictStrict(nextProject, live, next.project).project
            : next.project;
          authoredAcknowledgementsRef.current.set(next.project, nextProject);
          confirmedAuthoredProjectsRef.current.add(nextProject);
          const currentSnapshot = currentProject === next.project
            ? next
            : { ...next, project: currentProject };
          snapshotRef.current = currentSnapshot;
          acknowledgedSnapshotRef.current = next;
          projectRef.current = currentProject;
          writeReadyRevisionRef.current = next.workspaceRevision;
          setWriteReady(true);
          setSnapshot(currentSnapshot);
        } catch (caught) {
          nativeContext?.assertCurrent();
          if (localEpochRef.current === authoredEpoch && snapshotRef.current) {
            // Some settings dialogs persist before calling commitProject. Keep
            // their rejected authored snapshot in the workspace as well.
            const retained = { ...snapshotRef.current, project: nextProject };
            snapshotRef.current = retained;
            projectRef.current = nextProject;
            localEpochRef.current += 1;
            setSnapshot(retained);
          }
          // An interrupted/ambiguous write needs a fresh server revision before
          // another mutation; never silently continue on the old CAS baseline.
          writeReadyRevisionRef.current = -1;
          setWriteReady(false);
          throw caught;
        } finally {
          nativeContext?.signal.removeEventListener('abort', cancelWriteReadiness);
        }
      });
    saveChainRef.current = operation;
    return operation;
  }, [config, readOnly]);

  const commitProject = useCallback((next: HtmlProject) => {
    // Settings dialogs may commit after awaiting persistence. The ACK already
    // installed the safely merged snapshot, including any newer local edits.
    if (confirmedAuthoredProjectsRef.current.has(next)) return;
    const current = snapshotRef.current;
    if (!current) return;
    const updated = { ...current, project: next, loadedAt: Date.now() };
    projectRef.current = next;
    snapshotRef.current = updated;
    localEpochRef.current += 1;
    setSnapshot(updated);
  }, []);

  useWordPressNativePanelAgent('settings', readOnly, {
    beforeNativeOperation: async (operation, context) => {
      if (!operation.affectsWorkspace && !['project_get_settings', 'localization_get'].includes(operation.name)) return;
      if (operation.readOnly && readOnly) return;
      await saveChainRef.current;
      context.assertCurrent();
      const current = projectRef.current;
      if (current && current !== acknowledgedSnapshotRef.current?.project) await persistExactDraft(current, false, context);
      context.assertCurrent();
      agentNativeBaseRef.current = acknowledgedSnapshotRef.current;
    },
    afterNativeOperation: async (operation, _result, context) => {
      context.assertCurrent();
      if (operation.route.includes('/cms/')) {
        if (schemaScopeRef.current) invalidateCmsSchemaCache(schemaScopeRef.current);
        setSchemaRetry(value => value + 1);
      }
      if (!operation.affectsWorkspace || !config) return;
      const base = agentNativeBaseRef.current;
      const [transport, { mergeWorkspaceConflictStrict }] = await Promise.all([
        import('./wordpress-project-surface'), import('@/lib/html-editor/collaborative-merge'),
      ]);
      context.assertCurrent();
      const next = base?.source === 'full-project' || !config.projectSurfaceUrl
        ? await transport.loadFullWordPressProject(config, context.signal)
        : await transport.fetchWordPressProjectSurface(config, 'settings', context.signal);
      context.assertCurrent();
      if (!mountedRef.current) return;
      const current = projectRef.current;
      const merge = base && current && current !== base.project ? mergeWorkspaceConflictStrict(base.project, current, next.project) : { project: next.project, recoveredPaths: [] };
      const merged = merge.project;
      applySnapshot(next);
      if (merged !== next.project) {
        commitProject(merged);
        await persistExactDraft(merged, false, context);
      }
      context.assertCurrent();
    },
  });

  const setPageTemplate = useCallback(async (path: string, postType: string, removing = false) => {
    if (!config?.cmsTemplatesUrl || readOnly || !schema || schemaScopeRef.current !== schemaScope) return false;
    try {
      const next = await withRequestTimeout(async signal => {
        const response = await fetch(config.cmsTemplatesUrl!, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': config.nonce,
          },
          body: JSON.stringify({ postType, htmlPath: removing ? '' : path }),
          signal,
        });
        const payload = await response.json().catch(() => null) as { templates?: Record<string, string>; message?: string } | null;
        if (!response.ok) throw new Error(payload?.message || 'Não foi possível atualizar a página de template.');
        return payload?.templates || {};
      }, {
        timeoutMs: CMS_SCHEMA_TIMEOUT_MS,
        timeoutMessage: 'O salvamento do template demorou demais para responder.',
      });
      invalidateCmsSchemaCache(schemaScope);
      if (!mountedRef.current || schemaScopeRef.current !== schemaScope) return false;
      setSchemaState({ scope: schemaScope, value: { ...schema, templates: next }, confirmed: true });
      return true;
    } catch (caught) {
      toast.error('Não foi possível salvar o template', {
        description: caught instanceof Error ? caught.message : undefined,
      });
      return false;
    }
  }, [config, readOnly, schema, schemaScope]);

  const loadProjectFile = useCallback(async (path: string) => {
    if (!config) return null;
    const baseline = acknowledgedSnapshotRef.current;
    if (!baseline) throw new Error('O snapshot de Settings não está disponível.');
    if (writeReadyRevisionRef.current !== baseline.workspaceRevision) {
      throw new Error('Aguarde o WordPress confirmar a revisão atual antes de carregar este asset.');
    }
    const current = projectRef.current;
    const cachedFile = current?.files[path];
    if (cachedFile && (cachedFile.data !== undefined || cachedFile.text !== undefined)) {
      return cachedFile;
    }
    const transport = await import('./wordpress-project-surface');
    const file = await transport.fetchWordPressProjectSurfaceAsset(
      config,
      path,
      baseline.workspaceRevision,
    );
    if (!file.path) return null;
    if (acknowledgedSnapshotRef.current?.workspaceRevision !== baseline.workspaceRevision) {
      throw new Error('O projeto mudou enquanto este asset era carregado. Tente novamente.');
    }
    const latest = projectRef.current;
    if (latest) {
      const project = { ...latest, files: { ...latest.files, [file.path]: file } };
      projectRef.current = project;
      if (snapshotRef.current) snapshotRef.current = { ...snapshotRef.current, project };
      if (acknowledgedSnapshotRef.current) {
        acknowledgedSnapshotRef.current = { ...acknowledgedSnapshotRef.current, project };
      }
      if (/\.(?:woff2?|ttf|otf)$/i.test(file.path)) {
        const { useFontsStore } = await import('@/stores/useFontsStore');
        useFontsStore.getState().syncProjectFonts(project);
      }
    }
    return file;
  }, [config]);

  const cmsCollections = useMemo<SettingsCmsCollection[]>(() => (
    (schema?.types || [])
      .filter(type => Boolean(type.slug && type.name && type.slug !== 'page'))
      .map(type => ({
        slug: type.slug!,
        name: type.name!,
        restBase: type.restBase,
        fields: Array.isArray(type.fields) ? type.fields : [],
      }))
  ), [schema]);
  const templateCollections = useMemo(
    () => cmsCollections.map(({ slug, name }) => ({ slug, name })),
    [cmsCollections],
  );

  if (!config) {
    return <main className="dark grid h-screen place-items-center bg-background text-foreground">Settings indisponível.</main>;
  }

  const effectiveReadOnly = readOnly || !writeReady;

  return (
    <main
      data-kodety-light-workspace="settings"
      data-kodety-read-only={effectiveReadOnly ? 'true' : undefined}
      className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <WordPressWorkspaceTopbar config={config} activeArea={null} />
      {schemaError && <div role="status" className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <p>{schemaError}</p>
        <Button size="sm" variant="ghost" onClick={() => setSchemaRetry(value => value + 1)}>Tentar novamente</Button>
      </div>}
      <WordPressWorkspaceBody surfaceLabel="Settings">
        {loading && !snapshot ? (
          <KodetyLoadingScreen label="Carregando configurações" className="h-full min-h-0" />
        ) : error && !snapshot ? (
          <SettingsWorkspaceError message={error} onRetry={() => void load()} />
        ) : snapshot ? (
          <Suspense fallback={<KodetyLoadingScreen label="Preparando configurações" className="h-full min-h-0" />}>
            <HtmlProjectSettingsStandaloneHost
              project={snapshot.project}
              projectRef={projectRef}
              pages={Object.keys(snapshot.project.files).filter(path => /\.html?$/i.test(path) && !path.startsWith('.incode/')).sort()}
              homePage={getLightProjectHomePath(snapshot.project)}
              redirects={normalizeRedirectSettings(readLightEditorMetadata(snapshot.project).redirects)}
              cmsCollections={cmsCollections}
              pageTemplateCollections={templateCollections}
              pageTemplates={schema?.templates || {}}
              wordpress={config}
              readOnly={effectiveReadOnly}
              commitProject={commitProject}
              persistExactDraft={persistExactDraft}
              clearCanvasSelection={() => undefined}
              setActiveLocale={() => undefined}
              setCodeFilePath={() => undefined}
              setPageTemplate={setPageTemplate}
              navigateAfterSave={async href => {
                await saveChainRef.current;
                navigateWithEditorLockHandoff(href);
              }}
              blockGlobalPageMutation={() => false}
              loadProjectFile={loadProjectFile}
            />
          </Suspense>
        ) : null}
      </WordPressWorkspaceBody>
      <Toaster {...WORDPRESS_WORKSPACE_TOASTER_PROPS} />
    </main>
  );
}
