import { stripImportantPriority } from './style-utils';

const SIMPLE_LENGTH = /^(-?(?:\d+|\d*\.\d+))(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc)?$/i;

function splitCssComponents(value: string) {
  const components: string[] = [];
  let current = '';
  let depth = 0;
  for (const character of value.trim()) {
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (current) components.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current) components.push(current);
  return components;
}

function expandQuad(value: string) {
  const values = splitCssComponents(value);
  if (!values.length || values.length > 4) return null;
  if (values.length === 1) return [values[0], values[0], values[0], values[0]];
  if (values.length === 2) return [values[0], values[1], values[0], values[1]];
  if (values.length === 3) return [values[0], values[1], values[2], values[1]];
  return values;
}

/**
 * Finds the authored value that best represents a canvas spacing gesture.
 * Computed styles are pixel-normalized, while this value still carries the
 * author's unit and is therefore used only as a conversion hint.
 */
export function authoredSpatialValue(
  declarations: Record<string, string>,
  property: string,
) {
  const direct = stripImportantPriority(declarations[property] || '').trim();
  if (direct) {
    const components = splitCssComponents(direct);
    return components.length > 1 && components.every(component => SIMPLE_LENGTH.test(component))
      ? components[0]
      : direct;
  }

  if (property === 'row-gap' || property === 'column-gap') {
    const legacyProperty = property === 'row-gap' ? 'grid-row-gap' : 'grid-column-gap';
    const legacy = stripImportantPriority(declarations[legacyProperty] || '').trim();
    if (legacy) return legacy;
    const gap = splitCssComponents(stripImportantPriority(declarations.gap || ''));
    if (!gap.length || gap.length > 2) return '';
    return property === 'row-gap' ? gap[0] : gap[1] || gap[0];
  }

  const paddingSide = {
    'padding-top': 0,
    'padding-right': 1,
    'padding-bottom': 2,
    'padding-left': 3,
    'padding-block': 0,
    'padding-inline': 1,
  }[property];
  if (paddingSide !== undefined) {
    const longhand = {
      'padding-block': 'padding-top',
      'padding-inline': 'padding-left',
    }[property];
    const longhandValue = longhand
      ? stripImportantPriority(declarations[longhand] || '').trim()
      : '';
    if (longhandValue) return longhandValue;
    const padding = expandQuad(stripImportantPriority(declarations.padding || ''));
    return padding?.[paddingSide] || '';
  }

  return '';
}

function formatLength(value: number, unit: string, allowNegative = false) {
  const normalized = allowNegative ? value : Math.max(0, value);
  const rounded = Math.round(normalized * 10_000) / 10_000;
  return `${Object.is(rounded, -0) ? 0 : rounded}${unit}`;
}

/**
 * Converts a computed-pixel canvas result back to the unit authored in the
 * active rule/inline declaration whenever the original value gives us a safe
 * conversion ratio. Complex expressions intentionally fall back to pixels.
 */
export function preserveSpatialUnit(
  authoredValue: string,
  startPx: number | undefined,
  valuePx: number | undefined,
  fallbackValue: string,
  options: { allowNegative?: boolean } = {},
) {
  if (
    typeof startPx !== 'number'
    || typeof valuePx !== 'number'
    || !Number.isFinite(startPx)
    || !Number.isFinite(valuePx)
  ) return fallbackValue;
  const match = stripImportantPriority(authoredValue).trim().match(SIMPLE_LENGTH);
  if (!match) return fallbackValue;

  const authoredNumber = Number(match[1]);
  const unit = (match[2] || '').toLowerCase();
  if (!Number.isFinite(authoredNumber) || !unit || unit === 'px') {
    return formatLength(valuePx, 'px', options.allowNegative);
  }

  if (Math.abs(authoredNumber) > 0.000001 && Math.abs(startPx) > 0.000001) {
    return formatLength(
      authoredNumber * (valuePx / startPx),
      unit,
      options.allowNegative,
    );
  }

  // Absolute CSS units have stable browser conversion factors even when the
  // authored starting value is zero; relative units cannot be inferred safely.
  const pixelsPerUnit: Record<string, number> = {
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    pt: 96 / 72,
    pc: 16,
  };
  return pixelsPerUnit[unit]
    ? formatLength(valuePx / pixelsPerUnit[unit], unit, options.allowNegative)
    : fallbackValue;
}
