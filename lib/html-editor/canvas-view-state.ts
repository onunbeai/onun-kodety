import { normalizeStylePropertyName } from './style-utils';

/**
 * The canvas is a projection of editor state, never a second source of truth.
 *
 * Every visual command is compacted here with latest-write-wins semantics.
 * Mounted frames receive a small monotonic delta; a newly ready/replaced frame
 * receives the complete snapshot and becomes exact in one message.
 */

export interface CanvasViewStylePatch {
  path: string;
  property: string;
  value: string;
  /** Exact CSSOM priority for the authored inline declaration. */
  priority?: '' | 'important';
}

export interface CanvasViewAttributePatch {
  path: string;
  name: string;
  value: string | null;
}

export interface CanvasViewTextPatch {
  path: string;
  value: string;
}

/**
 * Declares which visual rule owns a motion-sensitive property in the canvas.
 *
 * Path ownership is used by transient inline previews. Selector ownership is
 * used by CSS Rule/class edits and deliberately covers every matching runtime
 * clone, not only the element that happened to be selected.
 */
export interface CanvasViewPropertyOwnershipPatch {
  scope: 'path' | 'selector';
  target: string;
  property: string;
  owned: boolean;
  breakpoint?: string;
  pseudo?: string;
}

export interface CanvasViewTransaction {
  cssPath?: string;
  cssText?: string;
  designTokenCssText?: string;
  patches?: CanvasViewStylePatch[];
  attributes?: CanvasViewAttributePatch[];
  texts?: CanvasViewTextPatch[];
  ownerships?: CanvasViewPropertyOwnershipPatch[];
  interactionDocument?: unknown;
}

export interface CanvasViewStateSnapshot {
  protocol: 1;
  kind: 'snapshot';
  epoch: number;
  version: number;
  revision: number;
  stylesheets: Array<{ path: string; cssText: string }>;
  designTokenCssText?: string;
  patches: CanvasViewStylePatch[];
  attributes: CanvasViewAttributePatch[];
  texts: CanvasViewTextPatch[];
  ownerships: CanvasViewPropertyOwnershipPatch[];
  interactionDocument?: unknown;
}

export interface CanvasViewStateDelta {
  protocol: 1;
  kind: 'delta';
  epoch: number;
  version: number;
  revision: number;
  stylesheets: Array<{ path: string; cssText: string }>;
  designTokenCssText?: string;
  patches: CanvasViewStylePatch[];
  attributes: CanvasViewAttributePatch[];
  texts: CanvasViewTextPatch[];
  ownerships: CanvasViewPropertyOwnershipPatch[];
  interactionDocument?: unknown;
}

export type CanvasViewStateProjection =
  | CanvasViewStateSnapshot
  | CanvasViewStateDelta;

export interface CanvasViewStateStore {
  epoch: number;
  version: number;
  revision: number;
  stylesheets: Map<string, string>;
  designTokenCssText: string | undefined;
  patches: Map<string, CanvasViewStylePatch>;
  attributes: Map<string, CanvasViewAttributePatch>;
  texts: Map<string, CanvasViewTextPatch>;
  ownerships: Map<string, CanvasViewPropertyOwnershipPatch>;
  interactionDocument: unknown;
  lastDelta: CanvasViewStateDelta | null;
}

function normalizedStyleKey(patch: CanvasViewStylePatch) {
  return `${patch.path}\u0000${normalizeStylePropertyName(patch.property)}`;
}

function normalizedAttributeKey(patch: CanvasViewAttributePatch) {
  return `${patch.path}\u0000${patch.name.trim().toLowerCase()}`;
}

function normalizedOwnershipKey(patch: CanvasViewPropertyOwnershipPatch) {
  return [
    patch.scope,
    patch.target,
    normalizeStylePropertyName(patch.property),
    patch.breakpoint || 'base',
    patch.pseudo || 'base',
  ].join('\u0000');
}

export function createCanvasViewStateStore(): CanvasViewStateStore {
  return {
    epoch: 1,
    version: 0,
    revision: 0,
    stylesheets: new Map(),
    designTokenCssText: undefined,
    patches: new Map(),
    attributes: new Map(),
    texts: new Map(),
    ownerships: new Map(),
    interactionDocument: undefined,
    lastDelta: null,
  };
}

export function resetCanvasViewState(
  store: CanvasViewStateStore,
  revision = 0,
) {
  store.epoch += 1;
  store.version = 0;
  store.revision = Math.max(0, revision);
  store.stylesheets.clear();
  store.designTokenCssText = undefined;
  store.patches.clear();
  store.attributes.clear();
  store.texts.clear();
  store.ownerships.clear();
  store.interactionDocument = undefined;
  store.lastDelta = null;
}

export function snapshotCanvasViewState(
  store: CanvasViewStateStore,
): CanvasViewStateSnapshot {
  return {
    protocol: 1,
    kind: 'snapshot',
    epoch: store.epoch,
    version: store.version,
    revision: store.revision,
    stylesheets: Array.from(
      store.stylesheets,
      ([path, cssText]) => ({ path, cssText }),
    ),
    ...(store.designTokenCssText !== undefined
      ? { designTokenCssText: store.designTokenCssText }
      : {}),
    patches: Array.from(store.patches.values()),
    attributes: Array.from(store.attributes.values()),
    texts: Array.from(store.texts.values()),
    ownerships: Array.from(store.ownerships.values()),
    ...(store.interactionDocument !== undefined
      ? { interactionDocument: store.interactionDocument }
      : {}),
  };
}

/**
 * Re-addresses the compact live projection after an in-place structural edit.
 * Styles and attributes already painted in the canvas keep following their
 * authored elements instead of forcing a canonical iframe rebuild.
 */
export function remapCanvasViewStatePaths(
  store: CanvasViewStateStore,
  remapPath: (path: string) => string | null,
  revision = store.revision,
) {
  const patches = new Map<string, CanvasViewStylePatch>();
  store.patches.forEach(patch => {
    const path = remapPath(patch.path);
    if (path === null) return;
    const next = { ...patch, path };
    patches.set(normalizedStyleKey(next), next);
  });

  const attributes = new Map<string, CanvasViewAttributePatch>();
  store.attributes.forEach(patch => {
    const path = remapPath(patch.path);
    if (path === null) return;
    const next = { ...patch, path };
    attributes.set(normalizedAttributeKey(next), next);
  });

  const texts = new Map<string, CanvasViewTextPatch>();
  store.texts.forEach(patch => {
    const path = remapPath(patch.path);
    if (path === null) return;
    texts.set(path, { ...patch, path });
  });

  const ownerships = new Map<string, CanvasViewPropertyOwnershipPatch>();
  store.ownerships.forEach(patch => {
    if (patch.scope !== 'path') {
      ownerships.set(normalizedOwnershipKey(patch), patch);
      return;
    }
    const target = remapPath(patch.target);
    if (target === null) return;
    const next = { ...patch, target };
    ownerships.set(normalizedOwnershipKey(next), next);
  });

  store.patches = patches;
  store.attributes = attributes;
  store.texts = texts;
  store.ownerships = ownerships;
  store.version += 1;
  store.revision = Math.max(store.revision, Math.max(0, revision));
  store.lastDelta = null;
}

export function latestCanvasViewStateDelta(
  store: CanvasViewStateStore,
): CanvasViewStateDelta | null {
  const delta = store.lastDelta;
  if (!delta) return null;
  return {
    ...delta,
    stylesheets: delta.stylesheets.map(entry => ({ ...entry })),
    patches: delta.patches.map(patch => ({ ...patch })),
    attributes: delta.attributes.map(patch => ({ ...patch })),
    texts: delta.texts.map(patch => ({ ...patch })),
    ownerships: delta.ownerships.map(patch => ({ ...patch })),
  };
}

export function commitCanvasViewTransaction(
  store: CanvasViewStateStore,
  transaction: CanvasViewTransaction,
  revision: number,
): CanvasViewStateSnapshot {
  store.version += 1;
  store.revision = Math.max(
    store.revision,
    Number.isSafeInteger(revision) ? Math.max(0, revision) : 0,
  );
  const stylesheets: CanvasViewStateDelta['stylesheets'] = [];
  const deltaPatches = new Map<string, CanvasViewStylePatch>();
  const deltaAttributes = new Map<string, CanvasViewAttributePatch>();
  const deltaTexts = new Map<string, CanvasViewTextPatch>();
  const deltaOwnerships = new Map<string, CanvasViewPropertyOwnershipPatch>();
  if (
    typeof transaction.cssPath === 'string'
    && transaction.cssPath
    && typeof transaction.cssText === 'string'
  ) {
    store.stylesheets.delete(transaction.cssPath);
    store.stylesheets.set(transaction.cssPath, transaction.cssText);
    stylesheets.push({
      path: transaction.cssPath,
      cssText: transaction.cssText,
    });
  }
  if (transaction.designTokenCssText !== undefined) {
    store.designTokenCssText = transaction.designTokenCssText;
  }
  (transaction.patches || []).forEach(patch => {
    const property = normalizeStylePropertyName(patch.property);
    if (!patch.path && patch.path !== '' || !property) return;
    const normalized = { ...patch, property };
    const key = normalizedStyleKey(normalized);
    store.patches.delete(key);
    store.patches.set(key, normalized);
    deltaPatches.delete(key);
    deltaPatches.set(key, normalized);
  });
  (transaction.attributes || []).forEach(patch => {
    const name = patch.name.trim().toLowerCase();
    if ((!patch.path && patch.path !== '') || !name) return;
    const normalized = { ...patch, name };
    const key = normalizedAttributeKey(normalized);
    store.attributes.delete(key);
    store.attributes.set(key, normalized);
    deltaAttributes.delete(key);
    deltaAttributes.set(key, normalized);
  });
  (transaction.texts || []).forEach(patch => {
    if (!patch.path && patch.path !== '') return;
    store.texts.delete(patch.path);
    const normalized = { ...patch };
    store.texts.set(patch.path, normalized);
    deltaTexts.delete(patch.path);
    deltaTexts.set(patch.path, normalized);
  });
  (transaction.ownerships || []).forEach(patch => {
    const property = normalizeStylePropertyName(patch.property);
    const target = patch.target.trim();
    if (
      (patch.scope !== 'path' && patch.scope !== 'selector')
      || !target
      || !property
    ) return;
    const normalized = {
      ...patch,
      target,
      property,
      owned: patch.owned === true,
      breakpoint: patch.breakpoint || 'base',
      pseudo: patch.pseudo || 'base',
    };
    const key = normalizedOwnershipKey(normalized);
    if (normalized.owned) {
      store.ownerships.delete(key);
      store.ownerships.set(key, normalized);
    } else {
      store.ownerships.delete(key);
    }
    deltaOwnerships.delete(key);
    deltaOwnerships.set(key, normalized);
  });
  if (transaction.interactionDocument !== undefined) {
    store.interactionDocument = transaction.interactionDocument;
  }
  store.lastDelta = {
    protocol: 1,
    kind: 'delta',
    epoch: store.epoch,
    version: store.version,
    revision: store.revision,
    stylesheets,
    ...(transaction.designTokenCssText !== undefined
      ? { designTokenCssText: transaction.designTokenCssText }
      : {}),
    patches: Array.from(deltaPatches.values()),
    attributes: Array.from(deltaAttributes.values()),
    texts: Array.from(deltaTexts.values()),
    ownerships: Array.from(deltaOwnerships.values()),
    ...(transaction.interactionDocument !== undefined
      ? { interactionDocument: transaction.interactionDocument }
      : {}),
  };
  return snapshotCanvasViewState(store);
}
