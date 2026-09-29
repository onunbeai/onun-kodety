import { useCallback, useMemo, useState } from 'react';

type DesignCategory = 'spacing' | 'layout' | 'borders' | 'typography' | 'sizing' | 'backgrounds' | 'effects' | 'positioning';

type ModeToggleConfig = {
  category: DesignCategory;
  unifiedProperty: string;
  individualProperties: string[];
  modeProperty?: string; // Property name to store the mode preference (e.g., 'marginMode', 'paddingMode')
  updateDesignProperty: (category: DesignCategory, property: string, value: string | null) => void;
  updateDesignProperties: (updates: { category: DesignCategory; property: string; value: string | null }[]) => void;
  getCurrentValue: (property: string) => string;
  /** Optional function to read stored mode directly from design object (bypasses class inheritance) */
  getStoredMode?: () => 'all' | 'individual' | null;
  /** Stable identity for source adapters whose mode marker is not persisted. */
  scopeKey?: string;
};

/**
 * Hook to manage unified/individual mode toggle for design properties
 * Handles value transfer between modes and prevents empty inputs
 * 
 * Mode is derived from:
 * 1. Stored mode preference (modeProperty) - highest priority
 * 2. Auto-detection based on current values - fallback
 */
export function useModeToggle(config: ModeToggleConfig) {
  const {
    category,
    unifiedProperty,
    individualProperties,
    modeProperty,
    updateDesignProperty,
    updateDesignProperties,
    getCurrentValue,
    getStoredMode,
    scopeKey,
  } = config;

  const [modeOverride, setModeOverride] = useState<{
    scopeKey: string;
    mode: 'all' | 'individual';
  } | null>(null);
  const scopedModeOverride = scopeKey && modeOverride?.scopeKey === scopeKey
    ? modeOverride.mode
    : null;

  // Derive mode during render (no state or effects needed)
  const mode = useMemo((): 'all' | 'individual' => {
    // Keep an explicit source-adapter choice while its canonical CSS
    // roundtrip is still in flight. The scope prevents cross-selection leaks.
    if (scopedModeOverride) return scopedModeOverride;

    // Check for stored mode preference first (persisted in layer design)
    if (modeProperty) {
      // Use getStoredMode if provided (reads directly from design object)
      // Otherwise fall back to getCurrentValue (which may not work for non-class properties)
      const storedMode = getStoredMode ? getStoredMode() : getCurrentValue(modeProperty) as 'all' | 'individual' | '';
      if (storedMode === 'all' || storedMode === 'individual') {
        return storedMode;
      }
    }

    // Auto-detect based on current values
    const unifiedValue = getCurrentValue(unifiedProperty);
    const individualValues = individualProperties.map(prop => getCurrentValue(prop)).filter(Boolean);

    // If individual properties are set (and no unified), show individual mode
    if (individualValues.length > 0 && !unifiedValue) {
      return 'individual';
    }

    // Default to unified mode
    return 'all';
  }, [unifiedProperty, individualProperties, modeProperty, getCurrentValue, getStoredMode, scopedModeOverride]);

  // Helper function to find most common value
  const findMostCommonValue = useCallback((values: string[]): string | null => {
    if (values.length === 0) return null;
    const frequency: Record<string, number> = {};
    values.forEach(v => frequency[v] = (frequency[v] || 0) + 1);
    return Object.entries(frequency).sort((a, b) => b[1] - a[1])[0][0];
  }, []);

  // Handle mode toggle
  const handleToggle = useCallback(() => {
    const newMode = mode === 'all' ? 'individual' : 'all';
    if (scopeKey) setModeOverride({ scopeKey, mode: newMode });
    
    // Update properties
    if (newMode === 'all') {
      // Individual → Unified: use most common value
      const individualValues = individualProperties
        .map(prop => getCurrentValue(prop))
        .filter(Boolean);
      
      const mostCommon = findMostCommonValue(individualValues);
      const updates = [];
      
      if (mostCommon) {
        // Set unified property
        updates.push({
          category,
          property: unifiedProperty,
          value: mostCommon,
        });
        // Clear individual properties
        updates.push(...individualProperties.map(prop => ({
          category,
          property: prop,
          value: null,
        })));
      }
      
      // Save mode preference if modeProperty is provided
      if (modeProperty) {
        updates.push({
          category,
          property: modeProperty,
          value: 'all',
        });
      }
      
      if (updates.length > 0) {
        updateDesignProperties(updates);
      }
    } else {
      // Unified → Individual: populate all with unified value (or allow empty start)
      const unifiedValue = getCurrentValue(unifiedProperty);
      const updates = [];
      
      if (unifiedValue) {
        // Set individual properties
        updates.push(...individualProperties.map(prop => ({
          category,
          property: prop,
          value: unifiedValue,
        })));
        // Clear unified property
        updates.push({
          category,
          property: unifiedProperty,
          value: null,
        });
      }
      
      // Save mode preference if modeProperty is provided
      if (modeProperty) {
        updates.push({
          category,
          property: modeProperty,
          value: 'individual',
        });
      }
      
      if (updates.length > 0) {
        updateDesignProperties(updates);
      } else if (modeProperty) {
        // No value updates but save the mode preference
        updateDesignProperty(category, modeProperty, 'individual');
      }
    }
  }, [
    mode,
    category,
    unifiedProperty,
    individualProperties,
    modeProperty,
    updateDesignProperty,
    updateDesignProperties,
    getCurrentValue,
    findMostCommonValue,
    scopeKey,
  ]);

  const setMode = useCallback((newMode: 'all' | 'individual') => {
    if (scopeKey) setModeOverride({ scopeKey, mode: newMode });
  }, [scopeKey]);

  return {
    mode,
    setMode,
    handleToggle,
  };
}
