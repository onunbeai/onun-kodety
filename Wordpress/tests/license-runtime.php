<?php
/** Open-source capability and authorization regression tests. */
define('ABSPATH', '/tmp/onun-kodety-wordpress/');
$GLOBALS['onun_routes'] = [];
$GLOBALS['onun_hooks'] = [];
$GLOBALS['onun_logged_in'] = false;
$GLOBALS['onun_can_edit'] = false;
$GLOBALS['onun_localization'] = false;
$GLOBALS['onun_removed_options'] = [];
class WP_Error {
    public function __construct(public string $code, public string $message, public array $data = []) {}
}
class WP_REST_Response {
    public array $headers = [];
    public function __construct(public mixed $data) {}
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
}
function add_action($hook, $callback, ...$args): void { $GLOBALS['onun_hooks'][] = $hook; }
function register_rest_route($namespace, $route, $options): void { $GLOBALS['onun_routes'][$route] = $options; }
function rest_ensure_response($value) { return new WP_REST_Response($value); }
function is_user_logged_in(): bool { return $GLOBALS['onun_logged_in']; }
function current_user_can($capability): bool { return $GLOBALS['onun_can_edit'] && $capability === 'edit_posts'; }
function apply_filters($hook, $value, ...$args) { return $hook === 'kodety_localization_extension_enabled' ? $GLOBALS['onun_localization'] : $value; }
function wp_clear_scheduled_hook($hook): void { $GLOBALS['onun_cleared_hook'] = $hook; }
function delete_option($name): void { $GLOBALS['onun_removed_options'][] = $name; }
function wp_safe_remote_post(...$args): never { throw new RuntimeException('The open source adapter must never contact a license service.'); }
function wp_remote_post(...$args): never { throw new RuntimeException('The open source adapter must never contact a license service.'); }
function check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
require_once __DIR__ . '/../kodety/includes/class-kodety-edition.php';
require_once __DIR__ . '/../kodety/includes/class-kodety-license.php';
$license = Kodety_License::instance();
check($GLOBALS['onun_hooks'] === ['rest_api_init'], 'No license validation, cron or commercial admin hooks may be registered.');
check($license->is_active() && $license->public_status()['valid'], 'Features must work without an activation key.');
check($license->public_status()['expiresAt'] === '' && !$license->public_status()['isTrial'], 'Access must not expire or run as a trial.');
check(Kodety_Edition::has('mcp') && Kodety_Edition::has('ai') && Kodety_Edition::has('advancedSeo'), 'Editor integrations and advanced features must be available.');
check(!Kodety_Edition::has('localization'), 'An uninstalled localization extension must not be advertised as installed.');
$GLOBALS['onun_localization'] = true;
check(Kodety_Edition::has('localization'), 'Installed localization must be available.');
check(!Kodety_Edition::has('unknown-feature'), 'Unknown capabilities must not be advertised.');
check(count(Kodety_Edition::visible_collection_definitions(array_fill(0, 100, ['slug' => 'collection']))) === 100, 'Collections must not be truncated by a paid limit.');
foreach (Kodety_Edition::limits() as $value) check($value === null, 'Commercial limits must be unlimited.');
check(Kodety_Edition::collection_limit_error([]) === null && Kodety_Edition::item_limit_error('post') === null, 'Collections and items must not require a subscription.');
$source = '<html><head><meta property="og:title" content="My project"></head><body data-kodety-cookie-consent="runtime"></body></html>';
check($license->strip_unlicensed_advanced_features($source) === $source, 'Published features must not be stripped.');
check($license->inject_unlicensed_branding($source) === $source, 'Published content must not receive a commercial watermark.');
check($license->activate('') ['valid'] && $license->deactivate()['valid'] && $license->check(true)['valid'], 'Legacy activation calls must not lock the open source editor.');
check(in_array('kodety_license_state', $GLOBALS['onun_removed_options'], true), 'Old activation credentials must be cleared.');
check($GLOBALS['onun_cleared_hook'] === 'kodety_license_check', 'Old periodic validation must be cleared.');
$license->register_rest_routes();
check(array_keys($GLOBALS['onun_routes']) === ['/license/runtime'], 'Commercial activation endpoints must be absent.');
$route = $GLOBALS['onun_routes']['/license/runtime'];
check(!$route['permission_callback'](), 'Anonymous access to the capability endpoint must be denied.');
$GLOBALS['onun_logged_in'] = true;
check(!$route['permission_callback'](), 'A logged-in user without editing rights must be denied.');
$GLOBALS['onun_can_edit'] = true;
check($route['permission_callback'](), 'An authorized editor must retain access.');
$response = $route['callback']();
check($response->headers['Cache-Control'] === 'private, no-store, max-age=0', 'Capability responses must not be shared in a public cache.');
check($response->data['upgradeUrl'] === '' && $response->data['licenseUrl'] === '' && $response->data['licensePlan'] === '', 'No checkout or paid plan may be exposed.');
echo "Onun Kodety open-source capabilities and WordPress authorization: OK\n";
