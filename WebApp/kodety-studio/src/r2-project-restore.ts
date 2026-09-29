import { importWordPressFiles, type PlaygroundClient } from '@wp-playground/client';
import JSZip from 'jszip';
import { importZip } from '../../../lib/html-editor/project-io';
import { browserProjectRepository } from './project-library';
import { createManagedHtmlDirectory, createHtmlDirectorySession, loadHtmlDirectory, forgetHtmlDirectory } from './html-directory';
import { downloadR2Project, type R2RemoteProject } from './r2-project-sync';

async function pendingStore<T>(id: string, mode: 'read' | 'put' | 'delete', archive?: Blob): Promise<T> {
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined;
    let tx: IDBTransaction | undefined;
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(value as T);
    };
    const timer = setTimeout(() => { try { tx?.abort(); } catch {} finish(new Error('Local recovery storage took too long to respond.')); }, 10_000);
    try {
      const request = indexedDB.open('kodety-r2-restore-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('archives');
      request.onerror = request.onblocked = () => finish(new Error('Could not open the local recovery storage.'));
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        try {
          tx = db.transaction('archives', mode === 'read' ? 'readonly' : 'readwrite');
          const store = tx.objectStore('archives');
          const record = mode === 'read' ? store.get(id) : mode === 'put' ? store.put(archive, id) : store.delete(id);
          tx.oncomplete = () => finish(undefined, record.result as T);
          tx.onabort = tx.onerror = () => finish(new Error('Could not save the local recovery copy.'));
        } catch { finish(new Error('Could not save the local recovery copy.')); }
      };
    } catch { finish(new Error('Could not open the local recovery storage.')); }
  });
}

export async function validateWordPressArchive(archive: Blob): Promise<void> {
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  const entries = Object.values(zip.files);
  if (entries.length > 100_000 || !entries.some(file => file.name.startsWith('wp-content/'))) throw new Error('Invalid WordPress archive.');
  const maxFile = 256 * 1024 * 1024, maxTotal = 768 * 1024 * 1024;
  let declaredTotal = 0, bytes = 0;
  // Check the central directory before inflating any data, then enforce the
  // same budgets on the actual decompression stream (headers can be forged).
  for (const entry of entries) {
    const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName || entry.name;
    if (original.startsWith('/') || /[\\\x00-\x1f]/.test(original) || original.split('/').includes('..')
      || (!entry.name.startsWith('wp-content/') && entry.name !== 'wp-content' && entry.name !== 'playground-export.json' && entry.name !== 'wp-config.php')
      || (typeof entry.unixPermissions === 'number' && (entry.unixPermissions & 0o170000) === 0o120000)) throw new Error('Invalid WordPress archive path.');
    if (!entry.dir) {
      const declared = (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (!Number.isSafeInteger(declared) || declared! < 0 || declared! > maxFile || (declaredTotal += declared!) > maxTotal) throw new Error('WordPress archive is too large.');
    }
  }
  for (const entry of entries) if (!entry.dir) {
    await new Promise<void>((resolve, reject) => {
      let fileBytes = 0;
      const stream = (entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
      stream.on('data', chunk => {
        fileBytes += chunk.byteLength; bytes += chunk.byteLength;
        if (fileBytes > maxFile || bytes > maxTotal) { stream.pause(); reject(new Error('WordPress archive is too large.')); }
      }).on('error', reject).on('end', resolve).resume();
    });
  }
}

/** Recovery always allocates a fresh local ID. It never mounts, rebinds or
 * overwrites the source ID or a pre-existing local project. */
export async function restoreR2ProjectAsCopy(remote: R2RemoteProject) {
  const { metadata, archive } = await downloadR2Project(remote);
  const repository = browserProjectRepository();
  const names = new Set(repository.read().map(project => project.name.toLocaleLowerCase()));
  const base = metadata.name.slice(0, 56);
  let number = 1;
  let name = `${base} (R2)`;
  while (names.has(name.toLocaleLowerCase())) name = `${base} (R2 ${++number})`;
  const html = metadata.mode === 'html' ? await importZip(new File([archive], 'r2-project.zip')) : null;
  if (!html) await validateWordPressArchive(archive);
  let preparedId: string | undefined;
  try {
    const result = await repository.restore(name, metadata.wordpressLocale === 'pt_BR' ? 'pt_BR' : 'en_US', {
      mode: metadata.mode, storageMode: 'browser', manualBackupAcknowledgedAt: Date.now(),
      ...(metadata.mode === 'wordpress' ? { runtimeVersions: { phpVersion: metadata.phpVersion, wordpressVersion: metadata.wordpressVersion } } : {}),
      prepare: async project => {
        preparedId = project.id;
        if (html) {
          const handle = await createManagedHtmlDirectory(project.id);
          const initial = await loadHtmlDirectory(handle, name);
          const session = createHtmlDirectorySession(handle, initial);
          await session.save({ ...html, name });
          await session.flush();
        } else await pendingStore(project.id, 'put', archive);
      },
    });
    return result.project;
  } catch (error) {
    // Clean up only the newly allocated incomplete copy, never remote.id.
    if (preparedId) {
      if (html) await forgetHtmlDirectory(preparedId).catch(() => undefined);
      else await pendingStore(preparedId, 'delete').catch(() => undefined);
    }
    throw error;
  }
}

/** Called only on a new site's first boot, before its first OPFS mount. */
export async function restorePendingR2WordPress(id: string, client: PlaygroundClient): Promise<void> {
  const archive = await pendingStore<Blob | undefined>(id, 'read');
  if (!archive) return;
  await importWordPressFiles(client, { wordPressFilesZip: new File([archive], 'r2-wordpress.zip', { type: 'application/zip' }) });
}
export const finalizeR2WordPressRestore = (id: string) => pendingStore<void>(id, 'delete');
