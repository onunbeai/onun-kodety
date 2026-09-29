<?php

defined('ABSPATH') || exit;

/**
 * Checkout-provider adapters and the local, non-financial commerce projection.
 *
 * Money, balances, refunds and subscription billing remain owned by the
 * provider. Onun Kodety stores only the minimum projection required to display
 * sales, reconcile membership and create provider-hosted checkout sessions.
 *
 * Security invariants:
 * - credentials are encrypted at rest and never returned by REST;
 * - every webhook URL contains a per-connection opaque token;
 * - provider signatures are verified when officially available;
 * - adapters without a sufficiently documented signature re-fetch the
 *   financial object from the provider before changing access;
 * - an e-mail address never links a payment to an existing WordPress user;
 * - access is derived only from a server-issued opaque checkout reference.
 */
final class Kodety_Checkouts {
    private const DB_VERSION = 3;
    private const OPTION_DB_VERSION = 'kodety_checkouts_db_version';
    private const REST_NAMESPACE = 'kodety/v1';
    private const REST_BASE = '/members/commerce';
    private const MAX_PAGE_SIZE = 100;
    private const MAX_WEBHOOK_BYTES = 1048576;
    private const WEBHOOK_TOLERANCE = 300;
    private const ACCESS_LINK_TTL = 900;
    private const PUBLIC_RATE_LIMIT = 30;
    private const PUBLIC_RATE_WINDOW = 600;
    private const PREFLIGHT_EMAIL_RATE_LIMIT = 5;
    private const PREFLIGHT_EMAIL_RATE_WINDOW = 1800;
    private const CHECKOUT_ARTIFACT_REUSE_WINDOW = 86400;
    private const RECONCILE_HOOK = 'kodety_checkouts_reconcile';
    private const WOOVI_WEBHOOK_PUBLIC_KEY_BASE64 =
        'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlHZk1BMEdDU3FHU0liM0RRRUJBUVVB'
        . 'QTRHTkFEQ0JpUUtCZ1FDLytOdElranpldnZxRCtJM01NdjNiTFhEdApwdnhCalk0QnNS'
        . 'clNkY2EzcnRBd01jUllZdnhTbmQ3amFnVkxwY3RNaU94UU84aWVVQ0tMU1dIcHNNQWpP'
        . 'L3paCldNS2Jxb0c4TU5waS91M2ZwNnp6MG1jSENPU3FZc1BVVUcxOWJ1VzhiaXM1Wloy'
        . 'SVpnQk9iV1NwVHZKMGNuajYKSEtCQUE4MkpsbitsR3dTMU13SURBUUFCCi0tLS0tRU5E'
        . 'IFBVQkxJQyBLRVktLS0tLQo=';
    private const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];
    private const TERMINAL_SALE_STATUSES = ['refunded', 'chargeback', 'canceled'];
    private const SALE_STATUSES = [
        'pending',
        'paid',
        'failed',
        'canceled',
        'refunded',
        'chargeback',
        'expired',
        'unlinked',
    ];

    private static ?self $instance = null;

    /** @var array<string,array<string,mixed>> */
    private const PROVIDERS = [
        'stripe' => [
            'label' => 'Stripe',
            'credentials' => ['secretKey', 'webhookSecret'],
            'optionalCredentials' => ['accountId'],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => true,
                'portal' => true,
                'products' => true,
                'signedWebhooks' => true,
            ],
            'dashboard' => 'https://dashboard.stripe.com',
        ],
        'mercado_pago' => [
            'label' => 'Mercado Pago',
            'credentials' => ['accessToken', 'webhookSecret'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => false,
                'portal' => false,
                'products' => false,
                'signedWebhooks' => true,
            ],
            'dashboard' => 'https://www.mercadopago.com.br/activities',
        ],
        'asaas' => [
            'label' => 'Asaas',
            'credentials' => ['apiKey', 'webhookToken'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => true,
                'portal' => false,
                'products' => false,
                'signedWebhooks' => false,
            ],
            'dashboard' => 'https://www.asaas.com',
        ],
        'pagbank' => [
            'label' => 'PagBank',
            // accountEmail is also required by the official legacy
            // post-transaction notification refetch used for lifecycle
            // compatibility (refunds, disputes and cancellations).
            'credentials' => ['token', 'accountEmail'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => false,
                'portal' => false,
                'products' => false,
                'signedWebhooks' => true,
            ],
            'dashboard' => 'https://pagseguro.uol.com.br',
        ],
        'pagarme' => [
            'label' => 'Pagar.me',
            'credentials' => ['secretKey'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => true,
                'portal' => false,
                'products' => true,
                'signedWebhooks' => false,
            ],
            'dashboard' => 'https://dash.pagar.me',
        ],
        'woovi' => [
            'label' => 'Woovi',
            'credentials' => ['appId'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => false,
                'portal' => false,
                'products' => false,
                'signedWebhooks' => true,
                'requiresCustomerEmail' => true,
            ],
            'dashboard' => 'https://app.woovi.com',
        ],
        'iugu' => [
            'label' => 'Iugu',
            'credentials' => ['apiToken'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => false,
                'portal' => false,
                'products' => false,
                'signedWebhooks' => false,
                'requiresCustomerEmail' => true,
            ],
            'dashboard' => 'https://app.iugu.com',
        ],
        'hotmart' => [
            'label' => 'Hotmart',
            'credentials' => ['clientId', 'clientSecret', 'basicToken', 'hottok'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => true,
                'portal' => false,
                'products' => true,
                'signedWebhooks' => true,
            ],
            'dashboard' => 'https://app.hotmart.com',
        ],
        'ticto' => [
            'label' => 'Ticto',
            'credentials' => ['webhookToken'],
            'optionalCredentials' => [],
            'capabilities' => [
                'checkout' => true,
                'payments' => true,
                'subscriptions' => true,
                'portal' => false,
                'products' => false,
                'signedWebhooks' => true,
            ],
            'dashboard' => 'https://dash.ticto.com.br',
        ],
    ];

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'maybe_upgrade'], 2);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('template_redirect', [$this, 'handle_public_checkout_page'], -95);
        add_action('template_redirect', [$this, 'consume_access_link'], -90);
        add_filter('kodety_members_resolved_claims', [$this, 'apply_access_blocks'], 20, 2);
        add_action('kodety_members_user_deleted', [$this, 'handle_member_deleted'], 10, 2);
        add_action(self::RECONCILE_HOOK, [$this, 'reconcile_cron']);
    }

    public static function activate(): void {
        self::migrate_from((int) get_option(self::OPTION_DB_VERSION, 0));
        self::schedule_reconciliation();
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook(self::RECONCILE_HOOK);
        // Connections and the idempotency projection intentionally persist.
    }

    public function maybe_upgrade(): void {
        $current = (int) get_option(self::OPTION_DB_VERSION, 0);
        if ($current < self::DB_VERSION) self::migrate_from($current);
        self::schedule_reconciliation();
    }

    private static function schedule_reconciliation(): void {
        if (!wp_next_scheduled(self::RECONCILE_HOOK)) {
            wp_schedule_event(time() + 300, 'hourly', self::RECONCILE_HOOK);
        }
    }

    public function reconcile_cron(): void {
        $this->run_reconciliation(25);
    }

    private static function migrate_from(int $current): void {
        if ($current < 1) {
            self::install_schema_v1();
            update_option(self::OPTION_DB_VERSION, 1, false);
            $current = 1;
        }
        if ($current < 2) {
            self::install_schema_v1();
            update_option(self::OPTION_DB_VERSION, 2, false);
            $current = 2;
        }
        if ($current < 3) {
            self::install_schema_v1();
            global $wpdb;
            $artifact_table = self::table('artifacts');
            if (
                (string) $wpdb->get_var($wpdb->prepare(
                    'SHOW TABLES LIKE %s',
                    $artifact_table
                )) !== $artifact_table
            ) {
                error_log(
                    'Onun Kodety checkout migration v3 pending: artifact journal table is unavailable.'
                );
                return;
            }
            update_option(self::OPTION_DB_VERSION, 3, false);
            $current = 3;
        }
        if ($current < self::DB_VERSION) {
            update_option(self::OPTION_DB_VERSION, self::DB_VERSION, false);
        }
    }

    private static function install_schema_v1(): void {
        global $wpdb;
        if (!function_exists('dbDelta')) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        }
        $charset = $wpdb->get_charset_collate();
        $connections = self::table('connections');
        $mappings = self::table('mappings');
        $sales = self::table('sales');
        $artifacts = self::table('artifacts');
        $blocks = self::table('access_blocks');

        dbDelta("CREATE TABLE {$connections} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            uuid char(36) NOT NULL,
            provider varchar(32) NOT NULL,
            name varchar(191) NOT NULL,
            enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
            status varchar(24) NOT NULL DEFAULT 'unverified',
            credentials longtext NOT NULL,
            settings longtext NULL,
            webhook_token_hash char(64) NOT NULL,
            webhook_token_encrypted longtext NOT NULL,
            last_verified_at datetime NULL,
            last_synced_at datetime NULL,
            last_error varchar(1000) NOT NULL DEFAULT '',
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            updated_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uuid (uuid),
            KEY provider_enabled (provider,enabled),
            KEY status_updated (status,updated_at)
        ) {$charset};");

        dbDelta("CREATE TABLE {$mappings} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            uuid char(36) NOT NULL,
            public_key char(43) NOT NULL,
            connection_id bigint(20) unsigned NOT NULL,
            plan_id bigint(20) unsigned NOT NULL,
            mode varchar(20) NOT NULL DEFAULT 'payment',
            external_product_id varchar(191) NOT NULL DEFAULT '',
            external_price_id varchar(191) NOT NULL DEFAULT '',
            amount bigint(20) unsigned NULL,
            currency char(3) NOT NULL DEFAULT 'BRL',
            status varchar(20) NOT NULL DEFAULT 'active',
            settings longtext NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uuid (uuid),
            UNIQUE KEY public_key (public_key),
            UNIQUE KEY connection_plan_mode (connection_id,plan_id,mode),
            KEY plan_status (plan_id,status),
            KEY connection_status (connection_id,status)
        ) {$charset};");

        dbDelta("CREATE TABLE {$sales} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            uuid char(36) NOT NULL,
            connection_id bigint(20) unsigned NOT NULL,
            mapping_id bigint(20) unsigned NOT NULL DEFAULT 0,
            user_id bigint(20) unsigned NOT NULL DEFAULT 0,
            plan_id bigint(20) unsigned NOT NULL DEFAULT 0,
            local_reference char(43) NOT NULL,
            external_sale_id varchar(191) NOT NULL DEFAULT '',
            external_sale_key char(64) NOT NULL,
            external_customer_id varchar(191) NOT NULL DEFAULT '',
            external_contract_id varchar(191) NOT NULL DEFAULT '',
            external_event_id varchar(191) NOT NULL DEFAULT '',
            status varchar(24) NOT NULL DEFAULT 'pending',
            access_status varchar(24) NOT NULL DEFAULT 'pending',
            amount bigint(20) unsigned NULL,
            currency char(3) NOT NULL DEFAULT 'BRL',
            customer_email_hash char(64) NOT NULL DEFAULT '',
            occurred_at datetime NULL,
            provider_updated_at datetime NULL,
            last_reconciled_at datetime NULL,
            metadata longtext NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uuid (uuid),
            UNIQUE KEY local_reference (local_reference),
            UNIQUE KEY external_sale_key (external_sale_key),
            KEY external_sale (connection_id,external_sale_id),
            KEY external_contract (connection_id,external_contract_id),
            KEY user_updated (user_id,updated_at),
            KEY status_updated (status,updated_at)
        ) {$charset};");

        dbDelta("CREATE TABLE {$artifacts} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            sale_id bigint(20) unsigned NOT NULL,
            sale_uuid char(36) NOT NULL,
            connection_id bigint(20) unsigned NOT NULL,
            mapping_id bigint(20) unsigned NOT NULL DEFAULT 0,
            provider varchar(32) NOT NULL,
            artifact_type varchar(32) NOT NULL,
            local_reference char(43) NOT NULL,
            request_fingerprint char(64) NOT NULL,
            external_id varchar(191) NOT NULL,
            external_key char(64) NOT NULL,
            checkout_url_encrypted longtext NOT NULL,
            expires_at datetime NULL,
            metadata longtext NULL,
            status varchar(24) NOT NULL DEFAULT 'pending',
            last_error varchar(500) NOT NULL DEFAULT '',
            reconciled_at datetime NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY external_key (external_key),
            UNIQUE KEY local_reference (local_reference),
            KEY request_created (request_fingerprint,created_at),
            KEY status_updated (status,updated_at),
            KEY sale_id (sale_id)
        ) {$charset};");

        dbDelta("CREATE TABLE {$blocks} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            user_id bigint(20) unsigned NOT NULL,
            plan_id bigint(20) unsigned NOT NULL,
            connection_id bigint(20) unsigned NOT NULL DEFAULT 0,
            reason varchar(500) NOT NULL DEFAULT '',
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY access_target (user_id,plan_id,connection_id),
            KEY user_plan (user_id,plan_id)
        ) {$charset};");
    }

    private static function table(string $suffix): string {
        global $wpdb;
        return $wpdb->prefix . 'kodety_checkout_' . $suffix;
    }

    public function register_rest_routes(): void {
        $view = [$this, 'view_permission'];
        $manage = [$this, 'commerce_permission'];

        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/overview', [[
            'methods' => 'GET',
            'callback' => [$this, 'overview'],
            'permission_callback' => $view,
        ]]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/sync', [[
            'methods' => 'POST',
            'callback' => [$this, 'sync_now'],
            'permission_callback' => $manage,
        ]]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/connections', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_connections'],
                'permission_callback' => $view,
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_connection'],
                'permission_callback' => $manage,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/connections/(?P<id>[a-f0-9-]{36})', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_connection'],
                'permission_callback' => $view,
            ],
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'update_connection'],
                'permission_callback' => $manage,
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete_connection'],
                'permission_callback' => $manage,
            ],
        ]);
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_BASE . '/connections/(?P<id>[a-f0-9-]{36})/test',
            [[
                'methods' => 'POST',
                'callback' => [$this, 'test_connection'],
                'permission_callback' => $manage,
            ]]
        );
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_BASE . '/connections/(?P<id>[a-f0-9-]{36})/products',
            [[
                'methods' => 'GET',
                'callback' => [$this, 'list_products'],
                'permission_callback' => $view,
            ]]
        );
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/mappings', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_mappings'],
                'permission_callback' => $view,
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_mapping'],
                'permission_callback' => $manage,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/mappings/(?P<id>[a-f0-9-]{36})', [
            [
                'methods' => ['PUT', 'PATCH'],
                'callback' => [$this, 'update_mapping'],
                'permission_callback' => $manage,
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete_mapping'],
                'permission_callback' => $manage,
            ],
        ]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/checkout-links', [[
            'methods' => 'POST',
            'callback' => [$this, 'create_checkout_link'],
            'permission_callback' => $manage,
        ]]);
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_BASE . '/buy/(?P<key>[A-Za-z0-9_-]{43})',
            [[
                'methods' => ['GET', 'POST'],
                'callback' => [$this, 'public_buy'],
                'permission_callback' => [$this, 'public_buy_permission'],
            ]]
        );
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/sales', [[
            'methods' => 'GET',
            'callback' => [$this, 'list_sales'],
            'permission_callback' => $view,
        ]]);
        register_rest_route(self::REST_NAMESPACE, self::REST_BASE . '/subscriptions', [[
            'methods' => 'GET',
            'callback' => [$this, 'list_subscriptions'],
            'permission_callback' => $view,
        ]]);
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_BASE . '/subscriptions/(?P<id>\d+)/portal-link',
            [[
                'methods' => 'POST',
                'callback' => [$this, 'create_portal_link'],
                'permission_callback' => $manage,
            ]]
        );
        foreach (['access-link', 'reset-link', 'reset-email', 'access'] as $action) {
            register_rest_route(
                self::REST_NAMESPACE,
                self::REST_BASE . '/members/(?P<id>\d+)/' . $action,
                [[
                    'methods' => 'POST',
                    'callback' => match ($action) {
                        'access-link' => [$this, 'create_access_link'],
                        'reset-link' => [$this, 'create_reset_link'],
                        'reset-email' => [$this, 'send_reset_email'],
                        default => [$this, 'change_member_access'],
                    },
                    'permission_callback' => $manage,
                ]]
            );
        }
        register_rest_route(
            self::REST_NAMESPACE,
            self::REST_BASE
                . '/webhooks/(?P<provider>[a-z0-9_-]{2,32})/(?P<connection>[a-f0-9-]{36})',
            [[
                'methods' => 'POST',
                'callback' => [$this, 'receive_webhook'],
                'permission_callback' => '__return_true',
            ]]
        );
        // Compact opaque endpoint for providers with strict notification URL
        // limits (notably PagBank). The token identifies the connection and is
        // still verified in constant time before any payload is parsed.
        register_rest_route(
            self::REST_NAMESPACE,
            '/c/(?P<key>[A-Za-z0-9_-]{43})',
            [[
                'methods' => 'POST',
                'callback' => [$this, 'receive_webhook'],
                'permission_callback' => '__return_true',
            ]]
        );
    }

    public function view_permission(WP_REST_Request $request): bool|WP_Error {
        return Kodety_Members::instance()->view_permission($request);
    }

    public function commerce_permission(WP_REST_Request $request): bool|WP_Error {
        return Kodety_Members::instance()->commerce_permission($request);
    }

    public function public_buy_permission(WP_REST_Request $request): bool|WP_Error {
        if (!Kodety_Members::is_current_project_enabled()) {
            return new WP_Error(
                'kodety_checkout_membership_disabled',
                'Área de membros desativada.',
                ['status' => 503]
            );
        }
        if (strtoupper((string) $request->get_method()) === 'GET') return true;
        $limited = $this->rate_limit_public($this->request_ip_hash());
        return is_wp_error($limited) ? $limited : true;
    }

    /** @return array<string,mixed> */
    public static function provider_catalog(): array {
        $output = [];
        foreach (self::PROVIDERS as $id => $provider) {
            $output[] = [
                'id' => $id,
                'label' => (string) $provider['label'],
                'available' => true,
                'credentialFields' => array_values(array_merge(
                    (array) $provider['credentials'],
                    (array) $provider['optionalCredentials']
                )),
                'requiredCredentialFields' => array_values((array) $provider['credentials']),
                'capabilities' => (array) $provider['capabilities'],
            ];
        }
        return $output;
    }

    public function list_connections(): WP_REST_Response {
        global $wpdb;
        $rows = $wpdb->get_results(
            'SELECT * FROM ' . self::table('connections')
                . " WHERE status<>'deleted' ORDER BY created_at ASC,id ASC",
            ARRAY_A
        );
        return $this->response([
            'items' => array_map([$this, 'format_connection'], $rows ?: []),
            'providers' => self::provider_catalog(),
        ]);
    }

    public function get_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $row = $this->connection_by_uuid((string) $request['id']);
        if (!$row) return $this->not_found('connection');
        return $this->response($this->format_connection($row));
    }

    public function create_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $raw = $this->payload($request);
        $provider = self::provider_key($raw['provider'] ?? '');
        if (!isset(self::PROVIDERS[$provider])) {
            return new WP_Error('kodety_checkout_provider', 'Provedor inválido.', ['status' => 400]);
        }
        $name = substr(sanitize_text_field((string) ($raw['name'] ?? '')), 0, 191);
        if ($name === '') $name = (string) self::PROVIDERS[$provider]['label'];
        $credentials = $this->sanitize_credentials($provider, $raw['credentials'] ?? []);
        if (is_wp_error($credentials)) return $credentials;
        $enabled = rest_sanitize_boolean($raw['enabled'] ?? false);
        $required = $this->validate_required_credentials($provider, $credentials, $enabled);
        if (is_wp_error($required)) return $required;
        $encrypted = $this->encrypt_secret($credentials);
        if (is_wp_error($encrypted)) return $encrypted;
        $webhook_token = self::opaque_token();
        $webhook_encrypted = $this->encrypt_secret(['token' => $webhook_token]);
        if (is_wp_error($webhook_encrypted)) return $webhook_encrypted;
        $uuid = wp_generate_uuid4();
        $now = self::now();
        $row = [
            'uuid' => $uuid,
            'provider' => $provider,
            'name' => $name,
            'enabled' => $enabled ? 1 : 0,
            'status' => $enabled ? 'unverified' : 'disabled',
            'credentials' => $encrypted,
            'settings' => self::json($this->sanitize_connection_settings($raw['settings'] ?? [])),
            'webhook_token_hash' => hash('sha256', $webhook_token),
            'webhook_token_encrypted' => $webhook_encrypted,
            'last_verified_at' => null,
            'last_error' => '',
            'created_by' => get_current_user_id(),
            'updated_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ];
        if (!$wpdb->insert(self::table('connections'), $row)) {
            return $this->storage_error('Não foi possível salvar a conexão.');
        }
        $created = $this->connection_by_uuid($uuid) ?: array_merge($row, ['id' => $wpdb->insert_id]);
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.connection.created',
            'connection',
            $uuid,
            [],
            $this->connection_audit_snapshot($created)
        );
        do_action('kodety_checkout_connection_changed', $uuid, 'created');
        return $this->response($this->format_connection($created), 201);
    }

    public function update_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $before = $this->connection_by_uuid((string) $request['id']);
        if (!$before) return $this->not_found('connection');
        $raw = $this->payload($request);
        $provider = (string) $before['provider'];
        if (isset($raw['provider']) && self::provider_key($raw['provider']) !== $provider) {
            return new WP_Error(
                'kodety_checkout_provider_immutable',
                'O provedor de uma conexão não pode ser alterado.',
                ['status' => 409]
            );
        }
        $current_credentials = $this->decrypt_secret((string) $before['credentials']);
        if (is_wp_error($current_credentials)) return $current_credentials;
        $credentials = $current_credentials;
        if (array_key_exists('credentials', $raw)) {
            $incoming = $this->sanitize_credentials($provider, $raw['credentials']);
            if (is_wp_error($incoming)) return $incoming;
            $credentials = array_merge($credentials, $incoming);
            $incoming_raw = is_array($raw['credentials']) ? $raw['credentials'] : [];
            $credential_aliases = [
                'account_id' => 'accountId',
                'account_email' => 'accountEmail',
            ];
            foreach ((array) (self::PROVIDERS[$provider]['optionalCredentials'] ?? []) as $field) {
                $raw_field = array_key_exists($field, $incoming_raw)
                    ? $field
                    : array_search($field, $credential_aliases, true);
                if (
                    is_string($raw_field)
                    && array_key_exists($raw_field, $incoming_raw)
                    && ($incoming_raw[$raw_field] === null
                        || trim((string) $incoming_raw[$raw_field]) === '')
                ) {
                    unset($credentials[$field]);
                }
            }
        }
        $enabled = array_key_exists('enabled', $raw)
            ? rest_sanitize_boolean($raw['enabled'])
            : !empty($before['enabled']);
        $required = $this->validate_required_credentials($provider, $credentials, $enabled);
        if (is_wp_error($required)) return $required;
        $encrypted = $this->encrypt_secret($credentials);
        if (is_wp_error($encrypted)) return $encrypted;
        $update = [
            'enabled' => $enabled ? 1 : 0,
            'credentials' => $encrypted,
            'updated_by' => get_current_user_id(),
            'updated_at' => self::now(),
        ];
        if (array_key_exists('name', $raw)) {
            $name = substr(sanitize_text_field((string) $raw['name']), 0, 191);
            if ($name === '') {
                return new WP_Error('kodety_checkout_name', 'Nome obrigatório.', ['status' => 400]);
            }
            $update['name'] = $name;
        }
        $before_settings = self::decode_json($before['settings'] ?? '', []);
        $after_settings = $before_settings;
        if (array_key_exists('settings', $raw)) {
            $incoming_settings = is_array($raw['settings']) ? $raw['settings'] : [];
            $after_settings = $this->sanitize_connection_settings(array_merge(
                is_array($before_settings) ? $before_settings : [],
                $incoming_settings
            ));
            $update['settings'] = self::json($after_settings);
        }
        $environment_changed = (string) ($before_settings['environment'] ?? 'production')
            !== (string) ($after_settings['environment'] ?? 'production');
        if ($environment_changed && $this->connection_has_commerce_history($before)) {
            return new WP_Error(
                'kodety_checkout_environment_immutable',
                'O ambiente não pode ser trocado depois do primeiro checkout ou contrato. '
                    . 'Crie uma nova conexão para usar outro ambiente.',
                ['status' => 409]
            );
        }
        if (!$enabled) {
            $update['status'] = 'disabled';
            $update['last_error'] = '';
        } elseif (
            empty($before['enabled'])
            || array_key_exists('credentials', $raw)
            || $environment_changed
        ) {
            $update['status'] = 'unverified';
            $update['last_verified_at'] = null;
            $update['last_error'] = '';
        }
        if ($wpdb->update(self::table('connections'), $update, ['id' => absint($before['id'])]) === false) {
            return $this->storage_error('Não foi possível atualizar a conexão.');
        }
        $after = $this->connection_by_uuid((string) $before['uuid']) ?: array_merge($before, $update);
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.connection.updated',
            'connection',
            (string) $before['uuid'],
            $this->connection_audit_snapshot($before),
            $this->connection_audit_snapshot($after)
        );
        do_action('kodety_checkout_connection_changed', (string) $before['uuid'], 'updated');
        return $this->response($this->format_connection($after));
    }

    public function delete_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $before = $this->connection_by_uuid((string) $request['id']);
        if (!$before) return $this->not_found('connection');
        $connection_id = absint($before['id']);
        $active = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . self::table('mappings')
                . " WHERE connection_id=%d AND status='active'",
            $connection_id
        ));
        if ($active > 0) {
            return new WP_Error(
                'kodety_checkout_connection_in_use',
                'Arquive os mapeamentos antes de remover esta conexão.',
                ['status' => 409]
            );
        }
        $active_contracts = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(*) FROM ' . $wpdb->prefix . 'kodety_membership_subscriptions'
                . ' WHERE provider=%s AND provider_tenant=%s'
                . " AND status IN ('trialing','active','past_due','paused','incomplete')",
            (string) $before['provider'],
            (string) $before['uuid']
        ));
        if ($active_contracts > 0) {
            return new WP_Error(
                'kodety_checkout_connection_has_contracts',
                'Esta conexão ainda possui contratos não encerrados. Desative-a para impedir '
                    . 'novas vendas sem interromper renovações, cancelamentos e estornos.',
                ['status' => 409, 'activeContracts' => $active_contracts]
            );
        }
        $open_sales = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(*) FROM ' . self::table('sales')
                . " WHERE connection_id=%d AND (status IN ('pending','unlinked')"
                . " OR access_status IN ('pending','review'))",
            $connection_id
        ));
        if ($open_sales > 0) {
            return new WP_Error(
                'kodety_checkout_connection_has_open_sales',
                'Esta conexão ainda possui checkouts ou vendas em processamento. '
                    . 'Desative-a e aguarde a conclusão ou expiração antes de remover.',
                ['status' => 409, 'openSales' => $open_sales]
            );
        }
        $historical_sales = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT COUNT(*) FROM ' . self::table('sales') . ' WHERE connection_id=%d',
            $connection_id
        ));
        if ($historical_sales > 0) {
            return new WP_Error(
                'kodety_checkout_connection_has_history',
                'Conexões que já processaram vendas não podem apagar credenciais de ciclo de vida. '
                    . 'Desative a conexão para impedir novas vendas e manter estornos e contestações.',
                ['status' => 409, 'sales' => $historical_sales]
            );
        }
        if ($wpdb->update(self::table('connections'), [
            'enabled' => 0,
            'status' => 'deleted',
            'credentials' => '',
            'webhook_token_encrypted' => '',
            'updated_by' => get_current_user_id(),
            'updated_at' => self::now(),
        ], ['id' => $connection_id]) === false) {
            return $this->storage_error('Não foi possível remover a conexão.');
        }
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.connection.deleted',
            'connection',
            (string) $before['uuid'],
            $this->connection_audit_snapshot($before),
            array_merge($this->connection_audit_snapshot($before), [
                'enabled' => false,
                'status' => 'deleted',
            ])
        );
        do_action('kodety_checkout_connection_changed', (string) $before['uuid'], 'deleted');
        return $this->response(['deleted' => true]);
    }

    private function connection_has_commerce_history(array $connection): bool {
        global $wpdb;
        $connection_id = absint($connection['id'] ?? 0);
        if ($connection_id > 0) {
            $has_sale = (int) $wpdb->get_var($wpdb->prepare(
                'SELECT EXISTS(SELECT 1 FROM ' . self::table('sales')
                    . ' WHERE connection_id=%d LIMIT 1)',
                $connection_id
            ));
            if ($has_sale > 0) return true;
        }
        $provider = self::provider_key($connection['provider'] ?? '');
        $tenant = self::uuid($connection['uuid'] ?? '');
        if ($provider === '' || $tenant === '') return false;
        return (int) $wpdb->get_var($wpdb->prepare(
            'SELECT EXISTS(SELECT 1 FROM ' . $wpdb->prefix
                . 'kodety_membership_subscriptions'
                . ' WHERE provider=%s AND provider_tenant=%s LIMIT 1)',
            $provider,
            $tenant
        )) > 0;
    }

    /** @param array<string,mixed> $row */
    private function format_connection(array $row): array {
        $provider = self::provider_key($row['provider'] ?? '');
        $definition = self::PROVIDERS[$provider] ?? [];
        $credentials = $this->decrypt_secret((string) ($row['credentials'] ?? ''));
        if (is_wp_error($credentials)) $credentials = [];
        $can_manage_commerce = current_user_can('kodety_manage_commerce');
        $webhook = $can_manage_commerce ? $this->webhook_token($row) : '';
        return [
            'id' => (string) ($row['uuid'] ?? ''),
            'provider' => $provider,
            'providerLabel' => (string) ($definition['label'] ?? $provider),
            'name' => (string) ($row['name'] ?? ''),
            'enabled' => !empty($row['enabled']),
            'status' => (string) ($row['status'] ?? 'unverified'),
            'credentials' => $this->redact_credentials(
                $provider,
                $credentials,
                $can_manage_commerce
            ),
            'settings' => self::decode_json($row['settings'] ?? '', []),
            'webhookConfigured' => (string) ($row['webhook_token_hash'] ?? '') !== '',
            'webhookUrl' => $can_manage_commerce && !is_wp_error($webhook) && $webhook !== ''
                ? rest_url(self::REST_NAMESPACE . '/c/' . rawurlencode($webhook))
                : '',
            'capabilities' => (array) ($definition['capabilities'] ?? []),
            'dashboardUrl' => self::safe_dashboard_url($provider),
            'lastVerifiedAt' => self::mysql_to_iso($row['last_verified_at'] ?? null),
            'lastSyncedAt' => self::mysql_to_iso($row['last_synced_at'] ?? null),
            'lastError' => (string) ($row['last_error'] ?? ''),
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
        ];
    }

    /** @param array<string,mixed> $row */
    private function connection_audit_snapshot(array $row): array {
        $settings = self::decode_json($row['settings'] ?? '', []);
        return [
            'provider' => self::provider_key($row['provider'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'enabled' => !empty($row['enabled']),
            'status' => (string) ($row['status'] ?? 'unverified'),
            'environment' => (string) ($settings['environment'] ?? 'production'),
        ];
    }

    /** @param array<string,mixed> $row */
    private function mapping_audit_snapshot(array $row): array {
        return [
            'connectionId' => (string) ($row['connection_uuid'] ?? ''),
            'planId' => absint($row['plan_id'] ?? 0),
            'mode' => self::checkout_mode($row['mode'] ?? 'payment'),
            'amount' => isset($row['amount']) ? (int) $row['amount'] : null,
            'currency' => self::currency($row['currency'] ?? 'BRL'),
            'status' => (string) ($row['status'] ?? 'active'),
        ];
    }

    /** @return array<string,mixed>|null */
    private function connection_by_uuid(string $uuid): ?array {
        global $wpdb;
        $uuid = self::uuid($uuid);
        if ($uuid === '') return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table('connections') . ' WHERE uuid=%s',
            $uuid
        ), ARRAY_A);
        return is_array($row) && ($row['status'] ?? '') !== 'deleted' ? $row : null;
    }

    /** @return array<string,mixed>|null */
    private function connection_by_id(int $id): ?array {
        global $wpdb;
        if ($id <= 0) return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table('connections') . ' WHERE id=%d',
            $id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public function list_mappings(): WP_REST_Response {
        global $wpdb;
        $rows = $wpdb->get_results(
            'SELECT m.*,c.uuid AS connection_uuid,c.provider,c.name AS connection_name,
                    p.name AS plan_name,p.slug AS plan_slug,p.status AS plan_status
             FROM ' . self::table('mappings') . ' m
             INNER JOIN ' . self::table('connections') . ' c ON c.id=m.connection_id
             INNER JOIN ' . $wpdb->prefix . 'kodety_membership_plans p ON p.id=m.plan_id
             WHERE m.status<>\'deleted\'
             ORDER BY m.updated_at DESC,m.id DESC',
            ARRAY_A
        );
        return $this->response([
            'items' => array_map([$this, 'format_mapping'], $rows ?: []),
            'total' => count($rows ?: []),
        ]);
    }

    public function create_mapping(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $raw = $this->payload($request);
        $validated = $this->validate_mapping_input($raw);
        if (is_wp_error($validated)) return $validated;
        [$connection, $plan, $values] = $validated;
        $uuid = wp_generate_uuid4();
        $now = self::now();
        $row = array_merge($values, [
            'uuid' => $uuid,
            'public_key' => self::opaque_token(),
            'connection_id' => absint($connection['id']),
            'plan_id' => absint($plan['id']),
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $existing = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table('mappings')
                . ' WHERE connection_id=%d AND plan_id=%d AND mode=%s LIMIT 1',
            absint($connection['id']),
            absint($plan['id']),
            (string) $values['mode']
        ), ARRAY_A);
        if (is_array($existing)) {
            if (($existing['status'] ?? '') !== 'deleted') {
                return new WP_Error(
                    'kodety_checkout_mapping_conflict',
                    'Já existe um mapeamento deste plano e modalidade para a conexão.',
                    ['status' => 409, 'id' => (string) ($existing['uuid'] ?? '')]
                );
            }
            $reactivated = array_merge($values, [
                'public_key' => self::opaque_token(),
                'status' => 'active',
                'updated_at' => $now,
            ]);
            $changed = $wpdb->update(
                self::table('mappings'),
                $reactivated,
                [
                    'id' => absint($existing['id']),
                    'status' => 'deleted',
                ]
            );
            if ($changed === false) {
                return $this->storage_error('Não foi possível reativar o mapeamento.');
            }
            if ($changed === 0) {
                return new WP_Error(
                    'kodety_checkout_mapping_conflict',
                    'O mapeamento foi alterado por outra operação. Atualize e tente novamente.',
                    ['status' => 409]
                );
            }
            $created = $this->mapping_by_uuid((string) $existing['uuid']);
            Kodety_Members::instance()->record_commerce_audit(
                'commerce.mapping.updated',
                'mapping',
                (string) $existing['uuid'],
                $this->mapping_audit_snapshot($existing),
                $this->mapping_audit_snapshot($created ?: array_merge($existing, $reactivated))
            );
            do_action(
                'kodety_checkout_mapping_changed',
                (string) $existing['uuid'],
                'reactivated'
            );
            return $this->response(
                $this->format_mapping($created ?: array_merge(
                    $existing,
                    $reactivated,
                    [
                        'provider' => $connection['provider'],
                        'connection_uuid' => $connection['uuid'],
                        'connection_name' => $connection['name'],
                        'plan_name' => $plan['name'],
                        'plan_slug' => $plan['slug'],
                        'plan_status' => $plan['status'],
                    ]
                )),
                201
            );
        }
        if (!$wpdb->insert(self::table('mappings'), $row)) {
            $duplicate = $wpdb->get_row($wpdb->prepare(
                'SELECT uuid FROM ' . self::table('mappings')
                    . ' WHERE connection_id=%d AND plan_id=%d AND mode=%s',
                absint($connection['id']),
                absint($plan['id']),
                (string) $values['mode']
            ), ARRAY_A);
            if (is_array($duplicate)) {
                return new WP_Error(
                    'kodety_checkout_mapping_conflict',
                    'Já existe um mapeamento deste plano e modalidade para a conexão.',
                    ['status' => 409, 'id' => (string) ($duplicate['uuid'] ?? '')]
                );
            }
            return $this->storage_error('Não foi possível salvar o mapeamento.');
        }
        $created = $this->mapping_by_uuid($uuid);
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.mapping.created',
            'mapping',
            $uuid,
            [],
            $this->mapping_audit_snapshot($created ?: $row)
        );
        do_action('kodety_checkout_mapping_changed', $uuid, 'created');
        return $this->response(
            $this->format_mapping($created ?: array_merge(
                $row,
                [
                    'provider' => $connection['provider'],
                    'connection_uuid' => $connection['uuid'],
                    'connection_name' => $connection['name'],
                    'plan_name' => $plan['name'],
                    'plan_slug' => $plan['slug'],
                    'plan_status' => $plan['status'],
                ]
            )),
            201
        );
    }

    public function update_mapping(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $before = $this->mapping_by_uuid((string) $request['id']);
        if (!$before || ($before['status'] ?? '') === 'deleted') {
            return $this->not_found('mapping');
        }
        $raw = $this->payload($request);
        if (
            array_key_exists('connectionId', $raw)
            || array_key_exists('connection_id', $raw)
            || array_key_exists('planId', $raw)
            || array_key_exists('plan_id', $raw)
            || (
                array_key_exists('mode', $raw)
                && self::checkout_mode($raw['mode'])
                    !== self::checkout_mode($before['mode'] ?? 'payment')
            )
        ) {
            return new WP_Error(
                'kodety_checkout_mapping_identity_immutable',
                'Conexão, plano e modalidade não podem ser alterados; crie outro mapeamento.',
                ['status' => 409]
            );
        }
        $merged = [
            'connectionId' => (string) $before['connection_uuid'],
            'planId' => absint($before['plan_id']),
            'mode' => $before['mode'],
            'externalProductId' => $raw['externalProductId']
                ?? $raw['external_product_id']
                ?? $before['external_product_id'],
            'externalPriceId' => $raw['externalPriceId']
                ?? $raw['external_price_id']
                ?? $before['external_price_id'],
            'amount' => array_key_exists('amount', $raw) ? $raw['amount'] : $before['amount'],
            'currency' => $raw['currency'] ?? $before['currency'],
            'settings' => $raw['settings'] ?? self::decode_json($before['settings'] ?? '', []),
        ];
        $validated = $this->validate_mapping_input($merged);
        if (is_wp_error($validated)) return $validated;
        [, , $values] = $validated;
        $values['status'] = array_key_exists('status', $raw)
            ? self::mapping_status($raw['status'])
            : (string) $before['status'];
        $values['updated_at'] = self::now();
        if ($wpdb->update(self::table('mappings'), $values, ['id' => absint($before['id'])]) === false) {
            return $this->storage_error('Não foi possível atualizar o mapeamento.');
        }
        $after = $this->mapping_by_uuid((string) $before['uuid']) ?: array_merge($before, $values);
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.mapping.updated',
            'mapping',
            (string) $before['uuid'],
            $this->mapping_audit_snapshot($before),
            $this->mapping_audit_snapshot($after)
        );
        do_action('kodety_checkout_mapping_changed', (string) $before['uuid'], 'updated');
        return $this->response($this->format_mapping($after));
    }

    public function delete_mapping(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $before = $this->mapping_by_uuid((string) $request['id']);
        if (!$before || ($before['status'] ?? '') === 'deleted') {
            return $this->not_found('mapping');
        }
        if ($wpdb->update(self::table('mappings'), [
            'status' => 'deleted',
            'updated_at' => self::now(),
        ], ['id' => absint($before['id'])]) === false) {
            return $this->storage_error('Não foi possível remover o mapeamento.');
        }
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.mapping.deleted',
            'mapping',
            (string) $before['uuid'],
            $this->mapping_audit_snapshot($before),
            array_merge($this->mapping_audit_snapshot($before), ['status' => 'deleted'])
        );
        do_action('kodety_checkout_mapping_changed', (string) $before['uuid'], 'deleted');
        return $this->response(['deleted' => true]);
    }

    /**
     * @param array<string,mixed> $raw
     * @return array{0:array<string,mixed>,1:array<string,mixed>,2:array<string,mixed>}|WP_Error
     */
    private function validate_mapping_input(array $raw): array|WP_Error {
        $connection_uuid = (string) (
            $raw['connectionId'] ?? $raw['connection_id'] ?? ''
        );
        $connection = $this->connection_by_uuid($connection_uuid);
        if (!$connection || ($connection['status'] ?? '') === 'deleted') {
            return $this->not_found('connection');
        }
        $plan_id = absint($raw['planId'] ?? $raw['plan_id'] ?? 0);
        $plan = $this->plan_row($plan_id);
        if (!$plan || ($plan['status'] ?? '') !== 'active') {
            return new WP_Error(
                'kodety_checkout_plan_not_found',
                'Plano ativo não encontrado.',
                ['status' => 404]
            );
        }
        $mode = self::checkout_mode($raw['mode'] ?? 'payment');
        $capabilities = (array) (
            self::PROVIDERS[(string) $connection['provider']]['capabilities'] ?? []
        );
        if ($mode === 'subscription' && empty($capabilities['subscriptions'])) {
            return new WP_Error(
                'kodety_checkout_mode_unsupported',
                'Esta conexão não oferece checkout recorrente neste adaptador.',
                ['status' => 422]
            );
        }
        $external_product = self::external_id(
            $raw['externalProductId'] ?? $raw['external_product_id'] ?? ''
        );
        $external_price = self::external_id(
            $raw['externalPriceId'] ?? $raw['external_price_id'] ?? ''
        );
        $amount = self::nullable_amount($raw['amount'] ?? null);
        if (is_wp_error($amount)) return $amount;
        $currency = self::currency($raw['currency'] ?? 'BRL');
        $provider = (string) $connection['provider'];
        if ($provider === 'stripe' && $external_price === '') {
            return new WP_Error(
                'kodety_checkout_price_required',
                'O Price ID da Stripe é obrigatório.',
                ['status' => 400]
            );
        }
        if (in_array($provider, ['hotmart', 'ticto'], true) && $external_price === '') {
            return new WP_Error(
                'kodety_checkout_offer_required',
                'O código da oferta do provedor é obrigatório.',
                ['status' => 400]
            );
        }
        if (
            in_array($provider, ['mercado_pago', 'asaas', 'pagbank', 'pagarme', 'woovi', 'iugu'], true)
            && ($amount === null || $amount <= 0)
        ) {
            return new WP_Error(
                'kodety_checkout_amount_required',
                'Informe o preço em centavos para este provedor.',
                ['status' => 400]
            );
        }
        if ($provider === 'pagarme' && $mode === 'subscription' && $external_product === '') {
            return new WP_Error(
                'kodety_checkout_product_required',
                'O Plan ID recorrente da Pagar.me é obrigatório.',
                ['status' => 400]
            );
        }
        if ($provider === 'iugu' && $mode === 'subscription' && $external_product === '') {
            return new WP_Error(
                'kodety_checkout_product_required',
                'O identificador do plano Iugu é obrigatório.',
                ['status' => 400]
            );
        }
        $mapping_settings = $this->sanitize_mapping_settings($raw['settings'] ?? []);
        if (
            $provider === 'pagarme'
            && $mode === 'subscription'
            && in_array('pix', (array) ($mapping_settings['paymentMethods'] ?? []), true)
        ) {
            return new WP_Error(
                'kodety_checkout_payment_method_unsupported',
                'Pix não está disponível no checkout recorrente da Pagar.me.',
                ['status' => 422, 'field' => 'settings.paymentMethods']
            );
        }
        return [$connection, $plan, [
            'mode' => $mode,
            'external_product_id' => $external_product,
            'external_price_id' => $external_price,
            'amount' => $amount,
            'currency' => $currency,
            'settings' => self::json($mapping_settings),
        ]];
    }

    /** @return array<string,mixed>|null */
    private function mapping_by_uuid(string $uuid): ?array {
        global $wpdb;
        $uuid = self::uuid($uuid);
        if ($uuid === '') return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT m.*,c.uuid AS connection_uuid,c.provider,c.name AS connection_name,
                    c.enabled AS connection_enabled,c.status AS connection_status,
                    c.settings AS connection_settings,
                    p.name AS plan_name,p.slug AS plan_slug,p.status AS plan_status
             FROM ' . self::table('mappings') . ' m
             INNER JOIN ' . self::table('connections') . ' c ON c.id=m.connection_id
             INNER JOIN ' . $wpdb->prefix . 'kodety_membership_plans p ON p.id=m.plan_id
             WHERE m.uuid=%s',
            $uuid
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /** @return array<string,mixed>|null */
    private function mapping_by_public_key(string $key): ?array {
        global $wpdb;
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $key)) return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT m.*,c.uuid AS connection_uuid,c.provider,c.name AS connection_name,
                    c.enabled AS connection_enabled,c.status AS connection_status,
                    c.settings AS connection_settings,
                    p.name AS plan_name,p.slug AS plan_slug,p.status AS plan_status
             FROM ' . self::table('mappings') . ' m
             INNER JOIN ' . self::table('connections') . ' c ON c.id=m.connection_id
             INNER JOIN ' . $wpdb->prefix . 'kodety_membership_plans p ON p.id=m.plan_id
             WHERE m.public_key=%s',
            $key
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /** @param array<string,mixed> $row */
    private function format_mapping(array $row): array {
        return [
            'id' => (string) ($row['uuid'] ?? ''),
            'connectionId' => (string) ($row['connection_uuid'] ?? ''),
            'connectionName' => (string) ($row['connection_name'] ?? ''),
            'provider' => (string) ($row['provider'] ?? ''),
            'planId' => absint($row['plan_id'] ?? 0),
            'planName' => (string) ($row['plan_name'] ?? ''),
            'planSlug' => (string) ($row['plan_slug'] ?? ''),
            'externalProductId' => (string) ($row['external_product_id'] ?? ''),
            'externalPriceId' => (string) ($row['external_price_id'] ?? ''),
            'mode' => (string) ($row['mode'] ?? 'payment'),
            'amount' => isset($row['amount']) ? (int) $row['amount'] : null,
            'currency' => self::currency($row['currency'] ?? 'BRL'),
            'status' => (string) ($row['status'] ?? 'active'),
            'settings' => self::decode_json($row['settings'] ?? '', []),
            'publicKey' => (string) ($row['public_key'] ?? ''),
            'publicUrl' => ($row['public_key'] ?? '') !== ''
                ? $this->public_mapping_url((string) $row['public_key'])
                : '',
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
        ];
    }

    /** @return array<string,mixed>|null */
    private function plan_row(int $id): ?array {
        global $wpdb;
        if ($id <= 0) return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT id,slug,name,status FROM '
                . $wpdb->prefix . 'kodety_membership_plans WHERE id=%d',
            $id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public function overview(): WP_REST_Response {
        global $wpdb;
        $connection_counts = $wpdb->get_row(
            'SELECT COUNT(*) AS total,
                    SUM(CASE WHEN enabled=1 AND status=\'connected\' THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN enabled=1 AND status<>\'connected\' THEN 1 ELSE 0 END) AS attention
             FROM ' . self::table('connections') . ' WHERE status<>\'deleted\'',
            ARRAY_A
        );
        $sales = $wpdb->get_row(
            'SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status=\'paid\' THEN 1 ELSE 0 END) AS paid,
                    SUM(CASE WHEN status=\'pending\' THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN status IN (\'refunded\',\'chargeback\') THEN 1 ELSE 0 END) AS refunded,
                    SUM(CASE WHEN access_status IN (\'unmatched\',\'unlinked\') THEN 1 ELSE 0 END) AS unlinked
             FROM ' . self::table('sales'),
            ARRAY_A
        );
        $amount_rows = $wpdb->get_results(
            'SELECT currency,SUM(COALESCE(amount,0)) AS gross_amount
             FROM ' . self::table('sales')
                . " WHERE status='paid' GROUP BY currency ORDER BY currency ASC",
            ARRAY_A
        );
        $amounts_by_currency = [];
        foreach ($amount_rows ?: [] as $amount_row) {
            $currency = self::currency($amount_row['currency'] ?? '');
            if ($currency !== '') $amounts_by_currency[$currency] = (int) ($amount_row['gross_amount'] ?? 0);
        }
        $subscription_counts = $wpdb->get_row(
            'SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status=\'active\' THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN status=\'trialing\' THEN 1 ELSE 0 END) AS trialing,
                    SUM(CASE WHEN status=\'past_due\' THEN 1 ELSE 0 END) AS past_due,
                    SUM(CASE WHEN status IN (\'canceled\',\'expired\') THEN 1 ELSE 0 END) AS canceled
             FROM ' . $wpdb->prefix . 'kodety_membership_subscriptions
             WHERE provider IN (\'stripe\',\'mercado-pago\',\'mercado_pago\',\'asaas\',
                                \'pagbank\',\'pagarme\',\'woovi\',\'iugu\',\'hotmart\',\'ticto\')',
            ARRAY_A
        );
        $mapping_counts = $wpdb->get_row(
            'SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status=\'active\' THEN 1 ELSE 0 END) AS active
             FROM ' . self::table('mappings'),
            ARRAY_A
        );
        $artifact_counts = $wpdb->get_row(
            'SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status=\'pending\' THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN status=\'pending\' AND last_error<>\'\' THEN 1 ELSE 0 END) AS failed
             FROM ' . self::table('artifacts'),
            ARRAY_A
        );
        $mapped_plan_count = absint($mapping_counts['active'] ?? 0);
        return $this->response([
            'providers' => self::provider_catalog(),
            'mappedPlanCount' => $mapped_plan_count,
            'counts' => [
                'mappings' => $mapped_plan_count,
            ],
            'mappings' => [
                'total' => absint($mapping_counts['total'] ?? 0),
                'active' => $mapped_plan_count,
            ],
            'connections' => [
                'total' => absint($connection_counts['total'] ?? 0),
                'active' => absint($connection_counts['active'] ?? 0),
                'attention' => absint($connection_counts['attention'] ?? 0),
            ],
            'sales' => [
                'total' => absint($sales['total'] ?? 0),
                'paid' => absint($sales['paid'] ?? 0),
                'pending' => absint($sales['pending'] ?? 0),
                'refunded' => absint($sales['refunded'] ?? 0),
                'amountsByCurrency' => $amounts_by_currency,
                'metric' => 'gross_sales_volume',
            ],
            'subscriptions' => [
                'total' => absint($subscription_counts['total'] ?? 0),
                'active' => absint($subscription_counts['active'] ?? 0),
                'trialing' => absint($subscription_counts['trialing'] ?? 0),
                'pastDue' => absint($subscription_counts['past_due'] ?? 0),
                'canceled' => absint($subscription_counts['canceled'] ?? 0),
            ],
            'reconciliation' => [
                'artifacts' => absint($artifact_counts['total'] ?? 0),
                'pending' => absint($artifact_counts['pending'] ?? 0),
                'failed' => absint($artifact_counts['failed'] ?? 0),
            ],
            'unlinkedSales' => absint($sales['unlinked'] ?? 0),
        ]);
    }

    public function create_checkout_link(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $raw = $this->payload($request);
        $mapping = null;
        $mapping_uuid = (string) ($raw['mappingId'] ?? $raw['mapping_id'] ?? '');
        if ($mapping_uuid !== '') $mapping = $this->mapping_by_uuid($mapping_uuid);
        if (!$mapping) {
            $connection_uuid = (string) (
                $raw['connectionId'] ?? $raw['connection_id'] ?? ''
            );
            $plan_id = absint($raw['planId'] ?? $raw['plan_id'] ?? 0);
            $mode = self::checkout_mode($raw['mode'] ?? 'payment');
            $mapping = $this->mapping_for_checkout($connection_uuid, $plan_id, $mode);
        }
        if (!$mapping) return $this->not_found('mapping');
        if (
            ($mapping['status'] ?? '') !== 'active'
            || ($mapping['plan_status'] ?? '') !== 'active'
        ) {
            return new WP_Error(
                'kodety_checkout_mapping_inactive',
                'Este mapeamento ou plano não está ativo.',
                ['status' => 409]
            );
        }
        $user_id = absint($raw['userId'] ?? $raw['user_id'] ?? 0);
        if ($user_id > 0 && !$this->can_manage_member($user_id)) {
            return new WP_Error(
                'kodety_checkout_member_forbidden',
                'Sem permissão para este membro.',
                ['status' => 403]
            );
        }
        $email = sanitize_email((string) (
            $raw['customerEmail'] ?? $raw['customer_email'] ?? ''
        ));
        if ($email !== '' && !is_email($email)) {
            return new WP_Error(
                'kodety_checkout_email',
                'E-mail inválido.',
                ['status' => 400]
            );
        }
        if ($user_id > 0) {
            $checkout_user = get_user_by('id', $user_id);
            if (!$checkout_user instanceof WP_User) {
                return new WP_Error(
                    'kodety_checkout_member_not_found',
                    'Membro não encontrado.',
                    ['status' => 404]
                );
            }
            $member_email = sanitize_email((string) $checkout_user->user_email);
            if (
                $email !== ''
                && !hash_equals(strtolower($member_email), strtolower($email))
            ) {
                return new WP_Error(
                    'kodety_checkout_member_email_mismatch',
                    'O e-mail informado não pertence ao membro selecionado.',
                    ['status' => 409]
                );
            }
            $email = $member_email;
        }
        $success_url = $this->same_site_return_url(
            $raw['successUrl'] ?? $raw['success_url'] ?? '',
            $this->mapping_setting($mapping, 'successUrl', home_url('/'))
        );
        $cancel_url = $this->same_site_return_url(
            $raw['cancelUrl'] ?? $raw['cancel_url'] ?? '',
            $this->mapping_setting($mapping, 'cancelUrl', home_url('/'))
        );
        if (is_wp_error($success_url) || is_wp_error($cancel_url)) {
            return is_wp_error($success_url) ? $success_url : $cancel_url;
        }
        $created = $this->create_hosted_checkout(
            $mapping,
            $user_id,
            $email,
            $success_url,
            $cancel_url,
            substr(sanitize_text_field((string) (
                $raw['clientReference'] ?? $raw['client_reference'] ?? ''
            )), 0, 191)
        );
        if (is_wp_error($created)) return $created;
        return $this->response($created, 201);
    }

    public function public_buy(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $mapping = $this->mapping_by_public_key((string) $request['key']);
        if (
            !$mapping
            || ($mapping['status'] ?? '') !== 'active'
            || empty($mapping['connection_enabled'])
            || ($mapping['connection_status'] ?? '') === 'deleted'
            || ($mapping['plan_status'] ?? '') !== 'active'
        ) {
            return new WP_Error(
                'kodety_checkout_unavailable',
                'Este checkout não está disponível.',
                ['status' => 404]
            );
        }
        if (strtoupper((string) $request->get_method()) === 'GET') {
            $response = new WP_REST_Response(null, 303);
            $response->header(
                'Location',
                $this->public_mapping_url((string) $mapping['public_key'])
            );
            $response->header('Cache-Control', 'no-store, private');
            return $response;
        }
        $user_id = Kodety_Members::current_member_id();
        $email = '';
        if ($user_id > 0) {
            $user = get_user_by('id', $user_id);
            if ($user instanceof WP_User) $email = sanitize_email((string) $user->user_email);
        } elseif (strtoupper((string) $request->get_method()) === 'POST') {
            $email = sanitize_email((string) $request->get_param('email'));
        }
        if ($user_id === 0 && ($email === '' || !is_email($email))) {
            return new WP_Error(
                'kodety_checkout_email_required',
                'Informe um e-mail válido antes de abrir o checkout.',
                ['status' => 400]
            );
        }
        if ($user_id === 0) {
            $this->send_checkout_preflight_email(
                $mapping,
                (string) $mapping['public_key'],
                $email
            );
            return $this->response([
                'verificationRequired' => true,
                'message' => 'Se o endereço puder continuar, enviaremos as instruções por e-mail.',
            ], 202);
        }
        $success_url = $this->same_site_return_url(
            '',
            $this->mapping_setting($mapping, 'successUrl', home_url('/'))
        );
        $cancel_url = $this->same_site_return_url(
            '',
            $this->mapping_setting($mapping, 'cancelUrl', home_url('/'))
        );
        if (is_wp_error($success_url) || is_wp_error($cancel_url)) {
            return new WP_Error(
                'kodety_checkout_configuration',
                'O checkout não possui URLs de retorno válidas.',
                ['status' => 503]
            );
        }
        $created = $this->create_hosted_checkout(
            $mapping,
            $user_id,
            $email,
            $success_url,
            $cancel_url,
            ''
        );
        if (is_wp_error($created)) return $created;
        $accept = strtolower((string) $request->get_header('Accept'));
        $wants_json = str_contains($accept, 'application/json')
            || rest_sanitize_boolean($request->get_param('json'));
        if ($wants_json) return $this->response($created, 201);
        $response = new WP_REST_Response(null, 303);
        $response->header('Location', (string) $created['url']);
        $response->header('Cache-Control', 'no-store, private');
        return $response;
    }

    /**
     * Stable, cache-safe public checkout entry point used by Builder links.
     * Guests identify themselves before leaving the site, so providers that
     * do not reliably return payer e-mail (notably Pix/Woovi and Iugu) can
     * still invite the correct member after authoritative payment.
     */
    public function handle_public_checkout_page(): void {
        if (!isset($_GET['kodety_checkout'])) return;
        nocache_headers();
        header('X-Robots-Tag: noindex, nofollow', true);
        $key = trim((string) wp_unslash($_GET['kodety_checkout']));
        $mapping = $this->mapping_by_public_key($key);
        if (
            !Kodety_Members::is_current_project_enabled()
            || !$mapping
            || ($mapping['status'] ?? '') !== 'active'
            || empty($mapping['connection_enabled'])
            || ($mapping['connection_status'] ?? '') === 'deleted'
            || ($mapping['plan_status'] ?? '') !== 'active'
        ) {
            $this->render_checkout_capture_page(
                'Checkout indisponível',
                'Este link não está disponível.',
                $key,
                '',
                404,
                false
            );
        }

        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $user_id = Kodety_Members::current_member_id();
        $email = '';
        $verified_guest_email = '';
        if (
            $user_id === 0
            && isset($_GET['kodety_checkout_continue'])
        ) {
            $continuation = trim((string) wp_unslash($_GET['kodety_checkout_continue']));
            if (preg_match('/^[A-Za-z0-9_-]{43}$/', $continuation)) {
                $continuation_hash = hash_hmac('sha256', $continuation, wp_salt('auth'));
                $transient_key = 'kodety_checkout_continue_' . $continuation_hash;
                $payload = $method === 'POST'
                    ? null
                    : get_transient($transient_key);
                if (
                    $method !== 'POST'
                    && is_array($payload)
                    && hash_equals((string) ($payload['mappingKey'] ?? ''), $key)
                    && absint($payload['expires'] ?? 0) >= time()
                ) {
                    $this->render_checkout_capture_page(
                        'Confirmar e continuar',
                        'Clique abaixo para abrir o checkout seguro do provedor.',
                        $key,
                        '',
                        200,
                        false,
                        (string) ($mapping['plan_name'] ?? ''),
                        true,
                        $continuation
                    );
                }
                $continue_nonce = sanitize_text_field((string) wp_unslash(
                    $_POST['kodety_checkout_continue_nonce'] ?? ''
                ));
                if (
                    $method === 'POST'
                    && wp_verify_nonce(
                        $continue_nonce,
                        'kodety_checkout_continue_' . $key . '_' . $continuation
                    )
                ) {
                    $payload = $this->consume_transient_once($transient_key);
                }
                if (
                    is_array($payload)
                    && hash_equals((string) ($payload['mappingKey'] ?? ''), $key)
                    && absint($payload['expires'] ?? 0) >= time()
                ) {
                    $identity = $this->decrypt_secret((string) (
                        $payload['identity'] ?? ''
                    ));
                    if (!is_wp_error($identity)) {
                        $candidate = sanitize_email((string) ($identity['email'] ?? ''));
                        if (is_email($candidate)) $verified_guest_email = $candidate;
                    }
                }
            }
            if ($verified_guest_email === '') {
                $this->render_checkout_capture_page(
                    'Link expirado',
                    'Solicite um novo link para continuar.',
                    $key,
                    '',
                    400,
                    true,
                    (string) ($mapping['plan_name'] ?? ''),
                    true
                );
            }
            if (email_exists($verified_guest_email)) {
                wp_safe_redirect(
                    $this->member_login_url($this->public_mapping_url($key)),
                    302,
                    'Onun Kodety'
                );
                exit;
            }
        }
        if ($user_id > 0) {
            $user = get_user_by('id', $user_id);
            if ($user instanceof WP_User) $email = sanitize_email((string) $user->user_email);
        } elseif ($verified_guest_email !== '') {
            $email = $verified_guest_email;
        } elseif ($method !== 'POST') {
            $this->render_checkout_capture_page(
                'Continuar para o pagamento',
                'Informe seu e-mail para receber o acesso depois da confirmação.',
                $key,
                '',
                200,
                true,
                (string) ($mapping['plan_name'] ?? ''),
                true
            );
        } else {
            $nonce = sanitize_text_field((string) wp_unslash(
                $_POST['kodety_checkout_nonce'] ?? ''
            ));
            if (!wp_verify_nonce($nonce, 'kodety_checkout_' . $key)) {
                $this->render_checkout_capture_page(
                    'Não foi possível continuar',
                    'A página expirou. Atualize e tente novamente.',
                    $key,
                    '',
                    403,
                    true,
                    (string) ($mapping['plan_name'] ?? '')
                );
            }
            $email = sanitize_email((string) wp_unslash($_POST['email'] ?? ''));
            if ($email === '' || !is_email($email)) {
                $this->render_checkout_capture_page(
                    'Confira seu e-mail',
                    'Informe um endereço de e-mail válido.',
                    $key,
                    $email,
                    400,
                    true,
                    (string) ($mapping['plan_name'] ?? ''),
                    true
                );
            }
            $limited = $this->rate_limit_public($this->request_ip_hash());
            if (is_wp_error($limited)) {
                $this->render_checkout_capture_page(
                    'Tente novamente em alguns minutos',
                    'Muitas tentativas foram feitas a partir desta conexão.',
                    $key,
                    '',
                    429,
                    true,
                    (string) ($mapping['plan_name'] ?? ''),
                    true
                );
            }
            $this->send_checkout_preflight_email($mapping, $key, $email);
            $this->render_checkout_capture_page(
                'Confira seu e-mail',
                'Se o endereço puder continuar, enviaremos as instruções por e-mail.',
                $key,
                '',
                202,
                false,
                (string) ($mapping['plan_name'] ?? ''),
                true
            );
        }
        $limited = $this->rate_limit_public($this->request_ip_hash());
        if (is_wp_error($limited)) {
            $this->render_checkout_capture_page(
                'Tente novamente em alguns minutos',
                'Muitas tentativas foram feitas a partir desta conexão.',
                $key,
                $email,
                429,
                $user_id === 0,
                (string) ($mapping['plan_name'] ?? '')
            );
        }
        $success_url = $this->same_site_return_url(
            '',
            $this->mapping_setting($mapping, 'successUrl', home_url('/'))
        );
        $cancel_url = $this->same_site_return_url(
            '',
            $this->mapping_setting($mapping, 'cancelUrl', $this->public_mapping_url($key))
        );
        if (is_wp_error($success_url) || is_wp_error($cancel_url)) {
            $this->render_checkout_capture_page(
                'Checkout indisponível',
                'A configuração de retorno deste checkout é inválida.',
                $key,
                $email,
                503,
                false
            );
        }
        $created = $this->create_hosted_checkout(
            $mapping,
            $user_id,
            $email,
            (string) $success_url,
            (string) $cancel_url,
            ''
        );
        if (is_wp_error($created)) {
            $this->render_checkout_capture_page(
                'Não foi possível abrir o pagamento',
                'O provedor não respondeu agora. Tente novamente em instantes.',
                $key,
                $email,
                502,
                $user_id === 0,
                (string) ($mapping['plan_name'] ?? '')
            );
        }
        $provider = self::provider_key($mapping['provider'] ?? '');
        $destination = self::provider_checkout_url(
            $provider,
            $created['url'] ?? ''
        );
        if ($destination === '') {
            $this->render_checkout_capture_page(
                'Checkout indisponível',
                'O provedor retornou um endereço inválido.',
                $key,
                $email,
                502,
                false
            );
        }
        wp_redirect($destination, 303, 'Onun Kodety');
        exit;
    }

    private function public_mapping_url(string $key): string {
        return add_query_arg(
            ['kodety_checkout' => preg_replace('/[^A-Za-z0-9_-]/', '', $key)],
            home_url('/')
        );
    }

    /**
     * Public members authenticate through the authored membership page and
     * its isolated Onun Kodety session, never through the native admin login.
     */
    private function member_login_url(string $return_url = ''): string {
        $settings = Kodety_Members::settings();
        $configured = trim((string) ($settings['login_page_url'] ?? ''));
        $login_url = $this->same_site_return_url($configured, home_url('/'));
        if (is_wp_error($login_url) || $login_url === '') {
            $login_url = home_url('/');
        }
        if ($return_url === '') return (string) $login_url;
        $return_url = $this->same_site_return_url($return_url, '');
        if (is_wp_error($return_url) || $return_url === '') {
            return (string) $login_url;
        }
        return add_query_arg(
            ['redirect_to' => (string) $return_url],
            (string) $login_url
        );
    }

    private function member_reset_page_url(): string|WP_Error {
        $settings = Kodety_Members::settings();
        $configured = trim((string) ($settings['reset_page_url'] ?? ''));
        if ($configured === '') {
            return new WP_Error(
                'kodety_checkout_reset_page_missing',
                'Configure a página de redefinição de senha da área de membros.',
                ['status' => 503]
            );
        }
        $reset_url = $this->same_site_return_url($configured, '');
        if (is_wp_error($reset_url) || $reset_url === '') {
            return new WP_Error(
                'kodety_checkout_reset_page_invalid',
                'A página de redefinição de senha da área de membros é inválida.',
                ['status' => 503]
            );
        }
        return (string) $reset_url;
    }

    private function member_reset_url(WP_User $user): string|WP_Error {
        $reset_page_url = $this->member_reset_page_url();
        if (is_wp_error($reset_page_url)) return $reset_page_url;
        $key = get_password_reset_key($user);
        if (is_wp_error($key)) {
            return new WP_Error(
                'kodety_checkout_reset_failed',
                'Não foi possível criar o link de redefinição.',
                ['status' => 500]
            );
        }
        return add_query_arg([
            'key' => (string) $key,
            'login' => (string) $user->user_login,
        ], $reset_page_url);
    }

    private function send_member_reset_email(WP_User $user): bool|WP_Error {
        $url = $this->member_reset_url($user);
        if (is_wp_error($url)) return $url;
        $site_name = wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES);
        $subject = sprintf('[%s] Redefinição de senha', $site_name);
        $message = "Foi solicitada uma redefinição de senha para sua conta.\n\n"
            . "Use o link seguro da área de membros:\n"
            . $url
            . "\n\nSe você não solicitou a alteração, ignore este e-mail.";
        if (!wp_mail((string) $user->user_email, $subject, $message)) {
            return new WP_Error(
                'kodety_checkout_reset_failed',
                'Não foi possível enviar a redefinição agora.',
                ['status' => 502]
            );
        }
        return true;
    }

    /**
     * Identical public response for existing and new addresses prevents
     * account enumeration. Existing members receive the normal login URL;
     * new addresses receive a single-use continuation carrying only an
     * encrypted transient identity.
     */
    private function send_checkout_preflight_email(
        array $mapping,
        string $key,
        string $email
    ): void {
        if (is_wp_error($this->rate_limit_preflight_email($email))) {
            // The caller always returns the same generic 202 response. Keeping
            // the limiter private avoids revealing whether an account exists
            // while stopping distributed requests from repeatedly mailing it.
            do_action('kodety_checkout_preflight_failed', 'email_rate_limit');
            return;
        }
        $return_url = $this->public_mapping_url($key);
        $existing_user_id = absint(email_exists($email));
        if ($existing_user_id > 0) {
            $destination = $this->member_login_url($return_url);
        } else {
            $token = self::opaque_token();
            $identity = $this->encrypt_secret(['email' => $email]);
            if (is_wp_error($identity)) {
                do_action('kodety_checkout_preflight_failed', 'encryption');
                return;
            }
            $expires = time() + self::ACCESS_LINK_TTL;
            $hash = hash_hmac('sha256', $token, wp_salt('auth'));
            if (!set_transient(
                'kodety_checkout_continue_' . $hash,
                [
                    'identity' => $identity,
                    'mappingKey' => $key,
                    'expires' => $expires,
                ],
                self::ACCESS_LINK_TTL
            )) {
                do_action('kodety_checkout_preflight_failed', 'transient');
                return;
            }
            $destination = add_query_arg(
                [
                    'kodety_checkout' => $key,
                    'kodety_checkout_continue' => $token,
                ],
                home_url('/')
            );
        }
        $site_name = wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES);
        $plan_name = sanitize_text_field((string) ($mapping['plan_name'] ?? ''));
        $subject = sprintf('[%s] Continue sua compra', $site_name);
        $message = "Recebemos uma solicitação para continuar a compra";
        if ($plan_name !== '') $message .= ' de ' . $plan_name;
        $message .= ".\n\nUse este link de uso único:\n" . $destination
            . "\n\nSe você não fez a solicitação, ignore este e-mail.";
        if (!wp_mail($email, $subject, $message)) {
            do_action('kodety_checkout_preflight_failed', 'mail');
        }
    }

    private function render_checkout_capture_page(
        string $title,
        string $message,
        string $key,
        string $email,
        int $status,
        bool $show_form,
        string $plan_name = '',
        bool $show_login = false,
        string $continue_token = ''
    ): void {
        nocache_headers();
        header('X-Robots-Tag: noindex, nofollow', true);
        status_header($status);
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));
        $site_name = get_bloginfo('name');
        $action = $this->public_mapping_url($key);
        $nonce = $show_form
            ? wp_nonce_field(
                'kodety_checkout_' . $key,
                'kodety_checkout_nonce',
                true,
                false
            )
            : '';
        echo '<!doctype html><html lang="pt-BR"><head><meta charset="'
            . esc_attr(get_bloginfo('charset'))
            . '"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>' . esc_html($title) . '</title><style>'
            . 'body{margin:0;background:#f5f5f7;color:#171717;font:16px/1.5 -apple-system,'
            . 'BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:440px;margin:10vh auto;'
            . 'background:#fff;border:1px solid #e5e5e5;border-radius:18px;padding:32px;'
            . 'box-shadow:0 18px 50px rgba(0,0,0,.08)}h1{font-size:26px;line-height:1.2;'
            . 'margin:0 0 12px}p{color:#555;margin:0 0 22px}label{display:block;font-weight:'
            . '600;margin-bottom:7px}input{box-sizing:border-box;width:100%;padding:13px 14px;'
            . 'border:1px solid #ccc;border-radius:10px;font:inherit}button{width:100%;margin-top:'
            . '14px;padding:13px 16px;border:0;border-radius:10px;background:#171717;color:#fff;'
            . 'font:600 16px/1 inherit;cursor:pointer}.brand{font-size:13px;color:#777;margin-bottom:'
            . '18px}.plan{font-weight:600;color:#333}</style></head><body><main>'
            . '<div class="brand">' . esc_html($site_name) . '</div>';
        if ($plan_name !== '') {
            echo '<div class="plan">' . esc_html($plan_name) . '</div>';
        }
        echo '<h1>' . esc_html($title) . '</h1><p>' . esc_html($message) . '</p>';
        if ($show_form) {
            echo '<form method="post" action="' . esc_url($action) . '">'
                . $nonce
                . '<label for="kodety-email">E-mail</label>'
                . '<input id="kodety-email" name="email" type="email" autocomplete="email" required'
                . ' value="' . esc_attr($email) . '">'
                . '<button type="submit">Continuar para o pagamento</button></form>';
        }
        if ($continue_token !== '') {
            $continue_nonce = wp_nonce_field(
                'kodety_checkout_continue_' . $key . '_' . $continue_token,
                'kodety_checkout_continue_nonce',
                true,
                false
            );
            echo '<form method="post" action="' . esc_url(add_query_arg(
                    [
                        'kodety_checkout' => $key,
                        'kodety_checkout_continue' => $continue_token,
                    ],
                    home_url('/')
                )) . '">'
                . $continue_nonce
                . '<button type="submit">Abrir checkout seguro</button></form>';
        }
        if ($show_form || $show_login) {
            echo '<p style="margin-top:18px;margin-bottom:0"><a href="'
                . esc_url($this->member_login_url($action))
                . '">Já tem uma conta? Entre antes de comprar.</a></p>';
        }
        echo '</main></body></html>';
        exit;
    }

    /**
     * @param array<string,mixed> $mapping
     * @return array<string,mixed>|WP_Error
     */
    private function create_hosted_checkout(
        array $mapping,
        int $user_id,
        string $email,
        string $success_url,
        string $cancel_url,
        string $client_reference = ''
    ): array|WP_Error {
        global $wpdb;
        if (
            ($mapping['status'] ?? '') !== 'active'
            || ($mapping['plan_status'] ?? '') !== 'active'
        ) {
            return new WP_Error(
                'kodety_checkout_mapping_inactive',
                'Este mapeamento ou plano não está ativo.',
                ['status' => 409]
            );
        }
        $connection = $this->connection_by_id(absint($mapping['connection_id'] ?? 0));
        if (!$connection || empty($connection['enabled']) || ($connection['status'] ?? '') === 'deleted') {
            return new WP_Error(
                'kodety_checkout_connection_disabled',
                'A conexão deste checkout está desativada.',
                ['status' => 503]
            );
        }
        $provider = (string) $connection['provider'];
        $credentials = $this->decrypt_secret((string) $connection['credentials']);
        if (is_wp_error($credentials)) return $credentials;
        $required = $this->validate_required_credentials($provider, $credentials, true);
        if (is_wp_error($required)) return $required;
        if ($user_id > 0 && !(get_user_by('id', $user_id) instanceof WP_User)) {
            return new WP_Error(
                'kodety_checkout_member_not_found',
                'Membro não encontrado.',
                ['status' => 404]
            );
        }
        $request_fingerprint = self::checkout_request_fingerprint(
            absint($connection['id']),
            absint($mapping['id'] ?? 0),
            $user_id,
            $email,
            $success_url,
            $cancel_url,
            $client_reference
        );
        $existing_artifact = $this->recent_checkout_artifact($request_fingerprint);
        if (is_array($existing_artifact)) {
            return $this->resume_checkout_artifact($existing_artifact);
        }
        $reference = self::opaque_token();
        $sale_uuid = wp_generate_uuid4();
        $now = self::now();
        $request_lock_key = hash(
            'sha256',
            absint($connection['id']) . '|checkout-request|' . $request_fingerprint
        );
        $sale_metadata = [
            'checkoutMode' => (string) $mapping['mode'],
            'clientReference' => $client_reference,
            'checkout_request_fingerprint' => $request_fingerprint,
            'checkout_local_reference' => $reference,
        ];
        if ($email !== '' && $user_id === 0) {
            $encrypted_email = $this->encrypt_secret(['email' => $email]);
            if (is_wp_error($encrypted_email)) return $encrypted_email;
            $sale_metadata['checkout_email_encrypted'] = $encrypted_email;
        }
        $sale = [
            'uuid' => $sale_uuid,
            'connection_id' => absint($connection['id']),
            'mapping_id' => absint($mapping['id']),
            'user_id' => $user_id,
            'plan_id' => absint($mapping['plan_id']),
            'local_reference' => $reference,
            'external_sale_key' => $request_lock_key,
            'status' => 'pending',
            'access_status' => $user_id > 0 ? 'pending' : 'unmatched',
            'amount' => isset($mapping['amount']) ? (int) $mapping['amount'] : null,
            'currency' => self::currency($mapping['currency'] ?? 'BRL'),
            'customer_email_hash' => $email !== ''
                ? hash_hmac('sha256', strtolower($email), wp_salt('nonce'))
                : '',
            'metadata' => self::json($sale_metadata),
            'created_at' => $now,
            'updated_at' => $now,
        ];
        if (!$wpdb->insert(self::table('sales'), $sale)) {
            // Another request with the same purchase fingerprint may have
            // crossed this one. Re-read the ACK journal before returning: the
            // provider must never be called twice for the same active attempt.
            $existing_artifact = $this->recent_checkout_artifact($request_fingerprint);
            if (is_array($existing_artifact)) {
                return $this->resume_checkout_artifact($existing_artifact);
            }
            $in_flight = $wpdb->get_row($wpdb->prepare(
                'SELECT id,uuid,status FROM ' . self::table('sales')
                    . ' WHERE external_sale_key=%s LIMIT 1',
                $request_lock_key
            ), ARRAY_A);
            if (is_array($in_flight)) {
                return new WP_Error(
                    'kodety_checkout_creation_in_progress',
                    'Este checkout já está sendo criado. Tente novamente em instantes.',
                    [
                        'status' => 409,
                        'retryable' => true,
                        'reconciliationPending' => true,
                        'checkoutId' => (string) ($in_flight['uuid'] ?? ''),
                    ]
                );
            }
            return $this->storage_error('Não foi possível preparar o checkout.');
        }
        // Capture this before any provider request or hook can perform another
        // INSERT and overwrite wpdb::insert_id.
        $sale_id = absint($wpdb->insert_id);
        // Close the narrow race in which an earlier request finishes between
        // our first journal read and this INSERT after releasing its request
        // lock key. The local duplicate is tombstoned before any remote call.
        $raced_artifact = $this->recent_checkout_artifact($request_fingerprint);
        if (
            is_array($raced_artifact)
            && absint($raced_artifact['sale_id'] ?? 0) !== $sale_id
        ) {
            $wpdb->update(self::table('sales'), [
                'status' => 'canceled',
                'access_status' => 'none',
                'external_sale_key' => hash(
                    'sha256',
                    absint($connection['id']) . '|deduplicated|' . $sale_uuid
                ),
                'metadata' => self::json(array_merge($sale_metadata, [
                    'errorCode' => 'deduplicated_checkout_request',
                ])),
                'updated_at' => self::now(),
            ], ['id' => $sale_id, 'uuid' => $sale_uuid]);
            return $this->resume_checkout_artifact($raced_artifact);
        }
        $result = match ($provider) {
            'stripe' => $this->create_stripe_checkout(
                $connection,
                $credentials,
                $mapping,
                $reference,
                $email,
                $success_url,
                $cancel_url
            ),
            'mercado_pago' => $this->create_mercado_pago_checkout(
                $connection,
                $credentials,
                $mapping,
                $reference,
                $email,
                $success_url,
                $cancel_url
            ),
            'asaas' => $this->create_asaas_checkout(
                $connection,
                $credentials,
                $mapping,
                $reference,
                $email,
                $success_url,
                $cancel_url
            ),
            'pagbank' => $this->create_pagbank_checkout(
                $connection,
                $credentials,
                $mapping,
                $reference,
                $email,
                $success_url
            ),
            'pagarme' => $this->create_pagarme_checkout(
                $connection,
                $credentials,
                $mapping,
                $reference
            ),
            'woovi' => $this->create_woovi_checkout(
                $connection,
                $credentials,
                $mapping,
                $reference,
                $email
            ),
            'iugu' => $this->create_iugu_checkout(
                $connection,
                $credentials,
                $mapping,
                $reference,
                $email,
                $success_url,
                $cancel_url
            ),
            'hotmart' => $this->create_hotmart_checkout(
                $mapping,
                $reference,
                $email
            ),
            'ticto' => $this->create_ticto_checkout(
                $mapping,
                $reference
            ),
            default => new WP_Error(
                'kodety_checkout_provider',
                'Provedor não suportado.',
                ['status' => 422]
            ),
        };
        if (is_wp_error($result)) {
            $wpdb->update(self::table('sales'), [
                'status' => 'failed',
                'access_status' => 'none',
                'external_sale_key' => hash(
                    'sha256',
                    absint($connection['id']) . '|failed|' . $sale_uuid
                ),
                'metadata' => self::json(array_merge($sale_metadata, [
                    'errorCode' => $result->get_error_code(),
                ])),
                'updated_at' => self::now(),
            ], ['uuid' => $sale_uuid]);
            return $result;
        }
        $url = self::provider_checkout_url($provider, $result['url'] ?? '');
        $external_id = self::external_id($result['id'] ?? '');
        if ($url === '' || $external_id === '') {
            $wpdb->update(self::table('sales'), [
                'status' => 'failed',
                'access_status' => 'none',
                'external_sale_key' => hash(
                    'sha256',
                    absint($connection['id']) . '|invalid|' . $sale_uuid
                ),
                'metadata' => self::json(array_merge($sale_metadata, [
                    'errorCode' => 'kodety_checkout_provider_response',
                ])),
                'updated_at' => self::now(),
            ], ['uuid' => $sale_uuid]);
            return new WP_Error(
                'kodety_checkout_provider_response',
                'O provedor não retornou um checkout hospedado válido.',
                ['status' => 502]
            );
        }
        $artifact_type = self::checkout_artifact_type($provider);
        $artifact_metadata = array_merge($sale_metadata, [
            'checkout_provider_id' => $external_id,
            'checkout_artifact_type' => $artifact_type,
            'checkout_local_reference' => $reference,
            'checkout_request_fingerprint' => $request_fingerprint,
        ]);
        $encrypted_url = $this->encrypt_secret(['url' => $url]);
        if (is_wp_error($encrypted_url)) {
            error_log(sprintf(
                'Onun Kodety checkout ACK journal encryption failed: sale=%s provider=%s artifact=%s',
                $sale_uuid,
                $provider,
                $external_id
            ));
            return $this->hosted_checkout_response(
                $sale_uuid,
                $url,
                $provider,
                $result['expiresAt'] ?? null,
                true,
                'artifact_journal_encryption_failed'
            );
        }
        $artifact = $this->persist_checkout_artifact([
            'sale_id' => $sale_id,
            'sale_uuid' => $sale_uuid,
            'connection_id' => absint($connection['id']),
            'mapping_id' => absint($mapping['id'] ?? 0),
            'provider' => $provider,
            'artifact_type' => $artifact_type,
            'local_reference' => $reference,
            'request_fingerprint' => $request_fingerprint,
            'external_id' => $external_id,
            'external_key' => hash(
                'sha256',
                absint($connection['id']) . '|' . $external_id
            ),
            'checkout_url_encrypted' => $encrypted_url,
            'expires_at' => self::date_to_mysql($result['expiresAt'] ?? null),
            'metadata' => self::json($artifact_metadata),
            'status' => 'pending',
            'last_error' => '',
            'reconciled_at' => null,
            'created_at' => self::now(),
            'updated_at' => self::now(),
        ]);
        if (is_wp_error($artifact)) {
            error_log(sprintf(
                'Onun Kodety checkout ACK journal persistence failed: sale=%s provider=%s artifact=%s',
                $sale_uuid,
                $provider,
                $external_id
            ));
            return $this->hosted_checkout_response(
                $sale_uuid,
                $url,
                $provider,
                $result['expiresAt'] ?? null,
                true,
                'artifact_journal_persistence_failed'
            );
        }
        $repaired = $this->repair_checkout_artifact($artifact);
        if (is_wp_error($repaired)) {
            error_log(sprintf(
                'Onun Kodety checkout ACK local repair pending: sale=%s provider=%s artifact=%s error=%s',
                $sale_uuid,
                $provider,
                $external_id,
                $repaired->get_error_code()
            ));
            return $this->checkout_artifact_response(
                $artifact,
                true,
                $repaired->get_error_code()
            );
        }
        $artifact['status'] = 'reconciled';
        return $this->checkout_artifact_response($artifact, false);
    }

    private static function checkout_request_fingerprint(
        int $connection_id,
        int $mapping_id,
        int $user_id,
        string $email,
        string $success_url,
        string $cancel_url,
        string $client_reference
    ): string {
        return hash_hmac('sha256', self::json([
            'connectionId' => $connection_id,
            'mappingId' => $mapping_id,
            'userId' => $user_id,
            'customerEmailHash' => $email !== ''
                ? hash_hmac('sha256', strtolower($email), wp_salt('nonce'))
                : '',
            'successUrl' => $success_url,
            'cancelUrl' => $cancel_url,
            'clientReference' => $client_reference,
        ]), wp_salt('nonce'));
    }

    private static function checkout_artifact_type(string $provider): string {
        return match (self::provider_key($provider)) {
            'stripe' => 'session',
            'mercado_pago' => 'preference',
            'asaas', 'pagbank' => 'checkout',
            'pagarme' => 'payment_link',
            'woovi' => 'charge',
            'iugu' => 'invoice',
            'hotmart', 'ticto' => 'external_link',
            default => 'checkout',
        };
    }

    /** @return array<string,mixed>|null */
    private function recent_checkout_artifact(string $request_fingerprint): ?array {
        global $wpdb;
        if (!preg_match('/^[a-f0-9]{64}$/', $request_fingerprint)) return null;
        $cutoff = gmdate(
            'Y-m-d H:i:s',
            time() - self::CHECKOUT_ARTIFACT_REUSE_WINDOW
        );
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT a.* FROM ' . self::table('artifacts') . ' a'
                . ' INNER JOIN ' . self::table('sales')
                . ' s ON s.id=a.sale_id AND s.uuid=a.sale_uuid'
                . ' WHERE a.request_fingerprint=%s AND a.created_at>=%s'
                . ' AND (a.expires_at IS NULL OR a.expires_at>%s)'
                . " AND s.status='pending'"
                . ' ORDER BY a.id DESC LIMIT 1',
            $request_fingerprint,
            $cutoff,
            self::now()
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /**
     * Persist the provider ACK before changing the sales projection. This
     * journal is the durable source for retries when the following UPDATE
     * fails after the remote checkout already exists.
     *
     * @param array<string,mixed> $artifact
     * @return array<string,mixed>|WP_Error
     */
    private function persist_checkout_artifact(array $artifact): array|WP_Error {
        global $wpdb;
        $inserted = $wpdb->insert(self::table('artifacts'), $artifact);
        if (is_int($inserted) && $inserted > 0) {
            $artifact['id'] = absint($wpdb->insert_id);
            return $artifact;
        }
        $existing = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table('artifacts')
                . ' WHERE external_key=%s OR local_reference=%s'
                . ' ORDER BY id DESC LIMIT 1',
            (string) ($artifact['external_key'] ?? ''),
            (string) ($artifact['local_reference'] ?? '')
        ), ARRAY_A);
        if (
            is_array($existing)
            && hash_equals(
                (string) ($existing['sale_uuid'] ?? ''),
                (string) ($artifact['sale_uuid'] ?? '')
            )
            && hash_equals(
                (string) ($existing['external_id'] ?? ''),
                (string) ($artifact['external_id'] ?? '')
            )
            && hash_equals(
                (string) ($existing['local_reference'] ?? ''),
                (string) ($artifact['local_reference'] ?? '')
            )
        ) {
            return $existing;
        }
        return new WP_Error(
            'kodety_checkout_artifact_storage',
            'O checkout foi criado no provedor, mas o ACK não pôde ser salvo para reconciliação.',
            [
                'status' => 503,
                'retryable' => true,
                'providerArtifactCreated' => true,
                'reconciliationPending' => true,
                'artifactType' => (string) ($artifact['artifact_type'] ?? ''),
                'externalReference' => (string) ($artifact['external_id'] ?? ''),
                'localReference' => (string) ($artifact['local_reference'] ?? ''),
            ]
        );
    }

    /** @param array<string,mixed> $artifact */
    private function resume_checkout_artifact(array $artifact): array|WP_Error {
        $repaired = $this->repair_checkout_artifact($artifact);
        if (is_wp_error($repaired)) {
            return $this->checkout_artifact_response(
                $artifact,
                true,
                $repaired->get_error_code()
            );
        }
        $artifact['status'] = 'reconciled';
        return $this->checkout_artifact_response($artifact, false);
    }

    /**
     * Idempotently copy an ACK journal row into the sales projection.
     *
     * @param array<string,mixed> $artifact
     */
    private function repair_checkout_artifact(array $artifact): bool|WP_Error {
        global $wpdb;
        $artifact_id = absint($artifact['id'] ?? 0);
        $sale_id = absint($artifact['sale_id'] ?? 0);
        $sale_uuid = self::uuid($artifact['sale_uuid'] ?? '');
        $connection_id = absint($artifact['connection_id'] ?? 0);
        $local_reference = self::external_id($artifact['local_reference'] ?? '');
        $external_id = self::external_id($artifact['external_id'] ?? '');
        $external_key = strtolower((string) ($artifact['external_key'] ?? ''));
        if (
            $artifact_id <= 0
            || $sale_id <= 0
            || $sale_uuid === ''
            || $connection_id <= 0
            || $local_reference === ''
            || $external_id === ''
            || !preg_match('/^[a-f0-9]{64}$/', $external_key)
        ) {
            return new WP_Error(
                'kodety_checkout_artifact_invalid',
                'O ACK persistido do checkout está incompleto.',
                ['status' => 500, 'reconciliationPending' => true]
            );
        }
        $sale = $wpdb->get_row($wpdb->prepare(
            'SELECT id,uuid,connection_id,mapping_id,local_reference,status,'
                . 'external_sale_id,external_sale_key,metadata'
                . ' FROM ' . self::table('sales')
                . ' WHERE id=%d AND uuid=%s LIMIT 1',
            $sale_id,
            $sale_uuid
        ), ARRAY_A);
        if (
            !is_array($sale)
            || absint($sale['connection_id'] ?? 0) !== $connection_id
            || !hash_equals(
                (string) ($sale['local_reference'] ?? ''),
                $local_reference
            )
        ) {
            $this->record_checkout_artifact_error(
                $artifact_id,
                'sale_identity_mismatch'
            );
            return new WP_Error(
                'kodety_checkout_artifact_sale_mismatch',
                'O ACK do checkout não corresponde à venda local preparada.',
                ['status' => 409, 'reconciliationPending' => true]
            );
        }
        $sale_metadata = self::decode_json($sale['metadata'] ?? '', []);
        $artifact_metadata = self::decode_json($artifact['metadata'] ?? '', []);
        $current_external_id = self::external_id(
            $sale['external_sale_id'] ?? ''
        );
        $current_status = self::sale_status(
            $sale['status'] ?? 'pending',
            'pending'
        );
        $artifact_is_primary = $current_status === 'pending'
            && (
                $current_external_id === ''
                || hash_equals($current_external_id, $external_id)
            );
        $artifact_type = sanitize_key((string) (
            $artifact['artifact_type'] ?? ''
        ));
        $metadata = array_merge(
            is_array($artifact_metadata) ? $artifact_metadata : [],
            // A webhook may have projected newer lifecycle metadata between
            // the provider ACK and this local repair; it must win.
            is_array($sale_metadata) ? $sale_metadata : [],
            [
                'checkout_local_reference' => $local_reference,
                'checkout_request_fingerprint' => (string) (
                    $artifact['request_fingerprint'] ?? ''
                ),
                'checkout_creation_artifact' => [
                    'providerId' => $external_id,
                    'artifactType' => $artifact_type,
                    'localReference' => $local_reference,
                ],
            ]
        );
        if ($artifact_is_primary) {
            $metadata['checkout_provider_id'] = $external_id;
            $metadata['checkout_artifact_type'] = $artifact_type;
        } elseif (
            $current_external_id !== ''
            && !hash_equals($current_external_id, $external_id)
        ) {
            // The financial webhook already promoted a payment/order ID.
            // Keep the hosted artifact only in its dedicated audit metadata.
            unset(
                $metadata['checkout_provider_id'],
                $metadata['checkout_artifact_type']
            );
        }
        if ($current_status !== 'pending') {
            unset($metadata['checkout_email_encrypted']);
        }
        $sale_update = [
            'metadata' => self::json($metadata),
            'updated_at' => self::now(),
        ];
        if ($artifact_is_primary) {
            $sale_update['external_sale_id'] = $external_id;
            $sale_update['external_sale_key'] = $external_key;
        }
        $updated = $wpdb->update(self::table('sales'), $sale_update, [
            'id' => $sale_id,
            'uuid' => $sale_uuid,
            'connection_id' => $connection_id,
            'local_reference' => $local_reference,
        ]);
        if ($updated === false) {
            $this->record_checkout_artifact_error(
                $artifact_id,
                'sales_projection_update_failed'
            );
            return new WP_Error(
                'kodety_checkout_artifact_reconciliation',
                'O checkout existe no provedor, mas a projeção local ainda precisa ser reparada.',
                [
                    'status' => 503,
                    'retryable' => true,
                    'providerArtifactCreated' => true,
                    'reconciliationPending' => true,
                    'artifactType' => (string) ($artifact['artifact_type'] ?? ''),
                    'externalReference' => $external_id,
                    'localReference' => $local_reference,
                ]
            );
        }
        $marked = $wpdb->update(self::table('artifacts'), [
            'status' => 'reconciled',
            'last_error' => '',
            'reconciled_at' => self::now(),
            'updated_at' => self::now(),
        ], [
            'id' => $artifact_id,
            'external_key' => $external_key,
        ]);
        if ($marked === false) {
            error_log(sprintf(
                'Onun Kodety checkout ACK repaired but journal status update failed: artifact=%d sale=%s',
                $artifact_id,
                $sale_uuid
            ));
            return new WP_Error(
                'kodety_checkout_artifact_journal_update',
                'A venda foi reparada, mas o diário de reconciliação ainda está pendente.',
                [
                    'status' => 503,
                    'retryable' => true,
                    'reconciliationPending' => true,
                ]
            );
        }
        return true;
    }

    private function record_checkout_artifact_error(int $artifact_id, string $code): void {
        global $wpdb;
        if ($artifact_id <= 0) return;
        $error = substr(sanitize_text_field($code), 0, 500);
        if ($wpdb->update(self::table('artifacts'), [
            'status' => 'pending',
            'last_error' => $error,
            'updated_at' => self::now(),
        ], ['id' => $artifact_id]) === false) {
            error_log(sprintf(
                'Onun Kodety checkout ACK error could not be persisted: artifact=%d error=%s',
                $artifact_id,
                $error
            ));
        }
    }

    /** @return array{checked:int,repaired:int,failed:int,saleIds:list<int>} */
    private function repair_pending_checkout_artifacts(int $limit): array {
        global $wpdb;
        $limit = max(1, min(100, $limit));
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT * FROM ' . self::table('artifacts')
                . " WHERE status='pending' ORDER BY updated_at ASC,id ASC LIMIT %d",
            $limit
        ), ARRAY_A);
        $stats = [
            'checked' => 0,
            'repaired' => 0,
            'failed' => 0,
            'saleIds' => [],
        ];
        foreach ($rows ?: [] as $artifact) {
            if (!is_array($artifact)) continue;
            $stats['checked']++;
            $sale_id = absint($artifact['sale_id'] ?? 0);
            if ($sale_id > 0) $stats['saleIds'][$sale_id] = $sale_id;
            $repaired = $this->repair_checkout_artifact($artifact);
            if (is_wp_error($repaired)) {
                $stats['failed']++;
            } else {
                $stats['repaired']++;
            }
        }
        $stats['saleIds'] = array_values($stats['saleIds']);
        return $stats;
    }

    /**
     * Remove bearer-like hosted URLs once they can no longer be reused while
     * retaining external IDs, hashes, type and references for financial
     * idempotency and audit.
     */
    private function neutralize_closed_checkout_artifact_urls(int $limit): int {
        global $wpdb;
        $limit = max(1, min(100, $limit));
        $cutoff = gmdate(
            'Y-m-d H:i:s',
            time() - self::CHECKOUT_ARTIFACT_REUSE_WINDOW
        );
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT a.id,a.external_key,a.metadata FROM '
                . self::table('artifacts') . ' a'
                . ' INNER JOIN ' . self::table('sales') . ' s ON s.id=a.sale_id'
                . " WHERE a.status='reconciled' AND a.checkout_url_encrypted<>''"
                . ' AND (s.status<>\'pending\' OR a.expires_at<=%s'
                . ' OR (a.expires_at IS NULL AND a.created_at<%s))'
                . ' ORDER BY a.updated_at ASC,a.id ASC LIMIT %d',
            self::now(),
            $cutoff,
            $limit
        ), ARRAY_A);
        $purged = 0;
        foreach ($rows ?: [] as $row) {
            $id = absint($row['id'] ?? 0);
            $external_key = strtolower((string) ($row['external_key'] ?? ''));
            if ($id <= 0 || !preg_match('/^[a-f0-9]{64}$/', $external_key)) continue;
            $metadata = self::decode_json($row['metadata'] ?? '', []);
            if (!is_array($metadata)) $metadata = [];
            unset($metadata['checkout_email_encrypted']);
            $updated = $wpdb->update(self::table('artifacts'), [
                'checkout_url_encrypted' => '',
                'metadata' => self::json($metadata),
                'status' => 'closed',
                'last_error' => '',
                'updated_at' => self::now(),
            ], [
                'id' => $id,
                'external_key' => $external_key,
                'status' => 'reconciled',
            ]);
            if ($updated !== false && $updated > 0) $purged++;
        }
        return $purged;
    }

    /** @param array<string,mixed> $artifact */
    private function checkout_artifact_response(
        array $artifact,
        bool $reconciliation_pending,
        string $reconciliation_error = ''
    ): array|WP_Error {
        $secret = $this->decrypt_secret((string) (
            $artifact['checkout_url_encrypted'] ?? ''
        ));
        if (is_wp_error($secret)) return $secret;
        $provider = self::provider_key($artifact['provider'] ?? '');
        $url = self::provider_checkout_url($provider, $secret['url'] ?? '');
        if ($url === '') {
            return new WP_Error(
                'kodety_checkout_artifact_url',
                'A URL persistida do checkout não é válida.',
                ['status' => 503, 'reconciliationPending' => true]
            );
        }
        return $this->hosted_checkout_response(
            (string) ($artifact['sale_uuid'] ?? ''),
            $url,
            $provider,
            $artifact['expires_at'] ?? null,
            $reconciliation_pending,
            $reconciliation_error
        );
    }

    /** @return array<string,mixed> */
    private function hosted_checkout_response(
        string $sale_uuid,
        string $url,
        string $provider,
        mixed $expires_at,
        bool $reconciliation_pending,
        string $reconciliation_error = ''
    ): array {
        $response = [
            'id' => $sale_uuid,
            'url' => $url,
            'provider' => $provider,
            'status' => 'pending',
            'expiresAt' => self::timestamp_to_iso($expires_at),
            'reconciliationPending' => $reconciliation_pending,
        ];
        if ($reconciliation_error !== '') {
            $response['reconciliationError'] = sanitize_key($reconciliation_error);
        }
        return $response;
    }

    private function create_stripe_checkout(
        array $connection,
        array $credentials,
        array $mapping,
        string $reference,
        string $email,
        string $success_url,
        string $cancel_url
    ): array|WP_Error {
        $mode = (string) $mapping['mode'];
        $body = [
            'mode' => $mode,
            'success_url' => $success_url,
            'cancel_url' => $cancel_url,
            'client_reference_id' => $reference,
            'line_items' => [[
                'price' => (string) $mapping['external_price_id'],
                'quantity' => 1,
            ]],
            'metadata' => [
                'kodety_reference' => $reference,
                'kodety_plan_id' => (string) absint($mapping['plan_id']),
            ],
        ];
        if ($email !== '') $body['customer_email'] = $email;
        if ($mode === 'subscription') {
            $body['subscription_data'] = ['metadata' => [
                'kodety_reference' => $reference,
                'kodety_plan_id' => (string) absint($mapping['plan_id']),
            ]];
        } else {
            $body['payment_intent_data'] = ['metadata' => [
                'kodety_reference' => $reference,
                'kodety_plan_id' => (string) absint($mapping['plan_id']),
            ]];
        }
        $remote = $this->provider_request(
            $connection,
            $credentials,
            'POST',
            '/v1/checkout/sessions',
            $body,
            true,
            $reference
        );
        if (is_wp_error($remote)) return $remote;
        return [
            'id' => $remote['id'] ?? '',
            'url' => $remote['url'] ?? '',
            'expiresAt' => $remote['expires_at'] ?? null,
        ];
    }

    private function create_mercado_pago_checkout(
        array $connection,
        array $credentials,
        array $mapping,
        string $reference,
        string $email,
        string $success_url,
        string $cancel_url
    ): array|WP_Error {
        if (($mapping['mode'] ?? '') !== 'payment') {
            return $this->unsupported_checkout('Mercado Pago recorrente');
        }
        $body = [
            'external_reference' => $reference,
            'items' => [[
                'id' => (string) ($mapping['external_product_id'] ?: $mapping['uuid']),
                'title' => (string) $mapping['plan_name'],
                'quantity' => 1,
                'currency_id' => self::currency($mapping['currency']),
                'unit_price' => ((int) $mapping['amount']) / 100,
            ]],
            'back_urls' => [
                'success' => $success_url,
                'failure' => $cancel_url,
                'pending' => $success_url,
            ],
            'auto_return' => 'approved',
            'notification_url' => $this->webhook_url_for_connection($connection),
            'metadata' => [
                'kodety_reference' => $reference,
                'kodety_plan_id' => absint($mapping['plan_id']),
            ],
        ];
        if ($email !== '') $body['payer'] = ['email' => $email];
        $remote = $this->provider_request(
            $connection,
            $credentials,
            'POST',
            '/checkout/preferences',
            $body,
            false,
            $reference
        );
        if (is_wp_error($remote)) return $remote;
        $settings = self::decode_json($connection['settings'] ?? '', []);
        $sandbox = ($settings['environment'] ?? '') === 'sandbox';
        return [
            'id' => $remote['id'] ?? '',
            'url' => $sandbox
                ? ($remote['sandbox_init_point'] ?? $remote['init_point'] ?? '')
                : ($remote['init_point'] ?? ''),
            'expiresAt' => $remote['expiration_date_to'] ?? null,
        ];
    }

    private function create_asaas_checkout(
        array $connection,
        array $credentials,
        array $mapping,
        string $reference,
        string $email,
        string $success_url,
        string $cancel_url
    ): array|WP_Error {
        $settings = self::decode_json($mapping['settings'] ?? '', []);
        $mode = (string) $mapping['mode'];
        $default_billing_types = $mode === 'subscription'
            ? ['CREDIT_CARD']
            : ['PIX', 'CREDIT_CARD'];
        $body = [
            'billingTypes' => (array) ($settings['billingTypes'] ?? $default_billing_types),
            'chargeTypes' => [$mode === 'subscription' ? 'RECURRENT' : 'DETACHED'],
            'minutesToExpire' => max(10, min(1440, absint($settings['minutesToExpire'] ?? 60))),
            'externalReference' => $reference,
            'callback' => [
                'successUrl' => $success_url,
                'cancelUrl' => $cancel_url,
                'expiredUrl' => $cancel_url,
            ],
            'items' => [[
                'name' => (string) $mapping['plan_name'],
                'description' => 'Plano ' . (string) $mapping['plan_name'],
                'quantity' => 1,
                'value' => ((int) $mapping['amount']) / 100,
            ]],
        ];
        // O Asaas valida customerData como um bloco completo: se enviado,
        // exige name, cpfCnpj, phoneNumber, address, addressNumber,
        // postalCode e province. Como só conhecemos o e-mail, omitimos o
        // objeto e deixamos o próprio checkout coletar os dados do cliente.
        if ($mode === 'subscription') {
            $cycle = strtoupper((string) ($settings['cycle'] ?? 'MONTHLY'));
            if (!in_array($cycle, [
                'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY',
                'QUARTERLY', 'SEMIANNUALLY', 'YEARLY',
            ], true)) {
                return new WP_Error(
                    'kodety_checkout_cycle',
                    'Ciclo recorrente Asaas inválido.',
                    ['status' => 400]
                );
            }
            $body['subscription'] = [
                'cycle' => $cycle,
                'nextDueDate' => gmdate('Y-m-d'),
            ];
        }
        $remote = $this->provider_request(
            $connection,
            $credentials,
            'POST',
            '/v3/checkouts',
            $body,
            false,
            $reference
        );
        if (is_wp_error($remote)) return $remote;
        $checkout_id = self::external_id($remote['id'] ?? '');
        $remote_url = self::provider_checkout_url(
            'asaas',
            $remote['link'] ?? $remote['checkoutUrl'] ?? $remote['url'] ?? ''
        );
        $connection_settings = self::decode_json($connection['settings'] ?? '', []);
        $fallback_url = ($connection_settings['environment'] ?? '') === 'sandbox'
            ? 'https://sandbox.asaas.com/checkoutSession/show/' . rawurlencode($checkout_id)
            : 'https://asaas.com/checkoutSession/show?id=' . rawurlencode($checkout_id);
        return [
            'id' => $checkout_id,
            'url' => $remote_url !== '' ? $remote_url : ($checkout_id !== '' ? $fallback_url : ''),
            'expiresAt' => $remote['expirationDate'] ?? null,
        ];
    }

    private function create_pagbank_checkout(
        array $connection,
        array $credentials,
        array $mapping,
        string $reference,
        string $email,
        string $return_url
    ): array|WP_Error {
        if (($mapping['mode'] ?? '') !== 'payment') {
            return $this->unsupported_checkout('PagBank recorrente');
        }
        $webhook_url = $this->webhook_url_for_connection($connection);
        if (strlen($webhook_url) > 100) {
            return new WP_Error(
                'kodety_checkout_webhook_url_length',
                'A URL REST do site excede o limite de 100 caracteres do PagBank.',
                ['status' => 422]
            );
        }
        $body = [
            'reference_id' => $reference,
            'items' => [[
                'reference_id' => (string) ($mapping['external_product_id'] ?: $mapping['uuid']),
                'name' => (string) $mapping['plan_name'],
                'quantity' => 1,
                'unit_amount' => (int) $mapping['amount'],
            ]],
            'redirect_url' => $return_url,
            'return_url' => $return_url,
            'notification_urls' => [$webhook_url],
            'payment_notification_urls' => [$webhook_url],
        ];
        if ($email !== '') $body['customer'] = ['email' => $email];
        $remote = $this->provider_request(
            $connection,
            $credentials,
            'POST',
            '/checkouts',
            $body,
            false,
            $reference
        );
        if (is_wp_error($remote)) return $remote;
        return [
            'id' => $remote['id'] ?? '',
            'url' => self::link_by_rel($remote['links'] ?? [], 'PAY', 'pagbank'),
            'expiresAt' => $remote['expiration_date'] ?? null,
        ];
    }

    private function create_pagarme_checkout(
        array $connection,
        array $credentials,
        array $mapping,
        string $reference
    ): array|WP_Error {
        $mode = (string) $mapping['mode'];
        $settings = self::decode_json($mapping['settings'] ?? '', []);
        $accepted_methods = array_values(array_intersect(
            array_map(
                'sanitize_key',
                (array) (
                    $settings['paymentMethods']
                    ?? ($mode === 'subscription'
                        ? ['credit_card', 'boleto']
                        : ['credit_card', 'pix', 'boleto'])
                )
            ),
            $mode === 'subscription'
                ? ['credit_card', 'boleto']
                : ['credit_card', 'pix', 'boleto']
        ));
        if (!$accepted_methods) {
            $accepted_methods = $mode === 'subscription'
                ? ['credit_card', 'boleto']
                : ['credit_card', 'pix', 'boleto'];
        }
        $payment_settings = [
            'accepted_payment_methods' => $accepted_methods,
        ];
        if (in_array('credit_card', $accepted_methods, true)) {
            $payment_settings['credit_card_settings'] = [
                'operation_type' => 'auth_and_capture',
            ];
        }
        if (in_array('boleto', $accepted_methods, true)) {
            $payment_settings['boleto_settings'] = [
                'due_in' => max(1, min(30, absint(
                    $settings['boletoDueDays'] ?? 3
                ))),
            ];
        }
        if ($mode !== 'subscription' && in_array('pix', $accepted_methods, true)) {
            $payment_settings['pix_settings'] = [
                'expires_in' => max(300, min(2592000, absint(
                    $settings['pixExpiresIn'] ?? 3600
                ))),
            ];
        }
        $body = [
            'name' => substr('Onun Kodety - ' . (string) $mapping['plan_name'], 0, 64),
            'order_code' => $reference,
            'type' => $mode === 'subscription' ? 'subscription' : 'order',
            'max_paid_sessions' => 1,
            'payment_settings' => $payment_settings,
            'cart_settings' => [],
        ];
        if ($mode === 'subscription') {
            $body['cart_settings']['recurrences'] = [[
                'plan_id' => (string) $mapping['external_product_id'],
                'start_in' => 1,
            ]];
        } else {
            $body['cart_settings']['items'] = [[
                'name' => (string) $mapping['plan_name'],
                'amount' => (int) $mapping['amount'],
                'default_quantity' => 1,
            ]];
        }
        $remote = $this->provider_request(
            $connection,
            $credentials,
            'POST',
            '/core/v5/paymentlinks',
            $body,
            false,
            $reference
        );
        if (is_wp_error($remote)) return $remote;
        return [
            'id' => $remote['id'] ?? '',
            'url' => $remote['url'] ?? '',
            'expiresAt' => $remote['expires_at'] ?? null,
        ];
    }

    private function create_woovi_checkout(
        array $connection,
        array $credentials,
        array $mapping,
        string $reference,
        string $email
    ): array|WP_Error {
        if (($mapping['mode'] ?? '') !== 'payment') {
            return $this->unsupported_checkout('Woovi Pix Automático');
        }
        if ($email === '' || !is_email($email)) {
            return new WP_Error(
                'kodety_checkout_email_required',
                'Informe o e-mail do cliente antes de abrir o Pix.',
                ['status' => 400]
            );
        }
        $settings = self::decode_json($mapping['settings'] ?? '', []);
        $body = [
            'correlationID' => $reference,
            'value' => (int) $mapping['amount'],
            'comment' => substr('Plano ' . (string) $mapping['plan_name'], 0, 140),
            'expiresIn' => max(300, min(2592000, absint($settings['expiresIn'] ?? 3600))),
            'additionalInfo' => [[
                'key' => 'kodety_plan_id',
                'value' => (string) absint($mapping['plan_id']),
            ]],
        ];
        if ($email !== '') {
            $body['customer'] = [
                'name' => 'Cliente',
                'email' => $email,
                'correlationID' => 'customer-' . $reference,
            ];
        }
        $remote = $this->provider_request(
            $connection,
            $credentials,
            'POST',
            '/api/v1/charge',
            $body,
            false,
            $reference,
            ['return_existing' => 'true']
        );
        if (is_wp_error($remote)) return $remote;
        $charge = is_array($remote['charge'] ?? null) ? $remote['charge'] : $remote;
        return [
            'id' => $charge['identifier'] ?? $charge['correlationID'] ?? '',
            'url' => $charge['paymentLinkUrl'] ?? '',
            'expiresAt' => $charge['expiresDate'] ?? null,
        ];
    }

    private function create_iugu_checkout(
        array $connection,
        array $credentials,
        array $mapping,
        string $reference,
        string $email,
        string $success_url,
        string $cancel_url
    ): array|WP_Error {
        if ($email === '') {
            return new WP_Error(
                'kodety_checkout_email_required',
                'A Iugu exige um e-mail para criar esta cobrança hospedada.',
                ['status' => 400]
            );
        }
        if (($mapping['mode'] ?? '') === 'subscription') {
            return $this->unsupported_checkout('Iugu recorrente hospedado');
        }
        $body = [
            'email' => $email,
            'due_date' => gmdate('Y-m-d', time() + DAY_IN_SECONDS),
            'external_reference' => $reference,
            'return_url' => $success_url,
            'expired_url' => $cancel_url,
            'notification_url' => $this->webhook_url_for_connection($connection),
            'items' => [[
                'description' => (string) $mapping['plan_name'],
                'quantity' => 1,
                'price_cents' => (int) $mapping['amount'],
            ]],
            'custom_variables' => [
                ['name' => 'kodety_reference', 'value' => $reference],
                ['name' => 'kodety_plan_id', 'value' => (string) absint($mapping['plan_id'])],
            ],
        ];
        $remote = $this->provider_request(
            $connection,
            $credentials,
            'POST',
            '/v1/invoices',
            $body,
            false,
            $reference
        );
        if (is_wp_error($remote)) return $remote;
        return [
            'id' => $remote['id'] ?? '',
            'url' => $remote['secure_url'] ?? '',
            'expiresAt' => $remote['due_date'] ?? null,
        ];
    }

    /**
     * Hotmart owns the financial checkout and exposes the offer code as the
     * stable hosted-checkout identity. The per-attempt Onun Kodety reference is
     * carried in both official attribution parameters and comes back in the
     * purchase webhook origin object.
     */
    private function create_hotmart_checkout(
        array $mapping,
        string $reference,
        string $email
    ): array|WP_Error {
        $offer = self::external_id($mapping['external_price_id'] ?? '');
        if ($offer === '') {
            return new WP_Error(
                'kodety_checkout_offer_required',
                'Informe o código da oferta Hotmart.',
                ['status' => 400]
            );
        }
        $query = [
            'src' => $reference,
            'sck' => $reference,
        ];
        if ($email !== '' && is_email($email)) $query['email'] = $email;
        $url = add_query_arg(
            $query,
            'https://pay.hotmart.com/' . rawurlencode($offer)
        );
        return [
            'id' => $reference,
            'url' => $url,
            'expiresAt' => gmdate('c', time() + 86400),
        ];
    }

    /**
     * Ticto v2 returns the checkout query parameters under url_params. A
     * dedicated parameter avoids relying on buyer e-mail as an identity.
     */
    private function create_ticto_checkout(
        array $mapping,
        string $reference
    ): array|WP_Error {
        $offer = self::external_id($mapping['external_price_id'] ?? '');
        if ($offer === '') {
            return new WP_Error(
                'kodety_checkout_offer_required',
                'Informe o código da oferta Ticto.',
                ['status' => 400]
            );
        }
        return [
            'id' => $reference,
            'url' => add_query_arg(
                ['kdt_ref' => $reference],
                'https://payment.ticto.app/' . rawurlencode($offer)
            ),
            'expiresAt' => gmdate('c', time() + 86400),
        ];
    }

    /** @return array<string,mixed>|null */
    private function mapping_for_checkout(
        string $connection_uuid,
        int $plan_id,
        string $mode
    ): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT m.*,c.uuid AS connection_uuid,c.provider,c.name AS connection_name,
                    c.enabled AS connection_enabled,c.status AS connection_status,
                    c.settings AS connection_settings,
                    p.name AS plan_name,p.slug AS plan_slug,p.status AS plan_status
             FROM ' . self::table('mappings') . ' m
             INNER JOIN ' . self::table('connections') . ' c ON c.id=m.connection_id
             INNER JOIN ' . $wpdb->prefix . 'kodety_membership_plans p ON p.id=m.plan_id
             WHERE c.uuid=%s AND m.plan_id=%d AND m.mode=%s AND m.status=\'active\'',
            self::uuid($connection_uuid),
            $plan_id,
            $mode
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public function test_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $connection = $this->connection_by_uuid((string) $request['id']);
        if (!$connection) return $this->not_found('connection');
        $credentials = $this->decrypt_secret((string) $connection['credentials']);
        if (is_wp_error($credentials)) return $credentials;
        $required = $this->validate_required_credentials(
            (string) $connection['provider'],
            $credentials,
            true
        );
        if (is_wp_error($required)) return $required;
        if ((string) $connection['provider'] === 'ticto') {
            $token = trim((string) ($credentials['webhookToken'] ?? ''));
            if (strlen($token) < 16 || strlen($token) > 255) {
                return new WP_Error(
                    'kodety_checkout_credentials',
                    'O token de webhook Ticto é inválido.',
                    ['status' => 400, 'field' => 'webhookToken']
                );
            }
            $now = self::now();
            $status = !empty($connection['enabled']) ? 'connected' : 'disabled';
            $wpdb->update(self::table('connections'), [
                'status' => $status,
                'last_verified_at' => $now,
                'last_error' => '',
                'updated_at' => $now,
            ], ['id' => absint($connection['id'])]);
            return $this->response([
                'ok' => true,
                'status' => $status,
                'verifiedAt' => self::mysql_to_iso($now),
                'verification' => 'webhook_token',
            ]);
        }
        $path = match ((string) $connection['provider']) {
            'stripe' => '/v1/account',
            'mercado_pago' => '/users/me',
            'asaas' => '/v3/myAccount/status/',
            'pagarme' => '/core/v5/orders?page=1&size=1',
            'woovi' => '/api/v1/company',
            'iugu' => '/v1/invoices?start=0&limit=1',
            'hotmart' => '/products/api/v1/products?max_results=1',
            default => '',
        };
        if ($path === '') {
            return new WP_Error(
                'kodety_checkout_test_unavailable',
                'Este provedor não publica um endpoint seguro e sem efeitos para testar a conexão. '
                    . 'A primeira sincronização ou checkout validará as credenciais.',
                ['status' => 501]
            );
        }
        $result = $this->provider_request(
            $connection,
            $credentials,
            'GET',
            $path
        );
        if (is_wp_error($result)) return $result;
        $now = self::now();
        $status = !empty($connection['enabled']) ? 'connected' : 'disabled';
        $wpdb->update(self::table('connections'), [
            'status' => $status,
            'last_verified_at' => $now,
            'last_error' => '',
            'updated_at' => $now,
        ], ['id' => absint($connection['id'])]);
        return $this->response([
            'ok' => true,
            'status' => $status,
            'verifiedAt' => self::mysql_to_iso($now),
        ]);
    }

    public function sync_now(WP_REST_Request $request): WP_REST_Response {
        $limit = max(1, min(100, absint($request->get_param('limit') ?: 25)));
        return $this->response($this->run_reconciliation($limit));
    }

    /** @return array<string,int> */
    public function run_reconciliation(int $limit = 25): array {
        global $wpdb;
        $limit = max(1, min(100, $limit));
        $artifact_repairs = $this->repair_pending_checkout_artifacts($limit);
        $artifact_urls_purged = $this->neutralize_closed_checkout_artifact_urls(
            $limit
        );
        $artifact_sale_ids = array_values(array_filter(
            array_map('absint', (array) ($artifact_repairs['saleIds'] ?? []))
        ));
        $artifact_sale_exclusion = $artifact_sale_ids
            ? ' AND s.id NOT IN (' . implode(',', $artifact_sale_ids) . ')'
            : '';
        $recovered = Kodety_Members::instance()->recover_stale_provider_events(600, 100);
        $stats = [
            'checked' => 0,
            'projected' => 0,
            'ignored' => 0,
            'failed' => (int) $artifact_repairs['failed'],
            'artifactRepairsChecked' => (int) $artifact_repairs['checked'],
            'artifactRepairsCompleted' => (int) $artifact_repairs['repaired'],
            'artifactRepairFailed' => (int) $artifact_repairs['failed'],
            'artifactUrlsPurged' => $artifact_urls_purged,
            'staleEventsRecovered' => is_wp_error($recovered) ? 0 : (int) $recovered,
            'piiPurged' => 0,
        ];
        $cutoff = gmdate('Y-m-d H:i:s', time() - 180 * DAY_IN_SECONDS);
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT s.*,m.mode AS mapping_mode,
                    c.id AS checkout_connection_id,c.uuid AS connection_uuid,
                    c.provider,c.credentials AS connection_credentials,
                    c.settings AS connection_settings,c.enabled AS connection_enabled,
                    c.status AS connection_status
             FROM ' . self::table('sales') . ' s
             INNER JOIN ' . self::table('connections') . ' c ON c.id=s.connection_id
             LEFT JOIN ' . self::table('mappings') . ' m ON m.id=s.mapping_id
             WHERE c.status<>\'deleted\'
               AND (
                    s.status IN (\'pending\',\'failed\',\'unlinked\')
                    OR (s.status=\'paid\' AND s.updated_at>=%s)
                    OR s.external_contract_id<>\'\'
               )' . $artifact_sale_exclusion . '
             ORDER BY CASE WHEN s.last_reconciled_at IS NULL THEN 0 ELSE 1 END,
                      s.last_reconciled_at ASC,s.id ASC
             LIMIT %d',
            $cutoff,
            $limit
        ), ARRAY_A);
        $touched_connections = [];
        foreach ($rows ?: [] as $sale) {
            $stats['checked']++;
            $connection = [
                'id' => absint($sale['checkout_connection_id'] ?? 0),
                'uuid' => (string) ($sale['connection_uuid'] ?? ''),
                'provider' => (string) ($sale['provider'] ?? ''),
                'credentials' => (string) ($sale['connection_credentials'] ?? ''),
                'settings' => (string) ($sale['connection_settings'] ?? ''),
                'enabled' => absint($sale['connection_enabled'] ?? 0),
                'status' => (string) ($sale['connection_status'] ?? ''),
            ];
            $touched_connections[absint($connection['id'])] = absint($connection['id']);
            $credentials = $this->decrypt_secret((string) $connection['credentials']);
            if (is_wp_error($credentials)) {
                $stats['failed']++;
                continue;
            }
            $event = $this->reconciliation_event_for_sale(
                $connection,
                $credentials,
                $sale
            );
            $wpdb->update(self::table('sales'), [
                'last_reconciled_at' => self::now(),
            ], ['id' => absint($sale['id'])]);
            if (is_wp_error($event)) {
                $stats['failed']++;
                continue;
            }
            if (!is_array($event)) {
                $stats['ignored']++;
                continue;
            }
            $projected = $this->project_reconciled_event($connection, $sale, $event);
            if (is_wp_error($projected)) {
                $stats['failed']++;
            } elseif (!empty($projected['ignored'])) {
                $stats['ignored']++;
            } else {
                $stats['projected']++;
            }
        }
        // Webhooks remain the primary lifecycle path, but the fallback cursor
        // must make useful progress on larger sites without flooding provider
        // APIs from a single WP-Cron request.
        $subscription_limit = max(10, min(50, $limit));
        $cursor = max(0, (int) get_option('kodety_checkouts_subscription_cursor', 0));
        $subscriptions = $wpdb->get_results($wpdb->prepare(
            'SELECT s.*,c.id AS checkout_connection_id,c.uuid AS connection_uuid,
                    c.provider AS checkout_provider,
                    c.credentials AS connection_credentials,
                    c.settings AS connection_settings,c.enabled AS connection_enabled,
                    c.status AS connection_status
             FROM ' . $wpdb->prefix . 'kodety_membership_subscriptions s
             INNER JOIN ' . self::table('connections')
                . ' c ON c.provider=s.provider AND c.uuid=s.provider_tenant
             WHERE s.id>%d AND c.status<>\'deleted\'
               AND s.status IN (\'pending\',\'trialing\',\'active\',\'past_due\',\'paused\')
             ORDER BY s.id ASC LIMIT %d',
            $cursor,
            $subscription_limit
        ), ARRAY_A);
        if (!$subscriptions && $cursor > 0) {
            update_option('kodety_checkouts_subscription_cursor', 0, false);
        }
        foreach ($subscriptions ?: [] as $subscription) {
            $stats['checked']++;
            $cursor = absint($subscription['id'] ?? $cursor);
            $connection = [
                'id' => absint($subscription['checkout_connection_id'] ?? 0),
                'uuid' => (string) ($subscription['connection_uuid'] ?? ''),
                'provider' => (string) ($subscription['checkout_provider'] ?? ''),
                'credentials' => (string) ($subscription['connection_credentials'] ?? ''),
                'settings' => (string) ($subscription['connection_settings'] ?? ''),
                'enabled' => absint($subscription['connection_enabled'] ?? 0),
                'status' => (string) ($subscription['connection_status'] ?? ''),
            ];
            $touched_connections[absint($connection['id'])] = absint($connection['id']);
            $credentials = $this->decrypt_secret((string) $connection['credentials']);
            if (is_wp_error($credentials)) {
                $stats['failed']++;
                continue;
            }
            $event = $this->reconciliation_event_for_subscription(
                $connection,
                $credentials,
                $subscription
            );
            if (is_wp_error($event)) {
                $stats['failed']++;
                continue;
            }
            if (!is_array($event)) {
                $stats['ignored']++;
                continue;
            }
            $sale_stub = [
                'uuid' => 'subscription-' . absint($subscription['id'] ?? 0),
            ];
            $projected = $this->project_reconciled_event(
                $connection,
                $sale_stub,
                $event
            );
            if (is_wp_error($projected)) {
                $stats['failed']++;
            } elseif (!empty($projected['ignored'])) {
                $stats['ignored']++;
            } else {
                $stats['projected']++;
            }
        }
        if ($subscriptions) {
            update_option('kodety_checkouts_subscription_cursor', $cursor, false);
        }
        if ($touched_connections) {
            $now = self::now();
            foreach ($touched_connections as $connection_id) {
                if ($connection_id <= 0) continue;
                $wpdb->update(self::table('connections'), [
                    'last_synced_at' => $now,
                ], ['id' => $connection_id]);
            }
        }
        $abandoned_cutoff = gmdate('Y-m-d H:i:s', time() - 35 * DAY_IN_SECONDS);
        $abandoned = $wpdb->get_results($wpdb->prepare(
            'SELECT id,metadata FROM ' . self::table('sales')
                . " WHERE user_id=0 AND status IN ('pending','failed','expired','canceled')"
                . ' AND created_at<%s AND metadata LIKE %s LIMIT 100',
            $abandoned_cutoff,
            '%checkout_email_encrypted%'
        ), ARRAY_A);
        foreach ($abandoned ?: [] as $row) {
            $metadata = self::decode_json($row['metadata'] ?? '', []);
            if (!array_key_exists('checkout_email_encrypted', $metadata)) continue;
            unset($metadata['checkout_email_encrypted']);
            if ($wpdb->update(self::table('sales'), [
                'metadata' => self::json($metadata),
                'updated_at' => self::now(),
            ], ['id' => absint($row['id'])]) !== false) {
                $stats['piiPurged']++;
            }
        }
        return $stats;
    }

    /** @return array<string,mixed>|WP_Error|null */
    private function reconciliation_event_for_subscription(
        array $connection,
        array $credentials,
        array $subscription
    ): array|WP_Error|null {
        $provider = self::provider_key($connection['provider'] ?? '');
        $contract_id = self::external_id($subscription['external_contract_id'] ?? '');
        if ($contract_id === '') return null;
        $notification = [];
        if ($provider === 'stripe') {
            $remote = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v1/subscriptions/' . rawurlencode($contract_id),
                [],
                false,
                '',
                ['expand[]' => 'latest_invoice']
            );
            if (is_wp_error($remote)) return $remote;
            $remote_status = self::subscription_status($remote['status'] ?? '');
            if (in_array($remote_status, self::ACTIVE_SUBSCRIPTION_STATUSES, true)) {
                $paid_invoice = $this->stripe_paid_invoice_reconciliation_event(
                    $connection,
                    $credentials,
                    $remote
                );
                if (is_wp_error($paid_invoice) || is_array($paid_invoice)) {
                    return $paid_invoice;
                }
            }
            $notification = [
                'id' => 'reconcile_' . $contract_id,
                'type' => 'customer.subscription.updated',
                'created' => $remote['created'] ?? time(),
                'data' => ['object' => $remote],
            ];
            return $this->normalize_provider_event(
                $provider,
                $notification,
                $notification,
                hash('sha256', self::json($remote))
            );
        }
        if ($provider === 'asaas') {
            $remote = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v3/subscriptions/' . rawurlencode($contract_id)
            );
            if (is_wp_error($remote)) return $remote;
            if (strtoupper((string) ($remote['status'] ?? '')) === 'ACTIVE') {
                $payments = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v3/payments',
                    [],
                    false,
                    '',
                    [
                        'subscription' => $contract_id,
                        'limit' => '20',
                    ]
                );
                if (is_wp_error($payments)) return $payments;
                $payment_rows = array_values(array_filter(
                    (array) ($payments['data'] ?? []),
                    'is_array'
                ));
                usort($payment_rows, static function (array $left, array $right): int {
                    $left_time = strtotime((string) (
                        $left['dueDate']
                        ?? $left['dateCreated']
                        ?? ''
                    )) ?: 0;
                    $right_time = strtotime((string) (
                        $right['dueDate']
                        ?? $right['dateCreated']
                        ?? ''
                    )) ?: 0;
                    return $right_time <=> $left_time;
                });
                $payment = $payment_rows[0] ?? null;
                if (is_array($payment)) {
                    $payment_status = strtoupper((string) ($payment['status'] ?? ''));
                    $payment_id = self::external_id($payment['id'] ?? '');
                    if ($payment_id !== '') {
                        $event_type = match ($payment_status) {
                            'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH' => 'PAYMENT_RECEIVED',
                            'REFUNDED' => 'PAYMENT_REFUNDED',
                            'CHARGEBACK_REQUESTED',
                            'CHARGEBACK_DISPUTE' => 'PAYMENT_CHARGEBACK_REQUESTED',
                            'OVERDUE' => 'PAYMENT_OVERDUE',
                            'DELETED' => 'PAYMENT_DELETED',
                            default => 'PAYMENT_UPDATED',
                        };
                    $payment_notification = [
                            'event' => $event_type,
                        'payment' => ['id' => $payment_id],
                        'dateCreated' => $payment['confirmedDate']
                            ?? $payment['paymentDate']
                            ?? $payment['dateCreated']
                            ?? null,
                    ];
                    return $this->normalize_provider_event(
                        $provider,
                        $payment_notification,
                        $payment,
                        hash('sha256', self::json([$payment_notification, $payment]))
                    );
                    }
                }
            }
            $notification = [
                'event' => 'SUBSCRIPTION_UPDATED',
                'subscription' => ['id' => $contract_id],
                'dateCreated' => $remote['dateCreated'] ?? null,
            ];
        } elseif ($provider === 'pagarme') {
            $remote = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/core/v5/subscriptions/' . rawurlencode($contract_id)
            );
            if (is_wp_error($remote)) return $remote;
            if (strtolower((string) ($remote['status'] ?? '')) === 'active') {
                $invoices = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/core/v5/invoices',
                    [],
                    false,
                    '',
                    [
                        'subscription_id' => $contract_id,
                        'page' => '1',
                        'size' => '20',
                    ]
                );
                if (is_wp_error($invoices)) return $invoices;
                $invoice_rows = array_values(array_filter(
                    (array) ($invoices['data'] ?? []),
                    'is_array'
                ));
                usort($invoice_rows, static function (array $left, array $right): int {
                    $left_time = strtotime((string) (
                        $left['billing_at']
                        ?? $left['due_at']
                        ?? $left['created_at']
                        ?? ''
                    )) ?: 0;
                    $right_time = strtotime((string) (
                        $right['billing_at']
                        ?? $right['due_at']
                        ?? $right['created_at']
                        ?? ''
                    )) ?: 0;
                    return $right_time <=> $left_time;
                });
                $invoice = $invoice_rows[0] ?? null;
                if (is_array($invoice)) {
                    $invoice['subscription_id'] = self::external_id(
                        $invoice['subscription_id'] ?? $contract_id
                    );
                    $invoice['_kodety_authoritative_invoice'] = true;
                    $invoice_notification = [
                        'type' => 'invoice.' . strtolower((string) (
                            $invoice['status'] ?? 'updated'
                        )),
                        'data' => ['id' => self::external_id($invoice['id'] ?? '')],
                        'created_at' => $invoice['updated_at']
                            ?? $invoice['created_at']
                            ?? null,
                    ];
                    return $this->normalize_provider_event(
                        $provider,
                        $invoice_notification,
                        $invoice,
                        hash('sha256', self::json([
                            $invoice_notification,
                            $invoice,
                        ]))
                    );
                }
            }
            $notification = [
                'type' => 'subscription.updated',
                'data' => ['id' => $contract_id],
                'created_at' => $remote['updated_at'] ?? null,
            ];
        } elseif ($provider === 'iugu') {
            $remote = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v1/subscriptions/' . rawurlencode($contract_id)
            );
            if (is_wp_error($remote)) return $remote;
            $notification = [
                'event' => 'subscription.status_changed',
                'data' => ['id' => $contract_id],
                'created_at' => $remote['updated_at'] ?? null,
            ];
        } else {
            return null;
        }
        return $this->normalize_provider_event(
            $provider,
            $notification,
            $remote,
            hash('sha256', self::json([$notification, $remote]))
        );
    }

    /**
     * Convert the authoritative Stripe invoice into the same event used by
     * the webhook path. Positive paid invoices restore access; explicit
     * collection/finalization failures revoke it. Zero-value trial invoices
     * are deliberately ignored.
     *
     * @return array<string,mixed>|WP_Error|null
     */
    private function stripe_paid_invoice_reconciliation_event(
        array $connection,
        array $credentials,
        array $subscription,
        string $fallback_reference = ''
    ): array|WP_Error|null {
        $invoice_value = $subscription['latest_invoice'] ?? '';
        $invoice_id = self::external_id(
            is_array($invoice_value) ? ($invoice_value['id'] ?? '') : $invoice_value
        );
        if ($invoice_id === '') return null;
        $invoice = $this->provider_request(
            $connection,
            $credentials,
            'GET',
            '/v1/invoices/' . rawurlencode($invoice_id),
            [],
            false,
            '',
            ['expand[]' => 'payments.data.payment.payment_intent']
        );
        if (is_wp_error($invoice)) return $invoice;
        $paid = !empty($invoice['paid'])
            || strtolower((string) ($invoice['status'] ?? '')) === 'paid';
        $invoice_status = strtolower((string) ($invoice['status'] ?? ''));
        $event_type = $paid && (int) ($invoice['amount_paid'] ?? 0) > 0
            ? 'invoice.paid'
            : match (true) {
                !empty($invoice['last_finalization_error']) => 'invoice.finalization_failed',
                $invoice_status === 'uncollectible' => 'invoice.marked_uncollectible',
                $invoice_status === 'void' => 'invoice.voided',
                default => '',
            };
        if ($event_type === '') return null;
        $subscription_id = self::external_id($subscription['id'] ?? '');
        if ($subscription_id !== '') {
            $invoice['parent']['subscription_details']['subscription'] = $subscription_id;
        }
        if (
            $fallback_reference !== ''
            && self::external_id(
                $invoice['metadata']['kodety_reference']
                ?? $invoice['parent']['subscription_details']['metadata']['kodety_reference']
                ?? ''
            ) === ''
        ) {
            $invoice['parent']['subscription_details']['metadata']['kodety_reference'] =
                $fallback_reference;
        }
        $notification = [
            'id' => 'reconcile_invoice_' . $invoice_id,
            'type' => $event_type,
            'created' => $invoice['status_transitions']['paid_at']
                ?? $invoice['created']
                ?? time(),
            'data' => ['object' => $invoice],
        ];
        return $this->normalize_provider_event(
            'stripe',
            $notification,
            $notification,
            hash('sha256', self::json($invoice))
        );
    }

    /**
     * Re-fetch a financial object from the provider. This path never trusts
     * locally cached webhook data and therefore can safely repair a missed
     * notification without storing raw provider payloads.
     *
     * @return array<string,mixed>|WP_Error|null
     */
    private function reconciliation_event_for_sale(
        array $connection,
        array $credentials,
        array $sale
    ): array|WP_Error|null {
        $provider = self::provider_key($connection['provider'] ?? '');
        $external_id = self::external_id($sale['external_sale_id'] ?? '');
        $reference = self::external_id($sale['local_reference'] ?? '');
        $sale_metadata = self::decode_json($sale['metadata'] ?? '', []);
        $artifact_type = sanitize_key((string) (
            $sale_metadata['checkout_artifact_type'] ?? ''
        ));
        $remote = null;
        $notification = [];
        $authoritative = [];
        if ($provider === 'stripe') {
            if (str_starts_with($external_id, 'cs_')) {
                $remote = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v1/checkout/sessions/' . rawurlencode($external_id),
                    [],
                    false,
                    '',
                    ['expand[]' => 'subscription']
                );
                if (is_wp_error($remote)) return $remote;
                if (
                    ($remote['mode'] ?? '') === 'subscription'
                    && ($remote['status'] ?? '') !== 'expired'
                ) {
                    $subscription_value = $remote['subscription'] ?? '';
                    $subscription_id = self::external_id(
                        is_array($subscription_value)
                            ? ($subscription_value['id'] ?? '')
                            : $subscription_value
                    );
                    $subscription_object = is_array($subscription_value)
                        ? $subscription_value
                        : [];
                    if (
                        $subscription_id !== ''
                        && empty($subscription_object['latest_invoice'])
                    ) {
                        $subscription_object = $this->provider_request(
                            $connection,
                            $credentials,
                            'GET',
                            '/v1/subscriptions/' . rawurlencode($subscription_id),
                            [],
                            false,
                            '',
                            ['expand[]' => 'latest_invoice']
                        );
                        if (is_wp_error($subscription_object)) {
                            return $subscription_object;
                        }
                    }
                    if ($subscription_object) {
                        $paid_invoice = $this->stripe_paid_invoice_reconciliation_event(
                            $connection,
                            $credentials,
                            $subscription_object,
                            $reference
                        );
                        if (is_wp_error($paid_invoice) || is_array($paid_invoice)) {
                            return $paid_invoice;
                        }
                    }
                }
                $type = ($remote['status'] ?? '') === 'expired'
                    ? 'checkout.session.expired'
                    : 'checkout.session.completed';
                $notification = [
                    'id' => 'reconcile_' . $external_id,
                    'type' => $type,
                    'created' => $remote['created'] ?? time(),
                    'data' => ['object' => $remote],
                ];
                $authoritative = $notification;
            } elseif (str_starts_with($external_id, 'pi_')) {
                $intent = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v1/payment_intents/' . rawurlencode($external_id)
                );
                if (is_wp_error($intent)) return $intent;
                $charge_id = self::external_id(
                    is_array($intent['latest_charge'] ?? null)
                        ? ($intent['latest_charge']['id'] ?? '')
                        : ($intent['latest_charge'] ?? '')
                );
                $charge = [];
                if ($charge_id !== '') {
                    $charge = $this->provider_request(
                        $connection,
                        $credentials,
                        'GET',
                        '/v1/charges/' . rawurlencode($charge_id)
                    );
                    if (is_wp_error($charge)) return $charge;
                }
                if ($charge && (int) ($charge['amount_refunded'] ?? 0) > 0) {
                    $charge['metadata']['kodety_reference'] = $reference;
                    $charge['_kodety_subscription'] = (string) (
                        $sale['external_contract_id'] ?? ''
                    );
                    $notification = [
                        'id' => 'reconcile_' . $charge_id,
                        'type' => 'charge.refunded',
                        'created' => $charge['created'] ?? time(),
                        'data' => ['object' => $charge],
                    ];
                } elseif ($charge && !empty($charge['disputed'])) {
                    $charge['metadata']['kodety_reference'] = $reference;
                    $charge['_kodety_subscription'] = (string) (
                        $sale['external_contract_id'] ?? ''
                    );
                    $notification = [
                        'id' => 'reconcile_' . $charge_id,
                        'type' => 'charge.dispute.created',
                        'created' => $charge['created'] ?? time(),
                        'data' => ['object' => $charge],
                    ];
                } else {
                    $session_like = [
                        'id' => $external_id,
                        'client_reference_id' => $reference,
                        'payment_intent' => $external_id,
                        'payment_status' => ($intent['status'] ?? '') === 'succeeded'
                            ? 'paid'
                            : 'unpaid',
                        'mode' => (string) ($sale['mapping_mode'] ?? 'payment'),
                        'amount_total' => $intent['amount_received']
                            ?? $intent['amount']
                            ?? null,
                        'currency' => $intent['currency'] ?? 'BRL',
                        'customer' => $intent['customer'] ?? '',
                        'subscription' => $sale['external_contract_id'] ?? '',
                        'metadata' => ['kodety_reference' => $reference],
                    ];
                    $notification = [
                        'id' => 'reconcile_' . $external_id,
                        'type' => 'checkout.session.completed',
                        'created' => $intent['created'] ?? time(),
                        'data' => ['object' => $session_like],
                    ];
                }
                $authoritative = $notification;
            } else {
                return null;
            }
        } elseif ($provider === 'mercado_pago' && $artifact_type === 'preference') {
            $search = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v1/payments/search',
                [],
                false,
                '',
                [
                    'external_reference' => $reference,
                    'sort' => 'date_created',
                    'criteria' => 'desc',
                    'limit' => '1',
                ]
            );
            if (is_wp_error($search)) return $search;
            $authoritative = is_array($search['results'][0] ?? null)
                ? $search['results'][0]
                : [];
            if (!$authoritative) return null;
            $payment_id = self::external_id($authoritative['id'] ?? '');
            $notification = ['type' => 'payment', 'data' => ['id' => $payment_id]];
        } elseif ($provider === 'mercado_pago' && $external_id !== '') {
            $authoritative = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v1/payments/' . rawurlencode($external_id)
            );
            if (is_wp_error($authoritative)) return $authoritative;
            $notification = ['type' => 'payment', 'data' => ['id' => $external_id]];
        } elseif ($provider === 'asaas' && $external_id !== '') {
            if ($artifact_type === 'checkout') {
                $search = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v3/payments',
                    [],
                    false,
                    '',
                    [
                        'externalReference' => $reference,
                        'checkoutSession' => $external_id,
                        'limit' => '1',
                    ]
                );
                if (is_wp_error($search)) return $search;
                $authoritative = is_array($search['data'][0] ?? null)
                    ? $search['data'][0]
                    : [];
                if (!$authoritative) return null;
            } else {
                $authoritative = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v3/payments/' . rawurlencode($external_id)
                );
            }
            if (is_wp_error($authoritative)) return $authoritative;
            $remote_status = strtoupper((string) ($authoritative['status'] ?? ''));
            $event_type = match ($remote_status) {
                'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH' => 'PAYMENT_RECEIVED',
                'REFUNDED' => 'PAYMENT_REFUNDED',
                'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE' => 'PAYMENT_CHARGEBACK_REQUESTED',
                'OVERDUE' => 'PAYMENT_OVERDUE',
                'DELETED' => 'PAYMENT_DELETED',
                default => 'PAYMENT_UPDATED',
            };
            $notification = [
                'event' => $event_type,
                'payment' => ['id' => $external_id],
                'dateCreated' => $authoritative['dateCreated'] ?? null,
            ];
            $notification['payment']['id'] = self::external_id(
                $authoritative['id'] ?? $external_id
            );
        } elseif ($provider === 'pagbank' && $external_id !== '') {
            $is_checkout_id = str_starts_with(strtoupper($external_id), 'CHEC_')
                || ($artifact_type === 'checkout'
                    && !str_starts_with(strtoupper($external_id), 'CHAR_'));
            $authoritative = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                ($is_checkout_id ? '/checkouts/' : '/charges/')
                    . rawurlencode($external_id)
            );
            if (is_wp_error($authoritative)) return $authoritative;
            $notification = $authoritative;
        } elseif ($provider === 'pagarme') {
            if ($artifact_type === 'payment_link') {
                if ($reference === '') return null;
                $search = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/core/v5/orders',
                    [],
                    false,
                    '',
                    [
                        'code' => $reference,
                        'page' => '1',
                        'size' => '20',
                    ]
                );
                if (is_wp_error($search)) return $search;
                $orders = array_values(array_filter(
                    (array) ($search['data'] ?? []),
                    'is_array'
                ));
                usort($orders, static function (array $left, array $right): int {
                    $priority = self::pagarme_order_reconciliation_priority($right)
                        <=> self::pagarme_order_reconciliation_priority($left);
                    if ($priority !== 0) return $priority;
                    $left_time = strtotime((string) (
                        $left['updated_at'] ?? $left['created_at'] ?? ''
                    )) ?: 0;
                    $right_time = strtotime((string) (
                        $right['updated_at'] ?? $right['created_at'] ?? ''
                    )) ?: 0;
                    return $right_time <=> $left_time;
                });
                $authoritative = $orders[0] ?? [];
                if (!$authoritative) return null;
            } elseif ($external_id !== '') {
                $authoritative = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/core/v5/orders/' . rawurlencode($external_id)
                );
                if (is_wp_error($authoritative)) return $authoritative;
            } else {
                return null;
            }
            $charge = $this->pagarme_reconciliation_charge(
                $connection,
                $credentials,
                $authoritative
            );
            if (is_wp_error($charge)) return $charge;
            if (is_array($charge)) {
                $authoritative = $charge;
                $notification = [
                    'type' => 'charge.' . strtolower((string) (
                        $charge['status'] ?? 'updated'
                    )),
                    'data' => ['id' => self::external_id($charge['id'] ?? '')],
                    'created_at' => $charge['updated_at'] ?? null,
                ];
            } else {
                $order_id = self::external_id($authoritative['id'] ?? $external_id);
                $notification = [
                    'type' => 'order.' . strtolower((string) (
                        $authoritative['status'] ?? 'updated'
                    )),
                    'data' => ['id' => $order_id],
                    'created_at' => $authoritative['updated_at'] ?? null,
                ];
            }
        } elseif ($provider === 'woovi' && $reference !== '') {
            $authoritative = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/api/v1/charge/' . rawurlencode($reference)
            );
            if (is_wp_error($authoritative)) return $authoritative;
            $charge = is_array($authoritative['charge'] ?? null)
                ? $authoritative['charge']
                : $authoritative;
            $notification = [
                'event' => 'woovi:CHARGE_' . strtoupper((string) (
                    $charge['status'] ?? 'UPDATED'
                )),
                'charge' => $charge,
            ];
        } elseif ($provider === 'iugu' && $external_id !== '') {
            $authoritative = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v1/invoices/' . rawurlencode($external_id)
            );
            if (is_wp_error($authoritative)) return $authoritative;
            $notification = [
                'event' => 'invoice.status_changed',
                'data' => ['id' => $external_id],
                'created_at' => $authoritative['updated_at'] ?? null,
            ];
        } else {
            return null;
        }
        $payload_hash = hash('sha256', self::json([$notification, $authoritative]));
        return $this->normalize_provider_event(
            $provider,
            $notification,
            $authoritative,
            $payload_hash
        );
    }

    /**
     * Prefer the financially strongest charge contained by an order. A paid
     * order can remain marked paid after a refund or chargeback, so order
     * status alone is not an authoritative lifecycle projection.
     *
     * @return array<string,mixed>|WP_Error|null
     */
    private function pagarme_reconciliation_charge(
        array $connection,
        array $credentials,
        array $order
    ): array|WP_Error|null {
        $best = null;
        $best_priority = -1;
        foreach (array_slice((array) ($order['charges'] ?? []), 0, 20) as $candidate) {
            if (!is_array($candidate)) continue;
            $priority = self::pagarme_charge_reconciliation_priority($candidate);
            if ($priority > $best_priority) {
                $best = $candidate;
                $best_priority = $priority;
            }
        }
        if (!is_array($best)) return null;
        $charge_id = self::external_id($best['id'] ?? '');
        if ($charge_id !== '') {
            $remote = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/core/v5/charges/' . rawurlencode($charge_id)
            );
            if (is_wp_error($remote)) return $remote;
            $best = $remote;
        }
        $best['order'] = array_merge(
            [
                'id' => self::external_id($order['id'] ?? ''),
                'code' => self::external_id($order['code'] ?? ''),
                'amount' => $order['amount'] ?? null,
                'currency' => $order['currency'] ?? 'BRL',
                'customer' => $order['customer'] ?? [],
            ],
            is_array($best['order'] ?? null) ? $best['order'] : []
        );
        return $best;
    }

    /** @param array<string,mixed> $charge */
    private static function pagarme_charge_reconciliation_priority(array $charge): int {
        $status = strtolower((string) ($charge['status'] ?? ''));
        $amount = max(0, (int) ($charge['amount'] ?? 0));
        $refunded = max(0, (int) ($charge['refunded_amount'] ?? 0));
        $transaction_status = strtolower((string) (
            $charge['last_transaction']['status'] ?? ''
        ));
        return match (true) {
            in_array($status, ['chargedback', 'chargeback'], true),
            in_array($transaction_status, ['chargedback', 'chargeback'], true) => 100,
            $status === 'refunded' && ($amount === 0 || $refunded >= $amount) => 90,
            $status === 'paid',
            str_contains($transaction_status, 'partial') => 70,
            in_array($status, ['pending', 'processing'], true) => 40,
            default => 10,
        };
    }

    /** @param array<string,mixed> $order */
    private static function pagarme_order_reconciliation_priority(array $order): int {
        $status = strtolower((string) ($order['status'] ?? ''));
        $priority = match ($status) {
            'chargedback', 'chargeback' => 100,
            'refunded' => 90,
            'paid' => 70,
            'pending', 'processing' => 40,
            default => 10,
        };
        foreach ((array) ($order['charges'] ?? []) as $charge) {
            if (!is_array($charge)) continue;
            $priority = max(
                $priority,
                self::pagarme_charge_reconciliation_priority($charge)
            );
        }
        return $priority;
    }

    /** @return array<string,mixed>|WP_Error */
    private function project_reconciled_event(
        array $connection,
        array $sale,
        array $event
    ): array|WP_Error {
        $state_hash = hash('sha256', self::json([
            $connection['provider'] ?? '',
            $sale['uuid'] ?? '',
            $event['externalSaleId'] ?? '',
            $event['externalContractId'] ?? '',
            $event['status'] ?? '',
            $event['subscriptionStatus'] ?? '',
            $event['providerUpdatedAt'] ?? '',
        ]));
        $event['externalEventId'] = 'reconcile_' . substr($state_hash, 0, 48);
        $ledger = Kodety_Members::instance()->record_provider_event([
            'provider' => (string) $connection['provider'],
            'providerTenant' => (string) $connection['uuid'],
            'externalEventId' => (string) $event['externalEventId'],
            'eventType' => 'reconcile.' . substr(
                sanitize_key((string) ($event['eventType'] ?? 'updated')),
                0,
                110
            ),
            // Synthetic reconciliation identity and hash intentionally use
            // the same canonical state. Non-financial provider fields may
            // change between reads without creating a false ledger conflict.
            'payloadHash' => $state_hash,
            'occurredAt' => $event['occurredAt'] ?? null,
        ]);
        if (is_wp_error($ledger)) return $ledger;
        $event_id = absint($ledger['id'] ?? 0);
        if (
            !empty($ledger['duplicate'])
            && in_array((string) ($ledger['status'] ?? ''), ['processed', 'ignored'], true)
        ) {
            return ['ignored' => true, 'reason' => 'reconciled_duplicate'];
        }
        if ((string) ($ledger['status'] ?? '') === 'processing') {
            Kodety_Members::instance()->reclaim_stale_provider_event($event_id, 600);
        }
        $claimed = Kodety_Members::instance()->mark_provider_event($event_id, 'processing');
        if (is_wp_error($claimed)) return $claimed;
        if ($claimed !== true) return ['ignored' => true, 'reason' => 'reconcile_in_progress'];
        $projected = $this->project_provider_event($connection, $event);
        if (is_wp_error($projected)) {
            Kodety_Members::instance()->mark_provider_event(
                $event_id,
                'failed',
                $projected->get_error_code()
            );
            return $projected;
        }
        Kodety_Members::instance()->mark_provider_event(
            $event_id,
            !empty($projected['ignored']) ? 'ignored' : 'processed'
        );
        return $projected;
    }

    public function list_products(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $connection = $this->connection_by_uuid((string) $request['id']);
        if (!$connection) return $this->not_found('connection');
        $credentials = $this->decrypt_secret((string) $connection['credentials']);
        if (is_wp_error($credentials)) return $credentials;
        $provider = (string) $connection['provider'];
        $remote = match ($provider) {
            'stripe' => $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v1/prices',
                [],
                false,
                '',
                ['active' => 'true', 'limit' => '100', 'expand[]' => 'data.product']
            ),
            'pagarme' => $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/core/v5/plans',
                [],
                false,
                '',
                ['page' => '1', 'size' => '100']
            ),
            'hotmart' => $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/products/api/v1/products',
                [],
                false,
                '',
                ['max_results' => '100']
            ),
            default => new WP_Error(
                'kodety_checkout_products_unsupported',
                'Este provedor não oferece catálogo remoto neste adaptador.',
                ['status' => 501]
            ),
        };
        if (is_wp_error($remote)) return $remote;
        return $this->response([
            'items' => $this->normalize_products($provider, $remote),
            'nextCursor' => null,
        ]);
    }

    /**
     * @param array<string,mixed> $remote
     * @return list<array<string,mixed>>
     */
    private function normalize_products(string $provider, array $remote): array {
        $items = [];
        $rows = (array) ($remote['data'] ?? $remote['items'] ?? $remote['plans'] ?? $remote);
        foreach (array_slice($rows, 0, 100) as $row) {
            if (!is_array($row)) continue;
            if ($provider === 'stripe') {
                $product = is_array($row['product'] ?? null) ? $row['product'] : [];
                $items[] = [
                    'id' => self::external_id($product['id'] ?? ''),
                    'name' => substr(sanitize_text_field((string) ($product['name'] ?? $row['nickname'] ?? '')), 0, 191),
                    'description' => substr(sanitize_text_field((string) ($product['description'] ?? '')), 0, 500),
                    'active' => !empty($row['active']) && ($product === [] || !empty($product['active'])),
                    'mode' => isset($row['recurring']) ? 'subscription' : 'payment',
                    'priceId' => self::external_id($row['id'] ?? ''),
                    'amount' => isset($row['unit_amount']) ? (int) $row['unit_amount'] : null,
                    'currency' => self::currency($row['currency'] ?? ''),
                    'interval' => sanitize_key((string) ($row['recurring']['interval'] ?? '')),
                ];
                continue;
            }
            if ($provider === 'pagarme') {
                $items[] = [
                    'id' => self::external_id($row['id'] ?? ''),
                    'name' => substr(sanitize_text_field((string) ($row['name'] ?? $row['description'] ?? '')), 0, 191),
                    'description' => substr(sanitize_text_field((string) ($row['description'] ?? '')), 0, 500),
                    'active' => strtolower((string) ($row['status'] ?? 'active')) === 'active',
                    'mode' => 'subscription',
                    'priceId' => '',
                    'amount' => isset($row['billing_scheme']['value'])
                        ? (int) $row['billing_scheme']['value']
                        : (isset($row['amount']) ? (int) $row['amount'] : null),
                    'currency' => self::currency($row['currency'] ?? 'BRL'),
                    'interval' => sanitize_key((string) ($row['interval'] ?? '')),
                ];
                continue;
            }
            if ($provider === 'hotmart') {
                $is_subscription = rest_sanitize_boolean(
                    $row['is_subscription'] ?? false
                );
                $items[] = [
                    'id' => self::external_id($row['id'] ?? $row['ucode'] ?? ''),
                    'name' => substr(sanitize_text_field((string) ($row['name'] ?? '')), 0, 191),
                    'description' => '',
                    'active' => strtoupper((string) ($row['status'] ?? '')) === 'ACTIVE',
                    'mode' => $is_subscription ? 'subscription' : 'payment',
                    // Hotmart's product-list endpoint intentionally does not
                    // return offer codes. The UI keeps this field editable.
                    'priceId' => '',
                    'amount' => null,
                    'currency' => 'BRL',
                    'interval' => '',
                ];
                continue;
            }
        }
        return array_values(array_filter(
            $items,
            static fn(array $item): bool => ($item['id'] ?? '') !== ''
                || ($item['priceId'] ?? '') !== ''
        ));
    }

    public function list_sales(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $where = ['1=1'];
        $arguments = [];
        $provider = self::provider_key($request->get_param('provider'));
        $status = self::sale_status($request->get_param('status'), '');
        if ($provider !== '' && isset(self::PROVIDERS[$provider])) {
            $where[] = 'c.provider=%s';
            $arguments[] = $provider;
        }
        if ($status === 'unlinked') {
            $where[] = '(s.status=%s OR s.access_status IN (\'unmatched\',\'unlinked\'))';
            $arguments[] = $status;
        } elseif ($status !== '') {
            $where[] = 's.status=%s';
            $arguments[] = $status;
        }
        $access_status = sanitize_key((string) (
            $request->get_param('accessStatus')
            ?: $request->get_param('access_status')
        ));
        if (in_array($access_status, [
            'pending', 'granted', 'blocked', 'revoked',
            'review', 'unmatched', 'unlinked',
        ], true)) {
            $where[] = 's.access_status=%s';
            $arguments[] = $access_status;
        }
        $where_sql = implode(' AND ', $where);
        $count_sql = 'SELECT COUNT(*) FROM ' . self::table('sales') . ' s
            INNER JOIN ' . self::table('connections') . " c ON c.id=s.connection_id
            WHERE {$where_sql}";
        $rows_sql = 'SELECT s.*,c.uuid AS connection_uuid,c.provider,
                    p.name AS plan_name,p.slug AS plan_slug,
                    u.display_name AS member_name,u.user_email AS member_email,
                    EXISTS(
                        SELECT 1 FROM ' . self::table('access_blocks') . ' b
                        WHERE b.user_id=s.user_id AND b.plan_id=s.plan_id
                          AND b.connection_id IN (0,s.connection_id)
                    ) AS access_blocked
             FROM ' . self::table('sales') . ' s
             INNER JOIN ' . self::table('connections') . ' c ON c.id=s.connection_id
             LEFT JOIN ' . $wpdb->prefix . 'kodety_membership_plans p ON p.id=s.plan_id
             LEFT JOIN ' . $wpdb->users . " u ON u.ID=s.user_id
             WHERE {$where_sql}
             ORDER BY s.updated_at DESC,s.id DESC LIMIT %d OFFSET %d";
        $total = (int) $wpdb->get_var(
            $arguments ? $wpdb->prepare($count_sql, ...$arguments) : $count_sql
        );
        $rows = $wpdb->get_results(
            $wpdb->prepare($rows_sql, ...[...$arguments, $per_page, $offset]),
            ARRAY_A
        );
        return $this->response([
            'items' => array_map([$this, 'format_sale'], $rows ?: []),
            'total' => $total,
            'page' => $page,
            'perPage' => $per_page,
        ]);
    }

    /** @param array<string,mixed> $row */
    private function format_sale(array $row): array {
        $provider = (string) ($row['provider'] ?? '');
        $metadata = self::decode_json($row['metadata'] ?? '', []);
        $access_status = (string) ($row['access_status'] ?? 'pending');
        if (empty($row['access_blocked']) && $access_status === 'blocked') {
            $status = self::sale_status($row['status'] ?? 'pending', 'pending');
            $subscription_status = self::subscription_status(
                $metadata['subscriptionStatus'] ?? ''
            );
            $access_status = $status === 'paid'
                ? (
                    self::external_id($row['external_contract_id'] ?? '') === ''
                        || in_array(
                            $subscription_status,
                            self::ACTIVE_SUBSCRIPTION_STATUSES,
                            true
                        )
                    ? 'granted'
                    : 'pending'
                )
                : (in_array($status, self::TERMINAL_SALE_STATUSES, true)
                    ? 'revoked'
                    : 'pending');
        }
        return [
            'id' => (string) ($row['uuid'] ?? ''),
            'connectionId' => (string) ($row['connection_uuid'] ?? ''),
            'provider' => $provider,
            'planId' => absint($row['plan_id'] ?? 0),
            'planName' => (string) ($row['plan_name'] ?? ''),
            'planSlug' => (string) ($row['plan_slug'] ?? ''),
            'userId' => absint($row['user_id'] ?? 0),
            'memberName' => (string) ($row['member_name'] ?? ''),
            // Only WordPress identity is exposed; provider payload e-mail is
            // hashed at ingestion and is never an administrative data source.
            'memberEmail' => sanitize_email((string) ($row['member_email'] ?? '')),
            'externalSaleId' => (string) ($row['external_sale_id'] ?? ''),
            'externalCustomerId' => (string) ($row['external_customer_id'] ?? ''),
            'externalContractId' => (string) ($row['external_contract_id'] ?? ''),
            'status' => (string) ($row['status'] ?? 'pending'),
            'accessStatus' => !empty($row['access_blocked'])
                ? 'blocked'
                : $access_status,
            'clientReference' => substr(
                sanitize_text_field((string) ($metadata['clientReference'] ?? '')),
                0,
                191
            ),
            'amount' => isset($row['amount']) ? (int) $row['amount'] : null,
            'currency' => self::currency($row['currency'] ?? ''),
            'occurredAt' => self::mysql_to_iso($row['occurred_at'] ?? null),
            'providerUpdatedAt' => self::mysql_to_iso($row['provider_updated_at'] ?? null),
            'createdAt' => self::mysql_to_iso($row['created_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
            'dashboardUrl' => self::safe_dashboard_url($provider),
        ];
    }

    public function list_subscriptions(WP_REST_Request $request): WP_REST_Response {
        global $wpdb;
        [$page, $per_page, $offset] = $this->pagination($request);
        $where = ['1=1'];
        $arguments = [];
        $provider = self::provider_key($request->get_param('provider'));
        $status = sanitize_key((string) $request->get_param('status'));
        if ($provider !== '' && isset(self::PROVIDERS[$provider])) {
            $where[] = 's.provider=%s';
            $arguments[] = $provider;
        }
        if (in_array($status, [
            'pending', 'trialing', 'active', 'past_due',
            'paused', 'canceled', 'expired',
        ], true)) {
            $where[] = 's.status=%s';
            $arguments[] = $status;
        }
        $where_sql = implode(' AND ', $where);
        $subscription_table = $wpdb->prefix . 'kodety_membership_subscriptions';
        $count_sql = "SELECT COUNT(*) FROM {$subscription_table} s WHERE {$where_sql}";
        $rows_sql = "SELECT s.*,p.name AS plan_name,p.slug AS plan_slug,
                    u.display_name AS member_name,u.user_email AS member_email,
                    c.uuid AS connection_uuid,
                    EXISTS(
                        SELECT 1 FROM " . self::table('access_blocks') . " b
                        WHERE b.user_id=s.user_id AND b.plan_id=s.plan_id
                          AND b.connection_id IN (0,COALESCE(c.id,0))
                    ) AS access_blocked
             FROM {$subscription_table} s
             INNER JOIN " . $wpdb->prefix . 'kodety_membership_plans p ON p.id=s.plan_id
             LEFT JOIN ' . $wpdb->users . ' u ON u.ID=s.user_id
             LEFT JOIN ' . self::table('connections') . " c
                    ON c.provider=s.provider AND c.uuid=s.provider_tenant
             WHERE {$where_sql}
             ORDER BY s.updated_at DESC,s.id DESC LIMIT %d OFFSET %d";
        $total = (int) $wpdb->get_var(
            $arguments ? $wpdb->prepare($count_sql, ...$arguments) : $count_sql
        );
        $rows = $wpdb->get_results(
            $wpdb->prepare($rows_sql, ...[...$arguments, $per_page, $offset]),
            ARRAY_A
        );
        return $this->response([
            'items' => array_map([$this, 'format_checkout_subscription'], $rows ?: []),
            'total' => $total,
            'page' => $page,
            'perPage' => $per_page,
        ]);
    }

    /** @param array<string,mixed> $row */
    private function format_checkout_subscription(array $row): array {
        $provider = (string) ($row['provider'] ?? '');
        return [
            'id' => absint($row['id'] ?? 0),
            'connectionId' => (string) ($row['connection_uuid'] ?? ''),
            'provider' => $provider,
            'planId' => absint($row['plan_id'] ?? 0),
            'planName' => (string) ($row['plan_name'] ?? ''),
            'planSlug' => (string) ($row['plan_slug'] ?? ''),
            'userId' => absint($row['user_id'] ?? 0),
            'memberName' => (string) ($row['member_name'] ?? ''),
            'memberEmail' => sanitize_email((string) ($row['member_email'] ?? '')),
            'externalCustomerId' => (string) ($row['external_customer_id'] ?? ''),
            'externalContractId' => (string) ($row['external_contract_id'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'accessStatus' => !empty($row['access_blocked'])
                ? 'blocked'
                : (in_array((string) ($row['status'] ?? ''), ['active', 'trialing'], true)
                    ? 'granted'
                    : ((string) ($row['status'] ?? '') === 'pending'
                        ? 'pending'
                        : 'revoked')),
            'currentPeriodStart' => self::mysql_to_iso($row['current_period_start'] ?? null),
            'currentPeriodEnd' => self::mysql_to_iso($row['current_period_end'] ?? null),
            'canceledAt' => self::mysql_to_iso($row['canceled_at'] ?? null),
            'updatedAt' => self::mysql_to_iso($row['updated_at'] ?? null),
            'dashboardUrl' => self::safe_dashboard_url($provider),
            'portalAvailable' => $provider === 'stripe'
                && (string) ($row['external_customer_id'] ?? '') !== '',
        ];
    }

    public function create_portal_link(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $subscription_id = absint($request['id']);
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT s.*,c.*,
                    c.id AS checkout_connection_id,c.uuid AS checkout_connection_uuid
             FROM ' . $wpdb->prefix . 'kodety_membership_subscriptions s
             INNER JOIN ' . self::table('connections')
                . ' c ON c.provider=s.provider AND c.uuid=s.provider_tenant
             WHERE s.id=%d',
            $subscription_id
        ), ARRAY_A);
        if (!is_array($row)) return $this->not_found('subscription');
        if (($row['provider'] ?? '') !== 'stripe') {
            return new WP_Error(
                'kodety_checkout_portal_unsupported',
                'Este provedor não oferece portal hospedado neste adaptador.',
                ['status' => 501]
            );
        }
        $customer_id = self::external_id($row['external_customer_id'] ?? '');
        if ($customer_id === '') {
            return new WP_Error(
                'kodety_checkout_customer_missing',
                'A assinatura ainda não possui cliente externo associado.',
                ['status' => 409]
            );
        }
        $credentials = $this->decrypt_secret((string) $row['credentials']);
        if (is_wp_error($credentials)) return $credentials;
        $raw = $this->payload($request);
        $return_url = $this->same_site_return_url(
            $raw['returnUrl'] ?? $raw['return_url'] ?? '',
            home_url('/')
        );
        if (is_wp_error($return_url)) return $return_url;
        $remote = $this->provider_request(
            $row,
            $credentials,
            'POST',
            '/v1/billing_portal/sessions',
            ['customer' => $customer_id, 'return_url' => $return_url],
            true
        );
        if (is_wp_error($remote)) return $remote;
        $url = self::provider_checkout_url('stripe', $remote['url'] ?? '');
        if ($url === '') {
            return new WP_Error(
                'kodety_checkout_provider_response',
                'A Stripe não retornou uma sessão de portal válida.',
                ['status' => 502]
            );
        }
        return $this->response(['url' => $url]);
    }

    public function create_access_link(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user = $this->manageable_member(absint($request['id']));
        if (is_wp_error($user)) return $user;
        if (
            !Kodety_Members::is_public_member_account($user)
            || sanitize_key((string) get_user_meta(
                $user->ID,
                '_kodety_membership_status',
                true
            )) === 'suspended'
        ) {
            return new WP_Error(
                'kodety_checkout_member_session_forbidden',
                'Este usuário não possui uma conta de membro apta a entrar no site.',
                ['status' => 409]
            );
        }
        $token = self::opaque_token();
        $hash = hash_hmac('sha256', $token, wp_salt('auth'));
        $expires = time() + self::ACCESS_LINK_TTL;
        if (!set_transient('kodety_member_access_' . $hash, [
            'userId' => $user->ID,
            'createdBy' => get_current_user_id(),
            'expires' => $expires,
        ], self::ACCESS_LINK_TTL)) {
            return $this->storage_error('Não foi possível criar o link de acesso.');
        }
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.access_link.created',
            'user',
            (string) $user->ID,
            [],
            ['expiresAt' => gmdate('c', $expires)],
            $user->ID
        );
        return $this->response([
            'url' => add_query_arg(['kodety_member_access' => $token], home_url('/')),
            'expiresAt' => gmdate('c', $expires),
        ], 201);
    }

    public function consume_access_link(): void {
        if (!isset($_GET['kodety_member_access']) || !Kodety_Members::is_current_project_enabled()) {
            return;
        }
        $token = trim((string) wp_unslash($_GET['kodety_member_access']));
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) return;
        $hash = hash_hmac('sha256', $token, wp_salt('auth'));
        $key = 'kodety_member_access_' . $hash;
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($method !== 'POST') {
            $pending = get_transient($key);
            if (
                is_array($pending)
                && absint($pending['expires'] ?? 0) >= time()
            ) {
                $this->render_access_confirmation($token);
            }
            return;
        }
        $nonce = sanitize_text_field((string) wp_unslash(
            $_POST['kodety_member_access_nonce'] ?? ''
        ));
        if (!wp_verify_nonce($nonce, 'kodety_member_access_' . $token)) return;
        $payload = $this->consume_transient_once($key);
        if (
            !is_array($payload)
            || absint($payload['expires'] ?? 0) < time()
            || !(get_user_by('id', absint($payload['userId'] ?? 0)) instanceof WP_User)
        ) {
            return;
        }
        $user_id = absint($payload['userId']);
        $user = get_user_by('id', $user_id);
        if (!$user instanceof WP_User || user_can($user, 'manage_options')) return;
        $session = Kodety_Members::instance()->start_member_session($user_id, false);
        if (is_wp_error($session)) {
            do_action(
                'kodety_checkout_access_link_session_failed',
                $user_id,
                $session->get_error_code()
            );
            wp_safe_redirect($this->member_login_url(), 302, 'Onun Kodety');
            exit;
        }
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.access_link.consumed',
            'user',
            (string) $user_id,
            [],
            ['consumed' => true],
            $user_id,
            absint($payload['createdBy'] ?? 0)
        );
        $settings = Kodety_Members::settings();
        $destination = (string) ($settings['account_page_url'] ?? '');
        if ($destination === '') $destination = home_url('/');
        wp_safe_redirect($destination, 302, 'Onun Kodety');
        exit;
    }

    private function render_access_confirmation(string $token): void {
        nocache_headers();
        header('X-Robots-Tag: noindex, nofollow', true);
        status_header(200);
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));
        $action = add_query_arg(
            ['kodety_member_access' => $token],
            home_url('/')
        );
        $nonce = wp_nonce_field(
            'kodety_member_access_' . $token,
            'kodety_member_access_nonce',
            true,
            false
        );
        echo '<!doctype html><html lang="pt-BR"><head><meta charset="'
            . esc_attr(get_bloginfo('charset'))
            . '"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<meta name="robots" content="noindex,nofollow"><title>Confirmar acesso</title>'
            . '<style>body{margin:0;background:#f5f5f7;color:#171717;font:16px/1.5 '
            . '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:420px;'
            . 'margin:12vh auto;background:#fff;border:1px solid #e5e5e5;border-radius:18px;'
            . 'padding:32px;box-shadow:0 18px 50px rgba(0,0,0,.08)}h1{font-size:26px;'
            . 'margin:0 0 12px}p{color:#555}button{width:100%;padding:13px 16px;border:0;'
            . 'border-radius:10px;background:#171717;color:#fff;font:600 16px/1 inherit;'
            . 'cursor:pointer}</style></head><body><main><h1>Confirmar acesso</h1>'
            . '<p>Este link é de uso único. Confirme para entrar na sua conta.</p>'
            . '<form method="post" action="' . esc_url($action) . '">'
            . $nonce
            . '<button type="submit">Entrar com segurança</button></form></main></body></html>';
        exit;
    }

    public function create_reset_link(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user = $this->manageable_member(absint($request['id']));
        if (is_wp_error($user)) return $user;
        if (!Kodety_Members::is_public_member_account($user)) {
            return new WP_Error(
                'kodety_checkout_member_identity',
                'Este usuário não é uma conta de membro do site.',
                ['status' => 409]
            );
        }
        $url = $this->member_reset_url($user);
        if (is_wp_error($url)) return $url;
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.reset_link.created',
            'user',
            (string) $user->ID,
            [],
            ['created' => true],
            $user->ID
        );
        return $this->response([
            'url' => $url,
            'expiresAt' => null,
        ], 201);
    }

    public function send_reset_email(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $user = $this->manageable_member(absint($request['id']));
        if (is_wp_error($user)) return $user;
        if (!Kodety_Members::is_public_member_account($user)) {
            return new WP_Error(
                'kodety_checkout_member_identity',
                'Este usuário não é uma conta de membro do site.',
                ['status' => 409]
            );
        }
        $sent = $this->send_member_reset_email($user);
        if (is_wp_error($sent)) return $sent;
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.reset_email.sent',
            'user',
            (string) $user->ID,
            [],
            ['sent' => true],
            $user->ID
        );
        return $this->response(['sent' => true]);
    }

    public function change_member_access(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;
        $user = $this->manageable_member(absint($request['id']));
        if (is_wp_error($user)) return $user;
        $raw = $this->payload($request);
        $plan_id = absint($raw['planId'] ?? $raw['plan_id'] ?? 0);
        $plan = $this->plan_row($plan_id);
        if (!$plan || ($plan['status'] ?? '') !== 'active') {
            return new WP_Error(
                'kodety_checkout_plan_not_found',
                'Plano ativo não encontrado.',
                ['status' => 404]
            );
        }
        $action = sanitize_key((string) ($raw['action'] ?? 'grant'));
        $connection = null;
        $connection_uuid = (string) (
            $raw['connectionId'] ?? $raw['connection_id'] ?? ''
        );
        if ($connection_uuid !== '') {
            $connection = $this->connection_by_uuid($connection_uuid);
            if (!$connection) return $this->not_found('connection');
        }
        $reason = substr(
            sanitize_text_field((string) (
                $raw['reason']
                ?? ($action === 'grant'
                    ? 'Acesso adicionado pelo painel.'
                    : ($action === 'restore'
                        ? 'Acesso restaurado pelo painel.'
                        : 'Acesso removido pelo painel.'))
            )),
            0,
            500
        );
        if ($action === 'grant') {
            $result = Kodety_Members::instance()->upsert_grant([
                'userId' => $user->ID,
                'targetType' => 'plan',
                'targetId' => $plan_id,
                'source' => 'manual',
                'sourceReference' => 'commerce-ui:plan:' . $plan_id,
                'reason' => $reason,
            ], get_current_user_id());
            if (is_wp_error($result)) return $result;
            // Clear blocks only after the grant is durable. If deletion fails,
            // the existing block remains fail-closed.
            $unblocked = $wpdb->query($wpdb->prepare(
                'DELETE FROM ' . self::table('access_blocks')
                    . ' WHERE user_id=%d AND plan_id=%d',
                $user->ID,
                $plan_id
            ));
            if ($unblocked === false) {
                return $this->storage_error(
                    'O plano foi salvo, mas o bloqueio anterior permaneceu ativo.'
                );
            }
            $this->refresh_sale_access_statuses($user->ID, $plan_id, 0);
            $this->bump_user_revision($user->ID);
            Kodety_Members::instance()->record_commerce_audit(
                'commerce.access.granted',
                'access',
                $user->ID . ':' . $plan_id,
                [],
                [
                    'userId' => $user->ID,
                    'planId' => $plan_id,
                    'reason' => $reason,
                    'billingUnaffected' => true,
                ],
                $user->ID
            );
            return $this->response([
                'access' => 'granted',
                'grant' => $result,
                'billingUnaffected' => true,
            ]);
        }
        if (!in_array($action, ['revoke', 'restore'], true)) {
            return new WP_Error(
                'kodety_checkout_access_action',
                'Ação de acesso inválida.',
                ['status' => 400]
            );
        }
        $connection_id = absint($connection['id'] ?? 0);
        if ($action === 'restore') {
            $restored = $wpdb->delete(self::table('access_blocks'), [
                'user_id' => $user->ID,
                'plan_id' => $plan_id,
                'connection_id' => $connection_id,
            ]);
            if ($restored === false) {
                return $this->storage_error('Não foi possível restaurar o acesso.');
            }
            $this->refresh_sale_access_statuses(
                $user->ID,
                $plan_id,
                $connection_id
            );
            $this->bump_user_revision($user->ID);
            Kodety_Members::instance()->record_commerce_audit(
                'commerce.access.restored',
                'access',
                $user->ID . ':' . $plan_id,
                [],
                [
                    'userId' => $user->ID,
                    'planId' => $plan_id,
                    'connectionId' => (string) ($connection['uuid'] ?? ''),
                    'reason' => $reason,
                    'billingUnaffected' => true,
                ],
                $user->ID
            );
            do_action('kodety_checkout_access_block_changed', $user->ID, $plan_id, 'restored');
            return $this->response([
                'access' => 'restored',
                'requiresSync' => false,
                'billingUnaffected' => true,
            ]);
        }
        $now = self::now();
        $block = [
            'user_id' => $user->ID,
            'plan_id' => $plan_id,
            'connection_id' => $connection_id,
            'reason' => $reason,
            'created_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $wpdb->query('START TRANSACTION');
        try {
            $existing = $wpdb->get_var($wpdb->prepare(
                'SELECT id FROM ' . self::table('access_blocks')
                    . ' WHERE user_id=%d AND plan_id=%d AND connection_id=%d',
                $user->ID,
                $plan_id,
                $connection_id
            ));
            if ($existing) {
                if ($wpdb->update(self::table('access_blocks'), $block, ['id' => absint($existing)]) === false) {
                    throw new RuntimeException('block_update_failed');
                }
            } elseif (!$wpdb->insert(self::table('access_blocks'), $block)) {
                throw new RuntimeException('block_insert_failed');
            }
            $wpdb->query('COMMIT');
        } catch (Throwable) {
            $wpdb->query('ROLLBACK');
            return $this->storage_error('Não foi possível remover o acesso.');
        }
        $this->bump_user_revision($user->ID);
        Kodety_Members::instance()->record_commerce_audit(
            'commerce.access.revoked',
            'access',
            $user->ID . ':' . $plan_id,
            [],
            [
                'userId' => $user->ID,
                'planId' => $plan_id,
                'connectionId' => (string) ($connection['uuid'] ?? ''),
                'reason' => $reason,
                'billingUnaffected' => true,
            ],
            $user->ID
        );
        do_action('kodety_checkout_access_block_changed', $user->ID, $plan_id, 'revoked');
        return $this->response([
            'access' => 'revoked',
            'billingUnaffected' => true,
        ]);
    }

    private function refresh_sale_access_statuses(
        int $user_id,
        int $plan_id,
        int $connection_id
    ): void {
        global $wpdb;
        if ($user_id <= 0 || $plan_id <= 0) return;
        $sql = 'SELECT id,connection_id,status,external_contract_id,metadata'
            . ' FROM ' . self::table('sales')
            . ' WHERE user_id=%d AND plan_id=%d';
        $arguments = [$user_id, $plan_id];
        if ($connection_id > 0) {
            $sql .= ' AND connection_id=%d';
            $arguments[] = $connection_id;
        }
        $rows = $wpdb->get_results(
            $wpdb->prepare($sql, ...$arguments),
            ARRAY_A
        );
        foreach ($rows ?: [] as $row) {
            $sale_connection_id = absint($row['connection_id'] ?? 0);
            if ($this->access_is_blocked(
                $user_id,
                $plan_id,
                $sale_connection_id
            )) {
                $access_status = 'blocked';
            } else {
                $status = self::sale_status($row['status'] ?? 'pending', 'pending');
                $contract_id = self::external_id($row['external_contract_id'] ?? '');
                if ($status === 'paid' && $contract_id === '') {
                    $access_status = 'granted';
                } elseif ($status === 'paid') {
                    $metadata = self::decode_json($row['metadata'] ?? '', []);
                    $subscription_status = self::subscription_status(
                        $metadata['subscriptionStatus'] ?? ''
                    );
                    $access_status = in_array(
                        $subscription_status,
                        self::ACTIVE_SUBSCRIPTION_STATUSES,
                        true
                    ) ? 'granted' : 'pending';
                } elseif (in_array($status, self::TERMINAL_SALE_STATUSES, true)) {
                    $access_status = 'revoked';
                } else {
                    $access_status = 'pending';
                }
            }
            $wpdb->update(self::table('sales'), [
                'access_status' => $access_status,
                'updated_at' => self::now(),
            ], ['id' => absint($row['id'])]);
        }
    }

    /**
     * Preserve immutable financial history while severing the deleted local
     * identity. The tombstone prevents a later renewal from silently creating
     * the account again from provider e-mail.
     *
     * @param array<string,mixed> $cleanup
     */
    public function handle_member_deleted(int $user_id, array $cleanup = []): void {
        global $wpdb;
        if ($user_id <= 0) return;
        $blocks_deleted = $wpdb->delete(
            self::table('access_blocks'),
            ['user_id' => $user_id]
        );
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT id,metadata FROM ' . self::table('sales')
                . ' WHERE user_id=%d',
            $user_id
        ), ARRAY_A);
        $failed = $blocks_deleted === false;
        foreach ($rows ?: [] as $row) {
            $metadata = self::decode_json($row['metadata'] ?? '', []);
            unset($metadata['checkout_email_encrypted']);
            $metadata['identity_deleted'] = true;
            $metadata['identity_deleted_at'] = self::now();
            $updated = $wpdb->update(self::table('sales'), [
                'user_id' => 0,
                'access_status' => 'unlinked',
                'metadata' => self::json($metadata),
                'updated_at' => self::now(),
            ], ['id' => absint($row['id'])]);
            if ($updated === false) $failed = true;
        }
        do_action(
            $failed
                ? 'kodety_checkout_member_detach_failed'
                : 'kodety_checkout_member_detached',
            $user_id,
            count($rows ?: []),
            $cleanup
        );
    }

    /**
     * Apply local access-only overrides without rewriting the financial
     * subscription projection. The provider status remains visible as-is.
     *
     * @param array<string,mixed> $claims
     * @return array<string,mixed>
     */
    public function apply_access_blocks(array $claims, int $user_id): array {
        global $wpdb;
        if ($user_id <= 0) return $claims;
        $blocked = $wpdb->get_results($wpdb->prepare(
            'SELECT DISTINCT b.plan_id,p.slug
             FROM ' . self::table('access_blocks') . ' b
             INNER JOIN ' . $wpdb->prefix . 'kodety_membership_plans p ON p.id=b.plan_id
             WHERE b.user_id=%d',
            $user_id
        ), ARRAY_A);
        if (!$blocked) return $claims;
        $blocked_ids = [];
        $blocked_slugs = [];
        foreach ($blocked as $row) {
            $id = absint($row['plan_id'] ?? 0);
            $slug = self::plan_key($row['slug'] ?? '');
            if ($id > 0) $blocked_ids[$id] = $id;
            if ($slug !== '') $blocked_slugs[$slug] = true;
        }
        $claims['plans'] = array_values(array_filter(
            (array) ($claims['plans'] ?? []),
            static fn(mixed $slug): bool => !isset($blocked_slugs[self::plan_key($slug)])
        ));

        // Remove entitlements contributed only by blocked plans, while
        // preserving a direct entitlement grant or another currently allowed
        // plan that contributes the same key.
        if ($blocked_ids && !empty($claims['entitlements'])) {
            $placeholders = implode(',', array_fill(0, count($blocked_ids), '%d'));
            $blocked_entitlements = $wpdb->get_col($wpdb->prepare(
                'SELECT DISTINCT e.entitlement_key
                 FROM ' . $wpdb->prefix . 'kodety_membership_plan_entitlements pe
                 INNER JOIN ' . $wpdb->prefix . 'kodety_membership_entitlements e
                    ON e.id=pe.entitlement_id
                 WHERE pe.plan_id IN (' . $placeholders . ')',
                ...array_values($blocked_ids)
            ));
            $remaining_slugs = array_values(array_filter(array_map(
                [self::class, 'plan_key'],
                (array) ($claims['plans'] ?? [])
            )));
            $preserved = [];
            if ($remaining_slugs) {
                $slug_placeholders = implode(',', array_fill(0, count($remaining_slugs), '%s'));
                $rows = $wpdb->get_col($wpdb->prepare(
                    'SELECT DISTINCT e.entitlement_key
                     FROM ' . $wpdb->prefix . 'kodety_membership_plan_entitlements pe
                     INNER JOIN ' . $wpdb->prefix . 'kodety_membership_plans p ON p.id=pe.plan_id
                     INNER JOIN ' . $wpdb->prefix . 'kodety_membership_entitlements e
                        ON e.id=pe.entitlement_id
                     WHERE p.slug IN (' . $slug_placeholders . ')',
                    ...$remaining_slugs
                ));
                foreach ($rows ?: [] as $key) $preserved[(string) $key] = true;
            }
            $direct = $wpdb->get_col($wpdb->prepare(
                'SELECT DISTINCT e.entitlement_key
                 FROM ' . $wpdb->prefix . 'kodety_membership_grants g
                 INNER JOIN ' . $wpdb->prefix . 'kodety_membership_entitlements e
                    ON e.id=g.entitlement_id
                 WHERE g.user_id=%d AND g.entitlement_id>0 AND g.status=\'active\'
                   AND g.starts_at<=%s AND (g.ends_at IS NULL OR g.ends_at>%s)',
                $user_id,
                self::now(),
                self::now()
            ));
            foreach ($direct ?: [] as $key) $preserved[(string) $key] = true;
            foreach ($blocked_entitlements ?: [] as $key) {
                $key = (string) $key;
                if (!isset($preserved[$key])) unset($claims['entitlements'][$key]);
            }
        }
        if ($blocked_ids) {
            $placeholders = implode(',', array_fill(0, count($blocked_ids), '%d'));
            $now = self::now();
            $rows = $wpdb->get_results($wpdb->prepare(
                'SELECT status,started_at,trial_ends_at,current_period_start,
                        current_period_end,grace_ends_at,ended_at
                 FROM ' . $wpdb->prefix . 'kodety_membership_subscriptions
                 WHERE user_id=%d AND plan_id NOT IN (' . $placeholders . ')
                   AND status IN (\'trialing\',\'active\',\'past_due\')
                   AND (ended_at IS NULL OR ended_at>%s)',
                ...[$user_id, ...array_values($blocked_ids), $now]
            ), ARRAY_A);
            $statuses = [];
            $expires_at = null;
            foreach ($rows ?: [] as $subscription) {
                $status = sanitize_key((string) ($subscription['status'] ?? ''));
                $started = (string) ($subscription['started_at'] ?? '');
                $period_start = (string) ($subscription['current_period_start'] ?? '');
                if (
                    ($started !== '' && $started > $now)
                    || ($period_start !== '' && $period_start > $now)
                ) {
                    continue;
                }
                $valid = match ($status) {
                    'trialing' => ($subscription['trial_ends_at'] ?? '') > $now,
                    'active' => ($subscription['current_period_end'] ?? '') === ''
                        || ($subscription['current_period_end'] ?? '') > $now,
                    'past_due' => ($subscription['grace_ends_at'] ?? '') > $now,
                    default => false,
                };
                if ($valid) {
                    $statuses[$status] = $status;
                    $candidate = $status === 'past_due'
                        ? ($subscription['grace_ends_at'] ?? null)
                        : ($status === 'trialing'
                            ? ($subscription['trial_ends_at'] ?? null)
                            : ($subscription['current_period_end'] ?? null));
                    $candidate = self::date_to_mysql($candidate);
                    if (
                        $candidate !== null
                        && ($expires_at === null || $candidate < $expires_at)
                    ) {
                        $expires_at = $candidate;
                    }
                }
            }
            $claims['subscriptionStatuses'] = array_values($statuses);
            $grant_expiries = $wpdb->get_col($wpdb->prepare(
                'SELECT ends_at
                 FROM ' . $wpdb->prefix . 'kodety_membership_grants
                 WHERE user_id=%d AND status=\'active\' AND starts_at<=%s
                   AND (ends_at IS NULL OR ends_at>%s)
                   AND (plan_id=0 OR plan_id NOT IN (' . $placeholders . '))',
                ...[$user_id, $now, $now, ...array_values($blocked_ids)]
            ));
            foreach ($grant_expiries ?: [] as $candidate) {
                $candidate = self::date_to_mysql($candidate);
                if (
                    $candidate !== null
                    && ($expires_at === null || $candidate < $expires_at)
                ) {
                    $expires_at = $candidate;
                }
            }
            $claims['expiresAt'] = $expires_at !== null
                ? self::mysql_to_iso($expires_at)
                : null;
        }
        $claims['accessOverrides'] = [
            'blockedPlanIds' => array_values($blocked_ids),
            'billingUnaffected' => true,
        ];
        return $claims;
    }

    private function access_is_blocked(int $user_id, int $plan_id, int $connection_id): bool {
        global $wpdb;
        if ($user_id <= 0 || $plan_id <= 0) return false;
        return (bool) $wpdb->get_var($wpdb->prepare(
            'SELECT id FROM ' . self::table('access_blocks') . '
             WHERE user_id=%d AND plan_id=%d AND connection_id IN (0,%d) LIMIT 1',
            $user_id,
            $plan_id,
            $connection_id
        ));
    }

    public function receive_webhook(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $content_length = absint($request->get_header('Content-Length'));
        if ($content_length > self::MAX_WEBHOOK_BYTES) {
            return new WP_Error(
                'kodety_checkout_webhook_size',
                'Webhook acima do limite.',
                ['status' => 413]
            );
        }
        $raw_body = (string) $request->get_body();
        if ($raw_body === '' || strlen($raw_body) > self::MAX_WEBHOOK_BYTES) {
            return new WP_Error(
                'kodety_checkout_webhook_body',
                'Webhook vazio ou acima do limite.',
                ['status' => 400]
            );
        }
        $connection = null;
        $opaque_key = trim((string) $request['key']);
        if ($opaque_key !== '') {
            $connection = $this->connection_by_webhook_key($opaque_key);
        } else {
            $connection = $this->connection_by_uuid((string) $request['connection']);
            $opaque_key = trim((string) (
                $request->get_header('X-Kodety-Webhook-Key')
                ?: $request->get_param('key')
            ));
            if ($connection && !$this->webhook_key_matches($connection, $opaque_key)) {
                $connection = null;
            }
        }
        // Disabling a connection stops new checkout creation, but must not
        // stop provider lifecycle events. Otherwise billing can continue
        // externally while cancellation/refund/access changes are lost.
        if (!$connection || ($connection['status'] ?? '') === 'deleted') {
            return new WP_Error(
                'kodety_checkout_webhook_forbidden',
                'Webhook não autorizado.',
                ['status' => 401]
            );
        }
        $provider = (string) $connection['provider'];
        $route_provider = self::provider_key($request['provider'] ?? '');
        if ($route_provider !== '' && !hash_equals($provider, $route_provider)) {
            return new WP_Error(
                'kodety_checkout_webhook_provider',
                'Webhook não autorizado.',
                ['status' => 401]
            );
        }
        $credentials = $this->decrypt_secret((string) $connection['credentials']);
        if (is_wp_error($credentials)) return $credentials;
        $payload = json_decode($raw_body, true);
        if (!is_array($payload)) {
            $payload = [];
            parse_str($raw_body, $payload);
        }
        if (!is_array($payload) || !$payload) {
            return new WP_Error(
                'kodety_checkout_webhook_json',
                'Payload inválido.',
                ['status' => 400]
            );
        }
        $verified = $this->verify_provider_webhook(
            $provider,
            $credentials,
            $request,
            $raw_body,
            $payload
        );
        if (is_wp_error($verified)) return $verified;
        $payload_hash = hash('sha256', $raw_body);
        $identity = $this->preliminary_event_identity($provider, $payload, $payload_hash);
        $ledger = Kodety_Members::instance()->record_provider_event([
            'provider' => $provider,
            'providerTenant' => (string) $connection['uuid'],
            'externalEventId' => (string) $identity['externalEventId'],
            'eventType' => (string) $identity['eventType'],
            'payloadHash' => $payload_hash,
            'occurredAt' => $identity['occurredAt'] ?? null,
        ]);
        if (is_wp_error($ledger)) return $ledger;
        $event_id = absint($ledger['id'] ?? 0);
        if (!empty($ledger['duplicate']) && in_array(
            (string) ($ledger['status'] ?? ''),
            ['processed', 'ignored'],
            true
        )) {
            return $this->response([
                'received' => true,
                'duplicate' => true,
            ]);
        }
        if (
            !empty($ledger['duplicate'])
            && (string) ($ledger['status'] ?? '') === 'processing'
        ) {
            $reclaimed = Kodety_Members::instance()->reclaim_stale_provider_event(
                $event_id,
                600
            );
            if (is_wp_error($reclaimed)) return $reclaimed;
            if ($reclaimed !== true) {
                return $this->processing_retry_response();
            }
        }
        $claimed = Kodety_Members::instance()->mark_provider_event($event_id, 'processing');
        if (is_wp_error($claimed)) return $claimed;
        if ($claimed !== true) {
            // Another worker owns a safely persisted ledger item.
            return $this->processing_retry_response();
        }
        $authoritative = $this->authoritative_webhook_object(
            $connection,
            $credentials,
            $provider,
            $payload
        );
        if (is_wp_error($authoritative)) {
            Kodety_Members::instance()->mark_provider_event(
                $event_id,
                'failed',
                $authoritative->get_error_code()
            );
            return $authoritative;
        }
        $event = $this->normalize_provider_event(
            $provider,
            $payload,
            $authoritative,
            $payload_hash
        );
        if (is_wp_error($event)) {
            Kodety_Members::instance()->mark_provider_event(
                $event_id,
                'failed',
                $event->get_error_code()
            );
            return $event;
        }
        $event['externalEventId'] = (string) $identity['externalEventId'];
        $projected = $this->project_provider_event($connection, $event);
        if (is_wp_error($projected)) {
            Kodety_Members::instance()->mark_provider_event(
                $event_id,
                'failed',
                $projected->get_error_code()
            );
            return $projected;
        }
        $final_status = !empty($projected['ignored']) ? 'ignored' : 'processed';
        $marked = Kodety_Members::instance()->mark_provider_event($event_id, $final_status);
        if (is_wp_error($marked) || $marked !== true) {
            return $this->storage_error('O evento foi projetado, mas o ledger não pôde ser finalizado.');
        }
        return $this->response([
            'received' => true,
            'duplicate' => false,
            'ignored' => !empty($projected['ignored']),
            'saleId' => (string) ($projected['saleId'] ?? ''),
        ]);
    }

    /**
     * @param array<string,string> $credentials
     * @param array<string,mixed> $payload
     */
    private function verify_provider_webhook(
        string $provider,
        array $credentials,
        WP_REST_Request $request,
        string $raw_body,
        array $payload
    ): bool|WP_Error {
        if ($provider === 'pagbank' && self::is_pagbank_legacy_notification($payload)) {
            if (
                trim((string) ($credentials['token'] ?? '')) === ''
                || !is_email((string) ($credentials['accountEmail'] ?? ''))
            ) {
                return new WP_Error(
                    'kodety_checkout_pagbank_legacy_credentials',
                    'Configure o e-mail da conta PagBank para processar notificações legadas.',
                    ['status' => 503]
                );
            }
            // The opaque Onun Kodety endpoint token authenticates the route. The
            // notification code is only a locator; the transaction is fetched
            // from PagBank with account credentials before any projection.
            return true;
        }
        $valid = match ($provider) {
            'stripe' => self::verify_stripe_signature(
                $raw_body,
                (string) $request->get_header('Stripe-Signature'),
                (string) ($credentials['webhookSecret'] ?? ''),
                time()
            ),
            'mercado_pago' => self::verify_mercado_pago_signature(
                (string) $request->get_header('X-Signature'),
                (string) $request->get_header('X-Request-Id'),
                (string) (
                    $request->get_param('data.id')
                    ?: $request->get_param('data_id')
                    ?: ($payload['data']['id'] ?? '')
                ),
                (string) ($credentials['webhookSecret'] ?? ''),
                time()
            ),
            'asaas' => self::constant_bearer_matches(
                (string) (
                    $request->get_header('asaas-access-token')
                    ?: $request->get_header('access_token')
                ),
                (string) ($credentials['webhookToken'] ?? '')
            ),
            'pagbank' => self::verify_pagbank_signature(
                $raw_body,
                (string) $request->get_header('X-Authenticity-Token'),
                (string) ($credentials['token'] ?? '')
            ),
            'woovi' => $this->verify_woovi_signature_or_authorization(
                $raw_body,
                (string) $request->get_header('X-Webhook-Signature')
            ),
            'hotmart' => self::constant_bearer_matches(
                trim((string) (
                    $request->get_header('X-HOTMART-HOTTOK')
                    ?: ($payload['hottok'] ?? '')
                )),
                trim((string) ($credentials['hottok'] ?? ''))
            ),
            'ticto' => self::constant_bearer_matches(
                trim((string) ($payload['token'] ?? '')),
                trim((string) ($credentials['webhookToken'] ?? ''))
            ),
            // Pagar.me v5 and Iugu do not currently expose a sufficiently
            // documented HMAC contract here. The opaque endpoint token was
            // already checked and authoritative_webhook_object() MUST re-fetch.
            'pagarme', 'iugu' => true,
            default => false,
        };
        if ($valid === true) return true;
        return new WP_Error(
            'kodety_checkout_webhook_signature',
            'Assinatura de webhook inválida.',
            ['status' => 401]
        );
    }

    /**
     * Build a retry-stable ledger identity using only the authenticated
     * notification envelope, before any provider API round trip.
     *
     * @return array{externalEventId:string,eventType:string,occurredAt:mixed}
     */
    private function preliminary_event_identity(
        string $provider,
        array $payload,
        string $payload_hash
    ): array {
        $object = is_array($payload['data']['object'] ?? null)
            ? $payload['data']['object']
            : (is_array($payload['data'] ?? null) ? $payload['data'] : $payload);
        $type = match ($provider) {
            'stripe', 'pagarme' => (string) ($payload['type'] ?? 'event.updated'),
            'mercado_pago' => (string) ($payload['action'] ?? $payload['type'] ?? 'payment.updated'),
            'asaas' => (string) ($payload['event'] ?? 'asaas.updated'),
            'pagbank' => 'pagbank.' . strtolower((string) (
                $payload['charges'][0]['status'] ?? $payload['status'] ?? 'updated'
            )),
            'woovi' => (string) ($payload['event'] ?? 'woovi:CHARGE_UPDATED'),
            'iugu' => (string) ($payload['event'] ?? 'invoice.updated'),
            'hotmart' => (string) ($payload['event'] ?? 'PURCHASE_UPDATED'),
            'ticto' => 'ticto.' . strtolower((string) ($payload['status'] ?? 'updated')),
            default => 'event.updated',
        };
        $explicit = in_array(
            $provider,
            ['asaas', 'pagbank', 'woovi', 'iugu', 'ticto'],
            true
        )
            ? ''
            : self::external_id($payload['id'] ?? '');
        $object_id = self::external_id(
            $object['id']
            ?? $object['identifier']
            ?? $object['correlationID']
            ?? $payload['data']['id']
            ?? $payload['charges'][0]['id']
            ?? $payload['order']['transaction_hash']
            ?? $payload['order']['hash']
            ?? $payload['order']['id']
            ?? ''
        );
        $occurred = $payload['created']
            ?? $payload['created_at']
            ?? $payload['date_created']
            ?? $payload['dateCreated']
            ?? $payload['creation_date']
            ?? $payload['status_date']
            ?? $object['updated_at']
            ?? $object['updatedAt']
            ?? null;
        if ($explicit === '') {
            $explicit = substr(hash('sha256', implode('|', [
                $provider,
                $object_id,
                $type,
                (string) (
                    $object['status']
                    ?? $payload['charges'][0]['status']
                    ?? ''
                ),
                (string) $occurred,
                $payload_hash,
            ])), 0, 64);
        }
        return [
            'externalEventId' => $explicit,
            'eventType' => substr(sanitize_text_field($type), 0, 128),
            'occurredAt' => self::date_to_mysql($occurred),
        ];
    }

    public static function verify_stripe_signature(
        string $raw_body,
        string $header,
        string $secret,
        int $now
    ): bool {
        if ($raw_body === '' || $header === '' || $secret === '') return false;
        $timestamp = 0;
        $signatures = [];
        foreach (explode(',', $header) as $piece) {
            [$key, $value] = array_pad(explode('=', trim($piece), 2), 2, '');
            if ($key === 't' && ctype_digit($value)) $timestamp = (int) $value;
            if ($key === 'v1' && preg_match('/^[a-f0-9]{64}$/i', $value)) {
                $signatures[] = strtolower($value);
            }
        }
        if ($timestamp <= 0 || abs($now - $timestamp) > self::WEBHOOK_TOLERANCE) return false;
        $expected = hash_hmac('sha256', $timestamp . '.' . $raw_body, $secret);
        foreach ($signatures as $signature) {
            if (hash_equals($expected, $signature)) return true;
        }
        return false;
    }

    public static function verify_mercado_pago_signature(
        string $header,
        string $request_id,
        string $data_id,
        string $secret,
        int $now
    ): bool {
        if ($header === '' || $request_id === '' || $data_id === '' || $secret === '') return false;
        $timestamp = '';
        $signature = '';
        foreach (explode(',', $header) as $piece) {
            [$key, $value] = array_pad(explode('=', trim($piece), 2), 2, '');
            if ($key === 'ts') $timestamp = $value;
            if ($key === 'v1') $signature = strtolower($value);
        }
        if (!ctype_digit($timestamp) || !preg_match('/^[a-f0-9]{64}$/', $signature)) return false;
        $seconds = (int) $timestamp;
        if ($seconds > 9999999999) $seconds = (int) floor($seconds / 1000);
        if (abs($now - $seconds) > self::WEBHOOK_TOLERANCE) return false;
        $manifest = 'id:' . strtolower($data_id)
            . ';request-id:' . $request_id
            . ';ts:' . $timestamp . ';';
        return hash_equals(hash_hmac('sha256', $manifest, $secret), $signature);
    }

    public static function verify_pagbank_signature(
        string $raw_body,
        string $signature,
        string $token
    ): bool {
        $signature = strtolower(trim($signature));
        if (
            $raw_body === ''
            || $token === ''
            || !preg_match('/^[a-f0-9]{64}$/', $signature)
        ) {
            return false;
        }
        return hash_equals(hash('sha256', $token . '-' . $raw_body), $signature);
    }

    /** @param array<string,mixed> $payload */
    private static function is_pagbank_legacy_notification(array $payload): bool {
        $type = strtolower(trim((string) ($payload['notificationType'] ?? '')));
        $code = trim((string) ($payload['notificationCode'] ?? ''));
        return $type === 'transaction'
            && preg_match('/^[A-Za-z0-9-]{20,100}$/', $code) === 1;
    }

    private static function constant_bearer_matches(string $provided, string $expected): bool {
        return $provided !== '' && $expected !== '' && hash_equals($expected, $provided);
    }

    private function verify_woovi_signature_or_authorization(
        string $raw_body,
        string $signature
    ): bool {
        if (
            $raw_body === ''
            || $signature === ''
            || !function_exists('openssl_verify')
        ) {
            return false;
        }
        $public_key = base64_decode(self::WOOVI_WEBHOOK_PUBLIC_KEY_BASE64, true);
        $decoded = base64_decode(trim($signature), true);
        if (!is_string($public_key) || !is_string($decoded)) return false;
        return openssl_verify(
            $raw_body,
            $decoded,
            $public_key,
            OPENSSL_ALGO_SHA256
        ) === 1;
    }

    /**
     * For notification-only providers, return the remote object obtained with
     * the connection credential. Signed full-object providers may reuse body.
     *
     * @param array<string,string> $credentials
     * @param array<string,mixed> $payload
     * @return array<string,mixed>|WP_Error
     */
    private function authoritative_webhook_object(
        array $connection,
        array $credentials,
        string $provider,
        array $payload
    ): array|WP_Error {
        if (in_array($provider, ['hotmart', 'ticto'], true)) {
            // These providers authenticate the complete lifecycle payload with
            // a per-connection secret (Hottok or Ticto v2 token).
            return $payload;
        }
        if ($provider === 'stripe') {
            $type = (string) ($payload['type'] ?? '');
            if (str_starts_with($type, 'invoice.')) {
                $invoice_object = is_array($payload['data']['object'] ?? null)
                    ? $payload['data']['object']
                    : [];
                $invoice_id = self::external_id($invoice_object['id'] ?? '');
                if ($invoice_id === '') return $this->invalid_provider_event();
                $invoice = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v1/invoices/' . rawurlencode($invoice_id),
                    [],
                    false,
                    '',
                    ['expand[]' => 'payments.data.payment.payment_intent']
                );
                if (is_wp_error($invoice)) return $invoice;
                $payload['data']['object'] = $invoice;
            }
            if (
                str_starts_with($type, 'charge.dispute.')
                || $type === 'charge.refunded'
            ) {
                $event_object = is_array($payload['data']['object'] ?? null)
                    ? $payload['data']['object']
                    : [];
                $is_dispute = str_starts_with($type, 'charge.dispute.');
                $charge_id = self::external_id(
                    $is_dispute
                        ? ($event_object['charge'] ?? '')
                        : ($event_object['id'] ?? '')
                );
                if ($charge_id === '') return $this->invalid_provider_event();
                $charge = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v1/charges/' . rawurlencode($charge_id)
                );
                if (is_wp_error($charge)) return $charge;
                if ($is_dispute) {
                    $charge['_kodety_dispute_status'] = (string) ($event_object['status'] ?? '');
                    $charge['_kodety_dispute_id'] = (string) ($event_object['id'] ?? '');
                }
                $invoice_id = self::external_id($charge['invoice'] ?? '');
                if ($invoice_id === '') {
                    $payment_intent = self::external_id(
                        is_array($charge['payment_intent'] ?? null)
                            ? ($charge['payment_intent']['id'] ?? '')
                            : ($charge['payment_intent'] ?? '')
                    );
                    if ($payment_intent !== '') {
                        $invoice_payments = $this->provider_request(
                            $connection,
                            $credentials,
                            'GET',
                            '/v1/invoice_payments',
                            [],
                            false,
                            '',
                            [
                                'payment[type]' => 'payment_intent',
                                'payment[payment_intent]' => $payment_intent,
                                'limit' => '1',
                            ]
                        );
                        if (is_wp_error($invoice_payments)) return $invoice_payments;
                        $invoice_value = $invoice_payments['data'][0]['invoice'] ?? '';
                        $invoice_id = self::external_id(
                            is_array($invoice_value)
                                ? ($invoice_value['id'] ?? '')
                                : $invoice_value
                        );
                    }
                }
                if ($invoice_id !== '') {
                    $invoice = $this->provider_request(
                        $connection,
                        $credentials,
                        'GET',
                        '/v1/invoices/' . rawurlencode($invoice_id)
                    );
                    if (!is_wp_error($invoice)) {
                        $charge['_kodety_subscription'] = self::external_id(
                            $invoice['subscription']
                            ?? $invoice['parent']['subscription_details']['subscription']
                            ?? ''
                        );
                        $charge['_kodety_invoice_payment_intent'] =
                            self::stripe_invoice_payment_intent_id($invoice);
                    }
                }
                $payload['data']['object'] = $charge;
            }
            return $payload;
        }
        if ($provider === 'pagbank') {
            if (self::is_pagbank_legacy_notification($payload)) {
                return $this->pagbank_legacy_transaction(
                    $connection,
                    $credentials,
                    (string) ($payload['notificationCode'] ?? '')
                );
            }
            return $payload;
        }
        if ($provider === 'mercado_pago') {
            $data = is_array($payload['data'] ?? null) ? $payload['data'] : [];
            $type = sanitize_key((string) ($payload['type'] ?? 'payment'));
            $id = self::external_id($data['id'] ?? '');
            if (str_contains($type, 'chargeback')) {
                $payment_id = self::external_id($data['payment_id'] ?? '');
                if ($payment_id === '' && $id !== '') {
                    $chargeback = $this->provider_request(
                        $connection,
                        $credentials,
                        'GET',
                        '/v1/chargebacks/' . rawurlencode($id)
                    );
                    if (is_wp_error($chargeback)) return $chargeback;
                    $payment_id = self::external_id(
                        $chargeback['payment_id']
                        ?? $chargeback['payments'][0]['id']
                        ?? ''
                    );
                }
                if ($payment_id === '') return $this->invalid_provider_event();
                return $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v1/payments/' . rawurlencode($payment_id)
                );
            }
            if ($id === '') return $this->invalid_provider_event();
            $path = in_array($type, ['subscription_preapproval', 'preapproval'], true)
                ? '/preapproval/' . rawurlencode($id)
                : '/v1/payments/' . rawurlencode($id);
            return $this->provider_request($connection, $credentials, 'GET', $path);
        }
        if ($provider === 'asaas') {
            $event_type = strtoupper((string) ($payload['event'] ?? ''));
            if (str_starts_with($event_type, 'CHECKOUT_')) {
                if ($event_type === 'CHECKOUT_PAID') {
                    $checkout = is_array($payload['checkout'] ?? null)
                        ? $payload['checkout']
                        : $payload;
                    $checkout_id = self::external_id($checkout['id'] ?? '');
                    if ($checkout_id === '') return $this->invalid_provider_event();
                    $payments = $this->provider_request(
                        $connection,
                        $credentials,
                        'GET',
                        '/v3/payments',
                        [],
                        false,
                        '',
                        [
                            'checkoutSession' => $checkout_id,
                            'limit' => '20',
                        ]
                    );
                    if (is_wp_error($payments)) return $payments;
                    $rows = array_values(array_filter(
                        (array) ($payments['data'] ?? []),
                        'is_array'
                    ));
                    usort($rows, static function (array $left, array $right): int {
                        $left_time = strtotime((string) (
                            $left['dueDate'] ?? $left['dateCreated'] ?? ''
                        )) ?: 0;
                        $right_time = strtotime((string) (
                            $right['dueDate'] ?? $right['dateCreated'] ?? ''
                        )) ?: 0;
                        return $right_time <=> $left_time;
                    });
                    $payment = $rows[0] ?? null;
                    $status = strtoupper((string) (
                        is_array($payment) ? ($payment['status'] ?? '') : ''
                    ));
                    if (
                        !is_array($payment)
                        || !in_array(
                            $status,
                            ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'],
                            true
                        )
                    ) {
                        return new WP_Error(
                            'kodety_checkout_provider_eventual_consistency',
                            'A confirmação financeira ainda não está disponível.',
                            ['status' => 503]
                        );
                    }
                    $payment['_kodety_event_type'] = $status === 'CONFIRMED'
                        ? 'PAYMENT_CONFIRMED'
                        : 'PAYMENT_RECEIVED';
                    return $payment;
                }
                // Non-financial checkout lifecycle can be projected directly
                // from the token-authenticated envelope.
                return $payload;
            }
            if (str_starts_with($event_type, 'SUBSCRIPTION_')) {
                $object = is_array($payload['subscription'] ?? null)
                    ? $payload['subscription']
                    : [];
                $id = self::external_id($object['id'] ?? '');
                if ($id === '') return $this->invalid_provider_event();
                return $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v3/subscriptions/' . rawurlencode($id)
                );
            }
            $object = is_array($payload['payment'] ?? null) ? $payload['payment'] : [];
            $id = self::external_id($object['id'] ?? '');
            if ($id === '') return $this->invalid_provider_event();
            $payment = $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v3/payments/' . rawurlencode($id)
            );
            if (is_wp_error($payment)) return $payment;
            $customer_id = self::external_id($payment['customer'] ?? '');
            if ($customer_id !== '') {
                $customer = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/v3/customers/' . rawurlencode($customer_id)
                );
                if (!is_wp_error($customer)) {
                    $payment['customerData'] = [
                        'email' => sanitize_email((string) ($customer['email'] ?? '')),
                    ];
                }
            }
            return $payment;
        }
        if ($provider === 'pagarme') {
            $data = is_array($payload['data'] ?? null) ? $payload['data'] : $payload;
            $event_type = strtolower((string) ($payload['type'] ?? ''));
            if ($event_type === 'chargeback.received') {
                $dispute_id = self::external_id(
                    $data['disputeId']
                    ?? $data['dispute_id']
                    ?? $data['id']
                    ?? ''
                );
                if ($dispute_id === '') return $this->invalid_provider_event();
                $dispute = $this->pagarme_dispute_request(
                    $connection,
                    $credentials,
                    $dispute_id
                );
                if (is_wp_error($dispute)) return $dispute;
                $charge_id = self::external_id(
                    $dispute['chargeId']
                    ?? $dispute['charge_id']
                    ?? ''
                );
                if ($charge_id === '') return $this->invalid_provider_event();
                $charge = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/core/v5/charges/' . rawurlencode($charge_id)
                );
                if (is_wp_error($charge)) return $charge;
                $charge['_kodety_dispute_status'] = (string) (
                    $dispute['status'] ?? 'RECEIVED'
                );
                return $charge;
            }
            $id = self::external_id($data['id'] ?? $data['code'] ?? '');
            if ($id === '') return $this->invalid_provider_event();
            $resource = str_starts_with($event_type, 'charge.')
                ? 'charges'
                : (str_starts_with($event_type, 'order.')
                    ? 'orders'
                    : (str_contains($event_type, 'subscription')
                        ? 'subscriptions'
                        : (str_contains($event_type, 'invoice') ? 'invoices' : 'orders')));
            return $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/core/v5/' . $resource . '/' . rawurlencode($id)
            );
        }
        if ($provider === 'woovi') {
            $event_type = strtoupper((string) ($payload['event'] ?? ''));
            if (str_contains($event_type, 'DISPUTE')) {
                $end_to_end = self::external_id(
                    $payload['dispute']['endToEndId']
                    ?? $payload['dispute']['endToEndID']
                    ?? ''
                );
                if ($end_to_end === '') return $this->invalid_provider_event();
                $transaction = $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/api/v1/transaction/' . rawurlencode($end_to_end)
                );
                if (is_wp_error($transaction)) return $transaction;
                $transaction_object = is_array($transaction['transaction'] ?? null)
                    ? $transaction['transaction']
                    : $transaction;
                $charge_id = self::external_id(
                    $transaction_object['charge']['correlationID']
                    ?? $transaction_object['charge']['identifier']
                    ?? $transaction_object['correlationID']
                    ?? ''
                );
                if ($charge_id === '') return $this->invalid_provider_event();
                return $this->provider_request(
                    $connection,
                    $credentials,
                    'GET',
                    '/api/v1/charge/' . rawurlencode($charge_id)
                );
            }
            $charge = is_array($payload['charge'] ?? null) ? $payload['charge'] : $payload;
            $id = self::external_id(
                $charge['correlationID'] ?? $charge['identifier'] ?? ''
            );
            if ($id === '') return $this->invalid_provider_event();
            return $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/api/v1/charge/' . rawurlencode($id)
            );
        }
        if ($provider === 'iugu') {
            $event_type = strtolower((string) ($payload['event'] ?? ''));
            $data = is_array($payload['data'] ?? null) ? $payload['data'] : $payload;
            $id = self::external_id(
                $data['id'] ?? $data['invoice_id'] ?? $data['subscription_id'] ?? ''
            );
            if ($id === '') return $this->invalid_provider_event();
            $resource = str_contains($event_type, 'subscription') ? 'subscriptions' : 'invoices';
            return $this->provider_request(
                $connection,
                $credentials,
                'GET',
                '/v1/' . $resource . '/' . rawurlencode($id)
            );
        }
        return $this->invalid_provider_event();
    }

    /**
     * @param array<string,mixed> $notification
     * @param array<string,mixed> $authoritative
     * @return array<string,mixed>|WP_Error
     */
    private function normalize_provider_event(
        string $provider,
        array $notification,
        array $authoritative,
        string $payload_hash
    ): array|WP_Error {
        $event = match ($provider) {
            'stripe' => $this->normalize_stripe_event($authoritative),
            'mercado_pago' => $this->normalize_mercado_pago_event($notification, $authoritative),
            'asaas' => $this->normalize_asaas_event($notification, $authoritative),
            'pagbank' => $this->normalize_pagbank_event($authoritative),
            'pagarme' => $this->normalize_pagarme_event($notification, $authoritative),
            'woovi' => $this->normalize_woovi_event($notification, $authoritative),
            'iugu' => $this->normalize_iugu_event($notification, $authoritative),
            'hotmart' => $this->normalize_hotmart_event($notification, $authoritative),
            'ticto' => $this->normalize_ticto_event($notification, $authoritative),
            default => [],
        };
        if (!$event || ($event['eventType'] ?? '') === '') return $this->invalid_provider_event();
        foreach ([
            'localReference',
            'externalSaleId',
            'externalCustomerId',
            'externalContractId',
            'externalProductId',
        ] as $field) {
            $event[$field] = self::external_id($event[$field] ?? '');
        }
        $event['status'] = self::sale_status($event['status'] ?? 'pending', 'pending');
        $event['subscriptionStatus'] = self::subscription_status(
            $event['subscriptionStatus'] ?? ''
        );
        $event['currency'] = self::currency($event['currency'] ?? 'BRL');
        $event['amount'] = isset($event['amount']) && is_numeric($event['amount'])
            ? max(0, (int) $event['amount'])
            : null;
        $event['customerEmail'] = sanitize_email((string) ($event['customerEmail'] ?? ''));
        $event['occurredAt'] = self::date_to_mysql($event['occurredAt'] ?? null);
        $event['providerUpdatedAt'] = self::date_to_mysql(
            $event['providerUpdatedAt'] ?? $event['occurredAt'] ?? null
        );
        $explicit_id = self::external_id($event['externalEventId'] ?? '');
        if ($explicit_id === '') {
            $explicit_id = substr(hash('sha256', implode('|', [
                $provider,
                (string) ($event['externalSaleId'] ?: $event['externalContractId']),
                (string) $event['eventType'],
                (string) $event['status'],
                (string) ($event['subscriptionStatus'] ?? ''),
                (string) ($event['providerUpdatedAt'] ?? ''),
                $payload_hash,
            ])), 0, 64);
        }
        $event['externalEventId'] = $explicit_id;
        return $event;
    }

    /** @param array<string,mixed> $invoice */
    private static function stripe_invoice_payment_intent_id(array $invoice): string {
        $legacy = self::external_id(
            is_array($invoice['payment_intent'] ?? null)
                ? ($invoice['payment_intent']['id'] ?? '')
                : ($invoice['payment_intent'] ?? '')
        );
        if ($legacy !== '') return $legacy;
        foreach ((array) ($invoice['payments']['data'] ?? []) as $invoice_payment) {
            if (!is_array($invoice_payment)) continue;
            $payment = is_array($invoice_payment['payment'] ?? null)
                ? $invoice_payment['payment']
                : [];
            $value = $payment['payment_intent']
                ?? $invoice_payment['payment_intent']
                ?? '';
            $id = self::external_id(is_array($value) ? ($value['id'] ?? '') : $value);
            if ($id !== '') return $id;
        }
        return '';
    }

    /** @return array<string,mixed> */
    private function normalize_stripe_event(array $payload): array {
        $type = (string) ($payload['type'] ?? '');
        $object = is_array($payload['data']['object'] ?? null)
            ? $payload['data']['object']
            : [];
        $metadata = is_array($object['metadata'] ?? null) ? $object['metadata'] : [];
        $reference = (string) (
            $object['client_reference_id']
            ?? $metadata['kodety_reference']
            ?? $object['subscription_details']['metadata']['kodety_reference']
            ?? $object['parent']['subscription_details']['metadata']['kodety_reference']
            ?? ''
        );
        $subscription = self::external_id(
            is_array($object['subscription'] ?? null)
                ? ($object['subscription']['id'] ?? '')
                : (
                    $object['subscription']
                    ?? $object['parent']['subscription_details']['subscription']
                    ?? $object['_kodety_subscription']
                    ?? (str_starts_with($type, 'customer.subscription.') ? ($object['id'] ?? '') : '')
                )
        );
        $invoice_payment_intent = str_starts_with($type, 'invoice.')
            ? self::stripe_invoice_payment_intent_id($object)
            : '';
        $object_payment_intent = self::external_id(
            is_array($object['payment_intent'] ?? null)
                ? ($object['payment_intent']['id'] ?? '')
                : ($object['payment_intent'] ?? '')
        );
        $status = 'pending';
        $subscription_status = '';
        if (
            in_array($type, [
                'checkout.session.completed',
                'checkout.session.async_payment_succeeded',
            ], true)
            && in_array((string) ($object['payment_status'] ?? ''), ['paid', 'no_payment_required'], true)
        ) {
            $status = ($object['mode'] ?? '') === 'subscription' ? 'pending' : 'paid';
            if (($object['mode'] ?? '') === 'subscription' && $subscription !== '') {
                // Persist the provider contract locator, but do not grant
                // membership until a positive paid invoice is authoritative.
                $subscription_status = 'pending';
            }
        } elseif ($type === 'checkout.session.async_payment_failed') {
            $status = 'failed';
        } elseif ($type === 'charge.refunded') {
            $amount = (int) ($object['amount'] ?? 0);
            $refunded = (int) ($object['amount_refunded'] ?? 0);
            $status = $amount > 0 && $refunded >= $amount ? 'refunded' : 'paid';
        } elseif ($type === 'refund.created') {
            // Refund objects may represent a partial refund. Wait for the
            // authoritative charge.refunded aggregate before revoking access.
            $status = 'pending';
        } elseif (in_array($type, [
            'charge.dispute.created',
            'charge.dispute.funds_withdrawn',
        ], true)) {
            $status = 'chargeback';
        } elseif (
            $type === 'charge.dispute.funds_reinstated'
            || (
                $type === 'charge.dispute.closed'
                && strtolower((string) (
                    $object['_kodety_dispute_status'] ?? $object['status'] ?? ''
                )) === 'won'
            )
        ) {
            $status = 'paid';
        } elseif (
            $type === 'charge.dispute.closed'
            && strtolower((string) (
                $object['_kodety_dispute_status'] ?? $object['status'] ?? ''
            )) === 'lost'
        ) {
            $status = 'chargeback';
        } elseif ($type === 'checkout.session.expired') {
            $status = 'expired';
        } elseif (in_array($type, ['invoice.paid', 'invoice.payment_succeeded'], true)) {
            $status = 'paid';
            $subscription_status = 'active';
        } elseif (in_array($type, ['invoice.payment_failed', 'invoice.payment_action_required'], true)) {
            $status = 'pending';
            $subscription_status = 'past_due';
        } elseif (in_array($type, [
            'invoice.finalization_failed',
            'invoice.marked_uncollectible',
            'invoice.voided',
        ], true)) {
            // Stripe can leave the subscription itself active while the
            // current invoice cannot be collected. Membership is fail-closed
            // until a later paid invoice restores the contract.
            $status = 'pending';
            $subscription_status = 'past_due';
        } elseif (str_starts_with($type, 'customer.subscription.')) {
            $subscription_status = self::subscription_status($object['status'] ?? '');
            $status = in_array($subscription_status, self::ACTIVE_SUBSCRIPTION_STATUSES, true)
                ? 'paid'
                : ($subscription_status === 'canceled' ? 'canceled' : 'pending');
        }
        if (str_starts_with($type, 'charge.dispute.') && $subscription !== '') {
            $subscription_status = $status === 'chargeback' ? 'past_due' : (
                $status === 'paid' ? 'active' : ''
            );
        }
        if ($type === 'charge.refunded' && $subscription !== '') {
            $subscription_status = $status === 'refunded' ? 'canceled' : 'active';
        }
        $period_start = $object['current_period_start']
            ?? $object['lines']['data'][0]['period']['start']
            ?? null;
        $period_end = $object['current_period_end']
            ?? $object['lines']['data'][0]['period']['end']
            ?? null;
        return [
            'externalEventId' => $payload['id'] ?? '',
            'eventType' => $type,
            'localReference' => $reference,
            'externalSaleId' => $object_payment_intent !== ''
                ? $object_payment_intent
                : ($invoice_payment_intent !== ''
                    ? $invoice_payment_intent
                    : ($object['_kodety_invoice_payment_intent']
                        ?? $object['charge']
                        ?? ($type === 'checkout.session.completed'
                            ? ($object['id'] ?? '')
                            : ''))),
            'externalCustomerId' => $object['customer'] ?? '',
            'externalContractId' => (
                str_contains($type, 'subscription')
                || str_starts_with($type, 'invoice.')
                || (($object['mode'] ?? '') === 'subscription')
            )
                ? $subscription
                : '',
            'externalProductId' => '',
            'status' => $status,
            'subscriptionStatus' => $subscription_status,
            'amount' => $object['amount_total'] ?? $object['amount_paid'] ?? $object['amount'] ?? null,
            'currency' => $object['currency'] ?? 'BRL',
            'customerEmail' => $object['customer_details']['email']
                ?? $object['customer_email']
                ?? $object['receipt_email']
                ?? '',
            'occurredAt' => $payload['created'] ?? null,
            'providerUpdatedAt' => $payload['created'] ?? null,
            'currentPeriodStart' => $period_start,
            'currentPeriodEnd' => $period_end,
            'trialEndsAt' => $object['trial_end'] ?? null,
            'canceledAt' => $object['canceled_at'] ?? null,
            'endedAt' => $object['ended_at'] ?? null,
            'allowTerminalReversal' => $status === 'paid'
                && (
                    $type === 'charge.dispute.funds_reinstated'
                    || $type === 'charge.dispute.closed'
                ),
            'financiallyConfirmed' => in_array($type, [
                    'invoice.paid',
                    'invoice.payment_succeeded',
                    'charge.dispute.funds_reinstated',
                ], true)
                || (
                    $type === 'charge.dispute.closed'
                    && strtolower((string) (
                        $object['_kodety_dispute_status'] ?? $object['status'] ?? ''
                    )) === 'won'
                ),
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_mercado_pago_event(
        array $notification,
        array $object
    ): array {
        $type = (string) ($notification['type'] ?? 'payment');
        $status = strtolower((string) ($object['status'] ?? ''));
        $sale_status = str_contains(strtolower($type), 'chargeback')
            ? 'chargeback'
            : match ($status) {
            'approved' => 'paid',
            'refunded' => 'refunded',
            'charged_back' => 'chargeback',
            'cancelled', 'canceled' => 'canceled',
            'rejected' => 'failed',
            default => 'pending',
            };
        $is_subscription = str_contains($type, 'preapproval');
        return [
            'externalEventId' => $notification['id'] ?? '',
            'eventType' => (string) ($notification['action'] ?? $type),
            'localReference' => $object['external_reference'] ?? '',
            'externalSaleId' => $is_subscription ? '' : ($object['id'] ?? ''),
            'externalCustomerId' => $object['payer']['id'] ?? '',
            'externalContractId' => $is_subscription ? ($object['id'] ?? '') : '',
            'externalProductId' => $object['metadata']['external_product_id'] ?? '',
            'status' => $sale_status,
            'subscriptionStatus' => $is_subscription
                ? match ($status) {
                    'authorized' => 'active',
                    'paused' => 'paused',
                    'cancelled', 'canceled' => 'canceled',
                    default => 'pending',
                }
                : '',
            'amount' => isset($object['transaction_amount'])
                ? (int) round(((float) $object['transaction_amount']) * 100)
                : null,
            'currency' => $object['currency_id'] ?? 'BRL',
            'customerEmail' => $object['payer']['email'] ?? '',
            'occurredAt' => $notification['date_created'] ?? $object['date_created'] ?? null,
            'providerUpdatedAt' => $object['date_last_updated'] ?? $object['last_modified'] ?? null,
            'currentPeriodStart' => $object['date_created'] ?? null,
            'currentPeriodEnd' => $object['next_payment_date'] ?? null,
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_asaas_event(array $payload, array $authoritative): array {
        $type = strtoupper((string) (
            $authoritative['_kodety_event_type']
            ?? $payload['event']
            ?? ''
        ));
        $is_subscription = str_starts_with($type, 'SUBSCRIPTION_');
        $is_checkout = str_starts_with($type, 'CHECKOUT_');
        $object = $is_checkout
            ? (is_array($payload['checkout'] ?? null) ? $payload['checkout'] : $payload)
            : $authoritative;
        $subscription_id = $is_subscription
            ? self::external_id($object['id'] ?? '')
            : self::external_id(
                is_array($object['subscription'] ?? null)
                    ? ($object['subscription']['id'] ?? '')
                    : ($object['subscription'] ?? '')
            );
        $checkout_charge_types = array_map(
            'strtoupper',
            array_map('strval', (array) ($object['chargeTypes'] ?? []))
        );
        $recurrent_checkout_waiting_for_payment = $is_checkout
            && in_array('RECURRENT', $checkout_charge_types, true)
            && $subscription_id === '';
        $status = match (true) {
            $type === 'CHECKOUT_PAID' && !$recurrent_checkout_waiting_for_payment => 'paid',
            in_array($type, ['CHECKOUT_CANCELED', 'CHECKOUT_CANCELLED'], true) => 'canceled',
            $type === 'CHECKOUT_EXPIRED' => 'expired',
            $is_checkout => 'pending',
            str_contains($type, 'REFUND_DENIED') => 'paid',
            $type === 'PAYMENT_RESTORED' => 'paid',
            $type === 'PAYMENT_RECEIVED_IN_CASH_UNDONE' => 'refunded',
            str_contains($type, 'PARTIALLY_REFUNDED') => 'paid',
            str_contains($type, 'REFUNDED') => 'refunded',
            str_contains($type, 'REFUND_REQUESTED'),
            str_contains($type, 'REFUND_IN_PROGRESS') => 'pending',
            str_contains($type, 'CHARGEBACK'), str_contains($type, 'DISPUTE') => 'chargeback',
            str_contains($type, 'DELETED'), str_contains($type, 'CANCEL') => 'canceled',
            in_array($type, ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'], true) => 'paid',
            $is_subscription && in_array(
                strtoupper((string) ($object['status'] ?? '')),
                ['ACTIVE'],
                true
            ) => 'paid',
            str_contains($type, 'OVERDUE'), str_contains($type, 'AWAITING') => 'pending',
            default => strtolower((string) ($object['status'] ?? '')) === 'received' ? 'paid' : 'pending',
        };
        return [
            'externalEventId' => $payload['id'] ?? '',
            'eventType' => $type,
            'localReference' => $object['externalReference'] ?? '',
            'externalSaleId' => $object['id'] ?? '',
            'externalCustomerId' => $object['customer'] ?? '',
            'externalContractId' => $subscription_id,
            'externalProductId' => '',
            'status' => $status,
            'subscriptionStatus' => (
                ($is_subscription || str_starts_with($type, 'PAYMENT_'))
                && $subscription_id !== ''
            )
                ? (
                    str_starts_with($type, 'PAYMENT_')
                        ? match ($status) {
                            'paid' => 'active',
                            'refunded', 'chargeback', 'canceled' => 'canceled',
                            default => str_contains($type, 'OVERDUE')
                                ? 'past_due'
                                : 'pending',
                        }
                        : match (strtoupper((string) ($object['status'] ?? ''))) {
                            'ACTIVE' => 'active',
                            'INACTIVE', 'CANCELED', 'CANCELLED', 'DELETED' => 'canceled',
                            default => ($status === 'canceled' ? 'canceled' : 'pending'),
                        }
                )
                : '',
            'amount' => isset($object['value'])
                ? (int) round(((float) $object['value']) * 100)
                : null,
            'currency' => 'BRL',
            'customerEmail' => $object['customerData']['email']
                ?? $payload['payment']['customerData']['email']
                ?? '',
            'occurredAt' => $payload['dateCreated'] ?? $object['dateCreated'] ?? null,
            'providerUpdatedAt' => $payload['dateCreated']
                ?? $object['confirmedDate']
                ?? $object['paymentDate']
                ?? $object['dateCreated']
                ?? null,
            'currentPeriodStart' => $object['dateCreated'] ?? null,
            'currentPeriodEnd' => $object['dueDate'] ?? null,
            'allowTerminalReversal' => in_array(
                $type,
                [
                    'PAYMENT_CONFIRMED',
                    'PAYMENT_RECEIVED',
                    'PAYMENT_RESTORED',
                    'PAYMENT_REFUND_DENIED',
                ],
                true
            ),
            'financiallyConfirmed' => (
                str_starts_with($type, 'PAYMENT_')
                || $type === 'CHECKOUT_PAID'
            ) && $status === 'paid',
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_pagbank_event(array $payload): array {
        $charge = is_array($payload['charges'][0] ?? null)
            ? $payload['charges'][0]
            : $payload;
        $status = strtoupper((string) ($charge['status'] ?? $payload['status'] ?? ''));
        $sale_status = match ($status) {
            'PAID' => 'paid',
            'CANCELED', 'CANCELLED', 'INACTIVE' => 'canceled',
            'DECLINED' => 'failed',
            'EXPIRED' => 'expired',
            'REFUNDED' => 'refunded',
            'CHARGEBACK' => 'chargeback',
            default => 'pending',
        };
        return [
            'externalEventId' => '',
            'eventType' => 'pagbank.' . strtolower($status ?: 'updated'),
            'localReference' => $payload['reference_id'] ?? $charge['reference_id'] ?? '',
            'externalSaleId' => $charge['id'] ?? $payload['id'] ?? '',
            'externalCustomerId' => '',
            'externalContractId' => '',
            'externalProductId' => $payload['items'][0]['reference_id'] ?? '',
            'status' => $sale_status,
            'subscriptionStatus' => '',
            'amount' => $charge['amount']['value'] ?? null,
            'currency' => $charge['amount']['currency'] ?? 'BRL',
            'customerEmail' => $payload['customer']['email'] ?? '',
            'occurredAt' => $charge['created_at'] ?? $payload['created_at'] ?? null,
            'providerUpdatedAt' => $charge['paid_at']
                ?? $payload['last_event_at']
                ?? $charge['created_at']
                ?? null,
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_pagarme_event(array $notification, array $object): array {
        $type = strtolower((string) ($notification['type'] ?? ''));
        $is_charge = str_starts_with($type, 'charge.')
            || $type === 'chargeback.received';
        $status = strtolower((string) ($object['status'] ?? ''));
        $subscription_id = self::external_id(
            $object['subscription_id']
            ?? $object['subscription']['id']
            ?? $object['invoice']['subscription_id']
            ?? $object['invoice']['subscriptionId']
            ?? $object['invoice']['subscription']['id']
            ?? ''
        );
        $is_invoice = str_contains($type, 'invoice');
        $subscription = str_contains($type, 'subscription')
            || $is_invoice
            || $subscription_id !== ''
            || isset($object['current_cycle'])
            || isset($object['interval']);
        $sale_status = match ($status) {
            'paid', 'active' => 'paid',
            'canceled', 'cancelled', 'closed' => 'canceled',
            'failed' => 'failed',
            'refunded' => 'refunded',
            'chargedback', 'chargeback' => 'chargeback',
            default => 'pending',
        };
        if (
            $sale_status === 'refunded'
            && isset($object['amount'], $object['refunded_amount'])
            && (int) $object['amount'] > 0
            && (int) $object['refunded_amount'] < (int) $object['amount']
        ) {
            $sale_status = 'paid';
        }
        if ($is_charge) {
            $transaction_status = strtolower((string) (
                $object['last_transaction']['status'] ?? ''
            ));
            $sale_status = match (true) {
                str_contains($transaction_status, 'partial') => 'paid',
                in_array($transaction_status, ['chargedback', 'chargeback'], true) => 'chargeback',
                $transaction_status === 'refunded' => 'refunded',
                in_array($transaction_status, ['failed', 'not_authorized'], true) => 'failed',
                default => $sale_status,
            };
        }
        $dispute_status = strtoupper((string) (
            $object['_kodety_dispute_status'] ?? ''
        ));
        if ($type === 'chargeback.received' && $dispute_status !== '') {
            $sale_status = $dispute_status === 'WON' ? 'paid' : 'chargeback';
        }
        return [
            'externalEventId' => $notification['id'] ?? '',
            'eventType' => $type,
            'localReference' => ($is_charge ? ($object['order']['code'] ?? null) : null)
                ?? $object['code']
                ?? $object['order']['code']
                ?? $object['metadata']['kodety_reference']
                ?? '',
            'externalSaleId' => $is_charge
                ? ($object['order']['id'] ?? $object['order_id'] ?? $object['id'] ?? '')
                : ($is_invoice
                    ? ''
                    : ($subscription ? '' : ($object['id'] ?? ''))),
            'externalCustomerId' => $object['customer']['id'] ?? $object['customer_id'] ?? '',
            'externalContractId' => $subscription_id !== ''
                ? $subscription_id
                : ($subscription && !$is_invoice ? ($object['id'] ?? '') : ''),
            'externalProductId' => $object['plan']['id'] ?? $object['plan_id'] ?? '',
            'status' => $sale_status,
            'subscriptionStatus' => $subscription
                ? match ($sale_status) {
                    'chargeback', 'refunded', 'canceled' => 'canceled',
                    'failed' => 'past_due',
                    'paid' => 'active',
                    default => self::subscription_status($status),
                }
                : '',
            'amount' => $object['amount']
                ?? $object['order']['amount']
                ?? $object['items'][0]['amount']
                ?? null,
            'currency' => $object['currency'] ?? $object['order']['currency'] ?? 'BRL',
            'customerEmail' => $object['customer']['email']
                ?? $object['order']['customer']['email']
                ?? '',
            'occurredAt' => $notification['created_at'] ?? $object['created_at'] ?? null,
            'providerUpdatedAt' => $object['updated_at'] ?? $notification['created_at'] ?? null,
            'currentPeriodStart' => $object['current_cycle']['start_at'] ?? null,
            'currentPeriodEnd' => $object['current_cycle']['end_at'] ?? null,
            'canceledAt' => $object['canceled_at'] ?? null,
            'allowTerminalReversal' => $type === 'chargeback.received'
                && $dispute_status === 'WON',
            'financiallyConfirmed' => $subscription
                && $sale_status === 'paid'
                && (
                    str_starts_with($type, 'charge.')
                    || str_starts_with($type, 'order.')
                    || ($is_invoice && !empty($object['_kodety_authoritative_invoice']))
                    || ($type === 'chargeback.received' && $dispute_status === 'WON')
                ),
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_woovi_event(array $notification, array $remote): array {
        $object = is_array($remote['charge'] ?? null) ? $remote['charge'] : $remote;
        $type = (string) ($notification['event'] ?? 'woovi:CHARGE_UPDATED');
        $status = strtoupper((string) ($object['status'] ?? ''));
        $upper_type = strtoupper($type);
        $is_refund = str_contains($upper_type, 'REFUND');
        $partial = rest_sanitize_boolean(
            $notification['pix']['partial']
            ?? $notification['refund']['partial']
            ?? false
        );
        $refund_rejected = str_contains($upper_type, 'REJECTED')
            || str_contains($upper_type, 'CANCELED');
        $is_dispute = str_contains($upper_type, 'DISPUTE');
        $dispute_reversed = $is_dispute
            && (
                str_contains($upper_type, 'REJECTED')
                || str_contains($upper_type, 'CANCELED')
            );
        $sale_status = $is_dispute
            ? ($dispute_reversed ? 'paid' : 'chargeback')
            : ($is_refund
            ? (($partial || $refund_rejected) ? 'paid' : 'refunded')
            : match ($status) {
                'COMPLETED', 'PAID' => 'paid',
                'EXPIRED' => 'expired',
                'REFUNDED' => 'refunded',
                'CANCELED', 'CANCELLED' => 'canceled',
                default => 'pending',
            });
        return [
            'externalEventId' => '',
            'eventType' => $type,
            'localReference' => $object['correlationID'] ?? '',
            'externalSaleId' => $object['identifier'] ?? $object['transactionID'] ?? '',
            'externalCustomerId' => $object['customer']['correlationID'] ?? '',
            'externalContractId' => '',
            'externalProductId' => '',
            'status' => $sale_status,
            'subscriptionStatus' => '',
            'amount' => $object['value'] ?? null,
            'currency' => 'BRL',
            'customerEmail' => $object['customer']['email'] ?? '',
            'occurredAt' => $object['paidAt'] ?? $object['createdAt'] ?? null,
            'providerUpdatedAt' => $object['updatedAt'] ?? $object['paidAt'] ?? null,
            'allowTerminalReversal' => $dispute_reversed,
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_iugu_event(array $notification, array $object): array {
        $type = strtolower((string) ($notification['event'] ?? 'invoice.updated'));
        $status = strtolower((string) ($object['status'] ?? ''));
        $subscription_id = self::external_id(
            $object['subscription_id'] ?? $object['subscription']['id'] ?? ''
        );
        $subscription_object = str_contains($type, 'subscription');
        $subscription = $subscription_object || $subscription_id !== '';
        $reference = (string) ($object['external_reference'] ?? '');
        foreach ((array) ($object['custom_variables'] ?? []) as $variable) {
            if (
                is_array($variable)
                && ($variable['name'] ?? '') === 'kodety_reference'
            ) {
                $reference = (string) ($variable['value'] ?? '');
            }
        }
        $sale_status = match ($status) {
            'paid', 'externally_paid' => 'paid',
            'canceled', 'cancelled' => 'canceled',
            'expired' => 'expired',
            'refunded' => 'refunded',
            'chargeback', 'in_protest' => 'chargeback',
            default => 'pending',
        };
        return [
            'externalEventId' => $notification['id'] ?? '',
            'eventType' => $type,
            'localReference' => $reference,
            'externalSaleId' => $subscription_object ? '' : ($object['id'] ?? ''),
            'externalCustomerId' => $object['customer_id'] ?? '',
            'externalContractId' => $subscription_object
                ? ($object['id'] ?? '')
                : $subscription_id,
            'externalProductId' => $object['plan_identifier'] ?? '',
            'status' => $sale_status,
            'subscriptionStatus' => $subscription
                ? match ($sale_status) {
                    'paid' => 'active',
                    'refunded', 'chargeback', 'canceled' => 'canceled',
                    'expired' => 'expired',
                    default => self::subscription_status($status),
                }
                : '',
            'amount' => $object['total_cents'] ?? $object['price_cents'] ?? null,
            'currency' => $object['currency'] ?? 'BRL',
            'customerEmail' => $object['email'] ?? $object['customer_email'] ?? '',
            'occurredAt' => $notification['created_at'] ?? $object['created_at'] ?? null,
            'providerUpdatedAt' => $object['updated_at'] ?? $object['paid_at'] ?? null,
            'currentPeriodStart' => $object['recent_invoices'][0]['created_at'] ?? null,
            'currentPeriodEnd' => $object['expires_at'] ?? null,
            'canceledAt' => $object['suspended_at'] ?? null,
            'financiallyConfirmed' => $subscription && $sale_status === 'paid',
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_hotmart_event(array $notification, array $object): array {
        $data = is_array($object['data'] ?? null) ? $object['data'] : $object;
        $purchase = is_array($data['purchase'] ?? null) ? $data['purchase'] : [];
        $subscription = is_array($data['subscription'] ?? null)
            ? $data['subscription']
            : [];
        $subscriber = is_array($data['subscriber'] ?? null)
            ? $data['subscriber']
            : (is_array($subscription['subscriber'] ?? null)
                ? $subscription['subscriber']
                : []);
        $buyer = is_array($data['buyer'] ?? null)
            ? $data['buyer']
            : (is_array($purchase['buyer'] ?? null) ? $purchase['buyer'] : []);
        $product = is_array($data['product'] ?? null)
            ? $data['product']
            : (is_array($purchase['product'] ?? null) ? $purchase['product'] : []);
        $offer = is_array($purchase['offer'] ?? null)
            ? $purchase['offer']
            : (is_array($data['plan']['offer'] ?? null) ? $data['plan']['offer'] : []);
        $origin = is_array($purchase['origin'] ?? null)
            ? $purchase['origin']
            : (is_array($purchase['tracking'] ?? null) ? $purchase['tracking'] : []);
        $type = strtoupper((string) ($notification['event'] ?? 'PURCHASE_UPDATED'));
        $provider_status = strtoupper((string) (
            $purchase['status'] ?? $subscription['status'] ?? ''
        ));
        $is_chargeback = str_contains($type, 'CHARGEBACK')
            || str_contains($provider_status, 'CHARGEBACK');
        $is_partial_refund = str_contains($type, 'PARTIAL')
            || str_contains($provider_status, 'PARTIAL');
        $is_refund = !$is_partial_refund && (
            str_contains($type, 'REFUND') || $provider_status === 'REFUNDED'
        );
        $is_canceled = str_contains($type, 'CANCEL')
            || str_contains($provider_status, 'CANCEL')
            || in_array($provider_status, ['INACTIVE', 'CANCELED_BY_CUSTOMER'], true);
        $is_expired = str_contains($type, 'EXPIRED')
            || $provider_status === 'EXPIRED';
        $financially_confirmed = in_array(
            $type,
            ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'],
            true
        ) || in_array($provider_status, ['APPROVED', 'COMPLETE'], true);
        $sale_status = match (true) {
            $is_chargeback => 'chargeback',
            $is_refund => 'refunded',
            $is_canceled => 'canceled',
            $is_expired => 'expired',
            $financially_confirmed => 'paid',
            $is_partial_refund,
            $provider_status === 'ACTIVE' => 'paid',
            str_contains($type, 'DELAYED'),
            str_contains($type, 'OVERDUE'),
            in_array($provider_status, ['BLOCKED', 'NO_FUNDS', 'FAILED'], true) => 'failed',
            default => 'pending',
        };
        $contract_id = self::external_id(
            $subscription['id']
            ?? $subscription['subscription_id']
            ?? $purchase['subscription_id']
            ?? ''
        );
        $subscription_event = $contract_id !== ''
            || str_contains($type, 'SUBSCRIPTION');
        $subscription_status = '';
        if ($subscription_event) {
            $subscription_status = match (true) {
                $is_canceled, $is_refund, $is_chargeback => 'canceled',
                $is_expired => 'expired',
                str_contains($type, 'DELAYED'),
                str_contains($type, 'OVERDUE') => 'past_due',
                str_contains($provider_status, 'TRIAL') => 'trialing',
                $financially_confirmed,
                $provider_status === 'ACTIVE' => 'active',
                default => 'pending',
            };
        }
        $price = is_array($purchase['price'] ?? null) ? $purchase['price'] : [];
        $full_price = is_array($purchase['full_price'] ?? null)
            ? $purchase['full_price']
            : [];
        return [
            'externalEventId' => $notification['id'] ?? '',
            'eventType' => $type,
            'localReference' => $origin['sck']
                ?? $origin['src']
                ?? $purchase['sck']
                ?? $purchase['src']
                ?? '',
            'externalSaleId' => $purchase['transaction']
                ?? $purchase['transaction_id']
                ?? '',
            'externalCustomerId' => $subscriber['code']
                ?? $subscriber['id']
                ?? $buyer['ucode']
                ?? $buyer['code']
                ?? '',
            'externalContractId' => $contract_id,
            // Hosted checkout is configured with the offer code, not only the
            // numeric product id, so prefer it for deterministic mapping.
            'externalProductId' => $offer['code']
                ?? $purchase['offer_code']
                ?? $product['id']
                ?? $product['ucode']
                ?? '',
            'status' => $sale_status,
            'subscriptionStatus' => $subscription_status,
            'amount' => self::decimal_to_cents(
                $price['value'] ?? $full_price['value'] ?? null
            ),
            'currency' => $price['currency_code']
                ?? $price['currency']
                ?? $full_price['currency_code']
                ?? 'BRL',
            'customerEmail' => $buyer['email'] ?? $subscriber['email'] ?? '',
            'occurredAt' => $notification['creation_date']
                ?? $purchase['approved_date']
                ?? $purchase['order_date']
                ?? null,
            'providerUpdatedAt' => $purchase['cancellation_date']
                ?? $purchase['approved_date']
                ?? $notification['creation_date']
                ?? null,
            'currentPeriodStart' => $purchase['approved_date'] ?? null,
            'currentPeriodEnd' => $subscription['date_next_charge']
                ?? $subscription['next_charge_date']
                ?? null,
            'canceledAt' => $subscription['cancellation_date']
                ?? $purchase['cancellation_date']
                ?? null,
            'financiallyConfirmed' => $subscription_event && $financially_confirmed,
        ];
    }

    /** @return array<string,mixed> */
    private function normalize_ticto_event(array $notification, array $object): array {
        $type = strtolower((string) ($notification['status'] ?? 'updated'));
        $order = is_array($object['order'] ?? null) ? $object['order'] : [];
        $item = is_array($object['item'] ?? null) ? $object['item'] : [];
        $subscriptions = array_values(array_filter(
            (array) ($object['subscriptions'] ?? []),
            'is_array'
        ));
        $subscription = $subscriptions[0] ?? [];
        $customer = is_array($object['customer'] ?? null) ? $object['customer'] : [];
        $url_params = is_array($object['url_params'] ?? null)
            ? $object['url_params']
            : [];
        $query_params = is_array($url_params['query_params'] ?? null)
            ? $url_params['query_params']
            : $url_params;
        $tracking = is_array($object['tracking'] ?? null) ? $object['tracking'] : [];
        $sale_status = match ($type) {
            'authorized', 'uncanceled', 'card_exchanged', 'extended' => 'paid',
            'refunded' => 'refunded',
            'chargeback' => 'chargeback',
            'subscription_canceled', 'subscription_cancelled' => 'canceled',
            'all_charges_paid', 'pix_expired' => 'expired',
            'refused' => 'failed',
            'subscription_delayed' => 'failed',
            default => 'pending',
        };
        $subscription_event = $subscription !== []
            || str_starts_with($type, 'subscription_')
            || in_array(
                $type,
                ['trial_started', 'trial_ended', 'uncanceled', 'all_charges_paid'],
                true
            );
        $subscription_status = '';
        if ($subscription_event) {
            $subscription_status = match ($type) {
                'authorized', 'uncanceled', 'card_exchanged', 'extended' => 'active',
                'trial_started' => 'trialing',
                'subscription_delayed' => 'past_due',
                'subscription_canceled', 'subscription_cancelled' => 'canceled',
                'all_charges_paid', 'trial_ended' => 'expired',
                'refunded', 'chargeback' => 'canceled',
                default => 'pending',
            };
        }
        return [
            'externalEventId' => '',
            'eventType' => 'ticto.' . $type,
            'localReference' => $query_params['kdt_ref']
                ?? $query_params['sck']
                ?? $tracking['kdt_ref']
                ?? $tracking['sck']
                ?? '',
            'externalSaleId' => $order['transaction_hash']
                ?? $order['hash']
                ?? $order['id']
                ?? '',
            'externalCustomerId' => $customer['id'] ?? $customer['email'] ?? '',
            'externalContractId' => $subscription['id']
                ?? $subscription['subscription_id']
                ?? '',
            'externalProductId' => $item['offer_code']
                ?? $item['offer_id']
                ?? $item['product_id']
                ?? '',
            'status' => $sale_status,
            'subscriptionStatus' => $subscription_status,
            'amount' => $order['paid_amount'] ?? $order['amount'] ?? null,
            'currency' => $order['currency'] ?? 'BRL',
            'customerEmail' => $customer['email'] ?? '',
            'occurredAt' => $object['status_date']
                ?? $order['paid_at']
                ?? $order['created_at']
                ?? null,
            'providerUpdatedAt' => $object['status_date']
                ?? $subscription['updated_at']
                ?? null,
            'currentPeriodStart' => $subscription['created_at']
                ?? $order['paid_at']
                ?? null,
            'currentPeriodEnd' => $subscription['next_charge']
                ?? $subscription['next_charge_at']
                ?? null,
            'canceledAt' => $subscription['canceled_at'] ?? null,
            'financiallyConfirmed' => $subscription_event && $type === 'authorized',
        ];
    }

    /**
     * @param array<string,mixed> $connection
     * @param array<string,mixed> $event
     * @return array<string,mixed>|WP_Error
     */
    private function project_provider_event(array $connection, array $event): array|WP_Error {
        global $wpdb;
        $sale = $this->resolve_sale_for_event(absint($connection['id']), $event);
        if (is_wp_error($sale)) return $sale;
        if (!$sale) {
            $sale = $this->create_unmatched_sale($connection, $event);
            if (is_wp_error($sale)) return $sale;
        }
        $sale_id = absint($sale['id'] ?? 0);
        $sale_uuid = (string) ($sale['uuid'] ?? '');
        $incoming_time = self::date_to_mysql(
            $event['providerUpdatedAt'] ?? $event['occurredAt'] ?? null
        );
        $stored_time = self::date_to_mysql($sale['provider_updated_at'] ?? null);
        if (
            $stored_time !== null
            && $incoming_time !== null
            && $incoming_time < $stored_time
        ) {
            return ['ignored' => true, 'saleId' => $sale_uuid, 'reason' => 'out_of_order'];
        }
        $stored_status = self::sale_status($sale['status'] ?? 'pending', 'pending');
        $incoming_status = self::sale_status($event['status'] ?? 'pending', 'pending');
        $mode = (string) ($sale['mapping_mode'] ?? 'payment');
        $stored_external_sale = self::external_id($sale['external_sale_id'] ?? '');
        $incoming_external_sale = self::external_id($event['externalSaleId'] ?? '');
        if (
            $mode === 'subscription'
            && $stored_status !== 'pending'
            && $stored_external_sale !== ''
            && $incoming_external_sale !== ''
            && !hash_equals($stored_external_sale, $incoming_external_sale)
            && empty($event['financiallyConfirmed'])
        ) {
            return [
                'ignored' => true,
                'saleId' => $sale_uuid,
                'reason' => 'non_financial_subscription_artifact',
            ];
        }
        $incoming_subscription_status = self::subscription_status(
            $event['subscriptionStatus'] ?? ''
        );
        $financially_confirmed = !empty($event['financiallyConfirmed']);
        if (
            $mode === 'subscription'
            && in_array(
                $incoming_subscription_status,
                self::ACTIVE_SUBSCRIPTION_STATUSES,
                true
            )
            && !$financially_confirmed
        ) {
            $financially_confirmed = $this->subscription_was_financially_confirmed(
                $connection,
                (string) (
                    $event['externalContractId']
                    ?: $sale['external_contract_id']
                    ?? ''
                )
            );
            if (!$financially_confirmed) {
                $incoming_subscription_status = 'pending';
                $incoming_status = 'pending';
            }
        }
        if (
            $mode === 'payment'
            && in_array($stored_status, self::TERMINAL_SALE_STATUSES, true)
            && $incoming_status === 'paid'
            && empty($event['allowTerminalReversal'])
        ) {
            // A refunded/charged-back one-time sale is immutable. A new
            // purchase must arrive through a new Onun Kodety checkout reference.
            return ['ignored' => true, 'saleId' => $sale_uuid, 'reason' => 'terminal_sale'];
        }
        if (
            $stored_time !== null
            && $incoming_time !== null
            && $incoming_time === $stored_time
            && self::status_precedence($incoming_status) < self::status_precedence($stored_status)
        ) {
            return ['ignored' => true, 'saleId' => $sale_uuid, 'reason' => 'status_precedence'];
        }
        $contract_id = self::external_id(
            $event['externalContractId']
            ?? $sale['external_contract_id']
            ?? ''
        );
        if (
            $mode === 'subscription'
            && $contract_id !== ''
            && $incoming_subscription_status !== ''
            && $this->subscription_event_is_stale(
                $connection,
                $contract_id,
                $incoming_subscription_status,
                $incoming_time
            )
        ) {
            $wpdb->update(self::table('sales'), [
                'access_status' => 'ignored',
                'metadata' => self::json(array_merge(
                    self::decode_json($sale['metadata'] ?? '', []),
                    [
                        'eventType' => (string) $event['eventType'],
                        'ignoredReason' => 'out_of_order_contract',
                    ]
                )),
                'updated_at' => self::now(),
            ], ['id' => $sale_id]);
            return [
                'ignored' => true,
                'saleId' => $sale_uuid,
                'reason' => 'out_of_order_contract',
            ];
        }
        $expected_amount = isset($sale['amount']) ? (int) $sale['amount'] : null;
        $paid_amount = isset($event['amount']) ? (int) $event['amount'] : null;
        $expected_currency = self::currency($sale['currency'] ?? '');
        $paid_currency = self::currency($event['currency'] ?? '');
        if (
            $mode === 'payment'
            && $incoming_status === 'paid'
            && (
                ($expected_amount !== null && ($paid_amount === null || $paid_amount < $expected_amount))
                || (
                    $expected_currency !== ''
                    && $paid_currency !== ''
                    && !hash_equals($expected_currency, $paid_currency)
                )
            )
        ) {
            $wpdb->update(self::table('sales'), [
                'status' => 'paid',
                'access_status' => 'review',
                'external_event_id' => (string) $event['externalEventId'],
                'provider_updated_at' => $incoming_time,
                'metadata' => self::json(array_merge(
                    self::decode_json($sale['metadata'] ?? '', []),
                    [
                    'eventType' => (string) $event['eventType'],
                    'reviewReason' => 'amount_or_currency_mismatch',
                    ]
                )),
                'updated_at' => self::now(),
            ], ['id' => $sale_id]);
            do_action(
                'kodety_checkout_sale_review_required',
                $sale_uuid,
                'amount_or_currency_mismatch'
            );
            return [
                'saleId' => $sale_uuid,
                'accessStatus' => 'review',
                'review' => true,
            ];
        }

        $user_id = absint($sale['user_id'] ?? 0);
        $plan_id = absint($sale['plan_id'] ?? 0);
        $sale_metadata = self::decode_json($sale['metadata'] ?? '', []);
        $provider_customer_email = sanitize_email((string) (
            $event['customerEmail'] ?? ''
        ));
        $customer_email = '';
        $trusted_checkout_identity = false;
        if (!empty($sale_metadata['checkout_email_encrypted'])) {
            $checkout_identity = $this->decrypt_secret(
                (string) $sale_metadata['checkout_email_encrypted']
            );
            if (is_wp_error($checkout_identity)) {
                if ($incoming_status === 'paid') return $checkout_identity;
            } else {
                $candidate_email = sanitize_email((string) (
                    $checkout_identity['email'] ?? ''
                ));
                if (is_email($candidate_email)) {
                    $customer_email = $candidate_email;
                    $trusted_checkout_identity = true;
                    if (
                        $provider_customer_email !== ''
                        && !hash_equals(
                            strtolower($candidate_email),
                            strtolower($provider_customer_email)
                        )
                    ) {
                        $sale_metadata['provider_email_mismatch'] = true;
                        do_action(
                            'kodety_checkout_provider_email_mismatch',
                            $sale_uuid,
                            (string) $connection['provider']
                        );
                    }
                }
            }
        } elseif ($user_id > 0) {
            $local_user = get_user_by('id', $user_id);
            if ($local_user instanceof WP_User) {
                $customer_email = sanitize_email((string) $local_user->user_email);
                $trusted_checkout_identity = $customer_email !== '';
            }
        }
        if (
            $user_id === 0
            && $plan_id > 0
            && $incoming_status === 'paid'
            && $trusted_checkout_identity
            && is_email($customer_email)
            && empty($sale_metadata['identity_deleted'])
        ) {
            $invited = $this->invite_guest_for_sale(
                $sale_id,
                $customer_email
            );
            if (is_wp_error($invited)) return $invited;
            $user_id = $invited;
        }
        if (
            $user_id > 0
            || in_array($incoming_status, self::TERMINAL_SALE_STATUSES, true)
            || in_array($incoming_status, ['failed', 'expired'], true)
        ) {
            unset($sale_metadata['checkout_email_encrypted']);
        }
        $incoming_external_sale = self::external_id($event['externalSaleId'] ?? '');
        $checkout_provider_id = self::external_id(
            $sale_metadata['checkout_provider_id'] ?? ''
        );
        $event_type = strtoupper((string) ($event['eventType'] ?? ''));
        if (
            !empty($sale_metadata['checkout_artifact_type'])
            && $incoming_external_sale !== ''
            && (
                ($checkout_provider_id !== ''
                    && !hash_equals($checkout_provider_id, $incoming_external_sale))
                || !str_contains($event_type, 'CHECKOUT')
            )
        ) {
            unset(
                $sale_metadata['checkout_artifact_type'],
                $sale_metadata['checkout_provider_id']
            );
        }
        $access_status = $user_id > 0 ? 'pending' : 'unmatched';
        $update = [
            'user_id' => $user_id,
            'external_sale_id' => (string) (
                $event['externalSaleId'] ?: ($sale['external_sale_id'] ?? '')
            ),
            'external_customer_id' => (string) (
                $event['externalCustomerId'] ?: ($sale['external_customer_id'] ?? '')
            ),
            'external_contract_id' => (string) (
                $event['externalContractId'] ?: ($sale['external_contract_id'] ?? '')
            ),
            'external_event_id' => (string) $event['externalEventId'],
            'status' => $incoming_status,
            'access_status' => $access_status,
            'amount' => $event['amount'] ?? $sale['amount'] ?? null,
            'currency' => self::currency($event['currency'] ?? $sale['currency'] ?? 'BRL'),
            'customer_email_hash' => $customer_email !== ''
                ? hash_hmac(
                    'sha256',
                    strtolower($customer_email),
                    wp_salt('nonce')
                )
                : (string) ($sale['customer_email_hash'] ?? ''),
            'occurred_at' => self::date_to_mysql($event['occurredAt'] ?? null),
            'provider_updated_at' => $incoming_time,
            'metadata' => self::json(array_merge(
                $sale_metadata,
                [
                    'eventType' => (string) $event['eventType'],
                    'subscriptionStatus' => (string) ($event['subscriptionStatus'] ?? ''),
                    'providerUpdatedAt' => $incoming_time,
                ]
            )),
            'updated_at' => self::now(),
        ];
        if ($update['external_sale_id'] !== '') {
            $update['external_sale_key'] = hash(
                'sha256',
                absint($connection['id']) . '|' . $update['external_sale_id']
            );
        }
        if ($wpdb->update(self::table('sales'), $update, ['id' => $sale_id]) === false) {
            return $this->storage_error('Não foi possível projetar a venda.');
        }
        if ($user_id <= 0 || $plan_id <= 0) {
            return ['saleId' => $sale_uuid, 'unmatched' => true];
        }
        if (!(get_user_by('id', $user_id) instanceof WP_User)) {
            return new WP_Error(
                'kodety_checkout_member_not_found',
                'A venda aponta para um membro inexistente.',
                ['status' => 409]
            );
        }
        $blocked = $this->access_is_blocked($user_id, $plan_id, absint($connection['id']));
        $subscription_status = $incoming_subscription_status;
        if ($subscription_status !== '') {
            $contract_id = (string) (
                $event['externalContractId'] ?: $update['external_contract_id']
            );
            if ($contract_id === '') {
                return new WP_Error(
                    'kodety_checkout_contract_missing',
                    'Evento recorrente sem contrato externo.',
                    ['status' => 409]
                );
            }
            $subscription = Kodety_Members::instance()->upsert_subscription([
                'userId' => $user_id,
                'planId' => $plan_id,
                'provider' => (string) $connection['provider'],
                'providerTenant' => (string) $connection['uuid'],
                'externalCustomerId' => (string) $update['external_customer_id'],
                'externalContractId' => $contract_id,
                'status' => $subscription_status,
                'startedAt' => $event['startedAt']
                    ?? $event['currentPeriodStart']
                    ?? $event['occurredAt']
                    ?? null,
                'trialEndsAt' => $event['trialEndsAt'] ?? null,
                'currentPeriodStart' => $event['currentPeriodStart'] ?? null,
                'currentPeriodEnd' => $event['currentPeriodEnd'] ?? null,
                'graceEndsAt' => $event['graceEndsAt'] ?? null,
                'canceledAt' => $event['canceledAt'] ?? null,
                'endedAt' => $event['endedAt'] ?? null,
                'metadata' => [
                    'checkout_connection_id' => (string) $connection['uuid'],
                    'last_provider_event_id' => (string) $event['externalEventId'],
                    'last_provider_updated_at' => $incoming_time,
                    'provider_status' => $subscription_status,
                    'access_blocked' => $blocked,
                    'financially_confirmed' => $financially_confirmed,
                ],
            ], 0);
            if (is_wp_error($subscription)) return $subscription;
            $access_status = $blocked
                ? 'blocked'
                : (in_array($subscription_status, self::ACTIVE_SUBSCRIPTION_STATUSES, true)
                    ? 'granted'
                    : 'revoked');
        } elseif ($mode === 'payment' && $incoming_status === 'paid') {
            // Keep the financial grant durable even while a local access-only
            // block masks it. Removing the block then restores access without
            // requiring a provider event to be replayed.
            $grant = Kodety_Members::instance()->upsert_grant([
                'userId' => $user_id,
                'targetType' => 'plan',
                'targetId' => $plan_id,
                'source' => 'provider',
                'sourceReference' => $this->provider_grant_reference(
                    $connection,
                    $sale_uuid
                ),
                'reason' => 'Pagamento confirmado pelo provedor.',
            ], 0);
            if (is_wp_error($grant)) return $grant;
            $access_status = $blocked ? 'blocked' : 'granted';
        } elseif (
            $mode === 'payment'
            && in_array($incoming_status, self::TERMINAL_SALE_STATUSES, true)
        ) {
            $revoked = $this->revoke_provider_grant(
                $user_id,
                $plan_id,
                $connection,
                $sale_uuid
            );
            if (is_wp_error($revoked)) return $revoked;
            $access_status = 'revoked';
        } else {
            // Pending/failed financial states never create an entitlement.
            $access_status = 'pending';
        }
        if ($wpdb->update(self::table('sales'), [
            'access_status' => $access_status,
            'updated_at' => self::now(),
        ], ['id' => $sale_id]) === false) {
            return $this->storage_error('A venda foi processada, mas o acesso não pôde ser confirmado.');
        }
        do_action(
            'kodety_checkout_sale_projected',
            $sale_uuid,
            $user_id,
            $plan_id,
            $incoming_status,
            $access_status,
            [
                'amount' => $update['amount'],
                'currency' => $update['currency'],
                'customerEmail' => $customer_email,
                'occurredAt' => $event['occurredAt'] ?? null,
                'provider' => (string) $connection['provider'],
            ]
        );
        return ['saleId' => $sale_uuid, 'accessStatus' => $access_status];
    }

    /** @return array<string,mixed>|null|WP_Error */
    private function resolve_sale_for_event(int $connection_id, array $event): array|WP_Error|null {
        global $wpdb;
        $conditions = [];
        $arguments = [$connection_id];
        foreach ([
            'local_reference' => $event['localReference'] ?? '',
            'external_sale_id' => $event['externalSaleId'] ?? '',
            'external_contract_id' => $event['externalContractId'] ?? '',
        ] as $column => $value) {
            $value = self::external_id($value);
            if ($value === '') continue;
            $conditions[] = "{$column}=%s";
            $arguments[] = $value;
        }
        if (!$conditions) return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT s.*,m.mode AS mapping_mode,m.external_product_id,m.external_price_id
             FROM ' . self::table('sales') . ' s
             LEFT JOIN ' . self::table('mappings') . ' m ON m.id=s.mapping_id
             WHERE s.connection_id=%d AND (' . implode(' OR ', $conditions) . ')
             ORDER BY CASE WHEN s.local_reference=%s THEN 0 ELSE 1 END,s.id DESC LIMIT 1',
            ...[
                ...$arguments,
                self::external_id($event['localReference'] ?? ''),
            ]
        ), ARRAY_A);
        if (!is_array($row)) return null;
        $incoming_sale_id = self::external_id($event['externalSaleId'] ?? '');
        $stored_sale_id = self::external_id($row['external_sale_id'] ?? '');
        if (
            ($row['mapping_mode'] ?? '') === 'subscription'
            && $incoming_sale_id !== ''
            && $stored_sale_id !== ''
            && !hash_equals($stored_sale_id, $incoming_sale_id)
        ) {
            if (empty($event['financiallyConfirmed'])) return $row;
            $source_metadata = self::decode_json($row['metadata'] ?? '', []);
            if (
                ($row['status'] ?? '') === 'pending'
                && empty($source_metadata['renewal'])
            ) {
                // The hosted session is only an attempt artifact. Its first
                // settled invoice/charge becomes the first financial cycle;
                // later distinct financial IDs are cloned as renewals.
                return $row;
            }
            return $this->clone_subscription_sale($row, $event);
        }
        return $row;
    }

    /** @return array<string,mixed>|WP_Error */
    private function clone_subscription_sale(array $source, array $event): array|WP_Error {
        global $wpdb;
        $external_sale_id = self::external_id($event['externalSaleId'] ?? '');
        $existing = $wpdb->get_row($wpdb->prepare(
            'SELECT s.*,m.mode AS mapping_mode
             FROM ' . self::table('sales') . ' s
             LEFT JOIN ' . self::table('mappings') . ' m ON m.id=s.mapping_id
             WHERE s.connection_id=%d AND s.external_sale_id=%s LIMIT 1',
            absint($source['connection_id']),
            $external_sale_id
        ), ARRAY_A);
        if (is_array($existing)) return $existing;
        $now = self::now();
        $row = [
            'uuid' => wp_generate_uuid4(),
            'connection_id' => absint($source['connection_id']),
            'mapping_id' => absint($source['mapping_id']),
            'user_id' => absint($source['user_id']),
            'plan_id' => absint($source['plan_id']),
            'local_reference' => self::opaque_token(),
            'external_sale_id' => $external_sale_id,
            'external_sale_key' => hash(
                'sha256',
                absint($source['connection_id']) . '|' . $external_sale_id
            ),
            'external_customer_id' => self::external_id(
                $event['externalCustomerId'] ?? $source['external_customer_id'] ?? ''
            ),
            'external_contract_id' => self::external_id(
                $event['externalContractId'] ?? $source['external_contract_id'] ?? ''
            ),
            'external_event_id' => self::external_id($event['externalEventId'] ?? ''),
            'status' => 'pending',
            'access_status' => 'pending',
            'amount' => $event['amount'] ?? $source['amount'] ?? null,
            'currency' => self::currency($event['currency'] ?? $source['currency'] ?? 'BRL'),
            'customer_email_hash' => (string) ($source['customer_email_hash'] ?? ''),
            'occurred_at' => self::date_to_mysql($event['occurredAt'] ?? null),
            'provider_updated_at' => self::date_to_mysql($event['providerUpdatedAt'] ?? null),
            'metadata' => self::json(['renewal' => true]),
            'created_at' => $now,
            'updated_at' => $now,
        ];
        if (!$wpdb->insert(self::table('sales'), $row)) {
            $race = $wpdb->get_row($wpdb->prepare(
                'SELECT s.*,m.mode AS mapping_mode
                 FROM ' . self::table('sales') . ' s
                 LEFT JOIN ' . self::table('mappings') . ' m ON m.id=s.mapping_id
                 WHERE s.connection_id=%d AND s.external_sale_id=%s LIMIT 1',
                absint($source['connection_id']),
                $external_sale_id
            ), ARRAY_A);
            if (is_array($race)) return $race;
            return $this->storage_error('Não foi possível registrar a renovação.');
        }
        return array_merge($row, [
            'id' => $wpdb->insert_id,
            'mapping_mode' => 'subscription',
        ]);
    }

    /** @return array<string,mixed>|WP_Error */
    private function create_unmatched_sale(array $connection, array $event): array|WP_Error {
        global $wpdb;
        $mapping = $this->mapping_for_external_event(
            absint($connection['id']),
            (string) ($event['externalProductId'] ?? '')
        );
        $now = self::now();
        $uuid = wp_generate_uuid4();
        $row = [
            'uuid' => $uuid,
            'connection_id' => absint($connection['id']),
            'mapping_id' => absint($mapping['id'] ?? 0),
            'user_id' => 0,
            'plan_id' => absint($mapping['plan_id'] ?? 0),
            'local_reference' => self::opaque_token(),
            'external_sale_id' => (string) ($event['externalSaleId'] ?? ''),
            'external_sale_key' => ($event['externalSaleId'] ?? '') !== ''
                ? hash(
                    'sha256',
                    absint($connection['id']) . '|' . (string) $event['externalSaleId']
                )
                : hash('sha256', absint($connection['id']) . '|unmatched|' . $uuid),
            'external_customer_id' => (string) ($event['externalCustomerId'] ?? ''),
            'external_contract_id' => (string) ($event['externalContractId'] ?? ''),
            'external_event_id' => (string) ($event['externalEventId'] ?? ''),
            'status' => self::sale_status($event['status'] ?? 'unlinked', 'unlinked'),
            'access_status' => 'unmatched',
            'amount' => $event['amount'] ?? null,
            'currency' => self::currency($event['currency'] ?? 'BRL'),
            'customer_email_hash' => ($event['customerEmail'] ?? '') !== ''
                ? hash_hmac('sha256', strtolower((string) $event['customerEmail']), wp_salt('nonce'))
                : '',
            'occurred_at' => self::date_to_mysql($event['occurredAt'] ?? null),
            'provider_updated_at' => self::date_to_mysql($event['providerUpdatedAt'] ?? null),
            'metadata' => self::json([
                'eventType' => (string) ($event['eventType'] ?? ''),
                'unmatched' => true,
            ]),
            'created_at' => $now,
            'updated_at' => $now,
        ];
        if (!$wpdb->insert(self::table('sales'), $row)) {
            return $this->storage_error('Não foi possível registrar a venda não vinculada.');
        }
        return array_merge($row, [
            'id' => $wpdb->insert_id,
            'mapping_mode' => (string) ($mapping['mode'] ?? 'payment'),
        ]);
    }

    /** @return array<string,mixed>|null */
    private function mapping_for_external_event(int $connection_id, string $external_id): ?array {
        global $wpdb;
        $external_id = self::external_id($external_id);
        if ($external_id === '') return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table('mappings') . '
             WHERE connection_id=%d AND status=\'active\'
               AND (external_product_id=%s OR external_price_id=%s)
             ORDER BY id DESC LIMIT 1',
            $connection_id,
            $external_id,
            $external_id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    private function invite_guest_for_sale(int $sale_id, string $email): int|WP_Error {
        global $wpdb;
        $email = sanitize_email($email);
        if (!is_email($email)) return 0;
        // Never bind a financial event to an existing identity by e-mail.
        if (email_exists($email)) return 0;
        $reset_page = $this->member_reset_page_url();
        if (is_wp_error($reset_page)) return $reset_page;
        $local = sanitize_user((string) strstr($email, '@', true), true);
        if ($local === '') $local = 'member';
        $login = $local;
        for ($suffix = 0; username_exists($login); $suffix++) {
            if ($suffix >= 100) {
                return new WP_Error(
                    'kodety_checkout_invite_identity',
                    'Não foi possível criar uma identidade segura para a compra.',
                    ['status' => 500]
                );
            }
            $login = substr($local, 0, 50) . '-' . wp_rand(100000, 999999);
        }
        $role = 'subscriber';
        $settings = Kodety_Members::settings();
        $candidate = sanitize_key((string) ($settings['default_role'] ?? 'subscriber'));
        if (in_array($candidate, ['subscriber', 'customer'], true)) $role = $candidate;
        $role_object = get_role($role);
        if (!$role_object || !$this->role_is_public_member_safe((array) $role_object->capabilities)) {
            return new WP_Error(
                'kodety_checkout_invite_role',
                'A função padrão de membros não é segura.',
                ['status' => 503]
            );
        }
        $user_id = wp_insert_user([
            'user_login' => $login,
            'user_email' => $email,
            'user_pass' => wp_generate_password(32, true, true),
            'display_name' => $local,
            'role' => $role,
        ]);
        if (is_wp_error($user_id)) {
            return new WP_Error(
                'kodety_checkout_invite_failed',
                'Não foi possível criar o membro convidado.',
                ['status' => 500]
            );
        }
        $user_id = absint($user_id);
        update_user_meta($user_id, '_kodety_membership_status', 'invited');
        if ($wpdb->update(self::table('sales'), [
            'user_id' => $user_id,
            'access_status' => 'pending',
            'updated_at' => self::now(),
        ], ['id' => $sale_id]) === false) {
            require_once ABSPATH . 'wp-admin/includes/user.php';
            wp_delete_user($user_id);
            return $this->storage_error('O membro foi criado, mas a venda não pôde ser vinculada.');
        }
        $invited_user = get_user_by('id', $user_id);
        $invited = $invited_user instanceof WP_User
            ? $this->send_member_reset_email($invited_user)
            : new WP_Error(
                'kodety_checkout_invite_identity',
                'Não foi possível preparar o acesso do membro convidado.',
                ['status' => 500]
            );
        if (is_wp_error($invited)) {
            do_action(
                'kodety_checkout_invite_email_failed',
                $user_id,
                $sale_id,
                $invited
            );
        }
        do_action('kodety_checkout_guest_invited', $user_id, $sale_id);
        return $user_id;
    }

    /** @param array<string,bool> $capabilities */
    private function role_is_public_member_safe(array $capabilities): bool {
        foreach ($capabilities as $capability => $granted) {
            if (!$granted) continue;
            if (!in_array((string) $capability, ['read', 'level_0'], true)) return false;
        }
        return true;
    }

    private function provider_grant_reference(array $connection, string $external_id): string {
        return substr(
            'checkout:' . (string) $connection['uuid'] . ':' . self::external_id($external_id),
            0,
            191
        );
    }

    private function subscription_was_financially_confirmed(
        array $connection,
        string $contract_id
    ): bool {
        global $wpdb;
        $contract_id = self::external_id($contract_id);
        if ($contract_id === '') return false;
        $metadata = $wpdb->get_var($wpdb->prepare(
            'SELECT metadata FROM ' . $wpdb->prefix . 'kodety_membership_subscriptions
             WHERE provider=%s AND provider_tenant=%s AND external_contract_id=%s
             LIMIT 1',
            (string) $connection['provider'],
            (string) $connection['uuid'],
            $contract_id
        ));
        $decoded = self::decode_json($metadata, []);
        return !empty(
            $decoded['financially_confirmed']
            ?? $decoded['financiallyconfirmed']
            ?? false
        );
    }

    private function subscription_event_is_stale(
        array $connection,
        string $contract_id,
        string $incoming_status,
        ?string $incoming_time
    ): bool {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT status,metadata FROM ' . $wpdb->prefix
                . 'kodety_membership_subscriptions
             WHERE provider=%s AND provider_tenant=%s AND external_contract_id=%s
             LIMIT 1',
            (string) $connection['provider'],
            (string) $connection['uuid'],
            self::external_id($contract_id)
        ), ARRAY_A);
        if (!is_array($row)) return false;
        $metadata = self::decode_json($row['metadata'] ?? '', []);
        $stored_time = self::date_to_mysql(
            $metadata['last_provider_updated_at']
            ?? $metadata['lastproviderupdatedat']
            ?? null
        );
        $stored_status = self::subscription_status($row['status'] ?? '');
        if ($stored_time !== null && $incoming_time !== null) {
            if ($incoming_time < $stored_time) return true;
            if (
                $incoming_time === $stored_time
                && self::subscription_status_precedence($incoming_status)
                    < self::subscription_status_precedence($stored_status)
            ) {
                return true;
            }
            return false;
        }
        if ($stored_time !== null && $incoming_time === null) {
            return self::subscription_status_precedence($incoming_status)
                <= self::subscription_status_precedence($stored_status);
        }
        return in_array($stored_status, ['canceled', 'expired'], true)
            && !in_array($incoming_status, ['canceled', 'expired'], true);
    }

    private function revoke_provider_grant(
        int $user_id,
        int $plan_id,
        array $connection,
        string $external_id
    ): bool|WP_Error {
        global $wpdb;
        $now = self::now();
        $result = $wpdb->query($wpdb->prepare(
            'UPDATE ' . $wpdb->prefix . "kodety_membership_grants
             SET status='revoked',updated_at=%s,revised_by=0
             WHERE user_id=%d AND plan_id=%d AND source='provider'
               AND source_reference=%s AND status='active'",
            $now,
            $user_id,
            $plan_id,
            $this->provider_grant_reference($connection, $external_id)
        ));
        if ($result === false) {
            return $this->storage_error('Não foi possível revogar o acesso reembolsado.');
        }
        $this->bump_user_revision($user_id);
        do_action('kodety_members_plan_access_invalidated', $plan_id);
        return true;
    }

    /**
     * Execute a request only against a fixed provider origin.
     *
     * @param array<string,mixed> $connection
     * @param array<string,string> $credentials
     * @param array<string,mixed> $body
     * @param array<string,string> $query
     * @return array<string,mixed>|WP_Error
     */
    private function pagbank_legacy_transaction(
        array $connection,
        array $credentials,
        string $notification_code
    ): array|WP_Error {
        $notification_code = trim($notification_code);
        $account_email = sanitize_email((string) ($credentials['accountEmail'] ?? ''));
        $token = trim((string) ($credentials['token'] ?? ''));
        if (
            !preg_match('/^[A-Za-z0-9-]{20,100}$/', $notification_code)
            || !is_email($account_email)
            || $token === ''
        ) {
            return $this->invalid_provider_event();
        }
        $connection_settings = self::decode_json($connection['settings'] ?? '', []);
        $legacy_base = ($connection_settings['environment'] ?? '') === 'sandbox'
            ? 'https://ws.sandbox.pagseguro.uol.com.br'
            : 'https://ws.pagseguro.uol.com.br';
        $url = $legacy_base . '/v3/transactions/notifications/'
            . rawurlencode($notification_code)
            . '?email=' . rawurlencode($account_email)
            . '&token=' . rawurlencode($token);
        $response = wp_safe_remote_request($url, [
            'method' => 'GET',
            'timeout' => 8,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'sslverify' => true,
            'limit_response_size' => 2097152,
            'headers' => [
                'Accept' => 'application/xml,text/xml',
                'User-Agent' => 'Kodety-WordPress/'
                    . (defined('KODETY_VERSION') ? KODETY_VERSION : 'dev'),
            ],
        ]);
        if (is_wp_error($response)) {
            $this->record_connection_error($connection, 'legacy_notification_network');
            return new WP_Error(
                'kodety_checkout_provider_unavailable',
                'O provedor não respondeu.',
                ['status' => 502]
            );
        }
        $status_code = (int) wp_remote_retrieve_response_code($response);
        $raw = (string) wp_remote_retrieve_body($response);
        if (
            $status_code < 200
            || $status_code >= 300
            || $raw === ''
            || strlen($raw) > 2097152
            || !function_exists('simplexml_load_string')
        ) {
            $this->record_connection_error(
                $connection,
                'legacy_notification_http:' . $status_code
            );
            return new WP_Error(
                'kodety_checkout_provider_http',
                'O provedor recusou a consulta da notificação.',
                ['status' => 502, 'providerStatus' => $status_code]
            );
        }
        $xml = @simplexml_load_string(
            $raw,
            SimpleXMLElement::class,
            LIBXML_NONET | LIBXML_NOCDATA | LIBXML_NOBLANKS
        );
        if (!$xml instanceof SimpleXMLElement) {
            return new WP_Error(
                'kodety_checkout_provider_xml',
                'O provedor retornou uma resposta inválida.',
                ['status' => 502]
            );
        }
        $transaction_code = trim((string) ($xml->code ?? ''));
        if ($transaction_code === '') return $this->invalid_provider_event();
        $legacy_status = (int) ($xml->status ?? 0);
        $canonical_status = match ($legacy_status) {
            3, 4 => 'PAID',
            5, 9 => 'CHARGEBACK',
            6, 8 => 'REFUNDED',
            7 => 'CANCELED',
            default => 'PENDING',
        };
        $gross_amount = (string) ($xml->grossAmount ?? '');
        $amount = is_numeric($gross_amount)
            ? max(0, (int) round(((float) $gross_amount) * 100))
            : null;
        return [
            'id' => $transaction_code,
            'reference_id' => trim((string) ($xml->reference ?? '')),
            'status' => $canonical_status,
            'amount' => [
                'value' => $amount,
                'currency' => 'BRL',
            ],
            'customer' => [
                'email' => sanitize_email((string) ($xml->sender->email ?? '')),
            ],
            'created_at' => trim((string) ($xml->date ?? '')),
            'last_event_at' => trim((string) ($xml->lastEventDate ?? '')),
        ];
    }

    private function pagarme_dispute_request(
        array $connection,
        array $credentials,
        string $dispute_id
    ): array|WP_Error {
        $dispute_id = self::external_id($dispute_id);
        if ($dispute_id === '') return $this->invalid_provider_event();
        $settings = self::decode_json($connection['settings'] ?? '', []);
        $base = ($settings['environment'] ?? '') === 'sandbox'
            ? 'https://sandbox.api.stone.com.br'
            : 'https://api.stone.com.br';
        $response = wp_safe_remote_request(
            $base . '/v1/disputes/' . rawurlencode($dispute_id),
            [
                'method' => 'GET',
                'timeout' => 8,
                'redirection' => 0,
                'reject_unsafe_urls' => true,
                'sslverify' => true,
                'limit_response_size' => 2097152,
                'headers' => [
                    'Accept' => 'application/json',
                    'Authorization' => 'Basic ' . base64_encode(
                        (string) ($credentials['secretKey'] ?? '') . ':'
                    ),
                ],
            ]
        );
        if (is_wp_error($response)) {
            $this->record_connection_error($connection, 'dispute_network');
            return new WP_Error(
                'kodety_checkout_provider_unavailable',
                'O provedor não respondeu.',
                ['status' => 502]
            );
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($status < 200 || $status >= 300 || !is_array($decoded)) {
            $this->record_connection_error(
                $connection,
                'dispute_http:' . $status
            );
            return new WP_Error(
                'kodety_checkout_provider_http',
                'O provedor recusou a consulta da disputa.',
                ['status' => 502, 'providerStatus' => $status]
            );
        }
        return $decoded;
    }

    private function hotmart_access_token(
        array $connection,
        array $credentials
    ): string|WP_Error {
        $client_id = trim((string) ($credentials['clientId'] ?? ''));
        $client_secret = trim((string) ($credentials['clientSecret'] ?? ''));
        $basic_token = preg_replace(
            '/^Basic\s+/i',
            '',
            trim((string) ($credentials['basicToken'] ?? ''))
        ) ?: '';
        if ($client_id === '' || $client_secret === '' || $basic_token === '') {
            return new WP_Error(
                'kodety_checkout_credentials_required',
                'Credenciais OAuth da Hotmart incompletas.',
                ['status' => 400]
            );
        }
        $cache_key = 'kodety_hotmart_token_' . substr(hash('sha256', self::json([
            $connection['id'] ?? 0,
            $connection['settings'] ?? '',
            $client_id,
            $client_secret,
            $basic_token,
        ])), 0, 40);
        $cached = get_transient($cache_key);
        if (is_string($cached) && $cached !== '' && strlen($cached) <= 8192) {
            return $cached;
        }
        $url = add_query_arg([
            'grant_type' => 'client_credentials',
            'client_id' => $client_id,
            'client_secret' => $client_secret,
        ], 'https://api-sec-vlc.hotmart.com/security/oauth/token');
        $response = wp_safe_remote_request($url, [
            'method' => 'POST',
            'timeout' => 8,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'headers' => [
                'Accept' => 'application/json',
                'Authorization' => 'Basic ' . $basic_token,
                'Content-Type' => 'application/json',
                'User-Agent' => 'Kodety-WordPress/'
                    . (defined('KODETY_VERSION') ? KODETY_VERSION : 'dev'),
            ],
            'sslverify' => true,
            'limit_response_size' => 262144,
        ]);
        if (is_wp_error($response)) {
            $this->record_connection_error($connection, 'hotmart_oauth_network');
            return new WP_Error(
                'kodety_checkout_provider_unavailable',
                'A Hotmart não respondeu à autenticação.',
                ['status' => 502]
            );
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        $access_token = is_array($decoded)
            ? trim((string) ($decoded['access_token'] ?? ''))
            : '';
        if (
            $status < 200
            || $status >= 300
            || $access_token === ''
            || strlen($access_token) > 8192
        ) {
            $this->record_connection_error(
                $connection,
                'hotmart_oauth_http:' . $status
            );
            return new WP_Error(
                'kodety_checkout_provider_http',
                'A Hotmart recusou as credenciais OAuth.',
                ['status' => 502, 'providerStatus' => $status]
            );
        }
        $expires_in = max(120, min(86400, (int) ($decoded['expires_in'] ?? 3600)));
        set_transient($cache_key, $access_token, max(60, $expires_in - 60));
        return $access_token;
    }

    private function provider_request(
        array $connection,
        array $credentials,
        string $method,
        string $path,
        array $body = [],
        bool $form_encoded = false,
        string $idempotency_key = '',
        array $query = []
    ): array|WP_Error {
        global $wpdb;
        $provider = self::provider_key($connection['provider'] ?? '');
        $base = $this->provider_api_base(
            $provider,
            self::decode_json($connection['settings'] ?? '', [])
        );
        if ($base === '' || !preg_match('#^/[A-Za-z0-9_./?=&%\\[\\]-]*$#', $path)) {
            return new WP_Error(
                'kodety_checkout_provider_endpoint',
                'Endpoint de provedor inválido.',
                ['status' => 500]
            );
        }
        $url = $base . $path;
        if ($query) $url = add_query_arg($query, $url);
        $headers = [
            'Accept' => 'application/json',
            'User-Agent' => 'Kodety-WordPress/' . (defined('KODETY_VERSION') ? KODETY_VERSION : 'dev'),
        ];
        switch ($provider) {
            case 'stripe':
                $headers['Authorization'] = 'Bearer ' . (string) ($credentials['secretKey'] ?? '');
                // Pin the API shape used by invoice-payments reconciliation;
                // webhook normalization remains backward-compatible.
                $headers['Stripe-Version'] = '2025-03-31.basil';
                if (($credentials['accountId'] ?? '') !== '') {
                    $headers['Stripe-Account'] = (string) $credentials['accountId'];
                }
                break;
            case 'mercado_pago':
                $headers['Authorization'] = 'Bearer ' . (string) ($credentials['accessToken'] ?? '');
                break;
            case 'asaas':
                $headers['access_token'] = (string) ($credentials['apiKey'] ?? '');
                break;
            case 'pagbank':
                $headers['Authorization'] = 'Bearer ' . (string) ($credentials['token'] ?? '');
                break;
            case 'pagarme':
                $headers['Authorization'] = 'Basic '
                    . base64_encode((string) ($credentials['secretKey'] ?? '') . ':');
                break;
            case 'woovi':
                $headers['Authorization'] = (string) ($credentials['appId'] ?? '');
                break;
            case 'iugu':
                $headers['Authorization'] = 'Basic '
                    . base64_encode((string) ($credentials['apiToken'] ?? '') . ':');
                break;
            case 'hotmart':
                $access_token = $this->hotmart_access_token(
                    $connection,
                    $credentials
                );
                if (is_wp_error($access_token)) return $access_token;
                $headers['Authorization'] = 'Bearer ' . $access_token;
                break;
            default:
                return new WP_Error(
                    'kodety_checkout_provider',
                    'Provedor inválido.',
                    ['status' => 400]
                );
        }
        if ($idempotency_key !== '') {
            $idempotency_key = substr(
                preg_replace('/[^A-Za-z0-9._-]/', '', $idempotency_key) ?: '',
                0,
                128
            );
            if ($idempotency_key !== '') {
                $header_name = match ($provider) {
                    'mercado_pago' => 'X-Idempotency-Key',
                    'pagbank' => 'x-idempotency-key',
                    default => 'Idempotency-Key',
                };
                $headers[$header_name] = $idempotency_key;
            }
        }
        $arguments = [
            'method' => strtoupper($method),
            'timeout' => 8,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'headers' => $headers,
            'sslverify' => true,
            'limit_response_size' => 2097152,
        ];
        if ($body && strtoupper($method) !== 'GET') {
            if ($form_encoded) {
                $arguments['headers']['Content-Type'] = 'application/x-www-form-urlencoded';
                $arguments['body'] = http_build_query($body, '', '&', PHP_QUERY_RFC3986);
            } else {
                $arguments['headers']['Content-Type'] = 'application/json';
                $arguments['body'] = self::json($body);
            }
        }
        $response = wp_safe_remote_request($url, $arguments);
        if (is_wp_error($response)) {
            $this->record_connection_error(
                $connection,
                'network:' . $response->get_error_code()
            );
            return new WP_Error(
                'kodety_checkout_provider_unavailable',
                'O provedor não respondeu.',
                ['status' => 502]
            );
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        $raw = (string) wp_remote_retrieve_body($response);
        if (strlen($raw) > 2097152) {
            return new WP_Error(
                'kodety_checkout_provider_response_size',
                'Resposta do provedor acima do limite.',
                ['status' => 502]
            );
        }
        $decoded = json_decode($raw, true);
        if ($status < 200 || $status >= 300) {
            $this->record_connection_error($connection, 'http:' . $status);
            return new WP_Error(
                'kodety_checkout_provider_http',
                'O provedor recusou a operação.',
                ['status' => 502, 'providerStatus' => $status]
            );
        }
        if (!is_array($decoded)) {
            $this->record_connection_error($connection, 'invalid_json');
            return new WP_Error(
                'kodety_checkout_provider_json',
                'O provedor retornou uma resposta inválida.',
                ['status' => 502]
            );
        }
        if (absint($connection['id'] ?? 0) > 0) {
            $now = self::now();
            $wpdb->update(self::table('connections'), [
                'status' => !empty($connection['enabled']) ? 'connected' : 'disabled',
                'last_verified_at' => $now,
                'last_error' => '',
                'updated_at' => $now,
            ], ['id' => absint($connection['id'])]);
        }
        return $decoded;
    }

    /** @param array<string,mixed> $settings */
    private function provider_api_base(string $provider, array $settings): string {
        $sandbox = ($settings['environment'] ?? '') === 'sandbox';
        return match ($provider) {
            'stripe' => 'https://api.stripe.com',
            'mercado_pago' => 'https://api.mercadopago.com',
            'asaas' => $sandbox
                ? 'https://api-sandbox.asaas.com'
                : 'https://api.asaas.com',
            'pagbank' => $sandbox
                ? 'https://sandbox.api.pagseguro.com'
                : 'https://api.pagseguro.com',
            'pagarme' => $sandbox
                ? 'https://sdx-api.pagar.me'
                : 'https://api.pagar.me',
            'woovi' => $sandbox
                ? 'https://api.woovi-sandbox.com'
                : 'https://api.woovi.com',
            'iugu' => 'https://api.iugu.com',
            'hotmart' => $sandbox
                ? 'https://sandbox.hotmart.com'
                : 'https://developers.hotmart.com',
            default => '',
        };
    }

    private function record_connection_error(array $connection, string $code): void {
        global $wpdb;
        $id = absint($connection['id'] ?? 0);
        if ($id <= 0) return;
        $wpdb->update(self::table('connections'), [
            'status' => 'error',
            'last_error' => substr(sanitize_text_field($code), 0, 1000),
            'updated_at' => self::now(),
        ], ['id' => $id]);
    }

    /** @return array<string,mixed>|WP_Error */
    private function decrypt_secret(string $encoded): array|WP_Error {
        if ($encoded === '' || !str_starts_with($encoded, 'v1.')) {
            return new WP_Error(
                'kodety_checkout_credentials_unreadable',
                'As credenciais da conexão não podem ser lidas.',
                ['status' => 503]
            );
        }
        if (!function_exists('openssl_decrypt')) {
            return new WP_Error(
                'kodety_checkout_crypto_unavailable',
                'OpenSSL é necessário para usar conexões de checkout.',
                ['status' => 503]
            );
        }
        $packed = self::base64url_decode(substr($encoded, 3));
        if (!is_string($packed) || strlen($packed) < 29) {
            return new WP_Error(
                'kodety_checkout_credentials_unreadable',
                'As credenciais da conexão não podem ser lidas.',
                ['status' => 503]
            );
        }
        $nonce = substr($packed, 0, 12);
        $tag = substr($packed, 12, 16);
        $ciphertext = substr($packed, 28);
        $plaintext = openssl_decrypt(
            $ciphertext,
            'aes-256-gcm',
            self::encryption_key(),
            OPENSSL_RAW_DATA,
            $nonce,
            $tag,
            'kodety-checkouts-v1'
        );
        if (!is_string($plaintext)) {
            return new WP_Error(
                'kodety_checkout_credentials_unreadable',
                'As credenciais da conexão não podem ser lidas.',
                ['status' => 503]
            );
        }
        $decoded = json_decode($plaintext, true);
        if (!is_array($decoded)) {
            return new WP_Error(
                'kodety_checkout_credentials_unreadable',
                'As credenciais da conexão não podem ser lidas.',
                ['status' => 503]
            );
        }
        $output = [];
        foreach ($decoded as $key => $value) {
            if (is_string($key) && is_scalar($value)) $output[$key] = (string) $value;
        }
        return $output;
    }

    /** @param array<string,string> $secret */
    private function encrypt_secret(array $secret): string|WP_Error {
        if (!function_exists('openssl_encrypt')) {
            return new WP_Error(
                'kodety_checkout_crypto_unavailable',
                'OpenSSL é necessário para salvar conexões de checkout.',
                ['status' => 503]
            );
        }
        try {
            $nonce = random_bytes(12);
        } catch (Throwable) {
            return $this->storage_error('Não foi possível gerar material criptográfico.');
        }
        $tag = '';
        $ciphertext = openssl_encrypt(
            self::json($secret),
            'aes-256-gcm',
            self::encryption_key(),
            OPENSSL_RAW_DATA,
            $nonce,
            $tag,
            'kodety-checkouts-v1',
            16
        );
        if (!is_string($ciphertext) || strlen($tag) !== 16) {
            return $this->storage_error('Não foi possível criptografar as credenciais.');
        }
        return 'v1.' . self::base64url_encode($nonce . $tag . $ciphertext);
    }

    private static function encryption_key(): string {
        return hash('sha256', wp_salt('auth') . '|kodety-checkouts-v1', true);
    }

    /** @return array<string,string>|WP_Error */
    private function sanitize_credentials(string $provider, mixed $raw): array|WP_Error {
        if (!is_array($raw)) {
            return new WP_Error(
                'kodety_checkout_credentials',
                'Credenciais inválidas.',
                ['status' => 400]
            );
        }
        $definition = self::PROVIDERS[$provider] ?? null;
        if (!$definition) {
            return new WP_Error('kodety_checkout_provider', 'Provedor inválido.', ['status' => 400]);
        }
        $aliases = [
            'secret_key' => 'secretKey',
            'webhook_secret' => 'webhookSecret',
            'account_id' => 'accountId',
            'account_email' => 'accountEmail',
            'access_token' => 'accessToken',
            'api_key' => 'apiKey',
            'webhook_token' => 'webhookToken',
            'client_id' => 'clientId',
            'client_secret' => 'clientSecret',
            'basic_token' => 'basicToken',
            'hot_tok' => 'hottok',
            'app_id' => 'appId',
            'api_token' => 'apiToken',
        ];
        $allowed = array_flip(array_merge(
            (array) $definition['credentials'],
            (array) $definition['optionalCredentials']
        ));
        $output = [];
        foreach ($raw as $key => $value) {
            $key = (string) $key;
            $key = $aliases[$key] ?? $key;
            if (!isset($allowed[$key]) || !is_scalar($value)) continue;
            $value = trim((string) $value);
            if ($value === '' || str_contains($value, '••••') || $value === '********') continue;
            if (strlen($value) > 8192 || preg_match('/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/', $value)) {
                return new WP_Error(
                    'kodety_checkout_credentials',
                    'Credencial inválida.',
                    ['status' => 400]
                );
            }
            $output[$key] = $value;
        }
        if (
            $provider === 'pagbank'
            && isset($output['accountEmail'])
            && !is_email($output['accountEmail'])
        ) {
            return new WP_Error(
                'kodety_checkout_credentials',
                'O e-mail da conta PagBank é inválido.',
                ['status' => 400, 'field' => 'accountEmail']
            );
        }
        return $output;
    }

    private function validate_required_credentials(
        string $provider,
        array $credentials,
        bool $enabled
    ): bool|WP_Error {
        if (!$enabled) return true;
        foreach ((array) (self::PROVIDERS[$provider]['credentials'] ?? []) as $field) {
            if (trim((string) ($credentials[$field] ?? '')) === '') {
                return new WP_Error(
                    'kodety_checkout_credentials_required',
                    'Preencha todas as credenciais obrigatórias antes de ativar.',
                    ['status' => 400, 'field' => $field]
                );
            }
        }
        return true;
    }

    /** @return array<string,array<string,mixed>> */
    private function redact_credentials(
        string $provider,
        array $credentials,
        bool $include_last4 = false
    ): array {
        $fields = array_merge(
            (array) (self::PROVIDERS[$provider]['credentials'] ?? []),
            (array) (self::PROVIDERS[$provider]['optionalCredentials'] ?? [])
        );
        $output = [];
        foreach ($fields as $field) {
            $value = (string) ($credentials[$field] ?? '');
            $output[$field] = [
                'configured' => $value !== '',
                'last4' => $include_last4 && $value !== '' ? substr($value, -4) : '',
            ];
        }
        return $output;
    }

    /** @return array<string,mixed> */
    private function sanitize_connection_settings(mixed $raw): array {
        if (!is_array($raw)) return ['environment' => 'production'];
        $environment = sanitize_key((string) ($raw['environment'] ?? 'production'));
        if (!in_array($environment, ['production', 'sandbox'], true)) {
            $environment = 'production';
        }
        $output = ['environment' => $environment];
        foreach (['successUrl', 'cancelUrl', 'returnUrl'] as $field) {
            $value = $raw[$field] ?? $raw[self::camel_to_snake($field)] ?? '';
            $url = $this->same_site_return_url($value, '');
            if (!is_wp_error($url) && $url !== '') $output[$field] = $url;
        }
        return $output;
    }

    /** @return array<string,mixed> */
    private function sanitize_mapping_settings(mixed $raw): array {
        if (!is_array($raw)) return [];
        $output = [];
        foreach (['successUrl', 'cancelUrl'] as $field) {
            $value = $raw[$field] ?? $raw[self::camel_to_snake($field)] ?? '';
            $url = $this->same_site_return_url($value, '');
            if (!is_wp_error($url) && $url !== '') $output[$field] = $url;
        }
        $billing_types = [];
        foreach (array_slice((array) ($raw['billingTypes'] ?? []), 0, 4) as $type) {
            $type = strtoupper(sanitize_key((string) $type));
            if (in_array($type, ['PIX', 'CREDIT_CARD'], true)) $billing_types[$type] = $type;
        }
        if ($billing_types) $output['billingTypes'] = array_values($billing_types);
        $cycle = strtoupper(sanitize_key((string) ($raw['cycle'] ?? '')));
        if (in_array($cycle, [
            'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY',
            'QUARTERLY', 'SEMIANNUALLY', 'YEARLY',
        ], true)) {
            $output['cycle'] = $cycle;
        }
        $minutes = absint($raw['minutesToExpire'] ?? $raw['minutes_to_expire'] ?? 0);
        if ($minutes > 0) $output['minutesToExpire'] = max(10, min(1440, $minutes));
        $expires = absint($raw['expiresIn'] ?? $raw['expires_in'] ?? 0);
        if ($expires > 0) $output['expiresIn'] = max(300, min(2592000, $expires));
        $boleto_due_days = absint(
            $raw['boletoDueDays'] ?? $raw['boleto_due_days'] ?? 0
        );
        if ($boleto_due_days > 0) {
            $output['boletoDueDays'] = max(1, min(30, $boleto_due_days));
        }
        $pix_expires = absint(
            $raw['pixExpiresIn'] ?? $raw['pix_expires_in'] ?? 0
        );
        if ($pix_expires > 0) {
            $output['pixExpiresIn'] = max(300, min(2592000, $pix_expires));
        }
        $methods = [];
        foreach (array_slice((array) ($raw['paymentMethods'] ?? []), 0, 5) as $method) {
            $method = sanitize_key((string) $method);
            if (in_array($method, ['credit_card', 'pix', 'boleto'], true)) {
                $methods[$method] = $method;
            }
        }
        if ($methods) $output['paymentMethods'] = array_values($methods);
        return $output;
    }

    private function same_site_return_url(mixed $value, string $fallback): string|WP_Error {
        $value = trim((string) $value);
        if ($value === '') $value = trim($fallback);
        if ($value === '') return '';
        if (str_contains($value, '\\') || preg_match('/[\\r\\n]/', $value)) {
            return new WP_Error(
                'kodety_checkout_return_url',
                'URL de retorno inválida.',
                ['status' => 400]
            );
        }
        if (str_starts_with($value, '/') && !str_starts_with($value, '//')) {
            $value = home_url($value);
        }
        $home = wp_parse_url(home_url('/'));
        $parsed = wp_parse_url($value);
        if (!is_array($home) || !is_array($parsed)) {
            return new WP_Error(
                'kodety_checkout_return_url',
                'URL de retorno inválida.',
                ['status' => 400]
            );
        }
        $home_scheme = strtolower((string) ($home['scheme'] ?? ''));
        $home_host = strtolower((string) ($home['host'] ?? ''));
        $scheme = strtolower((string) ($parsed['scheme'] ?? ''));
        $host = strtolower((string) ($parsed['host'] ?? ''));
        $home_port = absint($home['port'] ?? ($home_scheme === 'https' ? 443 : 80));
        $port = absint($parsed['port'] ?? ($scheme === 'https' ? 443 : 80));
        if (
            !in_array($scheme, ['http', 'https'], true)
            || $scheme !== $home_scheme
            || $host === ''
            || !hash_equals($home_host, $host)
            || $port !== $home_port
            || isset($parsed['user'])
            || isset($parsed['pass'])
        ) {
            return new WP_Error(
                'kodety_checkout_return_url',
                'A URL de retorno deve pertencer a este site.',
                ['status' => 400]
            );
        }
        return esc_url_raw($value, ['http', 'https']);
    }

    private function mapping_setting(array $mapping, string $key, string $fallback): string {
        $settings = self::decode_json($mapping['settings'] ?? '', []);
        $value = (string) ($settings[$key] ?? '');
        if ($value !== '') return $value;
        $connection_settings = self::decode_json(
            $mapping['connection_settings'] ?? '',
            []
        );
        return (string) ($connection_settings[$key] ?? $fallback);
    }

    private function webhook_token(array $connection): string|WP_Error {
        $decoded = $this->decrypt_secret((string) ($connection['webhook_token_encrypted'] ?? ''));
        if (is_wp_error($decoded)) return $decoded;
        $token = (string) ($decoded['token'] ?? '');
        return preg_match('/^[A-Za-z0-9_-]{43}$/', $token)
            ? $token
            : new WP_Error(
                'kodety_checkout_webhook_token',
                'Token de webhook inválido.',
                ['status' => 503]
            );
    }

    private function webhook_url_for_connection(array $connection): string {
        $token = $this->webhook_token($connection);
        if (is_wp_error($token)) return '';
        return rest_url(self::REST_NAMESPACE . '/c/' . rawurlencode($token));
    }

    private function webhook_key_matches(array $connection, string $provided): bool {
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $provided)) return false;
        $expected = strtolower((string) ($connection['webhook_token_hash'] ?? ''));
        return preg_match('/^[a-f0-9]{64}$/', $expected)
            && hash_equals($expected, hash('sha256', $provided));
    }

    /** @return array<string,mixed>|null */
    private function connection_by_webhook_key(string $key): ?array {
        global $wpdb;
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $key)) return null;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . self::table('connections')
                . ' WHERE webhook_token_hash=%s AND status<>\'deleted\' LIMIT 1',
            hash('sha256', $key)
        ), ARRAY_A);
        if (!is_array($row) || !$this->webhook_key_matches($row, $key)) return null;
        return $row;
    }

    private function rate_limit_public(string $fingerprint): bool|WP_Error {
        $key = 'kodety_checkout_buy_' . substr($fingerprint, 0, 48);
        $result = $this->with_lock('buy:' . $fingerprint, function () use ($key): bool {
            $count = max(0, (int) get_transient($key));
            if ($count >= self::PUBLIC_RATE_LIMIT) return false;
            return set_transient($key, $count + 1, self::PUBLIC_RATE_WINDOW);
        });
        if ($result === true) return true;
        return new WP_Error(
            'kodety_checkout_rate_limit',
            'Muitas tentativas. Tente novamente mais tarde.',
            ['status' => 429]
        );
    }

    private function rate_limit_preflight_email(string $email): bool|WP_Error {
        $email = strtolower(sanitize_email($email));
        if ($email === '' || !is_email($email)) {
            return new WP_Error(
                'kodety_checkout_email',
                'E-mail inválido.',
                ['status' => 400]
            );
        }
        $fingerprint = hash_hmac('sha256', $email, wp_salt('nonce'));
        $key = 'kodety_checkout_mail_' . substr($fingerprint, 0, 48);
        $result = $this->with_lock('mail:' . $fingerprint, function () use ($key): bool {
            $count = max(0, (int) get_transient($key));
            if ($count >= self::PREFLIGHT_EMAIL_RATE_LIMIT) return false;
            return set_transient(
                $key,
                $count + 1,
                self::PREFLIGHT_EMAIL_RATE_WINDOW
            );
        });
        if ($result === true) return true;
        return new WP_Error(
            'kodety_checkout_rate_limit',
            'Muitas tentativas. Tente novamente mais tarde.',
            ['status' => 429]
        );
    }

    private function request_ip_hash(): string {
        $ip = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
        return hash_hmac('sha256', $ip, wp_salt('nonce'));
    }

    private function with_lock(string $scope, callable $callback): mixed {
        $directory = trailingslashit(sys_get_temp_dir()) . 'kodety-checkout-locks';
        if (!is_dir($directory) && !wp_mkdir_p($directory)) return false;
        $path = $directory . '/' . hash('sha256', $scope) . '.lock';
        $handle = @fopen($path, 'c');
        if (!is_resource($handle)) return false;
        try {
            if (!flock($handle, LOCK_EX)) return false;
            return $callback();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private function consume_transient_once(string $key): mixed {
        return $this->with_lock('transient:' . $key, static function () use ($key): mixed {
            $value = get_transient($key);
            if ($value === false) return false;
            if (!delete_transient($key)) return false;
            return $value;
        });
    }

    private function can_manage_member(int $user_id): bool {
        if ($user_id <= 0 || !current_user_can('edit_user', $user_id)) return false;
        $user = get_user_by('id', $user_id);
        return $user instanceof WP_User
            && (!user_can($user, 'manage_options') || current_user_can('manage_options'));
    }

    private function manageable_member(int $user_id): WP_User|WP_Error {
        if (!$this->can_manage_member($user_id)) {
            return new WP_Error(
                'kodety_checkout_member_forbidden',
                'Sem permissão para este membro.',
                ['status' => 403]
            );
        }
        $user = get_user_by('id', $user_id);
        return $user instanceof WP_User
            ? $user
            : new WP_Error(
                'kodety_checkout_member_not_found',
                'Membro não encontrado.',
                ['status' => 404]
            );
    }

    private function bump_user_revision(int $user_id): void {
        $revision = max(0, (int) get_user_meta(
            $user_id,
            '_kodety_membership_revision',
            true
        )) + 1;
        update_user_meta($user_id, '_kodety_membership_revision', $revision);
        do_action('kodety_membership_revision_changed', $user_id, $revision);
    }

    /** @return array<string,mixed> */
    private function payload(WP_REST_Request $request): array {
        $raw = $request->get_json_params();
        if (!is_array($raw) || !$raw) $raw = $request->get_params();
        return is_array($raw) ? $raw : [];
    }

    /** @return array{0:int,1:int,2:int} */
    private function pagination(WP_REST_Request $request): array {
        $page = max(1, absint($request->get_param('page') ?: 1));
        $per_page = max(
            1,
            min(self::MAX_PAGE_SIZE, absint($request->get_param('per_page') ?: 25))
        );
        return [$page, $per_page, ($page - 1) * $per_page];
    }

    private function response(mixed $data, int $status = 200): WP_REST_Response {
        $response = new WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'no-store, private');
        return $response;
    }

    private function processing_retry_response(): WP_REST_Response {
        $response = $this->response([
            'received' => false,
            'processing' => true,
            'retry' => true,
        ], 503);
        $response->header('Retry-After', '30');
        return $response;
    }

    private function not_found(string $entity): WP_Error {
        return new WP_Error(
            'kodety_checkout_' . sanitize_key($entity) . '_not_found',
            'Recurso não encontrado.',
            ['status' => 404]
        );
    }

    private function storage_error(string $message): WP_Error {
        return new WP_Error('kodety_checkout_storage', $message, ['status' => 500]);
    }

    private function invalid_provider_event(): WP_Error {
        return new WP_Error(
            'kodety_checkout_event_invalid',
            'Evento financeiro sem identidade suficiente.',
            ['status' => 422]
        );
    }

    private function unsupported_checkout(string $label): WP_Error {
        return new WP_Error(
            'kodety_checkout_not_implemented',
            $label . ' ainda depende do contrato específico do provedor.',
            ['status' => 501]
        );
    }

    private static function now(): string {
        return current_time('mysql', true);
    }

    private static function opaque_token(): string {
        return self::base64url_encode(random_bytes(32));
    }

    private static function base64url_encode(string $value): string {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64url_decode(string $value): string|false {
        if (!preg_match('/^[A-Za-z0-9_-]+$/', $value)) return false;
        $padding = (4 - (strlen($value) % 4)) % 4;
        return base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
    }

    private static function provider_key(mixed $value): string {
        $value = strtolower(trim((string) $value));
        $value = str_replace(['-', ' '], '_', $value);
        $value = preg_replace('/[^a-z0-9_]+/', '', $value) ?: '';
        return substr($value, 0, 32);
    }

    private static function uuid(mixed $value): string {
        $value = strtolower(trim((string) $value));
        return preg_match(
            '/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/',
            $value
        ) ? $value : '';
    }

    private static function external_id(mixed $value): string {
        if (is_array($value)) $value = $value['id'] ?? '';
        if (!is_scalar($value) && $value !== null) return '';
        $value = trim((string) $value);
        $value = preg_replace('/[^A-Za-z0-9._:@-]+/', '', $value) ?: '';
        return substr($value, 0, 191);
    }

    public static function plan_key(mixed $value): string {
        $value = strtolower(trim((string) $value));
        $value = preg_replace('/[^a-z0-9._-]+/', '-', $value) ?: '';
        return substr(trim($value, '._-'), 0, 80);
    }

    private static function checkout_mode(mixed $value): string {
        return sanitize_key((string) $value) === 'subscription'
            ? 'subscription'
            : 'payment';
    }

    private static function mapping_status(mixed $value): string {
        $value = sanitize_key((string) $value);
        return in_array($value, ['active', 'paused', 'archived'], true)
            ? $value
            : 'active';
    }

    private static function sale_status(mixed $value, string $fallback = 'pending'): string {
        $value = sanitize_key((string) $value);
        return in_array($value, self::SALE_STATUSES, true) ? $value : $fallback;
    }

    private static function subscription_status(mixed $value): string {
        $value = sanitize_key((string) $value);
        $aliases = [
            'authorized' => 'active',
            'paid' => 'active',
            'cancelled' => 'canceled',
            'unpaid' => 'past_due',
            'incomplete' => 'pending',
            'incomplete_expired' => 'expired',
        ];
        $value = $aliases[$value] ?? $value;
        return in_array($value, [
            'pending',
            'trialing',
            'active',
            'past_due',
            'paused',
            'canceled',
            'expired',
        ], true) ? $value : '';
    }

    private static function status_precedence(string $status): int {
        return match ($status) {
            'chargeback' => 70,
            'refunded' => 60,
            'canceled' => 50,
            'expired' => 40,
            'paid' => 30,
            'failed' => 20,
            default => 10,
        };
    }

    private static function subscription_status_precedence(string $status): int {
        return match (self::subscription_status($status)) {
            'canceled' => 70,
            'expired' => 60,
            'paused' => 50,
            'past_due' => 40,
            'active' => 30,
            'trialing' => 20,
            default => 10,
        };
    }

    private static function currency(mixed $value): string {
        $value = strtoupper(trim((string) $value));
        return preg_match('/^[A-Z]{3}$/', $value) ? $value : '';
    }

    private static function decimal_to_cents(mixed $value): ?int {
        if (!is_numeric($value)) return null;
        return max(0, (int) round(((float) $value) * 100));
    }

    private static function nullable_amount(mixed $value): int|null|WP_Error {
        if ($value === null || $value === '') return null;
        if (!is_numeric($value) || (float) $value < 0 || (float) $value > PHP_INT_MAX) {
            return new WP_Error(
                'kodety_checkout_amount',
                'Valor em centavos inválido.',
                ['status' => 400]
            );
        }
        return (int) round((float) $value);
    }

    private static function date_to_mysql(mixed $value): ?string {
        if ($value === null || $value === '') return null;
        if (is_numeric($value)) {
            $timestamp = (int) $value;
            if ($timestamp > 9999999999) $timestamp = (int) floor($timestamp / 1000);
        } else {
            $timestamp = strtotime((string) $value);
        }
        return $timestamp > 0 ? gmdate('Y-m-d H:i:s', $timestamp) : null;
    }

    private static function mysql_to_iso(mixed $value): ?string {
        $mysql = self::date_to_mysql($value);
        if ($mysql === null) return null;
        return gmdate('c', strtotime($mysql . ' UTC') ?: 0);
    }

    private static function timestamp_to_iso(mixed $value): ?string {
        return self::mysql_to_iso($value);
    }

    private static function json(mixed $value): string {
        $encoded = wp_json_encode(
            $value,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );
        return is_string($encoded) ? $encoded : '{}';
    }

    private static function decode_json(mixed $value, mixed $fallback): mixed {
        if (!is_string($value) || $value === '') return $fallback;
        $decoded = json_decode($value, true);
        return json_last_error() === JSON_ERROR_NONE ? $decoded : $fallback;
    }

    private static function safe_dashboard_url(string $provider): string {
        return self::provider_url(self::PROVIDERS[$provider]['dashboard'] ?? '');
    }

    private static function provider_url(mixed $value): string {
        $value = trim((string) $value);
        if ($value === '' || strtolower((string) wp_parse_url($value, PHP_URL_SCHEME)) !== 'https') {
            return '';
        }
        return esc_url_raw($value, ['https']);
    }

    private static function provider_checkout_url(string $provider, mixed $value): string {
        $url = self::provider_url($value);
        if ($url === '') return '';
        $parsed = wp_parse_url($url);
        if (
            !is_array($parsed)
            || isset($parsed['user'])
            || isset($parsed['pass'])
            || (isset($parsed['port']) && absint($parsed['port']) !== 443)
        ) {
            return '';
        }
        $host = strtolower(rtrim((string) ($parsed['host'] ?? ''), '.'));
        $allowed = match (self::provider_key($provider)) {
            'stripe' => ['stripe.com'],
            'mercado_pago' => ['mercadopago.com', 'mercadopago.com.br'],
            'asaas' => ['asaas.com'],
            'pagbank' => ['pagseguro.uol.com.br', 'pagbank.com.br', 'pagseguro.com.br'],
            'pagarme' => ['pagar.me'],
            'woovi' => ['woovi.com', 'woovi-sandbox.com', 'openpix.com.br'],
            'iugu' => ['iugu.com'],
            'hotmart' => ['hotmart.com'],
            'ticto' => ['ticto.app', 'ticto.com.br'],
            default => [],
        };
        foreach ($allowed as $suffix) {
            if ($host === $suffix || str_ends_with($host, '.' . $suffix)) return $url;
        }
        return '';
    }

    private static function link_by_rel(mixed $links, string $rel, string $provider): string {
        foreach ((array) $links as $link) {
            if (
                is_array($link)
                && strtoupper((string) ($link['rel'] ?? '')) === strtoupper($rel)
            ) {
                return self::provider_checkout_url($provider, $link['href'] ?? '');
            }
        }
        return '';
    }

    private static function camel_to_snake(string $value): string {
        return strtolower((string) preg_replace('/(?<!^)[A-Z]/', '_$0', $value));
    }
}
