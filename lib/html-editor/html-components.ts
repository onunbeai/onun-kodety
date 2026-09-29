import type { HtmlProject } from './types';
import { relativePageHref } from './editor-wordpress-helpers';
import { ensureCssLink } from './file-attachments';
import {
  HTML_COMPONENTS_DIRECTORY,
  createHtmlComponentBundle,
  createHtmlComponentBundleReference,
  mergeHtmlComponentBundleResults,
  rebaseHtmlComponentMarkup,
  rebaseHtmlComponentReferenceValue,
  type HtmlComponentBundleReference,
} from './component-bundle';
import {
  ensureInsertedElementClasses,
  getElementOuterHtml,
  inspectSourceElements,
  patchReplaceElementOuterHtml,
  patchReplaceLocatedElementsOuterHtml,
} from './source-patcher';
import {
  normalizeHtmlComponentVariantOverrides,
  type HtmlComponentVariantOverrides,
} from './component-variant-inheritance';

export type {
  HtmlComponentVariantCssOverride,
  HtmlComponentVariantLayerOverride,
  HtmlComponentVariantOverrides,
} from './component-variant-inheritance';

export {
  HTML_COMPONENTS_DIRECTORY,
  createHtmlComponentBundleReference,
  htmlComponentManifestFilePath,
  htmlComponentStyleFilePath,
} from './component-bundle';
export type { HtmlComponentBundleReference } from './component-bundle';

/**
 * A rule authored while a component master is open must also load on the real
 * pages where that component is materialized. Component masters live under
 * `.incode/`, so linking only the active document leaves the rule trapped in
 * the studio and makes it disappear as soon as the author returns to the page.
 */
export function linkHtmlComponentStylesheet(project: HtmlProject, cssFilePath: string): HtmlProject {
  if (!cssFilePath || project.files[cssFilePath]?.text === undefined) return project;
  let files = project.files;
  Object.entries(project.files).forEach(([path, file]) => {
    if (
      file.text === undefined
      || !/\.html?$/i.test(path)
      || (path.startsWith('.incode/') && !path.startsWith(`${HTML_COMPONENTS_DIRECTORY}/`))
    ) return;
    const href = relativePageHref(path, cssFilePath);
    const text = ensureCssLink(file.text, href);
    if (text === file.text) return;
    if (files === project.files) files = { ...project.files };
    files[path] = { ...file, text };
  });
  return files === project.files ? project : { ...project, files };
}

export type HtmlComponentVariableType =
  | 'text'
  | 'rich_text'
  | 'number'
  | 'image'
  | 'link'
  | 'audio'
  | 'video'
  | 'icon'
  | 'variant';

export interface HtmlComponentVariableBinding {
  targetNodeId: string;
  attribute: string;
}

export interface HtmlComponentVariable {
  id: string;
  name: string;
  type: HtmlComponentVariableType;
  /**
   * Every property that consumes this variable. The legacy singular fields
   * below remain serialized for older projects, but runtime resolution always
   * uses this collection so one variable can drive any number of elements.
   */
  bindings?: HtmlComponentVariableBinding[];
  targetNodeId: string;
  attribute: string;
  defaultValue: string;
  placeholder?: string;
  /** Page-relative URL lookup emitted only in the disposable runtime registry. */
  runtimeValues?: Record<string, string>;
}

export interface HtmlComponentVariant {
  id: string;
  name: string;
  filePath: string;
  /** Explicit property ownership for non-primary variant layers. */
  overrides?: HtmlComponentVariantOverrides;
  /** Marks variants whose legacy differences have been migrated to ownership. */
  inheritanceVersion?: 1;
}

export interface HtmlComponentDefinition {
  id: string;
  name: string;
  /** Private HTML/CSS/manifest authoring package used by new components. */
  bundle?: HtmlComponentBundleReference;
  variants: HtmlComponentVariant[];
  variables: HtmlComponentVariable[];
  createdAt: string;
  updatedAt: string;
}

export interface HtmlComponentLibrary {
  version: 1;
  components: HtmlComponentDefinition[];
}

export type HtmlComponentOverrides = Record<string, string>;

export interface HtmlComponentInstanceContext {
  componentId: string;
  variantId: string;
  instanceId: string;
  overrides: HtmlComponentOverrides;
  rootPath: string;
}

export interface HtmlComponentLiveReplacement {
  path: string;
  markup: string;
}

export interface HtmlComponentRuntimeDefinition {
  id: string;
  name: string;
  bundle?: HtmlComponentBundleReference;
  variants: Array<{ id: string; name: string; filePath: string; markup: string }>;
  variables: HtmlComponentVariable[];
}

export interface HtmlComponentRuntimeLibrary {
  version: 1;
  components: HtmlComponentRuntimeDefinition[];
}

export interface HtmlComponentNodeOption {
  id: string;
  label: string;
  tag: string;
}

export interface HtmlComponentVariableVariantOption {
  id: string;
  name: string;
}

export const HTML_COMPONENT_VARIANT_ATTRIBUTE = 'data-kodety-component-variant';

const EMPTY_LIBRARY: HtmlComponentLibrary = { version: 1, components: [] };
const COMPONENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/;
const runtimeLibraryCache = new WeakMap<object, {
  dependencyFiles: object[];
  runtime: HtmlComponentRuntimeLibrary;
}>();
interface CompiledRuntimeComponent {
  component: HtmlComponentRuntimeDefinition;
  variantsById: Map<string, HtmlComponentRuntimeDefinition['variants'][number]>;
  variablesById: Map<string, HtmlComponentVariable>;
  variantVariable?: HtmlComponentVariable;
  defaultVariant?: HtmlComponentRuntimeDefinition['variants'][number];
  variantRoots: Map<string, Element | null>;
}
const compiledRuntimeCache = new WeakMap<HtmlComponentRuntimeLibrary, Map<string, CompiledRuntimeComponent>>();

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanId(value: unknown) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return COMPONENT_ID_PATTERN.test(candidate) ? candidate : '';
}

function cleanString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeVariable(value: unknown): HtmlComponentVariable | null {
  const item = record(value);
  if (!item) return null;
  const id = cleanId(item.id);
  const type = cleanString(item.type) as HtmlComponentVariableType;
  if (!id || !['text', 'rich_text', 'number', 'image', 'link', 'audio', 'video', 'icon', 'variant'].includes(type)) return null;
  const legacyBinding = {
    targetNodeId: cleanId(item.targetNodeId),
    attribute: cleanString(item.attribute),
  };
  const rawBindings = Array.isArray(item.bindings)
    ? item.bindings.flatMap(bindingValue => {
        const binding = record(bindingValue);
        if (!binding) return [];
        const targetNodeId = cleanId(binding.targetNodeId);
        return targetNodeId
          ? [{ targetNodeId, attribute: cleanString(binding.attribute) }]
          : [];
      })
    : [];
  if (legacyBinding.targetNodeId) rawBindings.unshift(legacyBinding);
  const seenBindings = new Set<string>();
  const bindings = rawBindings.filter(binding => {
    const key = `${binding.targetNodeId}\u0000${binding.attribute}`;
    if (seenBindings.has(key)) return false;
    seenBindings.add(key);
    return true;
  });
  const firstBinding = bindings[0] || legacyBinding;
  return {
    id,
    name: cleanString(item.name, 'Variable').trim() || 'Variable',
    type,
    bindings,
    targetNodeId: firstBinding.targetNodeId,
    attribute: firstBinding.attribute,
    defaultValue: cleanString(item.defaultValue),
    placeholder: cleanString(item.placeholder) || undefined,
  };
}

export function htmlComponentVariableBindings(
  variable: Pick<HtmlComponentVariable, 'bindings' | 'targetNodeId' | 'attribute'>,
): HtmlComponentVariableBinding[] {
  const candidates = [
    ...(variable.bindings || []),
    ...(variable.targetNodeId
      ? [{ targetNodeId: variable.targetNodeId, attribute: variable.attribute || '' }]
      : []),
  ];
  const seen = new Set<string>();
  return candidates.filter(binding => {
    if (!binding.targetNodeId) return false;
    const key = `${binding.targetNodeId}\u0000${binding.attribute || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function htmlComponentVariableHasBinding(
  variable: HtmlComponentVariable,
  targetNodeId: string,
  attribute: string,
) {
  return htmlComponentVariableBindings(variable).some(binding => (
    binding.targetNodeId === targetNodeId && binding.attribute === attribute
  ));
}

export function htmlComponentVariableHasVariantBinding(
  variable: HtmlComponentVariable,
  targetNodeId: string,
) {
  return variable.type === 'variant' && htmlComponentVariableBindings(variable).some(binding => (
    binding.targetNodeId === targetNodeId
    && (!binding.attribute || binding.attribute === HTML_COMPONENT_VARIANT_ATTRIBUTE)
  ));
}

/**
 * An unbound Variant property selects the state of the component that owns it.
 * A bound Variant property is different: it controls a nested component root.
 */
export function htmlComponentVariableControlsRootVariant(
  variable: HtmlComponentVariable,
) {
  return variable.type === 'variant' && htmlComponentVariableBindings(variable).length === 0;
}

/**
 * Resolve the values exposed by a Variant property. Root properties use the
 * owner's variants; targeted properties use the variants of their nested
 * component target(s).
 */
export function htmlComponentVariableVariantOptions(
  project: HtmlProject,
  library: HtmlComponentLibrary,
  owner: HtmlComponentDefinition,
  variable: HtmlComponentVariable,
): HtmlComponentVariableVariantOption[] {
  if (variable.type !== 'variant') return [];
  const bindings = htmlComponentVariableBindings(variable);
  if (!bindings.length) {
    return owner.variants.map(variant => ({ id: variant.id, name: variant.name }));
  }
  const targetNodeIds = new Set(bindings.flatMap(binding => (
    !binding.attribute || binding.attribute === HTML_COMPONENT_VARIANT_ATTRIBUTE
      ? [binding.targetNodeId]
      : []
  )));
  const targetComponentIds = new Set<string>();
  owner.variants.forEach(variant => {
    const source = project.files[variant.filePath]?.text;
    if (source === undefined) return;
    inspectSourceElements(source).forEach(node => {
      const nodeId = node.attributes['data-kodety-component-node'] || '';
      const componentId = node.attributes['data-kodety-component-id'] || '';
      if (targetNodeIds.has(nodeId) && componentId) targetComponentIds.add(componentId);
    });
  });
  const labelsById = new Map<string, Set<string>>();
  targetComponentIds.forEach(componentId => {
    const target = library.components.find(component => component.id === componentId);
    target?.variants.forEach(variant => {
      const labels = labelsById.get(variant.id) || new Set<string>();
      labels.add(targetComponentIds.size > 1
        ? `${target.name} · ${variant.name}`
        : variant.name);
      labelsById.set(variant.id, labels);
    });
  });
  return Array.from(labelsById, ([id, labels]) => ({
    id,
    name: Array.from(labels).join(' / '),
  }));
}

export function withHtmlComponentVariableBinding(
  variable: HtmlComponentVariable,
  binding: HtmlComponentVariableBinding,
) {
  const bindings = htmlComponentVariableBindings(variable).filter(current => !(
    current.targetNodeId === binding.targetNodeId && current.attribute === binding.attribute
  ));
  bindings.push(binding);
  return {
    ...variable,
    bindings,
    targetNodeId: bindings[0]?.targetNodeId || '',
    attribute: bindings[0]?.attribute || '',
  };
}

export function withoutHtmlComponentVariableBinding(
  variable: HtmlComponentVariable,
  targetNodeId: string,
  attribute: string,
) {
  const bindings = htmlComponentVariableBindings(variable).filter(binding => !(
    binding.targetNodeId === targetNodeId && binding.attribute === attribute
  ));
  return {
    ...variable,
    bindings,
    targetNodeId: bindings[0]?.targetNodeId || '',
    attribute: bindings[0]?.attribute || '',
  };
}

function normalizeVariant(value: unknown): HtmlComponentVariant | null {
  const item = record(value);
  if (!item) return null;
  const id = cleanId(item.id);
  const filePath = cleanString(item.filePath).replaceAll('\\', '/').replace(/^\/+/, '');
  if (!id || !filePath.startsWith(`${HTML_COMPONENTS_DIRECTORY}/`) || !/\.html?$/i.test(filePath)) return null;
  const overrides = normalizeHtmlComponentVariantOverrides(item.overrides);
  return {
    id,
    name: cleanString(item.name, 'Variant').trim() || 'Variant',
    filePath,
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(item.inheritanceVersion === 1 ? { inheritanceVersion: 1 as const } : {}),
  };
}

function normalizeBundle(value: unknown, componentId: string): HtmlComponentBundleReference | undefined {
  const item = record(value);
  if (!item || item.version !== 1) return undefined;
  const directory = `${HTML_COMPONENTS_DIRECTORY}/${componentId}/`;
  const manifestFilePath = cleanString(item.manifestFilePath).replaceAll('\\', '/').replace(/^\/+/, '');
  const styleFilePath = cleanString(item.styleFilePath).replaceAll('\\', '/').replace(/^\/+/, '');
  if (
    !manifestFilePath.startsWith(directory)
    || !styleFilePath.startsWith(directory)
    || !/\.json$/i.test(manifestFilePath)
    || !/\.css$/i.test(styleFilePath)
  ) return undefined;
  return { version: 1, manifestFilePath, styleFilePath };
}

function normalizeComponent(value: unknown): HtmlComponentDefinition | null {
  const item = record(value);
  if (!item) return null;
  const id = cleanId(item.id);
  if (!id) return null;
  const variants = Array.isArray(item.variants)
    ? item.variants.map(normalizeVariant).filter((variant): variant is HtmlComponentVariant => Boolean(variant))
    : [];
  if (!variants.length) return null;
  return {
    id,
    name: cleanString(item.name, 'Component').trim() || 'Component',
    bundle: normalizeBundle(item.bundle, id),
    variants,
    variables: Array.isArray(item.variables)
      ? item.variables.map(normalizeVariable).filter((variable): variable is HtmlComponentVariable => Boolean(variable))
      : [],
    createdAt: cleanString(item.createdAt) || new Date(0).toISOString(),
    updatedAt: cleanString(item.updatedAt) || new Date(0).toISOString(),
  };
}

export function normalizeHtmlComponentLibrary(value: unknown): HtmlComponentLibrary {
  const item = record(value);
  if (!item || !Array.isArray(item.components)) return EMPTY_LIBRARY;
  const seen = new Set<string>();
  const components = item.components
    .map(normalizeComponent)
    .filter((component): component is HtmlComponentDefinition => {
      if (!component || seen.has(component.id)) return false;
      seen.add(component.id);
      return true;
    });
  return { version: 1, components };
}

export function createHtmlComponentId(prefix: string) {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'component';
  return `${safePrefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export function htmlComponentVariantFilePath(componentId: string, variantId: string) {
  return `${HTML_COMPONENTS_DIRECTORY}/${componentId}/${variantId}.html`;
}

function bodyMarkup(source: string) {
  const document = new DOMParser().parseFromString(source, 'text/html');
  return document.body.firstElementChild?.outerHTML || '';
}

function relativeBaseFor(path: string) {
  const depth = path.split('/').slice(0, -1).filter(Boolean).length;
  return depth ? '../'.repeat(depth) : './';
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function componentEditorDocument(
  sourcePage: string,
  markup: string,
  component: Pick<HtmlComponentDefinition, 'id' | 'name' | 'bundle'>,
  variant: Pick<HtmlComponentVariant, 'id' | 'name' | 'filePath'>,
) {
  const sourceDocument = new DOMParser().parseFromString(sourcePage, 'text/html');
  const bundled = component.bundle?.version === 1;
  const head = bundled
    ? [
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtmlText(component.name)}</title>`,
        ...Array.from(sourceDocument.head.querySelectorAll('link[rel][href]')).flatMap(link => {
          const href = link.getAttribute('href') || '';
          const relations = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
          return /^(?:https?:)?\/\//i.test(href)
            && (relations.includes('stylesheet') || relations.includes('preconnect'))
            ? [link.outerHTML]
            : [];
        }),
        `<link rel="stylesheet" href="${relativePageHref(variant.filePath, component.bundle!.styleFilePath)}" data-kodety-component-style>`,
      ].join('\n')
    : Array.from(sourceDocument.head.children)
        .filter(element => ['META', 'TITLE', 'STYLE', 'LINK'].includes(element.tagName))
        .map(element => element.outerHTML)
        .join('\n');
  // A master is authored at the active breakpoint width. Keeping the body at
  // 100% preserves normal line wrapping and responsive descendants; only its
  // height is intrinsic. The old max-content projection made a full-width
  // component infinitely wide and clipped its text in the editor.
  const editorProjection = `<style data-kodety-component-editor-projection>html{width:100%;min-width:0;min-height:0;background:transparent!important;overflow-x:hidden;overflow-y:visible}body[data-kodety-component-editor]{display:flow-root;width:100%;max-width:100%;height:max-content;min-width:0!important;min-height:0!important;margin:0!important;box-sizing:border-box;background:transparent!important;overflow-x:hidden;overflow-y:visible}body[data-kodety-component-editor]>:first-child{position:relative!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;inset-block-start:auto!important;inset-block-end:auto!important;inset-inline-start:auto!important;inset-inline-end:auto!important}</style>`;
  const base = bundled ? '' : `<base href="${relativeBaseFor(variant.filePath)}">\n`;
  return `<!doctype html>\n<html><head>${base}${head}\n${editorProjection}\n</head><body data-kodety-component-editor="${component.id}" data-kodety-component-variant-editor="${variant.id}" style="min-height:0;margin:0">\n${markup}\n</body></html>`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Component variant CSS is scoped to attributes on the editor document body.
 * Masters created before that identity became explicit may retain the primary
 * variant id after duplication, so switching variants would load the correct
 * file while continuing to match the primary variant's CSS. Repair only the
 * body identity and preserve the authored document byte-for-byte otherwise.
 */
export function normalizeHtmlComponentEditorDocumentIdentity(
  source: string,
  componentId: string,
  variantId: string,
) {
  const bodyMatch = /<body\b[^>]*>/i.exec(source);
  if (!bodyMatch) return source;
  let openingTag = bodyMatch[0];
  const setAttribute = (name: string, value: string) => {
    const escaped = escapeHtmlAttribute(value);
    const existing = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    openingTag = existing.test(openingTag)
      ? openingTag.replace(existing, `$1"${escaped}"`)
      : openingTag.replace(/>$/, ` ${name}="${escaped}">`);
  };
  setAttribute('data-kodety-component-editor', componentId);
  setAttribute('data-kodety-component-variant-editor', variantId);
  if (openingTag === bodyMatch[0]) return source;
  return `${source.slice(0, bodyMatch.index)}${openingTag}${source.slice(bodyMatch.index + bodyMatch[0].length)}`;
}

export function componentMarkupFromEditorSource(source: string) {
  return bodyMarkup(source);
}

/**
 * Upgrade copied-head legacy masters to the lightweight HTML/CSS/manifest
 * package. Assets remain in their original project paths and are only rebased.
 */
export function migrateLegacyHtmlComponentBundles(
  project: HtmlProject,
  library: HtmlComponentLibrary,
  componentIds?: Iterable<string>,
) {
  const requested = componentIds ? new Set(componentIds) : null;
  let files = project.files;
  let changed = false;
  const components = library.components.map(component => {
    if (component.bundle || (requested && !requested.has(component.id))) return component;
    const primary = component.variants[0];
    const primarySource = primary ? project.files[primary.filePath]?.text : undefined;
    if (!primary || primarySource === undefined) return component;
    const primaryMarkup = componentMarkupFromEditorSource(primarySource);
    if (!primaryMarkup) return component;
    const bundledComponent: HtmlComponentDefinition = {
      ...component,
      bundle: createHtmlComponentBundleReference(component.id),
      updatedAt: new Date().toISOString(),
    };
    const variantBundles = component.variants.flatMap(variant => {
      const source = files[variant.filePath]?.text;
      const markup = source === undefined ? '' : componentMarkupFromEditorSource(source);
      if (source === undefined || !markup) return [];
      return [{
        variant,
        source,
        bundle: createHtmlComponentBundle(
          { ...project, files },
          variant.filePath,
          source,
          markup,
          bundledComponent,
          variant,
        ),
      }];
    });
    const bundle = mergeHtmlComponentBundleResults(
      bundledComponent,
      variantBundles.map(entry => entry.bundle),
    );
    if (!bundle) return component;
    if (files === project.files) files = { ...project.files };
    files[bundledComponent.bundle!.styleFilePath] = {
      path: bundledComponent.bundle!.styleFilePath,
      mimeType: 'text/css',
      text: bundle.styleText,
    };
    files[bundledComponent.bundle!.manifestFilePath] = {
      path: bundledComponent.bundle!.manifestFilePath,
      mimeType: 'application/json',
      text: bundle.manifestText,
    };
    variantBundles.forEach(({ variant, source, bundle: variantBundle }) => {
      files[variant.filePath] = {
        ...files[variant.filePath],
        path: variant.filePath,
        mimeType: files[variant.filePath]?.mimeType || 'text/html',
        text: componentEditorDocument(
          source,
          variantBundle.markup,
          bundledComponent,
          variant,
        ),
      };
    });
    changed = true;
    return bundledComponent;
  });
  return {
    project: changed ? { ...project, files } : project,
    library: changed ? { version: 1 as const, components } : library,
  };
}

function stylesheetReferencesComponentScope(css: string, componentId: string) {
  if (!css || !componentId) return false;
  const escaped = componentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\[\\s*data-kodety-component-scope\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped})\\s*\\]`,
  ).test(css);
}

function componentManifestStylesheets(source: string | undefined) {
  if (!source) return new Set<string>();
  try {
    const value = JSON.parse(source) as {
      dependencies?: { stylesheets?: unknown };
    };
    return new Set(
      Array.isArray(value.dependencies?.stylesheets)
        ? value.dependencies.stylesheets.filter((path): path is string => typeof path === 'string')
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

/**
 * Repair bundles produced by the old nested-conversion path. Those bundles
 * already own HTML/CSS files, but their selectors still contain the parent
 * component scope and therefore work only while mounted below that parent.
 */
export function repairNestedHtmlComponentBundles(
  project: HtmlProject,
  library: HtmlComponentLibrary,
  componentIds?: Iterable<string>,
) {
  const requested = componentIds ? new Set(componentIds) : null;
  let files = project.files;
  let changed = false;
  library.components.forEach(component => {
    const bundle = component.bundle;
    if (!bundle || (requested && !requested.has(component.id))) return;
    const currentStyle = files[bundle.styleFilePath]?.text || '';
    const sourceStylesheets = componentManifestStylesheets(
      files[bundle.manifestFilePath]?.text,
    );
    if (!currentStyle || !sourceStylesheets.size) return;

    const parentContext = library.components.flatMap(parent => {
      if (
        parent.id === component.id
        || !parent.bundle
        || !sourceStylesheets.has(parent.bundle.styleFilePath)
        || !stylesheetReferencesComponentScope(currentStyle, parent.id)
      ) return [];
      return parent.variants.flatMap(parentVariant => {
        const source = files[parentVariant.filePath]?.text;
        if (source === undefined) return [];
        const containsChild = inspectSourceElements(source).some(node => (
          node.attributes['data-kodety-component-id'] === component.id
        ));
        return containsChild ? [{ parentVariant, source }] : [];
      });
    })[0];
    if (!parentContext) return;

    const projectWithLatestFiles = { ...project, files };
    const variantBundles = component.variants.flatMap(variant => {
      const source = files[variant.filePath]?.text;
      const markup = source === undefined ? '' : componentMarkupFromEditorSource(source);
      if (source === undefined || !markup) return [];
      return [createHtmlComponentBundle(
        projectWithLatestFiles,
        parentContext.parentVariant.filePath,
        parentContext.source,
        markup,
        component,
        variant,
      )];
    });
    const repaired = mergeHtmlComponentBundleResults(component, variantBundles);
    if (!repaired || repaired.styleText === currentStyle) return;
    if (files === project.files) files = { ...project.files };
    files[bundle.styleFilePath] = {
      ...files[bundle.styleFilePath],
      path: bundle.styleFilePath,
      mimeType: files[bundle.styleFilePath]?.mimeType || 'text/css',
      text: repaired.styleText,
    };
    files[bundle.manifestFilePath] = {
      ...files[bundle.manifestFilePath],
      path: bundle.manifestFilePath,
      mimeType: files[bundle.manifestFilePath]?.mimeType || 'application/json',
      text: repaired.manifestText,
    };
    changed = true;
  });
  return {
    project: changed ? { ...project, files } : project,
    library,
  };
}

export function ensureComponentNodeIds(markup: string) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) throw new Error('The selected layer does not contain valid HTML.');
  const nodeAttribute = 'data-kodety-component-node';
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const reservedIds = new Set(
    elements.flatMap(element => {
      const id = element.getAttribute(nodeAttribute) || '';
      return COMPONENT_ID_PATTERN.test(id) ? [id] : [];
    }),
  );
  const claimedIds = new Set<string>();
  const duplicateCounts = new Map<string, number>();
  const createUniqueId = (prefix: string) => {
    let id = '';
    do id = createHtmlComponentId(prefix);
    while (reservedIds.has(id) || claimedIds.has(id));
    reservedIds.add(id);
    claimedIds.add(id);
    return id;
  };
  const createStableDuplicateId = (originalId: string) => {
    let sequence = (duplicateCounts.get(originalId) || 1) + 1;
    let candidate = '';
    do {
      const suffix = `-${sequence}`;
      const base = originalId.slice(0, 160 - suffix.length).replace(/-+$/g, '') || 'node';
      candidate = `${base}${suffix}`;
      sequence += 1;
    } while (reservedIds.has(candidate) || claimedIds.has(candidate));
    duplicateCounts.set(originalId, sequence - 1);
    reservedIds.add(candidate);
    claimedIds.add(candidate);
    return candidate;
  };

  elements.forEach(element => {
    const id = element.getAttribute(nodeAttribute) || '';
    if (!COMPONENT_ID_PATTERN.test(id)) {
      element.setAttribute(nodeAttribute, createUniqueId('node'));
      return;
    }
    if (!claimedIds.has(id)) {
      claimedIds.add(id);
      return;
    }
    element.setAttribute(nodeAttribute, createStableDuplicateId(id));
  });
  return ensureInsertedElementClasses(root.outerHTML);
}

/** Persist classes in masters, so refreshing an inserted instance retains them. */
export function ensureHtmlComponentClasses(
  project: HtmlProject,
  library: HtmlComponentLibrary,
  componentIds?: Iterable<string>,
): HtmlProject {
  const pending = componentIds ? [...componentIds] : library.components.map(component => component.id);
  const visited = new Set<string>();
  let files = project.files;
  for (const componentId of pending) {
    if (visited.has(componentId)) continue;
    visited.add(componentId);
    const component = library.components.find(candidate => candidate.id === componentId);
    component?.variants.forEach(variant => {
      const file = files[variant.filePath];
      if (file?.text === undefined) return;
      const elements = inspectSourceElements(file.text);
      const root = elements.find(element => element.path === '0');
      if (!root) return;
      elements.forEach(element => {
        const nestedId = element.attributes['data-kodety-component-id'];
        if (nestedId && !visited.has(nestedId)) pending.push(nestedId);
      });
      const markup = file.text.slice(root.startOffset, root.endOffset);
      const prepared = ensureInsertedElementClasses(markup, component.id);
      if (prepared === markup) return;
      if (files === project.files) files = { ...files };
      files[variant.filePath] = {
        ...file,
        text: file.text.slice(0, root.startOffset) + prepared + file.text.slice(root.endOffset),
      };
    });
  }
  return files === project.files ? project : { ...project, files };
}

function componentElements(root: Element) {
  return [root, ...Array.from(root.querySelectorAll('*'))];
}

function componentNode(root: Element, targetNodeId: string) {
  if (!targetNodeId) return null;
  return componentElements(root).find(
    element => element.getAttribute('data-kodety-component-node') === targetNodeId,
  ) || null;
}

function componentNodeIndex(root: Element) {
  return new Map(
    componentElements(root).flatMap(element => {
      const id = element.getAttribute('data-kodety-component-node') || '';
      return id ? [[id, element] as const] : [];
    }),
  );
}

export function componentNodeOptions(markup: string): HtmlComponentNodeOption[] {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return [];
  return componentElements(root).flatMap(element => {
    const id = element.getAttribute('data-kodety-component-node') || '';
    if (!id) return [];
    const tag = element.tagName.toLowerCase();
    const label = element.getAttribute('data-label')
      || element.id
      || Array.from(element.classList)[0]
      || element.textContent?.trim().slice(0, 28)
      || tag;
    return [{ id, label, tag }];
  });
}

export function defaultHtmlComponentVariableAttribute(
  type: HtmlComponentVariableType,
  tag = '',
) {
  if (type === 'link') return 'href';
  if (type === 'icon') return 'data-icon';
  if (type === 'image') return tag === 'source' ? 'srcset' : 'src';
  if (type === 'audio' || type === 'video') return 'src';
  return '';
}

/**
 * Pick a useful, non-destructive initial target for a newly-created variable.
 * Text variables deliberately prefer a leaf with authored copy instead of the
 * component root: binding the root would replace its complete child tree.
 */
export function suggestHtmlComponentVariableTarget(
  markup: string,
  type: HtmlComponentVariableType,
) {
  if (type === 'variant') return '';
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return '';
  const elements = componentElements(root).filter(
    element => Boolean(element.getAttribute('data-kodety-component-node')),
  );
  const bySelector = (selector: string) => elements.find(element => element.matches(selector));
  let target: Element | undefined;
  if (type === 'text' || type === 'rich_text') {
    target = elements.find(element => (
      element.children.length === 0
      && Boolean(element.textContent?.trim())
      && !element.matches('script, style')
    ));
  } else if (type === 'image') {
    target = bySelector('img, source');
  } else if (type === 'link') {
    target = bySelector('a, area');
  } else if (type === 'audio') {
    target = bySelector('audio, audio source');
  } else if (type === 'video') {
    target = bySelector('video, video source');
  } else if (type === 'icon') {
    target = bySelector('[data-icon], svg, i');
  }
  return target?.getAttribute('data-kodety-component-node') || '';
}

function componentVariableDefaultValue(
  root: Element,
  variable: HtmlComponentVariable,
  nodes?: Map<string, Element>,
) {
  const binding = htmlComponentVariableBindings(variable)[0];
  const target = binding
    ? nodes
      ? nodes.get(binding.targetNodeId) || null
      : componentNode(root, binding.targetNodeId)
    : null;
  if (!target) return variable.defaultValue;
  return componentVariableBindingValue(target, binding, variable);
}

function componentVariableBindingValue(
  target: Element,
  binding: HtmlComponentVariableBinding,
  variable: HtmlComponentVariable,
) {
  if (variable.type === 'variant') {
    return target.getAttribute(binding.attribute || HTML_COMPONENT_VARIANT_ATTRIBUTE)
      || variable.defaultValue;
  }
  if (variable.type === 'rich_text') {
    return binding.attribute
      ? target.getAttribute(binding.attribute) || ''
      : target.innerHTML;
  }
  if (variable.type === 'text' || variable.type === 'number') {
    return binding.attribute
      ? target.getAttribute(binding.attribute) || ''
      : target.textContent || '';
  }
  const attribute = binding.attribute
    || defaultHtmlComponentVariableAttribute(variable.type, target.tagName.toLowerCase());
  return attribute ? target.getAttribute(attribute) || '' : '';
}

export function htmlComponentVariableDefaultValue(
  markup: string,
  variable: HtmlComponentVariable,
) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  return root ? componentVariableDefaultValue(root, variable) : variable.defaultValue;
}

export function syncHtmlComponentVariableDefaults(
  markup: string,
  variables: HtmlComponentVariable[],
) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return variables;
  const nodes = componentNodeIndex(root);
  return variables.map(variable => {
    if (!htmlComponentVariableBindings(variable).length) return variable;
    const values = htmlComponentVariableBindings(variable).flatMap(binding => {
      const target = nodes.get(binding.targetNodeId);
      return target ? [componentVariableBindingValue(target, binding, variable)] : [];
    });
    // The variable value is the source of truth for every binding. When a
    // legacy/direct canvas edit changed only one bound node, prefer the single
    // value that differs from the previous default and immediately fan it out
    // to every binding on materialization. Never let the arbitrary first
    // binding silently overwrite a user's edit on the second/third element.
    const distinctValues = [...new Set(values)];
    const changedValues = distinctValues.filter(value => value !== variable.defaultValue);
    const defaultValue = distinctValues.length === 1
      ? distinctValues[0]
      : changedValues.length === 1
        ? changedValues[0]
        : variable.defaultValue;
    return defaultValue === variable.defaultValue ? variable : { ...variable, defaultValue };
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64ToBytes(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function encodeHtmlComponentOverrides(overrides: HtmlComponentOverrides) {
  if (!Object.keys(overrides).length) return '';
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(overrides)));
}

export function decodeHtmlComponentOverrides(value: string | null | undefined): HtmlComponentOverrides {
  if (!value) return {};
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64ToBytes(value)));
    const item = record(parsed);
    if (!item) return {};
    return Object.fromEntries(
      Object.entries(item).flatMap(([key, current]) =>
        cleanId(key) && typeof current === 'string' ? [[key, current]] : [],
      ),
    );
  } catch {
    return {};
  }
}

function applyVariable(
  root: Element,
  variable: HtmlComponentVariable,
  rawValue: string,
  nodes?: Map<string, Element>,
) {
  const value = rawValue;
  const bindings = htmlComponentVariableBindings(variable);
  // An unbound Variant variable selects this component's own master and is
  // resolved before parsing below. A bound one targets a nested component
  // instance, so stamp its base variant before recursive materialization.
  if (variable.type === 'variant' && !bindings.length) return;
  bindings.forEach(binding => {
    const target = nodes
      ? nodes.get(binding.targetNodeId) || null
      : componentNode(root, binding.targetNodeId);
    if (!target) return;
    if (variable.type === 'variant') {
      if (!target.hasAttribute('data-kodety-component-id')) return;
      const attribute = binding.attribute || HTML_COMPONENT_VARIANT_ATTRIBUTE;
      if (value) target.setAttribute(attribute, value);
      else target.removeAttribute(attribute);
      return;
    }
    if (variable.type === 'rich_text') {
      if (binding.attribute) {
        if (value) target.setAttribute(binding.attribute, value);
        else target.removeAttribute(binding.attribute);
      } else {
        target.innerHTML = value;
      }
      return;
    }
    if (variable.type === 'text' || variable.type === 'number') {
      if (binding.attribute) {
        if (value) target.setAttribute(binding.attribute, value);
        else target.removeAttribute(binding.attribute);
      } else {
        target.textContent = value;
      }
      return;
    }
    const attribute = binding.attribute
      || defaultHtmlComponentVariableAttribute(variable.type, target.tagName.toLowerCase());
    if (!attribute) return;
    if (value) target.setAttribute(attribute, value);
    else target.removeAttribute(attribute);
  });
}

/** Materialize a component's declared defaults into its authored master. */
export function applyHtmlComponentVariableDefaults(
  markup: string,
  variables: HtmlComponentVariable[],
) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return markup;
  const nodes = componentNodeIndex(root);
  variables.forEach(variable => applyVariable(root, variable, variable.defaultValue, nodes));
  return root.outerHTML;
}

export function runtimeHtmlComponentLibrary(
  project: HtmlProject,
  library: HtmlComponentLibrary,
): HtmlComponentRuntimeLibrary {
  // Page-only edits retain both the metadata file and every component master
  // file object. Reuse the parsed runtime across those revisions; component
  // metadata/master edits naturally invalidate one of the identities below.
  const metadataFile = project.files['.incode/project.json'];
  const dependencyFiles = library.components.flatMap(component => (
    [
      ...component.variants.map(variant => project.files[variant.filePath] as object | undefined),
      ...(component.bundle
        ? [
            project.files[component.bundle.styleFilePath] as object | undefined,
            project.files[component.bundle.manifestFilePath] as object | undefined,
          ]
        : []),
    ]
  )).filter((file): file is object => Boolean(file));
  const cached = metadataFile ? runtimeLibraryCache.get(metadataFile) : undefined;
  if (
    cached
    && cached.dependencyFiles.length === dependencyFiles.length
    && cached.dependencyFiles.every((file, index) => file === dependencyFiles[index])
  ) return cached.runtime;
  const runtime: HtmlComponentRuntimeLibrary = {
    version: 1,
    components: library.components.map(component => ({
      id: component.id,
      name: component.name,
      bundle: component.bundle,
      variables: component.variables,
      variants: component.variants.flatMap(variant => {
        const source = project.files[variant.filePath]?.text;
        const markup = source === undefined ? '' : componentMarkupFromEditorSource(source);
        return markup ? [{ id: variant.id, name: variant.name, filePath: variant.filePath, markup }] : [];
      }),
    })),
  };
  if (metadataFile) runtimeLibraryCache.set(metadataFile, { dependencyFiles, runtime });
  return runtime;
}

function renderRuntimeComponent(
  runtime: HtmlComponentRuntimeLibrary,
  componentId: string,
  variantId: string,
  instanceId: string,
  overrides: HtmlComponentOverrides,
  stack: string[] = [],
  project?: HtmlProject,
  targetPagePath = '',
): string {
  if (stack.includes(componentId) || stack.length > 20) return '';
  let compiledComponents = compiledRuntimeCache.get(runtime);
  if (!compiledComponents) {
    compiledComponents = new Map(runtime.components.map(component => {
      const variantVariable = component.variables.find(htmlComponentVariableControlsRootVariant);
      const variantsById = new Map(component.variants.map(variant => [variant.id, variant]));
      return [component.id, {
        component,
        variantsById,
        variablesById: new Map(
          component.variables
            .filter(variable => variable.type === 'variant' || htmlComponentVariableBindings(variable).length > 0)
            .map(variable => [variable.id, variable]),
        ),
        variantVariable,
        defaultVariant: variantsById.get(variantVariable?.defaultValue || '') || component.variants[0],
        variantRoots: new Map(),
      }];
    }));
    compiledRuntimeCache.set(runtime, compiledComponents);
  }
  const compiled = compiledComponents.get(componentId);
  if (!compiled) return '';
  const { component, variablesById, variantsById, variantVariable } = compiled;
  const effectiveOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([id, value]) => {
      const variable = variablesById.get(id);
      return Boolean(
        variable
        && value !== variable.defaultValue
        && (
          variable.type !== 'variant'
          || (htmlComponentVariableBindings(variable).length
            ? Boolean(value)
            : variantsById.has(value))
        ),
      );
    }),
  );
  const baseVariant = variantsById.get(variantId) || compiled.defaultVariant;
  if (!baseVariant) return '';
  const overriddenVariantId = variantVariable
    && Object.prototype.hasOwnProperty.call(effectiveOverrides, variantVariable.id)
    ? effectiveOverrides[variantVariable.id]
    : '';
  const variant = variantsById.get(overriddenVariantId) || baseVariant;
  if (!compiled.variantRoots.has(variant.id)) {
    const parsed = new DOMParser().parseFromString(variant.markup, 'text/html');
    compiled.variantRoots.set(variant.id, parsed.body.firstElementChild);
  }
  // DOMParser is one of the dominant costs on pages with many instances. Each
  // immutable runtime variant is parsed once and cloned for each projection.
  let root = compiled.variantRoots.get(variant.id)?.cloneNode(true) as Element | undefined;
  if (!root) return '';
  const authoredRoot = root;
  const document = root.ownerDocument;
  const nodes = componentNodeIndex(root);
  component.variables.forEach(variable => {
    applyVariable(authoredRoot, variable, effectiveOverrides[variable.id] ?? variable.defaultValue, nodes);
  });
  if (component.bundle && project && targetPagePath) {
    const rebased = rebaseHtmlComponentMarkup(
      project,
      root.outerHTML,
      variant.filePath,
      targetPagePath,
      { componentId: component.id },
    );
    const parsed = new DOMParser().parseFromString(rebased, 'text/html');
    root = parsed.body.firstElementChild || root;
  }
  root.setAttribute('data-kodety-component-id', component.id);
  // Distinct from the instance's stable base variant below: CSS overrides
  // authored in a non-primary state scope against the variant actually being
  // rendered (including a variable-driven state).
  root.setAttribute('data-kodety-component-state-variant', variant.id);
  // Keep the instance's base choice stable while a variant variable override
  // changes the rendered master. Resetting that override can then reliably
  // return to the base variant instead of getting stuck on the override.
  root.setAttribute('data-kodety-component-variant', baseVariant.id);
  root.setAttribute('data-kodety-component-instance', instanceId || createHtmlComponentId('instance'));
  root.setAttribute('data-label', component.name);
  const encoded = encodeHtmlComponentOverrides(effectiveOverrides);
  if (encoded) root.setAttribute('data-kodety-component-overrides', encoded);
  else root.removeAttribute('data-kodety-component-overrides');

  // Render only immediate nested component roots. Descendants of those roots
  // are handled recursively; visiting them here too used to repeat entire
  // nested subtrees and could grow toward O(instances ²).
  const nested = Array.from(root.querySelectorAll('[data-kodety-component-id]')).filter(
    element => element.parentElement?.closest('[data-kodety-component-id]') === root,
  );
  const nestedInstanceIds = new Set<string>();
  nested.forEach(element => {
    const nestedComponentId = element.getAttribute('data-kodety-component-id') || '';
    const nestedVariantId = element.getAttribute('data-kodety-component-variant') || '';
    let nestedInstanceId = element.getAttribute('data-kodety-component-instance') || '';
    if (!nestedInstanceId || nestedInstanceIds.has(nestedInstanceId)) {
      do nestedInstanceId = createHtmlComponentId('instance');
      while (nestedInstanceIds.has(nestedInstanceId));
    }
    nestedInstanceIds.add(nestedInstanceId);
    const nestedOverrides = decodeHtmlComponentOverrides(element.getAttribute('data-kodety-component-overrides'));
    const markup = renderRuntimeComponent(
      runtime,
      nestedComponentId,
      nestedVariantId,
      nestedInstanceId,
      nestedOverrides,
      [...stack, componentId],
      project,
      targetPagePath,
    );
    if (!markup) return;
    const holder = document.createElement('template');
    holder.innerHTML = markup;
    const replacement = holder.content.firstElementChild;
    if (replacement) element.replaceWith(replacement);
  });
  return root.outerHTML;
}

/**
 * Render an instance from an already prepared runtime library.
 *
 * Page hydration can contain dozens of component instances. Preparing the
 * runtime parses every component master, so doing it inside the instance loop
 * turns one canvas refresh into N complete library rebuilds. Keep this helper
 * public for callers that render a batch while preserving the convenient
 * project-based entry point below.
 */
export function renderHtmlComponentInstanceFromRuntime(
  runtime: HtmlComponentRuntimeLibrary,
  componentId: string,
  variantId = '',
  instanceId = createHtmlComponentId('instance'),
  overrides: HtmlComponentOverrides = {},
  project?: HtmlProject,
  targetPagePath = '',
) {
  return renderRuntimeComponent(
    runtime,
    componentId,
    variantId,
    instanceId,
    overrides,
    [],
    project,
    targetPagePath,
  );
}

export function renderHtmlComponentInstance(
  project: HtmlProject,
  library: HtmlComponentLibrary,
  componentId: string,
  variantId = '',
  instanceId = createHtmlComponentId('instance'),
  overrides: HtmlComponentOverrides = {},
  targetPagePath = project.mainHtmlPath,
) {
  return renderHtmlComponentInstanceFromRuntime(
    runtimeHtmlComponentLibrary(project, library),
    componentId,
    variantId,
    instanceId,
    overrides,
    project,
    targetPagePath,
  );
}

export function htmlComponentInstanceAtPath(
  source: string,
  path: string,
): HtmlComponentInstanceContext | null {
  const nodes = inspectSourceElements(source);
  const ancestors = nodes
    .filter(node => path === node.path || path.startsWith(`${node.path}/`))
    .sort((left, right) => right.path.length - left.path.length);
  const root = ancestors.find(node => node.attributes['data-kodety-component-id']);
  if (!root) return null;
  return {
    componentId: root.attributes['data-kodety-component-id'],
    variantId: root.attributes['data-kodety-component-variant'] || '',
    instanceId: root.attributes['data-kodety-component-instance'] || '',
    overrides: decodeHtmlComponentOverrides(root.attributes['data-kodety-component-overrides']),
    rootPath: root.path,
  };
}

export function refreshHtmlComponentInstancesInSource(
  source: string,
  project: HtmlProject,
  library: HtmlComponentLibrary,
  preparedRuntime?: HtmlComponentRuntimeLibrary,
  pagePath = project.mainHtmlPath,
) {
  if (!library.components.length || !/data-kodety-component-id\s*=/i.test(source)) return source;
  // One source-aware parse supplies both ancestry and replacement offsets.
  // Previously DOMParser built the tree and parse5 parsed the same page again
  // just to locate the replacement ranges.
  const nodes = inspectSourceElements(source);
  const componentPaths = new Set(
    nodes
      .filter(node => node.attributes['data-kodety-component-id'])
      .map(node => node.path),
  );
  const roots = nodes
    .filter(node => node.attributes['data-kodety-component-id'])
    .filter(node => {
      const parts = node.path.split('/');
      return !parts.slice(0, -1).some((_, index) => (
        componentPaths.has(parts.slice(0, index + 1).join('/'))
      ));
    })
    .sort((left, right) => right.path.localeCompare(left.path, undefined, { numeric: true }));
  // Build/parse every master once per document refresh, not once per instance.
  const runtime = preparedRuntime || runtimeHtmlComponentLibrary(project, library);
  const reservedInstanceIds = new Set(
    nodes.flatMap(node => {
      const instanceId = node.attributes['data-kodety-component-instance'] || '';
      return instanceId ? [instanceId] : [];
    }),
  );
  const claimedInstanceIds = new Set<string>();
  const instanceIdByPath = new Map<string, string>();
  [...roots]
    .sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }))
    .forEach(node => {
      let instanceId = node.attributes['data-kodety-component-instance'] || '';
      if (!instanceId || claimedInstanceIds.has(instanceId)) {
        do instanceId = createHtmlComponentId('instance');
        while (reservedInstanceIds.has(instanceId) || claimedInstanceIds.has(instanceId));
      }
      reservedInstanceIds.add(instanceId);
      claimedInstanceIds.add(instanceId);
      instanceIdByPath.set(node.path, instanceId);
    });
  const replacements = roots.flatMap(node => {
    try {
      const componentId = node.attributes['data-kodety-component-id'];
      const variantId = node.attributes['data-kodety-component-variant'] || '';
      // Old versions could duplicate or omit this identity. Normalize every
      // top-level authored instance before rendering so compiled selectors are
      // one-to-one and an event can never fire on a sibling component.
      const instanceId = instanceIdByPath.get(node.path) || createHtmlComponentId('instance');
      const overrides = decodeHtmlComponentOverrides(node.attributes['data-kodety-component-overrides']);
      const markup = renderHtmlComponentInstanceFromRuntime(
        runtime,
        componentId,
        variantId,
        instanceId,
        overrides,
        project,
        pagePath,
      );
      return markup ? [{
        startOffset: node.startOffset,
        endOffset: node.endOffset,
        markup,
      }] : [];
    } catch {
      // One malformed/stale instance must not take down the whole canvas or the
      // page transition out of the component editor. Keep its authored HTML so
      // it remains detachable and repairable from the inspector.
      return [];
    }
  });
  try {
    return patchReplaceLocatedElementsOuterHtml(source, replacements);
  } catch {
    // Keep the page usable if a malformed authored document made one location
    // impossible to resolve as a batch.
    return source;
  }
}

/**
 * Describe a component-only page update as stable root replacements. Returning
 * null means something outside component instances also changed and the caller
 * must use its generic reconciliation path. This proof lets the Builder update
 * an already-mounted page iframe without navigating or replacing its srcDoc.
 */
export function htmlComponentLiveReplacements(
  beforeSource: string,
  afterSource: string,
): HtmlComponentLiveReplacement[] | null {
  if (beforeSource === afterSource) return [];
  try {
    const beforeNodes = inspectSourceElements(beforeSource);
    const afterNodes = inspectSourceElements(afterSource);
    const componentPaths = new Set(
      afterNodes
        .filter(node => node.attributes['data-kodety-component-id'])
        .map(node => node.path),
    );
    const roots = afterNodes.filter(node => {
      if (!node.attributes['data-kodety-component-id']) return false;
      const parts = node.path.split('/');
      return !parts.slice(0, -1).some((_, index) => (
        componentPaths.has(parts.slice(0, index + 1).join('/'))
      ));
    });
    const beforeByPath = new Map(beforeNodes.map(node => [node.path, node]));
    const replacements = roots.flatMap(node => {
      const previous = beforeByPath.get(node.path);
      if (
        !previous
        || previous.attributes['data-kodety-component-id'] !== node.attributes['data-kodety-component-id']
        || previous.attributes['data-kodety-component-instance'] !== node.attributes['data-kodety-component-instance']
      ) return [];
      const beforeMarkup = getElementOuterHtml(beforeSource, node.path);
      const markup = getElementOuterHtml(afterSource, node.path);
      return beforeMarkup === markup ? [] : [{ path: node.path, markup }];
    });
    if (!replacements.length) return null;
    const projected = replacements.reduce(
      (source, replacement) => patchReplaceElementOuterHtml(source, replacement.path, replacement.markup),
      beforeSource,
    );
    return projected === afterSource ? replacements : null;
  } catch {
    return null;
  }
}

export function detachHtmlComponentInstance(source: string, rootPath: string) {
  const markup = getElementOuterHtml(source, rootPath);
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return source;
  [
    'data-kodety-component-id',
    'data-kodety-component-variant',
    'data-kodety-component-state-variant',
    'data-kodety-component-instance',
    'data-kodety-component-overrides',
  ].forEach(attribute => root.removeAttribute(attribute));
  return patchReplaceElementOuterHtml(source, rootPath, root.outerHTML);
}

export function injectHtmlComponentRuntimeRegistry(
  html: string,
  project: HtmlProject,
  library: HtmlComponentLibrary,
  preparedRuntime?: HtmlComponentRuntimeLibrary,
  pagePath = project.mainHtmlPath,
) {
  if (!library.components.length || /data-kodety-component-registry/i.test(html)) return html;
  const runtime = preparedRuntime || runtimeHtmlComponentLibrary(project, library);
  const runtimeValues = new Map<string, Map<string, Set<string>>>();
  try {
    inspectSourceElements(html).forEach(node => {
      const componentId = node.attributes['data-kodety-component-id'] || '';
      if (!componentId) return;
      const overrides = decodeHtmlComponentOverrides(node.attributes['data-kodety-component-overrides']);
      Object.entries(overrides).forEach(([variableId, value]) => {
        let byVariable = runtimeValues.get(componentId);
        if (!byVariable) {
          byVariable = new Map();
          runtimeValues.set(componentId, byVariable);
        }
        let values = byVariable.get(variableId);
        if (!values) {
          values = new Set();
          byVariable.set(variableId, values);
        }
        values.add(value);
      });
    });
  } catch { /* malformed authored pages keep the ordinary registry */ }
  const pageRuntime: HtmlComponentRuntimeLibrary = {
    ...runtime,
    components: runtime.components.map(component => component.bundle
      ? {
          ...component,
          variables: component.variables.map(variable => {
            if (!['image', 'link', 'audio', 'video'].includes(variable.type)) return variable;
            const sourcePath = component.variants[0]?.filePath || '';
            const values = new Set([
              variable.defaultValue,
              ...(runtimeValues.get(component.id)?.get(variable.id) || []),
            ]);
            const mapped = Object.fromEntries([...values].flatMap(value => {
              const runtimeValue = sourcePath
                ? rebaseHtmlComponentReferenceValue(project, value, sourcePath, pagePath)
                : value;
              return runtimeValue !== value ? [[value, runtimeValue]] : [];
            }));
            return Object.keys(mapped).length ? { ...variable, runtimeValues: mapped } : variable;
          }),
          variants: component.variants.map(variant => ({
            ...variant,
            markup: rebaseHtmlComponentMarkup(
              project,
              variant.markup,
              variant.filePath,
              pagePath,
              { componentId: component.id },
            ),
          })),
        }
      : component),
  };
  const json = JSON.stringify(pageRuntime)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  const payload = `<script type="application/json" data-kodety-component-registry>${json}</script>`;
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${payload}</body>`)
    : `${html}${payload}`;
}
