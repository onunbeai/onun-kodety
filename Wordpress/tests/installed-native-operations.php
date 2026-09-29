<?php

/** Run only after installing the candidate ZIP into disposable WordPress:
 * wp --path=/tmp/kodety-stability-wp-... --user=1 eval-file Wordpress/tests/installed-native-operations.php
 * Uses the actual REST server, permissions, native leases and CMS writers.
 * All fixtures are isolated and removed in finally; no credentials are read.
 */
if (!defined('WP_CLI') || !WP_CLI) { http_response_code(404); exit; }
if (wp_get_environment_type() !== 'local'
    || !str_starts_with(basename(rtrim((string) ABSPATH, '/')), 'kodety-stability-wp-')
    || !str_starts_with((string) DB_NAME, 'kodety_stability_')
    || wp_parse_url(home_url(), PHP_URL_HOST) !== '127.0.0.1') {
    throw new RuntimeException('Native operation smoke requires a disposable local WordPress/database and loopback URL.');
}
if (!class_exists('Kodety_Native_Operations') || !current_user_can('manage_options')) {
    throw new RuntimeException('Install the candidate ZIP and execute as the disposable administrator.');
}

// WP-CLI evaluates this file inside its command method. Bind fixture state to
// the same globals used by the helpers instead of creating method-local copies.
global $native_installed_admin_id, $native_installed_scope, $native_installed_options,
    $native_installed_session, $native_installed_lease,
    $native_installed_second_session, $native_installed_second_lease,
    $native_installed_user_id, $native_installed_post_ids,
    $native_installed_collection, $native_installed_report;

$native_installed_admin_id = get_current_user_id();
$native_installed_scope = 'native_smoke_' . bin2hex(random_bytes(5));
$native_installed_options = [];
foreach (['kodety_workspace_project_id', 'kodety_editor_lock', 'kodety_project_shares', 'kodety_mcp_activity', 'kodety_mcp_activity_events', 'kodety_mcp_revision', 'kodety_mcp_last_change'] as $name) {
    $missing = new stdClass();
    $value = get_option($name, $missing);
    $native_installed_options[$name] = ['exists' => $value !== $missing, 'value' => $value];
}
$native_installed_session = 'native-smoke-session-' . bin2hex(random_bytes(8));
$native_installed_lease = 'native-smoke-lease-' . bin2hex(random_bytes(8));
$native_installed_second_session = 'native-smoke-second-' . bin2hex(random_bytes(8));
$native_installed_second_lease = 'native-smoke-lease2-' . bin2hex(random_bytes(8));
$native_installed_user_id = 0;
$native_installed_post_ids = [];
$native_installed_collection = '';
$native_installed_report = [
    'version' => KODETY_VERSION,
    'wordpress' => get_bloginfo('version'),
    'catalogSha256' => hash_file('sha256', KODETY_DIR . 'agent-runtime/native-operations.json'),
    'serviceSha256' => hash_file('sha256', KODETY_DIR . 'includes/class-kodety-native-operations.php'),
    'mcpScope' => 'Installed protocol handler and real WordPress schema validation under the test administrator; this does not claim licensed bearer authentication.',
    'steps' => [],
    'status' => 'running',
];

function native_installed_check(bool $condition, string $name): void {
    global $native_installed_report;
    $native_installed_report['steps'][] = ['name' => $name, 'status' => $condition ? 'passed' : 'failed'];
    if (!$condition) throw new RuntimeException($name);
}
function native_installed_call(string $operation, array $arguments = [], bool $lease = true): WP_REST_Response {
    global $native_installed_session, $native_installed_lease;
    $request = new WP_REST_Request('POST', '/kodety/v1/automation/call');
    $request->set_header('Content-Type', 'application/json');
    $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
    if ($lease) {
        $request->set_header('X-Kodety-Editor-Session', $native_installed_session);
        $request->set_header('X-Kodety-Editor-Lease', $native_installed_lease);
    }
    $request->set_body(wp_json_encode(['operation' => $operation, 'arguments' => (object) $arguments]));
    return rest_ensure_response(rest_do_request($request));
}
function native_installed_data(string $operation, array $arguments = [], bool $lease = true): array {
    $response = native_installed_call($operation, $arguments, $lease);
    if ($response->get_status() >= 400) {
        $data = $response->get_data();
        throw new RuntimeException($operation . ': HTTP ' . $response->get_status() . ' ' . ($data['code'] ?? 'unknown'));
    }
    return (array) $response->get_data();
}
function native_installed_revision(): string {
    return (string) native_installed_data('cms_schema')['revision'];
}
function native_installed_protocol(string $method, array $params = []): array {
    global $native_installed_session, $native_installed_lease;
    $request = new WP_REST_Request('POST', '/kodety/v1/mcp');
    $request->set_header('Content-Type', 'application/json');
    $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
    $request->set_header('X-Kodety-Editor-Session', $native_installed_session);
    $request->set_header('X-Kodety-Editor-Lease', $native_installed_lease);
    $request->set_body(wp_json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => (object) $params]));
    return Kodety_MCP::instance()->execute_remote_protocol($request)->get_data();
}

try {
    // This scope has no prior CMS definitions. The preexisting workspace and
    // editor lock table are snapshotted above and restored after the smoke.
    update_option('kodety_workspace_project_id', $native_installed_scope, false);
    update_option('kodety_editor_lock', [], false);
    $discovery = rest_do_request(new WP_REST_Request('GET', '/kodety/v1/automation/tools'));
    native_installed_check($discovery->get_status() === 200
        && $discovery->get_data() === Kodety_Native_Operations::catalog(), 'Installed HTTP/PHP catalogs agree');
    $initialize = native_installed_protocol('initialize');
    native_installed_check(($initialize['result']['serverInfo']['version'] ?? '') === KODETY_VERSION, 'MCP initialize reports the installed plugin version');
    $mcp_tools = native_installed_protocol('tools/list')['result']['tools'] ?? [];
    $mcp_tools = array_column($mcp_tools, null, 'name');
    native_installed_check(isset($mcp_tools['kodety_native_call'], $mcp_tools['kodety_native_catalog'], $mcp_tools['kodety_upsert_content'])
        && in_array('arguments', $mcp_tools['kodety_native_call']['inputSchema']['required'], true)
        && isset($mcp_tools['kodety_upsert_content']['inputSchema']['properties']['expectedRevision']), 'Installed MCP advertises native and alias schemas with revision contracts');
    $mcp_catalog = native_installed_protocol('tools/call', ['name' => 'kodety_native_catalog', 'arguments' => (object) []]);
    native_installed_check(($mcp_catalog['result']['isError'] ?? true) === false
        && count($mcp_catalog['result']['structuredContent']['result']['operations'] ?? []) >= 35, 'Real WordPress validator accepts empty MCP catalog arguments');
    $mcp_missing = native_installed_protocol('tools/call', ['name' => 'kodety_native_call', 'arguments' => ['operation' => 'cms_schema']]);
    native_installed_check(($mcp_missing['result']['isError'] ?? false) === true
        && ($mcp_missing['result']['structuredContent']['error']['status'] ?? 0) === 400, 'Real WordPress validator rejects required MCP arguments with status 400');

    $lease = native_installed_data('editor_lock_acquire', ['sessionId' => $native_installed_session, 'leaseId' => $native_installed_lease], false);
    native_installed_check(($lease['mode'] ?? '') === 'edit', 'Native lease acquired through the operation route');
    $busy = native_installed_data('editor_lock_acquire', ['sessionId' => $native_installed_second_session, 'leaseId' => $native_installed_second_lease], false);
    native_installed_check(($busy['mode'] ?? '') === 'view' && ($busy['limited'] ?? false) === true, 'Second real native lease remains read-only while occupied');
    $denied = native_installed_call('cms_create_collection', ['name' => 'Blocked', 'expectedRevision' => native_installed_revision(), 'context' => ['editorSession' => $native_installed_second_session, 'editorLease' => $native_installed_second_lease]], false);
    native_installed_check($denied->get_status() === 423 && ($denied->get_data()['code'] ?? '') === 'kodety_editor_lock_required', 'Native write requires ownership of the editor lease');
    $share_setup = new WP_REST_Request('POST', '/kodety/v1/sharing');
    $share_setup->set_header('Content-Type', 'application/json');
    $share_setup->set_body(wp_json_encode(['permission' => 'view', 'enabled' => true, 'authRequired' => false, 'regenerate' => true]));
    Kodety_Sharing::instance()->save_share($share_setup);
    $share_token = get_option('kodety_project_shares')[Kodety_Sharing::current_project_id()]['token'];
    $view_read = new WP_REST_Request('POST', '/kodety/v1/automation/call');
    $view_read->set_header('Content-Type', 'application/json');
    $view_read->set_header('X-Kodety-Share', $share_token);
    $view_read->set_header('X-Kodety-Editor-Session', 'view-only-no-lease-123456');
    $view_read->set_body(wp_json_encode(['operation' => 'cms_schema', 'arguments' => (object) []]));
    native_installed_check(rest_do_request($view_read)->get_status() === 200, 'View-only share can read a native operation through POST without editor lease');
    $view_read->set_body(wp_json_encode(['operation' => 'cms_create_collection', 'arguments' => ['name' => 'Forbidden', 'expectedRevision' => native_installed_revision()]]));
    $view_write = rest_do_request($view_read);
    native_installed_check($view_write->get_status() === 403
        && ($view_write->get_data()['code'] ?? '') === 'kodety_share_read_only', 'View-only share cannot mutate through the native wrapper');
    $unknown = native_installed_call('cms_schema', ['url' => '/wp/v2/users']);
    native_installed_check($unknown->get_status() === 400, 'Installed adapter rejects unknown parameters');

    $collection = native_installed_data('cms_create_collection', ['name' => 'Native smoke', 'singular' => 'Native item', 'slug' => 'ns' . bin2hex(random_bytes(4)), 'expectedRevision' => native_installed_revision()]);
    $native_installed_collection = (string) $collection['slug'];
    native_installed_check(str_starts_with($native_installed_collection, 'kodety_'), 'Create native collection with schema revision');
    $fields = native_installed_data('cms_update_fields', ['post_type' => $native_installed_collection, 'expectedRevision' => native_installed_revision(), 'fields' => [['name' => 'summary', 'label' => 'Summary', 'type' => 'text', 'required' => true]]]);
    $read_fields = native_installed_data('cms_get_fields', ['post_type' => $native_installed_collection]);
    native_installed_check(($read_fields['fields'][0]['name'] ?? '') === 'summary', 'Native field schema persists and reads back');
    $item = native_installed_data('cms_create_item', ['post_type' => $native_installed_collection, 'expectedRevision' => native_installed_revision(), 'values' => ['title' => 'Native draft', 'field:summary' => 'First summary']]);
    $native_installed_post_ids[] = (int) $item['id'];
    native_installed_check($item['status'] === 'draft'
        && get_post_meta($item['id'], '_kodety_project_id', true) === $native_installed_scope, 'CMS item defaults to draft and persists current project scope');
    $updated = native_installed_data('cms_update_item', ['post_type' => $native_installed_collection, 'post_id' => (int) $item['id'], 'expectedRevision' => $item['revision'], 'values' => ['title' => 'Updated draft', 'field:summary' => 'Updated summary']]);
    native_installed_check($updated['values']['title'] === 'Updated draft' && $updated['values']['field:summary'] === 'Updated summary', 'Native item update persists requested fields');
    $stale = native_installed_call('cms_update_item', ['post_type' => $native_installed_collection, 'post_id' => (int) $item['id'], 'expectedRevision' => $item['revision'], 'values' => ['title' => 'Stale overwrite']]);
    native_installed_check($stale->get_status() === 409 && ($stale->get_data()['code'] ?? '') === 'kodety_revision_conflict', 'Stale item revision is rejected by the native transaction');
    $import = native_installed_data('cms_import_items', ['post_type' => $native_installed_collection, 'expectedRevision' => native_installed_revision(), 'items' => [['values' => ['title' => 'Import 1', 'field:summary' => 'One']], ['values' => ['title' => 'Import 2', 'field:summary' => 'Two']]]]);
    foreach ($import['items'] as $imported) $native_installed_post_ids[] = (int) $imported['id'];
    native_installed_check($import['imported'] === 2
        && array_reduce($import['items'], static fn(bool $ok, array $entry): bool => $ok && get_post_status($entry['id']) === 'draft', true), 'Native import creates two confirmed draft rows');
    $failed_import = native_installed_call('cms_import_items', ['post_type' => $native_installed_collection, 'expectedRevision' => native_installed_revision(), 'items' => [['values' => ['title' => 'Must roll back', 'field:summary' => 'Valid']], ['values' => ['title' => 'Invalid row']]]]);
    $list = native_installed_data('cms_list_items', ['post_type' => $native_installed_collection]);
    native_installed_check($failed_import->get_status() === 400
        && ($failed_import->get_data()['data']['rollbackFailed'] ?? null) === false
        && $list['total'] === 3, 'Native failed import rolls back earlier rows and reports failure');

    update_post_meta($item['id'], '_kodety_project_id', $native_installed_scope . '_other');
    $outside = native_installed_call('cms_get_item', ['post_type' => $native_installed_collection, 'post_id' => (int) $item['id']]);
    native_installed_check($outside->get_status() === 404, 'Sibling project item cannot be read through automation');
    update_post_meta($item['id'], '_kodety_project_id', $native_installed_scope);
    $definitions = Kodety_Plugin::instance()->project_cms_option('kodety_collections', []);
    $readonly = $definitions;
    $readonly[0]['readOnly'] = true;
    native_installed_check(Kodety_Plugin::instance()->update_project_cms_option('kodety_collections', $readonly, $definitions), 'Readonly collection fixture acknowledged');
    $readonly_item = native_installed_data('cms_get_item', ['post_type' => $native_installed_collection, 'post_id' => (int) $item['id']]);
    $readonly_write = native_installed_call('cms_update_item', ['post_type' => $native_installed_collection, 'post_id' => (int) $item['id'], 'expectedRevision' => $readonly_item['revision'], 'values' => ['title' => 'Forbidden']]);
    native_installed_check($readonly_write->get_status() === 403, 'Native readonly collection refuses mutations');
    native_installed_check(Kodety_Plugin::instance()->update_project_cms_option('kodety_collections', $definitions, $readonly), 'Readonly fixture restored');

    $native_installed_user_id = wp_create_user('native_smoke_' . bin2hex(random_bytes(5)), wp_generate_password(32), 'native-smoke-' . bin2hex(random_bytes(5)) . '@example.test');
    if (is_wp_error($native_installed_user_id)) throw new RuntimeException('Could not create disposable permission fixture.');
    (new WP_User((int) $native_installed_user_id))->set_role('subscriber');
    wp_set_current_user((int) $native_installed_user_id);
    $unauthorized = native_installed_call('cms_schema', [], false);
    native_installed_check($unauthorized->get_status() === 403, 'Logged-in subscriber remains denied by native CMS capability');
    wp_set_current_user($native_installed_admin_id);

    $meta = native_installed_data('meta_capi_get');
    native_installed_check(isset($meta['configured'])
        && !array_key_exists('accessToken', $meta)
        && !array_key_exists('access_token', $meta), 'Installed Meta settings expose configuration metadata without tokens');
    $mcp_read = native_installed_protocol('tools/call', ['name' => 'kodety_get_content', 'arguments' => ['id' => (int) $item['id']]]);
    native_installed_check(($mcp_read['result']['isError'] ?? true) === false, 'Installed MCP CMS read alias uses the native scoped item route');
    $mcp_item = $mcp_read['result']['structuredContent']['result'];
    $mcp_update = native_installed_protocol('tools/call', ['name' => 'kodety_upsert_content', 'arguments' => ['id' => (int) $item['id'], 'expectedRevision' => $mcp_item['revision'], 'title' => 'Updated by MCP']]);
    native_installed_check(($mcp_update['result']['isError'] ?? true) === false
        && get_post_field('post_title', $item['id']) === 'Updated by MCP', 'Installed MCP CMS alias validates and persists with a native item revision');
    $mcp_conflict = native_installed_protocol('tools/call', ['name' => 'kodety_upsert_content', 'arguments' => ['id' => (int) $item['id'], 'expectedRevision' => $mcp_item['revision'], 'title' => 'Stale MCP change']]);
    native_installed_check(($mcp_conflict['result']['isError'] ?? false) === true
        && ($mcp_conflict['result']['structuredContent']['error']['status'] ?? 0) === 409
        && ($mcp_conflict['result']['structuredContent']['error']['code'] ?? '') === 'kodety_revision_conflict', 'Installed MCP CMS alias retains native stale revision status and code');
    $empty_only = native_installed_call('cms_delete_collection', ['post_type' => $native_installed_collection, 'confirmation' => $native_installed_collection, 'deleteItems' => false, 'expectedRevision' => native_installed_revision()]);
    native_installed_check($empty_only->get_status() === 409, 'Collection deletion cannot cascade into existing content');
    $fresh = native_installed_data('cms_get_item', ['post_type' => $native_installed_collection, 'post_id' => (int) $item['id']]);
    $deleted = native_installed_data('cms_delete_item', ['post_type' => $native_installed_collection, 'post_id' => (int) $item['id'], 'expectedRevision' => $fresh['revision']]);
    native_installed_check($deleted['status'] === 'trash' && get_post_status($item['id']) === 'trash', 'Native deletion confirms the item moved to trash');
    // Permanent deletion here cleans up this test's disposable records only.
    // The operation exposed to users above retains normal native trash semantics.
    foreach ($native_installed_post_ids as $id) wp_delete_post($id, true);
    $native_installed_post_ids = [];
    $deleted_collection = native_installed_data('cms_delete_collection', ['post_type' => $native_installed_collection, 'confirmation' => $native_installed_collection, 'deleteItems' => false, 'expectedRevision' => native_installed_revision()]);
    native_installed_check($deleted_collection['deleted'] === $native_installed_collection, 'Native deletion removes the now-empty fixture collection');
    $native_installed_report['status'] = 'passed';
} catch (Throwable $error) {
    $native_installed_report['status'] = 'failed';
    $native_installed_report['error'] = $error->getMessage();
} finally {
    wp_set_current_user($native_installed_admin_id);
    foreach ($native_installed_post_ids as $id) wp_delete_post($id, true);
    if (is_int($native_installed_user_id) && $native_installed_user_id > 0) {
        require_once ABSPATH . 'wp-admin/includes/user.php';
        wp_delete_user((int) $native_installed_user_id);
    }
    foreach (['kodety_collections', 'kodety_field_definitions', 'kodety_cms_templates'] as $option) {
        delete_option($option . '__project_' . $native_installed_scope);
    }
    foreach ($native_installed_options as $option => $snapshot) {
        if ($snapshot['exists']) update_option($option, $snapshot['value'], false);
        else delete_option($option);
    }
    $native_installed_report['fixturesCleaned'] = true;
}
WP_CLI::line(wp_json_encode($native_installed_report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
if ($native_installed_report['status'] !== 'passed') WP_CLI::halt(1);
