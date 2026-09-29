<?php
defined('ABSPATH') || exit;
$admin_ui_i18n_service = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
$admin_ui_translate = static fn(string $source): string => $admin_ui_i18n_service
    ? $admin_ui_i18n_service->translate($source)
    : $source;
$assets = KODETY_DIR . 'assets/manifest.json';
if (!is_file($assets)) wp_die($admin_ui_translate('Os assets do editor Onun Kodety não foram compilados. Execute npm run wordpress:build.'), 'Onun Kodety', ['response' => 500]);
$manifest = json_decode((string) file_get_contents($assets), true);
$entry = $manifest['Wordpress/editor/main.tsx'] ?? null;
$entry || wp_die($admin_ui_translate('O editor Onun Kodety não foi encontrado no pacote instalado.'), 'Onun Kodety', ['response' => 500]);
$script = $entry['file'] ?? '';
// Resolve também o CSS dos chunks compartilhados: com duas entradas no build,
// o design system vive num chunk comum e não em `css` da entrada.
$styles = Kodety_Assets::entry_styles($manifest, 'Wordpress/editor/main.tsx');
$app_view = sanitize_key((string) get_query_var('kodety_app'));
$share_context = class_exists('Kodety_Sharing') ? Kodety_Sharing::instance()->context() : null;
$is_shared = is_array($share_context);
$share_can_edit = $is_shared && Kodety_Sharing::instance()->can_edit();
$share_token = $is_shared ? (string) ($share_context['token'] ?? '') : '';
$share_invitation = $is_shared && is_array($share_context['invitation'] ?? null)
    ? $share_context['invitation']
    : null;
$share_invitation_url = $share_invitation
    ? Kodety_Sharing::instance()->invitation_url(
        $share_token,
        (string) ($share_invitation['token'] ?? '')
    )
    : '';
$browser_agent_runtime = Kodety_Plugin::instance()->browser_agent_runtime_requested();
$preserve_agent_runtime_selection = $browser_agent_runtime || array_key_exists('kodety_agent_runtime', $_GET);
$surface_url = static function (string $app) use ($is_shared, $share_token, $browser_agent_runtime, $preserve_agent_runtime_selection): string {
    $url = $is_shared
        ? Kodety_Sharing::instance()->share_url($share_token, $app)
        : home_url('/kodety/' . ($app === 'editor' ? 'editor' : $app) . '/');
    if (!$is_shared && $preserve_agent_runtime_selection && in_array($app, ['editor', 'settings'], true)) {
        $url = add_query_arg('kodety_agent_runtime', $browser_agent_runtime ? 'webcontainer' : 'server', $url);
    }
    return $url;
};
$extension_manager = class_exists('Kodety_Extensions') ? Kodety_Extensions::instance() : null;
$active_extensions = $extension_manager ? $extension_manager->active_slugs() : [
    'kodety-cms',
    'kodety-settings',
    'kodety-emails',
];
$analytics_extension_active = in_array('kodety-analytics', $active_extensions, true);
$kodefy_extension_active = in_array('kodefy-shopify', $active_extensions, true);
$commerce_extension_active = in_array('kodety-commerce', $active_extensions, true)
    && class_exists('Kodety_Checkouts');
$membership_extension_active = in_array('kodety-membership', $active_extensions, true)
    && class_exists('Kodety_Members');
$request_project_metadata = Kodety_Plugin::instance()->request_project_metadata();
$studio_runtime = $is_shared ? null : Kodety_Plugin::instance()->browser_studio_runtime();
$sanitize_membership_project_key = static function (mixed $value): string {
    if (class_exists('Kodety_Members')) return Kodety_Members::sanitize_project_key((string) $value);
    return substr(sanitize_key((string) $value), 0, 96);
};
$shared_project_id = $is_shared
    ? $sanitize_membership_project_key($request_project_metadata['workspaceProjectId'] ?? '')
    : '';
$membership_project_id = $membership_extension_active
    ? (
        $shared_project_id !== '' && $shared_project_id !== 'single'
            ? $shared_project_id
            : $sanitize_membership_project_key(get_option('kodety_workspace_project_id', ''))
    )
    : '';
if ($membership_extension_active && $membership_project_id === '') {
    $membership_project_id = $sanitize_membership_project_key(get_option('kodety_published_project_id', ''));
}
// Workspace branding belongs exclusively to wp-admin. Product surfaces keep
// the stable Onun Kodety identity so a client logo can never leak into the Builder,
// CMS, Analytics, Membership or their exported projects.
$brand_logo_url = '';
$editor_corner_icon = 'kodety-logo';
$can_edit_workspace = $is_shared ? $share_can_edit : current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE);
$can_access_cms = $is_shared ? true : current_user_can(Kodety_Plugin::CAP_ACCESS_CMS);
$can_manage_cms_schema = $is_shared ? $share_can_edit : current_user_can(Kodety_Plugin::CAP_MANAGE_CMS_SCHEMA);
$can_manage_cms_templates = $is_shared ? $share_can_edit : current_user_can(Kodety_Plugin::CAP_MANAGE_CMS_TEMPLATES);
$can_preview_agent = !$is_shared
    && $can_edit_workspace
    && current_user_can(Kodety_Plugin::CAP_USE_AI);
$can_use_ai = Kodety_Edition::has('ai') && $can_preview_agent;
$can_view_analytics = $analytics_extension_active
    && ($is_shared || current_user_can(Kodety_Plugin::CAP_VIEW_ANALYTICS));
$can_manage_analytics = $analytics_extension_active
    && ($is_shared ? $share_can_edit : current_user_can(Kodety_Plugin::CAP_MANAGE_ANALYTICS));
$can_view_members = $membership_extension_active
    && ($is_shared || current_user_can('kodety_view_members'));
$can_manage_integrations = !$is_shared && current_user_can('manage_options');
$adobe_fonts_licensed = class_exists('Kodety_Adobe_Fonts')
    && Kodety_Adobe_Fonts::reseller_licensed();
$mcp_feature_active = Kodety_Edition::has('mcp');
$builder_apps = Kodety_Plugin::instance()->builder_apps();
$can_publish = !$is_shared && !is_multisite()
    && current_user_can('kodety_publish')
    && current_user_can('edit_theme_options');
$mcp_status = !$is_shared && $mcp_feature_active ? Kodety_MCP::instance()->status() : [];
$update_config = !$is_shared && class_exists('Kodety_Updates')
    ? Kodety_Updates::instance()->client_config()
    : null;
$admin_ui_i18n = $admin_ui_i18n_service
    ? $admin_ui_i18n_service->client_config('document')
    : null;
$product = Kodety_Edition::public_config();
$resolved_app_view = isset($builder_apps[$app_view]) ? $app_view : 'editor';
if (
    ($resolved_app_view === 'localization' && !Kodety_Edition::has('localization'))
    || ($resolved_app_view === 'analytics' && !$can_view_analytics)
    || ($resolved_app_view === 'members' && !$can_view_members)
) {
    $resolved_app_view = 'editor';
}
$analytics_demo_mode = $resolved_app_view === 'analytics'
    && isset($_GET['value'])
    && sanitize_text_field(wp_unslash((string) $_GET['value'])) === 'teste';
$config = [
    'appView' => $resolved_app_view,
    'edition' => Kodety_Edition::slug(),
    'product' => $product,
    'agentBrowser' => [
        'selected' => $browser_agent_runtime ? 'webcontainer' : 'server',
        'userId' => get_current_user_id(),
    ],
    'editorUrl' => ($can_edit_workspace || $is_shared) ? $surface_url('editor') : '',
    'cmsUrl' => $can_access_cms ? $surface_url('cms') : '',
    'settingsUrl' => ($can_edit_workspace || $is_shared) ? $surface_url('settings') : '',
    'localizationUrl' => Kodety_Edition::has('localization') && ($can_edit_workspace || $is_shared)
        ? $surface_url('localization')
        : '',
    'analyticsUrl' => $can_view_analytics ? $surface_url('analytics') : '',
    'analyticsDemoMode' => $analytics_demo_mode,
    'membersUrl' => $can_view_members ? $surface_url('members') : '',
    'templatesUrl' => !$is_shared && $can_edit_workspace ? $surface_url('templates') : '',
    'templatesCatalogUrl' => !$is_shared && $can_edit_workspace ? rest_url('kodety/v1/templates') : '',
    'templatesApplyUrl' => !$is_shared && $can_edit_workspace ? rest_url('kodety/v1/templates/apply') : '',
    'templatesUploadUrl' => !$is_shared && $can_edit_workspace ? rest_url('kodety/v1/templates/upload') : '',
    'kodefyUrl' => $kodefy_extension_active && $can_manage_integrations
        ? add_query_arg('section', 'mcp', $surface_url('settings'))
        : '',
    'kodefySettingsUrl' => $kodefy_extension_active && $can_manage_integrations ? rest_url('kodefy/v1/settings') : '',
    'kodefyConnectionTestUrl' => $kodefy_extension_active && $can_manage_integrations ? rest_url('kodefy/v1/connection-test') : '',
    'kodefyBuilderDataUrl' => $kodefy_extension_active && $can_manage_integrations ? rest_url('kodefy/v1/builder-data') : '',
    'kodefyDownloadKitUrl' => $kodefy_extension_active && $can_manage_integrations
        ? wp_nonce_url(admin_url('admin-post.php?action=kodefy_download_kit'), 'kodefy_download_kit')
        : '',
    'membersOverviewUrl' => $can_view_members ? rest_url('kodety/v1/membership/overview') : '',
    'membersUsersUrl' => $can_view_members ? rest_url('kodety/v1/membership/members') : '',
    'membersUserUrl' => $can_view_members ? rest_url('kodety/v1/membership/members/{id}') : '',
    'membersPlansUrl' => $can_view_members ? rest_url('kodety/v1/membership/plans') : '',
    'membersPlanUrl' => $can_view_members ? rest_url('kodety/v1/membership/plans/{id}') : '',
    'membersEntitlementsUrl' => $can_view_members ? rest_url('kodety/v1/membership/entitlements') : '',
    'membersSettingsUrl' => $can_view_members ? rest_url('kodety/v1/membership/settings') : '',
    'membersActivationUrl' => $can_view_members ? rest_url('kodety/v1/membership/overview') : '',
    'membersCommerceUrl' => $can_view_members && $commerce_extension_active
        ? rest_url('kodety/v1/members/commerce')
        : '',
    // Workspace/cache identity is required even when Membership is disabled.
    'projectId' => $sanitize_membership_project_key($request_project_metadata['workspaceProjectId'] ?? ''),
    'membershipProjectEnabled' => $membership_extension_active
        && $membership_project_id !== ''
        && Kodety_Members::is_project_enabled($membership_project_id),
    'canViewMembers' => $can_view_members,
    'canManageMembers' => $membership_extension_active
        && ($is_shared ? $share_can_edit : current_user_can('kodety_manage_members')),
    'analyticsOverviewUrl' => $can_view_analytics ? rest_url('kodety/v1/analytics/overview') : '',
    'analyticsPageInsightsUrl' => $can_view_analytics ? rest_url('kodety/v1/analytics/page-insights') : '',
    'analyticsFunnelsUrl' => $can_view_analytics ? rest_url('kodety/v1/analytics/funnels') : '',
    'analyticsFunnelItemUrl' => $can_view_analytics ? rest_url('kodety/v1/analytics/funnels/{id}') : '',
    'analyticsEmailOptionsUrl' => $can_manage_analytics ? rest_url('kodety/v1/analytics/email-options') : '',
    'analyticsExperimentsUrl' => $can_view_analytics ? rest_url('kodety/v1/analytics/experiments') : '',
    'analyticsExperimentItemUrl' => $can_view_analytics ? rest_url('kodety/v1/analytics/experiments/{id}') : '',
    'analyticsStateUrl' => $can_manage_analytics ? rest_url('kodety/v1/analytics/experiments/{id}/state') : '',
    'metaCapiSettingsUrl' => $can_manage_analytics ? rest_url('kodety/v1/analytics/meta-capi/settings') : '',
    'metaCapiTestUrl' => $can_manage_analytics ? rest_url('kodety/v1/analytics/meta-capi/test') : '',
    'sitemapUrl' => $can_publish ? rest_url('kodety/v1/sitemap') : '',
    'searchConsoleUrl' => $can_manage_integrations
        ? rest_url('kodety/v1/seo/search-console')
        : '',
    'projectUrl' => ($can_edit_workspace || $is_shared) ? rest_url('kodety/v1/project') : '',
    'projectSurfaceUrl' => ($can_edit_workspace || $can_view_analytics)
        ? rest_url('kodety/v1/project/surface')
        : '',
    'projectSurfaceAssetUrl' => $can_edit_workspace
        ? rest_url('kodety/v1/project/surface/asset')
        : '',
    // This value is JSON, not HTML. wp_nonce_url() entity-escapes `&` and
    // would turn `_wpnonce` into a literal `amp;_wpnonce` in fetch(), causing
    // large projects to land on the empty opener after a silent HTTP 403.
    'projectDownloadUrl' => $can_edit_workspace
        ? add_query_arg([
            'action' => 'kodety_download_editor_project',
            '_wpnonce' => wp_create_nonce('kodety_download_editor_project'),
        ], admin_url('admin-post.php'))
        : '',
    'projectChunkUrl' => $can_edit_workspace ? rest_url('kodety/v1/project/chunk') : '',
    // Capability switch: clearing this URL immediately returns the Builder to
    // the legacy ZIP transport without removing or migrating any project data.
    'projectDeltaUrl' => $can_edit_workspace && apply_filters('kodety_project_delta_enabled', true)
        ? rest_url('kodety/v1/project/delta')
        : '',
    'projectName' => (string) ($request_project_metadata['name'] ?: get_bloginfo('name')),
    'publishUrl' => $can_publish ? rest_url('kodety/v1/publish') : '',
    'materializedPublishOverlay' => true,
    'previewUrl' => !$is_shared && $can_edit_workspace ? rest_url('kodety/v1/preview') : '',
    'youtubeEmbedUrl' => home_url('/kodety/player/youtube/'),
    'releasesUrl' => rest_url('kodety/v1/releases'),
    'storageUrl' => $can_manage_integrations ? rest_url('kodety/v1/storage') : '',
    'optimizationsUrl' => rest_url('kodety/v1/optimizations'),
    'googleFontsUrl' => rest_url('kodety/v1/fonts/google'),
    'adobeFontsLicensed' => $adobe_fonts_licensed,
    'adobeFontsUrl' => $adobe_fonts_licensed && !$is_shared && $can_edit_workspace
        ? rest_url('kodety/v1/fonts/adobe')
        : '',
    'adobeFontsSettingsUrl' => $adobe_fonts_licensed && $can_manage_integrations
        ? rest_url('kodety/v1/fonts/adobe/settings')
        : '',
    'adobeFontsSyncUrl' => $adobe_fonts_licensed && $can_manage_integrations
        ? rest_url('kodety/v1/fonts/adobe/resync')
        : '',
    'nonce' => wp_create_nonce('wp_rest'),
    'restNonceUrl' => is_user_logged_in()
        ? add_query_arg('action', 'kodety_refresh_rest_session', admin_url('admin-ajax.php'))
        : '',
    'readOnly' => $is_shared && !$share_can_edit,
    'canEditWorkspace' => $can_edit_workspace,
    'canAccessCms' => $can_access_cms,
    'canManageCmsSchema' => $can_manage_cms_schema,
    'canManageCmsTemplates' => $can_manage_cms_templates,
    'canUseAi' => $can_use_ai,
    'canViewAnalytics' => $can_view_analytics,
    'canManageAnalytics' => $can_manage_analytics,
    'canPublish' => $can_publish,
    'dashboardUrl' => $is_shared ? $surface_url('editor') : home_url('/kodety/'),
    'siteUrl' => Kodety_Plugin::instance()->active_project_site_url(),
    'studio' => $studio_runtime,
    'logoutUrl' => $is_shared ? '' : wp_logout_url(home_url('/')),
    // The ZIP is already the newest editable workspace snapshot. Redirect to
    // the Builder only for review; publishing remains an explicit user action.
    'openPublishAfterImport' => !$is_shared
        && isset($_GET['kodety_open_publish'])
        && $_GET['kodety_open_publish'] === '1',
    'restoredSnapshot' => !$is_shared
        && isset($_GET['kodety_restored_snapshot'])
        && $_GET['kodety_restored_snapshot'] === '1',
    'shopifyThemeImport' => !$is_shared
        && isset($_GET['kodety_shopify_theme'])
        && $_GET['kodety_shopify_theme'] === '1',
    'importZipUrl' => $can_publish && current_user_can('kodety_import') && !$is_shared
        ? admin_url('admin.php?page=kodety#kodety-area-project')
        : '',
    // "Adicionar página" no wp-admin redireciona para cá: o builder cria uma
    // página vazia no projeto atual em vez de abrir o editor nativo.
    'newPage' => !$is_shared
        && isset($_GET['kodety_new_page'])
        && $_GET['kodety_new_page'] === '1',
    'initialHtmlPath' => isset($_GET['kodety_html']) ? ltrim(str_replace('\\', '/', sanitize_text_field(wp_unslash($_GET['kodety_html']))), '/') : '',
    'initialExperimentId' => isset($_GET['kodety_experiment']) ? sanitize_key(wp_unslash($_GET['kodety_experiment'])) : '',
    'initialVariantId' => isset($_GET['kodety_variant']) ? sanitize_key(wp_unslash($_GET['kodety_variant'])) : '',
    'cmsSchemaUrl' => $can_access_cms ? rest_url('kodety/v1/cms/schema') : '',
    'cmsTemplatesUrl' => $can_access_cms ? rest_url('kodety/v1/cms/templates') : '',
    'cmsItemsUrl' => $can_access_cms ? rest_url('kodety/v1/cms/items') : '',
    'cmsCollectionsUrl' => $can_access_cms ? rest_url('kodety/v1/cms/collections') : '',
    'cmsFieldsUrl' => $can_access_cms ? rest_url('kodety/v1/cms/fields') : '',
    'mediaUploadUrl' => (!$is_shared || $share_can_edit) && current_user_can('upload_files') ? rest_url('wp/v2/media') : '',
    'aiSettingsUrl' => $can_manage_integrations && Kodety_Edition::has('ai')
        ? rest_url('kodety/v1/ai/settings')
        : '',
    'aiSettingsPageUrl' => $can_manage_integrations && Kodety_Edition::has('ai')
        ? add_query_arg('section', 'mcp', $surface_url('settings')) . '#integrations-ai'
        : '',
    'aiGenerateUrl' => $can_use_ai ? rest_url('kodety/v1/ai/generate') : '',
    'aiTestUrl' => $can_manage_integrations && Kodety_Edition::has('ai')
        ? rest_url('kodety/v1/ai/test')
        : '',
    // Unlicensed editors receive only GET /config so the Agent surface can be
    // previewed. Every account, session, attachment and skill operation keeps
    // its server-side Pro entitlement check.
    'agentUrl' => $can_preview_agent ? rest_url('kodety/v1/agents') : '',
    'agentNonce' => $can_preview_agent ? wp_create_nonce('wp_rest') : '',
    'cmsTemplateMode' => isset($_GET['kodety_cms_template']) && $_GET['kodety_cms_template'] === '1',
    'mcpStatusUrl' => $mcp_feature_active ? rest_url('kodety/v1/mcp/status') : '',
    'mcpSettingsUrl' => $can_manage_integrations && $mcp_feature_active
        ? home_url('/kodety/settings/?section=mcp') . '#integrations-mcp'
        : '',
    'mcpAdminUrl' => $can_manage_integrations && $mcp_feature_active ? admin_url('admin.php?page=kodety#kodety-mcp') : '',
    'mcpProjectConnectionUrl' => $can_manage_integrations && $mcp_feature_active ? rest_url('kodety/v1/mcp/project-connections') : '',
    'mcpTarget' => is_array($mcp_status['target'] ?? null) ? $mcp_status['target'] : null,
    'mcpEnabled' => !empty($mcp_status['enabled']),
    'canManageIntegrations' => $can_manage_integrations,
    'activeExtensions' => $active_extensions,
    'adminUiI18n' => $admin_ui_i18n,
    'updates' => $update_config,
    'onboarding' => !$is_shared && class_exists('Kodety_Builder_Onboarding')
        ? Kodety_Builder_Onboarding::instance()->client_config()
        : null,
    // /kodety/editor/folder opens the synced-folder picker on load. The menu
    // entry was removed, not the capability.
    'folderPicker' => !$is_shared && (string) get_query_var('kodety_folder_picker') === '1',
    'editorCornerIcon' => $editor_corner_icon,
    'brandLogoUrl' => $brand_logo_url,
    'sharingUrl' => Kodety_Edition::has('collaboration') && !$is_shared && $can_edit_workspace
        ? rest_url('kodety/v1/sharing')
        : '',
    // Only the visual editor owns a browser-session lease. Other workspaces
    // keep their capabilities and revision checks without occupying the editor.
    'editorLockUrl' => $resolved_app_view === 'editor' && ($can_edit_workspace || $is_shared)
        ? rest_url('kodety/v1/editor-lock')
        : '',
    'share' => $is_shared ? [
        'active' => true,
        'mode' => $share_can_edit ? 'edit' : 'view',
        'authRequired' => !empty($share_context['authRequired']),
        'token' => $share_token,
        'projectId' => (string) ($share_context['projectId'] ?? ''),
        'invitation' => $share_invitation ? [
            'email' => (string) ($share_invitation['email'] ?? ''),
            'permission' => ($share_invitation['permission'] ?? 'view') === 'edit' ? 'edit' : 'view',
            'token' => (string) ($share_invitation['token'] ?? ''),
            'accountExists' => !empty($share_invitation['accountExists']),
            'accepted' => !empty($share_invitation['accepted']),
            'acceptUrl' => rest_url('kodety/v1/collaboration/invitation/accept'),
            'loginUrl' => wp_login_url($share_invitation_url),
            'lostPasswordUrl' => wp_lostpassword_url($share_invitation_url),
        ] : null,
    ] : null,
];
$config = apply_filters('kodety_editor_shell_config', $config, [
    'appView' => $app_view,
    'isShared' => $is_shared,
    'canEditWorkspace' => $can_edit_workspace,
    'canManageIntegrations' => $can_manage_integrations,
    'surfaceUrl' => $surface_url,
]);
// Performance diagnostics are intentionally impossible to enable through the
// shell filter. They require the literal server constant, an administrator and
// a normal authenticated workspace (never a shared surface).
if (Kodety_Observability::enabled_for_shell($is_shared)) {
    $config['performanceDebug'] = [
        'enabled' => true,
        'traceId' => Kodety_Observability::new_operation_id('trace'),
    ];
} else {
    unset($config['performanceDebug']);
}
?><!doctype html>
<html <?php language_attributes(); ?> class="dark">
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Onun Kodety — <?php echo esc_html(get_bloginfo('name')); ?></title>
    <?php $kodety_favicons = Kodety_Plugin::favicon_urls(); ?>
    <link rel="icon" href="<?php echo esc_url($kodety_favicons['svg']); ?>" type="image/svg+xml" sizes="any">
    <link rel="icon" href="<?php echo esc_url($kodety_favicons['png']); ?>" type="image/png" sizes="180x180">
    <link rel="apple-touch-icon" href="<?php echo esc_url($kodety_favicons['png']); ?>">
    <?php foreach ($styles as $style): ?><link rel="stylesheet" href="<?php echo esc_url(KODETY_URL . 'assets/' . $style); ?>"><?php endforeach; ?>
    <?php if ($app_view === 'localization' && !empty($config['localizationStyleUrl'])): ?>
        <link rel="stylesheet" href="<?php echo esc_url((string) $config['localizationStyleUrl']); ?>" data-kodety-localization-style>
    <?php endif; ?>
    <?php if ($app_view === 'localization' && !empty($config['localizationEntryUrl'])): ?>
        <link rel="modulepreload" href="<?php echo esc_url((string) $config['localizationEntryUrl']); ?>">
    <?php endif; ?>
    <?php if ($app_view === 'localization' && is_array($config['localizationPreloadUrls'] ?? null)): ?>
        <?php foreach ($config['localizationPreloadUrls'] as $localization_preload_url): ?>
            <?php if (is_string($localization_preload_url) && $localization_preload_url !== ''): ?>
                <link rel="modulepreload" href="<?php echo esc_url($localization_preload_url); ?>">
            <?php endif; ?>
        <?php endforeach; ?>
    <?php endif; ?>
    <script>window.kodetyWordPress=<?php echo wp_json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE); ?>;window.kodetyAdminI18n=window.kodetyWordPress.adminUiI18n;</script>
    <?php if ($admin_ui_i18n): ?><script src="<?php echo esc_url(add_query_arg('ver', (string) filemtime(KODETY_DIR . 'admin/i18n.js'), KODETY_URL . 'admin/i18n.js')); ?>"></script><?php endif; ?>
</head>
<body class="kodety-wordpress-editor">
    <div id="kodety-root">
        <div class="kodety-boot-loader" role="status" aria-busy="true" aria-label="<?php echo esc_attr($admin_ui_translate('Carregando Onun Kodety')); ?>">
            <div class="kodety-boot-loader__content">
                <svg class="kodety-boot-loader__mark" viewBox="0 0 114 122" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                    <path d="M51.1932 122L0 61L113.183 94.8289V122H51.1932Z" fill="currentColor" />
                    <path d="M51.1932 0L0 61L113.183 27.1711V0H51.1932Z" fill="currentColor" />
                </svg>
                <div class="kodety-boot-loader__track" role="progressbar" aria-label="<?php echo esc_attr($admin_ui_translate('Carregando editor')); ?>">
                    <span class="kodety-boot-loader__fill"></span>
                </div>
                <span class="kodety-boot-loader__sr"><?php echo esc_html($admin_ui_translate('Carregando editor')); ?></span>
            </div>
        </div>
    </div>
    <script type="module" src="<?php echo esc_url(KODETY_URL . 'assets/' . $script); ?>"></script>
</body>
</html>
