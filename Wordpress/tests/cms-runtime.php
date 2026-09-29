<?php

/** Minimal WordPress harness for the generated theme CMS renderer. */
define('ABSPATH', __DIR__);
define('KODETY_URL', 'https://example.test/wp-content/plugins/kodety/');
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_VERSION', 'test');

final class Kodety_License {
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public function is_active(): bool { return true; }
    public function public_status(): array { return ['valid' => true, 'limits' => []]; }
}

class WP_Post {
    public function __construct(
        public int $ID,
        public string $post_type,
        public string $post_title,
        public string $post_name,
        public string $post_content = '',
        public int $post_author = 1,
    ) {}
}

$kodety_test_posts = [];
$kodety_test_queried = null;
$kodety_test_options = [];
$kodety_test_theme_dir = sys_get_temp_dir() . '/kodety-localization-' . uniqid('', true);
$kodety_test_redirect = null;
$kodety_test_nocache_calls = 0;
$kodety_test_country_server_keys = [];
mkdir($kodety_test_theme_dir, 0777, true);

class WP_Error {
    public function __construct(
        private string $code,
        private string $message,
        private mixed $data = null,
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

class WP_REST_Request {
    /** @param array<string,string> $headers */
    public function __construct(private string $body = '', private array $headers = []) {}
    public function get_body(): string { return $this->body; }
    public function get_header(string $name): string {
        $needle = strtolower($name);
        foreach ($this->headers as $key => $value) {
            if (strtolower($key) === $needle) return (string) $value;
        }
        return '';
    }
}

class WP_REST_Response {
    /** @var array<string,string> */
    public array $headers = [];
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
}

function add_action(...$arguments): void {}
function add_filter(...$arguments): void {}
function add_theme_support(...$arguments): void {}
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_\-]/', '', strtolower($value)); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_title(string $value): string { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($value)), '-'); }
function wp_unslash(mixed $value): mixed { return is_string($value) ? stripslashes($value) : $value; }
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function esc_url(string $value): string { return $value; }
function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function user_trailingslashit(string $value): string { return rtrim($value, '/') . '/'; }
function trailingslashit(string $value): string { return rtrim($value, '/') . '/'; }
function wp_mkdir_p(string $path): bool { return is_dir($path) || mkdir($path, 0777, true); }
function get_option(string $key, mixed $default = false): mixed {
    global $kodety_test_options;
    return array_key_exists($key, $kodety_test_options) ? $kodety_test_options[$key] : $default;
}
function update_option(string $key, mixed $value, bool $autoload = true): bool {
    global $kodety_test_options;
    $kodety_test_options[$key] = $value;
    return true;
}
function current_time(string $type): string { return '2026-08-20T12:00:00-03:00'; }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function get_template_directory(): string { global $kodety_test_theme_dir; return $kodety_test_theme_dir; }
function is_admin(): bool { return false; }
function wp_doing_ajax(): bool { return false; }
function is_preview(): bool { return false; }
function get_query_var(string $name): string { return ''; }
function nocache_headers(): void { global $kodety_test_nocache_calls; $kodety_test_nocache_calls++; }
function wp_safe_redirect(string $location, int $status = 302, string|false $x_redirect_by = 'WordPress'): bool {
    global $kodety_test_redirect;
    $kodety_test_redirect = compact('location', 'status', 'x_redirect_by');
    return false;
}
function get_post_type_object(string $post_type): object { return (object) ['labels' => (object) ['name' => $post_type], 'rewrite' => ['slug' => $post_type]]; }
function get_the_title(WP_Post $post): string { return $post->post_title; }
function get_the_excerpt(WP_Post $post): string { return ''; }
function apply_filters(string $name, mixed $value): mixed {
    if ($name === 'kodety_public_locale_country_server_keys') {
        global $kodety_test_country_server_keys;
        return is_array($value) ? [...$value, ...$kodety_test_country_server_keys] : $value;
    }
    return $name === 'kodety_localization_extension_enabled' ? true : $value;
}
function get_the_post_thumbnail_url(...$arguments): string { return ''; }
function get_post_thumbnail_id(...$arguments): int { return 0; }
function get_post_meta(...$arguments): string { return ''; }
function get_the_date(string $format, WP_Post $post): string { return '2026-07-19'; }
function get_the_author_meta(...$arguments): string { return 'Kodety'; }
function wp_strip_all_tags(string $value): string { return strip_tags($value); }
function wp_attachment_is_image(int $id): bool { return false; }
function absint(mixed $value): int { return abs((int) $value); }
function wp_get_attachment_image_url(...$arguments): string|false { return false; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function post_type_exists(string $post_type): bool { return in_array($post_type, ['post', 'product', 'page'], true); }
function get_posts(array $arguments): array {
    global $kodety_test_posts;
    return array_slice($kodety_test_posts[$arguments['post_type']] ?? [], 0, $arguments['numberposts']);
}
function is_singular(...$arguments): bool { return true; }
function get_queried_object(): mixed { global $kodety_test_queried; return $kodety_test_queried; }

require dirname(__DIR__) . '/kodety/theme-runtime/functions.php';
require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_assert_throws(callable $operation, string $message): void {
    try {
        $operation();
    } catch (Throwable) {
        return;
    }
    kodety_assert(false, $message);
}

function kodety_assert_throws_class(callable $operation, string $expected, string $message): void {
    try {
        $operation();
    } catch (Throwable $error) {
        kodety_assert(
            $error instanceof $expected,
            $message . ' (recebido ' . get_debug_type($error) . ': ' . $error->getMessage() . ')'
        );
        return;
    }
    kodety_assert(false, $message);
}

$kodety_test_queried = new WP_Post(99, 'page', 'Início', 'inicio');
$kodety_test_posts = [
    'post' => [
        new WP_Post(1, 'post', 'Dede', 'dede'),
        new WP_Post(2, 'post', 'Olá mundo', 'ola-mundo'),
    ],
];
$rendered = kodety_render_cms_html('<html><body>
  <h1 data-kodety-bind-content="title">Página</h1>
  <div data-kodety-collection="post" data-kodety-repeat="child">
    <a data-kodety-bind-content="title" data-kodety-bind-href="permalink">Item</a>
  </div>
</body></html>');
$decoded = html_entity_decode($rendered, ENT_QUOTES | ENT_HTML5, 'UTF-8');
kodety_assert(substr_count($decoded, '>Início</h1>') === 1, 'a página singular deve preencher apenas o próprio contexto');
kodety_assert(str_contains($decoded, '>Dede</a>') && str_contains($decoded, '>Olá mundo</a>'), 'itens repetidos não podem ser sobrescritos pela página singular');
kodety_assert(!str_contains($decoded, '>Início</a>'), 'o título da página não pode vazar para a collection');

$binding_targets = kodety_render_cms_html('<html><body>
  <a data-kodety-bind-href="permalink" data-kodety-bind-title="title">Abrir</a>
  <img data-kodety-bind-src="permalink" data-kodety-bind-alt="title">
</body></html>');
$binding_targets = html_entity_decode($binding_targets, ENT_QUOTES | ENT_HTML5, 'UTF-8');
kodety_assert(str_contains($binding_targets, 'href="https://example.test/page/inicio/"'), 'links conectados ao CMS devem chegar ao HTML publicado');
kodety_assert(str_contains($binding_targets, 'title="Início"'), 'atributos title conectados ao CMS devem chegar ao HTML publicado');
kodety_assert(str_contains($binding_targets, 'src="https://example.test/page/inicio/"'), 'fontes conectadas ao CMS devem chegar ao HTML publicado');
kodety_assert(str_contains($binding_targets, 'alt="Início"'), 'textos alternativos conectados ao CMS devem chegar ao HTML publicado');

$self_repeat = kodety_render_cms_html('<html><body>
  <article class="card" data-kodety-collection="post" data-kodety-repeat="self">
    <h2 data-kodety-bind-content="title">Item</h2>
  </article>
</body></html>');
$self_repeat = html_entity_decode($self_repeat, ENT_QUOTES | ENT_HTML5, 'UTF-8');
kodety_assert(substr_count($self_repeat, 'class="card"') === 2, 'repetir a própria seção deve criar uma instância por item');
kodety_assert(str_contains($self_repeat, '>Dede</h2>') && str_contains($self_repeat, '>Olá mundo</h2>'), 'a seção repetida deve resolver os campos de cada item');
kodety_assert(!str_contains($self_repeat, 'data-kodety-collection='), 'a configuração de repetição não deve vazar ao HTML publicado');

$kodety_test_posts = [
    'post' => [new WP_Post(3, 'post', 'Categoria A', 'categoria-a')],
    'product' => [new WP_Post(4, 'product', 'Produto X', 'produto-x')],
];
$nested = kodety_render_cms_html('<html><body>
  <section data-kodety-collection="post" data-kodety-repeat="child">
    <article>
      <h2 data-kodety-bind-content="title">Categoria</h2>
      <div data-kodety-collection="product" data-kodety-repeat="child">
        <span data-kodety-bind-content="title">Produto</span>
      </div>
    </article>
  </section>
</body></html>');
kodety_assert(str_contains($nested, '>Categoria A</h2>'), 'a collection externa deve usar o próprio item');
kodety_assert(str_contains($nested, '>Produto X</span>'), 'collections aninhadas devem ser renderizadas com contexto próprio');
kodety_assert(!str_contains($nested, 'data-kodety-collection='), 'configurações processadas não devem permanecer ativas no HTML final');

$kodety_test_queried = new WP_Post(7, 'post', 'Projeto “Aurora”', 'projeto-aurora');
$seo = kodety_render_cms_html('<html><head>
  <title>{{title}} · Estúdio</title>
  <meta name="description" content="Conheça {{title}}">
  <link rel="canonical" href="{{permalink}}">
  <script type="application/ld+json" data-kodety-seo>{"@context":"https://schema.org","name":"{{title}}"}</script>
</head><body></body></html>');
$seo_decoded = html_entity_decode($seo, ENT_QUOTES | ENT_HTML5, 'UTF-8');
kodety_assert(str_contains($seo_decoded, '<title>Projeto “Aurora” · Estúdio</title>'), 'o title da página-template deve resolver dados CMS');
kodety_assert(str_contains($seo_decoded, 'content="Conheça Projeto “Aurora”"'), 'a description dinâmica deve resolver com escaping seguro');
kodety_assert(str_contains($seo_decoded, 'href="https://example.test/post/projeto-aurora/"'), 'a URL canônica deve aceitar o permalink do item');
kodety_assert(str_contains($seo_decoded, '"name":"Projeto “Aurora”"'), 'o JSON-LD deve resolver dados CMS sem quebrar o JSON');

$localization = [
    'sourceLocale' => 'pt-BR',
    'translatePagePaths' => true,
    'locales' => [
        ['code' => 'pt-BR', 'language' => 'pt', 'slug' => '', 'enabled' => true, 'direction' => 'ltr'],
        ['code' => 'en-US', 'language' => 'en', 'slug' => 'en', 'enabled' => true, 'direction' => 'ltr'],
        ['code' => 'fr-FR', 'language' => 'fr', 'slug' => 'fr', 'enabled' => true, 'direction' => 'ltr', 'fallback' => 'en-US'],
    ],
    'translations' => ['en-US' => ['pages' => ['index.html' => [
        'path' => 'home', 'title' => 'Welcome', 'description' => 'English description',
        'entries' => ['path:0:text' => 'Hello', 'path:1:attr:placeholder' => 'Search'],
    ]]]],
];
file_put_contents($kodety_test_theme_dir . '/localization.json', json_encode($localization, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
$published_localization = kodety_localization_settings();
kodety_assert(($published_localization['locales'][1]['slug'] ?? '') === 'en', 'o tema publicado deve ler o payload público de localização');
$published_request = kodety_localization_request('en/home', $published_localization);
kodety_assert($published_request['locale_code'] === 'en-US', 'o prefixo publicado deve selecionar o locale correto');
$localized = kodety_render_localized_html('<!doctype html><html lang="pt-BR"><head><title>Bem-vindo</title><meta name="description" content="Descrição"></head><body><h1 data-kodety-l10n-id="migrated-heading">Olá</h1><input data-kodety-l10n-id="migrated-search" placeholder="Buscar"></body></html>', 'index.html', 'en-US', $localization);
kodety_assert(str_contains($localized, '>Hello</h1>'), 'o runtime deve manter traduções v1 por path depois que IDs estáveis são adicionados ao HTML');
kodety_assert(str_contains($localized, 'placeholder="Search"'), 'atributos acessíveis devem aceitar tradução');
kodety_assert(str_contains($localized, '<title>Welcome</title>'), 'SEO localizado deve chegar ao HTML publicado');
kodety_assert(str_contains($localized, 'hreflang="en-US"'), 'o runtime deve publicar alternates hreflang');

$stylesheet_localization = $localization;
$stylesheet_localization['translations']['en-US']['pages']['index.html']['stylesheet'] = 'styles/localized-en.css';
$stylesheet_localization['translations']['fr-FR']['pages']['index.html'] = [
    'stylesheet' => 'styles/localized-fr.css',
    'entries' => [],
];
$localized_stylesheets = kodety_render_localized_html(
    '<!doctype html><html><head><link rel="stylesheet" href="styles/base.css"><title>Base</title></head><body><h1>Base</h1></body></html>',
    'index.html',
    'fr-FR',
    $stylesheet_localization
);
kodety_assert(
    substr_count($localized_stylesheets, 'data-kodety-localized-style=') === 2
        && strpos($localized_stylesheets, 'href="styles/base.css"') < strpos($localized_stylesheets, 'href="styles/localized-en.css"')
        && strpos($localized_stylesheets, 'href="styles/localized-en.css"') < strpos($localized_stylesheets, 'href="styles/localized-fr.css"'),
    'runtime DOM deve carregar CSS autoral, fallback e locale direto nessa ordem, sem tocar no CSS-base'
);
$stylesheet_localization['translations']['en-US']['pages']['pages/stylesheet-only.html'] = [
    'stylesheet' => 'styles/localized-en.css',
    'entries' => [],
];
$stylesheet_localization['translations']['fr-FR']['pages']['pages/stylesheet-only.html'] = [
    'stylesheet' => 'pages/localized-fr.css',
    'entries' => [],
];
$metadata_only_stylesheets = kodety_render_localized_html(
    '<!doctype html><html><head><link rel="stylesheet" href="styles/base.css"></head><body>Metadata fast path</body></html>',
    'pages/stylesheet-only.html',
    'fr-FR',
    $stylesheet_localization
);
kodety_assert(
    substr_count($metadata_only_stylesheets, 'data-kodety-localized-style=') === 2
        && strpos($metadata_only_stylesheets, 'href="../styles/localized-en.css"') !== false
        && strpos($metadata_only_stylesheets, 'href="localized-fr.css"') !== false,
    'fast path metadata-only deve resolver hrefs relativos e a cadeia inteira de stylesheets localizados'
);

$mixed_localization = $localization;
$mixed_localization['translations']['en-US']['pages']['mixed.html'] = ['entries' => [
    // Legacy path keys remain valid after stable IDs are stamped.
    'path:0:text-node:0' => 'Hello',
    'id:mixed:text-node:1' => '.',
    'id:mixed-strong:text' => 'world',
]];
$mixed_localization['translations']['fr-FR']['pages']['mixed.html'] = ['entries' => [
    // Unicode-only whitespace is an absent override and must keep fallback.
    'id:mixed:text-node:0' => " \u{00A0} ",
]];
$mixed_source = '<!doctype html><html lang="pt-BR"><head></head><body><p data-kodety-l10n-id="mixed">'
    . "\n  Olá "
    . '<strong data-kodety-l10n-id="mixed-strong">mundo</strong>'
    . "!\n  <!-- preserve-inline-marker -->\n"
    . '</p></body></html>';
foreach (['en-US', 'fr-FR'] as $mixed_locale) {
    $mixed_html = kodety_render_localized_html($mixed_source, 'mixed.html', $mixed_locale, $mixed_localization);
    kodety_assert(
        preg_match(
            '/<p[^>]*>\s*Hello <strong[^>]*>world<\/strong>\.\s*<!-- preserve-inline-marker -->/s',
            $mixed_html
        ) === 1,
        $mixed_locale . ': texto misto deve traduzir nós diretos preservando whitespace, fallback e markup inline'
    );
}

$source_immutable_localization = $localization;
$source_immutable_localization['translations']['pt-BR'] = [
    'siteTitle' => 'Título corrompido',
    'siteDescription' => 'Descrição corrompida',
    'pages' => ['source.html' => [
        'stylesheet' => 'styles/corrupted-source.css',
        'title' => 'Página corrompida',
        'description' => 'Meta corrompida',
        'entries' => ['path:0:text' => 'Texto corrompido'],
        'overrides' => ['id:source-hero' => ['visible' => false, 'styles' => ['color' => 'red']]],
        'insertions' => [[
            'id' => 'source-leak',
            'anchor' => 'body',
            'position' => 'append',
            'html' => '<aside>Inserção corrompida</aside>',
        ]],
    ]],
];
$source_immutable = kodety_render_localized_html(
    '<!doctype html><html lang="pt-BR"><head><title>Título base</title><meta name="description" content="Descrição base"></head><body><h1 data-kodety-l10n-id="source-hero">Texto base</h1></body></html>',
    'source.html',
    'pt-BR',
    $source_immutable_localization
);
$source_immutable_decoded = html_entity_decode($source_immutable, ENT_QUOTES | ENT_HTML5, 'UTF-8');
kodety_assert(
    str_contains($source_immutable_decoded, '>Texto base</h1>')
        && str_contains($source_immutable_decoded, '<title>Título base</title>')
        && str_contains($source_immutable_decoded, 'content="Descrição base"')
        && !str_contains($source_immutable_decoded, 'corrompid')
        && !str_contains($source_immutable_decoded, 'source-leak')
        && !str_contains($source_immutable_decoded, 'data-kodety-localized-style')
        && !str_contains($source_immutable_decoded, 'display: none')
        && str_contains($source_immutable_decoded, 'hreflang="en-US"'),
    'payload translations[sourceLocale] nunca deve alterar o HTML-base, mantendo apenas metadata pública de locale'
);

$visual_localization = $localization;
$visual_localization['translations']['en-US']['pages']['visual.html'] = [
    'entries' => [],
    'overrides' => [
        'id:hero' => [
            'visible' => false,
            'attributes' => ['id' => 'localized-hero', 'class' => 'hero localized'],
            'styles' => ['background-color' => '#102030', 'margin-left' => '20px'],
        ],
        'id:hero-source' => [
            'attributes' => ['srcset' => '/hero-en-large.webp 2x', 'sizes' => '100vw'],
        ],
        'id:localized-image' => [
            'attributes' => [
                'src' => 'https://cdn.example.test/hero-en.jpg',
                'alt' => 'English hero',
            ],
        ],
        'id:localized-srcset-only' => [
            'attributes' => ['srcset' => '/srcset-only-en.jpg 2x'],
        ],
        'id:promo-child' => [
            'attributes' => ['id' => 'english-promo-child', 'class' => 'promo child'],
        ],
        'insertion:en-promo' => [
            'attributes' => ['data-locale-only' => 'yes'],
        ],
    ],
    'insertions' => [[
        // Deliberately precedes its parent to exercise dependency retries.
        'id' => 'en-promo-nested',
        'anchor' => 'insertion:en-promo',
        'position' => 'append',
        'html' => '<em id="nested-in-promo">Nested locale anchor</em>',
    ], [
        'id' => 'en-promo',
        'anchor' => 'id:hero',
        'position' => 'after',
        'html' => '<section id="english-only" onclick="alert(1)"><strong id="promo-child" data-kodety-l10n-id="promo-child" data-kodety-locale-insertion="evil" data-kodety-bind-text="title">Only in English</strong><small data-kodety-l10n-id="hero">Colliding ID</small><a xlink:href="#safe" aria-label="safe-insertion">Namespaced</a><script>alert(2)</script></section><aside id="english-second"><a href="data:text/html,unsafe" data-kodety-l10n-id="promo-child">Second localized root</a></aside>',
    ], [
        'id' => 'en-prepend',
        'anchor' => 'body',
        'position' => 'prepend',
        'html' => '<i id="prepend-first">P1</i><i id="prepend-second">P2</i>',
    ], [
        'id' => 'en-before',
        'anchor' => 'id:hero',
        'position' => 'before',
        'html' => '<i id="before-first">B1</i><i id="before-second">B2</i>',
    ], [
        'id' => 'after-record-one',
        'anchor' => 'id:hero',
        'position' => 'after',
        'html' => '<i id="after-record-one">A1</i>',
    ], [
        'id' => 'after-record-two',
        'anchor' => 'id:hero',
        'position' => 'after',
        'html' => '<i id="after-record-two">A2</i>',
    ], [
        'id' => 'prepend-record-one',
        'anchor' => 'body',
        'position' => 'prepend',
        'html' => '<i id="prepend-record-one">PR1</i>',
    ], [
        'id' => 'prepend-record-two',
        'anchor' => 'body',
        'position' => 'prepend',
        'html' => '<i id="prepend-record-two">PR2</i>',
    ], [
        'id' => 'duplicate-runtime',
        'anchor' => 'body',
        'position' => 'append',
        'html' => '<div id="duplicate-first">First duplicate value</div>',
    ], [
        'id' => 'plain-text-runtime',
        'anchor' => 'body',
        'position' => 'append',
        'html' => 'Locale-only plain text',
    ], [
        'id' => 'cycle-a',
        'anchor' => 'insertion:cycle-b',
        'position' => 'append',
        'html' => '<div id="cycle-a-output">Cycle A</div>',
    ], [
        'id' => 'cycle-b',
        'anchor' => 'insertion:cycle-a',
        'position' => 'append',
        'html' => '<div id="cycle-b-output">Cycle B</div>',
    ], [
        'id' => 'missing-anchor',
        'anchor' => 'id:does-not-exist',
        'position' => 'append',
        'html' => '<div id="missing-anchor-output">Missing</div>',
    ], [
        'id' => 'disabled-runtime',
        'anchor' => 'body',
        'position' => 'append',
        'html' => '<div id="disabled-runtime-output">Disabled</div>',
        'enabled' => false,
    ], [
        // Last-write wins without moving the ID's original order.
        'id' => 'duplicate-runtime',
        'anchor' => 'body',
        'position' => 'append',
        'html' => '<div id="duplicate-last">Last duplicate value</div>',
    ]],
];
$visual_source = '<!doctype html><html lang="pt-BR"><head><title>Visual</title></head><body>'
    . '<section data-kodety-l10n-id="hero" style="display: flex !important; color: red; margin-left: 5px !important; margin: 10px !important; all: initial !important"><h1>Hero</h1></section>'
    . '<picture><source data-kodety-l10n-id="hero-source" srcset="/hero-pt-large.jpg 2x"><img data-kodety-l10n-id="localized-image" src="/hero-pt.jpg" srcset="/hero-pt.jpg 1x" sizes="100vw" alt="Herói"></picture>'
    . '<picture><source srcset="/srcset-only-base.webp 2x" sizes="50vw"><img data-kodety-l10n-id="localized-srcset-only" src="/srcset-only-base.jpg" srcset="/srcset-only-base.jpg 2x" sizes="50vw"></picture>'
    . '</body></html>';
$localized_visual = kodety_render_localized_html($visual_source, 'visual.html', 'en-US', $visual_localization);
kodety_assert(str_contains($localized_visual, 'src="https://cdn.example.test/hero-en.jpg"'), 'a mídia substituída deve ser exclusiva do locale');
kodety_assert(str_contains($localized_visual, 'alt="English hero"'), 'atributos de mídia localizados devem persistir');
kodety_assert(!str_contains($localized_visual, 'srcset="/hero-pt'), 'srcset e picture sources antigos não podem vencer a imagem localizada');
kodety_assert(
    str_contains($localized_visual, 'srcset="/hero-en-large.webp 2x"')
        && str_contains($localized_visual, 'sizes="100vw"'),
    'override explícito de source deve sobreviver à neutralização dos candidatos antigos do picture'
);
kodety_assert(
    str_contains($localized_visual, 'src="/srcset-only-base.jpg"')
        && str_contains($localized_visual, 'srcset="/srcset-only-en.jpg 2x"')
        && !str_contains($localized_visual, '/srcset-only-base.webp')
        && !str_contains($localized_visual, 'srcset="/srcset-only-base.jpg 2x"'),
    'override apenas de srcset também deve neutralizar source/srcset antigos preservando o src fallback'
);
kodety_assert(str_contains($localized_visual, 'hidden="hidden"') && str_contains($localized_visual, 'display: none'), 'visible:false deve persistir sem prioridade CSS');
kodety_assert(str_contains($localized_visual, 'background-color: #102030'), 'estilos do locale devem persistir sem prioridade CSS no HTML publicado');
kodety_assert(
    str_contains($localized_visual, 'margin-left: 20px')
        && !str_contains($localized_visual, '!important')
        && !preg_match('/(?:^|[;"\s])margin\s*:/i', $localized_visual)
        && !preg_match('/(?:^|[;"\s])all\s*:/i', $localized_visual),
    'longhand localizado deve remover shorthand/all conflitantes e ser serializado por último como vencedor'
);
kodety_assert(str_contains($localized_visual, 'id="localized-hero"') && str_contains($localized_visual, 'class="hero localized"'), 'id e class seguros devem aceitar override localizado no runtime');
kodety_assert(str_contains($localized_visual, 'data-kodety-locale-insertion="en-promo"') && str_contains($localized_visual, 'Only in English'), 'seções exclusivas devem ser inseridas no locale correto');
kodety_assert(
    substr_count($localized_visual, 'data-locale-only="yes"') === 2,
    'override insertion:<id> deve alcançar todas as raízes do mesmo fragmento'
);
kodety_assert(
    str_contains($localized_visual, 'id="nested-in-promo"'),
    'uma inserção fora de ordem deve resolver insertion:<id> em um passe posterior'
);
kodety_assert(
    str_contains($localized_visual, 'id="english-promo-child"')
        && str_contains($localized_visual, 'class="promo child"'),
    'override id:<id> único dentro da inserção deve ser reaplicado depois da materialização'
);
kodety_assert(
    substr_count($localized_visual, 'data-kodety-l10n-id="promo-child"') === 1
        && substr_count($localized_visual, 'data-kodety-l10n-id="hero"') === 1
        && !str_contains($localized_visual, 'data-kodety-locale-insertion="evil"')
        && str_contains($localized_visual, 'data-kodety-bind-text="title"'),
    'fragmentos devem preservar IDs únicos, remover colisões/marcadores forjados e manter bindings legítimos'
);
kodety_assert(
    strpos($localized_visual, 'id="english-only"') < strpos($localized_visual, 'id="english-second"'),
    'fragmentos localizados com múltiplas raízes devem preservar a ordem original'
);
kodety_assert(
    strpos($localized_visual, 'id="prepend-first"') < strpos($localized_visual, 'id="prepend-second"')
        && strpos($localized_visual, 'id="before-first"') < strpos($localized_visual, 'id="before-second"'),
    'prepend e before devem preservar a ordem DOM das múltiplas raízes'
);
kodety_assert(
    strpos($localized_visual, 'id="english-second"') < strpos($localized_visual, 'id="after-record-one"')
        && strpos($localized_visual, 'id="after-record-one"') < strpos($localized_visual, 'id="after-record-two"')
        && strpos($localized_visual, 'id="prepend-second"') < strpos($localized_visual, 'id="prepend-record-one"')
        && strpos($localized_visual, 'id="prepend-record-one"') < strpos($localized_visual, 'id="prepend-record-two"'),
    'o cursor persistente deve preservar a ordem entre inserções separadas after/prepend na mesma âncora'
);
kodety_assert(
    !str_contains($localized_visual, '<script>')
        && !str_contains($localized_visual, 'onclick=')
        && !str_contains($localized_visual, 'data:text/html')
        && !str_contains($localized_visual, 'xlink:href')
        && str_contains($localized_visual, 'aria-label="safe-insertion"'),
    'fragmentos localizados devem manter atributos seguros e rejeitar scripts, URLs executáveis e namespaces'
);
kodety_assert(
    str_contains($localized_visual, 'id="duplicate-last"')
        && !str_contains($localized_visual, 'id="duplicate-first"'),
    'IDs de inserção duplicados devem adotar last-write sem materializar a versão anterior'
);
kodety_assert(
    preg_match(
        '/<span[^>]*data-kodety-locale-text-root="1"[^>]*data-kodety-locale-insertion="plain-text-runtime"[^>]*>Locale-only plain text<\/span>/',
        $localized_visual
    ) === 1,
    'uma raiz somente texto deve ganhar wrapper seguro com ownership selecionável'
);
kodety_assert(
    !str_contains($localized_visual, 'cycle-a-output')
        && !str_contains($localized_visual, 'cycle-b-output')
        && !str_contains($localized_visual, 'missing-anchor-output')
        && !str_contains($localized_visual, 'disabled-runtime-output'),
    'ciclos, âncoras ausentes e inserções desativadas devem ser ignorados sem saída parcial'
);

$visual_localization['translations']['fr-FR']['pages']['visual.html'] = [
    'entries' => [],
    'overrides' => [
        'id:hero' => ['visible' => true, 'styles' => ['color' => 'blue']],
    ],
    'insertions' => [['id' => 'en-promo', 'removed' => true]],
];
$localized_visual_fallback = kodety_render_localized_html($visual_source, 'visual.html', 'fr-FR', $visual_localization);
kodety_assert(str_contains($localized_visual_fallback, 'src="https://cdn.example.test/hero-en.jpg"'), 'fallback deve herdar mídia quando o locale não a substituir');
kodety_assert(!str_contains($localized_visual_fallback, 'hidden="hidden"') && str_contains($localized_visual_fallback, 'display: flex'), 'visible:true direto deve suprimir o hide herdado sem corromper o estilo base');
kodety_assert(str_contains($localized_visual_fallback, 'color: blue') && !str_contains($localized_visual_fallback, '!important'), 'estilos diretos devem vencer estilos herdados sem prioridade CSS');
kodety_assert(!str_contains($localized_visual_fallback, 'Only in English'), 'tombstone removed deve suprimir seção herdada do fallback');

$authored_hidden_localization = $localization;
$authored_hidden_localization['translations']['en-US']['pages']['hidden-base.html'] = [
    'entries' => [],
    'overrides' => ['id:hidden-base' => ['visible' => true]],
];
$authored_hidden = kodety_render_localized_html(
    '<!doctype html><html><head></head><body><section data-kodety-l10n-id="hidden-base" hidden aria-hidden="true" style="display:none!important; color:red">Hidden in source</section></body></html>',
    'hidden-base.html',
    'en-US',
    $authored_hidden_localization
);
kodety_assert(
    !preg_match('/<section[^>]*(?:\shidden(?:=|\s)|aria-hidden=|display\s*:\s*none)/i', $authored_hidden)
        && str_contains($authored_hidden, 'color: red'),
    'visible:true deve remover hidden, aria-hidden e prioridade CSS autoral sem descartar outros estilos'
);

$fallback_metadata = $localization;
$fallback_metadata['translations']['en-US']['siteTitle'] = 'Fallback site title';
$fallback_metadata['translations']['en-US']['siteDescription'] = 'Fallback site description';
$fallback_metadata['translations']['fr-FR']['pages']['metadata.html'] = ['entries' => []];
$fallback_metadata_html = kodety_render_localized_html(
    '<!doctype html><html><head><title>Título original</title><meta name="description" content="Descrição original"></head><body></body></html>',
    'metadata.html',
    'fr-FR',
    $fallback_metadata
);
kodety_assert(
    str_contains($fallback_metadata_html, '<title>Fallback site title</title>')
        && str_contains($fallback_metadata_html, 'content="Fallback site description"'),
    'title e description globais devem percorrer a mesma cadeia de fallback do conteúdo'
);

$collision_localization = $localization;
$collision_localization['translations']['en-US']['pages']['collision.html'] = [
    'entries' => [],
    'overrides' => [
        'id:second' => ['attributes' => [
            'id' => 'first',
            'xlink:href' => 'javascript:alert(1)',
            'data-kodety-locale-hidden' => 'forged',
            'data-kodety-locale-insertion' => 'forged',
        ]],
    ],
    'insertions' => [[
        'id' => 'duplicate-dom-id',
        'anchor' => 'body',
        'position' => 'append',
        'html' => '<aside id="first">Duplicate id from locale</aside>',
    ]],
];
$collision_html = kodety_render_localized_html(
    '<!doctype html><html><head></head><body><div id="first"></div><div id="second" data-kodety-l10n-id="second"></div></body></html>',
    'collision.html',
    'en-US',
    $collision_localization
);
kodety_assert(
    substr_count($collision_html, 'id="first"') === 1
        && str_contains($collision_html, 'id="second"')
        && !str_contains($collision_html, 'xlink:href')
        && !str_contains($collision_html, 'data-kodety-locale-hidden="forged"')
        && !str_contains($collision_html, 'data-kodety-locale-insertion="forged"'),
    'runtime deve impedir IDs DOM duplicados e rejeitar qualquer marcador interno de locale forjado'
);

$projection_root = sys_get_temp_dir() . '/kodety-localization-projection-' . bin2hex(random_bytes(5));
mkdir($projection_root . '/.incode', 0777, true);
$limit_id_200 = str_repeat('i', 200);
$limit_id_201 = str_repeat('i', 201);
$limit_class_2000 = str_repeat('x ', 999) . 'xx';
$limit_class_2001 = $limit_class_2000 . 'x';
$unicode_id_150 = str_repeat('é', 150);
$unicode_class_1000 = str_repeat('á', 1000);
file_put_contents($projection_root . '/.incode/project.json', json_encode([
    'projectId' => 'must-remain-private',
    'localization' => [
        'version' => 2,
        'sourceLocale' => 'pt-BR',
        'defaultLocale' => 'pt-BR',
        'includePathsInAi' => true,
        'locales' => [
            ['code' => 'pt-BR', 'language' => 'pt', 'name' => 'Português', 'slug' => '', 'enabled' => true],
            [
                'code' => 'en-US', 'language' => 'en', 'name' => 'English', 'slug' => 'en', 'enabled' => true,
                'autoTranslate' => true, 'aiModel' => 'private-model', 'aiStyle' => 'private client briefing',
            ],
        ],
        'translations' => ['en-US' => ['pages' => ['index.html' => [
            'stylesheet' => 'styles/kodety-l10n-en-us.css',
            'entries' => ['id:title:text' => 'Welcome'],
            'overrides' => [
                'id:image' => [
                    'attributes' => [
                        'src' => '/english.jpg',
                        'onclick' => 'alert(1)',
                        'poster' => 'javascript:alert(1)',
                        'xlink:href' => 'javascript:alert(1)',
                        'data-kodety-locale-insertion' => 'forged',
                        'data-kodety-locale-hidden' => 'forged',
                    ],
                    'styles' => ['object-fit' => 'cover', 'behavior' => 'url(evil.htc)'],
                ],
                'insertion:promo' => [
                    'attributes' => [
                        'data-locale-only' => 'yes',
                        'id' => 'localized-promo',
                        'class' => 'promo localized',
                        'srcdoc' => '<script>alert(1)</script>',
                    ],
                ],
                'id:limit-safe' => [
                    'attributes' => ['id' => $limit_id_200, 'class' => $limit_class_2000],
                ],
                'id:limit-rejected' => [
                    'attributes' => ['id' => $limit_id_201, 'class' => $limit_class_2001],
                ],
                'id:unicode-safe' => [
                    'attributes' => ['id' => $unicode_id_150, 'class' => $unicode_class_1000],
                ],
                'id:' . $limit_id_200 => [
                    'styles' => ['color' => 'green'],
                ],
                'id:' . $limit_id_201 => [
                    'styles' => ['color' => 'red'],
                ],
            ],
            'insertions' => [
                ['id' => 'promo', 'anchor' => 'body', 'position' => 'append', 'html' => '<section>Promo</section>'],
                ['id' => 'nested', 'anchor' => 'insertion:promo', 'position' => 'append', 'html' => '<strong>Nested</strong>'],
                ['id' => 'fallback-only', 'removed' => true],
                ['id' => 'projection-duplicate', 'anchor' => 'body', 'position' => 'append', 'html' => '<i>First</i>'],
                ['id' => $limit_id_200, 'anchor' => 'body', 'position' => 'append', 'html' => '<i>200</i>'],
                ['id' => $limit_id_201, 'anchor' => 'body', 'position' => 'append', 'html' => '<i>201</i>'],
                ['id' => 'projection-duplicate', 'anchor' => 'body', 'position' => 'append', 'html' => '<i>Last</i>'],
                ['id' => 'disabled-projection', 'anchor' => 'body', 'position' => 'append', 'html' => '<i>Disabled</i>', 'enabled' => false],
            ],
        ]]]],
        'privateProviderKey' => 'must-not-be-public',
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
$plugin_reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $plugin_reflection->newInstanceWithoutConstructor();
$canonical_locale_code = $plugin_reflection->getMethod('canonical_localization_locale_code');
foreach ([
    'en-u-ca-gregory' => 'en-u-ca-gregory',
    'en-x-private' => 'en-x-private',
    'zh-hant-tw' => 'zh-Hant-TW',
    'es-419' => 'es-419',
    'PT-br' => 'pt-BR',
    'iw-IL' => 'he-IL',
    'sh-RS' => 'sr-Latn-RS',
    'sl-rozaj-biske' => 'sl-biske-rozaj',
    'en-u-nu-latn-ca-gregory' => 'en-u-ca-gregory-nu-latn',
] as $raw_locale_code => $expected_locale_code) {
    kodety_assert(
        $canonical_locale_code->invoke($plugin, $raw_locale_code) === $expected_locale_code,
        'backend deve aceitar e canonicalizar o mesmo BCP 47 aceito pelo Intl do Builder: ' . $raw_locale_code
    );
}
foreach (['abcd', 'en-abc', 'en-u', 'en-u-ca-u-nu-latn', 'sl-rozaj-rozaj', 'en--US', 'x-private'] as $invalid_locale_code) {
    kodety_assert(
        $canonical_locale_code->invoke($plugin, $invalid_locale_code) === '',
        'backend deve recusar locale estruturalmente inválido: ' . $invalid_locale_code
    );
}
$assert_localization_metadata = $plugin_reflection->getMethod('assert_project_localization_metadata');
$validator_root = sys_get_temp_dir() . '/kodety-localization-validator-' . bin2hex(random_bytes(5));
mkdir($validator_root . '/.incode', 0777, true);
file_put_contents($validator_root . '/index.html', '<!doctype html><html><body>Home</body></html>');
file_put_contents($validator_root . '/about.html', '<!doctype html><html><body>About</body></html>');
file_put_contents($validator_root . '/contact.html', '<!doctype html><html><body>Contact</body></html>');
$valid_authoring_localization = static fn(): array => [
    'version' => 2,
    'sourceLocale' => 'pt-BR',
    'defaultLocale' => 'pt-BR',
    'translatePagePaths' => true,
    'locales' => [
        ['code' => 'pt-BR', 'language' => 'pt', 'name' => 'Português', 'slug' => '', 'enabled' => true, 'fallback' => ''],
        ['code' => 'en-US', 'language' => 'en', 'name' => 'English', 'slug' => 'en', 'enabled' => true, 'fallback' => 'pt-BR'],
    ],
    'translations' => [
        'en-US' => ['pages' => [
            'about.html' => ['path' => 'about-us', 'entries' => []],
            'contact.html' => ['path' => 'contact', 'entries' => []],
        ]],
    ],
];
$write_validator_metadata = static function (mixed $localization) use ($validator_root): void {
    $encoded = json_encode(
        ['projectId' => 'localization-validator', 'mainHtmlPath' => 'index.html', 'localization' => $localization],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
    kodety_assert(is_string($encoded), 'fixture de validação deve produzir JSON');
    file_put_contents($validator_root . '/.incode/project.json', $encoded);
};

$write_validator_metadata($valid_authoring_localization());
$assert_localization_metadata->invoke($plugin, $validator_root);

file_put_contents($validator_root . '/.incode/project.json', '{"localization":');
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'JSON corrompido deve ser recusado antes de substituir o rascunho atual'
);
$write_validator_metadata('pt-BR');
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'localization com formato escalar deve ser recusada sem crash ou coerção silenciosa'
);

foreach (['automaticLocale', 'rememberLocale', 'translatePagePaths', 'includePathsInAi'] as $boolean_flag) {
    $invalid_flag = $valid_authoring_localization();
    $invalid_flag[$boolean_flag] = 'false';
    $write_validator_metadata($invalid_flag);
    kodety_assert_throws_class(
        fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
        DomainException::class,
        'flags de localização precisam manter tipo booleano no contrato PHP: ' . $boolean_flag
    );
}

$safe_stylesheet = $valid_authoring_localization();
$safe_stylesheet['translations']['en-US']['pages']['about.html']['stylesheet'] = 'styles/kodety-l10n-en-us.css';
$write_validator_metadata($safe_stylesheet);
$assert_localization_metadata->invoke($plugin, $validator_root);
foreach ([
    '../private.css',
    '%252e%252e/private.css',
    '/absolute.css',
    'https://cdn.example/private.css',
    '.incode/private.css',
    'styles/not-css.js',
    'styles/%zz.css',
    'styles/%25zz.css',
    "styles/control\n.css",
] as $unsafe_stylesheet_path) {
    $unsafe_stylesheet = $valid_authoring_localization();
    $unsafe_stylesheet['translations']['en-US']['pages']['about.html']['stylesheet'] = $unsafe_stylesheet_path;
    $write_validator_metadata($unsafe_stylesheet);
    kodety_assert_throws_class(
        fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
        DomainException::class,
        'stylesheet localizado inseguro deve ser recusado antes da publicação: ' . $unsafe_stylesheet_path
    );
}

$unsafe_route = $valid_authoring_localization();
$unsafe_route['translations']['en-US']['pages']['about.html']['path'] = '../private/secret';
$write_validator_metadata($unsafe_route);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'rota traduzida com traversal deve ser recusada antes de chegar ao tema público'
);

$unsafe_authored_path = $valid_authoring_localization();
$unsafe_authored_path['translations']['en-US']['pages']['../private/secret.html'] =
    $unsafe_authored_path['translations']['en-US']['pages']['about.html'];
unset($unsafe_authored_path['translations']['en-US']['pages']['about.html']);
$write_validator_metadata($unsafe_authored_path);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'chave de página authored com traversal deve ser recusada em vez de sumir na projeção pública'
);

foreach (['%252e%252e/private', "about\nheader"] as $encoded_or_control_route) {
    $unsafe_encoded_route = $valid_authoring_localization();
    $unsafe_encoded_route['translations']['en-US']['pages']['about.html']['path'] = $encoded_or_control_route;
    $write_validator_metadata($unsafe_encoded_route);
    kodety_assert_throws_class(
        fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
        DomainException::class,
        'rotas traduzidas com traversal codificado ou controle devem ser recusadas'
    );
}

$duplicate_route = $valid_authoring_localization();
$duplicate_route['translations']['en-US']['pages']['about.html']['path'] = 'Portfolio';
$duplicate_route['translations']['en-US']['pages']['contact.html']['path'] = 'portfolio//';
$write_validator_metadata($duplicate_route);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'duas páginas do mesmo idioma não podem publicar a mesma rota após normalização'
);

$inactive_duplicate_route = $duplicate_route;
$inactive_duplicate_route['translatePagePaths'] = false;
$write_validator_metadata($inactive_duplicate_route);
$assert_localization_metadata->invoke($plugin, $validator_root);

$effective_route_collision = $valid_authoring_localization();
$effective_route_collision['translations']['en-US']['pages']['about.html']['path'] = 'contact';
$effective_route_collision['translations']['en-US']['pages']['contact.html']['path'] = '';
$write_validator_metadata($effective_route_collision);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'path traduzido não pode colidir com a rota authored efetiva de outra página'
);

$implicit_route_collision = $valid_authoring_localization();
$implicit_route_collision['translations']['en-US']['pages']['about.html']['path'] = 'contact';
unset($implicit_route_collision['translations']['en-US']['pages']['contact.html']);
$write_validator_metadata($implicit_route_collision);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'path traduzido não pode colidir com página pública sem registro de tradução'
);

$duplicate_slug = $valid_authoring_localization();
$duplicate_slug['locales'][] = [
    'code' => 'fr-FR', 'language' => 'fr', 'name' => 'Français',
    'slug' => 'en', 'enabled' => true, 'fallback' => 'pt-BR',
];
$write_validator_metadata($duplicate_slug);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'prefixos publicados duplicados devem ser recusados sem alterar o workspace'
);

$ghost_page = $valid_authoring_localization();
$ghost_page['translations']['en-US']['pages']['ghost.html'] = [
    'path' => 'contact',
    'entries' => [],
];
$write_validator_metadata($ghost_page);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'uma rota traduzida não pode apontar para uma página inexistente e sombrear uma página pública'
);

$case_duplicate_translation = $valid_authoring_localization();
$case_duplicate_translation['translations']['en-us'] = $case_duplicate_translation['translations']['en-US'];
$write_validator_metadata($case_duplicate_translation);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'coleções do mesmo locale com casing diferente não podem sobrescrever uma à outra silenciosamente'
);

$alias_duplicate_locale = $valid_authoring_localization();
$alias_duplicate_locale['locales'][] = [
    'code' => 'iw-IL', 'language' => 'iw', 'name' => 'Hebrew legacy',
    'slug' => 'he-old', 'enabled' => true, 'fallback' => 'pt-BR',
];
$alias_duplicate_locale['locales'][] = [
    'code' => 'he-IL', 'language' => 'he', 'name' => 'Hebrew',
    'slug' => 'he', 'enabled' => true, 'fallback' => 'pt-BR',
];
$write_validator_metadata($alias_duplicate_locale);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'aliases BCP 47 que canonicalizam para o mesmo locale devem ser tratados como duplicados'
);

file_put_contents($validator_root . '/en.html', '<!doctype html><html><body>Authored EN route</body></html>');
$cross_locale_collision = $valid_authoring_localization();
$write_validator_metadata($cross_locale_collision);
kodety_assert_throws_class(
    fn() => $assert_localization_metadata->invoke($plugin, $validator_root),
    DomainException::class,
    'o prefixo de um locale não pode tornar uma página authored de outro idioma inalcançável'
);
@unlink($validator_root . '/en.html');

@unlink($validator_root . '/.incode/project.json');
@rmdir($validator_root . '/.incode');
@unlink($validator_root . '/index.html');
@unlink($validator_root . '/about.html');
@unlink($validator_root . '/contact.html');
@rmdir($validator_root);

$localization_save_storage = sys_get_temp_dir() . '/kodety-localization-save-' . bin2hex(random_bytes(5));
$localization_save_workspace = $localization_save_storage . '/private/workspace';
mkdir($localization_save_workspace . '/.incode', 0777, true);
file_put_contents($localization_save_workspace . '/index.html', '<!doctype html><html><body>Home stays byte-identical</body></html>');
file_put_contents($localization_save_workspace . '/about.html', '<!doctype html><html><body>About</body></html>');
file_put_contents($localization_save_workspace . '/contact.html', '<!doctype html><html><body>Contact</body></html>');
$save_localization = $valid_authoring_localization();
file_put_contents(
    $localization_save_workspace . '/.incode/project.json',
    json_encode(
        ['projectId' => 'localization-save', 'mainHtmlPath' => 'index.html', 'localization' => $save_localization],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    )
);
$storage_property = $plugin_reflection->getProperty('storage_dir');
$storage_property->setValue($plugin, $localization_save_storage);
$kodety_test_options['kodety_workspace_revision'] = 7;
$kodety_test_options['kodety_workspace_css_digest'] = hash('sha256', 'unchanged-css');
$html_before_incremental_save = hash_file('sha256', $localization_save_workspace . '/index.html');
$save_localization['translations']['en-US']['pages']['about.html']['title'] = 'Saved without a ZIP';
$localization_save_response = $plugin->save_project_localization(new WP_REST_Request(
    (string) json_encode(['localization' => $save_localization], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ['X-Kodety-Expected-Revision' => '7']
));
kodety_assert(
    $localization_save_response instanceof WP_REST_Response
        && ($localization_save_response->get_data()['workspaceRevision'] ?? 0) === 8
        && $kodety_test_options['kodety_workspace_revision'] === 8,
    'o endpoint incremental deve confirmar a revisão nova sem reempacotar o projeto inteiro'
);
$saved_incremental_metadata = json_decode(
    (string) file_get_contents($localization_save_workspace . '/.incode/project.json'),
    true
);
kodety_assert(
    ($saved_incremental_metadata['localization']['translations']['en-US']['pages']['about.html']['title'] ?? '') === 'Saved without a ZIP'
        && hash_file('sha256', $localization_save_workspace . '/index.html') === $html_before_incremental_save,
    'o salvamento incremental deve trocar apenas project.json e preservar o HTML byte a byte'
);

$stale_localization_response = $plugin->save_project_localization(new WP_REST_Request(
    (string) json_encode(['localization' => $valid_authoring_localization()], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ['X-Kodety-Expected-Revision' => '7']
));
kodety_assert(
    $stale_localization_response instanceof WP_Error
        && $stale_localization_response->get_error_code() === 'kodety_workspace_conflict',
    'uma revisão antiga não pode sobrescrever uma localização confirmada'
);

$invalid_deep_localization = $save_localization;
$invalid_deep_localization['translations']['en-US']['pages']['about.html']['insertions'] = array_fill(
    0,
    1001,
    ['id' => 'too-many', 'anchor' => 'body', 'position' => 'append', 'html' => '<p>Too many</p>']
);
$invalid_incremental_response = $plugin->save_project_localization(new WP_REST_Request(
    (string) json_encode(['localization' => $invalid_deep_localization], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ['X-Kodety-Expected-Revision' => '8']
));
kodety_assert(
    $invalid_incremental_response instanceof WP_Error
        && $invalid_incremental_response->get_error_code() === 'kodety_invalid_localization'
        && ($invalid_incremental_response->get_error_data()['status'] ?? 0) === 422
        && $kodety_test_options['kodety_workspace_revision'] === 8,
    'o endpoint incremental deve validar o payload novo em profundidade e recusar limites permanentes sem retry'
);
$remove_tree = $plugin_reflection->getMethod('remove_tree');
$remove_tree->invoke($plugin, $localization_save_storage);

$atomic_project_root = sys_get_temp_dir() . '/kodety-localization-atomic-project-' . bin2hex(random_bytes(5));
$atomic_theme_root = sys_get_temp_dir() . '/kodety-localization-atomic-theme-' . bin2hex(random_bytes(5));
mkdir($atomic_project_root . '/.incode', 0777, true);
mkdir($atomic_theme_root, 0777, true);
file_put_contents($atomic_project_root . '/index.html', '<!doctype html><html><body><h1>Olá</h1></body></html>');
$atomic_localization = $valid_authoring_localization();
$atomic_localization['translations']['en-US']['pages']['index.html'] = [
    'path' => 'home',
    'title' => 'First published title',
    'entries' => [],
];
file_put_contents(
    $atomic_project_root . '/.incode/project.json',
    json_encode(
        ['mainHtmlPath' => 'index.html', 'localization' => $atomic_localization],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    )
);
$build_theme = $plugin_reflection->getMethod('build_theme');
$build_theme->invoke(
    $plugin,
    $atomic_project_root,
    $atomic_theme_root,
    [$atomic_project_root . '/index.html'],
    '20260820-120000-test',
    []
);
$first_public_payload = file_get_contents($atomic_theme_root . '/localization.json');
$decoded_first_payload = is_string($first_public_payload) ? json_decode($first_public_payload, true) : null;
kodety_assert(
    ($decoded_first_payload['translations']['en-US']['pages']['index.html']['title'] ?? '') === 'First published title',
    'build do tema deve publicar localization.json completo e legível'
);

$atomic_localization['translations']['en-US']['pages']['index.html']['title'] = 'Second published title';
file_put_contents(
    $atomic_project_root . '/.incode/project.json',
    json_encode(
        ['mainHtmlPath' => 'index.html', 'localization' => $atomic_localization],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    )
);
$build_theme->invoke(
    $plugin,
    $atomic_project_root,
    $atomic_theme_root,
    [$atomic_project_root . '/index.html'],
    '20260820-120100-test',
    []
);
$second_public_payload = file_get_contents($atomic_theme_root . '/localization.json');
$decoded_second_payload = is_string($second_public_payload) ? json_decode($second_public_payload, true) : null;
kodety_assert(
    ($decoded_second_payload['translations']['en-US']['pages']['index.html']['title'] ?? '') === 'Second published title'
        && !str_contains((string) $second_public_payload, 'First published title')
        && glob($atomic_theme_root . '/localization.json.tmp-*') === [],
    'republicação deve trocar o payload inteiro por rename atômico sem deixar arquivo temporário'
);
$remove_tree->invoke($plugin, $atomic_project_root);
$remove_tree->invoke($plugin, $atomic_theme_root);

$project_localization = $plugin_reflection->getMethod('project_localization');
$public_localization = $project_localization->invoke($plugin, $projection_root);
kodety_assert(($public_localization['version'] ?? 0) === 3, 'publicação deve projetar o contrato de localização v3');
kodety_assert(
    ($public_localization['automaticLocale'] ?? false) === true,
    'projetos v1/v2 devem migrar do antigo false padrão para redirect automático ativo'
);
$explicit_disabled_localization = $project_localization->invoke($plugin, $projection_root, [
    'version' => 3,
    'sourceLocale' => 'pt-BR',
    'defaultLocale' => 'pt-BR',
    'automaticLocale' => false,
    'locales' => [
        ['code' => 'pt-BR', 'language' => 'pt', 'name' => 'Português', 'slug' => '', 'enabled' => true],
    ],
    'translations' => [],
]);
kodety_assert(
    ($explicit_disabled_localization['automaticLocale'] ?? true) === false,
    'false no contrato v3 deve continuar sendo um opt-out explícito'
);
kodety_assert(
    ($public_localization['translations']['en-US']['pages']['index.html']['overrides']['id:image']['attributes']['src'] ?? '') === '/english.jpg',
    'projeção pública deve persistir mídia localizada'
);
kodety_assert(
    ($public_localization['translations']['en-US']['pages']['index.html']['stylesheet'] ?? '') === 'styles/kodety-l10n-en-us.css',
    'projeção pública deve preservar o caminho seguro do stylesheet localizado'
);
kodety_assert(
    !isset($public_localization['translations']['en-US']['pages']['index.html']['overrides']['id:image']['attributes']['onclick'])
        && !isset($public_localization['translations']['en-US']['pages']['index.html']['overrides']['id:image']['attributes']['poster'])
        && !isset($public_localization['translations']['en-US']['pages']['index.html']['overrides']['id:image']['attributes']['xlink:href'])
        && !isset($public_localization['translations']['en-US']['pages']['index.html']['overrides']['id:image']['attributes']['data-kodety-locale-insertion'])
        && !isset($public_localization['translations']['en-US']['pages']['index.html']['overrides']['id:image']['attributes']['data-kodety-locale-hidden']),
    'projeção pública deve eliminar atributos executáveis, URLs inseguras e marcadores internos forjados'
);
kodety_assert(
    ($public_localization['translations']['en-US']['pages']['index.html']['overrides']['insertion:promo']['attributes']['id'] ?? '') === 'localized-promo'
        && ($public_localization['translations']['en-US']['pages']['index.html']['overrides']['insertion:promo']['attributes']['class'] ?? '') === 'promo localized'
        && !isset($public_localization['translations']['en-US']['pages']['index.html']['overrides']['insertion:promo']['attributes']['srcdoc']),
    'projeção pública deve preservar insertion:<id>, id e class seguros e rejeitar srcdoc'
);
$projected_overrides = $public_localization['translations']['en-US']['pages']['index.html']['overrides'];
kodety_assert(
    ($projected_overrides['id:limit-safe']['attributes']['id'] ?? '') === $limit_id_200
        && ($projected_overrides['id:limit-safe']['attributes']['class'] ?? '') === $limit_class_2000
        && ($projected_overrides['id:unicode-safe']['attributes']['id'] ?? '') === $unicode_id_150
        && ($projected_overrides['id:unicode-safe']['attributes']['class'] ?? '') === $unicode_class_1000
        && !isset($projected_overrides['id:limit-rejected'])
        && isset($projected_overrides['id:' . $limit_id_200])
        && !isset($projected_overrides['id:' . $limit_id_201]),
    'id/class devem medir pontos Unicode, aceitar o limite multibyte e rejeitar qualquer valor acima do contrato'
);
kodety_assert(
    ($public_localization['translations']['en-US']['pages']['index.html']['insertions'][1]['anchor'] ?? '') === 'insertion:promo',
    'projeção pública deve preservar âncoras insertion:<id>'
);
kodety_assert(
    ($public_localization['translations']['en-US']['pages']['index.html']['insertions'][2]['removed'] ?? false) === true,
    'projeção pública deve preservar tombstones de inserções herdadas'
);
$projected_insertions = array_column(
    $public_localization['translations']['en-US']['pages']['index.html']['insertions'],
    null,
    'id'
);
kodety_assert(
    ($projected_insertions['projection-duplicate']['html'] ?? '') === '<i>Last</i>'
        && isset($projected_insertions[$limit_id_200])
        && !isset($projected_insertions[$limit_id_201])
        && ($projected_insertions['disabled-projection']['enabled'] ?? true) === false
        && ($public_localization['translations']['en-US']['pages']['index.html']['insertions'][3]['id'] ?? '') === 'projection-duplicate',
    'projeção deve usar last-write, preservar ordem/limites e manter enabled:false sem reativar a inserção'
);
kodety_assert(
    !str_contains((string) json_encode($public_localization), 'must-remain-private')
        && !str_contains((string) json_encode($public_localization), 'must-not-be-public')
        && !array_key_exists('includePathsInAi', $public_localization)
        && !array_key_exists('autoTranslate', $public_localization['locales'][1] ?? [])
        && !array_key_exists('aiModel', $public_localization['locales'][1] ?? [])
        && !array_key_exists('aiStyle', $public_localization['locales'][1] ?? []),
    'localization.json não pode expor o restante da metadata privada'
);

$project_page = $plugin_reflection->getMethod('project_localization_page');
$project_overrides = $plugin_reflection->getMethod('project_localization_overrides');
$project_insertions = $plugin_reflection->getMethod('project_localization_insertions');
$project_scalar = $plugin_reflection->getMethod('localization_scalar');

kodety_assert(
    ($project_page->invoke($plugin, [
        'stylesheet' => 'pages/localized-fr.css',
        'entries' => [],
    ])['stylesheet'] ?? '') === 'pages/localized-fr.css'
        && !isset($project_page->invoke($plugin, [
            'stylesheet' => '../private.css',
            'entries' => [],
        ])['stylesheet']),
    'projeção defensiva deve conservar somente paths CSS públicos e relativos'
);

$boundary_attributes = [];
for ($index = 0; $index < 100; $index++) $boundary_attributes['data-boundary-' . $index] = (string) $index;
$boundary_projected = $project_overrides->invoke($plugin, [
    'id:boundary' => ['attributes' => $boundary_attributes],
]);
kodety_assert(
    count($boundary_projected['id:boundary']['attributes'] ?? []) === 100,
    'o limite exato de atributos deve persistir inteiro'
);
$overflow_attributes = $boundary_attributes;
$overflow_attributes['data-boundary-overflow'] = 'overflow';
kodety_assert_throws(
    fn() => $project_overrides->invoke($plugin, ['id:boundary' => ['attributes' => $overflow_attributes]]),
    'o atributo 101 deve rejeitar a edição inteira em vez de desaparecer na publicação'
);

$boundary_styles = [];
for ($index = 0; $index < 200; $index++) $boundary_styles['--boundary-' . $index] = (string) $index;
$boundary_projected = $project_overrides->invoke($plugin, [
    'id:boundary' => ['styles' => $boundary_styles],
]);
kodety_assert(
    count($boundary_projected['id:boundary']['styles'] ?? []) === 200,
    'o limite exato de estilos deve persistir inteiro'
);
$overflow_styles = $boundary_styles;
$overflow_styles['--boundary-overflow'] = 'overflow';
kodety_assert_throws(
    fn() => $project_overrides->invoke($plugin, ['id:boundary' => ['styles' => $overflow_styles]]),
    'o estilo 201 deve rejeitar a edição inteira em vez de desaparecer na publicação'
);

$boundary_insertions = [];
for ($index = 0; $index < 1000; $index++) {
    $boundary_insertions[] = [
        'id' => 'boundary-' . $index,
        'anchor' => 'body',
        'position' => 'append',
        'html' => '<i>' . $index . '</i>',
    ];
}
kodety_assert(
    count($project_insertions->invoke($plugin, $boundary_insertions)) === 1000,
    'o limite exato de seções exclusivas deve persistir inteiro'
);
$overflow_insertions = $boundary_insertions;
$overflow_insertions[] = [
    'id' => 'boundary-overflow',
    'anchor' => 'body',
    'position' => 'append',
    'html' => '<i>overflow</i>',
];
kodety_assert_throws(
    fn() => $project_insertions->invoke($plugin, $overflow_insertions),
    'a seção exclusiva 1001 deve rejeitar a edição inteira'
);

$overflow_overrides = [];
for ($index = 0; $index <= 5000; $index++) $overflow_overrides['id:o' . $index] = ['visible' => true];
kodety_assert_throws(
    fn() => $project_overrides->invoke($plugin, $overflow_overrides),
    'a sobrescrita 5001 deve rejeitar a edição inteira'
);
$overflow_entries = [];
for ($index = 0; $index <= 20000; $index++) $overflow_entries['id:e' . $index . ':text'] = 'value';
kodety_assert_throws(
    fn() => $project_page->invoke($plugin, ['entries' => $overflow_entries]),
    'a entrada de texto 20001 deve rejeitar a edição inteira'
);
kodety_assert(
    $project_scalar->invoke($plugin, str_repeat('á', 100), 200) === str_repeat('á', 100),
    'o limite de payload deve ser medido em bytes UTF-8 de forma explícita'
);
kodety_assert_throws(
    fn() => $project_scalar->invoke($plugin, str_repeat('á', 101), 200),
    'payload acima do limite em bytes deve falhar sem cortar um caractere UTF-8'
);

@unlink($projection_root . '/.incode/project.json');
@rmdir($projection_root . '/.incode');
@rmdir($projection_root);

$signature_source = '<!doctype html><!-- Made with Kodety for WordPress · unkern.com --><!-- Published Jul 22, 2026, 2:08 AM UTC --><html lang="pt-BR"><head><title>Teste</title></head><body></body></html>';
$localized_signature = kodety_render_localized_html($signature_source, 'index.html', 'en-US', $localization);
kodety_assert(str_contains($localized_signature, '<!-- Made with Onun Kodety for WordPress -->'), 'a localização deve migrar a assinatura legada para Onun Kodety');
kodety_assert(!str_contains($localized_signature, 'unkern.com'), 'a localização deve migrar a assinatura legada para Onun Kodety');
kodety_assert(!str_contains($localized_signature, '&middot;'), 'a assinatura não pode publicar a entidade &middot;');
kodety_assert(!preg_match('/(?:<\?xml|<!--\s*\?xml)/i', $localized_signature), 'a dica interna de encoding XML não pode chegar ao navegador');
$localized_request = kodety_localization_request('en/home', $localization);
kodety_assert($localized_request['locale_code'] === 'en-US' && $localized_request['base_route'] === '', 'URL localizada deve voltar para a rota-base do manifest');

$automatic_locale_manifest = ['' => 'index.html', 'about' => 'about.html'];
$automatic_locale_localization = $localization;
$automatic_locale_localization['translations']['en-US']['pages']['about.html'] = [
    'path' => 'about-us',
    'entries' => [],
];
$automatic_home_source = kodety_manifest_relative_for_request($automatic_locale_manifest, '');
$automatic_about_source = kodety_manifest_relative_for_request($automatic_locale_manifest, 'about');
kodety_assert(
    $automatic_home_source === 'index.html'
        && kodety_localization_page_route($automatic_home_source, 'en-US', $automatic_locale_localization) === 'en/home'
        && $automatic_about_source === 'about.html'
        && kodety_localization_page_route($automatic_about_source, 'en-US', $automatic_locale_localization) === 'en/about-us',
    'redirect automático deve resolver o HTML authored antes de aplicar o path traduzido da página'
);
$wrapped_locale_manifest = ['' => 'Arquivos/index.html', 'cases' => 'Arquivos/cases.html'];
$wrapped_canonical_routes = kodety_manifest_canonical_routes($wrapped_locale_manifest);
kodety_assert(
    ($wrapped_canonical_routes['arquivos/index.html'] ?? null) === ''
        && ($wrapped_canonical_routes['arquivos/cases.html'] ?? null) === 'cases',
    'redirect automático deve usar a rota pública canônica e nunca vazar a pasta de empacotamento'
);
$wrapped_unicode_localization = $localization;
$wrapped_unicode_localization['translations']['en-US']['pages'] = [
    'Arquivos/index.html' => ['path' => 'home', 'entries' => []],
    'Arquivos/sobre.html' => ['path' => 'sobre-nós', 'entries' => []],
    'Arquivos/cases.html' => ['path' => '', 'entries' => []],
];
$wrapped_unicode_manifest = [
    '' => 'Arquivos/index.html',
    'sobre' => 'Arquivos/sobre.html',
    'cases' => 'Arquivos/cases.html',
];
$encoded_unicode_request = kodety_localization_request(
    'en/sobre-n%C3%B3s',
    $wrapped_unicode_localization,
    $wrapped_unicode_manifest
);
kodety_assert(
    kodety_normalize_public_route_path('sobre-n%C3%B3s') === 'sobre-nós'
        && kodety_normalize_public_route_path('sobre-n%25C3%25B3s') === null
        && kodety_normalize_public_route_path('%2e%2e/private') === null
        && $encoded_unicode_request['locale_code'] === 'en-US'
        && $encoded_unicode_request['localized_route'] === 'sobre-nós'
        && $encoded_unicode_request['base_route'] === 'sobre'
        && kodety_manifest_relative_for_request($wrapped_unicode_manifest, $encoded_unicode_request['base_route']) === 'Arquivos/sobre.html',
    'rota Unicode percent-encoded deve ser decodificada uma vez, casar a tradução authored e resolver o manifest canônico'
);
kodety_assert(
    kodety_localization_page_route('Arquivos/index.html', 'pt-BR', $wrapped_unicode_localization, $wrapped_unicode_manifest) === ''
        && kodety_localization_page_route('Arquivos/cases.html', 'pt-BR', $wrapped_unicode_localization, $wrapped_unicode_manifest) === 'cases'
        && kodety_localization_page_route('Arquivos/sobre.html', 'en-US', $wrapped_unicode_localization, $wrapped_unicode_manifest) === 'en/sobre-nós',
    'page_route deve partir sempre da rota pública canônica e aceitar o manifest como argumento opcional'
);
$wrapped_localized_markup = kodety_render_localized_html(
    '<!doctype html><html lang="pt-BR"><head><title>Sobre</title></head><body><details data-kodety-locale-selector><span data-kodety-locale-current>Idioma</span><div data-kodety-locale-options><a data-kodety-locale-option>Opção</a></div></details></body></html>',
    'Arquivos/sobre.html',
    'en-US',
    $wrapped_unicode_localization,
    $wrapped_unicode_manifest
);
kodety_assert(
    str_contains($wrapped_localized_markup, 'href="https://example.test/sobre/"')
        && str_contains($wrapped_localized_markup, 'href="https://example.test/en/sobre-n%C3%B3s/"')
        && str_contains($wrapped_localized_markup, 'hreflang="pt-BR"')
        && str_contains($wrapped_localized_markup, 'hreflang="en-US"')
        && !str_contains($wrapped_localized_markup, 'https://example.test/Arquivos/'),
    'selector e hreflang devem compartilhar as rotas canônicas sem expor a pasta-invólucro'
);
$_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'en-US;q=0, fr-FR;q=1, en;q=0.8';
$quality_preferred_locale = kodety_localization_preferred_locale($localization);
kodety_assert(
    ($quality_preferred_locale['code'] ?? '') === 'fr-FR',
    'detecção automática deve respeitar pesos Accept-Language e nunca escolher um idioma recusado com q=0'
);
$_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'en-US;q=0, en;q=1';
$explicitly_rejected_locale = kodety_localization_preferred_locale($localization);
kodety_assert(
    $explicitly_rejected_locale === null,
    'um range amplo positivo nunca deve reativar o locale exato explicitamente recusado com q=0'
);
$_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'en;q=0, en-US;q=1';
$specific_opt_in_locale = kodety_localization_preferred_locale($localization);
kodety_assert(
    ($specific_opt_in_locale['code'] ?? '') === 'en-US',
    'um range exato positivo deve poder optar de volta por um locale recusado apenas no nível amplo'
);
$_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'en;q=0.8, fr;q=0.8';
$ordered_preferred_locale = kodety_localization_preferred_locale($localization);
kodety_assert(
    ($ordered_preferred_locale['code'] ?? '') === 'en-US',
    'pesos iguais devem preservar a ordem declarada pelo navegador'
);
unset($_SERVER['HTTP_ACCEPT_LANGUAGE']);

$netherlands_localization = $localization;
$netherlands_localization['locales'][] = [
    'code' => 'nl-NL',
    'language' => 'nl',
    'region' => 'NL',
    'slug' => 'nl',
    'enabled' => true,
    'direction' => 'ltr',
];
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'NL';
$country_method = $plugin_reflection->getMethod('public_locale_request_country');
$country_locale_method = $plugin_reflection->getMethod('public_locale_for_country');
$locale_by_code_method = $plugin_reflection->getMethod('public_locale_by_code');
$country_server_keys = [
    'HTTP_CF_IPCOUNTRY',
    'HTTP_CLOUDFRONT_VIEWER_COUNTRY',
    'HTTP_X_VERCEL_IP_COUNTRY',
    'HTTP_FASTLY_GEO_COUNTRY',
    'GEOIP_COUNTRY_CODE',
];
foreach ($country_server_keys as $country_server_key) {
    foreach ($country_server_keys as $key_to_clear) unset($_SERVER[$key_to_clear]);
    $_SERVER[$country_server_key] = 'NL';
    kodety_assert(
        $country_method->invoke($plugin) === 'NL',
        'redirect deve aceitar país enviado pelo edge/host em ' . $country_server_key
    );
}
foreach ($country_server_keys as $key_to_clear) unset($_SERVER[$key_to_clear]);
$kodety_test_country_server_keys = ['HTTP_PRIVATE_HOST_CDN_COUNTRY'];
$_SERVER['HTTP_PRIVATE_HOST_CDN_COUNTRY'] = 'NL';
kodety_assert(
    $country_method->invoke($plugin) === 'NL',
    'hosts com CDN própria devem poder declarar seu server key sem alterar o controlador'
);
unset($_SERVER['HTTP_PRIVATE_HOST_CDN_COUNTRY']);
$kodety_test_country_server_keys = [];
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'NL';
$netherlands_country = $country_method->invoke($plugin);
$netherlands_preferred_locale = $country_locale_method->invoke(
    $plugin,
    $netherlands_localization['locales'],
    $netherlands_country,
    $netherlands_localization['locales'][0]
);
kodety_assert(
    ($netherlands_preferred_locale['code'] ?? '') === 'nl-NL',
    'Holanda deve abrir a versão nl-NL quando ela estiver publicada'
);
$netherlands_english_fallback = $country_locale_method->invoke(
    $plugin,
    $localization['locales'],
    $netherlands_country,
    $localization['locales'][0]
);
kodety_assert(
    ($netherlands_english_fallback['code'] ?? '') === 'en-US',
    'país sem tradução própria deve abrir a versão inglesa publicada'
);
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'BR';
$brazil_preferred_locale = $country_locale_method->invoke(
    $plugin,
    $localization['locales'],
    $country_method->invoke($plugin),
    $localization['locales'][0]
);
kodety_assert(
    ($brazil_preferred_locale['code'] ?? '') === 'pt-BR',
    'Brasil deve abrir a versão pt-BR'
);
$no_english_localization = [
    'sourceLocale' => 'pt-BR',
    'defaultLocale' => 'fr-FR',
    'locales' => [
        ['code' => 'pt-BR', 'language' => 'pt', 'region' => 'BR', 'slug' => 'pt', 'enabled' => true],
        ['code' => 'fr-FR', 'language' => 'fr', 'region' => 'FR', 'slug' => '', 'enabled' => true],
    ],
];
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'JP';
$main_language_fallback = $country_locale_method->invoke(
    $plugin,
    $no_english_localization['locales'],
    $country_method->invoke($plugin),
    $no_english_localization['locales'][1]
);
kodety_assert(
    ($main_language_fallback['code'] ?? '') === 'fr-FR',
    'sem inglês, o país não traduzido deve usar o idioma principal padrão do site'
);
$_COOKIE['kodety_locale_choice'] = 'pt-BR';
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'NL';
$remembered_preferred_locale = $locale_by_code_method->invoke(
    $plugin,
    $netherlands_localization['locales'],
    (string) $_COOKIE['kodety_locale_choice']
);
kodety_assert(
    ($remembered_preferred_locale['code'] ?? '') === 'pt-BR',
    'a escolha lembrada pelo visitante deve vencer a geolocalização'
);
unset($_COOKIE['kodety_locale_choice'], $_SERVER['HTTP_CF_IPCOUNTRY']);

$automatic_controller_localization = $localization;
$automatic_controller_localization['version'] = 3;
$automatic_controller_localization['defaultLocale'] = 'pt-BR';
$automatic_controller_localization['automaticLocale'] = true;
file_put_contents(
    $kodety_test_theme_dir . '/localization.json',
    json_encode($automatic_controller_localization, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
);
file_put_contents(
    $kodety_test_theme_dir . '/manifest.json',
    json_encode(['' => 'index.html'], JSON_UNESCAPED_SLASHES)
);
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/?campaign=geo';
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'NL';
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 Chrome/136.0.0.0 Mobile Safari/537.36';
$kodety_test_redirect = null;
$kodety_test_nocache_calls = 0;
ob_start();
$plugin->route_public_locale();
$automatic_redirect_output = ob_get_clean();
kodety_assert(
    $automatic_redirect_output === ''
        && $kodety_test_redirect === [
            'location' => 'https://example.test/en/home/?campaign=geo',
            'status' => 302,
            'x_redirect_by' => 'Kodety Localization',
        ]
        && $kodety_test_nocache_calls === 1,
    'controlador automático deve emitir somente o 302 localizado, preservar query e não renderizar corpo'
);

$_SERVER['HTTP_USER_AGENT'] .= ' Chrome-Lighthouse';
$kodety_test_redirect = null;
$kodety_test_nocache_calls = 0;
ob_start();
$plugin->route_public_locale();
$pagespeed_redirect_output = ob_get_clean();
kodety_assert(
    $pagespeed_redirect_output === ''
        && $kodety_test_redirect === null
        && $kodety_test_nocache_calls === 0,
    'PageSpeed Insights deve medir a URL solicitada sem redirect automático ou efeitos colaterais'
);
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 Chrome/136.0.0.0 Mobile Safari/537.36';

$_COOKIE['kodety_locale_choice'] = 'pt-BR';
$kodety_test_redirect = null;
$plugin->route_public_locale();
kodety_assert(
    $kodety_test_redirect === null,
    'escolha manual pelo idioma principal deve impedir o redirect geográfico'
);

$_COOKIE['kodety_locale_choice'] = 'en-US';
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'BR';
$kodety_test_redirect = null;
$plugin->route_public_locale();
kodety_assert(
    ($kodety_test_redirect['location'] ?? '') === 'https://example.test/en/home/?campaign=geo',
    'escolha manual por outro idioma deve vencer o país atual'
);

$_SERVER['REQUEST_URI'] = '/en/home/';
$_COOKIE['kodety_locale_choice'] = 'pt-BR';
$kodety_test_redirect = null;
$plugin->route_public_locale();
kodety_assert(
    $kodety_test_redirect === null,
    'uma URL já prefixada deve sempre vencer a seleção automática e o cookie anterior'
);

$automatic_controller_localization['automaticLocale'] = false;
file_put_contents(
    $kodety_test_theme_dir . '/localization.json',
    json_encode($automatic_controller_localization, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
);
$_SERVER['REQUEST_URI'] = '/';
unset($_COOKIE['kodety_locale_choice']);
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'NL';
$kodety_test_redirect = null;
$plugin->route_public_locale();
kodety_assert(
    $kodety_test_redirect === null,
    'false explícito no contrato v3 deve desativar somente o redirect automático'
);
unset($_SERVER['HTTP_CF_IPCOUNTRY'], $_SERVER['HTTP_USER_AGENT'], $_SERVER['REQUEST_METHOD'], $_SERVER['REQUEST_URI']);
@unlink($kodety_test_theme_dir . '/manifest.json');
file_put_contents(
    $kodety_test_theme_dir . '/localization.json',
    json_encode($localization, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

$route_manifest = ['' => 'index.html', 'feature' => 'feature.html', 'about-us' => 'about-us.html', 'privacy-policy' => 'privacy-policy.html', 'utility/style-guide' => 'utility/style-guide.html'];
kodety_assert(
    kodety_resolve_page_relative($route_manifest, 'feature', 'index.html') === 'feature.html',
    'a rota explícita do manifest deve vencer uma Home resolvida incorretamente pelo WordPress'
);
kodety_assert(
    kodety_resolve_page_relative($route_manifest, 'missing', 'about-us.html') === 'about-us.html',
    'uma página WordPress gerenciada continua podendo resolver seu HTML quando não há rota explícita'
);
kodety_assert(
    kodety_resolve_page_relative($route_manifest, 'posts/item', 'index.html', 'detail_blog.html') === 'detail_blog.html',
    'templates CMS devem continuar tendo prioridade sobre páginas estáticas'
);
kodety_assert(
    kodety_resolve_page_relative($route_manifest, 'privacy-policy.html') === 'privacy-policy.html',
    'a URL pública original com extensão .html deve resolver a página do manifest'
);
kodety_assert(
    kodety_resolve_page_relative($route_manifest, 'index.html') === 'index.html',
    'index.html deve continuar sendo um alias válido da raiz pública'
);
$custom_404_manifest = ['' => 'index.html', '404' => 'errors/404/index.html'];
kodety_assert(
    kodety_404_page_relative($custom_404_manifest) === 'errors/404/index.html'
        && kodety_resolve_page_relative($custom_404_manifest, 'missing-route') === 'errors/404/index.html',
    'uma página autoral /404 deve ser usada como fallback mesmo quando estiver em uma pasta'
);
kodety_assert(
    kodety_404_page_relative($route_manifest) === '404.html',
    'sem uma página autoral /404 o runtime deve usar o arquivo de fallback padrão'
);
$default_404 = kodety_default_404_html();
kodety_assert(
    str_contains($default_404, 'Page Not Found')
        && str_contains($default_404, 'does not exist or may have been moved')
        && !str_contains($default_404, 'kodety.com')
        && str_contains($default_404, 'Back to Home')
        && str_contains($default_404, 'href="https://example.test/"')
        && str_contains($default_404, 'prefers-color-scheme:dark'),
    'o 404 padrão deve conter as mensagens, destinos e estilos de dark mode esperados'
);
$public_links = kodety_rewrite_public_page_links(
    '<footer><a href="privacy-policy.html?from=footer#legal">Privacidade</a><a href="https://external.test/page.html">Externo</a></footer>',
    'index.html',
    $route_manifest
);
kodety_assert(
    str_contains($public_links, 'href="https://example.test/privacy-policy?from=footer#legal"'),
    'links Webflow devem navegar pela origem pública sem .html e preservar query e fragmento'
);
kodety_assert(
    str_contains($public_links, 'href="https://external.test/page.html"'),
    'links externos não podem ser reescritos'
);
$english_navigation_localization = $localization;
$english_navigation_localization['translatePagePaths'] = false;
$english_navigation_manifest = ['' => 'index.html', 'about' => 'about.html'];
$english_navigation_request = kodety_localization_request(
    'en',
    $english_navigation_localization,
    $english_navigation_manifest
);
$english_navigation_link = kodety_rewrite_public_page_links(
    '<nav><a href="about.html">About</a></nav>',
    'index.html',
    $english_navigation_manifest,
    $english_navigation_request,
    $english_navigation_localization
);
kodety_assert(
    str_contains($english_navigation_link, 'href="https://example.test/en/about"'),
    'ao navegar dentro de EN, links internos devem preservar /en/ e abrir /en/about'
);
$nested_public_link = kodety_rewrite_public_page_links('<a href="../privacy-policy.html">Privacidade</a>', 'utility/style-guide.html', $route_manifest);
kodety_assert(
    str_contains($nested_public_link, 'href="https://example.test/privacy-policy"'),
    'links relativos em subpastas devem voltar à rota pública correta'
);
$unmapped_public_link = kodety_rewrite_public_page_links('<a href="./legacy/offer.html">Oferta</a>', 'index.html', $route_manifest);
kodety_assert(
    str_contains($unmapped_public_link, 'href="https://example.test/legacy/offer"'),
    'páginas fora do manifest não podem cair no /wp-content do tema nem expor .html'
);
$asset_link = kodety_rewrite_public_page_links('<a href="./files/report.pdf">Relatório</a>', 'index.html', $route_manifest);
kodety_assert(
    str_contains($asset_link, 'href="./files/report.pdf"'),
    'downloads e mídias continuam resolvendo pelo base de assets do tema'
);
$home_public_link = kodety_rewrite_public_page_links('<a href="index.html">Início</a>', 'index.html', $route_manifest);
kodety_assert(
    str_contains($home_public_link, 'href="https://example.test/"'),
    'links para index.html devem navegar para a raiz pública'
);
$home_anchor_link = kodety_rewrite_public_page_links('<nav><a href="#testimonials">Depoimentos</a></nav>', 'index.html', $route_manifest);
kodety_assert(
    str_contains($home_anchor_link, 'href="https://example.test/#testimonials"'),
    'âncoras da Home devem ignorar o base de assets e usar a URL pública'
);
$nested_anchor_link = kodety_rewrite_public_page_links('<a href="#details">Detalhes</a>', 'utility/style-guide.html', $route_manifest);
kodety_assert(
    str_contains($nested_anchor_link, 'href="https://example.test/utility/style-guide#details"'),
    'âncoras de páginas internas devem permanecer na rota pública atual'
);

kodety_assert(
    kodety_project_web_root(['' => 'Arquivos/index.html']) === 'Arquivos'
        && kodety_project_web_root(['' => 'index.html']) === ''
        && kodety_project_web_root([]) === '',
    'a raiz do projeto é a pasta da página principal, e vazia quando ela está na raiz'
);

// Um projeto importado dentro de uma pasta-invólucro publica a Home a partir
// dessa pasta. Ela é detalhe de empacotamento: nem a âncora da Home nem os
// links internos podem ganhar um segmento `/Arquivos` na barra de endereços.
$wrapped_manifest = ['' => 'Arquivos/index.html', 'Arquivos' => 'Arquivos/index.html', 'Arquivos/cases' => 'Arquivos/cases.html'];
$wrapped_anchor = kodety_rewrite_public_page_links('<nav><a href="#about">Sobre</a></nav>', 'Arquivos/index.html', $wrapped_manifest);
kodety_assert(
    str_contains($wrapped_anchor, 'href="https://example.test/#about"'),
    'âncoras da Home não podem herdar a pasta-invólucro do projeto importado'
);
$wrapped_page_link = kodety_rewrite_public_page_links('<a href="./cases.html">Cases</a>', 'Arquivos/index.html', $wrapped_manifest);
kodety_assert(
    str_contains($wrapped_page_link, 'href="https://example.test/cases"'),
    'links internos de temas antigos devem remover a pasta-invólucro e a extensão da rota pública'
);
// Depois da republicação o manifest não guarda mais a pasta-invólucro.
$rebuilt_manifest = ['' => 'Arquivos/index.html', 'cases' => 'Arquivos/cases.html'];
$rebuilt_page_link = kodety_rewrite_public_page_links('<a href="./cases.html">Cases</a>', 'Arquivos/index.html', $rebuilt_manifest);
kodety_assert(
    str_contains($rebuilt_page_link, 'href="https://example.test/cases"'),
    'após republicar, páginas da pasta-invólucro respondem na raiz pública'
);
$client_routes = kodety_public_routes_runtime_config(
    'Arquivos/index.html',
    $rebuilt_manifest,
    [],
    [],
    'https://example.test/wp-content/themes/kodety-generated/site/Arquivos/'
);
kodety_assert(
    ($client_routes['currentUrl'] ?? '') === 'https://example.test/'
        && ($client_routes['routes']['arquivos/cases.html'] ?? '') === 'https://example.test/cases'
        && ($client_routes['routeAliases']['arquivos/cases'] ?? '') === 'https://example.test/cases',
    'o runtime do navegador deve receber o mesmo mapa público usado pela reescrita PHP'
);
$localized_client_routes = kodety_public_routes_runtime_config(
    'index.html',
    ['' => 'index.html', 'cases' => 'cases.html'],
    kodety_localization_request('en/home', $localization),
    $localization,
    'https://example.test/wp-content/themes/kodety-generated/site/'
);
kodety_assert(
    ($localized_client_routes['publicBase'] ?? '') === 'https://example.test/en/'
        && ($localized_client_routes['routes']['cases.html'] ?? '') === 'https://example.test/en/cases',
    'o runtime do navegador deve preservar o prefixo do locale inclusive em páginas dinâmicas ainda fora do manifest'
);
$client_runtime_html = kodety_inject_public_routes_runtime(
    '<html><body><main>Site</main></body></html>',
    'Arquivos/index.html',
    $rebuilt_manifest,
    [],
    [],
    'https://example.test/wp-content/themes/kodety-generated/site/Arquivos/'
);
kodety_assert(
    str_contains($client_runtime_html, 'id="kodety-public-routes-config"')
        && str_contains($client_runtime_html, 'data-kodety-public-routes-runtime')
        && str_contains($client_runtime_html, 'https://example.test/cases'),
    'toda página publicada deve carregar a proteção para links criados no cliente'
);
$raw_link_literal = 'const template=`<a href="./cases.html">Cases</a>`;';
$raw_link_document = '<script>' . $raw_link_literal . '</script><a href="./cases.html">Cases</a>';
$raw_link_rewritten = kodety_rewrite_public_page_links(
    $raw_link_document,
    'Arquivos/index.html',
    $rebuilt_manifest
);
kodety_assert(
    str_contains($raw_link_rewritten, $raw_link_literal)
        && substr_count($raw_link_rewritten, 'href="https://example.test/cases"') === 1,
    'links reais devem ser reescritos sem alterar templates <a> dentro de JavaScript'
);
kodety_assert(
    str_contains(kodety_rewrite_public_page_links('<a href="#about">Sobre</a>', 'Arquivos/index.html', $rebuilt_manifest), 'href="https://example.test/#about"'),
    'a Home republicada mantém as âncoras na raiz, preservando as scroll sections'
);

@unlink($kodety_test_theme_dir . '/localization.json');
@rmdir($kodety_test_theme_dir);

fwrite(STDOUT, "CMS runtime: bindings, rotas públicas, localização e hardening aprovados.\n");
