<?php
define('ABSPATH', '/tmp/onun-kodety-wordpress/');
function add_action(...$args): never { throw new RuntimeException('The legacy commercial updater must not register WordPress hooks.'); }
function add_filter(...$args): never { throw new RuntimeException('The legacy commercial updater must not register download/update filters.'); }
function wp_remote_get(...$args): never { throw new RuntimeException('The legacy commercial updater must not make remote requests.'); }
require_once __DIR__ . '/../kodety/includes/class-kodety-updates.php';
if (Kodety_Updates::instance()->client_config() !== null) throw new RuntimeException('No vendor update configuration should reach the editor.');
echo "Onun Kodety manual release updates: OK\n";
