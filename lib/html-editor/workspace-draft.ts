/** A draft can need a new backup before autosave updates the project files. */
export const WORKSPACE_DRAFT_CHANGED_EVENT = 'kodety:workspace-draft-changed';

export function notifyWorkspaceDraftChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WORKSPACE_DRAFT_CHANGED_EVENT));
  const studio = (window as typeof window & {
    kodetyWordPress?: { studio?: { enabled?: boolean; projectId?: string } };
  }).kodetyWordPress?.studio;
  if (!studio?.enabled || !studio.projectId || window.top === window) return;
  window.top?.postMessage({
    source: 'kodety-studio-wordpress', version: 1,
    type: 'project-changed', projectId: studio.projectId,
  }, '*');
}
