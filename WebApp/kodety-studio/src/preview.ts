import { STUDIO_PREVIEW_QUERY } from '../../../ChromeExtension/kodety-studio/src/preview-bridge';
import './studio-shell.css';

function previewRequestUrl(projectId: string): string {
  const base = new URL('./', window.location.href);
  return new URL(`__kodety_preview__/${encodeURIComponent(projectId)}/`, base).toString();
}

export function renderStudioSitePreview(): void {
  const root = document.getElementById('kodety-studio-root');
  if (!root) return;

  const query = new URLSearchParams(window.location.search);
  const projectId = query.get(STUDIO_PREVIEW_QUERY)?.trim() || '';
  const projectName = query.get('name')?.trim() || 'Kodety';
  const language = query.get('lang') === 'en' ? 'en' : 'pt';
  document.documentElement.lang = language === 'en' ? 'en-US' : 'pt-BR';
  document.title = `${projectName} — ${language === 'en' ? 'Local preview' : 'Prévia local'}`;

  const shell = document.createElement('main');
  shell.className = 'studio-site-preview-shell';

  if (!/^[a-z0-9-]{8,80}$/i.test(projectId)) {
    const error = document.createElement('div');
    error.className = 'studio-site-preview-error';
    const title = document.createElement('strong');
    title.textContent = language === 'en' ? 'Invalid local preview' : 'Prévia local inválida';
    const copy = document.createElement('p');
    copy.textContent = language === 'en'
      ? 'Return to Onun Kodety and open Site again.'
      : 'Volte ao Onun Kodety e abra Site novamente.';
    error.append(title, copy);
    shell.append(error);
    root.replaceChildren(shell);
    return;
  }

  const loading = document.createElement('div');
  loading.className = 'studio-site-preview-loading';
  const mark = document.createElement('img');
  mark.src = './assets/kodety-mark.svg';
  mark.alt = '';
  const copy = document.createElement('span');
  copy.textContent = language === 'en' ? 'Opening local site…' : 'Abrindo site local…';
  loading.append(mark, copy);

  const frame = document.createElement('iframe');
  frame.className = 'studio-site-preview-frame';
  frame.title = language === 'en' ? `Local site — ${projectName}` : `Site local — ${projectName}`;
  frame.src = previewRequestUrl(projectId);
  frame.addEventListener('load', () => loading.classList.add('is-hidden'), { once: true });

  shell.append(frame, loading);
  root.replaceChildren(shell);
}
