import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Document, type Rule } from 'postcss';
import valueParser from 'postcss-value-parser';
import { conflictingStyleProperties, isStyleShorthandFor, normalizeStylePropertyName, stripImportantPriority } from './style-utils';

export type CssPseudoState =
  | 'base' | 'hover' | 'focus' | 'focus-visible' | 'active' | 'selection' | 'placeholder'
  | '-webkit-scrollbar' | '-webkit-scrollbar-thumb' | '-webkit-scrollbar-track';

/** Pseudo-elements use `::`, pseudo-classes use `:`. */
const PSEUDO_ELEMENTS = new Set<CssPseudoState>([
  'selection', 'placeholder', '-webkit-scrollbar', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track',
]);

/**
 * Legacy Builder versions appended this impossible compound to visual rules.
 * Keep recognizing it so the next edit can migrate those rules back to their
 * authored selector; never emit it again. Its four IDs made a base rule outrank
 * legitimate pseudo-state and responsive overrides.
 */
const LEGACY_AUTHORITATIVE_SPECIFICITY_GUARD =
  ':not(#__kodety_visual_authority_a#__kodety_visual_authority_b#__kodety_visual_authority_c#__kodety_visual_authority_d)';
const LEGACY_AUTHORITATIVE_SPECIFICITY_GUARD_PATTERN =
  /:not\(\s*#__kodety_visual_authority_a\s*#__kodety_visual_authority_b\s*#__kodety_visual_authority_c\s*#__kodety_visual_authority_d\s*\)/g;

/**
 * Browsers recover a stylesheet that reaches EOF with open rule/media blocks
 * by implicitly closing those blocks. PostCSS intentionally rejects the same
 * input, which used to make every visual control fail even when the selected
 * class was valid and appeared thousands of lines before the truncated tail.
 *
 * Mirror the browser's narrow EOF recovery: append only the minimum number of
 * closing braces required for PostCSS to accept an `Unclosed block` error. Any
 * other syntax error remains an error instead of risking a speculative rewrite.
 */
function parseCssForAuthoring(source: string) {
  try {
    return postcss.parse(source);
  } catch (initialError) {
    const reason = initialError && typeof initialError === 'object' && 'reason' in initialError
      ? String((initialError as { reason?: unknown }).reason || '')
      : '';
    if (reason !== 'Unclosed block') throw initialError;

    let repaired = source.endsWith('\n') ? source : `${source}\n`;
    for (let missingClosures = 1; missingClosures <= 64; missingClosures += 1) {
      repaired += '}\n';
      try {
        return postcss.parse(repaired);
      } catch (nextError) {
        const nextReason = nextError && typeof nextError === 'object' && 'reason' in nextError
          ? String((nextError as { reason?: unknown }).reason || '')
          : '';
        if (nextReason !== 'Unclosed block') throw initialError;
      }
    }
    throw initialError;
  }
}

// Inspector selection can ask for the same stylesheet several times in one
// render: once to locate the property owner, once to merge declarations and
// once more for inherited values. PostCSS roots are comparatively expensive,
// but these read paths never mutate the tree. Keep a small content-keyed LRU so
// they share the exact parsed snapshot. Patch functions deliberately continue
// calling parseCssForAuthoring() and therefore always receive a fresh root.
const READ_ONLY_CSS_PARSE_CACHE_LIMIT = 24;
const READ_ONLY_CSS_PARSE_CACHE_SOURCE_BUDGET = 2_000_000;
const readOnlyCssParseCache = new Map<string, postcss.Root>();
let readOnlyCssParseCacheSourceLength = 0;

function parseCssForInspection(source: string) {
  const cached = readOnlyCssParseCache.get(source);
  if (cached) {
    readOnlyCssParseCache.delete(source);
    readOnlyCssParseCache.set(source, cached);
    return cached;
  }
  const root = parseCssForAuthoring(source);
  readOnlyCssParseCache.set(source, root);
  readOnlyCssParseCacheSourceLength += source.length;
  while (
    readOnlyCssParseCache.size > READ_ONLY_CSS_PARSE_CACHE_LIMIT
    || (
      readOnlyCssParseCacheSourceLength > READ_ONLY_CSS_PARSE_CACHE_SOURCE_BUDGET
      && readOnlyCssParseCache.size > 1
    )
  ) {
    const oldest = readOnlyCssParseCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    readOnlyCssParseCache.delete(oldest);
    readOnlyCssParseCacheSourceLength -= oldest.length;
  }
  return root;
}

/**
 * A breakpoint id. `base` is reserved for the unscoped root rules (no media
 * query). Every other id must exist in the breakpoint registry passed to the
 * patch functions. Callers which omit a registry receive
 * {@link DEFAULT_BREAKPOINTS}; an explicitly removed breakpoint is never
 * recreated from those defaults.
 */
export type CssBreakpoint = string;

export type BreakpointMode = 'min-width' | 'max-width';

export interface Breakpoint {
  id: string;
  label: string;
  mode: BreakpointMode;
  width: number;
}

/**
 * Breakpoint-registry schema understood by the current Builder. The marker is
 * persisted separately from the project metadata version so a project that
 * deliberately chooses 410px after migration is never mistaken for the
 * implicit 410px defaults used by older releases.
 */
export const CURRENT_BREAKPOINT_SCHEMA_VERSION = 2;

export interface CssEditingContext {
  /** Visual authoring is always stylesheet-backed. */
  target: 'rule';
  selector: string;
  cssFilePath: string;
  pseudo: CssPseudoState;
  breakpoint: CssBreakpoint;
}

/** The unscoped design source shared by every child breakpoint. */
export const DEFAULT_PRIMARY_BREAKPOINT: Breakpoint = {
  id: 'base', label: 'Primary', mode: 'max-width', width: 1920,
};

export const MIN_BREAKPOINT_WIDTH = 240;

/**
 * Normalises persisted/committed breakpoint widths without imposing an
 * arbitrary upper limit. Large canvases are intentional in the editor (for
 * example 5200px artboards), so silently clamping them changes user data.
 */
export function normalizeBreakpointWidth(value: unknown, fallback: number): number {
  const hasValue = typeof value === 'string'
    ? value.trim().length > 0
    : value !== null && value !== undefined;
  const numeric = hasValue
    ? (typeof value === 'number' ? value : Number(value))
    : Number.NaN;
  const fallbackNumeric = Number.isFinite(fallback) ? fallback : DEFAULT_PRIMARY_BREAKPOINT.width;
  return Math.max(
    MIN_BREAKPOINT_WIDTH,
    Math.round(Number.isFinite(numeric) ? numeric : fallbackNumeric),
  );
}

/**
 * Canonicalises the unscoped canvas breakpoint shared by authoring, Preview
 * and publication. Persisted projects from older Builder versions may omit
 * fields or carry a stale id; those differences must never make the published
 * Code Component runtime choose a viewport that the canvas did not show.
 */
export function normalizePrimaryBreakpoint(
  value: unknown,
  fallback: Breakpoint = DEFAULT_PRIMARY_BREAKPOINT,
): Breakpoint {
  const raw = value && typeof value === 'object'
    ? value as Partial<Breakpoint>
    : {};
  const fallbackMode: BreakpointMode = fallback.mode === 'min-width' || fallback.mode === 'max-width'
    ? fallback.mode
    : DEFAULT_PRIMARY_BREAKPOINT.mode;
  return {
    id: 'base',
    label: typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : fallback.label || DEFAULT_PRIMARY_BREAKPOINT.label,
    mode: raw.mode === 'min-width' || raw.mode === 'max-width'
      ? raw.mode
      : fallbackMode,
    width: normalizeBreakpointWidth(raw.width, fallback.width),
  };
}

/**
 * Exact default registry emitted by the legacy 410px-mobile Builder. Keep this
 * stable migration signature separate from the live defaults: broad
 * "contains a 410px breakpoint" checks would rewrite intentional custom
 * registries and make a later explicit 410px choice impossible to preserve.
 */
export const LEGACY_STOCK_BREAKPOINTS: Breakpoint[] = [
  { id: 'wide', label: 'Wide', mode: 'min-width', width: 2560 },
  { id: 'notebook', label: 'Notebook', mode: 'max-width', width: 1200 },
  { id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 },
  { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 },
];

/** Practical defaults: one larger canvas and a desktop-first chain downward. */
export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { id: 'wide', label: 'Wide', mode: 'min-width', width: 2560 },
  { id: 'notebook', label: 'Notebook', mode: 'max-width', width: 1200 },
  { id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 },
  { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 480 },
];

/**
 * True only for the complete, ordered legacy signature. Early metadata could
 * omit label/mode, so absence inherits the stock value; any explicit mismatch
 * remains a custom registry and is never migrated.
 */
export function isLegacyStockBreakpointRegistry(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== LEGACY_STOCK_BREAKPOINTS.length) return false;
  return LEGACY_STOCK_BREAKPOINTS.every((expected, index) => {
    const candidate = value[index];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const breakpoint = candidate as Partial<Breakpoint>;
    return breakpoint.id === expected.id
      && (breakpoint.label === undefined || breakpoint.label === expected.label)
      && (breakpoint.mode === undefined || breakpoint.mode === expected.mode)
      && breakpoint.width === expected.width;
  });
}

/**
 * Repairs breakpoint registries written by older Builder versions.
 *
 * Some legacy projects contain a valid id/width but no `mode`. Passing that
 * object straight to the CSS patcher serializes `(undefined: 810px)`: the
 * transient control preview paints, but the browser ignores the committed
 * media query. Preserve custom ids, labels and widths while filling only
 * missing or invalid fields.
 */
export function normalizeBreakpointRegistry(
  value: unknown,
  fallback: readonly Breakpoint[] = DEFAULT_BREAKPOINTS,
): Breakpoint[] {
  if (!Array.isArray(value)) return fallback.map(item => ({ ...item }));
  // An empty registry is a valid user choice (all custom breakpoints removed),
  // not legacy/corrupt data that should silently recreate the defaults.
  if (!value.length) return [];
  const fallbackById = new Map(fallback.map(item => [item.id, item]));
  const usedIds = new Set<string>();
  const normalized = value.flatMap((candidate, index): Breakpoint[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const raw = candidate as Partial<Breakpoint>;
    const id = typeof raw.id === 'string' && /^[-a-z0-9_]+$/i.test(raw.id.trim())
      ? raw.id.trim()
      : '';
    if (!id || id === 'base' || usedIds.has(id)) return [];
    const legacyFallback = fallbackById.get(id);
    const numericWidth = Number(raw.width);
    if (!Number.isFinite(numericWidth)) return [];
    const mode: BreakpointMode = raw.mode === 'min-width' || raw.mode === 'max-width'
      ? raw.mode
      : legacyFallback?.mode || (id === 'wide' || /^min(?:-|$)/i.test(id) ? 'min-width' : 'max-width');
    usedIds.add(id);
    return [{
      id,
      label: typeof raw.label === 'string' && raw.label.trim()
        ? raw.label.trim()
        : legacyFallback?.label || `Breakpoint ${index + 1}`,
      mode,
      width: normalizeBreakpointWidth(numericWidth, legacyFallback?.width || 768),
    }];
  });
  return normalized.length ? normalized : fallback.map(item => ({ ...item }));
}

function resolveBreakpoint(id: CssBreakpoint, breakpoints: Breakpoint[]): Breakpoint | null {
  if (id === 'base' || !id) return null;
  const found = breakpoints.find(breakpoint => breakpoint.id === id);
  if (found) return found;
  throw new Error(`Breakpoint desconhecido: ${id}. Cadastre-o antes de editar.`);
}

/** Normalised, comparable media params for a breakpoint (`(max-width: 991px)`). */
function breakpointParams(breakpoint: Breakpoint) {
  return `(${breakpoint.mode}: ${breakpoint.width}px)`;
}

function widthConditionMatches(mode: BreakpointMode, threshold: number, width: number) {
  return mode === 'min-width' ? width >= threshold : width <= threshold;
}

/**
 * Splits a selector list without treating commas inside :is(), :where(),
 * :not(), attribute selectors or quoted values as group separators.
 */
function splitSelectorList(selector: string) {
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  let escaped = false;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
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
    if (character === '/' && selector[index + 1] === '*') {
      const end = selector.indexOf('*/', index + 2);
      index = end < 0 ? selector.length : end + 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      parts.push(selector.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

function selectorWithState(selector: string, state: CssPseudoState) {
  const trimmed = selector.trim();
  if (!trimmed) throw new Error('Informe um seletor CSS.');
  // Distribute the pseudo state across every selector in a group (`.a, .b`).
  const suffix = state === 'base' ? '' : PSEUDO_ELEMENTS.has(state) ? `::${state}` : `:${state}`;
  return splitSelectorList(trimmed)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `${part}${suffix}`)
    .join(', ');
}

function withoutAuthorityGuard(selector: string) {
  return selector
    .split(LEGACY_AUTHORITATIVE_SPECIFICITY_GUARD).join('')
    .replace(LEGACY_AUTHORITATIVE_SPECIFICITY_GUARD_PATTERN, '');
}

function normalizedSelectorParts(selector: string) {
  return splitSelectorList(withoutAuthorityGuard(selector))
    .map(part => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

function selectorListContains(ruleSelector: string, targetSelector: string) {
  const ruleParts = new Set(normalizedSelectorParts(ruleSelector));
  const targetParts = normalizedSelectorParts(targetSelector);
  return Boolean(targetParts.length) && targetParts.every(part => ruleParts.has(part));
}

export { selectorListContains as cssSelectorListContains };

function selectorIdentifierAt(selector: string, start: number) {
  let end = start;
  let value = '';
  while (end < selector.length) {
    const character = selector[end];
    if (character === '\\' && end + 1 < selector.length) {
      const hex = selector.slice(end + 1).match(/^[\da-f]{1,6}/i)?.[0];
      if (hex) {
        const codePoint = parseInt(hex, 16);
        value += String.fromCodePoint(codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff) ? 0xfffd : codePoint);
        end += 1 + hex.length;
        if (selector[end] === '\r' && selector[end + 1] === '\n') end += 2;
        else if (/[\t\n\f\r ]/.test(selector[end] || '')) end += 1;
      } else {
        value += selector[end + 1];
        end += 2;
      }
    } else if (/[\w-]/.test(character) || character.charCodeAt(0) >= 0x80) {
      value += character;
      end += 1;
    } else break;
  }
  return { value, end };
}

/** Skip a selector function/attribute without treating its strings as subjects. */
function selectorBlockEnd(selector: string, start: number) {
  const stack = [selector[start] === '[' ? ']' : ')'];
  let quote = '';
  for (let index = start + 1; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '/' && selector[index + 1] === '*') {
      const end = selector.indexOf('*/', index + 2);
      if (end < 0) return selector.length;
      index = end + 1;
    } else if (character === '[' || character === '(') stack.push(character === '[' ? ']' : ')');
    else if (character === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return index + 1;
    }
  }
  return selector.length;
}

function selectorSubjectIdentity(selector: string) {
  let identities = new Set<string>();
  let identityOnly = true;
  let hasCombinator = false;
  let elementSubject = true;
  for (let index = 0; index < selector.length;) {
    const character = selector[index];
    if (character === '/' && selector[index + 1] === '*') {
      const end = selector.indexOf('*/', index + 2);
      if (end < 0) return { identities: new Set<string>(), simple: false, elementSubject: false };
      index = end + 2;
    } else if (/\s/.test(character) || character === '>' || character === '+' || character === '~' || selector.slice(index, index + 2) === '||') {
      hasCombinator = true;
      identities = new Set();
      identityOnly = true;
      elementSubject = true;
      index += selector.slice(index, index + 2) === '||' ? 2 : 1;
    } else if (character === '.' || character === '#') {
      const identifier = selectorIdentifierAt(selector, index + 1);
      if (!identifier.value) identityOnly = false;
      else identities.add(character + identifier.value);
      index = Math.max(index + 1, identifier.end);
    } else if (character === '[') {
      const end = selectorBlockEnd(selector, index);
      const attribute = selector.slice(index, end).match(/^\[data-kodety-style-id\s*=\s*(["'])(element-\d{6,12})\1\s*\]$/i);
      if (attribute) identities.add('@style:' + attribute[2]);
      else identityOnly = false;
      index = end;
    } else if (character === ':') {
      identityOnly = false;
      const isPseudoElement = selector[index + 1] === ':';
      const identifier = selectorIdentifierAt(selector, index + (isPseudoElement ? 2 : 1));
      if (isPseudoElement || /^(?:before|after|first-letter|first-line)$/i.test(identifier.value)) elementSubject = false;
      index = Math.max(index + 1, identifier.end);
      if (selector[index] === '(') index = selectorBlockEnd(selector, index);
    } else {
      identityOnly = false;
      if (character === '(') index = selectorBlockEnd(selector, index);
      else index = Math.max(index + 1, selectorIdentifierAt(selector, index).end);
    }
  }
  return { identities, simple: !hasCombinator && identityOnly && identities.size > 0, elementSubject };
}

/**
 * Follow an authored contextual owner only when its element subject retains
 * every identity selected in the Inspector. Ancestors, negations, attribute
 * values and similar class names never count as that identity. The returned
 * group excludes sibling subjects and keeps each accepted branch's conditions.
 * Already scoped/grouped Inspector selectors require an exact source match.
 */
export function cssAuthoringSelectorFromOrigin(originSelector: string, activeSelector: string): string | null {
  const targets = splitSelectorList(activeSelector).map(part => part.trim()).filter(Boolean);
  const target = targets.length === 1 ? selectorSubjectIdentity(targets[0]) : null;
  if (!target?.simple) return selectorListContains(originSelector, activeSelector) ? activeSelector : null;
  const matches = splitSelectorList(withoutAuthorityGuard(originSelector)).map(part => part.trim()).filter(branch => {
    if (!branch) return false;
    const subject = selectorSubjectIdentity(branch);
    return subject.elementSubject && [...target.identities].every(identity => subject.identities.has(identity));
  });
  return matches.length ? matches.join(', ') : null;
}

/**
 * A grouped rule such as `.button, .link` is a real source owner for
 * `.button`, but changing its declaration in place would unexpectedly restyle
 * `.link`. Split the requested selector(s) into an adjacent rule first. This
 * preserves the original declarations/order for every sibling selector while
 * giving the selected class one unambiguous source block to edit.
 */
function isolateSelectorFromGroup(rule: Rule, targetSelector: string) {
  const normalizedTarget = normalizedSelectorParts(targetSelector);
  const authoredParts = splitSelectorList(rule.selector)
    .map(part => ({ authored: part.trim(), normalized: normalizedSelectorParts(part)[0] || '' }))
    .filter(part => part.normalized);
  const requested = new Set(normalizedTarget);
  const remaining = authoredParts.filter(part => !requested.has(part.normalized));
  if (!remaining.length) {
    rule.selector = withoutAuthorityGuard(rule.selector);
    return rule;
  }
  rule.selector = remaining.map(part => part.authored).join(', ');
  const isolated = rule.clone({ selector: normalizedTarget.join(', ') });
  rule.after(isolated);
  return isolated;
}

/**
 * Every rule block matching this selector within the container, in document
 * order. Real-world CSS (especially generated/exported CSS) commonly repeats
 * the same selector across separate blocks at the same specificity — e.g. a
 * px-authored block followed later by a rem-converted mirror of it. Equal
 * specificity means the LATER block wins the cascade, so reading/writing must
 * account for every match, not just the first one found.
 */
function findMatchingRules(container: Container, selector: string): Rule[] {
  return (container.nodes || []).filter(
    (node): node is Rule => node.type === 'rule' && selectorListContains(node.selector, selector),
  );
}

function parseWidthMedia(node: postcss.ChildNode): { mode: BreakpointMode; width: number } | null {
  if (node.type !== 'atrule' || (node as AtRule).name.toLowerCase() !== 'media') return null;
  // A linked stylesheet commonly spells the same screen query as
  // `screen and (max-width: 810px)`. Treat that as the registered breakpoint,
  // but reject additional predicates (`and (hover: hover)`), comma lists and
  // non-screen media types: editing those as if they were the whole viewport
  // tier broadens the authored condition and targets the wrong declaration.
  const condition = (node as AtRule).params.trim().replace(
    /^(?:only\s+)?(?:all|screen)\s+and\s+/i,
    '',
  );
  const legacy = condition.match(
    /^\(\s*(min|max)-width:\s*(\d+(?:\.\d+)?)px\s*\)$/i,
  );
  if (legacy) {
    return { mode: `${legacy[1].toLowerCase()}-width` as BreakpointMode, width: Number(legacy[2]) };
  }
  const featureFirst = condition.match(
    /^\(\s*width\s*(<=|>=)\s*(\d+(?:\.\d+)?)px\s*\)$/i,
  );
  if (featureFirst) {
    return {
      mode: featureFirst[1] === '<=' ? 'max-width' : 'min-width',
      width: Number(featureFirst[2]),
    };
  }
  const valueFirst = condition.match(
    /^\(\s*(\d+(?:\.\d+)?)px\s*(<=|>=)\s*width\s*\)$/i,
  );
  if (!valueFirst) return null;
  return {
    mode: valueFirst[2] === '>=' ? 'max-width' : 'min-width',
    width: Number(valueFirst[1]),
  };
}

interface WidthMediaInterval {
  minimum: number | null;
  maximum: number | null;
  minimumInclusive: boolean;
  maximumInclusive: boolean;
}

interface ParsedWidthMediaQuery {
  branches: WidthMediaInterval[];
}

function unconstrainedWidthMediaInterval(): WidthMediaInterval {
  return {
    minimum: null,
    maximum: null,
    minimumInclusive: true,
    maximumInclusive: true,
  };
}

function constrainMinimum(interval: WidthMediaInterval, value: number, inclusive: boolean) {
  if (interval.minimum === null || value > interval.minimum) {
    interval.minimum = value;
    interval.minimumInclusive = inclusive;
  } else if (value === interval.minimum) {
    interval.minimumInclusive = interval.minimumInclusive && inclusive;
  }
}

function constrainMaximum(interval: WidthMediaInterval, value: number, inclusive: boolean) {
  if (interval.maximum === null || value < interval.maximum) {
    interval.maximum = value;
    interval.maximumInclusive = inclusive;
  } else if (value === interval.maximum) {
    interval.maximumInclusive = interval.maximumInclusive && inclusive;
  }
}

function applyWidthComparison(
  interval: WidthMediaInterval,
  left: 'width' | number,
  operator: '<' | '<=' | '>' | '>=',
  right: 'width' | number,
) {
  if (left === 'width' && typeof right === 'number') {
    if (operator === '<' || operator === '<=') {
      constrainMaximum(interval, right, operator === '<=');
    } else {
      constrainMinimum(interval, right, operator === '>=');
    }
    return true;
  }
  if (typeof left === 'number' && right === 'width') {
    if (operator === '<' || operator === '<=') {
      constrainMinimum(interval, left, operator === '<=');
    } else {
      constrainMaximum(interval, left, operator === '>=');
    }
    return true;
  }
  return false;
}

function parseWidthMediaCondition(condition: string): WidthMediaInterval | null {
  const value = condition.trim();
  const legacy = value.match(
    /^\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i,
  );
  if (legacy) {
    const interval = unconstrainedWidthMediaInterval();
    const threshold = Number(legacy[2]);
    if (legacy[1].toLowerCase() === 'min') constrainMinimum(interval, threshold, true);
    else constrainMaximum(interval, threshold, true);
    return interval;
  }
  const exact = value.match(/^\(\s*width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i);
  if (exact) {
    const interval = unconstrainedWidthMediaInterval();
    const threshold = Number(exact[1]);
    constrainMinimum(interval, threshold, true);
    constrainMaximum(interval, threshold, true);
    return interval;
  }
  const chained = value.match(
    /^\(\s*(\d+(?:\.\d+)?)px\s*(<=|>=|<|>)\s*width\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)px\s*\)$/i,
  );
  if (chained) {
    const interval = unconstrainedWidthMediaInterval();
    if (
      !applyWidthComparison(interval, Number(chained[1]), chained[2] as '<' | '<=' | '>' | '>=', 'width')
      || !applyWidthComparison(interval, 'width', chained[3] as '<' | '<=' | '>' | '>=', Number(chained[4]))
    ) return null;
    return interval;
  }
  const featureFirst = value.match(
    /^\(\s*width\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)px\s*\)$/i,
  );
  if (featureFirst) {
    const interval = unconstrainedWidthMediaInterval();
    applyWidthComparison(
      interval,
      'width',
      featureFirst[1] as '<' | '<=' | '>' | '>=',
      Number(featureFirst[2]),
    );
    return interval;
  }
  const valueFirst = value.match(
    /^\(\s*(\d+(?:\.\d+)?)px\s*(<=|>=|<|>)\s*width\s*\)$/i,
  );
  if (valueFirst) {
    const interval = unconstrainedWidthMediaInterval();
    applyWidthComparison(
      interval,
      Number(valueFirst[1]),
      valueFirst[2] as '<' | '<=' | '>' | '>=',
      'width',
    );
    return interval;
  }
  return null;
}

/**
 * Parses width-only media query lists without broadening them. Unlike
 * parseWidthMedia, this accepts compound ranges for viewport inspection while
 * still keeping those ranges distinct from one editor-owned breakpoint tier.
 */
function parseWidthMediaQuery(node: AtRule): ParsedWidthMediaQuery | null {
  if (node.name.toLowerCase() !== 'media') return null;
  const branches: WidthMediaInterval[] = [];
  for (const authoredBranch of splitSelectorList(node.params)) {
    let branch = authoredBranch.trim();
    if (!branch || /^not\b/i.test(branch)) return null;
    branch = branch.replace(/^only\s+/i, '');
    const mediaType = branch.match(/^(all|screen|print)\b/i)?.[1]?.toLowerCase() || '';
    if (mediaType === 'print') return null;
    if (mediaType) branch = branch.slice(mediaType.length).trim();
    branch = branch.replace(/^and\s+/i, '').trim();
    const conditions = branch.match(/\([^()]*\)/g) || [];
    const residue = conditions.reduce((remaining, condition) => (
      remaining.replace(condition, '')
    ), branch).replace(/\band\b/gi, '').trim();
    if (residue || (branch && !conditions.length)) return null;
    const interval = unconstrainedWidthMediaInterval();
    for (const condition of conditions) {
      const parsed = parseWidthMediaCondition(condition);
      if (!parsed) return null;
      if (parsed.minimum !== null) {
        constrainMinimum(interval, parsed.minimum, parsed.minimumInclusive);
      }
      if (parsed.maximum !== null) {
        constrainMaximum(interval, parsed.maximum, parsed.maximumInclusive);
      }
    }
    branches.push(interval);
  }
  return branches.length ? { branches } : null;
}

function widthMediaIntervalIsActive(interval: WidthMediaInterval, viewportWidth: number) {
  if (
    interval.minimum !== null
    && (
      viewportWidth < interval.minimum
      || (viewportWidth === interval.minimum && !interval.minimumInclusive)
    )
  ) return false;
  if (
    interval.maximum !== null
    && (
      viewportWidth > interval.maximum
      || (viewportWidth === interval.maximum && !interval.maximumInclusive)
    )
  ) return false;
  return true;
}

function widthMediaQueryIsActive(query: ParsedWidthMediaQuery, viewportWidth: number) {
  return query.branches.some(branch => widthMediaIntervalIsActive(branch, viewportWidth));
}

function mediaMatchesBreakpoint(node: postcss.ChildNode, breakpoint: Breakpoint) {
  const parsed = parseWidthMedia(node);
  return Boolean(parsed && parsed.mode === breakpoint.mode && parsed.width === breakpoint.width);
}

function ancestorWidthMedia(rule: Rule) {
  const conditions: Array<{ node: AtRule; query: ParsedWidthMediaQuery }> = [];
  let parent: Container | Document | undefined = rule.parent;
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule' && (parent as AtRule).name.toLowerCase() === 'media') {
      const query = parseWidthMediaQuery(parent as AtRule);
      if (query) conditions.unshift({ node: parent as AtRule, query });
    }
    parent = parent.parent;
  }
  return conditions;
}

function supportsConditionProvenTrue(params: string) {
  // In the Builder this runs in the same browser as the canvas, so use its CSS
  // parser as the source of truth. The small fallback keeps source tooling and
  // regression tests deterministic without pretending to understand arbitrary
  // future syntax.
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      return CSS.supports(params);
    }
  } catch { /* fall through to the conservative static set */ }
  const match = params.trim().match(/^\(\s*([a-z-]+)\s*:\s*([^()]+)\s*\)$/i);
  if (!match) return false;
  const property = match[1].toLowerCase();
  const value = match[2].trim().toLowerCase().replace(/\s+/g, ' ');
  if (property === 'display') {
    return new Set([
      'none', 'contents', 'block', 'inline', 'inline-block', 'flow-root',
      'flex', 'inline-flex', 'grid', 'inline-grid', 'list-item', 'table',
    ]).has(value);
  }
  if (property === 'position') {
    return new Set(['static', 'relative', 'absolute', 'fixed', 'sticky']).has(value);
  }
  return false;
}

function hasUnsupportedConditionalAncestor(rule: Rule) {
  let parent: Container | Document | undefined = rule.parent;
  while (parent && parent.type !== 'root') {
    // Native CSS nesting changes the effective selector (`.wrapper .button`).
    // Without the selected element's ancestor chain it is unsafe to claim that
    // a nested `.button` block is the global `.button` source owner.
    if (parent.type === 'rule') return true;
    if (parent.type === 'atrule') {
      const atRule = parent as AtRule;
      const name = atRule.name.toLowerCase();
      if (name === 'media' && !parseWidthMediaQuery(atRule)) return true;
      if (name === 'supports' && !supportsConditionProvenTrue(atRule.params)) return true;
      // Layers are cascade ordering constructs, while a proven media/supports
      // ancestor remains active. Every other at-rule can alter applicability
      // (`@container`, `@scope`, `@starting-style`, keyframes, etc.).
      if (name !== 'media' && name !== 'supports' && name !== 'layer') return true;
    }
    parent = parent.parent;
  }
  return false;
}

function effectiveWidthCondition(rule: Rule) {
  const conditions = ancestorWidthMedia(rule);
  let minimum: number | null = null;
  let maximum: number | null = null;
  let minimumInclusive = true;
  let maximumInclusive = true;
  let deterministic = true;
  conditions.forEach(({ query }) => {
    if (query.branches.length !== 1) {
      deterministic = false;
      return;
    }
    const interval = query.branches[0];
    if (interval.minimum !== null) {
      if (minimum === null || interval.minimum > minimum) {
        minimum = interval.minimum;
        minimumInclusive = interval.minimumInclusive;
      } else if (interval.minimum === minimum) {
        minimumInclusive = minimumInclusive && interval.minimumInclusive;
      }
    }
    if (interval.maximum !== null) {
      if (maximum === null || interval.maximum < maximum) {
        maximum = interval.maximum;
        maximumInclusive = interval.maximumInclusive;
      } else if (interval.maximum === maximum) {
        maximumInclusive = maximumInclusive && interval.maximumInclusive;
      }
    }
  });
  return {
    conditions,
    minimum,
    maximum,
    minimumInclusive,
    maximumInclusive,
    deterministic,
  };
}

function ruleBelongsToBreakpoint(rule: Rule, breakpoint: Breakpoint | null) {
  if (hasUnsupportedConditionalAncestor(rule)) return false;
  const effective = effectiveWidthCondition(rule);
  if (!breakpoint) return effective.conditions.length === 0;
  if (!effective.deterministic) return false;
  // Nested conditions belong to a tier only when their mathematical
  // intersection is exactly that tier. max-810 + max-410 is mobile, never
  // tablet; a min/max interval is not equivalent to either one-sided tier.
  if (breakpoint.mode === 'max-width') {
    return effective.minimum === null
      && effective.maximum === breakpoint.width
      && effective.maximumInclusive;
  }
  return effective.maximum === null
    && effective.minimum === breakpoint.width
    && effective.minimumInclusive;
}

function findMatchingRulesInContext(
  root: postcss.Root,
  selector: string,
  breakpoint: Breakpoint | null,
) {
  const matches: Rule[] = [];
  root.walkRules(rule => {
    if (
      ruleBelongsToBreakpoint(rule, breakpoint)
      && selectorListContains(rule.selector, selector)
    ) matches.push(rule);
  });
  return matches;
}

/** Every same-selector rule that is active at one concrete canvas width. */
function findMatchingRulesAtViewport(
  root: postcss.Root,
  selector: string,
  viewportWidth: number,
) {
  const matches: Rule[] = [];
  root.walkRules(rule => {
    if (
      hasUnsupportedConditionalAncestor(rule)
      || !selectorListContains(rule.selector, selector)
    ) return;
    const conditions = ancestorWidthMedia(rule);
    if (conditions.every(({ query }) => widthMediaQueryIsActive(query, viewportWidth))) {
      matches.push(rule);
    }
  });
  return matches;
}

/**
 * A stylesheet can contain repeated, equivalently formatted media wrappers.
 * They all participate in the cascade and therefore all need to be read and
 * cleared together; choosing only the first wrapper makes later code silently
 * override a visual edit.
 */
function getRuleContainers(
  root: postcss.Root,
  breakpoint: Breakpoint | null,
  create: boolean,
): Container[] {
  if (!breakpoint) return [root];
  const media = root.nodes.filter(
    (node): node is AtRule => node.type === 'atrule'
      && (node as AtRule).name.toLowerCase() === 'media'
      && mediaMatchesBreakpoint(node, breakpoint),
  );
  if (media.length || !create) return media;
  const created = postcss.atRule({ name: 'media', params: breakpointParams(breakpoint) });
  root.append(created);
  return [created];
}

/**
 * Creates only the requested rule without moving existing CSS.
 *
 * A new unscoped rule belongs before the first authored media block. Appending
 * it after media queries would make an equal-specificity base declaration
 * silently defeat responsive overrides. Existing rules stay exactly where
 * the author put them; scoped rules are appended inside their own wrapper.
 */
function createRuleInContext(
  root: postcss.Root,
  containers: Container[],
  selector: string,
) {
  const targetContainer = containers.at(-1)!;
  const created = postcss.rule({ selector });
  if (targetContainer !== root) {
    const firstNestedMedia = targetContainer.nodes?.find(
      node => node.type === 'atrule' && (node as AtRule).name.toLowerCase() === 'media',
    );
    if (firstNestedMedia) firstNestedMedia.before(created);
    else targetContainer.append(created);
    return created;
  }
  const firstMedia = root.nodes.find(
    node => node.type === 'atrule' && (node as AtRule).name.toLowerCase() === 'media',
  );
  if (firstMedia) firstMedia.before(created);
  else root.append(created);
  return created;
}

/**
 * Creates an unlayered breakpoint rule at the terminal cascade position.
 *
 * This is used only when a declaration from a broader/base tier currently wins
 * at the selected responsive canvas. Updating an earlier exact media block
 * would save valid CSS while leaving the visible result unchanged.
 */
function createTerminalResponsiveRule(
  root: postcss.Root,
  breakpoint: Breakpoint,
  selector: string,
  container: Container = root,
  afterRule?: Rule,
) {
  let anchor: ChildNode | null = afterRule || null;
  while (anchor?.parent && anchor.parent !== container) {
    if (anchor.parent.type === 'root' || anchor.parent.type === 'document') {
      anchor = null;
      break;
    }
    anchor = anchor.parent as ChildNode;
  }
  if (anchor?.parent !== container) anchor = null;
  const nextNode = anchor?.next();
  const lastNode = container.nodes?.at(-1);
  const reusable = nextNode?.type === 'atrule'
    && (nextNode as AtRule).name.toLowerCase() === 'media'
    && mediaMatchesBreakpoint(nextNode, breakpoint)
    ? nextNode as AtRule
    : !anchor
      && lastNode?.type === 'atrule'
      && (lastNode as AtRule).name.toLowerCase() === 'media'
      && mediaMatchesBreakpoint(lastNode, breakpoint)
      ? lastNode as AtRule
      : null;
  const media = reusable
    || postcss.atRule({ name: 'media', params: breakpointParams(breakpoint) });
  if (media.parent !== container) {
    // Put the repair immediately after the rule that wins on this canvas.
    // Appending at EOF can jump over a later, narrower child breakpoint and
    // make a Notebook edit unexpectedly replace an explicit Mobile override.
    if (anchor) anchor.after(media);
    else container.append(media);
  }
  const existing = findMatchingRules(media, selector).at(-1);
  if (existing) return isolateSelectorFromGroup(existing, selector);
  const created = postcss.rule({ selector });
  media.append(created);
  return created;
}

interface LayerTreeNode {
  segment: string;
  fullName: string;
  children: LayerTreeNode[];
  childrenBySegment: Map<string, LayerTreeNode>;
}

interface CssLayerRegistry {
  root: LayerTreeNode;
  atRulePath: WeakMap<AtRule, string[]>;
  /** Named/anonymous layers in the order this stylesheet establishes them. */
  orderedNames: string[];
}

function createLayerNode(segment: string, fullName: string): LayerTreeNode {
  return { segment, fullName, children: [], childrenBySegment: new Map() };
}

function nearestLayerPath(node: AtRule, paths: WeakMap<AtRule, string[]>) {
  let parent: Container | Document | undefined = node.parent;
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule') {
      const path = paths.get(parent as AtRule);
      if (path) return path;
    }
    parent = parent.parent;
  }
  return [];
}

function layerNameSegments(value: string) {
  return value.split('.').map(segment => segment.trim()).filter(Boolean);
}

function conditionalAncestorsProvenActive(node: AtRule, viewportWidth: number) {
  let parent: Container | Document | undefined = node.parent;
  while (parent && parent.type !== 'root') {
    // Element-sensitive contexts still establish a global layer slot even
    // when their declarations do not match the selected element. The cascade
    // specification requires those names to be accommodated in layer order.
    if (parent.type === 'rule') {
      parent = parent.parent;
      continue;
    }
    if (parent.type === 'atrule') {
      const atRule = parent as AtRule;
      const name = atRule.name.toLowerCase();
      if (name === 'layer') {
        parent = parent.parent;
        continue;
      }
      if (name === 'container' || name === 'scope') {
        parent = parent.parent;
        continue;
      }
      if (name === 'supports') {
        if (!supportsConditionProvenTrue(atRule.params)) return false;
        parent = parent.parent;
        continue;
      }
      if (name === 'media') {
        const query = parseWidthMediaQuery(atRule);
        if (query) {
          if (!widthMediaQueryIsActive(query, viewportWidth)) return false;
          parent = parent.parent;
          continue;
        }
        try {
          if (typeof matchMedia !== 'undefined' && matchMedia(atRule.params).matches) {
            parent = parent.parent;
            continue;
          }
        } catch { /* an unprovable media query is inactive for source ownership */ }
      }
      return false;
    }
    parent = parent.parent;
  }
  return true;
}

function buildCssLayerRegistry(
  root: postcss.Root,
  viewportWidth = DEFAULT_PRIMARY_BREAKPOINT.width,
): CssLayerRegistry {
  const registry: CssLayerRegistry = {
    root: createLayerNode('', ''),
    atRulePath: new WeakMap(),
    orderedNames: [],
  };
  let anonymousIndex = 0;
  const ensurePath = (segments: string[]) => {
    let node = registry.root;
    const established: string[] = [];
    segments.forEach(segment => {
      established.push(segment);
      let child = node.childrenBySegment.get(segment);
      if (!child) {
        child = createLayerNode(segment, established.join('.'));
        node.childrenBySegment.set(segment, child);
        node.children.push(child);
        registry.orderedNames.push(child.fullName);
      }
      node = child;
    });
  };

  root.walkAtRules(atRule => {
    if (atRule.name.toLowerCase() !== 'layer') return;
    if (!conditionalAncestorsProvenActive(atRule, viewportWidth)) return;
    const parentPath = nearestLayerPath(atRule, registry.atRulePath);
    const declared = atRule.params.trim()
      ? splitSelectorList(atRule.params).map(name => layerNameSegments(name)).filter(parts => parts.length)
      : atRule.nodes
        ? [[`#anonymous-${++anonymousIndex}`]]
        : [];
    declared.forEach(parts => ensurePath([...parentPath, ...parts]));
    // A block establishes one layer. Multiple comma-separated names are valid
    // for order statements only; keep the first defensively if malformed CSS
    // supplies a block so descendants still receive a stable context.
    if (atRule.nodes && declared[0]) {
      registry.atRulePath.set(atRule, [...parentPath, ...declared[0]]);
    }
  });
  return registry;
}

function ruleLayerPath(rule: Rule, registry: CssLayerRegistry) {
  let parent: Container | Document | undefined = rule.parent;
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule') {
      const path = registry.atRulePath.get(parent as AtRule);
      if (path) return path;
    }
    parent = parent.parent;
  }
  return [];
}

function layerRank(path: string[], registry: CssLayerRegistry) {
  const rank: number[] = [];
  let node = registry.root;
  for (const segment of path) {
    const index = node.children.findIndex(child => child.segment === segment);
    if (index < 0) break;
    rank.push(index);
    node = node.children[index];
  }
  // Declarations directly in a layer behave like its final anonymous
  // sublayer: normal declarations beat nested sublayers, important declarations
  // reverse that order. The same sentinel represents unlayered root styles.
  rank.push(node.children.length);
  return rank;
}

function compareLayerRank(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

interface CascadedDeclaration {
  value: string;
  important: boolean;
}

export interface CssRuleDeclarationDetail {
  value: string;
  important: boolean;
}

export interface CssRulePropertyOwner {
  property: string;
  value: string;
  important: boolean;
  /** Full nested layer name; null means the unlayered author tier. */
  cascadeLayer: string | null;
  cascadeLayerPath: string[];
  /** Stable declaration order among matching blocks in this parsed source. */
  sourceOrder: number;
}

export interface CssDisplayRestoreState {
  previousValue: string | null;
  previousImportant: boolean;
  fallbackDisplay: string;
  /** Source binding inherited before a new breakpoint override was added. */
  inheritedValue?: string;
  hiddenImportant: boolean;
}

const DISPLAY_RESTORE_MARKER = 'kodety-display-restore:';

function displayRestoreComment(declaration: Declaration) {
  const previous = declaration.prev();
  return previous?.type === 'comment' && previous.text.startsWith(DISPLAY_RESTORE_MARKER) ? previous : null;
}

function readDisplayRestoreState(declaration: Declaration): CssDisplayRestoreState | null {
  const marker = displayRestoreComment(declaration);
  if (!marker || normalizeStylePropertyName(declaration.prop) !== 'display' || declaration.value.trim().toLowerCase() !== 'none') return null;
  try {
    const state = JSON.parse(decodeURIComponent(marker.text.slice(DISPLAY_RESTORE_MARKER.length)));
    if (state.version !== 1 || typeof state.previousImportant !== 'boolean' || typeof state.hiddenImportant !== 'boolean'
      || state.hiddenImportant !== Boolean(declaration.important)
      || typeof state.fallbackDisplay !== 'string' || !state.fallbackDisplay || /[;{}]/.test(state.fallbackDisplay)
      || (state.inheritedValue !== undefined && (typeof state.inheritedValue !== 'string' || state.inheritedValue.length > 2048 || /[;{}]/.test(state.inheritedValue)))
      || (state.previousValue !== null && (typeof state.previousValue !== 'string' || state.previousValue.length > 2048 || /[;{}]/.test(state.previousValue)))) return null;
    return state;
  } catch { return null; }
}

function displayOwnerForVisibility(
  root: ReturnType<typeof parseCssForAuthoring>,
  context: CssEditingContext,
  breakpoints: Breakpoint[],
  options: Parameters<typeof patchCssDeclaration>[5],
  editing = false,
) {
  const selector = selectorWithState(context.selector, context.pseudo);
  const breakpoint = resolveBreakpoint(context.breakpoint, breakpoints);
  const width = Number.isFinite(options?.viewportWidth) ? Number(options?.viewportWidth) : breakpoint?.width;
  const layers = buildCssLayerRegistry(root, width);
  const properties = conflictingStyleProperties('display');
  const activeWinner = width === undefined ? null : winningLocatedDeclaration(findMatchingRulesAtViewport(root, selector, width), properties, layers);
  if (!editing && activeWinner) return activeWinner;
  if (editing && breakpoint && activeWinner && !ruleBelongsToBreakpoint(activeWinner.rule, breakpoint)) return null;
  if (editing && !breakpoint && options?.editActiveWinner && activeWinner) return activeWinner;
  return winningLocatedDeclaration(findMatchingRulesInContext(root, selector, breakpoint), properties, layers);
}

/** Read the source-bound display snapshot without inserting nodes into the DOM. */
export function readCssDisplayRestoreState(
  source: string,
  context: CssEditingContext,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
  viewportWidth?: number,
): CssDisplayRestoreState | null {
  try {
    const owner = displayOwnerForVisibility(parseCssForInspection(source), context, breakpoints, { viewportWidth });
    return owner ? readDisplayRestoreState(owner.declaration) : null;
  } catch { return null; }
}

/** Toggle display while retaining the exact authored value or inherited absence. */
export function patchCssDisplayVisibility(
  source: string,
  context: CssEditingContext,
  visible: boolean,
  fallbackDisplay: string,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
  options: Parameters<typeof patchCssDeclaration>[5] & { computedDisplay?: string } = {},
): { source: string; display: string } {
  const effectivelyHidden = options.computedDisplay?.trim().toLowerCase() === 'none';
  // The selected No segment remains clickable. An already hidden variable
  // must not become a "previously visible" snapshot that Show would restore.
  if (!visible && effectivelyHidden) return { source, display: 'none' };
  let root = parseCssForAuthoring(source);
  const selector = selectorWithState(context.selector, context.pseudo);
  const owner = displayOwnerForVisibility(root, context, breakpoints, options);
  const editableOwner = displayOwnerForVisibility(root, context, breakpoints, options, true);
  const ownsSnapshot = owner?.declaration === editableOwner?.declaration;
  const state = owner ? readDisplayRestoreState(owner.declaration) : null;
  const fallback = fallbackDisplay && fallbackDisplay !== 'none' && !/[;{}]/.test(fallbackDisplay) ? fallbackDisplay : 'block';
  const writeDisplay = (value: string) => patchCssDeclaration(
    root.toString(), context, 'display', value, breakpoints,
    // Derive priority only from the active author declaration. A child tier
    // must override it locally without weakening its parent's hidden state.
    { ...options, preserveDisplayPriority: true },
  );
  if (visible && owner && state && ownsSnapshot) {
    const isolated = isolateLocatedDeclaration(owner, selector);
    displayRestoreComment(isolated.declaration)?.remove();
    if (state.previousValue === null) isolated.declaration.remove();
    else {
      isolated.declaration.value = state.previousValue;
      isolated.declaration.important = state.previousImportant;
    }
    let emptyParent = isolated.rule.parent;
    if (!isolated.rule.nodes.length) isolated.rule.remove();
    else emptyParent = undefined;
    while (emptyParent?.type === 'atrule' && !emptyParent.nodes?.length) {
      const ancestor = emptyParent.parent;
      emptyParent.remove();
      emptyParent = ancestor;
    }
    return { source: root.toString(), display: state.previousValue || '' };
  }
  // A manual display edit invalidates the snapshot. Never restore stale code
  // merely because a nearby private comment survived the user's edit.
  if (owner && ownsSnapshot && displayRestoreComment(owner.declaration) && !state) {
    const isolated = isolateLocatedDeclaration(owner, selector);
    displayRestoreComment(isolated.declaration)?.remove();
  }
  if (owner?.declaration.prop.toLowerCase() === 'display') {
    const current = owner.declaration.value.trim();
    if ((!visible && current === 'none') || (visible && current !== 'none' && !effectivelyHidden)) return { source: root.toString(), display: current };
  }
  if (visible) {
    const display = state?.previousValue || state?.inheritedValue || state?.fallbackDisplay || fallback;
    return { source: writeDisplay(display), display };
  }
  const previous = displayOwnerForVisibility(root, context, breakpoints, options, true);
  const previousValue = previous && normalizeStylePropertyName(previous.declaration.prop) === 'display' ? previous.declaration.value : null;
  const previousImportant = Boolean(previousValue !== null && previous?.declaration.important);
  const inheritedValue = previousValue === null && owner && normalizeStylePropertyName(owner.declaration.prop) === 'display'
    ? owner.declaration.value : undefined;
  root = parseCssForAuthoring(writeDisplay('none'));
  const hiddenOwner = displayOwnerForVisibility(root, context, breakpoints, options, true);
  if (!hiddenOwner || normalizeStylePropertyName(hiddenOwner.declaration.prop) !== 'display' || hiddenOwner.declaration.value.trim() !== 'none') throw new Error('Não foi possível preservar o display anterior.');
  const marker = { version: 1, previousValue, previousImportant, fallbackDisplay: fallback, ...(inheritedValue ? { inheritedValue } : {}), hiddenImportant: Boolean(hiddenOwner.declaration.important) };
  hiddenOwner.declaration.before(postcss.comment({ text: DISPLAY_RESTORE_MARKER + encodeURIComponent(JSON.stringify(marker)) }));
  return { source: root.toString(), display: 'none' };
}

export interface CssRuleInspection {
  hasRule: boolean;
  declarations: Record<string, CssRuleDeclarationDetail>;
  /** Layer names established by this source, in cascade order. */
  cascadeLayers: string[];
  /** The declaration currently governing `property`, including a shorthand/all. */
  propertyOwner?: CssRulePropertyOwner;
}

export interface CssViewportRuleInspection extends CssRuleInspection {
  /** Whether this selector also has a rule authored in the requested exact tier. */
  hasExactRule: boolean;
  /** Whether the active property owner belongs to that exact tier. */
  propertyOwnerBelongsToBreakpoint: boolean;
}

export interface CssRuleDeclarationsInspection extends CssRuleInspection {
  /** Winner for every declaration exposed above, resolved in this same parse. */
  propertyOwners: Record<string, CssRulePropertyOwner>;
}

export interface CssViewportRuleDeclarationsInspection extends CssRuleDeclarationsInspection {
  /** Whether this selector also has a rule authored in the requested exact tier. */
  hasExactRule: boolean;
  /** Declarations authored in that exact tier, kept separate from viewport winners. */
  exactDeclarations: Record<string, CssRuleDeclarationDetail>;
  /** Exact-tier owner for every declaration exposed above. */
  exactPropertyOwners: Record<string, CssRulePropertyOwner>;
}

const viewportPropertyOwnerReaders = new WeakMap<CssViewportRuleDeclarationsInspection, {
  active: (property: string) => CssRulePropertyOwner | undefined;
  exact: (property: string) => CssRulePropertyOwner | undefined;
}>();

/** Resolve another property from this inspection's already matched rules. */
export function readCssViewportPropertyOwner(
  inspection: CssViewportRuleDeclarationsInspection,
  property: string,
  exact = false,
) {
  const name = normalizeStylePropertyName(property);
  const owners = exact ? inspection.exactPropertyOwners : inspection.propertyOwners;
  if (owners[name]) return owners[name];
  const reader = viewportPropertyOwnerReaders.get(inspection);
  return reader ? (exact ? reader.exact(name) : reader.active(name)) : undefined;
}

interface LocatedDeclaration {
  declaration: Declaration;
  rule: Rule;
  layerPath: string[];
  layerRank: number[];
  sourceOrder: number;
}

function winningLocatedDeclaration(
  rules: Rule[],
  properties: Set<string>,
  layers: CssLayerRegistry,
): LocatedDeclaration | null {
  let winner: LocatedDeclaration | null = null;
  let sourceOrder = 0;
  rules.forEach(rule => {
    rule.nodes.forEach(node => {
      const declarationOrder = sourceOrder++;
      if (node.type !== 'decl' || !properties.has(normalizeStylePropertyName(node.prop))) return;
      const declaration = node as Declaration;
      const path = ruleLayerPath(rule, layers);
      const candidate: LocatedDeclaration = {
        declaration,
        rule,
        layerPath: path,
        layerRank: layerRank(path, layers),
        sourceOrder: declarationOrder,
      };
      if (!winner) {
        winner = candidate;
        return;
      }
      const candidateImportant = Boolean(declaration.important);
      const winnerImportant = Boolean(winner.declaration.important);
      if (candidateImportant !== winnerImportant) {
        if (candidateImportant) winner = candidate;
        return;
      }
      const rankDifference = compareLayerRank(candidate.layerRank, winner.layerRank);
      // Normal layer precedence follows declaration order and leaves
      // unlayered styles last. Important precedence is exactly reversed.
      const candidateLayerWins = candidateImportant
        ? rankDifference < 0
        : rankDifference > 0;
      if (candidateLayerWins || (!rankDifference && candidate.sourceOrder >= winner.sourceOrder)) {
        winner = candidate;
      }
    });
  });
  return winner;
}

function propertyOwnerFromLocated(winner: LocatedDeclaration): CssRulePropertyOwner {
  return {
    property: normalizeStylePropertyName(winner.declaration.prop),
    value: winner.declaration.value,
    important: Boolean(winner.declaration.important),
    cascadeLayer: winner.layerPath.length ? winner.layerPath.join('.') : null,
    cascadeLayerPath: winner.layerPath,
    sourceOrder: winner.sourceOrder,
  };
}

function isolateLocatedDeclaration(winner: LocatedDeclaration, selector: string) {
  const declarationIndex = winner.rule.nodes.indexOf(winner.declaration);
  const rule = isolateSelectorFromGroup(winner.rule, selector);
  return { ...winner, rule, declaration: rule.nodes[declarationIndex] as Declaration };
}

function gapShorthandWithEditedAxis(shorthand: string, property: string, value: string) {
  if (property !== 'row-gap' && property !== 'column-gap') return null;
  const cssWide = /^(?:initial|inherit|unset|revert|revert-layer)$/i;
  if (cssWide.test(value)) return null;
  const nodes = valueParser(shorthand).nodes.filter(node => node.type !== 'space');
  // A top-level variable may expand to either one or two axes. In that case
  // retain its binding and derive one longhand instead of guessing its arity.
  if (!nodes.length || nodes.length > 2 || nodes.some(node => (
    node.type === 'comment' || node.type === 'div'
    || (node.type === 'word' && cssWide.test(node.value))
    || (node.type === 'function' && node.value.toLowerCase() === 'var')
  ))) return null;
  const values = nodes.map(node => valueParser.stringify(node));
  const row = property === 'row-gap' ? value : values[0];
  const column = property === 'column-gap' ? value : values[1] || values[0];
  return `${row} ${column}`;
}

function cascadedRuleDeclarations(rules: Rule[], layers: CssLayerRegistry) {
  const properties = new Set<string>();
  rules.forEach(rule => rule.nodes.forEach(node => {
    if (node.type === 'decl') properties.add(normalizeStylePropertyName((node as Declaration).prop));
  }));
  const result: Record<string, CascadedDeclaration> = {};
  properties.forEach(property => {
    const winner = winningLocatedDeclaration(rules, new Set([property]), layers);
    if (!winner) return;
    result[property] = {
      value: winner.declaration.value,
      important: Boolean(winner.declaration.important),
    };
  });
  return result;
}

function declarationValues(cascade: Record<string, CascadedDeclaration>) {
  return Object.fromEntries(
    Object.entries(cascade).map(([property, declaration]) => [property, declaration.value]),
  );
}

/**
 * Reports the exact authored rule/declaration tier for one selector context.
 * This is intentionally source-oriented (not computed-style-oriented): callers
 * use it to keep a class edit in the CSS file that already owns that class.
 */
function inspectCssRuleSource(
  source: string,
  context: CssEditingContext,
  property: string,
  breakpoints: Breakpoint[],
  includeAllPropertyOwners: boolean,
): CssRuleInspection | CssRuleDeclarationsInspection {
  try {
    const root = parseCssForInspection(source);
    const selector = selectorWithState(context.selector, context.pseudo);
    const breakpoint = resolveBreakpoint(context.breakpoint, breakpoints);
    const layers = buildCssLayerRegistry(root, breakpoint?.width);
    const rules = findMatchingRulesInContext(root, selector, breakpoint);
    if (!rules.length) {
      return {
        hasRule: false,
        declarations: {},
        cascadeLayers: layers.orderedNames,
        ...(includeAllPropertyOwners ? { propertyOwners: {} } : {}),
      };
    }
    const declarations = cascadedRuleDeclarations(rules, layers);
    const normalizedProperty = normalizeStylePropertyName(property);
    const propertyOwners: Record<string, CssRulePropertyOwner> = {};
    const properties = includeAllPropertyOwners
      ? Object.keys(declarations)
      : normalizedProperty
        ? [normalizedProperty]
        : [];
    properties.forEach(candidateProperty => {
      const winner = winningLocatedDeclaration(
        rules,
        conflictingStyleProperties(candidateProperty),
        layers,
      );
      if (!winner) return;
      propertyOwners[candidateProperty] = propertyOwnerFromLocated(winner);
    });
    const owner = normalizedProperty ? propertyOwners[normalizedProperty] : undefined;
    return {
      hasRule: true,
      declarations,
      cascadeLayers: layers.orderedNames,
      ...(includeAllPropertyOwners ? { propertyOwners } : {}),
      ...(owner ? { propertyOwner: owner } : {}),
    };
  } catch {
    return {
      hasRule: false,
      declarations: {},
      cascadeLayers: [],
      ...(includeAllPropertyOwners ? { propertyOwners: {} } : {}),
    };
  }
}

export function inspectCssRule(
  source: string,
  context: CssEditingContext,
  property = '',
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
): CssRuleInspection {
  return inspectCssRuleSource(source, context, property, breakpoints, false);
}

/** Inspect every authored declaration owner in one PostCSS parse. This is the
 * Inspector read path only; patch functions continue parsing their latest
 * source independently before every write. */
export function inspectCssRuleDeclarations(
  source: string,
  context: CssEditingContext,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
): CssRuleDeclarationsInspection {
  return inspectCssRuleSource(source, context, '', breakpoints, true) as CssRuleDeclarationsInspection;
}

/**
 * Inspects every declaration that wins at a concrete viewport and, from the
 * same parsed source, keeps the exact authored breakpoint tier available for
 * Inspector "own"/inherited markers.
 */
export function inspectCssRuleDeclarationsAtViewport(
  source: string,
  context: CssEditingContext,
  viewportWidth: number,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
): CssViewportRuleDeclarationsInspection {
  try {
    const root = parseCssForInspection(source);
    const selector = selectorWithState(context.selector, context.pseudo);
    const breakpoint = resolveBreakpoint(context.breakpoint, breakpoints);
    const width = Number.isFinite(viewportWidth)
      ? Math.max(0, viewportWidth)
      : breakpoint?.width ?? DEFAULT_PRIMARY_BREAKPOINT.width;
    const layers = buildCssLayerRegistry(root, width);
    const rules = findMatchingRulesAtViewport(root, selector, width);
    const exactRules = findMatchingRulesInContext(root, selector, breakpoint);
    const declarations = cascadedRuleDeclarations(rules, layers);
    const exactDeclarations = cascadedRuleDeclarations(exactRules, layers);
    const ownersFor = (
      matchingRules: Rule[],
      values: Record<string, CssRuleDeclarationDetail>,
    ) => Object.fromEntries(
      Object.keys(values).flatMap(property => {
        const winner = winningLocatedDeclaration(
          matchingRules,
          conflictingStyleProperties(property),
          layers,
        );
        return winner ? [[property, propertyOwnerFromLocated(winner)]] : [];
      }),
    );
    const result: CssViewportRuleDeclarationsInspection = {
      hasRule: Boolean(rules.length),
      hasExactRule: Boolean(exactRules.length),
      declarations,
      exactDeclarations,
      cascadeLayers: layers.orderedNames,
      propertyOwners: ownersFor(rules, declarations),
      exactPropertyOwners: ownersFor(exactRules, exactDeclarations),
    };
    const ownerReader = (matchingRules: Rule[]) => (property: string) => {
      const winner = winningLocatedDeclaration(matchingRules, conflictingStyleProperties(property), layers);
      return winner ? propertyOwnerFromLocated(winner) : undefined;
    };
    viewportPropertyOwnerReaders.set(result, { active: ownerReader(rules), exact: ownerReader(exactRules) });
    return result;
  } catch {
    return {
      hasRule: false,
      hasExactRule: false,
      declarations: {},
      exactDeclarations: {},
      cascadeLayers: [],
      propertyOwners: {},
      exactPropertyOwners: {},
    };
  }
}

/**
 * Inspects the real same-selector cascade at a concrete viewport, including
 * base rules and every overlapping width query active there.
 */
export function inspectCssRuleAtViewport(
  source: string,
  context: CssEditingContext,
  property: string,
  viewportWidth: number,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
): CssViewportRuleInspection {
  try {
    const root = parseCssForInspection(source);
    const selector = selectorWithState(context.selector, context.pseudo);
    const breakpoint = resolveBreakpoint(context.breakpoint, breakpoints);
    const width = Number.isFinite(viewportWidth)
      ? Math.max(0, viewportWidth)
      : breakpoint?.width ?? DEFAULT_PRIMARY_BREAKPOINT.width;
    const layers = buildCssLayerRegistry(root, width);
    const rules = findMatchingRulesAtViewport(root, selector, width);
    const exactRules = findMatchingRulesInContext(root, selector, breakpoint);
    const normalizedProperty = normalizeStylePropertyName(property);
    const winner = normalizedProperty
      ? winningLocatedDeclaration(rules, conflictingStyleProperties(normalizedProperty), layers)
      : null;
    return {
      hasRule: Boolean(rules.length),
      hasExactRule: Boolean(exactRules.length),
      declarations: cascadedRuleDeclarations(rules, layers),
      cascadeLayers: layers.orderedNames,
      propertyOwnerBelongsToBreakpoint: Boolean(
        winner && ruleBelongsToBreakpoint(winner.rule, breakpoint),
      ),
      ...(winner ? { propertyOwner: propertyOwnerFromLocated(winner) } : {}),
    };
  } catch {
    return {
      hasRule: false,
      hasExactRule: false,
      declarations: {},
      cascadeLayers: [],
      propertyOwnerBelongsToBreakpoint: false,
    };
  }
}

export function patchCssDeclaration(
  source: string,
  context: CssEditingContext,
  property: string,
  value: string,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
  options: {
    /**
     * @deprecated Visual authoring never creates priority. Kept only so older
     * callers remain source-compatible while their migration path is removed.
     */
    preservePriority?: boolean;
    /** Locale page overlays may mirror an already-winning authored priority.
     * The selector guard check below prevents this from becoming a generic
     * visual-authoring escape hatch. */
    localizedPriority?: boolean;
    /** Visibility may copy only the existing winning display priority into
     * its breakpoint override; it must never weaken an inherited rule. */
    preserveDisplayPriority?: boolean;
    /**
     * Remove conflicting declarations and collapse duplicate declarations for
     * a panel/canvas command without changing authored selector specificity.
     */
    authoritative?: boolean;
    /** Concrete canvas width used to resolve overlapping authored media tiers. */
    viewportWidth?: number;
    /**
     * Edit the declaration which actually wins at viewportWidth even when the
     * authoring context is Primary/base. Child breakpoint edits intentionally
     * keep creating/updating their own scoped override instead.
     */
    editActiveWinner?: boolean;
  } = {},
) {
  const root = parseCssForAuthoring(source);
  // A visual edit owns only the requested declaration. Removing priorities
  // from unrelated rules changes the authored cascade and can break layout or
  // animation state merely because one control was adjusted in the Builder.
  const cleanValue = stripImportantPriority(value).trim();
  const localizedRequestedPriority = Boolean(
    options.localizedPriority
    && /(?:data-kodety-l10n-id|__kodety_l10n_specificity)/.test(context.selector)
    && /\s*!\s*important\s*$/i.test(value),
  );
  const authoritative = Boolean(options.authoritative);
  const selector = selectorWithState(context.selector, context.pseudo);
  const breakpoint = resolveBreakpoint(context.breakpoint, breakpoints);
  const viewportWidth = Number.isFinite(options.viewportWidth)
    ? Math.max(0, Number(options.viewportWidth))
    : breakpoint?.width;
  const layers = buildCssLayerRegistry(root, viewportWidth);
  const containers = getRuleContainers(root, breakpoint, Boolean(cleanValue));
  const propLower = normalizeStylePropertyName(property);
  const conflictingProperties = authoritative
    ? conflictingStyleProperties(propLower)
    : new Set([propLower]);
  // Retire only the old generated authority marker. Ordinary grouped source
  // rules stay intact until a declaration inside that rule is actually edited.
  findMatchingRulesInContext(root, selector, breakpoint).forEach(rule => {
    if (withoutAuthorityGuard(rule.selector) !== rule.selector) isolateSelectorFromGroup(rule, selector);
  });
  const activeRules = viewportWidth !== undefined
    ? findMatchingRulesAtViewport(root, selector, viewportWidth)
    : [];
  let activeWinner = viewportWidth !== undefined
    ? winningLocatedDeclaration(activeRules, conflictingProperties, layers)
    : null;
  const requestedPriority = localizedRequestedPriority || Boolean(
    options.preserveDisplayPriority && propLower === 'display' && activeWinner?.declaration.important,
  );
  const editActiveWinner = Boolean(
    options.editActiveWinner
    && !breakpoint
    && activeWinner
    && !ruleBelongsToBreakpoint(activeWinner.rule, breakpoint),
  );
  const matches = findMatchingRulesInContext(root, selector, breakpoint)
    .map(rule => ({ container: rule.parent || root, rule }));

  if (!matches.length && !cleanValue && !editActiveWinner) return root.toString();

  if (!cleanValue) {
    // Clearing a class property removes that exact authored declaration from
    // every duplicate block, but leaves shorthands and sibling longhands
    // intact. They are separate source decisions and may legitimately become
    // visible again once the explicit override is removed.
    matches.forEach(({ rule: matchedRule }) => {
      if (!matchedRule.nodes.some(node => node.type === 'decl' && normalizeStylePropertyName(node.prop) === propLower)) return;
      const rule = isolateSelectorFromGroup(matchedRule, selector);
      rule.nodes
        .filter(
          (node): node is Declaration => node.type === 'decl'
            && normalizeStylePropertyName(node.prop) === propLower,
        )
        .forEach(declaration => declaration.remove());
      if (!rule.nodes.length) rule.remove();
    });
    const removableActiveWinner = editActiveWinner
      && activeWinner && normalizeStylePropertyName(activeWinner.declaration.prop) === propLower
      ? activeWinner
      : null;
    if (
      removableActiveWinner
      && !matches.some(({ rule }) => rule === removableActiveWinner.rule)
    ) {
      const isolated = isolateLocatedDeclaration(removableActiveWinner, selector);
      isolated.declaration.remove();
      if (!isolated.rule.nodes.length) {
        isolated.rule.remove();
      }
    }
  } else {
    let rules = matches.map(({ rule }) => rule);
    let winner = editActiveWinner
      ? activeWinner
      : winningLocatedDeclaration(rules, conflictingProperties, layers);
    let exactWinner = winner && normalizeStylePropertyName(winner.declaration.prop) === propLower
      ? winner.declaration
      : null;
    let requiresTerminalResponsiveOverride = Boolean(
      breakpoint
      && activeWinner
      && !ruleBelongsToBreakpoint(activeWinner.rule, breakpoint),
    );
    const preservesAuthoredShorthandPriority = Boolean(
      !requiresTerminalResponsiveOverride
      && winner?.declaration.important
      && isStyleShorthandFor(winner.declaration.prop, propLower),
    );

    if (!preservesAuthoredShorthandPriority && (requiresTerminalResponsiveOverride || !exactWinner)) {
      // Ordinary authoring writes normal priority. If an active same-selector
      // declaration would block it solely through !important, consume that
      // legacy priority in place. A localized migration deliberately retains
      // priority, so its shorthand/longhand blockers must remain untouched.
      // Grouped rules are isolated first so sibling selectors keep their
      // authored cascade untouched.
      if (!requestedPriority) {
        const priorityConflicts = conflictingStyleProperties(propLower);
        const blockers = viewportWidth !== undefined
          ? findMatchingRulesAtViewport(root, selector, viewportWidth)
          : findMatchingRulesInContext(root, selector, breakpoint);
        blockers.forEach(rule => {
          const hasPriorityBlocker = rule.nodes.some(node => (
            node.type === 'decl'
            && (node as Declaration).important
            && priorityConflicts.has(normalizeStylePropertyName((node as Declaration).prop))
          ));
          if (!hasPriorityBlocker) return;
          const isolated = isolateSelectorFromGroup(rule, selector);
          isolated.nodes.forEach(node => {
            if (
              node.type === 'decl'
              && (node as Declaration).important
              && priorityConflicts.has(normalizeStylePropertyName((node as Declaration).prop))
            ) (node as Declaration).important = false;
          });
        });
      }
      rules = findMatchingRulesInContext(root, selector, breakpoint);
      activeWinner = viewportWidth !== undefined
        ? winningLocatedDeclaration(
            findMatchingRulesAtViewport(root, selector, viewportWidth),
            conflictingProperties,
            layers,
          )
        : null;
      winner = editActiveWinner
        ? activeWinner
        : winningLocatedDeclaration(rules, conflictingProperties, layers);
      exactWinner = winner && normalizeStylePropertyName(winner.declaration.prop) === propLower
        ? winner.declaration
        : null;
      requiresTerminalResponsiveOverride = Boolean(
        breakpoint
        && activeWinner
        && !ruleBelongsToBreakpoint(activeWinner.rule, breakpoint),
      );
    }

    if (requiresTerminalResponsiveOverride && breakpoint) {
      const target = createTerminalResponsiveRule(
        root,
        breakpoint,
        selector,
        root,
        activeWinner?.rule,
      );
      target.append(postcss.decl({
        prop: property,
        value: cleanValue,
        important: requestedPriority,
      }));
    } else if (exactWinner && winner) {
      // This is the core class-authoring contract: replace the value at the
      // declaration that already wins for `.class` in the referenced file.
      // Do not synthesize a parallel selector, move the property to another
      // block or delete shadowed author code.
      const isolated = isolateLocatedDeclaration(winner, selector);
      isolated.declaration.value = cleanValue;
      if (options.localizedPriority) isolated.declaration.important = localizedRequestedPriority;
    } else {
      const preservedGap = preservesAuthoredShorthandPriority && winner
        && normalizeStylePropertyName(winner.declaration.prop) === 'gap'
        ? gapShorthandWithEditedAxis(winner.declaration.value, propLower, cleanValue)
        : null;
      if (preservedGap !== null && winner) {
        // Retain the author's priority and the other axis at this exact source
        // location; stripping gap's priority could expose a losing column-gap.
        isolateLocatedDeclaration(winner, selector).declaration.value = preservedGap;
        return root.toString();
      }
      const declaration = postcss.decl({
        prop: property,
        value: cleanValue,
        // A derived longhand keeps only its winning authored shorthand's
        // priority. Normal declarations never gain priority from this path.
        important: requestedPriority || preservesAuthoredShorthandPriority,
      });
      if (winner) {
        // A shorthand (`padding`) or `all` currently owns this longhand. Put
        // the explicit value immediately after that exact source declaration
        // so the requested edit wins without destroying the authored rule.
        isolateLocatedDeclaration(winner, selector).declaration.after(declaration);
      } else {
        const matchedRule = rules.at(-1);
        const target = matchedRule
          ? isolateSelectorFromGroup(matchedRule, selector)
          : createRuleInContext(root, containers, selector);
        target.append(declaration);
      }
    }
  }

  // Never leave behind an empty media wrapper after clearing its last rule.
  containers.forEach((container) => {
    if (container !== root && container.type === 'atrule' && !(container as AtRule).nodes?.length) {
      (container as AtRule).remove();
    }
  });
  return root.toString();
}

export function readCssRuleDeclarations(
  source: string,
  context: CssEditingContext,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
) {
  return declarationValues(inspectCssRule(source, context, '', breakpoints).declarations);
}

/**
 * Values inherited by a scoped breakpoint before its own declarations are
 * applied. This follows the real ordered CSS cascade: base rules first, then
 * every sibling/parent width query that also matches the active viewport.
 */
export function readInheritedCssRuleDeclarations(
  source: string,
  context: CssEditingContext,
  viewportWidth: number,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
) {
  try {
    const root = parseCssForInspection(source);
    const layers = buildCssLayerRegistry(root, viewportWidth);
    const selector = selectorWithState(context.selector, context.pseudo);
    const active = resolveBreakpoint(context.breakpoint, breakpoints);
    const inheritedRules: Rule[] = [];
    root.walkRules(rule => {
      if (
        hasUnsupportedConditionalAncestor(rule)
        || !selectorListContains(rule.selector, selector)
      ) return;
      const conditions = ancestorWidthMedia(rule);
      if (active && ruleBelongsToBreakpoint(rule, active)) return;
      if (conditions.every(({ query }) => widthMediaQueryIsActive(query, viewportWidth))) {
        inheritedRules.push(rule);
      }
    });
    return declarationValues(cascadedRuleDeclarations(inheritedRules, layers));
  } catch {
    return {};
  }
}

export interface BreakpointMediaQueryPatchResult {
  source: string;
  ok: boolean;
}

/**
 * Checked form used by schema migrations that must update metadata and CSS
 * atomically. Ordinary breakpoint editing retains the historical string API
 * below, while migrations can refuse to seal their schema after a parse error.
 */
export function tryPatchBreakpointMediaQueries(
  source: string,
  previous: Breakpoint[],
  next: Breakpoint[],
): BreakpointMediaQueryPatchResult {
  try {
    const root = parseCssForAuthoring(source);
    const nextById = new Map(next.map(breakpoint => [breakpoint.id, breakpoint]));
    const previousByParams = new Map<string, Breakpoint[]>();
    previous.forEach((breakpoint) => {
      const params = breakpointParams(breakpoint);
      previousByParams.set(params, [...(previousByParams.get(params) || []), breakpoint]);
    });

    // Multiple breakpoint records can point at the same media wrapper. Treat the
    // wrapper as shared: keep it while one owner remains at the old condition and
    // clone it when owners diverge, instead of deleting/moving another owner's CSS.
    const mediaRules: AtRule[] = [];
    root.walkAtRules('media', (rule) => {
      mediaRules.push(rule);
    });
    mediaRules.forEach((rule) => {
      const sourceParams = rule.params.trim();
      const owners = previousByParams.get(sourceParams);
      if (!owners?.length) return;

      const destinations = [...new Set(owners
        .map(owner => nextById.get(owner.id))
        .filter((breakpoint): breakpoint is Breakpoint => !!breakpoint)
        .map(breakpointParams))];
      const staysAtSource = destinations.includes(sourceParams);
      const movedDestinations = destinations.filter(params => params !== sourceParams);

      if (staysAtSource) {
        movedDestinations.forEach(params => rule.before(rule.clone({ params })));
        return;
      }
      if (!movedDestinations.length) {
        rule.remove();
        return;
      }
      const [firstDestination, ...additionalDestinations] = movedDestinations;
      additionalDestinations.forEach(params => rule.before(rule.clone({ params })));
      rule.params = firstDestination;
    });

    // Equal media wrappers are valid CSS. Do not merge or sort them: moving a
    // wrapper across base rules, pseudo states or an overlapping min/max range
    // changes which declaration wins even though the user edited only a width.
    return { source: root.toString(), ok: true };
  } catch {
    return { source, ok: false };
  }
}

/** Keeps editor-owned width queries aligned with breakpoint CRUD operations. */
export function patchBreakpointMediaQueries(
  source: string,
  previous: Breakpoint[],
  next: Breakpoint[],
) {
  return tryPatchBreakpointMediaQueries(source, previous, next).source;
}
