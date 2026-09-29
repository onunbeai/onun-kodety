import {
  parseStyleDeclarations,
  serializeStyleDeclarations,
  writeStyleDeclaration,
} from './style-utils';

export const MEMBERSHIP_SCHEMA_VERSION = 1 as const;

export const MEMBERSHIP_GATE_ATTRIBUTE = 'data-kodety-access-gate';
export const MEMBERSHIP_BRANCH_ATTRIBUTE = 'data-kodety-access-branch';
export const MEMBERSHIP_FORM_ATTRIBUTE = 'data-kodety-member-form';
export const MEMBERSHIP_PROTECTED_DOWNLOAD_ATTRIBUTE = 'data-kodety-protected-download';
export const MEMBERSHIP_AUDIENCE_ELEMENT_ATTRIBUTE = 'data-kodety-audience-id';
export const MEMBERSHIP_PROTECTED_DOWNLOAD_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  'html',
  'htm',
  'php',
  'phtml',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'svg',
]);

export const MAX_MEMBERSHIP_GATES = 2_000;
export const MAX_MEMBERSHIP_PAGE_RULES = 2_000;
export const MAX_MEMBERSHIP_PLAN_KEYS = 100;

export type MembershipPlanMatch = 'any' | 'all';
export type MembershipBranch = 'content' | 'guest' | 'upgrade';
export type MembershipAudienceLayerId = 'guest' | 'member' | `plan:${string}`;
export type MembershipPreviewLayerId = 'base' | MembershipAudienceLayerId;

export interface MembershipAudienceElementOverride {
  visible?: boolean;
  styles?: Record<string, string | null>;
}

export type MembershipAudiencePageOverrides = Record<
  string,
  Record<string, MembershipAudienceElementOverride>
>;
export type MembershipFormPurpose =
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'reset-password'
  | 'profile'
  | 'logout';

export type MembershipAccessRequirement =
  | { type: 'public' }
  | { type: 'authenticated' }
  | { type: 'plans'; match: MembershipPlanMatch; planKeys: string[] }
  | { type: 'invalid'; reason: string };

export type MembershipFallback =
  | { type: 'branch'; branch: Exclude<MembershipBranch, 'content'> }
  | { type: 'hide' }
  | { type: 'redirect'; url: string };

export interface MembershipAccessRule {
  requirement: MembershipAccessRequirement;
  anonymous: MembershipFallback;
  denied: MembershipFallback;
}

export interface MembershipGateDefinition extends MembershipAccessRule {
  id: string;
  label: string;
}

/**
 * Project-owned membership contract.
 *
 * It intentionally stores only design-time access rules. Users, plans,
 * subscriptions and entitlement history belong to WordPress and must never be
 * serialized into `.incode/project.json`.
 */
export interface MembershipSettings {
  version: typeof MEMBERSHIP_SCHEMA_VERSION;
  enabled: boolean;
  gates: Record<string, MembershipGateDefinition>;
  pages: Record<string, MembershipAccessRule>;
  /**
   * Optional visual layers applied above the authored page. The first key is
   * the authored HTML path, then `guest`, `member` or `plan:<plan-key>`, then
   * the stable `data-kodety-audience-id` of an element.
   */
  audienceOverrides?: Record<string, MembershipAudiencePageOverrides>;
}

export interface MembershipMetadataExtension {
  membership?: MembershipSettings;
}

export type MembershipEntitlementStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'paused'
  | 'canceled'
  | 'expired'
  | 'revoked';

export interface MembershipEntitlement {
  planKey: string;
  status: MembershipEntitlementStatus;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface MembershipViewerContext {
  authenticated: boolean;
  userId?: string | number | null;
  /**
   * Convenience input for Builder preview. Runtime integrations should prefer
   * authoritative entitlements returned by WordPress.
   */
  planKeys?: readonly string[];
  entitlements?: readonly MembershipEntitlement[];
  /** Builder-only authoring state. Runtime access evaluation ignores it. */
  previewLayer?: MembershipPreviewLayerId;
}

export type MembershipEvaluationState =
  | 'public'
  | 'allowed'
  | 'guest'
  | 'denied'
  | 'misconfigured';

export type MembershipEvaluationReason =
  | 'public'
  | 'authenticated'
  | 'plan-match'
  | 'not-authenticated'
  | 'plan-missing'
  | 'membership-disabled'
  | 'gate-not-found'
  | 'invalid-rule';

export interface MembershipEvaluation {
  allowed: boolean;
  state: MembershipEvaluationState;
  reason: MembershipEvaluationReason;
  fallback: MembershipFallback | null;
  activePlanKeys: string[];
  matchedPlanKeys: string[];
  missingPlanKeys: string[];
}

export interface MembershipValidationIssue {
  code:
    | 'schema-version'
    | 'too-many-gates'
    | 'too-many-page-rules'
    | 'gate-id-invalid'
    | 'gate-label-required'
    | 'requirement-invalid'
    | 'plans-required'
    | 'too-many-plan-keys'
    | 'plan-key-invalid'
    | 'plan-not-found'
    | 'page-path-invalid'
    | 'redirect-invalid';
  message: string;
  severity: 'error' | 'warning';
  gateId?: string;
  pagePath?: string;
}

export interface MembershipPlanOption {
  key: string;
  name: string;
  status?: 'active' | 'archived' | 'draft' | string;
}

export interface MembershipProtectedDownloadScope {
  pagePath?: string;
  gateIds: string[];
}

export interface MembershipPreviewPersona {
  id: string;
  label: string;
  description: string;
  viewer: MembershipViewerContext;
}

export const DEFAULT_MEMBERSHIP_FALLBACKS = {
  anonymous: { type: 'branch', branch: 'guest' },
  denied: { type: 'branch', branch: 'upgrade' },
} as const satisfies {
  anonymous: MembershipFallback;
  denied: MembershipFallback;
};

export const DEFAULT_MEMBERSHIP_SETTINGS: MembershipSettings = {
  version: MEMBERSHIP_SCHEMA_VERSION,
  enabled: false,
  gates: {},
  pages: {},
};

const PLAN_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const GATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const AUDIENCE_ELEMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const AUDIENCE_STYLE_PROPERTY_PATTERN = /^(?:--[A-Za-z0-9_-]{1,100}|-?[A-Za-z][A-Za-z0-9-]{0,100})$/;
const ACCESSIBLE_ENTITLEMENT_STATUSES = new Set<MembershipEntitlementStatus>([
  'active',
  'trialing',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function booleanValue(value: unknown, fallback = false) {
  if (value === true || value === 1 || value === 'true') return true;
  if (value === false || value === 0 || value === 'false') return false;
  return fallback;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique<T>(values: readonly T[]) {
  return Array.from(new Set(values));
}

function normalizeMembershipAudienceLayerId(value: unknown): MembershipAudienceLayerId | '' {
  if (value === 'guest' || value === 'member') return value;
  if (typeof value !== 'string' || !value.startsWith('plan:')) return '';
  const key = normalizeMembershipPlanKey(value.slice(5));
  return key && isMembershipPlanKey(key) ? `plan:${key}` : '';
}

function normalizeMembershipAudienceOverrides(value: unknown) {
  const pages: Record<string, MembershipAudiencePageOverrides> = {};
  Object.entries(record(value)).slice(0, MAX_MEMBERSHIP_PAGE_RULES).forEach(([rawPath, rawPage]) => {
    const path = normalizeMembershipPagePath(rawPath);
    if (!path) return;
    const layers: MembershipAudiencePageOverrides = {};
    Object.entries(record(rawPage)).slice(0, MAX_MEMBERSHIP_PLAN_KEYS + 2).forEach(([rawLayer, rawElements]) => {
      const layer = normalizeMembershipAudienceLayerId(rawLayer);
      if (!layer) return;
      const elements: Record<string, MembershipAudienceElementOverride> = {};
      Object.entries(record(rawElements)).slice(0, 5_000).forEach(([rawElementId, rawOverride]) => {
        const elementId = rawElementId.trim();
        if (!AUDIENCE_ELEMENT_ID_PATTERN.test(elementId)) return;
        const source = record(rawOverride);
        const styles: Record<string, string | null> = {};
        Object.entries(record(source.styles)).slice(0, 200).forEach(([rawProperty, rawValue]) => {
          const property = rawProperty.trim().toLowerCase();
          if (!AUDIENCE_STYLE_PROPERTY_PATTERN.test(property)) return;
          if (rawValue === null) styles[property] = null;
          else if (typeof rawValue === 'string') styles[property] = rawValue.slice(0, 50_000);
        });
        const override: MembershipAudienceElementOverride = {};
        if (typeof source.visible === 'boolean') override.visible = source.visible;
        if (Object.keys(styles).length) override.styles = styles;
        if (override.visible !== undefined || override.styles) elements[elementId] = override;
      });
      if (Object.keys(elements).length) layers[layer] = elements;
    });
    if (Object.keys(layers).length) pages[path] = layers;
  });
  return pages;
}

function membershipSchemaVersionSupported(value: unknown) {
  const version = record(value).version;
  return version === undefined || Number(version) === MEMBERSHIP_SCHEMA_VERSION;
}

export function normalizeMembershipPlanKey(value: unknown) {
  return stringValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
}

export function isMembershipPlanKey(value: unknown): value is string {
  return typeof value === 'string' && PLAN_KEY_PATTERN.test(value);
}

export function normalizeMembershipPagePath(value: unknown) {
  const raw = stringValue(value).replaceAll('\\', '/').split(/[?#]/, 1)[0];
  if (!raw) return '';
  const stack: string[] = [];
  raw.replace(/^\/+/, '').split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') stack.pop();
    else stack.push(part);
  });
  return stack.join('/').slice(0, 512);
}

export function normalizeMembershipRedirectUrl(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate || /\s/.test(candidate) || candidate.startsWith('//')) return '';
  if (candidate.startsWith('/')) {
    try {
      const parsed = new URL(candidate, 'https://kodety.invalid');
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return '';
    }
  }
  try {
    const parsed = new URL(candidate);
    // Relative URLs remain suitable for same-origin development over HTTP.
    // Absolute redirects may leave the site (for example to a Shopify
    // checkout), so require HTTPS and reject embedded credentials.
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/** The authoring marker only accepts an explicit project-relative/root-relative
 * URL. Existence and containment are resolved against the current project by
 * the Builder; the publisher remains the final security boundary. */
export function isLocalMembershipProtectedDownloadHref(value: unknown) {
  const candidate = stringValue(value);
  if (
    !candidate
    || candidate.startsWith('//')
    || candidate.startsWith('#')
    || candidate.startsWith('?')
    || /^[a-z][a-z0-9+.-]*:/i.test(candidate)
    || /[\\\u0000-\u001f<>]/.test(candidate)
  ) return false;
  return true;
}

export function isMembershipProtectedDownloadFileTypeSupported(path: unknown) {
  const normalized = stringValue(path).split(/[?#]/, 1)[0].toLocaleLowerCase();
  const filename = normalized.split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop() || '' : '';
  return !MEMBERSHIP_PROTECTED_DOWNLOAD_BLOCKED_EXTENSIONS.has(extension);
}

function normalizePlanKeys(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return unique(source.map(normalizeMembershipPlanKey).filter(Boolean))
    .slice(0, MAX_MEMBERSHIP_PLAN_KEYS);
}

export function normalizeMembershipRequirement(value: unknown): MembershipAccessRequirement {
  if (value === 'public') return { type: 'public' };
  if (value === 'authenticated' || value === 'logged-in') return { type: 'authenticated' };
  const source = record(value);
  const type = stringValue(source.type ?? source.kind ?? source.access);
  if (type === 'public') return { type: 'public' };
  if (type === 'authenticated' || type === 'logged-in') return { type: 'authenticated' };
  if (type === 'plans' || type === 'plan') {
    const match = source.match === 'all' || source.mode === 'all' ? 'all' : 'any';
    return {
      type: 'plans',
      match,
      planKeys: normalizePlanKeys(
        source.planKeys ?? source.plans ?? source.requiredPlans,
      ),
    };
  }
  return {
    type: 'invalid',
    reason: type ? `Tipo de acesso desconhecido: ${type}.` : 'A regra não define um tipo de acesso.',
  };
}

export function normalizeMembershipFallback(
  value: unknown,
  fallback: MembershipFallback,
): MembershipFallback {
  if (value === 'hide') return { type: 'hide' };
  if (value === 'guest') return { type: 'branch', branch: 'guest' };
  if (value === 'upgrade') return { type: 'branch', branch: 'upgrade' };
  const source = record(value);
  const type = stringValue(source.type ?? source.action);
  if (type === 'hide') return { type: 'hide' };
  if (type === 'redirect') {
    return { type: 'redirect', url: normalizeMembershipRedirectUrl(source.url ?? source.redirectUrl) };
  }
  if (type === 'branch' || type === 'show') {
    const branch = source.branch === 'upgrade' ? 'upgrade' : 'guest';
    return { type: 'branch', branch };
  }
  return { ...fallback };
}

export function normalizeMembershipAccessRule(value: unknown): MembershipAccessRule {
  const source = record(value);
  return {
    requirement: normalizeMembershipRequirement(
      source.requirement ?? source.access ?? source.condition,
    ),
    anonymous: normalizeMembershipFallback(
      source.anonymous ?? source.guest,
      DEFAULT_MEMBERSHIP_FALLBACKS.anonymous,
    ),
    denied: normalizeMembershipFallback(
      source.denied ?? source.upgrade,
      DEFAULT_MEMBERSHIP_FALLBACKS.denied,
    ),
  };
}

function normalizeGateId(value: unknown, fallback: string) {
  const candidate = stringValue(value)
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return candidate || fallback;
}

export function normalizeMembershipSettings(value: unknown): MembershipSettings {
  const source = record(value);
  const rawGates = record(source.gates);
  const gates: Record<string, MembershipGateDefinition> = {};
  Object.entries(rawGates)
    .slice(0, MAX_MEMBERSHIP_GATES)
    .forEach(([rawId, rawGate], index) => {
      const gate = record(rawGate);
      const baseId = normalizeGateId(gate.id ?? rawId, `gate-${index + 1}`);
      let id = baseId;
      let suffix = 2;
      while (gates[id]) id = `${baseId}-${suffix++}`;
      gates[id] = {
        id,
        label: stringValue(gate.label ?? gate.name).slice(0, 120) || `Gate ${index + 1}`,
        ...normalizeMembershipAccessRule(gate),
      };
    });

  const rawPages = record(source.pages ?? source.pageRules);
  const pages: Record<string, MembershipAccessRule> = {};
  Object.entries(rawPages)
    .slice(0, MAX_MEMBERSHIP_PAGE_RULES)
    .forEach(([rawPath, rule]) => {
      const path = normalizeMembershipPagePath(rawPath);
      if (path) pages[path] = normalizeMembershipAccessRule(rule);
    });
  const audienceOverrides = normalizeMembershipAudienceOverrides(source.audienceOverrides);

  return {
    version: MEMBERSHIP_SCHEMA_VERSION,
    enabled: booleanValue(source.enabled, false),
    gates,
    pages,
    ...(Object.keys(audienceOverrides).length ? { audienceOverrides } : {}),
  };
}

export function membershipSettingsFromMetadata(metadata: unknown) {
  return normalizeMembershipSettings(record(metadata).membership);
}

export function withMembershipSettings<T extends Record<string, unknown>>(
  metadata: T,
  settings: MembershipSettings,
): T & MembershipMetadataExtension {
  return {
    ...metadata,
    membership: normalizeMembershipSettings(settings),
  };
}

export function createMembershipGateId(existing: Iterable<string> = []) {
  const used = new Set(existing);
  const cryptoId = globalThis.crypto?.randomUUID?.();
  const base = `gate-${cryptoId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

export function createMembershipAccessRule(
  requirement: MembershipAccessRequirement = { type: 'authenticated' },
): MembershipAccessRule {
  return {
    requirement,
    anonymous: { ...DEFAULT_MEMBERSHIP_FALLBACKS.anonymous },
    denied: { ...DEFAULT_MEMBERSHIP_FALLBACKS.denied },
  };
}

export function createMembershipGate(
  label = 'Área de membros',
  existingIds: Iterable<string> = [],
): MembershipGateDefinition {
  return {
    id: createMembershipGateId(existingIds),
    label: label.trim().slice(0, 120) || 'Área de membros',
    ...createMembershipAccessRule(),
  };
}

export function createMembershipAudienceElementId(existing: Iterable<string> = []) {
  const used = new Set(existing);
  const cryptoId = globalThis.crypto?.randomUUID?.().replaceAll('-', '');
  const base = `aud-${cryptoId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`
    .slice(0, 120);
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base.slice(0, 115)}-${suffix++}`;
  return id;
}

export function membershipPreviewLayerId(
  viewer: MembershipViewerContext,
): MembershipPreviewLayerId {
  if (viewer.previewLayer === 'base') return 'base';
  const requested = normalizeMembershipAudienceLayerId(viewer.previewLayer);
  if (requested) return requested;
  if (!viewer.authenticated) return 'guest';
  const planKeys = membershipActivePlanKeys(viewer);
  return planKeys.length === 1 ? `plan:${planKeys[0]}` : 'member';
}

/** Runtime order: plan-specific decisions inherit the general member layer. */
export function membershipAudienceLayersForViewer(
  viewer: MembershipViewerContext,
): MembershipAudienceLayerId[] {
  if (!viewer.authenticated) return ['guest'];
  return [
    'member',
    ...membershipActivePlanKeys(viewer)
      .sort((left, right) => left.localeCompare(right))
      .map((key): MembershipAudienceLayerId => `plan:${key}`),
  ];
}

export function updateMembershipAudienceElementOverride(
  settingsValue: MembershipSettings | unknown,
  pagePathValue: string,
  layerValue: MembershipAudienceLayerId,
  elementIdValue: string,
  patch: MembershipAudienceElementOverride,
) {
  const settings = normalizeMembershipSettings(settingsValue);
  const pagePath = normalizeMembershipPagePath(pagePathValue);
  const layer = normalizeMembershipAudienceLayerId(layerValue);
  const elementId = elementIdValue.trim();
  if (!pagePath || !layer || !AUDIENCE_ELEMENT_ID_PATTERN.test(elementId)) return settings;
  const page = { ...(settings.audienceOverrides?.[pagePath] || {}) };
  const elements = { ...(page[layer] || {}) };
  const previous = elements[elementId] || {};
  const styles = { ...(previous.styles || {}) };
  Object.entries(patch.styles || {}).forEach(([rawProperty, rawValue]) => {
    const property = rawProperty.trim().toLowerCase();
    if (!AUDIENCE_STYLE_PROPERTY_PATTERN.test(property)) return;
    if (rawValue === null || rawValue === '') delete styles[property];
    else styles[property] = rawValue.slice(0, 50_000);
  });
  const next: MembershipAudienceElementOverride = {};
  const visible = patch.visible === undefined ? previous.visible : patch.visible;
  if (visible !== undefined) next.visible = visible;
  if (Object.keys(styles).length) next.styles = styles;
  if (next.visible === undefined && !next.styles) delete elements[elementId];
  else elements[elementId] = next;
  if (Object.keys(elements).length) page[layer] = elements;
  else delete page[layer];
  const audienceOverrides = { ...(settings.audienceOverrides || {}) };
  if (Object.keys(page).length) audienceOverrides[pagePath] = page;
  else delete audienceOverrides[pagePath];
  return {
    ...settings,
    ...(Object.keys(audienceOverrides).length ? { audienceOverrides } : { audienceOverrides: undefined }),
  };
}

export function removeMembershipAudiencePageLayer(
  settingsValue: MembershipSettings | unknown,
  pagePathValue: string,
  layerValue: MembershipAudienceLayerId,
) {
  const settings = normalizeMembershipSettings(settingsValue);
  const pagePath = normalizeMembershipPagePath(pagePathValue);
  const layer = normalizeMembershipAudienceLayerId(layerValue);
  if (!pagePath || !layer || !settings.audienceOverrides?.[pagePath]?.[layer]) return settings;
  const page = { ...settings.audienceOverrides[pagePath] };
  delete page[layer];
  const audienceOverrides = { ...settings.audienceOverrides };
  if (Object.keys(page).length) audienceOverrides[pagePath] = page;
  else delete audienceOverrides[pagePath];
  return {
    ...settings,
    ...(Object.keys(audienceOverrides).length ? { audienceOverrides } : { audienceOverrides: undefined }),
  };
}

function applyMembershipAudienceElementOverride(
  element: HTMLElement,
  override: MembershipAudienceElementOverride,
) {
  let styles = parseStyleDeclarations(element.getAttribute('style') || '');
  Object.entries(override.styles || {}).forEach(([property, value]) => {
    styles = writeStyleDeclaration(styles, property, value || '', { authoritative: true });
  });
  if (override.visible === false) {
    element.setAttribute('data-kodety-audience-hidden', '');
    element.setAttribute('hidden', '');
    element.setAttribute('aria-hidden', 'true');
    styles = writeStyleDeclaration(styles, 'display', 'none', { authoritative: true });
  } else if (override.visible === true) {
    element.removeAttribute('data-kodety-audience-hidden');
    element.removeAttribute('hidden');
    element.removeAttribute('aria-hidden');
  }
  const serialized = serializeStyleDeclarations(styles);
  if (serialized) element.setAttribute('style', serialized);
  else element.removeAttribute('style');
}

/**
 * Materializes the selected visual audience on Builder-only HTML. The authored
 * document remains untouched; runtime publication uses the same normalized
 * layers after WordPress resolves the real member claims.
 */
export function applyMembershipAudienceOverridesToHtml(
  source: string,
  settingsValue: MembershipSettings | unknown,
  viewer: MembershipViewerContext,
  pagePathValue = '',
) {
  if (viewer.previewLayer === 'base' || typeof DOMParser === 'undefined') return source;
  const settings = normalizeMembershipSettings(settingsValue);
  if (!settings.enabled) return source;
  const pagePath = normalizeMembershipPagePath(pagePathValue);
  const page = pagePath ? settings.audienceOverrides?.[pagePath] : undefined;
  if (!page || !source.includes(MEMBERSHIP_AUDIENCE_ELEMENT_ATTRIBUTE)) return source;
  const document = new DOMParser().parseFromString(source, 'text/html');
  membershipAudienceLayersForViewer(viewer).forEach(layer => {
    Object.entries(page[layer] || {}).forEach(([elementId, override]) => {
      const escaped = globalThis.CSS?.escape
        ? globalThis.CSS.escape(elementId)
        : elementId.replace(/[^A-Za-z0-9_-]/g, '');
      document.querySelectorAll<HTMLElement>(
        `[${MEMBERSHIP_AUDIENCE_ELEMENT_ATTRIBUTE}="${escaped}"]`,
      ).forEach(element => applyMembershipAudienceElementOverride(element, override));
    });
  });
  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>` : '';
  return `${doctype}${doctype ? '\n' : ''}${document.documentElement.outerHTML}`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
}

/**
 * Creates a gate whose three branches remain ordinary, editable HTML layers.
 * The public publisher must still split the protected content into private
 * storage; this helper is an authoring contract, not a security boundary.
 */
export function createMembershipGateMarkup(
  gate: Pick<MembershipGateDefinition, 'id' | 'label'>,
  branches: Partial<Record<MembershipBranch, string>> = {},
) {
  const id = escapeHtmlAttribute(gate.id);
  const label = escapeHtmlAttribute(gate.label);
  const gateStyle = 'box-sizing:border-box;width:100%;max-width:640px;padding:32px;border:1px solid #e5e5e5;border-radius:20px;background:#ffffff;color:#171717;box-shadow:0 10px 30px rgba(0,0,0,.06);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
  const branchStyle = 'box-sizing:border-box;width:100%;padding:24px;border:1px solid #eeeeee;border-radius:16px;background:#f7f7f7;color:#333333;font-size:16px;line-height:1.6;';
  return `<section ${MEMBERSHIP_GATE_ATTRIBUTE}="${id}" data-label="${label}" style="${gateStyle}">`
    + `<div ${MEMBERSHIP_BRANCH_ATTRIBUTE}="content" style="${branchStyle}">${branches.content ?? '<p style="margin:0;">Conteúdo exclusivo para membros.</p>'}</div>`
    + `<div ${MEMBERSHIP_BRANCH_ATTRIBUTE}="guest" style="${branchStyle}">${branches.guest ?? '<p style="margin:0;">Entre para acessar este conteúdo.</p>'}</div>`
    + `<div ${MEMBERSHIP_BRANCH_ATTRIBUTE}="upgrade" style="${branchStyle}">${branches.upgrade ?? '<p style="margin:0;">Faça upgrade para acessar este conteúdo.</p>'}</div>`
    + '</section>';
}

const MEMBERSHIP_FORM_STYLE =
  'display:grid;box-sizing:border-box;width:100%;max-width:520px;padding:32px;gap:20px;border:1px solid #e5e5e5;border-radius:20px;background:#ffffff;color:#171717;box-shadow:0 10px 30px rgba(0,0,0,.06);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
const MEMBERSHIP_LABEL_STYLE =
  'display:flex;min-width:0;flex-direction:column;gap:8px;color:#737373;font-size:14px;font-weight:500;line-height:1.35;';
const MEMBERSHIP_CONTROL_STYLE =
  'appearance:none;-webkit-appearance:none;box-sizing:border-box;display:block;width:100%;min-height:52px;margin:0;padding:13px 16px;border:1px solid #dedede;border-radius:14px;outline:none;background:#f5f5f5;color:#171717;box-shadow:0 1px 2px rgba(0,0,0,.03);font:inherit;font-size:16px;line-height:1.4;';
const MEMBERSHIP_BUTTON_STYLE =
  'appearance:none;-webkit-appearance:none;box-sizing:border-box;display:inline-flex;width:100%;min-height:52px;margin:0;padding:13px 22px;align-items:center;justify-content:center;gap:8px;border:1px solid #262626;border-radius:14px;background:#2b2b2b;color:#ffffff;box-shadow:0 1px 2px rgba(0,0,0,.12);font:inherit;font-size:15px;font-weight:600;line-height:1.3;text-align:center;cursor:pointer;';
const MEMBERSHIP_STATUS_STYLE =
  'min-height:20px;margin:0;color:#737373;font-size:13px;line-height:1.45;';

const MEMBERSHIP_FORM_MARKUP: Record<MembershipFormPurpose, string> = {
  login:
    `<form data-label="Login de membros" data-kodety-member-form="login" method="post" style="${MEMBERSHIP_FORM_STYLE}">`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">E-mail<input name="email" type="email" autocomplete="email" placeholder="voce@empresa.com" required style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">Senha<input name="password" type="password" autocomplete="current-password" placeholder="Sua senha" required style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<button type="submit" style="${MEMBERSHIP_BUTTON_STYLE}">Entrar</button>`
    + `<p data-kodety-member-form-status aria-live="polite" style="${MEMBERSHIP_STATUS_STYLE}"></p>`
    + '</form>',
  register:
    `<form data-label="Cadastro de membros" data-kodety-member-form="register" method="post" style="${MEMBERSHIP_FORM_STYLE}">`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">Nome<input name="displayName" type="text" autocomplete="name" placeholder="Seu nome" required style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">E-mail<input name="email" type="email" autocomplete="email" placeholder="voce@empresa.com" required style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">Senha<input name="password" type="password" autocomplete="new-password" minlength="12" placeholder="No mínimo 12 caracteres" required style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<button type="submit" style="${MEMBERSHIP_BUTTON_STYLE}">Criar conta</button>`
    + `<p data-kodety-member-form-status aria-live="polite" style="${MEMBERSHIP_STATUS_STYLE}"></p>`
    + '</form>',
  'forgot-password':
    `<form data-label="Recuperar senha" data-kodety-member-form="forgot-password" method="post" style="${MEMBERSHIP_FORM_STYLE}">`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">E-mail<input name="email" type="email" autocomplete="email" placeholder="voce@empresa.com" required style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<button type="submit" style="${MEMBERSHIP_BUTTON_STYLE}">Enviar link de recuperação</button>`
    + `<p data-kodety-member-form-status aria-live="polite" style="${MEMBERSHIP_STATUS_STYLE}"></p>`
    + '</form>',
  'reset-password':
    `<form data-label="Redefinir senha" data-kodety-member-form="reset-password" method="post" style="${MEMBERSHIP_FORM_STYLE}">`
    + '<input name="key" type="hidden" style="display:none;">'
    + '<input name="login" type="hidden" style="display:none;">'
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">Nova senha<input name="password" type="password" autocomplete="new-password" minlength="12" placeholder="No mínimo 12 caracteres" required style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<button type="submit" style="${MEMBERSHIP_BUTTON_STYLE}">Salvar nova senha</button>`
    + `<p data-kodety-member-form-status aria-live="polite" style="${MEMBERSHIP_STATUS_STYLE}"></p>`
    + '</form>',
  profile:
    `<form data-label="Perfil do membro" data-kodety-member-form="profile" method="post" style="${MEMBERSHIP_FORM_STYLE}">`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">Nome<input name="displayName" type="text" autocomplete="name" placeholder="Nome de exibição" style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">Primeiro nome<input name="firstName" type="text" autocomplete="given-name" placeholder="Primeiro nome" style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<label style="${MEMBERSHIP_LABEL_STYLE}">Sobrenome<input name="lastName" type="text" autocomplete="family-name" placeholder="Sobrenome" style="${MEMBERSHIP_CONTROL_STYLE}"></label>`
    + `<button type="submit" style="${MEMBERSHIP_BUTTON_STYLE}">Salvar perfil</button>`
    + `<p data-kodety-member-form-status aria-live="polite" style="${MEMBERSHIP_STATUS_STYLE}"></p>`
    + '</form>',
  logout:
    `<form data-label="Sair da conta" data-kodety-member-form="logout" method="post" style="${MEMBERSHIP_FORM_STYLE}">`
    + `<button type="submit" style="${MEMBERSHIP_BUTTON_STYLE}">Sair</button>`
    + `<p data-kodety-member-form-status aria-live="polite" style="${MEMBERSHIP_STATUS_STYLE}"></p>`
    + '</form>',
};

/**
 * Member forms deliberately carry no REST URL, nonce or secret. The published
 * WordPress runtime binds them to same-origin endpoints and a short-lived CSRF
 * challenge. The generic Forms runtime recognizes the marker and leaves the
 * submission to membership.
 */
export function createMembershipFormMarkup(purpose: MembershipFormPurpose) {
  return MEMBERSHIP_FORM_MARKUP[purpose];
}

/**
 * Applies a Builder-only persona to ordinary editable gate branches. The
 * authoring source is returned untouched when membership is absent/disabled.
 */
export function applyMembershipPreviewToHtml(
  source: string,
  settingsValue: MembershipSettings | unknown,
  viewer: MembershipViewerContext,
  pagePath = '',
) {
  const settings = normalizeMembershipSettings(settingsValue);
  const normalizedPagePath = normalizeMembershipPagePath(pagePath);
  const pageRule = normalizedPagePath ? settings.pages[normalizedPagePath] : undefined;
  if (pageRule && membershipRuleIsProtected(pageRule)) {
    const evaluation = evaluateMembershipPage(
      settingsValue,
      normalizedPagePath,
      viewer,
    );
    if (!evaluation.allowed) {
      const fallback = evaluation.fallback;
      const message = evaluation.state === 'misconfigured'
        ? 'Esta página está bloqueada porque a regra de acesso precisa ser corrigida.'
        : fallback?.type === 'redirect'
          ? `Esta visualização redireciona para ${fallback.url || 'uma URL ainda não configurada'}.`
          : fallback?.type === 'branch' && fallback.branch === 'upgrade'
            ? 'Faça upgrade para acessar esta página.'
            : fallback?.type === 'branch'
              ? 'Entre para acessar esta página.'
              : 'Esta página não exibe conteúdo para esta pessoa.';
      const escaped = message
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
      return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visualização de acesso</title></head><body><main data-kodety-membership-page-preview="${evaluation.state}" style="box-sizing:border-box;display:grid;min-height:100vh;place-items:center;padding:32px;font-family:system-ui,sans-serif"><p style="max-width:560px;text-align:center">${escaped}</p></main></body></html>`;
    }
  }
  if (
    !settings.enabled
    || !source.includes(MEMBERSHIP_GATE_ATTRIBUTE)
    || typeof DOMParser === 'undefined'
  ) return source;
  const document = new DOMParser().parseFromString(source, 'text/html');
  const gates = Array.from(document.querySelectorAll<HTMLElement>(
    `[${MEMBERSHIP_GATE_ATTRIBUTE}]`,
  ));
  if (!gates.length) return source;
  gates.forEach(element => {
    const gateId = element.getAttribute(MEMBERSHIP_GATE_ATTRIBUTE) || '';
    const evaluation = evaluateMembershipGate(settingsValue, gateId, viewer);
    const visibleBranch: MembershipBranch | null = evaluation.allowed
      ? 'content'
      : evaluation.fallback?.type === 'branch'
        ? evaluation.fallback.branch
        : null;
    Array.from(element.children).forEach(child => {
      const branch = child.getAttribute(MEMBERSHIP_BRANCH_ATTRIBUTE) as MembershipBranch | null;
      if (!branch) return;
      if (branch === visibleBranch) {
        child.removeAttribute('data-kodety-membership-preview-hidden');
        return;
      }
      child.setAttribute('hidden', '');
      child.setAttribute('data-kodety-membership-preview-hidden', 'true');
      if (child instanceof HTMLElement) {
        child.style.setProperty('display', 'none');
      }
    });
    element.setAttribute(
      'data-kodety-membership-preview-state',
      evaluation.state,
    );
  });
  const doctype = document.doctype
    ? `<!doctype ${document.doctype.name}>`
    : '';
  return `${doctype}${doctype ? '\n' : ''}${document.documentElement.outerHTML}`;
}

function entitlementActive(entitlement: MembershipEntitlement, now: number) {
  if (!ACCESSIBLE_ENTITLEMENT_STATUSES.has(entitlement.status)) return false;
  const startsAt = entitlement.startsAt ? Date.parse(entitlement.startsAt) : Number.NaN;
  const endsAt = entitlement.endsAt ? Date.parse(entitlement.endsAt) : Number.NaN;
  if (Number.isFinite(startsAt) && startsAt > now) return false;
  if (Number.isFinite(endsAt) && endsAt <= now) return false;
  return true;
}

export function membershipActivePlanKeys(
  viewer: MembershipViewerContext,
  now: number | Date = Date.now(),
) {
  if (!viewer.authenticated) return [];
  const timestamp = now instanceof Date ? now.getTime() : now;
  const previewKeys = (viewer.planKeys || []).map(normalizeMembershipPlanKey).filter(Boolean);
  const entitlementKeys = (viewer.entitlements || [])
    .filter(entitlement => entitlementActive(entitlement, timestamp))
    .map(entitlement => normalizeMembershipPlanKey(entitlement.planKey))
    .filter(Boolean);
  return unique([...previewKeys, ...entitlementKeys]);
}

function deniedEvaluation(
  reason: MembershipEvaluationReason,
  state: MembershipEvaluationState,
  fallback: MembershipFallback | null,
  activePlanKeys: string[] = [],
  requiredPlanKeys: string[] = [],
  matchedPlanKeys: string[] = [],
): MembershipEvaluation {
  return {
    allowed: false,
    state,
    reason,
    fallback,
    activePlanKeys,
    matchedPlanKeys,
    missingPlanKeys: requiredPlanKeys.filter(key => !activePlanKeys.includes(key)),
  };
}

export function evaluateMembershipRule(
  ruleValue: MembershipAccessRule | unknown,
  viewer: MembershipViewerContext,
  options: { enabled?: boolean; now?: number | Date } = {},
): MembershipEvaluation {
  const rule = normalizeMembershipAccessRule(ruleValue);
  const activePlanKeys = membershipActivePlanKeys(viewer, options.now);

  if (rule.requirement.type === 'public') {
    return {
      allowed: true,
      state: 'public',
      reason: 'public',
      fallback: null,
      activePlanKeys,
      matchedPlanKeys: [],
      missingPlanKeys: [],
    };
  }
  if (options.enabled === false) {
    return deniedEvaluation(
      'membership-disabled',
      'misconfigured',
      { type: 'hide' },
      activePlanKeys,
    );
  }
  if (rule.requirement.type === 'invalid') {
    return deniedEvaluation(
      'invalid-rule',
      'misconfigured',
      { type: 'hide' },
      activePlanKeys,
    );
  }
  if (!viewer.authenticated) {
    return deniedEvaluation(
      'not-authenticated',
      'guest',
      rule.anonymous,
      activePlanKeys,
      rule.requirement.type === 'plans' ? rule.requirement.planKeys : [],
    );
  }
  if (rule.requirement.type === 'authenticated') {
    return {
      allowed: true,
      state: 'allowed',
      reason: 'authenticated',
      fallback: null,
      activePlanKeys,
      matchedPlanKeys: [],
      missingPlanKeys: [],
    };
  }

  const required = rule.requirement.planKeys;
  if (!required.length) {
    return deniedEvaluation(
      'invalid-rule',
      'misconfigured',
      { type: 'hide' },
      activePlanKeys,
    );
  }
  const matched = required.filter(key => activePlanKeys.includes(key));
  const allowed = rule.requirement.match === 'all'
    ? matched.length === required.length
    : matched.length > 0;
  if (allowed) {
    return {
      allowed: true,
      state: 'allowed',
      reason: 'plan-match',
      fallback: null,
      activePlanKeys,
      matchedPlanKeys: matched,
      missingPlanKeys: required.filter(key => !activePlanKeys.includes(key)),
    };
  }
  return deniedEvaluation(
    'plan-missing',
    'denied',
    rule.denied,
    activePlanKeys,
    required,
    matched,
  );
}

export function evaluateMembershipGate(
  settingsValue: MembershipSettings | unknown,
  gateId: string,
  viewer: MembershipViewerContext,
  options: { now?: number | Date } = {},
) {
  if (!membershipSchemaVersionSupported(settingsValue)) {
    return deniedEvaluation('invalid-rule', 'misconfigured', { type: 'hide' });
  }
  const settings = normalizeMembershipSettings(settingsValue);
  const gate = settings.gates[gateId];
  if (!gate) {
    return deniedEvaluation('gate-not-found', 'misconfigured', { type: 'hide' });
  }
  return evaluateMembershipRule(gate, viewer, {
    enabled: settings.enabled,
    now: options.now,
  });
}

/**
 * Pages without a rule stay public for backwards compatibility. A page that
 * explicitly owns a protected rule while membership is disabled fails closed.
 */
export function evaluateMembershipPage(
  settingsValue: MembershipSettings | unknown,
  pagePath: string,
  viewer: MembershipViewerContext,
  options: { now?: number | Date } = {},
) {
  if (!membershipSchemaVersionSupported(settingsValue)) {
    return deniedEvaluation('invalid-rule', 'misconfigured', { type: 'hide' });
  }
  const settings = normalizeMembershipSettings(settingsValue);
  const rule = settings.pages[normalizeMembershipPagePath(pagePath)];
  if (!rule) {
    return evaluateMembershipRule(
      createMembershipAccessRule({ type: 'public' }),
      viewer,
      { enabled: true, now: options.now },
    );
  }
  return evaluateMembershipRule(rule, viewer, {
    enabled: settings.enabled,
    now: options.now,
  });
}

export function membershipRuleIsProtected(ruleValue: MembershipAccessRule | unknown) {
  return normalizeMembershipAccessRule(ruleValue).requirement.type !== 'public';
}

export function membershipRuleSummary(
  ruleValue: MembershipAccessRule | unknown,
  plans: readonly MembershipPlanOption[] = [],
) {
  const rule = normalizeMembershipAccessRule(ruleValue);
  if (rule.requirement.type === 'public') return 'Público';
  if (rule.requirement.type === 'authenticated') return 'Qualquer membro logado';
  if (rule.requirement.type === 'invalid') return 'Regra inválida';
  const names = rule.requirement.planKeys.map(key =>
    plans.find(plan => plan.key === key)?.name || key,
  );
  if (!names.length) return 'Nenhum plano selecionado';
  return `${rule.requirement.match === 'all' ? 'Todos' : 'Qualquer'}: ${names.join(', ')}`;
}

function validateFallback(
  fallback: MembershipFallback,
  issueTarget: Pick<MembershipValidationIssue, 'gateId' | 'pagePath'>,
) {
  if (fallback.type !== 'redirect' || normalizeMembershipRedirectUrl(fallback.url)) return [];
  return [{
    ...issueTarget,
    code: 'redirect-invalid',
    severity: 'error',
    message: 'O redirect da regra de acesso é inválido.',
  } satisfies MembershipValidationIssue];
}

function validateRule(
  rule: MembershipAccessRule,
  issueTarget: Pick<MembershipValidationIssue, 'gateId' | 'pagePath'>,
  knownPlanKeys: Set<string> | null,
) {
  const issues: MembershipValidationIssue[] = [];
  if (rule.requirement.type === 'invalid') {
    issues.push({
      ...issueTarget,
      code: 'requirement-invalid',
      severity: 'error',
      message: rule.requirement.reason,
    });
  }
  if (rule.requirement.type === 'plans') {
    if (!rule.requirement.planKeys.length) {
      issues.push({
        ...issueTarget,
        code: 'plans-required',
        severity: 'error',
        message: 'Selecione pelo menos um plano para esta regra.',
      });
    }
    if (rule.requirement.planKeys.length > MAX_MEMBERSHIP_PLAN_KEYS) {
      issues.push({
        ...issueTarget,
        code: 'too-many-plan-keys',
        severity: 'error',
        message: `Uma regra aceita no máximo ${MAX_MEMBERSHIP_PLAN_KEYS} planos.`,
      });
    }
    rule.requirement.planKeys.forEach(key => {
      if (!isMembershipPlanKey(key)) {
        issues.push({
          ...issueTarget,
          code: 'plan-key-invalid',
          severity: 'error',
          message: `A chave de plano “${key}” é inválida.`,
        });
      } else if (knownPlanKeys && !knownPlanKeys.has(key)) {
        issues.push({
          ...issueTarget,
          code: 'plan-not-found',
          severity: 'error',
          message: `O plano “${key}” não existe ou foi arquivado.`,
        });
      }
    });
  }
  issues.push(...validateFallback(rule.anonymous, issueTarget));
  issues.push(...validateFallback(rule.denied, issueTarget));
  return issues;
}

/**
 * Normalization is intentionally forgiving while somebody edits a rule, but
 * publication must never obtain a broader rule by silently dropping malformed
 * or excess plan keys. Inspect the un-normalized requirement before validating
 * the normalized representation.
 */
function validateRawRule(
  value: unknown,
  issueTarget: Pick<MembershipValidationIssue, 'gateId' | 'pagePath'>,
) {
  const source = record(value);
  const requirement = record(source.requirement ?? source.access ?? source.condition);
  const type = stringValue(
    typeof (source.requirement ?? source.access ?? source.condition) === 'string'
      ? source.requirement ?? source.access ?? source.condition
      : requirement.type ?? requirement.kind ?? requirement.access,
  );
  if (type !== 'plans' && type !== 'plan') return [] as MembershipValidationIssue[];
  const rawPlanKeys = requirement.planKeys ?? requirement.plans ?? requirement.requiredPlans;
  const planKeys = Array.isArray(rawPlanKeys)
    ? rawPlanKeys
    : typeof rawPlanKeys === 'string'
      ? rawPlanKeys.split(',')
      : [];
  const issues: MembershipValidationIssue[] = [];
  if (planKeys.length > MAX_MEMBERSHIP_PLAN_KEYS) {
    issues.push({
      ...issueTarget,
      code: 'too-many-plan-keys',
      severity: 'error',
      message: `Uma regra aceita no máximo ${MAX_MEMBERSHIP_PLAN_KEYS} planos.`,
    });
  }
  planKeys.forEach(rawKey => {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!isMembershipPlanKey(key)) {
      issues.push({
        ...issueTarget,
        code: 'plan-key-invalid',
        severity: 'error',
        message: `A chave de plano “${key || String(rawKey)}” é inválida.`,
      });
    }
  });
  return issues;
}

export function validateMembershipSettings(
  value: unknown,
  options: { knownPlanKeys?: Iterable<string> } = {},
) {
  const raw = record(value);
  const settings = normalizeMembershipSettings(value);
  const issues: MembershipValidationIssue[] = [];
  const knownPlanKeys = options.knownPlanKeys
    ? new Set(Array.from(options.knownPlanKeys, normalizeMembershipPlanKey).filter(Boolean))
    : null;
  if (
    raw.version !== undefined
    && Number(raw.version) !== MEMBERSHIP_SCHEMA_VERSION
  ) {
    issues.push({
      code: 'schema-version',
      severity: 'error',
      message: `A versão de membership não é suportada. Esperado: ${MEMBERSHIP_SCHEMA_VERSION}.`,
    });
  }
  if (Object.keys(record(raw.gates)).length > MAX_MEMBERSHIP_GATES) {
    issues.push({
      code: 'too-many-gates',
      severity: 'error',
      message: `O projeto aceita no máximo ${MAX_MEMBERSHIP_GATES} gates.`,
    });
  }
  if (Object.keys(record(raw.pages ?? raw.pageRules)).length > MAX_MEMBERSHIP_PAGE_RULES) {
    issues.push({
      code: 'too-many-page-rules',
      severity: 'error',
      message: `O projeto aceita no máximo ${MAX_MEMBERSHIP_PAGE_RULES} regras de página.`,
    });
  }
  Object.entries(record(raw.gates)).forEach(([rawId, rawGate]) => {
    const gate = record(rawGate);
    const declaredId = stringValue(gate.id ?? rawId);
    if (!GATE_ID_PATTERN.test(declaredId)) {
      issues.push({
        code: 'gate-id-invalid',
        severity: 'error',
        gateId: declaredId || rawId,
        message: `O identificador do gate “${declaredId || rawId}” é inválido.`,
      });
    }
    if (!stringValue(gate.label ?? gate.name)) {
      issues.push({
        code: 'gate-label-required',
        severity: 'error',
        gateId: declaredId || rawId,
        message: 'Todo gate precisa de um nome.',
      });
    }
    issues.push(...validateRawRule(gate, { gateId: declaredId || rawId }));
  });
  Object.entries(record(raw.pages ?? raw.pageRules)).forEach(([rawPath, rawRule]) => {
    const path = normalizeMembershipPagePath(rawPath);
    if (
      path !== rawPath
      || !path
      || path.length > 512
      || path.startsWith('.incode/')
      || !/\.html?$/i.test(path)
    ) {
      issues.push({
        code: 'page-path-invalid',
        severity: 'error',
        pagePath: rawPath,
        message: `O caminho de página “${rawPath}” é inválido.`,
      });
    }
    issues.push(...validateRawRule(rawRule, { pagePath: rawPath }));
  });
  Object.values(settings.gates).forEach(gate => {
    if (!GATE_ID_PATTERN.test(gate.id)) {
      issues.push({
        code: 'gate-id-invalid',
        severity: 'error',
        gateId: gate.id,
        message: `O identificador do gate “${gate.id}” é inválido.`,
      });
    }
    if (!gate.label.trim()) {
      issues.push({
        code: 'gate-label-required',
        severity: 'error',
        gateId: gate.id,
        message: 'Todo gate precisa de um nome.',
      });
    }
    issues.push(...validateRule(gate, { gateId: gate.id }, knownPlanKeys));
  });
  Object.entries(settings.pages).forEach(([pagePath, rule]) => {
    if (
      !pagePath
      || pagePath.length > 512
      || pagePath.startsWith('.incode/')
      || !/\.html?$/i.test(pagePath)
    ) {
      issues.push({
        code: 'page-path-invalid',
        severity: 'error',
        pagePath,
        message: `O caminho de página “${pagePath}” é inválido.`,
      });
    }
    issues.push(...validateRule(rule, { pagePath }, knownPlanKeys));
  });
  return issues;
}

export function membershipPreviewPersonas(
  plans: readonly MembershipPlanOption[],
): MembershipPreviewPersona[] {
  const activePlans = plans.filter(plan => plan.status !== 'archived');
  return [
    {
      id: 'guest',
      label: 'Visitante',
      description: 'Não está logado.',
      viewer: { authenticated: false },
    },
    {
      id: 'member',
      label: 'Membro sem plano',
      description: 'Está logado, mas não possui entitlement.',
      viewer: { authenticated: true },
    },
    ...activePlans.map(plan => ({
      id: `plan:${plan.key}`,
      label: plan.name,
      description: `Membro com o plano ${plan.name}.`,
      viewer: { authenticated: true, planKeys: [plan.key] },
    })),
  ];
}
