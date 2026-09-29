/** Cross-tab notifications invalidate account state; they never authorize an account. */
const ACCOUNT_EVENT = 'kodety-agent-account-changed';
const storageKey = (agentUrl: string) => `kodety-agent-account:${agentUrl}`;

export function notifyAgentAccountChanged(agentUrl: string, connected: boolean) {
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, { detail: { agentUrl, connected } }));
  try {
    localStorage.setItem(storageKey(agentUrl), JSON.stringify({ connected, revision: crypto.randomUUID() }));
  } catch { /* Focus/visibility checks also work when storage is unavailable. */ }
}

export function subscribeAgentAccountChanged(agentUrl: string, listener: (connected?: boolean) => void) {
  const local = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail?.agentUrl || detail.agentUrl === agentUrl) listener(detail?.connected);
  };
  const stored = (event: StorageEvent) => {
    if (event.key === storageKey(agentUrl)) listener();
  };
  window.addEventListener(ACCOUNT_EVENT, local);
  window.addEventListener('storage', stored);
  return () => {
    window.removeEventListener(ACCOUNT_EVENT, local);
    window.removeEventListener('storage', stored);
  };
}

/** One read at a time, with immediate checks on return and no login deadline. */
export function observeAgentAccount<T>(options: {
  read: (signal: AbortSignal) => Promise<T>;
  onAccount: (account: T) => void;
  onError: (cause: unknown) => void;
  poll?: boolean;
  /** Only an explicit pending login needs to complete while its provider tab is active. */
  pollWhenHidden?: boolean;
}) {
  const controller = new AbortController();
  let pending = false;
  let invalidated = false;
  let timer: number | undefined;
  const refresh = async () => {
    if (controller.signal.aborted || (document.visibilityState === 'hidden' && !(options.poll && options.pollWhenHidden))) return;
    if (pending) { invalidated = true; return; }
    invalidated = false;
    window.clearTimeout(timer);
    pending = true;
    try {
      const account = await options.read(controller.signal);
      if (!controller.signal.aborted) options.onAccount(account);
    } catch (cause) {
      if (!controller.signal.aborted) options.onError(cause);
    } finally {
      pending = false;
      if (!controller.signal.aborted) {
        if (invalidated) void refresh();
        else if (options.poll) timer = window.setTimeout(() => void refresh(), 2000);
      }
    }
  };
  const onReturn = () => { void refresh(); };
  window.addEventListener('focus', onReturn);
  window.addEventListener('pageshow', onReturn);
  document.addEventListener('visibilitychange', onReturn);
  return {
    refresh: onReturn,
    stop: () => {
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('pageshow', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    },
  };
}
