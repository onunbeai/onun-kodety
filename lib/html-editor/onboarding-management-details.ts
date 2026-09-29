import type { OnboardingStep } from './onboarding-tours';

const detail = (
  id: string,
  title: string,
  description: string,
  tip?: string,
): OnboardingStep => ({
  id,
  target: `[data-kodety-onboarding="${id}"]`,
  title,
  description,
  ...(tip ? { tip } : {}),
});

/**
 * These guides inspect the report, draft or dialog the user already opened.
 * No reveal changes the selected report, funnel, experiment, locale or member.
 * Conditional controls remain conditional, including licensed features.
 */
export const ANALYTICS_ONBOARDING_DETAILS: Record<string, readonly OnboardingStep[]> = {
  overview: [
    detail('analytics-overview-period', 'Período: a referência da comparação',
      'Escolha o intervalo usado pelo relatório. Confira também o fuso informado no cabeçalho para interpretar dias e horários da mesma forma ao comparar resultados.'),
    detail('analytics-overview-metrics', 'Indicadores: pessoas, sessões e visualizações',
      'Visitantes únicos, sessões e visualizações medem coisas diferentes: pessoas identificadas, visitas e páginas vistas. O painel também mostra visitantes ao vivo, rejeição e duração média da sessão.'),
    detail('analytics-overview-trend', 'Tráfego: a evolução ao longo do período',
      'O gráfico coloca visitantes únicos e visualizações na mesma linha do tempo. Observe picos e quedas antes de consultar as origens do tráfego.'),
    detail('analytics-overview-breakdowns', 'Detalhamento: de onde vem cada resultado',
      'Fontes, páginas, localização e dispositivos dividem os totais do período. Tracking IDs mostra os identificadores que receberam eventos rastreados.'),
  ],
  'page-insights': [
    detail('analytics-page-filters', 'Página, dispositivo e período',
      'A página escolhe o endereço analisado. O filtro de dispositivo restringe os dados e o período define quando eles foram coletados. Confira esses três controles antes de comparar páginas.'),
    detail('analytics-page-preview', 'A página publicada como referência',
      'A visualização usa a página publicada para localizar as áreas analisadas. Os indicadores de dobra e scroll ajudam a relacionar as métricas ao conteúdo que os visitantes encontraram.'),
    detail('analytics-page-scroll', 'Profundidade de scroll',
      'Veja quantas sessões alcançaram cada trecho da página. Uma queda entre trechos indica que menos sessões chegaram àquela parte; confira também dispositivo e período.'),
    detail('analytics-page-events', 'Eventos rastreados na página',
      'Esta lista reúne cliques e envios identificados pelo rastreamento. Os totais seguem os filtros da página; eventos ausentes podem não ter recebido ocorrências nesse intervalo.'),
  ],
  funnels: [
    detail('analytics-funnel-identity', 'Nome, ativação e janela de conversão',
      'O nome identifica o fluxo salvo. Ativo controla a coleta de conversões. A janela limita os minutos entre a entrada e a conclusão; zero deixa o funil sem esse limite geral.'),
    detail('analytics-funnel-step', 'Nó selecionado: o que conta como etapa',
      'Escolha o tipo da etapa e seu alvo: página, clique, formulário, teste A/B, email, webhook ou evento. Os campos abaixo mudam com o tipo e configuram somente o nó selecionado.'),
    detail('analytics-funnel-email', 'Email: contato, lista e consentimento',
      'A ação escolhe entre atualizar o contato ou adicioná-lo a uma lista. Os nomes dos campos identificam email e nome no formulário. Quando há campo de consentimento, ele precisa estar marcado para inscrever o contato.'),
    detail('analytics-funnel-webhook', 'Webhook: a ação enviada ao destino',
      'URL, método e formato definem como o serviço externo recebe a chamada. O nome do evento identifica a ação e o segredo configurado permite verificar sua assinatura no destino.',
      'Esses campos configuram uma ação do funil. O guia apenas explica os controles e não envia nenhuma chamada.'),
    detail('analytics-funnel-connection', 'Conexão: espera, prazo e condições',
      'A conexão liga dois nós. A espera mínima adia a passagem; o prazo máximo limita a conclusão. Prazo zero herda a janela geral. Os filtros restringem quais visitantes podem seguir por essa rota.'),
    detail('analytics-funnel-entry-filters', 'Filtros de entrada: quem pode começar',
      'Cada filtro combina campo, operador e valor para definir a entrada no funil. Sem filtros de entrada, todos os visitantes podem iniciar o fluxo; as condições das conexões continuam sendo avaliadas separadamente.'),
    detail('analytics-funnel-results', 'Resultados: conversão e abandono',
      'Entraram corresponde à primeira etapa e Converteram à última. A conversão geral relaciona esses dois totais; maior abandono destaca a passagem com mais perda no período consultado.'),
  ],
  'ab-tests': [
    detail('analytics-ab-goal', 'Objetivo: qual ação representa conversão',
      'Selecione o ID ou a classe do elemento acionado na conversão. O alvo atual aparece acima dos controles para você confirmar o que será medido em todas as variantes.'),
    detail('analytics-ab-delivery', 'Participação, distribuição, entrega e persistência',
      'Participação escolhe a parcela dos visitantes que entra no teste. Distribuição reparte essa parcela entre variantes. Entrega escolhe redirecionar ou manter a URL original; persistência define por quantos dias o visitante permanece na variante.'),
    {
      ...detail('analytics-ab-audience', 'Audiência: quem é elegível para o teste',
        'Dispositivo, visitante, domínio de referência e parâmetro de campanha restringem quem participa. O valor esperado completa a regra do parâmetro escolhido.'),
      reveal: '[data-kodety-onboarding="analytics-ab-audience-disclosure"][data-kodety-onboarding-reveal]',
    },
    {
      ...detail('analytics-ab-stop', 'Encerramento automático',
        'Defina uma data e hora, um limite de exposições ou ambos. O teste termina quando atingir a primeira regra configurada. Sem essas regras, o encerramento permanece manual.'),
      reveal: '[data-kodety-onboarding="analytics-ab-audience-disclosure"][data-kodety-onboarding-reveal]',
    },
    detail('analytics-ab-variants', 'Variantes: versões e parcelas de tráfego',
      'Confira nome, endereço público, participação e estado de cada variante. A Control representa a referência e permanece ativa. Alterações que exigem publicação são identificadas na própria lista.'),
  ],
  utms: [
    detail('analytics-utm-destination', 'Destino do link ou checkout',
      'A URL base é o endereço que receberá os parâmetros. Em checkouts, a plataforma escolhe o preset disponível. Parâmetros existentes e o fragmento do link são preservados.'),
    detail('analytics-utm-parameters', 'UTMs: origem, canal e campanha',
      'Source identifica a origem, Medium descreve o canal e Campaign nomeia a campanha. Content diferencia criativos ou posições; Term identifica o termo associado ao link.'),
    detail('analytics-utm-attribution', 'Repasse e memória de atribuição',
      'Repassar UTMs leva ao checkout os parâmetros recebidos que a plataforma suporta. Lembrar nesta sessão mantém a atribuição entre páginas da mesma sessão, quando disponível.'),
    detail('analytics-utm-mapping', 'Mapeamento para os parâmetros do checkout',
      'Cada linha liga um dado de origem a um parâmetro aceito pela plataforma. Confira o nome esperado pelo destino e a origem do valor antes de aplicar o modelo a um formulário ou link.'),
    detail('analytics-utm-decode', 'Decodificador: leia um link existente',
      'Cole um endereço HTTP ou HTTPS para separar destino, UTMs e outros parâmetros. A leitura ajuda a entender um link de campanha antes de reutilizar seus valores.'),
  ],
};

const localeConfiguration: readonly OnboardingStep[] = [
  detail('localization-locale-code', 'Código: a identidade do idioma',
    'O código identifica idioma e, quando necessário, região, como pt-BR ou en-US. Ele distingue versões regionais mesmo quando usam a mesma língua.'),
  detail('localization-locale-prefix', 'Prefixo: o endereço dessa versão',
    'O prefixo diferencia o caminho publicado do idioma. O idioma padrão usa a URL sem prefixo; o campo indica quando esse valor é fixo para a configuração atual.'),
  detail('localization-locale-fallback', 'Fallback: de onde vem o conteúdo ausente',
    'Escolha o idioma que fornece o conteúdo quando uma tradução não está preenchida. Revise esse vínculo para que campos pendentes tenham uma referência coerente.'),
  detail('localization-locale-direction', 'Direção: como o texto é apresentado',
    'Escolha esquerda para direita ou direita para esquerda conforme a escrita do idioma. Essa opção orienta a direção da versão localizada.'),
  detail('localization-locale-publication', 'Disponibilidade na publicação',
    'Este controle define se a versão entra na próxima publicação. Confira suas traduções, caminhos e fallback antes de disponibilizá-la aos visitantes.'),
];

const translationFields: readonly OnboardingStep[] = [
  detail('localization-global-translation', 'Conteúdo global do site',
    'A coluna Original mostra o texto fonte e a coluna do idioma recebe a tradução. Esses campos correspondem a informações globais, como nome e descrição do site.'),
  detail('localization-page-seo', 'Título e descrição da página',
    'Os campos de SEO traduzem o título e a descrição da página atual. Eles são distintos dos textos visíveis dentro da página e precisam ser revisados para cada idioma.'),
  detail('localization-page-url', 'Caminho traduzido da página',
    'Este campo define o caminho da página no idioma ativo quando URLs localizadas estão habilitadas. Confira a tradução do caminho junto do prefixo do idioma.'),
  detail('localization-page-text', 'Tradução do conteúdo visível',
    'Edite a tradução ao lado do texto original. Campos pendentes são identificados na linha; o retorno de salvamento no topo informa se as alterações foram gravadas.'),
];

export const LOCALIZATION_ONBOARDING_DETAILS: Record<string, readonly OnboardingStep[]> = {
  add: localeConfiguration,
  settings: [
    detail('localization-source-default', 'Idioma fonte e idioma padrão',
      'Fonte identifica o conteúdo original. Padrão escolhe qual idioma usa a URL sem prefixo. Eles têm funções diferentes e podem não corresponder à mesma versão.'),
    detail('localization-routing-behavior', 'Escolha automática e URLs localizadas',
      'Idioma automático considera o país do visitante; Lembrar escolha mantém sua preferência. URLs localizadas permite traduzir caminhos, e Incluir URLs nos rascunhos habilita sugestões de caminhos pela IA.'),
    ...localeConfiguration,
  ],
  content: translationFields,
  translations: translationFields,
};

export const MEMBERS_ONBOARDING_DETAILS: Record<string, readonly OnboardingStep[]> = {
  members: [
    detail('members-list-filters', 'Busca, status e plano',
      'Busque por nome ou email e combine os filtros de status e plano. Ativos, convidados e suspensos representam situações diferentes da conta; o filtro de plano restringe os vínculos exibidos.'),
    detail('members-member-plans', 'Planos atribuídos ao membro',
      'Os planos selecionados determinam os vínculos de acesso reconhecidos pelo WordPress. A atribuição depende da permissão da conta que está editando o membro.'),
    detail('members-access-override', 'Acesso manual a um plano',
      'Escolha o plano e, se necessário, registre um motivo. Adicionar ou remover acesso altera a autorização no site. Restaurar sincronização devolve o controle ao vínculo com o provedor.',
      'Alterar o acesso aqui não cancela a assinatura nem estorna uma venda.'),
    detail('members-access-links', 'Links e recuperação de acesso',
      'As ações geram um link temporário de acesso, um link de redefinição de senha ou enviam email de recuperação. Elas só executam quando você as aciona; confira o membro identificado acima.'),
  ],
  plans: [
    detail('members-plans-list', 'Planos: níveis de acesso reutilizáveis',
      'Cada plano possui uma chave usada pelas regras do Builder. Abra um plano para revisar sua identidade, estado e destino de upgrade; o guia preserva a lista como está.'),
    detail('members-plan-card', 'O resumo de um plano',
      'O cartão reúne nome, estado, chave estável e descrição. Identifique o plano antes de usar suas ações de edição ou arquivamento.'),
    detail('members-plan-identity', 'Nome e chave estável',
      'O nome identifica o plano para as pessoas. A chave conecta as regras de acesso e permanece fixa depois da criação para preservar os vínculos existentes.'),
    detail('members-plan-status', 'Estado do plano',
      'Ativo, rascunho e arquivado indicam a situação do plano. Confira o uso dele pelos membros e pelas regras de acesso antes de mudar seu estado.'),
    detail('members-plan-upgrade', 'Destino de upgrade',
      'A URL de upgrade aponta para a página ou oferta usada quando alguém precisa obter esse plano. Confira se o destino corresponde ao nível de acesso configurado.'),
    detail('members-plan-provider', 'Referência do provedor',
      'Provedor e ID externo registram a referência associada ao plano. O vínculo efetivo com produto, preço e checkout é configurado na área comercial.'),
  ],
  commerce: [
    detail('members-commerce-providers', 'Provedores de checkout',
      'As conexões identificam os serviços que processam as compras. Confira nome, ambiente e estado de cada conexão antes de associar planos a seus produtos.'),
    detail('members-commerce-mappings', 'Planos e produtos',
      'O mapeamento liga um plano Kodety a um produto ou preço do provedor. Esse vínculo determina qual acesso será liberado; o link permanente cria uma sessão de checkout a cada uso.'),
    detail('members-commerce-connection', 'Configuração da conexão',
      'Nome e ambiente identificam a conexão. Os campos solicitados variam por provedor; credenciais são enviadas ao WordPress e campos secretos ficam vazios ao reabrir o formulário.'),
    detail('members-commerce-plan-link', 'Conexão e plano do mapeamento',
      'Escolha qual provedor processa a compra e qual plano recebe o acesso. Depois de criado, esse vínculo mantém conexão e plano fixos para preservar sua identidade.'),
    detail('members-commerce-sales', 'Vendas por provedor e estado',
      'Use os filtros para consultar as vendas registradas e relacionar compra, membro e situação do pagamento. Atualizar busca o estado mais recente disponível.'),
    detail('members-commerce-subscriptions', 'Assinaturas recorrentes',
      'Os filtros de provedor e estado organizam as assinaturas. Confira o registro da assinatura antes de relacionar sua situação comercial ao acesso do membro.'),
  ],
  settings: [
    detail('members-registration', 'Cadastro público e função padrão',
      'Cadastro público permite criar contas pelos formulários da área de membros. A função padrão escolhe entre assinante e cliente para novas contas. A verificação de email permanece identificada como indisponível enquanto estiver em preparação.'),
    detail('members-account-routes', 'Páginas e destinos de acesso',
      'Configure login, conta, upgrade e redefinição de senha. Depois do login e Depois do logout escolhem para onde o visitante segue ao concluir essas ações.'),
    detail('members-retention', 'Retenção de auditoria e eventos',
      'Os valores em dias controlam por quanto tempo registros de auditoria e eventos são mantidos. Ambos aceitam entre 30 e 3.650 dias; revise e use Salvar configurações para gravar as mudanças.'),
  ],
};
