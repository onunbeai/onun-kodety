import type { HtmlProject, HtmlProjectFile } from './types';
import {
  fileToProjectFile,
  materializeLiquidProject,
  prepareShopifyThemeFiles,
} from './project-io';

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.next', '.cache', 'dist-cache']);
const MAX_FILES = 10000;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 768 * 1024 * 1024;

async function readDirectory(
  handle: FileSystemDirectoryHandle,
  prefix: string,
  files: Record<string, HtmlProjectFile>,
  budget: { files: number; bytes: number },
) {
  const iterable = handle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
  for await (const [name, entry] of iterable.entries()) {
    if (entry.kind === 'directory') {
      if (!IGNORED_DIRECTORIES.has(name)) await readDirectory(entry as FileSystemDirectoryHandle, prefix ? `${prefix}/${name}` : name, files, budget);
      continue;
    }
    const path = prefix ? `${prefix}/${name}` : name;
    const file = await (entry as FileSystemFileHandle).getFile();
    budget.files += 1;
    budget.bytes += file.size;
    if (budget.files > MAX_FILES) throw new Error('A pasta possui arquivos demais para ser aberta com segurança no navegador.');
    if (file.size > MAX_FILE_BYTES) throw new Error(`O arquivo “${path}” ultrapassa o limite seguro de 256 MB.`);
    if (budget.bytes > MAX_TOTAL_BYTES) throw new Error('O projeto ultrapassa o limite seguro de 768 MB para edição no navegador.');
    const projectFile = await fileToProjectFile(path, file);
    files[path] = projectFile;
  }
}

export async function importLocalDirectory(handle: FileSystemDirectoryHandle): Promise<HtmlProject> {
  const files: Record<string, HtmlProjectFile> = {};
  await readDirectory(handle, '', files, { files: 0, bytes: 0 });
  const preparedFiles = prepareShopifyThemeFiles(files, handle.name);
  const html = Object.keys(preparedFiles).filter(path => /\.html?$/i.test(path));
  const mainHtmlPath = html.find(path => path.toLowerCase() === 'index.html')
    || html.find(path => path.toLowerCase().endsWith('/index.html'))
    || html.sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!mainHtmlPath) throw new Error('Nenhum arquivo HTML foi encontrado nesta pasta.');
  const rootPath = mainHtmlPath.split('/').slice(0, -1).join('/');
  let name = handle.name;
  try {
    const metadata = JSON.parse(preparedFiles['.incode/project.json']?.text || 'null') as { name?: string } | null;
    if (metadata?.name?.trim()) name = metadata.name.trim();
  } catch {
    // Invalid project metadata remains editable in Code; use the folder name.
  }
  return { name, files: preparedFiles, mainHtmlPath, rootPath, openedAt: Date.now() };
}

export function assertSafeProjectFilePath(path: string): void {
  if (!path || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || path.startsWith('/') || /^[a-z]:/i.test(path)) {
    throw new Error(`Caminho de arquivo inválido: ${path}`);
  }
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new Error(`Caminho de arquivo inválido: ${path}`);
  }
}

async function resolveParentDirectory(root: FileSystemDirectoryHandle, path: string, create = true) {
  const parts = path.split('/');
  parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
  return directory;
}

function sameFile(left: HtmlProjectFile | undefined, right: HtmlProjectFile) {
  if (!left || left.mimeType !== right.mimeType || left.text !== right.text) return false;
  if (left.data === right.data) return true;
  if (!left.data || !right.data || left.data.length !== right.data.length) return false;
  return left.data.every((byte, index) => byte === right.data?.[index]);
}

export async function writeChangedProjectFiles(handle: FileSystemDirectoryHandle, previous: HtmlProject | null, next: HtmlProject) {
  const previousSource = previous ? materializeLiquidProject(previous) : null;
  const nextSource = materializeLiquidProject(next);
  // Validate the complete operation before the first filesystem mutation.
  // File.path and the map key must agree; traversal and VCS internals never
  // belong to an editable project, including imported ZIP content.
  for (const source of [previousSource, nextSource]) {
    if (!source) continue;
    for (const [path, file] of Object.entries(source.files)) {
      assertSafeProjectFilePath(path);
      if (file.path !== path) throw new Error(`Caminho de arquivo inconsistente: ${path}`);
    }
  }
  const changed = Object.values(nextSource.files).filter(file => !sameFile(previousSource?.files[file.path], file));
  for (const file of changed) {
    const parent = await resolveParentDirectory(handle, file.path);
    const fileHandle = await parent.getFileHandle(file.path.split('/').pop() || file.path, { create: true });
    const writable = await fileHandle.createWritable();
    const binary = file.data ? Uint8Array.from(file.data).buffer : new ArrayBuffer(0);
    try {
      await writable.write(file.text ?? binary);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }
  const removed = previousSource
    ? Object.keys(previousSource.files).filter(path => !nextSource.files[path])
    : [];
  for (const path of removed) {
    try {
      const parent = await resolveParentDirectory(handle, path, false);
      await parent.removeEntry(path.split('/').pop() || path);
    }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }
  return { changed: changed.map(file => file.path), removed };
}
