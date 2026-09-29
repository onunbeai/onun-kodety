/**
 * Converts the legacy design-control tokens into browser-valid CSS values.
 *
 * The shared controls still expose a few Tailwind/Kodety-shaped values. Keeping
 * their translation here prevents those implementation tokens from leaking into
 * the HTML editor's authored stylesheet and makes the conversion testable.
 */

/** Keep CSS token boundaries, math operators and quoted text intact. */
export function normalizeCssControlInput(value: string) {
  // Retain the controls' convenient `12 px` input without joining separate
  // CSS tokens in `calc(1rem + 2px)`, `rgb(1 2 3)` or `10px 20px`.
  return value.trim().replace(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([a-z%]+)$/i, '$1$2');
}

const POSITION_TOKEN_TO_CSS: Record<string, string> = {
  'left-top': 'left top',
  'right-top': 'right top',
  'left-bottom': 'left bottom',
  'right-bottom': 'right bottom',
};

const ORIGIN_TOKEN_TO_CSS: Record<string, string> = {
  'top-left': 'top left',
  'top-right': 'top right',
  'bottom-left': 'bottom left',
  'bottom-right': 'bottom right',
};

const TRANSITION_TOKEN_TO_CSS: Record<string, string> = {
  default: 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter',
  colors: 'color, background-color, border-color, text-decoration-color, fill, stroke',
  shadow: 'box-shadow',
};

const EASING_TOKEN_TO_CSS: Record<string, string> = {
  in: 'ease-in',
  out: 'ease-out',
  'in-out': 'ease-in-out',
};

const FONT_TOKEN_TO_CSS: Record<string, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

export const HTML_BORDER_RADIUS_DESIGN_PROPERTIES = [
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
] as const;

export const HTML_GAP_DESIGN_PROPERTIES = [
  'gap',
  'columnGap',
  'rowGap',
] as const;

/** Keeps a two-axis gap visibly unlinked even when both values are equal. */
export function resolveHtmlGapMode(
  authoredValues?: Record<string, string>,
  effectiveValues?: Record<string, string>,
): 'all' | 'individual' | undefined {
  if (!authoredValues) return undefined;
  let shorthandIndex = -1;
  let individualIndex = -1;
  let shorthandValue = '';
  Object.entries(authoredValues).forEach(([rawProperty, rawValue], index) => {
    const value = String(rawValue || '').trim();
    if (!value) return;
    const property = rawProperty.trim().toLowerCase();
    if (property === 'gap') {
      shorthandIndex = index;
      shorthandValue = value;
    }
    if (property === 'column-gap' || property === 'row-gap') individualIndex = index;
  });
  if (shorthandIndex < 0 && individualIndex < 0) return undefined;
  if (individualIndex > shorthandIndex) return 'individual';
  if (/^(?:var\(|initial$|inherit$|unset$|revert(?:-layer)?$)/i.test(shorthandValue)) {
    shorthandValue = effectiveValues?.gap || shorthandValue;
  }
  return splitCssFunctions(shorthandValue).length > 1 ? 'individual' : 'all';
}

/**
 * Determines the radius editor mode from declarations authored in the active
 * scope, ignoring computed shorthand fallbacks supplied by the browser.
 */
export function resolveHtmlBorderRadiusMode(
  authoredValues?: Record<string, string>,
  effectiveValues?: Record<string, string>,
): 'all' | 'individual' | undefined {
  if (!authoredValues) return undefined;
  let shorthandIndex = -1;
  let individualIndex = -1;
  Object.entries(authoredValues).forEach(([rawProperty, rawValue], index) => {
    if (!String(rawValue || '').trim()) return;
    const property = rawProperty.trim().toLowerCase();
    if (property === 'border-radius') shorthandIndex = index;
    if ([
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius',
    ].includes(property)) individualIndex = index;
  });
  if (shorthandIndex < 0 && individualIndex < 0) return undefined;
  let shorthandValue = String(authoredValues['border-radius'] || '');
  if (/^(?:var\(|initial$|inherit$|unset$|revert(?:-layer)?$)/i.test(shorthandValue)) {
    shorthandValue = effectiveValues?.['border-radius'] || shorthandValue;
  }
  if (
    shorthandIndex >= individualIndex
    && splitCssFunctions(shorthandValue).filter(token => token !== '/').length > 1
  ) return 'individual';
  return individualIndex > shorthandIndex ? 'individual' : 'all';
}

/**
 * The shared border control represents "link all corners" as one synthetic
 * design update containing a shorthand plus four cleared longhands. HTML/CSS
 * cannot persist those five changes one-by-one: an authoritative longhand
 * removal also conflicts with (and removes) the shorthand written immediately
 * before it.
 *
 * Treat the explicit mode marker as a command boundary and collapse that
 * transition to one CSS shorthand mutation. The source patcher already makes
 * a shorthand authoritative over all four corners, so this is both atomic and
 * sufficient for inline styles, stylesheet rules, locale overrides and
 * component variants.
 */
export function resolveAtomicHtmlBorderRadiusChange(
  nextBorders: Record<string, unknown>,
  currentBorders?: Record<string, unknown>,
) {
  if (currentBorders && nextBorders.borderRadiusMode === currentBorders.borderRadiusMode) return null;
  if (
    currentBorders
    && ![
      'borderRadiusMode',
      ...HTML_BORDER_RADIUS_DESIGN_PROPERTIES,
    ].some(property => nextBorders[property] !== currentBorders[property])
  ) return null;
  const mode = nextBorders.borderRadiusMode;
  if (mode !== 'all' && mode !== 'individual') return null;
  const fallback = String(nextBorders.borderRadius ?? '').trim();
  const values = mode === 'all'
    ? [fallback]
    : [
        nextBorders.borderTopLeftRadius,
        nextBorders.borderTopRightRadius,
        nextBorders.borderBottomRightRadius,
        nextBorders.borderBottomLeftRadius,
      ].map(value => String(value ?? fallback).trim());
  if (!values.length || values.some(value => !value)) return null;
  return {
    property: 'border-radius',
    values,
    consumedDesignProperties: HTML_BORDER_RADIUS_DESIGN_PROPERTIES,
  } as const;
}

/** Collapses a Gap link/unlink command to one browser-native shorthand write. */
export function resolveAtomicHtmlGapChange(
  nextLayout: Record<string, unknown>,
  currentLayout?: Record<string, unknown>,
) {
  if (currentLayout && nextLayout.gapMode === currentLayout.gapMode) return null;
  if (
    currentLayout
    && ![
      'gapMode',
      ...HTML_GAP_DESIGN_PROPERTIES,
    ].some(property => nextLayout[property] !== currentLayout[property])
  ) return null;
  const mode = nextLayout.gapMode;
  if (mode !== 'all' && mode !== 'individual') return null;
  const fallback = String(nextLayout.gap ?? '').trim();
  const values = mode === 'all'
    ? [fallback]
    : [nextLayout.rowGap, nextLayout.columnGap]
        .map(value => String(value ?? fallback).trim());
  if (!values.length || values.some(value => !value)) return null;
  return {
    property: 'gap',
    values,
    consumedDesignProperties: HTML_GAP_DESIGN_PROPERTIES,
  } as const;
}

function reverseLookup(map: Record<string, string>, value: string) {
  return Object.entries(map).find(([, cssValue]) => cssValue === value)?.[0] || value;
}

export function cssPositionToControl(value: string) {
  return reverseLookup(POSITION_TOKEN_TO_CSS, value);
}

export function cssOriginToControl(value: string) {
  return reverseLookup(ORIGIN_TOKEN_TO_CSS, value);
}

export function cssTransitionPropertyToControl(value: string) {
  return reverseLookup(TRANSITION_TOKEN_TO_CSS, value);
}

export function cssEasingToControl(value: string) {
  return reverseLookup(EASING_TOKEN_TO_CSS, value);
}

export function cssFontFamilyToControl(value: string) {
  return reverseLookup(FONT_TOKEN_TO_CSS, value);
}

export function controlFontFamilyToCss(value: string) {
  return FONT_TOKEN_TO_CSS[value] || value;
}

/**
 * Splits a CSS function list at top-level whitespace while respecting nested
 * functions and quoted strings (for example drop-shadow(rgb(...))).
 */
export function splitCssFunctions(value: string) {
  const functions: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      current += character;
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (current.trim()) functions.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) functions.push(current.trim());
  return functions;
}

/** Replaces only named CSS functions, preserving every unrelated effect. */
export function replaceCssFunctions(
  source: string,
  names: string | string[],
  replacement: string,
) {
  const targetNames = new Set((Array.isArray(names) ? names : [names]).map(name => name.toLowerCase()));
  const standaloneKeywords = new Set(['none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer']);
  const kept = splitCssFunctions(source).filter((part) => {
    if (standaloneKeywords.has(part.toLowerCase())) return false;
    const functionName = part.match(/^([\w-]+)\s*\(/)?.[1]?.toLowerCase();
    return !functionName || !targetNames.has(functionName);
  });
  if (replacement.trim()) kept.push(replacement.trim());
  return kept.join(' ');
}

function isCenteringHalf(value: string) {
  return /^[+-]?50(?:\.0+)?%$/i.test(value.trim());
}

function splitCssFunctionArguments(value: string) {
  const commaSeparated: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      current += character;
      if (character === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === ',' && depth === 0) {
      commaSeparated.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) commaSeparated.push(current.trim());
  return commaSeparated.length > 1 ? commaSeparated : splitCssFunctions(value);
}

/**
 * Removes only the ±50% translation commonly used to make an element's
 * center act as its positioning anchor. Explicit CSS insets are edge based:
 * left:0/bottom:0 must attach the element's left/bottom edges, while unrelated
 * rotation, scale, skew and authored pixel translations remain untouched.
 */
export function releaseCenteredPositionAnchor(
  translate: string,
  transform: string,
  axes: { horizontal: boolean; vertical: boolean },
) {
  const translateParts = splitCssFunctions(translate.trim());
  let nextTranslate = translate;
  if (translateParts.length && !['none', 'initial', 'inherit', 'unset'].includes(translate.trim().toLowerCase())) {
    const parts = [...translateParts];
    let changed = false;
    if (axes.horizontal && isCenteringHalf(parts[0] || '')) {
      parts[0] = '0';
      changed = true;
    }
    if (axes.vertical && isCenteringHalf(parts[1] || '')) {
      parts[1] = '0';
      changed = true;
    }
    if (changed) nextTranslate = parts.join(' ');
  }

  const transformParts = splitCssFunctions(transform);
  let transformChanged = false;
  const nextTransformParts = transformParts.flatMap((part) => {
    const match = part.match(/^([\w-]+)\s*\(([\s\S]*)\)$/);
    if (!match) return [part];
    const name = match[1].toLowerCase();
    const args = splitCssFunctionArguments(match[2]);
    if (name === 'translatex' && axes.horizontal && isCenteringHalf(args[0] || '')) {
      transformChanged = true;
      return [];
    }
    if (name === 'translatey' && axes.vertical && isCenteringHalf(args[0] || '')) {
      transformChanged = true;
      return [];
    }
    if (!['translate', 'translate3d'].includes(name)) return [part];
    const nextArgs = [...args];
    let changed = false;
    if (axes.horizontal && isCenteringHalf(nextArgs[0] || '')) {
      nextArgs[0] = '0';
      changed = true;
    }
    if (axes.vertical && isCenteringHalf(nextArgs[1] || '')) {
      nextArgs[1] = '0';
      changed = true;
    }
    if (!changed) return [part];
    transformChanged = true;
    const separator = match[2].includes(',') ? ', ' : ' ';
    const planarZero = (nextArgs[0] || '0') === '0' && (nextArgs[1] || '0') === '0';
    const zIsZero = name !== 'translate3d' || !nextArgs[2] || /^0(?:[a-z%]+)?$/i.test(nextArgs[2]);
    return planarZero && zIsZero ? [] : [`${match[1]}(${nextArgs.join(separator)})`];
  });

  return {
    translate: nextTranslate,
    transform: transformChanged ? nextTransformParts.join(' ') : transform,
    translateChanged: nextTranslate !== translate,
    transformChanged,
  };
}

export function normalizeVisualCssValue(category: string, property: string, value: string) {
  if (category === 'backgrounds' && property === 'backgroundPosition') {
    return POSITION_TOKEN_TO_CSS[value] || value;
  }
  if (category === 'backgrounds' && property === 'backgroundRepeat') {
    return ({ 'repeat-round': 'round', 'repeat-space': 'space' } as Record<string, string>)[value] || value;
  }
  if (category === 'sizing' && property === 'objectPosition') {
    return POSITION_TOKEN_TO_CSS[value] || value;
  }
  if (category === 'sizing' && ['gridColumnSpan', 'gridRowSpan'].includes(property)) {
    if (value === 'full') return '1 / -1';
    return /^\d+$/.test(value) ? `span ${value}` : value;
  }
  if (category === 'typography' && property === 'textTransform' && value === 'normal-case') {
    return 'none';
  }
  if (category === 'typography' && property === 'fontFamily') {
    return controlFontFamilyToCss(value);
  }
  if (category === 'transforms' && property === 'transformOrigin') {
    return ORIGIN_TOKEN_TO_CSS[value] || value;
  }
  if (category === 'transitions' && property === 'transitionProperty') {
    return TRANSITION_TOKEN_TO_CSS[value] || value;
  }
  if (category === 'transitions' && property === 'easing') {
    return EASING_TOKEN_TO_CSS[value] || value;
  }
  return value;
}
