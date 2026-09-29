import { runWorkspaceNavigationGuards } from '@/lib/html-editor/workspace-navigation';
import { navigateWithEditorLockHandoff } from './editor-lock-navigation';
import type { KodetyWordPressEntryConfig } from './wordpress-entry-config';

export type WordPressAgentExecution = 'server' | 'browser';
export const WORDPRESS_AGENT_RUNTIME_PARAM = 'kodety_agent_runtime';
export const WORDPRESS_AGENT_SETTINGS_PARAM = 'kodety_agent_settings';

export function wordpressBrowserAgentLicensed(config?: KodetyWordPressEntryConfig) {
  return Boolean(config?.agentUrl && !config.share?.active && config.product?.licensed && config.product.features.ai === true);
}

export function wordpressAgentExecutionUrl(mode: WordPressAgentExecution, config: KodetyWordPressEntryConfig, pageUrl: string) {
  const current = new URL(pageUrl);
  const destination = mode === 'browser' && (config.appView || 'editor') !== 'editor' && config.editorUrl
    ? new URL(config.editorUrl, pageUrl) : ['editor', 'settings'].includes(config.appView || 'editor')
    ? current : new URL(config.settingsUrl || config.editorUrl || pageUrl, pageUrl);
  if (destination.origin !== current.origin) throw new Error('As configurações do Agent precisam pertencer a este WordPress.');
  if (mode === 'browser') {
    destination.searchParams.set(WORDPRESS_AGENT_SETTINGS_PARAM, '1');
    destination.searchParams.set('kodety_panel', 'agent');
  } else if ((config.appView || 'editor') === 'editor') destination.searchParams.set('kodety_panel', 'agent');
  else if (config.appView !== 'settings') destination.searchParams.set('section', 'agents');
  destination.searchParams.set(WORDPRESS_AGENT_RUNTIME_PARAM, mode === 'browser' ? 'webcontainer' : 'server');
  return destination.href;
}

export function wordpressBrowserAgentSettingsUrl(config: KodetyWordPressEntryConfig, pageUrl: string) {
  const current = new URL(pageUrl);
  const destination = new URL(config.editorUrl || '/kodety/editor/', current);
  if (destination.origin !== current.origin) throw new Error('O Builder precisa pertencer a este WordPress.');
  destination.searchParams.set(WORDPRESS_AGENT_RUNTIME_PARAM, 'webcontainer');
  destination.searchParams.set(WORDPRESS_AGENT_SETTINGS_PARAM, '1');
  destination.searchParams.set('kodety_panel', 'agent');
  return destination.href;
}

/** The preference changes only after every workspace has saved successfully. */
export async function selectWordPressAgentExecution(
  mode: WordPressAgentExecution,
  config: KodetyWordPressEntryConfig,
  environment: {
    pageUrl: string;
    guard(destination: string): Promise<boolean>;
    writeCookie(cookie: string): void;
    navigate(destination: string): void;
  } = {
    pageUrl: window.location.href,
    guard: runWorkspaceNavigationGuards,
    writeCookie: cookie => { document.cookie = cookie; },
    navigate: navigateWithEditorLockHandoff,
  },
) {
  const destination = wordpressAgentExecutionUrl(mode, config, environment.pageUrl);
  if (!await environment.guard(destination)) return false;
  const secure = new URL(environment.pageUrl).protocol === 'https:' ? '; Secure' : '';
  environment.writeCookie(`${WORDPRESS_AGENT_RUNTIME_PARAM}=${mode === 'browser' ? 'webcontainer' : 'server'}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`);
  environment.navigate(destination);
  return true;
}
