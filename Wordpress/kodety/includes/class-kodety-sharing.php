<?php

defined('ABSPATH') || exit;

/**
 * Project-scoped, revocable Builder sharing.
 *
 * A share token is an authorization boundary of its own. It never grants
 * publishing/import/admin access and it is evaluated again for every REST
 * request, so read-only is not merely a disabled React control.
 */
final class Kodety_Sharing {
    private const OPTION = 'kodety_project_shares';
    private const LOCK_OPTION = 'kodety_editor_lock';
    private const TOKEN_PATTERN = '[A-Za-z0-9_-]{43}';
    private const LOCK_TTL = 20;
    private const LOCK_RELEASE_TOMBSTONE_TTL = 60;
    // The former multi-editor feed is disabled. Zero is its effective storage,
    // read and in-memory change bound; activation removes any legacy payload.
    private const FEED_MAX_BYTES = 0;
    private const FEED_MAX_CHANGES = 0;
    private static ?self $instance = null;
    /** @var array<string,mixed>|null|false */
    private mixed $cached_context = false;
    private string $cached_token = '';
    private string $cached_invitation_token = '';

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_filter('user_has_cap', [$this, 'grant_share_capabilities'], 20, 4);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_filter('rest_request_before_callbacks', [$this, 'enforce_rest_boundary'], 5, 3);
        add_filter('rest_dispatch_request', [$this, 'enforce_editor_lock_before_dispatch'], 5, 4);
    }

    public static function activate(): void {
        add_option(self::OPTION, [], '', false);
        add_option(self::LOCK_OPTION, [], '', false);
        // Collaboration presence, turns and the realtime feed are transient.
        // Remove their obsolete options when this exclusive-lock version is
        // activated so stale editors cannot survive an upgrade.
        delete_option('kodety_collaboration_presence');
        delete_option('kodety_collaboration_settings');
        delete_option('kodety_collaboration_feed');
    }

    public static function token_pattern(): string {
        return self::TOKEN_PATTERN;
    }

    public static function current_project_id(): string {
        if ((string) get_option('kodety_workspace_mode', 'single') !== 'agency') {
            return 'single';
        }
        $project_id = sanitize_key((string) get_option('kodety_agency_active_project', ''));
        return $project_id !== '' ? $project_id : 'single';
    }

    /**
     * Return the project permanently bound to the share token.
     *
     * In agency mode this must not be inferred from the project currently open
     * in the owner's Builder: changing that selection must never revoke an
     * otherwise valid link or make it expose another project's panels.
     */
    public function project_id(?WP_REST_Request $request = null): string {
        $context = $this->context($request);
        return $context ? (sanitize_key((string) ($context['projectId'] ?? '')) ?: 'single') : '';
    }

    private function project_exists(string $project_id): bool {
        if ((string) get_option('kodety_workspace_mode', 'single') !== 'agency') {
            return $project_id === 'single';
        }
        if ($project_id === '' || $project_id === 'single') return false;
        $projects = get_option('kodety_agency_projects', []);
        return is_array($projects) && isset($projects[$project_id]) && is_array($projects[$project_id]);
    }

    /** @return array<string,array<string,mixed>> */
    private function shares(): array {
        $shares = get_option(self::OPTION, []);
        return is_array($shares) ? $shares : [];
    }

    private function current_user_email(): string {
        if (!is_user_logged_in() || !function_exists('wp_get_current_user')) return '';
        $user = wp_get_current_user();
        return sanitize_email((string) ($user->user_email ?? ''));
    }

    private function is_protected_administrator(WP_User $user): bool {
        if (function_exists('is_super_admin') && is_super_admin((int) $user->ID)) return true;
        return in_array('administrator', (array) $user->roles, true);
    }

    /** @param array<string,array<string,mixed>> $shares */
    private function has_edit_invitation(string $email, array $shares): bool {
        foreach ($shares as $share) {
            if (!is_array($share)) continue;
            $invitations = is_array($share['invitations'] ?? null) ? $share['invitations'] : [];
            $invitation = $invitations[$email] ?? null;
            if (is_array($invitation) && ($invitation['permission'] ?? 'view') === 'edit') return true;
        }
        return false;
    }

    /**
     * Keep WordPress access aligned with the invitation source of truth.
     *
     * Edit invitations intentionally use the native Editor role so invitees
     * can enter the Builder, CMS and Pages from wp-admin without a share URL.
     * Once the last edit invitation disappears, the managed Editor role is
     * cleared completely. Site administrators and super-admins are never
     * changed by project sharing.
     *
     * @param array<string,array<string,mixed>> $shares
     */
    private function reconcile_invited_editor_access(string $email, array $shares): void {
        $email = strtolower(sanitize_email($email));
        if ($email === '') return;
        $user = get_user_by('email', $email);
        if (!$user instanceof WP_User || $this->is_protected_administrator($user)) return;

        if ($this->has_edit_invitation($email, $shares)) {
            if (!in_array('editor', (array) $user->roles, true)) $user->set_role('editor');
            return;
        }

        if (in_array('editor', (array) $user->roles, true)) $user->set_role('');
    }

    private function mark_invitation_accepted(string $project_id, string $email, int $user_id): void {
        if ($email === '' || $user_id <= 0) return;
        $shares = $this->shares();
        $invitation = $shares[$project_id]['invitations'][$email] ?? null;
        if (!is_array($invitation)) return;
        if (($invitation['permission'] ?? 'view') === 'edit') {
            $this->reconcile_invited_editor_access($email, $shares);
        }
        if (!empty($invitation['acceptedAt']) && (int) ($invitation['acceptedUserId'] ?? 0) === $user_id) return;
        $shares[$project_id]['invitations'][$email]['acceptedAt'] = current_time('c');
        $shares[$project_id]['invitations'][$email]['acceptedUserId'] = $user_id;
        update_option(self::OPTION, $shares, false);
    }

    private function token_from_request(?WP_REST_Request $request = null): string {
        $token = $request ? (string) $request->get_header('X-Kodety-Share') : '';
        // Theme preview checks capabilities during plugins_loaded, before
        // WordPress has constructed the main query used by get_query_var().
        if ($token === '' && ($GLOBALS['wp_query'] ?? null) instanceof WP_Query) {
            $token = (string) get_query_var('kodety_share');
        }
        if ($token === '' && isset($_GET['kodety_share_token'])) {
            $token = sanitize_text_field(wp_unslash($_GET['kodety_share_token']));
        }
        if ($token === '' && isset($_SERVER['HTTP_X_KODETY_SHARE'])) {
            $token = sanitize_text_field(wp_unslash($_SERVER['HTTP_X_KODETY_SHARE']));
        }
        return preg_match('/^' . self::TOKEN_PATTERN . '$/', $token) === 1 ? $token : '';
    }

    private function invitation_token_from_request(?WP_REST_Request $request = null): string {
        $token = $request ? (string) $request->get_header('X-Kodety-Invite') : '';
        if ($token === '' && $request) $token = (string) $request->get_param('invitationToken');
        if ($token === '' && isset($_GET['kodety_invite'])) {
            $token = sanitize_text_field(wp_unslash($_GET['kodety_invite']));
        }
        if ($token === '' && isset($_SERVER['HTTP_X_KODETY_INVITE'])) {
            $token = sanitize_text_field(wp_unslash($_SERVER['HTTP_X_KODETY_INVITE']));
        }
        return preg_match('/^' . self::TOKEN_PATTERN . '$/', $token) === 1 ? $token : '';
    }

    /** @return array<string,mixed>|null */
    public function context(?WP_REST_Request $request = null): ?array {
        $token = $this->token_from_request($request);
        if ($token === '') return null;
        $invitation_token = $this->invitation_token_from_request($request);

        // WordPress can evaluate user capabilities before parse_request has
        // populated kodety_share. Never cache that early "no token" result for
        // the rest of the page request. A cached lookup is reusable only when
        // it belongs to the exact token currently being evaluated.
        if (
            $request === null
            && $this->cached_context !== false
            && $this->cached_token !== ''
            && hash_equals($this->cached_token, $token)
            && hash_equals($this->cached_invitation_token, $invitation_token)
        ) {
            return is_array($this->cached_context) ? $this->cached_context : null;
        }

        $hash = hash('sha256', $token);
        foreach ($this->shares() as $project_id => $share) {
            if (
                !is_array($share)
                || empty($share['enabled'])
                || !is_string($share['tokenHash'] ?? null)
                || !hash_equals((string) $share['tokenHash'], $hash)
            ) {
                continue;
            }
            $permission = ($share['permission'] ?? 'view') === 'edit' ? 'edit' : 'view';
            $email = strtolower($this->current_user_email());
            $invitations = is_array($share['invitations'] ?? null) ? $share['invitations'] : [];
            $invitation = null;
            if ($invitation_token !== '') {
                $invitation_hash = hash('sha256', $invitation_token);
                foreach ($invitations as $candidate) {
                    if (
                        is_array($candidate)
                        && is_string($candidate['tokenHash'] ?? null)
                        && hash_equals((string) $candidate['tokenHash'], $invitation_hash)
                    ) {
                        $invitation = $candidate;
                        break;
                    }
                }
                // An individual invitation is revocable. Never fall back to
                // the general share permission when a supplied invitation
                // token has expired, was removed or was replaced.
                if (!$invitation) {
                    if ($request === null) {
                        $this->cached_token = $token;
                        $this->cached_invitation_token = $invitation_token;
                        $this->cached_context = null;
                    }
                    return null;
                }
            }
            $invited_email = strtolower(sanitize_email((string) ($invitation['email'] ?? '')));
            $email_invitation = $email !== '' && is_array($invitations[$email] ?? null)
                ? $invitations[$email]
                : null;
            if ($email_invitation) {
                $permission = ($email_invitation['permission'] ?? 'view') === 'edit' ? 'edit' : 'view';
                if (is_user_logged_in()) {
                    $this->mark_invitation_accepted((string) $project_id, $email, (int) get_current_user_id());
                }
            } elseif ($invitation) {
                // The invitation URL may be opened before a WordPress account
                // exists. Keep the project viewable while the invitee creates
                // a password, but never grant write access until the session
                // is authenticated with the exact invited email.
                $permission = 'view';
            }
            $auth_required = $invitation
                ? false
                : ($permission === 'edit' || !empty($share['authRequired']));
            $context = [
                'projectId' => sanitize_key((string) $project_id) ?: 'single',
                'permission' => $permission,
                'authRequired' => $auth_required,
                'authenticated' => is_user_logged_in(),
                'token' => $token,
                'enabled' => true,
                'invitation' => $invitation ? [
                    'email' => $invited_email,
                    'permission' => ($invitation['permission'] ?? 'view') === 'edit' ? 'edit' : 'view',
                    'token' => $invitation_token,
                    'accountExists' => $invited_email !== '' && (bool) get_user_by('email', $invited_email),
                    'accepted' => $email !== '' && $invited_email !== '' && hash_equals($invited_email, $email),
                ] : null,
            ];
            if ($request === null) {
                $this->cached_token = $token;
                $this->cached_invitation_token = $invitation_token;
                $this->cached_context = $context;
            }
            return $context;
        }
        if ($request === null) {
            $this->cached_token = $token;
            $this->cached_invitation_token = $invitation_token;
            $this->cached_context = null;
        }
        return null;
    }

    private function reset_context_cache(): void {
        $this->cached_token = '';
        $this->cached_invitation_token = '';
        $this->cached_context = false;
    }

    public function is_accessible(?WP_REST_Request $request = null): bool {
        $context = $this->context($request);
        if (!$context) return false;
        if (!empty($context['authRequired']) && !is_user_logged_in()) return false;
        return $this->project_exists((string) $context['projectId']);
    }

    public function can_edit(?WP_REST_Request $request = null): bool {
        $context = $this->context($request);
        return $context
            && $this->is_accessible($request)
            && ($context['permission'] ?? 'view') === 'edit'
            && is_user_logged_in();
    }

    public function authorize_rest(WP_REST_Request $request, string $access = 'view'): bool {
        if (!$this->is_accessible($request)) return false;
        if ($access === 'edit') return $this->can_edit($request);
        return $this->rest_request_is_read_only($request)
            || $this->can_edit($request);
    }

    private function rest_request_is_read_only(WP_REST_Request $request): bool {
        return class_exists('Kodety_Native_Operations')
            ? Kodety_Native_Operations::request_is_read_only($request)
            : in_array(strtoupper($request->get_method()), ['GET', 'HEAD', 'OPTIONS'], true);
    }

    /**
     * A logged-in administrator keeps their ordinary WordPress capabilities,
     * therefore capability filters alone cannot turn an administrator into a
     * viewer. Enforce the share contract before every REST callback whenever
     * the request carries a share token. Builder requests also carry their
     * editor session and lease, which lets this boundary reject mutations from
     * an authenticated user whose exact browser mount does not hold the lock.
     *
     * @param mixed $response
     * @param array<string,mixed> $handler
     * @return mixed
     */
    public function enforce_rest_boundary(mixed $response, array $handler, WP_REST_Request $request): mixed {
        if ($response !== null) return $response;
        $shared = $this->token_from_request($request) !== '';
        if ($shared && !$this->is_accessible($request)) {
            return new WP_Error(
                'kodety_share_forbidden',
                'Este compartilhamento não está disponível para esta sessão.',
                ['status' => 403]
            );
        }

        $route = $request->get_route();
        if ($shared && str_starts_with($route, '/kodety/v1/sharing')) {
            return new WP_Error(
                'kodety_share_management_forbidden',
                'O gerenciamento deste compartilhamento está disponível apenas para o proprietário.',
                ['status' => 403]
            );
        }

        // The editor-lock heartbeat coordinates the lock itself and must stay
        // reachable while the caller is in read-only mode.
        if (str_starts_with($route, '/kodety/v1/editor-lock')) return $response;

        // Accepting a private invitation is the one anonymous POST allowed on
        // a shared project. The callback independently validates both opaque
        // tokens before it creates a subscriber session.
        if ($route === '/kodety/v1/collaboration/invitation/accept') return $response;

        $method = strtoupper($request->get_method());
        $read = $this->rest_request_is_read_only($request);
        if ($shared && !$read && !$this->can_edit($request)) {
            return new WP_Error(
                'kodety_share_read_only',
                'Este compartilhamento é somente leitura.',
                ['status' => 403]
            );
        }

        if ($shared && !$read && str_starts_with($route, '/kodety/v1/')) {
            foreach ([
                '/kodety/v1/publish',
                '/kodety/v1/import',
                '/kodety/v1/sharing',
                '/kodety/v1/extensions',
                '/kodety/v1/optimizations',
                '/kodety/v1/security',
            ] as $blocked_prefix) {
                if (str_starts_with($route, $blocked_prefix)) {
                    return new WP_Error(
                        'kodety_share_operation_forbidden',
                        'Esta operação não está disponível em um compartilhamento.',
                        ['status' => 403]
                    );
                }
            }
        }

        return $response;
    }

    /**
     * Require the editor lease only after WordPress has accepted the route's
     * permission_callback. This preserves the canonical 401/403 and avoids
     * evaluating authorization predicates twice on requests that may proceed.
     *
     * @param mixed $dispatch_result
     * @param array<string,mixed> $handler
     * @return mixed
     */
    public function enforce_editor_lock_before_dispatch(
        mixed $dispatch_result,
        WP_REST_Request $request,
        string $matched_route,
        array $handler
    ): mixed {
        if ($dispatch_result !== null) return $dispatch_result;

        $route = $request->get_route();
        if (
            str_starts_with($route, '/kodety/v1/editor-lock')
            || $route === '/kodety/v1/collaboration/invitation/accept'
        ) {
            return $dispatch_result;
        }

        $read = $this->rest_request_is_read_only($request);
        $lock_exempt = str_starts_with($route, '/kodety/v1/sharing');
        // Tour choices belong to the authenticated account, including readers
        // whose Builder headers carry a lease held elsewhere. Its own route
        // still verifies the nonce and never accepts another account's ID.
        $lock_exempt = $lock_exempt || $route === '/kodety/v1/onboarding/preference';
        // The lease coordinates visual-editor mounts only. Settings, Languages,
        // CMS, Analytics and wp-admin also write project data without a visual
        // mount, so neither a route nor a share token implies an editor lease.
        // Removing both headers leaves the ordinary authorized API contract:
        // capabilities, share restrictions, revision checks and file locks.
        // A partial editor identity still fails the exact-lease check.
        if (
            !$read
            && !$lock_exempt
            && self::has_editor_context($request)
            && !$this->has_editor_lock($request, false)
        ) {
            return new WP_Error(
                'kodety_editor_lock_required',
                'Este projeto já está aberto para edição em outra sessão.',
                ['status' => 423]
            );
        }
        return $dispatch_result;
    }

    /**
     * Existing permission callbacks continue to be the single route map. This
     * filter only supplies product capabilities while a valid share token is
     * present and deliberately never grants WordPress administration/publish.
     *
     * @param array<string,bool> $allcaps
     * @param array<int,string> $caps
     * @param array<int,mixed> $args
     * @param WP_User $user
     * @return array<string,bool>
     */
    public function grant_share_capabilities(array $allcaps, array $caps, array $args, WP_User $user): array {
        $context = $this->context();
        if (!$context || !$this->is_accessible()) return $allcaps;

        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $write = !in_array($method, ['GET', 'HEAD', 'OPTIONS'], true);
        if ($write && class_exists('Kodety_Native_Operations')
            && Kodety_Native_Operations::is_dispatching_read_only()) $write = false;
        $editable = ($context['permission'] ?? 'view') === 'edit' && is_user_logged_in();
        if ($write && !$editable) return $allcaps;

        foreach ([
            Kodety_Plugin::CAP_EDIT_WORKSPACE,
            Kodety_Plugin::CAP_ACCESS_CMS,
            Kodety_Plugin::CAP_VIEW_ANALYTICS,
            'kodety_view_members',
            'read',
        ] as $capability) {
            $allcaps[$capability] = true;
        }
        if ($editable) {
            foreach ([
                Kodety_Plugin::CAP_MANAGE_CMS_SCHEMA,
                Kodety_Plugin::CAP_MANAGE_CMS_TEMPLATES,
                Kodety_Plugin::CAP_MANAGE_ANALYTICS,
                'kodety_manage_members',
                'kodety_assign_membership',
                'kodety_manage_commerce',
                'edit_posts',
                'edit_pages',
                'edit_others_posts',
                'edit_others_pages',
                'edit_published_posts',
                'edit_published_pages',
                'publish_posts',
                'publish_pages',
                'upload_files',
            ] as $capability) {
                $allcaps[$capability] = true;
            }
        }
        return $allcaps;
    }

    public function share_url(string $token, string $app = 'editor'): string {
        $app = in_array($app, ['editor', 'cms', 'settings', 'localization', 'analytics', 'members'], true)
            ? $app
            : 'editor';
        return home_url('/kodety/share/' . rawurlencode($token) . '/' . $app . '/');
    }

    public function invitation_url(string $share_token, string $invitation_token, string $app = 'editor'): string {
        return add_query_arg('kodety_invite', $invitation_token, $this->share_url($share_token, $app));
    }

    public function register_rest_routes(): void {
        register_rest_route('kodety/v1', '/sharing', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_share'],
                'permission_callback' => static fn(): bool => current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE),
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'save_share'],
                'permission_callback' => static fn(): bool => current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE),
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete_share'],
                'permission_callback' => static fn(): bool => current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE),
            ],
        ]);
        register_rest_route('kodety/v1', '/sharing/invitations', [
            [
                'methods' => 'POST',
                'callback' => [$this, 'invite_collaborator'],
                'permission_callback' => static fn(): bool => current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE),
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'remove_invitation'],
                'permission_callback' => static fn(): bool => current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE),
            ],
        ]);
        register_rest_route('kodety/v1', '/editor-lock', [
            [
                'methods' => 'POST',
                'callback' => [$this, 'heartbeat'],
                'permission_callback' => [$this, 'can_access_editor_lock'],
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'release_lock'],
                'permission_callback' => [$this, 'can_access_editor_lock'],
            ],
        ]);
        register_rest_route('kodety/v1', '/collaboration/invitation/accept', [
            'methods' => 'POST',
            'callback' => [$this, 'accept_invitation'],
            'permission_callback' => '__return_true',
        ]);
    }

    /** @param array<string,mixed>|null $share */
    private function public_share(?array $share): array {
        if (!$share) {
            return [
                'enabled' => false,
                'permission' => 'view',
                'authRequired' => false,
                'url' => '',
                'invitations' => [],
            ];
        }
        $token = is_string($share['token'] ?? null) ? (string) $share['token'] : '';
        return [
            'enabled' => !empty($share['enabled']),
            'permission' => ($share['permission'] ?? 'view') === 'edit' ? 'edit' : 'view',
            'authRequired' => ($share['permission'] ?? 'view') === 'edit' || !empty($share['authRequired']),
            'url' => $token !== '' ? $this->share_url($token) : '',
            'updatedAt' => (string) ($share['updatedAt'] ?? ''),
            'invitations' => array_values(array_map(
                static fn(array $invitation): array => [
                    'email' => (string) ($invitation['email'] ?? ''),
                    'permission' => ($invitation['permission'] ?? 'view') === 'edit' ? 'edit' : 'view',
                    'invitedAt' => (string) ($invitation['invitedAt'] ?? ''),
                    'accepted' => !empty($invitation['acceptedAt']) || !empty($invitation['acceptedUserId']),
                    'acceptedAt' => (string) ($invitation['acceptedAt'] ?? ''),
                ],
                array_filter(
                    is_array($share['invitations'] ?? null) ? $share['invitations'] : [],
                    'is_array'
                )
            )),
        ];
    }

    public function get_share(): WP_REST_Response {
        $shares = $this->shares();
        $share = $shares[self::current_project_id()] ?? null;
        return new WP_REST_Response($this->public_share(is_array($share) ? $share : null));
    }

    public function save_share(WP_REST_Request $request): WP_REST_Response {
        $project_id = self::current_project_id();
        $shares = $this->shares();
        $previous = is_array($shares[$project_id] ?? null) ? $shares[$project_id] : [];
        $permission = sanitize_key((string) $request->get_param('permission')) === 'edit' ? 'edit' : 'view';
        $regenerate = rest_sanitize_boolean($request->get_param('regenerate'));
        $token = !$regenerate && is_string($previous['token'] ?? null)
            ? (string) $previous['token']
            : rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $enabled = !array_key_exists('enabled', (array) $request->get_json_params())
            || rest_sanitize_boolean($request->get_param('enabled'));
        $share = [
            'enabled' => $enabled,
            'permission' => $permission,
            'authRequired' => $permission === 'edit'
                || rest_sanitize_boolean($request->get_param('authRequired')),
            'token' => $token,
            'tokenHash' => hash('sha256', $token),
            'createdBy' => absint($previous['createdBy'] ?? get_current_user_id()),
            'createdAt' => (string) ($previous['createdAt'] ?? current_time('c')),
            'updatedAt' => current_time('c'),
            'invitations' => is_array($previous['invitations'] ?? null) ? $previous['invitations'] : [],
        ];
        $shares[$project_id] = $share;
        update_option(self::OPTION, $shares, false);
        $this->reset_context_cache();
        return new WP_REST_Response($this->public_share($share));
    }

    public function delete_share(): WP_REST_Response {
        $shares = $this->shares();
        $project_id = self::current_project_id();
        $share = is_array($shares[$project_id] ?? null) ? $shares[$project_id] : [];
        $invitations = is_array($share['invitations'] ?? null) ? $share['invitations'] : [];
        unset($shares[$project_id]);
        update_option(self::OPTION, $shares, false);
        foreach ($invitations as $email => $invitation) {
            if (is_array($invitation) && ($invitation['permission'] ?? 'view') === 'edit') {
                $this->reconcile_invited_editor_access((string) $email, $shares);
            }
        }
        $this->reset_context_cache();
        return new WP_REST_Response($this->public_share(null));
    }

    public function can_access_editor_lock(WP_REST_Request $request): bool {
        if (current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)) return true;
        return $this->authorize_rest($request, 'view');
    }

    public static function has_editor_context(WP_REST_Request $request): bool {
        // Core returns null for an absent header; normalize it before testing.
        return trim((string) $request->get_header('x-kodety-editor-session')) !== ''
            || trim((string) $request->get_header('x-kodety-editor-lease')) !== '';
    }

    public function has_editor_lock(WP_REST_Request $request, bool $allow_missing = false): bool {
        $session_id = sanitize_text_field((string) $request->get_header('x-kodety-editor-session'));
        if ($session_id === '') return $allow_missing;
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $session_id)) return false;

        $lease_id = sanitize_text_field((string) $request->get_header('x-kodety-editor-lease'));
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $lease_id)) return false;

        $records = $this->active_locks($this->lock_project_id($request));
        $record_key = $this->exact_lock_key($records, $session_id, $lease_id);
        $record = $record_key !== '' ? ($records[$record_key] ?? null) : null;
        $user_id = get_current_user_id();
        return is_array($record)
            && $user_id > 0
            && (int) ($record['userId'] ?? 0) === $user_id
            && !empty($record['eligible'])
            && empty($record['releasing'])
            && ($record['mode'] ?? 'view') === 'edit';
    }

    /** Report current visual-editor occupancy without granting or renewing it. */
    public function has_active_editor_lock(?WP_REST_Request $request = null): bool {
        $project_id = $request ? $this->lock_project_id($request) : self::current_project_id();
        return $this->editing_lock_holder($this->active_locks($project_id)) !== '';
    }

    private function lock_project_id(WP_REST_Request $request): string {
        $shared = $this->project_id($request);
        return $shared !== '' ? $shared : self::current_project_id();
    }

    /** @return array<string,array<string,mixed>> */
    private function active_locks(string $project_id): array {
        wp_cache_delete(self::LOCK_OPTION, 'options');
        $all = get_option(self::LOCK_OPTION, []);
        $records = is_array($all) && is_array($all[$project_id] ?? null) ? $all[$project_id] : [];
        $cutoff = time() - self::LOCK_TTL;
        return array_filter(
            $records,
            static fn(mixed $record): bool => is_array($record) && (int) ($record['lastActive'] ?? 0) >= $cutoff
        );
    }

    /** @param array<string,mixed> $record */
    private function record_can_edit(array $record): bool {
        return !empty($record['eligible']) && (int) ($record['userId'] ?? 0) > 0;
    }

    private function lock_record_key(string $session_id, string $lease_id): string {
        return $session_id . ':' . $lease_id;
    }

    /** @param array<string,array<string,mixed>> $records */
    private function exact_lock_key(array $records, string $session_id, string $lease_id): string {
        $key = $this->lock_record_key($session_id, $lease_id);
        $record = $records[$key] ?? null;
        if (
            is_array($record)
            && hash_equals($session_id, (string) ($record['sessionId'] ?? ''))
            && hash_equals($lease_id, (string) ($record['leaseId'] ?? ''))
        ) {
            return $key;
        }
        foreach ($records as $candidate_key => $candidate) {
            if (
                is_array($candidate)
                && hash_equals($session_id, (string) ($candidate['sessionId'] ?? ''))
                && hash_equals($lease_id, (string) ($candidate['leaseId'] ?? ''))
            ) {
                return (string) $candidate_key;
            }
        }
        return '';
    }

    /** @param array<string,array<string,mixed>> $records */
    private function editing_lock_holder(array $records): string {
        $holders = [];
        foreach ($records as $record_key => $record) {
            if (
                !is_array($record)
                || !empty($record['releasing'])
                || ($record['mode'] ?? 'view') !== 'edit'
                || !$this->record_can_edit($record)
            ) {
                continue;
            }
            $holders[(string) $record_key] = max(
                1,
                (int) ($record['lockGrantedAt'] ?? $record['lastActive'] ?? 1)
            );
        }
        if (!$holders) return '';
        asort($holders, SORT_NUMERIC);
        return (string) array_key_first($holders);
    }

    /**
     * Normalize the records to exactly one editing lease. Only the current
     * heartbeat may claim a free lock.
     *
     * @param array<string,array<string,mixed>> $records
     * @return array<string,array<string,mixed>>
     */
    private function reconcile_editor_lock(array $records, string $automatic_candidate = ''): array {
        $previous_holder = $this->editing_lock_holder($records);
        $holder = $previous_holder;
        if ($holder === '' || !isset($records[$holder]) || !$this->record_can_edit($records[$holder])) {
            $holder = '';
        }
        if (
            $holder === ''
            && $automatic_candidate !== ''
            && isset($records[$automatic_candidate])
            && $this->record_can_edit($records[$automatic_candidate])
        ) {
            $holder = $automatic_candidate;
        }

        $now = time();
        foreach ($records as $record_key => $record) {
            if (!is_array($record)) continue;
            $editing = $holder !== '' && hash_equals($holder, (string) $record_key) && $this->record_can_edit($record);
            $record['mode'] = $editing ? 'edit' : 'view';
            if ($editing) {
                $record['lockGrantedAt'] = $previous_holder === $holder
                    ? max(1, (int) ($record['lockGrantedAt'] ?? $now))
                    : $now;
            } else {
                unset($record['lockGrantedAt']);
            }
            $records[$record_key] = $record;
        }
        return $records;
    }

    /**
     * @param array<string,mixed> $record
     * @return array<string,mixed>
     */
    private function editor_lock_tombstone(array $record): array {
        $record['releasing'] = true;
        $record['mode'] = 'view';
        unset($record['lockGrantedAt']);
        $record['lastActive'] = time() - self::LOCK_TTL + self::LOCK_RELEASE_TOMBSTONE_TTL;
        return $record;
    }

    /** @param array<string,array<string,mixed>> $records */
    private function save_locks(string $project_id, array $records): void {
        $all = get_option(self::LOCK_OPTION, []);
        if (!is_array($all)) $all = [];
        if ($records) $all[$project_id] = $records;
        else unset($all[$project_id]);
        update_option(self::LOCK_OPTION, $all, false);
    }

    /** @param array<string,array<string,mixed>> $records */
    private function lock_response(array $records, string $session_id, string $lease_id): WP_REST_Response {
        $self_key = $this->exact_lock_key($records, $session_id, $lease_id);
        $self = $self_key !== '' && is_array($records[$self_key] ?? null) ? $records[$self_key] : [];
        $mode = ($self['mode'] ?? 'view') === 'edit' && empty($self['releasing']) ? 'edit' : 'view';
        $holder_key = $this->editing_lock_holder($records);
        $holder = $holder_key !== '' && is_array($records[$holder_key] ?? null) ? $records[$holder_key] : [];
        $limited = !empty($self['eligible']) && $mode !== 'edit' && $holder_key !== '';
        $response = new WP_REST_Response([
            'sessionId' => $session_id,
            'leaseId' => $lease_id,
            'mode' => $mode,
            'limited' => $limited,
            'serverTime' => time() * 1000,
            'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0),
            'lock' => [
                'holderName' => (string) ($holder['name'] ?? ''),
                'expiresAt' => $holder_key !== ''
                    ? ((int) ($holder['lastActive'] ?? 0) + self::LOCK_TTL) * 1000
                    : 0,
            ],
        ]);
        if (method_exists($response, 'header')) $response->header('Cache-Control', 'no-store');
        return $response;
    }

    private function requested_lock_mode(WP_REST_Request $request): string {
        $context = $this->context($request);
        if ($context) return $this->can_edit($request) ? 'edit' : 'view';
        return current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE) ? 'edit' : 'view';
    }

    public function heartbeat(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $session_id = sanitize_text_field((string) $request->get_param('sessionId'));
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $session_id)) {
            return new WP_Error('kodety_editor_session', 'A sessão do editor é inválida.', ['status' => 400]);
        }
        $lease_id = sanitize_text_field((string) $request->get_param('leaseId'));
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $lease_id)) {
            return new WP_Error('kodety_editor_lease', 'A lease do editor é inválida.', ['status' => 400]);
        }
        $project_id = $this->lock_project_id($request);
        return $this->with_editor_lock_mutex($project_id, function () use ($request, $session_id, $lease_id, $project_id): WP_REST_Response|WP_Error {
            $records = $this->active_locks($project_id);
            $record_key = $this->lock_record_key($session_id, $lease_id);
            $user_id = get_current_user_id();
            $eligible = $this->requested_lock_mode($request) === 'edit';

            $user = $user_id > 0 && function_exists('wp_get_current_user') ? wp_get_current_user() : null;
            $previous = is_array($records[$record_key] ?? null) ? $records[$record_key] : [];
            // A heartbeat already in flight for a released or superseded lease
            // must hit its short tombstone instead of resurrecting that mount.
            if (!empty($previous['releasing'])) {
                return $this->lock_response($records, $session_id, $lease_id);
            }
            if ($previous && (int) ($previous['userId'] ?? 0) !== $user_id) {
                return new WP_Error(
                    'kodety_editor_lock_identity',
                    'Esta sessão do editor pertence a outra conta.',
                    ['status' => 403]
                );
            }

            // A remount creates a fresh lease inside the same browser document.
            // Atomically supersede only leases owned by that exact session and
            // account. Keep each old lease as a short tombstone: an in-flight
            // POST or DELETE for it must not resurrect or revoke the replacement.
            if (!$previous) {
                foreach ($records as $old_key => $old_record) {
                    if (
                        !is_array($old_record)
                        || !hash_equals($session_id, (string) ($old_record['sessionId'] ?? ''))
                        || hash_equals($lease_id, (string) ($old_record['leaseId'] ?? ''))
                        || (int) ($old_record['userId'] ?? 0) !== $user_id
                        || !empty($old_record['releasing'])
                    ) {
                        continue;
                    }
                    $records[$old_key] = $this->editor_lock_tombstone($old_record);
                }
            }

            $records[$record_key] = array_merge($previous, [
                'sessionId' => $session_id,
                'leaseId' => $lease_id,
                'userId' => $user_id,
                'eligible' => $eligible,
                'mode' => ($previous['mode'] ?? 'view') === 'edit' ? 'edit' : 'view',
                'name' => $user ? (string) ($user->display_name ?: $user->user_login ?: 'Usuário') : 'Visitante',
                'joinedAt' => max(1, (int) ($previous['joinedAt'] ?? time())),
                'lastActive' => time(),
            ]);
            unset($records[$record_key]['releasing']);

            $holder = $this->editing_lock_holder($records);
            $candidate = $eligible && $holder === '' ? $record_key : '';
            $records = $this->reconcile_editor_lock($records, $candidate);
            $this->save_locks($project_id, $records);
            return $this->lock_response($records, $session_id, $lease_id);
        });
    }

    public function release_lock(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $session_id = sanitize_text_field((string) $request->get_param('sessionId'));
        $lease_id = sanitize_text_field((string) $request->get_param('leaseId'));
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $session_id)) {
            return new WP_Error('kodety_editor_session', 'A sessão do editor é inválida.', ['status' => 400]);
        }
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/D', $lease_id)) {
            return new WP_Error('kodety_editor_lease', 'A lease do editor é inválida.', ['status' => 400]);
        }
        $project_id = $this->lock_project_id($request);
        $user_id = get_current_user_id();
        return $this->with_editor_lock_mutex($project_id, function () use ($project_id, $session_id, $lease_id, $user_id): WP_REST_Response|WP_Error {
            $records = $this->active_locks($project_id);
            $record_key = $this->exact_lock_key($records, $session_id, $lease_id);
            $record = $record_key !== '' ? ($records[$record_key] ?? null) : null;
            // DELETE can arrive before the first POST finishes on another PHP
            // worker. Remember that exact identity even when it is not present
            // yet, so the delayed heartbeat cannot create a phantom holder.
            if (!is_array($record)) {
                $record_key = $this->lock_record_key($session_id, $lease_id);
                $record = ['sessionId' => $session_id, 'leaseId' => $lease_id, 'userId' => $user_id, 'eligible' => false];
            }
            if (is_array($record)) {
                if ((int) ($record['userId'] ?? 0) !== $user_id) {
                    return new WP_Error(
                        'kodety_editor_lock_identity',
                        'Esta sessão do editor pertence a outra conta.',
                        ['status' => 403]
                    );
                }
                // Keep only a short tombstone so a heartbeat already in flight
                // cannot resurrect this lease. It is not an editing holder, so
                // the next eligible heartbeat can acquire immediately.
                $records[$record_key] = $this->editor_lock_tombstone($record);
                $records = $this->reconcile_editor_lock($records);
                $this->save_locks($project_id, $records);
            }
            return $this->lock_response($records, $session_id, $lease_id);
        });
    }

    private function with_editor_lock_mutex(string $project_id, callable $operation): mixed {
        $lock = 'kodety_editor_lock_mutex_' . substr(hash('sha256', $project_id), 0, 20);
        $acquired = false;
        for ($attempt = 0; $attempt < 12; $attempt++) {
            $locked_at = (int) get_option($lock, 0);
            if ($locked_at > 0 && $locked_at < time() - 5) delete_option($lock);
            if (add_option($lock, time(), '', false)) {
                $acquired = true;
                break;
            }
            usleep(10000);
        }
        if (!$acquired) {
            return new WP_Error('kodety_editor_lock_busy', 'O lock do editor está ocupado; tente novamente.', ['status' => 503]);
        }
        try {
            return $operation();
        } finally {
            delete_option($lock);
        }
    }

    public function invite_collaborator(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $email = strtolower(sanitize_email((string) $request->get_param('email')));
        if ($email === '' || !is_email($email)) {
            return new WP_Error('kodety_invitation_email', 'Informe um email válido.', ['status' => 400]);
        }
        $permission = sanitize_key((string) $request->get_param('permission')) === 'edit' ? 'edit' : 'view';
        $project_id = self::current_project_id();
        $shares = $this->shares();
        $share = is_array($shares[$project_id] ?? null) ? $shares[$project_id] : [];
        if (!is_string($share['token'] ?? null) || (string) $share['token'] === '') {
            $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
            $share = [
                'enabled' => true,
                'permission' => 'view',
                'authRequired' => false,
                'token' => $token,
                'tokenHash' => hash('sha256', $token),
                'createdBy' => get_current_user_id(),
                'createdAt' => current_time('c'),
            ];
        }
        $invitations = is_array($share['invitations'] ?? null) ? $share['invitations'] : [];
        $previous_invitation = is_array($invitations[$email] ?? null) ? $invitations[$email] : null;
        $invitation_token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $invitations[$email] = [
            'email' => $email,
            'permission' => $permission,
            'tokenHash' => hash('sha256', $invitation_token),
            'invitedBy' => get_current_user_id(),
            'invitedAt' => current_time('c'),
        ];
        $share['enabled'] = true;
        $share['invitations'] = $invitations;
        $share['updatedAt'] = current_time('c');
        $shares[$project_id] = $share;
        update_option(self::OPTION, $shares, false);
        if ($permission === 'edit' || ($previous_invitation['permission'] ?? 'view') === 'edit') {
            $this->reconcile_invited_editor_access($email, $shares);
        }
        $this->reset_context_cache();

        $url = $this->invitation_url((string) $share['token'], $invitation_token);
        $i18n = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
        $translate = static fn(string $source): string => $i18n ? $i18n->translate($source) : $source;
        $subject_template = $translate('Convite para colaborar em %s');
        $body_template = $translate("Você recebeu acesso de %s ao projeto no Onun Kodety.\n\nAbrir projeto: %s%s");
        $permission_label = $translate($permission === 'edit' ? 'edição' : 'visualização');
        $invitation_help = $permission === 'edit'
            ? "\n\n" . $translate('Abra este link privado. Se for seu primeiro acesso, você poderá criar uma senha e começar a editar.')
            : '';
        $sent = function_exists('wp_mail') ? wp_mail(
            $email,
            sprintf($subject_template, wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES)),
            sprintf(
                $body_template,
                $permission_label,
                $url,
                $invitation_help
            )
        ) : true;
        return new WP_REST_Response([
            'sent' => (bool) $sent,
            'share' => $this->public_share($share),
        ]);
    }

    public function accept_invitation(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $context = $this->context($request);
        $invitation = is_array($context['invitation'] ?? null) ? $context['invitation'] : null;
        if (
            !$context
            || !$invitation
            || ($invitation['permission'] ?? 'view') !== 'edit'
            || (string) ($invitation['token'] ?? '') === ''
        ) {
            return new WP_Error(
                'kodety_invitation_invalid',
                'Este convite de edição é inválido, expirou ou foi substituído.',
                ['status' => 403]
            );
        }

        $email = strtolower(sanitize_email((string) ($invitation['email'] ?? '')));
        $redirect = $this->invitation_url(
            (string) ($context['token'] ?? ''),
            (string) ($invitation['token'] ?? '')
        );
        $existing = $email !== '' ? get_user_by('email', $email) : false;
        if ($existing instanceof WP_User) {
            if (is_user_logged_in() && (int) get_current_user_id() === (int) $existing->ID) {
                $this->mark_invitation_accepted((string) ($context['projectId'] ?? 'single'), $email, (int) $existing->ID);
                $this->reset_context_cache();
                return new WP_REST_Response(['success' => true, 'mode' => 'edit', 'reloadUrl' => $redirect]);
            }
            return new WP_Error(
                'kodety_invitation_account_exists',
                'Este email já tem uma conta. Entre com sua senha para editar.',
                [
                    'status' => 409,
                    'loginUrl' => wp_login_url($redirect),
                    'lostPasswordUrl' => wp_lostpassword_url($redirect),
                ]
            );
        }

        if (is_user_logged_in()) {
            return new WP_Error(
                'kodety_invitation_wrong_account',
                'Saia da conta atual para aceitar o convite enviado a outro email.',
                ['status' => 409]
            );
        }

        $password = (string) $request->get_param('password');
        if (strlen($password) < 8) {
            return new WP_Error(
                'kodety_invitation_password',
                'Crie uma senha com pelo menos 8 caracteres.',
                ['status' => 400]
            );
        }
        $display_name = sanitize_text_field((string) $request->get_param('displayName'));
        if ($display_name === '') $display_name = (string) strstr($email, '@', true);
        $base = sanitize_user((string) strstr($email, '@', true), true);
        if ($base === '') $base = 'kodety-user';
        $username = substr($base, 0, 54);
        for ($suffix = 2; username_exists($username); $suffix++) {
            $tail = '-' . $suffix;
            $username = substr($base, 0, 60 - strlen($tail)) . $tail;
        }
        $user_id = wp_insert_user([
            'user_login' => $username,
            'user_pass' => $password,
            'user_email' => $email,
            'display_name' => $display_name,
            'role' => 'editor',
        ]);
        if (is_wp_error($user_id)) {
            return new WP_Error(
                'kodety_invitation_account',
                'Não foi possível criar a conta deste convite. Tente novamente.',
                ['status' => 500]
            );
        }

        $project_id = sanitize_key((string) ($context['projectId'] ?? '')) ?: 'single';
        $this->mark_invitation_accepted($project_id, $email, (int) $user_id);

        wp_set_current_user((int) $user_id);
        wp_set_auth_cookie((int) $user_id, true, is_ssl());
        $user = get_user_by('id', (int) $user_id);
        if ($user instanceof WP_User) do_action('wp_login', $user->user_login, $user);
        $this->reset_context_cache();

        return new WP_REST_Response([
            'success' => true,
            'mode' => 'edit',
            'reloadUrl' => $redirect,
        ]);
    }

    public function remove_invitation(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $email = strtolower(sanitize_email((string) $request->get_param('email')));
        if ($email === '') return new WP_Error('kodety_invitation_email', 'Informe o email do convite.', ['status' => 400]);
        $project_id = self::current_project_id();
        $shares = $this->shares();
        $share = is_array($shares[$project_id] ?? null) ? $shares[$project_id] : [];
        $invitations = is_array($share['invitations'] ?? null) ? $share['invitations'] : [];
        $removed_invitation = is_array($invitations[$email] ?? null) ? $invitations[$email] : null;
        unset($invitations[$email]);
        $share['invitations'] = $invitations;
        $share['updatedAt'] = current_time('c');
        $shares[$project_id] = $share;
        update_option(self::OPTION, $shares, false);
        if (($removed_invitation['permission'] ?? 'view') === 'edit') {
            $this->reconcile_invited_editor_access($email, $shares);
        }
        $this->reset_context_cache();
        return new WP_REST_Response($this->public_share($share));
    }
}
