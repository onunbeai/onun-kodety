import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { HtmlInspectorProps } from '@/app/(builder)/kodety/html-editor/components/HtmlInspector';

export type HtmlInspectorTab = 'design' | 'settings' | 'interactions';

export interface HtmlInspectorTabRequest {
  tab: HtmlInspectorTab;
  sequence: number;
}

export type HtmlInspectorBridgeProps = Omit<HtmlInspectorProps, 'tabRequest'>;

type HtmlInspectorModelSlice = Partial<HtmlInspectorBridgeProps>;

interface HtmlInspectorModelSlices {
  shared: HtmlInspectorModelSlice;
  design: HtmlInspectorModelSlice;
  settings: HtmlInspectorModelSlice;
  interactions: HtmlInspectorModelSlice;
}

type InspectorSlotName = 'componentControls' | 'membershipControls' | 'componentInteractions';

interface HtmlInspectorSlots {
  componentControls: HtmlInspectorProps['componentControls'];
  membershipControls: HtmlInspectorProps['membershipControls'];
  componentInteractions: HtmlInspectorProps['componentInteractions'];
}

interface HtmlInspectorPanelState {
  ownerId: string;
  modelSlices: HtmlInspectorModelSlices | null;
  activeTab: HtmlInspectorTab;
  tabRequest: HtmlInspectorTabRequest;
  slots: HtmlInspectorSlots;
  publish: (ownerId: string, props: HtmlInspectorBridgeProps) => void;
  resetOwner: (ownerId: string) => void;
  requestTab: (tab: HtmlInspectorTab) => void;
  setActiveTab: (
    next: HtmlInspectorTab | ((current: HtmlInspectorTab) => HtmlInspectorTab),
  ) => void;
}

export const HTML_INSPECTOR_ACTION_KEYS = [
  'onDesignTokensChange',
  'onDesignTokenEdit',
  'onComponentVariablesChange',
  'onManageComponentVariables',
  'onTextChange',
  'onContainerTextChange',
  'onAttributeChange',
  'onAttributesChange',
  'onResetLocaleOverride',
  'onStyleChange',
  'onVisibilityChange',
  'onStylePreview',
  'onStylePreviewCancel',
  'onCopyStyleProperty',
  'onCopyAllStyles',
  'onPasteStyleProperty',
  'onPasteAllStyles',
  'onSourceChange',
  'onSelectPath',
  'onInteractionSourceChange',
  'onSaveAnimation',
  'onRemoveSavedAnimation',
  'onTimelineOpen',
  'onBeginInteractionTargetPick',
  'onOpenEffectsLibrary',
  'onCssContextChange',
  'onRenameClass',
  'onDuplicateClass',
  'onRegisterReusableClass',
  'onChangeTag',
  'onAttachFile',
  'onDetachFile',
  'onCreateAndAttachFile',
  'onPrimaryBreakpointChange',
  'onBreakpointsChange',
  'onSelectBreakpoint',
  'onSelectionStyleChange',
  'onScrollbarChange',
  'onResponsiveApply',
  'onLinkApply',
  'onScrollSectionApply',
  'onMediaAssetSelect',
  'onMediaSourceChange',
  'onMediaUpload',
  'onCmsPreviewChange',
] as const satisfies ReadonlyArray<keyof HtmlInspectorBridgeProps>;

const SLOT_NAMES = new Set<keyof HtmlInspectorBridgeProps>([
  'componentControls',
  'membershipControls',
  'componentInteractions',
]);

// These values are consumed exclusively by one tab. Keeping them in separate
// slices means that background CMS data, interaction presets, or a dormant
// design projection cannot wake the complete 5k-line Inspector while another
// tab is open. Cross-tab inputs (selection/source/read-only, for example) stay
// in the shared slice deliberately.
const DESIGN_MODEL_KEYS = new Set<keyof HtmlInspectorBridgeProps>([
  'selectionCount',
  'keyframeStyles',
  'keyframeLabel',
  'cssFiles',
  'cssContext',
  'cssRuleStyles',
  'displayRestoreState',
  'baseBreakpointStyles',
  'reusableClasses',
  'cssFileOptions',
  'jsFileOptions',
  'primaryBreakpoint',
  'breakpoints',
  'activeBreakpoint',
  'selectionStyles',
  'liveStyleValues',
  'scrollbarStyles',
]);

const SETTINGS_MODEL_KEYS = new Set<keyof HtmlInspectorBridgeProps>([
  'containerLines',
  'htmlComponentInstanceSelected',
  'componentVariableContext',
  'utmProfiles',
  'mediaAssets',
  'currentMediaAssetPath',
  'cmsPreview',
]);

const INTERACTIONS_MODEL_KEYS = new Set<keyof HtmlInspectorBridgeProps>([
  'savedAnimations',
]);

function modelSliceForKey(key: keyof HtmlInspectorBridgeProps): HtmlInspectorTab | 'shared' {
  if (DESIGN_MODEL_KEYS.has(key)) return 'design';
  if (SETTINGS_MODEL_KEYS.has(key)) return 'settings';
  if (INTERACTIONS_MODEL_KEYS.has(key)) return 'interactions';
  return 'shared';
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameValue(current: unknown, next: unknown): boolean {
  if (Object.is(current, next)) return true;
  if (Array.isArray(current) || Array.isArray(next)) {
    return Array.isArray(current)
      && Array.isArray(next)
      && current.length === next.length
      && current.every((value, index) => sameValue(value, next[index]));
  }
  if (!isPlainRecord(current) || !isPlainRecord(next)) return false;
  const currentKeys = Reflect.ownKeys(current);
  const nextKeys = Reflect.ownKeys(next);
  return currentKeys.length === nextKeys.length
    && currentKeys.every(key => Object.hasOwn(next, key) && sameValue(current[key], next[key]));
}

function sameModel(
  current: HtmlInspectorModelSlice,
  next: HtmlInspectorModelSlice,
) {
  const keys = new Set([
    ...Object.keys(current),
    ...Object.keys(next),
  ]) as Set<keyof HtmlInspectorBridgeProps>;

  for (const key of keys) {
    const currentValue = current[key];
    const nextValue = next[key];
    if (SLOT_NAMES.has(key)) {
      if (Boolean(currentValue) !== Boolean(nextValue)) return false;
      continue;
    }
    if (typeof currentValue === 'function' || typeof nextValue === 'function') {
      if (Boolean(currentValue) !== Boolean(nextValue)) return false;
      continue;
    }
    if (!sameValue(currentValue, nextValue)) return false;
  }
  return true;
}

let activeOwnerId = '';
let activeProps: HtmlInspectorBridgeProps | null = null;
let actionScopeGeneration = 0;

type InspectorCallable = (...args: unknown[]) => unknown;
const actionCache = new Map<PropertyKey, InspectorCallable>();
const actionCaptures = new WeakMap<InspectorCallable, () => InspectorCallable>();

function styleActionScope(props: HtmlInspectorBridgeProps | null) {
  if (!props) return '';
  return JSON.stringify([
    activeOwnerId, props.styleEditScopeKey, props.currentPage, props.selection?.path,
    props.selectionCount, props.cssContext, props.activeBreakpoint,
    props.localeEditing?.code, props.keyframeLabel, props.readOnly,
  ]);
}

/** Resolve live facades once at gesture start, and reject work after a scope switch. */
export function captureHtmlInspectorAction<T>(action: T): T {
  if (typeof action !== 'function') return action;
  return (actionCaptures.get(action as InspectorCallable)?.() || action) as T;
}

/**
 * Stable action facade used by the memoized panel. The bridge refreshes the
 * live callbacks after every parent commit without notifying React subscribers.
 */
export const htmlInspectorActions = new Proxy({} as HtmlInspectorBridgeProps, {
  get: (_target, property) => {
    const cached = actionCache.get(property);
    if (cached) return cached;
    const action: InspectorCallable = (...args) => {
      const candidate = activeProps?.[property as keyof HtmlInspectorBridgeProps];
      if (typeof candidate !== 'function') return undefined;
      return (candidate as InspectorCallable)(...args);
    };
    actionCaptures.set(action, () => {
      const scope = styleActionScope(activeProps);
      const generation = actionScopeGeneration;
      const candidate = activeProps?.[property as keyof HtmlInspectorBridgeProps];
      return (...args) => {
        if (!scope || generation !== actionScopeGeneration || scope !== styleActionScope(activeProps) || typeof candidate !== 'function') return undefined;
        return (candidate as InspectorCallable)(...args);
      };
    });
    actionCache.set(property, action);
    return action;
  },
});

function createStoredModel(props: HtmlInspectorBridgeProps) {
  const model = { ...props } as HtmlInspectorBridgeProps & Record<PropertyKey, unknown>;
  const mutableModel = model as Record<PropertyKey, unknown>;
  const stableActions = htmlInspectorActions as unknown as Record<PropertyKey, unknown>;
  HTML_INSPECTOR_ACTION_KEYS.forEach(key => {
    if (typeof props[key] === 'function') mutableModel[key] = stableActions[key];
  });
  // Heavy React subtrees have their own subscribers. The root model only
  // retains their presence so an unrelated parent render cannot wake the
  // complete inspector or keep an obsolete element tree alive.
  model.componentControls = props.componentControls ? true : undefined;
  model.membershipControls = props.membershipControls ? true : undefined;
  model.componentInteractions = props.componentInteractions ? true : undefined;
  return model;
}

function createModelSlices(props: HtmlInspectorBridgeProps): HtmlInspectorModelSlices {
  const storedModel = createStoredModel(props);
  const slices: HtmlInspectorModelSlices = {
    shared: {},
    design: {},
    settings: {},
    interactions: {},
  };
  (Object.keys(storedModel) as Array<keyof HtmlInspectorBridgeProps>).forEach(key => {
    const slice = modelSliceForKey(key);
    slices[slice][key] = storedModel[key] as never;
  });
  return slices;
}

function preserveEquivalentSlices(
  current: HtmlInspectorModelSlices | null,
  next: HtmlInspectorModelSlices,
): HtmlInspectorModelSlices {
  if (!current) return next;
  return {
    shared: sameModel(current.shared, next.shared) ? current.shared : next.shared,
    design: sameModel(current.design, next.design) ? current.design : next.design,
    settings: sameModel(current.settings, next.settings) ? current.settings : next.settings,
    interactions: sameModel(current.interactions, next.interactions)
      ? current.interactions
      : next.interactions,
  };
}

export function materializeHtmlInspectorModel(
  slices: HtmlInspectorModelSlices,
): HtmlInspectorBridgeProps {
  return {
    ...slices.shared,
    ...slices.design,
    ...slices.settings,
    ...slices.interactions,
  } as HtmlInspectorBridgeProps;
}

const EMPTY_SLOTS: HtmlInspectorSlots = {
  componentControls: undefined,
  membershipControls: undefined,
  componentInteractions: undefined,
};

export const useHtmlInspectorPanelStore = create<HtmlInspectorPanelState>()(
  subscribeWithSelector((set, get) => ({
    ownerId: '',
    modelSlices: null,
    activeTab: 'design',
    tabRequest: { tab: 'design', sequence: 0 },
    slots: EMPTY_SLOTS,
    publish: (ownerId, props) => {
      const previousScope = styleActionScope(activeProps);
      activeOwnerId = ownerId;
      activeProps = props;
      if (previousScope !== styleActionScope(props)) actionScopeGeneration += 1;

      const current = get();
      const slots: HtmlInspectorSlots = {
        componentControls: props.componentControls,
        membershipControls: props.membershipControls,
        componentInteractions: props.componentInteractions,
      };
      const modelSlices = preserveEquivalentSlices(
        current.modelSlices,
        createModelSlices(props),
      );
      const modelChanged = !current.modelSlices
        || (Object.keys(modelSlices) as Array<keyof HtmlInspectorModelSlices>)
          .some(slice => modelSlices[slice] !== current.modelSlices?.[slice]);
      const slotsChanged = (Object.keys(slots) as InspectorSlotName[])
        .some(slot => !Object.is(current.slots[slot], slots[slot]));
      if (current.ownerId === ownerId && !modelChanged && !slotsChanged) return;

      set({
        ownerId,
        modelSlices: modelChanged ? modelSlices : current.modelSlices,
        slots: slotsChanged ? slots : current.slots,
      });
    },
    resetOwner: ownerId => {
      if (activeOwnerId !== ownerId) return;
      activeOwnerId = '';
      activeProps = null;
      actionScopeGeneration += 1;
      const current = get();
      if (current.ownerId !== ownerId) return;
      set({ ownerId: '', modelSlices: null, activeTab: 'design', slots: EMPTY_SLOTS });
    },
    requestTab: tab => {
      set(state => ({
        activeTab: tab,
        tabRequest: {
          tab,
          sequence: state.tabRequest.sequence + 1,
        },
      }));
    },
    setActiveTab: next => {
      set(state => {
        const activeTab = typeof next === 'function' ? next(state.activeTab) : next;
        return activeTab === state.activeTab ? state : { activeTab };
      });
    },
  })),
);
