import type { HtmlProject } from './types';

export interface StoredHtmlProject {
  project: HtmlProject;
  projectId?: string;
  projectSession?: number;
  savedAt: number;
  /** WordPress workspace authority that owned this local snapshot. */
  workspaceRevision?: number;
  workspaceTemplateDigest?: string;
  workspaceCssDigest?: string;
  workspaceKey?: string;
  /** Signature of `project` when the IndexedDB record was written. */
  projectSignature?: string;
  /** Last signature acknowledged by WordPress at the time of the write. */
  acknowledgedProjectSignature?: string;
  projectTransportSize?: number;
}

export interface StoredHtmlProjectSnapshots {
  latest: StoredHtmlProject | null;
  recovery: StoredHtmlProject | null;
}

export interface StoredHtmlProjectAuthority {
  projectId?: string;
  workspaceRevision: number;
  workspaceTemplateDigest: string;
  workspaceCssDigest: string;
  workspaceKey: string;
  projectSignature: string;
  savedAt: number;
}

const DATABASE_NAME = 'incode-html-editor';
const DATABASE_VERSION = 1;
const STORE_NAME = 'projects';
const LATEST_KEY = 'latest';
const RECOVERY_KEY = 'recovery';
const AUTHORITY_KEY = 'wordpress-authority';

function snapshotStorageKey(key: string, workspaceKey = '') {
  return workspaceKey ? `${key}:${encodeURIComponent(workspaceKey)}` : key;
}

// Existing unscoped records remain available only to the workspace that wrote
// them. A different site sharing the origin must never bootstrap this record.
function readScopedSnapshot<Value extends { workspaceKey?: string }>(
  store: IDBObjectStore,
  key: string,
  workspaceKey: string,
  receive: (value: Value | null) => void,
) {
  const request = store.get(snapshotStorageKey(key, workspaceKey));
  request.onsuccess = () => {
    if (request.result || !workspaceKey) {
      receive((request.result as Value | undefined) || null);
      return;
    }
    const legacy = store.get(key);
    legacy.onsuccess = () => {
      const value = legacy.result as Value | undefined;
      receive(value?.workspaceKey === workspaceKey ? value : null);
    };
  };
}

interface SnapshotWaiter<Result> {
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
}

/**
 * Start the first write immediately, keep at most one value waiting behind it,
 * and merge every newer value into that pending slot. Every caller waiting on
 * a coalesced value resolves with the result of the newest write.
 */
export function createLatestWriteQueue<Value, Result>(
  write: (value: Value) => Promise<Result>,
  merge: (pending: Value, next: Value) => Value = (_pending, next) => next,
) {
  let pendingValue: Value | null = null;
  let pendingWaiters: SnapshotWaiter<Result>[] = [];
  let drain: Promise<void> | null = null;

  const drainValues = async () => {
    while (pendingValue !== null) {
      const value = pendingValue;
      const waiters = pendingWaiters;
      pendingValue = null;
      pendingWaiters = [];
      try {
        const result = await write(value);
        waiters.forEach(waiter => waiter.resolve(result));
      } catch (error) {
        waiters.forEach(waiter => waiter.reject(error));
      }
    }
  };

  const ensureDrain = () => {
    if (drain) return;
    drain = drainValues().finally(() => {
      drain = null;
      // A promise callback can enqueue at the exact boundary where the drain
      // settles. Re-entering through this guard keeps that write immediate.
      if (pendingValue !== null) ensureDrain();
    });
  };

  return (value: Value) => {
    pendingValue = pendingValue === null ? value : merge(pendingValue, value);
    const result = new Promise<Result>((resolve, reject) => {
      pendingWaiters.push({ resolve, reject });
    });
    ensureDrain();
    return result;
  };
}

interface SerializedWriteJob<Value, Result> {
  kind: 'latest' | 'exact';
  value: Value;
  waiters: SnapshotWaiter<Result>[];
  state: 'pending' | 'active' | 'cancelled' | 'settled';
  signal?: AbortSignal;
  abort?: () => void;
}

interface SerializedExactWriteOptions {
  signal?: AbortSignal;
}

/**
 * Serialize writes while keeping background checkpoints bounded.
 *
 * `enqueueLatest` coalesces only with the newest *pending background* job.
 * `enqueueExact` always gets its own FIFO slot, so a Save/Publish promise can
 * never be resolved by the acknowledgement for a different snapshot.
 */
export function createSerializedWriteQueue<Value, Result>(
  write: (value: Value) => Promise<Result>,
  mergeLatest: (pending: Value, next: Value) => Value = (_pending, next) => next,
) {
  const jobs: Array<SerializedWriteJob<Value, Result>> = [];
  let draining = false;

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (jobs.length) {
        const job = jobs.shift()!;
        if (job.state === 'cancelled') continue;
        job.state = 'active';
        // An AbortSignal listener may transition this active job while the
        // awaited transport is in flight. Keep the read behind a closure so
        // TypeScript does not incorrectly treat `active` as immutable across
        // the await boundary.
        const wasCancelled = () => job.state === 'cancelled';
        try {
          const result = await write(job.value);
          if (!wasCancelled()) job.waiters.forEach(waiter => waiter.resolve(result));
        } catch (error) {
          if (!wasCancelled()) job.waiters.forEach(waiter => waiter.reject(error));
        } finally {
          job.signal?.removeEventListener('abort', job.abort!);
          job.waiters = [];
          job.state = 'settled';
        }
      }
    } finally {
      draining = false;
      // A promise continuation can enqueue at the exact boundary where the
      // loop observes an empty array. Re-enter without waiting for another job.
      if (jobs.length) void drain();
    }
  };

  const enqueue = (
    kind: SerializedWriteJob<Value, Result>['kind'],
    value: Value,
    options: SerializedExactWriteOptions = {},
  ) => {
    if (options.signal?.aborted) {
      return Promise.reject(
        options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('Operação cancelada.', 'AbortError'),
      );
    }
    let job = kind === 'latest' ? jobs.at(-1) : undefined;
    if (job?.kind === 'latest') {
      job.value = mergeLatest(job.value, value);
    } else {
      job = { kind, value, waiters: [], state: 'pending', signal: options.signal };
      jobs.push(job);
    }
    const result = new Promise<Result>((resolve, reject) => {
      job!.waiters.push({ resolve, reject });
    });
    if (kind === 'exact' && options.signal) {
      const exactJob = job;
      const abort = () => {
        if (exactJob.state === 'settled' || exactJob.state === 'cancelled') return;
        if (exactJob.state === 'pending') {
          const index = jobs.indexOf(exactJob);
          if (index >= 0) jobs.splice(index, 1);
        }
        exactJob.state = 'cancelled';
        const reason = options.signal!.reason instanceof Error
          ? options.signal!.reason
          : new DOMException('Operação cancelada.', 'AbortError');
        exactJob.waiters.forEach(waiter => waiter.reject(reason));
        exactJob.waiters = [];
        options.signal!.removeEventListener('abort', abort);
      };
      exactJob.abort = abort;
      options.signal.addEventListener('abort', abort, { once: true });
    }
    void drain();
    return result;
  };

  return {
    enqueueLatest: (value: Value) => enqueue('latest', value),
    enqueueExact: (value: Value, options?: SerializedExactWriteOptions) => enqueue('exact', value, options),
  };
}

interface ProjectSnapshotWrite {
  project: HtmlProject;
  projectId?: string;
  preserveRecovery?: StoredHtmlProject;
  workspaceRevision?: number;
  workspaceTemplateDigest?: string;
  workspaceCssDigest?: string;
  workspaceKey?: string;
  projectSignature?: string;
  acknowledgedProjectSignature?: string;
  projectTransportSize?: number;
}

export interface SaveProjectSnapshotOptions {
  projectId?: string;
  preserveRecovery?: StoredHtmlProject;
  workspaceRevision?: number;
  workspaceTemplateDigest?: string;
  workspaceCssDigest?: string;
  workspaceKey?: string;
  projectSignature?: string;
  acknowledgedProjectSignature?: string;
  projectTransportSize?: number;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('O armazenamento local não está disponível neste navegador.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function advanceSnapshotAuthority(store: IDBObjectStore, authority: StoredHtmlProjectAuthority) {
  const key = snapshotStorageKey(AUTHORITY_KEY, authority.workspaceKey);
  const current = store.get(key);
  current.onsuccess = () => {
    const previous = current.result as StoredHtmlProjectAuthority | undefined;
    if (previous && previous.workspaceRevision > authority.workspaceRevision) return;
    store.put(authority, key);
  };
}

async function writeProjectSnapshot(snapshot: ProjectSnapshotWrite) {
  const database = await openDatabase();
  const savedAt = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      if (snapshot.preserveRecovery) store.put(snapshot.preserveRecovery, snapshotStorageKey(RECOVERY_KEY, snapshot.workspaceKey));
      store.put({
        project: snapshot.project,
        projectId: snapshot.projectId,
        projectSession: snapshot.project.openedAt,
        savedAt,
        workspaceRevision: snapshot.workspaceRevision,
        workspaceTemplateDigest: snapshot.workspaceTemplateDigest,
        workspaceCssDigest: snapshot.workspaceCssDigest,
        workspaceKey: snapshot.workspaceKey,
        projectSignature: snapshot.projectSignature,
        acknowledgedProjectSignature: snapshot.acknowledgedProjectSignature,
        projectTransportSize: snapshot.projectTransportSize,
      } satisfies StoredHtmlProject, snapshotStorageKey(LATEST_KEY, snapshot.workspaceKey));
      if (
        snapshot.projectSignature
        && snapshot.projectSignature === snapshot.acknowledgedProjectSignature
        && snapshot.workspaceKey
        && snapshot.workspaceTemplateDigest
        && Number.isFinite(snapshot.workspaceRevision)
      ) {
        advanceSnapshotAuthority(store, {
          projectId: snapshot.projectId,
          workspaceRevision: snapshot.workspaceRevision!,
          workspaceTemplateDigest: snapshot.workspaceTemplateDigest,
          workspaceCssDigest: snapshot.workspaceCssDigest || '',
          workspaceKey: snapshot.workspaceKey,
          projectSignature: snapshot.projectSignature,
          savedAt,
        } satisfies StoredHtmlProjectAuthority);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar o projeto.'));
      transaction.onabort = () => reject(transaction.error || new Error('O salvamento local foi cancelado.'));
    });
    return savedAt;
  } finally {
    database.close();
  }
}

/** Advance WordPress authority without structured-cloning the full project. */
export async function saveProjectSnapshotAuthority(
  authority: Omit<StoredHtmlProjectAuthority, 'savedAt'> & { savedAt?: number },
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      advanceSnapshotAuthority(transaction.objectStore(STORE_NAME), {
        ...authority,
        savedAt: authority.savedAt || Date.now(),
      } satisfies StoredHtmlProjectAuthority);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível confirmar a revisão local.'));
      transaction.onabort = () => reject(transaction.error || new Error('A confirmação local foi cancelada.'));
    });
  } finally {
    database.close();
  }
}

// Coalescing is scoped too: a queued write for one site cannot be resolved by
// another site's snapshot while the first IndexedDB transaction is in flight.
const snapshotQueues = new Map<string, ReturnType<typeof createLatestWriteQueue<ProjectSnapshotWrite, number>>>();
function enqueueProjectSnapshot(snapshot: ProjectSnapshotWrite) {
  const key = snapshot.workspaceKey || '';
  let enqueue = snapshotQueues.get(key);
  if (!enqueue) {
    enqueue = createLatestWriteQueue(writeProjectSnapshot, (pending, next) => ({
      ...next,
      preserveRecovery: pending.preserveRecovery || next.preserveRecovery,
    }));
    snapshotQueues.set(key, enqueue);
  }
  return enqueue(snapshot);
}
const projectSnapshotIdle = new Map<string, Promise<void>>();

export function saveProjectSnapshot(
  project: HtmlProject,
  options: SaveProjectSnapshotOptions = {},
) {
  const result = enqueueProjectSnapshot({
    project,
    projectId: options.projectId,
    preserveRecovery: options.preserveRecovery,
    workspaceRevision: options.workspaceRevision,
    workspaceTemplateDigest: options.workspaceTemplateDigest,
    workspaceCssDigest: options.workspaceCssDigest,
    workspaceKey: options.workspaceKey,
    projectSignature: options.projectSignature,
    acknowledgedProjectSignature: options.acknowledgedProjectSignature,
    projectTransportSize: options.projectTransportSize,
  });
  projectSnapshotIdle.set(options.workspaceKey || '', result.then(() => undefined, () => undefined));
  return result;
}

/**
 * Read startup snapshots in one IndexedDB transaction.
 *
 * Large projects contain binary assets. Opening the database twice and asking
 * Chromium to structured-clone `latest` and `recovery` concurrently used to
 * contend with ZIP inflation during Builder startup. One transaction keeps the
 * read ordered and gives the caller the latest canvas bootstrap immediately.
 */
export async function loadProjectSnapshots(
  onLatest?: (latest: StoredHtmlProject | null) => void,
  workspaceKey = '',
): Promise<StoredHtmlProjectSnapshots> {
  const database = await openDatabase();
  try {
    return await new Promise<StoredHtmlProjectSnapshots>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      let latest: StoredHtmlProject | null = null;
      let recovery: StoredHtmlProject | null = null;
      readScopedSnapshot<StoredHtmlProjectAuthority>(store, AUTHORITY_KEY, workspaceKey, authority => {
        readScopedSnapshot<StoredHtmlProject>(store, LATEST_KEY, workspaceKey, stored => {
          latest = stored;
          if (latest && authority?.projectId && latest.projectId !== authority.projectId) {
            // A confirmed replacement can outlive a failed heavyweight write.
            // Keep the outgoing snapshot solely as an explicit recovery copy.
            recovery = latest;
            latest = null;
          }
          if (
            latest
            && authority
            && latest.projectSignature === authority.projectSignature
            && (!latest.workspaceKey || latest.workspaceKey === authority.workspaceKey)
          ) {
            latest = {
              ...latest,
              workspaceRevision: authority.workspaceRevision,
              workspaceTemplateDigest: authority.workspaceTemplateDigest,
              workspaceCssDigest: authority.workspaceCssDigest,
              workspaceKey: authority.workspaceKey,
              acknowledgedProjectSignature: authority.projectSignature,
            };
          }
          onLatest?.(latest);
          // Queue recovery only after Chromium has finished cloning latest.
          // The tiny authority lookup runs first so a successful server save
          // can authorize 304 without rewriting the entire local project.
          readScopedSnapshot<StoredHtmlProject>(store, RECOVERY_KEY, workspaceKey, protectedRecovery => {
            recovery = protectedRecovery || recovery;
          });
        });
      });
      transaction.oncomplete = () => resolve({ latest, recovery });
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível recuperar o projeto.'));
      transaction.onabort = () => reject(transaction.error || new Error('A recuperação local foi cancelada.'));
    });
  } finally {
    database.close();
  }
}

export async function loadLatestProjectSnapshot(workspaceKey = ''): Promise<StoredHtmlProject | null> {
  return (await loadProjectSnapshots(undefined, workspaceKey)).latest;
}

export async function loadProjectRecoverySnapshot(workspaceKey = ''): Promise<StoredHtmlProject | null> {
  return (await loadProjectSnapshots(undefined, workspaceKey)).recovery;
}

export async function clearProjectRecoverySnapshot(workspaceKey = ''): Promise<void> {
  // Do not let an older in-flight preservation transaction recreate the
  // recovery key after the user has successfully restored that exact copy.
  let observed: Promise<void>;
  do {
    observed = projectSnapshotIdle.get(workspaceKey) || Promise.resolve();
    await observed;
  } while (projectSnapshotIdle.has(workspaceKey) && observed !== projectSnapshotIdle.get(workspaceKey));
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(snapshotStorageKey(RECOVERY_KEY, workspaceKey));
      if (workspaceKey) {
        const legacy = store.get(RECOVERY_KEY);
        legacy.onsuccess = () => {
          if (legacy.result?.workspaceKey === workspaceKey) store.delete(RECOVERY_KEY);
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível limpar a cópia local recuperada.'));
      transaction.onabort = () => reject(transaction.error || new Error('A limpeza da cópia local foi cancelada.'));
    });
  } finally {
    database.close();
  }
}
