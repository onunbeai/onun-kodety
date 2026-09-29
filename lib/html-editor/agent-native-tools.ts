import { withRequestTimeout } from '../request-timeout';
import { AGENT_NATIVE_CHANGED_EVENT } from './agent-native-events';
export { AGENT_NATIVE_CHANGED_EVENT, mergeAgentNativeSettings } from './agent-native-events';

/** Shared semantic transport for every Agent workspace. The server remains the
 * authority for permissions, editor leases, scope and revision validation. */
export const AGENT_NATIVE_TOOLS = ['kodety_native_catalog', 'kodety_native_call'] as const;

export interface AgentNativeOperation {
  name: string;
  description: string;
  method: string;
  route: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
  affectsWorkspace: boolean;
}

export interface AgentNativeCatalog {
  schemaVersion: number;
  operations: AgentNativeOperation[];
}

export interface AgentNativeLifecycleContext {
  signal: AbortSignal;
  assertCurrent: () => void;
}

export interface AgentNativeLifecycle {
  beforeNativeOperation?: (operation: AgentNativeOperation, context: AgentNativeLifecycleContext) => void | Promise<void>;
  afterNativeOperation?: (operation: AgentNativeOperation, result: unknown, context: AgentNativeLifecycleContext) => void | Promise<void>;
}

export interface AgentNativeConfig {
  automationToolsUrl?: string;
  automationCallUrl?: string;
  projectUrl?: string;
  mcpStatusUrl?: string;
  cmsSchemaUrl?: string;
  nonce: string;
}

export function agentNativeEndpoint(config: AgentNativeConfig, kind: 'tools' | 'call') {
  const configured = kind === 'tools' ? config.automationToolsUrl : config.automationCallUrl;
  if (configured) return configured;
  const endpoint = config.projectUrl || config.mcpStatusUrl || config.cmsSchemaUrl;
  if (!endpoint) throw new Error('As operações nativas não estão disponíveis nesta conexão.');
  const url = new URL(endpoint, typeof window === 'undefined' ? 'http://localhost' : window.location.href);
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute?.startsWith('/kodety/v1/')) {
    url.searchParams.set('rest_route', `/kodety/v1/automation/${kind}`);
  } else if (url.pathname.includes('/kodety/v1/')) {
    url.pathname = `${url.pathname.split('/kodety/v1/')[0]}/kodety/v1/automation/${kind}`;
  } else {
    throw new Error('O endereço das operações nativas não é válido.');
  }
  return url.href;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

async function readResponse(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = object(payload);
    const data = object(body.data);
    throw Object.assign(new Error(typeof body.message === 'string' ? body.message : `A operação nativa falhou (${response.status}).`), {
      code: body.code,
      status: response.status,
      data: body.data,
      retryable: response.status === 409 || data.retryable === true,
    });
  }
  if (payload === null) throw new Error('O WordPress respondeu sem confirmar o resultado da operação nativa.');
  return payload;
}

export async function readAgentNativeCatalog(config: AgentNativeConfig, fetcher: typeof fetch = fetch, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<AgentNativeCatalog> {
  const catalog = object(await withRequestTimeout(async signal => {
    const response = await fetcher(agentNativeEndpoint(config, 'tools'), {
      credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': config.nonce }, signal,
    });
    return readResponse(response);
  }, { signal: options.signal, timeoutMs: options.timeoutMs || 20_000, timeoutMessage: 'O catálogo de operações demorou demais para responder.' }));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.operations)
    || catalog.operations.some(value => {
      const operation = object(value);
      return typeof operation.name !== 'string' || typeof operation.readOnly !== 'boolean'
        || typeof operation.affectsWorkspace !== 'boolean' || !operation.inputSchema;
    })) throw new Error('O catálogo de operações nativas é incompatível.');
  return catalog as unknown as AgentNativeCatalog;
}

export function filterAgentNativeCatalog(catalog: AgentNativeCatalog, area?: unknown): AgentNativeCatalog {
  const prefix = typeof area === 'string' ? area.trim().toLowerCase() : '';
  return { ...catalog, operations: catalog.operations.filter(operation => !prefix
    || operation.name.toLowerCase() === prefix || operation.name.toLowerCase().startsWith(`${prefix}_`)) };
}

export async function invokeAgentNativeTool(
  tool: string,
  args: Record<string, unknown>,
  options: AgentNativeLifecycle & {
    config: AgentNativeConfig;
    readOnly: () => boolean;
    assertCurrent: () => void;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
) {
  const fetcher = options.fetcher || fetch;
  const lifecycleContext = (signal: AbortSignal): AgentNativeLifecycleContext => ({
    signal,
    assertCurrent: () => { signal.throwIfAborted(); options.assertCurrent(); },
  });
  options.assertCurrent();
  const catalog = await readAgentNativeCatalog(options.config, fetcher, { signal: options.signal, timeoutMs: options.timeoutMs });
  options.assertCurrent();
  if (tool === 'kodety_native_catalog') return filterAgentNativeCatalog(catalog, args.area);
  if (tool !== 'kodety_native_call') throw new Error('Ferramenta nativa desconhecida.');
  const operation = catalog.operations.find(candidate => candidate.name === args.operation);
  if (!operation) throw new Error('Operação não encontrada. Consulte kodety_native_catalog.');
  if (!operation.readOnly && options.readOnly()) throw new Error('Esta área está em modo somente leitura.');
  const callArgs = args.arguments === undefined ? {} : args.arguments;
  if (!callArgs || typeof callArgs !== 'object' || Array.isArray(callArgs)) {
    throw new Error('Os argumentos da operação precisam ser um objeto.');
  }
  await withRequestTimeout(async signal => options.beforeNativeOperation?.(operation, lifecycleContext(signal)), {
    timeoutMs: options.timeoutMs || 60_000, signal: options.signal,
    timeoutMessage: 'O salvamento pendente demorou demais. Leia o estado atual antes de continuar.',
  });
  options.assertCurrent();
  if (!operation.readOnly && options.readOnly()) throw new Error('Esta área está em modo somente leitura.');
  // No automatic retries: an interrupted POST may already have committed.
  let result: unknown;
  try {
    result = await withRequestTimeout(async signal => {
      const response = await fetcher(agentNativeEndpoint(options.config, 'call'), {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': options.config.nonce },
        body: JSON.stringify({ operation: operation.name, arguments: callArgs }),
      });
      return readResponse(response);
    }, { timeoutMs: options.timeoutMs || 60_000, signal: options.signal, timeoutMessage: 'A operação nativa demorou demais para responder.' });
  } catch (cause) {
    if (!operation.readOnly && !object(cause).status) {
      throw Object.assign(new Error('O resultado da alteração não foi confirmado; ela pode ter sido salva. Consulte o recurso antes de tentar novamente.', { cause }), {
        code: 'KODETY_NATIVE_WRITE_UNCERTAIN', retryable: false,
      });
    }
    throw cause;
  }
  if (!operation.readOnly) {
    try {
      options.assertCurrent();
      await withRequestTimeout(async signal => options.afterNativeOperation?.(operation, result, lifecycleContext(signal)), {
        timeoutMs: options.timeoutMs || 60_000, signal: options.signal,
        timeoutMessage: 'A alteração foi salva, mas a visualização demorou demais para atualizar.',
      });
    } catch (cause) {
      // Keep the committed result visible so the model never retries a write
      // simply because a subsequent UI refresh failed.
      return { result, committed: true, refreshError: cause instanceof Error ? cause.message : 'A visualização precisa ser atualizada.', refreshDetails: object(cause).data };
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AGENT_NATIVE_CHANGED_EVENT, { detail: { operation, result } }));
      if (operation.route.includes('/cms/')) window.dispatchEvent(new Event('kodety-cms-items-changed'));
    }
  }
  return result;
}
