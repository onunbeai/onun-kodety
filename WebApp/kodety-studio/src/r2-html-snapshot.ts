import type { HtmlProject } from '../../../lib/html-editor/types';
import { prepareProjectForDraftTransport, projectToZipBlob } from '../../../lib/html-editor/project-io';
import type { StudioProject } from './project-library';
import { getR2Connection } from './r2-storage';
import { enqueueR2Snapshot, recordR2SyncError } from './r2-project-sync';

const snapshots = new Map<string, Promise<void>>();
/** Invoked only after the original local save has succeeded. Never changes the
 * folder, OPFS binding, editor state or local-save result. */
export function scheduleHtmlR2Snapshot(project: StudioProject, html: HtmlProject): Promise<void> {
  const previous = snapshots.get(project.id) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    if (!await getR2Connection()) return;
    const archive = await projectToZipBlob(prepareProjectForDraftTransport(html));
    await enqueueR2Snapshot(project, archive);
  }).catch(recordR2SyncError);
  snapshots.set(project.id, operation);
  void operation.finally(() => { if (snapshots.get(project.id) === operation) snapshots.delete(project.id); });
  return operation;
}
