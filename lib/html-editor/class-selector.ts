import postcss, { type AtRule, type Container, type Rule } from 'postcss';
import valueParser from 'postcss-value-parser';
import { inspectSourceElementIndex, transformSourceClassAttributes, transformSourceStyleBlocks } from './source-patcher';
import { renameInteractionSelectorClassToken, renameProjectInteractionClassReferences } from './interactions';
import type { HtmlProject } from './types';

const VALID_CLASS_NAME = /^-?[A-Za-z_][\w-]*$/;

export function parseClassList(value: string) {
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Selector for a single visual class. Editor-owned (`incode-` and semantic
 * `variant-<property>-<sequence>`) classes are repeated (`.x.x.x`) to raise
 * specificity without `!important`, so a freshly generated rule beats the
 * compound selectors imported sites often ship. Authored classes stay
 * untouched to preserve their cascade semantics.
 */
export function visualClassSelector(className: string): string {
  return className.startsWith('incode-') || /^variant-[a-z0-9-]+-\d{2,}$/.test(className)
    ? `.${className}.${className}.${className}`
    : `.${className}`;
}

/**
 * Compound selector for a base class followed by its combo classes
 * (`.base.combo`), Webflow-style. This is THE single source of truth for the
 * editing target: both the class chips UI and the element-selection handler
 * build the target through here, so what the style panel reads always matches
 * what edits write.
 */
export function compoundVisualSelector(classes: string[]): string {
  return classes.map(visualClassSelector).join('');
}

/** Valid, unique reusable-class names persisted in project metadata. */
export function normalizeReusableClassNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(name => String(name || '').trim())
      .filter(name => /^-?[A-Za-z_][\w-]*$/.test(name)),
  ));
}

/**
 * Resolves the editing selector for one chip.
 *
 * Combo classes keep Webflow semantics (`.base.combo`). Reusable classes own
 * an independent selector (`.utility`) and are excluded from every combo
 * compound, so attaching one never changes the identity of neighboring rules.
 */
export function classEditingSelector(
  classes: string[],
  reusableClasses: Iterable<string>,
  activeIndex = classes.length - 1,
): string {
  if (!classes.length || activeIndex < 0) return '';
  const reusable = new Set(reusableClasses);
  const activeName = classes[Math.min(activeIndex, classes.length - 1)];
  if (reusable.has(activeName)) return visualClassSelector(activeName);
  return compoundVisualSelector(
    classes.slice(0, activeIndex + 1).filter(name => !reusable.has(name)),
  );
}

interface ClassElement {
  path: string;
  classes: string[];
}

/** Every element in the document with its structural path and class list. */
function walkClassElements(source: string): ClassElement[] {
  const inspected = inspectSourceElementIndex(source);
  const snapshots = inspected.body
    ? [inspected.body, ...inspected.elements]
    : inspected.elements;
  return snapshots.map(snapshot => ({
    path: snapshot.path,
    classes: parseClassList(snapshot.attributes.class || ''),
  }));
}

/** Every distinct class name used anywhere in this HTML document. */
export function allClassNames(source: string): string[] {
  const names = new Set<string>();
  walkClassElements(source).forEach(element => element.classes.forEach(name => names.add(name)));
  return [...names];
}

/** How many elements in this HTML document carry every one of `classNames`. */
export function countClassUsage(source: string, classNames: string[]): number {
  if (!classNames.length) return 0;
  const set = new Set(classNames);
  return walkClassElements(source).filter(element => {
    const elementSet = new Set(element.classes);
    return [...set].every(name => elementSet.has(name));
  }).length;
}

/**
 * Classes seen combined with `baseClass` elsewhere in the document, ordered by
 * how often they co-occur — mirrors Webflow's "Existing Combo Classes" list,
 * surfacing combinations already established on the site instead of inviting
 * a fresh one-off name every time.
 */
export function comboSuggestions(source: string, baseClass: string, exclude: string[] = []): string[] {
  const excluded = new Set([baseClass, ...exclude]);
  const counts = new Map<string, number>();
  walkClassElements(source).forEach(element => {
    if (!element.classes.includes(baseClass)) return;
    element.classes.forEach(name => {
      if (excluded.has(name)) return;
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/**
 * Renames a class across every element's `class` attribute in the document.
 * One offset-based pass covers head/body and template contents without
 * reserializing unrelated markup, comments or scripts.
 */
export function renameClassInHtml(source: string, oldName: string, newName: string): string {
  const markup = transformSourceClassAttributes(source, value => {
    const classes = parseClassList(value);
    if (!classes.includes(oldName)) return value;
    return Array.from(new Set(classes.map(name => name === oldName ? newName : name))).join(' ');
  });
  return transformSourceStyleBlocks(markup, css => renameClassInCss(css, oldName, newName));
}

/**
 * Renames a class token everywhere it appears across every selector in the
 * stylesheet (`.old`, `.old.other`, `.old:hover`, `.old .child`, grouped
 * selectors, nested media queries…), leaving every other selector untouched.
 */
export function renameClassInCss(css: string, oldName: string, newName: string): string {
  const root = postcss.parse(css);
  root.walkRules(rule => {
    rule.selector = renameInteractionSelectorClassToken(rule.selector, oldName, newName);
  });
  // These at-rules also contain selectors; declarations and import URLs do not.
  root.walkAtRules(atRule => {
    if (atRule.name.toLowerCase() === 'scope') {
      atRule.params = renameInteractionSelectorClassToken(atRule.params, oldName, newName);
    }
    if (atRule.name.toLowerCase() === 'supports') {
      const params = valueParser(atRule.params);
      params.walk(node => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'selector') return;
        node.nodes = valueParser(renameInteractionSelectorClassToken(
          valueParser.stringify(node.nodes), oldName, newName,
        )).nodes;
        return false;
      });
      atRule.params = params.toString();
    }
  });
  return root.toString();
}

export interface RenameProjectClassReferencesResult {
  /** Original snapshot on a no-op; an immutable replacement after a change. */
  project: HtmlProject;
  /** Stable, sorted storage paths changed by this transaction. */
  changedFilePaths: string[];
}

/**
 * Atomically renames a class across the active document tree supplied by the
 * caller. Every HTML and CSS result is prepared before a new project snapshot
 * is created, so a parse/validation failure leaves the input project intact.
 */
export function renameProjectClassReferences(
  project: HtmlProject,
  filePaths: readonly string[],
  oldName: string,
  newName: string,
): RenameProjectClassReferencesResult {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || /[\s\u0000]/u.test(from) || !VALID_CLASS_NAME.test(to)) {
    throw new Error('Nome de classe inválido.');
  }
  if (from === to) return { project, changedFilePaths: [] };

  const prepared = new Map<string, string>();
  Array.from(new Set(filePaths)).sort().forEach(path => {
    const file = project.files[path];
    if (!file || file.text === undefined) return;
    const nextText = /\.html?$/i.test(file.path)
      ? renameClassInHtml(file.text, from, to)
      : /\.css$/i.test(file.path)
        ? renameClassInCss(file.text, from, to)
        : file.text;
    if (nextText !== file.text) prepared.set(path, nextText);
  });

  const sourceChangedFilePaths = [...prepared.keys()];
  let sourceProject = project;
  if (sourceChangedFilePaths.length) {
    const files = { ...project.files };
    prepared.forEach((text, path) => {
      files[path] = { ...files[path], text };
    });
    sourceProject = { ...project, files };
  }
  const interactionRename = renameProjectInteractionClassReferences(
    sourceProject,
    filePaths,
    from,
    to,
  );
  const changedFilePaths = Array.from(new Set([
    ...sourceChangedFilePaths,
    ...interactionRename.changedFilePaths,
  ])).sort();
  if (!changedFilePaths.length) return { project, changedFilePaths };
  return {
    project: interactionRename.project,
    changedFilePaths,
  };
}

/** True when a single selector part is exactly this class, optionally with one pseudo-class/element chain. */
function selectorPartOwnsClass(part: string, className: string) {
  const token = `.${className}`;
  const trimmed = part.trim();
  return trimmed === token || trimmed.startsWith(`${token}:`);
}

/**
 * Clones every rule that belongs ONLY to `sourceName` (its base rule, any
 * pseudo-state rules, across every media query) under `newName` — "Duplicate
 * class", the fast way to start a variant from an existing style. Rules that
 * mix the class with others (`.source.other`) are left untouched: only the
 * class's own declarations are cloned, nothing borrowed from a combo.
 */
export function duplicateClassInCss(css: string, sourceName: string, newName: string): string {
  const root = postcss.parse(css);
  const containers: Container[] = [root];
  root.walkAtRules('media', atRule => { containers.push(atRule); });
  containers.forEach(container => {
    const matches = (container.nodes || []).filter(
      (node): node is Rule => node.type === 'rule' && node.selector.split(',').some(part => selectorPartOwnsClass(part, sourceName)),
    );
    matches.forEach(rule => {
      const ownParts = rule.selector.split(',').map(part => part.trim()).filter(part => selectorPartOwnsClass(part, sourceName));
      const newSelector = ownParts.map(part => part.replace(`.${sourceName}`, `.${newName}`)).join(', ');
      const clone = rule.clone({ selector: newSelector });
      rule.after(clone);
    });
  });
  return root.toString();
}

/** First unused `name-2`, `name-3`, … for a duplicated class. */
export function suggestDuplicateClassName(sourceName: string, existingClasses: Iterable<string>) {
  const used = new Set(existingClasses);
  let suffix = 2;
  let candidate = `${sourceName}-${suffix}`;
  while (used.has(candidate)) candidate = `${sourceName}-${++suffix}`;
  return candidate;
}
