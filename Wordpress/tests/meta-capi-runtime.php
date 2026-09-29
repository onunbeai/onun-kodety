<?php

/**
 * Isolated contracts for the Meta Conversions API integration.
 *
 * Run with: php Wordpress/tests/meta-capi-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);

final class WP_Error {
    public function __construct(private string $code, private string $message = '', private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Request {
    public function __construct(private array $headers = [], private array $payload = []) {
        $this->headers = array_change_key_case($headers, CASE_LOWER);
    }
    public function get_header(string $name): string { return (string) ($this->headers[strtolower($name)] ?? ''); }
    public function get_json_params(): array { return $this->payload; }
}

final class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
}
final class WP_REST_Server { public const EDITABLE = 'POST,PUT,PATCH'; }
final class WP_User {
    public int $ID = 0;
    public string $user_email = '';
}

final class Kodety_Analytics {
    public static bool $consent_enabled = false;
    public static function consent_manager_enabled(): bool { return self::$consent_enabled; }
}

final class Kodety_Edition {
    public static bool $analytics_meta_capi = true;
    /** @var list<string> */
    public static array $feature_checks = [];
    public static function has(string $feature): bool {
        self::$feature_checks[] = $feature;
        return $feature === 'analyticsMetaCapi' && self::$analytics_meta_capi;
    }
    public static function license_url(): string { return 'https://example.test/wp-admin/admin.php?page=kodety-license'; }
    public static function upgrade_url(): string { return 'https://example.test/upgrade'; }
}

$kodety_meta_options = [];
$kodety_meta_http = null;
$kodety_meta_http_result = null;
$kodety_meta_fail_option = '';
$kodety_meta_schedule_result = true;
$kodety_meta_scheduled = [];
$kodety_meta_transients = [];
$kodety_meta_nocache_calls = 0;

function get_option(string $name, mixed $default = false): mixed { global $kodety_meta_options; return $kodety_meta_options[$name] ?? $default; }
function update_option(string $name, mixed $value, mixed $autoload = null): bool {
    global $kodety_meta_options, $kodety_meta_fail_option;
    if ($name === $kodety_meta_fail_option) return false;
    $kodety_meta_options[$name] = $value;
    return true;
}
function add_option(string $name, mixed $value, string $deprecated = '', mixed $autoload = null): bool { global $kodety_meta_options; $kodety_meta_options[$name] = $value; return true; }
function get_transient(string $name): mixed { global $kodety_meta_transients; return $kodety_meta_transients[$name] ?? false; }
function set_transient(string $name, mixed $value, int $expiration = 0): bool { global $kodety_meta_transients; $kodety_meta_transients[$name] = $value; return true; }
function wp_next_scheduled(string $hook, array $args = []): int|false { global $kodety_meta_scheduled; return $kodety_meta_scheduled[$hook] ?? false; }
function wp_schedule_single_event(int $timestamp, string $hook, array $args = [], bool $wp_error = false): bool|WP_Error {
    global $kodety_meta_schedule_result, $kodety_meta_scheduled;
    if ($kodety_meta_schedule_result instanceof WP_Error) return $kodety_meta_schedule_result;
    if ($kodety_meta_schedule_result === false) return false;
    $kodety_meta_scheduled[$hook] = $timestamp;
    return true;
}
function absint(mixed $value): int { return abs((int) $value); }
function rest_sanitize_boolean(mixed $value): bool {
    if (is_bool($value)) return $value;
    return filter_var($value, FILTER_VALIDATE_BOOLEAN);
}
function is_admin(): bool { return false; }
function nocache_headers(): void { global $kodety_meta_nocache_calls; $kodety_meta_nocache_calls++; }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: ''; }
function wp_unslash(mixed $value): mixed { return is_string($value) ? stripslashes($value) : $value; }
function sanitize_text_field(string $value): string { return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? '')); }
function sanitize_email(string $value): string { return filter_var(strtolower(trim($value)), FILTER_VALIDATE_EMAIL) ? strtolower(trim($value)) : ''; }
function is_email(string $value): bool { return sanitize_email($value) !== ''; }
function remove_accents(string $value): string { return iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value) ?: $value; }
function esc_url_raw(string $value): string { return filter_var($value, FILTER_VALIDATE_URL) ? $value : ''; }
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function rest_url(string $path = ''): string { return 'https://example.test/wp-json/' . ltrim($path, '/'); }
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function wp_salt(string $scheme = 'auth'): string { return 'meta-capi-test-salt-' . $scheme; }
function wp_generate_uuid4(): string { return '12345678-1234-4abc-8def-123456789abc'; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function wp_safe_remote_post(string $url, array $args): array|WP_Error {
    global $kodety_meta_http, $kodety_meta_http_result;
    $kodety_meta_http = ['url' => $url, 'args' => $args];
    if ($kodety_meta_http_result instanceof WP_Error || is_array($kodety_meta_http_result)) {
        return $kodety_meta_http_result;
    }
    return ['response' => ['code' => 200, 'message' => 'OK'], 'body' => '{"events_received":1,"fbtrace_id":"trace-123"}'];
}
function wp_remote_retrieve_response_code(array $response): int { return (int) ($response['response']['code'] ?? 0); }
function wp_remote_retrieve_response_message(array $response): string { return (string) ($response['response']['message'] ?? ''); }
function wp_remote_retrieve_body(array $response): string { return (string) ($response['body'] ?? ''); }
function wp_remote_retrieve_header(array $response, string $name): mixed {
    $headers = is_array($response['headers'] ?? null) ? array_change_key_case($response['headers'], CASE_LOWER) : [];
    return $headers[strtolower($name)] ?? '';
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-meta-capi.php';

function kodety_meta_private(object $object, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($object, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke($object, ...$arguments);
}

function kodety_meta_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$reflection = new ReflectionClass(Kodety_Meta_CAPI::class);
$capi = $reflection->newInstanceWithoutConstructor();

$user_data = kodety_meta_private($capi, 'normalize_user_data', [
    'email' => ' Person@Example.Test ',
    'phone' => '+55 (11) 99999-0000',
    'firstName' => 'João',
    'fbp' => 'fb.1.1712345678901.123456789',
    'fbc' => 'invalid',
    'client_ip_address' => '203.0.113.7',
]);
kodety_meta_assert(
    ($user_data['em'] ?? '') === hash('sha256', 'person@example.test'),
    'e-mail deve ser normalizado e convertido para SHA-256'
);
kodety_meta_assert(
    ($user_data['ph'] ?? '') === hash('sha256', '5511999990000'),
    'telefone deve conter apenas dígitos antes do hash'
);
kodety_meta_assert(
    ($user_data['fn'] ?? '') === hash('sha256', 'joao'),
    'nome deve remover acentos antes do hash'
);
kodety_meta_assert(
    ($user_data['client_ip_address'] ?? '') === '203.0.113.7'
        && ($user_data['fbp'] ?? '') === 'fb.1.1712345678901.123456789'
        && !isset($user_data['fbc']),
    'IP/fbp não devem receber hash e um fbc inválido deve ser descartado'
);

$event = kodety_meta_private($capi, 'prepare_event', [
    'eventName' => 'Purchase',
    'eventId' => 'purchase-order-123',
    'eventTime' => time(),
    'eventSourceUrl' => 'https://example.test/checkout/success',
    'userData' => ['email' => 'buyer@example.test'],
    'customData' => [
        'value' => 129.9,
        'currency' => 'brl',
        'content_ids' => ['plan-pro', '<script>'],
        'contents' => [['id' => 'plan-pro', 'quantity' => 1, 'item_price' => 129.9]],
    ],
]);
kodety_meta_assert(
    is_array($event)
        && $event['event_name'] === 'Purchase'
        && $event['event_id'] === 'purchase-order-123'
        && $event['custom_data']['currency'] === 'BRL'
        && $event['custom_data']['value'] === 129.9,
    'evento deve preservar deduplicação e dados comerciais válidos'
);

$encrypted = kodety_meta_private($capi, 'encrypt', 'EAA-secret-token');
kodety_meta_assert(
    is_string($encrypted)
        && str_starts_with($encrypted, 'v1:')
        && kodety_meta_private($capi, 'decrypt', $encrypted) === 'EAA-secret-token',
    'token deve completar round-trip AES-256-GCM'
);

$kodety_meta_options['kodety_meta_capi_settings'] = [
    'enabled' => true,
    'pixel_id' => '123456789012345',
    'access_token' => $encrypted,
    'graph_version' => 'v23.0',
    'test_event_code' => 'TEST12345',
    'data_processing_options' => [],
    'data_processing_country' => 0,
    'data_processing_state' => 0,
    'last_result' => null,
];
$result = kodety_meta_private($capi, 'deliver', [$event], true);
kodety_meta_assert(is_array($result) && ($result['events_received'] ?? 0) === 1, 'resposta aceita da Meta deve ser propagada');
kodety_meta_assert(
    $kodety_meta_http['url'] === 'https://graph.facebook.com/v23.0/123456789012345/events',
    'endpoint deve ser escopado por versão e Pixel ID'
);
kodety_meta_assert(
    ($kodety_meta_http['args']['headers']['Authorization'] ?? '') === 'Bearer EAA-secret-token',
    'token deve trafegar somente no cabeçalho Authorization'
);
kodety_meta_assert(
    ($kodety_meta_http['args']['redirection'] ?? -1) === 0
        && ($kodety_meta_http['args']['reject_unsafe_urls'] ?? false) === true
        && ($kodety_meta_http['args']['limit_response_size'] ?? 0) === 1024 * 1024,
    'resposta da Meta deve usar transporte sem redirect e com corpo limitado'
);
$sent = json_decode((string) $kodety_meta_http['args']['body'], true);
kodety_meta_assert(
    ($sent['data'][0]['event_id'] ?? '') === 'purchase-order-123'
        && ($sent['test_event_code'] ?? '') === 'TEST12345',
    'payload Graph deve manter event_id e código de teste'
);

$kodety_meta_http_result = [
    'response' => ['code' => 200, 'message' => 'OK'],
    'body' => '<html>upstream proxy error</html>',
];
$invalid_json = kodety_meta_private($capi, 'deliver', [$event], true);
$invalid_json_result = $kodety_meta_options['kodety_meta_capi_settings']['last_result'] ?? null;
kodety_meta_assert(
    $invalid_json instanceof WP_Error
        && $invalid_json->get_error_code() === 'kodety_meta_capi_delivery'
        && ($invalid_json->get_error_data()['status'] ?? 0) === 502
        && ($invalid_json->get_error_data()['retryable'] ?? false) === true
        && is_array($invalid_json_result)
        && ($invalid_json_result['success'] ?? true) === false,
    '2xx com JSON inválido deve falhar fechado e permanecer elegível para retry idempotente'
);

$kodety_meta_http_result = [
    'response' => ['code' => 200, 'message' => 'OK'],
    'body' => '{"events_received":0,"fbtrace_id":"trace-partial"}',
];
$partial_delivery = kodety_meta_private($capi, 'deliver', [$event], true);
kodety_meta_assert(
    $partial_delivery instanceof WP_Error
        && $partial_delivery->get_error_code() === 'kodety_meta_capi_delivery'
        && ($partial_delivery->get_error_data()['status'] ?? 0) === 502
        && ($kodety_meta_options['kodety_meta_capi_settings']['last_result']['requestId'] ?? '') === 'trace-partial'
        && ($kodety_meta_options['kodety_meta_capi_settings']['last_result']['success'] ?? true) === false,
    '2xx parcial não pode confirmar menos eventos que o lote enviado'
);

$retry_after_date = time() + 300;
$kodety_meta_http_result = [
    'response' => ['code' => 503, 'message' => 'Service Unavailable'],
    'headers' => ['Retry-After' => gmdate('D, d M Y H:i:s \\G\\M\\T', $retry_after_date)],
    'body' => '{"error":{"message":"temporarily unavailable","fbtrace_id":"trace-503"}}',
];
$unavailable_delivery = kodety_meta_private($capi, 'deliver', [$event], true);
$unavailable_data = $unavailable_delivery instanceof WP_Error ? $unavailable_delivery->get_error_data() : [];
kodety_meta_assert(
    $unavailable_delivery instanceof WP_Error
        && ($unavailable_data['retryable'] ?? false) === true
        && ($unavailable_data['retry_after'] ?? 0) >= 295
        && ($unavailable_data['retry_after'] ?? 0) <= 300,
    '503 deve interpretar Retry-After HTTP-date sem ultrapassar o atraso solicitado'
);
$kodety_meta_http_result = null;

$public = kodety_meta_private($capi, 'public_settings');
kodety_meta_assert(
    ($public['configured'] ?? false) === true
        && !array_key_exists('access_token', $public)
        && !array_key_exists('accessToken', $public),
    'a resposta administrativa nunca deve expor o token'
);

$kodety_meta_options['kodety_meta_capi_settings']['last_result'] = [
    'success' => true,
    'message' => '17 eventos aceitos',
    'requestId' => 'trace-private-17',
    'httpStatus' => 200,
    'eventsReceived' => 17,
    'at' => gmdate('c'),
];
$expired_queue = [[
    'id' => 'queued-before-expiry',
    'events' => [$event],
    'attempt' => 1,
    'created_at' => time(),
    'next_attempt' => time() - 1,
    'last_error' => 'offline',
]];
$kodety_meta_options['kodety_meta_capi_retry_queue'] = $expired_queue;
Kodety_Edition::$analytics_meta_capi = false;

$free_settings_response = $capi->get_settings();
$free_settings = $free_settings_response->get_data();
kodety_meta_assert(
    $free_settings_response->get_status() === 200
        && ($free_settings['configured'] ?? false) === true
        && ($free_settings['pixelId'] ?? '') === '123456789012345'
        && ($free_settings['enabled'] ?? true) === false,
    'Free deve poder ver a configuração salva, mas sempre com ativação efetiva desligada'
);
kodety_meta_assert(
    ($free_settings['lastResult'] ?? null) === null
        && ($free_settings['queuedEvents'] ?? -1) === 0
        && !array_key_exists('access_token', $free_settings)
        && !array_key_exists('accessToken', $free_settings),
    'Free não pode receber token, resultado operacional nem quantidade real da fila'
);

$free_configuration_token = 'EAA-free-configuration-secret';
$free_configuration_response = $capi->update_settings(new WP_REST_Request([], [
    'enabled' => false,
    'pixelId' => '9988776655',
    'accessToken' => $free_configuration_token,
    'graphVersion' => 'v24.0',
    'testEventCode' => 'TESTFREE123',
    'limitedDataUse' => true,
    'dataProcessingCountry' => 1,
    'dataProcessingState' => 35,
]));
kodety_meta_assert(
    $free_configuration_response instanceof WP_REST_Response
        && $free_configuration_response->get_status() === 200
        && ($free_configuration_response->get_data()['configured'] ?? false) === true
        && ($free_configuration_response->get_data()['enabled'] ?? true) === false
        && ($free_configuration_response->get_data()['pixelId'] ?? '') === '9988776655',
    'Free deve poder salvar credenciais e opções enquanto a integração permanece inativa'
);
$stored_free_configuration = $kodety_meta_options['kodety_meta_capi_settings'];
kodety_meta_assert(
    ($stored_free_configuration['access_token'] ?? '') !== $free_configuration_token
        && kodety_meta_private($capi, 'decrypt', (string) ($stored_free_configuration['access_token'] ?? '')) === $free_configuration_token,
    'token configurado no Free deve continuar criptografado em repouso'
);

$before_forbidden_activation = $kodety_meta_options['kodety_meta_capi_settings'];
$forbidden_secret = 'EAA-activation-secret-must-not-leak';
$forbidden_pixel = '112233445566';
$forbidden_activation = $capi->update_settings(new WP_REST_Request([], [
    'enabled' => true,
    'pixelId' => $forbidden_pixel,
    'accessToken' => $forbidden_secret,
]));
$forbidden_activation_output = wp_json_encode([
    'message' => $forbidden_activation instanceof WP_Error ? $forbidden_activation->get_error_message() : '',
    'data' => $forbidden_activation instanceof WP_Error ? $forbidden_activation->get_error_data() : null,
]);
kodety_meta_assert(
    $forbidden_activation instanceof WP_Error
        && $forbidden_activation->get_error_code() === 'kodety_meta_capi_pro_required'
        && ($forbidden_activation->get_error_data()['status'] ?? 0) === 403
        && $kodety_meta_options['kodety_meta_capi_settings'] === $before_forbidden_activation,
    'Free não pode ativar a Meta CAPI nem alterar opções durante a tentativa'
);
kodety_meta_assert(
    is_string($forbidden_activation_output)
        && !str_contains($forbidden_activation_output, $forbidden_secret)
        && !str_contains($forbidden_activation_output, $forbidden_pixel),
    'erro de licença não pode refletir credencial nem Pixel ID enviados'
);

// Simulate a configuration that was active immediately before its Pro grant
// expired. Every execution path must stop without mutating or draining data.
$kodety_meta_options['kodety_meta_capi_settings']['enabled'] = true;
$kodety_meta_options['kodety_meta_capi_retry_queue'] = $expired_queue;
$kodety_meta_http = null;
$kodety_meta_http_result = null;
$kodety_meta_scheduled = [];
$expired_delivery = kodety_meta_private($capi, 'deliver', [$event], true);
$expired_collect = $capi->collect(new WP_REST_Request(
    ['Origin' => 'https://example.test', 'User-Agent' => 'Kodety expired'],
    ['eventName' => 'Lead', 'eventId' => 'expired-event-123']
));
$expired_test = $capi->test_connection(new WP_REST_Request());
$expired_enqueue = kodety_meta_private($capi, 'enqueue', [$event], 1, 'provider offline');
kodety_meta_assert(
    $expired_delivery instanceof WP_Error
        && $expired_delivery->get_error_code() === 'kodety_meta_capi_pro_required'
        && $expired_collect instanceof WP_Error
        && $expired_collect->get_error_code() === 'kodety_meta_capi_pro_required'
        && $expired_test instanceof WP_Error
        && $expired_test->get_error_code() === 'kodety_meta_capi_pro_required'
        && $expired_enqueue instanceof WP_Error
        && $expired_enqueue->get_error_code() === 'kodety_meta_capi_pro_required'
        && $kodety_meta_http === null,
    'licença expirada deve bloquear sink, coleta, teste e enqueue antes de qualquer chamada à Meta'
);
$expired_collect_data = $expired_collect instanceof WP_Error ? $expired_collect->get_error_data() : [];
kodety_meta_assert(
    is_array($expired_collect_data)
        && !array_key_exists('accepted', $expired_collect_data)
        && !array_key_exists('eventsReceived', $expired_collect_data)
        && !array_key_exists('requestId', $expired_collect_data)
        && !array_key_exists('queued', $expired_collect_data),
    '403 Free não pode incluir contagens, IDs de entrega ou estado real da fila'
);
kodety_meta_private($capi, 'deliver_or_queue', [$event]);
$expired_user = new WP_User();
$expired_user->ID = 42;
$expired_user->user_email = 'expired@example.test';
$capi->track_member_registration(42, $expired_user);
$capi->track_checkout_sale(
    'expired-sale-123',
    42,
    7,
    'paid',
    'granted',
    ['amount' => 9900, 'currency' => 'BRL']
);
$capi->process_retry_queue();
$capi->ensure_retry_schedule();
ob_start();
$capi->print_runtime();
$expired_runtime = (string) ob_get_clean();
kodety_meta_assert(
    kodety_meta_private($capi, 'enabled') === false
        && $expired_runtime === ''
        && $kodety_meta_http === null
        && $kodety_meta_options['kodety_meta_capi_retry_queue'] === $expired_queue
        && $kodety_meta_scheduled === [],
    'expiração deve remover o runtime público e pausar hooks/fila sem enviar ou descartar eventos'
);
kodety_meta_assert(
    array_values(array_unique(Kodety_Edition::$feature_checks)) === ['analyticsMetaCapi'],
    'todos os gates devem consultar somente o entitlement analyticsMetaCapi'
);

Kodety_Edition::$analytics_meta_capi = true;
$kodety_meta_options['kodety_meta_capi_retry_queue'] = [];
$kodety_meta_http = null;
$pro_activation = $capi->update_settings(new WP_REST_Request([], ['enabled' => true]));
$pro_test = $capi->test_connection(new WP_REST_Request(['User-Agent' => 'Kodety Pro control']));
kodety_meta_assert(
    $pro_activation instanceof WP_REST_Response
        && ($pro_activation->get_data()['enabled'] ?? false) === true
        && $pro_test instanceof WP_REST_Response
        && $pro_test->get_status() === 200
        && $kodety_meta_http !== null,
    'Pro deve continuar podendo ativar e executar um teste real pela mesma fronteira'
);
ob_start();
$capi->print_runtime();
$pro_runtime = (string) ob_get_clean();
kodety_meta_assert(
    str_contains($pro_runtime, 'data-kodety-meta-capi="1"')
        && defined('DONOTCACHEPAGE')
        && DONOTCACHEPAGE === true
        && defined('LSCACHE_NO_CACHE')
        && LSCACHE_NO_CACHE === true
        && $kodety_meta_nocache_calls > 0,
    'runtime Pro da Meta deve desabilitar full-page cache antes de sair no HTML'
);

$retry_payload = [
    'eventName' => 'Lead',
    'eventId' => 'lead-retry-123',
    'eventTime' => time(),
    'eventSourceUrl' => 'https://example.test/contact',
];
$retry_request = new WP_REST_Request(
    ['Origin' => 'https://example.test', 'User-Agent' => 'Kodety test'],
    $retry_payload
);
Kodety_Analytics::$consent_enabled = true;
unset($_COOKIE['kodety_consent_marketing']);
$without_marketing_consent = kodety_meta_private($capi, 'public_request_allowed', $retry_request);
kodety_meta_assert(
    $without_marketing_consent instanceof WP_Error
        && $without_marketing_consent->get_error_code() === 'kodety_meta_capi_privacy',
    'a CAPI server-side deve recusar eventos enquanto Marketing não foi concedido'
);
$_COOKIE['kodety_consent_marketing'] = 'granted';
$with_marketing_consent = kodety_meta_private($capi, 'public_request_allowed', $retry_request);
kodety_meta_assert($with_marketing_consent === true, 'a CAPI deve liberar eventos após consentimento explícito de Marketing');
Kodety_Analytics::$consent_enabled = false;
unset($_COOKIE['kodety_consent_marketing']);
$kodety_meta_http_result = [
    'response' => ['code' => 429, 'message' => 'Too Many Requests'],
    'headers' => ['Retry-After' => '7200'],
    'body' => '{"error":{"message":"rate limited","fbtrace_id":"trace-429"}}',
];
$kodety_meta_options['kodety_meta_capi_retry_queue'] = [];
$kodety_meta_schedule_result = true;
$kodety_meta_scheduled = [];
$rate_limit_started = time();
$rate_limit_response = $capi->collect($retry_request);
$rate_limit_item = $kodety_meta_options['kodety_meta_capi_retry_queue'][0] ?? [];
kodety_meta_assert(
    $rate_limit_response instanceof WP_REST_Response
        && $rate_limit_response->get_status() === 202
        && ($rate_limit_response->get_data()['queued'] ?? false) === true
        && ($rate_limit_item['next_attempt'] ?? 0) >= $rate_limit_started + HOUR_IN_SECONDS
        && ($rate_limit_item['next_attempt'] ?? 0) <= time() + HOUR_IN_SECONDS
        && ($kodety_meta_scheduled['kodety_meta_capi_retry'] ?? 0) === ($rate_limit_item['next_attempt'] ?? -1)
        && ($rate_limit_item['events'][0]['event_id'] ?? '') === 'lead-retry-123'
        && !str_contains((string) wp_json_encode($rate_limit_item), 'EAA-secret-token'),
    '429 deve respeitar Retry-After na fila, limitado a uma hora e com agendamento durável'
);
$kodety_meta_http_result = new WP_Error('http_request_failed', 'provider offline');
$kodety_meta_options['kodety_meta_capi_retry_queue'] = [];
$kodety_meta_schedule_result = false;
$kodety_meta_scheduled = [];
$schedule_failure = $capi->collect($retry_request);
kodety_meta_assert(
    $schedule_failure instanceof WP_Error
        && $schedule_failure->get_error_code() === 'kodety_meta_capi_queue_schedule'
        && ($schedule_failure->get_error_data()['status'] ?? 0) === 503
        && ($schedule_failure->get_error_data()['retryable'] ?? false) === true
        && ($schedule_failure->get_error_data()['queuedPersisted'] ?? false) === true,
    'falha do cron deve responder 503 retryable, nunca queued:true'
);
kodety_meta_assert(
    count($kodety_meta_options['kodety_meta_capi_retry_queue'] ?? []) === 1,
    'falha do cron deve manter o evento persistido para rearmar em outro request'
);

$kodety_meta_schedule_result = true;
kodety_meta_private($capi, 'ensure_retry_schedule');
kodety_meta_assert(
    wp_next_scheduled('kodety_meta_capi_retry') !== false,
    'uma fila persistida deve ser rearmada no próximo init'
);

$kodety_meta_options['kodety_meta_capi_retry_queue'] = [];
$kodety_meta_scheduled = [];
$kodety_meta_fail_option = 'kodety_meta_capi_retry_queue';
$storage_failure = $capi->collect($retry_request);
kodety_meta_assert(
    $storage_failure instanceof WP_Error
        && $storage_failure->get_error_code() === 'kodety_meta_capi_queue_storage'
        && ($storage_failure->get_error_data()['status'] ?? 0) === 503
        && ($storage_failure->get_error_data()['queuedPersisted'] ?? true) === false,
    'falha de persistência deve responder 503 retryable, nunca queued:true'
);
kodety_meta_assert(
    ($kodety_meta_options['kodety_meta_capi_retry_queue'] ?? []) === [],
    'a fila não deve alegar persistência quando update_option falhar'
);

$original_retry = [[
    'id' => 'retry-worker-preserved',
    'events' => [$event],
    'attempt' => 1,
    'created_at' => time(),
    'next_attempt' => time() - 1,
    'last_error' => 'offline',
]];
$kodety_meta_options['kodety_meta_capi_retry_queue'] = $original_retry;
$kodety_meta_scheduled = [];
$capi->process_retry_queue();
kodety_meta_assert(
    $kodety_meta_options['kodety_meta_capi_retry_queue'] === $original_retry,
    'worker deve preservar a fila anterior quando a atualização durável falhar'
);
kodety_meta_assert(
    wp_next_scheduled('kodety_meta_capi_retry') !== false,
    'worker deve rearmar a fila preservada após falha de persistência'
);

$kodety_meta_fail_option = '';
$kodety_meta_options['kodety_meta_capi_retry_queue'] = [];
$kodety_meta_scheduled = [];
$queued_response = $capi->collect($retry_request);
kodety_meta_assert(
    $queued_response instanceof WP_REST_Response
        && $queued_response->get_status() === 202
        && ($queued_response->get_data()['queued'] ?? false) === true
        && count($kodety_meta_options['kodety_meta_capi_retry_queue'] ?? []) === 1
        && wp_next_scheduled('kodety_meta_capi_retry') !== false,
    'queued:true só pode ser retornado após option e cron confirmados'
);

$source = file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-meta-capi.php');
kodety_meta_assert(str_contains($source, 'eventID: eventId'), 'runtime deve enviar o mesmo event_id ao Meta Pixel');
kodety_meta_assert(str_contains($source, 'kodety:meta-pixel-ready'), 'runtime deve aguardar o Pixel/consentimento antes do PageView');
kodety_meta_assert(str_contains($source, 'kodety_meta_capi_retry'), 'falhas transitórias devem entrar em retry');
kodety_meta_assert(
    str_contains($source, 'manager.has("marketing") === true')
        && str_contains($source, '!marketingConsentGranted()')
        && str_contains($source, 'config.consentRequired')
        && str_contains($source, 'window.__kodetyMarketingConsentGranted === true'),
    'todo envio CAPI/Pixel deve consultar a categoria Marketing no consent manager'
);
kodety_meta_assert(
    !preg_match('/keepalive:\\s*true,\\s*keepalive:\\s*true,/', $source),
    'runtime não deve emitir propriedades keepalive duplicadas'
);

echo "Meta CAPI runtime tests passed.\n";
