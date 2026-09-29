'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, X } from '@/components/ui/gravity-icons';
import { BookBookmarkIcon } from '@solar-icons/react/bold-duotone/book-bookmark';
import { ChartSquareIcon } from '@solar-icons/react/bold-duotone/chart-square';
import { CheckCircleIcon } from '@solar-icons/react/bold-duotone/check-circle';
import { CursorIcon } from '@solar-icons/react/bold-duotone/cursor';
import { DatabaseIcon } from '@solar-icons/react/bold-duotone/database';
import { GlobalIcon } from '@solar-icons/react/bold-duotone/global';
import { SettingsMinimalisticIcon } from '@solar-icons/react/bold-duotone/settings-minimalistic';
import { ONBOARDING_TOURS, type OnboardingTourId } from '@/lib/html-editor/onboarding-tours';
import { createOnboardingStorageKey, type OnboardingPreference } from '@/lib/html-editor/onboarding-state';
import { readOnboardingProgress, writeOnboardingProgress, type OnboardingProgress } from '@/lib/html-editor/onboarding-progress';
import { onboardingAreaEnabled, onboardingAreaUrl as tourUrl, type BuilderOnboardingWorkspace } from '@/lib/html-editor/onboarding-availability';
import { createWorkspaceOnboardingStorageKey } from '@/lib/html-editor/onboarding-workspace';
import type { KodetyWordPressEntryConfig } from '@/Wordpress/editor/wordpress-entry-config';
import { DisclosureChevron } from '@/components/ui/disclosure-summary';
import styles from './HtmlBuilderOnboarding.module.css';

type Tour = (typeof ONBOARDING_TOURS)[number];
type Step = Tour['steps'][number];
type Session = { tour: Tour; steps: readonly Step[]; index: number; parent?: Session };
type Rect = { x: number; y: number; width: number; height: number };
const icons: Partial<Record<OnboardingTourId, typeof CursorIcon>> = {
  design: CursorIcon, cms: DatabaseIcon, settings: SettingsMinimalisticIcon,
  analytics: ChartSquareIcon, localization: GlobalIcon,
};

/** Visibility follows layout, including collapsed panels and responsive menus. */
export function findOnboardingTarget(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]')) return element;
  }
  return null;
}

function findSafeReveal(step: Step, requireVisible = true, attempted?: Set<string>): HTMLElement | null {
  if (!step.reveal) return null;
  for (const control of document.querySelectorAll<HTMLElement>(step.reveal)) {
    const key = control.getAttribute('data-kodety-onboarding') || step.reveal;
    if (attempted?.has(key) || !control.hasAttribute('data-kodety-onboarding-reveal') || control.matches(':disabled, [aria-disabled="true"]')) continue;
    if (control.hasAttribute('data-kodety-onboarding-navigation') && findOnboardingTarget('[data-kodety-onboarding-draft], [data-kodety-onboarding-navigation-draft]')) continue;
    const box = control.getBoundingClientRect();
    if (requireVisible && (!box.width || !box.height || getComputedStyle(control).visibility === 'hidden' || control.closest('[hidden]'))) continue;
    return control;
  }
  return null;
}

function stepAvailable(step: Step) {
  return Boolean(findOnboardingTarget(step.target) || findSafeReveal(step, false));
}

function toggleIsOpen(control: HTMLElement) {
  return control.getAttribute('aria-pressed') === 'true' || control.getAttribute('aria-expanded') === 'true' || control.getAttribute('data-state') === 'open'
    || (control.tagName === 'SUMMARY' && control.parentElement instanceof HTMLDetailsElement && control.parentElement.open);
}

function useSpotlight(step: Step | undefined, card: RefObject<HTMLDivElement | null>, activeSteps: readonly Step[]) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [, setAvailableDetails] = useState('');
  const pendingCleanup = useRef<{ step: Step; cancelled: boolean } | null>(null);
  const activeStepsRef = useRef(activeSteps);
  activeStepsRef.current = activeSteps;
  const ownedPanels = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    if (pendingCleanup.current && pendingCleanup.current.step === step) pendingCleanup.current.cancelled = true;
    if (!step) { setRect(null); return; }
    let frame = 0;
    let focusFrame = 0;
    let entering = true;
    let requestedReveal = false;
    const attemptedReveals = new Set<string>();
    let userInteracted = false;
    let observed: HTMLElement | null = null;
    const resize = new ResizeObserver(() => schedule());
    const update = () => {
      const element = findOnboardingTarget(step.target);
      if (entering) {
        // Only explicitly marked view controls may open a panel. Never click
        // content actions. A panel may need its tab and then a safe selection;
        // attempt each control once, and stop as soon as the real target exists.
        if (element) entering = false;
        else {
          const control = findSafeReveal(step, true, attemptedReveals);
          const toggle = control?.getAttribute('data-kodety-onboarding');
          if (toggle && control?.hasAttribute('data-kodety-onboarding-toggle') && !toggleIsOpen(control)) ownedPanels.current.set(toggle, step.target);
          if (control) {
            attemptedReveals.add(control.getAttribute('data-kodety-onboarding') || step.reveal!);
            requestedReveal = true;
            control.click();
            schedule();
          }
        }
      }
      if (observed !== element) {
        if (observed) resize.unobserve(observed);
        observed = element;
        if (element) {
          resize.observe(element);
          element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
          if (requestedReveal) {
            requestedReveal = false;
            // Newly mounted panels can autofocus their search field. Return
            // focus to the guide after that mount, unless the user intervenes.
            focusFrame = requestAnimationFrame(() => { if (!userInteracted) card.current?.focus({ preventScroll: true }); });
          }
        }
      }
      const box = element?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const x = box ? Math.max(left + 4, box.left - 5) : 0;
      const y = box ? Math.max(top + 4, box.top - 5) : 0;
      const next = box ? { x, y, width: Math.max(0, Math.min(left + width - 4, box.right + 5) - x), height: Math.max(0, Math.min(top + height - 4, box.bottom + 5) - y) } : null;
      setRect(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      // A form can appear without moving this step's target. Refresh the
      // optional detail entry when its actual controls become available.
      setAvailableDetails(step.details?.filter(stepAvailable).map(item => item.id).join('|') || '');
    };
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }
    function trackInteraction(event: Event) {
      if (event.target instanceof Node && observed?.contains(event.target)) userInteracted = true;
    }
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element) || !record.target.closest('[data-kodety-onboarding-ui]'))) schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('pointerdown', trackInteraction, true);
    document.addEventListener('input', trackInteraction, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); resize.disconnect(); mutations.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      document.removeEventListener('pointerdown', trackInteraction, true);
      document.removeEventListener('input', trackInteraction, true);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
      // A guide-owned panel belongs to this step, even after browsing or
      // searching inside it. Preserve only an actual unfinished content draft.
      const pending = { step, cancelled: false };
      pendingCleanup.current = pending;
      // React suppresses synthetic events during layout-effect cleanup.
      // Close after the commit so the existing control's onClick can run.
      queueMicrotask(() => {
        if (pending.cancelled) return;
        for (const [id, targetSelector] of ownedPanels.current) {
          const toggle = findOnboardingTarget(`[data-kodety-onboarding="${CSS.escape(id)}"][data-kodety-onboarding-toggle]`);
          const panel = findOnboardingTarget(targetSelector);
          // Optional details still belong to their parent panel. Keep it
          // open until the user leaves that whole part of the guide.
          const stillNeeded = card.current?.isConnected && activeStepsRef.current.some(active => {
            const target = findOnboardingTarget(active.target);
            return active.target === targetSelector || Boolean(target && panel?.contains(target))
              || Boolean(active.reveal && toggle?.matches(active.reveal));
          });
          if (stillNeeded || panel?.matches('[data-kodety-onboarding-draft]') || panel?.querySelector('[data-kodety-onboarding-draft]')) continue;
          ownedPanels.current.delete(id);
          if (toggle && toggleIsOpen(toggle) && toggle.hasAttribute('data-kodety-onboarding-reveal') && panel) toggle.click();
        }
      });
    };
  }, [step, card]);
  return rect;
}

/** Prefer free space beside the target, then below/above it; clamp small screens. */
function positionCard(rect: Rect | null, width: number, height: number): CSSProperties {
  const viewport = window.visualViewport;
  const vw = viewport?.width || window.innerWidth;
  const vh = viewport?.height || window.innerHeight;
  const ox = viewport?.offsetLeft || 0;
  const oy = viewport?.offsetTop || 0;
  const gap = 16;
  const candidates = rect ? [
    { left: rect.x + rect.width + gap, top: rect.y },
    { left: rect.x - width - gap, top: rect.y },
    { left: rect.x + (rect.width - width) / 2, top: rect.y + rect.height + gap },
    { left: rect.x + (rect.width - width) / 2, top: rect.y - height - gap },
  ] : [];
  const fits = candidates.find(candidate => candidate.left >= ox + gap && candidate.left + width <= ox + vw - gap && candidate.top >= oy + gap && candidate.top + height <= oy + vh - gap);
  const preferred = fits || candidates.find(candidate => candidate.left >= ox + gap && candidate.left + width <= ox + vw - gap) || { left: ox + (vw - width) / 2, top: oy + vh - height - gap };
  return {
    left: Math.max(ox + gap, Math.min(preferred.left, ox + vw - width - gap)),
    top: Math.max(oy + gap, Math.min(preferred.top, oy + vh - height - gap)),
    maxHeight: vh - gap * 2,
  };
}

export default function HtmlBuilderOnboarding({ mode, initialTourId, currentArea, config, workspace, onRemember, onNavigate, onExplore, onClose }: {
  mode: 'invite' | 'library';
  initialTourId?: OnboardingTourId;
  currentArea: OnboardingTourId;
  config?: KodetyWordPressEntryConfig;
  workspace?: BuilderOnboardingWorkspace;
  onRemember: (preference: OnboardingPreference) => void;
  onNavigate: (tourId: OnboardingTourId, href?: string) => Promise<boolean>;
  onExplore: () => void;
  onClose: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [finished, setFinished] = useState<Tour | null>(null);
  const [notice, setNotice] = useState('');
  const [navigating, setNavigating] = useState<OnboardingTourId | null>(null);
  const progressKey = workspace
    ? createWorkspaceOnboardingStorageKey(typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname, workspace.id)
    : createOnboardingStorageKey(config?.siteUrl || (typeof window === 'undefined' ? '' : window.location.origin), config?.onboarding?.userId || 0);
  const [reading, setReading] = useState<OnboardingProgress>(() => readOnboardingProgress(progressKey));
  const [indexOpen, setIndexOpen] = useState(false);
  const [progressSaved, setProgressSaved] = useState(true);
  const card = useRef<HTMLDivElement>(null);
  const indexTrigger = useRef<HTMLButtonElement>(null);
  const [cardSize, setCardSize] = useState({ width: 376, height: 330 });
  const restoreFocus = useRef<Element | null>(null);
  const restoreFrame = useRef(0);
  const initialStarted = useRef(false);
  const invitationRecorded = useRef(false);
  useEffect(() => {
    if (mode !== 'invite' || invitationRecorded.current) return;
    invitationRecorded.current = true;
    // Record an actual mounted invitation, including when the user leaves
    // without answering. A later visit must not ask the same question again.
    onRemember('offered');
  }, [mode, onRemember]);
  const step = session?.steps[session.index];
  const activeSteps: Step[] = [];
  for (let scope = session; scope; scope = scope.parent || null) activeSteps.push(scope.steps[scope.index]);
  const rect = useSpotlight(step, card, activeSteps);

  function rememberReading(tour: Tour, stepId: string, completed = false) {
    const entry = { stepId, completed: Boolean(completed || reading[tour.id]?.completed) };
    const saved = writeOnboardingProgress(progressKey, tour.id, entry);
    setProgressSaved(saved);
    const durable = saved ? readOnboardingProgress(progressKey) : {};
    setReading(current => ({
      ...current, ...durable,
      [tour.id]: { stepId, completed: Boolean(entry.completed || current[tour.id]?.completed || durable[tour.id]?.completed) },
    }));
  }

  useEffect(() => { setReading(readOnboardingProgress(progressKey)); }, [progressKey]);

  function start(tour: Tour) {
    const steps = tour.steps.filter(stepAvailable);
    setNotice(''); setFinished(null);
    if (!steps.length) {
      setNotice('Esta área ainda está carregando ou não está disponível nesta tela. Você pode escolher outra área ou tentar novamente.');
      return;
    }
    onRemember('started');
    const previous = reading[tour.id]?.completed ? undefined : reading[tour.id]?.stepId;
    const savedOrder = tour.steps.findIndex(item => item.id === previous);
    const resumed = savedOrder < 0 ? 0 : steps.findIndex(item => tour.steps.indexOf(item) >= savedOrder);
    const index = Math.max(0, resumed);
    setIndexOpen(false);
    rememberReading(tour, steps[index].id);
    setSession({ tour, steps, index });
  }

  useEffect(() => {
    cancelAnimationFrame(restoreFrame.current);
    restoreFocus.current = document.activeElement;
    return () => {
      const previous = restoreFocus.current;
      restoreFrame.current = requestAnimationFrame(() => {
        // Reopening from the logo can replace an active guide. Its previous
        // instance must not take focus back from the newly mounted guide.
        if (document.querySelector('[data-kodety-onboarding-ui][data-onboarding-view]')) return;
        const target = previous instanceof HTMLElement && previous.isConnected ? previous : document.querySelector<HTMLElement>('[data-editor-corner-menu-trigger]');
        target?.focus({ preventScroll: true });
      });
    };
  }, []);

  useEffect(() => {
    if (!initialTourId || initialStarted.current) return;
    initialStarted.current = true;
    const tour = ONBOARDING_TOURS.find(item => item.id === initialTourId);
    if (tour) start(tour);
  // Only a consumed, explicit cross-area request can auto-start a tour.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTourId]);

  useLayoutEffect(() => {
    if (!card.current || !session) return;
    const element = card.current;
    const observer = new ResizeObserver(() => setCardSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [session]);

  useLayoutEffect(() => {
    // The area-choice button unmounts when a tour starts. Keep keyboard
    // navigation in the guide, without trapping focus away from the editor.
    setIndexOpen(false);
    if (step) card.current?.focus({ preventScroll: true });
  }, [step?.id, session?.tour.id]);

  const choose = async (tour: Tour) => {
    if (navigating) return;
    if (!onboardingAreaEnabled(tour.id, config, workspace)) return;
    const areaVisible = tour.id === currentArea || findOnboardingTarget(`[data-kodety-onboarding="${tour.id}-workspace"]`);
    if (areaVisible) { start(tour); return; }
    const href = tourUrl(tour.id, config);
    if (!workspace && !href) return;
    setNotice(''); setNavigating(tour.id);
    try {
      if (!await onNavigate(tour.id, href)) setNotice('A navegação foi interrompida. Resolva as alterações pendentes da área atual e tente novamente.');
    } catch {
      setNotice('Não foi possível abrir esta área. Tente novamente.');
    } finally { setNavigating(null); }
  };

  const move = (direction: number) => {
    if (!session) return;
    const current = session.steps[session.index];
    const sequence = session.parent?.steps[session.parent.index].details || session.tour.steps;
    const order = sequence.findIndex(item => item.id === current.id);
    const candidates = direction > 0 ? sequence.slice(order + 1) : sequence.slice(0, order).reverse();
    const next = candidates.find(stepAvailable);
    if (!next && session.parent) { setSession(session.parent); return; }
    if (!next && direction < 0) { setSession(null); return; }
    if (!next) {
      rememberReading(session.tour, current.id, true);
      setFinished(session.tour); setSession(null); onRemember('completed');
    } else {
      // A selection made in the real canvas may expose new inspector steps.
      const steps = sequence.filter(item => item.id === current.id || stepAvailable(item));
      if (!session.parent) rememberReading(session.tour, next.id);
      setSession({ ...session, steps, index: steps.findIndex(item => item.id === next.id) });
    }
  };

  const tours = ONBOARDING_TOURS.filter(tour => onboardingAreaEnabled(tour.id, config, workspace) && (Boolean(workspace) || tour.id === currentArea || Boolean(tourUrl(tour.id, config)) || findOnboardingTarget(`[data-kodety-onboarding="${tour.id}-workspace"]`)));
  const orderedTours = [...tours].sort((a, b) => Number(b.id === currentArea) - Number(a.id === currentArea));
  const completedCount = tours.filter(tour => reading[tour.id]?.completed).length;
  const detailCount = step?.details?.filter(stepAvailable).length || 0;
  const nextStep = session?.steps[session.index + 1];
  const TourIcon = icons[session?.tour.id || finished?.id || currentArea] || BookBookmarkIcon;
  const goToStep = (target: Step) => {
    if (!session) return;
    const sequence = session.parent?.steps[session.parent.index].details || session.tour.steps;
    const available = sequence.filter(item => item.id === step?.id || stepAvailable(item));
    const index = available.findIndex(item => item.id === target.id);
    if (index < 0) return;
    if (!session.parent) rememberReading(session.tour, target.id);
    setIndexOpen(false);
    setSession({ ...session, steps: available, index });
    // Choosing the current step also removes the focused index button.
    card.current?.focus({ preventScroll: true });
  };

  if (mode === 'invite') return (
    <aside data-kodety-onboarding-ui data-onboarding-invite className={`${styles.base} ${styles.invite}`} aria-labelledby="kodety-onboarding-invitation">
      <button type="button" className={styles.close} aria-label="Não mostrar onboarding novamente" onClick={onClose}><X /></button>
      <div className={styles.inviteHeading}><span className={styles.icon} aria-hidden="true"><BookBookmarkIcon /></span><span className={styles.eyebrow}>GUIA DO KODETY<span className={styles.headerHint}>Na própria interface</span></span></div>
      <h2 id="kodety-onboarding-invitation">Quer conhecer o builder?</h2>
      <p className={styles.description}>Encontre suas ferramentas, entenda cada painel e avance no seu ritmo.</p>
      <div className={styles.inviteAreas} aria-label="Áreas do guia"><span><CursorIcon />Design</span>{workspace ? <span><SettingsMinimalisticIcon />Settings</span> : <><span><DatabaseIcon />Conteúdo</span><span><ChartSquareIcon />Resultados</span></>}</div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onExplore}>Conhecer o Kodety <ArrowRight /></button>
        <button type="button" className={styles.secondary} onClick={onClose}>Não preciso</button>
      </div>
      <p className={styles.footnote}>Opcional. Sempre no menu da logo → Onboarding.</p>
    </aside>
  );

  return (
    <Dialog.Root open modal={false} onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        {session ? <div data-kodety-onboarding-ui className={styles.tourOverlay} aria-hidden="true">
          <svg className={styles.spotlight} width="100%" height="100%">
            {rect && <><rect x={rect.x - 2} y={rect.y - 2} width={rect.width + 4} height={rect.height + 4} rx="8" fill="none" stroke="var(--kodety-accent-border)" strokeWidth="5" /><rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="6" fill="none" stroke="var(--kodety-accent)" strokeWidth="1.5" /></>}
          </svg>
        </div> : null}
        <Dialog.Content ref={card} tabIndex={-1} data-kodety-onboarding-ui data-onboarding-view={session ? 'tour' : finished ? 'complete' : 'library'}
          className={`${styles.base} ${session ? styles.tour : styles.library}`} style={session ? positionCard(rect, cardSize.width, cardSize.height) : undefined}
          onInteractOutside={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
          onEscapeKeyDown={event => {
            // Radix handles Escape during document capture, before onKeyDown.
            event.preventDefault();
            if (indexOpen) {
              setIndexOpen(false);
              indexTrigger.current?.focus({ preventScroll: true });
            } else onClose();
          }}
          onKeyDown={event => {
            event.stopPropagation();
            if (session && !indexOpen && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
          }}>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Encerrar onboarding"><X /></button>
          {session && step ? <>
            <div className={styles.tourMeta}>
              <span className={styles.tourAreaIcon} aria-hidden="true"><TourIcon /></span>
              <span><strong>{session.tour.title}</strong><small>{session.parent ? 'Aprofundamento' : 'Guia da área'}</small></span>
              <button ref={indexTrigger} type="button" className={styles.stepCounter} aria-label="Ver etapas do guia" aria-expanded={indexOpen} aria-controls="kodety-guide-index" onClick={() => {
                if (!indexOpen) {
                  const sequence = session.parent?.steps[session.parent.index].details || session.tour.steps;
                  const steps = sequence.filter(item => item.id === step.id || stepAvailable(item));
                  setSession({ ...session, steps, index: steps.findIndex(item => item.id === step.id) });
                }
                setIndexOpen(value => !value);
              }}><span aria-live="polite">{session.index + 1} / {session.steps.length}</span><DisclosureChevron className={styles.counterChevron} expanded={indexOpen} /></button>
            </div>
            <div className={styles.progress} role="progressbar" aria-label="Progresso do guia" aria-valuenow={session.index + 1} aria-valuemin={0} aria-valuemax={session.steps.length}><span style={{ width: `${(session.index + 1) / session.steps.length * 100}%` }} /></div>
            {indexOpen ? <nav id="kodety-guide-index" className={styles.stepIndex} aria-label="Etapas do guia"><p>Ir para uma etapa</p>{session.steps.map((item, index) => <button key={item.id} type="button" aria-current={item.id === step.id ? 'step' : undefined} onClick={() => goToStep(item)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong>{item.id === step.id && <span className={styles.indexDot} aria-hidden="true" />}</button>)}</nav> : null}
            <div key={step.id} data-kodety-onboarding-ui className={styles.stepCopy} aria-live="polite" aria-atomic="true">
              {session.parent && <p className={styles.detailContext}>{session.parent.steps[session.parent.index].title}</p>}
              <Dialog.Title>{step.title}</Dialog.Title>
              <Dialog.Description className={styles.description}>{step.description}</Dialog.Description>
              {step.tip && <div className={styles.tip}><span className={styles.tipLabel}>NA PRÁTICA</span><p>{step.tip}</p></div>}
              {detailCount > 0 && <button type="button" className={styles.detailButton} aria-label="Ver em detalhes" onClick={() => {
                const steps = step.details!.filter(stepAvailable);
                if (steps.length) setSession({ tour: session.tour, steps, index: 0, parent: session });
              }}><span className={styles.detailIcon}><BookBookmarkIcon /></span><span><strong>Ver em detalhes</strong><small>{detailCount} {detailCount === 1 ? 'explicação disponível' : 'explicações disponíveis'}</small></span><ArrowRight /></button>}
              {!rect && <p className={styles.waiting} role="status">Abra o painel desta etapa para acompanhar a explicação, ou avance quando quiser.</p>}
            </div>
            {nextStep && <p className={styles.nextStep}><span>A seguir</span><strong>{nextStep.title}</strong></p>}
            <div className={styles.tourFooter}>
              <button type="button" className={styles.textButton} onClick={() => { setIndexOpen(false); setSession(session.parent || null); }}>{session.parent ? 'Voltar ao guia' : 'Ver áreas'}</button>
              <div className={styles.actions}>
                <button type="button" className={`${styles.secondary} ${styles.previous}`} onClick={() => move(-1)} disabled={session.index === 0 && !session.parent} aria-label="Passo anterior"><ArrowLeft /></button>
                <button type="button" className={styles.primary} onClick={() => move(1)}>{session.index === session.steps.length - 1 ? session.parent ? 'Concluir detalhes' : 'Concluir' : 'Próximo'}<ArrowRight /></button>
              </div>
            </div>
            <div className={styles.keyboardHint}><span>{progressSaved ? 'Você pode continuar depois.' : 'Progresso disponível nesta sessão.'}</span><span aria-label="Setas para navegar; Escape para fechar"><kbd>←</kbd><kbd>→</kbd><kbd>esc</kbd></span></div>
          </> : finished ? <div className={styles.completion}>
            <span className={styles.completionIcon} aria-hidden="true"><CheckCircleIcon /></span>
            <p className={styles.eyebrow}>GUIA CONCLUÍDO</p>
            <Dialog.Title>Mais uma área para criar.</Dialog.Title>
            <Dialog.Description className={styles.description}>Você conheceu os principais controles de {finished.title}. Use o que aprendeu no projeto ou continue explorando.</Dialog.Description>
            <div className={styles.completionArea}><span className={styles.choiceIcon}><TourIcon /></span><span><strong>{finished.title}</strong><small>Guia geral concluído</small></span><Check /></div>
            <p className={styles.footnote}>{progressSaved ? 'Sua conclusão ficou salva neste navegador. Os detalhes continuam disponíveis para consulta.' : 'Seu navegador não permitiu guardar o progresso. Você pode rever o guia pelo menu da logo.'}</p>
            <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setFinished(null)}>Explorar outra área</button><button type="button" className={styles.primary} onClick={onClose}>Finalizar <Check /></button></div>
          </div> : <>
            <div className={styles.libraryHeader}>
              <div className={styles.libraryBrand}><span className={styles.icon} aria-hidden="true"><BookBookmarkIcon /></span><p className={styles.eyebrow}>GUIA DO KODETY<span className={styles.headerHint}>Explore no seu ritmo</span></p></div>
              <Dialog.Title>Conheça as ferramentas.</Dialog.Title>
              <Dialog.Description className={styles.description}>Escolha uma área e acompanhe as explicações na própria interface.</Dialog.Description>
              <div className={styles.libraryProgress}><span>{completedCount ? `${completedCount} de ${tours.length} áreas exploradas` : `${tours.length} áreas para explorar`}</span><span className={styles.progressSegments} aria-hidden="true">{tours.map(tour => <i key={tour.id} data-complete={reading[tour.id]?.completed || undefined} />)}</span></div>
            </div>
            <div className={styles.catalog}>
              {orderedTours.map((tour, index) => {
                const Icon = icons[tour.id] || BookBookmarkIcon;
                const here = tour.id === currentArea;
                const progress = reading[tour.id];
                const completed = progress?.completed;
                const resumed = !completed && tour.steps.some(item => item.id === progress?.stepId) && progress?.stepId !== tour.steps[0].id;
                return <div key={tour.id}>{(here || index === (orderedTours[0]?.id === currentArea ? 1 : 0)) && <p className={styles.catalogLabel}>{here ? 'NESTA ÁREA' : 'OUTRAS ÁREAS'}</p>}<button type="button" className={styles.tourChoice} data-current={here || undefined} disabled={Boolean(navigating)} onClick={() => { void choose(tour); }}>
                  <span className={styles.choiceIcon} aria-hidden="true"><Icon /></span>
                  <span className={styles.choiceCopy}><span className={styles.choiceTitle}>{tour.title}</span><span className={styles.choiceDescription}>{tour.description}</span><span className={styles.choiceMeta}><span>{completed ? <><Check />Concluído</> : resumed ? 'Em andamento' : `Até ${tour.steps.length} etapas`}</span>{here && <span className={styles.badge}>Você está aqui</span>}</span><span className={styles.choiceAction}>{navigating === tour.id ? 'Abrindo área…' : completed ? 'Rever guia' : resumed ? 'Continuar guia' : here ? 'Iniciar guia' : 'Explorar área'}</span></span>
                  {here ? <ArrowRight className={styles.choiceArrow} /> : <ArrowUpRight className={styles.choiceArrow} />}
                </button></div>;
              })}
            </div>
            {notice && <p className={styles.notice} role="status">{notice}</p>}
            <div className={styles.libraryFooter}><p>Vem do Elementor ou Webflow? Encontre os conceitos que você já conhece.</p><button type="button" className={styles.secondary} onClick={onClose}>Fechar guia</button></div>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
