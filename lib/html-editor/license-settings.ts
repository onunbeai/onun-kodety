import type { KodetyWordPressConfig } from './editor-types';

export interface HtmlLicenseTrial {
  status: 'idle' | 'eligible' | 'waiting_activation' | 'active' | 'expired' | 'not_eligible' | 'pending' | 'unavailable';
  durationSeconds: number;
  expiresAt: string;
}

/** License management supplied by the host; credentials never enter project data. */
export interface HtmlLicenseSettings {
  product: NonNullable<KodetyWordPressConfig['product']>;
  configured: boolean;
  keyMask: string;
  expiresAt?: string;
  busy: boolean;
  error: string;
  errorCode?: string;
  trial?: HtmlLicenseTrial | null;
  trialAuthenticated?: boolean;
  loadTrial?(): Promise<unknown>;
  requestTrial?(): Promise<unknown>;
  signInForTrial?(): Promise<unknown>;
  activate(key: string): Promise<unknown>;
  check(): Promise<unknown>;
  deactivate(): Promise<unknown>;
}
