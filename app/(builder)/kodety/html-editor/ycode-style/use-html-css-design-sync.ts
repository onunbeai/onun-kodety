'use client';

import { useCallback, useEffect, useRef } from 'react';
import debounce from 'lodash.debounce';
import type { Breakpoint, Layer, UIState } from '@/types';

interface UseHtmlCssDesignSyncProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeBreakpoint?: Breakpoint;
  activeUIState?: UIState;
  activeTextStyleKey?: string | null;
}

type DesignCategory = keyof NonNullable<Layer['design']>;

interface DesignUpdate {
  category: DesignCategory;
  property: string;
  value: string | null;
}

/** Keeps the Ycode control API while persisting through authored HTML/CSS. */
export function useHtmlCssDesignSync({
  layer,
  onLayerUpdate,
}: UseHtmlCssDesignSyncProps) {
  const layerRef = useRef(layer);
  layerRef.current = layer;

  const applyUpdates = useCallback(
    (updates: DesignUpdate[]) => {
      const currentLayer = layerRef.current;
      if (!currentLayer) return;

      const nextDesign = { ...(currentLayer.design || {}) };
      for (const { category, property, value } of updates) {
        const currentCategory = (nextDesign[category] || {}) as Record<string, unknown>;
        const nextCategory: Record<string, unknown> = {
          ...currentCategory,
          isActive: true,
        };
        if (value === null || value === '') delete nextCategory[property];
        else nextCategory[property] = value;
        nextDesign[category] = nextCategory as never;
      }

      layerRef.current = { ...currentLayer, design: nextDesign };
      onLayerUpdate(currentLayer.id, { design: nextDesign });
    },
    [onLayerUpdate],
  );

  const updateDesignProperty = useCallback(
    (category: DesignCategory, property: string, value: string | null) => {
      applyUpdates([{ category, property, value }]);
    },
    [applyUpdates],
  );

  const updateDesignProperties = useCallback(
    (updates: DesignUpdate[]) => applyUpdates(updates),
    [applyUpdates],
  );

  const updateRef = useRef(updateDesignProperty);
  updateRef.current = updateDesignProperty;
  const debouncedByPropertyRef = useRef<Map<string, ReturnType<typeof debounce>>>(new Map());

  const debouncedUpdateDesignProperty = useCallback(
    (category: DesignCategory, property: string, value: string | null) => {
      const key = `${String(category)}:${property}`;
      // The HTML inspector already owns the preview/commit transaction. Do
      // not stack another delay that lets a mode click observe a stale field.
      if (layerRef.current?.id.startsWith('html-editor-selection:realtime-preview:')) {
        debouncedByPropertyRef.current.get(key)?.cancel();
        updateRef.current(category, property, value);
        return;
      }
      let pending = debouncedByPropertyRef.current.get(key);
      if (!pending) {
        pending = debounce(
          (nextCategory: DesignCategory, nextProperty: string, nextValue: string | null) => {
            updateRef.current(nextCategory, nextProperty, nextValue);
          },
          150,
        );
        debouncedByPropertyRef.current.set(key, pending);
      }
      pending(category, property, value);
    },
    [],
  );

  const cancelPendingDesignProperties = useCallback((
    properties: readonly string[],
    category: DesignCategory = 'borders',
  ) => {
    properties.forEach(property => {
      debouncedByPropertyRef.current.get(`${String(category)}:${property}`)?.cancel();
    });
  }, []);

  useEffect(() => {
    debouncedByPropertyRef.current.forEach(pending => pending.cancel());
  }, [layer?.id]);

  useEffect(
    () => () => {
      debouncedByPropertyRef.current.forEach(pending => pending.cancel());
    },
    [],
  );

  const getDesignProperty = useCallback(
    (category: DesignCategory, property: string) => {
      const categoryData = layer?.design?.[category] as Record<string, unknown> | undefined;
      const value = categoryData?.[property];
      return typeof value === 'string' ? value : undefined;
    },
    [layer],
  );

  return {
    updateDesignProperty,
    updateDesignProperties,
    debouncedUpdateDesignProperty,
    cancelPendingDesignProperties,
    getDesignProperty,
  };
}
