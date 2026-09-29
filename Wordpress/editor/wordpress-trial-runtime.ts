export const WORDPRESS_LICENSE_CHANGED = 'kodety:license-changed';

export interface WordPressTrialProduct {
  edition: 'pro';
  licensed: boolean;
  licenseStatus?: string;
  licenseIsTrial?: boolean;
  licenseTrialExpired?: boolean;
  licenseExpiresAt?: string;
  licenseServerTime?: string;
  licenseStatusUrl?: string;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  unlicensedFeatures?: Record<string, boolean>;
  unlicensedLimits?: Record<string, number | null>;
  licenseUrl: string;
  upgradeUrl: string;
}

interface TrialWindow extends Window {
  kodetyWordPress?: { nonce?: string; product?: WordPressTrialProduct };
}

/** Compatibility helpers: the open source edition has no trial clock. */
export function trialRemainingMs(_product: WordPressTrialProduct, _elapsedMs: number): number {
  return Number.POSITIVE_INFINITY;
}

export function expireTrialProduct(product: WordPressTrialProduct): WordPressTrialProduct {
  return {
    ...product,
    licensed: true,
    licenseStatus: 'open-source',
    licenseIsTrial: false,
    licenseTrialExpired: false,
    licenseExpiresAt: '',
    licenseStatusUrl: '',
    licenseUrl: '',
    upgradeUrl: '',
    limits: Object.fromEntries(Object.keys(product.limits).map(key => [key, null])),
  };
}

export function installWordPressTrialRuntime(host: TrialWindow = window as TrialWindow): () => void {
  const config = host.kodetyWordPress;
  if (config?.product) host.kodetyWordPress = { ...config, product: expireTrialProduct(config.product) };
  return () => {};
}
