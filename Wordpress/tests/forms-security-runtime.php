<?php

/**
 * Isolated regression checks for Kodety Forms routing and sensitive-data guards.
 *
 * Run with: php Wordpress/tests/forms-security-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('DAY_IN_SECONDS', 86400);
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_URL', 'https://example.test/wp-content/plugins/kodety/');
define('KODETY_VERSION', 'test-forms-security');

final class WP_Error {
    public function __construct(private string $code, private string $message = '', private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Response {
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
}

final class WP_REST_Request {
    private array $headers;

    public function __construct(
        private array $json = [],
        array $headers = [],
        private array $files = []
    ) {
        $this->headers = array_change_key_case($headers, CASE_LOWER);
    }

    public function get_header(string $name): string { return (string) ($this->headers[strtolower($name)] ?? ''); }
    public function get_json_params(): array { return $this->json; }
    public function get_params(): array { return $this->json; }
    public function get_file_params(): array { return $this->files; }
}

final class Kodety_Forms_Test_Wpdb {
    public string $prefix = 'wp_';
    public int $insert_id = 0;
    public array $inserts = [];
    public array $updates = [];
    public array $deletes = [];

    public function insert(string $table, array $data): int {
        $this->insert_id++;
        $this->inserts[] = compact('table', 'data');
        return 1;
    }

    public function update(string $table, array $data, array $where): int {
        $this->updates[] = compact('table', 'data', 'where');
        return 1;
    }

    public function delete(string $table, array $where, array $format = []): int {
        $this->deletes[] = compact('table', 'where', 'format');
        return 1;
    }
}

final class Kodety_Plugin {
    private static ?self $instance = null;
    public array $form_items = [];
    public static function instance(): self { return self::$instance ??= new self(); }
    public function create_cms_item_from_form(string $collection, array $values, string $status): array {
        $this->form_items[] = compact('collection', 'values', 'status');
        return ['id' => 501, 'type' => $collection, 'status' => $status];
    }
}

final class Kodety_Edition {
    public static bool $analytics_utms = false;
    public static function has(string $feature): bool {
        return $feature === 'analyticsUtms' && self::$analytics_utms;
    }
}

$kodety_forms_options = [
    'kodety_email_settings' => [
        'enabled' => true,
        'recipient_email' => '',
    ],
];
$kodety_forms_transients = [];
$kodety_forms_actions = [];
$kodety_forms_remote_response = ['response' => ['code' => 204], 'body' => ''];
$kodety_forms_remote_responses = [];
$kodety_forms_remote_calls = [];
$kodety_forms_uploads = sys_get_temp_dir() . '/kodety-forms-' . bin2hex(random_bytes(5));
$wpdb = new Kodety_Forms_Test_Wpdb();

function get_option(string $name, mixed $default = false): mixed {
    global $kodety_forms_options;
    return $kodety_forms_options[$name] ?? $default;
}
function update_option(string $name, mixed $value, bool $autoload = false): bool {
    global $kodety_forms_options;
    $kodety_forms_options[$name] = $value;
    return true;
}
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function home_url(string $path = '/'): string { return 'https://example.test' . '/' . ltrim($path, '/'); }
function wp_upload_dir(): array {
    global $kodety_forms_uploads;
    return ['basedir' => $kodety_forms_uploads, 'error' => false];
}
function wp_mkdir_p(string $path): bool { return is_dir($path) || mkdir($path, 0777, true); }
function trailingslashit(string $value): string { return rtrim($value, '/\\') . '/'; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function absint(mixed $value): int { return abs((int) $value); }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? '')); }
function sanitize_textarea_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_title(string $value): string { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($value)) ?? '', '-'); }
function sanitize_email(string $value): string { return (string) filter_var($value, FILTER_SANITIZE_EMAIL); }
function sanitize_file_name(string $value): string { return preg_replace('/[^A-Za-z0-9._ -]+/', '', basename($value)) ?: ''; }
function sanitize_mime_type(string $value): string { return preg_replace('/[^A-Za-z0-9.+\/-]+/', '', $value) ?: ''; }
function wp_check_filetype_and_ext(string $path, string $name, array $mimes): array {
    $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    foreach ($mimes as $extensions => $mime) {
        if (in_array($extension, explode('|', (string) $extensions), true)) {
            return ['ext' => $extension, 'type' => $mime, 'proper_filename' => false];
        }
    }
    return ['ext' => false, 'type' => false, 'proper_filename' => false];
}
function remove_accents(string $value): string {
    return strtr($value, [
        'á'=>'a', 'à'=>'a', 'ã'=>'a', 'â'=>'a', 'ä'=>'a', 'Á'=>'A', 'À'=>'A', 'Ã'=>'A', 'Â'=>'A',
        'é'=>'e', 'ê'=>'e', 'É'=>'E', 'Ê'=>'E', 'í'=>'i', 'Í'=>'I', 'ó'=>'o', 'õ'=>'o', 'ô'=>'o',
        'Ó'=>'O', 'Õ'=>'O', 'Ô'=>'O', 'ú'=>'u', 'ü'=>'u', 'Ú'=>'U', 'Ü'=>'U', 'ç'=>'c', 'Ç'=>'C',
        'ñ'=>'n', 'Ñ'=>'N',
    ]);
}
function esc_url_raw(string $value): string { return filter_var($value, FILTER_SANITIZE_URL) ?: ''; }
function esc_url(string $value): string { return filter_var($value, FILTER_SANITIZE_URL) ?: ''; }
function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'); }
function wp_http_validate_url(string $value): string|false {
    $parts = parse_url($value);
    $host = strtolower((string) ($parts['host'] ?? ''));
    return ($parts['scheme'] ?? '') === 'https'
        && $host !== ''
        && $host !== 'localhost'
        && !filter_var($host, FILTER_VALIDATE_IP)
        ? $value
        : false;
}
function rest_url(string $path = ''): string { return 'https://example.test/wp-json/' . ltrim($path, '/'); }
function wp_generate_uuid4(): string { return '12345678-1234-4123-8123-123456789012'; }
function get_transient(string $key): mixed { global $kodety_forms_transients; return $kodety_forms_transients[$key] ?? false; }
function set_transient(string $key, mixed $value, int $expiration): bool {
    global $kodety_forms_transients;
    $kodety_forms_transients[$key] = $value;
    return true;
}
function wp_salt(string $scheme = 'auth'): string { return 'forms-test-salt-' . $scheme; }
function current_time(string $type, bool $gmt = false): string { return '2026-07-23 12:00:00'; }
function wp_mail(...$args): bool { return true; }
function wp_safe_remote_post(string $url, array $args = []): mixed {
    global $kodety_forms_remote_response, $kodety_forms_remote_responses, $kodety_forms_remote_calls;
    $kodety_forms_remote_calls[] = compact('url', 'args');
    if ($kodety_forms_remote_responses) return array_shift($kodety_forms_remote_responses);
    return $kodety_forms_remote_response;
}
function wp_remote_retrieve_response_code(mixed $response): int {
    return $response instanceof WP_Error ? 0 : (int) ($response['response']['code'] ?? 0);
}
function wp_remote_retrieve_body(mixed $response): string {
    return $response instanceof WP_Error ? '' : (string) ($response['body'] ?? '');
}
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function untrailingslashit(string $value): string { return rtrim($value, '/\\'); }
function do_action(string $hook, mixed ...$args): void {
    global $kodety_forms_actions;
    $kodety_forms_actions[] = compact('hook', 'args');
}

require_once dirname(__DIR__) . '/kodety/includes/class-kodety-emails.php';

function kodety_forms_assert(bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

function kodety_forms_private(object $object, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($object, $method);
    return $reflection->invoke($object, ...$arguments);
}

$reflection = new ReflectionClass(Kodety_Emails::class);
$emails = $reflection->newInstanceWithoutConstructor();

$normal = [
    '_kodety_form' => 'contato',
    '_kodety_started' => (int) floor(microtime(true) * 1000) - 2000,
    '_kodety_page_url' => 'https://example.test/contato?token=payload-token',
    '_kodety_referrer' => 'https://referrer.test/campaign?access_token=referrer-token#fragment',
    '_wpnonce' => 'ordinary-form-nonce',
    'name' => 'Ada Lovelace',
    'email' => 'ada@example.test',
    'message' => 'Olá, gostaria de saber mais.',
];
$normal_response = $emails->receive_submission(new WP_REST_Request($normal, [
    'origin' => 'https://example.test',
    'referer' => 'https://example.test/contato?token=header-token#fragment',
]));
kodety_forms_assert($normal_response instanceof WP_REST_Response && $normal_response->get_status() === 201, 'form comum deve continuar sendo persistido');
kodety_forms_assert(count($wpdb->inserts) === 1, 'form comum deve criar uma linha');
$normal_insert = $wpdb->inserts[0]['data'];
kodety_forms_assert($normal_insert['page_url'] === 'https://example.test/contato', 'query e fragmento da página devem ser removidos');
kodety_forms_assert($normal_insert['referrer'] === 'https://referrer.test/campaign', 'query e fragmento do referrer devem ser removidos');
kodety_forms_assert(!str_contains($normal_insert['payload'], '_kodety_'), 'metadados internos não devem entrar no payload');
kodety_forms_assert(!str_contains($normal_insert['payload'], 'token'), 'tokens de URL não devem entrar no payload');
kodety_forms_assert(
    count($kodety_forms_actions) === 1
        && $kodety_forms_actions[0]['hook'] === 'kodety_form_submitted'
        && ($kodety_forms_actions[0]['args'][0]['pageUrl'] ?? '') === 'https://example.test/contato'
        && !array_key_exists('_kodety_started', $kodety_forms_actions[0]['args'][0]['fields'] ?? []),
    'hook de integração deve receber apenas a submissão aceita e já sanitizada'
);

$metadata_response = $emails->receive_submission(new WP_REST_Request([
    '_kodety_form' => 'password-reset',
    '_kodety_started' => (int) floor(microtime(true) * 1000) - 2000,
    'name' => 'Form seguro',
    'message' => 'Metadados também precisam de proteção.',
], [
    'origin' => 'https://example.test',
    'user-agent' => 'Bearer abcdefghijklmnopqrstuvwxyz',
]));
kodety_forms_assert($metadata_response instanceof WP_REST_Response && $metadata_response->get_status() === 201, 'metadados sensíveis devem ser redigidos sem perder um payload comum');
$metadata_insert = $wpdb->inserts[1]['data'];
kodety_forms_assert($metadata_insert['form_key'] === 'formulario', 'nome de form sensível não deve ser persistido');
kodety_forms_assert($metadata_insert['user_agent'] === '[redacted]', 'token no user agent deve ser redigido');
$safe_insert_count = count($wpdb->inserts);

$prohibited_payloads = [
    ['account' => ['password' => 'correct horse battery staple']],
    ['account' => ['user_pass' => 'correct horse battery staple']],
    ['account' => ['pwd' => 'correct horse battery staple']],
    ['payment' => ['cvv' => '123']],
    ['payment' => ['numero_cartao' => '4111111111111111']],
    ['message' => 'Use o cartão 4111 1111 1111 1111 para o teste.'],
    ['message' => 'Use o cartão 2223 0000 4840 0011 para o teste.'],
];
foreach ($prohibited_payloads as $sensitive) {
    $request_payload = array_merge([
        '_kodety_form' => 'unsafe',
        '_kodety_started' => (int) floor(microtime(true) * 1000) - 2000,
        'name' => 'Teste',
    ], $sensitive);
    $response = $emails->receive_submission(new WP_REST_Request($request_payload, [
        'origin' => 'https://example.test',
    ]));
    kodety_forms_assert($response instanceof WP_Error, 'payload sensível deve ser rejeitado');
    kodety_forms_assert($response->get_error_code() === 'kodety_forms_sensitive_data', 'payload sensível deve usar erro dedicado');
    kodety_forms_assert(($response->get_error_data()['status'] ?? 0) === 422, 'payload sensível deve responder 422');
}
kodety_forms_assert(count($wpdb->inserts) === $safe_insert_count, 'nenhum payload sensível pode chegar ao banco');

$redacted_payloads = [
    [['profile' => ['refreshToken' => 'refresh-secret-value']], 'refresh-secret-value'],
    [['csrf_token' => 'ordinary-csrf-token-value'], 'ordinary-csrf-token-value'],
    [['g-recaptcha-response' => 'opaque-captcha-response-value'], 'opaque-captcha-response-value'],
    [['payment_method' => 'pm_1234567890abcdef'], 'pm_1234567890abcdef'],
    [['message' => 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz'], 'abcdefghijklmnopqrstuvwxyz'],
    [['message' => 'Authorization: Basic YWRtaW46c2VuaGE='], 'YWRtaW46c2VuaGE='],
];
foreach ($redacted_payloads as $index => [$sensitive, $forbidden_value]) {
    $request_payload = array_merge([
        '_kodety_form' => 'redacted-' . $index,
        '_kodety_started' => (int) floor(microtime(true) * 1000) - 2000,
        'name' => 'Teste seguro ' . $index,
    ], $sensitive);
    $response = $emails->receive_submission(new WP_REST_Request($request_payload, [
        'origin' => 'https://example.test',
    ]));
    kodety_forms_assert($response instanceof WP_REST_Response && $response->get_status() === 201, 'token redigível não deve quebrar os demais campos do form');
    $stored_payload = (string) $wpdb->inserts[array_key_last($wpdb->inserts)]['data']['payload'];
    kodety_forms_assert(!str_contains($stored_payload, $forbidden_value), 'valor de token não pode ser persistido');
}
$safe_insert_count = count($wpdb->inserts);

$file_response = $emails->receive_submission(new WP_REST_Request([
    '_kodety_form' => 'unsafe-file',
    '_kodety_started' => (int) floor(microtime(true) * 1000) - 2000,
    'name' => 'Teste',
], ['origin' => 'https://example.test'], [
    'credit_card' => ['name' => 'documento.txt', 'type' => 'text/plain', 'size' => 10],
]));
kodety_forms_assert($file_response instanceof WP_Error && $file_response->get_error_code() === 'kodety_forms_sensitive_data', 'campo de arquivo sensível deve ser rejeitado');
kodety_forms_assert(count($wpdb->inserts) === $safe_insert_count, 'arquivo sensível não pode criar uma linha');

$missing_endpoint_response = $emails->receive_submission(new WP_REST_Request([
    '_kodety_form' => 'documentos',
    '_kodety_started' => (int) floor(microtime(true) * 1000) - 2000,
    'name' => 'Teste de arquivo ausente',
], ['origin' => 'https://example.test'], [
    'document' => [
        'name' => 'missing.pdf',
        'type' => 'application/pdf',
        'tmp_name' => '',
        'error' => UPLOAD_ERR_OK,
        'size' => 20,
    ],
]));
kodety_forms_assert(
    $missing_endpoint_response instanceof WP_Error && $missing_endpoint_response->get_error_code() === 'kodety_forms_file_missing',
    'endpoint público deve rejeitar metadados de upload sem tmp_name'
);
kodety_forms_assert(count($wpdb->inserts) === $safe_insert_count, 'upload sem tmp_name não pode criar uma submissão');

$pdf_contents = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";
$pdf_path = $kodety_forms_uploads . '/candidate.pdf';
wp_mkdir_p(dirname($pdf_path));
file_put_contents($pdf_path, $pdf_contents);
$normalized_upload = kodety_forms_private($emails, 'normalize_uploaded_files', [
    'portfolio' => [
        'name' => 'portfolio.pdf',
        'type' => 'application/pdf',
        'tmp_name' => $pdf_path,
        'error' => UPLOAD_ERR_OK,
        'size' => strlen($pdf_contents),
    ],
]);
$stored_upload = kodety_forms_private($emails, 'store_uploaded_files', $normalized_upload, false);
kodety_forms_assert(is_array($stored_upload) && count($stored_upload) === 1, 'arquivo permitido deve ser validado e armazenado');
$stored_metadata = $stored_upload[0];
$encrypted_path = $kodety_forms_uploads . '/kodety/private/forms/' . $stored_metadata['storage'];
kodety_forms_assert(is_file($encrypted_path), 'arquivo aceito deve existir no armazenamento privado');
$encrypted_contents = (string) file_get_contents($encrypted_path);
kodety_forms_assert(
    str_starts_with($encrypted_contents, 'KDYFORM1') && !str_contains($encrypted_contents, $pdf_contents),
    'arquivo privado deve permanecer cifrado e não executável em repouso'
);
kodety_forms_assert(
    kodety_forms_private($emails, 'decrypt_upload', $stored_metadata) === $pdf_contents,
    'download autenticado deve recuperar exatamente o conteúdo aceito'
);
$public_upload = kodety_forms_private($emails, 'public_file_metadata', $stored_upload);
kodety_forms_assert(
    !isset($public_upload[0]['storage'], $public_upload[0]['sha256'], $public_upload[0]['id']),
    'webhooks e hooks não podem receber caminho, hash ou identificador privado'
);

$php_path = $kodety_forms_uploads . '/payload.php';
file_put_contents($php_path, "<?php echo 'unsafe';");
$rejected_upload = kodety_forms_private($emails, 'store_uploaded_files', [[
    'field' => 'document',
    'name' => 'payload.php',
    'type' => 'application/x-httpd-php',
    'tmp_name' => $php_path,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($php_path),
]], false);
kodety_forms_assert(
    $rejected_upload instanceof WP_Error && $rejected_upload->get_error_code() === 'kodety_forms_file_type',
    'extensão executável deve ser rejeitada mesmo com arquivo temporário presente'
);

$missing_upload = kodety_forms_private($emails, 'store_uploaded_files', [[
    'field' => 'document',
    'name' => 'missing.pdf',
    'type' => 'application/pdf',
    'tmp_name' => '',
    'error' => UPLOAD_ERR_OK,
    'size' => 20,
]], false);
kodety_forms_assert(
    $missing_upload instanceof WP_Error && $missing_upload->get_error_code() === 'kodety_forms_file_missing',
    'metadados sem tmp_name nunca podem ser aceitos como upload bem-sucedido'
);
kodety_forms_private($emails, 'delete_stored_files', $stored_upload);
kodety_forms_assert(!is_file($encrypted_path), 'exclusão do envio deve remover também o blob privado');

$defense_in_depth = kodety_forms_private($emails, 'sanitize_payload', [
    'name' => 'Grace Hopper',
    'credentials' => [
        'senha' => 'nao-persista',
        'note' => 'Bearer abcdefghijklmnopqrstuvwxyz',
    ],
    'message' => '4111 1111 1111 1111',
]);
$encoded_defense = json_encode($defense_in_depth);
kodety_forms_assert(($defense_in_depth['name'] ?? '') === 'Grace Hopper', 'sanitização deve preservar campos comuns');
kodety_forms_assert(!isset($defense_in_depth['credentials']['senha']), 'chave de senha deve ser removida recursivamente');
kodety_forms_assert(($defense_in_depth['credentials']['note'] ?? '') === '[redacted]', 'token em valor deve ser redigido');
kodety_forms_assert(($defense_in_depth['message'] ?? '') === '[redacted]', 'cartão em valor deve ser redigido');
kodety_forms_assert(!str_contains((string) $encoded_defense, 'nao-persista'), 'segredo original nunca deve sobreviver à sanitização');
kodety_forms_assert(kodety_forms_private($emails, 'payload_contains_sensitive_data', ['outer' => ['inner' => ['client_secret' => 'x']]]) === true, 'detecção deve ser recursiva');
$safe_reset_url = kodety_forms_private(
    $emails,
    'source_url_for_storage',
    'https://example.test/reset-password/abcDEF1234567890abcDEF123456?token=reset-secret#fragment'
);
kodety_forms_assert($safe_reset_url === 'https://example.test/reset-password/redacted', 'tokens em path, query e fragmento devem ser removidos da URL');

$integration_submission = [
    'email' => 'ada@example.test',
    'name' => 'Ada Lovelace',
    'fields' => ['message' => 'Teste'],
];
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, []) === 'idle',
    'sem conexão configurada, a submissão deve informar integração ociosa'
);
$kodety_forms_remote_response = ['response' => ['code' => 204], 'body' => ''];
$kodety_forms_remote_calls = [];
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, ['webhook_url' => 'https://hooks.example.test/forms']) === 'sent',
    'uma integração aceita deve ficar marcada como enviada'
);
kodety_forms_assert(
    ($kodety_forms_remote_calls[0]['args']['redirection'] ?? null) === 0,
    'webhook assinado não pode encaminhar credenciais por redirect'
);
kodety_forms_assert(
    ($kodety_forms_remote_calls[0]['args']['limit_response_size'] ?? 0) === 1024 * 1024
        && ($kodety_forms_remote_calls[0]['args']['data_format'] ?? '') === 'body'
        && str_starts_with((string) ($kodety_forms_remote_calls[0]['args']['headers']['X-Kodety-Idempotency-Key'] ?? ''), 'kodety-form-'),
    'integração deve limitar a resposta e enviar uma chave idempotente sem segredo'
);
$first_idempotency_key = (string) $kodety_forms_remote_calls[0]['args']['headers']['X-Kodety-Idempotency-Key'];
$kodety_forms_remote_calls = [];
kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, ['webhook_url' => 'https://hooks.example.test/forms']);
kodety_forms_assert(
    ($kodety_forms_remote_calls[0]['args']['headers']['X-Kodety-Idempotency-Key'] ?? '') === $first_idempotency_key,
    'a mesma submissão deve produzir a mesma chave para deduplicação no destino'
);
$kodety_forms_remote_calls = [];
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, ['webhook_url' => 'http://127.0.0.1/internal']) === 'failed'
        && $kodety_forms_remote_calls === [],
    'configuração legada privada deve ser revalidada e bloqueada no momento do uso'
);
$kodety_forms_remote_response = ['response' => ['code' => 429], 'body' => 'rate limited'];
$kodety_forms_remote_calls = [];
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, ['webhook_url' => 'https://hooks.example.test/forms']) === 'failed'
        && count($kodety_forms_remote_calls) === 1,
    '429 em mutação deve falhar sem retry cego que possa duplicar o efeito'
);
$kodety_forms_remote_response = new WP_Error('http_request_failed', 'timeout');
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, ['webhook_url' => 'https://hooks.example.test/forms']) === 'failed',
    'uma integração tentada e rejeitada nunca pode aparecer como ociosa'
);
$kodety_forms_remote_response = ['response' => ['code' => 204], 'body' => ''];
$activecampaign_settings = [
    'activecampaign_url' => 'https://account.api-us1.com',
    'activecampaign_key' => 'configured-secret',
    'activecampaign_list_id' => '42',
];
$kodety_forms_remote_responses = [
    ['response' => ['code' => 200], 'body' => '{"contact":{}}'],
];
$kodety_forms_remote_calls = [];
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, $activecampaign_settings) === 'failed'
        && count($kodety_forms_remote_calls) === 1,
    'ActiveCampaign 2xx parcial não deve avançar para a associação da lista'
);
$kodety_forms_remote_responses = [
    ['response' => ['code' => 200], 'body' => '{"contact":{"id":"73"}}'],
    ['response' => ['code' => 201], 'body' => '{}'],
];
$kodety_forms_remote_calls = [];
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, $activecampaign_settings) === 'failed'
        && count($kodety_forms_remote_calls) === 2,
    'associação de lista sem recibo identificável deve falhar fechada'
);
$kodety_forms_remote_responses = [
    ['response' => ['code' => 200], 'body' => '{"contact":{"id":"73"}}'],
    ['response' => ['code' => 201], 'body' => '{"contactList":{"id":"91"}}'],
];
kodety_forms_assert(
    kodety_forms_private($emails, 'dispatch_integrations', $integration_submission, $activecampaign_settings) === 'sent',
    'ActiveCampaign deve concluir somente após recibos válidos das duas mutações'
);
$valid_headers = kodety_forms_private($emails, 'normalize_api_headers_json', '{"X-Workspace":"site","X-Count":2}');
kodety_forms_assert(
    is_string($valid_headers) && json_decode($valid_headers, true) === ['X-Workspace' => 'site', 'X-Count' => '2'],
    'headers adicionais válidos devem ser canonicalizados'
);
foreach ([
    '{"Host":"attacker.example"}',
    '{"X-Test":"ok\\r\\nX-Leak: secret"}',
    '["X-Test: value"]',
] as $unsafe_headers) {
    kodety_forms_assert(
        kodety_forms_private($emails, 'normalize_api_headers_json', $unsafe_headers) instanceof WP_Error,
        'headers reservados, com CRLF ou fora do formato objeto devem ser rejeitados'
    );
}
$plain_secrets = [
    'webhook_secret' => 'webhook-secret-value',
    'api_bearer' => 'bearer-secret-value',
    'api_headers' => '{"X-Api-Key":"header-secret-value"}',
    'activecampaign_key' => 'activecampaign-secret-value',
];
$protected_settings = kodety_forms_private($emails, 'protect_settings', $plain_secrets);
kodety_forms_assert(is_array($protected_settings), 'credenciais válidas devem ser protegidas');
foreach ($plain_secrets as $field => $plain) {
    $stored = (string) ($protected_settings[$field] ?? '');
    kodety_forms_assert(
        str_starts_with($stored, 'enc:v1:') && !str_contains($stored, $plain),
        'credencial ' . $field . ' não pode permanecer em texto puro'
    );
    kodety_forms_assert(
        kodety_forms_private($emails, 'decrypt_secret', $stored) === $plain,
        'credencial ' . $field . ' deve completar round-trip criptográfico'
    );
}
$emails_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-emails.php');
kodety_forms_assert(
    substr_count($emails_source, '$wpdb->query($wpdb->prepare("UPDATE " . self::table()') === 1,
    'ação em massa deve executar somente um UPDATE'
);
kodety_forms_assert(
    substr_count($emails_source, "'redirection' => 0") === 1
        && substr_count($emails_source, "'limit_response_size' => 1024 * 1024") === 1
        && !str_contains($emails_source, "'redirection' => 2"),
    'todas as integrações devem compartilhar o transporte sem redirect e com resposta limitada'
);

$free_runtime_html = Kodety_Emails::inject_runtime(
    '<!doctype html><html><body><script>window.kodetyForms={utmEnabled:true};</script>'
    . '<form data-kodety-utm-enabled="true" data-kodety-utm-config="{&quot;version&quot;:1}"></form>'
    . '<script>window.kodetyForms.utmEnabled=true;</script></body></html>'
);
kodety_forms_assert(
    !str_contains($free_runtime_html, 'data-kodety-utm-enabled')
        && !str_contains($free_runtime_html, 'data-kodety-utm-config'),
    'resposta Free deve remover marcador e payload UTM antes de chegar ao DOM'
);
kodety_forms_assert(
    str_contains($free_runtime_html, '"utmEnabled":false')
        && str_contains($free_runtime_html, 'Object.freeze(config)')
        && str_contains($free_runtime_html, '__kodetyFormsServerConfig_12345678123441238123123456789012')
        && str_contains($free_runtime_html, '#kodety-forms-bootstrap=12345678123441238123123456789012'),
    'runtime Free deve receber snapshot server-injetado, congelado e vinculado à resposta'
);
kodety_forms_assert(
    substr_count($free_runtime_html, 'window.kodetyForms') === 2,
    'scripts autorados ao redor do formulário devem permanecer intactos na resposta Free'
);
$free_draft_html = Kodety_Emails::inject_runtime(
    '<!doctype html><html><body><form data-kodety-utm-config=\'{"version":1,"url":"https://checkout.test/?compare=>"}\'></form></body></html>'
);
kodety_forms_assert(
    !str_contains($free_draft_html, 'data-kodety-utm-config'),
    'payload UTM em rascunho também não deve ser exposto na resposta pública Free'
);
Kodety_Edition::$analytics_utms = true;
$pro_runtime_html = Kodety_Emails::inject_runtime(
    '<!doctype html><html><body><form data-kodety-utm-enabled="true" data-kodety-utm-config="{&quot;version&quot;:1}"></form></body></html>'
);
kodety_forms_assert(
    str_contains($pro_runtime_html, 'data-kodety-utm-enabled="true"')
        && str_contains($pro_runtime_html, 'data-kodety-utm-config=')
        && str_contains($pro_runtime_html, '"utmEnabled":true'),
    'resposta Pro deve preservar o payload operacional e habilitar o snapshot UTM'
);
Kodety_Edition::$analytics_utms = false;

$cms_configuration = kodety_forms_private(
    $emails,
    'normalize_cms_form_configuration',
    'kodety_leads',
    'draft',
    'novo-lead',
    ['name' => 'title', 'email' => 'field:email']
);
kodety_forms_assert(is_array($cms_configuration), 'mapeamento válido do Builder deve ser normalizado');
$cms_token = kodety_forms_private($emails, 'cms_form_token', $cms_configuration);
$signed_html = kodety_forms_private(
    $emails,
    'sign_cms_forms',
    '<form name="novo-lead" data-kodety-cms-collection="kodety_leads" data-kodety-cms-status="draft" data-kodety-cms-map="{&quot;name&quot;:&quot;title&quot;,&quot;email&quot;:&quot;field:email&quot;}"></form>'
);
kodety_forms_assert(str_contains($signed_html, 'data-kodety-cms-token="' . $cms_token . '"'), 'HTML publicado deve receber assinatura do mapeamento CMS');

$cms_request = [
    '_kodety_form' => 'novo-lead',
    '_kodety_started' => (int) floor(microtime(true) * 1000) - 2000,
    '_kodety_cms_collection' => 'kodety_leads',
    '_kodety_cms_status' => 'draft',
    '_kodety_cms_map' => '{"name":"title","email":"field:email"}',
    '_kodety_cms_token' => $cms_token,
    'name' => 'Novo contato',
    'email' => 'contato@example.test',
];
$cms_response = $emails->receive_submission(new WP_REST_Request($cms_request, ['origin' => 'https://example.test']));
kodety_forms_assert($cms_response instanceof WP_REST_Response && $cms_response->get_status() === 201, 'form assinado deve criar submissão e item CMS');
$cms_items = Kodety_Plugin::instance()->form_items;
kodety_forms_assert(
    count($cms_items) === 1
        && $cms_items[0]['collection'] === 'kodety_leads'
        && $cms_items[0]['status'] === 'draft'
        && $cms_items[0]['values'] === ['field:email' => 'contato@example.test', 'title' => 'Novo contato'],
    'somente os valores mapeados e assinados devem chegar ao CMS'
);
$cms_response_data = $cms_response->get_data();
kodety_forms_assert(($cms_response_data['cmsItem']['id'] ?? 0) === 501, 'resposta deve identificar o item criado');

$tampered_request = $cms_request;
$tampered_request['_kodety_started'] = (int) floor(microtime(true) * 1000) - 2000;
$tampered_request['_kodety_cms_map'] = '{"name":"content","email":"field:email"}';
$tampered_response = $emails->receive_submission(new WP_REST_Request($tampered_request, ['origin' => 'https://example.test']));
kodety_forms_assert(
    $tampered_response instanceof WP_Error && $tampered_response->get_error_code() === 'kodety_form_cms_signature',
    'visitante não pode trocar collection ou campo depois que a página foi assinada'
);
kodety_forms_assert(count(Kodety_Plugin::instance()->form_items) === 1, 'mapeamento adulterado nunca deve criar item');

if (is_dir($kodety_forms_uploads)) {
    $cleanup = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($kodety_forms_uploads, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($cleanup as $entry) {
        if ($entry->isFile() || $entry->isLink()) unlink($entry->getPathname());
        elseif ($entry->isDir()) rmdir($entry->getPathname());
    }
    rmdir($kodety_forms_uploads);
}

echo "Segurança do Kodety Forms aprovada.\n";
