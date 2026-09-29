export type AgentNetworkRequest = { operation: string; headers: Record<string, string>; body: string };
export type AgentNetworkMessage = { action: string; requestId: string; request?: AgentNetworkRequest; status?: number; headers?: Record<string, string>; chunk?: string; code?: string };
export type AgentNetworkOptions = {
  url?: string;
  headers?: () => Record<string, string>;
  // The Studio owns networking when WordPress runs in its Playground frame.
  studio?: { origin: string; projectId: string };
};
type Send = (message: AgentNetworkMessage) => Promise<unknown>;
const operations = new Set(['device-code', 'device-token', 'oauth-token', 'responses', 'usage']);
const unavailable = () => Object.assign(new Error('O serviço de conexão do Agent não está disponível nesta hospedagem. Atualize o servidor do Studio ou o plugin WordPress.'), { code: 'agent_browser_network_unavailable' });

export function validAgentNetworkRequest(value: unknown): value is AgentNetworkRequest {
  const request = value as AgentNetworkRequest;
  return Boolean(request && operations.has(request.operation) && typeof request.body === 'string' && request.body.length <= 24 * 1024 * 1024
    && /^[A-Za-z0-9+/]*={0,2}$/.test(request.body) && request.headers && typeof request.headers === 'object' && !Array.isArray(request.headers)
    && Object.keys(request.headers).length <= 32 && Object.entries(request.headers).every(([key, value]) => key.length <= 100 && typeof value === 'string' && value.length <= 32_000));
}

export async function fetchAgentNetwork(request: AgentNetworkRequest, options: AgentNetworkOptions, signal: AbortSignal): Promise<Response> {
  if (!validAgentNetworkRequest(request)) throw unavailable();
  const url = new URL(options.url || '/__kodety_agent__/network', document.baseURI);
  if (url.origin !== location.origin) throw unavailable();
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-Kodety-Agent-Network': '1', ...options.headers?.() }, body: JSON.stringify(request) });
  if (response.headers.get('X-Kodety-Agent-Relay') !== '1') { await response.body?.cancel(); throw unavailable(); }
  return response;
}

export async function relayAgentNetworkResponse(requestId: string, response: Response, send: Send, signal: AbortSignal) {
  const reader = response.body?.getReader();
  let length = 0;
  try {
    await send({ action: 'headers', requestId, status: response.status, headers: Object.fromEntries(['content-type', 'retry-after'].flatMap(key => {
      const value = response.headers.get(key); return value ? [[key, value]] : [];
    })) });
    while (reader) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32 * 1024 * 1024) throw unavailable();
      for (let offset = 0; offset < value.length; offset += 32_768) {
        await send({ action: 'chunk', requestId, chunk: btoa(String.fromCharCode(...value.subarray(offset, offset + 32_768))) });
      }
    }
    await send({ action: 'end', requestId });
  } finally { await reader?.cancel().catch(() => undefined); }
}

function relayViaStudio(message: AgentNetworkMessage, options: NonNullable<AgentNetworkOptions['studio']>, send: Send, signal: AbortSignal): Promise<void> {
  const origin = new URL(options.origin).origin;
  if (!/^https?:$/.test(new URL(origin).protocol) || window.top === window) return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let chain = Promise.resolve();
    const close = () => { channel.port1.close(); signal.removeEventListener('abort', abort); clearTimeout(timer); };
    const abort = () => { channel.port1.postMessage({ action: 'cancel' }); close(); reject(unavailable()); };
    const timer = setTimeout(abort, 300_000);
    signal.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = event => {
      const response = event.data as AgentNetworkMessage;
      if (response?.requestId !== message.requestId) return;
      chain = chain.then(async () => {
        await send(response);
        channel.port1.postMessage({ action: 'ack' });
        if (response.action === 'end' || response.action === 'error') { close(); resolve(); }
      }).catch(() => { close(); reject(unavailable()); });
    };
    window.top!.postMessage({ source: 'kodety-studio-wordpress', version: 1, type: 'agent-network', projectId: options.projectId, ...message }, origin, [channel.port2]);
    if (signal.aborted) abort();
  });
}

export function createBrowserAgentNetwork(options: AgentNetworkOptions, send: Send, isAllowed: () => boolean) {
  const active = new Map<string, AbortController>();
  return {
    receive(message: AgentNetworkMessage) {
      if (message?.action === 'cancel') { active.get(message.requestId)?.abort(); return; }
      if (message?.action !== 'request' || typeof message.requestId !== 'string') return;
      if (!isAllowed() || active.size >= 8 || active.has(message.requestId) || !validAgentNetworkRequest(message.request)) {
        void send({ action: 'error', requestId: message.requestId }); return;
      }
      const controller = new AbortController();
      active.set(message.requestId, controller);
      const timer = setTimeout(() => controller.abort(), 300_000);
      void (async () => {
        if (options.studio) await relayViaStudio(message, options.studio, send, controller.signal);
        else await relayAgentNetworkResponse(message.requestId, await fetchAgentNetwork(message.request!, options, controller.signal), send, controller.signal);
      })().catch(error => send({ action: 'error', requestId: message.requestId, ...(error?.code === 'agent_browser_network_unavailable' ? { code: error.code } : {}) }).catch(() => undefined))
        .finally(() => { clearTimeout(timer); active.delete(message.requestId); });
    },
    dispose() { for (const controller of active.values()) controller.abort(); active.clear(); },
  };
}
