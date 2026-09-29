const CSS_LENGTH_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z]+|%)?$/i;
const CSS_LENGTH_FUNCTION_PATTERN = /^(?:calc|min|max|clamp|var|env)\(.+\)$/i;
const CSS_LENGTH_KEYWORDS = new Set([
  'auto',
  'inherit',
  'initial',
  'revert',
  'revert-layer',
  'unset',
]);

export interface CssLengthDraft {
  value: string;
  unit: string;
}

/**
 * Converts an authored CSS length into the two visual pieces used by inspector
 * fields. Keeping the suffix outside the editable value prevents a controlled
 * input from producing malformed intermediate strings such as `8%0%`.
 */
export function splitCssLengthDraft(
  rawValue: string | undefined,
  options: { defaultUnit?: string; emptyValue?: string } = {},
): CssLengthDraft {
  const defaultUnit = options.defaultUnit ?? 'px';
  const emptyValue = options.emptyValue ?? '';
  const normalized = String(rawValue || '')
    .replace(/\s*!important\s*$/i, '')
    .trim();

  if (!normalized || normalized.toLowerCase() === 'normal') {
    return { value: emptyValue, unit: defaultUnit };
  }

  const match = normalized.match(CSS_LENGTH_PATTERN);
  if (match) {
    return {
      value: match[1],
      unit: match[2] || defaultUnit,
    };
  }

  if (CSS_LENGTH_KEYWORDS.has(normalized.toLowerCase())) {
    return { value: normalized, unit: '' };
  }

  // Functions and other advanced authored values remain editable as a whole.
  return { value: normalized, unit: '' };
}

/**
 * Reassembles a visual draft into valid CSS. `null` means the user is in the
 * middle of typing (`-`, `8.`, `calc(`, …), so callers should retain the local
 * draft without writing invalid CSS to the document.
 */
export function composeCssLengthDraft(value: string, unit = 'px'): string | null {
  const normalized = value.trim();
  if (!normalized) return '';

  const dimension = normalized.match(CSS_LENGTH_PATTERN);
  if (dimension) {
    if (dimension[2]) return normalized;
    return `${dimension[1]}${unit}`;
  }

  if (
    CSS_LENGTH_KEYWORDS.has(normalized.toLowerCase())
    || CSS_LENGTH_FUNCTION_PATTERN.test(normalized)
  ) {
    return normalized;
  }

  return null;
}

