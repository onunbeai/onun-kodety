import { BUILDER_ONBOARDING_DETAILS } from './onboarding-builder-details';
import { SETTINGS_ONBOARDING_DETAILS, CMS_ONBOARDING_DETAILS } from './onboarding-content-details';
import { ANALYTICS_ONBOARDING_DETAILS, LOCALIZATION_ONBOARDING_DETAILS } from './onboarding-management-details';

export type OnboardingTourId =
  | 'design'
  | 'cms'
  | 'settings'
  | 'analytics'
  | 'localization'
  | 'members'
  | 'templates';

export interface OnboardingStep {
  id: string;
  /** Stable landmarks; unavailable or hidden features are skipped by the host. */
  target: string;
  /** Selector for a marked, safe view control that reveals the real target. */
  reveal?: string;
  title: string;
  description: string;
  tip?: string;
  /** Optional, user-requested walkthrough of the controls within this step. */
  details?: readonly OnboardingStep[];
}

export interface OnboardingTour {
  id: OnboardingTourId;
  title: string;
  description: string;
  steps: readonly OnboardingStep[];
}

const anchor = (id: string) => `[data-kodety-onboarding="${id}"]`;
const reveal = (id: string) => `${anchor(id)}[data-kodety-onboarding-reveal]`;
const settingsSection = (id: string) => `${anchor('settings-content')}[data-kodety-onboarding-section="${id}"]`;
const workspaceNavigation: OnboardingStep = {
  id: 'workspace-navigation',
  target: `${anchor('workspace-navigation')}, [data-workspace-primary-navigation]`,
  title: 'As áreas do seu projeto',
  description: 'Design cuida da aparência, CMS organiza o conteúdo e Insights acompanha os resultados. Cada área mantém suas ferramentas no mesmo lugar.',
  tip: 'Você pode conhecer cada área no seu ritmo pelo menu da logo.',
};
const workspaceAgent: OnboardingStep = {
  id: 'workspace-agent',
  target: anchor('workspace-agent'),
  title: 'Ajuda dentro da área atual',
  description: 'Abra o Agent para pedir ajuda com o contexto desta área. Descreva o resultado que procura e acompanhe as ações na conversa.',
};

const styleDetails: readonly OnboardingStep[] = [
  {
    id: 'style-position',
    target: anchor('design-style-position'),
    reveal: `${reveal('design-style')}, ${reveal('design-style-position-disclosure')}`,
    title: 'Position: onde o elemento se posiciona',
    description: 'Type escolhe entre o fluxo normal, deslocamento relativo, posição absoluta, Sticky e Fixed. As distâncias aos lados aparecem conforme o tipo; Z-index controla a ordem de sobreposição.',
    tip: 'Absolute usa um ancestral como referência. Fixed acompanha a tela; Sticky passa a acompanhar a rolagem dentro dos limites do seu container.',
  },
  {
    id: 'style-layout',
    target: anchor('design-style-layout'),
    reveal: reveal('design-style'),
    title: 'Layout: organize os elementos dentro da seleção',
    description: 'Type organiza os filhos em colunas, linhas ou grid. Align e Justify controlam o alinhamento; Gap define o intervalo entre os filhos. As opções de grid e quebra de linha aparecem conforme o tipo escolhido.',
    tip: 'Visible controla a exibição da seleção. Confira a classe, o estado e o breakpoint ativos antes de alterar qualquer valor de Style.',
  },
  {
    id: 'style-spacing',
    target: anchor('design-style-spacing'),
    reveal: reveal('design-style'),
    title: 'Spacing: espaço por dentro e por fora',
    description: 'Padding cria espaço entre o conteúdo e as bordas do elemento. Margin controla o espaço externo. O diagrama permite ajustar cada lado e identificar onde o espaço está sendo aplicado.',
    tip: 'Para separar os filhos de um container, use Gap em Layout. Para afastar o conteúdo das bordas do container, use Padding.',
  },
  {
    id: 'style-sizing',
    target: anchor('design-style-sizing'),
    reveal: reveal('design-style'),
    title: 'Sizing: dimensões e limites',
    description: 'Width e Height definem largura e altura; os limites mínimos e máximos restringem o crescimento. Overflow escolhe o que acontece com conteúdo que ultrapassa essas dimensões.',
    tip: 'Em imagens e vídeos, Object fit ajusta como a mídia ocupa a caixa e Object position escolhe a região em destaque.',
  },
  {
    id: 'style-typography',
    target: anchor('design-style-typography'),
    reveal: reveal('design-style'),
    title: 'Typography: aparência e leitura do texto',
    description: 'Escolha a fonte, o peso, o tamanho e a cor. O alinhamento organiza as linhas; Letter ajusta o espaço entre letras e Line height controla a distância entre as linhas de texto.',
    tip: 'Estilos tipográficos definidos em um container podem ser herdados pelo texto dentro dele. Selecione o texto para ajustar apenas seu contexto.',
  },
  {
    id: 'style-backgrounds',
    target: anchor('design-style-backgrounds'),
    reveal: reveal('design-style'),
    title: 'Backgrounds: o fundo do elemento',
    description: 'Color define o preenchimento de fundo. As opções de imagem permitem escolher a origem e ajustar tamanho, posição e repetição dentro da área do elemento.',
    tip: 'O fundo pertence à caixa selecionada. Para mudar a cor das letras, use Typography.',
  },
  {
    id: 'style-borders',
    target: anchor('design-style-borders'),
    reveal: reveal('design-style'),
    title: 'Borders: contorno e cantos',
    description: 'Defina a espessura, o estilo e a cor da borda. Os controles de arredondamento ajustam os cantos juntos ou individualmente, permitindo repetir o acabamento em cards, imagens e botões.',
    tip: 'Um canto arredondado muda o contorno. Se o conteúdo precisar acompanhar o recorte, confira também Overflow em Sizing.',
  },
  {
    id: 'style-effects',
    target: anchor('design-style-effects'),
    reveal: reveal('design-style'),
    title: 'Effects: transparência, sombra e filtros',
    description: 'Opacity controla a transparência da seleção. Shadow ajusta sombras internas ou externas. O menu de filtros oferece Blur para desfocar o elemento e BG Blur para desfocar o que aparece atrás dele.',
    tip: 'Reduzir Opacity afeta também o conteúdo do elemento. Para deixar só o fundo transparente, ajuste sua cor em Backgrounds.',
  },
  {
    id: 'style-transform',
    target: anchor('design-style-transform'),
    reveal: reveal('design-style'),
    title: 'Transform: escala, rotação e deslocamento',
    description: 'O botão + reúne Scale, Rotate, Move e Skew. Esses controles alteram a aparência e a posição visual do elemento; as opções surgem quando uma transformação está ativa.',
    tip: 'Move desloca a aparência sem reorganizar os elementos ao redor. Para mudar os espaços do layout, confira Spacing e Layout.',
  },
];

/**
 * Tours may open safe view panels, but never create content, change settings
 * or publish. Conditional landmarks let the same catalog
 * serve licensed, read-only, standalone and editor workspaces.
 */
const BASE_ONBOARDING_TOURS: readonly OnboardingTour[] = [
  {
    id: 'design',
    title: 'Builder e Design',
    description: 'Canvas, páginas, estilos, componentes e publicação.',
    steps: [
      workspaceNavigation,
      {
        id: 'canvas',
        target: anchor('design-canvas'),
        title: 'Seu site no canvas',
        description: 'Esta é a área visual do site. Selecione um elemento para ver suas propriedades à direita e use as camadas à esquerda para entender a estrutura.',
        tip: 'Se você vem do Elementor, pense no canvas como a área de edição da página.',
      },
      {
        id: 'insert',
        target: anchor('design-insert-panel'),
        reveal: reveal('design-insert'),
        title: 'Comece pelo Insert',
        description: 'Este painel reúne elementos, estruturas e componentes. Busque o que precisa ou explore as categorias; depois, insira por clique ou arraste para o canvas.',
        tip: 'É o ponto de partida equivalente ao painel de elementos do Elementor ou Add do Webflow.',
      },
      {
        id: 'layers',
        target: anchor('design-layers-panel'),
        reveal: reveal('design-layers'),
        title: 'Layers: a estrutura da página',
        description: 'Localize elementos dentro de seções e containers, selecione partes pequenas e reorganize a hierarquia sem depender apenas do canvas.',
        tip: 'É o papel do Navigator no Webflow e da Estrutura no Elementor.',
      },
      {
        id: 'pages',
        target: anchor('design-pages-panel'),
        reveal: reveal('design-pages'),
        title: 'Pages: navegue pelo site',
        description: 'Encontre as páginas do projeto, organize pastas e escolha qual página editar. As configurações específicas de cada página ficam em Settings.',
      },
      {
        id: 'assets',
        target: anchor('design-assets-panel'),
        reveal: reveal('design-assets'),
        title: 'Assets: a biblioteca de arquivos',
        description: 'Gerencie imagens e outros arquivos usados pelo projeto. Reaproveite os assets nas páginas para manter o conteúdo organizado.',
      },
      {
        id: 'variables',
        target: anchor('design-variables-panel'),
        reveal: reveal('design-variables'),
        title: 'Variables: consistência visual',
        description: 'Centralize cores, fontes e outros valores reutilizáveis. Vincular propriedades a uma variável facilita manter o mesmo padrão em diferentes partes do site.',
        tip: 'O conceito é próximo das variáveis do Webflow e dos estilos globais do Elementor.',
      },
      {
        id: 'inspector',
        target: anchor('design-inspector-panel'),
        reveal: `${reveal('design-human-mode')}, ${reveal('design-select-page')}`,
        title: 'As propriedades da seleção',
        description: 'Selecione algo no canvas para editar por aqui. Style controla a aparência, Settings reúne os atributos do elemento e Interactions define seu comportamento.',
      },
      {
        id: 'style',
        target: anchor('design-style-panel'),
        reveal: reveal('design-style'),
        title: 'Style: a aparência do elemento',
        description: 'Ajuste layout, tamanho, espaçamento, tipografia, cores e bordas do elemento selecionado. Confira o breakpoint e a classe ativos antes de editar.',
        details: styleDetails,
      },
      {
        id: 'classes',
        target: anchor('design-classes'),
        reveal: reveal('design-style'),
        title: 'Classes e estilos compartilhados',
        description: 'Veja qual classe está recebendo seus ajustes. Uma classe reutilizada pode alcançar vários elementos; confira o contexto de edição antes de mudar o estilo.',
        tip: 'Quem vem do Webflow já conhece essa relação entre uma classe e os elementos que a usam.',
      },
      {
        id: 'element-settings',
        target: anchor('design-element-settings-panel'),
        reveal: reveal('design-element-settings'),
        title: 'Settings deste elemento',
        description: 'Configure conteúdo, links, atributos e opções próprias da seleção. As opções mudam conforme o tipo de elemento, como imagem, botão ou formulário.',
      },
      {
        id: 'interactions',
        target: anchor('design-interactions-panel'),
        reveal: reveal('design-interactions'),
        title: 'Interactions: eventos e movimento',
        description: 'Defina o que acontece em cliques, hover, entrada na tela e outros eventos. Selecione um elemento para configurar gatilhos, ações e transições.',
      },
      {
        id: 'effects',
        target: anchor('design-effects-panel'),
        title: 'Biblioteca de efeitos',
        description: 'Explore efeitos prontos e confira o alvo e o momento de ativação. Ajuste as opções do efeito antes de aplicá-lo à seleção.',
      },
      {
        id: 'timeline',
        target: anchor('design-timeline'),
        title: 'Ajuste o movimento no tempo',
        description: 'A timeline organiza as ações da interação. Use os keyframes para refinar valores, duração e sequência do movimento.',
      },
      {
        id: 'component-variants',
        target: anchor('design-component-variants'),
        title: 'Variantes do componente',
        description: 'Você está editando um componente reutilizável. As variantes representam seus estados; confira qual está ativa e use Done para voltar à página.',
      },
      {
        id: 'responsive',
        target: `${anchor('design-responsive')}, [data-preview-viewport-toolbar]`,
        title: 'Confira cada tamanho de tela',
        description: 'Troque o dispositivo ou ajuste as dimensões do viewport para revisar o layout. Observe o breakpoint ativo ao trabalhar nos estilos responsivos.',
      },
      {
        id: 'code',
        target: anchor('design-code-panel'),
        reveal: reveal('design-code'),
        title: 'Código do projeto',
        description: 'Este painel abre os arquivos HTML, CSS e JavaScript do mesmo projeto visual. Confira o arquivo selecionado no topo antes de editar seu conteúdo.',
      },
      {
        id: 'settings',
        target: anchor('design-settings'),
        title: 'Configurações do projeto',
        description: 'Abra Settings para cuidar da identidade do site, SEO, redirecionamentos, código global, integrações e configurações de cada página.',
      },
      {
        id: 'agent',
        target: anchor('agent-panel'),
        reveal: reveal('design-agent-mode'),
        title: 'Canvas e Agent no mesmo painel',
        description: 'Esta é a conversa com o Agent. Diga qual parte do projeto quer trabalhar e acompanhe as ações solicitadas. Use Canvas no topo para voltar às propriedades visuais.',
      },
      {
        id: 'preview',
        target: `${anchor('design-preview')}, [data-tooltip="Preview"], [data-preview-status-toolbar]`,
        title: 'Teste a experiência',
        description: 'Use Preview para conferir a navegação, links e interações como visitante. Revise também os tamanhos de tela antes de publicar.',
      },
      {
        id: 'publish',
        target: `${anchor('design-publish')}, [data-publish-trigger]`,
        title: 'Publique quando estiver pronto',
        description: 'O botão Publicar abre as opções de publicação e mostra as alterações pendentes. Confira o estado do projeto antes de disponibilizar a versão para visitantes.',
        tip: 'Salvar o trabalho e publicar o site são etapas diferentes.',
      },
      {
        id: 'publish-panel',
        target: anchor('design-publish-panel'),
        title: 'Revise a publicação',
        description: 'Este painel mostra o estado de publicação e as ações disponíveis. Confira as alterações e as opções antes de confirmar uma nova versão do site.',
      },
      {
        id: 'reopen',
        target: `${anchor('onboarding-menu')}, [data-editor-corner-menu-trigger]`,
        title: 'Este guia continua à sua disposição',
        description: 'Abra o menu da logo e escolha Onboarding, logo abaixo das atualizações, sempre que quiser rever uma área. A decisão de dispensar o guia será respeitada.',
      },
    ],
  },
  {
    id: 'cms',
    title: 'CMS e conteúdo',
    description: 'Coleções, campos, itens e importação de conteúdo.',
    steps: [
      workspaceNavigation,
      {
        id: 'collections',
        target: anchor('cms-collections'),
        reveal: reveal('cms-collections-tab'),
        title: 'Coleções organizam o conteúdo',
        description: 'Uma coleção reúne itens do mesmo tipo, como posts, serviços ou projetos. Selecione uma coleção para trabalhar em seu conteúdo.',
        tip: 'É o conceito de Collections no Webflow; no WordPress, também convivem tipos de conteúdo nativos.',
      },
      {
        id: 'fields',
        target: `${anchor('cms-content')}[data-kodety-onboarding-section="fields"]`,
        reveal: reveal('cms-fields-tab'),
        title: 'Campos definem cada item',
        description: 'Configure os dados que uma coleção guarda: textos, imagens, números e outros tipos. A estrutura dos campos é compartilhada pelos itens da coleção.',
        tip: 'Se você usa campos personalizados no WordPress, encontrará essa mesma ideia aqui.',
      },
      {
        id: 'toolbar',
        target: anchor('cms-toolbar'),
        reveal: reveal('cms-collections-tab'),
        title: 'Encontre o conteúdo certo',
        description: 'Use busca, filtros e ordenação para localizar itens. Você também pode escolher quais colunas aparecem na tabela e atualizar a listagem.',
      },
      {
        id: 'items',
        target: anchor('cms-items'),
        reveal: reveal('cms-collections-tab'),
        title: 'Os itens da coleção',
        description: 'Cada linha representa um item e cada coluna mostra um campo. Abra um item para editar seu conteúdo e confira o status antes de publicá-lo.',
      },
      {
        id: 'new-item',
        target: anchor('cms-new-item'),
        reveal: reveal('cms-collections-tab'),
        title: 'Adicione conteúdo sem refazer o layout',
        description: 'Crie um item, preencha os campos da coleção e defina seu status. Nas páginas com conteúdo vinculado ao CMS, os dados usam a estrutura visual que você preparou.',
      },
      {
        id: 'import',
        target: anchor('cms-import'),
        reveal: reveal('cms-collections-tab'),
        title: 'Traga conteúdo por CSV',
        description: 'Importe uma planilha em CSV para preencher a coleção. Revise a correspondência entre as colunas do arquivo e os campos antes de confirmar a importação.',
      },
      {
        id: 'item-editor',
        target: anchor('cms-item-editor'),
        title: 'Edite os dados do item',
        description: 'Preencha os campos deste conteúdo, confira imagens e status e use as ações de salvar. As alterações pertencem ao item aberto.',
      },
      workspaceAgent,
    ],
  },
  {
    id: 'settings',
    title: 'Settings do projeto',
    description: 'Identidade, SEO, integrações e ajustes de cada página.',
    steps: [
      {
        id: 'navigation',
        target: `${anchor('settings-navigation')}, ${anchor('settings-mobile-navigation')}`,
        title: 'Configurações por assunto',
        description: 'Site Settings reúne opções compartilhadas pelo projeto. Page Settings organiza os ajustes específicos de cada página, como título, URL e dados para compartilhamento.',
      },
      {
        id: 'general',
        target: settingsSection('general'),
        reveal: reveal('settings-section-general'),
        title: 'A identidade do site',
        description: 'Em Geral, configure os dados públicos e as imagens usadas pelo site. Esses valores ajudam a manter a identidade consistente nas páginas.',
      },
      {
        id: 'seo',
        target: settingsSection('seo'),
        reveal: reveal('settings-section-seo'),
        title: 'SEO e descoberta',
        description: 'Encontre as configurações para mecanismos de busca, sitemap e descoberta do site. Revise também o SEO de cada página na lista abaixo.',
      },
      {
        id: 'redirects',
        target: settingsSection('redirects'),
        reveal: reveal('settings-section-redirects'),
        title: 'Mantenha os caminhos funcionando',
        description: 'Cadastre redirecionamentos quando uma URL mudar. Isso ajuda quem chega por links antigos a encontrar o destino correto.',
        tip: 'Ao migrar de outro builder, revise os endereços antigos e os novos.',
      },
      {
        id: 'cookie-consent',
        target: settingsSection('cookie-consent'),
        reveal: reveal('settings-section-cookie-consent'),
        title: 'Preferências de cookies',
        description: 'Configure o aviso e as categorias de consentimento do site. Revise os textos e o comportamento de scripts que dependem das escolhas do visitante.',
      },
      {
        id: 'code',
        target: settingsSection('code'),
        reveal: reveal('settings-section-code'),
        title: 'Código compartilhado pelo site',
        description: 'Custom Code reúne trechos globais, como scripts e estilos. Confira o local de inserção e o alcance antes de salvar uma alteração.',
      },
      {
        id: 'integrations',
        target: settingsSection('mcp'),
        reveal: reveal('settings-section-mcp'),
        title: 'Integrações e IA',
        description: 'Conecte os serviços disponíveis no projeto e configure integrações de IA e MCP. As opções exibidas dependem dos recursos e permissões da sua conta.',
      },
      {
        id: 'agents',
        target: settingsSection('agents'),
        reveal: reveal('settings-section-agents'),
        title: 'Ajustes dos agentes',
        description: 'Revise as configurações dos agentes disponíveis para o projeto. Essas opções orientam a assistência usada nas diferentes áreas do Kodety.',
      },
      {
        id: 'storage',
        target: settingsSection('storage'),
        reveal: reveal('settings-section-storage'),
        title: 'Armazenamento e versões',
        description: 'Consulte o estado de armazenamento e os snapshots disponíveis. Confira a versão escolhida antes de usar ações de recuperação ou restauração.',
      },
      {
        id: 'experimental',
        target: settingsSection('beta'),
        reveal: reveal('settings-section-beta'),
        title: 'Recursos experimentais',
        description: 'Conheça as opções em desenvolvimento e suas descrições antes de ativá-las. A disponibilidade pode variar conforme o projeto.',
      },
      {
        id: 'pages',
        target: anchor('settings-pages'),
        title: 'Cada página tem seus próprios ajustes',
        description: 'Escolha uma página para revisar informações específicas, como SEO e imagem social. Confira o nome da página no conteúdo antes de editar.',
      },
      {
        id: 'content',
        target: anchor('settings-content'),
        title: 'Leia o contexto de cada opção',
        description: 'O conteúdo central muda conforme a seção escolhida. Os rótulos e textos de apoio explicam o alcance das configurações que você está editando.',
      },
      {
        id: 'save',
        target: anchor('settings-save'),
        title: 'Confira e salve suas alterações',
        description: 'A barra informa quando existem alterações não salvas. Use a ação de salvar depois de revisar os campos e acompanhe o resultado exibido.',
      },
      workspaceAgent,
    ],
  },
  {
    id: 'analytics',
    title: 'Insights e Analytics',
    description: 'Tráfego, páginas, funis, testes A/B e campanhas.',
    steps: [
      {
        id: 'navigation',
        target: anchor('analytics-navigation'),
        title: 'Um relatório para cada pergunta',
        description: 'Navegue entre tráfego, comportamento nas páginas, funis e experimentos. Os recursos identificados como Pro dependem do acesso disponível no projeto.',
      },
      {
        id: 'overview',
        target: anchor('analytics-overview-body'),
        reveal: reveal('analytics-overview'),
        title: 'Entenda o movimento do site',
        description: 'A Visão geral reúne os principais indicadores de tráfego. Confira o período e os filtros do relatório ao comparar resultados.',
      },
      {
        id: 'page-insights',
        target: anchor('analytics-page-insights-body'),
        reveal: reveal('analytics-page-insights'),
        title: 'Veja o comportamento em cada página',
        description: 'A Visão de página ajuda a explorar eventos e profundidade de scroll na página publicada. Use esses sinais para entender quais partes recebem atenção.',
      },
      {
        id: 'funnels',
        target: anchor('analytics-funnels-body'),
        reveal: reveal('analytics-funnels'),
        title: 'Acompanhe uma jornada',
        description: 'Monte funis com as etapas que importam para o site e observe a passagem entre elas. Os funis salvos ficam acessíveis na lateral.',
      },
      {
        id: 'ab-tests',
        target: anchor('analytics-ab-tests-body'),
        reveal: reveal('analytics-ab-tests'),
        title: 'Compare variantes com um objetivo',
        description: 'Organize testes A/B para comparar versões e acompanhar conversões. Confira as variantes, o objetivo e o estado do experimento antes de ativá-lo.',
      },
      {
        id: 'utms',
        target: anchor('analytics-utms-body'),
        reveal: reveal('analytics-utms'),
        title: 'Organize suas campanhas',
        description: 'A Central de UTMs reúne parâmetros usados para identificar campanhas. Mantenha nomes consistentes para relacionar a origem do tráfego aos resultados.',
      },
      {
        id: 'content',
        target: anchor('analytics-content'),
        title: 'Leia o relatório no contexto',
        description: 'Confira filtros, período e estado de carregamento junto dos números. Quando o modo Demo estiver identificado, os dados exibidos são simulados.',
      },
      {
        id: 'refresh',
        target: anchor('analytics-refresh'),
        title: 'Atualize quando precisar',
        description: 'Atualize o relatório por aqui. Na Visão geral, você também pode escolher a frequência de atualização automática do painel.',
      },
      workspaceAgent,
    ],
  },
  {
    id: 'localization',
    title: 'Languages e localização',
    description: 'Idiomas, traduções e configurações regionais.',
    steps: [
      {
        id: 'languages',
        target: anchor('localization-languages'),
        title: 'Escolha o idioma de destino',
        description: 'O idioma fonte contém o conteúdo original. Selecione outro idioma para revisar suas traduções e acompanhar o progresso de preenchimento.',
      },
      {
        id: 'add',
        target: anchor('localization-add'),
        title: 'Adicione um idioma ao projeto',
        description: 'Escolha o idioma e confira suas opções regionais antes de adicioná-lo. Depois, revise o conteúdo que será apresentado aos visitantes dessa versão.',
      },
      {
        id: 'settings',
        target: anchor('localization-settings-body'),
        reveal: reveal('localization-settings'),
        title: 'Ajustes de localização',
        description: 'Revise as configurações gerais e de cada idioma, incluindo direção do texto e outras opções da versão localizada.',
      },
      {
        id: 'content',
        target: anchor('localization-content'),
        title: 'Original e tradução lado a lado',
        description: 'Trabalhe nos textos das páginas e nos dados do site a partir do conteúdo original. Confira o idioma ativo antes de editar.',
      },
      {
        id: 'filters',
        target: anchor('localization-filters'),
        title: 'Encontre o que falta traduzir',
        description: 'Busque um texto e filtre os campos pendentes ou já traduzidos. Isso facilita revisar o conteúdo sem percorrer todas as páginas.',
      },
      {
        id: 'translations',
        target: anchor('localization-translations'),
        title: 'Revise por página',
        description: 'Abra os grupos de conteúdo e edite os campos de tradução. Acompanhe o retorno de salvamento no topo para confirmar que suas alterações foram gravadas.',
      },
      {
        id: 'ai',
        target: anchor('localization-ai'),
        title: 'Rascunhos para acelerar a tradução',
        description: 'Quando a IA estiver configurada, gere rascunhos para os campos vazios. Revise nomes, tom e sentido antes de usar a tradução no site.',
      },
      workspaceAgent,
    ],
  },
  {
    id: 'members',
    title: 'Área de Membros',
    description: 'Pessoas, planos, acesso e configurações da área restrita.',
    steps: [
      {
        id: 'workspace',
        target: anchor('members-workspace'),
        title: 'Gerencie o acesso ao site',
        description: 'Esta área reúne membros, planos e configurações de acesso. As ferramentas disponíveis dependem da ativação do recurso e das permissões da conta.',
      },
      {
        id: 'members',
        target: anchor('members-list'),
        reveal: reveal('members-members-tab'),
        title: 'Encontre e acompanhe os membros',
        description: 'Consulte as pessoas cadastradas e use filtros de status ou plano. Abra um membro para revisar seus dados e suas opções de acesso.',
      },
      {
        id: 'plans',
        target: anchor('members-plans-list'),
        reveal: reveal('members-plans-tab'),
        title: 'Planos organizam os níveis de acesso',
        description: 'Configure os planos usados pelas regras da área restrita. Confira os membros e os conteúdos relacionados antes de alterar um plano existente.',
      },
      {
        id: 'commerce',
        target: anchor('members-commerce-body'),
        reveal: reveal('members-commerce-tab'),
        title: 'Conecte acesso e checkout',
        description: 'Quando disponível, esta seção reúne os checkouts e integrações comerciais da área de membros. Revise o vínculo com os planos antes de ativar uma configuração.',
      },
      {
        id: 'settings',
        target: anchor('members-settings-body'),
        reveal: reveal('members-settings-tab'),
        title: 'Configure a experiência de acesso',
        description: 'Revise as opções gerais da área de membros e os fluxos disponíveis para o projeto. Confira as descrições antes de mudar o comportamento do site.',
      },
      workspaceAgent,
    ],
  },
  {
    id: 'templates',
    title: 'Biblioteca de Templates',
    description: 'Encontre um ponto de partida e reutilize projetos.',
    steps: [
      {
        id: 'workspace',
        target: anchor('templates-workspace'),
        title: 'Um ponto de partida para o site',
        description: 'Templates reúnem páginas, estilos, componentes e arquivos de um projeto editável. Explore as opções antes de escolher o que combina com seu trabalho.',
      },
      {
        id: 'filters',
        target: anchor('templates-filters'),
        title: 'Busque pelo que precisa',
        description: 'Use a busca e as categorias para reduzir a lista de templates. Compare as opções disponíveis antes de abrir um projeto.',
      },
      {
        id: 'catalog',
        target: anchor('templates-catalog'),
        title: 'Confira o conteúdo do template',
        description: 'Cada cartão informa a proposta, a origem e o número de páginas. Use a ação do cartão somente quando estiver pronto para abrir o template no Builder.',
      },
      {
        id: 'import',
        target: anchor('templates-import'),
        title: 'Reutilize seus próprios templates',
        description: 'Importe um ZIP de template para disponibilizá-lo na biblioteca. Confira o arquivo escolhido antes de enviá-lo.',
      },
      workspaceAgent,
    ],
  },
];

const detailsByArea: Partial<Record<OnboardingTourId, Record<string, readonly OnboardingStep[]>>> = {
  design: BUILDER_ONBOARDING_DETAILS,
  settings: SETTINGS_ONBOARDING_DETAILS,
  cms: CMS_ONBOARDING_DETAILS,
  analytics: ANALYTICS_ONBOARDING_DETAILS,
  localization: LOCALIZATION_ONBOARDING_DETAILS,
};

export const ONBOARDING_TOURS: readonly OnboardingTour[] = BASE_ONBOARDING_TOURS.filter(tour => tour.id !== 'members' && tour.id !== 'templates').map(tour => ({
  ...tour,
  steps: tour.steps.map(step => {
    const extra = detailsByArea[tour.id]?.[step.id];
    return extra ? { ...step, details: [...(step.details || []), ...extra] } : step;
  }),
}));
