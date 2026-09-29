export interface SrcsetCandidate { url: string; descriptor: string }

/** HTML srcset token boundaries; commas in data/CDN URLs are part of the URL. */
export function parseSrcsetCandidates(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  const whitespace = /[\t\n\f\r ]/;
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && (whitespace.test(value[cursor]) || value[cursor] === ',')) cursor++;
    const start = cursor;
    while (cursor < value.length && !whitespace.test(value[cursor])) cursor++;
    let end = cursor;
    while (end > start && value[end - 1] === ',') end--;
    if (end === start) continue;
    const url = value.slice(start, end);
    if (end < cursor) { candidates.push({ url, descriptor: '' }); continue; }
    const descriptorStart = cursor;
    let depth = 0;
    while (cursor < value.length) {
      const character = value[cursor];
      if (character === ',' && depth === 0) break;
      if (character === '(') depth++;
      if (character === ')' && depth > 0) depth--;
      cursor++;
    }
    candidates.push({ url, descriptor: value.slice(descriptorStart, cursor).trim() });
    cursor++;
  }
  return candidates;
}

/**
 * Rewrite resource tokens without modifying strings/comments or CSS grammar.
 * Self-contained so the same function can run inside the opaque preview iframe.
 */
export function rewriteCssAssetUrls(source: string, resolve: (url: string) => string | null, depth = 0): string {
  const decode = (value: string) => value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\r\n\f])|([\s\S]))/gi, (_match, hex: string, _newline: string, escaped: string) => {
    if (!hex) return escaped || '';
    const code = Number.parseInt(hex, 16);
    return String.fromCodePoint(!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code);
  });
  const quote = (value: string) => '"' + value.replace(/[\\"\r\n\f]/g, character => ({ '\\': '\\\\', '"': '\\"', '\r': '\\d ', '\n': '\\a ', '\f': '\\c ' })[character] || character) + '"';
  const quotedEnd = (start: number) => {
    const delimiter = source[start];
    let end = start + 1;
    while (end < source.length) {
      if (source[end] === '\\') end += 2;
      else if (source[end++] === delimiter) return end;
    }
    return -1;
  };
  const contexts: Array<{ imageSet: boolean; candidate: boolean }> = [];
  let cursor = 0;
  let copied = 0;
  let output = '';
  const replace = (start: number, end: number, raw: string, urlFunction: boolean) => {
    const authored = decode(raw);
    if (!authored || authored.startsWith('#')) return;
    // Binary resources cross into the opaque iframe as Kodety-owned data URL
    // placeholders. They must reach the runtime resolver to request the bytes
    // and become iframe-owned Blobs. Ordinary inline data stays byte-for-byte;
    // existing Blob aliases may also need resolution after an asset refresh.
    let mapped: string | null;
    if (/^data:/i.test(authored) && !/^data:,kodety-runtime-asset-/i.test(authored)) {
      // Mixed local/remote @imports retain their stylesheet boundaries in a
      // generated UTF-8 data stylesheet. Resolve only nested Kodety markers,
      // with strict depth/size bounds; unrelated authored data stays untouched.
      const prefix = authored.match(/^data:text\/css(?:;charset=[^;,]+)?,/i)?.[0];
      if (!prefix || depth >= 4 || authored.length > 4 * 1024 * 1024 || !authored.includes('kodety-runtime-asset-')) return;
      try {
        const stylesheet = decodeURIComponent(authored.slice(prefix.length));
        const rewritten = rewriteCssAssetUrls(stylesheet, resolve, depth + 1);
        if (rewritten === stylesheet) return;
        mapped = prefix + encodeURIComponent(rewritten);
      } catch { return; }
    } else {
      mapped = resolve(authored);
    }
    if (mapped === null || mapped === authored) return;
    output += source.slice(copied, start) + (urlFunction ? `url(${quote(mapped)})` : quote(mapped));
    copied = end;
  };
  while (cursor < source.length) {
    if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end < 0 ? source.length : end + 2;
      continue;
    }
    const character = source[cursor];
    const context = contexts[contexts.length - 1];
    if (character === '"' || character === "'") {
      const end = quotedEnd(cursor);
      if (end < 0) break;
      if (context?.imageSet && context.candidate) {
        replace(cursor, end, source.slice(cursor + 1, end - 1), false);
        context.candidate = false;
      }
      cursor = end;
      continue;
    }
    if (/[a-z_-]/i.test(character)) {
      const start = cursor;
      while (cursor < source.length && /[\w-]/.test(source[cursor])) cursor++;
      const name = source.slice(start, cursor).toLowerCase();
      if (source[cursor] !== '(') continue;
      if (context?.imageSet) context.candidate = false;
      if (name === 'url') {
        let opening = cursor + 1;
        while (opening < source.length && /[\t\n\f\r ]/.test(source[opening])) opening++;
        let end = opening;
        let raw = '';
        if (source[opening] === '"' || source[opening] === "'") {
          end = quotedEnd(opening);
          if (end < 0) break;
          raw = source.slice(opening + 1, end - 1);
          while (end < source.length && /[\t\n\f\r ]/.test(source[end])) end++;
        } else {
          while (end < source.length && source[end] !== ')' && source[end] !== '(') {
            if (source[end] === '\\') end += 2;
            else end++;
          }
          raw = source.slice(opening, end).trim();
        }
        if (source[end] === ')') {
          replace(start, end + 1, raw, true);
          cursor = end + 1;
          continue;
        }
      }
      contexts.push({ imageSet: name === 'image-set' || name === '-webkit-image-set', candidate: true });
      cursor++;
      continue;
    }
    if (character === '(') contexts.push({ imageSet: false, candidate: false });
    if (character === ')') contexts.pop();
    if (character === ',' && context?.imageSet) context.candidate = true;
    cursor++;
  }
  return output + source.slice(copied);
}
