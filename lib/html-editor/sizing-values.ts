export type SizingValueMode = 'fixed' | 'relative' | 'fit' | 'fill' | 'screen';

const CSS_FILL_VALUES = new Set([
  'stretch',
  'fill-available',
  '-webkit-fill-available',
  '-moz-available',
]);

const SIMPLE_MEASUREMENT_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|%|rem|em|vw|vh|dvw|dvh|svw|svh|lvw|lvh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/i;
const VIEWPORT_MEASUREMENT_PATTERN = /(?:^|[^a-z])(dvw|dvh|svw|svh|lvw|lvh|vw|vh|vmin|vmax)\b/i;

function unwrapSizingValue(value: string) {
  const withoutPriority = value
    .replace(/\s*!\s*important\b/gi, '')
    .trim();
  return withoutPriority.startsWith('[') && withoutPriority.endsWith(']')
    ? withoutPriority.slice(1, -1).trim()
    : withoutPriority;
}

function isWidthProperty(property: string) {
  return property.toLowerCase().includes('width');
}

function screenValueForProperty(property: string) {
  return isWidthProperty(property) ? '100vw' : '100svh';
}

/**
 * Convert the semantic tokens used by SizingControls into authored CSS.
 *
 * Keep this conversion lossless: the HTML editor reconstructs its controls
 * from the authored declaration after every source/canvas refresh.
 */
export function sizingControlValueToCss(property: string, value: string) {
  const normalized = unwrapSizingValue(value);
  const keyword = normalized.toLowerCase();
  if (keyword === 'fit') return 'fit-content';
  if (keyword === 'fill') return 'stretch';
  if (keyword === 'full') return '100%';
  if (keyword === 'screen') return screenValueForProperty(property);
  return normalized;
}

/**
 * Reconstruct the semantic control token from authored (or computed) CSS.
 * Vendor spellings of fill are accepted so imported projects remain editable.
 */
export function cssSizingValueToControl(value: string) {
  const normalized = unwrapSizingValue(value);
  const keyword = normalized.toLowerCase();
  if (keyword === 'fit-content') return 'fit';
  if (CSS_FILL_VALUES.has(keyword)) return 'fill';
  return normalized;
}

/**
 * Determine which sizing UX mode owns a value. This deliberately understands
 * both control tokens and their CSS equivalents so a source reload does not
 * turn Fit/Fill back into Fixed.
 */
export function sizingValueMode(property: string, value: string): SizingValueMode {
  const normalized = cssSizingValueToControl(value);
  const keyword = normalized.toLowerCase();
  if (keyword === 'fit') return 'fit';
  if (keyword === 'fill') return 'fill';
  if (/%$/.test(normalized)) return 'relative';
  // Viewport is a unit family, not a synonym for exactly 100vw/100vh. A
  // section authored as 90vh must remain 90vh in the inspector instead of
  // being presented as a fixed, computed pixel height.
  if (keyword === 'screen' || VIEWPORT_MEASUREMENT_PATTERN.test(normalized)) return 'screen';
  return 'fixed';
}

/**
 * Preserve the selected mode while the user edits its value.
 *
 * In particular, a number typed while Relative is selected remains a
 * percentage. The old behavior sent the bare number through the generic
 * measurement formatter, which correctly interpreted it as px but silently
 * changed the user's selected sizing mode.
 */
export function normalizeSizingInputForMode(
  property: string,
  mode: SizingValueMode,
  value: string,
) {
  const normalized = unwrapSizingValue(value).replace(/\s+/g, '');
  if (mode === 'fit') return 'fit';
  if (mode === 'fill') return 'fill';
  if (mode === 'screen') {
    if (VIEWPORT_MEASUREMENT_PATTERN.test(normalized)) return normalized;
    return screenValueForProperty(property);
  }
  if (mode !== 'relative' || !normalized) return normalized;

  // A percentage suffix is owned by the mode, not by the caret. Remove every
  // stray copy defensively so even a draft produced by an older controlled
  // input (`8%0%`) is repaired to `80%`.
  const withoutPercent = normalized.replace(/%+/g, '');
  const scalar = withoutPercent.match(SIMPLE_MEASUREMENT_PATTERN);
  return `${scalar?.[1] ?? withoutPercent}%`;
}

export interface SizingEditValue {
  /**
   * The text the input owns while focused. Keeping the unit outside this
   * string prevents a controlled input from moving the caret in front of an
   * auto-appended suffix (the old `8%0%` bug).
   */
  draft: string;
  /** Unit retained independently and rendered as a non-editable suffix. */
  unit: string;
}

/**
 * Split a simple measurement into an editable scalar and a retained unit.
 * Complex CSS expressions remain intact because their internal syntax must
 * never be rewritten by the compact numeric editor.
 */
export function sizingValueForEditing(
  property: string,
  mode: SizingValueMode,
  value: string,
): SizingEditValue {
  const normalized = normalizeSizingInputForMode(property, mode, value);
  const match = normalized.match(SIMPLE_MEASUREMENT_PATTERN);
  if (!match) return { draft: normalized, unit: '' };
  return {
    draft: match[1],
    unit: mode === 'relative' ? '%' : (match[2] || ''),
  };
}

/**
 * Recombine the focused draft with the unit captured on focus. An explicitly
 * pasted unit wins; otherwise the original unit is preserved through every
 * keystroke and the final blur commit.
 */
export function commitSizingEditValue(
  property: string,
  mode: SizingValueMode,
  draft: string,
  retainedUnit: string,
) {
  const normalizedDraft = unwrapSizingValue(draft).replace(/\s+/g, '');
  if (mode === 'screen') {
    if (!normalizedDraft) return '';
    const explicit = normalizedDraft.match(SIMPLE_MEASUREMENT_PATTERN);
    if (!explicit) return normalizedDraft;
    if (explicit[2]) return normalizedDraft;
    const viewportUnit = VIEWPORT_MEASUREMENT_PATTERN.test(retainedUnit)
      ? retainedUnit
      : (isWidthProperty(property) ? 'vw' : 'svh');
    return `${explicit[1]}${viewportUnit}`;
  }
  if (mode !== 'fixed') {
    return normalizeSizingInputForMode(property, mode, normalizedDraft);
  }
  if (!normalizedDraft) return '';
  const explicit = normalizedDraft.match(SIMPLE_MEASUREMENT_PATTERN);
  if (!explicit) return normalizedDraft;
  if (explicit[2] || !retainedUnit) return normalizedDraft;
  return `${explicit[1]}${retainedUnit}`;
}
