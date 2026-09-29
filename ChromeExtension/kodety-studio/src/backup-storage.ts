import { zipWpContent, type PlaygroundClient } from '@wp-playground/client';
import JSZip from 'jszip';
import { flushProject } from './playground-runtime';
import { projectPathSlug, type KodetyStudioProject } from './storage';

const BACKUP_DATABASE = 'kodetyStudioSecurityFolderV1';
const BACKUP_STORE = 'settings';
const BACKUP_SETTINGS_KEY = 'security-folder';
const BACKUP_FORMAT_VERSION = 1;
const MAX_SNAPSHOTS = 5;

type DirectoryPermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  entries?(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }): Promise<FileSystemDirectoryHandle>;
};

type BackupSettings = {
  key: string;
  rootHandle: FileSystemDirectoryHandle;
  projectFolders: Record<string, string>;
  lastBackups: Record<string, number>;
};

export type SecurityDirectoryOptions = { requireProjectDirectory?: boolean };

// Handles are cached after inspection so an explicit permission button can call
// requestPermission in its click task, without waiting for IndexedDB first.
const settingsCache = new Map<string, BackupSettings>();
const backupOperations = new Map<string, Promise<unknown>>();

function projectSettingsKey(projectId: string): string {
  return `${BACKUP_SETTINGS_KEY}:${projectId}`;
}

function serializeBackup<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = backupOperations.get(projectId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  backupOperations.set(projectId, current);
  void current.finally(() => {
    if (backupOperations.get(projectId) === current) backupOperations.delete(projectId);
  }).catch(() => undefined);
  return current;
}

export type SecurityDirectoryStatus = {
  supported: boolean;
  connected: boolean;
  needsPermission: boolean;
  directoryName: string | null;
  lastBackupAt: number | null;
};

export type ProjectBackupResult = {
  createdAt: number;
  directoryName: string;
  snapshotName: string;
  size: number;
};

function openBackupDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BACKUP_STORE)) {
        database.createObjectStore(BACKUP_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the backup settings database.'));
  });
}

async function readBackupSettings(key = BACKUP_SETTINGS_KEY): Promise<BackupSettings | null> {
  if (!('indexedDB' in window)) return null;
  const database = await openBackupDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE).get(key);
      request.onsuccess = () => {
        const value = request.result as Partial<BackupSettings> | undefined;
        if (!value?.rootHandle) {
          resolve(null);
          return;
        }
        const settings = {
          key,
          rootHandle: value.rootHandle,
          projectFolders: value.projectFolders && typeof value.projectFolders === 'object' ? value.projectFolders : {},
          lastBackups: value.lastBackups && typeof value.lastBackups === 'object' ? value.lastBackups : {},
        };
        settingsCache.set(key, settings);
        resolve(settings);
      };
      request.onerror = () => reject(request.error || new Error('Could not read the backup folder.'));
    });
  } finally {
    database.close();
  }
}

async function readProjectBackupSettings(projectId: string, options: SecurityDirectoryOptions = {}): Promise<BackupSettings | null> {
  const own = await readBackupSettings(projectSettingsKey(projectId));
  if (own || options.requireProjectDirectory) return own;
  return readBackupSettings();
}

async function writeBackupSettings(settings: BackupSettings): Promise<void> {
  const database = await openBackupDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKUP_STORE, 'readwrite');
      transaction.objectStore(BACKUP_STORE).put(settings);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not save the backup folder.'));
      transaction.onabort = () => reject(transaction.error || new Error('Could not save the backup folder.'));
    });
    settingsCache.set(settings.key, settings);
  } finally {
    database.close();
  }
}

export function securityDirectorySupported(): boolean {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function' && 'indexedDB' in window;
}

async function permissionForDirectory(handle: FileSystemDirectoryHandle, request: boolean): Promise<PermissionState> {
  const permissionHandle = handle as DirectoryPermissionHandle;
  if (!permissionHandle.queryPermission) return 'granted';
  let permission = await permissionHandle.queryPermission({ mode: 'readwrite' });
  if (permission === 'prompt' && request && permissionHandle.requestPermission) {
    permission = await permissionHandle.requestPermission({ mode: 'readwrite' });
  }
  return permission;
}

export async function getSecurityDirectoryStatus(projectId: string, options: SecurityDirectoryOptions = {}): Promise<SecurityDirectoryStatus> {
  if (!securityDirectorySupported()) {
    return { supported: false, connected: false, needsPermission: false, directoryName: null, lastBackupAt: null };
  }
  const settings = await readProjectBackupSettings(projectId, options);
  if (!settings) {
    return { supported: true, connected: false, needsPermission: false, directoryName: null, lastBackupAt: null };
  }
  const permission = await permissionForDirectory(settings.rootHandle, false).catch(() => 'denied' as PermissionState);
  return {
    supported: true,
    connected: permission === 'granted',
    needsPermission: permission === 'prompt',
    directoryName: settings.rootHandle.name,
    lastBackupAt: typeof settings.lastBackups[projectId] === 'number' ? settings.lastBackups[projectId] : null,
  };
}

/** Invoke from the folder button before any other asynchronous work. */
export function pickSecurityDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('A seleção de pastas não está disponível neste navegador.');
  return picker.call(window, {
    id: 'kodety-studio-security-folder',
    mode: 'readwrite',
    startIn: 'documents',
  });
}

export async function bindProjectSecurityDirectory(projectId: string, rootHandle: FileSystemDirectoryHandle): Promise<SecurityDirectoryStatus> {
  if (!projectId) throw new Error('O projeto precisa de uma identificação para conectar a pasta de segurança.');
  return serializeBackup(projectId, async () => {
    if (await permissionForDirectory(rootHandle, false) !== 'granted') {
      throw new Error('Autorize a gravação na pasta de segurança antes de criar o projeto.');
    }
    await writeBackupSettings({
      key: projectSettingsKey(projectId),
      rootHandle,
      projectFolders: {},
      lastBackups: {},
    });
    return { supported: true, connected: true, needsPermission: false, directoryName: rootHandle.name, lastBackupAt: null };
  });
}

export async function connectSecurityDirectory(projectId?: string): Promise<SecurityDirectoryStatus> {
  const rootHandle = await pickSecurityDirectory();
  if (projectId) return bindProjectSecurityDirectory(projectId, rootHandle);
  const settings: BackupSettings = {
    key: BACKUP_SETTINGS_KEY,
    rootHandle,
    projectFolders: {},
    lastBackups: {},
  };
  await writeBackupSettings(settings);
  return {
    supported: true,
    connected: true,
    needsPermission: false,
    directoryName: rootHandle.name,
    lastBackupAt: null,
  };
}

export async function requestSecurityDirectoryAccess(projectId: string, options: SecurityDirectoryOptions = {}): Promise<SecurityDirectoryStatus> {
  const settings = settingsCache.get(projectSettingsKey(projectId))
    || (!options.requireProjectDirectory ? settingsCache.get(BACKUP_SETTINGS_KEY) : undefined);
  if (!settings) throw new Error('Selecione novamente a pasta de segurança para autorizar o acesso.');
  // Request directly while the activation from the permission button is alive.
  const handle = settings.rootHandle as DirectoryPermissionHandle;
  if (handle.requestPermission) await handle.requestPermission({ mode: 'readwrite' });
  const permission = await permissionForDirectory(settings.rootHandle, false);
  return {
    supported: true,
    connected: permission === 'granted',
    needsPermission: permission === 'prompt',
    directoryName: settings.rootHandle.name,
    lastBackupAt: typeof settings.lastBackups[projectId] === 'number' ? settings.lastBackups[projectId] : null,
  };
}

function backupTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function downloadName(project: KodetyStudioProject, createdAt: number): string {
  return `${projectPathSlug(project)}-backup-${backupTimestamp(new Date(createdAt))}.zip`;
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function normalizedRuntimePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

function runtimeArchivePath(root: string, path: string): string {
  return normalizedRuntimePath(path).slice(normalizedRuntimePath(root).length).replace(/^\/+/, '');
}

async function addRuntimeDirectoryToZip(
  client: PlaygroundClient,
  zip: JSZip,
  runtimeRoot: string,
  directory: string,
  visited: Set<string>,
): Promise<void> {
  const normalizedDirectory = normalizedRuntimePath(directory);
  if (visited.has(normalizedDirectory)) return;
  visited.add(normalizedDirectory);

  const entries = await client.listFiles(normalizedDirectory, { prependPath: true });
  for (const rawPath of entries) {
    const path = normalizedRuntimePath(rawPath);
    if (path === normalizedDirectory || !path.startsWith(`${normalizedDirectory}/`)) continue;
    const archivePath = runtimeArchivePath(runtimeRoot, path);
    if (!archivePath) continue;
    if (await client.isDir(path)) {
      zip.folder(archivePath);
      await addRuntimeDirectoryToZip(client, zip, runtimeRoot, path, visited);
      continue;
    }
    zip.file(archivePath, ownedBytes(await client.readFileAsBuffer(path)));
  }
}

/**
 * Playground's official exporter currently depends on PHP's ZipArchive writing
 * `/tmp/wordpress-playground.zip`. Some persisted PHP-WASM runtimes return
 * successfully without creating that file. Build the same portable archive in
 * JavaScript as a fallback so a safety-folder action can never fail merely
 * because the optional PHP zip extension is unavailable.
 */
async function zipWpContentInJavaScript(client: PlaygroundClient): Promise<Uint8Array<ArrayBuffer>> {
  const documentRoot = normalizedRuntimePath(await client.documentRoot);
  const wpContentPath = `${documentRoot}/wp-content`;
  if (!(await client.isDir(wpContentPath))) {
    throw new Error('A pasta wp-content deste projeto não está disponível para o backup.');
  }

  const zip = new JSZip();
  zip.folder('wp-content');
  await addRuntimeDirectoryToZip(client, zip, documentRoot, wpContentPath, new Set());

  const wpConfigPath = `${documentRoot}/wp-config.php`;
  if (await client.fileExists(wpConfigPath)) {
    zip.file('wp-config.php', ownedBytes(await client.readFileAsBuffer(wpConfigPath)));
  }
  zip.file('playground-export.json', JSON.stringify({
    formatVersion: 2,
    siteUrl: await client.absoluteUrl,
  }));

  return ownedBytes(await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    streamFiles: true,
  }));
}

async function exportWpContent(client: PlaygroundClient): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return ownedBytes(await zipWpContent(client));
  } catch (primaryError) {
    try {
      return await zipWpContentInJavaScript(client);
    } catch (fallbackError) {
      throw new Error('Não foi possível gerar o arquivo de backup do WordPress.', {
        cause: new AggregateError([primaryError, fallbackError]),
      });
    }
  }
}

async function createBackupBytes(client: PlaygroundClient, project: KodetyStudioProject): Promise<{
  bytes: Uint8Array<ArrayBuffer>;
  createdAt: number;
  filename: string;
  sha256: string;
}> {
  await flushProject(client);
  const bytes = await exportWpContent(client);
  const createdAt = Date.now();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { bytes, createdAt, filename: downloadName(project, createdAt), sha256 };
}

export function captureProjectSnapshot(client: PlaygroundClient, project: KodetyStudioProject): Promise<Blob> {
  return serializeBackup(project.id, async () => {
    const snapshot = await createBackupBytes(client, project);
    return new Blob([snapshot.bytes], { type: 'application/zip' });
  });
}

async function writeFile(directory: FileSystemDirectoryHandle, name: string, contents: Blob | Uint8Array<ArrayBuffer> | string): Promise<void> {
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function removeOldSnapshots(directory: FileSystemDirectoryHandle, latestSnapshot: string): Promise<void> {
  const entries = (directory as DirectoryPermissionHandle).entries;
  if (!entries) return;
  const snapshots: string[] = [];
  for await (const [name, handle] of entries.call(directory)) {
    if (handle.kind === 'file' && name.endsWith('.zip')) snapshots.push(name);
  }
  snapshots.sort((left, right) => left === latestSnapshot ? -1 : right === latestSnapshot ? 1 : right.localeCompare(left));
  await Promise.all(snapshots.slice(MAX_SNAPSHOTS).map(name => directory.removeEntry(name)));
}

async function resolveProjectDirectory(
  settings: BackupSettings,
  project: KodetyStudioProject,
): Promise<{ directory: FileSystemDirectoryHandle; folderName: string }> {
  let folderName = settings.projectFolders[project.id];
  if (!folderName) {
    const directoryId = project.id.replace(/[^a-z0-9]/gi, '').toLowerCase();
    folderName = `${projectPathSlug(project)}--${directoryId}`;
    settings.projectFolders[project.id] = folderName;
  }
  const directory = await settings.rootHandle.getDirectoryHandle(folderName, { create: true });
  return { directory, folderName };
}

export async function saveProjectSnapshot(
  client: PlaygroundClient,
  project: KodetyStudioProject,
  options: SecurityDirectoryOptions = {},
): Promise<ProjectBackupResult> {
  return serializeBackup(project.id, () => writeProjectSnapshot(client, project, options));
}

async function writeProjectSnapshot(
  client: PlaygroundClient,
  project: KodetyStudioProject,
  options: SecurityDirectoryOptions,
): Promise<ProjectBackupResult> {
  const settings = await readProjectBackupSettings(project.id, options);
  if (!settings) throw new Error('Conecte uma pasta de segurança antes de salvar o snapshot.');
  const permission = await permissionForDirectory(settings.rootHandle, false);
  if (permission !== 'granted') throw new Error('Autorize novamente o acesso à pasta de segurança para retomar o backup automático.');

  const { directory, folderName } = await resolveProjectDirectory(settings, project);
  const snapshotsDirectory = await directory.getDirectoryHandle('snapshots', { create: true });
  const backup = await createBackupBytes(client, project);
  const snapshotName = backup.filename.replace(/\.zip$/, `-${crypto.randomUUID()}.zip`);

  try {
    await writeFile(snapshotsDirectory, snapshotName, backup.bytes);
  } catch (error) {
    await snapshotsDirectory.removeEntry(snapshotName).catch(() => undefined);
    throw error;
  }

  await writeFile(directory, 'latest.zip', backup.bytes);
  await writeFile(directory, 'project.json', JSON.stringify({
    format: 'kodety-studio-backup',
    version: BACKUP_FORMAT_VERSION,
    projectId: project.id,
    projectName: project.name,
    wordpressVersion: project.wordpressVersion,
    phpVersion: project.phpVersion,
    kodetyVersion: project.kodetyVersion,
    wordpressLocale: project.wordpressLocale,
    createdAt: new Date(backup.createdAt).toISOString(),
    latestSnapshot: `snapshots/${snapshotName}`,
    bytes: backup.bytes.byteLength,
    sha256: backup.sha256,
  }, null, 2));
  await removeOldSnapshots(snapshotsDirectory, snapshotName);

  settings.lastBackups[project.id] = backup.createdAt;
  // Give a legacy project its own record after its first successful write.
  // Concurrent projects must not race to replace the old shared metadata map.
  settings.key = projectSettingsKey(project.id);
  await writeBackupSettings(settings);
  return {
    createdAt: backup.createdAt,
    directoryName: `${settings.rootHandle.name}/${folderName}`,
    snapshotName,
    size: backup.bytes.byteLength,
  };
}

export async function downloadProjectSnapshot(
  client: PlaygroundClient,
  project: KodetyStudioProject,
): Promise<{ createdAt: number; filename: string; size: number }> {
  const backup = await createBackupBytes(client, project);
  const url = URL.createObjectURL(new Blob([backup.bytes], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backup.filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { createdAt: backup.createdAt, filename: backup.filename, size: backup.bytes.byteLength };
}
