export const LETTER_SPACING_UNITS = ['px', 'em', 'rem', '%'] as const;

export type LetterSpacingUnit = (typeof LETTER_SPACING_UNITS)[number];

const COMPLETE_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const NUMBER_WITH_OPTIONAL_UNIT = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|em|rem|%)?$/i;

export interface ParsedLetterSpacing {
  numeric: string;
  number: number | null;
  unit: LetterSpacingUnit;
}

/**
 * Split a persisted letter-spacing value into the editable draft and its unit.
 * CSS expressions and keywords stay untouched so the input can round-trip
 * normal, var(), calc() and clamp() without trying to format them as numbers.
 */
export function parseLetterSpacingValue(
  value: string,
  defaultUnit: LetterSpacingUnit = 'em',
): ParsedLetterSpacing {
  const trimmed = value.trim();
  const match = trimmed.match(NUMBER_WITH_OPTIONAL_UNIT);
  if (!match) return { numeric: trimmed, number: null, unit: defaultUnit };

  const unit = (match[2]?.toLowerCase() || defaultUnit) as LetterSpacingUnit;
  const number = Number.parseFloat(match[1]);
  return {
    numeric: match[1],
    number: Number.isFinite(number) ? number : null,
    unit,
  };
}

/**
 * Persist a numeric draft with the separately selected unit. Incomplete and
 * advanced CSS drafts are returned verbatim until the user finishes typing.
 */
export function serializeLetterSpacingDraft(
  draft: string,
  unit: LetterSpacingUnit,
): string {
  const trimmed = draft.trim();
  if (!trimmed) return '';
  if (!COMPLETE_NUMBER.test(trimmed)) return draft;

  const number = Number.parseFloat(trimmed);
  if (!Number.isFinite(number)) return draft;
  return number === 0 ? '0' : `${trimmed}${unit}`;
}

function fontSizeInPixels(value: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(NUMBER_WITH_OPTIONAL_UNIT);
  if (!match) return 16;

  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return 16;
  const unit = match[2]?.toLowerCase() || 'px';
  if (unit === 'em' || unit === 'rem') return number * 16;
  if (unit === '%') return number * 0.16;
  return number;
}

function roundMeasurement(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** Change units without changing the approximate rendered spacing. */
export function convertLetterSpacingUnit(
  value: string,
  nextUnit: LetterSpacingUnit,
  currentFontSize: string,
): string {
  const parsed = parseLetterSpacingValue(value);
  if (parsed.number === null) return value;
  if (parsed.number === 0) return '0';

  const fontPixels = Math.max(0.001, fontSizeInPixels(currentFontSize));
  const pixels = parsed.unit === 'px'
    ? parsed.number
    : parsed.unit === 'rem'
      ? parsed.number * 16
      : parsed.unit === '%'
        ? (parsed.number / 100) * fontPixels
        : parsed.number * fontPixels;
  const converted = nextUnit === 'px'
    ? pixels
    : nextUnit === 'rem'
      ? pixels / 16
      : nextUnit === '%'
        ? (pixels / fontPixels) * 100
        : pixels / fontPixels;

  return `${roundMeasurement(converted)}${nextUnit}`;
}
