export type KodetyWordPressAppView =
  | 'editor'
  | 'cms'
  | 'settings'
  | 'localization'
  | 'templates'
  | 'analytics'
  | 'members'
  | 'kodefy';

export interface KodetyWordPressEntryConfig {
  edition?: 'pro';
  product?: {
    edition: 'pro';
    licensed: boolean;
    licenseStatus?: string;
    licensePlan?: string;
    licenseIsTrial?: boolean;
    licenseTrialExpired?: boolean;
    licenseExpiresAt?: string;
    licenseServerTime?: string;
    licenseStatusUrl?: string;
    unlicensedFeatures?: Record<string, boolean>;
    unlicensedLimits?: Record<string, number | null>;
    features: Record<string, boolean>;
    limits: Record<string, number | null>;
    upgradeUrl: string;
    licenseUrl: string;
  };
  appView?: KodetyWordPressAppView;
  localizationEntryUrl?: string;
  localizationStyleUrl?: string;
  localizationFileUrl?: string;
  localizationFlagAssetUrl?: string;
  localizationPreloadUrls?: string[];
  localizationSaveUrl?: string;
  localizationUrl?: string;
  editorUrl?: string;
  cmsUrl?: string;
  settingsUrl?: string;
  membersUrl?: string;
  templatesUrl?: string;
  siteUrl?: string;
  analyticsUrl?: string;
  analyticsDemoMode?: boolean;
  dashboardUrl?: string;
  projectUrl?: string;
  projectSurfaceUrl?: string;
  projectSurfaceAssetUrl?: string;
  projectChunkUrl?: string;
  projectDeltaUrl?: string;
  projectDownloadUrl?: string;
  publishUrl?: string;
  projectName?: string;
  projectId?: string;
  agentUrl?: string;
  agentNonce?: string;
  agentBrowser?: { selected: 'server' | 'webcontainer'; userId: number; runtimeUrl?: string };
  studio?: { enabled: boolean; projectId: string; studioOrigin?: string } | null;
  nonce: string;
  restNonceUrl?: string;
  readOnly?: boolean;
  canViewAnalytics?: boolean;
  cmsItemsUrl?: string;
  googleFontsUrl?: string;
  adobeFontsLicensed?: boolean;
  adobeFontsUrl?: string;
  adobeFontsSyncUrl?: string;
  mediaUploadUrl?: string;
  aiSettingsPageUrl?: string;
  aiGenerateUrl?: string;
  editorLockUrl?: string;
  brandLogoUrl?: string;
  editorCornerIcon?: 'kodety-logo' | 'client-logo';
  performanceDebug?: {
    enabled: true;
    traceId: string;
  };
  updates?: {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    checkedAt: string;
    releasedAt?: string;
    pageUrl: string;
    statusUrl: string;
    checkUrl: string;
  } | null;
  onboarding?: {
    userId: number;
    preference: 'unseen' | 'offered' | 'dismissed' | 'started' | 'completed';
    preferenceUrl: string;
  } | null;
  share?: {
    active?: boolean;
    mode?: 'view' | 'edit';
    token?: string;
    invitation?: { token?: string } | null;
  } | null;
}

interface LocalizationProjectPrefetch {
  baseUrl: string;
  controller: AbortController;
  response: Promise<Response | null>;
}

export type KodetyWordPressWindow = typeof window & {
  kodetyWordPress?: KodetyWordPressEntryConfig;
  kodetyLocalizationProjectPrefetch?: LocalizationProjectPrefetch;
};

function localizationProjectBaseUrl(config?: KodetyWordPressEntryConfig) {
  const source = config?.projectDownloadUrl || config?.projectUrl || '';
  return source ? new URL(source, window.location.href).href : '';
}

// A speculative archive request must never become an unbounded prerequisite
// for mounting the extension. The canonical loader still owns its own overall
// deadline; this shorter budget merely lets it fall back to a normal request.
const LOCALIZATION_PROJECT_PREFETCH_TIMEOUT_MS = 30_000;

async function bufferLocalizationPrefetchResponse(response: Response) {
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Start the project request while the optional Languages bundle is still
 * downloading. The extension consumes this response after mounting, avoiding
 * a second serial network phase on every visit to the workspace.
 */
export function startLocalizationProjectPrefetch(config = wordpressEntryConfig()) {
  const baseUrl = localizationProjectBaseUrl(config);
  if (!config || !baseUrl) return;
  const editorWindow = window as KodetyWordPressWindow;
  if (editorWindow.kodetyLocalizationProjectPrefetch?.baseUrl === baseUrl) return;
  const requestUrl = new URL(baseUrl);
  requestUrl.searchParams.set('_kodety_project_revision', String(Date.now()));
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new DOMException('Localization prefetch timed out.', 'TimeoutError')),
    LOCALIZATION_PROJECT_PREFETCH_TIMEOUT_MS,
  );
  editorWindow.kodetyLocalizationProjectPrefetch = {
    baseUrl,
    controller,
    // A failed speculative request must never make the canonical loader fail.
    // Returning null lets the extension immediately retry through its normal
    // error-aware request path without producing an unhandled rejection. Buffer
    // the body here so the timeout covers the archive transfer, not only headers.
    response: fetch(requestUrl, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': config.nonce },
      signal: controller.signal,
    })
      .then(bufferLocalizationPrefetchResponse)
      .catch(() => null)
      .finally(() => window.clearTimeout(timeout)),
  };
}

export function takeLocalizationProjectPrefetch(
  config: KodetyWordPressEntryConfig,
  signal?: AbortSignal,
) {
  const editorWindow = window as KodetyWordPressWindow;
  const prefetch = editorWindow.kodetyLocalizationProjectPrefetch;
  if (!prefetch || prefetch.baseUrl !== localizationProjectBaseUrl(config)) return null;
  delete editorWindow.kodetyLocalizationProjectPrefetch;
  const abortPrefetch = () => prefetch.controller.abort(signal?.reason);
  if (signal?.aborted) abortPrefetch();
  else signal?.addEventListener('abort', abortPrefetch, { once: true });
  return prefetch.response.finally(() => {
    signal?.removeEventListener('abort', abortPrefetch);
  });
}

export function wordpressEntryConfig() {
  return (window as KodetyWordPressWindow).kodetyWordPress;
}

export const WORDPRESS_LOCALIZATION_PATH = '/kodety/localization/';

/** The Languages workspace is a URL-owned surface. Its host is deliberately
 * irrelevant: every `https://<host>/kodety/localization/` page must boot the
 * Localization extension even if an old/cached shell supplied another
 * `appView`. Query strings and hashes are already excluded by `pathname`. */
export function isWordPressLocalizationRoute(
  location: Pick<Location, 'pathname'> = window.location,
) {
  const pathname = location.pathname.replace(/\/+$/, '').toLowerCase();
  return pathname === WORDPRESS_LOCALIZATION_PATH.slice(0, -1);
}

export function wordpressEntryAppView(
  config = wordpressEntryConfig(),
  location: Pick<Location, 'pathname'> = window.location,
): KodetyWordPressAppView {
  return isWordPressLocalizationRoute(location)
    ? 'localization'
    : config?.appView || 'editor';
}

export function wordpressEntryReadOnly(config = wordpressEntryConfig()) {
  return Boolean(config?.readOnly || config?.share?.mode === 'view');
}

export function wordpressEntryEditorLockEnabled(
  config = wordpressEntryConfig(),
  location: Pick<Location, 'pathname'> = window.location,
) {
  return wordpressEntryAppView(config, location) === 'editor' && Boolean(config?.editorLockUrl);
}
