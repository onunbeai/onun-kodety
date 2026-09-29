import { disposeR2Signer, signR2InWebContainer } from './r2-storage-signer';

export const R2_PREFIX = 'kodety-studio/v1/';
export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
export type R2Connection = { id: string; config: R2Config };
export type R2ConnectionInfo = { id: string; accountId: string; bucket: string; remembered: boolean; connectedAt: number };
export type R2Request = {
  method: 'GET' | 'HEAD' | 'PUT' | 'DELETE'; key?: string; query?: Record<string, string>;
  body?: Uint8Array; contentType?: string; headers?: Record<string, string>; signal?: AbortSignal;
};
export type R2Response = { body: Uint8Array; etag: string | null; status: number };
export type R2Object = { key: string; etag: string; size: number; lastModified: string };
export type R2ErrorCode = 'r2-invalid-config' | 'r2-runtime' | 'r2-network' | 'r2-auth' | 'r2-not-found'
  | 'r2-conflict' | 'r2-limit' | 'r2-request' | 'r2-response' | 'r2-storage' | 'r2-disconnected';
const messages: Record<R2ErrorCode, string> = {
  'r2-invalid-config': 'Check the R2 account, bucket and S3 access keys.',
  'r2-runtime': 'The browser runtime could not start. Check the connection and browser settings, then retry.',
  'r2-network': 'Could not reach your R2 bucket. Check the connection and its CORS policy.',
  'r2-auth': 'R2 refused access. Check the keys and read/write permissions for this bucket.',
  'r2-not-found': 'The requested R2 bucket or object was not found.',
  'r2-conflict': 'This object changed in R2. Refresh its current version before retrying.',
  'r2-limit': 'This object exceeds the supported transfer size.',
  'r2-request': 'R2 could not complete this request. Try again.',
  'r2-response': 'R2 returned an invalid or incomplete response.',
  'r2-storage': 'The R2 connection could not be saved in this browser.',
  'r2-disconnected': 'The R2 operation was canceled.',
};
export class R2StorageError extends Error {
  constructor(public readonly code: R2ErrorCode, public readonly status?: number) { super(messages[code]); this.name = 'R2StorageError'; }
}
const fail = (code: R2ErrorCode, status?: number): never => { throw new R2StorageError(code, status); };
const maxBytes = 512 * 1024 * 1024;
const operations = new Set<AbortController>();

export function validateR2Config(value: R2Config): R2Config {
  if (!value || typeof value !== 'object') return fail('r2-invalid-config');
  const config = Object.fromEntries(['accountId', 'accessKeyId', 'secretAccessKey', 'bucket'].map(key => [key, typeof value[key as keyof R2Config] === 'string' ? value[key as keyof R2Config].trim() : ''])) as R2Config;
  if (!/^[a-f\d]{32}$/i.test(config.accountId) || !/^[a-f\d]{32}$/i.test(config.accessKeyId) || !/^[a-f\d]{64}$/i.test(config.secretAccessKey)
    || !/^[a-z\d][a-z\d-]{1,61}[a-z\d]$/.test(config.bucket) || config.bucket.startsWith('xn--') || config.bucket.endsWith('-s3alias') || config.bucket.endsWith('--ol-s3')) return fail('r2-invalid-config');
  config.accountId = config.accountId.toLowerCase();
  return config;
}
function validateKey(key: string): void {
  if (typeof key !== 'string' || !key.startsWith(R2_PREFIX) || new TextEncoder().encode(key).length > 1024
    || /[\\\x00-\x1f\x7f]/.test(key) || key.split('/').some(part => part === '.' || part === '..')) fail('r2-invalid-config');
}

/** Transfers go from this browser directly to the fixed R2 S3 endpoint. The
 * WebContainer signs only; its network proxy and Kodety servers are never used. */
export async function r2Request(rawConfig: R2Config, request: R2Request): Promise<R2Response> {
  const config = validateR2Config(rawConfig);
  if (!request || !['GET', 'HEAD', 'PUT', 'DELETE'].includes(request.method)) return fail('r2-invalid-config');
  if (request.key !== undefined) { validateKey(request.key); if (Object.keys(request.query || {}).length) fail('r2-invalid-config'); }
  else {
    if (request.method !== 'GET' || request.query?.['list-type'] !== '2') return fail('r2-invalid-config');
    validateKey(request.query.prefix);
    if (Object.keys(request.query).some(key => !['list-type', 'prefix', 'continuation-token', 'max-keys'].includes(key))
      || Object.values(request.query).some(value => typeof value !== 'string' || value.length > 8192)
      || request.query['max-keys'] && !/^(?:[1-9]\d{0,2}|1000)$/.test(request.query['max-keys'])) return fail('r2-invalid-config');
  }
  for (const [key, value] of Object.entries(request.headers || {})) {
    if (!['if-match', 'if-none-match'].includes(key.toLowerCase()) || typeof value !== 'string' || !value || value.length > 256 || /[\r\n]/.test(value)) return fail('r2-invalid-config');
  }
  if (request.contentType !== undefined && (typeof request.contentType !== 'string' || !request.contentType || request.contentType.length > 200 || /[\r\n]/.test(request.contentType))) return fail('r2-invalid-config');
  if (request.body && (!(request.body instanceof Uint8Array) || request.method !== 'PUT')) return fail('r2-invalid-config');
  if (request.body && request.body.byteLength > maxBytes) return fail('r2-limit');
  const controller = new AbortController();
  operations.add(controller);
  const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    signal.throwIfAborted();
    // Snapshot before signing; a caller changing its buffer must not change the
    // body after calculating the signed payload hash.
    const body = request.body ? new Uint8Array(request.body) : undefined;
    const digest = await crypto.subtle.digest('SHA-256', body || new Uint8Array());
    const payloadHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    let signed;
    try { signed = await signR2InWebContainer({ config, method: request.method, key: request.key, query: request.query, headers: request.headers, contentType: request.contentType, payloadHash }, signal); }
    catch { return fail(signal.aborted ? 'r2-disconnected' : 'r2-runtime'); }
    signal.throwIfAborted();
    const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    const expectedPath = `/${config.bucket}${request.key === undefined ? '' : `/${request.key.split('/').map(value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')}`}`;
    const url = new URL(signed.url);
    if (url.origin !== endpoint || url.pathname !== expectedPath || url.username || url.password || url.hash || signed.method !== request.method) return fail('r2-runtime');
    let response: Response;
    try {
      response = await fetch(url, { method: request.method, headers: signed.headers, body, signal,
        mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch { return fail(signal.aborted ? 'r2-disconnected' : 'r2-network'); }
    if (!response.ok) {
      void response.body?.cancel();
      const status = response.status;
      return fail(status === 401 || status === 403 ? 'r2-auth' : status === 404 ? 'r2-not-found' : status === 409 || status === 412 ? 'r2-conflict' : status === 413 ? 'r2-limit' : 'r2-request', status);
    }
    if (Number(response.headers.get('content-length')) > maxBytes) { void response.body?.cancel(); return fail('r2-limit'); }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader) while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try { result = await reader.read(); } catch { return fail(signal.aborted ? 'r2-disconnected' : 'r2-network'); }
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) { void reader.cancel(); return fail('r2-limit'); }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { body: bytes, etag: response.headers.get('etag'), status: response.status };
  } catch (error) {
    if (error instanceof R2StorageError) throw error;
    return fail(signal.aborted ? 'r2-disconnected' : 'r2-request');
  } finally { clearTimeout(timer); operations.delete(controller); }
}

export async function r2ListObjects(config: R2Config, prefix = R2_PREFIX, continuationToken?: string): Promise<{ objects: R2Object[]; continuationToken: string | null }> {
  validateKey(prefix);
  const response = await r2Request(config, { method: 'GET', query: { 'list-type': '2', prefix, 'max-keys': '1000', ...(continuationToken ? { 'continuation-token': continuationToken } : {}) } });
  if (response.body.byteLength > 4 * 1024 * 1024) return fail('r2-response');
  const xml = new TextDecoder().decode(response.body);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return fail('r2-response');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'ListBucketResult') return fail('r2-response');
  const field = (element: Element, name: string) => Array.from(element.children).find(child => child.localName === name)?.textContent || '';
  const objects = Array.from(document.documentElement.children).filter(element => element.localName === 'Contents').map(element => {
    const key = field(element, 'Key'), size = Number(field(element, 'Size'));
    validateKey(key);
    if (!key.startsWith(prefix) || !Number.isSafeInteger(size) || size < 0) return fail('r2-response');
    return { key, size, etag: field(element, 'ETag'), lastModified: field(element, 'LastModified') };
  });
  if (objects.length > 1000) return fail('r2-response');
  const truncated = field(document.documentElement, 'IsTruncated') === 'true';
  const token = field(document.documentElement, 'NextContinuationToken');
  if (truncated && (!token || token.length > 8192)) return fail('r2-response');
  return { objects, continuationToken: truncated ? token : null };
}

/** Scoped credentials only need this bucket. Never call ListBuckets. */
export async function testR2Connection(rawConfig: R2Config): Promise<void> {
  const config = validateR2Config(rawConfig);
  const key = `${R2_PREFIX}.kodety-probe-${crypto.randomUUID()}`;
  const body = crypto.getRandomValues(new Uint8Array(32));
  const lifetime = new AbortController();
  operations.add(lifetime);
  let attemptedWrite = false;
  try {
    await r2ListObjects(config, `${R2_PREFIX}.kodety-probe-`);
    lifetime.signal.throwIfAborted();
    attemptedWrite = true;
    try {
      await r2Request(config, { method: 'PUT', key, body, contentType: 'application/octet-stream', headers: { 'if-none-match': '*' }, signal: lifetime.signal });
    } catch (error) {
      // A conditional rejection means this key already existed. Even a probe
      // UUID collision must never delete somebody else's object.
      if (error instanceof R2StorageError && error.code === 'r2-conflict') attemptedWrite = false;
      throw error;
    }
    const result = await r2Request(config, { method: 'GET', key, signal: lifetime.signal });
    if (!result.etag || result.body.length !== body.length || result.body.some((byte, index) => byte !== body[index])) return fail('r2-response');
  } finally {
    // If upload response was lost, remove its unpredictable probe key as well.
    // An explicit disconnect cancels all network work, including probe cleanup.
    try { if (attemptedWrite && !lifetime.signal.aborted) await r2Request(config, { method: 'DELETE', key, signal: lifetime.signal }); }
    finally { operations.delete(lifetime); }
  }
}

type SavedConnection = { config: R2Config; connectedAt: number };
type TabConnection = SavedConnection & { remembered: boolean };
const tabConnectionKey = 'kodety-studio-r2-connection-tab-v1';
let current: SavedConnection | null = null;
let info: R2ConnectionInfo | null = null;
let initialized: Promise<void> | undefined;
let changes = Promise.resolve();
let connectionGeneration = 0;
const listeners = new Set<() => void>();
const connectionId = (config: R2Config) => `${config.accountId}/${config.bucket}`;
const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* One UI consumer cannot block another. */ } } };

/** Private tab credentials survive the same-tab WordPress isolation page and
 * reloads. They are never part of the project catalog or its export/backup. */
function readTabConnection(): TabConnection | null {
  try {
    const raw = sessionStorage.getItem(tabConnectionKey);
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw);
      if (!Number.isFinite(saved.connectedAt) || typeof saved.remembered !== 'boolean') throw new Error();
      return { config: validateR2Config(saved.config), connectedAt: saved.connectedAt, remembered: saved.remembered };
    } catch { sessionStorage.removeItem(tabConnectionKey); return null; }
  } catch { return fail('r2-storage'); }
}
function writeTabConnection(value: SavedConnection | null, remembered = false): void {
  try {
    if (value) sessionStorage.setItem(tabConnectionKey, JSON.stringify({ ...value, remembered }));
    else sessionStorage.removeItem(tabConnectionKey);
  } catch { fail('r2-storage'); }
}

/** Deliberately separate from project stores, manifests, exports and backups. */
async function credentialStore(operation: 'read' | 'write' | 'delete', value?: SavedConnection): Promise<SavedConnection | null> {
  return new Promise((resolve, reject) => {
    let database: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    let settled = false;
    const finish = (error?: unknown, result: SavedConnection | null = null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database?.close();
      if (error) reject(new R2StorageError('r2-storage')); else resolve(result);
    };
    const timer = setTimeout(() => { try { transaction?.abort(); } catch {} finish(true); }, 15_000);
    try {
      const request = indexedDB.open('kodety-studio-r2-credentials-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('connection');
      request.onblocked = request.onerror = () => finish(true);
      request.onsuccess = () => {
        database = request.result;
        if (settled) { database.close(); return; }
        try {
          transaction = database.transaction('connection', operation === 'read' ? 'readonly' : 'readwrite');
          const store = transaction.objectStore('connection');
          const record = operation === 'read' ? store.get('active') : operation === 'write' ? store.put(value, 'active') : store.delete('active');
          transaction.oncomplete = () => finish(undefined, operation === 'read' ? record.result || null : null);
          transaction.onerror = transaction.onabort = () => finish(true);
        } catch { finish(true); }
      };
    } catch { finish(true); }
  });
}
function setConnection(value: SavedConnection | null, remembered: boolean) {
  current = value;
  info = value ? Object.freeze({ id: connectionId(value.config), accountId: value.config.accountId, bucket: value.config.bucket, remembered, connectedAt: value.connectedAt }) : null;
  notify();
}
export async function getR2Connection(): Promise<R2Connection | null> {
  initialized ||= Promise.resolve().then(async () => {
    const tab = readTabConnection();
    if (tab) { setConnection({ config: tab.config, connectedAt: tab.connectedAt }, tab.remembered); return; }
    const saved = await credentialStore('read');
    if (saved) {
      try {
        const restored = { config: validateR2Config(saved.config), connectedAt: Number.isFinite(saved.connectedAt) ? saved.connectedAt : Date.now() };
        writeTabConnection(restored, true);
        setConnection(restored, true);
      }
      catch { return credentialStore('delete').then(() => undefined); }
    }
  });
  try { await initialized; } catch { initialized = undefined; return fail('r2-storage'); }
  return current ? { id: connectionId(current.config), config: { ...current.config } } : null;
}
export function getR2ConnectionInfo(): R2ConnectionInfo | null { return info; }
export function subscribeR2Connection(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export async function connectR2(config: R2Config, options: { remember: boolean } = { remember: false }): Promise<void> {
  const normalized = validateR2Config(config);
  const generation = connectionGeneration;
  const change = changes.catch(() => undefined).then(async () => {
    await getR2Connection();
    if (generation !== connectionGeneration) return fail('r2-disconnected');
    await testR2Connection(normalized);
    if (generation !== connectionGeneration) return fail('r2-disconnected');
    const value = { config: normalized, connectedAt: Date.now() };
    await credentialStore(options.remember ? 'write' : 'delete', options.remember ? value : undefined);
    writeTabConnection(value, options.remember);
    setConnection(value, options.remember);
  });
  changes = change;
  return change;
}
export async function disconnectR2(): Promise<void> {
  connectionGeneration++;
  for (const controller of operations) controller.abort();
  disposeR2Signer();
  const change = changes.catch(() => undefined).then(async () => {
    await getR2Connection();
    // Clear memory even if browser persistence fails; report any disk error.
    setConnection(null, false);
    // Attempt both stores even if one is blocked by browser settings.
    let tabError: unknown;
    try { writeTabConnection(null); } catch (error) { tabError = error; }
    await credentialStore('delete');
    if (tabError) throw tabError;
  });
  changes = change;
  return change;
}

/** Cloudflare bucket > Settings > CORS policy. Origin must match this Studio. */
export function makeR2CorsPolicy(origin = location.origin) {
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) return fail('r2-invalid-config');
  return [{ AllowedOrigins: [origin], AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'],
    AllowedHeaders: ['authorization', 'content-type', 'x-amz-content-sha256', 'x-amz-date', 'if-match', 'if-none-match'],
    ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }];
}
