<?php

declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');

final class WP_Error {
    public function __construct(private string $code, private string $message, private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}
final class WP_REST_Response {
    public array $headers = [];
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function set_data(mixed $data): void { $this->data = $data; }
    public function get_status(): int { return $this->status; }
    public function header(string $key, string $value): void { $this->headers[strtolower($key)] = $value; }
}
final class WP_REST_Request {
    private array $headers = [];
    private array $query = [];
    private string $body = '';
    public function __construct(private string $method = 'GET', private string $route = '') {}
    public function get_method(): string { return $this->method; }
    public function get_route(): string { return $this->route; }
    public function set_header(string $key, string $value): void { $this->headers[strtolower($key)] = $value; }
    public function get_header(string $key): ?string { return $this->headers[strtolower($key)] ?? null; }
    public function set_query_params(array $query): void { $this->query = $query; }
    public function set_body(string $body): void { $this->body = $body; }
    public function get_body(): string { return $this->body; }
    public function get_json_params(): mixed { return json_decode($this->body, true); }
    public function get_param(string $key): mixed { return ($this->get_json_params() ?? [])[$key] ?? $this->query[$key] ?? null; }
}
final class Kodety_MCP {
    public static ?WP_REST_Request $authenticated = null;
    public static int $owner = 7;
    public static bool $revoked = false;
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public function is_authenticated_native_context(WP_REST_Request $request): bool {
        return !self::$revoked && $request === self::$authenticated && get_current_user_id() === self::$owner;
    }
}

$native_test_logged_in = true;
$native_test_current_user = 7;
$native_test_routes = [];
$native_test_dispatches = [];
$native_test_permission_calls = 0;
$native_test_writes = 0;
$native_test_permission = true;
$native_test_callback = static fn(WP_REST_Request $request): WP_REST_Response => new WP_REST_Response([
    'route' => $request->get_route(), 'method' => $request->get_method(), 'body' => $request->get_json_params(),
]);
$native_test_assertions = 0;

function add_action(...$args): void {}
function is_user_logged_in(): bool { return $GLOBALS['native_test_logged_in']; }
function get_current_user_id(): int { return $GLOBALS['native_test_current_user']; }
function is_wp_error(mixed $result): bool { return $result instanceof WP_Error; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function rest_ensure_response(mixed $result): WP_REST_Response { return $result instanceof WP_REST_Response ? $result : new WP_REST_Response($result); }
function register_rest_route(string $namespace, string $route, array $handler): void {
    $GLOBALS['native_test_routes']['/' . $namespace . $route] = $handler;
}

/** A small dispatch boundary, deliberately executing permission_callback
 * before the route callback. Tests observe forwarded requests and callback
 * counts, rather than testing strings in the adapter implementation. Native
 * CMS transaction behavior is covered by cms-item-persistence-runtime.php. */
function rest_do_request(WP_REST_Request $request): WP_REST_Response|WP_Error {
    $GLOBALS['native_test_dispatches'][] = $request;
    $handler = $GLOBALS['native_test_routes'][$request->get_route()] ?? [
        'permission_callback' => static function (WP_REST_Request $request): bool|WP_Error {
            $GLOBALS['native_test_permission_calls']++;
            $permission = $GLOBALS['native_test_permission'];
            return is_callable($permission) ? $permission($request) : $permission;
        },
        'callback' => $GLOBALS['native_test_callback'],
    ];
    $permission = ($handler['permission_callback'])($request);
    if (is_wp_error($permission)) return $permission;
    if (!$permission) return new WP_Error('rest_forbidden', 'Native permission denied.', ['status' => 403]);
    return ($handler['callback'])($request);
}
function check(bool $pass, string $message): void {
    $GLOBALS['native_test_assertions']++;
    if (!$pass) throw new RuntimeException($message);
}
function expect_error(mixed $result, string $code, int $status, string $message): void {
    check($result instanceof WP_Error && $result->get_error_code() === $code
        && ($result->get_error_data()['status'] ?? 0) === $status, $message);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-native-operations.php';
$service = Kodety_Native_Operations::instance();
$service->register_routes();
$catalog = Kodety_Native_Operations::catalog();
check($catalog['schemaVersion'] === 1 && count($catalog['operations']) >= 35, 'Shared catalog must expose the implemented operations.');
check(count(array_unique(array_column($catalog['operations'], 'name'))) === count($catalog['operations']), 'Operation names must be unique.');
check(isset($native_test_routes['/kodety/v1/automation/tools'], $native_test_routes['/kodety/v1/automation/call']), 'Both REST routes must be registered.');
$native_test_logged_in = false;
expect_error($service->execute('cms_schema', []), 'kodety_automation_unauthorized', 401, 'Direct MCP execution must retain authentication.');
expect_error(rest_do_request(new WP_REST_Request('GET', '/kodety/v1/automation/tools')), 'kodety_automation_unauthorized', 401, 'Discovery requires authentication.');
$native_test_logged_in = true;
$tools = rest_do_request(new WP_REST_Request('GET', '/kodety/v1/automation/tools'));
check($tools->get_data() === $catalog, 'HTTP and PHP discovery must return the same catalog.');
$before = count($native_test_dispatches);
expect_error($service->execute('/wp/v2/users', []), 'kodety_automation_unknown_operation', 404, 'Caller cannot select arbitrary routes.');
expect_error($service->execute('cms_schema', ['route' => '/wp/v2/users']), 'kodety_automation_invalid_arguments', 400, 'Unknown arguments must fail before dispatch.');
expect_error($service->execute('cms_get_item', ['post_type' => '../../users', 'post_id' => 7]), 'kodety_automation_invalid_arguments', 400, 'Path traversal must fail before dispatch.');
expect_error($service->execute('cms_get_item', ['post_type' => 'post', 'post_id' => '7']), 'kodety_automation_invalid_arguments', 400, 'Integer IDs must not silently coerce strings.');
expect_error($service->execute('cms_list_items', ['post_type' => 'post', 'per_page' => 101]), 'kodety_automation_invalid_arguments', 400, 'Pagination bounds must match native maximum.');
check(count($native_test_dispatches) === $before, 'Invalid requests must never reach REST dispatch.');

$native_test_permission = false;
expect_error($service->execute('cms_get_item', ['post_type' => 'post', 'post_id' => 7]), 'rest_forbidden', 403, 'Native permission callbacks must still deny access.');
check($native_test_permission_calls === 1, 'Native route permission callback executes exactly once.');
$license_error = new WP_Error('kodety_license_ai_required', 'License required.', ['status' => 403, 'feature' => 'ai']);
$native_test_permission = $license_error;
check($service->execute('ai_settings_get', []) === $license_error, 'Native license error object and status are preserved.');
$native_test_permission = static function (WP_REST_Request $request): bool|WP_Error {
    if (str_ends_with($request->get_route(), '/99')) return new WP_Error('kodety_invalid_item', 'Other project.', ['status' => 404]);
    return true;
};
expect_error($service->execute('cms_get_item', ['post_type' => 'kodety_articles', 'post_id' => 99]), 'kodety_invalid_item', 404, 'Scoped native item denial must survive the adapter.');

$context = new WP_REST_Request('POST', '/kodety/v1/automation/call');
foreach ([
    'X-WP-Nonce' => 'real-browser-nonce',
    'X-Kodety-Editor-Session' => 'native-session-123456',
    'X-Kodety-Editor-Lease' => 'native-lease-12345678',
    'X-Kodety-Share' => 'project-share',
    'X-Kodety-Invite' => 'project-invite',
    'X-Kodety-Expected-Revision' => '12',
    'X-Kodety-Project-Digest' => str_repeat('a', 64),
    'Authorization' => 'Bearer never-forward-this',
] as $header => $value) $context->set_header($header, $value);
$native_test_permission = static function (WP_REST_Request $request): bool|WP_Error {
    if ($request->get_method() !== 'GET' && $request->get_header('x-kodety-editor-lease') !== 'native-lease-12345678') {
        return new WP_Error('kodety_editor_lock_required', 'Real lease required.', ['status' => 423]);
    }
    return true;
};
$create = ['post_type' => 'kodety_articles', 'expectedRevision' => 'schema-rev', 'values' => ['title' => 'Draft']];
expect_error($service->execute('cms_create_item', $create), 'kodety_editor_lock_required', 423, 'Missing lease must not be fabricated or bypassed.');
$response = $service->execute('cms_create_item', $create, $context);
$forwarded = end($native_test_dispatches);
check($forwarded->get_route() === '/kodety/v1/cms/items/kodety_articles' && $forwarded->get_method() === 'POST', 'Native route and method are selected by the catalog.');
check($forwarded->get_param('expectedRevision') === 'schema-rev' && $forwarded->get_param('status') === 'draft', 'Native schema revision and draft default are forwarded.');
check($forwarded->get_param('post_type') === null && $forwarded->get_param('context') === null, 'Transport/path fields never leak into native JSON.');
foreach (['x-wp-nonce', 'x-kodety-editor-session', 'x-kodety-editor-lease', 'x-kodety-share', 'x-kodety-invite', 'x-kodety-expected-revision', 'x-kodety-project-digest'] as $header) {
    check($forwarded->get_header($header) === $context->get_header($header), 'Explicit context header must be preserved: ' . $header);
}
check($forwarded->get_header('authorization') === null, 'MCP bearer is not propagated as a native authorization bypass.');
$from_arguments = $create + ['context' => ['editorSession' => 'native-session-123456', 'editorLease' => 'native-lease-12345678']];
check($service->execute('cms_create_item', $from_arguments) instanceof WP_REST_Response, 'External clients may explicitly provide an acquired native lease.');
check(end($native_test_dispatches)->get_header('x-wp-nonce') === null, 'External clients never receive a fabricated browser nonce.');
$conflicting = $create + ['context' => ['editorLease' => 'contradictory-lease-123']];
expect_error($service->execute('cms_create_item', $conflicting, $context), 'kodety_automation_context_conflict', 409, 'Context cannot replace authenticated request headers.');
check($service->execute('cms_schema', ['context' => ['expectedWorkspaceRevision' => 12]], $context) instanceof WP_REST_Response, 'Browser can supply revision-only context while its real lease remains implicit.');

$native_test_callback = static function (WP_REST_Request $request): WP_REST_Response|WP_Error {
    $GLOBALS['native_test_writes']++;
    return new WP_Error('kodety_revision_conflict', 'Native resource changed.', ['status' => 409, 'revision' => 'new-rev', 'current' => ['title' => 'Changed']]);
};
$conflict = $service->execute('cms_update_item', ['post_type' => 'post', 'post_id' => 7, 'expectedRevision' => 'old-rev', 'values' => ['title' => 'new']], $context);
expect_error($conflict, 'kodety_revision_conflict', 409, 'CMS conflict code/status remain native.');
check($conflict->get_error_data()['current']['title'] === 'Changed' && $native_test_writes === 1, 'Conflict payload is preserved and uncertain writes are never retried.');
$native_test_callback = static fn(): WP_Error => new WP_Error('kodety_import_rollback_failed', 'Partial rows remain.', ['status' => 500, 'postIds' => [41], 'row' => 4, 'rollbackFailed' => true]);
$import = $service->execute('cms_import_items', ['post_type' => 'post', 'expectedRevision' => 'rev', 'items' => [['values' => ['title' => 'First']]]], $context);
expect_error($import, 'kodety_import_rollback_failed', 500, 'Native import rollback failure is not converted to success.');
check($import->get_error_data()['postIds'] === [41], 'Real partial row identities must remain available for reconciliation.');
expect_error($service->execute('cms_import_items', ['post_type' => 'post', 'expectedRevision' => 'rev', 'items' => array_fill(0, 1001, ['values' => []])], $context), 'kodety_automation_invalid_arguments', 400, 'Import maximum is enforced before dispatch.');
expect_error($service->execute('cms_delete_collection', ['post_type' => 'kodety_posts', 'expectedRevision' => 'rev', 'confirmation' => 'kodety_posts', 'deleteItems' => true], $context), 'kodety_automation_invalid_arguments', 400, 'Cascade deletion cannot be requested.');
expect_error($service->execute('cms_update_fields', ['post_type' => 'post', 'expectedRevision' => 'rev', 'fields' => [['name' => 'extra', 'type' => 'text', 'unknown' => 1]]], $context), 'kodety_automation_invalid_arguments', 400, 'Nested schema unknown fields cannot be silently discarded.');

$native_test_permission = true;
$native_test_callback = static fn(): WP_REST_Response => new WP_REST_Response([
    'project' => ['files' => ['.incode/project.json' => ['text' => json_encode(['name' => 'site', 'localization' => ['locales' => [['code' => 'pt-BR']]]])]]],
    'workspaceRevision' => 12, 'workspaceDigest' => str_repeat('b', 64),
]);
$localized = $service->execute('localization_get', [], $context);
check($localized->get_data()['localization']['locales'][0]['code'] === 'pt-BR'
    && $localized->get_data()['workspaceRevision'] === 12
    && !isset($localized->get_data()['project']), 'Localization read returns native metadata with revision, without duplicating the source graph.');
check(end($native_test_dispatches)->get_param('surface') === 'settings', 'Localization uses the authenticated native Settings surface.');
$native_test_callback = static fn(): WP_REST_Response => new WP_REST_Response(['requiresFullProject' => true, 'workspaceRevision' => 12]);
expect_error($service->execute('localization_get', []), 'kodety_automation_full_project_required', 409, 'Protected project fallback must not fabricate empty localization.');
$native_test_callback = static fn(): WP_REST_Response => new WP_REST_Response(['configured' => true, 'apiKey' => 'raw', 'keyHint' => '••••', 'nested' => ['access_token' => 'raw-token', 'pixelId' => '12345']]);
$settings = $service->execute('ai_settings_get', []);
check($settings->get_data() === ['configured' => true, 'keyHint' => '••••', 'nested' => ['pixelId' => '12345']], 'Settings credentials are removed recursively while public metadata remains.');
$native_test_callback = static fn(WP_REST_Request $request): WP_REST_Response => new WP_REST_Response(['workspaceRevision' => 13], 201);
$delta = $service->execute('project_apply_delta', ['protocolVersion' => 1, 'baseRevision' => 12, 'requestId' => 'real-delta-request-12345', 'upserts' => [['path' => '.incode/project.json', 'encoding' => 'utf8', 'content' => '{}', 'byteLength' => 2, 'sha256' => hash('sha256', '{}')]]], $context);
check($delta->get_status() === 201 && $delta->get_data()['workspaceRevision'] === 13, 'Native status and next workspace revision are preserved.');
check(end($native_test_dispatches)->get_header('X-Kodety-Delta-Root') === 'project', 'Native Settings writes use project-relative root mode.');
$bad_call = new WP_REST_Request('POST', '/kodety/v1/automation/call');
$bad_call->set_body(json_encode(['operation' => 'cms_schema', 'arguments' => [], 'requestId' => 'unsupported-retry-key']));
expect_error($service->call_rest($bad_call), 'kodety_automation_invalid_call', 400, 'Wrapper cannot claim unsupported idempotency or unknown parameters.');
$good_call = new WP_REST_Request('POST', '/kodety/v1/automation/call');
$good_call->set_body(json_encode(['operation' => 'cms_schema', 'arguments' => []]));
check($service->call_rest($good_call)->get_status() === 201, 'HTTP call path executes the same shared service and preserves status.');
check(Kodety_Native_Operations::request_is_read_only($good_call), 'Validated read operation classifies its POST envelope as read-only.');
check(!Kodety_Native_Operations::request_is_read_only($bad_call), 'Unknown envelope fields cannot receive read-only classification.');
$native_test_callback = static function (): WP_REST_Response {
    check(Kodety_Native_Operations::is_dispatching_read_only(), 'Share capability context sees the actual internal native GET.');
    return new WP_REST_Response([]);
};
$service->execute('cms_schema', []);
check(!Kodety_Native_Operations::is_dispatching_read_only(), 'Read capability dispatch context is cleared after execution.');

// The nonce alternative is an object-identity marker, never a header flag.
$mcp_context = new WP_REST_Request('POST', '/kodety/v1/mcp');
$mcp_context->set_header('authorization', 'Bearer verified-only-by-authenticator');
Kodety_MCP::$authenticated = $mcp_context;
$native_test_permission = static fn(WP_REST_Request $request): bool|WP_Error =>
    Kodety_Native_Operations::is_authenticated_mcp_request($request)
        ? true : new WP_Error('native_nonce_required', 'Native nonce required.', ['status' => 403]);
$native_test_callback = static function (WP_REST_Request $request): WP_REST_Response {
    check($request->get_header('x-wp-nonce') === null, 'Authenticated MCP never manufactures a browser nonce.');
    check(Kodety_Native_Operations::is_authenticated_mcp_request($request), 'Verified MCP marker is present only inside native dispatch.');
    check(!Kodety_Native_Operations::is_authenticated_mcp_request(clone $request), 'Cloning or copying a request cannot copy its authentication marker.');
    return new WP_REST_Response(['configured' => true]);
};
check($service->execute('meta_capi_get', [], $mcp_context)->get_status() === 200, 'Verified MCP context can use native integration authentication.');
check(!Kodety_Native_Operations::is_authenticated_mcp_request(end($native_test_dispatches)), 'MCP marker is detached after a successful response.');
expect_error($service->execute('meta_capi_get', [], clone $mcp_context), 'native_nonce_required', 403, 'Matching bearer text in another outer request has no authority.');
Kodety_MCP::$revoked = true;
expect_error($service->execute('meta_capi_get', [], $mcp_context), 'native_nonce_required', 403, 'Revoked MCP authentication cannot produce a native marker.');
Kodety_MCP::$revoked = false;
$native_test_current_user = 8;
expect_error($service->execute('meta_capi_get', [], $mcp_context), 'native_nonce_required', 403, 'Changing current user invalidates the owner-bound MCP context.');
$native_test_current_user = 7;
$native_test_permission = static function (WP_REST_Request $request): bool|WP_Error {
    Kodety_MCP::$revoked = true;
    return Kodety_Native_Operations::is_authenticated_mcp_request($request)
        ? true : new WP_Error('native_nonce_required', 'Revoked before callback.', ['status' => 403]);
};
expect_error($service->execute('meta_capi_get', [], $mcp_context), 'native_nonce_required', 403, 'Marker rechecks revocation at the native authorization boundary.');
Kodety_MCP::$revoked = false;
$native_test_permission = true;
$native_test_callback = static function (): never { throw new RuntimeException('Injected callback exception.'); };
try { $service->execute('meta_capi_get', [], $mcp_context); } catch (RuntimeException $error) {
    check($error->getMessage() === 'Injected callback exception.', 'Callback exception remains visible to the caller.');
}
check(!Kodety_Native_Operations::is_authenticated_mcp_request(end($native_test_dispatches))
    && !Kodety_Native_Operations::is_dispatching_read_only(), 'MCP marker and read context are detached even after exceptions.');

fwrite(STDOUT, 'Native operations runtime passed (' . $native_test_assertions . " assertions).\n");
