import type { HtmlProject, HtmlProjectFile } from '../../../lib/html-editor/types';

const DATABASE = 'kodety-studio-html-directories-v1';
const STORE = 'directories';
const MANAGED_ROOT = 'kodety-studio-html-projects-v1';
const MANAGED_KIND = 'kodety-managed-html-directory-v1';
const managedDirectories = new WeakMap<FileSystemDirectoryHandle, string>();
type ManagedDirectoryRecord = { kind: typeof MANAGED_KIND; projectId: string };
const SKIP_DIRECTORIES = new Set(['.git', '.github', '.svn', 'node_modules', '.next', '.cache', '.kodety', '.vercel', '.wrangler', 'kodety-dist']);
export const HTML_DIRECTORY_REQUIRED = 'O acesso a pastas do computador não está disponível. Use o armazenamento deste navegador ou abra o Studio por HTTPS em um navegador com acesso a pastas.';
export const HTML_BROWSER_STORAGE_UNAVAILABLE = 'O armazenamento deste navegador não está disponível. Verifique as permissões de armazenamento e o espaço livre, ou abra o Studio em outro navegador.';

export class HtmlBrowserStorageError extends Error {
  constructor(public code: 'html_browser_storage_unavailable' | 'html_browser_storage_missing' | 'html_browser_project_invalid', message: string) { super(message); }
}
const storageUnavailable = () => new HtmlBrowserStorageError('html_browser_storage_unavailable', HTML_BROWSER_STORAGE_UNAVAILABLE);
const storageMissing = () => new HtmlBrowserStorageError('html_browser_storage_missing', 'Os arquivos deste projeto não foram encontrados neste navegador. Crie outro projeto HTML e use “Substituir projeto com ZIP…” no menu do Builder para recuperar seu backup.');
function managedProjectId(projectId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(projectId)) throw new HtmlBrowserStorageError('html_browser_project_invalid', 'O identificador do projeto HTML é inválido.');
  return projectId;
}
const isManagedRecord = (record: unknown): record is ManagedDirectoryRecord => Boolean(record && typeof record === 'object' && (record as ManagedDirectoryRecord).kind === MANAGED_KIND);

type DirectoryPermission = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

export function supportsHtmlDirectory(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext &&
    typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Browser-owned files and local folder selection are independent capabilities. */
export function supportsHtmlBrowserStorage(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext &&
    typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function' &&
    typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

async function managedRoot(create: boolean): Promise<FileSystemDirectoryHandle> {
  if (!supportsHtmlBrowserStorage()) throw storageUnavailable();
  try { return await (await navigator.storage.getDirectory()).getDirectoryHandle(MANAGED_ROOT, { create }); }
  catch (error) {
    if (!create && error instanceof DOMException && error.name === 'NotFoundError') throw storageMissing();
    throw storageUnavailable();
  }
}

/** OPFS requires no folder picker. Persist a portable binding rather than
 * assuming browsers can clone or query permissions on an OPFS handle. */
export async function createManagedHtmlDirectory(projectId: string): Promise<FileSystemDirectoryHandle> {
  managedProjectId(projectId);
  if (!supportsHtmlBrowserStorage()) throw storageUnavailable();
  let root: FileSystemDirectoryHandle | undefined;
  let created = false;
  try {
    const existing = await directoryStore<unknown>('readonly', store => store.get(projectId));
    if (existing && (!isManagedRecord(existing) || existing.projectId !== projectId)) throw new HtmlBrowserStorageError('html_browser_project_invalid', 'Este projeto já está associado a outra pasta.');
    root = await managedRoot(true);
    // Check actual write support before accepting a project, including storage
    // blocked by browser settings despite the API being present.
    const probe = `.storage-check-${crypto.randomUUID()}`;
    try {
      const file = await root.getFileHandle(probe, { create: true });
      if (typeof file.createWritable !== 'function') throw storageUnavailable();
      const writer = await file.createWritable();
      try { await writer.write(new Uint8Array([0])); await writer.close(); }
      catch (error) { await writer.abort().catch(() => undefined); throw error; }
    } finally { await root.removeEntry(probe).catch(() => undefined); }
    let handle: FileSystemDirectoryHandle;
    try { handle = await root.getDirectoryHandle(projectId); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      // An existing binding must never silently recreate files cleared by the browser.
      if (existing) throw storageMissing();
      handle = await root.getDirectoryHandle(projectId, { create: true }); created = true;
    }
    await directoryStore('readwrite', store => store.put({ kind: MANAGED_KIND, projectId } satisfies ManagedDirectoryRecord, projectId));
    managedDirectories.set(handle, projectId);
    return handle;
  } catch (error) {
    if (created) await root?.removeEntry(projectId).catch(() => undefined);
    if (error instanceof HtmlBrowserStorageError) throw error;
    throw storageUnavailable();
  }
}

export async function pickHtmlDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!supportsHtmlDirectory()) throw new Error(HTML_DIRECTORY_REQUIRED);
  const picker = (window as unknown as Window & { showDirectoryPicker(options: { mode: 'readwrite'; id: string }): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  return picker.call(window, { mode: 'readwrite', id: 'kodety-html-project' });
}

export async function authorizeHtmlDirectory(handle: FileSystemDirectoryHandle, request = false): Promise<boolean> {
  if (managedDirectories.has(handle)) return true;
  const directory = handle as DirectoryPermission;
  if (typeof directory.queryPermission !== 'function') return false;
  if (await directory.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return request && typeof directory.requestPermission === 'function' &&
    await directory.requestPermission({ mode: 'readwrite' }) === 'granted';
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível guardar a autorização da pasta.'));
    request.onblocked = () => reject(new Error('Feche outra aba do Studio para atualizar o armazenamento.'));
  });
}

async function directoryStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error('A autorização da pasta não foi guardada.'));
    });
  } finally { db.close(); }
}

export async function bindHtmlDirectory(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  if (!await authorizeHtmlDirectory(handle)) throw new Error(HTML_DIRECTORY_REQUIRED);
  const managedId = managedDirectories.get(handle);
  if (managedId && managedId !== projectId) throw new HtmlBrowserStorageError('html_browser_project_invalid', 'Esta pasta pertence a outro projeto HTML.');
  await directoryStore('readwrite', store => store.put(managedId ? { kind: MANAGED_KIND, projectId } satisfies ManagedDirectoryRecord : handle, projectId));
}

export async function readHtmlDirectoryHandle(projectId: string): Promise<FileSystemDirectoryHandle | undefined> {
  let stored: unknown;
  try { stored = await directoryStore('readonly', store => store.get(projectId)); }
  catch { throw storageUnavailable(); }
  if (!isManagedRecord(stored)) return stored as FileSystemDirectoryHandle | undefined;
  if (stored.projectId !== managedProjectId(projectId)) throw new HtmlBrowserStorageError('html_browser_project_invalid', 'Esta pasta pertence a outro projeto HTML.');
  const root = await managedRoot(false);
  try {
    const handle = await root.getDirectoryHandle(projectId, { create: false });
    managedDirectories.set(handle, projectId);
    return handle;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') throw storageMissing();
    throw storageUnavailable();
  }
}

/** Inspect the binding without opening the folder or requesting permissions.
 * Legacy catalog entries can lack their HTML mode even though a binding exists. */
export async function readHtmlDirectoryStorageMode(projectId: string): Promise<'folder' | 'browser' | undefined> {
  const stored = await directoryStore<unknown>('readonly', store => store.get(projectId));
  if (isManagedRecord(stored)) {
    if (stored.projectId !== managedProjectId(projectId)) throw new HtmlBrowserStorageError('html_browser_project_invalid', 'Esta pasta pertence a outro projeto HTML.');
    return 'browser';
  }
  return stored && typeof stored === 'object' && (stored as FileSystemHandle).kind === 'directory' ? 'folder' : undefined;
}

/** Call directly from the project's Open gesture, before project mutations or
 * editor loading. Stored handles retain identity, never an assumed permission:
 * the browser alone decides whether its real grant persists between visits. */
export async function requestStoredHtmlDirectoryAccess(projectId: string): Promise<boolean> {
  const handle = await readHtmlDirectoryHandle(projectId);
  if (!handle) return false;
  try { return await authorizeHtmlDirectory(handle, true); }
  catch (error) {
    // A slow storage read can outlive transient activation, and dismissal can
    // cancel a request. The workspace then offers its explicit permission CTA.
    if (error instanceof DOMException && ['SecurityError', 'AbortError'].includes(error.name)) return false;
    throw error;
  }
}

export async function forgetHtmlDirectory(projectId: string): Promise<void> {
  const stored = await directoryStore<unknown>('readonly', store => store.get(projectId));
  if (isManagedRecord(stored)) {
    if (stored.projectId !== managedProjectId(projectId)) throw new HtmlBrowserStorageError('html_browser_project_invalid', 'Esta pasta pertence a outro projeto HTML.');
    try { await (await managedRoot(false)).removeEntry(projectId, { recursive: true }); }
    catch (error) {
      if (!(error instanceof HtmlBrowserStorageError && error.code === 'html_browser_storage_missing') && !(error instanceof DOMException && error.name === 'NotFoundError')) throw storageUnavailable();
    }
  }
  await directoryStore('readwrite', store => store.delete(projectId));
}

export function isPrivateHtmlPath(path: string): boolean {
  return path.split('/').some(part => SKIP_DIRECTORIES.has(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part)) ||
    /(?:^|\/)(?:id_rsa|id_ed25519|credentials(?:\.json)?|\.npmrc|\.pypirc)$/i.test(path) || /\.(?:pem|key|p12|pfx)$/i.test(path);
}

export function isPublicHtmlPath(path: string): boolean {
  return !isPrivateHtmlPath(path) && path !== '.kodety-output.json' && path !== '.incode/static-source.json' && !path.startsWith('.incode/static-source/') &&
    !/^(?:\.incode|\.coday)\/(?:project|template|publish-overlay)\.json$/i.test(path);
}

export async function loadHtmlDirectory(handle: FileSystemDirectoryHandle, name: string): Promise<HtmlProject> {
  if (!await authorizeHtmlDirectory(handle)) throw new Error('Autorize novamente a pasta para abrir o projeto HTML.');
  const [{ fileToProjectFile, createBlankProject }, { writeChangedProjectFiles }] = await Promise.all([
    import('../../../lib/html-editor/project-io'), import('../../../lib/html-editor/local-folder-sync'),
  ]);
  const files: Record<string, HtmlProjectFile> = Object.create(null);
  let bytes = 0;
  let count = 0;
  async function read(directory: FileSystemDirectoryHandle, prefix = ''): Promise<void> {
    for await (const [entryName, entry] of (directory as DirectoryPermission).entries()) {
      const path = prefix + entryName;
      if (isPrivateHtmlPath(path)) continue;
      if (entry.kind === 'directory') { await read(entry as FileSystemDirectoryHandle, path + '/'); continue; }
      const file = await (entry as FileSystemFileHandle).getFile();
      bytes += file.size;
      count += 1;
      if (count > 10_000 || bytes > 768 * 1024 * 1024 || file.size > 256 * 1024 * 1024) {
        throw new Error('Esta pasta ultrapassa o limite de 10.000 arquivos, 256 MB por arquivo ou 768 MB por projeto.');
      }
      files[path] = await fileToProjectFile(path, file);
    }
  }
  await read(handle);
  const htmlPaths = Object.keys(files).filter(path => /\.html?$/i.test(path));
  const mainHtmlPath = htmlPaths.find(path => path.toLowerCase() === 'index.html') ||
    htmlPaths.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
  if (!mainHtmlPath) {
    if (Object.keys(files).length) throw new Error('Esta pasta não contém HTML. Selecione a pasta do site estático ou uma pasta vazia para criar um projeto.');
    const blank = createBlankProject(name);
    await writeChangedProjectFiles(handle, null, blank);
    return blank;
  }
  return { name, files, mainHtmlPath, rootPath: '', openedAt: Date.now() };
}

/** Serialize writes, retain the last acknowledged snapshot after failure, and
 * reject external file modifications before touching the directory. */
export function createHtmlDirectorySession(handle: FileSystemDirectoryHandle, initial: HtmlProject) {
  let acknowledged = initial;
  let tail: Promise<unknown> = Promise.resolve();
  let lastRequested: HtmlProject | null = null;
  const fileEquals = (left: HtmlProjectFile, right: HtmlProjectFile) => {
    if (left.text !== right.text) return false;
    if (left.data === right.data) return true;
    return Boolean(left.data && right.data && left.data.length === right.data.length && left.data.every((value, index) => value === right.data![index]));
  };
  async function validateExternalChanges(next: HtmlProject) {
    const { fileToProjectFile } = await import('../../../lib/html-editor/project-io');
    const { assertSafeProjectFilePath } = await import('../../../lib/html-editor/local-folder-sync');
    for (const source of [acknowledged, next]) {
      for (const [path, file] of Object.entries(source.files)) {
        assertSafeProjectFilePath(path);
        if (file.path !== path || isPrivateHtmlPath(path)) throw new Error(`Caminho de arquivo protegido: ${path}`);
      }
    }
    for (const [path, previous] of Object.entries(acknowledged.files)) {
      if (next.files[path] && fileEquals(previous, next.files[path])) continue;
      const parts = path.split('/');
      let parent = handle;
      try {
        for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
        const current = await (await parent.getFileHandle(parts.at(-1)!)).getFile();
        if (!fileEquals(previous, await fileToProjectFile(path, current))) {
          // A partially successful previous write already contains this exact
          // desired value; retrying it does not discard external content.
          if (next.files[path] && fileEquals(next.files[path], await fileToProjectFile(path, current))) continue;
          throw new Error(`O arquivo “${path}” foi alterado fora do Kodety. Exporte seu ZIP antes de reabrir a pasta para conciliar as versões.`);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError' && !next.files[path]) continue;
        throw error;
      }
    }
    for (const [path, nextFile] of Object.entries(next.files)) {
      if (acknowledged.files[path]) continue;
      const parts = path.split('/');
      let parent = handle;
      try {
        for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
        const existing = await (await parent.getFileHandle(parts.at(-1)!)).getFile();
        if (!fileEquals(nextFile, await fileToProjectFile(path, existing))) throw new Error(`O arquivo “${path}” já existe na pasta. Renomeie o novo arquivo para preservar o conteúdo existente.`);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
    }
  }
  return {
    save(snapshot: HtmlProject): Promise<void> {
      // Only keep portable project source on disk; preview documents never
      // become the project home page in the stored metadata.
      lastRequested = snapshot;
      const operation = tail.catch(() => undefined).then(async () => {
        const [{ canonicalProjectForTransport, prepareProjectForDraftTransport }, { writeChangedProjectFiles }] = await Promise.all([
          import('../../../lib/html-editor/project-io'), import('../../../lib/html-editor/local-folder-sync'),
        ]);
        const next = prepareProjectForDraftTransport(canonicalProjectForTransport(snapshot));
        if (!await authorizeHtmlDirectory(handle)) throw new Error('A permissão da pasta expirou. Clique em “Autorizar pasta” para continuar salvando.');
        await validateExternalChanges(next);
        await writeChangedProjectFiles(handle, acknowledged, next);
        acknowledged = next;
      });
      tail = operation;
      return operation;
    },
    flush() { return tail; },
    get acknowledged() { return acknowledged; },
    get lastRequested() { return lastRequested; },
  };
}

export const HTML_OUTPUT_DIRECTORY = 'kodety-dist';
const OUTPUT_MARKER = '.kodety-output.json';

/** Publish only into an output directory created for this exact project.
 * Existing user directories and files outside the previous manifest survive. */
export async function publishHtmlDirectory(root: FileSystemDirectoryHandle, projectId: string, generated: HtmlProject): Promise<string> {
  if (!await authorizeHtmlDirectory(root)) throw new Error('Autorize a pasta antes de publicar os arquivos.');
  const { fileToProjectFile } = await import('../../../lib/html-editor/project-io');
  const { assertSafeProjectFilePath, writeChangedProjectFiles } = await import('../../../lib/html-editor/local-folder-sync');
  let output: FileSystemDirectoryHandle;
  let manifest: { kind: string; projectId: string; paths: string[] };
  let created = false;
  try { output = await root.getDirectoryHandle(HTML_OUTPUT_DIRECTORY); }
  catch (cause) {
    if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) throw cause;
    output = await root.getDirectoryHandle(HTML_OUTPUT_DIRECTORY, { create: true });
    created = true;
  }
  const marker = async (value: typeof manifest) => {
    const writer = await (await output.getFileHandle(OUTPUT_MARKER, { create: true })).createWritable();
    try { await writer.write(JSON.stringify(value)); await writer.close(); }
    catch (cause) { await writer.abort().catch(() => undefined); throw cause; }
  };
  if (created) {
    manifest = { kind: 'kodety-html-output-v1', projectId, paths: [] };
    await marker(manifest);
  } else {
    try {
      const parsed: unknown = JSON.parse(await (await (await output.getFileHandle(OUTPUT_MARKER)).getFile()).text());
      if (!parsed || typeof parsed !== 'object' || (parsed as typeof manifest).kind !== 'kodety-html-output-v1' || (parsed as typeof manifest).projectId !== projectId || !Array.isArray((parsed as typeof manifest).paths) || !(parsed as typeof manifest).paths.every(path => typeof path === 'string')) throw new Error('Invalid output owner');
      manifest = parsed as typeof manifest;
    } catch {
      throw new Error(`A pasta “${HTML_OUTPUT_DIRECTORY}” já existe e não pertence a este projeto. Renomeie essa pasta para preservar seus arquivos antes de publicar.`);
    }
  }
  const previousFiles: Record<string, HtmlProjectFile> = Object.create(null);
  for (const path of manifest.paths) {
    assertSafeProjectFilePath(path);
    if (path === OUTPUT_MARKER) throw new Error('Manifesto de publicação inválido.');
    const parts = path.split('/');
    let parent = output;
    try {
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      previousFiles[path] = await fileToProjectFile(path, await (await parent.getFileHandle(parts.at(-1)!)).getFile());
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) throw cause;
    }
  }
  const next: HtmlProject = { ...generated, files: Object.fromEntries(Object.entries(generated.files).filter(([path]) => isPublicHtmlPath(path))) };
  // Even inside our generated folder, a newly-authored manual file is not
  // owned by the previous manifest and must never be silently replaced.
  for (const [path, file] of Object.entries(next.files)) {
    assertSafeProjectFilePath(path);
    if (manifest.paths.includes(path)) continue;
    const parts = path.split('/');
    let parent = output;
    try {
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      const existing = await fileToProjectFile(path, await (await parent.getFileHandle(parts.at(-1)!)).getFile());
      const same = existing.text === file.text && (existing.data === file.data || Boolean(existing.data && file.data && existing.data.length === file.data.length && existing.data.every((byte, index) => byte === file.data![index])));
      if (!same) throw new Error(`O arquivo “${HTML_OUTPUT_DIRECTORY}/${path}” não foi gerado por esta publicação. Renomeie-o para preservar seu conteúdo.`);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) throw cause;
    }
  }
  await writeChangedProjectFiles(output, { ...generated, files: previousFiles }, next);
  await marker({ kind: 'kodety-html-output-v1', projectId, paths: Object.keys(next.files) });
  return HTML_OUTPUT_DIRECTORY;
}
