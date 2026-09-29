export function splitCssDeclarations(cssText: string) {
  const declarations: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < cssText.length; index++) {
    const character = cssText[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ';' && depth === 0) {
      declarations.push(cssText.slice(start, index));
      start = index + 1;
    }
  }
  declarations.push(cssText.slice(start));
  return declarations;
}

/**
 * Remove CSS priority for value-only controls and disposable previews.
 * Source-aware edits use the detail parser below so an existing legacy
 * priority can survive while only its declaration value changes.
 */
export function stripImportantPriority(value: string) {
  return value.replace(/\s*!\s*important\b/gi, '');
}

/**
 * CSS declarations which expand into other declarations. Keeping the
 * relationship here (instead of in an individual panel) gives class rules,
 * inline styles and direct-canvas writes the same conflict semantics.
 *
 * The map intentionally includes nested shorthands (`border` → `border-top` →
 * `border-top-width`). This lets a control remove the authored declaration
 * that could otherwise keep winning through an old `!important`.
 */
export const CSS_SHORTHAND_LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  gap: ['row-gap', 'column-gap'],
  background: [
    'background-color',
    'background-image',
    'background-position',
    'background-size',
    'background-repeat',
    'background-attachment',
    'background-clip',
    'background-origin',
  ],
  border: [
    'border-width',
    'border-style',
    'border-color',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    // `border` resets border-image to its initial value even though the image
    // syntax itself is authored through the separate shorthand.
    'border-image',
  ],
  'border-width': [
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ],
  'border-style': [
    'border-top-style',
    'border-right-style',
    'border-bottom-style',
    'border-left-style',
  ],
  'border-color': [
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
  ],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  'border-block': ['border-block-width', 'border-block-style', 'border-block-color'],
  'border-inline': ['border-inline-width', 'border-inline-style', 'border-inline-color'],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
  outline: ['outline-width', 'outline-style', 'outline-color'],
  font: [
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'font-stretch',
    'font-variant',
    'line-height',
  ],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  grid: [
    'grid-template',
    'grid-template-rows',
    'grid-template-columns',
    'grid-auto-flow',
    'grid-auto-rows',
    'grid-auto-columns',
    'grid-row',
    'grid-column',
  ],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  // `grid-area` overlaps the two axis shorthands. Listing them (rather than
  // only their four final longhands) lets a visual grid-row/grid-column edit
  // recognize a later grid-area declaration as its real cascade owner.
  'grid-area': ['grid-row', 'grid-column'],
  'grid-row': ['grid-row-start', 'grid-row-end'],
  'grid-column': ['grid-column-start', 'grid-column-end'],
  'place-content': ['align-content', 'justify-content'],
  'place-items': ['align-items', 'justify-items'],
  'place-self': ['align-self', 'justify-self'],
  overflow: ['overflow-x', 'overflow-y'],
  'overscroll-behavior': ['overscroll-behavior-x', 'overscroll-behavior-y'],
  inset: ['top', 'right', 'bottom', 'left'],
  'inset-block': ['inset-block-start', 'inset-block-end'],
  'inset-inline': ['inset-inline-start', 'inset-inline-end'],
  'margin-block': ['margin-block-start', 'margin-block-end'],
  'margin-inline': ['margin-inline-start', 'margin-inline-end'],
  'padding-block': ['padding-block-start', 'padding-block-end'],
  'padding-inline': ['padding-inline-start', 'padding-inline-end'],
  'scroll-margin': [
    'scroll-margin-top',
    'scroll-margin-right',
    'scroll-margin-bottom',
    'scroll-margin-left',
  ],
  'scroll-margin-block': ['scroll-margin-block-start', 'scroll-margin-block-end'],
  'scroll-margin-inline': ['scroll-margin-inline-start', 'scroll-margin-inline-end'],
  'scroll-padding': [
    'scroll-padding-top',
    'scroll-padding-right',
    'scroll-padding-bottom',
    'scroll-padding-left',
  ],
  'scroll-padding-block': ['scroll-padding-block-start', 'scroll-padding-block-end'],
  'scroll-padding-inline': ['scroll-padding-inline-start', 'scroll-padding-inline-end'],
  columns: ['column-width', 'column-count'],
  'column-rule': ['column-rule-width', 'column-rule-style', 'column-rule-color'],
  transition: [
    'transition-property',
    'transition-duration',
    'transition-timing-function',
    'transition-delay',
    'transition-behavior',
  ],
  animation: [
    'animation-name',
    'animation-duration',
    'animation-timing-function',
    'animation-delay',
    'animation-iteration-count',
    'animation-direction',
    'animation-fill-mode',
    'animation-play-state',
    'animation-composition',
    'animation-timeline',
    'animation-range',
  ],
  'text-decoration': [
    'text-decoration-line',
    'text-decoration-color',
    'text-decoration-style',
    'text-decoration-thickness',
  ],
  'text-emphasis': ['text-emphasis-style', 'text-emphasis-color'],
  // CSS Text Level 4 models these as shorthands. `white-space` overlaps the
  // text-wrap control through text-wrap-mode, so include the nested shorthand
  // to keep a later white-space declaration from silently winning.
  'text-wrap': ['text-wrap-mode', 'text-wrap-style'],
  'white-space': ['white-space-collapse', 'text-wrap', 'white-space-trim'],
  'list-style': ['list-style-position', 'list-style-image', 'list-style-type'],
  'border-image': [
    'border-image-source',
    'border-image-slice',
    'border-image-width',
    'border-image-outset',
    'border-image-repeat',
  ],
  mask: [
    'mask-image',
    'mask-mode',
    'mask-position',
    'mask-size',
    'mask-repeat',
    'mask-origin',
    'mask-clip',
    'mask-composite',
    // The mask shorthand also resets the mask-border family to its initials.
    'mask-border',
  ],
  'mask-border': [
    'mask-border-source',
    'mask-border-slice',
    'mask-border-width',
    'mask-border-outset',
    'mask-border-repeat',
    'mask-border-mode',
  ],
  container: ['container-name', 'container-type'],
  offset: ['offset-position', 'offset-path', 'offset-distance', 'offset-rotate', 'offset-anchor'],
  'scroll-timeline': ['scroll-timeline-name', 'scroll-timeline-axis'],
  'view-timeline': ['view-timeline-name', 'view-timeline-axis', 'view-timeline-inset'],
  'animation-range': ['animation-range-start', 'animation-range-end'],
};

function shorthandDescendants(property: string, seen = new Set<string>()): Set<string> {
  if (seen.has(property)) return seen;
  seen.add(property);
  (CSS_SHORTHAND_LONGHANDS[property] || []).forEach((child) => {
    shorthandDescendants(child, seen);
  });
  return seen;
}

/** CSS custom property names retain their authored, case-sensitive identity. */
export function normalizeStylePropertyName(property: string) {
  const trimmed = property.trim();
  return trimmed.startsWith('--') ? trimmed : trimmed.toLowerCase();
}

export function isStyleShorthandFor(shorthand: string, property: string) {
  const normalizedShorthand = normalizeStylePropertyName(shorthand);
  const normalizedProperty = normalizeStylePropertyName(property);
  if (!normalizedProperty || normalizedShorthand === normalizedProperty || normalizedProperty.startsWith('--')) return false;
  if (normalizedShorthand === 'all' && ['direction', 'unicode-bidi'].includes(normalizedProperty)) return false;
  return normalizedShorthand === 'all' || shorthandDescendants(normalizedShorthand).has(normalizedProperty);
}

/**
 * Returns declarations that cannot safely remain beside a panel-authored
 * mutation in the same cascade layer.
 *
 * - Writing a shorthand removes all of its longhands.
 * - Writing a longhand removes every shorthand capable of resetting it.
 * - `all` is always removed because `all: … !important` can shadow almost any
 *   visual control.
 *
 * Sibling longhands are preserved. Editing `padding-left`, for example, must
 * not erase a separately authored `padding-top`.
 */
export function conflictingStyleProperties(property: string): Set<string> {
  const normalized = normalizeStylePropertyName(property);
  // CSS `all` excludes custom properties; neither can override the other.
  if (normalized.startsWith('--') || normalized === 'direction' || normalized === 'unicode-bidi') return new Set([normalized]);
  const conflicts = new Set<string>(normalized ? [normalized, 'all'] : []);
  if (!normalized) return conflicts;

  const descendants = shorthandDescendants(normalized);
  descendants.forEach(item => conflicts.add(item));

  Object.keys(CSS_SHORTHAND_LONGHANDS).forEach((shorthand) => {
    if (shorthandDescendants(shorthand).has(normalized)) conflicts.add(shorthand);
  });
  return conflicts;
}

function propertySeparator(declaration: string) {
  let quote = '';
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < declaration.length; index++) {
    const character = declaration[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ':' && depth === 0) return index;
  }
  return -1;
}

export interface StyleDeclarationDetail {
  value: string;
  important: boolean;
}

function skipCssWhitespaceAndComments(value: string, start: number) {
  let index = start;
  while (index < value.length) {
    if (/\s/.test(value[index])) {
      index += 1;
      continue;
    }
    if (value[index] !== '/' || value[index + 1] !== '*') break;
    const end = value.indexOf('*/', index + 2);
    if (end < 0) return value.length;
    index = end + 2;
  }
  return index;
}

function styleValueWithPriority(value: string): StyleDeclarationDetail {
  let quote = '';
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2);
      if (end < 0) break;
      index = end + 1;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character !== '!' || depth !== 0) continue;
    const keywordStart = skipCssWhitespaceAndComments(value, index + 1);
    if (value.slice(keywordStart, keywordStart + 9).toLowerCase() !== 'important') continue;
    const end = skipCssWhitespaceAndComments(value, keywordStart + 9);
    if (end === value.length) {
      return { value: value.slice(0, index).trim(), important: true };
    }
  }
  return { value: value.trim(), important: false };
}

/**
 * Parses an authored inline-style attribute without discarding CSS priority.
 *
 * Duplicate properties follow the browser cascade within one declaration
 * block: an important declaration beats every normal declaration, while the
 * later declaration wins when both candidates have the same priority.
 */
export function parseStyleDeclarationDetails(
  cssText: string,
): Record<string, StyleDeclarationDetail> {
  const winners: Record<string, StyleDeclarationDetail> = {};
  splitCssDeclarations(cssText).forEach(declaration => {
    const separator = propertySeparator(declaration);
    if (separator < 0) return;
    const property = normalizeStylePropertyName(declaration.slice(0, separator));
    if (!property) return;
    const parsed = styleValueWithPriority(declaration.slice(separator + 1));
    const current = winners[property];
    // Duplicate declarations inside a style attribute follow the same
    // importance rule as a stylesheet block: an earlier important value is
    // not replaced by a later normal value. Keeping the real winner prevents
    // an unrelated panel edit from accidentally serializing the losing value.
    if (
      current?.important
      && !parsed.important
    ) return;
    winners[property] = parsed;
  });
  return winners;
}

/** Serialize a priority-aware inline-style record back to authored CSS. */
export function serializeStyleDeclarationDetails(
  styles: Record<string, StyleDeclarationDetail>,
) {
  return Object.entries(styles)
    .map(([property, declaration]) => [
      property,
      declaration.value.trim(),
      declaration.important,
    ] as const)
    .filter(([property, value]) => property && value)
    .map(([property, value, important]) => (
      `${property}: ${value}${important ? ' !important' : ''}`
    ))
    .join('; ');
}

/**
 * Backwards-compatible value-only projection used by existing visual controls.
 * Call {@link parseStyleDeclarationDetails} whenever source priority must
 * survive inspection or migration.
 */
export function parseStyleDeclarations(cssText: string): Record<string, string> {
  const winners = parseStyleDeclarationDetails(cssText);
  return Object.fromEntries(
    Object.entries(winners).map(([property, winner]) => [property, winner.value]),
  );
}

/** Compare two authored inline-style attributes, including priority-only edits. */
export function diffStyleDeclarationDetails(
  beforeStyle: string,
  afterStyle: string,
) {
  const previousStyles = parseStyleDeclarationDetails(beforeStyle);
  const nextStyles = parseStyleDeclarationDetails(afterStyle);
  const changes: Array<StyleDeclarationDetail & { property: string }> = [];
  new Set([...Object.keys(previousStyles), ...Object.keys(nextStyles)]).forEach(property => {
    const previous = previousStyles[property];
    const next = nextStyles[property];
    if (previous?.value === next?.value && previous?.important === next?.important) return;
    changes.push({
      property,
      value: next?.value || '',
      important: Boolean(next?.important),
    });
  });
  return changes;
}

export function serializeStyleDeclarations(styles: Record<string, string>) {
  return Object.entries(styles)
    .map(([property, value]) => [property, value.trim()] as const)
    .filter(([property, value]) => property && value)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
}

export interface StyleDeclarationWriteOptions {
  /**
   * Retained for call-site compatibility. Priority-aware source writes always
   * preserve the existing priority of the edited property; the value-only
   * compatibility writer below remains available to explicit normalizers such
   * as Hide/Show.
   */
  preservePriority?: boolean;
  /**
   * Remove conflicting shorthand/longhand declarations for a panel command.
   */
  authoritative?: boolean;
}

/**
 * Applies one generic source edit without flattening authored CSS priority.
 *
 * Replacing a property's value preserves that property's existing priority,
 * while an explicitly prioritized incoming value remains prioritized as well.
 * Unrelated declarations retain their own priority bit. An empty value still
 * removes the requested property (and authoritative shorthand conflicts).
 */
export function writeStyleDeclarationDetails(
  styles: Record<string, StyleDeclarationDetail>,
  property: string,
  value: string,
  options: StyleDeclarationWriteOptions = {},
) {
  const normalizedProperty = normalizeStylePropertyName(property);
  if (!normalizedProperty) return { ...styles };
  const incoming = styleValueWithPriority(value);
  const current = styles[normalizedProperty];
  const conflicts = options.authoritative
    ? conflictingStyleProperties(normalizedProperty)
    : new Set([normalizedProperty]);
  const next = Object.fromEntries(
    Object.entries(styles)
      .filter(([name]) => !conflicts.has(normalizeStylePropertyName(name)))
      .map(([name, declaration]) => [name, { ...declaration }]),
  );
  if (!incoming.value) return next;
  next[normalizedProperty] = {
    value: incoming.value,
    important: incoming.important || Boolean(current?.important),
  };
  return next;
}

/**
 * Applies one visual declaration to a parsed inline-style record.
 *
 * The written property is deliberately reinserted last. JavaScript assignment
 * does not change an existing object's key order, so `gap` could otherwise
 * remain before a later conflicting declaration and appear to be ignored even
 * though the source value changed successfully.
 */
export function writeStyleDeclaration(
  styles: Record<string, string>,
  property: string,
  value: string,
  options: StyleDeclarationWriteOptions = {},
) {
  const normalizedProperty = normalizeStylePropertyName(property);
  if (!normalizedProperty) return { ...styles };
  const cleanValue = stripImportantPriority(value).trim();
  const conflicts = options.authoritative
    ? conflictingStyleProperties(normalizedProperty)
    : new Set([normalizedProperty]);
  const next = Object.fromEntries(
    Object.entries(styles)
      .filter(([name]) => !conflicts.has(normalizeStylePropertyName(name)))
      .map(([name, existingValue]) => [name, stripImportantPriority(existingValue).trim()]),
  );
  if (!cleanValue) return next;
  next[normalizedProperty] = cleanValue;
  return next;
}

/** Convert the builder color picker's `#rrggbb/NN` syntax into valid CSS. */
export function normalizeCssColorValue(value: string) {
  return value.replace(/#([0-9a-f]{6})\/(\d{1,3})(?![\d.])/gi, (_match, hex: string, rawOpacity: string) => {
    const opacity = Math.max(0, Math.min(100, Number(rawOpacity)));
    const alpha = Math.round((opacity / 100) * 255).toString(16).padStart(2, '0');
    return `#${hex}${alpha}`;
  });
}
