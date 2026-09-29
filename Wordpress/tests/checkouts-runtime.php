<?php

/**
 * Isolated provider, security and lifecycle contracts for Kodety Checkouts.
 *
 * Run with: php Wordpress/tests/checkouts-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('DAY_IN_SECONDS', 86400);
define('ARRAY_A', 'ARRAY_A');

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message = '',
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Request implements ArrayAccess {
    public function __construct(
        private array $params = [],
        private array $headers = [],
        private string $method = 'GET'
    ) {
        $this->headers = array_change_key_case($this->headers, CASE_LOWER);
    }
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
    public function get_header(string $name): string {
        return (string) ($this->headers[strtolower($name)] ?? '');
    }
    public function get_method(): string { return $this->method; }
    public function get_body(): string { return ''; }
    public function get_json_params(): array { return []; }
    public function get_params(): array { return $this->params; }
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
    public function get_headers(): array { return $this->headers; }
}

class WP_User {
    public function __construct(
        public int $ID = 1,
        public string $user_email = 'member@example.test',
        public string $user_login = 'member'
    ) {}
}

function sanitize_key(string $value): string {
    return preg_replace('/[^a-z0-9_\-]/', '', strtolower($value)) ?: '';
}
function sanitize_text_field(string $value): string {
    return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? ''));
}
function sanitize_email(string $value): string {
    return filter_var($value, FILTER_VALIDATE_EMAIL) ? strtolower($value) : '';
}
function is_email(string $value): bool {
    return filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
}
function rest_sanitize_boolean(mixed $value): bool {
    if (is_bool($value)) return $value;
    return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
}
function absint(mixed $value): int { return abs((int) $value); }
function wp_parse_url(string $url, int $component = -1): mixed {
    return parse_url($url, $component);
}
function home_url(string $path = ''): string {
    return 'https://example.test/' . ltrim($path, '/');
}
function esc_url_raw(string $value, ?array $protocols = null): string {
    return filter_var($value, FILTER_VALIDATE_URL) ? $value : '';
}
function add_query_arg(array $arguments, string $url): string {
    if (!$arguments) return $url;
    return $url
        . (str_contains($url, '?') ? '&' : '?')
        . http_build_query($arguments, '', '&', PHP_QUERY_RFC3986);
}
function wp_json_encode(mixed $value, int $flags = 0): string|false {
    return json_encode($value, $flags);
}
function wp_salt(string $scheme = 'auth'): string {
    return 'kodety-checkouts-test-salt-' . $scheme;
}
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function current_time(string $type, bool $gmt = false): string {
    return '2026-07-27 12:00:00';
}
function wp_generate_uuid4(): string {
    static $sequence = 0;
    $sequence++;
    return sprintf('00000000-0000-4000-8000-%012d', $sequence);
}
function wp_safe_remote_request(string $url, array $arguments): array|WP_Error {
    $count = (int) ($GLOBALS['checkout_provider_request_count'] ?? 0) + 1;
    $GLOBALS['checkout_provider_request_count'] = $count;
    $GLOBALS['checkout_remote_requests'][] = [
        'url' => $url,
        'arguments' => $arguments,
    ];
    if (str_contains($url, 'api-sec-vlc.hotmart.com/security/oauth/token')) {
        return [
            'response' => ['code' => 200],
            'body' => json_encode([
                'access_token' => 'hotmart-access-token',
                'expires_in' => 3600,
            ], JSON_UNESCAPED_SLASHES),
        ];
    }
    if (
        str_contains($url, 'developers.hotmart.com/products/api/v1/products')
        || str_contains($url, 'sandbox.hotmart.com/products/api/v1/products')
    ) {
        return [
            'response' => ['code' => 200],
            'body' => json_encode([
                'items' => [[
                    'id' => 9001,
                    'ucode' => 'product-ucode',
                    'name' => 'Produto Hotmart',
                    'status' => 'ACTIVE',
                    'is_subscription' => true,
                ]],
            ], JSON_UNESCAPED_SLASHES),
        ];
    }
    $suffix = $count === 1 ? 'reusable' : 'new_' . $count;
    return [
        'response' => ['code' => 200],
        'body' => json_encode([
            'id' => 'cs_ack_' . $suffix,
            'url' => 'https://checkout.stripe.com/c/pay/' . $suffix,
            'expires_at' => 2_000_000_000,
        ], JSON_UNESCAPED_SLASHES),
    ];
}
function wp_remote_retrieve_response_code(array $response): int {
    return (int) ($response['response']['code'] ?? 0);
}
function wp_remote_retrieve_body(array $response): string {
    return (string) ($response['body'] ?? '');
}
function get_transient(string $key): mixed {
    return $GLOBALS['checkout_transients'][$key] ?? false;
}
function set_transient(string $key, mixed $value, int $expiration = 0): bool {
    $GLOBALS['checkout_transients'][$key] = $value;
    return true;
}
function get_option(string $key, mixed $default = false): mixed {
    return $GLOBALS['checkout_options'][$key] ?? $default;
}
function update_option(
    string $key,
    mixed $value,
    bool|string|null $autoload = null
): bool {
    $GLOBALS['checkout_options'][$key] = $value;
    return true;
}
function dbDelta(string $sql): array {
    $GLOBALS['checkout_dbdelta'][] = $sql;
    return [];
}

final class Kodety_Members {
    private static ?self $instance = null;
    public static function instance(): self { return self::$instance ??= new self(); }
    public function recover_stale_provider_events(int $age, int $limit): int { return 0; }
}

final class Checkout_Ack_Wpdb {
    public string $prefix = 'wp_';
    public int $insert_id = 0;
    public bool $fail_next_sales_ack_update = true;
    /** @var array<int,array<string,mixed>> */
    public array $sales = [];
    /** @var array<int,array<string,mixed>> */
    public array $artifacts = [];
    /** @var array<int,array<string,mixed>> */
    public array $connections = [];
    private int $next_sale_id = 1;
    private int $next_artifact_id = 1;

    public function get_charset_collate(): string {
        return 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci';
    }

    public function get_var(string $query): mixed {
        if (str_contains($query, 'SHOW TABLES LIKE')) {
            return $this->prefix . 'kodety_checkout_artifacts';
        }
        return null;
    }

    public function prepare(string $query, mixed ...$arguments): string {
        foreach ($arguments as $argument) {
            if (!preg_match('/%[sd]/', $query, $match, PREG_OFFSET_CAPTURE)) break;
            $token = $match[0][0];
            $offset = $match[0][1];
            $replacement = $token === '%d'
                ? (string) ((int) $argument)
                : "'" . str_replace("'", "''", (string) $argument) . "'";
            $query = substr_replace($query, $replacement, $offset, 2);
        }
        return $query;
    }

    public function insert(string $table, array $data): int|false {
        if ($table === $this->prefix . 'kodety_checkout_sales') {
            foreach ($this->sales as $row) {
                if (
                    (string) ($row['external_sale_key'] ?? '')
                    === (string) ($data['external_sale_key'] ?? '')
                ) {
                    return false;
                }
            }
            $id = $this->next_sale_id++;
            $data['id'] = $id;
            $this->sales[$id] = $data;
            $this->insert_id = $id;
            return 1;
        }
        if ($table === $this->prefix . 'kodety_checkout_artifacts') {
            foreach ($this->artifacts as $row) {
                if (
                    (string) ($row['external_key'] ?? '')
                        === (string) ($data['external_key'] ?? '')
                    || (string) ($row['local_reference'] ?? '')
                        === (string) ($data['local_reference'] ?? '')
                ) {
                    return false;
                }
            }
            $id = $this->next_artifact_id++;
            $data['id'] = $id;
            $this->artifacts[$id] = $data;
            $this->insert_id = $id;
            return 1;
        }
        return false;
    }

    public function update(string $table, array $data, array $where): int|false {
        if ($table === $this->prefix . 'kodety_checkout_connections') {
            $id = (int) ($where['id'] ?? 0);
            if (isset($this->connections[$id])) {
                $this->connections[$id] = array_merge($this->connections[$id], $data);
            }
            return 1;
        }
        if ($table === $this->prefix . 'kodety_checkout_sales') {
            if (
                $this->fail_next_sales_ack_update
                && array_key_exists('external_sale_id', $data)
            ) {
                $this->fail_next_sales_ack_update = false;
                return false;
            }
            foreach ($this->sales as $id => $row) {
                if (!$this->matches($row, $where)) continue;
                $this->sales[$id] = array_merge($row, $data);
                return 1;
            }
            return 0;
        }
        if ($table === $this->prefix . 'kodety_checkout_artifacts') {
            foreach ($this->artifacts as $id => $row) {
                if (!$this->matches($row, $where)) continue;
                $this->artifacts[$id] = array_merge($row, $data);
                return 1;
            }
            return 0;
        }
        return false;
    }

    public function get_row(string $query, string $format = ARRAY_A): ?array {
        if (str_contains($query, $this->prefix . 'kodety_checkout_connections')) {
            if (preg_match('/WHERE id=(\d+)/', $query, $match)) {
                return $this->connections[(int) $match[1]] ?? null;
            }
        }
        if (
            str_contains($query, $this->prefix . 'kodety_checkout_artifacts')
            && str_contains($query, 'request_fingerprint=')
        ) {
            if (!preg_match("/request_fingerprint='([a-f0-9]{64})'/", $query, $match)) {
                return null;
            }
            $candidates = array_reverse($this->artifacts, true);
            foreach ($candidates as $artifact) {
                $sale = $this->sales[(int) ($artifact['sale_id'] ?? 0)] ?? null;
                $expires = ($artifact['expires_at'] ?? null) !== null
                    ? strtotime((string) $artifact['expires_at'] . ' UTC')
                    : null;
                if (
                    (string) ($artifact['request_fingerprint'] ?? '') === $match[1]
                    && is_array($sale)
                    && (string) ($sale['status'] ?? '') === 'pending'
                    && ($expires === null
                        || $expires > strtotime('2026-07-27 12:00:00 UTC'))
                ) {
                    return $artifact;
                }
            }
            return null;
        }
        if (
            str_contains($query, $this->prefix . 'kodety_checkout_artifacts')
            && str_contains($query, 'external_key=')
        ) {
            preg_match("/external_key='([^']*)'/", $query, $external_match);
            preg_match("/local_reference='([^']*)'/", $query, $reference_match);
            foreach (array_reverse($this->artifacts, true) as $artifact) {
                if (
                    (string) ($artifact['external_key'] ?? '')
                        === (string) ($external_match[1] ?? '')
                    || (string) ($artifact['local_reference'] ?? '')
                        === (string) ($reference_match[1] ?? '')
                ) {
                    return $artifact;
                }
            }
            return null;
        }
        if (str_contains($query, $this->prefix . 'kodety_checkout_sales')) {
            if (
                preg_match(
                    "/WHERE id=(\\d+) AND uuid='([^']+)'/",
                    $query,
                    $identity
                )
            ) {
                $row = $this->sales[(int) $identity[1]] ?? null;
                return is_array($row) && (string) ($row['uuid'] ?? '') === $identity[2]
                    ? $row
                    : null;
            }
            if (preg_match("/external_sale_key='([^']+)'/", $query, $key_match)) {
                foreach ($this->sales as $row) {
                    if ((string) ($row['external_sale_key'] ?? '') === $key_match[1]) {
                        return $row;
                    }
                }
            }
        }
        return null;
    }

    /** @return list<array<string,mixed>> */
    public function get_results(string $query, string $format = ARRAY_A): array {
        if (
            str_contains($query, $this->prefix . 'kodety_checkout_artifacts')
            && str_contains($query, "status='pending'")
        ) {
            return array_values(array_filter(
                $this->artifacts,
                static fn(array $row): bool => ($row['status'] ?? '') === 'pending'
            ));
        }
        if (
            str_contains($query, $this->prefix . 'kodety_checkout_artifacts')
            && str_contains($query, "a.status='reconciled'")
        ) {
            $now = strtotime('2026-07-27 12:00:00 UTC');
            return array_values(array_filter(
                $this->artifacts,
                function (array $artifact) use ($now): bool {
                    if (
                        ($artifact['status'] ?? '') !== 'reconciled'
                        || ($artifact['checkout_url_encrypted'] ?? '') === ''
                    ) {
                        return false;
                    }
                    $sale = $this->sales[(int) ($artifact['sale_id'] ?? 0)] ?? null;
                    if (!is_array($sale)) return false;
                    $terminal = ($sale['status'] ?? '') !== 'pending';
                    $expires = strtotime((string) ($artifact['expires_at'] ?? '') . ' UTC');
                    return $terminal || ($expires !== false && $expires <= $now);
                }
            ));
        }
        return [];
    }

    private function matches(array $row, array $where): bool {
        foreach ($where as $key => $value) {
            if ((string) ($row[$key] ?? '') !== (string) $value) return false;
        }
        return true;
    }
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-checkouts.php';

function checkout_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function checkout_private(object|string $target, string $method, mixed ...$arguments): mixed {
    $class = is_object($target) ? $target::class : $target;
    $reflection = new ReflectionMethod($class, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke(is_object($target) ? $target : null, ...$arguments);
}

$checkout = (new ReflectionClass(Kodety_Checkouts::class))->newInstanceWithoutConstructor();
$source_path = dirname(__DIR__) . '/kodety/includes/class-kodety-checkouts.php';
$source = (string) file_get_contents($source_path);
$uninstall_source = (string) file_get_contents(
    dirname(__DIR__) . '/kodety/uninstall.php'
);

// Cryptographic webhook contracts.
$now = 1_800_000_000;
$stripe_body = '{"id":"evt_1"}';
$stripe_secret = 'whsec_test';
$stripe_signature = hash_hmac('sha256', $now . '.' . $stripe_body, $stripe_secret);
checkout_assert(
    Kodety_Checkouts::verify_stripe_signature(
        $stripe_body,
        't=' . $now . ',v1=' . $stripe_signature,
        $stripe_secret,
        $now
    ),
    'Stripe deve aceitar somente HMAC válido dentro da tolerância'
);
checkout_assert(
    !Kodety_Checkouts::verify_stripe_signature(
        $stripe_body,
        't=' . ($now - 301) . ',v1=' . $stripe_signature,
        $stripe_secret,
        $now
    ),
    'Stripe deve rejeitar timestamp fora da tolerância'
);

$mp_timestamp = (string) ($now * 1000);
$mp_manifest = 'id:payment-1;request-id:req-1;ts:' . $mp_timestamp . ';';
$mp_signature = hash_hmac('sha256', $mp_manifest, 'mp-secret');
checkout_assert(
    Kodety_Checkouts::verify_mercado_pago_signature(
        'ts=' . $mp_timestamp . ',v1=' . $mp_signature,
        'req-1',
        'PAYMENT-1',
        'mp-secret',
        $now
    ),
    'Mercado Pago deve verificar o manifesto oficial'
);
checkout_assert(
    Kodety_Checkouts::verify_pagbank_signature(
        $stripe_body,
        hash('sha256', 'pag-token-' . $stripe_body),
        'pag-token'
    ),
    'PagBank moderno deve validar x-authenticity-token'
);
checkout_assert(
    checkout_private(
        $checkout,
        'verify_provider_webhook',
        'hotmart',
        ['hottok' => 'hotmart-hottok-test'],
        new WP_REST_Request([], ['X-HOTMART-HOTTOK' => 'hotmart-hottok-test']),
        '{"event":"PURCHASE_APPROVED"}',
        ['event' => 'PURCHASE_APPROVED']
    ) === true,
    'Hotmart deve autenticar o payload completo pelo header Hottok'
);
checkout_assert(
    checkout_private(
        $checkout,
        'verify_provider_webhook',
        'ticto',
        ['webhookToken' => 'ticto-ultra-secret-test'],
        new WP_REST_Request(),
        '{"status":"authorized"}',
        ['status' => 'authorized', 'token' => 'ticto-ultra-secret-test']
    ) === true,
    'Ticto v2 deve autenticar o payload pelo token ultra secreto'
);
checkout_assert(
    is_wp_error(checkout_private(
        $checkout,
        'verify_provider_webhook',
        'ticto',
        ['webhookToken' => 'ticto-ultra-secret-test'],
        new WP_REST_Request(),
        '{"status":"authorized"}',
        ['status' => 'authorized', 'token' => 'invalid']
    )),
    'Ticto deve rejeitar token divergente'
);

// Catalog and redirect allowlists.
$catalog = [];
foreach (Kodety_Checkouts::provider_catalog() as $provider) {
    $catalog[$provider['id']] = $provider;
}
checkout_assert(count($catalog) === 9, 'catálogo deve expor nove provedores');
checkout_assert(
    in_array('accountEmail', $catalog['pagbank']['requiredCredentialFields'], true),
    'PagBank deve exigir accountEmail para lifecycle legado'
);
checkout_assert(
    !$catalog['mercado_pago']['capabilities']['subscriptions']
        && !$catalog['pagbank']['capabilities']['subscriptions'],
    'capabilities não devem prometer recorrência incompleta'
);
checkout_assert(
    $catalog['hotmart']['capabilities']['subscriptions']
        && $catalog['ticto']['capabilities']['subscriptions']
        && in_array('hottok', $catalog['hotmart']['requiredCredentialFields'], true)
        && in_array('webhookToken', $catalog['ticto']['requiredCredentialFields'], true),
    'Hotmart e Ticto devem declarar recorrência e autenticação obrigatória'
);
$GLOBALS['checkout_provider_request_count'] = 0;
$GLOBALS['checkout_remote_requests'] = [];
$GLOBALS['checkout_transients'] = [];
$hotmart_catalog = checkout_private(
    $checkout,
    'provider_request',
    [
        'id' => 0,
        'provider' => 'hotmart',
        'settings' => '{"environment":"production"}',
    ],
    [
        'clientId' => 'hotmart-client',
        'clientSecret' => 'hotmart-secret',
        'basicToken' => 'Basic hotmart-basic',
        'hottok' => 'hotmart-hottok',
    ],
    'GET',
    '/products/api/v1/products'
);
$hotmart_catalog_cached = checkout_private(
    $checkout,
    'provider_request',
    [
        'id' => 0,
        'provider' => 'hotmart',
        'settings' => '{"environment":"production"}',
    ],
    [
        'clientId' => 'hotmart-client',
        'clientSecret' => 'hotmart-secret',
        'basicToken' => 'Basic hotmart-basic',
        'hottok' => 'hotmart-hottok',
    ],
    'GET',
    '/products/api/v1/products'
);
checkout_assert(
    ($hotmart_catalog['items'][0]['id'] ?? 0) === 9001
        && ($hotmart_catalog_cached['items'][0]['id'] ?? 0) === 9001
        && $GLOBALS['checkout_provider_request_count'] === 3
        && str_contains(
            (string) ($GLOBALS['checkout_remote_requests'][0]['url'] ?? ''),
            'grant_type=client_credentials'
        )
        && (
            $GLOBALS['checkout_remote_requests'][0]['arguments']['headers']['Authorization']
            ?? ''
        ) === 'Basic hotmart-basic'
        && (
            $GLOBALS['checkout_remote_requests'][1]['arguments']['headers']['Authorization']
            ?? ''
        ) === 'Bearer hotmart-access-token',
    'Hotmart deve trocar OAuth, usar Bearer e reutilizar o token em cache'
);
checkout_assert(
    checkout_private(
        Kodety_Checkouts::class,
        'provider_checkout_url',
        'stripe',
        'https://checkout.stripe.com/c/pay/test'
    ) !== '',
    'redirect Stripe oficial deve ser aceito'
);
checkout_assert(
    checkout_private(
        Kodety_Checkouts::class,
        'provider_checkout_url',
        'woovi',
        'https://pay.woovi-sandbox.com/charge/test'
    ) !== '',
    'redirect Woovi sandbox oficial deve ser aceito'
);
checkout_assert(
    checkout_private(
        Kodety_Checkouts::class,
        'provider_checkout_url',
        'hotmart',
        'https://pay.hotmart.com/OFFER123?src=opaque'
    ) !== '',
    'checkout Hotmart oficial deve ser aceito'
);
checkout_assert(
    checkout_private(
        Kodety_Checkouts::class,
        'provider_checkout_url',
        'ticto',
        'https://payment.ticto.app/OFFER123?kdt_ref=opaque'
    ) !== '',
    'checkout Ticto oficial deve ser aceito'
);
$hotmart_checkout = checkout_private(
    $checkout,
    'create_hotmart_checkout',
    ['external_price_id' => 'OFFER-HOTMART'],
    'opaque-hotmart',
    'buyer@example.test'
);
checkout_assert(
    is_array($hotmart_checkout)
        && str_starts_with(
            (string) ($hotmart_checkout['url'] ?? ''),
            'https://pay.hotmart.com/OFFER-HOTMART?'
        )
        && str_contains((string) $hotmart_checkout['url'], 'sck=opaque-hotmart')
        && str_contains((string) $hotmart_checkout['url'], 'src=opaque-hotmart')
        && str_contains((string) $hotmart_checkout['url'], 'email=buyer%40example.test'),
    'checkout Hotmart deve transportar referência opaca e prefill de e-mail'
);
$ticto_checkout = checkout_private(
    $checkout,
    'create_ticto_checkout',
    ['external_price_id' => 'OFFER-TICTO'],
    'opaque-ticto'
);
checkout_assert(
    is_array($ticto_checkout)
        && ($ticto_checkout['url'] ?? '')
            === 'https://payment.ticto.app/OFFER-TICTO?kdt_ref=opaque-ticto',
    'checkout Ticto deve transportar a referência opaca no link da oferta'
);
checkout_assert(
    checkout_private(
        Kodety_Checkouts::class,
        'provider_checkout_url',
        'stripe',
        'https://stripe.com.evil.example/steal'
    ) === '',
    'allowlist não pode aceitar sufixo malicioso'
);

checkout_assert(
    checkout_private(Kodety_Checkouts::class, 'external_id', ['id' => 'sub_123']) === 'sub_123',
    'IDs expandidos do provedor devem ser normalizados'
);
checkout_assert(
    checkout_private(Kodety_Checkouts::class, 'external_id', new stdClass()) === '',
    'objetos arbitrários não podem virar identificadores'
);
checkout_assert(
    checkout_private(Kodety_Checkouts::class, 'mapping_status', 'paused') === 'paused'
        && checkout_private(Kodety_Checkouts::class, 'mapping_status', 'archived') === 'archived',
    'status paused/archived deve permanecer explícito'
);

set_error_handler(static function (
    int $severity,
    string $message,
    string $file,
    int $line
): never {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// Normalizers: one representative financial/lifecycle state per adapter.
$stripe = checkout_private($checkout, 'normalize_stripe_event', [
    'id' => 'evt_invoice',
    'type' => 'invoice.paid',
    'created' => 1_800_000_000,
    'data' => ['object' => [
        'id' => 'in_1',
        'status' => 'paid',
        'amount_paid' => 9900,
        'currency' => 'brl',
        'parent' => ['subscription_details' => [
            'subscription' => 'sub_1',
            'metadata' => ['kodety_reference' => 'local-ref'],
        ]],
        'payments' => ['data' => [[
            'payment' => ['payment_intent' => ['id' => 'pi_basil']],
        ]]],
    ]],
]);
checkout_assert(
    $stripe['externalSaleId'] === 'pi_basil'
        && $stripe['externalContractId'] === 'sub_1'
        && $stripe['financiallyConfirmed'] === true,
    'Stripe Basil invoice.paid deve provar pagamento e contrato'
);
$stripe_finalization = checkout_private($checkout, 'normalize_stripe_event', [
    'id' => 'evt_finalization',
    'type' => 'invoice.finalization_failed',
    'created' => 1_800_000_100,
    'data' => ['object' => [
        'id' => 'in_failed',
        'parent' => ['subscription_details' => ['subscription' => 'sub_1']],
    ]],
]);
checkout_assert(
    $stripe_finalization['status'] === 'pending'
        && $stripe_finalization['subscriptionStatus'] === 'past_due',
    'falha de finalização Stripe deve suspender acesso mesmo com subscription active'
);

$mercado_pago = checkout_private(
    $checkout,
    'normalize_mercado_pago_event',
    ['type' => 'payment'],
    [
        'id' => 123,
        'status' => 'approved',
        'external_reference' => 'local-ref',
        'transaction_amount' => 12.34,
        'currency_id' => 'BRL',
    ]
);
checkout_assert(
    $mercado_pago['status'] === 'paid' && $mercado_pago['amount'] === 1234,
    'Mercado Pago aprovado deve converter valor para centavos'
);

$asaas = checkout_private(
    $checkout,
    'normalize_asaas_event',
    [
        'event' => 'PAYMENT_RESTORED',
        'dateCreated' => '2026-07-23T12:00:00Z',
    ],
    [
        'id' => 'pay_1',
        'status' => 'RECEIVED',
        'value' => 10,
        'subscription' => 'sub_asaas',
        'confirmedDate' => '2026-07-01',
    ]
);
checkout_assert(
    $asaas['status'] === 'paid'
        && $asaas['allowTerminalReversal'] === true
        && $asaas['providerUpdatedAt'] === '2026-07-23T12:00:00Z',
    'Asaas restore deve usar timestamp do evento e permitir reversão'
);

$pagbank = checkout_private($checkout, 'normalize_pagbank_event', [
    'id' => 'legacy-code',
    'reference_id' => 'local-ref',
    'status' => 'PAID',
    'amount' => ['value' => 1234, 'currency' => 'BRL'],
    'last_event_at' => '2026-07-23T12:00:00Z',
]);
checkout_assert(
    $pagbank['status'] === 'paid'
        && $pagbank['amount'] === 1234
        && $pagbank['providerUpdatedAt'] === '2026-07-23T12:00:00Z',
    'PagBank legado deve normalizar objeto autoritativo'
);

$pagarme = checkout_private(
    $checkout,
    'normalize_pagarme_event',
    ['type' => 'chargeback.received'],
    [
        'id' => 'ch_1',
        'status' => 'paid',
        '_kodety_dispute_status' => 'LOST',
        'invoice' => ['subscriptionId' => 'sub_pagarme'],
        'order' => ['id' => 'or_1', 'code' => 'local-ref'],
    ]
);
checkout_assert(
    $pagarme['status'] === 'chargeback'
        && $pagarme['externalContractId'] === 'sub_pagarme'
        && $pagarme['externalSaleId'] === 'or_1',
    'Pagar.me chargeback deve usar order canônico e subscriptionId camelCase'
);
$pagarme_invoice = checkout_private(
    $checkout,
    'normalize_pagarme_event',
    ['type' => 'invoice.paid'],
    [
        'id' => 'in_pg_1',
        'status' => 'paid',
        'subscription_id' => 'sub_pg_1',
        '_kodety_authoritative_invoice' => true,
    ]
);
checkout_assert(
    $pagarme_invoice['financiallyConfirmed'] === true,
    'fatura Pagar.me refetched deve reparar prova financeira perdida'
);

$woovi = checkout_private(
    $checkout,
    'normalize_woovi_event',
    ['event' => 'woovi:CHARGE_REFUND_COMPLETED', 'refund' => ['partial' => true]],
    [
        'charge' => [
            'identifier' => 'ch_woovi',
            'correlationID' => 'local-ref',
            'status' => 'COMPLETED',
            'value' => 3000,
        ],
    ]
);
checkout_assert($woovi['status'] === 'paid', 'reembolso parcial Woovi não deve revogar acesso');

$iugu = checkout_private(
    $checkout,
    'normalize_iugu_event',
    ['event' => 'invoice.status_changed'],
    [
        'id' => 'in_iugu',
        'status' => 'in_protest',
        'total_cents' => 2500,
    ]
);
checkout_assert($iugu['status'] === 'chargeback', 'in_protest Iugu deve ser terminal');

$hotmart = checkout_private(
    $checkout,
    'normalize_hotmart_event',
    [
        'id' => 'evt-hotmart-1',
        'event' => 'PURCHASE_APPROVED',
        'creation_date' => 1_800_000_000,
    ],
    [
        'data' => [
            'product' => ['id' => 9001, 'ucode' => 'prod-ucode'],
            'buyer' => ['ucode' => 'buyer-ucode', 'email' => 'buyer@example.test'],
            'purchase' => [
                'transaction' => 'HP123',
                'status' => 'APPROVED',
                'price' => ['value' => 149.90, 'currency_code' => 'BRL'],
                'offer' => ['code' => 'offer-hotmart'],
                'origin' => ['sck' => 'local-hotmart'],
                'approved_date' => 1_800_000_000,
            ],
            'subscription' => [
                'id' => 'sub-hotmart',
                'status' => 'ACTIVE',
                'date_next_charge' => 1_802_592_000,
            ],
        ],
    ]
);
checkout_assert(
    $hotmart['status'] === 'paid'
        && $hotmart['subscriptionStatus'] === 'active'
        && $hotmart['financiallyConfirmed'] === true
        && $hotmart['localReference'] === 'local-hotmart'
        && $hotmart['externalProductId'] === 'offer-hotmart'
        && $hotmart['amount'] === 14990,
    'Hotmart aprovada deve vincular oferta, referência e assinatura em centavos'
);

$ticto = checkout_private(
    $checkout,
    'normalize_ticto_event',
    ['status' => 'chargeback'],
    [
        'status' => 'chargeback',
        'status_date' => '2026-07-30T12:00:00Z',
        'order' => [
            'id' => 321,
            'transaction_hash' => 'ticto-transaction',
            'paid_amount' => 19900,
        ],
        'item' => [
            'product_id' => 55,
            'offer_code' => 'offer-ticto',
        ],
        'subscriptions' => [[
            'id' => 'sub-ticto',
            'canceled_at' => '2026-07-30T12:00:00Z',
        ]],
        'customer' => ['id' => 77, 'email' => 'buyer@example.test'],
        'url_params' => ['query_params' => ['kdt_ref' => 'local-ticto']],
    ]
);
checkout_assert(
    $ticto['status'] === 'chargeback'
        && $ticto['subscriptionStatus'] === 'canceled'
        && $ticto['localReference'] === 'local-ticto'
        && $ticto['externalProductId'] === 'offer-ticto'
        && $ticto['amount'] === 19900,
    'Ticto chargeback deve revogar assinatura e preservar vínculo da oferta'
);

checkout_assert(
    checkout_private(
        Kodety_Checkouts::class,
        'pagarme_order_reconciliation_priority',
        ['status' => 'paid', 'charges' => [['status' => 'chargedback']]]
    ) === 100,
    'reconcile Pagar.me deve priorizar chargeback sobre order paid'
);

restore_error_handler();

// Provider ACK durability: the provider succeeds, the first sales projection
// UPDATE fails, cron repairs it from the journal, and an HTTP retry reuses the
// exact same hosted artifact without another provider POST.
$wpdb = new Checkout_Ack_Wpdb();
$checkout_ack = (new ReflectionClass(Kodety_Checkouts::class))
    ->newInstanceWithoutConstructor();
$encrypted_credentials = checkout_private($checkout_ack, 'encrypt_secret', [
    'secretKey' => 'sk_test_ack',
    'webhookSecret' => 'whsec_ack',
]);
checkout_assert(
    is_string($encrypted_credentials),
    'fixture deve criptografar credenciais da conexão'
);
$wpdb->connections[7] = [
    'id' => 7,
    'uuid' => '00000000-0000-4000-8000-000000000007',
    'provider' => 'stripe',
    'credentials' => $encrypted_credentials,
    'settings' => '{}',
    'enabled' => 1,
    'status' => 'connected',
];
$ack_mapping = [
    'id' => 31,
    'status' => 'active',
    'plan_status' => 'active',
    'connection_id' => 7,
    'plan_id' => 19,
    'mode' => 'payment',
    'external_price_id' => 'price_ack',
    'amount' => 4900,
    'currency' => 'BRL',
];
$GLOBALS['checkout_provider_request_count'] = 0;
$first_checkout = checkout_private(
    $checkout_ack,
    'create_hosted_checkout',
    $ack_mapping,
    0,
    'buyer@example.test',
    'https://example.test/success',
    'https://example.test/cancel',
    'order-ack-regression'
);
checkout_assert(
    is_array($first_checkout)
        && ($first_checkout['reconciliationPending'] ?? false) === true
        && ($first_checkout['url'] ?? '')
            === 'https://checkout.stripe.com/c/pay/reusable',
    'ACK remoto deve devolver o checkout válido com reconciliação pendente'
);
checkout_assert(
    $GLOBALS['checkout_provider_request_count'] === 1
        && count($wpdb->artifacts) === 1,
    'ACK deve gerar uma única chamada remota e um diário durável'
);
$journal = reset($wpdb->artifacts);
checkout_assert(
    ($journal['status'] ?? '') === 'pending'
        && ($journal['artifact_type'] ?? '') === 'session'
        && ($journal['external_id'] ?? '') === 'cs_ack_reusable'
        && ($journal['local_reference'] ?? '') !== '',
    'diário deve preservar tipo, ID externo e referência local'
);

$reconciliation = $checkout_ack->run_reconciliation(25);
checkout_assert(
    ($reconciliation['artifactRepairsChecked'] ?? 0) === 1
        && ($reconciliation['artifactRepairsCompleted'] ?? 0) === 1
        && ($reconciliation['artifactRepairFailed'] ?? 1) === 0,
    'run_reconciliation deve reparar o ACK pendente'
);
$sale = reset($wpdb->sales);
$sale_metadata = json_decode((string) ($sale['metadata'] ?? ''), true);
checkout_assert(
    ($sale['external_sale_id'] ?? '') === 'cs_ack_reusable'
        && ($sale_metadata['checkout_artifact_type'] ?? '') === 'session'
        && ($sale_metadata['checkout_local_reference'] ?? '')
            === ($journal['local_reference'] ?? ''),
    'reparo deve projetar ID, tipo e referência no registro de venda'
);

$retried_checkout = checkout_private(
    $checkout_ack,
    'create_hosted_checkout',
    $ack_mapping,
    0,
    'buyer@example.test',
    'https://example.test/success',
    'https://example.test/cancel',
    'order-ack-regression'
);
checkout_assert(
    is_array($retried_checkout)
        && ($retried_checkout['id'] ?? '') === ($first_checkout['id'] ?? '')
        && ($retried_checkout['url'] ?? '') === ($first_checkout['url'] ?? '')
        && ($retried_checkout['reconciliationPending'] ?? true) === false,
    'retry deve retornar o mesmo artefato já reparado'
);
checkout_assert(
    $GLOBALS['checkout_provider_request_count'] === 1
        && count($wpdb->sales) === 1
        && count($wpdb->artifacts) === 1,
    'retry após ACK não pode chamar o provedor nem criar venda/artefato duplicado'
);

// Reuse is deliberately bounded: an expired hosted URL or a terminal sale
// must permit a new, legitimate purchase attempt.
$wpdb->artifacts[1]['expires_at'] = '2026-07-27 11:00:00';
$expired_replacement = checkout_private(
    $checkout_ack,
    'create_hosted_checkout',
    $ack_mapping,
    0,
    'buyer@example.test',
    'https://example.test/success',
    'https://example.test/cancel',
    'order-ack-regression'
);
checkout_assert(
    is_array($expired_replacement)
        && ($expired_replacement['id'] ?? '') !== ($first_checkout['id'] ?? '')
        && $GLOBALS['checkout_provider_request_count'] === 2,
    'artefato expirado deve permitir um novo checkout legítimo'
);
$latest_sale_id = max(array_keys($wpdb->sales));
foreach (['paid', 'canceled', 'expired'] as $terminal_status) {
    $previous_checkout_id = (string) ($wpdb->sales[$latest_sale_id]['uuid'] ?? '');
    $wpdb->sales[$latest_sale_id]['status'] = $terminal_status;
    $replacement = checkout_private(
        $checkout_ack,
        'create_hosted_checkout',
        $ack_mapping,
        0,
        'buyer@example.test',
        'https://example.test/success',
        'https://example.test/cancel',
        'order-ack-regression'
    );
    checkout_assert(
        is_array($replacement)
            && ($replacement['id'] ?? '') !== $previous_checkout_id
            && ($replacement['reconciliationPending'] ?? true) === false,
        "venda {$terminal_status} deve liberar uma nova compra"
    );
    $latest_sale_id = max(array_keys($wpdb->sales));
}
checkout_assert(
    $GLOBALS['checkout_provider_request_count'] === 5
        && count($wpdb->sales) === 5
        && count($wpdb->artifacts) === 5,
    'somente tentativas expiradas/terminais devem criar novos artefatos'
);

$retention = $checkout_ack->run_reconciliation(25);
checkout_assert(
    ($retention['artifactUrlsPurged'] ?? 0) === 4,
    'cron deve neutralizar URLs cifradas expiradas ou de vendas terminais'
);
$closed_artifacts = array_filter(
    $wpdb->artifacts,
    static fn(array $artifact): bool => ($artifact['status'] ?? '') === 'closed'
);
checkout_assert(
    count($closed_artifacts) === 4
        && count(array_filter(
            $closed_artifacts,
            static fn(array $artifact): bool =>
                ($artifact['checkout_url_encrypted'] ?? '') === ''
                && ($artifact['external_id'] ?? '') !== ''
                && ($artifact['external_key'] ?? '') !== ''
                && !array_key_exists(
                    'checkout_email_encrypted',
                    json_decode((string) ($artifact['metadata'] ?? '{}'), true) ?: []
                )
        )) === 4,
    'retenção deve remover URL/PII cifrada e preservar identidade financeira'
);

// If the initial request lock exists but the ACK journal is not visible yet,
// a concurrent retry must stop locally instead of issuing another provider
// creation request.
$wpdb_locked = new Checkout_Ack_Wpdb();
$wpdb_locked->connections[7] = $wpdb->connections[7];
$locked_fingerprint = checkout_private(
    Kodety_Checkouts::class,
    'checkout_request_fingerprint',
    7,
    31,
    0,
    'buyer@example.test',
    'https://example.test/success',
    'https://example.test/cancel',
    'locked-attempt'
);
$locked_key = hash(
    'sha256',
    '7|checkout-request|' . $locked_fingerprint
);
$wpdb_locked->insert($wpdb_locked->prefix . 'kodety_checkout_sales', [
    'uuid' => '00000000-0000-4000-8000-000000000099',
    'connection_id' => 7,
    'mapping_id' => 31,
    'user_id' => 0,
    'plan_id' => 19,
    'local_reference' => str_repeat('L', 43),
    'external_sale_key' => $locked_key,
    'status' => 'pending',
    'access_status' => 'unmatched',
    'metadata' => '{}',
    'created_at' => '2026-07-27 12:00:00',
    'updated_at' => '2026-07-27 12:00:00',
]);
$wpdb = $wpdb_locked;
$GLOBALS['checkout_provider_request_count'] = 0;
$locked_retry = checkout_private(
    $checkout_ack,
    'create_hosted_checkout',
    $ack_mapping,
    0,
    'buyer@example.test',
    'https://example.test/success',
    'https://example.test/cancel',
    'locked-attempt'
);
checkout_assert(
    is_wp_error($locked_retry)
        && $locked_retry->get_error_code() === 'kodety_checkout_creation_in_progress'
        && $GLOBALS['checkout_provider_request_count'] === 0,
    'sale-lock sem journal deve bloquear retry antes do provedor'
);

// Existing installations must only advance the schema version after dbDelta
// has materialized the ACK journal table.
$wpdb = new Checkout_Ack_Wpdb();
$GLOBALS['checkout_dbdelta'] = [];
$GLOBALS['checkout_options'] = [];
checkout_private(Kodety_Checkouts::class, 'migrate_from', 2);
$artifact_schema = array_values(array_filter(
    $GLOBALS['checkout_dbdelta'],
    static fn(string $sql): bool =>
        str_contains($sql, 'CREATE TABLE wp_kodety_checkout_artifacts')
));
checkout_assert(
    count($artifact_schema) === 1
        && str_contains($artifact_schema[0], 'checkout_url_encrypted longtext NOT NULL')
        && str_contains($artifact_schema[0], 'request_fingerprint char(64) NOT NULL')
        && ($GLOBALS['checkout_options']['kodety_checkouts_db_version'] ?? 0) === 3,
    'migração v3 deve criar o diário completo antes de avançar a versão'
);

// Source-level contracts guard flows that require WordPress/provider I/O.
$contracts = [
    "'methods' => 'POST'" => 'webhooks devem ser POST',
    "strtoupper((string) \$request->get_method()) === 'GET'" => 'GET público deve ser sem efeito',
    'render_checkout_capture_page' => 'landing deve confirmar antes de criar checkout',
    'consume_transient_once' => 'continuação deve ser single-use em POST',
    "header('X-Robots-Tag: noindex, nofollow'" => 'landing deve ser noindex',
    'rate_limit_preflight_email' => 'preflight deve limitar por hash de e-mail',
    'kodety_checkout_environment_immutable' => 'ambiente deve ser imutável após uso',
    'connection_has_commerce_history' => 'troca de ambiente deve consultar histórico',
    "'public_key' => self::opaque_token()" => 'reativação deve rotacionar URL pública',
    "'status' => 'deleted'" => 'mapping excluído deve ser tombstonado',
    'Conexão, plano e modalidade não podem ser alterados' => 'mode deve ser imutável',
    "'operation_type' => 'auth_and_capture'" => 'Pagar.me CC deve capturar',
    "'pix_settings'" => 'Pagar.me Pix avulso deve ter expiração',
    'Pix não está disponível no checkout recorrente' => 'Pagar.me recorrente deve rejeitar Pix',
    "'expand[]' => 'payments.data.payment.payment_intent'" => 'Stripe invoice deve expandir PI Basil',
    'stripe_paid_invoice_reconciliation_event' => 'Stripe deve reparar invoice webhook perdido',
    'invoice.finalization_failed' => 'Stripe deve falhar fechado em finalização',
    "'checkoutSession' => \$checkout_id" => 'Asaas CHECKOUT_PAID deve refetch payment',
    "'subscription_id' => \$contract_id" => 'Pagar.me deve reconciliar invoice de contrato',
    "'code' => \$reference" => 'payment link Pagar.me deve buscar order por referência',
    'pagbank_legacy_transaction' => 'PagBank legado deve refetch XML autoritativo',
    'api-sec-vlc.hotmart.com/security/oauth/token' =>
        'Hotmart deve usar OAuth client_credentials oficial',
    "'X-HOTMART-HOTTOK'" => 'Hotmart deve validar o header Hottok',
    "'kdt_ref' => \$reference" => 'checkout Ticto deve carregar referência opaca',
    "'verification' => 'webhook_token'" => 'Ticto deve testar o token sem efeito financeiro',
    'ws.sandbox.pagseguro.uol.com.br' => 'PagBank legado deve respeitar sandbox',
    "'payloadHash' => \$state_hash" => 'ledger sintético deve usar hash canônico',
    'recover_stale_provider_events' => 'cron deve recuperar ledger processing órfão',
    "add_action('kodety_members_user_deleted'" => 'exclusão de membro deve desassociar comércio',
    "\$metadata['identity_deleted'] = true" => 'venda deve manter tombstone de identidade',
    "empty(\$sale_metadata['identity_deleted'])" => 'renovação não deve recriar usuário excluído',
    '$trusted_checkout_identity' => 'convite deve usar identidade server-side',
    "'provider_email_mismatch'" => 'mismatch do e-mail do provedor deve ser sinalizado',
    'kodety_checkout_member_email_mismatch' => 'checkout privado deve validar identidade do membro',
    'Keep the financial grant durable even while a local access-only' => 'grant pago deve persistir sob block',
    "'mappedPlanCount'" => 'overview deve expor mapeamentos ativos',
    'last_synced_at datetime NULL' => 'schema deve persistir última sincronização',
    'last_reconciled_at datetime NULL' => 'schema deve distribuir reconciliação',
    'private const DB_VERSION = 3' => 'migração deve avançar para a versão do diário',
    'if ($current < 3)' => 'upgrade deve executar dbDelta do diário em instalações existentes',
    "'SHOW TABLES LIKE %s'" => 'migração não deve avançar sem confirmar o diário',
    'CREATE TABLE {$artifacts}' => 'schema deve persistir ACKs remotos separadamente',
    'repair_pending_checkout_artifacts' => 'cron deve reparar ACK antes da projeção financeira',
    'neutralize_closed_checkout_artifact_urls' =>
        'cron deve aplicar retenção às URLs hospedadas',
    "'reconciliation' => [" => 'overview deve diagnosticar artefatos pendentes',
    "'reconciliationPending' => \$reconciliation_pending" =>
        'resposta deve sinalizar reconciliação pendente sem perder o checkout',
];
foreach ($contracts as $needle => $message) {
    checkout_assert(str_contains($source, $needle), $message);
}
checkout_assert(
    str_contains(
        $uninstall_source,
        "['connections', 'mappings', 'sales', 'artifacts', 'access_blocks']"
    ),
    'purge explícito no uninstall deve remover também o diário de artefatos'
);

$public_buy_start = strpos($source, 'public function public_buy(');
$public_page_start = strpos($source, 'public function handle_public_checkout_page(');
$public_buy_source = substr(
    $source,
    $public_buy_start,
    $public_page_start - $public_buy_start
);
checkout_assert(
    strpos($public_buy_source, "get_method()) === 'GET'")
        < strpos($public_buy_source, 'create_hosted_checkout('),
    'GET /buy deve retornar antes de qualquer criação no provedor'
);

echo "Kodety checkouts runtime: OK\n";
