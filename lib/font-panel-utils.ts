import type { Font } from '@/types';
import {
  FONT_WEIGHTS,
  getFontAvailableWeights,
  getFontFamilyValue,
  parseCssFontFamilyList,
} from './font-utils';

export type FontPanelFace = {
  weight?: string;
  style?: string;
};

export type FontPanelFont = Font & {
  aliases?: string[];
  faces?: FontPanelFace[];
};

export type FontPanelOption = {
  value: string;
  label: string;
};

const WEIGHT_KEYWORDS: Record<string, string> = {
  thin: '100',
  hairline: '100',
  extralight: '200',
  ultralight: '200',
  light: '300',
  normal: '400',
  regular: '400',
  book: '400',
  roman: '400',
  medium: '500',
  semibold: '600',
  demibold: '600',
  bold: '700',
  extrabold: '800',
  ultrabold: '800',
  black: '900',
  heavy: '900',
};

const STYLE_LABELS: Record<string, string> = {
  normal: 'Normal',
  italic: 'Italic',
  oblique: 'Oblique',
};

function compactKeyword(value: string) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function normalizeFontPanelWeight(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) return '400';
  const keyword = WEIGHT_KEYWORDS[compactKeyword(normalized)];
  if (keyword) return keyword;
  return /^\d+(?:\.\d+)?$/.test(normalized) ? normalized : normalized;
}

export function fontPanelWeightLabel(value: string) {
  const normalized = normalizeFontPanelWeight(value);
  const known = FONT_WEIGHTS.find(option => option.value === normalized)?.label;
  if (known) return known;
  if (normalized === 'bolder') return 'Bolder';
  if (normalized === 'lighter') return 'Lighter';
  return normalized;
}

function isPreservableFontWeight(value: string) {
  return /^\d+(?:\.\d+)?$/.test(value)
    || /^(?:bolder|lighter|inherit|initial|unset|revert|revert-layer)$/.test(value)
    || /^var\(/.test(value);
}

export function normalizeFontPanelStyle(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.startsWith('oblique')) return 'oblique';
  if (normalized === 'italic') return 'italic';
  return 'normal';
}

function faceSupportsWeight(faceWeight: string | undefined, weight: string) {
  const normalizedWeight = Number(normalizeFontPanelWeight(weight));
  const values = Array.from(String(faceWeight || '').matchAll(/\b([1-9]00)\b/g), match => Number(match[1]));
  if (values.length >= 2 && Number.isFinite(normalizedWeight)) {
    const min = Math.min(values[0], values[1]);
    const max = Math.max(values[0], values[1]);
    return normalizedWeight >= min && normalizedWeight <= max;
  }
  const faceValue = normalizeFontPanelWeight(faceWeight || '400');
  return faceValue === normalizeFontPanelWeight(weight);
}

function variantStyle(variant: string) {
  const normalized = String(variant || '').trim().toLowerCase();
  if (normalized.includes('oblique')) return 'oblique';
  if (normalized.includes('italic')) return 'italic';
  return 'normal';
}

function variantWeight(variant: string) {
  const normalized = String(variant || '').trim().toLowerCase();
  const numeric = normalized.match(/^([1-9]00)/)?.[1];
  if (numeric) return numeric;
  return normalizeFontPanelWeight(normalized.replace(/italic|oblique/g, '') || '400');
}

export function fontPanelWeightOptions(
  font: FontPanelFont | undefined,
  currentWeight: string,
): FontPanelOption[] {
  const current = normalizeFontPanelWeight(currentWeight);
  const available = font ? getFontAvailableWeights(font) : FONT_WEIGHTS.map(option => option.value);
  const values = new Set(
    available
      .map(normalizeFontPanelWeight)
      .filter(value => /^\d+(?:\.\d+)?$/.test(value)),
  );
  if (String(currentWeight || '').trim() && isPreservableFontWeight(current)) values.add(current);
  if (values.size === 0) FONT_WEIGHTS.forEach(option => values.add(option.value));
  return Array.from(values)
    .sort((left, right) => {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
      if (Number.isFinite(leftNumber)) return -1;
      if (Number.isFinite(rightNumber)) return 1;
      return left.localeCompare(right);
    })
    .map(value => {
      const knownLabel = FONT_WEIGHTS.find(option => option.value === value)?.label;
      return {
        value,
        label: knownLabel ? `${knownLabel} · ${value}` : fontPanelWeightLabel(value),
      };
    });
}

export function fontPanelStyleOptions(
  font: FontPanelFont | undefined,
  currentWeight: string,
  currentStyle: string,
): FontPanelOption[] {
  const styles = new Set<string>();
  const weight = normalizeFontPanelWeight(currentWeight);

  if (font?.faces?.length) {
    font.faces
      .filter(face => faceSupportsWeight(face.weight, weight))
      .forEach(face => styles.add(normalizeFontPanelStyle(face.style || 'normal')));
  } else if (font?.variants?.length) {
    font.variants
      .filter(variant => variantWeight(variant) === weight)
      .forEach(variant => styles.add(variantStyle(variant)));
  }

  if (font?.type === 'default') {
    styles.add('normal');
    styles.add('italic');
  }
  if (!font) {
    styles.add('normal');
    styles.add('italic');
    styles.add('oblique');
  }
  if (styles.size === 0) styles.add('normal');
  if (String(currentStyle || '').trim()) styles.add(normalizeFontPanelStyle(currentStyle));

  return ['normal', 'italic', 'oblique']
    .filter(style => styles.has(style))
    .map(value => ({ value, label: STYLE_LABELS[value] }));
}

export function nearestFontPanelWeight(font: FontPanelFont | undefined, requestedWeight: string) {
  const normalizedRequested = normalizeFontPanelWeight(requestedWeight);
  if (isPreservableFontWeight(normalizedRequested) && !/^\d+(?:\.\d+)?$/.test(normalizedRequested)) {
    return normalizedRequested;
  }
  const requested = Number(normalizedRequested);
  const options = fontPanelWeightOptions(font, '');
  const available = options
    .map(option => Number(option.value))
    .filter(Number.isFinite);
  if (available.length === 0) return normalizeFontPanelWeight(requestedWeight);
  if (available.includes(requested)) return String(requested);
  if (available.includes(400)) return '400';
  return String(available.sort((left, right) =>
    Math.abs(left - requested) - Math.abs(right - requested),
  )[0]);
}

export function nearestFontPanelStyle(
  font: FontPanelFont | undefined,
  weight: string,
  requestedStyle: string,
) {
  const requested = normalizeFontPanelStyle(requestedStyle);
  const available = fontPanelStyleOptions(font, weight, '').map(option => option.value);
  if (available.includes(requested)) return requested;
  return available.includes('normal') ? 'normal' : available[0] || 'normal';
}

export function fontFamilySelectionValue(
  font: FontPanelFont,
  currentValue: string,
  preserveCssFallbacks: boolean,
) {
  const familyValue = getFontFamilyValue(font);
  // A segmented Adobe family can require multiple kit CSS names. The backend
  // authors that complete stack and it must travel intact with the selection.
  if (font.type === 'adobe' && font.cssStack?.trim()) return font.cssStack.trim();
  if (!preserveCssFallbacks || font.type === 'default') return familyValue;

  const currentFamilies = parseCssFontFamilyList(currentValue);
  const fallbacks = currentFamilies.length > 1
    ? currentFamilies.slice(1)
    : [font.category || 'sans-serif'];
  const escapedFamily = font.family.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return [`"${escapedFamily}"`, ...fallbacks].join(', ');
}

export function fontPanelAliases(font: FontPanelFont) {
  return Array.from(new Set([...(font.aliases || []), ...(font.cssNames || [])]))
    .map(alias => String(alias || '').trim())
    .filter(alias => alias && alias.toLocaleLowerCase() !== font.family.toLocaleLowerCase());
}

export function fontPanelAvailability(font: FontPanelFont) {
  const weights = fontPanelWeightOptions(font, '')
    .map(option => fontPanelWeightLabel(option.value));
  const styles = new Set<string>();
  (font.faces || []).forEach(face => styles.add(normalizeFontPanelStyle(face.style || 'normal')));
  (font.variants || []).forEach(variant => styles.add(variantStyle(variant)));
  if (styles.size === 0) styles.add('normal');
  const styleLabels = ['normal', 'italic', 'oblique']
    .filter(style => styles.has(style))
    .map(style => STYLE_LABELS[style]);
  return [...weights, ...styleLabels.filter(label => label !== 'Normal')].join(' · ');
}
