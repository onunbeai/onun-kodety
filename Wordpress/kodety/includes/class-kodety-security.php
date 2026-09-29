<?php

defined('ABSPATH') || exit;

/**
 * Hardens the WordPress administrative surface.
 *
 * Two independent concerns live here. The private login slug moves the form
 * away from wp-login.php so automated traffic stops reaching it — that is
 * obscurity, and it buys quieter logs rather than real protection. The actual
 * protection comes from the baseline guards: login throttling, user
 * enumeration, XML-RPC and the theme/plugin file editor.
 *
 * The real /wp-admin/ path is deliberately left alone. It is a physical
 * directory served by the web server, and renaming it would require rewrite
 * rules plus every plugin that hardcodes the path to cooperate. Blocking it for
 * logged-out visitors reaches the same goal without that fragility.
 */
final class Kodety_Security {
    public const DEFAULT_SLUG = 'kodety-admin';
    private const OPTION = 'kodety_security_settings';
    /**
     * Paths that can never become the private slug: they either belong to
     * WordPress and Onun Kodety, or they are the first guesses a bot makes, which
     * would defeat the point of moving the form at all.
     */
    private const RESERVED_SLUGS = [
        'wp-admin', 'wp-login', 'wp-content', 'wp-includes', 'wp-json',
        'kodety', 'admin', 'login', 'painel', 'index', 'feed', 'sitemap',
    ];
    /**
     * Admin entry points that legitimately answer logged-out requests, so the
     * front-end keeps working while the rest of wp-admin stays closed.
     */
    private const PUBLIC_ADMIN_ENTRIES = ['admin-ajax.php', 'admin-post.php'];

    private static ?self $instance = null;
    private ?array $settings = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('plugins_loaded', [$this, 'boot'], 1);
        add_action('admin_post_kodety_save_security', [$this, 'save_settings']);
    }

    public static function activate(): void {
        add_option(self::OPTION, self::defaults(), '', false);
    }

    public static function defaults(): array {
        return [
            // A fresh install already ships the login moved: leaving it off by
            // default meant most sites never turned it on at all. The address
            // is the documented DEFAULT_SLUG, shown in the security panel, and
            // clearing the field puts wp-login.php back — sanitize_settings()
            // never re-applies this default over an explicitly emptied slug.
            // Recovery for a forgotten address stays in wp-config.php with
            // KODETY_DISABLE_ADMIN_SLUG.
            'admin_slug' => self::DEFAULT_SLUG,
            'login_throttle' => true,
            'login_max_attempts' => 5,
            'login_attempt_window_minutes' => 15,
            'login_lockout_minutes' => 15,
            'generic_login_errors' => true,
            'custom_session_duration' => false,
            'session_hours' => 48,
            'remember_days' => 14,
            'block_enumeration' => true,
            'disable_xmlrpc' => true,
            'disable_file_edit' => true,
            'disable_application_passwords' => false,
            'disable_registration' => false,
            'hide_wp_version' => true,
            'security_headers' => true,
            'frame_policy' => 'sameorigin',
            'referrer_policy' => 'strict-origin-when-cross-origin',
            'permissions_policy' => false,
            'enable_hsts' => false,
            'hsts_max_age_days' => 180,
            'hsts_subdomains' => false,
        ];
    }

    public function settings(): array {
        if ($this->settings !== null) return $this->settings;
        $stored = get_option(self::OPTION, []);
        return $this->settings = self::sanitize_settings(is_array($stored) ? $stored : []);
    }

    public static function sanitize_settings(array $input): array {
        $defaults = self::defaults();
        $settings = ['admin_slug' => self::sanitize_slug((string) ($input['admin_slug'] ?? ''))];
        $boolean_keys = [
            'login_throttle', 'generic_login_errors', 'custom_session_duration',
            'block_enumeration', 'disable_xmlrpc', 'disable_file_edit',
            'disable_application_passwords', 'disable_registration', 'hide_wp_version',
            'security_headers', 'permissions_policy', 'enable_hsts', 'hsts_subdomains',
        ];
        foreach ($boolean_keys as $key) {
            $default = $defaults[$key];
            $settings[$key] = array_key_exists($key, $input) ? (bool) $input[$key] : (bool) $default;
        }
        $integer_ranges = [
            'login_max_attempts' => [3, 20],
            'login_attempt_window_minutes' => [5, 120],
            'login_lockout_minutes' => [5, 1440],
            'session_hours' => [1, 168],
            'remember_days' => [1, 90],
            'hsts_max_age_days' => [1, 730],
        ];
        foreach ($integer_ranges as $key => [$minimum, $maximum]) {
            $value = array_key_exists($key, $input) ? (int) $input[$key] : (int) $defaults[$key];
            $settings[$key] = max($minimum, min($maximum, $value));
        }
        $frame_policy = strtolower((string) ($input['frame_policy'] ?? $defaults['frame_policy']));
        $settings['frame_policy'] = in_array($frame_policy, ['sameorigin', 'deny', 'off'], true)
            ? $frame_policy
            : $defaults['frame_policy'];
        $referrer_policy = strtolower((string) ($input['referrer_policy'] ?? $defaults['referrer_policy']));
        $settings['referrer_policy'] = in_array($referrer_policy, [
            'strict-origin-when-cross-origin', 'same-origin', 'no-referrer', 'origin',
        ], true) ? $referrer_policy : $defaults['referrer_policy'];
        return $settings;
    }

    /**
     * Reduce a submitted slug to a single safe path segment, or '' when it is
     * unusable. Returning '' always means "keep wp-login.php", never "guess".
     */
    public static function sanitize_slug(string $slug): string {
        $slug = trim(trim(wp_unslash($slug)), '/');
        if ($slug === '') return '';
        // A slug is one path segment. Anything nested is refused outright
        // rather than flattened, so the owner never ends up with a login URL
        // they did not type.
        if (str_contains($slug, '/')) return '';
        $slug = sanitize_title($slug);
        if ($slug === '' || in_array($slug, self::RESERVED_SLUGS, true)) return '';
        return $slug;
    }

    /**
     * The slug actually in force for this request.
     *
     * wp-config.php wins over the database so a locked-out owner can recover
     * with KODETY_ADMIN_SLUG, or switch the feature off with
     * KODETY_DISABLE_ADMIN_SLUG, without touching the database.
     */
    public function active_slug(): string {
        if (defined('KODETY_DISABLE_ADMIN_SLUG') && KODETY_DISABLE_ADMIN_SLUG) return '';
        // Multisite shares one login across the network; moving it here would
        // change sites this plugin does not own.
        if (is_multisite()) return '';
        if (defined('KODETY_ADMIN_SLUG')) return self::sanitize_slug((string) KODETY_ADMIN_SLUG);
        return self::sanitize_slug((string) ($this->settings()['admin_slug'] ?? ''));
    }

    public function login_url(): string {
        $slug = $this->active_slug();
        return $slug === '' ? wp_login_url() : home_url('/' . $slug);
    }

    public function login_slug_locked(): bool {
        return is_multisite()
            || defined('KODETY_ADMIN_SLUG')
            || (defined('KODETY_DISABLE_ADMIN_SLUG') && KODETY_DISABLE_ADMIN_SLUG);
    }

    /** One contract for the onboarding field and its server-side validation. */
    public static function onboarding_slug_rules(): array {
        return [
            'pattern' => '[a-z0-9]+(?:-[a-z0-9]+)*',
            'maxLength' => 80,
            'reserved' => self::RESERVED_SLUGS,
        ];
    }

    public function validate_onboarding_slug(mixed $submitted): ?string {
        // A network or wp-config.php override owns the effective URL. Even a
        // forged POST must not overwrite the dormant database setting.
        if ($this->login_slug_locked()) return null;
        if (!is_string($submitted) || trim($submitted) === '') {
            throw new InvalidArgumentException('Defina um endereço para o login antes de continuar.');
        }
        $slug = trim(wp_unslash($submitted));
        $current = (string) ($this->settings()['admin_slug'] ?? '');
        // Older installations may have a valid slug outside the narrower
        // onboarding alphabet. Keeping it must never force a login change.
        if ($slug !== '' && $slug === $current) return $slug;
        $rules = self::onboarding_slug_rules();
        if (
            strlen($slug) > $rules['maxLength']
            || !preg_match('/\A' . $rules['pattern'] . '\z/', $slug)
        ) {
            throw new InvalidArgumentException('Use até 80 letras minúsculas, números e hífens, sem espaços ou barras.');
        }
        if (self::sanitize_slug($slug) !== $slug) {
            throw new InvalidArgumentException('Este endereço é reservado. Escolha outro para o seu login.');
        }
        return $slug;
    }

    /** Change only the login address, preserving every other security option. */
    public function save_onboarding_slug(?string $submitted): void {
        $slug = $this->validate_onboarding_slug($submitted);
        if ($slug === null) return;
        $settings = $this->settings();
        $settings['admin_slug'] = $slug;
        if (!update_option(self::OPTION, $settings, false) && get_option(self::OPTION) !== $settings) {
            throw new RuntimeException('Não foi possível salvar o endereço de login. Tente novamente.');
        }
        $this->settings = $settings;
    }

    public function boot(): void {
        $settings = $this->settings();
        if (!empty($settings['disable_file_edit']) && !defined('DISALLOW_FILE_EDIT')) {
            // map_meta_cap reads the constant when the capability is checked,
            // so defining it here still disables the editor screens.
            define('DISALLOW_FILE_EDIT', true);
        }
        if (!empty($settings['disable_xmlrpc'])) $this->guard_xmlrpc();
        if (!empty($settings['block_enumeration'])) $this->guard_user_enumeration();
        if (!empty($settings['login_throttle'])) $this->guard_login_attempts();
        if (!empty($settings['generic_login_errors'])) {
            add_filter('login_errors', [$this, 'generic_login_error']);
        }
        if (!empty($settings['custom_session_duration'])) {
            add_filter('auth_cookie_expiration', [$this, 'auth_cookie_expiration'], 20, 3);
        }
        if (!empty($settings['disable_application_passwords'])) {
            add_filter('wp_is_application_passwords_available', '__return_false');
            add_filter('wp_is_application_passwords_available_for_user', '__return_false');
        }
        if (!empty($settings['disable_registration'])) {
            add_filter('option_users_can_register', '__return_false');
        }
        if (!empty($settings['hide_wp_version'])) {
            remove_action('wp_head', 'wp_generator');
            add_filter('the_generator', '__return_empty_string');
        }
        if (!empty($settings['security_headers'])) {
            add_filter('wp_headers', [$this, 'filter_security_headers'], 30);
            add_action('admin_init', [$this, 'send_security_headers'], 1);
            add_action('login_init', [$this, 'send_security_headers'], 1);
        }
        $slug = $this->active_slug();
        if ($slug !== '') $this->guard_login_slug($slug);
    }

    public function generic_login_error(string $message = ''): string {
        return 'Não foi possível entrar com os dados informados.';
    }

    public function auth_cookie_expiration(int $length, int $user_id, bool $remember): int {
        $settings = $this->settings();
        $value = $remember
            ? (int) $settings['remember_days'] * DAY_IN_SECONDS
            : (int) $settings['session_hours'] * HOUR_IN_SECONDS;
        return max(HOUR_IN_SECONDS, $value);
    }

    public function filter_security_headers(array $headers): array {
        $settings = $this->settings();
        $headers['X-Content-Type-Options'] = 'nosniff';
        $headers['Referrer-Policy'] = (string) $settings['referrer_policy'];
        if ($settings['frame_policy'] === 'deny') {
            $headers['X-Frame-Options'] = 'DENY';
        } elseif ($settings['frame_policy'] === 'sameorigin') {
            $headers['X-Frame-Options'] = 'SAMEORIGIN';
        } else {
            unset($headers['X-Frame-Options']);
        }
        if (!empty($settings['permissions_policy'])) {
            $headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=(), usb=()';
        } else {
            unset($headers['Permissions-Policy']);
        }
        if (!empty($settings['enable_hsts']) && is_ssl()) {
            $hsts = 'max-age=' . ((int) $settings['hsts_max_age_days'] * DAY_IN_SECONDS);
            if (!empty($settings['hsts_subdomains'])) $hsts .= '; includeSubDomains';
            $headers['Strict-Transport-Security'] = $hsts;
        } else {
            unset($headers['Strict-Transport-Security']);
        }
        return $headers;
    }

    public function send_security_headers(): void {
        if (headers_sent()) return;
        foreach ($this->filter_security_headers([]) as $name => $value) {
            header($name . ': ' . $value, true);
        }
        header_remove('X-Powered-By');
    }

    // --- Private login slug -------------------------------------------------

    private function guard_login_slug(string $slug): void {
        $path = $this->request_path();
        if ($path === $slug) {
            // Let WordPress believe wp-login.php is the file being served, so
            // the form, its hooks and its own redirects all behave normally.
            $GLOBALS['pagenow'] = 'wp-login.php';
            add_action('wp_loaded', [$this, 'serve_login_form'], 0);
        } elseif ($path === 'wp-login.php') {
            add_action('wp_loaded', [$this, 'send_home'], 0);
        }
        add_action('wp_loaded', [$this, 'close_admin_for_visitors'], 1);
        foreach (['site_url', 'network_site_url', 'wp_redirect', 'login_url', 'logout_url', 'lostpassword_url', 'register_url'] as $filter) {
            add_filter($filter, [$this, 'rewrite_login_url'], 20);
        }
    }

    /**
     * wp-login.php is a front controller: it renders the form, processes the
     * POST and issues its own redirects. The globals it writes at file scope
     * have to stay global, hence the declaration below.
     */
    public function serve_login_form(): void {
        global $error, $interim_login, $action, $user_login, $user, $redirect_to, $errors, $pagenow;
        require_once ABSPATH . 'wp-login.php';
        exit;
    }

    public function send_home(): void {
        // Home rather than the login form: a redirect to the private slug
        // would advertise the very path being kept quiet.
        wp_safe_redirect(home_url('/'));
        exit;
    }

    /**
     * Keep wp-admin closed to logged-out visitors.
     *
     * Left alone, WordPress answers those requests with a redirect to the login
     * form — which would leak the private slug on the first anonymous hit.
     */
    public function close_admin_for_visitors(): void {
        if (!is_admin() || is_user_logged_in()) return;
        if (wp_doing_ajax() || wp_doing_cron()) return;
        if (in_array((string) ($GLOBALS['pagenow'] ?? ''), self::PUBLIC_ADMIN_ENTRIES, true)) return;
        $this->send_home();
    }

    /**
     * @param mixed $url
     * @return mixed
     */
    public function rewrite_login_url($url) {
        if (!is_string($url) || !str_contains($url, 'wp-login.php')) return $url;
        $slug = $this->active_slug();
        if ($slug === '') return $url;
        return str_replace('wp-login.php', $slug, $url);
    }

    /**
     * The requested path, relative to the site root and without query string.
     */
    private function request_path(): string {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
        $path = (string) wp_parse_url($uri, PHP_URL_PATH);
        $path = trim($path, '/');
        $home = trim((string) wp_parse_url(home_url('/'), PHP_URL_PATH), '/');
        if ($home !== '' && ($path === $home || str_starts_with($path, $home . '/'))) {
            $path = trim(substr($path, strlen($home)), '/');
        }
        return $path;
    }

    // --- Login throttling ---------------------------------------------------

    private function guard_login_attempts(): void {
        // Priority 30 runs after wp_authenticate_username_password, so a locked
        // client is refused even when it finally submits the right password.
        add_filter('authenticate', [$this, 'refuse_locked_client'], 30);
        add_action('wp_login_failed', [$this, 'record_failed_login']);
        add_action('wp_login', [$this, 'clear_failed_logins']);
    }

    /**
     * @param mixed $user
     * @return mixed
     */
    public function refuse_locked_client($user) {
        $ip = $this->client_ip();
        if ($ip === '') return $user;
        $until = (int) get_transient($this->lock_key($ip));
        if ($until <= time()) return $user;
        $minutes = max(1, (int) ceil(($until - time()) / MINUTE_IN_SECONDS));
        return new WP_Error(
            'kodety_login_locked',
            sprintf(
                'Muitas tentativas de login a partir deste endereço. Tente novamente em %d minuto(s).',
                $minutes
            )
        );
    }

    public function record_failed_login(): void {
        $ip = $this->client_ip();
        if ($ip === '') return;
        $settings = $this->settings();
        $attempts = (int) get_transient($this->attempts_key($ip)) + 1;
        $lockout_seconds = (int) $settings['login_lockout_minutes'] * MINUTE_IN_SECONDS;
        if ($attempts >= (int) $settings['login_max_attempts']) {
            set_transient($this->lock_key($ip), time() + $lockout_seconds, $lockout_seconds);
            delete_transient($this->attempts_key($ip));
            return;
        }
        set_transient(
            $this->attempts_key($ip),
            $attempts,
            (int) $settings['login_attempt_window_minutes'] * MINUTE_IN_SECONDS
        );
    }

    /**
     * A successful login proves the client is legitimate, so both the counter
     * and any standing lock are cleared. A locked client cannot reach this:
     * the authenticate filter refuses it before wp_login ever fires.
     */
    public function clear_failed_logins(): void {
        $ip = $this->client_ip();
        if ($ip === '') return;
        delete_transient($this->attempts_key($ip));
        delete_transient($this->lock_key($ip));
    }

    private function attempts_key(string $ip): string {
        return 'kodety_login_fails_' . md5($ip);
    }

    private function lock_key(string $ip): string {
        return 'kodety_login_lock_' . md5($ip);
    }

    private function client_ip(): string {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        /**
         * Reverse proxies and CDNs put their own address in REMOTE_ADDR, which
         * would count every visitor as the same client and lock the whole site
         * out at once. Sites behind one should return the real client address.
         *
         * Forwarded headers are not trusted by default because a client can
         * forge them and sidestep the lockout entirely.
         */
        $ip = (string) apply_filters('kodety_security_client_ip', $ip);
        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '';
    }

    // --- User enumeration ---------------------------------------------------

    private function guard_user_enumeration(): void {
        add_action('template_redirect', [$this, 'block_author_probe']);
        add_filter('rest_endpoints', [$this, 'restrict_user_endpoints']);
        add_filter('wp_sitemaps_add_provider', [$this, 'drop_users_sitemap'], 10, 2);
        add_filter('oembed_response_data', [$this, 'strip_oembed_author']);
    }

    /**
     * ?author=1 makes WordPress redirect to that user's archive, handing over
     * the login name. Author archives reached by their own slug keep working.
     */
    public function block_author_probe(): void {
        if (is_user_logged_in() || is_admin()) return;
        $author = $_GET['author'] ?? null;
        if ($author === null || !is_numeric($author)) return;
        wp_safe_redirect(home_url('/'), 301);
        exit;
    }

    public function restrict_user_endpoints(array $endpoints): array {
        if (is_user_logged_in()) return $endpoints;
        unset($endpoints['/wp/v2/users'], $endpoints['/wp/v2/users/(?P<id>[\d]+)']);
        return $endpoints;
    }

    /**
     * @param mixed $provider
     * @return mixed
     */
    public function drop_users_sitemap($provider, string $name) {
        return $name === 'users' ? false : $provider;
    }

    public function strip_oembed_author(array $data): array {
        unset($data['author_name'], $data['author_url']);
        return $data;
    }

    // --- XML-RPC ------------------------------------------------------------

    private function guard_xmlrpc(): void {
        if (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) {
            status_header(403);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'XML-RPC desativado.';
            exit;
        }
        add_filter('xmlrpc_enabled', '__return_false');
        add_filter('xmlrpc_methods', '__return_empty_array');
        add_filter('pings_open', '__return_false', 20);
        add_filter('wp_headers', [$this, 'strip_pingback_header']);
        remove_action('wp_head', 'rsd_link');
    }

    public function strip_pingback_header(array $headers): array {
        unset($headers['X-Pingback']);
        return $headers;
    }

    // --- Settings screen ----------------------------------------------------

    public function save_settings(): void {
        if (!current_user_can('manage_options')) wp_die('Sem permissão.', '', ['response' => 403]);
        check_admin_referer('kodety_save_security', 'kodety_security_nonce');
        // The field is disabled while wp-config.php owns the slug, so the POST
        // carries no value and must not wipe what is stored.
        $config_owned = defined('KODETY_ADMIN_SLUG') || (defined('KODETY_DISABLE_ADMIN_SLUG') && KODETY_DISABLE_ADMIN_SLUG);
        $submitted = $config_owned
            ? (string) ($this->settings()['admin_slug'] ?? '')
            : (string) ($_POST['kodety_admin_slug'] ?? '');
        $slug = self::sanitize_slug($submitted);
        $settings = self::sanitize_settings([
            'admin_slug' => $slug,
            'login_throttle' => isset($_POST['kodety_security_login_throttle']),
            'login_max_attempts' => (int) ($_POST['kodety_security_login_max_attempts'] ?? 5),
            'login_attempt_window_minutes' => (int) ($_POST['kodety_security_login_attempt_window_minutes'] ?? 15),
            'login_lockout_minutes' => (int) ($_POST['kodety_security_login_lockout_minutes'] ?? 15),
            'generic_login_errors' => isset($_POST['kodety_security_generic_login_errors']),
            'custom_session_duration' => isset($_POST['kodety_security_custom_session_duration']),
            'session_hours' => (int) ($_POST['kodety_security_session_hours'] ?? 48),
            'remember_days' => (int) ($_POST['kodety_security_remember_days'] ?? 14),
            'block_enumeration' => isset($_POST['kodety_security_block_enumeration']),
            'disable_xmlrpc' => isset($_POST['kodety_security_disable_xmlrpc']),
            'disable_file_edit' => isset($_POST['kodety_security_disable_file_edit']),
            'disable_application_passwords' => isset($_POST['kodety_security_disable_application_passwords']),
            'disable_registration' => isset($_POST['kodety_security_disable_registration']),
            'hide_wp_version' => isset($_POST['kodety_security_hide_wp_version']),
            'security_headers' => isset($_POST['kodety_security_security_headers']),
            'frame_policy' => (string) ($_POST['kodety_security_frame_policy'] ?? 'sameorigin'),
            'referrer_policy' => (string) ($_POST['kodety_security_referrer_policy'] ?? 'strict-origin-when-cross-origin'),
            'permissions_policy' => isset($_POST['kodety_security_permissions_policy']),
            'enable_hsts' => isset($_POST['kodety_security_enable_hsts']),
            'hsts_max_age_days' => (int) ($_POST['kodety_security_hsts_max_age_days'] ?? 180),
            'hsts_subdomains' => isset($_POST['kodety_security_hsts_subdomains']),
        ]);
        update_option(self::OPTION, $settings, false);
        $this->settings = $settings;
        if (trim($submitted) !== '' && $slug === '') {
            $this->notice('error', 'Endereço de login inválido ou reservado. O wp-login.php continua ativo.');
        }
        $this->notice(
            'success',
            $slug === ''
                ? 'Segurança salva. O login continua em wp-login.php.'
                : sprintf('Segurança salva. Guarde o novo endereço de login: %s', $this->login_url())
        );
    }

    private function notice(string $type, string $message): void {
        wp_safe_redirect(add_query_arg([
            'page' => 'kodety',
            'kodety_type' => $type,
            'kodety_notice' => rawurlencode($message),
        ], admin_url('admin.php')) . '#kodety-security');
        exit;
    }
}
