<?php

defined('ABSPATH') || exit;

require_once __DIR__ . '/includes/class-kodety-members.php';

add_filter('kodety_theme_runtime_sources', static function (array $sources): array {
    $sources['membership.php'] = __DIR__ . '/theme-runtime/membership.php';
    return $sources;
});
add_filter('kodety_membership_runtime_enabled', '__return_true');
add_filter('kodety_membership_runtime_url', static function (string $fallback): string {
    $uploads = wp_upload_dir();
    $base_dir = rtrim(str_replace('\\', '/', (string) ($uploads['basedir'] ?? '')), '/');
    $base_url = rtrim((string) ($uploads['baseurl'] ?? ''), '/');
    $extension_dir = rtrim(str_replace('\\', '/', __DIR__), '/');
    if ($base_dir === '' || $base_url === '' || !str_starts_with($extension_dir, $base_dir . '/')) return $fallback;
    $relative = ltrim(substr($extension_dir, strlen($base_dir)), '/');
    return $base_url . '/' . $relative . '/assets/membership-runtime.js?ver=' . rawurlencode(KODETY_VERSION);
});

add_action('kodety_extension_activate_kodety-membership', static function (): void {
    Kodety_Members::activate();
    Kodety_Members::instance()->ensure_active_extension_project_enabled();
});
add_action('kodety_extension_deactivate_kodety-membership', [Kodety_Members::class, 'deactivate']);

Kodety_Members::instance();
