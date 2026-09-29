<?php

defined('ABSPATH') || exit;

/**
 * Compatibility facade for projects and extensions authored before Onun Kodety.
 * All installed features are available under GPL-3.0. This facade never stores
 * activation credentials, schedules validation or contacts a licensing service.
 */
final class Kodety_License {
    private static ?self $instance = null;

    public static function instance(): self { return self::$instance ??= new self(); }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_rest_routes']);
    }

    public static function activate_plugin(): void { self::clear_legacy_state(); }
    public static function deactivate_plugin(): void { self::clear_legacy_state(); }

    private static function clear_legacy_state(): void {
        if (function_exists('wp_clear_scheduled_hook')) wp_clear_scheduled_hook('kodety_license_check');
        if (function_exists('delete_option')) {
            foreach (['kodety_license_state', 'kodety_license_installation', 'kodety_license_runtime_access', 'kodety_license_check_lock'] as $option) delete_option($option);
        }
    }

    public function public_status(): array {
        return [
            'configured' => false, 'valid' => true, 'status' => 'open-source',
            'isTrial' => false, 'trialExpired' => false, 'licenseId' => '',
            'activationId' => '', 'keyMask' => '', 'plan' => '',
            'entitlements' => Kodety_Edition::features(), 'limits' => [],
            'issuedAt' => '', 'expiresAt' => '', 'nextCheckAt' => '',
            'graceUntil' => '', 'lastCheckedAt' => '', 'lastError' => '',
            'installationId' => '', 'apiVersion' => 'open-source',
            'serverTime' => gmdate('c'),
        ];
    }

    public function is_active(): bool { return true; }
    public function has_entitlement(string $entitlement): bool { return true; }
    public function limit(string $name, int $fallback = -1): int { return -1; }
    public function strip_unlicensed_advanced_features(string $html): string { return $html; }
    public function inject_unlicensed_branding(string $html): string { return $html; }
    public function activate(string $license_key): array { self::clear_legacy_state(); return $this->public_status(); }
    public function check(bool $force = false): array { return $this->public_status(); }
    public function deactivate(): array { self::clear_legacy_state(); return $this->public_status(); }
    public function ensure_schedule(): void { self::clear_legacy_state(); }
    public function check_on_admin_access(): void {}
    public function scheduled_check(): void { self::clear_legacy_state(); }

    public function request_agent_session(string $project_id, string $project_name): WP_Error {
        return new WP_Error('kodety_agents_remote_disabled', 'Use o Agent no navegador ou no seu próprio servidor. O serviço comercial de sessões foi removido.', ['status' => 410]);
    }

    public function register_rest_routes(): void {
        // Preserve the capability refresh endpoint and its WordPress security.
        register_rest_route('kodety/v1', '/license/runtime', [
            'methods' => 'GET',
            'callback' => static function () {
                $response = rest_ensure_response(Kodety_Edition::public_config());
                $response->header('Cache-Control', 'private, no-store, max-age=0');
                return $response;
            },
            'permission_callback' => static fn(): bool => is_user_logged_in() && current_user_can('edit_posts'),
        ]);
    }
}
