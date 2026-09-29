import { normalizeCodeComponentRegistry } from './code-components';
import { readEditorMetadata, updateEditorMetadata } from './project-io';
import type { HtmlProject, HtmlProjectFile } from './types';

export class ProjectSessionChangedError extends Error {
  constructor() {
    super('O projeto mudou enquanto a operação estava em andamento. Tente novamente.');
    this.name = 'ProjectSessionChangedError';
  }
}

export class ProjectRebaseConflictError extends Error {
  constructor(path: string) {
    super(`O arquivo ${path} também mudou durante a operação. Nenhuma edição foi sobrescrita.`);
    this.name = 'ProjectRebaseConflictError';
  }
}

function bytesEqual(left?: Uint8Array, right?: Uint8Array) {
  if (left === right) return true;
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function projectFilesEqual(
  left: HtmlProjectFile | undefined,
  right: HtmlProjectFile | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.path === right.path
    && left.mimeType === right.mimeType
    && left.text === right.text
    && bytesEqual(left.data, right.data);
}

export function assertSameProjectSession(base: HtmlProject, current: HtmlProject) {
  if (base.openedAt !== current.openedAt) throw new ProjectSessionChangedError();
}

function availablePath(files: Record<string, HtmlProjectFile>, requestedPath: string) {
  const extensionIndex = requestedPath.lastIndexOf('.');
  const slashIndex = requestedPath.lastIndexOf('/');
  const hasExtension = extensionIndex > slashIndex;
  const stem = hasExtension ? requestedPath.slice(0, extensionIndex) : requestedPath;
  const extension = hasExtension ? requestedPath.slice(extensionIndex) : '';
  let candidate = requestedPath;
  let counter = 2;
  while (files[candidate]) candidate = `${stem}-${counter++}${extension}`;
  return candidate;
}

/**
 * Applies only files produced by an async operation to the newest canonical
 * project. Unrelated files/metadata/page selection always come from `current`.
 * A same-file concurrent edit is rejected instead of being silently replaced.
 */
export function rebaseProducedProjectFiles(
  base: HtmlProject,
  produced: HtmlProject,
  current: HtmlProject,
) {
  assertSameProjectSession(base, current);
  const changedPaths = Object.keys(produced.files).filter(
    path => !projectFilesEqual(base.files[path], produced.files[path]),
  );
  if (!changedPaths.length) {
    return { project: current, pathMap: {} as Record<string, string>, changedPaths };
  }

  const files = { ...current.files };
  const pathMap: Record<string, string> = {};
  changedPaths.forEach(path => {
    const baseFile = base.files[path];
    const producedFile = produced.files[path];
    if (!producedFile) return;
    const currentFile = files[path];

    if (baseFile && !projectFilesEqual(currentFile, baseFile)) {
      if (projectFilesEqual(currentFile, producedFile)) {
        pathMap[path] = path;
        return;
      }
      throw new ProjectRebaseConflictError(path);
    }

    let targetPath = path;
    if (!baseFile && currentFile && !projectFilesEqual(currentFile, producedFile)) {
      targetPath = availablePath(files, path);
    }
    pathMap[path] = targetPath;
    files[targetPath] = targetPath === path
      ? producedFile
      : { ...producedFile, path: targetPath };
  });

  return {
    project: { ...current, files },
    pathMap,
    changedPaths,
  };
}

export function snapshotCodeSources(project: HtmlProject) {
  return Object.fromEntries(
    Object.values(project.files)
      .filter(file => file.text !== undefined && /\.(?:tsx?|jsx?)$/i.test(file.path))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(file => [file.path, file.text || '']),
  );
}

export function codeSourcesMatchSnapshot(
  project: HtmlProject,
  snapshot: Record<string, string>,
) {
  const current = snapshotCodeSources(project);
  const paths = Object.keys(snapshot);
  const currentPaths = Object.keys(current);
  return paths.length === currentPaths.length
    && paths.every(path => current[path] === snapshot[path]);
}

/**
 * A compiler returns a full project because it started from a project snapshot.
 * Only its newly published component version is an output of compilation; merge
 * that version into current metadata and preserve every concurrent edit.
 */
export function rebaseCompiledCodeComponentVersion(
  base: HtmlProject,
  compiled: HtmlProject,
  current: HtmlProject,
  componentId: string,
  componentVersion: string,
) {
  assertSameProjectSession(base, current);
  const compiledRegistry = normalizeCodeComponentRegistry(
    readEditorMetadata(compiled).codeComponents,
  );
  const published = compiledRegistry.components.find(
    component => component.id === componentId && component.version === componentVersion,
  );
  if (!published) return current;

  return updateEditorMetadata(current, metadata => {
    const latest = normalizeCodeComponentRegistry(metadata.codeComponents);
    return {
      ...metadata,
      codeComponents: {
        ...latest,
        components: [
          ...latest.components.filter(
            component => component.id !== componentId || component.version !== componentVersion,
          ),
          published,
        ],
      },
    };
  });
}
