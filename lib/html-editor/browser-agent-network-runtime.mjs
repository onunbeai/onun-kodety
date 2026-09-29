// Fetch inside a WebContainer still obeys browser CORS. Only the five fixed
// provider operations cross this bridge; the Agent and tools stay in its process.
const operations = new Map([
  ['https://auth.openai.com/api/accounts/deviceauth/usercode', 'device-code'],
  ['https://auth.openai.com/api/accounts/deviceauth/token', 'device-token'],
  ['https://auth.openai.com/oauth/token', 'oauth-token'],
  ['https://chatgpt.com/backend-api/codex/responses', 'responses'],
  ['https://chatgpt.com/backend-api/wham/usage', 'usage'],
]);
const networkError = () => Object.assign(new Error('Agent network relay unavailable.'), { code: 'agent_network' });

export function createBrowserAgentNetworkFetch(emit) {
  const pending = new Map();
  function finish(requestId, error) {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    entry.cleanup();
    if (error) { entry.reject(error); entry.controller?.error(error); }
    else entry.controller?.close();
  }
  return {
    async fetch(input, init = {}) {
      const request = new Request(input, init);
      const operation = operations.get(request.url);
      if (!operation || request.method !== (operation === 'usage' ? 'GET' : 'POST')) throw networkError();
      request.signal.throwIfAborted();
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > 16 * 1024 * 1024 || pending.size >= 8) throw networkError();
      request.signal.throwIfAborted();
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const abort = () => {
          emit({ kind: 'network', action: 'cancel', requestId });
          finish(requestId, new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
          emit({ kind: 'network', action: 'cancel', requestId });
          finish(requestId, networkError());
        }, 300_000);
        const entry = { resolve, reject, controller: null, received: 0, cleanup: () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); } };
        pending.set(requestId, entry);
        request.signal.addEventListener('abort', abort, { once: true });
        emit({ kind: 'network', action: 'request', requestId, request: {
          operation, headers: Object.fromEntries(request.headers), body: Buffer.from(bytes).toString('base64'),
        } });
        if (request.signal.aborted) abort();
      });
    },
    receive(message) {
      const entry = pending.get(message?.requestId);
      if (!entry) return;
      if (message.action === 'error') {
        const error = networkError();
        if (message.code === 'agent_browser_network_unavailable') error.code = message.code;
        finish(message.requestId, error); return;
      }
      if (message.action === 'headers') {
        if (entry.controller || !Number.isInteger(message.status) || message.status < 200 || message.status > 599) { finish(message.requestId, networkError()); return; }
        const stream = new ReadableStream({
          start(controller) { entry.controller = controller; },
          cancel() { emit({ kind: 'network', action: 'cancel', requestId: message.requestId }); pending.delete(message.requestId); entry.cleanup(); },
        });
        entry.resolve(new Response([204, 205, 304].includes(message.status) ? null : stream, { status: message.status, headers: message.headers }));
      } else if (message.action === 'chunk') {
        if (!entry.controller || typeof message.chunk !== 'string' || message.chunk.length > 100_000) { finish(message.requestId, networkError()); return; }
        const bytes = Buffer.from(message.chunk, 'base64');
        entry.received += bytes.length;
        if (entry.received > 32 * 1024 * 1024) { finish(message.requestId, networkError()); return; }
        entry.controller.enqueue(bytes);
      } else if (message.action === 'end') finish(message.requestId);
    },
    dispose() { for (const requestId of pending.keys()) finish(requestId, networkError()); },
  };
}
