<?php

declare(strict_types=1);

// Isolated control-plane contracts: all HTTP is mocked and fixture credentials
// are synthetic. No real WordPress options, gateway or OpenAI account is read.
define('ABSPATH', '/kodety-remote-test/no-wordpress/');
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_FILE', KODETY_DIR . 'kodety.php');
define('KODETY_AGENT_DATA_DIR', '/dev/null/must-not-create-a-runtime');
define('KODETY_AGENT_AUTOSTART', false);
$browser_runtime_scenario = ($argv[1] ?? '') === 'browser';
$transport_option_scenario = in_array($argv[1] ?? '', ['option', 'browser'], true);
if ($browser_runtime_scenario) define('KODETY_BROWSER_STUDIO_RUNTIME', 'live-studio-fixture');
if (!$transport_option_scenario) define('KODETY_AGENT_GATEWAY_URL', $argv[1] ?? 'https://agent.example.test/');

$options = [
    'kodety_workspace_project_id' => 'project-one',
    'kodety_project_name' => 'Project One',
    'kodety_license_installation' => ['id' => 'installation-fixture', 'site' => hash('sha256', 'https://example.test')],
    'kodety_license_state' => ['activation_id' => 'activation-fixture', 'activation_token' => 'private-activation-fixture'],
];
$routes = [];
$logged_in = true;
$capable = true;
$manage_options = true;
$http_calls = [];
$http_result = null;

class WP_REST_Server {
    public const READABLE = 'GET';
    public const CREATABLE = 'POST';
    public const DELETABLE = 'DELETE';
}
class WP_Error {
    public function __construct(private string $code, private string $message, private array $data = []) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): array { return $this->data; }
}
class WP_REST_Request {
    public function __construct(private array $json = [], private string $nonce = 'valid-rest-nonce') {}
    public function get_header(string $name): string { return strtolower($name) === 'x-wp-nonce' ? $this->nonce : ''; }
    public function get_body(): string { return (string) json_encode($this->json); }
    public function get_json_params(): array { return $this->json; }
}
class WP_REST_Response {
    public array $headers = [];
    public function __construct(private mixed $data = null) {}
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_data(): mixed { return $this->data; }
}
class Kodety_Edition {
    public static bool $licensed = true;
    public static function has(string $feature): bool { return self::$licensed && $feature === 'ai'; }
    public static function license_url(): string { return 'https://example.test/license'; }
    public static function upgrade_url(): string { return 'https://example.test/pro'; }
}
class Kodety_Plugin {
    public const CAP_EDIT_WORKSPACE = 'kodety_edit';
    public const CAP_USE_AI = 'kodety_use_ai';
}
function add_action(string $name, callable $callback, int $priority = 10, int $accepted_args = 1): void {}
function add_filter(string $name, callable $callback, int $priority = 10, int $accepted_args = 1): void {}
function apply_filters(string $name, mixed $value, mixed ...$args): mixed { return $value; }
function plugin_basename(string $value): string { return basename($value); }
function register_rest_route(string $namespace, string $path, array $definition): void { $GLOBALS['routes'][$namespace . $path] = $definition; }
function is_user_logged_in(): bool { return $GLOBALS['logged_in']; }
function current_user_can(string $capability): bool { return $GLOBALS['capable'] && ($capability !== 'manage_options' || $GLOBALS['manage_options']); }
function get_current_user_id(): int { return $GLOBALS['logged_in'] ? 37 : 0; }
function get_option(string $name, mixed $default = false): mixed { return $GLOBALS['options'][$name] ?? $default; }
function update_option(string $name, mixed $value, bool $autoload = true): bool { $GLOBALS['options'][$name] = $value; return true; }
function delete_option(string $name): bool { unset($GLOBALS['options'][$name]); return true; }
function delete_transient(string $name): bool { return true; }
function get_user_meta(int $user, string $key, bool $single = false): mixed { return ''; }
function home_url(string $path = ''): string { return 'https://example.test' . $path; }
function untrailingslashit(string $value): string { return rtrim($value, '/\\'); }
function wp_parse_url(string $url): array|false { return parse_url($url); }
function sanitize_key(string $value): string { return strtolower(preg_replace('/[^a-z0-9_-]/', '', $value) ?: ''); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function wp_verify_nonce(string $value, string $action): int|false { return $value === 'valid-rest-nonce' && $action === 'wp_rest' ? 1 : false; }
function wp_generate_uuid4(): string { return 'new-installation-fixture'; }
function wp_safe_remote_post(string $url, array $args): array|WP_Error {
    $GLOBALS['http_calls'][] = ['url' => $url, 'args' => $args];
    return $GLOBALS['http_result'] ?? new WP_Error('network', 'not configured');
}
function wp_remote_retrieve_response_code(array $response): int { return (int) ($response['response']['code'] ?? 0); }
function wp_remote_retrieve_body(array $response): string { return (string) ($response['body'] ?? ''); }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function check(bool $condition, string $message): void {
    if (!$condition) { fwrite(STDERR, "FAIL: {$message}\n"); exit(1); }
}
function fixture_session(array $override = []): array {
    $expires = time() + 300;
    $encode = static fn(mixed $value): string => rtrim(strtr(base64_encode((string) json_encode($value)), '+/', '-_'), '=');
    $token = $encode(['alg' => 'EdDSA', 'typ' => 'JWT']) . '.' . $encode(['exp' => $expires, 'sub' => 'fixture-user']) . '.' . str_repeat('A', 86);
    return array_merge(['gatewayUrl' => 'https://agent.example.test', 'token' => $token, 'expiresAt' => $expires, 'transport' => 'remote'], $override);
}
function backend_response(array $payload, int $status = 200): void {
    $GLOBALS['http_result'] = ['response' => ['code' => $status], 'body' => json_encode($payload)];
}

$source = getenv('KODETY_AGENT_TEST_SOURCE_DIR') ?: dirname(__DIR__) . '/kodety/includes';
require $source . '/class-kodety-agents.php';
require $source . '/class-kodety-license.php';
$agents = Kodety_Agents::instance();
$agents->register_routes();
$config = $agents->config()->get_data();
check($config['transport'] === 'local', 'legacy gateway constants must not reactivate Cloud');
check($config['transportOptions'] === ['canChange' => false, 'selected' => 'local', 'browserLabel' => 'No navegador'], 'browser selection belongs to the client, not site-wide Cloud transport');
check(!isset($config['remote']), 'config must not advertise a Cloud session path');
check(str_contains($agents->config()->headers['Cache-Control'], 'no-store'), 'config must never be cached');
check($agents->retry_config()->get_data()['transport'] === 'local', 'failed host retries must not enable Cloud');
foreach (['remote', 'local', '', 'unknown', false, ['remote']] as $saved) {
    $options['kodety_agent_transport'] = $saved;
    check($agents->config()->get_data()['transport'] === 'local', 'legacy and malformed saved choices must not enable Cloud');
}
unset($options['kodety_agent_transport']);
$before = count($http_calls);
foreach (['login', 'capability', 'license', 'nonce'] as $denial) {
    $logged_in = $denial !== 'login';
    $capable = $denial !== 'capability';
    Kodety_Edition::$licensed = $denial !== 'license';
    $result = $agents->remote_session(new WP_REST_Request([], $denial === 'nonce' ? '' : 'valid-rest-nonce'));
    check($result instanceof WP_Error, 'old session endpoint must still enforce ' . $denial);
}
$logged_in = $capable = Kodety_Edition::$licensed = true;
$result = $agents->remote_session(new WP_REST_Request(['gatewayUrl' => 'https://attacker.test']));
check($result instanceof WP_Error && $result->get_error_code() === 'kodety_agents_remote_disabled' && $result->get_error_data()['status'] === 410, 'authorized legacy clients receive an explicit retired endpoint response');
check(count($http_calls) === $before, 'no legacy setting or authorization result may exchange a Cloud session');
foreach ([[], ['transport' => 'remote'], ['transport' => 'browser'], ['transport' => ['remote']], ['transport' => 'local', 'gatewayUrl' => 'https://attacker.test']] as $body) {
    check($agents->set_transport(new WP_REST_Request($body)) instanceof WP_Error, 'reject removed transports and unexpected URLs');
}
check(!isset($options['kodety_agent_transport']), 'rejected changes must not mutate preferences');
$manage_options = false;
check($agents->set_transport(new WP_REST_Request(['transport' => 'local'])) instanceof WP_Error, 'only administrators may migrate the legacy site preference');
$manage_options = true;
check($agents->set_transport(new WP_REST_Request(['transport' => 'local'], '')) instanceof WP_Error, 'migration requires a valid REST nonce');
$local = $agents->set_transport(new WP_REST_Request(['transport' => 'local']));
check($local instanceof WP_REST_Response && $options['kodety_agent_transport'] === 'local', 'authorized migration can clear an old Cloud preference');
$options['kodety_browser_runtime'] = ['enabled' => true, 'kind' => 'studio', 'projectId' => 'database-only-marker'];
check($agents->config()->get_data()['unavailableReason'] === ($browser_runtime_scenario ? 'browser_runtime_unsupported' : 'invalid_server_configuration'), 'only a live PHP-WASM marker identifies browser hosting');
if ($browser_runtime_scenario) {
    foreach (['rpc', 'events', 'respond', 'upload_attachment', 'delete_attachment', 'install_skill', 'delete_skill'] as $method) {
        $blocked = $agents->$method(new WP_REST_Request());
        check($blocked instanceof WP_Error && $blocked->get_error_data()['runtimeDiagnostics']['code'] === 'browser_runtime_unsupported', 'native PHP endpoints must fail before probing a browser filesystem: ' . $method);
    }
    Kodety_Agents::activate();
    $agents->handle_runtime_upgrade();
    $agents->handle_upgrader_complete(null, ['type' => 'plugin', 'action' => 'update']);
    check(!isset($options['kodety_agent_runtime_version']), 'PHP-WASM lifecycle must not install a native executable');
    Kodety_Edition::$licensed = false;
    check($agents->config()->get_data()['unavailableReason'] === 'license_required', 'hosting limitations must not hide the license gate');
}
check($http_calls === [], 'Cloud retirement and PHP-WASM must not contact a gateway');
echo "WordPress retired Cloud migration contracts passed.\n";
