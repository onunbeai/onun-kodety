import postcss from 'postcss';
import type { HtmlProject, HtmlProjectFile } from './types';
import { relativePageHref } from './editor-wordpress-helpers';

export const HTML_COMPONENTS_DIRECTORY = '.incode/components';
export const HTML_COMPONENT_BUNDLE_VERSION = 1 as const;

export interface HtmlComponentBundleReference {
  version: 1;
  manifestFilePath: string;
  styleFilePath: string;
}

export interface HtmlComponentBundleManifest {
  version: 1;
  componentId: string;
  styleFilePath: string;
  variants: Array<{ id: string; filePath: string }>;
  dependencies: {
    /** Original project styles inspected when the component was created. */
    stylesheets: string[];
    /** Remote styles remain ordinary URLs; Kodety never copies their payload. */
    externalStylesheets: string[];
    /** Existing project files referenced by component HTML or CSS. */
    projectFiles: string[];
    /** Remote media/navigation references retained verbatim. */
    externalUrls: string[];
  };
}

export interface HtmlComponentBundleVariantLike {
  id: string;
  filePath: string;
}

export interface HtmlComponentBundleDefinitionLike {
  id: string;
  name?: string;
  bundle?: HtmlComponentBundleReference;
  variants: HtmlComponentBundleVariantLike[];
}

export interface HtmlComponentBundleLibraryLike {
  components: HtmlComponentBundleDefinitionLike[];
}

export function htmlComponentStyleFilePath(componentId: string) {
  return `${HTML_COMPONENTS_DIRECTORY}/${componentId}/component.css`;
}

export function htmlComponentManifestFilePath(componentId: string) {
  return `${HTML_COMPONENTS_DIRECTORY}/${componentId}/component.json`;
}

export function createHtmlComponentBundleReference(componentId: string): HtmlComponentBundleReference {
  return {
    version: HTML_COMPONENT_BUNDLE_VERSION,
    manifestFilePath: htmlComponentManifestFilePath(componentId),
    styleFilePath: htmlComponentStyleFilePath(componentId),
  };
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

function dirname(path: string) {
  return normalizePath(path).split('/').slice(0, -1).join('/');
}

function referenceParts(value: string) {
  const match = value.match(/^([^?#]*)([?#][\s\S]*)?$/);
  return {
    path: match?.[1] || '',
    suffix: match?.[2] || '',
  };
}

function externalReference(value: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value.trim());
}

function resolvePath(fromPath: string, value: string, rootPath = '') {
  const { path } = referenceParts(value.trim());
  if (!path || externalReference(value)) return '';
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* retain authored bytes */ }
  const base = decoded.startsWith('/') ? normalizePath(rootPath) : dirname(fromPath);
  return normalizePath(`${base ? `${base}/` : ''}${decoded.replace(/^\/+/, '')}`);
}

function projectReferencePath(
  project: HtmlProject,
  fromPath: string,
  value: string,
) {
  if (!value.trim() || externalReference(value)) return '';
  const resolved = resolvePath(fromPath, value, project.rootPath);
  if (resolved && project.files[resolved]) return resolved;
  const clean = normalizePath(referenceParts(value.trim()).path.replace(/^\/+/, ''));
  if (clean && project.files[clean]) return clean;
  const rooted = normalizePath(`${project.rootPath ? `${project.rootPath}/` : ''}${clean}`);
  if (rooted && project.files[rooted]) return rooted;
  return resolved;
}

function relativeReference(fromPath: string, targetPath: string, suffix = '') {
  return `${relativePageHref(fromPath, targetPath)}${suffix}`;
}

function rewriteReference(
  project: HtmlProject,
  fromPath: string,
  toPath: string,
  value: string,
  localFiles?: Set<string>,
  externalUrls?: Set<string>,
) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (externalReference(trimmed)) {
    if (/^(?:https?:|mailto:|tel:|\/\/)/i.test(trimmed)) externalUrls?.add(trimmed);
    return value;
  }
  const target = projectReferencePath(project, fromPath, trimmed);
  if (!target || !project.files[target]) return value;
  localFiles?.add(target);
  return relativeReference(toPath, target, referenceParts(trimmed).suffix);
}

export function rebaseHtmlComponentReferenceValue(
  project: HtmlProject,
  value: string,
  fromPath: string,
  toPath: string,
) {
  return rewriteReference(project, fromPath, toPath, value);
}

function rewriteSrcset(
  project: HtmlProject,
  fromPath: string,
  toPath: string,
  value: string,
  localFiles?: Set<string>,
  externalUrls?: Set<string>,
) {
  if (/(?:^|,\s*)data:/i.test(value)) return value;
  return value.split(',').map(candidate => {
    const trimmed = candidate.trim();
    if (!trimmed) return trimmed;
    const [url, ...descriptors] = trimmed.split(/\s+/);
    const rewritten = rewriteReference(
      project,
      fromPath,
      toPath,
      url,
      localFiles,
      externalUrls,
    );
    return [rewritten, ...descriptors].join(' ');
  }).join(', ');
}

function rewriteCssReferences(
  project: HtmlProject,
  css: string,
  fromPath: string,
  toPath: string,
  localFiles?: Set<string>,
  externalUrls?: Set<string>,
) {
  return css.replace(
    /url\(\s*(["']?)(.*?)\1\s*\)/gi,
    (match, quote: string, rawValue: string) => {
      const value = rawValue.trim();
      if (!value || /^data:/i.test(value)) return match;
      const rewritten = rewriteReference(
        project,
        fromPath,
        toPath,
        value,
        localFiles,
        externalUrls,
      );
      return rewritten === value ? match : `url(${quote}${rewritten}${quote})`;
    },
  );
}

const MARKUP_REFERENCE_ATTRIBUTES = [
  'action',
  'background',
  'data',
  'data-lazy-src',
  'data-original',
  'data-original-src',
  'data-poster',
  'data-poster-url',
  'data-src',
  'formaction',
  'href',
  'poster',
  'src',
  'xlink:href',
];

const MARKUP_SRCSET_ATTRIBUTES = [
  'data-lazy-srcset',
  'data-srcset',
  'imagesrcset',
  'srcset',
];

/**
 * Rebase every ordinary project URL while keeping the referenced file in its
 * original project location. No media is copied into the component folder.
 */
export function rebaseHtmlComponentMarkup(
  project: HtmlProject,
  markup: string,
  fromPath: string,
  toPath: string,
  options?: {
    componentId?: string;
    localFiles?: Set<string>;
    externalUrls?: Set<string>;
  },
) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return markup;
  if (options?.componentId) {
    root.setAttribute('data-kodety-component-scope', options.componentId);
  }
  [root, ...Array.from(root.querySelectorAll('*'))].forEach(element => {
    MARKUP_REFERENCE_ATTRIBUTES.forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const value = element.getAttribute(attribute) || '';
      const rewritten = rewriteReference(
        project,
        fromPath,
        toPath,
        value,
        options?.localFiles,
        options?.externalUrls,
      );
      if (rewritten !== value) element.setAttribute(attribute, rewritten);
    });
    MARKUP_SRCSET_ATTRIBUTES.forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const value = element.getAttribute(attribute) || '';
      const rewritten = rewriteSrcset(
        project,
        fromPath,
        toPath,
        value,
        options?.localFiles,
        options?.externalUrls,
      );
      if (rewritten !== value) element.setAttribute(attribute, rewritten);
    });
    if (element.hasAttribute('style')) {
      const value = element.getAttribute('style') || '';
      const rewritten = rewriteCssReferences(
        project,
        value,
        fromPath,
        toPath,
        options?.localFiles,
        options?.externalUrls,
      );
      if (rewritten !== value) element.setAttribute('style', rewritten);
    }
  });
  return root.outerHTML;
}

/** Normalize Agent/Inspector-authored root paths against the component master. */
export function normalizeHtmlComponentMasterMarkup(
  project: HtmlProject,
  markup: string,
  componentId: string,
  variantFilePath: string,
  sourceDocument = '',
) {
  return rebaseHtmlComponentMarkup(
    project,
    markup,
    sourceDocument
      ? htmlComponentSourceReferencePath(sourceDocument, variantFilePath)
      : variantFilePath,
    variantFilePath,
    { componentId },
  );
}

function splitSelectorList(selector: string) {
  const parts: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote = '';
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (quote) {
      if (character === quote && selector[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') round++;
    else if (character === ')') round = Math.max(0, round - 1);
    else if (character === '[') square++;
    else if (character === ']') square = Math.max(0, square - 1);
    else if (character === ',' && round === 0 && square === 0) {
      parts.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

function componentAttributeValuePattern(attributeName: string, value: string) {
  const escapedAttribute = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\[\\s*${escapedAttribute}\\s*=\\s*(?:"${escapedValue}"|'${escapedValue}'|${escapedValue})\\s*\\]`,
    'g',
  );
}

/**
 * A component created from inside another component reads an already-scoped
 * stylesheet. Move that outer scope to the new bundle before scoping the
 * selected subtree; otherwise every copied rule still requires the parent
 * component to exist and the nested master renders without styles on its own.
 */
export function rebaseHtmlComponentStylesheetScope(
  css: string,
  sourceComponentId: string,
  targetComponentId: string,
  sourceVariantId = '',
  targetVariantId = '',
) {
  if (
    !css.trim()
    || !sourceComponentId
    || !targetComponentId
    || sourceComponentId === targetComponentId
  ) return css;
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return css;
  }
  const replacements = [{
    pattern: componentAttributeValuePattern('data-kodety-component-scope', sourceComponentId),
    value: `[data-kodety-component-scope="${targetComponentId}"]`,
  }];
  if (sourceVariantId && targetVariantId && sourceVariantId !== targetVariantId) {
    [
      'data-kodety-component-variant-editor',
      'data-kodety-component-state-variant',
      'data-kodety-component-variant',
    ].forEach(attribute => replacements.push({
      pattern: componentAttributeValuePattern(attribute, sourceVariantId),
      value: `[${attribute}="${targetVariantId}"]`,
    }));
  }
  root.walkRules(rule => {
    replacements.forEach(replacement => {
      replacement.pattern.lastIndex = 0;
      if (!replacement.pattern.test(rule.selector)) return;
      replacement.pattern.lastIndex = 0;
      rule.selector = rule.selector.replace(replacement.pattern, replacement.value);
    });
  });
  return root.toString();
}

interface ComponentSelectorInventory {
  classes: Set<string>;
  ids: Set<string>;
  attributes: Set<string>;
  tags: Set<string>;
}

function selectorInventory(root: Element): ComponentSelectorInventory {
  const inventory: ComponentSelectorInventory = {
    classes: new Set(),
    ids: new Set(),
    attributes: new Set(),
    tags: new Set(),
  };
  [root, ...Array.from(root.querySelectorAll('*'))].forEach(element => {
    element.classList.forEach(value => inventory.classes.add(value));
    if (element.id) inventory.ids.add(element.id);
    Array.from(element.attributes).forEach(attribute => inventory.attributes.add(attribute.name));
    inventory.tags.add(element.tagName.toLowerCase());
  });
  return inventory;
}

function selectorRelatesToComponent(selector: string, inventory: ComponentSelectorInventory) {
  const classes = Array.from(selector.matchAll(/\.(-?[_a-zA-Z]+[\w-]*)/g), match => match[1]);
  const ids = Array.from(selector.matchAll(/#(-?[_a-zA-Z]+[\w-]*)/g), match => match[1]);
  const attributes = Array.from(selector.matchAll(/\[\s*([\w:-]+)/g), match => match[1]);
  if (classes.some(value => inventory.classes.has(value))) return true;
  if (ids.some(value => inventory.ids.has(value))) return true;
  if (attributes.some(value => inventory.attributes.has(value))) return true;
  if (classes.length || ids.length || attributes.length) return false;
  if (/\b(?:html|body|:root)\b|^\s*\*/i.test(selector)) return true;
  const withoutFunctions = selector
    .replace(/::?[\w-]+(?:\([^)]*\))?/g, ' ')
    .replace(/[>+~]/g, ' ');
  const tags = withoutFunctions.match(/(?:^|\s)([a-z][\w-]*)/gi)?.map(value => value.trim().toLowerCase()) || [];
  return !tags.length || tags.some(tag => inventory.tags.has(tag));
}

function normalizedComponentSelector(selector: string) {
  let normalized = selector.trim();
  normalized = normalized.replace(
    /^(?:(?:html|body|:root)(?:\[[^\]]*\])?(?:\s*>\s*|\s+|$))+/i,
    '',
  ).trim();
  return normalized || ':scope';
}

const HTML_COMPONENT_DOCUMENT_ROOT_PORTABLE_PROPERTY =
  /^(?:--|color$|font(?:-|$)|line-height$|letter-spacing$|text-rendering$|font-synthesis$|-webkit-font-smoothing$|box-sizing$)/i;

/**
 * Document-root rules provide inherited context to an extracted component,
 * but they do not describe the component surface itself. In particular, a
 * page background must never become an authored background on the component
 * root: transparent components should remain transparent after conversion.
 */
export function htmlComponentDocumentRootDeclarationIsPortable(property: string) {
  return HTML_COMPONENT_DOCUMENT_ROOT_PORTABLE_PROPERTY.test(property.trim());
}

function scopedSelector(selector: string, componentId: string) {
  const scope = `[data-kodety-component-scope="${componentId}"]`;
  if (selector.includes(`data-kodety-component-scope="${componentId}"`)) return selector;
  const normalized = normalizedComponentSelector(selector);
  if (normalized === ':scope') return scope;
  const pseudoElement = normalized.match(/(::[\w-]+(?:\([^)]*\))?)\s*$/)?.[1] || '';
  const target = pseudoElement ? normalized.slice(0, -pseudoElement.length) : normalized;
  const root = target.trim()
    ? `${scope}:is(${target})${pseudoElement}`
    : `${scope}${pseudoElement}`;
  const descendant = `${scope} ${normalized}`;
  return `${root}, ${descendant}`;
}

function scopeComponentStylesheet(css: string, componentRoot: Element, componentId: string) {
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return '';
  }
  const inventory = selectorInventory(componentRoot);
  root.walkRules(rule => {
    let parent = rule.parent;
    while (parent && parent.type !== 'root') {
      if (parent.type === 'atrule' && /(?:^|-)keyframes$/i.test(parent.name)) return;
      parent = parent.parent;
    }
    const selectors = splitSelectorList(rule.selector)
      .filter(selector => selectorRelatesToComponent(selector, inventory));
    if (!selectors.length) {
      rule.remove();
      return;
    }
    if (selectors.every(selector => normalizedComponentSelector(selector) === ':scope')) {
      rule.walkDecls(declaration => {
        if (!htmlComponentDocumentRootDeclarationIsPortable(declaration.prop)) declaration.remove();
      });
      if (!rule.nodes?.some(node => node.type === 'decl')) {
        rule.remove();
        return;
      }
    }
    rule.selector = [...new Set(selectors.map(selector => scopedSelector(selector, componentId)))].join(', ');
  });
  root.walkAtRules(atRule => {
    if (/^(?:charset|namespace)$/i.test(atRule.name)) atRule.remove();
  });
  let removed = true;
  while (removed) {
    removed = false;
    root.walkAtRules(atRule => {
      if (
        atRule.nodes
        && atRule.nodes.length === 0
        && !/^(?:font-face|property|(?:-[\w]+-)?keyframes)$/i.test(atRule.name)
      ) {
        atRule.remove();
        removed = true;
      }
    });
  }
  return root.toString().trim();
}

function parseImportParams(params: string) {
  const match = params.match(/^\s*(?:url\(\s*)?(["']?)([^"')\s]+)\1\s*\)?\s*(.*)$/i);
  return match ? { value: match[2], condition: match[3].trim() } : null;
}

function prepareStylesheetSource(
  project: HtmlProject,
  cssPath: string,
  css: string,
  targetStylePath: string,
  sourceStylesheets: Set<string>,
  localFiles: Set<string>,
  externalUrls: Set<string>,
  visited = new Set<string>(),
): string {
  if (visited.has(cssPath)) return '';
  const nextVisited = new Set(visited).add(cssPath);
  let root: postcss.Root;
  try {
    root = postcss.parse(css, { from: cssPath });
  } catch {
    return rewriteCssReferences(
      project,
      css,
      cssPath,
      targetStylePath,
      localFiles,
      externalUrls,
    );
  }
  root.walkAtRules('import', atRule => {
    const imported = parseImportParams(atRule.params);
    if (!imported) return;
    if (externalReference(imported.value)) {
      externalUrls.add(imported.value);
      return;
    }
    const importPath = projectReferencePath(project, cssPath, imported.value);
    const source = importPath ? project.files[importPath]?.text : undefined;
    if (!importPath || source === undefined) return;
    sourceStylesheets.add(importPath);
    const expanded = prepareStylesheetSource(
      project,
      importPath,
      source,
      targetStylePath,
      sourceStylesheets,
      localFiles,
      externalUrls,
      nextVisited,
    );
    if (!expanded) {
      atRule.remove();
      return;
    }
    let replacement: postcss.Container = postcss.parse(expanded);
    if (imported.condition) {
      const wrapper = postcss.atRule({ name: 'media', params: imported.condition });
      wrapper.append(replacement.nodes);
      replacement = postcss.root({ nodes: [wrapper] });
    }
    atRule.replaceWith(...(replacement.nodes || []));
  });
  return rewriteCssReferences(
    project,
    root.toString(),
    cssPath,
    targetStylePath,
    localFiles,
    externalUrls,
  );
}

function sourceStyleInputs(
  project: HtmlProject,
  sourcePagePath: string,
  sourcePage: string,
) {
  const document = new DOMParser().parseFromString(sourcePage, 'text/html');
  const referencePath = htmlComponentSourceReferencePath(sourcePage, sourcePagePath);
  const styles: Array<{ path: string; css: string }> = [];
  const stylesheets = new Set<string>();
  const externalStylesheets = new Set<string>();
  document.querySelectorAll('style').forEach((style, index) => {
    if (
      style.hasAttribute('data-kodety-component-editor-projection')
      || style.hasAttribute('data-html-editor-component-styles')
    ) return;
    styles.push({ path: referencePath, css: style.textContent || '', });
  });
  document.querySelectorAll('link[rel][href]').forEach(link => {
    const relations = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (!relations.includes('stylesheet')) return;
    const href = link.getAttribute('href') || '';
    if (externalReference(href)) {
      externalStylesheets.add(href);
      return;
    }
    const path = projectReferencePath(project, referencePath, href);
    const css = path ? project.files[path]?.text : undefined;
    if (!path || css === undefined) return;
    stylesheets.add(path);
    styles.push({ path, css });
  });
  return { styles, stylesheets, externalStylesheets };
}

function manifestText(manifest: HtmlComponentBundleManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export interface CreateHtmlComponentBundleResult {
  markup: string;
  styleText: string;
  manifestText: string;
  manifest: HtmlComponentBundleManifest;
}

/** Merge variant-specific legacy heads into one deduplicated component bundle. */
export function mergeHtmlComponentBundleResults(
  component: HtmlComponentBundleDefinitionLike,
  results: CreateHtmlComponentBundleResult[],
): CreateHtmlComponentBundleResult | null {
  if (!results.length) return null;
  const nodes: string[] = [];
  const seen = new Set<string>();
  results.forEach(result => {
    let root: postcss.Root;
    try { root = postcss.parse(result.styleText); } catch { return; }
    root.nodes.forEach(node => {
      if (node.type === 'comment' && /^\s*Kodety component:/i.test(node.text)) return;
      const text = node.toString().trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      nodes.push(text);
    });
  });
  const first = results[0];
  const dependencies = {
    stylesheets: [...new Set(results.flatMap(result => result.manifest.dependencies.stylesheets))].sort(),
    externalStylesheets: [...new Set(results.flatMap(result => result.manifest.dependencies.externalStylesheets))].sort(),
    projectFiles: [...new Set(results.flatMap(result => result.manifest.dependencies.projectFiles))].sort(),
    externalUrls: [...new Set(results.flatMap(result => result.manifest.dependencies.externalUrls))].sort(),
  };
  const manifest: HtmlComponentBundleManifest = {
    version: HTML_COMPONENT_BUNDLE_VERSION,
    componentId: component.id,
    styleFilePath: first.manifest.styleFilePath,
    variants: component.variants.map(variant => ({ id: variant.id, filePath: variant.filePath })),
    dependencies,
  };
  return {
    markup: first.markup,
    styleText: `/* Kodety component: ${component.name || component.id} */\n${nodes.join('\n\n')}\n`,
    manifest,
    manifestText: manifestText(manifest),
  };
}

/** Build the portable HTML/CSS/manifest source of a newly converted component. */
export function createHtmlComponentBundle(
  project: HtmlProject,
  sourcePagePath: string,
  sourcePage: string,
  markup: string,
  component: HtmlComponentBundleDefinitionLike,
  variant: HtmlComponentBundleVariantLike,
  additionalCss = '',
): CreateHtmlComponentBundleResult {
  const bundle = component.bundle || createHtmlComponentBundleReference(component.id);
  const sourceReferencePath = htmlComponentSourceReferencePath(sourcePage, sourcePagePath);
  const localFiles = new Set<string>();
  const externalUrls = new Set<string>();
  const sourceDocument = new DOMParser().parseFromString(sourcePage, 'text/html');
  const sourceComponentId = sourceDocument.body.getAttribute('data-kodety-component-editor')
    || sourceDocument.body.firstElementChild?.getAttribute('data-kodety-component-scope')
    || '';
  const sourceVariantId = sourceDocument.body.getAttribute('data-kodety-component-variant-editor')
    || sourceDocument.body.firstElementChild?.getAttribute('data-kodety-component-state-variant')
    || '';
  // Inventory the selected subtree before adding the new component scope.
  // Otherwise a parent-root selector appears relevant merely because both
  // components use the same data-kodety-component-scope attribute name.
  const parsedMarkup = new DOMParser().parseFromString(markup, 'text/html');
  const componentRoot = parsedMarkup.body.firstElementChild;
  if (
    sourceComponentId
    && sourceComponentId !== component.id
    && componentRoot?.getAttribute('data-kodety-component-scope') === component.id
  ) {
    // Repairing an older nested bundle starts from its already-normalized
    // master. Remove only the target scope from the temporary inventory; the
    // returned markup below still receives/retains that scope normally.
    componentRoot.removeAttribute('data-kodety-component-scope');
  }
  const rebasedMarkup = rebaseHtmlComponentMarkup(
    project,
    markup,
    sourceReferencePath,
    variant.filePath,
    { componentId: component.id, localFiles, externalUrls },
  );
  const inputs = sourceStyleInputs(project, sourcePagePath, sourcePage);
  if (additionalCss.trim()) inputs.styles.push({ path: sourcePagePath, css: additionalCss });
  const sourceStylesheets = new Set(inputs.stylesheets);
  const sections = componentRoot
    ? inputs.styles.flatMap(input => {
        const prepared = prepareStylesheetSource(
          project,
          input.path,
          input.css,
          bundle.styleFilePath,
          sourceStylesheets,
          localFiles,
          externalUrls,
        );
        const rebasedScope = rebaseHtmlComponentStylesheetScope(
          prepared,
          sourceComponentId,
          component.id,
          sourceVariantId,
          variant.id,
        );
        const scoped = scopeComponentStylesheet(rebasedScope, componentRoot, component.id);
        return scoped ? [scoped] : [];
      })
    : [];
  const styleText = sections.length
    ? `/* Kodety component: ${component.name || component.id} */\n${sections.join('\n\n')}\n`
    : `/* Kodety component: ${component.name || component.id} */\n`;
  const manifest: HtmlComponentBundleManifest = {
    version: HTML_COMPONENT_BUNDLE_VERSION,
    componentId: component.id,
    styleFilePath: bundle.styleFilePath,
    variants: component.variants.map(item => ({ id: item.id, filePath: item.filePath })),
    dependencies: {
      stylesheets: [...sourceStylesheets].sort(),
      externalStylesheets: [...inputs.externalStylesheets].sort(),
      projectFiles: [...localFiles].filter(path => project.files[path]).sort(),
      externalUrls: [...externalUrls].sort(),
    },
  };
  return {
    markup: rebasedMarkup,
    styleText,
    manifest,
    manifestText: manifestText(manifest),
  };
}

function parseManifest(source: string | undefined): HtmlComponentBundleManifest | null {
  if (!source) return null;
  try {
    const value = JSON.parse(source) as HtmlComponentBundleManifest;
    return value?.version === 1 && typeof value.componentId === 'string' ? value : null;
  } catch {
    return null;
  }
}

function referencedFilesFromMarkup(
  project: HtmlProject,
  markup: string,
  referencePath: string,
  localFiles: Set<string>,
  externalUrls: Set<string>,
) {
  rebaseHtmlComponentMarkup(
    project,
    markup,
    referencePath,
    referencePath,
    { localFiles, externalUrls },
  );
}

function referencedFilesFromCss(
  project: HtmlProject,
  css: string,
  referencePath: string,
  localFiles: Set<string>,
  externalUrls: Set<string>,
) {
  rewriteCssReferences(
    project,
    css,
    referencePath,
    referencePath,
    localFiles,
    externalUrls,
  );
}

/** Keep each component.json synchronized without copying any referenced asset. */
export function synchronizeHtmlComponentBundleManifests(
  project: HtmlProject,
  library: HtmlComponentBundleLibraryLike,
): HtmlProject {
  let files = project.files;
  library.components.forEach(component => {
    const bundle = component.bundle;
    if (!bundle) return;
    const previous = parseManifest(project.files[bundle.manifestFilePath]?.text);
    const localFiles = new Set<string>();
    const externalUrls = new Set<string>();
    component.variants.forEach(variant => {
      const source = project.files[variant.filePath]?.text;
      if (source === undefined) return;
      const document = new DOMParser().parseFromString(source, 'text/html');
      const markup = document.body.firstElementChild?.outerHTML || '';
      if (markup) referencedFilesFromMarkup(project, markup, variant.filePath, localFiles, externalUrls);
    });
    const style = project.files[bundle.styleFilePath]?.text || '';
    if (style) referencedFilesFromCss(project, style, bundle.styleFilePath, localFiles, externalUrls);
    const manifest: HtmlComponentBundleManifest = {
      version: HTML_COMPONENT_BUNDLE_VERSION,
      componentId: component.id,
      styleFilePath: bundle.styleFilePath,
      variants: component.variants.map(variant => ({ id: variant.id, filePath: variant.filePath })),
      dependencies: {
        stylesheets: previous?.dependencies.stylesheets || [],
        externalStylesheets: previous?.dependencies.externalStylesheets || [],
        projectFiles: [...localFiles].filter(path => project.files[path]).sort(),
        externalUrls: [...externalUrls].sort(),
      },
    };
    const text = manifestText(manifest);
    const existing = project.files[bundle.manifestFilePath];
    if (existing?.text === text) return;
    if (files === project.files) files = { ...project.files };
    files[bundle.manifestFilePath] = {
      path: bundle.manifestFilePath,
      mimeType: existing?.mimeType || 'application/json',
      text,
    };
  });
  return files === project.files ? project : { ...project, files };
}

function componentIdsInMarkup(source: string) {
  return Array.from(
    source.matchAll(/\bdata-kodety-component-(?:id|scope)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi),
    match => match[1] || match[2] || match[3] || '',
  ).filter(Boolean);
}

/** Return the shared component CSS needed by current and reachable variants. */
export function htmlComponentStylePathsForSource(
  project: HtmlProject,
  source: string,
  library: HtmlComponentBundleLibraryLike,
) {
  const byId = new Map(library.components.map(component => [component.id, component]));
  const queue = componentIdsInMarkup(source);
  const visited = new Set<string>();
  const paths: string[] = [];
  while (queue.length) {
    const id = queue.shift() || '';
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const component = byId.get(id);
    if (!component) continue;
    const stylePath = component.bundle?.styleFilePath || '';
    if (stylePath && project.files[stylePath]?.text !== undefined && !paths.includes(stylePath)) {
      paths.push(stylePath);
    }
    component.variants.forEach(variant => {
      const variantSource = project.files[variant.filePath]?.text || '';
      componentIdsInMarkup(variantSource).forEach(nestedId => {
        if (!visited.has(nestedId)) queue.push(nestedId);
      });
    });
  }
  return paths;
}

function externalStylesheetsForComponents(
  project: HtmlProject,
  stylePaths: string[],
  library: HtmlComponentBundleLibraryLike,
) {
  const requested = new Set(stylePaths);
  const urls = new Set<string>();
  library.components.forEach(component => {
    const bundle = component.bundle;
    if (!bundle || !requested.has(bundle.styleFilePath)) return;
    const manifest = parseManifest(project.files[bundle.manifestFilePath]?.text);
    manifest?.dependencies.externalStylesheets.forEach(url => urls.add(url));
  });
  return [...urls];
}

function withoutGeneratedComponentStyles(source: string) {
  return source
    .replace(/\s*<link\b[^>]*\bdata-html-editor-component-style\b[^>]*>\s*/gi, '\n')
    .replace(/\s*<style\b[^>]*\bdata-kodety-component-styles\b[^>]*>[\s\S]*?<\/style\s*>\s*/gi, '\n')
    .replace(/\s*<link\b[^>]*\bdata-kodety-component-external-style\b[^>]*>\s*/gi, '\n');
}

function insertHeadMarkup(source: string, markup: string) {
  if (!markup) return source;
  if (/<\/head\s*>/i.test(source)) return source.replace(/<\/head\s*>/i, `${markup}\n</head>`);
  if (/<html\b[^>]*>/i.test(source)) return source.replace(/<html\b[^>]*>/i, match => `${match}<head>${markup}</head>`);
  return `${markup}\n${source}`;
}

/** Attach private bundle CSS only to the disposable Design/Preview document. */
export function attachHtmlComponentStylesheets(
  source: string,
  project: HtmlProject,
  library: HtmlComponentBundleLibraryLike,
  pagePath = project.mainHtmlPath,
) {
  const clean = withoutGeneratedComponentStyles(source);
  const stylePaths = htmlComponentStylePathsForSource(project, clean, library);
  if (!stylePaths.length) return clean;
  const external = externalStylesheetsForComponents(project, stylePaths, library);
  const links = [
    ...external.map(url => (
      `<link rel="stylesheet" href="${url.replaceAll('"', '&quot;')}" data-kodety-component-external-style>`
    )),
    ...stylePaths.map(path => (
      `<link rel="stylesheet" href="${relativePageHref(pagePath, path)}" data-html-editor-component-style="${path}">`
    )),
  ].join('\n');
  return insertHeadMarkup(clean, links);
}

/** Inline bundle CSS into exported/public pages; .incode remains authoring-only. */
export function inlineHtmlComponentStyles(
  source: string,
  project: HtmlProject,
  library: HtmlComponentBundleLibraryLike,
  pagePath = project.mainHtmlPath,
) {
  const clean = withoutGeneratedComponentStyles(source);
  const stylePaths = htmlComponentStylePathsForSource(project, clean, library);
  if (!stylePaths.length) return clean;
  const external = externalStylesheetsForComponents(project, stylePaths, library);
  const links = external.map(url => (
    `<link rel="stylesheet" href="${url.replaceAll('"', '&quot;')}" data-kodety-component-external-style>`
  )).join('\n');
  const css = stylePaths.flatMap(path => {
    const text = project.files[path]?.text;
    if (text === undefined) return [];
    return [`/* ${path} */\n${rewriteCssReferences(project, text, path, pagePath)}`];
  }).join('\n\n');
  const style = `<style data-kodety-component-styles>${css}</style>`;
  return insertHeadMarkup(clean, [links, style].filter(Boolean).join('\n'));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function projectFileDataUrl(file: HtmlProjectFile) {
  const bytes = file.data ?? new TextEncoder().encode(file.text || '');
  return `data:${file.mimeType || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

function previewReference(
  project: HtmlProject,
  fromPath: string,
  value: string,
) {
  if (!value.trim() || externalReference(value) || /^data:/i.test(value.trim())) return value;
  const target = projectReferencePath(project, fromPath, value);
  const file = target ? project.files[target] : undefined;
  if (!file || /\.html?$/i.test(target)) return value;
  return `${projectFileDataUrl(file)}${referenceParts(value).suffix}`;
}

function previewCss(project: HtmlProject, css: string, cssPath: string) {
  return css.replace(
    /url\(\s*(["']?)(.*?)\1\s*\)/gi,
    (match, _quote: string, rawValue: string) => {
      const value = rawValue.trim();
      const rewritten = previewReference(project, cssPath, value);
      return rewritten === value ? match : `url("${rewritten}")`;
    },
  );
}

function sanitizePreviewMarkup(project: HtmlProject, markup: string, referencePath: string) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) return '';
  root.querySelectorAll('script, iframe, object, embed').forEach(element => element.remove());
  [root, ...Array.from(root.querySelectorAll('*'))].forEach(element => {
    Array.from(element.attributes).forEach(attribute => {
      if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') {
        element.removeAttribute(attribute.name);
      }
    });
    ['src', 'poster', 'data-src', 'data-lazy-src', 'background'].forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const value = element.getAttribute(attribute) || '';
      element.setAttribute(attribute, previewReference(project, referencePath, value));
    });
    MARKUP_SRCSET_ATTRIBUTES.forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const value = element.getAttribute(attribute) || '';
      if (/(?:^|,\s*)data:/i.test(value)) return;
      element.setAttribute(attribute, value.split(',').map(candidate => {
        const [url, ...descriptors] = candidate.trim().split(/\s+/);
        return [previewReference(project, referencePath, url), ...descriptors].join(' ');
      }).join(', '));
    });
    if (element.hasAttribute('style')) {
      element.setAttribute('style', previewCss(project, element.getAttribute('style') || '', referencePath));
    }
  });
  // The card is an isolated component surface, so its single root participates
  // in normal flow even when the real page instance is absolute/fixed. Apply
  // this only to the root: positioned descendants keep their authored layout.
  const rootStyle = (root as HTMLElement | SVGElement).style;
  rootStyle.setProperty('position', 'relative', 'important');
  [
    'top',
    'right',
    'bottom',
    'left',
    'inset-block-start',
    'inset-block-end',
    'inset-inline-start',
    'inset-inline-end',
  ].forEach(property => rootStyle.setProperty(property, 'auto', 'important'));
  return root.outerHTML;
}

export function htmlComponentSourceReferencePath(source: string, variantPath: string) {
  const baseTag = source.match(/<base\b[^>]*>/i)?.[0] || '';
  const href = baseTag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]
    || baseTag.match(/\bhref\s*=\s*([^\s>]+)/i)?.[1]
    || '';
  if (!href || externalReference(href)) return variantPath;
  const baseDirectory = resolvePath(variantPath, href);
  return baseDirectory ? `${baseDirectory}/__component_base__.html` : '__component_base__.html';
}

function legacyPreviewCss(project: HtmlProject, source: string, variantPath: string) {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const referencePath = htmlComponentSourceReferencePath(source, variantPath);
  const sections: string[] = [];
  document.querySelectorAll('style').forEach(style => {
    if (style.hasAttribute('data-kodety-component-editor-projection')) return;
    sections.push(previewCss(project, style.textContent || '', referencePath));
  });
  document.querySelectorAll('link[rel][href]').forEach(link => {
    const relations = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (!relations.includes('stylesheet')) return;
    const href = link.getAttribute('href') || '';
    const path = projectReferencePath(project, referencePath, href);
    const css = path ? project.files[path]?.text : undefined;
    if (path && css !== undefined) sections.push(previewCss(project, css, path));
  });
  return sections.join('\n');
}

/** A small, script-free srcdoc used directly by the Insert panel card. */
export function buildHtmlComponentPreviewDocument(
  project: HtmlProject,
  component: HtmlComponentBundleDefinitionLike,
  variant = component.variants[0],
) {
  if (!variant) return '<!doctype html><html><body></body></html>';
  const source = project.files[variant.filePath]?.text || '';
  const document = new DOMParser().parseFromString(source, 'text/html');
  const rawMarkup = document.body.firstElementChild?.outerHTML || '';
  const transientBundle = component.bundle
    ? null
    : createHtmlComponentBundle(
        project,
        variant.filePath,
        source,
        rawMarkup,
        { ...component, bundle: createHtmlComponentBundleReference(component.id) },
        variant,
      );
  const referencePath = variant.filePath;
  const markup = sanitizePreviewMarkup(
    project,
    transientBundle?.markup || rawMarkup,
    referencePath,
  );
  const stylePath = component.bundle?.styleFilePath
    || transientBundle?.manifest.styleFilePath
    || variant.filePath;
  const componentCss = previewCss(
    project,
    component.bundle
      ? project.files[component.bundle.styleFilePath]?.text || ''
      : transientBundle?.styleText || legacyPreviewCss(project, source, variant.filePath),
    stylePath,
  );
  const externalStylesheets = transientBundle?.manifest.dependencies.externalStylesheets
    || Array.from(document.querySelectorAll('link[rel][href]')).flatMap(link => {
      const href = link.getAttribute('href') || '';
      const relations = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      return relations.includes('stylesheet') && externalReference(href) ? [href] : [];
    });
  const externalLinks = externalStylesheets.map(href => (
    `<link rel="stylesheet" href="${href.replaceAll('"', '&quot;')}">`
  )).join('\n');
  const frameCss = 'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#171717}body{display:block;padding:12px;box-sizing:border-box}body>*{max-width:100%!important;box-sizing:border-box}';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${externalLinks}<style>${frameCss}</style><style data-kodety-component-preview-style>${componentCss}</style></head><body>${markup}</body></html>`;
}

export function htmlComponentPreviewDependencyFiles(
  project: HtmlProject,
  component: HtmlComponentBundleDefinitionLike,
) {
  const bundle = component.bundle;
  const manifest = bundle ? parseManifest(project.files[bundle.manifestFilePath]?.text) : null;
  const paths = new Set<string>([
    ...component.variants.map(variant => variant.filePath),
    ...(bundle ? [bundle.styleFilePath, bundle.manifestFilePath] : []),
    ...(manifest?.dependencies.projectFiles || []),
  ]);
  return [...paths].flatMap(path => project.files[path] ? [project.files[path]] : []);
}
