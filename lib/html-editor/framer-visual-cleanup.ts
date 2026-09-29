import { parse, type DefaultTreeAdapterMap } from 'parse5';

/** Keep Framer's transient tap highlight out of an idle imported document.
 * Captured inline outlines beat a normal stylesheet declaration. Limit the
 * priority override to Framer's tappable markers and leave keyboard focus,
 * authored borders, shadows and pseudo-element decorations untouched.
 */
export const FRAMER_VISUAL_CLEANUP_CSS = 'html body [data-highlight]:not(:focus-visible),html body [data-framer-highlight]:not(:focus-visible){outline:none!important;-webkit-tap-highlight-color:transparent}';

export function ensureFramerVisualCleanup(html: string): string {
  const style = `<style data-kodety-framer-visual-cleanup>${FRAMER_VISUAL_CLEANUP_CSS}</style>`;
  const nodes: DefaultTreeAdapterMap['element'][] = [];
  const visit = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node) nodes.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
    // Template content is inert and must not consume the document cleanup.
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  const existing = nodes.filter(node => node.tagName === 'style'
    && node.attrs.some(attribute => attribute.name === 'data-kodety-framer-visual-cleanup')
    && node.sourceCodeLocation);
  if (existing.length) {
    let updated = html;
    for (let index = existing.length - 1; index >= 0; index -= 1) {
      const location = existing[index].sourceCodeLocation!;
      updated = updated.slice(0, location.startOffset) + (index === 0 ? style : '') + updated.slice(location.endOffset);
    }
    return updated;
  }
  const head = nodes.find(node => node.tagName === 'head')?.sourceCodeLocation;
  const body = nodes.find(node => node.tagName === 'body')?.sourceCodeLocation;
  const insertion = head?.endTag?.startOffset ?? head?.startTag?.endOffset ?? body?.startTag?.endOffset ?? 0;
  return html.slice(0, insertion) + style + html.slice(insertion);
}
