<?php

defined('ABSPATH') || exit;

/**
 * Operational documentation center bundled with the installed Onun Kodety version.
 *
 * The content uses independent task modules inspired by S1000D and concise,
 * controlled instructions inspired by ASD-STE100. It does not claim formal
 * compliance with either standard.
 */
final class Kodety_Help {
    private static ?self $instance = null;
    private string $hook_suffix = '';

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('admin_menu', [$this, 'admin_menu'], 100);
        add_action('admin_enqueue_scripts', [$this, 'admin_assets']);
    }

    public function admin_menu(): void {
        $title = class_exists('Kodety_Admin_I18n')
            ? Kodety_Admin_I18n::instance()->translate('Manual Onun Kodety')
            : 'Manual Onun Kodety';
        $this->hook_suffix = (string) add_menu_page(
            $title,
            $title,
            'read',
            'kodety-manual',
            [$this, 'render_page'],
            'dashicons-welcome-learn-more',
            3
        );
    }

    public function admin_assets(string $hook): void {
        if ($hook !== $this->hook_suffix && $hook !== 'toplevel_page_kodety-manual') return;

        $css = KODETY_DIR . 'admin/help.css';
        $js = KODETY_DIR . 'admin/help.js';
        wp_enqueue_style(
            'kodety-help',
            KODETY_URL . 'admin/help.css',
            [],
            is_file($css) ? (string) filemtime($css) : KODETY_VERSION
        );
        wp_enqueue_script(
            'kodety-help',
            KODETY_URL . 'admin/help.js',
            [],
            is_file($js) ? (string) filemtime($js) : KODETY_VERSION,
            true
        );
    }

    /**
     * @return array<string, string>
     */
    private function area_urls(): array {
        $project_admin = admin_url('admin.php?page=kodety');
        return [
            'dashboard' => admin_url('index.php'),
            'project' => $project_admin . '#kodety-project',
            'extensions' => $project_admin . '#kodety-extensions',
            'interface' => $project_admin . '#kodety-interface',
            'project_settings' => $project_admin . '#kodety-settings',
            'optimizations' => $project_admin . '#kodety-optimizations',
            'security' => $project_admin . '#kodety-security',
            'codex' => $project_admin . '#kodety-mcp',
            'builder' => home_url('/kodety/editor/'),
            'cms' => home_url('/kodety/cms/'),
            'cms_new' => admin_url('admin.php?page=kodety-cms-new-item'),
            'pages' => admin_url('edit.php?post_type=page'),
            'media' => admin_url('admin.php?page=kodety-media'),
            'members' => home_url('/kodety/members/'),
            'emails' => admin_url('admin.php?page=kodety-emails'),
            'email_settings' => admin_url('admin.php?page=kodety-emails&tab=settings'),
            'campaigns' => admin_url('admin.php?page=kodety-email-campaigns'),
            'email_templates' => admin_url('admin.php?page=kodety-email-templates'),
            'contacts' => admin_url('admin.php?page=kodety-email-contacts'),
            'delivery_health' => admin_url('admin.php?page=kodety-email-health'),
            'analytics' => home_url('/kodety/analytics/'),
            'localization' => home_url('/kodety/localization/'),
            'settings' => home_url('/kodety/settings/'),
            'users' => admin_url('users.php'),
            'plugins' => admin_url('plugins.php'),
            'updates' => admin_url('update-core.php'),
            'permalinks' => admin_url('options-permalink.php'),
            'site' => home_url('/'),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function modules(): array {
        return [
            [
                'id' => 'primeiros-passos',
                'code' => 'KDY-START-001',
                'group' => 'Comece aqui',
                'title' => 'Colocar o primeiro projeto no ar',
                'time' => '15–30 min',
                'level' => 'Inicial',
                'purpose' => 'Criar ou importar um projeto, revisar o resultado e publicar uma primeira release.',
                'keywords' => 'começar primeira vez onboarding projeto site publicar release',
                'prerequisites' => [
                    'Entre no WordPress com uma conta que pode usar o Onun Kodety.',
                    'Tenha um ZIP do projeto se você não quiser começar do zero.',
                    'Faça backup antes de substituir um site que já está publicado.',
                ],
                'steps' => [
                    ['Escolha a origem do projeto', 'Continue o projeto atual, crie um projeto vazio ou importe um ZIP HTML/Vite/Onun Kodety.'],
                    ['Abra o Builder', 'Abra o projeto e confirme a página inicial. Localize a árvore de camadas à esquerda, o canvas no centro e o inspetor à direita.'],
                    ['Faça uma alteração pequena', 'Selecione um texto. Altere o conteúdo. Espere a atualização do canvas e confirme o resultado no Preview.'],
                    ['Revise as larguras', 'Confira desktop, tablet e celular. Corrija texto cortado, overflow, largura fixa e espaçamento antes de publicar.'],
                    ['Publique a release', 'Clique em Publicar. Espere a confirmação. Abra o endereço público em uma nova aba e teste a navegação.'],
                ],
                'expected' => [
                    'O projeto aparece no Dashboard e abre no Builder.',
                    'O Preview mostra a alteração realizada.',
                    'O endereço público entrega a nova release.',
                ],
                'errors' => [
                    ['O projeto não abre', 'O pacote não tem HTML válido ou a importação não terminou.'],
                    ['A edição aparece apenas no Builder', 'A alteração foi salva, mas uma nova release ainda não foi publicada.'],
                ],
                'troubleshooting' => [
                    'Confirme qual projeto está ativo antes de editar.',
                    'Abra o Preview para separar um erro de edição de um erro de publicação.',
                    'Se o site publicado falhar, restaure a release anterior e revise o projeto.',
                ],
                'references' => ['projeto-importacao', 'builder', 'publicacao'],
                'areas' => ['dashboard', 'builder', 'site'],
            ],
            [
                'id' => 'projeto-importacao',
                'code' => 'KDY-PRJ-020',
                'group' => 'Projetos',
                'title' => 'Criar, importar ou substituir um projeto',
                'time' => '10–40 min',
                'level' => 'Intermediário',
                'purpose' => 'Preparar um projeto HTML, Vite ou exportado pelo Onun Kodety para edição e publicação segura.',
                'keywords' => 'importar zip vite html framer webflow url substituir backup',
                'prerequisites' => [
                    'Use um ZIP com os arquivos do projeto e sem PHP executável.',
                    'Mantenha os caminhos de CSS, JavaScript, imagens e fontes relativos ao projeto.',
                    'Baixe um backup antes de substituir um projeto existente.',
                ],
                'steps' => [
                    ['Confirme a substituição', 'Baixe um backup quando o ZIP substituir o projeto atual.'],
                    ['Selecione o ZIP', 'Envie um ZIP HTML, Vite ou exportado pelo Onun Kodety. O Builder executa o build quando ele for necessário.'],
                    ['Leia o impacto', 'Revise a lista de itens que serão substituídos. Confirme a substituição somente quando o destino estiver correto.'],
                    ['Espere a preparação', 'Não feche a página durante a validação, o build e a criação do workspace editável.'],
                    ['Audite o projeto importado', 'Abra todas as páginas. Confira imagens, fontes, scripts, links, breakpoints e Code Components.'],
                    ['Publique depois do Preview', 'Use o Preview antes de criar a primeira release do pacote importado.'],
                ],
                'expected' => [
                    'As páginas e os arquivos aparecem na árvore do projeto.',
                    'O canvas e o Preview carregam os mesmos assets.',
                    'O publish conclui o build e ativa uma release.',
                ],
                'errors' => [
                    ['O ZIP é recusado', 'O pacote não contém uma entrada válida, contém arquivo proibido ou excede um limite do servidor.'],
                    ['Imagens ou fontes não carregam', 'Os caminhos absolutos ainda apontam para a origem ou diferem em maiúsculas e minúsculas.'],
                    ['Vite abre sem estilos', 'O build não encontrou o script correto ou as referências do pacote não são relativas.'],
                ],
                'troubleshooting' => [
                    'Abra a árvore de Assets e confirme se o arquivo ausente foi importado.',
                    'Compare o caminho usado no HTML/CSS com o nome real do arquivo.',
                    'Revise a saída do build antes de repetir a importação.',
                ],
                'references' => ['midias', 'builder', 'publicacao', 'problemas'],
                'areas' => ['project', 'builder'],
            ],
            [
                'id' => 'builder',
                'code' => 'KDY-BLD-100',
                'group' => 'Builder',
                'title' => 'Editar uma página no canvas',
                'time' => '5–20 min',
                'level' => 'Inicial',
                'purpose' => 'Selecionar um elemento, alterar sua estrutura ou conteúdo e confirmar a atualização no canvas.',
                'keywords' => 'builder canvas camadas selecionar editar texto mover duplicar desfazer preview',
                'prerequisites' => [
                    'Abra o projeto e a página corretos.',
                    'Feche o Preview antes de editar o canvas.',
                ],
                'steps' => [
                    ['Selecione a camada', 'Use a árvore quando o elemento for pequeno, sobreposto ou difícil de clicar no canvas.'],
                    ['Confirme o escopo', 'Veja se você está editando o elemento, uma classe reutilizável, uma instância de componente ou um breakpoint.'],
                    ['Altere uma propriedade', 'Mude um valor por vez. Para texto, edite no canvas ou no painel. Para layout, comece pelo elemento pai.'],
                    ['Espere a confirmação visual', 'O canvas deve refletir a alteração. Não publique enquanto o canvas e o painel mostrarem valores diferentes.'],
                    ['Revise o Preview', 'Abra o Preview e teste scroll, links, formulários e componentes que dependem de JavaScript.'],
                ],
                'expected' => [
                    'O painel mostra o mesmo valor que foi aplicado.',
                    'O canvas mantém seleção, posição e scroll durante a edição.',
                    'O Preview preserva o resultado sem controles do editor.',
                ],
                'errors' => [
                    ['O valor volta no painel', 'Uma resposta antiga do canvas ou um estilo de maior prioridade substituiu a edição.'],
                    ['O canvas só atualiza ao recarregar', 'A sincronização do iframe falhou ou o runtime da página bloqueou a atualização.'],
                    ['Vários elementos mudaram', 'A edição foi aplicada a uma classe ou componente compartilhado.'],
                ],
                'troubleshooting' => [
                    'Use Desfazer se o escopo da alteração estiver errado.',
                    'Selecione novamente a camada e confirme a classe e o breakpoint ativos.',
                    'Compare canvas e Preview. Reabra o projeto somente se ambos não atualizarem.',
                ],
                'references' => ['design-responsivo', 'componentes', 'interacoes-animacoes'],
                'areas' => ['builder'],
            ],
            [
                'id' => 'design-responsivo',
                'code' => 'KDY-BLD-120',
                'group' => 'Builder',
                'title' => 'Ajustar layout, estilo e responsividade',
                'time' => '10–30 min',
                'level' => 'Intermediário',
                'purpose' => 'Controlar tamanho, espaçamento, posição, tipografia e variações entre breakpoints.',
                'keywords' => 'design responsivo breakpoint width fill fit relative fixed spacing padding margin variável',
                'prerequisites' => [
                    'Selecione o elemento e identifique seu contêiner pai.',
                    'Confirme a classe e o breakpoint ativos.',
                ],
                'steps' => [
                    ['Ajuste a estrutura primeiro', 'Defina display, direção, alinhamento e gap no elemento pai antes de corrigir cada filho.'],
                    ['Defina o tamanho', 'Use Fit para conteúdo, Fill para ocupar o espaço disponível e Fixed somente quando o valor precisa ser rígido.'],
                    ['Ajuste o espaçamento', 'Use o diagrama de spacing para margin externo e padding interno. Evite corrigir alinhamento com margens arbitrárias.'],
                    ['Aplique tipografia e aparência', 'Defina fonte, peso, tamanho, line-height, cor, fundo, borda e radius.'],
                    ['Crie overrides menores', 'Ajuste tablet e mobile somente onde o layout base não funciona.'],
                    ['Conecte variáveis quando o valor for compartilhado', 'Use tokens para cores, tamanhos, números e fontes que precisam mudar em vários locais.'],
                ],
                'expected' => [
                    'O layout se adapta sem scroll horizontal acidental.',
                    'O breakpoint menor contém apenas as substituições necessárias.',
                    'Campos conectados a variáveis ficam bloqueados para edição individual.',
                ],
                'errors' => [
                    ['Width muda sozinho para Fill', 'O elemento encostou nos limites do pai ou uma regra de layout controla sua largura.'],
                    ['A fonte parece serifada', 'A família do projeto não carregou ou o peso solicitado não existe.'],
                    ['A imagem estica', 'Width e height foram animados ou ajustados sem preservar a proporção.'],
                ],
                'troubleshooting' => [
                    'Remova primeiro o override do breakpoint e teste o estilo base.',
                    'Verifique overflow, min/max width e posição absoluta no pai.',
                    'Para imagens, use object-fit e preserve a razão entre largura e altura.',
                ],
                'references' => ['builder', 'midias', 'componentes'],
                'areas' => ['builder'],
            ],
            [
                'id' => 'paginas',
                'code' => 'KDY-PAGE-130',
                'group' => 'Builder',
                'title' => 'Criar páginas, rotas e links',
                'time' => '10–20 min',
                'level' => 'Inicial',
                'purpose' => 'Criar uma página, definir sua URL e manter a navegação interna válida.',
                'keywords' => 'página rota slug url link renomear home 404 navegação',
                'prerequisites' => [
                    'Defina uma página inicial para o projeto.',
                    'Confirme o slug público da página.',
                ],
                'steps' => [
                    ['Crie ou duplique a página', 'Use uma página vazia para estrutura nova ou duplique uma página semelhante para preservar padrões.'],
                    ['Defina nome e slug', 'Use um nome legível e um slug curto. Não inclua o domínio no slug.'],
                    ['Renomeie com cuidado', 'Dê duplo clique no nome da página. Confirme com Enter ou cancele com Esc. O Onun Kodety refatora links internos; URLs externas não são alteradas.'],
                    ['Atualize a navegação', 'Aponte menus e botões para a página do projeto, não para uma cópia manual da URL.'],
                    ['Teste a rota publicada', 'Abra a URL diretamente e depois navegue até ela por um link interno.'],
                ],
                'expected' => [
                    'A página abre por acesso direto e pela navegação.',
                    'Links internos continuam válidos depois de renomear.',
                    'Canonical e sitemap usam a URL configurada.',
                ],
                'errors' => [
                    ['A página retorna 404', 'O slug não foi publicado ou os links permanentes precisam ser atualizados.'],
                    ['O menu abre uma URL antiga', 'O link foi inserido como URL externa e não foi refatorado.'],
                ],
                'troubleshooting' => [
                    'Confirme o slug da página no projeto.',
                    'Salve novamente os links permanentes se a rota publicada continuar em 404.',
                    'Crie um redirect para URLs antigas que já recebem tráfego.',
                ],
                'references' => ['seo', 'publicacao'],
                'areas' => ['builder', 'pages', 'permalinks'],
            ],
            [
                'id' => 'componentes',
                'code' => 'KDY-CMP-200',
                'group' => 'Builder',
                'title' => 'Criar Code Components',
                'time' => '15–45 min',
                'level' => 'Avançado',
                'purpose' => 'Executar componentes de código com propriedades editáveis.',
                'keywords' => 'props code component react typescript',
                'prerequisites' => [
                    'Inclua manifesto, versão e controles válidos.',
                ],
                'steps' => [
                    ['Crie a fonte', 'Implemente ou importe o pacote do componente em React/TypeScript.'],
                    ['Exponha somente propriedades úteis', 'Crie controles para texto, imagem, link, estado ou número que cada instância precisa alterar.'],
                    ['Teste uma segunda instância', 'Altere uma propriedade na cópia. Confirme que a estrutura comum permanece sincronizada.'],
                    ['Teste no canvas e publicado', 'Confirme o carregamento de dependências e assets nos dois runtimes.'],
                ],
                'expected' => [
                    'As propriedades expostas mudam somente a instância.',
                    'O Code Component aparece no canvas e no site publicado.',
                ],
                'errors' => [
                    ['O componente aparece publicado, mas não no canvas', 'O runtime do editor não resolveu o módulo ou um asset do componente.'],
                    ['Uma propriedade não aparece', 'O manifesto não declara o controle ou usa um tipo incompatível.'],
                ],
                'troubleshooting' => [
                    'Abra Settings e confirme a versão e os controles reconhecidos.',
                    'Verifique o console e a árvore de Assets para arquivos 404.',
                    'Teste o componente sem dados dinâmicos para isolar o runtime.',
                ],
                'references' => ['builder', 'cms', 'midias'],
                'areas' => ['builder'],
            ],
            [
                'id' => 'interacoes-animacoes',
                'code' => 'KDY-IX-220',
                'group' => 'Builder',
                'title' => 'Criar e revisar uma interação',
                'time' => '15–40 min',
                'level' => 'Avançado',
                'purpose' => 'Definir um gatilho, montar a timeline e conferir o estado do elemento antes, durante e depois da animação.',
                'keywords' => 'interação animação timeline click hover mouse move page load scroll custom event gsap',
                'prerequisites' => [
                    'Selecione o elemento que inicia ou recebe a interação.',
                    'Defina o estado visual normal antes de abrir a timeline.',
                ],
                'steps' => [
                    ['Escolha o gatilho', 'Use Click, Hover, Mouse move, Page load, Scroll ou Custom event conforme a ação do visitante.'],
                    ['Defina o alvo', 'Escolha Element, Class ou Selector. Use o menor escopo que atende ao efeito.'],
                    ['Adicione uma ação', 'Use Animate para interpolar, Set para aplicar imediatamente, Variable para variável CSS, Class para classe, Event para evento e Spline, Lottie ou Rive para players.'],
                    ['Defina início e fim', 'Informe valores de De e Para. Use porcentagem quando a propriedade permitir. Valores decimais como 1.24 e 1.55 são aceitos.'],
                    ['Ajuste o tempo', 'Defina duração, início, easing, repetição e intervalo. Arraste o playhead para inspecionar qualquer ponto.'],
                    ['Valide os estados externos', 'Antes do bloco, o alvo deve usar o valor De. Depois do bloco, deve manter o valor Para até outra ação alterá-lo.'],
                    ['Teste no Preview', 'Execute o gatilho várias vezes e confirme reset, direção, proporção de scale e comportamento responsivo.'],
                ],
                'expected' => [
                    'A interação aparece ao selecionar o elemento relacionado.',
                    'O playhead permanece no ponto escolhido até você mover, reproduzir ou fechar a timeline.',
                    'Scale preserva a proporção do elemento.',
                ],
                'errors' => [
                    ['O playhead volta sozinho', 'Uma atualização do canvas reaplicou o estado estático.'],
                    ['O elemento salta antes da ação', 'O valor inicial não foi aplicado fora da faixa ativa.'],
                    ['A imagem deforma com Scale', 'Os eixos foram tratados como dimensões independentes.'],
                ],
                'troubleshooting' => [
                    'Pare a reprodução e arraste o playhead antes de editar propriedades.',
                    'Confirme que as ações sobrepostas não escrevem a mesma propriedade.',
                    'Remova temporariamente a segunda ação para testar o estado inicial e final da primeira.',
                ],
                'references' => ['builder', 'design-responsivo', 'problemas'],
                'areas' => ['builder'],
            ],
            [
                'id' => 'cms',
                'code' => 'KDY-CMS-300',
                'group' => 'Conteúdo',
                'title' => 'Criar uma collection e exibir conteúdo dinâmico',
                'time' => '20–45 min',
                'level' => 'Intermediário',
                'purpose' => 'Modelar conteúdo repetível, cadastrar itens e conectar campos aos elementos do Builder.',
                'keywords' => 'cms collection campo item binding lista template csv formulário',
                'prerequisites' => [
                    'Liste os dados que cada item precisa ter.',
                    'Use nomes de campo estáveis antes de criar muitos itens.',
                ],
                'steps' => [
                    ['Crie a collection', 'Use um nome singular claro, como Projeto, Artigo ou Pessoa. Defina o slug.'],
                    ['Crie os campos', 'Escolha o tipo correto para texto, rich text, imagem, data, número, cor, toggle, link ou referência.'],
                    ['Cadastre um item de teste', 'Preencha todos os campos e salve como publicado para validar o modelo.'],
                    ['Insira uma Collection List', 'No Builder, adicione a lista e selecione a collection. Configure filtro, ordem e limite.'],
                    ['Conecte os campos', 'Selecione um elemento e conecte conteúdo, src, href, alt ou title ao campo compatível.'],
                    ['Crie o template de item', 'Use uma página dinâmica quando cada registro precisar de URL própria.'],
                    ['Teste um segundo item', 'Cadastre conteúdo com tamanho diferente para verificar quebra de texto e altura do layout.'],
                ],
                'expected' => [
                    'A lista repete o layout para os itens publicados.',
                    'Cada binding usa um campo compatível.',
                    'O conteúdo e as configurações permanecem vinculados ao projeto atual.',
                ],
                'errors' => [
                    ['A lista fica vazia', 'Os itens estão em rascunho, o filtro não encontra resultados ou a collection está errada.'],
                    ['O campo não aparece para conectar', 'O tipo do campo não é compatível com a propriedade selecionada.'],
                ],
                'troubleshooting' => [
                    'Remova filtros e limite para confirmar se a fonte tem itens.',
                    'Abra o item e confirme o estado Publicado.',
                    'Teste o binding com um campo simples antes de usar referência ou rich text.',
                ],
                'references' => ['formularios', 'seo', 'componentes'],
                'areas' => ['cms', 'cms_new', 'builder'],
            ],
            [
                'id' => 'midias',
                'code' => 'KDY-AST-320',
                'group' => 'Conteúdo',
                'title' => 'Usar imagens, fontes e outros arquivos',
                'time' => '10–25 min',
                'level' => 'Inicial',
                'purpose' => 'Enviar assets, aplicar metadados e garantir que canvas e publicação resolvam os mesmos arquivos.',
                'keywords' => 'mídia asset imagem vídeo fonte woff ttf alt upload caminho 404',
                'prerequisites' => [
                    'Use formatos adequados para web.',
                    'Conheça a licença da fonte ou imagem enviada.',
                ],
                'steps' => [
                    ['Envie o arquivo', 'Use Mídias ou Assets do projeto. Para fontes, envie WOFF2, WOFF, TTF ou OTF.'],
                    ['Preencha os metadados', 'Defina título e texto alternativo para imagens de conteúdo. Deixe alt vazio somente quando a imagem for decorativa.'],
                    ['Aplique o asset', 'Selecione o elemento no Builder e escolha o arquivo. Evite colar caminhos locais do computador.'],
                    ['Configure a fonte', 'Escolha a família reconhecida e o peso disponível. Defina uma pilha de fallback sans-serif coerente.'],
                    ['Teste canvas e publicação', 'Confirme que a mesma URL funciona no editor, Preview e endereço público.'],
                ],
                'expected' => [
                    'O arquivo aparece na biblioteca e na árvore de Assets.',
                    'A fonte usa nome e peso consistentes no seletor.',
                    'URLs publicadas respeitam o prefixo do projeto.',
                ],
                'errors' => [
                    ['A fonte vira serifada', 'O @font-face não carregou, o nome interno diverge ou o peso solicitado não existe.'],
                    ['A imagem quebra apenas publicada', 'A URL foi tratada como raiz do domínio e perdeu o prefixo do projeto.'],
                ],
                'troubleshooting' => [
                    'Abra a URL do arquivo diretamente e confira o status HTTP.',
                    'Compare o nome declarado em font-family com a família exibida pelo arquivo.',
                    'Prefira referências relativas ao projeto para assets importados.',
                ],
                'references' => ['projeto-importacao', 'design-responsivo'],
                'areas' => ['media', 'builder'],
            ],
            [
                'id' => 'formularios',
                'code' => 'KDY-FRM-400',
                'group' => 'Relacionamento',
                'title' => 'Criar um formulário e enviar dados ao CMS',
                'time' => '15–35 min',
                'level' => 'Intermediário',
                'purpose' => 'Capturar dados, registrar uma mensagem e, quando necessário, criar ou atualizar um item do CMS.',
                'keywords' => 'formulário form email envio cms collection campo webhook lead',
                'prerequisites' => [
                    'Crie a collection e os campos antes de mapear um formulário para o CMS.',
                    'Defina quais campos são obrigatórios e qual mensagem aparece após o envio.',
                ],
                'steps' => [
                    ['Insira o Form Block', 'Adicione labels, inputs e um botão de envio. Use nomes de campo únicos.'],
                    ['Configure o destino padrão', 'Defina a caixa de Emails, o destinatário e as mensagens de sucesso e erro.'],
                    ['Ative a ação do CMS', 'Selecione a collection e escolha se o envio cria ou atualiza um item.'],
                    ['Mapeie os campos', 'Conecte cada campo do formulário a um campo compatível da collection.'],
                    ['Defina o estado do item', 'Use rascunho quando o conteúdo precisar de revisão. Publique automaticamente somente dados confiáveis.'],
                    ['Teste na página publicada', 'Envie valores reais de teste. Confirme a mensagem, o registro em Emails e o item do CMS.'],
                ],
                'expected' => [
                    'O envio aparece em Emails.',
                    'O item do CMS recebe os campos mapeados.',
                    'Falhas externas não apagam o registro principal do envio.',
                ],
                'errors' => [
                    ['O email chega, mas o CMS não atualiza', 'O mapeamento usa campo incompatível ou a collection não existe no projeto.'],
                    ['O botão não envia', 'Um campo obrigatório está vazio ou o runtime do formulário foi bloqueado.'],
                ],
                'troubleshooting' => [
                    'Teste primeiro sem webhook ou integração externa.',
                    'Confirme os nomes dos campos no formulário e no mapeamento.',
                    'Revise o registro em Emails antes de testar a notificação.',
                ],
                'references' => ['cms', 'marketing', 'problemas'],
                'areas' => ['builder', 'emails', 'email_settings'],
            ],
            [
                'id' => 'membros-vendas',
                'code' => 'KDY-MBR-420',
                'group' => 'Relacionamento',
                'title' => 'Proteger conteúdo para membros',
                'time' => '20–60 min',
                'level' => 'Avançado',
                'purpose' => 'Ativar a extensão Membership, criar acesso e validar a experiência de visitante e membro.',
                'keywords' => 'membership membros login cadastro plano acesso checkout pagamento',
                'prerequisites' => [
                    'Ative a extensão Onun Kodety Membership. Ela permanece desativada por padrão.',
                    'Crie pelo menos um plano se o acesso depender de compra ou assinatura.',
                ],
                'steps' => [
                    ['Ative Membership', 'Abra Extensões e ative Onun Kodety Membership. A área de membros é habilitada automaticamente.'],
                    ['Insira os elementos de conta', 'Adicione login, cadastro, recuperação de senha, perfil e logout onde forem necessários.'],
                    ['Defina a regra de acesso', 'Proteja a página ou o elemento para visitantes, membros logados ou um plano específico.'],
                    ['Configure o pagamento opcional', 'Conecte o provedor, mapeie o produto e defina as URLs de retorno.'],
                    ['Teste os estados', 'Use Preview de política e depois teste uma conta real em janela anônima.'],
                    ['Revise revogação e cancelamento', 'Confirme o que ocorre quando a assinatura expira ou o acesso é removido.'],
                ],
                'expected' => [
                    'Visitantes veem login ou oferta conforme a regra.',
                    'Membros autorizados veem o conteúdo protegido.',
                    'O provedor atualiza o acesso por webhook quando configurado.',
                ],
                'errors' => [
                    ['A área de membros não aparece', 'A extensão está desativada para o projeto.'],
                    ['O pagamento conclui sem liberar acesso', 'O produto do provedor não está mapeado para o plano correto.'],
                ],
                'troubleshooting' => [
                    'Confirme a extensão e o projeto ativos.',
                    'Teste a regra com concessão manual antes de testar checkout.',
                    'Verifique o evento do webhook e o identificador do produto.',
                ],
                'references' => ['formularios', 'publicacao', 'usuarios-seguranca'],
                'areas' => ['extensions', 'members', 'builder'],
            ],
            [
                'id' => 'marketing',
                'code' => 'KDY-MKT-440',
                'group' => 'Relacionamento',
                'title' => 'Criar e enviar uma campanha',
                'time' => '25–60 min',
                'level' => 'Intermediário',
                'purpose' => 'Preparar contatos, template, remetente e audiência para um envio rastreável.',
                'keywords' => 'marketing campanha email lista contato template dkim spf entrega',
                'prerequisites' => [
                    'Configure um transporte de email funcional.',
                    'Autentique o domínio com SPF e DKIM.',
                    'Use somente contatos com base legal ou consentimento aplicável.',
                ],
                'steps' => [
                    ['Prepare a audiência', 'Importe ou cadastre contatos. Organize-os em uma lista. Remova endereços inválidos e descadastrados.'],
                    ['Crie o template', 'Use o editor visual. Inclua conteúdo, identificação do remetente e link de descadastro.'],
                    ['Envie um teste', 'Confira desktop, mobile, links, versão em texto e variáveis de personalização.'],
                    ['Crie a campanha', 'Defina assunto, remetente, template e lista. Revise a quantidade de destinatários.'],
                    ['Envie ou agende', 'Escolha o horário e confirme. Não repita a ação enquanto a campanha estiver na fila.'],
                    ['Acompanhe a entrega', 'Revise entregas, aberturas, cliques, descadastros, bounces e falhas.'],
                ],
                'expected' => [
                    'A campanha entra na fila uma única vez.',
                    'Os contatos recebem a versão compatível com seu cliente de email.',
                    'Falhas e descadastros atualizam a audiência.',
                ],
                'errors' => [
                    ['Muitos emails caem no spam', 'O domínio não está autenticado, a reputação é baixa ou o conteúdo é suspeito.'],
                    ['A campanha não sai da fila', 'O processador agendado ou o transporte não está funcionando.'],
                ],
                'troubleshooting' => [
                    'Abra Saúde de entrega antes de reenviar.',
                    'Teste o transporte com um único destinatário.',
                    'Não duplique a campanha enquanto o estado do lote estiver pendente.',
                ],
                'references' => ['formularios', 'analytics', 'usuarios-seguranca'],
                'areas' => ['contacts', 'email_templates', 'campaigns', 'delivery_health'],
            ],
            [
                'id' => 'seo',
                'code' => 'KDY-SEO-500',
                'group' => 'Descoberta',
                'title' => 'Configurar SEO, imagem social e redirects',
                'time' => '15–40 min',
                'level' => 'Intermediário',
                'purpose' => 'Definir como páginas aparecem em busca, compartilhamento e URLs antigas.',
                'keywords' => 'seo título descrição canonical sitemap robots social image redirect 301',
                'prerequisites' => [
                    'Defina a URL final de cada página.',
                    'Prepare uma imagem social quando a página precisar de compartilhamento próprio.',
                ],
                'steps' => [
                    ['Defina o SEO geral', 'Informe nome do site, título padrão, descrição, favicon e imagem social padrão.'],
                    ['Revise cada página', 'Defina título, descrição, canonical, indexação e inclusão no sitemap.'],
                    ['Configure páginas CMS', 'Use campos dinâmicos para título, descrição, imagem e slug quando o template gerar várias URLs.'],
                    ['Revise a prévia', 'Confirme corte de título, descrição e imagem nas prévias de busca e compartilhamento.'],
                    ['Crie redirects necessários', 'Use 301 para mudança permanente e 302 ou 307 para mudança temporária. Evite cadeias.'],
                    ['Publique e teste', 'Abra canonical, sitemap, imagem social e as URLs antiga e nova.'],
                ],
                'expected' => [
                    'Cada página tem título e descrição próprios.',
                    'A URL antiga redireciona diretamente para o destino final.',
                    'A imagem social publicada usa o template e as fontes do projeto.',
                ],
                'errors' => [
                    ['A prévia mostra dados antigos', 'A página não foi publicada ou a rede social mantém cache.'],
                    ['O redirect entra em loop', 'Origem e destino resolvem para a mesma rota.'],
                ],
                'troubleshooting' => [
                    'Teste o redirect em janela anônima e observe a URL final.',
                    'Confirme que canonical usa o domínio e o prefixo do projeto corretos.',
                    'Gere novamente a imagem social depois de corrigir fontes ou conteúdo.',
                ],
                'references' => ['paginas', 'idiomas', 'publicacao'],
                'areas' => ['settings', 'builder'],
            ],
            [
                'id' => 'idiomas',
                'code' => 'KDY-L10N-520',
                'group' => 'Descoberta',
                'title' => 'Publicar outro idioma',
                'time' => '20–60 min',
                'level' => 'Intermediário',
                'purpose' => 'Criar um locale, traduzir conteúdo e publicar URLs com canonical e hreflang corretos.',
                'keywords' => 'idioma tradução locale hreflang fallback url localizada',
                'prerequisites' => [
                    'Defina o idioma fonte e o idioma padrão.',
                    'Conclua a estrutura das páginas antes de traduzir grandes volumes.',
                ],
                'steps' => [
                    ['Adicione o locale', 'Escolha o código e defina se ele será publicado.'],
                    ['Defina a estratégia de URL', 'Use um prefixo claro e estável para cada idioma.'],
                    ['Traduza conteúdo e rotas', 'Preencha textos, SEO e slugs. Use rascunhos de IA somente como ponto de partida.'],
                    ['Revise o fallback', 'Decida se valores vazios mostram o idioma fonte ou permanecem vazios.'],
                    ['Confira cobertura', 'Filtre pendências e revise conteúdos longos, menus e componentes.'],
                    ['Publique e teste', 'Alterne o idioma, abra URLs diretas e confira canonical e hreflang.'],
                ],
                'expected' => [
                    'Cada locale publicado tem URL própria.',
                    'O alternador mantém a página equivalente quando possível.',
                    'Busca e compartilhamento usam o conteúdo do locale.',
                ],
                'errors' => [
                    ['Parte da página volta ao idioma fonte', 'O campo traduzido está vazio e o fallback está ativo.'],
                    ['O alternador abre a Home', 'A página atual não tem rota equivalente publicada no outro locale.'],
                ],
                'troubleshooting' => [
                    'Use o filtro de pendências para localizar valores vazios.',
                    'Confirme o slug traduzido e o estado Publicado.',
                    'Revise componentes compartilhados e campos do CMS separadamente.',
                ],
                'references' => ['seo', 'cms', 'publicacao'],
                'areas' => ['localization', 'settings'],
            ],
            [
                'id' => 'analytics',
                'code' => 'KDY-ANL-600',
                'group' => 'Medição',
                'title' => 'Medir eventos, funis e testes A/B',
                'time' => '20–45 min',
                'level' => 'Intermediário',
                'purpose' => 'Coletar comportamento de visitantes e analisar uma jornada ou experimento do projeto.',
                'keywords' => 'analytics evento meta conversão funil teste ab visão página scroll',
                'prerequisites' => [
                    'Publique as páginas que participarão da medição.',
                    'Defina uma ação observável para cada etapa ou conversão.',
                ],
                'steps' => [
                    ['Confirme a coleta', 'Abra a Visão geral e gere uma visita de teste em janela anônima.'],
                    ['Defina eventos e metas', 'Use nomes estáveis. Evite criar eventos diferentes para a mesma ação.'],
                    ['Monte o funil', 'Ordene páginas ou eventos na sequência real do usuário e defina a janela.'],
                    ['Importe ou exporte quando necessário', 'O arquivo .kodety-funnel.json leva etapas, conexões, filtros e canvas. Todo funil importado abre pausado como rascunho para você revisar páginas, Tracking IDs, testes e listas antes de salvar.'],
                    ['Crie o teste A/B', 'Defina variante, distribuição, público e métrica principal antes de iniciar.'],
                    ['Use a Visão de página', 'Filtre período e dispositivo. Compare cliques, dobra média e profundidade de scroll sobre a página publicada.'],
                    ['Interprete com volume suficiente', 'Não encerre um teste por uma diferença inicial pequena. Registre a decisão.'],
                ],
                'expected' => [
                    'Pageviews e eventos aparecem no projeto correto.',
                    'O funil mostra entrada, avanço e abandono por etapa.',
                    'Funis podem ser transferidos entre projetos sem copiar resultados, IDs internos ou datas.',
                    'Testes, funis e configurações permanecem vinculados ao projeto atual.',
                ],
                'errors' => [
                    ['A visita não aparece', 'Consentimento, Do Not Track, cache ou bloqueador impediu a coleta.'],
                    ['O funil mostra zero', 'O evento ou a rota da etapa não corresponde ao dado coletado.'],
                ],
                'troubleshooting' => [
                    'Teste primeiro sem filtros de período ou dispositivo.',
                    'Abra Eventos e confirme o nome exato recebido.',
                    'Confirme o projeto selecionado antes de editar funis ou testes.',
                ],
                'references' => ['formularios', 'seo'],
                'areas' => ['analytics'],
            ],
            [
                'id' => 'publicacao',
                'code' => 'KDY-PUB-700',
                'group' => 'Publicação',
                'title' => 'Publicar, verificar e restaurar uma release',
                'time' => '10–25 min',
                'level' => 'Intermediário',
                'purpose' => 'Criar uma release, verificar o site publicado e recuperar uma versão estável quando necessário.',
                'keywords' => 'publicar publish release versão rollback restaurar preview build',
                'prerequisites' => [
                    'Confirme que o Preview funciona em desktop e mobile.',
                    'Teste formulários, login, checkout e rotas críticas.',
                    'Mantenha uma release anterior saudável para rollback.',
                ],
                'steps' => [
                    ['Revise o projeto', 'Confirme nome, rotas e Preview antes de publicar.'],
                    ['Abra o Preview', 'Teste a página inicial, uma página interna e uma ação importante.'],
                    ['Inicie a publicação', 'Clique em Publicar. O Onun Kodety prepara arquivos, executa o build quando necessário e envia a release ao WordPress.'],
                    ['Espere a confirmação', 'Não repita o clique durante o processamento. Espere o identificador da nova release.'],
                    ['Verifique como visitante', 'Abra a URL pública em nova aba. Faça uma atualização completa e execute o teste crítico.'],
                    ['Restaure se necessário', 'Se houver falha grave, selecione uma release anterior saudável e confirme o rollback.'],
                ],
                'expected' => [
                    'A nova release aparece como ativa.',
                    'O site público entrega os arquivos e assets do projeto correto.',
                    'O rollback restaura a versão escolhida sem alterar a release armazenada.',
                ],
                'errors' => [
                    ['A publicação para durante o build', 'O projeto contém erro de compilação ou dependência ausente.'],
                    ['O site antigo continua visível', 'A release não foi ativada ou uma camada de cache ainda entrega a versão anterior.'],
                ],
                'troubleshooting' => [
                    'Leia o estágio que falhou antes de tentar novamente.',
                    'Confira a release ativa no Projeto do site.',
                    'Restaure a versão anterior se o erro afetar visitantes.',
                ],
                'references' => ['projeto-importacao', 'problemas', 'usuarios-seguranca'],
                'areas' => ['builder', 'project', 'optimizations', 'site'],
            ],
            [
                'id' => 'usuarios-seguranca',
                'code' => 'KDY-SEC-800',
                'group' => 'Administração',
                'title' => 'Controlar acesso e manter o site',
                'time' => '15–30 min',
                'level' => 'Intermediário',
                'purpose' => 'Dar o menor acesso necessário, proteger o painel e manter atualizações recuperáveis.',
                'keywords' => 'usuário permissão segurança backup atualização login sessão plugin',
                'prerequisites' => [
                    'Use uma conta individual para cada pessoa.',
                    'Tenha acesso ao backup e ao wp-config.php antes de alterar o login administrativo.',
                ],
                'steps' => [
                    ['Revise as funções', 'Dê acesso ao Builder, CMS, Analytics ou administração somente quando a pessoa precisar.'],
                    ['Proteja o login', 'Configure limite de tentativas e, se usar slug privado, teste o novo endereço em janela anônima sem encerrar a sessão atual.'],
                    ['Revise sessões e integrações', 'Defina duração de sessão e mantenha XML-RPC ou senhas de aplicativo somente quando uma integração exigir.'],
                    ['Aplique cabeçalhos com cuidado', 'Teste embeds, câmera, microfone e geolocalização depois de alterar Permissions-Policy, iframe ou HSTS.'],
                    ['Atualize com backup', 'Faça backup, atualize um grupo por vez e teste o fluxo crítico depois de cada mudança.'],
                    ['Remova acessos antigos', 'Revogue usuários, credenciais e conexões que não são mais usados.'],
                ],
                'expected' => [
                    'Cada usuário vê somente as áreas permitidas.',
                    'O login administrativo permanece acessível pelo endereço esperado.',
                    'Atualizações não removem projetos nem configurações.',
                ],
                'errors' => [
                    ['O novo login não abre', 'O slug foi digitado errado ou outra regra de segurança bloqueia a rota.'],
                    ['Uma integração parou', 'XML-RPC, REST, senha de aplicativo ou permissão necessária foi desativada.'],
                ],
                'troubleshooting' => [
                    'Use KODETY_DISABLE_ADMIN_SLUG no wp-config.php para recuperar o login padrão quando necessário.',
                    'Reative somente o recurso exigido pela integração.',
                    'Restaure o backup se uma atualização causar erro crítico.',
                ],
                'references' => ['publicacao', 'membros-vendas', 'marketing'],
                'areas' => ['users', 'security', 'updates', 'plugins'],
            ],
            [
                'id' => 'mcp-ia',
                'code' => 'KDY-MCP-850',
                'group' => 'Administração',
                'title' => 'Conectar uma IA ao projeto com MCP',
                'time' => '5–15 min',
                'level' => 'Intermediário',
                'purpose' => 'Criar uma credencial independente para o projeto aberto e limitar a IA ao workspace atual.',
                'keywords' => 'mcp ia codex conexão token projeto copiar credencial builder',
                'prerequisites' => [
                    'Entre como administrador.',
                    'Abra no Builder o projeto que a IA deverá editar.',
                    'Use uma IA compatível com MCP remoto por Streamable HTTP.',
                ],
                'steps' => [
                    ['Confirme o projeto alvo', 'Confira o nome do projeto aberto antes de criar a conexão.'],
                    ['Abra o menu MCP', 'Clique no ícone de cabo da topbar. O menu mostra o estado do servidor e o projeto que receberá as alterações.'],
                    ['Copie uma conexão deste projeto', 'Clique em Copiar conexão deste projeto. O Onun Kodety cria uma credencial nova, independente das anteriores, e copia a configuração JSON uma única vez.'],
                    ['Cole na IA', 'Envie a configuração somente para o cliente MCP escolhido. A credencial é secreta e não deve ser gravada no projeto, em commits ou mensagens públicas.'],
                    ['Confirme pela IA', 'Antes de editar, peça para a IA chamar kodety_get_site e conferir target, connectionScope e workspaceRevision.'],
                    ['Mantenha o projeto aberto', 'A conexão vinculada funciona somente enquanto esse projeto estiver ativo. Se outro projeto for aberto, o MCP responde com conflito 409 sem gravar no destino errado.'],
                    ['Revogue quando necessário', 'Abra Configurar MCP. Desativar todas as conexões revoga a conexão geral e todas as credenciais vinculadas a projetos.'],
                ],
                'expected' => [
                    'O menu MCP mostra o mesmo projeto aberto no Builder.',
                    'Cada cópia gera uma credencial diferente sem invalidar as conexões existentes.',
                    'A IA recebe o projeto alvo e a revisão atual em kodety_get_site.',
                    'Trocar de projeto bloqueia a credencial vinculada antes de qualquer edição.',
                ],
                'errors' => [
                    ['A cópia é recusada', 'Nenhum projeto válido está aberto, a conta não é administradora ou o MCP está indisponível em multisite.'],
                    ['A IA recebe conflito 409', 'A conexão pertence a outro projeto. Abra novamente o projeto indicado e repita a leitura antes de editar.'],
                    ['A configuração foi perdida', 'A credencial em texto puro é exibida somente na cópia inicial. Gere outra conexão; as anteriores continuam válidas.'],
                ],
                'troubleshooting' => [
                    'Compare target.agencyProjectId com o projeto aberto no Dashboard.',
                    'Chame kodety_get_site novamente depois de recarregar ou trocar de projeto.',
                    'Use Configurar MCP para desativar todas as conexões se uma credencial tiver sido exposta.',
                ],
                'references' => ['builder', 'usuarios-seguranca'],
                'areas' => ['codex', 'builder', 'settings'],
            ],
            [
                'id' => 'problemas',
                'code' => 'KDY-TS-900',
                'group' => 'Suporte',
                'title' => 'Diagnosticar uma falha sem perder trabalho',
                'time' => '5–30 min',
                'level' => 'Todos',
                'purpose' => 'Identificar em qual camada o erro acontece e aplicar a correção de menor risco.',
                'keywords' => 'erro problema não atualiza quebrado 404 tela branca cache diagnóstico',
                'prerequisites' => [
                    'Anote a página, o projeto e o horário aproximado do erro.',
                    'Não publique novamente até identificar se o Preview também falha.',
                ],
                'steps' => [
                    ['Reproduza uma vez', 'Registre a sequência exata. Não faça várias correções ao mesmo tempo.'],
                    ['Localize a camada', 'Compare painel, canvas, Preview e site publicado. Marque o primeiro ponto em que o resultado fica errado.'],
                    ['Reduza o caso', 'Teste uma página, um elemento, um breakpoint ou uma integração por vez.'],
                    ['Verifique estado e escopo', 'Confirme projeto, locale, breakpoint, classe, collection, release e permissões.'],
                    ['Aplique a menor correção', 'Corrija a causa observada. Evite limpar tudo, reinstalar ou substituir o projeto sem evidência.'],
                    ['Valide e documente', 'Repita o fluxo original e registre a correção. Faça rollback se o público continuar afetado.'],
                ],
                'expected' => [
                    'O erro pode ser reproduzido ou descartado com passos claros.',
                    'A causa fica associada a uma camada específica.',
                    'A correção não remove dados não relacionados.',
                ],
                'errors' => [
                    ['Canvas correto, Preview errado', 'Runtime, script ou interação falha fora do modo de edição.'],
                    ['Preview correto, publicado errado', 'Build, caminho de asset, prefixo do projeto, cache ou release está incorreto.'],
                    ['Painel e canvas discordam', 'Estado antigo ou regra de estilo com maior prioridade venceu a edição.'],
                ],
                'troubleshooting' => [
                    'Para 404, revise slug, prefixo do projeto e links permanentes.',
                    'Para asset ausente, abra a URL do arquivo e compare o caminho real.',
                    'Para CMS vazio, remova filtros e confirme itens publicados.',
                    'Para formulário, confira primeiro o registro em Emails e depois a notificação.',
                ],
                'references' => ['builder', 'projeto-importacao', 'publicacao'],
                'areas' => ['dashboard', 'builder', 'project'],
            ],
            [
                'id' => 'referencia',
                'code' => 'KDY-REF-990',
                'group' => 'Suporte',
                'title' => 'Referência rápida do Onun Kodety',
                'time' => 'Consulta',
                'level' => 'Todos',
                'purpose' => 'Localizar termos, atalhos e diferenças importantes sem executar um procedimento completo.',
                'keywords' => 'referência glossário atalhos comando diferença salvar publicar termos',
                'prerequisites' => ['Nenhum. Use este módulo durante qualquer procedimento.'],
                'steps' => [
                    ['Abra o Insert', 'Use Command + K no macOS ou Ctrl + K no Windows e Linux.'],
                    ['Desfaça', 'Use Command + Z no macOS ou Ctrl + Z no Windows e Linux.'],
                    ['Refaça', 'Use Command + Shift + Z no macOS ou Ctrl + Shift + Z no Windows e Linux.'],
                    ['Duplique', 'Use Command + D no macOS ou Ctrl + D no Windows e Linux.'],
                    ['Exclua', 'Use Delete ou Backspace quando o foco não estiver em um campo de texto.'],
                ],
                'expected' => [
                    'Salvar preserva o workspace editável.',
                    'Preview executa o projeto antes da publicação.',
                    'Publicar cria e ativa uma release para visitantes.',
                ],
                'errors' => [
                    ['Um atalho escreve no campo', 'O foco está em um input ou editor de texto.'],
                    ['Uma opção não aparece', 'A extensão está desativada ou a conta não tem permissão.'],
                ],
                'troubleshooting' => [
                    'Clique no canvas antes de usar atalhos de seleção.',
                    'Revise Extensões e a função do usuário quando uma área estiver ausente.',
                ],
                'references' => ['primeiros-passos', 'builder', 'problemas'],
                'areas' => ['builder', 'extensions'],
                'glossary' => [
                    ['Asset', 'Arquivo usado pelo projeto, como imagem, fonte, vídeo, CSS ou JavaScript.'],
                    ['Binding', 'Conexão entre uma propriedade visual e um valor dinâmico.'],
                    ['Breakpoint', 'Faixa de largura em que um conjunto de estilos pode substituir o estilo base.'],
                    ['Canvas', 'Área visual em que a página é selecionada e editada.'],
                    ['Collection', 'Modelo de conteúdo estruturado do CMS.'],
                    ['Override', 'Valor específico que substitui um valor herdado.'],
                    ['Preview', 'Execução do projeto para revisão antes de publicar.'],
                    ['Release', 'Pacote identificado que pode ser ativado no site público.'],
                    ['Rollback', 'Restauração de uma release anterior.'],
                    ['Slug', 'Trecho legível que identifica uma rota ou projeto na URL.'],
                    ['Token', 'Variável reutilizável de design, como cor, tamanho ou fonte.'],
                    ['Webhook', 'Notificação enviada de um sistema para outro quando ocorre um evento.'],
                ],
            ],
        ];
    }

    /**
     * @param array<string, mixed> $module
     * @param array<string, string> $urls
     * @param array<string, string> $titles
     */
    private function render_module(array $module, array $urls, array $titles): void {
        ?>
        <section
            id="<?php echo esc_attr((string) $module['id']); ?>"
            class="kodety-help-section kodety-help-module"
            data-kodety-help-section
            data-search="<?php echo esc_attr((string) $module['keywords']); ?>"
        >
            <header class="kodety-help-module-header">
                <p class="kodety-help-eyebrow"><?php echo esc_html((string) $module['group']); ?></p>
                <h2><?php echo esc_html((string) $module['title']); ?></h2>
                <p class="kodety-help-module-purpose"><?php echo esc_html((string) $module['purpose']); ?></p>
                <dl class="kodety-help-module-meta">
                    <div><dt>Documento</dt><dd><?php echo esc_html((string) $module['code']); ?></dd></div>
                    <div><dt>Nível</dt><dd><?php echo esc_html((string) $module['level']); ?></dd></div>
                    <div><dt>Tempo</dt><dd><?php echo esc_html((string) $module['time']); ?></dd></div>
                    <div><dt>Aplicação</dt><dd>Onun Kodety <?php echo esc_html(KODETY_VERSION); ?></dd></div>
                </dl>
            </header>

            <div class="kodety-help-module-block">
                <h3>Pré-requisitos</h3>
                <ul class="kodety-help-checklist">
                    <?php foreach ($module['prerequisites'] as $item): ?>
                        <li><?php echo esc_html((string) $item); ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>

            <div class="kodety-help-module-block">
                <h3>Procedimento</h3>
                <ol class="kodety-help-steps">
                    <?php foreach ($module['steps'] as $index => [$title, $body]): ?>
                        <li>
                            <div><span><?php echo esc_html((string) ($index + 1)); ?></span></div>
                            <article>
                                <h3><?php echo esc_html((string) $title); ?></h3>
                                <p><?php echo esc_html((string) $body); ?></p>
                            </article>
                        </li>
                    <?php endforeach; ?>
                </ol>
            </div>

            <div class="kodety-help-result">
                <h3>Resultado esperado</h3>
                <ul>
                    <?php foreach ($module['expected'] as $item): ?>
                        <li><?php echo esc_html((string) $item); ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>

            <div class="kodety-help-module-block">
                <h3>Possíveis erros</h3>
                <div class="kodety-help-table-wrap">
                    <table>
                        <thead><tr><th>Sintoma</th><th>Causa provável</th></tr></thead>
                        <tbody>
                            <?php foreach ($module['errors'] as [$symptom, $cause]): ?>
                                <tr>
                                    <td><strong><?php echo esc_html((string) $symptom); ?></strong></td>
                                    <td><?php echo esc_html((string) $cause); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="kodety-help-module-block">
                <h3>Solução de problemas</h3>
                <ol class="kodety-help-diagnostics">
                    <?php foreach ($module['troubleshooting'] as $index => $item): ?>
                        <li>
                            <span><?php echo esc_html((string) ($index + 1)); ?></span>
                            <p><?php echo esc_html((string) $item); ?></p>
                        </li>
                    <?php endforeach; ?>
                </ol>
            </div>

            <?php if (!empty($module['glossary'])): ?>
                <div class="kodety-help-module-block">
                    <h3>Glossário</h3>
                    <dl class="kodety-help-glossary">
                        <?php foreach ($module['glossary'] as [$term, $definition]): ?>
                            <div>
                                <dt><?php echo esc_html((string) $term); ?></dt>
                                <dd><?php echo esc_html((string) $definition); ?></dd>
                            </div>
                        <?php endforeach; ?>
                    </dl>
                </div>
            <?php endif; ?>

            <div class="kodety-help-crossrefs">
                <h3>Referências cruzadas</h3>
                <ul>
                    <?php foreach ($module['references'] as $reference): ?>
                        <li>
                            <a href="#<?php echo esc_attr((string) $reference); ?>">
                                <?php echo esc_html($titles[$reference] ?? (string) $reference); ?>
                            </a>
                        </li>
                    <?php endforeach; ?>
                </ul>
            </div>

            <?php if (!empty($module['areas'])): ?>
                <div class="kodety-help-area-grid" aria-label="Atalhos relacionados">
                    <?php foreach ($module['areas'] as $area): ?>
                        <?php if (!isset($urls[$area])) continue; ?>
                        <a
                            class="kodety-help-area-card"
                            href="<?php echo esc_url($urls[$area]); ?>"
                            <?php echo $area === 'site' ? 'target="_blank" rel="noopener"' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                        >
                            <strong><?php echo esc_html($this->area_label((string) $area)); ?></strong>
                            <span>Abra a área citada neste procedimento.</span>
                            <small>Abrir área</small>
                        </a>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </section>
        <?php
    }

    private function area_label(string $area): string {
        $labels = [
            'dashboard' => 'Dashboard',
            'project' => 'Projeto do site',
            'extensions' => 'Extensões',
            'interface' => 'Interface',
            'project_settings' => 'Configurações do projeto',
            'optimizations' => 'Otimizações',
            'security' => 'Segurança',
            'codex' => 'Integrações e IA',
            'builder' => 'Builder',
            'cms' => 'CMS',
            'cms_new' => 'Novo item do CMS',
            'pages' => 'Páginas',
            'media' => 'Mídias',
            'members' => 'Membros',
            'emails' => 'Emails',
            'email_settings' => 'Configurações de email',
            'campaigns' => 'Campanhas',
            'email_templates' => 'Templates de email',
            'contacts' => 'Contatos',
            'delivery_health' => 'Saúde de entrega',
            'analytics' => 'Analytics',
            'localization' => 'Idiomas',
            'settings' => 'Configurações',
            'users' => 'Usuários',
            'plugins' => 'Plugins',
            'updates' => 'Atualizações',
            'permalinks' => 'Links permanentes',
            'site' => 'Site publicado',
        ];
        return $labels[$area] ?? ucfirst(str_replace('_', ' ', $area));
    }

    /**
     * @return array<string, array<string, string>>
     */
    private function codex_skill_documents(): array {
        return [
            'skill' => [
                'label' => 'Skill',
                'title' => 'Instruções principais',
                'path' => 'SKILL.md',
                'language' => 'Markdown',
                'description' => 'Ponto de entrada que orienta o Codex a construir, auditar e sincronizar sites com o Onun Kodety.',
            ],
            'mcp' => [
                'label' => 'Operação MCP',
                'title' => 'Uso completo do MCP',
                'path' => 'references/mcp-operations.md',
                'language' => 'Markdown',
                'description' => 'Fluxos de leitura, edição, verificação, publicação, recuperação e observabilidade do MCP.',
            ],
            'contract' => [
                'label' => 'Contrato Onun Kodety',
                'title' => 'Contrato de código e importação',
                'path' => 'references/kodety-code-contract.md',
                'language' => 'Markdown',
                'description' => 'Regras de HTML, CSS, seletores, responsividade, componentes, CMS, Interactions e live sync.',
            ],
            'validator' => [
                'label' => 'Validador',
                'title' => 'Validador local',
                'path' => 'scripts/validate-kodety-site.mjs',
                'language' => 'JavaScript',
                'description' => 'Script que identifica incompatibilidades antes de um site ser importado ou enviado ao Builder.',
            ],
            'metadata' => [
                'label' => 'Metadados',
                'title' => 'Metadados da skill',
                'path' => 'agents/openai.yaml',
                'language' => 'YAML',
                'description' => 'Nome, descrição e prompt inicial exibidos pelo Codex ao carregar a skill.',
            ],
        ];
    }

    private function codex_skill_content(string $relative_path): string {
        $root = wp_normalize_path(KODETY_DIR . 'docs/kodety-site-code/');
        $file = wp_normalize_path($root . ltrim($relative_path, '/'));
        if (!str_starts_with($file, $root) || !is_file($file) || !is_readable($file)) {
            return 'Arquivo indisponível nesta instalação do Onun Kodety.';
        }

        $content = file_get_contents($file);
        return is_string($content) ? $content : 'Não foi possível ler este arquivo.';
    }

    private function render_codex_skill_workspace(): void {
        $documents = $this->codex_skill_documents();
        $download_url = add_query_arg(
            ['ver' => KODETY_VERSION],
            KODETY_URL . 'docs/kodety-site-code.zip'
        );
        ?>
        <section
            id="kodety-help-view-skill"
            class="kodety-help-view-panel kodety-help-skill-view"
            data-kodety-help-view-panel="skill"
            role="tabpanel"
            aria-labelledby="kodety-help-tab-skill"
            tabindex="0"
            hidden
        >
            <div class="kodety-help-skill-workspace">
                <header class="kodety-help-skill-header">
                    <div>
                        <p class="kodety-help-eyebrow">Codex · Skill oficial</p>
                        <h1>Onun Kodety Site Code</h1>
                        <p>Leia cada arquivo em uma subaba ou baixe o pacote completo correspondente ao Onun Kodety <?php echo esc_html(KODETY_VERSION); ?>.</p>
                    </div>
                    <a
                        class="kodety-help-button is-primary kodety-help-skill-download"
                        href="<?php echo esc_url($download_url); ?>"
                        download="kodety-site-code.zip"
                    >
                        Baixar arquivos em ZIP
                    </a>
                </header>

                <div class="kodety-help-skill-meta" aria-label="Informações do pacote">
                    <span><?php echo esc_html((string) count($documents)); ?> arquivos</span>
                    <span>Versão <?php echo esc_html(KODETY_VERSION); ?></span>
                    <span>Leitura local e offline</span>
                </div>

                <div class="kodety-help-skill-shell">
                    <div
                        class="kodety-help-skill-tabs"
                        role="tablist"
                        aria-label="Arquivos da Skill Codex"
                        data-kodety-skill-tabs
                    >
                        <?php foreach ($documents as $id => $document): ?>
                            <button
                                id="kodety-skill-tab-<?php echo esc_attr($id); ?>"
                                class="kodety-help-skill-tab"
                                type="button"
                                role="tab"
                                aria-selected="<?php echo $id === 'skill' ? 'true' : 'false'; ?>"
                                aria-controls="kodety-skill-panel-<?php echo esc_attr($id); ?>"
                                tabindex="<?php echo $id === 'skill' ? '0' : '-1'; ?>"
                                data-kodety-skill-tab="<?php echo esc_attr($id); ?>"
                            >
                                <?php echo esc_html($document['label']); ?>
                            </button>
                        <?php endforeach; ?>
                    </div>

                    <div class="kodety-help-skill-documents">
                        <?php foreach ($documents as $id => $document): ?>
                            <?php $content = $this->codex_skill_content($document['path']); ?>
                            <article
                                id="kodety-skill-panel-<?php echo esc_attr($id); ?>"
                                class="kodety-help-skill-document"
                                role="tabpanel"
                                aria-labelledby="kodety-skill-tab-<?php echo esc_attr($id); ?>"
                                data-kodety-skill-panel="<?php echo esc_attr($id); ?>"
                                <?php echo $id === 'skill' ? '' : 'hidden'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                            >
                                <header class="kodety-help-skill-document-header">
                                    <div>
                                        <p><?php echo esc_html($document['path']); ?></p>
                                        <h2><?php echo esc_html($document['title']); ?></h2>
                                        <span><?php echo esc_html($document['description']); ?></span>
                                    </div>
                                    <div class="kodety-help-skill-document-actions">
                                        <span><?php echo esc_html($document['language']); ?></span>
                                        <button
                                            type="button"
                                            class="kodety-help-button is-compact"
                                            data-kodety-skill-copy
                                        >
                                            Copiar arquivo
                                        </button>
                                    </div>
                                </header>
                                <pre class="kodety-help-skill-source" tabindex="0"><code data-kodety-skill-source><?php echo esc_html($content); ?></code></pre>
                            </article>
                        <?php endforeach; ?>
                    </div>
                </div>
            </div>
        </section>
        <?php
    }

    public function render_page(): void {
        if (!current_user_can('read')) {
            $message = 'Você não tem permissão para abrir esta documentação.';
            if (class_exists('Kodety_Admin_I18n')) $message = Kodety_Admin_I18n::instance()->translate($message);
            wp_die(esc_html($message));
        }

        $urls = $this->area_urls();
        $modules = $this->modules();
        $titles = [];
        $navigation = [];
        foreach ($modules as $module) {
            $id = (string) $module['id'];
            $group = (string) $module['group'];
            $titles[$id] = (string) $module['title'];
            $navigation[$group][$id] = (string) $module['title'];
        }
        ?>
        <div class="wrap kodety-help-page" data-kodety-help>
            <div class="kodety-help-primary-tabs" role="tablist" aria-label="Áreas do Manual Onun Kodety">
                <button
                    id="kodety-help-tab-manual"
                    class="kodety-help-primary-tab is-active"
                    type="button"
                    role="tab"
                    aria-selected="true"
                    aria-controls="kodety-help-view-manual"
                    data-kodety-help-view="manual"
                >
                    Manual
                </button>
                <button
                    id="kodety-help-tab-skill"
                    class="kodety-help-primary-tab"
                    type="button"
                    role="tab"
                    aria-selected="false"
                    aria-controls="kodety-help-view-skill"
                    tabindex="-1"
                    data-kodety-help-view="skill"
                >
                    Skill Codex
                </button>
            </div>

            <div
                id="kodety-help-view-manual"
                class="kodety-help-view-panel kodety-help-layout"
                data-kodety-help-view-panel="manual"
                role="tabpanel"
                aria-labelledby="kodety-help-tab-manual"
            >
                <aside class="kodety-help-sidebar" aria-label="Índice da documentação">
                    <div class="kodety-help-search">
                        <label for="kodety-help-search">Buscar uma tarefa</label>
                        <input
                            id="kodety-help-search"
                            type="search"
                            autocomplete="off"
                            placeholder="Ex.: publicar, fonte, CMS…"
                            data-kodety-help-search
                            aria-describedby="kodety-help-search-hint kodety-help-search-status"
                        >
                        <p id="kodety-help-search-hint">Pressione <kbd>/</kbd> para buscar.</p>
                        <p id="kodety-help-search-status" class="screen-reader-text" data-kodety-help-search-status aria-live="polite"></p>
                    </div>

                    <nav class="kodety-help-navigation" aria-label="Módulos do manual">
                        <section data-kodety-help-nav-group>
                            <h2>Manual</h2>
                            <ul>
                                <li><a href="#inicio" data-kodety-help-link="inicio">Como usar</a></li>
                            </ul>
                        </section>
                        <?php foreach ($navigation as $group => $items): ?>
                            <section data-kodety-help-nav-group>
                                <h2><?php echo esc_html($group); ?></h2>
                                <ul>
                                    <?php foreach ($items as $id => $label): ?>
                                        <li>
                                            <a href="#<?php echo esc_attr($id); ?>" data-kodety-help-link="<?php echo esc_attr($id); ?>">
                                                <?php echo esc_html($label); ?>
                                            </a>
                                        </li>
                                    <?php endforeach; ?>
                                </ul>
                            </section>
                        <?php endforeach; ?>
                    </nav>
                </aside>

                <main id="kodety-help-content" class="kodety-help-content" tabindex="-1">
                    <header
                        id="inicio"
                        class="kodety-help-hero"
                        data-kodety-help-section
                        data-search="manual como usar documentação procedimento módulo"
                    >
                        <p class="kodety-help-eyebrow">Manual operacional · <?php echo esc_html(KODETY_VERSION); ?></p>
                        <h1>Aprenda o Onun Kodety executando tarefas reais.</h1>
                        <p class="kodety-help-lead">Cada módulo é independente. Ele informa o que você precisa, o que deve fazer, como confirmar o resultado e como corrigir uma falha.</p>
                        <div class="kodety-help-hero-actions">
                            <a class="kodety-help-button is-primary" href="#primeiros-passos">Publicar o primeiro projeto</a>
                            <a class="kodety-help-button" href="#problemas">Diagnosticar um problema</a>
                        </div>

                        <div class="kodety-help-standard">
                            <p class="kodety-help-standard-label">Padrão editorial</p>
                            <div>
                                <strong>Organização modular</strong>
                                <span>Inspirada na organização por data modules da S1000D.</span>
                            </div>
                            <div>
                                <strong>Instruções controladas</strong>
                                <span>Frases curtas, termos consistentes e uma ação principal por passo, inspirados na ASD-STE100.</span>
                            </div>
                            <div>
                                <strong>Critério de conclusão</strong>
                                <span>Todo módulo termina com resultado esperado, erros, diagnóstico e referências cruzadas.</span>
                            </div>
                        </div>

                        <div class="kodety-help-paths">
                            <a href="#builder"><strong>Quero editar o visual</strong><span>Canvas, estilos e responsividade</span></a>
                            <a href="#cms"><strong>Quero administrar conteúdo</strong><span>Collections, campos e bindings</span></a>
                            <a href="#publicacao"><strong>Quero colocar no ar</strong><span>Preview, release e rollback</span></a>
                        </div>

                        <div class="kodety-help-note">
                            <strong>Como usar este manual</strong>
                            <p>Comece por um objetivo. Leia os pré-requisitos antes de agir. Execute os passos na ordem. Pare quando o resultado esperado não for alcançado e use a solução de problemas do mesmo módulo.</p>
                        </div>
                    </header>

                    <?php foreach ($modules as $module): ?>
                        <?php $this->render_module($module, $urls, $titles); ?>
                    <?php endforeach; ?>

                    <div class="kodety-help-empty" data-kodety-help-empty hidden>
                        <h2>Nenhum procedimento encontrado</h2>
                        <p>Tente o resultado desejado, como “publicar”, “fonte”, “formulário”, “CMS” ou “404”.</p>
                        <button type="button" class="kodety-help-button" data-kodety-help-clear>Limpar busca</button>
                    </div>

                    <footer class="kodety-help-footer">
                        <p>Manual operacional correspondente ao Onun Kodety <?php echo esc_html(KODETY_VERSION); ?>.</p>
                        <a href="#inicio">Voltar ao início</a>
                    </footer>
                </main>
            </div>

            <?php $this->render_codex_skill_workspace(); ?>
        </div>
        <?php
    }
}
