'use client';

/**
 * Confirm Dialog Component
 *
 * Reusable confirmation dialog for destructive or important actions
 * Provides consistent UX for confirmation flows
 * Automatically handles loading state for async callbacks
 */

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
import { Spinner } from '@/components/ui/spinner';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: React.ReactNode;
  children?: React.ReactNode; // Slot for structured content. When provided, overrides description.
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'default' | 'destructive' | 'secondary';
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  showCloseButton?: boolean;
  showCancelButton?: boolean;
  disableConfirm?: boolean;
  saveLabel?: string;
  onSave?: () => void | Promise<void>;
  /**
   * Side action that runs without closing the dialog — for the safety net a
   * destructive confirmation may want to offer first (backup, export, preview).
   */
  extraActionLabel?: React.ReactNode;
  onExtraAction?: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'destructive',
  onConfirm,
  onCancel,
  showCloseButton = false,
  showCancelButton = true,
  disableConfirm = false,
  saveLabel,
  onSave,
  extraActionLabel,
  onExtraAction,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);
  const [extraLoading, setExtraLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleCancel = () => {
    if (loading || extraLoading) return; // Prevent closing while loading
    onCancel?.();
    onOpenChange?.(false);
  };

  const handleConfirm = async () => {
    setErrorMessage('');
    setLoading(true);
    try {
      const result = onConfirm();
      // Check if result is a Promise
      if (result instanceof Promise) {
        await result;
      }
      // Close dialog after successful completion
      onOpenChange?.(false);
    } catch (error) {
      console.error('Error in confirm action:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível concluir esta ação.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!onSave) return;

    setErrorMessage('');
    setLoading(true);
    try {
      const result = onSave();
      // Check if result is a Promise
      if (result instanceof Promise) {
        await result;
      }
      // Close dialog after successful completion
      onOpenChange?.(false);
    } catch (error) {
      console.error('Error in save action:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar as alterações.');
    } finally {
      setLoading(false);
    }
  };

  // The side action deliberately keeps the dialog open: it exists to be used
  // *before* deciding, so the confirmation must still be there afterwards.
  const handleExtraAction = async () => {
    if (!onExtraAction) return;

    setErrorMessage('');
    setExtraLoading(true);
    try {
      const result = onExtraAction();
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      console.error('Error in extra action:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível concluir esta ação.');
    } finally {
      setExtraLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if ((loading || extraLoading) && !newOpen) return; // Prevent closing while loading
    onOpenChange?.(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={showCloseButton && !loading}
        className="overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {children ? (
          <DialogDescription asChild>
            <div className="leading-relaxed text-muted-foreground text-xs">
              {children}
            </div>
          </DialogDescription>
        ) : (
          <DialogDescription className="leading-relaxed">
            {description}
          </DialogDescription>
        )}
        {errorMessage && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant={confirmVariant}
            size="sm"
            onClick={handleConfirm}
            disabled={loading || extraLoading || disableConfirm}
          >
            {loading && <Spinner />}
            {confirmLabel}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {extraActionLabel && onExtraAction && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExtraAction}
                disabled={loading || extraLoading}
              >
                {extraLoading && <Spinner />}
                {extraActionLabel}
              </Button>
            )}
            {showCancelButton && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCancel}
                disabled={loading || extraLoading}
              >
                {cancelLabel}
              </Button>
            )}
            {saveLabel && onSave && (
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={loading || extraLoading}
              >
                {saveLabel}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
