'use client';

import { memo } from 'react';
import { Label } from './ui/label';
import Icon from './ui/icon';
import { useHtmlCssDesignSync as useDesignSync } from './use-html-css-design-sync';
import { useEditorStore } from '@/stores/useEditorStore';
import type { Layer } from '@/types';
import {
  VisualSegmentedField,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';

interface SelfLayoutControlsProps {
  layer: Layer | null;
  parentLayer?: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const noop = () => {};

const SELF_ALIGN_OPTIONS: VisualStyleOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'start', label: 'Start', icon: <Icon name="alignStart" className="size-[14.5px]" /> },
  { value: 'center', label: 'Center', icon: <Icon name="alignCenter" className="size-[14.5px]" /> },
  { value: 'end', label: 'End', icon: <Icon name="alignEnd" className="size-[14.5px]" /> },
  { value: 'stretch', label: 'Stretch', icon: <Icon name="alignStretch" className="size-[14.5px]" /> },
];

/**
 * Child-in-parent layout controls (align-self). Rendered for any layer whose
 * parent is a flex/grid container, independent of the layer's own layout panel.
 */
const SelfLayoutControls = memo(function SelfLayoutControls({ layer, parentLayer = null, onLayerUpdate }: SelfLayoutControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);

  const { updateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  // Read-only sync for the parent to resolve its layout (align-self axis and
  // visibility depend on the parent's flex/grid direction, not this layer's)
  const { getDesignProperty: getParentDesignProperty } = useDesignSync({
    layer: parentLayer,
    onLayerUpdate: noop,
    activeBreakpoint,
    activeUIState,
  });

  const alignSelf = getDesignProperty('layout', 'alignSelf') || 'auto';

  const parentDisplay = parentLayer ? (getParentDesignProperty('layout', 'display') || '') : '';
  const parentFlexDirection = getParentDesignProperty('layout', 'flexDirection') || 'row';
  const isParentFlex = parentDisplay === 'flex' || parentDisplay === 'inline-flex';
  const isParentGrid = parentDisplay === 'grid' || parentDisplay === 'inline-grid';
  const isParentColumnAxis = isParentFlex && (parentFlexDirection === 'column' || parentFlexDirection === 'column-reverse');

  if (!isParentFlex && !isParentGrid) return null;

  // 'auto' clears the override to keep classes clean
  const handleAlignSelfChange = (value: string) => {
    updateDesignProperty('layout', 'alignSelf', value === 'auto' ? null : value);
  };

  return (
    <div className="py-5" data-design-token-section="Self Layout">
      <header className="py-4 -mt-4 flex items-center gap-1.5">
        <Label>Self layout</Label>
        <Label variant="muted">{isParentGrid ? 'Grid container' : 'Flex container'}</Label>
      </header>

      <VisualSegmentedField
        label="Self align"
        value={alignSelf}
        options={SELF_ALIGN_OPTIONS}
        onValueChange={handleAlignSelfChange}
        property="align-self"
        glyphClassName={isParentColumnAxis ? '-rotate-90' : undefined}
      />
    </div>
  );
});
export default SelfLayoutControls;
