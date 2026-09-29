<?php

/**
 * Isolated runtime contracts for the Google Search Console integration.
 *
 * Run with: php Wordpress/tests/search-console-runtime.php
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('ARRAY_A', 'ARRAY_A');

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

final class WP_REST_Request implements ArrayAccess {
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
    public function get_params(): array { return array_merge($this->params, $this->json); }
    public function offsetExists(mixed $offset): bool { return isset($this->params[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->params[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->params[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->params[$offset]); }
}

final class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_headers(): array { return $this->headers; }
}

final class WP_REST_Server {
    public const READABLE = 'GET';
    public const CREATABLE = 'POST';
    public const EDITABLE = 'POST,PUT,PATCH';
    public const DELETABLE = 'DELETE';
}

final class Kodety_Edition {
    public static bool $advanced_seo = true;
    public static function has(string $feature): bool { return $feature === 'advancedSeo' && self::$advanced_seo; }
    public static function license_url(): string { return 'https://example.test/license'; }
    public static function upgrade_url(): string { return 'https://example.test/upgrade'; }
}

$kodety_search_console_options = [];
$kodety_search_console_transients = [];
$kodety_search_console_transient_ttls = [];
$kodety_search_console_routes = [];
$kodety_search_console_actions = [];
$kodety_search_console_scheduled = [];
$kodety_search_console_can_manage = true;
$kodety_search_console_redirect = '';
$kodety_search_console_http_requests = [];
$kodety_search_console_dbdelta = [];
$kodety_search_console_option_autoloads = [];
$kodety_search_console_filters = [];
$kodety_search_console_admin_base = 'https://example.test/wp-admin/';

function add_action(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): void {
    global $kodety_search_console_actions;
    $kodety_search_console_actions[] = compact('hook', 'callback', 'priority', 'accepted_args');
}
function do_action(string $hook, mixed ...$args): void {}
function add_filter(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): bool {
    global $kodety_search_console_filters;
    $kodety_search_console_filters[$hook][$priority][] = [
        'callback' => $callback,
        'accepted_args' => $accepted_args,
    ];
    return true;
}
function has_filter(string $hook, mixed $callback = false): int|false {
    global $kodety_search_console_filters;
    if (empty($kodety_search_console_filters[$hook])) return false;
    $priorities = array_keys($kodety_search_console_filters[$hook]);
    sort($priorities, SORT_NUMERIC);
    if ($callback === false) return (int) $priorities[0];
    foreach ($priorities as $priority) {
        foreach ($kodety_search_console_filters[$hook][$priority] as $entry) {
            if ($entry['callback'] === $callback) return (int) $priority;
        }
    }
    return false;
}
function remove_filter(string $hook, mixed $callback, int $priority = 10): bool {
    global $kodety_search_console_filters;
    foreach ($kodety_search_console_filters[$hook][$priority] ?? [] as $index => $entry) {
        if ($entry['callback'] !== $callback) continue;
        unset($kodety_search_console_filters[$hook][$priority][$index]);
        if (!$kodety_search_console_filters[$hook][$priority]) unset($kodety_search_console_filters[$hook][$priority]);
        if (!$kodety_search_console_filters[$hook]) unset($kodety_search_console_filters[$hook]);
        return true;
    }
    return false;
}
function apply_filters(string $hook, mixed $value, mixed ...$args): mixed {
    global $kodety_search_console_filters;
    if (empty($kodety_search_console_filters[$hook])) return $value;
    ksort($kodety_search_console_filters[$hook], SORT_NUMERIC);
    foreach ($kodety_search_console_filters[$hook] as $entries) {
        foreach ($entries as $entry) {
            $arguments = array_slice([$value, ...$args], 0, max(1, (int) $entry['accepted_args']));
            $value = ($entry['callback'])(...$arguments);
        }
    }
    return $value;
}
function register_rest_route(string $namespace, string $route, array $args, bool $override = false): bool {
    global $kodety_search_console_routes;
    $kodety_search_console_routes[$namespace . $route] = $args;
    return true;
}
function is_user_logged_in(): bool { return true; }
function current_user_can(string $capability): bool {
    global $kodety_search_console_can_manage;
    return in_array($capability, [
        'kodety_view_search_console',
        'kodety_manage_search_console',
        'kodety_manage_integrations',
        'kodety_view_analytics',
        'manage_options',
    ], true) && $kodety_search_console_can_manage;
}
function get_current_user_id(): int { return 7; }
function wp_verify_nonce(string $nonce, string $action): bool {
    return $nonce === 'valid-rest-nonce' && $action === 'wp_rest';
}
function wp_create_nonce(string $action): string { return 'nonce-' . $action; }
function get_option(string $name, mixed $default = false): mixed {
    global $kodety_search_console_options;
    if (array_key_exists($name, $kodety_search_console_options)) return $kodety_search_console_options[$name];
    return $default;
}
function update_option(string $name, mixed $value, mixed $autoload = null): bool {
    global $kodety_search_console_options, $kodety_search_console_option_autoloads;
    $kodety_search_console_options[$name] = $value;
    $kodety_search_console_option_autoloads[$name] = $autoload;
    return true;
}
function add_option(string $name, mixed $value, string $deprecated = '', mixed $autoload = null): bool {
    global $kodety_search_console_options, $kodety_search_console_option_autoloads;
    if (array_key_exists($name, $kodety_search_console_options)) return false;
    $kodety_search_console_options[$name] = $value;
    $kodety_search_console_option_autoloads[$name] = $autoload;
    return true;
}
function delete_option(string $name): bool {
    global $kodety_search_console_options, $kodety_search_console_option_autoloads;
    $present = array_key_exists($name, $kodety_search_console_options);
    unset($kodety_search_console_options[$name], $kodety_search_console_option_autoloads[$name]);
    return $present;
}
function get_transient(string $key): mixed {
    global $kodety_search_console_transients;
    return $kodety_search_console_transients[$key] ?? false;
}
function set_transient(string $key, mixed $value, int $expiration = 0): bool {
    global $kodety_search_console_transients, $kodety_search_console_transient_ttls;
    $kodety_search_console_transients[$key] = $value;
    $kodety_search_console_transient_ttls[$key] = $expiration;
    return true;
}
function delete_transient(string $key): bool {
    global $kodety_search_console_transients, $kodety_search_console_transient_ttls;
    $present = array_key_exists($key, $kodety_search_console_transients);
    unset($kodety_search_console_transients[$key], $kodety_search_console_transient_ttls[$key]);
    return $present;
}
function wp_next_scheduled(string $hook, array $args = []): int|false {
    global $kodety_search_console_scheduled;
    return $kodety_search_console_scheduled[$hook] ?? false;
}
function wp_schedule_event(int $timestamp, string $recurrence, string $hook, array $args = [], bool $wp_error = false): bool|WP_Error {
    global $kodety_search_console_scheduled;
    $kodety_search_console_scheduled[$hook] = $timestamp;
    return true;
}
function wp_schedule_single_event(int $timestamp, string $hook, array $args = [], bool $wp_error = false): bool|WP_Error {
    global $kodety_search_console_scheduled;
    $kodety_search_console_scheduled[$hook] = $timestamp;
    return true;
}
function wp_clear_scheduled_hook(string $hook, array $args = [], bool $wp_error = false): int|false|WP_Error {
    global $kodety_search_console_scheduled;
    $removed = isset($kodety_search_console_scheduled[$hook]) ? 1 : 0;
    unset($kodety_search_console_scheduled[$hook]);
    return $removed;
}
function wp_salt(string $scheme = 'auth'): string { return 'search-console-runtime-salt-' . $scheme; }
function wp_generate_uuid4(): string { return '12345678-1234-4abc-8def-123456789abc'; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function absint(mixed $value): int { return abs((int) $value); }
function rest_sanitize_boolean(mixed $value): bool { return filter_var($value, FILTER_VALIDATE_BOOLEAN); }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? '')); }
function sanitize_email(string $value): string { return filter_var(trim($value), FILTER_VALIDATE_EMAIL) ? trim($value) : ''; }
function esc_url_raw(string $value, ?array $protocols = null): string {
    if (filter_var($value, FILTER_VALIDATE_URL) === false) return '';
    $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));
    return $protocols !== null && !in_array($scheme, $protocols, true) ? '' : $value;
}
function wp_http_validate_url(string $value): string|false { return esc_url_raw($value) ?: false; }
function wp_unslash(mixed $value): mixed {
    return is_array($value) ? array_map('wp_unslash', $value) : (is_string($value) ? stripslashes($value) : $value);
}
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function add_query_arg(array|string $key, mixed $value = null, ?string $url = null): string {
    if (is_array($key)) {
        $args = $key;
        $target = is_string($value) ? $value : '';
    } else {
        $args = [$key => $value];
        $target = (string) $url;
    }
    return $target . (str_contains($target, '?') ? '&' : '?') . http_build_query($args, '', '&', PHP_QUERY_RFC3986);
}
function rest_url(string $path = ''): string { return 'https://example.test/wp-json/' . ltrim($path, '/'); }
function admin_url(string $path = ''): string {
    global $kodety_search_console_admin_base;
    return rtrim($kodety_search_console_admin_base, '/') . '/' . ltrim($path, '/');
}
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function site_url(string $path = ''): string { return home_url($path); }
function trailingslashit(string $value): string { return rtrim($value, '/\\') . '/'; }
function get_bloginfo(string $show = '', string $filter = 'raw'): string { return $show === 'admin_email' ? 'admin@example.test' : 'Example'; }
function wp_safe_redirect(string $location, int $status = 302, string $x_redirect_by = 'WordPress'): bool {
    global $kodety_search_console_redirect;
    $kodety_search_console_redirect = $location;
    return true;
}
function nocache_headers(): void {}
function dbDelta(string $queries, bool $execute = true): array {
    global $kodety_search_console_dbdelta;
    $kodety_search_console_dbdelta[] = $queries;
    return [];
}
function wp_safe_remote_request(string $url, array $args = []): array|WP_Error {
    global $kodety_search_console_http_requests;
    $kodety_search_console_http_requests[] = compact('url', 'args');
    return ['response' => ['code' => 200, 'message' => 'OK'], 'headers' => [], 'body' => '{}'];
}
function wp_safe_remote_get(string $url, array $args = []): array|WP_Error { return wp_safe_remote_request($url, array_merge($args, ['method' => 'GET'])); }
function wp_safe_remote_post(string $url, array $args = []): array|WP_Error { return wp_safe_remote_request($url, array_merge($args, ['method' => 'POST'])); }
function wp_remote_retrieve_response_code(array|WP_Error $response): int { return is_array($response) ? (int) ($response['response']['code'] ?? 0) : 0; }
function wp_remote_retrieve_response_message(array|WP_Error $response): string { return is_array($response) ? (string) ($response['response']['message'] ?? '') : ''; }
function wp_remote_retrieve_body(array|WP_Error $response): string { return is_array($response) ? (string) ($response['body'] ?? '') : ''; }
function wp_remote_retrieve_header(array|WP_Error $response, string $name): mixed {
    if (!is_array($response)) return '';
    $headers = array_change_key_case((array) ($response['headers'] ?? []), CASE_LOWER);
    return $headers[strtolower($name)] ?? '';
}

final class KodetySearchConsoleRuntimeWpdb {
    public string $prefix = 'wp_';
    public string $options = 'wp_options';
    public string $last_error = '';
    public int $insert_id = 0;
    public array $queries = [];
    public array $rows = [];
    public function get_charset_collate(): string { return 'DEFAULT CHARACTER SET utf8mb4'; }
    public function esc_like(string $value): string { return addcslashes($value, '_%\\'); }
    public function prepare(string $query, mixed ...$args): string { return $query; }
    public function query(string $query): int|false { $this->queries[] = $query; return 1; }
    public function get_results(string $query, mixed $output = null): array { $this->queries[] = $query; return $this->rows; }
    public function get_row(string $query, mixed $output = null): ?array { $this->queries[] = $query; return $this->rows[0] ?? null; }
    public function get_var(string $query): mixed { $this->queries[] = $query; return 0; }
    public function get_col(string $query): array { $this->queries[] = $query; return []; }
    public function insert(string $table, array $data, array|string|null $format = null): int|false { $this->queries[] = "INSERT {$table}"; return 1; }
    public function replace(string $table, array $data, array|string|null $format = null): int|false { $this->queries[] = "REPLACE {$table}"; return 1; }
    public function update(string $table, array $data, array $where, array|string|null $format = null, array|string|null $where_format = null): int|false { $this->queries[] = "UPDATE {$table}"; return 1; }
    public function delete(string $table, array $where, array|string|null $where_format = null): int|false { $this->queries[] = "DELETE {$table}"; return 1; }
}

$wpdb = new KodetySearchConsoleRuntimeWpdb();

require dirname(__DIR__) . '/kodety/includes/class-kodety-search-console.php';

function kodety_search_console_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_search_console_data(mixed $value): mixed {
    return $value instanceof WP_REST_Response ? $value->get_data() : $value;
}

function kodety_search_console_route_endpoints(array $definition): array {
    return isset($definition['methods']) ? [$definition] : array_values(array_filter(
        $definition,
        static fn (mixed $candidate): bool => is_array($candidate) && isset($candidate['methods'])
    ));
}

function kodety_search_console_invoke(object|string $target, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($target, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke(is_object($target) ? $target : null, ...$arguments);
}

function kodety_search_console_crypto_method(ReflectionClass $reflection, string $needle): ?ReflectionMethod {
    foreach ($reflection->getMethods() as $method) {
        if (
            str_contains(strtolower($method->getName()), $needle)
            && $method->getNumberOfRequiredParameters() <= 2
            && $method->getNumberOfParameters() >= 1
        ) {
            $method->setAccessible(true);
            return $method;
        }
    }
    return null;
}

kodety_search_console_assert(class_exists(Kodety_Search_Console::class), 'a classe Search Console deve carregar isoladamente');
$reflection = new ReflectionClass(Kodety_Search_Console::class);
$search_console = Kodety_Search_Console::instance();

foreach ([
    'SEARCH_ANALYTICS_PAGE_SIZE' => 25000,
    'SEARCH_ANALYTICS_MAX_ROWS' => 50000,
    'INSPECTION_MAX_PER_SYNC' => 600,
    'INSPECTION_MAX_PER_DAY' => 2000,
] as $constant => $ceiling) {
    $value = (int) $reflection->getConstant($constant);
    kodety_search_console_assert(
        $value > 0 && $value <= $ceiling,
        "{$constant} deve ser positivo e respeitar o teto {$ceiling}"
    );
}

$registered_hooks = array_column($kodety_search_console_actions, 'hook');
kodety_search_console_assert(
    in_array($reflection->getConstant('CRON_HOOK'), $registered_hooks, true)
        && in_array($reflection->getConstant('RETRY_HOOK'), $registered_hooks, true),
    'sync diário e retry devem ser registrados no cron do WordPress'
);

kodety_search_console_assert(
    $reflection->hasMethod('register_rest_routes'),
    'a integração deve publicar suas rotas em um registrador explícito'
);
$search_console->register_rest_routes();

$expected_routes = [
    '/kodety/v1/seo/search-console' => 'DELETE',
    '/kodety/v1/seo/search-console/status' => 'GET',
    '/kodety/v1/seo/search-console/connect' => 'POST',
    '/kodety/v1/seo/search-console/oauth-client' => 'GET',
    '/kodety/v1/seo/search-console/property' => 'POST',
    '/kodety/v1/seo/search-console/sync' => 'POST',
];
foreach ($expected_routes as $route => $expected_method) {
    kodety_search_console_assert(isset($kodety_search_console_routes[ltrim($route, '/')]), "rota {$route} ausente");
    $endpoints = kodety_search_console_route_endpoints($kodety_search_console_routes[ltrim($route, '/')]);
    $matching = array_values(array_filter(
        $endpoints,
        static fn (array $endpoint): bool => str_contains((string) $endpoint['methods'], $expected_method)
    ));
    kodety_search_console_assert((bool) $matching, "rota {$route} deve aceitar {$expected_method}");
    foreach ($endpoints as $endpoint) {
        kodety_search_console_assert(
            isset($endpoint['permission_callback']) && $endpoint['permission_callback'] !== '__return_true',
            "rota {$route} não pode ser pública"
        );
    }
}
$oauth_client_endpoints = kodety_search_console_route_endpoints(
    $kodety_search_console_routes['kodety/v1/seo/search-console/oauth-client']
);
foreach (['GET', 'POST', 'DELETE'] as $method) {
    $matching = array_values(array_filter(
        $oauth_client_endpoints,
        static fn (array $endpoint): bool => str_contains((string) $endpoint['methods'], $method)
    ));
    kodety_search_console_assert(count($matching) === 1, "oauth-client deve registrar exatamente um handler {$method}");
}
$oauth_client_callbacks = array_column($oauth_client_endpoints, 'callback');
kodety_search_console_assert(
    in_array([$search_console, 'rest_get_oauth_client'], $oauth_client_callbacks, true)
        && in_array([$search_console, 'rest_save_oauth_client'], $oauth_client_callbacks, true)
        && in_array([$search_console, 'rest_delete_oauth_client'], $oauth_client_callbacks, true),
    'oauth-client deve usar handlers explícitos para consultar, salvar e remover configuração'
);

$status_permission_endpoint = kodety_search_console_route_endpoints(
    $kodety_search_console_routes['kodety/v1/seo/search-console/status']
)[0];
$permission = $status_permission_endpoint['permission_callback'];
$kodety_search_console_can_manage = false;
$denied = $permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_search_console_assert(
    $denied instanceof WP_Error && (int) (($denied->get_error_data()['status'] ?? 0)) === 403,
    'capability deve ser verificada antes de retornar dados Search Console'
);
$kodety_search_console_can_manage = true;
$stale = $permission(new WP_REST_Request([], ['X-WP-Nonce' => 'stale-rest-nonce']));
kodety_search_console_assert(
    $stale instanceof WP_Error && (int) (($stale->get_error_data()['status'] ?? 0)) === 403,
    'nonce REST ausente ou expirado deve falhar fechado'
);
$allowed = $permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_search_console_assert($allowed === true, 'capability e nonce válidos devem autorizar a rota');
Kodety_Edition::$advanced_seo = false;
$connect_permission = kodety_search_console_route_endpoints(
    $kodety_search_console_routes['kodety/v1/seo/search-console/connect']
)[0]['permission_callback'];
$unlicensed = $connect_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_search_console_assert(
    $unlicensed instanceof WP_Error
        && (int) (($unlicensed->get_error_data()['status'] ?? 0)) === 403
        && (($unlicensed->get_error_data()['feature'] ?? '') === 'advancedSeo'),
    'conectar e usar Search Console deve exigir advancedSeo no servidor'
);
$minimal_status_permission = $permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
$minimal_status = $search_console->rest_status(new WP_REST_Request());
$minimal_data = kodety_search_console_data($minimal_status);
kodety_search_console_assert(
    $minimal_status_permission === true
        && $minimal_status instanceof WP_REST_Response
        && is_array($minimal_data)
        && ($minimal_data['proRequired'] ?? false) === true
        && ($minimal_data['accountEmail'] ?? '') === ''
        && ($minimal_data['property'] ?? '') === ''
        && ($minimal_data['properties'] ?? null) === []
        && ($minimal_data['rows'] ?? null) === [],
    'sem Pro, gestor deve ver apenas estado mínimo sem métricas ou dados da conta'
);
$disconnect_permission = array_values(array_filter(
    kodety_search_console_route_endpoints($kodety_search_console_routes['kodety/v1/seo/search-console']),
    static fn (array $endpoint): bool => str_contains((string) $endpoint['methods'], 'DELETE')
))[0]['permission_callback'];
$unlicensed_disconnect_permission = $disconnect_permission(
    new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce'])
);
$unlicensed_disconnect = $search_console->rest_disconnect();
kodety_search_console_assert(
    $unlicensed_disconnect_permission === true && $unlicensed_disconnect instanceof WP_REST_Response,
    'expiração do Pro não pode impedir o gestor de revogar e apagar a credencial Google'
);
$oauth_client_endpoint_by_method = [];
foreach ($oauth_client_endpoints as $endpoint) {
    foreach (['GET', 'POST', 'DELETE'] as $method) {
        if (str_contains((string) $endpoint['methods'], $method)) {
            $oauth_client_endpoint_by_method[$method] = $endpoint;
        }
    }
}
$oauth_get_permission = $oauth_client_endpoint_by_method['GET']['permission_callback'];
$oauth_post_permission = $oauth_client_endpoint_by_method['POST']['permission_callback'];
$unlicensed_oauth_get_permission = $oauth_get_permission(
    new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce'])
);
$unlicensed_oauth_post_permission = $oauth_post_permission(
    new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce'])
);
kodety_search_console_assert(
    $unlicensed_oauth_get_permission === true
        && $unlicensed_oauth_post_permission instanceof WP_Error
        && (int) (($unlicensed_oauth_post_permission->get_error_data()['status'] ?? 0)) === 403
        && (($unlicensed_oauth_post_permission->get_error_data()['feature'] ?? '') === 'advancedSeo'),
    'GET de metadados OAuth deve sobreviver sem Pro, mas POST continua protegido por advancedSeo'
);
$oauth_delete_permission = $oauth_client_endpoint_by_method['DELETE']['permission_callback'];
kodety_search_console_assert(
    $oauth_delete_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce'])) === true,
    'DELETE da configuração OAuth deve continuar disponível sem Pro'
);
$direct_oauth_get = $search_console->rest_get_oauth_client();
$direct_oauth_post = $search_console->rest_save_oauth_client(new WP_REST_Request());
kodety_search_console_assert(
    $direct_oauth_get instanceof WP_REST_Response
        && $direct_oauth_post instanceof WP_Error
        && (($direct_oauth_post->get_error_data()['feature'] ?? '') === 'advancedSeo'),
    'handler GET deve expor só metadados sem Pro e POST deve falhar fechado'
);

foreach (['connect', 'property', 'sync'] as $pro_route) {
    $definition = $kodety_search_console_routes['kodety/v1/seo/search-console/' . $pro_route];
    foreach (kodety_search_console_route_endpoints($definition) as $endpoint) {
        $callback = $endpoint['callback'];
        $callback_reflection = new ReflectionMethod($callback[0], $callback[1]);
        $arguments = $callback_reflection->getNumberOfParameters() > 0
            ? [new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce'])]
            : [];
        $direct = $callback(...$arguments);
        kodety_search_console_assert(
            $direct instanceof WP_Error
                && (int) (($direct->get_error_data()['status'] ?? 0)) === 403
                && (($direct->get_error_data()['feature'] ?? '') === 'advancedSeo'),
            "callback {$pro_route} também deve falhar fechado sem advancedSeo"
        );
    }
}
Kodety_Edition::$advanced_seo = true;

$encrypt = kodety_search_console_crypto_method($reflection, 'encrypt');
$decrypt = kodety_search_console_crypto_method($reflection, 'decrypt');
kodety_search_console_assert($encrypt !== null && $decrypt !== null, 'tokens devem ter cifragem autenticada reversível');
$secret = 'ya29.runtime-access-token';
$encrypted = $encrypt->invokeArgs($search_console, $encrypt->getNumberOfParameters() >= 2
    ? [$secret, 'runtime-token']
    : [$secret]);
kodety_search_console_assert(
    is_string($encrypted) && $encrypted !== $secret && !str_contains($encrypted, $secret),
    'token persistido não pode conter o segredo em claro'
);
$plain = $decrypt->invokeArgs($search_console, $decrypt->getNumberOfParameters() >= 2
    ? [$encrypted, 'runtime-token']
    : [$encrypted]);
kodety_search_console_assert($plain === $secret, 'token cifrado deve completar round-trip');
$tampered = substr($encrypted, 0, -1) . (substr($encrypted, -1) === 'A' ? 'B' : 'A');
$tampered_plain = $decrypt->invokeArgs($search_console, $decrypt->getNumberOfParameters() >= 2
    ? [$tampered, 'runtime-token']
    : [$tampered]);
kodety_search_console_assert(
    $tampered_plain instanceof WP_Error || $tampered_plain !== $secret,
    'alteração no ciphertext deve ser detectada'
);

$empty_oauth_response = $search_console->rest_get_oauth_client();
$empty_oauth = kodety_search_console_data($empty_oauth_response);
kodety_search_console_assert(
    $empty_oauth_response instanceof WP_REST_Response
        && is_array($empty_oauth)
        && ($empty_oauth['configured'] ?? true) === false
        && ($empty_oauth['source'] ?? '') === 'none'
        && ($empty_oauth['managedExternally'] ?? true) === false
        && ($empty_oauth['editable'] ?? false) === true
        && ($empty_oauth['hasClientSecret'] ?? true) === false
        && ($empty_oauth['callbackUrl'] ?? '') === 'https://example.test/wp-admin/admin-post.php?action=kodety_search_console_oauth_callback'
        && ($empty_oauth['callbackUsable'] ?? false) === true,
    'configuração OAuth vazia deve orientar o administrador sem expor segredo'
);
$empty_status = kodety_search_console_data($search_console->rest_status(new WP_REST_Request()));
$missing_configuration_connect = $search_console->rest_connect(new WP_REST_Request());
kodety_search_console_assert(
    is_array($empty_status)
        && ($empty_status['configurationRequired'] ?? false) === true
        && $missing_configuration_connect instanceof WP_Error
        && (int) (($missing_configuration_connect->get_error_data()['status'] ?? 0)) === 409
        && (($missing_configuration_connect->get_error_data()['configurationRequired'] ?? false) === true),
    'status e erro de conexão devem informar configurationRequired quando o OAuth local não existe'
);

$kodety_search_console_admin_base = 'http://insecure.example.test/wp-admin/';
$insecure_oauth_metadata = kodety_search_console_data($search_console->rest_get_oauth_client());
$insecure_secret = 'must-never-appear-in-callback-error';
$insecure_oauth_save = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => 'insecure-runtime-client.apps.googleusercontent.com',
    'clientSecret' => $insecure_secret,
]));
$insecure_oauth_connect = $search_console->rest_connect(new WP_REST_Request());
$insecure_error_payload = json_encode([
    $insecure_oauth_save instanceof WP_Error ? $insecure_oauth_save->get_error_message() : '',
    $insecure_oauth_save instanceof WP_Error ? $insecure_oauth_save->get_error_data() : null,
    $insecure_oauth_connect instanceof WP_Error ? $insecure_oauth_connect->get_error_message() : '',
    $insecure_oauth_connect instanceof WP_Error ? $insecure_oauth_connect->get_error_data() : null,
], JSON_UNESCAPED_SLASHES);
$pending_after_insecure_connect = array_filter(
    $kodety_search_console_options,
    static fn (string $key): bool => str_starts_with(
        $key,
        (string) $reflection->getConstant('OPTION_OAUTH_PREFIX')
    ),
    ARRAY_FILTER_USE_KEY
);
kodety_search_console_assert(
    is_array($insecure_oauth_metadata)
        && ($insecure_oauth_metadata['callbackUsable'] ?? true) === false
        && $insecure_oauth_save instanceof WP_Error
        && (int) (($insecure_oauth_save->get_error_data()['status'] ?? 0)) === 422
        && (($insecure_oauth_save->get_error_data()['callbackUsable'] ?? true) === false)
        && $insecure_oauth_connect instanceof WP_Error
        && (int) (($insecure_oauth_connect->get_error_data()['status'] ?? 0)) === 409
        && (($insecure_oauth_connect->get_error_data()['callbackUsable'] ?? true) === false)
        && !$pending_after_insecure_connect
        && is_string($insecure_error_payload)
        && !str_contains($insecure_error_payload, $insecure_secret)
        && !str_contains($insecure_error_payload, 'insecure.example.test'),
    'callback inseguro deve bloquear save/connect antes de criar state e retornar erro redigido'
);

$kodety_search_console_admin_base = 'http://localhost:8080/wp-admin/';
$localhost_oauth_metadata = kodety_search_console_data($search_console->rest_get_oauth_client());
kodety_search_console_assert(
    is_array($localhost_oauth_metadata)
        && ($localhost_oauth_metadata['callbackUsable'] ?? false) === true,
    'callback HTTP deve continuar permitido em localhost'
);
$kodety_search_console_admin_base = 'https://example.test/wp-admin/';

$broker_authorization_filter = static fn (string $url, array $context): string =>
    'https://broker.example.test/oauth/start?state=' . rawurlencode((string) ($context['state'] ?? ''));
add_filter('kodety_search_console_oauth_broker_authorization_url', $broker_authorization_filter, 10, 2);
$kodety_search_console_admin_base = 'http://insecure.example.test/wp-admin/';
$insecure_broker_connect = $search_console->rest_connect(new WP_REST_Request());
$kodety_search_console_admin_base = 'https://example.test/wp-admin/';
$broker_metadata = kodety_search_console_data($search_console->rest_get_oauth_client());
$broker_connect = $search_console->rest_connect(new WP_REST_Request());
$broker_connect_data = kodety_search_console_data($broker_connect);
kodety_search_console_assert(
    has_filter('kodety_search_console_oauth_broker_authorization_url') !== false
        && $insecure_broker_connect instanceof WP_Error
        && (int) (($insecure_broker_connect->get_error_data()['status'] ?? 0)) === 409
        && is_array($broker_metadata)
        && ($broker_metadata['configured'] ?? false) === true
        && ($broker_metadata['source'] ?? '') === 'server'
        && ($broker_metadata['managedExternally'] ?? false) === true
        && ($broker_metadata['editable'] ?? true) === false
        && $broker_connect instanceof WP_REST_Response
        && str_starts_with(
            (string) ($broker_connect_data['authorizationUrl'] ?? ''),
            'https://broker.example.test/oauth/start?state='
        ),
    'filtro registrado deve configurar broker automaticamente e ainda exigir callback utilizável'
);
remove_filter('kodety_search_console_oauth_broker_authorization_url', $broker_authorization_filter, 10);
foreach (array_keys($kodety_search_console_options) as $option_name) {
    if (str_starts_with($option_name, (string) $reflection->getConstant('OPTION_OAUTH_PREFIX'))) {
        delete_option($option_name);
    }
}

$invalid_oauth = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => 'not-a-google-web-client',
    'clientSecret' => 'invalid-secret',
]));
kodety_search_console_assert(
    $invalid_oauth instanceof WP_Error
        && (int) (($invalid_oauth->get_error_data()['status'] ?? 0)) === 422,
    'Client ID fora do formato web do Google deve ser rejeitado com 422'
);

$local_client_id = 'local-runtime-client.apps.googleusercontent.com';
$local_client_secret = 'local-runtime-secret-123';
$current_site_for_oauth = kodety_search_console_invoke($search_console, 'current_site');
$current_access_key_for_oauth = (string) $reflection->getConstant('TRANSIENT_ACCESS_TOKEN_PREFIX')
    . $current_site_for_oauth['key'];
set_transient($current_access_key_for_oauth, 'stale-access-token', 300);
$queries_before_oauth_save = count($wpdb->queries);
$saved_oauth_response = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => $local_client_id,
    'clientSecret' => $local_client_secret,
]));
$saved_oauth = kodety_search_console_data($saved_oauth_response);
$serialized_saved_oauth = json_encode($saved_oauth, JSON_UNESCAPED_SLASHES);
kodety_search_console_assert(
    $saved_oauth_response instanceof WP_REST_Response
        && is_array($saved_oauth)
        && ($saved_oauth['configured'] ?? false) === true
        && ($saved_oauth['source'] ?? '') === 'wordpress'
        && ($saved_oauth['managedExternally'] ?? true) === false
        && ($saved_oauth['editable'] ?? false) === true
        && ($saved_oauth['hasClientSecret'] ?? false) === true
        && ($saved_oauth['callbackUsable'] ?? false) === true
        && ($saved_oauth['clientIdHint'] ?? '') !== ''
        && ($saved_oauth['clientIdHint'] ?? '') !== $local_client_id
        && is_string($serialized_saved_oauth)
        && !str_contains($serialized_saved_oauth, $local_client_id)
        && !str_contains($serialized_saved_oauth, $local_client_secret),
    'POST deve salvar a configuração no WordPress e responder somente metadados redigidos'
);
$oauth_client_option = (string) $reflection->getConstant('OPTION_OAUTH_CLIENT');
$raw_oauth_option = $kodety_search_console_options[$oauth_client_option] ?? null;
$serialized_raw_oauth = json_encode($raw_oauth_option, JSON_UNESCAPED_SLASHES);
$oauth_save_queries = array_slice($wpdb->queries, $queries_before_oauth_save);
$cleared_pending_oauth_states = (bool) array_filter(
    $oauth_save_queries,
    static fn (string $query): bool => str_contains($query, 'DELETE FROM wp_options')
        && str_contains($query, 'option_name LIKE')
);
kodety_search_console_assert(
    is_array($raw_oauth_option)
        && !str_starts_with($oauth_client_option, (string) $reflection->getConstant('OPTION_OAUTH_PREFIX'))
        && ($kodety_search_console_option_autoloads[$oauth_client_option] ?? null) === false
        && is_string($serialized_raw_oauth)
        && !str_contains($serialized_raw_oauth, $local_client_secret)
        && !isset($kodety_search_console_transients[$current_access_key_for_oauth])
        && $cleared_pending_oauth_states,
    'Client Secret deve ficar cifrado em opção sem autoload e salvar deve invalidar estado/cache OAuth'
);
$resolved_local_oauth = kodety_search_console_invoke($search_console, 'client_credentials');
kodety_search_console_assert(
    is_array($resolved_local_oauth)
        && ($resolved_local_oauth['client_id'] ?? '') === $local_client_id
        && ($resolved_local_oauth['client_secret'] ?? '') === $local_client_secret,
    'backend deve recuperar a credencial local cifrada para a troca OAuth servidor-servidor'
);

$oauth_client_revision_option = (string) $reflection->getConstant('OPTION_OAUTH_CLIENT_REVISION');
$connection_revision_prefix = (string) $reflection->getConstant('OPTION_CONNECTION_REVISION_PREFIX');
$oauth_state_with_revisions = kodety_search_console_invoke(
    $search_console,
    'create_oauth_state',
    $current_site_for_oauth,
    ''
);
$oauth_state_revision_record = is_array($oauth_state_with_revisions)
    ? ($kodety_search_console_options[$oauth_state_with_revisions['option']] ?? null)
    : null;
$oauth_client_revision_after_first_save = kodety_search_console_invoke(
    $search_console,
    'oauth_client_revision'
);
$connection_revision_at_state_creation = kodety_search_console_invoke(
    $search_console,
    'connection_revision',
    $current_site_for_oauth['key']
);
kodety_search_console_assert(
    is_array($oauth_state_with_revisions)
        && is_array($oauth_state_revision_record)
        && ($oauth_state_revision_record['oauth_client_revision'] ?? -1) === $oauth_client_revision_after_first_save
        && ($oauth_state_revision_record['connection_revision'] ?? -1) === $connection_revision_at_state_creation
        && $oauth_client_revision_after_first_save > 0
        && ($kodety_search_console_option_autoloads[$oauth_client_revision_option] ?? null) === false
        && kodety_search_console_invoke(
            $search_console,
            'oauth_state_revisions_current',
            $oauth_state_revision_record,
            $current_site_for_oauth
        ) === true,
    'state OAuth deve capturar as revisões globais e por site em opções sem autoload'
);

$rotated_local_secret = 'local-runtime-secret-rotated';
$partial_secret_update = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => '',
    'clientSecret' => $rotated_local_secret,
]));
$resolved_partial_oauth = kodety_search_console_invoke($search_console, 'client_credentials');
$superseded_by_client_change = kodety_search_console_invoke(
    $search_console,
    'oauth_state_revisions_current',
    $oauth_state_revision_record,
    $current_site_for_oauth
);
kodety_search_console_assert(
    $partial_secret_update instanceof WP_REST_Response
        && is_array($resolved_partial_oauth)
        && ($resolved_partial_oauth['client_id'] ?? '') === $local_client_id
        && ($resolved_partial_oauth['client_secret'] ?? '') === $rotated_local_secret
        && kodety_search_console_invoke($search_console, 'oauth_client_revision')
            > $oauth_client_revision_after_first_save
        && $superseded_by_client_change instanceof WP_Error
        && (int) (($superseded_by_client_change->get_error_data()['status'] ?? 0)) === 409,
    'editar somente o Client Secret deve preservar o Client ID e invalidar states da revisão antiga'
);
if (is_array($oauth_state_with_revisions)) delete_option($oauth_state_with_revisions['option']);
$id_without_new_secret = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => 'replacement-runtime-client.apps.googleusercontent.com',
    'clientSecret' => '',
]));
$resolved_after_rejected_id = kodety_search_console_invoke($search_console, 'client_credentials');
kodety_search_console_assert(
    $id_without_new_secret instanceof WP_Error
        && (int) (($id_without_new_secret->get_error_data()['status'] ?? 0)) === 422
        && ($resolved_after_rejected_id['client_id'] ?? '') === $local_client_id
        && ($resolved_after_rejected_id['client_secret'] ?? '') === $rotated_local_secret,
    'trocar Client ID sem fornecer novo Client Secret deve falhar sem alterar a opção'
);
$empty_partial_update = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => '',
    'clientSecret' => '',
]));
kodety_search_console_assert(
    $empty_partial_update instanceof WP_REST_Response,
    'campos vazios devem preservar a configuração local existente'
);
$configured_status = kodety_search_console_data($search_console->rest_status(new WP_REST_Request()));
kodety_search_console_assert(
    is_array($configured_status) && ($configured_status['configurationRequired'] ?? true) === false,
    'status deve reconhecer a configuração OAuth local válida'
);

$oauth_client_lock_key = kodety_search_console_invoke($search_console, 'oauth_client_lock_key');
$oauth_client_lock_owner = kodety_search_console_invoke(
    $search_console,
    'acquire_state_lock',
    $oauth_client_lock_key
);
$save_while_oauth_client_locked = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => '',
    'clientSecret' => '',
]));
$delete_while_oauth_client_locked = $search_console->rest_delete_oauth_client();
kodety_search_console_assert(
    is_string($oauth_client_lock_owner)
        && $save_while_oauth_client_locked instanceof WP_Error
        && (int) (($save_while_oauth_client_locked->get_error_data()['status'] ?? 0)) === 409
        && $delete_while_oauth_client_locked instanceof WP_Error
        && (int) (($delete_while_oauth_client_locked->get_error_data()['status'] ?? 0)) === 409,
    'save e delete do OAuth client devem compartilhar o mesmo lock global da fase final do callback'
);
kodety_search_console_invoke(
    $search_console,
    'release_state_lock',
    $oauth_client_lock_key,
    $oauth_client_lock_owner
);

$site_a = kodety_search_console_invoke($search_console, 'site_from_values', 'https://alpha.example/projects/a/');
$site_b = kodety_search_console_invoke($search_console, 'site_from_values', 'https://beta.example/projects/b/');
kodety_search_console_assert(
    preg_match('/^[a-f0-9]{64}$/', (string) ($site_a['key'] ?? '')) === 1
        && preg_match('/^[a-f0-9]{64}$/', (string) ($site_b['key'] ?? '')) === 1
        && $site_a['key'] !== $site_b['key'],
    'cada site deve ter chave canônica e isolada'
);
$context_a = kodety_search_console_invoke($search_console, 'secret_context', 'refresh-token', $site_a);
$context_b = kodety_search_console_invoke($search_console, 'secret_context', 'refresh-token', $site_b);
kodety_search_console_assert(
    is_string($context_a) && is_string($context_b) && $context_a !== $context_b,
    'a chave de cifragem de credenciais deve incluir o site'
);
$refresh_a = $encrypt->invoke($search_console, 'refresh-alpha', $context_a);
$refresh_b = $encrypt->invoke($search_console, 'refresh-beta', $context_b);
kodety_search_console_assert(
    is_string($refresh_a)
        && is_string($refresh_b)
        && $decrypt->invoke($search_console, $refresh_a, $context_a) === 'refresh-alpha'
        && $decrypt->invoke($search_console, $refresh_a, $context_b) instanceof WP_Error,
    'ciphertext de um site não pode ser reutilizado por outro'
);
kodety_search_console_assert(
    kodety_search_console_invoke($search_console, 'save_credential', $site_a, [
        'refresh_token' => $refresh_a,
        'account_email' => 'alpha@example.test',
    ]) === true
        && kodety_search_console_invoke($search_console, 'save_credential', $site_b, [
            'refresh_token' => $refresh_b,
            'account_email' => 'beta@example.test',
        ]) === true,
    'credenciais isoladas devem ser persistidas por site'
);
$credential_a = kodety_search_console_invoke($search_console, 'credential', $site_a);
$credential_b = kodety_search_console_invoke($search_console, 'credential', $site_b);
kodety_search_console_assert(
    ($credential_a['account_email'] ?? '') === 'alpha@example.test'
        && ($credential_b['account_email'] ?? '') === 'beta@example.test'
        && ($credential_a['refresh_token'] ?? '') !== ($credential_b['refresh_token'] ?? ''),
    'um projeto não pode ler a conta ou refresh token de outro projeto'
);
$credential_prefix = (string) $reflection->getConstant('OPTION_CREDENTIAL_PREFIX');
kodety_search_console_assert(
    isset($kodety_search_console_options[$credential_prefix . $site_a['key']])
        && isset($kodety_search_console_options[$credential_prefix . $site_b['key']])
        && !isset($kodety_search_console_options[$credential_prefix]),
    'credenciais não podem usar uma opção global compartilhada'
);
$oauth_option_before_active_conflicts = $kodety_search_console_options[$oauth_client_option] ?? null;
$replace_active_oauth = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => 'replacement-runtime-client.apps.googleusercontent.com',
    'clientSecret' => 'replacement-runtime-secret',
]));
$delete_active_oauth = $search_console->rest_delete_oauth_client();
kodety_search_console_assert(
    $replace_active_oauth instanceof WP_Error
        && (int) (($replace_active_oauth->get_error_data()['status'] ?? 0)) === 409
        && $delete_active_oauth instanceof WP_Error
        && (int) (($delete_active_oauth->get_error_data()['status'] ?? 0)) === 409
        && ($kodety_search_console_options[$oauth_client_option] ?? null) === $oauth_option_before_active_conflicts,
    'trocar ou remover o OAuth client deve retornar 409 enquanto houver refresh tokens conectados'
);

kodety_search_console_invoke($search_console, 'cache_access_token', $site_a, 'ya29.alpha-access', 3600);
kodety_search_console_invoke($search_console, 'cache_access_token', $site_b, 'ya29.beta-access', 3600);
kodety_search_console_assert(
    kodety_search_console_invoke($search_console, 'cached_access_token', $site_a) === 'ya29.alpha-access'
        && kodety_search_console_invoke($search_console, 'cached_access_token', $site_b) === 'ya29.beta-access',
    'cache de access token deve ser isolado por site'
);
$access_prefix = (string) $reflection->getConstant('TRANSIENT_ACCESS_TOKEN_PREFIX');
$access_a_key = $access_prefix . $site_a['key'];
$access_b_key = $access_prefix . $site_b['key'];
kodety_search_console_assert(
    isset($kodety_search_console_transients[$access_a_key], $kodety_search_console_transients[$access_b_key])
        && !str_contains((string) $kodety_search_console_transients[$access_a_key], 'ya29.alpha-access')
        && !str_contains((string) $kodety_search_console_transients[$access_b_key], 'ya29.beta-access'),
    'access tokens devem ficar cifrados em caches distintos'
);
$original_b_ciphertext = $kodety_search_console_transients[$access_b_key];
$kodety_search_console_transients[$access_b_key] = $kodety_search_console_transients[$access_a_key];
kodety_search_console_assert(
    kodety_search_console_invoke($search_console, 'cached_access_token', $site_b) === '',
    'access token cifrado para um site deve falhar fechado em outro'
);
$kodety_search_console_transients[$access_b_key] = $original_b_ciphertext;

$inspection_limit = (int) $reflection->getConstant('INSPECTION_MAX_PER_DAY');
$reserved_a = kodety_search_console_invoke($search_console, 'reserve_inspection_slots', $site_a, PHP_INT_MAX);
$reserved_b = kodety_search_console_invoke($search_console, 'reserve_inspection_slots', $site_b, 3);
$inspection_prefix = (string) $reflection->getConstant('OPTION_INSPECTION_USAGE_PREFIX');
kodety_search_console_assert(
    $reserved_a === $inspection_limit
        && $reserved_b === 3
        && ($kodety_search_console_options[$inspection_prefix . $site_a['key']]['count'] ?? 0) === $inspection_limit
        && ($kodety_search_console_options[$inspection_prefix . $site_b['key']]['count'] ?? 0) === 3,
    'quota de URL Inspection deve ser limitada e contabilizada separadamente por site'
);

$lock_site_key = str_repeat('a', 64);
$lock_owner = kodety_search_console_invoke($search_console, 'acquire_sync_lock', $lock_site_key);
kodety_search_console_assert(
    is_string($lock_owner) && strlen($lock_owner) >= 16,
    'lock de sync deve ter proprietário imprevisível'
);
$parallel_site_key = str_repeat('b', 64);
$parallel_owner = kodety_search_console_invoke($search_console, 'acquire_sync_lock', $parallel_site_key);
kodety_search_console_assert(
    is_string($parallel_owner),
    'sites diferentes devem poder sincronizar sem compartilhar o mesmo lock'
);
kodety_search_console_invoke($search_console, 'release_sync_lock', $parallel_site_key, $parallel_owner);
$busy_lock = kodety_search_console_invoke($search_console, 'acquire_sync_lock', $lock_site_key);
kodety_search_console_assert(
    $busy_lock instanceof WP_Error && (int) (($busy_lock->get_error_data()['status'] ?? 0)) === 409,
    'segundo sync concorrente deve receber conflito'
);
kodety_search_console_invoke($search_console, 'release_sync_lock', $lock_site_key, 'not-the-owner');
$still_busy = kodety_search_console_invoke($search_console, 'acquire_sync_lock', $lock_site_key);
kodety_search_console_assert(
    $still_busy instanceof WP_Error,
    'um processo não pode liberar o lock de outro proprietário'
);
kodety_search_console_invoke($search_console, 'release_sync_lock', $lock_site_key, $lock_owner);
$next_owner = kodety_search_console_invoke($search_console, 'acquire_sync_lock', $lock_site_key);
kodety_search_console_assert(is_string($next_owner), 'o proprietário correto deve liberar o próximo sync');
kodety_search_console_invoke($search_console, 'release_sync_lock', $lock_site_key, $next_owner);

$current_site = kodety_search_console_invoke($search_console, 'current_site');
$current_context = kodety_search_console_invoke($search_console, 'secret_context', 'refresh-token', $current_site);
$current_refresh = $encrypt->invoke($search_console, 'refresh-current', $current_context);
kodety_search_console_assert(is_string($current_refresh), 'fixture atual deve cifrar a credencial');
kodety_search_console_assert(
    kodety_search_console_invoke($search_console, 'save_credential', $current_site, [
        'refresh_token' => $current_refresh,
        'account_email' => 'current@example.test',
        'properties' => [
            ['url' => 'https://example.test/', 'permissionLevel' => 'siteOwner'],
            ['url' => 'https://example.test/shop/', 'permissionLevel' => 'siteOwner'],
        ],
    ]) === true
        && kodety_search_console_invoke($search_console, 'save_site_state', $current_site, [
            'property' => 'https://example.test/',
            'sync_status' => 'success',
            'sync_generation' => 0,
            'completed_generation' => 0,
        ]) === true,
    'fixture atual deve possuir conexão e propriedade antes da corrida'
);
$active_worker = kodety_search_console_invoke($search_console, 'acquire_sync_lock', $current_site['key']);
kodety_search_console_assert(is_string($active_worker), 'fixture deve representar worker pesado ativo');
$queued_sync = $search_console->rest_sync(new WP_REST_Request(['inspectLimit' => 2]));
$first_generation_state = kodety_search_console_invoke($search_console, 'site_state', $current_site);
$first_generation = (int) ($first_generation_state['sync_generation'] ?? 0);
kodety_search_console_assert(
    $queued_sync instanceof WP_REST_Response
        && $queued_sync->get_status() === 202
        && $first_generation > 0
        && ($first_generation_state['sync_status'] ?? '') === 'queued',
    'refresh manual deve permanecer async 202 e gerar job mesmo com worker pesado ativo'
);
$selected = $search_console->rest_select_property(new WP_REST_Request([
    'property' => 'https://example.test/shop/',
]));
$selected_state = kodety_search_console_invoke($search_console, 'site_state', $current_site);
$selected_generation = (int) ($selected_state['sync_generation'] ?? 0);
kodety_search_console_assert(
    $selected instanceof WP_REST_Response
        && $selected_generation > $first_generation
        && ($selected_state['property'] ?? '') === 'https://example.test/shop/'
        && ($selected_state['sync_status'] ?? '') === 'queued',
    'seleção de propriedade concorrente deve criar geração nova sem esperar o worker pesado'
);
$superseded = kodety_search_console_invoke(
    $search_console,
    'finish_sync_snapshot',
    $current_site,
    'https://example.test/',
    $first_generation,
    true,
    ''
);
$preserved_state = kodety_search_console_invoke($search_console, 'site_state', $current_site);
kodety_search_console_assert(
    is_array($superseded)
        && ($superseded['superseded'] ?? false) === true
        && ($superseded['queued'] ?? false) === true
        && ($preserved_state['sync_generation'] ?? 0) === $selected_generation
        && ($preserved_state['property'] ?? '') === 'https://example.test/shop/'
        && ($preserved_state['sync_status'] ?? '') === 'queued',
    'worker antigo não pode sobrescrever nem limpar a geração/propriedade nova'
);
$new_snapshot = kodety_search_console_invoke($search_console, 'begin_sync_snapshot', $current_site, 3);
kodety_search_console_assert(
    is_array($new_snapshot)
        && ($new_snapshot['generation'] ?? 0) === $selected_generation
        && ($new_snapshot['property'] ?? '') === 'https://example.test/shop/',
    'próximo worker deve consumir a geração e propriedade preservadas'
);
$current_finish = kodety_search_console_invoke(
    $search_console,
    'finish_sync_snapshot',
    $current_site,
    'https://example.test/shop/',
    $selected_generation,
    true,
    ''
);
$completed_state = kodety_search_console_invoke($search_console, 'site_state', $current_site);
kodety_search_console_assert(
    is_array($current_finish)
        && ($current_finish['superseded'] ?? true) === false
        && ($completed_state['completed_generation'] ?? 0) === $selected_generation
        && ($completed_state['sync_status'] ?? '') === 'success',
    'somente o worker da geração atual pode concluir e limpar o job'
);
kodety_search_console_invoke($search_console, 'release_sync_lock', $current_site['key'], $active_worker);

$connection_revision_before_disconnect = kodety_search_console_invoke(
    $search_console,
    'connection_revision',
    $current_site['key']
);
$pre_disconnect_oauth_record = [
    'oauth_client_revision' => kodety_search_console_invoke($search_console, 'oauth_client_revision'),
    'connection_revision' => $connection_revision_before_disconnect,
];
kodety_search_console_assert(
    kodety_search_console_invoke(
        $search_console,
        'oauth_state_revisions_current',
        $pre_disconnect_oauth_record,
        $current_site
    ) === true,
    'fixture de corrida OAuth deve começar na revisão atual da conexão'
);
$disconnect_lock_option = (string) $reflection->getConstant('OPTION_SYNC_LOCK_PREFIX') . $current_site['key'];
$disconnect_worker = kodety_search_console_invoke($search_console, 'acquire_sync_lock', $current_site['key']);
$disconnect_busy = $search_console->rest_disconnect();
kodety_search_console_assert(
    is_string($disconnect_worker)
        && $disconnect_busy instanceof WP_Error
        && (int) (($disconnect_busy->get_error_data()['status'] ?? 0)) === 409
        && ($kodety_search_console_options[$disconnect_lock_option]['owner'] ?? '') === $disconnect_worker
        && kodety_search_console_invoke($search_console, 'connection_revision', $current_site['key'])
            === $connection_revision_before_disconnect,
    'disconnect ocupado não pode revogar dados, remover o lock nem avançar a revisão'
);
kodety_search_console_invoke($search_console, 'release_sync_lock', $current_site['key'], $disconnect_worker);
$disconnect_complete = $search_console->rest_disconnect();
$connection_revision_after_disconnect = kodety_search_console_invoke(
    $search_console,
    'connection_revision',
    $current_site['key']
);
$superseded_by_disconnect = kodety_search_console_invoke(
    $search_console,
    'oauth_state_revisions_current',
    $pre_disconnect_oauth_record,
    $current_site
);
kodety_search_console_assert(
    $disconnect_complete instanceof WP_REST_Response
        && !isset($kodety_search_console_options[$disconnect_lock_option])
        && $connection_revision_after_disconnect === $connection_revision_before_disconnect + 1
        && isset($kodety_search_console_options[$connection_revision_prefix . $current_site['key']])
        && ($kodety_search_console_option_autoloads[$connection_revision_prefix . $current_site['key']] ?? null) === false
        && $superseded_by_disconnect instanceof WP_Error
        && (int) (($superseded_by_disconnect->get_error_data()['status'] ?? 0)) === 409,
    'disconnect concluído deve manter tombstone monotônico e invalidar callback tardio do site'
);

// The two isolation fixtures are no longer needed. Remove their refresh
// credentials so the following assertions can exercise an actual OAuth-client
// cleanup rather than the expected active-connection conflict above.
delete_option($credential_prefix . $site_a['key']);
delete_option($credential_prefix . $site_b['key']);
update_option((string) $reflection->getConstant('OPTION_SITE_INDEX'), [], false);
Kodety_Edition::$advanced_seo = false;
$oauth_client_revision_before_delete = kodety_search_console_invoke(
    $search_console,
    'oauth_client_revision'
);
$unlicensed_oauth_delete_permission = $oauth_delete_permission(
    new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce'])
);
$unlicensed_oauth_delete = $search_console->rest_delete_oauth_client();
$unlicensed_oauth_delete_data = kodety_search_console_data($unlicensed_oauth_delete);
kodety_search_console_assert(
    $unlicensed_oauth_delete_permission === true
        && $unlicensed_oauth_delete instanceof WP_REST_Response
        && is_array($unlicensed_oauth_delete_data)
        && ($unlicensed_oauth_delete_data['configured'] ?? true) === false
        && !isset($kodety_search_console_options[$oauth_client_option])
        && kodety_search_console_invoke($search_console, 'oauth_client_revision')
            === $oauth_client_revision_before_delete + 1,
    'gestor deve remover OAuth sem Pro e avançar a revisão global contra callback tardio'
);
Kodety_Edition::$advanced_seo = true;

$stored_fallback_id = 'stored-fallback-client.apps.googleusercontent.com';
$stored_fallback_secret = 'stored-fallback-secret';
$stored_fallback_response = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => $stored_fallback_id,
    'clientSecret' => $stored_fallback_secret,
]));
kodety_search_console_assert(
    $stored_fallback_response instanceof WP_REST_Response,
    'fixture deve restaurar uma configuração local antes do teste de override'
);
$stored_fallback_option = $kodety_search_console_options[$oauth_client_option] ?? null;
define('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID', 'runtime-constant.apps.googleusercontent.com');
define('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET', 'runtime-constant-secret');
$constant_credentials = kodety_search_console_invoke($search_console, 'client_credentials');
$constant_configuration = kodety_search_console_data($search_console->rest_get_oauth_client());
$serialized_constant_configuration = json_encode($constant_configuration, JSON_UNESCAPED_SLASHES);
kodety_search_console_assert(
    is_array($constant_credentials)
        && ($constant_credentials['client_id'] ?? '') === KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID
        && ($constant_credentials['client_secret'] ?? '') === KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET
        && is_array($constant_configuration)
        && ($constant_configuration['configured'] ?? false) === true
        && ($constant_configuration['source'] ?? '') === 'server'
        && ($constant_configuration['managedExternally'] ?? false) === true
        && ($constant_configuration['editable'] ?? true) === false
        && ($constant_configuration['hasClientSecret'] ?? false) === true
        && ($constant_configuration['callbackUsable'] ?? false) === true
        && is_string($serialized_constant_configuration)
        && !str_contains($serialized_constant_configuration, KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID)
        && !str_contains($serialized_constant_configuration, KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET)
        && ($kodety_search_console_options[$oauth_client_option] ?? null) === $stored_fallback_option,
    'constantes devem prevalecer sem apagar a opção local e devem ser reportadas como configuração externa redigida'
);
$managed_oauth_update = $search_console->rest_save_oauth_client(new WP_REST_Request([], [], [
    'clientId' => 'ignored-client.apps.googleusercontent.com',
    'clientSecret' => 'ignored-secret',
]));
kodety_search_console_assert(
    $managed_oauth_update instanceof WP_Error
        && (int) (($managed_oauth_update->get_error_data()['status'] ?? 0)) === 409,
    'configuração gerenciada pelo servidor não pode ser sobrescrita pelo WordPress'
);

$connect_endpoints = kodety_search_console_route_endpoints(
    $kodety_search_console_routes['kodety/v1/seo/search-console/connect']
);
$connect_callback = $connect_endpoints[0]['callback'];
$connect = $connect_callback(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_search_console_assert(!($connect instanceof WP_Error), 'connect deve produzir a autorização quando credenciais existem');
$connect_data = kodety_search_console_data($connect);
$authorization_url = is_array($connect_data)
    ? (string) ($connect_data['authorizationUrl'] ?? $connect_data['authUrl'] ?? '')
    : '';
kodety_search_console_assert($authorization_url !== '', 'connect deve retornar apenas a URL de autorização');
$authorization_parts = parse_url($authorization_url);
parse_str((string) ($authorization_parts['query'] ?? ''), $authorization_query);
kodety_search_console_assert(
    ($authorization_parts['scheme'] ?? '') === 'https'
        && ($authorization_parts['host'] ?? '') === 'accounts.google.com'
        && ($authorization_parts['path'] ?? '') === '/o/oauth2/v2/auth',
    'autorização deve usar somente o endpoint fixo do Google'
);
kodety_search_console_assert(
    in_array('https://www.googleapis.com/auth/webmasters.readonly', preg_split('/\\s+/', (string) ($authorization_query['scope'] ?? '')) ?: [], true)
        && ($authorization_query['client_id'] ?? '') === KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID
        && ($authorization_query['response_type'] ?? '') === 'code'
        && ($authorization_query['access_type'] ?? '') === 'offline'
        && ($authorization_query['code_challenge_method'] ?? '') === 'S256'
        && strlen((string) ($authorization_query['code_challenge'] ?? '')) >= 43
        && strlen((string) ($authorization_query['state'] ?? '')) >= 32,
    'OAuth deve usar menor privilégio, offline access, state forte e PKCE S256'
);
$serialized_connect = json_encode($connect_data, JSON_UNESCAPED_SLASHES);
kodety_search_console_assert(
    is_string($serialized_connect)
        && !str_contains($serialized_connect, 'code_verifier')
        && !str_contains($serialized_connect, KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET)
        && !str_contains($serialized_connect, $stored_fallback_secret),
    'verifier e client secret não podem chegar ao navegador'
);
$oauth_options = array_filter(
    $kodety_search_console_options,
    static fn (string $key): bool => str_starts_with($key, 'kodety_search_console_oauth_'),
    ARRAY_FILTER_USE_KEY
);
kodety_search_console_assert((bool) $oauth_options, 'state/verifier devem ficar no servidor');
$transient_payload = json_encode($oauth_options, JSON_UNESCAPED_SLASHES);
kodety_search_console_assert(
    is_string($transient_payload)
        && str_contains($transient_payload, 'verifier')
        && !str_contains($transient_payload, (string) ($authorization_query['code_challenge'] ?? '')),
    'servidor deve persistir o verifier original, não apenas o challenge público'
);
kodety_search_console_assert(
    (int) $reflection->getConstant('OAUTH_TTL') > 0
        && (int) $reflection->getConstant('OAUTH_TTL') <= 15 * MINUTE_IN_SECONDS,
    'state OAuth deve expirar em até 15 minutos'
);

$status_endpoints = kodety_search_console_route_endpoints(
    $kodety_search_console_routes['kodety/v1/seo/search-console/status']
);
$status_callback = $status_endpoints[0]['callback'];
$status = $status_callback(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_search_console_assert(!($status instanceof WP_Error), 'status deve responder sem consultar endpoints arbitrários');
$status_data = kodety_search_console_data($status);
$serialized_status = json_encode($status_data, JSON_UNESCAPED_SLASHES);
kodety_search_console_assert(
    is_string($serialized_status)
        && !str_contains($serialized_status, $secret)
        && !str_contains($serialized_status, KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET)
        && !str_contains($serialized_status, $stored_fallback_secret)
        && !preg_match('/["\'](?:access|refresh)[_-]?token["\']\s*:/i', $serialized_status),
    'status público administrativo deve redigir tokens e segredos'
);

$backend_source = file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-search-console.php');
$callback_start = is_string($backend_source)
    ? strpos($backend_source, 'public function handle_oauth_callback(): void')
    : false;
$callback_end = is_string($backend_source) && $callback_start !== false
    ? strpos($backend_source, 'public function cron_sync(): void', $callback_start)
    : false;
$callback_source = is_string($backend_source) && $callback_start !== false && $callback_end !== false
    ? substr($backend_source, $callback_start, $callback_end - $callback_start)
    : '';
$global_lock_position = strpos(
    $callback_source,
    '$global_owner = $this->acquire_state_lock($global_lock_key);'
);
$site_lock_position = $global_lock_position !== false
    ? strpos($callback_source, '$state_owner = $this->acquire_state_lock($site[\'key\']);', $global_lock_position)
    : false;
$revision_check_position = $site_lock_position !== false
    ? strpos($callback_source, '$this->oauth_state_revisions_current($record, $site)', $site_lock_position)
    : false;
$credential_save_position = $revision_check_position !== false
    ? strpos($callback_source, '$this->save_credential($site, $credential)', $revision_check_position)
    : false;
$site_lock_release_position = $credential_save_position !== false
    ? strpos(
        $callback_source,
        '$this->release_state_lock($site[\'key\'], $state_owner);',
        $credential_save_position
    )
    : false;
$global_lock_release_position = $site_lock_release_position !== false
    ? strpos(
        $callback_source,
        '$this->release_state_lock($global_lock_key, $global_owner);',
        $site_lock_release_position
    )
    : false;
$stale_error_position = $global_lock_release_position !== false
    ? strpos($callback_source, 'if (is_wp_error($persistence_error))', $global_lock_release_position)
    : false;
$stale_revoke_position = $stale_error_position !== false
    ? strpos($callback_source, '$this->revoke_token($refresh_token);', $stale_error_position)
    : false;
$stale_access_fallback_position = $stale_revoke_position !== false
    ? strpos($callback_source, '$this->revoke_token($access_token);', $stale_revoke_position)
    : false;
kodety_search_console_assert(
    $global_lock_position !== false
        && $site_lock_position !== false
        && $revision_check_position !== false
        && $credential_save_position !== false
        && $site_lock_release_position !== false
        && $global_lock_release_position !== false
        && $stale_error_position !== false
        && $stale_revoke_position !== false
        && $stale_access_fallback_position !== false
        && $global_lock_position < $site_lock_position
        && $site_lock_position < $revision_check_position
        && $revision_check_position < $credential_save_position
        && $credential_save_position < $site_lock_release_position
        && $site_lock_release_position < $global_lock_release_position
        && $global_lock_release_position < $stale_error_position
        && $stale_error_position < $stale_revoke_position
        && $stale_revoke_position < $stale_access_fallback_position,
    'callback deve revalidar sob locks, persistir bloqueado e revogar refresh stale com fallback access'
);

fwrite(STDOUT, "Search Console runtime: routes, Pro gate, OAuth callback safety, broker discovery, revision races, PKCE, encryption, site isolation, quotas, locks and redaction verified.\n");
