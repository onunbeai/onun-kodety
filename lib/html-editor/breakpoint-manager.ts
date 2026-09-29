import {
  MIN_BREAKPOINT_WIDTH,
  normalizeBreakpointWidth,
  type Breakpoint,
  type BreakpointMode,
} from './css-patcher';

export interface BreakpointDraft {
  intent: 'create' | 'edit';
  originalId: string | null;
  label: string;
  mode: BreakpointMode;
  width: string;
}

export type BreakpointDraftCommit =
  | { ok: true; changed: boolean; breakpoint: Breakpoint; breakpoints: Breakpoint[] }
  | { ok: false; error: string };

function uniqueBreakpointId(label: string, existing: readonly Breakpoint[]) {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bp';
  let id = base;
  let suffix = 2;
  while (existing.some(breakpoint => breakpoint.id === id)) id = `${base}-${suffix++}`;
  return id;
}

function availableBreakpointWidth(breakpoints: readonly Breakpoint[]) {
  const usedWidths = new Set(breakpoints.map(item => item.width));
  for (let width = 640; width >= MIN_BREAKPOINT_WIDTH; width -= 40) {
    if (!usedWidths.has(width)) return width;
  }
  let width = 680;
  while (usedWidths.has(width)) width += 40;
  return width;
}

export function createBreakpointDraft(breakpoints: readonly Breakpoint[]): BreakpointDraft {
  return {
    intent: 'create',
    originalId: null,
    label: `Breakpoint ${breakpoints.length + 1}`,
    mode: 'max-width',
    width: String(availableBreakpointWidth(breakpoints)),
  };
}

export function editBreakpointDraft(breakpoint: Breakpoint): BreakpointDraft {
  return {
    intent: 'edit',
    originalId: breakpoint.id,
    label: breakpoint.label,
    mode: breakpoint.mode,
    width: String(breakpoint.width),
  };
}

export function commitBreakpointDraft(
  draft: BreakpointDraft,
  breakpoints: Breakpoint[],
): BreakpointDraftCommit {
  const current = draft.intent === 'edit'
    ? breakpoints.find(breakpoint => breakpoint.id === draft.originalId)
    : undefined;
  if (draft.intent === 'edit' && !current) {
    return { ok: false, error: 'Este breakpoint não existe mais.' };
  }

  const widthText = draft.width.trim();
  const parsedWidth = Number(widthText);
  if (!widthText || !Number.isFinite(parsedWidth) || parsedWidth < MIN_BREAKPOINT_WIDTH) {
    return {
      ok: false,
      error: `A largura deve ser um número igual ou maior que ${MIN_BREAKPOINT_WIDTH}px.`,
    };
  }

  const width = normalizeBreakpointWidth(parsedWidth, current?.width || MIN_BREAKPOINT_WIDTH);
  const conflict = breakpoints.find(breakpoint => (
    breakpoint.id !== draft.originalId
    && breakpoint.mode === draft.mode
    && breakpoint.width === width
  ));
  if (conflict) {
    return {
      ok: false,
      error: `“${conflict.label}” já usa ${draft.mode === 'max-width' ? '≤' : '≥'} ${width}px.`,
    };
  }

  const fallbackLabel = current?.label || `Breakpoint ${breakpoints.length + 1}`;
  const label = draft.label.trim() || fallbackLabel;
  const breakpoint: Breakpoint = {
    id: current?.id || uniqueBreakpointId(label, breakpoints),
    label,
    mode: draft.mode,
    width,
  };
  const changed = !current
    || current.label !== breakpoint.label
    || current.mode !== breakpoint.mode
    || current.width !== breakpoint.width;
  const next = current
    ? changed
      ? breakpoints.map(item => (item.id === current.id ? breakpoint : item))
      : breakpoints
    : [...breakpoints.map(item => ({ ...item })), breakpoint];

  return { ok: true, changed, breakpoint, breakpoints: next };
}

export function resolveBreakpointSelection(
  requestedId: string | null | undefined,
  breakpoints: readonly Breakpoint[],
): string {
  if (requestedId === 'base') return 'base';
  return requestedId && breakpoints.some(breakpoint => breakpoint.id === requestedId) ? requestedId : 'base';
}
