import type { SetStateAction } from "react";
import { create } from "zustand";
import {
  DEFAULT_PRIMARY_BREAKPOINT,
  type Breakpoint,
} from "@/lib/html-editor/css-patcher";
import type { Viewport, ViewportSize } from "@/lib/html-editor/editor-types";
import {
  readLocalPreference,
  removeLocalPreference,
  writeLocalPreference,
} from "@/lib/html-editor/editor-wordpress-helpers";
import { defaultInfiniteCanvasViewportHeight } from "@/lib/html-editor/infinite-canvas-runtime";

const CANVAS_PREFERENCE_KEY = "html-editor:canvas-preferences";

type ViewportSetter<T> = (next: SetStateAction<T>) => void;

function resolveStateAction<T>(next: SetStateAction<T>, current: T): T {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

function readCanvasPreferences() {
  const saved = readLocalPreference(CANVAS_PREFERENCE_KEY);
  if (!saved)
    return { zoom: 75, viewportSizes: {} as Record<Viewport, ViewportSize> };
  try {
    const preferences = JSON.parse(saved) as {
      zoom?: number;
      viewportSizes?: Record<Viewport, ViewportSize> & {
        desktop?: ViewportSize;
      };
    };
    const viewportSizes = { ...(preferences.viewportSizes || {}) };
    if (viewportSizes.desktop && !viewportSizes.base) {
      viewportSizes.base = viewportSizes.desktop;
      delete viewportSizes.desktop;
    }
    return {
      zoom: preferences.zoom
        ? Math.max(10, Math.min(200, preferences.zoom))
        : 75,
      viewportSizes,
    };
  } catch {
    removeLocalPreference(CANVAS_PREFERENCE_KEY);
    return { zoom: 75, viewportSizes: {} as Record<Viewport, ViewportSize> };
  }
}

function persistCanvasPreferences(
  zoom: number,
  viewportSizes: Record<Viewport, ViewportSize>,
) {
  writeLocalPreference(
    CANVAS_PREFERENCE_KEY,
    JSON.stringify({ zoom, viewportSizes }),
  );
}

export function defaultHtmlViewportSize(
  id: Viewport,
  breakpoints: Breakpoint[],
  primaryBreakpoint: Breakpoint = DEFAULT_PRIMARY_BREAKPOINT,
): ViewportSize {
  if (id === "base") return { width: primaryBreakpoint.width, height: 1080 };
  const breakpoint = breakpoints.find((item) => item.id === id);
  const width = breakpoint?.width ?? 768;
  return { width, height: defaultInfiniteCanvasViewportHeight(width) };
}

export function resolveHtmlViewportSize(
  id: Viewport,
  viewportSizes: Record<Viewport, ViewportSize>,
  breakpoints: Breakpoint[],
  primaryBreakpoint: Breakpoint = DEFAULT_PRIMARY_BREAKPOINT,
) {
  return (
    viewportSizes[id] ??
    defaultHtmlViewportSize(id, breakpoints, primaryBreakpoint)
  );
}

interface HtmlViewportState {
  viewport: Viewport;
  zoom: number;
  viewportSizes: Record<Viewport, ViewportSize>;
  canvasAvailableSize: ViewportSize;
  setViewport: (viewport: Viewport) => void;
  setZoom: ViewportSetter<number>;
  setViewportSizes: ViewportSetter<Record<Viewport, ViewportSize>>;
  setCanvasAvailableSize: ViewportSetter<ViewportSize>;
  reset: () => void;
}

const initialPreferences = readCanvasPreferences();

export const useHtmlViewportStore = create<HtmlViewportState>((set) => ({
  viewport: "base",
  zoom: initialPreferences.zoom,
  viewportSizes: initialPreferences.viewportSizes,
  canvasAvailableSize: { width: 0, height: 0 },
  setViewport: (viewport) => set({ viewport }),
  setZoom: (next) =>
    set((state) => {
      const zoom = resolveStateAction(next, state.zoom);
      persistCanvasPreferences(zoom, state.viewportSizes);
      return { zoom };
    }),
  setViewportSizes: (next) =>
    set((state) => {
      const viewportSizes = resolveStateAction(next, state.viewportSizes);
      persistCanvasPreferences(state.zoom, viewportSizes);
      return { viewportSizes };
    }),
  setCanvasAvailableSize: (next) =>
    set((state) => ({
      canvasAvailableSize: resolveStateAction(next, state.canvasAvailableSize),
    })),
  reset: () => {
    const preferences = readCanvasPreferences();
    set({
      viewport: "base",
      zoom: preferences.zoom,
      viewportSizes: preferences.viewportSizes,
      canvasAvailableSize: { width: 0, height: 0 },
    });
  },
}));
