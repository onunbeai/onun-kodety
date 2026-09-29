'use client';

/**
 * Create Component Dialog
 *
 * Dialog for creating a component from a layer
 * Prompts user for component name
 */

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from '@/components/ui/gravity-icons';
import { toast } from 'sonner';

interface CreateComponentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (componentName: string) => void;
  layerName?: string;
}

export default function CreateComponentDialog({
  open,
  onOpenChange,
  onConfirm,
  layerName,
}: CreateComponentDialogProps) {
  const [componentName, setComponentName] = useState(layerName || '');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (open) setComponentName(layerName || '');
    else setComponentName('');
  }, [layerName, open]);

  const handleConfirm = async () => {
    if (!componentName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      await onConfirm(componentName.trim());
      setComponentName('');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o componente.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setComponentName('');
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && componentName.trim() && !isCreating) {
      e.preventDefault();
      void handleConfirm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isCreating) onOpenChange(nextOpen); }}>
      <DialogContent
        width="320px"
        className="max-h-[calc(100dvh-24px)] gap-0 overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>Create component</DialogTitle>
          <DialogDescription>Transforme a camada selecionada em um componente reutilizável.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4.5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="component-name">Nome</Label>
            <Input
              id="component-name"
              placeholder="Name"
              value={componentName}
              onChange={(e) => setComponentName(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <DialogFooter className="mt-1 grid grid-cols-1 min-[300px]:grid-cols-2">
            <Button
              variant="secondary"
              onClick={handleCancel}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void handleConfirm()}
              disabled={!componentName.trim() || isCreating}
            >
              {isCreating && <Loader2 className="animate-spin motion-reduce:animate-none" />}
              {isCreating ? 'Criando…' : 'Criar'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
