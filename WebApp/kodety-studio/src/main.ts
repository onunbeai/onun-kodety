import { loadStudioEntryPreferences } from './studio-entry';

const startupLanguage = loadStudioEntryPreferences().language;
document.documentElement.lang = startupLanguage === 'pt' ? 'pt-BR' : 'en-US';

function renderHttpsRequirement(): void {
  const root = document.getElementById('kodety-studio-root');
  if (!root) return;
  root.style.cssText = 'display:grid;min-height:100vh;place-items:center;background:#090909;color:#fff;font:14px Inter,system-ui,sans-serif';
  const card = document.createElement('div');
  card.style.cssText = 'max-width:460px;border:1px solid #292929;border-radius:12px;padding:24px;background:#171717;text-align:center';
  const title = document.createElement('strong');
  const portuguese = startupLanguage === 'pt';
  title.textContent = portuguese ? 'O Onun Kodety precisa de HTTPS' : 'Onun Kodety requires HTTPS';
  const copy = document.createElement('p');
  copy.style.cssText = 'margin:8px 0 0;color:#999;line-height:1.55';
  copy.textContent = portuguese
    ? 'Ative o certificado SSL da hospedagem e abra esta página novamente. O acesso às pastas e o armazenamento dos projetos precisam de uma conexão segura.'
    : 'Enable your hosting SSL certificate and open this page again. Folder access and project storage require a secure connection.';
  card.append(title, copy);
  root.append(card);
}

async function requestPersistentBrowserStorage(): Promise<void> {
  if (!navigator.storage?.persisted || !navigator.storage?.persist) return;
  if (await navigator.storage.persisted()) return;
  await navigator.storage.persist();
}

function renderStartupError(): void {
  const root = document.getElementById('kodety-studio-root');
  if (!root) return;
  root.style.cssText = 'min-height:100dvh;display:grid;place-content:center;gap:16px;padding:24px;background:#111;color:#ddd;font:13px system-ui;text-align:center';
  const message = document.createElement('p');
  message.textContent = startupLanguage === 'pt'
    ? 'Não foi possível carregar o Studio. Verifique a conexão e tente novamente.'
    : 'Could not load Studio. Check your connection and try again.';
  const retry = document.createElement('button');
  retry.textContent = startupLanguage === 'pt' ? 'Tentar novamente' : 'Try again';
  retry.style.cssText = 'padding:10px;border:0;border-radius:7px;background:#9393ff;color:#111;cursor:pointer';
  retry.onclick = () => window.location.reload();
  root.replaceChildren(message, retry);
}

const previewMode = new URLSearchParams(window.location.search).has('kodety-preview');
const htmlPreviewMode = new URLSearchParams(window.location.search).has('kodety-html-preview');
const storageDiagnosticMode = new URLSearchParams(window.location.search).has('storage-diagnostic');
const projectStorageMode = /\/project-storage(?:\.html)?$/.test(window.location.pathname);

if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  renderHttpsRequirement();
} else {
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('./service-worker.js').catch(() => {
        // A failed offline-cache registration must not prevent the online app.
        window.dispatchEvent(new Event('kodety-studio:offline-cache-unavailable'));
      });
    }, { once: true });
  }

  // Browsers are more likely to grant persistence from a user gesture. OPFS is
  // still local either way; this request only protects it from storage-pressure
  // eviction when the browser grants the stronger persistence mode.
  window.addEventListener('pointerdown', () => {
    void requestPersistentBrowserStorage().catch(() => undefined);
  }, { once: true, capture: true });

  if (projectStorageMode) {
    void import('./project-storage').then(({ renderProjectStorage }) => renderProjectStorage()).catch(renderStartupError);
  } else if (storageDiagnosticMode) {
    void import('../.diagnostics/storage-survey').then(({ renderStorageSurvey }) => renderStorageSurvey()).catch(renderStartupError);
  } else if (htmlPreviewMode) {
    void import('./html-preview').then(({ renderHtmlPreview }) => renderHtmlPreview()).catch(renderStartupError);
  } else if (previewMode) {
    void import('./preview').then(({ renderStudioSitePreview }) => renderStudioSitePreview()).catch(renderStartupError);
  } else {
    void import('./bootstrap').then(({ renderWebApp }) => renderWebApp()).catch(renderStartupError);
  }
}
