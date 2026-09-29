<?php

declare(strict_types=1);

$fake_wordpress_root = rtrim(sys_get_temp_dir(), '/\\') . '/kodety-agent-fake-wordpress-' . getmypid() . '/';
define('ABSPATH', $fake_wordpress_root);
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_AGENT_AUTOSTART', false);

$routes = [];
// These contracts exercise local execution on the customer hosting account.
$options = ['kodety_agent_transport' => 'local', 'kodety_workspace_project_id' => 'project-one', 'kodety_project_name' => 'Project One'];
$user_meta = [];
$transients = [];
$runtime_downloads = [];
$runtime_http_requests = [];
$runtime_bridge_requests = [];
$runtime_bridge_responder = null;
$runtime_filters = [];

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
    public function __construct(private array $json = [], private array $files = []) {}
    public function get_body(): string { return (string) json_encode($this->json); }
    public function get_json_params(): array { return $this->json; }
    public function get_file_params(): array { return $this->files; }
}

class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null) {}
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_data(): mixed { return $this->data; }
    public function set_data(mixed $data): void { $this->data = $data; }
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
function add_filter(string $name, callable $callback, int $priority = 10, int $accepted_args = 1): void {
    $GLOBALS['runtime_filters'][$name] = $callback;
}
function register_rest_route(string $namespace, string $path, array $definition): void {
    global $routes;
    $routes[$namespace . $path] = $definition;
}
function is_user_logged_in(): bool { return true; }
function current_user_can(string $capability): bool {
    return in_array($capability, ['kodety_edit', 'kodety_use_ai'], true);
}
function get_current_user_id(): int { return 37; }
function get_current_blog_id(): int { return 1; }
function get_option(string $name, mixed $default = false): mixed {
    global $options;
    return $options[$name] ?? $default;
}
function add_option(string $name, mixed $value, string $deprecated = '', bool $autoload = true): bool {
    global $options;
    if (array_key_exists($name, $options)) return false;
    $options[$name] = $value;
    return true;
}
function update_option(string $name, mixed $value, bool $autoload = true): bool {
    global $options;
    $options[$name] = $value;
    return true;
}
function delete_option(string $name): bool {
    global $options;
    unset($options[$name]);
    return true;
}
function get_user_meta(int $user, string $key, bool $single = false): mixed {
    global $user_meta;
    return $user_meta[$user][$key] ?? '';
}
function update_user_meta(int $user, string $key, mixed $value): bool {
    global $user_meta;
    $user_meta[$user][$key] = $value;
    return true;
}
function get_transient(string $name): mixed {
    global $transients;
    return $transients[$name] ?? false;
}
function set_transient(string $name, mixed $value, int $ttl): bool {
    global $transients;
    $transients[$name] = $value;
    return true;
}
function delete_transient(string $name): bool {
    global $transients;
    unset($transients[$name]);
    return true;
}
function home_url(string $path = ''): string { return 'https://example.test' . $path; }
function wp_get_upload_dir(): array { return ['basedir' => ABSPATH . 'uploads', 'error' => false]; }
function wp_mkdir_p(string $path): bool { return is_dir($path) || mkdir($path, 0777, true); }
function untrailingslashit(string $value): string { return rtrim($value, '/\\'); }
function wp_parse_url(string $url): array|false { return parse_url($url); }
function apply_filters(string $name, mixed $value, mixed ...$args): mixed {
    global $runtime_filters;
    return isset($runtime_filters[$name]) ? $runtime_filters[$name]($value, ...$args) : $value;
}
function sanitize_key(string $value): string { return strtolower(preg_replace('/[^a-z0-9_-]/', '', $value) ?: ''); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function wp_remote_request(string $url, array $args): array|WP_Error {
    global $runtime_bridge_requests, $runtime_bridge_responder;
    $runtime_bridge_requests[] = ['url' => $url, 'args' => $args];
    return is_callable($runtime_bridge_responder)
        ? $runtime_bridge_responder($url, $args)
        : new WP_Error('connection', 'offline');
}
function wp_remote_get(string $url, array $args): array|WP_Error {
    global $runtime_downloads, $runtime_http_requests;
    $runtime_http_requests[] = ['url' => $url, 'args' => $args];
    $source = $runtime_downloads[$url] ?? '';
    if ($source instanceof WP_Error) return $source;
    if (is_callable($source)) return $source($args);
    return runtime_fixture_response($source, $args);
}
function runtime_fixture_response(string $source, array $args, bool $honor_range = true): array|WP_Error {
    $destination = is_string($args['filename'] ?? null) ? $args['filename'] : '';
    if (!is_file($source) || $destination === '') {
        return new WP_Error('download', 'offline');
    }
    $total = filesize($source);
    $start = 0;
    $end = $total - 1;
    $status = 200;
    if ($honor_range && preg_match('/^bytes=(\d+)-(\d+)$/', $args['headers']['Range'] ?? '', $match)) {
        $start = (int) $match[1];
        $end = min((int) $match[2], $end);
        $status = 206;
    }
    $input = fopen($source, 'rb');
    $output = fopen($destination, 'wb');
    fseek($input, $start);
    stream_copy_to_stream($input, $output, min($end - $start + 1, $args['limit_response_size'] ?? PHP_INT_MAX));
    fclose($input);
    fclose($output);
    return [
        'response' => ['code' => $status],
        'headers' => [
            'content-range' => $status === 206 ? "bytes {$start}-{$end}/{$total}" : '',
            'content-length' => (string) ($end - $start + 1),
        ],
        'body' => '',
    ];
}
function wp_remote_retrieve_response_code(array $response): int { return (int) ($response['response']['code'] ?? 0); }
function wp_remote_retrieve_body(array $response): string { return (string) ($response['body'] ?? ''); }
function wp_remote_retrieve_header(array $response, string $name): string { return (string) ($response['headers'][$name] ?? ''); }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }

function check(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function remove_test_tree(string $path): void {
    if (!is_dir($path)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    }
    rmdir($path);
}

require KODETY_DIR . 'includes/class-kodety-agents.php';
$agents = Kodety_Agents::instance();
$agents->register_routes();
check(isset($routes['kodety/v1/agents/config'][0], $routes['kodety/v1/agents/config'][1]), 'config must expose GET and POST');
check(isset($routes['kodety/v1/agents/config/retry']), 'config/retry must expose explicit sidecar recovery');
check(isset($routes['kodety/v1/agents/attachments'][0], $routes['kodety/v1/agents/attachments'][1]), 'attachments must expose POST and DELETE');
check(
    $routes['kodety/v1/agents/attachments'][0]['callback'] === [$agents, 'upload_attachment'],
    'attachment POST must use the private upload callback'
);
check(
    $routes['kodety/v1/agents/attachments'][1]['callback'] === [$agents, 'delete_attachment'],
    'attachment DELETE must use the private deletion callback'
);
check(
    $routes['kodety/v1/agents/config/retry']['methods'] === WP_REST_Server::CREATABLE,
    'config/retry must require POST'
);
check(
    $routes['kodety/v1/agents/config/retry']['callback'] === [$agents, 'retry_config'],
    'config/retry must use the backoff-clearing callback'
);
check($agents->can_manage_skills() === true, 'a licensed editor must manage its own skills');

unset($options['kodety_agent_transport']);
$default_config = $agents->config()->get_data();
check($default_config['transport'] === 'local' && $default_config['transportOptions']['selected'] === 'local', 'an unsaved installation must select local execution');
$provision_error_property = new ReflectionProperty($agents, 'runtime_provision_error');
foreach (['exec_unavailable', 'runtime_platform', 'node_missing', 'codex_missing', 'node_execution_denied', 'codex_system_incompatible', 'runtime_noexec', 'runtime_disk', 'runtime_install_busy', 'runtime_download_dns', 'runtime_download_timeout', 'codex_starting', 'bridge_secret_mismatch'] as $failure) {
    $provision_error_property->setValue($agents, new WP_Error('kodety_agents_' . $failure, 'synthetic hosting failure', ['status' => 503]));
    $failed_local = $agents->config()->get_data();
    check($failed_local['transport'] === 'local' && !$failed_local['available'] && !isset($options['kodety_agent_transport']), 'local failures and preparation must never enable or persist Cloud automatically: ' . $failure);
    check(!isset($failed_local['remote']), 'a failed local configuration must not advertise a Cloud session before user choice');
}
$options['kodety_agent_transport'] = 'local';
check($default_config['enabledSkills'] === ['kodety-editor'], 'only Kodety Editor must be selected by default');
foreach ([
    ['kodety-editor', 'kodety-widgets'],
    ['kodety-editor', 'figma:figma-design-to-code', 'kodety-widgets'],
] as $legacy_defaults) {
    $user_meta[37]['kodety_agent_preferences'] = ['enabledSkills' => $legacy_defaults];
    check(
        $agents->config()->get_data()['enabledSkills'] === ['kodety-editor'],
        'legacy automatic selections must migrate to Editor only'
    );
}
$custom_skills = ['kodety-editor', 'kodety-widgets', 'kodety-motion'];
$user_meta[37]['kodety_agent_preferences'] = ['enabledSkills' => $custom_skills];
check($agents->config()->get_data()['enabledSkills'] === $custom_skills, 'migration must preserve customized selections');
$user_meta[37]['kodety_agent_preferences'] = [];
check($agents->config()->get_data()['defaultModel'] === 'gpt-5.6-sol', 'new accounts must default to Sol');
$astra_saved = $agents->save_config(new WP_REST_Request(['model' => 'gpt-6-astra']));
check($astra_saved instanceof WP_REST_Response, 'Astra must be accepted by the WordPress model policy');
check($agents->config()->get_data()['defaultModel'] === 'gpt-6-astra', 'explicit Astra selection must survive reload');
$widgets_saved = $agents->save_config(new WP_REST_Request([
    'enabledSkills' => ['kodety-editor', 'kodety-widgets'],
]));
check($widgets_saved instanceof WP_REST_Response, 'Widgets can still be selected explicitly');
check(
    $agents->config()->get_data()['enabledSkills'] === ['kodety-editor', 'kodety-widgets'],
    'explicit Widgets selection must survive reload even when it matches a legacy default'
);
$agents->save_config(new WP_REST_Request(['enabledSkills' => ['kodety-editor']]));
check($agents->config()->get_data()['enabledSkills'] === ['kodety-editor'], 'deselected Widgets must not be forced back on');

$saved = $agents->save_config(new WP_REST_Request([
    'model' => 'gpt-5.5',
    'effort' => 'high',
    'enabledSkills' => ['figma:figma-design-to-code'],
]));
check($saved instanceof WP_REST_Response, 'valid preferences must be persisted');
$invalid_model = $agents->save_config(new WP_REST_Request([
    'model' => 'gpt-5.3-codex',
]));
check(
    $invalid_model instanceof WP_Error && $invalid_model->get_error_code() === 'kodety_agents_model_invalid',
    'Agent preferences must reject every model outside Astra, Sol, Terra, Luna, and GPT-5.5'
);
$config = $agents->config()->get_data();
check($config['defaultModel'] === 'gpt-5.5', 'config must return the persisted GPT-5.5 model');
check($config['defaultEffort'] === 'high', 'config must return the persisted effort');
check(
    $config['enabledSkills'] === ['kodety-editor', 'figma:figma-design-to-code'],
    'Figma must be retained when chosen without automatically enabling Widgets'
);
check($config['retryPath'] === 'config/retry', 'config must tell the UI where to retry the runtime');
check($config['attachmentUpload']['format'] === 'multipart', 'attachments must use multipart instead of base64 JSON');
check($config['attachmentUpload']['maxFilesPerTurn'] === 6, 'attachment turn count must remain bounded');
check(in_array('.docx', $config['attachmentUpload']['accept'], true), 'DOCX must be advertised as an accepted attachment');
check($config['unavailableReason'] === 'manual_start_required', 'disabled autostart must not collapse into sidecar_unavailable');
check(
    $config['runtimeDiagnostics']['retryable'] === false,
    'a UI retry cannot override a host-level autostart policy'
);
$transients['kodety_agent_bridge_start_backoff'] = 'failed';
$retried = $agents->retry_config()->get_data();
check(
    !isset($transients['kodety_agent_bridge_start_backoff']),
    'config/retry must clear the bridge start backoff before probing again'
);
check($retried['unavailableReason'] === 'manual_start_required', 'config/retry must preserve the host autostart policy');
$diagnostics_method = new ReflectionMethod($agents, 'public_runtime_diagnostics');
$diagnostics_method->setAccessible(true);
$missing_codex = $diagnostics_method->invoke(
    $agents,
    new WP_Error('kodety_agents_codex_missing', 'private path omitted', ['status' => 503])
);
check($missing_codex['code'] === 'codex_missing', 'missing Codex must have an actionable public reason');
check(!str_contains($missing_codex['message'], '/'), 'runtime diagnostics must not expose private filesystem paths');
check($missing_codex['action'] !== '', 'runtime diagnostics must tell the user what to check next');
foreach (['exec_unavailable', 'runtime_download_timeout', 'runtime_download_dns', 'runtime_download_tls', 'runtime_range_unsupported', 'runtime_lock_unavailable'] as $reason) {
    $diagnostic = $diagnostics_method->invoke($agents, new WP_Error('kodety_agents_' . $reason, '/private/secret token=hidden'));
    check($diagnostic['code'] !== 'sidecar_unavailable', 'known hosting errors must remain distinct');
    check(!str_contains(json_encode($diagnostic), 'hidden') && !str_contains(json_encode($diagnostic), '/private'), 'public errors must not leak transport details');
}

$desktop_node_method = new ReflectionMethod($agents, 'desktop_node_candidates');
$desktop_node_method->setAccessible(true);
$desktop_node_candidates = $desktop_node_method->invoke($agents);
check(
    in_array('/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node', $desktop_node_candidates, true),
    'the runtime must discover the Node.js executable bundled with the ChatGPT desktop app'
);
check(
    in_array('/Applications/Codex.app/Contents/Resources/cua_node/bin/node', $desktop_node_candidates, true),
    'the runtime must discover the Node.js executable bundled with the Codex desktop app'
);
$resolve_executable_method = new ReflectionMethod($agents, 'resolve_runtime_executable');
$resolve_executable_method->setAccessible(true);
$resolved_test_node = $resolve_executable_method->invoke($agents, 'node');
check(
    is_string($resolved_test_node) && $resolved_test_node !== '',
    'the runtime must resolve the Node.js executable used by the contract runner'
);

$runtime_root_method = new ReflectionMethod($agents, 'runtime_root');
$runtime_root_method->setAccessible(true);
$root = $runtime_root_method->invoke($agents);
check(!str_starts_with($root, ABSPATH), 'the runtime must stay outside the WordPress webroot');
check((fileperms($root) & 0777) === 0700, 'the runtime root must be mode 0700');

$runtime_context_method = new ReflectionMethod($agents, 'runtime_context');
$runtime_context_method->setAccessible(true);
$attachment_root_method = new ReflectionMethod($agents, 'attachment_root');
$attachment_root_method->setAccessible(true);
$attachment_root = $attachment_root_method->invoke($agents, $runtime_context_method->invoke($agents));
check(is_dir($attachment_root), 'the private project attachment directory must be created');
check((fileperms($attachment_root) & 0777) === 0700, 'the attachment directory must be mode 0700');
check(!str_starts_with($attachment_root, ABSPATH), 'attachments must stay outside the WordPress webroot');

$attachment_validate_method = new ReflectionMethod($agents, 'validate_attachment_upload');
$attachment_validate_method->setAccessible(true);
$text_fixture = $attachment_root . '/fixture-upload.txt';
file_put_contents($text_fixture, "Kodety attachment contract\n");
$validated_text = $attachment_validate_method->invoke($agents, [
    'error' => UPLOAD_ERR_OK,
    'tmp_name' => $text_fixture,
    'name' => 'brief.txt',
    'size' => filesize($text_fixture),
]);
check(is_array($validated_text) && $validated_text['kind'] === 'text', 'a real TXT attachment must pass content validation');
$binary_text_fixture = $attachment_root . '/fixture-binary.txt';
file_put_contents($binary_text_fixture, "text\0binary");
$invalid_text = $attachment_validate_method->invoke($agents, [
    'error' => UPLOAD_ERR_OK,
    'tmp_name' => $binary_text_fixture,
    'name' => 'binary.txt',
    'size' => filesize($binary_text_fixture),
]);
check($invalid_text instanceof WP_Error, 'a renamed binary file must not pass as TXT');

$delete_id = str_repeat('a', 32);
$delete_file = $attachment_root . '/' . $delete_id . '.txt';
$delete_meta = $attachment_root . '/' . $delete_id . '.json';
file_put_contents($delete_file, 'delete me');
file_put_contents($delete_meta, json_encode([
    'id' => $delete_id,
    'extension' => 'txt',
]));
$deleted_attachment = $agents->delete_attachment(new WP_REST_Request(['attachmentId' => $delete_id]));
check($deleted_attachment instanceof WP_REST_Response, 'attachment deletion must be idempotent');
check(!is_file($delete_file) && !is_file($delete_meta), 'attachment deletion must remove data and metadata');

$bridge_url_method = new ReflectionMethod($agents, 'default_bridge_url');
$bridge_url_method->setAccessible(true);
$default_bridge_url = $bridge_url_method->invoke($agents);
$expected_port = 41000 + (hexdec(substr(hash('sha256', home_url('/') . '|' . ABSPATH . '|' . get_current_blog_id()), 0, 4)) % 20000);
check($default_bridge_url === 'http://127.0.0.1:' . $expected_port, 'the default port must be stable per installation');

$document_probe = rtrim(sys_get_temp_dir(), '/\\') . '/kodety-agent-document-root-' . getmypid();
@mkdir($document_probe . '/private-agent-data', 0700, true);
$previous_document_root = $_SERVER['DOCUMENT_ROOT'] ?? null;
$_SERVER['DOCUMENT_ROOT'] = $document_probe;
$assert_location = new ReflectionMethod($agents, 'assert_runtime_root_location');
$assert_location->setAccessible(true);
$document_rejected = false;
try {
    $assert_location->invoke($agents, (string) realpath($document_probe . '/private-agent-data'));
} catch (RuntimeException) {
    $document_rejected = true;
}
if ($previous_document_root === null) unset($_SERVER['DOCUMENT_ROOT']);
else $_SERVER['DOCUMENT_ROOT'] = $previous_document_root;
remove_test_tree($document_probe);
check($document_rejected, 'a data directory below DOCUMENT_ROOT must be rejected');

$secret_method = new ReflectionMethod($agents, 'bridge_secret');
$secret_method->setAccessible(true);
$secret = $secret_method->invoke($agents);
check(strlen($secret) >= 32, 'the bridge secret must have sufficient entropy');
check((fileperms($root . '/bridge.secret') & 0777) === 0600, 'the bridge secret must be mode 0600');

$ready_response = ['ok' => false, 'version' => '1.0.4', 'state' => 'starting'];
$runtime_bridge_requests = [];
$runtime_bridge_responder = static function (string $url, array $args) use (&$ready_response): array {
    $body = str_ends_with($url, '/health') ? ['ok' => true, 'version' => '1.0.4'] : $ready_response;
    return ['response' => ['code' => 200], 'body' => json_encode($body)];
};
$starting_config = $agents->config()->get_data();
check($starting_config['available'] === false && $starting_config['unavailableReason'] === 'runtime_starting', 'a healthy Node bridge alone must not enable login');
check($starting_config['runtimeInstallation']['phase'] === 'start_codex', 'native initialization must show its own progress stage');
$native_request = end($runtime_bridge_requests);
$native_body = json_decode($native_request['args']['body'], true);
check(str_ends_with($native_request['url'], '/ready') && $native_request['args']['timeout'] === 2, 'readiness must use a short non-blocking bridge request');
check($native_body['userId'] === '37' && $native_body['runtime']['cwd'] === $runtime_context_method->invoke($agents)['cwd'], 'readiness must initialize the same isolated runtime used by RPC');
check($native_body['retry'] === false, 'ordinary config polling must not force native process replacement');
foreach (['codex_exec_failed', 'codex_permission_profile', 'codex_start_failed'] as $failure_code) {
    $ready_response = ['ok' => false, 'version' => '1.0.4', 'state' => 'failed', 'code' => $failure_code, 'error' => '/private/key token=hidden'];
    $failed_config = $agents->config()->get_data();
    check($failed_config['available'] === false && $failed_config['unavailableReason'] === $failure_code, 'native startup failures must have distinct public diagnostics');
    check(!str_contains(json_encode($failed_config), 'hidden') && !str_contains(json_encode($failed_config), $root), 'native diagnostics must not expose private process details');
}
$ready_response = ['ok' => false, 'version' => '1.0.4', 'state' => 'stalled', 'code' => 'codex_start_stalled'];
$stalled_config = $agents->config()->get_data();
check($stalled_config['unavailableReason'] === 'codex_start_stalled', 'a stalled native process must stop the endless progress state');
check(str_contains($stalled_config['runtimeDiagnostics']['action'], 'Hospedagens compartilhadas'), 'stalled startup must explain the likely hosting limitation');
$ready_response = ['ok' => false, 'version' => '1.0.4', 'state' => 'failed', 'code' => 'codex_start_timeout'];
$legacy_timeout_config = $agents->config()->get_data();
check($legacy_timeout_config['unavailableReason'] === 'runtime_starting', 'a legacy native timeout must continue as startup progress');
$ready_response = ['ok' => true, 'version' => '1.0.4', 'state' => 'ready'];
unset($options['kodety_agent_transport']);
$ready_config = $agents->retry_config()->get_data();
check($ready_config['transport'] === 'local' && !isset($options['kodety_agent_transport']), 'a ready runtime must work locally without a saved selection or Cloud allocation');
$options['kodety_agent_transport'] = 'local';
check($ready_config['available'] === true && !isset($ready_config['runtimeInstallation']), 'only an initialized native process may enable login');
check(json_decode(end($runtime_bridge_requests)['args']['body'], true)['retry'] === true, 'the explicit retry action must request native recovery');
$agents->config();
check(json_decode(end($runtime_bridge_requests)['args']['body'], true)['retry'] === false, 'forced recovery must be consumed once, not persist into polling');
$ready_response['version'] = '0.0.0';
check($agents->config()->get_data()['unavailableReason'] === 'sidecar_version_mismatch', 'an incompatible readiness API must not be accepted');
$runtime_bridge_responder = null;

$rest_error_method = new ReflectionMethod($agents, 'runtime_rest_error');
$validation_error = new WP_Error('kodety_agents_bridge_error', 'The attachment is unavailable or expired.', ['status' => 404]);
check($rest_error_method->invoke($agents, $validation_error) === $validation_error, 'ordinary RPC validation errors must not be mislabeled as a runtime outage');
$runtime_error = $rest_error_method->invoke($agents, new WP_Error('kodety_agents_bridge_error', '/private/process token=hidden', ['status' => 500]));
check(isset($runtime_error->get_error_data()['runtimeDiagnostics']), 'RPC runtime outages must carry the same public diagnostics as config');
check(!str_contains($runtime_error->get_error_message(), 'hidden'), 'RPC runtime errors must not reflect raw process output');

$artifact_url_method = new ReflectionMethod($agents, 'runtime_artifact_url');
check($artifact_url_method->invoke($agents, 'https://nodejs.org/dist/runtime.tar.gz', 'nodejs.org'), 'the pinned HTTPS artifact origin must remain accepted');
foreach (['http://nodejs.org/a', 'https://nodejs.org:8443/a', 'https://user@nodejs.org/a', 'https://nodejs.org/a?token=secret', 'https://nodejs.org/a#fragment', 'https://example.test/a'] as $invalid_url) {
    check(!$artifact_url_method->invoke($agents, $invalid_url, 'nodejs.org'), 'download URLs must not accept alternate origins, credentials, query strings or ports');
}

$uploaded_root = $root . '/user-37/uploaded-skills';
for ($index = 1; $index <= 24; $index++) {
    $skill_dir = $uploaded_root . '/skill-' . $index;
    @mkdir($skill_dir, 0700, true);
    file_put_contents($skill_dir . '/SKILL.md', "---\nname: skill-{$index}\n---\n");
}
$quota_method = new ReflectionMethod($agents, 'check_skill_quota');
$quota_method->setAccessible(true);
$quota_result = $quota_method->invoke($agents, 'one-more-skill', 1);
check(
    $quota_result instanceof WP_Error && $quota_result->get_error_code() === 'kodety_agents_skill_count_quota',
    'the per-user skill count quota must be enforced'
);

$forbidden = $agents->rpc(new WP_REST_Request([
    'method' => 'mcpServer/oauth/login',
    'params' => ['name' => 'figma'],
]));
check(
    $forbidden instanceof WP_Error && $forbidden->get_error_code() === 'kodety_agents_method_forbidden',
    'the Kodety MCP surface must not be exposed by Agent mode'
);
$unsafe_skill = $agents->install_skill(new WP_REST_Request([
    'name' => 'unsafe-skill',
    'files' => [['path' => '../SKILL.md', 'contentBase64' => base64_encode('bad')]],
]));
check($unsafe_skill instanceof WP_Error, 'skill path traversal must be rejected before reaching the sidecar');

$download_method = new ReflectionMethod($agents, 'download_runtime_artifact');
$download_method->setAccessible(true);
$download_fixture = $root . '/download-fixtures';
mkdir($download_fixture, 0700);
$source_file = $download_fixture . '/source.tgz';
file_put_contents($source_file, str_repeat('r', 4_194_304) . 'last block');
$source_hash = hash_file('sha256', $source_file);
$test_url = 'https://nodejs.org/kodety-range-test.tgz';
$runtime_downloads[$test_url] = $source_file;
$runtime_http_requests = [];
$destination = $download_fixture . '/resumable.tgz';
$download_step = static fn(string $target, ?string $hash = null): mixed => $download_method->invoke(
    $agents, $test_url, $target, 'sha256', $hash ?? $source_hash, 10_485_760
);
$first = $download_step($destination);
check(is_array($first) && $first['offset'] === 2_097_152, 'one request must download only one 2 MiB block');
check(count($runtime_http_requests) === 1 && filesize($destination) === 2_097_152, 'the rest of the archive must wait for another request');
$args = $runtime_http_requests[0]['args'];
check($args['headers']['Range'] === 'bytes=0-2097151' && $args['timeout'] <= 20, 'downloads must use bounded HTTP ranges and timeouts');
check($args['sslverify'] === true && $args['reject_unsafe_urls'] === true && $args['redirection'] === 0, 'chunking must retain HTTPS and URL validation');
check($args['stream'] === true && $args['limit_response_size'] === 2_097_153, 'network responses must stream to a bounded private part file');

// Simulate a PHP termination between append and the atomic metadata commit.
file_put_contents($destination, 'uncommitted tail', FILE_APPEND);
$runtime_downloads[$test_url] = new WP_Error('http_request_failed', 'cURL error 28: timed out /private/certificate token=hidden');
$interrupted = $download_step($destination);
clearstatcache(true, $destination);
check($interrupted instanceof WP_Error && $interrupted->get_error_code() === 'kodety_agents_runtime_download_timeout', 'network timeouts must have a specific public cause');
check(filesize($destination) === 2_097_152 && !is_file($destination . '.part'), 'failure must keep the committed prefix and discard only the incomplete part');
check(!str_contains($interrupted->get_error_message(), 'hidden'), 'raw transport messages must never be returned');
$runtime_downloads[$test_url] = $source_file;
$second = $download_step($destination);
check(is_array($second) && $second['offset'] === 4_194_304, 'retry must continue from the saved prefix');
check(end($runtime_http_requests)['args']['headers']['Range'] === 'bytes=2097152-4194303', 'retry must not request the first block again');
$last = $download_step($destination);
check(is_array($last) && $last['offset'] === filesize($source_file) && !$last['verified'], 'finishing a transfer must schedule a separate integrity check');
$before_hash = count($runtime_http_requests);
check($download_step($destination) === true && count($runtime_http_requests) === $before_hash, 'verification must not download the archive again');
check(hash_file('sha256', $destination) === $source_hash, 'resumed bytes must exactly match the pinned artifact');
check((fileperms($destination) & 0777) === 0600, 'partial downloads must be private');
check($download_step($destination) === true && count($runtime_http_requests) === $before_hash, 'a verified component must be reused');

$runtime_downloads[$test_url] = static fn(array $args): mixed => runtime_fixture_response($source_file, $args, false);
$no_ranges_target = $download_fixture . '/no-ranges.tgz';
$requests_before_fallback = count($runtime_http_requests);
$unsupported = $download_step($no_ranges_target);
$fallback_requests = array_slice($runtime_http_requests, $requests_before_fallback);
check(is_array($unsupported) && $unsupported['offset'] === filesize($source_file), 'a proxy ignoring Range must fall back to a complete bounded download');
check(count($fallback_requests) === 2, 'Range fallback must make one ranged request and one compatible whole-file request');
check(isset($fallback_requests[0]['args']['headers']['Range']) && !isset($fallback_requests[1]['args']['headers']['Range']), 'the compatible retry must omit only the unsupported Range header');
check($fallback_requests[1]['args']['stream'] === true && $fallback_requests[1]['args']['limit_response_size'] === 10_485_761, 'the compatible retry must remain streamed and size-bounded');
check($fallback_requests[1]['args']['sslverify'] === true && $fallback_requests[1]['args']['reject_unsafe_urls'] === true, 'the compatible retry must retain HTTPS and URL validation');
check($download_step($no_ranges_target) === true && hash_file('sha256', $no_ranges_target) === $source_hash, 'the compatible download must pass the pinned artifact hash before use');
$runtime_downloads[$test_url] = static function (array $args) use ($source_file): array {
    $response = runtime_fixture_response($source_file, $args);
    if (isset($args['headers']['Range'])) $response['headers']['content-range'] = '';
    return $response;
};
$missing_range_target = $download_fixture . '/missing-content-range.tgz';
$requests_before_missing_range = count($runtime_http_requests);
$missing_range = $download_step($missing_range_target);
$missing_range_requests = array_slice($runtime_http_requests, $requests_before_missing_range);
check(is_array($missing_range) && $missing_range['offset'] === filesize($source_file), 'HTTP 206 without Content-Range must use the bounded compatible download');
check(count($missing_range_requests) === 2 && !isset($missing_range_requests[1]['args']['headers']['Range']), 'a malformed partial response must be replaced from byte zero instead of appended');
check($download_step($missing_range_target) === true, 'the 206 compatibility fallback must still require hash verification');
$runtime_downloads[$test_url] = static function (array $args) use ($source_file): array {
    $response = runtime_fixture_response($source_file, $args);
    $response['headers']['content-range'] = 'bytes 1-2097152/4194314';
    return $response;
};
$wrong_range = $download_step($download_fixture . '/wrong-range.tgz');
check($wrong_range instanceof WP_Error && filesize($download_fixture . '/wrong-range.tgz') === 0, 'a misaligned Content-Range must not be appended');
$runtime_downloads[$test_url] = $source_file;
$changed_total = $download_step($download_fixture . '/changed-total.tgz');
$runtime_downloads[$test_url] = static function (array $args) use ($source_file): array {
    $response = runtime_fixture_response($source_file, $args);
    $response['headers']['content-range'] = 'bytes 2097152-4194303/5000000';
    return $response;
};
check($download_step($download_fixture . '/changed-total.tgz') instanceof WP_Error, 'a changed total must not mix different artifact responses');

$small_file = $download_fixture . '/small-source.tgz';
file_put_contents($small_file, 'small verified fixture');
$small_hash = hash_file('sha256', $small_file);
$runtime_downloads[$test_url] = static fn(array $args): mixed => runtime_fixture_response($small_file, $args, false);
$small_target = $download_fixture . '/small.tgz';
check(is_array($download_step($small_target, $small_hash)), 'a complete small HTTP 200 response may be staged');
check($download_step($small_target, $small_hash) === true, 'small artifacts must still pass their pinned hash');
$bad_target = $download_fixture . '/bad-hash.tgz';
$download_step($bad_target, str_repeat('0', 64));
$bad_hash = $download_step($bad_target, str_repeat('0', 64));
clearstatcache(true, $bad_target);
check($bad_hash instanceof WP_Error && $bad_hash->get_error_code() === 'kodety_agents_runtime_integrity', 'a corrupted completed artifact must fail closed');
check(filesize($bad_target) === 0 && is_file($destination), 'hash failure must reset only the bad component, preserving other completed files');

foreach ([401 => 'blocked', 403 => 'blocked', 404 => 'missing'] as $status => $reason) {
    $runtime_downloads[$test_url] = static fn(array $args): array => ['response' => ['code' => $status], 'body' => ''];
    $failed = $download_step($download_fixture . '/http-' . $status . '.tgz');
    check($failed instanceof WP_Error && $failed->get_error_code() === 'kodety_agents_runtime_download_' . $reason, 'HTTP download failures must retain a specific safe reason');
}
$lock_method = new ReflectionMethod($agents, 'acquire_runtime_install_lock');
$release_method = new ReflectionMethod($agents, 'release_runtime_lock');
$lock = $lock_method->invoke($agents);
check(is_array($lock) && $lock_method->invoke($agents) instanceof WP_Error, 'two requests must not append or extract concurrently');
$release_method->invoke($agents, $lock);
$lock = $lock_method->invoke($agents);
check(is_array($lock), 'a released lock must allow immediate resumption');
$release_method->invoke($agents, $lock);

$activation_root = $root . '/activation-fixtures';
$activation_final = $activation_root . '/runtime';
$activation_staging = $activation_root . '/staging';
mkdir($activation_final, 0700, true);
mkdir($activation_staging, 0700, true);
file_put_contents($activation_final . '/previous.txt', 'previous runtime');
file_put_contents($activation_staging . '/verified.txt', 'verified runtime');
$activate_method = new ReflectionMethod($agents, 'activate_managed_runtime_directory');
$shared_lock_method = new ReflectionMethod($agents, 'acquire_runtime_lock');
$start_lock = $shared_lock_method->invoke($agents, 'bridge-start.lock', 'kodety_agents_start_in_progress');
$busy_activation = $activate_method->invoke($agents, $activation_staging, $activation_final, $activation_root);
check($busy_activation instanceof WP_Error && is_file($activation_final . '/previous.txt') && is_file($activation_staging . '/verified.txt'), 'activation must not swap executables while another request starts the bridge');
$release_method->invoke($agents, $start_lock);
check($activate_method->invoke($agents, $activation_staging, $activation_final, $activation_root) === true, 'a verified staged runtime must replace the previous runtime');
check(is_file($activation_final . '/verified.txt') && is_file($activation_final . '.previous/previous.txt'), 'activation must preserve the previous installation as a recoverable copy');
rename($activation_final, $activation_staging);
check($activate_method->invoke($agents, $activation_staging, $activation_final, $activation_root) === true, 'an activation interrupted between renames must be recoverable');
check(is_file($activation_final . '/verified.txt') && is_file($activation_final . '.previous/previous.txt'), 'activation recovery must retain both the verified new runtime and the previous copy');
remove_test_tree($activation_root);

$progress_property = new ReflectionProperty($agents, 'runtime_provision_progress');
$progress_property->setValue($agents, [
    'phase' => 'download_node', 'message' => 'Baixando Node.js em partes…', 'step' => 1, 'stepCount' => 8,
    'downloadedBytes' => 2_097_152, 'totalBytes' => 4_194_314, 'resumable' => true, 'retryAfterMs' => 1000,
]);
$progress_config = $agents->config()->get_data();
check($progress_config['available'] === false && $progress_config['unavailableReason'] === 'runtime_installing', 'an intermediate step must not report a ready runtime');
check($progress_config['runtimeInstallation']['downloadedBytes'] === 2_097_152, 'config must expose saved byte progress');
check(!str_contains(json_encode($progress_config), $root), 'progress responses must not contain staging paths');

if (getenv('KODETY_RUNTIME_INSTALL_SMOKE') === '1') {
    $target_method = new ReflectionMethod($agents, 'managed_runtime_target');
    $target_method->setAccessible(true);
    $target = $target_method->invoke($agents);
    check(is_string($target), 'the installer smoke test requires a supported platform');
    $triples = [
        'linux-x64' => 'x86_64-unknown-linux-musl',
        'linux-arm64' => 'aarch64-unknown-linux-musl',
        'darwin-x64' => 'x86_64-apple-darwin',
        'darwin-arm64' => 'aarch64-apple-darwin',
    ];
    $fixture = rtrim(sys_get_temp_dir(), '/\\') . '/kodety-agent-installer-fixture-' . getmypid();
    $real_node_archive = (string) getenv('KODETY_RUNTIME_NODE_ARCHIVE');
    $real_codex_archive = (string) getenv('KODETY_RUNTIME_CODEX_ARCHIVE');
    if (is_file($real_node_archive) && is_file($real_codex_archive)) {
        $manifest_method = new ReflectionMethod($agents, 'managed_runtime_manifest');
        $manifest_method->setAccessible(true);
        $smoke_manifest = $manifest_method->invoke($agents, $target);
        check(is_array($smoke_manifest), 'the real installer smoke test requires the packaged manifest');
        $runtime_downloads = [
            $smoke_manifest['node']['url'] => $real_node_archive,
            $smoke_manifest['codex']['url'] => $real_codex_archive,
        ];
    } else {
        $node_top = 'node-v24.14.0-' . $target;
        $node_fixture = $fixture . '/node/' . $node_top . '/bin';
        $codex_fixture = $fixture . '/codex/package/vendor/' . $triples[$target] . '/bin';
        @mkdir($node_fixture, 0700, true);
        @mkdir($codex_fixture, 0700, true);
        file_put_contents($node_fixture . '/node', "#!/bin/sh\necho v24.14.0\n");
        file_put_contents($codex_fixture . '/codex', "#!/bin/sh\necho 'codex app-server'\n");
        @chmod($node_fixture . '/node', 0700);
        @chmod($codex_fixture . '/codex', 0700);
        $node_archive = $fixture . '/node.tgz';
        $codex_archive = $fixture . '/codex.tgz';
        $tar = is_executable('/usr/bin/tar') ? '/usr/bin/tar' : '/bin/tar';
        $status = 1;
        exec(escapeshellarg($tar) . ' -czf ' . escapeshellarg($node_archive)
            . ' -C ' . escapeshellarg($fixture . '/node') . ' ' . escapeshellarg($node_top), $unused, $status);
        check($status === 0, 'the installer smoke test must create its Node fixture');
        $status = 1;
        exec(escapeshellarg($tar) . ' -czf ' . escapeshellarg($codex_archive)
            . ' -C ' . escapeshellarg($fixture . '/codex') . ' package', $unused, $status);
        check($status === 0, 'the installer smoke test must create its Codex fixture');
        $node_url = 'https://nodejs.org/kodety-installer-smoke-node.tgz';
        $codex_url = 'https://registry.npmjs.org/@openai/codex/-/kodety-installer-smoke-codex.tgz';
        $runtime_downloads = [$node_url => $node_archive, $codex_url => $codex_archive];
        $smoke_manifest = [
            'target' => $target,
            'nodeVersion' => '24.14.0',
            'codexVersion' => '0.147.0-alpha.6.5',
            'node' => [
                'url' => $node_url,
                'sha256' => hash_file('sha256', $node_archive),
                'archivePath' => $node_top . '/bin/node',
                'maxBytes' => 10_485_760,
            ],
            'codex' => [
                'url' => $codex_url,
                'sha512' => base64_encode(hash_file('sha512', $codex_archive, true)),
                'vendorPath' => 'package/vendor/' . $triples[$target],
                'maxBytes' => 10_485_760,
            ],
        ];
    }
    $install_method = new ReflectionMethod($agents, 'install_managed_runtime');
    $install_method->setAccessible(true);
    $runtime_http_requests = [];
    $phases = [];
    $interrupted_codex = false;
    $staging_method = new ReflectionMethod($agents, 'runtime_install_directory');
    $staging = $staging_method->invoke($agents, $smoke_manifest);
    for ($step = 0; $step < 256; $step++) {
        // Each step runs on a fresh instance; only private disk state survives.
        $fresh_request = (new ReflectionClass(Kodety_Agents::class))->newInstanceWithoutConstructor();
        $installed = $install_method->invoke($fresh_request, $smoke_manifest);
        if (!is_array($installed)) break;
        $phases[] = $installed['phase'];
        check(!is_file($root . '/managed-runtime/' . $target . '/runtime.json'), 'an incomplete installation must never have an activation marker');
        if ($installed['phase'] === 'download_codex' && !$interrupted_codex) {
            $codex_url = $smoke_manifest['codex']['url'];
            $saved_source = $runtime_downloads[$codex_url];
            $runtime_downloads[$codex_url] = new WP_Error('http_request_failed', 'cURL error 28: timed out');
            $failed_step = $install_method->invoke($fresh_request, $smoke_manifest);
            check($failed_step instanceof WP_Error && is_file($staging . '/node.tar.gz'), 'a Codex download failure must preserve the verified Node archive');
            $runtime_downloads[$codex_url] = $saved_source;
            $interrupted_codex = true;
        }
    }
    check(
        $installed === true,
        'the verified private runtime must install atomically'
            . ($installed instanceof WP_Error ? ': ' . $installed->get_error_code() . ' / ' . $installed->get_error_message() : '')
    );
    check(is_file($root . '/managed-runtime/' . $target . '/node/bin/node'), 'managed Node.js must be stored privately');
    check(is_file($root . '/managed-runtime/' . $target . '/codex/bin/codex'), 'managed Codex must be stored privately');
    check(is_file($root . '/managed-runtime/' . $target . '/runtime.json'), 'managed runtime must include an activation marker');
    check(count($phases) >= 8 && in_array('verify_node', $phases, true) && in_array('verify_codex', $phases, true), 'downloads, verification, extraction and activation must use separate requests');
    check(!is_dir($staging), 'activation must move only the verified staging directory into place');
    check(!is_file($root . '/managed-runtime/' . $target . '/node.tar.gz'), 'activation must remove temporary archives');
    $node_download_count = count(array_filter($runtime_http_requests, static fn(array $entry): bool => $entry['url'] === $smoke_manifest['node']['url']));
    check($node_download_count === (int) ceil(filesize($runtime_downloads[$smoke_manifest['node']['url']]) / 2_097_152), 'resuming Codex must not redownload completed Node chunks');
    remove_test_tree($fixture);
}

Kodety_Edition::$licensed = false;
check($agents->can_read_config() === true, 'an unlicensed editor must be allowed to read the safe Agent preview config');
$unlicensed_permission = $agents->can_use_agents();
check(
    $unlicensed_permission instanceof WP_Error
        && $unlicensed_permission->get_error_code() === 'kodety_license_agents_required'
        && ($unlicensed_permission->get_error_data()['status'] ?? 0) === 403,
    'every operational Agent request must require a server-validated Pro license'
);
check(
    $agents->can_manage_skills() instanceof WP_Error,
    'skill management must remain server-blocked without a Pro license'
);
$unlicensed_config = $agents->config()->get_data();
check($unlicensed_config['enabled'] === false, 'the preview config must identify an unlicensed Agent');
check($unlicensed_config['available'] === false, 'the private Agent runtime must not start for the preview');
check($unlicensed_config['licenseRequired'] === true, 'the preview config must expose the Pro entitlement state');
check($unlicensed_config['licenseUrl'] === 'https://example.test/license', 'the preview must expose the license activation destination');
check($unlicensed_config['upgradeUrl'] === 'https://example.test/pro', 'the preview must expose the Pro upgrade destination');

foreach (['rpc', 'events', 'respond', 'config/retry'] as $protected_route) {
    check(
        $routes['kodety/v1/agents/' . $protected_route]['permission_callback'] === [$agents, 'can_use_agents'],
        $protected_route . ' must retain the server-side Pro permission callback'
    );
}
foreach ($routes['kodety/v1/agents/attachments'] as $attachment_route) {
    check(
        $attachment_route['permission_callback'] === [$agents, 'can_use_agents'],
        'every attachment operation must retain the server-side Pro permission callback'
    );
}
foreach ($routes['kodety/v1/agents/skills'] as $skill_route) {
    check(
        $skill_route['permission_callback'] === [$agents, 'can_manage_skills'],
        'every skill operation must retain the server-side Pro permission callback'
    );
}

remove_test_tree($root);
echo "Kodety Agents contract OK\n";
