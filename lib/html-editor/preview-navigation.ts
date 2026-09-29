import type { HtmlProject } from './types';

export type PreviewNavigationHref =
  | { kind: 'ignored'; href: string }
  | { kind: 'hash'; href: string; hash: string }
  | { kind: 'external'; href: string }
  | {
      kind: 'project';
      href: string;
      pathname: string;
      search: string;
      hash: string;
      /** True for an authored absolute URL that belongs to the published site. */
      sameSiteAbsolute: boolean;
    };

export interface PreviewNavigationHrefOptions {
  /**
   * Public project origin. Absolute links on this origin are project routes,
   * while every other http(s) origin remains an external link.
   */
  siteUrl?: string | null;
}

const ABSOLUTE_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
const HTTP_SCHEME_PATTERN = /^https?:$/i;
const UNSAFE_URL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function normalizedSiteUrl(value?: string | null) {
  if (!value) return null;
  try {
    const site = new URL(value);
    return HTTP_SCHEME_PATTERN.test(site.protocol) ? site : null;
  } catch {
    return null;
  }
}

function siteRelativePathname(site: URL, pathname: string) {
  const basePath = site.pathname.replace(/\/+$/, '') || '/';
  if (basePath === '/') return pathname || '/';
  if (pathname === basePath) return '/';
  if (!pathname.startsWith(`${basePath}/`)) return pathname || '/';
  return `/${pathname.slice(basePath.length).replace(/^\/+/, '')}`;
}

function splitLocalHref(href: string) {
  const hashAt = href.indexOf('#');
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const queryAt = beforeHash.indexOf('?');
  return {
    pathname: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash,
    search: queryAt >= 0 ? beforeHash.slice(queryAt) : '',
    hash,
  };
}

/**
 * Classify an authored Preview link without consulting the authenticated
 * Builder URL. `about:srcdoc` inherits that URL as its fallback base; resolving
 * a project-relative href against it is what can turn `about.html` into a
 * WordPress/admin request and render a login screen inside the iframe.
 *
 * Local paths deliberately stay relative here. The caller owns the active
 * project page/root and can therefore resolve `../`, clean routes, CMS paths
 * and locale prefixes against project files rather than against WordPress.
 */
export function classifyPreviewNavigationHref(
  value: string,
  options: PreviewNavigationHrefOptions = {},
): PreviewNavigationHref {
  const href = String(value || '').trim();
  if (!href || UNSAFE_URL_CHARACTER_PATTERN.test(href)) return { kind: 'ignored', href };
  if (href.startsWith('#')) return { kind: 'hash', href, hash: href };

  const site = normalizedSiteUrl(options.siteUrl);
  const scheme = href.match(ABSOLUTE_SCHEME_PATTERN)?.[1]?.toLowerCase() || '';
  const networkPath = href.startsWith('//');
  if (scheme && scheme !== 'http' && scheme !== 'https') return { kind: 'ignored', href };

  if (scheme || networkPath) {
    let destination: URL;
    try {
      destination = new URL(href, site || new URL('https://kodety.invalid/'));
    } catch {
      return { kind: 'ignored', href };
    }
    if (!HTTP_SCHEME_PATTERN.test(destination.protocol)) return { kind: 'ignored', href };
    if (!site || destination.origin !== site.origin) {
      return { kind: 'external', href: destination.toString() };
    }
    return {
      kind: 'project',
      href,
      pathname: siteRelativePathname(site, destination.pathname),
      search: destination.search,
      hash: destination.hash,
      sameSiteAbsolute: true,
    };
  }

  const local = splitLocalHref(href);
  return {
    kind: 'project',
    href,
    ...local,
    sameSiteAbsolute: false,
  };
}

/**
 * Resolve a project route inside the isolated hosted-preview namespace.
 * Root-relative and same-site absolute URLs must start at the token root;
 * document-relative and query-only URLs retain the active preview page as
 * their base. Neither branch ever consults the authenticated Builder URL.
 */
export function hostedPreviewNavigationUrl(
  previewRootUrl: string,
  activePageUrl: string,
  navigation: Extract<PreviewNavigationHref, { kind: 'project' }>,
) {
  try {
    const root = new URL(previewRootUrl);
    root.pathname = `${root.pathname.replace(/\/+$/, '')}/`;
    root.search = '';
    root.hash = '';
    if (navigation.sameSiteAbsolute || navigation.pathname.startsWith('/')) {
      const path = navigation.pathname === '/'
        ? ''
        : navigation.pathname.replace(/^\/+/, '');
      // Resolve root-relative authored input against a throwaway origin first.
      // URL then clamps `/../../wp-login.php` to `/wp-login.php`; prefixing the
      // normalized result onto `root` keeps it under `/preview/<token>/`.
      const virtualDestination = new URL(
        `${path}${navigation.search}${navigation.hash}`,
        'https://kodety-preview.invalid/',
      );
      return new URL(
        `${virtualDestination.pathname.replace(/^\/+/, '')}${virtualDestination.search}${virtualDestination.hash}`,
        root,
      ).toString();
    }
    const active = new URL(activePageUrl);
    if (active.origin !== root.origin || !active.pathname.startsWith(root.pathname)) return '';
    // Resolve against a virtual origin whose `/` is the token root. URL's own
    // dot-segment normalization then clamps even hostile `../../..` input at
    // that root instead of letting it climb back into WordPress/admin.
    const activeRelativePath = active.pathname.slice(root.pathname.length);
    const virtualBase = new URL(activeRelativePath, 'https://kodety-preview.invalid/');
    const virtualDestination = new URL(navigation.href, virtualBase);
    return new URL(
      `${virtualDestination.pathname.replace(/^\/+/, '')}${virtualDestination.search}${virtualDestination.hash}`,
      root,
    ).toString();
  } catch {
    return '';
  }
}

/**
 * A page switch changes only ephemeral routing state. Keeping this check
 * intentionally strict lets the editor bypass project-wide normalizers on the
 * click path without allowing an authored or persistent mutation through.
 */
export function isProjectPageNavigation(
  previous: HtmlProject | null | undefined,
  next: HtmlProject,
) {
  if (!previous) return false;
  const routeChanged =
    previous.mainHtmlPath !== next.mainHtmlPath
    || previous.previewRootPath !== next.previewRootPath;
  return Boolean(
    routeChanged
    && previous.files === next.files
    && previous.name === next.name
    && previous.rootPath === next.rootPath
    && previous.openedAt === next.openedAt
  );
}

/**
 * A read-only Preview still needs local browsing state so internal links can
 * switch documents. Project edits are immutable, therefore retaining the
 * exact files object is the strictest cheap proof that no authored byte changed.
 * Only the two ephemeral routing fields may differ.
 */
export function isReadOnlyPreviewNavigation(
  previous: HtmlProject | null | undefined,
  next: HtmlProject,
  previewing: boolean,
) {
  return previewing && isProjectPageNavigation(previous, next);
}
