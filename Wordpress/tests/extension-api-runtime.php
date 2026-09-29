<?php

/** Isolated regression test for the public Kodety Extension API v1. */
define('ABSPATH', __DIR__ . '/');
define('KODETY_VERSION', '1.40.0');

$kodety_extension_api_root = sys_get_temp_dir() . '/kodety-extension-api-' . bin2hex(random_bytes(5));
$kodety_extension_api_uploads = $kodety_extension_api_root . '/uploads';
define('WP_CONTENT_DIR', $kodety_extension_api_root . '/wp-content');
mkdir($kodety_extension_api_uploads, 0777, true);
$kodety_extension_api_log = $kodety_extension_api_root . '/errors.log';
ini_set('log_errors', '1');
ini_set('error_log', $kodety_extension_api_log);

$kodety_extension_api_options = [];
$kodety_extension_api_actions = [];
$kodety_extension_api_filters = [];
$kodety_extension_api_shortcodes = [];
$kodety_extension_api_routes = [];
$kodety_extension_api_admin_pages = [];
$kodety_extension_api_assertions = 0;

class WP_Error {
    public function __construct(
        private string $code,
        private string $message,
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

class WP_REST_Response {
    public function __construct(public mixed $data = null, public int $status = 200) {}
}

function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }

function add_action(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): bool {
    global $kodety_extension_api_actions;
    $kodety_extension_api_actions[$hook][] = compact('callback', 'priority', 'accepted_args');
    return true;
}

function do_action(string $hook, mixed ...$arguments): void {
    global $kodety_extension_api_actions;
    $callbacks = $kodety_extension_api_actions[$hook] ?? [];
    usort($callbacks, static fn(array $a, array $b): int => $a['priority'] <=> $b['priority']);
    foreach ($callbacks as $item) {
        ($item['callback'])(...array_slice($arguments, 0, (int) $item['accepted_args']));
    }
}

function add_filter(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): bool {
    global $kodety_extension_api_filters;
    $kodety_extension_api_filters[$hook][] = compact('callback', 'priority', 'accepted_args');
    return true;
}

function apply_filters(string $hook, mixed $value, mixed ...$arguments): mixed {
    global $kodety_extension_api_filters;
    $callbacks = $kodety_extension_api_filters[$hook] ?? [];
    usort($callbacks, static fn(array $a, array $b): int => $a['priority'] <=> $b['priority']);
    foreach ($callbacks as $item) {
        $accepted = max(1, (int) $item['accepted_args']);
        $value = ($item['callback'])(...array_slice([$value, ...$arguments], 0, $accepted));
    }
    return $value;
}

function add_shortcode(string $tag, callable $callback): void {
    global $kodety_extension_api_shortcodes;
    $kodety_extension_api_shortcodes[$tag] = $callback;
}

function register_rest_route(
    string $namespace,
    string $route,
    array $arguments,
    bool $override = false
): bool {
    global $kodety_extension_api_routes;
    $kodety_extension_api_routes[$namespace . $route] = $arguments;
    return true;
}

function add_menu_page(
    string $page_title,
    string $menu_title,
    string $capability,
    string $menu_slug,
    callable $callback,
    string $icon_url = '',
    mixed $position = null
): string {
    global $kodety_extension_api_admin_pages;
    $kodety_extension_api_admin_pages[$menu_slug] = $callback;
    return 'toplevel_page_' . $menu_slug;
}

function add_submenu_page(
    string $parent_slug,
    string $page_title,
    string $menu_title,
    string $capability,
    string $menu_slug,
    callable $callback
): string {
    global $kodety_extension_api_admin_pages;
    $kodety_extension_api_admin_pages[$menu_slug] = $callback;
    return $parent_slug . '_page_' . $menu_slug;
}

function get_option(string $name, mixed $default = false): mixed {
    global $kodety_extension_api_options;
    return array_key_exists($name, $kodety_extension_api_options)
        ? $kodety_extension_api_options[$name]
        : $default;
}

function update_option(string $name, mixed $value, bool $autoload = true): bool {
    global $kodety_extension_api_options;
    if (($kodety_extension_api_options[$name] ?? null) === $value) return false;
    $kodety_extension_api_options[$name] = $value;
    return true;
}

function wp_upload_dir(): array {
    global $kodety_extension_api_uploads;
    return ['basedir' => $kodety_extension_api_uploads, 'baseurl' => 'https://example.test/uploads'];
}

function wp_mkdir_p(string $directory): bool { return is_dir($directory) || mkdir($directory, 0777, true); }
function trailingslashit(string $value): string { return rtrim($value, '/\\') . '/'; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_key(string $value): string { return strtolower(preg_replace('/[^a-z0-9_-]/', '', $value) ?: ''); }
function esc_url_raw(string $url): string { return filter_var($url, FILTER_VALIDATE_URL) ? $url : ''; }
function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_html__(string $value, string $domain = 'default'): string { return esc_html($value); }
function wp_die(mixed $message = '', mixed $title = '', mixed $arguments = []): void {
    throw new RuntimeException((string) $message);
}
function did_action(string $hook): int { return 0; }
function current_user_can(string $capability, mixed ...$arguments): bool { return $capability === 'manage_options'; }
function is_user_logged_in(): bool { return true; }
function __return_null(): mixed { return null; }
function __return_true(): bool { return true; }

function kodety_extension_api_assert(bool $condition, string $message): void {
    global $kodety_extension_api_assertions;
    $kodety_extension_api_assertions += 1;
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_extension_api_throws(string $class, callable $callback, string $message): void {
    try {
        $callback();
    } catch (Throwable $error) {
        kodety_extension_api_assert($error instanceof $class, $message . ' (recebido ' . get_class($error) . ')');
        return;
    }
    kodety_extension_api_assert(false, $message . ' (nenhuma exceção)');
}

function kodety_extension_api_remove_tree(string $directory): void {
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isFile() || $item->isLink()) unlink($item->getPathname());
        elseif ($item->isDir()) rmdir($item->getPathname());
    }
    rmdir($directory);
}

register_shutdown_function(static fn(): mixed => kodety_extension_api_remove_tree($GLOBALS['kodety_extension_api_root']));

require dirname(__DIR__) . '/kodety/includes/class-kodety-extension-api.php';
require dirname(__DIR__) . '/kodety/includes/class-kodety-extensions.php';

$permissions = [
    'hooks.listen', 'hooks.emit', 'events.listen', 'events.emit',
    'storage.read', 'storage.write', 'routes.register', 'admin.register',
    'auth.read', 'blocks.register', 'frontend.register',
];
$manifest = static fn(string $slug, array $overrides = []): array => array_merge([
    'schemaVersion' => 1,
    'type' => 'extension',
    'slug' => $slug,
    'name' => ucfirst($slug),
    'description' => 'Fixture da API pública de extensões.',
    'version' => '1.0.0',
    'entry' => 'extension.php',
    'requires' => ['php' => '8.0', 'kodety' => '1.0.0', 'extensionApi' => '1.0.0'],
    'permissions' => $permissions,
    'capabilities' => ['manage_options'],
], $overrides);

$alpha_root = $kodety_extension_api_root . '/alpha-extension';
$beta_root = $kodety_extension_api_root . '/beta-extension';
mkdir($alpha_root, 0777, true);
mkdir($beta_root, 0777, true);
file_put_contents($alpha_root . '/extension.php', "<?php\n");
file_put_contents($beta_root . '/extension.php', "<?php\n");

$api = Kodety_Extension_API::instance();
$alpha = $api->enter('alpha-extension', $manifest('alpha-extension'), $alpha_root);
kodety_extension_api_assert(kodety_extension() === $alpha, 'helper deve expor somente o contexto em carregamento');
$api->leave('alpha-extension');
kodety_extension_api_assert(kodety_extension() === null, 'contexto deve desaparecer ao fim do entrypoint');

$beta = $api->enter('beta-extension', $manifest('beta-extension'), $beta_root);
$api->leave('beta-extension');

kodety_extension_api_assert($alpha->storage()->set('message', 'alpha'), 'alpha deve gravar no storage próprio');
kodety_extension_api_assert($beta->storage()->set('message', 'beta'), 'beta deve gravar no storage próprio');
kodety_extension_api_assert($alpha->storage()->get('message') === 'alpha', 'alpha não pode ler o valor de beta');
kodety_extension_api_assert($beta->storage()->get('message') === 'beta', 'beta não pode ler o valor de alpha');
kodety_extension_api_assert(
    isset(
        $kodety_extension_api_options['kodety_extension_storage_v1_alpha-extension'],
        $kodety_extension_api_options['kodety_extension_storage_v1_beta-extension']
    ),
    'cada extensão deve persistir em option namespaced separada'
);

$alpha_events = 0;
$beta_events = 0;
$current_inside_callback = '';
$alpha->events()->listen('saved', static function () use (&$alpha_events, &$current_inside_callback): void {
    $alpha_events += 1;
    $current_inside_callback = kodety_extension()?->slug() ?? '';
});
$beta->events()->listen('saved', static function () use (&$beta_events): void { $beta_events += 1; });
$alpha->events()->dispatch('saved', ['id' => 1]);
kodety_extension_api_assert($alpha_events === 1 && $beta_events === 0, 'eventos iguais devem ficar isolados por slug');
kodety_extension_api_assert($current_inside_callback === 'alpha-extension', 'callbacks públicos devem restaurar o contexto correto');

$block = $alpha->blocks()->register('hero', ['title' => 'Hero']);
kodety_extension_api_assert($block === 'alpha-extension/hero', 'block type deve receber nome canônico da extensão');
kodety_extension_api_assert(isset(kodety_extension_block_types()[$block]), 'registry público deve expor block type registrado');

$runtime_callback_contexts = [];
$context_hook = $alpha->frontend()->register_runtime_context_resolver(
    static function (array $runtime, Kodety_Extension_Context $context) use (&$runtime_callback_contexts): array {
        $runtime_callback_contexts[] = kodety_extension()?->slug();
        $runtime['owner'] = $context->slug();
        return $runtime;
    },
    20,
    1
);
$html_hook = $alpha->frontend()->register_runtime_html_transformer(
    static function (
        string $html,
        array $runtime,
        Kodety_Extension_Context $context
    ) use (&$runtime_callback_contexts): string {
        $runtime_callback_contexts[] = kodety_extension()?->slug();
        return $html . '<!--' . $context->slug() . ':' . ($runtime['route'] ?? '') . '-->';
    },
    30,
    2
);
$runtime = apply_filters('kodety_runtime_context', ['release' => 'fixture']);
$runtime_html = apply_filters('kodety_runtime_html', '<main></main>', ['route' => 'case']);
kodety_extension_api_assert(
    $context_hook === 'kodety_runtime_context' && ($runtime['owner'] ?? '') === 'alpha-extension',
    'resolver público deve registrar e retornar contexto runtime válido'
);
kodety_extension_api_assert(
    $html_hook === 'kodety_runtime_html'
        && $runtime_html === '<main></main><!--alpha-extension:case-->',
    'transformer público deve receber HTML e runtime context'
);
kodety_extension_api_assert(
    $runtime_callback_contexts === ['alpha-extension', 'alpha-extension']
        && kodety_extension() === null,
    'callbacks do runtime devem executar somente dentro do contexto da extensão'
);
$beta->frontend()->register_runtime_html_transformer(
    static fn(string $html, Kodety_Extension_Context $context): string =>
        $html . '<!--one:' . $context->slug() . '-->',
    40,
    1
);
kodety_extension_api_assert(
    apply_filters('kodety_runtime_html', '<main></main>', [])
        === '<main></main><!--alpha-extension:--><!--one:beta-extension-->',
    'accepted_args=1 deve entregar HTML seguido do contexto da extensão'
);
kodety_extension_api_throws(
    InvalidArgumentException::class,
    static fn(): string => $alpha->frontend()->register_runtime_context_resolver(
        static fn(array $runtime): array => $runtime,
        10001,
        1
    ),
    'prioridade runtime fora do limite deve ser rejeitada'
);
kodety_extension_api_throws(
    InvalidArgumentException::class,
    static fn(): string => $alpha->frontend()->register_runtime_context_resolver(
        static fn(array $runtime): array => $runtime,
        10,
        2
    ),
    'resolver deve rejeitar accepted_args maior que sua assinatura runtime'
);
kodety_extension_api_throws(
    InvalidArgumentException::class,
    static fn(): string => $alpha->frontend()->register_runtime_html_transformer(
        static fn(string $html): string => $html,
        10,
        3
    ),
    'accepted_args maior que a assinatura runtime deve ser rejeitado'
);

$action_continued = 0;
$alpha->hooks()->on('failure/action', static function (): void {
    throw new RuntimeException("hook action secret\nforged line");
}, 10, 0);
$alpha->hooks()->on('failure/action', static function () use (&$action_continued): void {
    $action_continued += 1;
}, 20, 0);
$alpha->hooks()->emit('failure/action');
kodety_extension_api_assert(
    $action_continued === 1,
    'falha em action registrada pela API deve ser isolada e permitir callbacks posteriores'
);

$raw_action_survived = false;
add_action(
    $alpha->hooks()->hook_name('failure/raw-action'),
    static function (): void { throw new RuntimeException('raw action secret'); },
    10,
    0
);
$alpha->hooks()->emit('failure/raw-action');
$raw_action_survived = true;
kodety_extension_api_assert($raw_action_survived, 'emit deve conter Throwable lançado pelo dispatcher WordPress');

$alpha->hooks()->filter(
    'failure/filter',
    static function (string $value): string { throw new RuntimeException('filter secret'); },
    10,
    1
);
$alpha->hooks()->filter(
    'failure/filter',
    static fn(string $value): string => $value . '-continued',
    20,
    1
);
kodety_extension_api_assert(
    $alpha->hooks()->apply('failure/filter', 'original') === 'original-continued',
    'falha em filter deve preservar o valor recebido para o próximo callback'
);

add_filter(
    $alpha->hooks()->hook_name('failure/raw-filter'),
    static function (string $value): string { throw new RuntimeException('raw filter secret'); },
    10,
    1
);
kodety_extension_api_assert(
    $alpha->hooks()->apply('failure/raw-filter', 'original') === 'original',
    'apply deve conter Throwable externo e devolver o valor original'
);

$event_continued = 0;
$alpha->events()->listen('failure.listener', static function (): void {
    throw new RuntimeException('event listener secret');
}, 10);
$alpha->events()->listen('failure.listener', static function () use (&$event_continued): void {
    $event_continued += 1;
}, 20);
$alpha->events()->dispatch('failure.listener', ['id' => 1]);
kodety_extension_api_assert(
    $event_continued === 1,
    'falha em event listener deve ser isolada e permitir listeners posteriores'
);

$raw_event_survived = false;
add_action(
    $alpha->events()->event_name('failure.raw-dispatch'),
    static function (): void { throw new RuntimeException('raw event secret'); },
    10,
    1
);
$alpha->events()->dispatch('failure.raw-dispatch', ['id' => 2]);
$raw_event_survived = true;
kodety_extension_api_assert($raw_event_survived, 'dispatch deve conter Throwable lançado pelo dispatcher WordPress');

$admin_page = $alpha->admin()->register_page('failure', [
    'title' => 'Failure fixture',
    'menu_title' => 'Failure fixture',
    'capability' => 'manage_options',
    'parent' => null,
    'callback' => static function (): void {
        echo '<p>partial admin secret</p>';
        throw new RuntimeException('admin exception secret');
    },
]);
do_action('admin_menu');
ob_start();
($kodety_extension_api_admin_pages[$admin_page])();
$admin_failure_html = (string) ob_get_clean();
kodety_extension_api_assert(
    str_contains($admin_failure_html, 'alpha-extension')
        && str_contains($admin_failure_html, 'Consulte os logs'),
    'admin deve substituir callback quebrado por notice segura e identificável'
);
kodety_extension_api_assert(
    !str_contains($admin_failure_html, 'partial admin secret')
        && !str_contains($admin_failure_html, 'admin exception secret'),
    'admin deve descartar output parcial e não expor a exception'
);

$expected_callback_error = new WP_Error('alpha_expected', 'Erro esperado.', ['status' => 422]);
$expected_permission_error = new WP_Error('alpha_forbidden', 'Negado.', ['status' => 403]);
$expected_rest_response = new WP_REST_Response(['ok' => true], 201);
$expected_error_route = $alpha->routes()->register('expected-error', [
    'permission' => 'public',
    'callback' => static fn(): WP_Error => $expected_callback_error,
]);
$expected_permission_route = $alpha->routes()->register('expected-permission-error', [
    'permission' => static fn(): WP_Error => $expected_permission_error,
    'callback' => '__return_null',
]);
$expected_response_route = $alpha->routes()->register('expected-response', [
    'permission' => 'public',
    'callback' => static fn(): WP_REST_Response => $expected_rest_response,
]);
$throwing_callback_route = $alpha->routes()->register('throwing-callback', [
    'permission' => 'public',
    'callback' => static function (): void { throw new RuntimeException('route callback secret'); },
]);
$throwing_permission_route = $alpha->routes()->register('throwing-permission', [
    'permission' => static function (): void { throw new RuntimeException('route permission secret'); },
    'callback' => '__return_null',
]);
do_action('rest_api_init');
$request = new stdClass();
$expected_callback_result = ($kodety_extension_api_routes[$expected_error_route]['callback'])($request);
$expected_permission_result =
    ($kodety_extension_api_routes[$expected_permission_route]['permission_callback'])($request);
$expected_response_result = ($kodety_extension_api_routes[$expected_response_route]['callback'])($request);
kodety_extension_api_assert(
    $expected_callback_result === $expected_callback_error,
    'callback REST deve preservar WP_Error intencional sem reescrever status ou mensagem'
);
kodety_extension_api_assert(
    $expected_permission_result === $expected_permission_error,
    'permission callable deve preservar WP_Error intencional'
);
kodety_extension_api_assert(
    $expected_response_result === $expected_rest_response,
    'callback REST deve preservar WP_REST_Response normal'
);

$callback_failure = ($kodety_extension_api_routes[$throwing_callback_route]['callback'])($request);
$permission_failure =
    ($kodety_extension_api_routes[$throwing_permission_route]['permission_callback'])($request);
foreach ([$callback_failure, $permission_failure] as $rest_failure) {
    kodety_extension_api_assert(
        is_wp_error($rest_failure)
            && $rest_failure->get_error_code() === 'kodety_extension_callback_failed'
            && $rest_failure->get_error_data() === ['status' => 500],
        'Throwable REST inesperado deve virar WP_Error 500 genérico'
    );
    kodety_extension_api_assert(
        !str_contains($rest_failure->get_error_message(), 'secret'),
        'resposta REST genérica não deve expor detalhes da exception'
    );
}

$shortcode = $alpha->frontend()->shortcode('failure', static function (): void {
    throw new RuntimeException('shortcode secret');
});
kodety_extension_api_assert(
    ($kodety_extension_api_shortcodes[$shortcode])([], null) === '',
    'shortcode quebrado deve renderizar fallback vazio'
);

$broken_block = $alpha->blocks()->register('broken-render', [
    'title' => 'Broken render fixture',
    'render' => static function (): void { throw new RuntimeException('block secret'); },
]);
$broken_block_renderer = kodety_extension_block_types()[$broken_block]['render'];
kodety_extension_api_assert(
    $broken_block_renderer([], '') === '',
    'block render quebrado deve renderizar fallback vazio'
);

clearstatcache(true, $kodety_extension_api_log);
$callback_log = is_file($kodety_extension_api_log)
    ? (string) file_get_contents($kodety_extension_api_log)
    : '';
foreach ([
    'hook.action', 'hook.emit', 'hook.filter', 'hook.apply',
    'event.listener', 'event.dispatch', 'admin.render',
    'route.callback', 'route.permission', 'shortcode.render', 'block.render',
] as $surface) {
    kodety_extension_api_assert(
        str_contains($callback_log, '[Kodety][Extension API][alpha-extension][' . $surface . ']'),
        'log deve identificar slug e surface ' . $surface
    );
}
kodety_extension_api_assert(
    str_contains($callback_log, 'hook action secret\\nforged line'),
    'mensagem multiline deve ser normalizada para uma única linha de log'
);

$limited_manifest = $manifest('limited-extension', [
    'permissions' => ['storage.write', 'auth.read', 'admin.register', 'routes.register'],
    'capabilities' => [],
]);
$limited_root = $kodety_extension_api_root . '/limited-extension';
mkdir($limited_root, 0777, true);
file_put_contents($limited_root . '/extension.php', "<?php\n");
$limited = $api->enter('limited-extension', $limited_manifest, $limited_root);
$api->leave('limited-extension');

kodety_extension_api_throws(
    Kodety_Extension_Permission_Exception::class,
    static fn(): mixed => $limited->storage()->get('secret'),
    'leitura sem storage.read deve falhar antes de acessar dados'
);
kodety_extension_api_throws(
    Kodety_Extension_Permission_Exception::class,
    static fn(): string => $limited->frontend()->register_runtime_html_transformer(
        static fn(string $html): string => $html
    ),
    'transformer runtime sem frontend.register deve ser rejeitado'
);
kodety_extension_api_throws(
    Kodety_Extension_Capability_Exception::class,
    static fn(): mixed => $limited->auth()->can('manage_options'),
    'auth não pode consultar capability não declarada'
);
kodety_extension_api_throws(
    Kodety_Extension_Capability_Exception::class,
    static fn(): mixed => $limited->admin()->register_page('settings', [
        'title' => 'Settings',
        'menu_title' => 'Settings',
        'capability' => 'manage_options',
        'callback' => '__return_null',
    ]),
    'admin page não pode usar capability não declarada'
);
kodety_extension_api_throws(
    Kodety_Extension_Capability_Exception::class,
    static fn(): mixed => $limited->routes()->register('items', [
        'callback' => '__return_null',
        'permission' => ['capability' => 'manage_options'],
    ]),
    'rota não pode usar capability não declarada'
);

$manager = Kodety_Extensions::instance();
$normalize = new ReflectionMethod($manager, 'normalize_extension_manifest');
$normalize->setAccessible(true);
$valid = $normalize->invoke($manager, $manifest('manifest-extension'), $alpha_root);
kodety_extension_api_assert(is_array($valid), 'manifesto com Extension API v1 e permissões conhecidas deve ser aceito');
kodety_extension_api_assert(
    ($valid['requires']['extensionApi'] ?? '') === '1.0.0'
        && in_array('storage.read', $valid['permissions'] ?? [], true),
    'normalização deve preservar requisito e permissões públicas'
);

$future = $manifest('future-extension', [
    'requires' => ['php' => '8.0', 'kodety' => '1.0.0', 'extensionApi' => '2.0.0'],
]);
$future_result = $normalize->invoke($manager, $future, $alpha_root);
kodety_extension_api_assert(
    is_wp_error($future_result) && $future_result->get_error_code() === 'kodety_extension_api_version',
    'manifesto que exige API futura deve ser incompatível'
);

$unknown = $manifest('unknown-extension', ['permissions' => ['storage.read', 'core.everything']]);
$unknown_result = $normalize->invoke($manager, $unknown, $alpha_root);
kodety_extension_api_assert(
    is_wp_error($unknown_result) && $unknown_result->get_error_code() === 'kodety_extension_permission_unknown',
    'permissão desconhecida deve ser rejeitada na instalação'
);

$hello_root = dirname(__DIR__) . '/kodety/docs/extensions/examples/hello-kodety';
$hello_manifest = json_decode((string) file_get_contents($hello_root . '/kodety-extension.json'), true);
$hello_result = $normalize->invoke($manager, $hello_manifest, $hello_root);
kodety_extension_api_assert(is_array($hello_result), 'Hello Kodety deve ser um pacote instalável e compatível');

$loaded_manifest = $manifest('loaded-extension');
$loaded_root = $manager->storage_dir() . '/loaded-extension';
mkdir($loaded_root, 0777, true);
file_put_contents(
    $loaded_root . '/extension.php',
    "<?php\n\$GLOBALS['kodety_test_loaded_context'] = kodety_extension()?->slug();\n"
);
$kodety_extension_api_options['kodety_extensions_registry'] = [
    'version' => 1,
    'extensions' => [
        'loaded-extension' => [
            'manifest' => $loaded_manifest,
            'active' => true,
            'bundled' => false,
        ],
    ],
];
$load_external = new ReflectionMethod($manager, 'load_external');
$load_external->setAccessible(true);
$load_result = $load_external->invoke($manager, 'loaded-extension');
kodety_extension_api_assert($load_result === true, 'manager deve carregar entrypoint compatível');
kodety_extension_api_assert(
    ($GLOBALS['kodety_test_loaded_context'] ?? '') === 'loaded-extension',
    'integração do manager deve abrir o contexto público durante o entrypoint'
);
kodety_extension_api_assert(kodety_extension() === null, 'manager deve fechar contexto mesmo após load bem-sucedido');

$failing_manifest = $manifest('failing-extension');
$failing_root = $manager->storage_dir() . '/failing-extension';
mkdir($failing_root, 0777, true);
file_put_contents($failing_root . '/extension.php', "<?php\nthrow new RuntimeException('fixture failure');\n");
$kodety_extension_api_options['kodety_extensions_registry']['extensions']['failing-extension'] = [
    'manifest' => $failing_manifest,
    'active' => true,
    'bundled' => false,
];
$failing_result = $load_external->invoke($manager, 'failing-extension');
kodety_extension_api_assert(
    is_wp_error($failing_result) && $failing_result->get_error_code() === 'kodety_extension_load_failed',
    'exceção do entrypoint deve virar erro de carregamento'
);
kodety_extension_api_assert(kodety_extension() === null, 'manager deve fechar contexto após entrypoint com falha');

echo "Kodety Extension API runtime: {$kodety_extension_api_assertions} assertions passed.\n";
