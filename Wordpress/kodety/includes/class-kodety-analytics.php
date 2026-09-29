<?php

defined('ABSPATH') || exit;

/**
 * First-party, privacy-conscious analytics and experimentation for Onun Kodety.
 *
 * Raw events deliberately contain no raw IP address, user account, e-mail or
 * free-form request payload. Public writes are same-origin, rate-limited and
 * idempotent. Dashboard reads and configuration writes require both the
 * Onun Kodety analytics capability and a valid REST nonce.
 */
final class Kodety_Analytics {
    private const DB_VERSION = 6;
    private const DEFAULT_RETENTION_DAYS = 180;
    private const MAX_RETENTION_DAYS = 730;
    private const PUBLIC_RATE_LIMIT = 180;
    private const MAX_BATCH_SIZE = 25;
    private const MAX_FUNNEL_STEPS = 24;
    private const MAX_FUNNEL_WINDOW_MINUTES = 43200;
    private const FUNNEL_WEBHOOK_SECRET_PREFIX = 'v1.';
    private const FUNNEL_WEBHOOK_SECRET_CONTEXT = 'kodety-funnel-webhooks-v1';
    private const EVENT_TYPES = ['pageview', 'exposure', 'click', 'submit', 'custom', 'conversion', 'scroll', 'js_error', 'ping'];
    private const EXPERIMENT_STATUSES = ['draft', 'running', 'paused', 'completed'];

    private static ?self $instance = null;
    /** @var array<int,array<string,mixed>> */
    private array $request_assignments = [];
    /** @var array{destination:string,backup:string,hadDestination:bool}|null */
    private ?array $pending_runtime_swap = null;
    /** @var array{experiment_id:int,variant_key:string,source_page_id:int,runtime_relative:string}|null */
    private ?array $forced_variant_route = null;
    /** @var array{directory:string,directoryUri:string,runtimeRelative:string}|null */
    private ?array $active_private_runtime = null;

    private const PUBLIC_ROUTES_OPTION = 'kodety_public_variant_routes';
    private const PRIVATE_RUNTIME_ROOT_OPTION = 'kodety_analytics_private_runtime_root';
    private const PRIVATE_RUNTIME_ROUTE = 'kodety-experiment-runtime';

    /**
     * Resolve the project that owns the current request/configuration.
     *
     * Public agency sites stay online simultaneously, therefore frontend
     * requests are resolved from the published slug. Administrative requests
     * use the project currently opened in the Builder.
     */
    private static function project_scope_key(?string $request_path = null): string {
        if (get_option('kodety_workspace_mode', 'single') !== 'agency') return 'single';
        if (class_exists('Kodety_Sharing')) {
            $shared_project_id = Kodety_Sharing::instance()->project_id();
            if ($shared_project_id !== '' && $shared_project_id !== 'single') {
                return $shared_project_id;
            }
        }
        $projects = get_option('kodety_agency_projects', []);
        $projects = is_array($projects) ? $projects : [];
        if (!is_admin()) {
            $path = $request_path;
            if ($path === null) {
                $path = (string) wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
                if (
                    defined('REST_REQUEST')
                    && REST_REQUEST
                    && str_contains(trim($path, '/'), 'wp-json/')
                ) {
                    $referer_path = (string) wp_parse_url(
                        (string) ($_SERVER['HTTP_REFERER'] ?? ''),
                        PHP_URL_PATH
                    );
                    // Public collection calls inherit the published project's
                    // slug from the page referrer. Dashboard calls originate in
                    // wp-admin and deliberately use the project open in Builder.
                    if ($referer_path !== '' && !str_contains($referer_path, '/wp-admin/')) {
                        $path = $referer_path;
                    } else {
                        $active = sanitize_key((string) get_option('kodety_agency_active_project', ''));
                        return $active !== '' ? $active : 'single';
                    }
                }
            }
            $path = trim((string) $path, '/');
            $segment = sanitize_title(explode('/', $path, 2)[0] ?? '');
            foreach ($projects as $id => $project) {
                if (!is_array($project)) continue;
                if ($segment !== '' && sanitize_title((string) ($project['slug'] ?? '')) === $segment) {
                    return sanitize_key((string) $id);
                }
            }
            foreach ($projects as $id => $project) {
                if (is_array($project) && !empty($project['isRoot'])) return sanitize_key((string) $id);
            }
        }
        $active = sanitize_key((string) get_option('kodety_agency_active_project', ''));
        return $active !== '' ? $active : 'single';
    }

    private function project_sql_condition(string $alias = ''): string {
        global $wpdb;
        $column = ($alias !== '' ? $alias . '.' : '') . 'project_key';
        return $wpdb->prepare("{$column}=%s", self::project_scope_key());
    }

    private static function project_option_name(string $option): string {
        $scope = self::project_scope_key();
        return $scope === 'single' ? $option : $option . '__project_' . $scope;
    }

    private static function project_option(string $option, mixed $default): mixed {
        $scoped = self::project_option_name($option);
        if ($scoped === $option) return get_option($option, $default);
        $missing = new stdClass();
        $value = get_option($scoped, $missing);
        return $value === $missing ? get_option($option, $default) : $value;
    }

    /** Shared privacy gate for browser runtimes and first-party REST endpoints. */
    public static function consent_manager_enabled(): bool {
        return self::project_option('kodety_cookie_consent_enabled', '0') === '1';
    }

    /** Portable analytics preferences; raw events and credentials never enter a ZIP. */
    public static function template_settings(): array {
        return [
            'enabled' => self::project_option('kodety_analytics_enabled', '1') === '1',
            'retentionDays' => max(
                7,
                min(
                    self::MAX_RETENTION_DAYS,
                    absint(self::project_option('kodety_analytics_retention_days', self::DEFAULT_RETENTION_DAYS))
                )
            ),
        ];
    }

    public static function restore_template_settings(array $settings): bool {
        $enabled = !array_key_exists('enabled', $settings) || rest_sanitize_boolean($settings['enabled']);
        $retention = max(
            7,
            min(self::MAX_RETENTION_DAYS, absint($settings['retentionDays'] ?? self::DEFAULT_RETENTION_DAYS))
        );
        $enabled_option = self::project_option_name('kodety_analytics_enabled');
        $retention_option = self::project_option_name('kodety_analytics_retention_days');
        update_option($enabled_option, $enabled ? '1' : '0', false);
        update_option($retention_option, $retention, false);
        return get_option($enabled_option, null) === ($enabled ? '1' : '0')
            && (int) get_option($retention_option, 0) === $retention;
    }

    private function project_json_marker(): string {
        $scope = self::project_scope_key();
        return $scope === 'single' ? '%' : '%"projectKey":"' . $this->wpdb_like($scope) . '"%';
    }

    private function wpdb_like(string $value): string {
        global $wpdb;
        return method_exists($wpdb, 'esc_like') ? $wpdb->esc_like($value) : addcslashes($value, '_%\\');
    }

    private function scoped_external_id(string $external): string {
        $external = $this->variant_key($external);
        $scope = self::project_scope_key();
        return $scope === 'single' ? $external : $this->variant_key($scope . '--' . $external);
    }

    private function public_external_id(string $external): string {
        $scope = self::project_scope_key();
        $prefix = $scope === 'single' ? '' : $this->variant_key($scope) . '--';
        return $prefix !== '' && str_starts_with($external, $prefix)
            ? substr($external, strlen($prefix))
            : $external;
    }

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'maybe_upgrade'], 1);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        // Public variant URLs (e.g. /home-b) get a real rewrite rule so the
        // request reliably reaches WordPress on any host, are detected during
        // request parsing, then rendered as the experiment's source page forced
        // to the variant clone on template_redirect.
        add_filter('query_vars', static function (array $vars): array {
            $vars[] = 'kodety_variant';
            $vars[] = 'kodety_experiment_runtime_scope';
            $vars[] = 'kodety_experiment_runtime_asset';
            return $vars;
        });
        add_filter('kodety_runtime_context', [$this, 'private_variant_runtime_context'], 1000);
        add_action('init', [$this, 'purge_legacy_public_runtime_trees'], 2);
        add_action('init', [$this, 'register_variant_rewrite_rules'], 20);
        add_action('parse_request', [$this, 'detect_variant_public_route'], 20);
        // Own the protected asset namespace before the generated theme's
        // generic project-root asset responder (priority -120) can inspect it.
        add_action('template_redirect', [$this, 'serve_private_variant_asset'], -200);
        add_action('template_redirect', [$this, 'apply_forced_variant_route'], -1);
        add_action('template_redirect', [$this, 'maybe_apply_experiment'], 0);
        add_action('wp_footer', [$this, 'print_tracking_script'], 99);
        // Analytics clones and configuration are part of the release itself,
        // not a best-effort post-publish side effect. The publisher invokes
        // this hook while both theme/workspace backups are still recoverable.
        add_action('kodety_prepare_published_analytics', [$this, 'sync_published_configuration'], 20);
        // Native page identities are synchronized after the transactional theme
        // and analytics swap. Rebind experiments at that point so a source page
        // created by the same first publish can immediately serve its variants.
        add_action('kodety_published', [$this, 'reconcile_published_experiments'], 20);
        add_action('kodety_pages_sync_completed', [$this, 'reconcile_published_experiments'], 20);
        add_action('kodety_analytics_cleanup', [$this, 'cleanup']);
        add_action('kodety_form_submitted', [$this, 'run_funnel_email_actions'], 20);
    }

    public static function activate(): void {
        self::install_schema();
        self::instance()->migrate_project_scopes();
        self::remove_legacy_campaign_automations();
        foreach (['administrator', 'kodety_designer'] as $role_name) {
            $role = get_role($role_name);
            if (!$role) continue;
            $role->add_cap('kodety_view_analytics');
            $role->add_cap('kodety_manage_analytics');
        }
        $editor = get_role('editor');
        if ($editor) {
            $editor->add_cap('kodety_view_analytics');
            $editor->remove_cap('kodety_manage_analytics');
        }
        add_option('kodety_analytics_enabled', '1', '', false);
        add_option('kodety_analytics_retention_days', self::DEFAULT_RETENTION_DAYS, '', false);
        if (!wp_next_scheduled('kodety_analytics_cleanup')) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'kodety_analytics_cleanup');
        }
        // Reconcile page IDs and rebuild from database + physical clone truth.
        // This also repairs routes created by builds that failed to persist the
        // generated runtime_relative metadata.
        self::instance()->purge_legacy_public_runtime_trees();
        self::instance()->reconcile_published_experiments();
        update_option('kodety_analytics_db_version', self::DB_VERSION, false);
    }

    /**
     * Version 6 introduced project ownership. Legacy analytics had no reliable
     * owner, so an agency upgrade assigns that state to the project currently
     * open instead of exposing it to every project or silently discarding it.
     */
    private function migrate_project_scopes(): void {
        if (get_option('kodety_workspace_mode', 'single') !== 'agency') return;
        $scope = self::project_scope_key();
        if ($scope === 'single') return;
        global $wpdb;
        foreach ([
            $this->table('events'),
            $this->table('sessions'),
            $this->table('daily'),
        ] as $table) {
            $wpdb->query($wpdb->prepare(
                "UPDATE {$table} SET project_key=%s WHERE project_key='' OR project_key='single'",
                $scope
            ));
        }

        $experiments = $wpdb->get_results(
            "SELECT id,external_id,config_json FROM {$this->table('experiments')}",
            ARRAY_A
        );
        foreach ((array) $experiments as $row) {
            $config = json_decode((string) ($row['config_json'] ?? ''), true);
            $config = is_array($config) ? $config : [];
            if (sanitize_key((string) ($config['projectKey'] ?? '')) !== '') continue;
            $config['projectKey'] = $scope;
            $wpdb->update($this->table('experiments'), [
                'config_json' => wp_json_encode($config),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ], ['id' => (int) $row['id']]);
            $external = $this->variant_key((string) ($row['external_id'] ?? ''));
            if ($external !== '') {
                $wpdb->update($this->table('experiments'), [
                    'external_id' => $this->scoped_external_id($external),
                ], ['id' => (int) $row['id']]);
            }
        }

        $funnels = $wpdb->get_results(
            "SELECT id,filters_json FROM {$this->table('funnels')}",
            ARRAY_A
        );
        foreach ((array) $funnels as $row) {
            $filters = json_decode((string) ($row['filters_json'] ?? ''), true);
            $filters = is_array($filters) ? $filters : [];
            if (sanitize_key((string) ($filters['projectKey'] ?? '')) !== '') continue;
            $filters['projectKey'] = $scope;
            $wpdb->update($this->table('funnels'), [
                'filters_json' => wp_json_encode($filters),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ], ['id' => (int) $row['id']]);
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook('kodety_analytics_cleanup');
        self::unschedule_legacy_campaign_events();
    }

    public function maybe_upgrade(): void {
        if ((int) get_option('kodety_analytics_db_version', 0) >= self::DB_VERSION) return;
        $lock = 'kodety_analytics_upgrade_lock';
        $locked_at = absint(get_option($lock, 0));
        if ($locked_at > 0 && $locked_at < time() - 5 * MINUTE_IN_SECONDS) {
            delete_option($lock);
        }
        // add_option is atomic at the database level. Concurrent first requests
        // must never run dbDelta/backfills against the same tables together.
        if (!add_option($lock, time(), '', false)) return;
        try {
            self::activate();
        } finally {
            delete_option($lock);
        }
    }

    private static function install_schema(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $events = $wpdb->prefix . 'kodety_analytics_events';
        $sessions = $wpdb->prefix . 'kodety_analytics_sessions';
        $daily = $wpdb->prefix . 'kodety_analytics_daily';
        $funnels = $wpdb->prefix . 'kodety_analytics_funnels';
        $experiments = $wpdb->prefix . 'kodety_analytics_experiments';
        $variants = $wpdb->prefix . 'kodety_analytics_variants';

        dbDelta("CREATE TABLE {$events} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            project_key varchar(64) NOT NULL DEFAULT 'single',
            event_uuid varchar(64) NOT NULL,
            session_id varchar(64) NOT NULL,
            visitor_id varchar(64) NOT NULL,
            event_type varchar(24) NOT NULL,
            event_name varchar(128) NOT NULL DEFAULT '',
            tracking_id varchar(191) NOT NULL DEFAULT '',
            page_path text NOT NULL,
            page_hash char(64) NOT NULL,
            source_host varchar(191) NOT NULL DEFAULT '',
            country_code char(2) NOT NULL DEFAULT '',
            region_name varchar(128) NOT NULL DEFAULT '',
            city_name varchar(128) NOT NULL DEFAULT '',
            timezone_name varchar(64) NOT NULL DEFAULT '',
            device_type varchar(24) NOT NULL DEFAULT '',
            browser_name varchar(64) NOT NULL DEFAULT '',
            operating_system varchar(64) NOT NULL DEFAULT '',
            viewport_width smallint(5) unsigned NOT NULL DEFAULT 0,
            viewport_height smallint(5) unsigned NOT NULL DEFAULT 0,
            scroll_depth tinyint(3) unsigned NOT NULL DEFAULT 0,
            element_key varchar(191) NOT NULL DEFAULT '',
            element_label varchar(191) NOT NULL DEFAULT '',
            experiment_id bigint(20) unsigned NOT NULL DEFAULT 0,
            variant_key varchar(64) NOT NULL DEFAULT '',
            duration_ms int(10) unsigned NOT NULL DEFAULT 0,
            metadata longtext NULL,
            ip_hash char(64) NOT NULL DEFAULT '',
            occurred_at datetime NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY event_uuid (event_uuid),
            KEY project_occurred_type (project_key,occurred_at,event_type),
            KEY occurred_type (occurred_at,event_type),
            KEY session_time (session_id,occurred_at),
            KEY visitor_time (visitor_id,occurred_at),
            KEY page_time (page_hash,occurred_at),
            KEY tracking_time (tracking_id,occurred_at),
            KEY element_time (element_key,occurred_at),
            KEY experiment_variant (experiment_id,variant_key,occurred_at)
        ) {$charset};");

        dbDelta("CREATE TABLE {$sessions} (
            session_id varchar(64) NOT NULL,
            project_key varchar(64) NOT NULL DEFAULT 'single',
            visitor_id varchar(64) NOT NULL,
            first_seen datetime NOT NULL,
            last_seen datetime NOT NULL,
            pageviews int(10) unsigned NOT NULL DEFAULT 0,
            event_count int(10) unsigned NOT NULL DEFAULT 0,
            engaged_ms bigint(20) unsigned NOT NULL DEFAULT 0,
            landing_page text NOT NULL,
            exit_page text NOT NULL,
            source_host varchar(191) NOT NULL DEFAULT '',
            country_code char(2) NOT NULL DEFAULT '',
            region_name varchar(128) NOT NULL DEFAULT '',
            city_name varchar(128) NOT NULL DEFAULT '',
            timezone_name varchar(64) NOT NULL DEFAULT '',
            device_type varchar(24) NOT NULL DEFAULT '',
            browser_name varchar(64) NOT NULL DEFAULT '',
            operating_system varchar(64) NOT NULL DEFAULT '',
            viewport_width smallint(5) unsigned NOT NULL DEFAULT 0,
            viewport_height smallint(5) unsigned NOT NULL DEFAULT 0,
            max_scroll_depth tinyint(3) unsigned NOT NULL DEFAULT 0,
            ip_hash char(64) NOT NULL DEFAULT '',
            PRIMARY KEY  (session_id),
            KEY project_first (project_key,first_seen),
            KEY project_last (project_key,last_seen),
            KEY visitor_first (visitor_id,first_seen),
            KEY first_seen (first_seen),
            KEY last_seen (last_seen),
            KEY source_first (source_host,first_seen),
            KEY country_first (country_code,first_seen),
            KEY device_first (device_type,first_seen)
        ) {$charset};");

        dbDelta("CREATE TABLE {$daily} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            project_key varchar(64) NOT NULL DEFAULT 'single',
            stat_date date NOT NULL,
            page_path text NOT NULL,
            page_hash char(64) NOT NULL,
            country_code char(2) NOT NULL DEFAULT '',
            device_type varchar(24) NOT NULL DEFAULT '',
            sessions int(10) unsigned NOT NULL DEFAULT 0,
            unique_visitors int(10) unsigned NOT NULL DEFAULT 0,
            pageviews int(10) unsigned NOT NULL DEFAULT 0,
            conversions int(10) unsigned NOT NULL DEFAULT 0,
            bounce_sessions int(10) unsigned NOT NULL DEFAULT 0,
            engagement_seconds bigint(20) unsigned NOT NULL DEFAULT 0,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY project_day_page_country_device (project_key,stat_date,page_hash,country_code,device_type),
            KEY stat_date (stat_date)
        ) {$charset};");

        dbDelta("CREATE TABLE {$funnels} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            name varchar(191) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'active',
            steps_json longtext NOT NULL,
            filters_json longtext NULL,
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY status_updated (status,updated_at)
        ) {$charset};");

        dbDelta("CREATE TABLE {$experiments} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            external_id varchar(64) NOT NULL DEFAULT '',
            name varchar(191) NOT NULL,
            source_page_id bigint(20) unsigned NOT NULL DEFAULT 0,
            page_path text NOT NULL,
            page_hash char(64) NOT NULL,
            goal_type varchar(24) NOT NULL DEFAULT 'conversion',
            goal_tracking_id varchar(191) NOT NULL DEFAULT '',
            status varchar(20) NOT NULL DEFAULT 'draft',
            traffic_percent decimal(5,2) unsigned NOT NULL DEFAULT 100.00,
            config_json longtext NULL,
            assignment_salt varchar(64) NOT NULL,
            managed_source varchar(24) NOT NULL DEFAULT 'dashboard',
            started_at datetime NULL,
            ended_at datetime NULL,
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY external_id (external_id),
            KEY page_status (page_hash,status),
            KEY source_page_status (source_page_id,status)
        ) {$charset};");

        dbDelta("CREATE TABLE {$variants} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            experiment_id bigint(20) unsigned NOT NULL,
            variant_key varchar(64) NOT NULL,
            name varchar(191) NOT NULL,
            document_key varchar(191) NOT NULL DEFAULT '',
            page_id bigint(20) unsigned NOT NULL DEFAULT 0,
            page_path text NOT NULL,
            weight decimal(12,4) unsigned NOT NULL DEFAULT 1.0000,
            enabled tinyint(1) unsigned NOT NULL DEFAULT 1,
            is_control tinyint(1) unsigned NOT NULL DEFAULT 0,
            metadata longtext NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY experiment_variant (experiment_id,variant_key),
            KEY experiment_enabled (experiment_id,enabled)
        ) {$charset};");
    }

    /**
     * Campaign delivery is manual-only. Older releases allowed a funnel node
     * to enqueue an immediate campaign send, so upgrades must make persisted
     * nodes and already queued cron events inert.
     */
    private static function remove_legacy_campaign_automations(): void {
        self::unschedule_legacy_campaign_events();

        global $wpdb;
        $table = $wpdb->prefix . 'kodety_analytics_funnels';
        $rows = $wpdb->get_results(
            "SELECT id,steps_json FROM {$table} WHERE steps_json LIKE '%\"send-campaign\"%'",
            ARRAY_A
        );
        foreach (is_array($rows) ? $rows : [] as $row) {
            $steps = json_decode((string) ($row['steps_json'] ?? ''), true);
            if (!is_array($steps)) continue;
            $changed = false;
            foreach ($steps as &$step) {
                if (
                    !is_array($step)
                    || (string) ($step['type'] ?? '') !== 'email'
                    || (string) ($step['emailAction'] ?? '') !== 'send-campaign'
                ) continue;
                $step['emailAction'] = 'upsert-contact';
                unset($step['emailCampaignId']);
                $changed = true;
            }
            unset($step);
            if (!$changed) continue;
            $wpdb->update(
                $table,
                [
                    'steps_json' => wp_json_encode($steps),
                    'updated_at' => gmdate('Y-m-d H:i:s'),
                ],
                ['id' => absint($row['id'] ?? 0)],
                ['%s', '%s'],
                ['%d']
            );
        }
    }

    private static function unschedule_legacy_campaign_events(): void {
        if (function_exists('wp_unschedule_hook')) {
            wp_unschedule_hook('kodety_funnel_send_campaign');
            return;
        }
        wp_clear_scheduled_hook('kodety_funnel_send_campaign');
    }

    private function table(string $name): string {
        global $wpdb;
        return $wpdb->prefix . 'kodety_analytics_' . $name;
    }

    /** License checks stay server-side so REST, publish imports and runtimes share one boundary. */
    private function pro_feature_enabled(string $feature): bool {
        return class_exists('Kodety_Edition')
            && Kodety_Edition::is_licensed()
            && Kodety_Edition::has($feature);
    }

    private function pro_feature_error(string $feature, string $message): WP_Error {
        $data = [
            'status' => 403,
            'licensed' => class_exists('Kodety_Edition') && Kodety_Edition::is_licensed(),
            'feature' => $feature,
        ];
        if (class_exists('Kodety_Edition')) {
            $data['licenseUrl'] = Kodety_Edition::license_url();
            $data['upgradeUrl'] = Kodety_Edition::upgrade_url();
        }
        return new WP_Error('kodety_analytics_pro_required', $message, $data);
    }

    private function effective_experiment_status(string $status): string {
        return $status === 'running' && !$this->pro_feature_enabled('experiments')
            ? 'paused'
            : $status;
    }

    private function effective_funnel_status(string $status): string {
        return $status === 'active' && !$this->pro_feature_enabled('analyticsFunnels')
            ? 'paused'
            : $status;
    }

    public function register_rest_routes(): void {
        register_rest_route('kodety/v1', '/analytics/collect', [
            'methods' => 'POST',
            'callback' => [$this, 'collect'],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route('kodety/v1', '/analytics/assign', [
            'methods' => 'POST',
            'callback' => [$this, 'assign'],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route('kodety/v1', '/analytics/overview', [
            'methods' => 'GET',
            'callback' => [$this, 'overview'],
            'permission_callback' => [$this, 'view_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/page-insights', [
            'methods' => 'GET',
            'callback' => [$this, 'page_insights'],
            'permission_callback' => [$this, 'view_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/tracking', [
            'methods' => 'GET',
            'callback' => [$this, 'tracking_report'],
            'permission_callback' => [$this, 'view_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/variant-routes', [
            'methods' => 'GET',
            'callback' => [$this, 'debug_variant_routes'],
            'permission_callback' => [$this, 'view_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/funnels', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_funnels'],
                'permission_callback' => [$this, 'view_permission'],
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_funnel'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
        ]);
        register_rest_route('kodety/v1', '/analytics/funnels/(?P<id>\d+)', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_funnel'],
                'permission_callback' => [$this, 'view_permission'],
            ],
            [
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => [$this, 'update_funnel'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete_funnel'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
        ]);
        register_rest_route('kodety/v1', '/analytics/email-options', [
            'methods' => 'GET',
            'callback' => [$this, 'email_automation_options'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/experiments', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_experiments'],
                'permission_callback' => [$this, 'view_permission'],
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_experiment'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
        ]);
        register_rest_route('kodety/v1', '/analytics/experiments/(?P<id>[A-Za-z0-9._-]+)', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_experiment'],
                'permission_callback' => [$this, 'view_permission'],
            ],
            [
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => [$this, 'update_experiment'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete_experiment'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
        ]);
        register_rest_route('kodety/v1', '/analytics/experiments/(?P<id>[A-Za-z0-9._-]+)/state', [
            'methods' => WP_REST_Server::EDITABLE,
            'callback' => [$this, 'set_experiment_state'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/experiments/(?P<id>[A-Za-z0-9._-]+)/variants', [
            'methods' => 'POST',
            'callback' => [$this, 'create_variant'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/experiments/(?P<id>[A-Za-z0-9._-]+)/variants/(?P<variant_id>[A-Za-z0-9._-]+)', [
            [
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => [$this, 'update_variant'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete_variant'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
        ]);
    }

    public function private_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_private_request($request, 'kodety_manage_analytics', 'gerenciar');
    }

    public function view_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_private_request($request, 'kodety_view_analytics', 'visualizar');
    }

    public function manage_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_private_request($request, 'kodety_manage_analytics', 'gerenciar');
    }

    private function authorize_private_request(
        WP_REST_Request $request,
        string $capability,
        string $action
    ): bool|WP_Error {
        if (
            class_exists('Kodety_Sharing')
            && Kodety_Sharing::instance()->context($request)
        ) {
            $share_access = $capability === 'kodety_view_analytics' ? 'view' : 'edit';
            if (Kodety_Sharing::instance()->authorize_rest($request, $share_access)) return true;
            return new WP_Error(
                'kodety_share_read_only',
                'Este compartilhamento permite apenas visualizar o Analytics.',
                ['status' => 403]
            );
        }
        if (!is_user_logged_in()) {
            return new WP_Error('kodety_analytics_unauthorized', 'Autenticação necessária.', ['status' => 401]);
        }
        if (!current_user_can($capability)) {
            return new WP_Error(
                'kodety_analytics_forbidden',
                sprintf('Sem permissão para %s Analytics.', $action),
                ['status' => 403]
            );
        }
        $nonce = (string) $request->get_header('X-WP-Nonce');
        if ($nonce === '') $nonce = (string) $request->get_param('_wpnonce');
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error('kodety_analytics_nonce', 'A sessão do Analytics expirou.', ['status' => 403]);
        }
        return true;
    }

    private function public_request_allowed(WP_REST_Request $request): bool|WP_Error {
        if (self::project_option('kodety_analytics_enabled', '1') !== '1') {
            return new WP_Error('kodety_analytics_disabled', 'Analytics desativado.', ['status' => 503]);
        }
        if ($request->get_header('DNT') === '1' || $request->get_header('Sec-GPC') === '1') {
            return new WP_Error('kodety_analytics_privacy', 'Preferência de privacidade respeitada.', ['status' => 204]);
        }
        if (self::consent_manager_enabled()) {
            $consent = isset($_COOKIE['kodety_consent_analytics'])
                ? sanitize_key(wp_unslash((string) $_COOKIE['kodety_consent_analytics']))
                : '';
            if (!hash_equals('granted', $consent)) {
                return new WP_Error('kodety_analytics_privacy', 'Consentimento para Analytics não concedido.', ['status' => 204]);
            }
        }
        $origin = trim($request->get_header('Origin'));
        $referer = trim($request->get_header('Referer'));
        $candidate = $origin !== '' && strtolower($origin) !== 'null' ? $origin : $referer;
        if ($candidate !== '') {
            $request_host = strtolower((string) wp_parse_url($candidate, PHP_URL_HOST));
            $home_host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
            if ($request_host === '' || $home_host === '' || !hash_equals($home_host, $request_host)) {
                return new WP_Error('kodety_analytics_origin', 'Origem não autorizada.', ['status' => 403]);
            }
        }
        $key = 'kodety_an_rate_' . substr($this->request_fingerprint(), 0, 32);
        $rate = get_transient($key);
        $rate = is_array($rate) ? $rate : ['count' => 0, 'started' => time()];
        if ((int) ($rate['started'] ?? 0) < time() - MINUTE_IN_SECONDS) $rate = ['count' => 0, 'started' => time()];
        if ((int) ($rate['count'] ?? 0) >= self::PUBLIC_RATE_LIMIT) {
            return new WP_Error('kodety_analytics_rate_limit', 'Limite temporário excedido.', ['status' => 429]);
        }
        $rate['count'] = (int) ($rate['count'] ?? 0) + 1;
        set_transient($key, $rate, 2 * MINUTE_IN_SECONDS);
        return true;
    }

    public function collect(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $allowed = $this->public_request_allowed($request);
        if (is_wp_error($allowed)) {
            if ($allowed->get_error_code() === 'kodety_analytics_privacy') return new WP_REST_Response(null, 204);
            return $allowed;
        }
        $payload = $request->get_json_params();
        if (!is_array($payload)) return new WP_Error('kodety_analytics_payload', 'Payload inválido.', ['status' => 400]);
        // Drop automated traffic before it touches storage so live visitors,
        // sources and device breakdowns reflect real people.
        if ($this->is_bot_request($request)) {
            $response = new WP_REST_Response(['accepted' => 0, 'duplicates' => 0, 'ignored' => 'bot', 'serverTime' => gmdate('c')], 202);
            $response->header('Cache-Control', 'no-store, max-age=0');
            return $response;
        }
        $batch = isset($payload['events']) && is_array($payload['events']) ? $payload['events'] : [$payload];
        if (!$batch || count($batch) > self::MAX_BATCH_SIZE) {
            return new WP_Error('kodety_analytics_batch', 'Lote vazio ou acima do limite.', ['status' => 400]);
        }
        $accepted = 0;
        $duplicates = 0;
        global $wpdb;
        if ($wpdb->query('START TRANSACTION') === false) {
            return new WP_Error(
                'kodety_analytics_storage',
                'Não foi possível iniciar a persistência dos eventos.',
                ['status' => 503, 'retryable' => true]
            );
        }
        try {
            foreach ($batch as $raw) {
                if (!is_array($raw)) continue;
                $event = $this->sanitize_event($raw, $request);
                if (is_wp_error($event)) continue;
                $stored = $this->store_event($event);
                if (is_wp_error($stored)) {
                    $wpdb->query('ROLLBACK');
                    return $stored;
                }
                if ($stored === 'stored') $accepted++;
                elseif ($stored === 'duplicate') $duplicates++;
            }
            if ($wpdb->query('COMMIT') === false) {
                $wpdb->query('ROLLBACK');
                return new WP_Error(
                    'kodety_analytics_storage',
                    'Não foi possível confirmar a persistência dos eventos.',
                    ['status' => 503, 'retryable' => true]
                );
            }
        } catch (Throwable $error) {
            $wpdb->query('ROLLBACK');
            return new WP_Error(
                'kodety_analytics_storage',
                'Não foi possível persistir os eventos.',
                ['status' => 503, 'retryable' => true]
            );
        }
        $response = new WP_REST_Response([
            'accepted' => $accepted,
            'duplicates' => $duplicates,
            'serverTime' => gmdate('c'),
        ], 202);
        $response->header('Cache-Control', 'no-store, max-age=0');
        return $response;
    }

    /** @return array<string,mixed>|WP_Error */
    private function sanitize_event(array $raw, WP_REST_Request $request): array|WP_Error {
        $type = sanitize_key((string) ($raw['type'] ?? ''));
        if (!in_array($type, self::EVENT_TYPES, true)) return new WP_Error('invalid_type');
        $uuid = strtolower(trim((string) ($raw['eventId'] ?? $raw['id'] ?? '')));
        if (!preg_match('/^[a-z0-9][a-z0-9._:-]{15,63}$/', $uuid)) $uuid = wp_generate_uuid4();
        $session = $this->opaque_id((string) ($raw['sessionId'] ?? ''));
        $visitor = $this->opaque_id((string) ($raw['visitorId'] ?? ''));
        $identity_source = sanitize_key((string) ($raw['identitySource'] ?? ''));
        if ($identity_source === 'memory') {
            // Browsers that block both cookies and Web Storage still need one
            // stable identity during the reporting day. The rotating HMAC never
            // stores a raw IP and deliberately cannot become a long-lived
            // fingerprint.
            $visitor = 'fallback-' . substr($this->request_fingerprint(), 0, 54);
        }
        if ($session === '' || $visitor === '') return new WP_Error('invalid_identity');
        $page_path = $this->sanitize_page_path((string) ($raw['pagePath'] ?? '/'));
        $tracking = $this->tracking_id((string) ($raw['trackingId'] ?? ''));
        if (!in_array($type, ['pageview', 'exposure', 'custom', 'scroll', 'js_error', 'ping'], true) && $tracking === '') {
            return new WP_Error('missing_tracking');
        }
        $occurred = $this->sanitize_occurred_at((string) ($raw['occurredAt'] ?? ''));
        $source = $this->source_host((string) ($raw['referrer'] ?? $request->get_header('Referer')));
        $metadata = $this->sanitize_metadata($raw['metadata'] ?? []);
        $geo = $this->geo_context($request, $raw);
        $user_agent = (string) $request->get_header('User-Agent');
        $experiment_id = absint($raw['experimentId'] ?? 0);
        $variant_key = $this->variant_key((string) ($raw['variantId'] ?? $raw['variantKey'] ?? ''));
        if ($experiment_id > 0 && !$this->valid_assignment($experiment_id, $variant_key)) {
            $experiment_id = 0;
            $variant_key = '';
        }
        return [
            'project_key' => self::project_scope_key($page_path),
            'event_uuid' => $uuid,
            'session_id' => $session,
            'visitor_id' => $visitor,
            'event_type' => $type,
            'event_name' => sanitize_text_field(substr((string) ($raw['name'] ?? ''), 0, 128)),
            'tracking_id' => $tracking,
            'page_path' => $page_path,
            'page_hash' => hash('sha256', $page_path),
            'source_host' => $source,
            'country_code' => $geo['country'],
            'region_name' => $geo['region'],
            'city_name' => $geo['city'],
            'timezone_name' => $geo['timezone'],
            'device_type' => $this->device_type((string) ($raw['device'] ?? ''), $user_agent),
            'browser_name' => $this->browser_name((string) ($raw['browser'] ?? ''), $request),
            'operating_system' => $this->operating_system((string) ($raw['operatingSystem'] ?? ''), $request),
            'viewport_width' => min(10000, absint($raw['viewportWidth'] ?? $metadata['viewport_width'] ?? 0)),
            'viewport_height' => min(10000, absint($raw['viewportHeight'] ?? $metadata['viewport_height'] ?? 0)),
            'scroll_depth' => min(100, absint($raw['scrollDepth'] ?? $metadata['scroll_depth'] ?? 0)),
            'element_key' => $this->element_selector((string) ($raw['elementKey'] ?? $metadata['element_selector'] ?? '')),
            'element_label' => sanitize_text_field(substr((string) ($raw['elementLabel'] ?? $metadata['element_label'] ?? ''), 0, 191)),
            'experiment_id' => $experiment_id,
            'variant_key' => $variant_key,
            'duration_ms' => min(DAY_IN_SECONDS * 1000, absint($raw['durationMs'] ?? 0)),
            'metadata' => wp_json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'ip_hash' => $this->request_fingerprint(),
            'occurred_at' => $occurred,
            'created_at' => gmdate('Y-m-d H:i:s'),
        ];
    }

    /**
     * Heartbeat pings keep "live visitors" accurate for readers who stay on a
     * page without interacting. They only refresh the session's last_seen and
     * never inflate pageviews or event counts.
     *
     * @param array<string,mixed> $event
     */
    private function touch_session_liveness(array $event): bool {
        global $wpdb;
        return $wpdb->query($wpdb->prepare(
            "INSERT INTO {$this->table('sessions')}
            (session_id,project_key,visitor_id,first_seen,last_seen,pageviews,event_count,engaged_ms,landing_page,exit_page,source_host,country_code,region_name,city_name,timezone_name,device_type,browser_name,operating_system,viewport_width,viewport_height,max_scroll_depth,ip_hash)
            VALUES (%s,%s,%s,%s,%s,0,0,0,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%d,%d,%d,%s)
            ON DUPLICATE KEY UPDATE
            last_seen=GREATEST(last_seen,VALUES(last_seen)),
            max_scroll_depth=GREATEST(max_scroll_depth,VALUES(max_scroll_depth))",
            $event['session_id'], $event['project_key'], $event['visitor_id'], $event['occurred_at'], $event['occurred_at'],
            $event['page_path'], $event['page_path'], $event['source_host'], $event['country_code'],
            $event['region_name'], $event['city_name'], $event['timezone_name'], $event['device_type'],
            $event['browser_name'], $event['operating_system'], $event['viewport_width'],
            $event['viewport_height'], $event['scroll_depth'], $event['ip_hash']
        )) !== false;
    }

    /**
     * @param array<string,mixed> $event
     * @return 'stored'|'duplicate'|WP_Error
     */
    private function store_event(array $event): string|WP_Error {
        if ($event['event_type'] === 'ping') {
            return $this->touch_session_liveness($event)
                ? 'stored'
                : new WP_Error(
                    'kodety_analytics_storage',
                    'Não foi possível persistir a sessão do visitante.',
                    ['status' => 503, 'retryable' => true]
                );
        }
        global $wpdb;
        $inserted = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO {$this->table('events')}
            (project_key,event_uuid,session_id,visitor_id,event_type,event_name,tracking_id,page_path,page_hash,source_host,country_code,region_name,city_name,timezone_name,device_type,browser_name,operating_system,viewport_width,viewport_height,scroll_depth,element_key,element_label,experiment_id,variant_key,duration_ms,metadata,ip_hash,occurred_at,created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%d,%d,%d,%s,%s,%d,%s,%d,%s,%s,%s,%s)",
            $event['project_key'], $event['event_uuid'], $event['session_id'], $event['visitor_id'], $event['event_type'],
            $event['event_name'], $event['tracking_id'], $event['page_path'], $event['page_hash'],
            $event['source_host'], $event['country_code'], $event['region_name'], $event['city_name'],
            $event['timezone_name'], $event['device_type'], $event['browser_name'], $event['operating_system'],
            $event['viewport_width'], $event['viewport_height'], $event['scroll_depth'], $event['element_key'],
            $event['element_label'], $event['experiment_id'], $event['variant_key'], $event['duration_ms'],
            $event['metadata'], $event['ip_hash'], $event['occurred_at'], $event['created_at']
        ));
        if ($inserted === false) {
            return new WP_Error(
                'kodety_analytics_storage',
                'Não foi possível persistir o evento.',
                ['status' => 503, 'retryable' => true]
            );
        }
        if ((int) $inserted === 0) return 'duplicate';
        $pageview = $event['event_type'] === 'pageview' ? 1 : 0;
        $session_updated = $wpdb->query($wpdb->prepare(
            "INSERT INTO {$this->table('sessions')}
            (session_id,project_key,visitor_id,first_seen,last_seen,pageviews,event_count,engaged_ms,landing_page,exit_page,source_host,country_code,region_name,city_name,timezone_name,device_type,browser_name,operating_system,viewport_width,viewport_height,max_scroll_depth,ip_hash)
            VALUES (%s,%s,%s,%s,%s,%d,1,%d,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%d,%d,%d,%s)
            ON DUPLICATE KEY UPDATE
            last_seen=GREATEST(last_seen,VALUES(last_seen)),
            pageviews=pageviews+VALUES(pageviews),
            event_count=event_count+1,
            engaged_ms=engaged_ms+VALUES(engaged_ms),
            exit_page=VALUES(exit_page),
            viewport_width=IF(viewport_width=0,VALUES(viewport_width),viewport_width),
            viewport_height=IF(viewport_height=0,VALUES(viewport_height),viewport_height),
            max_scroll_depth=GREATEST(max_scroll_depth,VALUES(max_scroll_depth))",
            $event['session_id'], $event['project_key'], $event['visitor_id'], $event['occurred_at'], $event['occurred_at'],
            $pageview, $event['duration_ms'], $event['page_path'], $event['page_path'],
            $event['source_host'], $event['country_code'], $event['region_name'], $event['city_name'],
            $event['timezone_name'], $event['device_type'], $event['browser_name'], $event['operating_system'],
            $event['viewport_width'], $event['viewport_height'], $event['scroll_depth'], $event['ip_hash']
        ));
        if ($session_updated === false) {
            return new WP_Error(
                'kodety_analytics_storage',
                'O evento não pôde ser associado à sessão do visitante.',
                ['status' => 503, 'retryable' => true]
            );
        }
        return 'stored';
    }

    public function assign(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->pro_feature_enabled('experiments')) {
            $response = new WP_REST_Response([
                'assigned' => false,
                'reason' => 'license_required',
            ]);
            $response->header('Cache-Control', 'private, no-store, max-age=0');
            return $response;
        }
        $allowed = $this->public_request_allowed($request);
        if (is_wp_error($allowed)) return $allowed;
        $payload = $request->get_json_params();
        if (!is_array($payload)) $payload = [];
        $visitor = $this->opaque_id((string) ($payload['visitorId'] ?? ''));
        if ($visitor === '') return new WP_Error('kodety_assignment_visitor', 'Identificador de visitante inválido.', ['status' => 400]);
        $experiment_identifier = $payload['experimentId'] ?? $payload['experimentKey'] ?? '';
        $experiment = $this->find_running_experiment(
            $this->resolve_experiment_database_id($experiment_identifier),
            $this->sanitize_page_path((string) ($payload['pagePath'] ?? '/'))
        );
        if (!$experiment) return new WP_Error('kodety_experiment_not_found', 'Experimento ativo não encontrado.', ['status' => 404]);
        $assignment = $this->choose_variant($experiment, $visitor, true);
        $response = new WP_REST_Response($assignment);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        return $response;
    }

    /** @return array<string,mixed>|null */
    private function find_running_experiment(int $id, string $page_path): ?array {
        global $wpdb;
        if ($id > 0) {
            $row = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$this->table('experiments')}
                 WHERE id=%d AND status='running' AND config_json LIKE %s",
                $id,
                $this->project_json_marker()
            ), ARRAY_A);
        } else {
            $row = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$this->table('experiments')}
                 WHERE page_hash=%s AND status='running' AND config_json LIKE %s
                 ORDER BY started_at ASC,id ASC LIMIT 1",
                hash('sha256', $page_path),
                $this->project_json_marker()
            ), ARRAY_A);
        }
        return is_array($row) ? $row : null;
    }

    /** @param array<string,mixed> $experiment @return array<string,mixed> */
    private function choose_variant(array $experiment, string $visitor, bool $write_cookie): array {
        global $wpdb;
        $id = (int) $experiment['id'];
        $variants = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$this->table('variants')} WHERE experiment_id=%d AND enabled=1 AND weight>0 ORDER BY id ASC",
            $id
        ), ARRAY_A);
        if (!$variants) return ['assigned' => false, 'experimentId' => $id, 'reason' => 'no_variants'];
        $config = $this->experiment_config($experiment);
        $cookie_name = 'kodety_exp_' . $id;
        $sticky = isset($_COOKIE[$cookie_name]) ? $this->variant_key(wp_unslash((string) $_COOKIE[$cookie_name])) : '';
        foreach ($variants as $variant) {
            if ($sticky !== '' && hash_equals((string) $variant['variant_key'], $sticky)) {
                return $this->assignment_payload($experiment, $variant);
            }
        }
        $traffic_bucket = hexdec(substr(hash_hmac('sha256', 'traffic|' . $visitor, (string) $experiment['assignment_salt']), 0, 8)) / 0xffffffff * 100;
        if ($traffic_bucket >= (float) $experiment['traffic_percent']) {
            return ['assigned' => false, 'experimentId' => $id, 'reason' => 'outside_traffic'];
        }
        if ($config['allocationMode'] === 'equal') {
            $variants = array_map(static function (array $variant): array {
                $variant['weight'] = 1;
                return $variant;
            }, $variants);
        } elseif ($config['allocationMode'] === 'adaptive') {
            $variants = $this->adaptive_variant_weights($experiment, $variants);
        }
        $total = array_sum(array_map(static fn(array $variant): float => (float) $variant['weight'], $variants));
        $point = hexdec(substr(hash_hmac('sha256', 'variant|' . $visitor, (string) $experiment['assignment_salt']), 0, 8)) / 0xffffffff * $total;
        $selected = end($variants);
        $cursor = 0.0;
        foreach ($variants as $variant) {
            $cursor += (float) $variant['weight'];
            if ($point <= $cursor) { $selected = $variant; break; }
        }
        if ($write_cookie) $this->set_public_cookie($cookie_name, (string) $selected['variant_key'], (int) $config['stickyDays'] * DAY_IN_SECONDS, true);
        return $this->assignment_payload($experiment, $selected);
    }

    /**
     * Multi-armed-bandit allocation with 20% exploration. Laplace smoothing
     * prevents a young variant from being starved after only a few visits.
     *
     * @param array<string,mixed> $experiment
     * @param array<int,array<string,mixed>> $variants
     * @return array<int,array<string,mixed>>
     */
    private function adaptive_variant_weights(array $experiment, array $variants): array {
        $cache_key = 'kodety_ab_weights_' . (int) $experiment['id'];
        $cached = get_transient($cache_key);
        if (is_array($cached)) {
            return array_map(static function (array $variant) use ($cached): array {
                if (isset($cached[$variant['variant_key']])) $variant['weight'] = (float) $cached[$variant['variant_key']];
                return $variant;
            }, $variants);
        }
        $start = !empty($experiment['started_at'])
            ? (string) $experiment['started_at']
            : gmdate('Y-m-d 00:00:00', time() - 29 * DAY_IN_SECONDS);
        $results = $this->experiment_results($experiment, $variants, $start, gmdate('Y-m-d 23:59:59'));
        $scores = [];
        foreach ($results as $result) {
            $views = max(0, (int) ($result['views'] ?? 0));
            $conversions = max(0, (int) ($result['conversions'] ?? 0));
            $scores[(string) ($result['variantId'] ?? '')] = ($conversions + 1) / ($views + 2);
        }
        $score_total = array_sum($scores);
        $count = max(1, count($variants));
        $weights = [];
        foreach ($variants as &$variant) {
            $key = (string) $variant['variant_key'];
            $exploration = 20 / $count;
            $exploitation = $score_total > 0
                ? 80 * ((float) ($scores[$key] ?? 0) / $score_total)
                : 80 / $count;
            $variant['weight'] = round($exploration + $exploitation, 4);
            $weights[$key] = $variant['weight'];
        }
        unset($variant);
        set_transient($cache_key, $weights, 5 * MINUTE_IN_SECONDS);
        return $variants;
    }

    /** @param array<string,mixed> $experiment @param array<string,mixed> $variant @return array<string,mixed> */
    private function assignment_payload(array $experiment, array $variant): array {
        $metadata = json_decode((string) ($variant['metadata'] ?? ''), true);
        $metadata = is_array($metadata) ? $metadata : [];
        $goal = ['type' => (string) $experiment['goal_type']];
        if ($experiment['goal_type'] === 'pageview') {
            $goal['pagePath'] = (string) $experiment['goal_tracking_id'];
            $goal['runtimePath'] = $this->public_path_for_project_path((string) $experiment['goal_tracking_id']);
        }
        elseif ($experiment['goal_type'] === 'custom') $goal['eventName'] = (string) $experiment['goal_tracking_id'];
        else {
            $goal['trackingId'] = (string) $experiment['goal_tracking_id'];
            $target = $this->click_goal_target((string) $experiment['goal_tracking_id']);
            if ($target) {
                $goal['targetType'] = $target['targetType'];
                $goal['targetValue'] = $target['targetValue'];
            }
        }
        $runtime_relative = !empty($variant['is_control'])
            ? ''
            : $this->runtime_relative_for_variant($experiment, $variant, true);
        return [
            'assigned' => true,
            'experimentId' => (int) $experiment['id'],
            'experimentKey' => (string) $experiment['external_id'],
            'variantId' => (string) $variant['variant_key'],
            'name' => (string) $variant['name'],
            'pageId' => (int) $variant['page_id'],
            'pagePath' => (string) $variant['page_path'],
            'documentKey' => (string) $variant['document_key'],
            'isControl' => (bool) $variant['is_control'],
            'publicSlug' => $this->public_variant_slug((string) ($metadata['public_slug'] ?? '')),
            'goal' => $goal,
            // Internal published clone selected by the PHP runtime. It is not
            // part of the normal manifest and cannot become a public page.
            'runtimeRelative' => $runtime_relative,
        ];
    }

    private function valid_assignment(int $experiment_id, string $variant_key): bool {
        if (!$this->pro_feature_enabled('experiments') || $experiment_id <= 0 || $variant_key === '') return false;
        global $wpdb;
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT 1
             FROM {$this->table('variants')} variants
             INNER JOIN {$this->table('experiments')} experiments ON experiments.id=variants.experiment_id
             WHERE variants.experiment_id=%d AND variants.variant_key=%s
             AND variants.enabled=1 AND variants.weight>0 AND experiments.status='running'
             AND experiments.config_json LIKE %s
             LIMIT 1",
            $experiment_id,
            $variant_key,
            $this->project_json_marker()
        ));
    }

    public function overview(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $range = $this->overview_date_range($request);
        if (is_wp_error($range)) return $range;
        [$start, $end] = $range;
        $events = $this->table('events');
        $sessions = $this->table('sessions');
        $session_scope = $this->project_sql_condition();
        $event_scope = $this->project_sql_condition();
        $summary = $wpdb->get_row($wpdb->prepare(
            "SELECT
                COUNT(DISTINCT visitor_id) unique_visitors,
                SUM(pageviews) total_pageviews,
                SUM(pageviews<=1) bounced_sessions,
                COUNT(*) total_sessions,
                AVG(TIMESTAMPDIFF(SECOND,first_seen,last_seen)) average_session_seconds
             FROM {$sessions} WHERE {$session_scope} AND first_seen BETWEEN %s AND %s",
            $start,
            $end
        ), ARRAY_A) ?: [];
        $live = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$sessions} WHERE {$session_scope} AND last_seen >= %s",
            gmdate('Y-m-d H:i:s', time() - 5 * MINUTE_IN_SECONDS)
        ));
        $series = $wpdb->get_results($wpdb->prepare(
            "SELECT DATE(occurred_at) day,
                SUM(event_type='pageview') pageviews,
                COUNT(DISTINCT IF(event_type='pageview',visitor_id,NULL)) visitors
             FROM {$events} WHERE {$event_scope} AND occurred_at BETWEEN %s AND %s
             GROUP BY DATE(occurred_at) ORDER BY day ASC",
            $start,
            $end
        ), ARRAY_A);
        $total_sessions = max(1, (int) ($summary['total_sessions'] ?? 0));
        $tracking = $this->pro_feature_enabled('analyticsUtms')
            ? $this->grouped_events('tracking_id', $start, $end, "tracking_id<>''")
            : [];
        return $this->private_response([
            'liveVisitors' => $live,
            'totalSessions' => (int) ($summary['total_sessions'] ?? 0),
            'uniqueVisitors' => (int) ($summary['unique_visitors'] ?? 0),
            'pageviews' => (int) ($summary['total_pageviews'] ?? 0),
            'bounceRate' => round((int) ($summary['bounced_sessions'] ?? 0) / $total_sessions * 100, 2),
            'averageSessionSeconds' => round((float) ($summary['average_session_seconds'] ?? 0)),
            'series' => array_map([$this, 'cast_series_row'], $series ?: []),
            'sources' => $this->grouped_sessions('source_host', $start, $end, 'Direto'),
            'countries' => $this->grouped_sessions('country_code', $start, $end, 'Desconhecido'),
            'locations' => $this->grouped_locations($start, $end),
            'devices' => $this->grouped_sessions('device_type', $start, $end),
            'browsers' => $this->grouped_sessions('browser_name', $start, $end),
            'operatingSystems' => $this->grouped_sessions('operating_system', $start, $end),
            'pages' => $this->grouped_events('page_path', $start, $end, "event_type='pageview'"),
            'tracking' => $tracking,
        ]);
    }

    public function page_insights(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->pro_feature_enabled('analyticsPageInsights')) {
            return $this->pro_feature_error(
                'analyticsPageInsights',
                'A Visão de página é um recurso Pro. Ative uma licença para visualizar estas métricas.'
            );
        }
        global $wpdb;
        [$start, $end] = $this->date_range($request);
        $events = $this->table('events');
        $sessions = $this->table('sessions');
        $event_scope = $this->project_sql_condition('events');
        $session_scope = $this->project_sql_condition('session');
        $plain_event_scope = $this->project_sql_condition();
        $requested_page = trim((string) $request->get_param('page'));
        if ($requested_page === '') {
            $requested_page = (string) $wpdb->get_var($wpdb->prepare(
                "SELECT page_path FROM {$events}
                 WHERE {$plain_event_scope} AND occurred_at BETWEEN %s AND %s AND event_type='pageview'
                 GROUP BY page_hash,page_path ORDER BY COUNT(*) DESC LIMIT 1",
                $start,
                $end
            ));
        }
        $page_path = $this->sanitize_page_path($requested_page !== '' ? $requested_page : '/');
        $page_hash = hash('sha256', $page_path);
        $device = sanitize_key((string) $request->get_param('device'));
        if (!in_array($device, ['desktop', 'mobile', 'tablet'], true)) $device = '';
        $device_sql = $device !== '' ? ' AND events.device_type=%s' : '';
        $arguments = [$start, $end, $page_hash];
        if ($device !== '') $arguments[] = $device;

        $summary = $wpdb->get_row($wpdb->prepare(
            "SELECT
                COUNT(DISTINCT events.session_id) total_sessions,
                COUNT(DISTINCT events.visitor_id) unique_visitors,
                SUM(events.event_type='pageview') pageviews,
                COUNT(DISTINCT IF(session.pageviews<=1,events.session_id,NULL)) bounced_sessions,
                AVG(IF(events.event_type='pageview' AND events.viewport_height>0,events.viewport_height,NULL)) average_fold
             FROM {$events} events
             LEFT JOIN {$sessions} session ON session.session_id=events.session_id AND {$session_scope}
             WHERE {$event_scope} AND events.occurred_at BETWEEN %s AND %s AND events.page_hash=%s{$device_sql}",
            ...$arguments
        ), ARRAY_A) ?: [];
        $total_sessions = (int) ($summary['total_sessions'] ?? 0);

        $scroll = $wpdb->get_row($wpdb->prepare(
            "SELECT
                COUNT(DISTINCT IF(events.scroll_depth>=25,events.session_id,NULL)) depth_25,
                COUNT(DISTINCT IF(events.scroll_depth>=50,events.session_id,NULL)) depth_50,
                COUNT(DISTINCT IF(events.scroll_depth>=75,events.session_id,NULL)) depth_75,
                COUNT(DISTINCT IF(events.scroll_depth>=90,events.session_id,NULL)) depth_90,
                COUNT(DISTINCT IF(events.scroll_depth>=100,events.session_id,NULL)) depth_100
             FROM {$events} events
             WHERE {$event_scope} AND events.occurred_at BETWEEN %s AND %s AND events.page_hash=%s{$device_sql}",
            ...$arguments
        ), ARRAY_A) ?: [];
        $average_scroll = (float) $wpdb->get_var($wpdb->prepare(
            "SELECT AVG(depths.max_depth) FROM (
                SELECT events.session_id,MAX(events.scroll_depth) max_depth
                FROM {$events} events
                WHERE {$event_scope} AND events.occurred_at BETWEEN %s AND %s AND events.page_hash=%s{$device_sql}
                GROUP BY events.session_id
             ) depths",
            ...$arguments
        ));

        $event_arguments = $arguments;
        $top_events = $wpdb->get_results($wpdb->prepare(
            "SELECT events.event_type,events.tracking_id,events.element_key,
                    MAX(events.element_label) element_label,
                    COUNT(*) event_count,COUNT(DISTINCT events.visitor_id) unique_visitors
             FROM {$events} events
             WHERE {$event_scope} AND events.occurred_at BETWEEN %s AND %s AND events.page_hash=%s{$device_sql}
             AND events.event_type IN ('click','submit','conversion','custom')
             AND NOT (events.event_type='custom' AND events.tracking_id='engagement')
             AND (events.element_key<>'' OR events.tracking_id<>'')
             GROUP BY events.event_type,events.tracking_id,events.element_key
             ORDER BY event_count DESC LIMIT 30",
            ...$event_arguments
        ), ARRAY_A);
        $depths = [25, 50, 75, 90, 100];

        return $this->private_response([
            'pagePath' => $page_path,
            'pageUrl' => home_url($page_path),
            'device' => $device === '' ? 'all' : $device,
            'totalSessions' => $total_sessions,
            'uniqueVisitors' => (int) ($summary['unique_visitors'] ?? 0),
            'pageviews' => (int) ($summary['pageviews'] ?? 0),
            'bounceRate' => $total_sessions > 0
                ? round((int) ($summary['bounced_sessions'] ?? 0) / $total_sessions * 100, 2)
                : 0,
            'averageFoldPx' => round((float) ($summary['average_fold'] ?? 0)),
            'averageScrollDepth' => round($average_scroll, 1),
            'scroll' => array_map(static function (int $depth) use ($scroll, $total_sessions): array {
                $sessions_at_depth = (int) ($scroll['depth_' . $depth] ?? 0);
                return [
                    'depth' => $depth,
                    'sessions' => $sessions_at_depth,
                    'percentage' => $total_sessions > 0
                        ? round($sessions_at_depth / $total_sessions * 100, 1)
                        : 0,
                ];
            }, $depths),
            'topEvents' => array_map(static function (array $row): array {
                $tracking = (string) $row['tracking_id'];
                $label = trim((string) $row['element_label']);
                if ($label === '') $label = $tracking !== '' ? $tracking : (string) $row['event_type'];
                return [
                    'key' => hash('sha256', implode('|', [
                        (string) $row['event_type'],
                        $tracking,
                        (string) $row['element_key'],
                    ])),
                    'type' => (string) $row['event_type'],
                    'trackingId' => $tracking,
                    'selector' => (string) $row['element_key'],
                    'label' => $label,
                    'count' => (int) $row['event_count'],
                    'uniqueVisitors' => (int) $row['unique_visitors'],
                ];
            }, $top_events ?: []),
        ]);
    }

    public function tracking_report(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->pro_feature_enabled('analyticsUtms')) {
            return $this->pro_feature_error(
                'analyticsUtms',
                'Os resultados da Central de UTMs são um recurso Pro. Ative uma licença para visualizá-los.'
            );
        }
        [$start, $end] = $this->date_range($request);
        return $this->private_response([
            'range' => ['start' => $start, 'end' => $end],
            'items' => $this->grouped_events('tracking_id', $start, $end, "tracking_id<>''"),
        ]);
    }

    /**
     * Diagnostic for public variant URLs. Rebuilds the route map from current
     * DB truth (self-healing), refreshes rewrite rules, and reports both the
     * registered routes and every running variant so a missing/invalid public
     * URL can be pinpointed without server access.
     */
    public function debug_variant_routes(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->pro_feature_enabled('experiments')) {
            return $this->pro_feature_error(
                'experiments',
                'Os diagnósticos e resultados de A/B Tests são recursos Pro. Ative uma licença para visualizá-los.'
            );
        }
        global $wpdb;
        $this->rebuild_public_variant_routes();
        $routes = get_option(self::PUBLIC_ROUTES_OPTION, []);
        $route_report = [];
        if (is_array($routes)) {
            foreach ($routes as $slug => $entry) {
                if (!is_array($entry)) continue;
                $source_id = (int) ($entry['source_page_id'] ?? 0);
                $runtime_relative = ltrim((string) ($entry['runtime_relative'] ?? ''), '/');
                $route_report[(string) $slug] = [
                    'publicUrl' => home_url('/' . (string) $slug),
                    'experimentId' => (int) ($entry['experiment_id'] ?? 0),
                    'variantKey' => (string) ($entry['variant_key'] ?? ''),
                    'sourcePageId' => $source_id,
                    'sourcePageExists' => $source_id > 0 && get_post($source_id) instanceof WP_Post,
                    'runtimeRelative' => $runtime_relative,
                    'cloneExists' => $this->validated_runtime_file($runtime_relative) !== '',
                ];
            }
        }
        $rows = $wpdb->get_results(
            "SELECT v.variant_key, v.enabled, v.is_control, v.weight, v.metadata, e.status, e.external_id, e.source_page_id
             FROM {$this->table('variants')} v
             INNER JOIN {$this->table('experiments')} e ON e.id = v.experiment_id
             ORDER BY e.id ASC, v.id ASC",
            ARRAY_A
        );
        $variant_report = [];
        foreach ((array) $rows as $row) {
            $meta = json_decode((string) ($row['metadata'] ?? ''), true);
            $meta = is_array($meta) ? $meta : [];
            $variant_report[] = [
                'experiment' => (string) $row['external_id'],
                'experimentStatus' => (string) $row['status'],
                'variantKey' => (string) $row['variant_key'],
                'enabled' => (int) $row['enabled'],
                'isControl' => (int) $row['is_control'],
                'weight' => (float) $row['weight'],
                'publicSlug' => (string) ($meta['public_slug'] ?? ''),
                'hasClone' => str_starts_with((string) ($meta['runtime_relative'] ?? ''), '.kodety-experiments/'),
                'sourcePageId' => (int) $row['source_page_id'],
            ];
        }
        return $this->private_response([
            'routeCount' => count($route_report),
            'routes' => $route_report,
            'variants' => $variant_report,
            'runtimeStorage' => 'private',
        ]);
    }

    /** @return array<string,mixed> */
    public function cast_series_row(array $row): array {
        return [
            'timestamp' => (string) $row['day'] . 'T00:00:00Z',
            'uniqueVisitors' => (int) $row['visitors'],
            'pageviews' => (int) $row['pageviews'],
        ];
    }

    /**
     * @param string $empty_label When set, sessions with an empty value are kept
     *   and shown under this label (e.g. direct traffic). When '', they are
     *   excluded from the breakdown.
     * @return array<int,array<string,mixed>>
     */
    private function grouped_sessions(string $column, string $start, string $end, string $empty_label = ''): array {
        global $wpdb;
        $allowed = ['source_host', 'country_code', 'device_type', 'browser_name', 'operating_system'];
        if (!in_array($column, $allowed, true)) return [];
        $condition = $empty_label === '' ? "AND {$column}<>''" : '';
        $scope = $this->project_sql_condition();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT {$column} label,COUNT(*) value FROM {$this->table('sessions')}
             WHERE {$scope} AND first_seen BETWEEN %s AND %s {$condition}
             GROUP BY {$column} ORDER BY value DESC LIMIT 12",
            $start,
            $end
        ), ARRAY_A);
        return array_map(static function (array $row) use ($empty_label): array {
            $raw = (string) $row['label'];
            return [
                'key' => $raw === '' ? '__direct__' : $raw,
                'label' => $raw === '' ? $empty_label : $raw,
                'value' => (int) $row['value'],
            ];
        }, $rows ?: []);
    }

    /** @return array<int,array<string,mixed>> */
    private function grouped_locations(string $start, string $end): array {
        global $wpdb;
        $scope = $this->project_sql_condition();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT country_code,region_name,city_name,COUNT(*) value
             FROM {$this->table('sessions')}
             WHERE {$scope} AND first_seen BETWEEN %s AND %s
             AND (country_code<>'' OR region_name<>'' OR city_name<>'')
             GROUP BY country_code,region_name,city_name
             ORDER BY value DESC LIMIT 20",
            $start,
            $end
        ), ARRAY_A);
        return array_map(static function (array $row): array {
            $parts = array_values(array_filter([
                trim((string) $row['city_name']),
                trim((string) $row['region_name']),
                trim((string) $row['country_code']),
            ]));
            $key = implode('|', $parts);
            return [
                'key' => $key,
                'label' => implode(', ', $parts),
                'value' => (int) $row['value'],
            ];
        }, $rows ?: []);
    }

    /** @return array<int,array<string,mixed>> */
    private function grouped_events(string $column, string $start, string $end, string $condition): array {
        global $wpdb;
        $allowed = ['page_path', 'tracking_id'];
        if (!in_array($column, $allowed, true)) return [];
        $scope = $this->project_sql_condition();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT {$column} label,COUNT(*) value,COUNT(DISTINCT visitor_id) uniques
             FROM {$this->table('events')} WHERE {$scope} AND occurred_at BETWEEN %s AND %s AND {$condition}
             GROUP BY {$column} ORDER BY value DESC LIMIT 20",
            $start,
            $end
        ), ARRAY_A);
        return array_map(static fn(array $row): array => [
            'key' => (string) $row['label'],
            'label' => (string) $row['label'],
            'value' => (int) $row['value'],
            'secondaryLabel' => (int) $row['uniques'] . ' únicos',
        ], $rows ?: []);
    }

    /** @return array{0:string,1:string}|WP_Error */
    private function overview_date_range(WP_REST_Request $request): array|WP_Error {
        if ($this->pro_feature_enabled('analyticsHistory')) return $this->date_range($request);

        // The Free history boundary is an authorization decision. Derive it
        // from the site clock, never from a caller-controlled timezone that
        // could move "today" across the seven-day entitlement window.
        $timezone = $this->site_analytics_timezone();
        $today = (new DateTimeImmutable('now', $timezone))->setTime(0, 0, 0);
        $days = class_exists('Kodety_Edition')
            ? Kodety_Edition::limit('analyticsHistoryDays')
            : null;
        // A missing or malformed edition contract must fail closed to the
        // public Free allowance, never restore historical pagination.
        $days = max(1, min(7, is_int($days) ? $days : 7));
        $minimum = $today->modify('-' . ($days - 1) . ' days');

        $end_raw = $request->get_param('to');
        if ($end_raw === null || $end_raw === '') $end_raw = $request->get_param('end');
        $start_raw = $request->get_param('from');
        if ($start_raw === null || $start_raw === '') $start_raw = $request->get_param('start');

        $end = $end_raw === null || $end_raw === ''
            ? $today
            : $this->strict_analytics_local_date($end_raw, $timezone);
        $start = $start_raw === null || $start_raw === ''
            ? $minimum
            : $this->strict_analytics_local_date($start_raw, $timezone);
        if (
            !($start instanceof DateTimeImmutable)
            || !($end instanceof DateTimeImmutable)
            || $end->format('Y-m-d') !== $today->format('Y-m-d')
            || $start < $minimum
            || $start > $end
            || !in_array($start->format('Y-m-d'), [$minimum->format('Y-m-d'), $today->format('Y-m-d')], true)
        ) {
            return $this->pro_feature_error(
                'analyticsHistory',
                sprintf(
                    'O plano Free permite consultar somente hoje ou os %d dias atuais do Analytics.',
                    $days
                )
            );
        }

        $utc = new DateTimeZone('UTC');
        return [
            $start->setTime(0, 0, 0)->setTimezone($utc)->format('Y-m-d H:i:s'),
            $end->setTime(23, 59, 59)->setTimezone($utc)->format('Y-m-d H:i:s'),
        ];
    }

    private function analytics_timezone(WP_REST_Request $request): DateTimeZone {
        $timezone_name = sanitize_text_field((string) $request->get_param('timezone'));
        try {
            return new DateTimeZone($timezone_name !== '' ? $timezone_name : 'UTC');
        } catch (Exception) {
            return new DateTimeZone('UTC');
        }
    }

    private function site_analytics_timezone(): DateTimeZone {
        if (function_exists('wp_timezone')) {
            try {
                $timezone = wp_timezone();
                if ($timezone instanceof DateTimeZone) return $timezone;
            } catch (Throwable) {
                // Fall through to the stable UTC boundary below.
            }
        }
        return new DateTimeZone('UTC');
    }

    private function strict_analytics_local_date(mixed $value, DateTimeZone $timezone): ?DateTimeImmutable {
        if (!is_scalar($value)) return null;
        $value = trim((string) $value);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) return null;
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $timezone);
        $errors = DateTimeImmutable::getLastErrors();
        if (
            !$date instanceof DateTimeImmutable
            || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
            || $date->format('Y-m-d') !== $value
        ) return null;
        return $date;
    }

    /** @return array{0:string,1:string} */
    private function date_range(WP_REST_Request $request): array {
        $timezone = $this->analytics_timezone($request);

        $now = new DateTimeImmutable('now', $timezone);
        $end = $this->analytics_local_date(
            (string) ($request->get_param('to') ?: $request->get_param('end')),
            $timezone,
            $now
        )->setTime(23, 59, 59);
        $start_input = (string) ($request->get_param('from') ?: $request->get_param('start'));
        $start = $start_input !== ''
            ? $this->analytics_local_date($start_input, $timezone, $end)->setTime(0, 0, 0)
            : $end->setTime(0, 0, 0)->modify('-29 days');

        if ($start > $end) $start = $end->setTime(0, 0, 0);
        $minimum = $end->setTime(0, 0, 0)->modify('-366 days');
        if ($start < $minimum) $start = $minimum;

        $utc = new DateTimeZone('UTC');
        return [
            $start->setTimezone($utc)->format('Y-m-d H:i:s'),
            $end->setTimezone($utc)->format('Y-m-d H:i:s'),
        ];
    }

    private function analytics_local_date(
        string $value,
        DateTimeZone $timezone,
        DateTimeImmutable $fallback
    ): DateTimeImmutable {
        $value = trim($value);
        if ($value === '') return $fallback;
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $timezone);
        $errors = DateTimeImmutable::getLastErrors();
        if (
            $date instanceof DateTimeImmutable
            && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))
        ) {
            return $date;
        }
        return $fallback;
    }

    public function list_funnels(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $summary_only = rest_sanitize_boolean($request->get_param('summary'));
        if (!$summary_only && !$this->pro_feature_enabled('analyticsFunnels')) {
            return $this->pro_feature_error(
                'analyticsFunnels',
                'Os resultados de funis são um recurso Pro. Ative uma licença para calculá-los.'
            );
        }
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$this->table('funnels')} WHERE filters_json LIKE %s ORDER BY updated_at DESC,id DESC",
            $this->project_json_marker()
        ), ARRAY_A);
        $funnels = array_map(fn (array $row): array => $this->format_funnel($row), $rows ?: []);

        // The sidebar only needs saved definitions. Calculating every graph is
        // the expensive part of this endpoint, so summary requests return
        // before parsing the date range or scanning Analytics events.
        if ($summary_only) {
            return $this->private_response($funnels);
        }

        [$start, $end] = $this->date_range($request);
        return $this->private_response(array_map(function (array $funnel) use ($start, $end): array {
            $graph = $this->calculate_funnel_graph($funnel['steps'], $funnel['connections'], $funnel['filters'], $start, $end, (int) $funnel['windowMinutes']);
            $funnel['results'] = $graph['steps'];
            $funnel['connectionResults'] = $graph['connections'];
            return $funnel;
        }, $funnels));
    }

    public function get_funnel(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->pro_feature_enabled('analyticsFunnels')) {
            return $this->pro_feature_error(
                'analyticsFunnels',
                'Os resultados de funis são um recurso Pro. Ative uma licença para calculá-los.'
            );
        }
        $funnel = $this->funnel_row(absint($request['id']));
        if (!$funnel) return new WP_Error('kodety_funnel_not_found', 'Funil não encontrado.', ['status' => 404]);
        [$start, $end] = $this->date_range($request);
        $data = $this->format_funnel($funnel);
        $graph = $this->calculate_funnel_graph($data['steps'], $data['connections'], $data['filters'], $start, $end, (int) $data['windowMinutes']);
        $data['results'] = $graph['steps'];
        $data['connectionResults'] = $graph['connections'];
        return $this->private_response($data);
    }

    public function create_funnel(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $input = $this->sanitize_funnel_input($request->get_json_params());
        if (is_wp_error($input)) return $input;
        if ($input['status'] === 'active' && !$this->pro_feature_enabled('analyticsFunnels')) {
            return $this->pro_feature_error(
                'analyticsFunnels',
                'Ativar funis é um recurso Pro. Salve o funil pausado ou ative uma licença.'
            );
        }
        $now = gmdate('Y-m-d H:i:s');
        $wpdb->insert($this->table('funnels'), [
            'name' => $input['name'],
            'status' => $input['status'],
            'steps_json' => wp_json_encode($input['steps']),
            'filters_json' => wp_json_encode($this->funnel_filters_payload($input, [
                'projectKey' => self::project_scope_key(),
            ])),
            'created_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        if (!$wpdb->insert_id) return new WP_Error('kodety_funnel_create', 'Não foi possível criar o funil.', ['status' => 500]);
        return $this->private_response($this->format_funnel($this->funnel_row((int) $wpdb->insert_id)), 201);
    }

    public function update_funnel(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = absint($request['id']);
        $existing = $this->funnel_row($id);
        if (!$existing) return new WP_Error('kodety_funnel_not_found', 'Funil não encontrado.', ['status' => 404]);
        $existing_steps = json_decode((string) ($existing['steps_json'] ?? ''), true);
        $input = $this->sanitize_funnel_input(
            $request->get_json_params(),
            is_array($existing_steps) ? $existing_steps : []
        );
        if (is_wp_error($input)) return $input;
        if ($input['status'] === 'active' && !$this->pro_feature_enabled('analyticsFunnels')) {
            return $this->pro_feature_error(
                'analyticsFunnels',
                'Ativar funis é um recurso Pro. Salve o funil pausado ou ative uma licença.'
            );
        }
        $updated = $wpdb->update($this->table('funnels'), [
            'name' => $input['name'],
            'status' => $input['status'],
            'steps_json' => wp_json_encode($input['steps']),
            'filters_json' => wp_json_encode($this->funnel_filters_payload($input, [
                'projectKey' => self::project_scope_key(),
            ])),
            'updated_at' => gmdate('Y-m-d H:i:s'),
        ], ['id' => $id]);
        if ($updated === false) {
            return new WP_Error('kodety_funnel_update', 'Não foi possível salvar o funil.', ['status' => 500]);
        }
        return $this->private_response($this->format_funnel($this->funnel_row($id)));
    }

    public function delete_funnel(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = absint($request['id']);
        if (!$this->funnel_row($id)) return new WP_Error('kodety_funnel_not_found', 'Funil não encontrado.', ['status' => 404]);
        if ($wpdb->delete($this->table('funnels'), ['id' => $id], ['%d']) !== 1) {
            return new WP_Error('kodety_funnel_delete', 'Não foi possível excluir o funil.', ['status' => 500]);
        }
        return $this->private_response(['deleted' => true, 'id' => (string) $id]);
    }

    public function email_automation_options(): WP_REST_Response {
        $lists = class_exists('Kodety_Email_Contacts')
            ? Kodety_Email_Contacts::lists(false)
            : [];
        return $this->private_response([
            'lists' => array_map(static fn(array $list): array => [
                'id' => (int) $list['id'],
                'name' => (string) $list['name'],
            ], is_array($lists) ? $lists : []),
        ]);
    }

    /**
     * Execute immediate action nodes reached from a submitted form. The legacy
     * method name remains public because existing installations already hook
     * it, but the action graph now supports both contact and webhook nodes.
     */
    public function run_funnel_email_actions(array $submission): void {
        if (!$this->pro_feature_enabled('analyticsFunnels')) return;
        global $wpdb;
        $funnels = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id,name,steps_json,filters_json FROM {$this->table('funnels')}
                 WHERE status='active' AND filters_json LIKE %s",
                $this->project_json_marker()
            ),
            ARRAY_A
        );
        foreach (is_array($funnels) ? $funnels : [] as $funnel) {
            $steps = json_decode((string) $funnel['steps_json'], true);
            $stored = json_decode((string) $funnel['filters_json'], true);
            $connections = is_array($stored['settings']['connections'] ?? null)
                ? $stored['settings']['connections']
                : [];
            if (!is_array($steps) || !$connections) continue;
            $step_by_id = [];
            foreach ($steps as $step) {
                if (is_array($step)) $step_by_id[(string) ($step['id'] ?? '')] = $step;
            }
            $outgoing = [];
            foreach ($connections as $connection) {
                if (!is_array($connection)) continue;
                $source_id = (string) ($connection['sourceStepId'] ?? '');
                $target_id = (string) ($connection['targetStepId'] ?? '');
                if (!isset($step_by_id[$source_id], $step_by_id[$target_id])) continue;
                $outgoing[$source_id][] = $target_id;
            }
            $queue = [];
            foreach ($step_by_id as $step_id => $source) {
                if ((string) ($source['type'] ?? '') !== 'submit') continue;
                $tracking_id = (string) ($source['trackingId'] ?? '');
                if ($tracking_id !== '' && !hash_equals($tracking_id, (string) ($submission['form'] ?? ''))) continue;
                $queue[] = $step_id;
            }
            $executed = [];
            while ($queue) {
                $source_id = (string) array_shift($queue);
                foreach ($outgoing[$source_id] ?? [] as $target_id) {
                    if (isset($executed[$target_id])) continue;
                    $action = $step_by_id[$target_id] ?? null;
                    $action_type = is_array($action) ? (string) ($action['type'] ?? '') : '';
                    if (!in_array($action_type, ['email', 'webhook'], true)) continue;
                    $executed[$target_id] = true;
                    if ($action_type === 'email') {
                        $this->execute_funnel_email_action((int) $funnel['id'], $action, $submission);
                    } else {
                        $this->execute_funnel_webhook_action(
                            (int) $funnel['id'],
                            (string) ($funnel['name'] ?? ''),
                            $action,
                            $submission
                        );
                    }
                    $queue[] = $target_id;
                }
            }
        }
    }

    /** @param array<string,mixed> $action @param array<string,mixed> $submission */
    private function execute_funnel_email_action(int $funnel_id, array $action, array $submission): void {
        if (!class_exists('Kodety_Email_Contacts')) return;
        $fields = is_array($submission['fields'] ?? null) ? $submission['fields'] : [];
        $email_field = sanitize_key((string) ($action['emailField'] ?? 'email'));
        $name_field = sanitize_key((string) ($action['nameField'] ?? 'name'));
        $email = sanitize_email((string) ($fields[$email_field] ?? $submission['email'] ?? ''));
        $name = sanitize_text_field((string) ($fields[$name_field] ?? $submission['name'] ?? ''));
        if ($email === '' || !is_email($email)) return;
        $consent_field = sanitize_key((string) ($action['consentField'] ?? ''));
        $consent = $consent_field !== '' && $this->funnel_truthy($fields[$consent_field] ?? null);
        $contact_id = Kodety_Email_Contacts::upsert([
            'email' => $email,
            'name' => $name,
            'status' => $consent ? 'subscribed' : 'pending',
            'consent_source' => 'kodety_funnel_' . $funnel_id,
            'attributes' => [
                'funnel_id' => $funnel_id,
                'form' => (string) ($submission['form'] ?? ''),
                'page_url' => (string) ($submission['pageUrl'] ?? ''),
            ],
        ]);
        if ($contact_id <= 0) return;
        $email_action = (string) ($action['emailAction'] ?? 'upsert-contact');
        if ($email_action === 'add-to-list') {
            Kodety_Email_Contacts::add_to_list(
                absint($action['emailListId'] ?? 0),
                $contact_id,
                'kodety_funnel_' . $funnel_id
            );
        }
    }

    /** @param array<string,mixed> $action @param array<string,mixed> $submission */
    private function execute_funnel_webhook_action(
        int $funnel_id,
        string $funnel_name,
        array $action,
        array $submission
    ): void {
        $endpoint = $this->sanitize_funnel_webhook_url((string) ($action['webhookUrl'] ?? ''));
        if (is_wp_error($endpoint)) return;
        $method = strtoupper((string) ($action['webhookMethod'] ?? 'POST'));
        if (!in_array($method, ['POST', 'PUT', 'PATCH'], true)) $method = 'POST';
        $event = $this->sanitize_funnel_webhook_event($action['webhookEvent'] ?? 'form.submitted');
        if ($event === '') $event = 'form.submitted';
        $fields = $this->sanitize_funnel_webhook_fields($submission['fields'] ?? []);
        $safe_submission = [
            'id' => sanitize_text_field(substr((string) ($submission['id'] ?? ''), 0, 128)),
            'form' => $this->tracking_id((string) ($submission['form'] ?? '')),
            'name' => sanitize_text_field(substr((string) ($submission['name'] ?? ''), 0, 256)),
            'email' => sanitize_email((string) ($submission['email'] ?? '')),
            'subject' => sanitize_text_field(substr((string) ($submission['subject'] ?? ''), 0, 256)),
            'fields' => $fields,
            'pageUrl' => esc_url_raw(substr((string) ($submission['pageUrl'] ?? ''), 0, 2048)),
            'createdAt' => sanitize_text_field(substr((string) ($submission['createdAt'] ?? ''), 0, 64)),
            'cmsItem' => $this->sanitize_funnel_webhook_value($submission['cmsItem'] ?? null),
        ];
        $delivery_id = wp_generate_uuid4();
        $payload = [
            'event' => $event,
            'deliveryId' => $delivery_id,
            'occurredAt' => gmdate('c'),
            'funnel' => [
                'id' => (string) $funnel_id,
                'name' => sanitize_text_field(substr($funnel_name, 0, 191)),
            ],
            'action' => [
                'id' => (string) ($action['id'] ?? ''),
                'name' => sanitize_text_field(substr((string) ($action['name'] ?? ''), 0, 128)),
            ],
            'data' => (string) ($action['webhookPayloadMode'] ?? 'submission') === 'fields'
                ? $fields
                : $safe_submission,
        ];
        $json = wp_json_encode($payload, JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) return;
        $headers = [
            'Content-Type' => 'application/json; charset=utf-8',
            'Accept' => 'application/json',
            'User-Agent' => 'Kodety-Funnel-Webhook/1.0',
            'X-Kodety-Event' => $event,
            'X-Kodety-Delivery' => $delivery_id,
        ];
        $encrypted_secret = (string) ($action['webhookSecretEncrypted'] ?? '');
        if ($encrypted_secret !== '') {
            $secret = $this->decrypt_funnel_webhook_secret($encrypted_secret);
            if (is_wp_error($secret) || $secret === '') return;
            $headers['X-Kodety-Signature'] = 'sha256=' . hash_hmac('sha256', $json, $secret);
        }
        $response = wp_safe_remote_request($endpoint, [
            'method' => $method,
            'timeout' => 8,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'headers' => $headers,
            'body' => $json,
            'data_format' => 'body',
        ]);
        do_action('kodety_funnel_webhook_delivery', [
            'funnelId' => $funnel_id,
            'actionId' => (string) ($action['id'] ?? ''),
            'deliveryId' => $delivery_id,
            'statusCode' => is_wp_error($response) ? 0 : (int) wp_remote_retrieve_response_code($response),
            'error' => is_wp_error($response) ? $response->get_error_code() : '',
        ]);
    }

    private function sanitize_funnel_webhook_url(string $value): string|WP_Error {
        $value = trim(substr($value, 0, 2048));
        $url = esc_url_raw($value, ['https']);
        if (
            $value === ''
            || $url === ''
            || strtolower((string) wp_parse_url($url, PHP_URL_SCHEME)) !== 'https'
            || !wp_http_validate_url($url)
        ) {
            return new WP_Error(
                'kodety_funnel_webhook_url',
                'Use uma URL HTTPS pública e válida para o webhook.',
                ['status' => 400]
            );
        }
        return $url;
    }

    private function sanitize_funnel_webhook_event(mixed $value): string {
        $event = substr(trim((string) $value), 0, 128);
        return preg_replace('/[^a-zA-Z0-9._:-]/', '', $event) ?: '';
    }

    /** @return array<string|int,mixed> */
    private function sanitize_funnel_webhook_fields(mixed $raw): array {
        if (!is_array($raw)) return [];
        $clean = [];
        foreach (array_slice($raw, 0, 100, true) as $key => $value) {
            $field = is_int($key)
                ? $key
                : sanitize_text_field(substr((string) $key, 0, 128));
            if (
                $field === ''
                || (
                    is_string($field)
                    && preg_match('/pass(word)?|secret|token|authorization|cookie|captcha/i', $field)
                )
            ) continue;
            $clean[$field] = $this->sanitize_funnel_webhook_value($value, 1);
        }
        return $clean;
    }

    private function sanitize_funnel_webhook_value(mixed $value, int $depth = 0): mixed {
        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) return $value;
        if (is_string($value)) return sanitize_text_field(substr($value, 0, 4000));
        if (!is_array($value) || $depth >= 3) return null;
        $clean = [];
        foreach (array_slice($value, 0, 100, true) as $key => $nested) {
            $nested_key = is_int($key)
                ? $key
                : sanitize_text_field(substr((string) $key, 0, 128));
            if (
                $nested_key === ''
                || (
                    is_string($nested_key)
                    && preg_match('/pass(word)?|secret|token|authorization|cookie|captcha/i', $nested_key)
                )
            ) continue;
            $clean[$nested_key] = $this->sanitize_funnel_webhook_value($nested, $depth + 1);
        }
        return $clean;
    }

    private function encrypt_funnel_webhook_secret(string $plain): string|WP_Error {
        if ($plain === '') return '';
        if (!function_exists('openssl_encrypt')) {
            return new WP_Error(
                'kodety_funnel_webhook_crypto',
                'OpenSSL é necessário para proteger o segredo do webhook.',
                ['status' => 503]
            );
        }
        try {
            $iv = random_bytes(12);
        } catch (Throwable) {
            return new WP_Error(
                'kodety_funnel_webhook_crypto',
                'Não foi possível proteger o segredo do webhook.',
                ['status' => 503]
            );
        }
        $tag = '';
        $key = hash('sha256', wp_salt('auth') . '|' . self::FUNNEL_WEBHOOK_SECRET_CONTEXT, true);
        $cipher = openssl_encrypt(
            $plain,
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            self::FUNNEL_WEBHOOK_SECRET_CONTEXT,
            16
        );
        if (!is_string($cipher) || strlen($tag) !== 16) {
            return new WP_Error(
                'kodety_funnel_webhook_crypto',
                'Não foi possível proteger o segredo do webhook.',
                ['status' => 503]
            );
        }
        return self::FUNNEL_WEBHOOK_SECRET_PREFIX . base64_encode($iv . $tag . $cipher);
    }

    private function decrypt_funnel_webhook_secret(string $stored): string|WP_Error {
        if (
            $stored === ''
            || !str_starts_with($stored, self::FUNNEL_WEBHOOK_SECRET_PREFIX)
            || !function_exists('openssl_decrypt')
        ) {
            return new WP_Error(
                'kodety_funnel_webhook_crypto',
                'O segredo salvo do webhook não pôde ser lido.',
                ['status' => 503]
            );
        }
        $raw = base64_decode(substr($stored, strlen(self::FUNNEL_WEBHOOK_SECRET_PREFIX)), true);
        if (!is_string($raw) || strlen($raw) < 29) {
            return new WP_Error(
                'kodety_funnel_webhook_crypto',
                'O segredo salvo do webhook está corrompido.',
                ['status' => 503]
            );
        }
        $key = hash('sha256', wp_salt('auth') . '|' . self::FUNNEL_WEBHOOK_SECRET_CONTEXT, true);
        $plain = openssl_decrypt(
            substr($raw, 28),
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            substr($raw, 0, 12),
            substr($raw, 12, 16),
            self::FUNNEL_WEBHOOK_SECRET_CONTEXT
        );
        return is_string($plain)
            ? $plain
            : new WP_Error(
                'kodety_funnel_webhook_crypto',
                'O segredo salvo do webhook não pôde ser lido.',
                ['status' => 503]
            );
    }

    private function funnel_truthy(mixed $value): bool {
        if (is_bool($value)) return $value;
        if (is_numeric($value)) return (float) $value > 0;
        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'sim', 'on', 'checked', 'aceito', 'accepted'], true);
    }

    /** @return array<string,mixed>|null */
    private function funnel_row(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('funnels')} WHERE id=%d AND filters_json LIKE %s",
            $id,
            $this->project_json_marker()
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /**
     * Build the stored `filters_json` payload, keeping the wrapper shape that
     * also carries the conversion-window setting. Preserved as an array wrapper
     * so `format_funnel` reads window/settings uniformly for dashboard and
     * project funnels.
     *
     * @param array<string,mixed> $input
     * @return array<string,mixed>
     */
    private function funnel_filters_payload(array $input, array $extra = []): array {
        return array_merge([
            'items' => $input['filters'] ?? [],
            'settings' => [
                'windowMinutes' => $this->sanitize_funnel_window_minutes($input['window_minutes'] ?? 0),
                'connections' => $input['connections'] ?? [],
                'canvas' => $input['canvas'] ?? ['x' => 0, 'y' => 0, 'zoom' => 1],
            ],
        ], $extra);
    }

    /** @param mixed $stored_filters @return int */
    private function funnel_window_from_filters(mixed $stored_filters): int {
        $minutes = is_array($stored_filters) && isset($stored_filters['settings']['windowMinutes'])
            ? $stored_filters['settings']['windowMinutes']
            : 0;
        return $this->sanitize_funnel_window_minutes($minutes);
    }

    /** @return array<string,mixed> */
    private function format_funnel(?array $row): array {
        if (!$row) return [];
        $stored_filters = json_decode((string) $row['filters_json'], true);
        $filters = is_array($stored_filters) && isset($stored_filters['items']) && is_array($stored_filters['items'])
            ? $stored_filters['items']
            : (is_array($stored_filters) ? $stored_filters : []);
        $steps = json_decode((string) $row['steps_json'], true);
        $steps = is_array($steps) ? $steps : [];
        foreach ($steps as &$step) {
            if (!is_array($step) || (string) ($step['type'] ?? '') !== 'webhook') continue;
            $endpoint = (string) ($step['webhookUrl'] ?? '');
            $step['webhookUrlConfigured'] = $endpoint !== '';
            $step['webhookEndpoint'] = $endpoint !== ''
                ? (string) (wp_parse_url($endpoint, PHP_URL_HOST) ?: '')
                : '';
            $step['webhookSecretConfigured'] = (string) ($step['webhookSecretEncrypted'] ?? '') !== '';
            $step['webhookSecret'] = '';
            $step['webhookSecretClear'] = false;
            unset($step['webhookSecretEncrypted']);
            if (!current_user_can('kodety_manage_analytics')) $step['webhookUrl'] = '';
        }
        unset($step);
        return [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'enabled' => (string) $row['status'] === 'active',
            'steps' => $steps,
            'filters' => $filters,
            'windowMinutes' => $this->funnel_window_from_filters($stored_filters),
            'connections' => is_array($stored_filters['settings']['connections'] ?? null)
                ? $stored_filters['settings']['connections']
                : [],
            'canvas' => is_array($stored_filters['settings']['canvas'] ?? null)
                ? $stored_filters['settings']['canvas']
                : ['x' => 0, 'y' => 0, 'zoom' => 1],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }

    /** @return array<string,mixed>|WP_Error */
    private function sanitize_funnel_input(mixed $raw, array $existing_steps = []): array|WP_Error {
        if (!is_array($raw)) return new WP_Error('kodety_funnel_payload', 'Funil inválido.', ['status' => 400]);
        $name = sanitize_text_field(substr((string) ($raw['name'] ?? ''), 0, 191));
        $steps = isset($raw['steps']) && is_array($raw['steps']) ? array_slice($raw['steps'], 0, self::MAX_FUNNEL_STEPS) : [];
        $existing_by_id = [];
        foreach ($existing_steps as $existing_step) {
            if (!is_array($existing_step)) continue;
            $existing_id = $this->variant_key((string) ($existing_step['id'] ?? ''));
            if ($existing_id !== '') $existing_by_id[$existing_id] = $existing_step;
        }
        $clean = [];
        foreach ($steps as $index => $step) {
            if (!is_array($step)) continue;
            $type = sanitize_key((string) ($step['type'] ?? 'page'));
            if ($type === 'pageview') $type = 'page';
            if (!in_array($type, ['page', 'click', 'submit', 'custom', 'experiment', 'email', 'webhook'], true)) continue;
            $step_id = $this->variant_key((string) ($step['id'] ?? 'step-' . ($index + 1)));
            $position = isset($step['position']) && is_array($step['position']) ? $step['position'] : [];
            $email_action = $type === 'email' && (string) ($step['emailAction'] ?? '') === 'add-to-list'
                ? 'add-to-list'
                : ($type === 'email' ? 'upsert-contact' : '');
            $clean_step = [
                'id' => $step_id,
                'name' => sanitize_text_field(substr((string) ($step['name'] ?? 'Etapa ' . ($index + 1)), 0, 128)),
                'type' => $type,
                'pagePath' => !empty($step['pagePath'])
                    ? $this->public_path_for_project_path((string) $step['pagePath'])
                    : '',
                'trackingId' => $this->tracking_id((string) ($step['trackingId'] ?? '')),
                'eventName' => sanitize_text_field(substr((string) ($step['eventName'] ?? ''), 0, 128)),
                'experimentId' => $this->variant_key((string) ($step['experimentId'] ?? '')),
                'variantId' => $this->variant_key((string) ($step['variantId'] ?? '')),
                'emailAction' => $email_action,
                'emailListId' => absint($step['emailListId'] ?? 0),
                'emailField' => sanitize_key((string) ($step['emailField'] ?? 'email')),
                'nameField' => sanitize_key((string) ($step['nameField'] ?? 'name')),
                'consentField' => sanitize_key((string) ($step['consentField'] ?? '')),
                'position' => [
                    'x' => max(-100000, min(100000, (float) ($position['x'] ?? 80 + $index * 280))),
                    'y' => max(-100000, min(100000, (float) ($position['y'] ?? 140))),
                ],
            ];
            if ($type === 'webhook') {
                $endpoint = $this->sanitize_funnel_webhook_url((string) ($step['webhookUrl'] ?? ''));
                if (is_wp_error($endpoint)) return $endpoint;
                $method = strtoupper((string) ($step['webhookMethod'] ?? 'POST'));
                if (!in_array($method, ['POST', 'PUT', 'PATCH'], true)) $method = 'POST';
                $event = $this->sanitize_funnel_webhook_event($step['webhookEvent'] ?? 'form.submitted');
                if ($event === '') {
                    return new WP_Error(
                        'kodety_funnel_webhook_event',
                        'Informe um nome válido para o evento do webhook.',
                        ['status' => 400]
                    );
                }
                $encrypted_secret = '';
                $new_secret = trim((string) ($step['webhookSecret'] ?? ''));
                if ($new_secret !== '') {
                    if (strlen($new_secret) > 4096) {
                        return new WP_Error(
                            'kodety_funnel_webhook_secret',
                            'O segredo do webhook é muito longo.',
                            ['status' => 400]
                        );
                    }
                    $encrypted_secret = $this->encrypt_funnel_webhook_secret($new_secret);
                    if (is_wp_error($encrypted_secret)) return $encrypted_secret;
                } elseif (empty($step['webhookSecretClear'])) {
                    $encrypted_secret = (string) ($existing_by_id[$step_id]['webhookSecretEncrypted'] ?? '');
                }
                $clean_step['webhookUrl'] = $endpoint;
                $clean_step['webhookMethod'] = $method;
                $clean_step['webhookPayloadMode'] = (string) ($step['webhookPayloadMode'] ?? '') === 'fields'
                    ? 'fields'
                    : 'submission';
                $clean_step['webhookEvent'] = $event;
                $clean_step['webhookSecretEncrypted'] = $encrypted_secret;
            }
            $clean[] = $clean_step;
        }
        if ($name === '' || !$clean) return new WP_Error('kodety_funnel_required', 'Informe nome e pelo menos uma etapa.', ['status' => 400]);
        $enabled = array_key_exists('enabled', $raw)
            ? (bool) $raw['enabled']
            : (($raw['status'] ?? 'active') !== 'paused');
        return [
            'name' => $name,
            'status' => $enabled ? 'active' : 'paused',
            'steps' => $clean,
            'filters' => $this->sanitize_funnel_filters($raw['filters'] ?? []),
            'connections' => $this->sanitize_funnel_connections($raw['connections'] ?? [], $clean),
            'canvas' => $this->sanitize_funnel_canvas($raw['canvas'] ?? []),
            'window_minutes' => $this->sanitize_funnel_window_minutes($raw['windowMinutes'] ?? 0),
        ];
    }

    /** @param array<int,array<string,mixed>> $steps @return array<int,array<string,mixed>> */
    private function sanitize_funnel_connections(mixed $raw, array $steps): array {
        if (!is_array($raw)) return [];
        $step_ids = array_fill_keys(array_map(static fn(array $step): string => (string) $step['id'], $steps), true);
        $connections = [];
        foreach (array_slice($raw, 0, 64) as $index => $connection) {
            if (!is_array($connection)) continue;
            $source = $this->variant_key((string) ($connection['sourceStepId'] ?? ''));
            $target = $this->variant_key((string) ($connection['targetStepId'] ?? ''));
            if ($source === '' || $target === '' || $source === $target || !isset($step_ids[$source], $step_ids[$target])) continue;
            $connections[] = [
                'id' => $this->variant_key((string) ($connection['id'] ?? 'connection-' . ($index + 1))),
                'sourceStepId' => $source,
                'targetStepId' => $target,
                'label' => sanitize_text_field(substr((string) ($connection['label'] ?? ''), 0, 80)),
                'minDelayMinutes' => max(0, min(self::MAX_FUNNEL_WINDOW_MINUTES, absint($connection['minDelayMinutes'] ?? 0))),
                'maxDelayMinutes' => max(0, min(self::MAX_FUNNEL_WINDOW_MINUTES, absint($connection['maxDelayMinutes'] ?? 0))),
                'filters' => $this->sanitize_funnel_filters($connection['filters'] ?? []),
            ];
        }
        return $connections;
    }

    /** @return array{x:float,y:float,zoom:float} */
    private function sanitize_funnel_canvas(mixed $raw): array {
        if (!is_array($raw)) $raw = [];
        return [
            'x' => max(-100000, min(100000, (float) ($raw['x'] ?? 0))),
            'y' => max(-100000, min(100000, (float) ($raw['y'] ?? 0))),
            'zoom' => max(0.25, min(2, (float) ($raw['zoom'] ?? 1))),
        ];
    }

    /** Clamp the conversion window to whole minutes within [0, 30 days]. */
    private function sanitize_funnel_window_minutes(mixed $value): int {
        $minutes = is_numeric($value) ? (int) $value : 0;
        return max(0, min(self::MAX_FUNNEL_WINDOW_MINUTES, $minutes));
    }

    /** @return array<int,array<string,mixed>> */
    private function sanitize_funnel_filters(mixed $raw): array {
        if (!is_array($raw)) return [];
        $allowed_fields = ['page', 'referrer', 'country', 'device', 'utm-source', 'utm-campaign', 'property'];
        $allowed_operators = ['equals', 'not-equals', 'contains', 'not-contains', 'starts-with', 'ends-with'];
        $filters = [];
        foreach (array_slice($raw, 0, 24) as $index => $filter) {
            if (!is_array($filter)) continue;
            $field = sanitize_key((string) ($filter['field'] ?? ''));
            $operator = sanitize_key((string) ($filter['operator'] ?? 'equals'));
            if (!in_array($field, $allowed_fields, true) || !in_array($operator, $allowed_operators, true)) continue;
            $value = sanitize_text_field(substr((string) ($filter['value'] ?? ''), 0, 256));
            if ($value === '') continue;
            $filters[] = [
                'id' => $this->variant_key((string) ($filter['id'] ?? 'filter-' . ($index + 1))),
                'field' => $field,
                'operator' => $operator,
                'value' => $value,
                'property' => $field === 'property'
                    ? sanitize_key(substr((string) ($filter['property'] ?? ''), 0, 64))
                    : '',
            ];
        }
        return $filters;
    }

    /**
     * @param array<int,array<string,mixed>> $steps
     * @param array<int,array<string,mixed>> $filters
     * @return array<int,array{stepId:string,visitors:int,conversionRate:float}>
     */
    private function calculate_funnel_graph(
        array $steps,
        array $connections,
        array $filters,
        string $start,
        string $end,
        int $window_minutes = 0
    ): array {
        if (!$connections && count($steps) > 1) {
            foreach (array_slice($steps, 1) as $index => $step) {
                $connections[] = [
                    'id' => 'legacy-' . ($index + 1),
                    'sourceStepId' => (string) $steps[$index]['id'],
                    'targetStepId' => (string) $step['id'],
                    'minDelayMinutes' => 0,
                    'maxDelayMinutes' => 0,
                    'filters' => [],
                ];
            }
        }
        if (!$connections) {
            return [
                'steps' => $this->calculate_funnel($steps, $filters, $start, $end, $window_minutes),
                'connections' => [],
            ];
        }
        global $wpdb;
        $event_scope = $this->project_sql_condition('events');
        $events = $wpdb->get_results($wpdb->prepare(
            "SELECT events.session_id,events.event_type,events.event_name,events.tracking_id,events.page_path,
                    events.source_host,events.country_code,events.device_type,events.experiment_id,
                    events.variant_key,events.metadata,events.occurred_at,experiments.external_id experiment_key
             FROM {$this->table('events')} events
             LEFT JOIN {$this->table('experiments')} experiments ON experiments.id=events.experiment_id
             WHERE {$event_scope} AND events.occurred_at BETWEEN %s AND %s
             ORDER BY events.session_id ASC,events.occurred_at ASC,events.id ASC LIMIT 100000",
            $start,
            $end
        ), ARRAY_A);
        $sessions = [];
        foreach ($events ?: [] as $event) $sessions[(string) $event['session_id']][] = $event;
        $step_by_id = [];
        foreach ($steps as $step) $step_by_id[(string) ($step['id'] ?? '')] = $step;
        $incoming = array_fill_keys(array_keys($step_by_id), 0);
        $outgoing = [];
        foreach ($connections as $connection) {
            $source = (string) ($connection['sourceStepId'] ?? '');
            $target = (string) ($connection['targetStepId'] ?? '');
            if (!isset($step_by_id[$source], $step_by_id[$target])) continue;
            $incoming[$target] = ($incoming[$target] ?? 0) + 1;
            $outgoing[$source][] = $connection;
        }
        $entries = array_keys(array_filter($incoming, static fn(int $count): bool => $count === 0));
        if (!$entries && $steps) $entries[] = (string) ($steps[0]['id'] ?? '');
        $step_counts = array_fill_keys(array_keys($step_by_id), 0);
        $connection_counts = [];
        foreach ($connections as $connection) $connection_counts[(string) ($connection['id'] ?? '')] = 0;
        foreach ($sessions as $session_events) {
            if (!$this->funnel_session_matches_filters($session_events, $filters)) continue;
            $reached = [];
            $queue = [];
            foreach ($entries as $entry_id) {
                $match = $this->first_matching_funnel_event($session_events, $step_by_id[$entry_id], 0, 0);
                if (!$match) continue;
                $reached[$entry_id] = $match;
                $queue[] = $entry_id;
                $step_counts[$entry_id]++;
            }
            while ($queue) {
                $source_id = array_shift($queue);
                $source_time = (int) ($reached[$source_id]['timestamp'] ?? 0);
                foreach ($outgoing[$source_id] ?? [] as $connection) {
                    $target_id = (string) $connection['targetStepId'];
                    if (isset($reached[$target_id])) continue;
                    $connection_filters = is_array($connection['filters'] ?? null) ? $connection['filters'] : [];
                    if (!$this->funnel_session_matches_filters($session_events, $connection_filters)) continue;
                    $min_delay = max(0, (int) ($connection['minDelayMinutes'] ?? 0)) * 60;
                    $edge_max = max(0, (int) ($connection['maxDelayMinutes'] ?? 0)) * 60;
                    $global_max = max(0, $window_minutes) * 60;
                    $max_delay = $edge_max > 0 ? $edge_max : $global_max;
                    $match = $this->first_matching_funnel_event(
                        $session_events,
                        $step_by_id[$target_id],
                        $source_time + $min_delay,
                        $max_delay > 0 ? $source_time + $max_delay : 0
                    );
                    if (!$match) continue;
                    $reached[$target_id] = $match;
                    $queue[] = $target_id;
                    $step_counts[$target_id]++;
                    $connection_id = (string) ($connection['id'] ?? '');
                    $connection_counts[$connection_id] = ($connection_counts[$connection_id] ?? 0) + 1;
                }
            }
        }
        $step_rows = [];
        foreach ($steps as $step) {
            $id = (string) ($step['id'] ?? '');
            $parents = array_filter($connections, static fn(array $connection): bool => (string) ($connection['targetStepId'] ?? '') === $id);
            $base = 0;
            foreach ($parents as $parent) $base += (int) ($step_counts[(string) ($parent['sourceStepId'] ?? '')] ?? 0);
            $visitors = (int) ($step_counts[$id] ?? 0);
            $step_rows[] = [
                'stepId' => $id,
                'visitors' => $visitors,
                'conversionRate' => !$parents
                    ? ($visitors > 0 ? 100.0 : 0.0)
                    : ($base > 0 ? round($visitors / $base * 100, 2) : 0.0),
            ];
        }
        $connection_rows = [];
        foreach ($connections as $connection) {
            $id = (string) ($connection['id'] ?? '');
            $source_count = (int) ($step_counts[(string) ($connection['sourceStepId'] ?? '')] ?? 0);
            $visitors = (int) ($connection_counts[$id] ?? 0);
            $connection_rows[] = [
                'connectionId' => $id,
                'visitors' => $visitors,
                'conversionRate' => $source_count > 0 ? round($visitors / $source_count * 100, 2) : 0.0,
            ];
        }
        return ['steps' => $step_rows, 'connections' => $connection_rows];
    }

    /** @param array<int,array<string,mixed>> $events @param array<string,mixed> $step */
    private function first_matching_funnel_event(array $events, array $step, int $minimum_timestamp, int $maximum_timestamp): ?array {
        if (in_array((string) ($step['type'] ?? ''), ['email', 'webhook'], true)) {
            return [
                'timestamp' => $minimum_timestamp,
                'event' => ['event_type' => (string) ($step['type'] ?? '') . '_action'],
            ];
        }
        foreach ($events as $event) {
            $timestamp = strtotime((string) ($event['occurred_at'] ?? ''));
            if ($timestamp === false || $timestamp < $minimum_timestamp) continue;
            if ($maximum_timestamp > 0 && $timestamp > $maximum_timestamp) break;
            if ($this->event_matches_funnel_step($event, $step)) {
                return ['timestamp' => $timestamp, 'event' => $event];
            }
        }
        return null;
    }

    private function calculate_funnel(array $steps, array $filters, string $start, string $end, int $window_minutes = 0): array {
        global $wpdb;
        $event_scope = $this->project_sql_condition('events');
        $events = $wpdb->get_results($wpdb->prepare(
            "SELECT events.session_id,events.event_type,events.event_name,events.tracking_id,events.page_path,
                    events.source_host,events.country_code,events.device_type,events.experiment_id,
                    events.variant_key,events.metadata,events.occurred_at,experiments.external_id experiment_key
             FROM {$this->table('events')} events
             LEFT JOIN {$this->table('experiments')} experiments ON experiments.id=events.experiment_id
             WHERE {$event_scope} AND events.occurred_at BETWEEN %s AND %s
             ORDER BY events.session_id ASC,events.occurred_at ASC,events.id ASC LIMIT 100000",
            $start,
            $end
        ), ARRAY_A);
        $sessions = [];
        foreach ($events ?: [] as $event) {
            $sessions[(string) $event['session_id']][] = $event;
        }
        $eligible = [];
        foreach ($sessions as $session_events) {
            if ($this->funnel_session_matches_filters($session_events, $filters)) $eligible[] = $session_events;
        }
        $counts = $this->count_funnel_steps($eligible, $steps, max(0, $window_minutes) * 60);
        $rows = [];
        foreach ($steps as $index => $step) {
            $previous = $index === 0 ? ($counts[0] ?? 0) : ($counts[$index - 1] ?? 0);
            $conversion = $index === 0
                ? (($counts[0] ?? 0) > 0 ? 100.0 : 0.0)
                : ($previous > 0 ? round(($counts[$index] ?? 0) / $previous * 100, 2) : 0.0);
            $rows[] = [
                'stepId' => (string) ($step['id'] ?? ''),
                'visitors' => (int) ($counts[$index] ?? 0),
                'conversionRate' => $conversion,
            ];
        }
        return $rows;
    }

    /**
     * Count how many sessions reach each funnel step in order. When a conversion
     * window is set, a step only counts if it happens within `$window_seconds`
     * of the moment the session entered the first step; a late step abandons the
     * session for the rest of the funnel.
     *
     * @param array<int,array<int,array<string,mixed>>> $sessions Pre-filtered sessions of ordered events.
     * @param array<int,array<string,mixed>> $steps
     * @return array<int,int>
     */
    private function count_funnel_steps(array $sessions, array $steps, int $window_seconds): array {
        $step_count = count($steps);
        $counts = array_fill(0, $step_count, 0);
        if ($step_count === 0) return $counts;
        foreach ($sessions as $session_events) {
            $index = 0;
            $anchor = null;
            foreach ($session_events as $event) {
                if ($index >= $step_count) break;
                if (!$this->event_matches_funnel_step($event, $steps[$index])) continue;
                $timestamp = strtotime((string) ($event['occurred_at'] ?? ''));
                if ($timestamp === false) $timestamp = null;
                if (
                    $index > 0
                    && $window_seconds > 0
                    && $anchor !== null
                    && $timestamp !== null
                    && $timestamp - $anchor > $window_seconds
                ) {
                    // The session took too long to advance; it never converts
                    // within the configured window.
                    break;
                }
                if ($index === 0) $anchor = $timestamp;
                $counts[$index]++;
                $index++;
            }
        }
        return $counts;
    }

    /** @param array<string,mixed> $event @param array<string,mixed> $step */
    private function event_matches_funnel_step(array $event, array $step): bool {
        $type = (string) ($step['type'] ?? '');
        $expected_type = $type === 'page' ? 'pageview' : ($type === 'experiment' ? 'exposure' : $type);
        if ((string) ($event['event_type'] ?? '') !== $expected_type) return false;
        $experiment_id = (string) ($step['experimentId'] ?? '');
        if ($experiment_id !== '' && !hash_equals($experiment_id, (string) ($event['experiment_key'] ?? ''))) return false;
        $variant_id = (string) ($step['variantId'] ?? '');
        if ($variant_id !== '' && !hash_equals($variant_id, (string) ($event['variant_key'] ?? ''))) return false;
        $tracking_id = (string) ($step['trackingId'] ?? '');
        if ($tracking_id !== '' && !hash_equals($tracking_id, (string) ($event['tracking_id'] ?? ''))) return false;
        $page_path = (string) ($step['pagePath'] ?? '');
        if ($page_path !== '') {
            // Since 1.30 the authoring UI persists public routes. Normalize
            // older file-shaped values too so existing `index.html` and
            // `about.html` funnels keep matching runtime `/` and `/about/`
            // pageviews after upgrading.
            $runtime_page_path = $this->public_path_for_project_path($page_path);
            $event_page_path = $this->sanitize_page_path((string) ($event['page_path'] ?? '/'));
            if (
                !hash_equals($this->sanitize_page_path($page_path), $event_page_path)
                && !hash_equals($runtime_page_path, $event_page_path)
            ) return false;
        }
        $event_name = (string) ($step['eventName'] ?? '');
        if ($event_name !== '' && !hash_equals($event_name, (string) ($event['event_name'] ?? ''))) return false;
        return true;
    }

    /**
     * Global funnel filters are session filters: each configured condition
     * may match any observed value in the visitor's ordered session.
     *
     * @param array<int,array<string,mixed>> $events
     * @param array<int,array<string,mixed>> $filters
     */
    private function funnel_session_matches_filters(array $events, array $filters): bool {
        foreach ($filters as $filter) {
            if (!is_array($filter)) continue;
            $field = (string) ($filter['field'] ?? '');
            $values = [];
            foreach ($events as $event) {
                if ($field === 'page') $values[] = (string) ($event['page_path'] ?? '');
                elseif ($field === 'referrer') $values[] = (string) ($event['source_host'] ?? '');
                elseif ($field === 'country') $values[] = (string) ($event['country_code'] ?? '');
                elseif ($field === 'device') $values[] = (string) ($event['device_type'] ?? '');
                else {
                    $metadata = json_decode((string) ($event['metadata'] ?? ''), true);
                    $metadata = is_array($metadata) ? $metadata : [];
                    $key = $field === 'utm-source'
                        ? 'utm_source'
                        : ($field === 'utm-campaign' ? 'utm_campaign' : (string) ($filter['property'] ?? ''));
                    if ($key !== '' && isset($metadata[$key]) && is_scalar($metadata[$key])) {
                        $values[] = (string) $metadata[$key];
                    }
                }
            }
            $values = array_values(array_unique(array_filter($values, static fn(string $value): bool => $value !== '')));
            if (!$this->funnel_values_match($values, (string) ($filter['operator'] ?? 'equals'), (string) ($filter['value'] ?? ''))) {
                return false;
            }
        }
        return true;
    }

    /** @param array<int,string> $values */
    private function funnel_values_match(array $values, string $operator, string $needle): bool {
        $negative = in_array($operator, ['not-equals', 'not-contains'], true);
        if (!$values) return $negative;
        $needle = $this->lower($needle);
        foreach ($values as $value) {
            $value = $this->lower($value);
            $matched = match ($operator) {
                'not-equals' => $value !== $needle,
                'contains' => str_contains($value, $needle),
                'not-contains' => !str_contains($value, $needle),
                'starts-with' => str_starts_with($value, $needle),
                'ends-with' => str_ends_with($value, $needle),
                default => $value === $needle,
            };
            if ($negative && !$matched) return false;
            if (!$negative && $matched) return true;
        }
        return $negative;
    }

    private function lower(string $value): string {
        return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    }

    public function list_experiments(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$this->table('experiments')} WHERE config_json LIKE %s ORDER BY updated_at DESC,id DESC",
            $this->project_json_marker()
        ), ARRAY_A);
        return $this->private_response(array_map(fn(array $row): array => $this->format_experiment($row, false), $rows ?: []));
    }

    public function get_experiment(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->pro_feature_enabled('experiments')) {
            return $this->pro_feature_error(
                'experiments',
                'Os resultados de A/B Tests são um recurso Pro. Ative uma licença para visualizá-los.'
            );
        }
        $row = $this->experiment_row($this->resolve_experiment_database_id($request['id']));
        if (!$row) return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        [$start, $end] = $this->date_range($request);
        return $this->private_response($this->format_experiment($row, true, $start, $end));
    }

    public function create_experiment(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $input = $this->sanitize_experiment_input($request->get_json_params());
        if (is_wp_error($input)) return $input;
        if ($wpdb->query('START TRANSACTION') === false) {
            return new WP_Error('kodety_experiment_create', 'Não foi possível iniciar a criação do teste.', ['status' => 500]);
        }
        $now = gmdate('Y-m-d H:i:s');
        $created = $wpdb->insert($this->table('experiments'), [
            'external_id' => $this->scoped_external_id($input['external_id']),
            'name' => $input['name'],
            'source_page_id' => $input['source_page_id'],
            'page_path' => $input['page_path'],
            'page_hash' => hash('sha256', $input['page_path']),
            'goal_type' => $input['goal_type'],
            'goal_tracking_id' => $input['goal_tracking_id'],
            'status' => 'draft',
            'traffic_percent' => $input['traffic_percent'],
            'config_json' => $input['config_json'],
            'assignment_salt' => bin2hex(random_bytes(24)),
            'managed_source' => 'dashboard',
            'created_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $id = (int) $wpdb->insert_id;
        if (!$created || !$id) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_create', 'Não foi possível criar o teste.', ['status' => 500]);
        }
        $variants = is_array(($request->get_json_params()['variants'] ?? null)) ? $request->get_json_params()['variants'] : [];
        foreach ($variants as $variant) {
            if (!is_array($variant)) continue;
            $variant_id = $this->insert_variant($id, $variant, false, false);
            if (!is_wp_error($variant_id)) continue;
            $wpdb->query('ROLLBACK');
            return $variant_id;
        }
        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_create', 'Não foi possível confirmar a criação do teste.', ['status' => 500]);
        }
        return $this->private_response($this->format_experiment(
            $this->experiment_row($id),
            $this->pro_feature_enabled('experiments')
        ), 201);
    }

    public function update_experiment(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = $this->resolve_experiment_database_id($request['id']);
        $existing = $this->experiment_row($id);
        if (!$existing) return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        if ($wpdb->query('START TRANSACTION') === false) {
            return new WP_Error('kodety_experiment_update', 'Não foi possível iniciar a alteração do teste.', ['status' => 500]);
        }
        $locked = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('experiments')} WHERE id=%d FOR UPDATE",
            $id
        ), ARRAY_A);
        if (!is_array($locked)) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        }
        $existing = $locked;
        $input = $this->sanitize_experiment_input($request->get_json_params(), $existing);
        if (is_wp_error($input)) {
            $wpdb->query('ROLLBACK');
            return $input;
        }
        $page_hash = hash('sha256', $input['page_path']);
        if ((string) $existing['status'] === 'running') {
            $candidates = $wpdb->get_results($wpdb->prepare(
                "SELECT id FROM {$this->table('experiments')} WHERE page_hash=%s FOR UPDATE",
                $page_hash
            ), ARRAY_A);
            if (!is_array($candidates)) {
                $wpdb->query('ROLLBACK');
                return new WP_Error('kodety_experiment_update', 'Não foi possível reservar a página para o teste.', ['status' => 500]);
            }
            $conflict = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$this->table('experiments')}
                 WHERE id<>%d AND status='running' AND page_hash=%s LIMIT 1",
                $id,
                $page_hash
            ));
            if ($conflict > 0) {
                $wpdb->query('ROLLBACK');
                return new WP_Error('kodety_experiment_conflict', 'Já existe um teste ativo nesta página.', ['status' => 409]);
            }
        }
        $updated = $wpdb->update($this->table('experiments'), [
            'name' => $input['name'],
            'source_page_id' => $input['source_page_id'],
            'page_path' => $input['page_path'],
            'page_hash' => $page_hash,
            'goal_type' => $input['goal_type'],
            'goal_tracking_id' => $input['goal_tracking_id'],
            'traffic_percent' => $input['traffic_percent'],
            'config_json' => $input['config_json'],
            'updated_at' => gmdate('Y-m-d H:i:s'),
        ], ['id' => $id]);
        if ($updated === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_update', 'Não foi possível salvar o teste.', ['status' => 500]);
        }
        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_update', 'Não foi possível confirmar a alteração do teste.', ['status' => 500]);
        }
        if ((string) $existing['status'] === 'running') $this->rebuild_public_variant_routes();
        return $this->private_response($this->format_experiment(
            $this->experiment_row($id),
            $this->pro_feature_enabled('experiments')
        ));
    }

    public function delete_experiment(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = $this->resolve_experiment_database_id($request['id']);
        $row = $this->experiment_row($id);
        if (!$row) return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        if ($row['status'] === 'running') return new WP_Error('kodety_experiment_running', 'Pause o teste antes de excluí-lo.', ['status' => 409]);
        if ($wpdb->query('START TRANSACTION') === false) {
            return new WP_Error('kodety_experiment_delete', 'Não foi possível iniciar a exclusão do teste.', ['status' => 500]);
        }
        $variants_deleted = $wpdb->delete($this->table('variants'), ['experiment_id' => $id], ['%d']);
        $experiment_deleted = $wpdb->delete($this->table('experiments'), ['id' => $id], ['%d']);
        if ($variants_deleted === false || $experiment_deleted !== 1 || $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_delete', 'Não foi possível excluir o teste.', ['status' => 500]);
        }
        $this->rebuild_public_variant_routes();
        return $this->private_response(['deleted' => true, 'id' => (string) $id]);
    }

    public function set_experiment_state(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $payload = $request->get_json_params();
        $status = $this->experiment_status_to_database($payload['status'] ?? '');
        if (!in_array($status, self::EXPERIMENT_STATUSES, true)) return new WP_Error('kodety_experiment_state', 'Estado inválido.', ['status' => 400]);
        if ($status === 'running' && !$this->pro_feature_enabled('experiments')) {
            return $this->pro_feature_error(
                'experiments',
                'Iniciar A/B Tests é um recurso Pro. Mantenha o teste em rascunho ou ative uma licença.'
            );
        }
        $id = $this->resolve_experiment_database_id($request['id']);
        $row = $this->experiment_row($id);
        if (!$row) return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        $state_transaction = false;
        if ($status === 'running') {
            if ($wpdb->query('START TRANSACTION') === false) {
                return new WP_Error('kodety_experiment_state', 'Não foi possível iniciar o teste.', ['status' => 500]);
            }
            $state_transaction = true;
            $locked_experiment = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$this->table('experiments')} WHERE id=%d FOR UPDATE",
                $id
            ), ARRAY_A);
            if (!is_array($locked_experiment)) {
                $wpdb->query('ROLLBACK');
                return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
            }
            $row = $locked_experiment;
            // Lock every candidate for this public page before checking the
            // conflict, preventing two concurrent requests from both starting.
            $locked = $wpdb->get_results($wpdb->prepare(
                "SELECT id FROM {$this->table('experiments')} WHERE page_hash=%s FOR UPDATE",
                $row['page_hash']
            ), ARRAY_A);
            if (!is_array($locked)) {
                $wpdb->query('ROLLBACK');
                return new WP_Error('kodety_experiment_state', 'Não foi possível reservar a página para o teste.', ['status' => 500]);
            }
            $invariant = $this->experiment_variant_invariant($id);
            if (is_wp_error($invariant)) {
                $wpdb->query('ROLLBACK');
                return $invariant;
            }
            $conflict = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$this->table('experiments')} WHERE id<>%d AND status='running' AND page_hash=%s LIMIT 1",
                $id,
                $row['page_hash']
            ));
            if ($conflict) {
                $wpdb->query('ROLLBACK');
                return new WP_Error('kodety_experiment_conflict', 'Já existe um teste ativo nesta página.', ['status' => 409]);
            }
        }
        $changes = ['status' => $status, 'updated_at' => gmdate('Y-m-d H:i:s')];
        if ($status === 'running' && empty($row['started_at'])) $changes['started_at'] = gmdate('Y-m-d H:i:s');
        if ($status === 'completed') $changes['ended_at'] = gmdate('Y-m-d H:i:s');
        if ($wpdb->update($this->table('experiments'), $changes, ['id' => $id]) === false) {
            if ($state_transaction) $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_state', 'Não foi possível alterar o estado do teste.', ['status' => 500]);
        }
        if ($state_transaction && $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_state', 'Não foi possível confirmar o início do teste.', ['status' => 500]);
        }
        $this->rebuild_public_variant_routes();
        return $this->private_response($this->format_experiment(
            $this->experiment_row($id),
            $this->pro_feature_enabled('experiments')
        ));
    }

    public function create_variant(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = $this->resolve_experiment_database_id($request['id']);
        $experiment = $this->experiment_row($id);
        if (!$experiment) return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        $variant_id = $this->insert_variant($id, $request->get_json_params());
        if (is_wp_error($variant_id)) return $variant_id;
        if ((string) $experiment['status'] === 'running') $this->rebuild_public_variant_routes();
        return $this->private_response($this->variant_row((int) $variant_id), 201);
    }

    public function update_variant(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $experiment_id = $this->resolve_experiment_database_id($request['id']);
        $variant_id = $this->resolve_variant_database_id($experiment_id, $request['variant_id']);
        $existing = $this->variant_row($variant_id, $experiment_id);
        if (!$existing) return new WP_Error('kodety_variant_not_found', 'Variante não encontrada.', ['status' => 404]);
        $clean = $this->sanitize_variant($request->get_json_params(), $existing);
        if (is_wp_error($clean)) return $clean;
        if ($wpdb->query('START TRANSACTION') === false) {
            return new WP_Error('kodety_variant_update', 'Não foi possível iniciar a alteração da variante.', ['status' => 500]);
        }
        $experiment = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('experiments')} WHERE id=%d FOR UPDATE",
            $experiment_id
        ), ARRAY_A);
        if (!is_array($experiment)) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        }
        $locked_variant = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('variants')} WHERE id=%d AND experiment_id=%d FOR UPDATE",
            $variant_id,
            $experiment_id
        ), ARRAY_A);
        if (!is_array($locked_variant)) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_variant_not_found', 'Variante não encontrada.', ['status' => 404]);
        }
        $clean = $this->sanitize_variant($request->get_json_params(), $locked_variant);
        if (is_wp_error($clean)) {
            $wpdb->query('ROLLBACK');
            return $clean;
        }
        if ($clean['is_control']) {
            $reset = $wpdb->query($wpdb->prepare(
                "UPDATE {$this->table('variants')} SET is_control=0 WHERE experiment_id=%d AND id<>%d",
                $experiment_id,
                $variant_id
            ));
            if ($reset === false) {
                $wpdb->query('ROLLBACK');
                return new WP_Error('kodety_variant_update', 'Não foi possível alterar a variante de controle.', ['status' => 500]);
            }
        }
        $updated = $wpdb->update($this->table('variants'), [
            'name' => $clean['name'],
            'document_key' => $clean['document_key'],
            'page_id' => $clean['page_id'],
            'page_path' => $clean['page_path'],
            'weight' => $clean['weight'],
            'enabled' => $clean['enabled'],
            'is_control' => $clean['is_control'],
            'metadata' => wp_json_encode($clean['metadata']),
            'updated_at' => gmdate('Y-m-d H:i:s'),
        ], ['id' => $variant_id, 'experiment_id' => $experiment_id]);
        if ($updated === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_variant_update', 'Não foi possível salvar a variante.', ['status' => 500]);
        }
        if ((string) $experiment['status'] === 'running') {
            $invariant = $this->experiment_variant_invariant($experiment_id);
            if (is_wp_error($invariant)) {
                $wpdb->query('ROLLBACK');
                return $invariant;
            }
        }
        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_variant_update', 'Não foi possível confirmar a alteração da variante.', ['status' => 500]);
        }
        if ((string) $experiment['status'] === 'running') $this->rebuild_public_variant_routes();
        return $this->private_response($this->variant_row($variant_id, $experiment_id));
    }

    public function delete_variant(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $experiment_id = $this->resolve_experiment_database_id($request['id']);
        $variant_id = $this->resolve_variant_database_id($experiment_id, $request['variant_id']);
        $row = $this->variant_row($variant_id, $experiment_id);
        if (!$row) return new WP_Error('kodety_variant_not_found', 'Variante não encontrada.', ['status' => 404]);
        $experiment = $this->experiment_row($experiment_id);
        if (($experiment['status'] ?? '') === 'running') return new WP_Error('kodety_experiment_running', 'Pause o teste antes de excluir variantes.', ['status' => 409]);
        if ($wpdb->delete($this->table('variants'), ['id' => $variant_id, 'experiment_id' => $experiment_id], ['%d', '%d']) !== 1) {
            return new WP_Error('kodety_variant_delete', 'Não foi possível excluir a variante.', ['status' => 500]);
        }
        $this->rebuild_public_variant_routes();
        return $this->private_response(['deleted' => true, 'id' => (string) $variant_id]);
    }

    /** @return int|WP_Error */
    private function insert_variant(
        int $experiment_id,
        mixed $raw,
        bool $enforce_running_invariant = true,
        bool $manage_transaction = true
    ): int|WP_Error {
        global $wpdb;
        $clean = $this->sanitize_variant($raw);
        if (is_wp_error($clean)) return $clean;
        if ($manage_transaction && $wpdb->query('START TRANSACTION') === false) {
            return new WP_Error('kodety_variant_create', 'Não foi possível iniciar a criação da variante.', ['status' => 500]);
        }
        $experiment = $manage_transaction
            ? $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$this->table('experiments')} WHERE id=%d FOR UPDATE",
                $experiment_id
            ), ARRAY_A)
            : $this->experiment_row($experiment_id);
        if (!is_array($experiment)) {
            if ($manage_transaction) $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_experiment_not_found', 'Experimento não encontrado.', ['status' => 404]);
        }
        $now = gmdate('Y-m-d H:i:s');
        $result = $wpdb->insert($this->table('variants'), [
            'experiment_id' => $experiment_id,
            'variant_key' => $clean['variant_key'],
            'name' => $clean['name'],
            'document_key' => $clean['document_key'],
            'page_id' => $clean['page_id'],
            'page_path' => $clean['page_path'],
            'weight' => $clean['weight'],
            'enabled' => $clean['enabled'],
            'is_control' => $clean['is_control'],
            'metadata' => wp_json_encode($clean['metadata']),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        if (!$result) {
            if ($manage_transaction) $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_variant_create', 'ID de variante duplicado ou inválido.', ['status' => 409]);
        }
        $variant_id = (int) $wpdb->insert_id;
        if ($clean['is_control']) {
            $reset = $wpdb->query($wpdb->prepare(
                "UPDATE {$this->table('variants')} SET is_control=0 WHERE experiment_id=%d AND id<>%d",
                $experiment_id,
                $variant_id
            ));
            if ($reset === false) {
                if ($manage_transaction) $wpdb->query('ROLLBACK');
                return new WP_Error('kodety_variant_create', 'Não foi possível definir a variante de controle.', ['status' => 500]);
            }
        }
        if ($enforce_running_invariant && (string) $experiment['status'] === 'running') {
            $invariant = $this->experiment_variant_invariant($experiment_id);
            if (is_wp_error($invariant)) {
                if ($manage_transaction) $wpdb->query('ROLLBACK');
                return $invariant;
            }
        }
        if ($manage_transaction && $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_variant_create', 'Não foi possível confirmar a criação da variante.', ['status' => 500]);
        }
        return $variant_id;
    }

    private function variant_population_is_valid(int $enabled_variants, int $control_variants): bool {
        return $enabled_variants >= 2 && $control_variants === 1;
    }

    private function experiment_variant_invariant(int $experiment_id): ?WP_Error {
        global $wpdb;
        $population = $wpdb->get_row($wpdb->prepare(
            "SELECT
                SUM(enabled=1 AND weight>0) enabled_variants,
                SUM(enabled=1 AND weight>0 AND is_control=1) control_variants
             FROM {$this->table('variants')} WHERE experiment_id=%d",
            $experiment_id
        ), ARRAY_A);
        $enabled = (int) ($population['enabled_variants'] ?? 0);
        $controls = (int) ($population['control_variants'] ?? 0);
        if ($this->variant_population_is_valid($enabled, $controls)) return null;
        if ($enabled < 2) {
            return new WP_Error('kodety_experiment_variants', 'Ative ao menos duas variantes com peso.', ['status' => 409]);
        }
        return new WP_Error('kodety_experiment_control', 'O teste precisa ter exatamente uma variante de controle ativa.', ['status' => 409]);
    }

    /** @return array<string,mixed>|WP_Error */
    private function sanitize_variant(mixed $raw, array $fallback = []): array|WP_Error {
        if (!is_array($raw)) return new WP_Error('kodety_variant_payload', 'Variante inválida.', ['status' => 400]);
        $key = $this->variant_key((string) ($raw['id'] ?? $raw['variantKey'] ?? $fallback['variant_key'] ?? $fallback['id'] ?? ''));
        $name = sanitize_text_field(substr((string) ($raw['name'] ?? $fallback['name'] ?? ''), 0, 191));
        if ($key === '' || $name === '') return new WP_Error('kodety_variant_required', 'Informe ID e nome da variante.', ['status' => 400]);
        $weight = (float) ($raw['weight'] ?? $fallback['weight'] ?? 1);
        $kind = sanitize_key((string) ($raw['kind'] ?? ''));
        $status = sanitize_key((string) ($raw['status'] ?? ''));
        $enabled = array_key_exists('status', $raw)
            ? $status === 'active'
            : rest_sanitize_boolean($raw['enabled'] ?? $fallback['enabled'] ?? true);
        $is_control = array_key_exists('kind', $raw)
            ? $kind === 'control'
            : rest_sanitize_boolean($raw['isControl'] ?? $fallback['is_control'] ?? $fallback['isControl'] ?? false);
        $fallback_metadata = $fallback['metadata'] ?? [];
        if (!is_array($fallback_metadata)) $fallback_metadata = json_decode((string) $fallback_metadata, true);
        $metadata = is_array($fallback_metadata) ? $fallback_metadata : [];
        if (isset($raw['metadata']) && is_array($raw['metadata'])) $metadata = $raw['metadata'];
        if (isset($raw['sourcePagePath'])) $metadata['source_page_path'] = (string) $raw['sourcePagePath'];
        if (isset($raw['sourceFileDigests']) && is_array($raw['sourceFileDigests'])) {
            $metadata['source_file_digests'] = $raw['sourceFileDigests'];
        }
        if (isset($raw['slug'])) $metadata['public_slug'] = $this->public_variant_slug((string) $raw['slug']);
        $fallback_status = sanitize_key((string) ($metadata['variant_status'] ?? ''));
        $metadata['variant_status'] = in_array($status, ['active', 'paused', 'archived'], true)
            ? $status
            : (in_array($fallback_status, ['active', 'paused', 'archived'], true)
                ? $fallback_status
                : ($enabled ? 'active' : 'paused'));
        return [
            'variant_key' => $key,
            'name' => $name,
            'document_key' => sanitize_text_field(substr((string) ($raw['documentKey'] ?? $fallback['document_key'] ?? $fallback['documentKey'] ?? $key), 0, 191)),
            'page_id' => absint($raw['pageId'] ?? $fallback['page_id'] ?? $fallback['pageId'] ?? 0),
            'page_path' => $this->sanitize_page_path((string) ($raw['pagePath'] ?? $fallback['page_path'] ?? $fallback['pagePath'] ?? '/')),
            'weight' => max(0, min(1000000, $weight)),
            'enabled' => $enabled ? 1 : 0,
            'is_control' => $is_control ? 1 : 0,
            'metadata' => $this->sanitize_variant_metadata($metadata),
        ];
    }

    /** @return array<string,mixed>|WP_Error */
    private function sanitize_experiment_input(mixed $raw, array $fallback = []): array|WP_Error {
        if (!is_array($raw)) return new WP_Error('kodety_experiment_payload', 'Experimento inválido.', ['status' => 400]);
        $name = sanitize_text_field(substr((string) ($raw['name'] ?? $fallback['name'] ?? ''), 0, 191));
        $path = $this->sanitize_page_path((string) ($raw['pagePath'] ?? $fallback['page_path'] ?? '/'));
        $goal = isset($raw['goal']) && is_array($raw['goal']) ? $raw['goal'] : [];
        $goal_type = sanitize_key((string) ($goal['type'] ?? $raw['goalType'] ?? $fallback['goal_type'] ?? 'pageview'));
        if (!in_array($goal_type, ['pageview', 'click', 'custom'], true)) $goal_type = 'pageview';
        $fallback_goal_value = (string) ($fallback['goal_tracking_id'] ?? '');
        if ($goal_type === 'pageview') {
            $goal_page_path = (string) ($goal['pagePath'] ?? $raw['goalPagePath'] ?? $fallback_goal_value);
            $goal_value = $this->sanitize_page_path($goal_page_path !== '' ? $goal_page_path : $path);
        } elseif ($goal_type === 'custom') {
            $goal_value = $this->tracking_id((string) ($goal['eventName'] ?? $raw['eventName'] ?? $fallback_goal_value));
        } else {
            $target_type = (string) ($goal['targetType'] ?? $raw['goalTargetType'] ?? '');
            $target_value = (string) ($goal['targetValue'] ?? $raw['goalTargetValue'] ?? '');
            $goal_value = $this->canonical_click_goal(
                $target_type,
                $target_value,
                (string) ($goal['trackingId'] ?? $raw['goalTrackingId'] ?? $fallback_goal_value)
            );
        }
        if ($name === '') return new WP_Error('kodety_experiment_required', 'Informe o nome do teste.', ['status' => 400]);
        $config = $this->sanitize_experiment_config($raw, $fallback);
        return [
            'external_id' => $this->variant_key((string) ($raw['id'] ?? $fallback['external_id'] ?? wp_generate_uuid4())),
            'name' => $name,
            'source_page_id' => absint($raw['pageId'] ?? $raw['sourcePageId'] ?? $fallback['source_page_id'] ?? 0),
            'page_path' => $path,
            'goal_type' => $goal_type,
            'goal_tracking_id' => $goal_value,
            'traffic_percent' => max(0, min(100, (float) ($raw['trafficPercent'] ?? $fallback['traffic_percent'] ?? 100))),
            'config_json' => wp_json_encode($config),
        ];
    }

    /** @return array<string,mixed> */
    private function experiment_config(array $experiment): array {
        $stored = json_decode((string) ($experiment['config_json'] ?? ''), true);
        if (!is_array($stored)) $stored = [];
        return $this->sanitize_experiment_config($stored, $experiment);
    }

    /** @return array<string,mixed> */
    private function sanitize_experiment_config(array $raw, array $fallback = []): array {
        $nested = isset($raw['config']) && is_array($raw['config']) ? $raw['config'] : [];
        $source = array_merge($raw, $nested);
        $fallback_config = json_decode((string) ($fallback['config_json'] ?? ''), true);
        if (!is_array($fallback_config)) $fallback_config = [];
        $audience = isset($source['audience']) && is_array($source['audience']) ? $source['audience'] : [];
        $fallback_audience = isset($fallback_config['audience']) && is_array($fallback_config['audience'])
            ? $fallback_config['audience']
            : [];
        $auto_stop = isset($source['autoStop']) && is_array($source['autoStop']) ? $source['autoStop'] : [];
        $fallback_auto_stop = isset($fallback_config['autoStop']) && is_array($fallback_config['autoStop'])
            ? $fallback_config['autoStop']
            : [];
        $allocation = sanitize_key((string) ($source['allocationMode'] ?? $fallback_config['allocationMode'] ?? 'manual'));
        if (!in_array($allocation, ['manual', 'equal', 'adaptive'], true)) $allocation = 'manual';
        $delivery = sanitize_key((string) ($source['deliveryMode'] ?? $fallback_config['deliveryMode'] ?? 'redirect'));
        if (!in_array($delivery, ['redirect', 'server'], true)) $delivery = 'redirect';
        $device = sanitize_key((string) ($audience['device'] ?? $fallback_audience['device'] ?? 'all'));
        if (!in_array($device, ['all', 'mobile', 'desktop'], true)) $device = 'all';
        $visitor = sanitize_key((string) ($audience['visitor'] ?? $fallback_audience['visitor'] ?? 'all'));
        if (!in_array($visitor, ['all', 'new', 'returning'], true)) $visitor = 'all';
        $end_at = sanitize_text_field((string) ($auto_stop['endAt'] ?? $fallback_auto_stop['endAt'] ?? ''));
        if ($end_at !== '' && strtotime($end_at) === false) $end_at = '';
        $max_exposures_raw = $auto_stop['maxExposures'] ?? $fallback_auto_stop['maxExposures'] ?? 0;
        $max_exposures = max(0, min(10000000, absint($max_exposures_raw)));
        $query_parameter = sanitize_key((string) ($audience['queryParameter'] ?? $fallback_audience['queryParameter'] ?? ''));
        $query_value = sanitize_text_field(substr((string) ($audience['queryValue'] ?? $fallback_audience['queryValue'] ?? ''), 0, 160));
        $referrer_host = strtolower(sanitize_text_field(substr((string) ($audience['referrerHost'] ?? $fallback_audience['referrerHost'] ?? ''), 0, 191)));
        $referrer_host = preg_replace('#^https?://#', '', $referrer_host);
        $referrer_host = explode('/', (string) $referrer_host, 2)[0];
        return [
            'projectKey' => self::project_scope_key(),
            'allocationMode' => $allocation,
            'deliveryMode' => $delivery,
            'stickyDays' => max(1, min(365, absint($source['stickyDays'] ?? $fallback_config['stickyDays'] ?? 180))),
            'audience' => [
                'device' => $device,
                'visitor' => $visitor,
                'queryParameter' => $query_parameter,
                'queryValue' => $query_value,
                'referrerHost' => $referrer_host,
            ],
            'autoStop' => [
                'endAt' => $end_at,
                'maxExposures' => $max_exposures,
            ],
        ];
    }

    private function experiment_status_to_database(mixed $status): string {
        return match (sanitize_key((string) $status)) {
            'active', 'running' => 'running',
            'archived', 'completed' => 'completed',
            'paused' => 'paused',
            'draft' => 'draft',
            default => '',
        };
    }

    private function experiment_status_to_client(string $status): string {
        return match ($status) {
            'running' => 'active',
            'completed' => 'archived',
            'paused' => 'paused',
            default => 'draft',
        };
    }

    private function resolve_experiment_database_id(mixed $identifier): int {
        global $wpdb;
        $value = trim((string) $identifier);
        if ($value === '') return 0;
        if (ctype_digit($value)) {
            $id = absint($value);
            if ($id > 0) return $id;
        }
        $external = $this->scoped_external_id($value);
        if ($external === '') return 0;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$this->table('experiments')}
             WHERE external_id=%s AND config_json LIKE %s LIMIT 1",
            $external,
            $this->project_json_marker()
        ));
    }

    private function resolve_variant_database_id(int $experiment_id, mixed $identifier): int {
        global $wpdb;
        $value = trim((string) $identifier);
        if ($experiment_id <= 0 || $value === '') return 0;
        if (ctype_digit($value)) {
            $id = absint($value);
            if ($id > 0) return $id;
        }
        $key = $this->variant_key($value);
        if ($key === '') return 0;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$this->table('variants')} WHERE experiment_id=%d AND variant_key=%s LIMIT 1",
            $experiment_id,
            $key
        ));
    }

    /** @return array<string,mixed>|null */
    private function experiment_row(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('experiments')} WHERE id=%d AND config_json LIKE %s",
            $id,
            $this->project_json_marker()
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /** @return array<string,mixed>|null */
    private function variant_row(int $id, int $experiment_id = 0): ?array {
        global $wpdb;
        $sql = $experiment_id > 0
            ? $wpdb->prepare("SELECT * FROM {$this->table('variants')} WHERE id=%d AND experiment_id=%d", $id, $experiment_id)
            : $wpdb->prepare("SELECT * FROM {$this->table('variants')} WHERE id=%d", $id);
        $row = $wpdb->get_row($sql, ARRAY_A);
        return is_array($row) ? $this->format_variant($row) : null;
    }

    /** @return array<string,mixed> */
    private function format_variant(array $row): array {
        $metadata = json_decode((string) $row['metadata'], true);
        $metadata = is_array($metadata) ? $metadata : [];
        return [
            'databaseId' => (string) $row['id'],
            'id' => (string) $row['variant_key'],
            'name' => (string) $row['name'],
            'slug' => (string) ($metadata['public_slug'] ?? $row['variant_key']),
            'kind' => (bool) $row['is_control'] ? 'control' : 'variant',
            'status' => in_array(($metadata['variant_status'] ?? ''), ['active', 'paused', 'archived'], true)
                ? (string) $metadata['variant_status']
                : ((bool) $row['enabled'] ? 'active' : 'paused'),
            'documentKey' => (string) $row['document_key'],
            'pageId' => (int) $row['page_id'],
            'pagePath' => (string) $row['page_path'],
            'sourcePagePath' => (string) ($metadata['source_page_path'] ?? ''),
            'sourceFileDigests' => is_array($metadata['source_file_digests'] ?? null) ? $metadata['source_file_digests'] : [],
            'weight' => (float) $row['weight'],
            'enabled' => (bool) $row['enabled'],
            'isControl' => (bool) $row['is_control'],
            'metadata' => $metadata,
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }

    /** @return array<string,mixed> */
    private function format_experiment(?array $row, bool $with_results, string $start = '', string $end = ''): array {
        if (!$row) return [];
        $with_results = $with_results && $this->pro_feature_enabled('experiments');
        global $wpdb;
        $variants = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$this->table('variants')} WHERE experiment_id=%d ORDER BY is_control DESC,id ASC",
            $row['id']
        ), ARRAY_A);
        $goal = ['type' => (string) $row['goal_type']];
        if ($row['goal_type'] === 'pageview') $goal['pagePath'] = (string) $row['goal_tracking_id'];
        elseif ($row['goal_type'] === 'custom') $goal['eventName'] = (string) $row['goal_tracking_id'];
        else {
            $goal['trackingId'] = (string) $row['goal_tracking_id'];
            $target = $this->click_goal_target((string) $row['goal_tracking_id']);
            if ($target) {
                $goal['targetType'] = $target['targetType'];
                $goal['targetValue'] = $target['targetValue'];
            }
        }
        $config = $this->experiment_config($row);
        $data = [
            'databaseId' => (string) $row['id'],
            'id' => $this->public_external_id((string) $row['external_id']),
            'name' => (string) $row['name'],
            'pageId' => (int) $row['source_page_id'],
            'pagePath' => (string) $row['page_path'],
            'goal' => $goal,
            'status' => $this->experiment_status_to_client((string) $row['status']),
            'trafficPercent' => (float) $row['traffic_percent'],
            'allocationMode' => $config['allocationMode'],
            'deliveryMode' => $config['deliveryMode'],
            'stickyDays' => $config['stickyDays'],
            'audience' => $config['audience'],
            'autoStop' => $config['autoStop'],
            'source' => (string) $row['managed_source'],
            'startedAt' => $row['started_at'] ?: null,
            'endedAt' => $row['ended_at'] ?: null,
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
            'variants' => array_map([$this, 'format_variant'], $variants ?: []),
        ];
        if ($with_results) {
            if ($start === '' || $end === '') {
                $start = gmdate('Y-m-d 00:00:00', time() - 29 * DAY_IN_SECONDS);
                $end = gmdate('Y-m-d 23:59:59');
            }
            $data['results'] = $this->experiment_results($row, $variants ?: [], $start, $end);
        }
        return $data;
    }

    /** @param array<string,mixed> $experiment @param array<int,array<string,mixed>> $variants @return array<int,array<string,mixed>> */
    private function experiment_results(array $experiment, array $variants, string $start, string $end): array {
        global $wpdb;
        $rows = [];
        $control_rate = null;
        $events_table = $this->table('events');
        foreach ($variants as $variant) {
            $views = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(DISTINCT session_id) FROM {$events_table}
                 WHERE experiment_id=%d AND variant_key=%s AND event_type='exposure' AND occurred_at BETWEEN %s AND %s",
                $experiment['id'], $variant['variant_key'], $start, $end
            ));
            $goal_value = (string) $experiment['goal_tracking_id'];
            if ($experiment['goal_type'] === 'pageview' && $goal_value !== '') {
                $runtime_goal_path = $this->public_path_for_project_path($goal_value);
                $conversions = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(DISTINCT goal.session_id) FROM {$events_table} goal
                     WHERE goal.experiment_id=%d AND goal.variant_key=%s AND goal.event_type='pageview'
                     AND (goal.page_path=%s OR goal.page_path=%s) AND goal.occurred_at BETWEEN %s AND %s
                     AND EXISTS (
                        SELECT 1 FROM {$events_table} exposure
                        WHERE exposure.experiment_id=goal.experiment_id
                        AND exposure.variant_key=goal.variant_key
                        AND exposure.visitor_id=goal.visitor_id
                        AND exposure.event_type='exposure'
                        AND exposure.occurred_at<=goal.occurred_at
                     )",
                    $experiment['id'], $variant['variant_key'], $goal_value, $runtime_goal_path, $start, $end
                ));
            } elseif ($experiment['goal_type'] === 'custom' && $goal_value !== '') {
                $conversions = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(DISTINCT goal.session_id) FROM {$events_table} goal
                     WHERE goal.experiment_id=%d AND goal.variant_key=%s AND goal.event_type='custom'
                     AND goal.event_name=%s AND goal.occurred_at BETWEEN %s AND %s
                     AND EXISTS (
                        SELECT 1 FROM {$events_table} exposure
                        WHERE exposure.experiment_id=goal.experiment_id
                        AND exposure.variant_key=goal.variant_key
                        AND exposure.visitor_id=goal.visitor_id
                        AND exposure.event_type='exposure'
                        AND exposure.occurred_at<=goal.occurred_at
                     )",
                    $experiment['id'], $variant['variant_key'], $goal_value, $start, $end
                ));
            } elseif ($goal_value !== '') {
                $conversions = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(DISTINCT goal.session_id) FROM {$events_table} goal
                     WHERE goal.experiment_id=%d AND goal.variant_key=%s AND goal.event_type=%s
                     AND goal.tracking_id=%s AND goal.occurred_at BETWEEN %s AND %s
                     AND EXISTS (
                        SELECT 1 FROM {$events_table} exposure
                        WHERE exposure.experiment_id=goal.experiment_id
                        AND exposure.variant_key=goal.variant_key
                        AND exposure.visitor_id=goal.visitor_id
                        AND exposure.event_type='exposure'
                        AND exposure.occurred_at<=goal.occurred_at
                     )",
                    $experiment['id'], $variant['variant_key'], $experiment['goal_type'], $goal_value, $start, $end
                ));
            } else {
                $conversions = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(DISTINCT goal.session_id) FROM {$events_table} goal
                     WHERE goal.experiment_id=%d AND goal.variant_key=%s AND goal.event_type=%s
                     AND goal.occurred_at BETWEEN %s AND %s
                     AND EXISTS (
                        SELECT 1 FROM {$events_table} exposure
                        WHERE exposure.experiment_id=goal.experiment_id
                        AND exposure.variant_key=goal.variant_key
                        AND exposure.visitor_id=goal.visitor_id
                        AND exposure.event_type='exposure'
                        AND exposure.occurred_at<=goal.occurred_at
                     )",
                    $experiment['id'], $variant['variant_key'], $experiment['goal_type'], $start, $end
                ));
            }
            $rate = $views > 0 ? $conversions / $views * 100 : 0;
            if ((bool) $variant['is_control']) $control_rate = $rate;
            $rows[] = [
                'variantId' => (string) $variant['variant_key'],
                'views' => $views,
                'conversions' => $conversions,
                'conversionRate' => round($rate, 2),
                'isControl' => (bool) $variant['is_control'],
            ];
        }
        foreach ($rows as &$row) {
            $row['lift'] = $control_rate && !$row['isControl']
                ? round(($row['conversionRate'] - $control_rate) / $control_rate * 100, 2)
                : 0;
        }
        unset($row);
        return $rows;
    }

    /**
     * Select a variant before the generated theme resolves `_kodety_html_path`.
     * A deployed public slug receives a sticky 302; legacy/no-slug definitions
     * fall back to an in-place clone override. Logged-in editors and previews
     * always see the explicitly requested document in the Builder.
     */
    private function generated_theme_site_root(): string {
        $theme_dir = '';
        if (function_exists('wp_get_theme')) {
            $theme = wp_get_theme('kodety-generated');
            if (is_object($theme) && method_exists($theme, 'exists') && $theme->exists()) {
                $theme_dir = (string) $theme->get_stylesheet_directory();
            }
        }
        if ($theme_dir === '' && function_exists('get_stylesheet_directory')) {
            $theme_dir = (string) get_stylesheet_directory();
        }
        $site_root = $theme_dir !== '' ? realpath($theme_dir . '/site') : false;
        return is_string($site_root) ? rtrim($site_root, '/\\') : '';
    }

    /**
     * Published A/B documents are executable content. They must not live below
     * ABSPATH, uploads or the generated theme, where Apache, Nginx or a CDN can
     * bypass WordPress and serve them after a license/status change.
     */
    private function private_runtime_base_root(bool $create): string {
        $configured = function_exists('apply_filters')
            ? apply_filters('kodety_analytics_private_runtime_root', '')
            : '';
        $site_key = substr(hash('sha256', home_url('/') . '|' . ABSPATH), 0, 24);
        $candidates = [];
        if (is_string($configured) && trim($configured) !== '') {
            $candidates[] = rtrim(trim($configured), '/\\');
        }
        $persisted = get_option(self::PRIVATE_RUNTIME_ROOT_OPTION, '');
        if (is_string($persisted) && trim($persisted) !== '') {
            $candidates[] = rtrim(trim($persisted), '/\\');
        }
        $wordpress_root = rtrim(str_replace('\\', '/', ABSPATH), '/');
        $document_root = rtrim(str_replace('\\', '/', (string) ($_SERVER['DOCUMENT_ROOT'] ?? '')), '/');
        // A sibling of ABSPATH is durable, but only use it when the server has
        // supplied enough information to prove that sibling is not still
        // inside the HTTP document root (common with subdirectory installs).
        if (
            $wordpress_root !== ''
            && $document_root !== ''
            && $this->absolute_filesystem_path($document_root)
        ) {
            $candidates[] = dirname($wordpress_root) . '/.kodety-private/' . $site_key . '/analytics';
        }
        $system_temp = rtrim(str_replace('\\', '/', sys_get_temp_dir()), '/');
        if ($system_temp !== '') {
            $candidates[] = $system_temp . '/kodety-private/' . $site_key . '/analytics';
        }

        $public_roots = [];
        $known_public_roots = [
            ABSPATH,
            (string) ($_SERVER['DOCUMENT_ROOT'] ?? ''),
            defined('WP_CONTENT_DIR') ? (string) WP_CONTENT_DIR : '',
            function_exists('get_theme_root') ? (string) get_theme_root() : '',
            $this->generated_theme_site_root(),
        ];
        foreach ($known_public_roots as $public_root) {
            $public_root = rtrim(str_replace('\\', '/', trim($public_root)), '/');
            if ($public_root === '' || !$this->absolute_filesystem_path($public_root)) continue;
            $resolved = realpath($public_root);
            $public_roots[] = rtrim(is_string($resolved) ? $resolved : $public_root, '/\\');
        }
        if (function_exists('wp_upload_dir')) {
            $uploads = wp_upload_dir();
            $upload_root = is_array($uploads)
                ? rtrim(str_replace('\\', '/', (string) ($uploads['basedir'] ?? '')), '/')
                : '';
            if ($upload_root !== '' && $this->absolute_filesystem_path($upload_root)) {
                $resolved_upload_root = realpath($upload_root);
                $public_roots[] = rtrim(
                    is_string($resolved_upload_root) ? $resolved_upload_root : $upload_root,
                    '/\\'
                );
            }
        }

        foreach (array_values(array_unique($candidates)) as $candidate) {
            $candidate = str_replace('\\', '/', $candidate);
            if (!$this->absolute_filesystem_path($candidate)) continue;
            $lexically_public = false;
            foreach ($public_roots as $public_root) {
                if ($this->filesystem_path_is_within($candidate, $public_root)) {
                    $lexically_public = true;
                    break;
                }
            }
            if ($lexically_public) continue;
            if ($create && !is_dir($candidate) && !wp_mkdir_p($candidate)) continue;
            $resolved = realpath($candidate);
            if (!is_string($resolved) || !is_dir($resolved)) continue;
            $resolved = rtrim($resolved, '/\\');
            $inside_public_root = false;
            foreach ($public_roots as $public_root) {
                if ($this->filesystem_path_is_within($resolved, $public_root)) {
                    $inside_public_root = true;
                    break;
                }
            }
            if ($inside_public_root) continue;
            if ($create && !hash_equals((string) $persisted, $resolved)) {
                update_option(self::PRIVATE_RUNTIME_ROOT_OPTION, $resolved, false);
            }
            return $resolved;
        }

        if ($create) {
            throw new RuntimeException(
                'Não foi possível preparar o armazenamento privado dos A/B Tests fora da raiz pública.'
            );
        }
        return '';
    }

    private function absolute_filesystem_path(string $path): bool {
        return str_starts_with($path, '/') || preg_match('/^[A-Za-z]:\//', $path) === 1;
    }

    private function filesystem_path_is_within(string $path, string $root): bool {
        $path = rtrim(str_replace('\\', '/', $path), '/');
        $root = rtrim(str_replace('\\', '/', $root), '/');
        return $root !== '' && ($path === $root || str_starts_with($path, $root . '/'));
    }

    private function private_runtime_scope_container(bool $create, ?string $scope = null): string {
        $base = $this->private_runtime_base_root($create);
        if ($base === '') return '';
        $scope = $this->variant_key($scope ?? self::project_scope_key());
        if ($scope === '') $scope = 'single';
        $root = $base . '/projects/' . $scope;
        if ($create && !is_dir($root) && !wp_mkdir_p($root)) {
            throw new RuntimeException('Não foi possível preparar o runtime privado deste projeto.');
        }
        $resolved = realpath($root);
        if (
            !is_string($resolved)
            || !$this->filesystem_path_is_within($resolved, $base)
            || !is_dir($resolved)
        ) return '';
        return rtrim($resolved, '/\\');
    }

    private function private_runtime_scope_root(bool $create, ?string $scope = null): string {
        $container = $this->private_runtime_scope_container($create, $scope);
        if ($container === '') return '';
        $root = $container . '/current';
        if ($create && !is_dir($root) && !wp_mkdir_p($root)) {
            throw new RuntimeException('Não foi possível preparar a release privada dos A/B Tests.');
        }
        $resolved = realpath($root);
        if (
            !is_string($resolved)
            || !$this->filesystem_path_is_within($resolved, $container)
            || !is_dir($resolved)
        ) return '';
        return rtrim($resolved, '/\\');
    }

    private function private_runtime_scope_token(string $scope): string {
        $scope = $this->variant_key($scope);
        if ($scope === '') $scope = 'single';
        return substr(hash_hmac('sha256', 'analytics-runtime|' . $scope, wp_salt('auth')), 0, 32);
    }

    private function private_runtime_scope_for_token(string $token): string {
        if (!preg_match('/^[a-f0-9]{32}$/D', $token)) return '';
        $scopes = ['single'];
        $projects = get_option('kodety_agency_projects', []);
        if (is_array($projects)) {
            foreach (array_keys($projects) as $project_id) {
                $project_id = $this->variant_key((string) $project_id);
                if ($project_id !== '') $scopes[] = $project_id;
            }
        }
        foreach (array_values(array_unique($scopes)) as $scope) {
            if (hash_equals($this->private_runtime_scope_token($scope), $token)) return $scope;
        }
        return '';
    }

    private function private_runtime_base_url(string $scope): string {
        return home_url(
            '/' . self::PRIVATE_RUNTIME_ROUTE . '/' . $this->private_runtime_scope_token($scope)
        );
    }

    private function validated_runtime_file(
        string $relative,
        string $expected_prefix = '',
        ?string $scope = null
    ): string {
        $relative = ltrim(str_replace('\\', '/', $relative), '/');
        $expected_prefix = trim(str_replace('\\', '/', $expected_prefix), '/');
        if (
            $relative === ''
            || !str_starts_with($relative, '.kodety-experiments/')
            || ($expected_prefix !== '' && !str_starts_with($relative, $expected_prefix . '/'))
            || str_contains($relative, '../')
            || str_contains($relative, "\0")
        ) return '';
        $runtime_root = $this->private_runtime_scope_root(false, $scope);
        $site_root = $runtime_root !== '' ? realpath($runtime_root . '/site') : false;
        $candidate = is_string($site_root) ? realpath($site_root . '/' . $relative) : false;
        if (
            !is_string($site_root)
            || !$candidate
            || !str_starts_with($candidate, trailingslashit($site_root))
            || !is_file($candidate)
        ) return '';
        return $relative;
    }

    private function activate_private_variant_runtime(string $runtime_relative): bool {
        if (!$this->pro_feature_enabled('experiments')) return false;
        $runtime_relative = $this->validated_runtime_file($runtime_relative);
        if ($runtime_relative === '') return false;
        $scope = $this->variant_key(self::project_scope_key());
        if ($scope === '') $scope = 'single';
        $directory = $this->private_runtime_scope_root(false, $scope);
        if ($directory === '') return false;
        $this->active_private_runtime = [
            'directory' => $directory,
            'directoryUri' => $this->private_runtime_base_url($scope),
            'runtimeRelative' => $runtime_relative,
        ];
        return true;
    }

    /** @param mixed $context @return array<string,mixed> */
    public function private_variant_runtime_context(mixed $context): array {
        $context = is_array($context) ? $context : [];
        if (!$this->active_private_runtime) return $context;
        if (!$this->pro_feature_enabled('experiments')) {
            $this->active_private_runtime = null;
            return $context;
        }
        $runtime_relative = $this->validated_runtime_file(
            (string) $this->active_private_runtime['runtimeRelative']
        );
        if ($runtime_relative === '') {
            $this->active_private_runtime = null;
            return $context;
        }
        // A sentinel route deliberately misses the public manifest so the
        // source page's guarded `_kodety_html_path` selects the private clone.
        return array_merge($context, [
            'directory' => (string) $this->active_private_runtime['directory'],
            'directoryUri' => (string) $this->active_private_runtime['directoryUri'],
            'route' => '__kodety_private_variant__',
        ]);
    }

    private function private_variant_asset_path(string $token, string $raw_asset): string {
        if (!$this->pro_feature_enabled('experiments')) return '';
        $scope = $this->private_runtime_scope_for_token(strtolower(trim($token)));
        if ($scope === '') return '';
        $asset = ltrim(str_replace('\\', '/', rawurldecode($raw_asset)), '/');
        if (
            $asset === ''
            || str_contains($asset, "\0")
            || preg_match('~(?:^|/)\.\.?(?:/|$)~', $asset)
            || !preg_match(
                '~^site/\.kodety-experiments/([a-z0-9_-]+)/([a-z0-9_-]+)/(.+)$~D',
                $asset,
                $matches
            )
        ) return '';
        $experiment_key = $this->variant_key((string) $matches[1]);
        $variant_key = $this->variant_key((string) $matches[2]);
        $relative_asset = (string) $matches[3];
        if ($experiment_key === '' || $variant_key === '' || $relative_asset === '') return '';
        $extension = strtolower(pathinfo($relative_asset, PATHINFO_EXTENSION));
        if (in_array($extension, ['php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'html', 'htm'], true)) {
            return '';
        }

        global $wpdb;
        $scope_marker = $scope === 'single'
            ? '%'
            : '%"projectKey":"' . $this->wpdb_like($scope) . '"%';
        $expected_external = $scope === 'single'
            ? $experiment_key
            : $this->variant_key($scope . '--' . $experiment_key);
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT experiments.external_id,variants.metadata
             FROM {$this->table('variants')} variants
             INNER JOIN {$this->table('experiments')} experiments
                ON experiments.id=variants.experiment_id
             WHERE experiments.status='running' AND variants.enabled=1
             AND variants.is_control=0 AND variants.weight>0
             AND experiments.external_id=%s AND variants.variant_key=%s
             AND experiments.config_json LIKE %s LIMIT 1",
            $expected_external,
            $variant_key,
            $scope_marker
        ), ARRAY_A);
        if (!is_array($row) || !hash_equals($expected_external, (string) ($row['external_id'] ?? ''))) {
            return '';
        }
        $metadata = $row['metadata'] ?? [];
        if (!is_array($metadata)) $metadata = json_decode((string) $metadata, true);
        $metadata = is_array($metadata) ? $metadata : [];
        $expected_prefix = '.kodety-experiments/' . $experiment_key . '/' . $variant_key;
        if ($this->validated_runtime_file(
            (string) ($metadata['runtime_relative'] ?? ''),
            $expected_prefix,
            $scope
        ) === '') return '';

        $root = $this->private_runtime_scope_root(false, $scope);
        $variant_root = $root !== ''
            ? realpath($root . '/site/' . $expected_prefix)
            : false;
        $file = is_string($variant_root)
            ? realpath($variant_root . '/' . $relative_asset)
            : false;
        if (
            !is_string($variant_root)
            || !is_string($file)
            || !$this->filesystem_path_is_within($file, $variant_root)
            || !is_file($file)
            || is_link($file)
        ) return '';
        return $file;
    }

    public function serve_private_variant_asset(): void {
        $asset = (string) get_query_var('kodety_experiment_runtime_asset');
        if ($asset === '') return;
        $token = (string) get_query_var('kodety_experiment_runtime_scope');
        $file = $this->private_variant_asset_path($token, $asset);
        if ($file === '') {
            status_header(404);
            header('Cache-Control: private, no-store, max-age=0');
            header('X-Content-Type-Options: nosniff');
            exit;
        }
        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $detected = function_exists('wp_check_filetype') ? wp_check_filetype($file) : [];
        $mime = is_array($detected) ? (string) ($detected['type'] ?? '') : '';
        if ($mime === '' && function_exists('mime_content_type')) {
            $detected_mime = mime_content_type($file);
            if (is_string($detected_mime)) $mime = $detected_mime;
        }
        if (in_array($extension, ['js', 'mjs', 'cjs'], true)) $mime = 'application/javascript';
        elseif ($extension === 'css') $mime = 'text/css';
        if ($mime === '') $mime = 'application/octet-stream';
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (int) filesize($file));
        // Never let a CDN retain a Pro asset beyond the request that proved the
        // license and running experiment state.
        header('Cache-Control: private, no-store, max-age=0');
        header('X-Content-Type-Options: nosniff');
        header('X-Robots-Tag: noindex, nofollow, noarchive');
        readfile($file);
        exit;
    }

    /** Remove every legacy direct-web clone namespace left by older releases. */
    public function purge_legacy_public_runtime_trees(): void {
        $site_root = $this->generated_theme_site_root();
        if ($site_root === '' || !is_dir($site_root)) return;
        $removed = false;
        foreach (new DirectoryIterator($site_root) as $item) {
            if ($item->isDot()) continue;
            $name = $item->getFilename();
            if (
                $name !== '.kodety-experiments'
                && !str_starts_with($name, '.kodety-experiments-staging-')
                && !str_starts_with($name, '.kodety-experiments-backup-')
            ) continue;
            $path = $item->getPathname();
            if ($item->isLink() || $item->isFile()) @unlink($path);
            elseif ($item->isDir()) $this->remove_runtime_tree($path);
            if (!file_exists($path) && !is_link($path)) $removed = true;
        }
        // Older releases exposed these trees as static files, so a reverse
        // proxy may still hold them after the filesystem migration.
        if ($removed) $this->purge_published_analytics_cache();
    }

    /**
     * Resolve the published clone from metadata or, for releases affected by
     * the historical foreach-by-reference bug, derive it from the physical
     * isolated clone and persist the repaired metadata.
     *
     * @param array<string,mixed> $experiment
     * @param array<string,mixed> $variant
     */
    private function runtime_relative_for_variant(array $experiment, array $variant, bool $repair): string {
        $experiment_key = $this->variant_key($this->public_external_id(
            (string) ($experiment['external_id'] ?? $experiment['id'] ?? '')
        ));
        $variant_key = $this->variant_key((string) ($variant['variant_key'] ?? $variant['id'] ?? ''));
        if ($experiment_key === '' || $variant_key === '') return '';
        $expected_prefix = '.kodety-experiments/' . $experiment_key . '/' . $variant_key;
        $metadata = $variant['metadata'] ?? [];
        if (!is_array($metadata)) $metadata = json_decode((string) $metadata, true);
        $metadata = is_array($metadata) ? $metadata : [];
        $stored = $this->validated_runtime_file(
            (string) ($metadata['runtime_relative'] ?? ''),
            $expected_prefix
        );
        if ($stored !== '') return $stored;

        $private_root = $this->private_runtime_scope_root(false);
        $site_root = $private_root !== '' ? realpath($private_root . '/site') : false;
        $runtime_dir = is_string($site_root) ? realpath($site_root . '/' . $expected_prefix) : false;
        if (
            !is_string($site_root)
            || !$runtime_dir
            || !str_starts_with($runtime_dir, trailingslashit($site_root))
            || !is_dir($runtime_dir)
        ) return '';

        $candidates = [
            (string) ($metadata['source_page_path'] ?? ''),
            (string) ($variant['sourcePagePath'] ?? ''),
            (string) ($variant['page_path'] ?? $variant['pagePath'] ?? ''),
            (string) ($experiment['page_path'] ?? $experiment['pagePath'] ?? ''),
            'index.html',
            'index.htm',
        ];
        $runtime_file = '';
        foreach ($candidates as $candidate) {
            $candidate = ltrim(str_replace('\\', '/', (string) wp_parse_url($candidate, PHP_URL_PATH)), '/');
            $private_prefix = '.incode/experiments/' . $experiment_key . '/' . $variant_key . '/project/';
            if (str_starts_with($candidate, $private_prefix)) {
                $candidate = substr($candidate, strlen($private_prefix));
            }
            if (
                $candidate === ''
                || str_contains($candidate, '../')
                || str_contains($candidate, "\0")
            ) continue;
            $resolved = realpath($runtime_dir . '/' . $candidate);
            if (
                $resolved
                && str_starts_with($resolved, trailingslashit($runtime_dir))
                && is_file($resolved)
            ) {
                $runtime_file = $resolved;
                break;
            }
        }
        if ($runtime_file === '') {
            $first = $this->first_runtime_html($runtime_dir);
            $runtime_file = $first !== '' ? (string) realpath($runtime_dir . '/' . $first) : '';
        }
        if (
            $runtime_file === ''
            || !str_starts_with($runtime_file, trailingslashit($runtime_dir))
            || !is_file($runtime_file)
        ) return '';
        $relative = ltrim(str_replace('\\', '/', substr($runtime_file, strlen($site_root))), '/');
        $relative = $this->validated_runtime_file($relative, $expected_prefix);
        if ($relative === '' || !$repair) return $relative;

        $metadata['runtime_relative'] = $relative;
        $metadata = $this->sanitize_variant_metadata($metadata);
        global $wpdb;
        $experiment_id = absint($experiment['id'] ?? $variant['experiment_id'] ?? 0);
        $variant_id = absint($variant['id'] ?? 0);
        if (isset($wpdb) && is_object($wpdb) && $experiment_id > 0) {
            $where = $variant_id > 0
                ? ['id' => $variant_id, 'experiment_id' => $experiment_id]
                : ['experiment_id' => $experiment_id, 'variant_key' => $variant_key];
            $wpdb->update($this->table('variants'), [
                'metadata' => wp_json_encode($metadata),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ], $where);
        }
        return $relative;
    }

    /**
     * Rebuild the map of public variant URLs served by the runtime.
     *
     * Only running experiments with an enabled, non-control variant that owns a
     * public slug AND a validated published clone contribute a route. The map is
     * stored as an autoloaded option so request-time resolution is a single
     * array lookup with no query. Must run after every publish (clones become
     * authoritative) and after any status change.
     */
    /** @return array<string,array<string,mixed>> */
    private function collect_public_variant_routes(bool $strict): array {
        if (!$this->pro_feature_enabled('experiments')) return [];
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT v.id, v.experiment_id, v.variant_key, v.page_path, v.metadata,
                    e.external_id, e.page_path experiment_page_path, e.source_page_id
             FROM {$this->table('variants')} v
             INNER JOIN {$this->table('experiments')} e ON e.id = v.experiment_id
             WHERE e.status='running' AND v.enabled=1 AND v.is_control=0 AND v.weight>0
             ORDER BY e.started_at ASC, v.id ASC",
            ARRAY_A
        );
        $routes = [];
        foreach ((array) $rows as $row) {
            $metadata = json_decode((string) ($row['metadata'] ?? ''), true);
            $metadata = is_array($metadata) ? $metadata : [];
            $slug = $this->public_variant_slug((string) ($metadata['public_slug'] ?? ''));
            $runtime_relative = $this->runtime_relative_for_variant([
                'id' => (int) $row['experiment_id'],
                'external_id' => (string) $row['external_id'],
                'page_path' => (string) $row['experiment_page_path'],
            ], $row, true);
            if ($slug === '' || $runtime_relative === '') continue;
            $conflict = '';
            if (isset($routes[$slug])) {
                $conflict = 'Duas variantes ativas usam a URL pública /' . $slug . '.';
            } else {
                $conflict = $this->public_variant_slug_conflict($slug);
            }
            if ($conflict !== '') {
                if ($strict) throw new RuntimeException($conflict);
                error_log('[Onun Kodety] Rota de A/B Test ignorada: ' . $conflict);
                continue;
            }
            $routes[$slug] = [
                'experiment_id' => (int) $row['experiment_id'],
                'variant_key' => (string) $row['variant_key'],
                'source_page_id' => (int) $row['source_page_id'],
                'runtime_relative' => $runtime_relative,
            ];
        }
        return $routes;
    }

    private function public_variant_slug_conflict(string $slug): string {
        $first_segment = strtolower((string) strtok($slug, '/'));
        if (in_array($first_segment, ['wp-admin', 'wp-json', 'wp-login.php', self::PRIVATE_RUNTIME_ROUTE], true)) {
            return 'A URL pública /' . $slug . ' é reservada pelo WordPress.';
        }
        if (function_exists('get_page_by_path') && get_page_by_path($slug) instanceof WP_Post) {
            return 'A URL pública /' . $slug . ' já pertence a uma página do WordPress.';
        }
        $site_root = $this->generated_theme_site_root();
        $manifest_path = $site_root !== '' ? dirname($site_root) . '/manifest.json' : '';
        $manifest = $manifest_path !== '' && is_file($manifest_path)
            ? json_decode((string) file_get_contents($manifest_path), true)
            : [];
        if (is_array($manifest)) {
            foreach (array_keys($manifest) as $route) {
                if (trim(str_replace('\\', '/', (string) $route), '/') === $slug) {
                    return 'A URL pública /' . $slug . ' já pertence a uma página publicada.';
                }
            }
        }
        return '';
    }

    public function rebuild_public_variant_routes(): void {
        $routes = $this->collect_public_variant_routes(false);
        update_option(self::PUBLIC_ROUTES_OPTION, $routes, true);
        // Register the rewrite rules for the current set and flush so the slugs
        // resolve on any host. Rebuild only runs on publish/state changes, so a
        // flush here is infrequent and worth the certainty that the rules exist.
        $this->register_variant_rewrite_rules();
        flush_rewrite_rules(false);
    }

    /**
     * Register a real WordPress rewrite rule for every public variant slug so
     * the request reaches WordPress on any host instead of a server-level 404.
     * Called on `init` (from the stored map) and after each rebuild.
     */
    public function register_variant_rewrite_rules(): void {
        add_rewrite_rule(
            '^' . preg_quote(self::PRIVATE_RUNTIME_ROUTE, '~') . '/([a-f0-9]{32})/(.+)$',
            'index.php?kodety_experiment_runtime_scope=$matches[1]&kodety_experiment_runtime_asset=$matches[2]',
            'top'
        );
        $routes = get_option(self::PUBLIC_ROUTES_OPTION, []);
        if (!$this->pro_feature_enabled('experiments')) {
            // A naturally expired grant may not have emitted a deactivation
            // hook. Remove the persisted map/rules on the next `init` so a
            // previously published physical variant URL cannot stay routable.
            if (!empty($routes)) {
                update_option(self::PUBLIC_ROUTES_OPTION, [], true);
                flush_rewrite_rules(false);
            }
            return;
        }
        if (!is_array($routes)) return;
        foreach (array_keys($routes) as $slug) {
            $slug = $this->public_variant_slug((string) $slug);
            if ($slug === '') continue;
            add_rewrite_rule('^' . preg_quote($slug, '~') . '/?$', 'index.php?kodety_variant=' . rawurlencode($slug), 'top');
        }
    }

    /**
     * Resolve a request path against the stored public-route map.
     *
     * @param array<string,mixed> $routes
     * @return array{experiment_id:int,variant_key:string,source_page_id:int,runtime_relative:string}|null
     */
    private function match_public_variant_route(array $routes, string $path): ?array {
        $slug = ltrim($this->sanitize_page_path($path), '/');
        if ($slug === '') return null;
        $entry = $routes[$slug] ?? null;
        if (!is_array($entry)) return null;
        $source_page_id = (int) ($entry['source_page_id'] ?? 0);
        $runtime_relative = ltrim(str_replace('\\', '/', (string) ($entry['runtime_relative'] ?? '')), '/');
        if (
            $source_page_id <= 0
            || $runtime_relative === ''
            || !str_starts_with($runtime_relative, '.kodety-experiments/')
            || str_contains($runtime_relative, '../')
            || str_contains($runtime_relative, "\0")
        ) return null;
        return [
            'experiment_id' => (int) ($entry['experiment_id'] ?? 0),
            'variant_key' => (string) ($entry['variant_key'] ?? ''),
            'source_page_id' => $source_page_id,
            'runtime_relative' => $runtime_relative,
        ];
    }

    /**
     * Detect a public variant URL (e.g. /home-b) during request parsing and,
     * when matched, route the request to render the experiment's source page.
     * Real published content and Onun Kodety app routes always win over a slug.
     */
    public function detect_variant_public_route(WP $wp): void {
        $this->forced_variant_route = null;
        if (!$this->pro_feature_enabled('experiments')) return;
        if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST)) return;
        if (!empty($wp->query_vars['kodety_app']) || !empty($wp->query_vars['kodety_asset'])) return;
        $routes = get_option(self::PUBLIC_ROUTES_OPTION, []);
        if (!is_array($routes) || !$routes) return;
        // Prefer the slug the rewrite rule resolved; fall back to the raw request
        // path for hosts that route unknown paths straight to index.php.
        $rule_slug = isset($wp->query_vars['kodety_variant'])
            ? $this->public_variant_slug((string) $wp->query_vars['kodety_variant'])
            : '';
        $path = $rule_slug !== '' ? '/' . $rule_slug : (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $match = $this->match_public_variant_route($routes, $path);
        if (!$match) return;
        $normalized = ltrim($this->sanitize_page_path($path), '/');
        if ($normalized !== '' && get_page_by_path($normalized) instanceof WP_Post) return;
        $this->forced_variant_route = $match;
        $wp->query_vars = ['page_id' => $match['source_page_id']];
    }

    /**
     * Serve the variant clone for a detected public variant URL. Renders the
     * source page but forces its HTML to the variant's published clone, and
     * attributes the visit to the variant for conversion tracking (never for a
     * logged-in owner previewing the URL).
     */
    public function apply_forced_variant_route(): void {
        if (!$this->pro_feature_enabled('experiments')) {
            $this->clear_experiment_identity_cookies();
            $this->forced_variant_route = null;
            return;
        }
        if (!$this->forced_variant_route) return;
        if (!$this->experiment_consent_granted()) {
            $this->clear_experiment_identity_cookies();
            $this->forced_variant_route = null;
            return;
        }
        $route = $this->forced_variant_route;
        global $wpdb;
        $experiment = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('experiments')} WHERE id=%d AND status='running'",
            (int) $route['experiment_id']
        ), ARRAY_A);
        $variant = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('variants')}
             WHERE experiment_id=%d AND variant_key=%s
             AND enabled=1 AND is_control=0 AND weight>0",
            (int) $route['experiment_id'],
            (string) $route['variant_key']
        ), ARRAY_A);
        if (!is_array($experiment) || !is_array($variant)) {
            $this->forced_variant_route = null;
            return;
        }
        $source_id = (int) $experiment['source_page_id'];
        $runtime_relative = $this->runtime_relative_for_variant($experiment, $variant, true);
        $source_page = $source_id > 0 ? get_post($source_id) : null;
        if (
            $source_id <= 0
            || $runtime_relative === ''
            || (int) $route['source_page_id'] !== $source_id
            || !$source_page instanceof WP_Post
            || $source_page->post_type !== 'page'
            || $source_page->post_status !== 'publish'
        ) {
            $this->forced_variant_route = null;
            return;
        }
        if (!$this->activate_private_variant_runtime($runtime_relative)) {
            $this->forced_variant_route = null;
            return;
        }
        // Install the HTML override only after current DB state and the physical
        // clone have both been validated. A stale option can never serve a
        // paused/deleted/zero-weight variant.
        $this->forced_variant_route['runtime_relative'] = $runtime_relative;
        $this->protect_experiment_response_from_cache();
        add_filter('redirect_canonical', '__return_false', 999);
        add_filter('get_post_metadata', static function (mixed $value, int $object_id, string $meta_key, bool $single) use ($source_id, $runtime_relative): mixed {
            if ($object_id === $source_id && $meta_key === '_kodety_html_path') return $single ? $runtime_relative : [$runtime_relative];
            return $value;
        }, 5, 4);
        if (is_user_logged_in()) return;
        $visitor = isset($_COOKIE['kodety_vid']) ? $this->opaque_id(wp_unslash((string) $_COOKIE['kodety_vid'])) : '';
        if ($visitor === '') {
            $visitor = str_replace('-', '', wp_generate_uuid4());
            $this->set_public_cookie('kodety_vid', $visitor, 365 * DAY_IN_SECONDS, false);
        }
        $config = $this->experiment_config($experiment);
        $this->set_public_cookie('kodety_exp_' . (int) $experiment['id'], (string) $variant['variant_key'], (int) $config['stickyDays'] * DAY_IN_SECONDS, true);
        $this->register_source_assignment($experiment, $this->assignment_payload($experiment, $variant));
    }

    /** @param array<string,mixed> $experiment */
    private function experiment_should_stop(array $experiment): bool {
        $config = $this->experiment_config($experiment);
        $end_at = (string) ($config['autoStop']['endAt'] ?? '');
        if ($end_at !== '' && strtotime($end_at) !== false && time() >= strtotime($end_at)) return true;
        $limit = absint($config['autoStop']['maxExposures'] ?? 0);
        if ($limit <= 0) return false;
        global $wpdb;
        $exposures = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$this->table('events')} WHERE experiment_id=%d AND event_type='exposure'",
            (int) $experiment['id']
        ));
        return $exposures >= $limit;
    }

    /** @param array<string,mixed> $experiment */
    private function experiment_audience_matches(array $experiment, bool $had_visitor): bool {
        $audience = $this->experiment_config($experiment)['audience'];
        $device = (string) ($audience['device'] ?? 'all');
        $is_mobile = wp_is_mobile();
        if ($device === 'mobile' && !$is_mobile) return false;
        if ($device === 'desktop' && $is_mobile) return false;
        $visitor = (string) ($audience['visitor'] ?? 'all');
        if ($visitor === 'new' && $had_visitor) return false;
        if ($visitor === 'returning' && !$had_visitor) return false;
        $query_parameter = (string) ($audience['queryParameter'] ?? '');
        if ($query_parameter !== '') {
            if (!isset($_GET[$query_parameter]) || is_array($_GET[$query_parameter])) return false;
            $actual = sanitize_text_field(wp_unslash((string) $_GET[$query_parameter]));
            $expected = (string) ($audience['queryValue'] ?? '');
            if ($expected !== '' && !hash_equals($expected, $actual)) return false;
        }
        $expected_host = (string) ($audience['referrerHost'] ?? '');
        if ($expected_host !== '') {
            $actual_host = strtolower((string) wp_parse_url(
                wp_unslash((string) ($_SERVER['HTTP_REFERER'] ?? '')),
                PHP_URL_HOST
            ));
            if ($actual_host !== $expected_host && !str_ends_with($actual_host, '.' . $expected_host)) return false;
        }
        return true;
    }

    /**
     * Experiments choose content and create sticky identifiers before the
     * browser runtime starts. When the published project enables the consent
     * manager, PHP must therefore honor its first-party decision cookie.
     */
    private function experiment_consent_granted(): bool {
        if (!self::consent_manager_enabled()) return true;
        $value = isset($_COOKIE['kodety_consent_experiments'])
            ? sanitize_key(wp_unslash((string) $_COOKIE['kodety_consent_experiments']))
            : '';
        return hash_equals('granted', $value);
    }

    private function clear_experiment_identity_cookies(): void {
        if (isset($_COOKIE['kodety_vid'])) $this->clear_public_cookie('kodety_vid');
        foreach (array_keys($_COOKIE) as $name) {
            if (preg_match('/^kodety_exp_\d+$/', (string) $name)) $this->clear_public_cookie((string) $name);
        }
        $this->request_assignments = [];
    }

    public function maybe_apply_experiment(): void {
        if (!$this->pro_feature_enabled('experiments')) {
            $this->clear_experiment_identity_cookies();
            return;
        }
        if ($this->forced_variant_route) return;
        if (is_admin() || is_user_logged_in() || wp_doing_ajax() || !is_singular('page') || is_preview()) return;
        if (!$this->experiment_consent_granted()) {
            $this->clear_experiment_identity_cookies();
            return;
        }
        $source_id = get_queried_object_id();
        if ($source_id <= 0) return;
        $this->hydrate_request_assignments_from_cookies();
        global $wpdb, $wp_query, $post;
        $request_path = $this->sanitize_page_path((string) ($_SERVER['REQUEST_URI'] ?? '/'));
        $experiment = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$this->table('experiments')}
             WHERE status='running' AND (source_page_id=%d OR page_hash=%s)
             ORDER BY (source_page_id=%d) DESC,started_at ASC,id ASC LIMIT 1",
            $source_id,
            hash('sha256', $request_path),
            $source_id
        ), ARRAY_A);
        if (!is_array($experiment)) return;
        if ($this->experiment_should_stop($experiment)) {
            $wpdb->update($this->table('experiments'), [
                'status' => 'completed',
                'ended_at' => gmdate('Y-m-d H:i:s'),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ], ['id' => (int) $experiment['id']]);
            $this->rebuild_public_variant_routes();
            return;
        }
        $had_visitor = isset($_COOKIE['kodety_vid'])
            && $this->opaque_id(wp_unslash((string) $_COOKIE['kodety_vid'])) !== '';
        if (!$this->experiment_audience_matches($experiment, $had_visitor)) return;
        $this->protect_experiment_response_from_cache();
        // A sticky assignment was hydrated for cross-page attribution. On the
        // source page it is only exposed to the tracker after its concrete
        // runtime document has been validated below.
        unset($this->request_assignments[(int) $experiment['id']]);
        $visitor = isset($_COOKIE['kodety_vid']) ? $this->opaque_id(wp_unslash((string) $_COOKIE['kodety_vid'])) : '';
        if ($visitor === '') {
            $visitor = str_replace('-', '', wp_generate_uuid4());
            $this->set_public_cookie('kodety_vid', $visitor, 365 * DAY_IN_SECONDS, false);
        }
        $assignment = $this->choose_variant($experiment, $visitor, true);
        if (empty($assignment['assigned'])) return;
        if (!empty($assignment['isControl'])) {
            $this->register_source_assignment($experiment, $assignment);
            return;
        }
        $config = $this->experiment_config($experiment);
        if ($config['deliveryMode'] === 'redirect') {
            $redirect_url = $this->public_variant_redirect_url($experiment, $assignment);
            if (
                $redirect_url !== ''
                && function_exists('wp_safe_redirect')
                && wp_safe_redirect($redirect_url, 302, 'Onun Kodety A/B Test')
            ) {
                exit;
            }
        }
        $runtime_relative = $this->validated_runtime_file(
            (string) ($assignment['runtimeRelative'] ?? '')
        );
        if ($runtime_relative !== '' && $this->activate_private_variant_runtime($runtime_relative)) {
            $this->register_source_assignment($experiment, $assignment);
            add_filter('get_post_metadata', static function (mixed $value, int $object_id, string $meta_key, bool $single) use ($source_id, $runtime_relative): mixed {
                if ($object_id === $source_id && $meta_key === '_kodety_html_path') return $single ? $runtime_relative : [$runtime_relative];
                return $value;
            }, 5, 4);
            return;
        }
        $variant_page_id = absint($assignment['pageId'] ?? 0);
        if ($variant_page_id <= 0 || $variant_page_id === $source_id) {
            $this->clear_public_cookie('kodety_exp_' . (int) $experiment['id']);
            return;
        }
        $variant = get_post($variant_page_id);
        if (!$variant instanceof WP_Post || $variant->post_type !== 'page' || $variant->post_status !== 'publish') {
            $this->clear_public_cookie('kodety_exp_' . (int) $experiment['id']);
            return;
        }
        $this->register_source_assignment($experiment, $assignment);
        $wp_query->posts[0] = $variant;
        $wp_query->post = $variant;
        $wp_query->queried_object = $variant;
        $wp_query->queried_object_id = $variant_page_id;
        $post = $variant;
        add_filter('redirect_canonical', '__return_false', 999);
    }

    /**
     * Return the deployed public URL only when the route map still points to the
     * exact selected experiment, variant, source page and validated clone.
     *
     * @param array<string,mixed> $experiment
     * @param array<string,mixed> $assignment
     */
    private function public_variant_redirect_url(array $experiment, array $assignment): string {
        $slug = $this->public_variant_slug((string) ($assignment['publicSlug'] ?? ''));
        $runtime_relative = ltrim(str_replace('\\', '/', (string) ($assignment['runtimeRelative'] ?? '')), '/');
        if ($slug === '' || $runtime_relative === '') return '';
        $routes = get_option(self::PUBLIC_ROUTES_OPTION, []);
        $route = is_array($routes) ? ($routes[$slug] ?? null) : null;
        if (
            !is_array($route)
            || (int) ($route['experiment_id'] ?? 0) !== (int) ($experiment['id'] ?? 0)
            || !hash_equals((string) ($route['variant_key'] ?? ''), (string) ($assignment['variantId'] ?? ''))
            || (int) ($route['source_page_id'] ?? 0) !== (int) ($experiment['source_page_id'] ?? 0)
            || !hash_equals(
                ltrim(str_replace('\\', '/', (string) ($route['runtime_relative'] ?? '')), '/'),
                $runtime_relative
            )
        ) return '';
        $target = home_url('/' . $slug);
        $query_args = $this->public_redirect_query_args();
        if ($query_args) $target = add_query_arg($query_args, $target);
        $target_path = $this->sanitize_page_path((string) wp_parse_url($target, PHP_URL_PATH));
        $request_path = $this->sanitize_page_path((string) ($_SERVER['REQUEST_URI'] ?? '/'));
        return hash_equals($target_path, $request_path) ? '' : $target;
    }

    /** @return array<string,mixed> */
    private function public_redirect_query_args(): array {
        $raw = (string) ($_SERVER['QUERY_STRING'] ?? '');
        if ($raw === '') return [];
        $parsed = [];
        wp_parse_str($raw, $parsed);
        if (!is_array($parsed)) return [];
        $clean = [];
        foreach (array_slice($parsed, 0, 50, true) as $key => $value) {
            $key = sanitize_key((string) $key);
            if (
                $key === ''
                || str_starts_with($key, 'kodety_')
                || in_array($key, ['preview', 'preview_id', 'preview_nonce', '_wpnonce', 'rest_route'], true)
            ) continue;
            $sanitized = $this->sanitize_public_query_value($value, 0);
            if ($sanitized !== null) $clean[$key] = $sanitized;
        }
        return $clean;
    }

    private function sanitize_public_query_value(mixed $value, int $depth): mixed {
        if ($depth > 2) return null;
        if (is_array($value)) {
            $clean = [];
            foreach (array_slice($value, 0, 20, true) as $key => $item) {
                $key = sanitize_key((string) $key);
                if ($key === '') continue;
                $sanitized = $this->sanitize_public_query_value($item, $depth + 1);
                if ($sanitized !== null) $clean[$key] = $sanitized;
            }
            return $clean ?: null;
        }
        if (!is_scalar($value)) return null;
        return substr(sanitize_text_field(wp_unslash((string) $value)), 0, 512);
    }

    /** @param array<string,mixed> $experiment @param array<string,mixed> $assignment */
    private function register_source_assignment(array $experiment, array $assignment): void {
        $assignment['sourceRequest'] = true;
        $assignment['exposure'] = true;
        $this->request_assignments[(int) $experiment['id']] = $assignment;
    }

    /**
     * Experiment source responses vary by a sticky HttpOnly cookie. Never let
     * a page cache turn one visitor's variant into another visitor's response.
     * DONOTCACHEPAGE is honored by the major WordPress page-cache plugins;
     * the explicit headers cover reverse proxies that reach PHP.
     */
    private function protect_experiment_response_from_cache(): void {
        if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
        if (function_exists('nocache_headers')) nocache_headers();
        if (headers_sent()) return;
        header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0', true);
        header('Vary: Cookie', false);
    }

    /**
     * Keep conversion attribution across page navigation. Variant cookies are
     * HttpOnly and validated against currently running definitions before
     * exposing the minimal assignment contract to the first-party tracker.
     */
    private function hydrate_request_assignments_from_cookies(): void {
        global $wpdb;
        $seen = 0;
        foreach ($_COOKIE as $name => $raw_variant) {
            if (!preg_match('/^kodety_exp_(\d+)$/', (string) $name, $matches)) continue;
            if (++$seen > 20) break;
            $experiment_id = absint($matches[1]);
            $variant_key = $this->variant_key(wp_unslash((string) $raw_variant));
            if ($experiment_id <= 0 || $variant_key === '') continue;
            $experiment = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$this->table('experiments')} WHERE id=%d AND status='running'",
                $experiment_id
            ), ARRAY_A);
            if (!is_array($experiment)) continue;
            $variant = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$this->table('variants')}
                 WHERE experiment_id=%d AND variant_key=%s AND enabled=1 AND weight>0",
                $experiment_id,
                $variant_key
            ), ARRAY_A);
            if (!is_array($variant)) continue;
            $this->request_assignments[$experiment_id] = $this->assignment_payload($experiment, $variant);
        }
    }

    public function print_tracking_script(): void {
        if (is_admin() || self::project_option('kodety_analytics_enabled', '1') !== '1') return;
        // A Studio project runs entirely inside the visitor's own browser. It
        // is not a published environment, so local navigation must never
        // create visitor/session records that look like production traffic.
        if (
            class_exists('Kodety_Plugin')
            && Kodety_Plugin::instance()->browser_studio_runtime() !== null
        ) return;
        $config = [
            'endpoint' => rest_url('kodety/v1/analytics/collect'),
            'assignments' => array_values($this->request_assignments),
            'respectPrivacy' => true,
            'consentRequired' => self::consent_manager_enabled(),
            'projectKey' => self::project_scope_key(),
        ];
        $json = wp_json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        ?>
        <script data-kodety-analytics="1">
        (() => {
          "use strict";
          const config = <?php echo $json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
          const consentAllowsAnalytics = () => {
            const manager = window.kodety?.consent;
            if (manager && typeof manager.hasIntegration === "function") return manager.hasIntegration("kodetyAnalytics") === true;
            if (manager && typeof manager.has === "function") return manager.has("analytics") === true;
            if (config.consentRequired) return window.__kodetyAnalyticsConsentGranted === true;
            return window.__kodetyAnalyticsConsentGranted !== false && window.kodetyAnalyticsConsent !== false;
          };
          if (config.respectPrivacy && (navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true)) return;
          if (!consentAllowsAnalytics()) {
            const sourceScript = document.currentScript;
            if (sourceScript && window.__kodetyAnalyticsConsentWaitBound !== true) {
              window.__kodetyAnalyticsConsentWaitBound = true;
              const resume = () => {
                if (!consentAllowsAnalytics() || window.__kodetyAnalyticsTrackerLoaded === true) return;
                removeEventListener("kodety:consent-change", resume);
                removeEventListener("kodety:analytics-consent", resume);
                window.__kodetyAnalyticsConsentWaitBound = false;
                const retry = document.createElement("script");
                retry.textContent = sourceScript.textContent;
                sourceScript.after(retry);
              };
              addEventListener("kodety:consent-change", resume);
              addEventListener("kodety:analytics-consent", resume);
            }
            return;
          }
          if (
            window.name === "kodety-analytics-published-preview"
            || new URLSearchParams(location.search).has("kodety-analytics-preview")
          ) return;
          if (window.__kodetyAnalyticsTrackerLoaded === true) return;
          window.__kodetyAnalyticsTrackerLoaded = true;
          const projectKey = String(config.projectKey || "single").replace(/[^a-z0-9_-]/gi, "") || "single";
          const key = `kodety.analytics.${projectKey}.`;
          const visitorCookie = `kodety_analytics_visitor_${projectKey}`;
          const sessionCookie = `kodety_analytics_session_${projectKey}`;
          const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
          const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{15,63}$/i.test(value);
          const readCookie = name => {
            const prefix = `${encodeURIComponent(name)}=`;
            const part = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
            if (!part) return "";
            try { return decodeURIComponent(part.slice(prefix.length)); } catch (_) { return ""; }
          };
          const writeCookie = (name, value, maxAge) => {
            const secure = location.protocol === "https:" ? "; Secure" : "";
            document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
          };
          const eraseCookie = name => {
            const secure = location.protocol === "https:" ? "; Secure" : "";
            document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
          };
          let storedVisitor = "";
          try { storedVisitor = localStorage.getItem(key + "visitor") || ""; } catch (_) {}
          const cookieVisitor = readCookie(visitorCookie);
          const isNewVisitor = !validId(storedVisitor) && !validId(cookieVisitor);
          const visitorId = validId(storedVisitor) ? storedVisitor : (validId(cookieVisitor) ? cookieVisitor : randomId());
          let identitySource = "memory";
          try {
            localStorage.setItem(key + "visitor", visitorId);
            if (localStorage.getItem(key + "visitor") === visitorId) identitySource = "local-storage";
          } catch (_) {}
          writeCookie(visitorCookie, visitorId, 365 * 24 * 60 * 60);
          if (identitySource === "memory" && readCookie(visitorCookie) === visitorId) identitySource = "cookie";

          const parseSession = value => {
            if (!value) return null;
            try {
              const parsed = typeof value === "string" && value.startsWith("{")
                ? JSON.parse(value)
                : (() => { const [id, last] = String(value).split("|"); return { id, last: Number(last) }; })();
              return validId(parsed?.id) && Number.isFinite(Number(parsed?.last))
                ? { id: parsed.id, last: Number(parsed.last) }
                : null;
            } catch (_) { return null; }
          };
          let localSession = null;
          try { localSession = parseSession(localStorage.getItem(key + "session")); } catch (_) {}
          const cookieSession = parseSession(readCookie(sessionCookie));
          const now = Date.now();
          const recent = [localSession, cookieSession]
            .filter(item => item && now - item.last <= 30 * 60 * 1000)
            .sort((left, right) => right.last - left.last);
          const session = recent[0] || { id: randomId(), last: now };
          const persistSession = () => {
            session.last = Date.now();
            try { localStorage.setItem(key + "session", JSON.stringify(session)); } catch (_) {}
            writeCookie(sessionCookie, `${session.id}|${session.last}`, 30 * 60);
          };
          persistSession();

          const userAgentData = navigator.userAgentData || {};
          const brands = Array.isArray(userAgentData.brands) ? userAgentData.brands.map(item => item?.brand || "").join(" ") : "";
          const browser = /Microsoft Edge|Edge/i.test(brands) ? "Edge"
            : /Google Chrome/i.test(brands) ? "Chrome"
            : /Chromium/i.test(brands) ? "Chromium"
            : /Edg\//i.test(navigator.userAgent) ? "Edge"
            : /OPR\//i.test(navigator.userAgent) ? "Opera"
            : /Firefox\//i.test(navigator.userAgent) ? "Firefox"
            : /CriOS|Chrome\//i.test(navigator.userAgent) ? "Chrome"
            : /Safari\//i.test(navigator.userAgent) ? "Safari"
            : "Outro";
          const operatingSystem = String(userAgentData.platform || (
            /Windows/i.test(navigator.userAgent) ? "Windows"
              : /Android/i.test(navigator.userAgent) ? "Android"
              : /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "iOS"
              : /Macintosh|Mac OS X/i.test(navigator.userAgent) ? "macOS"
              : /Linux/i.test(navigator.userAgent) ? "Linux"
              : "Outro"
          )).slice(0, 64);
          const device = userAgentData.mobile === true || matchMedia("(max-width: 767px) and (pointer: coarse)").matches
            ? "mobile"
            : (/iPad|Tablet/i.test(navigator.userAgent) ? "tablet" : "desktop");
          let timezone = "";
          try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
          const assignments = Array.isArray(config.assignments) ? config.assignments : [];
          const assignmentFor = (type, trackingId, extra) => {
            const source = assignments.find(item => item?.sourceRequest);
            if (source) return source;
            const currentPath = location.pathname || "/";
            return assignments.find(item => {
              const goal = item?.goal || {};
              if (goal.type === "pageview" && type === "pageview") {
                return goal.runtimePath === currentPath || goal.pagePath === currentPath;
              }
              if (goal.type === "click" && type === "click") return goal.trackingId === trackingId;
              if (goal.type === "custom" && type === "custom") return goal.eventName === extra?.name;
              return false;
            }) || null;
          };
          let queue = [];
          let flushTimer = 0;
          let flushing = false;
          const clearAnalyticsIdentity = () => {
            queue = [];
            try {
              localStorage.removeItem(key + "visitor");
              localStorage.removeItem(key + "session");
            } catch (_) {}
            eraseCookie(visitorCookie);
            eraseCookie(sessionCookie);
          };
          addEventListener("kodety:consent-change", () => {
            if (!consentAllowsAnalytics()) clearAnalyticsIdentity();
          });
          addEventListener("kodety:analytics-consent", () => {
            if (!consentAllowsAnalytics()) clearAnalyticsIdentity();
          });
          const scheduleFlush = (delay = 1600) => {
            if (flushTimer) return;
            flushTimer = window.setTimeout(() => {
              flushTimer = 0;
              flush(false);
            }, delay);
          };
          const flush = preferBeacon => {
            if (!consentAllowsAnalytics()) {
              queue = [];
              return;
            }
            if (flushing || !queue.length) return;
            const events = queue.splice(0, 20);
            const body = JSON.stringify({ events });
            if (preferBeacon && navigator.sendBeacon) {
              const blob = new Blob([body], { type: "application/json" });
              if (navigator.sendBeacon(config.endpoint, blob)) {
                if (queue.length) scheduleFlush(0);
                return;
              }
            }
            flushing = true;
            fetch(config.endpoint, {
              method: "POST",
              credentials: "same-origin",
              keepalive: true,
              headers: { "Content-Type": "application/json" },
              body,
            }).catch(() => {
              queue = [...events, ...queue].slice(0, 60);
            }).finally(() => {
              flushing = false;
              if (queue.length) scheduleFlush(2500);
            });
          };
          const send = (type, trackingId = "", metadata = {}, extra = {}, urgent = false) => {
            if (!consentAllowsAnalytics()) return;
            persistSession();
            const assignment = assignmentFor(type, trackingId, extra);
            const eventId = randomId();
            const payload = {
              eventId, type, trackingId, metadata, visitorId, identitySource, sessionId: session.id,
              pagePath: location.pathname || "/", referrer: document.referrer || "",
              device, browser, operatingSystem, timezone,
              viewportWidth: Math.max(0, Math.round(window.innerWidth || 0)),
              viewportHeight: Math.max(0, Math.round(window.innerHeight || 0)),
              occurredAt: new Date().toISOString(),
              experimentId: assignment?.experimentId || 0,
              variantId: assignment?.variantId || "",
              ...extra,
            };
            window.dispatchEvent(new CustomEvent("kodety:analytics-event", { detail: payload }));
            queue.push(payload);
            if (urgent || queue.length >= 10) flush(false); else scheduleFlush();
          };
          const api = Object.freeze({
            track: (trackingId, metadata = {}) => send("custom", String(trackingId || ""), metadata, { name: String(trackingId || "") }),
            conversion: (trackingId, metadata = {}) => send("conversion", String(trackingId || ""), metadata, {}, true),
            event: (type, trackingId, metadata = {}) => send(String(type || "custom"), String(trackingId || ""), metadata),
            visitorId,
            sessionId: session.id,
            assignment: assignments[0] || null,
            assignments,
          });
          window.kodetyAnalytics = api;
          window.kodety = window.kodety || {};
          window.kodety.track = api.track;
          window.kodety.conversion = api.conversion;

          const safeToken = value => /^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(value || "");
          const selectorFor = element => {
            if (!(element instanceof Element)) return "";
            if (safeToken(element.id)) return `#${element.id}`;
            const tag = element.tagName.toLowerCase();
            const className = Array.from(element.classList).find(safeToken);
            if (className) return `${tag}.${className}`;
            const segments = [];
            let cursor = element;
            while (cursor && cursor !== document.body && segments.length < 5) {
              const cursorTag = cursor.tagName.toLowerCase();
              const siblings = cursor.parentElement
                ? Array.from(cursor.parentElement.children).filter(item => item.tagName === cursor.tagName)
                : [];
              const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(cursor) + 1})` : "";
              segments.unshift(`${cursorTag}${suffix}`);
              cursor = cursor.parentElement;
            }
            return segments.join(" > ").slice(0, 180);
          };
          const elementLabel = element => {
            if (!(element instanceof Element)) return "";
            const label = element.getAttribute("aria-label")
              || element.getAttribute("data-label")
              || element.getAttribute("title")
              || (element instanceof HTMLInputElement ? element.getAttribute("name") : "")
              || element.textContent
              || element.tagName.toLowerCase();
            return String(label).replace(/\s+/g, " ").trim().slice(0, 120);
          };
          const shortHash = value => {
            let hash = 2166136261;
            for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
            return (hash >>> 0).toString(36);
          };
          const trackedTarget = eventTarget => {
            const target = eventTarget instanceof Element ? eventTarget : null;
            if (!target) return null;
            for (const assignment of assignments) {
              const goal = assignment?.goal || {};
              if (goal.type !== "click" || !["id", "class"].includes(goal.targetType) || !goal.targetValue) continue;
              let cursor = target;
              while (cursor) {
                const matched = goal.targetType === "id"
                  ? cursor.id === goal.targetValue
                  : cursor.classList.contains(goal.targetValue);
                if (matched) return { element: cursor, trackingId: goal.trackingId || `${goal.targetType}:${goal.targetValue}` };
                cursor = cursor.parentElement;
              }
            }
            const legacyTracked = target.closest("[data-kodety-tracking-id]");
            const element = legacyTracked || target.closest("a,button,[role=button],input[type=submit],input[type=button]");
            if (!element) return null;
            const selector = selectorFor(element);
            const explicit = legacyTracked?.getAttribute("data-kodety-tracking-id") || "";
            return { element, trackingId: explicit || `auto:${shortHash(selector || element.tagName)}` };
          };
          const acquisition = () => {
            const query = new URLSearchParams(location.search);
            const metadata = {
              viewport_width: Math.max(0, Math.round(window.innerWidth || 0)),
              viewport_height: Math.max(0, Math.round(window.innerHeight || 0)),
              screen_width: Math.max(0, Math.round(screen.width || 0)),
              screen_height: Math.max(0, Math.round(screen.height || 0)),
              visitor_type: isNewVisitor ? "new" : "returning",
              language: String(navigator.language || "").slice(0, 32),
            };
            ["source", "medium", "campaign", "term", "content"].forEach(name => {
              const value = query.get(`utm_${name}`);
              if (value) metadata[`utm_${name}`] = value.slice(0, 160);
            });
            return metadata;
          };
          let trackedPath = "";
          const trackPage = () => {
            const currentPath = location.pathname || "/";
            if (currentPath === trackedPath) return;
            trackedPath = currentPath;
            send("pageview", "", acquisition());
            if (assignments.some(item => item?.sourceRequest === true && item?.exposure === true)) {
              send("exposure");
            }
          };
          const ready = () => {
            trackPage();
            measureScroll();
          };
          if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true }); else ready();
          document.addEventListener("click", event => {
            const tracked = trackedTarget(event.target);
            if (!tracked) return;
            const selector = selectorFor(tracked.element);
            const label = elementLabel(tracked.element);
            send("click", tracked.trackingId, {
              element_selector: selector,
              element_label: label,
              element_tag: tracked.element.tagName.toLowerCase(),
            }, { elementKey: selector, elementLabel: label });
          }, { capture: true, passive: true });
          document.addEventListener("submit", event => {
            const form = event.target instanceof HTMLFormElement ? event.target : null;
            if (!form) return;
            const selector = selectorFor(form);
            const trackingId = form.getAttribute("data-kodety-tracking-id") || `form:${shortHash(selector || form.action || "submit")}`;
            const label = elementLabel(form);
            send("submit", trackingId, {
              element_selector: selector,
              element_label: label,
              element_tag: "form",
            }, { elementKey: selector, elementLabel: label }, true);
          }, { capture: true });

          const scrollThresholds = [25, 50, 75, 90, 100];
          const sentScroll = new Set();
          let scrollFrame = 0;
          function measureScroll() {
            scrollFrame = 0;
            const root = document.documentElement;
            const total = Math.max(root.scrollHeight, document.body?.scrollHeight || 0);
            const viewport = Math.max(1, window.innerHeight || root.clientHeight || 1);
            const available = Math.max(1, total - viewport);
            const depth = total <= viewport
              ? 100
              : Math.max(0, Math.min(100, Math.round(((window.scrollY || root.scrollTop || 0) / available) * 100)));
            scrollThresholds.forEach(threshold => {
              if (depth < threshold || sentScroll.has(threshold)) return;
              sentScroll.add(threshold);
              send("scroll", "", { scroll_depth: threshold }, { scrollDepth: threshold });
            });
          }
          addEventListener("scroll", () => {
            if (!scrollFrame) scrollFrame = requestAnimationFrame(measureScroll);
          }, { passive: true });
          addEventListener("resize", () => {
            if (!scrollFrame) scrollFrame = requestAnimationFrame(measureScroll);
          }, { passive: true });

          let activeStarted = document.visibilityState === "visible" ? performance.now() : 0;
          let activeDuration = 0;
          const captureActiveDuration = () => {
            if (!activeStarted) return;
            activeDuration += Math.max(0, performance.now() - activeStarted);
            activeStarted = 0;
          };
          let ended = false;
          addEventListener("pagehide", () => {
            if (ended) return;
            ended = true;
            captureActiveDuration();
            measureScroll();
            send("custom", "engagement", {}, { durationMs: Math.max(0, Math.round(activeDuration)) }, true);
            flush(true);
          }, { once: true });

          let errorCount = 0;
          addEventListener("error", event => {
            if (errorCount >= 5) return;
            errorCount += 1;
            let source = "";
            try { source = event.filename ? new URL(event.filename, location.href).pathname : ""; } catch (_) {}
            send("js_error", "", {
              error_message: String(event.message || "JavaScript error").slice(0, 180),
              error_source: source.slice(0, 180),
              error_line: Number(event.lineno || 0),
            });
          });
          addEventListener("unhandledrejection", event => {
            if (errorCount >= 5) return;
            errorCount += 1;
            const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "Unhandled promise rejection");
            send("js_error", "", { error_message: reason.slice(0, 180) });
          });

          ["pushState", "replaceState"].forEach(method => {
            const original = history[method];
            if (typeof original !== "function") return;
            history[method] = function (...args) {
              const result = original.apply(this, args);
              queueMicrotask(trackPage);
              return result;
            };
          });
          addEventListener("popstate", () => queueMicrotask(trackPage));

          // Heartbeat: keep "live visitors" accurate for engaged readers who are
          // not clicking. Only pings while the tab is visible; never inflates
          // pageviews or event counts (the server treats "ping" as liveness).
          const HEARTBEAT_MS = 20000;
          let heartbeat = 0;
          const ping = () => { if (document.visibilityState === "visible") send("ping"); };
          const startHeartbeat = () => { if (!heartbeat) heartbeat = setInterval(ping, HEARTBEAT_MS); };
          const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = 0; } };
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              activeStarted = performance.now();
              ping();
              startHeartbeat();
            } else {
              captureActiveDuration();
              stopHeartbeat();
              flush(true);
            }
          });
          startHeartbeat();
        })();
        </script>
        <?php
    }

    /** Import analytics.experiments/funnels from the just-published native project metadata. */
    public function sync_published_configuration(): void {
        $uploads = wp_upload_dir();
        $workspace = trailingslashit((string) ($uploads['basedir'] ?? '')) . 'kodety/private/workspace';
        if (!is_dir($workspace)) return;
        $candidates = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($workspace, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && $file->getFilename() === 'project.json' && basename($file->getPath()) === '.incode') $candidates[] = $file->getPathname();
        }
        usort($candidates, static fn(string $left, string $right): int => substr_count($left, DIRECTORY_SEPARATOR) <=> substr_count($right, DIRECTORY_SEPARATOR));
        if (!$candidates) return;
        $metadata = json_decode((string) file_get_contents($candidates[0]), true);
        $cookie_consent = is_array($metadata) && is_array($metadata['cookieConsent'] ?? null)
            ? $metadata['cookieConsent']
            : null;
        update_option(
            self::project_option_name('kodety_cookie_consent_enabled'),
            is_array($cookie_consent) && !empty($cookie_consent['enabled']) ? '1' : '0',
            false
        );
        $analytics = is_array($metadata) && is_array($metadata['analytics'] ?? null) ? $metadata['analytics'] : [];
        // Absence is not the same thing as an explicitly empty configuration.
        // Older editors and partial workspace writers legitimately publish a
        // project.json without `analytics`. Treating that as `experiments: []`
        // used to pause every live test and atomically replace its clone tree
        // with an empty directory. Only an explicit array owns experiment
        // lifecycle; an explicit empty array still means "remove all".
        $has_experiments = array_key_exists('experiments', $analytics)
            && is_array($analytics['experiments']);
        $has_funnels = array_key_exists('funnels', $analytics)
            && is_array($analytics['funnels']);
        if (!$has_experiments && !$has_funnels) return;
        $experiments = $has_experiments ? $analytics['experiments'] : [];
        if ($has_experiments) {
            $experiments = $this->publish_experiment_projects(dirname($candidates[0]), $experiments);
        }
        global $wpdb;
        if ($wpdb->query('START TRANSACTION') === false) {
            if ($has_experiments) $this->rollback_runtime_swap();
            throw new RuntimeException('Não foi possível iniciar a sincronização do Analytics publicado.');
        }
        try {
            if ($has_experiments) {
                $this->sync_project_experiments($experiments, false);
            }
            if ($has_funnels) {
                $this->sync_project_funnels($analytics['funnels']);
            }
            // Validate friendly URLs against the complete pending DB + clone
            // state before committing. Duplicate/reserved/page collisions must
            // fail this recoverable publish instead of silently dropping a
            // variant or leaving a stale route option behind.
            if ($has_experiments) {
                $this->collect_public_variant_routes(true);
            }
            if ($wpdb->query('COMMIT') === false) {
                throw new RuntimeException('Não foi possível confirmar a sincronização do Analytics publicado.');
            }
            if ($has_experiments) {
                $this->finalize_runtime_swap();
                $this->purge_legacy_public_runtime_trees();
            }
        } catch (Throwable $error) {
            $wpdb->query('ROLLBACK');
            if ($has_experiments) $this->rollback_runtime_swap();
            throw $error;
        }
        if ($has_experiments) {
            // The first publish purge happens before this hook. Variant clones
            // and their database definitions only become authoritative here,
            // so purge again after the complete runtime/configuration pair is
            // available.
            $this->purge_published_analytics_cache();
            // Public variant URLs depend on both the final running status and
            // the validated clone paths that only exist now.
            $this->rebuild_public_variant_routes();
        }
    }

    /**
     * Copy isolated editor overlays to a non-manifest runtime namespace.
     * Text/private overrides come from the variant tree; copy-on-write binary
     * dependencies are materialized from the public workspace only here. The
     * normal page synchronizer never sees these files because
     * `.kodety-experiments` is absent from manifest.json.
     *
     * Source contract:
     * `.incode/experiments/<experiment>/<variant>/project/<sourcePagePath>`.
     *
     * @param array<int,mixed> $definitions
     * @return array<int,mixed>
     */
    private function publish_experiment_projects(string $incode_dir, array $definitions): array {
        $theme = wp_get_theme('kodety-generated');
        $theme_dir = $theme->exists() ? $theme->get_stylesheet_directory() : '';
        if ($theme_dir === '' || !is_dir($theme_dir . '/site')) return $definitions;
        $private_runtime_container = $this->private_runtime_scope_container(true);
        if ($private_runtime_container === '') {
            throw new RuntimeException('O armazenamento privado dos A/B Tests não está disponível.');
        }
        $token = bin2hex(random_bytes(6));
        $destination_runtime = $private_runtime_container . '/current';
        $staging_runtime = $private_runtime_container . '/.current-staging-' . $token;
        $staging_root = $staging_runtime . '/site/.kodety-experiments';
        if (!wp_mkdir_p($staging_root) && !is_dir($staging_root)) {
            throw new RuntimeException('Não foi possível preparar os clones de A/B Test.');
        }
        $source_root = realpath($incode_dir . '/experiments');
        $workspace_root = realpath(dirname($incode_dir));
        $theme_manifest = is_file($theme_dir . '/manifest.json')
            ? json_decode((string) file_get_contents($theme_dir . '/manifest.json'), true)
            : [];
        $main_html = is_array($theme_manifest) ? (string) ($theme_manifest[''] ?? '') : '';
        $web_root = $main_html === ''
            ? ''
            : trim(str_replace('\\', '/', dirname(trim(str_replace('\\', '/', $main_html), '/'))), './');
        try {
            foreach ($definitions as &$definition) {
                if (!is_array($definition)) continue;
                $experiment_key = $this->variant_key((string) ($definition['id'] ?? ''));
                if ($experiment_key === '') continue;
                if (!isset($definition['variants']) || !is_array($definition['variants'])) {
                    $definition['variants'] = [];
                }
                // Iterate the actual nested array. Iterating an expression by
                // reference mutates a temporary zval, so older builds copied the
                // clone but silently lost runtime_relative before the DB sync.
                foreach ($definition['variants'] as &$variant) {
                    if (!is_array($variant)) continue;
                    $is_control = ($variant['kind'] ?? '') === 'control'
                        || !empty($variant['isControl'])
                        || ($variant['id'] ?? '') === 'control';
                    if ($is_control) continue;
                    if (!isset($variant['metadata']) || !is_array($variant['metadata'])) $variant['metadata'] = [];
                    // Never carry a path from a prior release into the next
                    // database sync before the matching clone was validated.
                    unset($variant['metadata']['runtime_relative']);
                    $variant_key = $this->variant_key((string) ($variant['id'] ?? ''));
                    $project = $source_root && $variant_key !== ''
                        ? realpath($source_root . '/' . $experiment_key . '/' . $variant_key . '/project')
                        : false;
                    if (
                        !$project
                        || !$source_root
                        || !str_starts_with($project, trailingslashit($source_root))
                        || !is_dir($project)
                    ) {
                        $variant = $this->pause_unpublishable_variant($variant);
                        continue;
                    }
                    $runtime_dir = $staging_root . '/' . $experiment_key . '/' . $variant_key;
                    $this->copy_inherited_variant_files(
                        $workspace_root ?: '',
                        $runtime_dir,
                        is_array($variant['inheritedFilePaths'] ?? null)
                            ? $variant['inheritedFilePaths']
                            : []
                    );
                    $this->copy_runtime_tree($project, $runtime_dir);
                    if (!$this->runtime_tree_contains_source($project, $runtime_dir)) {
                        throw new RuntimeException('A preparação do A/B Test descartou ou alterou arquivos da variante.');
                    }
                    $this->rewrite_variant_coded_style_links($runtime_dir);
                    $this->rewrite_variant_css_root_urls($runtime_dir, $web_root);
                    $entry = ltrim(str_replace('\\', '/', (string) ($variant['sourcePagePath'] ?? '')), '/');
                    if ($entry === '') {
                        $authored_path = ltrim(str_replace('\\', '/', (string) ($variant['pagePath'] ?? '')), '/');
                        $prefix = 'experiments/' . $experiment_key . '/' . $variant_key . '/project/';
                        $incode_prefix = '.incode/' . $prefix;
                        if (str_starts_with($authored_path, $incode_prefix)) $entry = substr($authored_path, strlen($incode_prefix));
                        elseif (str_starts_with($authored_path, $prefix)) $entry = substr($authored_path, strlen($prefix));
                    }
                    if ($entry === '') $entry = ltrim(str_replace('\\', '/', (string) ($definition['pagePath'] ?? '')), '/');
                    if ($entry === '' || !is_file($runtime_dir . '/' . $entry)) {
                        $entry = is_file($runtime_dir . '/index.html') ? 'index.html' : $this->first_runtime_html($runtime_dir);
                    }
                    if ($entry === '') {
                        $variant = $this->pause_unpublishable_variant($variant);
                        continue;
                    }
                    $variant['metadata']['runtime_relative'] = '.kodety-experiments/' . $experiment_key . '/' . $variant_key . '/' . $entry;
                }
                unset($variant);
            }
            unset($definition);
            $this->sync_private_runtime_support_files($theme_dir, $staging_runtime);
            // Clone bytes and every manifest/config dependency advance as one
            // directory swap, so a failed DB sync can restore the prior runtime.
            $this->swap_runtime_tree($staging_runtime, $destination_runtime);
        } catch (Throwable $error) {
            $this->remove_runtime_tree($staging_runtime);
            throw $error;
        }
        return $definitions;
    }

    private function sync_private_runtime_support_files(string $theme_dir, string $runtime_root): void {
        foreach ([
            'manifest.json',
            'seo.json',
            'localization.json',
            'redirects.json',
            'membership-localization.php',
            'membership-content.php',
        ] as $name) {
            $source = $theme_dir . '/' . $name;
            $destination = $runtime_root . '/' . $name;
            if (!is_file($source) || is_link($source)) {
                if ($name === 'manifest.json') {
                    throw new RuntimeException('O manifest da publicação não está disponível para o runtime privado.');
                }
                if (is_file($destination) || is_link($destination)) @unlink($destination);
                continue;
            }
            $temporary = $destination . '.next-' . bin2hex(random_bytes(4));
            if (!copy($source, $temporary) || !rename($temporary, $destination)) {
                @unlink($temporary);
                throw new RuntimeException('Não foi possível sincronizar o runtime privado dos A/B Tests.');
            }
        }
        $membership_pages = $theme_dir . '/membership-pages';
        if (is_dir($membership_pages) && !is_link($membership_pages)) {
            $this->copy_runtime_tree($membership_pages, $runtime_root . '/membership-pages');
        }
    }

    /** @param array<string,mixed> $variant @return array<string,mixed> */
    private function pause_unpublishable_variant(array $variant): array {
        $variant['status'] = 'paused';
        $variant['enabled'] = false;
        if (!isset($variant['metadata']) || !is_array($variant['metadata'])) $variant['metadata'] = [];
        unset($variant['metadata']['runtime_relative']);
        $variant['metadata']['variant_status'] = 'paused';
        return $variant;
    }

    private function swap_runtime_tree(string $staging_root, string $destination_root): void {
        $backup_root = $destination_root . '-backup-' . bin2hex(random_bytes(6));
        if (file_exists($destination_root) && !is_dir($destination_root)) {
            throw new RuntimeException('O namespace de A/B Test publicado é inválido.');
        }
        $had_destination = is_dir($destination_root);
        if ($had_destination && !rename($destination_root, $backup_root)) {
            throw new RuntimeException('Não foi possível preservar os clones de A/B Test atuais.');
        }
        if (!rename($staging_root, $destination_root)) {
            if ($had_destination && is_dir($backup_root)) @rename($backup_root, $destination_root);
            throw new RuntimeException('Não foi possível ativar os novos clones de A/B Test.');
        }
        $this->pending_runtime_swap = [
            'destination' => $destination_root,
            'backup' => $backup_root,
            'hadDestination' => $had_destination,
        ];
    }

    private function finalize_runtime_swap(): void {
        if (!$this->pending_runtime_swap) return;
        $backup = $this->pending_runtime_swap['backup'];
        if (is_dir($backup)) $this->remove_runtime_tree($backup);
        $this->pending_runtime_swap = null;
    }

    private function rollback_runtime_swap(): void {
        if (!$this->pending_runtime_swap) return;
        $destination = $this->pending_runtime_swap['destination'];
        $backup = $this->pending_runtime_swap['backup'];
        $had_destination = $this->pending_runtime_swap['hadDestination'];
        if (is_dir($destination)) $this->remove_runtime_tree($destination);
        if ($had_destination && is_dir($backup)) @rename($backup, $destination);
        elseif (is_dir($backup)) $this->remove_runtime_tree($backup);
        $this->pending_runtime_swap = null;
    }

    private function copy_runtime_tree(string $source, string $destination): void {
        if (!wp_mkdir_p($destination) && !is_dir($destination)) {
            throw new RuntimeException('Não foi possível criar o diretório isolado da variante.');
        }
        foreach (new DirectoryIterator($source) as $item) {
            if ($item->isDot() || $item->isLink() || $item->getFilename() === '.incode') continue;
            $target = $destination . '/' . $item->getFilename();
            if ($item->isDir()) $this->copy_runtime_tree($item->getPathname(), $target);
            elseif ($item->isFile() && !copy($item->getPathname(), $target)) {
                throw new RuntimeException('Não foi possível copiar um arquivo da variante.');
            }
        }
    }

    /**
     * Materialize copy-on-write binaries only at the publish boundary. Drafts
     * and autosaves keep one copy in the project root; the isolated public A/B
     * runtime receives inherited bytes first and private overrides second.
     *
     * @param array<int,mixed> $paths
     */
    private function copy_inherited_variant_files(string $workspace_root, string $destination, array $paths): void {
        $root = $workspace_root !== '' ? realpath($workspace_root) : false;
        if (!$root || !is_dir($root)) return;
        $root_prefix = trailingslashit($root);
        foreach (array_slice($paths, 0, 10000) as $raw_path) {
            if (!is_string($raw_path)) continue;
            $path = ltrim(str_replace('\\', '/', trim($raw_path)), '/');
            if (
                $path === ''
                || str_contains($path, "\0")
                || preg_match('~(?:^|/)\.\.(?:/|$)~', $path)
                || str_starts_with($path, '.incode/')
            ) continue;
            $source = realpath($root_prefix . $path);
            // Membership may intentionally move a protected binary into
            // opaque private storage. In that case its authored public path no
            // longer exists and must not be recreated here.
            if (!$source || !str_starts_with($source, $root_prefix) || !is_file($source)) continue;
            $target = $destination . '/' . $path;
            $target_directory = dirname($target);
            if (!wp_mkdir_p($target_directory) && !is_dir($target_directory)) {
                throw new RuntimeException('Não foi possível preparar um asset herdado da variante.');
            }
            if (!copy($source, $target)) {
                throw new RuntimeException('Não foi possível copiar um asset herdado da variante.');
            }
        }
    }

    /** Every private override must survive overlay materialization byte-exact. */
    private function runtime_tree_contains_source(string $source, string $destination): bool {
        $source_root = realpath($source);
        $destination_root = realpath($destination);
        if (!$source_root || !$destination_root) return false;
        $source_length = strlen(trailingslashit($source_root));
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source_root, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (!$file->isFile() || $file->isLink()) continue;
            $relative = str_replace('\\', '/', substr($file->getPathname(), $source_length));
            if ($relative === '' || str_starts_with($relative, '.incode/')) continue;
            $target = realpath($destination_root . '/' . $relative);
            $source_hash = hash_file('sha256', $file->getPathname());
            $target_hash = $target ? hash_file('sha256', $target) : false;
            if (
                !$target
                || !str_starts_with($target, trailingslashit($destination_root))
                || !is_file($target)
                || !is_string($source_hash)
                || !is_string($target_hash)
                || !hash_equals($source_hash, $target_hash)
            ) return false;
        }
        return true;
    }

    /**
     * Fingerprint the exact public clone tree copied by copy_runtime_tree().
     * This check intentionally runs before root-relative CSS URLs are rewritten
     * for the isolated runtime namespace.
     */
    private function runtime_tree_digest(string $root): string {
        $root = rtrim($root, '/\\');
        $files = [];
        $walk = function (string $directory, string $prefix = '') use (&$walk, &$files): void {
            foreach (new DirectoryIterator($directory) as $item) {
                if ($item->isDot() || $item->isLink() || $item->getFilename() === '.incode') continue;
                $relative = $prefix === ''
                    ? $item->getFilename()
                    : $prefix . '/' . $item->getFilename();
                if ($item->isDir()) {
                    $walk($item->getPathname(), $relative);
                    continue;
                }
                if (!$item->isFile()) continue;
                $contents = file_get_contents($item->getPathname());
                if (!is_string($contents)) {
                    throw new RuntimeException('Não foi possível validar um arquivo isolado da variante.');
                }
                $files[] = $relative . "\0" . hash('sha256', $contents);
            }
        };
        $walk($root);
        sort($files, SORT_STRING);
        return hash('sha256', implode("\n", $files));
    }

    /**
     * Coded styles keep their project-root source in data-kodety-coded-style.
     * A cloned HTML document may retain an href calculated from the private
     * authoring namespace (for example ../../../../../../Arquivos/style.css),
     * which escapes the published clone and loads Control's stylesheet. Rebase
     * only links whose declared target resolves to a real file inside this
     * exact clone.
     */
    private function rewrite_variant_coded_style_links(string $runtime_root): void {
        $root = realpath($runtime_root);
        if (!$root || !is_dir($root)) return;
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (!$file->isFile() || !preg_match('/\.html?$/i', $file->getFilename())) continue;
            $contents = file_get_contents($file->getPathname());
            if ($contents === false) throw new RuntimeException('Não foi possível ler o HTML isolado da variante.');
            $html = (string) $contents;
            $html_directory = dirname($file->getPathname());
            $rewritten = preg_replace_callback(
                '~<link\b[^>]*\bdata-kodety-coded-style\s*=\s*(["\'])(.*?)\1[^>]*>~is',
                function (array $link_match) use ($root, $html_directory): string {
                    $tag = (string) $link_match[0];
                    $declared = html_entity_decode((string) $link_match[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
                    $declared_path = (string) preg_replace('/[?#].*$/s', '', $declared);
                    $declared_path = rawurldecode($declared_path);
                    if (
                        $declared_path === ''
                        || str_starts_with($declared_path, '/')
                        || str_contains($declared_path, '\\')
                        || str_contains($declared_path, "\0")
                        || preg_match('~(?:^|/)\.\.(?:/|$)~', $declared_path)
                        || !preg_match('/\.css$/i', $declared_path)
                    ) return $tag;
                    $target = realpath($root . '/' . ltrim($declared_path, '/'));
                    if (
                        !$target
                        || !str_starts_with($target, trailingslashit($root))
                        || !is_file($target)
                    ) return $tag;
                    if (!preg_match('~\bhref\s*=\s*(["\'])(.*?)\1~is', $tag, $href_match, PREG_OFFSET_CAPTURE)) return $tag;
                    $current_href = html_entity_decode((string) $href_match[2][0], ENT_QUOTES | ENT_HTML5, 'UTF-8');
                    $suffix = preg_match('/([?#].*)$/s', $current_href, $suffix_match)
                        ? (string) $suffix_match[1]
                        : '';
                    $relative = $this->relative_runtime_url($html_directory, $target);
                    if ($relative === '') return $tag;
                    $replacement = 'href=' . $href_match[1][0]
                        . htmlspecialchars($relative . $suffix, ENT_QUOTES | ENT_HTML5, 'UTF-8')
                        . $href_match[1][0];
                    return substr_replace(
                        $tag,
                        $replacement,
                        (int) $href_match[0][1],
                        strlen((string) $href_match[0][0])
                    );
                },
                $html,
                -1,
                $count
            );
            if ($rewritten === null) throw new RuntimeException('Não foi possível normalizar o stylesheet isolado da variante.');
            if ($count > 0 && $rewritten !== $html && file_put_contents($file->getPathname(), $rewritten, LOCK_EX) === false) {
                throw new RuntimeException('Não foi possível salvar o stylesheet isolado da variante.');
            }
        }
    }

    private function relative_runtime_url(string $from_directory, string $target): string {
        $from = array_values(array_filter(explode('/', trim(str_replace('\\', '/', $from_directory), '/')), 'strlen'));
        $to = array_values(array_filter(explode('/', trim(str_replace('\\', '/', $target), '/')), 'strlen'));
        while ($from && $to && hash_equals((string) $from[0], (string) $to[0])) {
            array_shift($from);
            array_shift($to);
        }
        $segments = array_merge(array_fill(0, count($from), '..'), $to);
        if (!$segments) return '';
        $encoded = implode('/', array_map(static function (string $segment): string {
            return $segment === '..' ? '..' : rawurlencode($segment);
        }, $segments));
        return str_starts_with($encoded, '..') ? $encoded : './' . $encoded;
    }

    /** Mirrors Kodety_Plugin::rewrite_css_root_urls() inside a variant clone.
     * The clone reproduces the project's web root folder, so `url(/x)` must
     * walk back to that folder, not to the clone's own root. */
    private function rewrite_variant_css_root_urls(string $runtime_root, string $web_root = ''): void {
        $root = rtrim(str_replace('\\', '/', $runtime_root), '/');
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($runtime_root, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (!$file->isFile() || strtolower($file->getExtension()) !== 'css') continue;
            $relative = ltrim(str_replace('\\', '/', substr($file->getPathname(), strlen($root))), '/');
            $directory = trim(str_replace('\\', '/', dirname($relative)), './');
            $from = $directory === '' ? [] : explode('/', $directory);
            $to = $web_root === '' ? [] : explode('/', $web_root);
            while ($from && $to && $from[0] === $to[0]) { array_shift($from); array_shift($to); }
            $prefix = str_repeat('../', count($from)) . ($to ? implode('/', $to) . '/' : '');
            if ($prefix === '') $prefix = './';
            $contents = file_get_contents($file->getPathname());
            if ($contents === false) throw new RuntimeException('Não foi possível ler o CSS isolado da variante.');
            $css = (string) $contents;
            $rewritten = preg_replace_callback(
                '/url\(\s*([\'"]?)\/(?!\/)([^)\'"]+)\1\s*\)/i',
                static fn(array $match): string => 'url(' . $match[1] . $prefix . ltrim(trim($match[2]), '/') . $match[1] . ')',
                $css
            );
            if ($rewritten === null) throw new RuntimeException('Não foi possível normalizar o CSS isolado da variante.');
            if ($rewritten !== $css && file_put_contents($file->getPathname(), $rewritten, LOCK_EX) === false) {
                throw new RuntimeException('Não foi possível salvar o CSS isolado da variante.');
            }
        }
    }

    private function remove_runtime_tree(string $directory): void {
        if (is_link($directory)) {
            @unlink($directory);
            return;
        }
        if (!is_dir($directory)) return;
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iterator as $item) {
            if ($item->isLink() || $item->isFile()) @unlink($item->getPathname());
            elseif ($item->isDir()) @rmdir($item->getPathname());
        }
        @rmdir($directory);
    }

    private function first_runtime_html(string $directory): string {
        $root_length = strlen(trailingslashit($directory));
        $files = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && preg_match('/\.html?$/i', $file->getFilename())) {
                $files[] = str_replace('\\', '/', substr($file->getPathname(), $root_length));
            }
        }
        sort($files, SORT_STRING);
        return (string) ($files[0] ?? '');
    }

    /** @param array<int,mixed> $definitions */
    private function sync_project_experiments(array $definitions, bool $manage_transaction = true): void {
        global $wpdb;
        $seen = [];
        if ($manage_transaction && $wpdb->query('START TRANSACTION') === false) {
            throw new RuntimeException('Não foi possível iniciar a sincronização dos A/B Tests.');
        }
        try {
        foreach ($definitions as $definition) {
            if (!is_array($definition)) continue;
            $input = $this->sanitize_experiment_input($definition);
            if (is_wp_error($input) || $input['external_id'] === '') continue;
            $scoped_external_id = $this->scoped_external_id($input['external_id']);
            $seen[] = $scoped_external_id;
            $existing = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$this->table('experiments')}
                 WHERE external_id=%s AND config_json LIKE %s",
                $scoped_external_id,
                $this->project_json_marker()
            ), ARRAY_A);
            $status = $this->experiment_status_to_database($definition['status'] ?? 'draft');
            if (!in_array($status, self::EXPERIMENT_STATUSES, true)) $status = 'draft';
            $status = $this->effective_experiment_status($status);
            $authored_page_path = (string) ($definition['pagePath'] ?? $input['page_path']);
            $page_id = $input['source_page_id'] ?: $this->page_id_for_path($authored_page_path);
            $public_page_path = $this->public_path_for_project_path($authored_page_path);
            $record = [
                'external_id' => $scoped_external_id,
                'name' => $input['name'],
                'source_page_id' => $page_id,
                'page_path' => $public_page_path,
                'page_hash' => hash('sha256', $public_page_path),
                'goal_type' => $input['goal_type'],
                'goal_tracking_id' => $input['goal_tracking_id'],
                'status' => $status,
                'traffic_percent' => $input['traffic_percent'],
                'config_json' => $input['config_json'],
                'managed_source' => 'project',
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ];
            if ($status === 'running' && (!$existing || empty($existing['started_at']))) {
                $record['started_at'] = gmdate('Y-m-d H:i:s');
            }
            if ($status === 'completed') $record['ended_at'] = gmdate('Y-m-d H:i:s');
            if ($existing) {
                $id = (int) $existing['id'];
                if ($wpdb->update($this->table('experiments'), $record, ['id' => $id]) === false) {
                    throw new RuntimeException('Não foi possível atualizar um A/B Test publicado.');
                }
            } else {
                $record['assignment_salt'] = bin2hex(random_bytes(24));
                $record['created_by'] = get_current_user_id();
                $record['created_at'] = gmdate('Y-m-d H:i:s');
                if (!$wpdb->insert($this->table('experiments'), $record)) {
                    throw new RuntimeException('Não foi possível criar um A/B Test publicado.');
                }
                $id = (int) $wpdb->insert_id;
            }
            if ($id <= 0) throw new RuntimeException('O A/B Test publicado ficou sem identificador.');
            $variant_keys = [];
            foreach (($definition['variants'] ?? []) as $variant) {
                if (!is_array($variant)) continue;
                if (empty($variant['pageId'])) {
                    $source_path = (string) ($variant['sourcePagePath'] ?? $definition['pagePath'] ?? '');
                    if ($source_path !== '') $variant['pageId'] = $this->page_id_for_path($this->sanitize_page_path($source_path));
                }
                $clean = $this->sanitize_variant($variant);
                if (is_wp_error($clean)) continue;
                $variant_keys[] = $clean['variant_key'];
                $variant_existing = $wpdb->get_row($wpdb->prepare(
                    "SELECT * FROM {$this->table('variants')} WHERE experiment_id=%d AND variant_key=%s",
                    $id,
                    $clean['variant_key']
                ), ARRAY_A);
                if ($variant_existing) {
                    if ($clean['is_control']) {
                        $reset = $wpdb->query($wpdb->prepare(
                            "UPDATE {$this->table('variants')} SET is_control=0 WHERE experiment_id=%d AND id<>%d",
                            $id,
                            (int) $variant_existing['id']
                        ));
                        if ($reset === false) {
                            throw new RuntimeException('Não foi possível sincronizar a variante de controle.');
                        }
                    }
                    if ($wpdb->update($this->table('variants'), [
                        'name' => $clean['name'], 'document_key' => $clean['document_key'], 'page_id' => $clean['page_id'],
                        'page_path' => $clean['page_path'], 'weight' => $clean['weight'], 'enabled' => $clean['enabled'],
                        'is_control' => $clean['is_control'], 'metadata' => wp_json_encode($clean['metadata']),
                        'updated_at' => gmdate('Y-m-d H:i:s'),
                    ], ['id' => (int) $variant_existing['id']]) === false) {
                        throw new RuntimeException('Não foi possível atualizar uma variante publicada.');
                    }
                } else {
                    $inserted = $this->insert_variant($id, $variant, false, false);
                    if (is_wp_error($inserted)) {
                        throw new RuntimeException('Não foi possível criar uma variante publicada.');
                    }
                }
            }
            if ($variant_keys) {
                $placeholders = implode(',', array_fill(0, count($variant_keys), '%s'));
                $disabled = $wpdb->query($wpdb->prepare(
                    "UPDATE {$this->table('variants')} SET enabled=0 WHERE experiment_id=%d AND variant_key NOT IN ({$placeholders})",
                    $id,
                    ...$variant_keys
                ));
            } else {
                $disabled = $wpdb->query($wpdb->prepare(
                    "UPDATE {$this->table('variants')} SET enabled=0 WHERE experiment_id=%d",
                    $id
                ));
            }
            if ($disabled === false) throw new RuntimeException('Não foi possível desativar variantes removidas.');
            if ($status === 'running') {
                $valid_variants = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM {$this->table('variants')} WHERE experiment_id=%d AND enabled=1 AND weight>0",
                    $id
                ));
                $control_count = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM {$this->table('variants')} WHERE experiment_id=%d AND enabled=1 AND is_control=1",
                    $id
                ));
                $conflict = (int) $wpdb->get_var($wpdb->prepare(
                    "SELECT id FROM {$this->table('experiments')} WHERE id<>%d AND status='running' AND page_hash=%s LIMIT 1",
                    $id,
                    hash('sha256', $public_page_path)
                ));
                if ($valid_variants < 2 || $control_count !== 1 || $conflict > 0) {
                    if ($wpdb->update($this->table('experiments'), [
                        'status' => 'paused',
                        'updated_at' => gmdate('Y-m-d H:i:s'),
                    ], ['id' => $id]) === false) {
                        throw new RuntimeException('Não foi possível pausar um A/B Test inválido.');
                    }
                }
            }
        }
        if ($seen) {
            $placeholders = implode(',', array_fill(0, count($seen), '%s'));
            $paused = $wpdb->query($wpdb->prepare(
                "UPDATE {$this->table('experiments')} SET status='paused'
                 WHERE managed_source='project' AND config_json LIKE %s
                 AND external_id NOT IN ({$placeholders})",
                $this->project_json_marker(),
                ...$seen
            ));
        } else {
            $paused = $wpdb->query($wpdb->prepare(
                "UPDATE {$this->table('experiments')} SET status='paused'
                 WHERE managed_source='project' AND status='running' AND config_json LIKE %s",
                $this->project_json_marker()
            ));
        }
        if ($paused === false) throw new RuntimeException('Não foi possível pausar A/B Tests removidos.');
        if ($manage_transaction && $wpdb->query('COMMIT') === false) {
            throw new RuntimeException('Não foi possível confirmar a sincronização dos A/B Tests.');
        }
        } catch (Throwable $error) {
            if ($manage_transaction) $wpdb->query('ROLLBACK');
            throw $error;
        }
    }

    /** @param array<int,mixed> $definitions */
    private function sync_project_funnels(array $definitions): void {
        // Project funnels use their stable metadata ID as a marker in filters;
        // dashboard-created funnels remain untouched.
        global $wpdb;
        foreach ($definitions as $definition) {
            if (!is_array($definition)) continue;
            $external = $this->variant_key((string) ($definition['id'] ?? ''));
            if ($external === '') continue;
            $like = '%"projectId":"' . $wpdb->esc_like($external) . '"%';
            $existing = $wpdb->get_row($wpdb->prepare(
                "SELECT id,steps_json FROM {$this->table('funnels')}
                 WHERE filters_json LIKE %s AND filters_json LIKE %s LIMIT 1",
                $like,
                $this->project_json_marker()
            ), ARRAY_A);
            $id = is_array($existing) ? (int) ($existing['id'] ?? 0) : 0;
            $existing_steps = is_array($existing)
                ? json_decode((string) ($existing['steps_json'] ?? ''), true)
                : [];
            $input = $this->sanitize_funnel_input(
                $definition,
                is_array($existing_steps) ? $existing_steps : []
            );
            if (is_wp_error($input)) continue;
            $input['status'] = $this->effective_funnel_status((string) $input['status']);
            $record = [
                'name' => $input['name'],
                'status' => $input['status'],
                'steps_json' => wp_json_encode($input['steps']),
                'filters_json' => wp_json_encode($this->funnel_filters_payload($input, [
                    'projectId' => $external,
                    'projectKey' => self::project_scope_key(),
                ])),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ];
            if ($id) {
                if ($wpdb->update($this->table('funnels'), $record, ['id' => $id]) === false) {
                    throw new RuntimeException('Não foi possível atualizar um funil publicado.');
                }
            }
            else {
                $record['created_by'] = get_current_user_id();
                $record['created_at'] = gmdate('Y-m-d H:i:s');
                if (!$wpdb->insert($this->table('funnels'), $record)) {
                    throw new RuntimeException('Não foi possível criar um funil publicado.');
                }
            }
        }
    }

    /**
     * Rebind project-managed experiments after WordPress has synchronized the
     * native pages for the release. On a first publish those pages do not exist
     * yet when the transactional analytics hook runs, so source_page_id would
     * otherwise remain zero and every friendly variant URL would resolve to a
     * WordPress 404 until a later publish.
     */
    public function reconcile_published_experiments(mixed $release = null): void {
        if (!$this->pro_feature_enabled('experiments')) {
            $this->rebuild_public_variant_routes();
            return;
        }
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id,source_page_id,page_path
             FROM {$this->table('experiments')}
             WHERE managed_source='project' AND config_json LIKE %s",
            $this->project_json_marker()
        ),
            ARRAY_A
        );
        foreach ((array) $rows as $row) {
            $page_id = $this->page_id_for_path((string) ($row['page_path'] ?? '/'));
            if ($page_id <= 0) continue;
            $permalink = get_permalink($page_id);
            $permalink_path = is_string($permalink)
                ? (string) wp_parse_url($permalink, PHP_URL_PATH)
                : '';
            $page_path = $permalink_path !== ''
                ? $this->sanitize_page_path($permalink_path)
                : $this->public_path_for_project_path((string) ($row['page_path'] ?? '/'));
            if (
                $page_id === (int) ($row['source_page_id'] ?? 0)
                && hash_equals($page_path, (string) ($row['page_path'] ?? ''))
            ) continue;
            $wpdb->update($this->table('experiments'), [
                'source_page_id' => $page_id,
                'page_path' => $page_path,
                'page_hash' => hash('sha256', $page_path),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ], ['id' => (int) $row['id']]);
        }
        $this->rebuild_public_variant_routes();
    }

    private function page_id_for_path(string $path): int {
        global $wpdb;
        $html_path = ltrim(str_replace('\\', '/', $path), '/');
        $route = preg_replace('/\/index\.html?$/i', '', $html_path);
        $route = preg_replace('/\.html?$/i', '', (string) $route);
        if (preg_match('/^index\.html?$/i', $html_path)) $route = '';
        $route = trim((string) $route, '/');
        $front_page_id = (int) get_option('page_on_front', 0);
        $id = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT meta.post_id
             FROM {$wpdb->postmeta} meta
             INNER JOIN {$wpdb->posts} posts ON posts.ID=meta.post_id
             WHERE meta.meta_key='_kodety_route' AND meta.meta_value=%s
             AND posts.post_type='page' AND posts.post_status='publish'
             ORDER BY (meta.post_id=%d) DESC,meta.post_id ASC LIMIT 1",
            $route,
            $front_page_id
        ));
        if ($id <= 0) {
            $id = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT meta.post_id
                 FROM {$wpdb->postmeta} meta
                 INNER JOIN {$wpdb->posts} posts ON posts.ID=meta.post_id
                 WHERE meta.meta_key='_kodety_html_path' AND meta.meta_value=%s
                 AND posts.post_type='page' AND posts.post_status='publish'
                 ORDER BY (meta.post_id=%d) DESC,meta.post_id ASC LIMIT 1",
                $html_path,
                $front_page_id
            ));
        }
        return $id;
    }

    private function public_path_for_project_path(string $project_path): string {
        $project_path = str_replace('\\', '/', trim($project_path));
        if (str_starts_with($project_path, '/') && !preg_match('/\.html?$/i', $project_path)) {
            return $this->sanitize_page_path($project_path);
        }
        $page_id = $this->page_id_for_path($project_path);
        if ($page_id > 0) {
            $permalink = get_permalink($page_id);
            $path = is_string($permalink) ? (string) wp_parse_url($permalink, PHP_URL_PATH) : '';
            if ($path !== '') return $this->sanitize_page_path($path);
        }
        $route = ltrim($project_path, '/');
        $route = (string) preg_replace('/(?:^|\\/)index\\.html?$/i', '', $route);
        $route = (string) preg_replace('/\\.html?$/i', '', $route);
        return $this->sanitize_page_path('/' . trim($route, '/'));
    }

    public function cleanup(): void {
        global $wpdb;
        $this->aggregate_daily();
        $retention = max(7, min(
            self::MAX_RETENTION_DAYS,
            absint(self::project_option('kodety_analytics_retention_days', self::DEFAULT_RETENTION_DAYS))
        ));
        $cutoff = gmdate('Y-m-d H:i:s', time() - $retention * DAY_IN_SECONDS);
        $event_scope = $this->project_sql_condition();
        $session_scope = $this->project_sql_condition();
        $daily_scope = $this->project_sql_condition();
        // Bounded batches keep cleanup safe on shared hosts with large sites.
        do {
            $deleted = $wpdb->query($wpdb->prepare(
                "DELETE FROM {$this->table('events')} WHERE {$event_scope} AND occurred_at < %s LIMIT 10000",
                $cutoff
            ));
        } while ((int) $deleted === 10000);
        do {
            $deleted = $wpdb->query($wpdb->prepare(
                "DELETE FROM {$this->table('sessions')} WHERE {$session_scope} AND last_seen < %s LIMIT 5000",
                $cutoff
            ));
        } while ((int) $deleted === 5000);
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$this->table('daily')} WHERE {$daily_scope} AND stat_date < %s",
            gmdate('Y-m-d', strtotime($cutoff))
        ));
    }

    /**
     * Materialize the previous UTC day into a compact table. Raw events remain
     * authoritative and power live/today reports; the daily table is the
     * durable fast path for longer historical charts and exports.
     */
    public function aggregate_daily(?string $date = null): void {
        global $wpdb;
        $day = $date !== null ? trim($date) : gmdate('Y-m-d', time() - DAY_IN_SECONDS);
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $day, new DateTimeZone('UTC'));
        $errors = DateTimeImmutable::getLastErrors();
        if (
            !$parsed instanceof DateTimeImmutable
            || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
        ) return;
        $start = $parsed->format('Y-m-d 00:00:00');
        $end = $parsed->format('Y-m-d 23:59:59');
        $daily = $this->table('daily');
        $events = $this->table('events');
        $sessions = $this->table('sessions');
        $scope = self::project_scope_key();
        $daily_scope = $this->project_sql_condition();
        $event_scope = $this->project_sql_condition('events');
        $session_scope = $this->project_sql_condition('session');
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$daily} WHERE {$daily_scope} AND stat_date=%s",
            $day
        ));
        $wpdb->query($wpdb->prepare(
            "INSERT INTO {$daily}
             (project_key,stat_date,page_path,page_hash,country_code,device_type,sessions,unique_visitors,pageviews,conversions,bounce_sessions,engagement_seconds,updated_at)
             SELECT %s,%s,events.page_path,events.page_hash,events.country_code,events.device_type,
                    COUNT(DISTINCT events.session_id),
                    COUNT(DISTINCT events.visitor_id),
                    SUM(events.event_type='pageview'),
                    SUM(events.event_type='conversion'),
                    COUNT(DISTINCT IF(session.pageviews<=1,events.session_id,NULL)),
                    FLOOR(SUM(events.duration_ms)/1000),
                    %s
             FROM {$events} events
             LEFT JOIN {$sessions} session ON session.session_id=events.session_id AND {$session_scope}
             WHERE {$event_scope} AND events.occurred_at BETWEEN %s AND %s
             GROUP BY events.page_hash,events.page_path,events.country_code,events.device_type",
            $scope,
            $day,
            gmdate('Y-m-d H:i:s'),
            $start,
            $end
        ));
    }

    private function purge_published_analytics_cache(): void {
        if (function_exists('wp_cache_flush')) wp_cache_flush();
        if (function_exists('wp_cache_clear_cache')) wp_cache_clear_cache();
        if (function_exists('w3tc_flush_all')) w3tc_flush_all();
        if (function_exists('rocket_clean_domain')) rocket_clean_domain();
        if (function_exists('sg_cachepress_purge_cache')) sg_cachepress_purge_cache();
        if (class_exists('LiteSpeed_Cache_API') && method_exists('LiteSpeed_Cache_API', 'purge_all')) {
            LiteSpeed_Cache_API::purge_all();
        }
        do_action('litespeed_purge_all');
        do_action('kodety_purge_published_cache');
    }

    private function private_response(mixed $data, int $status = 200): WP_REST_Response {
        $response = new WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'private, no-store, no-cache, max-age=0');
        return $response;
    }

    private function opaque_id(string $value): string {
        $value = strtolower(trim($value));
        return preg_match('/^[a-z0-9][a-z0-9._:-]{15,63}$/', $value) ? $value : '';
    }

    private function variant_key(string $value): string {
        $value = strtolower(trim($value));
        $value = (string) preg_replace('/[^a-z0-9._-]+/', '-', $value);
        return substr(trim($value, '-'), 0, 64);
    }

    /**
     * Normalize a user-facing variant slug into a URL-safe, optionally nested
     * path (e.g. `case/hero-b`). Mirrors the editor's `safeVariantSlug` so the
     * value a visitor requests matches what the editor stored. Never returns a
     * leading/trailing slash; empty segments are dropped.
     */
    private function public_variant_slug(string $value): string {
        $segments = array_filter(array_map(function (string $segment): string {
            $segment = strtolower(trim($segment));
            $segment = (string) preg_replace('/[^a-z0-9._-]+/', '-', $segment);
            return trim($segment, '-');
        }, explode('/', trim($value))), static fn(string $segment): bool => $segment !== '');
        return substr(implode('/', $segments), 0, 120);
    }

    private function tracking_id(string $value): string {
        $value = trim(sanitize_text_field($value));
        $value = (string) preg_replace('/[^A-Za-z0-9._:\/-]+/', '-', $value);
        return substr(trim($value, '-'), 0, 191);
    }

    /**
     * Store DOM click targets in the existing goal_tracking_id column using a
     * backwards-compatible canonical key. Legacy raw tracking IDs are returned
     * unchanged and continue matching data-kodety-tracking-id.
     */
    private function canonical_click_goal(string $target_type, string $target_value, string $legacy = ''): string {
        $target_type = sanitize_key($target_type);
        if (in_array($target_type, ['id', 'class'], true)) {
            $target_value = $this->tracking_id($target_value);
            if ($target_value !== '') return $target_type . ':' . $target_value;
        }
        $legacy = $this->tracking_id($legacy);
        $target = $this->click_goal_target($legacy);
        return $target
            ? $target['targetType'] . ':' . $target['targetValue']
            : $legacy;
    }

    /** @return array{targetType:string,targetValue:string}|null */
    private function click_goal_target(string $tracking_id): ?array {
        $tracking_id = $this->tracking_id($tracking_id);
        if (!preg_match('/^(id|class):(.+)$/i', $tracking_id, $matches)) return null;
        $value = $this->tracking_id((string) $matches[2]);
        if ($value === '') return null;
        return [
            'targetType' => strtolower((string) $matches[1]),
            'targetValue' => $value,
        ];
    }

    private function sanitize_page_path(string $value): string {
        $path = (string) wp_parse_url($value, PHP_URL_PATH);
        if ($path === '') $path = '/';
        $path = '/' . ltrim(rawurldecode($path), '/');
        $path = (string) preg_replace('~/+~', '/', $path);
        if ($path !== '/') $path = rtrim($path, '/');
        return substr(sanitize_text_field($path), 0, 1024);
    }

    private function sanitize_occurred_at(string $value): string {
        $timestamp = strtotime($value);
        if (!$timestamp || $timestamp < time() - DAY_IN_SECONDS || $timestamp > time() + 5 * MINUTE_IN_SECONDS) $timestamp = time();
        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    private function source_host(string $value): string {
        $host = strtolower((string) wp_parse_url($value, PHP_URL_HOST));
        $home = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
        // Normalize a leading www. so google.com and www.google.com collapse into
        // one source and internal referrers are recognized as direct traffic.
        $host = (string) preg_replace('/^www\./', '', $host);
        $home = (string) preg_replace('/^www\./', '', $home);
        if ($host === '' || ($home !== '' && hash_equals($home, $host))) return '';
        return substr(sanitize_text_field($host), 0, 191);
    }

    /**
     * Best-effort bot/crawler detection so automated traffic never inflates
     * visitor, source or device analytics. Deliberately conservative: it only
     * matches unambiguous crawler/monitor signatures.
     */
    private function is_bot_request(WP_REST_Request $request): bool {
        $ua = strtolower((string) $request->get_header('User-Agent'));
        if ($ua === '') return true;
        return (bool) preg_match(
            '/(bot|crawl|spider|slurp|mediapartners|adsbot|bingpreview|facebookexternalhit|embedly|quora link|pingdom|uptimerobot|monitis|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|gtmetrix|python-requests|curl|wget|axios|go-http|okhttp|java\/|libwww)/',
            $ua
        );
    }

    private function country_code(WP_REST_Request $request): string {
        foreach (['CF-IPCountry', 'CloudFront-Viewer-Country', 'X-Vercel-IP-Country'] as $header) {
            $value = strtoupper(trim($request->get_header($header)));
            if (preg_match('/^[A-Z]{2}$/', $value) && $value !== 'XX') return $value;
        }
        return '';
    }

    /**
     * Expose the same request-scoped geography used by Analytics to other
     * first-party runtimes. Localization must see GeoLite/host integrations
     * attached to `kodety_analytics_geo_context` instead of maintaining a
     * second, disconnected country source.
     *
     * @return array{country:string,region:string,city:string,timezone:string}
     */
    public static function current_request_geo_context(): array {
        $empty = ['country' => '', 'region' => '', 'city' => '', 'timezone' => ''];
        if (!class_exists('WP_REST_Request')) return $empty;

        $request = new WP_REST_Request('GET', '/');
        if (method_exists($request, 'set_header')) {
            foreach ($_SERVER as $server_key => $value) {
                if (!is_string($server_key) || !str_starts_with($server_key, 'HTTP_') || !is_scalar($value)) continue;
                $header = str_replace('_', '-', substr($server_key, 5));
                if ($header !== '' && trim((string) $value) !== '') $request->set_header($header, (string) $value);
            }
        }
        return self::instance()->geo_context($request, []);
    }

    /**
     * Resolve coarse geography without sending an IP to a third party. Hosts
     * may provide trusted edge headers, while a local GeoLite reader can attach
     * through `kodety_analytics_geo_context`. The filter receives the raw IP for
     * the duration of this request only; it is never persisted.
     *
     * @param array<string,mixed> $raw
     * @return array{country:string,region:string,city:string,timezone:string}
     */
    private function geo_context(WP_REST_Request $request, array $raw): array {
        $header_value = static function (WP_REST_Request $request, array $headers): string {
            foreach ($headers as $header) {
                $value = trim((string) $request->get_header($header));
                if ($value !== '') return $value;
            }
            return '';
        };
        $context = [
            'country' => $this->country_code($request),
            'region' => sanitize_text_field(substr($header_value($request, [
                'CF-Region',
                'CloudFront-Viewer-Country-Region-Name',
                'CloudFront-Viewer-Country-Region',
                'X-Vercel-IP-Country-Region',
            ]), 0, 128)),
            'city' => sanitize_text_field(substr($header_value($request, [
                'CF-IPCity',
                'CloudFront-Viewer-City',
                'X-Vercel-IP-City',
            ]), 0, 128)),
            'timezone' => sanitize_text_field(substr((string) (
                $raw['timezone']
                ?? $header_value($request, ['CloudFront-Viewer-Time-Zone', 'X-Vercel-IP-Timezone'])
            ), 0, 64)),
        ];
        if (function_exists('apply_filters')) {
            $filtered = apply_filters(
                'kodety_analytics_geo_context',
                $context,
                $request,
                (string) ($_SERVER['REMOTE_ADDR'] ?? '')
            );
            if (is_array($filtered)) {
                $country = strtoupper(trim((string) ($filtered['country'] ?? $context['country'])));
                $context = [
                    'country' => preg_match('/^[A-Z]{2}$/', $country) && $country !== 'XX' ? $country : '',
                    'region' => sanitize_text_field(substr((string) ($filtered['region'] ?? ''), 0, 128)),
                    'city' => sanitize_text_field(substr((string) ($filtered['city'] ?? ''), 0, 128)),
                    'timezone' => sanitize_text_field(substr((string) ($filtered['timezone'] ?? ''), 0, 64)),
                ];
            }
        }
        return $context;
    }

    private function device_type(string $declared, string $user_agent): string {
        $declared = sanitize_key($declared);
        if (in_array($declared, ['desktop', 'mobile', 'tablet'], true)) return $declared;
        if (preg_match('/ipad|tablet/i', $user_agent)) return 'tablet';
        if (preg_match('/mobile|android|iphone|ipod/i', $user_agent)) return 'mobile';
        return 'desktop';
    }

    private function browser_name(string $declared, WP_REST_Request $request): string {
        $declared = sanitize_text_field(substr(trim($declared), 0, 64));
        if ($declared !== '') return $declared;
        $hints = (string) $request->get_header('Sec-CH-UA');
        if (stripos($hints, 'Microsoft Edge') !== false || stripos($hints, 'Edge') !== false) return 'Edge';
        if (stripos($hints, 'Google Chrome') !== false) return 'Chrome';
        if (stripos($hints, 'Chromium') !== false) return 'Chromium';
        $ua = (string) $request->get_header('User-Agent');
        if (preg_match('/Edg\//i', $ua)) return 'Edge';
        if (preg_match('/OPR\//i', $ua)) return 'Opera';
        if (preg_match('/Firefox\//i', $ua)) return 'Firefox';
        if (preg_match('/CriOS\//i', $ua)) return 'Chrome';
        if (preg_match('/Chrome\//i', $ua)) return 'Chrome';
        if (preg_match('/Safari\//i', $ua)) return 'Safari';
        return 'Outro';
    }

    private function operating_system(string $declared, WP_REST_Request $request): string {
        $declared = sanitize_text_field(substr(trim($declared), 0, 64));
        if ($declared !== '') return $declared;
        $platform = trim((string) $request->get_header('Sec-CH-UA-Platform'), " \t\n\r\0\x0B\"");
        if ($platform !== '') return sanitize_text_field(substr($platform, 0, 64));
        $ua = (string) $request->get_header('User-Agent');
        if (preg_match('/Windows NT/i', $ua)) return 'Windows';
        if (preg_match('/Android/i', $ua)) return 'Android';
        if (preg_match('/iPhone|iPad|iPod/i', $ua)) return 'iOS';
        if (preg_match('/Mac OS X|Macintosh/i', $ua)) return 'macOS';
        if (preg_match('/Linux/i', $ua)) return 'Linux';
        return 'Outro';
    }

    private function element_selector(string $value): string {
        $value = trim($value);
        // The tracker only emits selectors composed from tag, id/class tokens
        // and :nth-of-type(). Reject quotes/brackets so the dashboard can safely
        // pass the stored selector to querySelector inside the preview.
        $value = (string) preg_replace('/[^A-Za-z0-9_#.:>+~*()=\\-\\s]/', '', $value);
        return substr(preg_replace('/\s+/', ' ', $value) ?: '', 0, 191);
    }

    private function request_fingerprint(): string {
        $ip = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
        $ua = substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 256);
        return hash_hmac('sha256', gmdate('Y-m-d') . '|' . $ip . '|' . $ua, wp_salt('nonce'));
    }

    /** @return array<string,mixed> */
    private function sanitize_metadata(mixed $metadata): array {
        if (!is_array($metadata)) return [];
        $clean = [];
        foreach (array_slice($metadata, 0, 20, true) as $key => $value) {
            $key = sanitize_key((string) $key);
            $sensitive = in_array($key, ['name', 'ip', 'user'], true)
                || preg_match('/(?:email|phone|telephone|password|token|cookie|address|ip_?address|user_?id|full_?name)/', $key);
            if ($key === '' || $sensitive || is_array($value) || is_object($value)) continue;
            if (is_bool($value)) $clean[$key] = $value;
            elseif (is_numeric($value)) $clean[$key] = (float) $value;
            else $clean[$key] = sanitize_text_field(substr((string) $value, 0, 256));
        }
        return $clean;
    }

    /**
     * Variant metadata has a tiny explicit nested contract. Keeping the clone
     * file digests is useful for future promotion/conflict checks, while all
     * arbitrary analytics metadata remains scalar and PII-filtered.
     *
     * @return array<string,mixed>
     */
    private function sanitize_variant_metadata(mixed $metadata): array {
        if (!is_array($metadata)) return [];
        $clean = $this->sanitize_metadata($metadata);
        if (isset($metadata['runtime_relative'])) {
            $relative = ltrim(str_replace('\\', '/', (string) $metadata['runtime_relative']), '/');
            if (
                $relative !== ''
                && !str_contains($relative, '../')
                && !str_contains($relative, "\0")
                && str_starts_with($relative, '.kodety-experiments/')
            ) {
                $clean['runtime_relative'] = $relative;
            }
        }
        if (isset($metadata['source_page_path'])) {
            $clean['source_page_path'] = $this->sanitize_page_path((string) $metadata['source_page_path']);
        }
        if (isset($metadata['public_slug'])) {
            $slug = $this->public_variant_slug((string) $metadata['public_slug']);
            if ($slug !== '') $clean['public_slug'] = $slug;
            else unset($clean['public_slug']);
        }
        if (isset($metadata['variant_status'])) {
            $status = sanitize_key((string) $metadata['variant_status']);
            if (in_array($status, ['active', 'paused', 'archived'], true)) $clean['variant_status'] = $status;
        }
        if (isset($metadata['source_file_digests']) && is_array($metadata['source_file_digests'])) {
            $digests = [];
            foreach (array_slice($metadata['source_file_digests'], 0, 500, true) as $path => $digest) {
                $path = ltrim(str_replace('\\', '/', sanitize_text_field((string) $path)), '/');
                $digest = strtolower(trim((string) $digest));
                if ($path === '' || str_contains($path, '../') || !preg_match('/^[a-f0-9]{32,128}$/', $digest)) continue;
                $digests[substr($path, 0, 512)] = $digest;
            }
            $clean['source_file_digests'] = $digests;
        }
        return $clean;
    }

    private function set_public_cookie(string $name, string $value, int $ttl, bool $http_only): void {
        if (headers_sent()) return;
        setcookie($name, $value, [
            'expires' => time() + $ttl,
            'path' => COOKIEPATH ?: '/',
            'domain' => COOKIE_DOMAIN,
            'secure' => is_ssl(),
            'httponly' => $http_only,
            'samesite' => 'Lax',
        ]);
        $_COOKIE[$name] = $value;
    }

    private function clear_public_cookie(string $name): void {
        unset($_COOKIE[$name]);
        if (headers_sent()) return;
        setcookie($name, '', [
            'expires' => time() - DAY_IN_SECONDS,
            'path' => COOKIEPATH ?: '/',
            'domain' => COOKIE_DOMAIN,
            'secure' => is_ssl(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
}
