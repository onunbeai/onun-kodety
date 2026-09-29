'use client';

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type IframeHTMLAttributes,
  type Ref,
  type SyntheticEvent,
} from 'react';
import { cn } from '@/lib/utils';
import { KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';
import { animate, type AnimationPlaybackControlsWithThen } from 'motion';
import { pageTransitionKeyframes, pageTransitionMotionEase, type PageTransitionMotion } from '@/lib/html-editor/page-transitions';
import { previewPageTransitionFrameStyle } from '../hooks/page-transition-preview-styles';

interface BufferedDocument {
  mountKey: string;
  key: string;
  src: string;
  srcDoc: string;
  surfaceKey: string;
  revision: number;
  retain: boolean;
  pinned: boolean;
}

type BufferedPromotionKind = 'buffered' | 'reactivated';

// Browsing contexts are expensive and, unlike their serialized srcDoc, keep
// the last fully painted compositor surface. Retain a small working set so a
// page does not get evicted merely because component A was followed by B
// before returning to the page.
const MAX_RETAINED_SURFACES = 3;
const DOCUMENT_READINESS_DEADLINE_MS = 15_000;

function cacheRetainedSurface(
  cache: Map<string, BufferedDocument>,
  document: BufferedDocument,
) {
  if (document.pinned) {
    cache.forEach((cached, key) => {
      if (cached.pinned) cache.set(key, { ...cached, pinned: false });
    });
  }
  cache.delete(document.surfaceKey);
  cache.set(document.surfaceKey, document);
  while (cache.size > MAX_RETAINED_SURFACES) {
    const oldestSurfaceKey = Array.from(cache.entries()).find(([, cached]) => (
      !cached.pinned
    ))?.[0];
    if (typeof oldestSurfaceKey !== 'string') break;
    cache.delete(oldestSurfaceKey);
  }
}

export interface HtmlBufferedIframeProps extends Omit<
  IframeHTMLAttributes<HTMLIFrameElement>,
  'src' | 'srcDoc' | 'onLoad'
> {
  documentKey: string;
  surfaceKey?: string;
  documentRevision?: number;
  retainDocument?: boolean;
  /** Keep this semantic surface mounted while transient surfaces cycle. */
  pinRetainedDocument?: boolean;
  promotionTransition?: PageTransitionMotion | null;
  src?: string;
  srcDoc?: string;
  iframeRef: Ref<HTMLIFrameElement>;
  onLoad?: (
    event: SyntheticEvent<HTMLIFrameElement>,
    documentKey: string,
    documentRevision: number,
  ) => void;
  onBufferedLoad?: (
    event: SyntheticEvent<HTMLIFrameElement>,
    documentKey: string,
    documentRevision: number,
    surfaceKey: string,
    semanticNavigation: boolean,
  ) => void;
  onInitialVisualReady?: (
    node: HTMLIFrameElement,
    documentKey: string,
    documentRevision: number,
    surfaceKey: string,
  ) => void;
  /**
   * Keeps the current painted document (or the opaque first-paint shield) in
   * front while the caller finishes a layout-critical measurement.
   */
  visualReady?: boolean;
  /**
   * Restarts the two-frame paint barrier when a measured viewport changes.
   */
  visualReadyKey?: string;
  paintShieldColor?: string;
  /** Use the same clean full-canvas loader shown while the Builder opens. */
  builderLoading?: boolean;
  /**
   * Lets a fully local runtime preview cross the existing two-frame paint
   * barrier from the iframe load event. Sandboxed srcDoc documents can emit
   * their ready message before React installs the parent listener; this keeps
   * that harmless race from leaving the first-paint shield mounted forever.
   */
  progressiveDocumentLoad?: boolean;
  /**
   * Promote a different semantic surface after its iframe load and the normal
   * two-frame compositor barrier. Intended for local, already-materialized
   * documents whose optional assets may keep settling after the handoff.
   */
  progressiveSemanticNavigation?: boolean;
  onPromote?: (
    node: HTMLIFrameElement,
    documentKey: string,
    documentRevision: number,
    surfaceKey: string,
    kind: BufferedPromotionKind,
  ) => void;
}

function assignIframeRef(
  ref: Ref<HTMLIFrameElement>,
  node: HTMLIFrameElement | null,
) {
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  if (ref) ref.current = node;
}

function bufferedDocumentHasContent(document: Pick<BufferedDocument, 'src' | 'srcDoc'>) {
  if (document.srcDoc.length) return true;
  const source = document.src.trim().toLowerCase();
  return Boolean(source && source !== 'about:blank' && source !== 'about:srcdoc');
}

function isBufferedDocumentInitialPaintReadyMessage(data: unknown) {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  // The bridge is appended after the authored body, so buffer-ready proves the
  // DOM exists. The host still crosses two compositor frames before revealing;
  // styles, fonts, media and the site's own loader can then settle progressively.
  return type === 'html-editor-buffer-ready'
    || type === 'html-editor-first-content-ready'
    || type === 'html-editor-buffer-visuals-ready';
}

function isBufferedDocumentPaintReadyMessage(data: unknown) {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  // DOM completion, iframe load and component measurement are not visual
  // readiness. The preview bridge emits this only after styles/fonts/assets
  // settle within their bounded budgets and the document crosses two paints.
  return type === 'html-editor-buffer-visuals-ready';
}

/**
 * Keeps the painted browsing context mounted while the next srcDoc loads.
 *
 * A normal iframe navigation exposes Chromium's empty white document between
 * generations. Every committed edit receives a canonical reload, so prepare
 * that generation in a hidden sibling and promote it on its first safe paint.
 * The in-frame bridge normally owns the visual-settlement deadline. Callers
 * may explicitly opt a local semantic navigation into load-plus-two-paint
 * promotion when optional assets are expected to settle progressively.
 */
export function HtmlBufferedIframe({
  documentKey,
  surfaceKey = 'default',
  documentRevision = 0,
  retainDocument = false,
  pinRetainedDocument = false,
  promotionTransition = null,
  src = '',
  srcDoc = '',
  iframeRef,
  className,
  style,
  onLoad,
  onBufferedLoad,
  onInitialVisualReady,
  visualReady = true,
  visualReadyKey = '',
  paintShieldColor = '#111315',
  builderLoading = false,
  progressiveDocumentLoad = false,
  progressiveSemanticNavigation = false,
  onPromote,
  ...props
}: HtmlBufferedIframeProps) {
  const documentInstanceSequenceRef = useRef(0);
  const createBufferedDocument = useCallback((document: Omit<BufferedDocument, 'mountKey'>) => {
    documentInstanceSequenceRef.current += 1;
    return {
      ...document,
      mountKey: `buffered-document-${documentInstanceSequenceRef.current}`,
    };
  }, []);
  const [visibleDocument, setVisibleDocument] = useState<BufferedDocument>(() => (
    createBufferedDocument({
      key: documentKey,
      src,
      srcDoc,
      surfaceKey,
      revision: documentRevision,
      retain: retainDocument,
      pinned: pinRetainedDocument,
    })
  ));
  const retainedDocumentsRef = useRef(new Map<string, BufferedDocument>());
  const [retainedDocumentsVersion, setRetainedDocumentsVersion] = useState(0);
  const [pendingDocument, setPendingDocument] = useState<BufferedDocument | null>(null);
  const [initialVisualReadyDocument, setInitialVisualReadyDocument] = useState<BufferedDocument | null>(null);
  const initialVisualReady = Boolean(initialVisualReadyDocument);
  const paintReadyDocumentMountKeysRef = useRef(new Set<string>());
  const failedDocumentMountKeysRef = useRef(new Set<string>());
  const [failedDocumentMountKey, setFailedDocumentMountKey] = useState('');
  const recoveryButtonRef = useRef<HTMLButtonElement | null>(null);
  const [paintReadyDocumentVersion, setPaintReadyDocumentVersion] = useState(0);
  const [, setPromotionSettledVersion] = useState(0);
  const [transitionDocumentKey, setTransitionDocumentKey] = useState('');
  const [transitionActive, setTransitionActive] = useState(false);
  const pendingDocumentRef = useRef(pendingDocument);
  const reactivatedPropIdentityRef = useRef('');
  const promotionNotificationRef = useRef<{
    document: BufferedDocument;
    kind: BufferedPromotionKind;
  } | null>(null);
  const onPromoteRef = useRef(onPromote);
  const onInitialVisualReadyRef = useRef(onInitialVisualReady);
  const assignedNodeRef = useRef<HTMLIFrameElement | null>(null);
  const visibleSlotNodeRef = useRef<HTMLIFrameElement | null>(null);
  const visibleSlotMountKeyRef = useRef('');
  const retainedSlotNodeRef = useRef<HTMLIFrameElement | null>(null);
  const pendingSlotNodeRef = useRef<HTMLIFrameElement | null>(null);
  pendingDocumentRef.current = pendingDocument;
  onPromoteRef.current = onPromote;
  onInitialVisualReadyRef.current = onInitialVisualReady;

  const markDocumentPaintReady = useCallback((mountKey: string) => {
    if (failedDocumentMountKeysRef.current.has(mountKey)) return;
    if (paintReadyDocumentMountKeysRef.current.has(mountKey)) return;
    paintReadyDocumentMountKeysRef.current.add(mountKey);
    setPaintReadyDocumentVersion(current => current + 1);
  }, []);

  const updateRetainedDocuments = useCallback((
    update: (cache: Map<string, BufferedDocument>) => void,
  ) => {
    const next = new Map(retainedDocumentsRef.current);
    update(next);
    retainedDocumentsRef.current = next;
    setRetainedDocumentsVersion(current => current + 1);
  }, []);

  useLayoutEffect(() => {
    if (retainDocument || retainedDocumentsRef.current.size === 0) return;
    // A caller that disables retention is crossing an isolation boundary. Drop
    // every previously mounted browsing context before resolving the next
    // semantic surface so old pages/locales cannot keep scripts or timers live.
    retainedDocumentsRef.current = new Map();
    setRetainedDocumentsVersion(current => current + 1);
  }, [retainDocument]);

  const requestedDocumentIdentity = `${surfaceKey}\u0000${documentKey}\u0000${documentRevision}`;

  useLayoutEffect(() => {
    const mountedKeys = new Set([
      visibleDocument.mountKey,
      pendingDocument?.mountKey || '',
      ...Array.from(retainedDocumentsRef.current.values(), document => document.mountKey),
    ]);
    paintReadyDocumentMountKeysRef.current.forEach(mountKey => {
      if (!mountedKeys.has(mountKey)) paintReadyDocumentMountKeysRef.current.delete(mountKey);
    });
    failedDocumentMountKeysRef.current.forEach(mountKey => {
      if (!mountedKeys.has(mountKey)) failedDocumentMountKeysRef.current.delete(mountKey);
    });
  }, [
    pendingDocument?.mountKey,
    retainedDocumentsVersion,
    visibleDocument.mountKey,
  ]);

  useLayoutEffect(() => {
    if (
      reactivatedPropIdentityRef.current === requestedDocumentIdentity
      && visibleDocument.surfaceKey === surfaceKey
      && visibleDocument.revision === documentRevision
      && visibleDocument.src === src
      && visibleDocument.srcDoc === srcDoc
      && visibleDocument.retain === retainDocument
      && visibleDocument.pinned === pinRetainedDocument
    ) return;
    if (
      reactivatedPropIdentityRef.current
      && reactivatedPropIdentityRef.current !== requestedDocumentIdentity
    ) {
      reactivatedPropIdentityRef.current = '';
    }
    const retained = retainDocument
      ? retainedDocumentsRef.current.get(surfaceKey)
      : undefined;
    if (
      retained
      && retained.surfaceKey === surfaceKey
      && visibleDocument.surfaceKey !== surfaceKey
    ) {
      reactivatedPropIdentityRef.current = requestedDocumentIdentity;
      const reactivatedDocument = {
        ...retained,
        retain: retainDocument,
        pinned: pinRetainedDocument,
      };
      promotionNotificationRef.current = {
        document: reactivatedDocument,
        kind: 'reactivated',
      };
      updateRetainedDocuments(cache => {
        cache.delete(surfaceKey);
        if (visibleDocument.retain) cacheRetainedSurface(cache, visibleDocument);
      });
      setVisibleDocument(reactivatedDocument);
      // A cached surface is useful even when its authored revision is older:
      // show the already-painted page/component immediately, then prepare the
      // requested canonical revision behind it. This is the same stale-while-
      // revalidate handoff users perceive as an instant Ycode navigation.
      setPendingDocument(
        retained.revision === documentRevision
          && retained.key === documentKey
          && retained.src === src
          && retained.srcDoc === srcDoc
          ? null
          : createBufferedDocument({
              key: documentKey,
              src,
              srcDoc,
              surfaceKey,
              revision: documentRevision,
              retain: retainDocument,
              pinned: pinRetainedDocument,
            }),
      );
      return;
    }
    if (
      visibleDocument.key === documentKey
      && visibleDocument.src === src
      && visibleDocument.srcDoc === srcDoc
      && visibleDocument.surfaceKey === surfaceKey
    ) {
      // A fast A -> B -> A navigation can return to the document that is still
      // painted before B finishes loading. Cancel B here; otherwise its late
      // load/ready signal can still promote the wrong semantic surface.
      if (pendingDocumentRef.current) {
        const notification = promotionNotificationRef.current;
        if (
          notification
          && notification.document.key === pendingDocumentRef.current.key
        ) {
          promotionNotificationRef.current = null;
          setPromotionSettledVersion(current => current + 1);
        }
        setPendingDocument(null);
      }
      if (
        visibleDocument.revision !== documentRevision
        || visibleDocument.retain !== retainDocument
        || visibleDocument.pinned !== pinRetainedDocument
      ) {
        setVisibleDocument(current => ({
          ...current,
          revision: documentRevision,
          retain: retainDocument,
          pinned: pinRetainedDocument,
        }));
      }
      return;
    }
    setPendingDocument(current => (
      current?.key === documentKey
        && current.src === src
        && current.srcDoc === srcDoc
        && current.surfaceKey === surfaceKey
        && current.revision === documentRevision
        && current.retain === retainDocument
        && current.pinned === pinRetainedDocument
        ? current
        : createBufferedDocument({
          key: documentKey,
          src,
          srcDoc,
          surfaceKey,
          revision: documentRevision,
          retain: retainDocument,
          pinned: pinRetainedDocument,
        })
    ));
  }, [
    documentKey,
    documentRevision,
    retainDocument,
    pinRetainedDocument,
    src,
    srcDoc,
    surfaceKey,
    createBufferedDocument,
    requestedDocumentIdentity,
    updateRetainedDocuments,
    visibleDocument,
  ]);

  const assignExternalNode = useCallback((node: HTMLIFrameElement | null) => {
    assignedNodeRef.current = node;
    assignIframeRef(iframeRef, node);
  }, [iframeRef]);

  const setVisibleNode = useCallback((node: HTMLIFrameElement | null) => {
    if (node) {
      visibleSlotNodeRef.current = node;
      visibleSlotMountKeyRef.current = visibleDocument.mountKey;
      // A freshly promoted browsing context is already the painted layer, but
      // the parent still owns the outgoing generation until onPromote runs.
      // Do not expose the new command target during that short handoff window.
      if (
        promotionNotificationRef.current?.document.mountKey
        === visibleDocument.mountKey
      ) return;
      assignExternalNode(node);
      return;
    }
    // A keyed pending iframe can become visible in the same React commit that
    // detaches the previous visible ref. Ignore that stale ref cleanup; it must
    // never erase the newly mounted promotion target before the paint handoff.
    if (visibleSlotMountKeyRef.current !== visibleDocument.mountKey) return;
    const previous = visibleSlotNodeRef.current;
    visibleSlotNodeRef.current = null;
    visibleSlotMountKeyRef.current = '';
    // A promoted pending iframe may already own the external ref when React
    // unmounts the previous visible sibling.
    if (assignedNodeRef.current !== previous) return;
    assignExternalNode(null);
  }, [assignExternalNode, visibleDocument.mountKey]);

  const setPendingNode = useCallback((node: HTMLIFrameElement | null) => {
    pendingSlotNodeRef.current = node;
    if (node) return;
    // Ref cleanup for the hidden slot runs during promotion. The visible slot
    // immediately adopts the same keyed node, so never clear the external ref
    // from this callback.
  }, []);

  const setRetainedNode = useCallback((node: HTMLIFrameElement | null) => {
    retainedSlotNodeRef.current = node;
  }, []);

  const promotePendingDocument = useCallback((
    document: BufferedDocument,
    node: HTMLIFrameElement,
  ) => {
    const current = pendingDocumentRef.current;
    if (
      failedDocumentMountKeysRef.current.has(document.mountKey)
      || !current
      || current.key !== document.key
      || current.src !== document.src
      || current.srcDoc !== document.srcDoc
      || current.surfaceKey !== document.surfaceKey
      || current.revision !== document.revision
      || current.mountKey !== document.mountKey
    ) return;
    // The new browsing context can already paint. Swap the complete layer
    // atomically; fonts and media may keep settling without blanking the old
    // generation while the hidden iframe is prepared.
    updateRetainedDocuments(cache => {
      cache.delete(document.surfaceKey);
      if (
        document.retain
        && visibleDocument.retain
        && visibleDocument.surfaceKey !== document.surfaceKey
      ) {
        cacheRetainedSurface(cache, visibleDocument);
      }
    });
    promotionNotificationRef.current = { document, kind: 'buffered' };
    setVisibleDocument(document);
    setPendingDocument(latest => (
      latest?.key === document.key
        && latest.src === document.src
        && latest.srcDoc === document.srcDoc
        && latest.surfaceKey === document.surfaceKey
        && latest.revision === document.revision
        && latest.mountKey === document.mountKey
        ? null
        : latest
    ));
  }, [updateRetainedDocuments, visibleDocument]);

  useLayoutEffect(() => {
    const notification = promotionNotificationRef.current;
    if (!notification) return;
    const document = notification.document;
    if (
      document.key !== visibleDocument.key
      || document.src !== visibleDocument.src
      || document.srcDoc !== visibleDocument.srcDoc
      || document.surfaceKey !== visibleDocument.surfaceKey
      || document.revision !== visibleDocument.revision
      || document.mountKey !== visibleDocument.mountKey
    ) return;
    let firstPaintFrame = 0;
    let postPaintFrame = 0;
    // Ref/class reconciliation has completed at this point, so the promoted
    // iframe is already the visible and pointer-active layer. Cross one paint
    // before parent hydration hashes/copies assets or restores editor state;
    // that work must never delay the atomic visual handoff itself.
    firstPaintFrame = window.requestAnimationFrame(() => {
      postPaintFrame = window.requestAnimationFrame(() => {
        if (promotionNotificationRef.current !== notification) return;
        const node = visibleSlotNodeRef.current;
        if (!node) return;
        promotionNotificationRef.current = null;
        assignExternalNode(node);
        onPromoteRef.current?.(
          node,
          document.key,
          document.revision,
          document.surfaceKey,
          notification.kind,
        );
        // Re-render only after the parent has accepted the new generation, so
        // pointer/keyboard events can never address B while editor state still
        // belongs to A.
        setPromotionSettledVersion(current => current + 1);
      });
    });
    return () => {
      if (firstPaintFrame) window.cancelAnimationFrame(firstPaintFrame);
      if (postPaintFrame) window.cancelAnimationFrame(postPaintFrame);
    };
  }, [assignExternalNode, visibleDocument]);

  const visibleDocumentHasContent = bufferedDocumentHasContent(visibleDocument);

  // The bridge cannot report its own absence. Bound the whole parent-side
  // wait, including a blocked script or document load, independently from the
  // in-frame asset timers. Only the current requested mount may fail/retry.
  const readinessCandidate = pendingDocument || (!initialVisualReady ? visibleDocument : null);
  const readinessTarget = readinessCandidate
    && readinessCandidate.key === documentKey
    && readinessCandidate.surfaceKey === surfaceKey
    && readinessCandidate.revision === documentRevision
    && readinessCandidate.src === src
    && readinessCandidate.srcDoc === srcDoc
    ? readinessCandidate : null;
  const readinessTargetRef = useRef(readinessTarget);
  readinessTargetRef.current = readinessTarget;
  const readinessError = Boolean(readinessTarget && failedDocumentMountKey === readinessTarget.mountKey);

  useLayoutEffect(() => {
    if (!readinessError) return;
    // WebKit can keep keyboard focus inside an inert iframe after blur().
    // Transfer only that focus to recovery; do not interrupt another editor
    // control the user was already using when the background document failed.
    const focused = window.document.activeElement;
    if (focused === visibleSlotNodeRef.current || focused === pendingSlotNodeRef.current) {
      recoveryButtonRef.current?.focus({ preventScroll: true });
    }
  }, [readinessError]);

  useLayoutEffect(() => {
    const target = readinessTargetRef.current;
    if (!target || !bufferedDocumentHasContent(target)) return;
    const timer = window.setTimeout(() => {
      if (readinessTargetRef.current?.mountKey !== target.mountKey) return;
      failedDocumentMountKeysRef.current.add(target.mountKey);
      paintReadyDocumentMountKeysRef.current.delete(target.mountKey);
      visibleSlotNodeRef.current?.blur();
      pendingSlotNodeRef.current?.blur();
      setFailedDocumentMountKey(target.mountKey);
    }, DOCUMENT_READINESS_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [readinessTarget?.mountKey]);

  const retryCurrentDocument = () => {
    const next = createBufferedDocument({
      key: documentKey, src, srcDoc, surfaceKey, revision: documentRevision,
      retain: retainDocument, pinned: pinRetainedDocument,
    });
    setFailedDocumentMountKey('');
    setTransitionActive(false);
    setTransitionDocumentKey('');
    promotionNotificationRef.current = null;
    reactivatedPropIdentityRef.current = '';
    if (!initialVisualReady) {
      setVisibleDocument(next);
      setPendingDocument(null);
    } else {
      setPendingDocument(next);
    }
  };

  useLayoutEffect(() => {
    if (initialVisualReady) return;
    let firstPaintFrame = 0;
    let secondPaintFrame = 0;
    let revealScheduled = false;
    const revealInitialDocument = () => {
      if (failedDocumentMountKeysRef.current.has(visibleDocument.mountKey)) return;
      if (revealScheduled) return;
      if (!visualReady || !visibleDocumentHasContent) return;
      revealScheduled = true;
      firstPaintFrame = window.requestAnimationFrame(() => {
        secondPaintFrame = window.requestAnimationFrame(() => {
          if (failedDocumentMountKeysRef.current.has(visibleDocument.mountKey)) return;
          setInitialVisualReadyDocument(visibleDocument);
        });
      });
    };
    const handleInitialPaintReady = (event: MessageEvent) => {
      const node = visibleSlotNodeRef.current;
      if (
        !node
        || failedDocumentMountKeysRef.current.has(visibleDocument.mountKey)
        || event.source !== node.contentWindow
        || !isBufferedDocumentInitialPaintReadyMessage(event.data)
      ) return;
      markDocumentPaintReady(visibleDocument.mountKey);
      // The bridge emits this only after the authored DOM exists. Crossing two
      // additional compositor frames below proves there was a paint opportunity
      // before the first-load shield is removed.
      revealInitialDocument();
    };
    window.addEventListener('message', handleInitialPaintReady);
    if (paintReadyDocumentMountKeysRef.current.has(visibleDocument.mountKey)) {
      revealInitialDocument();
    }
    return () => {
      window.removeEventListener('message', handleInitialPaintReady);
      if (firstPaintFrame) window.cancelAnimationFrame(firstPaintFrame);
      if (secondPaintFrame) window.cancelAnimationFrame(secondPaintFrame);
    };
  }, [
    initialVisualReady,
    markDocumentPaintReady,
    paintReadyDocumentVersion,
    visibleDocument.mountKey,
    visibleDocumentHasContent,
    visualReady,
    visualReadyKey,
  ]);

  useLayoutEffect(() => {
    if (!initialVisualReadyDocument) return;
    const node = visibleSlotNodeRef.current;
    if (
      !node
      || visibleSlotMountKeyRef.current !== initialVisualReadyDocument.mountKey
    ) return;
    onInitialVisualReadyRef.current?.(
      node,
      initialVisualReadyDocument.key,
      initialVisualReadyDocument.revision,
      initialVisualReadyDocument.surfaceKey,
    );
  }, [initialVisualReadyDocument]);

  useLayoutEffect(() => {
    if (!pendingDocument) return;
    const document = pendingDocument;
    if (!bufferedDocumentHasContent(document)) return;
    let firstPromotionFrame = 0;
    let secondPromotionFrame = 0;
    let transitionRevealFrame = 0;
    let transitionTimer = 0;
    let promotionScheduled = false;
    let disposed = false;
    let promoted = false;
    const motionAnimations: AnimationPlaybackControlsWithThen[] = [];
    const promote = () => {
      if (disposed || promoted) return;
      promoted = true;
      const node = pendingSlotNodeRef.current;
      if (!node) return;
      setTransitionActive(false);
      setTransitionDocumentKey('');
      promotePendingDocument(document, node);
    };
    const schedulePromotion = () => {
      if (failedDocumentMountKeysRef.current.has(document.mountKey)) return;
      if (!visualReady || promotionScheduled) return;
      promotionScheduled = true;
      firstPromotionFrame = window.requestAnimationFrame(() => {
        secondPromotionFrame = window.requestAnimationFrame(() => {
          if (promotionTransition) {
            const duration = Math.max(100, Math.round(promotionTransition.duration * 1000));
            setTransitionDocumentKey(document.key);
            setTransitionActive(false);
            transitionRevealFrame = window.requestAnimationFrame(() => {
              const frames = pageTransitionKeyframes(promotionTransition.effect);
              const options = { duration: duration / 1000, ease: pageTransitionMotionEase(promotionTransition.easing) };
              const outgoing = visibleSlotNodeRef.current;
              const incoming = pendingSlotNodeRef.current;
              try {
                if (outgoing) motionAnimations.push(animate(outgoing, frames.outgoing, options));
                if (incoming) motionAnimations.push(animate(incoming, frames.incoming, options));
                setTransitionActive(true);
                void Promise.all(motionAnimations.map(animation => animation.finished)).then(promote, promote);
              } catch {
                promote();
              }
              // A browser animation failure must not strand a loaded destination.
              transitionTimer = window.setTimeout(promote, duration + 500);
            });
            return;
          }
          promote();
        });
      });
    };
    const handleVisualsReady = (event: MessageEvent) => {
      const node = pendingSlotNodeRef.current;
      if (
        !node
        || failedDocumentMountKeysRef.current.has(document.mountKey)
        || event.source !== node.contentWindow
        || !isBufferedDocumentPaintReadyMessage(event.data)
      ) return;
      markDocumentPaintReady(document.mountKey);
      // The old complete frame remains painted and interactive until this
      // hidden generation has crossed two compositor boundaries.
      schedulePromotion();
    };
    window.addEventListener('message', handleVisualsReady);
    if (paintReadyDocumentMountKeysRef.current.has(document.mountKey)) {
      schedulePromotion();
    }
    return () => {
      disposed = true;
      motionAnimations.forEach(animation => animation.cancel());
      window.removeEventListener('message', handleVisualsReady);
      if (firstPromotionFrame) window.cancelAnimationFrame(firstPromotionFrame);
      if (secondPromotionFrame) window.cancelAnimationFrame(secondPromotionFrame);
      if (transitionRevealFrame) window.cancelAnimationFrame(transitionRevealFrame);
      if (transitionTimer) window.clearTimeout(transitionTimer);
    };
  }, [
    markDocumentPaintReady,
    paintReadyDocumentVersion,
    pendingDocument,
    promotePendingDocument,
    promotionTransition,
    visualReady,
    visualReadyKey,
  ]);

  const handleVisibleLoad = useCallback((
    event: SyntheticEvent<HTMLIFrameElement>,
    document: BufferedDocument,
  ) => {
    if (failedDocumentMountKeysRef.current.has(document.mountKey)) return;
    assignExternalNode(event.currentTarget);
    if (!bufferedDocumentHasContent(document)) return;
    // The React props may already describe a newer document that is buffering
    // behind this iframe. Always activate the identity that actually emitted
    // load; otherwise the parent and opaque canvas bridge start using different
    // generations and every selection response is rejected as stale.
    onLoad?.(event, document.key, document.revision);
    if (
      progressiveDocumentLoad
      && !paintReadyDocumentMountKeysRef.current.has(document.mountKey)
    ) {
      markDocumentPaintReady(document.mountKey);
    }
  }, [
    assignExternalNode,
    markDocumentPaintReady,
    onLoad,
    progressiveDocumentLoad,
  ]);

  const handlePendingLoad = useCallback((
    event: SyntheticEvent<HTMLIFrameElement>,
    document: BufferedDocument,
  ) => {
    if (failedDocumentMountKeysRef.current.has(document.mountKey)) return;
    // The parent may transfer cached binary assets into this hidden opaque
    // realm without changing which iframe still receives realtime edits.
    if (!bufferedDocumentHasContent(document)) return;
    const semanticNavigation = document.surfaceKey !== visibleDocument.surfaceKey;
    onBufferedLoad?.(
      event,
      document.key,
      document.revision,
      document.surfaceKey,
      semanticNavigation,
    );
    if (
      (progressiveDocumentLoad || (progressiveSemanticNavigation && semanticNavigation))
      && !paintReadyDocumentMountKeysRef.current.has(document.mountKey)
    ) {
      // The translated HTML/runtime preview is already local. Let it own the
      // surface as soon as its load event crosses the compositor barrier;
      // fonts and optional media can continue settling inside the active frame.
      markDocumentPaintReady(document.mountKey);
    }
  }, [
    markDocumentPaintReady,
    onBufferedLoad,
    progressiveDocumentLoad,
    progressiveSemanticNavigation,
    visibleDocument.surfaceKey,
  ]);

  const retainedDocuments = Array.from(retainedDocumentsRef.current.values()).filter(document => (
    document.mountKey !== visibleDocument.mountKey
    && document.mountKey !== pendingDocument?.mountKey
  ));
  const documents = pendingDocument
    ? [
      { ...visibleDocument, pending: false, retained: false },
      ...retainedDocuments.map(document => ({ ...document, pending: false, retained: true })),
      { ...pendingDocument, pending: true, retained: false },
    ]
    : [
      { ...visibleDocument, pending: false, retained: false },
      ...retainedDocuments.map(document => ({ ...document, pending: false, retained: true })),
    ];
  const switchingSemanticSurface = Boolean(
    pendingDocument
    && pendingDocument.surfaceKey !== visibleDocument.surfaceKey,
  );

  return (
    <>
      {documents.map(document => (
        (() => {
          const transitioning = Boolean(
            promotionTransition
            && pendingDocument
            && transitionDocumentKey === pendingDocument.key,
          );
          const incoming = Boolean(document.pending && transitioning);
          const outgoing = Boolean(!document.pending && !document.retained && transitioning);
          const awaitingParentPromotion = Boolean(
            !document.pending
            && !document.retained
            && promotionNotificationRef.current?.document.mountKey === document.mountKey,
          );
          const outgoingSemanticSurface = Boolean(
            !document.pending
            && !document.retained
            && switchingSemanticSurface,
          );
          const nonInteractive = Boolean(
            readinessError
            || document.pending
            || document.retained
            || awaitingParentPromotion
            || outgoingSemanticSurface,
          );
          const frameStyle = promotionTransition && (incoming || outgoing)
            ? previewPageTransitionFrameStyle(
                promotionTransition,
                incoming ? 'incoming' : 'outgoing',
                transitionActive,
                style,
              )
            : style;
          return (
            <iframe
              {...props}
              key={document.mountKey}
              ref={document.pending
                ? setPendingNode
                : document.retained
                  ? setRetainedNode
                  : setVisibleNode}
              src={document.src || undefined}
              srcDoc={document.src ? undefined : document.srcDoc}
              onLoad={event => {
                if (document.pending) handlePendingLoad(event, document);
                else if (!document.retained) handleVisibleLoad(event, document);
              }}
              aria-hidden={nonInteractive ? true : props['aria-hidden']}
              inert={nonInteractive ? true : props.inert}
              tabIndex={nonInteractive ? -1 : props.tabIndex}
              style={frameStyle}
              className={cn(
                className,
                (document.pending || document.retained) && 'absolute inset-0 z-0',
                nonInteractive && 'pointer-events-none',
                !document.pending && !document.retained && 'relative z-[1]',
                // A fully transparent/hidden subtree may be skipped by Blink's
                // rasterizer. Keep one percent opacity on buffered layers so a
                // complete compositor surface exists before the atomic swap;
                // the active frame (or first-paint shield) remains above it.
                (document.retained || (document.pending && !incoming))
                  && 'opacity-[0.01] will-change-[opacity]',
                !document.pending && !document.retained && !initialVisualReady
                  && 'opacity-[0.01] will-change-[opacity]',
                incoming && 'z-[1] visible',
              )}
            />
          );
        })()
      ))}
      <div
        data-html-buffered-iframe-buffer-mask
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        // Almost opaque keeps buffered iframe surfaces technically exposed to
        // composition (no occlusion shortcut), while making their 1% warm-up
        // layer visually indistinguishable behind a transparent component.
        style={{ backgroundColor: paintShieldColor, opacity: 0.999 }}
      />
      {readinessError && (
        <div
          data-html-buffered-iframe-load-error
          role="alert"
          className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 px-5 text-center text-sm text-white"
          style={{ backgroundColor: paintShieldColor }}
        >
          <p>Não foi possível carregar a página atual.</p>
          <button
            ref={recoveryButtonRef}
            type="button"
            className="rounded-md border border-white/20 px-3 py-2 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={retryCurrentDocument}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {!initialVisualReady && !readinessError && (
        <div
          data-html-buffered-iframe-paint-shield
          role="status"
          aria-label="Renderizando projeto"
          className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center"
          style={{
            backgroundColor: paintShieldColor,
            backgroundImage: builderLoading
              ? undefined
              : 'radial-gradient(circle at 50% 42%, rgba(255,255,255,.055), transparent 34%)',
          }}
        >
          {builderLoading ? (
            <KodetyLoadingScreen
              className="size-full min-h-0 min-w-0"
              label="Carregando componente"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[11px] font-medium text-white/60 shadow-sm backdrop-blur-sm"
            >
              <span className="size-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
              <span>Renderizando projeto…</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const OPAQUE_DOCUMENT_FACTORY_CHANNEL = 'kodety-opaque-preview-document-v1';
const OPAQUE_DOCUMENT_FACTORY_HTML = String.raw`<!doctype html>
<meta charset="utf-8">
<script>
(() => {
  const channel = 'kodety-opaque-preview-document-v1';
  const normalizedClientOrigin = value => {
    try {
      const url = new URL(String(value || ''));
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.origin : '';
    } catch {
      return '';
    }
  };
  const normalizedYoutubeEmbedUrl = (value, clientOrigin) => {
    try {
      const url = new URL(String(value || ''), clientOrigin + '/');
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === clientOrigin
        ? url.toString()
        : '';
    } catch {
      return '';
    }
  };
  const addPlayerPermissions = frame => {
    const permissions = new Set(
      String(frame.getAttribute('allow') || '')
        .split(';')
        .map(value => value.trim())
        .filter(Boolean),
    );
    [
      'accelerometer',
      'autoplay',
      'clipboard-write',
      'encrypted-media',
      'fullscreen',
      'gyroscope',
      'picture-in-picture',
      'web-share',
    ].forEach(value => permissions.add(value));
    frame.setAttribute('allow', Array.from(permissions).join('; '));
    frame.setAttribute('allowfullscreen', '');
  };
  const preparePlayerEmbeds = (html, rawClientOrigin, rawYoutubeEmbedUrl) => {
    const clientOrigin = normalizedClientOrigin(rawClientOrigin);
    if (!clientOrigin) return html;
    const youtubeEmbedUrl = normalizedYoutubeEmbedUrl(rawYoutubeEmbedUrl, clientOrigin);
    const document = new DOMParser().parseFromString(String(html || ''), 'text/html');
    document.querySelectorAll('iframe[src]').forEach(frame => {
      const source = String(frame.getAttribute('src') || '').trim();
      if (!source) return;
      let url;
      try {
        url = new URL(source, clientOrigin + '/');
      } catch {
        return;
      }
      const host = url.hostname.toLowerCase();
      const youtube = host === 'youtube.com'
        || host.endsWith('.youtube.com')
        || host === 'youtube-nocookie.com'
        || host.endsWith('.youtube-nocookie.com');
      const vimeo = host === 'vimeo.com'
        || host.endsWith('.vimeo.com');
      if (!youtube && !vimeo) return;
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      addPlayerPermissions(frame);
      if (youtube) {
        url.searchParams.set('origin', clientOrigin);
        url.searchParams.set('widget_referrer', clientOrigin);
        if (youtubeEmbedUrl) {
          // YouTube now requires an HTTP Referer. The executable Preview has a
          // deliberately opaque data: origin, so route only this trusted player
          // through the plugin's inert same-site shell.
          const shellUrl = new URL(youtubeEmbedUrl);
          shellUrl.searchParams.set('url', url.toString());
          frame.setAttribute('src', shellUrl.toString());
        } else {
          frame.setAttribute('src', url.toString());
        }
      }
    });
    return '<!doctype html>\n' + document.documentElement.outerHTML;
  };
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== channel) return;
    const data = event.data;
    const id = String(data.id || '');
    if (!id) return;
    if (data.type !== 'create') return;
    try {
      const html = preparePlayerEmbeds(data.html, data.clientOrigin, data.youtubeEmbedUrl);
      parent.postMessage({ channel, type: 'created', id, html }, '*');
    } catch {
      parent.postMessage({ channel, type: 'error', id }, '*');
    }
  });
})();
</script>`;

interface PreparedOpaqueDocument {
  documentKey: string;
  html: string;
  requestId: string;
  sourceHtml: string;
  youtubeEmbedUrl: string;
}

interface MountableOpaqueDocument {
  documentKey: string;
  documentRevision: number;
  html: string;
  surfaceKey: string;
}

export type HtmlOpaqueOriginBufferedIframeProps = Omit<
  HtmlBufferedIframeProps,
  'src' | 'srcDoc'
> & {
  srcDoc: string;
  youtubeEmbedUrl?: string;
};

/**
 * Prepares third-party players, then loads Preview through sandboxed srcDoc.
 *
 * Keeping srcDoc is essential: relative scripts, styles and images continue to
 * resolve through the Builder's existing asset bridge, while the missing
 * `allow-same-origin` token still gives authored code an opaque origin. Only
 * YouTube is routed through the inert WordPress player shell so it receives an
 * HTTP Referer without granting authored code access to the Builder.
 */
export function HtmlOpaqueOriginBufferedIframe({
  documentKey,
  documentRevision = 0,
  srcDoc,
  sandbox,
  surfaceKey = 'default',
  youtubeEmbedUrl = '',
  ...props
}: HtmlOpaqueOriginBufferedIframeProps) {
  const factoryRef = useRef<HTMLIFrameElement | null>(null);
  const latestRequestRef = useRef<{
    documentKey: string;
    html: string;
    requestId: string;
    youtubeEmbedUrl: string;
    sent?: boolean;
    completed?: boolean;
  } | null>(null);
  const requestSequenceRef = useRef(0);
  const [factoryReady, setFactoryReady] = useState(false);
  const [prepared, setPrepared] = useState<PreparedOpaqueDocument | null>(null);
  const [preparationFailed, setPreparationFailed] = useState(false);
  const lastMountableDocumentRef = useRef<MountableOpaqueDocument | null>(null);
  const requiresPlayerPreparation = /<iframe\b/i.test(srcDoc)
    && /(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com)/i.test(srcDoc);

  useLayoutEffect(() => {
    if (requiresPlayerPreparation) return;
    // If a later page needs the factory again, wait for that newly mounted
    // iframe's load event instead of posting into a browsing context that was
    // just discarded with the previous player page.
    setFactoryReady(false);
  }, [requiresPlayerPreparation]);

  const postFactoryMessage = useCallback((message: Record<string, unknown>) => {
    factoryRef.current?.contentWindow?.postMessage({
      channel: OPAQUE_DOCUMENT_FACTORY_CHANNEL,
      ...message,
    }, '*');
  }, []);

  useLayoutEffect(() => {
    if (!requiresPlayerPreparation) return;
    const handleFactoryMessage = (event: MessageEvent) => {
      const factoryWindow = factoryRef.current?.contentWindow;
      const data = event.data as {
        channel?: string;
        type?: string;
        id?: string;
        html?: string;
      } | null;
      if (
        !factoryWindow
        || event.source !== factoryWindow
        || data?.channel !== OPAQUE_DOCUMENT_FACTORY_CHANNEL
      ) return;
      const request = latestRequestRef.current;
      const requestId = String(data.id || '');
      if (!requestId) return;
      if (data.type === 'error') {
        if (request?.requestId === requestId) setPreparationFailed(true);
        return;
      }
      if (data.type !== 'created') return;
      const html = String(data.html || '');
      if (!html) {
        if (request?.requestId === requestId) setPreparationFailed(true);
        return;
      }
      if (!request || request.requestId !== requestId) return;
      request.completed = true;
      setPreparationFailed(false);
      setPrepared({
        documentKey: request.documentKey,
        html,
        requestId,
        sourceHtml: request.html,
        youtubeEmbedUrl: request.youtubeEmbedUrl,
      });
    };
    window.addEventListener('message', handleFactoryMessage);
    return () => window.removeEventListener('message', handleFactoryMessage);
  }, [requiresPlayerPreparation]);

  useLayoutEffect(() => {
    if (!requiresPlayerPreparation) {
      latestRequestRef.current = null;
      setPreparationFailed(false);
      return;
    }
    requestSequenceRef.current += 1;
    const requestId = `${documentKey || 'preview'}:${requestSequenceRef.current}`;
    const request = { documentKey, html: srcDoc, requestId, youtubeEmbedUrl, sent: false, completed: false };
    latestRequestRef.current = request;
    setPreparationFailed(false);
    // Include factory initialization in the deadline: its load event can also
    // be blocked. Expired requests cannot replace the current plain document.
    const failOpenTimer = window.setTimeout(() => {
      if (latestRequestRef.current !== request || request.completed) return;
      latestRequestRef.current = null;
      setPreparationFailed(true);
    }, 1200);
    return () => {
      window.clearTimeout(failOpenTimer);
      if (latestRequestRef.current === request) latestRequestRef.current = null;
    };
  }, [documentKey, requiresPlayerPreparation, srcDoc, youtubeEmbedUrl]);

  useLayoutEffect(() => {
    const request = latestRequestRef.current;
    if (!requiresPlayerPreparation || !factoryReady || !request || request.sent) return;
    request.sent = true;
    postFactoryMessage({
      type: 'create',
      id: request.requestId,
      html: request.html,
      clientOrigin: window.location.origin,
      youtubeEmbedUrl: request.youtubeEmbedUrl,
    });
  }, [documentKey, factoryReady, postFactoryMessage, requiresPlayerPreparation, srcDoc, youtubeEmbedUrl]);

  const preparedForCurrentDocument = Boolean(
    !preparationFailed
    && prepared
    && prepared.documentKey === documentKey
    && prepared.sourceHtml === srcDoc
    && prepared.youtubeEmbedUrl === youtubeEmbedUrl,
  );
  const previewCanMount = !requiresPlayerPreparation
    || preparedForCurrentDocument
    || preparationFailed;
  const previewHtml = preparedForCurrentDocument && prepared ? prepared.html : srcDoc;
  const currentMountableDocument = !requiresPlayerPreparation
    ? { documentKey, documentRevision, html: srcDoc, surfaceKey }
    : previewCanMount
      ? { documentKey, documentRevision, html: previewHtml, surfaceKey }
      : null;
  useLayoutEffect(() => {
    if (!currentMountableDocument) return;
    // Record only committed documents. Mutating this fallback during render
    // could retain an abandoned concurrent render and later label it as the
    // last page the visitor actually saw.
    lastMountableDocumentRef.current = currentMountableDocument;
  }, [currentMountableDocument]);
  const mountableDocument = currentMountableDocument || lastMountableDocumentRef.current;

  return (
    <>
      {requiresPlayerPreparation ? (
        <iframe
          ref={factoryRef}
          title="Preparador isolado do Preview"
          sandbox="allow-scripts"
          srcDoc={OPAQUE_DOCUMENT_FACTORY_HTML}
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute size-px opacity-0"
          onLoad={() => setFactoryReady(true)}
        />
      ) : null}
      {mountableDocument ? (
        <HtmlBufferedIframe
          {...props}
          documentKey={mountableDocument.documentKey}
          documentRevision={mountableDocument.documentRevision}
          srcDoc={mountableDocument.html}
          sandbox={sandbox}
          surfaceKey={mountableDocument.surfaceKey}
        />
      ) : null}
    </>
  );
}
