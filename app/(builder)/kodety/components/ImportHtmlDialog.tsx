'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';

interface ImportHtmlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (html: string) => void;
}

export default function ImportHtmlDialog({
  open,
  onOpenChange,
  onImport,
}: ImportHtmlDialogProps) {
  const [html, setHtml] = useState('');

  const handleImport = () => {
    if (!html.trim()) return;
    onImport(html.trim());
    setHtml('');
    onOpenChange(false);
  };

  const handleCancel = () => {
    setHtml('');
    onOpenChange(false);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setHtml('');
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        width="640px"
        className="max-h-[calc(100dvh-24px)] gap-0 overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>Convert HTML to layers</DialogTitle>
          <DialogDescription>
            If you use Tailwind CSS, classes will be converted to design settings in Kodety. &apos;Script&apos; and &apos;Style&apos; tags will be ignored.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4.5">
          <CodeEditor
            value={html}
            onValueChange={setHtml}
            placeholder="Enter your HTML code here..."
            className="min-h-52 max-h-[60vh] flex-1"
            autoFocus
          />

          <DialogFooter className="mt-1 grid grid-cols-1 min-[420px]:grid-cols-2">
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={!html.trim()}>
              Import
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
