<?php

defined('ABSPATH') || exit;

/**
 * Multi-language is opt-in. The core keeps the publication boundary stable,
 * while this separately installed extension owns whether localization routes,
 * authoring UI and localized output may run.
 */
add_filter('kodety_localization_extension_enabled', '__return_true');

$kodety_localization_manifest_entry = static function (): array {
    $manifest_file = __DIR__ . '/assets/manifest.json';
    if (!is_file($manifest_file) || is_link($manifest_file)) return [];
    $manifest = json_decode((string) file_get_contents($manifest_file), true);
    $entry = is_array($manifest) ? ($manifest['Wordpress/editor/localization-main.tsx'] ?? null) : null;
    return is_array($entry) ? $entry : [];
};

$kodety_localization_style_file = static function () use ($kodety_localization_manifest_entry): string {
    $entry = $kodety_localization_manifest_entry();
    $styles = is_array($entry['css'] ?? null) ? $entry['css'] : [];
    $manifest_file = __DIR__ . '/assets/manifest.json';
    $manifest = is_file($manifest_file)
        ? json_decode((string) file_get_contents($manifest_file), true)
        : null;
    $single_style = is_array($manifest) && is_array($manifest['style.css'] ?? null)
        ? trim((string) ($manifest['style.css']['file'] ?? ''))
        : '';
    if ($single_style !== '') $styles[] = $single_style;
    $assets_root = realpath(__DIR__ . '/assets');
    if ($assets_root === false) return '';
    foreach ($styles as $style) {
        $relative = str_replace('\\', '/', trim((string) $style));
        if ($relative === '' || str_contains($relative, '..') || !str_ends_with(strtolower($relative), '.css')) continue;
        $candidate = realpath($assets_root . '/' . ltrim($relative, '/'));
        if ($candidate === false || !str_starts_with($candidate, $assets_root . DIRECTORY_SEPARATOR)) continue;
        if (is_file($candidate) && !is_link($candidate)) return $candidate;
    }
    return '';
};

$kodety_localization_preload_files = static function () use ($kodety_localization_manifest_entry): array {
    $manifest_file = __DIR__ . '/assets/manifest.json';
    if (!is_file($manifest_file) || is_link($manifest_file)) return [];
    $manifest = json_decode((string) file_get_contents($manifest_file), true);
    if (!is_array($manifest)) return [];
    $entry = $kodety_localization_manifest_entry();
    $dynamic_imports = is_array($entry['dynamicImports'] ?? null) ? $entry['dynamicImports'] : [];
    $files = [];
    foreach ($dynamic_imports as $import_key) {
        $import = $manifest[(string) $import_key] ?? null;
        // Only the workspace is needed on entry. Optional guides must remain
        // lazy, including when the user has already declined onboarding.
        if (!is_array($import) || ($import['name'] ?? '') !== 'WordPressLocalizationWorkspace') continue;
        $relative = str_replace('\\', '/', trim((string) ($import['file'] ?? '')));
        if (
            $relative === ''
            || str_starts_with($relative, '/')
            || str_contains($relative, '..')
            || !str_ends_with(strtolower($relative), '.js')
        ) continue;
        $files[] = $relative;
    }
    return array_values(array_unique($files));
};

$kodety_localization_asset_file = static function (string $relative, array $extensions): string {
    $relative = str_replace('\\', '/', trim($relative));
    if ($relative === '' || str_starts_with($relative, '/') || str_contains($relative, '..')) return '';
    $extension = strtolower((string) pathinfo($relative, PATHINFO_EXTENSION));
    if (!in_array($extension, $extensions, true)) return '';
    $assets_root = realpath(__DIR__ . '/assets');
    if ($assets_root === false) return '';
    $candidate = realpath($assets_root . '/' . $relative);
    if ($candidate === false || !str_starts_with($candidate, $assets_root . DIRECTORY_SEPARATOR)) return '';
    return is_file($candidate) && !is_link($candidate) ? $candidate : '';
};

// Every ESM edge must resolve to one byte-identical URL. Browsers key modules
// by their complete URL, including query order and encoding, so an equivalent
// URL assembled in another order would create a second workspace/store.
$kodety_localization_private_asset_url = static function (
    string $action,
    array $arguments = [],
    string $relative = ''
): string {
    $url = admin_url('admin-ajax.php?action=' . $action);
    foreach (['kodety_share_token', 'ver'] as $argument) {
        $value = $arguments[$argument] ?? '';
        if (!is_string($value)) continue;
        $value = trim($value);
        if ($value !== '') $url = add_query_arg($argument, $value, $url);
    }
    if ($relative !== '') $url = add_query_arg('file', $relative, $url);
    return $url;
};

$kodety_localization_asset_version = static function (string $entry): string {
    $entry_hash = is_file($entry) ? hash_file('sha256', $entry) : false;
    $rewrite_hash = hash_file('sha256', __FILE__);
    if (!is_string($entry_hash) || !is_string($rewrite_hash)) return '';
    // Include both emitted code and delivery semantics. The endpoint is
    // immutable for one version, so changing only this PHP rewrite must also
    // invalidate browsers that cached an older module graph.
    return substr(hash('sha256', $entry_hash . '|' . $rewrite_hash), 0, 20);
};

$kodety_localization_rewrite_static_imports = static function (
    string $source,
    string $file,
    array $arguments
) use ($kodety_localization_private_asset_url): string {
    $rewritten = preg_replace_callback(
        '~((?:from|import)\s*)(["\'])(\.\.?/[^"\']+\.js)\2~',
        static function (array $match) use ($file, $arguments, $kodety_localization_private_asset_url): string {
            $target = realpath(dirname($file) . '/' . $match[3]);
            $assets_root = realpath(__DIR__ . '/assets');
            if (
                $target === false
                || $assets_root === false
                || !str_starts_with($target, $assets_root . DIRECTORY_SEPARATOR)
                || !is_file($target)
                || is_link($target)
            ) {
                return $match[0];
            }
            $target_relative = str_replace('\\', '/', substr($target, strlen($assets_root) + 1));
            $target_url = $target_relative === 'localization.js'
                ? $kodety_localization_private_asset_url('kodety_localization_asset', $arguments)
                : $kodety_localization_private_asset_url(
                    'kodety_localization_file',
                    $arguments,
                    $target_relative
                );
            return $match[1] . $match[2] . $target_url . $match[2];
        },
        $source
    );
    return is_string($rewritten) ? $rewritten : '';
};

$kodety_localization_send_file = static function (string $file, string $content_type): void {
    if ($file === '') {
        status_header(404);
        exit;
    }
    header('Content-Type: ' . $content_type);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=31536000, immutable');
    $size = filesize($file);
    if (is_int($size) && $size > 0) header('Content-Length: ' . $size);
    readfile($file);
    exit;
};

add_action('rest_api_init', static function (): void {
    register_rest_route('kodety/v1', '/project/localization', [
        'methods' => 'POST',
        'callback' => [Kodety_Plugin::instance(), 'save_project_localization'],
        'permission_callback' => static fn(): bool => current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE),
    ]);
});

add_action('wp_ajax_kodety_localization_asset', static function (): void {
    if (!current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) {
        status_header(403);
        exit;
    }
    $entry = __DIR__ . '/assets/localization.js';
    if (!is_file($entry) || is_link($entry)) {
        status_header(404);
        exit;
    }
    header('Content-Type: text/javascript; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=31536000, immutable');
    $size = filesize($entry);
    if (is_int($size) && $size > 0) header('Content-Length: ' . $size);
    readfile($entry);
    exit;
});

add_action('wp_ajax_kodety_localization_file', static function () use (
    $kodety_localization_asset_file,
    $kodety_localization_rewrite_static_imports
): void {
    if (!current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) {
        status_header(403);
        exit;
    }
    $relative = isset($_GET['file']) ? (string) wp_unslash($_GET['file']) : '';
    $file = $kodety_localization_asset_file($relative, ['js']);
    if ($file === '') {
        status_header(404);
        exit;
    }
    $source = file_get_contents($file);
    if (!is_string($source)) {
        status_header(500);
        exit;
    }
    $arguments = [];
    foreach (['kodety_share_token', 'ver'] as $argument) {
        if (!isset($_GET[$argument]) || is_array($_GET[$argument])) continue;
        $value = trim((string) wp_unslash($_GET[$argument]));
        if ($value !== '') $arguments[$argument] = $value;
    }
    // Generated chunks share React and other modules with localization.js.
    // Rewrite only static ESM imports to authenticated AJAX URLs; the dynamic
    // imports already pass through kodetyImportLocalizationChunk in the entry.
    $source = $kodety_localization_rewrite_static_imports($source, $file, $arguments);
    if ($source === '') {
        status_header(500);
        exit;
    }
    header('Content-Type: text/javascript; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=31536000, immutable');
    header('Content-Length: ' . strlen($source));
    echo $source;
    exit;
});

add_action('wp_ajax_kodety_localization_flag', static function () use (
    $kodety_localization_asset_file,
    $kodety_localization_send_file
): void {
    if (!current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) {
        status_header(403);
        exit;
    }
    $region = isset($_GET['region']) ? strtolower(trim((string) wp_unslash($_GET['region']))) : '';
    if (!preg_match('/^[a-z]{2}$/', $region)) $region = '';
    $kodety_localization_send_file(
        $region !== '' ? $kodety_localization_asset_file('flags/' . $region . '.svg', ['svg']) : '',
        'image/svg+xml; charset=UTF-8'
    );
});

add_action('wp_ajax_kodety_localization_style', static function () use ($kodety_localization_style_file): void {
    if (!current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) {
        status_header(403);
        exit;
    }
    $style = $kodety_localization_style_file();
    if ($style === '') {
        status_header(404);
        exit;
    }
    header('Content-Type: text/css; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=31536000, immutable');
    $size = filesize($style);
    if (is_int($size) && $size > 0) header('Content-Length: ' . $size);
    readfile($style);
    exit;
});

add_filter('kodety_editor_shell_config', static function (array $config) use (
    $kodety_localization_asset_version,
    $kodety_localization_preload_files,
    $kodety_localization_private_asset_url,
    $kodety_localization_style_file
): array {
    $entry = __DIR__ . '/assets/localization.js';
    $style = $kodety_localization_style_file();
    if (is_file($entry)) {
        $share_token = is_array($config['share'] ?? null) && !empty($config['share']['active'])
            ? trim((string) ($config['share']['token'] ?? ''))
            : '';
        $asset_version = $kodety_localization_asset_version($entry);
        $asset_arguments = [
            'kodety_share_token' => $share_token,
            'ver' => $asset_version,
        ];
        $config['localizationEntryUrl'] = $kodety_localization_private_asset_url(
            'kodety_localization_asset',
            $asset_arguments
        );
        $config['localizationFileUrl'] = $kodety_localization_private_asset_url(
            'kodety_localization_file',
            $asset_arguments
        );
        $config['localizationFlagAssetUrl'] = $kodety_localization_private_asset_url(
            'kodety_localization_flag',
            $asset_arguments
        );
        $config['localizationPreloadUrls'] = array_map(
            static fn(string $relative): string => $kodety_localization_private_asset_url(
                'kodety_localization_file',
                $asset_arguments,
                $relative
            ),
            $kodety_localization_preload_files()
        );
        if ($style !== '') {
            $config['localizationStyleUrl'] = $kodety_localization_private_asset_url(
                'kodety_localization_style',
                [
                    'kodety_share_token' => $share_token,
                    'ver' => $kodety_localization_asset_version($style),
                ]
            );
        }
        $config['localizationSaveUrl'] = rest_url('kodety/v1/project/localization');
    }
    return $config;
});
