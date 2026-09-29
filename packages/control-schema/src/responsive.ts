import type { ResponsiveValue } from './types';

export interface BreakpointDescriptor { id: string; width: number; parentId?: string }

function mergeValue<T>(base: T, override: Partial<T> | T): T {
  if (base && override && typeof base === 'object' && typeof override === 'object' && !Array.isArray(base) && !Array.isArray(override)) {
    return { ...base, ...override };
  }
  return override as T;
}

export function breakpointLineage(activeId: string, breakpoints: BreakpointDescriptor[]): string[] {
  const byId = new Map(breakpoints.map(item => [item.id, item]));
  const seen = new Set<string>();
  const result: string[] = [];
  let current = byId.get(activeId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

export function resolveResponsiveValue<T>(value: ResponsiveValue<T> | T, activeBreakpoint: string, breakpoints: BreakpointDescriptor[] = []): T {
  if (!value || typeof value !== 'object' || !('base' in value)) return value as T;
  const responsive = value as ResponsiveValue<T>;
  const lineage = breakpoints.length ? breakpointLineage(activeBreakpoint, breakpoints) : [activeBreakpoint];
  return lineage.reduce((resolved, id) => {
    const override = responsive.overrides?.[id];
    return override === undefined ? resolved : mergeValue(resolved, override);
  }, responsive.base);
}

export function setResponsiveOverride<T>(value: ResponsiveValue<T>, breakpointId: string, override: Partial<T> | T | undefined): ResponsiveValue<T> {
  const overrides = { ...value.overrides };
  if (override === undefined) delete overrides[breakpointId];
  else overrides[breakpointId] = override;
  return { base: value.base, ...(Object.keys(overrides).length ? { overrides } : {}) };
}
