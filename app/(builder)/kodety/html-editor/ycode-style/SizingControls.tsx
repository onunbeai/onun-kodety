'use client';

import { memo, useMemo } from 'react';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import type { Layer } from '@/types';
import SizingControlsCore, { type SizingControlsCoreProps } from './SizingControlsCore';

interface LegacySizingControlsProps
  extends Omit<SizingControlsCoreProps, 'parentHasGrid'> {
  parentHasGrid?: boolean;
}

function findParentLayer(
  tree: readonly Layer[],
  targetId: string,
  parent: Layer | null = null,
): Layer | null {
  for (const node of tree) {
    if (node.id === targetId) return parent;
    if (node.children) {
      const found = findParentLayer(node.children, targetId, node);
      if (found) return found;
    }
  }
  return null;
}

/** Store-backed compatibility boundary for the legacy page/component editor. */
export const LegacySizingControls = memo(function LegacySizingControls({
  layer,
  onLayerUpdate,
  parentHasGrid: explicitParentHasGrid,
}: LegacySizingControlsProps) {
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const editingComponentId = useEditorStore((state) => state.editingComponentId);
  const editingComponentVariantId = useEditorStore(
    (state) => state.editingComponentVariantId,
  );
  const draftsByPageId = usePagesStore((state) => state.draftsByPageId);
  const componentDrafts = useComponentsStore((state) => state.componentDrafts);

  const storeParentHasGrid = useMemo(() => {
    if (!layer) return false;

    let layers: readonly Layer[] = [];
    if (editingComponentId) {
      const variantDrafts = componentDrafts[editingComponentId];
      const variantId = (
        editingComponentVariantId
        && variantDrafts?.[editingComponentVariantId]
      )
        ? editingComponentVariantId
        : (variantDrafts ? Object.keys(variantDrafts)[0] : null);
      layers = variantId && variantDrafts ? variantDrafts[variantId] || [] : [];
    } else if (currentPageId) {
      layers = draftsByPageId[currentPageId]?.layers || [];
    }

    const parent = findParentLayer(layers, layer.id);
    return parent?.design?.layout?.display === 'Grid';
  }, [
    componentDrafts,
    currentPageId,
    draftsByPageId,
    editingComponentId,
    editingComponentVariantId,
    layer,
  ]);

  return (
    <SizingControlsCore
      layer={layer}
      onLayerUpdate={onLayerUpdate}
      parentHasGrid={explicitParentHasGrid ?? storeParentHasGrid}
    />
  );
});

export default LegacySizingControls;
