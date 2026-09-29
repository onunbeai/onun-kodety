import type { AgentRuntimeRequestOptions } from './agent-runtime-setup';

export interface AgentTransportError extends Error {
  status?: number;
  code?: string;
  payload?: unknown;
  outcomeUnknown?: boolean;
}

type Fetcher = typeof fetch;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 2; depth += 1) {
    const candidate = object(current);
    if (Object.keys(candidate).length !== 1 || !Object.hasOwn(candidate, 'result')) break;
    current = candidate.result;
  }
  return current;
}

/** Preserve WordPress installations that use ?rest_route= instead of permalinks. */
export function agentEndpoint(base: string, suffix: string, pageUrl: string): string {
  const url = new URL(base, pageUrl);
  if (url.origin !== new URL(pageUrl).origin || url.username || url.password) {
    throw Object.assign(new Error('A rota do Agent precisa pertencer a este WordPress.'), { code: 'agent_not_configured' });
  }
  const child = `/${suffix.replace(/^\/+/, '')}`;
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute) url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}${child}`);
  else url.pathname = `${url.pathname.replace(/\/$/, '')}${child}`;
  return url.toString();
}

function abortError(): DOMException {
  return new DOMException('Conexão interrompida.', 'AbortError');
}

/** Agent RPC stays on the configured WordPress origin, with its normal user authorization. */
export class AgentTransport {
  private lifetime = new AbortController();
  private readonly fetcher: Fetcher;

  constructor(private readonly options: {
    agentUrl: string; nonce: string; pageUrl: string; fetch?: Fetcher;
    now?: () => number; allowLocalhostGateway?: boolean;
    onDenied?: (error: AgentTransportError) => void;
    onConfig?: (config: Record<string, unknown>) => void;
  }) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get remote(): boolean { return false; }

  cancelAll(): void {
    this.lifetime.abort();
    this.lifetime = new AbortController();
  }

  private async readResponse(response: Response): Promise<unknown> {
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const candidate = object(payload);
      throw Object.assign(new Error(text(candidate.message) || text(candidate.error) || 'O Agent não respondeu.'), {
        status: response.status, code: text(candidate.code), payload,
      });
    }
    if (payload === null) throw Object.assign(new Error('Resposta inválida do Agent.'), { code: 'agent_invalid_response', status: response.status });
    return unwrap(payload);
  }

  private async wordpressRequest(suffix: string, options: AgentRuntimeRequestOptions, form?: FormData): Promise<unknown> {
    if (!this.options.agentUrl) throw Object.assign(new Error('A rota do Agent não está disponível nesta página.'), { code: 'agent_not_configured' });
    const response = await this.fetcher(agentEndpoint(this.options.agentUrl, suffix, this.options.pageUrl), {
      method: options.method ?? 'POST', signal: options.signal,
      credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: {
        'X-WP-Nonce': this.options.nonce,
        ...(form || options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(form ? { body: form } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return this.readResponse(response);
  }

  request = async (suffix: string, options: AgentRuntimeRequestOptions = {}): Promise<unknown> => {
    const signals = [this.lifetime.signal, options.signal].filter((signal): signal is AbortSignal => Boolean(signal));
    const signal = AbortSignal.any(signals);
    if (signal.aborted) throw abortError();
    // An old remote configuration must never recover a private gateway session.
    if (suffix.startsWith('remote/') || (suffix === 'transport' && object(options.body).transport === 'remote')) {
      throw Object.assign(new Error('Use o Agent nesta hospedagem ou conecte um cliente por MCP.'), { code: 'agent_remote_removed' });
    }
    try {
      const result = await this.wordpressRequest(suffix, { ...options, signal });
      if (signal.aborted) throw abortError();
      if (suffix === 'transport' || suffix === 'config/retry' || (suffix === 'config' && options.body === undefined)) {
        const config = { ...object(result), transport: 'local', transportOptions: { selected: 'local', canChange: false } };
        delete (config as Record<string, unknown>).remote;
        this.options.onConfig?.(config);
        return config;
      }
      return result;
    } catch (cause) {
      const error = cause as AgentTransportError;
      if (error.status === 401 || error.status === 403) this.options.onDenied?.(error);
      throw error;
    }
  };

  uploadAttachment = async (file: File): Promise<unknown> => {
    const signal = this.lifetime.signal;
    const form = new FormData();
    form.append('file', file, file.name);
    return this.wordpressRequest('attachments', { signal }, form);
  };
}
