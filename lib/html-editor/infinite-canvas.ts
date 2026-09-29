export interface InfiniteCanvasFrameInput {
  id: string;
  width: number;
  height: number;
}

export interface InfiniteCanvasFrameLayout extends InfiniteCanvasFrameInput {
  x: number;
  y: number;
}

export interface InfiniteCanvasLayout {
  frames: InfiniteCanvasFrameLayout[];
  width: number;
  height: number;
}

export interface InfiniteCanvasView {
  zoom: number;
  pan: { x: number; y: number };
}

// Full-page breakpoint canvases can legitimately be tens of thousands of
// pixels tall. A 10% floor prevented "Fit" from showing the complete document
// and made the plane feel scroll-bound. Two percent matches design tools while
// keeping even very tall responsive pages fully frameable.
export const INFINITE_CANVAS_MIN_ZOOM = 2;
export const INFINITE_CANVAS_MAX_ZOOM = 200;
export const INFINITE_CANVAS_FRAME_HEADER_HEIGHT = 36;
export const INFINITE_CANVAS_FRAME_GAP = 48;
export const INFINITE_CANVAS_PLANE_PADDING = 72;

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clampInfiniteCanvasZoom(value: number) {
  if (!Number.isFinite(value)) return 64;
  return Math.max(
    INFINITE_CANVAS_MIN_ZOOM,
    Math.min(INFINITE_CANVAS_MAX_ZOOM, value),
  );
}

/**
 * Places responsive frames on one horizontal, deterministic world plane.
 * Geometry stays in CSS pixels; the view transform is applied separately so
 * resizing a breakpoint never accumulates rounding drift.
 */
export function layoutInfiniteCanvasFrames(
  inputs: InfiniteCanvasFrameInput[],
  options: {
    gap?: number;
    padding?: number;
    headerHeight?: number;
  } = {},
): InfiniteCanvasLayout {
  const gap = finitePositive(options.gap ?? INFINITE_CANVAS_FRAME_GAP, INFINITE_CANVAS_FRAME_GAP);
  const padding = Math.max(0, Number.isFinite(options.padding) ? options.padding! : INFINITE_CANVAS_PLANE_PADDING);
  const headerHeight = finitePositive(
    options.headerHeight ?? INFINITE_CANVAS_FRAME_HEADER_HEIGHT,
    INFINITE_CANVAS_FRAME_HEADER_HEIGHT,
  );
  const normalized = inputs.map(frame => ({
    ...frame,
    width: Math.max(1, finitePositive(frame.width, 1)),
    height: Math.max(1, finitePositive(frame.height, 1)),
  }));
  const tallest = normalized.reduce(
    (maximum, frame) => Math.max(maximum, frame.height + headerHeight),
    0,
  );
  let cursor = padding;
  const frames = normalized.map(frame => {
    const layout = {
      ...frame,
      x: cursor,
      y: padding,
    };
    cursor += frame.width + gap;
    return layout;
  });
  return {
    frames,
    width: Math.max(padding * 2, cursor - (normalized.length ? gap : 0) + padding),
    height: Math.max(padding * 2, tallest + padding * 2),
  };
}

export function fitInfiniteCanvasView(
  viewport: { width: number; height: number },
  content: { width: number; height: number },
  padding = 96,
): InfiniteCanvasView {
  const viewportWidth = Math.max(1, finitePositive(viewport.width, 1));
  const viewportHeight = Math.max(1, finitePositive(viewport.height, 1));
  const contentWidth = Math.max(1, finitePositive(content.width, 1));
  const contentHeight = Math.max(1, finitePositive(content.height, 1));
  const availableWidth = Math.max(1, viewportWidth - Math.max(0, padding) * 2);
  const availableHeight = Math.max(1, viewportHeight - Math.max(0, padding) * 2);
  const zoom = clampInfiniteCanvasZoom(
    Math.floor(Math.min(availableWidth / contentWidth, availableHeight / contentHeight) * 100),
  );
  const scale = zoom / 100;
  return {
    zoom,
    pan: {
      x: Math.round((viewportWidth - contentWidth * scale) / 2),
      y: Math.round((viewportHeight - contentHeight * scale) / 2),
    },
  };
}

/**
 * Moves the selected breakpoint into view without reframing the full plane.
 * The current zoom and vertical reading position are intentionally preserved:
 * responsive frames share a vertical origin, so only horizontal pan needs to
 * change when the user compares the same section at another breakpoint.
 */
export function focusInfiniteCanvasFrame(
  view: InfiniteCanvasView,
  viewport: { width: number; height: number },
  frame: Pick<InfiniteCanvasFrameLayout, 'x' | 'width'>,
): InfiniteCanvasView {
  const zoom = clampInfiniteCanvasZoom(view.zoom);
  const scale = zoom / 100;
  const viewportWidth = Math.max(1, finitePositive(viewport.width, 1));
  const frameX = Number.isFinite(frame.x) ? frame.x : 0;
  const frameWidth = Math.max(1, finitePositive(frame.width, 1));
  return {
    zoom,
    pan: {
      x: (viewportWidth - frameWidth * scale) / 2 - frameX * scale,
      y: Number.isFinite(view.pan.y) ? view.pan.y : 0,
    },
  };
}

/**
 * Cursor-anchored zoom keeps the same world point below the pointer, matching
 * design tools and avoiding the disorienting jump of centre-based zoom.
 */
export function zoomInfiniteCanvasAtPoint(
  view: InfiniteCanvasView,
  point: { x: number; y: number },
  deltaY: number,
): InfiniteCanvasView {
  const previousZoom = clampInfiniteCanvasZoom(view.zoom);
  const previousScale = previousZoom / 100;
  const nextZoom = clampInfiniteCanvasZoom(previousZoom * Math.exp(-deltaY * 0.0025));
  const nextScale = nextZoom / 100;
  const world = {
    x: (point.x - view.pan.x) / previousScale,
    y: (point.y - view.pan.y) / previousScale,
  };
  return {
    zoom: nextZoom,
    pan: {
      x: point.x - world.x * nextScale,
      y: point.y - world.y * nextScale,
    },
  };
}

export function normalizeInfiniteCanvasView(value: unknown): InfiniteCanvasView | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    zoom?: unknown;
    pan?: { x?: unknown; y?: unknown };
  };
  if (
    typeof candidate.zoom !== 'number'
    || typeof candidate.pan?.x !== 'number'
    || typeof candidate.pan?.y !== 'number'
    || !Number.isFinite(candidate.pan.x)
    || !Number.isFinite(candidate.pan.y)
  ) return null;
  return {
    zoom: clampInfiniteCanvasZoom(candidate.zoom),
    pan: { x: candidate.pan.x, y: candidate.pan.y },
  };
}
