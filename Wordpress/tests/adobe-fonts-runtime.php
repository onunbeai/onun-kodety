<?php

/**
 * Isolated runtime contracts for the Adobe Fonts Web Project integration.
 *
 * Run with: php Wordpress/tests/adobe-fonts-runtime.php
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
define('KODETY_VERSION', 'test');

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message = '',
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Request {
    public function __construct(
        private array $params = [],
        private array $headers = [],
        private array $json = []
    ) {
        $this->headers = array_change_key_case($headers, CASE_LOWER);
    }
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
    public function get_header(string $name): string { return (string) ($this->headers[strtolower($name)] ?? ''); }
    public function get_json_params(): array { return $this->json; }
}

final class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null) {}
    public function get_data(): mixed { return $this->data; }
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_headers(): array { return $this->headers; }
}

final class WP_REST_Server {
    public const READABLE = 'GET';
    public const CREATABLE = 'POST';
    public const DELETABLE = 'DELETE';
}

$kodety_adobe_fonts_actions = [];
$kodety_adobe_fonts_routes = [];
$kodety_adobe_fonts_options = [];
$kodety_adobe_fonts_autoload = [];
$kodety_adobe_fonts_requests = [];
$kodety_adobe_fonts_styles = [];
$kodety_adobe_fonts_remote = [
    'response' => ['code' => 200],
    'body' => '{}',
];

function add_action(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): void {
    global $kodety_adobe_fonts_actions;
    $kodety_adobe_fonts_actions[] = compact('hook', 'callback', 'priority', 'accepted_args');
}
function register_rest_route(string $namespace, string $route, array $args, bool $override = false): bool {
    global $kodety_adobe_fonts_routes;
    $kodety_adobe_fonts_routes[$namespace . $route] = $args;
    return true;
}
function is_user_logged_in(): bool { return true; }
function current_user_can(string $capability): bool {
    return in_array($capability, ['manage_options', 'kodety_edit'], true);
}
function wp_verify_nonce(string $nonce, string $action): bool {
    return $nonce === 'valid-rest-nonce' && $action === 'wp_rest';
}
function get_option(string $name, mixed $default = false): mixed {
    global $kodety_adobe_fonts_options;
    return array_key_exists($name, $kodety_adobe_fonts_options)
        ? $kodety_adobe_fonts_options[$name]
        : $default;
}
function update_option(string $name, mixed $value, mixed $autoload = null): bool {
    global $kodety_adobe_fonts_options, $kodety_adobe_fonts_autoload;
    $kodety_adobe_fonts_options[$name] = $value;
    $kodety_adobe_fonts_autoload[$name] = $autoload;
    return true;
}
function delete_option(string $name): bool {
    global $kodety_adobe_fonts_options, $kodety_adobe_fonts_autoload;
    $present = array_key_exists($name, $kodety_adobe_fonts_options);
    unset($kodety_adobe_fonts_options[$name], $kodety_adobe_fonts_autoload[$name]);
    return $present;
}
function sanitize_text_field(string $value): string {
    return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? ''));
}
function wp_strip_all_tags(string $value): string { return strip_tags($value); }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function wp_safe_remote_get(string $url, array $args = []): array|WP_Error {
    global $kodety_adobe_fonts_requests, $kodety_adobe_fonts_remote;
    $kodety_adobe_fonts_requests[] = compact('url', 'args');
    return $kodety_adobe_fonts_remote;
}
function wp_remote_retrieve_response_code(array $response): int {
    return (int) ($response['response']['code'] ?? 0);
}
function wp_remote_retrieve_body(array $response): string { return (string) ($response['body'] ?? ''); }
function wp_enqueue_style(
    string $handle,
    string $src = '',
    array $deps = [],
    string|bool|null $ver = false,
    string $media = 'all'
): void {
    global $kodety_adobe_fonts_styles;
    $kodety_adobe_fonts_styles[] = compact('handle', 'src', 'deps', 'ver', 'media');
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-adobe-fonts.php';

function kodety_adobe_fonts_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_adobe_fonts_invoke(object|string $target, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($target, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke(is_object($target) ? $target : null, ...$arguments);
}

kodety_adobe_fonts_assert(class_exists(Kodety_Adobe_Fonts::class), 'a classe Adobe Fonts deve carregar isoladamente');
kodety_adobe_fonts_assert(
    Kodety_Adobe_Fonts::reseller_licensed() === true,
    'a integração deve ser administrada nativamente pelo plugin'
);

$adobe_fonts = Kodety_Adobe_Fonts::instance();
$registered_hooks = array_column($kodety_adobe_fonts_actions, 'hook');
kodety_adobe_fonts_assert(
    in_array('rest_api_init', $registered_hooks, true)
        && in_array('wp_enqueue_scripts', $registered_hooks, true),
    'a classe deve registrar rotas e o stylesheet público'
);
$adobe_fonts->register_rest_routes();
kodety_adobe_fonts_assert(
    isset(
        $kodety_adobe_fonts_routes['kodety/v1/fonts/adobe'],
        $kodety_adobe_fonts_routes['kodety/v1/fonts/adobe/resync'],
        $kodety_adobe_fonts_routes['kodety/v1/fonts/adobe/settings']
    ),
    'catálogo, ressincronização e settings devem estar registrados'
);

kodety_adobe_fonts_assert(
    Kodety_Adobe_Fonts::sanitize_project_id('AbC1234') === 'abc1234'
        && Kodety_Adobe_Fonts::sanitize_project_id('https://use.typekit.net/ABC1234.css') === 'abc1234'
        && Kodety_Adobe_Fonts::sanitize_project_id('https://evil.example/abc1234.css') === ''
        && Kodety_Adobe_Fonts::sanitize_project_id('https://use.typekit.net/abc1234.css?x=1') === ''
        && Kodety_Adobe_Fonts::sanitize_project_id('../abc1234') === ''
        && Kodety_Adobe_Fonts::stylesheet_url('abc1234') === 'https://use.typekit.net/abc1234.css',
    'IDs e stylesheet devem ficar presos ao host e formato oficiais da Adobe'
);

$fixture = [
    'kit' => [
        'id' => 'abc1234',
        'published' => '2026-08-30T10:00:00Z',
        'families' => [[
            'id' => 'acmesans',
            'name' => 'Acme Sans',
            'slug' => 'acme-sans-slug',
            'css_names' => ['acme-sans', 'acme-sans-alt'],
            'variations' => ['n4', 'i4', 'n7', 'i7'],
            'subset' => 'default',
        ]],
    ],
];
$parsed = kodety_adobe_fonts_invoke(
    $adobe_fonts,
    'parse_published_payload',
    $fixture,
    'abc1234',
    '2026-08-30T12:00:00Z'
);
$font = is_array($parsed) ? ($parsed['fonts'][0] ?? null) : null;
kodety_adobe_fonts_assert(
    is_array($font)
        && ($font['id'] ?? '') === 'adobe-acmesans'
        && ($font['family'] ?? '') === 'acme-sans'
        && ($font['name'] ?? '') === 'Acme Sans'
        && ($font['displayName'] ?? '') === 'Acme Sans'
        && ($font['aliases'] ?? []) === ['acme-sans', 'acme-sans-alt', 'acme-sans-slug', 'Acme Sans']
        && ($font['cssNames'] ?? []) === ['acme-sans', 'acme-sans-alt']
        && ($font['css_names'] ?? []) === ['acme-sans', 'acme-sans-alt']
        && ($font['cssStack'] ?? '') === '"acme-sans","acme-sans-alt",sans-serif'
        && ($font['css_stack'] ?? '') === '"acme-sans","acme-sans-alt",sans-serif'
        && ($font['variations'] ?? []) === ['n4', 'i4', 'n7', 'i7']
        && ($font['variants'] ?? []) === ['regular', 'italic', '700', '700italic']
        && ($font['weights'] ?? []) === ['400', '700'],
    'parser deve preservar o contrato Adobe e usar css_names[0] como família CSS real'
);
$mismatch = kodety_adobe_fonts_invoke(
    $adobe_fonts,
    'parse_published_payload',
    $fixture,
    'different',
    '2026-08-30T12:00:00Z'
);
kodety_adobe_fonts_assert(
    $mismatch instanceof WP_Error && $mismatch->get_error_code() === 'kodety_adobe_fonts_project_mismatch',
    'o parser deve rejeitar resposta de um Web Project diferente'
);

$kodety_adobe_fonts_remote = [
    'response' => ['code' => 200],
    'body' => json_encode($fixture, JSON_THROW_ON_ERROR),
];
$saved = $adobe_fonts->rest_save_settings(new WP_REST_Request([], [], ['projectId' => 'abc1234']));
$saved_data = $saved instanceof WP_REST_Response ? $saved->get_data() : null;
$request = $kodety_adobe_fonts_requests[0] ?? null;
kodety_adobe_fonts_assert(
    $saved instanceof WP_REST_Response
        && is_array($saved_data)
        && ($saved_data['configured'] ?? false) === true
        && ($saved_data['projectId'] ?? '') === 'abc1234'
        && ($saved_data['stylesheetUrl'] ?? '') === 'https://use.typekit.net/abc1234.css'
        && ($saved_data['familyCount'] ?? 0) === 1
        && !array_key_exists('data', $saved_data)
        && is_array($request)
        && ($request['url'] ?? '') === 'https://typekit.com/api/v1/json/kits/abc1234/published'
        && ($request['args']['redirection'] ?? null) === 0
        && ($request['args']['reject_unsafe_urls'] ?? null) === true
        && ($request['args']['limit_response_size'] ?? null) === 2097152
        && !isset($request['args']['headers']['X-Typekit-Token'])
        && ($kodety_adobe_fonts_autoload['kodety_adobe_fonts_settings'] ?? null) === false,
    'save deve consultar somente o kit publicado, sem token, e persistir o catálogo sem autoload'
);

$adobe_fonts->enqueue_stylesheet();
$style = $kodety_adobe_fonts_styles[0] ?? null;
kodety_adobe_fonts_assert(
    is_array($style)
        && ($style['handle'] ?? '') === 'kodety-adobe-fonts'
        && ($style['src'] ?? '') === 'https://use.typekit.net/abc1234.css'
        && array_key_exists('ver', $style)
        && $style['ver'] === null,
    'site publicado deve carregar diretamente o stylesheet oficial da Adobe'
);

$last_good_fonts = $kodety_adobe_fonts_options['kodety_adobe_fonts_settings']['fonts'] ?? [];
$kodety_adobe_fonts_remote = new WP_Error('http_request_failed', 'Adobe indisponível');
$failed_sync = $adobe_fonts->rest_resync(new WP_REST_Request());
kodety_adobe_fonts_assert(
    $failed_sync instanceof WP_Error
        && ($kodety_adobe_fonts_options['kodety_adobe_fonts_settings']['fonts'] ?? []) === $last_good_fonts
        && ($kodety_adobe_fonts_options['kodety_adobe_fonts_settings']['last_error'] ?? '') !== '',
    'falha de ressincronização deve preservar o último catálogo válido e registrar o erro'
);

$deleted = $adobe_fonts->rest_delete_settings();
$deleted_data = $deleted->get_data();
kodety_adobe_fonts_assert(
    !isset($kodety_adobe_fonts_options['kodety_adobe_fonts_settings'])
        && is_array($deleted_data)
        && ($deleted_data['configured'] ?? true) === false
        && ($deleted_data['fonts'] ?? null) === [],
    'DELETE deve desconectar o projeto e voltar ao contrato vazio'
);

$source = file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-adobe-fonts.php');
kodety_adobe_fonts_assert(
    is_string($source)
        && !str_contains($source, 'KODETY_ADOBE_FONTS_RESELLER_LICENSED')
        && !str_contains($source, 'X-Typekit-Token'),
    'o backend deve funcionar sem wp-config e não incorporar autenticação Adobe'
);

fwrite(STDOUT, "Adobe Fonts runtime: plugin-native setup, routes, fixed endpoints, parser, sync fallback, stylesheet and cleanup verified.\n");
