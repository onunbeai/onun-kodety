<?php

defined('ABSPATH') || exit;

/**
 * Read-only Adobe Fonts Web Project integration.
 *
 * The integration is administered entirely by WordPress and deliberately has
 * no Adobe account token. It reads only the
 * public, published Typekit kit endpoint and leaves all CSS/font delivery on
 * Adobe's required use.typekit.net embed URL.
 */
final class Kodety_Adobe_Fonts {
    private const OPTION = 'kodety_adobe_fonts_settings';
    private const API_ROOT = 'https://typekit.com/api/v1/json/kits/';
    private const STYLESHEET_ROOT = 'https://use.typekit.net/';
    private const MAX_RESPONSE_BYTES = 2097152;
    private const REQUEST_TIMEOUT = 15;
    private const STALE_AFTER = 86400;

    private static ?self $instance = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_stylesheet'], 5);
    }

    /** Compatibility marker for editor clients shipped before plugin-native setup. */
    public static function reseller_licensed(): bool {
        return true;
    }

    public static function is_configured(): bool {
        $stored = get_option(self::OPTION, []);
        return is_array($stored)
            && self::sanitize_project_id((string) ($stored['project_id'] ?? '')) !== '';
    }

    public function register_rest_routes(): void {
        register_rest_route('kodety/v1', '/fonts/adobe', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'rest_catalog'],
            'permission_callback' => [$this, 'catalog_permission'],
        ]);
        register_rest_route('kodety/v1', '/fonts/adobe/resync', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'rest_resync'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
        register_rest_route('kodety/v1', '/fonts/adobe/settings', [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [$this, 'rest_settings'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [$this, 'rest_save_settings'],
                'permission_callback' => [$this, 'manage_permission'],
                'args' => [
                    'projectId' => ['type' => 'string', 'required' => true, 'maxLength' => 256],
                ],
            ],
            [
                'methods' => WP_REST_Server::DELETABLE,
                'callback' => [$this, 'rest_delete_settings'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
        ]);
    }

    public function catalog_permission(WP_REST_Request $request): bool|WP_Error {
        if (!is_user_logged_in()) {
            return new WP_Error(
                'kodety_adobe_fonts_unauthorized',
                'Autenticação necessária.',
                ['status' => 401]
            );
        }
        $can_edit = current_user_can('manage_options') || current_user_can('kodety_edit');
        if (class_exists('Kodety_Plugin')) {
            $can_edit = $can_edit || current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE);
        }
        if (!$can_edit) {
            return new WP_Error(
                'kodety_adobe_fonts_forbidden',
                'Sem permissão para visualizar o catálogo Adobe Fonts.',
                ['status' => 403]
            );
        }
        return $this->authorize_request($request);
    }

    public function manage_permission(WP_REST_Request $request): bool|WP_Error {
        if (!is_user_logged_in()) {
            return new WP_Error(
                'kodety_adobe_fonts_unauthorized',
                'Autenticação necessária.',
                ['status' => 401]
            );
        }
        if (!current_user_can('manage_options')) {
            return new WP_Error(
                'kodety_adobe_fonts_forbidden',
                'Sem permissão para gerenciar o Adobe Fonts.',
                ['status' => 403]
            );
        }
        return $this->authorize_request($request);
    }

    private function authorize_request(WP_REST_Request $request): bool|WP_Error {
        if (class_exists('Kodety_Native_Operations')
            && Kodety_Native_Operations::is_authenticated_mcp_request($request)) return true;
        $nonce = trim((string) $request->get_header('X-WP-Nonce'));
        if ($nonce === '') $nonce = trim((string) $request->get_param('_wpnonce'));
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error(
                'kodety_adobe_fonts_nonce',
                'A sessão do Adobe Fonts expirou.',
                ['status' => 403]
            );
        }
        return true;
    }

    public function rest_catalog(): WP_REST_Response {
        return $this->response($this->public_payload());
    }

    public function rest_settings(): WP_REST_Response {
        return $this->response($this->public_payload());
    }

    public function rest_save_settings(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $input = $request->get_json_params();
        if (!is_array($input)) $input = [];
        $raw_project_id = (string) ($input['projectId'] ?? $request->get_param('projectId') ?? '');
        $project_id = self::sanitize_project_id($raw_project_id);
        if ($project_id === '') {
            return new WP_Error(
                'kodety_adobe_fonts_project_id',
                'Informe um Web Project ID válido do Adobe Fonts.',
                ['status' => 422]
            );
        }

        $synced = $this->fetch_published_project($project_id);
        if (is_wp_error($synced)) return $synced;
        $this->persist_sync($project_id, $synced);
        return $this->response($this->public_payload());
    }

    public function rest_resync(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $settings = $this->settings();
        $project_id = $settings['project_id'];
        if ($project_id === '') {
            return new WP_Error(
                'kodety_adobe_fonts_not_configured',
                'Conecte um Web Project do Adobe Fonts antes de ressincronizar.',
                ['status' => 409]
            );
        }

        $synced = $this->fetch_published_project($project_id);
        if (is_wp_error($synced)) {
            $settings['last_attempt_at'] = gmdate('c');
            $settings['last_error'] = sanitize_text_field($synced->get_error_message());
            update_option(self::OPTION, $settings, false);
            return $synced;
        }
        $this->persist_sync($project_id, $synced);
        return $this->response($this->public_payload());
    }

    public function rest_delete_settings(): WP_REST_Response {
        delete_option(self::OPTION);
        return $this->response($this->public_payload());
    }

    public function enqueue_stylesheet(): void {
        $settings = $this->settings();
        if ($settings['project_id'] === '') return;
        wp_enqueue_style(
            'kodety-adobe-fonts',
            self::stylesheet_url($settings['project_id']),
            [],
            null
        );
    }

    /** @return array<string,mixed>|WP_Error */
    private function fetch_published_project(string $project_id): array|WP_Error {
        $project_id = self::sanitize_project_id($project_id);
        if ($project_id === '') {
            return new WP_Error(
                'kodety_adobe_fonts_project_id',
                'Web Project ID inválido.',
                ['status' => 422]
            );
        }
        $url = self::API_ROOT . rawurlencode($project_id) . '/published';
        $remote = wp_safe_remote_get($url, [
            'timeout' => self::REQUEST_TIMEOUT,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => self::MAX_RESPONSE_BYTES,
            'headers' => [
                'Accept' => 'application/json',
                'User-Agent' => 'Onun Kodety/' . (defined('KODETY_VERSION') ? KODETY_VERSION : 'unknown'),
            ],
        ]);
        if (is_wp_error($remote)) {
            return new WP_Error(
                'kodety_adobe_fonts_unavailable',
                'Não foi possível consultar o Adobe Fonts agora.',
                ['status' => 503, 'upstream' => $remote->get_error_code()]
            );
        }

        $status = (int) wp_remote_retrieve_response_code($remote);
        $body = (string) wp_remote_retrieve_body($remote);
        if ($status === 404) {
            return new WP_Error(
                'kodety_adobe_fonts_project_not_found',
                'O Web Project não existe ou ainda não foi publicado no Adobe Fonts.',
                ['status' => 422]
            );
        }
        if ($status < 200 || $status >= 300) {
            return new WP_Error(
                'kodety_adobe_fonts_upstream',
                'O Adobe Fonts recusou a consulta do Web Project.',
                ['status' => $status === 429 ? 503 : 502, 'upstreamStatus' => $status]
            );
        }
        if ($body === '' || strlen($body) > self::MAX_RESPONSE_BYTES) {
            return new WP_Error(
                'kodety_adobe_fonts_response_size',
                'O Adobe Fonts retornou uma resposta inválida.',
                ['status' => 502]
            );
        }
        try {
            $payload = json_decode($body, true, 128, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return new WP_Error(
                'kodety_adobe_fonts_invalid_json',
                'O Adobe Fonts retornou metadados inválidos.',
                ['status' => 502]
            );
        }
        if (!is_array($payload)) {
            return new WP_Error(
                'kodety_adobe_fonts_invalid_payload',
                'O Adobe Fonts retornou metadados inválidos.',
                ['status' => 502]
            );
        }
        return $this->parse_published_payload($payload, $project_id, gmdate('c'));
    }

    /** @return array{fonts:list<array<string,mixed>>,published_at:string}|WP_Error */
    private function parse_published_payload(
        array $payload,
        string $expected_project_id,
        string $synced_at
    ): array|WP_Error {
        $kit = is_array($payload['kit'] ?? null) ? $payload['kit'] : null;
        if ($kit === null) {
            return new WP_Error(
                'kodety_adobe_fonts_invalid_payload',
                'O Adobe Fonts não retornou um Web Project publicado.',
                ['status' => 502]
            );
        }
        $returned_id = self::sanitize_project_id((string) ($kit['id'] ?? ''));
        if ($returned_id === '' || !hash_equals($expected_project_id, $returned_id)) {
            return new WP_Error(
                'kodety_adobe_fonts_project_mismatch',
                'O Adobe Fonts retornou um Web Project diferente do solicitado.',
                ['status' => 502]
            );
        }

        $families = is_array($kit['families'] ?? null) ? $kit['families'] : [];
        $fonts = [];
        foreach ($families as $family) {
            if (!is_array($family)) continue;
            $font = $this->normalize_family($family, $synced_at);
            if ($font !== null) $fonts[$font['id']] = $font;
        }
        $fonts = array_values($fonts);
        usort($fonts, static fn(array $left, array $right): int => strcasecmp(
            (string) ($left['displayName'] ?? $left['name'] ?? ''),
            (string) ($right['displayName'] ?? $right['name'] ?? '')
        ));
        $published_at = sanitize_text_field((string) ($kit['published'] ?? ''));
        return [
            'fonts' => $fonts,
            'published_at' => $published_at,
        ];
    }

    /** @return array<string,mixed>|null */
    private function normalize_family(array $family, string $synced_at): ?array {
        $id = strtolower(trim((string) ($family['id'] ?? '')));
        if (!preg_match('/^[a-z0-9_-]{1,64}$/', $id)) return null;
        $name = self::plain_text((string) ($family['name'] ?? ''), 200);
        if ($name === '') return null;
        $slug = self::plain_text((string) ($family['slug'] ?? ''), 200);

        $css_names = [];
        foreach (is_array($family['css_names'] ?? null) ? $family['css_names'] : [] as $raw_name) {
            $css_name = self::plain_text((string) $raw_name, 200);
            if ($css_name === '' || !preg_match('/^[\p{L}\p{N}][\p{L}\p{N} ._+-]{0,199}$/u', $css_name)) continue;
            $css_names[$css_name] = $css_name;
        }
        $css_names = array_values($css_names);
        if (!$css_names) return null;

        $raw_variations = [];
        $variants = [];
        $weights = [];
        foreach (is_array($family['variations'] ?? null) ? $family['variations'] : [] as $raw_variation) {
            $variation = strtolower(trim((string) $raw_variation));
            if (!preg_match('/^([ni])([1-9])$/', $variation, $match)) continue;
            $raw_variations[$variation] = $variation;
            $weight = (string) ((int) $match[2] * 100);
            $weights[$weight] = $weight;
            if ($match[1] === 'i') {
                $variant = $weight === '400' ? 'italic' : $weight . 'italic';
            } else {
                $variant = $weight === '400' ? 'regular' : $weight;
            }
            $variants[$variant] = $variant;
        }
        if (!$raw_variations) {
            $raw_variations = ['n4' => 'n4'];
            $variants = ['regular' => 'regular'];
            $weights = ['400' => '400'];
        }

        $upstream_stack = self::css_stack((string) ($family['css_stack'] ?? ''));
        $category = self::category_from_stack($upstream_stack);
        $css_stack = $upstream_stack !== ''
            ? $upstream_stack
            : self::derived_css_stack($css_names, $category);
        $subset = self::plain_text((string) ($family['subset'] ?? 'default'), 64);
        if ($subset === '') $subset = 'default';
        $family_name = $css_names[0];
        $aliases = [];
        foreach ([...$css_names, $slug, $name] as $alias) {
            if ($alias !== '') $aliases[$alias] = $alias;
        }

        return [
            'id' => 'adobe-' . $id,
            'adobeId' => $id,
            'name' => $name,
            'displayName' => $name,
            'family' => $family_name,
            'type' => 'adobe',
            'variants' => array_values($variants),
            'variations' => array_values($raw_variations),
            'weights' => array_values($weights),
            'category' => $category,
            'aliases' => array_values($aliases),
            'cssNames' => $css_names,
            'css_names' => $css_names,
            'cssStack' => $css_stack,
            'css_stack' => $css_stack,
            'subset' => $subset,
            'is_published' => true,
            'created_at' => '',
            'updated_at' => $synced_at,
            'deleted_at' => null,
        ];
    }

    private function persist_sync(string $project_id, array $synced): void {
        $fonts = is_array($synced['fonts'] ?? null) ? array_values($synced['fonts']) : [];
        $now = gmdate('c');
        $encoded = wp_json_encode($fonts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        update_option(self::OPTION, [
            'project_id' => $project_id,
            'fonts' => $fonts,
            'catalog_hash' => hash('sha256', is_string($encoded) ? $encoded : '[]'),
            'published_at' => sanitize_text_field((string) ($synced['published_at'] ?? '')),
            'synced_at' => $now,
            'last_attempt_at' => $now,
            'last_error' => '',
        ], false);
    }

    /** @return array{project_id:string,fonts:list<array<string,mixed>>,catalog_hash:string,published_at:string,synced_at:string,last_attempt_at:string,last_error:string} */
    private function settings(): array {
        $stored = get_option(self::OPTION, []);
        if (!is_array($stored)) $stored = [];
        $project_id = self::sanitize_project_id((string) ($stored['project_id'] ?? ''));
        $fonts = is_array($stored['fonts'] ?? null) ? array_values(array_filter(
            $stored['fonts'],
            static fn(mixed $font): bool => is_array($font)
                && isset($font['id'], $font['family'])
                && is_string($font['id'])
                && is_string($font['family'])
        )) : [];
        return [
            'project_id' => $project_id,
            'fonts' => $fonts,
            'catalog_hash' => sanitize_text_field((string) ($stored['catalog_hash'] ?? '')),
            'published_at' => sanitize_text_field((string) ($stored['published_at'] ?? '')),
            'synced_at' => sanitize_text_field((string) ($stored['synced_at'] ?? '')),
            'last_attempt_at' => sanitize_text_field((string) ($stored['last_attempt_at'] ?? '')),
            'last_error' => sanitize_text_field((string) ($stored['last_error'] ?? '')),
        ];
    }

    /** @return array<string,mixed> */
    private function public_payload(): array {
        $settings = $this->settings();
        $configured = $settings['project_id'] !== '';
        $synced_timestamp = $settings['synced_at'] !== '' ? strtotime($settings['synced_at']) : false;
        $stale = $configured && (
            $settings['last_error'] !== ''
            || $synced_timestamp === false
            || $synced_timestamp < time() - self::STALE_AFTER
        );
        $stylesheet_url = $configured ? self::stylesheet_url($settings['project_id']) : '';
        $message = !$configured
            ? 'Nenhum Web Project do Adobe Fonts está conectado.'
            : ($settings['last_error'] !== ''
                ? $settings['last_error']
                : 'Catálogo Adobe Fonts sincronizado.');
        return [
            'configured' => $configured,
            'connected' => $configured && $settings['last_error'] === '',
            'resellerLicensed' => self::reseller_licensed(),
            'projectId' => $settings['project_id'],
            'stylesheetUrl' => $stylesheet_url,
            'fonts' => $settings['fonts'],
            'familyCount' => count($settings['fonts']),
            'catalogHash' => $settings['catalog_hash'],
            'publishedAt' => $settings['published_at'],
            'syncedAt' => $settings['synced_at'],
            'lastAttemptAt' => $settings['last_attempt_at'],
            'stale' => $stale,
            'lastError' => $settings['last_error'],
            'message' => $message,
        ];
    }

    private function response(array $payload): WP_REST_Response {
        $response = new WP_REST_Response($payload);
        $response->header('Cache-Control', 'private, no-store');
        return $response;
    }

    public static function sanitize_project_id(string $value): string {
        $value = trim($value);
        if (preg_match('#^https://use\.typekit\.net/([a-z0-9]{1,64})\.css$#i', $value, $match)) {
            $value = $match[1];
        }
        $value = strtolower($value);
        return preg_match('/^[a-z0-9]{1,64}$/', $value) ? $value : '';
    }

    public static function stylesheet_url(string $project_id): string {
        $project_id = self::sanitize_project_id($project_id);
        return $project_id === '' ? '' : self::STYLESHEET_ROOT . $project_id . '.css';
    }

    private static function plain_text(string $value, int $maximum): string {
        $value = sanitize_text_field($value);
        if (strlen($value) > $maximum) $value = substr($value, 0, $maximum);
        return trim($value);
    }

    private static function css_stack(string $value): string {
        $value = trim(wp_strip_all_tags($value));
        if ($value === '' || strlen($value) > 1000 || preg_match('/[{};<>\r\n]/', $value)) return '';
        return $value;
    }

    /** @param list<string> $css_names */
    private static function derived_css_stack(array $css_names, string $category): string {
        $quoted = array_map(
            static fn(string $name): string => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $name) . '"',
            $css_names
        );
        $generic = $category === 'handwriting'
            ? 'cursive'
            : ($category === 'display' ? 'sans-serif' : $category);
        return implode(',', [...$quoted, $generic]);
    }

    private static function category_from_stack(string $stack): string {
        $stack = strtolower($stack);
        if (preg_match('/(?:^|,)\s*monospace\s*$/', $stack)) return 'monospace';
        if (preg_match('/(?:^|,)\s*serif\s*$/', $stack) && !str_ends_with($stack, 'sans-serif')) return 'serif';
        if (preg_match('/(?:^|,)\s*(?:cursive|handwriting)\s*$/', $stack)) return 'handwriting';
        if (preg_match('/(?:^|,)\s*(?:fantasy|display)\s*$/', $stack)) return 'display';
        return 'sans-serif';
    }
}
