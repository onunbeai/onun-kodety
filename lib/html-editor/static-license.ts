import type { KodetyWordPressConfig } from './editor-types';
import type { HtmlProject } from './types';

/** Historical API names retained for extension compatibility. Onun Kodety has
 * no paid feature restrictions, including its exported HTML. */
export type StaticLicenseProduct = Pick<NonNullable<KodetyWordPressConfig['product']>, 'licensed' | 'features'>;
export function staticLicenseHas(_product: StaticLicenseProduct | undefined, _feature: string): boolean { return true; }
export function stripUnlicensedStaticHtml(html: string): string { return html; }
export function applyStaticLicenseOutput(project: HtmlProject, _product?: StaticLicenseProduct): HtmlProject { return project; }
export function staticLicenseSource(source: HtmlProject, _product?: StaticLicenseProduct): HtmlProject { return source; }
export class StaticLicensePublicationError extends Error {
  constructor(public readonly feature: string, message: string) { super(message); this.name = 'StaticLicensePublicationError'; }
}
export function assertStaticLicensePublication(_source: HtmlProject, _product?: StaticLicenseProduct, _language: 'en' | 'pt' = 'en'): void {}
