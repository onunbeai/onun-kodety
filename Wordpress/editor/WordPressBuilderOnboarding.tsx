import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { OPEN_BUILDER_ONBOARDING, BUILDER_WORKSPACE_NAVIGATION, navigateBuilderOnboarding } from '@/lib/html-editor/onboarding-events';
import { setBuilderOnboardingActive } from '@/lib/html-editor/onboarding-active';
import { onboardingAreaEnabled, onboardingAreaForDestination, type BuilderOnboardingWorkspace } from '@/lib/html-editor/onboarding-availability';
import { createWorkspaceOnboardingHandoff, createWorkspaceOnboardingStorageKey } from '@/lib/html-editor/onboarding-workspace';
import { builderOnboardingPreviewActive, subscribeBuilderOnboardingPreview } from '@/lib/html-editor/onboarding-preview';
import {
  createOnboardingStorageKey, readOnboardingPreference, writeOnboardingPreference,
  resolveOnboardingPreference, queueOnboardingTour, consumeOnboardingTour, clearOnboardingTour,
  type OnboardingPreference, type OnboardingTourIntent,
} from '@/lib/html-editor/onboarding-state';
import type { OnboardingTourId } from '@/lib/html-editor/onboarding-tours';
import { requestWorkspaceNavigationWithEditorLockHandoff } from './editor-lock-navigation';
import { wordpressEntryAppView, type KodetyWordPressEntryConfig } from './wordpress-entry-config';

const Guide = lazy(() => import('@/app/(builder)/kodety/html-editor/components/HtmlBuilderOnboarding'));
// CMS and Settings add their selected collection/section to the URL during
// mount. Match the document that was requested, before those view effects run.
const entryUrl = typeof window === 'undefined' ? '' : window.location.href;
type GuideView = { mode: 'invite' | 'library'; tourId?: OnboardingTourId; requestId?: number };

class OnboardingBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <aside role="status" className="fixed bottom-5 left-5 z-[10101] max-w-xs rounded-xl border border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)] p-4 text-xs text-[var(--kodety-text-secondary)] shadow-lg">
      <p>Não foi possível carregar o onboarding. Reabra esta área para tentar novamente.</p>
      <button type="button" onClick={this.props.onClose} className="mt-3 rounded-md bg-[var(--kodety-control)] px-3 py-2 text-[var(--kodety-text)]">Fechar</button>
    </aside>;
  }
}

/** The dismissed path loads neither the tour UI nor any editor workspace. */
function WordPressDocumentBuilderOnboarding({ config }: { config?: KodetyWordPressEntryConfig }) {
  const [view, setView] = useState<GuideView | null>(null);
  const preferenceRef = useRef<OnboardingPreference | null>(null);
  const saveChain = useRef(Promise.resolve());
  const pendingRef = useRef<{ key: string; intent: ReturnType<typeof consumeOnboardingTour> } | null>(null);
  const requestId = useRef(0);
  const automaticOfferCancelled = useRef(false);
  const departureRef = useRef<OnboardingTourIntent | null>(null);
  const storageKey = createOnboardingStorageKey(config?.siteUrl || window.location.origin, config?.onboarding?.userId || 0);
  const appView = wordpressEntryAppView(config);
  const currentArea = (appView === 'kodefy' ? 'settings' : appView === 'editor' ? 'design' : appView) as OnboardingTourId;

  const guideActive = view?.mode === 'library';
  useEffect(() => {
    setBuilderOnboardingActive(guideActive);
    return () => setBuilderOnboardingActive(false);
  }, [guideActive]);

  useEffect(() => {
    departureRef.current = null;
    if (!guideActive) return;
    const prepareDeparture = (event: Event) => {
      if (builderOnboardingPreviewActive()) { departureRef.current = null; return; }
      const href = (event as CustomEvent<{ href: string }>).detail?.href;
      const area = typeof href === 'string' ? onboardingAreaForDestination(href, config, window.location.href) : null;
      departureRef.current = area && area !== currentArea
        ? { tourId: area, destination: new URL(href, window.location.href).href }
        : null;
    };
    const commitDeparture = () => {
      const intent = departureRef.current;
      departureRef.current = null;
      // location.assign can return long before a slow destination commits.
      // Persist only when this document actually leaves; vetoed saves and
      // cancelled beforeunload prompts must not queue another tour.
      if (intent && !builderOnboardingPreviewActive()) queueOnboardingTour(storageKey, intent);
    };
    window.addEventListener(BUILDER_WORKSPACE_NAVIGATION, prepareDeparture);
    window.addEventListener('pagehide', commitDeparture);
    return () => {
      departureRef.current = null;
      window.removeEventListener(BUILDER_WORKSPACE_NAVIGATION, prepareDeparture);
      window.removeEventListener('pagehide', commitDeparture);
    };
  }, [config, currentArea, guideActive, storageKey]);

  const remember = useCallback((preference: OnboardingPreference) => {
    automaticOfferCancelled.current = true;
    const next = resolveOnboardingPreference(preferenceRef.current, preference) || preference;
    preferenceRef.current = next;
    writeOnboardingPreference(storageKey, next);
    const endpoint = config?.onboarding?.preferenceUrl;
    if (!endpoint || config?.share?.active) return;
    // Serialize decisions so a slow "started" cannot overtake "dismissed".
    saveChain.current = saveChain.current.catch(() => undefined).then(async () => {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', keepalive: true, signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce },
        body: JSON.stringify({ preference: next }),
      });
      if (!response.ok) throw new Error('Onboarding preference could not be synchronized.');
    }).catch(() => {
      // The local decision still suppresses invitations when offline. Retry
      // on the next workspace mount; never interrupt editing with a toast.
    });
  }, [config, storageKey]);

  useEffect(() => {
    automaticOfferCancelled.current = false;
    const preference = readOnboardingPreference(storageKey, config?.onboarding?.preference);
    preferenceRef.current = preference;
    if (!pendingRef.current || pendingRef.current.key !== storageKey) {
      pendingRef.current = { key: storageKey, intent: consumeOnboardingTour(storageKey, entryUrl) };
    }
    const pending = pendingRef.current.intent && onboardingAreaEnabled(pendingRef.current.intent.tourId as OnboardingTourId, config) ? pendingRef.current.intent : null;
    const open = () => {
      if (builderOnboardingPreviewActive()) return;
      remember('started');
      if (pendingRef.current) pendingRef.current.intent = null;
      setView({ mode: 'library', requestId: ++requestId.current });
    };
    window.addEventListener(OPEN_BUILDER_ONBOARDING, open);
    const syncOtherTab = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = readOnboardingPreference(storageKey, config?.onboarding?.preference);
      if (!next || next === 'unseen') return;
      preferenceRef.current = next;
      automaticOfferCancelled.current = true;
      setView(current => current?.mode === 'invite' ? null : current);
    };
    window.addEventListener('storage', syncOtherTab);
    if (preference && preference !== 'unseen' && preference !== config?.onboarding?.preference) remember(preference);
    if (pending) automaticOfferCancelled.current = false;

    const canOffer = Boolean(config?.onboarding?.userId && !config.share?.active && preference === 'unseen' && onboardingAreaEnabled(currentArea, config));
    let offerTimer: number | undefined;
    let ready = false;
    const observer = new MutationObserver(checkReady);
    const watch = () => observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'hidden'] });
    function eligible() {
      if (builderOnboardingPreviewActive()) return false;
      const anchor = document.querySelector('[data-kodety-onboarding="design-canvas"], [data-kodety-onboarding="cms-workspace"], [data-kodety-project-settings], [data-kodety-onboarding="analytics-workspace"], [data-kodety-onboarding="localization-workspace"], [data-kodety-onboarding="members-workspace"], [data-kodety-onboarding="templates-workspace"]');
      return anchor instanceof HTMLElement && anchor.getClientRects().length > 0
        && !document.querySelector('[role="dialog"], [role="alertdialog"], [data-publish-panel]')
        && (pending || !document.activeElement?.matches('input, textarea, [contenteditable="true"]'));
    }
    function checkReady() {
      if (ready || automaticOfferCancelled.current || (!pending && !canOffer) || !eligible()) return;
      ready = true;
      observer.disconnect();
      offerTimer = window.setTimeout(() => {
        if (automaticOfferCancelled.current) return;
        if (!eligible()) { ready = false; watch(); return; }
        if (pending) {
          if (pendingRef.current) pendingRef.current.intent = null;
          setView({ mode: 'library', tourId: pending.tourId as OnboardingTourId });
        }
        else setView({ mode: 'invite' });
      }, pending ? 0 : 1200);
    }
    if (pending || canOffer) {
      watch();
      document.addEventListener('focusout', checkReady);
      checkReady();
    }
    return () => {
      observer.disconnect();
      clearTimeout(offerTimer);
      document.removeEventListener('focusout', checkReady);
      window.removeEventListener(OPEN_BUILDER_ONBOARDING, open);
      window.removeEventListener('storage', syncOtherTab);
    };
  }, [config, currentArea, remember, storageKey]);

  const navigate = async (tourId: OnboardingTourId, href?: string) => {
    if (!href || builderOnboardingPreviewActive()) return false;
    remember('started');
    // Both catalog choices and ordinary workspace links use the same native
    // handoff listener above, after the exact draft has passed its save guards.
    const allowed = await navigateBuilderOnboarding(href, requestWorkspaceNavigationWithEditorLockHandoff);
    return allowed || Boolean(departureRef.current?.tourId === tourId
      && departureRef.current.destination === new URL(href, window.location.href).href);
  };

  const close = () => {
    departureRef.current = null;
    remember(view?.mode === 'invite' ? 'dismissed' : 'started');
    clearOnboardingTour(storageKey);
    setView(null);
  };

  if (!view) return null;
  return (
    <OnboardingBoundary onClose={close}>
    <Suspense fallback={null}>
      <Guide key={view.requestId || 0} mode={view.mode} initialTourId={view.tourId} currentArea={currentArea} config={config}
        onRemember={remember} onNavigate={navigate}
        onExplore={() => { remember('started'); setView({ mode: 'library' }); }}
        onClose={close} />
    </Suspense>
    </OnboardingBoundary>
  );
}

function WorkspaceBuilderOnboarding({ workspace }: { workspace: BuilderOnboardingWorkspace }) {
  const [view, setView] = useState<GuideView | null>(null);
  const [handoffRevision, setHandoffRevision] = useState(0);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const handoff = useRef(createWorkspaceOnboardingHandoff());
  const requestId = useRef(0);
  const previousArea = useRef(workspace.currentArea);
  const automaticOfferCancelled = useRef(false);
  const storageKey = createWorkspaceOnboardingStorageKey(window.location.origin + window.location.pathname, workspace.id);
  const guideActive = view?.mode === 'library';

  const remember = useCallback((preference: OnboardingPreference) => {
    automaticOfferCancelled.current = true;
    writeOnboardingPreference(storageKey, preference);
  }, [storageKey]);
  const close = useCallback(() => {
    handoff.current.clear();
    remember(view?.mode === 'invite' ? 'dismissed' : 'started');
    setView(null);
  }, [remember, view?.mode]);

  useEffect(() => {
    setBuilderOnboardingActive(guideActive);
    return () => setBuilderOnboardingActive(false);
  }, [guideActive]);

  // Each local project gets its own invitation. Decisions and displayed
  // invitations survive reloads; explicit menu access always remains available.
  useEffect(() => {
    const open = () => {
      if (builderOnboardingPreviewActive()) return;
      remember('started');
      handoff.current.clear();
      setView({ mode: 'library', requestId: ++requestId.current });
    };
    window.addEventListener(OPEN_BUILDER_ONBOARDING, open);
    return () => { window.removeEventListener(OPEN_BUILDER_ONBOARDING, open); handoff.current.clear(); };
  }, [remember]);

  useEffect(() => {
    if (!workspace.enabledAreas.includes(workspace.currentArea)) return;
    let offerTimer: number | undefined;
    const selector = workspace.currentArea === 'design'
      ? '[data-kodety-onboarding="design-canvas"]'
      : workspace.currentArea === 'settings'
        ? '[data-kodety-project-settings]'
        : `[data-kodety-onboarding="${workspace.currentArea}-workspace"]`;
    const eligible = () => !automaticOfferCancelled.current
      && readOnboardingPreference(storageKey) === 'unseen'
      && !builderOnboardingPreviewActive()
      && [...document.querySelectorAll<HTMLElement>(selector)].some(element =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]'))
      && !document.querySelector('[role="dialog"], [role="alertdialog"], [data-publish-panel]')
      && !document.activeElement?.matches('input, textarea, [contenteditable="true"]');
    const observer = new MutationObserver(checkReady);
    function checkReady() {
      if (offerTimer !== undefined || !eligible()) return;
      offerTimer = window.setTimeout(() => {
        offerTimer = undefined;
        if (!eligible()) return;
        automaticOfferCancelled.current = true;
        observer.disconnect();
        setView({ mode: 'invite' });
      }, 1200);
    }
    const syncOtherTab = (event: StorageEvent) => {
      if (event.key !== storageKey || readOnboardingPreference(storageKey) === 'unseen') return;
      automaticOfferCancelled.current = true;
      setView(current => current?.mode === 'invite' ? null : current);
    };
    window.addEventListener('storage', syncOtherTab);
    if (readOnboardingPreference(storageKey) === 'unseen') {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'class', 'style', 'hidden'] });
      document.addEventListener('focusout', checkReady);
      checkReady();
    }
    return () => {
      clearTimeout(offerTimer);
      observer.disconnect();
      document.removeEventListener('focusout', checkReady);
      window.removeEventListener('storage', syncOtherTab);
    };
  }, [storageKey, workspace.currentArea, workspace.enabledAreas]);

  useEffect(() => {
    const changed = previousArea.current !== workspace.currentArea;
    previousArea.current = workspace.currentArea;
    if (changed && guideActive && handoff.current.queue(workspace.currentArea, workspace.enabledAreas)) {
      setHandoffRevision(value => value + 1);
    }
  }, [guideActive, workspace.currentArea, workspace.enabledAreas]);

  useEffect(() => {
    const target = handoff.current.pending;
    if (!guideActive || !target) return;
    if (!workspace.enabledAreas.includes(target)) { handoff.current.clear(); return; }
    if (workspace.currentArea !== target) return;
    const selector = target === 'design'
      ? '[data-kodety-onboarding="design-canvas"]'
      : target === 'settings'
        ? '[data-kodety-project-settings]'
        : `[data-kodety-onboarding="${target}-workspace"]`;
    const observer = new MutationObserver(checkReady);
    function checkReady() {
      if (builderOnboardingPreviewActive()) { handoff.current.clear(); return; }
      const mounted = [...document.querySelectorAll<HTMLElement>(selector)].some(element =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]'),
      );
      if (!mounted) return;
      const current = workspaceRef.current;
      const tourId = handoff.current.consume(current.currentArea, current.enabledAreas);
      if (!tourId) return;
      observer.disconnect();
      setView({ mode: 'library', tourId, requestId: ++requestId.current });
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    checkReady();
    return () => observer.disconnect();
  }, [guideActive, handoffRevision, workspace.currentArea, workspace.enabledAreas]);

  const navigate = async (tourId: OnboardingTourId) => {
    if (builderOnboardingPreviewActive()) return false;
    remember('started');
    const allowed = await handoff.current.navigate(workspaceRef.current, tourId);
    if (allowed) setHandoffRevision(value => value + 1);
    return allowed;
  };

  if (!view) return null;
  return <OnboardingBoundary onClose={close}>
    <Suspense fallback={null}>
      <Guide key={view.requestId || 0} mode={view.mode} initialTourId={view.tourId} currentArea={workspace.currentArea} workspace={workspace}
        onRemember={remember} onNavigate={navigate}
        onExplore={() => { remember('started'); setView({ mode: 'library', requestId: ++requestId.current }); }} onClose={close} />
    </Suspense>
  </OnboardingBoundary>;
}

export function WordPressBuilderOnboarding({ config, workspace }: {
  config?: KodetyWordPressEntryConfig;
  workspace?: BuilderOnboardingWorkspace;
}) {
  const previewing = useSyncExternalStore(subscribeBuilderOnboardingPreview, builderOnboardingPreviewActive, () => false);
  // Unmount both host adapters: this cancels invitations, active tours and
  // pending SPA handoffs without treating Preview as a saved dismissal.
  if (previewing) return null;
  return workspace
    ? <WorkspaceBuilderOnboarding key={workspace.id} workspace={workspace} />
    : <WordPressDocumentBuilderOnboarding config={config} />;
}
