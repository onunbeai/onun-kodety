import type { KodetyWordPressEntryConfig } from '@/Wordpress/editor/wordpress-entry-config';
import type { OnboardingTourId } from './onboarding-tours';

/** SPA hosts advertise real areas and guarded navigation without fabricating
 * WordPress routes or endpoints. The shared guide owns the same tour UI. */
export interface BuilderOnboardingWorkspace {
  id: string;
  currentArea: OnboardingTourId;
  enabledAreas: readonly OnboardingTourId[];
  onNavigate(area: OnboardingTourId): Promise<boolean>;
}

/** A licensed route alone does not mean the private extension is installed. */
export function onboardingAreaEnabled(area: OnboardingTourId, config?: KodetyWordPressEntryConfig, workspace?: Pick<BuilderOnboardingWorkspace, 'enabledAreas'>): boolean {
  if (workspace) return workspace.enabledAreas.includes(area);
  if (area === 'members' || area === 'templates') return false;
  if (area === 'localization') return Boolean(config?.localizationUrl && config.localizationEntryUrl);
  return true;
}

export function onboardingAreaUrl(area: OnboardingTourId, config?: KodetyWordPressEntryConfig): string | undefined {
  if (!config || !onboardingAreaEnabled(area, config)) return undefined;
  return ({ design: config.editorUrl, cms: config.cmsItemsUrl ? config.cmsUrl : undefined,
    settings: config.settingsUrl, analytics: config.canViewAnalytics ? config.analyticsUrl : undefined,
    localization: config.localizationUrl, members: undefined, templates: undefined })[area];
}

/** Match configured workspaces, including installations in a subdirectory. */
export function onboardingAreaForDestination(href: string, config: KodetyWordPressEntryConfig | undefined, currentUrl: string): OnboardingTourId | null {
  try {
    const destination = new URL(href, currentUrl);
    if (destination.origin !== new URL(currentUrl).origin) return null;
    const areas: OnboardingTourId[] = ['design', 'cms', 'settings', 'analytics', 'localization'];
    return areas.find(area => {
      const raw = onboardingAreaUrl(area, config);
      if (!raw) return false;
      const route = new URL(raw, currentUrl);
      return route.origin === destination.origin
        && route.pathname.replace(/\/+$/, '') === destination.pathname.replace(/\/+$/, '')
        && [...route.searchParams].every(([key, value]) => key === 'kodety_editor_handoff' || destination.searchParams.getAll(key).includes(value));
    }) || null;
  } catch {
    return null;
  }
}
