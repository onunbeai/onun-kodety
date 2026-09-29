import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

/** Resolve imports in both initial previews and incremental stylesheet updates. */
export function inlinePreviewCssImports(css: string, load: (url: string) => string | null): string {
  if (!/@import\b/i.test(css)) return css;
  try {
    const root = postcss.parse(css);
    let importsAllowed = true;
    const resolvedImports: Array<{ rule: postcss.AtRule; sourceEnd: number; content: string }> = [];
    let preserveImportBoundary = false;
    for (const rule of [...root.nodes]) {
      if (rule.type === 'comment') continue;
      if (rule.type !== 'atrule') { importsAllowed = false; continue; }
      const name = rule.name.toLowerCase();
      if (name === 'charset' || (name === 'layer' && !rule.nodes)) continue;
      if (name !== 'import') { importsAllowed = false; continue; }
      if (!importsAllowed) continue;
      const tokens = valueParser(rule.params).nodes.filter(node => node.type !== 'space' && node.type !== 'comment');
      const source = tokens.shift();
      const url = source?.type === 'string' ? source.value
        : source?.type === 'function' && source.value.toLowerCase() === 'url'
          ? (source.nodes.length === 1 && source.nodes[0].type === 'string'
            ? source.nodes[0].value : valueParser.stringify(source.nodes).trim()) : null;
      if (!url) continue;
      const content = load(url);
      if (content === null) { preserveImportBoundary = true; continue; }
      if (/@(?:import|namespace)\b/i.test(content)) preserveImportBoundary = true;
      resolvedImports.push({ rule, sourceEnd: source!.sourceEndIndex, content });
    }
    for (const { rule, sourceEnd, content } of resolvedImports) {
      // Preserve stylesheet boundaries for namespaces and unresolved imports.
      // Otherwise inlining one local sheet can invalidate a following remote
      // @import by putting normal style rules before it.
      if (preserveImportBoundary) {
        rule.params = `url("data:text/css;charset=utf-8,${encodeURIComponent(content)}")${rule.params.slice(sourceEnd)}`;
        continue;
      }
      const tokens = valueParser(rule.params).nodes.filter(node => node.type !== 'space' && node.type !== 'comment');
      tokens.shift();
      const layer = tokens[0]?.value.toLowerCase() === 'layer' ? tokens.shift() : undefined;
      const supports = tokens[0]?.type === 'function' && tokens[0].value.toLowerCase() === 'supports'
        ? tokens.shift() : undefined;
      if (layer && layer.type !== 'word' && layer.type !== 'function') continue;
      const mediaStart = tokens[0]?.sourceIndex;
      const media = mediaStart === undefined ? '' : rule.params.slice(mediaStart).trim();
      const imported = postcss.parse(content);
      imported.walkAtRules('charset', node => { node.remove(); });
      let nodes = imported.nodes;
      // The layer is conditional on supports/media, including its order slot.
      if (layer) {
        const wrapper = postcss.atRule({ name: 'layer', params: layer.type === 'function' ? valueParser.stringify(layer.nodes).trim() : '' });
        wrapper.append(nodes);
        nodes = [wrapper];
      }
      if (supports?.type === 'function') {
        const condition = valueParser.stringify(supports.nodes).trim();
        const isDeclaration = supports.nodes.some(node => node.type === 'div' && node.value === ':');
        const wrapper = postcss.atRule({ name: 'supports', params: isDeclaration ? `(${condition})` : condition });
        wrapper.append(nodes);
        nodes = [wrapper];
      }
      if (media) {
        const wrapper = postcss.atRule({ name: 'media', params: media });
        wrapper.append(nodes);
        nodes = [wrapper];
      }
      rule.replaceWith(...nodes);
    }
    return root.toString();
  } catch {
    // An unfinished authored stylesheet remains intact while the user types.
    return css;
  }
}

/** Replace only URL spans using HTML's srcset token boundaries; preserve descriptors and whitespace. */
export function rewritePreviewSrcset(value: string, resolve: (url: string) => string | null): string {
  const whitespace = /[\t\n\f\r ]/;
  let cursor = 0;
  let copied = 0;
  let result = '';
  while (cursor < value.length) {
    while (cursor < value.length && (whitespace.test(value[cursor]) || value[cursor] === ',')) cursor++;
    const start = cursor;
    while (cursor < value.length && !whitespace.test(value[cursor])) cursor++;
    let end = cursor;
    while (end > start && value[end - 1] === ',') end--;
    if (end === start) continue;
    const replacement = resolve(value.slice(start, end));
    if (replacement !== null) {
      result += value.slice(copied, start) + replacement;
      copied = end;
    }
    if (end < cursor) continue;
    let depth = 0;
    while (cursor < value.length) {
      const char = value[cursor++];
      if (char === '(') depth++;
      else if (char === ')') depth = Math.max(0, depth - 1);
      else if (char === ',' && depth === 0) break;
    }
  }
  return result + value.slice(copied);
}
