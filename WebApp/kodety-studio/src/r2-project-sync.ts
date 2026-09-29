import type { StudioProject } from './project-library';
import { getR2Connection, subscribeR2Connection, r2Request, r2ListObjects, R2_PREFIX, type R2Connection } from './r2-storage';

export type R2ProjectMetadata = Pick<StudioProject, 'id' | 'name' | 'mode' | 'createdAt' | 'updatedAt' | 'wordpressLocale' | 'phpVersion' | 'wordpressVersion' | 'kodetyVersion'>;
export type R2RemoteProject = R2ProjectMetadata & { archiveKey: string; revision: string; sha256: string; owner: string };
export type R2SyncState = { pending: number; active: boolean; lastSyncedAt?: number; error?: string };
type Manifest = R2RemoteProject & { format: 1; deleted?: boolean };
type Link = { connectionId: string; projectId: string; owner: string; previousArchive?: string; pendingRevision?: string; etag?: string; manifest?: Manifest; deleted?: boolean };
type Job = { token: string; connectionId: string; projectId: string; metadata?: R2ProjectMetadata; archive?: Blob; deleted?: boolean };
export type R2Queue = { deletedProjects?: Record<string, true>; jobs: Record<string, Job>; links: Record<string, Link> };
type Store = { read(): Promise<R2Queue>; change<T>(operation: (state: R2Queue) => T): Promise<T> };
const EMPTY = (): R2Queue => ({ jobs: {}, links: {} });
const prefix = (id: string) => {
  if (!/^[a-z0-9-]{8,80}$/i.test(id)) throw new Error('Invalid R2 project ID.');
  return `${R2_PREFIX}projects/${id}/`;
};
const keyOf = (connection: string, project: string) => `${connection}:${project}`;
const message = (error: unknown) => error instanceof Error ? error.message : 'R2 synchronization failed.';
const metadata = (project: R2ProjectMetadata): R2ProjectMetadata => ({
  id: project.id, name: project.name, mode: project.mode, createdAt: project.createdAt, updatedAt: Date.now(),
  wordpressLocale: project.wordpressLocale, phpVersion: project.phpVersion, wordpressVersion: project.wordpressVersion, kodetyVersion: project.kodetyVersion,
});
const encoder = new TextEncoder();
function parseManifest(bytes: Uint8Array, id?: string): Manifest {
  if (bytes.length > 32_768) throw new Error('Invalid R2 project metadata.');
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Manifest;
  if (value.format !== 1 || typeof value.id !== 'string' || (id && value.id !== id)
    || !['html', 'wordpress'].includes(value.mode) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80
    || typeof value.phpVersion !== 'string' || !/^\d{1,2}\.\d{1,2}$/.test(value.phpVersion)
    || typeof value.wordpressVersion !== 'string' || !/^\d{1,2}\.\d{1,2}(?:\.\d{1,3})?$/.test(value.wordpressVersion)
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || typeof value.owner !== 'string'
    || !/^[a-z0-9-]{8,80}$/i.test(value.owner) || typeof value.revision !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(value.revision)
    || value.archiveKey !== `${prefix(value.id)}revisions/${value.revision}.zip` || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid R2 project metadata.');
  return { ...metadata(value), updatedAt: value.updatedAt, format: 1, owner: value.owner,
    revision: value.revision, archiveKey: value.archiveKey, sha256: value.sha256, deleted: value.deleted === true };
}

function queueStore(): Store {
  const db = () => new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('The local R2 queue took too long to open.')); }, 5_000);
    const request = indexedDB.open('kodety-r2-sync-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('queue');
    request.onerror = () => { clearTimeout(timer); reject(new Error('Could not open the local R2 queue.')); };
    request.onblocked = () => { clearTimeout(timer); settled = true; reject(new Error('Close the other Studio tab to update the R2 queue.')); };
    request.onsuccess = () => { clearTimeout(timer); if (settled) request.result.close(); else resolve(request.result); };
  });
  async function transaction<T>(write: boolean, operation: (state: R2Queue) => T): Promise<T> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('queue', write ? 'readwrite' : 'readonly');
      const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('The local R2 queue took too long to save.')); }, 5_000);
      const store = tx.objectStore('queue');
      const request = store.get('state');
      let result: T;
      request.onsuccess = () => {
        try { const state = (request.result as R2Queue | undefined) || EMPTY(); result = operation(state); if (write) store.put(state, 'state'); }
        catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => { clearTimeout(timer); database.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); database.close(); reject(new Error('Could not persist the R2 queue. Local project files are unchanged.')); };
    });
  }
  return { read: () => transaction(false, state => state), change: operation => transaction(true, operation) };
}

/** Cloud writes have their own durable queue. This module never writes local
 * project files, directory bindings, or the project library. */
export function createR2ProjectSync(deps: {
  store: Store;
  connection: typeof getR2Connection;
  request: typeof r2Request;
  list: typeof r2ListObjects;
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  changed?: () => void;
  reserveLocalSpace?(archive: Blob): Promise<void>;
}) {
  let state: R2SyncState = { pending: 0, active: false };
  let running: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<R2SyncState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); deps.changed?.(); };
  const refresh = async () => { const connection = await deps.connection(); const queue = await deps.store.read(); publish({ pending: Object.values(queue.jobs).filter(job => job.connectionId === connection?.id).length }); };
  const current = async (key: string, token: string) => (await deps.store.read()).jobs[key]?.token === token;
  async function remote(connection: R2Connection, projectId: string) {
    try {
      const response = await deps.request(connection.config, { method: 'GET', key: `${prefix(projectId)}project.json` });
      if (!response.etag) throw new Error('R2 CORS must expose ETag before synchronization can continue.');
      return { manifest: parseManifest(response.body, projectId), etag: response.etag };
    } catch (error) { if ((error as { status?: number }).status === 404) return null; throw error; }
  }
  async function process(connection: R2Connection, key: string, job: Job) {
    const queue = await deps.store.read();
    const link = queue.links[key];
    if (!link) throw new Error('Missing R2 project association.');
    const assertConnection = async () => {
      const active = await deps.connection();
      if (!active || active.id !== connection.id || active.config.accessKeyId !== connection.config.accessKeyId
        || active.config.secretAccessKey !== connection.config.secretAccessKey) throw new Error('R2 disconnected. The local copy remains queued.');
    };
    const request: typeof deps.request = async (config, input) => { await assertConnection(); return deps.request(config, input); };
    const list: typeof deps.list = async (config, path, token) => { await assertConnection(); return deps.list(config, path, token); };
    await assertConnection();
    const existing = await remote(connection, job.projectId);
    // An uncertain response can be retried without producing duplicate versions.
    const alreadyCommitted = existing?.manifest.owner === link.owner && existing.manifest.revision === job.token;
    const recoveredCommit = existing?.manifest.owner === link.owner && existing.manifest.revision === link.pendingRevision;
    if (existing && (existing.manifest.owner !== link.owner || (!alreadyCommitted && !recoveredCommit && !(job.deleted && existing.manifest.deleted) && existing.etag !== link.etag))) {
      throw new Error('This project changed in R2. Recover the remote version as a new copy before retrying. Your local project is preserved.');
    }
    if (job.deleted) {
      if (existing && !existing.manifest.deleted) {
        const tombstone = { ...existing.manifest, deleted: true, updatedAt: Date.now(), revision: existing.manifest.revision };
        const result = await request(connection.config, { method: 'PUT', key: `${prefix(job.projectId)}project.json`,
          body: encoder.encode(JSON.stringify(tombstone)), contentType: 'application/json', headers: { 'If-Match': existing.etag } });
        await deps.store.change(data => { data.links[key] = { ...link, etag: result.etag || undefined, manifest: tombstone, deleted: true }; });
      }
      // Only this project namespace is removed; a tombstone prevents old clients
      // from treating a deletion as a new empty destination.
      let continuation: string | undefined;
      do {
        const page = await list(connection.config, `${prefix(job.projectId)}revisions/`, continuation);
        for (const object of page.objects) {
          if (!object.key.startsWith(`${prefix(job.projectId)}revisions/`)) throw new Error('Unexpected R2 object key.');
          await request(connection.config, { method: 'DELETE', key: object.key });
        }
        continuation = page.continuationToken || undefined;
      } while (continuation);
      await deps.store.change(data => { if (data.jobs[key]?.token === job.token) delete data.jobs[key]; data.links[key] = { ...data.links[key], deleted: true }; });
      return;
    }
    if (link.deleted || existing?.manifest.deleted) throw new Error('This R2 project was deleted. Your local project is preserved.');
    let manifest: Manifest;
    let etag: string | null;
    if (alreadyCommitted && existing) { manifest = existing.manifest; etag = existing.etag; }
    else {
      if (!job.metadata || (!job.archive && !existing)) throw new Error('Missing local R2 snapshot.');
      const bytes = job.archive ? new Uint8Array(await job.archive.arrayBuffer()) : new Uint8Array((await request(connection.config, { method: 'GET', key: existing!.manifest.archiveKey })).body);
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (!job.archive && sha256 !== existing!.manifest.sha256) throw new Error('R2 archive integrity check failed.');
      const archiveKey = `${prefix(job.projectId)}revisions/${job.token}.zip`;
      await request(connection.config, { method: 'PUT', key: archiveKey, body: bytes, contentType: 'application/zip' });
      if (!await current(key, job.token)) return;
      manifest = { ...job.metadata, format: 1, owner: link.owner, archiveKey, revision: job.token, sha256 };
      // Record intent before a possibly ambiguous network result, so a newer
      // local save can recognize our prior successful remote commit.
      await deps.store.change(data => { data.links[key].pendingRevision = job.token; });
      const response = await request(connection.config, { method: 'PUT', key: `${prefix(job.projectId)}project.json`,
        body: encoder.encode(JSON.stringify(manifest)), contentType: 'application/json',
        headers: existing ? { 'If-Match': existing.etag } : { 'If-None-Match': '*' } });
      etag = response.etag;
      if (!etag) throw new Error('R2 CORS must expose ETag. The upload will be checked again on retry.');
    }
    await deps.store.change(data => {
      data.links[key] = { ...data.links[key], etag: etag!, manifest, previousArchive: existing?.manifest.archiveKey, pendingRevision: undefined };
      if (data.jobs[key]?.token === job.token) delete data.jobs[key];
    });
    // Keep the current snapshot plus one previous recovery copy. Cleanup errors
    // do not turn a committed, verified upload into a failed local save.
    if (existing && existing.manifest.archiveKey !== manifest.archiveKey) {
      const prior = link.previousArchive;
      if (prior && prior !== existing.manifest.archiveKey && prior !== manifest.archiveKey) await request(connection.config, { method: 'DELETE', key: prior }).catch(() => undefined);
    }
  }
  async function drain() {
    if (running) return running;
    running = deps.exclusive(async () => {
      // Playground must use a document without COEP to retain its existing
      // storage origin. WebContainer signing resumes in the library document.
      if (typeof location !== 'undefined' && /\/project-storage(?:\.html)?$/.test(location.pathname)) { await refresh().catch(() => undefined); return; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { await refresh().catch(() => undefined); return; }
      publish({ active: true });
      let completed = false, failed = false;
      try {
        const connection = await deps.connection();
        if (!connection) return;
        const attempted = new Set<string>();
        for (;;) {
          if ((await deps.connection())?.id !== connection.id) return;
          const entry = Object.entries((await deps.store.read()).jobs).find(([, job]) => job.connectionId === connection.id && !attempted.has(job.token));
          if (!entry) break;
          const [key, job] = entry;
          attempted.add(job.token);
          try { await process(connection, key, job); completed = true; publish({ lastSyncedAt: Date.now() }); }
          catch (error) { failed = true; publish({ error: message(error) }); }
        }
      } catch (error) { failed = true; publish({ error: message(error) }); }
      finally { publish({ active: false, ...(completed && !failed ? { error: undefined } : {}) }); await refresh().catch(() => undefined); }
    }).finally(() => { running = null; });
    return running;
  }
  async function enqueue(project: StudioProject, archive?: Blob, deleted = false) {
    try {
      if (deleted) {
        await deps.store.change(queue => {
          (queue.deletedProjects ||= {})[project.id] = true;
          for (const [key, link] of Object.entries(queue.links)) {
            if (link.projectId !== project.id) continue;
            link.deleted = true;
            queue.jobs[key] = { token: crypto.randomUUID(), connectionId: link.connectionId, projectId: project.id, deleted: true };
          }
        });
        void refresh().catch(() => undefined); void drain(); return;
      }
      const connection = await deps.connection();
      if (!connection) return;
      if (archive) await deps.reserveLocalSpace?.(archive);
      const key = keyOf(connection.id, project.id);
      prefix(project.id);
      await deps.store.change(queue => {
        if (queue.deletedProjects?.[project.id]) return;
        if (deleted && !queue.links[key]) return;
        if (!deleted && queue.links[key]?.deleted) return;
        queue.links[key] ||= { owner: crypto.randomUUID(), connectionId: connection.id, projectId: project.id };
        if (deleted) queue.links[key].deleted = true;
        queue.jobs[key] = { token: crypto.randomUUID(), connectionId: connection.id, projectId: project.id, deleted,
          ...(archive ? { archive, metadata: metadata(project) } : {}) };
      });
      await refresh();
      void drain();
    } catch (error) { publish({ error: message(error) }); }
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    enqueue, drain, refresh,
    async rename(project: StudioProject) {
      try {
        await deps.store.change(queue => {
          for (const [key, link] of Object.entries(queue.links)) {
            if (link.projectId !== project.id || link.deleted) continue;
            const pending = queue.jobs[key];
            if (pending?.deleted || (!pending?.archive && !link.manifest)) continue;
            queue.jobs[key] = { ...pending, token: crypto.randomUUID(), connectionId: link.connectionId,
              projectId: project.id, metadata: metadata(project) };
          }
        });
        await refresh(); void drain();
      } catch (error) { publish({ error: message(error) }); }
    },
    error(reason: unknown) { publish({ error: message(reason) }); },
    async list(): Promise<R2RemoteProject[]> {
      const connection = await deps.connection(); if (!connection) return [];
      const projects: R2RemoteProject[] = [];
      let continuation: string | undefined;
      do {
        const page = await deps.list(connection.config, `${R2_PREFIX}projects/`, continuation);
        for (const object of page.objects) {
          const match = object.key.match(/^kodety-studio\/v1\/projects\/([a-z0-9-]{8,80})\/project\.json$/i);
          if (!match) continue;
          const item = await remote(connection, match[1]);
          if (item && !item.manifest.deleted) projects.push(item.manifest);
        }
        continuation = page.continuationToken || undefined;
      } while (continuation);
      return projects.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async download(project: R2RemoteProject) {
      const connection = await deps.connection(); if (!connection) throw new Error('Connect R2 first.');
      const validated = parseManifest(encoder.encode(JSON.stringify({ ...project, format: 1 })));
      const response = await deps.request(connection.config, { method: 'GET', key: validated.archiveKey });
      const bytes = new Uint8Array(response.body);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== validated.sha256) throw new Error('R2 archive integrity check failed. No local project was changed.');
      return { metadata: validated, archive: new Blob([bytes], { type: 'application/zip' }) };
    },
  };
}
let singleton: ReturnType<typeof createR2ProjectSync> | undefined;
function sync() {
  if (!singleton) {
    singleton = createR2ProjectSync({ store: queueStore(), connection: getR2Connection, request: r2Request, list: r2ListObjects,
      reserveLocalSpace: async archive => {
        if (!navigator.storage?.estimate) return;
        const estimate = await navigator.storage.estimate();
        if (!estimate.quota || !Number.isFinite(estimate.usage)) return;
        // Optional cloud copies must not consume the space needed for editing
        // originals. Account for the new Blob before replacing an older job.
        const reserve = Math.max(64 * 1024 * 1024, estimate.quota * 0.1);
        if (estimate.quota - estimate.usage! < archive.size + reserve) throw new Error('Not enough spare browser storage for the R2 queue. Local project files are preserved.');
      },
      exclusive: operation => new Promise((resolve, reject) => { void navigator.locks.request('kodety-r2-sync-v1', async () => { try { resolve(await operation()); } catch (error) { reject(error); } }).catch(reject); }) });
    subscribeR2Connection(() => { void singleton!.refresh().catch(() => undefined); void singleton!.drain(); });
    window.addEventListener('online', () => { void singleton!.drain(); });
    void singleton.refresh().catch(() => undefined);
    void singleton.drain();
  }
  return singleton;
}
export const getR2SyncState = () => sync().getState();
export const subscribeR2Sync = (listener: () => void) => sync().subscribe(listener);
export const retryR2Sync = () => sync().drain();
export const enqueueR2Snapshot = (project: StudioProject, archive: Blob) => sync().enqueue(project, archive);
export const enqueueR2ProjectDeletion = (project: StudioProject) => sync().enqueue(project, undefined, true);
export const listR2Projects = () => sync().list();
export const downloadR2Project = (project: R2RemoteProject) => sync().download(project);

export const recordR2SyncError = (error: unknown) => sync().error(error);

export const enqueueR2ProjectRename = (project: StudioProject) => sync().rename(project);
