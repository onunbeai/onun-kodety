'use client';

import {
  useCallback,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ComponentProps,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BoxSelect,
  Frames,
  Image,
  ImagePlay,
  Maximize2,
  Monitor,
  Notebook,
  Smartphone,
  Square,
  WideScreen,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  CANVAS_HUD_TOOLTIP_CLASS,
  MAX_CANVAS_VIEWPORT_HEIGHT,
  MAX_CANVAS_VIEWPORT_WIDTH,
  MIN_CANVAS_VIEWPORT_SIZE,
} from '@/lib/html-editor/editor-constants';
import type { CanvasDesignTool, Viewport } from '@/lib/html-editor/editor-types';
import { wordpressConfig } from '@/lib/html-editor/editor-wordpress-helpers';
import type { buildPreview } from '@/lib/html-editor/preview';
import type { Breakpoint } from '@/lib/html-editor/css-patcher';
import type { EditorMode } from '@/lib/html-editor/types';
import type { PageTransitionMotion } from '@/lib/html-editor/page-transitions';
import { useHtmlEditorChromeStore } from '@/stores/useHtmlEditorChromeStore';
import { useHtmlTimelineStore } from '@/stores/useHtmlTimelineStore';
import {
  resolveHtmlViewportSize,
  useHtmlViewportStore,
} from '@/stores/useHtmlViewportStore';
import { defaultInfiniteCanvasViewportHeight } from '@/lib/html-editor/infinite-canvas-runtime';
import { MissingAssetsIndicator } from '@/lib/html-editor/EditorChromeBits';
import { HtmlBreakpointControl } from './HtmlBreakpointControl';
import { HtmlBufferedIframe, HtmlOpaqueOriginBufferedIframe } from './HtmlBufferedIframe';
import { HtmlExactViewport } from './HtmlExactViewport';
import {
  HtmlInfiniteCanvas,
  type HtmlInfiniteCanvasFrame,
  type HtmlInfiniteCanvasHandle,
} from './HtmlInfiniteCanvas';

type Preview = ReturnType<typeof buildPreview>;
type InfiniteCanvasProps = ComponentProps<typeof HtmlInfiniteCanvas>;
type BufferedIframeProps = ComponentProps<typeof HtmlBufferedIframe>;
type OpaqueIframeProps = ComponentProps<typeof HtmlOpaqueOriginBufferedIframe>;

function CanvasChromeWhenCodeClosed({ children }: { children: ReactNode }) {
  const showCode = useHtmlEditorChromeStore(state => state.showCode);
  return showCode ? null : children;
}

interface MainCanvasBreakpointTab {
  id: Viewport;
  label: string;
  icon: 'desktop' | 'mobile' | 'notebook' | 'tablet' | 'wide';
  breakpoint: Breakpoint;
}

type CanvasInsertIconProps = ComponentProps<'svg'>;

const CanvasStackIcon = memo(function CanvasStackIcon(props: CanvasInsertIconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" {...props}>
      <rect x="2.25" y="3" width="6" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.75" y="3" width="6" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
});

const CanvasGridIcon = memo(function CanvasGridIcon(props: CanvasInsertIconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" {...props}>
      <rect x="2.25" y="2.25" width="5.75" height="5.75" rx="1.35" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="2.25" width="5.75" height="5.75" rx="1.35" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.25" y="10" width="5.75" height="5.75" rx="1.35" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="10" width="5.75" height="5.75" rx="1.35" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
});

const CanvasMasonryIcon = memo(function CanvasMasonryIcon(props: CanvasInsertIconProps) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" {...props}>
      <rect x="2.25" y="2.25" width="5.75" height="4.5" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.25" y="8.75" width="5.75" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="2.25" width="5.75" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="11.25" width="5.75" height="4.5" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
});

const CANVAS_INSERT_OPTIONS = [
  { tool: 'frame', label: 'Rectangle', shortcut: 'F', icon: BoxSelect },
  { tool: 'stack', label: 'Stack', shortcut: 'S', icon: CanvasStackIcon },
  { tool: 'grid', label: 'Grid', shortcut: '⇧G', icon: CanvasGridIcon },
  { tool: 'masonry', label: 'Masonry', shortcut: '⇧M', icon: CanvasMasonryIcon },
  { tool: 'image', label: 'Image', shortcut: '⇧I', icon: Image },
  { tool: 'video', label: 'Video', shortcut: '⇧V', icon: ImagePlay },
] as const satisfies ReadonlyArray<{
  tool: Exclude<CanvasDesignTool, 'select' | 'text-block'>;
  label: string;
  shortcut: string;
  icon: ComponentType<CanvasInsertIconProps>;
}>;

export interface HtmlEditorCanvasStageProps {
  preview: Preview | null;
  editorCanvasPreview: Preview | null;
  pageCanvasPreview: Preview | null;
  componentCanvasPreview: Preview | null;
  infiniteCanvasEnabled: boolean;
  isPreviewing: boolean;
  agentActivityLabel: string | null;
  editorCanvasSemanticSurfaceKey: string;
  pageCanvasSemanticSurfaceKey: string;
  componentCanvasSemanticSurfaceKey: string;
  infiniteCanvasRef: RefObject<HtmlInfiniteCanvasHandle | null>;
  canvasSandbox: string;
  resolvedActiveLocale: string;
  localizationSourceLocale: string;
  canvasViewPreferenceKey: string;
  dragInsertKey: string | null;
  canvasToolbarHost: HTMLElement | null;
  changeInfiniteCanvasEnabled: InfiniteCanvasProps['onInfiniteCanvasChange'];
  primaryBreakpoint: Breakpoint;
  breakpoints: Breakpoint[];
  selectCanvasBreakpoint: (id: string) => void;
  enterFocusedPreview: (id?: Viewport) => void;
  changePrimaryBreakpoint: (next: Breakpoint) => void;
  changeBreakpoints: (next: Breakpoint[]) => void;
  handleEditorCanvasIframeLoad: (
    event?: Parameters<NonNullable<BufferedIframeProps['onLoad']>>[0],
    documentKey?: string,
    documentRevision?: number,
  ) => void;
  handleEditorInitialVisualReady: NonNullable<BufferedIframeProps['onInitialVisualReady']>;
  markInfiniteCanvasBreakpointLoaded: (id: string, generation: string) => void;
  viewportRef: MutableRefObject<Viewport>;
  sendRuntimeAssetsToFrame: (
    frame: Window | null | undefined,
    phase?: 'fonts' | 'all',
    generationOverride?: string,
  ) => void;
  passiveCanvasFramesRef: MutableRefObject<Set<Window>>;
  passiveCanvasFrameIdsRef: MutableRefObject<Map<Window, string>>;
  postDesignTokensToFrame: (frame: Window | null | undefined) => void;
  postCanvasViewStateToFrame: (frame: Window | null | undefined) => boolean;
  flushCanvasStylePreviewRef: MutableRefObject<() => void>;
  postViewportHeightSimulationsToFrame: (frame: Window | null, breakpointId: string) => void;
  replayPinnedInteractionPreview: () => void;
  postInsertPoint: (
    type: 'html-editor-insert-preview-at-point' | 'html-editor-insert-at-point',
    key: string,
    clientX: number,
    clientY: number,
  ) => boolean;
  postCanvasMessage: (message: Record<string, unknown>, transfer?: Transferable[]) => boolean;
  setDragInsertKey: Dispatch<SetStateAction<string | null>>;
  canvasScrollRef: RefObject<HTMLDivElement | null>;
  mode: EditorMode;
  framerRuntimeReadOnly: boolean;
  resizingViewport: 'width' | 'height' | 'both' | null;
  renderedCanvasScaleRef: MutableRefObject<number>;
  viewportResizeScaleRef: MutableRefObject<number>;
  runtimePreviewVisible: boolean;
  setEditorCanvasIframeNode: (node: HTMLIFrameElement | null) => void;
  handleEditorCanvasPromotion: NonNullable<BufferedIframeProps['onPromote']>;
  isWordPressRuntime: boolean;
  runtimePreviewSemanticSurfaceKey: string;
  setRuntimePreviewIframeNode: OpaqueIframeProps['iframeRef'];
  handleRuntimePreviewIframeLoad: NonNullable<OpaqueIframeProps['onLoad']>;
  handleRuntimePreviewPromotion: NonNullable<OpaqueIframeProps['onPromote']>;
  runtimePreviewSurfaceStyle?: CSSProperties;
  runtimePreviewPromotionTransition?: PageTransitionMotion | null;
  setRuntimePreviewReadyGeneration: Dispatch<SetStateAction<string>>;
  startViewportResize: (
    axis: 'width' | 'height' | 'both',
    event: ReactPointerEvent<HTMLDivElement>,
    horizontalDirection?: -1 | 1,
  ) => void;
  resizeViewportWithKeyboard: (
    axis: 'width' | 'height' | 'both',
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => void;
  canvasDesignTool: CanvasDesignTool;
  setCanvasDesignTool: Dispatch<SetStateAction<CanvasDesignTool>>;
  workspaceReadOnly: boolean;
  infiniteCanvasBetaEnabled: boolean;
  mainCanvasBreakpointTabs: MainCanvasBreakpointTab[];
  fitCanvas: () => void;
  editingHtmlComponent?: boolean;
  componentCanvasSize?: {
    generation?: string;
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
  } | null;
}

function HtmlEditorCanvasStageImpl({
  preview,
  editorCanvasPreview,
  pageCanvasPreview,
  componentCanvasPreview,
  infiniteCanvasEnabled,
  isPreviewing,
  agentActivityLabel,
  editorCanvasSemanticSurfaceKey,
  pageCanvasSemanticSurfaceKey,
  componentCanvasSemanticSurfaceKey,
  infiniteCanvasRef,
  canvasSandbox,
  resolvedActiveLocale,
  localizationSourceLocale,
  canvasViewPreferenceKey,
  dragInsertKey,
  canvasToolbarHost,
  changeInfiniteCanvasEnabled,
  primaryBreakpoint,
  breakpoints,
  selectCanvasBreakpoint,
  enterFocusedPreview,
  changePrimaryBreakpoint,
  changeBreakpoints,
  handleEditorCanvasIframeLoad,
  handleEditorInitialVisualReady,
  markInfiniteCanvasBreakpointLoaded,
  viewportRef,
  sendRuntimeAssetsToFrame,
  passiveCanvasFramesRef,
  passiveCanvasFrameIdsRef,
  postDesignTokensToFrame,
  postCanvasViewStateToFrame,
  flushCanvasStylePreviewRef,
  postViewportHeightSimulationsToFrame,
  replayPinnedInteractionPreview,
  postInsertPoint,
  postCanvasMessage,
  setDragInsertKey,
  canvasScrollRef,
  mode,
  framerRuntimeReadOnly,
  resizingViewport,
  renderedCanvasScaleRef,
  viewportResizeScaleRef,
  runtimePreviewVisible,
  setEditorCanvasIframeNode,
  handleEditorCanvasPromotion,
  isWordPressRuntime,
  runtimePreviewSemanticSurfaceKey,
  setRuntimePreviewIframeNode,
  handleRuntimePreviewIframeLoad,
  handleRuntimePreviewPromotion,
  runtimePreviewSurfaceStyle,
  runtimePreviewPromotionTransition,
  setRuntimePreviewReadyGeneration,
  startViewportResize,
  resizeViewportWithKeyboard,
  canvasDesignTool,
  setCanvasDesignTool,
  workspaceReadOnly,
  infiniteCanvasBetaEnabled,
  mainCanvasBreakpointTabs,
  fitCanvas,
  editingHtmlComponent = false,
  componentCanvasSize = null,
}: HtmlEditorCanvasStageProps) {
  const showTimeline = useHtmlTimelineStore(state => state.showTimeline);
  const activeCanvasInsertOption = CANVAS_INSERT_OPTIONS.find(
    option => option.tool === canvasDesignTool,
  );
  const CanvasInsertIcon = activeCanvasInsertOption?.icon || BoxSelect;
  const activeCanvasToolLabel = activeCanvasInsertOption?.label
    || (canvasDesignTool === 'text-block' ? 'Text' : null);
  const localizedDesignCanvas = resolvedActiveLocale !== localizationSourceLocale;
  const viewport = useHtmlViewportStore(state => state.viewport);
  const zoom = useHtmlViewportStore(state => state.zoom);
  const viewportSizes = useHtmlViewportStore(state => state.viewportSizes);
  const setViewportSizes = useHtmlViewportStore(state => state.setViewportSizes);
  const canvasAvailableSize = useHtmlViewportStore(state => state.canvasAvailableSize);
  const setCanvasAvailableSize = useHtmlViewportStore(state => state.setCanvasAvailableSize);
  const pageCanvasIframeNodeRef = useRef<HTMLIFrameElement | null>(null);
  const componentCanvasIframeNodeRef = useRef<HTMLIFrameElement | null>(null);
  const infinitePageCanvasIframeNodeRef = useRef<HTMLIFrameElement | null>(null);
  const activeEditorSurfaceIsComponentRef = useRef(editingHtmlComponent);
  const visuallyReadyEditorDocumentsRef = useRef(new Set<string>());
  const activatedEditorSurfaceRef = useRef<{
    identity: string;
    node: HTMLIFrameElement;
  } | null>(null);
  activeEditorSurfaceIsComponentRef.current = editingHtmlComponent;
  const editorSurfaceOwnerKey = editingHtmlComponent
    ? `component\u0000${componentCanvasSemanticSurfaceKey}`
    : `page\u0000${pageCanvasSemanticSurfaceKey}`;
  const activeEditorSurfaceOwnerKeyRef = useRef(editorSurfaceOwnerKey);
  const previousEditorSurfaceOwnerKeyRef = useRef('');
  activeEditorSurfaceOwnerKeyRef.current = editorSurfaceOwnerKey;
  const editorDocumentIdentity = (
    kind: 'page' | 'component',
    documentKey: string,
    revision: number,
    surfaceKey: string,
  ) => `${kind}\u0000${surfaceKey}\u0000${documentKey}\u0000${revision}`;
  const setPageCanvasIframeNode = useCallback((node: HTMLIFrameElement | null) => {
    pageCanvasIframeNodeRef.current = node;
    if (!activeEditorSurfaceIsComponentRef.current) setEditorCanvasIframeNode(node);
  }, [setEditorCanvasIframeNode]);
  const setComponentCanvasIframeNode = useCallback((node: HTMLIFrameElement | null) => {
    componentCanvasIframeNodeRef.current = node;
    if (activeEditorSurfaceIsComponentRef.current) setEditorCanvasIframeNode(node);
  }, [setEditorCanvasIframeNode]);
  const currentViewport = resolveHtmlViewportSize(viewport, viewportSizes, breakpoints, primaryBreakpoint);
  // Keep the iframe's layout viewport independent from the measured crop. A
  // component that uses vh/calc()/min-height must always resolve those units
  // against the selected breakpoint, otherwise feeding its measured height
  // back into the iframe creates a resize loop (50vh -> 25vh -> ...).
  const componentLayoutViewport = {
    width: Math.max(1, Math.ceil(currentViewport.width)),
    height: Math.max(1, Math.ceil(currentViewport.height)),
  };
  const componentMeasurementCacheKey = [
    editorCanvasSemanticSurfaceKey,
    viewport,
    `${componentLayoutViewport.width}x${componentLayoutViewport.height}`,
  ].join('\u0000');
  const measuredComponentCanvasSize = editingHtmlComponent
    && componentCanvasSize
    && (
      !componentCanvasSize.generation
      || componentCanvasSize.generation === (editorCanvasPreview?.generation || '')
    )
    && Math.abs(componentCanvasSize.layoutWidth - componentLayoutViewport.width) <= 1
    && Math.abs(componentCanvasSize.layoutHeight - componentLayoutViewport.height) <= 1
    ? componentCanvasSize
    : null;
  const componentCanvasSizeCacheRef = useRef(new Map<string, { width: number; height: number }>());
  useLayoutEffect(() => {
    if (!editingHtmlComponent || !measuredComponentCanvasSize) return;
    componentCanvasSizeCacheRef.current.set(componentMeasurementCacheKey, {
      width: measuredComponentCanvasSize.width,
      height: measuredComponentCanvasSize.height,
    });
  }, [
    componentMeasurementCacheKey,
    editingHtmlComponent,
    measuredComponentCanvasSize,
  ]);
  const effectiveComponentCanvasSize = measuredComponentCanvasSize
    || (editingHtmlComponent
      ? componentCanvasSizeCacheRef.current.get(componentMeasurementCacheKey) || null
      : null);
  const componentRuntimeViewport = editingHtmlComponent && effectiveComponentCanvasSize
    ? {
        width: Math.max(
          1,
          Math.min(componentLayoutViewport.width, Math.ceil(effectiveComponentCanvasSize.width)),
        ),
        height: Math.max(
          1,
          Math.min(componentLayoutViewport.height, Math.ceil(effectiveComponentCanvasSize.height)),
        ),
      }
    : currentViewport;
  const editorSurfaceVisualReady = Boolean(
    editorCanvasPreview
    && (!editingHtmlComponent || effectiveComponentCanvasSize),
  );
  const editorSurfaceVisualReadyKey = editingHtmlComponent && effectiveComponentCanvasSize
    ? `${componentMeasurementCacheKey}:${editorCanvasPreview?.generation || ''}:${effectiveComponentCanvasSize.width}x${effectiveComponentCanvasSize.height}`
    : editorCanvasPreview?.generation || '';
  useLayoutEffect(() => {
    const kind = editingHtmlComponent ? 'component' : 'page';
    const ownerChanged = previousEditorSurfaceOwnerKeyRef.current !== editorSurfaceOwnerKey;
    previousEditorSurfaceOwnerKeyRef.current = editorSurfaceOwnerKey;
    const activePreview = editingHtmlComponent ? componentCanvasPreview : pageCanvasPreview;
    const activeSurfaceKey = editingHtmlComponent
      ? componentCanvasSemanticSurfaceKey
      : pageCanvasSemanticSurfaceKey;
    const node = editingHtmlComponent
      ? componentCanvasIframeNodeRef.current
      : infiniteCanvasEnabled && !isPreviewing
        ? infinitePageCanvasIframeNodeRef.current
        : pageCanvasIframeNodeRef.current;
    setEditorCanvasIframeNode(node);
    if (!node || !activePreview) return;
    const identity = editorDocumentIdentity(
      kind,
      activePreview.generation,
      activePreview.revision,
      activeSurfaceKey,
    );
    if (!visuallyReadyEditorDocumentsRef.current.has(identity)) return;
    const activated = activatedEditorSurfaceRef.current;
    if (!ownerChanged && activated?.identity === identity && activated.node === node) return;

    // Child layout effects run before the parent's semantic-surface reset.
    // Activating a retained page synchronously here lets that later parent
    // effect clear its freshly restored generation, so canvas clicks are
    // ignored even though Layers can still seed the Inspector locally. Finish
    // the ownership handoff in a microtask: it still lands before the browser
    // can accept another pointer event, but after every layout effect in this
    // commit has quarantined the outgoing component/page surface.
    let cancelled = false;
    queueMicrotask(() => {
      if (
        cancelled
        || activeEditorSurfaceOwnerKeyRef.current !== editorSurfaceOwnerKey
      ) return;
      const currentNode = editingHtmlComponent
        ? componentCanvasIframeNodeRef.current
        : infiniteCanvasEnabled && !isPreviewing
          ? infinitePageCanvasIframeNodeRef.current
          : pageCanvasIframeNodeRef.current;
      if (currentNode !== node) return;
      setEditorCanvasIframeNode(node);
      activatedEditorSurfaceRef.current = { identity, node };
      handleEditorCanvasPromotion(
        node,
        activePreview.generation,
        activePreview.revision,
        activeSurfaceKey,
        'reactivated',
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    componentCanvasPreview?.generation,
    componentCanvasPreview?.revision,
    componentCanvasSemanticSurfaceKey,
    editingHtmlComponent,
    editorSurfaceOwnerKey,
    handleEditorCanvasPromotion,
    infiniteCanvasEnabled,
    isPreviewing,
    pageCanvasPreview?.generation,
    pageCanvasPreview?.revision,
    pageCanvasSemanticSurfaceKey,
    setEditorCanvasIframeNode,
  ]);
  const [runtimeSurfacePainted, setRuntimeSurfacePainted] = useState(false);
  useLayoutEffect(() => {
    if (!isPreviewing) setRuntimeSurfacePainted(false);
  }, [isPreviewing]);
  const infiniteCanvasFrames = useMemo<HtmlInfiniteCanvasFrame[]>(() => {
    const descriptors = [
      { id: 'base', label: primaryBreakpoint.label, width: primaryBreakpoint.width },
      ...breakpoints.map(breakpoint => ({
        id: breakpoint.id,
        label: breakpoint.label,
        width: breakpoint.width,
      })),
    ];
    return descriptors.map(descriptor => {
      const size = resolveHtmlViewportSize(descriptor.id, viewportSizes, breakpoints, primaryBreakpoint);
      const simulatedViewportHeight =
        descriptor.id === 'base' ? 1080 : defaultInfiniteCanvasViewportHeight(size.width);
      return {
        id: descriptor.id,
        label: descriptor.label,
        detail: `${Math.round(size.width)} × ${simulatedViewportHeight} px`,
        width: Math.max(MIN_CANVAS_VIEWPORT_SIZE, Math.round(size.width)),
        height: simulatedViewportHeight,
        simulatedViewportHeight,
      };
    });
  }, [breakpoints, primaryBreakpoint, viewportSizes]);
  const fitCanvasToAvailableSpace = editingHtmlComponent || isWordPressRuntime || showTimeline;
  const fittedCanvasZoom =
    fitCanvasToAvailableSpace && canvasAvailableSize.width > 0 && canvasAvailableSize.height > 0
      ? Math.max(
          10,
          Math.min(
            200,
            Math.floor(
              Math.min(
                Math.max(1, canvasAvailableSize.width - 48) / componentRuntimeViewport.width,
                Math.max(1, canvasAvailableSize.height - (editingHtmlComponent ? 48 : 84)) /
                  componentRuntimeViewport.height,
              ) * 100,
            ),
          ),
        )
      : zoom;
  const lastAutoFittedBreakpointRef = useRef(viewport);
  const breakpointRequiresAutoFit = lastAutoFittedBreakpointRef.current !== viewport;
  const renderedCanvasZoom = fitCanvasToAvailableSpace
    ? resizingViewport
      ? viewportResizeScaleRef.current * 100
      : breakpointRequiresAutoFit
        // Paint the target breakpoint at its final fitted scale immediately.
        // The persisted zoom is committed after geometry settles below, but
        // waiting for that second render used to leave the iframe briefly at
        // the previous breakpoint's scale.
        ? fittedCanvasZoom
        : Math.min(zoom, fittedCanvasZoom)
    : zoom;

  useEffect(() => {
    const container = canvasScrollRef.current;
    if (!container) return;
    const update = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      setCanvasAvailableSize(current =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(container);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [canvasScrollRef, setCanvasAvailableSize]);

  useLayoutEffect(() => {
    renderedCanvasScaleRef.current = renderedCanvasZoom / 100;
  }, [renderedCanvasScaleRef, renderedCanvasZoom]);

  useLayoutEffect(() => {
    if (!preview?.generation || (infiniteCanvasEnabled && !isPreviewing)) return;
    postCanvasMessage({
      type: 'html-editor-canvas-view-scale',
      scale: renderedCanvasZoom / 100,
    });
  }, [infiniteCanvasEnabled, isPreviewing, postCanvasMessage, preview?.generation, renderedCanvasZoom]);

  useEffect(() => {
    if (lastAutoFittedBreakpointRef.current === viewport) return;
    const targetBreakpoint = viewport;
    let settleFrame = 0;
    const layoutFrame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(() => {
        if (viewportRef.current !== targetBreakpoint) return;
        if (infiniteCanvasEnabled && !isPreviewing) infiniteCanvasRef.current?.focusFrame(targetBreakpoint);
        else fitCanvas();
        lastAutoFittedBreakpointRef.current = targetBreakpoint;
      });
    });
    return () => {
      window.cancelAnimationFrame(layoutFrame);
      if (settleFrame) window.cancelAnimationFrame(settleFrame);
    };
  }, [fitCanvas, infiniteCanvasEnabled, infiniteCanvasRef, isPreviewing, viewport, viewportRef]);

  return (
    <>
      {preview && preview.missingAssets.length > 0 && (
        <MissingAssetsIndicator assets={preview.missingAssets} floating />
      )}
      {infiniteCanvasEnabled && !isPreviewing && (
        <div
          data-persistent-infinite-page-canvas
          aria-hidden={editingHtmlComponent || undefined}
          className={cn(
            // HtmlInfiniteCanvas positions its plane absolutely. This wrapper
            // must therefore establish a flex formatting context; otherwise
            // the canvas root has no in-flow content, collapses to 0px tall,
            // and only its portalled toolbar remains visible.
            'flex min-h-0 min-w-0 flex-1 will-change-[opacity]',
            editingHtmlComponent
              && 'pointer-events-none absolute inset-0 z-0 opacity-[0.01]',
          )}
        >
        <HtmlInfiniteCanvas
          key={pageCanvasSemanticSurfaceKey}
          ref={infiniteCanvasRef}
          frames={infiniteCanvasFrames}
          activeId={viewport}
          html={pageCanvasPreview?.html || ''}
          passiveHtml={pageCanvasPreview?.passiveHtml || pageCanvasPreview?.html || ''}
          documentKey={pageCanvasPreview?.generation || ''}
          sandbox={canvasSandbox}
          iframeRef={infinitePageCanvasIframeNodeRef}
          localeLabel={resolvedActiveLocale || localizationSourceLocale}
          viewPreferenceKey={canvasViewPreferenceKey}
          dragInsertKey={dragInsertKey}
          toolbarHost={canvasToolbarHost}
          onInfiniteCanvasChange={changeInfiniteCanvasEnabled}
          activeFrameHeader={
            <HtmlBreakpointControl
              variant="frame"
              agentActivityLabel={agentActivityLabel}
              primaryBreakpoint={primaryBreakpoint}
              breakpoints={breakpoints}
              activeId={viewport}
              onSelect={selectCanvasBreakpoint}
              onPreview={enterFocusedPreview}
              onPrimaryChange={changePrimaryBreakpoint}
              onChange={changeBreakpoints}
            />
          }
          onSelectFrame={selectCanvasBreakpoint}
          onPreviewFrame={enterFocusedPreview}
          onActiveFrameLoad={() => {
            const node = infinitePageCanvasIframeNodeRef.current;
            const pageGeneration = pageCanvasPreview?.generation || '';
            if (node && pageGeneration) {
              const identity = editorDocumentIdentity(
                'page',
                pageGeneration,
                pageCanvasPreview?.revision || 0,
                pageCanvasSemanticSurfaceKey,
              );
              visuallyReadyEditorDocumentsRef.current.add(identity);
              if (!activeEditorSurfaceIsComponentRef.current) {
                setEditorCanvasIframeNode(node);
                activatedEditorSurfaceRef.current = { identity, node };
                handleEditorCanvasIframeLoad(
                  undefined,
                  pageGeneration,
                  pageCanvasPreview?.revision || 0,
                );
                handleEditorInitialVisualReady(
                  node,
                  pageGeneration,
                  pageCanvasPreview?.revision || 0,
                  pageCanvasSemanticSurfaceKey,
                );
              }

              // Read-only references load concurrently and can finish before
              // the editable document becomes the active generation. Replay
              // shared runtime state once authority is established so every
              // already-painted breakpoint has the same fonts, tokens and
              // viewport simulations without being reloaded.
              passiveCanvasFramesRef.current.forEach(frame => {
                const id = passiveCanvasFrameIdsRef.current.get(frame);
                if (!id) return;
                sendRuntimeAssetsToFrame(frame, 'fonts', pageGeneration);
                postDesignTokensToFrame(frame);
                postCanvasViewStateToFrame(frame);
                postViewportHeightSimulationsToFrame(frame, id);
                // Early passive measurements are intentionally ignored until
                // an editable generation owns the canvas message channel.
                // Ask each already-painted reference to report again now.
                frame.postMessage({
                  type: 'html-editor-infinite-canvas-refresh-height',
                  generation: pageGeneration,
                }, '*');
                frame.postMessage({
                  type: 'html-editor-runtime-assets-refresh',
                  generation: pageGeneration,
                }, '*');
              });
              flushCanvasStylePreviewRef.current();
            }
            markInfiniteCanvasBreakpointLoaded(viewportRef.current, pageGeneration);
          }}
          onActiveFrameBufferedLoad={(frame, bufferedGeneration) => {
            // Infinite Canvas keeps its active frame behind the full visual
            // readiness handshake, so its hidden generation still receives
            // the referenced assets before promotion.
            sendRuntimeAssetsToFrame(frame.contentWindow, 'all', bufferedGeneration);
          }}
          onPassiveFrameRegister={(frame, registered, id) => {
            if (registered) {
              passiveCanvasFramesRef.current.add(frame);
              passiveCanvasFrameIdsRef.current.set(frame, id);
            } else {
              passiveCanvasFramesRef.current.delete(frame);
              passiveCanvasFrameIdsRef.current.delete(frame);
            }
          }}
          onPassiveFrameLoad={(frame, id) => {
            const pageGeneration = pageCanvasPreview?.generation || '';
            if (id !== viewportRef.current) {
              markInfiniteCanvasBreakpointLoaded(id, pageGeneration);
            }
            sendRuntimeAssetsToFrame(
              frame.contentWindow,
              'fonts',
              pageGeneration,
            );
            postDesignTokensToFrame(frame.contentWindow);
            postCanvasViewStateToFrame(frame.contentWindow);
            flushCanvasStylePreviewRef.current();
            postViewportHeightSimulationsToFrame(frame.contentWindow, id);
            if (pageGeneration) {
              frame.contentWindow?.postMessage({
                type: 'html-editor-runtime-assets-refresh',
                generation: pageGeneration,
              }, '*');
            }
            if (id === viewportRef.current) replayPinnedInteractionPreview();
          }}
          onResizeFrame={(id, property, value, phase) => {
            const limits =
              property === 'width'
                ? [MIN_CANVAS_VIEWPORT_SIZE, MAX_CANVAS_VIEWPORT_WIDTH]
                : [MIN_CANVAS_VIEWPORT_SIZE, MAX_CANVAS_VIEWPORT_HEIGHT];
            const next = Math.max(limits[0], Math.min(limits[1], Math.round(value)));
            setViewportSizes(current => ({
              ...current,
              [id]: {
                ...resolveHtmlViewportSize(id, current, breakpoints, primaryBreakpoint),
                [property]: next,
              },
            }));
            if (phase !== 'commit' || property !== 'width') return;
            // Infinite Canvas uses the same breakpoint registry as the normal
            // canvas. Commit the final handle width so the rendered media tier
            // and the CSS rule that visual authoring edits cannot diverge.
            if (id === 'base') {
              if (primaryBreakpoint.width !== next) {
                changePrimaryBreakpoint({ ...primaryBreakpoint, width: next });
              }
              return;
            }
            const active = breakpoints.find(breakpoint => breakpoint.id === id);
            if (active && active.width !== next) {
              changeBreakpoints(
                breakpoints.map(breakpoint => (
                  breakpoint.id === id ? { ...breakpoint, width: next } : breakpoint
                )),
              );
            }
          }}
          onDragInsertPreview={(key, clientX, clientY) =>
            postInsertPoint('html-editor-insert-preview-at-point', key, clientX, clientY)
          }
          onDragInsertClear={() => postCanvasMessage({ type: 'html-editor-insert-clear-preview' })}
          onDragInsertDrop={(key, clientX, clientY) => {
            postInsertPoint('html-editor-insert-at-point', key, clientX, clientY);
          }}
          onDragInsertEnd={() => setDragInsertKey(null)}
        />
        </div>
      )}
      {(!infiniteCanvasEnabled || isPreviewing || editingHtmlComponent) && (
        <>
          <div
            ref={canvasScrollRef}
            className={cn(
              'kodety-editor-canvas-scroll min-h-0 min-w-0 flex-1 overflow-auto',
              isPreviewing || editingHtmlComponent ? 'p-6' : 'px-6 pb-6 pt-14',
            )}
          >
            <div
              className={cn(
                'mx-auto relative',
                !editingHtmlComponent && !resizingViewport
                  && 'transition-[width,height] duration-300 ease-out motion-reduce:transition-none',
              )}
              style={{
                width: (componentRuntimeViewport.width * renderedCanvasZoom) / 100,
                height: (componentRuntimeViewport.height * renderedCanvasZoom) / 100,
              }}
            >
              {!isPreviewing && !editingHtmlComponent && mode === 'design' && !framerRuntimeReadOnly && !showTimeline && (
                <CanvasChromeWhenCodeClosed>
                  <div className="absolute -top-8 left-0 z-40 w-full">
                    <HtmlBreakpointControl
                      variant="frame"
                      agentActivityLabel={agentActivityLabel}
                      primaryBreakpoint={primaryBreakpoint}
                      breakpoints={breakpoints}
                      activeId={viewport}
                      onSelect={selectCanvasBreakpoint}
                      onPreview={enterFocusedPreview}
                      onPrimaryChange={changePrimaryBreakpoint}
                      onChange={changeBreakpoints}
                    />
                  </div>
                </CanvasChromeWhenCodeClosed>
              )}
              <div
                className={cn(
                  'absolute left-0 top-0 origin-top-left',
                  'overflow-hidden',
                  !editingHtmlComponent && !resizingViewport
                    && 'will-change-[width,height,transform] transition-[width,height,transform] duration-300 ease-out motion-reduce:transition-none',
                  editingHtmlComponent
                    ? 'bg-transparent'
                    : 'bg-white ring-1 ring-[var(--kodety-focus)]/70',
                )}
                style={{
                  width: componentRuntimeViewport.width,
                  height: componentRuntimeViewport.height,
                  transform: `scale(${renderedCanvasZoom / 100})`,
                }}
              >
                <HtmlExactViewport width={componentRuntimeViewport.width} height={componentRuntimeViewport.height}>
                  <div
                    data-editor-canvas-surface
                    aria-hidden={isPreviewing || undefined}
                    className={cn(
                      'absolute inset-0 bg-[#111315]',
                      isPreviewing && 'pointer-events-none',
                    )}
                  >
                    {(!infiniteCanvasEnabled || isPreviewing) && <div
                      data-page-editor-canvas-surface
                      aria-hidden={editingHtmlComponent || isPreviewing || undefined}
                      className={cn(
                        'absolute inset-0 bg-white will-change-[opacity]',
                        !editingHtmlComponent && !isPreviewing
                          ? 'z-10 opacity-100'
                          : 'z-0 pointer-events-none opacity-[0.01]',
                      )}
                    >
                      <HtmlBufferedIframe
                        documentKey={pageCanvasPreview?.generation || ''}
                        surfaceKey={pageCanvasSemanticSurfaceKey}
                        documentRevision={pageCanvasPreview?.revision || 0}
                        retainDocument={!localizedDesignCanvas}
                        pinRetainedDocument={!localizedDesignCanvas}
                        progressiveSemanticNavigation={localizedDesignCanvas}
                        visualReady={Boolean(pageCanvasPreview)}
                        visualReadyKey={pageCanvasPreview?.generation || ''}
                        iframeRef={setPageCanvasIframeNode}
                        title="Canvas persistente da página HTML"
                        sandbox={canvasSandbox}
                        allow="fullscreen; picture-in-picture"
                        tabIndex={editingHtmlComponent || isPreviewing ? -1 : undefined}
                        srcDoc={pageCanvasPreview?.html || ''}
                        onLoad={(event, documentKey, documentRevision) => {
                          if (!activeEditorSurfaceIsComponentRef.current) {
                            handleEditorCanvasIframeLoad(event, documentKey, documentRevision);
                          }
                        }}
                        onInitialVisualReady={(node, documentKey, documentRevision, surfaceKey) => {
                          const identity = editorDocumentIdentity(
                            'page',
                            documentKey,
                            documentRevision,
                            surfaceKey,
                          );
                          visuallyReadyEditorDocumentsRef.current.add(identity);
                          if (activeEditorSurfaceIsComponentRef.current) return;
                          activatedEditorSurfaceRef.current = { identity, node };
                          handleEditorInitialVisualReady(node, documentKey, documentRevision, surfaceKey);
                        }}
                        onBufferedLoad={(event, bufferedGeneration) => {
                          sendRuntimeAssetsToFrame(event.currentTarget.contentWindow, 'fonts', bufferedGeneration);
                        }}
                        onPromote={(node, documentKey, documentRevision, surfaceKey, promotionKind) => {
                          const identity = editorDocumentIdentity(
                            'page',
                            documentKey,
                            documentRevision,
                            surfaceKey,
                          );
                          visuallyReadyEditorDocumentsRef.current.add(identity);
                          if (activeEditorSurfaceIsComponentRef.current) return;
                          activatedEditorSurfaceRef.current = { identity, node };
                          handleEditorCanvasPromotion(
                            node,
                            documentKey,
                            documentRevision,
                            surfaceKey,
                            promotionKind,
                          );
                        }}
                        className={cn(
                          'block size-full border-0 bg-white',
                          isWordPressRuntime && resizingViewport && 'pointer-events-none',
                        )}
                      />
                    </div>}
                    {componentCanvasPreview && (
                      <div
                        data-component-editor-canvas-surface
                        aria-hidden={!editingHtmlComponent || isPreviewing || undefined}
                        className={cn(
                          'absolute inset-0 bg-[#111315] will-change-[opacity]',
                          editingHtmlComponent && !isPreviewing
                            ? 'z-10 opacity-100'
                            : 'z-0 pointer-events-none opacity-[0.01]',
                        )}
                      >
                        <HtmlBufferedIframe
                          documentKey={componentCanvasPreview.generation}
                          surfaceKey={componentCanvasSemanticSurfaceKey}
                          documentRevision={componentCanvasPreview.revision}
                          retainDocument
                          pinRetainedDocument
                          visualReady={editorSurfaceVisualReady}
                          visualReadyKey={editorSurfaceVisualReadyKey}
                          builderLoading
                          iframeRef={setComponentCanvasIframeNode}
                          title="Canvas persistente do componente HTML"
                          sandbox={canvasSandbox}
                          allow="fullscreen; picture-in-picture"
                          tabIndex={!editingHtmlComponent || isPreviewing ? -1 : undefined}
                          srcDoc={componentCanvasPreview.html}
                          onLoad={(event, documentKey, documentRevision) => {
                            if (activeEditorSurfaceIsComponentRef.current) {
                              handleEditorCanvasIframeLoad(event, documentKey, documentRevision);
                            }
                          }}
                          onInitialVisualReady={(node, documentKey, documentRevision, surfaceKey) => {
                            const identity = editorDocumentIdentity(
                              'component',
                              documentKey,
                              documentRevision,
                              surfaceKey,
                            );
                            visuallyReadyEditorDocumentsRef.current.add(identity);
                            if (!activeEditorSurfaceIsComponentRef.current) return;
                            activatedEditorSurfaceRef.current = { identity, node };
                            handleEditorInitialVisualReady(node, documentKey, documentRevision, surfaceKey);
                          }}
                          onBufferedLoad={(event, bufferedGeneration) => {
                            sendRuntimeAssetsToFrame(event.currentTarget.contentWindow, 'all', bufferedGeneration);
                          }}
                          onPromote={(node, documentKey, documentRevision, surfaceKey, promotionKind) => {
                            const identity = editorDocumentIdentity(
                              'component',
                              documentKey,
                              documentRevision,
                              surfaceKey,
                            );
                            visuallyReadyEditorDocumentsRef.current.add(identity);
                            if (!activeEditorSurfaceIsComponentRef.current) return;
                            activatedEditorSurfaceRef.current = { identity, node };
                            handleEditorCanvasPromotion(
                              node,
                              documentKey,
                              documentRevision,
                              surfaceKey,
                              promotionKind,
                            );
                          }}
                          style={{
                            width: componentLayoutViewport.width,
                            height: componentLayoutViewport.height,
                          }}
                          className={cn(
                            'block border-0 bg-transparent',
                            isWordPressRuntime && resizingViewport && 'pointer-events-none',
                          )}
                        />
                      </div>
                    )}
                  </div>
                  {isPreviewing && preview && (
                    <div
                      data-runtime-preview-surface
                      aria-hidden={!runtimePreviewVisible || !runtimeSurfacePainted || undefined}
                      style={runtimePreviewSurfaceStyle}
                      className={cn(
                        'absolute inset-0 z-10 shadow-none drop-shadow-none',
                        (!runtimePreviewVisible || !runtimeSurfacePainted)
                          && 'invisible pointer-events-none',
                      )}
                    >
                      <HtmlOpaqueOriginBufferedIframe
                        documentKey={preview.generation}
                        surfaceKey={runtimePreviewSemanticSurfaceKey}
                        documentRevision={preview.revision}
                        iframeRef={setRuntimePreviewIframeNode}
                        title="Preview executável do projeto HTML"
                        sandbox={canvasSandbox}
                        allow="accelerometer *; autoplay *; clipboard-write *; encrypted-media *; fullscreen *; gyroscope *; picture-in-picture *; web-share *"
                        srcDoc={preview.html}
                        youtubeEmbedUrl={wordpressConfig()?.youtubeEmbedUrl}
                        progressiveDocumentLoad
                        promotionTransition={runtimePreviewPromotionTransition}
                        onLoad={handleRuntimePreviewIframeLoad}
                        onBufferedLoad={(event, bufferedGeneration, _revision, _surfaceKey, semanticNavigation) => {
                          // Start critical font transfer while the in-frame
                          // bridge still owns the explicit visual-readiness gate.
                          // Same-page refreshes keep the full asset transfer.
                          sendRuntimeAssetsToFrame(
                            event.currentTarget.contentWindow,
                            semanticNavigation ? 'fonts' : 'all',
                            bufferedGeneration,
                          );
                        }}
                        onPromote={handleRuntimePreviewPromotion}
                        onInitialVisualReady={() => {
                          setRuntimeSurfacePainted(true);
                          setRuntimePreviewReadyGeneration(preview.generation);
                        }}
                        className="block size-full border-0 bg-white shadow-none drop-shadow-none"
                      />
                    </div>
                  )}
                  {!isPreviewing && dragInsertKey && (
                    <div
                      className="absolute inset-0 z-40 cursor-copy"
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                        if (
                          !postInsertPoint(
                            'html-editor-insert-preview-at-point',
                            dragInsertKey,
                            event.clientX,
                            event.clientY,
                          )
                        ) {
                          postCanvasMessage({
                            type: 'html-editor-insert-clear-preview',
                          });
                        }
                      }}
                      onDragLeave={() =>
                        postCanvasMessage({
                          type: 'html-editor-insert-clear-preview',
                        })
                      }
                      onDrop={event => {
                        event.preventDefault();
                        const key =
                          dragInsertKey ||
                          event.dataTransfer.getData('application/x-incode-insert') ||
                          event.dataTransfer.getData('text/plain');
                        if (key) postInsertPoint('html-editor-insert-at-point', key, event.clientX, event.clientY);
                        setDragInsertKey(null);
                      }}
                    />
                  )}
                </HtmlExactViewport>
              </div>
              {isPreviewing && !editingHtmlComponent && (
                <div
                  role="separator"
                  aria-label="Redimensionar largura do viewport pela esquerda"
                  aria-orientation="vertical"
                  aria-valuemin={MIN_CANVAS_VIEWPORT_SIZE}
                  aria-valuemax={MAX_CANVAS_VIEWPORT_WIDTH}
                  aria-valuenow={currentViewport.width}
                  tabIndex={0}
                  onPointerDown={event => startViewportResize('width', event, -1)}
                  onKeyDown={event => resizeViewportWithKeyboard('width', event)}
                  className={cn(
                    'absolute -left-3 top-0 z-30 flex h-full w-6 touch-none cursor-ew-resize items-center justify-center opacity-40 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none',
                    resizingViewport === 'width' && 'opacity-100',
                  )}
                >
                  <span className="h-10 w-1 rounded-full bg-[var(--kodety-accent)] shadow" />
                </div>
              )}
              {!editingHtmlComponent && <div
                role="separator"
                data-kodety-onboarding="responsive-width"
                aria-label={
                  isPreviewing
                    ? 'Redimensionar largura do viewport pela direita'
                    : 'Redimensionar largura do viewport'
                }
                aria-orientation="vertical"
                aria-valuemin={MIN_CANVAS_VIEWPORT_SIZE}
                aria-valuemax={MAX_CANVAS_VIEWPORT_WIDTH}
                aria-valuenow={currentViewport.width}
                tabIndex={0}
                onPointerDown={event => startViewportResize('width', event)}
                onKeyDown={event => resizeViewportWithKeyboard('width', event)}
                className={cn(
                  'absolute top-0 z-30 flex h-full touch-none cursor-ew-resize items-center justify-center opacity-40 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none',
                  '-right-3 w-6',
                  resizingViewport === 'width' && 'opacity-100',
                )}
              >
                <span className="h-10 w-1 rounded-full bg-[var(--kodety-accent)] shadow" />
              </div>}
              {!editingHtmlComponent && <div
                role="separator"
                aria-label="Redimensionar altura do viewport"
                aria-orientation="horizontal"
                aria-valuemin={MIN_CANVAS_VIEWPORT_SIZE}
                aria-valuemax={MAX_CANVAS_VIEWPORT_HEIGHT}
                aria-valuenow={currentViewport.height}
                tabIndex={0}
                onPointerDown={event => startViewportResize('height', event)}
                onKeyDown={event => resizeViewportWithKeyboard('height', event)}
                className={cn(
                  'absolute left-0 z-30 flex w-full touch-none cursor-ns-resize items-center justify-center opacity-40 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none',
                  '-bottom-3 h-6',
                  resizingViewport === 'height' && 'opacity-100',
                )}
              >
                <span className="h-1 w-10 rounded-full bg-[var(--kodety-accent)] shadow" />
              </div>}
              {!editingHtmlComponent && <div
                role="button"
                aria-label="Redimensionar viewport"
                tabIndex={0}
                onPointerDown={event => startViewportResize('both', event)}
                onKeyDown={event => resizeViewportWithKeyboard('both', event)}
                className={cn(
                  'absolute -bottom-2 -right-2 z-40 size-3 touch-none cursor-nwse-resize rounded-[3px] border border-[#222] bg-[var(--kodety-accent)] shadow opacity-70 hover:scale-110 hover:opacity-100 focus-visible:scale-110 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                  resizingViewport === 'both' && 'scale-110 opacity-100',
                )}
              />}
            </div>
          </div>
          {canvasToolbarHost && !isPreviewing && mode === 'design' && !showTimeline && (
            <CanvasChromeWhenCodeClosed>
              {createPortal((
              <>
                {activeCanvasToolLabel && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none fixed bottom-[76px] left-[50vw] z-[240] max-w-[calc(100vw-24px)] -translate-x-1/2 truncate whitespace-nowrap rounded-[7px] border border-white/[0.10] bg-[var(--kodety-panel)] px-2.5 py-1.5 text-[10px] font-medium text-white/80 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
                  >
                    {activeCanvasToolLabel} · clique ou arraste para criar · Shift: proporção 1:1 · Alt: centro · Esc: cancelar
                  </div>
                )}
                <div
                  data-canvas-mode-toolbar
                  role="toolbar"
                  aria-label="Ferramentas do canvas"
                  className="pointer-events-auto fixed bottom-5 left-[50vw] z-[230] flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1 rounded-[12px] border border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)] p-1.5 shadow-none"
                  onPointerDown={event => event.stopPropagation()}
                  onWheel={event => event.stopPropagation()}
                >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant={activeCanvasInsertOption ? 'secondary' : 'ghost'}
                      disabled={workspaceReadOnly}
                      className={cn(
                        'size-9 rounded-[8px]',
                        CANVAS_HUD_TOOLTIP_CLASS,
                        activeCanvasInsertOption
                          && 'bg-[var(--kodety-accent)]/15 text-[var(--kodety-accent-hover)]',
                      )}
                      data-tooltip={activeCanvasInsertOption
                        ? `${activeCanvasInsertOption.label} ativo · Esc para cancelar`
                        : 'Inserir elemento'}
                      aria-label="Abrir ferramentas de inserção"
                      aria-haspopup="menu"
                      aria-pressed={Boolean(activeCanvasInsertOption)}
                    >
                      <CanvasInsertIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    sideOffset={10}
                    className="w-52 rounded-[14px] border-white/[0.09] bg-[var(--kodety-panel)] p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.34)]"
                  >
                    {CANVAS_INSERT_OPTIONS.map((option, index) => {
                      const ToolIcon = option.icon;
                      const active = canvasDesignTool === option.tool;
                      return (
                        <div key={option.tool}>
                          {index === 4 && (
                            <DropdownMenuSeparator className="mx-1 my-1.5 bg-white/[0.08]" />
                          )}
                          <DropdownMenuItem
                            onSelect={() => setCanvasDesignTool(option.tool)}
                            className={cn(
                              'min-h-10 gap-2.5 rounded-[9px] px-2.5 text-[12px] text-white/80 focus:bg-white/[0.08] focus:text-white',
                              active && 'bg-white/[0.09] text-white',
                            )}
                          >
                            <ToolIcon className="size-4 text-white/65" />
                            <span className="font-medium">{option.label}</span>
                            <DropdownMenuShortcut className="text-[11px] tracking-normal text-white/40">
                              {option.shortcut}
                            </DropdownMenuShortcut>
                          </DropdownMenuItem>
                        </div>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="icon-sm"
                  variant={canvasDesignTool === 'text-block' ? 'secondary' : 'ghost'}
                  disabled={workspaceReadOnly}
                  className={cn(
                    'size-9 rounded-[8px]',
                    CANVAS_HUD_TOOLTIP_CLASS,
                    canvasDesignTool === 'text-block' && 'bg-[var(--kodety-accent)]/15 text-[var(--kodety-accent-hover)]',
                  )}
                  data-tooltip={canvasDesignTool === 'text-block' ? 'Cancelar Text (Esc)' : 'Text (T)'}
                  aria-label={
                    canvasDesignTool === 'text-block'
                      ? 'Cancelar ferramenta de texto'
                      : 'Ativar ferramenta de texto'
                  }
                  aria-keyshortcuts="T"
                  aria-pressed={canvasDesignTool === 'text-block'}
                  onClick={() =>
                    setCanvasDesignTool(current => (current === 'text-block' ? 'select' : 'text-block'))
                  }
                >
                  <span aria-hidden="true" className="text-[17px] font-medium leading-none">T</span>
                </Button>
                <div className="mx-1 h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />
                {!editingHtmlComponent && infiniteCanvasBetaEnabled && (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className={cn('size-9 rounded-[8px]', CANVAS_HUD_TOOLTIP_CLASS)}
                      onClick={() => changeInfiniteCanvasEnabled(true)}
                      data-tooltip="Canvas infinito · Beta instável"
                      title="Usar Canvas Infinito Beta por sua conta e risco"
                      aria-label="Ativar Canvas Infinito Beta instável"
                      aria-pressed={false}
                    >
                      <Frames />
                    </Button>
                    <div className="mx-1 h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />
                  </>
                )}
                <div
                  role="tablist"
                  aria-label="Breakpoints principais"
                  data-kodety-onboarding="design-responsive"
                  aria-orientation="horizontal"
                  className="flex items-center gap-1"
                >
                  {mainCanvasBreakpointTabs.map(tab => {
                    const active = viewport === tab.id;
                    return (
                      <Button
                        key={tab.id}
                        type="button"
                        role="tab"
                        size="icon-sm"
                        variant={active ? 'secondary' : 'ghost'}
                        className={cn(
                          'size-9 rounded-[8px]',
                          CANVAS_HUD_TOOLTIP_CLASS,
                          active &&
                            'bg-white/[0.09] text-[var(--kodety-accent-hover)] shadow-[inset_0_0_0_1px_rgb(175_175_255/.16)] hover:bg-white/[0.12] hover:text-[var(--kodety-accent-hover)]',
                        )}
                        onClick={() => selectCanvasBreakpoint(tab.id)}
                        data-tooltip={tab.label}
                        title={`${tab.label} · ${tab.breakpoint.width}px`}
                        aria-label={`Breakpoint ${tab.label}, ${tab.breakpoint.width} pixels`}
                        aria-selected={active}
                      >
                        {tab.icon === 'mobile' ? (
                          <Smartphone />
                        ) : tab.icon === 'tablet' ? (
                          <Square />
                        ) : tab.icon === 'notebook' ? (
                          <Notebook />
                        ) : tab.icon === 'wide' ? (
                          <WideScreen />
                        ) : (
                          <Monitor />
                        )}
                      </Button>
                    );
                  })}
                </div>
                <div className="mx-1 h-6 w-px shrink-0 bg-white/10" aria-hidden="true" />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className={cn('size-9 rounded-[8px]', CANVAS_HUD_TOOLTIP_CLASS)}
                  onClick={fitCanvas}
                  data-kodety-onboarding="responsive-fit"
                  data-tooltip="Ajustar canvas"
                  title="Enquadrar canvas"
                  aria-label="Enquadrar canvas"
                >
                  <Maximize2 />
                </Button>
                </div>
              </>
              ), canvasToolbarHost)}
            </CanvasChromeWhenCodeClosed>
          )}
        </>
      )}
    </>
  );
}

export const HtmlEditorCanvasStage = memo(HtmlEditorCanvasStageImpl);
