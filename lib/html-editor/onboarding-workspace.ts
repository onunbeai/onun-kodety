import type { BuilderOnboardingWorkspace } from './onboarding-availability';
import type { OnboardingTourId } from './onboarding-tours';
import { createOnboardingStorageKey } from './onboarding-state';

export function createWorkspaceOnboardingStorageKey(siteUrl: string, workspaceId: string): string {
  // Directory URLs and explicit index.html open the same Studio project.
  let canonicalSiteUrl = siteUrl;
  try {
    const site = new URL(siteUrl);
    site.pathname = site.pathname.replace(/\/index\.html$/, '/');
    canonicalSiteUrl = site.href;
  } catch { /* Invalid URLs are rejected by the shared identity helper. */ }
  const base = createOnboardingStorageKey(canonicalSiteUrl, 0);
  return base && workspaceId ? `${base}:workspace:${encodeURIComponent(workspaceId)}` : '';
}

/** A SPA does not leave its document. Hold only an explicit in-memory request
 * until guarded navigation succeeds and its destination has actually mounted.
 * Closing/reopening the guide invalidates any late navigation result. */
export function createWorkspaceOnboardingHandoff() {
  let revision = 0;
  let pending: OnboardingTourId | null = null;
  let navigating = false;
  return {
    get pending() { return pending; },
    get navigating() { return navigating; },
    clear() { revision++; pending = null; navigating = false; },
    queue(area: OnboardingTourId, enabledAreas: readonly OnboardingTourId[]) {
      if (navigating || !enabledAreas.includes(area)) return false;
      revision++;
      pending = area;
      return true;
    },
    async navigate(workspace: BuilderOnboardingWorkspace, area: OnboardingTourId) {
      if (navigating || !workspace.enabledAreas.includes(area)) return false;
      const ticket = ++revision;
      navigating = true;
      pending = null;
      try {
        const allowed = await workspace.onNavigate(area);
        if (ticket !== revision || !allowed) return false;
        pending = area;
        return true;
      } finally { if (ticket === revision) navigating = false; }
    },
    consume(currentArea: OnboardingTourId, enabledAreas: readonly OnboardingTourId[]) {
      if (pending && !enabledAreas.includes(pending)) pending = null;
      if (!pending || pending !== currentArea || navigating) return null;
      const area = pending;
      pending = null;
      return area;
    },
  };
}
