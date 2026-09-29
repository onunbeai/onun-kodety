import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { HtmlProjectSettingsProps } from '@/app/(builder)/kodety/html-editor/components/HtmlProjectSettings';

interface HtmlProjectSettingsState {
  ownerId: string;
  model: HtmlProjectSettingsProps | null;
  section: string | null;
  publish: (ownerId: string, props: HtmlProjectSettingsProps) => void;
  resetOwner: (ownerId: string) => void;
  open: (section: string) => void;
  close: () => void;
  toggle: (section?: string) => void;
  remapPage: (path: string, nextPath: string) => void;
}

const SETTINGS_ACTION_KEYS = [
  'onClose',
  'onNavigate',
  'onSaveSite',
  'onSaveCookieConsent',
  'onSaveCustomCode',
  'onSaveRedirects',
  'onSavePage',
  'onPrepareFontFile',
] as const satisfies ReadonlyArray<keyof HtmlProjectSettingsProps>;

function sameFlatRecord(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
) {
  if (current === next) return true;
  if (!current || !next) return false;
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  return currentKeys.length === nextKeys.length
    && nextKeys.every(key => Object.is(current[key], next[key]));
}

function sameModel(current: HtmlProjectSettingsProps, next: HtmlProjectSettingsProps) {
  const keys = new Set([
    ...Object.keys(current),
    ...Object.keys(next),
  ]) as Set<keyof HtmlProjectSettingsProps>;
  for (const key of keys) {
    const currentValue = current[key];
    const nextValue = next[key];
    if (typeof currentValue === 'function' || typeof nextValue === 'function') {
      if (Boolean(currentValue) !== Boolean(nextValue)) return false;
      continue;
    }
    if (key === 'pageHtmlSources' || key === 'pageTemplates' || key === 'wordpress') {
      if (!sameFlatRecord(
        currentValue as Record<string, unknown> | undefined,
        nextValue as Record<string, unknown> | undefined,
      )) return false;
      continue;
    }
    if (!Object.is(currentValue, nextValue)) return false;
  }
  return true;
}

let activeOwnerId = '';
let activeProps: HtmlProjectSettingsProps | null = null;
type SettingsCallable = (...args: unknown[]) => unknown;
const actionCache = new Map<PropertyKey, SettingsCallable>();

export const htmlProjectSettingsActions = new Proxy({} as HtmlProjectSettingsProps, {
  get: (_target, property) => {
    const cached = actionCache.get(property);
    if (cached) return cached;
    const action: SettingsCallable = (...args) => {
      const candidate = activeProps?.[property as keyof HtmlProjectSettingsProps];
      if (typeof candidate !== 'function') return undefined;
      return (candidate as SettingsCallable)(...args);
    };
    actionCache.set(property, action);
    return action;
  },
});

function createStoredModel(props: HtmlProjectSettingsProps) {
  const model = { ...props } as HtmlProjectSettingsProps;
  const mutableModel = model as unknown as Record<PropertyKey, unknown>;
  const stableActions = htmlProjectSettingsActions as unknown as Record<PropertyKey, unknown>;
  SETTINGS_ACTION_KEYS.forEach(key => {
    if (typeof props[key] === 'function') mutableModel[key] = stableActions[key];
  });
  return model;
}

export const useHtmlProjectSettingsStore = create<HtmlProjectSettingsState>()(
  subscribeWithSelector((set, get) => ({
    ownerId: '',
    model: null,
    section: null,
    publish: (ownerId, props) => {
      activeOwnerId = ownerId;
      activeProps = props;
      const current = get();
      const nextModel = createStoredModel(props);
      if (
        current.ownerId === ownerId
        && current.model
        && sameModel(current.model, nextModel)
      ) return;
      set({ ownerId, model: nextModel });
    },
    resetOwner: ownerId => {
      if (activeOwnerId !== ownerId) return;
      activeOwnerId = '';
      activeProps = null;
      if (get().ownerId !== ownerId) return;
      set({ ownerId: '', model: null });
    },
    open: section => {
      if (get().section === section) return;
      set({ section });
    },
    close: () => {
      if (get().section === null) return;
      set({ section: null });
    },
    toggle: (section = 'general') => {
      set(state => ({ section: state.section ? null : section }));
    },
    remapPage: (path, nextPath) => {
      if (get().section !== path) return;
      set({ section: nextPath });
    },
  })),
);
