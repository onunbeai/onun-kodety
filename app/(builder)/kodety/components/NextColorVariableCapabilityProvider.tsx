'use client';

import type { ReactNode } from 'react';
import {
  ColorVariableCapabilityProvider,
} from '@/lib/color-variable-capability-context';
import type { ColorVariableCapability } from '@/lib/editor-platform-services';
import { useColorVariablesStore } from '@/stores/useColorVariablesStore';

/**
 * Compatibility adapter for the legacy Next editor. Core color controls only
 * see the platform capability and never import this store.
 */
export const nextColorVariableCapability: ColorVariableCapability = {
  kind: 'next-legacy',
  capabilities: {
    list: true,
    get: true,
    subscribe: true,
    create: true,
    update: true,
    delete: true,
    reorder: true,
    previewOverride: true,
  },
  list: () => useColorVariablesStore.getState().colorVariables,
  get: id => useColorVariablesStore.getState().getVariableById(id),
  subscribe: listener => useColorVariablesStore.subscribe(listener),
  create: (name, value) => useColorVariablesStore.getState().createColorVariable(name, value),
  update: (id, changes) => useColorVariablesStore.getState().updateColorVariable(id, changes),
  delete: id => useColorVariablesStore.getState().deleteColorVariable(id),
  reorder: orderedIds => useColorVariablesStore.getState().reorderColorVariables([...orderedIds]),
  setPreviewOverride: override => useColorVariablesStore.getState().setPreviewOverride(override),
};

export function NextColorVariableCapabilityProvider({ children }: { children: ReactNode }) {
  return (
    <ColorVariableCapabilityProvider capability={nextColorVariableCapability}>
      {children}
    </ColorVariableCapabilityProvider>
  );
}
