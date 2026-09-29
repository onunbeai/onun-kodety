import { create } from "zustand";
import {
  MOTION_TIMELINE_DEFAULT_HEIGHT,
  MOTION_TIMELINE_DEFAULT_MAX_HEIGHT,
  MOTION_TIMELINE_HEIGHT_PREFERENCE,
  MOTION_TIMELINE_MIN_HEIGHT,
} from "@/lib/html-editor/editor-constants";
import {
  readLocalPreference,
  writeLocalPreference,
} from "@/lib/html-editor/editor-wordpress-helpers";
import type { InteractionKeyframeSelection } from "@/lib/html-editor/interactions";

function initialTimelineHeight() {
  const saved = Number(readLocalPreference(MOTION_TIMELINE_HEIGHT_PREFERENCE));
  if (Number.isFinite(saved) && saved >= MOTION_TIMELINE_MIN_HEIGHT) {
    return Math.round(saved);
  }
  if (typeof window === "undefined") return MOTION_TIMELINE_DEFAULT_HEIGHT;
  return Math.max(
    MOTION_TIMELINE_MIN_HEIGHT,
    Math.min(
      MOTION_TIMELINE_DEFAULT_MAX_HEIGHT,
      Math.round(window.innerHeight * 0.36),
    ),
  );
}

interface HtmlTimelineState {
  showTimeline: boolean;
  timelineHeight: number;
  timelineFocusTimelineId: string | null;
  timelineFocusClipId: string | null;
  activeTimelineKeyframe: InteractionKeyframeSelection | null;
  setShowTimeline: (showTimeline: boolean) => void;
  setTimelineHeight: (timelineHeight: number) => void;
  setTimelineFocusTimelineId: (timelineFocusTimelineId: string | null) => void;
  setTimelineFocusClipId: (timelineFocusClipId: string | null) => void;
  setActiveTimelineKeyframe: (
    activeTimelineKeyframe: InteractionKeyframeSelection | null,
  ) => void;
  reset: () => void;
}

export const useHtmlTimelineStore = create<HtmlTimelineState>((set) => ({
  showTimeline: false,
  timelineHeight: initialTimelineHeight(),
  timelineFocusTimelineId: null,
  timelineFocusClipId: null,
  activeTimelineKeyframe: null,
  setShowTimeline: (showTimeline) => set({ showTimeline }),
  setTimelineHeight: (timelineHeight) => {
    const rounded = Math.round(timelineHeight);
    writeLocalPreference(MOTION_TIMELINE_HEIGHT_PREFERENCE, String(rounded));
    set({ timelineHeight: rounded });
  },
  setTimelineFocusTimelineId: (timelineFocusTimelineId) =>
    set({ timelineFocusTimelineId }),
  setTimelineFocusClipId: (timelineFocusClipId) => set({ timelineFocusClipId }),
  setActiveTimelineKeyframe: (activeTimelineKeyframe) =>
    set({ activeTimelineKeyframe }),
  reset: () =>
    set({
      showTimeline: false,
      timelineHeight: initialTimelineHeight(),
      timelineFocusTimelineId: null,
      timelineFocusClipId: null,
      activeTimelineKeyframe: null,
    }),
}));
