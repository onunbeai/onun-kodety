/** Pixels per authored second. Wide limits let Fit describe both micro motion
 * and long, scroll-driven sequences without manufacturing empty track space. */
export const TIMELINE_MIN_ZOOM = 0.1;
export const TIMELINE_MAX_ZOOM = 10_000;
export const TIMELINE_DEFAULT_ZOOM = 100;
export const TIMELINE_LABEL_COLUMN_WIDTH = 192;
export const TIMELINE_END_PADDING = 24;
export const TIMELINE_MIN_LABEL_SPACING = 48;
export const TIMELINE_MAX_PREVIEW_INTERACTIONS = 512;

const TIMELINE_TICK_STEPS = [
  0.01,
  0.02,
  0.05,
  0.1,
  0.2,
  0.5,
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  1000,
] as const;

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function timelinePreviewInteractionIds(
  scope: 'selection' | 'element' | 'interaction',
  activeInteractionId: string,
  visibleInteractionIds: readonly string[],
) {
  const candidates = scope === 'interaction'
    ? [activeInteractionId]
    : visibleInteractionIds.length
      ? visibleInteractionIds
      : [activeInteractionId];
  const unique = new Set<string>();
  candidates.forEach(id => {
    const normalized = id.trim();
    if (
      normalized
      && unique.size < TIMELINE_MAX_PREVIEW_INTERACTIONS
    ) unique.add(normalized);
  });
  return Array.from(unique);
}

export function clampTimelineZoom(
  value: number,
  fallback = TIMELINE_DEFAULT_ZOOM,
) {
  const safeFallback = Number.isFinite(fallback)
    ? fallback
    : TIMELINE_DEFAULT_ZOOM;
  const safeValue = Number.isFinite(value) ? value : safeFallback;
  const clamped = Math.max(
    TIMELINE_MIN_ZOOM,
    Math.min(TIMELINE_MAX_ZOOM, safeValue),
  );
  // Sub-pixel-per-second scales need one decimal place, while ordinary editor
  // zoom remains pleasantly integer based in the toolbar.
  return clamped < 10
    ? Math.round(clamped * 10) / 10
    : Math.round(clamped);
}

export function fitTimelineZoom(
  duration: number,
  viewportWidth: number,
  labelColumnWidth = TIMELINE_LABEL_COLUMN_WIDTH,
  endPadding = TIMELINE_END_PADDING,
) {
  const safeDuration = finitePositive(duration, 1);
  const safeViewportWidth = finitePositive(viewportWidth, 0);
  const safeLabelColumnWidth = Math.max(
    0,
    Number.isFinite(labelColumnWidth) ? labelColumnWidth : 0,
  );
  const safeEndPadding = Math.max(
    0,
    Number.isFinite(endPadding) ? endPadding : 0,
  );
  const availableWidth = safeViewportWidth
    - safeLabelColumnWidth
    - safeEndPadding;

  if (availableWidth <= 0) return TIMELINE_MIN_ZOOM;
  return clampTimelineZoom(availableWidth / safeDuration);
}

export function timelineTickStep(
  zoom: number,
  minLabelSpacing = TIMELINE_MIN_LABEL_SPACING,
) {
  const safeZoom = finitePositive(zoom, TIMELINE_DEFAULT_ZOOM);
  const safeSpacing = finitePositive(
    minLabelSpacing,
    TIMELINE_MIN_LABEL_SPACING,
  );
  return TIMELINE_TICK_STEPS.find(step => step * safeZoom >= safeSpacing)
    ?? TIMELINE_TICK_STEPS[TIMELINE_TICK_STEPS.length - 1];
}

export function timelineTickPrecision(step: number) {
  if (step < 0.1) return 2;
  if (step < 1) return 1;
  return 0;
}

export function buildTimelineRulerTicks(trackWidth: number, zoom: number) {
  const safeTrackWidth = Math.max(
    0,
    Number.isFinite(trackWidth) ? trackWidth : 0,
  );
  const safeZoom = finitePositive(zoom, TIMELINE_DEFAULT_ZOOM);
  const step = timelineTickStep(safeZoom);
  const tickCount = Math.min(
    10_000,
    Math.max(0, Math.floor((safeTrackWidth / safeZoom) / step)),
  );

  return {
    step,
    ticks: Array.from(
      { length: tickCount + 1 },
      (_, index) => Number((index * step).toFixed(6)),
    ),
  };
}
