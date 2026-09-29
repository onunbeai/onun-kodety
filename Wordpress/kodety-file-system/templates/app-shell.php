<?php
defined( 'ABSPATH' ) || exit;

$plugin = Kodety_FS_Plugin::instance();
$config = $plugin->app_config();
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
	<meta name="robots" content="noindex,nofollow,noarchive">
	<title><?php echo esc_html__( 'Onun Kodety File System', 'kodety-file-system' ); ?></title>
	<link rel="preload" href="<?php echo esc_url( KODETY_FS_URL . 'assets/inter-latin-variable.woff2?ver=' . KODETY_FS_VERSION ); ?>" as="font" type="font/woff2" crossorigin>
	<link rel="stylesheet" href="<?php echo esc_url( KODETY_FS_URL . 'assets/app.css?ver=' . KODETY_FS_VERSION ); ?>">
</head>
<body class="kodety-fs-shell">
	<div id="kodety-file-system-root" aria-live="polite"></div>
	<noscript><?php echo esc_html__( 'Onun Kodety File System requires JavaScript.', 'kodety-file-system' ); ?></noscript>
	<script id="kodety-fs-config" type="application/json"><?php echo wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); ?></script>
	<script src="<?php echo esc_url( KODETY_FS_URL . 'assets/app.js?ver=' . KODETY_FS_VERSION ); ?>" defer></script>
</body>
</html>
