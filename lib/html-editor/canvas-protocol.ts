import type { SelectionSnapshot, SelectionStyleOrigin } from './types';
import type { CanvasDesignTool } from './editor-types';

const MAX_MESSAGE_UNITS = 512 * 1024;
const MAX_PATH_LENGTH = 2048;
const MAX_SELECTED_PATHS = 1024;
const MAX_VISIBILITY_SNAPSHOT_PATHS = 8192;
const MAX_RUNTIME_ASSET_REQUEST_PATHS = 1024;
const MAX_STYLE_ORIGINS = 1024;
const MAX_CSS_PROPERTY_LENGTH = 512;
const MAX_CSS_SELECTOR_LENGTH = 16 * 1024;
const MAX_CLIPBOARD_SVG_LENGTH = 384 * 1024;
const MAX_FIGMA_CLIPBOARD_CHARACTERS = 96 * 1024 * 1024;
const DIRECT_POSITION_PROPERTIES = new Set(['top', 'right', 'bottom', 'left']);
const DIRECT_STYLE_PROPERTIES = new Set([
  'width',
  'height',
  'rotate',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block',
  'padding-inline',
  'gap',
  'row-gap',
  'column-gap',
  'border-width',
  'border-radius',
  ...DIRECT_POSITION_PROPERTIES,
]);
const DIRECT_STYLE_PREVIEW_PROPERTIES = new Set([
  ...DIRECT_STYLE_PROPERTIES,
  'border-style',
]);

type CanvasGeneration = { generation: string };

export type HtmlEditorCommand =
  | 'undo'
  | 'redo'
  | 'copy-selection'
  | 'paste-selection'
  | 'copy-selection-styles'
  | 'paste-selection-styles'
  | 'delete-selection'
  | 'duplicate-selection'
  | 'move-selection-up'
  | 'move-selection-down'
  | 'move-selection-first'
  | 'move-selection-last'
  | 'open-insert';

export type PreviewLinkDisposition = 'self' | 'new-context' | 'download';

export interface CanvasRevisionMutation {
  mutationId: string;
  revision: number;
}

/**
 * Resolves an acknowledgement only when it names the exact pending mutation
 * and revision. Delivery order is not an authority boundary: an older ACK may
 * arrive after a newer structural command has already changed the source.
 */
export function matchingCanvasRevisionMutation<T extends CanvasRevisionMutation>(
  pending: ReadonlyMap<string, T>,
  acknowledged: CanvasRevisionMutation,
) {
  const mutation = pending.get(acknowledged.mutationId);
  return mutation?.revision === acknowledged.revision ? mutation : null;
}

/**
 * A later style/code ACK may carry the newest revision even when the exact ACK
 * for an earlier structural command was lost. Pending positional work remains
 * an independent recovery obligation; a numeric revision alone cannot prove it.
 */
export function canvasRevisionNeedsCanonicalRecovery(
  appliedRevision: number,
  projectRevision: number,
  pendingStructuralMutations: number,
) {
  return pendingStructuralMutations > 0 || appliedRevision < projectRevision;
}

export interface CanvasPreviewScrollOwner {
  projectId?: string;
  openedAt: number;
  rootPath: string;
  mainHtmlPath: string;
}

/**
 * Scroll restoration belongs to one project page, not to the iframe surface.
 * Canonical reloads keep this key stable; switching project or entry page does
 * not, so an offset captured on one site can never leak into another.
 */
export function canvasPreviewScrollOwnerKey(
  owner: CanvasPreviewScrollOwner | null | undefined,
) {
  if (!owner) return '';
  const projectId = owner.projectId?.trim();
  const projectKey = projectId
    ? `project:${projectId}`
    : `legacy:${Number.isFinite(owner.openedAt) ? owner.openedAt : 0}:${owner.rootPath}`;
  return `${projectKey}\u0000${owner.mainHtmlPath}`;
}

/**
 * A compact journal uses Maps so only the newest value for a property remains.
 * Updating an existing Map key does not move its insertion position, therefore
 * replay must sort the surviving entries by revision before applying related
 * shorthand/longhand declarations.
 */
export function sortCanvasJournalEntriesByRevision<T extends { revision: number }>(
  entries: Iterable<T>,
) {
  return Array.from(entries)
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      left.entry.revision - right.entry.revision || left.index - right.index)
    .map(({ entry }) => entry);
}

export interface CanvasComputedStyleExpectation {
  path: string;
  property: string;
  value: string;
  mode?: 'equals' | 'not-equals';
}

export interface EditorToCanvasSelectMessage {
  generation: string;
  type: 'html-editor-select';
  path: string;
  additive?: boolean;
  fallbackToAncestor?: boolean;
  /**
   * Set to false when restoring selection state without moving the viewport.
   */
  reveal?: boolean;
}

/**
 * CSSOM values are case-insensitive for the visibility/layout keywords used by
 * the canvas integrity checks. Keep this comparison tiny and deterministic so
 * the editor and the injected preview bridge agree on what an ACK means.
 */
export function canvasComputedStyleExpectationMatches(
  expectation: CanvasComputedStyleExpectation,
  computedValue: string,
) {
  const expected = expectation.value.trim().replace(/\s+/g, ' ').toLowerCase();
  const actual = computedValue.trim().replace(/\s+/g, ' ').toLowerCase();
  return expectation.mode === 'not-equals'
    ? actual !== expected
    : actual === expected;
}

export function canvasComputedStyleExpectationsForEdit(
  paths: readonly string[],
  property: string,
  value: string,
): CanvasComputedStyleExpectation[] {
  const normalizedProperty = property.trim().toLowerCase();
  const expected = value.replace(/\s*!\s*important\b/gi, '').trim();
  if (
    normalizedProperty === 'object-position'
    && /^-?(?:\d+(?:\.\d+)?|\.\d+)%\s+-?(?:\d+(?:\.\d+)?|\.\d+)%$/.test(expected)
  ) {
    return paths.map(path => ({
      path,
      property: normalizedProperty,
      value: expected,
      mode: 'equals',
    }));
  }
  if (normalizedProperty !== 'display') return [];
  return paths.map(path => expected
    ? { path, property: 'display', value: expected, mode: 'equals' }
    : { path, property: 'display', value: 'none', mode: 'not-equals' });
}

export function isCanvasElementComputedVisible(
  computedDisplay: string | undefined,
  fallbackDisplay = '',
  hiddenAttribute = false,
) {
  const computed = computedDisplay?.trim().toLowerCase();
  if (computed) return computed !== 'none';
  return !hiddenAttribute
    && fallbackDisplay.trim().replace(/\s*!\s*important\b/gi, '').toLowerCase() !== 'none';
}

export interface CanvasSelectionCanonicalHandoff {
  generation: string;
  revision: number;
}

/**
 * The outgoing iframe may echo a selection after accepting an editor-owned
 * revision but before its computed layout has stabilized. Keep the optimistic
 * Inspector state until a different canvas generation includes that revision.
 */
export function shouldRetainCanvasSelectionSnapshot(
  handoff: CanvasSelectionCanonicalHandoff | undefined,
  incomingGeneration: string,
  incomingRevision: number,
) {
  return Boolean(
    handoff
    && (
      incomingGeneration === handoff.generation
      || incomingRevision < handoff.revision
    ),
  );
}

/**
 * Re-addresses editor-owned selection before a structural source commit can
 * expose the new tree to keyboard commands. Empty string is the valid body
 * path, so null—not truthiness—is the only removed-path sentinel.
 *
 * An explicit preferred path represents the command result (inserted, moved,
 * wrapped or first promoted child) and intentionally becomes the sole primary
 * selection. Explicit null clears selection, used when an unwrap promotes only
 * text and no authored element remains selectable at the old address.
 */
export function reconcileStructuralSelectionPaths(
  currentPaths: readonly string[],
  remapPath: (path: string) => string | null,
  preferredPrimaryPath?: string | null,
) {
  if (preferredPrimaryPath !== undefined) {
    return preferredPrimaryPath === null ? [] : [preferredPrimaryPath];
  }
  const next: string[] = [];
  currentPaths.forEach(path => {
    const remapped = remapPath(path);
    if (remapped === null || next.includes(remapped)) return;
    next.push(remapped);
  });
  return next;
}

export type CanvasToEditorMessage = CanvasGeneration & (
  | { type: 'html-editor-runtime-assets-ready' }
  | { type: 'html-editor-runtime-asset-request'; path: string }
  | { type: 'html-editor-runtime-assets-request'; paths: string[] }
  | { type: 'html-editor-canvas-ready'; revision: number }
  | {
    type: 'html-editor-visibility-snapshot';
    breakpointId: string;
    hiddenPaths: string[];
    revision: number;
    /** Monotonic within one canvas generation; rejects a delayed resize sample. */
    sequence: number;
  }
  | {
    type: 'html-editor-component-size';
    width: number;
    height: number;
    layoutWidth: number;
    layoutHeight: number;
  }
  | { type: 'html-editor-live-style-applied'; mutationId: string; revision: number }
  | { type: 'html-editor-live-style-rejected'; mutationId: string; revision: number }
  | { type: 'html-editor-live-structure-applied'; mutationId: string; revision: number }
  | { type: 'html-editor-live-structure-rejected'; mutationId: string; revision: number }
  | { type: 'html-editor-code-component-applied'; instanceId: string; revision: number }
  | { type: 'html-editor-code-component-rejected'; instanceId: string; revision: number }
  | {
    type: 'html-editor-interaction-duration';
    interactionId: string;
    signature: string;
    duration: number;
  }
  | {
    type: 'html-editor-interaction-control-applied';
    timelineSequence: number;
  }
  | {
    type: 'html-editor-selection';
    /** Breakpoint physically rendered when computed styles/origins were read. */
    breakpointId: string;
    payload: SelectionSnapshot | null;
    selectedPaths: string[];
    /** Distinguishes a direct canvas gesture from editor-driven selection sync. */
    origin?: 'canvas' | 'editor';
    /** Latest canonical/live mutation reflected by this snapshot. */
    revision: number;
    /** Monotonic within one canvas generation; prevents deferred detail from replacing a newer click. */
    selectionSequence?: number;
    /** Identity is paint-first; computed detail hydrates the Inspector after the canvas yields. */
    detail?: 'identity' | 'computed';
  }
  | { type: 'html-editor-context-menu'; path: string; x: number; y: number }
  | { type: 'html-editor-edit-component'; path: string }
  | {
    type: 'html-editor-edit-code-component';
    path: string;
    instanceId: string;
    componentId: string;
    componentVersion: string;
  }
  | { type: 'html-editor-infinite-canvas-wheel'; deltaX: number; deltaY: number; zoom?: boolean; pan?: boolean; x?: number; y?: number }
  | { type: 'html-editor-infinite-canvas-space'; pressed: boolean }
  | { type: 'html-editor-infinite-canvas-height'; height: number }
  | { type: 'html-editor-viewport-height-simulation'; path: string; height: number }
  | { type: 'html-editor-scroll-state'; key: string; x: number; y: number }
  | { type: 'html-editor-scroll-checkpoint'; requestId: string }
  | { type: 'html-editor-command'; command: HtmlEditorCommand }
  | { type: 'html-editor-svg-paste'; svg: string; targetPath: string }
  | { type: 'html-editor-figma-paste'; text: string; html: string; targetPath: string }
  | {
    type: 'html-editor-link';
    href: string;
    disposition: PreviewLinkDisposition;
    trusted: boolean;
    /** Correlates a user-opened placeholder window with its hosted URL. */
    requestId?: string;
    /** Empty means use the destination basename, like a native download. */
    download?: string;
  }
  | { type: 'html-editor-text-range'; path: string; active: boolean }
  | { type: 'html-editor-text-change'; path: string; value: string; html?: string; rangeStyle?: boolean }
  | { type: 'html-editor-insert-drop'; key: string; targetPath: string; position: 'before' | 'after' | 'inside' }
  | {
    type: 'html-editor-draw-insert';
    key: Exclude<CanvasDesignTool, 'select'>;
    targetPath: string;
    position: 'before' | 'after' | 'inside';
    width: number;
    height: number;
  }
  | { type: 'html-editor-canvas-tool-cancel' }
  | { type: 'html-editor-canvas-tool-request'; tool: CanvasDesignTool }
  | {
    type: 'html-editor-direct-style-preview';
    breakpointId: string;
    path: string;
    values: Record<string, string>;
  }
  | { type: 'html-editor-design-tokens'; cssText: string }
  | {
    type: 'html-editor-direct-style';
    breakpointId: string;
    path: string;
    property: string;
    sourceProperty?: string;
    value: string;
    ensureBorder?: boolean;
    startPx?: number;
    valuePx?: number;
    gestureId?: string;
  }
  | {
    type: 'html-editor-direct-style-batch';
    breakpointId: string;
    path: string;
    styles: Array<{
      property: string;
      sourceProperty?: string;
      value: string;
      startPx: number;
      valuePx: number;
    }>;
    gestureId: string;
  }
  | { type: 'html-editor-move-element'; sourcePath: string; targetPath: string; position: 'before' | 'after' | 'inside' }
);

interface ValidationBudget {
  remaining: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length <= allowed.length && keys.every(key => allowed.includes(key));
}

function consumeString(
  value: unknown,
  budget: ValidationBudget,
  maxLength: number,
): value is string {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  budget.remaining -= value.length + 2;
  return budget.remaining >= 0;
}

function consumeNumber(value: unknown, budget: ValidationBudget): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) return false;
  budget.remaining -= 8;
  return budget.remaining >= 0;
}

function consumeRevision(value: unknown, budget: ValidationBudget): value is number {
  return consumeNumber(value, budget) && Number.isSafeInteger(value) && value >= 0;
}

function consumeBoolean(value: unknown, budget: ValidationBudget): value is boolean {
  if (typeof value !== 'boolean') return false;
  budget.remaining -= 1;
  return budget.remaining >= 0;
}

function consumeOptionalBoolean(value: unknown, budget: ValidationBudget) {
  return value === undefined || consumeBoolean(value, budget);
}

function consumeOptionalSpatialNumber(
  value: unknown,
  budget: ValidationBudget,
  maximum: number,
  minimum = 0,
) {
  return value === undefined
    || (consumeNumber(value, budget) && value >= minimum && value <= maximum);
}

function consumePath(value: unknown, budget: ValidationBudget): value is string {
  return consumeString(value, budget, MAX_PATH_LENGTH)
    && /^(?:\d+(?:\/\d+)*)?$/.test(value);
}

function consumeRuntimeAssetPath(value: unknown, budget: ValidationBudget): value is string {
  return consumeString(value, budget, MAX_PATH_LENGTH)
    && !value.startsWith('/')
    && !value.split('/').includes('..');
}

function consumeStringRecord(
  value: unknown,
  budget: ValidationBudget,
  maxEntries: number,
  maxKeyLength: number,
  maxValueLength: number,
): value is Record<string, string> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > maxEntries) return false;
  return entries.every(([key, entry]) =>
    consumeString(key, budget, maxKeyLength)
    && consumeString(entry, budget, maxValueLength));
}

function consumeCssPropertyName(
  value: unknown,
  budget: ValidationBudget,
): value is string {
  return consumeString(value, budget, MAX_CSS_PROPERTY_LENGTH)
    && Boolean(value)
    && value === value.trim()
    && !/[\u0000-\u0020:;{}]/.test(value);
}

function consumeSelectionStyleOrigin(
  value: unknown,
  budget: ValidationBudget,
): value is SelectionStyleOrigin {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'selector',
    'cssPath',
    'property',
    'important',
    'inline',
  ])) return false;
  if (!consumeString(value.selector, budget, MAX_CSS_SELECTOR_LENGTH)) return false;
  if (!consumeString(value.cssPath, budget, MAX_PATH_LENGTH)) return false;
  if (!consumeCssPropertyName(value.property, budget)) return false;
  if (!consumeBoolean(value.important, budget) || !consumeBoolean(value.inline, budget)) return false;
  if (value.cssPath && (
    value.cssPath.startsWith('/')
    || value.cssPath.includes('\\')
    || value.cssPath.split('/').some(segment => segment === '.' || segment === '..')
    || /[\u0000-\u001f?#]/.test(value.cssPath)
    || /^[a-z][a-z0-9+.-]*:/i.test(value.cssPath)
    || !/\.css$/i.test(value.cssPath)
  )) return false;
  return value.inline
    ? value.selector === '' && value.cssPath === ''
    : Boolean(value.selector.trim()) && value.selector === value.selector.trim();
}

function consumeSelectionStyleOrigins(
  value: unknown,
  budget: ValidationBudget,
): value is Record<string, SelectionStyleOrigin> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_STYLE_ORIGINS) return false;
  return entries.every(([property, origin]) =>
    consumeCssPropertyName(property, budget)
    && consumeSelectionStyleOrigin(origin, budget));
}

function consumeSelectionSnapshot(
  value: unknown,
  budget: ValidationBudget,
): value is SelectionSnapshot {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    'path',
    'tag',
    'id',
    'classes',
    'attributes',
    'text',
    'hasElementChildren',
    'computedStyle',
    'authoredStyle',
    'styleOrigins',
    'parentDisplay',
    'parentPosition',
  ])) return false;
  if (!consumePath(value.path, budget)) return false;
  if (!consumeString(value.tag, budget, 64) || !/^[a-z][a-z0-9:-]*$/i.test(value.tag)) return false;
  if (!consumeString(value.id, budget, 2048)) return false;
  if (!Array.isArray(value.classes) || value.classes.length > 512) return false;
  if (!value.classes.every(item => consumeString(item, budget, 1024))) return false;
  if (!consumeStringRecord(value.attributes, budget, 512, 1024, 256 * 1024)) return false;
  if (!consumeString(value.text, budget, 256 * 1024)) return false;
  if (!consumeBoolean(value.hasElementChildren, budget)) return false;
  if (!consumeStringRecord(value.computedStyle, budget, 2048, 512, 64 * 1024)) return false;
  if (value.authoredStyle !== undefined && !consumeStringRecord(value.authoredStyle, budget, 64, 512, 64 * 1024)) return false;
  if (value.styleOrigins !== undefined && !consumeSelectionStyleOrigins(value.styleOrigins, budget)) return false;
  if (value.parentDisplay !== undefined && !consumeString(value.parentDisplay, budget, 128)) return false;
  return value.parentPosition === undefined || consumeString(value.parentPosition, budget, 128);
}

function consumeSelectedPaths(value: unknown, budget: ValidationBudget): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_SELECTED_PATHS
    && value.every(path => consumePath(path, budget));
}

function consumePosition(value: unknown): value is 'before' | 'after' | 'inside' {
  return value === 'before' || value === 'after' || value === 'inside';
}

/**
 * Accepts only bounded messages from the current iframe generation. This is a
 * freshness and parser-safety boundary, not a secret: authored scripts share
 * the iframe realm and can therefore observe the generation identifier.
 */
export function isCanvasToEditorMessage(
  value: unknown,
  expectedGeneration: string,
): value is CanvasToEditorMessage {
  if (!expectedGeneration || !isRecord(value)) return false;
  const budget: ValidationBudget = { remaining: MAX_MESSAGE_UNITS };
  if (!consumeString(value.generation, budget, 128) || value.generation !== expectedGeneration) return false;
  if (!consumeString(value.type, budget, 64)) return false;

  switch (value.type) {
    case 'html-editor-runtime-assets-ready':
      return hasOnlyKeys(value, ['type', 'generation']);
    case 'html-editor-runtime-asset-request':
      return hasOnlyKeys(value, ['type', 'generation', 'path'])
        && consumeRuntimeAssetPath(value.path, budget);
    case 'html-editor-runtime-assets-request':
      return hasOnlyKeys(value, ['type', 'generation', 'paths'])
        && Array.isArray(value.paths)
        && value.paths.length > 0
        && value.paths.length <= MAX_RUNTIME_ASSET_REQUEST_PATHS
        && value.paths.every(path => consumeRuntimeAssetPath(path, budget));
    case 'html-editor-canvas-ready':
      return hasOnlyKeys(value, ['type', 'generation', 'revision'])
        && consumeRevision(value.revision, budget);
    case 'html-editor-visibility-snapshot': {
      if (!hasOnlyKeys(value, [
        'type',
        'generation',
        'breakpointId',
        'hiddenPaths',
        'revision',
        'sequence',
      ])) return false;
      if (!consumeString(value.breakpointId, budget, 128) || !value.breakpointId) return false;
      if (!consumeRevision(value.revision, budget)) return false;
      if (!consumeRevision(value.sequence, budget) || value.sequence < 1) return false;
      if (
        !Array.isArray(value.hiddenPaths)
        || value.hiddenPaths.length > MAX_VISIBILITY_SNAPSHOT_PATHS
        || !value.hiddenPaths.every(path => consumePath(path, budget))
      ) return false;
      return new Set(value.hiddenPaths).size === value.hiddenPaths.length;
    }
    case 'html-editor-component-size':
      return hasOnlyKeys(value, [
        'type',
        'generation',
        'width',
        'height',
        'layoutWidth',
        'layoutHeight',
      ])
        && consumeNumber(value.width, budget)
        && consumeNumber(value.height, budget)
        && consumeNumber(value.layoutWidth, budget)
        && consumeNumber(value.layoutHeight, budget)
        && value.width >= 1
        && value.width <= 100_000
        && value.height >= 1
        && value.height <= 100_000
        && value.layoutWidth >= 1
        && value.layoutWidth <= 100_000
        && value.layoutHeight >= 1
        && value.layoutHeight <= 100_000;
    case 'html-editor-live-style-applied':
    case 'html-editor-live-style-rejected':
    case 'html-editor-live-structure-applied':
    case 'html-editor-live-structure-rejected':
      return hasOnlyKeys(value, ['type', 'generation', 'mutationId', 'revision'])
        && consumeString(value.mutationId, budget, 128)
        && /^[a-z0-9][a-z0-9:._-]*$/i.test(value.mutationId)
        && consumeRevision(value.revision, budget);
    case 'html-editor-code-component-applied':
    case 'html-editor-code-component-rejected':
      return hasOnlyKeys(value, ['type', 'generation', 'instanceId', 'revision'])
        && consumeString(value.instanceId, budget, 256)
        && /^[a-z0-9][a-z0-9:._-]*$/i.test(value.instanceId)
        && consumeRevision(value.revision, budget);
    case 'html-editor-interaction-duration':
      return hasOnlyKeys(value, [
        'type',
        'generation',
        'interactionId',
        'signature',
        'duration',
      ])
        && consumeString(value.interactionId, budget, 2048)
        && consumeString(value.signature, budget, 256 * 1024)
        && consumeNumber(value.duration, budget)
        && value.duration >= 0
        && value.duration <= 86_400;
    case 'html-editor-interaction-control-applied':
      return hasOnlyKeys(value, ['type', 'generation', 'timelineSequence'])
        && consumeRevision(value.timelineSequence, budget)
        && value.timelineSequence >= 1;
    case 'html-editor-selection': {
      if (!hasOnlyKeys(value, [
        'type',
        'generation',
        'breakpointId',
        'payload',
        'selectedPaths',
        'origin',
        'revision',
        'selectionSequence',
        'detail',
      ])) return false;
      if (!consumeString(value.breakpointId, budget, 128) || !value.breakpointId) return false;
      if (!consumeRevision(value.revision, budget)) return false;
      if (
        value.origin !== undefined
        && value.origin !== 'canvas'
        && value.origin !== 'editor'
      ) return false;
      if (
        value.selectionSequence !== undefined
        && (!consumeRevision(value.selectionSequence, budget) || value.selectionSequence < 1)
      ) return false;
      if (
        value.detail !== undefined
        && value.detail !== 'identity'
        && value.detail !== 'computed'
      ) return false;
      if ((value.selectionSequence === undefined) !== (value.detail === undefined)) return false;
      if (value.payload !== null && !consumeSelectionSnapshot(value.payload, budget)) return false;
      if (!consumeSelectedPaths(value.selectedPaths, budget)) return false;
      return value.payload === null
        ? value.selectedPaths.length === 0
        : value.selectedPaths.includes(value.payload.path);
    }
    case 'html-editor-context-menu':
      return hasOnlyKeys(value, ['type', 'generation', 'path', 'x', 'y'])
        && consumePath(value.path, budget)
        && consumeNumber(value.x, budget)
        && consumeNumber(value.y, budget);
    case 'html-editor-edit-component':
      return hasOnlyKeys(value, ['type', 'generation', 'path'])
        && consumePath(value.path, budget);
    case 'html-editor-edit-code-component':
      return hasOnlyKeys(value, [
        'type',
        'generation',
        'path',
        'instanceId',
        'componentId',
        'componentVersion',
      ])
        && consumePath(value.path, budget)
        && consumeString(value.instanceId, budget, 256)
        && Boolean(value.instanceId)
        && consumeString(value.componentId, budget, 256)
        && Boolean(value.componentId)
        && consumeString(value.componentVersion, budget, 128)
        && Boolean(value.componentVersion);
    case 'html-editor-infinite-canvas-wheel':
      return hasOnlyKeys(value, ['type', 'generation', 'deltaX', 'deltaY', 'zoom', 'pan', 'x', 'y'])
        && consumeNumber(value.deltaX, budget)
        && consumeNumber(value.deltaY, budget)
        && consumeOptionalBoolean(value.zoom, budget)
        && consumeOptionalBoolean(value.pan, budget)
        && (value.x === undefined || consumeNumber(value.x, budget))
        && (value.y === undefined || consumeNumber(value.y, budget));
    case 'html-editor-infinite-canvas-space':
      return hasOnlyKeys(value, ['type', 'generation', 'pressed'])
        && consumeBoolean(value.pressed, budget);
    case 'html-editor-infinite-canvas-height':
      return hasOnlyKeys(value, ['type', 'generation', 'height'])
        && consumeNumber(value.height, budget)
        && value.height >= 1
        && value.height <= 1_000_000;
    case 'html-editor-viewport-height-simulation':
      return hasOnlyKeys(value, ['type', 'generation', 'path', 'height'])
        && consumePath(value.path, budget)
        && consumeNumber(value.height, budget)
        && value.height >= 240
        && value.height <= 10_000;
    case 'html-editor-scroll-state':
      return hasOnlyKeys(value, ['type', 'generation', 'key', 'x', 'y'])
        && (value.key === '__document__' || consumePath(value.key, budget))
        && consumeNumber(value.x, budget)
        && consumeNumber(value.y, budget);
    case 'html-editor-scroll-checkpoint':
      return hasOnlyKeys(value, ['type', 'generation', 'requestId'])
        && consumeString(value.requestId, budget, 128)
        && /^canonical-scroll:\d+$/.test(value.requestId);
    case 'html-editor-command':
      return hasOnlyKeys(value, ['type', 'generation', 'command'])
        && consumeString(value.command, budget, 64)
        && [
          'undo',
          'redo',
          'copy-selection',
          'paste-selection',
          'copy-selection-styles',
          'paste-selection-styles',
          'delete-selection',
          'duplicate-selection',
          'move-selection-up',
          'move-selection-down',
          'move-selection-first',
          'move-selection-last',
          'open-insert',
        ].includes(value.command);
    case 'html-editor-svg-paste':
      return hasOnlyKeys(value, ['type', 'generation', 'svg', 'targetPath'])
        && consumeString(value.svg, budget, MAX_CLIPBOARD_SVG_LENGTH)
        && consumePath(value.targetPath, budget);
    case 'html-editor-figma-paste':
      // The versioned Figma package embeds assets. Only these two clipboard
      // flavors use the importer's larger budget; SVGs and all other canvas
      // messages retain their existing limits and freshness checks.
      return hasOnlyKeys(value, ['type', 'generation', 'text', 'html', 'targetPath'])
        && consumePath(value.targetPath, budget)
        && typeof value.text === 'string'
        && typeof value.html === 'string'
        && value.text.length + value.html.length <= MAX_FIGMA_CLIPBOARD_CHARACTERS
        && (value.text.includes('__kodety_figma__') || value.html.includes('__kodety_figma__'));
    case 'html-editor-link':
      if (!hasOnlyKeys(value, [
        'type',
        'generation',
        'href',
        'disposition',
        'trusted',
        'requestId',
        'download',
      ])) return false;
      if (!consumeString(value.href, budget, 16 * 1024)) return false;
      if (!consumeBoolean(value.trusted, budget)) return false;
      if (
        value.disposition !== 'self'
        && value.disposition !== 'new-context'
        && value.disposition !== 'download'
      ) return false;
      if (value.requestId !== undefined && (
        !consumeString(value.requestId, budget, 128)
        || !/^preview-link-\d+-[a-z0-9]+$/i.test(value.requestId)
      )) return false;
      if (value.download !== undefined && !consumeString(value.download, budget, 1024)) return false;
      if (value.disposition === 'self') {
        return value.requestId === undefined && value.download === undefined;
      }
      if (value.disposition === 'new-context') {
        return value.requestId !== undefined && value.download === undefined;
      }
      return value.requestId === undefined && value.download !== undefined;
    case 'html-editor-text-range':
      return hasOnlyKeys(value, ['type', 'generation', 'path', 'active'])
        && consumePath(value.path, budget)
        && consumeBoolean(value.active, budget);
    case 'html-editor-text-change':
      return hasOnlyKeys(value, ['type', 'generation', 'path', 'value', 'html', 'rangeStyle'])
        && consumePath(value.path, budget)
        && consumeString(value.value, budget, 256 * 1024)
        && (value.html === undefined || consumeString(value.html, budget, 256 * 1024))
        && (value.rangeStyle === undefined || consumeBoolean(value.rangeStyle, budget));
    case 'html-editor-insert-drop':
      return hasOnlyKeys(value, ['type', 'generation', 'key', 'targetPath', 'position'])
        && consumeString(value.key, budget, 512)
        && consumePath(value.targetPath, budget)
        && consumePosition(value.position);
    case 'html-editor-draw-insert':
      return hasOnlyKeys(value, [
        'type',
        'generation',
        'key',
        'targetPath',
        'position',
        'width',
        'height',
      ])
        && consumeString(value.key, budget, 32)
        && ['frame', 'stack', 'grid', 'masonry', 'image', 'video', 'text-block'].includes(value.key)
        && consumePath(value.targetPath, budget)
        && consumePosition(value.position)
        && consumeNumber(value.width, budget)
        && consumeNumber(value.height, budget)
        && value.width >= 8
        && value.width <= 10_000
        && value.height >= 8
        && value.height <= 10_000;
    case 'html-editor-canvas-tool-cancel':
      return hasOnlyKeys(value, ['type', 'generation']);
    case 'html-editor-canvas-tool-request':
      return hasOnlyKeys(value, ['type', 'generation', 'tool'])
        && consumeString(value.tool, budget, 32)
        && ['select', 'frame', 'stack', 'grid', 'masonry', 'image', 'video', 'text-block'].includes(value.tool);
    case 'html-editor-direct-style-preview':
      if (
        !hasOnlyKeys(value, ['type', 'generation', 'breakpointId', 'path', 'values'])
        || !consumeString(value.breakpointId, budget, 128)
        || !value.breakpointId
        || !consumePath(value.path, budget)
        || !consumeStringRecord(value.values, budget, 16, 64, 64)
      ) return false;
      return Object.entries(value.values).every(([property, propertyValue]) => {
        if (!DIRECT_STYLE_PREVIEW_PROPERTIES.has(property)) return false;
        if (property === 'rotate') {
          return /^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})deg$/.test(propertyValue)
            && Math.abs(Number(propertyValue.slice(0, -3))) <= 36_000;
        }
        if (property === 'border-style') {
          return /^(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(propertyValue);
        }
        const positioning = DIRECT_POSITION_PROPERTIES.has(property);
        return (positioning
          ? /^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})px$/.test(propertyValue)
          : /^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})px$/.test(propertyValue))
          && (positioning
            ? Math.abs(Number(propertyValue.slice(0, -2))) <= 100_000
            : Number(propertyValue.slice(0, -2)) <= 10_000);
      });
    case 'html-editor-direct-style': {
      if (!hasOnlyKeys(value, [
        'type',
        'generation',
        'breakpointId',
        'path',
        'property',
        'sourceProperty',
        'value',
        'ensureBorder',
        'startPx',
        'valuePx',
        'gestureId',
      ])) return false;
      if (!consumeString(value.breakpointId, budget, 128) || !value.breakpointId) return false;
      if (!consumePath(value.path, budget)) return false;
      if (!consumeString(value.property, budget, 64) || !DIRECT_STYLE_PROPERTIES.has(value.property)) return false;
      if (
        value.sourceProperty !== undefined
        && (!consumeString(value.sourceProperty, budget, 64) || !DIRECT_STYLE_PROPERTIES.has(value.sourceProperty))
      ) return false;
      if (!consumeString(value.value, budget, 64)) return false;
      if (
        value.gestureId !== undefined
        && (
          !consumeString(value.gestureId, budget, 128)
          || !/^direct:\d+$/.test(value.gestureId)
        )
      ) return false;
      const rotating = value.property === 'rotate';
      const positioning = DIRECT_POSITION_PROPERTIES.has(value.property);
      if (
        rotating
          ? !/^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})deg$/.test(value.value)
          : positioning
            ? !/^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})px$/.test(value.value)
            : !/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})px$/.test(value.value)
      ) return false;
      if (!consumeOptionalBoolean(value.ensureBorder, budget)) return false;
      if (value.ensureBorder && value.property !== 'border-width') return false;
      if (rotating && (value.startPx !== undefined || value.valuePx !== undefined)) return false;
      if (!consumeOptionalSpatialNumber(value.startPx, budget, 100_000, positioning ? -100_000 : 0)) return false;
      if (!consumeOptionalSpatialNumber(value.valuePx, budget, positioning ? 100_000 : 10_000, positioning ? -100_000 : 0)) return false;
      if ((value.startPx === undefined) !== (value.valuePx === undefined)) return false;
      const parsedValue = Number(value.value.slice(0, rotating ? -3 : -2));
      if (
        !Number.isFinite(parsedValue)
        || (rotating
          ? Math.abs(parsedValue) > 36_000
          : positioning
            ? Math.abs(parsedValue) > 100_000
            : parsedValue < 0 || parsedValue > 10_000)
      ) return false;
      const measuredValuePx = typeof value.valuePx === 'number' ? value.valuePx : undefined;
      return measuredValuePx === undefined
        || Math.abs(parsedValue - measuredValuePx) < 0.001;
    }
    case 'html-editor-direct-style-batch': {
      if (!hasOnlyKeys(value, [
        'type',
        'generation',
        'breakpointId',
        'path',
        'styles',
        'gestureId',
      ])) return false;
      if (!consumeString(value.breakpointId, budget, 128) || !value.breakpointId) return false;
      if (!consumePath(value.path, budget)) return false;
      if (
        !consumeString(value.gestureId, budget, 128)
        || !/^direct:\d+$/.test(value.gestureId)
        || !Array.isArray(value.styles)
        || value.styles.length < 1
        || value.styles.length > 4
      ) return false;
      const properties = new Set<string>();
      return value.styles.every(style => {
        if (!isRecord(style) || !hasOnlyKeys(style, [
          'property',
          'sourceProperty',
          'value',
          'startPx',
          'valuePx',
        ])) return false;
        if (
          !consumeString(style.property, budget, 64)
          || !DIRECT_POSITION_PROPERTIES.has(style.property)
          || properties.has(style.property)
        ) return false;
        properties.add(style.property);
        if (
          style.sourceProperty !== undefined
          && (
            !consumeString(style.sourceProperty, budget, 64)
            || !DIRECT_POSITION_PROPERTIES.has(style.sourceProperty)
          )
        ) return false;
        if (
          !consumeString(style.value, budget, 64)
          || !/^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})px$/.test(style.value)
          || !consumeOptionalSpatialNumber(style.startPx, budget, 100_000, -100_000)
          || !consumeOptionalSpatialNumber(style.valuePx, budget, 100_000, -100_000)
          || typeof style.startPx !== 'number'
          || typeof style.valuePx !== 'number'
          || Math.abs(Number(style.value.slice(0, -2))) > 100_000
          || Math.abs(Number(style.value.slice(0, -2)) - style.valuePx) >= 0.001
        ) return false;
        return true;
      });
    }
    case 'html-editor-move-element':
      return hasOnlyKeys(value, ['type', 'generation', 'sourcePath', 'targetPath', 'position'])
        && consumePath(value.sourcePath, budget)
        && consumePath(value.targetPath, budget)
        && consumePosition(value.position);
    default:
      return false;
  }
}

export function createCanvasGeneration() {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return randomUuid();
  return `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function withCanvasGeneration<T extends Record<string, unknown>>(
  generation: string,
  message: T,
): T & CanvasGeneration {
  return { ...message, generation };
}

/**
 * A freshly parsed srcdoc already contains every mutation at or below its
 * project revision. Only newer mutations need replay; this prevents an old
 * queued patch from overwriting a newer canonical rebuild.
 */
export function reconcileCanvasRevisionMutations<T extends CanvasRevisionMutation>(
  mutations: readonly T[],
  canvasRevision: number,
) {
  const revision = Number.isSafeInteger(canvasRevision) && canvasRevision >= 0
    ? canvasRevision
    : 0;
  return {
    included: mutations.filter(mutation => mutation.revision <= revision),
    replay: mutations.filter(mutation => mutation.revision > revision),
  };
}
