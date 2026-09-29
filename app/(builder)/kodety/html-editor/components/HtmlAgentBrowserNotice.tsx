import { useId } from 'react';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import './HtmlAgentBrowserNotice.css';

/** Rendered before mounting the connected panel, so unsupported browsers get
 * useful guidance without starting a runtime or asking for OpenAI login. */
export function HtmlAgentBrowserNotice() {
  const english = getAdminUiLocale().toLowerCase().startsWith('en');
  const titleId = useId();
  return <section className="kodety-agent-browser-notice" data-agent-browser-notice role="status" aria-labelledby={titleId}>
    <h3 id={titleId}>{english ? 'Use a compatible browser' : 'Use um navegador compatível'}</h3>
    <p>{english
      ? 'To use Kodety agents, open this project in an up-to-date version of one of these desktop browsers:'
      : 'Para usar os agentes do Kodety, abra este projeto na versão atual de um destes navegadores no computador:'}</p>
    <ul aria-label={english ? 'Recommended browsers' : 'Navegadores recomendados'}>
      <li>Google Chrome</li><li>Microsoft Edge</li><li>Brave</li><li>Arc</li><li>Dia</li><li>Zen Browser</li>
    </ul>
    <p className="kodety-agent-browser-notice-footnote">{english
      ? 'You can keep editing your project in this browser.'
      : 'Você pode continuar editando seu projeto neste navegador.'}</p>
  </section>;
}
