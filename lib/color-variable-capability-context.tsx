'use client';

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  ColorVariableCapability,
  EditorColorVariable,
} from '@/lib/editor-platform-services';

const EMPTY_COLOR_VARIABLES = Object.freeze([]) as readonly EditorColorVariable[];
const ColorVariableCapabilityContext = createContext<ColorVariableCapability | null>(null);

export interface ColorVariableCapabilityProviderProps {
  capability: ColorVariableCapability | null;
  children: ReactNode;
}

export function ColorVariableCapabilityProvider({
  capability,
  children,
}: ColorVariableCapabilityProviderProps) {
  return (
    <ColorVariableCapabilityContext.Provider value={capability}>
      {children}
    </ColorVariableCapabilityContext.Provider>
  );
}

/** A missing capability is a supported state: color controls remain usable without variables. */
export function useOptionalColorVariableCapability() {
  return useContext(ColorVariableCapabilityContext);
}

/**
 * Subscribe to the capability snapshot without coupling a color control to a
 * store implementation. The empty snapshot is referentially stable so an
 * unsupported runtime remains safe with useSyncExternalStore.
 */
export function useColorVariableCapabilitySnapshot(
  capability: ColorVariableCapability | null,
): readonly EditorColorVariable[] {
  const subscribe = useCallback((listener: () => void) => {
    if (!capability?.capabilities.subscribe) return () => undefined;
    return capability.subscribe(listener);
  }, [capability]);
  const getSnapshot = useCallback(() => {
    if (!capability?.capabilities.list) return EMPTY_COLOR_VARIABLES;
    return capability.list();
  }, [capability]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
