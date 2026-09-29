import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { HtmlWorkspaceAgentProvider } from '@/lib/html-editor/agent-host';
import { createBrowserAgentBinding } from '@/lib/html-editor/browser-agent-webcontainer';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OPEN_HTML_AGENT_PANEL_EVENT } from '@/lib/html-editor/agent-panel-events';
import { useHtmlAgentEditorBridgeStore } from '@/stores/useHtmlAgentEditorBridgeStore';
import { requestWorkspaceNavigationWithEditorLockHandoff } from './editor-lock-navigation';
import { useWordPressLicenseRevision } from './WordPressTrialNotice';
import { wordpressEntryConfig, type KodetyWordPressWindow } from './wordpress-entry-config';
import { WORDPRESS_LICENSE_CHANGED } from './wordpress-trial-runtime';
import { selectWordPressAgentExecution, wordpressBrowserAgentLicensed, wordpressBrowserAgentSettingsUrl, WORDPRESS_AGENT_SETTINGS_PARAM, type WordPressAgentExecution } from './wordpress-agent-execution';

const HtmlAgentSettings = lazy(() => import('@/app/(builder)/kodety/html-editor/components/HtmlAgentSettings').then(module => ({ default: module.HtmlAgentSettings })));

export function WordPressAgentProvider({ children }: { children: ReactNode }) {
  const licenseRevision = useWordPressLicenseRevision();
  const config = wordpressEntryConfig();
  const selected = config?.agentBrowser?.selected === 'webcontainer' ? 'browser' : 'server';
  const [changing, setChanging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => selected === 'browser' && config?.appView === 'editor'
    && new URLSearchParams(window.location.search).get(WORDPRESS_AGENT_SETTINGS_PARAM) === '1');
  const editorReadOnly = useHtmlAgentEditorBridgeStore(state => state.readOnly);
  const changingRef = useRef(false);
  const projectId = `wordpress:${window.location.origin}:${config?.agentBrowser?.userId || 0}:${config?.projectId || 'site'}`;
  const runtimeUrl = config?.agentBrowser?.runtimeUrl || '';
  const agent = useMemo(() => selected === 'browser' && config?.agentUrl ? createBrowserAgentBinding({
    projectId,
    runtimeUrl,
    network: {
      url: `${config.agentUrl.replace(/\/$/, '')}/network`,
      headers: () => ({ 'X-WP-Nonce': wordpressEntryConfig()?.nonce || '' }),
      ...(config.studio?.enabled && config.studio.studioOrigin ? { studio: { origin: config.studio.studioOrigin, projectId: config.studio.projectId } } : {}),
    },
    credentialScope: `wordpress:${window.location.origin}:${config?.agentBrowser?.userId || 0}`,
    isLicensed: () => wordpressBrowserAgentLicensed(wordpressEntryConfig()),
    isReadOnly: () => wordpressEntryConfig()?.readOnly === true || useHtmlAgentEditorBridgeStore.getState().readOnly,
  }) : undefined, [selected, projectId, runtimeUrl, config?.agentUrl, config?.studio?.studioOrigin, config?.studio?.projectId]);
  const disposalTimers = useRef(new Map<NonNullable<typeof agent>, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!agent) return;
    const timers = disposalTimers.current;
    clearTimeout(timers.get(agent));
    timers.delete(agent);
    return () => {
      // React StrictMode reattaches effects before this release; a real unmount
      // still terminates the process. The account is restored from browser storage.
      timers.set(agent, setTimeout(() => { timers.delete(agent); agent.dispose(); }, 0));
    };
  }, [agent]);
  useEffect(() => { void agent?.refreshAccess().catch(() => undefined); }, [agent, licenseRevision, editorReadOnly, config?.readOnly]);
  useEffect(() => {
    if (config?.appView !== 'editor') return;
    const current = new URL(window.location.href);
    if (!current.searchParams.has(WORDPRESS_AGENT_SETTINGS_PARAM)) return;
    current.searchParams.delete(WORDPRESS_AGENT_SETTINGS_PARAM);
    window.history.replaceState(window.history.state, '', current.href);
  }, [config?.appView]);

  const select = useCallback(async (mode: WordPressAgentExecution) => {
    if (!config || !config.agentUrl || mode === selected || changingRef.current) return;
    changingRef.current = true;
    setChanging(true);
    try {
      await selectWordPressAgentExecution(mode, config);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível trocar a execução do Agent.');
    } finally {
      // Also unlock after a rejected guard or a cancelled beforeunload.
      changingRef.current = false;
      setChanging(false);
    }
  }, [config, selected]);
  const onOpenSettings = useCallback((section: 'mcp' | 'license' | 'agents') => {
    if (selected === 'browser' && section === 'agents') {
      if (config?.appView === 'editor') { setSettingsOpen(true); return; }
      if (config) {
        void requestWorkspaceNavigationWithEditorLockHandoff(wordpressBrowserAgentSettingsUrl(config, window.location.href)).catch(error => {
          toast.error(error instanceof Error ? error.message : 'Não foi possível abrir o Agent no Builder.');
        });
      }
      return;
    }
    const url = new URL(config?.settingsUrl || '/kodety/settings/', window.location.href);
    url.searchParams.set('section', section);
    url.hash = '';
    void requestWorkspaceNavigationWithEditorLockHandoff(url.href).catch(error => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível abrir as configurações.');
    });
  }, [config, selected]);

  const checkLicense = useCallback(async () => {
    const current = wordpressEntryConfig();
    const source = current?.product?.licenseStatusUrl;
    if (!source || !current?.nonce) throw new Error('Não foi possível verificar a licença. Tente novamente.');
    const url = new URL(source, window.location.href);
    if (url.origin !== window.location.origin) throw new Error('Não foi possível verificar a licença. Tente novamente.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url.href, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'X-WP-Nonce': current.nonce },
      });
      if (!response.ok) throw new Error('License unavailable');
      const product = await response.json();
      if (product?.edition !== 'pro' || typeof product.licensed !== 'boolean' || !product.features || !product.limits) throw new Error('Invalid license status');
      const updated = { ...(wordpressEntryConfig() ?? current), product };
      (window as KodetyWordPressWindow).kodetyWordPress = updated;
      window.dispatchEvent(new Event(WORDPRESS_LICENSE_CHANGED));
      return wordpressBrowserAgentLicensed(updated);
    } catch {
      throw new Error('Não foi possível verificar a licença. Tente novamente.');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  return <HtmlWorkspaceAgentProvider kind="wordpress" licensed={wordpressBrowserAgentLicensed(config)} agent={agent}
    checkLicense={agent ? checkLicense : undefined}
    execution={config?.agentUrl ? { selected, changing, select } : undefined} onOpenSettings={onOpenSettings}>
    {children}
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent width="620px" className="z-[1100] max-h-[calc(100dvh-2rem)] overflow-y-auto" overlayClassName="z-[1099]"
        onCloseAutoFocus={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Agent no navegador</DialogTitle>
          <DialogDescription>Conecte sua conta e continue a conversa neste Builder.</DialogDescription>
        </DialogHeader>
        <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Carregando configurações do Agent…</p>}>
          <HtmlAgentSettings readOnly={config?.readOnly === true || editorReadOnly}
            onUseMcp={() => onOpenSettings('mcp')}
            onAccountConnected={() => {
              setSettingsOpen(false);
              window.dispatchEvent(new Event(OPEN_HTML_AGENT_PANEL_EVENT));
            }} />
        </Suspense>
      </DialogContent>
    </Dialog>
  </HtmlWorkspaceAgentProvider>;
}
