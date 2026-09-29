<?php

defined('ABSPATH') || exit;

/**
 * Native WordPress identity and membership domain for Onun Kodety.
 *
 * Administrative authorization remains capability-based. Commercial access
 * is resolved from plans, entitlements, grants and subscriptions, never from
 * WordPress roles. The module is disabled by default and every published
 * project must be explicitly opted in before a policy can allow access.
 */
final class Kodety_Members {
    private const DB_VERSION = 1;
    private const OPTION_SETTINGS = 'kodety_membership_settings';
    private const OPTION_DB_VERSION = 'kodety_membership_db_version';
    private const CLEANUP_HOOK = 'kodety_members_cleanup';
    private const RESET_EXCHANGE_COOKIE = 'kodety_member_reset';
    private const MEMBER_SESSION_COOKIE_PREFIX = 'kodety_member_session_';
    private const MEMBER_SESSION_TRANSIENT_PREFIX = 'kodety_members_session_';
    private const MEMBER_SESSION_TTL = 12 * HOUR_IN_SECONDS;
    private const MEMBER_SESSION_REMEMBER_TTL = 30 * DAY_IN_SECONDS;
    private const MEMBER_SESSION_CSRF_HEADER = 'X-Kodety-Member-CSRF';
    private const REST_NAMESPACE = 'kodety/v1';
    private const REST_BASE = '/membership';
    private const MAX_PAGE_SIZE = 100;
    private const MAX_POLICY_DEPTH = 12;
    private const MAX_POLICY_NODES = 128;
    private const ADMIN_CAPABILITIES = [
        'kodety_view_members',
        'kodety_manage_members',
        'kodety_assign_membership',
        'kodety_manage_commerce',
    ];
    private const PLAN_STATUSES = ['active', 'draft', 'archived'];
    private const ENTITLEMENT_STATUSES = ['active', 'archived'];
    private const GRANT_STATUSES = ['active', 'revoked', 'expired'];
    private const GRANT_SOURCES = ['manual', 'promotion', 'import', 'subscription', 'provider'];
    private const SUBSCRIPTION_STATUSES = [
        'pending',
        'trialing',
        'active',
        'past_due',
        'paused',
        'canceled',
        'expired',
    ];
    private const ACCESS_SUBSCRIPTION_STATUSES = ['trialing', 'active'];
    private const PUBLIC_MEMBER_ROLES = ['subscriber', 'customer'];
    private const PUBLIC_MEMBER_CAPABILITIES = ['read', 'level_0'];

    private static ?self $instance = null;

    /** @var array<string,array<string,mixed>> */
    private array $request_claims = [];

    /** @var array<int,array<string,mixed>> */
    private array $pending_user_deletions = [];

    /** @var array<int,bool> */
    private array $finalized_user_deletions = [];

    private bool $member_authentication_in_progress = false;
    private bool $member_session_checked = false;
    private ?WP_User $member_session_user_cache = null;
    private string $member_session_token_cache = '';

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'maybe_upgrade'], 1);
        add_action('init', [$this, 'clear_legacy_member_wp_session'], 2);
        add_action('init', [$this, 'ensure_active_extension_project_enabled'], 3);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('admin_menu', [$this, 'admin_menu'], 30);
        add_action('admin_init', [$this, 'maybe_redirect_admin_page'], 30);
        add_action(self::CLEANUP_HOOK, [$this, 'cleanup']);
        add_action('wp_login', [$this, 'record_login'], 10, 2);
        add_action('delete_user', [$this, 'capture_user_deletion'], 10, 3);
        add_action('deleted_user', [$this, 'finalize_user_deletion'], 10, 3);
        add_action('template_redirect', [$this, 'capture_password_reset_exchange'], -100);
        add_filter('authenticate', [$this, 'block_native_member_login'], 99, 3);
        add_filter(
            'wp_is_application_passwords_available_for_user',
            [$this, 'filter_member_application_passwords'],
            20,
            2
        );
        add_filter(
            'retrieve_password_message',
            [$this, 'filter_password_reset_message'],
            PHP_INT_MAX,
            4
        );
    }

    public static function activate(): void {
        self::migrate_from((int) get_option(self::OPTION_DB_VERSION, 0));
        self::install_capabilities();
        add_option(self::OPTION_SETTINGS, self::default_settings(), '', false);
        if (!wp_next_scheduled(self::CLEANUP_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_HOOK);
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook(self::CLEANUP_HOOK);
    }

    public function maybe_upgrade(): void {
        $current = (int) get_option(self::OPTION_DB_VERSION, 0);
        if ($current < self::DB_VERSION) {
            self::migrate_from($current);
            self::install_capabilities();
        }
        add_option(self::OPTION_SETTINGS, self::default_settings(), '', false);
        if (!wp_next_scheduled(self::CLEANUP_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_HOOK);
        }
    }

    private static function migrate_from(int $current): void {
        if ($current < 1) {
            self::install_schema_v1();
            update_option(self::OPTION_DB_VERSION, 1, false);
            $current = 1;
        }
        if ($current < self::DB_VERSION) {
            update_option(self::OPTION_DB_VERSION, self::DB_VERSION, false);
        }
    }

    private static function install_capabilities(): void {
        $administrator = get_role('administrator');
        if (!$administrator) return;
        foreach (self::ADMIN_CAPABILITIES as $capability) {
            $administrator->add_cap($capability);
        }
    }

    private static function install_schema_v1(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $plans = self::table_name('plans');
        $entitlements = self::table_name('entitlements');
        $plan_entitlements = self::table_name('plan_entitlements');
        $subscriptions = self::table_name('subscriptions');
        $grants = self::table_name('grants');
        $events = self::table_name('events');
        $audit = self::table_name('audit');

        dbDelta("CREATE TABLE {$plans} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            uuid char(36) NOT NULL,
            slug varchar(191) NOT NULL,
            name varchar(191) NOT NULL,
            description text NULL,
            status varchar(20) NOT NULL DEFAULT 'active',
            visibility varchar(20) NOT NULL DEFAULT 'private',
            metadata longtext NULL,
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uuid (uuid),
            UNIQUE KEY slug (slug),
            KEY status_updated (status,updated_at)
        ) {$charset};");

        dbDelta("CREATE TABLE {$entitlements} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            entitlement_key varchar(191) NOT NULL,
            name varchar(191) NOT NULL,
            description text NULL,
            value_type varchar(20) NOT NULL DEFAULT 'boolean',
            default_value longtext NULL,
            status varchar(20) NOT NULL DEFAULT 'active',
            metadata longtext NULL,
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY entitlement_key (entitlement_key),
            KEY status_updated (status,updated_at)
        ) {$charset};");

        dbDelta("CREATE TABLE {$plan_entitlements} (
            plan_id bigint(20) unsigned NOT NULL,
            entitlement_id bigint(20) unsigned NOT NULL,
            value_json longtext NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (plan_id,entitlement_id),
            KEY entitlement_plan (entitlement_id,plan_id)
        ) {$charset};");

        dbDelta("CREATE TABLE {$subscriptions} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            user_id bigint(20) unsigned NOT NULL,
            plan_id bigint(20) unsigned NOT NULL,
            provider varchar(64) NOT NULL,
            provider_tenant varchar(191) NOT NULL DEFAULT '',
            external_customer_id varchar(191) NOT NULL DEFAULT '',
            external_contract_id varchar(191) NOT NULL,
            external_key_hash char(64) NOT NULL,
            status varchar(24) NOT NULL DEFAULT 'pending',
            started_at datetime NULL,
            trial_ends_at datetime NULL,
            current_period_start datetime NULL,
            current_period_end datetime NULL,
            grace_ends_at datetime NULL,
            canceled_at datetime NULL,
            ended_at datetime NULL,
            metadata longtext NULL,
            revision bigint(20) unsigned NOT NULL DEFAULT 1,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY external_key_hash (external_key_hash),
            KEY user_status (user_id,status),
            KEY plan_status (plan_id,status),
            KEY period_end (current_period_end,status)
        ) {$charset};");

        dbDelta("CREATE TABLE {$grants} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            user_id bigint(20) unsigned NOT NULL,
            plan_id bigint(20) unsigned NOT NULL DEFAULT 0,
            entitlement_id bigint(20) unsigned NOT NULL DEFAULT 0,
            source varchar(24) NOT NULL DEFAULT 'manual',
            source_reference varchar(191) NOT NULL DEFAULT '',
            grant_key char(64) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'active',
            starts_at datetime NOT NULL,
            ends_at datetime NULL,
            reason varchar(500) NOT NULL DEFAULT '',
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            revised_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY grant_key (grant_key),
            KEY user_status_dates (user_id,status,starts_at,ends_at),
            KEY plan_status (plan_id,status),
            KEY entitlement_status (entitlement_id,status)
        ) {$charset};");

        dbDelta("CREATE TABLE {$events} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            provider varchar(64) NOT NULL,
            provider_tenant varchar(191) NOT NULL DEFAULT '',
            external_event_id varchar(191) NOT NULL,
            event_key_hash char(64) NOT NULL,
            event_type varchar(128) NOT NULL,
            payload_hash char(64) NOT NULL,
            status varchar(24) NOT NULL DEFAULT 'received',
            attempts smallint(5) unsigned NOT NULL DEFAULT 0,
            last_error varchar(1000) NOT NULL DEFAULT '',
            occurred_at datetime NULL,
            processed_at datetime NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY event_key_hash (event_key_hash),
            KEY provider_status (provider,status,created_at),
            KEY created_at (created_at)
        ) {$charset};");

        dbDelta("CREATE TABLE {$audit} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            actor_id bigint(20) unsigned NOT NULL DEFAULT 0,
            subject_user_id bigint(20) unsigned NOT NULL DEFAULT 0,
            action varchar(128) NOT NULL,
            entity_type varchar(64) NOT NULL,
            entity_id varchar(191) NOT NULL DEFAULT '',
            request_uuid char(36) NOT NULL,
            ip_hash char(64) NOT NULL DEFAULT '',
            before_json longtext NULL,
            after_json longtext NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY actor_created (actor_id,created_at),
            KEY subject_created (subject_user_id,created_at),
            KEY entity_created (entity_type,entity_id,created_at),
            KEY created_at (created_at)
        ) {$charset};");
    }

    private static function table_name(string $suffix): string {
        global $wpdb;
        return $wpdb->prefix . 'kodety_membership_' . $suffix;
    }

    /** @return array<string,mixed> */
    private static function default_settings(): array {
        return [
            'enabled' => false,
            'registration_enabled' => false,
            'require_email_verification' => false,
            'enabled_projects' => [],
            'default_role' => 'subscriber',
            'login_page_url' => '',
            'account_page_url' => '',
            'upgrade_page_url' => '',
            'reset_page_url' => '',
            'after_login_url' => '',
            'after_logout_url' => '',
            'audit_retention_days' => 730,
            'event_retention_days' => 365,
        ];
    }

    /** @return array<string,mixed> */
    public static function settings(): array {
        $stored = get_option(self::OPTION_SETTINGS, []);
        $stored = is_array($stored) ? $stored : [];
        return self::sanitize_settings(array_merge(self::default_settings(), $stored));
    }

    /**
     * Project templates carry authoring configuration, never identities,
     * subscriptions, grants, credentials or audit history.
     *
     * @return array<string,mixed>
     */
    public static function template_settings(): array {
        $settings = self::settings();
        $allowed = [
            'registration_enabled',
            'default_role',
            'login_page_url',
            'account_page_url',
            'upgrade_page_url',
            'reset_page_url',
            'after_login_url',
            'after_logout_url',
            'audit_retention_days',
            'event_retention_days',
        ];
        return array_intersect_key($settings, array_fill_keys($allowed, true));
    }

    /** Restore only the portable Membership authoring fields. */
    public static function restore_template_settings(array $template): bool {
        $before = self::settings();
        $portable = array_intersect_key($template, self::template_settings());
        $after = self::sanitize_settings(array_merge($before, $portable, [
            // Activation belongs to the extension manager and the destination
            // host. A template must never enable itself or another project.
            'enabled' => $before['enabled'],
            'enabled_projects' => $before['enabled_projects'],
        ]));
        update_option(self::OPTION_SETTINGS, $after, false);
        return self::settings() === $after;
    }

    /**
     * Generated themes from older releases only know whether this class
     * exists. Keep that compatibility path fail-closed when the bundled
     * Membership extension has since been disabled.
     */
    private static function extension_active(): bool {
        return !class_exists('Kodety_Extensions')
            || Kodety_Extensions::instance()->is_active('kodety-membership');
    }

    /** @param array<string,mixed> $raw
     *  @return array<string,mixed>
     */
    private static function sanitize_settings(array $raw): array {
        $projects = [];
        foreach (array_slice((array) ($raw['enabled_projects'] ?? []), 0, 250) as $project) {
            $key = self::sanitize_project_key((string) $project);
            if ($key !== '') $projects[$key] = $key;
        }
        $role = self::sanitize_public_member_role($raw['default_role'] ?? 'subscriber');
        return [
            'enabled' => rest_sanitize_boolean($raw['enabled'] ?? false),
            'registration_enabled' => rest_sanitize_boolean($raw['registration_enabled'] ?? false),
            // Verification cannot be advertised before a durable token and
            // transactional e-mail flow is connected.
            'require_email_verification' => false,
            'enabled_projects' => array_values($projects),
            'default_role' => $role,
            'login_page_url' => self::sanitize_navigation_url($raw['login_page_url'] ?? ''),
            'account_page_url' => self::sanitize_navigation_url($raw['account_page_url'] ?? ''),
            // Upgrade may deliberately point at an external HTTPS checkout
            // (for example Shopify). Session and reset destinations may not.
            'upgrade_page_url' => self::sanitize_navigation_url($raw['upgrade_page_url'] ?? '', true),
            'reset_page_url' => self::sanitize_navigation_url($raw['reset_page_url'] ?? ''),
            'after_login_url' => self::sanitize_navigation_url($raw['after_login_url'] ?? ''),
            'after_logout_url' => self::sanitize_navigation_url($raw['after_logout_url'] ?? ''),
            'audit_retention_days' => max(30, min(3650, absint($raw['audit_retention_days'] ?? 730))),
            'event_retention_days' => max(30, min(3650, absint($raw['event_retention_days'] ?? 365))),
        ];
    }

    private static function sanitize_public_member_role(mixed $value): string {
        $role = sanitize_key((string) $value);
        if (!in_array($role, self::PUBLIC_MEMBER_ROLES, true)) $role = 'subscriber';
        if (!function_exists('get_role') || self::public_member_role_is_safe($role)) return $role;
        return self::public_member_role_is_safe('subscriber') ? 'subscriber' : $role;
    }

    private static function public_member_role_is_safe(string $role): bool {
        if (!in_array($role, self::PUBLIC_MEMBER_ROLES, true)) return false;
        if (!function_exists('get_role')) return true;
        $role_object = get_role($role);
        if (!$role_object || !is_array($role_object->capabilities ?? null)) return false;
        foreach ($role_object->capabilities as $capability => $granted) {
            if (!$granted) continue;
            $capability = sanitize_key((string) $capability);
            if (
                str_starts_with($capability, 'kodety_')
                || !in_array($capability, self::PUBLIC_MEMBER_CAPABILITIES, true)
            ) {
                return false;
            }
        }
        return true;
    }

    /** Resolve the role again immediately before account creation. A role can
     * be mutated by another plugin after settings were saved, so sanitizing the
     * option alone is not an authorization boundary. */
    private static function validated_public_member_role(): string|WP_Error {
        $role = sanitize_key((string) (self::settings()['default_role'] ?? ''));
        if (!self::public_member_role_is_safe($role)) {
            return new WP_Error(
                'kodety_members_registration_role_unsafe',
                'A função padrão de membros não é segura para criar contas.',
                ['status' => 503]
            );
        }
        return $role;
    }

    private static function has_safe_public_member_identity(WP_User $user): bool {
        if (!$user->exists()) return false;
        $roles = array_values(array_filter(array_map(
            'sanitize_key',
            (array) ($user->roles ?? [])
        )));
        if (!$roles || array_diff($roles, self::PUBLIC_MEMBER_ROLES)) return false;
        foreach ($roles as $role) {
            if (!self::public_member_role_is_safe($role)) return false;
        }
        $allowed_capabilities = array_fill_keys([
            ...self::PUBLIC_MEMBER_CAPABILITIES,
            ...self::PUBLIC_MEMBER_ROLES,
        ], true);
        foreach ((array) ($user->allcaps ?? []) as $capability => $granted) {
            if (
                $granted
                && !isset($allowed_capabilities[sanitize_key((string) $capability)])
            ) return false;
        }
        foreach ([
            'edit_posts',
            'upload_files',
            'manage_options',
            'create_users',
            'promote_users',
            'delete_users',
            ...self::ADMIN_CAPABILITIES,
        ] as $capability) {
            if (user_can($user, $capability)) return false;
        }
        return true;
    }

    private static function has_legacy_membership_evidence(int $user_id): bool {
        if ($user_id <= 0) return false;
        global $wpdb;
        $found = $wpdb->get_var($wpdb->prepare(
            'SELECT 1 FROM (
                SELECT user_id AS member_id
                FROM ' . self::table_name('grants') . ' WHERE user_id=%d
                UNION ALL
                SELECT user_id AS member_id
                FROM ' . self::table_name('subscriptions') . ' WHERE user_id=%d
                UNION ALL
                SELECT subject_user_id AS member_id
                FROM ' . self::table_name('audit') . '
                WHERE subject_user_id=%d AND action IN (%s,%s)
             ) kodety_legacy_member LIMIT 1',
            $user_id,
            $user_id,
            $user_id,
            'member_registered',
            'member_created'
        ));
        return (string) $found === '1';
    }

    private static function migrate_legacy_member_marker(WP_User $user): bool {
        if (
            !self::has_safe_public_member_identity($user)
            || !self::has_legacy_membership_evidence((int) $user->ID)
        ) return false;
        update_user_meta($user->ID, '_kodety_membership_status', 'active');
        return true;
    }

    /**
     * A Onun Kodety member is deliberately narrower than a generic WordPress user.
     * This boundary prevents editor/administrator credentials from ever
     * becoming a public-site member session.
     */
    public static function is_public_member_account(WP_User $user): bool {
        if (!self::has_safe_public_member_identity($user)) return false;
        return in_array(
            sanitize_key((string) get_user_meta(
                $user->ID,
                '_kodety_membership_status',
                true
            )),
            ['active', 'invited', 'suspended'],
            true
        );
    }

    private static function is_public_member_login_candidate(WP_User $user): bool {
        if (!self::has_safe_public_member_identity($user)) return false;
        $status = sanitize_key((string) get_user_meta(
            $user->ID,
            '_kodety_membership_status',
            true
        ));
        if (in_array($status, ['active', 'invited'], true)) return true;
        return $status === '' && self::migrate_legacy_member_marker($user);
    }

    private static function is_public_member_reset_candidate(WP_User $user): bool {
        return self::is_public_member_account($user)
            || self::migrate_legacy_member_marker($user);
    }

    private static function member_session_cookie_name(): string {
        $site = strtolower(untrailingslashit(home_url('/')));
        return self::MEMBER_SESSION_COOKIE_PREFIX . substr(hash('sha256', $site), 0, 12);
    }

    private static function member_session_key(string $token): string {
        return self::MEMBER_SESSION_TRANSIENT_PREFIX . hash('sha256', $token);
    }

    private static function member_session_password_proof(WP_User $user): string {
        return hash_hmac(
            'sha256',
            (string) $user->ID . '|' . (string) ($user->user_pass ?? ''),
            wp_salt('auth')
        );
    }

    private static function member_session_csrf(string $token): string {
        return hash_hmac('sha256', 'member-session-csrf|' . $token, wp_salt('nonce'));
    }

    /** @return array{expires:int,path:string,secure:bool,httponly:bool,samesite:string} */
    private static function member_session_cookie_options(int $expires): array {
        // Domain is intentionally omitted: the member bearer is host-only and
        // cannot leak to sibling subdomains even if WordPress uses COOKIE_DOMAIN.
        $home_scheme = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_SCHEME));
        return [
            'expires' => $expires,
            'path' => '/',
            'secure' => is_ssl() || $home_scheme === 'https',
            'httponly' => true,
            'samesite' => 'Lax',
        ];
    }

    private function invalidate_member_session(string $token, bool $clear_cookie = true): void {
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) {
            delete_transient(self::member_session_key($token));
        }
        if ($clear_cookie && !headers_sent()) {
            setcookie(
                self::member_session_cookie_name(),
                '',
                self::member_session_cookie_options(time() - HOUR_IN_SECONDS)
            );
        }
        unset($_COOKIE[self::member_session_cookie_name()]);
        $this->member_session_checked = true;
        $this->member_session_user_cache = null;
        $this->member_session_token_cache = '';
    }

    private function member_session_user(): ?WP_User {
        if ($this->member_session_checked) return $this->member_session_user_cache;
        $this->member_session_checked = true;
        $token = trim((string) ($_COOKIE[self::member_session_cookie_name()] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) {
            if ($token !== '') $this->invalidate_member_session($token);
            return null;
        }
        $session = get_transient(self::member_session_key($token));
        $user_id = is_array($session) ? absint($session['userId'] ?? 0) : 0;
        $version = is_array($session) ? absint($session['version'] ?? 0) : 0;
        $issued_at = is_array($session) ? absint($session['issuedAt'] ?? 0) : 0;
        $expires_at = is_array($session) ? absint($session['expiresAt'] ?? 0) : 0;
        $user = $user_id > 0 ? get_user_by('id', $user_id) : false;
        $proof = is_array($session) ? (string) ($session['passwordProof'] ?? '') : '';
        $valid = $user instanceof WP_User
            && self::is_public_member_account($user)
            && sanitize_key((string) get_user_meta(
                $user->ID,
                '_kodety_membership_status',
                true
            )) !== 'suspended'
            && $version === 1
            && $issued_at > 0
            && $issued_at <= time() + MINUTE_IN_SECONDS
            && $issued_at < $expires_at
            && $expires_at > time()
            && $proof !== ''
            && hash_equals(self::member_session_password_proof($user), $proof);
        if (!$valid) {
            $this->invalidate_member_session($token);
            return null;
        }
        $this->member_session_user_cache = $user;
        $this->member_session_token_cache = $token;
        return $user;
    }

    public static function current_member_id(): int {
        if (!self::extension_active()) return 0;
        $user = self::instance()->member_session_user();
        return $user instanceof WP_User ? (int) $user->ID : 0;
    }

    public static function current_member_csrf_token(): string {
        if (!self::extension_active()) return '';
        $instance = self::instance();
        if (!$instance->member_session_user()) return '';
        return self::member_session_csrf($instance->member_session_token_cache);
    }

    /**
     * Issue an opaque public-site session without touching WordPress auth
     * cookies or the native current-user global.
     *
     * @return array{memberCsrf:string,expiresAt:string}|WP_Error
     */
    public function start_member_session(
        WP_User|int $user,
        bool $remember = false
    ): array|WP_Error {
        $user_id = is_int($user) ? $user : (int) $user->ID;
        // Always reload after authentication: WordPress may transparently
        // rehash the password and the session proof must use the new hash.
        $user = $user_id > 0 ? get_user_by('id', $user_id) : false;
        if (
            !$user instanceof WP_User
            || !self::is_public_member_account($user)
            || sanitize_key((string) get_user_meta(
                $user->ID,
                '_kodety_membership_status',
                true
            )) === 'suspended'
        ) {
            return new WP_Error(
                'kodety_members_session_forbidden',
                'Não foi possível iniciar a sessão de membro.',
                ['status' => 403]
            );
        }
        if (headers_sent()) {
            return new WP_Error(
                'kodety_members_session_headers',
                'Não foi possível iniciar a sessão de membro.',
                ['status' => 500]
            );
        }
        try {
            $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        } catch (Throwable) {
            return new WP_Error(
                'kodety_members_session_unavailable',
                'Não foi possível iniciar a sessão de membro.',
                ['status' => 503]
            );
        }
        $ttl = $remember ? self::MEMBER_SESSION_REMEMBER_TTL : self::MEMBER_SESSION_TTL;
        $expires_at = time() + $ttl;
        $previous = trim((string) ($_COOKIE[self::member_session_cookie_name()] ?? ''));
        if (!set_transient(self::member_session_key($token), [
            'version' => 1,
            'userId' => (int) $user->ID,
            'issuedAt' => time(),
            'expiresAt' => $expires_at,
            'passwordProof' => self::member_session_password_proof($user),
        ], $ttl)) {
            return new WP_Error(
                'kodety_members_session_unavailable',
                'Não foi possível iniciar a sessão de membro.',
                ['status' => 503]
            );
        }
        $cookie_expires = $remember ? $expires_at : 0;
        if (!setcookie(
            self::member_session_cookie_name(),
            $token,
            self::member_session_cookie_options($cookie_expires)
        )) {
            delete_transient(self::member_session_key($token));
            return new WP_Error(
                'kodety_members_session_cookie',
                'Não foi possível iniciar a sessão de membro.',
                ['status' => 500]
            );
        }
        if (
            $previous !== $token
            && preg_match('/^[A-Za-z0-9_-]{43}$/', $previous)
        ) {
            delete_transient(self::member_session_key($previous));
        }
        $this->member_session_checked = true;
        $this->member_session_user_cache = $user;
        $this->member_session_token_cache = $token;
        $this->record_login((string) $user->user_login, $user);
        do_action('kodety_member_login', (string) $user->user_login, $user);
        return [
            'memberCsrf' => self::member_session_csrf($token),
            'expiresAt' => gmdate('c', $expires_at),
        ];
    }

    public function destroy_current_member_session(): bool {
        $token = $this->member_session_token_cache;
        if ($token === '') {
            $token = trim((string) ($_COOKIE[self::member_session_cookie_name()] ?? ''));
        }
        $this->invalidate_member_session($token);
        do_action('kodety_member_logout');
        return true;
    }

    /**
     * Remove only legacy Onun Kodety member cookies produced by versions that used
     * wp_signon(). Editor/admin cookies are never touched.
     */
    public function clear_legacy_member_wp_session(): void {
        if (!self::is_site_enabled() || !is_user_logged_in()) return;
        $user = wp_get_current_user();
        if (!$user instanceof WP_User) return;
        if (
            !self::is_public_member_account($user)
            && !self::migrate_legacy_member_marker($user)
        ) return;
        wp_clear_auth_cookie();
        wp_set_current_user(0);
    }

    public function block_native_member_login(
        mixed $user,
        string $username = '',
        string $password = ''
    ): mixed {
        if (
            $this->member_authentication_in_progress
            || !self::is_site_enabled()
            || !$user instanceof WP_User
        ) {
            return $user;
        }
        if (
            !self::is_public_member_account($user)
            && !self::migrate_legacy_member_marker($user)
        ) return $user;
        return new WP_Error(
            'kodety_members_native_login_blocked',
            'Esta conta deve entrar pela área de membros do site.'
        );
    }

    public function filter_member_application_passwords(
        bool $available,
        mixed $user
    ): bool {
        if (
            $available
            && self::is_site_enabled()
            && $user instanceof WP_User
            && (
                self::is_public_member_account($user)
                || self::migrate_legacy_member_marker($user)
            )
        ) return false;
        return $available;
    }

    public static function sanitize_project_key(string $value): string {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9._:-]+/', '-', $value) ?: '';
        return substr(trim($value, '-'), 0, 128);
    }

    private static function sanitize_navigation_url(
        mixed $value,
        bool $allow_external_https = false
    ): string {
        $value = trim((string) $value);
        if (
            $value === ''
            || str_contains($value, '\\')
            || preg_match('/[\x00-\x20\x7f]/', $value)
        ) return '';
        if (str_starts_with($value, '/')) {
            if (str_starts_with($value, '//')) return '';
            return '/' . ltrim(strtok($value, '#') ?: '', '/');
        }
        $url = esc_url_raw($value, ['https', 'http']);
        if ($url === '') return '';
        $scheme = strtolower((string) wp_parse_url($url, PHP_URL_SCHEME));
        $host = strtolower((string) wp_parse_url($url, PHP_URL_HOST));
        $port = (int) (wp_parse_url($url, PHP_URL_PORT) ?: ($scheme === 'https' ? 443 : 80));
        $home = home_url('/');
        $home_scheme = strtolower((string) wp_parse_url($home, PHP_URL_SCHEME));
        $home_host = strtolower((string) wp_parse_url($home, PHP_URL_HOST));
        $home_port = (int) (
            wp_parse_url($home, PHP_URL_PORT)
            ?: ($home_scheme === 'https' ? 443 : 80)
        );
        $same_origin = $scheme !== ''
            && $host !== ''
            && $home_scheme !== ''
            && $home_host !== ''
            && hash_equals($home_scheme, $scheme)
            && hash_equals($home_host, $host)
            && $home_port === $port;
        if (!$same_origin && !($allow_external_https && $scheme === 'https')) return '';
        return strtok($url, '#') ?: '';
    }

    public static function is_site_enabled(): bool {
        if (!self::extension_active()) return false;
        if (function_exists('is_multisite') && is_multisite()) return false;
        $enabled = !empty(self::settings()['enabled']);
        return (bool) apply_filters('kodety_members_site_enabled', $enabled);
    }

    public static function is_project_enabled(string $project_key): bool {
        if (!self::is_site_enabled()) return false;
        $project_key = self::sanitize_project_key($project_key);
        if ($project_key === '') return false;
        $enabled = in_array($project_key, self::settings()['enabled_projects'], true);
        return (bool) apply_filters('kodety_members_project_enabled', $enabled, $project_key);
    }

    public static function is_current_project_enabled(): bool {
        $project_key = self::sanitize_project_key((string) get_option(
            'kodety_workspace_project_id',
            ''
        ));
        if ($project_key === '') {
            $project_key = self::sanitize_project_key((string) get_option(
                'kodety_published_project_id',
                ''
            ));
        }
        if ($project_key === '') return false;
        return self::is_project_enabled($project_key);
    }

    /**
     * Membership activation is owned by the extension manager. Keep the
     * existing per-project runtime contract synchronized automatically so
     * older published themes and Builder metadata continue to work without a
     * second toggle.
     */
    public function ensure_active_extension_project_enabled(): void {
        if (!self::extension_active()) return;
        $project_key = self::sanitize_project_key((string) get_option(
            'kodety_workspace_project_id',
            ''
        ));
        if ($project_key === '') {
            $project_key = self::sanitize_project_key((string) get_option(
                'kodety_published_project_id',
                ''
            ));
        }
        if ($project_key === '' || self::is_project_enabled($project_key)) return;
        $result = $this->set_project_enabled($project_key, true, get_current_user_id());
        if (is_wp_error($result)) {
            error_log(
                '[Onun Kodety] Não foi possível ativar Membership automaticamente para '
                . $project_key
                . ': '
                . $result->get_error_message()
            );
        }
    }

    public function admin_menu(): void {
        // The Members workspace is project-scoped. Keeping its entry hidden
        // while the current project is opted out avoids advertising an
        // inactive product area in the main WordPress navigation.
        if (!self::is_current_project_enabled()) return;
        $i18n = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
        add_menu_page(
            $i18n ? $i18n->translate('Membros Onun Kodety') : 'Membros Onun Kodety',
            $i18n ? $i18n->translate('Membros') : 'Membros',
            'kodety_view_members',
            'kodety-members',
            [$this, 'render_admin_page'],
            'dashicons-groups',
            11
        );
    }

    public function maybe_redirect_admin_page(): void {
        if (sanitize_key((string) ($_GET['page'] ?? '')) !== 'kodety-members') return;
        if (!self::is_current_project_enabled()) return;
        if (!current_user_can('kodety_view_members')) return;
        $target = (string) apply_filters('kodety_members_admin_redirect_url', '');
        if ($target === '') return;
        $target_host = strtolower((string) wp_parse_url($target, PHP_URL_HOST));
        $home_host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
        if ($target_host !== '' && ($home_host === '' || !hash_equals($home_host, $target_host))) return;
        if (wp_safe_redirect($target)) exit;
    }

    public function render_admin_page(): void {
        if (!current_user_can('kodety_view_members')) {
            $message = 'Você não tem permissão para acessar membros.';
            if (class_exists('Kodety_Admin_I18n')) $message = Kodety_Admin_I18n::instance()->translate($message);
            wp_die(esc_html($message));
        }
        $config = [
            'restBase' => rest_url(self::REST_NAMESPACE . self::REST_BASE),
            'nonce' => wp_create_nonce('wp_rest'),
            'siteEnabled' => self::is_site_enabled(),
        ];
        echo '<div class="wrap kodety-members-admin">';
        $title = class_exists('Kodety_Admin_I18n')
            ? Kodety_Admin_I18n::instance()->translate('Membros')
            : 'Membros';
        echo '<h1>' . esc_html($title) . '</h1>';
        echo '<div id="kodety-members-admin-root" data-kodety-members-config="'
            . esc_attr((string) wp_json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))
            . '"></div>';
        do_action('kodety_members_render_admin_page', $config);
        echo '</div>';
    }

    public function register_rest_routes(): void {
        $private = [$this, 'view_permission'];
        $manage = [$this, 'manage_permission'];
        $assign = [$this, 'assign_permission'];
        $commerce = [$this, 'commerce_permission'];

        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/settings', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_settings'],
                'permission_callback' => $private,
            ],
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'update_settings'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/plans', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_plans'],
                'permission_callback' => $private,
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_plan'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/plans/(?P<id>\d+)', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_plan'],
                'permission_callback' => $private,
            ],
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'update_plan'],
                'permission_callback' => $commerce,
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'archive_plan'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/plans/(?P<id>\d+)/entitlements', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_plan_entitlements'],
                'permission_callback' => $private,
            ],
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'replace_plan_entitlements'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/entitlements', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_entitlements'],
                'permission_callback' => $private,
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_entitlement'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/entitlements/(?P<id>\d+)', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_entitlement'],
                'permission_callback' => $private,
            ],
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'update_entitlement'],
                'permission_callback' => $commerce,
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'archive_entitlement'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/members', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_members'],
                'permission_callback' => $private,
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_member'],
                'permission_callback' => $manage,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/members/(?P<id>\d+)', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_member'],
                'permission_callback' => $private,
            ],
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'update_member'],
                'permission_callback' => $manage,
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete_member'],
                'permission_callback' => $manage,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/overview', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'overview'],
                'permission_callback' => $private,
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'update_overview'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/members/(?P<id>\d+)/grants', [
            'methods' => 'POST',
            'callback' => [$this, 'create_grant'],
            'permission_callback' => $assign,
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/members/(?P<id>\d+)/grants/(?P<grant_id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [$this, 'revoke_grant'],
            'permission_callback' => $assign,
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/subscriptions', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_subscriptions'],
                'permission_callback' => $private,
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'upsert_subscription_rest'],
                'permission_callback' => $commerce,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/events', [
            'methods' => 'GET',
            'callback' => [$this, 'list_events'],
            'permission_callback' => $commerce,
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/audit', [
            'methods' => 'GET',
            'callback' => [$this, 'list_audit'],
            // Audit snapshots can contain historical member identifiers and
            // administrator subjects. Keep them behind the native highest
            // administrative boundary rather than the delegated viewer cap.
            'permission_callback' => [$this, 'audit_permission'],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/policy/preview', [
            'methods' => 'POST',
            'callback' => [$this, 'preview_policy'],
            'permission_callback' => $private,
        ]);

        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/auth/challenge', [
            'methods' => 'GET',
            'callback' => [$this, 'issue_auth_challenge'],
            'permission_callback' => [$this, 'public_challenge_permission'],
        ]);
        foreach ([
            'login' => 'login',
            'register' => 'register',
            'forgot' => 'forgot_password',
            'reset' => 'reset_password',
        ] as $route => $callback) {
            register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/auth/' . $route, [
                'methods' => 'POST',
                'callback' => [$this, $callback],
                'permission_callback' => [$this, 'public_auth_permission'],
            ]);
        }
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/auth/logout', [
            'methods' => 'POST',
            'callback' => [$this, 'logout'],
            'permission_callback' => [$this, 'member_permission'],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/me', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_me'],
                'permission_callback' => [$this, 'member_permission'],
            ],
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'update_me'],
                'permission_callback' => [$this, 'member_permission'],
            ],
        ]);
    }

    public function view_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->private_permission($request, 'kodety_view_members');
    }

    public function manage_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->private_permission($request, 'kodety_manage_members');
    }

    public function assign_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->private_permission($request, 'kodety_assign_membership');
    }

    public function commerce_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->private_permission($request, 'kodety_manage_commerce');
    }

    public function audit_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->private_permission($request, 'manage_options');
    }

    private function private_permission(
        WP_REST_Request $request,
        string $capability
    ): bool|WP_Error {
        if (
            class_exists('Kodety_Sharing')
            && Kodety_Sharing::instance()->context($request)
        ) {
            $share_access = $capability === 'kodety_view_members' ? 'view' : 'edit';
            if (Kodety_Sharing::instance()->authorize_rest($request, $share_access)) return true;
            return new WP_Error(
                'kodety_share_read_only',
                'Este compartilhamento permite apenas visualizar a área de membros.',
                ['status' => 403]
            );
        }
        if (!current_user_can($capability)) {
            return new WP_Error(
                'kodety_members_forbidden',
                'Sem permissão para gerenciar membros.',
                ['status' => 403]
            );
        }
        $nonce = trim((string) $request->get_header('X-WP-Nonce'));
        if ($nonce === '') $nonce = trim((string) $request->get_param('_wpnonce'));
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error(
                'kodety_members_nonce',
                'A sessão de membros expirou.',
                ['status' => 403]
            );
        }
        return true;
    }

    public function member_permission(WP_REST_Request $request): bool|WP_Error {
        if (!self::is_current_project_enabled()) {
            return new WP_Error('kodety_members_disabled', 'Área de membros desativada.', ['status' => 503]);
        }
        $user = $this->member_session_user();
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_auth_required', 'Autenticação necessária.', ['status' => 401]);
        }
        $origin = $this->same_origin($request, false);
        if (is_wp_error($origin)) return $origin;
        $csrf = trim((string) $request->get_header(self::MEMBER_SESSION_CSRF_HEADER));
        $expected = self::member_session_csrf($this->member_session_token_cache);
        if ($csrf === '' || !hash_equals($expected, $csrf)) {
            return new WP_Error('kodety_members_nonce', 'A sessão expirou.', ['status' => 403]);
        }
        return true;
    }

    public function public_auth_permission(WP_REST_Request $request): bool|WP_Error {
        if (!self::is_current_project_enabled()) {
            return new WP_Error('kodety_members_disabled', 'Área de membros desativada.', ['status' => 503]);
        }
        $content_length = absint($request->get_header('Content-Length'));
        if ($content_length > 65536) {
            return new WP_Error('kodety_members_request_size', 'Requisição acima do limite.', ['status' => 413]);
        }
        return $this->same_origin($request, true);
    }

    public function public_challenge_permission(WP_REST_Request $request): bool|WP_Error {
        if (!self::is_current_project_enabled()) {
            return new WP_Error('kodety_members_disabled', 'Área de membros desativada.', ['status' => 503]);
        }
        // A challenge contains no account data and remains bound to the
        // server-observed IP. Accept a missing Referer (for no-referrer pages),
        // while still rejecting an explicitly foreign Origin/Referer.
        return $this->same_origin($request, false);
    }

    private function same_origin(WP_REST_Request $request, bool $required): bool|WP_Error {
        $origin = trim((string) $request->get_header('Origin'));
        $referer = trim((string) $request->get_header('Referer'));
        $candidate = $origin !== '' && strtolower($origin) !== 'null' ? $origin : $referer;
        if ($candidate === '') {
            if (!$required) return true;
            return new WP_Error('kodety_members_origin', 'Origem obrigatória.', ['status' => 403]);
        }
        $request_origin = $this->normalized_origin($candidate);
        $home_origin = $this->normalized_origin(home_url('/'));
        if ($request_origin === '' || $home_origin === '' || !hash_equals($home_origin, $request_origin)) {
            return new WP_Error('kodety_members_origin', 'Origem não autorizada.', ['status' => 403]);
        }
        return true;
    }

    private function normalized_origin(string $url): string {
        $scheme = strtolower((string) wp_parse_url($url, PHP_URL_SCHEME));
        $host = strtolower((string) wp_parse_url($url, PHP_URL_HOST));
        $port = absint(wp_parse_url($url, PHP_URL_PORT));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') return '';
        if (($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80)) $port = 0;
        return $scheme . '://' . $host . ($port > 0 ? ':' . $port : '');
    }

    private function request_fingerprint(): string {
        // REMOTE_ADDR is the server-observed peer and cannot be rotated by
        // merely changing a request header. Proxy deployments should normalize
        // it at the trusted web-server boundary, never from X-Forwarded-For here.
        $ip = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
        $packed = filter_var($ip, FILTER_VALIDATE_IP) !== false ? @inet_pton($ip) : false;
        $identity = is_string($packed) ? bin2hex($packed) : 'unknown';
        return hash_hmac('sha256', $identity, wp_salt('nonce'));
    }

    /** @return resource|null */
    private function acquire_security_lock(string $scope, string $identity): mixed {
        $digest = hash_hmac('sha256', $scope . '|' . $identity, wp_salt('nonce'));
        // A bounded shard pool prevents attacker-controlled identities from
        // creating an unbounded number of lock files.
        $shard = hexdec(substr($digest, 0, 2)) % 64;
        $lock = @fopen(sys_get_temp_dir() . '/.kodety-members-lock-' . $shard, 'c');
        if (!is_resource($lock)) return null;
        if (!@flock($lock, LOCK_EX)) {
            fclose($lock);
            return null;
        }
        return $lock;
    }

    /** @param resource|null $lock */
    private function release_security_lock(mixed $lock): void {
        if (!is_resource($lock)) return;
        @flock($lock, LOCK_UN);
        fclose($lock);
    }

    private function rate_limit(
        string $scope,
        string $identity,
        int $limit,
        int $window
    ): bool|WP_Error {
        $key = 'kodety_mem_rl_' . substr(hash_hmac('sha256', $scope . '|' . $identity, wp_salt('nonce')), 0, 36);
        $lock = $this->acquire_security_lock('rate-limit', $key);
        if (!is_resource($lock)) {
            return new WP_Error(
                'kodety_members_security_unavailable',
                'Não foi possível validar a tentativa com segurança.',
                ['status' => 503]
            );
        }
        try {
            $state = get_transient($key);
            $state = is_array($state) ? $state : ['count' => 0, 'started' => time()];
            if ((int) ($state['started'] ?? 0) <= time() - $window) {
                $state = ['count' => 0, 'started' => time()];
            }
            if ((int) ($state['count'] ?? 0) >= $limit) {
                return new WP_Error(
                    'kodety_members_rate_limit',
                    'Muitas tentativas. Aguarde e tente novamente.',
                    ['status' => 429, 'retryAfter' => max(1, $window - (time() - (int) $state['started']))]
                );
            }
            $state['count'] = (int) ($state['count'] ?? 0) + 1;
            if (!set_transient($key, $state, $window + MINUTE_IN_SECONDS)) {
                return new WP_Error(
                    'kodety_members_security_unavailable',
                    'Não foi possível registrar a tentativa com segurança.',
                    ['status' => 503]
                );
            }
            return true;
        } finally {
            $this->release_security_lock($lock);
        }
    }

    public function issue_auth_challenge(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $limited = $this->rate_limit('challenge', $this->request_fingerprint(), 30, 10 * MINUTE_IN_SECONDS);
        if (is_wp_error($limited)) return $limited;
        $token = wp_generate_password(48, false, false);
        $token_hash = hash_hmac('sha256', $token, wp_salt('nonce'));
        if (!set_transient(
            'kodety_mem_csrf_' . substr($token_hash, 0, 40),
            ['fingerprint' => $this->request_fingerprint(), 'issued' => time()],
            10 * MINUTE_IN_SECONDS
        )) {
            return new WP_Error(
                'kodety_members_security_unavailable',
                'Não foi possível emitir o desafio de segurança.',
                ['status' => 503]
            );
        }
        return $this->response(['csrfToken' => $token, 'expiresIn' => 10 * MINUTE_IN_SECONDS]);
    }

    private function consume_auth_challenge(WP_REST_Request $request): bool|WP_Error {
        $token = trim((string) $request->get_header('X-Kodety-CSRF'));
        if ($token === '') $token = trim((string) $request->get_param('_kodety_csrf'));
        if (!preg_match('/^[A-Za-z0-9]{32,96}$/', $token)) {
            return new WP_Error('kodety_members_csrf', 'Desafio de segurança inválido.', ['status' => 403]);
        }
        $token_hash = hash_hmac('sha256', $token, wp_salt('nonce'));
        $key = 'kodety_mem_csrf_' . substr($token_hash, 0, 40);
        $lock = $this->acquire_security_lock('csrf', $key);
        if (!is_resource($lock)) {
            return new WP_Error('kodety_members_csrf', 'Desafio indisponível.', ['status' => 503]);
        }
        try {
            $challenge = get_transient($key);
            delete_transient($key);
        } finally {
            $this->release_security_lock($lock);
        }
        if (!is_array($challenge)) {
            return new WP_Error('kodety_members_csrf', 'Desafio expirado ou já utilizado.', ['status' => 403]);
        }
        $fingerprint = (string) ($challenge['fingerprint'] ?? '');
        $issued = (int) ($challenge['issued'] ?? 0);
        if (
            $fingerprint === ''
            || !hash_equals($fingerprint, $this->request_fingerprint())
            || $issued < time() - 10 * MINUTE_IN_SECONDS
            || $issued > time() + MINUTE_IN_SECONDS
        ) {
            return new WP_Error('kodety_members_csrf', 'Desafio inválido.', ['status' => 403]);
        }
        return true;
    }

    private function response(
        mixed $data,
        int $status = 200,
        ?int $total = null,
        ?int $per_page = null
    ): WP_REST_Response {
        $response = new WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        $response->header('Pragma', 'no-cache');
        if ($total !== null) {
            $response->header('X-WP-Total', (string) max(0, $total));
            $pages = $per_page ? (int) ceil(max(0, $total) / max(1, $per_page)) : 0;
            $response->header('X-WP-TotalPages', (string) $pages);
        }
        return $response;
    }

    /** @return array{0:int,1:int,2:int} */
    private function pagination(WP_REST_Request $request): array {
        $page = max(1, absint($request->get_param('page') ?: 1));
        $per_page = max(1, min(self::MAX_PAGE_SIZE, absint($request->get_param('per_page') ?: 25)));
        return [$page, $per_page, ($page - 1) * $per_page];
    }

    /** @return array<string,mixed> */
    private static function sanitize_metadata(mixed $value, int $depth = 0): array {
        if (!is_array($value) || $depth > 3) return [];
        $output = [];
        $blocked = ['password', 'pass', 'pwd', 'secret', 'token', 'authorization', 'cookie', 'card', 'cvv'];
        foreach (array_slice($value, 0, 50, true) as $key => $child) {
            $clean_key = sanitize_key((string) $key);
            if ($clean_key === '' || in_array($clean_key, $blocked, true)) continue;
            if (is_array($child)) {
                $output[$clean_key] = self::sanitize_metadata($child, $depth + 1);
            } elseif (is_bool($child) || is_int($child) || is_float($child)) {
                $output[$clean_key] = $child;
            } elseif (is_scalar($child)) {
                $output[$clean_key] = substr(sanitize_text_field((string) $child), 0, 1000);
            }
        }
        return $output;
    }

    private static function json(mixed $value): string {
        $encoded = wp_json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return is_string($encoded) ? $encoded : '{}';
    }

    private static function decode_json(mixed $value, mixed $default = []): mixed {
        if (!is_string($value) || $value === '') return $default;
        $decoded = json_decode($value, true);
        return json_last_error() === JSON_ERROR_NONE ? $decoded : $default;
    }

    private static function utc_now(): string {
        return current_time('mysql', true);
    }

    private static function sanitize_datetime(mixed $value, bool $nullable = true): string|WP_Error|null {
        $value = trim((string) $value);
        if ($value === '') return $nullable ? null : self::utc_now();
        $timestamp = strtotime($value);
        if ($timestamp === false) {
            return new WP_Error('kodety_members_datetime', 'Data inválida.', ['status' => 400]);
        }
        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    private static function sanitize_entitlement_key(string $value): string {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9._:-]+/', '-', $value) ?: '';
        return substr(trim($value, '-'), 0, 191);
    }

    /** Stable contract shared with the Builder's Membership plan keys. */
    private static function sanitize_plan_key(string $value): string {
        $value = function_exists('remove_accents') ? remove_accents($value) : $value;
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9._-]+/', '-', $value) ?: '';
        return substr(trim($value, '._-'), 0, 80);
    }

    private static function sanitize_provider(string $value): string {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9._-]+/', '-', $value) ?: '';
        return substr(trim($value, '-'), 0, 64);
    }

    private function can_manage_user(int $user_id): bool {
        if ($user_id <= 0 || !current_user_can('edit_user', $user_id)) return false;
        $target = get_user_by('id', $user_id);
        if (!$target instanceof WP_User) return false;
        if (user_can($target, 'manage_options') && !current_user_can('manage_options')) return false;
        return true;
    }

    /**
     * Evaluate a policy in the context of an explicitly opted-in project.
     *
     * @param array<string,mixed> $rule
     * @return array<string,mixed>
     */
    public static function evaluate_access(
        array $rule,
        ?int $user_id,
        string $project_key
    ): array {
        if (!self::extension_active()) {
            return [
                'allowed' => false,
                'valid' => false,
                'reason' => 'membership_extension_inactive',
                'projectKey' => self::sanitize_project_key($project_key),
            ];
        }
        if (!self::is_site_enabled()) {
            return [
                'allowed' => false,
                'valid' => true,
                'reason' => 'membership_disabled',
                'projectKey' => self::sanitize_project_key($project_key),
            ];
        }
        $project_key = self::sanitize_project_key($project_key);
        if ($project_key === '' || !self::is_project_enabled($project_key)) {
            return [
                'allowed' => false,
                'valid' => true,
                'reason' => 'project_not_enabled',
                'projectKey' => $project_key,
            ];
        }
        $user_id = $user_id ?? self::current_member_id();
        $claims = self::instance()->resolve_claims(max(0, $user_id));
        $decision = self::evaluate_snapshot($rule, $claims);
        $decision['projectKey'] = $project_key;
        $decision = apply_filters(
            'kodety_members_access_decision',
            $decision,
            $rule,
            $claims,
            $project_key
        );
        if (!is_array($decision) || !array_key_exists('allowed', $decision)) {
            return [
                'allowed' => false,
                'valid' => false,
                'reason' => 'invalid_decision_filter',
                'projectKey' => $project_key,
            ];
        }
        $decision['allowed'] = $decision['allowed'] === true;
        return $decision;
    }

    /** @param array<string,mixed> $rule */
    public static function user_can_access(
        array $rule,
        ?int $user_id,
        string $project_key
    ): bool {
        return self::evaluate_access($rule, $user_id, $project_key)['allowed'] === true;
    }

    /**
     * Small server-side rendering bridge. Page-level redirects and cache
     * headers remain the responsibility of the published theme runtime.
     *
     * @param array<string,mixed> $rule
     */
    public static function render_guarded_content(
        string $protected_html,
        string $fallback_html,
        array $rule,
        ?int $user_id,
        string $project_key
    ): string {
        $decision = self::evaluate_access($rule, $user_id, $project_key);
        if ($decision['allowed'] === true) return $protected_html;
        $denied = is_array($rule['denied'] ?? null) ? $rule['denied'] : [];
        $mode = sanitize_key((string) ($denied['mode'] ?? 'remove'));
        $html = $mode === 'replace' ? $fallback_html : '';
        $filtered = apply_filters(
            'kodety_members_denied_html',
            $html,
            $mode,
            $decision,
            $rule,
            $project_key
        );
        return is_string($filtered) ? $filtered : '';
    }

    /**
     * Pure evaluator used by runtime previews and isolated tests.
     *
     * @param array<string,mixed> $rule
     * @param array<string,mixed> $claims
     * @return array{allowed:bool,valid:bool,reason:string}
     */
    public static function evaluate_snapshot(array $rule, array $claims): array {
        $version = absint($rule['version'] ?? 1);
        if ($version !== 1) {
            return ['allowed' => false, 'valid' => false, 'reason' => 'unsupported_rule_version'];
        }
        $condition = isset($rule['requirement']) && is_array($rule['requirement'])
            ? $rule['requirement']
            : (isset($rule['when']) && is_array($rule['when']) ? $rule['when'] : $rule);
        unset($condition['version'], $condition['id'], $condition['denied'], $condition['anonymous']);
        $nodes = 0;
        $result = self::evaluate_condition($condition, $claims, 0, $nodes);
        if (!$result['valid']) {
            return ['allowed' => false, 'valid' => false, 'reason' => 'invalid_rule'];
        }
        return [
            'allowed' => $result['matched'],
            'valid' => true,
            'reason' => $result['matched'] ? 'allowed' : 'access_denied',
        ];
    }

    /**
     * @param array<string,mixed> $node
     * @param array<string,mixed> $claims
     * @return array{matched:bool,valid:bool}
     */
    private static function evaluate_condition(
        array $node,
        array $claims,
        int $depth,
        int &$nodes
    ): array {
        $nodes++;
        if ($depth > self::MAX_POLICY_DEPTH || $nodes > self::MAX_POLICY_NODES) {
            return ['matched' => false, 'valid' => false];
        }
        $operators = array_values(array_filter(
            ['all', 'any', 'not'],
            static fn(string $operator): bool => array_key_exists($operator, $node)
        ));
        if (count($operators) > 1) return ['matched' => false, 'valid' => false];

        if (array_key_exists('all', $node)) {
            if (!is_array($node['all']) || !$node['all']) return ['matched' => false, 'valid' => false];
            foreach ($node['all'] as $child) {
                if (!is_array($child)) return ['matched' => false, 'valid' => false];
                $result = self::evaluate_condition($child, $claims, $depth + 1, $nodes);
                if (!$result['valid']) return $result;
                if (!$result['matched']) return ['matched' => false, 'valid' => true];
            }
            return ['matched' => true, 'valid' => true];
        }
        if (array_key_exists('any', $node)) {
            if (!is_array($node['any']) || !$node['any']) return ['matched' => false, 'valid' => false];
            $matched = false;
            foreach ($node['any'] as $child) {
                if (!is_array($child)) return ['matched' => false, 'valid' => false];
                $result = self::evaluate_condition($child, $claims, $depth + 1, $nodes);
                if (!$result['valid']) return $result;
                $matched = $matched || $result['matched'];
            }
            return ['matched' => $matched, 'valid' => true];
        }
        if (array_key_exists('not', $node)) {
            if (!is_array($node['not'])) return ['matched' => false, 'valid' => false];
            $result = self::evaluate_condition($node['not'], $claims, $depth + 1, $nodes);
            return $result['valid']
                ? ['matched' => !$result['matched'], 'valid' => true]
                : $result;
        }

        $predicate = sanitize_key((string) ($node['predicate'] ?? $node['type'] ?? ''));
        $session_authenticated = !empty($claims['authenticated']);
        $account_active = sanitize_key((string) ($claims['accountStatus'] ?? 'active')) === 'active';
        $authenticated = $session_authenticated && $account_active;
        if ($predicate === 'public') return ['matched' => true, 'valid' => true];
        if ($predicate === 'authenticated') return ['matched' => $authenticated, 'valid' => true];
        if ($predicate === 'guest') return ['matched' => !$session_authenticated, 'valid' => true];

        if (in_array($predicate, ['plan', 'plans', 'has_plan'], true)) {
            if (!$authenticated) return ['matched' => false, 'valid' => true];
            $keys = self::policy_keys($node, 'plan');
            if (!$keys) return ['matched' => false, 'valid' => false];
            $plans = array_fill_keys(array_map('strval', (array) ($claims['plans'] ?? [])), true);
            $mode = sanitize_key((string) ($node['match'] ?? $node['mode'] ?? 'any'));
            if (!in_array($mode, ['any', 'all'], true)) return ['matched' => false, 'valid' => false];
            $matches = array_map(static fn(string $key): bool => isset($plans[$key]), $keys);
            return [
                'matched' => $mode === 'all' ? !in_array(false, $matches, true) : in_array(true, $matches, true),
                'valid' => true,
            ];
        }

        if (in_array($predicate, ['entitlement', 'entitlements', 'has_entitlement'], true)) {
            if (!$authenticated) return ['matched' => false, 'valid' => true];
            $keys = self::policy_keys($node, 'entitlement');
            if (!$keys) return ['matched' => false, 'valid' => false];
            $entitlements = is_array($claims['entitlements'] ?? null) ? $claims['entitlements'] : [];
            $mode = sanitize_key((string) ($node['match'] ?? $node['mode'] ?? 'any'));
            if (!in_array($mode, ['any', 'all'], true)) return ['matched' => false, 'valid' => false];
            $matches = array_map(
                static fn(string $key): bool => array_key_exists($key, $entitlements)
                    && $entitlements[$key] !== false
                    && $entitlements[$key] !== null,
                $keys
            );
            return [
                'matched' => $mode === 'all' ? !in_array(false, $matches, true) : in_array(true, $matches, true),
                'valid' => true,
            ];
        }

        if ($predicate === 'subscription_status') {
            if (!$authenticated) return ['matched' => false, 'valid' => true];
            $keys = self::policy_keys($node, 'status');
            if (!$keys) return ['matched' => false, 'valid' => false];
            $statuses = array_fill_keys(
                array_map('sanitize_key', (array) ($claims['subscriptionStatuses'] ?? [])),
                true
            );
            foreach ($keys as $key) {
                if (isset($statuses[$key])) return ['matched' => true, 'valid' => true];
            }
            return ['matched' => false, 'valid' => true];
        }

        return ['matched' => false, 'valid' => false];
    }

    /** @param array<string,mixed> $node
     *  @return list<string>
     */
    private static function policy_keys(array $node, string $kind = 'entitlement'): array {
        if (isset($node['planKeys']) && is_array($node['planKeys'])) {
            $raw = $node['planKeys'];
        } elseif (isset($node['entitlementKeys']) && is_array($node['entitlementKeys'])) {
            $raw = $node['entitlementKeys'];
        } elseif (isset($node['statuses']) && is_array($node['statuses'])) {
            $raw = $node['statuses'];
        } elseif (isset($node['keys']) && is_array($node['keys'])) {
            $raw = $node['keys'];
        } else {
            $raw = [$node['key'] ?? $node['value'] ?? ''];
        }
        $keys = [];
        foreach (array_slice($raw, 0, 100) as $key) {
            $clean = match ($kind) {
                'plan' => self::sanitize_plan_key((string) $key),
                'status' => sanitize_key((string) $key),
                default => self::sanitize_entitlement_key((string) $key),
            };
            if ($clean !== '') $keys[$clean] = $clean;
        }
        return array_values($keys);
    }

    /** @return array<string,mixed> */
    public function resolve_claims(int $user_id): array {
        if ($user_id <= 0 || !(get_user_by('id', $user_id) instanceof WP_User)) {
            return [
                'authenticated' => false,
                'accountStatus' => 'guest',
                'userId' => 0,
                'plans' => [],
                'entitlements' => [],
                'subscriptionStatuses' => [],
                'expiresAt' => null,
                'revision' => 0,
                'catalogRevision' => max(0, (int) get_option('kodety_membership_catalog_revision', 0)),
            ];
        }
        $account_status = sanitize_key((string) get_user_meta($user_id, '_kodety_membership_status', true));
        if (!in_array($account_status, ['active', 'invited', 'suspended'], true)) $account_status = 'active';
        $revision = max(0, (int) get_user_meta($user_id, '_kodety_membership_revision', true));
        $catalog_revision = max(0, (int) get_option('kodety_membership_catalog_revision', 0));
        $cache_key = $user_id . ':' . $revision . ':' . $catalog_revision;
        if (isset($this->request_claims[$cache_key])) return $this->request_claims[$cache_key];

        global $wpdb;
        $now = self::utc_now();
        $plans = [];
        $entitlements = [];
        $statuses = [];
        $plan_ids = [];
        $expires_at = null;

        $grant_rows = $wpdb->get_results($wpdb->prepare(
            'SELECT g.plan_id,g.entitlement_id,g.ends_at,p.slug AS plan_slug,p.status AS plan_status,
                    e.entitlement_key,e.status AS entitlement_status
             FROM ' . self::table_name('grants') . ' g
             LEFT JOIN ' . self::table_name('plans') . ' p ON p.id=g.plan_id
             LEFT JOIN ' . self::table_name('entitlements') . ' e ON e.id=g.entitlement_id
             WHERE g.user_id=%d AND g.status=%s AND g.starts_at<=%s
             AND (g.ends_at IS NULL OR g.ends_at>%s)',
            $user_id,
            'active',
            $now,
            $now
        ), ARRAY_A);
        foreach ($grant_rows ?: [] as $grant) {
            $contributed = false;
            $plan_id = absint($grant['plan_id'] ?? 0);
            $plan_slug = self::sanitize_plan_key((string) ($grant['plan_slug'] ?? ''));
            $entitlement_key = self::sanitize_entitlement_key((string) ($grant['entitlement_key'] ?? ''));
            if ($plan_id && $plan_slug !== '' && ($grant['plan_status'] ?? '') === 'active') {
                $plan_ids[$plan_id] = $plan_id;
                $plans[$plan_slug] = $plan_slug;
                $contributed = true;
            }
            if ($entitlement_key !== '' && ($grant['entitlement_status'] ?? '') === 'active') {
                $entitlements[$entitlement_key] = true;
                $contributed = true;
            }
            if ($contributed) $expires_at = self::earliest_expiry($expires_at, $grant['ends_at'] ?? null);
        }

        $subscription_rows = $wpdb->get_results($wpdb->prepare(
            'SELECT s.plan_id,s.status,s.started_at,s.trial_ends_at,
                    s.current_period_start,s.current_period_end,s.grace_ends_at,s.ended_at,
                    p.slug AS plan_slug
             FROM ' . self::table_name('subscriptions') . ' s
             INNER JOIN ' . self::table_name('plans') . ' p ON p.id=s.plan_id AND p.status=\'active\'
             WHERE s.user_id=%d
             AND s.status IN (%s,%s,%s)
             AND (s.ended_at IS NULL OR s.ended_at>%s)',
            $user_id,
            'trialing',
            'active',
            'past_due',
            $now
        ), ARRAY_A);
        foreach ($subscription_rows ?: [] as $subscription) {
            $status = sanitize_key((string) ($subscription['status'] ?? ''));
            $has_access = in_array($status, self::ACCESS_SUBSCRIPTION_STATUSES, true);
            $started_at = (string) ($subscription['started_at'] ?? '');
            $period_start = (string) ($subscription['current_period_start'] ?? '');
            $has_started = !(
                ($started_at !== '' && $started_at > $now)
                || ($period_start !== '' && $period_start > $now)
            );
            if (!$has_started) $has_access = false;
            if ($status === 'trialing') {
                $trial_end = (string) ($subscription['trial_ends_at'] ?? '');
                if ($trial_end === '' || $trial_end <= $now) $has_access = false;
            }
            if ($status === 'active') {
                $period_end = (string) ($subscription['current_period_end'] ?? '');
                if ($period_end !== '' && $period_end <= $now) $has_access = false;
            }
            if ($status === 'past_due') {
                $grace = (string) ($subscription['grace_ends_at'] ?? '');
                $has_access = $has_started && $grace !== '' && $grace > $now;
            }
            if (!$has_access) continue;
            $plan_id = absint($subscription['plan_id'] ?? 0);
            $plan_slug = self::sanitize_plan_key((string) ($subscription['plan_slug'] ?? ''));
            if ($plan_id && $plan_slug !== '') {
                $plan_ids[$plan_id] = $plan_id;
                $plans[$plan_slug] = $plan_slug;
            }
            $statuses[$status] = $status;
            $expiry = $status === 'past_due'
                ? ($subscription['grace_ends_at'] ?? null)
                : ($status === 'trialing'
                    ? ($subscription['trial_ends_at'] ?? null)
                    : ($subscription['current_period_end'] ?? null));
            $expires_at = self::earliest_expiry($expires_at, $expiry);
        }

        if ($plan_ids) {
            $ids = array_values($plan_ids);
            $placeholders = implode(',', array_fill(0, count($ids), '%d'));
            $rows = $wpdb->get_results($wpdb->prepare(
                'SELECT pe.value_json,e.entitlement_key
                 FROM ' . self::table_name('plan_entitlements') . ' pe
                 INNER JOIN ' . self::table_name('entitlements') . ' e ON e.id=pe.entitlement_id AND e.status=\'active\'
                 WHERE pe.plan_id IN (' . $placeholders . ')
                 ORDER BY e.entitlement_key ASC,pe.plan_id ASC',
                ...$ids
            ), ARRAY_A);
            foreach ($rows ?: [] as $row) {
                $key = self::sanitize_entitlement_key((string) ($row['entitlement_key'] ?? ''));
                // A member can hold multiple plans that define the same
                // entitlement. Lowest plan id wins deterministically.
                if ($key === '' || array_key_exists($key, $entitlements)) continue;
                $value = self::decode_json($row['value_json'] ?? '', true);
                $entitlements[$key] = $value === null ? true : $value;
            }
        }

        ksort($plans);
        ksort($entitlements);
        ksort($statuses);
        $claims = [
            'authenticated' => true,
            'accountStatus' => $account_status,
            'userId' => $user_id,
            'plans' => array_values($plans),
            'entitlements' => $entitlements,
            'subscriptionStatuses' => array_values($statuses),
            'expiresAt' => $expires_at ? gmdate('c', strtotime($expires_at)) : null,
            'revision' => $revision,
            'catalogRevision' => $catalog_revision,
        ];
        $filtered = apply_filters('kodety_members_resolved_claims', $claims, $user_id);
        $this->request_claims[$cache_key] = is_array($filtered) ? $filtered : $claims;
        return $this->request_claims[$cache_key];
    }

    private static function earliest_expiry(?string $current, mixed $candidate): ?string {
        $candidate = trim((string) $candidate);
        if ($candidate === '') return $current;
        if ($current === null || $candidate < $current) return $candidate;
        return $current;
    }

    private function bump_user_revision(int $user_id): int {
        $revision = max(0, (int) get_user_meta($user_id, '_kodety_membership_revision', true)) + 1;
        update_user_meta($user_id, '_kodety_membership_revision', $revision);
        $this->forget_user_claims($user_id);
        do_action('kodety_membership_revision_changed', $user_id, $revision);
        return $revision;
    }

    private function forget_user_claims(int $user_id): void {
        foreach (array_keys($this->request_claims) as $key) {
            if (str_starts_with($key, $user_id . ':')) unset($this->request_claims[$key]);
        }
    }

    public function login(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $challenge = $this->consume_auth_challenge($request);
        if (is_wp_error($challenge)) return $challenge;
        $identifier = trim((string) $request->get_param('login'));
        $password = (string) $request->get_param('password');
        $fingerprint = $this->request_fingerprint();
        $ip_limit = $this->rate_limit('login-ip', $fingerprint, 20, 15 * MINUTE_IN_SECONDS);
        if (is_wp_error($ip_limit)) return $ip_limit;
        $account_hash = hash_hmac('sha256', strtolower($identifier), wp_salt('nonce'));
        $account_limit = $this->rate_limit('login-account', $account_hash, 8, 15 * MINUTE_IN_SECONDS);
        if (is_wp_error($account_limit)) return $account_limit;
        if ($identifier === '' || $password === '' || strlen($identifier) > 320 || strlen($password) > 4096) {
            return new WP_Error('kodety_members_login_failed', 'Não foi possível entrar.', ['status' => 401]);
        }
        $this->member_authentication_in_progress = true;
        try {
            // wp_authenticate validates credentials without issuing or replacing
            // the native WordPress authentication cookie.
            $user = wp_authenticate($identifier, $password);
        } finally {
            $this->member_authentication_in_progress = false;
        }
        if (
            is_wp_error($user)
            || !$user instanceof WP_User
            || !self::is_public_member_login_candidate($user)
        ) {
            return new WP_Error('kodety_members_login_failed', 'Não foi possível entrar.', ['status' => 401]);
        }
        if (sanitize_key((string) get_user_meta(
            $user->ID,
            '_kodety_membership_status',
            true
        )) === '') {
            // Compatibility migration for accounts created by the first
            // membership runtime, which did not mark self-registrations.
            update_user_meta($user->ID, '_kodety_membership_status', 'active');
        }
        $session = $this->start_member_session(
            $user,
            rest_sanitize_boolean($request->get_param('remember'))
        );
        if (is_wp_error($session)) return $session;
        return $this->response(array_merge([
            'authenticated' => true,
            'user' => $this->public_user($user),
            'claims' => $this->resolve_claims($user->ID),
        ], $session));
    }

    public function register(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $challenge = $this->consume_auth_challenge($request);
        if (is_wp_error($challenge)) return $challenge;
        $settings = self::settings();
        if (empty($settings['registration_enabled'])) {
            return new WP_Error('kodety_members_registration_closed', 'Cadastros estão fechados.', ['status' => 403]);
        }
        $limited = $this->rate_limit('register', $this->request_fingerprint(), 6, HOUR_IN_SECONDS);
        if (is_wp_error($limited)) return $limited;
        $email = sanitize_email((string) $request->get_param('email'));
        $password = (string) $request->get_param('password');
        $display_name = substr(sanitize_text_field((string) $request->get_param('displayName')), 0, 191);
        if (!is_email($email) || strlen($password) < 12 || strlen($password) > 4096) {
            return new WP_Error('kodety_members_registration_failed', 'Não foi possível concluir o cadastro.', ['status' => 400]);
        }
        if (email_exists($email)) {
            return new WP_Error('kodety_members_registration_failed', 'Não foi possível concluir o cadastro.', ['status' => 400]);
        }
        $base = sanitize_user((string) strtok($email, '@'), true);
        if ($base === '') $base = 'member';
        $username = $base;
        for ($attempt = 0; $attempt < 5 && username_exists($username); $attempt++) {
            $username = substr($base, 0, 48) . '-' . strtolower(wp_generate_password(6, false, false));
        }
        if (username_exists($username)) {
            return new WP_Error('kodety_members_registration_failed', 'Não foi possível concluir o cadastro.', ['status' => 400]);
        }
        $member_role = self::validated_public_member_role();
        if (is_wp_error($member_role)) return $member_role;
        $user_id = wp_insert_user([
            'user_login' => $username,
            'user_email' => $email,
            'user_pass' => $password,
            'display_name' => $display_name !== '' ? $display_name : $username,
            'role' => $member_role,
        ]);
        if (is_wp_error($user_id)) {
            return new WP_Error('kodety_members_registration_failed', 'Não foi possível concluir o cadastro.', ['status' => 400]);
        }
        $user = get_user_by('id', (int) $user_id);
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_registration_failed', 'Não foi possível concluir o cadastro.', ['status' => 500]);
        }
        update_user_meta($user->ID, '_kodety_membership_status', 'active');
        $this->audit('member.registered', 'user', (string) $user->ID, [], [
            'userId' => $user->ID,
        ], $user->ID, $user->ID);
        do_action('kodety_member_registered', $user->ID, $user);
        $session = $this->start_member_session($user, false);
        if (is_wp_error($session)) {
            $this->audit(
                'member.session_failed',
                'user',
                (string) $user->ID,
                [],
                ['registered' => true],
                $user->ID,
                $user->ID
            );
            return new WP_Error(
                'kodety_members_registration_session',
                'A conta foi criada, mas a sessão não pôde ser iniciada. Entre para continuar.',
                ['status' => 503, 'registrationCompleted' => true]
            );
        }
        return $this->response(array_merge([
            'authenticated' => true,
            'user' => $this->public_user($user),
            'claims' => $this->resolve_claims($user->ID),
        ], $session), 201);
    }

    public function forgot_password(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $challenge = $this->consume_auth_challenge($request);
        if (is_wp_error($challenge)) return $challenge;
        $identifier = trim((string) $request->get_param('login'));
        $limited = $this->rate_limit(
            'forgot',
            $this->request_fingerprint() . '|' . hash('sha256', strtolower($identifier)),
            5,
            HOUR_IN_SECONDS
        );
        if (is_wp_error($limited)) return $limited;
        $reset_url = trim((string) (self::settings()['reset_page_url'] ?? ''));
        if ($identifier !== '' && strlen($identifier) <= 320 && $reset_url !== '') {
            $user = is_email($identifier)
                ? get_user_by('email', sanitize_email($identifier))
                : get_user_by('login', $identifier);
            if ($user instanceof WP_User && self::is_public_member_reset_candidate($user)) {
                retrieve_password((string) $user->user_login);
            }
        }
        return $this->response([
            'accepted' => true,
            'message' => 'Se a conta existir, as instruções serão enviadas.',
        ], 202);
    }

    public function reset_password(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $challenge = $this->consume_auth_challenge($request);
        if (is_wp_error($challenge)) return $challenge;
        $limited = $this->rate_limit('reset', $this->request_fingerprint(), 8, HOUR_IN_SECONDS);
        if (is_wp_error($limited)) return $limited;
        $login = trim((string) $request->get_param('login'));
        $key = trim((string) $request->get_param('key'));
        $password = (string) $request->get_param('password');
        if (strlen($password) < 12 || strlen($password) > 4096) {
            return new WP_Error('kodety_members_reset_failed', 'Não foi possível redefinir a senha.', ['status' => 400]);
        }
        if ($login === '' || $key === '') {
            $exchange = $this->consume_password_reset_exchange();
            $login = trim((string) ($exchange['login'] ?? ''));
            $key = trim((string) ($exchange['key'] ?? ''));
        }
        if ($login === '' || $key === '') {
            return new WP_Error('kodety_members_reset_failed', 'Não foi possível redefinir a senha.', ['status' => 400]);
        }
        $user = check_password_reset_key($key, $login);
        if (
            is_wp_error($user)
            || !$user instanceof WP_User
            || !self::is_public_member_reset_candidate($user)
        ) {
            return new WP_Error('kodety_members_reset_failed', 'Não foi possível redefinir a senha.', ['status' => 400]);
        }
        reset_password($user, $password);
        return $this->response(['reset' => true]);
    }

    /**
     * Exchange reset credentials for a short-lived HttpOnly handle before any
     * authored page script or analytics code can observe them in location.href.
     */
    public function capture_password_reset_exchange(): void {
        if (
            headers_sent()
            || strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET'
            || empty($_GET['key'])
            || empty($_GET['login'])
            || !self::is_current_project_enabled()
        ) {
            return;
        }
        $reset_url = trim((string) (self::settings()['reset_page_url'] ?? ''));
        if ($reset_url === '') return;
        $request_path = (string) wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        $reset_path = (string) wp_parse_url($reset_url, PHP_URL_PATH);
        if (
            $request_path === ''
            || $reset_path === ''
            || untrailingslashit($request_path) !== untrailingslashit($reset_path)
        ) {
            return;
        }
        $key = trim((string) wp_unslash($_GET['key']));
        $login = trim((string) wp_unslash($_GET['login']));
        if (
            $key === ''
            || $login === ''
            || strlen($key) > 256
            || strlen($login) > 320
            || preg_match('/[\x00-\x1f\x7f]/', $key . $login)
        ) {
            return;
        }
        $fingerprint = $this->request_fingerprint();
        $ip_limit = $this->rate_limit(
            'reset-exchange-ip',
            $fingerprint,
            10,
            HOUR_IN_SECONDS
        );
        if (is_wp_error($ip_limit)) return;
        $account_limit = $this->rate_limit(
            'reset-exchange-account',
            hash_hmac('sha256', strtolower($login), wp_salt('nonce')),
            5,
            HOUR_IN_SECONDS
        );
        if (is_wp_error($account_limit)) return;
        $user = check_password_reset_key($key, $login);
        if (
            is_wp_error($user)
            || !$user instanceof WP_User
            || !self::is_public_member_reset_candidate($user)
        ) return;
        try {
            $handle = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        } catch (Throwable) {
            return;
        }
        if (!set_transient(
            'kodety_members_reset_' . hash('sha256', $handle),
            [
                'key' => $key,
                'login' => (string) $user->user_login,
                'fingerprint' => $fingerprint,
            ],
            15 * MINUTE_IN_SECONDS
        )) return;
        $cookie_set = setcookie(
            self::RESET_EXCHANGE_COOKIE,
            $handle,
            $this->reset_exchange_cookie_options(time() + 15 * MINUTE_IN_SECONDS)
        );
        if (!$cookie_set) {
            delete_transient('kodety_members_reset_' . hash('sha256', $handle));
            return;
        }
        $clean = remove_query_arg(['key', 'login'], (string) ($_SERVER['REQUEST_URI'] ?? '/'));
        if (wp_safe_redirect($clean, 302, 'Onun Kodety Membership Reset')) exit;
    }

    /** @return array{expires:int,path:string,secure:bool,httponly:bool,samesite:string} */
    private function reset_exchange_cookie_options(int $expires): array {
        // Deliberately omit Domain. A host-only bearer cookie cannot be read by
        // sibling subdomains even when WordPress uses a broad COOKIE_DOMAIN.
        $home_scheme = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_SCHEME));
        return [
            'expires' => $expires,
            'path' => defined('COOKIEPATH') && COOKIEPATH ? COOKIEPATH : '/',
            'secure' => is_ssl() || $home_scheme === 'https',
            'httponly' => true,
            'samesite' => 'Lax',
        ];
    }

    /** @return array{key?:string,login?:string} */
    private function consume_password_reset_exchange(): array {
        $handle = trim((string) ($_COOKIE[self::RESET_EXCHANGE_COOKIE] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_-]{40,64}$/', $handle)) return [];
        $transient = 'kodety_members_reset_' . hash('sha256', $handle);
        $lock = $this->acquire_security_lock('password-reset', $transient);
        if (!is_resource($lock)) return [];
        try {
            $exchange = get_transient($transient);
            delete_transient($transient);
        } finally {
            $this->release_security_lock($lock);
        }
        if (!headers_sent()) {
            setcookie(
                self::RESET_EXCHANGE_COOKIE,
                '',
                $this->reset_exchange_cookie_options(time() - HOUR_IN_SECONDS)
            );
        }
        if (
            !is_array($exchange)
            || !is_string($exchange['fingerprint'] ?? null)
            || !hash_equals($exchange['fingerprint'], $this->request_fingerprint())
        ) return [];
        return [
            'key' => substr(trim((string) ($exchange['key'] ?? '')), 0, 256),
            'login' => substr(trim((string) ($exchange['login'] ?? '')), 0, 320),
        ];
    }

    public function logout(WP_REST_Request $request): WP_REST_Response {
        $this->destroy_current_member_session();
        return $this->response(['authenticated' => false]);
    }

    public function get_me(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user = $this->member_session_user();
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_auth_required', 'Autenticação necessária.', ['status' => 401]);
        }
        return $this->response([
            'authenticated' => true,
            'user' => $this->public_user($user),
            'claims' => $this->resolve_claims($user->ID),
        ]);
    }

    public function update_me(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user = $this->member_session_user();
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_auth_required', 'Autenticação necessária.', ['status' => 401]);
        }
        $data = ['ID' => $user->ID];
        foreach ([
            'displayName' => 'display_name',
            'firstName' => 'first_name',
            'lastName' => 'last_name',
        ] as $input => $field) {
            if ($request->get_param($input) !== null) {
                $data[$field] = substr(sanitize_text_field((string) $request->get_param($input)), 0, 191);
            }
        }
        if (count($data) === 1) {
            return new WP_Error('kodety_members_profile_empty', 'Nenhuma alteração válida.', ['status' => 400]);
        }
        $updated = wp_update_user($data);
        if (is_wp_error($updated)) {
            return new WP_Error('kodety_members_profile_failed', 'Não foi possível atualizar o perfil.', ['status' => 400]);
        }
        $fresh = get_user_by('id', $user->ID);
        return $this->response([
            'user' => $fresh instanceof WP_User ? $this->public_user($fresh) : $this->public_user($user),
        ]);
    }

    /** @return array<string,mixed> */
    private function public_user(WP_User $user): array {
        return [
            'id' => (int) $user->ID,
            'displayName' => (string) $user->display_name,
            'firstName' => (string) $user->first_name,
            'lastName' => (string) $user->last_name,
            'email' => (string) $user->user_email,
            'avatarUrl' => (string) get_avatar_url($user->ID, ['size' => 96]),
        ];
    }

    public function get_settings(WP_REST_Request $request): WP_REST_Response {
        return $this->response(self::format_settings(self::settings()));
    }

    public function filter_password_reset_message(
        string $message,
        string $key,
        string $user_login,
        WP_User $user
    ): string {
        if (
            !self::is_current_project_enabled()
            || !self::is_public_member_reset_candidate($user)
        ) return $message;
        $reset_url = (string) (self::settings()['reset_page_url'] ?? '');
        if ($reset_url === '') {
            return "Foi solicitada uma redefinição de senha para sua conta.\r\n\r\n"
                . "A página de redefinição ainda não foi configurada. Entre em contato com o site.\r\n";
        }
        $custom_url = add_query_arg([
            'key' => $key,
            'login' => $user_login,
        ], $reset_url);
        return "Foi solicitada uma redefinição de senha para sua conta.\r\n\r\n"
            . "Redefina sua senha nesta página:\r\n"
            . esc_url_raw($custom_url, ['https', 'http']) . "\r\n\r\n"
            . "Se você não fez esta solicitação, ignore esta mensagem.\r\n";
    }

    public function record_login(string $user_login, WP_User $user): void {
        if (
            !self::is_current_project_enabled()
            || !self::is_public_member_account($user)
        ) return;
        update_user_meta($user->ID, '_kodety_membership_last_login_at', self::utc_now());
        if (sanitize_key((string) get_user_meta($user->ID, '_kodety_membership_status', true)) === 'invited') {
            update_user_meta($user->ID, '_kodety_membership_status', 'active');
            $this->bump_user_revision($user->ID);
        }
    }

    public function update_settings(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $raw = $request->get_json_params();
        if (!is_array($raw)) $raw = $request->get_params();
        if (!is_array($raw)) {
            return new WP_Error('kodety_members_settings', 'Configuração inválida.', ['status' => 400]);
        }
        $before = self::settings();
        $aliases = [
            'registrationEnabled' => 'registration_enabled',
            'allowRegistration' => 'registration_enabled',
            'requireEmailVerification' => 'require_email_verification',
            'enabledProjects' => 'enabled_projects',
            'defaultRole' => 'default_role',
            'loginPageUrl' => 'login_page_url',
            'accountPageUrl' => 'account_page_url',
            'upgradePageUrl' => 'upgrade_page_url',
            'resetPageUrl' => 'reset_page_url',
            'afterLoginUrl' => 'after_login_url',
            'afterLogoutUrl' => 'after_logout_url',
            'auditRetentionDays' => 'audit_retention_days',
            'eventRetentionDays' => 'event_retention_days',
        ];
        foreach ($aliases as $camel => $snake) {
            if (array_key_exists($camel, $raw)) $raw[$snake] = $raw[$camel];
        }
        // Project opt-in is a separate, project-scoped operation. A stale
        // settings form must never activate, deactivate or overwrite another
        // Builder project's authorization list.
        unset($raw['enabled'], $raw['enabledProjects'], $raw['enabled_projects']);
        $settings = self::sanitize_settings(array_merge($before, $raw));
        if (!update_option(self::OPTION_SETTINGS, $settings, false) && $settings !== $before) {
            return new WP_Error('kodety_members_storage', 'Não foi possível salvar a configuração.', ['status' => 500]);
        }
        $this->audit('settings.updated', 'settings', 'membership', $before, $settings);
        do_action('kodety_members_settings_updated', $settings, $before);
        return $this->response(self::format_settings($settings));
    }

    /** @param array<string,mixed> $settings
     *  @return array<string,mixed>
     */
    private static function format_settings(array $settings): array {
        return [
            'enabled' => !empty($settings['enabled']),
            'registrationEnabled' => !empty($settings['registration_enabled']),
            'allowRegistration' => !empty($settings['registration_enabled']),
            'requireEmailVerification' => false,
            'enabledProjects' => array_values((array) ($settings['enabled_projects'] ?? [])),
            'defaultRole' => (string) ($settings['default_role'] ?? 'subscriber'),
            'loginPageUrl' => (string) ($settings['login_page_url'] ?? ''),
            'accountPageUrl' => (string) ($settings['account_page_url'] ?? ''),
            'upgradePageUrl' => (string) ($settings['upgrade_page_url'] ?? ''),
            'resetPageUrl' => (string) ($settings['reset_page_url'] ?? ''),
            'afterLoginUrl' => (string) ($settings['after_login_url'] ?? ''),
            'afterLogoutUrl' => (string) ($settings['after_logout_url'] ?? ''),
            'auditRetentionDays' => absint($settings['audit_retention_days'] ?? 730),
            'eventRetentionDays' => absint($settings['event_retention_days'] ?? 365),
        ];
    }

    public function list_plans(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $status = sanitize_key((string) $request->get_param('status'));
        $search = substr(sanitize_text_field((string) $request->get_param('search')), 0, 191);
        $where = ['1=1'];
        $arguments = [];
        if (in_array($status, self::PLAN_STATUSES, true)) {
            $where[] = 'status=%s';
            $arguments[] = $status;
        }
        if ($search !== '') {
            $like = '%' . $wpdb->esc_like($search) . '%';
            $where[] = '(name LIKE %s OR slug LIKE %s)';
            $arguments[] = $like;
            $arguments[] = $like;
        }
        $where_sql = implode(' AND ', $where);
        $table = self::table_name('plans');
        $count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}";
        $rows_sql = "SELECT * FROM {$table} WHERE {$where_sql} ORDER BY updated_at DESC,id DESC LIMIT %d OFFSET %d";
        $total = (int) $wpdb->get_var($arguments ? $wpdb->prepare($count_sql, ...$arguments) : $count_sql);
        $rows_arguments = [...$arguments, $per_page, $offset];
        $rows = $wpdb->get_results($wpdb->prepare($rows_sql, ...$rows_arguments), ARRAY_A);
        $rows = $rows ?: [];
        $member_counts = $this->active_plan_member_counts(array_map(
            static fn(array $row): int => absint($row['id'] ?? 0),
            $rows
        ));
        foreach ($rows as &$row) $row['member_count'] = $member_counts[absint($row['id'] ?? 0)] ?? 0;
        unset($row);
        return $this->response([
            'items' => array_map([$this, 'format_plan'], $rows),
            'page' => $page,
            'perPage' => $per_page,
        ], 200, $total, $per_page);
    }

    public function create_plan(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $raw = $this->request_payload($request);
        $name = substr(sanitize_text_field((string) ($raw['name'] ?? '')), 0, 191);
        $slug = self::sanitize_plan_key((string) ($raw['slug'] ?? $raw['key'] ?? $name));
        if ($name === '' || $slug === '') {
            return new WP_Error('kodety_members_plan_invalid', 'Nome e slug são obrigatórios.', ['status' => 400]);
        }
        if ($wpdb->get_var($wpdb->prepare(
            'SELECT id FROM ' . self::table_name('plans') . ' WHERE slug=%s',
            $slug
        ))) {
            return new WP_Error('kodety_members_plan_conflict', 'Já existe um plano com este slug.', ['status' => 409]);
        }
        $now = self::utc_now();
        $status = sanitize_key((string) ($raw['status'] ?? 'active'));
        if (!in_array($status, self::PLAN_STATUSES, true)) $status = 'active';
        $metadata = self::sanitize_metadata($raw['metadata'] ?? []);
        if (array_key_exists('upgradeUrl', $raw)) {
            $metadata['upgradeurl'] = self::sanitize_navigation_url($raw['upgradeUrl'], true);
        }
        foreach (['provider', 'externalId'] as $field) {
            if (array_key_exists($field, $raw)) {
                $metadata[sanitize_key($field)] = substr(sanitize_text_field((string) $raw[$field]), 0, 1000);
            }
        }
        $row = [
            'uuid' => wp_generate_uuid4(),
            'slug' => $slug,
            'name' => $name,
            'description' => substr(sanitize_textarea_field((string) ($raw['description'] ?? '')), 0, 10000),
            'status' => $status,
            'visibility' => in_array(($visibility = sanitize_key((string) ($raw['visibility'] ?? 'private'))), ['public', 'private'], true)
                ? $visibility
                : 'private',
            'metadata' => self::json($metadata),
            'created_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ];
        if (!$wpdb->insert(self::table_name('plans'), $row)) {
            return new WP_Error('kodety_members_storage', 'Não foi possível criar o plano.', ['status' => 500]);
        }
        $id = (int) $wpdb->insert_id;
        $created = $this->plan_row($id);
        $this->audit('plan.created', 'plan', (string) $id, [], $created ?: $row);
        do_action('kodety_members_plan_changed', $id, 'created');
        return $this->response($this->format_plan($created ?: array_merge($row, ['id' => $id])), 201);
    }

    public function get_plan(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = absint($request['id']);
        $row = $this->plan_row($id);
        if (!$row) return new WP_Error('kodety_members_plan_not_found', 'Plano não encontrado.', ['status' => 404]);
        $row['member_count'] = $this->active_plan_member_counts([$id])[$id] ?? 0;
        $plan = $this->format_plan($row);
        $plan['entitlements'] = $this->plan_entitlement_rows($id);
        return $this->response($plan);
    }

    public function update_plan(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = absint($request['id']);
        $before = $this->plan_row($id);
        if (!$before) return new WP_Error('kodety_members_plan_not_found', 'Plano não encontrado.', ['status' => 404]);
        $raw = $this->request_payload($request);
        $requested_slug = $raw['slug'] ?? $raw['key'] ?? null;
        if (
            $requested_slug !== null
            && self::sanitize_plan_key((string) $requested_slug)
                !== self::sanitize_plan_key((string) $before['slug'])
        ) {
            return new WP_Error(
                'kodety_members_plan_slug_immutable',
                'O slug do plano é estável e não pode ser alterado.',
                ['status' => 409]
            );
        }
        $update = ['updated_at' => self::utc_now()];
        if (array_key_exists('name', $raw)) {
            $name = substr(sanitize_text_field((string) $raw['name']), 0, 191);
            if ($name === '') return new WP_Error('kodety_members_plan_invalid', 'Nome obrigatório.', ['status' => 400]);
            $update['name'] = $name;
        }
        if (array_key_exists('description', $raw)) {
            $update['description'] = substr(sanitize_textarea_field((string) $raw['description']), 0, 10000);
        }
        if (array_key_exists('status', $raw)) {
            $status = sanitize_key((string) $raw['status']);
            if (!in_array($status, self::PLAN_STATUSES, true)) {
                return new WP_Error('kodety_members_plan_status', 'Status de plano inválido.', ['status' => 400]);
            }
            $update['status'] = $status;
        }
        if (array_key_exists('visibility', $raw)) {
            $visibility = sanitize_key((string) $raw['visibility']);
            if (!in_array($visibility, ['public', 'private'], true)) {
                return new WP_Error('kodety_members_plan_visibility', 'Visibilidade inválida.', ['status' => 400]);
            }
            $update['visibility'] = $visibility;
        }
        if (
            array_key_exists('metadata', $raw)
            || array_key_exists('upgradeUrl', $raw)
            || array_key_exists('provider', $raw)
            || array_key_exists('externalId', $raw)
        ) {
            $metadata = self::sanitize_metadata(self::decode_json($before['metadata'] ?? '', []));
            if (array_key_exists('metadata', $raw)) {
                $metadata = array_merge($metadata, self::sanitize_metadata($raw['metadata']));
            }
            if (array_key_exists('upgradeUrl', $raw)) {
                $metadata['upgradeurl'] = self::sanitize_navigation_url($raw['upgradeUrl'], true);
            }
            foreach (['provider', 'externalId'] as $field) {
                if (array_key_exists($field, $raw)) {
                    $metadata[sanitize_key($field)] = substr(sanitize_text_field((string) $raw[$field]), 0, 1000);
                }
            }
            $update['metadata'] = self::json($metadata);
        }
        if ($wpdb->update(self::table_name('plans'), $update, ['id' => $id]) === false) {
            return new WP_Error('kodety_members_storage', 'Não foi possível atualizar o plano.', ['status' => 500]);
        }
        $after = $this->plan_row($id);
        $this->audit('plan.updated', 'plan', (string) $id, $before, $after ?: $update);
        $this->invalidate_plan_users($id);
        do_action('kodety_members_plan_changed', $id, 'updated');
        return $this->response($this->format_plan($after ?: array_merge($before, $update)));
    }

    public function archive_plan(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = absint($request['id']);
        $before = $this->plan_row($id);
        if (!$before) return new WP_Error('kodety_members_plan_not_found', 'Plano não encontrado.', ['status' => 404]);
        if ($wpdb->update(
            self::table_name('plans'),
            ['status' => 'archived', 'updated_at' => self::utc_now()],
            ['id' => $id]
        ) === false) {
            return new WP_Error('kodety_members_storage', 'Não foi possível arquivar o plano.', ['status' => 500]);
        }
        $after = $this->plan_row($id);
        $this->audit('plan.archived', 'plan', (string) $id, $before, $after ?: []);
        $this->invalidate_plan_users($id);
        do_action('kodety_members_plan_changed', $id, 'archived');
        return $this->response($this->format_plan($after ?: array_merge($before, ['status' => 'archived'])));
    }

    /** @return array<string,mixed>|null */
    private function plan_row(int $id): ?array {
        global $wpdb;
        if ($id <= 0) return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table_name('plans') . ' WHERE id=%d',
            $id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /** @param list<int> $plan_ids
     *  @return array<int,int>
     */
    private function active_plan_member_counts(array $plan_ids): array {
        global $wpdb;
        $plan_ids = array_values(array_unique(array_filter(array_map('absint', $plan_ids))));
        if (!$plan_ids) return [];
        $placeholders = implode(',', array_fill(0, count($plan_ids), '%d'));
        $now = self::utc_now();
        $arguments = [
            ...$plan_ids,
            'active',
            $now,
            $now,
            ...$plan_ids,
            $now,
            $now,
            $now,
            'active',
            $now,
            'trialing',
            $now,
            'past_due',
            $now,
        ];
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT members.plan_id,COUNT(*) AS member_count FROM (
                SELECT plan_id,user_id FROM ' . self::table_name('grants') . "
                WHERE plan_id IN ({$placeholders}) AND status=%s AND starts_at<=%s
                AND (ends_at IS NULL OR ends_at>%s)
                UNION
                SELECT plan_id,user_id FROM " . self::table_name('subscriptions') . "
                WHERE plan_id IN ({$placeholders}) AND (ended_at IS NULL OR ended_at>%s)
                AND (started_at IS NULL OR started_at<=%s)
                AND (current_period_start IS NULL OR current_period_start<=%s)
                AND (
                    (status=%s AND (current_period_end IS NULL OR current_period_end>%s))
                    OR (status=%s AND trial_ends_at IS NOT NULL AND trial_ends_at>%s)
                    OR (status=%s AND grace_ends_at>%s)
                )
             ) members
             INNER JOIN " . self::table_name('plans') . " active_plan
                ON active_plan.id=members.plan_id AND active_plan.status='active'
             GROUP BY members.plan_id",
            ...$arguments
        ), ARRAY_A);
        $counts = [];
        foreach ($rows ?: [] as $row) {
            $counts[absint($row['plan_id'] ?? 0)] = absint($row['member_count'] ?? 0);
        }
        return $counts;
    }

    /** @param array<string,mixed> $row
     *  @return array<string,mixed>
     */
    private function format_plan(array $row): array {
        $metadata = self::decode_json($row['metadata'] ?? '', []);
        $metadata = is_array($metadata) ? $metadata : [];
        $key = self::sanitize_plan_key((string) ($row['slug'] ?? ''));
        return [
            'id' => absint($row['id'] ?? 0),
            'uuid' => (string) ($row['uuid'] ?? ''),
            'slug' => $key,
            'key' => $key,
            'name' => (string) ($row['name'] ?? ''),
            'description' => (string) ($row['description'] ?? ''),
            'status' => (string) ($row['status'] ?? 'active'),
            'visibility' => (string) ($row['visibility'] ?? 'private'),
            'memberCount' => absint($row['member_count'] ?? 0),
            'upgradeUrl' => (string) ($metadata['upgradeurl'] ?? $metadata['upgradeUrl'] ?? ''),
            'provider' => (string) ($metadata['provider'] ?? ''),
            'externalId' => (string) ($metadata['externalid'] ?? $metadata['externalId'] ?? ''),
            'metadata' => $metadata,
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
        ];
    }

    public function get_plan_entitlements(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = absint($request['id']);
        if (!$this->plan_row($id)) {
            return new WP_Error('kodety_members_plan_not_found', 'Plano não encontrado.', ['status' => 404]);
        }
        return $this->response(['items' => $this->plan_entitlement_rows($id)]);
    }

    /** @return list<array<string,mixed>> */
    private function plan_entitlement_rows(int $plan_id): array {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT e.*,pe.value_json FROM ' . self::table_name('plan_entitlements') . ' pe
             INNER JOIN ' . self::table_name('entitlements') . ' e ON e.id=pe.entitlement_id
             WHERE pe.plan_id=%d ORDER BY e.entitlement_key ASC',
            $plan_id
        ), ARRAY_A);
        return array_map(function (array $row): array {
            $formatted = $this->format_entitlement($row);
            $formatted['value'] = self::decode_json($row['value_json'] ?? '', true);
            return $formatted;
        }, $rows ?: []);
    }

    public function replace_plan_entitlements(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $plan_id = absint($request['id']);
        $plan = $this->plan_row($plan_id);
        if (!$plan) return new WP_Error('kodety_members_plan_not_found', 'Plano não encontrado.', ['status' => 404]);
        $raw = $this->request_payload($request);
        $items = isset($raw['items']) && is_array($raw['items']) ? array_slice($raw['items'], 0, 250) : [];
        $normalized = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                return new WP_Error('kodety_members_entitlement_invalid', 'Entitlement inválido.', ['status' => 400]);
            }
            $entitlement_id = absint($item['id'] ?? $item['entitlementId'] ?? 0);
            $entitlement = $this->entitlement_row($entitlement_id);
            if (!$entitlement || ($entitlement['status'] ?? '') !== 'active') {
                return new WP_Error(
                    'kodety_members_entitlement_not_found',
                    'Entitlement ativo não encontrado.',
                    ['status' => 404]
                );
            }
            $normalized[$entitlement_id] = [
                'value_json' => self::json($item['value'] ?? true),
            ];
        }
        $before = $this->plan_entitlement_rows($plan_id);
        $wpdb->query('START TRANSACTION');
        try {
            if ($wpdb->delete(self::table_name('plan_entitlements'), ['plan_id' => $plan_id]) === false) {
                throw new RuntimeException('delete_failed');
            }
            $now = self::utc_now();
            foreach ($normalized as $entitlement_id => $item) {
                if (!$wpdb->insert(self::table_name('plan_entitlements'), [
                    'plan_id' => $plan_id,
                    'entitlement_id' => $entitlement_id,
                    'value_json' => $item['value_json'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ])) {
                    throw new RuntimeException('insert_failed');
                }
            }
            $wpdb->query('COMMIT');
        } catch (Throwable) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_members_storage', 'Não foi possível atualizar o plano.', ['status' => 500]);
        }
        $after = $this->plan_entitlement_rows($plan_id);
        $this->audit('plan.entitlements_replaced', 'plan', (string) $plan_id, $before, $after);
        $this->invalidate_plan_users($plan_id);
        do_action('kodety_members_plan_changed', $plan_id, 'entitlements');
        return $this->response(['items' => $after]);
    }

    public function list_entitlements(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $status = sanitize_key((string) $request->get_param('status'));
        $search = substr(sanitize_text_field((string) $request->get_param('search')), 0, 191);
        $where = ['1=1'];
        $arguments = [];
        if (in_array($status, self::ENTITLEMENT_STATUSES, true)) {
            $where[] = 'status=%s';
            $arguments[] = $status;
        }
        if ($search !== '') {
            $like = '%' . $wpdb->esc_like($search) . '%';
            $where[] = '(name LIKE %s OR entitlement_key LIKE %s)';
            $arguments[] = $like;
            $arguments[] = $like;
        }
        $where_sql = implode(' AND ', $where);
        $table = self::table_name('entitlements');
        $count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}";
        $rows_sql = "SELECT * FROM {$table} WHERE {$where_sql} ORDER BY entitlement_key ASC LIMIT %d OFFSET %d";
        $total = (int) $wpdb->get_var($arguments ? $wpdb->prepare($count_sql, ...$arguments) : $count_sql);
        $rows = $wpdb->get_results($wpdb->prepare($rows_sql, ...[...$arguments, $per_page, $offset]), ARRAY_A);
        return $this->response([
            'items' => array_map([$this, 'format_entitlement'], $rows ?: []),
            'page' => $page,
            'perPage' => $per_page,
        ], 200, $total, $per_page);
    }

    public function create_entitlement(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $raw = $this->request_payload($request);
        $key = self::sanitize_entitlement_key((string) ($raw['key'] ?? ''));
        $name = substr(sanitize_text_field((string) ($raw['name'] ?? '')), 0, 191);
        $value_type = sanitize_key((string) ($raw['valueType'] ?? 'boolean'));
        if ($key === '' || $name === '' || !in_array($value_type, ['boolean', 'number', 'string', 'json'], true)) {
            return new WP_Error('kodety_members_entitlement_invalid', 'Entitlement inválido.', ['status' => 400]);
        }
        if ($wpdb->get_var($wpdb->prepare(
            'SELECT id FROM ' . self::table_name('entitlements') . ' WHERE entitlement_key=%s',
            $key
        ))) {
            return new WP_Error('kodety_members_entitlement_conflict', 'A chave já existe.', ['status' => 409]);
        }
        $now = self::utc_now();
        $row = [
            'entitlement_key' => $key,
            'name' => $name,
            'description' => substr(sanitize_textarea_field((string) ($raw['description'] ?? '')), 0, 10000),
            'value_type' => $value_type,
            'default_value' => self::json($raw['defaultValue'] ?? true),
            'status' => 'active',
            'metadata' => self::json(self::sanitize_metadata($raw['metadata'] ?? [])),
            'created_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ];
        if (!$wpdb->insert(self::table_name('entitlements'), $row)) {
            return new WP_Error('kodety_members_storage', 'Não foi possível criar o entitlement.', ['status' => 500]);
        }
        $id = (int) $wpdb->insert_id;
        $created = $this->entitlement_row($id);
        $this->audit('entitlement.created', 'entitlement', (string) $id, [], $created ?: $row);
        do_action('kodety_members_entitlement_changed', $id, 'created');
        return $this->response(
            $this->format_entitlement($created ?: array_merge($row, ['id' => $id])),
            201
        );
    }

    public function get_entitlement(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $row = $this->entitlement_row(absint($request['id']));
        if (!$row) {
            return new WP_Error('kodety_members_entitlement_not_found', 'Entitlement não encontrado.', ['status' => 404]);
        }
        return $this->response($this->format_entitlement($row));
    }

    public function update_entitlement(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = absint($request['id']);
        $before = $this->entitlement_row($id);
        if (!$before) {
            return new WP_Error('kodety_members_entitlement_not_found', 'Entitlement não encontrado.', ['status' => 404]);
        }
        $raw = $this->request_payload($request);
        if (
            isset($raw['key'])
            && self::sanitize_entitlement_key((string) $raw['key']) !== (string) $before['entitlement_key']
        ) {
            return new WP_Error(
                'kodety_members_entitlement_key_immutable',
                'A chave do entitlement é estável e não pode ser alterada.',
                ['status' => 409]
            );
        }
        $update = ['updated_at' => self::utc_now()];
        if (array_key_exists('name', $raw)) {
            $name = substr(sanitize_text_field((string) $raw['name']), 0, 191);
            if ($name === '') return new WP_Error('kodety_members_entitlement_invalid', 'Nome obrigatório.', ['status' => 400]);
            $update['name'] = $name;
        }
        if (array_key_exists('description', $raw)) {
            $update['description'] = substr(sanitize_textarea_field((string) $raw['description']), 0, 10000);
        }
        if (array_key_exists('status', $raw)) {
            $status = sanitize_key((string) $raw['status']);
            if (!in_array($status, self::ENTITLEMENT_STATUSES, true)) {
                return new WP_Error('kodety_members_entitlement_status', 'Status inválido.', ['status' => 400]);
            }
            $update['status'] = $status;
        }
        if (array_key_exists('defaultValue', $raw)) $update['default_value'] = self::json($raw['defaultValue']);
        if (array_key_exists('metadata', $raw)) {
            $update['metadata'] = self::json(self::sanitize_metadata($raw['metadata']));
        }
        if ($wpdb->update(self::table_name('entitlements'), $update, ['id' => $id]) === false) {
            return new WP_Error('kodety_members_storage', 'Não foi possível atualizar o entitlement.', ['status' => 500]);
        }
        $after = $this->entitlement_row($id);
        $this->audit('entitlement.updated', 'entitlement', (string) $id, $before, $after ?: $update);
        $this->invalidate_entitlement_users($id);
        do_action('kodety_members_entitlement_changed', $id, 'updated');
        return $this->response($this->format_entitlement($after ?: array_merge($before, $update)));
    }

    public function archive_entitlement(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $id = absint($request['id']);
        $before = $this->entitlement_row($id);
        if (!$before) {
            return new WP_Error('kodety_members_entitlement_not_found', 'Entitlement não encontrado.', ['status' => 404]);
        }
        if ($wpdb->update(
            self::table_name('entitlements'),
            ['status' => 'archived', 'updated_at' => self::utc_now()],
            ['id' => $id]
        ) === false) {
            return new WP_Error('kodety_members_storage', 'Não foi possível arquivar o entitlement.', ['status' => 500]);
        }
        $after = $this->entitlement_row($id);
        $this->audit('entitlement.archived', 'entitlement', (string) $id, $before, $after ?: []);
        $this->invalidate_entitlement_users($id);
        do_action('kodety_members_entitlement_changed', $id, 'archived');
        return $this->response($this->format_entitlement($after ?: array_merge($before, ['status' => 'archived'])));
    }

    /** @return array<string,mixed>|null */
    private function entitlement_row(int $id): ?array {
        global $wpdb;
        if ($id <= 0) return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table_name('entitlements') . ' WHERE id=%d',
            $id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /** @param array<string,mixed> $row
     *  @return array<string,mixed>
     */
    private function format_entitlement(array $row): array {
        return [
            'id' => absint($row['id'] ?? 0),
            'key' => (string) ($row['entitlement_key'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'description' => (string) ($row['description'] ?? ''),
            'valueType' => (string) ($row['value_type'] ?? 'boolean'),
            'defaultValue' => self::decode_json($row['default_value'] ?? '', true),
            'status' => (string) ($row['status'] ?? 'active'),
            'metadata' => self::decode_json($row['metadata'] ?? '', []),
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
        ];
    }

    public function overview(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $share_context = class_exists('Kodety_Sharing')
            ? Kodety_Sharing::instance()->context($request)
            : null;
        $share_can_edit = !$share_context || Kodety_Sharing::instance()->can_edit($request);
        if (!$share_context && !current_user_can('list_users')) {
            return new WP_Error('kodety_members_user_list_forbidden', 'Sem permissão para listar usuários.', ['status' => 403]);
        }
        global $wpdb;
        $counts = count_users();
        $member_count = (int) ($counts['total_users'] ?? 0);
        if (!current_user_can('manage_options')) {
            $member_count = max(0, $member_count - (int) ($counts['avail_roles']['administrator'] ?? 0));
        }
        $now = self::utc_now();
        $active_grants = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(DISTINCT user_id) FROM ' . self::table_name('grants') . '
             WHERE status=%s AND starts_at<=%s AND (ends_at IS NULL OR ends_at>%s)',
            'active',
            $now,
            $now
        ));
        $active_subscriptions = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(DISTINCT user_id) FROM ' . self::table_name('subscriptions') . '
             WHERE (ended_at IS NULL OR ended_at>%s)
             AND (started_at IS NULL OR started_at<=%s)
             AND (current_period_start IS NULL OR current_period_start<=%s)
             AND (
                (status=%s AND (current_period_end IS NULL OR current_period_end>%s))
                OR (status=%s AND trial_ends_at IS NOT NULL AND trial_ends_at>%s)
                OR (status=%s AND grace_ends_at>%s)
             )',
            $now,
            $now,
            $now,
            'active',
            $now,
            'trialing',
            $now,
            'past_due',
            $now
        ));
        $active_members = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(DISTINCT user_id) FROM (
                SELECT user_id FROM ' . self::table_name('grants') . '
                WHERE status=%s AND starts_at<=%s AND (ends_at IS NULL OR ends_at>%s)
                UNION
                SELECT user_id FROM ' . self::table_name('subscriptions') . '
                WHERE (ended_at IS NULL OR ended_at>%s)
                AND (started_at IS NULL OR started_at<=%s)
                AND (current_period_start IS NULL OR current_period_start<=%s)
                AND (
                    (status=%s AND (current_period_end IS NULL OR current_period_end>%s))
                    OR (status=%s AND trial_ends_at IS NOT NULL AND trial_ends_at>%s)
                    OR (status=%s AND grace_ends_at>%s)
                )
             ) kodety_active_members',
            'active',
            $now,
            $now,
            $now,
            $now,
            $now,
            'active',
            $now,
            'trialing',
            $now,
            'past_due',
            $now
        ));
        if ($active_members === 0) $active_members = max($active_grants, $active_subscriptions);
        $plan_count = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM " . self::table_name('plans') . " WHERE status='active'"
        );
        $project_key = self::sanitize_project_key((string) (
            $request->get_param('project')
            ?: $request->get_param('projectId')
            ?: $request->get_param('projectKey')
        ));
        return $this->response([
            'enabled' => $project_key !== ''
                ? self::is_project_enabled($project_key)
                : self::is_site_enabled(),
            'siteEnabled' => self::is_site_enabled(),
            'projectId' => $project_key,
            'memberCount' => $member_count,
            'activeMemberCount' => $active_members,
            'planCount' => $plan_count,
            'capabilities' => [
                'view' => current_user_can('kodety_view_members'),
                'manage' => $share_can_edit && current_user_can('kodety_manage_members'),
                'assign' => $share_can_edit && current_user_can('kodety_assign_membership'),
                'commerce' => $share_can_edit && current_user_can('kodety_manage_commerce'),
                'createUsers' => $share_can_edit && current_user_can('create_users'),
                'manageMembers' => $share_can_edit && current_user_can('kodety_manage_members'),
                'managePlans' => $share_can_edit && current_user_can('kodety_manage_commerce'),
                'manageSettings' => $share_can_edit && current_user_can('kodety_manage_commerce'),
            ],
        ]);
    }

    public function update_overview(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $raw = $this->request_payload($request);
        $project_key = self::sanitize_project_key((string) (
            $raw['projectId']
            ?? $raw['projectKey']
            ?? $raw['project']
            ?? ''
        ));
        if ($project_key === '') {
            return new WP_Error('kodety_members_project_required', 'Projeto obrigatório.', ['status' => 400]);
        }
        $enabled = rest_sanitize_boolean($raw['enabled'] ?? false);
        $result = $this->set_project_enabled($project_key, $enabled, get_current_user_id());
        return is_wp_error($result) ? $result : $this->response($result);
    }

    /**
     * Changes the explicit Membership opt-in for one published project.
     *
     * Builder REST mutations and the WordPress project toggle share this
     * service so there is a single activation state. Disabling a project only
     * removes its runtime opt-in; plans, members and commerce history remain
     * available if the project is enabled again.
     *
     * @return array<string,mixed>|WP_Error
     */
    public function set_project_enabled(
        string $project_key,
        bool $enabled,
        ?int $actor_id = null
    ): array|WP_Error {
        $project_key = self::sanitize_project_key($project_key);
        if ($project_key === '') {
            return new WP_Error('kodety_members_project_required', 'Projeto obrigatório.', ['status' => 400]);
        }
        $before = self::settings();
        $projects = array_fill_keys((array) $before['enabled_projects'], true);
        if ($enabled) $projects[$project_key] = true;
        else unset($projects[$project_key]);
        $after = self::sanitize_settings(array_merge($before, [
            'enabled' => $enabled ? true : !empty($projects),
            'enabled_projects' => array_keys($projects),
        ]));
        if (!update_option(self::OPTION_SETTINGS, $after, false) && $after !== $before) {
            return new WP_Error('kodety_members_storage', 'Não foi possível atualizar o projeto.', ['status' => 500]);
        }
        $this->audit(
            $enabled ? 'project.enabled' : 'project.disabled',
            'project',
            $project_key,
            self::format_settings($before),
            self::format_settings($after),
            0,
            $actor_id
        );
        do_action('kodety_members_project_opt_in_changed', $project_key, $enabled, $after);
        return [
            'enabled' => self::is_project_enabled($project_key),
            'siteEnabled' => self::is_site_enabled(),
            'projectId' => $project_key,
            'settings' => self::format_settings($after),
        ];
    }

    public function create_member(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!current_user_can('create_users')) {
            return new WP_Error('kodety_members_create_forbidden', 'Sem permissão para criar usuários.', ['status' => 403]);
        }
        $raw = $this->request_payload($request);
        $email = sanitize_email((string) ($raw['email'] ?? ''));
        $username = sanitize_user((string) ($raw['username'] ?? ''), true);
        $display_name = substr(sanitize_text_field((string) ($raw['displayName'] ?? '')), 0, 191);
        $password = (string) ($raw['password'] ?? '');
        $send_invite = !array_key_exists('sendInvite', $raw) || rest_sanitize_boolean($raw['sendInvite']);
        $has_plan_keys = isset($raw['planKeys']) && is_array($raw['planKeys']);
        if ($has_plan_keys && !current_user_can('kodety_assign_membership')) {
            return new WP_Error('kodety_members_assign_forbidden', 'Sem permissão para atribuir planos.', ['status' => 403]);
        }
        if ($has_plan_keys) {
            $validated_plans = $this->validate_plan_keys($raw['planKeys']);
            if (is_wp_error($validated_plans)) return $validated_plans;
        }
        if (!is_email($email) || email_exists($email)) {
            return new WP_Error('kodety_members_member_email', 'E-mail inválido ou já utilizado.', ['status' => 400]);
        }
        if ($username === '') $username = sanitize_user((string) strtok($email, '@'), true);
        if ($username === '' || username_exists($username)) {
            return new WP_Error('kodety_members_member_username', 'Nome de usuário inválido ou já utilizado.', ['status' => 400]);
        }
        if ($password !== '' && (strlen($password) < 12 || strlen($password) > 4096)) {
            return new WP_Error('kodety_members_member_password', 'A senha deve ter pelo menos 12 caracteres.', ['status' => 400]);
        }
        if ($password === '' && !$send_invite) {
            return new WP_Error(
                'kodety_members_member_credentials',
                'Informe uma senha ou habilite o convite.',
                ['status' => 400]
            );
        }
        if ($password === '') $password = wp_generate_password(32, true, true);
        $member_role = self::validated_public_member_role();
        if (is_wp_error($member_role)) return $member_role;
        $user_id = wp_insert_user([
            'user_login' => $username,
            'user_email' => $email,
            'user_pass' => $password,
            'display_name' => $display_name !== '' ? $display_name : $username,
            'first_name' => substr(sanitize_text_field((string) ($raw['firstName'] ?? '')), 0, 191),
            'last_name' => substr(sanitize_text_field((string) ($raw['lastName'] ?? '')), 0, 191),
            'role' => $member_role,
        ]);
        if (is_wp_error($user_id)) {
            return new WP_Error('kodety_members_member_create', 'Não foi possível criar o membro.', ['status' => 400]);
        }
        $user = get_user_by('id', (int) $user_id);
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_member_create', 'Não foi possível carregar o membro.', ['status' => 500]);
        }
        update_user_meta($user->ID, '_kodety_membership_status', $send_invite ? 'invited' : 'active');
        if ($has_plan_keys) {
            $synced = $this->sync_member_plan_keys($user->ID, $raw['planKeys'], get_current_user_id());
            if (is_wp_error($synced)) {
                global $wpdb;
                $wpdb->update(
                    self::table_name('grants'),
                    ['status' => 'revoked', 'updated_at' => self::utc_now()],
                    ['user_id' => $user->ID]
                );
                require_once ABSPATH . 'wp-admin/includes/user.php';
                wp_delete_user($user->ID);
                return $synced;
            }
        }
        $this->audit('member.created', 'user', (string) $user->ID, [], ['userId' => $user->ID], $user->ID);
        $member = $this->format_admin_member($user);
        $member['inviteRequested'] = false;
        if ($send_invite) {
            try {
                $invite = retrieve_password($user->user_login);
                $member['inviteRequested'] = !is_wp_error($invite);
                if (is_wp_error($invite)) throw new RuntimeException($invite->get_error_code());
                $this->audit(
                    'member.invite_requested',
                    'user',
                    (string) $user->ID,
                    [],
                    ['userId' => $user->ID],
                    $user->ID
                );
            } catch (Throwable $error) {
                $this->audit(
                    'member.invite_failed',
                    'user',
                    (string) $user->ID,
                    [],
                    ['userId' => $user->ID, 'error' => substr($error->getMessage(), 0, 300)],
                    $user->ID
                );
            }
        }
        return $this->response($member, 201);
    }

    public function update_member(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user_id = absint($request['id']);
        if (!$this->can_manage_user($user_id)) {
            return new WP_Error('kodety_members_user_forbidden', 'Sem permissão para este usuário.', ['status' => 403]);
        }
        $user = get_user_by('id', $user_id);
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        $raw = $this->request_payload($request);
        $has_status = array_key_exists('status', $raw);
        $has_plan_keys = isset($raw['planKeys']) && is_array($raw['planKeys']);
        $next_status = null;
        if ($has_status) {
            $next_status = sanitize_key((string) $raw['status']);
            if (!in_array($next_status, ['active', 'invited', 'suspended'], true)) {
                return new WP_Error('kodety_members_member_status', 'Status de membro inválido.', ['status' => 400]);
            }
        }
        if ($has_plan_keys) {
            if (!current_user_can('kodety_assign_membership')) {
                return new WP_Error('kodety_members_assign_forbidden', 'Sem permissão para atribuir planos.', ['status' => 403]);
            }
            $validated_plans = $this->validate_plan_keys($raw['planKeys']);
            if (is_wp_error($validated_plans)) return $validated_plans;
        }
        $data = ['ID' => $user_id];
        foreach ([
            'displayName' => 'display_name',
            'firstName' => 'first_name',
            'lastName' => 'last_name',
        ] as $input => $field) {
            if (array_key_exists($input, $raw)) {
                $data[$field] = substr(sanitize_text_field((string) $raw[$input]), 0, 191);
            }
        }
        if (array_key_exists('email', $raw)) {
            $email = sanitize_email((string) $raw['email']);
            $owner = $email !== '' ? email_exists($email) : false;
            if (!is_email($email) || ($owner && (int) $owner !== $user_id)) {
                return new WP_Error('kodety_members_member_email', 'E-mail inválido ou já utilizado.', ['status' => 400]);
            }
            $data['user_email'] = $email;
        }
        if (count($data) === 1 && !$has_status && !$has_plan_keys) {
            return new WP_Error('kodety_members_member_empty', 'Nenhuma alteração válida.', ['status' => 400]);
        }
        $before = $this->format_admin_member($user);
        if (count($data) > 1) {
            $updated = wp_update_user($data);
            if (is_wp_error($updated)) {
                return new WP_Error('kodety_members_member_update', 'Não foi possível atualizar o membro.', ['status' => 400]);
            }
        }
        if ($has_status) {
            update_user_meta($user_id, '_kodety_membership_status', $next_status);
            $this->bump_user_revision($user_id);
        }
        if ($has_plan_keys) {
            $synced = $this->sync_member_plan_keys($user_id, $raw['planKeys'], get_current_user_id());
            if (is_wp_error($synced)) return $synced;
        }
        $fresh = get_user_by('id', $user_id);
        if (!$fresh instanceof WP_User) {
            return new WP_Error('kodety_members_member_update', 'Não foi possível carregar o membro.', ['status' => 500]);
        }
        $this->audit('member.updated', 'user', (string) $user_id, $before, $this->format_admin_member($fresh), $user_id);
        return $this->response($this->format_admin_member($fresh));
    }

    /**
     * Capture only the identity snapshot needed for an audit before WordPress
     * removes usermeta. The actual membership transition is centralized in
     * `finalize_user_deletion()` so WP Admin, WP-CLI and the Builder behave the
     * same way.
     */
    public function capture_user_deletion(
        int $user_id,
        ?int $reassign = null,
        mixed $deleted_user = null
    ): void {
        if ($user_id <= 0 || isset($this->pending_user_deletions[$user_id])) return;
        $user = $deleted_user instanceof WP_User
            ? $deleted_user
            : get_user_by('id', $user_id);
        $this->pending_user_deletions[$user_id] = [
            'userId' => $user_id,
            'email' => $user instanceof WP_User ? (string) ($user->user_email ?? '') : '',
            'login' => $user instanceof WP_User ? (string) ($user->user_login ?? '') : '',
            'displayName' => $user instanceof WP_User ? (string) ($user->display_name ?? '') : '',
            'roles' => $user instanceof WP_User
                ? array_values(array_map('sanitize_key', (array) ($user->roles ?? [])))
                : [],
            'status' => sanitize_key((string) get_user_meta(
                $user_id,
                '_kodety_membership_status',
                true
            )),
            'reassignTo' => $reassign !== null ? absint($reassign) : 0,
        ];
    }

    /**
     * WordPress fires this after any permanent user deletion. Access rows stay
     * as terminal history for provider idempotency, but can never grant access
     * to a future request.
     */
    public function finalize_user_deletion(
        int $user_id,
        ?int $reassign = null,
        mixed $deleted_user = null
    ): void {
        if ($user_id <= 0 || array_key_exists($user_id, $this->finalized_user_deletions)) return;
        if (!isset($this->pending_user_deletions[$user_id])) {
            $this->capture_user_deletion($user_id, $reassign, $deleted_user);
        }
        $result = $this->terminalize_user_membership($user_id);
        $success = !is_wp_error($result);
        $this->finalized_user_deletions[$user_id] = $success;
        $this->forget_user_claims($user_id);

        if ($success) {
            $before = $this->pending_user_deletions[$user_id] ?? ['userId' => $user_id];
            $this->audit(
                'member.deleted',
                'user',
                (string) $user_id,
                $before,
                [
                    'userId' => $user_id,
                    'grantsRevoked' => absint($result['grants'] ?? 0),
                    'subscriptionsCanceled' => absint($result['subscriptions'] ?? 0),
                ],
                $user_id
            );
            do_action('kodety_members_user_deleted', $user_id, $result);
        } else {
            do_action('kodety_members_user_cleanup_failed', $user_id, $result);
        }
        unset($this->pending_user_deletions[$user_id]);
    }

    public function delete_member(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user_id = absint($request['id']);
        if (
            $user_id <= 0
            || $user_id === get_current_user_id()
            || !current_user_can('delete_user', $user_id)
            || !$this->can_manage_user($user_id)
        ) {
            return new WP_Error('kodety_members_delete_forbidden', 'Sem permissão para remover este membro.', ['status' => 403]);
        }
        $user = get_user_by('id', $user_id);
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        if (user_can($user, 'manage_options')) {
            return new WP_Error(
                'kodety_members_delete_administrator',
                'Administradores devem ser gerenciados no painel nativo de usuários.',
                ['status' => 403]
            );
        }
        $before = $this->format_admin_member($user);
        $this->pending_user_deletions[$user_id] = $before;
        require_once ABSPATH . 'wp-admin/includes/user.php';
        if (!wp_delete_user($user_id, get_current_user_id())) {
            unset($this->pending_user_deletions[$user_id]);
            return new WP_Error('kodety_members_delete_failed', 'Não foi possível remover o membro.', ['status' => 500]);
        }
        // Core guarantees `deleted_user`, but keep a fail-safe for test
        // adapters or hosts that replace `wp_delete_user`.
        if (!array_key_exists($user_id, $this->finalized_user_deletions)) {
            $this->finalize_user_deletion($user_id, get_current_user_id(), $user);
        }
        return $this->response([
            'deleted' => true,
            'id' => $user_id,
            'cleanupPending' => !($this->finalized_user_deletions[$user_id] ?? false),
        ]);
    }

    /** @return array{grants:int,subscriptions:int}|WP_Error */
    private function terminalize_user_membership(int $user_id): array|WP_Error {
        if ($user_id <= 0) {
            return new WP_Error('kodety_members_user_invalid', 'Usuário inválido.', ['status' => 400]);
        }
        global $wpdb;
        $now = self::utc_now();
        if ($wpdb->query('START TRANSACTION') === false) {
            return new WP_Error(
                'kodety_members_storage',
                'Não foi possível iniciar a limpeza do membro.',
                ['status' => 500]
            );
        }
        try {
            $grants = $wpdb->query($wpdb->prepare(
                'UPDATE ' . self::table_name('grants') . '
                 SET status=%s,revised_by=%d,updated_at=%s
                 WHERE user_id=%d AND status=%s',
                'revoked',
                get_current_user_id(),
                $now,
                $user_id,
                'active'
            ));
            if ($grants === false) throw new RuntimeException('grant_cleanup_failed');

            $subscriptions = $wpdb->query($wpdb->prepare(
                'UPDATE ' . self::table_name('subscriptions') . '
                 SET status=%s,
                     canceled_at=COALESCE(canceled_at,%s),
                     ended_at=COALESCE(ended_at,%s),
                     revision=revision+1,
                     updated_at=%s
                 WHERE user_id=%d AND status IN (%s,%s,%s,%s,%s)',
                'canceled',
                $now,
                $now,
                $now,
                $user_id,
                'pending',
                'trialing',
                'active',
                'past_due',
                'paused'
            ));
            if ($subscriptions === false) throw new RuntimeException('subscription_cleanup_failed');
            if ($wpdb->query('COMMIT') === false) throw new RuntimeException('cleanup_commit_failed');
            return [
                'grants' => max(0, (int) $grants),
                'subscriptions' => max(0, (int) $subscriptions),
            ];
        } catch (Throwable) {
            $wpdb->query('ROLLBACK');
            return new WP_Error(
                'kodety_members_storage',
                'A exclusão foi concluída, mas a reconciliação de acesso ficou pendente.',
                ['status' => 500]
            );
        }
    }

    public function list_members(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $share_context = class_exists('Kodety_Sharing')
            ? Kodety_Sharing::instance()->context($request)
            : null;
        if (!$share_context && !current_user_can('list_users')) {
            return new WP_Error('kodety_members_user_list_forbidden', 'Sem permissão para listar usuários.', ['status' => 403]);
        }
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $search = substr(sanitize_text_field((string) $request->get_param('search')), 0, 191);
        $status = sanitize_key((string) $request->get_param('status'));
        $plan_key = self::sanitize_plan_key((string) (
            $request->get_param('plan')
            ?: $request->get_param('planKey')
        ));
        $plan_query_filter = null;
        $arguments = [
            'number' => $per_page,
            'offset' => $offset,
            'orderby' => 'registered',
            'order' => 'DESC',
            'count_total' => true,
            'fields' => 'all',
        ];
        if ($search !== '') {
            $arguments['search'] = '*' . $search . '*';
            $arguments['search_columns'] = ['user_login', 'user_email', 'display_name'];
        }
        if ($status === 'active') {
            $arguments['meta_query'] = [
                'relation' => 'OR',
                [
                    'key' => '_kodety_membership_status',
                    'value' => 'active',
                    'compare' => '=',
                ],
                [
                    'key' => '_kodety_membership_status',
                    'compare' => 'NOT EXISTS',
                ],
            ];
        } elseif (in_array($status, ['invited', 'suspended'], true)) {
            $arguments['meta_key'] = '_kodety_membership_status';
            $arguments['meta_value'] = $status;
            $arguments['meta_compare'] = '=';
        }
        if ($plan_key !== '') {
            $plan_id = absint($wpdb->get_var($wpdb->prepare(
                'SELECT id FROM ' . self::table_name('plans') . ' WHERE slug=%s',
                $plan_key
            )));
            if (!$plan_id) {
                return $this->response([
                    'items' => [],
                    'page' => $page,
                    'perPage' => $per_page,
                ], 200, 0, $per_page);
            }
            $now = self::utc_now();
            $plan_members_sql = $wpdb->prepare(
                'SELECT DISTINCT user_id FROM (
                    SELECT user_id FROM ' . self::table_name('grants') . '
                    WHERE plan_id=%d AND status=%s AND starts_at<=%s
                    AND (ends_at IS NULL OR ends_at>%s)
                    UNION
                    SELECT user_id FROM ' . self::table_name('subscriptions') . '
                    WHERE plan_id=%d
                    AND (ended_at IS NULL OR ended_at>%s)
                    AND (started_at IS NULL OR started_at<=%s)
                    AND (current_period_start IS NULL OR current_period_start<=%s)
                    AND (
                        (status=%s AND (current_period_end IS NULL OR current_period_end>%s))
                        OR (status=%s AND trial_ends_at IS NOT NULL AND trial_ends_at>%s)
                        OR (status=%s AND grace_ends_at>%s)
                    )
                 ) kodety_plan_members',
                $plan_id,
                'active',
                $now,
                $now,
                $plan_id,
                $now,
                $now,
                $now,
                'active',
                $now,
                'trialing',
                $now,
                'past_due',
                $now
            );
            $users_table = $wpdb->users;
            $plan_query_filter = static function (WP_User_Query $query) use (
                $plan_members_sql,
                $users_table
            ): void {
                $query->query_from .=
                    " INNER JOIN ({$plan_members_sql}) kodety_plan_members"
                    . " ON kodety_plan_members.user_id={$users_table}.ID";
            };
            add_action('pre_user_query', $plan_query_filter);
        }
        if ($share_context || !current_user_can('manage_options')) {
            $arguments['role__not_in'] = ['administrator'];
        }
        try {
            $query = new WP_User_Query($arguments);
        } finally {
            if ($plan_query_filter !== null) {
                remove_action('pre_user_query', $plan_query_filter);
            }
        }
        $users = array_values(array_filter(
            $query->get_results(),
            static fn(mixed $user): bool => $user instanceof WP_User
        ));
        $items = array_map(fn(WP_User $user): array => $this->format_admin_member($user), $users);
        return $this->response([
            'items' => $items,
            'page' => $page,
            'perPage' => $per_page,
        ], 200, (int) $query->get_total(), $per_page);
    }

    public function get_member(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $share_context = class_exists('Kodety_Sharing')
            ? Kodety_Sharing::instance()->context($request)
            : null;
        if (!$share_context && !current_user_can('list_users')) {
            return new WP_Error('kodety_members_user_list_forbidden', 'Sem permissão para listar usuários.', ['status' => 403]);
        }
        $user_id = absint($request['id']);
        $user = get_user_by('id', $user_id);
        if (!$user instanceof WP_User) {
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        if (
            user_can($user, 'manage_options')
            && ($share_context || !current_user_can('manage_options'))
        ) {
            return new WP_Error('kodety_members_user_forbidden', 'Sem permissão para este usuário.', ['status' => 403]);
        }
        $member = $this->format_admin_member($user);
        $member['grants'] = $this->user_grants($user_id);
        $member['subscriptions'] = $this->user_subscriptions($user_id);
        return $this->response($member);
    }

    /** @return array<string,mixed> */
    private function format_admin_member(WP_User $user): array {
        $public = $this->public_user($user);
        $public['roles'] = array_values(array_map('sanitize_key', (array) $user->roles));
        $public['registeredAt'] = self::mysql_to_iso($user->user_registered);
        $public['lastLoginAt'] = self::mysql_to_iso(
            get_user_meta($user->ID, '_kodety_membership_last_login_at', true)
        );
        $public['claims'] = $this->resolve_claims($user->ID);
        $status = sanitize_key((string) get_user_meta($user->ID, '_kodety_membership_status', true));
        $public['status'] = in_array($status, ['active', 'invited', 'suspended'], true) ? $status : 'active';
        $public['planKeys'] = array_values((array) ($public['claims']['plans'] ?? []));
        $public['canManage'] = $this->can_manage_user($user->ID);
        return $public;
    }

    public function create_grant(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user_id = absint($request['id']);
        if (!$this->can_manage_user($user_id)) {
            return new WP_Error('kodety_members_user_forbidden', 'Sem permissão para este usuário.', ['status' => 403]);
        }
        $raw = $this->request_payload($request);
        $raw['userId'] = $user_id;
        $raw['source'] = sanitize_key((string) ($raw['source'] ?? 'manual'));
        if (!in_array($raw['source'], ['manual', 'promotion', 'import'], true)) {
            return new WP_Error('kodety_members_grant_source', 'Origem de concessão inválida.', ['status' => 400]);
        }
        $result = $this->upsert_grant($raw, get_current_user_id());
        if (is_wp_error($result)) return $result;
        return $this->response($result, !empty($result['created']) ? 201 : 200);
    }

    /**
     * Internal provider/import bridge. Callers must authenticate and validate
     * their own source before invoking this method.
     *
     * @param array<string,mixed> $raw
     * @return array<string,mixed>|WP_Error
     */
    public function upsert_grant(
        array $raw,
        int $actor_id = 0,
        bool $manage_transaction = true,
        bool $notify = true
    ): array|WP_Error {
        global $wpdb;
        $user_id = absint($raw['userId'] ?? 0);
        if (!$user_id || !get_user_by('id', $user_id)) {
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        $target_type = sanitize_key((string) ($raw['targetType'] ?? 'plan'));
        $target_id = absint($raw['targetId'] ?? 0);
        $plan_id = 0;
        $entitlement_id = 0;
        if ($target_type === 'plan') {
            $plan = $this->plan_row($target_id);
            if (!$plan || ($plan['status'] ?? '') !== 'active') {
                return new WP_Error('kodety_members_plan_not_found', 'Plano ativo não encontrado.', ['status' => 404]);
            }
            $plan_id = $target_id;
        } elseif ($target_type === 'entitlement') {
            $entitlement = $this->entitlement_row($target_id);
            if (!$entitlement || ($entitlement['status'] ?? '') !== 'active') {
                return new WP_Error(
                    'kodety_members_entitlement_not_found',
                    'Entitlement ativo não encontrado.',
                    ['status' => 404]
                );
            }
            $entitlement_id = $target_id;
        } else {
            return new WP_Error('kodety_members_grant_target', 'Alvo da concessão inválido.', ['status' => 400]);
        }
        $source = sanitize_key((string) ($raw['source'] ?? 'manual'));
        if (!in_array($source, self::GRANT_SOURCES, true)) {
            return new WP_Error('kodety_members_grant_source', 'Origem de concessão inválida.', ['status' => 400]);
        }
        $source_reference = substr(sanitize_text_field((string) ($raw['sourceReference'] ?? '')), 0, 191);
        if ($source_reference === '') $source_reference = $source . ':' . $target_type . ':' . $target_id;
        $starts_at = self::sanitize_datetime($raw['startsAt'] ?? '', false);
        $ends_at = self::sanitize_datetime($raw['endsAt'] ?? '', true);
        if (is_wp_error($starts_at) || is_wp_error($ends_at)) {
            return is_wp_error($starts_at) ? $starts_at : $ends_at;
        }
        if ($ends_at !== null && $ends_at <= $starts_at) {
            return new WP_Error('kodety_members_grant_dates', 'O término deve ser posterior ao início.', ['status' => 400]);
        }
        $grant_key = hash('sha256', implode('|', [
            $user_id,
            $target_type,
            $target_id,
            $source,
            $source_reference,
        ]));
        $table = self::table_name('grants');
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE grant_key=%s",
            $grant_key
        ), ARRAY_A);
        $now = self::utc_now();
        $row = [
            'user_id' => $user_id,
            'plan_id' => $plan_id,
            'entitlement_id' => $entitlement_id,
            'source' => $source,
            'source_reference' => $source_reference,
            'grant_key' => $grant_key,
            'status' => 'active',
            'starts_at' => $starts_at,
            'ends_at' => $ends_at,
            'reason' => substr(sanitize_text_field((string) ($raw['reason'] ?? '')), 0, 500),
            'revised_by' => $actor_id,
            'updated_at' => $now,
        ];
        if ($manage_transaction) $wpdb->query('START TRANSACTION');
        try {
            if (is_array($existing)) {
                if ($wpdb->update($table, $row, ['id' => absint($existing['id'])]) === false) {
                    throw new RuntimeException('update_failed');
                }
                $grant_id = absint($existing['id']);
                $created = false;
            } else {
                $row['created_by'] = $actor_id;
                $row['created_at'] = $now;
                if (!$wpdb->insert($table, $row)) throw new RuntimeException('insert_failed');
                $grant_id = (int) $wpdb->insert_id;
                $created = true;
            }
            $after = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id=%d", $grant_id), ARRAY_A);
            $this->audit(
                $created ? 'grant.created' : 'grant.updated',
                'grant',
                (string) $grant_id,
                is_array($existing) ? $existing : [],
                is_array($after) ? $after : $row,
                $user_id,
                $actor_id
            );
            if ($manage_transaction) $wpdb->query('COMMIT');
        } catch (Throwable) {
            if ($manage_transaction) $wpdb->query('ROLLBACK');
            return new WP_Error('kodety_members_storage', 'Não foi possível salvar a concessão.', ['status' => 500]);
        }
        if ($manage_transaction && !(get_user_by('id', $user_id) instanceof WP_User)) {
            $this->terminalize_user_membership($user_id);
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        if ($notify) {
            $this->bump_user_revision($user_id);
            do_action('kodety_members_grant_changed', $grant_id, $user_id, $created ? 'created' : 'updated');
        }
        $formatted = $this->grant_row($grant_id);
        $formatted['created'] = $created;
        return $formatted;
    }

    public function revoke_grant(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $user_id = absint($request['id']);
        $grant_id = absint($request['grant_id']);
        if (!$this->can_manage_user($user_id)) {
            return new WP_Error('kodety_members_user_forbidden', 'Sem permissão para este usuário.', ['status' => 403]);
        }
        $table = self::table_name('grants');
        $before = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE id=%d AND user_id=%d",
            $grant_id,
            $user_id
        ), ARRAY_A);
        if (!is_array($before)) {
            return new WP_Error('kodety_members_grant_not_found', 'Concessão não encontrada.', ['status' => 404]);
        }
        if ($wpdb->update($table, [
            'status' => 'revoked',
            'revised_by' => get_current_user_id(),
            'updated_at' => self::utc_now(),
        ], ['id' => $grant_id, 'user_id' => $user_id]) === false) {
            return new WP_Error('kodety_members_storage', 'Não foi possível revogar a concessão.', ['status' => 500]);
        }
        $after = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id=%d", $grant_id), ARRAY_A);
        $this->audit('grant.revoked', 'grant', (string) $grant_id, $before, is_array($after) ? $after : [], $user_id);
        $this->bump_user_revision($user_id);
        do_action('kodety_members_grant_changed', $grant_id, $user_id, 'revoked');
        return $this->response($this->format_grant(is_array($after) ? $after : array_merge($before, ['status' => 'revoked'])));
    }

    /** @return list<array<string,mixed>> */
    private function user_grants(int $user_id): array {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT g.*,p.slug AS plan_slug,e.entitlement_key
             FROM ' . self::table_name('grants') . ' g
             LEFT JOIN ' . self::table_name('plans') . ' p ON p.id=g.plan_id
             LEFT JOIN ' . self::table_name('entitlements') . ' e ON e.id=g.entitlement_id
             WHERE g.user_id=%d ORDER BY g.created_at DESC,g.id DESC',
            $user_id
        ), ARRAY_A);
        return array_map([$this, 'format_grant'], $rows ?: []);
    }

    /** @return array<string,mixed> */
    private function grant_row(int $grant_id): array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT g.*,p.slug AS plan_slug,e.entitlement_key
             FROM ' . self::table_name('grants') . ' g
             LEFT JOIN ' . self::table_name('plans') . ' p ON p.id=g.plan_id
             LEFT JOIN ' . self::table_name('entitlements') . ' e ON e.id=g.entitlement_id
             WHERE g.id=%d',
            $grant_id
        ), ARRAY_A);
        return is_array($row) ? $this->format_grant($row) : [];
    }

    /** @param array<string,mixed> $row
     *  @return array<string,mixed>
     */
    private function format_grant(array $row): array {
        $target_type = absint($row['plan_id'] ?? 0) > 0 ? 'plan' : 'entitlement';
        return [
            'id' => absint($row['id'] ?? 0),
            'userId' => absint($row['user_id'] ?? 0),
            'targetType' => $target_type,
            'targetId' => $target_type === 'plan'
                ? absint($row['plan_id'] ?? 0)
                : absint($row['entitlement_id'] ?? 0),
            'targetKey' => $target_type === 'plan'
                ? (string) ($row['plan_slug'] ?? '')
                : (string) ($row['entitlement_key'] ?? ''),
            'source' => (string) ($row['source'] ?? ''),
            'sourceReference' => (string) ($row['source_reference'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'startsAt' => self::mysql_to_iso($row['starts_at'] ?? null),
            'endsAt' => self::mysql_to_iso($row['ends_at'] ?? null),
            'reason' => (string) ($row['reason'] ?? ''),
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
        ];
    }

    public function list_subscriptions(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $share_context = class_exists('Kodety_Sharing')
            ? Kodety_Sharing::instance()->context($request)
            : null;
        if (!$share_context && !current_user_can('list_users')) {
            return new WP_Error('kodety_members_user_list_forbidden', 'Sem permissão para listar usuários.', ['status' => 403]);
        }
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $where = ['1=1'];
        $arguments = [];
        $user_id = absint($request->get_param('user_id'));
        $plan_id = absint($request->get_param('plan_id'));
        $status = sanitize_key((string) $request->get_param('status'));
        $provider = self::sanitize_provider((string) $request->get_param('provider'));
        if ($user_id) {
            $user = get_user_by('id', $user_id);
            if (
                !$user instanceof WP_User
                || (
                    user_can($user, 'manage_options')
                    && ($share_context || !current_user_can('manage_options'))
                )
            ) {
                return new WP_Error('kodety_members_user_forbidden', 'Sem permissão para este usuário.', ['status' => 403]);
            }
            $where[] = 's.user_id=%d';
            $arguments[] = $user_id;
        }
        if ($plan_id) {
            $where[] = 's.plan_id=%d';
            $arguments[] = $plan_id;
        }
        if (in_array($status, self::SUBSCRIPTION_STATUSES, true)) {
            $where[] = 's.status=%s';
            $arguments[] = $status;
        }
        if ($provider !== '') {
            $where[] = 's.provider=%s';
            $arguments[] = $provider;
        }
        $where_sql = implode(' AND ', $where);
        $table = self::table_name('subscriptions');
        $count_sql = "SELECT COUNT(*) FROM {$table} s WHERE {$where_sql}";
        $rows_sql = 'SELECT s.*,p.slug AS plan_slug,p.name AS plan_name
            FROM ' . $table . ' s
            INNER JOIN ' . self::table_name('plans') . " p ON p.id=s.plan_id
            WHERE {$where_sql} ORDER BY s.updated_at DESC,s.id DESC LIMIT %d OFFSET %d";
        $total = (int) $wpdb->get_var($arguments ? $wpdb->prepare($count_sql, ...$arguments) : $count_sql);
        $rows = $wpdb->get_results($wpdb->prepare($rows_sql, ...[...$arguments, $per_page, $offset]), ARRAY_A);
        $items = [];
        foreach ($rows ?: [] as $row) {
            $target = get_user_by('id', absint($row['user_id'] ?? 0));
            if (
                $target instanceof WP_User
                && user_can($target, 'manage_options')
                && ($share_context || !current_user_can('manage_options'))
            ) {
                continue;
            }
            $items[] = $this->format_subscription($row);
        }
        return $this->response([
            'items' => $items,
            'page' => $page,
            'perPage' => $per_page,
        ], 200, $total, $per_page);
    }

    public function upsert_subscription_rest(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $raw = $this->request_payload($request);
        $user_id = absint($raw['userId'] ?? 0);
        if (!$this->can_manage_user($user_id)) {
            return new WP_Error('kodety_members_user_forbidden', 'Sem permissão para este usuário.', ['status' => 403]);
        }
        $result = $this->upsert_subscription($raw, get_current_user_id());
        if (is_wp_error($result)) return $result;
        return $this->response($result, !empty($result['created']) ? 201 : 200);
    }

    /**
     * Provider adapter contract. Signature verification and event ordering
     * happen in the adapter; this method normalizes the local projection.
     *
     * @param array<string,mixed> $raw
     * @return array<string,mixed>|WP_Error
     */
    public function upsert_subscription(array $raw, int $actor_id = 0): array|WP_Error {
        global $wpdb;
        $user_id = absint($raw['userId'] ?? 0);
        $plan_id = absint($raw['planId'] ?? 0);
        if (!$user_id || !get_user_by('id', $user_id)) {
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        if (!$this->plan_row($plan_id)) {
            return new WP_Error('kodety_members_plan_not_found', 'Plano não encontrado.', ['status' => 404]);
        }
        $provider = self::sanitize_provider((string) ($raw['provider'] ?? ''));
        $tenant = substr(sanitize_text_field((string) ($raw['providerTenant'] ?? '')), 0, 191);
        $external_contract = substr(sanitize_text_field((string) ($raw['externalContractId'] ?? '')), 0, 191);
        $external_customer = substr(sanitize_text_field((string) ($raw['externalCustomerId'] ?? '')), 0, 191);
        $status = sanitize_key((string) ($raw['status'] ?? 'pending'));
        if ($provider === '' || $external_contract === '' || !in_array($status, self::SUBSCRIPTION_STATUSES, true)) {
            return new WP_Error('kodety_members_subscription_invalid', 'Assinatura inválida.', ['status' => 400]);
        }
        $dates = [];
        foreach ([
            'startedAt' => 'started_at',
            'trialEndsAt' => 'trial_ends_at',
            'currentPeriodStart' => 'current_period_start',
            'currentPeriodEnd' => 'current_period_end',
            'graceEndsAt' => 'grace_ends_at',
            'canceledAt' => 'canceled_at',
            'endedAt' => 'ended_at',
        ] as $input => $column) {
            $date = self::sanitize_datetime($raw[$input] ?? '', true);
            if (is_wp_error($date)) return $date;
            $dates[$column] = $date;
        }
        $date_validation = self::validate_subscription_dates($status, $dates);
        if (is_wp_error($date_validation)) return $date_validation;
        $external_hash = hash('sha256', $provider . '|' . $tenant . '|' . $external_contract);
        $table = self::table_name('subscriptions');
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE external_key_hash=%s",
            $external_hash
        ), ARRAY_A);
        if (is_array($existing) && absint($existing['user_id']) !== $user_id) {
            return new WP_Error(
                'kodety_members_subscription_identity_conflict',
                'A assinatura externa já está vinculada a outro usuário.',
                ['status' => 409]
            );
        }
        $now = self::utc_now();
        $row = array_merge([
            'user_id' => $user_id,
            'plan_id' => $plan_id,
            'provider' => $provider,
            'provider_tenant' => $tenant,
            'external_customer_id' => $external_customer,
            'external_contract_id' => $external_contract,
            'external_key_hash' => $external_hash,
            'status' => $status,
            'metadata' => self::json(self::sanitize_metadata($raw['metadata'] ?? [])),
            'updated_at' => $now,
        ], $dates);
        if (is_array($existing)) {
            $row['revision'] = max(1, absint($existing['revision'] ?? 1) + 1);
            if ($wpdb->update($table, $row, ['id' => absint($existing['id'])]) === false) {
                return new WP_Error('kodety_members_storage', 'Não foi possível atualizar a assinatura.', ['status' => 500]);
            }
            $id = absint($existing['id']);
            $created = false;
        } else {
            $row['revision'] = 1;
            $row['created_at'] = $now;
            if (!$wpdb->insert($table, $row)) {
                return new WP_Error('kodety_members_storage', 'Não foi possível criar a assinatura.', ['status' => 500]);
            }
            $id = (int) $wpdb->insert_id;
            $created = true;
        }
        if (!(get_user_by('id', $user_id) instanceof WP_User)) {
            $this->terminalize_user_membership($user_id);
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        $after = $wpdb->get_row($wpdb->prepare(
            'SELECT s.*,p.slug AS plan_slug,p.name AS plan_name
             FROM ' . $table . ' s INNER JOIN ' . self::table_name('plans') . ' p ON p.id=s.plan_id
             WHERE s.id=%d',
            $id
        ), ARRAY_A);
        $this->audit(
            $created ? 'subscription.created' : 'subscription.updated',
            'subscription',
            (string) $id,
            is_array($existing) ? $existing : [],
            is_array($after) ? $after : $row,
            $user_id,
            $actor_id
        );
        $this->bump_user_revision($user_id);
        do_action('kodety_members_subscription_changed', $id, $user_id, $created ? 'created' : 'updated');
        $formatted = $this->format_subscription(is_array($after) ? $after : array_merge($row, ['id' => $id]));
        $formatted['created'] = $created;
        return $formatted;
    }

    /**
     * @param array<string,string|null> $dates
     */
    private static function validate_subscription_dates(
        string $status,
        array $dates
    ): bool|WP_Error {
        $started_at = $dates['started_at'] ?? null;
        $trial_ends_at = $dates['trial_ends_at'] ?? null;
        $period_start = $dates['current_period_start'] ?? null;
        $period_end = $dates['current_period_end'] ?? null;
        if ($period_start !== null && $period_end !== null && $period_end <= $period_start) {
            return new WP_Error(
                'kodety_members_subscription_dates',
                'Período da assinatura inválido.',
                ['status' => 400]
            );
        }
        if ($status === 'trialing') {
            if ($trial_ends_at === null) {
                return new WP_Error(
                    'kodety_members_subscription_trial_end',
                    'Uma assinatura em período de teste precisa informar o fim do trial.',
                    ['status' => 400]
                );
            }
            $effective_start = $period_start ?? $started_at;
            if ($effective_start !== null && $trial_ends_at <= $effective_start) {
                return new WP_Error(
                    'kodety_members_subscription_dates',
                    'Período de teste inválido.',
                    ['status' => 400]
                );
            }
        }
        return true;
    }

    /** @return list<array<string,mixed>> */
    private function user_subscriptions(int $user_id): array {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT s.*,p.slug AS plan_slug,p.name AS plan_name
             FROM ' . self::table_name('subscriptions') . ' s
             INNER JOIN ' . self::table_name('plans') . ' p ON p.id=s.plan_id
             WHERE s.user_id=%d ORDER BY s.updated_at DESC,s.id DESC',
            $user_id
        ), ARRAY_A);
        return array_map([$this, 'format_subscription'], $rows ?: []);
    }

    /** @param array<string,mixed> $row
     *  @return array<string,mixed>
     */
    private function format_subscription(array $row): array {
        return [
            'id' => absint($row['id'] ?? 0),
            'userId' => absint($row['user_id'] ?? 0),
            'planId' => absint($row['plan_id'] ?? 0),
            'planSlug' => self::sanitize_plan_key((string) ($row['plan_slug'] ?? '')),
            'planName' => (string) ($row['plan_name'] ?? ''),
            'provider' => (string) ($row['provider'] ?? ''),
            'providerTenant' => (string) ($row['provider_tenant'] ?? ''),
            'externalCustomerId' => (string) ($row['external_customer_id'] ?? ''),
            'externalContractId' => (string) ($row['external_contract_id'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'startedAt' => self::mysql_to_iso($row['started_at'] ?? null),
            'trialEndsAt' => self::mysql_to_iso($row['trial_ends_at'] ?? null),
            'currentPeriodStart' => self::mysql_to_iso($row['current_period_start'] ?? null),
            'currentPeriodEnd' => self::mysql_to_iso($row['current_period_end'] ?? null),
            'graceEndsAt' => self::mysql_to_iso($row['grace_ends_at'] ?? null),
            'canceledAt' => self::mysql_to_iso($row['canceled_at'] ?? null),
            'endedAt' => self::mysql_to_iso($row['ended_at'] ?? null),
            'metadata' => self::decode_json($row['metadata'] ?? '', []),
            'revision' => absint($row['revision'] ?? 1),
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
        ];
    }

    /**
     * Idempotency ledger contract for commerce adapters. The raw payload is
     * intentionally never persisted; adapters may pass it only to derive a
     * hash after they have verified the provider signature.
     *
     * @param array<string,mixed> $event
     * @return array<string,mixed>|WP_Error
     */
    public function record_provider_event(array $event): array|WP_Error {
        global $wpdb;
        $provider = self::sanitize_provider((string) ($event['provider'] ?? ''));
        $tenant = substr(sanitize_text_field((string) ($event['providerTenant'] ?? '')), 0, 191);
        $external_id = substr(sanitize_text_field((string) ($event['externalEventId'] ?? '')), 0, 191);
        $event_type = substr(sanitize_text_field((string) ($event['eventType'] ?? '')), 0, 128);
        if ($provider === '' || $external_id === '' || $event_type === '') {
            return new WP_Error('kodety_members_event_invalid', 'Evento de provedor inválido.', ['status' => 400]);
        }
        $payload_hash = strtolower(trim((string) ($event['payloadHash'] ?? '')));
        if (!preg_match('/^[a-f0-9]{64}$/', $payload_hash)) {
            $payload = $event['payload'] ?? '';
            $payload_hash = hash('sha256', is_string($payload) ? $payload : self::json($payload));
        }
        $occurred_at = self::sanitize_datetime($event['occurredAt'] ?? '', true);
        if (is_wp_error($occurred_at)) return $occurred_at;
        $event_key = hash('sha256', $provider . '|' . $tenant . '|' . $external_id);
        $table = self::table_name('events');
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE event_key_hash=%s",
            $event_key
        ), ARRAY_A);
        if (is_array($existing)) {
            return $this->provider_event_duplicate($existing, $event_type, $payload_hash);
        }
        $now = self::utc_now();
        if (!$wpdb->insert($table, [
            'provider' => $provider,
            'provider_tenant' => $tenant,
            'external_event_id' => $external_id,
            'event_key_hash' => $event_key,
            'event_type' => $event_type,
            'payload_hash' => $payload_hash,
            'status' => 'received',
            'attempts' => 0,
            'last_error' => '',
            'occurred_at' => $occurred_at,
            'processed_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ])) {
            $duplicate = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$table} WHERE event_key_hash=%s",
                $event_key
            ), ARRAY_A);
            if (is_array($duplicate)) {
                return $this->provider_event_duplicate($duplicate, $event_type, $payload_hash);
            }
            return new WP_Error('kodety_members_storage', 'Não foi possível registrar o evento.', ['status' => 500]);
        }
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE id=%d",
            (int) $wpdb->insert_id
        ), ARRAY_A);
        return array_merge(
            $this->format_event(is_array($row) ? $row : ['id' => $wpdb->insert_id] + $event),
            ['duplicate' => false]
        );
    }

    /** @return array<string,mixed>|WP_Error */
    private function provider_event_duplicate(
        array $existing,
        string $event_type,
        string $payload_hash
    ): array|WP_Error {
        $stored_type = (string) ($existing['event_type'] ?? '');
        $stored_hash = strtolower((string) ($existing['payload_hash'] ?? ''));
        if (
            $stored_type === ''
            || $stored_hash === ''
            || !hash_equals($stored_type, $event_type)
            || !hash_equals($stored_hash, $payload_hash)
        ) {
            return new WP_Error(
                'kodety_members_event_conflict',
                'O identificador externo do evento já foi usado com outro conteúdo.',
                ['status' => 409]
            );
        }
        return array_merge($this->format_event($existing), ['duplicate' => true]);
    }

    public function mark_provider_event(
        int $event_id,
        string $status,
        string $error = ''
    ): bool|WP_Error {
        global $wpdb;
        $status = sanitize_key($status);
        if (!in_array($status, ['received', 'processing', 'processed', 'failed', 'ignored'], true)) {
            return new WP_Error('kodety_members_event_status', 'Status de evento inválido.', ['status' => 400]);
        }
        if ($event_id <= 0) {
            return new WP_Error('kodety_members_event_invalid', 'Evento de provedor inválido.', ['status' => 400]);
        }
        $previous_statuses = match ($status) {
            'processing' => ['received', 'failed'],
            'processed', 'failed' => ['processing'],
            'ignored' => ['received', 'processing'],
            // Explicitly requeue only a failed item. Terminal processed/ignored
            // events cannot be reopened accidentally.
            'received' => ['failed'],
        };
        $updated_at = self::utc_now();
        $last_error = substr(sanitize_text_field($error), 0, 1000);
        $set = $status === 'processing'
            ? 'attempts=attempts+1,status=%s,last_error=%s,updated_at=%s'
            : 'status=%s,last_error=%s,updated_at=%s';
        $arguments = [$status, $last_error, $updated_at];
        if (in_array($status, ['processed', 'ignored'], true)) {
            $set .= ',processed_at=%s';
            $arguments[] = $updated_at;
        }
        $placeholders = implode(',', array_fill(0, count($previous_statuses), '%s'));
        $arguments[] = $event_id;
        array_push($arguments, ...$previous_statuses);
        $result = $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::table_name('events') . "
             SET {$set} WHERE id=%d AND status IN ({$placeholders})",
            ...$arguments
        ));
        return $result !== false && $wpdb->rows_affected > 0;
    }

    /**
     * Release a worker claim that was never finalized. No payload is stored,
     * so the provider retry remains the source of truth and can claim the
     * same immutable ledger row again from the failed state.
     */
    public function reclaim_stale_provider_event(
        int $event_id,
        int $stale_after_seconds = 600
    ): bool|WP_Error {
        global $wpdb;
        if ($event_id <= 0) {
            return new WP_Error(
                'kodety_members_event_invalid',
                'Evento de provedor inválido.',
                ['status' => 400]
            );
        }
        $cutoff = gmdate(
            'Y-m-d H:i:s',
            time() - max(60, min(DAY_IN_SECONDS, $stale_after_seconds))
        );
        $result = $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::table_name('events') . "
             SET status='failed',last_error='stale_processing_reclaimed',updated_at=%s
             WHERE id=%d AND status='processing' AND updated_at<%s",
            self::utc_now(),
            $event_id,
            $cutoff
        ));
        if ($result === false) {
            return new WP_Error(
                'kodety_members_storage',
                'Não foi possível liberar o evento pendente.',
                ['status' => 500]
            );
        }
        return $wpdb->rows_affected > 0;
    }

    public function recover_stale_provider_events(
        int $stale_after_seconds = 600,
        int $limit = 100
    ): int|WP_Error {
        global $wpdb;
        $cutoff = gmdate(
            'Y-m-d H:i:s',
            time() - max(60, min(DAY_IN_SECONDS, $stale_after_seconds))
        );
        $limit = max(1, min(500, $limit));
        $result = $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::table_name('events') . "
             SET status='failed',last_error='stale_processing_reclaimed',updated_at=%s
             WHERE status='processing' AND updated_at<%s
             ORDER BY id ASC LIMIT %d",
            self::utc_now(),
            $cutoff,
            $limit
        ));
        if ($result === false) {
            return new WP_Error(
                'kodety_members_storage',
                'Não foi possível recuperar eventos pendentes.',
                ['status' => 500]
            );
        }
        return max(0, (int) $wpdb->rows_affected);
    }

    public function list_events(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $provider = self::sanitize_provider((string) $request->get_param('provider'));
        $status = sanitize_key((string) $request->get_param('status'));
        $where = ['1=1'];
        $arguments = [];
        if ($provider !== '') {
            $where[] = 'provider=%s';
            $arguments[] = $provider;
        }
        if (in_array($status, ['received', 'processing', 'processed', 'failed', 'ignored'], true)) {
            $where[] = 'status=%s';
            $arguments[] = $status;
        }
        $where_sql = implode(' AND ', $where);
        $table = self::table_name('events');
        $count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}";
        $rows_sql = "SELECT * FROM {$table} WHERE {$where_sql} ORDER BY created_at DESC,id DESC LIMIT %d OFFSET %d";
        $total = (int) $wpdb->get_var($arguments ? $wpdb->prepare($count_sql, ...$arguments) : $count_sql);
        $rows = $wpdb->get_results($wpdb->prepare($rows_sql, ...[...$arguments, $per_page, $offset]), ARRAY_A);
        return $this->response([
            'items' => array_map([$this, 'format_event'], $rows ?: []),
            'page' => $page,
            'perPage' => $per_page,
        ], 200, $total, $per_page);
    }

    /** @param array<string,mixed> $row
     *  @return array<string,mixed>
     */
    private function format_event(array $row): array {
        return [
            'id' => absint($row['id'] ?? 0),
            'provider' => (string) ($row['provider'] ?? ''),
            'providerTenant' => (string) ($row['provider_tenant'] ?? ''),
            'externalEventId' => (string) ($row['external_event_id'] ?? ''),
            'eventType' => (string) ($row['event_type'] ?? ''),
            'payloadHash' => (string) ($row['payload_hash'] ?? ''),
            'status' => (string) ($row['status'] ?? 'received'),
            'attempts' => absint($row['attempts'] ?? 0),
            'lastError' => (string) ($row['last_error'] ?? ''),
            'occurredAt' => self::mysql_to_iso($row['occurred_at'] ?? null),
            'processedAt' => self::mysql_to_iso($row['processed_at'] ?? null),
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
        ];
    }

    public function list_audit(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $entity_type = sanitize_key((string) $request->get_param('entity_type'));
        $subject_user_id = absint($request->get_param('user_id'));
        $where = ['1=1'];
        $arguments = [];
        if ($entity_type !== '') {
            $where[] = 'entity_type=%s';
            $arguments[] = $entity_type;
        }
        if ($subject_user_id) {
            $where[] = 'subject_user_id=%d';
            $arguments[] = $subject_user_id;
        }
        $where_sql = implode(' AND ', $where);
        $table = self::table_name('audit');
        $count_sql = "SELECT COUNT(*) FROM {$table} WHERE {$where_sql}";
        $rows_sql = "SELECT * FROM {$table} WHERE {$where_sql} ORDER BY created_at DESC,id DESC LIMIT %d OFFSET %d";
        $total = (int) $wpdb->get_var($arguments ? $wpdb->prepare($count_sql, ...$arguments) : $count_sql);
        $rows = $wpdb->get_results($wpdb->prepare($rows_sql, ...[...$arguments, $per_page, $offset]), ARRAY_A);
        $items = array_map(static function (array $row): array {
            return [
                'id' => absint($row['id'] ?? 0),
                'actorId' => absint($row['actor_id'] ?? 0),
                'subjectUserId' => absint($row['subject_user_id'] ?? 0),
                'action' => (string) ($row['action'] ?? ''),
                'entityType' => (string) ($row['entity_type'] ?? ''),
                'entityId' => (string) ($row['entity_id'] ?? ''),
                'requestId' => (string) ($row['request_uuid'] ?? ''),
                'before' => self::decode_json($row['before_json'] ?? '', []),
                'after' => self::decode_json($row['after_json'] ?? '', []),
                'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            ];
        }, $rows ?: []);
        return $this->response([
            'items' => $items,
            'page' => $page,
            'perPage' => $per_page,
        ], 200, $total, $per_page);
    }

    public function preview_policy(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $raw = $this->request_payload($request);
        $rule = $raw['rule'] ?? null;
        if (!is_array($rule)) {
            return new WP_Error('kodety_members_policy_invalid', 'Regra inválida.', ['status' => 400]);
        }
        $user_id = absint($raw['userId'] ?? get_current_user_id());
        if ($user_id > 0 && $user_id !== get_current_user_id() && !$this->can_manage_user($user_id)) {
            return new WP_Error('kodety_members_user_forbidden', 'Sem permissão para este usuário.', ['status' => 403]);
        }
        $project_key = self::sanitize_project_key((string) ($raw['projectId'] ?? $raw['projectKey'] ?? ''));
        $decision = self::evaluate_access($rule, $user_id, $project_key);
        $decision['claims'] = $this->resolve_claims($user_id);
        return $this->response($decision);
    }

    /**
     * Replace only plan grants owned by the member-management UI. Manual
     * imports, promotions and provider grants remain independent.
     *
     * @param array<int,mixed> $plan_keys
     */
    private function sync_member_plan_keys(int $user_id, array $plan_keys, int $actor_id): bool|WP_Error {
        global $wpdb;
        $desired = $this->validate_plan_keys($plan_keys);
        if (is_wp_error($desired)) return $desired;
        $grant_table = self::table_name('grants');
        $existing = $wpdb->get_results($wpdb->prepare(
            "SELECT g.*,p.slug AS plan_slug FROM {$grant_table} g
             INNER JOIN " . self::table_name('plans') . " p ON p.id=g.plan_id
             WHERE g.user_id=%d AND g.source='manual' AND g.source_reference LIKE %s",
            $user_id,
            'member-ui:plan:%'
        ), ARRAY_A);
        $changed_grants = [];
        $wpdb->query('START TRANSACTION');
        try {
            foreach ($existing ?: [] as $grant) {
                $slug = (string) ($grant['plan_slug'] ?? '');
                if (isset($desired[$slug])) continue;
                if ($wpdb->update($grant_table, [
                    'status' => 'revoked',
                    'revised_by' => $actor_id,
                    'updated_at' => self::utc_now(),
                ], ['id' => absint($grant['id'])]) === false) {
                    throw new RuntimeException('revoke_failed');
                }
                $this->audit(
                    'grant.revoked',
                    'grant',
                    (string) absint($grant['id']),
                    $grant,
                    array_merge($grant, ['status' => 'revoked']),
                    $user_id,
                    $actor_id
                );
                $changed_grants[absint($grant['id'])] = 'revoked';
            }
            foreach ($desired as $plan_id) {
                $grant = $this->upsert_grant([
                    'userId' => $user_id,
                    'targetType' => 'plan',
                    'targetId' => $plan_id,
                    'source' => 'manual',
                    'sourceReference' => 'member-ui:plan:' . $plan_id,
                    'reason' => 'Plano atribuído pelo painel de membros.',
                ], $actor_id, false, false);
                if (is_wp_error($grant)) throw new RuntimeException($grant->get_error_code());
                $changed_grants[absint($grant['id'] ?? 0)] = !empty($grant['created'])
                    ? 'created'
                    : 'updated';
            }
            $wpdb->query('COMMIT');
        } catch (Throwable) {
            $wpdb->query('ROLLBACK');
            return new WP_Error(
                'kodety_members_storage',
                'Não foi possível atualizar todos os planos do membro.',
                ['status' => 500]
            );
        }
        if (!(get_user_by('id', $user_id) instanceof WP_User)) {
            $this->terminalize_user_membership($user_id);
            return new WP_Error('kodety_members_user_not_found', 'Membro não encontrado.', ['status' => 404]);
        }
        $this->bump_user_revision($user_id);
        foreach ($changed_grants as $grant_id => $action) {
            if ($grant_id > 0) do_action('kodety_members_grant_changed', $grant_id, $user_id, $action);
        }
        return true;
    }

    /**
     * @param array<int,mixed> $plan_keys
     * @return array<string,int>|WP_Error
     */
    private function validate_plan_keys(array $plan_keys): array|WP_Error {
        global $wpdb;
        $keys = [];
        foreach (array_slice($plan_keys, 0, 100) as $key) {
            $clean = self::sanitize_plan_key((string) $key);
            if ($clean !== '') $keys[$clean] = $clean;
        }
        $desired = [];
        if ($keys) {
            $placeholders = implode(',', array_fill(0, count($keys), '%s'));
            $rows = $wpdb->get_results($wpdb->prepare(
                'SELECT id,slug FROM ' . self::table_name('plans') . "
                 WHERE status='active' AND slug IN ({$placeholders})",
                ...array_values($keys)
            ), ARRAY_A);
            foreach ($rows ?: [] as $row) {
                $slug = self::sanitize_plan_key((string) ($row['slug'] ?? ''));
                if ($slug !== '') $desired[$slug] = absint($row['id']);
            }
            if (count($desired) !== count($keys)) {
                return new WP_Error('kodety_members_plan_not_found', 'Um ou mais planos ativos não existem.', ['status' => 404]);
            }
        }
        return $desired;
    }

    private function invalidate_plan_users(int $plan_id): void {
        $this->bump_catalog_revision();
        do_action('kodety_members_plan_access_invalidated', $plan_id);
    }

    private function invalidate_entitlement_users(int $entitlement_id): void {
        $this->bump_catalog_revision();
        do_action('kodety_members_entitlement_access_invalidated', $entitlement_id);
    }

    private function bump_catalog_revision(): int {
        $revision = max(0, (int) get_option('kodety_membership_catalog_revision', 0)) + 1;
        update_option('kodety_membership_catalog_revision', $revision, false);
        $this->request_claims = [];
        return $revision;
    }

    /**
     * Record a commerce-control action in the membership audit without
     * exposing the generic audit writer as a public logging primitive.
     *
     * Checkout credentials, opaque links and temporary URLs must never be
     * passed here. A second allow-list/redaction pass keeps that invariant
     * even if a future caller includes an unsafe field by mistake.
     *
     * @param array<string,mixed> $before
     * @param array<string,mixed> $after
     */
    public function record_commerce_audit(
        string $action,
        string $entity_type,
        string $entity_id,
        array $before = [],
        array $after = [],
        int $subject_user_id = 0,
        ?int $actor_id = null
    ): bool {
        $allowed_actions = [
            'commerce.access.granted',
            'commerce.access.revoked',
            'commerce.access.restored',
            'commerce.access_link.created',
            'commerce.access_link.consumed',
            'commerce.reset_link.created',
            'commerce.reset_email.sent',
            'commerce.connection.created',
            'commerce.connection.updated',
            'commerce.connection.deleted',
            'commerce.mapping.created',
            'commerce.mapping.updated',
            'commerce.mapping.deleted',
        ];
        $allowed_entities = ['user', 'connection', 'mapping', 'access'];
        if (
            !in_array($action, $allowed_actions, true)
            || !in_array($entity_type, $allowed_entities, true)
            || $entity_id === ''
        ) {
            return false;
        }
        $this->audit(
            $action,
            $entity_type,
            $entity_id,
            self::redact_commerce_audit_value($before),
            self::redact_commerce_audit_value($after),
            max(0, $subject_user_id),
            $actor_id
        );
        return true;
    }

    private static function redact_commerce_audit_value(mixed $value, int $depth = 0): mixed {
        if ($depth > 5) return '[truncated]';
        if (!is_array($value)) {
            if (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
                return $value;
            }
            return substr(sanitize_text_field((string) $value), 0, 1000);
        }
        $output = [];
        foreach (array_slice($value, 0, 50, true) as $key => $child) {
            $clean = sanitize_key((string) $key);
            if (
                $clean === ''
                || preg_match(
                    '/password|pass|pwd|secret|token|authorization|cookie|credential|'
                        . 'card|cvv|grant_key|external_key_hash|url|link/',
                    $clean
                )
            ) {
                continue;
            }
            $output[$clean] = self::redact_commerce_audit_value($child, $depth + 1);
        }
        return $output;
    }

    /**
     * @param array<string,mixed> $before
     * @param array<string,mixed> $after
     */
    private function audit(
        string $action,
        string $entity_type,
        string $entity_id,
        array $before,
        array $after,
        int $subject_user_id = 0,
        ?int $actor_id = null
    ): void {
        global $wpdb;
        $wpdb->insert(self::table_name('audit'), [
            'actor_id' => $actor_id ?? get_current_user_id(),
            'subject_user_id' => $subject_user_id,
            'action' => substr(sanitize_key(str_replace('.', '_', $action)), 0, 128),
            'entity_type' => substr(sanitize_key($entity_type), 0, 64),
            'entity_id' => substr(sanitize_text_field($entity_id), 0, 191),
            'request_uuid' => wp_generate_uuid4(),
            'ip_hash' => $this->request_fingerprint(),
            'before_json' => self::json(self::redact_audit_value($before)),
            'after_json' => self::json(self::redact_audit_value($after)),
            'created_at' => self::utc_now(),
        ]);
    }

    private static function redact_audit_value(mixed $value, int $depth = 0): mixed {
        if ($depth > 5) return '[truncated]';
        if (!is_array($value)) {
            if (is_bool($value) || is_int($value) || is_float($value) || $value === null) return $value;
            return substr(sanitize_text_field((string) $value), 0, 2000);
        }
        $output = [];
        foreach (array_slice($value, 0, 100, true) as $key => $child) {
            $clean = sanitize_key((string) $key);
            if (
                $clean === ''
                || preg_match('/password|pass|pwd|secret|token|authorization|cookie|card|cvv|grant_key|external_key_hash/', $clean)
            ) {
                continue;
            }
            $output[$clean] = self::redact_audit_value($child, $depth + 1);
        }
        return $output;
    }

    public function cleanup(): void {
        global $wpdb;
        $settings = self::settings();
        $audit_cutoff = gmdate(
            'Y-m-d H:i:s',
            time() - (absint($settings['audit_retention_days']) * DAY_IN_SECONDS)
        );
        $event_cutoff = gmdate(
            'Y-m-d H:i:s',
            time() - (absint($settings['event_retention_days']) * DAY_IN_SECONDS)
        );
        $wpdb->query($wpdb->prepare(
            'DELETE FROM ' . self::table_name('audit') . ' WHERE created_at<%s',
            $audit_cutoff
        ));
        $wpdb->query($wpdb->prepare(
            "DELETE FROM " . self::table_name('events') . "
             WHERE created_at<%s AND status IN ('processed','ignored')",
            $event_cutoff
        ));
        $now = self::utc_now();
        $expired_users = $wpdb->get_col($wpdb->prepare(
            'SELECT DISTINCT user_id FROM ' . self::table_name('grants') . '
             WHERE status=%s AND ends_at IS NOT NULL AND ends_at<=%s LIMIT 1000',
            'active',
            $now
        ));
        $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::table_name('grants') . '
             SET status=%s,updated_at=%s WHERE status=%s AND ends_at IS NOT NULL AND ends_at<=%s',
            'expired',
            $now,
            'active',
            $now
        ));
        foreach ($expired_users ?: [] as $user_id) $this->bump_user_revision(absint($user_id));

        // Reconcile deletions that happened while the plugin was unavailable,
        // or whose post-delete transition suffered a transient database error.
        // Rows remain as terminal history; no orphan can contribute access.
        $orphaned_users = $wpdb->get_col(
            'SELECT DISTINCT kodety_orphans.user_id FROM (
                SELECT user_id FROM ' . self::table_name('grants') . " WHERE status='active'
                UNION
                SELECT user_id FROM " . self::table_name('subscriptions') . "
                WHERE status IN ('pending','trialing','active','past_due','paused')
             ) kodety_orphans
             LEFT JOIN {$wpdb->users} kodety_users ON kodety_users.ID=kodety_orphans.user_id
             WHERE kodety_orphans.user_id>0 AND kodety_users.ID IS NULL
             LIMIT 200"
        );
        foreach ($orphaned_users ?: [] as $orphaned_user_id) {
            $orphaned_user_id = absint($orphaned_user_id);
            $result = $this->terminalize_user_membership($orphaned_user_id);
            if (is_wp_error($result)) {
                do_action('kodety_members_user_cleanup_failed', $orphaned_user_id, $result);
                continue;
            }
            $this->forget_user_claims($orphaned_user_id);
            $this->audit(
                'member.access_reconciled',
                'user',
                (string) $orphaned_user_id,
                ['userId' => $orphaned_user_id, 'orphanedAccess' => true],
                [
                    'userId' => $orphaned_user_id,
                    'grantsRevoked' => absint($result['grants'] ?? 0),
                    'subscriptionsCanceled' => absint($result['subscriptions'] ?? 0),
                ],
                $orphaned_user_id,
                0
            );
            do_action('kodety_members_user_access_reconciled', $orphaned_user_id, $result);
        }
    }

    /** @return array<string,mixed> */
    private function request_payload(WP_REST_Request $request): array {
        $raw = $request->get_json_params();
        if (!is_array($raw) || !$raw) $raw = $request->get_params();
        return is_array($raw) ? $raw : [];
    }

    private static function mysql_to_iso(mixed $value): ?string {
        $value = trim((string) $value);
        if ($value === '') return null;
        $timestamp = strtotime($value . (preg_match('/(?:Z|[+-]\d\d:\d\d)$/', $value) ? '' : ' UTC'));
        return $timestamp === false ? null : gmdate('c', $timestamp);
    }
}
