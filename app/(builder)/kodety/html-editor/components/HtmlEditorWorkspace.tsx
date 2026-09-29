"use client";

import { memo, type ComponentPropsWithoutRef } from "react";
import { useHtmlTimelineStore } from "@/stores/useHtmlTimelineStore";

type HtmlEditorWorkspaceProps = ComponentPropsWithoutRef<"section">;

function HtmlEditorWorkspaceImpl({
  style,
  ...props
}: HtmlEditorWorkspaceProps) {
  const showTimeline = useHtmlTimelineStore((state) => state.showTimeline);
  const timelineHeight = useHtmlTimelineStore((state) => state.timelineHeight);

  return (
    <section
      {...props}
      data-kodety-onboarding="design-canvas"
      style={{
        ...style,
        paddingBottom: showTimeline ? timelineHeight : undefined,
      }}
    />
  );
}

export const HtmlEditorWorkspace = memo(HtmlEditorWorkspaceImpl);
