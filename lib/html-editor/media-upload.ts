import {
  activeExperimentEditSession,
  experimentPublicEditPath,
} from './experiments';
import { rebaseProducedProjectFiles } from './project-rebase';
import type { HtmlProject } from './types';

export interface CreatedProjectAsset {
  project: HtmlProject;
  storagePath: string;
}

/**
 * Installs an asynchronously produced asset over the newest project snapshot.
 * If another upload claimed the same path meanwhile, the returned public path
 * follows the collision-safe path chosen by the rebase.
 */
export function rebaseUploadedProjectAsset(
  base: HtmlProject,
  created: CreatedProjectAsset,
  latest: HtmlProject,
) {
  const rebased = rebaseProducedProjectFiles(base, created.project, latest);
  const storagePath = rebased.pathMap[created.storagePath] || created.storagePath;
  const session = activeExperimentEditSession(rebased.project);
  const publicPath = session
    ? experimentPublicEditPath(session, storagePath)
    : storagePath;
  return {
    project: rebased.project,
    publicPath,
    storagePath,
  };
}
