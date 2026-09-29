'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CodeEditor } from '@/components/ui/code-editor';
import { toast } from 'sonner';

interface ExportHtmlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
}

export default function ExportHtmlDialog({
  open,
  onOpenChange,
  html,
}: ExportHtmlDialogProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      toast.error('Failed to copy — please select the code and copy manually');
    }
  };

  const handleClose = () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = null;
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="640px"
        className="max-h-[calc(100dvh-24px)] gap-0 overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>Export layer as HTML</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4.5">
          <CodeEditor
            value={html}
            readOnly
            className="min-h-52 max-h-[60vh] flex-1"
          />

          <DialogFooter className="mt-1 grid grid-cols-1 min-[420px]:grid-cols-2">
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
            <Button onClick={handleCopy}>
              {copied ? (
                <>
                  <Icon name="check" className="size-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Icon name="copy" className="size-3.5" />
                  Copy to clipboard
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
