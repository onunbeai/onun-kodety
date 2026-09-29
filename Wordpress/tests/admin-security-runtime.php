<?php

/**
 * Isolated regression checks for the WordPress admin security boundaries.
 *
 * Run with: php Wordpress/tests/admin-security-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');

final class WP_Error {
    public function __construct(private string $code, private string $message, private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Response {
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
}

final class WP_REST_Request implements ArrayAccess {
    private array $params;
    private array $headers;
    public function __construct(array $params = [], array $headers = []) {
        $this->params = $params;
        $this->headers = array_change_key_case($headers, CASE_LOWER);
    }
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
    public function get_header(string $name): string { return (string) ($this->headers[strtolower($name)] ?? ''); }
    public function offsetExists(mixed $offset): bool { return isset($this->params[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->params[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->params[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->params[$offset]); }
}

final class WP_User {
    public function __construct(public int $ID) {}
}

// The native service has its own dispatch/authorization runtime suite. This
// double verifies that both MCP transports preserve its exact result/context.
final class Kodety_Native_Operations {
    public static array $calls = [];
    public static mixed $next = null;
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public static function catalog(): array { return json_decode(file_get_contents(KODETY_DIR . 'agent-runtime/native-operations.json'), true); }
    public function execute(string $operation, array $arguments, ?WP_REST_Request $request = null): WP_REST_Response|WP_Error {
        self::$calls[] = [$operation, $arguments, $request];
        return self::$next ?? new WP_REST_Response(['operation' => $operation, 'revision' => 'native-revision']);
    }
}

final class Kodety_Plugin {
    private static ?self $instance = null;
    public static function instance(): self { return self::$instance ??= new self(); }
    public function browser_studio_runtime(): ?array {
        global $kodety_test_browser_studio;
        return $kodety_test_browser_studio ? [
            'enabled' => true,
            'projectId' => '04cc2286-1383-46a5-8055-8dac70d9',
            'studioOrigin' => 'https://studio.kodety.com',
        ] : null;
    }
    public function mcp_sync_project_file(string $relative, string $source): void {}
    public function mcp_delete_project_file(string $relative): void {}
    public function recover_project_delta_for_locked_writer(): void {}
}

// MCP and AI are license-gated in production. This suite exercises their full
// authorized security surface; inactive-license behavior has a separate test.
final class Kodety_License {
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public function is_active(): bool { return true; }
    public function public_status(): array { return ['valid' => true, 'limits' => []]; }
}

$kodety_test_options = [];
$kodety_test_multisite = false;
$kodety_test_browser_studio = false;
$kodety_test_current_user = 0;
$kodety_test_caps = ['manage_options' => true, 'edit_theme_options' => true, 'upload_files' => true];
$kodety_test_transients = [];
$kodety_test_http_requests = [];
$kodety_test_http_response = ['response' => ['code' => 500], 'body' => '{}'];
$kodety_test_fail_option_once = '';
$kodety_test_uploads = sys_get_temp_dir() . '/kodety-security-' . bin2hex(random_bytes(6));
$kodety_test_theme_root = $kodety_test_uploads . '/themes';

function add_action(...$args): void {}
function add_filter(...$args): void {}
function register_rest_route(...$args): void {}
function get_option(string $name, mixed $default = false): mixed { global $kodety_test_options; return $kodety_test_options[$name] ?? $default; }
function update_option(string $name, mixed $value, bool $autoload = false): bool {
    global $kodety_test_options, $kodety_test_fail_option_once;
    if ($kodety_test_fail_option_once === $name) {
        $kodety_test_fail_option_once = '';
        return false;
    }
    $kodety_test_options[$name] = $value;
    return true;
}
function delete_option(string $name): bool { global $kodety_test_options; unset($kodety_test_options[$name]); return true; }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_\-]/', '', strtolower($value)) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? '')); }
function sanitize_title(string $value): string { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($value)) ?? '', '-'); }
function sanitize_file_name(string $value): string { return preg_replace('/[^A-Za-z0-9._ -]+/', '', basename($value)) ?: ''; }
function wp_kses_post(string $value): string { return strip_tags($value, '<p><a><strong><em><ul><ol><li><h1><h2><h3><blockquote>'); }
function esc_url_raw(string $value): string { return filter_var($value, FILTER_SANITIZE_URL) ?: ''; }
function untrailingslashit(string $value): string { return rtrim($value, '/\\'); }
function trailingslashit(string $value): string { return rtrim($value, '/\\') . '/'; }
function wp_parse_url(string $value): array|false { return parse_url($value); }
function wp_http_validate_url(string $value): string|false {
    $parts = parse_url($value);
    $host = strtolower((string) ($parts['host'] ?? ''));
    if (($parts['scheme'] ?? '') !== 'https' || in_array($host, ['localhost', '127.0.0.1', '10.0.0.1', '169.254.169.254'], true)) return false;
    return $value;
}
function wp_get_environment_type(): string { return 'production'; }
function apply_filters(string $name, mixed $value, mixed ...$args): mixed { return $value; }
function rest_sanitize_boolean(mixed $value): bool { return filter_var($value, FILTER_VALIDATE_BOOLEAN); }
function wp_salt(string $scheme = 'auth'): string { return 'test-salt-' . $scheme; }
function is_multisite(): bool { global $kodety_test_multisite; return $kodety_test_multisite; }
function absint(mixed $value): int { return abs((int) $value); }
function get_user_by(string $field, int $id): WP_User|false { return $id === 7 ? new WP_User(7) : false; }
function user_can(WP_User $user, string $capability): bool { global $kodety_test_caps; return $user->ID === 7 && !empty($kodety_test_caps[$capability]); }
function wp_set_current_user(int $id): WP_User { global $kodety_test_current_user; $kodety_test_current_user = $id; return new WP_User($id); }
function current_user_can(string $capability, mixed ...$args): bool { global $kodety_test_caps; return !empty($kodety_test_caps[$capability]); }
function get_current_user_id(): int { global $kodety_test_current_user; return $kodety_test_current_user; }
function current_time(string $type): string { return '2026-07-22T12:00:00-03:00'; }
function get_bloginfo(string $show = ''): string { return $show === 'name' ? 'Site de teste' : '6.8'; }
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function rest_url(string $path = ''): string { return 'https://example.test/wp-json/' . ltrim($path, '/'); }
function wp_get_upload_dir(): array { global $kodety_test_uploads; return ['basedir' => $kodety_test_uploads, 'error' => false]; }
function wp_upload_dir(): array { return wp_get_upload_dir(); }
function get_theme_root(): string { global $kodety_test_theme_root; return $kodety_test_theme_root; }
function wp_mkdir_p(string $directory): bool { return is_dir($directory) || mkdir($directory, 0777, true); }
function wp_normalize_path(string $path): string { return str_replace('\\', '/', $path); }
function set_transient(string $key, mixed $value, int $expiration): bool { global $kodety_test_transients; $kodety_test_transients[$key] = $value; return true; }
function get_transient(string $key): mixed { global $kodety_test_transients; return $kodety_test_transients[$key] ?? false; }
function delete_transient(string $key): bool { global $kodety_test_transients; unset($kodety_test_transients[$key]); return true; }
function wp_json_encode(mixed $value): string|false { return json_encode($value); }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function wp_safe_remote_post(string $url, array $args): array|WP_Error {
    global $kodety_test_http_requests, $kodety_test_http_response;
    $kodety_test_http_requests[] = ['url' => $url, 'args' => $args, 'safe' => true];
    return $kodety_test_http_response;
}
function wp_remote_post(string $url, array $args): array|WP_Error {
    global $kodety_test_http_requests, $kodety_test_http_response;
    $kodety_test_http_requests[] = ['url' => $url, 'args' => $args, 'safe' => false];
    return $kodety_test_http_response;
}
function wp_remote_retrieve_response_code(array|WP_Error $response): int {
    return $response instanceof WP_Error ? 0 : (int) ($response['response']['code'] ?? 0);
}
function wp_remote_retrieve_body(array|WP_Error $response): string {
    return $response instanceof WP_Error ? '' : (string) ($response['body'] ?? '');
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-ai.php';
require dirname(__DIR__) . '/kodety/includes/class-kodety-mcp.php';
require dirname(__DIR__) . '/kodety/includes/class-kodety-media.php';

function kodety_security_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_private(object $object, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($object, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke($object, ...$arguments);
}

function kodety_remove_test_tree(string $directory): void {
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isLink() || $item->isFile()) unlink($item->getPathname());
        elseif ($item->isDir()) rmdir($item->getPathname());
    }
    rmdir($directory);
}

$ai_reflection = new ReflectionClass(Kodety_AI::class);
$ai = $ai_reflection->newInstanceWithoutConstructor();
$legacy_ai_settings = [
    'provider' => 'openai',
    'model' => 'gpt-5.6-luna',
    'baseUrl' => 'https://api.openai.com/v1',
    'language' => 'Português do Brasil',
    'tone' => 'claro, humano e profissional',
];
$kodety_test_options['kodety_ai_settings'] = $legacy_ai_settings + ['temperature' => 0.7];
kodety_security_assert(
    ($ai->public_settings()['temperature'] ?? null) === 1.0,
    'o default legado 0.7 sem escolha confirmada deve migrar para criatividade 1'
);
$kodety_test_options['kodety_ai_settings'] = $legacy_ai_settings + ['temperature' => 0.35];
kodety_security_assert(
    ($ai->public_settings()['temperature'] ?? null) === 0.35,
    'uma preferência legada válida diferente do antigo default deve ser preservada'
);
$kodety_test_options['kodety_ai_settings'] = $legacy_ai_settings + ['temperature' => 'invalid'];
kodety_security_assert(
    ($ai->public_settings()['temperature'] ?? null) === 1.0,
    'temperatura ausente ou inválida deve usar criatividade 1'
);
$kodety_test_options['kodety_ai_settings'] = $legacy_ai_settings + [
    'temperature' => 0.7,
    'temperatureExplicit' => true,
];
kodety_security_assert(
    ($ai->public_settings()['temperature'] ?? null) === 0.7,
    'uma escolha explícita de 0.7 deve ser preservada apesar do antigo default'
);
$kodety_test_options = [];
$saved = $ai->save_settings(new WP_REST_Request([
    'provider' => 'openai',
    'model' => 'model-test',
    'baseUrl' => 'https://attacker.example/v1',
    'apiKey' => 'secret-value-123',
]));
kodety_security_assert($saved instanceof WP_REST_Response, 'configuração válida de IA deve ser salva');
kodety_security_assert(
    ($kodety_test_options['kodety_ai_settings']['baseUrl'] ?? '') === 'https://api.openai.com/v1',
    'provedores conhecidos devem ignorar baseUrl adulterado'
);
kodety_security_assert(
    ($kodety_test_options['kodety_ai_settings']['temperature'] ?? null) === 1.0
        && ($kodety_test_options['kodety_ai_settings']['temperatureExplicit'] ?? false) === true
        && (($saved->get_data()['temperature'] ?? null) === 1.0),
    'a primeira configuração deve nascer em criatividade 1 e confirmar o valor persistido'
);
$first_secret = (string) ($kodety_test_options['kodety_ai_api_key']['openai'] ?? '');
kodety_security_assert($first_secret !== '' && !str_contains($first_secret, 'secret-value-123'), 'API Key deve permanecer cifrada');
$public_ai = $saved->get_data();
kodety_security_assert(!str_contains(json_encode($public_ai), 'secret-value-123'), 'resposta pública nunca pode reexibir a API Key');

$stable_ai_options = $kodety_test_options;
$kodety_test_fail_option_once = 'kodety_ai_api_key';
$failed_secret_write = $ai->save_settings(new WP_REST_Request([
    'provider' => 'openai',
    'model' => 'model-secret-write-must-fail',
    'apiKey' => 'replacement-secret-must-not-persist',
]));
kodety_security_assert(
    $failed_secret_write instanceof WP_Error
        && $failed_secret_write->get_error_code() === 'kodety_ai_settings_persistence_failed'
        && $kodety_test_options === $stable_ai_options,
    'falha ao gravar o segredo deve restaurar integralmente a configuração anterior'
);

$kodety_test_fail_option_once = 'kodety_ai_settings';
$failed_settings_write = $ai->save_settings(new WP_REST_Request([
    'provider' => 'openai',
    'model' => 'model-settings-write-must-fail',
    'apiKey' => 'second-replacement-secret-must-not-persist',
]));
kodety_security_assert(
    $failed_settings_write instanceof WP_Error
        && $failed_settings_write->get_error_code() === 'kodety_ai_settings_persistence_failed'
        && $kodety_test_options === $stable_ai_options,
    'falha após atualizar o segredo deve reverter segredo e configuração como uma única operação'
);

$masked = $ai->save_settings(new WP_REST_Request([
    'provider' => 'openai',
    'model' => 'model-test',
    'baseUrl' => 'https://api.openai.com/v1',
    'apiKey' => '••••••••',
]));
kodety_security_assert($masked instanceof WP_REST_Response, 'máscara de segredo deve ser aceita como valor de exibição');
kodety_security_assert(($kodety_test_options['kodety_ai_api_key']['openai'] ?? '') === $first_secret, 'máscara não pode sobrescrever a credencial');
$explicit_temperature = $ai->save_settings(new WP_REST_Request([
    'provider' => 'openai',
    'model' => 'model-test',
    'temperature' => 0.35,
]));
kodety_security_assert(
    $explicit_temperature instanceof WP_REST_Response
        && ($kodety_test_options['kodety_ai_settings']['temperature'] ?? null) === 0.35
        && ($kodety_test_options['kodety_ai_settings']['temperatureExplicit'] ?? false) === true
        && (($explicit_temperature->get_data()['temperature'] ?? null) === 0.35),
    'a criatividade deve continuar editável e preservar a escolha explícita'
);
$sanitized_draft = kodety_private($ai, 'sanitize_generated_draft', 'article', [
    'title' => '<b>Title</b>',
    'content' => '<p>Safe</p><script>alert(1)</script>',
    'unexpected' => 'must not escape',
]);
kodety_security_assert(!str_contains($sanitized_draft['content'] ?? '', '<script'), 'HTML gerado por IA deve passar pela allowlist do WordPress');
kodety_security_assert(!array_key_exists('unexpected', $sanitized_draft), 'campos inesperados do provedor devem ser descartados');

$codex_settings = $ai->save_settings(new WP_REST_Request([
    'provider' => 'codex',
    'model' => 'gpt-5.3-codex',
    'baseUrl' => 'https://api.openai.com/v1',
]));
kodety_security_assert($codex_settings instanceof WP_REST_Response, 'perfil Codex deve reutilizar a credencial OpenAI protegida');
$kodety_test_http_requests = [];
$kodety_test_http_response = [
    'response' => ['code' => 200],
    'body' => json_encode([
        'status' => 'completed',
        'output' => [[
            'type' => 'message',
            'content' => [['type' => 'output_text', 'text' => '{"ok":true,"transport":"responses"}']],
        ]],
    ]),
];
$codex_result = kodety_private($ai, 'complete', 'Return JSON.', 'Test Codex transport.', 180);
$codex_request = $kodety_test_http_requests[0] ?? [];
$codex_body = json_decode((string) ($codex_request['args']['body'] ?? ''), true);
kodety_security_assert(($codex_request['url'] ?? '') === 'https://api.openai.com/v1/responses', 'modelos Codex devem usar a Responses API oficial');
kodety_security_assert(
    ($codex_body['instructions'] ?? '') === 'Return JSON.'
        && ($codex_body['input'] ?? '') === 'Test Codex transport.'
        && ($codex_body['max_output_tokens'] ?? 0) === 180
        && ($codex_body['text']['format']['type'] ?? '') === 'json_object'
        && ($codex_body['store'] ?? null) === false
        && !isset($codex_body['messages'], $codex_body['response_format']),
    'payload Codex deve seguir o contrato da Responses API'
);
kodety_security_assert(($codex_result['transport'] ?? '') === 'responses', 'saída estruturada da Responses API deve ser extraída');

$openai_settings = $ai->save_settings(new WP_REST_Request([
    'provider' => 'openai',
    'model' => 'gpt-5.6-luna',
    'baseUrl' => 'https://api.openai.com/v1',
]));
kodety_security_assert($openai_settings instanceof WP_REST_Response, 'perfil OpenAI deve permanecer configurável');
$kodety_test_http_requests = [];
$kodety_test_http_response = [
    'response' => ['code' => 200],
    'body' => json_encode(['choices' => [['message' => ['content' => '{"ok":true,"transport":"chat"}']]]]),
];
$chat_result = kodety_private($ai, 'complete', 'Return JSON.', 'Test Chat transport.', 90);
$chat_request = $kodety_test_http_requests[0] ?? [];
$chat_body = json_decode((string) ($chat_request['args']['body'] ?? ''), true);
kodety_security_assert(($chat_request['url'] ?? '') === 'https://api.openai.com/v1/chat/completions', 'modelos OpenAI não-Codex devem continuar no Chat Completions');
kodety_security_assert(
    isset($chat_body['messages'], $chat_body['max_completion_tokens'], $chat_body['response_format'])
        && ($chat_body['temperature'] ?? null) === 0.35
        && !isset($chat_body['instructions'], $chat_body['input']),
    'payload Chat Completions deve usar a criatividade explícita preservada'
);
kodety_security_assert(($chat_result['transport'] ?? '') === 'chat', 'saída estruturada do Chat Completions deve continuar válida');

$private_endpoint = $ai->save_settings(new WP_REST_Request([
    'provider' => 'custom',
    'model' => 'local',
    'baseUrl' => 'https://169.254.169.254/v1',
]));
kodety_security_assert($private_endpoint instanceof WP_Error && $private_endpoint->get_error_code() === 'kodety_ai_url_invalid', 'endpoint privado deve ser rejeitado em produção');

$workspace = $kodety_test_uploads . '/kodety/private/workspace/My Project';
wp_mkdir_p($workspace);
file_put_contents($workspace . '/index.html', '<h1>Draft</h1>');
wp_mkdir_p($kodety_test_theme_root . '/kodety-generated/site');
file_put_contents($kodety_test_theme_root . '/kodety-generated/site/index.html', '<h1>Published</h1>');

$mcp_reflection = new ReflectionClass(Kodety_MCP::class);
$mcp = $mcp_reflection->newInstanceWithoutConstructor();
$kodety_test_options['kodety_mcp_enabled'] = '1';
$kodety_test_options['kodety_mcp_token_hash'] = hash('sha256', 'activity-test-token');
$kodety_test_options['kodety_mcp_owner_id'] = 7;
$activity_response = $mcp->execute_tool(new WP_REST_Request([
    'tool' => 'list_files',
    'arguments' => [],
]));
$activity = $kodety_test_options['kodety_mcp_activity'] ?? [];
kodety_security_assert(
    $activity_response instanceof WP_REST_Response
        && ($activity['active'] ?? true) === false
        && ($activity['phase'] ?? '') === 'reading'
        && (int) ($activity['visibleUntil'] ?? 0) >= time() + 40,
    'atividade MCP curta deve permanecer observável pelo polling do Builder sem ficar presa como ativa'
);
kodety_security_assert(
    (($mcp->status()['activity']['id'] ?? '') === ($activity['id'] ?? '')),
    'status MCP deve expor a atividade recente ao indicador do Builder'
);
$correlated_activity_id = kodety_private($mcp, 'begin_activity', 'write_file', [
    'path' => 'index.html',
]);
$kodety_test_options['kodety_mcp_activity'] = [
    'id' => 'concurrent-read',
    'active' => true,
    'phase' => 'reading',
    'tool' => 'read_file',
    'expiresAt' => time() + 120,
];
kodety_security_assert(
    kodety_private($mcp, 'current_activity_id') === $correlated_activity_id,
    'mudança MCP deve manter o ID da própria requisição mesmo quando outra atividade vence o estado global'
);
kodety_private($mcp, 'finish_activity', $correlated_activity_id, true, ['path' => 'index.html'], '');
$section_activity_id = kodety_private($mcp, 'begin_activity', 'upsert_section', [
    'page' => 'index.html',
    'sectionId' => 'hero-main',
    'html' => '<section>segredo não deve aparecer no status</section>',
]);
kodety_private($mcp, 'finish_activity', $section_activity_id, true, [
    'page' => 'index.html',
    'sectionId' => 'hero-main',
    'operation' => 'replaced',
], '');
$section_activity = $kodety_test_options['kodety_mcp_activity'] ?? [];
kodety_security_assert(
    ($section_activity['target']['page'] ?? '') === 'index.html'
        && ($section_activity['target']['sectionId'] ?? '') === 'hero-main'
        && ($section_activity['result']['operation'] ?? '') === 'replaced'
        && !str_contains((string) json_encode($section_activity), 'segredo'),
    'feedback MCP deve expor somente alvo e resultado limitados, nunca o conteúdo enviado pelo agente'
);
$section_events = $mcp->status()['activityEvents'] ?? [];
$last_section_event = $section_events !== [] ? $section_events[array_key_last($section_events)] : [];
kodety_security_assert(
    ($last_section_event['id'] ?? '') === $section_activity_id,
    'conclusões mutantes devem sobreviver na fila curta mesmo se a próxima chamada substituir a atividade atual'
);
kodety_private($mcp, 'apply_connection_operation', 'disable');
kodety_security_assert(
    ($mcp->status()['activity'] ?? null) === null
        && !isset($kodety_test_options['kodety_mcp_activity'])
        && !isset($kodety_test_options['kodety_mcp_activity_events']),
    'desativar o MCP deve limpar e ocultar qualquer atividade ou notificação residual'
);
kodety_security_assert(kodety_private($mcp, 'project_root') === $workspace, 'MCP deve apontar para o workspace privado de rascunho');
kodety_security_assert(kodety_private($mcp, 'relative_path', 'assets/Hero Image.webp') === 'assets/Hero Image.webp', 'nomes válidos não devem ser reescritos');
kodety_security_assert(kodety_private($mcp, 'relative_path', '.incode/project.json') === '.incode/project.json', 'manifesto nativo do projeto deve continuar acessível');
kodety_security_assert(
    kodety_private($mcp, 'relative_path', '.incode/animations/pages%2Fabout.html.json')
        === '.incode/animations/pages%2Fabout.html.json',
    'MCP deve preservar percent-encoding literal dos nomes canônicos de Interactions'
);
kodety_security_assert(
    kodety_private($mcp, 'animation_document_path', 'pages/Hero Page.html')
        === '.incode/animations/pages%2FHero%20Page.html.json',
    'MCP deve usar o mesmo nome codificado e sem colisões do editor para Interactions'
);
kodety_security_assert(
    kodety_private($mcp, 'animation_document_path', 'a/b.html')
        !== kodety_private($mcp, 'animation_document_path', 'a__b.html'),
    'páginas distintas não podem compartilhar o documento de Interactions'
);
foreach (['../outside.txt', 'assets/.env', 'bad' . "\0" . 'name.css'] as $unsafe_path) {
    try {
        kodety_private($mcp, 'relative_path', $unsafe_path);
        kodety_security_assert(false, 'caminho inseguro deveria ser rejeitado: ' . $unsafe_path);
    } catch (InvalidArgumentException) {}
}

$written = kodety_private($mcp, 'tool_write_file', ['path' => 'assets/new file.css', 'content' => '.hero { color: red; }']);
kodety_security_assert(is_file($workspace . '/assets/new file.css'), 'escrita MCP deve criar o arquivo no workspace');
kodety_security_assert(!is_file($kodety_test_theme_root . '/kodety-generated/site/assets/new file.css'), 'escrita MCP não pode alterar o tema publicado');
kodety_security_assert(($written['revision'] ?? 0) === 1, 'escrita atômica deve avançar a revisão MCP');
kodety_security_assert(($written['workspaceRevision'] ?? 0) === 1, 'escrita MCP deve invalidar autosaves antigos do Builder');

$coded_original = <<<'HTML'
<!doctype html><html><head>
<!-- <section data-kodety-section-id="hero"><section>Comment fake nested</section></section> -->
<script>window.fakeSection = '<section data-kodety-section-id="hero"><section>Script fake nested</section></section>';</script>
<style>.fake::after { content: "</section><section data-kodety-section-id='hero'>"; }</style>
</head><body><main><section data-kodety-section-id="hero">
<template><section>Template old</section><!-- </section> --></template>
<svg viewBox="0 0 10 10"><style>.shape::after { content: "</section>"; }</style><g><path d="M0 0h10v10z" /></g><foreignObject><section>SVG old</section></foreignObject></svg>
<img src="hero.webp"><input type="hidden" />
<script>const fakeClose = "</section>"; const fakeOpen = "<section>";</script>
<style>.hero::before { content: "</section><section>"; }</style>
<p>Old</p></section><p>After hero</p></main></body></html>
HTML;
file_put_contents($workspace . '/index.html', $coded_original);
wp_mkdir_p($workspace . '/.incode');
file_put_contents($workspace . '/.incode/coded-build.json', (string) wp_json_encode([
    'version' => 2,
    'originals' => ['index.html' => $coded_original],
    'generated' => ['kodety-build/js/main.js'],
]));
$section_result = kodety_private($mcp, 'tool_upsert_section', [
    'page' => 'index.html',
    'sectionId' => 'hero',
    'baseRevision' => 1,
    'html' => '<section data-kodety-section-id="hero" data-label="Hero" data-kodety-interaction-id="hero"><h1>New hero</h1></section>',
    'css' => '.hero { display: grid; }',
    'interactions' => [[
        'id' => 'hero-load',
        'trigger' => 'load',
        'triggerSelector' => '[data-kodety-interaction-id="hero"]',
        'triggerTargetMode' => 'element',
        'actions' => [],
        'reducedMotion' => 'end',
        'enabledBreakpoints' => ['desktop', 'tablet', 'mobile'],
    ]],
]);
$section_page = (string) file_get_contents($workspace . '/index.html');
kodety_security_assert(($section_result['operation'] ?? '') === 'replaced', 'upsert deve substituir uma seção existente');
kodety_security_assert(($section_result['workspaceRevision'] ?? 0) === 2, 'HTML, CSS e Interactions devem avançar apenas uma revisão');
kodety_security_assert(
    str_contains($section_page, '<h1>New hero</h1>')
        && !str_contains($section_page, 'Template old')
        && !str_contains($section_page, 'SVG old')
        && str_contains($section_page, 'Comment fake nested')
        && str_contains($section_page, 'Script fake nested')
        && str_contains($section_page, '<p>After hero</p>'),
    'substituição deve ignorar comentários/raw text e balancear template, SVG, void e tags autocontidas'
);
kodety_security_assert(str_contains($section_page, 'data-kodety-section-style="hero"'), 'página deve vincular o stylesheet próprio da seção');
$coded_manifest = json_decode((string) file_get_contents($workspace . '/.incode/coded-build.json'), true);
kodety_security_assert(
    str_contains((string) ($coded_manifest['originals']['index.html'] ?? ''), '<h1>New hero</h1>')
        && str_contains((string) ($coded_manifest['originals']['index.html'] ?? ''), 'data-kodety-section-style="hero"'),
    'upsert deve atualizar também o HTML autoral que o Builder hidrata de coded-build.json'
);
kodety_security_assert(is_file($workspace . '/styles/kodety-sections/index--hero.css'), 'CSS da seção deve ser persistido separadamente');
$section_interactions = json_decode((string) file_get_contents($workspace . '/.incode/animations/index.html.json'), true);
kodety_security_assert(
    ($section_interactions['version'] ?? 0) === 2
        && ($section_interactions['interactions'][0]['id'] ?? '') === 'hero-load'
        && ($section_interactions['interactions'][0]['sectionId'] ?? '') === 'hero',
    'Interactions da seção devem ser reconhecíveis e vinculadas à seção'
);
$last_change = $kodety_test_options['kodety_mcp_last_change'] ?? [];
kodety_security_assert(
    ($last_change['kind'] ?? '') === 'section'
        && ($last_change['sectionId'] ?? '') === 'hero'
        && ($last_change['workspaceRevision'] ?? 0) === 2,
    'status MCP deve descrever a última seção para o Builder sincronizar'
);
$stale_rejected = false;
try {
    kodety_private($mcp, 'tool_upsert_section', [
        'page' => 'index.html',
        'sectionId' => 'hero',
        'baseRevision' => 1,
        'html' => '<section data-kodety-section-id="hero"><h1>Stale</h1></section>',
    ]);
} catch (RuntimeException $error) {
    $stale_rejected = $error->getCode() === 409;
}
kodety_security_assert($stale_rejected && !str_contains((string) file_get_contents($workspace . '/index.html'), 'Stale'), 'baseRevision antiga deve ser rejeitada sem alterar o workspace');

[$template_replaced] = kodety_private(
    $mcp,
    'replace_or_append_section',
    '<main><template data-kodety-section-id="hero"><section>Template root old</section></template><p>Template tail</p></main>',
    'hero',
    '<section data-kodety-section-id="hero">Template root new</section>'
);
[$svg_replaced] = kodety_private(
    $mcp,
    'replace_or_append_section',
    '<main><svg data-kodety-section-id="hero"><style>.x{content:"</svg>"}</style><path d="M0 0h1" /></svg><p>SVG tail</p></main>',
    'hero',
    '<section data-kodety-section-id="hero">SVG root new</section>'
);
[$void_replaced] = kodety_private(
    $mcp,
    'replace_or_append_section',
    '<main><img data-kodety-section-id="hero" src="old.webp"><p>Void tail</p></main>',
    'hero',
    '<section data-kodety-section-id="hero">Void root new</section>'
);
[$self_closing_replaced] = kodety_private(
    $mcp,
    'replace_or_append_section',
    '<main><custom-card data-kodety-section-id="hero" /><p>Self-closing tail</p></main>',
    'hero',
    '<section data-kodety-section-id="hero">Self-closing root new</section>'
);
[$appended_adversarial, $append_created] = kodety_private(
    $mcp,
    'replace_or_append_section',
    '<body><template><main><p>Template main</p></main></template><!-- </main> --><script>const fake="</main>";</script><main><p>Real main</p></main></body>',
    'new-section',
    '<section data-kodety-section-id="new-section">Appended safely</section>'
);
kodety_security_assert(
    str_contains($template_replaced, 'Template root new')
        && !str_contains($template_replaced, 'Template root old')
        && str_contains($template_replaced, 'Template tail')
        && str_contains($svg_replaced, 'SVG root new')
        && str_contains($svg_replaced, 'SVG tail')
        && str_contains($void_replaced, 'Void root new')
        && str_contains($void_replaced, 'Void tail')
        && str_contains($self_closing_replaced, 'Self-closing root new')
        && str_contains($self_closing_replaced, 'Self-closing tail')
        && $append_created === true
        && str_contains($appended_adversarial, "<p>Real main</p>\n<section data-kodety-section-id=\"new-section\">Appended safely</section>\n</main>")
        && substr_count($appended_adversarial, 'Appended safely') === 1,
    'parser de seção deve tratar raízes template/SVG/void/self-closing e inserir fora de template, comentário e raw script'
);

$malformed_closings_rejected = 0;
foreach (["</ section>", "</\tsection>", "</\nsection>", "</\fsection>"] as $malformed_closing) {
    try {
        kodety_private(
            $mcp,
            'validate_section_html',
            '<section data-kodety-section-id="hero">Invalid' . $malformed_closing,
            'hero'
        );
    } catch (InvalidArgumentException) {
        $malformed_closings_rejected++;
    }
}
kodety_security_assert(
    $malformed_closings_rejected === 4,
    'fechamento com whitespace após </ não pode validar uma raiz que o navegador mantém aberta'
);

$unquoted_slash_rejected = false;
try {
    kodety_private(
        $mcp,
        'validate_section_html',
        '<section data-kodety-section-id=hero/>',
        'hero'
    );
} catch (InvalidArgumentException) {
    $unquoted_slash_rejected = true;
}
$unquoted_slash_attributes = kodety_private(
    $mcp,
    'html_start_tag_attributes',
    '<custom-card data-kodety-section-id=hero/>'
);
$vertical_tab_attributes = kodety_private(
    $mcp,
    'html_start_tag_attributes',
    "<custom-card data-kodety-section-id=hero\v/>"
);
kodety_security_assert(
    $unquoted_slash_rejected
        && kodety_private($mcp, 'html_tag_is_self_closing', '<custom-card data-kodety-section-id=hero/>') === false
        && kodety_private($mcp, 'html_tag_is_self_closing', "<custom-card data-kodety-section-id=hero\v/>") === false
        && kodety_private($mcp, 'html_tag_is_self_closing', '<custom-card data-kodety-section-id=hero />') === true
        && kodety_private($mcp, 'html_tag_is_self_closing', '<custom-card data-kodety-section-id="hero"/>') === true
        && kodety_private($mcp, 'html_tag_is_self_closing', '<custom-card disabled/>') === true
        && ($unquoted_slash_attributes['data-kodety-section-id'] ?? '') === 'hero/'
        && ($vertical_tab_attributes['data-kodety-section-id'] ?? '') === "hero\v/",
    'slash de valor sem aspas deve ser dado; apenas o marcador HTML real pode autocontê-lo'
);

$rcdata_document = '<html><head><title><section data-kodety-section-id="hero">Title fake</section></title></head>'
    . '<body><main><textarea><section data-kodety-section-id="hero">Textarea fake</section><main>Textarea main</main></textarea>'
    . '<p>Real main</p></main></body></html>';
[$rcdata_appended, $rcdata_created] = kodety_private(
    $mcp,
    'replace_or_append_section',
    $rcdata_document,
    'hero',
    '<section data-kodety-section-id="hero">RCDATA replacement</section>'
);
kodety_security_assert(
    $rcdata_created === true
        && str_contains($rcdata_appended, '<title><section data-kodety-section-id="hero">Title fake</section></title>')
        && str_contains($rcdata_appended, '<textarea><section data-kodety-section-id="hero">Textarea fake</section><main>Textarea main</main></textarea>')
        && str_contains($rcdata_appended, "<p>Real main</p>\n<section data-kodety-section-id=\"hero\">RCDATA replacement</section>\n</main>")
        && substr_count($rcdata_appended, 'RCDATA replacement') === 1,
    'title/textarea devem ser texto opaco; marcador e main internos não podem virar alvos estruturais'
);

$remote_tools_response = $mcp->execute_remote_protocol(new WP_REST_Request([
    'jsonrpc' => '2.0',
    'id' => 1,
    'method' => 'tools/list',
]));
$remote_tools = $remote_tools_response->get_data();
$remote_tool_names = array_column($remote_tools['result']['tools'] ?? [], 'name');
kodety_security_assert(in_array('kodety_upsert_section', $remote_tool_names, true), 'MCP remoto deve anunciar a ferramenta por seção');

$remote_initialize_response = $mcp->execute_remote_protocol(new WP_REST_Request([
    'jsonrpc' => '2.0',
    'id' => 2,
    'method' => 'initialize',
]));
$remote_initialize = $remote_initialize_response->get_data()['result'] ?? [];
kodety_security_assert(
    isset($remote_initialize['capabilities']['resources'], $remote_initialize['capabilities']['prompts'])
        && str_contains((string) ($remote_initialize['instructions'] ?? ''), 'Agent nativo do Builder'),
    'MCP remoto deve anunciar resources/prompts das skills sem pedir atualização ao Agent nativo'
);
$remote_resources_response = $mcp->execute_remote_protocol(new WP_REST_Request([
    'jsonrpc' => '2.0',
    'id' => 3,
    'method' => 'resources/list',
]));
$remote_resources = $remote_resources_response->get_data()['result']['resources'] ?? [];
$remote_resource_uris = array_column($remote_resources, 'uri');
kodety_security_assert(
    in_array('kodety://skills/catalog', $remote_resource_uris, true)
        && in_array('kodety://skills/kodety-site-code/kodety.manifest.json', $remote_resource_uris, true)
        && in_array('kodety://skills/kodety-motion/SKILL.md', $remote_resource_uris, true),
    'MCP remoto deve expor catálogo, manifests e arquivos completos das skills oficiais'
);
$remote_catalog_response = $mcp->execute_remote_protocol(new WP_REST_Request([
    'jsonrpc' => '2.0',
    'id' => 4,
    'method' => 'resources/read',
    'params' => ['uri' => 'kodety://skills/catalog'],
]));
$remote_catalog_text = (string) ($remote_catalog_response->get_data()['result']['contents'][0]['text'] ?? '');
$remote_catalog = json_decode($remote_catalog_text, true);
$motion_catalog = [];
foreach ((array) ($remote_catalog['packages'] ?? []) as $package) {
    if (($package['name'] ?? '') === 'kodety-motion') $motion_catalog = $package;
}
$motion_skill_file = [];
foreach ((array) ($motion_catalog['files'] ?? []) as $file) {
    if (($file['path'] ?? '') === 'SKILL.md') $motion_skill_file = $file;
}
$remote_motion_skill_response = $mcp->execute_remote_protocol(new WP_REST_Request([
    'jsonrpc' => '2.0',
    'id' => 5,
    'method' => 'resources/read',
    'params' => ['uri' => (string) ($motion_skill_file['uri'] ?? '')],
]));
$remote_motion_skill = (string) ($remote_motion_skill_response->get_data()['result']['contents'][0]['text'] ?? '');
kodety_security_assert(
    count((array) ($remote_catalog['packages'] ?? [])) === 4
        && ($remote_catalog['distributionScope'] ?? '') === 'external-mcp-clients'
        && ($remote_catalog['nativeAgent']['managedBy'] ?? '') === 'kodety-builder'
        && ($remote_catalog['nativeAgent']['installRequired'] ?? true) === false
        && ($remote_catalog['nativeAgent']['updateCheckRequired'] ?? true) === false
        && preg_match('/^sha256:[a-f0-9]{64}$/D', (string) ($motion_catalog['digest'] ?? ''))
        && hash('sha256', $remote_motion_skill) === ($motion_skill_file['sha256'] ?? ''),
    'catálogo externo deve permitir detectar atualização e verificar cada arquivo por SHA-256'
);
$remote_prompt_response = $mcp->execute_remote_protocol(new WP_REST_Request([
    'jsonrpc' => '2.0',
    'id' => 6,
    'method' => 'prompts/get',
    'params' => ['name' => 'install-kodety-skills'],
]));
$remote_install_prompt = (string) ($remote_prompt_response->get_data()['result']['messages'][0]['content']['text'] ?? '');
kodety_security_assert(
    str_contains($remote_install_prompt, 'kodety.manifest.json')
        && str_contains($remote_install_prompt, 'Agent nativo')
        && str_contains($remote_install_prompt, '$CODEX_HOME/skills')
        && str_contains($remote_install_prompt, '$HOME/.codex/skills')
        && str_contains($remote_install_prompt, '$HOME/.agents/skills')
        && str_contains($remote_install_prompt, '$HOME/.claude/skills')
        && !str_contains(strtolower($remote_install_prompt), 'bearer kodety_'),
    'prompt MCP deve atualizar somente raízes reconhecidas de clientes externos e nunca incorporar credenciais'
);
$skill_status = $mcp->status()['skills'] ?? [];
kodety_security_assert(
    count((array) ($skill_status['packages'] ?? [])) === 4
        && str_ends_with(strtok((string) ($skill_status['bundleUrl'] ?? ''), '?') ?: '', '/docs/kodety-agent-skills.zip'),
    'status MCP deve orientar clientes externos para o catálogo e o pacote hospedado'
);

$outside = $kodety_test_uploads . '/outside.txt';
file_put_contents($outside, 'outside');
if (function_exists('symlink') && @symlink($outside, $workspace . '/leak.txt')) {
    try {
        kodety_private($mcp, 'project_file', 'leak.txt');
        kodety_security_assert(false, 'link simbólico deveria ser rejeitado');
    } catch (InvalidArgumentException) {}
}

$token = 'kodety_' . bin2hex(random_bytes(24));
$protected_token = kodety_private($mcp, 'protect_one_time_token', $token);
kodety_security_assert($protected_token !== $token && !str_contains($protected_token, $token), 'entrega temporária do token MCP deve ficar cifrada');
kodety_security_assert(kodety_private($mcp, 'unprotect_one_time_token', $protected_token) === $token, 'token MCP cifrado deve ser recuperável uma única vez pelo painel');
$kodety_test_current_user = 7;
$connection = kodety_private($mcp, 'apply_connection_operation', 'enable', true);
preg_match('/--token\s+[\'"]?(kodety_[a-f0-9]{48})/', (string) ($connection['command'] ?? ''), $delivered);
$delivered_token = (string) ($delivered[1] ?? '');
kodety_security_assert($delivered_token !== '', 'ativação MCP deve entregar uma credencial uma única vez');
$remote_config = json_decode((string) ($connection['remoteConfig'] ?? ''), true);
kodety_security_assert(
    ($remote_config['mcpServers']['kodety']['headers']['Authorization'] ?? '') === 'Bearer ' . $delivered_token
        && str_ends_with((string) ($remote_config['mcpServers']['kodety']['url'] ?? ''), '/wp-json/kodety/v1/mcp'),
    'ativação MCP deve entregar configuração remota copiável com URL e credencial'
);
kodety_security_assert(($kodety_test_options['kodety_mcp_token_hash'] ?? '') === hash('sha256', $delivered_token), 'somente o hash do token MCP deve ser persistido');
kodety_security_assert(
    !str_contains(implode('', array_map('strval', $kodety_test_transients)), $delivered_token),
    'transient de entrega MCP não pode armazenar o token em texto puro'
);
$global_token_hash = (string) ($kodety_test_options['kodety_mcp_token_hash'] ?? '');
$kodety_test_options['kodety_workspace_mode'] = 'agency';
$kodety_test_options['kodety_workspace_project_id'] = 'workspace-cliente-a';
$kodety_test_options['kodety_project_name'] = 'Cliente A Workspace';
$kodety_test_options['kodety_agency_active_project'] = 'cliente-a';
$kodety_test_options['kodety_agency_projects'] = [
    'cliente-a' => [
        'name' => 'Cliente A',
        'slug' => 'cliente-a',
        'isRoot' => false,
    ],
    'cliente-b' => [
        'name' => 'Cliente B',
        'slug' => 'cliente-b',
        'isRoot' => false,
    ],
];
$target_status = $mcp->status();
kodety_security_assert(
    ($target_status['target']['workspaceMode'] ?? '') === 'single'
        && !array_key_exists('agencyProjectId', $target_status['target'])
        && ($target_status['target']['workspaceProjectId'] ?? '') === 'workspace-cliente-a'
        && !array_key_exists('isRoot', $target_status['target']),
    'status MCP deve expor a identidade persistida do workspace e ignorar configurações antigas de agência'
);
$project_connection_response = $mcp->create_project_connection(new WP_REST_Request());
$project_connection_payload = $project_connection_response instanceof WP_REST_Response
    ? $project_connection_response->get_data()
    : [];
$project_remote_config = json_decode((string) ($project_connection_payload['remoteConfig'] ?? ''), true);
$project_server = is_array($project_remote_config['mcpServers'] ?? null)
    ? reset($project_remote_config['mcpServers'])
    : [];
$project_bearer = (string) ($project_server['headers']['Authorization'] ?? '');
$project_token = str_starts_with($project_bearer, 'Bearer ') ? substr($project_bearer, 7) : '';
$project_connection_id = (string) ($project_connection_payload['connection']['id'] ?? '');
kodety_security_assert(
    $project_connection_response instanceof WP_REST_Response
        && $project_connection_response->get_status() === 201
        && preg_match('/^kodety_[a-f0-9]{48}$/D', $project_token)
        && preg_match('/^project-[a-f0-9]{16}$/D', $project_connection_id)
        && ($project_connection_payload['connection']['projectId'] ?? '') === 'workspace-cliente-a',
    'topbar deve gerar uma credencial copiável vinculada ao projeto ativo'
);
kodety_security_assert(
    ($kodety_test_options['kodety_mcp_token_hash'] ?? '') === $global_token_hash
        && count($kodety_test_options['kodety_mcp_project_connections'] ?? []) === 1
        && (($kodety_test_options['kodety_mcp_project_connections'][$project_connection_id]['projectId'] ?? '') === 'workspace-cliente-a')
        && (($kodety_test_options['kodety_mcp_project_connections'][$project_connection_id]['scopeVersion'] ?? 0) === 2)
        && !str_contains(json_encode($kodety_test_options['kodety_mcp_project_connections']), $project_token),
    'nova conexão deve preservar a global, persistir somente hash e usar o ID real do workspace'
);
$second_project_connection = $mcp->create_project_connection(new WP_REST_Request());
$second_connection_payload = $second_project_connection instanceof WP_REST_Response
    ? $second_project_connection->get_data()
    : [];
$second_remote_config = json_decode((string) ($second_connection_payload['remoteConfig'] ?? ''), true);
$second_server = is_array($second_remote_config['mcpServers'] ?? null)
    ? reset($second_remote_config['mcpServers'])
    : [];
$second_bearer = (string) ($second_server['headers']['Authorization'] ?? '');
$second_project_token = str_starts_with($second_bearer, 'Bearer ') ? substr($second_bearer, 7) : '';
$second_connection_id = (string) ($second_connection_payload['connection']['id'] ?? '');
kodety_security_assert(
    $second_project_connection instanceof WP_REST_Response
        && preg_match('/^kodety_[a-f0-9]{48}$/D', $second_project_token)
        && preg_match('/^project-[a-f0-9]{16}$/D', $second_connection_id)
        && $second_connection_id !== $project_connection_id
        && count($kodety_test_options['kodety_mcp_project_connections'] ?? []) === 2,
    'copiar novamente deve criar conexão independente sem invalidar as anteriores'
);
$connections_response = $mcp->list_project_connections(new WP_REST_Request());
$connections_payload = $connections_response instanceof WP_REST_Response ? $connections_response->get_data() : [];
$listed_connections = (array) ($connections_payload['connections'] ?? []);
$listed_by_id = [];
foreach ($listed_connections as $listed_connection) {
    if (is_array($listed_connection)) $listed_by_id[(string) ($listed_connection['id'] ?? '')] = $listed_connection;
}
$listed_json = (string) json_encode($connections_payload);
kodety_security_assert(
    $connections_response instanceof WP_REST_Response
        && count($listed_connections) === 2
        && ($listed_by_id[$project_connection_id]['projectId'] ?? '') === 'workspace-cliente-a'
        && ($listed_by_id[$project_connection_id]['projectName'] ?? '') === 'Cliente A Workspace'
        && ($listed_by_id[$project_connection_id]['currentProject'] ?? false) === true
        && ($listed_by_id[$second_connection_id]['currentProject'] ?? false) === true
        && ($listed_by_id[$project_connection_id]['name'] ?? '') !== ''
        && !str_contains($listed_json, 'tokenHash')
        && !str_contains($listed_json, 'ownerId')
        && !str_contains($listed_json, $project_token)
        && !str_contains($listed_json, $second_project_token),
    'GET de conexões deve listar somente metadados seguros das duas credenciais independentes'
);
$project_authenticated = $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $project_token]));
kodety_security_assert(
    $project_authenticated === true
        && $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $second_project_token])) === true,
    'as duas credenciais vinculadas devem autenticar enquanto o workspace correto estiver aberto'
);
$kodety_test_options['kodety_agency_active_project'] = 'cliente-b';
kodety_security_assert(
    $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $project_token])) === true,
    'opções antigas de agência não podem substituir a identidade persistida do workspace'
);
$kodety_test_options['kodety_workspace_project_id'] = 'workspace-cliente-b';
$wrong_project = $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $project_token]));
kodety_security_assert(
    $wrong_project instanceof WP_Error
        && $wrong_project->get_error_code() === 'kodety_mcp_project_target_changed'
        && (($wrong_project->get_error_data()['status'] ?? 0) === 409),
    'trocar o workspace persistido deve bloquear uma credencial vinculada ao projeto anterior'
);
$kodety_test_options['kodety_workspace_project_id'] = 'workspace-cliente-a';
$kodety_test_options['kodety_agency_active_project'] = 'cliente-a';

$deleted_connection_response = $mcp->delete_project_connection(new WP_REST_Request(['id' => $project_connection_id]));
$deleted_connection_payload = $deleted_connection_response instanceof WP_REST_Response
    ? $deleted_connection_response->get_data()
    : [];
$revoked_authentication = $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $project_token]));
kodety_security_assert(
    $deleted_connection_response instanceof WP_REST_Response
        && ($deleted_connection_payload['deleted'] ?? '') === $project_connection_id
        && count((array) ($deleted_connection_payload['connections'] ?? [])) === 1
        && (($deleted_connection_payload['connections'][0]['id'] ?? '') === $second_connection_id)
        && count($kodety_test_options['kodety_mcp_project_connections'] ?? []) === 1
        && isset($kodety_test_options['kodety_mcp_project_connections'][$second_connection_id])
        && $revoked_authentication instanceof WP_Error
        && $revoked_authentication->get_error_code() === 'kodety_mcp_unauthorized'
        && $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $second_project_token])) === true,
    'DELETE individual deve revogar somente a conexão escolhida e preservar a irmã'
);

$legacy_connection_id = 'project-' . str_repeat('f', 16);
$legacy_token = 'kodety_' . bin2hex(random_bytes(24));
$kodety_test_options['kodety_mcp_project_connections'][$legacy_connection_id] = [
    'id' => $legacy_connection_id,
    'tokenHash' => hash('sha256', $legacy_token),
    'projectId' => 'single',
    'ownerId' => 7,
    'workspaceMode' => 'single',
    'projectName' => 'Cliente A Workspace',
    'projectSlug' => 'cliente-a-workspace',
    'createdAt' => '2026-07-22T12:00:00-03:00',
];
$legacy_status = $mcp->status();
$legacy_list_response = $mcp->list_project_connections(new WP_REST_Request());
$legacy_list_payload = $legacy_list_response instanceof WP_REST_Response ? $legacy_list_response->get_data() : [];
$legacy_list_json = (string) json_encode($legacy_list_payload);
$legacy_authentication = $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $legacy_token]));
kodety_security_assert(
    ($legacy_status['requiresRotation'] ?? false) === true
        && ($legacy_status['legacyConnectionCount'] ?? 0) === 1
        && count((array) ($legacy_list_payload['connections'] ?? [])) === 2
        && !str_contains($legacy_list_json, 'tokenHash')
        && !str_contains($legacy_list_json, 'ownerId')
        && !str_contains($legacy_list_json, $legacy_token)
        && $legacy_authentication instanceof WP_Error
        && $legacy_authentication->get_error_code() === 'kodety_mcp_project_connection_legacy'
        && (($legacy_authentication->get_error_data()['requiresRotation'] ?? false) === true)
        && (($kodety_test_options['kodety_mcp_project_connections'][$legacy_connection_id]['projectId'] ?? '') === 'single'),
    'conexão legada deve continuar listável/revogável, mas falhar fechada sem migrar autoridade ambígua'
);
$legacy_delete_response = $mcp->delete_project_connection(new WP_REST_Request(['id' => $legacy_connection_id]));
kodety_security_assert(
    $legacy_delete_response instanceof WP_REST_Response
        && !isset($kodety_test_options['kodety_mcp_project_connections'][$legacy_connection_id])
        && isset($kodety_test_options['kodety_mcp_project_connections'][$second_connection_id])
        && $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $second_project_token])) === true,
    'revogar conexão legada deve preservar a conexão de workspace válida'
);

$kodety_test_options['kodety_mcp_enabled'] = '1';
$kodety_test_options['kodety_mcp_token_hash'] = hash('sha256', $token);
$kodety_test_options['kodety_mcp_owner_id'] = 7;
$authenticated = $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $token]));
kodety_security_assert($authenticated === true && $kodety_test_current_user === 7, 'bearer válido deve assumir somente a conta administradora responsável');
$kodety_test_multisite = true;
$blocked = $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $token]));
kodety_security_assert($blocked instanceof WP_Error && $blocked->get_error_code() === 'kodety_mcp_multisite_unsupported', 'MCP deve ser bloqueado em multisite');
$kodety_test_multisite = false;

$kodety_test_browser_studio = true;
$studio_status = $mcp->status();
$studio_authentication = $mcp->authenticate(new WP_REST_Request([], ['Authorization' => 'Bearer ' . $token]));
$studio_project_connection = $mcp->create_project_connection(new WP_REST_Request());
$studio_project_payload = $studio_project_connection instanceof WP_REST_Response
    ? $studio_project_connection->get_data()
    : [];
$studio_remote_config = json_decode((string) ($studio_project_payload['remoteConfig'] ?? ''), true);
$studio_remote_url = is_array($studio_remote_config)
    ? (string) (array_values($studio_remote_config['mcpServers'] ?? [])[0]['url'] ?? '')
    : '';
kodety_security_assert(
    ($studio_status['browserStudio'] ?? false) === true
        && ($studio_status['available'] ?? false) === true
        && ($studio_status['enabled'] ?? false) === true
        && ($studio_status['remoteUrl'] ?? '') === 'https://studio.kodety.com/__kodety_mcp__/v1/projects/04cc2286-1383-46a5-8055-8dac70d9/mcp'
        && $studio_authentication === true
        && $studio_project_connection instanceof WP_REST_Response
        && $studio_project_connection->get_status() === 201
        && $studio_remote_url === 'https://studio.kodety.com/__kodety_mcp__/v1/projects/04cc2286-1383-46a5-8055-8dac70d9/mcp',
    'WordPress local no Studio deve anunciar e gerar a URL pública do relay sem enfraquecer a autenticação bearer do plugin'
);
$kodety_test_browser_studio = false;

$media_reflection = new ReflectionClass(Kodety_Media::class);
$media = $media_reflection->newInstanceWithoutConstructor();
$attachment = $kodety_test_uploads . '/2026/07/photo.jpg';
wp_mkdir_p(dirname($attachment));
file_put_contents($attachment, 'image');
$metadata_files = kodety_private($media, 'attachment_metadata_files', $attachment, [
    'file' => '2026/07/photo.jpg',
    'sizes' => [
        'thumbnail' => ['file' => 'photo-150x150.jpg'],
        'malicious' => ['file' => '../../outside.jpg'],
    ],
]);
kodety_security_assert(in_array(dirname($attachment) . '/photo-150x150.jpg', $metadata_files, true), 'rollback deve mapear miniaturas existentes');
kodety_security_assert(in_array(dirname($attachment) . '/outside.jpg', $metadata_files, true), 'nomes de metadados devem ser confinados à pasta do anexo');
kodety_security_assert(kodety_private($media, 'path_is_in_uploads', $attachment) === true, 'anexo dentro de uploads deve ser aceito');
kodety_security_assert(kodety_private($media, 'path_is_in_uploads', $outside) === true, 'outros arquivos dentro de uploads continuam confinados ao basedir');
kodety_security_assert(kodety_private($media, 'path_is_in_uploads', __FILE__) === false, 'arquivo fora de uploads deve ser rejeitado');
$media_backups = kodety_private($media, 'media_backup_directory');
kodety_security_assert(str_starts_with($media_backups, $kodety_test_uploads . '/kodety/private/'), 'backups transacionais de mídia devem ficar no armazenamento privado');

$plugin_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
$editor_shell_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/templates/editor-shell.php');
$settings_source = (string) file_get_contents(dirname(__DIR__, 2) . '/app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx');
$mcp_settings_source = (string) file_get_contents(dirname(__DIR__, 2) . '/app/(builder)/kodety/html-editor/components/HtmlMcpSettingsContent.tsx');
$uninstall_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/uninstall.php');
kodety_security_assert(
    str_contains($plugin_source, "add_action('admin_post_kodety_import_url', [\$this, 'admin_import_url'])"),
    'importação por URL deve registrar o handler administrativo que já valida capability e nonce'
);
kodety_security_assert(
    str_contains($plugin_source, "'permission_callback' => [\$this, 'can_import_from_url']")
        && str_contains($plugin_source, "return current_user_can('kodety_import');")
        && !str_contains($plugin_source, "'kodety_license_url_import_required'"),
    'importação por URL deve exigir a capability WordPress sem uma licença comercial'
);
kodety_security_assert(
    str_contains($editor_shell_source, "'membersUrl' => \$can_view_members ?")
        && str_contains($editor_shell_source, "'membersOverviewUrl' => \$can_view_members ?"),
    'shell não deve anunciar rotas de membros para perfis sem a capability correspondente'
);
kodety_security_assert(
    str_contains($editor_shell_source, "'aiSettingsUrl' => \$can_manage_integrations && Kodety_Edition::has('ai')")
        && str_contains($editor_shell_source, "'aiTestUrl' => \$can_manage_integrations && Kodety_Edition::has('ai')")
        && str_contains($editor_shell_source, "'canManageIntegrations' => \$can_manage_integrations"),
    'configuração e teste de IA devem ficar restritos a administradores também no shell'
);
kodety_security_assert(
    str_contains($editor_shell_source, "'mcpStatusUrl' => \$mcp_feature_active ? rest_url('kodety/v1/mcp/status') : ''")
        && str_contains($editor_shell_source, "home_url('/kodety/settings/?section=mcp') . '#integrations-mcp'")
        && str_contains($editor_shell_source, "'mcpAdminUrl' => \$can_manage_integrations && \$mcp_feature_active ? admin_url('admin.php?page=kodety#kodety-mcp')")
        && !str_contains($editor_shell_source, "'mcpStatusUrl' => add_query_arg("),
    'MCP licenciado deve usar a REST canônica e abrir a seção MCP das Settings antes de copiar a conexão'
);
kodety_security_assert(
    str_contains($settings_source, "!wordpress?.canManageIntegrations")
        && str_contains($mcp_settings_source, 'wordpress.canManageIntegrations ? (')
        && str_contains($mcp_settings_source, 'MCP do Studio conectado')
        && str_contains($mcp_settings_source, 'data-kodety-mcp-studio-relay')
        && str_contains($mcp_settings_source, 'Somente administradores podem ativar, renovar ou revogar a conexão MCP.'),
    'controles MCP não devem oferecer operações que a API recusará ao Designer ou ao Studio local'
);
kodety_security_assert(
    str_contains($uninstall_source, "wp_clear_scheduled_hook('kodety_meta_capi_retry')")
        && str_contains($uninstall_source, "'kodety_meta_capi_retry_queue'")
        && str_contains($uninstall_source, "'kodety_mcp_token_hash'")
        && str_contains($uninstall_source, "'kodety_mcp_owner_id'")
        && str_contains($uninstall_source, "'kodety_mcp_project_connections'")
        && str_contains($uninstall_source, "'kodety_mcp_activity'")
        && str_contains($uninstall_source, "'kodety_mcp_activity_events'")
        && str_contains($uninstall_source, 'kodety_email_submissions')
        && str_contains($uninstall_source, "'_kodety_membership_last_login_at'"),
    'desinstalação deve remover jobs, segredos e dados pessoais no purge explícito'
);

// Browser nonces and authenticated bearer requests are separate transports.
// Only the exact authenticated object may authorize delegated native requests.
$kodety_test_options['kodety_mcp_enabled'] = '1';
$kodety_test_caps['manage_options'] = true;
$kodety_test_multisite = false;
$trusted_token = 'kodety_' . str_repeat('b', 48);
$kodety_test_options['kodety_mcp_token_hash'] = hash('sha256', $trusted_token);
$kodety_test_options['kodety_mcp_owner_id'] = 7;
$trusted_request = new WP_REST_Request([], ['authorization' => 'bearer ' . $trusted_token]);
kodety_security_assert($mcp->authenticate($trusted_request) === true && $mcp->is_authenticated_native_context($trusted_request), 'authenticated native context must accept the exact bearer request');
kodety_security_assert(!$mcp->is_authenticated_native_context(new WP_REST_Request([], ['authorization' => 'bearer ' . $trusted_token])), 'copied headers must not grant native authentication');
$kodety_test_current_user = 8;
kodety_security_assert(!$mcp->is_authenticated_native_context($trusted_request), 'native authentication must not switch identities');
$kodety_test_current_user = 7;
$kodety_test_options['kodety_mcp_token_hash'] = hash('sha256', 'revoked');
kodety_security_assert(!$mcp->is_authenticated_native_context($trusted_request), 'revocation must invalidate delegated native authentication');
$kodety_test_options['kodety_mcp_token_hash'] = hash('sha256', $trusted_token);
$mcp->authenticate(new WP_REST_Request([], ['authorization' => 'Bearer invalid']));
kodety_security_assert(!$mcp->is_authenticated_native_context($trusted_request), 'a failed authentication must clear prior native authority');

// Stale writes must leave the draft and revision untouched, including deletes.
$kodety_test_caps['edit_theme_options'] = true;
$kodety_test_options['kodety_workspace_revision'] = 100;
$revision_file = kodety_private($mcp, 'tool_write_file', ['path' => 'native-revision.css', 'content' => '.a{color:red}', 'baseRevision' => 100]);
$revision_before = (int) get_option('kodety_workspace_revision');
foreach (['tool_write_file', 'tool_replace_in_file', 'tool_delete_file'] as $method) {
    $failed = false;
    try {
        kodety_private($mcp, $method, ['path' => 'native-revision.css', 'content' => 'lost', 'search' => 'red', 'replacement' => 'blue', 'baseRevision' => 99]);
    } catch (RuntimeException $error) { $failed = $error->getCode() === 409; }
    kodety_security_assert($failed, $method . ' must reject a stale workspace revision');
    $read = kodety_private($mcp, 'tool_read_file', ['path' => 'native-revision.css']);
    kodety_security_assert($read['content'] === '.a{color:red}' && $read['workspaceRevision'] === $revision_before, 'rejected writes must preserve exact bytes and revision');
}
$tool_contracts = kodety_private($mcp, 'remote_tools');
foreach ($tool_contracts as $definition) {
    if (in_array($definition['name'], ['kodety_get_site', 'kodety_get_settings', 'kodety_list_collections', 'kodety_get_ai_status', 'kodety_publish'], true)) continue;
    kodety_security_assert(count((array) $definition['inputSchema']['properties']) > 0, $definition['name'] . ' must describe its parameters');
}
$native_request = new WP_REST_Request(['jsonrpc' => '2.0', 'id' => 99, 'method' => 'tools/call', 'params' => [
    'name' => 'kodety_native_call', 'arguments' => ['operation' => 'cms_import_items', 'arguments' => ['post_type' => 'post', 'expectedRevision' => 'r1', 'items' => [['title' => 'Draft']]]],
]], ['x-kodety-editor-session' => 'native-editor']);
$native_result = $mcp->execute_remote_protocol($native_request)->get_data()['result'];
$last_native_call = Kodety_Native_Operations::$calls[array_key_last(Kodety_Native_Operations::$calls)];
kodety_security_assert($native_result['isError'] === false && $native_result['structuredContent']['result']['revision'] === 'native-revision', 'MCP must preserve native ACK data');
kodety_security_assert($last_native_call[0] === 'cms_import_items' && $last_native_call[1]['expectedRevision'] === 'r1' && $last_native_call[2] === $native_request, 'MCP must forward exact arguments and authenticated context');
kodety_security_assert(kodety_private($mcp, 'tool_native_catalog', ['area' => 'cms'])['operations'][0]['name'] === 'cms_schema', 'MCP catalog must return shared native schemas');
Kodety_Native_Operations::$next = new WP_Error('kodety_cms_conflict', 'Read latest revision.', ['status' => 409, 'revision' => 'r2']);
$native_failure = $mcp->execute_remote_protocol($native_request)->get_data()['result'];
kodety_security_assert($native_failure['isError'] === true && $native_failure['structuredContent']['error']['code'] === 'kodety_cms_conflict' && $native_failure['structuredContent']['error']['data']['revision'] === 'r2', 'MCP must expose recoverable native errors without turning failure into success');
$rest_native_request = new WP_REST_Request(['tool' => 'native_call', 'arguments' => ['operation' => 'cms_schema', 'arguments' => []]]);
$rest_native_error = $mcp->execute_tool($rest_native_request);
kodety_security_assert($rest_native_error === Kodety_Native_Operations::$next, 'REST MCP must preserve native WP_Error including status');
Kodety_Native_Operations::$next = null;
kodety_private($mcp, 'dispatch_tool', 'list_content', ['postType' => 'post', 'limit' => 12, 'page' => 2]);
$legacy_native_call = Kodety_Native_Operations::$calls[array_key_last(Kodety_Native_Operations::$calls)];
kodety_security_assert($legacy_native_call[0] === 'cms_list_items' && $legacy_native_call[1]['per_page'] === 12 && $legacy_native_call[1]['page'] === 2, 'legacy content tools must use native CMS pagination and scope');
kodety_security_assert($legacy_native_call[2] === null, 'request context must not leak into the next operation');

kodety_remove_test_tree($kodety_test_uploads);
fwrite(STDOUT, "Admin security: IA, MCP draft-only, multisite, paths and media rollback boundaries verified.\n");
