import {
  KODETY_PHP_VERSION,
  KODETY_PLUGIN_VERSION,
  KODETY_WORDPRESS_VERSION,
} from './product-versions';
import type { SupportedPHPVersion } from '@wp-playground/client';

export type KodetyStudioProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  initialized: boolean;
  phpVersion: SupportedPHPVersion;
  wordpressVersion: string;
  kodetyVersion: string;
  wordpressLocale: WordPressLocale;
  runtimeRevision: number;
  /** Compact 320×240 first-fold capture generated locally after Publish. */
  thumbnailDataUrl?: string;
  thumbnailUpdatedAt?: number;
};

const STORAGE_KEY = 'kodetyStudioProjectsV1';
const PREFERENCES_KEY = 'kodetyStudioPreferencesV1';

export type StudioLanguage = 'pt' | 'en';
export type WordPressLocale = 'pt_BR' | 'en_US';

export type KodetyStudioPreferences = {
  language: StudioLanguage;
  onboardingVersion: number;
};

export const STUDIO_ONBOARDING_VERSION = 1;
export const KODETY_STUDIO_RUNTIME_REVISION = 14;

export function wordpressLocaleForLanguage(language: StudioLanguage): WordPressLocale {
  return language === 'en' ? 'en_US' : 'pt_BR';
}

function isProject(value: unknown): value is KodetyStudioProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<KodetyStudioProject>;
  return (
    typeof project.id === 'string' &&
    /^[a-z0-9-]{8,80}$/i.test(project.id) &&
    typeof project.name === 'string' &&
    typeof project.createdAt === 'number' &&
    typeof project.updatedAt === 'number' &&
    typeof project.initialized === 'boolean'
  );
}

function normalizeProjects(value: unknown): KodetyStudioProject[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isProject)
    .map(project => {
      const thumbnailDataUrl = typeof project.thumbnailDataUrl === 'string'
        && project.thumbnailDataUrl.length <= 1_100_000
        && /^data:image\/(?:png|jpe?g|webp|avif);base64,[a-z0-9+/=]+$/i.test(project.thumbnailDataUrl)
        ? project.thumbnailDataUrl
        : undefined;
      return ({
      ...project,
      lastOpenedAt: typeof project.lastOpenedAt === 'number' ? project.lastOpenedAt : null,
      phpVersion: typeof project.phpVersion === 'string'
        ? project.phpVersion
        : KODETY_PHP_VERSION,
      wordpressVersion: typeof project.wordpressVersion === 'string'
        ? project.wordpressVersion
        : KODETY_WORDPRESS_VERSION,
      kodetyVersion: typeof project.kodetyVersion === 'string'
        ? project.kodetyVersion
        : KODETY_PLUGIN_VERSION,
      // Projects created before language selection existed were installed in
      // WordPress' native English locale. Preserve that reality during the
      // metadata migration instead of relabelling an existing site as PT-BR.
      wordpressLocale: (project.wordpressLocale === 'pt_BR' ? 'pt_BR' : 'en_US') as WordPressLocale,
      runtimeRevision: typeof project.runtimeRevision === 'number' ? project.runtimeRevision : 0,
      thumbnailDataUrl,
      thumbnailUpdatedAt: thumbnailDataUrl && typeof project.thumbnailUpdatedAt === 'number'
        ? project.thumbnailUpdatedAt
        : undefined,
    });
    })
    .sort((left, right) => (right.lastOpenedAt || right.updatedAt) - (left.lastOpenedAt || left.updatedAt));
}

export async function loadProjects(): Promise<KodetyStudioProject[]> {
  try {
    return normalizeProjects(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export async function saveProjects(projects: KodetyStudioProject[]): Promise<void> {
  const normalized = normalizeProjects(projects);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function loadStudioPreferences(defaultLanguage: StudioLanguage = 'en'): KodetyStudioPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') as Partial<KodetyStudioPreferences>;
    return {
      language: stored.language === 'en' || stored.language === 'pt' ? stored.language : defaultLanguage,
      onboardingVersion: typeof stored.onboardingVersion === 'number' ? stored.onboardingVersion : 0,
    };
  } catch {
    return { language: defaultLanguage, onboardingVersion: 0 };
  }
}

export function saveStudioPreferences(preferences: KodetyStudioPreferences): void {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export function newProject(name: string, wordpressLocale: WordPressLocale): KodetyStudioProject {
  const now = Date.now();
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return {
    id,
    name: name.trim() || 'Projeto sem nome',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    initialized: false,
    phpVersion: KODETY_PHP_VERSION,
    wordpressVersion: KODETY_WORDPRESS_VERSION,
    kodetyVersion: KODETY_PLUGIN_VERSION,
    wordpressLocale,
    runtimeRevision: KODETY_STUDIO_RUNTIME_REVISION,
  };
}

export function projectPathSlug(project: Pick<KodetyStudioProject, 'id' | 'name'>): string {
  const normalized = project.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || `projeto-${project.id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
}

export function opfsPathForProject(projectId: string): string {
  return `kodety-studio/projects/${projectId}`;
}
