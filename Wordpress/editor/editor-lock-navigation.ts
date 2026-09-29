import { runWorkspaceNavigationGuards } from '@/lib/html-editor/workspace-navigation';
import { BUILDER_WORKSPACE_NAVIGATION } from '@/lib/html-editor/onboarding-events';

const EDITOR_LOCK_HANDOFF_PARAM = 'kodety_editor_handoff';
const EDITOR_LOCK_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const KODETY_WORKSPACE_PATH_PATTERN =
  /^\/(?:[^/]+\/)*kodety\/(?:share\/[^/]+\/)?(?:editor|cms|analytics|settings|localization|members|templates|kodefy)(?:\/|$)/;
const KODETY_EDITOR_PATH_PATTERN =
  /^\/(?:[^/]+\/)*kodety\/(?:share\/[^/]+\/)?editor(?:\/|$)/;

type EditorLockWindow = typeof window & {
  kodetyEditorSession?: string;
};

function workspaceDestination(raw: string) {
  try {
    const destination = new URL(raw, window.location.href);
    if (destination.origin !== window.location.origin) return null;
    return KODETY_WORKSPACE_PATH_PATTERN.test(destination.pathname) ? destination : null;
  } catch {
    return null;
  }
}

function sameOriginDestination(raw: string) {
  try {
    const destination = new URL(raw, window.location.href);
    return destination.origin === window.location.origin ? destination : null;
  } catch {
    return null;
  }
}

/**
 * Consume the one-navigation handoff before the editor creates its document
 * identity. The value is carried only by an explicit same-tab navigation and
 * is removed immediately, so duplicating the settled tab still creates a new
 * independent editor session.
 */
export function consumeEditorLockHandoff(): string {
  const current = new URL(window.location.href);
  const candidate = current.searchParams.get(EDITOR_LOCK_HANDOFF_PARAM)?.trim() || '';
  if (!current.searchParams.has(EDITOR_LOCK_HANDOFF_PARAM)) return '';
  current.searchParams.delete(EDITOR_LOCK_HANDOFF_PARAM);
  window.history.replaceState(window.history.state, '', current.toString());
  return EDITOR_LOCK_ID_PATTERN.test(candidate) ? candidate : '';
}

/** Carry the logical tab identity only to another visual editor document. */
export function editorLockHandoffUrl(raw: string): string {
  const destination = workspaceDestination(raw);
  if (!destination) return new URL(raw, window.location.href).href;
  const sessionId = (window as EditorLockWindow).kodetyEditorSession || '';
  if (KODETY_EDITOR_PATH_PATTERN.test(destination.pathname) && EDITOR_LOCK_ID_PATTERN.test(sessionId)) {
    destination.searchParams.set(EDITOR_LOCK_HANDOFF_PARAM, sessionId);
  } else {
    destination.searchParams.delete(EDITOR_LOCK_HANDOFF_PARAM);
  }
  return destination.href;
}

export function navigateWithEditorLockHandoff(raw: string): void {
  const destination = workspaceDestination(raw);
  if (
    destination
    && destination.pathname === window.location.pathname
    && destination.search === window.location.search
    && destination.hash === window.location.hash
  ) return;
  window.dispatchEvent(new CustomEvent(BUILDER_WORKSPACE_NAVIGATION, {
    detail: { href: new URL(raw, window.location.href).href },
  }));
  window.location.assign(editorLockHandoffUrl(raw));
}

let guardedNavigationRequest: Promise<boolean> | null = null;

/**
 * Drain the active workspace before changing documents. A successful request
 * remains latched while the destination takes over, so rapid repeated clicks
 * cannot start a second transaction. A cancelled beforeunload releases it.
 */
export function requestWorkspaceNavigationWithEditorLockHandoff(raw: string): Promise<boolean> {
  const destination = sameOriginDestination(raw);
  if (!destination) return Promise.resolve(false);
  if (
    destination.pathname === window.location.pathname
    && destination.search === window.location.search
    && destination.hash === window.location.hash
  ) return Promise.resolve(true);
  if (guardedNavigationRequest) return guardedNavigationRequest;

  const request = runWorkspaceNavigationGuards(destination.href)
    .then(allowed => {
      if (!allowed) return false;
      const sourceHref = window.location.href;
      navigateWithEditorLockHandoff(destination.href);
      // A beforeunload handler may cancel location.assign after every guard
      // succeeded. If this document is still authoritative after the current
      // navigation task, release the latch so a corrected/retried exit works.
      setTimeout(() => {
        if (window.location.href === sourceHref && guardedNavigationRequest === request) {
          guardedNavigationRequest = null;
        }
      }, 0);
      return true;
    });
  guardedNavigationRequest = request;
  void request.then(
    allowed => {
      if (!allowed && guardedNavigationRequest === request) guardedNavigationRequest = null;
    },
    () => {
      if (guardedNavigationRequest === request) guardedNavigationRequest = null;
    },
  );
  return request;
}

/** Reload the latest server snapshot without turning this tab into a rival. */
export function reloadWithEditorLockHandoff(): void {
  window.location.replace(editorLockHandoffUrl(window.location.href));
}

/** Intercept only ordinary same-tab clicks; modified clicks remain new tabs. */
export function interceptEditorLockWorkspaceNavigation(event: MouseEvent): void {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) return;
  const target = event.target;
  const anchor = target instanceof Element
    ? target.closest<HTMLAnchorElement>('a[data-kodety-workspace-navigation][href]')
    : null;
  if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
  if (!sameOriginDestination(anchor.href)) return;
  event.preventDefault();
  void requestWorkspaceNavigationWithEditorLockHandoff(anchor.href).catch(() => undefined);
}
