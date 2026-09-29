<?php

declare(strict_types=1);

/** Browser-only local preview of the real PHP-rendered administration UI. */

define('ABSPATH', __DIR__ . '/');
define('KODETY_ROCKET_VERSION', '1.0.0-preview');
define('KODETY_ROCKET_URL', '../');
define('AUTH_SALT', 'kodety-rocket-preview');

$GLOBALS['kr_preview_options'] = [];

function get_option(string $name, mixed $default = false): mixed
{
    if ($name === 'kodety_rocket_settings') {
        return array_replace((new \KodetyRocket\Settings\SettingsRepository())->defaults(), [
            'page_cache_enabled' => true,
            'gzip_enabled' => true,
            'preload_enabled' => true,
        ]);
    }
    if ($name === 'kodety_rocket_preload_state') {
        return [
            'status' => 'complete',
            'total' => 24,
            'processed' => 24,
            'failed' => 0,
            'queue' => [],
            'completed_at' => time() - 120,
        ];
    }

    return $GLOBALS['kr_preview_options'][$name] ?? $default;
}

function get_current_blog_id(): int
{
    return 1;
}

function get_current_user_id(): int
{
    return 1;
}

function get_user_meta(int $userId, string $key, bool $single = false): mixed
{
    return '';
}

function current_user_can(string $capability): bool
{
    return true;
}

function wp_next_scheduled(string $hook): int|false
{
    return false;
}

function home_url(string $path = ''): string
{
    return 'https://example.test/' . ltrim($path, '/');
}

function admin_url(string $path = ''): string
{
    return './admin-preview.php?' . ltrim($path, '?');
}

function apply_filters(string $hook, mixed $value, mixed ...$args): mixed
{
    return $value;
}

function wp_json_encode(mixed $value, int $flags = 0, int $depth = 512): string|false
{
    return json_encode($value, $flags, $depth);
}

function wp_unslash(mixed $value): mixed
{
    return $value;
}

function sanitize_key(string $value): string
{
    return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?? '';
}

function esc_attr(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function esc_html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function esc_html__(string $value, string $domain = 'default'): string
{
    return $value;
}

function esc_textarea(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function esc_url(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function selected(mixed $selected, mixed $current = true, bool $display = true): string
{
    $result = (string) $selected === (string) $current ? ' selected="selected"' : '';
    if ($display) {
        echo $result;
    }

    return $result;
}

function checked(mixed $checked, mixed $current = true, bool $display = true): string
{
    $result = (string) $checked === (string) $current ? ' checked="checked"' : '';
    if ($display) {
        echo $result;
    }

    return $result;
}

function wp_nonce_field(string $action, string $name, bool $referer = true, bool $display = true): string
{
    $field = '<input type="hidden" name="' . esc_attr($name) . '" value="preview-nonce">';
    if ($display) {
        echo $field;
    }

    return $field;
}

function number_format_i18n(int|float $number, int $decimals = 0): string
{
    return number_format((float) $number, $decimals);
}

function size_format(int|float $bytes, int $decimals = 0): string
{
    if ($bytes < 1024) {
        return (string) $bytes . ' B';
    }
    if ($bytes < 1048576) {
        return number_format($bytes / 1024, $decimals) . ' KB';
    }

    return number_format($bytes / 1048576, $decimals) . ' MB';
}

function wp_date(string $format, ?int $timestamp = null): string
{
    return date($format, $timestamp ?? time());
}

function is_wp_error(mixed $value): bool
{
    return false;
}

function wp_die(string $message): never
{
    throw new RuntimeException($message);
}

require dirname(__DIR__) . '/src/Support/Autoloader.php';
\KodetyRocket\Support\Autoloader::register();

$settings = new \KodetyRocket\Settings\SettingsRepository();
$logger = new \KodetyRocket\Diagnostics\Logger($settings);
$cache = new \KodetyRocket\Cache\FileCacheStore(sys_get_temp_dir() . '/kodety-rocket-admin-preview-cache');
$invalidator = new \KodetyRocket\Cache\CacheInvalidator(
    $cache,
    (array) $settings->get('ignored_query_parameters', []),
    (array) $settings->get('query_allowlist', []),
    $logger,
    true
);
$preloader = new \KodetyRocket\Preload\Preloader($settings, $cache, $logger);
$page = new \KodetyRocket\Admin\AdminPage($settings, $cache, $logger, $preloader, $invalidator);
$clientConfig = [
    'locale' => 'en_US',
    'theme' => 'dark',
    'catalogues' => \KodetyRocket\Support\Translator::catalogues(),
    'defaultLocale' => \KodetyRocket\Support\Translator::DEFAULT_LOCALE,
    'styleUrl' => '../assets/admin.css',
    'storageKeys' => [
        'theme' => 'kodetyRocketPreviewTheme',
        'locale' => 'kodetyRocketPreviewLocale',
        'section' => 'kodetyRocketPreviewSection',
    ],
];
$hostile = isset($_GET['hostile']) && is_scalar($_GET['hostile']) && (string) $_GET['hostile'] === '1';
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kodety Rocket admin preview</title>
    <link rel="stylesheet" href="../assets/admin.css">
    <style>
        html, body { min-height: 100%; margin: 0; background: #1d2327; }
        .preview-adminbar { position: fixed; z-index: 999; inset: 0 0 auto; height: 32px; background: #1d2327; }
        .preview-menu { position: fixed; z-index: 90; inset: 32px auto 0 0; width: 160px; background: #1d2327; }
        .preview-menu::before { content: "WordPress"; display: block; padding: 18px 14px; color: #a7aaad; font: 600 13px/1 system-ui; }
        #wpcontent { min-height: 100vh; margin-left: 160px; padding: 42px 0 0 20px; }
        @media (max-width: 782px) {
            .preview-adminbar { height: 46px; }
            .preview-menu { display: none; }
            #wpcontent { margin-left: 0; padding: 56px 0 0 10px; }
        }
    </style>
    <?php if ($hostile) : ?>
    <style id="hostile-wp-admin-fixture">
        * { box-sizing: content-box !important; background-color: rgb(173, 23, 255) !important; color: rgb(0, 255, 76) !important; font: 32px/2 Georgia, serif !important; }
        button, input, select, textarea { width: 41px !important; height: 77px !important; margin: 19px !important; padding: 17px !important; border: 8px dashed rgb(255, 99, 0) !important; border-radius: 0 !important; box-shadow: 13px 17px 0 rgb(0, 255, 255) !important; appearance: auto !important; }
        table, th, td { border: 11px double rgb(255, 0, 0) !important; border-collapse: separate !important; background: rgb(255, 255, 0) !important; }
        h1 { margin: 45px !important; padding: 30px !important; border: 13px solid rgb(0, 255, 255) !important; border-radius: 27px !important; background: rgb(255, 0, 0) !important; font-size: 64px !important; }
    </style>
    <?php endif; ?>
    <script>window.KodetyRocketAdmin = <?php echo json_encode($clientConfig, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;</script>
</head>
<body>
    <div class="preview-adminbar" aria-hidden="true"></div>
    <aside class="preview-menu" aria-hidden="true"></aside>
    <div id="wpcontent"><?php $page->render(); ?></div>
    <script src="../assets/admin.js"></script>
</body>
</html>
