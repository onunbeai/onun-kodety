/** Public WordPress runtime diagnostics; never render transport bodies or logs. */
export interface AgentRuntimeDiagnostic {
  code: string;
  message: string;
  action: string;
  retryable: boolean;
}

export interface AgentRuntimeProgress {
  phase: string;
  message: string;
  step: number;
  stepCount: number;
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface AgentRuntimeRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

type RuntimeRequest = (suffix: string, options?: AgentRuntimeRequestOptions) => Promise<unknown>;

const PHASES = new Set([
  'download_node', 'verify_node', 'download_codex', 'verify_codex',
  'extract_node', 'inspect_codex', 'extract_codex', 'validate_node', 'validate_codex', 'activate',
  'start_bridge', 'start_codex',
]);

const AUTOMATIC_RETRY_CODES = new Set([
  'runtime_download_dns',
  'runtime_download_timeout',
  'runtime_download_failed',
  'sidecar_unavailable',
  // Kept as compatibility aliases while an older bridge is being replaced.
  'sidecar_start_timeout',
  'codex_start_timeout',
]);
const DEFAULT_MAX_TRANSIENT_FAILURES = 12;
const MAX_AUTOMATIC_RETRY_DELAY_MS = 15_000;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, limit = 600): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function count(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0;
}

function runtimeFailureCode(value: unknown): string {
  const source = object(value);
  const payload = object(source.payload);
  const payloadData = object(payload.data);
  const diagnostic = object(source.runtimeDiagnostics ?? payload.runtimeDiagnostics ?? payloadData.runtimeDiagnostics);
  const candidate = text(diagnostic.code || source.unavailableReason || payload.unavailableReason || source.code, 96);
  return /^[a-z0-9_]+$/.test(candidate) ? candidate : '';
}

export function isAgentRuntimeTransientFailure(value: unknown): boolean {
  const code = runtimeFailureCode(value);
  if (AUTOMATIC_RETRY_CODES.has(code)) return true;
  if (value instanceof TypeError) return true;
  const source = object(value);
  const status = typeof source.status === 'number' ? source.status : 0;
  return !code && [502, 503, 504].includes(status);
}

function automaticRetryDelay(attempt: number): number {
  return Math.min(MAX_AUTOMATIC_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(4, Math.max(0, attempt - 1)));
}

function automaticRetryProgress(
  previous: AgentRuntimeProgress | null,
  value: unknown,
  delay: number,
): AgentRuntimeProgress {
  const code = runtimeFailureCode(value);
  const starting = code === 'sidecar_unavailable' || code === 'sidecar_start_timeout' || code === 'codex_start_timeout';
  const seconds = Math.max(1, Math.ceil(delay / 1000));
  const message = code === 'runtime_download_dns'
    ? `Sem resposta do servidor de download. Nova tentativa automática em ${seconds}s…`
    : code === 'runtime_download_timeout'
      ? `A conexão demorou para responder. Retomando automaticamente em ${seconds}s…`
      : starting
        ? `O Agent ainda não respondeu. Nova verificação automática em ${seconds}s…`
        : previous?.message || 'Aguardando a resposta do servidor…';
  return {
    phase: previous?.phase || (starting ? 'start_bridge' : 'download_node'),
    message,
    step: previous?.step || (starting ? 9 : 1),
    stepCount: previous?.stepCount || 10,
    downloadedBytes: previous?.downloadedBytes || 0,
    totalBytes: previous?.totalBytes ?? null,
  };
}

export function readAgentRuntimeProgress(config: unknown): AgentRuntimeProgress | null {
  const progress = object(object(config).runtimeInstallation);
  const phase = text(progress.phase, 40);
  if (!PHASES.has(phase)) return null;
  const total = count(progress.totalBytes, 262_144_000);
  return {
    phase,
    message: text(progress.message) || 'Preparando conexão…',
    step: Math.max(1, count(progress.step, 20)),
    stepCount: Math.max(1, count(progress.stepCount, 20)),
    downloadedBytes: count(progress.downloadedBytes, total || 262_144_000),
    totalBytes: total || null,
  };
}

export function agentRuntimeFailure(cause: unknown): AgentRuntimeDiagnostic {
  const error = object(cause);
  const payload = object(error.payload);
  const diagnostic = object(payload.runtimeDiagnostics ?? object(payload.data).runtimeDiagnostics);
  const publicCode = text(diagnostic.code, 96);
  if (/^[a-z0-9_]+$/.test(publicCode) && text(diagnostic.message)) {
    return {
      code: publicCode,
      message: text(diagnostic.message),
      action: text(diagnostic.action),
      retryable: diagnostic.retryable !== false,
    };
  }
  const candidate = text(payload.unavailableReason || error.code, 96);
  const code = /^[a-z0-9_]+$/.test(candidate) ? candidate : 'agent_connection_failed';
  const status = typeof error.status === 'number' ? error.status : 0;
  let message = 'Não foi possível conectar ao Agent nesta hospedagem.';
  let action = 'Tente novamente. Se persistir, informe este código ao administrador da hospedagem.';
  let retryable = true;
  if (code.startsWith('agent_browser_')) {
    message = 'Não foi possível iniciar o Agent no navegador.';
    action = 'Confira a conexão e tente novamente.';
  } else if (code === 'agent_login_invalid_url') {
    message = 'O Agent não retornou um endereço válido para o login OpenAI.';
    action = 'Tente conectar novamente. Se persistir, peça ao administrador para conferir a versão do serviço Cloud.';
  } else if (code === 'agent_not_configured' || status === 404) {
    message = 'A rota do Agent não está disponível neste site.';
    action = 'Recarregue o Builder e verifique a instalação do plugin e o acesso à API REST do WordPress.';
  } else if (code.startsWith('kodety_license_') || code === 'agent_disabled') {
    message = 'O Agent requer uma licença Kodety ativa para este projeto.';
    action = 'Ative a licença antes de conectar a conta OpenAI.';
    retryable = false;
  } else if (code.startsWith('agent_remote_') || code === 'codex_start_failed') {
    message = 'Não foi possível conectar ao serviço remoto do Agent.';
    action = code === 'agent_remote_server_required'
      ? 'A autorização Cloud do Studio precisa ser atualizada no backend Kodety. Abra as configurações da conexão; este erro acontece antes do login OpenAI.'
      : code === 'agent_remote_unavailable'
        ? 'O serviço Cloud ainda não está pronto. Confira a configuração do gateway e da autorização Kodety antes de reconectar.'
      : code === 'agent_remote_rate_limited'
        ? 'Aguarde alguns instantes antes de iniciar outra conexão.'
      : code === 'agent_remote_origin_denied'
      ? 'Peça ao administrador para conferir se o domínio deste WordPress corresponde à origem autorizada no serviço remoto.'
      : code === 'agent_remote_access_denied'
        ? 'A autorização de acesso foi recusada. Confira sua licença, suas permissões e a configuração do serviço remoto antes de reconectar.'
        : code === 'agent_remote_invalid_url' || code === 'agent_remote_invalid_session' || code === 'agent_remote_invalid_response'
      ? 'Peça ao administrador para verificar a configuração e a autorização do serviço remoto.'
      : code === 'agent_remote_gateway_changed'
        ? 'Recarregue o Builder para conectar ao novo serviço.'
        : 'Tente novamente. Se persistir, verifique a disponibilidade do serviço remoto do Agent.';
  } else if (code === 'rest_cookie_invalid_nonce' || status === 401) {
    message = 'A sessão do WordPress expirou ou não foi reconhecida.';
    action = 'Recarregue a página e entre novamente no WordPress antes de conectar a conta OpenAI.';
  } else if (status === 403) {
    message = 'O WordPress ou a proteção da hospedagem recusou a conexão do Agent (HTTP 403).';
    action = 'Confira as permissões da conta e se o firewall permite as rotas kodety/v1/agents da API REST.';
  } else if (code === 'agent_invalid_response') {
    message = 'A hospedagem devolveu uma resposta inválida para o Agent.';
    action = 'Verifique se cache, firewall ou um erro de PHP está substituindo a resposta JSON da API REST.';
  } else if (code === 'agent_setup_limit') {
    message = 'A preparação ainda não terminou. O progresso salvo foi preservado.';
    action = 'Tente novamente para continuar a preparação do Agent.';
  } else if ([502, 503, 504].includes(status)) {
    message = `O servidor não conseguiu concluir a preparação do Agent (HTTP ${status}).`;
    action = 'Tente novamente para retomar. Se persistir, confira os limites de tempo, memória e processos da hospedagem.';
  } else if (cause instanceof TypeError) {
    message = 'Não foi possível alcançar o servidor do Agent.';
    action = 'Confira sua conexão e o acesso à API REST. Os blocos já salvos na hospedagem podem ser retomados.';
  }
  return { code, message, action, retryable };
}

export function agentRuntimeUnavailable(config: Record<string, unknown>): Error {
  const code = runtimeFailureCode(config) || (config.transport === 'webcontainer'
    ? config.licenseRequired === true || config.enabled === false ? 'kodety_license_agents_required' : 'agent_browser_unavailable'
    : config.transport === 'remote' ? 'agent_remote_unavailable' : 'sidecar_unavailable');
  return Object.assign(new Error('O runtime do Agent não está disponível.'), {
    code,
    payload: config,
  });
}

export function isAgentSetupAborted(cause: unknown): boolean {
  return object(cause).name === 'AbortError';
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Preparação interrompida.', 'AbortError');
}

function waitForNextStep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  checkAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Preparação interrompida.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Local installation requires force; remote readiness runs in the configured gateway. */
export async function prepareAgentRuntime(
  request: RuntimeRequest,
  {
    force = false,
    onProgress,
    signal,
    maxSteps = Number.POSITIVE_INFINITY,
    maxTransientFailures = DEFAULT_MAX_TRANSIENT_FAILURES,
  }: {
    force?: boolean;
    onProgress?: (progress: AgentRuntimeProgress | null) => void;
    signal?: AbortSignal;
    maxSteps?: number;
    maxTransientFailures?: number;
  } = {},
): Promise<Record<string, unknown>> {
  const transientFailureLimit = Number.isFinite(maxTransientFailures)
    ? Math.max(1, Math.floor(maxTransientFailures))
    : DEFAULT_MAX_TRANSIENT_FAILURES;
  let lastProgress: AgentRuntimeProgress | null = null;
  const publishProgress = (progress: AgentRuntimeProgress | null) => {
    lastProgress = progress;
    onProgress?.(progress);
  };
  const readConfig = async (suffix: string, method: 'GET' | 'POST') => {
    checkAborted(signal);
    const config = object(await request(suffix, { method, signal }));
    checkAborted(signal);
    if (typeof config.available !== 'boolean' || typeof config.enabled !== 'boolean') {
      throw Object.assign(new Error('Resposta inválida do Agent.'), { code: 'agent_invalid_response' });
    }
    publishProgress(config.available ? null : readAgentRuntimeProgress(config));
    return config;
  };
  let initialFailures = 0;
  let config: Record<string, unknown>;
  while (true) {
    try {
      config = await readConfig('config', 'GET');
      break;
    } catch (cause) {
      if (!force || !isAgentRuntimeTransientFailure(cause)) throw cause;
      initialFailures += 1;
      if (initialFailures >= transientFailureLimit) throw cause;
      const delay = automaticRetryDelay(initialFailures);
      publishProgress(automaticRetryProgress(lastProgress, cause, delay));
      await waitForNextStep(delay, signal);
    }
  }
  if (config.enabled === false || config.licenseRequired === true) return config;
  // The browser binding resolves config after WebContainer startup. It never
  // downloads or polls the WordPress server runtime, including on retry.
  if (config.transport === 'webcontainer') return config;
  if (config.transport === 'remote') {
    if (!config.available) return config;
    let failures = 0;
    publishProgress({ phase: 'start_codex', message: 'Conectando ao serviço do Agent…', step: 1, stepCount: 1, downloadedBytes: 0, totalBytes: null });
    for (let step = 0; step < maxSteps; step += 1) {
      checkAborted(signal);
      let delay = 1500;
      try {
        const ready = object(await request('ready', { body: force && step === 0 ? { retry: true } : {}, signal }));
        checkAborted(signal);
        if (ready.state === 'ready') {
          publishProgress(null);
          return config;
        }
        if (ready.state !== 'starting') {
          throw Object.assign(new Error('O serviço remoto não conseguiu iniciar o Agent.'), {
            code: 'agent_remote_start_failed', payload: ready,
          });
        }
        failures = 0;
      } catch (cause) {
        const error = object(cause);
        if (isAgentSetupAborted(cause) || !(['agent_remote_connection', 'agent_remote_timeout'].includes(text(error.code)) || [502, 503, 504].includes(Number(error.status)))) throw cause;
        failures += 1;
        if (failures >= transientFailureLimit) throw cause;
        delay = automaticRetryDelay(failures);
      }
      await waitForNextStep(delay, signal);
    }
    throw Object.assign(new Error('O serviço remoto ainda está iniciando. Tente novamente.'), { code: 'agent_remote_setup_limit' });
  }
  if (!force && config.unavailableReason !== 'runtime_starting') return config;
  const advertisedPath = text(config.retryPath, 80);
  const retryPath = /^[a-z]+(?:\/[a-z]+)*$/.test(advertisedPath) ? advertisedPath : 'config/retry';
  let nextMethod: 'GET' | 'POST' = force ? 'POST' : 'GET';
  let transientFailures = 0;
  let nextDelay = 0;
  if (force && isAgentRuntimeTransientFailure(config)) {
    transientFailures = 1;
    if (transientFailures >= transientFailureLimit) return config;
    nextDelay = automaticRetryDelay(transientFailures);
    publishProgress(automaticRetryProgress(lastProgress, config, nextDelay));
  }
  for (let step = 0; step < maxSteps; step += 1) {
    if (nextDelay > 0 || step > 0 || !force) {
      const progress = object(config.runtimeInstallation);
      const delay = nextDelay || (progress.phase ? Math.max(100, count(progress.retryAfterMs, 2000)) : 1500);
      nextDelay = 0;
      await waitForNextStep(delay, signal);
    }
    try {
      config = await readConfig(nextMethod === 'POST' ? retryPath : 'config', nextMethod);
    } catch (cause) {
      if (!force || !isAgentRuntimeTransientFailure(cause)) throw cause;
      transientFailures += 1;
      if (transientFailures >= transientFailureLimit) throw cause;
      // A reverse proxy may close the browser response while PHP continues
      // the streamed download with ignore_user_abort enabled. Read progress
      // once before attempting another write so requests do not pile up.
      nextMethod = 'GET';
      nextDelay = automaticRetryDelay(transientFailures);
      publishProgress(automaticRetryProgress(lastProgress, cause, nextDelay));
      continue;
    }
    if (config.available || config.enabled === false || config.licenseRequired === true) return config;
    if (config.unavailableReason === 'runtime_starting') {
      transientFailures = 0;
      nextMethod = 'GET';
    } else if (force && config.unavailableReason === 'runtime_installing') {
      transientFailures = 0;
      nextMethod = 'POST';
    } else if (force && isAgentRuntimeTransientFailure(config)) {
      transientFailures += 1;
      nextMethod = 'POST';
      if (transientFailures >= transientFailureLimit) return config;
      nextDelay = automaticRetryDelay(transientFailures);
      publishProgress(automaticRetryProgress(lastProgress, config, nextDelay));
    } else {
      // Permanent failures still stop so the UI can explain the host restriction.
      return config;
    }
  }
  throw Object.assign(new Error('A preparação ainda não terminou.'), { code: 'agent_setup_limit' });
}
