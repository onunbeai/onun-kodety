import '../../../Wordpress/kodety/admin/i18n.js';
import aliases from '../../../Wordpress/kodety/languages/admin-ui/aliases.json';
import english from '../../../Wordpress/kodety/languages/admin-ui/en.json';
import portuguese from '../../../Wordpress/kodety/languages/admin-ui/pt-BR.json';

type Catalog = { locale: string; direction: string; messages: Record<string, string>; direct: Record<string, string> };
type RuntimeConfig = Catalog & { aliases: Record<string, string[]>; scope: 'document'; restoreOnStop: true; attributes: string[] };

/** Mount after the HTML host is present and before opening the shared Builder.
 * Return this cleanup directly from the host's language-dependent effect. */
export function mountHtmlEditorI18n(language: 'en' | 'pt'): () => void {
  const mount = (window as Window & { kodetyMountAdminI18n?: (config: RuntimeConfig) => () => void }).kodetyMountAdminI18n;
  if (!mount) throw new Error('The shared Kodety interface translation runtime did not load.');
  const catalog = language === 'pt' ? portuguese : english;
  return mount({
    ...catalog,
    direct: { ...catalog.direct, ...(language === 'en' ? {
      'Conteúdo salvo no CMS.': 'Content saved in CMS.',
      'Não foi possível salvar no CMS.': 'Could not save to CMS.',
      'Carregando coleções…': 'Loading collections…',
      'Nenhuma coleção criada.': 'No collections yet.',
      'Nenhuma coleção criada': 'No collections yet',
      'Crie sua primeira coleção': 'Create your first collection',
      'Criar primeira coleção': 'Create first collection',
      'Não foi possível carregar o CMS': 'Could not load CMS',
      'Tente novamente para carregar as coleções deste projeto.': 'Try again to load this project’s collections.',
      'Organize conteúdos como artigos, projetos ou produtos. Depois, conecte os campos ao seu site.': 'Organize content such as articles, projects, or products. Then connect the fields to your site.',
      'Alterações salvas neste dispositivo; sincronização com a nuvem em andamento': 'Changes saved on this device; cloud sync in progress',
      'Projeto salvo na nuvem': 'Project saved to the cloud',
      'Não foi possível sincronizar o projeto': 'Could not sync the project',
    } : {}) },
    aliases,
    scope: 'document',
    restoreOnStop: true,
    attributes: [
      'title', 'placeholder', 'aria-label', 'aria-description', 'alt', 'value',
      'data-kodety-confirm', 'data-enabling-label', 'data-disabling-label',
      'data-tooltip', 'data-confirm-message', 'data-default-label',
    ],
  });
}
