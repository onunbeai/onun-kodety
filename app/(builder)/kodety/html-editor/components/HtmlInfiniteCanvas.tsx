'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Globe2,
  Hand,
  Infinity as InfinityIcon,
  Maximize2,
  MousePointer2,
  Play,
  ZoomIn,
  ZoomOut,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  clampInfiniteCanvasZoom,
  fitInfiniteCanvasView,
  focusInfiniteCanvasFrame,
  layoutInfiniteCanvasFrames,
  normalizeInfiniteCanvasView,
  zoomInfiniteCanvasAtPoint,
  type InfiniteCanvasView,
} from '@/lib/html-editor/infinite-canvas';
import {
  defaultInfiniteCanvasViewportHeight,
  injectInfiniteCanvasPassiveRuntime,
  injectInfiniteCanvasRuntime,
} from '@/lib/html-editor/infinite-canvas-runtime';
import { HtmlBufferedIframe } from './HtmlBufferedIframe';
import { HtmlExactViewport } from './HtmlExactViewport';

// v2 could persist a 2% view calculated while the canvas root was 0px tall.
// Use a new namespace so affected sessions recover with a real first fit.
const VIEW_PREFERENCE = 'html-editor:infinite-canvas-view:v3';
const ZOOM_PRESETS = [2, 5, 10, 25, 50, 75, 100, 125, 150];
const BREAKPOINT_FOCUS_TRANSITION_MS = 300;
// The old 24px world-space grid collapsed below one screen pixel at distant
// zoom levels. Keep a 40%-larger, pixel-aligned screen-space rhythm instead.
const INFINITE_CANVAS_DOT_GAP = 34;

function infiniteCanvasDotOffset(value: number) {
  const snapped = Math.round(value);
  return ((snapped % INFINITE_CANVAS_DOT_GAP) + INFINITE_CANVAS_DOT_GAP)
    % INFINITE_CANVAS_DOT_GAP;
}

export interface HtmlInfiniteCanvasFrame {
  id: string;
  label: string;
  detail: string;
  width: number;
  height: number;
  simulatedViewportHeight?: number;
}

export interface HtmlInfiniteCanvasHandle {
  fit: () => void;
  focusFrame: (id: string) => void;
  setFrameContentHeight: (id: string, height: number) => void;
  handleFrameWheel: (input: {
    deltaX: number;
    deltaY: number;
    zoom?: boolean;
    pan?: boolean;
    x?: number;
    y?: number;
  }) => void;
  setSpacePressed: (pressed: boolean) => void;
}

interface HtmlInfiniteCanvasProps {
  frames: HtmlInfiniteCanvasFrame[];
  activeId: string;
  html: string;
  passiveHtml: string;
  documentKey: string;
  sandbox: string;
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  localeLabel: string;
  viewPreferenceKey: string;
  activeFrameHeader?: ReactNode;
  dragInsertKey?: string | null;
  toolbarHost?: HTMLElement | null;
  onInfiniteCanvasChange: (enabled: boolean) => void;
  onSelectFrame: (id: string) => void;
  onPreviewFrame?: (id: string) => void;
  onActiveFrameLoad: () => void;
  onActiveFrameBufferedLoad?: (
    frame: HTMLIFrameElement,
    documentKey: string,
    documentRevision: number,
  ) => void;
  onPassiveFrameRegister?: (frame: Window, registered: boolean, id: string) => void;
  onPassiveFrameLoad?: (frame: HTMLIFrameElement, id: string) => void;
  onResizeFrame?: (
    id: string,
    property: 'width' | 'height',
    value: number,
    phase: 'preview' | 'commit',
  ) => void;
  onDragInsertPreview?: (key: string, clientX: number, clientY: number) => boolean;
  onDragInsertClear?: () => void;
  onDragInsertDrop?: (key: string, clientX: number, clientY: number) => void;
  onDragInsertEnd?: () => void;
}

export const HtmlInfiniteCanvas = forwardRef<
  HtmlInfiniteCanvasHandle,
  HtmlInfiniteCanvasProps
>(function HtmlInfiniteCanvas(
  {
    frames,
    activeId,
    html,
    passiveHtml,
    documentKey,
    sandbox,
    iframeRef,
    localeLabel,
    viewPreferenceKey,
    activeFrameHeader,
    dragInsertKey,
    toolbarHost,
    onInfiniteCanvasChange,
    onSelectFrame,
    onPreviewFrame,
    onActiveFrameLoad,
    onActiveFrameBufferedLoad,
    onPassiveFrameRegister,
    onPassiveFrameLoad,
    onResizeFrame,
    onDragInsertPreview,
    onDragInsertClear,
    onDragInsertDrop,
    onDragInsertEnd,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const passiveWindowsRef = useRef(new Map<string, Window>());
  const passiveFrameElementsRef = useRef(new Map<string, HTMLIFrameElement>());
  const loadedPassiveIdsRef = useRef(new Set<string>());
  const passiveFrameRefCallbacksRef = useRef(
    new Map<string, (node: HTMLIFrameElement | null) => void>(),
  );
  const activeIdRef = useRef(activeId);
  const previousActiveIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const activeIframeElementRef = useRef<HTMLIFrameElement | null>(null);
  const activeIframeLoadedRef = useRef(false);
  const activeIframePostedScaleRef = useRef<number | null>(null);
  const onPassiveFrameRegisterRef = useRef(onPassiveFrameRegister);
  const onPassiveFrameLoadRef = useRef(onPassiveFrameLoad);
  onPassiveFrameRegisterRef.current = onPassiveFrameRegister;
  onPassiveFrameLoadRef.current = onPassiveFrameLoad;
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);
  const activeGestureKindRef = useRef<'pan' | 'resize' | null>(null);
  const gestureScope = JSON.stringify([viewPreferenceKey, documentKey, activeId]);
  const gestureScopeRef = useRef(gestureScope);
  gestureScopeRef.current = gestureScope;
  const resizingRef = useRef(false);
  const restoredViewRef = useRef(false);
  const restoredViewKeyRef = useRef('');
  const lastLayoutSignatureRef = useRef('');
  const lastViewportSizeRef = useRef({ width: 0, height: 0 });
  const viewportRecoveryFrameRef = useRef<number | null>(null);
  const contentMeasurementUpdateRef = useRef(false);
  const contentFitTimerRef = useRef<number | null>(null);
  const heightCommitFrameRef = useRef<number | null>(null);
  const viewPersistenceTimerRef = useRef<number | null>(null);
  const pendingDocumentHeightsRef = useRef(new Map<string, number>());
  const hasFittedMeasuredContentRef = useRef(false);
  const userAdjustedViewRef = useRef(false);
  const [view, setView] = useState<InfiniteCanvasView>({
    zoom: 64,
    pan: { x: 72, y: 56 },
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const viewUpdateFrameRef = useRef<number | null>(null);
  const pendingViewUpdatesRef = useRef<Array<(
    current: InfiniteCanvasView,
  ) => InfiniteCanvasView>>([]);
  const scheduleViewUpdate = useCallback((
    update: (current: InfiniteCanvasView) => InfiniteCanvasView,
  ) => {
    pendingViewUpdatesRef.current.push(update);
    if (viewUpdateFrameRef.current !== null) return;
    viewUpdateFrameRef.current = window.requestAnimationFrame(() => {
      viewUpdateFrameRef.current = null;
      const updates = pendingViewUpdatesRef.current.splice(0);
      if (!updates.length) return;
      setView(current => updates.reduce(
        (next, applyUpdate) => applyUpdate(next),
        current,
      ));
    });
  }, []);
  const cancelScheduledViewUpdates = useCallback(() => {
    if (viewUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(viewUpdateFrameRef.current);
      viewUpdateFrameRef.current = null;
    }
    pendingViewUpdatesRef.current = [];
  }, []);
  const postActiveViewScale = useCallback((force = false) => {
    const frame = activeIframeElementRef.current?.contentWindow;
    const scale = viewRef.current.zoom / 100;
    if (
      !frame
      || !activeIframeLoadedRef.current
      || !documentKey
      || (
        !force
        && activeIframePostedScaleRef.current !== null
        && Math.abs(activeIframePostedScaleRef.current - scale) < .0001
      )
    ) return;
    activeIframePostedScaleRef.current = scale;
    frame.postMessage({
      type: 'html-editor-canvas-view-scale',
      generation: documentKey,
      scale,
    }, '*');
  }, [documentKey]);
  const [panTool, setPanTool] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const setSpaceHeld = useCallback((pressed: boolean) => {
    setSpacePressed(pressed);
    if (!pressed && activeGestureKindRef.current === 'pan') activeGestureCleanupRef.current?.();
  }, []);
  const [panning, setPanning] = useState(false);
  const [focusTransitioning, setFocusTransitioning] = useState(false);
  const focusTransitionTimerRef = useRef<number | null>(null);
  const cancelFocusTransition = useCallback(() => {
    if (focusTransitionTimerRef.current !== null) {
      window.clearTimeout(focusTransitionTimerRef.current);
      focusTransitionTimerRef.current = null;
    }
    setFocusTransitioning(false);
  }, []);
  const [documentHeightState, setDocumentHeightState] = useState<{
    key: string;
    scopeKey: string;
    heights: Record<string, number>;
  }>({ key: documentKey, scopeKey: viewPreferenceKey, heights: {} });
  // A generation change rebuilds the iframe but does not change the page/canvas
  // scope. Keep the last measured geometry during that navigation so the plane
  // never collapses to its default heights or triggers an unrelated auto-fit.
  const documentHeights = documentHeightState.scopeKey === viewPreferenceKey
    ? documentHeightState.heights
    : {};
  // Every reference uses the same immutable srcDoc. Per-breakpoint viewport
  // values arrive over postMessage after load, so preparing N references costs
  // one serialization instead of N full HTML/runtime strings.
  const passiveDocument = useMemo(
    () => injectInfiniteCanvasPassiveRuntime(passiveHtml),
    [documentKey, passiveHtml],
  );
  const activeFrameDescriptor = frames.find(frame => frame.id === activeId) ?? frames[0];
  const activeDefaultViewportHeight = activeFrameDescriptor
    ? (
      activeFrameDescriptor.simulatedViewportHeight
      ?? defaultInfiniteCanvasViewportHeight(activeFrameDescriptor.width)
    )
    : 1080;
  const activeDocumentCacheRef = useRef<{
    documentKey: string;
    html: string;
    source: string;
  } | null>(null);
  if (
    !activeDocumentCacheRef.current
    || activeDocumentCacheRef.current.documentKey !== documentKey
    || activeDocumentCacheRef.current.html !== html
  ) {
    activeDocumentCacheRef.current = {
      documentKey,
      html,
      source: injectInfiniteCanvasRuntime(html, {
        defaultViewportHeight: activeDefaultViewportHeight,
      }),
    };
  }
  const activeDocument = activeDocumentCacheRef.current.source;

  // Frames show the complete page instead of an arbitrary 900/1080px crop.
  // The iframe runtime resolves authored viewport-height units against an
  // independent per-section simulation before reporting this measurement, so
  // expanding the iframe cannot create a scrollHeight/vh feedback loop.
  const renderedFrames = useMemo(
    () => frames.map(frame => ({
      ...frame,
      height: Math.max(1, Math.ceil(documentHeights[frame.id] ?? frame.height)),
    })),
    [documentHeights, frames],
  );
  const layout = useMemo(
    () => layoutInfiniteCanvasFrames(renderedFrames),
    [renderedFrames],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const activeLayoutFrame = layout.frames.find(frame => frame.id === activeId)
    ?? layout.frames[0];
  const layoutSignature = renderedFrames
    .map(frame => `${frame.id}:${frame.width}:${frame.height}`)
    .join('|');
  const persistedViewKey = `${VIEW_PREFERENCE}:${viewPreferenceKey}`;
  const persistedViewKeyRef = useRef(persistedViewKey);
  persistedViewKeyRef.current = persistedViewKey;

  useLayoutEffect(() => {
    setDocumentHeightState(current => ({
      key: documentKey,
      scopeKey: viewPreferenceKey,
      heights: current.scopeKey === viewPreferenceKey ? current.heights : {},
    }));
    if (heightCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(heightCommitFrameRef.current);
      heightCommitFrameRef.current = null;
    }
    pendingDocumentHeightsRef.current.clear();
    if (contentFitTimerRef.current !== null) {
      window.clearTimeout(contentFitTimerRef.current);
      contentFitTimerRef.current = null;
    }
  }, [documentKey, viewPreferenceKey]);

  useLayoutEffect(() => {
    // The passive copy behind the editable iframe stays mounted, but its
    // measurement messages must not compete with the active document for the
    // same breakpoint id. Re-register it only when it becomes a reference.
    passiveWindowsRef.current.forEach((frameWindow, id) => {
      const reference = id !== activeId;
      onPassiveFrameRegisterRef.current?.(frameWindow, reference, id);
      if (reference) {
        frameWindow.postMessage({
          type: 'html-editor-infinite-canvas-refresh-height',
          generation: documentKey,
        }, '*');
      }
    });

    const previousActiveId = previousActiveIdRef.current;
    previousActiveIdRef.current = activeId;
    if (previousActiveId !== activeId && loadedPassiveIdsRef.current.has(previousActiveId)) {
      const previousActiveFrame = passiveFrameElementsRef.current.get(previousActiveId);
      if (previousActiveFrame) {
        onPassiveFrameLoadRef.current?.(previousActiveFrame, previousActiveId);
      }
    }

    const activeIframe = activeIframeElementRef.current;
    if (!activeIframe || !activeIframeLoadedRef.current) return;
    activeIframe.contentWindow?.postMessage({
      type: 'html-editor-infinite-canvas-default-height',
      generation: documentKey,
      height: activeDefaultViewportHeight,
    }, '*');
    // The existing callback replays this breakpoint's persisted per-section
    // viewport values and runtime assets without requiring a parent API change.
    onPassiveFrameLoadRef.current?.(activeIframe, activeId);
  }, [activeDefaultViewportHeight, activeId, documentKey]);

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container || container.clientWidth <= 1 || container.clientHeight <= 1) return;
    cancelScheduledViewUpdates();
    setView(fitInfiniteCanvasView(
      { width: container.clientWidth, height: container.clientHeight },
      layoutRef.current,
    ));
  }, [cancelScheduledViewUpdates]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateViewportSize = () => {
      const previous = lastViewportSizeRef.current;
      const next = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      lastViewportSizeRef.current = next;
      const recoveredFromCollapsedLayout = (
        previous.width <= 1
        || previous.height <= 1
      ) && next.width > 1 && next.height > 1;
      if (!recoveredFromCollapsedLayout) return;
      if (viewportRecoveryFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportRecoveryFrameRef.current);
      }
      viewportRecoveryFrameRef.current = window.requestAnimationFrame(() => {
        viewportRecoveryFrameRef.current = null;
        // Restoration and user input can happen after this frame is queued.
        // Never replace their camera with the initial collapsed-layout fit.
        if (userAdjustedViewRef.current) return;
        fit();
      });
    };
    updateViewportSize();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateViewportSize);
    observer?.observe(container);
    window.addEventListener('resize', updateViewportSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateViewportSize);
      if (viewportRecoveryFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportRecoveryFrameRef.current);
        viewportRecoveryFrameRef.current = null;
      }
    };
  }, [fit]);

  const focusFrame = useCallback((id: string) => {
    const container = containerRef.current;
    const frame = layoutRef.current.frames.find(candidate => candidate.id === id);
    if (!container || !frame) return;
    // A breakpoint click is an explicit navigation choice. Prevent the
    // deferred first-measurement fit from subsequently zooming back out.
    userAdjustedViewRef.current = true;
    cancelScheduledViewUpdates();
    cancelFocusTransition();
    setFocusTransitioning(true);
    setView(current => focusInfiniteCanvasFrame(
      current,
      { width: container.clientWidth, height: container.clientHeight },
      frame,
    ));
    focusTransitionTimerRef.current = window.setTimeout(() => {
      focusTransitionTimerRef.current = null;
      setFocusTransitioning(false);
    }, BREAKPOINT_FOCUS_TRANSITION_MS);
  }, [cancelFocusTransition, cancelScheduledViewUpdates]);

  useLayoutEffect(() => {
    if (
      restoredViewRef.current
      && restoredViewKeyRef.current === persistedViewKey
    ) return;
    hasFittedMeasuredContentRef.current = false;
    userAdjustedViewRef.current = false;
    let restored: InfiniteCanvasView | null = null;
    try {
      restored = normalizeInfiniteCanvasView(
        JSON.parse(window.localStorage.getItem(persistedViewKey) || 'null'),
      );
    } catch {
      try { window.localStorage.removeItem(persistedViewKey); } catch { /* Storage may be unavailable. */ }
    }
    restoredViewRef.current = true;
    restoredViewKeyRef.current = persistedViewKey;
    lastLayoutSignatureRef.current = layoutSignature;
    const container = containerRef.current;
    const scale = restored ? restored.zoom / 100 : 1;
    const intersectsViewport = Boolean(restored && container
      && restored.pan.x + layout.width * scale > 40
      && restored.pan.y + layout.height * scale > 40
      && restored.pan.x < container.clientWidth - 40
      && restored.pan.y < container.clientHeight - 40);
    if (restored && intersectsViewport) {
      userAdjustedViewRef.current = true;
      setView(restored);
    } else window.requestAnimationFrame(fit);
  }, [fit, layout.height, layout.width, layoutSignature, persistedViewKey]);

  useLayoutEffect(() => {
    if (!restoredViewRef.current) return;
    if (resizingRef.current) {
      lastLayoutSignatureRef.current = layoutSignature;
      return;
    }
    if (!lastLayoutSignatureRef.current) {
      lastLayoutSignatureRef.current = layoutSignature;
      return;
    }
    if (lastLayoutSignatureRef.current === layoutSignature) return;
    lastLayoutSignatureRef.current = layoutSignature;
    if (contentMeasurementUpdateRef.current) {
      contentMeasurementUpdateRef.current = false;
      return;
    }
    window.requestAnimationFrame(fit);
  }, [fit, layoutSignature]);

  useEffect(() => {
    if (!restoredViewRef.current) return;
    if (viewPersistenceTimerRef.current !== null) {
      window.clearTimeout(viewPersistenceTimerRef.current);
    }
    viewPersistenceTimerRef.current = window.setTimeout(() => {
      viewPersistenceTimerRef.current = null;
      try {
        window.localStorage.setItem(persistedViewKey, JSON.stringify(viewRef.current));
      } catch {
        // Private browsing may reject preferences; canvas interaction still works.
      }
    }, 180);
    return () => {
      if (viewPersistenceTimerRef.current === null) return;
      window.clearTimeout(viewPersistenceTimerRef.current);
      viewPersistenceTimerRef.current = null;
    };
  }, [persistedViewKey, view]);

  useLayoutEffect(() => {
    postActiveViewScale();
  }, [postActiveViewScale, view.zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select, [role], [contenteditable="true"]')) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpaceHeld(false);
    };
    const resetHeldInput = () => {
      setSpacePressed(false);
      activeGestureCleanupRef.current?.();
    };
    const onVisibilityChange = () => { if (document.hidden) resetHeldInput(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', resetHeldInput);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', resetHeldInput);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setSpaceHeld]);

  useLayoutEffect(() => {
    activeGestureCleanupRef.current?.();
    cancelScheduledViewUpdates();
    setSpaceHeld(false);
  }, [cancelScheduledViewUpdates, gestureScope, setSpaceHeld]);

  useEffect(
    () => () => {
      activeGestureCleanupRef.current?.();
      activeGestureCleanupRef.current = null;
      // Unregister every browsing context explicitly before this topology
      // disappears. Ref callbacks normally do this during the same commit, but
      // the parent must never retain a reference frame that can post into the
      // normal canvas generation.
      passiveWindowsRef.current.forEach((frameWindow, id) => {
        onPassiveFrameRegisterRef.current?.(frameWindow, false, id);
      });
      passiveWindowsRef.current.clear();
      passiveFrameElementsRef.current.clear();
      loadedPassiveIdsRef.current.clear();
      passiveFrameRefCallbacksRef.current.clear();
      if (iframeRef.current === activeIframeElementRef.current) {
        iframeRef.current = null;
      }
      activeIframeElementRef.current = null;
      activeIframeLoadedRef.current = false;
      activeIframePostedScaleRef.current = null;
      if (contentFitTimerRef.current !== null) {
        window.clearTimeout(contentFitTimerRef.current);
        contentFitTimerRef.current = null;
      }
      if (viewportRecoveryFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportRecoveryFrameRef.current);
        viewportRecoveryFrameRef.current = null;
      }
      if (focusTransitionTimerRef.current !== null) {
        window.clearTimeout(focusTransitionTimerRef.current);
        focusTransitionTimerRef.current = null;
      }
      if (viewUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(viewUpdateFrameRef.current);
        viewUpdateFrameRef.current = null;
      }
      pendingViewUpdatesRef.current = [];
      if (viewPersistenceTimerRef.current !== null) {
        window.clearTimeout(viewPersistenceTimerRef.current);
        viewPersistenceTimerRef.current = null;
      }
      try {
        window.localStorage.setItem(
          persistedViewKeyRef.current,
          JSON.stringify(viewRef.current),
        );
      } catch {
        // Preference persistence is optional.
      }
      if (heightCommitFrameRef.current !== null) {
        window.cancelAnimationFrame(heightCommitFrameRef.current);
        heightCommitFrameRef.current = null;
      }
      pendingDocumentHeightsRef.current.clear();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    [],
  );

  const setSafeZoom = useCallback((zoom: number) => {
    userAdjustedViewRef.current = true;
    cancelScheduledViewUpdates();
    cancelFocusTransition();
    const container = containerRef.current;
    if (!container) {
      setView(current => ({ ...current, zoom: clampInfiniteCanvasZoom(zoom) }));
      return;
    }
    const point = {
      x: container.clientWidth / 2,
      y: container.clientHeight / 2,
    };
    setView(current => {
      const target = clampInfiniteCanvasZoom(zoom);
      const previousScale = current.zoom / 100;
      const nextScale = target / 100;
      const world = {
        x: (point.x - current.pan.x) / previousScale,
        y: (point.y - current.pan.y) / previousScale,
      };
      return {
        zoom: target,
        pan: {
          x: point.x - world.x * nextScale,
          y: point.y - world.y * nextScale,
        },
      };
    });
  }, [cancelFocusTransition, cancelScheduledViewUpdates]);

  const applyNavigationWheel = useCallback((
    deltaX: number,
    deltaY: number,
    zoom: boolean,
    horizontalPan: boolean,
    point?: { x: number; y: number },
  ) => {
    userAdjustedViewRef.current = true;
    cancelFocusTransition();
    if (zoom) {
      const container = containerRef.current;
      const anchor = point || {
        x: (container?.clientWidth || 0) / 2,
        y: (container?.clientHeight || 0) / 2,
      };
      scheduleViewUpdate(current => zoomInfiniteCanvasAtPoint(current, anchor, deltaY));
      return;
    }
    scheduleViewUpdate(current => ({
      ...current,
      pan: horizontalPan
        ? {
          x: current.pan.x - deltaX - deltaY,
          y: current.pan.y,
        }
        : {
          x: current.pan.x - deltaX,
          y: current.pan.y - deltaY,
        },
    }));
  }, [cancelFocusTransition, scheduleViewUpdate]);

  const handleFrameWheel = useCallback((input: {
    deltaX: number;
    deltaY: number;
    zoom?: boolean;
    pan?: boolean;
    x?: number;
    y?: number;
  }) => {
    const container = containerRef.current;
    const iframe = iframeRef.current;
    let point: { x: number; y: number } | undefined;
    if (
      container
      && iframe
      && Number.isFinite(input.x)
      && Number.isFinite(input.y)
    ) {
      const containerRect = container.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      point = {
        x: iframeRect.left - containerRect.left
          + Number(input.x) * iframeRect.width / Math.max(1, iframe.clientWidth),
        y: iframeRect.top - containerRect.top
          + Number(input.y) * iframeRect.height / Math.max(1, iframe.clientHeight),
      };
    }
    applyNavigationWheel(
      input.deltaX,
      input.deltaY,
      Boolean(input.zoom),
      Boolean(input.pan),
      point,
    );
  }, [applyNavigationWheel, iframeRef]);

  const setFrameContentHeight = useCallback((id: string, height: number) => {
    if (!Number.isFinite(height) || !frames.some(frame => frame.id === id)) return;
    const next = Math.max(1, Math.min(1_000_000, Math.ceil(height)));
    pendingDocumentHeightsRef.current.set(id, next);
    if (heightCommitFrameRef.current !== null) return;
    const measuredDocumentKey = documentKey;
    const measuredScopeKey = viewPreferenceKey;
    heightCommitFrameRef.current = window.requestAnimationFrame(() => {
      heightCommitFrameRef.current = null;
      const settled = new Map(pendingDocumentHeightsRef.current);
      pendingDocumentHeightsRef.current.clear();
      if (settled.size === 0) return;
      setDocumentHeightState(current => {
        const currentHeights = current.scopeKey === measuredScopeKey ? current.heights : {};
        const updated = { ...currentHeights };
        let changed = current.key !== measuredDocumentKey
          || current.scopeKey !== measuredScopeKey;
        settled.forEach((settledHeight, settledId) => {
          if (updated[settledId] === settledHeight) return;
          updated[settledId] = settledHeight;
          changed = true;
        });
        if (!changed) return current;
        contentMeasurementUpdateRef.current = true;
        if (
          !hasFittedMeasuredContentRef.current
          && !userAdjustedViewRef.current
          && frames.every(frame => updated[frame.id] !== undefined)
        ) {
          if (contentFitTimerRef.current !== null) {
            window.clearTimeout(contentFitTimerRef.current);
          }
          // All breakpoints have reported at least once. Wait for a quiet
          // window so late fonts/images do not repeatedly reframe the plane.
          contentFitTimerRef.current = window.setTimeout(() => {
            contentFitTimerRef.current = null;
            if (userAdjustedViewRef.current) return;
            hasFittedMeasuredContentRef.current = true;
            fit();
          }, 240);
        }
        return {
          key: measuredDocumentKey,
          scopeKey: measuredScopeKey,
          heights: updated,
        };
      });
    });
  }, [documentKey, fit, frames, viewPreferenceKey]);

  const setActiveIframeNode = useCallback((node: HTMLIFrameElement | null) => {
    if (activeIframeElementRef.current !== node) {
      activeIframeElementRef.current = node;
      activeIframeLoadedRef.current = false;
      activeIframePostedScaleRef.current = null;
    }
    iframeRef.current = node;
  }, [iframeRef]);

  const passiveFrameRef = useCallback((id: string) => {
    const cached = passiveFrameRefCallbacksRef.current.get(id);
    if (cached) return cached;
    const callback = (node: HTMLIFrameElement | null) => {
      const previous = passiveWindowsRef.current.get(id);
      const next = node?.contentWindow || null;
      if (previous && previous !== next) {
        passiveWindowsRef.current.delete(id);
        passiveFrameElementsRef.current.delete(id);
        loadedPassiveIdsRef.current.delete(id);
        onPassiveFrameRegisterRef.current?.(previous, false, id);
      }
      if (next && previous !== next) {
        passiveWindowsRef.current.set(id, next);
        if (node) passiveFrameElementsRef.current.set(id, node);
        onPassiveFrameRegisterRef.current?.(
          next,
          id !== activeIdRef.current,
          id,
        );
      }
    };
    passiveFrameRefCallbacksRef.current.set(id, callback);
    return callback;
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    fit,
    focusFrame,
    setFrameContentHeight,
    handleFrameWheel,
    setSpacePressed: setSpaceHeld,
  }), [fit, focusFrame, handleFrameWheel, setFrameContentHeight, setSpaceHeld]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    applyNavigationWheel(
      event.deltaX,
      event.deltaY,
      event.ctrlKey || event.metaKey,
      event.altKey,
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
    );
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!(panTool || spacePressed || event.button === 1)) return;
    userAdjustedViewRef.current = true;
    cancelFocusTransition();
    cancelScheduledViewUpdates();
    event.preventDefault();
    activeGestureCleanupRef.current?.();
    const origin = viewRef.current.pan;
    const start = { x: event.clientX, y: event.clientY };
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let finished = false;
    setPanning(true);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    try { handle.setPointerCapture(event.pointerId); } catch { /* Window fallback below. */ }
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || finished) return;
      scheduleViewUpdate(current => ({
        ...current,
        pan: {
          x: origin.x + moveEvent.clientX - start.x,
          y: origin.y + moveEvent.clientY - start.y,
        },
      }));
    };
    const onUp = (endEvent?: Event) => {
      if (endEvent && 'pointerId' in endEvent && endEvent.pointerId !== pointerId) return;
      if (finished) return;
      finished = true;
      setPanning(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      handle.removeEventListener('lostpointercapture', onUp);
      try { if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* Detached handle. */ }
      if (activeGestureCleanupRef.current === onUp) {
        activeGestureCleanupRef.current = null;
        activeGestureKindRef.current = null;
      }
    };
    activeGestureCleanupRef.current = onUp;
    activeGestureKindRef.current = 'pan';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    handle.addEventListener('lostpointercapture', onUp);
  };

  const startFrameResize = (
    frame: HtmlInfiniteCanvasFrame,
    axis: 'width' | 'height' | 'both',
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!onResizeFrame) return;
    event.preventDefault();
    event.stopPropagation();
    cancelFocusTransition();
    activeGestureCleanupRef.current?.();
    const start = { x: event.clientX, y: event.clientY };
    const scale = clampInfiniteCanvasZoom(viewRef.current.zoom) / 100;
    const pointerId = event.pointerId;
    const scope = gestureScopeRef.current;
    let finalWidth = frame.width;
    let finalHeight = frame.height;
    let finished = false;
    resizingRef.current = true;
    document.body.style.cursor = axis === 'width'
      ? 'ew-resize'
      : axis === 'height'
        ? 'ns-resize'
        : 'nwse-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || finished) return;
      if (axis !== 'height') {
        finalWidth = frame.width + (moveEvent.clientX - start.x) / scale;
        onResizeFrame(frame.id, 'width', finalWidth, 'preview');
      }
      if (axis !== 'width') {
        finalHeight = frame.height + (moveEvent.clientY - start.y) / scale;
        onResizeFrame(frame.id, 'height', finalHeight, 'preview');
      }
    };
    const onUp = (endEvent?: Event) => {
      if (endEvent && 'pointerId' in endEvent && endEvent.pointerId !== pointerId) return;
      if (finished) return;
      finished = true;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      if (activeGestureCleanupRef.current === onUp) activeGestureCleanupRef.current = null;
      activeGestureKindRef.current = null;
      if (scope !== gestureScopeRef.current) return;
      if (axis !== 'height' && Math.round(finalWidth) !== Math.round(frame.width)) {
        onResizeFrame(frame.id, 'width', finalWidth, 'commit');
      }
      if (axis !== 'width' && Math.round(finalHeight) !== Math.round(frame.height)) {
        onResizeFrame(frame.id, 'height', finalHeight, 'commit');
      }
    };
    activeGestureCleanupRef.current = onUp;
    activeGestureKindRef.current = 'resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  };

  const markActiveDocumentReady = () => {
    activeIframeLoadedRef.current = true;
    activeIframePostedScaleRef.current = null;
    postActiveViewScale(true);
    onActiveFrameLoad();
  };

  return (
    <div
      ref={containerRef}
      data-infinite-canvas
      className={cn(
        'relative h-full min-h-0 w-full min-w-0 flex-1 select-none overflow-hidden bg-[#171717]',
        panning ? 'cursor-grabbing' : (panTool || spacePressed) ? 'cursor-grab' : 'cursor-default',
      )}
      style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.065) 1px, transparent 0)',
        backgroundPosition: `${infiniteCanvasDotOffset(view.pan.x)}px ${infiniteCanvasDotOffset(view.pan.y)}px`,
        backgroundSize: `${INFINITE_CANVAS_DOT_GAP}px ${INFINITE_CANVAS_DOT_GAP}px`,
      }}
      onWheel={handleWheel}
      onPointerDown={startPan}
      onContextMenu={(event) => {
        if (panTool || spacePressed) event.preventDefault();
      }}
    >
      <div
        className={cn(
          'absolute left-0 top-0 origin-top-left',
          focusTransitioning
            && 'transition-transform duration-300 ease-out motion-reduce:transition-none',
        )}
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.zoom / 100})`,
        }}
      >
        <HtmlExactViewport width={layout.width} height={layout.height}>
          {layout.frames.map(frame => {
            const descriptor = frames.find(item => item.id === frame.id)!;
            const active = frame.id === activeId;
            const referenceDocumentKey = `${documentKey}:${descriptor.id}:reference`;
            const loadReferenceDocument = (node: HTMLIFrameElement, loadedKey: string) => {
              if (loadedKey !== referenceDocumentKey) return;
              loadedPassiveIdsRef.current.add(frame.id);
              node.contentWindow?.postMessage({
                type: 'html-editor-infinite-canvas-default-height',
                generation: documentKey,
                height: descriptor.simulatedViewportHeight
                  ?? defaultInfiniteCanvasViewportHeight(descriptor.width),
              }, '*');
              onPassiveFrameLoadRef.current?.(node, frame.id);
            };
            return (
              <div
                key={frame.id}
                data-infinite-canvas-frame={frame.id}
                className="absolute"
                style={{
                  left: frame.x,
                  top: frame.y,
                  width: frame.width,
                  height: frame.height + 36,
                }}
              >
                {active && activeFrameHeader ? (
                  <div className="flex h-9 items-center rounded-t-[7px] border border-[var(--kodety-accent)]/70 bg-[var(--kodety-accent-muted)] p-1 text-[var(--kodety-accent-hover)]">
                    {activeFrameHeader}
                  </div>
                ) : (
                  <div
                    className={cn(
                      'flex h-9 w-full items-center gap-2 rounded-t-[7px] border px-2.5 text-left text-[12px] font-medium transition-colors',
                      active
                        ? 'border-[var(--kodety-accent)]/70 bg-[var(--kodety-accent-muted)] text-[var(--kodety-accent-hover)]'
                        : 'border-white/10 bg-[#2a2a2a] text-zinc-400',
                    )}
                  >
                    <button
                      type="button"
                      className="flex size-6 shrink-0 items-center justify-center rounded-[4px] text-current transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kodety-focus)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPreviewFrame?.(frame.id);
                      }}
                      disabled={!onPreviewFrame}
                      title={`Preview de ${descriptor.label}`}
                      aria-label={`Abrir preview de ${descriptor.label}`}
                    >
                      <Play className="size-3 fill-current" />
                    </button>
                    <button
                      type="button"
                      className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[4px] text-left transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kodety-focus)]"
                      onClick={() => onSelectFrame(frame.id)}
                      aria-pressed={active}
                      aria-label={`Editar ${descriptor.label}`}
                    >
                      <span className="truncate">{descriptor.label}</span>
                      <span className="truncate font-normal tabular-nums text-current/55">
                        {descriptor.detail}
                      </span>
                    </button>
                  </div>
                )}
                <div
                  className="relative overflow-hidden bg-white shadow-[0_18px_48px_rgba(0,0,0,.28)] ring-1 ring-white/10"
                  style={{ width: frame.width, height: frame.height }}
                >
                  <HtmlBufferedIframe
                    // Retain one painted reference while its next generation
                    // prepares. No history cache: promotion releases the old
                    // browsing context, so each breakpoint owns at most two.
                    documentKey={referenceDocumentKey}
                    iframeRef={passiveFrameRef(frame.id)}
                    title={`${descriptor.label} — referência responsiva`}
                    sandbox="allow-scripts"
                    loading="eager"
                    scrolling="no"
                    srcDoc={passiveDocument}
                    tabIndex={-1}
                    aria-hidden
                    inert
                    onLoad={(event, loadedKey) => loadReferenceDocument(event.currentTarget, loadedKey)}
                    onBufferedLoad={(event, loadedKey) => loadReferenceDocument(event.currentTarget, loadedKey)}
                    onPromote={loadReferenceDocument}
                    className="pointer-events-none block size-full border-0 bg-white"
                  />
                  {!active && (
                    <button
                      type="button"
                      className="absolute inset-0 z-10 cursor-pointer bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                      onClick={() => onSelectFrame(frame.id)}
                      aria-label={`Ativar ${descriptor.label}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {activeLayoutFrame && activeFrameDescriptor && (
            <div
              data-infinite-canvas-active-iframe
              className={cn(
                'absolute z-20 overflow-hidden bg-white shadow-[0_18px_48px_rgba(0,0,0,.28)] ring-1 ring-[var(--kodety-focus)]',
                !resizingRef.current
                  && 'will-change-[left,top,width,height] transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none',
              )}
              style={{
                left: activeLayoutFrame.x,
                top: activeLayoutFrame.y + 36,
                width: activeLayoutFrame.width,
                height: activeLayoutFrame.height,
              }}
            >
              <HtmlBufferedIframe
                // This is the only editable document in the plane. Its identity,
                // source and permissions are independent from activeId; selecting
                // another breakpoint only moves and resizes this same browsing
                // context, preserving bridge state and avoiding a navigation.
                documentKey={`${documentKey}:active-editor`}
                iframeRef={setActiveIframeNode}
                title={`${activeFrameDescriptor.label} — editável`}
                sandbox={sandbox}
                allow="fullscreen; picture-in-picture"
                loading="eager"
                scrolling="no"
                srcDoc={activeDocument}
                style={{ width: activeLayoutFrame.width, height: activeLayoutFrame.height }}
                tabIndex={0}
                onLoad={markActiveDocumentReady}
              onBufferedLoad={(event, bufferedDocumentKey, bufferedDocumentRevision) => {
                onActiveFrameBufferedLoad?.(
                  event.currentTarget,
                  // The suffix identifies the mounted React surface; the
                  // generated bridge still speaks the original generation.
                  bufferedDocumentKey.replace(/:active-editor$/, ''),
                  bufferedDocumentRevision,
                  );
                }}
                onPromote={markActiveDocumentReady}
                className="block size-full border-0 bg-white"
              />
              {dragInsertKey && (
                <div
                  className="absolute inset-0 z-20 cursor-copy"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    if (!onDragInsertPreview?.(dragInsertKey, event.clientX, event.clientY)) {
                      onDragInsertClear?.();
                    }
                  }}
                  onDragLeave={() => onDragInsertClear?.()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const key = dragInsertKey
                      || event.dataTransfer.getData('application/x-incode-insert')
                      || event.dataTransfer.getData('text/plain');
                    if (key) onDragInsertDrop?.(key, event.clientX, event.clientY);
                    onDragInsertEnd?.();
                  }}
                />
              )}
              {!panTool && onResizeFrame && (
                <div
                  className="absolute -right-2 top-0 z-20 h-full w-4 cursor-ew-resize"
                  onPointerDown={(event) => startFrameResize(
                    activeFrameDescriptor,
                    'width',
                    event,
                  )}
                  aria-label={`Redimensionar largura de ${activeFrameDescriptor.label}`}
                >
                  <span className="absolute right-1 top-1/2 h-10 w-1 -translate-y-1/2 rounded-full bg-[var(--kodety-accent)] shadow-[0_0_0_1px_white]" />
                </div>
              )}
            </div>
          )}
        </HtmlExactViewport>
      </div>

      {(panTool || spacePressed || panning) && (
        <div
          className="absolute inset-0 z-30"
          onPointerDown={startPan}
          aria-label="Arrastar canvas infinito"
        />
      )}

      {toolbarHost && createPortal((
        <div
          data-infinite-canvas-toolbar
          role="toolbar"
          className="pointer-events-auto absolute bottom-5 left-1/2 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-[10px] border border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel-raised)] p-1 shadow-[var(--kodety-shadow-popover)] backdrop-blur-xl"
          aria-label="Ferramentas do canvas infinito"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
        <Button
          size="icon-sm"
          variant={!panTool ? 'secondary' : 'ghost'}
          onClick={() => setPanTool(false)}
          title="Selecionar"
          aria-label="Ferramenta de seleção"
          aria-pressed={!panTool}
        >
          <MousePointer2 />
        </Button>
        <Button
          size="icon-sm"
          variant={panTool ? 'secondary' : 'ghost'}
          onClick={() => setPanTool(true)}
          title="Mover canvas (ou segure Espaço)"
          aria-label="Ferramenta de mão"
          aria-pressed={panTool}
        >
          <Hand />
        </Button>
        <Button
          size="icon-sm"
          variant="secondary"
          onClick={() => onInfiniteCanvasChange(false)}
          title="Usar canvas único"
          aria-label="Desativar canvas infinito"
          aria-pressed={true}
        >
          <InfinityIcon />
        </Button>
        <div aria-hidden="true" className="mx-0.5 h-6 w-px bg-[var(--kodety-divider-strong)]" />
        <span
          className="hidden h-8 max-w-28 items-center gap-1.5 px-2 text-[10px] font-medium text-[var(--kodety-text-secondary)] sm:flex"
          title={`Localidade ativa: ${localeLabel}`}
        >
          <Globe2 className="size-3.5 text-zinc-500" />
          <span className="truncate">{localeLabel}</span>
        </span>
        <div aria-hidden="true" className="mx-0.5 h-6 w-px bg-[var(--kodety-divider-strong)]" />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setSafeZoom(view.zoom - 10)}
          title="Afastar"
          aria-label="Afastar canvas"
        >
          <ZoomOut />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 min-w-[68px] items-center justify-center gap-1 px-2 text-[12px] font-medium tabular-nums text-[var(--kodety-text)] transition-colors hover:text-white"
              title="Zoom do canvas"
              aria-label={`Zoom do canvas: ${Math.round(view.zoom)}%`}
            >
              {Math.round(view.zoom)}%
              <ChevronDown className="size-3 text-zinc-500" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" sideOffset={8} className="min-w-36">
            <DropdownMenuItem onClick={fit}>
              <Maximize2 /> Enquadrar tudo
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {ZOOM_PRESETS.map(preset => (
              <DropdownMenuItem key={preset} onClick={() => setSafeZoom(preset)}>
                <span className="w-8 tabular-nums">{preset}%</span>
                {Math.round(view.zoom) === preset && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setSafeZoom(view.zoom + 10)}
          title="Aproximar"
          aria-label="Aproximar canvas"
        >
          <ZoomIn />
        </Button>
        </div>
      ), toolbarHost)}
    </div>
  );
});
