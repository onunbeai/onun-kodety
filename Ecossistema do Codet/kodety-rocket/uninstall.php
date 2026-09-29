<?php

declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

if (!defined('KODETY_ROCKET_DIR')) {
    define('KODETY_ROCKET_DIR', __DIR__ . '/');
}

require_once KODETY_ROCKET_DIR . 'src/Support/Autoloader.php';

\KodetyRocket\Support\Autoloader::register();
\KodetyRocket\Lifecycle\Uninstaller::uninstall();
