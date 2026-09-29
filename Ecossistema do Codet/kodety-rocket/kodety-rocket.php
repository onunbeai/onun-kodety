<?php
/**
 * Plugin Name: Kodety Rocket
 * Plugin URI: https://code.com/
 * Description: Lightweight, safe and standalone WordPress performance optimization from the Code ecosystem.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 8.0
 * Tested up to: 7.1
 * Author: Code
 * Author URI: https://code.com/
 * Text Domain: kodety-rocket
 * Domain Path: /languages
 * License: GPL-2.0-or-later
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('KODETY_ROCKET_VERSION', '1.0.0');
define('KODETY_ROCKET_FILE', __FILE__);
define('KODETY_ROCKET_DIR', plugin_dir_path(__FILE__));
define('KODETY_ROCKET_URL', plugin_dir_url(__FILE__));

require_once KODETY_ROCKET_DIR . 'src/Support/Autoloader.php';

\KodetyRocket\Support\Autoloader::register();

$kodetyRocketVendor = KODETY_ROCKET_DIR . 'vendor-prefixed/autoload.php';
if (!is_readable($kodetyRocketVendor)
    && defined('KODETY_ROCKET_DEV_MODE')
    && KODETY_ROCKET_DEV_MODE) {
    $kodetyRocketVendor = KODETY_ROCKET_DIR . 'vendor/autoload.php';
}
if (is_readable($kodetyRocketVendor)) {
    try {
        require_once $kodetyRocketVendor;
    } catch (\Throwable $exception) {
        // The engine remains usable without optional asset minification.
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('Kodety Rocket optional dependencies could not load: ' . get_class($exception));
        }
    }
}
unset($kodetyRocketVendor);

register_activation_hook(KODETY_ROCKET_FILE, [\KodetyRocket\Lifecycle\Activator::class, 'activate']);
register_deactivation_hook(KODETY_ROCKET_FILE, [\KodetyRocket\Lifecycle\Deactivator::class, 'deactivate']);

add_action('plugins_loaded', static function (): void {
    try {
        \KodetyRocket\Plugin::boot();
    } catch (\Throwable $exception) {
        // Fail open: a performance plugin must never take the site down.
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('Kodety Rocket could not boot: ' . get_class($exception));
        }
    }
}, 0);
