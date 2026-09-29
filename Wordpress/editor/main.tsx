import React, { Suspense, lazy } from 'react';
import { WordPressBuilderOnboarding } from './WordPressBuilderOnboarding';
import { WordPressAgentProvider } from './WordPressAgentProvider';
import browserAgentRuntimeUrl from 'virtual:kodety-browser-agent-runtime';
import { createRoot } from 'react-dom/client';
import { KodetyLoadingScreen } from '../../components/ui/kodety-loading-screen';
import { installFontLibraryTransport } from '../../lib/editor-platform-services';
import {
  startLocalizationProjectPrefetch,
  wordpressEntryAppView,
  wordpressEntryConfig,
  wordpressEntryEditorLockEnabled,
} from './wordpress-entry-config';
import {
  consumeEditorLockHandoff,
  interceptEditorLockWorkspaceNavigation,
} from './editor-lock-navigation';
import {
  initializeWordPressObservability,
  KODETY_OPERATION_HEADER,
} from './wordpress-observability';
import { createWordPressFontLibraryTransport } from './wordpress-font-library-transport';
import { installWordPressProjectObservabilityBridge } from './wordpress-project-observability';
import { installWordPressTrialRuntime } from './wordpress-trial-runtime';
import { useWordPressLicenseRevision, WordPressTrialNotice } from './WordPressTrialNotice';
import '../../app/globals.css';
import './wordpress-editor.css';

const bootstrapConfig = wordpressEntryConfig();
const performanceDebug = initializeWordPressObservability(
  bootstrapConfig?.performanceDebug,
  bootstrapConfig,
);
const configSpan = performanceDebug.begin('config');
const entryConfig = wordpressEntryConfig();
// The private Languages entry reuses the core asset URL; it must not emit or
// try to fetch its own runtime bundle through a protected JavaScript chunk URL.
if (entryConfig?.agentBrowser) entryConfig.agentBrowser.runtimeUrl = browserAgentRuntimeUrl;
performanceDebug.finish(configSpan, { result: entryConfig ? 'ok' : 'error' });
installWordPressProjectObservabilityBridge(performanceDebug);
const bootstrapSpan = performanceDebug.begin('bootstrap');
const mountSpan = performanceDebug.begin('mount');
const appView = wordpressEntryAppView(entryConfig);

const finishEditorMountOnVisualReady = (event: MessageEvent) => {
  if (
    appView !== 'editor'
    || !event.data
    || typeof event.data !== 'object'
    || event.data.type !== 'html-editor-buffer-visuals-ready'
  ) return;
  const ownedFrame = Array.from(document.querySelectorAll('iframe')).some(
    frame => frame.contentWindow === event.source,
  );
  if (!ownedFrame) return;
  performanceDebug.finish(mountSpan, { result: 'ok' });
  window.removeEventListener('message', finishEditorMountOnVisualReady);
};
if (appView === 'editor') {
  window.addEventListener('message', finishEditorMountOnVisualReady);
}

document.documentElement.classList.add('dark');
document.body.classList.add('kodety-wordpress-editor');
const editorLockEnabled = wordpressEntryEditorLockEnabled(entryConfig);
// Older cached shells may still advertise a lease on every workspace.
if (!editorLockEnabled && entryConfig) entryConfig.editorLockUrl = '';
let editorSession = '';
let editorLease = '';
const editorWindow = window as typeof window & {
  kodetyEditorSession?: string;
  kodetyEditorLease?: string;
};
const handoffSession = consumeEditorLockHandoff();
if (editorLockEnabled) {
  // Never persist this identifier: browsers can clone sessionStorage when a
  // tab is duplicated, which would let two documents impersonate one editor.
  editorSession = handoffSession;
  if (!editorSession) {
    editorSession = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
  editorLease = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  editorWindow.kodetyEditorSession = editorSession;
  editorWindow.kodetyEditorLease = editorLease;
} else {
  delete editorWindow.kodetyEditorSession;
  delete editorWindow.kodetyEditorLease;
}
document.addEventListener('click', interceptEditorLockWorkspaceNavigation);
const shareToken = (
  window as typeof window & {
    kodetyWordPress?: { share?: { active?: boolean; token?: string; mode?: 'view' | 'edit'; invitation?: { token?: string } | null } };
  }
).kodetyWordPress?.share?.token;
const invitationToken = (
  window as typeof window & {
    kodetyWordPress?: { share?: { invitation?: { token?: string } | null } };
  }
).kodetyWordPress?.share?.invitation?.token
  || new URLSearchParams(window.location.search).get('kodety_invite')
  || '';
if (shareToken) {
  document.documentElement.dataset.kodetyShared = 'true';
  document.body.dataset.kodetyShareMode = (
    window as typeof window & {
      kodetyWordPress?: { share?: { mode?: 'view' | 'edit' } };
    }
  ).kodetyWordPress?.share?.mode || 'view';
}
const nativeFetch = window.fetch.bind(window);
let restSessionRefresh: Promise<string | null> | null = null;
const refreshRestSession = () => {
  if (restSessionRefresh) return restSessionRefresh;
  const endpoint = entryConfig?.restNonceUrl || '';
  if (!endpoint) return Promise.resolve(null);
  const refreshHeaders = new Headers({ 'X-Requested-With': 'XMLHttpRequest' });
  if (shareToken) refreshHeaders.set('X-Kodety-Share', shareToken);
  if (invitationToken) refreshHeaders.set('X-Kodety-Invite', invitationToken);
  restSessionRefresh = nativeFetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: refreshHeaders,
  })
    .then(async response => {
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { nonce?: string; projectDownloadUrl?: string };
      } | null;
      const nonce = response.ok && payload?.success ? payload.data?.nonce?.trim() || '' : '';
      if (!nonce || !entryConfig) return null;
      entryConfig.nonce = nonce;
      if (payload?.data?.projectDownloadUrl) {
        entryConfig.projectDownloadUrl = payload.data.projectDownloadUrl;
      }
      return nonce;
    })
    .catch(() => null)
    .finally(() => {
      restSessionRefresh = null;
    });
  return restSessionRefresh;
};
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(requestUrl, window.location.href);
  if (url.origin !== window.location.origin) return nativeFetch(input, init);
  const requestTemplate = input instanceof Request ? input.clone() : input;
  const initialHeaders = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => initialHeaders.set(key, value));
  const observedRequest = performanceDebug.enabled
    ? (() => {
        const requestMethod = (
          init?.method
          || (input instanceof Request ? input.method : 'GET')
        ).toUpperCase();
        const correlationCandidate = initialHeaders.get(KODETY_OPERATION_HEADER);
        const observed = performanceDebug.startRequest(
          requestUrl,
          requestMethod,
          correlationCandidate,
        );
        if (observed) initialHeaders.set(KODETY_OPERATION_HEADER, observed.operationId);
        return observed;
      })()
    : null;
  const carriesRestNonce = initialHeaders.has('X-WP-Nonce');
  const execute = (renewedNonce?: string) => {
    const headers = new Headers(initialHeaders);
    const activeRestNonce = renewedNonce || entryConfig?.nonce || '';
    if (carriesRestNonce && activeRestNonce) headers.set('X-WP-Nonce', activeRestNonce);
    if (editorLockEnabled) {
      if (!headers.has('X-Kodety-Editor-Session')) {
        headers.set('X-Kodety-Editor-Session', editorSession);
      }
      if (!headers.has('X-Kodety-Editor-Lease')) {
        headers.set('X-Kodety-Editor-Lease', editorWindow.kodetyEditorLease || editorLease);
      }
    }
    if (shareToken) headers.set('X-Kodety-Share', shareToken);
    if (invitationToken) headers.set('X-Kodety-Invite', invitationToken);
    return nativeFetch(requestTemplate instanceof Request ? requestTemplate.clone() : requestTemplate, {
      ...init,
      headers,
    });
  };
  try {
    let response = await execute();
    if (carriesRestNonce && entryConfig?.restNonceUrl && response.status === 403) {
      const failure = (await response.clone().json().catch(() => null)) as { code?: string } | null;
      if (failure?.code === 'rest_cookie_invalid_nonce') {
        const renewedNonce = await refreshRestSession();
        if (renewedNonce) {
          observedRequest?.retry();
          response = await execute(renewedNonce);
        }
      }
    }
    void observedRequest?.settle(response);
    return response;
  } catch (error) {
    observedRequest?.fail(error instanceof Error && error.name === 'AbortError');
    throw error;
  }
};

const wordpressFontLibraryTransport = createWordPressFontLibraryTransport({
  googleFontsUrl: entryConfig?.googleFontsUrl,
  adobeFontsUrl: entryConfig?.adobeFontsUrl,
  adobeFontsSyncUrl: entryConfig?.adobeFontsSyncUrl,
  mediaUploadUrl: entryConfig?.mediaUploadUrl,
  nonce: entryConfig?.nonce,
}, {
  fetch: (input, init) => window.fetch(input, init),
  storage: {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  },
});
installFontLibraryTransport(wordpressFontLibraryTransport);

const HtmlProjectEditor = lazy(() =>
  import('../../app/(builder)/kodety/html-editor/components/HtmlProjectEditor'),
);
const WordPressCmsWorkspace = lazy(() => import('./WordPressCmsWorkspace'));
const WordPressSettingsWorkspace = lazy(() => import('./WordPressSettingsWorkspace'));
const WordPressAnalyticsWorkspace = lazy(() => import('./WordPressAnalyticsWorkspace'));

function WordPressEntry() {
  useWordPressLicenseRevision();
  React.useEffect(() => {
    if (appView !== 'editor') performanceDebug.finish(mountSpan, { result: 'ok' });
  }, []);
  const workspace = appView === 'cms' ? <WordPressCmsWorkspace />
    : appView === 'settings' || appView === 'kodefy' ? <WordPressSettingsWorkspace />
      : appView === 'analytics' ? <WordPressAnalyticsWorkspace />
        : <HtmlProjectEditor runtime="wordpress" />;
  return <WordPressAgentProvider>{workspace}<WordPressTrialNotice /><WordPressBuilderOnboarding config={entryConfig} /></WordPressAgentProvider>;
}

installWordPressTrialRuntime();
const rootElement = document.getElementById('kodety-root')!;
if (appView === 'localization') {
  const extensionEntry = entryConfig?.localizationEntryUrl || '';
  const extensionStyle = entryConfig?.localizationStyleUrl || '';
  if (extensionEntry) {
    // Do not make the large, private extension assets and the project archive
    // wait for one another. The PHP shell already preloads both extension
    // assets; this starts the authenticated project transport in parallel.
    startLocalizationProjectPrefetch(entryConfig);
    const styleReady = extensionStyle
      ? new Promise<void>((resolve, reject) => {
          const selector = 'link[data-kodety-localization-style]';
          const resolvedHref = new URL(extensionStyle, window.location.href).href;
          const existing = document.querySelector<HTMLLinkElement>(selector);
          if (existing?.href === resolvedHref) {
            if (existing.sheet) {
              resolve();
              return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Não foi possível carregar os estilos da extensão Multi-language.')), { once: true });
            return;
          }
          existing?.remove();
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = resolvedHref;
          link.dataset.kodetyLocalizationStyle = 'true';
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => reject(new Error('Não foi possível carregar os estilos da extensão Multi-language.')), { once: true });
          document.head.appendChild(link);
        })
      : Promise.resolve();
    type LocalizationEntryModule = { mountLocalization?: () => void };
    const extensionWindow = window as typeof window & {
      kodetyLocalizationManualMount?: boolean;
      kodetyMountLocalization?: () => void;
    };
    // New extension bundles wait for this shell to confirm that their CSS is
    // ready. Older bundles ignore the flag and retain their auto-mount path.
    extensionWindow.kodetyLocalizationManualMount = true;
    const entryReady = import(/* @vite-ignore */ extensionEntry) as Promise<LocalizationEntryModule>;
    Promise.all([styleReady, entryReady])
      .then(([, extensionModule]) => {
        const mount = extensionModule.mountLocalization || extensionWindow.kodetyMountLocalization;
        if (!mount) throw new Error('A extensão Multi-language não expôs sua montagem.');
        mount();
        performanceDebug.finish(mountSpan, { result: 'ok' });
      })
      .catch(() => {
        performanceDebug.finish(mountSpan, { result: 'error' });
        createRoot(rootElement).render(
          <KodetyLoadingScreen label="Não foi possível carregar a extensão Multi-language" className="h-screen min-h-0" />,
        );
      });
  } else {
    performanceDebug.finish(mountSpan, { result: 'skipped' });
    createRoot(rootElement).render(
      <KodetyLoadingScreen label="Instale e ative a extensão Multi-language" className="h-screen min-h-0" />,
    );
  }
} else {
  createRoot(rootElement).render(
    <React.StrictMode>
      <Suspense fallback={<KodetyLoadingScreen label="Carregando Onun Kodety" className="h-screen min-h-0" />}>
        <WordPressEntry />
      </Suspense>
    </React.StrictMode>,
  );
}
performanceDebug.finish(bootstrapSpan, { result: 'ok' });
