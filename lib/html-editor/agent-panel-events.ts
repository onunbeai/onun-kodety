export const OPEN_HTML_AGENT_PANEL_EVENT = 'kodety:open-agent-panel';

/** One navigation request; normal editor visits keep opening the Canvas panel. */
export function requestedHtmlAgentPanel(href: string): 'human' | 'agent' {
  try { return new URL(href).searchParams.get('kodety_panel') === 'agent' ? 'agent' : 'human'; }
  catch { return 'human'; }
}

export function clearHtmlAgentPanelRequest(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('kodety_panel');
  return url.toString();
}

export interface OpenHtmlAgentPanelDetail {
  prompt?: string;
  skill?: string;
  autoSubmit?: boolean;
}
