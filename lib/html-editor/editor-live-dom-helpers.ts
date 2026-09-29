import { toast } from 'sonner';
import type { AnalyticsTrackingTarget } from '@/lib/html-editor/analytics';
import { visualClassSelector } from '@/lib/html-editor/class-selector';
import {
  CANVAS_VISIBILITY_ATTRIBUTE_NAMES,
  CSS_SHORTHAND_GROUPS,
  INLINE_TEXT_EDIT_DROP_CONTENT_TAGS,
  INLINE_TEXT_EDIT_GLOBAL_ATTRIBUTES,
  INLINE_TEXT_EDIT_TAGS,
  NATIVE_OVERLAY_BUILDERS,
  NEUTRAL_FONT_STYLE,
} from '@/lib/html-editor/editor-constants';
import type {
  CanvasDesignTool,
  CanvasLiveAttributePatch,
  CanvasLiveStyleEnqueueMessage,
  CanvasLiveStylePatch,
  CanvasLiveTextPatch,
  LiveHistoryProjection,
  PendingCanvasLiveStyle,
} from '@/lib/html-editor/editor-types';
import { analyticsPageLabel } from '@/lib/html-editor/editor-wordpress-helpers';
import {
  activeExperimentEditSession,
  createActiveExperimentFile,
  experimentPublicEditPath,
  visibleExperimentFiles,
} from '@/lib/html-editor/experiments';
import {
  MEMBERSHIP_BRANCH_ATTRIBUTE,
  MEMBERSHIP_GATE_ATTRIBUTE,
  type MembershipProtectedDownloadScope,
} from '@/lib/html-editor/membership';
import { buildElementTree, resolveProjectPath } from '@/lib/html-editor/preview';
import { addProjectAsset, addProjectTextFile } from '@/lib/html-editor/project-io';
import { publicRouteForProjectPage } from '@/lib/html-editor/redirects';
import {
  getElementOuterHtml,
  inspectSourceElementIndex,
  remapPathAfterInsert,
  remapPathAfterMove,
  remapPathAfterRemovals,
  remapPathAfterUnwrap,
  remapPathAfterWrap,
} from '@/lib/html-editor/source-patcher';
import {
  diffStyleDeclarationDetails,
  normalizeStylePropertyName,
  parseStyleDeclarationDetails,
  parseStyleDeclarations,
} from '@/lib/html-editor/style-utils';
import type { EditorElement, HtmlProject, SelectionSnapshot } from '@/lib/html-editor/types';

export function canReplayLiveStructureHistory(
  from: HtmlProject,
  to: HtmlProject,
  recordedSurfaceKey: string,
  currentSurfaceKey: string,
): boolean {
  return Boolean(recordedSurfaceKey && recordedSurfaceKey === currentSurfaceKey
    && from.openedAt === to.openedAt
    && from.mainHtmlPath === to.mainHtmlPath
    && from.rootPath === to.rootPath
    && from.previewRootPath === to.previewRootPath);
}

/** Runtime-owned subtrees must be rebuilt by their owner after an authored move. */
export function canMoveStaticCanvasElement(source: string, sourcePath: string, targetPath: string): boolean {
  if (/data-kodety-framer-responsive-runtime/i.test(source)) return false;
  const { byPath } = inspectSourceElementIndex(source);
  for (const candidate of [sourcePath, targetPath]) {
    let path = candidate;
    for (;;) {
      if (byPath.get(path)?.attributes['data-coday-code-instance']) return false;
      if (!path) break;
      path = path.split('/').slice(0, -1).join('/');
    }
  }
  return true;
}

/** A native ID is an editing identity only when it belongs to one source node. */
export function uniqueSourceElementId(source: string, path: string): string {
  const { byPath } = inspectSourceElementIndex(source);
  const id = byPath.get(path)?.attributes.id || '';
  if (!id) return '';
  let occurrences = 0;
  for (const element of byPath.values()) {
    if (element.attributes.id === id && ++occurrences > 1) return '';
  }
  return occurrences === 1 ? id : '';
}

export function membershipGateRoots(source: string) {
  if (
    !source
    || !source.includes(MEMBERSHIP_GATE_ATTRIBUTE)
    || typeof DOMParser === 'undefined'
  ) return [] as Array<{ path: string; gateId: string }>;
  const document = new DOMParser().parseFromString(source, 'text/html');
  const roots: Array<{ path: string; gateId: string }> = [];
  const visit = (element: Element, path: string) => {
    const gateId = element.getAttribute(MEMBERSHIP_GATE_ATTRIBUTE)?.trim();
    if (gateId) roots.push({ path, gateId });
    Array.from(element.children).forEach((child, index) => {
      visit(child, path ? `${path}/${index}` : String(index));
    });
  };
  visit(document.body, '');
  return roots;
}

export function membershipGateContentScopeAtPath(source: string, path: string): MembershipProtectedDownloadScope {
  const empty: MembershipProtectedDownloadScope = { gateIds: [] };
  if (!source || typeof DOMParser === 'undefined') return empty;
  const document = new DOMParser().parseFromString(source, 'text/html');
  let selected: Element | null = document.body;
  for (const index of path.split('/').filter(Boolean).map(Number)) {
    selected = selected?.children.item(index) || null;
    if (!selected) return empty;
  }
  const gateIds: string[] = [];
  let descendant: Element = selected;
  let ancestor = selected.parentElement;
  while (ancestor && ancestor !== document.documentElement) {
    if (ancestor.hasAttribute(MEMBERSHIP_GATE_ATTRIBUTE)) {
      let branchRoot: Element = descendant;
      while (branchRoot.parentElement && branchRoot.parentElement !== ancestor) {
        branchRoot = branchRoot.parentElement;
      }
      if (branchRoot.parentElement !== ancestor || branchRoot.getAttribute(MEMBERSHIP_BRANCH_ATTRIBUTE) !== 'content') {
        return empty;
      }
      const gateId = ancestor.getAttribute(MEMBERSHIP_GATE_ATTRIBUTE) || '';
      if (!gateId) return empty;
      gateIds.push(gateId);
    }
    descendant = ancestor;
    ancestor = ancestor.parentElement;
  }
  return { gateIds };
}

export function trackingTargetsForProject(
  project: HtmlProject,
  pagePaths: string[],
  homePath: string,
): AnalyticsTrackingTarget[] {
  if (typeof DOMParser === 'undefined') return [];
  const targets = new Map<string, AnalyticsTrackingTarget>();
  const elementLabel = (element: HTMLElement, fallback: string) => {
    const text = element.textContent?.replace(/\s+/g, ' ').trim();
    return (
      element.getAttribute('aria-label')?.trim() ||
      element.getAttribute('title')?.trim() ||
      text?.slice(0, 72) ||
      fallback
    );
  };
  const upsertDomTarget = (
    runtimePath: string,
    pageLabel: string,
    element: HTMLElement,
    selectorType: 'id' | 'class',
    selectorValue: string,
  ) => {
    const value = selectorValue.trim();
    if (!value) return;
    const targetKey = `${runtimePath}\0${selectorType}\0${value}`;
    const current = targets.get(targetKey);
    if (current) {
      targets.set(targetKey, {
        ...current,
        matchCount: (current.matchCount || 1) + 1,
        enabled: current.enabled !== false || !element.hasAttribute('disabled'),
      });
      return;
    }
    targets.set(targetKey, {
      id: value,
      label: `${elementLabel(element, value)} · ${pageLabel}`,
      type: 'click',
      pagePath: runtimePath,
      enabled: !element.hasAttribute('disabled'),
      selectorType,
      selectorValue: value,
      matchCount: 1,
    });
  };
  for (const pagePath of pagePaths) {
    const runtimePath = publicRouteForProjectPage(pagePath, homePath);
    const pageLabel = analyticsPageLabel(pagePath, homePath);
    const source = project.files[pagePath]?.text;
    if (!source) continue;
    const document = new DOMParser().parseFromString(source, 'text/html');
    document.querySelectorAll<HTMLElement>('[data-kodety-tracking-id]').forEach(element => {
      const id = element.dataset.kodetyTrackingId?.trim();
      const targetKey = `${runtimePath}\0tracking-id\0${id}`;
      if (!id || targets.has(targetKey)) return;
      targets.set(targetKey, {
        id,
        label: `${elementLabel(element, id)} · ${pageLabel}`,
        type: element.tagName.toLowerCase() === 'form' ? 'submit' : 'click',
        pagePath: runtimePath,
        enabled: !element.hasAttribute('disabled'),
      });
    });
    document.querySelectorAll<HTMLElement>('[id]').forEach(element => {
      upsertDomTarget(runtimePath, pageLabel, element, 'id', element.id);
    });
    document.querySelectorAll<HTMLElement>('[class]').forEach(element => {
      element.classList.forEach(className => {
        upsertDomTarget(runtimePath, pageLabel, element, 'class', className);
      });
    });
  }
  return [...targets.values()].sort(
    (left, right) =>
      (left.selectorType === right.selectorType
        ? 0
        : left.selectorType === 'id'
          ? -1
          : right.selectorType === 'id'
            ? 1
            : 0) ||
      left.id.localeCompare(right.id) ||
      (left.pagePath || '').localeCompare(right.pagePath || ''),
  );
}

let nativeOverlayInsertSequence = 0;

export function buildFreshNativeOverlayMarkup(tag: string): string | null {
  const builder = NATIVE_OVERLAY_BUILDERS[tag];
  if (!builder) return null;
  nativeOverlayInsertSequence += 1;
  const suffix = `${Date.now().toString(36)}-${nativeOverlayInsertSequence.toString(36)}`;
  return builder({ id: `kodety-${tag}-${suffix}` });
}

export function drawnElementMarkup(
  key: Exclude<CanvasDesignTool, 'select'>,
  size: { width: number; height: number },
) {
  const width = Math.max(8, Math.min(10_000, Math.round(size.width)));
  const height = Math.max(8, Math.min(10_000, Math.round(size.height)));
  if (key === 'text-block') {
    return `<span data-label="Text" style="display: block; box-sizing: border-box; width: ${width}px; min-height: ${height}px; color: #333333; font-size: 16px; line-height: 1.5; ${NEUTRAL_FONT_STYLE}">Text</span>`;
  }
  if (key === 'image') {
    return `<img data-label="Image" data-incode-component="image" data-kodety-empty-image alt="" aria-label="Image placeholder" loading="lazy" style="display: block; box-sizing: border-box; width: ${width}px; height: ${height}px; min-height: 0; border: 1px solid #dddddd; border-radius: 16px; background-color: #eeeeee; background-image: repeating-linear-gradient(135deg, transparent 0, transparent 20px, rgba(255, 255, 255, 0.72) 20px, rgba(255, 255, 255, 0.72) 22px); object-fit: cover; overflow: hidden;">`;
  }
  if (key === 'video') {
    return `<video data-label="Video" data-incode-component="video" controls playsinline style="display: block; box-sizing: border-box; width: ${width}px; height: ${height}px; min-height: 0; border: 1px solid #e5e5e5; border-radius: 18px; background: #171717; object-fit: cover; overflow: hidden;"></video>`;
  }
  if (key === 'stack') {
    return `<div data-label="Stack" style="display: flex; box-sizing: border-box; width: ${width}px; height: ${height}px; min-height: 0; padding: 16px; flex-direction: column; gap: 16px;"></div>`;
  }
  if (key === 'grid') {
    return `<div data-label="Grid" style="display: grid; box-sizing: border-box; width: ${width}px; height: ${height}px; min-height: 0; padding: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px;"></div>`;
  }
  if (key === 'masonry') {
    return `<div data-label="Masonry" style="box-sizing: border-box; width: ${width}px; height: ${height}px; min-height: 0; padding: 16px; columns: 3 140px; column-gap: 16px;"></div>`;
  }
  return `<div data-label="Rectangle" data-kodety-free-layout="true" style="position: relative; display: block; box-sizing: border-box; width: ${width}px; height: ${height}px; min-height: 0; padding: 24px;"></div>`;
}

export function pickCodeComponentFile(accept?: string) {
  return new Promise<File | null>(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    if (accept) input.accept = accept;
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function conflictingInlineStyleProperties(property: string) {
  const conflicts = new Set([property, 'all']);
  Object.entries(CSS_SHORTHAND_GROUPS).forEach(([shorthand, longhands]) => {
    if (property === shorthand) {
      conflicts.add(shorthand);
      longhands.forEach(item => conflicts.add(item));
    } else if (longhands.includes(property)) conflicts.add(shorthand);
  });
  return conflicts;
}

export function generatedVisualClass(selection: Pick<SelectionSnapshot, 'path' | 'tag'>) {
  const suffix = selection.path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
  return `incode-${selection.tag}-${suffix}`;
}

export const selectorForVisualClass = visualClassSelector;

export function addTextFileForActiveExperimentDocument(current: HtmlProject, requestedPath: string) {
  const session = activeExperimentEditSession(current);
  if (!session) {
    const project = addProjectTextFile(current, requestedPath);
    const storagePath = Object.keys(project.files).find(candidate => !current.files[candidate]) || requestedPath;
    return { project, publicPath: storagePath, storagePath };
  }
  const visibleFiles = visibleExperimentFiles(current);
  const visibleProject: HtmlProject = {
    ...current,
    files: Object.fromEntries(visibleFiles.map(file => [file.path, file])),
    mainHtmlPath: experimentPublicEditPath(session, current.mainHtmlPath),
    rootPath: session.baseRootPath,
    previewRootPath: undefined,
  };
  const staged = addProjectTextFile(visibleProject, requestedPath);
  const publicPath = Object.keys(staged.files).find(candidate => !visibleProject.files[candidate]) || requestedPath;
  const created = createActiveExperimentFile(current, publicPath, staged.files[publicPath], { deduplicate: false });
  return {
    project: created.project,
    publicPath: created.publicPath,
    storagePath: created.storagePath,
  };
}

export async function addAssetForActiveExperimentDocument(base: HtmlProject, file: File) {
  const session = activeExperimentEditSession(base);
  const visibleFiles = visibleExperimentFiles(base);
  const visibleProject: HtmlProject = {
    ...base,
    files: Object.fromEntries(visibleFiles.map(candidate => [candidate.path, candidate])),
    mainHtmlPath: session ? experimentPublicEditPath(session, base.mainHtmlPath) : base.mainHtmlPath,
    rootPath: session ? session.baseRootPath : base.rootPath,
    previewRootPath: undefined,
  };
  const staged = await addProjectAsset(visibleProject, file);
  const publicPath = Object.keys(staged.files).find(path => !visibleProject.files[path]);
  if (!publicPath) throw new Error('Não foi possível localizar o novo asset.');
  return createActiveExperimentFile(base, publicPath, staged.files[publicPath], { deduplicate: false });
}

export function blockGlobalPageMutationInsideVariant(project: HtmlProject, action: string) {
  if (!activeExperimentEditSession(project)) return false;
  toast.error(`${action} não está disponível dentro de uma variante`, {
    description:
      'Volte ao Control para alterar a estrutura global de páginas. As edições de conteúdo e estilo desta variante continuam isoladas.',
  });
  return true;
}

export function sanitizeInlineTextEditHtml(source: string) {
  if (typeof DOMParser === 'undefined') return null;
  const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
  const sanitizeElement = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (INLINE_TEXT_EDIT_DROP_CONTENT_TAGS.has(tag)) {
      element.remove();
      return;
    }
    Array.from(element.children).forEach(sanitizeElement);
    if (!INLINE_TEXT_EDIT_TAGS.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const tagAttribute = (
        tag === 'a' && ['href', 'target', 'rel', 'download', 'hreflang', 'type'].includes(name)
      ) || (
        ['del', 'ins'].includes(tag) && ['cite', 'datetime'].includes(name)
      ) || (tag === 'time' && name === 'datetime')
        || (tag === 'data' && name === 'value');
      const safeGlobal = INLINE_TEXT_EDIT_GLOBAL_ATTRIBUTES.has(name)
        || name.startsWith('aria-')
        || (name.startsWith('data-') && !name.startsWith('data-html-editor-'));
      if (name.startsWith('on') || name === 'contenteditable' || name === 'srcdoc' || (!safeGlobal && !tagAttribute)) {
        element.removeAttribute(attribute.name);
      }
    });
    const href = element.getAttribute('href');
    if (href && /^\s*(?:javascript|vbscript|data):/i.test(href)) element.removeAttribute('href');
    const style = element.getAttribute('style');
    if (style && /(?:expression\s*\(|javascript\s*:|vbscript\s*:|@import|behavior\s*:)/i.test(style)) {
      element.removeAttribute('style');
    }
  };
  Array.from(parsed.body.children).forEach(sanitizeElement);
  return parsed.body.innerHTML;
}

export function stylesheetPathsForPage(
  project: HtmlProject,
  source: string,
  availableCss: string[],
  pagePath = project.mainHtmlPath,
) {
  if (!source) return [];
  const document = new DOMParser().parseFromString(source, 'text/html');
  const available = new Set(availableCss);
  const paths: string[] = [];
  document.querySelectorAll('link[rel][href]').forEach(link => {
    const relations = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (!relations.includes('stylesheet')) return;
    const resolved = resolveProjectPath(
      pagePath,
      link.getAttribute('href') || '',
      project.previewRootPath ?? project.rootPath,
    );
    if (resolved && available.has(resolved) && !paths.includes(resolved)) paths.push(resolved);
  });
  return paths;
}

export function compareElementPathsDescending(a: string, b: string) {
  const aParts = a.split('/').filter(Boolean).map(Number);
  const bParts = b.split('/').filter(Boolean).map(Number);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index++) {
    const difference = (bParts[index] ?? -1) - (aParts[index] ?? -1);
    if (difference) return difference;
  }
  return bParts.length - aParts.length;
}

export function topLevelElementPaths(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  return unique
    .filter(path => !unique.some(candidate => candidate !== path && path.startsWith(`${candidate}/`)))
    .sort(compareElementPathsDescending);
}

function htmlElementAttributes(element: Element) {
  return Object.fromEntries(
    Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]),
  );
}

function htmlElementAttributesEqual(left: Element, right: Element) {
  const leftAttributes = htmlElementAttributes(left);
  const rightAttributes = htmlElementAttributes(right);
  const names = new Set([...Object.keys(leftAttributes), ...Object.keys(rightAttributes)]);
  return Array.from(names).every(name => leftAttributes[name] === rightAttributes[name]);
}

function directElementText(element: Element) {
  return Array.from(element.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.nodeValue || '')
    .join('');
}

/**
 * Locate the smallest stable elements affected by an Agent-authored page
 * snapshot. New/removed children light their surviving parent; ordinary text,
 * attribute and style edits light the exact element. Paths in the returned set
 * always belong to the post-change document so a newly inserted subtree starts
 * shimmering as soon as the live structure transaction materializes it.
 */
export function agentActivityPathsForHtmlChange(beforeHtml: string, afterHtml: string) {
  if (typeof DOMParser === 'undefined') return [];
  const before = new DOMParser().parseFromString(beforeHtml, 'text/html');
  const after = new DOMParser().parseFromString(afterHtml, 'text/html');
  const paths: string[] = [];
  const visit = (previous: Element, next: Element, path: string) => {
    if (previous.outerHTML === next.outerHTML) return;
    if (previous.tagName !== next.tagName) {
      if (path) paths.push(path);
      return;
    }
    const previousChildren = Array.from(previous.children);
    const nextChildren = Array.from(next.children);
    if (
      !htmlElementAttributesEqual(previous, next)
      || directElementText(previous) !== directElementText(next)
    ) {
      if (path) paths.push(path);
    }
    if (previousChildren.length !== nextChildren.length) {
      if (path) paths.push(path);
      else nextChildren.slice(0, 64).forEach((_child, index) => paths.push(String(index)));
      return;
    }
    previousChildren.forEach((child, index) => {
      const nextChild = nextChildren[index];
      if (nextChild) visit(child, nextChild, path ? `${path}/${index}` : String(index));
    });
  };
  visit(before.body, after.body, '');
  if (!paths.length && before.body.innerHTML !== after.body.innerHTML) {
    Array.from(after.body.children).slice(0, 64).forEach((_child, index) => paths.push(String(index)));
  }
  return topLevelElementPaths(paths).slice(0, 64);
}

function semanticHeadMarkup(document: Document) {
  return Array.from(document.head.childNodes)
    .map(node => (
      node.nodeType === Node.TEXT_NODE
        ? (node.nodeValue || '').trim()
        : node instanceof Element
          ? node.outerHTML
          : ''
    ))
    .filter(Boolean)
    .join('');
}

/**
 * Build a no-navigation page transaction when the executable document shell
 * is unchanged. The canvas keeps its Window, scroll position, decoded assets
 * and runtime controllers; only authored body roots are replaced in place.
 * Head/script changes deliberately return null and use the canonical buffered
 * rebuild as the repair/safety path.
 */
export function canvasLiveBodyReplacement(
  beforeHtml: string,
  afterHtml: string,
  selectPath = '',
) {
  if (typeof DOMParser === 'undefined') return null;
  const before = new DOMParser().parseFromString(beforeHtml, 'text/html');
  const after = new DOMParser().parseFromString(afterHtml, 'text/html');
  if (
    !htmlElementAttributesEqual(before.documentElement, after.documentElement)
    || semanticHeadMarkup(before) !== semanticHeadMarkup(after)
    || before.body.querySelector('script, style, link, meta, base, noscript, template')
    || after.body.querySelector([
      'script',
      'style',
      'link',
      'meta',
      'base',
      'noscript',
      'template',
      '[data-kodety-collection]',
      '[data-kodety-bind]',
      '[data-kodety-bind-content]',
      '[data-coday-code-instance]',
      '[data-kodety-membership-gate]',
    ].join(','))
    || Array.from(after.body.childNodes).some(node => (
      node.nodeType === Node.TEXT_NODE && Boolean((node.nodeValue || '').trim())
    ))
  ) return null;
  const liveDom = diffCanvasLiveDom(beforeHtml, afterHtml);
  const availablePaths = new Set<string>();
  const visit = (element: Element, path: string) => {
    availablePaths.add(path);
    Array.from(element.children).forEach((child, index) => {
      visit(child, path ? `${path}/${index}` : String(index));
    });
  };
  visit(after.body, '');
  return {
    message: {
      operation: 'replace-body',
      markup: after.body.innerHTML,
      bodyAttributes: liveDom.attributes.filter(patch => patch.path === ''),
      bodyStyles: liveDom.patches.filter(patch => patch.path === ''),
      selectPath: selectPath && availablePaths.has(selectPath) ? selectPath : '',
    },
    activityPaths: agentActivityPathsForHtmlChange(beforeHtml, afterHtml),
  };
}

export function remapPathKeyedMap<T>(
  source: Map<string, T>,
  remapPath: (path: string) => string | null,
) {
  const next = new Map<string, T>();
  source.forEach((value, path) => {
    const remapped = remapPath(path);
    if (remapped !== null) next.set(remapped, value);
  });
  return next;
}

/** Replacing one authored root keeps that root's identity, but none of its
 * former descendants are guaranteed to exist in the new markup. */
export function remapPathAfterReplace(path: string, replacedPath: string) {
  if (path === replacedPath) return path;
  if (!replacedPath || path.startsWith(`${replacedPath}/`)) return null;
  return path;
}

export function emptyElementMarkupAtPath(source: string, path: string) {
  const document = new DOMParser().parseFromString(getElementOuterHtml(source, path), 'text/html');
  const element = document.body.firstElementChild;
  if (!element) throw new Error('Não foi possível preparar o elemento para o canvas.');
  element.replaceChildren();
  return element.outerHTML;
}

export function liveStructureInverse(
  source: string,
  message: Record<string, unknown>,
): Omit<LiveHistoryProjection, 'source'> | null {
  const operation = String(message.operation || '');
  if (operation === 'insert') {
    const insertedPath = typeof message.insertedPath === 'string' ? message.insertedPath : '';
    if (!insertedPath) return null;
    return {
      message: { operation: 'remove', paths: [insertedPath], selectPath: '' },
      remapPath: path => remapPathAfterRemovals(path, [insertedPath]),
    };
  }
  if (operation === 'remove') {
    const paths = (Array.isArray(message.paths) ? message.paths : [])
      .filter((path): path is string => typeof path === 'string' && Boolean(path))
      .sort((left, right) => {
        const leftParts = left.split('/').map(Number);
        const rightParts = right.split('/').map(Number);
        for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
          if ((leftParts[index] ?? -1) !== (rightParts[index] ?? -1)) {
            return (leftParts[index] ?? -1) - (rightParts[index] ?? -1);
          }
        }
        return 0;
      });
    if (!paths.length) return null;
    const items = paths.map(path => ({ path, markup: getElementOuterHtml(source, path) }));
    return {
      message: { operation: 'restore', items, selectPath: paths[0] },
      remapPath: path => paths.reduce((next, insertedPath) => remapPathAfterInsert(next, insertedPath), path),
    };
  }
  if (operation === 'move') {
    const sourcePath = typeof message.sourcePath === 'string' ? message.sourcePath : '';
    const movedPath = typeof message.movedPath === 'string' ? message.movedPath : '';
    const codeComponentInstanceId = typeof message.codeComponentInstanceId === 'string'
      ? message.codeComponentInstanceId.trim()
      : '';
    if (!sourcePath || !movedPath) return null;
    return {
      message: {
        operation: 'relocate',
        sourcePath: movedPath,
        destinationPath: sourcePath,
        selectPath: sourcePath,
        ...(codeComponentInstanceId ? { codeComponentInstanceId } : {}),
      },
      remapPath: path => remapPathAfterMove(path, movedPath, sourcePath),
    };
  }
  if (operation === 'wrap') {
    const path = typeof message.path === 'string' ? message.path : '';
    if (!path) return null;
    return {
      message: { operation: 'unwrap', path, childCount: 1, selectPath: path },
      remapPath: candidate => remapPathAfterUnwrap(candidate, path, 1),
    };
  }
  if (operation === 'unwrap') {
    const path = typeof message.path === 'string' ? message.path : '';
    if (!path) return null;
    return {
      message: {
        operation: 'wrap',
        path,
        wrapperMarkup: emptyElementMarkupAtPath(source, path),
        selectPath: path,
      },
      remapPath: candidate => remapPathAfterWrap(candidate, path),
    };
  }
  if (operation === 'retag') {
    const path = typeof message.path === 'string' ? message.path : '';
    const node = buildElementTree(source)
      .flatMap(function flatten(item): ReturnType<typeof buildElementTree> {
        return [item, ...item.children.flatMap(flatten)];
      })
      .find(item => item.path === path);
    if (!node) return null;
    return {
      message: { operation: 'retag', path, tag: node.tag, selectPath: path },
      remapPath: candidate => candidate,
    };
  }
  if (operation === 'replace') {
    const path = typeof message.path === 'string' ? message.path : '';
    const markup = getElementOuterHtml(source, path);
    return {
      message: { operation: 'replace', path, markup, selectPath: path },
      remapPath: candidate => remapPathAfterReplace(candidate, path),
    };
  }
  if (operation === 'replace-body') {
    if (typeof DOMParser === 'undefined') return null;
    const document = new DOMParser().parseFromString(source, 'text/html');
    const attributes = htmlElementAttributes(document.body);
    const styles = parseStyleDeclarations(attributes.style || '');
    const bodyAttributes = (Array.isArray(message.bodyAttributes) ? message.bodyAttributes : [])
      .filter(patch => patch && typeof patch === 'object' && typeof patch.name === 'string')
      .map(patch => ({
        path: '',
        name: String((patch as { name: unknown }).name),
        value: attributes[String((patch as { name: unknown }).name)] ?? null,
      }));
    const bodyStyles = (Array.isArray(message.bodyStyles) ? message.bodyStyles : [])
      .filter(patch => patch && typeof patch === 'object' && typeof patch.property === 'string')
      .map(patch => ({
        path: '',
        property: String((patch as { property: unknown }).property),
        value: styles[String((patch as { property: unknown }).property)] || '',
      }));
    return {
      message: {
        operation: 'replace-body',
        markup: document.body.innerHTML,
        bodyAttributes,
        bodyStyles,
        selectPath: typeof message.selectPath === 'string' ? message.selectPath : '',
      },
      remapPath: () => null,
    };
  }
  return null;
}

export function reconcileSelectionSnapshotWithElement(
  snapshot: SelectionSnapshot,
  authored: EditorElement | undefined,
): SelectionSnapshot {
  if (!authored) return snapshot;
  return {
    ...snapshot,
    tag: authored.tag,
    id: authored.id,
    classes: authored.classes,
    attributes: authored.attributes,
    text: authored.text,
    hasElementChildren: authored.hasElementChildren,
  };
}

export function reconcileSelectionSnapshotWithSource(snapshot: SelectionSnapshot, source: string): SelectionSnapshot {
  let authored: EditorElement | undefined;
  const visit = (items: EditorElement[]) => {
    for (const item of items) {
      if (item.path === snapshot.path) {
        authored = item;
        return;
      }
      visit(item.children);
      if (authored) return;
    }
  };
  try {
    visit(buildElementTree(source));
  } catch {
    return snapshot;
  }
  return reconcileSelectionSnapshotWithElement(snapshot, authored);
}

export function patchSelectionSnapshotAttributes(
  snapshot: SelectionSnapshot,
  changes: Record<string, string | null>,
): SelectionSnapshot {
  const attributes = { ...snapshot.attributes };
  Object.entries(changes).forEach(([name, value]) => {
    if (value === null || value === '') delete attributes[name];
    else attributes[name] = value;
  });
  return {
    ...snapshot,
    attributes,
    id: Object.prototype.hasOwnProperty.call(changes, 'id') ? changes.id?.trim() || '' : snapshot.id,
    classes: Object.prototype.hasOwnProperty.call(changes, 'class')
      ? (changes.class || '').split(/\s+/).filter(Boolean)
      : snapshot.classes,
  };
}

export function remapLockedPaths(paths: string[], targetPath: string, operation: 'duplicate' | 'remove') {
  const target = targetPath.split('/').filter(Boolean);
  const parent = target.slice(0, -1);
  const targetIndex = Number(target.at(-1));
  return paths.flatMap(path => {
    if (operation === 'remove' && (path === targetPath || path.startsWith(`${targetPath}/`))) return [];
    const parts = path.split('/').filter(Boolean);
    if (parts.length < target.length || !parent.every((segment, index) => parts[index] === segment)) return [path];
    const index = Number(parts[target.length - 1]);
    if (!Number.isFinite(index)) return [path];
    if (operation === 'duplicate' && index > targetIndex) parts[target.length - 1] = String(index + 1);
    if (operation === 'remove' && index > targetIndex) parts[target.length - 1] = String(index - 1);
    return [parts.join('/')];
  });
}

/**
 * Produces the exact CSSOM delta for one authored inline-style attribute.
 * Priority is part of the value's identity: a priority-only source change must
 * repaint the mounted canvas just like a numeric or keyword change.
 */
export function diffCanvasLiveStyleDeclarations(
  beforeStyle: string,
  afterStyle: string,
): Array<Omit<CanvasLiveStylePatch, 'path'>> {
  return diffStyleDeclarationDetails(beforeStyle, afterStyle).map(change => ({
    property: change.property,
    value: change.value,
    priority: change.important ? 'important' : '',
  }));
}

export function diffCanvasLiveDom(
  beforeHtml: string,
  afterHtml: string,
): {
  patches: CanvasLiveStylePatch[];
  attributes: CanvasLiveAttributePatch[];
  texts: CanvasLiveTextPatch[];
} {
  const index = (html: string) => {
    const nodes = new Map<string, ReturnType<typeof buildElementTree>[number]>();
    const visit = (items: ReturnType<typeof buildElementTree>) => {
      items.forEach(node => {
        nodes.set(node.path, node);
        visit(node.children);
      });
    };
    visit(buildElementTree(html));
    return nodes;
  };
  const leafTexts = (html: string) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const values = new Map<string, string>();
    const visit = (element: Element, path: string) => {
      values.set(path, element.textContent || '');
      if (element.tagName.toLowerCase() === 'svg') return;
      Array.from(element.children).forEach((child, childIndex) => {
        visit(child, path ? `${path}/${childIndex}` : String(childIndex));
      });
    };
    visit(document.body, '');
    return values;
  };
  const before = index(beforeHtml);
  const after = index(afterHtml);
  const beforeTexts = leafTexts(beforeHtml);
  const afterTexts = leafTexts(afterHtml);
  const patches: CanvasLiveStylePatch[] = [];
  const attributes: CanvasLiveAttributePatch[] = [];
  const texts: CanvasLiveTextPatch[] = [];
  after.forEach((nextNode, path) => {
    const previousNode = before.get(path);
    if (!previousNode || previousNode.tag !== nextNode.tag) return;
    if (
      !previousNode.hasElementChildren &&
      !nextNode.hasElementChildren &&
      beforeTexts.get(path) !== afterTexts.get(path)
    ) {
      texts.push({ path, value: afterTexts.get(path) ?? nextNode.text });
    }
    diffCanvasLiveStyleDeclarations(
      previousNode.attributes.style || '',
      nextNode.attributes.style || '',
    ).forEach(patch => patches.push({ path, ...patch }));
    const attributeNames = new Set([...Object.keys(previousNode.attributes), ...Object.keys(nextNode.attributes)]);
    attributeNames.delete('style');
    attributeNames.forEach(name => {
      const previousValue = previousNode.attributes[name];
      const nextValue = nextNode.attributes[name];
      if (previousValue === nextValue) return;
      attributes.push({
        path,
        name,
        value: nextValue === undefined ? null : nextValue,
      });
    });
  });
  return { patches, attributes, texts };
}

export function canApplyCanvasLiveDomDelta(
  beforeHtml: string,
  afterHtml: string,
  delta: ReturnType<typeof diffCanvasLiveDom>,
) {
  const beforeDocument = new DOMParser().parseFromString(beforeHtml, 'text/html');
  const afterDocument = new DOMParser().parseFromString(afterHtml, 'text/html');
  const unsupportedTags = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template']);
  const directText = (element: Element) =>
    Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.nodeValue || '')
      .join('');
  const compare = (before: Element, after: Element): boolean => {
    const beforeTag = before.tagName.toLowerCase();
    if (beforeTag !== after.tagName.toLowerCase()) return false;
    if (unsupportedTags.has(beforeTag) && before.outerHTML !== after.outerHTML) return false;
    if (beforeTag === 'svg' && before.innerHTML !== after.innerHTML) return false;
    const beforeChildren = Array.from(before.children);
    const afterChildren = Array.from(after.children);
    if (beforeChildren.length !== afterChildren.length) return false;
    if (beforeChildren.length && directText(before) !== directText(after)) return false;
    return beforeChildren.every((child, index) => compare(child, afterChildren[index]));
  };
  if (!compare(beforeDocument.body, afterDocument.body)) return false;
  if (beforeHtml === afterHtml) return true;
  return Boolean(delta.patches.length || delta.attributes.length || delta.texts.length);
}

export function canvasLiveStyleAtom(path: string, property: string) {
  const normalized = normalizeStylePropertyName(property);
  return normalized === 'display' ? `visibility\u0000${path}` : `style\u0000${path}\u0000${normalized}`;
}

export function canvasLiveAttributeAtom(path: string, name: string) {
  const normalized = name.trim().toLowerCase();
  return CANVAS_VISIBILITY_ATTRIBUTE_NAMES.has(normalized)
    ? `visibility\u0000${path}`
    : `attribute\u0000${path}\u0000${normalized}`;
}

export function pendingCanvasLiveStyleHasPayload(pending: PendingCanvasLiveStyle) {
  return Boolean(
    (pending.cssPath && pending.cssText !== undefined) ||
    pending.designTokenCssText !== undefined ||
    pending.patches.length ||
    pending.attributes.length ||
    pending.texts.length ||
    pending.checks.length ||
    pending.interactionDocument,
  );
}

export function supersedePendingCanvasLiveStyle(
  pending: PendingCanvasLiveStyle,
  next: CanvasLiveStyleEnqueueMessage,
): PendingCanvasLiveStyle {
  const nextStyleAtoms = new Set((next.patches || []).map(patch => canvasLiveStyleAtom(patch.path, patch.property)));
  const nextAttributeAtoms = new Set(
    (next.attributes || []).map(patch => canvasLiveAttributeAtom(patch.path, patch.name)),
  );
  const nextCheckAtoms = new Set((next.checks || []).map(check => canvasLiveStyleAtom(check.path, check.property)));
  const nextTextPaths = new Set((next.texts || []).map(patch => patch.path));
  const stylesheetSuperseded = Boolean(next.cssPath && next.cssText !== undefined && pending.cssPath === next.cssPath);
  return {
    ...pending,
    cssPath: stylesheetSuperseded ? undefined : pending.cssPath,
    cssText: stylesheetSuperseded ? undefined : pending.cssText,
    designTokenCssText: next.designTokenCssText !== undefined ? undefined : pending.designTokenCssText,
    patches: pending.patches.filter(patch => !nextStyleAtoms.has(canvasLiveStyleAtom(patch.path, patch.property))),
    attributes: pending.attributes.filter(
      patch => !nextAttributeAtoms.has(canvasLiveAttributeAtom(patch.path, patch.name)),
    ),
    texts: pending.texts.filter(patch => !nextTextPaths.has(patch.path)),
    checks: pending.checks.filter(
      check =>
        !stylesheetSuperseded &&
        !nextStyleAtoms.has(canvasLiveStyleAtom(check.path, check.property)) &&
        !nextAttributeAtoms.has(canvasLiveStyleAtom(check.path, check.property)) &&
        !nextCheckAtoms.has(canvasLiveStyleAtom(check.path, check.property)),
    ),
    interactionDocument: next.interactionDocument ? undefined : pending.interactionDocument,
  };
}
