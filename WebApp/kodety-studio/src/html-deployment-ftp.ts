import type { HtmlProjectFile } from '../../../lib/html-editor/types';
import { createHtmlSiteZip } from './html-archives';
import { isPublicHtmlPath } from './html-directory';
import { HtmlDeploymentError, validateDeploymentPath, type HtmlDeploymentFile } from './html-deployment-github';

/** Prepare the public site for a manual upload, using the existing site ZIP
 * exporter. FTP uploads do not inherit a provider API's file-count limits. */
export async function createHtmlFtpUpload(input: HtmlDeploymentFile[]): Promise<Blob> {
  const files: Record<string, HtmlProjectFile> = Object.create(null);
  for (const file of input) {
    if (!isPublicHtmlPath(file.path)) continue;
    const path = validateDeploymentPath(file.path);
    if (files[path]) throw new HtmlDeploymentError('duplicate-path', 'Duplicate site file.');
    const content = typeof file.content === 'string' || file.content instanceof Uint8Array ? file.content : new Uint8Array(await file.content.arrayBuffer());
    files[path] = { path, mimeType: 'application/octet-stream', ...(typeof content === 'string' ? { text: content } : { data: content }) };
  }
  if (!files['index.html']) throw new HtmlDeploymentError('direct-index', 'The site needs index.html at its root.');
  return createHtmlSiteZip({ files });
}
