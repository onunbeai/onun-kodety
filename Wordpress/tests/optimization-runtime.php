<?php

/** Isolated regression test for Kodety's release optimizer. */
define('ABSPATH', __DIR__);
defined('MB_IN_BYTES') || define('MB_IN_BYTES', 1024 * 1024);
final class Kodety_License {
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public function is_active(): bool { return true; }
    public function public_status(): array { return ['valid' => true, 'limits' => []]; }
}
if (!function_exists('wp_mkdir_p')) {
    function wp_mkdir_p(string $directory): bool { return is_dir($directory) || mkdir($directory, 0777, true); }
}
if (!function_exists('get_temp_dir')) {
    function get_temp_dir(): string { return rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR; }
}
if (!function_exists('wp_upload_dir')) {
    function wp_upload_dir(): array { return ['error' => 'disabled in isolated test']; }
}
if (!function_exists('get_option')) {
    function get_option(string $name, mixed $default = false): mixed { return $default; }
}
if (!function_exists('home_url')) {
    function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
}
if (!function_exists('update_option')) {
    function update_option(string $name, mixed $value, bool $autoload = false): bool { return true; }
}
if (!function_exists('sanitize_file_name')) {
    function sanitize_file_name(string $name): string { return preg_replace('/[^A-Za-z0-9._-]+/', '-', $name) ?: ''; }
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_optimization_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

if (!class_exists('DOMDocument')) {
    fwrite(STDERR, "FAIL: a extensão DOM é necessária para testar as otimizações.\n");
    exit(1);
}

$GLOBALS['kodety_optimization_actions'] = [];
if (!function_exists('add_action')) {
    function add_action(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): bool {
        $GLOBALS['kodety_optimization_actions'][$hook][$priority][] = $callback;
        return true;
    }
}
if (!function_exists('remove_action')) {
    function remove_action(string $hook, mixed $callback, int $priority = 10): bool {
        $callbacks = &$GLOBALS['kodety_optimization_actions'][$hook][$priority];
        if (!is_array($callbacks)) return false;
        foreach ($callbacks as $index => $candidate) {
            if ($candidate !== $callback) continue;
            unset($callbacks[$index]);
            return true;
        }
        return false;
    }
}
if (!function_exists('has_action')) {
    function has_action(string $hook, mixed $callback = false): int|bool {
        foreach (($GLOBALS['kodety_optimization_actions'][$hook] ?? []) as $priority => $callbacks) {
            if ($callback === false && $callbacks) return true;
            foreach ($callbacks as $candidate) {
                if ($candidate === $callback) return (int) $priority;
            }
        }
        return false;
    }
}
if (!function_exists('wp_head')) {
    function wp_head(): void {
        $actions = $GLOBALS['kodety_optimization_actions']['wp_head'] ?? [];
        ksort($actions, SORT_NUMERIC);
        foreach ($actions as $callbacks) foreach ($callbacks as $callback) {
            if (is_callable($callback)) $callback();
        }
    }
}
if (!function_exists('add_filter')) {
    function add_filter(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): bool { return true; }
}
if (!function_exists('apply_filters')) {
    function apply_filters(string $hook, mixed $value, mixed ...$args): mixed {
        if ($hook === 'kodety_runtime_context') {
            return $GLOBALS['kodety_optimization_runtime_context'] ?? $value;
        }
        return $value;
    }
}
require dirname(__DIR__) . '/kodety/theme-runtime/functions.php';

$GLOBALS['kodety_optimization_runtime_context'] = ['release' => '20260831-AbC123'];
kodety_optimization_assert(
    kodety_runtime_release() === '20260831-AbC123',
    'runtime deve preservar exatamente maiúsculas/minúsculas do buildId, inclusive no modo Agência'
);
$GLOBALS['kodety_optimization_runtime_context'] = [];

$runtime_asset_source = '<!doctype html><html><head>'
    . '<link rel="preload stylesheet" href="styles/site.css?theme=dark#layout">'
    . '<link rel="stylesheet" href="/styles/root.css">'
    . '<link rel="stylesheet" href="https://cdn.example.test/external.css">'
    . '<link rel="stylesheet" href="//cdn.example.test/protocol-relative.css">'
    . '<link rel="stylesheet" href="data:text/css,.safe%7Bdisplay:block%7D">'
    . '<link rel="stylesheet" href="#critical">'
    . '<link rel="icon" href="icons/favicon.css">'
    . '<script src="scripts/app.js?mode=prod#boot"></script>'
    . '<script src="/scripts/root.js?kodety-release=old"></script>'
    . '<script src="https://cdn.example.test/external.js"></script>'
    . '<script>const fake=`<link rel="stylesheet" href="literal.css">`;</script>'
    . '<!-- <script src="commented.js"></script> -->'
    . '<template><script src="template.js"></script></template>'
    . '<template><template></template><script src="nested-template.js"></script></template>'
    . '</head><body><a href="next.html">Next</a>'
    . '<!-- kodety-custom-code:start local-script --><script src="custom-runtime.js"></script><!-- kodety-custom-code:end local-script -->'
    . '</body></html>';
$runtime_asset_versioned = kodety_version_runtime_local_asset_urls(
    $runtime_asset_source,
    'Release-A'
);
kodety_optimization_assert(
    str_contains($runtime_asset_versioned, 'href="styles/site.css?theme=dark&amp;kodety-release=Release-A#layout"')
        && str_contains($runtime_asset_versioned, 'href="/styles/root.css?kodety-release=Release-A"')
        && str_contains($runtime_asset_versioned, 'src="scripts/app.js?mode=prod&amp;kodety-release=Release-A#boot"')
        && str_contains($runtime_asset_versioned, 'src="/scripts/root.js?kodety-release=Release-A"'),
    'runtime público deve versionar CSS/JS local pela release preservando query e fragment'
);
kodety_optimization_assert(
    str_contains($runtime_asset_versioned, 'href="https://cdn.example.test/external.css"')
        && str_contains($runtime_asset_versioned, 'href="//cdn.example.test/protocol-relative.css"')
        && str_contains($runtime_asset_versioned, 'href="data:text/css,.safe%7Bdisplay:block%7D"')
        && str_contains($runtime_asset_versioned, 'href="#critical"')
        && str_contains($runtime_asset_versioned, 'href="icons/favicon.css"')
        && str_contains($runtime_asset_versioned, 'src="https://cdn.example.test/external.js"')
        && str_contains($runtime_asset_versioned, 'href="literal.css"')
        && str_contains($runtime_asset_versioned, 'src="commented.js"')
        && str_contains($runtime_asset_versioned, 'src="template.js"')
        && str_contains($runtime_asset_versioned, 'src="nested-template.js"')
        && str_contains($runtime_asset_versioned, '<a href="next.html">')
        && str_contains($runtime_asset_versioned, '<script src="custom-runtime.js"></script>'),
    'runtime não deve reescrever URLs externas/inertes, navegação, ícones ou Custom Code'
);
$runtime_asset_next_release = kodety_version_runtime_local_asset_urls(
    $runtime_asset_versioned,
    'Release-B'
);
kodety_optimization_assert(
    substr_count($runtime_asset_next_release, 'kodety-release=Release-B') === 4
        && !str_contains($runtime_asset_next_release, 'kodety-release=Release-A')
        && substr_count($runtime_asset_next_release, 'kodety-release=') === 4,
    'nova release deve substituir o parâmetro reservado sem acumular versões antigas'
);
$runtime_index_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/theme-runtime/index.php');
kodety_optimization_assert(
    str_contains($runtime_index_source, '$html = kodety_version_runtime_local_asset_urls($html);'),
    'entrypoint público deve aplicar a versão da release antes de servir CSS/JS local'
);

if (!function_exists('wp_site_icon')) {
    function wp_site_icon(): void { echo '<link rel="icon" href="wordpress-site-icon.png" data-wordpress-site-icon>'; }
}
function kodety_optimization_other_head_callback(): void { echo '<meta name="head-extension" content="preserved">'; }
function kodety_optimization_plugin_favicon_callback(): void {
    echo '<link rel="icon" href="plugin-icon.png" data-plugin-icon>';
    echo '<link rel="apple-touch-icon" href="plugin-touch.png" data-plugin-touch>';
    echo '<link rel="mask-icon" href="plugin-mask.svg" data-plugin-mask>';
    echo '<link rel="stylesheet" href="plugin-style.css" data-plugin-style>';
    echo '<template><link rel="icon" href="plugin-template.png" data-plugin-template></template>';
    echo '<!-- <link rel="icon" href="plugin-comment.png" data-plugin-comment> -->';
}
add_action('wp_head', 'kodety_optimization_other_head_callback', 10);
add_action('wp_head', 'wp_site_icon', 20);
add_action('wp_head', 'kodety_optimization_plugin_favicon_callback', 30);
add_action('wp_head', 'wp_site_icon', 99);
$captured_kodety_head = kodety_capture_wordpress_head_for_document(
    '<html><head><link rel="icon" href="favicon.png" data-kodety-favicon="fallback"></head></html>'
);
kodety_optimization_assert(
    !str_contains($captured_kodety_head, 'data-wordpress-site-icon')
        && !str_contains($captured_kodety_head, 'data-plugin-icon')
        && !str_contains($captured_kodety_head, 'data-plugin-touch')
        && !str_contains($captured_kodety_head, 'data-plugin-mask')
        && str_contains($captured_kodety_head, 'head-extension')
        && str_contains($captured_kodety_head, 'data-plugin-style')
        && str_contains($captured_kodety_head, 'data-plugin-template')
        && str_contains($captured_kodety_head, 'data-plugin-comment')
        && in_array('wp_site_icon', $GLOBALS['kodety_optimization_actions']['wp_head'][20] ?? [], true)
        && in_array('wp_site_icon', $GLOBALS['kodety_optimization_actions']['wp_head'][99] ?? [], true),
    'documento com favicon autorado deve suprimir ícones concorrentes, preservar outros hooks e restaurar o Site Icon'
);
$captured_imported_head = kodety_capture_wordpress_head_for_document(
    '<html><head><link rel="icon" href="imported.ico"></head></html>'
);
kodety_optimization_assert(
    !str_contains($captured_imported_head, 'data-wordpress-site-icon')
        && str_contains($captured_imported_head, 'head-extension'),
    'favicon importado sem marcador também deve assumir ownership do documento'
);
$captured_wordpress_head = kodety_capture_wordpress_head_for_document('<html><head></head></html>');
kodety_optimization_assert(
    str_contains($captured_wordpress_head, 'data-wordpress-site-icon')
        && str_contains($captured_wordpress_head, 'data-plugin-icon')
        && str_contains($captured_wordpress_head, 'data-plugin-touch')
        && str_contains($captured_wordpress_head, 'data-plugin-mask')
        && str_contains($captured_wordpress_head, 'head-extension'),
    'documento sem favicon autorado deve preservar o fallback atual do WordPress'
);
remove_action('wp_head', 'kodety_optimization_other_head_callback', 10);
remove_action('wp_head', 'wp_site_icon', 20);
remove_action('wp_head', 'kodety_optimization_plugin_favicon_callback', 30);
remove_action('wp_head', 'wp_site_icon', 99);

$raw_text_document = new DOMDocument('1.0', 'UTF-8');
@$raw_text_document->loadHTML(
    '<?xml encoding="utf-8" ?><!doctype html><html><head><style>.label::after{content:"café &amp; chá"}</style></head><body><script type="module">const config={"title":"O evento começa em","literal":"&amp;"};</script></body></html>',
    LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
);
$raw_text_html = kodety_save_runtime_html($raw_text_document);
kodety_optimization_assert(is_string($raw_text_html) && str_contains($raw_text_html, '"title":"O evento começa em"'), 'runtime deve preservar UTF-8 literal dentro de scripts');
kodety_optimization_assert(str_contains((string) $raw_text_html, '"literal":"&amp;"'), 'runtime deve preservar entidades intencionais dentro de scripts');
kodety_optimization_assert(str_contains((string) $raw_text_html, 'content:"café &amp; chá"'), 'runtime deve preservar payloads CSS raw-text sem dupla codificação');

$custom_head_payload = '.custom::after{content:"ação &amp; café";background:url("/images/private.png")}';
$custom_head_block = '<!-- kodety-custom-code:start site-head-style --><style>' . $custom_head_payload . '</style><!-- kodety-custom-code:end site-head-style -->';
$custom_body_payload = 'window.__customCode={label:"ação",literal:"&amp;",template:`<img src="images/private.png">`};';
$custom_body_block = '<!-- kodety-custom-code:start site-body-script --><script>' . $custom_body_payload . '</script><script src="custom-runtime.js"></script><!-- kodety-custom-code:end site-body-script -->';
$runtime_custom_source = '<!doctype html><html><head>' . $custom_head_block . '</head><body>' . $custom_body_block . '</body></html>';
[$runtime_custom_protected, $runtime_custom_blocks] = kodety_protect_runtime_custom_code_blocks($runtime_custom_source);
kodety_optimization_assert(!str_contains($runtime_custom_protected, $custom_body_payload), 'runtime deve retirar Custom Code do alcance das transformações intermediárias');
kodety_optimization_assert(kodety_restore_runtime_custom_code_blocks($runtime_custom_protected, $runtime_custom_blocks) === $runtime_custom_source, 'runtime deve restaurar blocos de Custom Code byte a byte');
$runtime_raw_source = '<script>const template=`<img src="/images/private.png">`;const css="url(/images/private.png)";</script><style>.card{background:url("/images/private.png")}</style>';
[$runtime_raw_protected, $runtime_raw_payloads] = kodety_protect_runtime_raw_text_payloads($runtime_raw_source);
kodety_optimization_assert(!str_contains($runtime_raw_protected, '/images/private.png'), 'reescrita runtime não deve enxergar URLs literais dentro de JavaScript/CSS');
kodety_optimization_assert(kodety_restore_runtime_raw_text_payloads($runtime_raw_protected, $runtime_raw_payloads) === $runtime_raw_source, 'payloads runtime de script/style devem voltar byte a byte');
$runtime_dom_payload = 'window.__rawHeadLiteral="</head>";window.__replacementLiteral="$&";';
$runtime_dom_source = '<!doctype html><html><head><script>' . $runtime_dom_payload . '</script></head><body>Safe</body></html>';
[$runtime_dom_protected, $runtime_dom_payloads] = kodety_protect_runtime_raw_text_payloads($runtime_dom_source);
$runtime_dom_document = new DOMDocument('1.0', 'UTF-8');
@$runtime_dom_document->loadHTML(
    '<?xml encoding="utf-8" ?>' . $runtime_dom_protected,
    LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
);
$runtime_dom_result = kodety_save_runtime_html($runtime_dom_document);
$runtime_dom_result = is_string($runtime_dom_result)
    ? kodety_restore_runtime_raw_text_payloads($runtime_dom_result, $runtime_dom_payloads)
    : '';
kodety_optimization_assert(str_contains($runtime_dom_result, $runtime_dom_payload), 'parse DOM do runtime deve preservar tags e metacaracteres literais dentro de scripts');
kodety_optimization_assert(!str_contains($runtime_dom_result, '<p>&amp;'), 'parse DOM do runtime não pode transformar JavaScript em parágrafo');
$runtime_index_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/theme-runtime/index.php');
$runtime_functions_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/theme-runtime/functions.php');
kodety_optimization_assert(str_contains($runtime_index_source, 'kodety_protect_runtime_custom_code_blocks') && str_contains($runtime_index_source, 'kodety_restore_runtime_custom_code_blocks'), 'entrypoint público deve isolar e restaurar Custom Code');
kodety_optimization_assert(str_contains($runtime_index_source, 'kodety_protect_runtime_raw_text_payloads') && str_contains($runtime_index_source, 'kodety_restore_runtime_raw_text_payloads'), 'entrypoint público deve proteger raw-text durante reescrita de URLs');
$stylesheet_literal = 'const template=`<link rel="icon" data-kodety-favicon="literal" href="literal.ico">`;';
$title_literal = 'Título <link rel="icon" data-kodety-favicon="title" href="title-literal.ico">';
$authored_favicon_source = '<html><head>'
    . '<link rel="icon" href="imported.ico">'
    . '<link rel="icon" href="managed.png" data-kodety-favicon="fallback">'
    . '<link data-rel="icon" data-href="fake.ico" title="data-kodety-favicon">'
    . '<link title="foo rel=\'icon\' href=\'quoted-fake.ico\' data-kodety-favicon">'
    . '<template><template></template><link rel="icon" href="template.ico" data-kodety-favicon="template"></template>'
    . '<script>' . $stylesheet_literal . '</script>'
    . '</head></html>';
kodety_optimization_assert(
    count(kodety_authored_favicon_link_tags($authored_favicon_source)) === 2
        && kodety_document_has_authored_favicon($authored_favicon_source)
        && !kodety_document_has_authored_favicon(
            '<html><head><link data-rel="icon" data-href="fake.ico" title="data-kodety-favicon">'
                . '<link title="foo rel=\'icon\' href=\'quoted-fake.ico\' data-kodety-favicon">'
                . '<script>' . $stylesheet_literal . '</script></head></html>'
        )
        && !kodety_document_has_authored_favicon(
            '<html><head><title>' . $title_literal . '</title><body>'
                . '<link rel="icon" href="body-only.ico"></body></html>'
        )
        && !kodety_document_has_authored_favicon(
            '<html><head-x><link rel="icon" href="custom-head.ico"></head-x></html>'
        )
        && !kodety_document_has_authored_favicon(
            '<!-- <head><link rel="icon" href="comment-head.ico"></head> -->'
                . '<html><head><title>Sem favicon</title></head><body></body></html>'
        )
        && !kodety_document_has_authored_favicon(
            '<html><head><link rel="icon" href="java&#x09;script:invalid">'
                . '<link rel="icon" href="blob:https://example.test/transient">'
                . '<link rel="icon" href="data:text/plain,invalid">'
                . '<link rel="icon" href="#empty"></head></html>'
        ),
    'ownership deve reconhecer links icon autorados, inclusive legados, sem aceitar atributos data-* ou conteúdo inerte'
);
$runtime_filter_offset = strpos($runtime_index_source, "apply_filters('kodety_runtime_html'");
$runtime_echo_offset = strpos($runtime_index_source, 'echo $html', $runtime_filter_offset === false ? 0 : $runtime_filter_offset);
kodety_optimization_assert(
    $runtime_filter_offset !== false
        && $runtime_echo_offset !== false
        && $runtime_filter_offset < $runtime_echo_offset,
    'o HTML público final deve aplicar integrações antes de responder'
);
kodety_optimization_assert(
    str_contains($runtime_index_source, '$html = kodety_version_runtime_local_asset_urls($html);')
        && str_contains($runtime_functions_source, 'function kodety_runtime_version_local_asset_url(')
        && str_contains($runtime_functions_source, "'kodety-release='"),
    'runtime publicado deve vincular CSS/JS local à release atual sem alterar os arquivos autorais'
);
kodety_optimization_assert(
    str_contains($runtime_index_source, 'kodety_capture_wordpress_head_for_document($html)'),
    'entrypoint público deve usar a captura de wp_head com ownership de favicon testável'
);

$temporary = sys_get_temp_dir() . '/kodety-optimization-' . bin2hex(random_bytes(5));
mkdir($temporary, 0777, true);
mkdir($temporary . '/assets', 0777, true);
$source_css = <<<'CSS'
/* authored comment must survive publication */
.hero { background: url('../images/cover.webp'); color: red; }
div[style*="width: 90vw"] { overflow: visible; }
.label::after { content: "Iniciar: um; projeto"; }
CSS;
file_put_contents($temporary . '/assets/site.css', $source_css);
file_put_contents($temporary . '/assets/font.woff2', 'font');
file_put_contents($temporary . '/plain.js', 'window.plain=true;');
file_put_contents($temporary . '/app.js', 'CustomEase.create("page", "0,0,1,1"); gsap.defaults({ease:"page"});');
file_put_contents($temporary . '/gsap.min.js', 'window.gsap={registerPlugin:function(){},defaults:function(){}};');
file_put_contents($temporary . '/CustomEase.min.js', 'window.CustomEase={create:function(){}};');
$optimizer_raw_payload = 'window.__optimizerRawHead="</head>";window.__optimizerReplacement="$&";';
$source_html = '<!doctype html><!--?xml encoding="utf-8" ?--><!-- Made with Kodety &middot; unkern.com --><!-- Published Jan 1, 2020, 1:00 AM UTC --><!--?xml encoding="utf-8" ?--><html data-wf-page="page-1" data-wf-site="site-1" data-wf-status="1"><head>
  <link rel="canonical" href="/article">
  <link rel="stylesheet" href="assets/site.css">
' . $custom_head_block . '<script data-raw-text-regression>' . $optimizer_raw_payload . '</script></head><body><!-- authored-comment --><p id="roll-label"><span>Iniciar</span> <span>um</span> <span>projeto</span></p><!--$--><section id="react-boundary">Hydrated</section><!--/$--><div style="width: 90vw">Wide</div><img src="hero.webp"><img srcset="small.webp 1x, large.webp 2x" src="second.webp"><a class="w-webflow-badge" href="https://webflow.com">Made in Webflow</a><script src="plain.js"></script><script defer src="app.js"></script><script defer src="gsap.min.js"></script><script defer src="CustomEase.min.js"></script><script>gsap.registerPlugin(CustomEase);window.kodetyConfig={"title":"O evento começa em","literal":"&amp;"};</script>' . $custom_body_block . '</body></html>';
file_put_contents($temporary . '/index.html', $source_html);

$reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $reflection->newInstanceWithoutConstructor();
$copy_public_tree = $reflection->getMethod('copy_tree');
$nested_copy_source = $temporary . '/nested-public-source';
$nested_copy_target = $temporary . '/nested-public-target';
mkdir($nested_copy_source . '/v2/pt', 0777, true);
mkdir($nested_copy_source . '/v2/scripts', 0777, true);
$nested_root_html = '<!doctype html><script defer src="scripts/prism-ledger-v33.js"></script>';
$nested_pt_html = '<!doctype html><script defer src="../scripts/prism-ledger-v33.js"></script>';
$nested_shader = 'window.__prismLedgerV33 = "shader bytes must remain exact";';
file_put_contents($nested_copy_source . '/v2/index.html', $nested_root_html);
file_put_contents($nested_copy_source . '/v2/pt/index.html', $nested_pt_html);
file_put_contents($nested_copy_source . '/v2/scripts/prism-ledger-v33.js', $nested_shader);
$copy_public_tree->invoke($plugin, $nested_copy_source, $nested_copy_target);
kodety_optimization_assert(
    file_get_contents($nested_copy_target . '/v2/index.html') === $nested_root_html
        && file_get_contents($nested_copy_target . '/v2/pt/index.html') === $nested_pt_html
        && file_get_contents($nested_copy_target . '/v2/scripts/prism-ledger-v33.js') === $nested_shader,
    'tema deve copiar HTML aninhado e shader JavaScript byte a byte'
);
kodety_optimization_assert(
    realpath(dirname($nested_copy_target . '/v2/pt/index.html') . '/../scripts/prism-ledger-v33.js')
        === realpath($nested_copy_target . '/v2/scripts/prism-ledger-v33.js'),
    'script relativo de v2/pt deve resolver para o shader publicado em v2/scripts'
);
$copy_failure_source = $temporary . '/public-copy-failure-source';
$copy_failure_target = $temporary . '/public-copy-failure-target';
mkdir($copy_failure_source . '/scripts', 0777, true);
mkdir($copy_failure_target, 0777, true);
file_put_contents($copy_failure_source . '/scripts/prism-ledger-v33.js', $nested_shader);
file_put_contents($copy_failure_target . '/scripts', 'impede a criação do diretório de destino');
$copy_failure_rejected = false;
set_error_handler(static fn(): bool => true);
try {
    $copy_public_tree->invoke($plugin, $copy_failure_source, $copy_failure_target);
} catch (Throwable) {
    $copy_failure_rejected = true;
} finally {
    restore_error_handler();
}
kodety_optimization_assert(
    $copy_failure_rejected,
    'falha ao criar um destino aninhado deve interromper a preparação do tema'
);
$redirect_project = $temporary . '/redirect-project';
mkdir($redirect_project . '/.incode', 0777, true);
file_put_contents($redirect_project . '/.incode/project.json', json_encode([
    'version' => 1,
    'redirects' => [
        'version' => 1,
        'entries' => [
            ['id' => 'first', 'source' => '/old', 'destination' => '/new', 'match' => 'exact', 'status' => 308, 'preserveQuery' => false, 'enabled' => true],
            ['id' => 'draft', 'source' => '', 'destination' => '', 'match' => 'exact', 'status' => 301, 'preserveQuery' => true, 'enabled' => false],
            ['id' => 'legacy', 'from' => '/docs', 'to' => 'https://docs.example.test/', 'matchType' => 'prefix', 'statusCode' => 302],
        ],
    ],
], JSON_UNESCAPED_SLASHES));
$project_redirects = $reflection->getMethod('project_redirects');
$published_redirects = $project_redirects->invoke($plugin, $redirect_project);
kodety_optimization_assert(
    array_column($published_redirects['entries'], 'id') === ['first', 'legacy'],
    'publicação deve extrair redirects habilitados em sua ordem e omitir rascunhos'
);
kodety_optimization_assert(
    $published_redirects['entries'][0]['status'] === 308
        && $published_redirects['entries'][0]['preserveQuery'] === false
        && $published_redirects['entries'][1]['match'] === 'prefix',
    'payload público de redirects deve preservar status, query e aliases normalizados'
);
$plugin_runtime_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
kodety_optimization_assert(
    str_contains($plugin_runtime_source, "'/redirects.json'")
        && str_contains($plugin_runtime_source, "'redirects.php'")
        && str_contains($plugin_runtime_source, 'theme_runtime_sources()'),
    'build do tema deve publicar o payload e o runtime de redirects'
);
$expected_lossless_settings = [
    'minifyHtml' => false,
    'minifyCss' => false,
    'lazyImages' => false,
    'preloadFonts' => false,
    'deferScripts' => false,
];
$default_optimizations = $reflection->getMethod('default_optimization_settings');
kodety_optimization_assert(
    $default_optimizations->invoke(null) === Kodety_Publication_Optimizer::defaults(),
    'novas instalações usam o contrato versionado das otimizações de publicação'
);
$sanitize_optimizations = $reflection->getMethod('sanitize_optimization_settings');
kodety_optimization_assert(
    $sanitize_optimizations->invoke($plugin, array_fill_keys(array_keys($expected_lossless_settings), true)) === Kodety_Publication_Optimizer::defaults(false),
    'transformações destrutivas devem continuar fail-closed'
);
$optimization_panel_start = strpos($plugin_runtime_source, 'id="kodety-area-optimizations"');
$optimization_panel_end = strpos(
    $plugin_runtime_source,
    'data-kodety-area="security"',
    $optimization_panel_start === false ? 0 : $optimization_panel_start
);
$optimization_panel_source = $optimization_panel_start !== false && $optimization_panel_end !== false
    ? substr($plugin_runtime_source, $optimization_panel_start, $optimization_panel_end - $optimization_panel_start)
    : '';
kodety_optimization_assert(
    !str_contains($optimization_panel_source, 'responsiveImages')
        && !str_contains($optimization_panel_source, 'Imagens responsivas automáticas'),
    'painel de publicação não deve expor redimensionamento ou srcset automático'
);

$native_esm_root = $temporary . '/native-esm';
mkdir($native_esm_root . '/assets', 0777, true);
$native_esm_html = '<!doctype html><html><body><script type="module" src="assets/app.mjs"></script></body></html>';
$native_esm_module = 'import { value } from "./dependency.js"; document.body.dataset.value = String(value);';
file_put_contents($native_esm_root . '/index.html', $native_esm_html);
file_put_contents($native_esm_root . '/assets/app.mjs', $native_esm_module);
file_put_contents($native_esm_root . '/assets/dependency.js', 'export const value = 1;');
$coded_build_guard = $reflection->getMethod('assert_coded_build_integrity');
$native_esm_accepted = true;
try {
    $coded_build_guard->invoke($plugin, $native_esm_root, [$native_esm_root . '/index.html']);
} catch (Throwable) {
    $native_esm_accepted = false;
}
kodety_optimization_assert($native_esm_accepted, 'site HTML executável com ESM local deve publicar sem conversão para kodety-build');
kodety_optimization_assert(
    file_get_contents($native_esm_root . '/index.html') === $native_esm_html
        && file_get_contents($native_esm_root . '/assets/app.mjs') === $native_esm_module,
    'validação de publicação não pode reescrever HTML ou módulos nativos'
);

$publication_release = '20260714-023000-ABC123';
$stamp_published_html = $reflection->getMethod('stamp_published_html');
$expected_published_html = (string) $stamp_published_html->invoke($plugin, $source_html, $publication_release);
$optimizer = $reflection->getMethod('optimize_generated_site');
$optimizer->invoke($plugin, $temporary, [
    // Deliberately request every former transform. The publication boundary
    // must remain fail-closed even for an old Builder or a replayed request.
    'minifyHtml' => true,
    'minifyCss' => true,
    'lazyImages' => true,
    'preloadFonts' => true,
    'deferScripts' => true,
], $publication_release);

$html = (string) file_get_contents($temporary . '/index.html');
$css = (string) file_get_contents($temporary . '/assets/site.css');
kodety_optimization_assert($html === $expected_published_html, 'publicação deve alterar somente a assinatura, preservando o HTML autoral byte a byte');
kodety_optimization_assert($css === $source_css, 'publicação deve preservar cada byte do CSS autoral');
kodety_optimization_assert(str_contains($html, '<span>Iniciar</span> <span>um</span> <span>projeto</span>'), 'whitespace semântico entre spans deve sobreviver à publicação');
kodety_optimization_assert(substr_count($html, '<!--$-->') === 1 && substr_count($html, '<!--/$-->') === 1, 'markers React/Suspense devem sobreviver à publicação');
kodety_optimization_assert(str_contains($css, 'div[style*="width: 90vw"]'), 'string de seletor CSS deve conservar whitespace interno');
kodety_optimization_assert(str_contains($css, 'content: "Iniciar: um; projeto"'), 'conteúdo CSS entre aspas não pode ser minificado por regex');
kodety_optimization_assert(str_contains($html, '<!-- authored-comment -->'), 'comentários de framework e do autor devem permanecer no HTML');
kodety_optimization_assert(!str_contains($html, 'loading="lazy"') && !str_contains($html, 'decoding="async"'), 'publicação não pode mudar o timing das imagens');
kodety_optimization_assert(str_contains($html, '<script src="plain.js"></script>'), 'publicação não pode adicionar defer a scripts autorais');
kodety_optimization_assert(strpos($html, 'app.js') < strpos($html, 'gsap.min.js') && strpos($html, 'gsap.min.js') < strpos($html, 'CustomEase.min.js'), 'publicação deve preservar a ordem autoral de scripts e dependências GSAP');
kodety_optimization_assert(str_contains($html, '<script defer src="gsap.min.js"></script>'), 'publicação não pode remover atributos autorais de scripts');
kodety_optimization_assert(str_contains($html, 'data-wf-status="1"') && str_contains($html, 'w-webflow-badge'), 'publicação lossless não pode apagar atributos ou elementos do projeto');
kodety_optimization_assert(substr_count($html, 'Made with Onun Kodety') === 1, 'cada HTML publicado deve conter apenas a assinatura Kodety atual');
kodety_optimization_assert(str_contains($html, '<!doctype html>' . "\n" . '<!-- Made with Onun Kodety for WordPress -->'), 'a assinatura Kodety deve ficar imediatamente após o doctype sem serializar o documento');
kodety_optimization_assert(!str_contains($html, 'unkern.com'), 'a publicação deve migrar a assinatura legada para Onun Kodety');
kodety_optimization_assert(!str_contains($html, 'Published Jan 1, 2020'), 'uma assinatura de publicação antiga deve ser substituída');
kodety_optimization_assert(!preg_match('~(?:<\?xml|<!--\s*\?xml)~i', $html), 'declarações XML auxiliares não podem vazar ou duplicar no HTML publicado');
kodety_optimization_assert(!str_contains($html, '&middot;'), 'o separador da assinatura deve permanecer UTF-8 literal');
kodety_optimization_assert(str_contains($html, '"title":"O evento começa em"'), 'publicação deve preservar UTF-8 literal dentro de scripts');
kodety_optimization_assert(str_contains($html, '"literal":"&amp;"'), 'publicação deve preservar entidades intencionais dentro de scripts');
kodety_optimization_assert(str_contains($html, $optimizer_raw_payload), 'otimizador deve preservar tags e metacaracteres literais dentro de scripts');
kodety_optimization_assert(!str_contains($html, '<p>&amp;";window.__optimizerReplacement'), 'otimizador não pode converter a cauda de um script em conteúdo HTML');
kodety_optimization_assert(str_contains($html, $custom_head_block), 'otimizador deve preservar Custom Code do head byte a byte');
kodety_optimization_assert(str_contains($html, $custom_body_block), 'otimizador não pode adicionar defer, versão ou reordenar Custom Code do body');
kodety_optimization_assert(substr_count($html, 'kodety-custom-code:start site-head-style') === 1, 'Custom Code do head deve ser materializado exatamente uma vez');
kodety_optimization_assert(substr_count($html, 'kodety-custom-code:start site-body-script') === 1, 'Custom Code do body deve ser materializado exatamente uma vez');

$deterministic_stamp = (string) $stamp_published_html->invoke($plugin, '<!doctype html><html><body>OK</body></html>', '20260714-023000-ABC123');
kodety_optimization_assert(str_contains($deterministic_stamp, '<!-- Published Jul 14, 2026, 2:30 AM UTC -->'), 'o comentário deve registrar o horário UTC extraído da release');
$direct_route_guard = $reflection->getMethod('inject_direct_public_route_guard');
$direct_route_document = '<!doctype html><html><head><script src="app.js"></script></head><body>Cases</body></html>';
$guarded_route_document = (string) $direct_route_guard->invoke($plugin, $direct_route_document, 'cases');
kodety_optimization_assert(
    str_contains($guarded_route_document, 'data-kodety-direct-public-route')
        && str_contains($guarded_route_document, 'location.replace')
        && str_contains($guarded_route_document, 'route="cases"')
        && strpos($guarded_route_document, 'data-kodety-direct-public-route') < strpos($guarded_route_document, 'src="app.js"'),
    'cada HTML físico publicado deve redirecionar para sua rota pública antes de executar código autoral'
);
kodety_optimization_assert(
    $direct_route_guard->invoke($plugin, $guarded_route_document, 'cases') === $guarded_route_document,
    'a proteção de rota pública deve ser idempotente em republicações'
);
$literal_route_guard = (string) $direct_route_guard->invoke($plugin, $direct_route_document, 'cases/$1-price');
kodety_optimization_assert(
    str_contains($literal_route_guard, 'route="cases/$1-price"'),
    'slugs autorais com cifrão devem permanecer literais e nunca virar backreferences durante a publicação'
);
kodety_optimization_assert(str_contains($html, 'rel="canonical" href="/article"'), 'canonical autoral deve permanecer intacta');
kodety_optimization_assert(!str_contains($html, 'font.woff2'), 'publicação não pode injetar preload de fontes');
kodety_optimization_assert(str_contains($css, "url('../images/cover.webp')"), 'URLs CSS autorais não podem receber versão ou reescrita do otimizador');
kodety_optimization_assert(str_contains($css, '/* authored comment must survive publication */'), 'comentários CSS devem ser preservados');
$root_asset_runtime = $temporary . '/root-asset-runtime';
mkdir($root_asset_runtime . '/site/Arquivos/images', 0777, true);
mkdir($root_asset_runtime . '/site/Arquivos/assets', 0777, true);
file_put_contents($root_asset_runtime . '/site/Arquivos/images/cover.webp', 'authored-image');
file_put_contents($root_asset_runtime . '/site/Arquivos/assets/app.mjs', 'import "./dependency.js";');
$resolved_root_asset = kodety_project_root_asset_path(
    '/images/cover.webp?version=author',
    ['' => 'Arquivos/index.html'],
    $root_asset_runtime
);
kodety_optimization_assert(
    $resolved_root_asset === realpath($root_asset_runtime . '/site/Arquivos/images/cover.webp'),
    'runtime deve servir URLs root-relative do web root sem reescrever CSS ou JavaScript'
);
kodety_optimization_assert(
    kodety_project_root_asset_path('/assets/app.mjs', ['' => 'Arquivos/index.html'], $root_asset_runtime)
        === realpath($root_asset_runtime . '/site/Arquivos/assets/app.mjs'),
    'runtime deve preservar e servir o caminho autoral de módulos ESM locais'
);
kodety_optimization_assert(
    kodety_project_root_asset_path('/../wp-config.php', ['' => 'Arquivos/index.html'], $root_asset_runtime) === ''
        && kodety_project_root_asset_path('/index.html', ['' => 'Arquivos/index.html'], $root_asset_runtime) === '',
    'resolvedor lossless de assets deve rejeitar traversal e documentos executáveis'
);
kodety_optimization_assert(
    !str_contains($plugin_runtime_source, 'rewrite_css_root_urls(')
        && !str_contains($plugin_runtime_source, 'normalize_published_module_extensions('),
    'build publicado não pode reescrever CSS nem renomear módulos autorais'
);
$vendor = $temporary . '/scripts/vendor';
mkdir($vendor, 0777, true);
file_put_contents($vendor . '/hash-entry.mjs', 'import "./hash-dependency.mjs"; window.localHydration=true;');
file_put_contents($vendor . '/hash-dependency.mjs', 'export const localDependency=true;');
file_put_contents($temporary . '/hydrated.html', '<!doctype html><script type="module" src="scripts/vendor/hash-entry.mjs"></script>');
$optimizer->invoke(
    $plugin,
    $temporary,
    array_fill_keys(array_keys($expected_lossless_settings), true),
    'release-modules'
);
kodety_optimization_assert(is_file($vendor . '/hash-entry.mjs') && is_file($vendor . '/hash-dependency.mjs'), 'publicação não pode renomear módulos autorais');
kodety_optimization_assert(str_contains((string) file_get_contents($vendor . '/hash-entry.mjs'), './hash-dependency.mjs'), 'imports ESM internos devem permanecer byte-for-byte compatíveis');
kodety_optimization_assert(str_contains((string) file_get_contents($temporary . '/hydrated.html'), 'hash-entry.mjs'), 'o entrypoint HTML deve manter o nome de módulo autoral');
$compatibility_theme = $temporary . '/compatibility-theme';
mkdir($compatibility_theme, 0777, true);
$write_asset_compatibility_rules = $reflection->getMethod('write_asset_compatibility_rules');
$write_asset_compatibility_rules->invoke($plugin, $compatibility_theme);
$compatibility_rules = (string) file_get_contents($compatibility_theme . '/.htaccess');
kodety_optimization_assert(
    str_contains($compatibility_rules, 'AddType application/javascript .js .mjs .cjs')
        && str_contains($compatibility_rules, 'AddType application/wasm .wasm')
        && !str_contains($compatibility_rules, 'Cache-Control')
        && !str_contains($compatibility_rules, 'RewriteCond')
        && !str_contains($compatibility_rules, '?v='),
    'Apache deve receber apenas compatibilidade MIME, sem cache ou versao por query'
);
kodety_optimization_assert(
    str_contains($plugin_runtime_source, '$this->write_asset_compatibility_rules($theme_dir, $optimizations);')
        && !str_contains($plugin_runtime_source, 'write_cache_rules')
        && !str_contains($plugin_runtime_source, 'version_asset_url')
        && !str_contains($plugin_runtime_source, 'browserCache'),
    'publicador nao pode manter o mecanismo antigo de cache/versionamento'
);
$public_upload_base_url = $reflection->getMethod('public_upload_base_url');
$public_upload_asset_url = $reflection->getMethod('public_upload_asset_url');
$broken_uploads = [
    'basedir' => '/var/www/html/wp-content/uploads',
    'baseurl' => 'http://example.test/var/www/html/wp-content/uploads',
];
kodety_optimization_assert(
    $public_upload_base_url->invoke($plugin, $broken_uploads) === 'https://example.test/wp-content/uploads',
    'baseurl local deve manter o contrato absoluto sem expor /var/www/html nem fixar HTTP'
);
kodety_optimization_assert(
    $public_upload_asset_url->invoke($plugin, $broken_uploads, 'kodety/assets/images/hero image.webp')
        === 'https://example.test/wp-content/uploads/kodety/assets/images/hero%20image.webp',
    'asset sincronizado deve receber URL publica absoluta e codificada'
);
kodety_optimization_assert(
    $public_upload_base_url->invoke($plugin, [
        'basedir' => '/srv/uploads',
        'baseurl' => 'https://cdn.example.test/media',
    ]) === 'https://cdn.example.test/media',
    'um CDN externo real deve manter sua base publica'
);
kodety_optimization_assert(
    str_contains($plugin_runtime_source, "do_action('autoptimize_action_cachepurged')")
        && str_contains($plugin_runtime_source, 'run_cache_purge_step')
        && str_contains($plugin_runtime_source, 'remove_legacy_asset_cache_rules'),
    'publish deve limpar caches locais/Cloudflare de forma isolada e remover regras legadas'
);
$asset_path_method = $reflection->getMethod('asset_upload_path');
$hashed_asset_path = $asset_path_method->invoke($plugin, 'images/hero.png', 'abcdef1234567890');
kodety_optimization_assert($hashed_asset_path === 'kodety/assets/images/hero-abcdef123456.png', 'assets WordPress devem usar URL imutável por conteúdo');

$atomic_source = $temporary . '/atomic-source.png';
$atomic_media = $temporary . '/atomic-media.png';
$atomic_theme = $temporary . '/atomic-theme.png';
file_put_contents($atomic_source, 'new-image-bytes');
file_put_contents($atomic_media, 'old-media');
file_put_contents($atomic_theme, 'old-theme');
$atomic_replace = $reflection->getMethod('replace_files_atomically');
$atomic_replace->invoke($plugin, [$atomic_media, $atomic_theme], $atomic_source);
kodety_optimization_assert(file_get_contents($atomic_media) === 'new-image-bytes' && file_get_contents($atomic_theme) === 'new-image-bytes', 'substituição de mídia deve ativar o mesmo conteúdo em todos os destinos');
kodety_optimization_assert(!(glob($temporary . '/.*.kodety-*') ?: []), 'substituição atômica não deve deixar temporários ou backups');

$rewrite_root = $temporary . '/rewrite-assets';
mkdir($rewrite_root, 0777, true);
$asset_rewrite_script_payload = 'const template=`<img src="images/social.png">`;const css="url(images/social.png)";';
$asset_rewrite_style_payload = '.preview{background-image:url("images/social.png")}.preview::after{content:"src=images/social.png"}';
file_put_contents($rewrite_root . '/index.html', '<!doctype html><head><meta property="og:image" content="images/social.png?v=release"><meta name="twitter:image:src" content="images/social.png"><meta name="description" content="images/social.png"><style>' . $asset_rewrite_style_payload . '</style></head><body><img src="images/social.png"><script>' . $asset_rewrite_script_payload . '</script></body>');
file_put_contents($rewrite_root . '/site.css', '.card{background-image:url("images/social.png")}');
$rewrite_assets = $reflection->getMethod('rewrite_theme_asset_references');
$rewrite_assets->invoke($plugin, $rewrite_root, ['images/social.png' => 'https://example.test/uploads/social-hash.png']);
$rewritten_assets_html = (string) file_get_contents($rewrite_root . '/index.html');
kodety_optimization_assert(str_contains($rewritten_assets_html, 'property="og:image" content="https://example.test/uploads/social-hash.png?v=release"'), 'capa Open Graph deve usar a URL pública do asset');
kodety_optimization_assert(str_contains($rewritten_assets_html, 'name="twitter:image:src" content="https://example.test/uploads/social-hash.png"'), 'capa do Twitter deve usar a URL pública do asset');
kodety_optimization_assert(str_contains($rewritten_assets_html, '<img src="https://example.test/uploads/social-hash.png">'), 'subrecursos HTML da mesma origem devem usar a URL pública absoluta');
kodety_optimization_assert(
    file_get_contents($rewrite_root . '/site.css') === '.card{background-image:url("https://example.test/uploads/social-hash.png")}',
    'subrecursos CSS da mesma origem devem usar a URL pública absoluta'
);
kodety_optimization_assert(str_contains($rewritten_assets_html, 'name="description" content="images/social.png"'), 'conteúdo comum de metatags não pode ser tratado como asset');
kodety_optimization_assert(str_contains($rewritten_assets_html, $asset_rewrite_script_payload), 'sincronização de assets não pode reescrever strings dentro de JavaScript');
kodety_optimization_assert(str_contains($rewritten_assets_html, $asset_rewrite_style_payload), 'sincronização de assets não pode reescrever payload CSS inline');

// Publishing used to retain both the ZIP and a second extracted copy forever.
// Preserve a bounded native rollback window while proving the active release
// is never evicted just because it is older than the other fixture directories.
$releases = $temporary . '/private/releases';
mkdir($releases, 0777, true);
for ($index = 1; $index <= 8; $index++) {
    $release = sprintf('release-%02d', $index);
    $directory = $releases . '/' . $release;
    mkdir($directory . '/project', 0777, true);
    file_put_contents($directory . '/project/index.html', '<!doctype html><title>' . $release . '</title>');
    file_put_contents($directory . '/project.zip', 'retained source ' . $release);
    touch($directory, 1_700_000_000 + $index);
}
$storage = $reflection->getProperty('storage_dir');
$storage->setValue($plugin, $temporary);
$prune_releases = $reflection->getMethod('prune_release_storage');
$prune_releases->invoke($plugin, 'release-03');
$retained_releases = glob($releases . '/*', GLOB_ONLYDIR) ?: [];
kodety_optimization_assert(count($retained_releases) === 2, 'apenas a release atual e a anterior devem ser mantidas');
kodety_optimization_assert(is_dir($releases . '/release-03'), 'a release ativa deve ser preservada mesmo quando não é a mais recente');
foreach ($retained_releases as $release_directory) {
    kodety_optimization_assert(is_file($release_directory . '/project/index.html'), 'o rollback deve preservar arquivos nativos inspecionáveis');
    kodety_optimization_assert(!is_file($release_directory . '/project.zip'), 'nenhum ZIP persistente deve permanecer na release nativa');
}

if (class_exists('ZipArchive')) {
    $incoming = $temporary . '/incoming.zip';
    $zip = new ZipArchive();
    kodety_optimization_assert($zip->open($incoming, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true, 'fixture ZIP deve ser criada');
    $workspace_index_html = '<!doctype html><link rel="stylesheet" href="styles.css"><main style="display: grid !important">Native workspace</main>' . $custom_body_block;
    $custom_code_metadata = '{"version":1,"projectId":"site-alpha-123","customCode":{"version":1,"entries":[{"id":"site-head","name":"Site head","code":"<script>window.__site=true;<\/script>","position":"head","scope":"site","enabled":true},{"id":"page-body","name":"Page body","code":"<style>.page{color:red}<\/style>","position":"body","scope":"page","pagePath":"index.html","enabled":false}]}}';
    $zip->addFromString('index.html', $workspace_index_html);
    $zip->addFromString('styles.css', 'main { color: rebeccapurple !important; }');
    $zip->addFromString('.incode/project.json', $custom_code_metadata);
    $zip->addFromString('__MACOSX/._index.html', 'finder metadata');
    $zip->addFromString('.DS_Store', 'finder metadata');
    $zip->addFromString('.htaccess', 'AddHandler application/x-httpd-php .jpg');
    $zip->addFromString('CNAME', 'www.example.test');
    $zip->addFromString('downloads/brief.docx', 'safe downloadable asset');
    $zip->close();
    $digest_method = $reflection->getMethod('css_digest_from_zip');
    $digest = $digest_method->invoke($plugin, $incoming);
    $activate_workspace = $reflection->getMethod('activate_workspace_from_zip');
    $workspace = $activate_workspace->invoke($plugin, $incoming, $digest);
    kodety_optimization_assert(is_file($workspace . '/index.html'), 'upload deve virar arquivos no workspace nativo');
    kodety_optimization_assert(str_contains(strtolower((string) file_get_contents($workspace . '/index.html')), '!important'), 'HTML importado deve preservar prioridades CSS autorais');
    kodety_optimization_assert(str_contains(strtolower((string) file_get_contents($workspace . '/styles.css')), '!important'), 'CSS e modo código devem permanecer byte a byte fiéis no workspace');
    kodety_optimization_assert(!is_dir($workspace . '/__MACOSX') && !is_file($workspace . '/.DS_Store'), 'metadados do Finder devem ser ignorados sem invalidar um ZIP legítimo');
    kodety_optimization_assert(!is_file($workspace . '/.htaccess'), 'configuração de servidor deve ser ignorada sem invalidar um site estático legítimo');
    kodety_optimization_assert(is_file($workspace . '/CNAME') && is_file($workspace . '/downloads/brief.docx'), 'arquivos estáticos e downloads seguros devem sobreviver à importação');
    kodety_optimization_assert(file_get_contents($workspace . '/.incode/project.json') === $custom_code_metadata, 'workspace deve preservar metadata de Custom Code byte a byte');
    kodety_optimization_assert(substr_count((string) file_get_contents($workspace . '/index.html'), 'kodety-custom-code:start site-body-script') === 1, 'workspace recebido deve manter Custom Code materializado uma única vez');
    $project_id_method = $reflection->getMethod('project_id_from_directory');
    kodety_optimization_assert($project_id_method->invoke($plugin, $workspace) === 'site-alpha-123', 'workspace deve preservar identidade estável do projeto');
    kodety_optimization_assert(!is_file($temporary . '/current.zip'), 'workspace não pode persistir como current.zip');
    $original_workspace_html = (string) file_get_contents($workspace . '/index.html');
    $rejected = false;
    try {
        $activate_workspace->invoke($plugin, $incoming, str_repeat('0', 64));
    } catch (Throwable) {
        $rejected = true;
    }
    kodety_optimization_assert($rejected, 'digest divergente deve bloquear a troca do workspace');
    kodety_optimization_assert(file_get_contents($workspace . '/index.html') === $original_workspace_html, 'falha de validação deve preservar o workspace anterior');

    $fallback_archive = $temporary . '/compatibility-fallback.zip';
    $fallback_zip = new ZipArchive();
    kodety_optimization_assert($fallback_zip->open($fallback_archive, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true, 'fixture ZIP de fallback deve ser criada');
    $fallback_zip->addFromString('index.html', '<!doctype html><p>fallback compatível</p>');
    $fallback_zip->addFromString('styles.css', 'body{display:grid}');
    $fallback_zip->addFromString('uploads/runner.php', '<?php echo "executed";');
    $fallback_zip->addFromString('.env', 'SECRET=never-publish');
    $fallback_zip->addFromString('.gitignore', 'node_modules');
    $fallback_zip->addFromString('design/source.psd', 'unsupported design source');
    $fallback_zip->close();
    $fallback_storage = $temporary . '/fallback-installation';
    $fallback_plugin = $reflection->newInstanceWithoutConstructor();
    $storage->setValue($fallback_plugin, $fallback_storage);
    $fallback_workspace = $activate_workspace->invoke($fallback_plugin, $fallback_archive);
    kodety_optimization_assert(
        is_file($fallback_workspace . '/index.html')
            && is_file($fallback_workspace . '/styles.css'),
        'arquivos incompatíveis não devem impedir a importação do restante do projeto'
    );
    kodety_optimization_assert(
        !is_file($fallback_workspace . '/uploads/runner.php')
            && !is_file($fallback_workspace . '/.env')
            && !is_file($fallback_workspace . '/.gitignore')
            && !is_file($fallback_workspace . '/design/source.psd'),
        'fallback deve ignorar arquivos incompatíveis sem armazenar ou executar seu conteúdo'
    );
    kodety_optimization_assert(
        file_get_contents($workspace . '/index.html') === $original_workspace_html,
        'importação isolada por fallback não deve alterar outro workspace válido'
    );

    // Finder and GitHub commonly wrap an exported project in one top-level
    // directory. Its private project metadata must remain valid there too.
    $wrapped = $temporary . '/wrapped.zip';
    $wrapped_zip = new ZipArchive();
    kodety_optimization_assert($wrapped_zip->open($wrapped, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true, 'fixture ZIP encapsulada deve ser criada');
    $wrapped_zip->addFromString('Project Export/index.html', '<!doctype html><title>Wrapped project</title>');
    $wrapped_zip->addFromString('Project Export/.incode/project.json', '{"version":1,"projectId":"wrapped-project"}');
    $variant_interaction_path = 'Project Export/.incode/animations/%2Eincode%2Fexperiments%2Fhome%2Fvariant-b%2Fproject%2Findex.html.json';
    $wrapped_zip->addFromString($variant_interaction_path, '{"version":2,"interactions":[]}');
    $wrapped_zip->close();
    $wrapped_destination = $temporary . '/wrapped-extraction';
    mkdir($wrapped_destination, 0777, true);
    $extract_safe_zip = $reflection->getMethod('extract_safe_zip');
    $extract_safe_zip->invoke($plugin, $wrapped, $wrapped_destination);
    kodety_optimization_assert(is_file($wrapped_destination . '/Project Export/.incode/project.json'), 'metadados .incode devem sobreviver em ZIP com diretório raiz');
    kodety_optimization_assert(
        is_file($wrapped_destination . '/' . $variant_interaction_path),
        'a interação privada de variante deve usar um nome codificado aceito pelo validador seguro'
    );

    $package_workspace = $reflection->getMethod('package_directory_as_zip');
    $export = $package_workspace->invoke($plugin, $workspace, 'kodety-test-export-');
    $export_zip = new ZipArchive();
    kodety_optimization_assert($export_zip->open($export) === true, 'download temporário deve ser um ZIP válido');
    kodety_optimization_assert($export_zip->getFromName('index.html') !== false, 'download deve transportar os arquivos nativos');
    kodety_optimization_assert($export_zip->getFromName('.incode/project.json') === $custom_code_metadata, 'ZIP descartável deve transportar metadata de Custom Code sem sanitização destrutiva');
    $export_zip->close();
    unlink($export);

    $public_copy = $temporary . '/public-copy';
    $copy_public_tree->invoke($plugin, $workspace, $public_copy);
    kodety_optimization_assert(!is_dir($public_copy . '/.incode'), 'tema público nunca deve expor `.incode/project.json`');
    kodety_optimization_assert(substr_count((string) file_get_contents($public_copy . '/index.html'), 'kodety-custom-code:start site-body-script') === 1, 'tema público deve receber somente o HTML já materializado, sem reinjetar Custom Code');

    $ab_digest_source = $temporary . '/ab-digest-source';
    $ab_digest_public = $temporary . '/ab-digest-public';
    mkdir($ab_digest_source . '/.incode/experiments/home/variant-b/project', 0777, true);
    file_put_contents($ab_digest_source . '/index.html', '<main>Control</main>');
    file_put_contents($ab_digest_source . '/styles.css', 'body{color:black}');
    file_put_contents(
        $ab_digest_source . '/.incode/experiments/home/variant-b/project/index.html',
        '<main>Variant B</main>'
    );
    file_put_contents(
        $ab_digest_source . '/.incode/experiments/home/variant-b/project/styles.css',
        'body{color:white}'
    );
    $directory_digest = $reflection->getMethod('css_digest_from_directory');
    $complete_ab_digest = $directory_digest->invoke($plugin, $ab_digest_source);
    $public_ab_digest = $directory_digest->invoke($plugin, $ab_digest_source, false);
    $copy_public_tree->invoke($plugin, $ab_digest_source, $ab_digest_public);
    $staged_ab_digest = $directory_digest->invoke($plugin, $ab_digest_public);
    kodety_optimization_assert(
        $complete_ab_digest !== $staged_ab_digest,
        'digest completo deve continuar cobrindo os clones privados de A/B Test'
    );
    kodety_optimization_assert(
        hash_equals($public_ab_digest, $staged_ab_digest),
        'build do tema deve comparar somente a árvore pública source↔staging'
    );

    $migration_root = $temporary . '/legacy-installation';
    mkdir($migration_root . '/releases/legacy-release', 0777, true);
    copy($incoming, $migration_root . '/current.zip');
    copy($incoming, $migration_root . '/releases/legacy-release/project.zip');
    $storage->setValue($plugin, $migration_root);
    $ensure_directories = $reflection->getMethod('ensure_directories');
    $ensure_directories->invoke($plugin);
    $migrate_workspace = $reflection->getMethod('migrate_native_workspace_storage');
    kodety_optimization_assert($migrate_workspace->invoke($plugin) === true, 'migração do armazenamento legado deve concluir');
    kodety_optimization_assert(is_file($migration_root . '/private/workspace/index.html'), 'current.zip legado deve virar workspace privado');
    kodety_optimization_assert(!is_file($migration_root . '/current.zip'), 'current.zip legado deve ser removido após migração');
    kodety_optimization_assert(is_file($migration_root . '/private/releases/legacy-release/project/index.html'), 'release ZIP deve virar snapshot nativo');
    kodety_optimization_assert(!is_file($migration_root . '/private/releases/legacy-release/project.zip'), 'release legada não pode conservar o ZIP');
}

foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($temporary, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $entry) {
    $entry->isDir() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
}
rmdir($temporary);

fwrite(STDOUT, "Optimization runtime: publicação lossless e URLs públicas aprovadas.\n");
