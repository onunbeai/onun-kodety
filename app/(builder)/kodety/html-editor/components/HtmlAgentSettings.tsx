'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CheckCircle2, ExternalLink, FolderOpen, Link2, Loader2, RefreshCw, Trash2, Upload } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AgentTransport } from '@/lib/html-editor/agent-transport';
import type { AgentBackend, AgentBackendCallbacks, AgentBackendCapabilities } from '@/lib/html-editor/agent-backend';
import { useHtmlWorkspaceAgentHost } from '@/lib/html-editor/agent-host';
import { agentBrowserNotice } from '@/lib/html-editor/agent-browser-support';
import { HtmlAgentBrowserNotice } from './HtmlAgentBrowserNotice';
import { notifyAgentAccountChanged, observeAgentAccount } from '@/lib/html-editor/agent-account-sync';
import { agentAccountLoginUrl, closeAgentAccountPopup, openAgentAccountLoginPage } from '@/lib/html-editor/agent-account-popup';
import { wordpressConfig } from '@/lib/html-editor/editor-wordpress-helpers';
import { useHtmlAgentEditorBridgeStore } from '@/stores/useHtmlAgentEditorBridgeStore';
import {
  agentRuntimeFailure,
  agentRuntimeUnavailable,
  isAgentSetupAborted,
  prepareAgentRuntime,
  type AgentRuntimeDiagnostic,
  type AgentRuntimeProgress,
} from '@/lib/html-editor/agent-runtime-setup';
import { ProjectSettingsFieldControl } from './HtmlProjectSettingsFieldControl';
import { HtmlSettingsSelectControl, HtmlSettingsToggleControl } from './HtmlSettingsControls';
import { HtmlAgentRuntimeStatus, isAgentRuntimeHostBlocked } from './HtmlAgentRuntimeStatus';
import { HtmlAgentDeviceCodeCard } from './HtmlAgentDeviceCodeCard';

interface AgentSettingsSkill {
  name: string;
  description?: string;
  shortDescription?: string | null;
  enabled?: boolean;
  path?: string;
  interface?: {
    displayName?: string;
    shortDescription?: string;
  } | null;
}

interface AgentSettingsConfig {
  enabled?: boolean;
  available?: boolean;
  transport?: 'local' | 'remote' | 'webcontainer';
  transportOptions?: { canChange?: boolean; selected?: 'local' | 'remote' | 'webcontainer'; remoteLabel?: string };
  capabilities?: AgentBackendCapabilities;
  historyWarning?: string | null;
  licenseRequired?: boolean;
  licenseUrl?: string;
  upgradeUrl?: string;
  defaultModel?: string;
  defaultEffort?: string;
  enabledSkills?: string[];
  canManageSkills?: boolean;
  unavailableReason?: string;
  retryPath?: string;
  skillUpload?: {
    maxBytes?: number;
    maxFiles?: number;
    maxSkills?: number;
  };
}

interface AgentSettingsAccount {
  type?: string;
  email?: string | null;
  planType?: string | null;
}

interface AgentSettingsLogin {
  url: string;
  userCode: string;
  loginId: string;
  deviceCode: boolean;
}

interface AgentSettingsFigmaStatus {
  installed: boolean;
  connected: boolean;
  connectUrl: string;
}

interface AgentSettingsHttpError extends Error {
  status?: number;
  code?: string;
  payload?: unknown;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}


function figmaStatus(value: unknown): AgentSettingsFigmaStatus {
  const status = object(value);
  return {
    installed: status.installed === true,
    connected: status.connected === true,
    connectUrl: text(status.connectUrl),
  };
}

function isFigmaSkill(name: string) {
  return /^figma(?:[-_:]|$)/i.test(name) || /figma/i.test(name);
}

function isKodetySkill(name: string) {
  return /kodety-editor/i.test(name);
}

function isUploadedSkill(skill: AgentSettingsSkill) {
  return /(?:^|[\\/])uploaded-skills(?:[\\/]|$)/i.test(skill.path || '');
}

function skillDisplayName(skill: AgentSettingsSkill) {
  return skill.interface?.displayName || skill.name;
}

function fileRelativePath(file: File, commonRoot: string) {
  const source = (file.webkitRelativePath || file.name).replaceAll('\\', '/').replace(/^\.\//, '');
  return commonRoot && source.startsWith(`${commonRoot}/`) ? source.slice(commonRoot.length + 1) : source;
}

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const marker = result.indexOf(',');
      resolve(marker >= 0 ? result.slice(marker + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function inferredSkillName(files: File[], commonRoot: string) {
  const root = commonRoot.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (root) return root.slice(0, 80);
  const manifest = files.find(file => fileRelativePath(file, commonRoot) === 'SKILL.md');
  return manifest?.name.replace(/\.md$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-') || '';
}

interface HtmlAgentSettingsProps {
  agentUrl?: string;
  nonce?: string;
  readOnly?: boolean;
  onUseMcp?: () => void;
  onAccountConnected?: () => void;
}

export function HtmlAgentSettings(props: HtmlAgentSettingsProps) {
  const host = useHtmlWorkspaceAgentHost();
  const agentRunning = useHtmlAgentEditorBridgeStore(state => Boolean(state.turnActivity));
  // A full WordPress page navigation would discard the WebContainer's OAuth
  // session. Authenticate inside the Editor document, where its chat also lives.
  if (host?.kind === 'wordpress' && host.execution?.selected === 'browser' && wordpressConfig()?.appView !== 'editor') {
    return <div className="space-y-8">
      <section>
        <h3 className="text-sm font-medium">Execução do Agent</h3>
        <div className="mt-3 max-w-sm">
          <HtmlSettingsSelectControl label="Execução do Agent" value="browser" allowUnset={false}
            options={[{ value: 'server', label: 'No servidor' }, { value: 'browser', label: 'No navegador' }]}
            disabled={props.readOnly || agentRunning || host.execution.changing}
            onChange={value => { if (value === 'server') void host.execution?.select('server'); }} />
        </div>
      </section>
      <section>
        <h3 className="text-sm font-medium">Conta OpenAI e Agente</h3>
        <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Conecte sua conta dentro do Builder para manter a conexão enquanto conversa com o Agent. Suas configurações serão salvas antes de abrir o editor.</p>
        <Button type="button" className="mt-4" disabled={props.readOnly || agentRunning || host.execution.changing}
          onClick={() => host.onOpenSettings('agents')}><ExternalLink /> Abrir Agent no Builder</Button>
      </section>
    </div>;
  }
  if (host?.agent && agentBrowserNotice()) return <HtmlAgentBrowserNotice />;
  return <ConnectedHtmlAgentSettings {...props} />;
}

function ConnectedHtmlAgentSettings({
  agentUrl: providedAgentUrl = '',
  nonce: providedNonce = '',
  readOnly = false,
  onUseMcp,
  onAccountConnected,
}: HtmlAgentSettingsProps) {
  const host = useHtmlWorkspaceAgentHost();
  const createBackend = host?.agent?.createBackend;
  const browserLicense = true;
  const browserLicenseRef = useRef(browserLicense);
  browserLicenseRef.current = browserLicense;
  const checkHostLicense = host?.checkLicense;
  const agentUrl = host?.agent?.key || providedAgentUrl;
  const nonce = host?.agent ? '' : providedNonce;
  const [config, setConfig] = useState<AgentSettingsConfig | null>(null);
  const licenseRequired = false;
  const [licenseChecking, setLicenseChecking] = useState(false);
  const licenseCheckingRef = useRef(false);
  const [licenseCheckMessage, setLicenseCheckMessage] = useState('');
  const capabilitiesRef = useRef<AgentBackendCapabilities>({});
  const agentRunning = useHtmlAgentEditorBridgeStore(state => Boolean(state.turnActivity));
  const [account, setAccount] = useState<AgentSettingsAccount | null>(null);
  const accountRef = useRef(account);
  accountRef.current = account;
  const [skills, setSkills] = useState<AgentSettingsSkill[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [figma, setFigma] = useState<AgentSettingsFigmaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [runtimeDiagnostic, setRuntimeDiagnostic] = useState<AgentRuntimeDiagnostic | null>(null);
  const [runtimeProgress, setRuntimeProgress] = useState<AgentRuntimeProgress | null>(null);
  const runtimeTransport = host?.agent || config?.transport === 'webcontainer' ? 'webcontainer' : config?.transport === 'remote' ? 'remote' : 'local';
  const runtimeBlockedByHosting = runtimeTransport === 'local' && isAgentRuntimeHostBlocked(runtimeDiagnostic);
  const runtimePreparationRef = useRef<AbortController | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [folderRoot, setFolderRoot] = useState('');
  const [skillName, setSkillName] = useState('');
  const [deleteCandidate, setDeleteCandidate] = useState('');
  const [figmaInstallConfirmation, setFigmaInstallConfirmation] = useState(false);
  const [accountSwitchConfirmation, setAccountSwitchConfirmation] = useState(false);
  const [accountLoginPending, setAccountLoginPending] = useState(false);
  const [accountLogin, setAccountLogin] = useState<AgentSettingsLogin | null>(null);
  const accountLoginRef = useRef<AgentSettingsLogin | null>(null);
  const accountPopupRef = useRef<Window | null>(null);
  const accountLoginInitiatedRef = useRef(false);
  const accountLoginGenerationRef = useRef(0);
  const accountConnectedCallbackRef = useRef(onAccountConnected);
  accountConnectedCallbackRef.current = onAccountConnected;
  const [accountPopupBlocked, setAccountPopupBlocked] = useState(false);
  const [accountPopupOpened, setAccountPopupOpened] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const figmaPollRef = useRef<number | null>(null);
  const accountObserverRef = useRef<{ stop: () => void } | null>(null);

  const transport = useMemo<AgentBackend>(() => {
    const callbacks: AgentBackendCallbacks = {
    onConfig: value => {
      capabilitiesRef.current = object(value.capabilities);
      setConfig(value as AgentSettingsConfig);
    },
    onDenied: cause => {
      accountObserverRef.current?.stop();
      if (figmaPollRef.current !== null) { window.clearTimeout(figmaPollRef.current); figmaPollRef.current = null; }
      setAccount(null);
      setSkills([]);
      setFigma(null);
      setBusy('');
      setAccountLoginPending(false);
      setAccountLogin(null);
      accountLoginRef.current = null;
      accountLoginInitiatedRef.current = false;
      accountLoginGenerationRef.current += 1;
      closeAgentAccountPopup(accountPopupRef.current);
      accountPopupRef.current = null;
      setConfig(current => ({ ...current, available: false, ...(/license|agent_disabled/.test(cause.code || '') ? { licenseRequired: true } : {}) }));
      setRuntimeDiagnostic(agentRuntimeFailure(cause));
    },
    };
    return createBackend ? createBackend(callbacks) : new AgentTransport({
      agentUrl, nonce,
      pageUrl: typeof window === 'undefined' ? 'http://localhost' : window.location.href,
      ...callbacks,
    });
  }, [agentUrl, nonce, createBackend]);
  useEffect(() => () => transport.cancelAll(), [transport]);
  const request = transport.request;

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}) => request('rpc', { body: { method, params } }), [request]);

  const loadSkills = useCallback(async () => {
    if (capabilitiesRef.current.skills === false) { setSkills([]); return []; }
    const result = object(await rpc('skills/list', { forceReload: true }));
    const next = list(result.data)
      .flatMap(entry => list(object(entry).skills))
      .map(value => object(value) as unknown as AgentSettingsSkill)
      .filter(skill => skill.name && skill.enabled !== false);
    setSkills(next);
    return next;
  }, [rpc]);

  const readAccount = useCallback(async (signal?: AbortSignal) => {
    const result = object(await request('rpc', { signal, body: { method: 'account/read', params: { refreshToken: false } } }));
    signal?.throwIfAborted();
    const candidate = object(result.account);
    const next = Object.keys(candidate).length ? (candidate as unknown as AgentSettingsAccount) : null;
    return next;
  }, [request]);

  const confirmAccount = useCallback((next: AgentSettingsAccount) => {
    const returnToChat = accountLoginInitiatedRef.current;
    accountLoginInitiatedRef.current = false;
    accountLoginRef.current = null;
    closeAgentAccountPopup(accountPopupRef.current);
    accountPopupRef.current = null;
    accountRef.current = next;
    setAccount(next);
    setAccountLoginPending(false);
    setAccountLogin(null);
    setAccountSwitchConfirmation(false);
    setAccountPopupBlocked(false);
    setAccountPopupOpened(false);
    notifyAgentAccountChanged(agentUrl, true);
    if (returnToChat) accountConnectedCallbackRef.current?.();
  }, [agentUrl]);

  useEffect(() => () => {
    closeAgentAccountPopup(accountPopupRef.current);
    accountPopupRef.current = null;
    const pendingLogin = accountLoginRef.current;
    accountLoginRef.current = null;
    accountLoginInitiatedRef.current = false;
    accountLoginGenerationRef.current += 1;
    if (pendingLogin?.loginId) void rpc('account/login/cancel', { loginId: pendingLogin.loginId }).catch(() => {});
  }, [rpc]);

  const loadFigma = useCallback(async () => {
    if (capabilitiesRef.current.figma === false) { setFigma(null); return null; }
    const result = figmaStatus(await rpc('figma/status', { forceRefresh: true }));
    setFigma(result);
    return result;
  }, [rpc]);

  const loadAll = useCallback(
    async (force = false) => {
      runtimePreparationRef.current?.abort();
      const controller = new AbortController();
      runtimePreparationRef.current = controller;
    setLoading(true);
      setRuntimeDiagnostic(null);
    setError('');
    try {
        const runtimeConfig = await prepareAgentRuntime(request, {
          force,
          signal: controller.signal,
          onProgress: setRuntimeProgress,
        });
        const loadedConfig = runtimeConfig as AgentSettingsConfig;
        capabilitiesRef.current = loadedConfig.capabilities || {};
      setConfig(loadedConfig);
      setEnabledSkills(list(loadedConfig.enabledSkills).map(text).filter(Boolean));
      if (loadedConfig.enabled === false || loadedConfig.licenseRequired === true) {
        setAccount(null);
        setSkills([]);
        setFigma(null);
        if (browserLicenseRef.current === true) throw agentRuntimeUnavailable(runtimeConfig);
        return false;
      }
        if (loadedConfig.available === false) {
          setAccount(null);
          setSkills([]);
          setFigma(null);
          throw agentRuntimeUnavailable(runtimeConfig);
        }
      const currentAccount = await readAccount(controller.signal);
      setAccount(currentAccount);
      if (!currentAccount) {
        // Browser skills belong to this workspace and are available before OAuth.
        if (loadedConfig.transport === 'webcontainer') void loadSkills().catch(() => undefined);
        else setSkills([]);
        setFigma(null);
        return true;
      }
      confirmAccount(currentAccount);
      // Optional integrations cannot invalidate or delay a confirmed login.
      void Promise.allSettled([loadSkills(), loadFigma()]);
      return true;
    } catch (cause) {
        if (!isAgentSetupAborted(cause)) {
          setConfig(current => current ? { ...current, available: false } : current);
          setAccount(null);
          setRuntimeDiagnostic(agentRuntimeFailure(cause));
        }
    } finally {
        if (!controller.signal.aborted) setLoading(false);
    }
    },
    [confirmAccount, readAccount, loadFigma, loadSkills, request],
  );

  useEffect(() => {
    void loadAll();
    return () => {
      runtimePreparationRef.current?.abort();
      if (figmaPollRef.current !== null) window.clearTimeout(figmaPollRef.current);
      accountObserverRef.current?.stop();
    };
  }, [browserLicense, loadAll]);

  useEffect(() => {
    let refreshing = false;
    const refreshLicense = () => {
      if (loading || busy || agentRunning || refreshing) return;
      refreshing = true;
      void loadAll().finally(() => { refreshing = false; });
    };
    const onReturn = () => {
      if ((config?.enabled === false || config?.licenseRequired === true) && document.visibilityState !== 'hidden') refreshLicense();
    };
    const onLicenseChange = () => { if (!createBackend) refreshLicense(); };
    window.addEventListener('focus', onReturn);
    window.addEventListener('pageshow', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('kodety:license-changed', onLicenseChange);
    return () => {
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('pageshow', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('kodety:license-changed', onLicenseChange);
    };
  }, [agentRunning, busy, config?.enabled, config?.licenseRequired, createBackend, loadAll, loading]);

  const changeTransport = useCallback(async (value: string) => {
    if (readOnly || agentRunning || busy || config?.transportOptions?.canChange !== true || !['local', 'remote'].includes(value)) return;
    if (value === config.transportOptions.selected) return;
    setBusy('transport');
    setError('');
    runtimePreparationRef.current?.abort();
    transport.cancelAll();
    try {
      const pendingLogin = accountLoginRef.current;
      accountLoginRef.current = null;
      accountLoginInitiatedRef.current = false;
      accountLoginGenerationRef.current += 1;
      closeAgentAccountPopup(accountPopupRef.current);
      accountPopupRef.current = null;
      setAccountLogin(null);
      setAccountLoginPending(false);
      setAccountPopupOpened(false);
      setAccountPopupBlocked(false);
      if (pendingLogin?.loginId) await rpc('account/login/cancel', { loginId: pendingLogin.loginId });
      await request('transport', { body: { transport: value } });
      setAccount(null);
      setSkills([]);
      setFigma(null);
      setAccountLoginPending(false);
      setAccountLogin(null);
      setAccountSwitchConfirmation(false);
      accountObserverRef.current?.stop();
      if (figmaPollRef.current !== null) { window.clearTimeout(figmaPollRef.current); figmaPollRef.current = null; }
      window.dispatchEvent(new CustomEvent('kodety-agent-transport-changed'));
      setBusy('');
      void loadAll();
    } catch (cause) {
      setBusy('');
      setError(cause instanceof Error ? cause.message : 'Não foi possível mudar a execução do Agent.');
    }
  }, [agentRunning, busy, config?.transportOptions, loadAll, readOnly, request, rpc, transport]);

  useEffect(() => {
    if (loading || busy || !config?.available || config.enabled === false || config.licenseRequired === true) return;
    const observer = observeAgentAccount({
      read: readAccount,
      poll: accountLoginPending,
      pollWhenHidden: accountLoginPending,
      onAccount: nextAccount => {
        setError(current => current === 'Não foi possível atualizar a conexão da conta.' ? '' : current);
        if (nextAccount) {
          const previousAccount = accountRef.current;
          accountRef.current = nextAccount;
          setAccount(nextAccount);
          if (accountLoginPending || !previousAccount) {
            confirmAccount(nextAccount);
            void Promise.allSettled([loadSkills(), loadFigma()]);
          }
        } else setAccount(null);
      },
      onError: cause => {
        if (!accountLoginPending && !isAgentSetupAborted(cause)) setError('Não foi possível atualizar a conexão da conta.');
      },
    });
    accountObserverRef.current = observer;
    observer.refresh();
    return () => {
      observer.stop();
      if (accountObserverRef.current === observer) accountObserverRef.current = null;
    };
  }, [accountLoginPending, busy, config?.available, config?.enabled, config?.licenseRequired, confirmAccount, loadFigma, loading, loadSkills, readAccount]);

  const connectOrSwitchAccount = useCallback(async () => {
    if (busy || accountLoginPending || accountLoginInitiatedRef.current || readOnly || agentRunning) return;
    accountLoginInitiatedRef.current = true;
    const loginGeneration = ++accountLoginGenerationRef.current;
    const isCurrentLogin = () => accountLoginGenerationRef.current === loginGeneration;
    setAccountPopupBlocked(false);
    setAccountPopupOpened(false);
    setBusy('account');
    setAccountLoginPending(true);
    setRuntimeDiagnostic(null);
    setError('');
    try {
      if (!account) {
        const runtimeConfig = await prepareAgentRuntime(request, { force: true, onProgress: setRuntimeProgress });
        if (!isCurrentLogin()) return;
        capabilitiesRef.current = object(runtimeConfig.capabilities);
        setConfig(runtimeConfig as AgentSettingsConfig);
        if (runtimeConfig.enabled === false || runtimeConfig.licenseRequired === true) {
          throw agentRuntimeUnavailable(runtimeConfig);
        }
        if (runtimeConfig.available === false) throw agentRuntimeUnavailable(runtimeConfig);
        const existingAccount = await readAccount();
        if (!isCurrentLogin()) return;
        if (existingAccount) {
          confirmAccount(existingAccount);
          void Promise.allSettled([loadSkills(), loadFigma()]);
          return;
        }
      }
      if (account) {
        await rpc('account/logout');
        if (!isCurrentLogin()) return;
        setAccount(null);
        setSkills([]);
        setFigma(null);
        notifyAgentAccountChanged(agentUrl, false);
      }
      const result = object(await rpc('account/login/start'));
      if (!isCurrentLogin()) {
        const staleLoginId = text(result.loginId);
        if (staleLoginId) void rpc('account/login/cancel', { loginId: staleLoginId }).catch(() => {});
        return;
      }
      const userCode = text(result.userCode);
      const deviceCode = result.type === 'chatgptDeviceCode' || Boolean(userCode);
      const destination = agentAccountLoginUrl(deviceCode ? result.verificationUrl || result.authUrl : result.authUrl || result.verificationUrl);
      if (!destination || deviceCode && !userCode) throw Object.assign(new Error('O App Server não retornou uma URL oficial de autenticação.'), { code: 'agent_login_invalid_url' });
      const login = { url: destination, userCode, loginId: text(result.loginId), deviceCode };
      accountLoginRef.current = login;
      setAccountLogin(login);
      // Device authorization is deliberately two steps: render the code first.
      // Non-device OAuth still opens its authorization URL once it is available.
      if (!deviceCode) {
        accountPopupRef.current = openAgentAccountLoginPage(destination);
        setAccountPopupBlocked(!accountPopupRef.current);
        setAccountPopupOpened(Boolean(accountPopupRef.current));
      }
    } catch (cause) {
      if (!isCurrentLogin()) return;
      accountLoginInitiatedRef.current = false;
      accountLoginRef.current = null;
      setAccountLogin(null);
      setAccountLoginPending(false);
      setRuntimeDiagnostic(agentRuntimeFailure(cause));
    } finally {
      if (isCurrentLogin()) setBusy('');
    }
  }, [account, accountLoginPending, agentRunning, busy, config?.transportOptions, agentUrl, confirmAccount, loadFigma, loadSkills, readAccount, readOnly, request, rpc, transport]);

  const continueAccountLogin = useCallback(() => {
    if (busy || readOnly || agentRunning || !accountLoginRef.current) return;
    // Repeated clicks replace only the tab created by this settings instance.
    closeAgentAccountPopup(accountPopupRef.current);
    accountPopupRef.current = openAgentAccountLoginPage(accountLoginRef.current.url);
    setAccountPopupBlocked(!accountPopupRef.current);
    setAccountPopupOpened(Boolean(accountPopupRef.current));
  }, [agentRunning, busy, readOnly]);

  const cancelAccountLogin = useCallback(async () => {
    if (busy) return;
    const pendingLogin = accountLoginRef.current;
    accountLoginRef.current = null;
    accountLoginInitiatedRef.current = false;
    accountLoginGenerationRef.current += 1;
    closeAgentAccountPopup(accountPopupRef.current);
    accountPopupRef.current = null;
    setAccountLogin(null);
    setAccountLoginPending(false);
    setAccountPopupBlocked(false);
    setAccountPopupOpened(false);
    if (!pendingLogin?.loginId) return;
    setBusy('cancel-account');
    try { await rpc('account/login/cancel', { loginId: pendingLogin.loginId }); }
    catch { setError('Não foi possível cancelar a solicitação na OpenAI. Se o código ainda estiver aberto, não conclua a autorização.'); }
    finally { setBusy(''); }
  }, [busy, rpc]);

  const saveEnabledSkills = useCallback(
    async (next: string[]) => {
    setEnabledSkills(next);
    try {
      const saved = await request('config', {
        body: {
          model: config?.defaultModel,
          effort: config?.defaultEffort,
          enabledSkills: next,
        },
      });
      const savedConfig = object(saved);
      setConfig(current => ({
        ...(current || {}),
        defaultModel: text(savedConfig.defaultModel) || current?.defaultModel,
        defaultEffort: text(savedConfig.defaultEffort) || current?.defaultEffort,
        enabledSkills: list(savedConfig.enabledSkills).map(text).filter(Boolean),
      }));
        window.dispatchEvent(
          new CustomEvent('kodety-agent-preferences-changed', {
            detail: saved,
          }),
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as skills ativas.');
      await loadAll();
    }
    },
    [config?.defaultEffort, config?.defaultModel, loadAll, request],
  );

  const pollFigma = useCallback(() => {
    if (figmaPollRef.current !== null) window.clearTimeout(figmaPollRef.current);
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const status = await loadFigma();
        if (!status || status.connected) {
          await loadSkills();
          return;
        }
      } catch {
        // OAuth can briefly race App Server discovery.
      }
      if (attempts < 90) figmaPollRef.current = window.setTimeout(() => void poll(), 2000);
    };
    figmaPollRef.current = window.setTimeout(() => void poll(), 1200);
  }, [loadFigma, loadSkills]);

  const installFigma = useCallback(
    async (confirmed = false) => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setBusy('figma');
    setError('');
    try {
      const result = object(await rpc('figma/install', { confirmed }));
      const rawStatus = Object.keys(object(result.status)).length ? result.status : result;
      const status = figmaStatus(rawStatus);
      const authApp = object(list(object(result.install).appsNeedingAuth)[0]);
        const nextStatus = {
          ...status,
          connectUrl: status.connectUrl || text(authApp.installUrl),
        };
      setFigma(nextStatus);
      setFigmaInstallConfirmation(false);
        await loadSkills().catch(() => []);
      if (!nextStatus.connected && nextStatus.connectUrl) {
        if (popup) popup.location.href = nextStatus.connectUrl;
        else window.open(nextStatus.connectUrl, '_blank', 'noopener,noreferrer');
        pollFigma();
      } else popup?.close();
    } catch (cause) {
      popup?.close();
      const requestError = cause as AgentSettingsHttpError;
      if (requestError?.status === 409 && !confirmed) setFigmaInstallConfirmation(true);
      else setError(cause instanceof Error ? cause.message : 'Não foi possível instalar o Figma oficial.');
    } finally {
      setBusy('');
    }
    },
    [loadSkills, pollFigma, rpc],
  );

  const chooseFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files || []).filter(file => !/(?:^|[\\/])\.DS_Store$/i.test(file.webkitRelativePath || file.name));
    const roots = nextFiles.map(file => (file.webkitRelativePath || '').replaceAll('\\', '/').split('/')[0]).filter(Boolean);
    const commonRoot = roots.length && roots.every(root => root === roots[0]) ? roots[0] : '';
    setFolderFiles(nextFiles);
    setFolderRoot(commonRoot);
    setSkillName(inferredSkillName(nextFiles, commonRoot));
    setError('');
  };

  const uploadSkill = async () => {
    const normalizedName = skillName.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalizedName)) {
      setError('Use um nome de skill com letras, números, ponto, hífen ou underline.');
      return;
    }
    const paths = folderFiles.map(file => fileRelativePath(file, folderRoot));
    if (!paths.includes('SKILL.md')) {
      setError('Escolha uma pasta cuja raiz contenha SKILL.md.');
      return;
    }
    setBusy('upload');
    setError('');
    try {
      const files = await Promise.all(
        folderFiles.map(async file => ({
        path: fileRelativePath(file, folderRoot),
        contentBase64: await fileAsBase64(file),
        })),
      );
      await request('skills', { body: { name: normalizedName, files } });
      const nextSkills = await loadSkills();
      await saveEnabledSkills([...new Set([...enabledSkills, normalizedName])]);
      setSkills(nextSkills);
      setFolderFiles([]);
      setFolderRoot('');
      setSkillName('');
      if (folderInputRef.current) folderInputRef.current.value = '';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível instalar a skill.');
    } finally {
      setBusy('');
    }
  };

  const deleteSkill = async (name: string) => {
    setBusy(`delete:${name}`);
    setError('');
    try {
      await request('skills', { method: 'DELETE', body: { name } });
      setDeleteCandidate('');
      await saveEnabledSkills(enabledSkills.filter(candidate => candidate !== name));
      await loadSkills();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível remover a skill.');
    } finally {
      setBusy('');
    }
  };

  if (loading && !config) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
        <p className="flex items-center">
        <Loader2 className="mr-2 size-4 animate-spin" /> Carregando agentes…
        </p>
        {runtimeProgress && <HtmlAgentRuntimeStatus className="w-full max-w-md" progress={runtimeProgress} diagnostic={null} active />}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="agent-execution-label">
        <h3 id="agent-execution-label" className="text-sm font-medium">Execução do Agent</h3>
        {host?.execution ? <>
          <div className="mt-3 max-w-sm">
            <HtmlSettingsSelectControl
              label="Execução do Agent"
              value={host.execution.selected}
              options={[{ value: 'server', label: 'No servidor' }, { value: 'browser', label: 'No navegador' }]}
              allowUnset={false}
              disabled={readOnly || agentRunning || accountLoginPending || Boolean(busy) || host.execution.changing}
              onChange={value => { if (value === 'server' || value === 'browser') void host.execution?.select(value); }}
            />
          </div>
          <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
            {host.execution.selected === 'browser'
              ? 'O Agent executa neste navegador. Mantenha o Builder aberto durante o trabalho.'
              : 'O Agent executa nesta hospedagem. Se ela não oferecer os recursos necessários, escolha No navegador.'}
          </p>
          <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">
            A troca salva seu trabalho e recarrega o Builder. A conta e o histórico ficam separados em cada ambiente.
            {agentRunning && ' Finalize a tarefa em andamento antes de trocar o ambiente.'}
          </p>
        </> : host?.agent ? <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
          O Agent executa neste navegador. Mantenha o Builder aberto durante o trabalho.
        </p> : <>
        <div className="mt-3 max-w-sm">
          <HtmlSettingsSelectControl
            label="Execução do Agent"
            value={config?.transportOptions?.selected || config?.transport || 'local'}
            options={[
              { value: 'local', label: 'Neste servidor' },
            ]}
            allowUnset={false}
            disabled={readOnly || agentRunning || Boolean(busy) || config?.transportOptions?.canChange !== true}
            onChange={value => void changeTransport(value)}
          />
        </div>
        <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
          O Agent roda nesta hospedagem. Você também pode conectar um cliente externo por MCP.
        </p>
        <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">
          A escolha vale para este site. A conta conectada e o histórico ficam separados em cada ambiente.
          {config?.transportOptions?.canChange !== true && ' Esta configuração é gerenciada pelo administrador do site.'}
          {agentRunning && ' Finalize a tarefa em andamento antes de trocar o ambiente.'}
        </p>
        </>}
      </section>
      <section>
        {config?.historyWarning && <p role="status" className="mb-4 max-w-xl rounded-lg border border-amber-400/15 bg-amber-400/[.04] px-3 py-2 text-xs leading-5 text-muted-foreground">{config.historyWarning}</p>}
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Conta OpenAI e Agente</h3>
              <span className={cn('text-[11px]', config?.available ? 'text-emerald-400' : 'text-amber-400')}>
                {loading ? 'Conectando…' : config?.available && !runtimeDiagnostic ? 'Pronto' : 'Precisa de atenção'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              O Agente usa a conta OpenAI de cada pessoa e trabalha diretamente no projeto aberto no editor.
            </p>
            <HtmlAgentRuntimeStatus
              className="mt-3 max-w-xl"
              progress={runtimeProgress}
              diagnostic={runtimeDiagnostic}
              transport={runtimeTransport}
              browserStudio={Boolean(host && host.kind !== 'wordpress') || wordpressConfig()?.studio?.enabled === true}
              active={loading || busy === 'account'}
              onUseBrowser={runtimeBlockedByHosting && host?.execution?.selected === 'server' && !readOnly && !agentRunning ? () => void host.execution?.select('browser') : undefined}
              cloudBusy={busy === 'transport' || busy === 'account' || host?.execution?.changing}
              onUseMcp={runtimeBlockedByHosting ? onUseMcp || (host ? () => host.onOpenSettings('mcp') : undefined) : undefined}
              onConfigure={host ? () => host.onOpenSettings('agents') : wordpressConfig()?.settingsUrl ? () => window.location.assign(wordpressConfig()?.settingsUrl || '') : undefined}
            />
          </div>
          {!runtimeBlockedByHosting && (
          <Button type="button" size="sm" variant="ghost" disabled={loading || busy === 'account' || accountLoginPending} onClick={() => void loadAll(true)}>
            <RefreshCw /> {config?.available ? 'Atualizar' : 'Tentar novamente'}
          </Button>
          )}
        </div>
        {accountLogin && agentAccountLoginUrl(accountLogin.url) && (
          accountLogin.deviceCode ? <HtmlAgentDeviceCodeCard
            userCode={accountLogin.userCode}
            verificationUrl={accountLogin.url}
            onContinue={continueAccountLogin}
            onCancel={() => void cancelAccountLogin()}
            disabled={Boolean(busy) || readOnly || agentRunning}
            opened={accountPopupOpened}
            popupBlocked={accountPopupBlocked}
          /> : <div className="mt-4 space-y-3 text-xs leading-5">
            {accountPopupBlocked && <p role="status" className="text-muted-foreground">A janela não abriu. Continue pelo link oficial.</p>}
            <Button type="button" size="sm" onClick={continueAccountLogin}><ExternalLink />Continuar na OpenAI</Button>
            {accountPopupBlocked && <a href={accountLogin.url} target="_blank" rel="noopener noreferrer" className="ml-3 font-medium text-foreground underline underline-offset-4">Abrir login oficial da OpenAI</a>}
            <Button type="button" size="sm" variant="ghost" onClick={() => void cancelAccountLogin()}>Cancelar conexão</Button>
          </div>
        )}
        {!config?.available && (runtimeTransport === 'remote' || runtimeTransport === 'webcontainer') && !account && (
          <Button type="button" size="sm" className="mt-4" disabled={loading || Boolean(busy) || accountLoginPending || readOnly || agentRunning} onClick={() => void connectOrSwitchAccount()}>
            <Link2 /> Conectar conta OpenAI
          </Button>
        )}
        {config?.available && (
          <div data-kodety-settings-card className="mt-4 p-4">
            {accountSwitchConfirmation && account ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">Trocar a conta OpenAI conectada?</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    O Agent será desconectado de {account.email || 'esta conta'} e preparará a conexão de outra conta. Modelo e skills
                    selecionados serão preservados.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAccountSwitchConfirmation(false)}>
                    Cancelar
                  </Button>
                  <Button type="button" size="sm" disabled={loading || busy === 'account' || accountLoginPending} onClick={() => void connectOrSwitchAccount()}>
                    {busy === 'account' || accountLoginPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {accountLoginPending ? 'Aguardando login…' : 'Trocar conta'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{account?.email || (account ? 'Conta OpenAI conectada' : 'Nenhuma conta conectada')}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {account
                      ? [account.type, account.planType].filter(Boolean).join(' · ') || 'Autenticação oficial do Codex'
                      : 'Conecte uma conta para usar o Agent neste editor.'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={account ? 'secondary' : 'default'}
                  disabled={loading || busy === 'account' || accountLoginPending}
                  onClick={() => (account ? setAccountSwitchConfirmation(true) : void connectOrSwitchAccount())}
                >
                  {busy === 'account' || accountLoginPending ? <Loader2 className="animate-spin" /> : account ? <RefreshCw /> : <Link2 />}
                  {accountLoginPending ? 'Aguardando login…' : account ? 'Trocar conta' : 'Conectar conta'}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {config?.capabilities?.figma !== false && <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Figma oficial</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Combine o contexto do Figma com a skill Onun Kodety no mesmo turno.</p>
          </div>
          <span className={cn('flex items-center gap-1 text-[11px]', figma?.connected ? 'text-emerald-400' : 'text-muted-foreground')}>
            {figma?.connected && <CheckCircle2 className="size-3" />}
            {figma?.connected ? 'Conectado' : figma?.installed ? 'Instalado' : 'Não instalado'}
          </span>
        </div>
        <div data-kodety-settings-card className="mt-4 p-4">
          {figmaInstallConfirmation ? (
            <div>
              <p className="text-xs font-medium">Confirmar instalação do plugin oficial?</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">A integração precisa desta confirmação antes de instalar o Figma.</p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setFigmaInstallConfirmation(false)}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" disabled={busy === 'figma'} onClick={() => void installFigma(true)}>
                  {busy === 'figma' ? <Loader2 className="animate-spin" /> : <Link2 />} Confirmar instalação
                </Button>
              </div>
            </div>
          ) : !figma?.installed ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] leading-5 text-muted-foreground">A instalação é opcional e não bloqueia o chat do Agente.</p>
              <Button type="button" size="sm" disabled={busy === 'figma'} onClick={() => void installFigma()}>
                {busy === 'figma' ? <Loader2 className="animate-spin" /> : <Link2 />} Instalar Figma oficial
              </Button>
            </div>
          ) : !figma.connected && figma.connectUrl ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] leading-5 text-muted-foreground">Autorize sua conta para disponibilizar as ferramentas do Figma.</p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  window.open(figma.connectUrl, '_blank', 'noopener,noreferrer');
                  pollFigma();
                }}
              >
                <ExternalLink /> Conectar Figma
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 text-xs text-emerald-300">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-4" /> Figma pronto para o Agente
              </span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Atualizar Figma" onClick={() => void loadFigma()}>
                <RefreshCw />
              </Button>
            </div>
          )}
        </div>
      </section>}

      {config?.capabilities?.skills !== false && <><section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Skills instaladas</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Ative várias skills para o mesmo turno. Onun Kodety permanece disponível como capacidade nativa do editor.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">{skills.length} skills</span>
        </div>
        <div className="mt-4 space-y-1">
          {skills.map(skill => {
            const enabled = enabledSkills.includes(skill.name);
            const uploaded = isUploadedSkill(skill);
            return (
              <div key={skill.name} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <HtmlSettingsToggleControl
                    label={skillDisplayName(skill)}
                    description={[
                      skill.interface?.shortDescription || skill.shortDescription || skill.description || skill.name,
                      isFigmaSkill(skill.name) || isKodetySkill(skill.name) ? 'Padrão' : '',
                      uploaded ? 'Upload local' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    checked={enabled}
                    disabled={readOnly || isKodetySkill(skill.name)}
                    onChange={() =>
                      void saveEnabledSkills(
                        enabled ? enabledSkills.filter(name => name !== skill.name) : [...new Set([...enabledSkills, skill.name])],
                      )
                    }
                    kind="code"
                  />
                </div>
                {uploaded &&
                  (deleteCandidate === skill.name ? (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" size="xs" variant="ghost" onClick={() => setDeleteCandidate('')}>
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        disabled={busy === `delete:${skill.name}`}
                        onClick={() => void deleteSkill(skill.name)}
                      >
                        {busy === `delete:${skill.name}` ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Excluir ${skill.name}`}
                      onClick={() => setDeleteCandidate(skill.name)}
                    >
                      <Trash2 />
                    </Button>
                  ))}
              </div>
            );
          })}
          {!skills.length && <p className="py-5 text-xs text-muted-foreground">Nenhuma skill foi encontrada para esta conta.</p>}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium">Adicionar skill local</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Escolha uma pasta com SKILL.md na raiz. Os arquivos são enviados apenas ao espaço privado desta conta.
        </p>
        <div data-kodety-settings-card className="mt-4 p-4">
          <input
            ref={node => {
              folderInputRef.current = node;
              if (node) {
                node.setAttribute('webkitdirectory', '');
                node.setAttribute('directory', '');
              }
            }}
            type="file"
            multiple
            className="hidden"
            onChange={event => void chooseFolder(event)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => folderInputRef.current?.click()}>
              <FolderOpen /> Escolher pasta
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {folderFiles.length ? `${folderRoot || 'Skill'} · ${folderFiles.length} arquivo(s)` : 'Nenhuma pasta selecionada'}
            </span>
          </div>
          {folderFiles.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="text-[11px] text-muted-foreground">
                Nome da skill
                <div className="mt-1">
                  <ProjectSettingsFieldControl label="Nome da skill">
                    <Input value={skillName} onChange={event => setSkillName(event.target.value)} placeholder="minha-skill" />
                  </ProjectSettingsFieldControl>
                </div>
              </label>
              <Button type="button" disabled={busy === 'upload' || readOnly || config?.canManageSkills === false} onClick={() => void uploadSkill()}>
                {busy === 'upload' ? <Loader2 className="animate-spin" /> : <Upload />} Instalar skill
              </Button>
            </div>
          )}
          {config?.skillUpload && (
            <p className="mt-3 text-[10px] text-muted-foreground">
              Limite: {Math.round((config.skillUpload.maxBytes || 0) / 1024 / 1024) || 5} MB · até {config.skillUpload.maxFiles || 100} arquivos por
              skill.
            </p>
          )}
        </div>
      </section></>}

      {error && (
        <div role="alert" className="border-y border-red-400/20 py-3 text-xs text-red-300">
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
