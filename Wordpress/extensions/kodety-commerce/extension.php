<?php

defined('ABSPATH') || exit;

require_once __DIR__ . '/includes/class-kodety-checkouts.php';

add_action('kodety_extension_activate_kodety-commerce', [Kodety_Checkouts::class, 'activate']);
add_action('kodety_extension_deactivate_kodety-commerce', [Kodety_Checkouts::class, 'deactivate']);

Kodety_Checkouts::instance();
