import { canonicalProjectForTransport } from '../../../lib/html-editor/project-io';
import { applyStaticLicenseOutput, assertStaticLicensePublication, staticLicenseHas, staticLicenseSource, type StaticLicenseProduct } from '../../../lib/html-editor/static-license';
import { prepareStaticHtmlProject } from '../../../lib/html-editor/static-project';
import type { HtmlProject } from '../../../lib/html-editor/types';

/** Compile portable output with every open-source feature preserved. The
 * historical function name remains compatible with existing exporters. */
export async function prepareHtmlLicenseExport(source: HtmlProject, product: StaticLicenseProduct | undefined, options: { publication?: boolean; language?: 'en' | 'pt' } = {}): Promise<HtmlProject> {
  const canonical = canonicalProjectForTransport(source);
  if (options.publication) assertStaticLicensePublication(canonical, product, options.language);
  const sourceProject = staticLicenseSource(canonical, product);
  let output = prepareStaticHtmlProject(sourceProject);
  if (staticLicenseHas(product, 'socialImageBuilder')) {
    const { prepareHtmlSocialImages } = await import('./html-social-images');
    output = await prepareHtmlSocialImages(output, { sourceProject });
  }
  return applyStaticLicenseOutput(output, product);
}
