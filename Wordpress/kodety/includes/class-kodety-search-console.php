<?php

defined('ABSPATH') || exit;

/**
 * Google Search Console connection and page-level SEO telemetry.
 *
 * Google credentials, selected property, synchronization state and report
 * rows are isolated by Onun Kodety's active project site URL. Long-lived
 * credentials are authenticated-encrypted at rest and never cross the REST
 * boundary.
 */
final class Kodety_Search_Console {
    public const CAP_VIEW = 'kodety_view_search_console';
    public const CAP_MANAGE = 'kodety_manage_search_console';

    private const DB_VERSION = 2;
    private const OPTION_DB_VERSION = 'kodety_search_console_db_version';
    private const OPTION_OAUTH_CLIENT = 'kodety_search_console_client_credentials';
    private const OPTION_OAUTH_CLIENT_REVISION = 'kodety_search_console_client_revision';
    private const OPTION_CREDENTIAL_PREFIX = 'kodety_search_console_credential_';
    private const OPTION_CONNECTION_REVISION_PREFIX = 'kodety_search_console_connection_revision_';
    private const OPTION_SITE_INDEX = 'kodety_search_console_site_index';
    private const OPTION_SITE_PREFIX = 'kodety_search_console_site_';
    private const OPTION_OAUTH_PREFIX = 'kodety_search_console_oauth_';
    private const OPTION_UPGRADE_LOCK = 'kodety_search_console_upgrade_lock';
    private const OPTION_SYNC_LOCK_PREFIX = 'kodety_search_console_sync_lock_';
    private const OPTION_STATE_LOCK_PREFIX = 'kodety_search_console_state_lock_';
    private const OPTION_INSPECTION_USAGE_PREFIX = 'kodety_search_console_inspection_usage_';
    private const TRANSIENT_ACCESS_TOKEN_PREFIX = 'kodety_search_console_access_token_';

    private const CRON_HOOK = 'kodety_search_console_daily_sync';
    private const RETRY_HOOK = 'kodety_search_console_retry_sync';
    private const OAUTH_ACTION = 'kodety_search_console_oauth_callback';

    private const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
    private const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
    private const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
    private const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
    private const WEBMASTERS_ENDPOINT = 'https://www.googleapis.com/webmasters/v3';
    private const INSPECTION_ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
    private const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

    private const OAUTH_TTL = 10 * MINUTE_IN_SECONDS;
    private const SYNC_LOCK_TTL = 20 * MINUTE_IN_SECONDS;
    private const STATE_LOCK_TTL = 30;
    private const REQUEST_TIMEOUT = 18;
    private const TOKEN_RESPONSE_BYTES = 1024 * 1024;
    private const API_RESPONSE_BYTES = 8 * 1024 * 1024;
    private const SITEMAP_RESPONSE_BYTES = 5 * 1024 * 1024;
    private const SEARCH_ANALYTICS_DAYS = 28;
    private const SEARCH_ANALYTICS_PAGE_SIZE = 25000;
    private const SEARCH_ANALYTICS_MAX_ROWS = 50000;
    private const INVENTORY_MAX_URLS = 10000;
    private const INVENTORY_POST_BATCH = 250;
    private const SITEMAP_MAX_DOCUMENTS = 20;
    private const INSPECTION_MAX_PER_SYNC = 10;
    private const INSPECTION_MAX_PER_DAY = 100;
    private const RETRY_ATTEMPTS = 3;

    private static ?self $instance = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'maybe_upgrade'], 1);
        add_action('init', [$this, 'ensure_schedule'], 20);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('admin_post_' . self::OAUTH_ACTION, [$this, 'handle_oauth_callback']);
        add_action('admin_post_nopriv_' . self::OAUTH_ACTION, [$this, 'handle_oauth_callback_guest']);
        add_action(self::CRON_HOOK, [$this, 'cron_sync']);
        add_action(self::RETRY_HOOK, [$this, 'cron_retry'], 10, 2);
    }

    public static function activate(): void {
        self::install_schema();
        self::grant_capabilities();
        add_option(self::OPTION_SITE_INDEX, [], '', false);
        add_option(self::OPTION_OAUTH_CLIENT_REVISION, 0, '', false);
        update_option(self::OPTION_DB_VERSION, self::DB_VERSION, false);
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CRON_HOOK);
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook(self::CRON_HOOK);
        if (function_exists('wp_unschedule_hook')) {
            wp_unschedule_hook(self::RETRY_HOOK);
        } else {
            for ($attempt = 1; $attempt <= self::RETRY_ATTEMPTS; $attempt++) {
                wp_clear_scheduled_hook(self::RETRY_HOOK, ['', $attempt]);
            }
        }
        foreach (array_keys(self::instance()->site_index()) as $site_key) {
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site_key);
        }
        self::cleanup_ephemeral_options();
    }

    public function maybe_upgrade(): void {
        if ((int) get_option(self::OPTION_DB_VERSION, 0) >= self::DB_VERSION) return;
        $locked_at = absint(get_option(self::OPTION_UPGRADE_LOCK, 0));
        if ($locked_at > 0 && $locked_at < time() - 5 * MINUTE_IN_SECONDS) {
            delete_option(self::OPTION_UPGRADE_LOCK);
        }
        if (!add_option(self::OPTION_UPGRADE_LOCK, time(), '', false)) return;
        try {
            self::activate();
        } finally {
            delete_option(self::OPTION_UPGRADE_LOCK);
        }
    }

    public function ensure_schedule(): void {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CRON_HOOK);
        }
    }

    public function register_rest_routes(): void {
        $base = '/seo/search-console';
        register_rest_route('kodety/v1', $base, [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [$this, 'rest_status'],
                'permission_callback' => [$this, 'status_permission'],
            ],
            [
                'methods' => WP_REST_Server::DELETABLE,
                'callback' => [$this, 'rest_disconnect'],
                'permission_callback' => [$this, 'disconnect_permission'],
            ],
        ]);
        register_rest_route('kodety/v1', $base . '/status', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'rest_status'],
            'permission_callback' => [$this, 'status_permission'],
        ]);
        register_rest_route('kodety/v1', $base . '/connect', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'rest_connect'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
        register_rest_route('kodety/v1', $base . '/oauth-client', [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [$this, 'rest_get_oauth_client'],
                'permission_callback' => [$this, 'oauth_client_metadata_permission'],
            ],
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [$this, 'rest_save_oauth_client'],
                'permission_callback' => [$this, 'manage_permission'],
                'args' => [
                    'clientId' => ['type' => 'string', 'maxLength' => 1024],
                    'clientSecret' => ['type' => 'string', 'maxLength' => 4096],
                ],
            ],
            [
                'methods' => WP_REST_Server::DELETABLE,
                'callback' => [$this, 'rest_delete_oauth_client'],
                'permission_callback' => [$this, 'oauth_client_delete_permission'],
            ],
        ]);
        register_rest_route('kodety/v1', $base . '/property', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'rest_select_property'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
        register_rest_route('kodety/v1', $base . '/sync', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'rest_sync'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
    }

    public function view_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_rest($request, false);
    }

    public function status_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_rest($request, false, false);
    }

    public function manage_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_rest($request, true);
    }

    public function disconnect_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_rest($request, true, false);
    }

    public function oauth_client_delete_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_rest($request, true, false);
    }

    public function oauth_client_metadata_permission(WP_REST_Request $request): bool|WP_Error {
        return $this->authorize_rest($request, true, false);
    }

    private function authorize_rest(
        WP_REST_Request $request,
        bool $manage,
        bool $require_license = true
    ): bool|WP_Error {
        if (!is_user_logged_in()) {
            return new WP_Error('kodety_search_console_unauthorized', 'Autenticação necessária.', ['status' => 401]);
        }
        $capability = $manage ? self::CAP_MANAGE : self::CAP_VIEW;
        $capability = (string) apply_filters(
            $manage ? 'kodety_search_console_manage_capability' : 'kodety_search_console_view_capability',
            $capability
        );
        $allowed = $manage
            ? $this->can_manage_search_console()
            : (current_user_can($capability) || current_user_can('kodety_view_analytics'));
        if (!$allowed) {
            return new WP_Error(
                'kodety_search_console_forbidden',
                $manage
                    ? 'Sem permissão para gerenciar o Google Search Console.'
                    : 'Sem permissão para visualizar o Google Search Console.',
                ['status' => 403]
            );
        }
        $nonce = trim((string) $request->get_header('X-WP-Nonce'));
        if ($nonce === '') $nonce = trim((string) $request->get_param('_wpnonce'));
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error('kodety_search_console_nonce', 'A sessão do SEO expirou.', ['status' => 403]);
        }
        if ($require_license && !$this->licensed()) return $this->license_error();
        return true;
    }

    private function licensed(): bool {
        return class_exists('Kodety_Edition') && Kodety_Edition::has('advancedSeo');
    }

    private function can_manage_search_console(): bool {
        $capability = (string) apply_filters('kodety_search_console_manage_capability', self::CAP_MANAGE);
        return current_user_can($capability) || current_user_can('manage_options');
    }

    private function license_error(): WP_Error {
        $data = ['status' => 403, 'feature' => 'advancedSeo'];
        if (class_exists('Kodety_Edition')) {
            if (method_exists('Kodety_Edition', 'license_url')) $data['licenseUrl'] = Kodety_Edition::license_url();
            if (method_exists('Kodety_Edition', 'upgrade_url')) $data['upgradeUrl'] = Kodety_Edition::upgrade_url();
        }
        return new WP_Error(
            'kodety_search_console_pro_required',
            'Ative uma licença Pro do Onun Kodety para usar o Google Search Console avançado.',
            $data
        );
    }

    public function rest_status(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $site = $this->current_site();
        $configuration = $this->public_oauth_client_configuration();
        if (!$this->licensed()) {
            if (!$this->can_manage_search_console()) return $this->license_error();
            return $this->response([
                'connected' => $this->credential_connected($this->credential($site)),
                'accountEmail' => '',
                'property' => '',
                'properties' => [],
                'lastSyncAt' => '',
                'syncStatus' => 'idle',
                'error' => '',
                'summary' => $this->empty_summary(),
                'rows' => [],
                'proRequired' => true,
                'configurationRequired' => empty($configuration['configured']),
            ]);
        }
        $page = max(1, absint($request->get_param('page') ?: 1));
        $per_page = max(1, min(500, absint($request->get_param('perPage') ?: 250)));
        return $this->response($this->status_payload(
            $site,
            $page,
            $per_page,
            $this->can_manage_search_console()
        ));
    }

    public function rest_get_oauth_client(): WP_REST_Response|WP_Error {
        return $this->response($this->public_oauth_client_configuration());
    }

    public function rest_save_oauth_client(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        if (!$this->callback_url_usable()) return $this->oauth_callback_unusable_error(422);
        $lock_key = $this->oauth_client_lock_key();
        $owner = $this->acquire_state_lock($lock_key);
        if (is_wp_error($owner)) return $owner;
        try {
            $configuration = $this->public_oauth_client_configuration();
            if (!empty($configuration['managedExternally'])) return $this->oauth_client_managed_error();

            $input = $request->get_json_params();
            if (!is_array($input)) $input = [];
            $submitted_client_id = trim((string) ($input['clientId'] ?? $request->get_param('clientId')));
            $submitted_client_secret = trim((string) ($input['clientSecret'] ?? $request->get_param('clientSecret')));
            $current = $this->stored_oauth_client_credentials();
            $current_client_id = is_array($current) ? trim((string) ($current['client_id'] ?? '')) : '';
            $current_client_secret = is_array($current) ? trim((string) ($current['client_secret'] ?? '')) : '';
            $client_id = $submitted_client_id !== '' ? $submitted_client_id : $current_client_id;
            $client_secret = $submitted_client_secret !== '' ? $submitted_client_secret : $current_client_secret;
            $client_id_changed = $submitted_client_id !== ''
                && !hash_equals($current_client_id, $submitted_client_id);
            if ($client_id_changed && $current_client_id !== '' && $submitted_client_secret === '') {
                return new WP_Error(
                    'kodety_search_console_oauth_client_secret_required',
                    'Informe um novo Client Secret ao trocar o Client ID.',
                    ['status' => 422]
                );
            }
            $valid = $this->validate_oauth_client_values($client_id, $client_secret, 422);
            if (is_wp_error($valid)) return $valid;

            $unchanged = is_array($current)
                && hash_equals((string) ($current['client_id'] ?? ''), $client_id)
                && hash_equals((string) ($current['client_secret'] ?? ''), $client_secret);
            if (!$unchanged) {
                $active_connections = $this->active_oauth_connection_count();
                if ($active_connections > 0) return $this->oauth_client_in_use_error($active_connections);
            }

            $missing = new stdClass();
            $previous = get_option(self::OPTION_OAUTH_CLIENT, $missing);
            $previous_revision = $this->oauth_client_revision();
            if (!$unchanged) {
                $protected = $this->encrypt_secret($client_secret, 'oauth-client-secret');
                if (is_wp_error($protected)) return $protected;
                $next = [
                    'client_id' => $client_id,
                    'client_secret' => $protected,
                    'updated_at' => gmdate('c'),
                ];
                update_option(self::OPTION_OAUTH_CLIENT, $next, false);
                if (get_option(self::OPTION_OAUTH_CLIENT, $missing) !== $next) {
                    $this->restore_option_value(self::OPTION_OAUTH_CLIENT, $previous);
                    return new WP_Error(
                        'kodety_search_console_oauth_client_storage',
                        'O WordPress não confirmou a gravação protegida do OAuth.',
                        ['status' => 500, 'retryable' => true]
                    );
                }
            }
            $revision = $this->bump_oauth_client_revision();
            if (is_wp_error($revision)) {
                $this->restore_option_value(self::OPTION_OAUTH_CLIENT, $previous);
                update_option(self::OPTION_OAUTH_CLIENT_REVISION, $previous_revision, false);
                return $revision;
            }
            $this->clear_pending_oauth_states();
            $this->clear_cached_access_tokens();
            return $this->response($this->public_oauth_client_configuration());
        } finally {
            $this->release_state_lock($lock_key, $owner);
        }
    }

    public function rest_delete_oauth_client(): WP_REST_Response|WP_Error {
        $lock_key = $this->oauth_client_lock_key();
        $owner = $this->acquire_state_lock($lock_key);
        if (is_wp_error($owner)) return $owner;
        try {
            $configuration = $this->public_oauth_client_configuration();
            if (!empty($configuration['managedExternally'])) return $this->oauth_client_managed_error();
            $active_connections = $this->active_oauth_connection_count();
            if ($active_connections > 0) return $this->oauth_client_in_use_error($active_connections);

            $missing = new stdClass();
            $previous = get_option(self::OPTION_OAUTH_CLIENT, $missing);
            $previous_revision = $this->oauth_client_revision();
            delete_option(self::OPTION_OAUTH_CLIENT);
            if (get_option(self::OPTION_OAUTH_CLIENT, $missing) !== $missing) {
                return new WP_Error(
                    'kodety_search_console_oauth_client_storage',
                    'O WordPress não conseguiu remover a configuração OAuth.',
                    ['status' => 500, 'retryable' => true]
                );
            }
            $revision = $this->bump_oauth_client_revision();
            if (is_wp_error($revision)) {
                $this->restore_option_value(self::OPTION_OAUTH_CLIENT, $previous);
                update_option(self::OPTION_OAUTH_CLIENT_REVISION, $previous_revision, false);
                return $revision;
            }
            $this->clear_pending_oauth_states();
            $this->clear_cached_access_tokens();
            return $this->response($this->public_oauth_client_configuration());
        } finally {
            $this->release_state_lock($lock_key, $owner);
        }
    }

    public function rest_connect(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        if (!$this->callback_url_usable()) return $this->oauth_callback_unusable_error(409);
        $site = $this->current_site();
        $return_url = $this->safe_return_url((string) $request->get_param('returnUrl'));
        $state = $this->create_oauth_state($site, $return_url);
        if (is_wp_error($state)) return $state;

        $broker_url = apply_filters('kodety_search_console_oauth_broker_authorization_url', '', [
            'state' => $state['state'],
            'siteUrl' => $site['url'],
            'siteKey' => $site['key'],
            'siteCallbackUrl' => $this->callback_url(),
            'codeChallenge' => $state['challenge'],
            'scope' => $this->oauth_scope(),
        ]);
        $authorization_url = is_string($broker_url) ? trim($broker_url) : '';
        if ($authorization_url === '') {
            // Recheck after broker resolution in case the computed admin URL
            // changed while an integration filter was running.
            if (!$this->callback_url_usable()) {
                delete_option($state['option']);
                return $this->oauth_callback_unusable_error(409);
            }
            $credentials = $this->client_credentials();
            if (is_wp_error($credentials)) {
                delete_option($state['option']);
                return $credentials;
            }
            $authorization_url = add_query_arg([
                'client_id' => $credentials['client_id'],
                'redirect_uri' => $this->callback_url(),
                'response_type' => 'code',
                'scope' => $this->oauth_scope(),
                'access_type' => 'offline',
                'prompt' => 'consent',
                'state' => $state['state'],
                'code_challenge' => $state['challenge'],
                'code_challenge_method' => 'S256',
            ], self::AUTH_ENDPOINT);
        }
        if (!$this->safe_external_https_url($authorization_url)) {
            delete_option($state['option']);
            return new WP_Error(
                'kodety_search_console_oauth_url',
                'O provedor OAuth retornou uma URL de conexão inválida.',
                ['status' => 503]
            );
        }
        return $this->response(['authorizationUrl' => $authorization_url]);
    }

    public function rest_select_property(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        $site = $this->current_site();
        $property = trim((string) $request->get_param('property'));
        if ($property === '' || strlen($property) > 2048) {
            return new WP_Error('kodety_search_console_property', 'Selecione uma propriedade válida.', ['status' => 422]);
        }
        $credential = $this->credential($site);
        if (!$this->credential_connected($credential)) {
            return new WP_Error('kodety_search_console_not_connected', 'Conecte uma conta Google primeiro.', ['status' => 409]);
        }
        $properties = $this->public_properties($credential['properties'] ?? []);
        $allowed = array_column($properties, 'url');
        $fresh = null;
        if (!in_array($property, $allowed, true)) {
            $fresh = $this->fetch_properties($site);
            if (is_wp_error($fresh)) return $fresh;
            $properties = $this->public_properties($fresh);
            $allowed = array_column($properties, 'url');
        }
        if (!in_array($property, $allowed, true)) {
            return new WP_Error(
                'kodety_search_console_property_forbidden',
                'A conta Google conectada não possui acesso a essa propriedade.',
                ['status' => 403]
            );
        }

        // fetch_properties() may rotate the refresh token, so snapshot after it.
        $credential = $this->credential($site);
        $credential_token = (string) ($credential['refresh_token'] ?? '');
        $state_owner = $this->acquire_state_lock($site['key']);
        if (is_wp_error($state_owner)) return $state_owner;
        try {
            $current_credential = $this->credential($site);
            $current_token = (string) ($current_credential['refresh_token'] ?? '');
            if (
                !$this->credential_connected($current_credential)
                || $credential_token === ''
                || !hash_equals($credential_token, $current_token)
            ) {
                return new WP_Error(
                    'kodety_search_console_connection_changed',
                    'A conexão com o Google mudou durante a seleção. Tente novamente.',
                    ['status' => 409, 'retryable' => true]
                );
            }
            if (is_array($fresh)) {
                $current_credential['properties'] = $fresh;
                if (!$this->save_credential($site, $current_credential)) return $this->storage_error();
            }
            $current_allowed = array_column(
                $this->public_properties($current_credential['properties'] ?? []),
                'url'
            );
            if (!in_array($property, $current_allowed, true)) {
                return new WP_Error(
                    'kodety_search_console_property_forbidden',
                    'A conta Google conectada não possui acesso a essa propriedade.',
                    ['status' => 403]
                );
            }

            $state = $this->site_state($site);
            $state['property'] = $property;
            $state['sync_generation'] = $this->next_sync_generation($state);
            $state['sync_status'] = 'queued';
            $state['last_error'] = '';
            $state['last_sync_at'] = '';
            $state['queued_inspection_limit'] = min(3, self::INSPECTION_MAX_PER_SYNC);
            if (!$this->save_site_state($site, $state)) return $this->storage_error();
        } finally {
            $this->release_state_lock($site['key'], $state_owner);
        }
        $this->schedule_immediate_sync($site['key']);
        return $this->response($this->status_payload($site));
    }

    public function rest_sync(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        $site = $this->current_site();
        $requested = absint($request->get_param('inspectLimit'));
        $inspection_limit = $requested > 0
            ? min(self::INSPECTION_MAX_PER_SYNC, $requested)
            : min(3, self::INSPECTION_MAX_PER_SYNC);
        $state_owner = $this->acquire_state_lock($site['key']);
        if (is_wp_error($state_owner)) return $state_owner;
        try {
            if (!$this->credential_connected($this->credential($site))) {
                return new WP_Error('kodety_search_console_not_connected', 'Conecte uma conta Google primeiro.', ['status' => 409]);
            }
            $state = $this->site_state($site);
            if (trim((string) ($state['property'] ?? '')) === '') {
                return new WP_Error('kodety_search_console_property_required', 'Selecione uma propriedade do Search Console.', ['status' => 422]);
            }
            $state['sync_generation'] = $this->next_sync_generation($state);
            $state['sync_status'] = 'queued';
            $state['last_error'] = '';
            $state['queued_inspection_limit'] = $inspection_limit;
            if (!$this->save_site_state($site, $state)) return $this->storage_error();
        } finally {
            $this->release_state_lock($site['key'], $state_owner);
        }
        $this->schedule_immediate_sync($site['key']);
        return $this->response($this->status_payload($site), 202);
    }

    public function rest_disconnect(): WP_REST_Response|WP_Error {
        $site = $this->current_site();
        $owner = $this->acquire_sync_lock($site['key']);
        if (is_wp_error($owner)) return $owner;
        $state_owner = $this->acquire_state_lock($site['key']);
        if (is_wp_error($state_owner)) {
            $this->release_sync_lock($site['key'], $owner);
            return $state_owner;
        }

        try {
            $connection_revision = $this->bump_connection_revision($site['key']);
            if (is_wp_error($connection_revision)) return $connection_revision;
            $credential = $this->credential($site);
            $access_token = $this->cached_access_token($site);
            $refresh_token = $this->decrypt_secret(
                (string) ($credential['refresh_token'] ?? ''),
                $this->secret_context('refresh-token', $site)
            );
            $revoke_token = $access_token !== '' ? $access_token : (is_string($refresh_token) ? $refresh_token : '');
            if ($revoke_token !== '') $this->revoke_token($revoke_token);

            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
            delete_option(self::OPTION_CREDENTIAL_PREFIX . $site['key']);
            delete_option(self::OPTION_SITE_PREFIX . $site['key']);
            delete_option(self::OPTION_INSPECTION_USAGE_PREFIX . $site['key']);
            $this->clear_retries($site['key']);
            $index = $this->site_index();
            unset($index[$site['key']]);
            update_option(self::OPTION_SITE_INDEX, $index, false);
            if ((bool) apply_filters('kodety_search_console_purge_data_on_disconnect', true)) {
                global $wpdb;
                $wpdb->delete(self::table(), ['site_key' => $site['key']], ['%s']);
            }
            do_action('kodety_search_console_disconnected', $site);
            return $this->response($this->status_payload($site));
        } finally {
            $this->release_state_lock($site['key'], $state_owner);
            $this->release_sync_lock($site['key'], $owner);
        }
    }

    public function handle_oauth_callback_guest(): void {
        auth_redirect();
        exit;
    }

    public function handle_oauth_callback(): void {
        if (!is_user_logged_in()) {
            auth_redirect();
            exit;
        }
        if (!$this->can_manage_search_console()) {
            wp_die('Sem permissão para conectar o Google Search Console.', 'Acesso negado', ['response' => 403]);
        }
        $raw_state = isset($_GET['state']) ? trim((string) wp_unslash($_GET['state'])) : '';
        $record = $this->consume_oauth_state($raw_state);
        if (is_wp_error($record)) {
            $this->redirect_after_oauth('error', $record->get_error_message());
        }
        $site = $record['site'];
        $return_url = (string) ($record['return_url'] ?? '');
        if (!$this->licensed()) {
            $this->redirect_after_oauth(
                'error',
                'O Google Search Console avançado exige uma licença Pro ativa.',
                $return_url,
                $site
            );
        }
        $provider_error = isset($_GET['error']) ? sanitize_key((string) wp_unslash($_GET['error'])) : '';
        if ($provider_error !== '') {
            $message = $provider_error === 'access_denied'
                ? 'A conexão com o Google foi cancelada.'
                : 'O Google não autorizou a conexão.';
            $this->set_oauth_site_error_if_current($site, $record, $message);
            $this->redirect_after_oauth('error', $message, $return_url, $site);
        }
        $code = isset($_GET['code']) ? trim((string) wp_unslash($_GET['code'])) : '';
        if ($code === '' || strlen($code) > 8192 || preg_match('/[\x00-\x1F\x7F]/', $code)) {
            $this->redirect_after_oauth(
                'error',
                'O Google não devolveu um código de autorização válido.',
                $return_url,
                $site
            );
        }

        $tokens = apply_filters('kodety_search_console_oauth_broker_exchange', null, [
            'code' => $code,
            'state' => $raw_state,
            'codeVerifier' => $record['verifier'],
            'siteUrl' => $record['site']['url'],
            'siteKey' => $record['site']['key'],
            'siteCallbackUrl' => $this->callback_url(),
        ]);
        $broker_exchange = is_array($tokens);
        if (!is_array($tokens) && !is_wp_error($tokens)) {
            $tokens = $this->exchange_authorization_code($code, $record);
        }
        if (is_wp_error($tokens)) {
            $this->set_oauth_site_error_if_current($site, $record, $tokens->get_error_message());
            $this->redirect_after_oauth('error', $tokens->get_error_message(), $return_url, $site);
        }
        if ($broker_exchange) {
            $scope_error = $this->validate_token_scope($tokens, true);
            if (is_wp_error($scope_error)) {
                $this->set_oauth_site_error_if_current($site, $record, $scope_error->get_error_message());
                $this->redirect_after_oauth('error', $scope_error->get_error_message(), $return_url, $site);
            }
        }

        $credential_option = self::OPTION_CREDENTIAL_PREFIX . $site['key'];
        $refresh_token = trim((string) ($tokens['refresh_token'] ?? ''));
        $access_token = trim((string) ($tokens['access_token'] ?? ''));
        if (!$this->valid_oauth_token($refresh_token, 8192)) {
            $message = 'O Google não forneceu acesso offline. Tente conectar novamente e aprove o consentimento.';
            $this->set_oauth_site_error_if_current($site, $record, $message);
            $this->redirect_after_oauth('error', $message, $return_url, $site);
        }
        if (!$this->valid_oauth_token($access_token, 16384)) {
            $message = 'O Google não devolveu uma sessão de acesso válida.';
            $this->set_oauth_site_error_if_current($site, $record, $message);
            $this->redirect_after_oauth('error', $message, $return_url, $site);
        }
        $encrypted = $this->encrypt_secret($refresh_token, $this->secret_context('refresh-token', $site));
        if (is_wp_error($encrypted)) {
            $this->set_oauth_site_error_if_current($site, $record, $encrypted->get_error_message());
            $this->redirect_after_oauth('error', $encrypted->get_error_message(), $return_url, $site);
        }

        if (!$this->cache_access_token($site, $access_token, absint($tokens['expires_in'] ?? 3600))) {
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
            $message = 'O servidor não conseguiu proteger a sessão temporária do Google.';
            $this->set_oauth_site_error_if_current($site, $record, $message);
            $this->redirect_after_oauth('error', $message, $return_url, $site);
        }
        $email = $this->fetch_account_email($access_token);
        $properties = $this->fetch_properties($site);
        if (is_wp_error($properties)) {
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
            $message = $properties->get_error_message();
            $this->set_oauth_site_error_if_current($site, $record, $message);
            $this->redirect_after_oauth('error', $message, $return_url, $site);
        }
        $granted_scope = $tokens['scope'] ?? $this->oauth_scope();
        if (is_array($granted_scope)) $granted_scope = implode(' ', array_map('strval', $granted_scope));
        $credential = [
            'refresh_token' => $encrypted,
            'account_email' => $email,
            'properties' => $properties,
            'scope' => sanitize_text_field((string) $granted_scope),
            'connected_at' => gmdate('c'),
            'updated_at' => gmdate('c'),
        ];
        $site_state_option = self::OPTION_SITE_PREFIX . $site['key'];
        $global_lock_key = $this->oauth_client_lock_key();
        $global_owner = $this->acquire_state_lock($global_lock_key);
        if (is_wp_error($global_owner)) {
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
            $this->redirect_after_oauth('error', $global_owner->get_error_message(), $return_url, $site);
        }
        $state_owner = $this->acquire_state_lock($site['key']);
        if (is_wp_error($state_owner)) {
            $this->release_state_lock($global_lock_key, $global_owner);
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
            $this->redirect_after_oauth('error', $state_owner->get_error_message(), $return_url, $site);
        }

        $persistence_error = null;
        $site_state = null;
        try {
            $revision_error = $this->oauth_state_revisions_current($record, $site);
            if (is_wp_error($revision_error)) {
                $persistence_error = $revision_error;
            } else {
                $previous_credential = get_option($credential_option, null);
                $previous_site_state = get_option($site_state_option, null);
                $previous_site_index = get_option(self::OPTION_SITE_INDEX, null);
                if (!$this->save_credential($site, $credential)) {
                    $this->restore_option_value($credential_option, $previous_credential);
                    $this->restore_option_value(self::OPTION_SITE_INDEX, $previous_site_index);
                    $persistence_error = new WP_Error(
                        'kodety_search_console_oauth_persistence',
                        'A conexão foi autorizada, mas não pôde ser salva no WordPress.',
                        ['status' => 500]
                    );
                } else {
                    $site_state = $this->site_state($site);
                    $site_state['property'] = $this->auto_match_property($site['url'], $properties);
                    $site_state['sync_status'] = $site_state['property'] !== '' ? 'queued' : 'idle';
                    $site_state['last_error'] = '';
                    $site_state['last_sync_at'] = '';
                    $site_state['queued_inspection_limit'] = min(3, self::INSPECTION_MAX_PER_SYNC);
                    if (!$this->save_site_state($site, $site_state)) {
                        $this->restore_option_value($credential_option, $previous_credential);
                        $this->restore_option_value($site_state_option, $previous_site_state);
                        $this->restore_option_value(self::OPTION_SITE_INDEX, $previous_site_index);
                        $persistence_error = new WP_Error(
                            'kodety_search_console_oauth_persistence',
                            'A propriedade do projeto não pôde ser salva.',
                            ['status' => 500]
                        );
                    }
                }
            }
        } finally {
            $this->release_state_lock($site['key'], $state_owner);
            $this->release_state_lock($global_lock_key, $global_owner);
        }
        if (is_wp_error($persistence_error)) {
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
            if ($refresh_token !== '') $this->revoke_token($refresh_token);
            else $this->revoke_token($access_token);
            $this->redirect_after_oauth('error', $persistence_error->get_error_message(), $return_url, $site);
        }
        if ($site_state['property'] !== '') $this->schedule_immediate_sync($site['key']);
        do_action('kodety_search_console_connected', $this->public_credential($credential), $site);
        $this->redirect_after_oauth('connected', 'Google Search Console conectado.', $return_url, $site);
    }

    public function cron_sync(): void {
        if (!$this->licensed()) return;
        $this->cleanup_oauth_states();
        $sites = $this->site_index();
        $limit = max(1, min(100, (int) apply_filters('kodety_search_console_cron_site_limit', 25)));
        $queue = [];
        foreach ($sites as $site_key => $site_url) {
            $site = $this->site_from_values($site_url, $site_key);
            $state = $this->site_state($site);
            if (!$this->credential_connected($this->credential($site))) continue;
            if (trim((string) ($state['property'] ?? '')) === '') continue;
            $attempt = strtotime((string) ($state['last_attempt_at'] ?? ''));
            $queue[] = ['site' => $site, 'last_attempt' => $attempt === false ? 0 : $attempt];
        }
        usort($queue, static function (array $a, array $b): int {
            $attempt_order = $a['last_attempt'] <=> $b['last_attempt'];
            return $attempt_order !== 0 ? $attempt_order : strcmp($a['site']['key'], $b['site']['key']);
        });
        foreach (array_slice($queue, 0, $limit) as $entry) {
            $site = $entry['site'];
            $site_key = $site['key'];
            $result = $this->synchronize_site($site, self::INSPECTION_MAX_PER_SYNC);
            if (is_wp_error($result)) $this->schedule_retry($site_key, 1);
        }
    }

    public function cron_retry(string $site_key = '', int $attempt = 1): void {
        if (!$this->licensed()) return;
        $site_key = preg_match('/^[a-f0-9]{64}$/', $site_key) ? $site_key : '';
        $index = $this->site_index();
        if ($site_key === '' || !isset($index[$site_key])) return;
        $site = $this->site_from_values($index[$site_key], $site_key);
        $state = $this->site_state($site);
        $queued_limit = absint($state['queued_inspection_limit'] ?? 0);
        $inspection_limit = $queued_limit > 0
            ? min(self::INSPECTION_MAX_PER_SYNC, $queued_limit)
            : min(3, self::INSPECTION_MAX_PER_SYNC);
        $result = $this->synchronize_site($site, $inspection_limit);
        if (is_wp_error($result) && $attempt < self::RETRY_ATTEMPTS) {
            $this->schedule_retry($site_key, $attempt + 1);
        }
    }

    /** @return array<string,mixed>|WP_Error */
    private function synchronize_site(array $site, int $inspection_limit) {
        if (!$this->licensed()) return $this->license_error();
        $owner = $this->acquire_sync_lock($site['key']);
        if (is_wp_error($owner)) return $owner;

        try {
            $snapshot = $this->begin_sync_snapshot($site, $inspection_limit);
            if (is_wp_error($snapshot)) return $snapshot;
            $property = $snapshot['property'];
            $generation = $snapshot['generation'];
            $inspection_limit = $snapshot['inspection_limit'];

            $inventory = $this->build_url_inventory($site['url'], $property);
            if (is_wp_error($inventory)) throw new RuntimeException($inventory->get_error_message());
            $analytics = $this->fetch_search_analytics($property, $site);
            if (is_wp_error($analytics)) throw new RuntimeException($analytics->get_error_message());
            $persisted = $this->persist_page_rows(
                $site,
                $property,
                $inventory,
                $analytics['rows'],
                $analytics['startDate'],
                $analytics['endDate']
            );
            if (is_wp_error($persisted)) throw new RuntimeException($persisted->get_error_message());

            $inspection_limit = max(0, min(self::INSPECTION_MAX_PER_SYNC, $inspection_limit));
            if ($inspection_limit > 0) {
                $slots = $this->reserve_inspection_slots($site, $inspection_limit);
                if ($slots > 0) $this->inspect_priority_urls($site, $property, $slots);
            }
            $finished = $this->finish_sync_snapshot($site, $property, $generation, true, '');
            if (is_wp_error($finished)) return $finished;
            if (!empty($finished['superseded'])) {
                if (!empty($finished['queued'])) $this->schedule_immediate_sync($site['key']);
                return ['ok' => true, 'superseded' => true];
            }
            do_action('kodety_search_console_synced', $site, $property);
            return ['ok' => true];
        } catch (Throwable $error) {
            $message = $this->safe_error_message($error->getMessage());
            if (!isset($property, $generation)) {
                return new WP_Error(
                    'kodety_search_console_sync',
                    $message,
                    ['status' => 502, 'retryable' => true]
                );
            }
            $finished = $this->finish_sync_snapshot($site, $property, $generation, false, $message);
            if (is_wp_error($finished)) return $finished;
            if (!empty($finished['superseded'])) {
                if (!empty($finished['queued'])) $this->schedule_immediate_sync($site['key']);
                return ['ok' => false, 'superseded' => true];
            }
            return new WP_Error(
                'kodety_search_console_sync',
                $message,
                ['status' => 502, 'retryable' => true]
            );
        } finally {
            $this->release_sync_lock($site['key'], $owner);
        }
    }

    /** @return array{property:string,generation:int,inspection_limit:int}|WP_Error */
    private function begin_sync_snapshot(array $site, int $fallback_inspection_limit): array|WP_Error {
        $state_owner = $this->acquire_state_lock($site['key']);
        if (is_wp_error($state_owner)) return $state_owner;
        try {
            if (!$this->credential_connected($this->credential($site))) {
                return new WP_Error('kodety_search_console_not_connected', 'Conecte uma conta Google primeiro.', ['status' => 409]);
            }
            $state = $this->site_state($site);
            $property = trim((string) ($state['property'] ?? ''));
            if ($property === '') {
                return new WP_Error('kodety_search_console_property_required', 'Selecione uma propriedade do Search Console.', ['status' => 422]);
            }
            $generation = absint($state['sync_generation'] ?? 0);
            if ($generation <= absint($state['completed_generation'] ?? 0)) {
                $generation = $this->next_sync_generation($state);
                $state['sync_generation'] = $generation;
            }
            $queued_limit = absint($state['queued_inspection_limit'] ?? 0);
            $inspection_limit = $queued_limit > 0
                ? min(self::INSPECTION_MAX_PER_SYNC, $queued_limit)
                : max(0, min(self::INSPECTION_MAX_PER_SYNC, $fallback_inspection_limit));
            $state['sync_status'] = 'syncing';
            $state['last_error'] = '';
            $state['last_attempt_at'] = gmdate('c');
            if (!$this->save_site_state($site, $state)) return $this->storage_error();
            return [
                'property' => $property,
                'generation' => $generation,
                'inspection_limit' => $inspection_limit,
            ];
        } finally {
            $this->release_state_lock($site['key'], $state_owner);
        }
    }

    /** @return array{superseded:bool,queued:bool}|WP_Error */
    private function finish_sync_snapshot(
        array $site,
        string $property,
        int $generation,
        bool $success,
        string $message
    ): array|WP_Error {
        $state_owner = $this->acquire_state_lock($site['key']);
        if (is_wp_error($state_owner)) return $state_owner;
        try {
            $state = $this->site_state($site);
            $current_property = trim((string) ($state['property'] ?? ''));
            $current_generation = absint($state['sync_generation'] ?? 0);
            $current = $current_generation === $generation && hash_equals($current_property, $property);
            if (!$current) {
                return [
                    'superseded' => true,
                    'queued' => $current_property !== '' && $current_generation > $generation,
                ];
            }

            $now = gmdate('c');
            $state['sync_status'] = $success ? 'success' : 'error';
            $state['last_error'] = $success ? '' : $this->safe_error_message($message);
            $state['last_attempt_at'] = $now;
            if ($success) {
                $state['last_sync_at'] = $now;
                $state['queued_inspection_limit'] = 0;
                $state['completed_generation'] = $generation;
            }
            if (!$this->save_site_state($site, $state)) return $this->storage_error();
            if ($success) $this->clear_retries($site['key']);
            return ['superseded' => false, 'queued' => false];
        } finally {
            $this->release_state_lock($site['key'], $state_owner);
        }
    }

    /** @return array{rows:array<string,array<string,float>>,startDate:string,endDate:string}|WP_Error */
    private function fetch_search_analytics(string $property, array $site): array|WP_Error {
        $end = new DateTimeImmutable('-2 days', new DateTimeZone('UTC'));
        $start = $end->modify('-' . (self::SEARCH_ANALYTICS_DAYS - 1) . ' days');
        $endpoint = self::WEBMASTERS_ENDPOINT . '/sites/' . rawurlencode($property) . '/searchAnalytics/query';
        $rows = [];
        $start_row = 0;
        $maximum = max(
            self::SEARCH_ANALYTICS_PAGE_SIZE,
            min(100000, (int) apply_filters('kodety_search_console_analytics_max_rows', self::SEARCH_ANALYTICS_MAX_ROWS))
        );
        while ($start_row < $maximum) {
            $result = $this->authorized_json_request($site, 'POST', $endpoint, [
                'startDate' => $start->format('Y-m-d'),
                'endDate' => $end->format('Y-m-d'),
                'dimensions' => ['page'],
                'type' => 'web',
                'dataState' => 'final',
                'aggregationType' => 'byPage',
                'rowLimit' => min(self::SEARCH_ANALYTICS_PAGE_SIZE, $maximum - $start_row),
                'startRow' => $start_row,
            ]);
            if (is_wp_error($result)) return $result;
            $batch = is_array($result['rows'] ?? null) ? $result['rows'] : [];
            foreach ($batch as $raw) {
                if (!is_array($raw)) continue;
                $url = $this->normalize_site_url((string) (($raw['keys'][0] ?? '')), $site['url'], false);
                if ($url === '') continue;
                $impressions = max(0.0, (float) ($raw['impressions'] ?? 0));
                $clicks = max(0.0, (float) ($raw['clicks'] ?? 0));
                $rows[$url] = [
                    'clicks' => $clicks,
                    'impressions' => $impressions,
                    'ctr' => max(0.0, min(1.0, (float) ($raw['ctr'] ?? ($impressions > 0 ? $clicks / $impressions : 0)))),
                    'position' => max(0.0, (float) ($raw['position'] ?? 0)),
                ];
            }
            $count = count($batch);
            if ($count < self::SEARCH_ANALYTICS_PAGE_SIZE || $count === 0) break;
            $start_row += $count;
        }
        return [
            'rows' => $rows,
            'startDate' => $start->format('Y-m-d'),
            'endDate' => $end->format('Y-m-d'),
        ];
    }

    /** @return array<string,string>|WP_Error URL => source */
    private function build_url_inventory(string $site_url, string $property): array|WP_Error {
        $maximum = max(100, min(50000, (int) apply_filters(
            'kodety_search_console_inventory_max_urls',
            self::INVENTORY_MAX_URLS,
            $site_url
        )));
        $inventory = [];
        $home = $this->normalize_site_url($site_url, $site_url, true);
        if ($home !== '') $inventory[$home] = 'wordpress';

        $post_types = get_post_types(['public' => true], 'names');
        $post_types = is_array($post_types) ? array_values($post_types) : [];
        $post_types = array_values(array_diff($post_types, ['attachment']));
        $offset = 0;
        while ($post_types && count($inventory) < $maximum) {
            $ids = get_posts([
                'post_type' => $post_types,
                'post_status' => 'publish',
                'posts_per_page' => self::INVENTORY_POST_BATCH,
                'offset' => $offset,
                'orderby' => 'ID',
                'order' => 'ASC',
                'fields' => 'ids',
                'no_found_rows' => true,
                'suppress_filters' => false,
            ]);
            $ids = is_array($ids) ? $ids : [];
            foreach ($ids as $post_id) {
                $url = $this->normalize_site_url((string) get_permalink((int) $post_id), $site_url, false);
                if ($url !== '') $inventory[$url] = 'wordpress';
                if (count($inventory) >= $maximum) break;
            }
            if (count($ids) < self::INVENTORY_POST_BATCH) break;
            $offset += self::INVENTORY_POST_BATCH;
        }

        $sitemap = $this->sitemap_inventory($site_url, $maximum - count($inventory));
        foreach ($sitemap as $url) {
            if (!isset($inventory[$url])) $inventory[$url] = 'sitemap';
            if (count($inventory) >= $maximum) break;
        }
        $filtered = apply_filters(
            'kodety_search_console_inventory_urls',
            array_keys($inventory),
            $site_url,
            $property
        );
        if (is_array($filtered)) {
            foreach (array_slice($filtered, 0, $maximum) as $candidate) {
                $url = $this->normalize_site_url((string) $candidate, $site_url, false);
                if ($url !== '' && !isset($inventory[$url])) $inventory[$url] = 'filtered';
            }
        }
        return array_slice($inventory, 0, $maximum, true);
    }

    /** @return list<string> */
    private function sitemap_inventory(string $site_url, int $remaining): array {
        if ($remaining <= 0 || !function_exists('simplexml_load_string')) return [];
        $candidates = [
            trailingslashit($site_url) . 'wp-sitemap.xml',
            trailingslashit($site_url) . 'sitemap.xml',
        ];
        $filtered = apply_filters('kodety_search_console_sitemap_urls', $candidates, $site_url);
        $queue = is_array($filtered) ? array_values($filtered) : $candidates;
        $seen_documents = [];
        $urls = [];
        while ($queue && count($seen_documents) < self::SITEMAP_MAX_DOCUMENTS && count($urls) < $remaining) {
            $candidate = array_shift($queue);
            $sitemap_url = $this->normalize_site_url((string) $candidate, $site_url, false);
            if ($sitemap_url === '' || isset($seen_documents[$sitemap_url])) continue;
            $seen_documents[$sitemap_url] = true;
            $response = wp_safe_remote_get($sitemap_url, [
                'timeout' => 10,
                'redirection' => 0,
                'reject_unsafe_urls' => true,
                'limit_response_size' => self::SITEMAP_RESPONSE_BYTES,
                'headers' => ['Accept' => 'application/xml,text/xml;q=0.9'],
            ]);
            if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) continue;
            $body = (string) wp_remote_retrieve_body($response);
            if ($body === '' || strlen($body) > self::SITEMAP_RESPONSE_BYTES) continue;
            $previous = libxml_use_internal_errors(true);
            $xml = simplexml_load_string($body, SimpleXMLElement::class, LIBXML_NONET | LIBXML_NOCDATA);
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
            if (!$xml instanceof SimpleXMLElement) continue;
            if (strtolower($xml->getName()) === 'sitemapindex') {
                foreach ($xml->xpath('//*[local-name()="sitemap"]/*[local-name()="loc"]') ?: [] as $loc) {
                    $nested = $this->normalize_site_url(trim((string) $loc), $site_url, false);
                    if ($nested !== '' && !isset($seen_documents[$nested])) $queue[] = $nested;
                    if (count($queue) + count($seen_documents) >= self::SITEMAP_MAX_DOCUMENTS) break;
                }
                continue;
            }
            foreach ($xml->xpath('//*[local-name()="url"]/*[local-name()="loc"]') ?: [] as $loc) {
                $url = $this->normalize_site_url(trim((string) $loc), $site_url, false);
                if ($url !== '') $urls[$url] = true;
                if (count($urls) >= $remaining) break;
            }
        }
        return array_keys($urls);
    }

    /** @param array<string,string> $inventory @param array<string,array<string,float>> $metrics */
    private function persist_page_rows(
        array $site,
        string $property,
        array $inventory,
        array $metrics,
        string $start_date,
        string $end_date
    ): bool|WP_Error {
        global $wpdb;
        $table = self::table();
        $property_hash = hash('sha256', $property);
        $now = gmdate('Y-m-d H:i:s');
        $wpdb->query('START TRANSACTION');
        try {
            foreach (array_chunk($inventory, 200, true) as $chunk) {
                $values = [];
                $params = [];
                foreach ($chunk as $url => $source) {
                    $values[] = '(%s,%s,%s,%s,%s,%s,%s,%s,%s)';
                    array_push(
                        $params,
                        $this->row_hash($site['key'], $property, $url),
                        $site['key'],
                        $property_hash,
                        $property,
                        hash('sha256', $url),
                        $url,
                        sanitize_key($source),
                        $now,
                        $now
                    );
                }
                $sql = "INSERT INTO {$table} (row_hash,site_key,property_hash,property_url,url_hash,url,source,last_seen_at,updated_at) VALUES "
                    . implode(',', $values)
                    . ' ON DUPLICATE KEY UPDATE source=VALUES(source),last_seen_at=VALUES(last_seen_at),updated_at=VALUES(updated_at)';
                if ($wpdb->query($wpdb->prepare($sql, ...$params)) === false) throw new RuntimeException('inventory');
            }
            $reset = $wpdb->query($wpdb->prepare(
                "UPDATE {$table} SET clicks=0,impressions=0,ctr=0,position=0,metrics_start=%s,metrics_end=%s,updated_at=%s WHERE site_key=%s AND property_hash=%s",
                $start_date,
                $end_date,
                $now,
                $site['key'],
                $property_hash
            ));
            if ($reset === false) throw new RuntimeException('reset');

            foreach (array_chunk($metrics, 200, true) as $chunk) {
                $values = [];
                $params = [];
                foreach ($chunk as $url => $row) {
                    $values[] = '(%s,%s,%s,%s,%s,%s,%s,%s,%s,%f,%f,%f,%f,%s,%s)';
                    array_push(
                        $params,
                        $this->row_hash($site['key'], $property, $url),
                        $site['key'],
                        $property_hash,
                        $property,
                        hash('sha256', $url),
                        $url,
                        'search-console',
                        $start_date,
                        $end_date,
                        (float) $row['clicks'],
                        (float) $row['impressions'],
                        (float) $row['ctr'],
                        (float) $row['position'],
                        $now,
                        $now
                    );
                }
                $sql = "INSERT INTO {$table} (row_hash,site_key,property_hash,property_url,url_hash,url,source,metrics_start,metrics_end,clicks,impressions,ctr,position,last_seen_at,updated_at) VALUES "
                    . implode(',', $values)
                    . ' ON DUPLICATE KEY UPDATE clicks=VALUES(clicks),impressions=VALUES(impressions),ctr=VALUES(ctr),position=VALUES(position),metrics_start=VALUES(metrics_start),metrics_end=VALUES(metrics_end),last_seen_at=VALUES(last_seen_at),updated_at=VALUES(updated_at)';
                if ($wpdb->query($wpdb->prepare($sql, ...$params)) === false) throw new RuntimeException('metrics');
            }
            if ($wpdb->query($wpdb->prepare(
                "DELETE FROM {$table} WHERE site_key=%s AND property_hash=%s AND last_seen_at<%s",
                $site['key'],
                $property_hash,
                $now
            )) === false) throw new RuntimeException('cleanup');
            $wpdb->query('COMMIT');
            return true;
        } catch (Throwable) {
            $wpdb->query('ROLLBACK');
            return new WP_Error(
                'kodety_search_console_storage',
                'As métricas recebidas do Google não puderam ser salvas.',
                ['status' => 503]
            );
        }
    }

    private function inspect_priority_urls(array $site, string $property, int $limit): void {
        global $wpdb;
        $table = self::table();
        $rows = $wpdb->get_col($wpdb->prepare(
            "SELECT url FROM {$table} WHERE site_key=%s AND property_hash=%s ORDER BY CASE WHEN last_inspected_at IS NULL THEN 0 ELSE 1 END ASC, impressions DESC, last_inspected_at ASC LIMIT %d",
            $site['key'],
            hash('sha256', $property),
            max(1, min(self::INSPECTION_MAX_PER_SYNC, $limit))
        ));
        foreach (is_array($rows) ? $rows : [] as $candidate) {
            $url = $this->normalize_site_url((string) $candidate, $site['url'], false);
            if ($url === '') continue;
            $result = $this->authorized_json_request($site, 'POST', self::INSPECTION_ENDPOINT, [
                'inspectionUrl' => $url,
                'siteUrl' => $property,
                'languageCode' => 'pt-BR',
            ]);
            if (is_wp_error($result)) {
                $status = (int) ($result->get_error_data()['status'] ?? 0);
                if ($status === 429 || $status >= 500) break;
                continue;
            }
            $index = is_array($result['inspectionResult']['indexStatusResult'] ?? null)
                ? $result['inspectionResult']['indexStatusResult']
                : [];
            $verdict = strtoupper(sanitize_key((string) ($index['verdict'] ?? '')));
            $coverage = substr(sanitize_text_field((string) ($index['coverageState'] ?? '')), 0, 191);
            $indexing = substr(sanitize_key((string) ($index['indexingState'] ?? '')), 0, 32);
            $robots = substr(sanitize_key((string) ($index['robotsTxtState'] ?? '')), 0, 32);
            $fetch = substr(sanitize_key((string) ($index['pageFetchState'] ?? '')), 0, 32);
            $user_canonical = $this->safe_google_url((string) ($index['userCanonical'] ?? ''));
            $google_canonical = $this->safe_google_url((string) ($index['googleCanonical'] ?? ''));
            $status = $verdict === 'PASS' ? 'indexed' : ($verdict === '' ? 'unknown' : 'issue');
            $canonical_issue = '';
            if ($user_canonical !== '' && $google_canonical !== '' && !hash_equals($user_canonical, $google_canonical)) {
                $canonical_issue = 'O Google escolheu outra URL canônica.';
            }
            $wpdb->update($table, [
                'index_status' => $status,
                'canonical_issue' => substr($canonical_issue, 0, 191),
                'coverage_state' => $coverage,
                'indexing_state' => $indexing,
                'robots_txt_state' => $robots,
                'page_fetch_state' => $fetch,
                'user_canonical' => $user_canonical,
                'google_canonical' => $google_canonical,
                'last_inspected_at' => gmdate('Y-m-d H:i:s'),
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ], [
                'site_key' => $site['key'],
                'property_hash' => hash('sha256', $property),
                'url_hash' => hash('sha256', $url),
            ]);
        }
    }

    private function fetch_properties(array $site): array|WP_Error {
        $result = $this->authorized_json_request($site, 'GET', self::WEBMASTERS_ENDPOINT . '/sites');
        if (is_wp_error($result)) return $result;
        $properties = [];
        foreach (is_array($result['siteEntry'] ?? null) ? $result['siteEntry'] : [] as $entry) {
            if (!is_array($entry)) continue;
            $url = trim((string) ($entry['siteUrl'] ?? ''));
            if (!$this->valid_property_url($url)) continue;
            $properties[$url] = [
                'url' => $url,
                'permissionLevel' => substr(sanitize_key((string) ($entry['permissionLevel'] ?? '')), 0, 64),
            ];
        }
        ksort($properties, SORT_NATURAL | SORT_FLAG_CASE);
        return array_values($properties);
    }

    private function auto_match_property(string $site_url, array $properties): string {
        $site_parts = wp_parse_url($site_url);
        $site_host = strtolower((string) ($site_parts['host'] ?? ''));
        $site_origin = $this->origin($site_url);
        $site_path = trailingslashit((string) ($site_parts['path'] ?? '/'));
        $winner = '';
        $score = -1;
        foreach ($this->public_properties($properties) as $property) {
            $value = $property['url'];
            $candidate_score = -1;
            if (str_starts_with($value, 'sc-domain:')) {
                $domain = strtolower(substr($value, 10));
                if ($domain !== '' && ($site_host === $domain || str_ends_with($site_host, '.' . $domain))) {
                    $candidate_score = 70 + strlen($domain);
                }
            } else {
                $parts = wp_parse_url($value);
                $origin = $this->origin($value);
                $path = trailingslashit((string) ($parts['path'] ?? '/'));
                if ($origin !== '' && hash_equals($origin, $site_origin) && str_starts_with($site_path, $path)) {
                    $candidate_score = 100 + strlen($path);
                }
            }
            if ($candidate_score > $score) {
                $winner = $value;
                $score = $candidate_score;
            }
        }
        return $winner;
    }

    private function status_payload(
        array $site,
        int $page = 1,
        int $per_page = 250,
        bool $include_connection_details = true
    ): array {
        $credential = $this->credential($site);
        $state = $this->site_state($site);
        $connected = $this->credential_connected($credential);
        $property = $connected ? trim((string) ($state['property'] ?? '')) : '';
        $report = $property !== ''
            ? $this->page_report($site['key'], $property, $page, $per_page)
            : ['summary' => $this->empty_summary(), 'rows' => []];
        $oauth_client = $this->public_oauth_client_configuration();
        return [
            'connected' => $connected,
            'accountEmail' => $connected && $include_connection_details
                ? sanitize_email((string) ($credential['account_email'] ?? ''))
                : '',
            'property' => $property,
            'properties' => $connected && $include_connection_details
                ? $this->public_properties($credential['properties'] ?? [])
                : [],
            'lastSyncAt' => (string) ($state['last_sync_at'] ?? ''),
            'syncStatus' => (string) ($state['sync_status'] ?? 'idle'),
            'error' => (string) ($state['last_error'] ?? ''),
            'configurationRequired' => empty($oauth_client['configured']),
            'summary' => $report['summary'],
            'rows' => $report['rows'],
        ];
    }

    private function page_report(string $site_key, string $property, int $page, int $per_page): array {
        global $wpdb;
        $table = self::table();
        $property_hash = hash('sha256', $property);
        $summary = $wpdb->get_row($wpdb->prepare(
            "SELECT COALESCE(SUM(clicks),0) clicks,COALESCE(SUM(impressions),0) impressions,COALESCE(SUM(clicks)/NULLIF(SUM(impressions),0),0) ctr,COALESCE(SUM(position*impressions)/NULLIF(SUM(impressions),0),0) position,COUNT(*) total_urls,SUM(CASE WHEN index_status='indexed' THEN 1 ELSE 0 END) indexed_urls,SUM(CASE WHEN index_status='issue' OR canonical_issue<>'' THEN 1 ELSE 0 END) issue_urls FROM {$table} WHERE site_key=%s AND property_hash=%s",
            $site_key,
            $property_hash
        ), ARRAY_A);
        $offset = max(0, ($page - 1) * $per_page);
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT url,clicks,impressions,ctr,position,index_status,coverage_state,canonical_issue FROM {$table} WHERE site_key=%s AND property_hash=%s ORDER BY impressions DESC,clicks DESC,url ASC LIMIT %d OFFSET %d",
            $site_key,
            $property_hash,
            $per_page,
            $offset
        ), ARRAY_A);
        return [
            'summary' => [
                'clicks' => (float) ($summary['clicks'] ?? 0),
                'impressions' => (float) ($summary['impressions'] ?? 0),
                'ctr' => (float) ($summary['ctr'] ?? 0),
                'position' => (float) ($summary['position'] ?? 0),
                'totalUrls' => (int) ($summary['total_urls'] ?? 0),
                'indexedUrls' => (int) ($summary['indexed_urls'] ?? 0),
                'issueUrls' => (int) ($summary['issue_urls'] ?? 0),
            ],
            'rows' => array_map(static fn(array $row): array => [
                'url' => (string) $row['url'],
                'clicks' => (float) $row['clicks'],
                'impressions' => (float) $row['impressions'],
                'ctr' => (float) $row['ctr'],
                'position' => (float) $row['position'],
                'indexStatus' => (string) ($row['index_status'] ?: 'unknown'),
                'indexIssue' => (string) (($row['index_status'] ?? '') === 'indexed'
                    ? ''
                    : ($row['coverage_state'] ?: 'URL ainda não confirmada como indexada.')),
                'canonicalIssue' => (string) $row['canonical_issue'],
            ], is_array($rows) ? $rows : []),
        ];
    }

    private function empty_summary(): array {
        return [
            'clicks' => 0.0,
            'impressions' => 0.0,
            'ctr' => 0.0,
            'position' => 0.0,
            'totalUrls' => 0,
            'indexedUrls' => 0,
            'issueUrls' => 0,
        ];
    }

    private function create_oauth_state(array $site, string $return_url = ''): array|WP_Error {
        $this->cleanup_oauth_states();
        try {
            $state = $this->base64url_encode(random_bytes(32));
            $verifier = $this->base64url_encode(random_bytes(48));
        } catch (Throwable) {
            return new WP_Error('kodety_search_console_oauth_random', 'Não foi possível iniciar uma conexão segura.', ['status' => 503]);
        }
        $protected = $this->encrypt_secret($verifier, 'oauth-verifier');
        if (is_wp_error($protected)) return $protected;
        $option = self::OPTION_OAUTH_PREFIX . hash('sha256', $state);
        $record = [
            'user_id' => get_current_user_id(),
            'created_at' => time(),
            'site_key' => $site['key'],
            'site_url' => $site['url'],
            'site_hash' => hash_hmac('sha256', $site['url'], wp_salt('nonce')),
            'oauth_client_revision' => $this->oauth_client_revision(),
            'connection_revision' => $this->connection_revision($site['key']),
            'verifier' => $protected,
            'return_url' => $this->safe_return_url($return_url),
        ];
        if (!add_option($option, $record, '', false)) {
            return new WP_Error('kodety_search_console_oauth_state', 'Não foi possível iniciar a conexão com o Google.', ['status' => 503]);
        }
        return [
            'state' => $state,
            'challenge' => $this->base64url_encode(hash('sha256', $verifier, true)),
            'option' => $option,
        ];
    }

    private function consume_oauth_state(string $state): array|WP_Error {
        if (!preg_match('/^[A-Za-z0-9_-]{40,128}$/D', $state)) {
            return new WP_Error('kodety_search_console_oauth_state', 'A conexão expirou ou é inválida.', ['status' => 403]);
        }
        $option = self::OPTION_OAUTH_PREFIX . hash('sha256', $state);
        $record = get_option($option, null);
        delete_option($option); // Consume before any network request; replay always fails.
        if (!is_array($record)) {
            return new WP_Error('kodety_search_console_oauth_state', 'A conexão expirou ou já foi utilizada.', ['status' => 403]);
        }
        $site = $this->site_from_values((string) ($record['site_url'] ?? ''), (string) ($record['site_key'] ?? ''));
        $expected_hash = hash_hmac('sha256', $site['url'], wp_salt('nonce'));
        if (
            absint($record['user_id'] ?? 0) !== get_current_user_id()
            || absint($record['created_at'] ?? 0) < time() - self::OAUTH_TTL
            || !hash_equals($expected_hash, (string) ($record['site_hash'] ?? ''))
        ) {
            return new WP_Error('kodety_search_console_oauth_state', 'A conexão expirou ou pertence a outra sessão.', ['status' => 403]);
        }
        $verifier = $this->decrypt_secret((string) ($record['verifier'] ?? ''), 'oauth-verifier');
        if (!is_string($verifier) || !preg_match('/^[A-Za-z0-9_-]{43,128}$/D', $verifier)) {
            return new WP_Error('kodety_search_console_oauth_state', 'A proteção PKCE da conexão não pôde ser validada.', ['status' => 503]);
        }
        return [
            'site' => $site,
            'verifier' => $verifier,
            'return_url' => $this->safe_return_url((string) ($record['return_url'] ?? '')),
            'oauth_client_revision' => absint($record['oauth_client_revision'] ?? 0),
            'connection_revision' => absint($record['connection_revision'] ?? 0),
        ];
    }

    private function exchange_authorization_code(string $code, array $record): array|WP_Error {
        $credentials = $this->client_credentials();
        if (is_wp_error($credentials)) return $credentials;
        return $this->token_request([
            'code' => $code,
            'client_id' => $credentials['client_id'],
            'client_secret' => $credentials['client_secret'],
            'redirect_uri' => $this->callback_url(),
            'grant_type' => 'authorization_code',
            'code_verifier' => $record['verifier'],
        ]);
    }

    private function access_token(array $site): string|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        $cached = $this->cached_access_token($site);
        if ($cached !== '') return $cached;
        $credential = $this->credential($site);
        $refresh = $this->decrypt_secret(
            (string) ($credential['refresh_token'] ?? ''),
            $this->secret_context('refresh-token', $site)
        );
        if (is_wp_error($refresh) || $refresh === '') {
            return new WP_Error('kodety_search_console_token', 'A conexão com o Google precisa ser refeita.', ['status' => 401]);
        }
        $broker = apply_filters('kodety_search_console_oauth_broker_refresh', null, [
            'siteUrl' => $site['url'],
            'siteKey' => $site['key'],
            'refreshToken' => $refresh,
        ]);
        if (is_wp_error($broker)) {
            return $broker;
        } elseif (is_array($broker)) {
            $tokens = $broker;
            $scope_error = $this->validate_token_scope($tokens, true);
            if (is_wp_error($scope_error)) return $scope_error;
        } else {
            $credentials = $this->client_credentials();
            if (is_wp_error($credentials)) return $credentials;
            $tokens = $this->token_request([
                'client_id' => $credentials['client_id'],
                'client_secret' => $credentials['client_secret'],
                'refresh_token' => $refresh,
                'grant_type' => 'refresh_token',
            ]);
            if (is_wp_error($tokens)) return $tokens;
        }
        $token = trim((string) ($tokens['access_token'] ?? ''));
        if (!$this->valid_oauth_token($token, 16384)) {
            return new WP_Error('kodety_search_console_token', 'O Google não renovou a sessão.', ['status' => 502]);
        }
        $rotated = trim((string) ($tokens['refresh_token'] ?? ''));
        if ($rotated !== '') {
            if (!$this->valid_oauth_token($rotated, 8192)) {
                return new WP_Error('kodety_search_console_token', 'O Google devolveu uma credencial inválida.', ['status' => 502]);
            }
            $protected = $this->encrypt_secret($rotated, $this->secret_context('refresh-token', $site));
            if (is_wp_error($protected)) return $protected;
            $credential['refresh_token'] = $protected;
            $credential['updated_at'] = gmdate('c');
            if (!$this->save_credential($site, $credential)) return $this->storage_error();
        }
        $this->cache_access_token($site, $token, absint($tokens['expires_in'] ?? 3600));
        return $token;
    }

    private function token_request(array $body): array|WP_Error {
        $response = wp_safe_remote_post(self::TOKEN_ENDPOINT, [
            'timeout' => self::REQUEST_TIMEOUT,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => self::TOKEN_RESPONSE_BYTES,
            'headers' => ['Accept' => 'application/json'],
            'body' => $body,
        ]);
        if (is_wp_error($response)) {
            return new WP_Error('kodety_search_console_token', 'Não foi possível acessar o OAuth do Google.', ['status' => 502, 'retryable' => true]);
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        if (
            $status < 200 || $status >= 300 || !is_array($decoded)
            || !$this->valid_oauth_token(trim((string) ($decoded['access_token'] ?? '')), 16384)
        ) {
            return new WP_Error(
                'kodety_search_console_token',
                $status === 400 ? 'O Google recusou ou expirou a autorização.' : 'O Google não concluiu a autorização.',
                ['status' => $status === 400 ? 401 : 502, 'retryable' => $status >= 500]
            );
        }
        $scope_error = $this->validate_token_scope($decoded, false);
        if (is_wp_error($scope_error)) return $scope_error;
        return $decoded;
    }

    private function validate_token_scope(array $tokens, bool $required): bool|WP_Error {
        $raw = $tokens['scope'] ?? '';
        $scopes = is_array($raw)
            ? array_values(array_filter(array_map('strval', $raw)))
            : (preg_split('/\s+/', trim((string) $raw), -1, PREG_SPLIT_NO_EMPTY) ?: []);
        $full_scope = substr(self::READONLY_SCOPE, 0, -strlen('.readonly'));
        if (in_array($full_scope, $scopes, true)) {
            return new WP_Error(
                'kodety_search_console_scope',
                'A conexão solicitou permissão de escrita, que o Onun Kodety não aceita.',
                ['status' => 403]
            );
        }
        if (($required || $scopes) && !in_array(self::READONLY_SCOPE, $scopes, true)) {
            return new WP_Error(
                'kodety_search_console_scope',
                'A permissão de leitura do Search Console não foi concedida.',
                ['status' => 403]
            );
        }
        return true;
    }

    private function valid_oauth_token(string $token, int $maximum_length): bool {
        return $token !== ''
            && strlen($token) <= $maximum_length
            && !preg_match('/[\x00-\x20\x7F]/', $token);
    }

    private function authorized_json_request(array $site, string $method, string $url, ?array $body = null, bool $retry = true): array|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        if (!$this->allowed_google_endpoint($url)) {
            return new WP_Error('kodety_search_console_endpoint', 'Endpoint externo não permitido.', ['status' => 500]);
        }
        $token = $this->access_token($site);
        if (is_wp_error($token)) return $token;
        $options = [
            'method' => strtoupper($method),
            'timeout' => self::REQUEST_TIMEOUT,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => self::API_RESPONSE_BYTES,
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Accept' => 'application/json',
            ],
        ];
        if ($body !== null) {
            $options['headers']['Content-Type'] = 'application/json';
            $options['body'] = wp_json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $options['data_format'] = 'body';
        }
        $response = wp_safe_remote_request($url, $options);
        if (is_wp_error($response)) {
            return new WP_Error('kodety_search_console_google', 'Não foi possível acessar o Google Search Console.', ['status' => 502, 'retryable' => true]);
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        if ($status === 401 && $retry) {
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
            return $this->authorized_json_request($site, $method, $url, $body, false);
        }
        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($status < 200 || $status >= 300 || !is_array($decoded)) {
            $retryable = in_array($status, [408, 425, 429], true) || $status >= 500;
            $retry_after = absint(wp_remote_retrieve_header($response, 'retry-after'));
            $data = ['status' => $status ?: 502, 'retryable' => $retryable];
            if ($retry_after > 0) $data['retry_after'] = min(HOUR_IN_SECONDS, $retry_after);
            return new WP_Error(
                'kodety_search_console_google',
                $status === 403
                    ? 'O Google recusou o acesso à propriedade selecionada.'
                    : ($status === 429 ? 'O limite temporário do Google foi atingido.' : 'O Google Search Console retornou uma resposta inválida.'),
                $data
            );
        }
        return $decoded;
    }

    private function fetch_account_email(string $access_token): string {
        $response = wp_safe_remote_get(self::USERINFO_ENDPOINT, [
            'timeout' => 10,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => 256 * 1024,
            'headers' => ['Authorization' => 'Bearer ' . $access_token, 'Accept' => 'application/json'],
        ]);
        if (is_wp_error($response) || (int) wp_remote_retrieve_response_code($response) !== 200) return '';
        $data = json_decode((string) wp_remote_retrieve_body($response), true);
        if (!is_array($data) || empty($data['email_verified'])) return '';
        return sanitize_email((string) ($data['email'] ?? ''));
    }

    private function revoke_token(string $token): void {
        if ($token === '') return;
        wp_safe_remote_post(self::REVOKE_ENDPOINT, [
            'timeout' => 8,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => 256 * 1024,
            'headers' => ['Content-Type' => 'application/x-www-form-urlencoded'],
            'body' => ['token' => $token],
        ]);
    }

    private function client_credentials(): array|WP_Error {
        $resolution = $this->resolve_oauth_client_credentials();
        if (is_wp_error($resolution['error'])) return $resolution['error'];
        return [
            'client_id' => $resolution['client_id'],
            'client_secret' => $resolution['client_secret'],
        ];
    }

    /** @return array{client_id:string,client_secret:string}|WP_Error */
    private function stored_oauth_client_credentials(): array|WP_Error {
        $stored = get_option(self::OPTION_OAUTH_CLIENT, []);
        if (!is_array($stored)) return [];
        $client_id = trim((string) ($stored['client_id'] ?? ''));
        $protected = trim((string) ($stored['client_secret'] ?? ''));
        if ($client_id === '' && $protected === '') return [];
        if ($client_id === '' || $protected === '') {
            return $this->oauth_client_configuration_error(
                'A configuração OAuth salva no WordPress está incompleta.',
                503
            );
        }
        $client_secret = $this->decrypt_secret($protected, 'oauth-client-secret');
        if (is_wp_error($client_secret)) {
            return $this->oauth_client_configuration_error(
                'A credencial OAuth salva no WordPress não pôde ser lida.',
                503
            );
        }
        $valid = $this->validate_oauth_client_values($client_id, $client_secret, 503);
        if (is_wp_error($valid)) return $valid;
        return ['client_id' => $client_id, 'client_secret' => $client_secret];
    }

    /**
     * Resolve the operational OAuth client while preserving the legacy filter
     * contract. wp-config.php is authoritative over the WordPress option, and
     * filters remain the final deployment-level override.
     *
     * @return array{client_id:string,client_secret:string,source:string,managed_externally:bool,editable:bool,error:WP_Error|null}
     */
    private function resolve_oauth_client_credentials(): array {
        $constant_override = defined('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID')
            || defined('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET');
        $source = 'none';
        $managed_externally = false;
        $base_error = null;
        if ($constant_override) {
            $client_id = defined('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID')
                ? trim((string) constant('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID'))
                : '';
            $client_secret = defined('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET')
                ? trim((string) constant('KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET'))
                : '';
            $source = 'server';
            $managed_externally = true;
        } else {
            $stored = $this->stored_oauth_client_credentials();
            if (is_wp_error($stored)) {
                $client_id = '';
                $client_secret = '';
                $base_error = $stored;
                $source = 'wordpress';
            } else {
                $client_id = trim((string) ($stored['client_id'] ?? ''));
                $client_secret = trim((string) ($stored['client_secret'] ?? ''));
                if ($client_id !== '' || $client_secret !== '') $source = 'wordpress';
            }
        }

        $base_client_id = $client_id;
        $base_client_secret = $client_secret;
        $pair = apply_filters('kodety_search_console_oauth_credentials', [
            'client_id' => apply_filters('kodety_search_console_client_id', $client_id),
            'client_secret' => apply_filters('kodety_search_console_client_secret', $client_secret),
        ]);
        $client_id = is_array($pair) ? trim((string) ($pair['client_id'] ?? '')) : '';
        $client_secret = is_array($pair) ? trim((string) ($pair['client_secret'] ?? '')) : '';
        $filtered = !hash_equals($base_client_id, $client_id)
            || !hash_equals($base_client_secret, $client_secret);
        if ($filtered) {
            $source = 'server';
            $managed_externally = true;
            $base_error = null;
        }
        $valid = $this->validate_oauth_client_values($client_id, $client_secret, 409);
        $error = is_wp_error($valid) ? ($base_error ?? $valid) : null;
        return [
            'client_id' => $client_id,
            'client_secret' => $client_secret,
            'source' => $source,
            'managed_externally' => $managed_externally,
            'editable' => !$managed_externally,
            'error' => $error,
        ];
    }

    private function public_oauth_client_configuration(): array {
        if ($this->oauth_broker_configured()) {
            return [
                'configured' => true,
                'source' => 'server',
                'managedExternally' => true,
                'editable' => false,
                'clientIdHint' => '',
                'hasClientSecret' => true,
                'callbackUrl' => $this->callback_url(),
                'callbackUsable' => $this->callback_url_usable(),
            ];
        }
        $resolution = $this->resolve_oauth_client_credentials();
        $configured = !is_wp_error($resolution['error']);
        return [
            'configured' => $configured,
            'source' => $resolution['source'],
            'managedExternally' => $resolution['managed_externally'],
            'editable' => $resolution['editable'],
            'clientIdHint' => $this->redact_client_id($resolution['client_id']),
            'hasClientSecret' => $configured && $resolution['client_secret'] !== '',
            'callbackUrl' => $this->callback_url(),
            'callbackUsable' => $this->callback_url_usable(),
        ];
    }

    private function oauth_broker_configured(): bool {
        if ((bool) apply_filters('kodety_search_console_oauth_broker_configured', false)) return true;
        return function_exists('has_filter')
            && has_filter('kodety_search_console_oauth_broker_authorization_url') !== false;
    }

    private function validate_oauth_client_values(
        string $client_id,
        string $client_secret,
        int $status
    ): bool|WP_Error {
        if (
            $client_id === '' || strlen($client_id) > 1024
            || !preg_match('/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/iD', $client_id)
            || $client_secret === '' || strlen($client_secret) > 4096
            || preg_match('/[\x00-\x20\x7F]/', $client_id . $client_secret)
        ) {
            return $this->oauth_client_configuration_error(
                'Configure o OAuth do Google Search Console no WordPress antes de conectar.',
                $status
            );
        }
        return true;
    }

    private function oauth_client_configuration_error(string $message, int $status): WP_Error {
        return new WP_Error(
            'kodety_search_console_client',
            $message,
            ['status' => $status, 'configurationRequired' => true]
        );
    }

    private function redact_client_id(string $client_id): string {
        $length = strlen($client_id);
        if ($length === 0) return '';
        if ($length <= 12) return str_repeat('•', min(8, $length));
        return substr($client_id, 0, 6) . '…' . substr($client_id, -26);
    }

    private function oauth_client_lock_key(): string {
        return hash('sha256', 'kodety-search-console-oauth-client');
    }

    private function oauth_client_revision(): int {
        return max(0, absint(get_option(self::OPTION_OAUTH_CLIENT_REVISION, 0)));
    }

    private function bump_oauth_client_revision(): int|WP_Error {
        $next = $this->oauth_client_revision() + 1;
        update_option(self::OPTION_OAUTH_CLIENT_REVISION, $next, false);
        if ((int) get_option(self::OPTION_OAUTH_CLIENT_REVISION, -1) !== $next) {
            return new WP_Error(
                'kodety_search_console_oauth_revision_storage',
                'O WordPress não confirmou a revisão da configuração OAuth.',
                ['status' => 500, 'retryable' => true]
            );
        }
        return $next;
    }

    private function connection_revision(string $site_key): int {
        return max(0, absint(get_option(self::OPTION_CONNECTION_REVISION_PREFIX . $site_key, 0)));
    }

    private function bump_connection_revision(string $site_key): int|WP_Error {
        $option = self::OPTION_CONNECTION_REVISION_PREFIX . $site_key;
        $next = $this->connection_revision($site_key) + 1;
        update_option($option, $next, false);
        if ((int) get_option($option, -1) !== $next) {
            return new WP_Error(
                'kodety_search_console_connection_revision_storage',
                'O WordPress não confirmou a desconexão do Google.',
                ['status' => 500, 'retryable' => true]
            );
        }
        return $next;
    }

    private function oauth_state_revisions_current(array $record, array $site): bool|WP_Error {
        if (
            absint($record['oauth_client_revision'] ?? 0) !== $this->oauth_client_revision()
            || absint($record['connection_revision'] ?? 0) !== $this->connection_revision($site['key'])
        ) {
            return new WP_Error(
                'kodety_search_console_oauth_state_superseded',
                'A configuração do Google mudou durante a autorização. Inicie a conexão novamente.',
                ['status' => 409, 'retryable' => true]
            );
        }
        return true;
    }

    private function active_oauth_connection_count(): int {
        $count = 0;
        foreach ($this->site_index() as $site_key => $site_url) {
            $site = $this->site_from_values($site_url, $site_key);
            if ($this->credential_connected($this->credential($site))) $count++;
        }
        return $count;
    }

    private function oauth_client_in_use_error(int $connections): WP_Error {
        return new WP_Error(
            'kodety_search_console_oauth_client_in_use',
            'Desconecte as contas Google antes de alterar a configuração OAuth.',
            ['status' => 409, 'activeConnections' => max(1, $connections)]
        );
    }

    private function oauth_client_managed_error(): WP_Error {
        return new WP_Error(
            'kodety_search_console_oauth_client_managed',
            'Esta configuração OAuth é gerenciada externamente e não pode ser alterada no WordPress.',
            ['status' => 409, 'managedExternally' => true]
        );
    }

    private function clear_cached_access_tokens(): void {
        $keys = array_keys($this->site_index());
        $keys[] = $this->current_site()['key'];
        foreach (array_unique($keys) as $site_key) {
            delete_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site_key);
        }
    }

    private function clear_pending_oauth_states(): void {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s",
            $wpdb->esc_like(self::OPTION_OAUTH_PREFIX) . '%'
        ));
    }

    private function oauth_scope(): string {
        return 'openid email ' . self::READONLY_SCOPE;
    }

    private function callback_url(): string {
        return admin_url('admin-post.php?action=' . self::OAUTH_ACTION);
    }

    private function callback_url_usable(): bool {
        $parts = wp_parse_url($this->callback_url());
        if (!is_array($parts) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if ($scheme === 'https') return true;
        $host = strtolower(trim((string) $parts['host'], '[]'));
        return $scheme === 'http' && in_array($host, ['localhost', '127.0.0.1', '::1'], true);
    }

    private function oauth_callback_unusable_error(int $status): WP_Error {
        return new WP_Error(
            'kodety_search_console_oauth_callback_unusable',
            'A URL de retorno OAuth precisa usar HTTPS ou um host local permitido.',
            ['status' => $status, 'callbackUsable' => false]
        );
    }

    private function redirect_after_oauth(
        string $result,
        string $message,
        string $return_url = '',
        ?array $site = null
    ): void {
        $fallback = home_url('/kodety/editor/');
        $target = $this->safe_return_url($return_url);
        if ($target === '') $target = $fallback;
        $filtered = (string) apply_filters(
            'kodety_search_console_oauth_return_url',
            $target,
            $result,
            $site ?? $this->current_site()
        );
        $target = $this->safe_return_url($filtered);
        if ($target === '') $target = $fallback;
        $target = add_query_arg([
            'kodety_search_console' => $result === 'connected' ? 'connected' : 'error',
            'kodety_search_console_message' => substr(sanitize_text_field($message), 0, 240),
        ], $target);
        wp_safe_redirect($target);
        exit;
    }

    /**
     * OAuth may return only to Onun Kodety's own editor/settings surface or a
     * WordPress admin page. The URL is stored server-side in the single-use
     * OAuth state, never copied from Google's callback query string.
     */
    private function safe_return_url(string $candidate): string {
        $candidate = esc_url_raw(trim($candidate));
        if ($candidate === '' || strlen($candidate) > 2048 || preg_match('/[\x00-\x1F\x7F]/', $candidate)) return '';
        $parts = wp_parse_url($candidate);
        if (!is_array($parts) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) return '';
        if (!in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)) return '';

        $home = home_url('/');
        $admin = admin_url('/');
        $same_home = $this->same_origin_url($candidate, $home);
        $same_admin = $this->same_origin_url($candidate, $admin);
        if (!$same_home && !$same_admin) return '';

        $path = '/' . ltrim((string) ($parts['path'] ?? '/'), '/');
        $kodety_path = '/' . ltrim((string) (wp_parse_url(home_url('/kodety/'), PHP_URL_PATH) ?: '/kodety/'), '/');
        $admin_path = '/' . ltrim((string) (wp_parse_url($admin, PHP_URL_PATH) ?: '/wp-admin/'), '/');
        $in_kodety = $same_home && str_starts_with(trailingslashit($path), trailingslashit($kodety_path));
        $in_admin = $same_admin && str_starts_with(trailingslashit($path), trailingslashit($admin_path));
        return ($in_kodety || $in_admin) ? $candidate : '';
    }

    private function current_site(): array {
        $url = class_exists('Kodety_Plugin') && method_exists(Kodety_Plugin::instance(), 'active_project_site_url')
            ? Kodety_Plugin::instance()->active_project_site_url()
            : home_url('/');
        return $this->site_from_values($url);
    }

    private function site_from_values(string $url, string $expected_key = ''): array {
        $url = $this->canonical_site_base($url);
        if ($url === '') $url = trailingslashit(home_url('/'));
        $key = hash('sha256', $url);
        if ($expected_key !== '' && preg_match('/^[a-f0-9]{64}$/', $expected_key) && hash_equals($key, $expected_key)) {
            $key = $expected_key;
        }
        return ['url' => $url, 'key' => $key];
    }

    private function canonical_site_base(string $url): string {
        $url = esc_url_raw(trim($url));
        $parts = wp_parse_url($url);
        if (!is_array($parts) || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)) return '';
        if (empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) return '';
        $scheme = strtolower((string) $parts['scheme']);
        $host = strtolower((string) $parts['host']);
        $port = isset($parts['port']) ? ':' . absint($parts['port']) : '';
        $path = '/' . ltrim((string) ($parts['path'] ?? '/'), '/');
        return trailingslashit($scheme . '://' . $host . $port . $path);
    }

    private function normalize_site_url(string $candidate, string $site_url, bool $force_trailing): string {
        $candidate = esc_url_raw(trim($candidate));
        $parts = wp_parse_url($candidate);
        $site = wp_parse_url($site_url);
        if (!is_array($parts) || !is_array($site)) return '';
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        $site_host = strtolower((string) ($site['host'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '' || $host !== $site_host) return '';
        if (isset($parts['user']) || isset($parts['pass'])) return '';
        if (!$this->same_origin_url($candidate, $site_url)) return '';
        $site_path = '/' . ltrim((string) ($site['path'] ?? '/'), '/');
        $site_path = trailingslashit($site_path);
        $path = '/' . ltrim((string) ($parts['path'] ?? '/'), '/');
        if ($site_path !== '/' && !str_starts_with(trailingslashit($path), $site_path)) return '';
        $port = isset($parts['port']) ? ':' . absint($parts['port']) : '';
        $url = $scheme . '://' . $host . $port . ($force_trailing ? trailingslashit($path) : $path);
        if (!$force_trailing && isset($parts['query']) && $parts['query'] !== '') $url .= '?' . $parts['query'];
        return $url;
    }

    private function same_origin_url(string $candidate, string $reference): bool {
        $a = $this->origin($candidate);
        $b = $this->origin($reference);
        return $a !== '' && $b !== '' && hash_equals($a, $b);
    }

    private function origin(string $url): string {
        $parts = wp_parse_url($url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) return '';
        $scheme = strtolower((string) $parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true) || isset($parts['user']) || isset($parts['pass'])) return '';
        $port = absint($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
        return $scheme . '://' . strtolower((string) $parts['host']) . ':' . $port;
    }

    private function safe_google_url(string $url): string {
        $url = esc_url_raw(trim($url));
        if ($url === '' || strlen($url) > 2048) return '';
        $parts = wp_parse_url($url);
        return is_array($parts)
            && in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            && !empty($parts['host'])
            && !isset($parts['user'])
            && !isset($parts['pass'])
            ? $url
            : '';
    }

    private function valid_property_url(string $value): bool {
        if ($value === '' || strlen($value) > 2048 || preg_match('/[\x00-\x1F\x7F]/', $value)) return false;
        if (preg_match('/^sc-domain:[a-z0-9.-]{1,253}$/iD', $value)) return true;
        $parts = wp_parse_url($value);
        return is_array($parts)
            && in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            && !empty($parts['host'])
            && !isset($parts['user'])
            && !isset($parts['pass']);
    }

    private function safe_external_https_url(string $url): bool {
        $parts = wp_parse_url($url);
        return is_array($parts)
            && strtolower((string) ($parts['scheme'] ?? '')) === 'https'
            && !empty($parts['host'])
            && !isset($parts['user'])
            && !isset($parts['pass']);
    }

    private function allowed_google_endpoint(string $url): bool {
        $parts = wp_parse_url($url);
        if (!is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https') return false;
        return in_array(strtolower((string) ($parts['host'] ?? '')), [
            'www.googleapis.com',
            'searchconsole.googleapis.com',
        ], true) && !isset($parts['user']) && !isset($parts['pass']);
    }

    private function credential(array $site): array {
        $stored = get_option(self::OPTION_CREDENTIAL_PREFIX . $site['key'], []);
        return array_merge(self::default_credential(), is_array($stored) ? $stored : []);
    }

    private static function default_credential(): array {
        return [
            'refresh_token' => '',
            'account_email' => '',
            'properties' => [],
            'scope' => '',
            'connected_at' => '',
            'updated_at' => '',
        ];
    }

    private function public_credential(array $credential): array {
        return [
            'connected' => $this->credential_connected($credential),
            'accountEmail' => sanitize_email((string) ($credential['account_email'] ?? '')),
            'properties' => $this->public_properties($credential['properties'] ?? []),
            'connectedAt' => (string) ($credential['connected_at'] ?? ''),
        ];
    }

    private function credential_connected(array $credential): bool {
        return (string) ($credential['refresh_token'] ?? '') !== '';
    }

    private function save_credential(array $site, array $credential): bool {
        $next = array_merge(self::default_credential(), $credential);
        $option = self::OPTION_CREDENTIAL_PREFIX . $site['key'];
        update_option($option, $next, false);
        return get_option($option, null) === $next && $this->register_site($site);
    }

    private function restore_option_value(string $option, mixed $previous): void {
        if (is_array($previous)) {
            update_option($option, $previous, false);
        } else {
            delete_option($option);
        }
    }

    private function site_state(array $site): array {
        $stored = get_option(self::OPTION_SITE_PREFIX . $site['key'], []);
        return array_merge([
            'site_url' => $site['url'],
            'property' => '',
            'sync_status' => 'idle',
            'last_error' => '',
            'last_sync_at' => '',
            'last_attempt_at' => '',
            'queued_inspection_limit' => 0,
            'sync_generation' => 0,
            'completed_generation' => 0,
        ], is_array($stored) ? $stored : []);
    }

    private function save_site_state(array $site, array $state): bool {
        $next = array_merge($this->site_state($site), $state, ['site_url' => $site['url']]);
        update_option(self::OPTION_SITE_PREFIX . $site['key'], $next, false);
        $saved = get_option(self::OPTION_SITE_PREFIX . $site['key'], null) === $next;
        if (!$saved) return false;
        return $this->register_site($site);
    }

    private function register_site(array $site): bool {
        $index = $this->site_index();
        $index[$site['key']] = $site['url'];
        update_option(self::OPTION_SITE_INDEX, $index, false);
        return get_option(self::OPTION_SITE_INDEX, null) === $index;
    }

    /** @return array<string,string> */
    private function site_index(): array {
        $stored = get_option(self::OPTION_SITE_INDEX, []);
        $output = [];
        foreach (is_array($stored) ? $stored : [] as $key => $url) {
            if (!preg_match('/^[a-f0-9]{64}$/', (string) $key)) continue;
            $site = $this->site_from_values((string) $url, (string) $key);
            if (hash_equals($site['key'], (string) $key)) $output[(string) $key] = $site['url'];
        }
        return $output;
    }

    private function set_site_error(array $site, string $message): void {
        $state = $this->site_state($site);
        $state['sync_status'] = 'error';
        $state['last_error'] = $this->safe_error_message($message);
        $state['last_attempt_at'] = gmdate('c');
        $this->save_site_state($site, $state);
    }

    private function set_oauth_site_error_if_current(array $site, array $record, string $message): void {
        $global_lock_key = $this->oauth_client_lock_key();
        $global_owner = $this->acquire_state_lock($global_lock_key);
        if (is_wp_error($global_owner)) return;
        $state_owner = $this->acquire_state_lock($site['key']);
        if (is_wp_error($state_owner)) {
            $this->release_state_lock($global_lock_key, $global_owner);
            return;
        }
        try {
            if ($this->oauth_state_revisions_current($record, $site) === true) {
                $this->set_site_error($site, $message);
            }
        } finally {
            $this->release_state_lock($site['key'], $state_owner);
            $this->release_state_lock($global_lock_key, $global_owner);
        }
    }

    private function public_properties(mixed $raw): array {
        $properties = [];
        foreach (is_array($raw) ? $raw : [] as $entry) {
            if (!is_array($entry)) continue;
            $url = trim((string) ($entry['url'] ?? $entry['siteUrl'] ?? ''));
            if (!$this->valid_property_url($url)) continue;
            $label = str_starts_with($url, 'sc-domain:') ? substr($url, 10) : $url;
            $properties[$url] = [
                'url' => $url,
                'label' => substr(sanitize_text_field($label), 0, 255),
                'permissionLevel' => substr(sanitize_key((string) ($entry['permissionLevel'] ?? '')), 0, 64),
            ];
        }
        return array_values($properties);
    }

    private function cached_access_token(array $site): string {
        $stored = get_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key']);
        if (!is_string($stored) || $stored === '') return '';
        $token = $this->decrypt_secret($stored, $this->secret_context('access-token', $site));
        return is_string($token) ? $token : '';
    }

    private function cache_access_token(array $site, string $token, int $expires_in): bool {
        if ($token === '') return false;
        $protected = $this->encrypt_secret($token, $this->secret_context('access-token', $site));
        if (is_wp_error($protected)) return false;
        $ttl = max(MINUTE_IN_SECONDS, min(HOUR_IN_SECONDS, $expires_in) - MINUTE_IN_SECONDS);
        return set_transient(self::TRANSIENT_ACCESS_TOKEN_PREFIX . $site['key'], $protected, $ttl);
    }

    private function encrypt_secret(string $plain, string $context): string|WP_Error {
        if ($plain === '') return '';
        try {
            $key = $this->secret_key($context);
            if (function_exists('sodium_crypto_secretbox')) {
                $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
                return 'v1s:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $key));
            }
            if (!function_exists('openssl_encrypt')) throw new RuntimeException('crypto');
            $iv = random_bytes(12);
            $tag = '';
            $cipher = openssl_encrypt(
                $plain,
                'aes-256-gcm',
                $key,
                OPENSSL_RAW_DATA,
                $iv,
                $tag,
                'kodety-search-console:' . $context,
                16
            );
            if (!is_string($cipher) || strlen($tag) !== 16) throw new RuntimeException('crypto');
            return 'v1g:' . base64_encode($iv . $tag . $cipher);
        } catch (Throwable) {
            return new WP_Error(
                'kodety_search_console_crypto',
                'O servidor não conseguiu proteger a credencial do Google.',
                ['status' => 503]
            );
        }
    }

    private function decrypt_secret(string $stored, string $context): string|WP_Error {
        if ($stored === '') return '';
        $key = $this->secret_key($context);
        if (str_starts_with($stored, 'v1s:') && function_exists('sodium_crypto_secretbox_open')) {
            $raw = base64_decode(substr($stored, 4), true);
            if (!is_string($raw) || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return $this->crypto_error();
            $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $key);
            return is_string($plain) ? $plain : $this->crypto_error();
        }
        if (str_starts_with($stored, 'v1g:') && function_exists('openssl_decrypt')) {
            $raw = base64_decode(substr($stored, 4), true);
            if (!is_string($raw) || strlen($raw) <= 28) return $this->crypto_error();
            $plain = openssl_decrypt(
                substr($raw, 28),
                'aes-256-gcm',
                $key,
                OPENSSL_RAW_DATA,
                substr($raw, 0, 12),
                substr($raw, 12, 16),
                'kodety-search-console:' . $context
            );
            return is_string($plain) ? $plain : $this->crypto_error();
        }
        return $this->crypto_error();
    }

    private function secret_key(string $context): string {
        return hash('sha256', wp_salt('auth') . '|' . wp_salt('secure_auth') . '|kodety-search-console|' . $context, true);
    }

    private function secret_context(string $purpose, array $site): string {
        return $purpose . ':' . $site['key'];
    }

    private function crypto_error(): WP_Error {
        return new WP_Error('kodety_search_console_crypto', 'A credencial salva do Google não pôde ser lida.', ['status' => 503]);
    }

    private function reserve_inspection_slots(array $site, int $requested): int {
        $today = gmdate('Y-m-d');
        $option = self::OPTION_INSPECTION_USAGE_PREFIX . $site['key'];
        $usage = get_option($option, []);
        if (!is_array($usage) || (string) ($usage['date'] ?? '') !== $today) $usage = ['date' => $today, 'count' => 0];
        $daily_limit = max(1, min(2000, (int) apply_filters(
            'kodety_search_console_inspection_daily_limit',
            self::INSPECTION_MAX_PER_DAY
        )));
        $available = max(0, $daily_limit - absint($usage['count'] ?? 0));
        $reserved = min($available, max(0, $requested));
        $usage['count'] = absint($usage['count'] ?? 0) + $reserved;
        update_option($option, $usage, false);
        return $reserved;
    }

    private function acquire_state_lock(string $site_key): string|WP_Error {
        $option = self::OPTION_STATE_LOCK_PREFIX . $site_key;
        $current = get_option($option, []);
        if (is_array($current) && absint($current['at'] ?? 0) < time() - self::STATE_LOCK_TTL) {
            delete_option($option);
        }
        try {
            $owner = bin2hex(random_bytes(16));
        } catch (Throwable) {
            return new WP_Error(
                'kodety_search_console_state_lock',
                'Não foi possível atualizar a fila do Search Console.',
                ['status' => 503]
            );
        }
        if (!add_option($option, ['owner' => $owner, 'at' => time()], '', false)) {
            return new WP_Error(
                'kodety_search_console_state_busy',
                'A fila do Search Console está sendo atualizada. Tente novamente.',
                ['status' => 409, 'retryable' => true]
            );
        }
        return $owner;
    }

    private function release_state_lock(string $site_key, string $owner): void {
        $option = self::OPTION_STATE_LOCK_PREFIX . $site_key;
        $current = get_option($option, []);
        if (is_array($current) && hash_equals((string) ($current['owner'] ?? ''), $owner)) {
            delete_option($option);
        }
    }

    private function next_sync_generation(array $state): int {
        return max(
            absint($state['sync_generation'] ?? 0),
            absint($state['completed_generation'] ?? 0)
        ) + 1;
    }

    private function acquire_sync_lock(string $site_key): string|WP_Error {
        $option = self::OPTION_SYNC_LOCK_PREFIX . $site_key;
        $current = get_option($option, []);
        if (is_array($current) && absint($current['at'] ?? 0) < time() - self::SYNC_LOCK_TTL) delete_option($option);
        try {
            $owner = bin2hex(random_bytes(16));
        } catch (Throwable) {
            return new WP_Error('kodety_search_console_lock', 'Não foi possível iniciar a sincronização.', ['status' => 503]);
        }
        if (!add_option($option, ['owner' => $owner, 'at' => time()], '', false)) {
            return new WP_Error('kodety_search_console_busy', 'Já existe uma sincronização do Search Console em andamento.', ['status' => 409]);
        }
        return $owner;
    }

    private function release_sync_lock(string $site_key, string $owner): void {
        $option = self::OPTION_SYNC_LOCK_PREFIX . $site_key;
        $current = get_option($option, []);
        if (is_array($current) && hash_equals((string) ($current['owner'] ?? ''), $owner)) delete_option($option);
    }

    private function schedule_immediate_sync(string $site_key): void {
        $args = [$site_key, 1];
        $next = wp_next_scheduled(self::RETRY_HOOK, $args);
        if ($next !== false && $next > time() + 30) {
            wp_clear_scheduled_hook(self::RETRY_HOOK, $args);
            $next = false;
        }
        if ($next === false) {
            wp_schedule_single_event(time() + 1, self::RETRY_HOOK, $args, true);
        }
        if (function_exists('spawn_cron') && !(defined('DISABLE_WP_CRON') && DISABLE_WP_CRON)) spawn_cron(microtime(true));
    }

    private function schedule_retry(string $site_key, int $attempt): void {
        $attempt = max(1, min(self::RETRY_ATTEMPTS, $attempt));
        $args = [$site_key, $attempt];
        if (wp_next_scheduled(self::RETRY_HOOK, $args)) return;
        $delays = [1 => 5 * MINUTE_IN_SECONDS, 2 => 30 * MINUTE_IN_SECONDS, 3 => 2 * HOUR_IN_SECONDS];
        wp_schedule_single_event(time() + $delays[$attempt], self::RETRY_HOOK, $args, true);
    }

    private function clear_retries(string $site_key): void {
        for ($attempt = 1; $attempt <= self::RETRY_ATTEMPTS; $attempt++) {
            wp_clear_scheduled_hook(self::RETRY_HOOK, [$site_key, $attempt]);
        }
    }

    private function safe_error_message(string $message): string {
        $message = sanitize_text_field($message);
        $message = preg_replace('/\b(Bearer|Basic)\s+\S+/i', '$1 [redigido]', $message) ?? '';
        $message = preg_replace('/\b(?:access|refresh|id|client)[_-]?token\b\s*[:=]\s*\S+/i', 'token=[redigido]', $message) ?? '';
        return substr($message !== '' ? $message : 'A sincronização do Search Console falhou.', 0, 500);
    }

    private function response(mixed $data, int $status = 200): WP_REST_Response {
        $response = new WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        $response->header('Pragma', 'no-cache');
        return $response;
    }

    private function storage_error(): WP_Error {
        return new WP_Error('kodety_search_console_storage', 'O WordPress não confirmou o salvamento do Search Console.', ['status' => 503]);
    }

    private function base64url_encode(string $bytes): string {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    private function row_hash(string $site_key, string $property, string $url): string {
        return hash('sha256', $site_key . "\0" . $property . "\0" . $url);
    }

    private static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'kodety_search_console_pages';
    }

    private static function install_schema(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = self::table();
        $charset = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            row_hash char(64) NOT NULL,
            site_key char(64) NOT NULL,
            property_hash char(64) NOT NULL,
            property_url text NOT NULL,
            url_hash char(64) NOT NULL,
            url text NOT NULL,
            source varchar(32) NOT NULL DEFAULT '',
            metrics_start date NULL,
            metrics_end date NULL,
            clicks double NOT NULL DEFAULT 0,
            impressions double NOT NULL DEFAULT 0,
            ctr double NOT NULL DEFAULT 0,
            position double NOT NULL DEFAULT 0,
            index_status varchar(32) NOT NULL DEFAULT 'unknown',
            canonical_issue varchar(191) NOT NULL DEFAULT '',
            coverage_state varchar(191) NOT NULL DEFAULT '',
            indexing_state varchar(32) NOT NULL DEFAULT '',
            robots_txt_state varchar(32) NOT NULL DEFAULT '',
            page_fetch_state varchar(32) NOT NULL DEFAULT '',
            user_canonical text NULL,
            google_canonical text NULL,
            last_inspected_at datetime NULL,
            last_seen_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY row_hash (row_hash),
            KEY site_property_impressions (site_key,property_hash,impressions),
            KEY site_property_status (site_key,property_hash,index_status),
            KEY last_seen_at (last_seen_at)
        ) {$charset};");
    }

    private static function grant_capabilities(): void {
        $administrator = get_role('administrator');
        if ($administrator) {
            $administrator->add_cap(self::CAP_VIEW);
            $administrator->add_cap(self::CAP_MANAGE);
        }
        foreach (['kodety_designer', 'editor'] as $role_name) {
            $role = get_role($role_name);
            if (!$role) continue;
            $role->add_cap(self::CAP_VIEW);
            $role->remove_cap(self::CAP_MANAGE);
        }
    }

    private static function cleanup_ephemeral_options(): void {
        global $wpdb;
        $oauth_like = $wpdb->esc_like(self::OPTION_OAUTH_PREFIX) . '%';
        $lock_like = $wpdb->esc_like(self::OPTION_SYNC_LOCK_PREFIX) . '%';
        $state_lock_like = $wpdb->esc_like(self::OPTION_STATE_LOCK_PREFIX) . '%';
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s",
            $oauth_like,
            $lock_like,
            $state_lock_like
        ));
    }

    private function cleanup_oauth_states(): void {
        global $wpdb;
        $like = $wpdb->esc_like(self::OPTION_OAUTH_PREFIX) . '%';
        $names = $wpdb->get_col($wpdb->prepare(
            "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s LIMIT 100",
            $like
        ));
        foreach (is_array($names) ? $names : [] as $name) {
            $record = get_option((string) $name, null);
            if (!is_array($record) || absint($record['created_at'] ?? 0) < time() - self::OAUTH_TTL) {
                delete_option((string) $name);
            }
        }
    }
}
