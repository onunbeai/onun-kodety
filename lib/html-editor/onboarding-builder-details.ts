import type { OnboardingStep } from './onboarding-tours';

const at = (id: string) => `[data-kodety-onboarding="${id}"]`;
const detail = (id: string, target: string, title: string, description: string, tip?: string): OnboardingStep => ({ id, target, title, description, tip });
const elementSection = (name: string) => `${at('design-element-settings-panel')} [data-design-token-section="${name}"]`;
const expandable = (id: string, title: string, description: string, tip?: string): OnboardingStep => ({ ...detail(id, at(id), title, description, tip), reveal: `${at(`${id}-disclosure`)}[data-kodety-onboarding-reveal]` });

/** Details use existing controls; conditional editors appear only when opened by the user. */
export const BUILDER_ONBOARDING_DETAILS: Record<string, readonly OnboardingStep[]> = {
  style: [
    detail('style-transition', `${at('design-style-panel')} [data-design-token-section="transition"]`, 'Transition: suavize mudanças de estilo', 'Escolha a propriedade e a duração da transição. Quando essa propriedade muda, como em hover, o navegador interpola os valores ao longo do tempo definido.'),
    expandable('style-scroll-section', 'Scroll Section: um destino dentro da página', 'Defina um nome para tornar esta seleção um destino de navegação. O deslocamento vertical ajusta a chegada da rolagem, útil quando há um cabeçalho fixo.'),
    expandable('style-text-selection', 'Text Selection: aparência do texto selecionado', 'Configure as cores usadas quando um visitante seleciona texto. No Body, essas definições podem servir para o texto da página inteira.'),
    expandable('style-scrollbar', 'Scrollbar: personalize a área de rolagem', 'Esses controles configuram a aparência da barra de rolagem no escopo selecionado. Confira o contraste e a legibilidade do indicador durante a navegação.'),
    expandable('style-custom-css', 'CSS personalizado: propriedades adicionais', 'Adicione propriedades CSS que precisem de ajustes diretos. Confira o seletor, o estado e o breakpoint ativos: eles determinam onde a declaração será aplicada.'),
    expandable('style-code-overrides', 'Code Overrides: arquivos ligados à seleção', 'Associe arquivos CSS ou JavaScript para complementar a seleção. Cada vínculo informa a origem do comportamento; remover um vínculo e editar o arquivo são ações diferentes.'),
    expandable('style-fluid', 'Fluid Responsive: medidas entre tamanhos de tela', 'Defina os viewports de referência e mínimo, o tamanho da fonte raiz e o limite de escala. A prévia mostra a conversão; Generate clamp() e Convert to rem aplicam a operação à página e seus descendentes.', 'Hairlines preserva traços finos e Ignore exclui propriedades da conversão. Revise esses limites antes de aplicar.'),
  ],
  insert: [
    detail('insert-search', '[data-kodety-insert-search-control]', 'Encontre um elemento', 'A busca filtra o catálogo. Use o nome do elemento ou explore as categorias para localizar estruturas, texto, mídia e formulários.'),
    detail('insert-elements', at('insert-elements'), 'Elements: as peças da página', 'Cada categoria reúne elementos com uma função. Comece pela estrutura que organiza o conteúdo; depois escolha textos, imagens, links e campos de formulário.'),
    detail('insert-components', at('insert-components'), 'Components: partes reutilizáveis', 'Esta categoria reúne componentes do próprio projeto. Uma instância reaproveita sua estrutura e pode oferecer propriedades e variantes para adaptar o conteúdo.'),
    detail('insert-cms', at('insert-cms'), 'CMS: conteúdo que vem de uma coleção', 'Os elementos de CMS conectam a página a dados estruturados. Depois de inserir, configure a coleção, os campos e os filtros nas propriedades da seleção.'),
    detail('insert-catalog', at('insert-catalog'), 'Confira a peça antes de inserir', 'Os cartões mostram os elementos da categoria ou da busca atual. Clicar insere a peça; arrastar permite escolher seu lugar no canvas.', 'O guia só apresenta o catálogo. A inserção acontece quando você escolhe uma peça.'),
  ],
  layers: [
    detail('layers-page', at('layers-page'), 'Confira a página antes de selecionar', 'Este seletor mostra a página que fornece as camadas. Use-o para mudar de página sem sair de Layers; o canvas e a árvore passam a acompanhar a página escolhida.'),
    detail('layers-search', '[data-layer-search]', 'Encontre uma camada pelo que ela contém', 'Busque pelo nome, tag, ID, classe ou texto do elemento. Os ancestrais dos resultados permanecem na árvore para mostrar onde cada correspondência está.'),
    detail('layers-hierarchy', '[data-ycode-layers-tree]', 'Leia a estrutura de fora para dentro', 'O recuo mostra quais elementos pertencem a cada container. Expanda os ramos para chegar aos filhos; ao arrastar uma camada, confira a indicação de destino antes de soltá-la.'),
    detail('layers-selection', '[data-layer-id]', 'A seleção conecta a árvore ao canvas', 'Clique em uma camada para ver suas propriedades no inspector. O menu de ações reúne opções como duplicar, bloquear e ocultar; Hidden on Builder esconde só no editor e mantém o elemento no site.'),
  ],
  pages: [
    detail('pages-search', at('pages-search'), 'Encontre páginas e variantes', 'A busca considera o nome e o caminho da página, além dos nomes dos testes e variantes relacionados. Limpe o campo para voltar à estrutura completa.'),
    detail('pages-tree', at('pages-tree'), 'Cada página tem seu próprio contexto', 'Selecione uma página para abrir seu conteúdo no canvas. O menu da linha reúne as ações disponíveis, incluindo configurações, código e organização; o ícone de casa identifica a página inicial.'),
    detail('pages-folder', at('pages-folder'), 'Pastas e subpáginas organizam os caminhos', 'Expanda a pasta para encontrar o conteúdo dentro dela. Arrastar páginas ou pastas reorganiza seus caminhos; confira o destino indicado e revise os links depois de mover.'),
    detail('pages-add', at('pages-add'), 'Comece uma nova página', 'O botão + cria uma página vazia em rascunho e a abre no canvas. Depois, ajuste o nome e o caminho pelas opções da página, prepare o layout e revise SEO e publicação.'),
  ],
  assets: [
    detail('assets-search', at('assets-search'), 'Uma busca para mídia e arquivos', 'Digite parte do nome ou caminho para localizar os arquivos do projeto. A busca filtra tanto a biblioteca de mídia quanto a árvore de arquivos.'),
    detail('assets-add', at('assets-add'), 'Traga os arquivos que o site precisa', 'Adicionar mídia permite selecionar vários arquivos do computador. O botão Criar arquivo ao lado cria um arquivo de texto pelo caminho informado, como styles/ajustes.css.'),
    detail('assets-media', at('assets-media'), 'Revise a biblioteca de mídia', 'Esta seção reúne as prévias dos arquivos visuais. O menu de cada item oferece as ações compatíveis, como substituir, comprimir ou converter; revise as páginas que usam a mídia antes de alterá-la.'),
    detail('assets-files', at('assets-files'), 'A árvore mostra onde cada arquivo vive', 'Explore as pastas e abra um arquivo para editá-lo no painel de código. O filtro por tipo ajuda a separar estilos, scripts e outros arquivos; confira o caminho antes de renomear ou remover.'),
    detail('assets-compression', at('assets-compression'), 'Revise a qualidade antes de comprimir', 'Abra a compressão para revisar qualidade e dimensões antes de aplicar. Compressão e conversão dependem de imagens compatíveis; seus controles aparecem na seção Mídia.'),
  ],
  responsive: [
    detail('responsive-breakpoints', at('design-responsive'), 'O breakpoint indica o contexto de Style', 'Escolha um dos tamanhos principais para revisar o layout. Antes de ajustar uma propriedade, confira o breakpoint ativo e a classe da seleção para entender onde o estilo será aplicado.'),
    detail('responsive-width', at('responsive-width'), 'Revise também as larguras intermediárias', 'Arraste esta borda para variar a largura do viewport e encontrar quebras entre os tamanhos principais. Observe linhas de texto, menus e colunas durante o ajuste.'),
    detail('responsive-fit', at('responsive-fit'), 'Enquadre a tela sem redimensionar os elementos', 'Ajustar canvas muda o enquadramento para caber no espaço de trabalho. Use-o depois de trocar de breakpoint; a escala de visualização é diferente das dimensões definidas em Style.'),
  ],
  agent: [
    detail('agent-session', at('agent-session'), 'Mantenha cada conversa no contexto certo', 'O seletor mostra a sessão atual e permite retornar às conversas existentes. Nova sessão inicia outra conversa; confira o título antes de continuar uma solicitação anterior.'),
    detail('agent-message', at('agent-message'), 'Descreva o resultado que quer alcançar', 'Diga qual parte do projeto deve mudar e quais detalhes precisam ser preservados. Uma referência concreta, como “reduza o espaço acima do título no mobile”, ajuda a orientar a solicitação.'),
    detail('agent-references', at('agent-references'), 'Dê referências para a solicitação', 'O botão + reúne imagens, arquivos e skills. Revise os anexos e as skills selecionadas antes de enviar; eles complementam o texto que você escreveu.'),
    detail('agent-model', at('agent-model'), 'Escolha modelo e esforço para a tarefa', 'Este menu reúne os modelos disponíveis, o esforço de raciocínio e o uso restante informado pela conta. Confira essas opções antes de iniciar uma solicitação mais longa.'),
    detail('agent-send', at('agent-send'), 'Envie e acompanhe a execução', 'Enviar inicia o trabalho descrito na mensagem. Durante a execução, o controle permite interromper o Agent; acompanhe o retorno da conversa e confira o resultado no canvas e no Preview.'),
  ],
  preview: [
    detail('preview-start', at('design-preview'), 'Abra a experiência da página', 'Preview abre a página em uma aba de revisão, onde você pode testar links, menus e interações. A aba do Builder continua disponível para editar; use os controles da revisão para mudar de dispositivo ou recarregar.'),
    detail('preview-viewport', '[data-preview-viewport-toolbar]', 'Teste dispositivos e medidas intermediárias', 'Escolha um dispositivo ou ajuste largura e altura quando esses campos estiverem disponíveis. Ajustar preview enquadra a visualização no espaço de trabalho.'),
    detail('preview-refresh', at('preview-refresh'), 'Recomece o teste da página', 'Recarregar reinicia a prévia. Use depois de uma sequência de navegação ou interação para testar novamente o comportamento a partir do carregamento da página.'),
    detail('preview-link', '[data-preview-url]', 'Confira a prévia em outra aba', 'Quando um endereço de preview está disponível, este controle o abre em uma nova aba. O botão de cópia ao lado permite copiar esse endereço para revisá-lo.'),
    detail('preview-exit', at('preview-exit'), 'Volte ao layout depois de testar', 'Na aba de revisão, Voltar à edição fecha a prévia. Continue na aba do Builder, ajuste os pontos encontrados e abra Preview novamente para conferir o resultado antes de publicar.'),
  ],
  variables: [
    detail('variables-collections', at('variables-collections'), 'Coleções: organize seus tokens', 'Separe os valores reutilizáveis por finalidade, como cores da marca, tipografia ou espaçamentos. Selecionar uma coleção muda a lista exibida à direita.'),
    detail('variables-tools', at('variables-tools'), 'Busque valores e escolha o tipo', 'A busca encontra variáveis da coleção por nome, valor ou tipo. Nova variável oferece os tipos disponíveis, como cor, tamanho, número, fonte e duração.'),
    detail('variables-values', at('variables-values'), 'Uma variável pode alcançar várias partes', 'A lista mostra nomes e valores da coleção. Editar um token atualiza os controles vinculados a ele. A exclusão preserva os valores que já estavam aplicados no projeto.'),
    detail('variables-editor', at('variables-editor'), 'Nome, tipo e valor têm papéis diferentes', 'O nome ajuda a reconhecer a intenção do token. O tipo define quais controles podem usá-lo; o valor é o que será aplicado. A coleção organiza o token. Salve quando a configuração estiver pronta.', 'Use nomes por função, como “Texto principal” ou “Espaço entre seções”, para facilitar o reaproveitamento.'),
  ],
  classes: [
    detail('classes-add', `${at('design-classes')} input`, 'Classes identificam estilos reutilizáveis', 'Neste campo você cria ou encontra classes para a seleção. Uma classe pode ser aplicada a vários elementos; seus ajustes de Style passam a ser compartilhados conforme o contexto ativo.'),
    detail('classes-scope', at('classes-scope'), 'Confira qual classe está recebendo os ajustes', 'O indicador Editing mostra a classe ativa. A combinação de classes define o contexto da regra; selecionar outro chip muda onde os próximos ajustes serão aplicados.'),
    detail('classes-state', '[aria-label="Edit an interaction state"]', 'Estado visual: Normal, hover e outros', 'Escolha o estado antes de configurar a aparência. Uma regra de hover, por exemplo, altera o estilo quando o ponteiro está sobre o elemento. O breakpoint continua fazendo parte desse contexto.'),
  ],
  'element-settings': [
    detail('element-identity', at('element-identity'), 'Identidade e atributos da seleção', 'ID identifica um elemento na página e pode servir de destino para links. Tag define sua semântica HTML. Tracking ID ajuda a identificá-lo nas análises; Title fornece uma descrição adicional.'),
    detail('element-content', elementSection('element'), 'Conteúdo do elemento', 'Edite o texto da seleção. Quando uma propriedade está conectada ao CMS ou a uma variável de componente, confira a origem indicada antes de alterar o valor.'),
    detail('element-link', elementSection('link'), 'Links: destino e comportamento', 'Escolha página, seção, URL, e-mail, telefone ou arquivo conforme o destino. As opções de nova aba, download e relacionamento completam o comportamento do link.'),
    detail('element-image', `${elementSection('image')}, ${elementSection('video')}, ${elementSection('audio')}`, 'Mídia: origem e apresentação', 'Defina o arquivo ou URL e as opções próprias da mídia selecionada. Imagens usam texto alternativo para descrever seu conteúdo; vídeo e áudio podem oferecer controles de reprodução.'),
    detail('element-form', elementSection('form'), 'Formulário: envio e resposta', 'Configure o destino dos dados, a ação após o envio e as mensagens de sucesso ou erro. Os nomes dos campos identificam os valores enviados; validação e proteção contra spam completam o fluxo.'),
    detail('element-input', `${elementSection('input')}, ${elementSection('text area')}, ${elementSection('select')}`, 'Campos: dados aceitos e validação', 'Name identifica o dado enviado. O tipo e as regras de validação definem o formato aceito; placeholder orienta o preenchimento. Required indica que o usuário precisa fornecer esse valor.'),
    detail('element-attributes', elementSection('attributes'), 'Atributos personalizados', 'Adicione atributos ao HTML quando uma integração ou comportamento precisar deles. Confira o nome e o valor esperados pela integração antes de aplicar.'),
  ],
  interactions: [
    detail('interaction-triggers', '[data-interaction-trigger-grid]', 'Gatilho: o que inicia a interação', 'Clique, entrada na tela, movimento do cursor e rolagem iniciam comportamentos diferentes. Escolha o evento de acordo com a experiência desejada; as ações definem o que acontece depois.'),
    detail('interaction-saved', '[data-saved-animation-library]', 'Animações salvas', 'Reaproveite sequências já guardadas na biblioteca. Ao aplicar, confira a seleção e os alvos para que os movimentos atinjam os elementos pretendidos.'),
    detail('interaction-list', '[data-interaction-list]', 'Interações da seleção', 'A lista reúne os gatilhos associados ao elemento. Abra uma interação para revisar os detalhes. O controle de ativação permite ligar ou desligar seu comportamento.'),
    { ...detail('interaction-event', '[data-interaction-essentials]', 'Evento e alvo do gatilho', 'O evento define quando começar. O alvo determina qual elemento deve receber esse evento: a seleção, um seletor específico ou outro alvo disponível.'), reveal: `${at('interaction-open-existing')}[data-kodety-onboarding-reveal]` },
    detail('interaction-playback', '[data-interaction-playback]', 'Reprodução da sequência', 'Configure como a sequência responde a novas ativações e se deve repetir ou retornar. Confira o resultado no Preview depois de definir as ações.'),
    detail('interaction-scroll', '[data-interaction-scroll-settings]', 'Rolagem: início, fim e progresso', 'Esses controles definem quando a rolagem ativa a interação. A opção de acompanhar progresso vincula o avanço da animação à posição da rolagem.'),
    detail('interaction-pointer', '[data-interaction-pointer-settings]', 'Movimento do cursor', 'Configure como a posição do ponteiro influencia a interação e se o elemento deve retornar ao retirar o cursor.'),
    detail('interaction-availability', '[data-interaction-availability]', 'Dispositivos e movimento reduzido', 'Escolha em quais breakpoints a interação funciona e como ela respeita a preferência de movimento reduzido. Revise os dispositivos em que o gatilho faz sentido.'),
    detail('interaction-actions', '[data-interaction-actions]', 'Ações: o resultado do gatilho', 'Organize as ações que a interação executa. Cada uma pode ter seu próprio alvo e parâmetros; a ordem e o tempo determinam a sequência percebida.'),
    detail('interaction-custom', '[data-interaction-custom-settings]', 'Eventos personalizados', 'Use esta configuração quando o gatilho vier de código. Confira o evento esperado e o elemento que o dispara para conectar o comportamento à sequência.'),
  ],
  timeline: [
    detail('timeline-view', '[data-timeline-viewport]', 'Faixas e duração', 'As faixas organizam as ações ao longo do tempo. A posição de cada trecho indica quando ele começa; suas bordas ajustam a duração.'),
    detail('timeline-zoom', '[data-timeline-zoom-control]', 'Zoom da timeline', 'Aproxime para ajustar momentos pequenos ou afaste para enxergar a sequência completa. O zoom muda a visualização, não a duração da animação.'),
    detail('timeline-target', '[data-animation-target-field]', 'Alvo da ação', 'O alvo da animação pode ser diferente do elemento que recebeu o gatilho. Confira o seletor ou escolha o alvo no canvas antes de configurar os valores.'),
    detail('timeline-timing', '[data-animation-timing]', 'Tempo e transição', 'Defina duração, atraso e curva de movimento. O atraso muda quando a ação começa; a curva controla como a mudança acelera e desacelera.'),
    detail('timeline-values', '[data-animation-properties]', 'Valores de início e fim', 'Cada propriedade descreve uma mudança visual. Os valores de origem e destino determinam o percurso; keyframes permitem ajustes em outros momentos da ação.'),
    detail('timeline-sequence', '[data-animation-sequence]', 'Relação com as outras ações', 'As opções de sequência organizam repetição e execução das ações. Revise o conjunto para conferir quais mudanças acontecem juntas ou uma depois da outra.'),
  ],
  code: [
    detail('code-file', at('code-file'), 'O arquivo ativo define o que você edita', 'Use este seletor para abrir HTML, CSS, JavaScript e outros arquivos de texto. Confira o caminho antes de alterar o conteúdo: cada arquivo tem uma função no projeto.'),
    detail('code-editor', `${at('design-code-panel')} textarea`, 'Código e canvas compartilham o projeto', 'As alterações neste editor fazem parte dos arquivos usados pelo site. Revise o resultado visual depois de editar estrutura, estilos ou scripts.'),
    detail('code-tools', at('code-tools'), 'Formatação e espaço de trabalho', 'Formatar organiza a escrita do arquivo compatível. Maximizar amplia o editor; Fechar recolhe o painel. Use as ações do projeto para salvar ou publicar a versão desejada.'),
    detail('code-diagnostics', '[aria-label="Diagnósticos do Code Component"]', 'Diagnósticos do componente', 'Os avisos identificam problemas encontrados no código. Quando há uma linha associada, clique no diagnóstico para localizar o trecho que precisa de revisão.'),
  ],
  'component-variants': [
    detail('component-variants', at('component-variants-list'), 'Variantes representam estados do componente', 'Selecione a variante antes de editar sua aparência. As mudanças pertencem ao estado ativo; a ordem e a variante inicial ajudam a organizar o comportamento do componente.'),
    detail('component-options', at('component-options'), 'Propriedades e eventos do componente', 'Variables expõe valores que cada instância pode personalizar. Eventos define como o componente responde às ações e transita entre variantes.'),
    detail('component-properties', '[data-component-property]', 'Personalização da instância', 'Uma propriedade exposta permite ajustar conteúdo ou aparência sem desmontar o componente. O controle de restauração devolve o valor padrão definido no componente.'),
  ],
  effects: [
    detail('effects-search', '[data-kodety-effects-search-control], [data-library-effect-search]', 'Encontre uma predefinição', 'Busque um efeito por nome e confira a prévia. A predefinição oferece um ponto de partida para ajustar o comportamento da seleção.'),
    detail('effects-activation', '[data-library-activation-filters]', 'Quando o efeito funciona', 'Os filtros separam efeitos pelo momento de ativação, como entrada na tela, interação ou movimento contínuo. Escolha o momento que combina com o elemento.'),
    detail('effects-configure', '[data-interaction-library-wizard]', 'Revise antes de aplicar', 'Confira o alvo, o tipo de ativação e as opções da predefinição. A aplicação altera a interação do projeto; ajuste os parâmetros para a seleção atual.'),
  ],
  'publish-panel': [
    detail('publish-destination', at('publish-destination'), 'Destino da publicação', 'Confira o endereço que receberá a versão publicada. O estado do painel indica se existem alterações do projeto ainda pendentes.'),
    { ...detail('publish-optimizations', at('publish-optimizations'), 'Otimizações da versão publicada', 'Estas opções controlam o processamento dos arquivos na publicação. Revise cada recurso e use os caminhos preservados para excluir arquivos que precisem permanecer intactos.', 'Salvar preferências guarda a configuração. Aplicar ao site publicado atualiza a versão existente; Publicar agora inclui as alterações do projeto.'), reveal: `${at('publish-optimizations-toggle')}[data-kodety-onboarding-reveal]` },
    detail('publish-release', at('publish-release'), 'Revise a versão e confirme quando quiser', 'O rodapé identifica a release atual e reúne as ações finais. Publicar envia as alterações para o site; cancelar ou fechar permite continuar editando.'),
  ],
};
