import type { HtmlProject } from '../../../lib/html-editor/types';
import { isPublicHtmlPath } from './html-directory';

/** WordPress imports the editable project and builds its own public runtime.
 * Keep source pages, drafts, components and metadata instead of static output. */
export async function createHtmlWordPressZip(project: HtmlProject): Promise<Blob> {
  const { canonicalProjectForTransport, projectToZipBlob } = await import('../../../lib/html-editor/project-io');
  return projectToZipBlob(canonicalProjectForTransport(project));
}

/** Package exactly the same public file graph used by folder/GitHub deployment.
 * The editable archive is separate because it intentionally retains drafts. */
export async function createHtmlSiteZip(compiled: Pick<HtmlProject, 'files'>): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const file of Object.values(compiled.files)) {
    if (!isPublicHtmlPath(file.path)) continue;
    zip.file(file.path, file.text ?? file.data ?? new Uint8Array());
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
}
