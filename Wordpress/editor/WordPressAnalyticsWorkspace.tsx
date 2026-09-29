import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowLeft, BarChart3, Globe, RefreshCw } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';
import {
  HtmlAnalyticsWorkspace,
  type HtmlAnalyticsWorkspaceView,
} from '@/app/(builder)/kodety/html-editor/components/HtmlAnalyticsWorkspace';
import { wordpressConfig } from '@/lib/html-editor/editor-wordpress-helpers';
import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import type { AgentNativeLifecycleContext } from '@/lib/html-editor/agent-native-tools';
import { resolveAnalyticsFeatureAccess } from '@/lib/html-editor/analytics-access';
import type { AnalyticsPeriod } from '@/lib/html-editor/analytics';
import type { HtmlProject } from '@/lib/html-editor/types';
import { Toaster, toast } from 'sonner';
import type { WordPressProjectSurfaceSnapshot } from './wordpress-project-surface';
import type { WordPressAnalyticsProjectData } from './wordpress-analytics-project-data';
import { WORDPRESS_WORKSPACE_TOASTER_PROPS } from './wordpress-workspace-toaster';
import { WordPressWorkspaceBody, WordPressWorkspaceTopbar } from './WordPressWorkspaceChrome';
import { useWordPressNativePanelAgent } from './use-wordpress-native-panel-agent';
import { navigateWithEditorLockHandoff } from './editor-lock-navigation';

const HtmlProjectAnalyticsAbTests = lazy(() =>
  import('@/app/(builder)/kodety/html-editor/components/HtmlProjectAnalyticsAbTests')
    .then(module => ({ default: module.HtmlProjectAnalyticsAbTests })),
);

const HtmlProjectAnalyticsUtms = lazy(() =>
  import('@/app/(builder)/kodety/html-editor/components/HtmlProjectAnalyticsUtms')
    .then(module => ({ default: module.HtmlProjectAnalyticsUtms })),
);

const EMPTY_PROJECT_DATA: WordPressAnalyticsProjectData = {
  pages: [],
  trackingTargets: [],
  experiments: [],
};

function requestedAnalyticsView(): HtmlAnalyticsWorkspaceView {
  const requested = new URLSearchParams(window.location.search).get('view');
  return requested === 'funnels' || requested === 'ab-tests' || requested === 'page-insights' || requested === 'utms'
    ? requested
    : 'overview';
}

function AnalyticsProjectStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  if (loading) return <KodetyLoadingScreen label="Carregando dados do projeto" className="h-full min-h-0" />;
  return (
    <div className="grid h-full min-h-72 place-items-center px-6 text-center" role="alert">
      <div className="max-w-sm">
        <h2 className="text-xs font-semibold text-foreground">Dados do projeto indisponíveis</h2>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{error || 'Tente carregar novamente.'}</p>
        <Button className="mt-4" size="xs" variant="secondary" onClick={onRetry}>
          <RefreshCw /> Tentar novamente
        </Button>
      </div>
    </div>
  );
}

function AnalyticsSurfaceWriteStatus({
  available,
  loading,
  saving,
  error,
  onRetry,
}: {
  available: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  onRetry: () => void;
}) {
  const message = !available
    ? 'O endpoint de atualização do projeto não está disponível. A Central permanece somente leitura.'
    : saving
      ? 'Salvando a Central de UTMs…'
      : loading
        ? 'Confirmando a revisão atual com o WordPress antes de liberar a edição…'
        : error || 'Confirme novamente a revisão do projeto para continuar editando.';
  return (
    <div
      data-kodety-analytics-surface-write-status
      className="flex min-h-9 shrink-0 items-center gap-3 border-b border-[var(--kodety-divider)] bg-white/[.025] px-3 py-2"
      role={error ? 'alert' : 'status'}
    >
      <p className="min-w-0 flex-1 text-[9px] leading-4 text-[var(--kodety-text-tertiary)]">{message}</p>
      {available && !loading && !saving ? (
        <Button size="xs" variant="secondary" onClick={onRetry}>
          <RefreshCw /> Revalidar
        </Button>
      ) : null}
    </div>
  );
}

function StudioAnalyticsUnavailable({ config }: { config: KodetyWordPressConfig }) {
  const isEnglish = config.studio?.studioLanguage === 'en';
  const copy = isEnglish
    ? {
        eyebrow: 'Local environment',
        title: 'Analytics is unavailable in Onun Kodety',
        description: 'This project is running only in your browser. Because Studio is not a published website, there is no real visitor traffic to collect or display here.',
        note: 'After transferring the project to hosting and publishing the site, open Analytics in the final WordPress installation to see real visitors and conversions.',
        back: 'Back to Design',
        close: 'Back to the editor',
      }
    : {
        eyebrow: 'Ambiente local',
        title: 'Analytics indisponível no Onun Kodety',
        description: 'Este projeto está rodando somente no seu navegador. Como o Studio não é um site publicado, não há tráfego real de visitantes para coletar ou exibir aqui.',
        note: 'Depois de transferir o projeto para a hospedagem e publicar o site, abra o Analytics no WordPress final para acompanhar visitantes e conversões reais.',
        back: 'Voltar ao Design',
        close: 'Voltar ao editor',
      };
  const returnToEditor = () => navigateWithEditorLockHandoff(config.editorUrl || config.dashboardUrl || '/kodety/');

  return (
    <main
      data-kodety-light-workspace="analytics"
      data-kodety-analytics-studio-unavailable="true"
      className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <WordPressWorkspaceTopbar config={config} activeArea="insights" />
      <WordPressWorkspaceBody surfaceLabel="Analytics">
        <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--kodety-panel)] text-[var(--kodety-text)]" aria-label="Onun Kodety Analytics">
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kodety-divider)] px-3">
            <Button variant="ghost" size="icon-sm" onClick={returnToEditor} aria-label={copy.close} title={copy.close}>
              <ArrowLeft />
            </Button>
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/40">
              <BarChart3 className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold">Analytics</p>
              <p data-kodety-no-i18n className="truncate text-[9px] text-[var(--kodety-info-copy)]">{config.projectName || 'Projeto'}</p>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12">
            <div className="w-full max-w-[520px] text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-[12px] border border-white/[.07] bg-white/[.035] text-[var(--kodety-accent-hover)]">
                <Globe className="size-5" />
              </span>
              <p className="mt-5 text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--kodety-accent-hover)]">{copy.eyebrow}</p>
              <h1 className="mx-auto mt-2 max-w-[460px] text-balance text-[18px] font-semibold tracking-[-.02em] text-[var(--kodety-text)]">{copy.title}</h1>
              <p className="mx-auto mt-3 max-w-[480px] text-balance text-[11px] leading-5 text-[var(--kodety-text-tertiary)]">{copy.description}</p>
              <div className="mt-6 rounded-[10px] border border-[var(--kodety-divider)] bg-white/[.022] px-4 py-3 text-left">
                <p className="text-[10px] leading-4.5 text-[var(--kodety-text-secondary)]">{copy.note}</p>
              </div>
              <Button className="mt-6" size="sm" variant="secondary" onClick={returnToEditor}>
                <ArrowLeft /> {copy.back}
              </Button>
            </div>
          </div>
        </section>
      </WordPressWorkspaceBody>
      <Toaster {...WORDPRESS_WORKSPACE_TOASTER_PROPS} />
    </main>
  );
}

function ConnectedWordPressAnalyticsWorkspace({ config }: { config: KodetyWordPressConfig | undefined }) {
  const featureAccess = useMemo(
    () => resolveAnalyticsFeatureAccess(config?.product),
    [config?.product],
  );
  const [view, setView] = useState<HtmlAnalyticsWorkspaceView>(() => requestedAnalyticsView());
  const [surfaceSnapshot, setSurfaceSnapshot] = useState<WordPressProjectSurfaceSnapshot | null>(null);
  const [surfaceDisplayProject, setSurfaceDisplayProject] = useState<HtmlProject | null>(null);
  const [fullSnapshot, setFullSnapshot] = useState<WordPressProjectSurfaceSnapshot | null>(null);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [surfaceSaving, setSurfaceSaving] = useState(false);
  const [fullLoading, setFullLoading] = useState(false);
  const [surfaceError, setSurfaceError] = useState('');
  const [fullError, setFullError] = useState('');
  const [surfaceWriteReady, setSurfaceWriteReady] = useState(false);
  const [projectData, setProjectData] = useState<WordPressAnalyticsProjectData>(EMPTY_PROJECT_DATA);
  const surfaceSnapshotRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);
  const acknowledgedSurfaceSnapshotRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);
  const fullSnapshotRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);
  const acknowledgedFullSnapshotRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);
  const fullProjectRef = useRef<HtmlProject | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const authoredAcknowledgementsRef = useRef(new WeakMap<HtmlProject, HtmlProject>());
  const surfaceRequestRef = useRef<Promise<void> | null>(null);
  const fullRequestRef = useRef<Promise<void> | null>(null);
  const surfaceRequestEpochRef = useRef(0);
  const fullRequestEpochRef = useRef(0);
  const surfaceWriteReadyRevisionRef = useRef(-1);
  const agentNativeBaseRef = useRef<WordPressProjectSurfaceSnapshot | null>(null);

  const readOnly = Boolean(
    config?.readOnly
    || config?.share?.mode === 'view'
    || !config?.canManageAnalytics,
  );

  const loadSurface = useCallback((force = false) => {
    if (!config?.projectSurfaceUrl) {
      acknowledgedSurfaceSnapshotRef.current = null;
      surfaceWriteReadyRevisionRef.current = -1;
      setSurfaceWriteReady(false);
      setSurfaceError('O resumo do projeto não está disponível.');
      return Promise.resolve();
    }
    if (surfaceRequestRef.current && !force) return surfaceRequestRef.current;
    if (surfaceSnapshotRef.current && !force) return Promise.resolve();
    const requestEpoch = surfaceRequestEpochRef.current + 1;
    surfaceRequestEpochRef.current = requestEpoch;
    setSurfaceLoading(true);
    setSurfaceError('');
    setSurfaceWriteReady(false);
    surfaceWriteReadyRevisionRef.current = -1;
    const request = import('./wordpress-project-surface')
      .then(async transport => {
        const cached = !force
          ? transport.readCachedWordPressProjectSurface(config, 'analytics')
          : null;
        if (cached && surfaceRequestEpochRef.current === requestEpoch) {
          surfaceSnapshotRef.current = cached;
          acknowledgedSurfaceSnapshotRef.current = null;
          setSurfaceSnapshot(cached);
          setSurfaceDisplayProject(cached.project);
        }
        // A cache is only an immediate paint. Always finish through the
        // network transport so a stale fallback can never become a CAS ACK.
        return transport.fetchWordPressProjectSurface(config, 'analytics');
      })
      .then(async next => {
        if (surfaceRequestEpochRef.current !== requestEpoch) return;
        const { mergeWorkspaceConflictStrict } = await import('@/lib/html-editor/collaborative-merge');
        const base = acknowledgedSurfaceSnapshotRef.current?.project;
        const current = surfaceSnapshotRef.current?.project;
        const merged = base && current && current !== base
          ? mergeWorkspaceConflictStrict(base, current, next.project).project
          : next.project;
        if (surfaceRequestEpochRef.current !== requestEpoch) return;
        const display = { ...next, project: merged };
        surfaceSnapshotRef.current = display;
        acknowledgedSurfaceSnapshotRef.current = next;
        surfaceWriteReadyRevisionRef.current = next.workspaceRevision;
        setSurfaceWriteReady(true);
        setSurfaceSnapshot(display);
        setSurfaceDisplayProject(merged);
      })
      .catch(caught => {
        if (surfaceRequestEpochRef.current !== requestEpoch) return;
        const message = caught instanceof Error ? caught.message : 'O resumo do projeto não respondeu.';
        setSurfaceError(message);
        if (surfaceSnapshotRef.current) {
          const retainedCache = surfaceSnapshotRef.current.source === 'session-cache';
          toast.warning(retainedCache ? 'Analytics abriu pelo cache local' : 'Não foi possível revalidar a Central', {
            description: retainedCache
              ? 'O WordPress não respondeu à revalidação do projeto.'
              : 'O rascunho local foi mantido. Revalide antes de tentar salvar novamente.',
          });
        }
        surfaceWriteReadyRevisionRef.current = -1;
        setSurfaceWriteReady(false);
      })
      .finally(() => {
        if (surfaceRequestEpochRef.current !== requestEpoch) return;
        setSurfaceLoading(false);
        surfaceRequestRef.current = null;
      });
    surfaceRequestRef.current = request;
    return request;
  }, [config]);

  const loadFullProject = useCallback((force = false) => {
    if (!config || (!config.projectDownloadUrl && !config.projectUrl)) {
      setFullError('O projeto completo não está disponível para esta conta.');
      return Promise.resolve();
    }
    if (fullRequestRef.current && !force) return fullRequestRef.current;
    if (fullSnapshotRef.current && !force) return Promise.resolve();
    const requestEpoch = fullRequestEpochRef.current + 1;
    fullRequestEpochRef.current = requestEpoch;
    setFullLoading(true);
    setFullError('');
    const request = import('./wordpress-project-surface')
      .then(transport => transport.loadFullWordPressProject(config))
      .then(async next => {
        if (fullRequestEpochRef.current !== requestEpoch) return;
        const { mergeWorkspaceConflictStrict } = await import('@/lib/html-editor/collaborative-merge');
        const base = acknowledgedFullSnapshotRef.current?.project;
        const current = fullProjectRef.current;
        const merged = base && current && current !== base
          ? mergeWorkspaceConflictStrict(base, current, next.project).project
          : next.project;
        if (fullRequestEpochRef.current !== requestEpoch) return;
        const display = { ...next, project: merged };
        fullSnapshotRef.current = display;
        acknowledgedFullSnapshotRef.current = next;
        fullProjectRef.current = merged;
        setFullSnapshot(display);
      })
      .catch(caught => {
        if (fullRequestEpochRef.current !== requestEpoch) return;
        setFullError(caught instanceof Error ? caught.message : 'O projeto completo não respondeu.');
      })
      .finally(() => {
        if (fullRequestEpochRef.current !== requestEpoch) return;
        setFullLoading(false);
        fullRequestRef.current = null;
      });
    fullRequestRef.current = request;
    return request;
  }, [config]);

  useEffect(() => {
    if (view === 'overview') return;
    if (view === 'ab-tests') {
      if (!readOnly && (config?.projectDownloadUrl || config?.projectUrl)) {
        void loadFullProject();
      } else {
        void loadSurface();
      }
      return;
    }
    void loadSurface();
  }, [config?.projectDownloadUrl, config?.projectUrl, loadFullProject, loadSurface, readOnly, view]);

  const analyticsProject = fullSnapshot?.project || surfaceSnapshot?.project || surfaceDisplayProject;
  useEffect(() => {
    if (!analyticsProject) {
      setProjectData(EMPTY_PROJECT_DATA);
      return;
    }
    let active = true;
    void import('./wordpress-analytics-project-data').then(module => {
      if (active) setProjectData(module.wordpressAnalyticsProjectData(analyticsProject));
    });
    return () => {
      active = false;
    };
  }, [analyticsProject]);

  const persistFullProject = useCallback((nextProject: HtmlProject, nativeContext?: AgentNativeLifecycleContext) => {
    const queuedBase = acknowledgedFullSnapshotRef.current?.project;
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        nativeContext?.assertCurrent();
        if (!config || readOnly) throw new Error('Analytics está em modo somente leitura.');
        const previous = acknowledgedFullSnapshotRef.current;
        if (!previous) throw new Error('O projeto completo não está disponível.');
        const [transport, { mergeWorkspaceConflictStrict, rebaseQueuedWorkspaceProject }] = await Promise.all([
          import('./wordpress-project-surface'), import('@/lib/html-editor/collaborative-merge'),
        ]);
        nativeContext?.assertCurrent();
        const candidate = queuedBase
          ? rebaseQueuedWorkspaceProject(queuedBase, nextProject, previous.project, authoredAcknowledgementsRef.current.get(previous.project))
          : nextProject;
        const next = await transport.persistWordPressProjectSurface(config, previous, candidate, {
          surface: 'analytics',
          allowArchiveFallback: true,
          signal: nativeContext?.signal,
        });
        nativeContext?.assertCurrent();
        const live = fullProjectRef.current;
        const currentProject = live && live !== nextProject
          ? mergeWorkspaceConflictStrict(nextProject, live, next.project).project
          : next.project;
        const display = { ...next, project: currentProject };
        authoredAcknowledgementsRef.current.set(next.project, nextProject);
        fullSnapshotRef.current = display;
        acknowledgedFullSnapshotRef.current = next;
        fullProjectRef.current = currentProject;
        setFullSnapshot(display);
        // Both panels author `.incode/project.json`. A surface loaded before
        // this acknowledgement is now an unsafe CAS baseline and must be
        // fetched again before the UTM panel can write.
        surfaceRequestEpochRef.current += 1;
        surfaceRequestRef.current = null;
        const hasPendingSurfaceDraft = surfaceSnapshotRef.current?.project
          && surfaceSnapshotRef.current.project !== acknowledgedSurfaceSnapshotRef.current?.project;
        if (!hasPendingSurfaceDraft) {
          surfaceSnapshotRef.current = null;
          acknowledgedSurfaceSnapshotRef.current = null;
          setSurfaceSnapshot(null);
        }
        surfaceWriteReadyRevisionRef.current = -1;
        setSurfaceWriteReady(false);
        setSurfaceError('Os testes A/B alteraram o projeto. Confirmando novamente os dados da Central de UTMs.');
        void loadSurface(true);
      });
    saveChainRef.current = operation;
    return operation;
  }, [config, loadSurface, readOnly]);

  const commitFullProject = useCallback((nextProject: HtmlProject) => {
    const current = fullSnapshotRef.current;
    if (!current) return;
    const next = { ...current, project: nextProject, loadedAt: Date.now() };
    fullSnapshotRef.current = next;
    fullProjectRef.current = nextProject;
    setFullSnapshot(next);
  }, []);

  const persistAnalyticsSurfaceProject = useCallback((nextProject: HtmlProject, nativeContext?: AgentNativeLifecycleContext) => {
    const queuedBase = acknowledgedSurfaceSnapshotRef.current?.project;
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        nativeContext?.assertCurrent();
        if (!config || readOnly) throw new Error('Analytics está em modo somente leitura.');
        const previous = acknowledgedSurfaceSnapshotRef.current;
        if (!previous) throw new Error('Os dados leves do projeto não estão disponíveis.');
        if (surfaceWriteReadyRevisionRef.current !== previous.workspaceRevision) {
          throw new Error('Aguarde o WordPress confirmar a revisão atual antes de salvar.');
        }
        // A response from a read started before this write cannot replace the
        // optimistic draft or become the next acknowledged CAS baseline.
        surfaceRequestEpochRef.current += 1;
        surfaceRequestRef.current = null;
        surfaceWriteReadyRevisionRef.current = -1;
        setSurfaceWriteReady(false);
        setSurfaceSaving(true);
        const cancelSaving = () => setSurfaceSaving(false);
        nativeContext?.signal.addEventListener('abort', cancelSaving, { once: true });
        setSurfaceError('');
        try {
          const [transport, { mergeWorkspaceConflictStrict, rebaseQueuedWorkspaceProject }] = await Promise.all([
            import('./wordpress-project-surface'), import('@/lib/html-editor/collaborative-merge'),
          ]);
          nativeContext?.assertCurrent();
          const candidate = queuedBase
            ? rebaseQueuedWorkspaceProject(queuedBase, nextProject, previous.project, authoredAcknowledgementsRef.current.get(previous.project))
            : nextProject;
          const next = await transport.persistWordPressProjectSurface(config, previous, candidate, {
            surface: 'analytics',
            signal: nativeContext?.signal,
          });
          nativeContext?.assertCurrent();
          const live = surfaceSnapshotRef.current?.project;
          const currentProject = live && live !== nextProject
            ? mergeWorkspaceConflictStrict(nextProject, live, next.project).project
            : next.project;
          const display = { ...next, project: currentProject };
          authoredAcknowledgementsRef.current.set(next.project, nextProject);
          acknowledgedSurfaceSnapshotRef.current = next;
          surfaceSnapshotRef.current = display;
          surfaceWriteReadyRevisionRef.current = next.workspaceRevision;
          setSurfaceWriteReady(true);
          setSurfaceSnapshot(display);
          setSurfaceDisplayProject(currentProject);
          setSurfaceError('');
          // The full A/B project was loaded against the previous metadata.
          // Drop it instead of ever rebasing only its revision and risking a
          // later overwrite of the UTM centre.
          fullRequestEpochRef.current += 1;
          fullRequestRef.current = null;
          const hasPendingFullDraft = fullProjectRef.current
            && fullProjectRef.current !== acknowledgedFullSnapshotRef.current?.project;
          if (!hasPendingFullDraft) {
            fullSnapshotRef.current = null;
            acknowledgedFullSnapshotRef.current = null;
            fullProjectRef.current = null;
            setFullSnapshot(null);
          }
          setFullLoading(false);
          if (view === 'ab-tests' && (config.projectDownloadUrl || config.projectUrl)) {
            void loadFullProject(true);
          }
        } catch (caught) {
          nativeContext?.assertCurrent();
          surfaceWriteReadyRevisionRef.current = -1;
          setSurfaceWriteReady(false);
          setSurfaceError(caught instanceof Error ? caught.message : 'O WordPress não confirmou a atualização da Central de UTMs.');
          throw caught;
        } finally {
          nativeContext?.signal.removeEventListener('abort', cancelSaving);
          if (!nativeContext?.signal.aborted) setSurfaceSaving(false);
        }
      });
    saveChainRef.current = operation;
    return operation;
  }, [config, loadFullProject, readOnly, view]);

  const commitAnalyticsSurfaceProject = useCallback((nextProject: HtmlProject) => {
    const current = surfaceSnapshotRef.current;
    if (!current) return;
    const next = { ...current, project: nextProject, loadedAt: Date.now() };
    surfaceSnapshotRef.current = next;
    setSurfaceSnapshot(next);
    setSurfaceDisplayProject(nextProject);
  }, []);

  useWordPressNativePanelAgent('analytics', Boolean(config?.readOnly || config?.share?.mode === 'view'), {
    beforeNativeOperation: async (operation, context) => {
      if (!operation.affectsWorkspace && !['project_get_settings', 'localization_get'].includes(operation.name)) return;
      if (operation.readOnly && readOnly) return;
      await saveChainRef.current;
      context.assertCurrent();
      if (view === 'ab-tests') {
        const current = fullProjectRef.current;
        if (current && current !== acknowledgedFullSnapshotRef.current?.project) await persistFullProject(current, context);
      } else {
        const current = surfaceSnapshotRef.current?.project;
        if (current && current !== acknowledgedSurfaceSnapshotRef.current?.project) await persistAnalyticsSurfaceProject(current, context);
      }
      context.assertCurrent();
      agentNativeBaseRef.current = view === 'ab-tests'
        ? acknowledgedFullSnapshotRef.current : acknowledgedSurfaceSnapshotRef.current;
    },
    afterNativeOperation: async (operation, _result, context) => {
      context.assertCurrent();
      if (!operation.affectsWorkspace || !config) return;
      const [transport, { mergeWorkspaceConflictStrict }] = await Promise.all([
        import('./wordpress-project-surface'), import('@/lib/html-editor/collaborative-merge'),
      ]);
      context.assertCurrent();
      const next = await transport.loadFullWordPressProject(config, context.signal);
      context.assertCurrent();
      const base = agentNativeBaseRef.current;
      const current = view === 'ab-tests' ? fullProjectRef.current : surfaceSnapshotRef.current?.project;
      const merge = base && current && current !== base.project ? mergeWorkspaceConflictStrict(base.project, current, next.project) : { project: next.project, recoveredPaths: [] };
      const merged = merge.project;
      fullRequestEpochRef.current += 1;
      surfaceRequestEpochRef.current += 1;
      acknowledgedFullSnapshotRef.current = next;
      acknowledgedSurfaceSnapshotRef.current = next;
      const installed = { ...next, project: merged };
      fullSnapshotRef.current = installed;
      fullProjectRef.current = merged;
      surfaceSnapshotRef.current = installed;
      surfaceWriteReadyRevisionRef.current = next.workspaceRevision;
      setFullSnapshot(installed);
      setSurfaceSnapshot(installed);
      setSurfaceDisplayProject(merged);
      setSurfaceWriteReady(true);
      if (merged !== next.project) await persistFullProject(merged, context);
      context.assertCurrent();
    },
  });

  if (!config) {
    return <main className="dark grid h-screen place-items-center bg-background text-foreground">Analytics indisponível.</main>;
  }

  const api = config.analyticsOverviewUrl && config.analyticsFunnelsUrl
    ? {
        overviewUrl: config.analyticsOverviewUrl,
        pageInsightsUrl: config.analyticsPageInsightsUrl,
        funnelsUrl: config.analyticsFunnelsUrl,
        funnelItemUrl: config.analyticsFunnelItemUrl,
        emailOptionsUrl: config.analyticsEmailOptionsUrl,
        nonce: config.nonce,
        credentials: 'same-origin' as const,
        readOnly,
        requestTimeoutMs: 20_000,
      }
    : undefined;
  const canLoadFullProject = Boolean(config.projectDownloadUrl || config.projectUrl);
  const abReadOnly = readOnly || !canLoadFullProject;
  const abProject = fullSnapshot?.project || (abReadOnly ? surfaceSnapshot?.project || null : null);
  const utmProject = surfaceSnapshot?.project || surfaceDisplayProject;
  const utmReadOnly = readOnly || !config.projectDeltaUrl || !surfaceWriteReady;
  const utmCanFlush = !utmReadOnly && !surfaceSaving;

  return (
    <main
      data-kodety-light-workspace="analytics"
      data-kodety-read-only={readOnly ? 'true' : undefined}
      className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <WordPressWorkspaceTopbar config={config} activeArea="insights" />
      <WordPressWorkspaceBody surfaceLabel="Analytics">
        <HtmlAnalyticsWorkspace
          projectName={config.projectName || 'Projeto'}
          api={api}
          featureAccess={featureAccess}
          demoMode={config.analyticsDemoMode}
          pages={projectData.pages}
          trackingTargets={projectData.trackingTargets}
          experiments={projectData.experiments}
          view={view}
          onViewChange={next => {
            setView(next);
            const url = new URL(window.location.href);
            if (next === 'overview') url.searchParams.delete('view');
            else url.searchParams.set('view', next);
            window.history.replaceState({}, '', url);
          }}
          onClose={() => navigateWithEditorLockHandoff(config.editorUrl || config.dashboardUrl || '/kodety/')}
          abTestsSlot={
            abProject ? (
              <Suspense fallback={<KodetyLoadingScreen label="Carregando testes A/B" className="h-full min-h-0" />}>
                <HtmlProjectAnalyticsAbTests
                  readOnly={abReadOnly}
                  project={abProject}
                  pages={projectData.pages}
                  trackingTargets={projectData.trackingTargets}
                  getProject={() => fullProjectRef.current || abProject}
                  onCommit={commitFullProject}
                  onFlush={abReadOnly ? undefined : persistFullProject}
                  editorUrl={config.editorUrl || '/kodety/editor/'}
                  siteUrl={config.siteUrl}
                  experimentsUrl={featureAccess.abTests ? config.analyticsExperimentsUrl : undefined}
                  experimentItemUrl={featureAccess.abTests ? config.analyticsExperimentItemUrl : undefined}
                  nonce={config.nonce}
                  featureAccess={featureAccess}
                />
              </Suspense>
            ) : (
              <AnalyticsProjectStatus
                loading={fullLoading || surfaceLoading}
                error={fullError || surfaceError}
                onRetry={() => {
                  void loadSurface(true);
                  if (config.projectDownloadUrl || config.projectUrl) void loadFullProject(true);
                }}
              />
            )
          }
          utmSlot={
            utmProject ? (
              <div className="flex h-full min-h-0 flex-col">
                {!readOnly && (!config.projectDeltaUrl || !surfaceWriteReady || surfaceSaving) ? (
                  <AnalyticsSurfaceWriteStatus
                    available={Boolean(config.projectDeltaUrl)}
                    loading={surfaceLoading}
                    saving={surfaceSaving}
                    error={surfaceError}
                    onRetry={() => { void loadSurface(true); }}
                  />
                ) : null}
                <div className="min-h-0 flex-1">
                  <Suspense fallback={<KodetyLoadingScreen label="Carregando Central de UTMs" className="h-full min-h-0" />}>
                    <HtmlProjectAnalyticsUtms
                      readOnly={!utmCanFlush}
                      activationLocked={!featureAccess.utms}
                      licenseUrl={featureAccess.licenseUrl}
                      upgradeUrl={featureAccess.upgradeUrl}
                      project={utmProject}
                      getProject={() => surfaceSnapshotRef.current?.project || utmProject}
                      onCommit={commitAnalyticsSurfaceProject}
                      onFlush={utmCanFlush ? persistAnalyticsSurfaceProject : undefined}
                    />
                  </Suspense>
                </div>
              </div>
            ) : (
              <AnalyticsProjectStatus
                loading={surfaceLoading}
                error={surfaceError}
                onRetry={() => { void loadSurface(true); }}
              />
            )
          }
        />
      </WordPressWorkspaceBody>
      <Toaster {...WORDPRESS_WORKSPACE_TOASTER_PROPS} />
    </main>
  );
}

export default function WordPressAnalyticsWorkspace() {
  const config = wordpressConfig();
  if (config?.studio?.enabled) return <StudioAnalyticsUnavailable config={config} />;
  return <ConnectedWordPressAnalyticsWorkspace config={config} />;
}

// The Analytics workspace clones its slot to inject the selected period and
// refresh key. Keep the structural type visible to contract tests and future
// wrappers even though React accepts the injected optional props implicitly.
export interface WordPressAnalyticsAbSlotInjection {
  analyticsPeriod?: AnalyticsPeriod;
  analyticsRefreshKey?: number;
}
