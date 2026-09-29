import postcss, { type Container } from 'postcss';

const MAX_LOCALIZED_STYLESHEET_PATH_BYTES = 1024;

export const LOCALIZED_PAGE_STYLESHEET_HEADER = '/* Kodety localized page styles */';

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function decodedPath(value: string) {
  let decoded = value;
  try {
    for (let pass = 0; pass < 2; pass += 1) decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  return decoded;
}

/** Canonicalize the deliberately narrow project-relative path accepted by a
 * localized page stylesheet. These files are public authored assets, never
 * URLs or private Builder metadata. */
export function normalizeLocalizedStylesheetPath(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\\')) return '';
  const normalized = trimmed.replace(/^\.\/+/, '').replace(/\/{2,}/g, '/');
  const decoded = decodedPath(normalized);
  if (
    !decoded
    || utf8ByteLength(normalized) > MAX_LOCALIZED_STYLESHEET_PATH_BYTES
    || normalized.startsWith('/')
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || /[\u0000-\u001f\u007f]/.test(decoded)
    || /[\\?#:<>"'`]/.test(decoded)
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)
    || /^(?:\.incode|\.coday)(?:\/|$)/i.test(decoded)
    || !/\.css$/i.test(decoded)
  ) return '';
  return normalized;
}

function stablePathHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/** Return the one public CSS file owned by a locale/page pair. Keeping it next
 * to the page preserves the page's authored asset base, while a bounded locale
 * token plus the full-input hash makes the path portable and collision-safe. */
export function localizedPageStylesheetPath(pagePath: string, localeCode: string) {
  const normalizedPage = pagePath.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (
    !normalizedPage
    || normalizedPage.startsWith('/')
    || /[\u0000-\u001f\u007f?#:]/.test(normalizedPage)
    || /(?:^|\/)\.{1,2}(?:\/|$)/.test(normalizedPage)
    || /^(?:\.incode|\.coday)(?:\/|$)/i.test(normalizedPage)
    || !/\.html?$/i.test(normalizedPage)
  ) return '';
  const normalizedLocale = localeCode.trim().toLowerCase();
  const safeLocale = normalizedLocale
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!safeLocale) return '';
  const directory = normalizedPage.includes('/')
    ? normalizedPage.slice(0, normalizedPage.lastIndexOf('/') + 1)
    : '';
  return normalizeLocalizedStylesheetPath(
    `${directory}kodety-l10n-${safeLocale}-${stablePathHash(`${normalizedPage}\u0000${normalizedLocale}`)}.css`,
  );
}

/** Project-relative stylesheet path -> href resolved from one HTML document. */
export function localizedStylesheetHref(pagePath: string, stylesheetPath: string) {
  const stylesheet = normalizeLocalizedStylesheetPath(stylesheetPath);
  if (!stylesheet) return '';
  const from = pagePath.replaceAll('\\', '/').replace(/^\.\/+/, '').split('/').filter(Boolean);
  from.pop();
  const to = stylesheet.split('/').filter(Boolean);
  while (from[0] && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => '..'), ...to].join('/') || './';
}

function cssString(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function localizedElementSelectorMarker(elementKey: string) {
  if (!elementKey.startsWith('id:')) return '';
  return `[data-kodety-l10n-id="${cssString(elementKey.slice(3))}"]`;
}

const LOCALIZED_SELECTOR_AUTHORITY = 'abcdefgh'
  .split('')
  .map(suffix => `:is(#__kodety_l10n_specificity_${suffix}, *)`)
  .join('');

function localizedElementRuleMarker(elementKey: string) {
  return elementKey === 'body'
    ? 'body:is(#__kodety_l10n_specificity_a, *)'
    : localizedElementSelectorMarker(elementKey);
}

/**
 * A locale overlay must beat authored class/id rules without mutating source
 * HTML. The `:is()` guards match through `*`; their impossible ID branches add
 * bounded high specificity while the stable attribute remains the only target.
 */
export function localizedElementStyleSelector(elementKey: string) {
  if (elementKey === 'body') {
    return `body${LOCALIZED_SELECTOR_AUTHORITY}`;
  }
  const marker = localizedElementSelectorMarker(elementKey);
  if (!marker) return '';
  return `${LOCALIZED_SELECTOR_AUTHORITY}${marker}`;
}

function pruneEmptyAtRules(container: Container) {
  container.each(node => {
    if (!('nodes' in node) || !Array.isArray(node.nodes)) return;
    pruneEmptyAtRules(node as Container);
    if (node.type === 'atrule' && node.nodes.length === 0) node.remove();
  });
}

/** Remove every breakpoint and pseudo rule authored for one locale element. */
export function removeLocalizedElementStyleRules(source: string, elementKey: string) {
  const marker = localizedElementRuleMarker(elementKey);
  if (!marker || !source.includes(marker)) return source;
  const root = postcss.parse(source);
  root.walkRules(rule => {
    const selectors = postcss.list.comma(rule.selector);
    const retained = selectors.filter(selector => !selector.includes(marker));
    if (retained.length === selectors.length) return;
    if (retained.length) rule.selector = retained.join(', ');
    else rule.remove();
  });
  pruneEmptyAtRules(root);
  return root.toString();
}

/** True when this stylesheet directly authors at least one rule for a stable
 * localized element. Grouped selector rules count without making unrelated
 * selector branches part of that element's reset surface. */
export function localizedStylesheetHasElementRules(source: string, elementKey: string) {
  const marker = localizedElementRuleMarker(elementKey);
  if (!marker || !source.includes(marker)) return false;
  try {
    const root = postcss.parse(source);
    let found = false;
    root.walkRules(rule => {
      if (
        !found
        && postcss.list.comma(rule.selector).some(selector => selector.includes(marker))
      ) found = true;
    });
    return found;
  } catch {
    return false;
  }
}

export function localizedStylesheetHasRules(source: string) {
  const root = postcss.parse(source);
  let hasAuthoredCss = false;
  root.walk(node => {
    // The managed header and any explanatory comments are not authored CSS.
    // Preserve every other node, including @import/@font-face/custom at-rules,
    // when deciding whether an element reset may delete the whole file.
    if (node.type !== 'comment') hasAuthoredCss = true;
  });
  return hasAuthoredCss;
}

export function createLocalizedPageStylesheetSource() {
  return `${LOCALIZED_PAGE_STYLESHEET_HEADER}\n`;
}
