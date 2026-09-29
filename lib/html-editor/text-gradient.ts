export type CssDeclarationChange = {
  property: string;
  value: string;
};

const GRADIENT_FUNCTION_PATTERN = /(?:^|\s)(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

function normalized(value: string | undefined) {
  return (value || '').replace(/\s*!\s*important\s*$/i, '').trim();
}

function isTransparent(value: string | undefined) {
  const candidate = normalized(value).toLowerCase();
  return candidate === 'transparent'
    || candidate === 'rgba(0,0,0,0)'
    || candidate === 'rgb(0 0 0 / 0)';
}

export function isCssGradient(value: string | undefined) {
  return GRADIENT_FUNCTION_PATTERN.test(normalized(value));
}

export function hasTextGradientRecipe(values: Record<string, string>) {
  const backgroundImage = normalized(values['background-image']);
  const clipsText = [
    values['background-clip'],
    values['-webkit-background-clip'],
  ].some(value => normalized(value).toLowerCase() === 'text');
  const transparentText = isTransparent(values['-webkit-text-fill-color'])
    || isTransparent(values.color);

  return isCssGradient(backgroundImage) && clipsText && transparentText;
}

/**
 * The generic color picker represents a text gradient with the gradient string
 * itself. CSS cannot store that string in `color`, so the HTML adapter reads the
 * complete text-paint recipe back as one visual value.
 */
export function readTextPaintValue(values: Record<string, string>) {
  if (hasTextGradientRecipe(values)) return normalized(values['background-image']);

  // Recover values written by older editor builds. The browser ignores a
  // gradient in `color`, but keeping it visible lets the next edit migrate it
  // to the valid recipe rather than silently replacing it.
  if (isCssGradient(values.color)) return normalized(values.color);

  return normalized(values.color);
}

/**
 * Translate a visual text colour into valid CSS declarations. The recipe is
 * scoped by the caller, so pseudo states and responsive rules retain their
 * normal authoring boundary.
 */
export function textPaintDeclarationChanges(
  value: string,
  currentValues: Record<string, string>,
): CssDeclarationChange[] {
  const paint = normalized(value);

  if (isCssGradient(paint)) {
    return [
      { property: 'background-image', value: paint },
      { property: 'background-clip', value: 'text' },
      { property: '-webkit-background-clip', value: 'text' },
      { property: 'color', value: 'transparent' },
      { property: '-webkit-text-fill-color', value: 'transparent' },
    ];
  }

  const changes: CssDeclarationChange[] = [
    { property: 'color', value: paint },
  ];

  // Clear only declarations that form the active text-gradient recipe. An
  // unrelated authored background remains untouched when changing text colour.
  if (!hasTextGradientRecipe(currentValues) && !isCssGradient(currentValues.color)) {
    return changes;
  }

  if (isCssGradient(currentValues['background-image'])) {
    changes.push({ property: 'background-image', value: '' });
  }
  if (normalized(currentValues['background-clip']).toLowerCase() === 'text') {
    changes.push({ property: 'background-clip', value: '' });
  }
  if (normalized(currentValues['-webkit-background-clip']).toLowerCase() === 'text') {
    changes.push({ property: '-webkit-background-clip', value: '' });
  }
  if (isTransparent(currentValues['-webkit-text-fill-color'])) {
    changes.push({ property: '-webkit-text-fill-color', value: '' });
  }

  return changes;
}
