import type { Breakpoint, Layer, UIState } from '@/types';

export const HTML_BACKGROUND_KEY = 'html-css-background-image';

export function buildBgImgVarName(
  _breakpoint?: Breakpoint,
  _state?: UIState,
) {
  return HTML_BACKGROUND_KEY;
}

export function buildStyledUpdate(
  _layer: Layer,
  updates: Partial<Layer>,
) {
  return updates;
}
