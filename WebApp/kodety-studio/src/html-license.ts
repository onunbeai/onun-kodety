import { createKodetyProductAccess, type KodetyProductAccess } from '../../../lib/html-editor/product-access';

/** Compatibility API for the open-source editor: no account, key, or network check. */
export interface HtmlLicenseStatus {
  configured: boolean; valid: boolean; status: string; plan: string; keyMask: string;
  expiresAt: string; nextCheckAt: string; graceUntil: string; lastCheckedAt: string;
  isTrial: boolean; trialExpired: boolean;
}
export interface HtmlLicenseSnapshot {
  product: KodetyProductAccess;
  status: HtmlLicenseStatus;
  busy: boolean;
  error: string;
  errorPortuguese: string;
  errorCode: string;
  trial: null;
}
export function htmlLicenseSiteUrl(projectId: string, baseUrl: string): string {
  return new URL(`./html-project/${encodeURIComponent(projectId)}/`, baseUrl).href;
}
export function createHtmlLicenseClient(_projectId: string, _siteUrl: string) {
  const snapshot: HtmlLicenseSnapshot = {
    product: createKodetyProductAccess({ licensed: true, licenseStatus: 'open-source', licensePlan: 'GPL-3.0' }),
    status: {
      configured: false, valid: true, status: 'open-source', plan: 'GPL-3.0', keyMask: '',
      expiresAt: '', nextCheckAt: '', graceUntil: '', lastCheckedAt: '', isTrial: false, trialExpired: false,
    },
    busy: false, error: '', errorPortuguese: '', errorCode: '', trial: null,
  };
  const current = async () => snapshot;
  return {
    getSnapshot: () => snapshot,
    subscribe: (_listener: () => void) => () => undefined,
    load: current, check: current,
    dispose: () => undefined,
  };
}
export type HtmlLicenseClient = ReturnType<typeof createHtmlLicenseClient>;
