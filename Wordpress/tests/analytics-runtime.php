<?php

/**
 * Isolated contracts for Kodety first-party analytics.
 *
 * Run with: php Wordpress/tests/analytics-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('COOKIEPATH', '/');
define('COOKIE_DOMAIN', '');
define('ARRAY_A', 'ARRAY_A');

final class WP_Error {
    public function __construct(private string $code, private string $message = '', private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Request implements ArrayAccess {
    private array $params;
    private array $headers;
    private array $json;
    public function __construct(mixed $params = [], mixed $headers = [], array $json = []) {
        // WordPress uses (method, route) while this harness also accepts the
        // compact (params, headers, json) form used by existing tests.
        if (is_string($params) && is_string($headers)) {
            $params = [];
            $headers = [];
        }
        $this->params = is_array($params) ? $params : [];
        $this->headers = is_array($headers) ? $headers : [];
        $this->json = $json;
        $this->headers = array_change_key_case($this->headers, CASE_LOWER);
    }
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
    public function get_header(string $name): string { return (string) ($this->headers[strtolower($name)] ?? ''); }
    public function set_header(string $name, string $value): void { $this->headers[strtolower($name)] = $value; }
    public function get_json_params(): array { return $this->json; }
    public function offsetExists(mixed $offset): bool { return isset($this->params[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->params[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->params[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->params[$offset]); }
}

final class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
}

final class WP {
    public function __construct(public array $query_vars = []) {}
}

final class Kodety_Edition {
    public static bool $licensed = true;

    public static function is_licensed(): bool { return self::$licensed; }
    public static function has(string $feature): bool {
        return $feature === 'analytics' || self::$licensed;
    }
    public static function limit(string $name): ?int {
        return $name === 'analyticsHistoryDays' && !self::$licensed ? 7 : null;
    }
    public static function license_url(): string { return 'https://example.test/wp-admin/admin.php?page=kodety-license'; }
    public static function upgrade_url(): string { return 'https://dash.kodety.com/'; }
}

final class Kodety_Plugin {
    public static ?array $studio_runtime = null;
    private static ?self $instance = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    public function browser_studio_runtime(): ?array {
        return self::$studio_runtime;
    }
}

$kodety_analytics_options = ['kodety_analytics_enabled' => '1'];
$kodety_analytics_transients = [];
$kodety_analytics_caps = ['kodety_manage_analytics' => true];
$kodety_analytics_logged_in = true;
$kodety_analytics_theme_dir = '';
$kodety_analytics_is_admin = false;
$kodety_analytics_http_requests = [];
$kodety_analytics_actions = [];
$kodety_analytics_private_runtime_root = '';
$kodety_analytics_upload_dir = sys_get_temp_dir() . '/kodety-analytics-public-uploads';
$kodety_analytics_site_timezone = new DateTimeZone('UTC');
$kodety_analytics_geo_filter = null;

final class Kodety_Analytics_Test_Theme {
    public function __construct(private string $directory) {}
    public function exists(): bool { return $this->directory !== '' && is_dir($this->directory); }
    public function get_stylesheet_directory(): string { return $this->directory; }
}

function add_action(...$args): void {}
function add_filter(...$args): void {}
function apply_filters(string $hook, mixed $value, mixed ...$args): mixed {
    global $kodety_analytics_private_runtime_root, $kodety_analytics_geo_filter;
    if ($hook === 'kodety_analytics_geo_context' && is_callable($kodety_analytics_geo_filter)) {
        return $kodety_analytics_geo_filter($value, ...$args);
    }
    return $hook === 'kodety_analytics_private_runtime_root'
        && $kodety_analytics_private_runtime_root !== ''
        ? $kodety_analytics_private_runtime_root
        : $value;
}
function get_option(string $name, mixed $default = false): mixed { global $kodety_analytics_options; return $kodety_analytics_options[$name] ?? $default; }
function update_option(string $name, mixed $value, mixed $autoload = null): bool { global $kodety_analytics_options; $kodety_analytics_options[$name] = $value; return true; }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_\-]/', '', strtolower($value)) ?: ''; }
function sanitize_title(string $value): string { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($value)) ?: '', '-'); }
function sanitize_text_field(string $value): string { return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? '')); }
function sanitize_email(string $value): string { return filter_var(trim($value), FILTER_SANITIZE_EMAIL) ?: ''; }
function is_email(string $value): bool { return filter_var($value, FILTER_VALIDATE_EMAIL) !== false; }
function esc_url_raw(string $value, ?array $protocols = null): string {
    if (filter_var($value, FILTER_VALIDATE_URL) === false) return '';
    $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));
    return $protocols !== null && !in_array($scheme, $protocols, true) ? '' : $value;
}
function wp_http_validate_url(string $value): string|false {
    $host = strtolower((string) parse_url($value, PHP_URL_HOST));
    return filter_var($value, FILTER_VALIDATE_URL) !== false
        && $host !== ''
        && !in_array($host, ['localhost', '127.0.0.1', '::1'], true)
        ? $value
        : false;
}
function rest_sanitize_boolean(mixed $value): bool { return filter_var($value, FILTER_VALIDATE_BOOLEAN); }
function absint(mixed $value): int { return abs((int) $value); }
function wp_generate_uuid4(): string { return '12345678-1234-4abc-8def-123456789abc'; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function wp_parse_str(string $value, array &$result): void { parse_str($value, $result); }
function wp_unslash(mixed $value): mixed {
    return is_array($value)
        ? array_map('wp_unslash', $value)
        : (is_string($value) ? stripslashes($value) : $value);
}
function add_query_arg(array $args, string $url): string {
    $separator = str_contains($url, '?') ? '&' : '?';
    return $args ? $url . $separator . http_build_query($args, '', '&', PHP_QUERY_RFC3986) : $url;
}
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function wp_salt(string $scheme = 'auth'): string { return 'analytics-test-salt-' . $scheme; }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function get_transient(string $key): mixed { global $kodety_analytics_transients; return $kodety_analytics_transients[$key] ?? false; }
function set_transient(string $key, mixed $value, int $ttl): bool { global $kodety_analytics_transients; $kodety_analytics_transients[$key] = $value; return true; }
function current_user_can(string $capability): bool { global $kodety_analytics_caps; return !empty($kodety_analytics_caps[$capability]); }
function is_user_logged_in(): bool { global $kodety_analytics_logged_in; return $kodety_analytics_logged_in; }
function wp_verify_nonce(string $nonce, string $action): bool { return $nonce === 'valid-rest-nonce' && $action === 'wp_rest'; }
function get_current_user_id(): int { return 7; }
function is_admin(): bool { global $kodety_analytics_is_admin; return $kodety_analytics_is_admin; }
function rest_url(string $path): string { return 'https://example.test/wp-json/' . ltrim($path, '/'); }
function wp_mkdir_p(string $path): bool { return is_dir($path) || mkdir($path, 0777, true); }
function trailingslashit(string $path): string { return rtrim($path, '/\\') . '/'; }
function wp_upload_dir(): array { global $kodety_analytics_upload_dir; return ['basedir' => $kodety_analytics_upload_dir]; }
function wp_timezone(): DateTimeZone { global $kodety_analytics_site_timezone; return $kodety_analytics_site_timezone; }
function wp_get_theme(string $slug = ''): Kodety_Analytics_Test_Theme { global $kodety_analytics_theme_dir; return new Kodety_Analytics_Test_Theme($kodety_analytics_theme_dir); }
function get_stylesheet_directory(): string { global $kodety_analytics_theme_dir; return $kodety_analytics_theme_dir; }
function get_permalink(int $post_id): string { return $post_id === 42 ? 'https://example.test/' : ''; }
function add_rewrite_rule(...$args): void {}
function flush_rewrite_rules(bool $hard = true): void {}
function wp_safe_remote_request(string $url, array $args = []): array|WP_Error {
    global $kodety_analytics_http_requests;
    $kodety_analytics_http_requests[] = ['url' => $url, 'args' => $args];
    return ['response' => ['code' => 202]];
}
function wp_remote_retrieve_response_code(array|WP_Error $response): int {
    return is_array($response) ? (int) ($response['response']['code'] ?? 0) : 0;
}
function do_action(string $hook, mixed ...$args): void {
    global $kodety_analytics_actions;
    $kodety_analytics_actions[] = ['hook' => $hook, 'args' => $args];
}

final class KodetyAnalyticsRuntimeWpdb {
    public string $prefix = 'wp_';
    /** @var 'stored'|'duplicate'|'error' */
    public string $event_insert_result = 'stored';
    public bool $session_update_fails = false;
    public int $rollbacks = 0;
    public int $read_queries = 0;
    public ?array $variant_asset_row = null;

    public function prepare(string $query, mixed ...$args): string {
        return $query;
    }

    public function query(string|array $statement): int|false {
        $query = is_array($statement)
            ? (string) ($statement['query'] ?? '')
            : $statement;
        if ($query === 'START TRANSACTION' || $query === 'COMMIT') return 0;
        if ($query === 'ROLLBACK') {
            $this->rollbacks++;
            return 0;
        }
        if (str_contains($query, 'INSERT IGNORE INTO wp_kodety_analytics_events')) {
            return match ($this->event_insert_result) {
                'stored' => 1,
                'duplicate' => 0,
                default => false,
            };
        }
        if (str_contains($query, 'INSERT INTO wp_kodety_analytics_sessions')) {
            return $this->session_update_fails ? false : 1;
        }
        return 0;
    }

    public function get_row(string|array $query, mixed $format = null): ?array {
        $this->read_queries++;
        $query_text = is_array($query) ? (string) ($query['query'] ?? '') : $query;
        if (str_contains($query_text, 'SELECT experiments.external_id,variants.metadata')) {
            return $this->variant_asset_row;
        }
        return null;
    }

    public function get_results(string|array $query, mixed $format = null): array {
        $this->read_queries++;
        $query_text = is_array($query) ? (string) ($query['query'] ?? '') : $query;
        if (str_contains($query_text, 'SELECT tracking_id label')) {
            return [['label' => 'utm-private', 'value' => 99, 'uniques' => 9]];
        }
        return [];
    }

    public function get_var(string|array $query): int {
        $this->read_queries++;
        return 0;
    }
}

$wpdb = new KodetyAnalyticsRuntimeWpdb();

require dirname(__DIR__) . '/kodety/includes/class-kodety-analytics.php';
require dirname(__DIR__) . '/kodety/theme-runtime/functions.php';

function kodety_analytics_private(object $object, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($object, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke($object, ...$arguments);
}

function kodety_analytics_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_analytics_remove_tree(string $directory): void {
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

$reflection = new ReflectionClass(Kodety_Analytics::class);
$analytics = $reflection->newInstanceWithoutConstructor();

// Analytics continues to expose its own extensible geo context. Public locale
// routing deliberately does not call this resolver on the first page request.
$geo_filter_observation = [];
$_SERVER['HTTP_CF_IPCOUNTRY'] = 'BR';
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
$kodety_analytics_geo_filter = static function (
    array $context,
    WP_REST_Request $request,
    string $ip
) use (&$geo_filter_observation): array {
    $geo_filter_observation = [
        'header' => $request->get_header('CF-IPCountry'),
        'ip' => $ip,
        'initialCountry' => $context['country'] ?? '',
    ];
    return [...$context, 'country' => 'NL'];
};
$shared_geo = Kodety_Analytics::current_request_geo_context();
kodety_analytics_assert(
    ($shared_geo['country'] ?? '') === 'NL'
        && $geo_filter_observation === [
            'header' => 'BR',
            'ip' => '203.0.113.7',
            'initialCountry' => 'BR',
        ],
    'contexto geográfico atual deve reutilizar headers, IP efêmero e filtro do Analytics'
);
$kodety_analytics_geo_filter = null;
unset($_SERVER['HTTP_CF_IPCOUNTRY'], $_SERVER['REMOTE_ADDR']);

// A WordPress installed in a subdirectory may have dirname(ABSPATH) still
// below the web server's document root. That tempting sibling path must be
// rejected in favor of storage that is genuinely outside the public tree.
$previous_document_root = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
$_SERVER['DOCUMENT_ROOT'] = dirname(rtrim(ABSPATH, '/\\'));
unset($kodety_analytics_options['kodety_analytics_private_runtime_root']);
$subdirectory_private_root = kodety_analytics_private($analytics, 'private_runtime_base_root', true);
kodety_analytics_assert(
    !str_starts_with(
        str_replace('\\', '/', $subdirectory_private_root) . '/',
        rtrim(str_replace('\\', '/', $_SERVER['DOCUMENT_ROOT']), '/') . '/'
    ),
    'dirname(ABSPATH) dentro de DOCUMENT_ROOT deve ser rejeitado em instalações WordPress por subdiretório'
);
kodety_analytics_remove_tree($subdirectory_private_root);
unset($kodety_analytics_options['kodety_analytics_private_runtime_root']);
$_SERVER['DOCUMENT_ROOT'] = $previous_document_root;

$kodety_analytics_options['kodety_workspace_mode'] = 'agency';
$kodety_analytics_options['kodety_agency_active_project'] = 'project-admin';
$kodety_analytics_options['kodety_agency_projects'] = [
    'project-alpha' => ['slug' => 'alpha'],
    'project-root' => ['slug' => 'root', 'isRoot' => true],
];
$_SERVER['REQUEST_URI'] = '/alpha/pricing';
$scope_method = new ReflectionMethod(Kodety_Analytics::class, 'project_scope_key');
$scope_method->setAccessible(true);
kodety_analytics_assert(
    $scope_method->invoke(null) === 'project-alpha',
    'analytics público deve resolver o projeto pelo slug publicado'
);
$_SERVER['REQUEST_URI'] = '/wp-admin/admin.php?page=kodety-analytics';
$kodety_analytics_is_admin = true;
kodety_analytics_assert(
    $scope_method->invoke(null) === 'project-admin',
    'analytics administrativo deve usar somente o projeto aberto'
);
$kodety_analytics_is_admin = false;
$kodety_analytics_options['kodety_workspace_mode'] = 'single';
$_SERVER['REQUEST_URI'] = '/pricing';

$event_request = static fn(): WP_REST_Request => new WP_REST_Request([], [
    'Origin' => 'https://example.test',
    'User-Agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Safari/605',
], [
    'type' => 'pageview',
    'eventId' => 'event-abcdef0123456789',
    'sessionId' => 'session-abcdef0123456',
    'visitorId' => 'visitor-abcdef0123456',
    'pagePath' => '/pricing',
    'occurredAt' => gmdate('c'),
]);
$wpdb->event_insert_result = 'error';
$storage_failure = $analytics->collect($event_request());
kodety_analytics_assert(
    is_wp_error($storage_failure)
        && $storage_failure->get_error_code() === 'kodety_analytics_storage'
        && (int) ($storage_failure->get_error_data()['status'] ?? 0) === 503
        && $wpdb->rollbacks === 1,
    'erro real de INSERT deve reverter o lote e responder 5xx para permitir retry'
);
$wpdb->event_insert_result = 'duplicate';
$duplicate_response = $analytics->collect($event_request());
$duplicate_payload = $duplicate_response instanceof WP_REST_Response
    ? $duplicate_response->get_data()
    : [];
kodety_analytics_assert(
    $duplicate_response instanceof WP_REST_Response
        && $duplicate_response->get_status() === 202
        && ($duplicate_payload['accepted'] ?? -1) === 0
        && ($duplicate_payload['duplicates'] ?? -1) === 1,
    'somente conflito real de event_uuid deve ser contabilizado como duplicata'
);
$wpdb->event_insert_result = 'stored';
$wpdb->session_update_fails = true;
$session_failure = $analytics->collect($event_request());
kodety_analytics_assert(
    is_wp_error($session_failure)
        && $session_failure->get_error_code() === 'kodety_analytics_storage'
        && $wpdb->rollbacks === 2,
    'evento e agregado de sessão devem falhar atomicamente quando a sessão não persiste'
);
$wpdb->session_update_fails = false;

kodety_analytics_assert(
    kodety_analytics_private($analytics, 'variant_key', '  Hero / B! ') === 'hero-b',
    'IDs de variante devem ser estáveis e seguros para banco/cookie/caminho'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'tracking_id', 'cta hero:primary<script>') === 'cta-hero:primary',
    'tracking IDs devem aceitar hierarquia sem aceitar markup'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'sanitize_page_path', 'https://example.test/a//b/?secret=1') === '/a/b',
    'analytics deve descartar query strings potencialmente sensíveis'
);

// Sources: normalize www. and recognize internal referrers as direct traffic.
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'source_host', 'https://www.google.com/search?q=x') === 'google.com',
    'a fonte deve normalizar o prefixo www.'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'source_host', 'https://www.example.test/page') === ''
        && kodety_analytics_private($analytics, 'source_host', '') === '',
    'referrers internos e vazios contam como tráfego direto'
);

// Bot filtering keeps automated traffic out of the analytics store.
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'is_bot_request', new WP_REST_Request([], ['User-Agent' => 'Mozilla/5.0 (compatible; Googlebot/2.1)'], [])) === true
        && kodety_analytics_private($analytics, 'is_bot_request', new WP_REST_Request([], ['User-Agent' => ''], [])) === true,
    'crawlers e user-agents ausentes devem ser tratados como bots'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'is_bot_request', new WP_REST_Request([], ['User-Agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Safari/605'], [])) === false,
    'um navegador real não deve ser confundido com bot'
);

// Heartbeat: a ping is accepted without a tracking id and stays a liveness-only event.
$ping = kodety_analytics_private($analytics, 'sanitize_event', [
    'type' => 'ping',
    'sessionId' => 'session-abcdef0123456',
    'visitorId' => 'visitor-abcdef0123456',
    'pagePath' => '/pricing',
    'occurredAt' => gmdate('c'),
], new WP_REST_Request([], ['User-Agent' => 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537 Chrome/120 Safari/537'], []));
kodety_analytics_assert(
    is_array($ping) && $ping['event_type'] === 'ping' && $ping['tracking_id'] === '' && $ping['device_type'] === 'desktop',
    'um ping de heartbeat é aceito sem tracking id'
);
$scroll_event = kodety_analytics_private($analytics, 'sanitize_event', [
    'type' => 'scroll',
    'eventId' => 'scroll-event-abcdef012345',
    'sessionId' => 'session-abcdef0123456',
    'visitorId' => 'visitor-ephemeral-123456',
    'identitySource' => 'memory',
    'pagePath' => '/pricing',
    'scrollDepth' => 75,
    'viewportWidth' => 1440,
    'viewportHeight' => 820,
    'elementKey' => 'main > section:nth-of-type(2)',
    'browser' => 'Safari',
    'operatingSystem' => 'macOS',
    'timezone' => 'America/Sao_Paulo',
], new WP_REST_Request([], ['User-Agent' => 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Safari/605'], []));
kodety_analytics_assert(
    is_array($scroll_event)
        && str_starts_with((string) $scroll_event['visitor_id'], 'fallback-')
        && $scroll_event['scroll_depth'] === 75
        && $scroll_event['viewport_height'] === 820
        && $scroll_event['browser_name'] === 'Safari'
        && $scroll_event['operating_system'] === 'macOS'
        && $scroll_event['timezone_name'] === 'America/Sao_Paulo',
    'scroll, viewport e fallback first-party devem ser normalizados sem persistir IP bruto'
);
$sao_paulo_range = kodety_analytics_private(
    $analytics,
    'date_range',
    new WP_REST_Request([
        'from' => '2026-07-23',
        'to' => '2026-07-23',
        'timezone' => 'America/Sao_Paulo',
    ])
);
kodety_analytics_assert(
    $sao_paulo_range === ['2026-07-23 03:00:00', '2026-07-24 02:59:59'],
    'intervalos do dashboard devem respeitar os limites locais antes de consultar eventos UTC'
);

$metadata = kodety_analytics_private($analytics, 'sanitize_metadata', [
    'campaign' => 'summer',
    'email' => 'person@example.test',
    'ipAddress' => '203.0.113.4',
    'password_reset_token' => 'secret',
    'score' => 4,
    'nested' => ['not' => 'stored'],
]);
kodety_analytics_assert(($metadata['campaign'] ?? '') === 'summer', 'metadados escalares seguros devem sobreviver');
kodety_analytics_assert(($metadata['score'] ?? 0) === 4.0, 'métricas numéricas devem sobreviver');
kodety_analytics_assert(!isset($metadata['email'], $metadata['ipaddress'], $metadata['password_reset_token']), 'PII e segredos devem ser removidos');
kodety_analytics_assert(!isset($metadata['nested']), 'objetos livres não podem entrar no banco');

$funnel = kodety_analytics_private($analytics, 'sanitize_funnel_input', [
    'name' => 'Checkout',
    'windowMinutes' => 90,
    'steps' => [
        ['id' => 'landing', 'name' => 'Landing', 'type' => 'pageview', 'pagePath' => '/'],
        ['id' => 'buy', 'name' => 'Buy', 'type' => 'click', 'trackingId' => 'buy-now'],
        ['id' => 'bad', 'name' => 'Bad', 'type' => 'arbitrary'],
    ],
]);
kodety_analytics_assert(is_array($funnel) && count($funnel['steps']) === 2, 'funil deve manter somente tipos suportados');
kodety_analytics_assert($funnel['steps'][1]['trackingId'] === 'buy-now', 'etapa deve preservar tracking ID explícito');
kodety_analytics_assert(($funnel['window_minutes'] ?? -1) === 90, 'a janela de conversão deve ser sanitizada e preservada');
$legacy_campaign_funnel = kodety_analytics_private($analytics, 'sanitize_funnel_input', [
    'name' => 'Automação legada',
    'steps' => [[
        'id' => 'legacy-email',
        'name' => 'Campanha',
        'type' => 'email',
        'emailAction' => 'send-campaign',
        'emailCampaignId' => 91,
    ]],
]);
kodety_analytics_assert(
    is_array($legacy_campaign_funnel)
        && ($legacy_campaign_funnel['steps'][0]['emailAction'] ?? '') === 'upsert-contact'
        && !array_key_exists('emailCampaignId', $legacy_campaign_funnel['steps'][0]),
    'funis legados não podem reintroduzir disparo automático de campanha'
);
$webhook_funnel = kodety_analytics_private($analytics, 'sanitize_funnel_input', [
    'name' => 'Lead para CRM',
    'steps' => [
        ['id' => 'lead-form', 'name' => 'Lead', 'type' => 'submit', 'trackingId' => 'lead-form'],
        [
            'id' => 'send-crm',
            'name' => 'Enviar ao CRM',
            'type' => 'webhook',
            'webhookUrl' => 'https://hooks.example.test/kodety',
            'webhookMethod' => 'PATCH',
            'webhookPayloadMode' => 'fields',
            'webhookEvent' => 'lead.created',
            'webhookSecret' => 'signing-secret',
        ],
    ],
    'connections' => [[
        'id' => 'lead-to-crm',
        'sourceStepId' => 'lead-form',
        'targetStepId' => 'send-crm',
    ]],
]);
kodety_analytics_assert(
    is_array($webhook_funnel)
        && ($webhook_funnel['steps'][1]['type'] ?? '') === 'webhook'
        && ($webhook_funnel['steps'][1]['webhookMethod'] ?? '') === 'PATCH'
        && ($webhook_funnel['steps'][1]['webhookPayloadMode'] ?? '') === 'fields'
        && str_starts_with(
            (string) ($webhook_funnel['steps'][1]['webhookSecretEncrypted'] ?? ''),
            'v1.'
        )
        && !str_contains(
            (string) ($webhook_funnel['steps'][1]['webhookSecretEncrypted'] ?? ''),
            'signing-secret'
        ),
    'webhook de funil deve validar opções e criptografar o segredo antes de persistir'
);
$encrypted_webhook_secret = (string) $webhook_funnel['steps'][1]['webhookSecretEncrypted'];
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'decrypt_funnel_webhook_secret', $encrypted_webhook_secret) === 'signing-secret',
    'segredo HMAC de webhook deve completar o round-trip criptográfico'
);
$preserved_webhook = kodety_analytics_private($analytics, 'sanitize_funnel_input', [
    'name' => 'Lead para CRM',
    'steps' => [[
        'id' => 'send-crm',
        'name' => 'Enviar ao CRM',
        'type' => 'webhook',
        'webhookUrl' => 'https://hooks.example.test/kodety',
        'webhookMethod' => 'POST',
        'webhookPayloadMode' => 'submission',
        'webhookEvent' => 'lead.updated',
        'webhookSecret' => '',
    ]],
], $webhook_funnel['steps']);
kodety_analytics_assert(
    is_array($preserved_webhook)
        && ($preserved_webhook['steps'][0]['webhookSecretEncrypted'] ?? '') === $encrypted_webhook_secret,
    'salvar sem preencher a senha deve preservar o segredo de webhook existente'
);
$cleared_webhook = kodety_analytics_private($analytics, 'sanitize_funnel_input', [
    'name' => 'Lead para CRM',
    'steps' => [[
        'id' => 'send-crm',
        'name' => 'Enviar ao CRM',
        'type' => 'webhook',
        'webhookUrl' => 'https://hooks.example.test/kodety',
        'webhookSecretClear' => true,
    ]],
], $webhook_funnel['steps']);
kodety_analytics_assert(
    is_array($cleared_webhook)
        && ($cleared_webhook['steps'][0]['webhookSecretEncrypted'] ?? 'missing') === '',
    'remoção explícita deve apagar o segredo salvo do webhook'
);
$invalid_webhook = kodety_analytics_private($analytics, 'sanitize_funnel_input', [
    'name' => 'Webhook inseguro',
    'steps' => [[
        'id' => 'unsafe',
        'name' => 'Inseguro',
        'type' => 'webhook',
        'webhookUrl' => 'http://127.0.0.1/admin',
    ]],
]);
kodety_analytics_assert(
    is_wp_error($invalid_webhook)
        && $invalid_webhook->get_error_code() === 'kodety_funnel_webhook_url',
    'webhooks devem rejeitar HTTP e endereços locais'
);
$formatted_webhook = kodety_analytics_private($analytics, 'format_funnel', [
    'id' => 19,
    'name' => 'Lead para CRM',
    'status' => 'active',
    'steps_json' => wp_json_encode($webhook_funnel['steps']),
    'filters_json' => wp_json_encode(['items' => [], 'settings' => []]),
    'created_at' => '2026-07-30 12:00:00',
    'updated_at' => '2026-07-30 12:00:00',
]);
kodety_analytics_assert(
    ($formatted_webhook['steps'][1]['webhookSecretConfigured'] ?? false) === true
        && ($formatted_webhook['steps'][1]['webhookSecret'] ?? null) === ''
        && !array_key_exists('webhookSecretEncrypted', $formatted_webhook['steps'][1]),
    'API do funil deve informar a existência do segredo sem devolver texto ou cifra'
);
$kodety_analytics_caps['kodety_manage_analytics'] = false;
$redacted_webhook = kodety_analytics_private($analytics, 'format_funnel', [
    'id' => 19,
    'name' => 'Lead para CRM',
    'status' => 'active',
    'steps_json' => wp_json_encode($webhook_funnel['steps']),
    'filters_json' => wp_json_encode(['items' => [], 'settings' => []]),
    'created_at' => '2026-07-30 12:00:00',
    'updated_at' => '2026-07-30 12:00:00',
]);
$kodety_analytics_caps['kodety_manage_analytics'] = true;
kodety_analytics_assert(
    ($redacted_webhook['steps'][1]['webhookUrl'] ?? 'missing') === ''
        && ($redacted_webhook['steps'][1]['webhookEndpoint'] ?? '') === 'hooks.example.test',
    'leitores sem permissão de gestão devem ver apenas o host do webhook'
);
$kodety_analytics_http_requests = [];
kodety_analytics_private(
    $analytics,
    'execute_funnel_webhook_action',
    19,
    'Lead para CRM',
    $webhook_funnel['steps'][1],
    [
        'id' => 'submission-42',
        'form' => 'lead-form',
        'name' => 'Ada',
        'email' => 'ada@example.test',
        'fields' => [
            'company' => 'Analytical Engines',
            'password' => 'never-send-this',
        ],
        'pageUrl' => 'https://example.test/contact',
        'createdAt' => '2026-07-30T12:00:00Z',
    ]
);
$webhook_request = $kodety_analytics_http_requests[0] ?? [];
$webhook_body = (string) ($webhook_request['args']['body'] ?? '');
$webhook_headers = $webhook_request['args']['headers'] ?? [];
$webhook_payload = json_decode($webhook_body, true);
kodety_analytics_assert(
    ($webhook_request['url'] ?? '') === 'https://hooks.example.test/kodety'
        && ($webhook_request['args']['method'] ?? '') === 'PATCH'
        && ($webhook_request['args']['redirection'] ?? -1) === 0
        && ($webhook_request['args']['reject_unsafe_urls'] ?? false) === true
        && ($webhook_headers['X-Kodety-Event'] ?? '') === 'lead.created'
        && ($webhook_headers['X-Kodety-Signature'] ?? '') === 'sha256=' . hash_hmac('sha256', $webhook_body, 'signing-secret')
        && ($webhook_payload['data']['company'] ?? '') === 'Analytical Engines'
        && !isset($webhook_payload['data']['password']),
    'disparo deve usar requisição segura, método escolhido, assinatura HMAC e remover campos secretos'
);
$automatic_webhook = kodety_analytics_private(
    $analytics,
    'first_matching_funnel_event',
    [],
    ['type' => 'webhook'],
    123,
    0
);
kodety_analytics_assert(
    ($automatic_webhook['timestamp'] ?? 0) === 123
        && ($automatic_webhook['event']['event_type'] ?? '') === 'webhook_action',
    'nó de webhook deve ser contabilizado como ação automática no grafo'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'sanitize_funnel_window_minutes', '999999') === 43200
        && kodety_analytics_private($analytics, 'sanitize_funnel_window_minutes', -5) === 0
        && kodety_analytics_private($analytics, 'sanitize_funnel_window_minutes', 'x') === 0,
    'a janela de conversão deve ser limitada a [0, 30 dias]'
);

// The conversion window persists inside the wrapped filters payload and reads
// back identically for both dashboard and project funnels.
$funnel_payload = kodety_analytics_private($analytics, 'funnel_filters_payload', $funnel, ['projectId' => 'checkout-x']);
kodety_analytics_assert(
    ($funnel_payload['settings']['windowMinutes'] ?? -1) === 90 && ($funnel_payload['projectId'] ?? '') === 'checkout-x',
    'o payload de filtros deve carregar a janela e o marcador de projeto'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'funnel_window_from_filters', $funnel_payload) === 90,
    'a janela de conversão deve ser lida de volta do payload salvo'
);

// Conversion-window enforcement: a step reached after the window abandons the
// session; the same events convert fully when no window is set.
$funnel_steps = [
    ['id' => 's1', 'type' => 'page', 'pagePath' => '/', 'trackingId' => '', 'eventName' => ''],
    ['id' => 's2', 'type' => 'click', 'pagePath' => '', 'trackingId' => 'buy-now', 'eventName' => ''],
];
$fast_session = [[
    ['event_type' => 'pageview', 'page_path' => '/', 'tracking_id' => '', 'event_name' => '', 'occurred_at' => '2026-07-24 10:00:00'],
    ['event_type' => 'click', 'page_path' => '/', 'tracking_id' => 'buy-now', 'event_name' => '', 'occurred_at' => '2026-07-24 10:20:00'],
]];
$slow_session = [[
    ['event_type' => 'pageview', 'page_path' => '/', 'tracking_id' => '', 'event_name' => '', 'occurred_at' => '2026-07-24 10:00:00'],
    ['event_type' => 'click', 'page_path' => '/', 'tracking_id' => 'buy-now', 'event_name' => '', 'occurred_at' => '2026-07-24 12:30:00'],
]];
$within = kodety_analytics_private($analytics, 'count_funnel_steps', $fast_session, $funnel_steps, 3600);
$beyond = kodety_analytics_private($analytics, 'count_funnel_steps', $slow_session, $funnel_steps, 3600);
$nolimit = kodety_analytics_private($analytics, 'count_funnel_steps', $slow_session, $funnel_steps, 0);
kodety_analytics_assert($within === [1, 1], 'uma sessão dentro da janela deve concluir o funil');
kodety_analytics_assert($beyond === [1, 0], 'uma etapa após a janela deve abandonar a sessão');
kodety_analytics_assert($nolimit === [1, 1], 'sem janela (0) o funil ignora o tempo e conclui');

$variant = kodety_analytics_private($analytics, 'sanitize_variant', [
    'id' => 'dark',
    'name' => 'Dark',
    'kind' => 'variant',
    'status' => 'active',
    'pagePath' => '/index.html',
    'slug' => '/Case/Hero B!/',
    'weight' => 35.5,
    'enabled' => true,
    'metadata' => ['runtime_relative' => '.kodety-experiments/home/dark/index.html'],
]);
kodety_analytics_assert(is_array($variant) && $variant['weight'] === 35.5 && $variant['enabled'] === 1, 'peso decimal e estado da variante devem ser preservados');
kodety_analytics_assert(
    ($variant['metadata']['public_slug'] ?? '') === 'case/hero-b',
    'o slug público da variante deve ser normalizado e preservado com segmento aninhado'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'public_variant_slug', '  Home B!! ') === 'home-b'
        && kodety_analytics_private($analytics, 'public_variant_slug', '///') === '',
    'a normalização do slug público deve espelhar o editor'
);

// Public variant routing: a request path maps to the running variant's clone,
// and a slug the runtime never registered resolves to nothing.
$kodety_public_routes = [
    'home-b' => [
        'experiment_id' => 7,
        'variant_key' => 'dark',
        'source_page_id' => 42,
        'runtime_relative' => '.kodety-experiments/home/dark/index.html',
    ],
    'case/hero-b' => [
        'experiment_id' => 9,
        'variant_key' => 'hero-b',
        'source_page_id' => 51,
        'runtime_relative' => '.kodety-experiments/case/hero-b/index.html',
    ],
];
$route = kodety_analytics_private($analytics, 'match_public_variant_route', $kodety_public_routes, 'https://example.test/case/hero-b/?utm=1');
kodety_analytics_assert(
    is_array($route) && $route['experiment_id'] === 9 && $route['variant_key'] === 'hero-b'
        && $route['source_page_id'] === 51,
    'um slug aninhado com querystring deve resolver para a variante correta'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'match_public_variant_route', $kodety_public_routes, '/desconhecido') === null,
    'um caminho sem rota registrada não deve servir variante alguma'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'match_public_variant_route', [
        'evil' => ['experiment_id' => 1, 'variant_key' => 'x', 'source_page_id' => 2, 'runtime_relative' => '../../etc/passwd'],
    ], '/evil') === null,
    'uma rota com caminho de clone inseguro deve ser recusada'
);
kodety_analytics_assert(
    ($variant['metadata']['runtime_relative'] ?? '') === '.kodety-experiments/home/dark/index.html',
    'runtime isolado publicado deve permanecer ligado à variante'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'experiment_status_to_database', 'active') === 'running'
        && kodety_analytics_private($analytics, 'experiment_status_to_client', 'completed') === 'archived',
    'estados do editor e do runtime devem possuir mapeamento explícito'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'variant_population_is_valid', 2, 1) === true
        && kodety_analytics_private($analytics, 'variant_population_is_valid', 2, 0) === false
        && kodety_analytics_private($analytics, 'variant_population_is_valid', 2, 2) === false
        && kodety_analytics_private($analytics, 'variant_population_is_valid', 1, 1) === false,
    'um teste ativo deve exigir duas variantes ponderadas e exatamente um controle'
);
kodety_analytics_assert(
    kodety_authored_relative_for_runtime('.kodety-experiments/home/dark/pages/about.html') === 'pages/about.html'
        && kodety_authored_relative_for_runtime('pages/about.html') === 'pages/about.html',
    'clones devem resolver links e localização pelo caminho público originalmente autorado'
);
$unpublishable = ['status' => 'active', 'enabled' => true, 'metadata' => ['runtime_relative' => '.kodety-experiments/old']];
$unpublishable = kodety_analytics_private($analytics, 'pause_unpublishable_variant', $unpublishable);
kodety_analytics_assert(
    $unpublishable['status'] === 'paused'
        && $unpublishable['enabled'] === false
        && !isset($unpublishable['metadata']['runtime_relative']),
    'variante sem clone válido deve ser pausada e nunca reutilizar um caminho antigo'
);

// Publishing must mutate the real nested definitions array, materialize a
// self-contained clone and repair old definitions from physical clone truth.
$variant_publish_root = sys_get_temp_dir() . '/kodety-analytics-publish-' . bin2hex(random_bytes(5));
$variant_incode = $variant_publish_root . '/workspace/.incode';
$variant_project = $variant_incode . '/experiments/home/dark/project';
$kodety_analytics_theme_dir = $variant_publish_root . '/theme';
$kodety_analytics_private_runtime_root = $variant_publish_root . '/private-runtime';
mkdir($variant_project . '/Arquivos/src', 0777, true);
mkdir($variant_project . '/assets', 0777, true);
mkdir($variant_publish_root . '/workspace/assets', 0777, true);
mkdir($kodety_analytics_theme_dir . '/site', 0777, true);
file_put_contents($kodety_analytics_theme_dir . '/manifest.json', wp_json_encode(['' => 'index.html']));
file_put_contents(
    $variant_project . '/index.html',
    '<html><head><link data-kodety-coded-style="Arquivos/src/style.css" href="../../../../../../Arquivos/src/style.css?v=7#theme"></head><body>Dark</body></html>'
);
file_put_contents($variant_project . '/Arquivos/src/style.css', 'body{color:purple}');
file_put_contents($variant_publish_root . '/workspace/assets/inherited.bin', 'CONTROL-INHERITED');
file_put_contents($variant_publish_root . '/workspace/assets/overridden.bin', 'CONTROL-ORIGINAL');
file_put_contents($variant_project . '/assets/overridden.bin', 'VARIANT-OVERRIDE');
$published_definitions = kodety_analytics_private($analytics, 'publish_experiment_projects', $variant_incode, [[
    'id' => 'home',
    'pagePath' => 'index.html',
    'variants' => [
        ['id' => 'control', 'kind' => 'control'],
        [
            'id' => 'dark',
            'kind' => 'variant',
            'status' => 'active',
            'sourcePagePath' => 'index.html',
            'pagePath' => '.incode/experiments/home/dark/project/index.html',
            'inheritedFilePaths' => ['assets/inherited.bin', 'assets/overridden.bin'],
            'metadata' => [],
        ],
    ],
]]);
$published_variant = $published_definitions[0]['variants'][1] ?? [];
$private_scope_root = kodety_analytics_private($analytics, 'private_runtime_scope_root', false, 'single');
kodety_analytics_assert(
    ($published_variant['metadata']['runtime_relative'] ?? '') === '.kodety-experiments/home/dark/index.html',
    'publish_experiment_projects deve persistir runtime_relative no array de definições real'
);
$published_variant_html = (string) file_get_contents(
    $private_scope_root . '/site/.kodety-experiments/home/dark/index.html'
);
kodety_analytics_assert(
    str_contains($published_variant_html, 'href="./Arquivos/src/style.css?v=7#theme"')
        && !str_contains($published_variant_html, '../../../../../../Arquivos/src/style.css'),
    'stylesheet codificado deve ser rebased para o arquivo isolado do próprio clone preservando query/hash'
);
kodety_analytics_assert(
    file_get_contents($private_scope_root . '/site/.kodety-experiments/home/dark/assets/inherited.bin') === 'CONTROL-INHERITED',
    'publish deve materializar o binário herdado ausente do ZIP privado'
);
kodety_analytics_assert(
    file_get_contents($private_scope_root . '/site/.kodety-experiments/home/dark/assets/overridden.bin') === 'VARIANT-OVERRIDE',
    'override binário privado deve vencer o asset herdado no staging publicado'
);
kodety_analytics_assert(
    !file_exists($kodety_analytics_theme_dir . '/site/.kodety-experiments')
        && !str_starts_with(realpath($private_scope_root) ?: '', realpath($kodety_analytics_theme_dir) ?: ''),
    'clones operacionais devem existir fora do document root do tema e nunca sob theme/site'
);
$derived_runtime = kodety_analytics_private($analytics, 'runtime_relative_for_variant', [
    'id' => 7,
    'external_id' => 'home',
    'page_path' => '/',
], [
    'id' => 11,
    'experiment_id' => 7,
    'variant_key' => 'dark',
    'page_path' => '/.incode/experiments/home/dark/project/index.html',
    'metadata' => ['source_page_path' => '/index.html'],
], false);
kodety_analytics_assert(
    $derived_runtime === '.kodety-experiments/home/dark/index.html',
    'runtime_relative ausente deve ser derivado somente de um clone físico seguro'
);
$wpdb->variant_asset_row = [
    'external_id' => 'home',
    'metadata' => wp_json_encode([
        'runtime_relative' => '.kodety-experiments/home/dark/index.html',
    ]),
];
$private_scope_token = kodety_analytics_private($analytics, 'private_runtime_scope_token', 'single');
$private_css = kodety_analytics_private(
    $analytics,
    'private_variant_asset_path',
    $private_scope_token,
    'site/.kodety-experiments/home/dark/Arquivos/src/style.css'
);
kodety_analytics_assert(
    is_string($private_css)
        && $private_css !== ''
        && str_starts_with($private_css, $private_scope_root)
        && kodety_analytics_private(
            $analytics,
            'private_variant_asset_path',
            $private_scope_token,
            'site/.kodety-experiments/home/dark/index.html'
        ) === '',
    'assets de clone devem sair somente pelo resolver PHP; HTML físico direto permanece indisponível'
);
kodety_analytics_assert(
    kodety_analytics_private(
        $analytics,
        'activate_private_variant_runtime',
        '.kodety-experiments/home/dark/index.html'
    ) === true,
    'uma variante Pro publicada deve ativar o contexto privado'
);
$private_context = $analytics->private_variant_runtime_context(['baseUrl' => 'https://example.test/']);
kodety_analytics_assert(
    ($private_context['directory'] ?? '') === $private_scope_root
        && str_contains((string) ($private_context['directoryUri'] ?? ''), '/kodety-experiment-runtime/')
        && ($private_context['route'] ?? '') === '__kodety_private_variant__',
    'o tema deve ler o clone fora do document root e gerar URLs de asset protegidas por PHP'
);
$asset_reads_before_expiry = $wpdb->read_queries;
Kodety_Edition::$licensed = false;
kodety_analytics_assert(
    kodety_analytics_private(
        $analytics,
        'private_variant_asset_path',
        $private_scope_token,
        'site/.kodety-experiments/home/dark/Arquivos/src/style.css'
    ) === ''
        && $wpdb->read_queries === $asset_reads_before_expiry
        && $analytics->private_variant_runtime_context(['baseUrl' => 'control']) === ['baseUrl' => 'control'],
    'expiração deve bloquear HTML e assets privados antes de qualquer consulta ou materialização'
);
Kodety_Edition::$licensed = true;
$wpdb->variant_asset_row = null;
$kodety_analytics_options['kodety_public_variant_routes'] = [
    'home-b' => [
        'experiment_id' => 7,
        'variant_key' => 'dark',
        'source_page_id' => 42,
        'runtime_relative' => '.kodety-experiments/home/dark/index.html',
    ],
];
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['QUERY_STRING'] = 'utm_source=campaign&utm_campaign=hero&kodety_variant=dark&preview=true';
$redirect = kodety_analytics_private($analytics, 'public_variant_redirect_url', [
    'id' => 7,
    'source_page_id' => 42,
], [
    'variantId' => 'dark',
    'publicSlug' => 'home-b',
    'runtimeRelative' => '.kodety-experiments/home/dark/index.html',
]);
kodety_analytics_assert(
    $redirect === 'https://example.test/home-b?utm_source=campaign&utm_campaign=hero',
    'redirect deve usar a rota publicada, preservar aquisição e remover parâmetros internos'
);
$_SERVER['REQUEST_URI'] = '/home-b';
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'public_variant_redirect_url', [
        'id' => 7,
        'source_page_id' => 42,
    ], [
        'variantId' => 'dark',
        'publicSlug' => 'home-b',
        'runtimeRelative' => '.kodety-experiments/home/dark/index.html',
    ]) === '',
    'a URL pública da própria variante não pode redirecionar em loop'
);
file_put_contents($kodety_analytics_theme_dir . '/manifest.json', wp_json_encode(['home-b' => 'index.html']));
kodety_analytics_assert(
    str_contains(
        (string) kodety_analytics_private($analytics, 'public_variant_slug_conflict', 'home-b'),
        'página publicada'
    ),
    'slug que colide com rota real do manifest não pode ser anunciado silenciosamente'
);
kodety_analytics_private($analytics, 'finalize_runtime_swap');
$legacy_public_clone = $kodety_analytics_theme_dir . '/site/.kodety-experiments/legacy/dark';
mkdir($legacy_public_clone, 0777, true);
file_put_contents($legacy_public_clone . '/index.html', '<main>legacy-direct</main>');
$analytics->purge_legacy_public_runtime_trees();
kodety_analytics_assert(
    !file_exists($kodety_analytics_theme_dir . '/site/.kodety-experiments'),
    'init deve remover clones físicos legados que Apache, Nginx ou CDN poderiam servir diretamente'
);
kodety_analytics_remove_tree($variant_publish_root);
$kodety_analytics_theme_dir = '';
$kodety_analytics_private_runtime_root = '';
unset($kodety_analytics_options['kodety_public_variant_routes']);
unset($_SERVER['QUERY_STRING']);

$runtime_test_root = sys_get_temp_dir() . '/kodety-analytics-runtime-' . bin2hex(random_bytes(5));
$runtime_source = $runtime_test_root . '/source';
$runtime_destination = $runtime_test_root . '/published';
$runtime_staging = $runtime_test_root . '/staging';
mkdir($runtime_source, 0777, true);
mkdir($runtime_destination, 0777, true);
file_put_contents($runtime_source . '/index.html', '<main>new</main>');
file_put_contents($runtime_source . '/manifest.json', '{"release":"new"}');
file_put_contents($runtime_source . '/style.css', 'body{background:url(/images/hero.webp)}');
file_put_contents($runtime_destination . '/index.html', '<main>old</main>');
file_put_contents($runtime_destination . '/manifest.json', '{"release":"old"}');
kodety_analytics_private($analytics, 'copy_runtime_tree', $runtime_source, $runtime_staging);
$source_runtime_digest = kodety_analytics_private($analytics, 'runtime_tree_digest', $runtime_source);
$staged_runtime_digest = kodety_analytics_private($analytics, 'runtime_tree_digest', $runtime_staging);
kodety_analytics_assert(
    hash_equals($source_runtime_digest, $staged_runtime_digest),
    'clone de A/B Test deve ser idêntico antes da reescrita intencional de CSS'
);
file_put_contents($runtime_staging . '/index.html', '<main>tampered</main>');
kodety_analytics_assert(
    !hash_equals(
        $source_runtime_digest,
        kodety_analytics_private($analytics, 'runtime_tree_digest', $runtime_staging)
    ),
    'digest do clone deve detectar perda ou alteração durante o staging'
);
kodety_analytics_remove_tree($runtime_staging);
kodety_analytics_private($analytics, 'copy_runtime_tree', $runtime_source, $runtime_staging);
kodety_analytics_private($analytics, 'rewrite_variant_css_root_urls', $runtime_staging);
kodety_analytics_private($analytics, 'swap_runtime_tree', $runtime_staging, $runtime_destination);
kodety_analytics_assert(
    file_get_contents($runtime_destination . '/index.html') === '<main>new</main>'
        && file_get_contents($runtime_destination . '/manifest.json') === '{"release":"new"}'
        && str_contains((string) file_get_contents($runtime_destination . '/style.css'), 'url(./images/hero.webp)'),
    'clone e manifest devem avançar juntos antes de substituir a publicação privada'
);
kodety_analytics_private($analytics, 'rollback_runtime_swap');
kodety_analytics_assert(
    file_get_contents($runtime_destination . '/index.html') === '<main>old</main>'
        && file_get_contents($runtime_destination . '/manifest.json') === '{"release":"old"}',
    'falha de sincronização deve restaurar atomicamente clone e manifest anteriores'
);
kodety_analytics_remove_tree($runtime_test_root);

// Um projeto importado dentro de uma pasta-invólucro reproduz essa pasta
// dentro do clone. `url(/x)` continua endereçando a raiz do projeto, então
// precisa voltar até ela — parar na raiz do clone deixaria o asset em 404.
$wrapped_root = sys_get_temp_dir() . '/kodety-variant-webroot-' . bin2hex(random_bytes(5));
mkdir($wrapped_root . '/Arquivos/styles', 0777, true);
file_put_contents(
    $wrapped_root . '/Arquivos/styles/main.css',
    'body{background:url(/images/hero.webp)}'
);
file_put_contents($wrapped_root . '/Arquivos/base.css', 'body{background:url(/images/hero.webp)}');
kodety_analytics_private($analytics, 'rewrite_variant_css_root_urls', $wrapped_root, 'Arquivos');
kodety_analytics_assert(
    str_contains(
        (string) file_get_contents($wrapped_root . '/Arquivos/styles/main.css'),
        'url(../images/hero.webp)'
    ),
    'CSS aninhado da variante deve voltar até a raiz do projeto, não até a raiz do clone'
);
kodety_analytics_assert(
    str_contains(
        (string) file_get_contents($wrapped_root . '/Arquivos/base.css'),
        'url(./images/hero.webp)'
    ),
    'CSS na raiz do projeto clonado resolve no próprio diretório'
);
kodety_analytics_remove_tree($wrapped_root);

$experiment = kodety_analytics_private($analytics, 'sanitize_experiment_input', [
    'id' => 'homepage',
    'name' => 'Homepage',
    'pagePath' => 'index.html',
    'goal' => ['type' => 'custom', 'eventName' => 'checkout-complete'],
]);
kodety_analytics_assert(
    is_array($experiment)
        && $experiment['goal_type'] === 'custom'
        && $experiment['goal_tracking_id'] === 'checkout-complete',
    'meta customizada deve preservar o eventName usado na conversão'
);
$click_target_experiment = kodety_analytics_private($analytics, 'sanitize_experiment_input', [
    'id' => 'hero-click',
    'name' => 'Hero click',
    'pagePath' => 'index.html',
    'goal' => ['type' => 'click', 'targetType' => 'id', 'targetValue' => 'hero-cta'],
]);
kodety_analytics_assert(
    is_array($click_target_experiment)
        && $click_target_experiment['goal_tracking_id'] === 'id:hero-cta',
    'meta de clique por ID deve ser preservada como chave canônica retrocompatível'
);
$legacy_click_experiment = kodety_analytics_private($analytics, 'sanitize_experiment_input', [
    'id' => 'legacy-click',
    'name' => 'Legacy click',
    'pagePath' => 'index.html',
    'goal' => ['type' => 'click', 'trackingId' => 'hero-legacy'],
]);
kodety_analytics_assert(
    is_array($legacy_click_experiment)
        && $legacy_click_experiment['goal_tracking_id'] === 'hero-legacy',
    'Tracking ID de clique legado deve continuar inalterado'
);
$click_assignment = kodety_analytics_private($analytics, 'assignment_payload', [
    'id' => 17,
    'external_id' => 'hero-click',
    'goal_type' => 'click',
    'goal_tracking_id' => 'class:primary-cta',
], [
    'variant_key' => 'control',
    'name' => 'Control',
    'page_id' => 42,
    'page_path' => '/',
    'document_key' => 'control',
    'is_control' => 1,
    'metadata' => wp_json_encode([]),
]);
kodety_analytics_assert(
    ($click_assignment['goal']['trackingId'] ?? '') === 'class:primary-cta'
        && ($click_assignment['goal']['targetType'] ?? '') === 'class'
        && ($click_assignment['goal']['targetValue'] ?? '') === 'primary-cta',
    'assignment deve expor targetType/targetValue sem perder a chave comparável do goal'
);

$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'Kodety Analytics Test';
$exposure = kodety_analytics_private($analytics, 'sanitize_event', [
    'type' => 'exposure',
    'eventId' => 'exposure-event-1234567890',
    'sessionId' => 'session-1234567890',
    'visitorId' => 'visitor-1234567890',
    'pagePath' => '/',
], new WP_REST_Request([], ['Origin' => 'https://example.test']));
kodety_analytics_assert(
    is_array($exposure) && $exposure['event_type'] === 'exposure' && $exposure['tracking_id'] === '',
    'exposição confirmada deve possuir evento próprio sem exigir tracking ID'
);

$kodety_analytics_logged_in = false;
$anonymous_denied = $analytics->private_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_analytics_assert(
    $anonymous_denied instanceof WP_Error
        && $anonymous_denied->get_error_code() === 'kodety_analytics_unauthorized'
        && (int) ($anonymous_denied->get_error_data()['status'] ?? 0) === 401,
    'endpoint privado deve responder 401 quando não há identidade autenticada'
);
$kodety_analytics_logged_in = true;
$denied = $analytics->private_permission(new WP_REST_Request([], []));
kodety_analytics_assert(
    $denied instanceof WP_Error
        && $denied->get_error_code() === 'kodety_analytics_nonce'
        && (int) ($denied->get_error_data()['status'] ?? 0) === 403,
    'endpoint privado deve exigir REST nonce com HTTP 403'
);
$allowed = $analytics->private_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_analytics_assert($allowed === true, 'capability + nonce válidos devem liberar dashboard');
$body_nonce_allowed = $analytics->private_permission(new WP_REST_Request(['_wpnonce' => 'valid-rest-nonce']));
kodety_analytics_assert($body_nonce_allowed === true, 'nonce REST no parâmetro deve funcionar quando o header está ausente');
$kodety_analytics_caps = ['kodety_view_analytics' => true];
$view_allowed = $analytics->view_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_analytics_assert($view_allowed === true, 'capability de leitura deve liberar relatórios');
$manage_denied = $analytics->manage_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_analytics_assert(
    $manage_denied instanceof WP_Error
        && $manage_denied->get_error_code() === 'kodety_analytics_forbidden'
        && (int) ($manage_denied->get_error_data()['status'] ?? 0) === 403,
    'capability de leitura não pode alterar funis ou experimentos'
);
$kodety_analytics_caps = ['kodety_manage_analytics' => true, 'kodety_view_analytics' => true];

// Free Analytics is enforced at the PHP boundary. Historical ranges and Pro
// reports must fail before any database read, while definition-only lists and
// draft state remain available to the Builder.
Kodety_Edition::$licensed = false;
$today = new DateTimeImmutable('today', new DateTimeZone('UTC'));
$today_value = $today->format('Y-m-d');
$week_start_value = $today->modify('-6 days')->format('Y-m-d');
$kodety_analytics_site_timezone = new DateTimeZone('Pacific/Kiritimati');
$site_today = new DateTimeImmutable('today', $kodety_analytics_site_timezone);
$site_today_value = $site_today->format('Y-m-d');
$site_today_expected = [
    $site_today->setTime(0, 0, 0)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
    $site_today->setTime(23, 59, 59)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
];
$extreme_west = kodety_analytics_private(
    $analytics,
    'overview_date_range',
    new WP_REST_Request(['from' => $site_today_value, 'to' => $site_today_value, 'timezone' => 'Pacific/Pago_Pago'])
);
$extreme_east = kodety_analytics_private(
    $analytics,
    'overview_date_range',
    new WP_REST_Request(['from' => $site_today_value, 'to' => $site_today_value, 'timezone' => 'Pacific/Kiritimati'])
);
kodety_analytics_assert(
    $extreme_west === $site_today_expected && $extreme_east === $site_today_expected,
    'fusos extremos enviados pelo cliente não podem deslocar a fronteira Free definida por wp_timezone()'
);
$kodety_analytics_site_timezone = new DateTimeZone('UTC');
$allowed_today_range = kodety_analytics_private(
    $analytics,
    'overview_date_range',
    new WP_REST_Request(['from' => $today_value, 'to' => $today_value, 'timezone' => 'UTC'])
);
kodety_analytics_assert(
    is_array($allowed_today_range)
        && $allowed_today_range[0] === $today_value . ' 00:00:00'
        && $allowed_today_range[1] === $today_value . ' 23:59:59',
    'overview Free deve permitir o período de hoje'
);
$allowed_week_range = kodety_analytics_private(
    $analytics,
    'overview_date_range',
    new WP_REST_Request(['from' => $week_start_value, 'to' => $today_value, 'timezone' => 'UTC'])
);
kodety_analytics_assert(
    is_array($allowed_week_range)
        && $allowed_week_range[0] === $week_start_value . ' 00:00:00'
        && $allowed_week_range[1] === $today_value . ' 23:59:59',
    'overview Free deve permitir somente a janela atual de sete dias'
);
$forged_history_request = new WP_REST_Request([
    'from' => $today->modify('-13 days')->format('Y-m-d'),
    'to' => $today->modify('-7 days')->format('Y-m-d'),
    'timezone' => 'UTC',
]);
$reads_before_gate = $wpdb->read_queries;
$forged_history = $analytics->overview($forged_history_request);
kodety_analytics_assert(
    $forged_history instanceof WP_Error
        && $forged_history->get_error_code() === 'kodety_analytics_pro_required'
        && (int) ($forged_history->get_error_data()['status'] ?? 0) === 403
        && ($forged_history->get_error_data()['feature'] ?? '') === 'analyticsHistory'
        && $wpdb->read_queries === $reads_before_gate,
    'overview Free deve rejeitar paginação histórica antes de consultar métricas'
);
$shifted_week = kodety_analytics_private(
    $analytics,
    'overview_date_range',
    new WP_REST_Request([
        'from' => $today->modify('-7 days')->format('Y-m-d'),
        'to' => $today->modify('-1 day')->format('Y-m-d'),
        'timezone' => 'UTC',
    ])
);
kodety_analytics_assert(
    $shifted_week instanceof WP_Error && (int) ($shifted_week->get_error_data()['status'] ?? 0) === 403,
    'uma janela de sete dias deslocada para o passado não pode contornar o limite Free'
);
$malformed_history = kodety_analytics_private(
    $analytics,
    'overview_date_range',
    new WP_REST_Request(['from' => '2026-02-31', 'to' => $today_value, 'timezone' => 'UTC'])
);
kodety_analytics_assert(
    $malformed_history instanceof WP_Error && (int) ($malformed_history->get_error_data()['status'] ?? 0) === 403,
    'datas forjadas não podem ser reinterpretadas silenciosamente como um range Free válido'
);

$pro_reports = [
    'analyticsPageInsights' => $analytics->page_insights(new WP_REST_Request()),
    'analyticsUtms' => $analytics->tracking_report(new WP_REST_Request()),
    'experiments' => $analytics->debug_variant_routes(new WP_REST_Request()),
    'analyticsFunnels' => $analytics->get_funnel(new WP_REST_Request(['id' => 1])),
    'experimentResults' => $analytics->get_experiment(new WP_REST_Request(['id' => 'draft-test'])),
];
foreach ($pro_reports as $report => $blocked_report) {
    kodety_analytics_assert(
        $blocked_report instanceof WP_Error
            && $blocked_report->get_error_code() === 'kodety_analytics_pro_required'
            && (int) ($blocked_report->get_error_data()['status'] ?? 0) === 403,
        $report . ' deve responder 403 no plano Free'
    );
    $error_data = $blocked_report->get_error_data();
    foreach (['pageviews', 'results', 'items', 'routes', 'variants'] as $metric_key) {
        kodety_analytics_assert(
            !is_array($error_data) || !array_key_exists($metric_key, $error_data),
            $report . ' não pode incluir métricas ocultas no payload 403'
        );
    }
}
kodety_analytics_assert(
    $wpdb->read_queries === $reads_before_gate,
    'relatórios Pro bloqueados não devem consultar nem materializar métricas'
);
$free_overview = $analytics->overview(new WP_REST_Request([
    'from' => $today_value,
    'to' => $today_value,
    'timezone' => 'UTC',
]));
$free_overview_data = $free_overview instanceof WP_REST_Response ? $free_overview->get_data() : [];
kodety_analytics_assert(
    $free_overview instanceof WP_REST_Response
        && array_key_exists('pageviews', $free_overview_data)
        && array_key_exists('series', $free_overview_data)
        && ($free_overview_data['tracking'] ?? null) === [],
    'overview básico deve funcionar no Free sem duplicar métricas Pro de tracking'
);

$funnel_definitions = $analytics->list_funnels(new WP_REST_Request(['summary' => '1']));
kodety_analytics_assert(
    $funnel_definitions instanceof WP_REST_Response
        && $funnel_definitions->get_status() === 200
        && $funnel_definitions->get_data() === [],
    'lista resumida de funis deve continuar disponível para configurar drafts no Free'
);
$experiment_definitions = $analytics->list_experiments(new WP_REST_Request());
kodety_analytics_assert(
    $experiment_definitions instanceof WP_REST_Response
        && $experiment_definitions->get_status() === 200
        && $experiment_definitions->get_data() === [],
    'lista e configuração de drafts de A/B Tests devem continuar disponíveis no Free'
);
$funnel_results = $analytics->list_funnels(new WP_REST_Request());
kodety_analytics_assert(
    $funnel_results instanceof WP_Error
        && ($funnel_results->get_error_data()['feature'] ?? '') === 'analyticsFunnels',
    'a mesma coleção de funis deve exigir Pro quando resultados forem solicitados'
);
$active_funnel = $analytics->create_funnel(new WP_REST_Request([], [], [
    'name' => 'Funil Free',
    'enabled' => true,
    'steps' => [[
        'id' => 'landing',
        'name' => 'Landing',
        'type' => 'page',
        'pagePath' => '/',
    ]],
]));
kodety_analytics_assert(
    $active_funnel instanceof WP_Error
        && ($active_funnel->get_error_data()['feature'] ?? '') === 'analyticsFunnels',
    'REST direto não pode criar funil ativo no Free'
);
$draft_funnel = kodety_analytics_private($analytics, 'sanitize_funnel_input', [
    'name' => 'Funil Free',
    'enabled' => false,
    'steps' => [['id' => 'landing', 'name' => 'Landing', 'type' => 'page', 'pagePath' => '/']],
]);
kodety_analytics_assert(
    is_array($draft_funnel) && ($draft_funnel['status'] ?? '') === 'paused',
    'configuração pausada do funil deve continuar válida no Free'
);

$running_experiment = $analytics->set_experiment_state(new WP_REST_Request(
    ['id' => 'draft-test'],
    [],
    ['status' => 'active']
));
kodety_analytics_assert(
    $running_experiment instanceof WP_Error
        && ($running_experiment->get_error_data()['feature'] ?? '') === 'experiments',
    'alias active também deve ser rejeitado antes de iniciar A/B Test no Free'
);
$assignment = $analytics->assign(new WP_REST_Request());
$assignment_payload = $assignment instanceof WP_REST_Response ? $assignment->get_data() : [];
kodety_analytics_assert(
    $assignment instanceof WP_REST_Response
        && ($assignment_payload['assigned'] ?? true) === false
        && ($assignment_payload['reason'] ?? '') === 'license_required',
    'endpoint público de assign deve ser no-op no Free sem consultar experimentos'
);
$runtime_reads = $wpdb->read_queries;
$analytics->run_funnel_email_actions(['form' => 'lead', 'fields' => ['email' => 'free@example.test']]);
$analytics->maybe_apply_experiment();
kodety_analytics_assert(
    $wpdb->read_queries === $runtime_reads,
    'runtime Free não deve consultar nem executar automações de funil ou A/B Tests'
);
$forced_route = new ReflectionProperty(Kodety_Analytics::class, 'forced_variant_route');
$forced_route->setAccessible(true);
$forced_route->setValue($analytics, [
    'experiment_id' => 31,
    'variant_key' => 'variant',
    'source_page_id' => 42,
    'runtime_relative' => '.kodety-experiments/test/index.html',
]);
$expired_variant_request = new WP(['kodety_variant' => 'variant']);
$analytics->detect_variant_public_route($expired_variant_request);
kodety_analytics_assert(
    $forced_route->getValue($analytics) === null
        && !array_key_exists('page_id', $expired_variant_request->query_vars)
        && $wpdb->read_queries === $runtime_reads,
    'rewrite público não pode resolver página/clone de variante no Free'
);
$forced_route->setValue($analytics, [
    'experiment_id' => 31,
    'variant_key' => 'variant',
    'source_page_id' => 42,
    'runtime_relative' => '.kodety-experiments/test/index.html',
]);
$analytics->apply_forced_variant_route();
kodety_analytics_assert(
    $forced_route->getValue($analytics) === null && $wpdb->read_queries === $runtime_reads,
    'rota pública stale não pode aplicar uma variante depois que a licença expira'
);
$kodety_analytics_options['kodety_public_variant_routes'] = ['stale' => ['experiment_id' => 31]];
$analytics->register_variant_rewrite_rules();
kodety_analytics_assert(
    ($kodety_analytics_options['kodety_public_variant_routes'] ?? null) === []
        && $wpdb->read_queries === $runtime_reads,
    'init Free deve remover mapa/rewrite persistido por uma licença expirada'
);
$kodety_analytics_options['kodety_public_variant_routes'] = ['stale' => ['experiment_id' => 31]];
$analytics->reconcile_published_experiments('expired-license');
kodety_analytics_assert(
    ($kodety_analytics_options['kodety_public_variant_routes'] ?? null) === []
        && $wpdb->read_queries === $runtime_reads,
    'reconciliação/rebuild Free deve limpar o mapa público sem consultar variantes'
);
kodety_analytics_assert(
    kodety_analytics_private($analytics, 'effective_experiment_status', 'running') === 'paused'
        && kodety_analytics_private($analytics, 'effective_funnel_status', 'active') === 'paused',
    'sync publicado deve persistir estados Pro como pausados no Free'
);

Kodety_Edition::$licensed = true;
$licensed_history = kodety_analytics_private($analytics, 'overview_date_range', $forged_history_request);
kodety_analytics_assert(
    is_array($licensed_history)
        && kodety_analytics_private($analytics, 'effective_experiment_status', 'running') === 'running'
        && kodety_analytics_private($analytics, 'effective_funnel_status', 'active') === 'active',
    'licença ativa deve preservar histórico e estados Pro legítimos'
);

$foreign = kodety_analytics_private($analytics, 'public_request_allowed', new WP_REST_Request([], ['Origin' => 'https://attacker.test']));
kodety_analytics_assert($foreign instanceof WP_Error && $foreign->get_error_code() === 'kodety_analytics_origin', 'ingestão deve rejeitar origem externa');
$privacy = kodety_analytics_private($analytics, 'public_request_allowed', new WP_REST_Request([], ['Origin' => 'https://example.test', 'Sec-GPC' => '1']));
kodety_analytics_assert($privacy instanceof WP_Error && $privacy->get_error_code() === 'kodety_analytics_privacy', 'Global Privacy Control deve ser respeitado');
$same_origin = kodety_analytics_private($analytics, 'public_request_allowed', new WP_REST_Request([], ['Origin' => 'https://example.test']));
kodety_analytics_assert($same_origin === true, 'beacon same-origin deve ser aceito');
$kodety_analytics_options['kodety_cookie_consent_enabled'] = '1';
unset($_COOKIE['kodety_consent_analytics']);
$without_analytics_consent = kodety_analytics_private($analytics, 'public_request_allowed', new WP_REST_Request([], ['Origin' => 'https://example.test']));
kodety_analytics_assert(
    $without_analytics_consent instanceof WP_Error
        && $without_analytics_consent->get_error_code() === 'kodety_analytics_privacy',
    'o endpoint first-party deve recusar eventos enquanto Analytics não foi concedido'
);
$_COOKIE['kodety_consent_analytics'] = 'granted';
$with_analytics_consent = kodety_analytics_private($analytics, 'public_request_allowed', new WP_REST_Request([], ['Origin' => 'https://example.test']));
kodety_analytics_assert($with_analytics_consent === true, 'o endpoint deve liberar Analytics após consentimento explícito');
$kodety_analytics_options['kodety_cookie_consent_enabled'] = '0';
unset($_COOKIE['kodety_consent_analytics']);

ob_start();
$analytics->print_tracking_script();
$tracker = (string) ob_get_clean();
kodety_analytics_assert(str_contains($tracker, 'data-kodety-analytics="1"'), 'runtime deve injetar um único tracker identificável');
kodety_analytics_assert(str_contains($tracker, '[data-kodety-tracking-id]'), 'tracker deve seguir o contrato visual do Builder');
kodety_analytics_assert(str_contains($tracker, 'navigator.globalPrivacyControl'), 'tracker deve respeitar GPC no navegador');
kodety_analytics_assert(str_contains($tracker, 'sendBeacon'), 'tracker deve preservar eventos durante navegação');
kodety_analytics_assert(str_contains($tracker, 'kodety_analytics_visitor'), 'tracker deve estabilizar visitantes com cookie first-party');
kodety_analytics_assert(str_contains($tracker, 'localStorage.setItem(key + "session"'), 'sessão deve ser compartilhada entre abas');
kodety_analytics_assert(str_contains($tracker, 'JSON.stringify({ events })'), 'eventos devem ser enviados em lotes');
kodety_analytics_assert(str_contains($tracker, 'scrollThresholds'), 'tracker deve medir marcos de profundidade de scroll');
kodety_analytics_assert(str_contains($tracker, 'kodety-analytics-preview'), 'preview visual não pode contaminar as métricas');
kodety_analytics_assert(
    str_contains($tracker, 'config.consentRequired')
        && str_contains($tracker, 'window.__kodetyAnalyticsConsentGranted === true'),
    'o tracker não pode assumir consentimento antes de o manager inicializar'
);
kodety_analytics_assert(str_contains($tracker, 'send("exposure")'), 'tracker deve medir exposição somente após a variante servida ser confirmada');
kodety_analytics_assert(!str_contains($tracker, '|| assignments[0] || null'), 'eventos sem meta não podem cair arbitrariamente na primeira variante');
kodety_analytics_assert(
    str_contains($tracker, 'cursor.id === goal.targetValue')
        && str_contains($tracker, 'cursor.classList.contains(goal.targetValue)')
        && str_contains($tracker, 'target.closest("[data-kodety-tracking-id]")'),
    'tracker deve detectar ancestral por ID/classe sem remover o Tracking ID legado'
);

Kodety_Plugin::$studio_runtime = [
    'enabled' => true,
    'projectId' => 'project-12345678',
];
ob_start();
$analytics->print_tracking_script();
$studio_tracker = (string) ob_get_clean();
kodety_analytics_assert(
    $studio_tracker === '',
    'o WordPress local do Studio não pode registrar a navegação do próprio usuário como tráfego real'
);
Kodety_Plugin::$studio_runtime = null;

// The post-publish reconciliation must turn a first-release source_page_id=0
// into the native page identity before rebuilding the public route option.
$wpdb = new class {
    public string $prefix = 'wp_';
    public string $postmeta = 'wp_postmeta';
    public string $posts = 'wp_posts';
    public array $updates = [];
    public function get_results(string $query, mixed $format = null): array {
        if (str_contains($query, "WHERE managed_source='project'")) {
            return [['id' => 31, 'source_page_id' => 0, 'page_path' => '/index.html']];
        }
        return [];
    }
    public function prepare(string $query, mixed ...$arguments): string { return $query; }
    public function get_var(string $query): int {
        return str_contains($query, "meta.meta_key='_kodety_route'") ? 42 : 0;
    }
    public function update(string $table, array $data, array $where): int {
        $this->updates[] = compact('table', 'data', 'where');
        return 1;
    }
};
$analytics->reconcile_published_experiments('release-first');
$reconciled = $wpdb->updates[0]['data'] ?? [];
kodety_analytics_assert(
    ($reconciled['source_page_id'] ?? 0) === 42
        && ($reconciled['page_path'] ?? '') === '/'
        && ($kodety_analytics_options['kodety_public_variant_routes'] ?? null) === [],
    'reconciliação pós-publicação deve ligar o experimento à página recém-criada e substituir o mapa stale'
);

$wpdb = new class {
    public string $prefix = 'wp_';
    public function prepare(string $query, mixed ...$arguments): string { return $query; }
    public function get_results(string $query, mixed $format = null): array {
        return [
            [
                'id' => 1, 'experiment_id' => 31, 'variant_key' => 'control',
                'name' => 'Control', 'document_key' => 'control', 'page_id' => 42,
                'page_path' => '/', 'weight' => 70, 'enabled' => 1, 'is_control' => 1,
                'metadata' => '{}',
            ],
            [
                'id' => 2, 'experiment_id' => 31, 'variant_key' => 'dark',
                'name' => 'Dark', 'document_key' => 'dark', 'page_id' => 42,
                'page_path' => '/', 'weight' => 30, 'enabled' => 1, 'is_control' => 0,
                'metadata' => '{"public_slug":"home-b"}',
            ],
        ];
    }
};
$weighted_experiment = [
    'id' => 31,
    'external_id' => 'weighted',
    'page_path' => '/',
    'goal_type' => 'click',
    'goal_tracking_id' => 'cta',
    'traffic_percent' => 100,
    'assignment_salt' => str_repeat('a', 48),
];
$dark_assignments = 0;
for ($visitor_index = 0; $visitor_index < 500; $visitor_index++) {
    unset($_COOKIE['kodety_exp_31']);
    $weighted_assignment = kodety_analytics_private(
        $analytics,
        'choose_variant',
        $weighted_experiment,
        'visitor-' . str_pad((string) $visitor_index, 20, '0', STR_PAD_LEFT),
        false
    );
    if (($weighted_assignment['variantId'] ?? '') === 'dark') $dark_assignments++;
}
kodety_analytics_assert(
    $dark_assignments >= 120 && $dark_assignments <= 180,
    'bucket determinístico deve respeitar aproximadamente a distribuição 70/30'
);
$_COOKIE['kodety_exp_31'] = 'dark';
$sticky_assignment = kodety_analytics_private(
    $analytics,
    'choose_variant',
    $weighted_experiment,
    'visitor-that-would-not-matter',
    false
);
kodety_analytics_assert(
    ($sticky_assignment['variantId'] ?? '') === 'dark'
        && ($sticky_assignment['publicSlug'] ?? '') === 'home-b',
    'assignment persistido deve continuar sticky e carregar o slug público'
);
unset($_COOKIE['kodety_exp_31']);

$publisher_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
$prepare_offset = strpos($publisher_source, "do_action('kodety_prepare_published_analytics'");
$activation_offset = strpos($publisher_source, '$activated = true;', $prepare_offset === false ? 0 : $prepare_offset);
kodety_analytics_assert(
    $prepare_offset !== false && $activation_offset !== false && $prepare_offset < $activation_offset,
    'tema/workspace anteriores devem continuar recuperáveis até Analytics e clones confirmarem a release'
);
$analytics_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-analytics.php');
kodety_analytics_assert(
    str_contains($analytics_source, "add_action('kodety_published', [\$this, 'reconcile_published_experiments'], 20)")
        && str_contains($analytics_source, '$this->rebuild_public_variant_routes();'),
    'primeira publicação deve reconciliar page IDs e reconstruir as rotas após sync_project_pages'
);
$sync_start = strpos($analytics_source, 'public function sync_published_configuration');
$publish_projects = strpos(
    $analytics_source,
    '$this->publish_experiment_projects',
    $sync_start === false ? 0 : $sync_start
);
$presence_guard = strpos(
    $analytics_source,
    'if (!$has_experiments && !$has_funnels) return;',
    $sync_start === false ? 0 : $sync_start
);
kodety_analytics_assert(
    $sync_start !== false
        && $presence_guard !== false
        && $publish_projects !== false
        && $presence_guard < $publish_projects,
    'project.json legado sem analytics não pode pausar testes nem substituir clones ativos'
);
$forced_start = strpos($analytics_source, 'public function apply_forced_variant_route');
$forced_end = strpos($analytics_source, 'public function maybe_apply_experiment', $forced_start ?: 0);
$forced_source = $forced_start !== false && $forced_end !== false
    ? substr($analytics_source, $forced_start, $forced_end - $forced_start)
    : '';
kodety_analytics_assert(
    strpos($forced_source, 'AND enabled=1 AND is_control=0 AND weight>0') !== false
        && strpos($forced_source, 'AND enabled=1 AND is_control=0 AND weight>0')
            < strpos($forced_source, "add_filter('get_post_metadata'"),
    'rota forçada deve revalidar estado/peso antes de instalar o override do clone'
);
$strict_route_validation = strpos($analytics_source, '$this->collect_public_variant_routes(true);');
$analytics_sync_start = strpos($analytics_source, 'public function sync_published_configuration');
$analytics_commit = strpos(
    $analytics_source,
    "if (\$wpdb->query('COMMIT') === false",
    $analytics_sync_start === false ? 0 : $analytics_sync_start
);
kodety_analytics_assert(
    $strict_route_validation !== false
        && $analytics_commit !== false
        && $strict_route_validation < $analytics_commit,
    'colisões de slug/rota devem falhar ainda dentro da publicação recuperável'
);
kodety_analytics_assert(
    $reflection->getConstant('DB_VERSION') === 6,
    'upgrade deve executar a migração de escopo por projeto uma vez nas instalações existentes'
);
kodety_analytics_assert(
    strpos($analytics_source, "'allocationMode' => \$allocation") !== false
        && strpos($analytics_source, "elseif (\$config['allocationMode'] === 'adaptive')") !== false
        && strpos($analytics_source, "\$config['deliveryMode'] === 'redirect'") !== false,
    'runtime deve executar distribuição igual/adaptativa e entrega configurável'
);
kodety_analytics_assert(
    strpos($analytics_source, 'calculate_funnel_graph') !== false
        && strpos($analytics_source, 'sourceStepId') !== false
        && strpos($analytics_source, 'connectionResults') !== false,
    'funis devem persistir e calcular ramificações por conexões'
);
kodety_analytics_assert(
    strpos($analytics_source, 'run_funnel_email_actions') !== false
        && strpos($analytics_source, 'Kodety_Email_Contacts::add_to_list') !== false
        && strpos($analytics_source, 'execute_funnel_webhook_action') !== false
        && strpos($analytics_source, 'wp_safe_remote_request') !== false
        && strpos($analytics_source, "'redirection' => 0") !== false
        && strpos($analytics_source, "'X-Kodety-Signature'") !== false
        && strpos($analytics_source, "add_action('kodety_funnel_send_campaign'") === false
        && strpos($analytics_source, "wp_schedule_single_event(time(), 'kodety_funnel_send_campaign'") === false,
    'formulários podem capturar contatos/listas e chamar webhooks seguros, mas nunca disparar campanhas automaticamente'
);
kodety_analytics_assert(
    str_contains($analytics_source, "wp_unschedule_hook('kodety_funnel_send_campaign')")
        && str_contains($analytics_source, "unset(\$step['emailCampaignId'])"),
    'upgrade/desativação deve migrar nós legados e remover cron com argumentos'
);
kodety_analytics_assert(
    str_contains($analytics_source, 'manager.has("analytics") === true')
        && str_contains($analytics_source, 'manager.hasIntegration("kodetyAnalytics") === true')
        && str_contains($analytics_source, 'if (!consentAllowsAnalytics()) return;')
        && str_contains($analytics_source, "project_option('kodety_cookie_consent_enabled', '0')")
        && str_contains($analytics_source, "\$_COOKIE['kodety_consent_analytics']")
        && str_contains($analytics_source, "\$_COOKIE['kodety_consent_experiments']")
        && str_contains($analytics_source, 'clear_experiment_identity_cookies'),
    'Analytics nativo e A/B devem respeitar consentimento no browser e antes de criar cookies no PHP'
);

echo "Contratos de Analytics, Funis e A/B Tests aprovados.\n";
