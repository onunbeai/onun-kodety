<?php

/**
 * Isolated security and policy contracts for Kodety membership.
 *
 * Run with: php Wordpress/tests/members-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('ARRAY_A', 'ARRAY_A');

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message = '',
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Request implements ArrayAccess {
    public function __construct(
        private array $params = [],
        private array $headers = [],
        private array $json = []
    ) {
        $this->headers = array_change_key_case($this->headers, CASE_LOWER);
    }
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
    public function get_params(): array { return $this->params; }
    public function get_json_params(): array { return $this->json; }
    public function get_header(string $name): string {
        return (string) ($this->headers[strtolower($name)] ?? '');
    }
    public function offsetExists(mixed $offset): bool { return isset($this->params[$offset]); }
    public function offsetGet(mixed $offset): mixed { return $this->params[$offset] ?? null; }
    public function offsetSet(mixed $offset, mixed $value): void { $this->params[$offset] = $value; }
    public function offsetUnset(mixed $offset): void { unset($this->params[$offset]); }
}

final class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
    public function get_headers(): array { return $this->headers; }
}

class WP_User {
    public array $roles;
    public array $caps = [];
    public array $allcaps = [];
    public string $user_pass = '$P$test-password-hash';
    public string $display_name = 'Member';
    public string $first_name = '';
    public string $last_name = '';
    public string $user_email = 'member@example.test';
    public string $user_registered = '2026-01-01 00:00:00';

    public function __construct(
        public int $ID = 7,
        public string $user_login = 'member',
        array $roles = ['subscriber'],
    ) {
        $this->roles = $roles;
        foreach ($roles as $role) $this->caps[$role] = true;
        $this->allcaps = $this->caps;
        $this->allcaps['read'] = true;
        if (in_array('subscriber', $roles, true)) $this->allcaps['level_0'] = true;
        if (in_array('editor', $roles, true)) {
            $this->allcaps['edit_posts'] = true;
            $this->allcaps['upload_files'] = true;
        }
    }

    public function exists(): bool { return $this->ID > 0; }
}

final class WP_Role {
    public function __construct(public array $capabilities = []) {}
}

$kodety_members_options = [
    'kodety_published_project_id' => 'site-a',
    'kodety_membership_settings' => [
        'enabled' => false,
        'registration_enabled' => false,
        'enabled_projects' => [],
    ],
];
$kodety_members_transients = [];
$kodety_members_caps = [];
$kodety_members_user_meta = [
    9 => ['_kodety_membership_status' => 'active'],
    90 => ['_kodety_membership_status' => 'active'],
];
$kodety_members_user_meta_writes = 0;
$kodety_members_routes = [];
$kodety_members_roles = [
    'subscriber' => new WP_Role(['read' => true, 'level_0' => true]),
    'customer' => new WP_Role(['read' => true]),
    'membership_manager' => new WP_Role([
        'read' => true,
        'kodety_manage_members' => true,
    ]),
    'editor' => new WP_Role([
        'read' => true,
        'edit_posts' => true,
        'upload_files' => true,
    ]),
];
$kodety_members_users = [
    7 => new WP_User(7, 'member'),
    9 => new WP_User(9, 'member-login'),
    55 => new WP_User(55, 'archived-member'),
    56 => new WP_User(56, 'expiry-member'),
    57 => new WP_User(57, 'temporal-member'),
    88 => new WP_User(88, 'editor-account', ['editor']),
    89 => new WP_User(89, 'generic-subscriber'),
    90 => new WP_User(90, 'elevated-subscriber'),
    91 => new WP_User(91, 'legacy-kodety-member'),
];
$kodety_members_users[90]->caps['edit_pages'] = true;
$kodety_members_users[90]->allcaps['edit_pages'] = true;

final class Kodety_Members_Test_Wpdb {
    public string $prefix = 'wp_';
    public string $mode = 'empty';
    public int $rows_affected = 0;
    public int $insert_id = 1;
    public int $insert_count = 0;
    public string $last_query = '';
    public array $queries = [];
    public array $last_prepare_arguments = [];
    public array $legacy_member_ids = [91];
    public function prepare(string $query, mixed ...$arguments): string {
        $this->last_prepare_arguments = $arguments;
        return $query;
    }
    public function query(string $query): int|false {
        $this->last_query = $query;
        $this->queries[] = $query;
        if (
            $this->mode === 'fail_subscription_cleanup'
            && str_contains($query, 'UPDATE wp_kodety_membership_subscriptions')
        ) {
            return false;
        }
        $this->rows_affected = 1;
        return 1;
    }
    public function get_results(string $query, mixed $output = null): array {
        if (str_contains($query, 'kodety_membership_grants')) {
            if ($this->mode === 'archived') {
                return [[
                    'plan_id' => 9,
                    'entitlement_id' => 10,
                    'ends_at' => null,
                    'plan_slug' => 'archived-plan',
                    'plan_status' => 'archived',
                    'entitlement_key' => 'archived.entitlement',
                    'entitlement_status' => 'archived',
                ]];
            }
            return [];
        }
        if (str_contains($query, 'kodety_membership_subscriptions')) {
            if ($this->mode === 'expiry') {
                $past = gmdate('Y-m-d H:i:s', time() - HOUR_IN_SECONDS);
                $future = gmdate('Y-m-d H:i:s', time() + HOUR_IN_SECONDS);
                return [
                    [
                        'plan_id' => 1,
                        'status' => 'trialing',
                        'trial_ends_at' => $past,
                        'current_period_end' => null,
                        'grace_ends_at' => null,
                        'ended_at' => null,
                        'plan_slug' => 'expired-trial',
                    ],
                    [
                        'plan_id' => 2,
                        'status' => 'active',
                        'trial_ends_at' => null,
                        'current_period_end' => $past,
                        'grace_ends_at' => null,
                        'ended_at' => null,
                        'plan_slug' => 'expired-active',
                    ],
                    [
                        'plan_id' => 3,
                        'status' => 'past_due',
                        'trial_ends_at' => null,
                        'current_period_end' => $past,
                        'grace_ends_at' => $past,
                        'ended_at' => null,
                        'plan_slug' => 'expired-grace',
                    ],
                    [
                        'plan_id' => 4,
                        'status' => 'active',
                        'trial_ends_at' => null,
                        'current_period_end' => $future,
                        'grace_ends_at' => null,
                        'ended_at' => null,
                        'plan_slug' => 'current-plan',
                    ],
                ];
            }
            if ($this->mode === 'temporal') {
                $past = gmdate('Y-m-d H:i:s', time() - HOUR_IN_SECONDS);
                $future = gmdate('Y-m-d H:i:s', time() + HOUR_IN_SECONDS);
                $later = gmdate('Y-m-d H:i:s', time() + 2 * HOUR_IN_SECONDS);
                return [
                    [
                        'plan_id' => 5,
                        'status' => 'trialing',
                        'started_at' => $past,
                        'trial_ends_at' => $future,
                        'current_period_start' => $past,
                        'current_period_end' => null,
                        'grace_ends_at' => null,
                        'ended_at' => null,
                        'plan_slug' => 'valid-trial',
                    ],
                    [
                        'plan_id' => 6,
                        'status' => 'trialing',
                        'started_at' => $past,
                        'trial_ends_at' => null,
                        'current_period_start' => $past,
                        'current_period_end' => null,
                        'grace_ends_at' => null,
                        'ended_at' => null,
                        'plan_slug' => 'open-trial',
                    ],
                    [
                        'plan_id' => 7,
                        'status' => 'active',
                        'started_at' => $future,
                        'trial_ends_at' => null,
                        'current_period_start' => $future,
                        'current_period_end' => $later,
                        'grace_ends_at' => null,
                        'ended_at' => null,
                        'plan_slug' => 'future-active',
                    ],
                    [
                        'plan_id' => 8,
                        'status' => 'past_due',
                        'started_at' => $future,
                        'trial_ends_at' => null,
                        'current_period_start' => $future,
                        'current_period_end' => $later,
                        'grace_ends_at' => $later,
                        'ended_at' => null,
                        'plan_slug' => 'future-grace',
                    ],
                ];
            }
            return [];
        }
        return [];
    }
    public function get_var(string $query): mixed {
        if (str_contains($query, 'kodety_legacy_member')) {
            return in_array(
                (int) ($this->last_prepare_arguments[0] ?? 0),
                $this->legacy_member_ids,
                true
            ) ? 1 : false;
        }
        return false;
    }
    public function insert(string $table, array $data): int|false {
        $this->rows_affected = 1;
        $this->insert_count += 1;
        return 1;
    }
}

$wpdb = new Kodety_Members_Test_Wpdb();

function add_action(...$arguments): void {}
function add_filter(...$arguments): void {}
function register_rest_route(string $namespace, string $route, array $definition): bool {
    global $kodety_members_routes;
    $kodety_members_routes[$namespace . $route] = $definition;
    return true;
}
function do_action(...$arguments): void {}
function apply_filters(string $hook, mixed $value, mixed ...$arguments): mixed { return $value; }
function get_option(string $name, mixed $default = false): mixed {
    global $kodety_members_options;
    return $kodety_members_options[$name] ?? $default;
}
function update_option(string $name, mixed $value, mixed $autoload = null): bool {
    global $kodety_members_options;
    $changed = !array_key_exists($name, $kodety_members_options) || $kodety_members_options[$name] !== $value;
    $kodety_members_options[$name] = $value;
    return $changed;
}
function add_option(string $name, mixed $value, string $deprecated = '', mixed $autoload = null): bool {
    global $kodety_members_options;
    if (array_key_exists($name, $kodety_members_options)) return false;
    $kodety_members_options[$name] = $value;
    return true;
}
function is_multisite(): bool { return false; }
function rest_sanitize_boolean(mixed $value): bool {
    if (is_bool($value)) return $value;
    return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
}
function sanitize_key(string $value): string {
    return preg_replace('/[^a-z0-9_\-]/', '', strtolower($value)) ?: '';
}
function sanitize_text_field(string $value): string {
    return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? ''));
}
function sanitize_textarea_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_title(string $value): string {
    return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($value)) ?: '', '-');
}
function sanitize_user(string $value, bool $strict = false): string {
    return preg_replace('/[^A-Za-z0-9._-]/', '', $value) ?: '';
}
function sanitize_email(string $value): string {
    return filter_var($value, FILTER_VALIDATE_EMAIL) ? strtolower($value) : '';
}
function is_email(string $value): bool { return filter_var($value, FILTER_VALIDATE_EMAIL) !== false; }
function esc_url_raw(string $value, ?array $protocols = null): string {
    if (str_starts_with($value, '/') && !str_starts_with($value, '//')) return $value;
    return filter_var($value, FILTER_VALIDATE_URL) ? $value : '';
}
function wp_parse_url(string $url, int $component = -1): mixed { return parse_url($url, $component); }
function home_url(string $path = ''): string { return 'https://example.test/' . ltrim($path, '/'); }
function add_query_arg(array $arguments, string $url): string {
    $separator = str_contains($url, '?') ? '&' : '?';
    return $url . $separator . http_build_query($arguments);
}
function wp_salt(string $scheme = 'auth'): string { return 'members-test-salt-' . $scheme; }
function absint(mixed $value): int { return abs((int) $value); }
function current_user_can(string $capability, mixed ...$arguments): bool {
    global $kodety_members_caps;
    return !empty($kodety_members_caps[$capability]);
}
function user_can(WP_User $user, string $capability): bool {
    global $kodety_members_roles;
    foreach ($user->roles as $role) {
        if (!empty($kodety_members_roles[$role]?->capabilities[$capability])) return true;
    }
    return false;
}
function get_role(string $role): ?WP_Role {
    global $kodety_members_roles;
    return $kodety_members_roles[$role] ?? null;
}
function get_user_by(string $field, mixed $value): WP_User|false {
    global $kodety_members_users;
    if ($field === 'id') return $kodety_members_users[(int) $value] ?? false;
    foreach ($kodety_members_users as $user) {
        if ($field === 'login' && $user->user_login === (string) $value) return $user;
        if ($field === 'email' && $user->user_email === (string) $value) return $user;
    }
    return false;
}
function wp_authenticate(string $username, string $password): WP_User|WP_Error {
    $user = get_user_by('login', $username);
    return $user instanceof WP_User && $password === 'correct-password'
        ? $user
        : new WP_Error('incorrect_password');
}
function get_avatar_url(int $user_id, array $arguments = []): string {
    return 'https://example.test/avatar/' . $user_id;
}
function wp_verify_nonce(string $nonce, string $action): bool {
    return $nonce === 'valid-rest-nonce' && $action === 'wp_rest';
}
function is_user_logged_in(): bool { return true; }
function is_ssl(): bool { return false; }
function get_current_user_id(): int { return 7; }
function get_user_meta(int $user_id, string $key, bool $single = false): mixed {
    global $kodety_members_user_meta;
    return $kodety_members_user_meta[$user_id][$key] ?? '';
}
function update_user_meta(int $user_id, string $key, mixed $value): bool {
    global $kodety_members_user_meta, $kodety_members_user_meta_writes;
    $kodety_members_user_meta[$user_id][$key] = $value;
    $kodety_members_user_meta_writes += 1;
    return true;
}
function wp_generate_password(int $length = 12, bool $special = true, bool $extra = false): string {
    return substr(str_repeat('Ab3cD4eF5gH6iJ7kL8mN9pQ2rS4tU6vW8xY', 4), 0, $length);
}
function wp_generate_uuid4(): string { return '12345678-1234-4abc-8def-123456789abc'; }
function wp_json_encode(mixed $value, int $flags = 0): string|false { return json_encode($value, $flags); }
function current_time(string $type, bool $gmt = false): string { return gmdate('Y-m-d H:i:s'); }
function set_transient(string $key, mixed $value, int $ttl): bool {
    global $kodety_members_transients;
    $kodety_members_transients[$key] = $value;
    return true;
}
function get_transient(string $key): mixed {
    global $kodety_members_transients;
    return $kodety_members_transients[$key] ?? false;
}
function delete_transient(string $key): bool {
    global $kodety_members_transients;
    unset($kodety_members_transients[$key]);
    return true;
}
function check_password_reset_key(string $key, string $login): WP_User|WP_Error {
    if ($key === 'reset-key' && $login === 'member-login') return new WP_User(9, 'member-login');
    return new WP_Error('invalid_key');
}
function wp_unslash(mixed $value): mixed { return $value; }
function untrailingslashit(string $value): string { return rtrim($value, '/'); }
function remove_query_arg(array|string $keys, string $url): string {
    $parts = parse_url($url);
    parse_str((string) ($parts['query'] ?? ''), $query);
    foreach ((array) $keys as $key) unset($query[$key]);
    $path = (string) ($parts['path'] ?? '/');
    return $query ? $path . '?' . http_build_query($query) : $path;
}
function wp_safe_redirect(string $location, int $status = 302, string $by = ''): bool { return false; }
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }

$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'Kodety Members Test';

require dirname(__DIR__) . '/kodety/includes/class-kodety-members.php';

function kodety_members_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_members_private(object|string $target, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($target, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke(is_object($target) ? $target : null, ...$arguments);
}

function kodety_members_private_property(object $target, string $property): mixed {
    $reflection = new ReflectionProperty($target, $property);
    $reflection->setAccessible(true);
    return $reflection->getValue($target);
}

function kodety_members_set_private_property(object $target, string $property, mixed $value): void {
    $reflection = new ReflectionProperty($target, $property);
    $reflection->setAccessible(true);
    $reflection->setValue($target, $value);
}

$guest = [
    'authenticated' => false,
    'accountStatus' => 'guest',
    'plans' => [],
    'entitlements' => [],
    'subscriptionStatuses' => [],
];
$pro = [
    'authenticated' => true,
    'accountStatus' => 'active',
    'plans' => ['pro'],
    'entitlements' => ['courses.advanced' => true, 'downloads.limit' => 20],
    'subscriptionStatuses' => ['active'],
];

$typescript_rule = [
    'version' => 1,
    'requirement' => [
        'type' => 'plans',
        'match' => 'any',
        'planKeys' => ['starter', 'pro'],
    ],
    'anonymous' => ['mode' => 'replace'],
    'denied' => ['mode' => 'replace'],
];
$decision = Kodety_Members::evaluate_snapshot($typescript_rule, $pro);
kodety_members_assert($decision['allowed'] === true && $decision['valid'] === true, 'contrato TypeScript de plans deve ser aceito');
kodety_members_assert(
    Kodety_Members::evaluate_snapshot($typescript_rule, $guest)['allowed'] === false,
    'visitante não pode satisfazer plano'
);
$all_plans_rule = [
    'requirement' => [
        'type' => 'plans',
        'match' => 'all',
        'planKeys' => ['pro', 'business'],
    ],
];
kodety_members_assert(
    Kodety_Members::evaluate_snapshot($all_plans_rule, $pro)['allowed'] === false,
    'match all deve negar quando faltar um plano'
);
$multi_plan = $pro;
$multi_plan['plans'][] = 'business';
kodety_members_assert(
    Kodety_Members::evaluate_snapshot($all_plans_rule, $multi_plan)['allowed'] === true,
    'match all deve permitir somente quando todos os planos estiverem presentes'
);
$fake_guest_claims = $pro;
$fake_guest_claims['authenticated'] = false;
kodety_members_assert(
    Kodety_Members::evaluate_snapshot($typescript_rule, $fake_guest_claims)['allowed'] === false,
    'claims comerciais nunca substituem autenticação'
);

$dsl_rule = [
    'version' => 1,
    'when' => [
        'all' => [
            ['predicate' => 'authenticated'],
            ['any' => [
                ['predicate' => 'has_entitlement', 'key' => 'courses.advanced'],
                ['predicate' => 'has_plan', 'key' => 'enterprise'],
            ]],
            ['not' => ['predicate' => 'subscription_status', 'key' => 'past_due']],
        ],
    ],
];
kodety_members_assert(Kodety_Members::evaluate_snapshot($dsl_rule, $pro)['allowed'] === true, 'AND/OR/NOT deve compor claims');
$invalid = Kodety_Members::evaluate_snapshot(['when' => ['predicate' => 'arbitrary']], $pro);
kodety_members_assert($invalid['allowed'] === false && $invalid['valid'] === false, 'predicado desconhecido deve falhar fechado');
$unsupported = Kodety_Members::evaluate_snapshot(['version' => 99, 'requirement' => ['type' => 'public']], $guest);
kodety_members_assert($unsupported['allowed'] === false && $unsupported['valid'] === false, 'versão desconhecida deve falhar fechado');
$suspended = $pro;
$suspended['accountStatus'] = 'suspended';
kodety_members_assert(
    Kodety_Members::evaluate_snapshot($typescript_rule, $suspended)['allowed'] === false,
    'conta suspensa não pode usar plans existentes'
);
kodety_members_assert(
    Kodety_Members::evaluate_snapshot(['requirement' => ['type' => 'guest']], $suspended)['allowed'] === false,
    'conta suspensa não deve ser tratada como visitante'
);

kodety_members_assert(
    Kodety_Members::sanitize_project_key(' Site / Projeto Á ') === 'site-projeto',
    'chave de projeto deve ser estável e limitada'
);
kodety_members_assert(Kodety_Members::is_site_enabled() === false, 'membership deve iniciar opt-in/fail-closed');
$disabled = Kodety_Members::evaluate_access(['requirement' => ['type' => 'public']], 0, 'site');
kodety_members_assert($disabled['allowed'] === false && $disabled['reason'] === 'membership_disabled', 'site desativado deve negar até regra pública');

$kodety_members_options['kodety_membership_settings'] = [
    'enabled' => true,
    'registration_enabled' => true,
    'require_email_verification' => true,
    'enabled_projects' => ['site-a'],
    'login_page_url' => 'http://attacker.test/login',
    'upgrade_page_url' => 'https://checkout.example.test/upgrade',
    'reset_page_url' => 'https://attacker.test/collect-reset',
];
kodety_members_assert(Kodety_Members::is_project_enabled('site-a') === true, 'projeto explicitamente habilitado deve resolver');
kodety_members_assert(Kodety_Members::is_project_enabled('site-b') === false, 'projeto não habilitado deve falhar fechado');
$settings = Kodety_Members::settings();
kodety_members_assert($settings['require_email_verification'] === false, 'verificação não implementada nunca pode ser anunciada');
kodety_members_assert($settings['login_page_url'] === '', 'URL HTTP externa deve ser rejeitada');
kodety_members_assert($settings['reset_page_url'] === '', 'URL HTTPS externa não pode receber token de reset');
kodety_members_assert(
    $settings['upgrade_page_url'] === 'https://checkout.example.test/upgrade',
    'URL HTTPS explícita pode ser persistida'
);
$kodety_members_options['kodety_membership_settings']['default_role'] = 'membership_manager';
kodety_members_assert(
    Kodety_Members::settings()['default_role'] === 'subscriber',
    'role administrativa customizada nunca pode virar função padrão de cadastro'
);
$kodety_members_options['kodety_membership_settings']['default_role'] = 'customer';
kodety_members_assert(
    Kodety_Members::settings()['default_role'] === 'customer',
    'customer sem capabilities elevadas deve permanecer disponível'
);
$kodety_members_roles['customer']->capabilities['kodety_manage_commerce'] = true;
kodety_members_assert(
    Kodety_Members::settings()['default_role'] === 'subscriber',
    'customer alterada com capability Kodety deve falhar para subscriber'
);
unset($kodety_members_roles['customer']->capabilities['kodety_manage_commerce']);
$kodety_members_options['kodety_membership_settings']['default_role'] = 'subscriber';
$kodety_members_roles['subscriber']->capabilities['manage_options'] = true;
$unsafe_role = kodety_members_private(Kodety_Members::class, 'validated_public_member_role');
kodety_members_assert(
    $unsafe_role instanceof WP_Error
        && $unsafe_role->get_error_code() === 'kodety_members_registration_role_unsafe',
    'cadastro deve falhar fechado se até subscriber tiver sido elevada'
);
unset($kodety_members_roles['subscriber']->capabilities['manage_options']);
$kodety_members_options['kodety_membership_settings']['default_role'] = 'subscriber';
$kodety_members_options['kodety_membership_settings']['reset_page_url'] = '/\\attacker.test';
kodety_members_assert(
    Kodety_Members::settings()['reset_page_url'] === '',
    'URL relativa com barra invertida deve ser rejeitada antes de anexar token'
);
$kodety_members_options['kodety_membership_settings']['reset_page_url'] = '/reset-password';

$instance = Kodety_Members::instance();
$instance->register_rest_routes();
kodety_members_assert(
    isset(
        $kodety_members_routes['kodety/v1/membership/overview'],
        $kodety_members_routes['kodety/v1/membership/members'],
        $kodety_members_routes['kodety/v1/membership/auth/login'],
        $kodety_members_routes['kodety/v1/membership/me']
    ),
    'rotas administrativas e de autenticação devem ser registradas no contrato kodety/v1'
);
$enabled_from_project_panel = $instance->set_project_enabled('site-b', true, 101);
kodety_members_assert(
    is_array($enabled_from_project_panel)
        && ($enabled_from_project_panel['enabled'] ?? false) === true
        && Kodety_Members::is_project_enabled('site-a') === true
        && Kodety_Members::is_project_enabled('site-b') === true,
    'toggle do projeto deve ativar Membership sem remover o opt-in de outros projetos'
);
$disabled_from_project_panel = $instance->set_project_enabled('site-b', false, 101);
kodety_members_assert(
    is_array($disabled_from_project_panel)
        && ($disabled_from_project_panel['enabled'] ?? true) === false
        && Kodety_Members::is_project_enabled('site-a') === true
        && Kodety_Members::is_project_enabled('site-b') === false,
    'toggle do projeto deve desativar somente o runtime escolhido e preservar seus dados'
);
$invalid_project_panel = $instance->set_project_enabled(' / ', true, 101);
kodety_members_assert(
    $invalid_project_panel instanceof WP_Error
        && $invalid_project_panel->get_error_code() === 'kodety_members_project_required',
    'toggle deve rejeitar uma identidade de projeto vazia'
);
$project_panel_source = (string) file_get_contents(
    dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php'
);
$members_source = (string) file_get_contents(
    dirname(__DIR__) . '/kodety/includes/class-kodety-members.php'
);
$membership_extension_source = (string) file_get_contents(dirname(__DIR__) . '/extensions/kodety-membership/extension.php');
$project_panel_css = (string) file_get_contents(dirname(__DIR__) . '/kodety/admin/kodety-page.css');
kodety_members_assert(
    !str_contains($project_panel_source, 'admin_post_kodety_save_membership')
        && !str_contains($project_panel_source, 'kodety_membership_enabled')
        && !str_contains($project_panel_css, 'kodety-membership-setting-compact'),
    'Configurações do projeto não deve manter um segundo toggle de Membership'
);
kodety_members_assert(
    str_contains($members_source, "add_action('init', [\$this, 'ensure_active_extension_project_enabled'], 3)")
        && str_contains($membership_extension_source, 'Kodety_Members::instance()->ensure_active_extension_project_enabled();'),
    'ativar a extensão deve ligar o contrato do projeto sem interação adicional'
);
$kodety_members_options['kodety_membership_settings'] = array_merge(Kodety_Members::settings(), [
    'enabled' => false,
    'enabled_projects' => [],
]);
$instance->ensure_active_extension_project_enabled();
kodety_members_assert(
    Kodety_Members::is_project_enabled('site-a') === true,
    'projeto atual deve ser ativado automaticamente quando Membership está disponível'
);
$settings_activation_boundary = $instance->update_settings(new WP_REST_Request([], [], [
    'enabled' => false,
    'enabledProjects' => ['outro-projeto'],
    'registrationEnabled' => false,
]));
kodety_members_assert(
    $settings_activation_boundary instanceof WP_REST_Response
        && Kodety_Members::is_project_enabled('site-a') === true
        && Kodety_Members::is_project_enabled('outro-projeto') === false,
    'configurações gerais não podem sobrescrever o opt-in versionado dos projetos'
);
$wpdb->mode = 'archived';
$archived_claims = $instance->resolve_claims(55);
kodety_members_assert(
    $archived_claims['plans'] === [] && $archived_claims['entitlements'] === [],
    'plano e entitlement arquivados não podem produzir claims'
);
$wpdb->mode = 'expiry';
$expiry_claims = $instance->resolve_claims(56);
kodety_members_assert(
    $expiry_claims['plans'] === ['current-plan']
        && $expiry_claims['subscriptionStatuses'] === ['active'],
    'trial/period/grace vencidos devem negar acesso e manter apenas assinatura vigente'
);
$wpdb->mode = 'temporal';
$temporal_claims = $instance->resolve_claims(57);
kodety_members_assert(
    $temporal_claims['plans'] === ['valid-trial']
        && $temporal_claims['subscriptionStatuses'] === ['trialing'],
    'trial sem fim e assinatura com início futuro não podem conceder acesso'
);
$missing_user_claims = $instance->resolve_claims(999);
kodety_members_assert(
    $missing_user_claims['authenticated'] === false
        && $missing_user_claims['accountStatus'] === 'guest',
    'ID positivo inexistente nunca deve produzir claims autenticadas'
);
$missing_trial_end = kodety_members_private(
    Kodety_Members::class,
    'validate_subscription_dates',
    'trialing',
    [
        'started_at' => gmdate('Y-m-d H:i:s', time() - HOUR_IN_SECONDS),
        'trial_ends_at' => null,
        'current_period_start' => null,
        'current_period_end' => null,
    ]
);
kodety_members_assert(
    $missing_trial_end instanceof WP_Error
        && $missing_trial_end->get_error_code() === 'kodety_members_subscription_trial_end',
    'persistência deve rejeitar trialing sem trialEndsAt'
);
$wpdb->mode = 'empty';
$reset_message = $instance->filter_password_reset_message(
    'Core reset message',
    'reset-key',
    'member-login',
    new WP_User(9, 'member-login')
);
kodety_members_assert(
    str_contains($reset_message, '/reset-password?key=reset-key&login=member-login')
        && !str_contains($reset_message, 'Core reset message')
        && !str_contains($reset_message, 'wp-login.php'),
    'e-mail de membro deve substituir integralmente o reset nativo pela página configurada'
);
update_user_meta(55, '_kodety_membership_status', 'suspended');
$suspended_reset_message = $instance->filter_password_reset_message(
    'Core suspended reset with wp-login.php',
    'reset-key',
    'archived-member',
    $kodety_members_users[55]
);
kodety_members_assert(
    str_contains($suspended_reset_message, '/reset-password?')
        && !str_contains($suspended_reset_message, 'wp-login.php'),
    'membro suspenso pode redefinir senha sem receber link nativo nem recuperar acesso'
);
$suspended_session = $instance->start_member_session($kodety_members_users[55], false);
kodety_members_assert(
    $suspended_session instanceof WP_Error
        && $suspended_session->get_error_code() === 'kodety_members_session_forbidden',
    'redefinição de senha não deve tornar conta suspensa apta a abrir sessão'
);
$kodety_members_caps = ['kodety_view_members' => true];
$nonce_denied = $instance->view_permission(new WP_REST_Request());
kodety_members_assert(
    $nonce_denied instanceof WP_Error && $nonce_denied->get_error_code() === 'kodety_members_nonce',
    'API privada deve exigir nonce além da capability'
);
$nonce_allowed = $instance->view_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_members_assert($nonce_allowed === true, 'capability + nonce válido deve liberar API privada');
$kodety_members_caps = [];
$cap_denied = $instance->view_permission(new WP_REST_Request([], ['X-WP-Nonce' => 'valid-rest-nonce']));
kodety_members_assert(
    $cap_denied instanceof WP_Error && $cap_denied->get_error_code() === 'kodety_members_forbidden',
    'nonce não substitui capability'
);

$foreign = $instance->public_auth_permission(new WP_REST_Request([], ['Origin' => 'https://attacker.test']));
kodety_members_assert(
    $foreign instanceof WP_Error && $foreign->get_error_code() === 'kodety_members_origin',
    'auth público deve exigir mesma origem'
);
kodety_members_assert(
    $instance->public_challenge_permission(new WP_REST_Request()) === true,
    'challenge vinculado ao IP deve funcionar em páginas same-origin com política no-referrer'
);
$kodety_members_options['kodety_published_project_id'] = 'site-b';
$simple_project_auth = $instance->public_auth_permission(
    new WP_REST_Request([], ['Origin' => 'https://example.test'])
);
kodety_members_assert(
    $simple_project_auth instanceof WP_Error
        && $simple_project_auth->get_error_code() === 'kodety_members_disabled',
    'projeto simples atualmente publicado não pode herdar auth de outro projeto habilitado'
);
$kodety_members_options['kodety_published_project_id'] = 'site-a';
$challenge_response = $instance->issue_auth_challenge(
    new WP_REST_Request([], ['Origin' => 'https://example.test'])
);
kodety_members_assert($challenge_response instanceof WP_REST_Response, 'mesma origem deve receber challenge');
$token = (string) ($challenge_response->get_data()['csrfToken'] ?? '');
$challenge_request = new WP_REST_Request([], ['X-Kodety-CSRF' => $token, 'Origin' => 'https://example.test']);
$consumed = kodety_members_private($instance, 'consume_auth_challenge', $challenge_request);
kodety_members_assert($consumed === true, 'challenge válido deve ser consumido');
$replayed = kodety_members_private($instance, 'consume_auth_challenge', $challenge_request);
kodety_members_assert(
    $replayed instanceof WP_Error && $replayed->get_error_code() === 'kodety_members_csrf',
    'challenge deve ser one-time e rejeitar replay'
);

$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'Agent A';
$fingerprint_a = kodety_members_private($instance, 'request_fingerprint');
$_SERVER['HTTP_USER_AGENT'] = 'Agent B';
$fingerprint_b = kodety_members_private($instance, 'request_fingerprint');
$_SERVER['REMOTE_ADDR'] = '127.0.0.2';
$fingerprint_other_ip = kodety_members_private($instance, 'request_fingerprint');
kodety_members_assert(
    hash_equals($fingerprint_a, $fingerprint_b)
        && !hash_equals($fingerprint_a, $fingerprint_other_ip),
    'rate limit deve ser estável por IP e não gerar bucket novo ao trocar User-Agent'
);
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';

$cookie_options = kodety_members_private(
    $instance,
    'reset_exchange_cookie_options',
    time() + 900
);
kodety_members_assert(
    !array_key_exists('domain', $cookie_options)
        && ($cookie_options['httponly'] ?? false) === true
        && ($cookie_options['secure'] ?? false) === true,
    'cookie bearer de reset deve ser host-only, HttpOnly e Secure no site HTTPS'
);
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/reset-password?key=bad-key&login=member-login';
$_GET = ['key' => 'bad-key', 'login' => 'member-login'];
$before_invalid_exchange = array_filter(
    array_keys($kodety_members_transients),
    static fn(string $key): bool => str_starts_with($key, 'kodety_members_reset_')
);
$instance->capture_password_reset_exchange();
$after_invalid_exchange = array_filter(
    array_keys($kodety_members_transients),
    static fn(string $key): bool => str_starts_with($key, 'kodety_members_reset_')
);
kodety_members_assert(
    count($before_invalid_exchange) === count($after_invalid_exchange),
    'chave de reset inválida não pode criar transient bearer'
);
$_SERVER['REQUEST_URI'] = '/reset-password?key=reset-key&login=member-login';
$_GET = ['key' => 'reset-key', 'login' => 'member-login'];
$instance->capture_password_reset_exchange();
$reset_exchanges = array_filter(
    $kodety_members_transients,
    static fn(mixed $value, string $key): bool => str_starts_with($key, 'kodety_members_reset_'),
    ARRAY_FILTER_USE_BOTH
);
$captured_exchange = $reset_exchanges ? array_values($reset_exchanges)[0] : [];
kodety_members_assert(
    ($captured_exchange['login'] ?? '') === 'member-login'
        && hash_equals(
            (string) ($captured_exchange['fingerprint'] ?? ''),
            (string) kodety_members_private($instance, 'request_fingerprint')
        ),
    'exchange válido deve ser criado apenas após validação e vinculado ao IP'
);
$bound_handle = str_repeat('A', 43);
$bound_key = 'kodety_members_reset_' . hash('sha256', $bound_handle);
$kodety_members_transients[$bound_key] = [
    'key' => 'reset-key',
    'login' => 'member-login',
    'fingerprint' => $fingerprint_a,
];
$_COOKIE['kodety_member_reset'] = $bound_handle;
$_SERVER['REMOTE_ADDR'] = '127.0.0.2';
kodety_members_assert(
    kodety_members_private($instance, 'consume_password_reset_exchange') === [],
    'exchange de reset não pode ser consumido de outro IP'
);
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
unset($_COOKIE['kodety_member_reset']);

$duplicate_event = kodety_members_private(
    $instance,
    'provider_event_duplicate',
    [
        'id' => 1,
        'event_type' => 'subscription.updated',
        'payload_hash' => str_repeat('a', 64),
    ],
    'subscription.updated',
    str_repeat('a', 64)
);
kodety_members_assert(
    is_array($duplicate_event) && ($duplicate_event['duplicate'] ?? false) === true,
    'replay idêntico de evento deve continuar idempotente'
);
$conflicting_event = kodety_members_private(
    $instance,
    'provider_event_duplicate',
    [
        'id' => 1,
        'event_type' => 'subscription.updated',
        'payload_hash' => str_repeat('a', 64),
    ],
    'subscription.updated',
    str_repeat('b', 64)
);
kodety_members_assert(
    $conflicting_event instanceof WP_Error
        && $conflicting_event->get_error_code() === 'kodety_members_event_conflict',
    'mesmo ID externo com payload diferente deve ser conflito'
);
kodety_members_assert(
    $instance->mark_provider_event(1, 'processing') === true
        && str_contains($wpdb->last_query, 'AND status IN'),
    'worker deve adquirir evento por compare-and-set'
);

$public_rule = ['version' => 1, 'requirement' => ['type' => 'public']];
$auth_rule = [
    'version' => 1,
    'requirement' => ['type' => 'authenticated'],
    'denied' => ['mode' => 'replace'],
];
kodety_members_assert(
    Kodety_Members::render_guarded_content('<b>private</b>', '<a>login</a>', $public_rule, 0, 'site-a')
        === '<b>private</b>',
    'bridge de render deve preservar conteúdo permitido'
);
kodety_members_assert(
    Kodety_Members::render_guarded_content('<b>private</b>', '<a>login</a>', $auth_rule, 0, 'site-a')
        === '<a>login</a>',
    'bridge de render deve substituir conteúdo negado sem entregar branch privada'
);

$redacted = kodety_members_private(Kodety_Members::class, 'sanitize_metadata', [
    'campaign' => 'summer',
    'password' => 'secret',
    'token' => 'secret',
    'nested' => ['safe' => 1, 'authorization' => 'Bearer secret'],
]);
kodety_members_assert(($redacted['campaign'] ?? '') === 'summer', 'metadata segura deve sobreviver');
kodety_members_assert(!isset($redacted['password'], $redacted['token']), 'segredos devem ser removidos de metadata');
kodety_members_assert(!isset($redacted['nested']['authorization']), 'redação deve ser recursiva');

$wpdb->mode = 'empty';

update_user_meta(7, '_kodety_membership_status', 'active');
$session_options = kodety_members_private(
    Kodety_Members::class,
    'member_session_cookie_options',
    time() + HOUR_IN_SECONDS
);
kodety_members_assert(
    !array_key_exists('domain', $session_options)
        && ($session_options['httponly'] ?? false) === true
        && ($session_options['samesite'] ?? '') === 'Lax'
        && ($session_options['secure'] ?? false) === true
        && ($session_options['path'] ?? '') === '/',
    'cookie de sessão do membro deve ser host-only, HttpOnly, SameSite e cobrir o site'
);
$login_challenge = $instance->issue_auth_challenge(
    new WP_REST_Request([], ['Origin' => 'https://example.test'])
);
$login_challenge_token = $login_challenge instanceof WP_REST_Response
    ? (string) ($login_challenge->get_data()['csrfToken'] ?? '')
    : '';
$isolated_login = $instance->login(new WP_REST_Request(
    ['login' => 'member', 'password' => 'correct-password', 'remember' => true],
    [
        'Origin' => 'https://example.test',
        'X-Kodety-CSRF' => $login_challenge_token,
    ]
));
kodety_members_assert(
    $isolated_login instanceof WP_REST_Response
        && ($isolated_login->get_data()['authenticated'] ?? false) === true
        && preg_match(
            '/^[a-f0-9]{64}$/',
            (string) ($isolated_login->get_data()['memberCsrf'] ?? '')
        ),
    'login público deve autenticar por credencial sem criar cookie nativo do WordPress'
);
$instance->destroy_current_member_session();
$member_session = $instance->start_member_session($kodety_members_users[7], true);
kodety_members_assert(
    is_array($member_session)
        && preg_match('/^[a-f0-9]{64}$/', (string) ($member_session['memberCsrf'] ?? ''))
        && Kodety_Members::current_member_id() === 7,
    'sessão opaca deve autenticar o membro sem depender do current user do WordPress'
);
$legacy_nonce_denied = $instance->member_permission(new WP_REST_Request(
    [],
    ['Origin' => 'https://example.test', 'X-WP-Nonce' => 'valid-rest-nonce']
));
kodety_members_assert(
    $legacy_nonce_denied instanceof WP_Error
        && $legacy_nonce_denied->get_error_code() === 'kodety_members_nonce',
    'nonce do WordPress nunca deve autorizar a sessão pública de membro'
);
$member_permission_allowed = $instance->member_permission(new WP_REST_Request(
    [],
    [
        'Origin' => 'https://example.test',
        'X-Kodety-Member-CSRF' => (string) $member_session['memberCsrf'],
    ]
));
kodety_members_assert(
    $member_permission_allowed === true,
    'sessão de membro deve exigir seu próprio CSRF e mesma origem'
);
$cookie_name = (string) kodety_members_private(
    Kodety_Members::class,
    'member_session_cookie_name'
);
$session_token = (string) kodety_members_private_property(
    $instance,
    'member_session_token_cache'
);
$_COOKIE[$cookie_name] = $session_token;
kodety_members_set_private_property($instance, 'member_session_checked', false);
kodety_members_set_private_property($instance, 'member_session_user_cache', null);
kodety_members_set_private_property($instance, 'member_session_token_cache', '');
$original_password_hash = $kodety_members_users[7]->user_pass;
$kodety_members_users[7]->user_pass = '$P$changed-password-hash';
kodety_members_assert(
    Kodety_Members::current_member_id() === 0,
    'alterar a senha deve invalidar imediatamente sessões públicas anteriores'
);
$kodety_members_users[7]->user_pass = $original_password_hash;
unset($_COOKIE[$cookie_name]);
$fresh_session = $instance->start_member_session($kodety_members_users[7], false);
kodety_members_assert(is_array($fresh_session), 'membro ativo deve poder iniciar nova sessão');
$instance->destroy_current_member_session();
kodety_members_assert(
    Kodety_Members::current_member_id() === 0,
    'logout público deve remover somente a sessão Kodety'
);
$native_member_blocked = $instance->block_native_member_login(
    $kodety_members_users[7],
    'member',
    'correct-password'
);
kodety_members_assert(
    $native_member_blocked instanceof WP_Error
        && $native_member_blocked->get_error_code() === 'kodety_members_native_login_blocked',
    'conta de membro não pode criar sessão nativa pelo wp-login'
);
kodety_members_assert(
    $instance->filter_member_application_passwords(true, $kodety_members_users[7]) === false
        && $instance->filter_member_application_passwords(
            true,
            $kodety_members_users[88]
        ) === true
        && $instance->filter_member_application_passwords(
            true,
            $kodety_members_users[91]
        ) === false
        && ($kodety_members_user_meta[91]['_kodety_membership_status'] ?? '') === 'active',
    'Application Passwords devem ficar indisponíveis só para contas públicas Kodety'
);
$enabled_membership_settings = $kodety_members_options['kodety_membership_settings'];
$kodety_members_options['kodety_membership_settings']['enabled'] = false;
kodety_members_assert(
    $instance->filter_member_application_passwords(
        true,
        $kodety_members_users[7]
    ) === true
        && $instance->block_native_member_login(
            $kodety_members_users[7],
            'member',
            'correct-password'
        ) === $kodety_members_users[7],
    'desativar membership deve restaurar autenticações WordPress sem impactar site simples'
);
$kodety_members_options['kodety_membership_settings'] = $enabled_membership_settings;
kodety_members_assert(
    $instance->block_native_member_login(
        $kodety_members_users[88],
        'editor-account',
        'correct-password'
    ) === $kodety_members_users[88],
    'bloqueio de login de membro não pode atingir o editor do WordPress'
);
kodety_members_assert(
    $instance->block_native_member_login(
        $kodety_members_users[89],
        'generic-subscriber',
        'correct-password'
    ) === $kodety_members_users[89],
    'ativar membership não pode sequestrar login de subscriber genérico sem evidência Kodety'
);
$legacy_member_blocked = $instance->block_native_member_login(
    $kodety_members_users[91],
    'legacy-kodety-member',
    'correct-password'
);
kodety_members_assert(
    $legacy_member_blocked instanceof WP_Error
        && $legacy_member_blocked->get_error_code() === 'kodety_members_native_login_blocked'
        && ($kodety_members_user_meta[91]['_kodety_membership_status'] ?? '') === 'active',
    'membro legado só deve migrar e sair do login nativo quando houver evidência Kodety'
);
$editor_session = $instance->start_member_session($kodety_members_users[88], false);
kodety_members_assert(
    $editor_session instanceof WP_Error
        && $editor_session->get_error_code() === 'kodety_members_session_forbidden',
    'credenciais de editor nunca podem virar uma sessão pública de membro'
);
$elevated_session = $instance->start_member_session($kodety_members_users[90], false);
kodety_members_assert(
    $elevated_session instanceof WP_Error
        && $elevated_session->get_error_code() === 'kodety_members_session_forbidden',
    'capability individual fora da allowlist deve impedir sessão pública'
);

$queries_before_deletion = count($wpdb->queries);
$audits_before_deletion = $wpdb->insert_count;
$meta_writes_before_deletion = $kodety_members_user_meta_writes;
$instance->capture_user_deletion(57, 7, $kodety_members_users[57]);
unset($kodety_members_users[57]);
$instance->finalize_user_deletion(57, 7);
$deletion_queries = array_slice($wpdb->queries, $queries_before_deletion);
kodety_members_assert(
    count(array_filter(
        $deletion_queries,
        static fn(string $query): bool => str_contains(
            $query,
            'UPDATE wp_kodety_membership_grants'
        ) && str_contains($query, 'status=%s')
    )) === 1,
    'exclusão nativa deve revogar somente grants ainda ativos'
);
kodety_members_assert(
    count(array_filter(
        $deletion_queries,
        static fn(string $query): bool => str_contains(
            $query,
            'UPDATE wp_kodety_membership_subscriptions'
        ) && str_contains($query, "status IN (%s,%s,%s,%s,%s)")
          && str_contains($query, 'revision=revision+1')
    )) === 1,
    'exclusão deve cancelar assinaturas não-terminais e preservar revisão'
);
kodety_members_assert(
    $kodety_members_user_meta_writes === $meta_writes_before_deletion,
    'finalização pós-exclusão não pode recriar usermeta órfão'
);
kodety_members_assert(
    $wpdb->insert_count === $audits_before_deletion + 1,
    'exclusão bem-sucedida deve produzir uma única auditoria'
);
$queries_after_first_finalization = count($wpdb->queries);
$instance->finalize_user_deletion(57, 7);
kodety_members_assert(
    count($wpdb->queries) === $queries_after_first_finalization
        && $wpdb->insert_count === $audits_before_deletion + 1,
    'finalização repetida deve ser idempotente e não duplicar auditoria'
);

$wpdb->mode = 'fail_subscription_cleanup';
$failed_cleanup = kodety_members_private($instance, 'terminalize_user_membership', 56);
kodety_members_assert(
    $failed_cleanup instanceof WP_Error
        && $failed_cleanup->get_error_code() === 'kodety_members_storage'
        && $wpdb->last_query === 'ROLLBACK',
    'falha parcial ao finalizar acesso deve executar rollback e ficar reconciliável'
);
$wpdb->mode = 'empty';

fwrite(STDOUT, "Members runtime: policy, roles, temporal access, reset exchange, CAS, origin, CSRF and redaction verified.\n");
