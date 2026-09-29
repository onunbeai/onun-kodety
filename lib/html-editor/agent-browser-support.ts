export type AgentBrowserNotice = 'webkit' | 'features';

export type AgentBrowserEnvironment = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  webAssembly: boolean;
  worker: boolean;
};

/** Kodety currently boots WebContainers with credentialless isolation. Give
 * WebKit users guidance before trying to start that runtime. Do not classify
 * Firefox/Zen as incompatible by brand: their runtime support differs from
 * StackBlitz's restrictions on embedding an entire project in another site.
 * Hosting isolation errors remain the runtime's responsibility, not a browser
 * incompatibility (a Chromium browser can also receive missing COOP/COEP headers).
 */
export function agentBrowserNotice(environment?: AgentBrowserEnvironment): AgentBrowserNotice | null {
  if (!environment && typeof navigator === 'undefined') return null;
  const env = environment || {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    webAssembly: typeof WebAssembly !== 'undefined',
    worker: typeof Worker !== 'undefined',
  };
  const ios = /iPad|iPhone|iPod/i.test(env.userAgent)
    || env.platform === 'MacIntel' && Number(env.maxTouchPoints) > 1;
  if (ios) return 'webkit';
  const chromium = /(?:Chrome|Chromium|Edg|OPR)\//i.test(env.userAgent);
  if (!chromium && /AppleWebKit\//i.test(env.userAgent)) return 'webkit';
  if (!env.webAssembly || !env.worker) return 'features';
  return null;
}
