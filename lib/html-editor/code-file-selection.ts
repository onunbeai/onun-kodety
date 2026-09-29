import type { HtmlProject } from './types';

function isTextFile(project: HtmlProject, path: string | null | undefined) {
  return Boolean(path && project.files[path]?.text !== undefined);
}

/**
 * Resolve the file opened by the global Code command.
 *
 * The remembered path can outlive an asset replacement or point at a binary
 * selected through Assets. A global editor command must never inherit that
 * invalid state: keep a valid remembered text file, otherwise prefer the
 * project's main document and finally the first deterministic text file.
 */
export function resolveGlobalCodeEditorPath(
  project: HtmlProject | null | undefined,
  rememberedPath: string | null | undefined,
) {
  if (!project) return '';
  if (isTextFile(project, rememberedPath)) return rememberedPath || '';
  if (isTextFile(project, project.mainHtmlPath)) return project.mainHtmlPath;
  return Object.values(project.files)
    .filter(file => file.text !== undefined && !file.path.startsWith('.incode/'))
    .sort((left, right) => left.path.localeCompare(right.path))[0]?.path || '';
}
