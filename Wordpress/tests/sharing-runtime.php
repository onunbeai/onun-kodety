<?php

/**
 * Isolated security contracts for project sharing.
 *
 * Run with: php Wordpress/tests/sharing-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('MB_IN_BYTES', 1048576);
define('MINUTE_IN_SECONDS', 60);

final class Kodety_Plugin {
    public const CAP_EDIT_WORKSPACE = 'kodety_edit';
    public const CAP_ACCESS_CMS = 'kodety_access_cms';
    public const CAP_VIEW_ANALYTICS = 'kodety_view_analytics';
    public const CAP_MANAGE_CMS_SCHEMA = 'kodety_manage_cms_schema';
    public const CAP_MANAGE_CMS_TEMPLATES = 'kodety_manage_cms_templates';
    public const CAP_MANAGE_ANALYTICS = 'kodety_manage_analytics';
}

final class WP_User {
    /** @param list<string> $roles */
    public function __construct(
        public int $ID = 42,
        public string $user_email = 'owner@example.test',
        public string $display_name = 'Owner',
        public string $user_login = 'owner',
        public array $roles = ['subscriber']
    ) {}

    public function set_role(string $role): void {
        $this->roles = $role === '' ? [] : [$role];
    }
}

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message = '',
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Response {
    public function __construct(private mixed $data = null) {}
    public function get_data(): mixed { return $this->data; }
    public function header(string $name, string $value): void {}
}

final class WP_REST_Request {
    /** @param array<string,mixed> $json */
    public function __construct(
        private string $method = 'GET',
        private string $route = '/kodety/v1/project',
        private array $headers = [],
        private array $json = []
    ) {
        $this->headers = array_change_key_case($this->headers, CASE_LOWER);
    }
    public function get_method(): string { return $this->method; }
    public function get_route(): string { return $this->route; }
    public function get_header(string $name): ?string {
        $value = $this->headers[strtolower($name)] ?? null;
        return $value === null ? null : (string) $value;
    }
    public function get_param(string $name): mixed { return $this->json[$name] ?? null; }
    public function get_body(): string { return (string) json_encode($this->json); }
    /** @return array<string,mixed> */
    public function get_json_params(): array { return $this->json; }
}

final class WP_Query {
    public function get(string $name): string {
        return (string) ($GLOBALS['kodety_sharing_query_vars'][$name] ?? '');
    }
}

$kodety_sharing_options = [
    'kodety_workspace_mode' => 'single',
    'kodety_project_shares' => [],
    'kodety_agency_projects' => [],
    'kodety_agency_active_project' => '',
];
$kodety_sharing_logged_in = true;
$kodety_sharing_current_user = 42;
$kodety_sharing_query_vars = [];
$wp_query = new WP_Query();
$kodety_sharing_last_mail = [];
$kodety_sharing_users = [
    42 => new WP_User(42, 'owner@example.test', 'Owner', 'owner', ['administrator']),
    43 => new WP_User(43, 'user43@example.test', 'User 43', 'user43', ['editor']),
    44 => new WP_User(44, 'existing.editor@example.test', 'Existing Editor', 'existing-editor'),
    45 => new WP_User(45, 'viewer@example.test', 'Viewer', 'viewer'),
    46 => new WP_User(46, 'admin@example.test', 'Administrator', 'administrator', ['administrator']),
];

function add_action(...$arguments): void {}
function do_action(...$arguments): void {}
function add_filter(...$arguments): void {}
function register_rest_route(...$arguments): void {}
function __return_true(): bool { return true; }
function add_option(string $name, mixed $value, string $deprecated = '', bool $autoload = false): bool {
    global $kodety_sharing_options;
    if (!array_key_exists($name, $kodety_sharing_options)) $kodety_sharing_options[$name] = $value;
    return true;
}
function get_option(string $name, mixed $default = false): mixed {
    global $kodety_sharing_options;
    return $kodety_sharing_options[$name] ?? $default;
}
function update_option(string $name, mixed $value, bool $autoload = false): bool {
    global $kodety_sharing_options;
    $kodety_sharing_options[$name] = $value;
    return true;
}
function delete_option(string $name): bool {
    global $kodety_sharing_options;
    unset($kodety_sharing_options[$name]);
    return true;
}
function wp_cache_delete(string $key, string $group = ''): bool { return true; }
function get_query_var(string $name): string {
    global $wp_query;
    // Match core's dependency on an initialized main query. Calling this too
    // early must fail here too, so the theme-preview regression stays covered.
    return $wp_query->get($name);
}
function is_user_logged_in(): bool {
    global $kodety_sharing_logged_in;
    return $kodety_sharing_logged_in;
}
function sanitize_key(string $value): string {
    return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: '';
}
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_user(string $value, bool $strict = false): string { return preg_replace('/[^a-zA-Z0-9_.-]/', '', $value) ?: ''; }
function sanitize_email(string $value): string { return filter_var(trim($value), FILTER_SANITIZE_EMAIL) ?: ''; }
function is_email(string $value): bool { return filter_var($value, FILTER_VALIDATE_EMAIL) !== false; }
function wp_unslash(mixed $value): mixed { return $value; }
function rest_sanitize_boolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN);
}
function absint(mixed $value): int { return abs((int) $value); }
function get_current_user_id(): int { global $kodety_sharing_current_user, $kodety_sharing_logged_in; return $kodety_sharing_logged_in ? $kodety_sharing_current_user : 0; }
function wp_get_current_user(): WP_User {
    global $kodety_sharing_current_user, $kodety_sharing_users;
    return $kodety_sharing_users[$kodety_sharing_current_user]
        ?? new WP_User($kodety_sharing_current_user, "user{$kodety_sharing_current_user}@example.test", "User {$kodety_sharing_current_user}", "user{$kodety_sharing_current_user}");
}
function get_user_by(string $field, mixed $value): WP_User|false {
    global $kodety_sharing_users;
    foreach ($kodety_sharing_users as $user) {
        if ($field === 'email' && strtolower($user->user_email) === strtolower((string) $value)) return $user;
        if (($field === 'id' || $field === 'ID') && $user->ID === (int) $value) return $user;
        if ($field === 'login' && $user->user_login === (string) $value) return $user;
    }
    return false;
}
function username_exists(string $username): int|false {
    $user = get_user_by('login', $username);
    return $user ? $user->ID : false;
}
function wp_insert_user(array $data): int|WP_Error {
    global $kodety_sharing_users;
    $id = max(array_keys($kodety_sharing_users)) + 1;
    $kodety_sharing_users[$id] = new WP_User(
        $id,
        (string) ($data['user_email'] ?? ''),
        (string) ($data['display_name'] ?? ''),
        (string) ($data['user_login'] ?? ''),
        [(string) ($data['role'] ?? 'subscriber')]
    );
    return $id;
}
function wp_set_current_user(int $user_id): WP_User {
    global $kodety_sharing_current_user, $kodety_sharing_logged_in;
    $kodety_sharing_current_user = $user_id;
    $kodety_sharing_logged_in = true;
    return wp_get_current_user();
}
function wp_set_auth_cookie(int $user_id, bool $remember = false, bool $secure = false): void {}
function is_ssl(): bool { return true; }
function is_super_admin(int $user_id = 0): bool { return false; }
function get_avatar_url(int $user_id, array $arguments = []): string { return "https://avatar.example.test/{$user_id}.png"; }
function current_user_can(string $capability): bool {
    $capabilities = $GLOBALS['kodety_sharing_capabilities'] ?? null;
    return $capabilities === null || in_array($capability, $capabilities, true);
}
function wp_verify_nonce(string $nonce, string $action): bool { return $nonce === 'valid-onboarding-nonce' && $action === 'wp_rest'; }
function get_user_meta(int $user_id, string $key, bool $single): mixed {
    $values = $GLOBALS['kodety_sharing_user_meta'][$user_id][$key] ?? [];
    return $single ? ($values[0] ?? '') : $values;
}
function add_user_meta(int $user_id, string $key, mixed $value, bool $unique): bool {
    if ($unique && get_user_meta($user_id, $key, false) !== []) return false;
    $GLOBALS['kodety_sharing_user_meta'][$user_id][$key][] = $value;
    return true;
}
function update_user_meta(int $user_id, string $key, mixed $value, mixed $previous = ''): bool {
    $current = get_user_meta($user_id, $key, true);
    if ($current === $value || ($previous !== '' && $current !== $previous)) return false;
    $GLOBALS['kodety_sharing_user_meta'][$user_id][$key] = [$value];
    return true;
}
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function wp_mail(string $to, string $subject, string $message): bool {
    global $kodety_sharing_last_mail;
    $kodety_sharing_last_mail = compact('to', 'subject', 'message');
    return true;
}
function wp_specialchars_decode(string $value, int $flags = ENT_QUOTES): string { return html_entity_decode($value, $flags); }
function get_bloginfo(string $field = ''): string { return 'Kodety Test'; }
function current_time(string $type): string { return '2026-07-28T15:00:00-03:00'; }
function home_url(string $path = ''): string {
    return 'https://example.test/' . ltrim($path, '/');
}
function add_query_arg(string $key, string $value, string $url): string {
    return $url . (str_contains($url, '?') ? '&' : '?') . rawurlencode($key) . '=' . rawurlencode($value);
}
function wp_login_url(string $redirect = ''): string { return 'https://example.test/wp-login.php?redirect_to=' . rawurlencode($redirect); }
function wp_lostpassword_url(string $redirect = ''): string { return 'https://example.test/wp-login.php?action=lostpassword&redirect_to=' . rawurlencode($redirect); }

require dirname(__DIR__) . '/kodety/includes/class-kodety-sharing.php';
require dirname(__DIR__) . '/kodety/includes/class-kodety-builder-onboarding.php';

function kodety_sharing_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_sharing_error_code(mixed $value): string {
    return $value instanceof WP_Error ? $value->get_error_code() : '';
}

function kodety_sharing_lock_boundary(Kodety_Sharing $sharing, WP_REST_Request $request): mixed {
    return $sharing->enforce_editor_lock_before_dispatch(
        null,
        $request,
        $request->get_route(),
        []
    );
}

function kodety_sharing_token_from_url(string $url): string {
    preg_match('~/kodety/share/([A-Za-z0-9_-]{43})/~', $url, $matches);
    return (string) ($matches[1] ?? '');
}

$sharing = Kodety_Sharing::instance();
$admin_workspace_mutations = [
    ['POST', '/kodety/v1/project'],
    ['POST', '/kodety/v1/project/delta'],
    ['POST', '/kodety/v1/project/localization'],
    ['POST', '/kodety/v1/project/chunk'],
    ['POST', '/kodety/v1/publish'],
    ['POST', '/kodety/v1/optimizations'],
    ['POST', '/kodety/v1/analytics/experiments'],
    ['POST', '/kodety/v1/preview'],
    ['POST', '/kodety/v1/import-url'],
    ['POST', '/kodety/v1/media-folders'],
    ['POST', '/kodety/v1/media-folders/12'],
    ['DELETE', '/kodety/v1/media-folders/12'],
    ['POST', '/kodety/v1/media-folders/move'],
    ['POST', '/kodety/v1/media-replace/34'],
    ['POST', '/kodety/v1/cms/collections'],
    ['PUT', '/kodety/v1/cms/collections/news'],
    ['DELETE', '/kodety/v1/cms/collections/news'],
    ['POST', '/kodety/v1/cms/fields/news'],
    ['POST', '/kodety/v1/cms/templates'],
    ['POST', '/kodety/v1/cms/items/news'],
    ['POST', '/kodety/v1/cms/items/news/import'],
    ['POST', '/kodety/v1/cms/items/news/34'],
    ['DELETE', '/kodety/v1/cms/items/news/34'],
    ['POST', '/wp/v2/media'],
];
foreach ($admin_workspace_mutations as [$admin_method, $admin_route]) {
    kodety_sharing_assert(
        kodety_sharing_lock_boundary($sharing, new WP_REST_Request($admin_method, $admin_route)) === null,
        'wp-admin autorizado deve funcionar sem abrir o Builder: ' . $admin_method . ' ' . $admin_route
    );
}
$sharing_contract = new ReflectionClass(Kodety_Sharing::class);
$feed_max_bytes = $sharing_contract->getReflectionConstant('FEED_MAX_BYTES');
$feed_max_changes = $sharing_contract->getReflectionConstant('FEED_MAX_CHANGES');
$kodety_sharing_options['kodety_collaboration_feed'] = ['legacy' => ['change']];
Kodety_Sharing::activate();
$sharing_source = file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-sharing.php');
kodety_sharing_assert(
    $feed_max_bytes instanceof ReflectionClassConstant
    && $feed_max_bytes->getValue() === 0
    && $feed_max_changes instanceof ReflectionClassConstant
    && $feed_max_changes->getValue() === 0,
    'feed multi-editor removido deve possuir limites efetivos explícitos de zero bytes e zero mudanças'
);
kodety_sharing_assert(
    !array_key_exists('kodety_collaboration_feed', $kodety_sharing_options)
    && is_string($sharing_source)
    && !str_contains($sharing_source, "get_option('kodety_collaboration_feed'")
    && preg_match(
        "/register_rest_route\\('kodety\\/v1', '\\/collaboration\\/(?:turn|changes|settings)'/",
        $sharing_source
    ) !== 1,
    'ativação deve apagar o feed legado sem reintroduzir reader ou rota multi-editor'
);

$boundary_permission_checks = 0;
$plain_workspace_write = new WP_REST_Request('POST', '/kodety/v1/project');
$denied_workspace_handler = [
    'permission_callback' => static function () use (&$boundary_permission_checks): bool {
        $boundary_permission_checks++;
        return false;
    },
];
$allowed_workspace_handler = [
    'permission_callback' => static function () use (&$boundary_permission_checks): bool {
        $boundary_permission_checks++;
        return true;
    },
];
kodety_sharing_assert(
    $sharing->enforce_rest_boundary(
        null,
        $denied_workspace_handler,
        $plain_workspace_write
    ) === null
    && $sharing->enforce_rest_boundary(
        null,
        $allowed_workspace_handler,
        $plain_workspace_write
    ) === null
    && $boundary_permission_checks === 0,
    'boundary de compartilhamento não deve antecipar nem duplicar permission_callback'
);
$denied_permission = $denied_workspace_handler['permission_callback']($plain_workspace_write);
$allowed_permission = $allowed_workspace_handler['permission_callback']($plain_workspace_write);
$missing_lock = $sharing->enforce_editor_lock_before_dispatch(
    null,
    $plain_workspace_write,
    '/kodety/v1/project',
    $allowed_workspace_handler
);
kodety_sharing_assert(
    $denied_permission === false
    && $allowed_permission === true
    && $boundary_permission_checks === 2,
    'WordPress deve continuar decidindo 401/403 pela permission_callback real'
);
kodety_sharing_assert(
    $missing_lock === null,
    'rota autorizada sem contexto visual deve funcionar sem lease'
);
kodety_sharing_assert(
    kodety_sharing_lock_boundary($sharing, new WP_REST_Request('POST', '/kodety/v1/optimizations')) === null,
    'preferências de publicação autorizadas também funcionam no wp-admin sem uma lease do Builder'
);
kodety_sharing_assert(
    kodety_sharing_error_code(kodety_sharing_lock_boundary($sharing, new WP_REST_Request('POST', '/kodety/v1/optimizations/unrecognized', ['X-Kodety-Editor-Session' => 'incomplete_editor_session']))) === 'kodety_editor_lock_required',
    'contexto visual parcial deve continuar exigindo lease'
);

$view_state = $sharing->save_share(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing',
    [],
    ['permission' => 'view', 'authRequired' => false, 'enabled' => true]
))->get_data();
$view_token = kodety_sharing_token_from_url((string) ($view_state['url'] ?? ''));
kodety_sharing_assert(strlen($view_token) === 43, 'link deve usar token criptograficamente forte e opaco');

// WordPress may ask for capabilities before parse_request resolves the pretty
// share URL. That early empty lookup must not poison the rest of the request.
$kodety_sharing_query_vars = [];
$wp_query = null;
$preview_caps = ['read' => true, 'customize' => true];
kodety_sharing_assert(
    $sharing->grant_share_capabilities($preview_caps, ['customize'], ['customize', 42], $kodety_sharing_users[42]) === $preview_caps,
    'prévia de tema antes da criação de WP_Query deve preservar capacidades sem erro fatal'
);
kodety_sharing_assert($sharing->context() === null, 'requisição ainda sem rota não deve inventar compartilhamento');
$wp_query = new WP_Query();
$kodety_sharing_query_vars['kodety_share'] = $view_token;
kodety_sharing_assert(
    ($sharing->context()['token'] ?? '') === $view_token,
    'token resolvido depois de parse_request deve continuar válido na mesma requisição'
);
$wp_query = null;
$early_shared_request = new WP_REST_Request('GET', '/kodety/v1/project', ['X-Kodety-Share' => $view_token]);
kodety_sharing_assert(
    ($sharing->context($early_shared_request)['token'] ?? '') === $view_token,
    'token explícito de REST deve continuar sendo resolvido antes da criação de WP_Query'
);
$wp_query = new WP_Query();
$kodety_sharing_query_vars = [];

$kodety_sharing_logged_in = false;
$view_get = new WP_REST_Request('GET', '/kodety/v1/project', ['X-Kodety-Share' => $view_token]);
$view_post = new WP_REST_Request('POST', '/kodety/v1/project', ['X-Kodety-Share' => $view_token]);
foreach (['/kodety/v1/project', '/kodety/v1/project/localization', '/kodety/v1/cms/items/news', '/kodety/v1/media-folders', '/kodety/v1/analytics/experiments'] as $shared_route) {
    $shared_nonvisual = new WP_REST_Request('POST', $shared_route, ['X-Kodety-Share' => $view_token]);
    kodety_sharing_assert(
        !Kodety_Sharing::has_editor_context($shared_nonvisual)
        && kodety_sharing_lock_boundary($sharing, $shared_nonvisual) === null
        && kodety_sharing_error_code($sharing->enforce_rest_boundary(null, [], $shared_nonvisual)) === 'kodety_share_read_only',
        'share sem sessão visual dispensa lease mas continua somente leitura: ' . $shared_route
    );
}
require_once dirname(__DIR__) . '/kodety/includes/class-kodety-native-operations.php';
$native_read = new WP_REST_Request('POST', '/kodety/v1/automation/call', [
    'X-Kodety-Share' => $view_token,
    'X-Kodety-Editor-Session' => 'view_only_session_123456',
], ['operation' => 'cms_schema', 'arguments' => []]);
kodety_sharing_assert(
    Kodety_Native_Operations::request_is_read_only($native_read)
    && $sharing->enforce_rest_boundary(null, [], $native_read) === null
    && kodety_sharing_lock_boundary($sharing, $native_read) === null,
    'uma operação nativa de leitura pode atravessar o wrapper POST no compartilhamento view sem lease'
);
$native_write = new WP_REST_Request('POST', '/kodety/v1/automation/call', [
    'X-Kodety-Share' => $view_token,
], ['operation' => 'cms_create_collection', 'arguments' => ['name' => 'Forbidden', 'expectedRevision' => 'rev']]);
kodety_sharing_assert(
    !Kodety_Native_Operations::request_is_read_only($native_write)
    && kodety_sharing_error_code($sharing->enforce_rest_boundary(null, [], $native_write)) === 'kodety_share_read_only',
    'o wrapper não pode transformar uma mutação nativa em leitura compartilhada'
);
foreach ([
    ['operation' => 'cms_schema', 'arguments' => ['route' => '/wp/v2/users']],
    ['operation' => 'cms_schema', 'arguments' => [], 'unknown' => true],
    ['operation' => 'missing', 'arguments' => []],
] as $malformed) {
    $request = new WP_REST_Request('POST', '/kodety/v1/automation/call', ['X-Kodety-Share' => $view_token], $malformed);
    kodety_sharing_assert(
        !Kodety_Native_Operations::request_is_read_only($request)
        && kodety_sharing_error_code($sharing->enforce_rest_boundary(null, [], $request)) === 'kodety_share_read_only',
        'somente envelopes válidos de operações catalogadas podem receber classificação de leitura'
    );
}
kodety_sharing_assert($sharing->is_accessible($view_get), 'visualização pública deve funcionar sem login');
kodety_sharing_assert(
    $sharing->enforce_rest_boundary(null, [], $view_get) === null,
    'visualização pública deve permitir leitura dos painéis'
);
kodety_sharing_assert(
    kodety_sharing_error_code($sharing->enforce_rest_boundary(null, [], $view_post)) === 'kodety_share_read_only',
    'visualização pública deve rejeitar toda escrita no servidor'
);
kodety_sharing_assert(
    kodety_sharing_error_code($sharing->enforce_rest_boundary(
        null,
        [],
        new WP_REST_Request('GET', '/kodety/v1/sharing', ['X-Kodety-Share' => $view_token])
    )) === 'kodety_share_management_forbidden',
    'convidado não deve consultar nem administrar o próprio compartilhamento'
);

$kodety_sharing_logged_in = true;
$edit_state = $sharing->save_share(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing',
    [],
    ['permission' => 'edit', 'authRequired' => false, 'enabled' => true, 'regenerate' => true]
))->get_data();
$edit_token = kodety_sharing_token_from_url((string) ($edit_state['url'] ?? ''));
kodety_sharing_assert(!empty($edit_state['authRequired']), 'edição deve sempre forçar conta autenticada');

$kodety_sharing_logged_in = false;
$anonymous_edit = new WP_REST_Request('GET', '/kodety/v1/project', ['X-Kodety-Share' => $edit_token]);
kodety_sharing_assert(!$sharing->is_accessible($anonymous_edit), 'link de edição deve rejeitar sessão anônima');

$kodety_sharing_logged_in = true;
$authenticated_lock = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    ['X-Kodety-Share' => $edit_token],
    [
        'sessionId' => 'authenticated_edit_123456',
        'leaseId' => 'authenticated_lease_123456',
    ]
))->get_data();
$authenticated_edit = new WP_REST_Request('POST', '/kodety/v1/project', [
    'X-Kodety-Share' => $edit_token,
    'X-Kodety-Editor-Session' => 'authenticated_edit_123456',
    'X-Kodety-Editor-Lease' => 'authenticated_lease_123456',
]);
kodety_sharing_assert(
    ($authenticated_lock['mode'] ?? '') === 'edit'
    && $sharing->enforce_rest_boundary(null, [], $authenticated_edit) === null
    && kodety_sharing_lock_boundary($sharing, $authenticated_edit) === null,
    'link de edição autenticado deve permitir salvar somente com seu lock exato'
);
$share_lock_before_nonvisual = $kodety_sharing_options['kodety_editor_lock'];
foreach (['/kodety/v1/project', '/kodety/v1/project/localization', '/kodety/v1/cms/items/news', '/kodety/v1/media-folders', '/kodety/v1/analytics/experiments'] as $shared_route) {
    $shared_nonvisual = new WP_REST_Request('POST', $shared_route, ['X-Kodety-Share' => $edit_token]);
    kodety_sharing_assert(
        !Kodety_Sharing::has_editor_context($shared_nonvisual)
        && kodety_sharing_lock_boundary($sharing, $shared_nonvisual) === null
        && $sharing->enforce_rest_boundary(null, [], $shared_nonvisual) === null,
        'share edit autorizado acessa outras superfícies sem adquirir sessão visual: ' . $shared_route
    );
}
kodety_sharing_assert($kodety_sharing_options['kodety_editor_lock'] === $share_lock_before_nonvisual, 'escrita não visual compartilhada preserva a sessão visual existente');
kodety_sharing_assert(
    kodety_sharing_error_code($sharing->enforce_rest_boundary(
        null,
        [],
        new WP_REST_Request('POST', '/kodety/v1/publish', ['X-Kodety-Share' => $edit_token])
    )) === 'kodety_share_operation_forbidden',
    'nem o link de edição pode publicar no WordPress'
);

$invalid = new WP_REST_Request(
    'GET',
    '/kodety/v1/project',
    ['X-Kodety-Share' => str_repeat('x', 43)]
);
kodety_sharing_assert(
    kodety_sharing_error_code($sharing->enforce_rest_boundary(null, [], $invalid)) === 'kodety_share_forbidden',
    'token inválido ou revogado deve falhar fechado'
);

// An edit invitation is an individual capability: a new invitee can view the
// project, create their password once and immediately re-enter as an editor.
$kodety_sharing_logged_in = true;
$kodety_sharing_current_user = 42;
$sharing->invite_collaborator(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'new.editor@example.test', 'permission' => 'edit']
));
preg_match('/[?&]kodety_invite=([A-Za-z0-9_-]{43})/', (string) ($kodety_sharing_last_mail['message'] ?? ''), $invite_matches);
$invite_token = (string) ($invite_matches[1] ?? '');
kodety_sharing_assert(strlen($invite_token) === 43, 'convite deve enviar um link individual com token opaco');
$kodety_sharing_logged_in = false;
$kodety_sharing_current_user = 0;
$invited_headers = ['X-Kodety-Share' => $edit_token, 'X-Kodety-Invite' => $invite_token];
$invited_view = new WP_REST_Request('GET', '/kodety/v1/project', $invited_headers);
$invited_context = $sharing->context($invited_view);
kodety_sharing_assert(
    $sharing->is_accessible($invited_view)
    && ($invited_context['permission'] ?? '') === 'view'
    && ($invited_context['invitation']['email'] ?? '') === 'new.editor@example.test',
    'novo convidado deve visualizar com segurança antes de ativar sua conta'
);
$accept_request = new WP_REST_Request(
    'POST',
    '/kodety/v1/collaboration/invitation/accept',
    $invited_headers,
    ['invitationToken' => $invite_token, 'displayName' => 'New Editor', 'password' => 'safe-password-123']
);
kodety_sharing_assert(
    $sharing->enforce_rest_boundary(null, [], $accept_request) === null,
    'endpoint de aceite deve ser a única escrita anônima permitida pelo convite'
);
$accepted = $sharing->accept_invitation($accept_request);
kodety_sharing_assert(
    !is_wp_error($accepted)
    && !empty($accepted->get_data()['success'])
    && is_user_logged_in()
    && wp_get_current_user()->user_email === 'new.editor@example.test',
    'aceite deve criar a conta, autenticar e preservar exatamente o email convidado'
);
kodety_sharing_assert(
    wp_get_current_user()->roles === ['editor'],
    'conta criada por convite de edição deve receber o papel WordPress Editor'
);
$accepted_user_id = get_current_user_id();
$invited_lock_headers = array_merge($invited_headers, [
    'X-Kodety-Editor-Session' => 'invited_editor_12345678',
    'X-Kodety-Editor-Lease' => 'invited_editor_lease_12345678',
]);
$invited_lock = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    $invited_lock_headers,
    [
        'sessionId' => 'invited_editor_12345678',
        'leaseId' => 'invited_editor_lease_12345678',
    ]
))->get_data();
$invited_edit = new WP_REST_Request('POST', '/kodety/v1/project', $invited_lock_headers);
kodety_sharing_assert(
    ($invited_lock['mode'] ?? '') === 'view'
    && !empty($invited_lock['limited'])
    && kodety_sharing_error_code(kodety_sharing_lock_boundary($sharing, $invited_edit)) === 'kodety_editor_lock_required',
    'sessão aceita deve ficar somente leitura enquanto outra sessão segura o lock'
);

// The invitation list is the source of truth for WordPress editor access.
// Existing accounts are promoted immediately, while viewers and site
// administrators keep their original roles.
$kodety_sharing_logged_in = true;
$kodety_sharing_current_user = 42;
$sharing->invite_collaborator(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'existing.editor@example.test', 'permission' => 'edit']
));
preg_match('/[?&]kodety_invite=([A-Za-z0-9_-]{43})/', (string) ($kodety_sharing_last_mail['message'] ?? ''), $existing_invite_matches);
$existing_invite_token = (string) ($existing_invite_matches[1] ?? '');
kodety_sharing_assert(
    $kodety_sharing_users[44]->roles === ['editor'],
    'convite de edição deve promover imediatamente uma conta WordPress existente'
);
$sharing->invite_collaborator(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'viewer@example.test', 'permission' => 'view']
));
kodety_sharing_assert(
    $kodety_sharing_users[45]->roles === ['subscriber'],
    'convite somente leitura não deve promover a conta WordPress'
);
$sharing->invite_collaborator(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'admin@example.test', 'permission' => 'edit']
));
kodety_sharing_assert(
    $kodety_sharing_users[46]->roles === ['administrator'],
    'convite de edição nunca deve rebaixar um administrador'
);

$sharing->remove_invitation(new WP_REST_Request(
    'DELETE',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'existing.editor@example.test']
));
kodety_sharing_assert(
    $kodety_sharing_users[44]->roles === [],
    'remover o último convite de edição deve revogar todo o acesso WordPress da conta'
);
kodety_sharing_assert(
    $sharing->context(new WP_REST_Request('GET', '/kodety/v1/project', [
        'X-Kodety-Share' => $edit_token,
        'X-Kodety-Invite' => $existing_invite_token,
    ])) === null,
    'link individual removido deve falhar fechado mesmo quando o link geral permite edição'
);

$sharing->invite_collaborator(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'existing.editor@example.test', 'permission' => 'edit']
));
$sharing->invite_collaborator(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'existing.editor@example.test', 'permission' => 'view']
));
kodety_sharing_assert(
    $kodety_sharing_users[44]->roles === [],
    'trocar o último convite de edição por visualização deve revogar o acesso WordPress'
);

$sharing->invite_collaborator(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing/invitations',
    [],
    ['email' => 'existing.editor@example.test', 'permission' => 'edit']
));
$sharing->delete_share();
kodety_sharing_assert(
    $kodety_sharing_users[44]->roles === []
    && wp_get_current_user()->roles === ['administrator']
    && $kodety_sharing_users[46]->roles === ['administrator'],
    'excluir o compartilhamento deve revogar convidados sem afetar administradores'
);

// Agency shares belong to the selected project, not to the owner's mutable
// "currently open" project. Switching Builder projects must preserve the link
// and keep the request scoped to the original project.
$kodety_sharing_options['kodety_workspace_mode'] = 'agency';
$kodety_sharing_options['kodety_agency_projects'] = [
    'project-alpha' => ['id' => 'project-alpha', 'name' => 'Alpha'],
    'project-beta' => ['id' => 'project-beta', 'name' => 'Beta'],
];
$kodety_sharing_options['kodety_agency_active_project'] = 'project-alpha';
$agency_state = $sharing->save_share(new WP_REST_Request(
    'POST',
    '/kodety/v1/sharing',
    [],
    ['permission' => 'view', 'authRequired' => false, 'enabled' => true, 'regenerate' => true]
))->get_data();
$agency_token = kodety_sharing_token_from_url((string) ($agency_state['url'] ?? ''));
$kodety_sharing_options['kodety_agency_active_project'] = 'project-beta';
$agency_request = new WP_REST_Request('GET', '/kodety/v1/project', ['X-Kodety-Share' => $agency_token]);
kodety_sharing_assert(
    $sharing->is_accessible($agency_request),
    'trocar o projeto aberto no modo agência não deve revogar o compartilhamento'
);
kodety_sharing_assert(
    $sharing->project_id($agency_request) === 'project-alpha',
    'compartilhamento deve continuar preso ao projeto que o criou'
);

// Editor access is one exact browser-session lease per project. There is no
// participant feed, queue, turn passing or configurable multi-editor limit.
$kodety_sharing_options['kodety_agency_active_project'] = 'project-beta';
$kodety_sharing_options['kodety_workspace_revision'] = 73;
$kodety_sharing_current_user = 42;
$kodety_sharing_options['kodety_editor_lock']['project-beta'] = [
    'stale-session:stale-lease' => [
        'sessionId' => 'stale-session',
        'leaseId' => 'stale-lease',
        'userId' => 42,
        'eligible' => true,
        'mode' => 'edit',
        'lastActive' => time() - 60,
    ],
];
$admin_import_without_editor = new WP_REST_Request(
    'POST',
    '/kodety/v1/project/chunk',
    ['X-Kodety-Admin-Import' => '1']
);
$admin_url_import_without_editor = new WP_REST_Request('POST', '/kodety/v1/import-url');
kodety_sharing_assert(
    !$sharing->has_active_editor_lock($admin_import_without_editor)
    && kodety_sharing_lock_boundary($sharing, $admin_import_without_editor) === null,
    'importação autenticada do painel deve prosseguir quando só existe lock expirado'
);
kodety_sharing_assert(
    !$sharing->has_active_editor_lock($admin_url_import_without_editor)
    && kodety_sharing_lock_boundary($sharing, $admin_url_import_without_editor) === null,
    'pré-captura da importação por URL deve prosseguir sem exigir headers do Builder'
);
$owner_lock = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_123456789012',
    ]
))->get_data();
$kodety_sharing_current_user = 43;
$second_lock = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_editor_234567890',
        'leaseId' => 'lease_editor_23456789012',
    ]
))->get_data();
kodety_sharing_assert(
    ($owner_lock['mode'] ?? '') === 'edit'
    && ($owner_lock['workspaceRevision'] ?? 0) === 73
    && ($second_lock['mode'] ?? '') === 'view'
    && !empty($second_lock['limited'])
    && ($second_lock['lock']['holderName'] ?? '') === 'Owner'
    && !array_key_exists('participants', $second_lock)
    && !array_key_exists('turn', $second_lock)
    && !array_key_exists('queue', $second_lock),
    'a segunda sessão deve ficar bloqueada sem feed, presença, fila ou turno'
);

// Mutation requires the exact authenticated account + session + lease. Knowing
// another tab's opaque pair must not let a different account replay its lock.
$owner_write_headers = [
    'X-Kodety-Editor-Session' => 'session_owner_1234567890',
    'X-Kodety-Editor-Lease' => 'lease_owner_123456789012',
];
$second_write_headers = [
    'X-Kodety-Editor-Session' => 'session_editor_234567890',
    'X-Kodety-Editor-Lease' => 'lease_editor_23456789012',
];
$wrong_lease_headers = [
    'X-Kodety-Editor-Session' => 'session_owner_1234567890',
    'X-Kodety-Editor-Lease' => 'lease_owner_wrong_12345678',
];
$kodety_sharing_current_user = 43;
$cross_account_replay = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_123456789012',
    ]
));
$owner_replay_blocked = !$sharing->has_editor_lock(
    new WP_REST_Request('POST', '/kodety/v1/project', $owner_write_headers)
);
$second_blocked = !$sharing->has_editor_lock(
    new WP_REST_Request('POST', '/kodety/v1/project', $second_write_headers)
);
$wrong_lease_blocked = !$sharing->has_editor_lock(
    new WP_REST_Request('POST', '/kodety/v1/project', $wrong_lease_headers)
);
$second_boundary_error = kodety_sharing_error_code(kodety_sharing_lock_boundary(
    $sharing,
    new WP_REST_Request('POST', '/kodety/v1/project', $second_write_headers)
));
$nonvisual_boundary = kodety_sharing_lock_boundary(
    $sharing,
    new WP_REST_Request('POST', '/kodety/v1/project')
);
$active_admin_import = kodety_sharing_lock_boundary(
    $sharing,
    new WP_REST_Request('POST', '/kodety/v1/project/chunk', ['X-Kodety-Admin-Import' => '1'])
);
$active_admin_url_import = kodety_sharing_lock_boundary(
    $sharing,
    new WP_REST_Request('POST', '/kodety/v1/import-url')
);
$kodety_sharing_current_user = 42;
$owner_can_write = $sharing->has_editor_lock(
    new WP_REST_Request('POST', '/kodety/v1/project', $owner_write_headers)
);
kodety_sharing_assert(
    $owner_can_write
    && $owner_replay_blocked
    && $second_blocked
    && $wrong_lease_blocked
    && kodety_sharing_error_code($cross_account_replay) === 'kodety_editor_lock_identity'
    && $second_boundary_error === 'kodety_editor_lock_required'
    && $nonvisual_boundary === null,
    'mutação visual deve exigir conta, sessão e lease exatas; outras superfícies usam sua autorização e revisão'
);
kodety_sharing_assert(
    $sharing->has_active_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project/chunk'))
    && $active_admin_import === null
    && $active_admin_url_import === null,
    'importações ZIP e URL do painel não devem depender da sessão visual'
);
$lock_before_admin_mutations = $kodety_sharing_options['kodety_editor_lock'];
foreach ($admin_workspace_mutations as [$admin_method, $admin_route]) {
    $admin_request = new WP_REST_Request($admin_method, $admin_route);
    kodety_sharing_assert(
        kodety_sharing_lock_boundary($sharing, $admin_request) === null,
        'wp-admin autorizado não deve disputar a sessão do Builder aberto: ' . $admin_method . ' ' . $admin_route
    );
    kodety_sharing_assert(
        kodety_sharing_lock_boundary($sharing, new WP_REST_Request($admin_method, $admin_route, $owner_write_headers)) === null,
        'o Builder com a lease válida deve continuar podendo usar a rota: ' . $admin_route
    );
    foreach ([
        $second_write_headers,
        $wrong_lease_headers,
        ['X-Kodety-Editor-Session' => $owner_write_headers['X-Kodety-Editor-Session']],
        ['X-Kodety-Editor-Lease' => $owner_write_headers['X-Kodety-Editor-Lease']],
    ] as $blocked_headers) {
        $blocked_request = new WP_REST_Request($admin_method, $admin_route, $blocked_headers);
        kodety_sharing_assert(
            kodety_sharing_error_code(kodety_sharing_lock_boundary($sharing, $blocked_request)) === 'kodety_editor_lock_required',
            'contexto do Builder inválido ou parcial continua bloqueado: ' . $admin_route
        );
    }
    $permission_error = new WP_Error('rest_forbidden', 'Sem permissão.', ['status' => 403]);
    kodety_sharing_assert(
        $sharing->enforce_editor_lock_before_dispatch($permission_error, $admin_request, $admin_route, []) === $permission_error,
        'dispensar lease no wp-admin não deve substituir erros de permissão: ' . $admin_route
    );
}
kodety_sharing_assert(
    $kodety_sharing_options['kodety_editor_lock'] === $lock_before_admin_mutations,
    'operações do wp-admin não devem adquirir, renovar ou liberar a sessão do Builder'
);
kodety_sharing_assert(
    kodety_sharing_lock_boundary(
        $sharing,
        new WP_REST_Request('POST', '/kodety/v1/forms/submit')
    ) === null
    && kodety_sharing_lock_boundary(
        $sharing,
        new WP_REST_Request('POST', '/kodety/v1/analytics/collect')
    ) === null
    && kodety_sharing_lock_boundary(
        $sharing,
        new WP_REST_Request('POST', '/kodety/v1/mcp/tool')
    ) === null
    && kodety_sharing_error_code(kodety_sharing_lock_boundary(
        $sharing,
        new WP_REST_Request('POST', '/wp/v2/media', $second_write_headers)
    )) === 'kodety_editor_lock_required',
    'lock deve cobrir o Builder sem bloquear forms, coleta pública ou MCP remoto'
);

// The browser fetch wrapper adds editor headers even in an Analytics-only
// account. A personal preference must save while the project belongs to a
// different editor, without weakening authentication or workspace locks.
$kodety_sharing_current_user = 43;
$kodety_sharing_capabilities = ['read', 'kodety_view_analytics'];
$onboarding_preferences = Kodety_Builder_Onboarding::instance();
$preference_headers = array_merge($second_write_headers, ['X-WP-Nonce' => 'valid-onboarding-nonce']);
$preference_request = new WP_REST_Request('POST', '/kodety/v1/onboarding/preference', $preference_headers, ['preference' => 'dismissed']);
$preference_lock_before = $kodety_sharing_options['kodety_editor_lock'];
kodety_sharing_assert(
    $sharing->has_active_editor_lock($preference_request)
    && !$sharing->has_editor_lock($preference_request)
    && !current_user_can('kodety_edit')
    && $onboarding_preferences->permission($preference_request) === true
    && $sharing->enforce_rest_boundary(null, [], $preference_request) === null
    && kodety_sharing_lock_boundary($sharing, $preference_request) === null,
    'preferência pessoal de Analytics deve dispensar lease mesmo com os headers do wrapper e outro editor ativo'
);
$saved_preference = $onboarding_preferences->rest_save_preference($preference_request);
kodety_sharing_assert(
    $saved_preference instanceof WP_REST_Response
    && $saved_preference->get_data() === ['userId' => 43, 'preference' => 'dismissed']
    && get_user_meta(43, '_kodety_builder_onboarding_preference', true) === 'dismissed'
    && get_user_meta(42, '_kodety_builder_onboarding_preference', true) === ''
    && $kodety_sharing_options['kodety_editor_lock'] === $preference_lock_before,
    'preferência deve salvar só a conta leitora sem trocar a lease nem alterar o proprietário'
);
foreach (['/kodety/v1/onboarding/preference/unrecognized', '/kodety/v1/onboarding/preferences', '/kodety/v1/project'] as $protected_route) {
    kodety_sharing_assert(
        kodety_sharing_error_code(kodety_sharing_lock_boundary($sharing, new WP_REST_Request('POST', $protected_route, $preference_headers))) === 'kodety_editor_lock_required',
        'exceção de onboarding deve corresponder somente à rota exata de preferência'
    );
}
$invalid_preference_request = new WP_REST_Request('POST', '/kodety/v1/onboarding/preference', $second_write_headers, ['preference' => 'started']);
$invalid_preference_permission = $onboarding_preferences->permission($invalid_preference_request);
kodety_sharing_assert(
    kodety_sharing_error_code($invalid_preference_permission) === 'rest_cookie_invalid_nonce'
    && $sharing->enforce_editor_lock_before_dispatch($invalid_preference_permission, $invalid_preference_request, $invalid_preference_request->get_route(), []) === $invalid_preference_permission,
    'dispensar lease não pode apagar erro de nonce emitido pela permission_callback'
);
kodety_sharing_assert(
    kodety_sharing_error_code($onboarding_preferences->rest_save_preference(new WP_REST_Request('POST', '/kodety/v1/onboarding/preference', $preference_headers, ['preference' => 'started', 'userId' => 42]))) === 'kodety_onboarding_user',
    'a exceção de lease não permite escolher outra conta'
);
$kodety_sharing_logged_in = false;
kodety_sharing_assert(
    kodety_sharing_error_code($onboarding_preferences->permission($preference_request)) === 'kodety_onboarding_unauthorized',
    'a exceção de lease continua exigindo uma sessão autenticada'
);
$kodety_sharing_logged_in = true;
unset($kodety_sharing_capabilities);

// DELETE revokes only the exact old lease. Its tombstone blocks an in-flight
// heartbeat from resurrecting it, but does not delay the next eligible editor.
$kodety_sharing_current_user = 42;
$sharing->release_lock(new WP_REST_Request(
    'DELETE',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_123456789012',
    ]
));
kodety_sharing_assert(
    !$sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_write_headers)),
    'DELETE deve revogar a escrita da lease exata imediatamente'
);
$kodety_sharing_current_user = 43;
$immediate_handoff = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_editor_234567890',
        'leaseId' => 'lease_editor_23456789012',
    ]
))->get_data();
$kodety_sharing_current_user = 42;
$sharing->release_lock(new WP_REST_Request(
    'DELETE',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_123456789012',
    ]
));
$kodety_sharing_current_user = 43;
kodety_sharing_assert(
    ($immediate_handoff['mode'] ?? '') === 'edit'
    && $sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $second_write_headers)),
    'o próximo heartbeat elegível deve assumir imediatamente e DELETE atrasado não pode removê-lo'
);
$sharing->release_lock(new WP_REST_Request(
    'DELETE',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_editor_234567890',
        'leaseId' => 'lease_editor_23456789012',
    ]
));
$kodety_sharing_current_user = 42;
$owner_remount = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_remount_1234567',
    ]
))->get_data();
$owner_remount_headers = [
    'X-Kodety-Editor-Session' => 'session_owner_1234567890',
    'X-Kodety-Editor-Lease' => 'lease_owner_remount_1234567',
];
kodety_sharing_assert(
    ($owner_remount['mode'] ?? '') === 'edit'
    && $sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_remount_headers))
    && !$sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_write_headers)),
    'um novo mount deve adquirir o lock livre sem restaurar a lease antiga'
);

// A replacement mount may POST before the discarded mount's asynchronous
// DELETE reaches WordPress. The same document/account must roll over
// atomically, while the old lease remains fenced by a bounded tombstone longer than the heartbeat timeout.
$owner_rollover = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_rollover_123456',
    ]
))->get_data();
$owner_rollover_headers = [
    'X-Kodety-Editor-Session' => 'session_owner_1234567890',
    'X-Kodety-Editor-Lease' => 'lease_owner_rollover_123456',
];
$owner_remount_key = 'session_owner_1234567890:lease_owner_remount_1234567';
$owner_remount_tombstone = $kodety_sharing_options['kodety_editor_lock']['project-beta'][$owner_remount_key] ?? null;
kodety_sharing_assert(
    ($owner_rollover['mode'] ?? '') === 'edit'
    && empty($owner_rollover['limited'])
    && is_array($owner_remount_tombstone)
    && !empty($owner_remount_tombstone['releasing'])
    && ($owner_remount_tombstone['mode'] ?? '') === 'view'
    && (int) ($owner_remount_tombstone['lastActive'] ?? 0) >= time() + 39
    && (int) ($owner_remount_tombstone['lastActive'] ?? 0) <= time() + 40
    && !$sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_remount_headers))
    && $sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_rollover_headers)),
    'POST da nova lease deve transferir o lock e manter a antiga como tombstone'
);

// A delayed cleanup from the discarded mount is scoped to its exact lease and
// must not release the replacement that already owns the editor lock.
$sharing->release_lock(new WP_REST_Request(
    'DELETE',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_remount_1234567',
    ]
));
kodety_sharing_assert(
    !$sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_remount_headers))
    && $sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_rollover_headers)),
    'DELETE atrasado da lease antiga não pode derrubar a lease substituta'
);

// A POST already in flight for the discarded lease must hit its tombstone,
// stay read-only and leave the replacement holder untouched.
$delayed_old_heartbeat = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'lease_owner_remount_1234567',
    ]
))->get_data();
kodety_sharing_assert(
    ($delayed_old_heartbeat['mode'] ?? '') === 'view'
    && !empty($delayed_old_heartbeat['limited'])
    && !$sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_remount_headers))
    && $sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_rollover_headers)),
    'POST atrasado da lease antiga não pode ressuscitá-la nem tomar o lock novo'
);

// Reusing the document identifier from another account does not authorize a
// rollover: both sessionId and userId must match the current holder.
$kodety_sharing_current_user = 43;
$foreign_same_session = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'session_owner_1234567890',
        'leaseId' => 'foreign_account_lease_12345',
    ]
))->get_data();
$kodety_sharing_current_user = 42;
kodety_sharing_assert(
    ($foreign_same_session['mode'] ?? '') === 'view'
    && !empty($foreign_same_session['limited'])
    && $sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $owner_rollover_headers)),
    'rollover exige a mesma sessão e a mesma conta do holder'
);

// Another tab/device from the very same WordPress account is still a distinct
// session and must remain read-only.
$same_account_second = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'same_account_device_5678',
        'leaseId' => 'same_account_lease_pc2_5678',
    ]
))->get_data();
$same_account_headers = [
    'X-Kodety-Editor-Session' => 'same_account_device_5678',
    'X-Kodety-Editor-Lease' => 'same_account_lease_pc2_5678',
];
kodety_sharing_assert(
    ($same_account_second['mode'] ?? '') === 'view'
    && !empty($same_account_second['limited'])
    && !$sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $same_account_headers)),
    'outra sessão da mesma conta deve ser bloqueada como qualquer outro editor'
);

// A crashed browser cannot send DELETE. After its TTL expires, the next
// eligible heartbeat claims the free lock directly; no waiting session is
// queued or promoted in the background.
foreach ($kodety_sharing_options['kodety_editor_lock']['project-beta'] as &$lock_record) {
    if (
        ($lock_record['sessionId'] ?? '') === 'session_owner_1234567890'
        && ($lock_record['leaseId'] ?? '') === 'lease_owner_rollover_123456'
    ) {
        $lock_record['lastActive'] = time() - 30;
    }
}
unset($lock_record);
$expired_holder_claim = $sharing->heartbeat(new WP_REST_Request(
    'POST',
    '/kodety/v1/editor-lock',
    [],
    [
        'sessionId' => 'same_account_device_5678',
        'leaseId' => 'same_account_lease_pc2_5678',
    ]
))->get_data();
$active_editors = array_filter(
    $kodety_sharing_options['kodety_editor_lock']['project-beta'] ?? [],
    static fn(mixed $record): bool => is_array($record) && ($record['mode'] ?? 'view') === 'edit'
);
kodety_sharing_assert(
    ($expired_holder_claim['mode'] ?? '') === 'edit'
    && count($active_editors) === 1
    && $sharing->has_editor_lock(new WP_REST_Request('POST', '/kodety/v1/project', $same_account_headers))
    && !$sharing->has_editor_lock(new WP_REST_Request(
        'POST',
        '/kodety/v1/project',
        ['X-Kodety-Collaboration-Session' => 'same_account_device_5678']
    )),
    'expiração deve permitir exatamente um novo lock e o header legado sem lease deve falhar fechado'
);

// A close arriving before the initial heartbeat must fence that identity too.
$sharing->release_lock(new WP_REST_Request('DELETE', '/kodety/v1/editor-lock', [], [
    'sessionId' => 'same_account_device_5678', 'leaseId' => 'same_account_lease_pc2_5678',
]));
$departed_identity = ['sessionId' => 'closed_before_post_123456', 'leaseId' => 'lease_before_post_12345678'];
$sharing->release_lock(new WP_REST_Request('DELETE', '/kodety/v1/editor-lock', [], $departed_identity));
foreach ($kodety_sharing_options['kodety_editor_lock']['project-beta'] as &$record) {
    if (($record['sessionId'] ?? '') === $departed_identity['sessionId']) $record['lastActive'] -= 10;
}
unset($record);
$delayed_initial = $sharing->heartbeat(new WP_REST_Request('POST', '/kodety/v1/editor-lock', [], $departed_identity))->get_data();
kodety_sharing_assert(($delayed_initial['mode'] ?? '') === 'view' && empty($delayed_initial['limited']),
    'DELETE antes do primeiro POST deve impedir um holder fantasma, inclusive após o timeout do cliente');
$new_holder = $sharing->heartbeat(new WP_REST_Request('POST', '/kodety/v1/editor-lock', [], [
    'sessionId' => 'new_after_closed_12345678', 'leaseId' => 'lease_after_closed_1234567',
]))->get_data();
kodety_sharing_assert(($new_holder['mode'] ?? '') === 'edit', 'a lease encerrada não pode bloquear um novo editor');
kodety_sharing_assert(abs(($new_holder['serverTime'] ?? 0) - time() * 1000) < 2000, 'o heartbeat deve incluir o horário do servidor');

echo "Project sharing security contracts passed.\n";
