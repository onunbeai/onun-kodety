<?php

/** Isolated regression test for URL import localization and Framer cleanup. */
define('ABSPATH', __DIR__);
define('MB_IN_BYTES', 1024 * 1024);
define('WP_CONTENT_DIR', sys_get_temp_dir() . '/kodety-url-import-local-' . getmypid());

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message = '',
        private mixed $data = null,
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

$GLOBALS['kodety_import_fixtures'] = [
    'https://example.test/site.css' => ['text/css', '@font-face{font-family:Demo;src:url("/font.woff2")} .hero{background:url(/cover.webp)}'],
    'https://example.test/font.woff2' => ['font/woff2', 'font-bytes'],
    'https://example.test/cover.webp' => ['image/webp', 'cover-bytes'],
    'https://example.test/hero.png' => ['image/png', 'hero-bytes'],
    'https://example.test/hero-copy.png' => ['image/png', 'hero-bytes'],
    'https://example.test/variant.png' => ['image/png', 'variant-bytes'],
    'https://example.test/icon.png' => ['image/png', 'icon-bytes'],
    'https://example.test/webflow.js' => ['application/javascript', 'window.Webflow=window.Webflow||[];'],
    'https://example.test/elementor.css' => ['text/css', '.elementor-element{background-image:url("/cover.webp")!important}.elementor-invisible{visibility:hidden!important}'],
    'https://example.test/elementor.js' => ['application/javascript', 'window.elementorFrontend={ready:true};'],
    'https://example.test/landing/' => ['text/html', '<!doctype html><html><body><main data-elementor-type="wp-page" data-elementor-id="101"><div class="elementor-widget" data-id="form-native" data-widget_type="form.default"><form action="/send" onsubmit="unsafe()"><label>Email<input name="email"></label><button>Enviar</button><script>unsafe()</script></form></div></main></body></html>'],
    'https://example.test/not-elementor/' => ['text/html', '<!doctype html><html><head><title>Site comum</title></head><body><main>Sem Elementor</main></body></html>'],
    'https://example.test/app.mjs' => ['application/javascript', 'import "./dep.mjs"; window.appReady=true;'],
    'https://example.test/dep.mjs' => ['application/javascript', 'export const dependency=true;'],
    'https://example.test/runtime.mjs' => ['application/javascript', 'window.framerRuntime=true;window.variant="https://example.test/variant.png";import(`./framer-component.mjs`).then(module=>module.mount?.());'],
    'https://example.test/framer-component.mjs' => ['application/javascript', 'export function mount(){window.framerComponentMounted=true}'],
    'https://example.test/broken.mjs' => ['application/javascript', 'import "./missing-runtime.mjs"; import("./missing-runtime.mjs"); window.partialRuntime=true;'],
];
$GLOBALS['kodety_import_requests'] = [];
$GLOBALS['kodety_elementor_test_posts'] = [
    101 => (object) ['ID' => 101, 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Landing Elementor'],
];
$GLOBALS['kodety_elementor_test_meta'] = [
    101 => [
        '_elementor_edit_mode' => 'builder',
        '_elementor_data' => json_encode([[
            'id' => 'native-root',
            'elType' => 'container',
            'settings' => [
                'padding' => ['unit' => 'px', 'top' => 32, 'right' => 24, 'bottom' => 32, 'left' => 24],
                '__globals__' => ['background_color' => 'globals/colors?id=surface'],
            ],
            'elements' => [
                [
                    'id' => 'native-heading',
                    'elType' => 'widget',
                    'widgetType' => 'heading',
                    'settings' => [
                        'title' => 'Landing <strong>nativa</strong>',
                        'header_size' => 'h1',
                        '__globals__' => ['title_color' => 'globals/colors?id=primary'],
                    ],
                    'elements' => [],
                ],
                [
                    'id' => 'native-image',
                    'elType' => 'widget',
                    'widgetType' => 'image',
                    'settings' => ['image' => ['url' => 'https://example.test/hero.png', 'alt' => 'Hero']],
                    'elements' => [],
                ],
                [
                    'id' => 'form-native',
                    'elType' => 'widget',
                    'widgetType' => 'form',
                    'settings' => [],
                    'elements' => [],
                ],
            ],
        ]], JSON_UNESCAPED_SLASHES),
    ],
    501 => [
        '_elementor_page_settings' => [
            'system_colors' => [
                ['_id' => 'primary', 'color' => '#573cff'],
                ['_id' => 'surface', 'color' => '#f8f7ff'],
            ],
        ],
    ],
];

function wp_http_validate_url(string $url): string|false {
    return str_starts_with($url, 'https://example.test/') || str_starts_with($url, 'https://local.test/') ? $url : false;
}
function wp_remote_get(string $url, array $options = []): array {
    $GLOBALS['kodety_import_requests'][] = $url;
    if (!isset($GLOBALS['kodety_import_fixtures'][$url])) return ['response' => ['code' => 404], 'body' => '', 'headers' => []];
    [$type, $body] = $GLOBALS['kodety_import_fixtures'][$url];
    return ['response' => ['code' => 200], 'body' => $body, 'headers' => ['content-type' => $type]];
}
function wp_remote_retrieve_response_code(array $response): int { return (int) ($response['response']['code'] ?? 0); }
function wp_remote_retrieve_body(array $response): string { return (string) ($response['body'] ?? ''); }
function wp_remote_retrieve_header(array $response, string $name): string { return (string) ($response['headers'][strtolower($name)] ?? ''); }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function content_url(string $path = ''): string {
    return 'https://local.test/wp-content/' . ltrim($path, '/');
}
function home_url(string $path = ''): string {
    return 'https://local.test/' . ltrim($path, '/');
}
function esc_url(string $url): string { return htmlspecialchars($url, ENT_QUOTES, 'UTF-8'); }
function sanitize_file_name(string $name): string { return preg_replace('~[^A-Za-z0-9._-]+~', '-', $name) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: ''; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function get_temp_dir(): string { return sys_get_temp_dir() . '/'; }
function absint(mixed $value): int { return abs((int) $value); }
function current_user_can(string $capability, mixed ...$arguments): bool { return true; }
function get_post(int $post_id): ?object { return $GLOBALS['kodety_elementor_test_posts'][$post_id] ?? null; }
function get_post_meta(int $post_id, string $key, bool $single = false): mixed {
    return $GLOBALS['kodety_elementor_test_meta'][$post_id][$key] ?? ($single ? '' : []);
}
function get_option(string $key, mixed $default = false): mixed {
    return $key === 'elementor_active_kit' ? 501 : $default;
}
function get_the_title(int $post_id): string { return (string) (get_post($post_id)?->post_title ?? ''); }
function get_locale(): string { return 'pt_BR'; }
function wp_kses_post(string $html): string { return $html; }

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_url_import_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

if (!class_exists('DOMDocument') || !class_exists('ZipArchive')) {
    fwrite(STDERR, "FAIL: as extensões DOM e ZipArchive são necessárias.\n");
    exit(1);
}

$source = <<<'HTML'
<!doctype html><html><head>
<link rel="modulepreload" href="/runtime.mjs">
<link rel="stylesheet" href="/site.css">
<link rel="icon" href="/icon.png">
<script type="framer/appear" id="__framer__breakpoints">[{"hash":"desktop","mediaQuery":"(min-width: 1200px)"},{"hash":"tablet","mediaQuery":"(min-width: 768px) and (max-width: 1199.98px)"}]</script>
<script type="framer/appear" id="__framer__appearAnimationsContent">{"hero":{"default":{"initial":{"opacity":0.001,"x":-37},"animate":{"opacity":1,"x":0,"transition":{"delay":0.1,"duration":0.4,"ease":[0.2,0.8,0.2,1]}}}}}</script>
</head><body>
<div id="__framer-badge-container">Made in Framer</div><div id="framer-badge-container" class="__framer-badge">Made in Framer v2</div>
<a href="/produto" data-highlight="true" data-framer-name="Primary navigation">Produto</a>
<div class="hero framer-hero" data-framer-name="Hero principal" data-framer-appear-id="hero" style="background-image:url('/cover.webp');color:red !important">Conteúdo estático</div>
<div class="framer-hero mobile-copy" data-framer-appear-id="hero" style="opacity:0.001;transform:translateX(-37px)">Variante responsiva</div>
<img data-test-asset="hero" src="/hero.png" srcset="/hero.png 1x, /cover.webp 2x">
<img data-test-asset="hero-copy" src="/hero-copy.png">
<img data-test-missing="one" src="/missing.png"><img data-test-missing="two" src="/missing.png">
<script type="module" src="/runtime.mjs"></script>
<script type="framer/handover" id="__framer__handoverData">{"hydrate":true,"variant":"https://example.test/variant.png"}</script>
</body></html>
HTML;

$reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $reflection->newInstanceWithoutConstructor();
$validate_source_url = $reflection->getMethod('import_validate_source_url');
foreach ([
    'https://kodety.com',
    'https://kodety.com/qualquer/caminho?origem=importador',
    'https://www.kodety.com/',
    'https://app.kodety.com/projeto',
    'www.kodety.com/sem-protocolo',
] as $restricted_url) {
    $restricted = $validate_source_url->invoke($plugin, $restricted_url);
    kodety_url_import_assert(
        $restricted instanceof WP_Error
            && $restricted->get_error_code() === 'kodety_import_kodety_domain_restricted'
            && str_contains($restricted->get_error_message(), 'restrição interna intencional')
            && str_contains($restricted->get_error_message(), 'não um erro'),
        'domínios Kodety devem ser recusados como uma restrição interna explícita'
    );
}
$prepare = $reflection->getMethod('prepare_imported_html');
$prepared = (string) $prepare->invoke($plugin, $source, 'https://example.test/');
kodety_url_import_assert(!str_contains($prepared, 'type="module"') && !str_contains($prepared, 'src="https://example.test/runtime.mjs"'), 'scripts executáveis de hidratação devem ser removidos');
kodety_url_import_assert(str_contains($prepared, 'type="framer/appear"') && str_contains($prepared, 'type="framer/handover"'), 'payloads inertes de appear/handover devem sobreviver para o runtime local');
kodety_url_import_assert(!str_contains($prepared, 'modulepreload'), 'modulepreload do runtime deve ser removido');
kodety_url_import_assert(str_contains(html_entity_decode($prepared, ENT_QUOTES | ENT_HTML5, 'UTF-8'), 'Conteúdo estático'), 'o DOM renderizado precisa ser preservado');
kodety_url_import_assert(!str_contains($prepared, '<?xml'), 'a declaração auxiliar do parser não deve vazar para o HTML');
kodety_url_import_assert(!str_contains($prepared, 'id="__framer-badge-container"'), 'a badge estática Made in Framer deve ser removida do canvas');
kodety_url_import_assert(!str_contains($prepared, 'id="framer-badge-container"') && !str_contains($prepared, 'class="__framer-badge"'), 'as variantes atuais da badge Framer também devem ser removidas');
kodety_url_import_assert(str_contains($prepared, 'https://example.test/produto'), 'links de navegação devem ser preservados e absolutizados');
kodety_url_import_assert(str_contains($prepared, 'data-label="Primary navigation"'), 'nomes úteis do Framer devem virar labels nativos e editáveis nas Layers');
kodety_url_import_assert(str_contains($prepared, 'data-kodety-framer-visual-cleanup'), 'imports Framer devem neutralizar o contorno transitório de toque');
kodety_url_import_assert(str_contains($prepared, '[data-highlight]:not(:focus-visible)') && str_contains($prepared, '-webkit-tap-highlight-color:transparent'), 'a limpeza visual deve remover o highlight ocioso sem esconder foco de teclado');
kodety_url_import_assert(str_contains(strtolower($prepared), 'color:red !important'), 'importação deve preservar prioridades CSS autorais');
$prepared_dom = new DOMDocument();
$prepared_dom->loadHTML($prepared);
$embedded_manifest = null;
foreach ($prepared_dom->getElementsByTagName('meta') as $meta) {
    if ($meta->getAttribute('name') === 'kodety-framer-import') $embedded_manifest = json_decode(rawurldecode($meta->getAttribute('content')), true);
}
kodety_url_import_assert(is_array($embedded_manifest), 'dados estruturados do Framer devem sobreviver como manifesto inerte');
kodety_url_import_assert(($embedded_manifest['breakpoints'][0]['query'] ?? '') === '(min-width: 1200px)', 'a media query exata do Framer deve ser preservada');
kodety_url_import_assert(($embedded_manifest['animations'][0]['targetClass'] ?? '') === 'framer-hero', 'data-framer-appear-id deve apontar para a classe real do elemento');
kodety_url_import_assert((float) ($embedded_manifest['animations'][0]['timing']['duration'] ?? 0) === 400.0, 'duração do Framer em segundos deve virar milissegundos no Builder');
kodety_url_import_assert(($embedded_manifest['animations'][0]['frames'][0]['x'] ?? null) === -37, 'estado initial exato deve ser convertido');
kodety_url_import_assert(isset($embedded_manifest['embedded']['handoverRaw']), 'handover deve ficar arquivado sem executar hidratação');
$prepared_hero = null;
$prepared_hero_count = 0;
foreach ($prepared_dom->getElementsByTagName('*') as $element) {
    if ($element instanceof DOMElement && $element->getAttribute('data-framer-appear-id') === 'hero') {
        $prepared_hero_count++;
        if (!$prepared_hero instanceof DOMElement) $prepared_hero = $element;
        kodety_url_import_assert(str_contains($element->getAttribute('style'), 'opacity:1'), 'todas as variantes responsivas do mesmo appear-id devem ficar visíveis');
    }
}
kodety_url_import_assert($prepared_hero_count === 2, 'o teste deve cobrir IDs de animação repetidos entre variantes responsivas');
kodety_url_import_assert($prepared_hero instanceof DOMElement && str_contains($prepared_hero->getAttribute('style'), 'opacity:1'), 'o canvas deve receber o estado final visível mesmo sem executar a animação');
kodety_url_import_assert($prepared_hero instanceof DOMElement && str_contains($prepared_hero->getAttribute('style'), 'translateX(0)'), 'o transform inicial invisível/deslocado deve ser materializado no estado final');

$responsive_manifest = rawurlencode(json_encode([
    'version' => 1,
    'source' => 'framer-runtime',
    'embedded' => ['responsiveRoots' => [[
        'selector' => '.kodety-framer-responsive-root-1',
        'variants' => [
            ['hash' => 'desktop', 'query' => '(min-width: 1200px)'],
            ['hash' => 'tablet', 'query' => '(min-width: 768px) and (max-width: 1199.98px)'],
        ],
    ]]],
], JSON_UNESCAPED_SLASHES));
$responsive_source = '<!doctype html><html><head><meta name="kodety-framer-import" content="' . htmlspecialchars($responsive_manifest, ENT_QUOTES, 'UTF-8') . '"></head><body>'
    . '<main class="framer-page framer-desktop kodety-framer-responsive-root-1" data-framer-root>Responsivo</main>'
    . '<script src="https://example.test/original-framer-runtime.js"></script></body></html>';
$responsive_prepared = (string) $prepare->invoke($plugin, $responsive_source, 'https://example.test/', 'framer');
kodety_url_import_assert(str_contains($responsive_prepared, 'data-kodety-framer-responsive-runtime'), 'a captura multipass deve instalar o alternador local de breakpoints');
kodety_url_import_assert(str_contains($responsive_prepared, 'matchMedia') && str_contains($responsive_prepared, 'tablet') && str_contains($responsive_prepared, 'desktop'), 'o runtime local deve alternar os hashes pelas media queries importadas');
kodety_url_import_assert(!str_contains($responsive_prepared, 'original-framer-runtime.js'), 'a hidratação React original deve continuar removida');

$detect_platform = $reflection->getMethod('import_detect_platform');
$webflow_source = <<<'HTML'
<!doctype html><html data-wf-page="page-1" data-wf-site="site-1" data-wf-status="1"><head>
<meta name="generator" content="Webflow"><link rel="modulepreload" href="/chunk.mjs">
</head><body><nav class="w-nav" data-w-id="nav-1"></nav>
<a class="w-webflow-badge" href="https://webflow.com">Made in Webflow</a>
<script src="https://example.test/webflow.js"></script>
<script type="module" src="https://example.test/app.mjs"></script>
<script type="module">import "./component.js";window.kodetyText="começa";window.kodetyLiteral="&amp;";</script></body></html>
HTML;
kodety_url_import_assert($detect_platform->invoke($plugin, $webflow_source) === 'webflow', 'Webflow deve usar o perfil de runtime preservado');
kodety_url_import_assert($detect_platform->invoke($plugin, '<html><body><script src="/app.js"></script></body></html>') === 'code', 'HTML autoral deve usar o perfil code');
kodety_url_import_assert($detect_platform->invoke($plugin, $source) === 'framer', 'handover do Framer deve selecionar captura estática');
kodety_url_import_assert($detect_platform->invoke($plugin, '<meta name="generator" content="Framer"><main>Page</main>') === 'framer', 'generator Framer deve funcionar em ambas as ordens dos atributos');
kodety_url_import_assert($detect_platform->invoke($plugin, '<meta name="generator" content="Webflow"><main><div data-framer-name="Embedded component"></div></main>') === 'webflow', 'componente Framer incorporado não pode remover o runtime Webflow da página');
kodety_url_import_assert($detect_platform->invoke($plugin, '<meta content="Elementor 3.25" name="generator"><div data-framer-name="Embed"></div>') === 'elementor', 'o gerador explícito Elementor tem precedência sobre componentes incorporados');
kodety_url_import_assert($detect_platform->invoke($plugin, '<main>A tutorial about sites made in Framer</main>') === 'code', 'mencionar Framer no conteúdo não pode remover scripts de um site em código');
$elementor_source = <<<'HTML'
<!doctype html><html><head>
<meta name="generator" content="Elementor 3.25"><link rel="stylesheet" href="/elementor.css">
</head><body class="elementor-page-101">
<main data-elementor-type="wp-page" data-elementor-id="101">
<section class="elementor-element elementor-invisible" data-id="section-1" data-element_type="container" style="opacity:0!important" onclick="alert(1)">
<div class="elementor-element elementor-widget" data-id="heading-1" data-element_type="widget" data-widget_type="heading.default"><h1>Site Elementor</h1></div>
<div class="elementor-element elementor-widget elementor-widget-icon-list" data-id="icon-list-1" data-element_type="widget" data-widget_type="icon-list.default"><div class="elementor-widget-container"><ul class="elementor-icon-list-items"><li class="elementor-icon-list-item"><span class="elementor-icon-list-icon"><i class="fas fa-check" aria-hidden="true"></i></span><span class="elementor-icon-list-text">Item real renderizado</span></li></ul></div></div>
<p class="e-paragraph-base" data-id="atomic-text-1" data-interaction-id="atomic-text-1" data-e-type="widget">Texto atômico real</p>
<img class="e-image-base" data-id="atomic-image-1" data-e-type="widget" src="/hero.png" alt="Imagem atômica">
<img class="elementor-element" data-id="image-1" src="/hero.png" onerror="alert(2)">
<a href="javascript:alert(3)">Link inseguro</a>
<form action="/send" onsubmit="alert(4)"><input name="email"><button>Enviar</button></form>
<iframe srcdoc="<script>alert(5)</script>" src="data:text/html,unsafe"></iframe>
<object data="javascript:alert(6)"></object><embed src="data:application/xhtml+xml,unsafe">
</section></main><style>html.lenis,html.lenis body{height:auto}.lenis-smooth{scroll-behavior:auto}</style>
<script src="/vendor/lenis.min.js"></script><script>const lenis=new Lenis();requestAnimationFrame(t=>lenis.raf(t));</script>
<script src="/elementor.js"></script>
</body></html>
HTML;
kodety_url_import_assert($detect_platform->invoke($plugin, $elementor_source) === 'elementor', 'HTML do Elementor precisa selecionar o perfil de runtime publicado');
$elementor_prepared = (string) $prepare->invoke($plugin, $elementor_source, 'https://example.test/', 'elementor');
$elementor_prepared_decoded = html_entity_decode($elementor_prepared, ENT_QUOTES | ENT_HTML5, 'UTF-8');
kodety_url_import_assert(str_contains($elementor_prepared, '<script') && str_contains($elementor_prepared, 'src="https://example.test/elementor.js"'), 'a página publicada Elementor precisa preservar seu runtime executável');
kodety_url_import_assert(!preg_match('/\son(?:click|error|submit)=/i', $elementor_prepared), 'handlers inline Elementor precisam ser removidos');
kodety_url_import_assert(!str_contains(strtolower($elementor_prepared), 'javascript:'), 'URLs executáveis do HTML Elementor precisam ser neutralizadas');
kodety_url_import_assert(!str_contains(strtolower($elementor_prepared), '!important'), 'a cascata Elementor precisa ser normalizada para o contrato editável do Kodety');
kodety_url_import_assert(preg_match('/class="[^"]*\belementor-invisible\b/i', $elementor_prepared) === 1, 'classes de entrada do Elementor precisam permanecer para o runtime original');
kodety_url_import_assert(str_contains($elementor_prepared_decoded, 'data-label="Título"') && str_contains($elementor_prepared_decoded, 'data-label="Container Elementor"'), 'widgets e containers Elementor precisam de nomes úteis nas Layers');
kodety_url_import_assert(str_contains($elementor_prepared, 'data-kodety-elementor-source="heading-1"') && str_contains($elementor_prepared, 'data-kodety-elementor-widget="heading.default"'), 'IDs e tipos dos widgets Elementor precisam ficar mapeados no projeto');
kodety_url_import_assert(str_contains($elementor_prepared, 'data-kodety-elementor-widget="text-editor.atomic"') && str_contains($elementor_prepared_decoded, 'data-label="Texto"') && str_contains($elementor_prepared_decoded, 'data-label="Imagem"'), 'widgets atômicos do Elementor precisam ser reconhecidos por tag e classe');
kodety_url_import_assert(str_contains($elementor_prepared, 'elementor-widget-icon-list') && str_contains($elementor_prepared_decoded, 'Item real renderizado'), 'o DOM final renderizado do widget icon-list precisa sobreviver à preparação');
kodety_url_import_assert(!str_contains(strtolower($elementor_prepared), 'lenis.min.js') && !preg_match('/\bnew\s+Lenis\s*\(/i', $elementor_prepared) && str_contains($elementor_prepared, 'data-kodety-native-scroll'), 'Lenis deve ser removido sem descartar o restante do runtime Elementor');
kodety_url_import_assert(!str_contains($elementor_prepared_decoded, 'precisa ser revisado após a conversão'), 'a importação publicada não pode fabricar o placeholder do conversor estrutural');
kodety_url_import_assert(str_contains($elementor_prepared, 'data-kodety-elementor-form="preserved"'), 'formulários publicados precisam continuar reais e identificáveis');
kodety_url_import_assert(preg_match('/<(?:input|button)\b[^>]*\sdisabled(?:=|[\s>])/i', $elementor_prepared) === 0, 'controles Elementor não podem ser desabilitados durante a importação publicada');
kodety_url_import_assert(preg_match('/<(?:iframe|object|embed)\b/i', $elementor_prepared) === 1 && !str_contains(strtolower($elementor_prepared), 'srcdoc='), 'widgets de embed precisam permanecer, com superfícies HTML executáveis neutralizadas');
$webflow_prepared = (string) $prepare->invoke($plugin, $webflow_source, 'https://example.test/', 'webflow');
kodety_url_import_assert(str_contains($webflow_prepared, '<script'), 'scripts Webflow precisam permanecer no projeto');
kodety_url_import_assert(str_contains($webflow_prepared, 'modulepreload'), 'preload de módulos deve permanecer para runtimes preservados');
kodety_url_import_assert(str_contains($webflow_prepared, 'data-w-id="nav-1"'), 'identificadores IX2 do Webflow precisam permanecer');
kodety_url_import_assert(str_contains($webflow_prepared, 'https://example.test/component.js'), 'imports inline relativos precisam ser absolutizados');
kodety_url_import_assert(str_contains($webflow_prepared, 'window.kodetyText="começa"'), 'scripts importados devem preservar UTF-8 literal');
kodety_url_import_assert(str_contains($webflow_prepared, 'window.kodetyLiteral="&amp;"'), 'scripts importados devem preservar entidades intencionais');
$webflow_prepared_dom = new DOMDocument();
@$webflow_prepared_dom->loadHTML($webflow_prepared, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_COMPACT);
$webflow_badges = 0;
foreach ($webflow_prepared_dom->getElementsByTagName('*') as $webflow_element) {
    if (!$webflow_element instanceof DOMElement) continue;
    $webflow_classes = preg_split('~\s+~', trim($webflow_element->getAttribute('class'))) ?: [];
    if (in_array('w-webflow-badge', $webflow_classes, true)) $webflow_badges++;
}
kodety_url_import_assert($webflow_badges === 0, 'a badge estática Made in Webflow deve ser removida da árvore importada');
kodety_url_import_assert(str_contains($webflow_prepared, 'data-kodety-platform-branding-cleanup'), 'o runtime Webflow precisa remover reinserções tardias da badge');
kodety_url_import_assert(!$webflow_prepared_dom->documentElement?->hasAttribute('data-wf-status'), 'o sinalizador que recria a badge do Webflow deve ser removido');
kodety_url_import_assert(str_contains($webflow_prepared, 'html body a.w-webflow-badge'), 'a badge deve permanecer invisível mesmo antes do observador remover uma reinserção');
$dedupe_dom = new DOMDocument();
$dedupe_dom->loadHTML('<html><body>'
    . '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>'
    . '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.11.3/gsap.min.js"></script>'
    . '<script src="https://unpkg.com/split-type"></script><script src="https://unpkg.com/split-type"></script>'
    . '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.11.3/ScrollTrigger.min.js"></script>'
    . '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.8.0/ScrollTrigger.min.js"></script>'
    . '</body></html>');
$prune_runtime = $reflection->getMethod('import_prune_duplicate_runtime_scripts');
$prune_runtime->invoke($plugin, $dedupe_dom);
$deduped = (string) $dedupe_dom->saveHTML();
kodety_url_import_assert(str_contains($deduped, '/gsap/3.12.2/gsap.min.js') && !str_contains($deduped, '/gsap/3.11.3/gsap.min.js'), 'a versão GSAP mais nova já carregada deve vencer duplicatas posteriores');
kodety_url_import_assert(substr_count($deduped, 'unpkg.com/split-type') === 1, 'SplitType idêntico deve ser carregado uma única vez');
kodety_url_import_assert(str_contains($deduped, '/gsap/3.11.3/ScrollTrigger.min.js') && !str_contains($deduped, '/gsap/3.8.0/ScrollTrigger.min.js'), 'ScrollTrigger antigo duplicado deve ser removido');

$dependency_dom = new DOMDocument();
$dependency_dom->loadHTML('<html><body>'
    . '<script defer src="app.js"></script>'
    . '<script defer src="gsap.min.js"></script>'
    . '<script defer src="CustomEase.min.js"></script>'
    . '<script>gsap.registerPlugin(CustomEase);</script>'
    . '</body></html>');
$stabilize_dependencies = $reflection->getMethod('stabilize_script_dependencies');
$stabilize_dependencies->invoke($plugin, $dependency_dom, static fn(DOMElement $script): string => str_contains($script->getAttribute('src'), 'app.js') ? 'CustomEase.create("page", "0,0,1,1"); gsap.defaults({ease:"page"});' : '');
$stable_dependencies = (string) $dependency_dom->saveHTML();
kodety_url_import_assert(strpos($stable_dependencies, 'gsap.min.js') < strpos($stable_dependencies, 'CustomEase.min.js') && strpos($stable_dependencies, 'CustomEase.min.js') < strpos($stable_dependencies, 'app.js'), 'GSAP e plugins precisam preceder o bundle autoral consumidor');
kodety_url_import_assert(!preg_match('~<script[^>]+(?:gsap|CustomEase)[^>]+defer~i', $stable_dependencies), 'dependências usadas por script inline devem permanecer síncronas');

$capture_prepare = $reflection->getMethod('prepare_capture_html');
$capture_document = (string) $capture_prepare->invoke($plugin, $source, 'https://example.test/', 10, 'capture_token_123');
kodety_url_import_assert(str_contains($capture_document, '<base href="https://example.test/">'), 'a captura precisa resolver assets contra a URL de origem');
kodety_url_import_assert(str_contains($capture_document, 'sandbox') === false, 'o sandbox deve ser imposto pelo iframe, não pelo documento remoto');
kodety_url_import_assert(str_contains($capture_document, 'kodety-rendered-capture'), 'o documento deve devolver o DOM renderizado');
kodety_url_import_assert(str_contains($capture_document, 'delay=10000'), 'a captura deve respeitar os 10 segundos após load');
kodety_url_import_assert(str_contains($capture_document, 'capture_token_123'), 'a mensagem deve ficar vinculada ao token do editor');
kodety_url_import_assert(str_contains($capture_document, 'Element.prototype.animate'), 'a captura deve observar animações WAAPI antes da hidratação');
kodety_url_import_assert(str_contains($capture_document, 'pointerenter'), 'a captura deve sondar estados Hover do Framer');
kodety_url_import_assert(str_contains($capture_document, '"active"'), 'a captura deve sondar estados Pressed do Framer');
kodety_url_import_assert(str_contains($capture_document, 'kodety-framer-import'), 'a captura deve persistir o manifesto de conversão');
kodety_url_import_assert(str_contains($capture_document, 'Date.now()+12000'), 'a sondagem de interações deve ter orçamento máximo');
kodety_url_import_assert(str_contains($capture_document, 'setTimeout(resolve,24)'), 'a sondagem oculta não pode depender de requestAnimationFrame');
kodety_url_import_assert(str_contains($capture_document, 'sanitizeCapturedSources'), 'srcsets Data URL inválidos devem ser removidos da captura');
kodety_url_import_assert(str_contains($capture_document, 'manifestJson.length>600000'), 'o manifesto deve respeitar um limite de tamanho');
kodety_url_import_assert(str_contains($capture_document, 'captureExistingAnimations'), 'animações ainda presentes no documento devem entrar no manifesto');
kodety_url_import_assert(str_contains($capture_document, 'performance.getEntriesByType("resource")'), 'a janela de captura deve registrar módulos realmente carregados');
kodety_url_import_assert(str_contains($capture_document, 'runtimeModuleUrls') && str_contains($capture_document, 'runtimeEntrypoints'), 'o grafo ESM observado deve entrar no manifesto Framer');
kodety_url_import_assert(str_contains($capture_document, 'settleCapturedAnimationStates'), 'o último keyframe precisa ser materializado no DOM capturado');
kodety_url_import_assert(str_contains($capture_document, 'data-kodety-framer-motion'), 'alvos animados precisam ser reconhecidos pelo canvas');
kodety_url_import_assert(str_contains($capture_document, 'restingHtml=serializeRestingDocument()'), 'a captura deve congelar DOM e CSSOM de repouso antes de forçar estados interativos');
kodety_url_import_assert(str_contains($capture_document, 'return renderCapturedDocument(restingHtml,rules,baseRules,manifestJson)'), 'regras sondadas devem ser anexadas a uma cópia limpa, não ao DOM contaminado pelos eventos');
kodety_url_import_assert(str_contains($capture_document, '!target.isConnected') && str_contains($capture_document, 'String(value).trim()!==""'), 'nós substituídos por variantes Framer não podem gerar declarações CSS vazias');
kodety_url_import_assert(str_contains($capture_document, 'lightweight=document.documentElement.hasAttribute("data-kodety-breakpoint-capture")'), 'capturas responsivas secundárias precisam usar o modo leve');

// Framer's SVG symbol warehouse must not consume the complete DOM-edit sync
// baseline before ordinary text and sections that appear later in the page.
$sync_dom = new DOMDocument();
$svg_paths = str_repeat('<path d="M0 0h1v1z"></path>', 3600);
@$sync_dom->loadHTML('<!doctype html><html><body><main id="main" data-framer-root><svg id="large-artwork">' . $svg_paths . '</svg><section id="after-svg"><p id="editable-after-svg">Texto editável</p></section></main></body></html>', LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_COMPACT);
$attach_runtime = $reflection->getMethod('import_attach_framer_compat_runtime');
kodety_url_import_assert($attach_runtime->invoke($plugin, $sync_dom, 'scripts/vendor/runtime.mjs', []) === true, 'o bridge Framer deve ser instalável em páginas com SVG grande');
$sync_baseline = null;
$sync_guard = '';
foreach ($sync_dom->getElementsByTagName('script') as $script) {
    if ($script->hasAttribute('data-kodety-framer-baseline')) $sync_baseline = json_decode($script->textContent, true);
    if ($script->hasAttribute('data-kodety-framer-edit-guard')) $sync_guard = $script->textContent;
}
$synced_ids = array_map(static fn(array $node): string => (string) ($node['attrs']['id'] ?? ''), is_array($sync_baseline['nodes'] ?? null) ? $sync_baseline['nodes'] : []);
kodety_url_import_assert(in_array('editable-after-svg', $synced_ids, true), 'textos após SVGs complexos precisam entrar no mapa de sincronização');
kodety_url_import_assert(count($sync_baseline['nodes'] ?? []) < 20, 'paths internos de SVG não devem virar milhares de nós sincronizados');
$sync_nodes = is_array($sync_baseline['nodes'] ?? null) ? $sync_baseline['nodes'] : [];
$editable_node = current(array_filter($sync_nodes, static fn(array $node): bool => ($node['attrs']['id'] ?? '') === 'editable-after-svg'));
kodety_url_import_assert(
    is_array($editable_node)
        && array_key_exists('parent', $editable_node)
        && array_key_exists('next', $editable_node)
        && ($editable_node['parent'] ?? '') !== '',
    'o baseline precisa gravar parent/next para distinguir movimento, remoção e recriação durante a hidratação'
);
kodety_url_import_assert(str_contains($sync_guard, 'placements=new Map()') && str_contains($sync_guard, 'applyPlacement'), 'mover e reordenar seções deve sobreviver à hidratação');
kodety_url_import_assert(str_contains($sync_guard, 'replaceTag') && str_contains($sync_guard, 'change.tag'), 'alterações semânticas de tag HTML devem sobreviver à hidratação');
kodety_url_import_assert(str_contains($sync_guard, 'syncSplitText') && str_contains($sync_guard, 'applyLeaf'), 'texto editado deve atualizar spans animados sem destruir a estrutura da animação');
kodety_url_import_assert(str_contains($sync_guard, '#__framer-badge-container,#framer-badge-container,.__framer-badge') && str_contains($sync_guard, 'pruneBranding'), 'a hidratação Framer não pode reinserir nenhuma variante da badge no canvas ou na publicação');

$bundle = $reflection->getMethod('import_bundle_page_assets');
$manifest = rawurlencode(json_encode([
    'version' => 1,
    'source' => 'framer-runtime',
    'breakpoints' => [['id' => 'framer-max-794', 'label' => 'Framer ≤ 794', 'mode' => 'max-width', 'width' => 794]],
    'animations' => [],
], JSON_UNESCAPED_SLASHES));
$captured_prepared = str_replace('</head>', '<style data-kodety-framer-interactions>.kodety-framer-trigger-1:hover { opacity: .7; }</style><meta name="kodety-framer-import" content="' . htmlspecialchars($manifest, ENT_QUOTES, 'UTF-8') . '"></head>', $prepared);
$zip_path = (string) $bundle->invoke($plugin, $captured_prepared, 'https://example.test/');
$zip = new ZipArchive();
kodety_url_import_assert($zip->open($zip_path) === true, 'o resultado deve ser um ZIP válido');
$index = (string) $zip->getFromName('index.html');
$interaction_css = (string) $zip->getFromName('styles/framer-interactions.css');
$framer_manifest = (string) $zip->getFromName('.incode/framer-import.json');
$url_manifest = (string) $zip->getFromName('.incode/url-import.json');
$names = [];
for ($index_number = 0; $index_number < $zip->numFiles; $index_number++) $names[] = (string) $zip->getNameIndex($index_number);
$framer_runtime_name = current(array_filter($names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'runtime.js')));
$framer_runtime = is_string($framer_runtime_name) ? (string) $zip->getFromName($framer_runtime_name) : '';
$zip->close();
@unlink($zip_path);

kodety_url_import_assert(!preg_match('~<(?:img|source)\b[^>]*\bsrc=["\']https://example\.test/hero\.png~i', $index) && str_contains($index, 'assets/imported/'), 'imagens renderizadas devem apontar para o projeto');
kodety_url_import_assert(!preg_match('~url\(["\']?https://example\.test/font\.woff2~i', $index), 'fontes do CSS devem apontar para o projeto');
kodety_url_import_assert(str_contains($index, 'href="https://example.test/produto"'), 'links comuns não devem virar assets');
kodety_url_import_assert(str_contains($index, 'styles/framer-interactions.css'), 'o CSS convertido deve ficar anexado à página');
kodety_url_import_assert(str_contains($interaction_css, ':hover'), 'Hover convertido deve virar uma CSS Rule nativa');
kodety_url_import_assert(str_contains($framer_manifest, 'framer-max-794'), 'breakpoints e animações devem permanecer no manifesto do projeto');
kodety_url_import_assert(str_contains($framer_manifest, 'framer-hero') && str_contains($framer_manifest, 'Hero principal'), 'animação appear exata deve ser empacotada e identificável no Builder');
kodety_url_import_assert(str_contains($framer_manifest, 'cubic-bezier(0.2,0.8,0.2,1)'), 'easing exato do Framer deve ser preservado');
kodety_url_import_assert(str_contains($framer_manifest, 'handoverRaw'), 'dados de hidratação devem ficar disponíveis como fonte inerte');
kodety_url_import_assert(str_contains($url_manifest, '"platform": "framer"'), 'o perfil usado deve ficar registrado no projeto');
kodety_url_import_assert(str_contains($url_manifest, '"runtime": "preserved-guarded"'), 'o bundle deve declarar o runtime Framer local protegido');
kodety_url_import_assert(str_contains($index, 'data-kodety-framer-baseline') && str_contains($index, 'data-kodety-framer-edit-guard'), 'a hidratação precisa preservar diferenças feitas no canvas');
kodety_url_import_assert(str_contains($index, 'requestAnimationFrame(apply)') && str_contains($index, 'attributeFilter:["class","style","src","srcset","poster","href"]'), 'o guardião de edições não pode fazer varredura completa a cada mutação do Motion');
kodety_url_import_assert(!str_contains($index, 'Promise.resolve().then(apply)'), 'o guardião Framer não pode criar um loop de microtasks durante animações');
kodety_url_import_assert(str_contains($index, 'data-kodety-framer-compat-runtime') && !str_contains($index, 'src="https://example.test/runtime.mjs"'), 'o entrypoint Framer deve executar somente pela cópia local');
kodety_url_import_assert(str_contains($framer_manifest, '"runtime": true') && str_contains($framer_manifest, 'localizedRuntimeEntrypoint'), 'o manifesto deve impedir conversão Motion duplicada quando a hidratação fiel existe');
kodety_url_import_assert(count(array_filter($names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'framer-component.js'))) === 1, 'imports dinâmicos com crase precisam ser arquivados transitivamente como JavaScript local');
kodety_url_import_assert(str_contains($framer_runtime, 'import(`./') && str_contains($framer_runtime, 'framer-component.js'), 'imports dinâmicos do Framer devem apontar para o chunk vendor local com MIME compatível');
kodety_url_import_assert(str_contains($framer_runtime, 'assets/imported/') && !str_contains($framer_runtime, 'https://example.test/variant.png'), 'assets declarados dentro de componentes Framer devem virar paths locais');
kodety_url_import_assert(preg_match('~type="framer/handover"[^>]*>[^<]*assets/imported/~i', $index) === 1, 'assets de variantes presentes no handover também devem ficar locais');
kodety_url_import_assert(count(array_filter($names, fn(string $name): bool => str_starts_with($name, 'assets/imported/'))) === 5, 'imagem, capa, variante, fonte e ícone devem ser empacotados uma vez');
kodety_url_import_assert(count(array_filter($GLOBALS['kodety_import_requests'], fn(string $url): bool => $url === 'https://example.test/hero.png')) === 1, 'assets repetidos devem ser deduplicados');
kodety_url_import_assert(count(array_filter($GLOBALS['kodety_import_requests'], fn(string $url): bool => $url === 'https://example.test/missing.png')) === 1, 'assets indisponíveis repetidos não podem entrar em loop de download');
$bundled_dom = new DOMDocument();
@$bundled_dom->loadHTML($index, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_COMPACT);
$same_binary_sources = [];
foreach ($bundled_dom->getElementsByTagName('img') as $image) {
    if (in_array($image->getAttribute('data-test-asset'), ['hero', 'hero-copy'], true)) $same_binary_sources[] = $image->getAttribute('src');
}
kodety_url_import_assert(count($same_binary_sources) === 2 && count(array_unique($same_binary_sources)) === 1, 'URLs diferentes com binário idêntico devem compartilhar um arquivo local');

$static_zip_path = (string) $bundle->invoke($plugin, $captured_prepared, 'https://example.test/', 'framer', 'static');
$static_zip = new ZipArchive();
kodety_url_import_assert($static_zip->open($static_zip_path) === true, 'Framer estático deve gerar um ZIP válido');
$static_index = (string) $static_zip->getFromName('index.html');
$static_url_manifest = (string) $static_zip->getFromName('.incode/url-import.json');
$static_framer_manifest = (string) $static_zip->getFromName('.incode/framer-import.json');
$static_names = [];
for ($index_number = 0; $index_number < $static_zip->numFiles; $index_number++) $static_names[] = (string) $static_zip->getNameIndex($index_number);
$static_zip->close();
@unlink($static_zip_path);
kodety_url_import_assert(str_contains($static_url_manifest, '"framerMode": "static"') && str_contains($static_url_manifest, '"runtime": "static-editable"'), 'o modo estático precisa ser identificado como editável');
kodety_url_import_assert(str_contains($static_framer_manifest, '"runtime": false') && preg_match('~"animations"\s*:\s*\[\s*\]~', $static_framer_manifest), 'o manifesto estático não pode reativar hidratação ou animações de entrada');
kodety_url_import_assert(!str_contains($static_index, 'framer/handover') && !str_contains($static_index, 'data-kodety-framer-baseline') && !str_contains($static_index, 'data-kodety-framer-compat-runtime'), 'handover e guardião de hidratação não podem entrar no projeto estático');
kodety_url_import_assert(count(array_filter($static_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/'))) === 0, 'o modo estático não deve baixar o grafo React/Motion do Framer');
kodety_url_import_assert(str_contains($static_index, 'styles/framer-interactions.css'), 'estados CSS capturados devem continuar editáveis no modo estático');

// Re-converting an archived hydrated document must remove the executable owned
// nodes, not just their marker attributes (which would leave hydration active).
$static_reimport_source = '<!doctype html><html><head><script type="application/ld+json">{"@type":"WebPage","name":"Projeto editável"}</script>'
    . '<script type="application/json" id="page-data">{"locale":"pt-BR"}</script></head><body>'
    . '<main id="main" data-framer-root data-framer-hydrate-v2="{}"><h1 data-label="Título">Conteúdo autoral</h1></main>'
    . '<script data-kodety-framer-compat-runtime>window.hydrateAgain=true</script>'
    . '<script data-kodety-framer-edit-guard>window.guardAgain=true</script>'
    . '<script type="application/json" data-kodety-framer-baseline>{"nodes":[]}</script></body></html>';
$inert_prepared = (string) $prepare->invoke($plugin, $static_reimport_source, 'https://example.test/', 'framer');
kodety_url_import_assert(str_contains($inert_prepared, 'application/ld+json') && str_contains($inert_prepared, 'id="page-data"'), 'remoção de hydration deve conservar dados estruturados SEO e JSON inerte');
$reimport_zip_path = (string) $bundle->invoke($plugin, $static_reimport_source, 'https://example.test/', 'framer', 'static');
$reimport_zip = new ZipArchive();
kodety_url_import_assert($reimport_zip->open($reimport_zip_path) === true, 'reconversão estática deve ser um projeto válido');
$reimport_index = (string) $reimport_zip->getFromName('index.html');
$reimport_manifest = json_decode((string) $reimport_zip->getFromName('.incode/framer-import.json'), true);
$reimport_zip->close();
@unlink($reimport_zip_path);
kodety_url_import_assert(!str_contains($reimport_index, 'hydrateAgain') && !str_contains($reimport_index, 'guardAgain') && !str_contains($reimport_index, 'data-framer-hydrate-v2'), 'reconversão não pode deixar scripts ativos de hydration sem marcadores');
kodety_url_import_assert(str_contains(html_entity_decode($reimport_index, ENT_QUOTES | ENT_HTML5, 'UTF-8'), 'Conteúdo autoral') && str_contains($reimport_index, 'application/ld+json'), 'conteúdo editável e SEO devem sobreviver à reconversão');
kodety_url_import_assert(($reimport_manifest['version'] ?? null) === 1 && ($reimport_manifest['runtime'] ?? null) === false, 'conversão sem manifesto anterior deve gerar metadados estáticos reconhecidos pelo editor');

$elementor_zip_path = (string) $bundle->invoke($plugin, $elementor_prepared, 'https://example.test/', 'elementor', 'animated');
$elementor_zip = new ZipArchive();
kodety_url_import_assert($elementor_zip->open($elementor_zip_path) === true, 'a página publicada Elementor deve gerar um ZIP válido');
$elementor_index = (string) $elementor_zip->getFromName('index.html');
$elementor_url_manifest = (string) $elementor_zip->getFromName('.incode/url-import.json');
$elementor_report = (string) $elementor_zip->getFromName('.incode/elementor-import.json');
$elementor_project = (string) $elementor_zip->getFromName('.incode/project.json');
$elementor_names = [];
for ($index_number = 0; $index_number < $elementor_zip->numFiles; $index_number++) $elementor_names[] = (string) $elementor_zip->getNameIndex($index_number);
$elementor_runtime_name = current(array_filter($elementor_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'elementor.js')));
$elementor_runtime = is_string($elementor_runtime_name) ? (string) $elementor_zip->getFromName($elementor_runtime_name) : '';
$elementor_export_path = getenv('KODETY_ELEMENTOR_TEST_EXPORT');
if (is_string($elementor_export_path) && $elementor_export_path !== '') {
    kodety_url_import_assert(copy($elementor_zip_path, $elementor_export_path), 'o ZIP Elementor de validação precisa ser exportável');
}
$elementor_zip->close();
@unlink($elementor_zip_path);
kodety_url_import_assert(str_contains($elementor_url_manifest, '"platform": "elementor"') && str_contains($elementor_url_manifest, '"runtime": "published-runtime-preserved"'), 'manifesto deve identificar o runtime publicado do Elementor');
kodety_url_import_assert(str_contains($elementor_report, '"mode": "published-runtime"') && str_contains($elementor_report, '"localizedRuntimeFiles"'), 'o projeto deve registrar os arquivos de runtime dos widgets');
kodety_url_import_assert(str_contains($elementor_project, '"mainHtmlPath": "index.html"') && !str_contains($elementor_project, 'projectId'), 'a página publicada precisa de metadata portátil sem inventar identidade');
kodety_url_import_assert(str_contains(strtolower($elementor_index), '<script') && str_contains($elementor_index, 'assets/imported/'), 'a página publicada deve preservar scripts e localizar seus assets');
kodety_url_import_assert(is_string($elementor_runtime_name) && !str_contains($elementor_index, 'https://example.test/elementor.js'), 'o runtime Elementor precisa ser empacotado e referenciado localmente');
kodety_url_import_assert($elementor_runtime === 'window.elementorFrontend={ready:true};', 'o JavaScript dos widgets precisa ser preservado byte por byte');
kodety_url_import_assert(str_contains($elementor_index, 'elementor-widget-icon-list') && str_contains($elementor_index, 'Item real renderizado'), 'o ZIP publicado precisa conter o HTML real do icon-list, não uma reconstrução parcial');
kodety_url_import_assert(!str_contains($elementor_index, 'precisa ser revisado após a conversão'), 'o ZIP publicado não pode conter placeholders do fallback estrutural');

// Same-install Elementor files must be read directly from WordPress' public
// roots when loopback HTTP is unavailable (a common activation-hosting case).
$local_asset_root = WP_CONTENT_DIR . '/plugins/elementor/assets';
@mkdir($local_asset_root . '/css', 0777, true);
@mkdir($local_asset_root . '/js', 0777, true);
@mkdir($local_asset_root . '/images', 0777, true);
file_put_contents(
    $local_asset_root . '/css/frontend-local.css',
    '.elementor-icon-list-item{background-image:url("../images/check.svg")!important}'
);
file_put_contents($local_asset_root . '/js/frontend-local.js', 'window.localElementorFrontend={widgets:true};');
$local_webpack_runtime_bytes = 'var __webpack_require__={};__webpack_require__.u=function(){return"tabs.hash.bundle.min.js"};';
$local_webpack_chunk_bytes = 'self.webpackChunkElementor=self.webpackChunkElementor||[];self.webpackChunkElementor.push([["tabs"],{}]);';
file_put_contents($local_asset_root . '/js/webpack.runtime.min.js', $local_webpack_runtime_bytes);
file_put_contents($local_asset_root . '/js/tabs.hash.bundle.min.js', $local_webpack_chunk_bytes);
file_put_contents($local_asset_root . '/images/check.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 4l3 3 7-7"/></svg>');
$remote_base_requests_before = count($GLOBALS['kodety_import_requests']);
$remote_base_source = '<!doctype html><html><head>'
    . '<base href="https://local.test/wp-content/plugins/elementor/assets/css/">'
    . '<link rel="stylesheet" href="frontend-local.css"></head>'
    . '<body><main data-elementor-type="wp-page" data-elementor-id="909">Remoto</main></body></html>';
$remote_base_prepared = (string) $prepare->invoke($plugin, $remote_base_source, 'https://example.test/remote-base/', 'elementor');
$remote_base_requests = array_slice($GLOBALS['kodety_import_requests'], $remote_base_requests_before);
kodety_url_import_assert(
    in_array('https://local.test/wp-content/plugins/elementor/assets/css/frontend-local.css', $remote_base_requests, true),
    'um <base> remoto apontando ao WordPress local deve passar por HTTP, sem elevar autorização de filesystem'
);
kodety_url_import_assert(
    str_contains($remote_base_prepared, 'href="https://local.test/wp-content/plugins/elementor/assets/css/frontend-local.css"')
        && !str_contains($remote_base_prepared, '.elementor-icon-list-item{background-image'),
    'o documento remoto deve manter o asset inacessível remoto e nunca ler o arquivo local existente'
);
$local_elementor_source = <<<'HTML'
<!doctype html><html><head><meta name="generator" content="Elementor 3.25">
<link rel="stylesheet" href="https://local.test/wp-content/plugins/elementor/assets/css/frontend-local.css">
</head><body class="elementor-page-202"><main data-elementor-type="wp-page" data-elementor-id="202">
<div class="elementor-element elementor-widget elementor-widget-icon-list" data-id="local-icon-list" data-element_type="widget" data-widget_type="icon-list.default"><ul class="elementor-icon-list-items"><li class="elementor-icon-list-item"><span class="elementor-icon-list-text">Widget local publicado</span></li></ul></div>
</main><script src="https://local.test/wp-content/plugins/elementor/assets/js/frontend-local.js"></script>
<script src="https://local.test/wp-content/plugins/elementor/assets/js/webpack.runtime.min.js"></script></body></html>
HTML;
$local_requests_before = count($GLOBALS['kodety_import_requests']);
$local_elementor_prepared = (string) $prepare->invoke($plugin, $local_elementor_source, 'https://local.test/', 'elementor');
kodety_url_import_assert(str_contains($local_elementor_prepared, '.elementor-icon-list-item') && !str_contains($local_elementor_prepared, 'frontend-local.css'), 'CSS local do Elementor deve ser lido do disco e incorporado sem loopback HTTP');
$local_elementor_zip_path = (string) $bundle->invoke($plugin, $local_elementor_prepared, 'https://local.test/', 'elementor', 'animated');
$local_elementor_zip = new ZipArchive();
kodety_url_import_assert($local_elementor_zip->open($local_elementor_zip_path) === true, 'assets locais do Elementor devem gerar um ZIP válido');
$local_elementor_index = (string) $local_elementor_zip->getFromName('index.html');
$local_elementor_names = [];
for ($index_number = 0; $index_number < $local_elementor_zip->numFiles; $index_number++) $local_elementor_names[] = (string) $local_elementor_zip->getNameIndex($index_number);
$local_elementor_runtime_name = current(array_filter($local_elementor_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'frontend-local.js')));
$local_elementor_runtime = is_string($local_elementor_runtime_name) ? (string) $local_elementor_zip->getFromName($local_elementor_runtime_name) : '';
$local_webpack_runtime_name = current(array_filter($local_elementor_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, '/webpack.runtime.min.js')));
$local_webpack_chunk_name = is_string($local_webpack_runtime_name)
    ? dirname($local_webpack_runtime_name) . '/tabs.hash.bundle.min.js'
    : '';
$local_webpack_runtime = is_string($local_webpack_runtime_name) ? (string) $local_elementor_zip->getFromName($local_webpack_runtime_name) : '';
$local_webpack_chunk = $local_webpack_chunk_name !== '' ? (string) $local_elementor_zip->getFromName($local_webpack_chunk_name) : '';
$local_elementor_zip->close();
@unlink($local_elementor_zip_path);
kodety_url_import_assert(count($GLOBALS['kodety_import_requests']) === $local_requests_before, 'resolver local não deve tentar HTTP para CSS, JavaScript ou imagens do próprio WordPress');
kodety_url_import_assert(is_string($local_elementor_runtime_name) && $local_elementor_runtime === 'window.localElementorFrontend={widgets:true};', 'JavaScript local do Elementor deve ser empacotado byte por byte');
kodety_url_import_assert(
    is_string($local_webpack_runtime_name)
        && dirname($local_webpack_runtime_name) === dirname($local_webpack_chunk_name)
        && in_array($local_webpack_chunk_name, $local_elementor_names, true),
    'runtime Webpack e chunk lazy do widget Elementor devem ficar lado a lado com o basename exato'
);
kodety_url_import_assert($local_webpack_runtime === $local_webpack_runtime_bytes, 'runtime Webpack Elementor deve ser preservado byte por byte');
kodety_url_import_assert($local_webpack_chunk === $local_webpack_chunk_bytes, 'chunk *.bundle.min.js do widget Elementor deve ser preservado byte por byte');
kodety_url_import_assert(str_contains($local_elementor_index, 'assets/imported/') && !str_contains($local_elementor_index, 'https://local.test/wp-content/'), 'CSS, imagem e runtime locais devem apontar apenas para arquivos do projeto');
kodety_url_import_assert(str_contains($local_elementor_index, 'Widget local publicado') && !str_contains($local_elementor_index, 'precisa ser revisado'), 'o widget local renderizado precisa permanecer real no ZIP');
@unlink($local_asset_root . '/css/frontend-local.css');
@unlink($local_asset_root . '/js/frontend-local.js');
@unlink($local_asset_root . '/js/webpack.runtime.min.js');
@unlink($local_asset_root . '/js/tabs.hash.bundle.min.js');
@unlink($local_asset_root . '/images/check.svg');
@rmdir($local_asset_root . '/css');
@rmdir($local_asset_root . '/js');
@rmdir($local_asset_root . '/images');
@rmdir($local_asset_root);
@rmdir(WP_CONTENT_DIR . '/plugins/elementor');
@rmdir(WP_CONTENT_DIR . '/plugins');
@rmdir(WP_CONTENT_DIR);

$fetch_external = $reflection->getMethod('fetch_external_project');
$forced_non_elementor = $fetch_external->invoke($plugin, 'https://example.test/not-elementor/', 0, '', 'elementor', 'animated');
kodety_url_import_assert(
    $forced_non_elementor instanceof WP_Error
        && $forced_non_elementor->get_error_code() === 'kodety_import_not_elementor'
        && ($forced_non_elementor->get_error_data()['status'] ?? null) === 422,
    'selecionar Elementor não pode rotular uma página comum como projeto Elementor'
);

$native_bundle = $reflection->getMethod('elementor_native_project_zip');
$read_globals = $reflection->getMethod('elementor_import_globals');
$original_kit = $GLOBALS['kodety_elementor_test_meta'][501]['_elementor_page_settings'];
$GLOBALS['kodety_elementor_test_meta'][501]['_elementor_page_settings'] = array_merge($original_kit, [
    'active_breakpoints' => ['viewport_mobile', 'viewport_tablet', 'viewport_mobile_extra', 'viewport_widescreen'],
    'viewport_mobile' => 720,
    'viewport_tablet' => 1100,
    'viewport_mobile_extra' => 880,
    'viewport_widescreen' => 2400,
    'custom_typography' => [['_id' => 'body', 'typography_font_family' => 'Demo', 'typography_font_size_mobile' => ['unit' => 'px', 'size' => 18], 'typography_font_style' => 'italic']],
]);
$resolved_globals = $read_globals->invoke($plugin);
kodety_url_import_assert(($resolved_globals['breakpoints']['mobile'] ?? null) === 720 && ($resolved_globals['breakpoints']['tablet'] ?? null) === 1100, 'integração deve ler larguras reais do Kit');
kodety_url_import_assert(isset($resolved_globals['breakpoints']['mobile_extra'], $resolved_globals['breakpoints']['widescreen']) && !isset($resolved_globals['breakpoints']['laptop']), 'breakpoints extras devem respeitar ativação do Kit');
kodety_url_import_assert(($resolved_globals['typography']['body']['font_size_mobile']['size'] ?? null) === 18 && ($resolved_globals['typography']['body']['font_style'] ?? null) === 'italic', 'tokens tipográficos devem preservar dispositivos e estilo');
$GLOBALS['kodety_elementor_test_meta'][501]['_elementor_page_settings'] = $original_kit;
$GLOBALS['kodety_import_fixtures']['https://example.test/landing/'][1] = str_replace('<html><body>', '<html><head><link rel="stylesheet" href="/site.css"></head><body>', $GLOBALS['kodety_import_fixtures']['https://example.test/landing/'][1]);
$native_zip_path = $native_bundle->invoke($plugin, 101, 'https://example.test/landing/');
kodety_url_import_assert(is_string($native_zip_path) && is_file($native_zip_path), 'a conversão nativa integrada deve produzir um arquivo temporário');
$native_zip = new ZipArchive();
kodety_url_import_assert($native_zip->open($native_zip_path) === true, 'a conversão nativa integrada deve gerar um ZIP válido');
$native_index = (string) $native_zip->getFromName('index.html');
$native_css = (string) $native_zip->getFromName('css/elementor-converted.css');
$native_project = (string) $native_zip->getFromName('.incode/project.json');
$native_report = (string) $native_zip->getFromName('.incode/elementor-import.json');
$native_url_manifest = $native_zip->getFromName('.incode/url-import.json');
$native_names = [];
for ($index_number = 0; $index_number < $native_zip->numFiles; $index_number++) $native_names[] = (string) $native_zip->getNameIndex($index_number);
$native_zip->close();
@unlink($native_zip_path);
kodety_url_import_assert(str_contains($native_index, 'css/elementor-converted.css') && !str_contains(strtolower($native_index), '<script'), 'ZIP nativo deve usar HTML editável com CSS externo e sem runtime');
kodety_url_import_assert(str_contains($native_index, 'elementor-101-native-heading') && str_contains($native_index, 'data-kodety-elementor-preserved="rendered-html"'), 'ZIP nativo deve preservar IDs estáveis e reconhecer widgets renderizados');
kodety_url_import_assert(str_contains($native_index, 'assets/imported/') && count(array_filter($native_names, fn(string $name): bool => str_starts_with($name, 'assets/imported/'))) >= 1, 'assets do ZIP nativo devem ficar autocontidos');
kodety_url_import_assert(str_contains($native_css, '--elementor-primary:#573cff') && !str_contains(strtolower($native_css), '!important'), 'CSS nativo deve resolver tokens do Kit sem prioridades');
kodety_url_import_assert(str_contains($native_project, '"breakpointSchemaVersion": 2') && !str_contains($native_project, 'projectId'), 'metadata nativa deve selar breakpoints sem inventar identidade');
kodety_url_import_assert(str_contains($native_report, '"mode": "native"') && str_contains($native_report, '"sourceDataSha256"'), 'relatório nativo deve registrar modo e digest da origem sem copiar os dados brutos');
kodety_url_import_assert($native_url_manifest === false, 'ZIP nativo não deve herdar o manifesto do importador visual/publicador');
kodety_url_import_assert(str_contains($native_css, '@font-face') && preg_match('~url\(["\']?\.\./assets/imported/[^)]+woff2~', $native_css) === 1, 'fontes reais da página Elementor devem ficar locais e relativas ao CSS nativo');
kodety_url_import_assert(!str_contains($native_css, '.hero{'), 'preservar fontes não pode reintroduzir o layout original por cima do CSS nativo');
kodety_url_import_assert((json_decode($native_report, true)['fontFaceCount'] ?? 0) === 1, 'o relatório nativo deve indicar as fontes preservadas');

$webflow_zip_path = (string) $bundle->invoke($plugin, $webflow_prepared, 'https://example.test/', 'webflow');
$webflow_zip = new ZipArchive();
kodety_url_import_assert($webflow_zip->open($webflow_zip_path) === true, 'Webflow deve gerar um ZIP válido');
$webflow_index = (string) $webflow_zip->getFromName('index.html');
$webflow_manifest = (string) $webflow_zip->getFromName('.incode/url-import.json');
$webflow_names = [];
for ($index_number = 0; $index_number < $webflow_zip->numFiles; $index_number++) $webflow_names[] = (string) $webflow_zip->getNameIndex($index_number);
$localized_module_name = current(array_filter($webflow_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'app.js')));
$localized_module = is_string($localized_module_name) ? (string) $webflow_zip->getFromName($localized_module_name) : '';
$webflow_zip->close();
@unlink($webflow_zip_path);
kodety_url_import_assert(!str_contains($webflow_index, 'https://example.test/webflow.js'), 'o runtime Webflow deve deixar de depender da origem');
kodety_url_import_assert(count(array_filter($webflow_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'webflow.js'))) === 1, 'o runtime Webflow precisa ser empacotado localmente');
kodety_url_import_assert(count(array_filter($webflow_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'dep.js'))) === 1, 'dependências transitivas de módulos precisam ser empacotadas com extensão servida como JavaScript');
kodety_url_import_assert(str_contains($localized_module, 'import "./') && str_contains($localized_module, 'dep.js'), 'imports de módulos locais precisam ser reescritos para o vendor com MIME compatível');
kodety_url_import_assert(str_contains($webflow_manifest, '"runtime": "preserved"'), 'o bundle deve declarar runtime preservado');
kodety_url_import_assert(str_contains($webflow_index, 'window.kodetyText="começa"'), 'bundle Webflow deve preservar UTF-8 nos scripts');
kodety_url_import_assert(str_contains($webflow_index, 'window.kodetyLiteral="&amp;"'), 'bundle Webflow deve preservar entidades autorais nos scripts');

$broken_manifest = rawurlencode(json_encode([
    'version' => 1,
    'source' => 'framer-runtime',
    'animations' => [],
    'embedded' => [
        'runtimeModuleUrls' => ['https://example.test/broken.mjs'],
        'runtimeEntrypoints' => ['https://example.test/broken.mjs'],
    ],
], JSON_UNESCAPED_SLASHES));
$broken_source = '<!doctype html><html><head><meta name="kodety-framer-import" content="' . htmlspecialchars($broken_manifest, ENT_QUOTES, 'UTF-8') . '"></head><body><main data-framer-root>Fallback estático</main></body></html>';
$broken_zip_path = (string) $bundle->invoke($plugin, $broken_source, 'https://example.test/', 'framer');
$broken_zip = new ZipArchive();
kodety_url_import_assert($broken_zip->open($broken_zip_path) === true, 'runtime Framer parcial ainda deve gerar um projeto válido');
$broken_index = (string) $broken_zip->getFromName('index.html');
$broken_url_manifest = (string) $broken_zip->getFromName('.incode/url-import.json');
$broken_framer_manifest = (string) $broken_zip->getFromName('.incode/framer-import.json');
$broken_names = [];
for ($index_number = 0; $index_number < $broken_zip->numFiles; $index_number++) $broken_names[] = (string) $broken_zip->getNameIndex($index_number);
$broken_zip->close();
@unlink($broken_zip_path);
kodety_url_import_assert(str_contains($broken_url_manifest, '"runtime": "archived-incompatible"'), 'grafo ESM incompleto não pode ser executado no canvas');
kodety_url_import_assert(str_contains($broken_url_manifest, 'missing-runtime.mjs'), 'o diagnóstico precisa identificar o chunk que não foi localizado');
kodety_url_import_assert(!str_contains($broken_index, 'data-kodety-framer-compat-runtime'), 'runtime incompatível deve permanecer inerte');
kodety_url_import_assert(str_contains($broken_framer_manifest, '"runtime": false') && str_contains($broken_framer_manifest, 'archived-incompatible'), 'o conversor deve assumir animações quando o runtime arquivado não é executável');
kodety_url_import_assert(count(array_filter($broken_names, fn(string $name): bool => str_starts_with($name, 'scripts/vendor/') && str_ends_with($name, 'broken.js'))) === 1, 'arquivos já baixados do grafo incompatível não podem ser perdidos');
kodety_url_import_assert(count(array_filter($GLOBALS['kodety_import_requests'], fn(string $url): bool => $url === 'https://example.test/missing-runtime.mjs')) === 1, 'dependência ESM ausente repetida não pode ser baixada em loop');

// Optional real-world fixture: useful for checking large SSR exports without
// making the repository test depend on a copyrighted/external page snapshot.
$fixture_path = getenv('KODETY_URL_IMPORT_FIXTURE');
if (is_string($fixture_path) && $fixture_path !== '') {
    $fixture = file_get_contents($fixture_path);
    kodety_url_import_assert(is_string($fixture) && $fixture !== '', 'o fixture real precisa ser legível');
    $fixture_platform = (string) $detect_platform->invoke($plugin, $fixture);
    $fixture_prepared = (string) $prepare->invoke($plugin, $fixture, 'https://example.test/', $fixture_platform);
    if ($fixture_platform === 'framer') {
        $fixture_script_dom = new DOMDocument();
        @$fixture_script_dom->loadHTML($fixture_prepared, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_COMPACT);
        $executable_framer_scripts = 0;
        foreach ($fixture_script_dom->getElementsByTagName('script') as $fixture_script) {
            $fixture_type = strtolower(trim($fixture_script->getAttribute('type')));
            if ($fixture_type === '' || in_array($fixture_type, ['module', 'text/javascript', 'application/javascript'], true)) $executable_framer_scripts++;
        }
        kodety_url_import_assert($executable_framer_scripts === 0, 'o fixture Framer não pode manter módulos executáveis da origem');
        kodety_url_import_assert(!str_contains(strtolower($fixture_prepared), 'modulepreload'), 'o fixture Framer não pode manter bootstrap modulepreload');
        if (str_contains($fixture, '__framer__appearAnimationsContent')) {
            $fixture_dom = new DOMDocument();
            @$fixture_dom->loadHTML($fixture_prepared, LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_COMPACT);
            $fixture_manifest = null;
            $visible_appear_nodes = 0;
            foreach ($fixture_dom->getElementsByTagName('meta') as $meta) {
                if ($meta->getAttribute('name') === 'kodety-framer-import') $fixture_manifest = json_decode(rawurldecode($meta->getAttribute('content')), true);
            }
            foreach ($fixture_dom->getElementsByTagName('*') as $element) {
                if (!$element instanceof DOMElement || !$element->hasAttribute('data-framer-appear-id')) continue;
                if (preg_match('~(?:^|;)\s*opacity\s*:\s*(?:1(?:\.0*)?|0?\.[1-9][0-9]*)~i', $element->getAttribute('style'))) $visible_appear_nodes++;
            }
            kodety_url_import_assert(is_array($fixture_manifest) && count($fixture_manifest['animations'] ?? []) > 0, 'o fixture Framer real precisa gerar animações nativas');
            kodety_url_import_assert(count($fixture_manifest['breakpoints'] ?? []) > 0, 'o fixture Framer real precisa gerar breakpoints');
            kodety_url_import_assert($visible_appear_nodes > 0, 'variantes appear do fixture real precisam ficar visíveis no canvas');
        }
    } else {
        kodety_url_import_assert(str_contains(strtolower($fixture_prepared), '<script'), 'o fixture Webflow/código precisa manter scripts');
    }
    kodety_url_import_assert(strlen($fixture_prepared) > 1000, 'o DOM SSR do fixture real não pode ser descartado');
}

// A pasta `public/` de um projeto Vite é copiada para a raiz do site no build.
// Importar as fontes mantém a pasta em disco, mas a rota pública não pode
// carregar esse segmento.
$static_roots = $reflection->getMethod('project_static_roots');
$static_roots->setAccessible(true);
$vite_root = sys_get_temp_dir() . '/kodety-vite-import-' . bin2hex(random_bytes(5));
mkdir($vite_root . '/Arquivos/public', 0777, true);
file_put_contents($vite_root . '/Arquivos/index.html', '<html></html>');
file_put_contents($vite_root . '/Arquivos/public/cases.html', '<html></html>');
kodety_url_import_assert(
    $static_roots->invoke($plugin, $vite_root, 'Arquivos') === ['public'],
    'public é raiz estática por convenção, sem exigir declaração alguma'
);
kodety_url_import_assert(
    $static_roots->invoke($plugin, $vite_root, '') === [],
    'a detecção respeita a raiz do projeto e não olha pastas irmãs'
);
mkdir($vite_root . '/Arquivos/sequencia de imagem', 0777, true);
file_put_contents(
    $vite_root . '/Arquivos/vite.config.ts',
    'export default { publicDir: "sequencia de imagem" };'
);
kodety_url_import_assert(
    $static_roots->invoke($plugin, $vite_root, 'Arquivos') === ['public', 'sequencia de imagem'],
    'um publicDir declarado no vite.config soma-se à convenção'
);
file_put_contents($vite_root . '/Arquivos/vite.config.ts', 'export default { publicDir: resolve(x) };');
kodety_url_import_assert(
    $static_roots->invoke($plugin, $vite_root, 'Arquivos') === ['public'],
    'um publicDir calculado em runtime não pode ser adivinhado estaticamente'
);
array_map('unlink', glob($vite_root . '/Arquivos/public/*') ?: []);
array_map('unlink', glob($vite_root . '/Arquivos/*.*') ?: []);
rmdir($vite_root . '/Arquivos/sequencia de imagem');
rmdir($vite_root . '/Arquivos/public');
rmdir($vite_root . '/Arquivos');
rmdir($vite_root);

// Um bundle ESM nativo já executável é um site pass-through e não precisa ser
// convertido para kodety-build. Quando o Builder gera esse diretório, porém,
// a ativação deve validar o grafo atestado antes de substituir o tema atual.
$assert_build = $reflection->getMethod('assert_coded_build_integrity');
$assert_build->setAccessible(true);
$coded_root = sys_get_temp_dir() . '/kodety-coded-import-' . bin2hex(random_bytes(5));
mkdir($coded_root . '/src', 0777, true);
file_put_contents(
    $coded_root . '/index.html',
    '<html><body><script type="module" src="/src/main.js"></script></body></html>'
);
file_put_contents($coded_root . '/src/main.js', 'export const nativeModule = true;');
$native_module_accepted = true;
try {
    $assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
} catch (Throwable) {
    $native_module_accepted = false;
}
kodety_url_import_assert(
    $native_module_accepted,
    'um bundle ESM nativo existente deve publicar sem conversão para kodety-build'
);
file_put_contents(
    $coded_root . '/index.html',
    '<html><body><script type="module" src="https://cdn.test/app.js"></script></body></html>'
);
$assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
file_put_contents(
    $coded_root . '/index.html',
    '<html><body><script>const fake=`<script type="module" src="/src/main.js">`;</script></body></html>'
);
$assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
file_put_contents(
    $coded_root . '/index.html',
    '<html><body><script src="/app.js"></script></body></html>'
);
$assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
file_put_contents(
    $coded_root . '/index.html',
    '<html><body><script type="module" src="/src/main.js"></script></body></html>'
);
mkdir($coded_root . '/kodety-build', 0777, true);
file_put_contents(
    $coded_root . '/index.html',
    '<html><body><script type="module" src="./kodety-build/main.js"></script></body></html>'
);
$valid_build = 'const matcher=/[{}]/g;const nested=`outer ${`inner ${1}`}`;'
    . 'export function run(){return matcher.test(nested)}';
file_put_contents($coded_root . '/kodety-build/main.js', $valid_build);
mkdir($coded_root . '/.incode', 0777, true);
$valid_manifest = [
    'version' => 2,
    'originals' => [],
    'generated' => ['kodety-build/main.js'],
    'entrypoints' => ['kodety-build/main.js'],
    'modules' => [
        'kodety-build/main.js' => [
            'bytes' => strlen($valid_build),
            'sha256' => hash('sha256', $valid_build),
            'dependencies' => [],
        ],
    ],
];
file_put_contents(
    $coded_root . '/.incode/coded-build.json',
    json_encode($valid_manifest, JSON_UNESCAPED_SLASHES)
);
$assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);

file_put_contents($coded_root . '/kodety-build/unattested.js', 'export const extra=true;');
$unattested_module_blocked = false;
try {
    $assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
} catch (ReflectionException|RuntimeException $error) {
    $unattested_module_blocked = $error instanceof RuntimeException
        || $error->getPrevious() instanceof RuntimeException;
}
kodety_url_import_assert(
    $unattested_module_blocked,
    'todo JavaScript físico em kodety-build deve possuir atestação v2'
);
unlink($coded_root . '/kodety-build/unattested.js');

file_put_contents($coded_root . '/kodety-build/main.js', $valid_build . "\n// corrupted byte");
$corruption_blocked = false;
try {
    $assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
} catch (ReflectionException|RuntimeException $error) {
    $corruption_blocked = $error instanceof RuntimeException
        || $error->getPrevious() instanceof RuntimeException;
}
kodety_url_import_assert(
    $corruption_blocked,
    'qualquer byte alterado depois da atestação deve falhar antes da ativação do tema'
);

file_put_contents($coded_root . '/kodety-build/main.js', $valid_build);
$traversal_manifest = $valid_manifest;
$traversal_manifest['entrypoints'] = ['kodety-build/../escape.js'];
$traversal_manifest['modules'] = [
    'kodety-build/../escape.js' => $valid_manifest['modules']['kodety-build/main.js'],
];
file_put_contents(
    $coded_root . '/.incode/coded-build.json',
    json_encode($traversal_manifest, JSON_UNESCAPED_SLASHES)
);
$traversal_blocked = false;
try {
    $assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
} catch (ReflectionException|RuntimeException $error) {
    $traversal_blocked = $error instanceof RuntimeException
        || $error->getPrevious() instanceof RuntimeException;
}
kodety_url_import_assert(
    $traversal_blocked,
    'paths com traversal no manifesto v2 devem ser bloqueados antes da ativação'
);

$empty_entrypoint_manifest = $valid_manifest;
$empty_entrypoint_manifest['entrypoints'] = [];
file_put_contents(
    $coded_root . '/.incode/coded-build.json',
    json_encode($empty_entrypoint_manifest, JSON_UNESCAPED_SLASHES)
);
$unattested_entrypoint_blocked = false;
try {
    $assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
} catch (ReflectionException|RuntimeException $error) {
    $unattested_entrypoint_blocked = $error instanceof RuntimeException
        || $error->getPrevious() instanceof RuntimeException;
}
kodety_url_import_assert(
    $unattested_entrypoint_blocked,
    'um HTML v2 não pode executar uma entrada ausente da atestação'
);

file_put_contents(
    $coded_root . '/.incode/coded-build.json',
    json_encode($valid_manifest, JSON_UNESCAPED_SLASHES)
);
unlink($coded_root . '/kodety-build/main.js');
$missing_build_blocked = false;
try {
    $assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
} catch (ReflectionException|RuntimeException $error) {
    $missing_build_blocked = $error instanceof RuntimeException
        || $error->getPrevious() instanceof RuntimeException;
}
kodety_url_import_assert(
    $missing_build_blocked,
    'um módulo gerado ausente deve falhar antes da ativação do tema'
);

file_put_contents($coded_root . '/kodety-build/main.js', $valid_build);
file_put_contents(
    $coded_root . '/.incode/coded-build.json',
    json_encode([
        'version' => 1,
        'originals' => [],
        'generated' => ['kodety-build/main.js'],
    ], JSON_UNESCAPED_SLASHES)
);
$assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);

unlink($coded_root . '/.incode/coded-build.json');
rmdir($coded_root . '/.incode');
unlink($coded_root . '/kodety-build/main.js');
rmdir($coded_root . '/kodety-build');
$missing_build_directory_blocked = false;
try {
    $assert_build->invoke($plugin, $coded_root, [$coded_root . '/index.html']);
} catch (ReflectionException|RuntimeException $error) {
    $missing_build_directory_blocked = $error instanceof RuntimeException
        || $error->getPrevious() instanceof RuntimeException;
}
kodety_url_import_assert(
    $missing_build_directory_blocked,
    'a ausência da pasta kodety-build inteira deve manter o tema anterior ativo'
);
unlink($coded_root . '/index.html');
unlink($coded_root . '/src/main.js');
rmdir($coded_root . '/src');
rmdir($coded_root);

fwrite(STDOUT, "URL import runtime: Framer híbrido estruturado, Webflow/código preservados e assets locais aprovados.\n");
