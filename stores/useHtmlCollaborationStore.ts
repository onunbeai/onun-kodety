import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface HtmlEditorLockHolder {
  id: string;
  name: string;
  expiresAt: number;
}

export interface HtmlEditorLockPresence {
  mode: 'view' | 'edit';
  limited: boolean;
  lock: HtmlEditorLockHolder;
  workspaceRevision: number;
}

export type HtmlEditorLockStatus =
  | 'idle'
  | 'checking'
  | 'editing'
  | 'viewing'
  | 'conflict'
  | 'reconnecting';

interface HtmlCollaborationState {
  mode: 'view' | 'edit' | null;
  status: HtmlEditorLockStatus;
  error: string;
  limited: boolean;
  lock: HtmlEditorLockHolder;
  workspaceRevision: number;
  setPresence: (presence: HtmlEditorLockPresence) => void;
  setConnectionStatus: (
    status: Extract<HtmlEditorLockStatus, 'checking' | 'reconnecting'>,
    error?: string,
  ) => void;
  resetPresence: () => void;
}

const EMPTY_LOCK: HtmlEditorLockHolder = {
  id: '',
  name: '',
  expiresAt: 0,
};

function sameLock(current: HtmlEditorLockHolder, next: HtmlEditorLockHolder) {
  return (
    current.id === next.id &&
    current.name === next.name &&
    current.expiresAt === next.expiresAt
  );
}

export const useHtmlCollaborationStore = create<HtmlCollaborationState>()(
  subscribeWithSelector((set, get) => ({
    mode: null,
    status: 'idle',
    error: '',
    limited: false,
    lock: EMPTY_LOCK,
    workspaceRevision: 0,
    setPresence: presence => {
      const current = get();
      const next: Partial<HtmlCollaborationState> = {};
      const status: HtmlEditorLockStatus = presence.mode === 'edit'
        ? 'editing'
        : presence.limited
          ? 'conflict'
          : 'viewing';
      if (current.mode !== presence.mode) next.mode = presence.mode;
      if (current.status !== status) next.status = status;
      if (current.error) next.error = '';
      if (current.limited !== presence.limited) next.limited = presence.limited;
      if (!sameLock(current.lock, presence.lock)) next.lock = presence.lock;
      if (current.workspaceRevision !== presence.workspaceRevision) {
        next.workspaceRevision = presence.workspaceRevision;
      }
      if (Object.keys(next).length) set(next);
    },
    setConnectionStatus: (status, error = '') => {
      const current = get();
      const next: Partial<HtmlCollaborationState> = {};
      // A locally unknown/expired lease must fail closed without pretending
      // that the server reported another editor. Only setPresence can publish
      // the server-confirmed `view`/`conflict` modes.
      if (current.mode !== null) next.mode = null;
      if (current.status !== status) next.status = status;
      if (current.error !== error) next.error = error;
      if (current.limited) next.limited = false;
      if (!sameLock(current.lock, EMPTY_LOCK)) next.lock = EMPTY_LOCK;
      if (Object.keys(next).length) set(next);
    },
    resetPresence: () => {
      const current = get();
      if (
        current.mode === null &&
        current.status === 'idle' &&
        !current.error &&
        !current.limited &&
        sameLock(current.lock, EMPTY_LOCK) &&
        current.workspaceRevision === 0
      ) return;
      set({
        mode: null,
        status: 'idle',
        error: '',
        limited: false,
        lock: EMPTY_LOCK,
        workspaceRevision: 0,
      });
    },
  })),
);

export function applyHtmlCollaborationPayload(payload: {
  mode?: 'view' | 'edit';
  limited?: boolean;
  workspaceRevision?: number;
  lock?: {
    holderId?: string;
    holderName?: string;
    expiresAt?: number;
  };
}) {
  useHtmlCollaborationStore.getState().setPresence({
    mode: payload.mode === 'edit' ? 'edit' : 'view',
    limited: Boolean(payload.limited),
    lock: {
      id: String(payload.lock?.holderId || ''),
      name: String(payload.lock?.holderName || ''),
      expiresAt: Math.max(0, Number(payload.lock?.expiresAt) || 0),
    },
    workspaceRevision: Math.max(0, Number(payload.workspaceRevision) || 0),
  });
}
