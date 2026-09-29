import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { StudioProject } from './project-library';
import type { StudioLanguage } from '../../../ChromeExtension/kodety-studio/src/storage';
import type { HtmlProject } from '../../../lib/html-editor/types';
import type { HtmlProjectEditorProps } from '../../../lib/html-editor/editor-types';
import type { FontLibraryFont } from '../../../lib/editor-platform-services';
import { canonicalProjectForTransport, downloadZipBlob, fileToProjectFile, prepareProjectForDraftTransport, projectToZipBlob } from '../../../lib/html-editor/project-io';
import { createHtmlSiteZip, createHtmlWordPressZip } from './html-archives';
import { StaticCmsPublicationError } from '../../../lib/html-editor/static-cms';
import { KodetyLoadingScreen } from '../../../components/ui/kodety-loading-screen';
import { attachStaticHtmlSource } from '../../../lib/html-editor/static-source';
import { prepareHtmlLicenseExport } from './html-license-export';
import {
  authorizeHtmlDirectory, bindHtmlDirectory, createHtmlDirectorySession,
  isPublicHtmlPath, loadHtmlDirectory, pickHtmlDirectory, readHtmlDirectoryHandle, publishHtmlDirectory,
} from './html-directory';
import { configureHtmlFontLibrary, installHtmlFontLibrary, refreshHtmlFontLibrary } from './html-font-library';
import { HtmlDeploymentPanel, type HtmlDeploymentWorkflow } from './html-deployment';
import { HtmlDeploymentBrand } from './html-deployment-brand';
import { HtmlPublishIcon } from './html-publish-icon';
import { Dialog, Icon, Notice, Spinner } from './ui';
import { mountHtmlEditorI18n } from './html-editor-i18n';
import { htmlExtensions, type HtmlExtensionSummary } from './html-extensions';
import { HtmlExtensionsDialog } from './html-extensions-dialog';
import { WordPressBuilderOnboarding } from '../../../Wordpress/editor/WordPressBuilderOnboarding';
import type { BuilderOnboardingWorkspace } from '../../../lib/html-editor/onboarding-availability';
import { HtmlWordPressFeatureDialog } from './html-wordpress-feature-dialog';
import { htmlPreviewUrl, writeHtmlPreview } from './html-preview-store';
import { installHtmlPreviewBridge } from './html-preview-bridge';
import { createHtmlLicenseClient, htmlLicenseSiteUrl } from './html-license';
import { kodetyProductFeatures } from '../../../lib/html-editor/product-access';
import { HtmlWorkspaceAgentProvider } from '../../../lib/html-editor/agent-host';
import { createBrowserAgentBinding } from '../../../lib/html-editor/browser-agent-webcontainer';
import { OPEN_HTML_AGENT_PANEL_EVENT } from '../../../lib/html-editor/agent-panel-events';
import { useHtmlAgentEditorBridgeStore } from '../../../stores/useHtmlAgentEditorBridgeStore';
import browserAgentRuntimeUrl from 'virtual:kodety-browser-agent-runtime';
import { useHtmlProjectSettingsStore } from '../../../stores/useHtmlProjectSettingsStore';
import { createHtmlMcpController } from './html-mcp';
import { HtmlWorkspaceMcpSettings } from './html-mcp-settings';
import { toast } from 'sonner';
import { cancelWorkspaceNavigation, runWorkspaceNavigationGuards } from '../../../lib/html-editor/workspace-navigation';
import { WORKSPACE_DRAFT_CHANGED_EVENT } from '../../../lib/html-editor/workspace-draft';
import '../../../app/globals.css';
import '../../../Wordpress/editor/wordpress-editor.css';
import './html-workspace.css';

const SharedHtmlEditor = lazy(async () => {
  installHtmlFontLibrary();
  return import('../../../app/(builder)/kodety/html-editor/components/HtmlProjectEditor');
});
const SharedAgentSettings = lazy(() => import('../../../app/(builder)/kodety/html-editor/components/HtmlAgentSettings').then(module => ({ default: module.HtmlAgentSettings })));
type Host = NonNullable<HtmlProjectEditorProps['workspace']>;
type EditorApi = Parameters<Host['onReady']>[0];

type Props = {
  project: StudioProject;
  language: StudioLanguage;
  onBack(): void;
  onProjectReady(project: StudioProject): Promise<void>;
};

export default function HtmlWorkspace({ project, language, onBack, onProjectReady }: Props) {
  const pt = language === 'pt';
  const browserStored = project.storageMode === 'browser';
  useLayoutEffect(() => mountHtmlEditorI18n(language), [language]);
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains('dark');
    const hadEditorClass = document.body.classList.contains('kodety-wordpress-editor');
    const previousFont = document.body.style.getPropertyValue('--font-inter');
    document.documentElement.classList.add('dark');
    document.body.classList.add('kodety-wordpress-editor');
    document.body.style.setProperty('--font-inter', '"Kodety Inter", Inter, sans-serif');
    return () => {
      if (!wasDark) document.documentElement.classList.remove('dark');
      if (!hadEditorClass) document.body.classList.remove('kodety-wordpress-editor');
      if (previousFont) document.body.style.setProperty('--font-inter', previousFont);
      else document.body.style.removeProperty('--font-inter');
    };
  }, []);

  const [initialProject, setInitialProject] = useState<HtmlProject | null>(null);
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [status, setStatus] = useState<'opening' | 'pending' | 'saving' | 'saved' | 'error'>('opening');
  const [error, setError] = useState('');
  const [view, setView] = useState<'editor' | 'settings' | 'localization' | 'cms'>('editor');
  const viewRef = useRef(view);
  viewRef.current = view;
  const navigation = useRef<Promise<boolean> | null>(null);
  const licenseClient = useMemo(() => createHtmlLicenseClient(project.id, htmlLicenseSiteUrl(project.id, document.baseURI)), [project.id]);
  const [loadedLicenseClient, setLoadedLicenseClient] = useState<typeof licenseClient | null>(null);
  const licenseSnapshot = useSyncExternalStore(licenseClient.subscribe, licenseClient.getSnapshot, licenseClient.getSnapshot);
  const checkAgentLicense = useCallback(async () => {
    try {
      return (await licenseClient.check()).product.licensed;
    } catch {
      const snapshot = licenseClient.getSnapshot();
      throw new Error(pt ? snapshot.errorPortuguese : snapshot.error);
    }
  }, [licenseClient, pt]);
  useEffect(() => {
    let current = true;
    void licenseClient.load().catch(() => undefined).finally(() => { if (current) setLoadedLicenseClient(licenseClient); });
    return () => { current = false; licenseClient.dispose(); };
  }, [licenseClient]);
  const [extensions, setExtensions] = useState<HtmlExtensionSummary[]>([]);
  const [managingExtensions, setManagingExtensions] = useState(false);
  useEffect(() => {
    let current = true;
    void htmlExtensions.list(project.id).then(items => { if (current) setExtensions(items); }).catch(() => { if (current) setExtensions([]); });
    return () => { current = false; };
  }, [project.id]);
  const activeExtensions = useMemo(() => extensions.filter(extension => extension.active).map(extension => extension.manifest.slug), [extensions]);
  const productAccess = useMemo(() => ({
    ...licenseSnapshot.product,
    features: kodetyProductFeatures(licenseSnapshot.product.licensed, activeExtensions.includes('kodety-localization')),
  }), [activeExtensions, licenseSnapshot.product]);
  const agentReadOnly = useHtmlAgentEditorBridgeStore(state => state.readOnly);
  const browserAgent = useMemo(() => createBrowserAgentBinding({
    projectId: project.id,
    runtimeUrl: browserAgentRuntimeUrl,
    credentialScope: 'html-studio',
    isLicensed: () => {
      const product = licenseClient.getSnapshot().product;
      return product.licensed && product.features.ai === true;
    },
    isReadOnly: () => useHtmlAgentEditorBridgeStore.getState().readOnly,
  }), [licenseClient, project.id]);
  const pendingAgentDisposal = useRef<{ binding: typeof browserAgent; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    if (pendingAgentDisposal.current?.binding === browserAgent) clearTimeout(pendingAgentDisposal.current.timer);
    return () => { pendingAgentDisposal.current = { binding: browserAgent, timer: setTimeout(() => browserAgent.dispose(), 0) }; };
  }, [browserAgent]);
  useEffect(() => {
    void browserAgent.refreshAccess().catch(() => undefined);
    window.dispatchEvent(new CustomEvent('kodety:license-changed'));
  }, [browserAgent, productAccess.licensed, agentReadOnly]);
  const previewPreferences = useRef({ activeExtensions, language });
  previewPreferences.current = { activeExtensions, language };
  useEffect(() => {
    if (view === 'localization' && !activeExtensions.includes('kodety-localization')) setView('editor');
  }, [activeExtensions, view]);
  const [feature, setFeature] = useState<'CMS' | 'Analytics' | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publicationError, setPublicationError] = useState('');
  const [deploying, setDeploying] = useState<HtmlDeploymentWorkflow | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingExit, setConfirmingExit] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState('');
  const [reviewingStorage, setReviewingStorage] = useState(false);
  const api = useRef<EditorApi | null>(null);
  const latest = useRef<HtmlProject | null>(null);
  const session = useRef<ReturnType<typeof createHtmlDirectorySession> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const leaving = useRef(false);
  const backgroundSave = useRef<Promise<void> | null>(null);
  // Browser persistence and a portable backup are separate acknowledgements.
  // Keep the identity of the exported files so edits during ZIP generation
  // cannot accidentally be marked as backed up.
  const backupRevision = useRef(0);
  const backedUp = useRef<{ files: HtmlProject['files']; name: string; rootPath: string; revision: number } | null>(null);
  const lastObserved = useRef<HtmlProject | null>(null);
  const callbacks = useRef({ onBack, onProjectReady, project, productAccess });
  callbacks.current = { onBack, onProjectReady, project, productAccess };

  const saveProject = useCallback(async (snapshot: HtmlProject) => {
    if (!session.current) throw new Error(callbacks.current.project.storageMode === 'browser' ? 'O armazenamento do projeto ainda não está disponível neste navegador.' : 'Selecione e autorize a pasta do projeto.');
    clearTimeout(timer.current);
    setStatus('saving');
    try {
      await session.current.save(snapshot);
      if ((api.current?.getProject() || latest.current)?.files === snapshot.files) {
        dirty.current = false;
        setStatus('saved');
        setError('');
      } else setStatus('pending');
    } catch (cause) {
      dirty.current = true;
      setStatus('error');
      setError(cause instanceof Error ? cause.message : (callbacks.current.project.storageMode === 'browser' ? 'Não foi possível salvar neste navegador. Baixe uma cópia de recuperação do projeto.' : 'Não foi possível salvar na pasta.'));
      throw cause;
    }
  }, []);

  const openDirectory = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const current = callbacks.current;
    const loaded = await loadHtmlDirectory(handle, current.project.name);
    session.current = createHtmlDirectorySession(handle, loaded);
    api.current = null;
    latest.current = loaded;
    lastObserved.current = null;
    dirty.current = false;
    backedUp.current = null;
    backupRevision.current += 1;
    setDirectory(handle);
    setInitialProject(loaded);
    setError('');
    setStatus('saved');
    await current.onProjectReady({ ...current.project, initialized: true, directoryName: current.project.storageMode === 'browser' ? undefined : handle.name, updatedAt: Date.now(), lastOpenedAt: Date.now() });
  }, []);

  useEffect(() => {
    let cancelled = false;
    configureHtmlFontLibrary(project.id, null);
    void (async () => {
      const handle = await readHtmlDirectoryHandle(project.id);
      if (cancelled) return;
      if (!handle) throw new Error(browserStored ? (pt ? 'Os arquivos deste projeto não foram encontrados neste navegador. Crie outro projeto HTML e use “Substituir projeto com ZIP…” no menu do Builder.' : 'This project’s files were not found in this browser. Create another HTML project and choose “Replace project with ZIP…” from the Builder menu.') : (pt ? 'Selecione a pasta original deste projeto para continuar.' : 'Select the original project folder to continue.'));
      setDirectory(handle);
      if (!await authorizeHtmlDirectory(handle)) throw new Error(browserStored ? (pt ? 'O armazenamento deste navegador não está disponível.' : 'Storage is unavailable in this browser.') : (pt ? 'Autorize o acesso à pasta para abrir e salvar o projeto.' : 'Allow folder access to open and save this project.'));
      if (!cancelled) await openDirectory(handle);
    })().catch(cause => {
      if (!cancelled) { setStatus('error'); setError(cause instanceof Error ? cause.message : (browserStored ? 'Não foi possível abrir o armazenamento deste navegador.' : 'Não foi possível abrir a pasta.')); }
    });
    return () => { cancelled = true; clearTimeout(timer.current); configureHtmlFontLibrary('', null); };
  }, [openDirectory, project.id, browserStored]);

  const flush = useCallback(async () => {
    const current = api.current?.getProject() || latest.current;
    if (!current) throw new Error('O projeto ainda está abrindo.');
    await saveProject(current);
    await session.current!.flush();
    return canonicalProjectForTransport(current);
  }, [saveProject]);

  // Settings owns drafts before they reach projectRef. Its shared navigation
  // guard must commit them before flushing the folder or unmounting that view.
  const navigateAway = useCallback((destination: string, commit: () => void): Promise<boolean> => {
    if (navigation.current) return navigation.current;
    setBusy(true);
    const pending = (async () => {
      let committed = false;
      try {
        await backgroundSave.current;
        if (!await runWorkspaceNavigationGuards(destination)) return false;
        await flush();
        commit();
        committed = true;
        return true;
      } catch (cause) {
        if (destination === 'library') leaving.current = false;
        setError(cause instanceof Error ? cause.message : (pt ? 'Não foi possível salvar antes de sair.' : 'Unable to save before leaving.'));
        return false;
      } finally { if (!committed) cancelWorkspaceNavigation(); setBusy(false); }
    })();
    navigation.current = pending;
    void pending.finally(() => { if (navigation.current === pending) navigation.current = null; });
    return pending;
  }, [flush, pt]);

  const navigateView = useCallback((nextView: 'editor' | 'settings' | 'localization' | 'cms') => {
    if (nextView === viewRef.current) return Promise.resolve(true);
    return navigateAway(nextView, () => { viewRef.current = nextView; setView(nextView); });
  }, [navigateAway]);

  const openIntegrationSettings = useCallback((section: 'mcp' | 'license' | 'beta' | 'agents') => {
    const open = () => {
      const url = new URL(window.location.href);
      url.searchParams.set('section', section);
      window.history.replaceState(window.history.state, '', url);
      useHtmlProjectSettingsStore.getState().open(section);
      viewRef.current = 'settings';
      setView('settings');
    };
    // Moving between sections keeps the same Settings component and its drafts.
    if (viewRef.current === 'settings') open();
    else void navigateAway('settings', open);
  }, [navigateAway]);

  const cachePreview = useCallback((snapshot: HtmlProject) => writeHtmlPreview(project.id, {
    project: canonicalProjectForTransport(snapshot),
    ...previewPreferences.current,
  }), [project.id]);

  const mcpController = useMemo(() => createHtmlMcpController({
    projectId: project.id,
    projectName: project.name,
    siteUrl: document.baseURI,
    assertAvailable: async () => {
      await licenseClient.load().catch(() => undefined);
      const access = licenseClient.getSnapshot().product;
      if (access.features.mcp !== true) throw new Error('MCP is unavailable in this environment.');
    },
    saveProject: async () => { await flush(); },
  }), [flush, licenseClient, project.id, project.name]);
  const mcpSnapshot = useSyncExternalStore(mcpController.subscribe, mcpController.getSnapshot, mcpController.getSnapshot);
  const mcp = useMemo<Host['mcp']>(() => ({
    status: {
      enabled: mcpSnapshot.status.enabled === true,
      configured: mcpSnapshot.status.configured === true,
      activity: null,
      target: null,
    },
    onOpenSettings: () => openIntegrationSettings('mcp'),
  }), [mcpSnapshot.status.enabled, mcpSnapshot.status.configured, openIntegrationSettings]);
  useEffect(() => { mcpController.start(); return () => mcpController.dispose(); }, [mcpController]);
  useEffect(() => {
    if (!initialProject || loadedLicenseClient !== licenseClient) return;
    if (productAccess.licensed) void mcpController.refresh().catch(() => undefined);
    else void mcpController.suspend();
  }, [initialProject, licenseClient, loadedLicenseClient, mcpController, productAccess.licensed]);
  const onAgentConnected = useCallback(() => {
    void navigateView('editor').then(allowed => {
      if (!allowed) return;
      useHtmlProjectSettingsStore.getState().close();
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_HTML_AGENT_PANEL_EVENT)));
    });
  }, [navigateView]);
  const settingsContent = useMemo(() => ({
    mcp: <HtmlWorkspaceMcpSettings controller={mcpController} />,
    agents: <Suspense fallback={<div role="status">{pt ? 'Abrindo o Agent…' : 'Opening Agent…'}</div>}><SharedAgentSettings onAccountConnected={onAgentConnected} /></Suspense>,
  }), [mcpController, onAgentConnected, pt]);

  useEffect(() => installHtmlPreviewBridge(project.id, {
    refresh: async () => { await cachePreview(await flush()); },
    publish: () => setPublishing(true),
  }), [cachePreview, flush, project.id]);

  const guideWorkspace = useMemo<BuilderOnboardingWorkspace>(() => ({
    id: project.id,
    currentArea: view === 'editor' ? 'design' : view,
    enabledAreas: ['design', 'settings', ...(activeExtensions.includes('kodety-localization') ? ['localization' as const] : [])],
    onNavigate: async area => {
      if (area !== 'design' && area !== 'settings' && area !== 'localization') return false;
      if (area === 'localization' && !activeExtensions.includes('kodety-localization')) return false;
      return navigateView(area === 'design' ? 'editor' : area);
    },
  }), [activeExtensions, navigateView, project.id, view]);

  const needsBackup = useCallback(() => {
    const current = api.current?.getProject() || latest.current;
    if (!current) return false;
    const snapshot = canonicalProjectForTransport(current);
    const saved = backedUp.current;
    return !saved || saved.files !== snapshot.files || saved.name !== snapshot.name
      || saved.rootPath !== snapshot.rootPath || saved.revision !== backupRevision.current;
  }, []);

  const saveBeforeBackground = useCallback((): Promise<void> => {
    if (leaving.current || navigation.current) return Promise.resolve();
    if (backgroundSave.current) return backgroundSave.current;
    const pending = (async () => {
      try {
        // Settings/CMS may own the latest draft before it reaches the editor.
        // "backup" commits their drafts while keeping those views editable.
        if (!await runWorkspaceNavigationGuards('backup')) return;
        await flush();
      } catch { /* The existing draft guards retain errors. */ }
      finally { cancelWorkspaceNavigation(); }
    })();
    backgroundSave.current = pending;
    void pending.finally(() => { if (backgroundSave.current === pending) backgroundSave.current = null; });
    return pending;
  }, [flush]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      // Run even when the editor snapshot is saved: Settings/CMS can still
      // have a newer form draft and own its synchronous unload protection.
      void saveBeforeBackground();
      if (!dirty.current && !(browserStored && needsBackup())) return;
      // Native unload cannot await network/IDB. Keep the browser's confirmation
      // until an actual ACK; if the user stays, this attempt can finish safely.
      event.preventDefault();
      event.returnValue = '';
    };
    const background = () => {
      if (document.visibilityState !== 'hidden') return;
      void saveBeforeBackground();
    };
    const draftChanged = () => { backupRevision.current += 1; };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener(WORKSPACE_DRAFT_CHANGED_EVENT, draftChanged);
    document.addEventListener('visibilitychange', background);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener(WORKSPACE_DRAFT_CHANGED_EVENT, draftChanged); document.removeEventListener('visibilitychange', background); };
  }, [browserStored, flush, needsBackup, saveBeforeBackground]);

  const onProjectChange = useCallback((snapshot: HtmlProject) => {
    latest.current = snapshot;
    const previous = lastObserved.current;
    if (previous?.files === snapshot.files && previous.name === snapshot.name && previous.rootPath === snapshot.rootPath) return;
    lastObserved.current = snapshot;
    dirty.current = true;
    setStatus('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveProject(api.current?.getProject() || snapshot).catch(() => undefined), 750);
  }, [saveProject]);

  const close = useCallback(() => {
    if (browserStored) {
      setExitError('');
      setConfirmingExit(true);
      return;
    }
    void navigateAway('library', () => { leaving.current = true; callbacks.current.onBack(); });
  }, [browserStored, navigateAway]);

  const importFonts = useCallback(async (files: readonly File[]): Promise<FontLibraryFont[]> => {
    const current = api.current?.getProject();
    if (!current) throw new Error('O projeto ainda está abrindo.');
    const next = { ...current, files: { ...current.files } };
    const fonts: FontLibraryFont[] = [];
    let css = next.files['assets/fonts/kodety-fonts.css']?.text || '';
    for (const file of files) {
      if (!/\.(woff2?|ttf|otf)$/i.test(file.name) || file.size > 20 * 1024 * 1024) throw new Error('Importe fontes WOFF, WOFF2, TTF ou OTF de até 20 MB.');
      const safe = file.name.replace(/[^a-z0-9._-]/gi, '-');
      const path = `assets/fonts/${crypto.randomUUID().slice(0, 8)}-${safe}`;
      next.files[path] = await fileToProjectFile(path, file);
      const family = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9 _-]/gi, '').trim() || 'Custom font';
      css += `\n@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(path.split('/').at(-1))});font-weight:100 900;font-style:normal;font-display:swap;}\n`;
      const now = new Date().toISOString();
      fonts.push({ id: path, family, name: family.toLowerCase().replace(/ /g, '-'), type: 'custom', variants: ['regular'], weights: ['400'], category: 'sans-serif', url: path, kind: safe.split('.').at(-1), is_published: false, created_at: now, updated_at: now, deleted_at: null });
    }
    next.files['assets/fonts/kodety-fonts.css'] = { path: 'assets/fonts/kodety-fonts.css', mimeType: 'text/css', text: css };
    for (const [path, file] of Object.entries(next.files)) {
      if (!/\.html?$/i.test(path) || file.text === undefined || path.startsWith('.incode/') || file.text.includes('data-kodety-local-fonts')) continue;
      const href = '../'.repeat(path.split('/').length - 1) + 'assets/fonts/kodety-fonts.css';
      const link = `<link rel="stylesheet" data-kodety-local-fonts href="${href}">`;
      next.files[path] = { ...file, text: /<\/head>/i.test(file.text) ? file.text.replace(/<\/head>/i, link + '</head>') : link + file.text };
    }
    await saveProject(next);
    api.current!.applyProject(next);
    return fonts;
  }, [saveProject]);

  const prepareExport = useCallback(async (current: HtmlProject, publication = false) => {
    await licenseClient.load().catch(() => undefined);
    return prepareHtmlLicenseExport(current, licenseClient.getSnapshot().product, { publication, language });
  }, [language, licenseClient]);
  const exportSnapshot = useCallback(async (current: HtmlProject, revision = backupRevision.current) => {
    const snapshot = canonicalProjectForTransport(current);
    const toastId = `html-workspace:backup:${callbacks.current.project.id}`;
    toast.loading(pt ? 'Preparando backup ZIP…' : 'Preparing ZIP backup…', { id: toastId });
    setBusy(true);
    try {
      const source = prepareProjectForDraftTransport(snapshot);
      let output: HtmlProject;
      try { output = await prepareExport(snapshot); }
      catch (cause) {
        // A broken CMS template must never prevent an editable recovery copy.
        if (!(cause instanceof StaticCmsPublicationError)) throw cause;
        output = source;
      }
      const portable = attachStaticHtmlSource(source, output);
      downloadZipBlob(await projectToZipBlob(portable), `${callbacks.current.project.name}-editavel.zip`);
      backedUp.current = { files: snapshot.files, name: snapshot.name, rootPath: snapshot.rootPath, revision };
      toast.success(pt ? 'Backup ZIP gerado' : 'ZIP backup created', { id: toastId });
    } catch (cause) {
      toast.dismiss(toastId);
      setError(cause instanceof Error ? cause.message : 'Não foi possível exportar.');
      throw cause;
    } finally { setBusy(false); }
  }, [prepareExport, pt]);

  const confirmExit = useCallback((download: boolean): Promise<boolean> => {
    if (navigation.current) return navigation.current;
    setExitBusy(true);
    setBusy(true);
    setExitError('');
    const pending = (async () => {
      try {
        if (!await runWorkspaceNavigationGuards('backup')) {
          setExitError(pt ? 'Revise as alterações pendentes nas configurações antes de sair.' : 'Review pending changes in Settings before leaving.');
          return false;
        }
        const revision = backupRevision.current;
        const snapshot = await flush();
        if (download) {
          await exportSnapshot(snapshot, revision);
          if (needsBackup()) throw new Error(pt ? 'Há novas alterações desde o início do backup. Baixe o ZIP novamente para incluí-las antes de sair.' : 'There are new changes since the backup started. Download the ZIP again to include them before leaving.');
        }
        setConfirmingExit(false);
        leaving.current = true;
        callbacks.current.onBack();
        return true;
      } catch (cause) {
        leaving.current = false;
        setExitError(cause instanceof Error ? cause.message : (pt ? 'Não foi possível preparar a saída. Seu projeto continua aberto.' : 'Could not prepare to leave. Your project is still open.'));
        return false;
      } finally { setExitBusy(false); setBusy(false); }
    })();
    navigation.current = pending;
    void pending.finally(() => { if (navigation.current === pending) navigation.current = null; });
    return pending;
  }, [exportSnapshot, flush, needsBackup, pt]);

  const downloadBackup = useCallback(async () => {
    setBusy(true);
    try {
      if (!await runWorkspaceNavigationGuards('backup')) return;
      const revision = backupRevision.current;
      await exportSnapshot(await flush(), revision);
    } catch (cause) { setError(cause instanceof Error ? cause.message : (pt ? 'Não foi possível baixar o backup.' : 'Could not download the backup.')); }
    finally { setBusy(false); }
  }, [exportSnapshot, flush, pt]);

  const host = useMemo<Host | undefined>(() => initialProject ? {
    initialProject, directoryName: browserStored ? (pt ? 'Neste navegador' : 'In this browser') : directory?.name, view, onNavigateView: navigateView,
    storageMode: browserStored ? 'browser' : 'folder',
    beforeNavigatePage: () => navigateAway('page', () => undefined),
    backup: browserStored ? { label: pt ? 'Baixar backup ZIP' : 'Download ZIP backup', busy, onDownload: () => void downloadBackup() } : undefined,
    onOpenSettingsSection: openIntegrationSettings,
    product: productAccess, settingsContent, mcp,
    previewUrl: htmlPreviewUrl(project.id, document.baseURI),
    preparePreview: async snapshot => {
      await saveProject(snapshot);
      await cachePreview(snapshot);
    },
    activeExtensions, onManageExtensions: () => setManagingExtensions(true),
    saveProject, exportProject: async () => {
      if (!await runWorkspaceNavigationGuards('backup')) throw new Error(pt ? 'Revise as alterações pendentes nas configurações antes de baixar o ZIP.' : 'Review pending changes in Settings before downloading the ZIP.');
      const revision = backupRevision.current;
      await exportSnapshot(await flush(), revision);
    }, onProjectChange,
    onReady: editor => {
      api.current = editor;
      configureHtmlFontLibrary(callbacks.current.project.id, importFonts);
      void refreshHtmlFontLibrary(callbacks.current.project.id);
    },
    onBack: close, onPublish: () => setPublishing(true), onWordPressFeature: setFeature,
  } : undefined, [activeExtensions, browserStored, busy, downloadBackup, pt, cachePreview, close, directory?.name, exportSnapshot, flush, importFonts, initialProject, mcp, navigateAway, navigateView, onProjectChange, openIntegrationSettings, productAccess, project.id, saveProject, settingsContent, view]);

  const retryBrowserStorage = async () => {
    setBusy(true);
    try {
      const handle = await readHtmlDirectoryHandle(project.id);
      if (!handle) throw new Error(pt ? 'Crie outro projeto HTML e use “Substituir projeto com ZIP…” no menu do Builder para recuperar estes arquivos.' : 'Create another HTML project and choose “Replace project with ZIP…” from the Builder menu to recover these files.');
      setDirectory(handle);
      if (initialProject) await flush(); else await openDirectory(handle);
    } catch (cause) { setStatus('error'); setError(cause instanceof Error ? cause.message : (pt ? 'O armazenamento não está disponível.' : 'Storage is unavailable.')); }
    finally { setBusy(false); }
  };

  const authorize = async (selectAgain = false) => {
    if (browserStored) return retryBrowserStorage();
    setBusy(true);
    try {
      const handle = selectAgain || !directory ? await pickHtmlDirectory() : directory;
      if (!await authorizeHtmlDirectory(handle, true)) throw new Error(pt ? 'Permita leitura e escrita na pasta para continuar.' : 'Allow read and write access to this folder to continue.');
      if (handle !== directory) await bindHtmlDirectory(project.id, handle);
      setDirectory(handle);
      if (initialProject) await flush(); else await openDirectory(handle);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'Não foi possível autorizar a pasta.'); }
    } finally { setBusy(false); }
  };

  const recoverAndReopen = async () => {
    if (!directory) return;
    setBusy(true);
    clearTimeout(timer.current);
    try {
      // Request permission while this button still has user activation, before
      // ZIP generation can spend seconds processing a large project.
      if (!browserStored && !await authorizeHtmlDirectory(directory, true)) throw new Error('Autorize a pasta para reabrir o projeto.');
      const current = api.current?.getProject() || latest.current;
      if (current) downloadZipBlob(await projectToZipBlob(canonicalProjectForTransport(current)), `${project.name}-recuperacao.zip`);
      await session.current?.flush().catch(() => undefined);
      await openDirectory(directory);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível reabrir.'); }
    finally { setBusy(false); }
  };

  const exportWordPressZip = async () => {
    if (!await runWorkspaceNavigationGuards('backup')) throw new Error(pt ? 'Revise as alterações pendentes antes de exportar para WordPress.' : 'Review pending changes before exporting to WordPress.');
    setBusy(true);
    try {
      const snapshot = await flush();
      downloadZipBlob(await createHtmlWordPressZip(snapshot), `${project.name}-wordpress.zip`);
    } finally { setBusy(false); }
  };
  const reportPublicationError = (cause: unknown, fallback: string) => {
    setPublicationError(cause instanceof Error ? cause.message : fallback);
  };

  const exportSiteZip = async () => {
    setBusy(true);
    setPublicationError('');
    try {
      const output = await prepareExport(await flush(), true);
      downloadZipBlob(await createHtmlSiteZip(output), `${project.name}-site.zip`);
    } catch (cause) { reportPublicationError(cause, 'Não foi possível exportar o site.'); }
    finally { setBusy(false); }
  };
  const getDeploymentFiles = useCallback(async () => {
    const exported = await prepareExport(await flush(), true);
    return Object.values(exported.files).filter(file => isPublicHtmlPath(file.path)).map(file => ({ path: file.path, content: file.text ?? file.data ?? new Uint8Array() }));
  }, [flush, prepareExport]);
  const publishToFolder = async () => {
    if (browserStored || !directory) return;
    setBusy(true);
    setPublicationError('');
    try {
      const output = await publishHtmlDirectory(directory, project.id, await prepareExport(await flush(), true));
      toast.success(pt ? 'Site publicado na pasta' : 'Site published to folder', { description: `${directory.name}/${output}/` });
      setPublishing(false);
    } catch (cause) { reportPublicationError(cause, 'Não foi possível publicar na pasta.'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const id = `html-workspace:error:${project.id}`;
    if (!error || !initialProject) { toast.dismiss(id); return; }
    toast.error(error, { id, duration: Infinity, action: {
      label: pt ? 'Ver opções' : 'View options',
      onClick: () => setReviewingStorage(true),
    } });
  }, [error, initialProject, project.id, pt]);
  useEffect(() => () => {
    toast.dismiss(`html-workspace:error:${project.id}`);
    toast.dismiss(`html-workspace:backup:${project.id}`);
  }, [project.id]);

  return <section className="web-html-workspace" aria-label={pt ? 'Projeto HTML' : 'HTML project'}>
    <div id="kodety-root" className="web-html-builder" inert={busy} aria-busy={busy}>
      {host ? <Suspense fallback={<KodetyLoadingScreen label={pt ? 'Carregando editor' : 'Loading editor'} className="h-full min-h-0" />}><HtmlWorkspaceAgentProvider kind="html" licensed={productAccess.licensed} checkLicense={checkAgentLicense} agent={browserAgent} onOpenSettings={openIntegrationSettings}><SharedHtmlEditor key={initialProject?.openedAt} workspace={host} /></HtmlWorkspaceAgentProvider></Suspense> : status === 'opening' ? <KodetyLoadingScreen label={pt ? 'Carregando projeto' : 'Loading project'} className="h-full min-h-0" /> : <div className="web-app web-html-opening">
        <button className="web-button" disabled={busy} onClick={onBack}>{pt ? 'Projetos' : 'Projects'}</button>
        <h1>{pt ? 'Não foi possível abrir o projeto' : 'Could not open the project'}</h1>
        {error && <p className="web-html-opening-error" role="alert">{error}</p>}
        <>
          <button className="web-button is-primary" disabled={busy} onClick={() => void authorize()}>{browserStored ? (pt ? 'Tentar novamente' : 'Try again') : directory ? (pt ? 'Autorizar pasta' : 'Authorize folder') : (pt ? 'Selecionar pasta' : 'Select folder')}</button>
          {!browserStored && directory && <><p className="web-html-opening-hint">{pt ? 'Se o navegador oferecer acesso em todas as visitas, essa opção evita novas confirmações enquanto a permissão for mantida.' : 'If your browser offers “Allow on every visit”, choosing it avoids new prompts while access remains granted.'}</p><button className="web-text-button" disabled={busy} onClick={() => void authorize(true)}>{pt ? 'Selecionar pasta novamente' : 'Select folder again'}</button></>}
        </>
      </div>}
    </div>
    {host && <WordPressBuilderOnboarding workspace={guideWorkspace} />}
    {managingExtensions && <HtmlExtensionsDialog projectId={project.id} language={language} onClose={() => setManagingExtensions(false)} onChange={setExtensions} />}
    {feature && <HtmlWordPressFeatureDialog feature={feature} language={language} busy={busy} onClose={() => setFeature(null)} onExport={exportWordPressZip} />}
    <div className="web-app web-html-dialogs">
    {reviewingStorage && <Dialog title={pt ? 'Conferir salvamento' : 'Review saving'} closeLabel={pt ? 'Fechar' : 'Close'} busy={busy} onClose={() => setReviewingStorage(false)}>
      <div className="web-form-body"><Notice>{error || (pt ? 'O projeto voltou a salvar normalmente.' : 'The project is saving normally again.')}</Notice></div>
      <footer className="web-dialog-footer">
        <button type="button" className="web-button" disabled={busy} onClick={() => void recoverAndReopen()}>{pt ? 'Baixar cópia e reabrir' : 'Download copy and reopen'}</button>
        <button type="button" className="web-button is-primary" disabled={busy} onClick={() => void (status === 'error' ? authorize() : downloadBackup())}>{pt ? 'Tentar novamente' : 'Try again'}</button>
      </footer>
    </Dialog>}
    {confirmingExit && <Dialog title={pt ? 'Baixar um backup antes de sair?' : 'Download a backup before leaving?'} description={pt ? 'Leve uma cópia editável do projeto para continuar com segurança.' : 'Keep an editable copy of your project for your next session.'} className="web-html-exit-dialog" closeLabel={pt ? 'Continuar editando' : 'Continue editing'} busy={exitBusy} onClose={() => { setConfirmingExit(false); setExitError(''); }}>
      <div className="web-html-exit-body">
        <div className="web-html-exit-project"><span className="web-html-exit-icon"><Icon name="download" /></span><div><strong>{project.name}</strong><span>{pt ? 'Backup ZIP · Projeto editável' : 'ZIP backup · Editable project'}</span></div></div>
        <p>{pt ? 'Guarde o ZIP na sua pasta de segurança. O destino segue as configurações de download do navegador.' : 'Keep the ZIP in your backup folder. Its destination follows your browser’s download settings.'}</p>
        {exitError && <Notice>{exitError}</Notice>}
        {exitBusy && <p className="web-html-exit-progress" role="status"><Spinner />{pt ? 'Salvando as alterações e preparando a saída…' : 'Saving changes and preparing to leave…'}</p>}
      </div>
      <footer className="web-html-exit-actions">
        <button type="button" className="web-button is-primary" disabled={exitBusy} onClick={() => void confirmExit(true)}><Icon name="download" />{pt ? 'Baixar ZIP e sair' : 'Download ZIP and leave'}</button>
        <button type="button" className="web-button" disabled={exitBusy} onClick={() => { setConfirmingExit(false); setExitError(''); }}>{pt ? 'Continuar editando' : 'Continue editing'}</button>
        <button type="button" className="web-text-button web-html-exit-skip" disabled={exitBusy} onClick={() => void confirmExit(false)}>{pt ? 'Sair sem baixar' : 'Leave without downloading'}</button>
      </footer>
    </Dialog>}
    {publishing && <Dialog title={pt ? 'Publicar site' : 'Publish site'} description={pt ? 'Seu site pronto para ir ao ar. Escolha como publicar.' : 'Your site, ready to go live. Choose how to publish.'} className="web-html-publish-dialog" closeLabel={pt ? 'Fechar publicação' : 'Close publishing'} busy={busy} onClose={() => { setPublishing(false); setPublicationError(''); }}>
      <div className="web-form-body web-html-publish-options">
        <button type="button" className="web-html-publish-option" disabled={busy} onClick={() => { setPublishing(false); setPublicationError(''); setDeploying('cloudflare'); }}>
          <span className="web-html-publish-option-icon"><HtmlPublishIcon name="globe" /></span>
          <span className="web-html-publish-option-copy"><strong>{pt ? 'Publicar online' : 'Publish online'}</strong><small>{pt ? 'Publique pelo Cloudflare Pages, GitHub, Vercel ou upload manual.' : 'Publish with Cloudflare Pages, GitHub, Vercel, or a manual upload.'}</small></span>
          <HtmlPublishIcon name="chevron-right" className="web-html-publish-option-arrow" />
        </button>
        <button type="button" className="web-html-publish-option" disabled={busy} onClick={() => { setPublishing(false); setPublicationError(''); setDeploying('ftp'); }}>
          <span className="web-html-publish-option-icon"><HtmlDeploymentBrand provider="ftp" /></span>
          <span className="web-html-publish-option-copy"><strong>{pt ? 'FTP / outra hospedagem' : 'FTP / other hosting'}</strong><small>{pt ? 'Envie os arquivos por FTP, SFTP ou pelo gerenciador da hospedagem.' : 'Upload the files with FTP, SFTP, or your hosting file manager.'}</small></span>
          <HtmlPublishIcon name="chevron-right" className="web-html-publish-option-arrow" />
        </button>
        <button type="button" className="web-html-publish-option" disabled={busy} onClick={() => { setPublishing(false); setPublicationError(''); setDeploying('wordpress'); }}>
          <span className="web-html-publish-option-icon"><HtmlDeploymentBrand provider="wordpress" /></span>
          <span className="web-html-publish-option-copy"><strong>WordPress</strong><small>{pt ? 'Baixe o ZIP completo e importe no Kodety instalado no seu WordPress.' : 'Download the complete ZIP and import it into Kodety on your WordPress site.'}</small></span>
          <HtmlPublishIcon name="chevron-right" className="web-html-publish-option-arrow" />
        </button>
        <div className="web-html-publish-divider"><span>{pt ? 'Exportar arquivos' : 'Export files'}</span></div>
        <div className="web-html-publish-local">
          {!browserStored && <button type="button" className="web-html-publish-option" disabled={busy} onClick={() => void publishToFolder()}>
            <span className="web-html-publish-option-icon"><HtmlPublishIcon name="folder" /></span>
            <span className="web-html-publish-option-copy"><strong>{pt ? 'Publicar na pasta do projeto' : 'Publish to project folder'}</strong><small>{pt ? 'Gere uma versão pronta para hospedagem na sua pasta.' : 'Generate a version ready for hosting in your folder.'}</small></span>
            <HtmlPublishIcon name="chevron-right" className="web-html-publish-option-arrow" />
          </button>}
          <button type="button" className="web-html-publish-option" disabled={busy} onClick={() => void exportSiteZip()}>
            <span className="web-html-publish-option-icon"><HtmlPublishIcon name="download" /></span>
            <span className="web-html-publish-option-copy"><strong>{pt ? 'Baixar site em ZIP' : 'Download site ZIP'}</strong><small>{pt ? 'Todos os arquivos públicos em um único download.' : 'All public site files in a single download.'}</small></span>
            <HtmlPublishIcon name="chevron-right" className="web-html-publish-option-arrow" />
          </button>
        </div>
        {publicationError && <Notice>{publicationError}</Notice>}
        <p className="web-html-publish-note" role={busy ? 'status' : undefined}>{busy ? <><Spinner />{pt ? 'Preparando os arquivos do site…' : 'Preparing your site files…'}</> : <><HtmlPublishIcon name="check" />{pt ? 'Você revisa os arquivos antes de enviar para um serviço.' : 'Review your files before sending them to a service.'}</>}</p>
      </div>
    </Dialog>}
    {deploying && <HtmlDeploymentPanel projectId={project.id} language={language} initialWorkflow={deploying} getFiles={getDeploymentFiles} onExportWordPress={exportWordPressZip} onClose={() => setDeploying(null)} />}
    </div>
  </section>;
}
