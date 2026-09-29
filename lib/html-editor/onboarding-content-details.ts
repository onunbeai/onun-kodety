import type { OnboardingStep } from './onboarding-tours';

const anchor = (id: string) => `[data-kodety-onboarding="${id}"]`;
const reveal = (id: string) => `${anchor(id)}[data-kodety-onboarding-reveal]`;

const detail = (
  id: string,
  title: string,
  description: string,
  controls?: string,
  tip?: string,
): OnboardingStep => ({ id, target: anchor(id), title, description, reveal: controls, tip });

const setting = (_section: string, id: string, title: string, description: string, tip?: string) => {
  const parent = id.startsWith('settings-ai-') ? 'settings-integration-ai'
    : id.startsWith('settings-shopify-') ? 'settings-integration-shopify' : null;
  return detail(id, title, description, [
    ...(parent ? [reveal(`${parent}-disclosure`)] : []),
    reveal(`${id}-disclosure`),
  ].join(', '), tip);
};

const page = (id: string, title: string, description: string, tip?: string) => detail(
  id, title, description,
  `[data-kodety-onboarding-page-reveal][data-kodety-onboarding-reveal], ${reveal(`${id}-disclosure`)}`,
  tip,
);

const cookie = (section: string, title: string, description: string) => detail(
  `settings-cookies-${section}`, title, description,
  reveal(`settings-cookies-${section}-tab`),
);

const cmsView = (_view: 'collections' | 'fields', id: string, title: string, description: string, tip?: string) => detail(id, title, description, undefined, tip);

const cmsField = (id: string, title: string, description: string, tip?: string) => detail(
  id, title, description,
  reveal('cms-field-select'),
  tip,
);

const itemDetails: readonly OnboardingStep[] = [
  detail('cms-item-status', 'Status: como o item fica disponível', 'Rascunho guarda conteúdo em preparação; Pendente indica conteúdo para revisão. Publicado e Privado aparecem conforme suas permissões. O status escolhido no painel só é aplicado ao salvar o item.'),
  detail('cms-item-field-title', 'Título do item', 'Dê ao conteúdo um nome claro. Ele identifica o item na listagem e pode preencher títulos de cards e páginas quando o Design está conectado a este campo.'),
  detail('cms-item-field-content', 'Conteúdo e formatação', 'Escreva o conteúdo principal com a formatação disponível neste campo. As conexões do Design usam esse valor; a estrutura visual dos cards e páginas continua no Builder.'),
  detail('cms-item-field-slug', 'Endereço do conteúdo', 'Confira o caminho do item e a prévia de URL. Mudar o slug altera o endereço usado por links para este conteúdo; revise as conexões e os redirecionamentos relacionados.'),
  detail('cms-item-image', 'Imagem destacada', 'Esta imagem representa o item em temas e prévias do WordPress. Você pode escolher ou trocar a mídia e conferir a miniatura antes de salvar.'),
];

/** Details only reveal existing views or existing field selections; they never create sample content. */
export const CMS_ONBOARDING_DETAILS: Record<string, readonly OnboardingStep[]> = {
  collections: [
    cmsView('collections', 'cms-collection-search', 'Encontre uma coleção', 'A busca da lateral filtra os tipos de conteúdo pelo nome. Use-a para localizar a coleção antes de procurar um item dentro dela.'),
    cmsView('collections', 'cms-collections', 'Escolha o tipo de conteúdo', 'Cada coleção reúne itens com a mesma estrutura. A seleção da lateral define quais itens, campos e contadores aparecem na área central.', 'Coleções são equivalentes às Collections do Webflow. Tipos nativos e coleções personalizadas podem aparecer juntos.'),
    cmsView('collections', 'cms-fields', 'A estrutura por trás do conteúdo', 'Gerenciar campos abre a estrutura da coleção atual. Os campos personalizados ficam disponíveis nas colunas da tabela, no editor dos itens e nas conexões do Design.'),
  ],
  fields: [
    cmsView('fields', 'cms-fields-collection', 'Confira a coleção antes de editar campos', 'O seletor indica qual tipo de conteúdo receberá a estrutura. Uma alteração de campo vale para os itens dessa coleção.'),
    cmsView('fields', 'cms-fields-list', 'Campos nativos e personalizados', 'A lista separa os campos fornecidos pelo WordPress dos campos personalizados. Selecione um campo personalizado existente para conferir sua definição.'),
    cmsField('cms-field-label', 'Nome visível: a linguagem de quem preenche', 'Este é o rótulo mostrado no editor. Prefira nomes claros, como Capa do projeto ou Resumo, para orientar o preenchimento.'),
    cmsField('cms-field-id', 'Identificador: a conexão com o Design', 'O identificador é a chave usada para ligar esse dado a elementos visuais. Use um nome estável e reconhecível; revise vínculos existentes antes de renomeá-lo.'),
    cmsField('cms-field-description', 'Ajuda junto ao campo', 'A descrição aparece ao preencher itens. Explique o formato esperado, a finalidade e qualquer orientação editorial que evite dúvidas.'),
    cmsField('cms-field-type', 'Tipo: o formato do dado', 'Texto, imagem, número, data e outros tipos oferecem controles próprios. Escolha o formato do conteúdo que será armazenado e conectado ao Design.', 'Trocar o tipo de um campo existente exige conferir os valores que já foram preenchidos.'),
    cmsField('cms-field-required', 'Obrigatório: o que não pode faltar', 'Quando esta opção está ativa, o item precisa ter um valor nesse campo para ser salvo. Use para dados indispensáveis à publicação.'),
    cmsField('cms-field-default', 'Valor padrão: ponto de partida de novos itens', 'O valor padrão preenche o campo na criação de um item e continua editável. Ele serve como valor inicial para o trabalho editorial.'),
    detail('cms-field-number-limits', 'Números: limites, precisão e unidade', 'Mínimo e Máximo restringem a faixa aceita. Passo define a variação do controle, e Unidade indica como o valor deve ser apresentado ao preencher.'),
  ],
  toolbar: [
    cmsView('collections', 'cms-item-search', 'Busque dentro da coleção atual', 'Abra a busca para localizar um item pelo conteúdo. A coleção selecionada na lateral define o conjunto pesquisado.'),
    cmsView('collections', 'cms-status-filter', 'Separe os itens pelo status', 'O filtro permite revisar publicados, rascunhos e pendentes. Ele muda a listagem exibida, sem alterar o status dos itens.'),
    cmsView('collections', 'cms-sort', 'Inverta a ordem de leitura', 'Este controle alterna entre ordem crescente e decrescente para o campo de ordenação atual. A ordenação da tabela ajuda a revisar dados e não reorganiza o layout do site.'),
    cmsView('collections', 'cms-visible-columns', 'Escolha quais campos comparar', 'Colunas visíveis define quais campos aparecem na tabela. Use uma combinação de campos que facilite a revisão; a rolagem horizontal mostra as colunas que não cabem na tela.'),
  ],
  items: [
    cmsView('collections', 'cms-item-columns', 'As colunas correspondem aos campos', 'Os cabeçalhos identificam o dado de cada coluna e reúnem opções de ordenação. Confira o campo antes de editar uma célula.'),
    cmsView('collections', 'cms-item-row', 'Uma linha, um conteúdo', 'Cada linha representa um item. Abra o item para trabalhar no painel; os controles de edição direta das células enviam suas alterações ao CMS.', 'Ao revisar conteúdo com o guia aberto, os controles reais continuam disponíveis.'),
  ],
  'item-editor': itemDetails,
  'new-item': itemDetails,
  import: [
    detail('cms-import-file', 'Arquivo: comece pelos cabeçalhos', 'Escolha um CSV com a primeira linha contendo os nomes das colunas. O importador detecta vírgulas, ponto e vírgula e tabulações como separadores.'),
    detail('cms-import-destination', 'Destino: onde os itens serão criados', 'Confira se os dados vão para uma coleção existente ou para uma nova coleção. Nome, singular e slug identificam uma nova coleção quando essa opção está selecionada.'),
    detail('cms-import-mapping', 'Mapeamento: ligue cada coluna ao campo correto', 'Relacione os cabeçalhos do CSV aos campos de destino. Confira os campos novos e seus tipos antes de confirmar, especialmente imagens, números e datas.'),
    detail('cms-import-preview', 'Prévia: valide uma amostra do arquivo', 'A tabela mostra as primeiras linhas antes da conversão dos tipos. Confira separadores, acentos e a distribuição dos valores entre colunas.'),
    detail('cms-import-status', 'Status inicial dos itens importados', 'Escolha se os itens entram como rascunho ou publicados. Revise destino, mapeamento e status antes de executar a importação.'),
  ],
};

export const SETTINGS_ONBOARDING_DETAILS: Record<string, readonly OnboardingStep[]> = {
  general: [
    setting('general', 'settings-identity', 'Identidade: os padrões do site', 'Nome, idioma e descrição representam o projeto. A descrição geral funciona como fallback para páginas que não tiverem descrição própria.'),
    setting('general', 'settings-public-url', 'URL pública: a referência do site publicado', 'Informe o endereço público usado como base das URLs canônicas. Confira protocolo e domínio para que os metadados apontem ao endereço correto.'),
    setting('general', 'settings-favicons', 'Favicons para temas claro e escuro', 'Essas imagens identificam o site nas abas do navegador. A versão clara também é usada como fallback quando não há imagem específica para o tema escuro.'),
    setting('general', 'settings-social-defaults', 'Imagem social padrão e templates', 'A imagem padrão atende páginas sem imagem própria. Um template da biblioteca pode gerar imagens reutilizáveis; editar esse template alcança as páginas que estiverem vinculadas a ele.'),
  ],
  seo: [
    setting('seo', 'settings-seo-metadata', 'Modelo de título: consistência entre páginas', 'O modelo combina as informações da página com a identidade do site. Confira as variáveis indicadas no campo para manter os títulos claros e consistentes.'),
    setting('seo', 'settings-seo-preview', 'Prévia de busca: revise a apresentação', 'A prévia reúne título, endereço e descrição calculados com os padrões atuais. Use-a para identificar informações ausentes ou pouco claras.'),
    setting('seo', 'settings-seo-indexing', 'Robots, sitemap e rastreamento', 'Os controles definem padrões para novas páginas, links, imagens e snippets. O sitemap reúne endereços para descoberta; as opções de robots orientam o rastreamento e a apresentação do conteúdo.'),
    setting('seo', 'settings-seo-robots-rules', 'robots.txt: regras adicionais por caminho', 'As diretivas complementam as regras geradas pelo projeto. Revise os caminhos e os robôs afetados antes de salvar, para não bloquear áreas que devem ser descobertas.'),
    setting('seo', 'settings-seo-schema', 'Entidades: quem publica o site', 'Tipo, nome, URL, logo e perfis oficiais descrevem a organização. As opções WebSite e busca interna relacionam essa identidade à estrutura do site.'),
    setting('seo', 'settings-seo-json-ld', 'JSON-LD: entidades estruturadas adicionais', 'Use este campo para entidades adicionais do site. Elas entram no mesmo grafo de dados estruturados; confira as mensagens de validação antes de salvar.'),
    setting('seo', 'settings-seo-verification', 'Verifique o site nos serviços de busca', 'Insira os códigos de verificação fornecidos por Google Search Console, Bing ou Pinterest. As tags correspondentes são aplicadas às páginas do projeto.'),
  ],
  code: [
    setting('code', 'settings-code-list', 'Organize os códigos existentes', 'Cada entrada tem um nome, escopo e conteúdo próprios. A ordem da lista também define a ordem de inserção dos trechos no documento.'),
    setting('code', 'settings-code-placement', 'Inserir em: o ponto do documento', 'Escolha início ou fim do head ou do body conforme a integração pede. A posição controla onde o trecho entra no HTML publicado.'),
    setting('code', 'settings-code-pages', 'Páginas: o alcance do trecho', 'Uma entrada pode valer para todas as páginas ou apenas para as selecionadas. Confira esse alcance para evitar carregar a mesma integração em lugares desnecessários.'),
    setting('code', 'settings-code-run', 'Executar: uma vez ou em cada navegação', 'Uma vez atende inicializações, listeners e scripts externos. Em cada navegação atende código que precisa rodar novamente quando o visitante troca de página.'),
    setting('code', 'settings-code-language', 'Linguagem: o formato do editor', 'HTML, CSS e JavaScript determinam a linguagem do trecho. Confira o conteúdo ao trocar a linguagem, especialmente quando ainda estiver usando o código inicial.'),
    setting('code', 'settings-code-consent', 'Consentimento: quando o código pode executar', 'Escolha se a entrada exige autorização e associe a categoria correspondente. Para o visitante liberar um código protegido, Cookie Consent precisa estar configurado e ativo.'),
    setting('code', 'settings-code-editor', 'O código da entrada selecionada', 'Revise o trecho completo, incluindo as tags necessárias. As entradas são materializadas no documento publicado conforme posição, páginas e regras de execução.'),
  ],
  redirects: [
    setting('redirects', 'settings-redirect-source', 'Origem: o endereço que precisa continuar funcionando', 'Use o caminho antigo começando por /. A origem identifica qual solicitação deve ser encaminhada para outro endereço.'),
    setting('redirects', 'settings-redirect-destination', 'Destino: para onde o visitante vai', 'O destino aceita um caminho interno ou uma URL externa segura. Confira se a página de destino existe e se a regra não volta à própria origem.'),
    setting('redirects', 'settings-redirect-status', 'Status HTTP: permanente ou temporário', '301 e 308 indicam mudança permanente; 302 e 307 indicam mudança temporária. As opções 307 e 308 preservam o método da solicitação.'),
    setting('redirects', 'settings-redirect-match', 'Correspondência: o alcance da regra', 'Caminho exato afeta uma URL. Caminho e subcaminhos amplia o alcance; Curinga usa o padrão indicado na origem. Confira prioridade, conflitos e ciclos antes de salvar.'),
  ],
  'cookie-consent': [
    cookie('general', 'Cookie Consent: ativação e comportamento', 'Configure como o aviso aparece e quando serviços não essenciais podem executar. As opções desta seção controlam o comportamento geral do recurso publicado.'),
    cookie('appearance', 'Aparência: integre o aviso ao site', 'Ajuste cores, posicionamento e apresentação do banner. A prévia acompanha as mudanças para conferir o resultado visual antes de salvar.'),
    cookie('content', 'Textos: explique as escolhas ao visitante', 'Edite o conteúdo do aviso e os rótulos das ações. Use textos que correspondam às categorias e aos serviços que o site realmente utiliza.'),
    cookie('categories', 'Categorias: agrupe por finalidade', 'Cada categoria representa uma finalidade de uso. Necessários permanece obrigatório; as categorias opcionais organizam as escolhas feitas pelo visitante.'),
    cookie('services', 'Serviços: documente os fornecedores', 'O serviço relaciona fornecedor, finalidade, retenção e integrações a uma categoria. Confira a categoria e as informações apresentadas ao visitante.'),
    cookie('cookies', 'Inventário: explique cada cookie', 'Registre nome, fornecedor, finalidade e duração dos cookies utilizados. Esse inventário fica disponível nas preferências publicadas.'),
    cookie('integrations', 'Integrações: conecte execução e consentimento', 'Relacione as integrações às categorias adequadas e configure as opções de Consent Mode disponíveis. Scripts sem mapeamento precisam de revisão explícita.'),
    cookie('advanced', 'Opções avançadas de privacidade', 'Revise regras regionais e demais controles de comportamento. Os presets são pontos de partida operacionais e precisam refletir as práticas do site.'),
  ],
  integrations: [
    setting('mcp', 'settings-integration-analytics', 'Analytics: identifique os serviços de medição', 'Preencha os identificadores das integrações utilizadas. Confira carregamento, consentimento e Do Not Track para definir quando a medição externa acontece.'),
    setting('mcp', 'settings-integration-mcp', 'MCP: acesso de agentes ao projeto', 'Esta área reúne dados de conexão e acessos associados ao projeto. Revise quais conexões existem e o contexto do projeto antes de autorizar novos clientes.'),
    setting('mcp', 'settings-integration-ai', 'IA de conteúdo: escolha o provedor', 'O provedor define o serviço usado nas solicitações de conteúdo. Modelo, idioma, tom e criatividade orientam a geração disponibilizada no projeto.'),
    setting('mcp', 'settings-ai-model', 'Modelo: capacidade dentro do provedor', 'Escolha um modelo disponível para o provedor selecionado. O modelo é usado pelas solicitações de conteúdo desta configuração.'),
    setting('mcp', 'settings-ai-api-key', 'Credencial: conecte sua conta do provedor', 'O campo recebe a chave que autentica as solicitações ao serviço de IA. Confira o provedor ativo e o estado da credencial antes de salvar a integração.'),
    setting('mcp', 'settings-integration-fonts', 'Adobe Fonts: disponibilize o projeto de fontes', 'Configure a integração com o projeto de fontes da Adobe usado pelo site. Confira o identificador do projeto antes de escolher essas fontes no Design.'),
    setting('mcp', 'settings-integration-shopify', 'Shopify: catálogo e checkout conectados', 'A integração reúne a loja, os dados de Storefront, os mercados, as rotas e os templates usados pelo WordPress.'),
    setting('mcp', 'settings-shopify-domain', 'Loja: o domínio permanente do Shopify', 'Use o domínio myshopify.com correspondente à loja. Ele identifica a origem do catálogo consultado pela integração.'),
    setting('mcp', 'settings-shopify-token', 'Storefront: acesso ao catálogo', 'Confira o tipo de token e sua credencial Storefront. Essa configuração permite consultar os dados da loja disponibilizados à integração.'),
    setting('mcp', 'settings-shopify-market', 'Mercado: país e idioma do catálogo', 'As opções de país e idioma definem o contexto de mercado das consultas. Confira as opções da loja para apresentar o catálogo apropriado ao público do site.'),
    setting('mcp', 'settings-shopify-routes', 'Rotas: endereços da loja no WordPress', 'Defina os caminhos usados por produtos e coleções dentro do site. Confira os endereços existentes antes de alterar esse mapeamento.'),
    setting('mcp', 'settings-shopify-templates', 'Templates: o visual de produtos e coleções', 'Associe os templates dinâmicos que apresentam os dados do Shopify. O catálogo fornece o conteúdo; os templates controlam sua apresentação no Builder.'),
    detail('settings-shopify-checkout-hosts', 'Checkout: destinos permitidos', 'Confira os hosts que podem receber o visitante no fluxo de checkout. Mantenha essa lista alinhada ao provedor e à integração configurados.'),
    detail('settings-shopify-return', 'Retorno: a experiência depois do checkout', 'Configure os destinos de retorno e cancelamento no WordPress. Eles definem para onde o visitante volta conforme o resultado do fluxo.'),
  ],
  storage: [
    setting('storage', 'settings-storage-snapshots', 'Snapshots: versões geradas ao publicar', 'A lista identifica os snapshots disponíveis por versão e data, incluindo a publicação atual. As ações de visualização e download ajudam a conferir uma versão antes de qualquer manutenção.'),
  ],
  pages: [
    page('settings-page-metadata', 'Página: título, URL e descrição', 'Estes valores pertencem à página indicada no cabeçalho. Alterar a URL também renomeia o arquivo publicado; confira o endereço antes de salvar.'),
    page('settings-page-indexing', 'Descoberta: regras próprias desta página', 'Escolha indexação, acompanhamento de links e inclusão no sitemap para a página atual. As opções avançadas ajustam imagens, snippets e prévias.'),
    page('settings-page-schema', 'Schema: descreva o conteúdo da página', 'Escolha o tipo principal e revise os dados estruturados correspondentes. As informações devem representar o conteúdo real da página.'),
    page('settings-page-sharing', 'Compartilhamento: título e descrição sociais', 'Personalize como esta página se apresenta ao ser compartilhada. Confira os valores próprios e os fallbacks que serão usados quando um campo ficar vazio.'),
    page('settings-page-social-image', 'Social Image: template desta página', 'Associe uma imagem ou template apropriado ao conteúdo. Um template reutilizado mantém várias páginas vinculadas ao mesmo layout de imagem.'),
  ],
};
