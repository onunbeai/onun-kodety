type Action = 'refresh' | 'publish';
type Host = { refresh(): Promise<void>; publish(): void };
const REQUEST = 'kodety-html-preview';
const RESPONSE = 'kodety-html-preview-parent';
const TIMEOUT = 30_000;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const validRequestId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

function trustedPreview(event: MessageEvent, projectId: string): Window | null {
  if (event.origin !== window.location.origin || !event.source || event.source === window) return null;
  try {
    const source = event.source as Window;
    const url = new URL(source.location.href);
    if (source.closed || url.origin !== window.location.origin || url.searchParams.get('kodety-html-preview') !== projectId || url.searchParams.get('kodety-preview-review') !== '1') return null;
    return source;
  } catch { return null; }
}
export function installHtmlPreviewBridge(projectId: string, host: Host): () => void {
  if (!validId(projectId)) throw new Error('Invalid HTML preview project identifier.');
  let active = true;
  const pending = new Set<string>();
  const receive = (event: MessageEvent) => {
    const message = event.data;
    if (!active || !message || message.source !== REQUEST || message.type !== 'request' || message.projectId !== projectId || !validRequestId(message.requestId) || !['refresh', 'publish'].includes(message.action)) return;
    const source = trustedPreview(event, projectId);
    if (!source || pending.has(message.requestId)) return;
    pending.add(message.requestId);
    void (async () => {
      let error = '';
      try { if (message.action === 'refresh') await host.refresh(); else host.publish(); }
      catch (reason) { error = reason instanceof Error ? reason.message : 'The HTML preview action failed.'; }
      if (!active) return;
      pending.delete(message.requestId);
      // Navigation or closing during a save is cancellation, not a new error.
      if (trustedPreview(event, projectId) !== source) return;
      try { source.postMessage({ source: RESPONSE, type: 'response', projectId, requestId: message.requestId, action: message.action, ok: !error, ...(error ? { error } : {}) }, window.location.origin); }
      catch { /* The preview may have closed after the final check. */ }
    })();
  };
  window.addEventListener('message', receive);
  return () => { active = false; pending.clear(); window.removeEventListener('message', receive); };
}

/** False means the editor is unavailable/cancelled; host failures reject. */
export function requestHtmlPreviewAction(projectId: string, action: Action): Promise<boolean> {
  if (!validId(projectId) || !['refresh', 'publish'].includes(action)) return Promise.reject(new Error('Invalid HTML preview action.'));
  const opener = window.opener;
  if (!opener || opener.closed) return Promise.resolve(false);
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      window.removeEventListener('pagehide', cancelled);
      if (error) reject(new Error(error)); else resolve(ok);
    };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.origin !== window.location.origin || event.source !== opener || !message || message.source !== RESPONSE || message.type !== 'response' || message.projectId !== projectId || message.requestId !== requestId || message.action !== action || typeof message.ok !== 'boolean') return;
      finish(message.ok, !message.ok ? (typeof message.error === 'string' ? message.error : 'The HTML editor could not complete this action.') : undefined);
    };
    const cancelled = () => finish(false);
    const timer = setTimeout(() => finish(false), TIMEOUT);
    window.addEventListener('message', receive);
    window.addEventListener('pagehide', cancelled, { once: true });
    try { opener.postMessage({ source: REQUEST, type: 'request', projectId, action, requestId }, window.location.origin); }
    catch { finish(false); }
  });
}
