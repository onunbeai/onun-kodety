import { create } from 'zustand';

export interface KodetyUpdateStatus {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  checkedAt: string;
  releasedAt?: string;
}

export interface KodetyUpdateClientConfig extends KodetyUpdateStatus {
  pageUrl: string;
  statusUrl: string;
  checkUrl: string;
}

interface KodetyUpdateStore extends KodetyUpdateStatus {
  config: KodetyUpdateClientConfig | null;
  nonce: string;
  checking: boolean;
  error: string;
  configure: (config: KodetyUpdateClientConfig, nonce: string) => void;
  checkForUpdates: () => Promise<KodetyUpdateStatus>;
}

function statusFromConfig(config: KodetyUpdateClientConfig): KodetyUpdateStatus {
  return {
    currentVersion: config.currentVersion,
    latestVersion: config.latestVersion,
    updateAvailable: config.updateAvailable,
    checkedAt: config.checkedAt,
    releasedAt: config.releasedAt,
  };
}

function normalizeStatus(payload: unknown, fallback: KodetyUpdateStatus): KodetyUpdateStatus {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  return {
    currentVersion: typeof value.currentVersion === 'string' ? value.currentVersion : fallback.currentVersion,
    latestVersion: typeof value.latestVersion === 'string' ? value.latestVersion : fallback.latestVersion,
    updateAvailable: value.updateAvailable === true,
    checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : fallback.checkedAt,
    releasedAt: typeof value.releasedAt === 'string' ? value.releasedAt : fallback.releasedAt,
  };
}

export const useKodetyUpdateStore = create<KodetyUpdateStore>((set, get) => ({
  currentVersion: '',
  latestVersion: '',
  updateAvailable: false,
  checkedAt: '',
  releasedAt: '',
  config: null,
  nonce: '',
  checking: false,
  error: '',
  configure: (config, nonce) => {
    const current = get();
    if (current.config?.checkUrl === config.checkUrl && current.nonce === nonce) return;
    set({
      ...statusFromConfig(config),
      config,
      nonce,
      error: '',
    });
  },
  checkForUpdates: async () => {
    const current = get();
    if (current.checking) return {
      currentVersion: current.currentVersion,
      latestVersion: current.latestVersion,
      updateAvailable: current.updateAvailable,
      checkedAt: current.checkedAt,
      releasedAt: current.releasedAt,
    };
    if (!current.config?.checkUrl) throw new Error('Canal de atualizações indisponível.');
    set({ checking: true, error: '' });
    try {
      const response = await fetch(current.config.checkUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-WP-Nonce': current.nonce,
        },
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new Error(typeof payload?.message === 'string' ? payload.message : 'Não foi possível buscar atualizações.');
      }
      const status = normalizeStatus(payload, current);
      set({ ...status, checking: false, error: '' });
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível buscar atualizações.';
      set({ checking: false, error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },
}));
