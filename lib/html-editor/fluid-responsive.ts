import postcss, { type Node, type Rule } from 'postcss';
import valueParser from 'postcss-value-parser';

export interface FluidResponsiveConfig {
  baseViewport: number;
  minViewport: number;
  rootFontSize: number;
  minScale: number;
  preserveHairlines: boolean;
  /** Property names (lowercase) to leave untouched, e.g. ['letter-spacing']. */
  excludedProperties?: string[];
}

export type ResponsiveConversionMode = 'fluid' | 'rem';

const RESPONSIVE_PROPERTIES = /^(--|font-size$|line-height$|letter-spacing$|word-spacing$|width$|height$|min-|max-|margin|padding|gap$|row-gap$|column-gap$|top$|right$|bottom$|left$|inset|border.*(?:width|radius)$|outline-(?:width|offset)$|transform$|transform-origin$|translate$|box-shadow$|text-shadow$|background-(?:size|position)$|perspective$|flex-basis$|grid-auto-(?:columns|rows)$)/;

// Absolute length units converted into px before scaling. em/rem/% are relative
// and intentionally left alone so author intent is preserved.
const PT_TO_PX = 96 / 72;
const IN_TO_PX = 96;
const PC_TO_PX = 16; // 1pc = 12pt = 16px
const CM_TO_PX = 96 / 2.54;
const MM_TO_PX = 96 / 25.4;
const ABSOLUTE_UNITS: Record<string, number> = { px: 1, pt: PT_TO_PX, pc: PC_TO_PX, in: IN_TO_PX, cm: CM_TO_PX, mm: MM_TO_PX };
const ABSOLUTE_UNIT_PATTERN = Object.keys(ABSOLUTE_UNITS).join('|');
const RESPONSIVE_FUNCTIONS = /^(clamp|min|max)$/i;

function round(value: number) {
  return Number(value.toFixed(4));
}

function rem(value: number, root: number) {
  return `${round(value / root)}rem`;
}

function fluidValue(value: number, config: FluidResponsiveConfig) {
  if (value < 0) return rem(value, config.rootFontSize);
  if (config.preserveHairlines && value <= 2) return `${round(value)}px`;
  const minimum = value * config.minScale;
  const viewportRange = config.baseViewport - config.minViewport;
  if (viewportRange <= 0 || minimum === value) return rem(value, config.rootFontSize);
  const slope = ((value - minimum) / viewportRange) * 100;
  const intercept = (minimum - (slope * config.minViewport) / 100) / config.rootFontSize;
  return `clamp(${rem(minimum, config.rootFontSize)}, calc(${round(intercept)}rem + ${round(slope)}vw), ${rem(value, config.rootFontSize)})`;
}

export function transformResponsiveValue(value: string, config: FluidResponsiveConfig, mode: ResponsiveConversionMode) {
  if (!new RegExp(`(?:${ABSOLUTE_UNIT_PATTERN})`, 'i').test(value)) return value;
  const parsed = valueParser(value);
  const unitPattern = new RegExp(`^(-?\\d*\\.?\\d+)(${ABSOLUTE_UNIT_PATTERN})$`, 'i');
  parsed.walk(node => {
    // Never re-scale values already wrapped in a responsive function.
    if (node.type === 'function' && RESPONSIVE_FUNCTIONS.test(node.value)) return false;
    if (node.type !== 'word') return undefined;
    const match = node.value.match(unitPattern);
    if (!match) return undefined;
    const pixels = Number(match[1]) * ABSOLUTE_UNITS[match[2].toLowerCase()];
    if (!Number.isFinite(pixels) || pixels === 0) return undefined;
    node.value = mode === 'rem' ? rem(pixels, config.rootFontSize) : fluidValue(pixels, config);
    return undefined;
  });
  return parsed.toString();
}

function isExcluded(property: string, config: FluidResponsiveConfig) {
  const prop = property.toLowerCase();
  return !RESPONSIVE_PROPERTIES.test(prop) || Boolean(config.excludedProperties?.some(name => name.toLowerCase() === prop));
}

function insideKeyframes(rule: Rule) {
  let parent: Node | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && 'name' in parent && /keyframes$/i.test(String(parent.name))) return true;
    parent = parent.parent;
  }
  return false;
}

function selectorContainsToken(selector: string, token: string) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (token.startsWith('.') || token.startsWith('#')) {
    return new RegExp(`${escaped}(?=[^A-Za-z0-9_-]|$)`).test(selector);
  }
  return new RegExp(`(^|[\\s>+~,(])${escaped}(?=[\\s>+~.#:[,(]|$)`, 'i').test(selector);
}

export function transformScopedCss(source: string, scopeTokens: string[], scopeAll: boolean, config: FluidResponsiveConfig, mode: ResponsiveConversionMode) {
  const root = postcss.parse(source);
  root.walkRules(rule => {
    if (insideKeyframes(rule)) return;
    if (!scopeAll && !scopeTokens.some(token => selectorContainsToken(rule.selector, token))) return;
    rule.walkDecls(declaration => {
      if (isExcluded(declaration.prop, config)) return;
      declaration.value = transformResponsiveValue(declaration.value, config, mode);
    });
  });
  return root.toString();
}

export function transformInlineDeclarations(styles: Record<string, string>, config: FluidResponsiveConfig, mode: ResponsiveConversionMode) {
  return Object.fromEntries(Object.entries(styles).map(([property, value]) => [
    property,
    isExcluded(property, config) ? value : transformResponsiveValue(value, config, mode),
  ]));
}
