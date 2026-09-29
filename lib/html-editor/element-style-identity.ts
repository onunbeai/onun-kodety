import { inspectSourceElements } from './source-patcher';
import { parseStyleDeclarationDetails } from './style-utils';

/**
 * Private source identity used only when one authored element needs its own
 * stylesheet rule. It is deliberately separate from `class`: classes remain a
 * reusable design API, while this attribute survives class renames and DOM
 * reordering without accidentally turning a one-off inline style into a shared
 * rule.
 */
export const ELEMENT_STYLE_ID_ATTRIBUTE = 'data-kodety-style-id';

const ELEMENT_STYLE_ID_PATTERN = /^element-(\d{6,12})$/;
const ELEMENT_STYLE_ID_REFERENCE_PATTERN = /data-kodety-style-id\s*=\s*["'](element-\d{6,12})["']/g;
const MAX_ELEMENT_STYLE_ID_SEQUENCE = 999_999_999_999;

export function normalizeElementStyleId(value: string | null | undefined) {
  const normalized = (value || '').trim();
  const match = normalized.match(ELEMENT_STYLE_ID_PATTERN);
  if (!match) return '';
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? normalized : '';
}

export function collectElementStyleIdCounts(sources: Iterable<string>) {
  const counts = new Map<string, number>();
  for (const source of sources) {
    if (!source || !source.includes(ELEMENT_STYLE_ID_ATTRIBUTE)) continue;
    inspectSourceElements(source).forEach(element => {
      const id = normalizeElementStyleId(element.attributes[ELEMENT_STYLE_ID_ATTRIBUTE]);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
  }
  return counts;
}

/** Reserve identities referenced by either HTML or CSS, including orphan rules. */
export function collectReferencedElementStyleIds(sources: Iterable<string>) {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(ELEMENT_STYLE_ID_REFERENCE_PATTERN)) {
      const id = normalizeElementStyleId(match[1]);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** Allocate the next readable project-wide identity without random or path data. */
export function createElementStyleId(reserved: Set<string>) {
  let sequence = 1;
  reserved.forEach(id => {
    const match = id.match(ELEMENT_STYLE_ID_PATTERN);
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  });
  if (!Number.isSafeInteger(sequence) || sequence > MAX_ELEMENT_STYLE_ID_SEQUENCE) {
    throw new Error('O projeto esgotou as identidades privadas de estilo.');
  }
  let candidate = '';
  do {
    candidate = `element-${String(sequence).padStart(6, '0')}`;
    sequence += 1;
  } while (reserved.has(candidate));
  reserved.add(candidate);
  return candidate;
}

/**
 * Match one private identity with the same bounded class-level authority used
 * by generated visual classes. Repetition raises specificity without IDs or
 * `!important`, and every responsive/pseudo rule receives the same selector.
 */
export function elementStyleSelector(value: string) {
  const id = normalizeElementStyleId(value);
  if (!id) throw new Error('A identidade de estilo do elemento é inválida.');
  const atom = `[${ELEMENT_STYLE_ID_ATTRIBUTE}="${id}"]`;
  return `${atom}${atom}${atom}`;
}

/** Effective inline declarations, normalized for stylesheet-only authoring. */
export function inlineStyleDeclarationsForPromotion(styleText: string) {
  return Object.fromEntries(
    Object.entries(parseStyleDeclarationDetails(styleText)).map(([property, declaration]) => (
      [property, declaration.value]
    )),
  );
}
