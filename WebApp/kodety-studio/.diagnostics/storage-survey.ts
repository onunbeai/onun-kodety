import { startPlaygroundWeb } from '@wp-playground/client';
import remoteSource from './storage-survey-remote.mjs?raw';
import { loadProjects, opfsPathForProject } from '../../../ChromeExtension/kodety-studio/src/storage';

const surveyPath = '/wordpress/wp-admin/kodety-storage-survey.html';

export const surveyHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Levantamento OPFS somente leitura</title>
<style>body{margin:0;padding:24px;background:#191919;color:#eee;font:14px system-ui}h1{font-size:22px}p{max-width:850px;color:#bbb;line-height:1.6}button{padding:11px 16px;margin:0 8px 12px 0;border:0;border-radius:7px;background:#9993ff;color:#171527;font-weight:650;cursor:pointer}button:disabled{opacity:.4;cursor:default}pre{padding:16px;border:1px solid #444;background:#111;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}#survey-status{min-height:24px}</style>
</head><body><h1>Levantamento do armazenamento do WordPress</h1>
<p>Esta leitura procura raízes de projetos e arquivos com nomes de banco SQLite na origem do Playground. Mostra somente nomes, caminhos e tamanhos. Limites: oito níveis de diretórios e 50.000 entradas. Os arquivos salvos não são montados no WordPress.</p>
<button id="scan-storage" type="button">Ler armazenamento</button><button id="cancel-scan" type="button" disabled>Interromper leitura</button>
<p id="survey-status" role="status">Pronto para ler o armazenamento disponível neste navegador.</p><pre id="survey-output" aria-label="Relatório do armazenamento">O relatório aparecerá aqui.</pre>
<script type="module">${remoteSource.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;

export async function renderStorageSurvey(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#kodety-studio-root');
  if (!root) throw new Error('O elemento raiz do Studio não foi encontrado.');
  root.innerHTML = `<style>
    #storage-survey{padding:24px;min-height:100vh;background:#151515;color:#eee;font:14px system-ui}
    #storage-survey h1{margin-top:0;font-size:24px}#storage-survey p{color:#bbb;line-height:1.6;max-width:900px}
    #storage-survey button{padding:12px 16px;border:0;border-radius:7px;background:#9993ff;color:#171527;font-weight:650;cursor:pointer}
    #storage-survey button:disabled{opacity:.4;cursor:wait}#storage-survey iframe{width:100%;min-height:760px;border:1px solid #444;background:#191919}
    #storage-survey pre{padding:14px;border:1px solid #444;background:#111;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}
  </style><main id="storage-survey"><h1>Localizar arquivos de projetos</h1>
  <p>Este diagnóstico procura possíveis bancos em caminhos órfãos ou aninhados. Mostra apenas nomes, caminhos e tamanhos. Os arquivos salvos não são montados no WordPress e não são alterados.</p>
  <details open><summary>Catálogo local do Studio e caminhos esperados</summary><pre id="survey-catalog">Lendo o catálogo local…</pre></details>
  <button id="open-survey" type="button">Abrir levantamento somente leitura</button>
  <p id="launch-status" role="status">Nenhuma leitura de OPFS iniciada.</p>
  <iframe id="survey-runtime" title="Levantamento do armazenamento na origem do Playground" sandbox="allow-same-origin allow-scripts"></iframe></main>`;
  const iframe = root.querySelector<HTMLIFrameElement>('#survey-runtime')!;
  const start = root.querySelector<HTMLButtonElement>('#open-survey')!;
  const status = root.querySelector<HTMLElement>('#launch-status')!;
  const catalog = root.querySelector<HTMLElement>('#survey-catalog')!;
  try {
    const projects = await loadProjects();
    catalog.textContent = JSON.stringify({
      studioOrigin: location.origin,
      projects: projects.map(project => ({ id: project.id, name: project.name, expectedOpfsPath: opfsPathForProject(project.id) })),
    }, null, 2);
  } catch (error) {
    catalog.textContent = error instanceof Error ? error.message : 'Não foi possível ler o catálogo local.';
  }

  start.addEventListener('click', async () => {
  start.disabled = true;
  status.textContent = 'Abrindo um runtime temporário sem projetos montados…';
  iframe.src = 'about:blank';
  try {
    await startPlaygroundWeb({
      iframe,
      remoteUrl: 'https://playground.wordpress.net/remote.html',
      scope: `kodety-opfs-survey-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
      wordpressInstallMode: 'download-and-install',
      disableProgressBar: true,
      detailedProgressCaptions: true,
      blueprint: {
        preferredVersions: { php: '8.3', wp: '7.1' },
        features: { networking: false },
        login: false,
        landingPage: '/wp-admin/kodety-storage-survey.html',
        steps: [{ step: 'writeFile', path: surveyPath, data: surveyHtml }],
      },
    });
    status.textContent = 'Use “Ler armazenamento” no painel abaixo. O relatório é exibido dentro da origem que possui os arquivos.';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Não foi possível abrir o levantamento.';
  } finally {
    start.disabled = false;
  }
});

}
