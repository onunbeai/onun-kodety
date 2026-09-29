<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$capabilities = array(
	'kodety_files_read',
	'kodety_files_upload',
	'kodety_files_edit',
	'kodety_files_delete',
	'kodety_files_manage_private',
	'kodety_files_edit_code',
	'kodety_files_share',
	'kodety_files_purge',
	'kodety_files_manage_storage',
	'kodety_files_view_audit',
);

foreach ( array( 'administrator', 'editor' ) as $role_name ) {
	$role = get_role( $role_name );
	if ( ! $role ) {
		continue;
	}
	foreach ( $capabilities as $capability ) {
		$role->remove_cap( $capability );
	}
}

wp_clear_scheduled_hook( 'kodety_fs_cleanup_uploads' );
$settings = get_option( 'kodety_fs_settings', array() );
if ( is_array( $settings ) ) {
	$settings['mode'] = 'local';
	$settings['remote_token'] = '';
	$settings['remote_signing_secret'] = '';
	update_option( 'kodety_fs_settings', $settings, false );
}
delete_option( 'kodety_fs_secret_migration_failed' );
delete_option( 'kodety_fs_audit_degraded' );

// Assets may live outside WordPress or on a shared remote provider, so storage
// bytes are deliberately never deleted by uninstall.php.
if ( get_option( 'kodety_fs_remove_index_on_uninstall', false ) ) {
	require_once __DIR__ . '/includes/class-kodety-fs-database.php';
	Kodety_FS_Database::drop_all();
	delete_option( 'kodety_fs_settings' );
	delete_option( 'kodety_fs_db_version' );
}
