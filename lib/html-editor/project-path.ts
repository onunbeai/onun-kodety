function dirname(path: string) {
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

/** Resolve an authored project-relative URL without loading preview/compiler code. */
export function resolveProjectPath(baseFile: string, relative: string, rootPath = dirname(baseFile)) {
  const authored = relative.trim();
  if (!authored || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(authored)) return null;
  // A query-only reference addresses the current file, not its directory.
  if (authored.startsWith('?')) return baseFile.replaceAll('\\', '/');
  let cleanRelative = authored.split('#')[0].split('?')[0];
  try { cleanRelative = decodeURIComponent(cleanRelative); } catch { /* keep encoded path */ }
  const stack = (cleanRelative.startsWith('/') ? rootPath : dirname(baseFile)).split('/').filter(Boolean);
  cleanRelative.split('/').forEach(part => {
    if (part === '..') stack.pop();
    else if (part !== '.' && part) stack.push(part);
  });
  return stack.join('/');
}
