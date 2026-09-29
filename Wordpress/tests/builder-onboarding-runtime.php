<?php

/** Run with: php Wordpress/tests/builder-onboarding-runtime.php */
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');

final class WP_Error {
    public function __construct(private string $code, private string $message = '', private mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_data(): mixed { return $this->data; }
}
final class WP_REST_Request {
    public function __construct(private array $params = [], private array $headers = ['X-WP-Nonce' => 'valid-nonce']) {}
    public function get_param(string $key): mixed { return $this->params[$key] ?? null; }
    public function get_header(string $key): string { return (string) ($this->headers[$key] ?? ''); }
}
final class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null) {}
    public function get_data(): mixed { return $this->data; }
    public function header(string $key, string $value): void { $this->headers[$key] = $value; }
    public function get_headers(): array { return $this->headers; }
}
final class WP_REST_Server {
    public const READABLE = 'GET';
    public const CREATABLE = 'POST';
}
final class Kodety_Sharing {
    public static ?array $share = null;
    public static function instance(): self { return new self(); }
    public function context(?WP_REST_Request $request = null): ?array { return self::$share; }
}

$onboarding_hooks = [];
$onboarding_routes = [];
$onboarding_user_id = 11;
$onboarding_caps = ['kodety_edit'];
$onboarding_meta = [];
$onboarding_meta_cache = [];
$onboarding_writes = [];
$onboarding_fail_write = false;
$onboarding_racing_dismissal = false;
$onboarding_before_add = null;
$onboarding_after_unique_check = null;
$onboarding_before_update = null;
$onboarding_write_attempts = 0;

function add_action(string $hook, mixed $callback): void {
    $GLOBALS['onboarding_hooks'][$hook] = $callback;
}
function register_rest_route(string $namespace, string $route, array $endpoints): void {
    $GLOBALS['onboarding_routes'][$namespace . $route] = $endpoints;
}
function is_user_logged_in(): bool { return $GLOBALS['onboarding_user_id'] > 0; }
function get_current_user_id(): int { return $GLOBALS['onboarding_user_id']; }
function current_user_can(string $capability): bool { return in_array($capability, $GLOBALS['onboarding_caps'], true); }
function wp_verify_nonce(string $nonce, string $action): bool { return $nonce === 'valid-nonce' && $action === 'wp_rest'; }
function rest_url(string $path): string { return 'https://kodety.test/wp-json/' . $path; }
function get_user_meta(int $user_id, string $key, bool $single): mixed {
    if (!array_key_exists($user_id, $GLOBALS['onboarding_meta_cache'])) {
        $GLOBALS['onboarding_meta_cache'][$user_id] = $GLOBALS['onboarding_meta'][$user_id] ?? [];
    }
    $values = $GLOBALS['onboarding_meta_cache'][$user_id][$key] ?? [];
    return $single ? ($values[0] ?? '') : $values;
}
function wp_cache_delete(int $user_id, string $group): bool {
    expect_onboarding($group === 'user_meta', 'Only the current account meta cache should be invalidated.');
    unset($GLOBALS['onboarding_meta_cache'][$user_id]);
    return true;
}
function onboarding_interleave(string $hook, int $user_id, string $key): void {
    $callback = $GLOBALS[$hook];
    $GLOBALS[$hook] = null;
    if (is_callable($callback)) $callback($user_id, $key);
}
function add_user_meta(int $user_id, string $key, mixed $value, bool $unique): bool {
    $GLOBALS['onboarding_write_attempts']++;
    onboarding_interleave('onboarding_before_add', $user_id, $key);
    if ($GLOBALS['onboarding_fail_write'] || ($unique && ($GLOBALS['onboarding_meta'][$user_id][$key] ?? []) !== [])) return false;
    // Match core's separate SELECT uniqueness check and INSERT: another
    // worker can insert between them because usermeta has no unique index.
    onboarding_interleave('onboarding_after_unique_check', $user_id, $key);
    $GLOBALS['onboarding_meta'][$user_id][$key][] = $value;
    wp_cache_delete($user_id, 'user_meta');
    $GLOBALS['onboarding_writes'][] = compact('user_id', 'key', 'value');
    return true;
}
function update_user_meta(int $user_id, string $key, mixed $value, mixed $previous = ''): bool {
    $GLOBALS['onboarding_write_attempts']++;
    onboarding_interleave('onboarding_before_update', $user_id, $key);
    if ($GLOBALS['onboarding_racing_dismissal']) {
        $GLOBALS['onboarding_meta'][$user_id][$key] = ['dismissed'];
        $GLOBALS['onboarding_racing_dismissal'] = false;
    }
    if ($GLOBALS['onboarding_fail_write']) return false;
    $updated = false;
    foreach ($GLOBALS['onboarding_meta'][$user_id][$key] as &$current) {
        if ($current !== $value && ($previous === '' || $current === $previous)) {
            $current = $value;
            $updated = true;
        }
    }
    unset($current);
    if (!$updated) return false;
    wp_cache_delete($user_id, 'user_meta');
    $GLOBALS['onboarding_writes'][] = compact('user_id', 'key', 'value');
    return true;
}
// Any accidental project/site persistence makes this suite fail immediately.
function update_post_meta(mixed ...$arguments): never { throw new RuntimeException('Onboarding must not write project metadata.'); }
function update_option(mixed ...$arguments): never { throw new RuntimeException('Onboarding must not write site options.'); }

require dirname(__DIR__) . '/kodety/includes/class-kodety-builder-onboarding.php';

function expect_onboarding(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function expect_onboarding_error(mixed $result, int $status, string $message): void {
    expect_onboarding($result instanceof WP_Error && ($result->get_error_data()['status'] ?? 0) === $status, $message);
}
function expect_onboarding_preference(mixed $result, string $expected): void {
    expect_onboarding($result instanceof WP_REST_Response, 'Preference requests must return REST responses.');
    expect_onboarding($result->get_data() === ['userId' => get_current_user_id(), 'preference' => $expected], 'The payload must belong to the current account.');
    expect_onboarding(($result->get_headers()['Cache-Control'] ?? '') === 'private, no-store, max-age=0', 'Personal choices must never be publicly cached.');
}

$onboarding = Kodety_Builder_Onboarding::instance();
expect_onboarding(isset($onboarding_hooks['rest_api_init']), 'The subsystem must register through REST initialization.');
$onboarding_hooks['rest_api_init']();
expect_onboarding(array_keys($onboarding_routes) === ['kodety/v1/onboarding/preference'], 'There must be no reset or user-targeted endpoint.');
$endpoints = $onboarding_routes['kodety/v1/onboarding/preference'];
expect_onboarding(array_column($endpoints, 'methods') === ['GET', 'POST'], 'Only read and preference updates are exposed.');
expect_onboarding($endpoints[1]['args']['preference']['enum'] === ['dismissed', 'started', 'completed', 'offered'], 'The request schema accepts a displayed invitation but rejects unseen/reset.');
expect_onboarding($endpoints[1]['args']['preference']['required'] === true, 'Preference is required.');

$request = new WP_REST_Request();
expect_onboarding($onboarding->client_config() === [
    'userId' => 11,
    'preference' => 'unseen',
    'preferenceUrl' => 'https://kodety.test/wp-json/kodety/v1/onboarding/preference',
], 'New accounts should receive their own unseen preference and endpoint.');
expect_onboarding_preference($onboarding->rest_preference($request), 'unseen');
expect_onboarding($onboarding_writes === [], 'Reading or rendering must never mark an invitation as accepted.');

$onboarding_user_id = 0;
expect_onboarding($onboarding->client_config() === null, 'Anonymous visitors must receive no personal configuration.');
expect_onboarding_error($onboarding->rest_preference($request), 401, 'Anonymous GET must fail.');
expect_onboarding_error($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'])), 401, 'Anonymous POST must fail.');
$onboarding_user_id = 11;
$onboarding_caps = ['read'];
expect_onboarding_error($onboarding->permission($request), 403, 'A subscriber without product access must be rejected.');
expect_onboarding($onboarding->client_config() === null, 'Accounts without builder access must receive no onboarding configuration.');
foreach (['kodety_edit', 'kodety_access_cms', 'kodety_view_analytics', 'kodety_view_members', 'manage_options'] as $capability) {
    $onboarding_caps = [$capability];
    expect_onboarding($onboarding->permission($request) === true, $capability . ' must allow saving a personal preference without workspace write access.');
}
$onboarding_caps = ['kodety_edit'];
Kodety_Sharing::$share = ['permission' => 'view'];
expect_onboarding_error($onboarding->permission($request), 403, 'A shared reader must not gain account preference access from share capabilities.');
expect_onboarding($onboarding->client_config() === null, 'Shared readers must receive no personal onboarding configuration.');
Kodety_Sharing::$share = ['permission' => 'edit'];
expect_onboarding_error($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'])), 403, 'Shared editors must not write personal onboarding preferences.');
Kodety_Sharing::$share = null;
expect_onboarding_error($onboarding->rest_preference(new WP_REST_Request([], [])), 403, 'Requests must carry a WordPress REST nonce.');
expect_onboarding_error($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'], ['X-WP-Nonce' => 'expired'])), 403, 'Invalid REST nonces must not write preferences.');
expect_onboarding($onboarding->permission(new WP_REST_Request(['_wpnonce' => 'valid-nonce'], [])) === true, 'The standard nonce query parameter is accepted.');

foreach (['unseen', 'reset', '', 'DISMISSED', 1, false, ['dismissed'], null] as $invalid) {
    expect_onboarding_error($onboarding->rest_save_preference(new WP_REST_Request(['preference' => $invalid])), 400, 'Invalid preferences and reset attempts must fail.');
}
foreach (['userId', 'user_id', 'id'] as $target_key) {
    expect_onboarding_error($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed', $target_key => 22])), 400, 'Clients must not select another user.');
    expect_onboarding_error($onboarding->rest_preference(new WP_REST_Request([$target_key => 22])), 400, 'Clients must not read another user.');
}
expect_onboarding($onboarding_writes === [], 'Denied, invalid and cross-user requests must not persist anything.');

expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'offered'])), 'offered');
expect_onboarding($onboarding->client_config()['preference'] === 'offered', 'An invitation already shown must not repeat after a new document bootstrap, even without an answer.');
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'started'])), 'started');
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'completed'])), 'completed');
$completed_write_count = count($onboarding_writes);
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'started'])), 'completed');
expect_onboarding(count($onboarding_writes) === $completed_write_count, 'Replaying a completed tour must not downgrade progress to started.');
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'])), 'dismissed');
$write_count = count($onboarding_writes);
foreach (['dismissed', 'started', 'completed', 'offered'] as $replay_preference) {
    expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => $replay_preference])), 'dismissed');
}
expect_onboarding(count($onboarding_writes) === $write_count, 'Manual replay, completion and retries must preserve a dismissed preference.');
expect_onboarding($onboarding->client_config()['preference'] === 'dismissed', 'Dismissal must survive a new document bootstrap.');

$onboarding_user_id = 22;
expect_onboarding_preference($onboarding->rest_preference($request), 'unseen');
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'started'])), 'started');
expect_onboarding(get_user_meta(11, '_kodety_builder_onboarding_preference', true) === 'dismissed', 'A second account must not clear the first account dismissal.');
expect_onboarding(get_user_meta(22, '_kodety_builder_onboarding_preference', true) === 'started', 'Choices must be independent per account.');
$onboarding_racing_dismissal = true;
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'completed'])), 'dismissed');
expect_onboarding(get_user_meta(22, '_kodety_builder_onboarding_preference', true) === 'dismissed', 'An in-flight completion must preserve another tab dismissal.');

$onboarding_user_id = 33;
$onboarding_fail_write = true;
$failed_write_attempts = $onboarding_write_attempts;
expect_onboarding_error($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'])), 500, 'A storage failure must not claim that a preference was saved.');
expect_onboarding($onboarding_write_attempts - $failed_write_attempts === 3, 'Failed persistence must use at most three bounded attempts.');
expect_onboarding_preference($onboarding->rest_preference($request), 'unseen');
$onboarding_fail_write = false;
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'])), 'dismissed');
expect_onboarding(!isset($onboarding_meta[0]), 'No anonymous preference record may be written.');

$onboarding_user_id = 44;
$onboarding_before_add = static function (int $user_id, string $key): void {
    $GLOBALS['onboarding_meta'][$user_id][$key] = ['dismissed'];
};
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'started'])), 'dismissed');
expect_onboarding(get_user_meta(44, '_kodety_builder_onboarding_preference', false) === ['dismissed'], 'The first started request must not overwrite a refusal inserted after its read.');

$onboarding_user_id = 55;
$onboarding_after_unique_check = static function (int $user_id, string $key): void {
    $GLOBALS['onboarding_meta'][$user_id][$key] = ['dismissed'];
};
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'started'])), 'dismissed');
expect_onboarding(get_user_meta(55, '_kodety_builder_onboarding_preference', false) === ['dismissed', 'started'], 'Concurrent initial inserts should model the real WordPress duplicate-row race.');
expect_onboarding_preference($onboarding->rest_preference($request), 'dismissed');

$onboarding_user_id = 66;
$onboarding_after_unique_check = static function (int $user_id, string $key): void {
    $GLOBALS['onboarding_meta'][$user_id][$key] = ['started'];
};
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'])), 'dismissed');
expect_onboarding(get_user_meta(66, '_kodety_builder_onboarding_preference', false) === ['started', 'dismissed'], 'Dismissal must win when the lower-priority row was inserted first too.');
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'completed'])), 'dismissed');
expect_onboarding($onboarding->client_config()['preference'] === 'dismissed', 'Document bootstrap must resolve duplicate usermeta rows by priority.');

$onboarding_user_id = 77;
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'started'])), 'started');
$onboarding_before_update = static function (int $user_id, string $key): void {
    $GLOBALS['onboarding_meta'][$user_id][$key] = ['completed'];
};
expect_onboarding_preference($onboarding->rest_save_preference(new WP_REST_Request(['preference' => 'dismissed'])), 'dismissed');
expect_onboarding(get_user_meta(77, '_kodety_builder_onboarding_preference', false) === ['dismissed'], 'Refusal must retry against a concurrent completion instead of losing a failed comparison.');

$expired_nonce = $onboarding->permission(new WP_REST_Request([], ['X-WP-Nonce' => 'expired']));
expect_onboarding($expired_nonce instanceof WP_Error && $expired_nonce->get_error_code() === 'rest_cookie_invalid_nonce', 'Expired nonces must use the code recognized by the global session refresh wrapper.');

echo "Builder onboarding runtime tests passed: authentication, nonce, shared access, validation, account isolation, persistence and sticky dismissal.\n";
