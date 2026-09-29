import type { StudioProject } from './project-library';
import { readHtmlDirectoryStorageMode } from './html-directory';

/** A persisted HTML directory identifies its storage even when an older catalog
 * omitted mode. Never launch a remote WordPress runtime to remove that binding. */
export async function projectForDeletion(project: StudioProject): Promise<StudioProject> {
  if (project.mode === 'html') return project;
  const storageMode = await readHtmlDirectoryStorageMode(project.id);
  return storageMode ? { ...project, mode: 'html', storageMode } : project;
}
