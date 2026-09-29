"use client";

import { memo, type ComponentProps } from "react";
import { useHtmlEditorChromeStore } from "@/stores/useHtmlEditorChromeStore";
import { HtmlPublishPanel } from "./HtmlPublishPanel";
import { HtmlShareDialog } from "./HtmlShareDialog";

type PublishPanelProps = Omit<
  ComponentProps<typeof HtmlPublishPanel>,
  "onClose"
>;
type ShareDialogProps = Omit<
  ComponentProps<typeof HtmlShareDialog>,
  "open" | "onOpenChange"
>;
export interface HtmlEditorChromeOverlaysProps {
  publishAvailable: boolean;
  publishPanelProps: PublishPanelProps;
  shareAvailable: boolean;
  shareDialogProps: ShareDialogProps;
}

function HtmlEditorChromeOverlaysImpl({
  publishAvailable,
  publishPanelProps,
  shareAvailable,
  shareDialogProps,
}: HtmlEditorChromeOverlaysProps) {
  const publishPanelOpen = useHtmlEditorChromeStore(
    (state) => state.publishPanelOpen,
  );
  const setPublishPanelOpen = useHtmlEditorChromeStore(
    (state) => state.setPublishPanelOpen,
  );
  const shareDialogOpen = useHtmlEditorChromeStore(
    (state) => state.shareDialogOpen,
  );
  const setShareDialogOpen = useHtmlEditorChromeStore(
    (state) => state.setShareDialogOpen,
  );

  return (
    <>
      {publishPanelOpen && publishAvailable && (
        <HtmlPublishPanel
          {...publishPanelProps}
          onClose={() => setPublishPanelOpen(false)}
        />
      )}
      {shareAvailable && (
        <HtmlShareDialog
          {...shareDialogProps}
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
        />
      )}
    </>
  );
}

export const HtmlEditorChromeOverlays = memo(HtmlEditorChromeOverlaysImpl);
