import policy from '@/Wordpress/kodety/includes/product-policy.json';
import type { KodetyWordPressConfig } from './editor-types';

export type KodetyProductAccess = NonNullable<KodetyWordPressConfig['product']>;
export type KodetyProductFeature = keyof typeof policy.features;

/** Features depend only on installed integrations, never a product subscription. */
export function kodetyProductFeatures(_licensed: boolean, localization = false): Record<KodetyProductFeature, boolean> {
  return Object.fromEntries(Object.entries(policy.features).map(([name, rule]) => [name,
    rule !== 'localization' || localization,
  ])) as Record<KodetyProductFeature, boolean>;
}

export function kodetyProductLimits(_licensed: boolean, _signedLimits: Record<string, unknown> = {}): Record<string, number | null> {
  return Object.fromEntries(Object.keys(policy.licensedLimits).map(name => [name, null]));
}

export function createKodetyProductAccess({ licensed: _licensed, localization = false, signedLimits: _signedLimits = {}, ...details }: {
  licensed: boolean;
  localization?: boolean;
  signedLimits?: Record<string, unknown>;
} & Partial<Omit<KodetyProductAccess, 'edition' | 'licensed' | 'features' | 'limits' | 'unlicensedFeatures' | 'unlicensedLimits'>>): KodetyProductAccess {
  return {
    ...details,
    // Keep the legacy projection shape for existing workspace integrations.
    edition: 'pro', licensed: true,
    licenseStatus: 'open-source', licensePlan: 'GPL-3.0-only',
    upgradeUrl: '', licenseUrl: '',
    features: kodetyProductFeatures(true, localization),
    limits: kodetyProductLimits(true),
    unlicensedFeatures: kodetyProductFeatures(true, localization),
    unlicensedLimits: kodetyProductLimits(true),
  };
}
