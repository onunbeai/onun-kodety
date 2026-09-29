<?php

defined('ABSPATH') || exit;

/** Personal Builder tour choices, independent of the current project. */
final class Kodety_Builder_Onboarding {
    private const META_KEY = '_kodety_builder_onboarding_preference';
    private const PREFERENCES = ['dismissed', 'started', 'completed', 'offered'];
    private const PREFERENCE_PRIORITY = ['unseen' => 0, 'offered' => 1, 'started' => 2, 'completed' => 3, 'dismissed' => 4];
    private static ?self $instance = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_rest_routes']);
    }

    public function register_rest_routes(): void {
        register_rest_route('kodety/v1', '/onboarding/preference', [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [$this, 'rest_preference'],
                'permission_callback' => [$this, 'permission'],
            ],
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [$this, 'rest_save_preference'],
                'permission_callback' => [$this, 'permission'],
                'args' => [
                    'preference' => [
                        'type' => 'string',
                        'required' => true,
                        'enum' => self::PREFERENCES,
                    ],
                ],
            ],
        ]);
    }

    private function can_access(?WP_REST_Request $request = null): bool {
        if (!is_user_logged_in() || get_current_user_id() <= 0) return false;
        // Share tokens can grant temporary product capabilities. A guest's
        // project access must never authorize a personal account preference.
        if (class_exists('Kodety_Sharing') && Kodety_Sharing::instance()->context($request)) return false;
        foreach (['kodety_edit', 'kodety_access_cms', 'kodety_view_analytics', 'kodety_view_members', 'manage_options'] as $capability) {
            if (current_user_can($capability)) return true;
        }
        return false;
    }

    public function permission(WP_REST_Request $request): bool|WP_Error {
        if (!is_user_logged_in() || get_current_user_id() <= 0) {
            return new WP_Error('kodety_onboarding_unauthorized', 'Autenticação necessária.', ['status' => 401]);
        }
        if (!$this->can_access($request)) {
            return new WP_Error('kodety_onboarding_forbidden', 'Sem permissão para acessar o onboarding.', ['status' => 403]);
        }
        $nonce = trim((string) $request->get_header('X-WP-Nonce'));
        if ($nonce === '') $nonce = trim((string) $request->get_param('_wpnonce'));
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error('rest_cookie_invalid_nonce', 'A sessão expirou. Atualize a página.', ['status' => 403]);
        }
        // This endpoint is deliberately /me-only, including for admins.
        foreach (['userId', 'user_id', 'id'] as $key) {
            if ($request->get_param($key) !== null) {
                return new WP_Error('kodety_onboarding_user', 'A preferência pertence à sessão atual.', ['status' => 400]);
            }
        }
        return true;
    }

    private function preference(): string {
        $preference = 'unseen';
        // WordPress usermeta has no unique index for a user's key. Two first
        // writes can both pass add_user_meta's uniqueness check, so resolve
        // every row and never let insertion order hide an explicit refusal.
        $values = get_user_meta(get_current_user_id(), self::META_KEY, false);
        foreach (is_array($values) ? $values : [] as $stored) {
            if (is_string($stored) && isset(self::PREFERENCE_PRIORITY[$stored])
                && self::PREFERENCE_PRIORITY[$stored] > self::PREFERENCE_PRIORITY[$preference]) {
                $preference = $stored;
            }
        }
        return $preference;
    }

    /** @return array{userId:int,preference:string,preferenceUrl:string}|null */
    public function client_config(): ?array {
        if (!$this->can_access()) return null;
        return [
            'userId' => get_current_user_id(),
            'preference' => $this->preference(),
            'preferenceUrl' => rest_url('kodety/v1/onboarding/preference'),
        ];
    }

    private function response(): WP_REST_Response {
        $response = new WP_REST_Response([
            'userId' => get_current_user_id(),
            'preference' => $this->preference(),
        ]);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        return $response;
    }

    public function rest_preference(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $permission = $this->permission($request);
        if ($permission instanceof WP_Error) return $permission;
        return $this->response();
    }

    public function rest_save_preference(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $permission = $this->permission($request);
        if ($permission instanceof WP_Error) return $permission;
        $preference = $request->get_param('preference');
        if (!is_string($preference) || !in_array($preference, self::PREFERENCES, true)) {
            return new WP_Error('kodety_onboarding_preference', 'Preferência de onboarding inválida.', ['status' => 400]);
        }
        // A manual replay never opts someone back into automatic invitations.
        // Initial writes only add; passing '' as update_user_meta's previous
        // value would disable its comparison and overwrite a racing refusal.
        // Existing rows advance with compare-and-set and bounded retries.
        $user_id = get_current_user_id();
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $previous = $this->preference();
            if (self::PREFERENCE_PRIORITY[$previous] >= self::PREFERENCE_PRIORITY[$preference]) return $this->response();
            if ($previous === 'unseen') {
                add_user_meta($user_id, self::META_KEY, $preference, true);
            } else {
                update_user_meta($user_id, self::META_KEY, $preference, $previous);
            }
            // A failed comparison can leave this worker's old meta cache in
            // memory even after another worker saved a stronger preference.
            wp_cache_delete($user_id, 'user_meta');
            $stored = $this->preference();
            if (self::PREFERENCE_PRIORITY[$stored] >= self::PREFERENCE_PRIORITY[$preference]) return $this->response();
        }
        return new WP_Error('kodety_onboarding_save_failed', 'Não foi possível salvar a preferência de onboarding.', ['status' => 500]);
    }
}
