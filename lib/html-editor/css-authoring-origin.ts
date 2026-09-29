import postcss, { type AtRule } from 'postcss';
import valueParser from 'postcss-value-parser';
import { projectPublicFilePath } from './coded-project';
import {
  DEFAULT_PRIMARY_BREAKPOINT,
  inspectCssRule,
  inspectCssRuleAtViewport,
  inspectCssRuleDeclarationsAtViewport,
  readCssViewportPropertyOwner,
  type Breakpoint,
  type CssEditingContext,
  type CssRuleInspection,
} from './css-patcher';
import type { HtmlProject } from './types';
import { CSS_SHORTHAND_LONGHANDS, isStyleShorthandFor } from './style-utils';

export interface CssAuthoringCascadeEntry {
  /** The file that owns the authored rule/declaration. */
  cssFilePath: string;
  /** The stylesheet linked by the page whose import graph contains this file. */
  rootCssFilePath: string;
  /** Source/cascade order after expanding local @imports. */
  order: number;
  /** Import-level cascade layer ancestry, outermost first. */
  layerPath: string[];
  /** Active feature conditions inherited from @import supports(). */
  supportsConditions: string[];
  /** Active screen media conditions inherited from @import. */
  mediaQueries: string[];
}

export interface CssAuthoringCascadeOptions {
  context?: CssEditingContext;
  breakpoints?: readonly Breakpoint[];
  /** Width of the project's editable Primary/base canvas. */
  primaryWidth?: number;
  /** Pure/testable feature-query hook. The browser path defaults to CSS.supports. */
  supports?: (condition: string) => boolean;
}

export interface CssAuthoringOrigin {
  cssFilePath: string;
  /** Linked root that establishes the winning source file in page cascade. */
  rootCssFilePath: string;
  /** True when this exact selector/state/breakpoint already exists in the file. */
  hasRule: boolean;
  /** True when the file owns the requested property (or its shorthand/all owner). */
  hasProperty: boolean;
  propertyOwner?: CssRuleInspection['propertyOwner'];
  /** Every linked root that must be refreshed when this source file changes. */
  liveRootCssFilePaths: string[];
}

interface InspectedCascadeEntry extends CssAuthoringCascadeEntry {
  inspection: CssRuleInspection;
  exactInspection?: CssRuleInspection;
}

interface LocalCssImport {
  path: string;
  layerName: string;
  supportsCondition: string;
  mediaQuery: string;
}

type LocalCssPreludeEvent =
  | { type: 'layer'; paths: string[][] }
  | { type: 'import'; imported: LocalCssImport };

interface CssAuthoringCascadeBuild {
  entries: CssAuthoringCascadeEntry[];
  /** Full layer paths, in the order the expanded page cascade establishes them. */
  layerPaths: string[][];
}

interface CssLayerOrderNode {
  children: CssLayerOrderNode[];
  childrenByName: Map<string, CssLayerOrderNode>;
}

// Project snapshots replace `files` on every authored change. Keying this
// cache by that immutable collection makes invalidation exact without hashing
// every stylesheet during a selection. A small per-snapshot LRU covers the
// handful of breakpoint/linked-root combinations the Inspector can request.
const CSS_AUTHORING_CASCADE_CACHE_LIMIT = 16;
const cssAuthoringCascadeCache = new WeakMap<object, Map<string, CssAuthoringCascadeBuild>>();
const cssAuthoringOwnDeclarationsCache = new WeakMap<
  Record<string, string>,
  Record<string, string>
>();
const supportsEvaluatorIds = new WeakMap<Function, number>();
let supportsEvaluatorSequence = 0;

function supportsEvaluatorId(evaluator: CssAuthoringCascadeOptions['supports']) {
  const fallback = (globalThis as typeof globalThis & {
    CSS?: { supports?: (condition: string) => boolean };
  }).CSS?.supports;
  const target = evaluator || fallback;
  if (!target) return 0;
  const cached = supportsEvaluatorIds.get(target);
  if (cached) return cached;
  supportsEvaluatorSequence += 1;
  supportsEvaluatorIds.set(target, supportsEvaluatorSequence);
  return supportsEvaluatorSequence;
}

function dirname(path: string) {
  const parts = path.replaceAll('\\', '/').split('/');
  parts.pop();
  return parts.join('/');
}

function normalizePath(path: string) {
  const stack: string[] = [];
  path.replaceAll('\\', '/').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  return stack.join('/');
}

function resolveImportPath(project: HtmlProject, fromPath: string, specifier: string) {
  const trimmed = specifier.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(trimmed)) return '';
  const suffix = trimmed.search(/[?#]/);
  let clean = suffix >= 0 ? trimmed.slice(0, suffix) : trimmed;
  try { clean = decodeURIComponent(clean); } catch { /* keep the authored path */ }
  const root = normalizePath(project.previewRootPath ?? project.rootPath ?? '');
  const requested = normalizePath(`${clean.startsWith('/') ? root : dirname(fromPath)}/${clean}`);
  return projectPublicFilePath(project, requested) || '';
}

function parsedImport(atRule: AtRule, project: HtmlProject, cssFilePath: string, importIndex: number): LocalCssImport | null {
  const parsed = valueParser(atRule.params);
  const tokens = parsed.nodes.filter(node => node.type !== 'space' && node.type !== 'comment');
  const source = tokens[0];
  const specifier = source?.type === 'string' || source?.type === 'word'
    ? source.value
    : source?.type === 'function' && source.value.toLowerCase() === 'url'
      ? valueParser.stringify(source.nodes).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
      : '';
  const path = resolveImportPath(project, cssFilePath, specifier);
  if (!path || !/\.css$/i.test(path)) return null;

  let tokenIndex = 1;
  let layerName = '';
  let supportsCondition = '';
  const layer = tokens[tokenIndex];
  if (layer?.type === 'word' && layer.value.toLowerCase() === 'layer') {
    layerName = `__anonymous_import_${cssFilePath}_${importIndex}`;
    tokenIndex += 1;
  } else if (layer?.type === 'function' && layer.value.toLowerCase() === 'layer') {
    layerName = valueParser.stringify(layer.nodes).trim()
      || `__anonymous_import_${cssFilePath}_${importIndex}`;
    tokenIndex += 1;
  }
  const supports = tokens[tokenIndex];
  if (supports?.type === 'function' && supports.value.toLowerCase() === 'supports') {
    supportsCondition = valueParser.stringify(supports.nodes).trim();
    tokenIndex += 1;
  }
  const mediaQuery = tokens[tokenIndex]
    ? atRule.params.slice(tokens[tokenIndex].sourceIndex).trim()
    : '';
  return { path, layerName, supportsCondition, mediaQuery };
}

function layerNamePaths(value: string) {
  return postcss.list.comma(value)
    .map(name => name.split('.').map(segment => segment.trim()).filter(Boolean))
    .filter(path => path.length);
}

/**
 * Only syntactically effective top-level imports are dependencies. PostCSS
 * excludes comments from this walk, and the prelude guard mirrors the browser:
 * @import after an ordinary rule/block is invalid and cannot own a declaration.
 * Statement-form @layer is retained as an event because it may legally precede
 * an import and permanently establishes cross-file layer order at that point.
 */
function localCssPrelude(project: HtmlProject, cssFilePath: string) {
  const source = project.files[cssFilePath]?.text || '';
  try {
    const root = postcss.parse(source);
    const events: LocalCssPreludeEvent[] = [];
    let preludeOpen = true;
    let importIndex = 0;
    root.nodes.forEach(node => {
      if (node.type === 'comment') return;
      if (node.type !== 'atrule') {
        preludeOpen = false;
        return;
      }
      const atRule = node as AtRule;
      const name = atRule.name.toLowerCase();
      if (name === 'charset') return;
      if (name === 'layer' && !atRule.nodes) {
        if (preludeOpen) events.push({ type: 'layer', paths: layerNamePaths(atRule.params) });
        return;
      }
      if (name !== 'import' || !preludeOpen) {
        preludeOpen = false;
        return;
      }
      const imported = parsedImport(atRule, project, cssFilePath, importIndex++);
      if (imported) events.push({ type: 'import', imported });
    });
    return events;
  } catch {
    return [];
  }
}

function splitMediaQueryList(value: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') depth = Math.max(0, depth - 1);
    else if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

function widthConditionIsActive(condition: string, viewportWidth: number) {
  const legacy = condition.match(/^\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i);
  if (legacy) return legacy[1].toLowerCase() === 'min'
    ? viewportWidth >= Number(legacy[2])
    : viewportWidth <= Number(legacy[2]);
  const range = condition.match(/^\(\s*width\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)px\s*\)$/i);
  if (!range) return null;
  const threshold = Number(range[2]);
  if (range[1] === '<=') return viewportWidth <= threshold;
  if (range[1] === '>=') return viewportWidth >= threshold;
  if (range[1] === '<') return viewportWidth < threshold;
  return viewportWidth > threshold;
}

function mediaBranchIsActive(branch: string, viewportWidth: number) {
  let value = branch.trim().toLowerCase();
  let negated = false;
  if (value.startsWith('not ')) {
    negated = true;
    value = value.slice(4).trim();
  }
  if (value.startsWith('only ')) value = value.slice(5).trim();
  const type = value.match(/^(all|screen|print)\b/)?.[1] || '';
  if (type) value = value.slice(type.length).trim();
  let active = type !== 'print';
  if (value.startsWith('and ')) value = value.slice(4).trim();
  if (value) {
    const conditions = value.match(/\([^()]*\)/g) || [];
    const residue = conditions.reduce((next, condition) => next.replace(condition, ''), value)
      .replace(/\band\b/gi, '')
      .trim();
    if (residue || !conditions.length) active = false;
    else {
      const results = conditions.map(condition => widthConditionIsActive(condition, viewportWidth));
      // Unknown media features are not safely active. In particular, do not
      // invert "unknown" into true for a `not (...)` query.
      if (results.some(result => result === null)) return false;
      active = active && results.every(Boolean);
    }
  }
  return negated ? !active : active;
}

function mediaQueryIsActive(query: string, viewportWidth: number) {
  if (!query.trim()) return true;
  return splitMediaQueryList(query).some(branch => mediaBranchIsActive(branch, viewportWidth));
}

function supportsConditionIsActive(
  condition: string,
  evaluator?: (condition: string) => boolean,
) {
  if (!condition) return true;
  try {
    if (evaluator) return evaluator(condition);
    const css = (globalThis as typeof globalThis & {
      CSS?: { supports?: (condition: string) => boolean };
    }).CSS;
    return Boolean(css?.supports?.(condition));
  } catch {
    return false;
  }
}

function contextViewportWidth(options: CssAuthoringCascadeOptions) {
  const id = options.context?.breakpoint || 'base';
  return id === 'base'
    ? Number.isFinite(options.primaryWidth)
      ? Math.max(0, Number(options.primaryWidth))
      : DEFAULT_PRIMARY_BREAKPOINT.width
    : options.breakpoints?.find(breakpoint => breakpoint.id === id)?.width
      ?? DEFAULT_PRIMARY_BREAKPOINT.width;
}

/**
 * Expands page-linked stylesheets in real source order. CSS imports participate
 * where their @import appears (before the importing file's ordinary rules).
 * A recursion stack prevents cycles without incorrectly deduplicating a file
 * imported again by a later root, where it legitimately has a later cascade
 * position.
 */
function buildCssAuthoringCascadeUncached(
  project: HtmlProject,
  linkedCssFilePaths: readonly string[],
  options: CssAuthoringCascadeOptions = {},
): CssAuthoringCascadeBuild {
  const entries: CssAuthoringCascadeEntry[] = [];
  const layerPaths: string[][] = [];
  const establishedLayers = new Set<string>();
  const viewportWidth = contextViewportWidth(options);
  const establishLayer = (path: string[]) => {
    const established: string[] = [];
    path.forEach(segment => {
      established.push(segment);
      const key = established.join('.');
      if (establishedLayers.has(key)) return;
      establishedLayers.add(key);
      layerPaths.push([...established]);
    });
  };
  const append = (
    rawPath: string,
    rootCssFilePath: string,
    ancestors: ReadonlySet<string>,
    qualifiers: Pick<CssAuthoringCascadeEntry, 'layerPath' | 'supportsConditions' | 'mediaQueries'>,
  ) => {
    const cssFilePath = projectPublicFilePath(project, rawPath) || '';
    if (!cssFilePath || project.files[cssFilePath]?.text === undefined || !/\.css$/i.test(cssFilePath)) return;
    if (ancestors.has(cssFilePath)) return;
    const nextAncestors = new Set(ancestors).add(cssFilePath);
    localCssPrelude(project, cssFilePath).forEach(event => {
      if (event.type === 'layer') {
        event.paths.forEach(path => establishLayer([...qualifiers.layerPath, ...path]));
        return;
      }
      const imported = event.imported;
      if (!supportsConditionIsActive(imported.supportsCondition, options.supports)) return;
      if (!mediaQueryIsActive(imported.mediaQuery, viewportWidth)) return;
      const importedLayerPath = imported.layerName
        ? [...qualifiers.layerPath, imported.layerName]
        : qualifiers.layerPath;
      if (imported.layerName) establishLayer(importedLayerPath);
      append(imported.path, rootCssFilePath, nextAncestors, {
        layerPath: importedLayerPath,
        supportsConditions: imported.supportsCondition
          ? [...qualifiers.supportsConditions, imported.supportsCondition]
          : qualifiers.supportsConditions,
        mediaQueries: imported.mediaQuery
          ? [...qualifiers.mediaQueries, imported.mediaQuery]
          : qualifiers.mediaQueries,
      });
    });
    // Imports have now been expanded at their exact prelude positions. The
    // inspection metadata supplies every remaining local layer in first-seen
    // order (including nested layers); duplicate prelude statements coalesce.
    const layerInspection = inspectCssRule(
      project.files[cssFilePath]?.text || '',
      options.context
        ? { ...options.context, cssFilePath }
        : {
            target: 'rule',
            selector: ':root',
            cssFilePath,
            pseudo: 'base',
            breakpoint: 'base',
          },
      '',
      options.breakpoints ? [...options.breakpoints] : undefined,
    );
    layerInspection.cascadeLayers.forEach(name => {
      const localPath = layerNamePaths(name)[0] || [];
      establishLayer([...qualifiers.layerPath, ...localPath]);
    });
    entries.push({
      cssFilePath,
      rootCssFilePath,
      order: entries.length,
      layerPath: qualifiers.layerPath,
      supportsConditions: qualifiers.supportsConditions,
      mediaQueries: qualifiers.mediaQueries,
    });
  };
  linkedCssFilePaths.forEach(rawRootPath => {
    const rootCssFilePath = projectPublicFilePath(project, rawRootPath) || '';
    if (rootCssFilePath) append(rootCssFilePath, rootCssFilePath, new Set(), {
      layerPath: [],
      supportsConditions: [],
      mediaQueries: [],
    });
  });
  return { entries, layerPaths };
}

function cssAuthoringCascadeCacheKey(
  project: HtmlProject,
  linkedCssFilePaths: readonly string[],
  options: CssAuthoringCascadeOptions,
) {
  const context = options.context;
  return JSON.stringify([
    project.rootPath || '',
    project.previewRootPath ?? '',
    linkedCssFilePaths,
    // Cascade topology is independent from the selected rule/property. Only
    // the active breakpoint changes layer/media discovery, so class selection
    // can reuse the same expanded import graph.
    context?.breakpoint || 'base',
    options.breakpoints
      ? options.breakpoints.map(({ id, mode, width }) => [id, mode, width])
      : null,
    Number.isFinite(options.primaryWidth) ? Number(options.primaryWidth) : null,
    contextViewportWidth(options),
    supportsEvaluatorId(options.supports),
  ]);
}

function buildCssAuthoringCascade(
  project: HtmlProject,
  linkedCssFilePaths: readonly string[],
  options: CssAuthoringCascadeOptions = {},
): CssAuthoringCascadeBuild {
  const files = project.files as object;
  let cache = cssAuthoringCascadeCache.get(files);
  if (!cache) {
    cache = new Map();
    cssAuthoringCascadeCache.set(files, cache);
  }
  const key = cssAuthoringCascadeCacheKey(project, linkedCssFilePaths, options);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const built = buildCssAuthoringCascadeUncached(project, linkedCssFilePaths, options);
  cache.set(key, built);
  while (cache.size > CSS_AUTHORING_CASCADE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
  return built;
}

function cloneCssAuthoringCascadeEntries(entries: readonly CssAuthoringCascadeEntry[]) {
  return entries.map(entry => ({
    ...entry,
    layerPath: [...entry.layerPath],
    supportsConditions: [...entry.supportsConditions],
    mediaQueries: [...entry.mediaQueries],
  }));
}

export function cssAuthoringCascade(
  project: HtmlProject,
  linkedCssFilePaths: readonly string[],
  options: CssAuthoringCascadeOptions = {},
): CssAuthoringCascadeEntry[] {
  // Public callers receive value copies so they cannot mutate the shared
  // internal snapshot later consumed by origin/declaration reads.
  return cloneCssAuthoringCascadeEntries(
    buildCssAuthoringCascade(project, linkedCssFilePaths, options).entries,
  );
}

function linkedRootsForFile(entries: readonly CssAuthoringCascadeEntry[], cssFilePath: string) {
  return Array.from(new Set(
    entries
      .filter(entry => entry.cssFilePath === cssFilePath)
      .map(entry => entry.rootCssFilePath),
  ));
}

function createLayerOrderRegistry(paths: readonly string[][]) {
  const root: CssLayerOrderNode = { children: [], childrenByName: new Map() };
  paths.forEach(path => {
    let node = root;
    path.forEach(name => {
      let child = node.childrenByName.get(name);
      if (!child) {
        child = { children: [], childrenByName: new Map() };
        node.childrenByName.set(name, child);
        node.children.push(child);
      }
      node = child;
    });
  });
  return root;
}

function effectiveOwnerLayerPath(entry: InspectedCascadeEntry) {
  return [
    ...entry.layerPath,
    ...(entry.inspection.propertyOwner?.cascadeLayerPath || []),
  ];
}

function globalLayerRank(path: readonly string[], root: CssLayerOrderNode) {
  const rank: number[] = [];
  let node = root;
  path.forEach(name => {
    const index = node.children.findIndex(child => child === node.childrenByName.get(name));
    if (index < 0) return;
    rank.push(index);
    node = node.children[index];
  });
  // Direct declarations in a layer come after all of its nested sublayers.
  // At root this same sentinel represents the unlayered author tier.
  rank.push(node.children.length);
  return rank;
}

function compareLayerRank(left: readonly number[], right: readonly number[]) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function candidateWins(
  current: InspectedCascadeEntry | undefined,
  candidate: InspectedCascadeEntry,
  layers: CssLayerOrderNode,
) {
  if (!current) return true;
  const currentImportant = Boolean(current.inspection.propertyOwner?.important);
  const candidateImportant = Boolean(candidate.inspection.propertyOwner?.important);
  if (currentImportant !== candidateImportant) return candidateImportant;
  const layerDifference = compareLayerRank(
    globalLayerRank(effectiveOwnerLayerPath(candidate), layers),
    globalLayerRank(effectiveOwnerLayerPath(current), layers),
  );
  if (layerDifference) return candidateImportant
    ? layerDifference < 0
    : layerDifference > 0;
  if (candidate.order !== current.order) return candidate.order > current.order;
  return (candidate.inspection.propertyOwner?.sourceOrder || 0)
    >= (current.inspection.propertyOwner?.sourceOrder || 0);
}

/**
 * Resolves the source file that really owns a class edit.
 *
 * Resolution is property-specific: two declarations of the same class may
 * intentionally live in different linked files. Existing declarations win by
 * CSS priority and then expanded stylesheet order. If the property is new, it
 * is appended to the last existing rule for the selector. Only when no source
 * rule exists at all does the requested/fallback authoring sheet win.
 */
export function resolveCssAuthoringOrigin(
  project: HtmlProject,
  linkedCssFilePaths: readonly string[],
  context: CssEditingContext,
  property = '',
  breakpoints?: Breakpoint[],
  primaryWidth?: number,
): CssAuthoringOrigin {
  const cascade = buildCssAuthoringCascade(
    project,
    linkedCssFilePaths,
    { context, breakpoints, primaryWidth },
  );
  const entries = cascade.entries;
  const layers = createLayerOrderRegistry(cascade.layerPaths);
  const viewportWidth = contextViewportWidth({ context, breakpoints, primaryWidth });
  // A Primary canvas can still be affected by authored min/max-width queries.
  // Resolve against the concrete viewport for every property-bearing edit;
  // exactInspection remains available for deciding whether the requested tier
  // already owns a selector.
  const inspectActiveResponsiveCascade = Boolean(property);
  const inspected = entries.map((entry): InspectedCascadeEntry => {
    const entryContext = { ...context, cssFilePath: entry.cssFilePath };
    const exactInspection = inspectCssRule(
      project.files[entry.cssFilePath]?.text || '',
      entryContext,
      property,
      breakpoints,
    );
    return {
      ...entry,
      exactInspection,
      inspection: inspectActiveResponsiveCascade
        ? inspectCssRuleAtViewport(
            project.files[entry.cssFilePath]?.text || '',
            entryContext,
            property,
            viewportWidth,
            breakpoints,
          )
        : exactInspection,
    };
  });
  const withRule = inspected.filter(entry => entry.exactInspection?.hasRule);
  const withProperty = property
    ? inspected.filter(entry => Boolean(entry.inspection.propertyOwner))
    : [];
  const propertyWinner = withProperty.reduce<InspectedCascadeEntry | undefined>(
    (winner, candidate) => candidateWins(winner, candidate, layers) ? candidate : winner,
    undefined,
  );
  const ruleWinner = withRule.at(-1);
  const requestedPath = projectPublicFilePath(project, context.cssFilePath) || '';
  const linkedFallback = entries.at(-1)?.cssFilePath || '';
  const anyCssFallback = Object.values(project.files)
    .filter(file => file.text !== undefined && /\.css$/i.test(file.path) && !file.path.startsWith('.incode/'))
    .at(-1)?.path || '';
  const selected = propertyWinner || ruleWinner;
  const cssFilePath = selected?.cssFilePath || requestedPath || linkedFallback || anyCssFallback;
  const liveRootCssFilePaths = linkedRootsForFile(entries, cssFilePath);
  return {
    cssFilePath,
    rootCssFilePath: selected?.rootCssFilePath
      || liveRootCssFilePaths.at(-1)
      || cssFilePath,
    hasRule: Boolean(selected?.exactInspection?.hasRule),
    hasProperty: Boolean(propertyWinner),
    ...(propertyWinner?.inspection.propertyOwner
      ? { propertyOwner: propertyWinner.inspection.propertyOwner }
      : {}),
    liveRootCssFilePaths: liveRootCssFilePaths.length
      ? liveRootCssFilePaths
      : cssFilePath
        ? [cssFilePath]
        : [],
  };
}

/** Expand only a winning shorthand, leaving ambiguous values to the canvas. */
function authoredOwnerPropertyValue(
  owner: NonNullable<CssRuleInspection['propertyOwner']>,
  property: string,
  style?: CSSStyleDeclaration,
): string | undefined {
  if (owner.property === property) return owner.value;
  if (!isStyleShorthandFor(owner.property, property)) return undefined;
  if (style) {
    style.cssText = '';
    style.setProperty(owner.property, owner.value);
    const expanded = style.getPropertyValue(property).trim();
    if (expanded) return expanded;
    // CSSOM intentionally leaves pending-substitution shorthands unexpanded.
    // A var() may supply one, two or four values, so computed fallback is safer.
    return undefined;
  }
  const nodes = valueParser(owner.value).nodes.filter(node => node.type !== 'space');
  if (!nodes.length || nodes.some(node => (
    node.type === 'comment' || node.type === 'div'
    || (node.type === 'function' && node.value.toLowerCase() === 'var')
    || (node.type === 'word' && /^(?:initial|inherit|unset|revert|revert-layer)$/i.test(node.value))
  ))) return undefined;
  const parts = nodes.map(node => valueParser.stringify(node));
  const longhands = CSS_SHORTHAND_LONGHANDS[owner.property] || [];
  const index = longhands.indexOf(property);
  if (index < 0) return undefined;
  if (owner.property === 'gap' && parts.length <= 2) return parts[index] || parts[0];
  if (['padding', 'margin', 'inset', 'border-color', 'border-width', 'border-style', 'border-radius'].includes(owner.property) && parts.length <= 4) {
    return [parts[0], parts[1] || parts[0], parts[2] || parts[0], parts[3] || parts[1] || parts[0]][index];
  }
  return undefined;
}

/**
 * Merges declarations for the Inspector across the same linked/imported
 * cascade used by writes. It deliberately retains values (not source nodes);
 * updateStyle resolves the owning file again against the latest project.
 */
export function readCssAuthoringDeclarations(
  project: HtmlProject,
  linkedCssFilePaths: readonly string[],
  context: CssEditingContext,
  breakpoints?: Breakpoint[],
  primaryWidth?: number,
) {
  const cascade = buildCssAuthoringCascade(
    project,
    linkedCssFilePaths,
    { context, breakpoints, primaryWidth },
  );
  const layers = createLayerOrderRegistry(cascade.layerPaths);
  const viewportWidth = contextViewportWidth({ context, breakpoints, primaryWidth });
  const inspected = cascade.entries.map(entry => ({
    entry,
    inspection: inspectCssRuleDeclarationsAtViewport(
      project.files[entry.cssFilePath]?.text || '',
      { ...context, cssFilePath: entry.cssFilePath },
      viewportWidth,
      breakpoints,
    ),
  }));
  const properties = new Set<string>();
  const exactAuthoredProperties = new Set<string>();
  const includeProperty = (property: string) => {
    if (properties.has(property)) return;
    properties.add(property);
    (CSS_SHORTHAND_LONGHANDS[property] || []).forEach(includeProperty);
  };
  inspected.forEach(({ inspection }) => {
    Object.keys(inspection.declarations).forEach(includeProperty);
    Object.keys(inspection.exactDeclarations).forEach(property => exactAuthoredProperties.add(property));
  });
  let style: CSSStyleDeclaration | undefined;
  try {
    if (typeof document !== 'undefined') {
      const candidate = document.createElement('div').style;
      if (typeof candidate?.setProperty === 'function' && typeof candidate.getPropertyValue === 'function') style = candidate;
    }
  } catch { /* Server-side readers use the safe lexical expansion below. */ }
  const values = new Map<string, string | undefined>();
  const resolveValue = (property: string, owner: NonNullable<CssRuleInspection['propertyOwner']>) => {
    const key = `${property}\u0000${owner.property}\u0000${owner.value}`;
    if (!values.has(key)) values.set(key, authoredOwnerPropertyValue(owner, property, style));
    return values.get(key);
  };
  const resolved: Record<string, string> = {};
  const own: Record<string, string> = {};
  properties.forEach(property => {
    let winner: InspectedCascadeEntry | undefined;
    let exactWinner: InspectedCascadeEntry | undefined;
    inspected.forEach(({ entry, inspection }) => {
      const propertyOwner = readCssViewportPropertyOwner(inspection, property);
      if (propertyOwner) {
        const candidate = { ...entry, inspection: { ...inspection, propertyOwner } };
        if (candidateWins(winner, candidate, layers)) winner = candidate;
      }
      if (exactAuthoredProperties.has(property)) {
        const exactOwner = readCssViewportPropertyOwner(inspection, property, true);
        if (exactOwner) {
          const candidate = { ...entry, inspection: { ...inspection, propertyOwner: exactOwner } };
          if (candidateWins(exactWinner, candidate, layers)) exactWinner = candidate;
        }
      }
    });
    const owner = winner?.inspection.propertyOwner;
    if (owner) {
      const value = resolveValue(property, owner);
      if (value !== undefined) resolved[property] = value;
    }
    // Derived longhands describe effective values, not independently authored
    // controls. Keeping them out of the own map preserves Gap link/unlink mode.
    const ownOwner = exactWinner?.inspection.propertyOwner;
    if (ownOwner?.property === property) own[property] = ownOwner.value;
  });
  cssAuthoringOwnDeclarationsCache.set(resolved, own);
  return resolved;
}

/** Exact selector/pseudo/breakpoint declarations paired with an Inspector read. */
export function cssAuthoringOwnDeclarations(values: Record<string, string>) {
  return cssAuthoringOwnDeclarationsCache.get(values) || values;
}

/** Compose values inherited from another authoring surface with a later
 * overlay while keeping Inspector “own” markers scoped to the overlay's exact
 * selector/state/breakpoint declarations. */
export function overlayCssAuthoringDeclarations(
  inherited: Record<string, string>,
  overlay: Record<string, string>,
) {
  const resolved = { ...inherited, ...overlay };
  cssAuthoringOwnDeclarationsCache.set(
    resolved,
    cssAuthoringOwnDeclarations(overlay),
  );
  return resolved;
}
