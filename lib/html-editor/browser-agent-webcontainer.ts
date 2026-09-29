import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { AgentBackend, AgentBackendBinding, AgentBackendCallbacks } from './agent-backend';
import type { AgentRuntimeRequestOptions } from './agent-runtime-setup';
import { createBrowserAgentNetwork, type AgentNetworkOptions } from './browser-agent-network';

type Options = {
  projectId: string;
  runtimeUrl: string;
  credentialScope?: string;
  network?: AgentNetworkOptions;
  isLicensed(): boolean;
  isReadOnly?(): boolean;
};
type Pending = { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void; request: AgentRuntimeRequestOptions; suffix: string; written: boolean };
let containerPromise: Promise<WebContainer> | undefined;
const historyWriteQueues = new Map<string, Promise<void>>();
const attachmentWriteQueues = new Map<string, Promise<void>>();
const credentialWriteQueues = new Map<string, Promise<void>>();
const credentialLockQueues = new Map<string, Promise<void>>();

function failure(code: string, message: string, action = 'Tente conectar novamente.', retryable = true): Error {
  return Object.assign(new Error(message), {
    code,
    payload: { runtimeDiagnostics: { code, message, action, retryable } },
  });
}
const aborted = () => new DOMException('Conexão interrompida.', 'AbortError');
const rpcBody = (request: AgentRuntimeRequestOptions) => request.body as { method?: string; params?: Record<string, unknown> } | undefined;

async function acquireCredentialLock(key: string, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const unlock = () => { signal.removeEventListener('abort', unlock); release(); };
  signal.addEventListener('abort', unlock, { once: true });
  try {
    if (globalThis.navigator?.locks) {
      await new Promise<void>((resolve, reject) => {
        void navigator.locks.request(`kodety-browser-agent:${key}`, { signal }, async () => {
          resolve(); await held;
        }).catch(reject);
      });
    } else {
      // Browsers without Web Locks still serialize bindings in this document.
      const previous = credentialLockQueues.get(key) || Promise.resolve();
      const tail = previous.catch(() => undefined).then(() => held);
      credentialLockQueues.set(key, tail);
      void tail.then(() => { if (credentialLockQueues.get(key) === tail) credentialLockQueues.delete(key); });
      await cancellable(previous, signal);
    }
    signal.throwIfAborted();
    return unlock;
  } catch (error) { unlock(); throw error; }
}
function cancellable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function container(): Promise<WebContainer> {
  if (!window.isSecureContext || !window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw failure('agent_browser_isolation_required', 'A execução no navegador ainda não está habilitada nesta hospedagem.',
      'Atualize os arquivos e a configuração de hospedagem do Studio para habilitar o Agent no navegador.', false);
  }
  if (!containerPromise) {
    containerPromise = import('@webcontainer/api').then(({ WebContainer }) => WebContainer.boot({ coep: 'credentialless', workdirName: 'kodety-agent' }));
    containerPromise.catch(() => { containerPromise = undefined; });
  }
  return containerPromise;
}

/** Shared browser runtime. R2 and the Agent must never boot competing instances. */
export function getBrowserWebContainer(): Promise<WebContainer> {
  return container();
}

// Conversation history belongs to the application, never to the project folder
// or an exported ZIP. OAuth has a separate account store below.
async function historyStore<T>(key: string, operation: 'read' | 'write', value?: T, database = 'kodety-browser-agent-history-v1'): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined;
    let settled = false;
    const finish = (error?: unknown, result?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('History storage timed out.')), 15_000);
    try {
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('projects');
      request.onerror = () => finish(request.error || new Error('History storage unavailable.'));
      request.onblocked = () => finish(new Error('History storage is blocked.'));
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        try {
          const tx = db.transaction('projects', operation === 'read' ? 'readonly' : 'readwrite');
          const store = tx.objectStore('projects');
          const record = operation === 'read' ? store.get(key) : store.put(value, key);
          tx.oncomplete = () => finish(undefined, operation === 'read' ? record.result as T : undefined);
          tx.onerror = () => finish(tx.error || new Error('History transaction failed.'));
          tx.onabort = tx.onerror;
        } catch (error) { finish(error); }
      };
    } catch (error) { finish(error); }
  });
}

// Private to this browser origin and the host's account scope. Never put this
// database in project export, backup, sync or conversation history.
async function credentialStore<T>(key: string, operation: 'read' | 'write', value?: T | null): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined;
    let settled = false;
    const finish = (error?: unknown, result?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Account storage timed out.')), 15_000);
    try {
      const request = indexedDB.open('kodety-browser-agent-auth-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('accounts');
      request.onerror = () => finish(request.error || new Error('Account storage unavailable.'));
      request.onblocked = () => finish(new Error('Account storage is blocked.'));
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        try {
          const tx = db.transaction('accounts', operation === 'read' ? 'readonly' : 'readwrite');
          const store = tx.objectStore('accounts');
          const record = operation === 'read' ? store.get(key) : value === null ? store.delete(key) : store.put(value, key);
          tx.oncomplete = () => finish(undefined, operation === 'read' ? record.result as T : undefined);
          tx.onerror = () => finish(tx.error || new Error('Account transaction failed.'));
          tx.onabort = tx.onerror;
        } catch (error) { finish(error); }
      };
    } catch (error) { finish(error); }
  });
}

/** One runtime per project; each panel/settings client owns only its own waits. */
export function createBrowserAgentBinding(options: Options): AgentBackendBinding & { dispose(): void; refreshAccess(): Promise<void> } {
  let worker: WebContainerProcess | undefined;
  let starting: Promise<void> | undefined;
  let writer: WritableStreamDefaultWriter<string> | undefined;
  let writes = Promise.resolve();
  let disposed = false;
  let nextId = 1;
  let generation = 0;
  const bindingLifetime = new AbortController();
  const pending = new Map<string, Pending>();
  const abandoned = new Map<string, Pending>();
  const abandonedLogins = new Set<string>();
  const loginClaims = new Map<string, Set<AbortSignal>>();
  const consumers = new Set<AgentBackendCallbacks>();
  let lastConfig: Record<string, unknown> | undefined;
  let historyWarning: string | null = null;
  let historyReadable = true;
  const scope = crypto.randomUUID();
  const credentialScope = options.credentialScope || options.projectId;
  const credentialLeases = new Map<string, { requestId: string; release(): void; timer: ReturnType<typeof setTimeout> }>();
  const credentialLockWaits = new Map<string, AbortController>();
  function releaseCredentialLocks() {
    for (const controller of credentialLockWaits.values()) controller.abort();
    credentialLockWaits.clear();
    for (const lease of credentialLeases.values()) { clearTimeout(lease.timer); lease.release(); }
    credentialLeases.clear();
  }
  async function credentialOperation(message: Record<string, unknown>) {
    if (message.action === 'cancel') {
      credentialLockWaits.get(String(message.cancelId))?.abort();
      for (const [lockId, lease] of credentialLeases) if (lease.requestId === message.cancelId) {
        clearTimeout(lease.timer); lease.release(); credentialLeases.delete(lockId);
      }
      return {};
    }
    if (message.action === 'read') return { credentials: await credentialStore(credentialScope, 'read') || null };
    if (message.action === 'acquire') {
      const controller = new AbortController();
      credentialLockWaits.set(String(message.requestId), controller);
      const timeout = setTimeout(() => controller.abort(), 40_000);
      const signal = AbortSignal.any([bindingLifetime.signal, controller.signal]);
      try {
        const release = await acquireCredentialLock(credentialScope, signal);
        const lockId = crypto.randomUUID();
        const timer = setTimeout(() => { release(); credentialLeases.delete(lockId); }, 45_000);
        credentialLeases.set(lockId, { requestId: String(message.requestId), release, timer });
        try { return { lockId, credentials: await credentialStore(credentialScope, 'read') || null }; }
        catch (error) { clearTimeout(timer); release(); credentialLeases.delete(lockId); throw error; }
      } finally { clearTimeout(timeout); credentialLockWaits.delete(String(message.requestId)); }
    }
    if (message.action === 'release') {
      const lease = credentialLeases.get(String(message.lockId));
      if (lease) { clearTimeout(lease.timer); lease.release(); credentialLeases.delete(String(message.lockId)); }
      return {};
    }
    if (message.action && message.action !== 'write') throw new Error('Invalid account operation.');
    if (message.lockId && !credentialLeases.has(String(message.lockId))) throw new Error('Account lock expired.');
    const previous = credentialWriteQueues.get(credentialScope) || Promise.resolve();
    const commit = previous.catch(() => undefined).then(() => credentialStore(credentialScope, 'write', message.credentials));
    const settled = commit.then(() => undefined, () => undefined);
    credentialWriteQueues.set(credentialScope, settled);
    void settled.then(() => { if (credentialWriteQueues.get(credentialScope) === settled) credentialWriteQueues.delete(credentialScope); });
    await commit;
    return {};
  }
  const network = createBrowserAgentNetwork(options.network || {}, message => {
    const current = worker;
    return send('__network', { body: message }).then(result => {
      if (worker !== current) throw aborted();
      return result;
    });
  }, () => !disposed);

  function warnHistory(message: string | null) {
    if (historyWarning === message) return;
    historyWarning = message;
    if (!disposed && lastConfig) for (const callbacks of consumers) callbacks.onConfig?.({ ...lastConfig, historyWarning });
  }
  function failPending(error: Error) {
    for (const item of pending.values()) { item.cleanup(); item.reject(error); }
    pending.clear(); abandoned.clear(); abandonedLogins.clear(); loginClaims.clear();
  }
  function finishAbandonedLogins() {
    if (disposed || !worker) return;
    // A second panel can be waiting for the same deduplicated device login.
    if ([...pending.values()].some(item => item.suffix === 'rpc' && rpcBody(item.request)?.method === 'account/login/start')) return;
    for (const loginId of abandonedLogins) {
      abandonedLogins.delete(loginId);
      if ([...(loginClaims.get(loginId) || [])].some(signal => !signal.aborted)) continue;
      void send('rpc', { method: 'POST', body: { method: 'account/login/cancel', params: { loginId } } }).catch(() => undefined);
    }
  }
  function receive(line: string) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (disposed || message.channel !== 'kodety-agent') return;
    if (message.kind === 'network') { network.receive(message); return; }
    if (message.kind === 'attachments' && typeof message.requestId === 'string') {
      const previous = attachmentWriteQueues.get(options.projectId) || Promise.resolve();
      const commit = previous.catch(() => undefined).then(() => historyStore(options.projectId, 'write', message.state, 'kodety-browser-agent-attachments-v1'));
      const settled = commit.then(() => undefined, () => undefined);
      attachmentWriteQueues.set(options.projectId, settled);
      void settled.then(() => { if (attachmentWriteQueues.get(options.projectId) === settled) attachmentWriteQueues.delete(options.projectId); });
      void commit.then(() => {
        if (!disposed) return send('__attachments/ack', { body: { requestId: message.requestId, ok: true } });
      }, () => {
        if (!disposed) return send('__attachments/ack', { body: { requestId: message.requestId, ok: false } });
      }).catch(() => undefined);
      return;
    }
    if (message.kind === 'credentials' && typeof message.requestId === 'string') {
      void credentialOperation(message).then(result => {
        if (!disposed) return send('__credentials/ack', { body: { requestId: message.requestId, ok: true, ...result } });
      }, () => {
        if (!disposed) return send('__credentials/ack', { body: { requestId: message.requestId, ok: false } });
      }).catch(() => undefined);
      return;
    }
    if (message.kind === 'history' && message.snapshot) {
      if (!historyReadable) return; // Never overwrite history that could not be read.
      const previous = historyWriteQueues.get(options.projectId) || Promise.resolve();
      const write = previous.then(() => historyStore(options.projectId, 'write', message.snapshot)).then(() => {
        warnHistory(null);
      }, () => {
        warnHistory('Não foi possível salvar o histórico neste navegador. A conversa continua nesta sessão.');
      });
      historyWriteQueues.set(options.projectId, write);
      void write.then(() => { if (historyWriteQueues.get(options.projectId) === write) historyWriteQueues.delete(options.projectId); });
      return;
    }
    const messageId = String(message.id);
    const item = pending.get(messageId);
    const orphan = abandoned.get(messageId);
    if (!item && !orphan) return;
    abandoned.delete(messageId);
    if (!message.error && rpcBody((item || orphan)!.request)?.method === 'account/login/start') {
      const loginId = message.result?.loginId;
      if (typeof loginId === 'string') {
        if (item?.request.signal && !item.request.signal.aborted) {
          const claims = loginClaims.get(loginId) || new Set<AbortSignal>();
          claims.add(item.request.signal); loginClaims.set(loginId, claims);
        } else abandonedLogins.add(loginId);
      }
    }
    if (orphan && !message.error && rpcBody(orphan.request)?.method === 'turn/start' && message.result?.turn?.id) {
      void send('rpc', { method: 'POST', body: { method: 'turn/interrupt', params: {
        threadId: rpcBody(orphan.request)?.params?.threadId, turnId: message.result.turn.id,
      } } }).catch(() => undefined);
    }
    if (item) {
      pending.delete(messageId); item.cleanup();
      if (message.error) {
        const error = Object.assign(new Error(String(message.error.message || 'O Agent não conseguiu concluir esta operação.')),
          { code: message.error.code, status: message.error.status, payload: message.error.payload });
        item.reject(error);
      } else item.resolve(message.result);
    }
    queueMicrotask(finishAbandonedLogins);
  }
  async function send(suffix: string, request: AgentRuntimeRequestOptions = {}): Promise<unknown> {
    if (disposed || request.signal?.aborted) throw aborted();
    const id = `${scope}-${nextId++}`;
    return new Promise((resolve, reject) => {
      const abandon = (error: Error) => {
        const item = pending.get(id);
        if (!item) return;
        pending.delete(id); item.cleanup();
        if (item.written && suffix === 'rpc' && ['account/login/start', 'turn/start'].includes(String(rpcBody(request)?.method))) {
          abandoned.set(id, item);
          if (abandoned.size > 128) abandoned.delete(abandoned.keys().next().value!);
        }
        reject(error); queueMicrotask(finishAbandonedLogins);
      };
      const abort = () => abandon(aborted());
      const timer = setTimeout(() => abandon(failure('agent_browser_timeout', 'O Agent demorou para responder.')), 45_000);
      const cleanup = () => { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); };
      pending.set(id, { resolve, reject, cleanup, request, suffix, written: false });
      request.signal?.addEventListener('abort', abort, { once: true });
      writes = writes.then(async () => {
        const item = pending.get(id);
        if (!item) return;
        if (!writer || disposed) throw aborted();
        item.written = true;
        await writer.write(JSON.stringify({ id, suffix, options: { method: request.method, body: request.body },
          policy: { licensed: true, readOnly: options.isReadOnly?.() === true } }) + '\n');
      }).catch(error => {
        const item = pending.get(id);
        if (item) { pending.delete(id); item.cleanup(); item.reject(error); }
      });
    });
  }
  async function start() {
    if (disposed) throw aborted();
    if (!options.runtimeUrl?.trim()) throw failure('agent_browser_assets_unavailable', 'O pacote do Agent não está disponível nesta instalação.', 'Atualize os arquivos do Kodety e tente novamente.', false);
    if (!starting) {
      const attempt = ++generation;
      const startup = new AbortController();
      const startupTimedOut = () => failure('agent_browser_start_failed',
        'O Agent demorou para iniciar no navegador.', 'Confira a conexão, atualize o navegador e tente novamente.');
      const startupTimer = setTimeout(() => startup.abort(startupTimedOut()), 120_000);
      const signal = AbortSignal.any([bindingLifetime.signal, startup.signal]);
      let process: WebContainerProcess | undefined;
      let wc: WebContainer | undefined;
      const filename = `agent-${scope}-${attempt}.mjs`;
      const cleanupFile = () => { void wc?.fs.rm(filename).catch(() => undefined); };
      starting = (async () => {
        wc = await cancellable(container(), signal);
        signal.throwIfAborted();
        const url = new URL(options.runtimeUrl, document.baseURI);
        if (url.origin !== location.origin) throw failure('agent_browser_invalid_runtime', 'O pacote do Agent precisa pertencer a esta instalação.');
        const response = await cancellable(fetch(url, { signal, credentials: 'same-origin', redirect: 'error', cache: 'no-cache' }), signal);
        if (!response.ok) throw failure('agent_browser_missing_runtime', 'O pacote do Agent não foi encontrado.', 'Atualize os arquivos do Kodety e tente novamente.');
        const source = await cancellable(response.text(), signal);
        signal.throwIfAborted();
        const writing = wc.fs.writeFile(filename, source);
        void writing.then(() => { if (signal.aborted) cleanupFile(); }, () => undefined);
        await cancellable(writing, signal);
        signal.throwIfAborted();
        const spawning = wc.spawn('node', [filename]);
        void spawning.then(value => { if (signal.aborted) { value.kill(); cleanupFile(); } }, () => undefined);
        process = await cancellable(spawning, signal);
        if (signal.aborted) { process.kill(); throw aborted(); }
        const ownProcess = process;
        worker = process; writer = process.input.getWriter(); writes = Promise.resolve();
        let signalReady: () => void = () => undefined;
        const ready = new Promise<void>(resolve => { signalReady = resolve; });
        let buffered = '';
        void process.output.pipeTo(new WritableStream({ write(chunk) {
          if (disposed || worker !== ownProcess) return;
          buffered += chunk;
          let index;
          while ((index = buffered.indexOf('\n')) >= 0) {
            const line = buffered.slice(0, index).trim(); buffered = buffered.slice(index + 1);
            try { const message = JSON.parse(line); if (message.channel === 'kodety-agent' && message.kind === 'ready') signalReady(); } catch { /* Ignore Node diagnostics. */ }
            receive(line);
          }
          if (buffered.length > 32_000_000) ownProcess.kill();
        } })).catch(() => { if (worker === ownProcess) ownProcess.kill(); });
        void process.exit.then(() => {
          cleanupFile();
          if (worker !== ownProcess) return;
          network.dispose();
          releaseCredentialLocks();
          worker = undefined; writer = undefined;
          if (generation === attempt) starting = undefined;
          failPending(failure('agent_browser_stopped', 'A execução do Agent no navegador foi interrompida.'));
          startup.abort();
        });
        const readyTimer = setTimeout(() => startup.abort(startupTimedOut()), 45_000);
        try { await cancellable(ready, signal); } finally { clearTimeout(readyTimer); }
        await cancellable(historyWriteQueues.get(options.projectId) || Promise.resolve(), signal);
        let snapshot;
        try {
          snapshot = await cancellable(historyStore(options.projectId, 'read'), signal);
          historyReadable = true;
        } catch (error) {
          if (signal.aborted) throw error;
          historyReadable = false;
          warnHistory('Não foi possível recuperar o histórico neste navegador. A nova conversa ficará nesta sessão.');
        }
        signal.throwIfAborted();
        await cancellable(credentialWriteQueues.get(credentialScope) || Promise.resolve(), signal);
        await cancellable(attachmentWriteQueues.get(options.projectId) || Promise.resolve(), signal);
        let attachments;
        try { attachments = await cancellable(historyStore(options.projectId, 'read', undefined, 'kodety-browser-agent-attachments-v1'), signal); }
        catch (error) {
          if (signal.aborted) throw error;
          throw failure('agent_browser_attachments_storage', 'Não foi possível recuperar os anexos salvos neste navegador.',
            'Permita o armazenamento deste site no navegador e tente novamente.');
        }
        let credentials;
        try { credentials = await cancellable(credentialStore(credentialScope, 'read'), signal); }
        catch (error) {
          if (signal.aborted) throw error;
          throw failure('agent_browser_credentials_unavailable', 'Não foi possível recuperar a conta salva neste navegador.',
            'Permita o armazenamento deste site no navegador e tente novamente.');
        }
        signal.throwIfAborted();
        await send('__init', { signal, body: { projectId: options.projectId, snapshot, credentials, attachments, networkBridge: true, credentialPersistence: true, attachmentPersistence: true } });
      })().catch(error => {
        process?.kill(); cleanupFile();
        if (worker === process) { worker = undefined; writer = undefined; }
        if (generation === attempt) starting = undefined;
        if (bindingLifetime.signal.aborted) throw aborted();
        if (startup.signal.aborted && startup.signal.reason?.code === 'agent_browser_start_failed') throw startup.signal.reason;
        throw error instanceof Error && 'code' in error ? error : failure('agent_browser_start_failed',
          'Não foi possível iniciar o Agent no navegador.', 'Confira a conexão, atualize o navegador e tente novamente.');
      }).finally(() => clearTimeout(startupTimer));
    }
    return starting;
  }

  function createBackend(callbacks: AgentBackendCallbacks): AgentBackend {
    let lifetime = new AbortController();
    return {
      remote: false,
      async request(suffix, request = {}) {
        const signals = [bindingLifetime.signal, lifetime.signal, request.signal].filter((signal): signal is AbortSignal => Boolean(signal));
        const signal = AbortSignal.any(signals);
        if (signal.aborted || disposed) throw aborted();
        consumers.add(callbacks);
        await cancellable(start(), signal);
        const result = await send(suffix, { ...request, signal });
        if (suffix === 'config' || suffix === 'config/retry') {
          lastConfig = result as Record<string, unknown>;
          const config = { ...lastConfig, historyWarning };
          callbacks.onConfig?.(config); return config;
        }
        return result;
      },
      async uploadAttachment(file) {
        if (file.size < 1 || file.size > 10 * 1024 * 1024) throw failure('agent_attachment_invalid', 'Envie um arquivo de até 10 MB.');
        const signal = AbortSignal.any([bindingLifetime.signal, lifetime.signal]);
        const bytes = new Uint8Array(await cancellable(file.arrayBuffer(), signal));
        signal.throwIfAborted();
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        return this.request('attachments', { signal, body: { name: file.name, mimeType: file.type, contentBase64: btoa(binary) } });
      },
      cancelAll() { lifetime.abort(); lifetime = new AbortController(); consumers.delete(callbacks); },
    };
  }
  return {
    key: `webcontainer:${options.projectId}`,
    createBackend,
    async refreshAccess() {
      if (!worker || disposed) return;
      await send('__policy');
    },
    dispose() {
      if (disposed) return;
      disposed = true; bindingLifetime.abort(); consumers.clear();
      network.dispose();
      releaseCredentialLocks();
      failPending(aborted());
      // No live editor remains to serve tool calls. Terminate its runtime and
      // release process memory. Explicit logout deletes the browser account.
      worker?.kill(); worker = undefined; writer = undefined;
    },
  };
}
