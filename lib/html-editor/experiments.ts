import type { HtmlProject, HtmlProjectFile } from './types';
import {
  getProjectHomePath,
  readEditorMetadata,
  updateEditorMetadata,
} from './project-io';
import {
  interactionDocumentPath,
  interactionDocumentPathCandidates,
} from './interactions';

export const EXPERIMENTS_SCHEMA_VERSION = 3 as const;
export const EXPERIMENT_INTERNAL_ROOT = '.incode/experiments/' as const;
export const EXPERIMENT_CONTROL_VARIANT_ID = 'control' as const;
export const EXPERIMENT_WEIGHT_PRECISION = 4;

function storedInteractionDocumentPath(
  files: Record<string, HtmlProjectFile>,
  htmlPath: string,
) {
  return interactionDocumentPathCandidates(htmlPath)
    .find(path => Boolean(files[path]));
}

export type HtmlExperimentStatus = 'draft' | 'active' | 'paused' | 'archived';
export type HtmlExperimentVariantStatus = 'active' | 'paused' | 'archived';
export type HtmlExperimentVariantKind = 'control' | 'variant';
export type HtmlExperimentClickTargetType = 'id' | 'class';
export type HtmlExperimentAllocationMode = 'manual' | 'equal' | 'adaptive';
export type HtmlExperimentDeliveryMode = 'redirect' | 'server';
export type HtmlExperimentAudienceDevice = 'all' | 'mobile' | 'desktop';
export type HtmlExperimentAudienceVisitor = 'all' | 'new' | 'returning';

export interface HtmlExperimentAudience {
  device: HtmlExperimentAudienceDevice;
  visitor: HtmlExperimentAudienceVisitor;
  queryParameter?: string;
  queryValue?: string;
  referrerHost?: string;
}

export interface HtmlExperimentAutoStop {
  endAt?: string;
  maxExposures?: number;
}

export interface HtmlExperimentOptions {
  /** Percentage of eligible visitors who enter this experiment. */
  trafficPercent: number;
  /** How traffic is divided between enabled variants. */
  allocationMode: HtmlExperimentAllocationMode;
  /** Redirects to the variant URL or swaps its document without changing URL. */
  deliveryMode: HtmlExperimentDeliveryMode;
  /** Assignment-cookie lifetime. */
  stickyDays: number;
  audience: HtmlExperimentAudience;
  autoStop: HtmlExperimentAutoStop;
}

export type HtmlExperimentGoal =
  | { type: 'pageview'; pagePath: string }
  | {
      type: 'click';
      /**
       * Canonical analytics event key. Legacy data-kodety-tracking-id goals keep
       * their raw value; DOM selectors use `id:<value>` or `class:<value>`.
       */
      trackingId: string;
      targetType?: HtmlExperimentClickTargetType;
      targetValue?: string;
    }
  | { type: 'custom'; eventName: string };

export interface HtmlExperimentVariant {
  id: string;
  name: string;
  /**
   * Human-facing slug for the variant. Defaults to the physical `id` but may be
   * edited to a friendly value with optional nested segments (e.g.
   * `case/hero-b`). Used for display and the variant preview URL; the physical
   * `id` remains the stable key for storage, assignment and analytics.
   */
  slug?: string;
  kind: HtmlExperimentVariantKind;
  status: HtmlExperimentVariantStatus;
  /** Effective percentage of eligible visitors, always normalized to 0..100. */
  weight: number;
  /** Public path for Control; private namespaced path for authored variants. */
  pagePath: string;
  /** Public page from which this variant was derived. */
  sourcePagePath: string;
  /** Fingerprints of public files when the variant was created. */
  sourceFileDigests?: Record<string, string>;
  /**
   * Binary project files inherited from Control through copy-on-write. They
   * are deliberately absent from the private variant tree so creating a test
   * never duplicates large images, video, audio, fonts or archives in memory
   * and in every autosave ZIP. A private file at the same public path is an
   * explicit override and always wins.
   */
  inheritedFilePaths?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface HtmlExperiment extends HtmlExperimentOptions {
  id: string;
  name: string;
  pagePath: string;
  status: HtmlExperimentStatus;
  goal: HtmlExperimentGoal;
  variants: HtmlExperimentVariant[];
  winnerVariantId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HtmlExperimentSettings {
  version: typeof EXPERIMENTS_SCHEMA_VERSION;
  experiments: HtmlExperiment[];
}

export interface HtmlExperimentPageGroup {
  experimentId: string;
  name: string;
  pagePath: string;
  status: HtmlExperimentStatus;
  winnerVariantId?: string;
  variants: HtmlExperimentVariant[];
}

export interface HtmlExperimentSelection {
  experimentId: string;
  variantId: string;
}

export interface HtmlExperimentEditSession extends HtmlExperimentSelection {
  baseMainHtmlPath: string;
  baseRootPath: string;
  variantPrefix: string;
  variantPagePath: string;
}

export interface HtmlExperimentValidationIssue {
  experimentId?: string;
  variantId?: string;
  code:
    | 'experiment-name-required'
    | 'page-not-found'
    | 'control-required'
    | 'multiple-controls'
    | 'variant-page-not-found'
    | 'active-variant-required'
    | 'invalid-weight-total'
    | 'goal-required'
    | 'winner-not-found';
  message: string;
}

export interface HtmlExperimentPromotionConflict {
  path: string;
  reason: 'control-changed' | 'control-file-added';
}

export interface HtmlExperimentPromotionResult {
  project: HtmlProject;
  conflicts: HtmlExperimentPromotionConflict[];
  promotedPaths: string[];
  removedPaths: string[];
}

export interface HtmlExperimentRuntimeAssignment {
  clientKey: string;
  documentKey: string;
  pageId: string;
  path: string;
  weight: number;
  enabled: boolean;
}

export const DEFAULT_EXPERIMENT_SETTINGS: HtmlExperimentSettings = {
  version: EXPERIMENTS_SCHEMA_VERSION,
  experiments: [],
};

const INTERNAL_METADATA_PATH = '.incode/project.json';
const EXPERIMENT_STATUSES = new Set<HtmlExperimentStatus>([
  'draft',
  'active',
  'paused',
  'archived',
]);
const VARIANT_STATUSES = new Set<HtmlExperimentVariantStatus>([
  'active',
  'paused',
  'archived',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nowIso(value?: string | number | Date) {
  if (value !== undefined) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function normalizeTimestamp(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizePath(value: unknown) {
  if (typeof value !== 'string') return '';
  const stack: string[] = [];
  value
    .trim()
    .split(/[?#]/, 1)[0]
    .replaceAll('\\', '/')
    .split('/')
    .forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') stack.pop();
      else stack.push(part);
    });
  return stack.join('/');
}

function normalizeName(value: unknown, fallback: string) {
  const name = typeof value === 'string' ? value.trim() : '';
  return (name || fallback).slice(0, 160);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Math.max(min, Math.min(max, Number.isFinite(numeric) ? numeric : fallback));
}

function normalizeOptionalText(value: unknown, maxLength = 191) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : undefined;
}

function normalizeExperimentOptions(
  value: Record<string, unknown>,
  fallback: Partial<HtmlExperimentOptions> = {},
): HtmlExperimentOptions {
  const audience = record(value.audience);
  const fallbackAudience = fallback.audience ?? {
    device: 'all',
    visitor: 'all',
  };
  const autoStop = record(value.autoStop);
  const fallbackAutoStop = fallback.autoStop ?? {};
  const allocationMode = value.allocationMode;
  const deliveryMode = value.deliveryMode;
  const device = audience.device;
  const visitor = audience.visitor;
  const endAtValue = autoStop.endAt ?? fallbackAutoStop.endAt;
  const endAtDate = typeof endAtValue === 'string' && endAtValue.trim()
    ? new Date(endAtValue)
    : null;
  const maxExposuresValue = autoStop.maxExposures ?? fallbackAutoStop.maxExposures;
  const maxExposures = maxExposuresValue === undefined || maxExposuresValue === null || maxExposuresValue === ''
    ? undefined
    : Math.round(boundedNumber(maxExposuresValue, 0, 1, 10_000_000));
  return {
    trafficPercent: Math.round(boundedNumber(
      value.trafficPercent,
      fallback.trafficPercent ?? 100,
      1,
      100,
    ) * 100) / 100,
    allocationMode:
      allocationMode === 'equal' || allocationMode === 'adaptive' || allocationMode === 'manual'
        ? allocationMode
        : fallback.allocationMode ?? 'manual',
    deliveryMode:
      deliveryMode === 'server' || deliveryMode === 'redirect'
        ? deliveryMode
        : fallback.deliveryMode ?? 'redirect',
    stickyDays: Math.round(boundedNumber(
      value.stickyDays,
      fallback.stickyDays ?? 180,
      1,
      365,
    )),
    audience: {
      device:
        device === 'mobile' || device === 'desktop' || device === 'all'
          ? device
          : fallbackAudience.device,
      visitor:
        visitor === 'new' || visitor === 'returning' || visitor === 'all'
          ? visitor
          : fallbackAudience.visitor,
      queryParameter: normalizeOptionalText(
        audience.queryParameter ?? fallbackAudience.queryParameter,
        80,
      ),
      queryValue: normalizeOptionalText(
        audience.queryValue ?? fallbackAudience.queryValue,
        160,
      ),
      referrerHost: normalizeOptionalText(
        audience.referrerHost ?? fallbackAudience.referrerHost,
        191,
      )?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    },
    autoStop: {
      endAt: endAtDate && Number.isFinite(endAtDate.getTime())
        ? endAtDate.toISOString()
        : undefined,
      maxExposures,
    },
  };
}

function safeId(value: unknown, fallback: string) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return (candidate || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || fallback;
}

function uniqueId(base: string, used: Set<string>) {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

/**
 * Normalize a user-supplied variant slug. Each `/`-separated segment is made
 * URL-safe and lowercased so a variant can live at a friendly, optionally
 * nested path (e.g. `case/hero-b`). Empty segments are dropped; the result
 * never has leading/trailing slashes. Falls back when nothing usable remains.
 */
export function safeVariantSlug(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const slug = raw
    .split('/')
    .map(segment =>
      segment
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('/')
    .slice(0, 120)
    .replace(/^\/+|\/+$/g, '');
  return slug || safeVariantSlug(fallback, '') || 'variant';
}

/** Unique public slug; collisions append `-2`, `-3`, … */
function uniqueSlug(base: string, used: Set<string>) {
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  used.add(slug);
  return slug;
}

function publicVariantSlugs(
  settings: HtmlExperimentSettings,
  exclude?: HtmlExperimentSelection,
) {
  return new Set(settings.experiments.flatMap(experiment =>
    experiment.variants
      .filter(variant =>
        variant.kind === 'variant'
        && (
          !exclude
          || experiment.id !== exclude.experimentId
          || variant.id !== exclude.variantId
        ),
      )
      .map(variantSlug),
  ));
}

/** The effective slug for a variant: its explicit slug or its physical id. */
export function variantSlug(variant: Pick<HtmlExperimentVariant, 'id' | 'slug'>): string {
  return variant.slug && variant.slug.trim() ? variant.slug : variant.id;
}

function createId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  return safeId(`${prefix}-${uuid}`, prefix);
}

function finiteWeight(value: unknown) {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
}

function roundWeight(value: number) {
  const multiplier = 10 ** EXPERIMENT_WEIGHT_PRECISION;
  return Math.round(value * multiplier) / multiplier;
}

function normalizeExperimentStatus(value: unknown): HtmlExperimentStatus {
  if (EXPERIMENT_STATUSES.has(value as HtmlExperimentStatus)) return value as HtmlExperimentStatus;
  if (value === 'running' || value === 'enabled' || value === true) return 'active';
  if (value === 'stopped' || value === 'disabled') return 'paused';
  return 'draft';
}

function normalizeVariantStatus(
  value: unknown,
  enabled: unknown,
): HtmlExperimentVariantStatus {
  if (VARIANT_STATUSES.has(value as HtmlExperimentVariantStatus)) {
    return value as HtmlExperimentVariantStatus;
  }
  if (enabled === false || enabled === 0 || enabled === 'false') return 'paused';
  return 'active';
}

function normalizeTrackingId(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/[^A-Za-z0-9._:/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

export function experimentClickGoalTrackingId(
  targetType: HtmlExperimentClickTargetType,
  targetValue: unknown,
) {
  const value = normalizeTrackingId(targetValue);
  return value ? `${targetType}:${value}` : '';
}

function normalizeGoal(
  value: unknown,
  experiment: Record<string, unknown>,
  pagePath: string,
): HtmlExperimentGoal {
  const goal = record(value);
  const rawType = goal.type ?? experiment.goalType ?? experiment.conversionType;
  if (rawType === 'click') {
    const declaredTargetType = goal.targetType ?? goal.selectorType ?? experiment.goalTargetType;
    if (declaredTargetType === 'id' || declaredTargetType === 'class') {
      const targetValue = normalizeTrackingId(
        goal.targetValue
        ?? goal.selectorValue
        ?? experiment.goalTargetValue
        ?? goal.trackingId
        ?? experiment.trackingId
        ?? experiment.goalTrackingId,
      );
      return {
        type: 'click',
        trackingId: experimentClickGoalTrackingId(declaredTargetType, targetValue),
        targetType: declaredTargetType,
        targetValue,
      };
    }
    const trackingId = normalizeTrackingId(
      goal.trackingId ?? experiment.trackingId ?? experiment.goalTrackingId,
    );
    const encodedTarget = /^(id|class):(.+)$/i.exec(trackingId);
    if (encodedTarget) {
      const targetType = encodedTarget[1].toLowerCase() as HtmlExperimentClickTargetType;
      const targetValue = normalizeTrackingId(encodedTarget[2]);
      return {
        type: 'click',
        trackingId: experimentClickGoalTrackingId(targetType, targetValue),
        targetType,
        targetValue,
      };
    }
    return {
      type: 'click',
      trackingId,
    };
  }
  if (rawType === 'custom') {
    return {
      type: 'custom',
      eventName: normalizeTrackingId(goal.eventName ?? experiment.eventName),
    };
  }
  return {
    type: 'pageview',
    pagePath: normalizePath(goal.pagePath ?? experiment.goalPagePath) || pagePath,
  };
}

export function isExperimentInternalPath(path: string) {
  return normalizePath(path).startsWith(EXPERIMENT_INTERNAL_ROOT);
}

export function experimentVariantPrefix(experimentId: string, variantId: string) {
  return `${EXPERIMENT_INTERNAL_ROOT}${safeId(experimentId, 'experiment')}/${safeId(variantId, 'variant')}/project/`;
}

export function experimentVariantFilePath(
  experimentId: string,
  variantId: string,
  publicPath: string,
) {
  const path = normalizePath(publicPath);
  if (!path || isExperimentInternalPath(path) || path === INTERNAL_METADATA_PATH) {
    throw new Error('O caminho não pode ser armazenado dentro de uma variante.');
  }
  return `${experimentVariantPrefix(experimentId, variantId)}${path}`;
}

export function publicPagePaths(project: HtmlProject) {
  return Object.values(project.files)
    .filter(file =>
      !isExperimentInternalPath(file.path)
      && !file.path.startsWith('.incode/')
      && file.text !== undefined
      && /\.html?$/i.test(file.path),
    )
    .map(file => file.path)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function publicProjectFilePaths(project: HtmlProject) {
  return Object.keys(project.files)
    .filter(path => !path.startsWith('.incode/'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function cloneFile(file: HtmlProjectFile, path = file.path): HtmlProjectFile {
  return {
    ...file,
    path,
    ...(file.data ? { data: file.data.slice() } : {}),
  };
}

/**
 * Read-only projection used by editor views. The file object is detached so a
 * public-looking path cannot leak back into canonical storage, while binary
 * bytes deliberately retain their identity. Mutation boundaries use
 * `cloneFile` instead.
 */
function readOnlyFileView(file: HtmlProjectFile, path = file.path): HtmlProjectFile {
  return { ...file, path };
}

export function projectFileDigest(file: HtmlProjectFile | undefined) {
  return digestFile(file);
}

interface ProjectFileDigestCacheEntry {
  mimeType: string;
  text: string | undefined;
  data: Uint8Array | undefined;
  digest: string;
}

// Project files and their byte buffers are immutable editor values. Keying the
// digest by the file object prevents the experiment asset tree from hashing a
// large private binary with BigInt again on every route-only project snapshot.
// The field checks also invalidate integrations that replace text/data in place.
const projectFileDigestCache = new WeakMap<
  HtmlProjectFile,
  ProjectFileDigestCacheEntry
>();

function digestFile(file: HtmlProjectFile | undefined) {
  if (!file) return '';
  const cached = projectFileDigestCache.get(file);
  if (
    cached
    && cached.mimeType === file.mimeType
    && cached.text === file.text
    && cached.data === file.data
  ) return cached.digest;
  // FNV-1a 64 is synchronous in every editor/runtime and avoids copying large
  // assets merely to detect whether Control diverged while a test was running.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const feed = (byte: number) => {
    hash ^= BigInt(byte & 0xff);
    hash = BigInt.asUintN(64, hash * prime);
  };
  const header = new TextEncoder().encode(`${file.mimeType}\0${file.text !== undefined ? 't' : 'b'}\0`);
  header.forEach(feed);
  if (file.text !== undefined) new TextEncoder().encode(file.text).forEach(feed);
  else file.data?.forEach(feed);
  const digest = hash.toString(16).padStart(16, '0');
  projectFileDigestCache.set(file, {
    mimeType: file.mimeType,
    text: file.text,
    data: file.data,
    digest,
  });
  return digest;
}

export function projectPublicFileDigests(project: HtmlProject) {
  return Object.fromEntries(
    publicProjectFilePaths(project)
      // Binary inheritance is represented by `inheritedFilePaths`. Hashing a
      // 100 MB asset synchronously with BigInt on the create-test hot path can
      // freeze the editor long enough to lose autosave/lock heartbeats.
      .filter(path => project.files[path]?.text !== undefined)
      .map(path => [path, digestFile(project.files[path])]),
  );
}

function normalizeSourceDigests(value: unknown) {
  const result: Record<string, string> = {};
  Object.entries(record(value)).forEach(([path, digest]) => {
    const normalized = normalizePath(path);
    if (
      normalized
      && !normalized.startsWith('.incode/')
      && typeof digest === 'string'
      && /^[a-f\d]{8,128}$/i.test(digest)
    ) result[normalized] = digest.toLowerCase();
  });
  return result;
}

function normalizeInheritedFilePaths(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap(path => {
    const normalized = normalizePath(path);
    return normalized && !normalized.startsWith('.incode/') ? [normalized] : [];
  }))).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function normalizeVariant(
  value: unknown,
  index: number,
  experimentId: string,
  pagePath: string,
  usedIds: Set<string>,
  usedSlugs: Set<string>,
): HtmlExperimentVariant {
  const variant = record(value);
  const requestedKind = variant.kind ?? variant.type;
  const kind: HtmlExperimentVariantKind =
    requestedKind === 'control' || index === 0 && variant.id === EXPERIMENT_CONTROL_VARIANT_ID
      ? 'control'
      : 'variant';
  const fallbackId = kind === 'control'
    ? EXPERIMENT_CONTROL_VARIANT_ID
    : `variant-${index + 1}`;
  const id = uniqueId(safeId(variant.id ?? variant.documentKey, fallbackId), usedIds);
  const slug = uniqueSlug(safeVariantSlug(variant.slug, id), usedSlugs);
  const createdAt = normalizeTimestamp(variant.createdAt, nowIso());
  const sourcePagePath =
    normalizePath(variant.sourcePagePath ?? variant.pageId ?? pagePath) || pagePath;
  const expectedPagePath = kind === 'control'
    ? pagePath
    : experimentVariantFilePath(experimentId, id, sourcePagePath);
  const declaredPagePath = normalizePath(variant.pagePath ?? variant.path);
  return {
    id,
    name: normalizeName(
      variant.name,
      kind === 'control' ? 'Control' : `Variant ${index + 1}`,
    ),
    slug,
    kind,
    status: normalizeVariantStatus(variant.status, variant.enabled),
    weight: finiteWeight(variant.weight ?? variant.traffic ?? variant.percentage),
    pagePath:
      kind === 'control'
        ? pagePath
        : declaredPagePath.startsWith(EXPERIMENT_INTERNAL_ROOT)
          ? declaredPagePath
          : expectedPagePath,
    sourcePagePath,
    sourceFileDigests:
      kind === 'variant'
        ? normalizeSourceDigests(variant.sourceFileDigests ?? variant.baseDigests)
        : undefined,
    inheritedFilePaths:
      kind === 'variant'
        ? normalizeInheritedFilePaths(variant.inheritedFilePaths)
        : undefined,
    createdAt,
    updatedAt: normalizeTimestamp(variant.updatedAt, createdAt),
  };
}

function activeVariants(variants: HtmlExperimentVariant[]) {
  return variants.filter(variant => variant.status === 'active');
}

/**
 * Normalizes active weights to exactly 100 while preserving their relative
 * intent. Paused/archived variants are always assigned zero traffic.
 */
export function normalizeVariantWeights(
  variants: HtmlExperimentVariant[],
): HtmlExperimentVariant[] {
  const eligible = activeVariants(variants);
  if (!eligible.length) return variants.map(variant => ({ ...variant, weight: 0 }));
  const total = eligible.reduce((sum, variant) => sum + finiteWeight(variant.weight), 0);
  const rawWeights = eligible.map(variant =>
    total > 0 ? finiteWeight(variant.weight) / total * 100 : 100 / eligible.length,
  );
  const normalized = rawWeights.map(roundWeight);
  normalized[normalized.length - 1] = roundWeight(
    normalized[normalized.length - 1]
      + 100
      - normalized.reduce((sum, value) => sum + value, 0),
  );
  let activeIndex = 0;
  return variants.map(variant =>
    variant.status === 'active'
      ? { ...variant, weight: normalized[activeIndex++] }
      : { ...variant, weight: 0 },
  );
}

function normalizeExperiment(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): HtmlExperiment {
  const experiment = record(value);
  const id = uniqueId(
    safeId(experiment.id ?? experiment.clientKey, `experiment-${index + 1}`),
    usedIds,
  );
  const pagePath =
    normalizePath(experiment.pagePath ?? experiment.pageId ?? experiment.page)
    || 'index.html';
  const rawVariants = Array.isArray(experiment.variants)
    ? experiment.variants
    : Array.isArray(experiment.documents)
      ? experiment.documents
      : [];
  const usedVariantIds = new Set<string>();
  const usedVariantSlugs = new Set<string>();
  let variants = rawVariants.map((variant, variantIndex) =>
    normalizeVariant(variant, variantIndex, id, pagePath, usedVariantIds, usedVariantSlugs),
  );
  const controls = variants.filter(variant => variant.kind === 'control');
  if (!controls.length) {
    const timestamp = nowIso();
    variants.unshift({
      id: uniqueId(EXPERIMENT_CONTROL_VARIANT_ID, usedVariantIds),
      name: 'Control',
      slug: uniqueSlug(EXPERIMENT_CONTROL_VARIANT_ID, usedVariantSlugs),
      kind: 'control',
      status: 'active',
      weight: variants.length ? 0 : 100,
      pagePath,
      sourcePagePath: pagePath,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } else if (controls.length > 1) {
    let sawControl = false;
    variants = variants.map(variant => {
      if (variant.kind !== 'control') return variant;
      if (!sawControl) {
        sawControl = true;
        return { ...variant, pagePath, sourcePagePath: pagePath };
      }
      return {
        ...variant,
        kind: 'variant',
        pagePath: experimentVariantFilePath(id, variant.id, pagePath),
        sourcePagePath: pagePath,
      };
    });
  } else {
    variants = variants.map(variant =>
      variant.kind === 'control'
        ? { ...variant, pagePath, sourcePagePath: pagePath }
        : variant,
    );
  }
  variants = normalizeVariantWeights(variants);
  const createdAt = normalizeTimestamp(experiment.createdAt, nowIso());
  const winnerCandidate = safeId(experiment.winnerVariantId, '');
  return {
    id,
    name: normalizeName(experiment.name, `A/B Test ${index + 1}`),
    pagePath,
    status: normalizeExperimentStatus(experiment.status),
    goal: normalizeGoal(experiment.goal, experiment, pagePath),
    ...normalizeExperimentOptions(experiment),
    variants,
    winnerVariantId:
      winnerCandidate && variants.some(variant => variant.id === winnerCandidate)
        ? winnerCandidate
        : undefined,
    createdAt,
    updatedAt: normalizeTimestamp(experiment.updatedAt, createdAt),
  };
}

/**
 * Accepts all persisted shapes used during the feature's prototypes:
 * - the canonical `{ version, experiments }` document;
 * - `analytics.experiments` as an array;
 * - legacy `{ tests }` / `{ abTests }` containers.
 */
export function normalizeExperimentSettings(value: unknown): HtmlExperimentSettings {
  if (Array.isArray(value)) {
    value = { experiments: value };
  }
  const source = record(value);
  const rawExperiments = Array.isArray(source.experiments)
    ? source.experiments
    : Array.isArray(source.tests)
      ? source.tests
      : Array.isArray(source.abTests)
        ? source.abTests
        : [];
  const usedIds = new Set<string>();
  return {
    version: EXPERIMENTS_SCHEMA_VERSION,
    experiments: rawExperiments.map((experiment, index) =>
      normalizeExperiment(experiment, index, usedIds),
    ),
  };
}

export function readExperimentSettings(project: HtmlProject): HtmlExperimentSettings {
  const metadata = readEditorMetadata(project) as unknown as Record<string, unknown>;
  const analytics = record(metadata.analytics);
  const canonical = Array.isArray(analytics.experiments)
    ? {
      version: analytics.experimentsVersion,
      experiments: analytics.experiments,
    }
    : analytics.experiments;
  return normalizeExperimentSettings(
    canonical
      ?? metadata.experiments
      ?? metadata.abTests
      ?? DEFAULT_EXPERIMENT_SETTINGS,
  );
}

export function writeExperimentSettings(
  project: HtmlProject,
  settings: unknown,
): HtmlProject {
  const normalized = normalizeExperimentSettings(settings);
  return updateEditorMetadata(project, metadata => {
    const source = metadata as unknown as Record<string, unknown>;
    const analytics = record(source.analytics);
    const next: Record<string, unknown> = {
      ...source,
      analytics: {
        ...analytics,
        experimentsVersion: EXPERIMENTS_SCHEMA_VERSION,
        experiments: normalized.experiments,
      },
    };
    delete next.experiments;
    delete next.abTests;
    return next as unknown as typeof metadata;
  });
}

function experimentById(settings: HtmlExperimentSettings, experimentId: string) {
  const experiment = settings.experiments.find(item => item.id === experimentId);
  if (!experiment) throw new Error('O teste A/B não existe mais.');
  return experiment;
}

function variantById(experiment: HtmlExperiment, variantId: string) {
  const variant = experiment.variants.find(item => item.id === variantId);
  if (!variant) throw new Error('A variante não existe mais.');
  return variant;
}

function replaceExperiment(
  settings: HtmlExperimentSettings,
  experimentId: string,
  update: (experiment: HtmlExperiment) => HtmlExperiment,
) {
  let found = false;
  const experiments = settings.experiments.map(experiment => {
    if (experiment.id !== experimentId) return experiment;
    found = true;
    return update(experiment);
  });
  if (!found) throw new Error('O teste A/B não existe mais.');
  return { ...settings, experiments };
}

function nextVariantName(experiment: HtmlExperiment) {
  let index = experiment.variants.filter(variant => variant.kind === 'variant').length + 1;
  let name = `Variant ${String.fromCharCode(65 + Math.min(index - 1, 25))}`;
  const names = new Set(experiment.variants.map(variant => variant.name.toLocaleLowerCase()));
  while (names.has(name.toLocaleLowerCase())) name = `Variant ${++index}`;
  return name;
}

function clonePublicFilesIntoVariant(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
  sourcePrefix?: string,
) {
  const prefix = experimentVariantPrefix(experimentId, variantId);
  const files: Record<string, HtmlProjectFile> = {};
  const inheritedFilePaths = new Set<string>();
  const cloneFileAndInteractionDocument = (
    sourcePath: string,
    targetPath: string,
    file: HtmlProjectFile,
  ) => {
    files[targetPath] = cloneFile(file, targetPath);
    if (!/\.html?$/i.test(sourcePath)) return;
    const sourceDocumentPath = storedInteractionDocumentPath(
      project.files,
      sourcePath,
    );
    const sourceDocument = sourceDocumentPath
      ? project.files[sourceDocumentPath]
      : undefined;
    if (!sourceDocument) return;
    const targetDocumentPath = interactionDocumentPath(targetPath);
    files[targetDocumentPath] = cloneFile(sourceDocument, targetDocumentPath);
  };
  if (sourcePrefix) {
    const visited = new Set<string>();
    Object.entries(project.files).forEach(([path, file]) => {
      if (!path.startsWith(sourcePrefix)) return;
      const publicPath = path.slice(sourcePrefix.length);
      if (!publicPath || publicPath.startsWith('.incode/')) return;
      visited.add(publicPath);
      // A binary present in the private source tree is an explicit override.
      // Do not hash it to guess whether old snapshots happen to match Control:
      // duplicating a variant must stay O(metadata + text), except for bytes
      // that truly belong to that source variant and therefore must be copied.
      cloneFileAndInteractionDocument(path, `${prefix}${publicPath}`, file);
    });
    // A source variant created with copy-on-write has no private entry for its
    // inherited binaries. Preserve that inheritance without touching bytes.
    publicProjectFilePaths(project).forEach(publicPath => {
      if (visited.has(publicPath)) return;
      if (project.files[publicPath]?.text === undefined) {
        inheritedFilePaths.add(publicPath);
      }
    });
  } else {
    publicProjectFilePaths(project).forEach(path => {
      if (project.files[path]?.text === undefined) {
        inheritedFilePaths.add(path);
        return;
      }
      cloneFileAndInteractionDocument(path, `${prefix}${path}`, project.files[path]);
    });
  }
  return {
    files,
    inheritedFilePaths: Array.from(inheritedFilePaths).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    ),
  };
}

function interactionDocumentPrefixesForVariant(variantPrefix: string) {
  const marker = 'kodety-variant-companion-marker';
  return interactionDocumentPathCandidates(`${variantPrefix}${marker}`)
    .map(markerPath => markerPath.slice(0, -`${marker}.json`.length));
}

function removeVariantFiles(
  files: Record<string, HtmlProjectFile>,
  experimentId: string,
  variantId: string,
) {
  const prefix = experimentVariantPrefix(experimentId, variantId);
  const interactionPrefixes = interactionDocumentPrefixesForVariant(prefix);
  return Object.fromEntries(Object.entries(files).filter(
    ([path]) => !path.startsWith(prefix)
      && !interactionPrefixes.some(interactionPrefix => path.startsWith(interactionPrefix)),
  ));
}

export function createExperiment(
  project: HtmlProject,
  input: {
    id?: string;
    name?: string;
    pagePath?: string;
    goal?: HtmlExperimentGoal;
    now?: string | number | Date;
  } = {},
) {
  const settings = readExperimentSettings(project);
  const usedIds = new Set(settings.experiments.map(experiment => experiment.id));
  const id = uniqueId(safeId(input.id, createId('experiment')), usedIds);
  const pagePath = normalizePath(input.pagePath) || getProjectHomePath(project);
  if (!publicPagePaths(project).includes(pagePath)) {
    throw new Error('Selecione uma página HTML pública para criar o teste A/B.');
  }
  const timestamp = nowIso(input.now);
  const experiment: HtmlExperiment = {
    id,
    name: normalizeName(input.name, `A/B Test · ${pagePath}`),
    pagePath,
    status: 'draft',
    goal: input.goal
      ? normalizeGoal(input.goal, {}, pagePath)
      : { type: 'pageview', pagePath },
    ...normalizeExperimentOptions({}),
    variants: [{
      id: EXPERIMENT_CONTROL_VARIANT_ID,
      name: 'Control',
      kind: 'control',
      status: 'active',
      weight: 100,
      pagePath,
      sourcePagePath: pagePath,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    project: writeExperimentSettings(project, {
      ...settings,
      experiments: [...settings.experiments, experiment],
    }),
    experiment,
  };
}

export function createExperimentVariant(
  project: HtmlProject,
  experimentId: string,
  input: {
    id?: string;
    name?: string;
    slug?: string;
    sourceVariantId?: string;
    weight?: number;
    now?: string | number | Date;
  } = {},
) {
  const settings = readExperimentSettings(project);
  const experiment = experimentById(settings, experimentId);
  const usedIds = new Set(experiment.variants.map(variant => variant.id));
  const usedSlugs = publicVariantSlugs(settings);
  const id = uniqueId(safeId(input.id, createId('variant')), usedIds);
  const slug = uniqueSlug(safeVariantSlug(input.slug, id), usedSlugs);
  const timestamp = nowIso(input.now);
  const sourceVariant = input.sourceVariantId
    ? variantById(experiment, input.sourceVariantId)
    : experiment.variants.find(variant => variant.kind === 'control');
  if (!sourceVariant) throw new Error('O teste não possui uma origem para duplicar.');
  const sourcePrefix = sourceVariant.kind === 'variant'
    ? experimentVariantPrefix(experimentId, sourceVariant.id)
    : undefined;
  const cloned = clonePublicFilesIntoVariant(
    project,
    experimentId,
    id,
    sourcePrefix,
  );
  const variantPagePath = experimentVariantFilePath(
    experimentId,
    id,
    experiment.pagePath,
  );
  if (!cloned.files[variantPagePath]) {
    throw new Error('A página-base da variante não foi encontrada no snapshot.');
  }
  const variant: HtmlExperimentVariant = {
    id,
    name: normalizeName(input.name, nextVariantName(experiment)),
    slug,
    kind: 'variant',
    status: 'active',
    weight: finiteWeight(input.weight),
    pagePath: variantPagePath,
    sourcePagePath: experiment.pagePath,
    sourceFileDigests: projectPublicFileDigests(project),
    inheritedFilePaths: cloned.inheritedFilePaths,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let variants = [...experiment.variants, variant];
  variants = input.weight === undefined
    ? variants.map(item => ({ ...item, weight: item.status === 'active' ? 1 : 0 }))
    : setTrafficWeightInVariants(variants, variant.id, input.weight);
  variants = normalizeVariantWeights(variants);
  const nextSettings = replaceExperiment(settings, experimentId, current => ({
    ...current,
    variants,
    updatedAt: timestamp,
  }));
  return {
    project: writeExperimentSettings(
      { ...project, files: { ...project.files, ...cloned.files } },
      nextSettings,
    ),
    variant: variants.find(item => item.id === id)!,
  };
}

export function duplicateExperimentVariant(
  project: HtmlProject,
  experimentId: string,
  sourceVariantId: string,
  input: Omit<Parameters<typeof createExperimentVariant>[2], 'sourceVariantId'> = {},
) {
  return createExperimentVariant(project, experimentId, {
    ...input,
    sourceVariantId,
  });
}

function setTrafficWeightInVariants(
  variants: HtmlExperimentVariant[],
  variantId: string,
  requestedWeight: number,
) {
  const target = variantById(
    {
      id: '',
      name: '',
      pagePath: '',
      status: 'draft',
      goal: { type: 'pageview', pagePath: '' },
      ...normalizeExperimentOptions({}),
      variants,
      createdAt: '',
      updatedAt: '',
    },
    variantId,
  );
  if (target.status !== 'active') {
    throw new Error('Reative a variante antes de atribuir tráfego.');
  }
  const requested = roundWeight(finiteWeight(requestedWeight));
  const others = variants.filter(
    variant => variant.id !== variantId && variant.status === 'active',
  );
  if (!others.length) {
    return variants.map(variant =>
      variant.id === variantId ? { ...variant, weight: 100 } : { ...variant, weight: 0 },
    );
  }
  const available = roundWeight(100 - requested);
  const totalOthers = others.reduce((sum, variant) => sum + variant.weight, 0);
  const equal = totalOthers <= 0;
  let allocated = 0;
  let otherIndex = 0;
  return variants.map(variant => {
    if (variant.id === variantId) return { ...variant, weight: requested };
    if (variant.status !== 'active') return { ...variant, weight: 0 };
    const isLast = otherIndex === others.length - 1;
    const weight = isLast
      ? roundWeight(available - allocated)
      : roundWeight(
        equal
          ? available / others.length
          : available * variant.weight / totalOthers,
      );
    allocated += weight;
    otherIndex++;
    return { ...variant, weight };
  });
}

export function setExperimentVariantWeight(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
  weight: number,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(project);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, experiment => ({
      ...experiment,
      variants: setTrafficWeightInVariants(experiment.variants, variantId, weight)
        .map(variant =>
          variant.id === variantId ? { ...variant, updatedAt: timestamp } : variant,
        ),
      updatedAt: timestamp,
    })),
  );
}

export function rebalanceExperimentTraffic(
  project: HtmlProject,
  experimentId: string,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(project);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, experiment => ({
      ...experiment,
      variants: normalizeVariantWeights(
        experiment.variants.map(variant => ({
          ...variant,
          weight: variant.status === 'active' ? 1 : 0,
        })),
      ),
      updatedAt: timestamp,
    })),
  );
}

export function setExperimentVariantStatus(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
  status: HtmlExperimentVariantStatus,
  now?: string | number | Date,
) {
  if (!VARIANT_STATUSES.has(status)) throw new Error('Status de variante inválido.');
  const settings = readExperimentSettings(project);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, experiment => {
      const current = variantById(experiment, variantId);
      if (
        experiment.status === 'active'
        && current.status === 'active'
        && status !== 'active'
        && activeVariants(experiment.variants).length === 1
      ) {
        throw new Error(
          'Pause o teste ou ative outra variante antes de desativar a única variante com tráfego.',
        );
      }
      let variants = experiment.variants.map(variant =>
        variant.id === variantId
          ? {
            ...variant,
            status,
            weight:
              status === 'active'
                ? current.status === 'active'
                  ? current.weight
                  : 1
                : 0,
            updatedAt: timestamp,
          }
          : variant,
      );
      variants = normalizeVariantWeights(variants);
      return { ...experiment, variants, updatedAt: timestamp };
    }),
  );
}

export function setExperimentStatus(
  project: HtmlProject,
  experimentId: string,
  status: HtmlExperimentStatus,
  now?: string | number | Date,
) {
  if (!EXPERIMENT_STATUSES.has(status)) throw new Error('Status de teste inválido.');
  const settings = readExperimentSettings(project);
  const experiment = experimentById(settings, experimentId);
  if (status === 'active') {
    const issues = validateExperiment(project, experiment);
    if (issues.length) throw new Error(issues[0].message);
  }
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, current => ({
      ...current,
      status,
      updatedAt: timestamp,
    })),
  );
}

export function updateExperimentGoal(
  project: HtmlProject,
  experimentId: string,
  goal: HtmlExperimentGoal,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(project);
  const experiment = experimentById(settings, experimentId);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, current => ({
      ...current,
      goal: normalizeGoal(goal, {}, experiment.pagePath),
      updatedAt: timestamp,
    })),
  );
}

export function updateExperimentOptions(
  project: HtmlProject,
  experimentId: string,
  options: Partial<HtmlExperimentOptions>,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(project);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, experiment => ({
      ...experiment,
      ...normalizeExperimentOptions(
        {
          ...experiment,
          ...options,
          audience: {
            ...experiment.audience,
            ...options.audience,
          },
          autoStop: {
            ...experiment.autoStop,
            ...options.autoStop,
          },
        },
        experiment,
      ),
      updatedAt: timestamp,
    })),
  );
}

export function renameExperiment(
  project: HtmlProject,
  experimentId: string,
  name: string,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(project);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, experiment => ({
      ...experiment,
      name: normalizeName(name, experiment.name),
      updatedAt: timestamp,
    })),
  );
}

export function renameExperimentVariant(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
  name: string,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(project);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, experiment => ({
      ...experiment,
      variants: experiment.variants.map(variant =>
        variant.id === variantId
          ? { ...variant, name: normalizeName(name, variant.name), updatedAt: timestamp }
          : variant,
      ),
      updatedAt: timestamp,
    })),
  );
}

/**
 * Update a variant's human-facing slug (its "link"). The value is normalized to
 * a URL-safe, optionally nested slug and made unique across every experiment so
 * two public routes never collide. The physical `id` is never touched, so storage,
 * assignment and analytics history stay intact.
 */
export function setExperimentVariantSlug(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
  slug: string,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(project);
  const experiment = experimentById(settings, experimentId);
  const target = experiment.variants.find(variant => variant.id === variantId);
  if (!target) throw new Error('A variante informada não existe neste teste.');
  const usedSlugs = publicVariantSlugs(settings, { experimentId, variantId });
  const nextSlug = uniqueSlug(safeVariantSlug(slug, target.id), usedSlugs);
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    project,
    replaceExperiment(settings, experimentId, current => ({
      ...current,
      variants: current.variants.map(variant =>
        variant.id === variantId
          ? { ...variant, slug: nextSlug, updatedAt: timestamp }
          : variant,
      ),
      updatedAt: timestamp,
    })),
  );
}

export function deleteExperimentVariant(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
) {
  const settings = readExperimentSettings(project);
  const experiment = experimentById(settings, experimentId);
  const variant = variantById(experiment, variantId);
  if (variant.kind === 'control') throw new Error('A variante Control não pode ser removida.');
  const nextSettings = replaceExperiment(settings, experimentId, current => ({
    ...current,
    winnerVariantId:
      current.winnerVariantId === variantId ? undefined : current.winnerVariantId,
    variants: normalizeVariantWeights(
      current.variants.filter(item => item.id !== variantId),
    ),
    updatedAt: nowIso(),
  }));
  return writeExperimentSettings(
    {
      ...project,
      files: removeVariantFiles(project.files, experimentId, variantId),
    },
    nextSettings,
  );
}

export function deleteExperiment(project: HtmlProject, experimentId: string) {
  const settings = readExperimentSettings(project);
  const experiment = experimentById(settings, experimentId);
  let files = project.files;
  experiment.variants.forEach(variant => {
    if (variant.kind === 'variant') {
      files = removeVariantFiles(files, experimentId, variant.id);
    }
  });
  return writeExperimentSettings(
    { ...project, files },
    {
      ...settings,
      experiments: settings.experiments.filter(item => item.id !== experimentId),
    },
  );
}

/**
 * Opens a private variant directly inside the canonical project. Normal text,
 * canvas and CSS edits therefore write to namespaced files and cannot mutate
 * Control. Keep the returned session and call `closeExperimentVariant`.
 */
export function openExperimentVariant(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
): { project: HtmlProject; session: HtmlExperimentEditSession } {
  const experiment = experimentById(readExperimentSettings(project), experimentId);
  const variant = variantById(experiment, variantId);
  const baseRootPath = normalizePath(readEditorMetadata(project).rootPath ?? project.rootPath);
  if (variant.kind === 'control') {
    return {
      project: {
        ...project,
        mainHtmlPath: experiment.pagePath,
        rootPath: baseRootPath,
        previewRootPath: undefined,
      },
      session: {
        experimentId,
        variantId,
        baseMainHtmlPath: project.mainHtmlPath,
        baseRootPath,
        variantPrefix: '',
        variantPagePath: experiment.pagePath,
      },
    };
  }
  if (!project.files[variant.pagePath]?.text) {
    throw new Error('Os arquivos privados desta variante não foram encontrados.');
  }
  const prefix = experimentVariantPrefix(experimentId, variantId);
  return {
    project: {
      ...project,
      mainHtmlPath: variant.pagePath,
      rootPath: baseRootPath,
      previewRootPath: `${prefix}${baseRootPath}`.replace(/\/+$/, ''),
    },
    session: {
      experimentId,
      variantId,
      baseMainHtmlPath: project.mainHtmlPath,
      baseRootPath,
      variantPrefix: prefix,
      variantPagePath: variant.pagePath,
    },
  };
}

export function closeExperimentVariant(
  project: HtmlProject,
  session: HtmlExperimentEditSession,
) {
  const { previewRootPath: _previewRootPath, ...canonicalProject } = project;
  return {
    ...canonicalProject,
    mainHtmlPath:
      project.files[session.baseMainHtmlPath]?.text !== undefined
        ? session.baseMainHtmlPath
        : getProjectHomePath(project),
    rootPath: session.baseRootPath,
  };
}

export function switchExperimentVariant(
  project: HtmlProject,
  currentSession: HtmlExperimentEditSession | null,
  experimentId: string,
  variantId: string,
) {
  return openExperimentVariant(
    currentSession ? closeExperimentVariant(project, currentSession) : project,
    experimentId,
    variantId,
  );
}

/**
 * Reconstructs edit context from the active private mainHtmlPath. This keeps
 * uploads/file creation safe after reloads where the React session object no
 * longer exists but the namespaced page is still open.
 */
export function activeExperimentEditSession(
  project: HtmlProject,
): HtmlExperimentEditSession | null {
  const path = normalizePath(project.mainHtmlPath);
  if (!path.startsWith(EXPERIMENT_INTERNAL_ROOT)) return null;
  const remainder = path.slice(EXPERIMENT_INTERNAL_ROOT.length);
  const [experimentId, variantId, projectSegment] = remainder.split('/');
  if (!experimentId || !variantId || projectSegment !== 'project') return null;
  const settings = readExperimentSettings(project);
  const experiment = settings.experiments.find(item => item.id === experimentId);
  const variant = experiment?.variants.find(item =>
    item.id === variantId && item.kind === 'variant',
  );
  if (!experiment || !variant) return null;
  const prefix = experimentVariantPrefix(experimentId, variantId);
  if (!path.startsWith(prefix) || !project.files[path]) return null;
  const baseRootPath = normalizePath(
    readEditorMetadata(project).rootPath ?? project.rootPath,
  );
  return {
    experimentId,
    variantId,
    baseMainHtmlPath: experiment.pagePath,
    baseRootPath,
    variantPrefix: prefix,
    variantPagePath: variant.pagePath,
  };
}

/**
 * The variant currently open for editing, resolved to what the visitor will
 * actually see: its public slug and its author-facing name. A variant is
 * published under that slug, never under the private `.incode/experiments/…`
 * path the editor happens to be holding open.
 */
export function activeExperimentVariantTarget(project: HtmlProject) {
  const session = activeExperimentEditSession(project);
  if (!session) return null;
  const settings = readExperimentSettings(project);
  const experiment = settings.experiments.find(item => item.id === session.experimentId);
  const variant = experiment?.variants.find(item => item.id === session.variantId);
  if (!experiment || !variant) return null;
  return {
    experimentName: experiment.name,
    variantName: variant.name,
    slug: normalizePath(variant.slug ?? ''),
  };
}

/** Prefixes a newly created asset/code file while a private variant is open. */
export function experimentEditPath(session: HtmlExperimentEditSession, path: string) {
  const normalized = normalizePath(path);
  if (!session.variantPrefix) return normalized;
  if (!normalized || normalized.startsWith('.incode/')) {
    throw new Error('Informe um caminho público válido para a variante.');
  }
  return `${session.variantPrefix}${normalized}`;
}

/** Converts a private file path back to the URL/path authored inside the copy. */
export function experimentPublicEditPath(
  session: HtmlExperimentEditSession,
  path: string,
) {
  const normalized = normalizePath(path);
  if (!session.variantPrefix) return normalized;
  return normalized.startsWith(session.variantPrefix)
    ? normalized.slice(session.variantPrefix.length)
    : normalized;
}

export function experimentStoragePath(
  project: HtmlProject,
  visiblePath: string,
) {
  const session = activeExperimentEditSession(project);
  return session ? experimentEditPath(session, visiblePath) : normalizePath(visiblePath);
}

/**
 * Returns the canonical storage paths that belong to the document tree being
 * edited right now. Control receives only public files; an authored variant
 * receives only files below its private prefix. Mutations that conceptually
 * apply to "the project" from an editor panel must use this boundary instead
 * of iterating `project.files`, which also contains every sibling variant.
 */
export function activeExperimentStorageFilePaths(project: HtmlProject) {
  const session = activeExperimentEditSession(project);
  return session
    ? Object.keys(project.files)
      .filter(path => path.startsWith(session.variantPrefix))
      .sort()
    : publicProjectFilePaths(project);
}

/**
 * Returns the project file view appropriate to the open document:
 * Control sees public files; a variant sees only its own tree with the prefix
 * removed. Callers can display these paths normally and map writes back with
 * `experimentStoragePath`.
 */
export function visibleExperimentFiles(project: HtmlProject) {
  const session = activeExperimentEditSession(project);
  if (!session) {
    return publicProjectFilePaths(project).map(path => readOnlyFileView(project.files[path]));
  }
  const experiment = readExperimentSettings(project).experiments
    .find(item => item.id === session.experimentId);
  const variant = experiment?.variants.find(item => item.id === session.variantId);
  const inherited = (variant?.inheritedFilePaths || []).flatMap(path => {
    const file = project.files[path];
    return file?.text === undefined ? [readOnlyFileView(file, path)] : [];
  });
  const privateFiles = Object.entries(project.files)
    .filter(([path]) => path.startsWith(session.variantPrefix))
    .map(([path, file]) => {
      const publicPath = path.slice(session.variantPrefix.length);
      return readOnlyFileView(file, publicPath);
    });
  return Array.from(new Map(
    [...inherited, ...privateFiles].map(file => [file.path, file]),
  ).values())
    .sort((left, right) =>
      left.path.localeCompare(right.path, undefined, { numeric: true }),
    );
}

export function visibleExperimentAssets(project: HtmlProject) {
  return visibleExperimentFiles(project).filter(file =>
    /^(image|video|audio|font)\//.test(file.mimeType)
    || Boolean(file.data && file.mimeType === 'application/octet-stream'),
  );
}

function availableVisiblePath(
  project: HtmlProject,
  requestedPath: string,
  deduplicate: boolean,
) {
  const session = activeExperimentEditSession(project);
  let publicPath = normalizePath(requestedPath);
  if (session && publicPath.startsWith(session.variantPrefix)) {
    publicPath = publicPath.slice(session.variantPrefix.length);
  }
  if (!publicPath || publicPath.startsWith('.incode/')) {
    throw new Error('Informe um caminho público válido para o arquivo.');
  }
  const storageFor = (path: string) =>
    session ? experimentEditPath(session, path) : path;
  const visiblePaths = new Set(
    session
      ? visibleExperimentFiles(project).map(file => file.path)
      : publicProjectFilePaths(project),
  );
  let storagePath = storageFor(publicPath);
  if (!deduplicate || !visiblePaths.has(publicPath)) {
    return { publicPath, storagePath, session };
  }
  const extensionIndex = publicPath.lastIndexOf('.');
  const slashIndex = publicPath.lastIndexOf('/');
  const hasExtension = extensionIndex > slashIndex;
  const stem = hasExtension ? publicPath.slice(0, extensionIndex) : publicPath;
  const extension = hasExtension ? publicPath.slice(extensionIndex) : '';
  let suffix = 2;
  do {
    publicPath = `${stem}-${suffix++}${extension}`;
    storagePath = storageFor(publicPath);
  } while (visiblePaths.has(publicPath));
  return { publicPath, storagePath, session };
}

export function resolveExperimentFileCreation(
  project: HtmlProject,
  requestedPath: string,
  options: { deduplicate?: boolean } = {},
) {
  return availableVisiblePath(
    project,
    requestedPath,
    options.deduplicate !== false,
  );
}

/**
 * Adds/replaces one file without ever retaining the caller's mutable byte
 * buffer. The authored URL remains `publicPath`; only storage is namespaced.
 */
export function upsertExperimentVariantFile(
  project: HtmlProject,
  session: HtmlExperimentEditSession,
  publicPath: string,
  file: HtmlProjectFile,
) {
  const path = experimentEditPath(session, publicPath);
  return {
    ...project,
    files: {
      ...project.files,
      [path]: cloneFile(file, path),
    },
  };
}

export function createActiveExperimentFile(
  project: HtmlProject,
  requestedPath: string,
  file: HtmlProjectFile,
  options: { deduplicate?: boolean } = {},
) {
  const resolved = resolveExperimentFileCreation(project, requestedPath, options);
  return {
    project: {
      ...project,
      files: {
        ...project.files,
        [resolved.storagePath]: cloneFile(file, resolved.storagePath),
      },
    },
    ...resolved,
  };
}

/**
 * Creates a compact, isolated project for integrations that cannot edit
 * namespaced paths. Use `commitExperimentVariantProject` atomically afterwards.
 */
export function materializeExperimentVariantProject(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
) {
  const experiment = experimentById(readExperimentSettings(project), experimentId);
  const variant = variantById(experiment, variantId);
  if (variant.kind === 'control') {
    return {
      ...project,
      files: Object.fromEntries(
        publicProjectFilePaths(project).map(path => [path, cloneFile(project.files[path])]),
      ),
      mainHtmlPath: experiment.pagePath,
      rootPath: normalizePath(readEditorMetadata(project).rootPath ?? project.rootPath),
    };
  }
  const prefix = experimentVariantPrefix(experimentId, variantId);
  const inheritedFiles = Object.fromEntries(
    (variant.inheritedFilePaths || []).flatMap(path => {
      const file = project.files[path];
      return file?.text === undefined ? [[path, readOnlyFileView(file, path)] as const] : [];
    }),
  );
  const privateFiles = Object.fromEntries(
    Object.entries(project.files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, file]) => {
        const publicPath = path.slice(prefix.length);
        return [publicPath, cloneFile(file, publicPath)];
      }),
  );
  const files = { ...inheritedFiles, ...privateFiles };
  return {
    name: `${project.name} · ${variant.name}`,
    files,
    mainHtmlPath: variant.sourcePagePath,
    rootPath: normalizePath(readEditorMetadata(project).rootPath ?? project.rootPath),
    openedAt: Date.now(),
  } satisfies HtmlProject;
}

export function commitExperimentVariantProject(
  hostProject: HtmlProject,
  experimentId: string,
  variantId: string,
  editedProject: HtmlProject,
  now?: string | number | Date,
) {
  const settings = readExperimentSettings(hostProject);
  const experiment = experimentById(settings, experimentId);
  const variant = variantById(experiment, variantId);
  if (variant.kind === 'control') {
    throw new Error('Control deve ser editado diretamente no projeto-base.');
  }
  const prefix = experimentVariantPrefix(experimentId, variantId);
  const keptFiles = Object.fromEntries(
    Object.entries(hostProject.files).filter(([path]) => !path.startsWith(prefix)),
  );
  const inherited = new Set(variant.inheritedFilePaths || []);
  const privateFiles = Object.fromEntries(
    publicProjectFilePaths(editedProject).flatMap(path => {
      const editedFile = editedProject.files[path];
      const controlFile = hostProject.files[path];
      if (
        inherited.has(path)
        && editedFile?.text === undefined
        && controlFile?.text === undefined
        && editedFile.data === controlFile.data
      ) return [];
      const privatePath = `${prefix}${path}`;
      return [[privatePath, cloneFile(editedFile, privatePath)] as const];
    }),
  );
  const variantPagePath = `${prefix}${variant.sourcePagePath}`;
  if (!privateFiles[variantPagePath]) {
    throw new Error('A página principal da variante não pode ser removida.');
  }
  const timestamp = nowIso(now);
  return writeExperimentSettings(
    { ...hostProject, files: { ...keptFiles, ...privateFiles } },
    replaceExperiment(settings, experimentId, current => ({
      ...current,
      variants: current.variants.map(item =>
        item.id === variantId
          ? { ...item, pagePath: variantPagePath, updatedAt: timestamp }
          : item,
      ),
      updatedAt: timestamp,
    })),
  );
}

export function validateExperiment(
  project: HtmlProject,
  experiment: HtmlExperiment,
): HtmlExperimentValidationIssue[] {
  const issues: HtmlExperimentValidationIssue[] = [];
  if (!experiment.name.trim()) {
    issues.push({
      experimentId: experiment.id,
      code: 'experiment-name-required',
      message: 'Informe um nome para o teste A/B.',
    });
  }
  if (!publicPagePaths(project).includes(experiment.pagePath)) {
    issues.push({
      experimentId: experiment.id,
      code: 'page-not-found',
      message: 'A página pública do teste A/B não existe mais.',
    });
  }
  const controls = experiment.variants.filter(variant => variant.kind === 'control');
  if (!controls.length) {
    issues.push({
      experimentId: experiment.id,
      code: 'control-required',
      message: 'O teste A/B precisa de uma variante Control.',
    });
  } else if (controls.length > 1) {
    issues.push({
      experimentId: experiment.id,
      code: 'multiple-controls',
      message: 'O teste A/B não pode possuir mais de um Control.',
    });
  }
  experiment.variants.forEach(variant => {
    if (variant.kind === 'variant' && project.files[variant.pagePath]?.text === undefined) {
      issues.push({
        experimentId: experiment.id,
        variantId: variant.id,
        code: 'variant-page-not-found',
        message: `Os arquivos de “${variant.name}” não foram encontrados.`,
      });
    }
  });
  const active = activeVariants(experiment.variants);
  if (!active.length) {
    issues.push({
      experimentId: experiment.id,
      code: 'active-variant-required',
      message: 'Ative ao menos uma variante para distribuir tráfego.',
    });
  } else {
    const total = active.reduce((sum, variant) => sum + variant.weight, 0);
    if (Math.abs(total - 100) > 10 ** -EXPERIMENT_WEIGHT_PRECISION) {
      issues.push({
        experimentId: experiment.id,
        code: 'invalid-weight-total',
        message: 'A distribuição de tráfego das variantes deve totalizar 100%.',
      });
    }
  }
  if (
    experiment.goal.type === 'click' && !experiment.goal.trackingId
    || experiment.goal.type === 'custom' && !experiment.goal.eventName
    || experiment.goal.type === 'pageview' && !experiment.goal.pagePath
  ) {
    issues.push({
      experimentId: experiment.id,
      code: 'goal-required',
      message: 'Configure uma meta de conversão válida.',
    });
  }
  if (
    experiment.winnerVariantId
    && !experiment.variants.some(variant => variant.id === experiment.winnerVariantId)
  ) {
    issues.push({
      experimentId: experiment.id,
      code: 'winner-not-found',
      message: 'A variante vencedora não existe mais.',
    });
  }
  return issues;
}

export function validateExperimentSettings(
  project: HtmlProject,
  settings: unknown = readExperimentSettings(project),
) {
  return normalizeExperimentSettings(settings).experiments.flatMap(experiment =>
    validateExperiment(project, experiment),
  );
}

export function promoteExperimentVariant(
  project: HtmlProject,
  experimentId: string,
  variantId: string,
  options: {
    conflictStrategy?: 'abort' | 'variant-wins';
    now?: string | number | Date;
  } = {},
): HtmlExperimentPromotionResult {
  const settings = readExperimentSettings(project);
  const experiment = experimentById(settings, experimentId);
  const variant = variantById(experiment, variantId);
  const timestamp = nowIso(options.now);
  if (variant.kind === 'control') {
    const next = writeExperimentSettings(
      project,
      replaceExperiment(settings, experimentId, current => ({
        ...current,
        winnerVariantId: variantId,
        status: 'paused',
        updatedAt: timestamp,
      })),
    );
    return { project: next, conflicts: [], promotedPaths: [], removedPaths: [] };
  }
  const prefix = experimentVariantPrefix(experimentId, variantId);
  const variantFiles = Object.fromEntries(
    Object.entries(project.files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, file]) => [path.slice(prefix.length), file]),
  );
  const sourceDigests = variant.sourceFileDigests || {};
  const inheritedFilePaths = new Set(variant.inheritedFilePaths || []);
  const candidatePaths = new Set([
    ...Object.keys(sourceDigests),
    ...Object.keys(variantFiles),
  ]);
  const changedPaths = Array.from(candidatePaths)
    // No private file means the binary still comes from Control. It is not a
    // deletion and must never be promoted as one.
    .filter(path => !(inheritedFilePaths.has(path) && !variantFiles[path]))
    .filter(path => digestFile(variantFiles[path]) !== (sourceDigests[path] || ''))
    .sort();
  const conflicts: HtmlExperimentPromotionConflict[] = [];
  changedPaths.forEach(path => {
    const current = project.files[path];
    const sourceDigest = sourceDigests[path];
    if (!sourceDigest && current && !inheritedFilePaths.has(path)) {
      conflicts.push({ path, reason: 'control-file-added' });
    } else if (sourceDigest && digestFile(current) !== sourceDigest) {
      conflicts.push({ path, reason: 'control-changed' });
    }
  });
  if (conflicts.length && options.conflictStrategy !== 'variant-wins') {
    return { project, conflicts, promotedPaths: [], removedPaths: [] };
  }
  const files = { ...project.files };
  const promotedPaths: string[] = [];
  const removedPaths: string[] = [];
  changedPaths.forEach(path => {
    const file = variantFiles[path];
    if (!file) {
      delete files[path];
      removedPaths.push(path);
      return;
    }
    files[path] = cloneFile(file, path);
    promotedPaths.push(path);
  });
  const variantInteractionPath = storedInteractionDocumentPath(
    project.files,
    variant.pagePath,
  ) || interactionDocumentPath(variant.pagePath);
  const storedControlInteractionPath = storedInteractionDocumentPath(
    project.files,
    experiment.pagePath,
  );
  const controlInteractionPath = interactionDocumentPath(experiment.pagePath);
  const variantInteraction = project.files[variantInteractionPath];
  const controlInteraction = storedControlInteractionPath
    ? project.files[storedControlInteractionPath]
    : undefined;
  if (variantInteraction) {
    if (digestFile(variantInteraction) !== digestFile(controlInteraction)) {
      files[controlInteractionPath] = cloneFile(variantInteraction, controlInteractionPath);
      promotedPaths.push(controlInteractionPath);
    }
  } else if (controlInteraction) {
    delete files[storedControlInteractionPath!];
    removedPaths.push(storedControlInteractionPath!);
  }
  if (files[experiment.pagePath]?.text === undefined) {
    throw new Error('A promoção removeria a página pública do teste.');
  }
  const nextSettings = replaceExperiment(settings, experimentId, current => ({
    ...current,
    winnerVariantId: variantId,
    status: 'paused',
    updatedAt: timestamp,
  }));
  return {
    project: writeExperimentSettings({ ...project, files }, nextSettings),
    conflicts,
    promotedPaths,
    removedPaths,
  };
}

export function variantGroupsForPage(
  project: HtmlProject,
  pagePath?: string,
  settings: unknown = readExperimentSettings(project),
): HtmlExperimentPageGroup[] {
  const requestedPath = pagePath ? normalizePath(pagePath) : '';
  return normalizeExperimentSettings(settings).experiments
    .filter(experiment => !requestedPath || experiment.pagePath === requestedPath)
    .map(experiment => ({
      experimentId: experiment.id,
      name: experiment.name,
      pagePath: experiment.pagePath,
      status: experiment.status,
      winnerVariantId: experiment.winnerVariantId,
      variants: experiment.variants.map(variant => ({ ...variant })),
    }));
}

export function experimentRuntimeAssignments(
  settings: unknown,
): HtmlExperimentRuntimeAssignment[] {
  return normalizeExperimentSettings(settings).experiments.flatMap(experiment =>
    experiment.variants.map(variant => ({
      clientKey: experiment.id,
      documentKey: variant.id,
      pageId: experiment.pagePath,
      path: variant.pagePath,
      weight: variant.weight,
      enabled:
        experiment.status === 'active'
        && variant.status === 'active'
        && variant.weight > 0,
    })),
  );
}

export function trackingIdsFromHtml(html: string) {
  const ids = new Set<string>();
  const pattern = /\bdata-kodety-tracking-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const id = normalizeTrackingId(match[1] ?? match[2] ?? match[3]);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}
