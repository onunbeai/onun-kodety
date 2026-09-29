<?php

/** Isolated contract test for the native Elementor -> Kodety converter. */
define('ABSPATH', __DIR__);

// Exercise the same KSES-first branch used inside a real WordPress request;
// DOM hardening must still run after this allow-list pass.
function wp_kses_post(string $html): string { return $html; }

require dirname(__DIR__) . '/kodety/includes/class-kodety-elementor-importer.php';

function kodety_elementor_import_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$document = [
    [
        'id' => 'root-a1',
        'elType' => 'container',
        'settings' => [
            'flex_direction' => 'column',
            'padding' => ['unit' => 'px', 'top' => 48, 'right' => 32, 'bottom' => 48, 'left' => 32],
            'padding_tablet' => ['unit' => 'px', 'top' => 32, 'right' => 24, 'bottom' => 32, 'left' => 24],
            'padding_mobile' => ['unit' => 'px', 'top' => 24, 'right' => 16, 'bottom' => 24, 'left' => 16],
            '__globals__' => ['background_color' => 'globals/colors?id=surface'],
        ],
        'elements' => [
            [
                'id' => 'heading-1',
                'elType' => 'widget',
                'widgetType' => 'heading',
                'settings' => [
                    'title' => 'Uma <strong>página editável</strong>',
                    'header_size' => 'h1',
                    'align' => 'left',
                    'align_tablet' => 'center',
                    'align_mobile' => 'left',
                    '__globals__' => [
                        'title_color' => 'globals/colors?id=primary',
                        'typography_typography' => 'globals/typography?id=primary',
                    ],
                ],
                'elements' => [],
            ],
            [
                'id' => 'text-1',
                'elType' => 'widget',
                'widgetType' => 'text-editor',
                'settings' => [
                    'editor' => '<p onclick="alert(1)" style="color:red !important">Conteúdo <em>real</em>.</p><script>alert(2)</script>',
                ],
                'elements' => [],
            ],
            [
                'id' => 'image-1',
                'elType' => 'widget',
                'widgetType' => 'image',
                'settings' => [
                    'image' => ['url' => 'https://example.test/uploads/hero.webp', 'alt' => 'Produto em destaque'],
                    'caption' => 'Imagem principal',
                    'width' => ['unit' => '%', 'size' => 72],
                ],
                'elements' => [],
            ],
            [
                'id' => 'button-1',
                'elType' => 'widget',
                'widgetType' => 'button',
                'settings' => [
                    'text' => 'Começar',
                    'link' => ['url' => 'javascript:alert(1)', 'is_external' => true],
                    'background_color' => '#6d5dfc',
                ],
                'elements' => [],
            ],
            [
                'id' => 'divider-1',
                'elType' => 'widget',
                'widgetType' => 'divider',
                'settings' => [
                    'weight' => ['unit' => 'px', 'size' => 2],
                    'width' => ['unit' => '%', 'size' => 80],
                    'color' => '#d4d4dc',
                ],
                'elements' => [],
            ],
            [
                'id' => 'spacer-1',
                'elType' => 'widget',
                'widgetType' => 'spacer',
                'settings' => ['space' => ['unit' => 'px', 'size' => 24]],
                'elements' => [],
            ],
            [
                'id' => 'form-1',
                'elType' => 'widget',
                'widgetType' => 'form',
                'settings' => [],
                'elements' => [],
            ],
        ],
    ],
];

$context = [
    'title' => 'Landing Elementor',
    'language' => 'pt-BR',
    'sourcePostId' => 101,
    'sourceUrl' => 'https://example.test/landing/',
    'globals' => [
        'colors' => [
            'primary' => '#573cff',
            'surface' => '#f8f7ff',
        ],
        'typography' => [
            'primary' => [
                'font_family' => 'Inter',
                'font_weight' => '700',
                'font_size' => ['unit' => 'px', 'size' => 54],
                'line_height' => ['unit' => 'em', 'size' => 1.05],
            ],
        ],
    ],
    'renderedWidgets' => [
        'form-1' => '<form action="https://example.test/send" onsubmit="steal()"><label>Email<input name="email"></label><button>Enviar</button><script>steal()</script></form>',
    ],
];

$converter = new Kodety_Elementor_Importer();
$result = $converter->convert($document, $context);
$repeat = (new Kodety_Elementor_Importer())->convert($document, $context);

kodety_elementor_import_assert($result === $repeat, 'a mesma entrada deve gerar um projeto determinístico');
kodety_elementor_import_assert(str_contains($result['html'], '<main') && str_contains($result['html'], '<section'), 'a página precisa usar HTML semântico real');
kodety_elementor_import_assert(substr_count($result['html'], '<h1>') === 1, 'o heading principal deve continuar sendo um único h1');
kodety_elementor_import_assert(str_contains($result['html'], '<p') && str_contains($result['html'], '<img') && str_contains($result['html'], '<a'), 'widgets básicos devem virar elementos HTML nativos');
kodety_elementor_import_assert(str_contains($result['html'], 'css/elementor-converted.css'), 'o HTML deve referenciar CSS externo editável');
kodety_elementor_import_assert(str_contains($result['html'], 'data-label="Título"') && str_contains($result['html'], 'data-kodety-source-id="heading-1"'), 'Layers e identidade de origem devem permanecer estáveis');
kodety_elementor_import_assert(str_contains($result['html'], 'id="elementor-101-heading-1"'), 'IDs devem ser determinísticos e isolados por página');
kodety_elementor_import_assert(!str_contains(strtolower($result['html']), '<script') && !str_contains(strtolower($result['html']), 'onclick=') && !str_contains(strtolower($result['html']), 'onsubmit='), 'HTML convertido não pode carregar scripts ou handlers inline');
kodety_elementor_import_assert(!str_contains(strtolower($result['html']), 'javascript:'), 'URLs executáveis devem ser neutralizadas');
kodety_elementor_import_assert(str_contains($result['html'], 'data-kodety-elementor-widget="form"') && str_contains($result['html'], 'data-kodety-elementor-preserved="rendered-html"'), 'widget renderizado deve ser reconhecido e preservado sem placeholder');
kodety_elementor_import_assert(str_contains($result['html'], 'data-kodety-elementor-inert="true"') && str_contains($result['html'], ' disabled'), 'widget renderizado interativo deve ficar inerte no rascunho estrutural');
kodety_elementor_import_assert(!str_contains(strtolower($result['css']), '!important'), 'CSS autoral convertido não pode usar prioridade');
kodety_elementor_import_assert(str_contains($result['css'], '--elementor-primary:#573cff') && str_contains($result['css'], '--elementor-surface:#f8f7ff'), 'cores do Kit devem virar tokens CSS');
kodety_elementor_import_assert(str_contains($result['css'], 'font-family:"Inter"') && str_contains($result['css'], 'font-weight:700'), 'tipografia global deve ser resolvida');
kodety_elementor_import_assert(str_contains($result['css'], '@media (max-width:1024px)') && str_contains($result['css'], '@media (max-width:767px)'), 'responsividade tablet/mobile deve permanecer editável');
kodety_elementor_import_assert(($result['report']['supportedWidgetCount'] ?? 0) === 6, 'relatório deve contar widgets convertidos');
kodety_elementor_import_assert(($result['report']['preservedWidgetCount'] ?? 0) === 1 && ($result['report']['preservedWidgets']['form'] ?? 0) === 1, 'relatório deve contar widgets reconhecidos pelo HTML renderizado');
kodety_elementor_import_assert(($result['report']['unsupportedWidgetCount'] ?? 0) === 0, 'widget com HTML renderizado não deve ser reportado como incompatível');
kodety_elementor_import_assert(($result['project']['mainHtmlPath'] ?? '') === 'index.html' && ($result['project']['homeHtmlPath'] ?? '') === 'index.html', 'manifesto precisa declarar a página principal');
kodety_elementor_import_assert(($result['project']['breakpointSchemaVersion'] ?? 0) === 2, 'manifesto deve selar o schema responsivo usado pelo CSS convertido');
kodety_elementor_import_assert(!array_key_exists('projectId', $result['project']), 'um import portátil não deve inventar identidade de projeto');

$failed_empty = false;
try {
    $converter->convert([], $context);
} catch (InvalidArgumentException) {
    $failed_empty = true;
}
kodety_elementor_import_assert($failed_empty, 'documento vazio deve falhar antes de substituir o workspace');


// Behavioral regressions found in real Elementor controls: widget component
// controls and Advanced controls have different targets and responsive inheritance.
function wp_get_attachment_image_url(int $id, string $size): string|false {
    return $id === 7 ? 'https://example.test/uploads/library-' . $size . '.webp' : false;
}
function get_post_meta(int $id, string $key, bool $single): string {
    return $id === 7 && $key === '_wp_attachment_image_alt' ? 'Descrição da biblioteca' : '';
}
function wp_get_attachment_caption(int $id): string { return $id === 7 ? 'Legenda da biblioteca' : ''; }
function kodety_elementor_xpath(string $html): DOMXPath {
    $dom = new DOMDocument();
    $previous = libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    return new DOMXPath($dom);
}
$advanced_document = [[
    'id' => 'grid', 'elType' => 'container',
    'settings' => [
        'html_tag' => 'article', '_element_id' => 'pricing', '_css_classes' => 'pricing-grid reusable-card',
        'container_type' => 'grid', 'grid_columns_grid' => ['size' => 3], 'grid_columns_grid_tablet' => ['size' => 2],
        'grid_columns_grid_mobile' => ['size' => 1], 'grid_column_gap' => ['size' => 24, 'unit' => 'px'],
        'background_background' => 'gradient', 'background_color' => '#ffffff', 'background_color_b' => '#eeeeff',
        'background_gradient_angle' => ['size' => 135], 'background_image_mobile' => ['url' => '../art/mobile.webp'],
        'background_size_mobile' => 'cover', 'background_position_mobile' => 'center center',
        'hide_tablet' => 'hidden-tablet', 'padding' => ['unit' => 'rem', 'top' => 2, 'isLinked' => true],
    ],
    'elements' => [
        ['id' => 'title', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [
            'title' => 'Título da origem', 'header_size' => 'h2', 'link' => ['url' => '../offers/?utm=x#plans', 'is_external' => true],
            '__globals__' => ['typography_typography' => 'globals/typography?id=brand'],
            'typography_font_size_tablet' => ['size' => 32, 'unit' => 'px'],
        ]],
        ['id' => 'responsive-global', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [
            'title' => 'Global responsivo', 'typography_font_size_mobile' => ['size' => '', 'unit' => 'px'],
            '__globals__' => ['typography_typography' => 'globals/typography?id=responsive'],
        ]],
        ['id' => 'photo', 'elType' => 'widget', 'widgetType' => 'image', 'settings' => [
            'image' => ['id' => 7], 'image_size' => 'large', 'caption_source' => 'attachment',
            'width' => ['size' => 60, 'unit' => '%'], 'width_mobile' => ['size' => 100, 'unit' => '%'],
            'height' => ['size' => 240, 'unit' => 'px'], 'object-fit' => 'cover',
            '_element_width' => 'initial', '_element_custom_width' => ['size' => 80, 'unit' => '%'],
            'link_to' => 'custom', 'link' => ['url' => '/products/item', 'nofollow' => true],
        ]],
        ['id' => 'cta', 'elType' => 'widget', 'widgetType' => 'button', 'settings' => [
            'text' => 'Conhecer', 'link' => ['url' => '#pricing'], '_background_color' => '#f0f0f0', 'background_color' => '#123456',
            '_padding' => ['top' => 3, 'right' => 3, 'bottom' => 3, 'left' => 3, 'unit' => 'px'],
            'text_padding' => ['top' => 12, 'right' => 28, 'bottom' => 12, 'left' => 28, 'unit' => 'px'],
            'button_background_hover_color' => '#654321', 'hover_color' => '#ffffff',
            'border_border' => 'solid', 'border_color' => '#112233',
        ]],
        ['id' => 'gallery', 'elType' => 'widget', 'widgetType' => 'image-gallery', 'settings' => [
            'wp_gallery' => [['id' => 7], ['url' => '../../../picture.webp', 'alt' => 'Outra imagem']],
            'gallery_columns' => 3, 'gallery_columns_mobile' => 1, 'gallery_link' => 'none',
        ]],
        ['id' => 'faq', 'elType' => 'widget', 'widgetType' => 'accordion', 'settings' => [
            'tabs' => [
                ['tab_title' => 'Como editar?', 'tab_content' => '<p>Edite os elementos normalmente.</p>'],
                ['tab_title' => 'Precisa de runtime?', 'tab_content' => '<p>HTML nativo.</p>'],
            ], 'title_typography_font_size_mobile' => ['size' => 20, 'unit' => 'px'],
        ]],
        ['id' => 'toggle', 'elType' => 'widget', 'widgetType' => 'toggle', 'settings' => [
            'tabs' => [['tab_title' => 'Mais informações', 'tab_content' => '<p>Conteúdo expansível.</p>']],
        ]],
        ['id' => 'card', 'elType' => 'widget', 'widgetType' => 'image-box', 'settings' => [
            'image' => ['id' => 7], 'title_text' => 'Um produto', 'description_text' => '<p>Descrição <strong>real</strong>.</p>',
            'title_size' => 'h3', 'link' => ['url' => 'products/card'], 'title_typography_font_size' => ['size' => 26, 'unit' => 'px'],
        ]],
        ['id' => 'quote', 'elType' => 'widget', 'widgetType' => 'testimonial', 'settings' => [
            'testimonial_image' => ['id' => 7], 'testimonial_content' => 'Ótima experiência.', 'testimonial_name' => 'Maria',
            'testimonial_job' => 'Designer', 'content_content_color' => '#554433',
        ]],
        ['id' => 'stat', 'elType' => 'widget', 'widgetType' => 'counter', 'settings' => [
            'starting_number' => 0, 'ending_number' => 12500, 'thousand_separator_char' => '.', 'prefix' => '+', 'suffix' => ' clientes',
            'title' => 'Atendidos', 'typography_number_font_size' => ['size' => 60, 'unit' => 'px'],
        ]],
        ['id' => 'progress', 'elType' => 'widget', 'widgetType' => 'progress', 'settings' => [
            'title' => 'Conversão', 'percent' => ['size' => 80], 'inner_text' => 'Completo',
        ]],
        ['id' => 'anchor', 'elType' => 'widget', 'widgetType' => 'menu-anchor', 'settings' => ['anchor' => 'contact']],
        ['id' => 'custom-html', 'elType' => 'widget', 'widgetType' => 'html', 'settings' => [
            'html' => '<p>HTML preservado.</p><a href="java&#x09;script:alert(1)" target="_blank">Link inválido</a>'
                . '<img src="art/safe.webp" srcset="/art/safe.webp 1x, javascript:alert(1) 2x">'
                . '<button formaction="https://example.test/delete" autofocus>Enviar</button>'
                . '<svg><a xlink:href="javascript:alert(1)">x</a><animate attributeName="href" values="javascript:alert(1)"></animate></svg>'
                . '<script>window.hydrate()</script>',
        ]],
        ['id' => 'dynamic', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [
            'title' => 'Valor desatualizado', '__dynamic__' => ['title' => '[elementor-tag id="1"]'],
        ]],
        ['id' => 'nested', 'elType' => 'widget', 'widgetType' => 'nested-tabs', 'settings' => [], 'elements' => [
            ['id' => 'nested-content', 'elType' => 'container', 'elements' => [
                ['id' => 'nested-text', 'elType' => 'widget', 'widgetType' => 'text-editor', 'settings' => ['editor' => '<p>Conteúdo aninhado recuperado.</p>']],
            ]],
        ]],
    ],
]];
$advanced_context = [
    'title' => 'Página completa', 'sourcePostId' => 202, 'sourceUrl' => 'https://example.test/site/landing/',
    'globals' => [
        'breakpoints' => ['mobile' => 700, 'tablet' => 980, 'tablet_extra' => 1180, 'laptop' => 1366, 'widescreen' => 2400],
        'typography' => [
            'brand' => ['font_family' => 'Source Sans 3', 'font_size' => ['size' => 48, 'unit' => 'px'], 'font_size_tablet' => ['size' => 36, 'unit' => 'px'], 'text_transform' => 'uppercase'],
            'responsive' => ['font_size' => ['size' => 50, 'unit' => 'px'], 'font_size_mobile' => ['size' => 26, 'unit' => 'px']],
        ],
    ],
    'renderedWidgets' => ['dynamic' => '<div><h2>Conteúdo dinâmico resolvido</h2></div>'],
];
$advanced = $converter->convert($advanced_document, $advanced_context);
$xpath = kodety_elementor_xpath($advanced['html']);
$css = $advanced['css'];
kodety_elementor_import_assert($xpath->query('//article[@id="pricing" and contains(@class,"pricing-grid")]')->length === 1, 'tag semântica, classes autorais e âncora devem continuar editáveis');
kodety_elementor_import_assert($xpath->query('//*[@id="contact"]')->length === 1 && $xpath->query('//a[@href="#pricing"]')->length === 1, 'âncoras de menu e links internos devem continuar conectados');
kodety_elementor_import_assert($xpath->query('//h2/a[@href="https://example.test/site/offers/?utm=x#plans" and @rel="noopener"]')->length === 1, 'heading com link deve preservar o destino relativo à página de origem');
kodety_elementor_import_assert($xpath->query('//figure[@id="elementor-202-photo"]//img[@src="https://example.test/uploads/library-large.webp" and @alt="Descrição da biblioteca"]')->length === 1, 'imagem de biblioteca precisa resolver tamanho e texto alternativo');
kodety_elementor_import_assert(str_contains($advanced['html'], 'Legenda da biblioteca') && str_contains($advanced['html'], 'href="https://example.test/products/item"'), 'legenda da biblioteca e link da imagem devem ser preservados');
kodety_elementor_import_assert(str_contains($css, '.elementor-202-photo{width:80%;}') && str_contains($css, '.elementor-202-photo img{width:60%;height:240px;object-fit:cover;}'), 'largura Advanced e largura da imagem devem ter alvos independentes, sem multiplicar duas vezes a largura do widget');
kodety_elementor_import_assert(str_contains($css, '.elementor-202-cta{padding:3px 3px 3px 3px;background-color:#f0f0f0;}'), 'padding e background Advanced devem pertencer ao wrapper do botão');
kodety_elementor_import_assert(str_contains($css, '.elementor-202-cta > .kodety-button{background-color:#123456;padding:12px 28px 12px 28px;'), 'estilos visuais do botão devem pertencer ao link clicável');
kodety_elementor_import_assert(str_contains($css, '.elementor-202-cta > .kodety-button:hover,') && str_contains($css, 'background-color:#654321;'), 'cores de hover devem permanecer em CSS editável');
kodety_elementor_import_assert(str_contains($css, 'font-size:48px;text-transform:uppercase;') && str_contains($css, '@media (max-width:980px){.elementor-202-title > *{font-size:32px;}}'), 'tipografia local responsiva deve prevalecer sobre o token global');
kodety_elementor_import_assert(!str_contains($css, '@media (max-width:700px){.elementor-202-title > *{'), 'mobile sem override deve herdar tablet e não reemitir tipografia desktop');
kodety_elementor_import_assert(str_contains($css, '@media (max-width:700px){.elementor-202-responsive-global > *{font-size:26px;}}'), 'controle local vazio deve resolver o valor responsivo do Kit');
kodety_elementor_import_assert(str_contains($css, 'linear-gradient(135deg,#ffffff 0%,#eeeeff 100%)') && str_contains($css, 'padding:2rem 2rem 2rem 2rem;'), 'gradientes e dimensões vinculadas devem preservar valores reais');
kodety_elementor_import_assert(str_contains($css, 'background-image:url("https://example.test/site/art/mobile.webp")') && str_contains($css, 'background-size:cover;'), 'backgrounds responsivos devem resolver assets pela URL de origem');
kodety_elementor_import_assert(str_contains($css, 'grid-template-columns:repeat(3,minmax(0,1fr));') && str_contains($css, 'grid-template-columns:repeat(1,minmax(0,1fr));'), 'colunas de grid e galeria devem converter responsivamente');
kodety_elementor_import_assert(str_contains($css, '@media (min-width:701px) and (max-width:980px){.elementor-202-grid{display:none;}}'), 'ocultar em tablet deve afetar apenas seu intervalo e manter mobile visível');
kodety_elementor_import_assert(array_column($advanced['project']['breakpoints'], 'width', 'id') === $advanced['report']['sourceBreakpoints'], 'manifesto e CSS devem usar exatamente os breakpoints reais da origem');
kodety_elementor_import_assert($xpath->query('//*[@id="elementor-202-gallery"]/figure')->length === 2 && str_contains($advanced['html'], 'src="https://example.test/picture.webp"'), 'galeria deve resolver IDs e caminhos além da raiz sem corromper a origem');
kodety_elementor_import_assert($xpath->query('//*[@id="elementor-202-faq"]/details[@name]')->length === 2 && $xpath->query('//*[@id="elementor-202-faq"]/details[@open]')->length === 1, 'accordion precisa de controles nativos agrupados e primeiro painel aberto');
kodety_elementor_import_assert($xpath->query('//*[@id="elementor-202-toggle"]/details[not(@open) and not(@name)]')->length === 1, 'toggle deve ter comportamento nativo independente, inicialmente fechado');
kodety_elementor_import_assert(str_contains($advanced['html'], '+12.500 clientes') && str_contains($advanced['html'], 'value="80"') && !str_contains($advanced['html'], 'starting_number'), 'contador deve exibir valor final e progress deve preservar valor acessível sem hidratação');
kodety_elementor_import_assert($xpath->query('//*[@id="elementor-202-card"]//h3/a')->length === 1 && str_contains($advanced['html'], 'Ótima experiência.') && str_contains($css, '.elementor-202-quote blockquote{color:#554433;}'), 'cards e depoimentos devem preservar conteúdo semântico e estilo');
kodety_elementor_import_assert(str_contains($advanced['html'], 'Conteúdo dinâmico resolvido') && !str_contains($advanced['html'], 'Valor desatualizado'), 'conteúdo dinâmico disponível deve preservar seu resultado renderizado');
kodety_elementor_import_assert(str_contains($advanced['html'], 'Conteúdo aninhado recuperado.') && str_contains($advanced['html'], 'data-kodety-elementor-preserved="child-elements"'), 'widget aninhado sem renderização deve recuperar a árvore filha');
kodety_elementor_import_assert(($advanced['report']['unsupportedWidgetCount'] ?? -1) === 0 && ($advanced['report']['preservedWidgetCount'] ?? 0) === 2 && ($advanced['report']['supportedWidgetCount'] ?? 0) === 14, 'relatório deve separar widgets nativos, dinâmicos e árvores preservadas');
kodety_elementor_import_assert(!str_contains(strtolower($advanced['html']), 'javascript:') && !str_contains($advanced['html'], 'formaction=') && !str_contains($advanced['html'], '<animate') && !str_contains($advanced['html'], '<script'), 'fragments HTML não podem conservar URLs ofuscadas, execução SVG ou submit alternativo');
kodety_elementor_import_assert($xpath->query('//*[@id="elementor-202-custom-html"]//img[@srcset="https://example.test/art/safe.webp 1x"]')->length === 1, 'srcset deve preservar somente candidatos de imagem seguros e resolvidos');
kodety_elementor_import_assert(!str_contains($css, '!important') && !str_contains($css, '--elementor-primary:'), 'instância reutilizada não pode vazar tokens ou prioridade do documento anterior');

$columns = $converter->convert([['id' => 'row', 'elType' => 'section', 'elements' => [
    ['id' => 'left', 'elType' => 'column', 'settings' => ['_column_size' => 40]],
    ['id' => 'right', 'elType' => 'column', 'settings' => ['_column_size' => 60, '_column_size_mobile' => 50]],
]]]);
kodety_elementor_import_assert(str_contains($columns['css'], '.elementor-left{flex:0 0 40%;width:40%;}') && str_contains($columns['css'], '@media (max-width:767px){.elementor-left{flex:0 0 100%;width:100%;}}'), 'colunas legadas devem manter proporções desktop e empilhar somente no mobile original');
kodety_elementor_import_assert(str_contains($columns['css'], '@media (max-width:767px){.elementor-right{flex:0 0 50%;width:50%;}}'), 'largura explícita de coluna mobile deve prevalecer sobre o empilhamento automático');
$duplicate = $converter->convert([
    ['id' => 'same', 'elType' => 'container', 'settings' => ['_element_id' => 'shared']],
    ['id' => 'same', 'elType' => 'container', 'settings' => ['_element_id' => 'shared']],
]);
$duplicate_xpath = kodety_elementor_xpath($duplicate['html']);
kodety_elementor_import_assert($duplicate_xpath->query('//*[@id="shared"]')->length === 1 && str_contains($duplicate['html'], 'id="elementor-same-2"'), 'IDs repetidos devem ser isolados sem duplicar âncoras');
$deep = ['id' => 'deep', 'elType' => 'container'];
for ($i = 0; $i < 102; $i++) $deep = ['id' => 'deep-' . $i, 'elType' => 'container', 'elements' => [$deep]];
$depth_rejected = false;
try { $converter->convert([$deep]); } catch (InvalidArgumentException) { $depth_rejected = true; }
kodety_elementor_import_assert($depth_rejected, 'árvore excessivamente profunda deve falhar antes de alterar qualquer workspace');

if (!defined('KODETY_ELEMENTOR_FIXTURE_ONLY')) fwrite(STDOUT, "Conversão Elementor nativa: 15 tipos de widget, breakpoints de origem, herança, mídia, HTML seguro e contratos de edição aprovados.\n");
