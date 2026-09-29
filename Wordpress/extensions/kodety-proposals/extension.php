<?php

defined('ABSPATH') || exit;

require_once __DIR__ . '/includes/class-kodety-proposals-addon.php';

add_action('kodety_extension_activate_kodety-proposals', [Kodety_Proposals_Addon::class, 'activate']);
add_action('kodety_extension_deactivate_kodety-proposals', [Kodety_Proposals_Addon::class, 'deactivate']);

Kodety_Proposals_Addon::instance();
