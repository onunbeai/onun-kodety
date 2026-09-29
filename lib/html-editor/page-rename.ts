import type { JSONValue, ResponsiveValue } from '@coday/control-schema';
import type { CodeComponentInstance } from '@coday/component-registry';
import {
  experimentVariantPrefix,
  readExperimentSettings,
  writeExperimentSettings,
} from './experiments';
import {
  interactionDocumentPath,
  interactionDocumentPathCandidates,
} from './interactions';
import type {
  LocalizationElementOverride,
  LocalizationInsertion,
  LocalizationPageTranslation,
  LocalizationSettings,
} from './localization';
import { localizedPageStylesheetPath } from './localization';
import { LOCALIZED_PAGE_STYLESHEET_HEADER } from './localized-css';
import {
  membershipSettingsFromMetadata,
  type MembershipAccessRule,
  type MembershipFallback,
  type MembershipSettings,
} from './membership';
import {
  getProjectHomePath,
  readEditorMetadata,
  renameProjectFile,
  updateEditorMetadata,
} from './project-io';
import {
  publicRouteForProjectPage,
  remapRedirectDestination,
} from './redirects';
import { remapCustomCodePage } from './custom-code';
import { remapPageTransitionPage } from './page-transitions';
import type {
  HtmlProject,
  HtmlProjectFile,
} from './types';

const NAVIGATION_ATTRIBUTES = new Set(['href', 'action', 'formaction']);
const VARIANT_PROJECT_PREFIX =
  /^\.incode\/experiments\/[^/]+\/[^/]+\/project\//;

function normalizePath(value: string) {
  const stack: string[] = [];
  value
    .replaceAll('\\', '/')
    .split('/')
    .forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') stack.pop();
      else stack.push(part);
    });
  return stack.join('/');
}

function dirname(value: string) {
  const parts = normalizePath(value).split('/');
  parts.pop();
  return parts.join('/');
}

function relativePath(fromDirectory: string, toPath: string) {
  const from = normalizePath(fromDirectory).split('/').filter(Boolean);
  const to = normalizePath(toPath).split('/').filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  return [
    ...Array.from({ length: from.length - shared }, () => '..'),
    ...to.slice(shared),
  ].join('/') || '.';
}

function splitReference(value: string) {
  const match = value.match(/^([^?#]*)([\s\S]*)$/);
  return {
    path: match?.[1] || '',
    suffix: match?.[2] || '',
  };
}

function decodePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePath(value: string) {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function publicDocumentPath(storagePath: string) {
  return normalizePath(storagePath).replace(VARIANT_PROJECT_PREFIX, '');
}

function projectPathFromAbsoluteRoute(route: string, rootPath: string) {
  return normalizePath(`${rootPath}/${route.replace(/^\/+/, '')}`);
}

function projectPathCandidates(
  referencePath: string,
  documentPath: string,
  rootPath: string,
) {
  const decoded = decodePath(referencePath).replaceAll('\\', '/');
  const absolute = decoded.startsWith('/');
  const base = absolute
    ? projectPathFromAbsoluteRoute(decoded, rootPath)
    : normalizePath(`${dirname(publicDocumentPath(documentPath))}/${decoded}`);
  const candidates = new Set([base]);
  const extensionless = !/\.html?$/i.test(base);
  if (extensionless) {
    candidates.add(`${base}.html`);
    candidates.add(`${base}/index.html`);
  }
  if (/\/$/i.test(decoded)) candidates.add(`${base}/index.html`);
  return candidates;
}

function routeRelativeToDocument(route: string, documentPath: string) {
  const target = route.replace(/^\/+/, '');
  const sourceRoute = publicRouteForProjectPage(publicDocumentPath(documentPath), '');
  const sourceDirectory = dirname(sourceRoute.replace(/^\/+/, ''));
  return relativePath(sourceDirectory, target) || '.';
}

export interface PageReferenceRemap {
  currentPath: string;
  nextPath: string;
  oldHomePath: string;
  nextHomePath: string;
  rootPath: string;
}

/**
 * Rewrites one authored navigation value while preserving its original form:
 * clean routes stay clean, `.html` links retain their extension, and query /
 * hash suffixes are kept byte-for-byte.
 */
export function remapPageReference(
  value: string,
  documentPath: string,
  remap: PageReferenceRemap,
) {
  const trimmed = value.trim();
  if (
    !trimmed
    || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(trimmed)
  ) return value;

  const { path: referencePath, suffix } = splitReference(trimmed);
  if (!referencePath) return value;
  const decodedReference = decodePath(referencePath).replaceAll('\\', '/');
  const oldRoute = publicRouteForProjectPage(
    remap.currentPath,
    remap.oldHomePath,
  );
  const nextRoute = publicRouteForProjectPage(
    remap.nextPath,
    remap.nextHomePath,
  );
  const normalizedRoute = `/${normalizePath(decodedReference)}`;
  const routeMatch = decodedReference.startsWith('/')
    && normalizedRoute.replace(/\/+$/, '') === oldRoute.replace(/\/+$/, '');
  const physicalMatch = projectPathCandidates(
    referencePath,
    documentPath,
    remap.rootPath,
  ).has(normalizePath(remap.currentPath));
  if (!routeMatch && !physicalMatch) return value;

  const absolute = decodedReference.startsWith('/');
  const keptHtmlExtension = /\.html?$/i.test(decodedReference);
  const keptTrailingSlash = /\/$/.test(decodedReference);
  let replacement: string;
  if (absolute) {
    if (routeMatch && !keptHtmlExtension) {
      replacement = nextRoute;
    } else {
      const physical = normalizePath(remap.nextPath)
        .slice(normalizePath(remap.rootPath).length)
        .replace(/^\/+/, '');
      replacement = `/${keptHtmlExtension
        ? physical
        : publicRouteForProjectPage(physical, '').replace(/^\/+/, '')}`;
    }
  } else if (keptHtmlExtension) {
    replacement = relativePath(
      dirname(publicDocumentPath(documentPath)),
      remap.nextPath,
    );
    if (decodedReference.startsWith('./') && !replacement.startsWith('.')) {
      replacement = `./${replacement}`;
    }
  } else {
    replacement = routeRelativeToDocument(nextRoute, documentPath);
    if (decodedReference.startsWith('./') && !replacement.startsWith('.')) {
      replacement = `./${replacement}`;
    }
  }
  if (keptTrailingSlash && replacement !== '/' && !replacement.endsWith('/')) {
    replacement += '/';
  }

  const leading = value.slice(0, value.indexOf(trimmed));
  const trailing = value.slice(value.indexOf(trimmed) + trimmed.length);
  return `${leading}${encodePath(replacement)}${suffix}${trailing}`;
}

export function remapPageLinksInMarkup(
  markup: string,
  documentPath: string,
  remap: PageReferenceRemap,
) {
  let count = 0;
  const source = markup.replace(
    /\b(href|action|formaction)\s*=\s*(?:(["'])(.*?)\2|([^\s>]+))/gi,
    (
      match,
      rawName: string,
      quote: string | undefined,
      quoted: string | undefined,
      bare: string | undefined,
    ) => {
      const value = quoted ?? bare ?? '';
      const next = remapPageReference(value, documentPath, remap);
      if (next === value) return match;
      count += 1;
      const boundary = quote || '"';
      return `${rawName}=${boundary}${next}${boundary}`;
    },
  );
  return { source, count };
}

function remapFallback(
  fallback: MembershipFallback,
  remap: PageReferenceRemap,
) {
  if (fallback.type !== 'redirect') return fallback;
  const url = remapPageReference(fallback.url, remap.currentPath, remap);
  return url === fallback.url ? fallback : { ...fallback, url };
}

function remapMembershipRule(
  rule: MembershipAccessRule,
  remap: PageReferenceRemap,
) {
  return {
    ...rule,
    anonymous: remapFallback(rule.anonymous, remap),
    denied: remapFallback(rule.denied, remap),
  };
}

function remapMembership(
  settings: MembershipSettings,
  remap: PageReferenceRemap,
) {
  const pages: MembershipSettings['pages'] = {};
  Object.entries(settings.pages).forEach(([path, rule]) => {
    pages[path === remap.currentPath ? remap.nextPath : path] =
      remapMembershipRule(rule, remap);
  });
  const audienceOverrides = Object.fromEntries(
    Object.entries(settings.audienceOverrides || {}).map(([path, overrides]) => [
      path === remap.currentPath ? remap.nextPath : path,
      overrides,
    ]),
  );
  return {
    ...settings,
    pages,
    ...(Object.keys(audienceOverrides).length ? { audienceOverrides } : {}),
    gates: Object.fromEntries(
      Object.entries(settings.gates).map(([id, gate]) => [
        id,
        { ...gate, ...remapMembershipRule(gate, remap) },
      ]),
    ),
  };
}

function remapLocalizationOverride(
  override: LocalizationElementOverride,
  documentPath: string,
  remap: PageReferenceRemap,
) {
  const attributes = override.attributes
    ? Object.fromEntries(Object.entries(override.attributes).map(([name, value]) => [
      name,
      typeof value === 'string' && NAVIGATION_ATTRIBUTES.has(name.toLowerCase())
        ? remapPageReference(value, documentPath, remap)
        : value,
    ]))
    : undefined;
  return attributes ? { ...override, attributes } : override;
}

function remapLocalizationInsertion(
  insertion: LocalizationInsertion,
  documentPath: string,
  remap: PageReferenceRemap,
) {
  const result = remapPageLinksInMarkup(insertion.html, documentPath, remap);
  return result.source === insertion.html
    ? insertion
    : { ...insertion, html: result.source };
}

function remapLocalizationPage(
  page: LocalizationPageTranslation,
  documentPath: string,
  remap: PageReferenceRemap,
  stylesheetPath?: string,
) {
  return {
    ...page,
    ...(stylesheetPath ? { stylesheet: stylesheetPath } : {}),
    path: page.path === remap.currentPath ? remap.nextPath : page.path,
    overrides: page.overrides
      ? Object.fromEntries(Object.entries(page.overrides).map(([key, override]) => [
        key,
        remapLocalizationOverride(override, documentPath, remap),
      ]))
      : undefined,
    insertions: page.insertions?.map(insertion =>
      remapLocalizationInsertion(insertion, documentPath, remap)),
  };
}

function remapLocalization(
  settings: LocalizationSettings | undefined,
  remap: PageReferenceRemap,
  managedStylesheetMoves: Map<string, { currentPath: string; nextPath: string }> = new Map(),
) {
  if (!settings) return settings;
  return {
    ...settings,
    translations: Object.fromEntries(
      Object.entries(settings.translations).map(([locale, translation]) => [
        locale,
        {
          ...translation,
          pages: Object.fromEntries(
            Object.entries(translation.pages).map(([path, page]) => {
              const nextPath = path === remap.currentPath ? remap.nextPath : path;
              const stylesheetMove = path === remap.currentPath
                ? managedStylesheetMoves.get(locale)
                : undefined;
              return [nextPath, remapLocalizationPage(
                page,
                path,
                remap,
                stylesheetMove && page.stylesheet === stylesheetMove.currentPath
                  ? stylesheetMove.nextPath
                  : undefined,
              )];
            }),
          ),
        },
      ]),
    ),
  };
}

function managedLocalizationStylesheetMoves(
  project: HtmlProject,
  currentPagePath: string,
  nextPagePath: string,
) {
  const localization = readEditorMetadata(project).localization;
  const moves = new Map<string, { currentPath: string; nextPath: string }>();
  if (!localization) return moves;
  const claimedTargets = new Set<string>();
  Object.entries(localization.translations || {}).forEach(([localeCode, translation]) => {
    const page = translation.pages?.[currentPagePath];
    if (!page?.stylesheet) return;
    const currentStylesheetPath = localizedPageStylesheetPath(currentPagePath, localeCode);
    if (!currentStylesheetPath || page.stylesheet !== currentStylesheetPath) return;
    const stylesheet = project.files[currentStylesheetPath];
    if (!stylesheet?.text?.startsWith(LOCALIZED_PAGE_STYLESHEET_HEADER)) return;
    const nextStylesheetPath = localizedPageStylesheetPath(nextPagePath, localeCode);
    if (!nextStylesheetPath) {
      throw new Error(`Não foi possível remapear o CSS localizado de ${localeCode}.`);
    }
    if (
      nextStylesheetPath !== currentStylesheetPath
      && (project.files[nextStylesheetPath] || claimedTargets.has(nextStylesheetPath))
    ) {
      throw new Error(`O arquivo localizado ${nextStylesheetPath} já existe.`);
    }
    claimedTargets.add(nextStylesheetPath);
    moves.set(localeCode, {
      currentPath: currentStylesheetPath,
      nextPath: nextStylesheetPath,
    });
  });
  return moves;
}

function remapJsonValue(
  value: JSONValue,
  remap: PageReferenceRemap,
): JSONValue {
  if (typeof value === 'string') {
    return remapPageReference(value, remap.currentPath, remap);
  }
  if (Array.isArray(value)) {
    return value.map(item => remapJsonValue(item, remap));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        remapJsonValue(item, remap),
      ]),
    );
  }
  return value;
}

function remapResponsiveValue(
  value: ResponsiveValue<JSONValue>,
  remap: PageReferenceRemap,
): ResponsiveValue<JSONValue> {
  return {
    base: remapJsonValue(value.base, remap),
    overrides: value.overrides
      ? Object.fromEntries(
        Object.entries(value.overrides).map(([breakpointId, item]) => [
          breakpointId,
          item === undefined
            ? undefined
            : remapJsonValue(item as JSONValue, remap),
        ]),
      ) as ResponsiveValue<JSONValue>['overrides']
      : undefined,
  };
}

function remapCodeComponentInstance(
  instance: CodeComponentInstance,
  remap: PageReferenceRemap,
  linkProps: ReadonlySet<string>,
) {
  return {
    ...instance,
    props: Object.fromEntries(
      Object.entries(instance.props).map(([key, value]) => [
        key,
        linkProps.has(key) ? remapJsonValue(value, remap) : value,
      ]),
    ),
    responsiveProps: instance.responsiveProps
      ? Object.fromEntries(
        Object.entries(instance.responsiveProps).map(([key, value]) => [
          key,
          linkProps.has(key) ? remapResponsiveValue(value, remap) : value,
        ]),
      )
      : undefined,
    bindings: instance.bindings
      ? Object.fromEntries(
        Object.entries(instance.bindings).map(([key, binding]) => [
          key,
          linkProps.has(key) && binding.fallback !== undefined
            ? {
              ...binding,
              fallback: remapJsonValue(binding.fallback, remap),
            }
            : binding,
        ]),
      )
      : undefined,
  };
}

function renameStoredFile(
  files: Record<string, HtmlProjectFile>,
  currentPath: string,
  nextPath: string,
) {
  const file = files[currentPath];
  if (!file || currentPath === nextPath) return files;
  const next = { ...files };
  delete next[currentPath];
  next[nextPath] = { ...file, path: nextPath };
  return next;
}

function remapExperiments(
  project: HtmlProject,
  currentPath: string,
  nextPath: string,
) {
  const settings = readExperimentSettings(project);
  let files = project.files;
  const experiments = settings.experiments.map(experiment => {
    const experimentOwnsPage = experiment.pagePath === currentPath;
    const variants = experiment.variants.map(variant => {
      const sourceMatches = variant.sourcePagePath === currentPath;
      if (variant.kind !== 'variant' || (!sourceMatches && !experimentOwnsPage)) {
        return {
          ...variant,
          pagePath: variant.pagePath === currentPath ? nextPath : variant.pagePath,
          sourcePagePath: sourceMatches ? nextPath : variant.sourcePagePath,
        };
      }
      const prefix = experimentVariantPrefix(experiment.id, variant.id);
      const oldVariantPath = `${prefix}${currentPath}`;
      const nextVariantPath = `${prefix}${nextPath}`;
      files = renameStoredFile(files, oldVariantPath, nextVariantPath);
      const oldVariantDocumentPath = interactionDocumentPathCandidates(oldVariantPath)
        .find(path => Boolean(files[path]))
        || interactionDocumentPath(oldVariantPath);
      files = renameStoredFile(
        files,
        oldVariantDocumentPath,
        interactionDocumentPath(nextVariantPath),
      );
      const sourceFileDigests = variant.sourceFileDigests
        ? { ...variant.sourceFileDigests }
        : undefined;
      if (sourceFileDigests?.[currentPath]) {
        sourceFileDigests[nextPath] = sourceFileDigests[currentPath];
        delete sourceFileDigests[currentPath];
      }
      return {
        ...variant,
        pagePath: variant.pagePath === oldVariantPath
          ? nextVariantPath
          : variant.pagePath,
        sourcePagePath: nextPath,
        sourceFileDigests,
      };
    });
    return {
      ...experiment,
      pagePath: experimentOwnsPage ? nextPath : experiment.pagePath,
      goal: experiment.goal.type === 'pageview'
        && experiment.goal.pagePath === currentPath
        ? { ...experiment.goal, pagePath: nextPath }
        : experiment.goal,
      variants,
    };
  });
  return writeExperimentSettings(
    { ...project, files },
    { ...settings, experiments },
  );
}

export interface RenameProjectPageResult {
  project: HtmlProject;
  path: string;
  updatedLinks: number;
}

/**
 * Atomic page refactor used by the Pages panel, the Files panel and Settings.
 * The physical file, every authored internal link and all page-scoped metadata
 * move together, so Undo/Redo sees one coherent transaction.
 */
export function renameProjectPage(
  project: HtmlProject,
  currentPath: string,
  requestedPath: string,
): RenameProjectPageResult {
  let nextPath = normalizePath(requestedPath.trim().replace(/^\/+/, ''));
  if (!nextPath) throw new Error('Informe um nome ou caminho para a página.');
  if (!/\.html?$/i.test(nextPath)) {
    nextPath = `${nextPath.replace(/\/+$/, '')}.html`;
  }
  if (nextPath === currentPath) {
    return { project, path: currentPath, updatedLinks: 0 };
  }

  const localizedStylesheetMoves = managedLocalizationStylesheetMoves(
    project,
    currentPath,
    nextPath,
  );

  const oldHomePath = getProjectHomePath(project);
  // Page routes have structured consumers (experiments, localization,
  // memberships, redirects, code-component link controls…). They are remapped
  // below with type-aware rules; a raw text rewrite here would mutate the
  // metadata before those consumers can identify the old page.
  let next = renameProjectFile(
    project,
    currentPath,
    nextPath,
    {
      rewriteReferences: false,
      // The generic file boundary also serves the Files panel. Keeping the
      // companion move there makes every HTML rename atomic without duplicating
      // the flattened animation-path rules in this higher-level page refactor.
      moveInteractionCompanion: true,
    },
  );
  if (localizedStylesheetMoves.size) {
    let files = next.files;
    localizedStylesheetMoves.forEach(move => {
      files = renameStoredFile(files, move.currentPath, move.nextPath);
    });
    next = { ...next, files };
  }
  const nextHomePath = getProjectHomePath(next);
  const remap: PageReferenceRemap = {
    currentPath,
    nextPath,
    oldHomePath,
    nextHomePath,
    rootPath: readEditorMetadata(project).rootPath ?? project.rootPath,
  };

  next = remapPageTransitionPage(next, currentPath, nextPath);
  next = remapExperiments(next, currentPath, nextPath);
  let updatedLinks = 0;
  let files = next.files;
  Object.values(next.files).forEach(file => {
    if (file.text === undefined || !/\.html?$/i.test(file.path)) return;
    const result = remapPageLinksInMarkup(file.text, file.path, remap);
    if (result.source === file.text) return;
    updatedLinks += result.count;
    files = {
      ...files,
      [file.path]: { ...file, text: result.source },
    };
  });
  next = { ...next, files };

  next = updateEditorMetadata(next, metadata => {
    const pages = { ...(metadata.pageSettings || {}) };
    if (pages[currentPath]) {
      pages[nextPath] = pages[currentPath];
      delete pages[currentPath];
    }
    const locks = { ...(metadata.lockedLayers || {}) };
    if (locks[currentPath]) {
      locks[nextPath] = locks[currentPath];
      delete locks[currentPath];
    }
    const pageStatuses = { ...(metadata.pageStatuses || {}) };
    if (pageStatuses[currentPath]) {
      pageStatuses[nextPath] = pageStatuses[currentPath];
      delete pageStatuses[currentPath];
    }
    const membership = metadata.membership
      ? remapMembership(membershipSettingsFromMetadata(metadata), remap)
      : undefined;
    return {
      ...metadata,
      pageSettings: pages,
      pageStatuses: Object.keys(pageStatuses).length ? pageStatuses : undefined,
      lockedLayers: locks,
      localization: remapLocalization(metadata.localization, remap, localizedStylesheetMoves),
      codeComponents: metadata.codeComponents
        ? {
          ...metadata.codeComponents,
          instances: metadata.codeComponents.instances.map(instance => {
            const manifest = metadata.codeComponents?.components.find(component =>
              component.id === instance.componentId
              && component.version === instance.componentVersion)?.manifest;
            const linkProps = new Set(
              Object.entries(manifest?.controls || {})
                .filter(([, control]) => control.type === 'link')
                .map(([name]) => name),
            );
            return remapCodeComponentInstance(instance, remap, linkProps);
          }),
        }
        : undefined,
      ...(membership ? { membership } : {}),
      customCode: remapCustomCodePage(
        metadata.customCode,
        currentPath,
        nextPath,
      ),
      redirects: remapRedirectDestination(
        metadata.redirects,
        currentPath,
        nextPath,
        oldHomePath,
      ),
    };
  });

  return { project: next, path: nextPath, updatedLinks };
}
