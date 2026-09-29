import type { AgentRuntimeDiagnostic } from './agent-runtime-setup';

/** Must be called directly from a user gesture, before preparing the runtime. */
export function openAgentAccountPopup(message = 'Conectando à conta do Agent…'): Window | null {
  let popup: Window | null = null;
  try { popup = window.open('about:blank', '_blank'); } catch { return null; }
  if (!popup) return null;
  try {
    popup.opener = null;
    popup.document.title = 'Conectar conta OpenAI · Kodety';
    popup.document.body.style.cssText = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:15px system-ui,sans-serif';
    const content = popup.document.createElement('main');
    content.style.cssText = 'max-width:420px;padding:32px;line-height:1.6';
    const title = popup.document.createElement('h1');
    title.style.cssText = 'font-size:22px;font-weight:600';
    title.textContent = 'Conectar conta OpenAI';
    const status = popup.document.createElement('p');
    status.textContent = message;
    content.append(title, status);
    popup.document.body.replaceChildren(content);
  } catch {
    // The official OpenAI destination will replace this placeholder.
  }
  return popup;
}

/** Keep a failed, user-opened setup window useful instead of closing it silently. */
export function showAgentAccountPopupFailure(popup: Window | null, diagnostic: AgentRuntimeDiagnostic, recoveryHref = '') {
  try {
    if (!popup || popup.closed) return;
    const content = popup.document.querySelector('main') || popup.document.body;
    const title = popup.document.createElement('h1');
    title.style.cssText = 'font-size:22px;font-weight:600';
    title.textContent = diagnostic.message;
    const action = popup.document.createElement('p');
    action.textContent = diagnostic.action;
    const returnHint = popup.document.createElement('p');
    returnHint.textContent = 'Depois de resolver, volte ao Kodety e clique em Conectar conta OpenAI.';
    content.replaceChildren(title, action, returnHint);
    if (recoveryHref) {
      const destination = new URL(recoveryHref, window.location.href);
      if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) return;
      const link = popup.document.createElement('a');
      link.href = destination.toString();
      link.textContent = 'Abrir configurações do Kodety';
      link.style.cssText = 'display:inline-block;margin-top:12px;padding:10px 16px;border-radius:8px;background:#9c92ff;color:#171322;text-decoration:none';
      content.append(link);
    }
  } catch {
    // A closed or navigated window must not hide the error in the Builder.
  }
}

/** Account login destinations are limited to the official OpenAI domains. */
export function agentAccountLoginUrl(value: unknown): string {
  try {
    const url = new URL(typeof value === 'string' ? value : '');
    const official = ['openai.com', 'chatgpt.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return url.protocol === 'https:' && official && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
}

/** Open only after the user chooses to continue; never allocate a blank setup tab. */
export function openAgentAccountLoginPage(value: string): Window | null {
  const destination = agentAccountLoginUrl(value);
  if (!destination) return null;
  try {
    const popup = window.open(destination, '_blank');
    if (!popup || popup.closed) return null;
    // The validated official OAuth page keeps its opener so the settings instance
    // can close only this window after confirmation. Provider COOP may still sever
    // the handle. Never force focus on return or reuse an unrelated named window.
    return popup;
  } catch { return null; }
}

export function closeAgentAccountPopup(popup: Window | null): void {
  try { popup?.close(); } catch { /* Browser restrictions do not change account state. */ }
}

/** Navigation failures belong to the browser UI, never to the Agent connection. */
export function navigateAgentAccountPopup(popup: Window | null, value: string): boolean {
  const destination = agentAccountLoginUrl(value);
  if (!destination) return false;
  try {
    if (!popup || popup.closed) return false;
    // Leave a normal link in the placeholder if the WebView rejects navigation.
    try {
      const content = popup.document.querySelector('main') || popup.document.body;
      const title = popup.document.createElement('h1');
      title.style.cssText = 'font-size:22px;font-weight:600';
      title.textContent = 'Conectar conta OpenAI';
      const message = popup.document.createElement('p');
      message.textContent = 'Conclua o login na página oficial da OpenAI. Se ela não abrir automaticamente, use o link abaixo e o código mostrado no Kodety.';
      const link = popup.document.createElement('a');
      link.href = destination;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Abrir login oficial da OpenAI';
      link.style.cssText = 'display:inline-block;margin-top:12px;padding:10px 16px;border-radius:8px;background:#9c92ff;color:#171322;text-decoration:none';
      content.replaceChildren(title, message, link);
    } catch { /* The Builder always provides the same normal link. */ }
    popup.location.href = destination;
    return true;
  } catch { return false; }
}
