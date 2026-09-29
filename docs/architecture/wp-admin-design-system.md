# Interface administrativa do WordPress

O redesenho se limita ao wp-admin, incluindo as páginas administrativas do Kodety.
O Builder interno é referência visual e não recebe esta camada. Login preservado.

## Estrutura e componentes

- `shell.css` / `shell.js`: sidebar de 224px (56px recolhida) com somente a logo
  oficial acima da busca. O grupo Kodety permanece aberto e começa por Builder,
  Importar, CMS, Análises, Mídias e E-mails, seguido pelos módulos adicionais,
  configurações e manutenção. Importar é a entrada única do projeto; a rota base
  do Kodety seleciona esse item, sem uma entrada Projeto duplicada.
  Links respeitam as permissões dos painéis.
  A seção WordPress
  conserva as rotas e submenus nativos; o rodapé reúne ajuda e conta. A topbar de
  56px (60px no celular) mantém Operacional, CMS, Páginas e Builder em um grupo segmentado no
  desktop e um seletor acessível no celular, além das ações de criação permitidas. Opções de Tela e Ajuda conservam os elementos/eventos originais.
- `design-system.css`: tokens neutros alinhados ao Analytics e às Configurações:
  canvas e shell `#111111`, cartões `#181818`, campos/popovers `#242424` e hover
  `#282828`. Bordas estruturais `#303030`, divisores sutis `#262626` e bordas de
  hover `#484848`. Texto `#f0f0f0`, `#b8b8b8` e `#969696`; acento e estados
  semânticos permanecem distintos. Raios de 10px nos cartões e 8px nos controles;
  sombra de popover `0 8px 28px rgb(0 0 0 / 32%)`. Inter quando disponível,
  seguida pelas fontes do sistema, sem download adicional. Títulos principais
  usam 20px/600; descrições e controles da topbar usam 12px.
- `wp-admin-audit.css`: camada visual comum para listas, formulários, galerias,
  menus, perfis, ferramentas, mídia nativa e diálogos. O build gera CSS
  minificado e variantes por família de tela, mantendo uma fonte legível.
  Comentários e Plugins recebem variantes próprias, com os blocos adicionais
  de suas tabelas; o Dashboard usa uma variante sem os estilos dessas listas.
- `native-workspace.js`: reorganiza os nós originais. Tabelas integram filtros,
  busca, seleção, ações em massa e paginação; ações de linha abrem em um menu
  acessível pelo botão de reticências na célula principal. Formulários, nomes,
  nonces, links e eventos originais permanecem. A atualização nativa por AJAX
  reaplica apenas a adaptação necessária, inclusive quando Plugins substitui o
  formulário inteiro. Sem polling; o catálogo de temas usa um MutationObserver
  restrito ao conteúdo para acompanhar a reconstrução das galerias e diálogos.
- `native-select.js`, incorporado ao bundle do shell, apresenta seletores simples
  como combobox e listbox do Kodety, inclusive no celular, sem abrir o menu de
  opções do sistema operacional. O `<select>` original continua responsável
  pelo valor, validação e envio do formulário; nomes, opções, rótulos e eventos
  `input`/`change` são preservados. Setas, Home/End, Enter/Espaço, Escape, Tab e
  busca por digitação mantêm navegação de teclado, incluindo grupos e opções
  ocultas/desabilitadas. Reset, atualização dinâmica e clones da edição rápida
  são sincronizados. Seleções múltiplas/listas conservam seu controle nativo;
  widgets já customizados, controles do editor e conteúdo de terceiros ficam
  fora da adaptação. No shell, o seletor de área continua disponível também
  nas páginas de terceiros. Sem JavaScript, o controle original permanece.
- Comentários usam linhas de conversa com autor, contatos, estado, mensagem e
  contexto da publicação. O cabeçalho apresenta as âncoras nativas como controles
  explícitos de ordenação. Seleção e ações em massa são contextuais; o filtro
  secundário abre em um popover. A adaptação preserva edição rápida, resposta,
  moderação e operações em lote.
- Tabelas largas rolam dentro do próprio painel em larguras intermediárias;
  ações continuam na célula principal. No celular, a expansão nativa de detalhes
  permanece disponível, sem obrigar o usuário a usar a largura de desktop.
  Em Páginas e Posts, checkbox, ícone, título e menu têm colunas consistentes;
  estados quebram abaixo do texto, sem travessões ou vírgulas soltos. Busca e
  filtro compartilham altura de 36px no celular.
- `plugin-information.css`: complemento exclusivo do iframe de detalhes de
  plugins; não aumenta a transferência de todas as páginas. O diálogo tem
  conteúdo e metadados separados no desktop e leitura sequencial no celular.
- Perfil reúne dados pessoais, contato, biografia, segurança, preferências e
  aplicativos em seções com índice e rodapé de envio. Os campos originais
  continuam dentro do mesmo formulário; não há cópias nem submissão paralela.
- Temas têm cartões com ações permanentes e detalhes proporcionais à janela.
  O modo de um único tema usa um painel integrado, sem duplicar o catálogo.
  Plugins instalados mostram estado e ações de linha; os cartões de instalação
  reservam linhas distintas para nome, descrição, ações e metadados.
- Checkboxes usam marca centralizada, seleção parcial e foco de teclado;
  a ordenação apresenta um único chevron de traço junto ao rótulo, conservando
  a direção e o link nativos.
- `dashboard.css`: visão geral renderizada pelo PHP, com atividade, publicação,
  projeto e painéis de contexto. As duas colunas fluem independentemente, com
  18px entre Conteúdo recente e Sistema. Sem reescrita do dashboard no navegador.
- CSS específicos de projeto/configurações, atualizações, licença, e-mails,
  mídia, marketing, manual, modelos e agência foram reformulados.
- Extensões separa envio de ZIP, contexto e catálogo em componentes próprios.
  O catálogo tem duas colunas e responde à largura do painel. Configurações
  usa cabeçalho por seção, abas horizontais e um seletor único em telas estreitas.
  Preferências gerais, identidade e armazenamento ficam em blocos independentes;
  Segurança separa diagnóstico e os grupos de proteção em cartões. Configurações
  mantém campos, escolhas de identidade e armazenamento em blocos completos;
  os rodapés empilham no celular. Controles ocultos são recortados sem perder
  foco ou associação com o formulário, evitando checkboxes sobre os ícones.
- Cliques não herdam o anel `:focus` do WordPress. O foco de teclado usa
  `:focus-visible`, inclusive nos wrappers de upload e seleção. Indicadores
  de aba ativa são independentes do anel de foco.
- Licença usa cartões independentes; e-mails reúne filtros, seleção e mensagens
  na mesma superfície; conexões usa três colunas no desktop. A Ajuda tem índice
  e leitura com rolagem independente no desktop e documento normal no celular;
  o observador de seção ativa acompanha a raiz correta após redimensionamento.
- `editor-chrome.css`: somente controles dos editores nativos do WordPress e
  Customizer, sem carga nos iframes de conteúdo nem no Builder interno.

Os ícones de áreas e recursos usam Solar Bold Duotone. Chevrons, setas,
reticências, mais, fechar e controles direcionais usam Solar Linear. O build
extrai SVGs e arredonda coordenadas para duas casas decimais (erro máximo de
0,005 unidade SVG). SVGO, dependência apenas de desenvolvimento, compacta a
notação dos caminhos preservando a geometria arredondada, os nós, os estilos,
o viewBox e as opacidades duotone. Não há fusão de paths nem transformação de
curvas; o navegador recebe um registro estático, sem React ou SVGO. Indicadores
nativos de ordenação, expansão e paginação recebem traços, preservando botões,
links, rótulos de acessibilidade e estados desabilitados. O registro observa
somente novos slots de ícone para hidratar conteúdo dinâmico.

As telas são classificadas no servidor como nativas, próprias do Kodety ou de
terceiros. Páginas de outros plugins, seus tipos de conteúdo e taxonomias recebem
somente o shell: nenhum adapter, tema de controles ou variável de cor WordPress
é aplicado dentro de seu conteúdo. Login e Builder interno permanecem isolados.

Os estilos e scripts antigos de listas/mídia/dashboard não são mais enfileirados.
A camada clássica recebe três CSS e três JS; o dashboard acrescenta seu CSS.
Ferramentas que precisam do adapter específico recebem também `native-tools.bundle.js`.
Os scripts compartilhados e os de Projeto começam a carregar no head com `defer`.
Antes da montagem, a moldura final ocupa seu espaço e o conteúdo nativo que será
reorganizado apresenta um placeholder estático. O adapter libera o conteúdo assim
que termina, sem espera artificial. Um watchdog de falha libera a tabela clássica
se o adapter não carregar; se o shell falhar, o menu e as margens nativas são
restaurados. A recuperação de um bundle atrasado remove o fallback sem duplicar
a navegação. Sem JavaScript, o menu e os controles nativos continuam acessíveis. Nas abas de Projeto, uma inicialização curta lê o fragmento da URL
antes da primeira pintura e seleciona o título e a seção corretos pelo CSS.

### Compilação

`npm run wordpress:admin-runtime` gera `shell.bundle.js`,
`native-workspace.bundle.js` e `native-tools.bundle.js`, além dos estilos
minificados e variantes do audit,
a partir dos fontes legíveis. O WordPress serve os
bundles com versão por data do arquivo. O empacotamento executa esse build antes
de montar o plugin; os testes verificam o SHA-256 do fonte incorporado em cada
bundle para impedir uma entrega desatualizada. Nenhuma biblioteca é aceita nas
entradas desses scripts. `npm run wordpress:icons` gera o registro Solar.

## Transferência da camada visual

Medição de 2026-09-08: soma dos recursos individuais comprimidos em gzip nível 6.
Exclui trechos inline, WordPress, traduções, conteúdo, imagens e recursos
particulares de cada plugin; não é peso total nem benchmark de latência. Os
limites de transferência existentes foram mantidos.

| Família | Gzip | Recursos |
|---|---:|---:|
| Listas: Posts, Páginas e Usuários | 58,437 B | 3 CSS + 3 JS |
| Comentários | 59,363 B | 3 CSS + 3 JS |
| Plugins instalados | 58,870 B | 3 CSS + 3 JS |
| Formulários: Perfil e Configurações gerais | 55,354 B | 3 CSS + 3 JS |
| Mídia nativa | 57,966 B | 3 CSS + 3 JS |
| Dashboard | 56,445 B | 4 CSS + 3 JS |
| Ferramentas e Site Health | 60,351 B | 3 CSS + 4 JS |
| Catálogos: Temas e instalação de plugins | 55,485 B | 3 CSS + 3 JS |

O registro compartilhado de ícones passou de 22,376 B para 16,062 B gzip; o
sprite do primeiro frame passou de 9,315 B para 6,611 B gzip. O sprite é inline
e não entra na soma da tabela. A redução dos ícones e a seleção de CSS por
família acomodam o seletor customizado dentro dos limites atuais.

## Verificação anterior ao refinamento de 2026-09-08

- `node scripts/test-admin-branding.mjs`: contratos de componentes, ícones,
  isolamento dos editores e planejamento de assets,
  incluindo limites de transferência, permissões dos links e parâmetros de logout.
- `npm run wordpress:test-i18n`: catálogos, EN/PT, portais, conteúdo dinâmico,
  atributos e preservação do conteúdo autoral; dívida de tradução igual a zero.
- `php Wordpress/tests/sharing-runtime.php`: autorização antecipada da prévia
  nativa de temas antes da inicialização de WP_Query.
- `node scripts/test-wordpress-workspace-navigation.mjs`: troca entre áreas,
  veto, recuperação e passagem do bloqueio de edição.
- `node scripts/test-wordpress-updates-ui.mjs`: verificação, estados, repetição,
  timeout, upload ZIP e retorno à navegação após salvar.
- `node scripts/test-elementor-import-ui.mjs`: origens, modos, estado de rascunho
  e limites de publicação da importação continuam cobertos. A importação por URL
  usa ícones Solar com fallback SVG local e seta que acompanha sua expansão.
- `node scripts/validate-wordpress-plugin.mjs`: preflight do pacote, incluindo
  bundles de scripts e variantes de CSS; 369 arquivos e 98 artefatos de manifest.
- Fixture WordPress isolada: revisão de screenshots, geometria e interações em
  desktop e celular; abas do projeto, campos, tabelas, modais, menus, Opções de
  Tela e Ajuda. A matriz funcional de tabelas passou 29 cenários, incluindo
  seleção geral, ações em massa, edição rápida, resposta/moderação, ordenação,
  filtros, paginação e duas buscas AJAX consecutivas em Plugins.
- Revisão ampliada: 38 cenários de controles em 1440px e 390px passaram sem
  exceções JavaScript, incluindo as sete abas de configurações, preview de cor,
  mídia/inspector, três tipos de conexão de e-mail, navegação, reabertura de
  Ajuda/Opções de Tela e detalhes de plugins. Estados `hidden` de mídia são
  respeitados; o modal nativo pode ser fechado por clique no celular. Os dados
  do plugin de teste no modal vieram de uma resposta local, sem instalação real.
- Preservação do DOM na matriz de tabelas: 14 formulários e 203 controles
  conservaram os nós, vínculos, nomes, tipos, ações, métodos e nonces originais.
- Primeira pintura: atraso controlado dos scripts em Comentários apresenta
  moldura e placeholder estáveis, seguido da conversa pronta; bloqueio do
  adapter e execução sem JavaScript mantêm uma tabela clássica legível.
- Histórico: ida, volta e avanço mantiveram um único shell e controles funcionais.
  O desmontamento em `pagehide` foi removido para evitar o flash de saída e a
  perda da interface em documentos preservados. A fixture usa `no-store`, então
  não foi possível exercitar uma restauração real pelo bfcache.
- Revisão de composição: telas nativas, sete áreas do projeto e módulos Kodety
  inspecionados em 1440, 1024 e 390px. A revisão das imagens encontrou e corrigiu
  controles sobrepostos, cabeçalhos de tabela ambíguos, formulários comprimidos,
  fundos nativos em Menus, largura de Site Health e seletores sem seta. As imagens
  foram reavaliadas após as correções, incluindo conteúdo abaixo da dobra.
- Módulos Kodety: 49 cenários de controles passaram, além de 12 cenários da
  navegação da Ajuda com rolagem, resize e preferência de movimento reduzido.
  Os cartões de modelos e o inspector de mídia foram conferidos com registros
  temporários, removidos após a revisão.
- Tabelas recompostas: 12 combinações finais (Comentários, Posts, Usuários e
  Plugins em três larguras) passaram, sem exceções JavaScript. Menus também foi
  exercitado com registros temporários: adicionar página/link, editar rótulo,
  mover item, salvar, verificar a ordem persistida e selecionar em massa. O menu
  de teste não recebeu local de tema e foi excluído ao terminar.
- Sintaxe desta rodada: 15 CSS, sete JS e os três PHP alterados na composição,
  além de verificação de whitespace do diff.

A instalação de teste usa dados descartáveis; alterações de estado foram
exercitadas somente nesses registros. Páginas de terceiros recebem somente a
navegação compartilhada. Interfaces próprias de plugins e módulos que exigem projeto,
licença ou serviços externos precisam de validação com esses recursos ativos.

### Última revisão de composição e falhas

A revisão independente comparou screenshots com o Analytics em 1440, 1024 e 390 px,
incluindo estados abertos e a parte inferior dos formulários. A navegação das
sete áreas do Projeto foi verificada por teclado e seletor móvel; 76 controles
conservaram seus formulários, sem realizar submissões. O teste de assets terminou
com 1.443 verificações e os tetos originais de 60 KB/64 KB foram preservados.

Foram simulados atraso de 700 ms, falha definitiva do shell/ícones/adapter e atraso
do shell superior a 4 s nos três escopos. No celular, o fallback mantém o menu
acessível mesmo enquanto o DOMContentLoaded aguarda um defer atrasado. Os ícones
e algumas traduções chegam após o JavaScript; o critério verificado é ausência
de troca de tema, seção errada ou composição intermediária quebrada.

Uma página de terceiro com fontes, cores e controles próprios foi comparada
com seu original em 1440 e 390px. O teste manteve propriedades visuais e conteúdo;
não constitui garantia sobre todos os plugins existentes. Os testes locais não
ativaram licença, enviaram SMTP ou alteraram dados de produção.

Na revisão de Perfil, Temas e Plugins, screenshots em 1440 e 390px revelaram e
corrigiram conflitos de especificidade no tema único, no botão de fechar detalhes,
nos filtros de plugins e no upload. Foram conferidos navegação entre temas,
fechamento, seleção, ações de linha, ordenação real e navegação por teclado no
perfil, sem salvar alterações de conta. O diretório externo de plugins estava
indisponível na fixture: cartões e detalhes usaram respostas locais temporárias,
removidas após a revisão; nenhuma instalação foi executada.

### Refinamento de 2026-09-08

Esta rodada aproxima a hierarquia de superfícies, tipografia, divisores,
controles e estados de hover das telas Analytics e Configurações do Kodety.
Os módulos próprios usam os tokens compartilhados; cores semânticas e conteúdo
autoral das prévias de mídia e e-mail são preservados. A tabela de Páginas no
celular recebeu alinhamento de título, checkbox, ícone, estados e menu; os
seletores simples receberam a lista customizada descrita acima.

Validações concluídas nesta rodada:

- `node scripts/test-admin-branding.mjs`: contratos de interface, isolamento e
  assets passaram, incluindo os limites de transferência sem aumento dos tetos.
- `node scripts/test-admin-selects.mjs`: verificações de navegação por teclado,
  limites, opções e grupos ocultos/desabilitados, busca sem distinção de acentos,
  repetição de letras, listas vazias, isolamento do popover e das teclas de edição rápida passaram.
- Validação geométrica dos ícones: 76 ícones, 211 paths e 2.302 segmentos
  conservaram a geometria após o arredondamento; 9.246 números foram comparados.
  A compactação manteve atributos não geométricos, viewBox e 70 declarações de
  opacidade duotone. React e SVGO permanecem fora do bundle entregue ao navegador.
- A medição de assets acima foi obtida de
  `/private/tmp/kodety-refinement-assets.json`; o relatório registrou 1.762
  verificações de rotas e isolamento dos editores.

As evidências visuais locais desta rodada ficam em
`/private/tmp/kodety-admin-refinement/screenshots/` (artefatos temporários).
Incluem Dashboard, Comentários, Páginas no celular, Configurações nativas,
Configurações do Kodety, Extensões, Segurança, E-mails, Mídia e seletores abertos.
A revisão desta rodada conferiu 1440, 1024 e 390px. Foram corrigidos os estados
vazios de Comentários, o recorte da lista de Plugins, a grade móvel de E-mails
e a largura dos grupos de Configurações. Seletores abertos, seleção em massa,
Quick Edit, navegação entre seções e um seletor de fuso com 474 opções foram
exercitados. Enter e Escape no seletor preservam a edição rápida em andamento.
Os cenários históricos acima não são contabilizados como nova validação.

Branding, os testes de seletores/navegação e o preflight do pacote passaram.
Catálogos e runtime PHP de idioma passaram. A suíte global de i18n ficou
parcial: o teste DOM tentou iniciar um Chromium separado, indisponível no
ambiente, e a cobertura detectou frases em alterações externas de onboarding
e conversão Framer, sem ocorrências nos arquivos deste refinamento.
O ZIP foi gerado a partir dos bundles administrativos recompilados, preservando
os assets já construídos do Builder; o empacotador validou conteúdo e determinismo.
