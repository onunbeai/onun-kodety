import type { HTTPMethod, PlaygroundClient } from '@wp-playground/client';

const RELAY_PREFIX = '/__kodety_mcp__/v1/projects/';
const BRIDGE_TOKEN_KEY_PREFIX = 'kodety-studio:mcp-relay:';
const HTTP_METHODS = new Set<HTTPMethod>(['GET', 'POST', 'HEAD', 'OPTIONS', 'PATCH', 'PUT', 'DELETE']);

type RelayEnvelope = {
  requestId: string;
  method: HTTPMethod;
  path: '/wp-json/kodety/v1/mcp';
  headers: Record<string, string>;
  bodyBase64: string;
};

type RelayConnection = {
  bridgeToken: string;
  mcpUrl: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!value) return new Uint8Array(new ArrayBuffer(0));
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function relayProjectBase(projectId: string): string | null {
  if (!['http:', 'https:'].includes(window.location.protocol)) return null;
  if (!/^[a-z0-9-]{8,80}$/i.test(projectId)) return null;
  return `${RELAY_PREFIX}${encodeURIComponent(projectId)}/`;
}

function storedBridgeToken(projectId: string): string {
  try {
    return window.localStorage.getItem(`${BRIDGE_TOKEN_KEY_PREFIX}${projectId}`) || '';
  } catch {
    return '';
  }
}

function storeBridgeToken(projectId: string, token: string): void {
  try {
    window.localStorage.setItem(`${BRIDGE_TOKEN_KEY_PREFIX}${projectId}`, token);
  } catch {
    // The active in-memory connection still works if storage is unavailable.
  }
}

async function relayFetch(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Kodety-Studio-Bridge': '1',
    },
    body: JSON.stringify(body),
    signal,
  });
}

function validEnvelope(value: unknown): value is RelayEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<RelayEnvelope>;
  return typeof envelope.requestId === 'string'
    && typeof envelope.method === 'string'
    && HTTP_METHODS.has(envelope.method as HTTPMethod)
    && envelope.path === '/wp-json/kodety/v1/mcp'
    && !!envelope.headers
    && typeof envelope.headers === 'object'
    && typeof envelope.bodyBase64 === 'string';
}

async function respondToRelayRequest(
  client: PlaygroundClient,
  projectBase: string,
  bridgeToken: string,
  envelope: RelayEnvelope,
  signal: AbortSignal,
): Promise<void> {
  let status = 502;
  let headers: Record<string, string | string[]> = { 'content-type': 'application/json; charset=utf-8' };
  let responseBytes = new TextEncoder().encode(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32004, message: 'O WordPress local não conseguiu processar a chamada MCP.' },
  }));

  try {
    const requestBytes = base64ToBytes(envelope.bodyBase64);
    const response = await client.request({
      url: envelope.path,
      method: envelope.method,
      headers: envelope.headers,
      body: requestBytes.byteLength > 0 ? requestBytes : undefined,
    });
    status = response.httpStatusCode;
    headers = response.headers;
    responseBytes = ownedBytes(response.bytes);
  } catch (error) {
    responseBytes = new TextEncoder().encode(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32004,
        message: error instanceof Error ? error.message : 'Falha ao acessar o WordPress local.',
      },
    }));
  }

  const response = await relayFetch(`${projectBase}bridge/respond`, {
    bridgeToken,
    requestId: envelope.requestId,
    status,
    headers,
    bodyBase64: bytesToBase64(responseBytes),
  }, signal);
  if (!response.ok && response.status !== 404) {
    throw new Error(`O relay MCP recusou a resposta (${response.status}).`);
  }
}

/**
 * Maintains the outbound half of the Studio MCP tunnel. The public relay never
 * sees or persists WordPress credentials: it forwards the Authorization header
 * to this active Playground runtime, where the plugin performs its normal
 * bearer validation and capability checks.
 */
export function connectStudioMcpRelay(client: PlaygroundClient, projectId: string): () => void {
  const projectBase = relayProjectBase(projectId);
  if (!projectBase) return () => undefined;

  const controller = new AbortController();
  let bridgeToken = storedBridgeToken(projectId);
  let retryDelay = 500;

  const waitBeforeRetry = () => new Promise<void>(resolve => {
    const timer = window.setTimeout(resolve, retryDelay);
    controller.signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
    retryDelay = Math.min(10_000, retryDelay * 2);
  });

  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const connectResponse = await relayFetch(`${projectBase}bridge/connect`, { bridgeToken }, controller.signal);
        if (!connectResponse.ok) throw new Error(`Não foi possível conectar o relay MCP (${connectResponse.status}).`);
        const connection = await connectResponse.json() as Partial<RelayConnection>;
        if (typeof connection.bridgeToken !== 'string' || !connection.bridgeToken) {
          throw new Error('O relay MCP não entregou uma sessão válida.');
        }
        bridgeToken = connection.bridgeToken;
        storeBridgeToken(projectId, bridgeToken);
        retryDelay = 500;

        while (!controller.signal.aborted) {
          const pollResponse = await relayFetch(`${projectBase}bridge/poll`, { bridgeToken }, controller.signal);
          if (pollResponse.status === 204) continue;
          if (!pollResponse.ok) throw new Error(`A ponte MCP foi interrompida (${pollResponse.status}).`);
          const envelope = await pollResponse.json();
          if (!validEnvelope(envelope)) throw new Error('O relay MCP enviou uma chamada inválida.');
          await respondToRelayRequest(client, projectBase, bridgeToken, envelope, controller.signal);
        }
      } catch (error) {
        if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return;
        await waitBeforeRetry();
      }
    }
  };

  void run();
  return () => {
    if (controller.signal.aborted) return;
    controller.abort();
    if (!bridgeToken) return;
    void fetch(`${projectBase}bridge/disconnect`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Kodety-Studio-Bridge': '1',
      },
      body: JSON.stringify({ bridgeToken }),
    }).catch(() => undefined);
  };
}
