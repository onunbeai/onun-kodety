import {
  canonicalizeLocalizationInsertionHtml,
  defaultLocalization,
  normalizeLocalization,
  setLocalizationSiteLanguage,
  upsertLocaleInsertion,
} from '@/lib/html-editor/localization';
import { readEditorMetadata } from '@/lib/html-editor/project-io';
import {
  inspectSourceElementIndex,
  type SourceElementIndex,
  type SourceElementSnapshot,
} from '@/lib/html-editor/source-patcher';

const localeInsertionRootsCache = new WeakMap<
  SourceElementIndex,
  Map<string, SourceElementSnapshot[]>
>();

function normalizedLocaleElementPath(path: string) {
  const indexes = path.split('/').filter(Boolean).map(Number);
  return indexes.every(index => Number.isInteger(index) && index >= 0)
    ? indexes.join('/')
    : null;
}

function localeInsertionRoots(index: SourceElementIndex) {
  const cached = localeInsertionRootsCache.get(index);
  if (cached) return cached;
  const roots = new Map<string, SourceElementSnapshot[]>();
  index.elements.forEach((element) => {
    const ids = new Set([
      element.attributes['data-kodety-locale-insertion'],
      element.attributes['data-kodety-locale-insertion-id'],
    ].filter((id): id is string => Boolean(id)));
    ids.forEach((id) => {
      const matchingRoots = roots.get(id);
      if (matchingRoots) matchingRoots.push(element);
      else roots.set(id, [element]);
    });
  });
  localeInsertionRootsCache.set(index, roots);
  return roots;
}

export function localizationFromProjectMetadata(
  metadata: ReturnType<typeof readEditorMetadata>,
  fallback?: ReturnType<typeof normalizeLocalization>,
) {
  const normalized = normalizeLocalization(
    metadata.localization || fallback || defaultLocalization(metadata.siteSettings?.language || 'pt-BR'),
  );
  return metadata.siteSettings?.language
    ? setLocalizationSiteLanguage(normalized, metadata.siteSettings.language)
    : normalized;
}

export function localeInsertionAtPath(source: string, path: string) {
  if (typeof DOMParser === 'undefined' || !source) return null;
  const normalizedPath = normalizedLocaleElementPath(path);
  if (normalizedPath === null) return null;
  const index = inspectSourceElementIndex(source);
  const target = normalizedPath ? index.byPath.get(normalizedPath) : index.body;
  const implicitTargetExists = !target && normalizedPath && index.elements.some(
    element => element.path.startsWith(`${normalizedPath}/`),
  );
  if (!target && !implicitTargetExists) return null;
  const rootsById = localeInsertionRoots(index);
  let candidatePath = normalizedPath;
  while (true) {
    const candidate = candidatePath ? index.byPath.get(candidatePath) : index.body;
    const id =
      candidate?.attributes['data-kodety-locale-insertion'] ||
      candidate?.attributes['data-kodety-locale-insertion-id'];
    if (id) {
      const roots = rootsById.get(id) || [];
      return {
        id,
        rootPath: candidatePath,
        rootIndex: Math.max(0, candidate ? roots.indexOf(candidate) : -1),
        rootCount: roots.length,
      };
    }
    if (!candidatePath) break;
    candidatePath = candidatePath.includes('/')
      ? candidatePath.slice(0, candidatePath.lastIndexOf('/'))
      : '';
  }
  return null;
}

export function localizedElementAtPath(document: Document, path: string) {
  let element: Element | null = document.body;
  for (const index of path.split('/').filter(Boolean).map(Number)) {
    element = element?.children.item(index) || null;
    if (!element) return null;
  }
  return element;
}

export function assertUniqueLocalizedElementId(source: string, paths: string[], id: string) {
  if (typeof DOMParser === 'undefined' || !source || !id) return;
  const document = new DOMParser().parseFromString(source, 'text/html');
  const targets = new Set(
    [...new Set(paths)]
      .map(path => localizedElementAtPath(document, path))
      .filter((element): element is Element => Boolean(element)),
  );
  if (targets.size !== new Set(paths).size) {
    throw new Error('Uma das layers selecionadas não existe mais. Selecione novamente no canvas.');
  }
  if (targets.size > 1) {
    throw new Error(`O ID “${id}” só pode pertencer a uma layer.`);
  }
  const collision = Array.from(document.body.querySelectorAll('[id]')).find(
    element => element.getAttribute('id') === id && !targets.has(element),
  );
  if (collision) {
    throw new Error(`O ID “${id}” já está em uso por outra layer nesta página.`);
  }
}

export function insertionPathForLocalizedPath(path: string, context: NonNullable<ReturnType<typeof localeInsertionAtPath>>) {
  const relativePath = path === context.rootPath ? '' : path.slice(context.rootPath.length).replace(/^\/+/, '');
  return relativePath ? `${context.rootIndex}/${relativePath}` : String(context.rootIndex);
}

export function localizedPathForInsertionPath(
  insertionPath: string,
  context: NonNullable<ReturnType<typeof localeInsertionAtPath>>,
) {
  const [rootPart = '0', ...relativeParts] = insertionPath.split('/').filter(Boolean);
  const nextRootIndex = Number(rootPart);
  const localizedParts = context.rootPath.split('/').filter(Boolean);
  const currentLocalizedIndex = Number(localizedParts.pop() || '0');
  localizedParts.push(
    String(currentLocalizedIndex + (Number.isFinite(nextRootIndex) ? nextRootIndex - context.rootIndex : 0)),
  );
  if (relativeParts.length) localizedParts.push(...relativeParts);
  return localizedParts.join('/');
}

export function localeInsertionHtmlFromRenderedSource(
  source: string,
  insertionId: string,
  context?: NonNullable<ReturnType<typeof localeInsertionAtPath>>,
) {
  if (typeof DOMParser === 'undefined' || !source || !insertionId) return null;
  const document = new DOMParser().parseFromString(source, 'text/html');
  const roots = Array.from(
    document.body.querySelectorAll('[data-kodety-locale-insertion], [data-kodety-locale-insertion-id]'),
  ).filter(
    root =>
      root.getAttribute('data-kodety-locale-insertion') === insertionId ||
      root.getAttribute('data-kodety-locale-insertion-id') === insertionId,
  );
  if (context && roots.length < context.rootCount) {
    let replacement: Element | null = document.body;
    for (const index of context.rootPath.split('/').filter(Boolean).map(Number)) {
      replacement = replacement?.children.item(index) || null;
      if (!replacement) break;
    }
    if (replacement && !roots.includes(replacement)) {
      roots.splice(Math.min(context.rootIndex, roots.length), 0, replacement);
    }
  }
  if (!roots.length) return null;
  return roots
    .map(root => {
      const clone = root.cloneNode(true) as Element;
      clone.removeAttribute('data-kodety-locale-insertion');
      clone.removeAttribute('data-kodety-locale-insertion-id');
      return clone.outerHTML;
    })
    .join('\n');
}

export function inheritedLocaleOverrideOwner(
  settings: ReturnType<typeof normalizeLocalization>,
  localeCode: string,
  pagePath: string,
  elementKey: string,
) {
  const visited = new Set<string>();
  let fallback = settings.locales.find(locale => locale.code === localeCode)?.fallback;
  while (fallback && !visited.has(fallback)) {
    visited.add(fallback);
    if (settings.translations[fallback]?.pages?.[pagePath]?.overrides?.[elementKey]) return fallback;
    fallback = settings.locales.find(locale => locale.code === fallback)?.fallback;
  }
  return undefined;
}

export function inheritedLocaleInsertionOwner(
  settings: ReturnType<typeof normalizeLocalization>,
  localeCode: string,
  pagePath: string,
  insertionId: string,
) {
  const visited = new Set<string>();
  let fallback = settings.locales.find(locale => locale.code === localeCode)?.fallback;
  while (fallback && !visited.has(fallback)) {
    visited.add(fallback);
    const direct = settings.translations[fallback]?.pages?.[pagePath]?.insertions?.find(
      insertion => insertion.id === insertionId,
    );
    if (direct && !direct.removed) return fallback;
    if (direct?.removed) return undefined;
    fallback = settings.locales.find(locale => locale.code === fallback)?.fallback;
  }
  return undefined;
}

export function createLocaleInsertionId() {
  return (
    globalThis.crypto?.randomUUID?.() || `locale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  );
}

export function stripLocaleInsertionMarkers(markup: string) {
  return markup.replace(/\sdata-kodety-locale-insertion(?:-id)?\s*=\s*["'][^"']*["']/gi, '');
}

export function upsertCanonicalLocaleInsertion(
  settings: ReturnType<typeof normalizeLocalization>,
  localeCode: string,
  pagePath: string,
  insertion: Parameters<typeof upsertLocaleInsertion>[3],
) {
  const html = insertion.removed ? insertion.html : canonicalizeLocalizationInsertionHtml(insertion.html);
  return upsertLocaleInsertion(settings, localeCode, pagePath, {
    ...insertion,
    html,
  });
}
