import { useRef, useState } from 'react';
import { Icon, Notice, Spinner } from './ui';

export function HtmlWordPressDeploymentPanel({ onExportWordPress, language, onBusy }: {
  onExportWordPress(): Promise<void>;
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
    lock.current = true;
    setBusy(true); onBusy(true); setError(''); setDownloaded(false);
    try {
      await onExportWordPress();
      setDownloaded(true);
    } catch {
      setError(l('Não foi possível preparar o ZIP. Confira o salvamento do projeto e tente novamente.', 'Could not prepare the ZIP. Check that your project is saved and try again.'));
    } finally {
      lock.current = false;
      setBusy(false); onBusy(false);
    }
  }

  return <section className="web-html-deployment-section web-html-deployment-wordpress" aria-label={l('Publicação no WordPress', 'WordPress publishing')}>
    <h3>{l('Leve seu projeto para o WordPress', 'Take your project to WordPress')}</h3>
    <p className="web-html-deployment-intro">{l('Crie seu site no Studio e leve o projeto completo para o WordPress com o plugin Onun Kodety. O ZIP inclui as páginas, os arquivos e os dados de edição do projeto para continuar trabalhando por lá.', 'Build your site in Studio and take the complete project to WordPress with the Onun Kodety plugin. The ZIP includes your project pages, files, and editing data so you can keep working there.')}</p>
    <ol className="web-html-deployment-steps">
      <li><div>
        <strong>{l('Baixe o ZIP do projeto', 'Download the project ZIP')}</strong>
        <small>{l('Baixe o projeto completo e mantenha o arquivo ZIP para importar no Kodety.', 'Download the complete project and keep the ZIP file to import into Kodety.')}</small>
        <button type="button" className="web-button is-primary web-html-wordpress-download" disabled={busy} onClick={() => void download()}>{busy ? <Spinner /> : <Icon name="download" />}{busy ? l('Preparando ZIP…', 'Preparing ZIP…') : l('Baixar ZIP para WordPress', 'Download WordPress ZIP')}</button>
        {error && <Notice>{error}</Notice>}
        {downloaded && <Notice tone="info">{l('ZIP preparado. Continue os passos abaixo para importar o projeto no WordPress.', 'ZIP prepared. Follow the steps below to import the project into WordPress.')}</Notice>}
      </div></li>
      <li><div>
        <strong>{l('Instale o WordPress na sua hospedagem', 'Install WordPress on your hosting')}</strong>
        <small>{l('No painel da hospedagem, instale o WordPress no domínio desejado. Se você já tem uma instalação, abra o painel administrativo dela.', 'In your hosting dashboard, install WordPress on your chosen domain. If you already have an installation, open its administration dashboard.')}</small>
      </div></li>
      <li><div>
        <strong>{l('Instale e ative o plugin Onun Kodety', 'Install and activate the Onun Kodety plugin')}</strong>
        <small>{l('Baixe o plugin pelo link abaixo. No painel do WordPress, abra Plugins → Adicionar novo → Enviar plugin. Envie o ZIP do plugin Onun Kodety, instale e ative.', 'Download the plugin using the link below. In WordPress, open Plugins → Add New → Upload Plugin. Upload the Onun Kodety plugin ZIP, install it, and activate it.')}</small>
        <a className="web-button web-html-wordpress-plugin" href="./assets/kodety.zip" download target="_blank" rel="noreferrer">{l('Baixar plugin Onun Kodety para WordPress', 'Download Onun Kodety plugin for WordPress')} <Icon name="external" /></a>
      </div></li>
      <li><div>
        <strong>{l('Importe o ZIP do projeto no Kodety', 'Import the project ZIP into Kodety')}</strong>
        <small>{l('No painel do WordPress, abra Kodety → Atualizar HTML → Importar projeto → Arquivo ZIP. Selecione o ZIP do projeto que você baixou no primeiro passo. Esse arquivo deve ser importado no Kodety, não no instalador de temas ou plugins do WordPress.', 'In the WordPress dashboard, open Kodety → Update HTML → Import project → ZIP file. Select the project ZIP you downloaded in the first step. Import this file into Kodety, not into the WordPress theme or plugin installer.')}</small>
      </div></li>
      <li><div>
        <strong>{l('Confira e publique seu site', 'Review and publish your site')}</strong>
        <small>{l('Abra o projeto importado no Kodety, confira as páginas, imagens e links e publique pelo WordPress. Você pode continuar editando o projeto no Kodety.', 'Open the imported project in Kodety, review the pages, images, and links, and publish through WordPress. You can keep editing the project in Kodety.')}</small>
      </div></li>
    </ol>
  </section>;
}
