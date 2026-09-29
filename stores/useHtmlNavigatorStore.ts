import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  HtmlNavigatorActivePanel,
  HtmlNavigatorBridgeProps,
  HtmlNavigatorProps,
} from '@/app/(builder)/kodety/html-editor/components/HtmlNavigator';

type HtmlNavigatorModel = Omit<HtmlNavigatorProps, 'activePanel'>;
type HtmlNavigatorModelSlice = Partial<HtmlNavigatorModel>;

interface HtmlNavigatorModelSlices {
  shared: HtmlNavigatorModelSlice;
  layers: HtmlNavigatorModelSlice;
  pages: HtmlNavigatorModelSlice;
  assets: HtmlNavigatorModelSlice;
}

interface HtmlNavigatorState {
  ownerId: string;
  modelSlices: HtmlNavigatorModelSlices | null;
  activePanel: HtmlNavigatorActivePanel;
  publish: (ownerId: string, props: HtmlNavigatorBridgeProps) => void;
  resetOwner: (ownerId: string) => void;
  setActivePanel: (activePanel: HtmlNavigatorActivePanel) => void;
}

export const HTML_NAVIGATOR_ACTION_KEYS = [
  'onSelect',
  'onLocaleChange',
  'onResetLocalePage',
  'onPageSelect',
  'onExperimentVariantSelect',
  'onPageSetHome',
  'onPageSetTemplate',
  'onPageRemoveTemplate',
  'onPageAdd',
  'onPageDuplicate',
  'onPageRename',
  'onPageRemove',
  'onPageSettings',
  'onPageOpenCode',
  'onAssetReplace',
  'onAssetAdd',
  'onAssetRemove',
  'onAssetCompress',
  'onAssetConvert',
  'onToggleLock',
  'onToggleVisibility',
  'onLayerRename',
  'onRemove',
  'onDuplicate',
  'onCopy',
  'onPaste',
  'onCopyStyles',
  'onPasteStyles',
  'onWrap',
  'onUnwrap',
  'onCreateComponent',
  'onEditComponent',
  'onDetachComponent',
  'onMove',
  'onFileOpen',
  'onFileCreate',
  'onFileRename',
  'onFileRemove',
] as const satisfies ReadonlyArray<keyof HtmlNavigatorModel>;

const PRIMITIVE_ARRAY_KEYS = new Set<keyof HtmlNavigatorModel>([
  'selectedPaths',
  'effectiveHiddenPaths',
  'pages',
  'lockedPaths',
  'interactionSelectors',
]);

const LAYERS_MODEL_KEYS = new Set<keyof HtmlNavigatorModel>([
  'nodes',
  'effectiveHiddenPaths',
  'selectedPath',
  'selectedPaths',
  'onSelect',
  'lockedPaths',
  'onToggleLock',
  'onToggleVisibility',
  'onLayerRename',
  'onRemove',
  'onDuplicate',
  'onCopy',
  'onPaste',
  'onCopyStyles',
  'onPasteStyles',
  'onWrap',
  'onUnwrap',
  'onCreateComponent',
  'onEditComponent',
  'onDetachComponent',
  'canPaste',
  'canPasteStyles',
  'onMove',
  'interactionSelectors',
]);

const PAGES_MODEL_KEYS = new Set<keyof HtmlNavigatorModel>([
  'pages',
  'pageExperimentGroups',
  'activePage',
  'homePage',
  'onPageSelect',
  'onExperimentVariantSelect',
  'onPageSetHome',
  'pageTemplateCollections',
  'pageTemplates',
  'onPageSetTemplate',
  'onPageRemoveTemplate',
  'onPageAdd',
  'onPageDuplicate',
  'onPageRename',
  'onPageRemove',
  'onPageSettings',
  'onPageOpenCode',
]);

const ASSETS_MODEL_KEYS = new Set<keyof HtmlNavigatorModel>([
  'assets',
  'onAssetReplace',
  'onAssetAdd',
  'onAssetRemove',
  'imageOptimizationAccess',
  'onAssetCompress',
  'convertibleAssetCount',
  'convertibleAssetBytes',
  'onAssetConvert',
  'assetTree',
  'experimentAssetFolders',
  'activeCodeFile',
  'onFileOpen',
  'onFileCreate',
  'onFileRename',
  'onFileRemove',
]);

function modelSliceForKey(
  key: keyof HtmlNavigatorModel,
): keyof HtmlNavigatorModelSlices {
  if (LAYERS_MODEL_KEYS.has(key)) return 'layers';
  if (PAGES_MODEL_KEYS.has(key)) return 'pages';
  if (ASSETS_MODEL_KEYS.has(key)) return 'assets';
  return 'shared';
}

function sameArray(current: readonly unknown[], next: readonly unknown[]) {
  return current.length === next.length
    && next.every((value, index) => Object.is(current[index], value));
}

function sameFlatRecord(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  if (current === next) return true;
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  return currentKeys.length === nextKeys.length
    && nextKeys.every(key => Object.is(current[key], next[key]));
}

function sameLocales(
  current: HtmlNavigatorProps['locales'],
  next: HtmlNavigatorProps['locales'],
) {
  if (current === next) return true;
  if (!current || !next || current.length !== next.length) return false;
  return next.every((locale, index) => {
    const previous = current[index];
    return previous?.code === locale.code
      && previous.name === locale.name
      && previous.language === locale.language
      && previous.region === locale.region
      && previous.enabled === locale.enabled;
  });
}

function sameTemplateCollections(
  current: HtmlNavigatorProps['pageTemplateCollections'],
  next: HtmlNavigatorProps['pageTemplateCollections'],
) {
  if (current === next) return true;
  if (current.length !== next.length) return false;
  return next.every((collection, index) => {
    const previous = current[index];
    return previous?.slug === collection.slug && previous.name === collection.name;
  });
}

function sameModel(
  current: HtmlNavigatorModelSlice,
  next: HtmlNavigatorModelSlice,
) {
  const keys = new Set([
    ...Object.keys(current),
    ...Object.keys(next),
  ]) as Set<keyof HtmlNavigatorModel>;

  for (const key of keys) {
    const currentValue = current[key];
    const nextValue = next[key];
    if (typeof currentValue === 'function' || typeof nextValue === 'function') {
      if (Boolean(currentValue) !== Boolean(nextValue)) return false;
      continue;
    }
    if (key === 'locales') {
      if (!sameLocales(
        currentValue as HtmlNavigatorProps['locales'],
        nextValue as HtmlNavigatorProps['locales'],
      )) return false;
      continue;
    }
    if (key === 'pageTemplateCollections') {
      if (!sameTemplateCollections(
        currentValue as HtmlNavigatorProps['pageTemplateCollections'],
        nextValue as HtmlNavigatorProps['pageTemplateCollections'],
      )) return false;
      continue;
    }
    if (key === 'pageTemplates') {
      if (!sameFlatRecord(
        currentValue as Record<string, unknown>,
        nextValue as Record<string, unknown>,
      )) return false;
      continue;
    }
    if (
      PRIMITIVE_ARRAY_KEYS.has(key)
      && Array.isArray(currentValue)
      && Array.isArray(nextValue)
    ) {
      if (!sameArray(currentValue, nextValue)) return false;
      continue;
    }
    if (!Object.is(currentValue, nextValue)) return false;
  }
  return true;
}

let activeOwnerId = '';
let activeProps: HtmlNavigatorBridgeProps | null = null;

type NavigatorCallable = (...args: never[]) => unknown;
const actionCache = new Map<PropertyKey, NavigatorCallable>();

/**
 * Stable callback facade for the memoized navigator. Publishing a newer parent
 * render refreshes the callback targets without waking store subscribers.
 */
export const htmlNavigatorActions = new Proxy({} as HtmlNavigatorModel, {
  get: (_target, property) => {
    const cached = actionCache.get(property);
    if (cached) return cached;
    const action: NavigatorCallable = (...args) => {
      const candidate = activeProps?.[property as keyof HtmlNavigatorBridgeProps];
      if (typeof candidate !== 'function') return undefined;
      return (candidate as NavigatorCallable)(...args);
    };
    actionCache.set(property, action);
    return action;
  },
});

function createStoredModel(props: HtmlNavigatorBridgeProps) {
  const { activePanel: _activePanel, ...modelProps } = props;
  const model = modelProps as HtmlNavigatorModel;
  const mutableModel = model as unknown as Record<PropertyKey, unknown>;
  const stableActions = htmlNavigatorActions as unknown as Record<PropertyKey, unknown>;
  HTML_NAVIGATOR_ACTION_KEYS.forEach(key => {
    if (typeof props[key] === 'function') mutableModel[key] = stableActions[key];
  });
  return model;
}

function createModelSlices(
  props: HtmlNavigatorBridgeProps,
): HtmlNavigatorModelSlices {
  const storedModel = createStoredModel(props);
  const slices: HtmlNavigatorModelSlices = {
    shared: {},
    layers: {},
    pages: {},
    assets: {},
  };
  (Object.keys(storedModel) as Array<keyof HtmlNavigatorModel>).forEach(key => {
    const slice = modelSliceForKey(key);
    slices[slice][key] = storedModel[key] as never;
  });
  return slices;
}

function preserveEquivalentSlices(
  current: HtmlNavigatorModelSlices | null,
  next: HtmlNavigatorModelSlices,
): HtmlNavigatorModelSlices {
  if (!current) return next;
  return {
    shared: sameModel(current.shared, next.shared) ? current.shared : next.shared,
    layers: sameModel(current.layers, next.layers) ? current.layers : next.layers,
    pages: sameModel(current.pages, next.pages) ? current.pages : next.pages,
    assets: sameModel(current.assets, next.assets) ? current.assets : next.assets,
  };
}

export function materializeHtmlNavigatorModel(
  slices: HtmlNavigatorModelSlices,
): HtmlNavigatorModel {
  return {
    ...slices.shared,
    ...slices.layers,
    ...slices.pages,
    ...slices.assets,
  } as HtmlNavigatorModel;
}

export const useHtmlNavigatorStore = create<HtmlNavigatorState>()(
  subscribeWithSelector((set, get) => ({
    ownerId: '',
    modelSlices: null,
    activePanel: 'layers',
    publish: (ownerId, props) => {
      activeOwnerId = ownerId;
      activeProps = props;
      const current = get();
      const modelSlices = preserveEquivalentSlices(
        current.modelSlices,
        createModelSlices(props),
      );
      const modelChanged = !current.modelSlices
        || (Object.keys(modelSlices) as Array<keyof HtmlNavigatorModelSlices>)
          .some(slice => modelSlices[slice] !== current.modelSlices?.[slice]);
      // The compatibility prop seeds a new bridge owner only. From then on the
      // rail and the panel share this store as their single source of truth.
      const activePanel = current.ownerId === ownerId
        ? current.activePanel
        : props.activePanel ?? current.activePanel;
      if (
        current.ownerId === ownerId
        && current.activePanel === activePanel
        && !modelChanged
      ) return;
      set({
        ownerId,
        modelSlices: modelChanged ? modelSlices : current.modelSlices,
        activePanel,
      });
    },
    resetOwner: ownerId => {
      if (activeOwnerId !== ownerId) return;
      activeOwnerId = '';
      activeProps = null;
      if (get().ownerId !== ownerId) return;
      // Insert and Variables temporarily replace the Navigator.
      // Its active tab is shell state, not ownership state, so preserve it
      // while clearing the detached bridge model.
      set({ ownerId: '', modelSlices: null });
    },
    setActivePanel: activePanel => {
      if (get().activePanel === activePanel) return;
      set({ activePanel });
    },
  })),
);
