<?php
/** Installed API smoke; only the caller's disposable stability fixture is edited. */
if (!defined('WP_CLI') || !WP_CLI) { http_response_code(404); exit; }
if (wp_get_environment_type() !== 'local'
    || !str_starts_with(basename(rtrim(ABSPATH, '/')), 'kodety-stability-wp-')
    || !str_starts_with(DB_NAME, 'kodety_stability_')
    || wp_parse_url(home_url(), PHP_URL_HOST) !== '127.0.0.1'
    || !current_user_can('manage_options')) throw new RuntimeException('Disposable administrator guard failed.');
$archive = (string) getenv('KODETY_TEST_LOCALIZATION_ZIP');
$expected_hash = (string) getenv('KODETY_TEST_LOCALIZATION_SHA256');
$backup_path = (string) getenv('KODETY_TEST_LOCALIZATION_BACKUP');
if (!preg_match('/^[a-f0-9]{64}$/', $expected_hash) || hash_file('sha256', $archive) !== $expected_hash) {
    throw new RuntimeException('Explicit localization ZIP SHA-256 does not match.');
}
$backup_root = realpath(dirname($backup_path));
if (!$backup_root || str_starts_with($backup_root . '/', ABSPATH) || file_exists($backup_path)) {
    throw new RuntimeException('Use a new private backup file outside the served WordPress.');
}
$plugin = Kodety_Plugin::instance();
$manager = Kodety_Extensions::instance();
$workspace = (new ReflectionMethod(Kodety_Plugin::class, 'workspace_dir'))->invoke($plugin);
$metadata_path = $workspace . '/.incode/project.json';
$original = file_get_contents($metadata_path);
$metadata = json_decode((string) $original, true);
if (!is_string($original) || is_link($metadata_path) || ($metadata['projectId'] ?? '') !== 'kst-stability-small') {
    throw new RuntimeException('Only the pre-staged kst-stability-small fixture can be tested.');
}
$options = [];
foreach (['kodety_extensions_registry', 'kodety_extension_settings', 'kodety_editor_lock', 'kodety_workspace_revision', 'kodety_draft_updated_at'] as $name) {
    $missing = new stdClass();
    $value = get_option($name, $missing);
    $options[$name] = ['exists' => $value !== $missing, 'value' => $value === $missing ? null : $value];
}
$backup = wp_json_encode(['metadataBase64' => base64_encode($original), 'options' => $options]);
$handle = fopen($backup_path, 'x');
if (!$handle) throw new RuntimeException('Could not create the private fixture backup.');
chmod($backup_path, 0600);
if (fwrite($handle, $backup) !== strlen($backup)) throw new RuntimeException('Could not persist the complete private fixture backup.');
fclose($handle);
$previous_extension = $manager->get('kodety-localization');
$report = [
    'coreVersion' => KODETY_VERSION, 'extensionZipSha256' => $expected_hash,
    'licenseActive' => Kodety_License::instance()->is_active(),
    'previousExtension' => $previous_extension ? array_intersect_key($previous_extension, array_flip(['slug', 'version', 'active', 'installed'])) : null,
    'backupSaved' => true, 'status' => 'running', 'steps' => [], 'roundTripVerified' => false,
    'scope' => 'Real installed extension installer, activation and native REST localization. No license, permission or route filters are mocked.',
];
$session = 'localization-smoke-' . bin2hex(random_bytes(8));
$lease_id = 'localization-lease-' . bin2hex(random_bytes(8));
$last_metadata_hash = hash('sha256', $original);
$wrote = false;
$lease_acquired = false;
$check = static function (bool $condition, string $label) use (&$report): void {
    $report['steps'][] = ['name' => $label, 'status' => $condition ? 'passed' : 'failed'];
    if (!$condition) throw new RuntimeException($label);
};
$call = static function (string $operation, array $arguments = [], bool $with_lease = true) use ($session, $lease_id): WP_REST_Response {
    $request = new WP_REST_Request('POST', '/kodety/v1/automation/call');
    $request->set_header('Content-Type', 'application/json');
    $request->set_header('X-WP-Nonce', wp_create_nonce('wp_rest'));
    if ($with_lease) {
        $request->set_header('X-Kodety-Editor-Session', $session);
        $request->set_header('X-Kodety-Editor-Lease', $lease_id);
    }
    $request->set_body(wp_json_encode(['operation' => $operation, 'arguments' => (object) $arguments]));
    return rest_ensure_response(rest_do_request($request));
};
try {
    $installed = $manager->install_zip($archive);
    if (is_wp_error($installed)) throw new RuntimeException('Install failed: ' . $installed->get_error_code());
    $check(count($installed['installed'] ?? []) === 1, 'Native extension ZIP installer acknowledged one extension');
    $activated = $manager->activate_extension('kodety-localization');
    if (is_wp_error($activated)) {
        $report['status'] = 'blocked';
        $report['gate'] = ['code' => $activated->get_error_code(), 'data' => $activated->get_error_data()];
        throw new RuntimeException('Native activation blocked: ' . $activated->get_error_code());
    }
    $extension = $manager->get('kodety-localization');
    $report['extension'] = array_intersect_key($extension, array_flip(['slug', 'version', 'active', 'installed']));
    $check($manager->is_active('kodety-localization') && ($extension['version'] ?? '') === KODETY_VERSION, 'Extension version matches core and native activation is confirmed');
    $check(apply_filters('kodety_localization_extension_enabled', false) === true, 'The installed extension enables its real localization contract');
    $lease = $call('editor_lock_acquire', ['sessionId' => $session, 'leaseId' => $lease_id], false);
    if (($lease->get_data()['mode'] ?? '') !== 'edit') {
        $report['status'] = 'blocked';
        throw new RuntimeException('The native editor lease is occupied; existing editor was preserved.');
    }
    $lease_acquired = true;
    $read = $call('localization_get');
    $check($read->get_status() === 200 && is_int($read->get_data()['workspaceRevision'] ?? null), 'Native localization read returns an installed workspace revision');
    $before = $read->get_data();
    $localization = is_array($before['localization']) ? $before['localization'] : [
        'version' => 3, 'sourceLocale' => 'en-US', 'defaultLocale' => 'en-US',
        'automaticLocale' => true, 'rememberLocale' => true, 'translatePagePaths' => false, 'includePathsInAi' => false,
        'locales' => [['code' => 'en-US', 'name' => 'English (US)', 'slug' => '', 'enabled' => true]], 'translations' => [],
    ];
    $localization['automaticLocale'] = !($localization['automaticLocale'] ?? true);
    if (!in_array('pt-BR', array_column($localization['locales'], 'code'), true)) {
        $localization['locales'][] = ['code' => 'pt-BR', 'name' => 'Português (Brasil)', 'slug' => 'pt-br', 'enabled' => true, 'fallback' => $localization['sourceLocale']];
    }
    $arguments = ['localization' => $localization, 'context' => ['expectedWorkspaceRevision' => $before['workspaceRevision']]];
    $write = $call('localization_update', $arguments);
    if (in_array($write->get_status(), [402, 403, 404], true)) {
        $report['status'] = 'blocked';
        $report['gate'] = ['code' => $write->get_data()['code'] ?? '', 'status' => $write->get_status()];
        throw new RuntimeException('Installed native localization gate blocked the write.');
    }
    $check($write->get_status() === 200 && ($write->get_data()['success'] ?? false) === true, 'Native localization update confirms persistence');
    $wrote = true;
    $last_metadata_hash = hash_file('sha256', $metadata_path);
    $after = $call('localization_get')->get_data();
    $check($after['localization'] === $localization && $after['workspaceRevision'] > $before['workspaceRevision'], 'Read after write retains the new locale and automatic-language setting');
    $stale = $call('localization_update', $arguments);
    $check($stale->get_status() === 409, 'A stale localization workspace revision is rejected');
    $report['roundTripVerified'] = true;
    $report['status'] = 'passed';
} catch (Throwable $error) {
    if ($report['status'] !== 'blocked') $report['status'] = 'failed';
    $report['error'] = $error->getMessage();
} finally {
    try {
        (new ReflectionMethod(Kodety_Plugin::class, 'with_workspace_lock'))->invoke($plugin, static function () use ($metadata_path, $original, $last_metadata_hash, $wrote, $options): void {
            if ($wrote) {
                if (hash_file('sha256', $metadata_path) !== $last_metadata_hash) throw new RuntimeException('Concurrent metadata change prevents fixture rollback.');
                if (file_put_contents($metadata_path, $original, LOCK_EX) !== strlen($original)) throw new RuntimeException('Fixture metadata rollback failed.');
            }
            foreach (['kodety_workspace_revision', 'kodety_draft_updated_at'] as $name) {
                if (!$wrote) continue;
                if ($options[$name]['exists']) update_option($name, $options[$name]['value'], false);
                else delete_option($name);
            }
        });
        if ($lease_acquired) $call('editor_lock_release', ['sessionId' => $session, 'leaseId' => $lease_id]);
        $report['fixtureRestored'] = hash_file('sha256', $metadata_path) === hash('sha256', $original);
        $report['extensionLeftActive'] = $manager->is_active('kodety-localization');
    } catch (Throwable $cleanup_error) {
        $report['status'] = 'failed';
        $report['cleanupError'] = $cleanup_error->getMessage();
    }
}
WP_CLI::line(wp_json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
if ($report['status'] === 'failed') WP_CLI::halt(1);
