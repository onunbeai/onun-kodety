import type { Font } from '@/types';

const ADOBE_STYLESHEET_HOST = 'use.typekit.net';
const ADOBE_PROJECT_ID_PATTERN = /^[a-z0-9]{1,64}$/;
const FONT_CATEGORIES = new Set([
  'serif',
  'sans-serif',
  'display',
  'handwriting',
  'monospace',
]);

export interface AdobeFontsCatalogSnapshot {
  configured: boolean;
  projectId: string;
  stylesheetUrl: string;
  fonts: Font[];
  familyCount: number;
  syncedAt: string | null;
  stale: boolean;
  lastError: string | null;
}

export function normalizeAdobeProjectId(value: unknown) {
  const projectId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ADOBE_PROJECT_ID_PATTERN.test(projectId) ? projectId : '';
}

export function adobeFontsStylesheetUrl(projectId: unknown) {
  const normalized = normalizeAdobeProjectId(projectId);
  return normalized ? `https://${ADOBE_STYLESHEET_HOST}/${normalized}.css` : '';
}

/** Accept only Adobe's public web-project stylesheet, never a caller-owned URL. */
export function normalizeAdobeFontsStylesheetUrl(value: unknown, projectId?: unknown) {
  const normalizedProjectId = normalizeAdobeProjectId(projectId);
  const fallback = adobeFontsStylesheetUrl(normalizedProjectId);
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== 'https:'
      || url.hostname !== ADOBE_STYLESHEET_HOST
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return '';
    const match = url.pathname.match(/^\/([a-z0-9]{1,64})\.css$/);
    if (!match) return '';
    if (normalizedProjectId && match[1] !== normalizedProjectId) return '';
    return `https://${ADOBE_STYLESHEET_HOST}/${match[1]}.css`;
  } catch {
    return '';
  }
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)))
    : [];
}

function uniqueStrings(...groups: unknown[]) {
  return Array.from(new Set(groups.flatMap(stringList)));
}

function quoteFontFamily(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function normalizeCategory(value: unknown) {
  const category = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s_]+/g, '-')
    : '';
  return FONT_CATEGORIES.has(category) ? category : 'sans-serif';
}

function normalizeAdobeFont(
  value: unknown,
  projectId: string,
  stylesheetUrl: string,
  stylesheetVersion: string | null,
): Font | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const family = typeof candidate.family === 'string'
    ? candidate.family.trim().replace(/\s+/g, ' ')
    : '';
  if (!family || family.length > 200) return null;
  const name = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const displayNameCandidate = candidate.displayName ?? candidate.display_name;
  const displayName = typeof displayNameCandidate === 'string' && displayNameCandidate.trim()
    ? displayNameCandidate.trim()
    : family;
  const id = typeof candidate.id === 'string' && candidate.id.trim()
    ? candidate.id.trim()
    : `adobe-${name || family.toLowerCase().replace(/\s+/g, '-')}`;
  const variants = stringList(candidate.variants);
  const weights = stringList(candidate.weights)
    .filter(weight => /^\d{1,4}$/.test(weight));
  const cssNames = uniqueStrings(candidate.cssNames, candidate.css_names);
  const aliases = uniqueStrings(candidate.aliases, cssNames)
    .filter(alias => alias.toLocaleLowerCase() !== family.toLocaleLowerCase());
  const cssStackCandidate = candidate.cssStack ?? candidate.css_stack;
  const providerCssStack = typeof cssStackCandidate === 'string' && cssStackCandidate.trim()
    ? cssStackCandidate.trim()
    : '';
  const cssStack = providerCssStack && !/[;{}<>]/.test(providerCssStack)
    ? providerCssStack
    : [family, ...cssNames.filter(cssName => cssName !== family)]
      .map(quoteFontFamily)
      .concat(normalizeCategory(candidate.category))
      .join(', ');
  const subset = typeof candidate.subset === 'string' && candidate.subset.trim()
    ? candidate.subset.trim()
    : null;
  return {
    id,
    name: name || id,
    displayName,
    family,
    type: 'adobe',
    variants: variants.length ? variants : ['regular'],
    weights: weights.length ? weights : ['400'],
    category: normalizeCategory(candidate.category),
    ...(aliases.length ? { aliases } : {}),
    ...(cssNames.length ? { cssNames } : {}),
    cssStack,
    ...(subset ? { subset } : {}),
    provider_project_id: projectId || null,
    stylesheet_url: stylesheetUrl || null,
    stylesheet_version: stylesheetVersion,
    is_published: false,
    created_at: '',
    updated_at: '',
    deleted_at: null,
  };
}

export function emptyAdobeFontsCatalogSnapshot(): AdobeFontsCatalogSnapshot {
  return {
    configured: false,
    projectId: '',
    stylesheetUrl: '',
    fonts: [],
    familyCount: 0,
    syncedAt: null,
    stale: false,
    lastError: null,
  };
}

/** Normalize both the canonical REST object and a conventional `{ data }` wrapper. */
export function normalizeAdobeFontsCatalogSnapshot(payload: unknown): AdobeFontsCatalogSnapshot {
  const topLevel = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const hasTopLevelSnapshot = Boolean(topLevel && (
    'configured' in topLevel
    || 'projectId' in topLevel
    || 'stylesheetUrl' in topLevel
    || 'fonts' in topLevel
  ));
  const wrapped = !hasTopLevelSnapshot
    && topLevel?.data
    && typeof topLevel.data === 'object'
    && !Array.isArray(topLevel.data)
    ? topLevel.data
    : payload;
  if (!wrapped || typeof wrapped !== 'object') return emptyAdobeFontsCatalogSnapshot();
  const candidate = wrapped as Record<string, unknown>;
  const projectId = normalizeAdobeProjectId(candidate.projectId);
  const stylesheetUrl = normalizeAdobeFontsStylesheetUrl(candidate.stylesheetUrl, projectId);
  const syncedAt = typeof candidate.syncedAt === 'string' && candidate.syncedAt.trim()
    ? candidate.syncedAt.trim()
    : null;
  const fonts = Array.isArray(candidate.fonts)
    ? candidate.fonts
      .map(font => normalizeAdobeFont(font, projectId, stylesheetUrl, syncedAt))
      .filter((font): font is Font => Boolean(font))
    : [];
  const lastError = typeof candidate.lastError === 'string' && candidate.lastError.trim()
    ? candidate.lastError.trim()
    : null;
  const configured = candidate.configured === true && Boolean(projectId && stylesheetUrl);
  return {
    configured,
    projectId,
    stylesheetUrl,
    fonts: configured ? fonts : [],
    familyCount: configured
      ? Math.max(fonts.length, Number.isFinite(Number(candidate.familyCount))
        ? Math.max(0, Number(candidate.familyCount))
        : 0)
      : 0,
    syncedAt,
    stale: candidate.stale === true,
    lastError,
  };
}
