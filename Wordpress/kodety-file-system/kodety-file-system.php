<?php
/**
 * Plugin Name: Onun Kodety File System
 * Description: A secure, standalone asset and file system for WordPress.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 8.0
 * Author: Onun contributors
 * License: GPL-3.0-only
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: kodety-file-system
 */

defined( 'ABSPATH' ) || exit;

define( 'KODETY_FS_VERSION', '1.0.0' );
define( 'KODETY_FS_FILE', __FILE__ );
define( 'KODETY_FS_DIR', plugin_dir_path( __FILE__ ) );
define( 'KODETY_FS_URL', plugin_dir_url( __FILE__ ) );
define( 'KODETY_FS_REST_NAMESPACE', 'kodety-file-system/v1' );

require_once KODETY_FS_DIR . 'includes/interface-kodety-fs-storage-provider.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-path-guard.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-secret-box.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-database.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-local-provider.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-wordpress-media-provider.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-remote-provider.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-rest-controller.php';
require_once KODETY_FS_DIR . 'includes/class-kodety-fs-plugin.php';

register_activation_hook( __FILE__, array( 'Kodety_FS_Plugin', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Kodety_FS_Plugin', 'deactivate' ) );

Kodety_FS_Plugin::instance();
