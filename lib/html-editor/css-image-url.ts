/** A thumbnail may use a URL, but must not fetch authored CSS expressions. */
export function cssImagePreviewUrl(raw: string): string {
  const value = raw.trim();
  if (!value || /^(?:none|initial|inherit|unset|revert(?:-layer)?)$/i.test(value)) return '';
  const url = value.match(/^url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*?))\s*\)$/i);
  if (url) return (url[1] ?? url[2] ?? url[3] ?? '').replace(/\\(["'\\])/g, '$1').trim();
  if (/^(?:url|var|(?:repeating-)?(?:linear|radial|conic)-gradient|(?:-webkit-)?image-set|image|cross-fade|paint|element)\(/i.test(value)) return '';
  return value;
}
