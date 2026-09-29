import type { HtmlProject, HtmlProjectFile } from '../../../lib/html-editor/types';

export type HtmlPreviewSnapshot = {
  project: HtmlProject;
  activeExtensions: readonly string[];
  language: 'en' | 'pt';
};
const DATABASE = 'kodety-studio-html-previews-v1';
const STORE = 'snapshots';
const pendingWrites = new Map<string, Promise<void>>();

function assertProjectId(projectId: string): void {
  if (typeof projectId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(projectId)) throw new Error('The HTML preview project identifier is invalid.');
}
function safePath(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string' && ((allowEmpty && value === '') || (value.length > 0 && value.length <= 2048 &&
    !/[\\\u0000-\u001f\u007f]/.test(value) && !/^[a-z]:/i.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git')));
}
function snapshotValue(input: unknown, cloneBinary: boolean): HtmlPreviewSnapshot {
  const value = input as Partial<HtmlPreviewSnapshot> | undefined;
  const project = value?.project;
  if (!project || typeof project.name !== 'string' || !Number.isFinite(project.openedAt) || !safePath(project.rootPath, true) ||
    !safePath(project.mainHtmlPath) || (project.previewRootPath !== undefined && !safePath(project.previewRootPath, true)) ||
    !project.files || typeof project.files !== 'object' || Array.isArray(project.files) ||
    !['en', 'pt'].includes(value.language || '') || !Array.isArray(value.activeExtensions) ||
    value.activeExtensions.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(id))) throw new Error('This HTML preview snapshot is invalid. Open the project and prepare its preview again.');
  const files: Record<string, HtmlProjectFile> = Object.create(null);
  const entries = Object.entries(project.files);
  if (!entries.length || entries.length > 10_000) throw new Error('The HTML preview exceeds the supported file count.');
  let totalBytes = 0;
  for (const [path, file] of entries) {
    if (!safePath(path) || !file || file.path !== path || typeof file.mimeType !== 'string' ||
      (file.text !== undefined && typeof file.text !== 'string') ||
      (file.data !== undefined && !(file.data instanceof Uint8Array)) ||
      (file.text === undefined && file.data === undefined)) throw new Error(`The HTML preview contains an invalid file: ${path}`);
    const fileBytes = file.text !== undefined ? new TextEncoder().encode(file.text).byteLength : file.data!.byteLength;
    totalBytes += fileBytes;
    if (fileBytes > 256 * 1024 * 1024 || totalBytes > 768 * 1024 * 1024) throw new Error('The HTML preview exceeds the supported project size.');
    files[path] = { path, mimeType: file.mimeType, ...(file.text !== undefined ? { text: file.text } : { data: cloneBinary ? file.data!.slice() : file.data }) };
  }
  if (!files[project.mainHtmlPath] || !/\.html?$/i.test(project.mainHtmlPath)) throw new Error('The selected preview page is missing from this project.');
  return {
    project: { name: project.name, openedAt: project.openedAt, rootPath: project.rootPath, mainHtmlPath: project.mainHtmlPath,
      ...(project.previewRootPath !== undefined ? { previewRootPath: project.previewRootPath } : {}), files },
    language: value.language as 'en' | 'pt',
    activeExtensions: [...value.activeExtensions],
  };
}
async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('Browser storage is unavailable. Open the HTML project and try Preview again.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const fail = (reason: unknown) => { if (!settled) { settled = true; reject(reason); } };
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onblocked = () => fail(new Error('Close another Studio preview tab and try again.'));
    request.onerror = () => fail(request.error || new Error('The HTML preview storage could not be opened.'));
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
  });
}
async function stored<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || request.error || new Error('The HTML preview could not be saved.'));
      transaction.onerror = () => reject(transaction.error || request.error || new Error('The HTML preview storage failed.'));
    });
  } finally { database.close(); }
}

/** Keep each tab's writes ordered and acknowledge only a committed snapshot. */
export async function writeHtmlPreview(projectId: string, value: HtmlPreviewSnapshot): Promise<void> {
  assertProjectId(projectId);
  const snapshot = snapshotValue(value, true);
  const previous = pendingWrites.get(projectId);
  const write = (previous || Promise.resolve()).catch(() => undefined).then(async () => {
    await stored('readwrite', store => store.put({ version: 1, snapshot }, projectId));
  });
  pendingWrites.set(projectId, write);
  try { await write; }
  finally { if (pendingWrites.get(projectId) === write) pendingWrites.delete(projectId); }
}
export async function readHtmlPreview(projectId: string): Promise<HtmlPreviewSnapshot | undefined> {
  assertProjectId(projectId);
  await pendingWrites.get(projectId);
  const record = await stored('readonly', store => store.get(projectId));
  if (record === undefined) return undefined;
  if (record?.version !== 1) throw new Error('This HTML preview version is unavailable. Prepare Preview again from the project.');
  return snapshotValue(record.snapshot, false);
}
export function htmlPreviewUrl(projectId: string, baseUrl: string): string {
  assertProjectId(projectId);
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTML previews require an HTTP or HTTPS Studio URL.');
  url.search = '';
  url.hash = '';
  url.searchParams.set('kodety-html-preview', projectId);
  url.searchParams.set('kodety-preview-review', '1');
  return url.href;
}
