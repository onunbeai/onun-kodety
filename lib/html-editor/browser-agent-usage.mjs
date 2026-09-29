const PROVIDER = 'openai-codex';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value.slice(0, 160) : null;
const error = (code, status, message) => Object.assign(new Error(message), { code, status });
const unavailable = () => error('agent_usage_unavailable', 502, 'Não foi possível consultar os limites da conta. Tente atualizar novamente.');
const authRequired = () => error('agent_auth_required', 401, 'Conecte sua conta ChatGPT para consultar os limites.');
const authExpired = () => error('agent_auth_expired', 401, 'A sessão ChatGPT expirou. Conecte sua conta novamente.');

function windowFromUsage(value) {
  const window = object(value);
  const usedPercent = number(window.used_percent);
  if (usedPercent === null) return null;
  const seconds = number(window.limit_window_seconds);
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    windowDurationMins: seconds !== null && seconds > 0 ? seconds / 60 : null,
    resetsAt: number(window.reset_at),
  };
}

// Match the Codex account/rateLimits/read contract. Absent windows remain null;
// an unknown percentage must never become an invented 100% remaining balance.
export function normalizeBrowserAgentUsage(value) {
  const payload = object(value);
  if (!Object.hasOwn(payload, 'rate_limit') && !Array.isArray(payload.additional_rate_limits)) throw unavailable();
  const reachedTypes = {
    rate_limit_reached: 'rateLimitReached',
    workspace_owner_credits_depleted: 'workspaceOwnerCreditsDepleted',
    workspace_member_credits_depleted: 'workspaceMemberCreditsDepleted',
    workspace_owner_usage_limit_reached: 'workspaceOwnerUsageLimitReached',
    workspace_member_usage_limit_reached: 'workspaceMemberUsageLimitReached',
  };
  const snapshot = (id, name, rateLimit, isPrimary = false) => {
    const limit = object(rateLimit);
    const reached = isPrimary ? text(object(payload.rate_limit_reached_type).type) : null;
    return {
      limitId: id,
      limitName: name,
      primary: windowFromUsage(limit.primary_window),
      secondary: windowFromUsage(limit.secondary_window),
      planType: text(payload.plan_type),
      rateLimitReachedType: (Object.hasOwn(reachedTypes, reached) ? reachedTypes[reached] : null)
        || (isPrimary && limit.limit_reached === true ? 'rateLimitReached' : null),
      spendControlReached: isPrimary && object(payload.spend_control).reached === true,
    };
  };
  const primary = snapshot('codex', null, payload.rate_limit, true);
  const additional = (Array.isArray(payload.additional_rate_limits) ? payload.additional_rate_limits : []).flatMap(raw => {
    const item = object(raw);
    const id = text(item.metered_feature);
    return id && id !== 'codex' ? [[id, snapshot(id, text(item.limit_name), item.rate_limit)]] : [];
  });
  return { rateLimits: primary, rateLimitsByLimitId: Object.fromEntries([['codex', primary], ...additional]) };
}

/** Uses the same Pi OAuth refresh/storage lifecycle as turns. In WebContainer,
 * fetch is the existing fixed-operation network bridge, never a direct CORS call.
 * Only the normalized quota fields leave this function. */
export async function readBrowserAgentRateLimits({ models, fetch: fetcher = globalThis.fetch, signal }) {
  const requestSignal = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  let resolved;
  try { resolved = await models.getAuth(PROVIDER, { signal: requestSignal }); }
  catch { throw authExpired(); }
  const token = resolved?.auth?.apiKey;
  if (typeof token !== 'string' || !token) throw authRequired();
  let accountId;
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    accountId = object(claims['https://api.openai.com/auth']).chatgpt_account_id;
  } catch { throw authExpired(); }
  if (typeof accountId !== 'string' || !accountId || accountId.length > 320) throw authExpired();
  try {
    requestSignal.throwIfAborted();
    const response = await fetcher(USAGE_URL, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: requestSignal,
      headers: { Authorization: `Bearer ${token}`, 'ChatGPT-Account-Id': accountId, Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw response.status === 401 || response.status === 403 ? authExpired() : unavailable();
    }
    const result = normalizeBrowserAgentUsage(await response.json());
    requestSignal.throwIfAborted();
    return result;
  } catch (cause) {
    if (cause?.code === 'agent_auth_expired') throw authExpired();
    if (cause?.code === 'agent_browser_network_unavailable') {
      throw error(cause.code, 502, 'O serviço de conexão do Agent não está disponível nesta hospedagem. Atualize o servidor do Studio ou o plugin WordPress.');
    }
    throw unavailable();
  }
}
