export type WorkspaceNavigationGuard = (
  destination: string,
) => boolean | void | Promise<boolean | void>;

type WorkspaceNavigationGlobal = typeof globalThis & {
  __kodetyWorkspaceNavigationGuards?: Map<symbol, WorkspaceNavigationGuard>;
};

function workspaceNavigationGuards() {
  const root = globalThis as WorkspaceNavigationGlobal;
  if (!root.__kodetyWorkspaceNavigationGuards) {
    root.__kodetyWorkspaceNavigationGuards = new Map();
  }
  return root.__kodetyWorkspaceNavigationGuards;
}

/**
 * Register unsaved work owned by the currently mounted workspace. The registry
 * lives on globalThis so independently emitted WordPress extension chunks share
 * the same navigation barrier as the core shell.
 */
export function registerWorkspaceNavigationGuard(guard: WorkspaceNavigationGuard) {
  const token = Symbol('kodety-workspace-navigation-guard');
  workspaceNavigationGuards().set(token, guard);
  return () => {
    workspaceNavigationGuards().delete(token);
  };
}

/** Run every mounted workspace guard in registration order. */
export async function runWorkspaceNavigationGuards(destination: string) {
  const guards = Array.from(workspaceNavigationGuards().values());
  for (const guard of guards) {
    if ((await guard(destination)) === false) return false;
  }
  return true;
}

/** Restore editable controls when the host could not complete navigation. */
export const WORKSPACE_NAVIGATION_CANCELLED_EVENT = 'kodety:workspace-navigation-cancelled';
export function cancelWorkspaceNavigation() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WORKSPACE_NAVIGATION_CANCELLED_EVENT));
}
