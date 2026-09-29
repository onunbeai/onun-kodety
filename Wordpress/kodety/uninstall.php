<?php

defined('WP_UNINSTALL_PLUGIN') || exit;

// Capabilities and scheduled work belong to the executable plugin, so they
// must not remain attached to roles after removal. Projects, releases, CMS
// content and submissions are deliberately retained by default: uninstalling
// a builder must never silently erase a site. Hosts that explicitly request a
// full configuration cleanup can opt in from wp-config.php.
foreach (['administrator', 'editor', 'author', 'contributor', 'subscriber', 'kodety_designer'] as $role_name) {
    $role = get_role($role_name);
    if (!$role) continue;
    foreach ([
        'kodety_edit',
        'kodety_publish',
        'kodety_manage_cms',
        'kodety_access_cms',
        'kodety_manage_cms_schema',
        'kodety_manage_cms_templates',
        'kodety_use_ai',
        'kodety_manage_emails',
        'kodety_view_analytics',
        'kodety_manage_analytics',
        'kodety_view_search_console',
        'kodety_manage_search_console',
        'kodety_import',
        'kodety_view_members',
        'kodety_manage_members',
        'kodety_assign_membership',
        'kodety_manage_commerce',
        'kodety_manage_email_marketing',
        'kodety_view_email_marketing',
    ] as $capability) {
        $role->remove_cap($capability);
    }
}
remove_role('kodety_designer');

wp_clear_scheduled_hook('kodety_emails_cleanup');
wp_clear_scheduled_hook('kodety_analytics_cleanup');
wp_clear_scheduled_hook('kodety_members_cleanup');
wp_clear_scheduled_hook('kodety_checkouts_reconcile');
wp_clear_scheduled_hook('kodety_meta_capi_retry');
wp_clear_scheduled_hook('kodety_email_tick');
wp_clear_scheduled_hook('kodety_email_cleanup');
wp_clear_scheduled_hook('kodety_publish_sync_retry');
wp_clear_scheduled_hook('kodety_search_console_daily_sync');
if (function_exists('wp_unschedule_hook')) {
    // Eventos de campanha carregam campaign_id nos argumentos; clear com
    // args vazios não os encontraria.
    wp_unschedule_hook('kodety_email_dispatch_scheduled');
    wp_unschedule_hook('kodety_email_process_campaign');
    wp_unschedule_hook('kodety_email_run_scheduled_batch');
    wp_unschedule_hook('kodety_funnel_send_campaign');
    wp_unschedule_hook('kodety_social_images_generate');
    wp_unschedule_hook('kodety_social_images_scan');
    wp_unschedule_hook('kodety_publish_sync_retry');
    wp_unschedule_hook('kodety_search_console_retry_sync');
}
delete_transient('kodety_email_health_report');
delete_transient('kodety_email_campaign_overview_v1');
delete_option('kodety_email_cleanup_lock');
delete_option('kodety_search_console_upgrade_lock');

// OAuth handshakes, short-lived access tokens and synchronization locks must
// never survive the executable plugin, even when durable reports are retained
// for a later reinstall.
global $wpdb;
foreach ([
    'kodety_search_console_oauth_',
    'kodety_search_console_sync_lock_',
    'kodety_search_console_state_lock_',
] as $prefix) {
    $wpdb->query($wpdb->prepare(
        "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
        $wpdb->esc_like($prefix) . '%'
    )); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- plugin-owned ephemeral options.
}
foreach ([
    '_transient_kodety_search_console_access_token_',
    '_transient_timeout_kodety_search_console_access_token_',
] as $prefix) {
    $wpdb->query($wpdb->prepare(
        "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
        $wpdb->esc_like($prefix) . '%'
    )); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- plugin-owned transient prefix.
}

// Projects and settings are intentionally preserved across reinstalls, but the
// next installation is a new product entry point and must run setup again.
// Re-arming this single flag keeps all retained data intact while making the
// onboarding redirect deterministic after the plugin is deleted and installed.
update_option('kodety_onboarding_status', 'pending', false);

if (defined('KODETY_PURGE_CONFIGURATION_ON_UNINSTALL') && KODETY_PURGE_CONFIGURATION_ON_UNINSTALL === true) {
    $options = [
        'kodety_interface_enabled',
        'kodety_block_editor_skin_enabled',
        'kodety_mcp_enabled',
        'kodety_mcp_token_hash',
        'kodety_mcp_owner_id',
        'kodety_mcp_project_connections',
        'kodety_mcp_revision',
        'kodety_mcp_activity',
        'kodety_mcp_activity_events',
        'kodety_ai_settings',
        'kodety_ai_api_key',
        'kodety_brand_name',
        'kodety_editor_corner_icon',
        'kodety_brand_logo_id',
        'kodety_admin_logo_id',
        'kodety_login_image_id',
        'kodety_admin_accent_color',
        'kodety_admin_ui_locale',
        'kodety_workspace_mode',
        'kodety_onboarding_status',
        'kodety_agency_projects',
        'kodety_agency_folders',
        'kodety_agency_active_project',
        'kodety_project_name',
        'kodety_workspace_project_id',
        'kodety_published_project_id',
        'kodety_workspace_revision',
        'kodety_workspace_css_digest',
        'kodety_draft_updated_at',
        'kodety_current_release',
        'kodety_assets_synced_release',
        'kodety_pages_synced_release',
        'kodety_pages_sync_notified_release',
        'kodety_publish_sync_last_error',
        'kodety_original_name',
        'kodety_default_pages_cleaned',
        'kodety_google_fonts_catalog_cache',
        'kodety_adobe_fonts_settings',
        'kodety_cms_route_version',
        'kodety_cms_templates',
        'kodety_field_definitions',
        'kodety_collections',
        'kodety_optimization_settings',
        'kodety_security_settings',
        'kodety_last_published_at',
        'kodety_schema_version',
        'kodety_permalink_initialized',
        'kodety_emails_db_version',
        'kodety_email_settings',
        'kodety_email_marketing_settings',
        'kodety_email_delivery_test',
        'kodety_email_bounce_webhook_last_seen',
        'kodety_email_db_version',
        'kodety_email_rewrite_version',
        'kodety_email_manual_only_version',
        'kodety_acf_install_pending',
        'kodety_analytics_enabled',
        'kodety_analytics_private_runtime_root',
        'kodety_license_runtime_access',
        'kodety_cookie_consent_enabled',
        'kodety_analytics_retention_days',
        'kodety_analytics_db_version',
        'kodety_meta_capi_settings',
        'kodety_meta_capi_retry_queue',
        'kodety_search_console_db_version',
        'kodety_search_console_client_credentials',
        'kodety_search_console_client_revision',
        'kodety_search_console_site_index',
        'kodety_public_variant_routes',
        'kodety_membership_settings',
        'kodety_membership_db_version',
        'kodety_membership_catalog_revision',
        'kodety_checkouts_db_version',
        'kodety_checkouts_subscription_cursor',
    ];
    foreach ($options as $option) delete_option($option);
    foreach ([
        'kodety_search_console_credential_',
        'kodety_search_console_connection_revision_',
        'kodety_search_console_site_',
        'kodety_search_console_inspection_usage_',
    ] as $prefix) {
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
            $wpdb->esc_like($prefix) . '%'
        )); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- explicit opt-in purge of plugin-owned options.
    }
    $wpdb->query(
        "DROP TABLE IF EXISTS {$wpdb->prefix}kodety_search_console_pages"
    ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed internal table name.
    foreach (['events', 'sessions', 'daily', 'funnels', 'experiments', 'variants'] as $table) {
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}kodety_analytics_{$table}"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed internal table names.
    }
    foreach ([
        'plans',
        'entitlements',
        'plan_entitlements',
        'subscriptions',
        'grants',
        'events',
        'audit',
    ] as $table) {
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}kodety_membership_{$table}"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed internal table names.
    }
    foreach (['connections', 'mappings', 'sales', 'artifacts', 'access_blocks'] as $table) {
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}kodety_checkout_{$table}"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed internal table names.
    }
    foreach ([
        'list_contacts',
        'queue',
        'events',
        'consent_events',
        'suppressions',
        'segments',
        'lists',
        'contacts',
        'campaigns',
        'templates',
    ] as $table) {
        $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}kodety_email_{$table}"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed internal table names.
    }
    $wpdb->query(
        "DROP TABLE IF EXISTS {$wpdb->prefix}kodety_email_submissions"
    ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- fixed internal table name.
    $uploads = wp_upload_dir();
    $form_upload_root = is_array($uploads) && !empty($uploads['basedir'])
        ? trailingslashit((string) $uploads['basedir']) . 'kodety/private/forms'
        : '';
    if ($form_upload_root !== '' && is_dir($form_upload_root)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($form_upload_root, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iterator as $entry) {
            if ($entry->isLink() || $entry->isFile()) @unlink($entry->getPathname());
            elseif ($entry->isDir()) @rmdir($entry->getPathname());
        }
        @rmdir($form_upload_root);
    }
    $wpdb->query(
        "DELETE FROM {$wpdb->usermeta} WHERE meta_key IN ('_kodety_membership_status','_kodety_membership_revision','_kodety_membership_last_login_at')"
    ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- explicit opt-in purge.
}
