<?php

defined('ABSPATH') || exit;

define('KODETY_MARKETING_DIR', trailingslashit(__DIR__));
$kodety_marketing_uploads = wp_upload_dir();
$kodety_marketing_base_dir = rtrim(str_replace('\\', '/', (string) ($kodety_marketing_uploads['basedir'] ?? '')), '/');
$kodety_marketing_extension_dir = rtrim(str_replace('\\', '/', __DIR__), '/');
$kodety_marketing_relative_dir = $kodety_marketing_base_dir !== ''
    && str_starts_with($kodety_marketing_extension_dir, $kodety_marketing_base_dir . '/')
        ? ltrim(substr($kodety_marketing_extension_dir, strlen($kodety_marketing_base_dir)), '/')
        : '';
define(
    'KODETY_MARKETING_URL',
    $kodety_marketing_relative_dir !== ''
        ? trailingslashit((string) ($kodety_marketing_uploads['baseurl'] ?? '')) . trailingslashit($kodety_marketing_relative_dir)
        : KODETY_URL
);
unset(
    $kodety_marketing_uploads,
    $kodety_marketing_base_dir,
    $kodety_marketing_extension_dir,
    $kodety_marketing_relative_dir
);

require_once __DIR__ . '/includes/email/class-kodety-email-marketing.php';

add_action('kodety_extension_activate_kodety-marketing', [Kodety_Email_Marketing::class, 'activate']);
add_action('kodety_extension_deactivate_kodety-marketing', [Kodety_Email_Marketing::class, 'deactivate']);

Kodety_Email_Marketing::instance();
