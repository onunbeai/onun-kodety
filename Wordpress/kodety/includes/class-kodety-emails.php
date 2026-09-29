<?php

defined('ABSPATH') || exit;

final class Kodety_Emails {
    private static ?self $instance = null;
    private const OPTION_SETTINGS = 'kodety_email_settings';
    private const DB_VERSION = 2;
    private const REDACTED_VALUE = '[redacted]';
    private const SECRET_PREFIX = 'enc:v1:';
    private const SECRET_FIELDS = [
        'webhook_secret',
        'api_bearer',
        'api_headers',
        'activecampaign_key',
    ];
    private const MAX_API_HEADERS_BYTES = 16384;
    private const MAX_API_HEADERS = 25;
    private const MAX_FORM_PAYLOAD_BYTES = 262144;
    private const MAX_UPLOAD_FILES = 5;
    private const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
    private const MAX_UPLOAD_TOTAL_BYTES = 10 * 1024 * 1024;
    private const FILE_MAGIC = 'KDYFORM1';
    private const FILE_AAD = 'kodety-forms-upload-v1';
    private const RUNTIME_CONFIG_PREFIX = '__kodetyFormsServerConfig_';
    private const ALLOWED_UPLOAD_MIMES = [
        'jpg|jpeg|jpe' => 'image/jpeg',
        'png' => 'image/png',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'pdf' => 'application/pdf',
        'txt' => 'text/plain',
        'csv' => 'text/csv',
        'rtf' => 'application/rtf',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'odt' => 'application/vnd.oasis.opendocument.text',
        'ods' => 'application/vnd.oasis.opendocument.spreadsheet',
    ];

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'maybe_upgrade'], 2);
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action('admin_menu', [$this, 'admin_menu'], 25);
        add_action('admin_enqueue_scripts', [$this, 'admin_assets']);
        add_action('admin_post_kodety_emails_save_settings', [$this, 'save_settings']);
        add_action('admin_post_kodety_emails_update', [$this, 'update_submission']);
        add_action('admin_post_kodety_emails_delete', [$this, 'delete_submission']);
        add_action('admin_post_kodety_emails_download_file', [$this, 'download_file']);
        add_action('admin_post_kodety_emails_bulk', [$this, 'bulk_update']);
        add_action('kodety_emails_cleanup', [$this, 'cleanup_expired']);
    }

    public static function activate(): void {
        self::create_table();
        $administrator = get_role('administrator');
        if ($administrator) $administrator->add_cap('kodety_manage_emails');
        $editor = get_role('editor');
        if ($editor) $editor->remove_cap('kodety_manage_emails');
        add_option(self::OPTION_SETTINGS, self::default_settings(), '', false);
        update_option('kodety_emails_db_version', self::DB_VERSION, false);
        if (!wp_next_scheduled('kodety_emails_cleanup')) wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'kodety_emails_cleanup');
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook('kodety_emails_cleanup');
    }

    public function maybe_upgrade(): void {
        if ((int) get_option('kodety_emails_db_version', 0) >= self::DB_VERSION) return;
        self::activate();
    }

    private static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'kodety_email_submissions';
    }

    private static function create_table(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $table = self::table();
        dbDelta("CREATE TABLE {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            form_key varchar(191) NOT NULL DEFAULT '',
            page_url text NULL,
            referrer text NULL,
            sender_email varchar(320) NOT NULL DEFAULT '',
            sender_name varchar(191) NOT NULL DEFAULT '',
            subject varchar(255) NOT NULL DEFAULT '',
            payload longtext NOT NULL,
            files longtext NULL,
            status varchar(20) NOT NULL DEFAULT 'new',
            source_hash char(64) NOT NULL DEFAULT '',
            user_agent varchar(500) NOT NULL DEFAULT '',
            delivery_status varchar(40) NOT NULL DEFAULT 'pending',
            integration_status varchar(40) NOT NULL DEFAULT 'pending',
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY status_created (status, created_at),
            KEY form_created (form_key, created_at),
            KEY sender_email (sender_email(191))
        ) {$charset};");
    }

    private static function default_settings(): array {
        return [
            'enabled' => true,
            'recipient_email' => (string) get_option('admin_email', ''),
            'email_subject' => '[Onun Kodety] Novo envio de {form}',
            'reply_to_field' => 'email',
            'success_message' => 'Mensagem enviada com sucesso.',
            'error_message' => 'Não foi possível enviar. Tente novamente.',
            'retention_days' => 365,
            'webhook_url' => '',
            'webhook_secret' => '',
            'api_url' => '',
            'api_bearer' => '',
            'api_headers' => '',
            'activecampaign_url' => '',
            'activecampaign_key' => '',
            'activecampaign_list_id' => '',
        ];
    }

    private static function settings(): array {
        $stored = get_option(self::OPTION_SETTINGS, []);
        $stored = is_array($stored) ? $stored : [];
        $settings = array_merge(self::default_settings(), $stored);
        $migrated = $stored;
        $changed = false;
        foreach (self::SECRET_FIELDS as $field) {
            $value = (string) ($settings[$field] ?? '');
            if ($value === '') continue;
            if (str_starts_with($value, self::SECRET_PREFIX)) {
                $plain = self::decrypt_secret($value);
                // Fail closed when salts changed or the option was corrupted:
                // no unreadable credential may be sent as if it were valid.
                $settings[$field] = is_wp_error($plain) ? '' : $plain;
                continue;
            }
            // Existing installations stored these values in plain text. Keep
            // the integration online while upgrading the option in place.
            $protected = self::encrypt_secret($value);
            if (!is_wp_error($protected)) {
                $migrated[$field] = $protected;
                $changed = true;
            }
        }
        if ($changed) update_option(self::OPTION_SETTINGS, $migrated, false);
        return $settings;
    }

    private static function encrypt_secret(string $plain): string|WP_Error {
        if ($plain === '') return '';
        if (!function_exists('openssl_encrypt')) {
            return new WP_Error('kodety_forms_crypto', 'OpenSSL é necessário para proteger credenciais de integração.', ['status' => 503]);
        }
        try {
            $iv = random_bytes(12);
        } catch (Throwable) {
            return new WP_Error('kodety_forms_crypto', 'Não foi possível proteger as credenciais.', ['status' => 503]);
        }
        $tag = '';
        $key = hash('sha256', wp_salt('auth') . '|kodety-forms-integrations-v1', true);
        $cipher = openssl_encrypt(
            $plain,
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            'kodety-forms-integrations-v1',
            16
        );
        if (!is_string($cipher) || strlen($tag) !== 16) {
            return new WP_Error('kodety_forms_crypto', 'Não foi possível proteger as credenciais.', ['status' => 503]);
        }
        return self::SECRET_PREFIX . base64_encode($iv . $tag . $cipher);
    }

    private static function decrypt_secret(string $stored): string|WP_Error {
        if ($stored === '') return '';
        if (!str_starts_with($stored, self::SECRET_PREFIX) || !function_exists('openssl_decrypt')) {
            return new WP_Error('kodety_forms_crypto', 'Uma credencial salva não pôde ser lida.', ['status' => 503]);
        }
        $raw = base64_decode(substr($stored, strlen(self::SECRET_PREFIX)), true);
        if (!is_string($raw) || strlen($raw) < 29) {
            return new WP_Error('kodety_forms_crypto', 'Uma credencial salva está corrompida.', ['status' => 503]);
        }
        $key = hash('sha256', wp_salt('auth') . '|kodety-forms-integrations-v1', true);
        $plain = openssl_decrypt(
            substr($raw, 28),
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            substr($raw, 0, 12),
            substr($raw, 12, 16),
            'kodety-forms-integrations-v1'
        );
        return is_string($plain)
            ? $plain
            : new WP_Error('kodety_forms_crypto', 'Uma credencial salva não pôde ser lida.', ['status' => 503]);
    }

    private static function protect_settings(array $settings): array|WP_Error {
        foreach (self::SECRET_FIELDS as $field) {
            $plain = (string) ($settings[$field] ?? '');
            $protected = self::encrypt_secret($plain);
            if (is_wp_error($protected)) return $protected;
            $settings[$field] = $protected;
        }
        return $settings;
    }

    /** @return array<string,string>|WP_Error */
    private static function decode_api_headers(string $json): array|WP_Error {
        $json = trim($json);
        if ($json === '') return [];
        if (strlen($json) > self::MAX_API_HEADERS_BYTES) {
            return new WP_Error('kodety_forms_api_headers_size', 'Os headers adicionais excedem 16 KB.', ['status' => 422]);
        }
        $decoded = json_decode($json, true);
        // Keep the declared PHP 8.0 floor (array_is_list requires PHP 8.1).
        if (!is_array($decoded) || array_values($decoded) === $decoded) {
            return new WP_Error('kodety_forms_api_headers_json', 'Headers adicionais precisam ser um objeto JSON.', ['status' => 422]);
        }
        if (count($decoded) > self::MAX_API_HEADERS) {
            return new WP_Error('kodety_forms_api_headers_count', 'Use no máximo 25 headers adicionais.', ['status' => 422]);
        }
        $headers = [];
        $blocked = ['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'set-cookie', 'proxy-authorization'];
        foreach ($decoded as $raw_name => $raw_value) {
            $name = trim((string) $raw_name);
            if (
                !preg_match('/^[!#$%&\'*+.^_`|~0-9A-Za-z-]{1,64}$/D', $name)
                || in_array(strtolower($name), $blocked, true)
            ) {
                return new WP_Error('kodety_forms_api_header_name', 'Um header adicional possui nome inválido ou reservado.', ['status' => 422]);
            }
            if (!is_scalar($raw_value) || is_bool($raw_value)) {
                return new WP_Error('kodety_forms_api_header_value', 'Valores de headers adicionais precisam ser texto ou número.', ['status' => 422]);
            }
            $value = (string) $raw_value;
            if ($value === '' || strlen($value) > 2048 || preg_match('/[\r\n]/', $value)) {
                return new WP_Error('kodety_forms_api_header_value', 'Um header adicional possui valor vazio, longo demais ou inseguro.', ['status' => 422]);
            }
            $headers[$name] = $value;
        }
        return $headers;
    }

    private static function normalize_api_headers_json(string $json): string|WP_Error {
        $headers = self::decode_api_headers($json);
        if (is_wp_error($headers)) return $headers;
        return $headers
            ? (string) wp_json_encode($headers, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            : '';
    }

    public function admin_menu(): void {
        $i18n = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
        add_menu_page(
            $i18n ? $i18n->translate('Emails Onun Kodety') : 'Emails Onun Kodety',
            $i18n ? $i18n->translate('Emails') : 'Emails',
            'kodety_manage_emails',
            'kodety-emails',
            [$this, 'render_admin_page'],
            'dashicons-email-alt',
            26
        );
    }

    public function admin_assets(string $hook): void {
        if ($hook !== 'toplevel_page_kodety-emails') return;
        $css = KODETY_DIR . 'admin/emails.css';
        $js = KODETY_DIR . 'admin/emails.js';
        $icons = KODETY_DIR . 'admin/components/kodety-icons.bundle.js';
        wp_enqueue_style('kodety-emails', KODETY_URL . 'admin/emails.css', [], is_file($css) ? (string) filemtime($css) : KODETY_VERSION);
        wp_enqueue_script('kodety-admin-icons', KODETY_URL . 'admin/components/kodety-icons.bundle.js', [], is_file($icons) ? (string) filemtime($icons) : KODETY_VERSION, true);
        wp_enqueue_script('kodety-emails', KODETY_URL . 'admin/emails.js', ['kodety-admin-icons'], is_file($js) ? (string) filemtime($js) : KODETY_VERSION, true);
    }

    public function register_routes(): void {
        register_rest_route('kodety/v1', '/forms/submit', [
            'methods' => 'POST',
            'callback' => [$this, 'receive_submission'],
            'permission_callback' => '__return_true',
        ]);
    }

    public static function inject_runtime(string $html): string {
        $utm_runtime_enabled = !class_exists('Kodety_Edition')
            || Kodety_Edition::has('analyticsUtms');
        $has_utm_form = preg_match(
            '/<form\b[^>]*\bdata-kodety-utm-enabled\s*=\s*(?:"true"|\'true\'|true)(?:\s|>)/i',
            $html
        ) === 1;
        if (!$utm_runtime_enabled) {
            $html = self::strip_unlicensed_utm_runtime($html);
            $has_utm_form = false;
        }
        $has_filter_form = preg_match(
            '/<form\b[^>]*\bdata-kodety-form-mode\s*=\s*(?:"filter"|\'filter\'|filter)(?:\s|>)/i',
            $html
        ) === 1;
        $has_multistep_form = preg_match(
            '/<form\b[^>]*\bdata-kodety-multistep\s*=\s*(?:"true"|\'true\'|true)(?:\s|>)/i',
            $html
        ) === 1;
        $extension_active = !(
            class_exists('Kodety_Extensions')
            && !Kodety_Extensions::instance()->is_active('kodety-emails')
        );
        $settings = self::settings();
        $capture_enabled = $extension_active && !empty($settings['enabled']);
        if ((!$capture_enabled && !$has_filter_form && !$has_multistep_form && !$has_utm_form) || !str_contains(strtolower($html), '<form')) return $html;
        if ($capture_enabled) $html = self::sign_cms_forms($html);
        $bootstrap_token = strtolower(str_replace('-', '', wp_generate_uuid4()));
        $config = wp_json_encode([
            'endpoint' => $capture_enabled ? rest_url('kodety/v1/forms/submit') : '',
            'successMessage' => (string) $settings['success_message'],
            'errorMessage' => (string) $settings['error_message'],
            'utmEnabled' => $utm_runtime_enabled,
            'bootstrapToken' => $bootstrap_token,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $runtime_path = KODETY_DIR . 'assets/forms-runtime.js';
        $runtime_version = is_file($runtime_path) ? (string) filemtime($runtime_path) : KODETY_VERSION;
        $encoded_config = str_replace('</', '<\/', (string) $config);
        $config_key = self::RUNTIME_CONFIG_PREFIX . $bootstrap_token;
        $bootstrap = '(function(config){"use strict";var snapshot=Object.freeze(config);'
            . 'try{Object.defineProperty(window,"' . $config_key . '",{configurable:false,enumerable:false,writable:false,value:snapshot});}catch(error){}'
            . 'try{Object.defineProperty(window,"kodetyForms",{configurable:false,enumerable:true,writable:false,value:snapshot});}catch(error){}'
            . '})(' . $encoded_config . ');';
        $runtime_url = KODETY_URL . 'assets/forms-runtime.js?ver=' . rawurlencode($runtime_version)
            . '#kodety-forms-bootstrap=' . rawurlencode($bootstrap_token);
        $markup = '<script data-kodety-forms-config>' . $bootstrap . '</script>'
            . '<script src="' . esc_url($runtime_url) . '" defer data-kodety-forms-runtime></script>';
        return preg_match('/<\/body\s*>/i', $html)
            ? (string) preg_replace('/<\/body\s*>/i', $markup . '</body>', $html, 1)
            : $html . $markup;
    }

    /**
     * Keep saved Builder metadata untouched while ensuring a Free public or
     * preview response never exposes the operational UTM mapping in its DOM.
     */
    private static function strip_unlicensed_utm_runtime(string $html): string {
        $clean = preg_replace_callback(
            '~<form\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>~is',
            static function (array $match): string {
                $tag = (string) $match[0];
                $tag = (string) preg_replace(
                    '~\s+data-kodety-utm-enabled\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)~i',
                    '',
                    $tag
                );
                return (string) preg_replace(
                    '~\s+data-kodety-utm-config\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)~i',
                    '',
                    $tag
                );
            },
            $html
        );
        return is_string($clean) ? $clean : $html;
    }

    private static function form_tag_attribute(string $tag, string $name): string {
        $attribute = preg_quote($name, '/');
        if (!preg_match('/\s' . $attribute . '\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $tag, $match)) return '';
        $value = (string) (($match[1] ?? '') !== '' ? $match[1] : (($match[2] ?? '') !== '' ? $match[2] : ($match[3] ?? '')));
        return html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /** @return array{collection:string,status:string,form:string,mapping:array<string,string>}|null */
    private static function normalize_cms_form_configuration(
        string $collection,
        string $status,
        string $form_key,
        mixed $raw_mapping
    ): ?array {
        $collection = sanitize_key($collection);
        $status = sanitize_key($status) ?: 'draft';
        $form_key = sanitize_title($form_key) ?: 'formulario';
        if ($collection === '' || !in_array($status, ['draft', 'pending', 'publish'], true)) return null;
        if (is_string($raw_mapping)) {
            if (strlen($raw_mapping) > 16384) return null;
            $raw_mapping = json_decode($raw_mapping, true);
        }
        if (!is_array($raw_mapping) || !$raw_mapping || count($raw_mapping) > 100) return null;
        $mapping = [];
        foreach ($raw_mapping as $source => $target) {
            if (!is_string($source) || !is_string($target)) return null;
            $source = trim($source);
            $target = trim($target);
            if (
                $source === ''
                || strlen($source) > 191
                || str_starts_with($source, '_kodety_')
                || self::prohibited_field_name($source)
                || !preg_match('/^(?:title|excerpt|content|slug|field:[a-z0-9_-]+)$/', $target)
            ) {
                return null;
            }
            $mapping[$source] = $target;
        }
        if (!$mapping) return null;
        ksort($mapping, SORT_STRING);
        return ['collection' => $collection, 'status' => $status, 'form' => $form_key, 'mapping' => $mapping];
    }

    /** @param array{collection:string,status:string,form:string,mapping:array<string,string>} $configuration */
    private static function cms_form_token(array $configuration): string {
        $canonical = wp_json_encode($configuration, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return hash_hmac('sha256', is_string($canonical) ? $canonical : '', wp_salt('auth'));
    }

    private static function sign_cms_forms(string $html): string {
        $signed = preg_replace_callback(
            '/<form\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>/i',
            static function (array $match): string {
                $tag = (string) $match[0];
                $collection = self::form_tag_attribute($tag, 'data-kodety-cms-collection');
                $mapping = self::form_tag_attribute($tag, 'data-kodety-cms-map');
                if ($collection === '' || $mapping === '') return $tag;
                $form_name = self::form_tag_attribute($tag, 'data-name')
                    ?: self::form_tag_attribute($tag, 'name')
                    ?: self::form_tag_attribute($tag, 'id')
                    ?: 'formulario';
                $configuration = self::normalize_cms_form_configuration(
                    $collection,
                    self::form_tag_attribute($tag, 'data-kodety-cms-status') ?: 'draft',
                    $form_name,
                    $mapping
                );
                if (!$configuration) return $tag;
                $tag = (string) preg_replace(
                    '/\s+data-kodety-cms-token\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)/i',
                    '',
                    $tag
                );
                $token = esc_attr(self::cms_form_token($configuration));
                return (string) preg_replace('/\s*\/?>$/', ' data-kodety-cms-token="' . $token . '">', $tag, 1);
            },
            $html
        );
        return is_string($signed) ? $signed : $html;
    }

    /** @return array{collection:string,status:string,form:string,mapping:array<string,string>}|null|WP_Error */
    private function cms_submission_configuration(array $raw, string $form_key): array|null|WP_Error {
        $keys = ['_kodety_cms_collection', '_kodety_cms_status', '_kodety_cms_map', '_kodety_cms_token'];
        $present = array_values(array_filter($keys, static fn(string $key): bool => isset($raw[$key]) && $raw[$key] !== ''));
        if (!$present) return null;
        if (count($present) !== count($keys)) {
            return new WP_Error('kodety_form_cms_configuration', 'A conexão deste formulário com o CMS está incompleta.', ['status' => 400]);
        }
        $configuration = self::normalize_cms_form_configuration(
            (string) $raw['_kodety_cms_collection'],
            (string) $raw['_kodety_cms_status'],
            $form_key,
            (string) $raw['_kodety_cms_map']
        );
        $token = strtolower(trim((string) $raw['_kodety_cms_token']));
        if (!$configuration || !preg_match('/^[a-f0-9]{64}$/', $token) || !hash_equals(self::cms_form_token($configuration), $token)) {
            return new WP_Error('kodety_form_cms_signature', 'A conexão deste formulário com o CMS não pôde ser validada.', ['status' => 403]);
        }
        return $configuration;
    }

    private function request_origin_allowed(WP_REST_Request $request): bool {
        $origin = trim((string) $request->get_header('origin'));
        if ($origin === '') return true;
        $origin_host = strtolower((string) wp_parse_url($origin, PHP_URL_HOST));
        $home_host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
        return $origin_host !== '' && hash_equals($home_host, $origin_host);
    }

    private static function normalized_field_name(string $name): string {
        $name = preg_replace('/([a-z0-9])([A-Z])/', '$1_$2', $name) ?? $name;
        if (function_exists('remove_accents')) $name = remove_accents($name);
        $name = strtolower($name);
        return trim((string) preg_replace('/[^a-z0-9]+/', '_', $name), '_');
    }

    private static function prohibited_field_name(string $name): bool {
        $compact = str_replace('_', '', self::normalized_field_name($name));
        if ($compact === '') return false;
        foreach (['password', 'passwd', 'passphrase', 'senha', 'contrasena', 'motdepasse'] as $credential) {
            if (str_contains($compact, $credential)) return true;
        }
        return in_array($compact, [
            'pass', 'pwd', 'userpass', 'passcode', 'pin', 'otp', 'onetimepassword',
            'recoverycode', 'backupcode',
            'card', 'cardnumber', 'creditcard', 'creditcardnumber', 'debitcard',
            'debitcardnumber', 'paymentcard', 'cardno', 'ccnumber', 'ccnum', 'pan',
            'primaryaccountnumber', 'numerocartao', 'cartaocredito', 'cartaodebito',
            'cardholder', 'cardholdername', 'cvv', 'cvv2', 'cvc', 'cvc2', 'cvn',
            'cid', 'cccvv', 'cccvc', 'cardverificationvalue', 'cardverificationcode',
            'securitycode', 'codigoseguranca', 'codigoverificacao', 'cardexpiry',
            'cardexpiration', 'expirymonth', 'expiryyear', 'expirationmonth',
            'expirationyear', 'expdate', 'ccmonth', 'ccyear',
        ], true);
    }

    private static function sensitive_field_name(string $name): bool {
        $normalized = self::normalized_field_name($name);
        if ($normalized === '') return false;
        $compact = str_replace('_', '', $normalized);
        if (self::prohibited_field_name($name)) return true;
        if (str_contains($compact, 'token')) return true;
        if (
            str_starts_with($compact, 'secret')
            || str_ends_with($compact, 'secret')
            || str_ends_with($compact, 'secretkey')
            || str_ends_with($compact, 'privatekey')
            || str_ends_with($compact, 'accesskey')
        ) return true;
        return in_array($compact, [
            'authorization', 'bearer', 'jwt', 'oauthcode', 'authcode', 'csrf', 'nonce',
            'auth', 'verificationcode', 'resetkey', 'activationkey',
            'verificationkey', 'useractivationkey', 'magiclink',
            'apikey', 'secret', 'secretkey', 'clientsecret', 'privatekey', 'signingkey',
            'webhooksecret', 'sessionid', 'sessionkey', 'cookie', 'grecaptcharesponse',
            'hcaptcharesponse', 'cfturnstileresponse', 'captcharesponse',
            'paymentmethod', 'paymentmethodid', 'stripepaymentmethod',
        ], true);
    }

    private static function luhn_valid(string $digits): bool {
        $sum = 0;
        $double = false;
        for ($index = strlen($digits) - 1; $index >= 0; $index--) {
            $digit = (int) $digits[$index];
            if ($double) {
                $digit *= 2;
                if ($digit > 9) $digit -= 9;
            }
            $sum += $digit;
            $double = !$double;
        }
        return $sum > 0 && $sum % 10 === 0;
    }

    private static function contains_payment_card_number(string $value): bool {
        preg_match_all('/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/', $value, $matches);
        foreach ($matches[0] ?? [] as $candidate) {
            $digits = preg_replace('/\D+/', '', (string) $candidate) ?? '';
            if (strlen($digits) < 13 || strlen($digits) > 19) continue;
            // Restrict heuristic matching to common card-network prefixes so a
            // long phone or document number is not rejected merely by chance.
            $known_network = preg_match('/^(?:4\d{12}(?:\d{3})?(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})$/', $digits) === 1;
            $generic_sixteen_digit_card = strlen($digits) === 16 && preg_match('/^[2-6]/', $digits) === 1;
            if (!$known_network && !$generic_sixteen_digit_card) continue;
            if (self::luhn_valid($digits)) return true;
        }
        return false;
    }

    private static function sensitive_scalar_value(mixed $value): bool {
        if (!is_scalar($value) || is_bool($value)) return false;
        $value = trim((string) $value);
        if ($value === '') return false;
        if (self::contains_payment_card_number($value)) return true;
        return preg_match('/\bbearer\s+[A-Za-z0-9._~+\/=-]{8,}/i', $value) === 1
            || preg_match('/\bbasic\s+[A-Za-z0-9+\/=]{8,}/i', $value) === 1
            || preg_match('/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/', $value) === 1
            || preg_match('/(?:[?&]|&amp;)(?:access_?token|refresh_?token|token|password|passwd|key|signature|sig|nonce|jwt|code)=[^&#\s]{8,}/i', $value) === 1
            || preg_match('/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/', $value) === 1
            || preg_match('/\b(?:tok|pm|src|pi|seti)_[A-Za-z0-9]{8,}\b/', $value) === 1
            || preg_match('/\bgh[pousr]_[A-Za-z0-9]{20,}\b/', $value) === 1
            || preg_match('/\bAKIA[0-9A-Z]{16}\b/', $value) === 1;
    }

    private function payload_contains_sensitive_data(mixed $value, int $depth = 0): bool {
        if ($depth > 4) return false;
        if (is_array($value)) {
            foreach (array_slice($value, 0, 100, true) as $key => $child) {
                if (!is_int($key) && self::sensitive_field_name((string) $key)) return true;
                if ($this->payload_contains_sensitive_data($child, $depth + 1)) return true;
            }
            return false;
        }
        return self::sensitive_scalar_value($value);
    }

    private function payload_contains_prohibited_data(mixed $value, int $depth = 0): bool {
        if ($depth > 4) return false;
        if (is_array($value)) {
            foreach (array_slice($value, 0, 100, true) as $key => $child) {
                if (!is_int($key) && self::prohibited_field_name((string) $key)) return true;
                if ($this->payload_contains_prohibited_data($child, $depth + 1)) return true;
            }
            return false;
        }
        return is_scalar($value) && !is_bool($value)
            ? self::contains_payment_card_number((string) $value)
            : false;
    }

    private function files_contain_sensitive_data(array $files): bool {
        foreach ($files as $file) {
            if (!is_array($file)) continue;
            if (self::sensitive_field_name((string) ($file['field'] ?? ''))) return true;
            if (self::sensitive_scalar_value($file['name'] ?? '')) return true;
        }
        return false;
    }

    private static function source_url_for_storage(string $value): string {
        $parts = wp_parse_url(trim($value));
        if (!is_array($parts)) return '';
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') return '';
        $port = isset($parts['port']) ? ':' . absint($parts['port']) : '';
        $path = (string) ($parts['path'] ?? '/');
        $redact_next = false;
        $segments = explode('/', $path);
        foreach ($segments as &$segment) {
            if ($segment === '') continue;
            $decoded = rawurldecode($segment);
            $normalized = self::normalized_field_name($decoded);
            $marks_secret_segment = in_array($normalized, [
                'reset', 'reset_password', 'password_reset', 'verify', 'verification',
                'activate', 'activation', 'magic_link', 'invite', 'invitation',
            ], true);
            $looks_opaque = strlen($decoded) >= 24
                && preg_match('/^[A-Za-z0-9_-]+$/', $decoded) === 1
                && preg_match('/[A-Za-z]/', $decoded) === 1
                && preg_match('/\d/', $decoded) === 1;
            if ($redact_next || (!$marks_secret_segment && (self::sensitive_field_name($decoded) || self::sensitive_scalar_value($decoded) || $looks_opaque))) {
                $segment = 'redacted';
            }
            $redact_next = $marks_secret_segment;
        }
        unset($segment);
        $path = implode('/', $segments);
        // Query strings, fragments and URL credentials commonly carry reset,
        // checkout and OAuth tokens. They are not needed to identify the page.
        return esc_url_raw($scheme . '://' . $host . $port . ($path !== '' ? $path : '/'));
    }

    private function sanitize_payload(mixed $value, int $depth = 0): mixed {
        if ($depth > 3) return '';
        if (is_array($value)) {
            $result = [];
            foreach (array_slice($value, 0, 100, true) as $key => $child) {
                $clean_key = sanitize_text_field((string) $key);
                if ($clean_key === '' || self::sensitive_field_name($clean_key)) continue;
                $result[$clean_key] = $this->sanitize_payload($child, $depth + 1);
            }
            return $result;
        }
        $sanitized = self::truncate(sanitize_textarea_field((string) $value), 10000);
        return self::sensitive_scalar_value($sanitized) ? self::REDACTED_VALUE : $sanitized;
    }

    private static function truncate(string $value, int $length): string {
        return function_exists('mb_substr') ? mb_substr($value, 0, $length) : substr($value, 0, $length);
    }

    private function find_value(array $payload, array $keys): string {
        foreach ($keys as $key) {
            foreach ($payload as $candidate => $value) {
                if (sanitize_key((string) $candidate) !== $key || is_array($value)) continue;
                return sanitize_text_field((string) $value);
            }
        }
        return '';
    }

    /**
     * Convert PHP's parallel `$_FILES` shape (including `multiple`) into a
     * bounded flat list. File paths in this list come from PHP, never from the
     * JSON/form payload.
     *
     * @return array<int,array{field:string,name:string,type:string,tmp_name:string,error:int,size:int}>
     */
    private static function normalize_uploaded_files(array $files): array {
        $normalized = [];
        foreach ($files as $field => $file) {
            if (!is_array($file)) continue;
            self::flatten_uploaded_file((string) $field, $file, $normalized);
        }
        return $normalized;
    }

    private static function flatten_uploaded_file(string $field, array $file, array &$normalized): void {
        $names = $file['name'] ?? '';
        if (is_array($names)) {
            foreach (array_keys($names) as $key) {
                $child = [];
                foreach (['name', 'type', 'tmp_name', 'error', 'size'] as $property) {
                    $values = $file[$property] ?? null;
                    $child[$property] = is_array($values) ? ($values[$key] ?? null) : null;
                }
                self::flatten_uploaded_file($field, $child, $normalized);
            }
            return;
        }
        $normalized[] = [
            'field' => sanitize_text_field($field),
            'name' => (string) ($file['name'] ?? ''),
            'type' => (string) ($file['type'] ?? ''),
            'tmp_name' => (string) ($file['tmp_name'] ?? ''),
            'error' => (int) ($file['error'] ?? UPLOAD_ERR_OK),
            'size' => absint($file['size'] ?? 0),
        ];
    }

    private static function file_storage_root(): string|WP_Error {
        $uploads = wp_upload_dir();
        $basedir = is_array($uploads) ? (string) ($uploads['basedir'] ?? '') : '';
        if ($basedir === '' || !empty($uploads['error'])) {
            return new WP_Error('kodety_forms_file_storage', 'O armazenamento privado de arquivos não está disponível.', ['status' => 503]);
        }
        return trailingslashit($basedir) . 'kodety/private/forms';
    }

    private static function ensure_file_storage(): string|WP_Error {
        $root = self::file_storage_root();
        if (is_wp_error($root)) return $root;
        $private = dirname($root);
        if (!wp_mkdir_p($root)) {
            return new WP_Error('kodety_forms_file_storage', 'Não foi possível preparar o armazenamento privado.', ['status' => 503]);
        }
        $guards = [
            $private . '/index.php' => "<?php\n// Private Onun Kodety files.\n",
            $private . '/.htaccess' => "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n",
            $private . '/web.config' => "<?xml version=\"1.0\" encoding=\"UTF-8\"?><configuration><system.webServer><security><authorization><remove users=\"*\" roles=\"\" verbs=\"\"/><add accessType=\"Deny\" users=\"*\"/></authorization></security></system.webServer></configuration>\n",
            $root . '/index.php' => "<?php\n// Private Onun Kodety form uploads.\n",
        ];
        foreach ($guards as $path => $contents) {
            if (!is_file($path) && file_put_contents($path, $contents, LOCK_EX) === false) {
                return new WP_Error('kodety_forms_file_storage', 'Não foi possível proteger o armazenamento privado.', ['status' => 503]);
            }
        }
        $real = realpath($root);
        return is_string($real) && $real !== ''
            ? $real
            : new WP_Error('kodety_forms_file_storage', 'Não foi possível validar o armazenamento privado.', ['status' => 503]);
    }

    private static function upload_error(int $error): WP_Error {
        $status = in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 413 : 400;
        $message = match ($error) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'Um arquivo ultrapassa o limite permitido.',
            UPLOAD_ERR_PARTIAL => 'Um arquivo chegou incompleto. Tente novamente.',
            UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE, UPLOAD_ERR_EXTENSION => 'O servidor não conseguiu receber um arquivo.',
            default => 'Um arquivo enviado é inválido.',
        };
        return new WP_Error('kodety_forms_file_upload', $message, ['status' => $status]);
    }

    private static function validate_office_archive(string $path, string $extension): bool {
        if (!class_exists('ZipArchive')) return false;
        $zip = new ZipArchive();
        if ($zip->open($path) !== true) return false;
        try {
            if ($zip->numFiles <= 0 || $zip->numFiles > 2000) return false;
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $entry = strtolower(str_replace('\\', '/', (string) $zip->getNameIndex($index)));
                if (
                    $entry === ''
                    || str_contains($entry, '../')
                    || str_contains($entry, 'vbaproject.bin')
                    || str_starts_with($entry, 'basic/')
                    || str_starts_with($entry, 'scripts/')
                    || preg_match('/\.(?:exe|com|bat|cmd|js|vbs|ps1|php\d*|phtml|html?|svg)$/D', $entry)
                ) return false;
            }
            if ($zip->locateName('[Content_Types].xml') !== false) {
                return match ($extension) {
                    'docx' => $zip->locateName('word/document.xml') !== false,
                    'xlsx' => $zip->locateName('xl/workbook.xml') !== false,
                    default => false,
                };
            }
            if (!in_array($extension, ['odt', 'ods'], true)) return false;
            $mime = (string) $zip->getFromName('mimetype');
            $expected = $extension === 'odt'
                ? 'application/vnd.oasis.opendocument.text'
                : 'application/vnd.oasis.opendocument.spreadsheet';
            return hash_equals($expected, trim($mime)) && $zip->locateName('content.xml') !== false;
        } finally {
            $zip->close();
        }
    }

    private static function detected_mime_allowed(string $path, string $extension, string $expected): bool {
        if (!function_exists('finfo_open')) return false;
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo === false) return false;
        $detected = strtolower((string) finfo_file($finfo, $path));
        finfo_close($finfo);
        if (in_array($extension, ['docx', 'xlsx', 'odt', 'ods'], true)) {
            if (!in_array($detected, [
                strtolower($expected),
                'application/zip',
                'application/x-zip',
                'application/x-zip-compressed',
                'application/octet-stream',
            ], true)) return false;
            return self::validate_office_archive($path, $extension);
        }
        if ($detected === strtolower($expected)) return true;
        if ($extension === 'csv') {
            return in_array($detected, ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel'], true);
        }
        if ($extension === 'rtf') {
            return in_array($detected, ['text/plain', 'text/rtf', 'application/rtf'], true);
        }
        return false;
    }

    /** @return array{name:string,type:string,size:int,extension:string}|WP_Error */
    private static function validate_uploaded_file(array $file, bool $require_http_upload): array|WP_Error {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_OK);
        if ($error !== UPLOAD_ERR_OK) return self::upload_error($error);
        $path = (string) ($file['tmp_name'] ?? '');
        if ($path === '' || !is_file($path) || !is_readable($path)) {
            return new WP_Error('kodety_forms_file_missing', 'Um arquivo enviado não possui conteúdo temporário válido.', ['status' => 400]);
        }
        if ($require_http_upload && !is_uploaded_file($path)) {
            return new WP_Error('kodety_forms_file_upload', 'A origem de um arquivo enviado não pôde ser validada.', ['status' => 400]);
        }
        $actual_size = filesize($path);
        if (!is_int($actual_size) || $actual_size <= 0) {
            return new WP_Error('kodety_forms_file_empty', 'Arquivos vazios não são aceitos.', ['status' => 422]);
        }
        if ($actual_size > self::MAX_UPLOAD_FILE_BYTES) {
            return new WP_Error('kodety_forms_file_size', 'Cada arquivo pode ter no máximo 5 MB.', ['status' => 413]);
        }
        $name = sanitize_file_name((string) ($file['name'] ?? ''));
        if ($name === '') return new WP_Error('kodety_forms_file_name', 'Um arquivo enviado não possui nome válido.', ['status' => 422]);
        $checked = wp_check_filetype_and_ext($path, $name, self::ALLOWED_UPLOAD_MIMES);
        $extension = strtolower((string) ($checked['ext'] ?? ''));
        $mime = sanitize_mime_type((string) ($checked['type'] ?? ''));
        if ($extension !== '' && $mime !== '' && !function_exists('finfo_open')) {
            return new WP_Error('kodety_forms_file_mime', 'A extensão Fileinfo do PHP é necessária para validar arquivos.', ['status' => 503]);
        }
        if (in_array($extension, ['docx', 'xlsx', 'odt', 'ods'], true) && !class_exists('ZipArchive')) {
            return new WP_Error('kodety_forms_file_archive', 'A extensão ZipArchive do PHP é necessária para validar este documento.', ['status' => 503]);
        }
        if ($extension === '' || $mime === '' || !self::detected_mime_allowed($path, $extension, $mime)) {
            return new WP_Error(
                'kodety_forms_file_type',
                'Tipo de arquivo não permitido. Use imagens, PDF, texto, CSV, RTF ou documentos Office sem macros.',
                ['status' => 415]
            );
        }
        return ['name' => self::truncate($name, 191), 'type' => $mime, 'size' => $actual_size, 'extension' => $extension];
    }

    private static function encrypt_upload(string $source, string $destination): string|WP_Error {
        if (!function_exists('openssl_encrypt')) {
            return new WP_Error('kodety_forms_file_crypto', 'OpenSSL é necessário para proteger arquivos enviados.', ['status' => 503]);
        }
        $plain = file_get_contents($source);
        if (!is_string($plain)) return new WP_Error('kodety_forms_file_storage', 'Não foi possível ler um arquivo enviado.', ['status' => 500]);
        try {
            $iv = random_bytes(12);
        } catch (Throwable) {
            return new WP_Error('kodety_forms_file_crypto', 'Não foi possível proteger um arquivo enviado.', ['status' => 503]);
        }
        $tag = '';
        $key = hash('sha256', wp_salt('auth') . '|' . self::FILE_AAD, true);
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, self::FILE_AAD, 16);
        if (!is_string($cipher) || strlen($tag) !== 16) {
            return new WP_Error('kodety_forms_file_crypto', 'Não foi possível proteger um arquivo enviado.', ['status' => 503]);
        }
        $temporary = $destination . '.tmp';
        $blob = self::FILE_MAGIC . $iv . $tag . $cipher;
        $written = file_put_contents($temporary, $blob, LOCK_EX);
        if ($written !== strlen($blob) || !@chmod($temporary, 0600) || !rename($temporary, $destination)) {
            @unlink($temporary);
            return new WP_Error('kodety_forms_file_storage', 'Não foi possível guardar um arquivo enviado.', ['status' => 500]);
        }
        return hash('sha256', $plain);
    }

    /**
     * Validate and encrypt uploaded files. `$require_http_upload=false` exists
     * only for isolated validation of this private method; the public REST
     * endpoint always requires PHP's `is_uploaded_file` proof.
     *
     * @return array<int,array<string,mixed>>|WP_Error
     */
    private function store_uploaded_files(array $files, bool $require_http_upload = true): array|WP_Error {
        $files = array_values(array_filter(
            $files,
            static fn(array $file): bool => (int) ($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_NO_FILE
                || (string) ($file['name'] ?? '') !== ''
        ));
        if (!$files) return [];
        if (count($files) > self::MAX_UPLOAD_FILES) {
            return new WP_Error('kodety_forms_file_count', 'Envie no máximo 5 arquivos por formulário.', ['status' => 413]);
        }
        $declared_total = array_sum(array_map(static fn(array $file): int => absint($file['size'] ?? 0), $files));
        if ($declared_total > self::MAX_UPLOAD_TOTAL_BYTES) {
            return new WP_Error('kodety_forms_file_size', 'Os arquivos enviados podem somar no máximo 10 MB.', ['status' => 413]);
        }
        $root = self::ensure_file_storage();
        if (is_wp_error($root)) return $root;
        try {
            $directory_token = bin2hex(random_bytes(16));
        } catch (Throwable) {
            return new WP_Error('kodety_forms_file_storage', 'Não foi possível preparar o armazenamento do envio.', ['status' => 503]);
        }
        $relative_directory = gmdate('Y/m') . '/' . $directory_token;
        $directory = $root . '/' . $relative_directory;
        if (!wp_mkdir_p($directory)) {
            return new WP_Error('kodety_forms_file_storage', 'Não foi possível preparar o armazenamento do envio.', ['status' => 503]);
        }
        $stored = [];
        $actual_total = 0;
        foreach ($files as $file) {
            $validated = self::validate_uploaded_file($file, $require_http_upload);
            if (is_wp_error($validated)) {
                $this->delete_stored_files($stored);
                @rmdir($directory);
                return $validated;
            }
            $actual_total += (int) $validated['size'];
            if ($actual_total > self::MAX_UPLOAD_TOTAL_BYTES) {
                $this->delete_stored_files($stored);
                @rmdir($directory);
                return new WP_Error('kodety_forms_file_size', 'Os arquivos enviados podem somar no máximo 10 MB.', ['status' => 413]);
            }
            try {
                $file_id = bin2hex(random_bytes(16));
                $stored_name = bin2hex(random_bytes(16)) . '.kodety-upload';
            } catch (Throwable) {
                $this->delete_stored_files($stored);
                @rmdir($directory);
                return new WP_Error('kodety_forms_file_storage', 'Não foi possível preparar um arquivo enviado.', ['status' => 503]);
            }
            $relative = $relative_directory . '/' . $stored_name;
            $hash = self::encrypt_upload((string) $file['tmp_name'], $root . '/' . $relative);
            if (is_wp_error($hash)) {
                $this->delete_stored_files($stored);
                @rmdir($directory);
                return $hash;
            }
            $stored[] = [
                'id' => $file_id,
                'field' => self::truncate(sanitize_text_field((string) ($file['field'] ?? 'arquivo')), 191),
                'name' => $validated['name'],
                'type' => $validated['type'],
                'size' => $validated['size'],
                'sha256' => $hash,
                'storage' => $relative,
            ];
        }
        return $stored;
    }

    private static function public_file_metadata(array $files): array {
        return array_map(static fn(array $file): array => [
            'field' => (string) ($file['field'] ?? ''),
            'name' => (string) ($file['name'] ?? ''),
            'type' => (string) ($file['type'] ?? ''),
            'size' => absint($file['size'] ?? 0),
        ], $files);
    }

    private static function stored_file_path(array $file): string|WP_Error {
        $root = self::file_storage_root();
        if (is_wp_error($root)) return $root;
        $root_real = realpath($root);
        $relative = str_replace('\\', '/', (string) ($file['storage'] ?? ''));
        if (
            !is_string($root_real)
            || $relative === ''
            || str_starts_with($relative, '/')
            || str_contains($relative, '../')
            || str_contains($relative, "\0")
            || !preg_match('#^\d{4}/\d{2}/[a-f0-9]{32}/[a-f0-9]{32}\.kodety-upload$#D', $relative)
        ) {
            return new WP_Error('kodety_forms_file_reference', 'A referência privada do arquivo é inválida.', ['status' => 404]);
        }
        $path = realpath($root . '/' . $relative);
        if (
            !is_string($path)
            || !is_file($path)
            || ($path !== $root_real && !str_starts_with($path, trailingslashit($root_real)))
        ) {
            return new WP_Error('kodety_forms_file_missing', 'O arquivo solicitado não está mais disponível.', ['status' => 404]);
        }
        return $path;
    }

    private static function decrypt_upload(array $file): string|WP_Error {
        $path = self::stored_file_path($file);
        if (is_wp_error($path)) return $path;
        if (!function_exists('openssl_decrypt')) {
            return new WP_Error('kodety_forms_file_crypto', 'OpenSSL é necessário para abrir arquivos enviados.', ['status' => 503]);
        }
        $blob = file_get_contents($path);
        $header_length = strlen(self::FILE_MAGIC) + 12 + 16;
        if (!is_string($blob) || strlen($blob) <= $header_length || !str_starts_with($blob, self::FILE_MAGIC)) {
            return new WP_Error('kodety_forms_file_crypto', 'O arquivo privado está corrompido.', ['status' => 500]);
        }
        $offset = strlen(self::FILE_MAGIC);
        $key = hash('sha256', wp_salt('auth') . '|' . self::FILE_AAD, true);
        $plain = openssl_decrypt(
            substr($blob, $offset + 28),
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            substr($blob, $offset, 12),
            substr($blob, $offset + 12, 16),
            self::FILE_AAD
        );
        if (!is_string($plain) || !hash_equals((string) ($file['sha256'] ?? ''), hash('sha256', $plain))) {
            return new WP_Error('kodety_forms_file_crypto', 'O arquivo privado não pôde ser autenticado.', ['status' => 500]);
        }
        return $plain;
    }

    private function delete_stored_files(array $files): void {
        $root = self::file_storage_root();
        if (is_wp_error($root)) return;
        $root_real = realpath($root);
        if (!is_string($root_real)) return;
        foreach ($files as $file) {
            if (!is_array($file)) continue;
            $path = self::stored_file_path($file);
            if (is_wp_error($path)) continue;
            @unlink($path);
            $directory = dirname($path);
            while ($directory !== $root_real && str_starts_with($directory, trailingslashit($root_real))) {
                if (!@rmdir($directory)) break;
                $directory = dirname($directory);
            }
        }
    }

    public function receive_submission(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $settings = self::settings();
        if (empty($settings['enabled'])) return new WP_Error('kodety_forms_disabled', 'Os formulários estão desativados.', ['status' => 503]);
        if (!$this->request_origin_allowed($request)) return new WP_Error('kodety_forms_origin', 'Origem não autorizada.', ['status' => 403]);
        $content_length = (int) $request->get_header('content-length');
        if ($content_length > self::MAX_FORM_PAYLOAD_BYTES + self::MAX_UPLOAD_TOTAL_BYTES + 65536) {
            return new WP_Error('kodety_forms_size', 'O envio ultrapassa o limite permitido.', ['status' => 413]);
        }

        $raw = $request->get_json_params();
        if (!is_array($raw)) $raw = $request->get_params();
        $encoded_raw = wp_json_encode($raw);
        $uploaded_files = self::normalize_uploaded_files($request->get_file_params());
        $uploaded_bytes = array_sum(array_map(static fn(array $file): int => absint($file['size'] ?? 0), $uploaded_files));
        if (!is_string($encoded_raw) || strlen($encoded_raw) > self::MAX_FORM_PAYLOAD_BYTES) {
            return new WP_Error('kodety_forms_size', 'Os campos do formulário ultrapassam 256 KB.', ['status' => 413]);
        }
        if ($uploaded_bytes > self::MAX_UPLOAD_TOTAL_BYTES) {
            return new WP_Error('kodety_forms_file_size', 'Os arquivos enviados podem somar no máximo 10 MB.', ['status' => 413]);
        }
        if (!empty($raw['_kodety_hp'])) return new WP_REST_Response(['success' => true, 'message' => $settings['success_message']], 200);
        $started_at = (int) ($raw['_kodety_started'] ?? 0);
        $now_ms = (int) floor(microtime(true) * 1000);
        if ($started_at <= 0 || $started_at > $now_ms + 60000 || $now_ms - $started_at < 800 || $now_ms - $started_at > DAY_IN_SECONDS * 1000) {
            return new WP_Error('kodety_forms_timing', 'O formulário expirou. Recarregue a página e tente novamente.', ['status' => 400]);
        }
        $form_key = sanitize_title((string) ($raw['_kodety_form'] ?? 'formulario')) ?: 'formulario';
        if (self::sensitive_field_name($form_key) || self::sensitive_scalar_value($form_key)) $form_key = 'formulario';
        $cms_configuration = $this->cms_submission_configuration($raw, $form_key);
        if (is_wp_error($cms_configuration)) return $cms_configuration;
        $page_url = self::source_url_for_storage((string) (
            $request->get_header('referer')
            ?: ($raw['_kodety_page_url'] ?? $raw['page_url'] ?? '')
        ));
        $referrer = self::source_url_for_storage((string) ($raw['_kodety_referrer'] ?? $raw['referrer'] ?? ''));
        unset(
            $raw['_kodety_hp'],
            $raw['_kodety_form'],
            $raw['_kodety_started'],
            $raw['_kodety_page_url'],
            $raw['_kodety_referrer'],
            $raw['_kodety_cms_collection'],
            $raw['_kodety_cms_status'],
            $raw['_kodety_cms_map'],
            $raw['_kodety_cms_token'],
            $raw['_wpnonce'],
            $raw['_wp_http_referer'],
            $raw['_locale'],
            $raw['page_url'],
            $raw['referrer']
        );
        if ($this->payload_contains_prohibited_data($raw) || $this->files_contain_sensitive_data($uploaded_files)) {
            return new WP_Error(
                'kodety_forms_sensitive_data',
                'Por segurança, formulários Onun Kodety não aceitam credenciais nem dados de cartão.',
                ['status' => 422]
            );
        }
        $payload = $this->sanitize_payload($raw);
        $has_file = count(array_filter(
            $uploaded_files,
            static fn(array $file): bool => (int) ($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_NO_FILE
                || (string) ($file['name'] ?? '') !== ''
        )) > 0;
        if (!is_array($payload) || (!$payload && !$has_file)) return new WP_Error('kodety_forms_empty', 'Nenhum campo foi enviado.', ['status' => 400]);
        if ($this->payload_contains_sensitive_data($payload)) {
            return new WP_Error('kodety_forms_sensitive_data', 'O envio contém dados que não podem ser armazenados.', ['status' => 422]);
        }

        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        $source_hash = hash_hmac('sha256', $ip, wp_salt('nonce'));
        $rate_key = 'kodety_form_rate_' . substr($source_hash, 0, 32);
        $rate = (int) get_transient($rate_key);
        if ($rate >= 12) return new WP_Error('kodety_forms_rate', 'Muitos envios. Aguarde alguns minutos.', ['status' => 429]);
        set_transient($rate_key, $rate + 1, 10 * MINUTE_IN_SECONDS);

        // Bound aggregate mail / CRM work after the cheap bot checks. The
        // per-client limiter above remains the primary control; this circuit
        // breaker protects small hosts during a distributed wave.
        $global_rate_key = 'kodety_form_rate_global';
        $global_rate = (int) get_transient($global_rate_key);
        if ($global_rate >= 120) return new WP_Error('kodety_forms_busy', 'Muitos envios no momento. Tente novamente em instantes.', ['status' => 429]);
        set_transient($global_rate_key, $global_rate + 1, MINUTE_IN_SECONDS);

        $files = $this->store_uploaded_files($uploaded_files, true);
        if (is_wp_error($files)) return $files;
        $public_files = self::public_file_metadata($files);

        // A double click, network retry or back/forward restoration must not
        // create duplicate inbox rows and duplicate external automation calls.
        $dedupe_key = 'kodety_form_duplicate_' . substr(hash(
            'sha256',
            $source_hash . '|' . $form_key . '|' . (string) wp_json_encode($cms_configuration) . '|' . (string) wp_json_encode($payload) . '|' . implode('|', array_map(
                static fn(array $file): string => (string) ($file['sha256'] ?? ''),
                $files
            ))
        ), 0, 32);
        if (get_transient($dedupe_key)) {
            $this->delete_stored_files($files);
            return new WP_REST_Response(['success' => true, 'message' => $settings['success_message'], 'duplicate' => true], 200);
        }

        $reply_field = sanitize_key((string) ($settings['reply_to_field'] ?? 'email')) ?: 'email';
        $email = sanitize_email($this->find_value($payload, array_values(array_unique([$reply_field, 'email', 'e-mail', 'mail', 'email_address']))));
        $name = $this->find_value($payload, ['name', 'nome', 'full_name', 'fullname']);
        $subject = $this->find_value($payload, ['subject', 'assunto']);
        $user_agent = self::truncate(sanitize_text_field((string) $request->get_header('user-agent')), 500);
        if (self::sensitive_scalar_value($user_agent)) $user_agent = self::REDACTED_VALUE;
        $now = current_time('mysql', true);
        global $wpdb;
        $inserted = $wpdb->insert(self::table(), [
            'form_key' => $form_key,
            'page_url' => $page_url,
            'referrer' => $referrer,
            'sender_email' => $email,
            'sender_name' => self::truncate($name, 191),
            'subject' => self::truncate($subject, 255),
            'payload' => (string) wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'files' => (string) wp_json_encode($files, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'status' => 'new',
            'source_hash' => $source_hash,
            'user_agent' => $user_agent,
            'delivery_status' => 'pending',
            'integration_status' => 'pending',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        if (!$inserted) {
            $this->delete_stored_files($files);
            return new WP_Error('kodety_forms_storage', 'Não foi possível guardar o envio.', ['status' => 500]);
        }
        $id = (int) $wpdb->insert_id;
        $cms_item = null;
        if (is_array($cms_configuration)) {
            $cms_values = [];
            foreach ($cms_configuration['mapping'] as $source => $target) {
                $payload_key = array_key_exists($source, $payload)
                    ? $source
                    : (str_ends_with($source, '[]') && array_key_exists(substr($source, 0, -2), $payload) ? substr($source, 0, -2) : '');
                if ($payload_key !== '') $cms_values[$target] = $payload[$payload_key];
            }
            if (!$cms_values) {
                $wpdb->delete(self::table(), ['id' => $id], ['%d']);
                $this->delete_stored_files($files);
                return new WP_Error('kodety_form_cms_empty', 'Nenhum campo conectado ao CMS foi enviado.', ['status' => 422]);
            }
            if (!class_exists('Kodety_Plugin')) {
                $wpdb->delete(self::table(), ['id' => $id], ['%d']);
                $this->delete_stored_files($files);
                return new WP_Error('kodety_form_cms_unavailable', 'O CMS não está disponível neste site.', ['status' => 503]);
            }
            $cms_item = Kodety_Plugin::instance()->create_cms_item_from_form(
                $cms_configuration['collection'],
                $cms_values,
                $cms_configuration['status']
            );
            if (is_wp_error($cms_item)) {
                $wpdb->delete(self::table(), ['id' => $id], ['%d']);
                $this->delete_stored_files($files);
                $cms_error_data = $cms_item->get_error_data();
                return new WP_Error(
                    'kodety_form_cms_create',
                    'O formulário foi validado, mas o item não pôde ser criado no CMS: ' . $cms_item->get_error_message(),
                    ['status' => is_array($cms_error_data) ? (int) ($cms_error_data['status'] ?? 500) : 500, 'cause' => $cms_item->get_error_code()]
                );
            }
        }
        set_transient($dedupe_key, $id, 90);
        $submission = ['id' => $id, 'form' => $form_key, 'name' => $name, 'email' => $email, 'subject' => $subject, 'fields' => $payload, 'files' => $public_files, 'pageUrl' => $page_url, 'createdAt' => $now, 'cmsItem' => $cms_item];
        $mail_ok = $this->notify_email($submission, $settings);
        $integration_status = $this->dispatch_integrations($submission, $settings);
        /**
         * Lets first-party systems such as Analytics funnels react to an
         * accepted, persisted submission without weakening the public form
         * endpoint or duplicating its validation/rate limiting.
         */
        do_action('kodety_form_submitted', $submission);
        $wpdb->update(self::table(), ['delivery_status' => $mail_ok ? 'sent' : 'failed', 'integration_status' => $integration_status, 'updated_at' => current_time('mysql', true)], ['id' => $id]);
        return new WP_REST_Response([
            'success' => true,
            'message' => $settings['success_message'],
            'submissionId' => $id,
            'cmsItem' => $cms_item,
        ], 201);
    }

    private function notify_email(array $submission, array $settings): bool {
        $recipients = array_values(array_filter(array_map('sanitize_email', preg_split('/[,;\s]+/', (string) $settings['recipient_email']) ?: [])));
        if (!$recipients) return false;
        $subject = str_replace(['{form}', '{name}', '{email}'], [$submission['form'], $submission['name'], $submission['email']], (string) $settings['email_subject']);
        $rows = '';
        foreach ($submission['fields'] as $key => $value) {
            $display = is_array($value) ? implode(', ', array_map('strval', $value)) : (string) $value;
            $rows .= '<tr><th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd">' . esc_html((string) $key) . '</th><td style="padding:8px 12px;border-bottom:1px solid #ddd">' . nl2br(esc_html($display)) . '</td></tr>';
        }
        $files_notice = !empty($submission['files'])
            ? '<p><strong>' . count($submission['files']) . ' arquivo(s)</strong> disponível(is) para download autenticado no Onun Kodety.</p>'
            : '';
        $body = '<h2>Novo envio · ' . esc_html($submission['form']) . '</h2><table cellspacing="0" style="border-collapse:collapse;width:100%">' . $rows . '</table>' . $files_notice . '<p><a href="' . esc_url(admin_url('admin.php?page=kodety-emails&submission=' . $submission['id'])) . '">Abrir no Onun Kodety</a></p>';
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        if ($submission['email']) $headers[] = 'Reply-To: ' . ($submission['name'] ? sanitize_text_field($submission['name']) . ' <' . $submission['email'] . '>' : $submission['email']);
        return wp_mail($recipients, sanitize_text_field($subject), $body, $headers);
    }

    public function cleanup_expired(): void {
        global $wpdb;
        $days = max(30, min(3650, absint(self::settings()['retention_days'] ?? 365)));
        $cutoff = gmdate('Y-m-d H:i:s', time() - ($days * DAY_IN_SECONDS));
        // Process bounded batches so cleanup does not monopolize a small host.
        for ($batch = 0; $batch < 20; $batch++) {
            $rows = $wpdb->get_results(
                $wpdb->prepare('SELECT id, files FROM ' . self::table() . ' WHERE created_at < %s ORDER BY id ASC LIMIT 250', $cutoff),
                ARRAY_A
            ) ?: [];
            if (!$rows) break;
            $ids = array_values(array_filter(array_map('absint', array_column($rows, 'id'))));
            if (!$ids) break;
            $placeholders = implode(',', array_fill(0, count($ids), '%d'));
            $deleted = $wpdb->query($wpdb->prepare(
                'DELETE FROM ' . self::table() . " WHERE created_at < %s AND id IN ({$placeholders})",
                $cutoff,
                ...$ids
            ));
            if ($deleted === false || $deleted === 0) break;
            foreach ($rows as $row) {
                $files = json_decode((string) ($row['files'] ?? ''), true);
                if (is_array($files)) $this->delete_stored_files($files);
            }
            if (count($rows) < 250) break;
        }
    }

    private static function integration_idempotency_key(array $submission, string $scope): string {
        $submission_id = absint($submission['id'] ?? 0);
        $identity = $submission_id > 0
            ? 'submission:' . $submission_id
            : (string) wp_json_encode([
                'form' => (string) ($submission['form'] ?? ''),
                'email' => (string) ($submission['email'] ?? ''),
                'createdAt' => (string) ($submission['createdAt'] ?? ''),
                'fields' => is_array($submission['fields'] ?? null) ? $submission['fields'] : [],
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return 'kodety-form-' . substr(hash_hmac('sha256', $scope . '|' . $identity, wp_salt('nonce')), 0, 40);
    }

    private static function integration_endpoint(string $url): string {
        $url = esc_url_raw(trim($url));
        return $url !== '' && wp_http_validate_url($url) ? $url : '';
    }

    private static function integration_request(
        string $url,
        array $headers,
        string $body,
        array $submission,
        string $scope
    ): mixed {
        $url = self::integration_endpoint($url);
        if ($url === '') return new WP_Error('kodety_forms_integration_url', 'A integração possui uma URL inválida ou privada.');
        $headers['X-Kodety-Idempotency-Key'] = self::integration_idempotency_key($submission, $scope);
        return wp_safe_remote_post($url, [
            'timeout' => 8,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => 1024 * 1024,
            'headers' => $headers,
            'body' => $body,
            'data_format' => 'body',
        ]);
    }

    private function dispatch_integrations(array $submission, array $settings): string {
        $attempted = false;
        $success = true;
        $json = (string) wp_json_encode($submission, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!empty($settings['webhook_url'])) {
            $attempted = true;
            $headers = ['Content-Type' => 'application/json', 'X-Kodety-Event' => 'form.submitted'];
            if (!empty($settings['webhook_secret'])) $headers['X-Kodety-Signature'] = 'sha256=' . hash_hmac('sha256', $json, (string) $settings['webhook_secret']);
            $response = self::integration_request((string) $settings['webhook_url'], $headers, $json, $submission, 'webhook');
            $code = wp_remote_retrieve_response_code($response);
            $success = $success && !is_wp_error($response) && $code >= 200 && $code < 300;
        }
        if (!empty($settings['api_url'])) {
            $attempted = true;
            $headers = ['Content-Type' => 'application/json'];
            if (!empty($settings['api_bearer'])) $headers['Authorization'] = 'Bearer ' . trim((string) $settings['api_bearer']);
            $custom = self::decode_api_headers((string) $settings['api_headers']);
            if (is_wp_error($custom)) {
                $success = false;
            } else {
                foreach ($custom as $key => $value) $headers[$key] = $value;
                $response = self::integration_request((string) $settings['api_url'], $headers, $json, $submission, 'api');
                $code = wp_remote_retrieve_response_code($response);
                $success = $success && !is_wp_error($response) && $code >= 200 && $code < 300;
            }
        }
        if (!empty($settings['activecampaign_url']) && !empty($settings['activecampaign_key']) && $submission['email']) {
            $attempted = true;
            $base = untrailingslashit((string) $settings['activecampaign_url']);
            $names = preg_split('/\s+/', trim((string) $submission['name']), 2) ?: [];
            $contact_response = self::integration_request(
                $base . '/api/3/contact/sync',
                ['Content-Type' => 'application/json', 'Api-Token' => (string) $settings['activecampaign_key']],
                (string) wp_json_encode(['contact' => ['email' => $submission['email'], 'firstName' => $names[0] ?? '', 'lastName' => $names[1] ?? '', 'phone' => $this->find_value($submission['fields'], ['phone', 'telefone', 'phone_number'])]]),
                $submission,
                'activecampaign-contact'
            );
            $contact_data = is_wp_error($contact_response) ? [] : json_decode((string) wp_remote_retrieve_body($contact_response), true);
            $contact_id = absint($contact_data['contact']['id'] ?? 0);
            $contact_code = wp_remote_retrieve_response_code($contact_response);
            $contact_ok = !is_wp_error($contact_response) && $contact_code >= 200 && $contact_code < 300 && $contact_id;
            $success = $success && (bool) $contact_ok;
            if ($contact_ok && !empty($settings['activecampaign_list_id'])) {
                $list_id = absint($settings['activecampaign_list_id']);
                $list_response = self::integration_request(
                    $base . '/api/3/contactLists',
                    ['Content-Type' => 'application/json', 'Api-Token' => (string) $settings['activecampaign_key']],
                    (string) wp_json_encode(['contactList' => ['list' => (string) $list_id, 'contact' => (string) $contact_id, 'status' => 1]]),
                    $submission,
                    'activecampaign-list:' . $list_id
                );
                $list_code = wp_remote_retrieve_response_code($list_response);
                $list_data = is_wp_error($list_response) ? [] : json_decode((string) wp_remote_retrieve_body($list_response), true);
                $success = $success
                    && !is_wp_error($list_response)
                    && $list_code >= 200
                    && $list_code < 300
                    && absint($list_data['contactList']['id'] ?? 0) > 0;
            }
        }
        return $attempted ? ($success ? 'sent' : 'failed') : 'idle';
    }

    public function save_settings(): void {
        if (!current_user_can('kodety_manage_emails')) wp_die('Sem permissão.', '', ['response' => 403]);
        check_admin_referer('kodety_emails_save_settings');
        $input = wp_unslash($_POST);
        $section = sanitize_key((string) ($input['settings_section'] ?? 'settings'));
        $settings = self::settings();
        if ($section === 'connections') {
            if (!current_user_can('manage_options')) wp_die('Somente administradores podem alterar conexões e segredos.', '', ['response' => 403]);
            $settings['webhook_url'] = esc_url_raw((string) ($input['webhook_url'] ?? ''));
            $settings['api_url'] = esc_url_raw((string) ($input['api_url'] ?? ''));
            $settings['activecampaign_url'] = esc_url_raw((string) ($input['activecampaign_url'] ?? ''));
            $settings['activecampaign_list_id'] = (string) absint($input['activecampaign_list_id'] ?? 0);
            foreach (['webhook_url', 'api_url', 'activecampaign_url'] as $endpoint_key) {
                if ($settings[$endpoint_key] !== '' && !wp_http_validate_url((string) $settings[$endpoint_key])) {
                    wp_die('A conexão contém uma URL privada ou inválida.', 'URL de integração inválida', ['response' => 400, 'back_link' => true]);
                }
            }
            $secret_fields = [
                'webhook_secret' => 'sanitize_text_field',
                'api_bearer' => 'sanitize_text_field',
                'activecampaign_key' => 'sanitize_text_field',
            ];
            foreach ($secret_fields as $secret_key => $sanitizer) {
                if (!empty($input['clear_' . $secret_key])) $settings[$secret_key] = '';
                elseif (isset($input[$secret_key]) && trim((string) $input[$secret_key]) !== '') {
                    $settings[$secret_key] = $sanitizer((string) $input[$secret_key]);
                }
            }
            if (!empty($input['clear_api_headers'])) {
                $settings['api_headers'] = '';
            } elseif (isset($input['api_headers']) && trim((string) $input['api_headers']) !== '') {
                $headers = self::normalize_api_headers_json((string) $input['api_headers']);
                if (is_wp_error($headers)) {
                    wp_die($headers->get_error_message(), 'Headers de integração inválidos', ['response' => 422, 'back_link' => true]);
                }
                $settings['api_headers'] = $headers;
            }
        } else {
            $settings['enabled'] = !empty($input['enabled']);
            $settings['recipient_email'] = sanitize_text_field((string) ($input['recipient_email'] ?? ''));
            $settings['email_subject'] = sanitize_text_field((string) ($input['email_subject'] ?? ''));
            $settings['reply_to_field'] = sanitize_key((string) ($input['reply_to_field'] ?? 'email'));
            $settings['success_message'] = sanitize_text_field((string) ($input['success_message'] ?? ''));
            $settings['error_message'] = sanitize_text_field((string) ($input['error_message'] ?? ''));
            $settings['retention_days'] = max(30, min(3650, absint($input['retention_days'] ?? 365)));
        }
        $protected = self::protect_settings($settings);
        if (is_wp_error($protected)) {
            wp_die($protected->get_error_message(), 'Credenciais de integração indisponíveis', ['response' => 503, 'back_link' => true]);
        }
        update_option(self::OPTION_SETTINGS, $protected, false);
        wp_safe_redirect(add_query_arg(['page' => 'kodety-emails', 'tab' => $section === 'connections' ? 'connections' : 'settings', 'updated' => '1'], admin_url('admin.php')));
        exit;
    }

    public function update_submission(): void {
        if (!current_user_can('kodety_manage_emails')) wp_die('Sem permissão.', '', ['response' => 403]);
        $id = absint($_POST['submission_id'] ?? 0);
        check_admin_referer('kodety_emails_update_' . $id);
        $status = sanitize_key((string) ($_POST['status'] ?? 'read'));
        if (!in_array($status, ['new', 'read', 'archived', 'spam'], true)) $status = 'read';
        global $wpdb;
        $wpdb->update(self::table(), ['status' => $status, 'updated_at' => current_time('mysql', true)], ['id' => $id]);
        wp_safe_redirect(add_query_arg(['page' => 'kodety-emails', 'submission' => $id], admin_url('admin.php')));
        exit;
    }

    private function delete_submission_record(int $id): bool {
        if ($id <= 0) return false;
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare('SELECT id, files FROM ' . self::table() . ' WHERE id=%d', $id), ARRAY_A);
        if (!is_array($row)) return false;
        $deleted = $wpdb->delete(self::table(), ['id' => $id], ['%d']);
        if ($deleted !== 1) return false;
        $files = json_decode((string) ($row['files'] ?? ''), true);
        if (is_array($files)) $this->delete_stored_files($files);
        return true;
    }

    public function delete_submission(): void {
        if (!current_user_can('kodety_manage_emails')) wp_die('Sem permissão.', '', ['response' => 403]);
        $id = absint($_POST['submission_id'] ?? 0);
        check_admin_referer('kodety_emails_delete_' . $id);
        if (!$this->delete_submission_record($id)) wp_die('Envio não encontrado.', '', ['response' => 404]);
        wp_safe_redirect(admin_url('admin.php?page=kodety-emails&deleted=1'));
        exit;
    }

    public function download_file(): void {
        if (!current_user_can('kodety_manage_emails')) wp_die('Sem permissão.', '', ['response' => 403]);
        $submission_id = absint($_GET['submission_id'] ?? 0);
        $file_id = sanitize_key((string) ($_GET['file_id'] ?? ''));
        if ($submission_id <= 0 || !preg_match('/^[a-f0-9]{32}$/D', $file_id)) {
            wp_die('Arquivo inválido.', '', ['response' => 404]);
        }
        check_admin_referer('kodety_emails_download_file_' . $submission_id . '_' . $file_id);
        global $wpdb;
        $encoded = $wpdb->get_var($wpdb->prepare('SELECT files FROM ' . self::table() . ' WHERE id=%d', $submission_id));
        $files = json_decode((string) $encoded, true);
        $file = null;
        foreach (is_array($files) ? $files : [] as $candidate) {
            if (is_array($candidate) && hash_equals($file_id, (string) ($candidate['id'] ?? ''))) {
                $file = $candidate;
                break;
            }
        }
        if (!is_array($file)) wp_die('Arquivo não encontrado.', '', ['response' => 404]);
        $contents = self::decrypt_upload($file);
        if (is_wp_error($contents)) {
            $error_data = $contents->get_error_data();
            $error_status = is_array($error_data) ? absint($error_data['status'] ?? 500) : 500;
            wp_die($contents->get_error_message(), '', ['response' => $error_status]);
        }
        $name = sanitize_file_name((string) ($file['name'] ?? 'arquivo'));
        if ($name === '') $name = 'arquivo';
        $fallback = function_exists('remove_accents') ? remove_accents($name) : $name;
        $fallback = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $fallback) ?: 'arquivo';
        while (ob_get_level() > 0) ob_end_clean();
        nocache_headers();
        header('Content-Type: ' . sanitize_mime_type((string) ($file['type'] ?? 'application/octet-stream')));
        header('Content-Disposition: attachment; filename="' . str_replace(['"', "\r", "\n"], '', $fallback) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
        header('Content-Length: ' . strlen($contents));
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        echo $contents; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- authenticated binary download.
        exit;
    }

    public function bulk_update(): void {
        if (!current_user_can('kodety_manage_emails')) wp_die('Sem permissão.', '', ['response' => 403]);
        check_admin_referer('kodety_emails_bulk');
        $ids = array_values(array_filter(array_map('absint', (array) ($_POST['submission_ids'] ?? []))));
        $status = sanitize_key((string) ($_POST['bulk_action'] ?? 'read'));
        if (!$ids || !in_array($status, ['new', 'read', 'archived', 'spam', 'delete'], true)) { wp_safe_redirect(admin_url('admin.php?page=kodety-emails')); exit; }
        global $wpdb;
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        if ($status === 'delete') {
            $rows = $wpdb->get_results(
                $wpdb->prepare('SELECT id, files FROM ' . self::table() . " WHERE id IN ({$placeholders})", ...$ids),
                ARRAY_A
            ) ?: [];
            $deleted = $wpdb->query($wpdb->prepare('DELETE FROM ' . self::table() . " WHERE id IN ({$placeholders})", ...$ids));
            if ($deleted !== false) {
                foreach ($rows as $row) {
                    $files = json_decode((string) ($row['files'] ?? ''), true);
                    if (is_array($files)) $this->delete_stored_files($files);
                }
            }
            wp_safe_redirect(admin_url('admin.php?page=kodety-emails&deleted=1'));
            exit;
        }
        $wpdb->query($wpdb->prepare("UPDATE " . self::table() . " SET status=%s, updated_at=%s WHERE id IN ({$placeholders})", $status, current_time('mysql', true), ...$ids));
        wp_safe_redirect(admin_url('admin.php?page=kodety-emails'));
        exit;
    }

    private function query_submissions(): array {
        global $wpdb;
        $status = sanitize_key((string) ($_GET['status'] ?? ''));
        $form = sanitize_title((string) ($_GET['form'] ?? ''));
        $search = sanitize_text_field((string) ($_GET['s'] ?? ''));
        $paged = max(1, absint($_GET['paged'] ?? 1));
        $where = ['1=1']; $args = [];
        if (in_array($status, ['new', 'read', 'archived', 'spam'], true)) { $where[] = 'status=%s'; $args[] = $status; }
        if ($form !== '') { $where[] = 'form_key=%s'; $args[] = $form; }
        if ($search !== '') { $like = '%' . $wpdb->esc_like($search) . '%'; $where[] = '(sender_name LIKE %s OR sender_email LIKE %s OR subject LIKE %s OR payload LIKE %s)'; array_push($args, $like, $like, $like, $like); }
        $sql_where = implode(' AND ', $where);
        $table = self::table();
        $total = (int) $wpdb->get_var($args ? $wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE {$sql_where}", ...$args) : "SELECT COUNT(*) FROM {$table} WHERE {$sql_where}");
        $query_args = array_merge($args, [30, ($paged - 1) * 30]);
        $items = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$table} WHERE {$sql_where} ORDER BY created_at DESC LIMIT %d OFFSET %d", ...$query_args), ARRAY_A) ?: [];
        return compact('items', 'total', 'paged');
    }

    public function render_admin_page(): void {
        if (!current_user_can('kodety_manage_emails')) return;
        global $wpdb;
        $table = self::table();
        $counts = array_fill_keys(['new', 'read', 'archived', 'spam'], 0);
        foreach ($wpdb->get_results("SELECT status, COUNT(*) total FROM {$table} GROUP BY status", ARRAY_A) ?: [] as $row) $counts[$row['status']] = (int) $row['total'];
        $forms = $wpdb->get_col("SELECT DISTINCT form_key FROM {$table} WHERE form_key<>'' ORDER BY form_key") ?: [];
        $tab = sanitize_key((string) ($_GET['tab'] ?? 'inbox'));
        $can_manage_connections = current_user_can('manage_options');
        if ($tab === 'connections' && !$can_manage_connections) $tab = 'inbox';
        $submission_id = absint($_GET['submission'] ?? 0);
        $settings = self::settings();
        ?>
        <div class="wrap kodety-emails">
            <header class="kodety-emails__header">
                <div><p class="kodety-eyebrow">Onun Kodety Forms</p><h1>Emails</h1><p>Envios do site, notificações e integrações em um único lugar.</p></div>
                <nav class="kodety-email-tabs" aria-label="Seções de Emails">
                    <a class="kodety-email-tab <?php echo $tab === 'inbox' ? 'is-current' : ''; ?>" <?php echo $tab === 'inbox' ? 'aria-current="page"' : ''; ?> href="<?php echo esc_url(admin_url('admin.php?page=kodety-emails')); ?>">Caixa de entrada</a>
                    <a class="kodety-email-tab <?php echo $tab === 'settings' ? 'is-current' : ''; ?>" <?php echo $tab === 'settings' ? 'aria-current="page"' : ''; ?> href="<?php echo esc_url(admin_url('admin.php?page=kodety-emails&tab=settings')); ?>">Configurações</a>
                    <?php if ($can_manage_connections): ?><a class="kodety-email-tab <?php echo $tab === 'connections' ? 'is-current' : ''; ?>" <?php echo $tab === 'connections' ? 'aria-current="page"' : ''; ?> href="<?php echo esc_url(admin_url('admin.php?page=kodety-emails&tab=connections')); ?>">Conexões</a><?php endif; ?>
                </nav>
            </header>
            <?php if ($tab === 'settings'): $this->render_settings($settings); elseif ($tab === 'connections'): $this->render_connections($settings); elseif ($submission_id): $this->render_submission($submission_id); else: $this->render_inbox($counts, $forms); endif; ?>
        </div>
        <?php
    }

    private function render_inbox(array $counts, array $forms): void {
        $result = $this->query_submissions();
        $active_status = sanitize_key((string) ($_GET['status'] ?? ''));
        $delivery_labels = ['pending' => 'Pendente', 'sent' => 'Enviado', 'failed' => 'Falha no envio'];
        ?>
        <section class="kodety-email-inbox"><section class="kodety-email-stats"><?php foreach ([['new','Novos'],['read','Lidos'],['archived','Arquivados'],['spam','Spam']] as [$key,$label]): ?><a class="<?php echo $active_status === $key ? 'is-current' : ''; ?>" href="<?php echo esc_url(add_query_arg(['page'=>'kodety-emails','status'=>$key], admin_url('admin.php'))); ?>"><span><?php echo esc_html($label); ?></span><strong><?php echo Kodety_Admin_I18n::instance()->format_number($counts[$key] ?? 0); ?></strong></a><?php endforeach; ?></section>
        <form class="kodety-email-filters" method="get"><input type="hidden" name="page" value="kodety-emails"><input type="search" name="s" value="<?php echo esc_attr((string) ($_GET['s'] ?? '')); ?>" placeholder="Buscar mensagens" aria-label="Buscar nome, email, assunto ou conteúdo"><select name="status" aria-label="Status"><option value="">Todos os status</option><?php foreach (['new'=>'Novos','read'=>'Lidos','archived'=>'Arquivados','spam'=>'Spam'] as $key=>$label): ?><option value="<?php echo esc_attr($key); ?>" <?php selected($active_status,$key); ?>><?php echo esc_html($label); ?></option><?php endforeach; ?></select><select name="form" aria-label="Formulário"><option value="">Todos os formulários</option><?php foreach ($forms as $form): ?><option value="<?php echo esc_attr($form); ?>" <?php selected((string) ($_GET['form'] ?? ''),$form); ?>><?php echo esc_html($form); ?></option><?php endforeach; ?></select><button class="button button-primary">Filtrar</button></form>
        <form class="kodety-email-inbox__list" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="kodety_emails_bulk"><?php wp_nonce_field('kodety_emails_bulk'); ?><div class="kodety-email-bulk"><select name="bulk_action" aria-label="Ações em massa"><option value="read">Marcar como lido</option><option value="new">Marcar como novo</option><option value="archived">Arquivar</option><option value="spam">Marcar como spam</option><option value="delete">Excluir permanentemente</option></select><button class="button">Aplicar</button><span><?php echo esc_html(Kodety_Admin_I18n::instance()->format_number($result['total']) . ((int) $result['total'] === 1 ? ' envio' : ' envios')); ?></span></div><div class="kodety-email-table"><table><thead><tr><th><label class="kodety-email-select-all"><input type="checkbox" data-kodety-check-all><span>Selecionar todos desta página</span></label></th><th>Contato</th><th>Formulário</th><th>Assunto / conteúdo</th><th>Entrega</th><th>Recebido</th></tr></thead><tbody><?php if (!$result['items']): ?><tr><td colspan="6" class="kodety-email-empty">Nenhum envio encontrado.</td></tr><?php endif; foreach ($result['items'] as $item): $payload=json_decode((string)$item['payload'],true)?:[]; ?><tr class="is-<?php echo esc_attr($item['status']); ?>"><td><input type="checkbox" name="submission_ids[]" value="<?php echo absint($item['id']); ?>"></td><td><a class="kodety-email-contact" href="<?php echo esc_url(admin_url('admin.php?page=kodety-emails&submission=' . absint($item['id']))); ?>"><strong><?php echo esc_html($item['sender_name'] ?: 'Sem nome'); ?></strong><span><?php echo esc_html($item['sender_email'] ?: 'Sem email'); ?></span></a></td><td><span class="kodety-email-pill"><?php echo esc_html($item['form_key']); ?></span></td><td><a class="kodety-email-preview" href="<?php echo esc_url(admin_url('admin.php?page=kodety-emails&submission=' . absint($item['id']))); ?>"><strong><?php echo esc_html($item['subject'] ?: array_key_first($payload) ?: 'Novo envio'); ?></strong><span><?php echo esc_html(wp_trim_words(implode(' ', array_map(static fn($v): string => is_scalar($v)?(string)$v:'', $payload)), 14)); ?></span></a></td><td><span class="kodety-delivery is-<?php echo esc_attr($item['delivery_status']); ?>"><?php echo esc_html($delivery_labels[$item['delivery_status']] ?? $item['delivery_status']); ?></span></td><td><?php echo esc_html(Kodety_Admin_I18n::instance()->format_relative_time(strtotime($item['created_at'] . ' UTC'), time())); ?></td></tr><?php endforeach; ?></tbody></table></div></form></section>
        <?php
    }

    private function render_submission(int $id): void {
        global $wpdb;
        $item = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::table() . ' WHERE id=%d', $id), ARRAY_A);
        if (!$item) { echo '<div class="notice kodety-notice notice-error"><p>Envio não encontrado.</p></div>'; return; }
        if ($item['status'] === 'new') $wpdb->update(self::table(), ['status'=>'read','updated_at'=>current_time('mysql',true)], ['id'=>$id]);
        $payload = json_decode((string) $item['payload'], true) ?: [];
        $files = json_decode((string) ($item['files'] ?? ''), true);
        $files = is_array($files) ? $files : [];
        ?>
        <a class="kodety-email-back" href="<?php echo esc_url(admin_url('admin.php?page=kodety-emails')); ?>"><span data-kodety-icon="arrow-left" data-kodety-icon-size="14" aria-hidden="true"></span><span><?php echo esc_html(Kodety_Admin_I18n::instance()->translate('Voltar aos envios')); ?></span></a>
        <div class="kodety-email-detail">
            <main>
                <div class="kodety-email-detail__title">
                    <span class="kodety-email-pill"><?php echo esc_html($item['form_key']); ?></span>
                    <h2><?php echo esc_html($item['subject'] ?: 'Envio #' . $id); ?></h2>
                    <p><?php echo esc_html($item['sender_name']); ?><?php echo $item['sender_email'] ? ' · ' . esc_html($item['sender_email']) : ''; ?></p>
                </div>
                <dl><?php foreach ($payload as $key=>$value): ?><div><dt><?php echo esc_html((string)$key); ?></dt><dd><?php echo nl2br(esc_html(is_array($value)?implode(', ',array_map('strval',$value)):(string)$value)); ?></dd></div><?php endforeach; ?></dl>
                <?php if ($files): ?>
                    <section class="kodety-email-files">
                        <h3>Arquivos enviados</h3>
                        <p>Os arquivos ficam cifrados e só são liberados após autenticação.</p>
                        <ul>
                            <?php foreach ($files as $file):
                                if (!is_array($file)) continue;
                                $file_id = sanitize_key((string) ($file['id'] ?? ''));
                                $download_url = '';
                                if (preg_match('/^[a-f0-9]{32}$/D', $file_id)) {
                                    $download_url = wp_nonce_url(
                                        add_query_arg([
                                            'action' => 'kodety_emails_download_file',
                                            'submission_id' => $id,
                                            'file_id' => $file_id,
                                        ], admin_url('admin-post.php')),
                                        'kodety_emails_download_file_' . $id . '_' . $file_id
                                    );
                                }
                                ?>
                                <li>
                                    <span><strong><?php echo esc_html((string) ($file['name'] ?? 'Arquivo')); ?></strong><small><?php echo esc_html(size_format(absint($file['size'] ?? 0))); ?></small></span>
                                    <?php if ($download_url !== ''): ?><a class="button" href="<?php echo esc_url($download_url); ?>">Baixar</a><?php else: ?><em>Indisponível</em><?php endif; ?>
                                </li>
                            <?php endforeach; ?>
                        </ul>
                    </section>
                <?php endif; ?>
            </main>
            <aside>
                <h3>Ações</h3>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="kodety_emails_update">
                    <input type="hidden" name="submission_id" value="<?php echo $id; ?>">
                    <?php wp_nonce_field('kodety_emails_update_' . $id); ?>
                    <select name="status" aria-label="Status"><?php foreach (['new'=>'Novo','read'=>'Lido','archived'=>'Arquivado','spam'=>'Spam'] as $key=>$label): ?><option value="<?php echo esc_attr($key); ?>" <?php selected($item['status'],$key); ?>><?php echo esc_html($label); ?></option><?php endforeach; ?></select>
                    <button class="button button-primary">Atualizar</button>
                </form>
                <hr>
                <p><b>Página</b><br><a href="<?php echo esc_url($item['page_url']); ?>" target="_blank" rel="noopener"><?php echo esc_html($item['page_url'] ?: 'Não informada'); ?></a></p>
                <p><b>Email</b><br><?php echo esc_html(['pending' => 'Pendente', 'sent' => 'Enviado', 'failed' => 'Falha no envio'][$item['delivery_status']] ?? $item['delivery_status']); ?></p>
                <p><b>Integrações</b><br><?php echo esc_html(['pending' => 'Pendente', 'sent' => 'Concluídas', 'failed' => 'Falha no envio', 'idle' => 'Não configuradas', 'disabled' => 'Desativadas'][$item['integration_status']] ?? $item['integration_status']); ?></p>
                <p><b>Recebido</b><br><?php echo esc_html(Kodety_Admin_I18n::instance()->format_mysql_gmt((string) $item['created_at'])); ?></p>
                <hr>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('Excluir permanentemente este envio e seus arquivos?');">
                    <input type="hidden" name="action" value="kodety_emails_delete">
                    <input type="hidden" name="submission_id" value="<?php echo $id; ?>">
                    <?php wp_nonce_field('kodety_emails_delete_' . $id); ?>
                    <button class="button button-link-delete">Excluir permanentemente</button>
                </form>
            </aside>
        </div>
        <?php
    }

    private function render_settings(array $settings): void {
        $translate = static fn(string $value): string => Kodety_Admin_I18n::instance()->translate($value);
        ?>
        <?php if (isset($_GET['updated'])): ?><div class="notice kodety-notice notice-success is-dismissible"><p>Configurações salvas.</p></div><?php endif; ?>
        <form class="kodety-email-settings" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="kodety_emails_save_settings"><input type="hidden" name="settings_section" value="settings"><?php wp_nonce_field('kodety_emails_save_settings'); ?>
            <section><header><h2>Recebimento</h2><p>Controle a captura e as notificações dos formulários publicados.</p></header><div class="kodety-email-grid"><label class="is-switch"><input type="checkbox" name="enabled" value="1" <?php checked(!empty($settings['enabled'])); ?>><span><b>Captura automática</b><small>Assume formulários sem action externo.</small></span></label><label><span>Enviar notificações para</span><input name="recipient_email" value="<?php echo esc_attr($settings['recipient_email']); ?>" placeholder="voce@empresa.com, time@empresa.com"></label><label><span>Assunto do email</span><input name="email_subject" value="<?php echo esc_attr($translate((string) $settings['email_subject'])); ?>"><small>Tokens: {form}, {name}, {email}</small></label><label><span>Campo usado como Reply-To</span><input name="reply_to_field" value="<?php echo esc_attr($settings['reply_to_field']); ?>"></label><label><span>Mensagem de sucesso</span><input name="success_message" value="<?php echo esc_attr($translate((string) $settings['success_message'])); ?>"></label><label><span>Mensagem de erro</span><input name="error_message" value="<?php echo esc_attr($translate((string) $settings['error_message'])); ?>"></label><label><span>Retenção em dias</span><input type="number" min="30" max="3650" name="retention_days" value="<?php echo absint($settings['retention_days']); ?>"></label></div></section>
            <div class="kodety-email-settings__save"><button class="button button-primary button-hero">Salvar configurações</button></div>
        </form><?php
    }

    private function render_connections(array $settings): void {
        // Zapier e Make são consumidores do mesmo webhook. Sem um card
        // genérico, quem quer apontar para o próprio endpoint não descobre
        // que o mecanismo já existe.
        $catalog = [
            ['Webhook', 'Envie cada submissão como JSON assinado', !empty($settings['webhook_url']), 'webhook'],
            ['ActiveCampaign', 'CRM e automação de marketing', !empty($settings['activecampaign_url']) && !empty($settings['activecampaign_key']), 'activecampaign'],
            ['Zapier', 'Automatize milhares de aplicativos', !empty($settings['webhook_url']), 'webhook'],
            ['Make', 'Fluxos visuais e automações', !empty($settings['webhook_url']), 'webhook'],
            ['HubSpot', 'CRM, vendas e marketing', !empty($settings['api_url']), 'custom-api'],
            ['Mailchimp', 'Email marketing e audiências', !empty($settings['api_url']), 'custom-api'],
            ['Brevo', 'Email, SMS e automações', !empty($settings['api_url']), 'custom-api'],
            ['Salesforce', 'CRM e gestão comercial', !empty($settings['api_url']), 'custom-api'],
            ['API personalizada', 'Conecte qualquer serviço HTTP', !empty($settings['api_url']), 'custom-api'],
        ];
        ?>
        <?php if (isset($_GET['updated'])): ?><div class="notice kodety-notice notice-success is-dismissible"><p>Conexões salvas.</p></div><?php endif; ?>
        <div class="kodety-connections-intro"><div><p class="kodety-eyebrow">Integrações</p><h2>Conecte seus envios</h2><p>Leve cada lead para as ferramentas que seu time já usa.</p></div><span><?php echo count($catalog); ?> opções</span></div>
        <div class="kodety-connection-catalog"><?php foreach ($catalog as [$name,$description,$connected,$panel]): ?><article class="kodety-connection-card"><span><strong><?php echo esc_html($name); ?></strong><small><?php echo esc_html($description); ?></small></span><button type="button" class="kodety-connection-card__action <?php echo $connected ? 'is-connected' : ''; ?>" data-kodety-connection-open="<?php echo esc_attr($panel); ?>" data-kodety-connection-name="<?php echo esc_attr($name); ?>"><?php echo $connected ? 'Gerenciar' : 'Configurar'; ?></button></article><?php endforeach; ?></div>
        <form id="kodety-connections-form" class="kodety-email-settings kodety-connections-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="kodety_emails_save_settings"><input type="hidden" name="settings_section" value="connections"><?php wp_nonce_field('kodety_emails_save_settings'); ?>
            <div class="kodety-connection-modal" data-kodety-connection-modal hidden><div class="kodety-connection-modal__backdrop" data-kodety-connection-close></div><div class="kodety-connection-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="kodety-connection-modal-title"><header class="kodety-connection-modal__header"><div><p class="kodety-eyebrow">Conexão</p><h2 id="kodety-connection-modal-title">Configurar conexão</h2></div><button type="button" class="kodety-connection-modal__close" data-kodety-connection-close aria-label="Fechar"><span data-kodety-icon="x" data-kodety-icon-size="16" aria-hidden="true"></span></button></header><div class="kodety-connection-modal__body">
                <section data-kodety-connection-panel="activecampaign"><header><h3>ActiveCampaign</h3><p>Crie ou atualize contatos automaticamente e adicione-os a uma lista.</p></header><div class="kodety-email-grid"><label><span>URL da conta</span><input type="url" name="activecampaign_url" value="<?php echo esc_attr($settings['activecampaign_url']); ?>" placeholder="https://sua-conta.api-us1.com"></label><label><span>API Key</span><input type="password" name="activecampaign_key" value="" placeholder="<?php echo !empty($settings['activecampaign_key']) ? 'Configurada — deixe vazio para manter' : 'Informe a API Key'; ?>" autocomplete="new-password"><small>A chave salva nunca é exibida novamente.</small><span><input type="checkbox" name="clear_activecampaign_key" value="1"> Remover chave salva</span></label><label><span>ID da lista</span><input type="number" min="1" name="activecampaign_list_id" value="<?php echo esc_attr($settings['activecampaign_list_id']); ?>"></label></div></section>
                <section data-kodety-connection-panel="webhook"><header><h3>Webhook</h3><p>Ideal para Zapier, Make e automações. Cada submissão é enviada como JSON assinado.</p></header><div class="kodety-email-grid"><label><span>URL do webhook</span><input type="url" name="webhook_url" value="<?php echo esc_attr($settings['webhook_url']); ?>" placeholder="https://hooks.exemplo.com/kodety"></label><label><span>Segredo de assinatura</span><input type="password" name="webhook_secret" value="" placeholder="<?php echo !empty($settings['webhook_secret']) ? 'Configurado — deixe vazio para manter' : 'Opcional'; ?>" autocomplete="new-password"><small>Enviado em X-Kodety-Signature e nunca reexibido.</small><span><input type="checkbox" name="clear_webhook_secret" value="1"> Remover segredo salvo</span></label></div></section>
                <section data-kodety-connection-panel="custom-api"><header><h3>API personalizada</h3><p>Conecte este serviço ou qualquer endpoint HTTP que aceite JSON.</p></header><div class="kodety-email-grid"><label><span>Endpoint</span><input type="url" name="api_url" value="<?php echo esc_attr($settings['api_url']); ?>"></label><label><span>Bearer token</span><input type="password" name="api_bearer" value="" placeholder="<?php echo !empty($settings['api_bearer']) ? 'Configurado — deixe vazio para manter' : 'Opcional'; ?>" autocomplete="new-password"><small>O token salvo nunca é exibido novamente.</small><span><input type="checkbox" name="clear_api_bearer" value="1"> Remover token salvo</span></label><label class="is-wide"><span>Headers adicionais (JSON)</span><textarea name="api_headers" placeholder="<?php echo !empty($settings['api_headers']) ? 'Configurados — deixe vazio para manter' : '{&quot;X-Workspace&quot;:&quot;site&quot;}'; ?>"></textarea><small>Headers salvos podem conter segredos e não são reexibidos.</small><span><input type="checkbox" name="clear_api_headers" value="1"> Remover headers salvos</span></label></div></section>
            </div><footer class="kodety-connection-modal__footer"><button type="button" class="button" data-kodety-connection-close>Cancelar</button><button class="button button-primary">Salvar conexão</button></footer></div></div>
        </form><?php
    }
}
