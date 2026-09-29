import { DisclosureSummary } from "../../../components/ui/disclosure-summary";
import { useRef, useState } from 'react';
import { downloadZipBlob } from '../../../lib/html-editor/project-io';
import { StaticLicensePublicationError } from '../../../lib/html-editor/static-license';
import { createHtmlFtpUpload } from './html-deployment-ftp';
import { HtmlDeploymentError, type HtmlDeploymentFile } from './html-deployment-github';
import { Icon, Notice, Spinner } from './ui';

export function HtmlFtpDeploymentPanel({ getFiles, language, onBusy }: {
  getFiles(): Promise<HtmlDeploymentFile[]>;
  language: string;
  onBusy(busy: boolean): void;
}) {
  const l = (pt: string, en: string) => language === 'en' ? en : pt;
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(''); setDownloaded(false);
    try {
      // getFiles flushes current edits and applies the same publication policy
      // and static compiler as the other deployment options.
      downloadZipBlob(await createHtmlFtpUpload(await getFiles()), 'kodety-site-ftp.zip');
      setDownloaded(true);
    } catch (cause) {
      setError(cause instanceof StaticLicensePublicationError ? cause.message : cause instanceof HtmlDeploymentError && cause.code === 'direct-index'
        ? l('Defina a página inicial do site para gerar index.html na raiz e tente novamente.', 'Set the site home page to generate index.html at the root, then try again.')
        : l('Não foi possível preparar o ZIP. Confira o salvamento do projeto e tente novamente.', 'Could not prepare the ZIP. Check that your project is saved and try again.'));
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  }

  return <section className="web-html-deployment-section web-html-deployment-ftp" aria-label={l('Publicação por FTP', 'FTP publishing')}>
    <h3>{l('Publique na sua hospedagem', 'Publish to your hosting provider')}</h3>
    <p className="web-html-deployment-intro">{l('Use qualquer hospedagem de sites HTML que ofereça FTP, SFTP ou gerenciador de arquivos. O Kodety prepara o site; você envia os arquivos seguindo os passos abaixo.', 'Use any HTML hosting provider with FTP, SFTP, or a file manager. Kodety prepares your site; follow the steps below to upload the files.')}</p>
    <ol className="web-html-deployment-steps">
      <li><div>
        <strong>{l('Baixe e extraia o ZIP', 'Download and extract the ZIP')}</strong>
        <small>{l('Baixe a versão pronta para hospedagem e extraia o ZIP no computador. Dentro dele estão index.html e as pastas do site.', 'Download the hosting-ready version and extract the ZIP on your computer. It contains index.html and your site folders.')}</small>
        <button type="button" className="web-button is-primary web-html-ftp-download" disabled={busy} onClick={() => void download()}>{busy ? <Spinner /> : <Icon name="download" />}{busy ? l('Preparando ZIP…', 'Preparing ZIP…') : l('Baixar ZIP para FTP', 'Download FTP ZIP')}</button>
        {error && <Notice>{error}</Notice>}
        {downloaded && <Notice tone="info">{l('ZIP preparado. Extraia os arquivos e continue os passos para colocar o site no ar.', 'ZIP prepared. Extract the files and continue the steps to put your site online.')}</Notice>}
      </div></li>
      <li><div>
        <strong>{l('Pegue os dados de acesso da hospedagem', 'Get your hosting connection details')}</strong>
        <small>{l('No painel da hospedagem, abra FTP/SFTP ou Contas FTP. Copie o servidor (host), usuário, senha ou chave e porta. Use o protocolo indicado pelo provedor, como SFTP ou FTPS.', 'In your hosting dashboard, open FTP/SFTP or FTP Accounts. Find the server (host), username, password or key, and port. Use the protocol specified by your provider, such as SFTP or FTPS.')}</small>
      </div></li>
      <li><div>
        <strong>{l('Conecte pelo FileZilla ou outro cliente FTP', 'Connect with FileZilla or another FTP client')}</strong>
        <small>{l('No FileZilla Client, abra Arquivo → Gerenciador de Sites → Novo site. Selecione o protocolo, preencha os dados da hospedagem e conecte. Seus arquivos ficam à esquerda; os da hospedagem, à direita.', 'In FileZilla Client, open File → Site Manager → New site. Select the protocol, enter your hosting details, and connect. Your local files appear on the left and hosting files on the right.')}</small>
      </div></li>
      <li><div>
        <strong>{l('Envie os arquivos para a pasta do domínio', 'Upload the files to your domain folder')}</strong>
        <small>{l('Abra a pasta pública indicada pela hospedagem, como public_html, www ou httpdocs. Envie o conteúdo da pasta extraída, mantendo as subpastas. O index.html deve ficar diretamente na pasta do domínio. Se já existir um site nesse destino, faça uma cópia dele antes de substituir os arquivos.', 'Open the public folder specified by your host, such as public_html, www, or httpdocs. Upload the contents of the extracted folder, keeping its subfolders. Place index.html directly in the domain folder. If a site already exists there, back it up before replacing its files.')}</small>
      </div></li>
      <li><div>
        <strong>{l('Abra o domínio e confira o site', 'Open your domain and check the site')}</strong>
        <small>{l('Aguarde a fila de transferências terminar e confira se houve falhas. Abra o endereço do site e teste páginas, imagens e links. Para atualizar o site depois, baixe um novo ZIP no Kodety e envie os arquivos atualizados.', 'Wait for the transfer queue to finish and check for failed transfers. Open your website address and test pages, images, and links. To update it later, download a fresh ZIP from Kodety and upload the updated files.')}</small>
      </div></li>
    </ol>
    <div className="web-html-deployment-links">
      <a href="https://filezilla-project.org/download.php?type=client" target="_blank" rel="noreferrer">{l('Baixar FileZilla Client', 'Download FileZilla Client')} <Icon name="external" /></a>
      <a href="https://docs.cpanel.net/knowledge-base/ftp/how-to-upload-files-with-ftp/" target="_blank" rel="noreferrer">{l('Guia de FTP do cPanel', 'cPanel FTP guide')} <Icon name="external" /></a>
    </div>
    <details className="web-html-deployment-provider">
      <DisclosureSummary>{l('Prefere usar o gerenciador de arquivos?', 'Prefer using a file manager?')}</DisclosureSummary>
      <p>{l('Abra o gerenciador de arquivos no painel da hospedagem e entre na pasta do domínio. Envie o ZIP e use a opção Extrair, se disponível. Confira se index.html ficou diretamente nessa pasta. Se o painel não extrair ZIPs, extraia no computador e envie os arquivos e subpastas.', 'Open the file manager in your hosting dashboard and go to your domain folder. Upload the ZIP and use Extract if available. Check that index.html is directly in that folder. If the dashboard cannot extract ZIPs, extract it on your computer and upload the files and subfolders.')}</p>
    </details>
    <details className="web-html-deployment-provider">
      <DisclosureSummary>{l('O domínio ainda não mostra o site?', 'Your domain still does not show the site?')}</DisclosureSummary>
      <p>{l('Confira se os arquivos foram enviados para a pasta correta do domínio. No painel da hospedagem, verifique o apontamento do domínio e a ativação do HTTPS. Se aparecer uma versão antiga, atualize a página e limpe o cache. O suporte da hospedagem pode confirmar a pasta e os dados de conexão.', 'Check that the files were uploaded to the correct domain folder. In your hosting dashboard, check the domain connection and HTTPS setup. If an old version appears, refresh the page and clear the cache. Your hosting support can confirm the folder and connection details.')}</p>
    </details>
  </section>;
}
