import type { McpProjectConnectionSummary, McpStatusState } from '../../../app/(builder)/kodety/html-editor/components/HtmlMcpSettingsContent';
import { createHtmlMcpRequestHandler, type HtmlMcpTool } from './html-mcp-protocol';

type StoredConnection = McpProjectConnectionSummary & { digest: string };
export interface HtmlMcpSnapshot { status: McpStatusState; connections: McpProjectConnectionSummary[]; error: string; loading: boolean }
export interface HtmlMcpController {
  start(): void;
  suspend(): Promise<void>;
  getSnapshot(): HtmlMcpSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  createConnection(): Promise<string>;
  revokeConnection(id: string): Promise<void>;
  changeConnection(operation: 'enable' | 'rotate' | 'disable'): Promise<string | void>;
  dispose(): void;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
const bytes = (encoded: string) => Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
const digest = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');

export function createHtmlMcpControllerCore(options: {
  projectId: string;
  projectName: string;
  siteUrl: string;
  assertAvailable(): Promise<void>;
  saveProject(): Promise<void>;
  tools: readonly HtmlMcpTool[];
  available(): boolean;
  invoke(tool: string, args: Record<string, unknown>, identity: { connectionId: string; requestId: string }): Promise<unknown>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  fetcher?: typeof fetch;
}): HtmlMcpController {
  if (!/^[a-z0-9-]{8,80}$/i.test(options.projectId)) throw new Error('Invalid HTML project identity.');
  const origin = new URL(options.siteUrl).origin;
  const base = `${origin}/__kodety_mcp__/v1/projects/${options.projectId}/`;
  let storage = options.storage;
  try { storage ??= globalThis.localStorage; } catch { /* Browser privacy settings can reject access to the storage object itself. */ }
  storage ??= { getItem: () => null, setItem: () => { throw new Error('Permita o armazenamento privado deste site para criar conexões MCP.'); } };
  const fetcher = options.fetcher ?? fetch;
  const key = `kodetyStudioHtmlMcpV1:${options.projectId}`;
  let records: StoredConnection[] = [];
  let bridgeToken = '';
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null');
    if (Array.isArray(saved?.connections)) records = saved.connections.filter((item: StoredConnection) => item?.projectId === options.projectId && /^[a-f0-9]{64}$/.test(item.digest) && /^[a-z0-9-]{8,80}$/i.test(item.id)).slice(0, 20);
    if (/^[A-Za-z0-9_-]{32,128}$/.test(saved?.bridgeToken)) bridgeToken = saved.bridgeToken;
  } catch { /* Missing private browser state starts with no authorized clients. */ }
  const listeners = new Set<() => void>();
  let connected = false, loading = false, error = '', disposed = false, generation = 0;
  let active: AbortController | null = null;
  let connecting: Promise<void> | null = null;
  let stopping: Promise<void> = Promise.resolve();
  let snapshot: HtmlMcpSnapshot;
  const persist = (next = records) => storage.setItem(key, JSON.stringify({ version: 1, bridgeToken, connections: next }));
  const update = () => {
    snapshot = { status: { enabled: connected && records.length > 0, configured: records.length > 0, browserStudio: true, siteUrl: options.siteUrl, ...(connected ? { remoteUrl: `${base}mcp` } : {}) },
      connections: records.map(({ digest: _digest, ...summary }) => summary), error, loading };
    listeners.forEach(listener => listener());
  };
  update();
  const requireAvailable = async () => {
    const currentGeneration = generation;
    if (disposed) throw new Error('This HTML project was closed.');
    try { await options.assertAvailable(); } catch { throw Object.assign(new Error('MCP is unavailable in this environment.'), { status: 403 }); }
    if (disposed || currentGeneration !== generation) throw new Error('This HTML project was closed.');
  };
  const handle = createHtmlMcpRequestHandler({ ...options,
    authorize: async token => {
      await requireAvailable();
      const tokenDigest = await digest(token);
      const connection = records.find(record => record.digest === tokenDigest);
      if (!connection) throw new Error('MCP credential revoked or invalid.');
      return connection.id;
    },
    invoke: async (tool, args, identity) => {
      await requireAvailable();
      if (!records.some(record => record.id === identity.connectionId)) throw new Error('MCP connection was revoked.');
      return options.invoke(tool, args, identity);
    },
  });
  const requestBridge = (action: string, body: Record<string, unknown>, signal?: AbortSignal) => fetcher(`${base}bridge/${action}`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Kodety-Studio-Bridge': '1' },
    body: JSON.stringify(body), signal,
  });
  const stop = () => {
    active?.abort(); active = null; connected = false; loading = false;
    update();
    const token = bridgeToken;
    stopping = stopping.then(async () => { if (token) await requestBridge('disconnect', { bridgeToken: token }, AbortSignal.timeout(10_000)).catch(() => undefined); });
    return stopping;
  };
  const poll = async (controller: AbortController) => {
    while (!controller.signal.aborted) {
      const response = await requestBridge('poll', { bridgeToken }, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
      if (response.status === 204) continue;
      if (!response.ok) throw new Error('A ponte MCP foi interrompida. Atualize a conexão para reconectar.');
      const envelope = await response.json();
      if (envelope.path !== '/kodety/html/mcp' || typeof envelope.requestId !== 'string' || typeof envelope.method !== 'string' || typeof envelope.bodyBase64 !== 'string' || !envelope.headers || typeof envelope.headers !== 'object') throw new Error('O relay enviou uma chamada MCP incompatível.');
      const content = bytes(envelope.bodyBase64);
      const result = await handle(new Request(`${base}mcp`, { method: envelope.method, headers: envelope.headers, ...(['GET', 'HEAD'].includes(envelope.method) ? {} : { body: content }), signal: controller.signal }));
      const answered = await requestBridge('respond', { bridgeToken, requestId: envelope.requestId, status: result.status, headers: Object.fromEntries(result.headers), bodyBase64: base64(new Uint8Array(await result.arrayBuffer())) }, controller.signal);
      if (!answered.ok && answered.status !== 404) throw new Error('O relay não confirmou a resposta. Consulte o projeto antes de repetir a operação.');
    }
  };
  const connect = async () => {
    const currentGeneration = generation;
    await stopping;
    await requireAvailable();
    if (disposed || currentGeneration !== generation) throw new Error('This HTML project was closed.');
    if (connected) return;
    if (connecting) return connecting;
    const controller = new AbortController();
    active = controller;
    const pending = (async () => {
      loading = true; error = ''; update();
      try {
        const response = await requestBridge('connect', { bridgeToken, mode: 'html' }, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
        if (!response.ok) throw new Error('Este endereço precisa do servidor Node do Onun Kodety para conectar MCP. Use o pacote com servidor e tente novamente.');
        const connection = await response.json();
        if (!/^[A-Za-z0-9_-]{32,128}$/.test(connection.bridgeToken) || connection.mcpUrl !== `${base}mcp` || connection.mode !== 'html') throw new Error('O servidor não oferece a ponte MCP para HTML. Atualize o pacote do Studio com servidor.');
        controller.signal.throwIfAborted();
        bridgeToken = connection.bridgeToken; persist(); connected = true;
        void poll(controller).catch(cause => {
          if (controller.signal.aborted || disposed || active !== controller) return;
          connected = false; error = cause instanceof Error ? cause.message : 'A conexão MCP foi interrompida.'; controller.abort(); active = null; update();
        });
      } catch (cause) {
        if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : 'Não foi possível conectar MCP.';
        controller.abort(); if (active === controller) active = null;
        throw cause;
      } finally { if (currentGeneration === generation) { loading = false; update(); } }
    })();
    connecting = pending;
    try { await pending; } finally { if (connecting === pending) connecting = null; }
  };
  const controller: HtmlMcpController = {
    start() { if (!disposed) return; disposed = false; generation++; connecting = null; },
    suspend() { generation++; connecting = null; return stop(); },
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: async () => { if (records.length) await connect(); else update(); },
    async createConnection() {
      const currentGeneration = generation;
      if (records.length >= 20) throw new Error('Revogue uma conexão antes de criar outra (limite de 20 por projeto).');
      await connect();
      await requireAvailable();
      if (disposed || currentGeneration !== generation) throw new Error('This HTML project was closed.');
      const token = `kodety_html_${base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`;
      const item: StoredConnection = { id: crypto.randomUUID(), name: `Cliente MCP ${records.length + 1}`, projectId: options.projectId, projectName: options.projectName, createdAt: new Date().toISOString(), currentProject: true, digest: await digest(token) };
      if (disposed || currentGeneration !== generation) throw new Error('This HTML project was closed.');
      const next = [...records, item]; persist(next); records = next; error = ''; update();
      return JSON.stringify({ mcpServers: { 'kodety-html': { url: `${base}mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
    },
    async revokeConnection(id) { const next = records.filter(item => item.id !== id); persist(next); records = next; if (!records.length) await stop(); else update(); },
    async changeConnection(operation) {
      if (operation !== 'enable') { persist([]); records = []; await stop(); }
      if (operation !== 'disable') return controller.createConnection();
    },
    dispose() { if (disposed) return; disposed = true; generation++; connecting = null; void stop(); listeners.clear(); },
  };
  return controller;
}
