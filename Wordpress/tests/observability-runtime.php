<?php

/** Runtime contracts for opt-in, redacted WordPress performance diagnostics. */
define('ABSPATH', __DIR__);

$kodety_observability_mode = $argv[1] ?? '';
if ($kodety_observability_mode === '--string-flag') {
    define('KODETY_PERFORMANCE_DEBUG', 'true');
}

$GLOBALS['kodety_observability_admin'] = true;
$GLOBALS['kodety_observability_capability_exception'] = false;
$GLOBALS['kodety_observability_filters'] = [];
$GLOBALS['kodety_observability_actions'] = [];

function add_filter(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): void {
    $GLOBALS['kodety_observability_filters'][] = [$hook, $callback, $priority, $accepted_args];
}

function add_action(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): void {
    $GLOBALS['kodety_observability_actions'][] = [$hook, $callback, $priority, $accepted_args];
}

function current_user_can(string $capability): bool {
    if ($GLOBALS['kodety_observability_capability_exception']) {
        throw new RuntimeException('ambiguous capability context');
    }
    return $capability === 'manage_options' && (bool) $GLOBALS['kodety_observability_admin'];
}

function wp_json_encode(mixed $value, int $flags = 0, int $depth = 512): string|false {
    return json_encode($value, $flags, $depth);
}

function is_wp_error(mixed $value): bool {
    return false;
}

final class Kodety_Sharing {
    public static bool $shared = false;
    public static bool $throw = false;

    public static function instance(): self { return new self(); }

    public function context(mixed $request): ?array {
        if (self::$throw) throw new RuntimeException('ambiguous sharing context');
        return self::$shared ? ['kind' => 'share'] : null;
    }
}

final class Kodety_Observability_Request {
    private array $headers;
    public int $headerReads = 0;

    public function __construct(
        private string $route,
        private string $method = 'GET',
        array $headers = []
    ) {
        $this->headers = array_change_key_case($headers, CASE_LOWER);
    }

    public function get_route(): string { return $this->route; }
    public function get_method(): string { return $this->method; }
    public function get_header(string $name): string {
        $this->headerReads++;
        return (string) ($this->headers[strtolower($name)] ?? '');
    }
}

final class Kodety_Observability_Response {
    private array $headers;

    public function __construct(private int $status = 200, array $headers = []) {
        $this->headers = $headers;
    }
    public function get_status(): int { return $this->status; }
    public function header(string $name, string $value, bool $replace = true): void {
        if (!$replace && isset($this->headers[$name])) {
            $this->headers[$name] .= ', ' . $value;
            return;
        }
        $this->headers[$name] = $value;
    }
    public function get_headers(): array { return $this->headers; }
}

function kodety_observability_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-observability.php';

if ($kodety_observability_mode === '--string-flag') {
    Kodety_Observability::register();
    kodety_observability_assert(
        $GLOBALS['kodety_observability_filters'] === []
            && $GLOBALS['kodety_observability_actions'] === [],
        'string debug flag must stay disabled'
    );
    echo "String debug flag stayed disabled.\n";
    exit(0);
}

$logs = [];
Kodety_Observability::set_log_sink_for_tests(static function (string $line) use (&$logs): void {
    $logs[] = $line;
});
$emitted_headers = [];
Kodety_Observability::set_header_sink_for_tests(
    static function (string $name, string $value, bool $replace) use (&$emitted_headers): void {
        $emitted_headers[] = [$name, $value, $replace];
    }
);

$string_flag_output = [];
$string_flag_status = 1;
exec(
    escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --string-flag 2>&1',
    $string_flag_output,
    $string_flag_status
);
kodety_observability_assert(
    $string_flag_status === 0,
    'literal string "true" must not enable observability: ' . implode("\n", $string_flag_output)
);

// With no constant, even registration and hostile request objects are strict
// no-ops: no user lookup, header read, timer state, response header or log.
Kodety_Observability::register();
kodety_observability_assert(
    $GLOBALS['kodety_observability_filters'] === []
        && $GLOBALS['kodety_observability_actions'] === [],
    'debug-off must not register REST or admin-post hooks'
);
$disabled_request = new Kodety_Observability_Request(
    '/kodety/v1/project/surface',
    'GET',
    ['X-Kodety-Operation-Id' => 'obs-1234567890abcdef1234567890abcdef']
);
$disabled_response = new Kodety_Observability_Response(200);
Kodety_Observability::before_callbacks(null, null, $disabled_request);
Kodety_Observability::finish_dispatch($disabled_response, null, $disabled_request);
kodety_observability_assert($disabled_request->headerReads === 0, 'debug-off must not read request headers');
kodety_observability_assert($disabled_response->get_headers() === [], 'debug-off must not emit headers');
kodety_observability_assert($emitted_headers === [], 'debug-off admin-post path must not emit headers');
kodety_observability_assert($logs === [], 'debug-off must not emit logs');

for ($index = 0; $index < 10_000; $index++) Kodety_Observability::enabled_for_request($disabled_request);
$disabled_benchmark_start = hrtime(true);
for ($index = 0; $index < 250_000; $index++) Kodety_Observability::enabled_for_request($disabled_request);
$disabled_benchmark_ms = (hrtime(true) - $disabled_benchmark_start) / 1_000_000;
kodety_observability_assert(
    $disabled_benchmark_ms < 250,
    sprintf('debug-off exceeded broad 250 ms/250k budget (%.2f ms)', $disabled_benchmark_ms)
);
kodety_observability_assert($disabled_request->headerReads === 0, 'debug-off benchmark must remain side-effect free');

define('KODETY_PERFORMANCE_DEBUG', true);
Kodety_Observability::register();
kodety_observability_assert(
    count($GLOBALS['kodety_observability_filters']) === 2,
    'literal true flag must register exactly the two bounded REST hooks'
);
kodety_observability_assert(
    count($GLOBALS['kodety_observability_actions']) === 2
        && $GLOBALS['kodety_observability_actions'][0][0]
            === 'admin_post_kodety_download_editor_project'
        && $GLOBALS['kodety_observability_actions'][0][2] === 0
        && $GLOBALS['kodety_observability_actions'][1][0] === 'shutdown',
    'literal true flag must register the bounded admin-post correlation hooks'
);

$GLOBALS['kodety_observability_admin'] = false;
$non_admin_request = new Kodety_Observability_Request('/kodety/v1/project/surface');
$non_admin_response = new Kodety_Observability_Response();
Kodety_Observability::before_callbacks(null, null, $non_admin_request);
Kodety_Observability::finish_dispatch($non_admin_response, null, $non_admin_request);
kodety_observability_assert($non_admin_response->get_headers() === [], 'non-admin request must not be observed');
kodety_observability_assert($logs === [], 'non-admin request must not be logged');

$GLOBALS['kodety_observability_admin'] = true;
$shared_request = new Kodety_Observability_Request(
    '/kodety/v1/project/surface',
    'GET',
    ['X-Kodety-Share' => 'private-share-token']
);
$shared_response = new Kodety_Observability_Response();
Kodety_Observability::before_callbacks(null, null, $shared_request);
Kodety_Observability::finish_dispatch($shared_response, null, $shared_request);
kodety_observability_assert($shared_response->get_headers() === [], 'shared request must not be observed');
kodety_observability_assert($logs === [], 'shared request must not be logged');

Kodety_Sharing::$shared = true;
$sharing_context_request = new Kodety_Observability_Request('/kodety/v1/project/surface');
Kodety_Observability::before_callbacks(null, null, $sharing_context_request);
Kodety_Observability::finish_dispatch(
    new Kodety_Observability_Response(),
    null,
    $sharing_context_request
);
Kodety_Sharing::$shared = false;
kodety_observability_assert($logs === [], 'resolved sharing context must fail closed');

Kodety_Sharing::$throw = true;
$ambiguous_context_request = new Kodety_Observability_Request('/kodety/v1/project/surface');
Kodety_Observability::before_callbacks(null, null, $ambiguous_context_request);
Kodety_Observability::finish_dispatch(
    new Kodety_Observability_Response(),
    null,
    $ambiguous_context_request
);
Kodety_Sharing::$throw = false;
kodety_observability_assert($logs === [], 'sharing context exceptions must fail closed');

$GLOBALS['kodety_observability_capability_exception'] = true;
kodety_observability_assert(
    Kodety_Observability::enabled_for_shell(false) === false,
    'capability exceptions must disable shell diagnostics'
);
$ambiguous_capability_request = new Kodety_Observability_Request('/kodety/v1/project/surface');
Kodety_Observability::before_callbacks(null, null, $ambiguous_capability_request);
Kodety_Observability::finish_dispatch(
    new Kodety_Observability_Response(),
    null,
    $ambiguous_capability_request
);
$GLOBALS['kodety_observability_capability_exception'] = false;
kodety_observability_assert($logs === [], 'capability exceptions must fail closed');

$operation_id = 'obs-1234567890abcdef1234567890abcdef';
$publish_request = new Kodety_Observability_Request(
    '/kodety/v1/publish',
    'POST',
    ['X-Kodety-Operation-Id' => $operation_id]
);
$publish_response = new Kodety_Observability_Response(201, [
    'Server-Timing' => 'db;dur=4.10',
]);
Kodety_Observability::before_callbacks(null, null, $publish_request);
Kodety_Observability::finish_dispatch($publish_response, null, $publish_request);
Kodety_Observability::finish_dispatch($publish_response, null, $publish_request);
$publish_headers = $publish_response->get_headers();
kodety_observability_assert(
    ($publish_headers['X-Kodety-Operation-Id'] ?? '') === $operation_id,
    'valid non-secret operation id must correlate browser and PHP'
);
kodety_observability_assert(
    preg_match(
        '/\Adb;dur=4\.10, kodety_publish;dur=\d+\.\d{2}\z/',
        (string) ($publish_headers['Server-Timing'] ?? '')
    ) === 1,
    'enabled response must append one bounded metric without replacing Server-Timing'
);
kodety_observability_assert(count($logs) === 1, 'double finish must emit exactly one JSON line');
$publish_log = json_decode($logs[0], true);
kodety_observability_assert(is_array($publish_log), 'performance log must be valid JSON');
kodety_observability_assert(($publish_log['operation'] ?? '') === 'publish', 'log operation must be allowlisted');
kodety_observability_assert(($publish_log['status'] ?? 0) === 201, 'log status must be bounded');

foreach ([
    'obs-1234567890ABCDEF1234567890ABCDEF',
    'obs-12345678-1234-1234-1234-123456789abc',
    'publish-1234567890abcdef1234567890abcdef',
    'draft-delta-1234567890abcdef1234567890abcdef',
    'obs-1234567890abcdef1234567890abcdef-payload',
    'obs-1234567890abcdef1234567890abcde',
    'obs-1234567890abcdef1234567890abcdef0',
] as $permissive_id) {
    kodety_observability_assert(
        !Kodety_Observability::is_operation_id($permissive_id),
        "permissive operation id must be rejected: {$permissive_id}"
    );
}
$generated_obs_id = Kodety_Observability::new_operation_id();
$generated_trace_id = Kodety_Observability::new_operation_id('trace');
kodety_observability_assert(
    preg_match('/\Aobs-[0-9a-f]{32}\z/D', $generated_obs_id) === 1
        && preg_match('/\Atrace-[0-9a-f]{32}\z/D', $generated_trace_id) === 1
        && $generated_obs_id !== Kodety_Observability::new_operation_id(),
    'generated identifiers must be opaque, rigid and unique'
);

$invalid_id = 'Bearer private@example.com https://private.test/?token=secret';
$invalid_request = new Kodety_Observability_Request(
    '/kodety/v1/project/delta',
    'POST',
    ['X-Kodety-Operation-Id' => $invalid_id]
);
$invalid_response = new Kodety_Observability_Response(500);
Kodety_Observability::before_callbacks(null, null, $invalid_request);
Kodety_Observability::finish_dispatch($invalid_response, null, $invalid_request);
$replacement_id = (string) ($invalid_response->get_headers()['X-Kodety-Operation-Id'] ?? '');
kodety_observability_assert($replacement_id !== $invalid_id, 'invalid operation id must never be echoed');
kodety_observability_assert(Kodety_Observability::is_operation_id($replacement_id), 'replacement id must be safe');
kodety_observability_assert(count($logs) === 2, 'invalid id request must still produce one safe diagnostic');

$admin_post_operation_id = 'obs-fedcba0987654321fedcba0987654321';
$_SERVER['HTTP_X_KODETY_OPERATION_ID'] = $admin_post_operation_id;
http_response_code(200);
$admin_header_offset = count($emitted_headers);
Kodety_Observability::before_admin_post_download();
Kodety_Observability::finish_admin_post_download();
Kodety_Observability::finish_admin_post_download();
$admin_headers = array_slice($emitted_headers, $admin_header_offset);
kodety_observability_assert(
    count($admin_headers) === 2
        && $admin_headers[0] === [
            'X-Kodety-Operation-Id',
            $admin_post_operation_id,
            true,
        ]
        && $admin_headers[1][0] === 'Server-Timing'
        && $admin_headers[1][2] === false
        && preg_match('/\Akodety_project_download;dur=\d+\.\d{2}\z/', $admin_headers[1][1]) === 1,
    'admin-post download must correlate once and append its timing metric'
);
kodety_observability_assert(count($logs) === 3, 'admin-post double finish must log exactly once');
$admin_log = json_decode($logs[2], true);
kodety_observability_assert(
    is_array($admin_log)
        && ($admin_log['operation'] ?? '') === 'project_download'
        && ($admin_log['operationId'] ?? '') === $admin_post_operation_id,
    'admin-post diagnostic must use the same opaque correlation id'
);

$invalid_admin_post_id = 'obs-c2VjcmV0LXRva2VuLXByb2R1Y3Rpb24';
$_SERVER['HTTP_X_KODETY_OPERATION_ID'] = $invalid_admin_post_id;
$invalid_admin_header_offset = count($emitted_headers);
Kodety_Observability::before_admin_post_download();
Kodety_Observability::finish_admin_post_download();
$invalid_admin_headers = array_slice($emitted_headers, $invalid_admin_header_offset);
$safe_admin_post_id = (string) ($invalid_admin_headers[0][1] ?? '');
kodety_observability_assert(
    count($invalid_admin_headers) === 2
        && $safe_admin_post_id !== $invalid_admin_post_id
        && Kodety_Observability::is_operation_id($safe_admin_post_id)
        && !str_contains(json_encode($logs), $invalid_admin_post_id),
    'admin-post must replace permissive correlation ids without logging or echoing them'
);
kodety_observability_assert(count($logs) === 4, 'invalid admin-post id must emit one safe diagnostic');

$_SERVER['HTTP_X_KODETY_SHARE'] = 'private-admin-post-share';
$shared_admin_header_count = count($emitted_headers);
$shared_admin_log_count = count($logs);
Kodety_Observability::before_admin_post_download();
Kodety_Observability::finish_admin_post_download();
unset($_SERVER['HTTP_X_KODETY_SHARE'], $_SERVER['HTTP_X_KODETY_OPERATION_ID']);
kodety_observability_assert(
    count($emitted_headers) === $shared_admin_header_count
        && count($logs) === $shared_admin_log_count,
    'admin-post sharing headers must never enable or emit diagnostics'
);

$redacted = Kodety_Observability::sanitize_fields([
    'operation' => 'surface',
    'operationId' => 'obs-1234567890abcdef1234567890abcdef',
    'durationMs' => 12.345,
    'result' => 'https://private.test/?token=secret',
    'status' => 204,
    'revision' => 7,
    'bytes' => 1024,
    'attempt' => 2,
    'cache' => 'hit',
    'fallback' => 'full_project',
    'transport' => 'surface',
    'nonce' => 'nonce-secret',
    'token' => 'token-secret',
    'url' => 'https://private.test',
    'path' => '/Users/private/project',
    'digest' => str_repeat('a', 64),
    'message' => 'customer@example.com',
    'html' => '<main>private project</main>',
]);
kodety_observability_assert(!isset($redacted['result']), 'arbitrary result strings must be dropped');
kodety_observability_assert(($redacted['status'] ?? 0) === 204, 'allowed numeric status must survive');
$serialized = json_encode([$logs, $redacted], JSON_UNESCAPED_SLASHES);
foreach ([
    'private@example.com',
    'private.test',
    'nonce-secret',
    'token-secret',
    '/Users/private',
    'customer@example.com',
    '<main>',
] as $secret) {
    kodety_observability_assert(
        !str_contains((string) $serialized, $secret),
        "redacted diagnostics leaked {$secret}"
    );
}

$unrelated_request = new Kodety_Observability_Request('/wp/v2/users');
$unrelated_response = new Kodety_Observability_Response();
Kodety_Observability::before_callbacks(null, null, $unrelated_request);
Kodety_Observability::finish_dispatch($unrelated_response, null, $unrelated_request);
kodety_observability_assert($unrelated_response->get_headers() === [], 'non-allowlisted route must stay untouched');
kodety_observability_assert(count($logs) === 4, 'non-allowlisted route must not be logged');

printf(
    "WordPress observability PHP contracts passed (debug-off 250k calls: %.2f ms).\n",
    $disabled_benchmark_ms
);
