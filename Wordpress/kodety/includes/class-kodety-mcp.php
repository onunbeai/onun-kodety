<?php

defined('ABSPATH') || exit;

if (!class_exists('Kodety_Edition')) require_once __DIR__ . '/class-kodety-edition.php';
require_once __DIR__ . '/class-kodety-mcp-tool-contracts.php';

/**
 * Authenticated bridge used by the local Onun Kodety MCP server.
 *
 * The bearer credential is opt-in and persisted only as a SHA-256 digest. Its
 * one-time admin delivery uses a short-lived encrypted transient. Project file
 * operations deliberately exclude executable/server-side formats.
 */
final class Kodety_MCP {
    private static ?self $instance = null;
    /** @var resource|null */
    private $workspace_lock_handle = null;
    private int $workspace_lock_depth = 0;
    private ?string $authenticated_project_id = null;
    private ?WP_REST_Request $native_request_context = null;
    private ?WP_REST_Request $authenticated_native_request = null;
    private int $authenticated_native_owner = 0;
    /** @var array<string,mixed>|null */
    private ?array $skill_manifest_cache = null;
    /** @var array<string,array<string,mixed>> */
    private array $inflight_activities = [];
    private const OPTION_ENABLED = 'kodety_mcp_enabled';
    private const OPTION_TOKEN_HASH = 'kodety_mcp_token_hash';
    private const OPTION_OWNER_ID = 'kodety_mcp_owner_id';
    private const OPTION_PROJECT_CONNECTIONS = 'kodety_mcp_project_connections';
    private const OPTION_REVISION = 'kodety_mcp_revision';
    private const OPTION_LAST_CHANGE = 'kodety_mcp_last_change';
    private const OPTION_ACTIVITY = 'kodety_mcp_activity';
    private const OPTION_ACTIVITY_EVENTS = 'kodety_mcp_activity_events';
    private const TOKEN_TRANSIENT = 'kodety_mcp_token_delivery_';
    private const MAX_TEXT_BYTES = 4194304;
    private const MAX_FILE_BYTES = 26214400;
    private const MAX_PROJECT_CONNECTIONS = 50;
    private const ACTIVITY_VISIBLE_SECONDS = 45;
    private const ACTIVITY_DEFAULT_LEASE_SECONDS = 120;
    private const ACTIVITY_LONG_LEASE_SECONDS = 900;
    private const MAX_ACTIVITY_EVENTS = 16;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action('admin_post_kodety_mcp_settings', [$this, 'save_settings']);
    }

    public function register_routes(): void {
        register_rest_route('kodety/v1', '/mcp/status', [
            'methods' => 'GET',
            'callback' => fn(): WP_REST_Response => new WP_REST_Response($this->status()),
            'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('kodety_edit'),
        ]);
        register_rest_route('kodety/v1', '/mcp/settings', [
            'methods' => 'POST',
            'callback' => [$this, 'update_connection'],
            'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('manage_options'),
            'args' => ['operation' => ['required' => true, 'type' => 'string', 'enum' => ['enable', 'rotate', 'disable']]],
        ]);
        register_rest_route('kodety/v1', '/mcp/project-connections', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'list_project_connections'],
                'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('manage_options'),
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'create_project_connection'],
                'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('manage_options'),
            ],
        ]);
        register_rest_route('kodety/v1', '/mcp/project-connections/(?P<id>project-[a-f0-9]{16})', [
            'methods' => 'DELETE',
            'callback' => [$this, 'delete_project_connection'],
            'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('manage_options'),
            'args' => [
                'id' => [
                    'required' => true,
                    'type' => 'string',
                    'pattern' => '^project-[a-f0-9]{16}$',
                ],
            ],
        ]);
        register_rest_route('kodety/v1', '/mcp/tool', [
            'methods' => 'POST',
            'callback' => [$this, 'execute_tool'],
            'permission_callback' => [$this, 'authenticate'],
            'args' => [
                'tool' => ['required' => true, 'type' => 'string', 'maxLength' => 80],
                'arguments' => ['type' => 'object', 'default' => []],
            ],
        ]);
        register_rest_route('kodety/v1', '/mcp', [
            [
                'methods' => 'POST',
                'callback' => [$this, 'execute_remote_protocol'],
                'permission_callback' => [$this, 'authenticate'],
            ],
            [
                'methods' => 'GET',
                'callback' => fn(): WP_Error => new WP_Error(
                    'kodety_mcp_stream_unavailable',
                    'Este servidor MCP usa respostas HTTP sem sessão. Envie mensagens JSON-RPC por POST.',
                    ['status' => 405]
                ),
                'permission_callback' => [$this, 'authenticate'],
            ],
        ]);
    }

    private function licensed_permission(string $capability): bool|WP_Error {
        if (!current_user_can($capability)) return false;
        if (Kodety_Edition::has('mcp')) return true;
        return new WP_Error(
            'kodety_license_mcp_required',
            'Ative uma licença Onun Kodety para usar o MCP e as integrações com IA.',
            ['status' => 403, 'licenseUrl' => Kodety_Edition::license_url()]
        );
    }

    /** @return array<string,mixed>|null */
    private function browser_studio_runtime(): ?array {
        if (!class_exists('Kodety_Plugin')) return null;
        $plugin = Kodety_Plugin::instance();
        if (!method_exists($plugin, 'browser_studio_runtime')) return null;
        $runtime = $plugin->browser_studio_runtime();
        return is_array($runtime) && !empty($runtime['enabled']) ? $runtime : null;
    }

    private function browser_studio_runtime_active(): bool {
        return $this->browser_studio_runtime() !== null;
    }

    public function authenticate(WP_REST_Request $request): bool|WP_Error {
        $this->authenticated_project_id = null;
        $this->authenticated_native_request = null;
        $this->authenticated_native_owner = 0;
        if (!Kodety_Edition::has('mcp')) {
            return new WP_Error(
                'kodety_license_mcp_required',
                'A conexão MCP exige uma licença Onun Kodety ativa.',
                ['status' => 403, 'licenseUrl' => Kodety_Edition::license_url()]
            );
        }
        if (is_multisite()) {
            return new WP_Error('kodety_mcp_multisite_unsupported', 'O MCP fica bloqueado em multisite para impedir alterações entre sites da rede.', ['status' => 409]);
        }
        if (!$this->enabled()) return new WP_Error('kodety_mcp_disabled', 'O MCP do Onun Kodety está desativado.', ['status' => 403]);
        $header = trim((string) $request->get_header('authorization'));
        $token = preg_match('/^Bearer\s+(.+)$/i', $header, $match) ? trim($match[1]) : '';
        if (!preg_match('/^kodety_[a-f0-9]{48}$/D', $token)) {
            return new WP_Error('kodety_mcp_unauthorized', 'Credencial MCP inválida.', ['status' => 401]);
        }
        $token_hash = hash('sha256', $token);
        $expected = (string) get_option(self::OPTION_TOKEN_HASH, '');
        $owner_id = 0;
        $matched_connection = null;
        if ($expected !== '' && hash_equals($expected, $token_hash)) {
            $owner_id = absint(get_option(self::OPTION_OWNER_ID, 0));
        } else {
            foreach ($this->project_connections() as $connection) {
                if (!hash_equals((string) $connection['tokenHash'], $token_hash)) continue;
                $owner_id = absint($connection['ownerId']);
                $matched_connection = $connection;
                break;
            }
        }
        if ($owner_id < 1) {
            return new WP_Error('kodety_mcp_unauthorized', 'Credencial MCP inválida.', ['status' => 401]);
        }
        $owner = $owner_id ? get_user_by('id', $owner_id) : false;
        if (!$owner instanceof WP_User || !user_can($owner, 'manage_options')) {
            return new WP_Error('kodety_mcp_owner_invalid', 'A conexão MCP perdeu o administrador responsável. Gere uma nova conexão.', ['status' => 403]);
        }
        if (is_array($matched_connection)) {
            $target = $this->project_target();
            $current_project_id = $this->project_scope_id($target);
            $bound_project_id = (string) $matched_connection['projectId'];
            if (!empty($matched_connection['legacyScope'])) {
                return new WP_Error(
                    'kodety_mcp_project_connection_legacy',
                    'Esta conexão MCP é anterior ao vínculo por workspace. Revogue-a e gere uma nova conexão no projeto aberto.',
                    [
                        'status' => 409,
                        'requiresRotation' => true,
                        'currentProjectId' => $current_project_id,
                    ]
                );
            }
            $this->authenticated_project_id = $bound_project_id;
            if ($current_project_id === '' || !hash_equals($bound_project_id, $current_project_id)) {
                return new WP_Error(
                    'kodety_mcp_project_target_changed',
                    'Esta conexão MCP pertence a outro projeto. Abra o projeto vinculado no Builder e tente novamente.',
                    [
                        'status' => 409,
                        'boundProjectId' => $bound_project_id,
                        'currentProjectId' => $current_project_id,
                    ]
                );
            }
        }
        // Associate the bearer request with the administrator who generated it.
        // Demotion/deletion therefore revokes every capability immediately.
        wp_set_current_user($owner_id);
        $this->authenticated_native_request = $request;
        $this->authenticated_native_owner = $owner_id;
        return true;
    }

    /** A nonce is a browser CSRF credential. Native integrations may instead
     * accept the exact request already authenticated by our bearer transport;
     * copying a header, switching users or revoking the token never grants it. */
    public function is_authenticated_native_context(WP_REST_Request $request): bool {
        if ($request !== $this->authenticated_native_request
            || $this->authenticated_native_owner <= 0
            || get_current_user_id() !== $this->authenticated_native_owner
            || !$this->enabled() || !Kodety_Edition::has('mcp')
            || !current_user_can('manage_options')) return false;
        try { $this->assert_authenticated_project_scope(); }
        catch (Throwable $error) { return false; }
        $header = trim((string) $request->get_header('authorization'));
        if (!preg_match('/^Bearer\s+(kodety_[a-f0-9]{48})$/Di', $header, $match)) return false;
        $hash = hash('sha256', $match[1]);
        if ($this->authenticated_project_id === null) {
            return (int) get_option(self::OPTION_OWNER_ID, 0) === $this->authenticated_native_owner
                && hash_equals((string) get_option(self::OPTION_TOKEN_HASH, ''), $hash);
        }
        foreach ($this->project_connections() as $connection) {
            if (empty($connection['legacyScope'])
                && (int) $connection['ownerId'] === $this->authenticated_native_owner
                && $connection['projectId'] === $this->authenticated_project_id
                && hash_equals((string) $connection['tokenHash'], $hash)) return true;
        }
        return false;
    }

    public function status(): array {
        $licensed = Kodety_Edition::has('mcp');
        $browser_studio = $this->browser_studio_runtime_active();
        $owner_id = absint(get_option(self::OPTION_OWNER_ID, 0));
        $owner = $owner_id ? get_user_by('id', $owner_id) : false;
        $global_configured = (string) get_option(self::OPTION_TOKEN_HASH, '') !== '';
        $valid_global_owner = $global_configured
            && $owner instanceof WP_User
            && user_can($owner, 'manage_options');
        $project_connections = $this->project_connections();
        $valid_project_connections = array_filter(
            $project_connections,
            static function (array $connection): bool {
                $connection_owner = get_user_by('id', absint($connection['ownerId']));
                return empty($connection['legacyScope'])
                    && $connection_owner instanceof WP_User
                    && user_can($connection_owner, 'manage_options');
            }
        );
        $legacy_project_connections = array_filter(
            $project_connections,
            static fn(array $connection): bool => !empty($connection['legacyScope'])
        );
        $configured = $global_configured || $project_connections !== [];
        $has_valid_connection = $valid_global_owner || $valid_project_connections !== [];
        $enabled = $licensed && $this->enabled() && $has_valid_connection;
        $activity = $enabled ? get_option(self::OPTION_ACTIVITY, null) : null;
        $activity_expired = is_array($activity)
            && !empty($activity['active'])
            && (int) ($activity['expiresAt'] ?? 0) < time();
        if (
            !is_array($activity)
            || $activity_expired
            || (
                empty($activity['active'])
                && (int) ($activity['visibleUntil'] ?? 0) < time()
            )
        ) {
            if (is_array($activity)) delete_option(self::OPTION_ACTIVITY);
            $activity = null;
        }
        $activity_events = $enabled ? $this->activity_events() : [];
        return [
            'enabled' => $enabled,
            'configured' => $configured,
            'available' => $licensed && !is_multisite(),
            'browserStudio' => $browser_studio,
            'licensed' => $licensed,
            'requiresRotation' => ($configured && !$has_valid_connection) || $legacy_project_connections !== [],
            'connectionCount' => count($project_connections) + ($global_configured ? 1 : 0),
            'legacyConnectionCount' => count($legacy_project_connections),
            'writeMode' => 'draft-workspace',
            'revision' => (int) get_option(self::OPTION_REVISION, 0),
            'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0),
            'lastChange' => get_option(self::OPTION_LAST_CHANGE, null),
            'activity' => $activity,
            'activityEvents' => $activity_events,
            'server' => 'kodety-wordpress',
            'siteUrl' => home_url('/'),
            'remoteUrl' => $this->remote_url(),
            'settingsUrl' => home_url('/kodety/settings/?section=mcp') . '#integrations-mcp',
            'skills' => $this->skill_distribution(),
            'target' => $this->project_target(),
        ];
    }

    private function enabled(): bool {
        return !is_multisite() && in_array(get_option(self::OPTION_ENABLED, '0'), ['1', 1, true], true);
    }

    /** @return array<string,array<string,mixed>> */
    private function project_connections(): array {
        $stored = get_option(self::OPTION_PROJECT_CONNECTIONS, []);
        if (!is_array($stored)) return [];
        $connections = [];
        foreach ($stored as $id => $connection) {
            $id = sanitize_key((string) $id);
            if ($id === '' || !is_array($connection)) continue;
            $token_hash = strtolower(trim((string) ($connection['tokenHash'] ?? '')));
            $project_id = sanitize_key((string) ($connection['projectId'] ?? ''));
            $owner_id = absint($connection['ownerId'] ?? 0);
            if (!preg_match('/^[a-f0-9]{64}$/D', $token_hash) || $project_id === '' || $owner_id < 1) continue;
            $scope_version = absint($connection['scopeVersion'] ?? 0);
            $connections[$id] = [
                'id' => $id,
                'tokenHash' => $token_hash,
                'projectId' => $project_id,
                'ownerId' => $owner_id,
                'workspaceMode' => sanitize_key((string) ($connection['workspaceMode'] ?? 'single')) ?: 'single',
                'connectionName' => substr(sanitize_key((string) ($connection['name'] ?? $connection['connectionName'] ?? '')), 0, 80),
                'projectName' => substr(sanitize_text_field((string) ($connection['projectName'] ?? 'Projeto')), 0, 120),
                'projectSlug' => sanitize_title((string) ($connection['projectSlug'] ?? '')),
                'createdAt' => sanitize_text_field((string) ($connection['createdAt'] ?? '')),
                'scopeVersion' => $scope_version,
                'legacyScope' => $project_id === 'single' && $scope_version < 2,
            ];
        }
        return $connections;
    }

    /** @return array<string,mixed> */
    private function project_target(): array {
        $workspace_project_id = sanitize_key((string) get_option('kodety_workspace_project_id', ''));
        $fallback_name = trim((string) get_option('kodety_project_name', ''));
        if ($fallback_name === '') $fallback_name = (string) get_bloginfo('name');

        return [
            'workspaceMode' => 'single',
            'workspaceProjectId' => $workspace_project_id,
            'name' => $fallback_name,
            'siteUrl' => home_url('/'),
            'builderUrl' => home_url('/kodety/editor/'),
        ];
    }

    /** @param array<string,mixed> $target */
    private function project_scope_id(array $target): string {
        return substr(sanitize_key((string) ($target['workspaceProjectId'] ?? '')), 0, 96);
    }

    private function assert_authenticated_project_scope(): void {
        if ($this->authenticated_project_id === null) return;
        $current_project_id = $this->project_scope_id($this->project_target());
        if ($current_project_id !== '' && hash_equals($this->authenticated_project_id, $current_project_id)) return;
        throw new RuntimeException(
            'Esta conexão MCP pertence a outro projeto. Abra o projeto vinculado no Builder e tente novamente.',
            409
        );
    }

    public function save_settings(): void {
        if (!current_user_can('manage_options')) wp_die('Sem permissão.', '', ['response' => 403]);
        check_admin_referer('kodety_mcp_settings', 'kodety_mcp_nonce');
        $operation = sanitize_key((string) ($_POST['kodety_mcp_operation'] ?? 'disable'));
        if (!in_array($operation, ['enable', 'rotate', 'disable'], true)) {
            wp_die('Operação MCP inválida.', '', ['response' => 400]);
        }
        if ($operation !== 'disable' && !Kodety_Edition::has('mcp')) {
            wp_die('Ative uma licença Onun Kodety para habilitar o MCP.', '', ['response' => 403]);
        }
        if (is_multisite() && $operation !== 'disable') {
            wp_die('O MCP não pode ser habilitado em uma instalação multisite.', '', ['response' => 409]);
        }
        $this->apply_connection_operation($operation, true);
        wp_safe_redirect(add_query_arg([
            'page' => 'kodety',
            'kodety_mcp_updated' => '1',
        ], admin_url('admin.php')) . '#kodety-mcp');
        exit;
    }

    private function apply_connection_operation(string $operation, bool $defer_token_delivery = false): array {
        if (!in_array($operation, ['enable', 'rotate', 'disable'], true)) throw new InvalidArgumentException('Operação MCP inválida.');
        $token = '';
        if (in_array($operation, ['enable', 'rotate'], true)) {
            if (is_multisite()) throw new RuntimeException('O MCP não pode ser habilitado em uma instalação multisite.');
            if (!get_current_user_id() || !current_user_can('manage_options')) throw new RuntimeException('Somente um administrador pode gerar a conexão MCP.', 403);
            $token = 'kodety_' . bin2hex(random_bytes(24));
            $protected_token = $defer_token_delivery ? $this->protect_one_time_token($token) : '';
            $previous_hash = (string) get_option(self::OPTION_TOKEN_HASH, '');
            $previous_owner = absint(get_option(self::OPTION_OWNER_ID, 0));
            $previous_enabled = get_option(self::OPTION_ENABLED, '0');
            if (!update_option(self::OPTION_TOKEN_HASH, hash('sha256', $token), false)) {
                throw new RuntimeException('Não foi possível persistir a nova credencial MCP.');
            }
            update_option(self::OPTION_OWNER_ID, get_current_user_id(), false);
            update_option(self::OPTION_ENABLED, '1', false);
            if (absint(get_option(self::OPTION_OWNER_ID, 0)) !== get_current_user_id() || !in_array(get_option(self::OPTION_ENABLED, '0'), ['1', 1, true], true)) {
                $previous_hash === '' ? delete_option(self::OPTION_TOKEN_HASH) : update_option(self::OPTION_TOKEN_HASH, $previous_hash, false);
                $previous_owner ? update_option(self::OPTION_OWNER_ID, $previous_owner, false) : delete_option(self::OPTION_OWNER_ID);
                update_option(self::OPTION_ENABLED, $previous_enabled, false);
                throw new RuntimeException('Não foi possível vincular a conexão MCP ao administrador atual.');
            }
            if ($defer_token_delivery) {
                if (!set_transient(self::TOKEN_TRANSIENT . get_current_user_id(), $protected_token, 2 * MINUTE_IN_SECONDS)) {
                    $previous_hash === '' ? delete_option(self::OPTION_TOKEN_HASH) : update_option(self::OPTION_TOKEN_HASH, $previous_hash, false);
                    $previous_owner ? update_option(self::OPTION_OWNER_ID, $previous_owner, false) : delete_option(self::OPTION_OWNER_ID);
                    update_option(self::OPTION_ENABLED, $previous_enabled, false);
                    throw new RuntimeException('Não foi possível entregar a credencial MCP com segurança.');
                }
            } else {
                delete_transient(self::TOKEN_TRANSIENT . get_current_user_id());
            }
        } else {
            $connections_lock = $this->lock_project_connections();
            try {
                update_option(self::OPTION_ENABLED, '0', false);
                delete_option(self::OPTION_TOKEN_HASH);
                delete_option(self::OPTION_OWNER_ID);
                delete_option(self::OPTION_PROJECT_CONNECTIONS);
                delete_option(self::OPTION_ACTIVITY);
                delete_option(self::OPTION_ACTIVITY_EVENTS);
                delete_transient(self::TOKEN_TRANSIENT . get_current_user_id());
            } finally {
                $this->unlock_project_connections($connections_lock);
            }
        }
        $command = $token !== '' ? sprintf(
            'codex mcp add kodety -- node %s --site %s --token %s',
            escapeshellarg(KODETY_DIR . 'mcp/server.mjs'), escapeshellarg(home_url('/')), escapeshellarg($token)
        ) : '';
        $remote_config = $token !== '' ? wp_json_encode([
            'mcpServers' => [
                'kodety' => [
                    'type' => 'streamable-http',
                    'url' => $this->remote_url(),
                    'headers' => ['Authorization' => 'Bearer ' . $token],
                ],
            ],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) : '';
        return $this->status() + [
            'command' => $command,
            'remoteConfig' => is_string($remote_config) ? $remote_config : '',
        ];
    }

    private function remote_url(): string {
        $studio = $this->browser_studio_runtime();
        $studio_origin = is_array($studio) ? rtrim((string) ($studio['studioOrigin'] ?? ''), '/') : '';
        $project_id = is_array($studio) ? sanitize_text_field((string) ($studio['projectId'] ?? '')) : '';
        if ($studio_origin !== '' && preg_match('/^[a-z0-9-]{8,80}$/iD', $project_id)) {
            return $studio_origin
                . '/__kodety_mcp__/v1/projects/'
                . rawurlencode($project_id)
                . '/mcp';
        }
        return rest_url('kodety/v1/mcp');
    }

    /** @return array<string,array{title:string,description:string,root:string,files:list<string>}> */
    private function skill_packages(): array {
        return [
            'kodety-site-code' => [
                'title' => 'Onun Kodety Site Code',
                'description' => 'Cria, revisa e sincroniza sites editáveis com o Onun Kodety Builder.',
                'root' => 'docs/kodety-site-code',
                'files' => [
                    'SKILL.md',
                    'references/component-system.md',
                    'references/mcp-operations.md',
                    'references/kodety-code-contract.md',
                    'references/native-panels.md',
                    'scripts/validate-kodety-site.mjs',
                    'agents/openai.yaml',
                ],
            ],
            'kodety-motion' => [
                'title' => 'Onun Kodety Motion',
                'description' => 'Cria e ajusta animações nativas no Interactions v2.',
                'root' => 'agent-skills/kodety-motion',
                'files' => [
                    'SKILL.md',
                    'SKILL.json',
                    'agents/openai.yaml',
                    'references/motion-engine.md',
                ],
            ],
            'kodety-widgets' => [
                'title' => 'Onun Kodety Widgets',
                'description' => 'Cria, compila e configura Code Components React no Builder.',
                'root' => 'agent-skills/kodety-widgets',
                'files' => [
                    'SKILL.md',
                    'SKILL.json',
                    'agents/openai.yaml',
                    'references/agent-operations.md',
                    'references/code-component-contract.md',
                    'references/control-catalog.md',
                ],
            ],
            'kodety-performance' => [
                'title' => 'Onun Kodety Performance',
                'description' => 'Audita e aplica melhorias seguras de desempenho e carregamento.',
                'root' => 'agent-skills/kodety-performance',
                'files' => [
                    'SKILL.md',
                    'SKILL.json',
                    'agents/openai.yaml',
                    'references/performance-playbook.md',
                ],
            ],
        ];
    }

    private function skill_bundle_url(): string {
        $base = defined('KODETY_URL')
            ? (string) KODETY_URL
            : home_url('/wp-content/plugins/kodety/');
        $version = defined('KODETY_VERSION') ? (string) KODETY_VERSION : 'current';
        return rtrim($base, '/')
            . '/docs/kodety-agent-skills.zip?ver='
            . rawurlencode($version);
    }

    private function skill_resource_uri(string $skill, string $relative_path): string {
        $segments = array_map('rawurlencode', explode('/', $relative_path));
        return 'kodety://skills/' . rawurlencode($skill) . '/' . implode('/', $segments);
    }

    /** @return array<string,mixed> */
    private function build_skill_manifest(): array {
        $records = [];
        foreach ($this->skill_packages() as $name => $package) {
            $files = [];
            $digest_source = '';
            foreach ($package['files'] as $relative_path) {
                $absolute = wp_normalize_path(KODETY_DIR . $package['root'] . '/' . $relative_path);
                if (!is_file($absolute) || !is_readable($absolute)) continue;
                $sha256 = hash_file('sha256', $absolute);
                if (!is_string($sha256) || $sha256 === '') continue;
                $size = max(0, (int) filesize($absolute));
                $files[] = [
                    'path' => $relative_path,
                    'sha256' => $sha256,
                    'size' => $size,
                ];
                $digest_source .= $relative_path . "\0" . $sha256 . "\0" . $size . "\n";
            }
            $records[] = [
                'name' => $name,
                'title' => $package['title'],
                'description' => $package['description'],
                'digest' => 'sha256:' . hash('sha256', $digest_source),
                'manifestFile' => 'kodety.manifest.json',
                'files' => $files,
            ];
        }
        return [
            'schemaVersion' => 1,
            'source' => 'kodety-remote-mcp',
            'version' => defined('KODETY_VERSION') ? (string) KODETY_VERSION : 'current',
            'distributionScope' => 'external-mcp-clients',
            'nativeAgent' => [
                'managedBy' => 'kodety-builder',
                'installRequired' => false,
                'updateCheckRequired' => false,
            ],
            'packages' => $records,
        ];
    }

    /** @return array<string,mixed> */
    private function skill_manifest(): array {
        if ($this->skill_manifest_cache !== null) return $this->skill_manifest_cache;
        $manifest_path = KODETY_DIR . 'docs/kodety-agent-skills.json';
        if (is_file($manifest_path) && is_readable($manifest_path)) {
            $decoded = json_decode((string) file_get_contents($manifest_path), true);
            if (
                is_array($decoded)
                && (int) ($decoded['schemaVersion'] ?? 0) === 1
                && is_array($decoded['packages'] ?? null)
            ) {
                return $this->skill_manifest_cache = $decoded;
            }
        }
        return $this->skill_manifest_cache = $this->build_skill_manifest();
    }

    /** @return array<string,mixed> */
    private function skill_package_manifest(string $name): array {
        foreach ((array) ($this->skill_manifest()['packages'] ?? []) as $package) {
            if (is_array($package) && ($package['name'] ?? '') === $name) return $package;
        }
        throw new OutOfBoundsException('Manifest da skill não encontrado.');
    }

    /** @return array<string,mixed> */
    private function distributable_skill_manifest(string $name): array {
        $manifest = $this->skill_manifest();
        return [
            'schemaVersion' => 1,
            'source' => 'kodety-remote-mcp',
            'version' => (string) ($manifest['version'] ?? 'current'),
            'distributionScope' => (string) ($manifest['distributionScope'] ?? 'external-mcp-clients'),
            'nativeAgent' => is_array($manifest['nativeAgent'] ?? null)
                ? $manifest['nativeAgent']
                : [
                    'managedBy' => 'kodety-builder',
                    'installRequired' => false,
                    'updateCheckRequired' => false,
                ],
            ...$this->skill_package_manifest($name),
        ];
    }

    private function skill_install_prompt(): string {
        return <<<'PROMPT'
Instale ou atualize, no escopo do usuário deste cliente de IA, as quatro skills oficiais do Onun Kodety: kodety-site-code, kodety-motion, kodety-widgets e kodety-performance.

Este fluxo é somente para um cliente externo conectado por Remote MCP. Se você estiver no Agent nativo do próprio Onun Kodety Builder, não instale nem atualize nada: as skills internas já acompanham a instalação.

Use exclusivamente os arquivos fornecidos pelo servidor MCP Onun Kodety já conectado. Leia primeiro o recurso kodety://skills/catalog. Para cada pacote, compare o campo digest com o kodety.manifest.json local, quando existir. Se forem iguais, preserve o pacote sem reescrevê-lo. Se o manifest estiver ausente ou o digest for diferente, leia todos os recursos de arquivo listados, preserve exatamente os caminhos relativos e o conteúdo completo e, ao final, salve o conteúdo de manifestUri como kodety.manifest.json ao lado do SKILL.md.

Detecte o cliente atual e use a raiz de skills de usuário que ele já reconhece. No Codex, preserve $CODEX_HOME/skills quando CODEX_HOME estiver configurado ou esse diretório já existir (normalmente $HOME/.codex/skills); em instalações que adotam a raiz compartilhada, use $HOME/.agents/skills. No Claude Code, use $HOME/.claude/skills. Não reutilize caminhos absolutos pertencentes a outro computador. Atualize somente os quatro diretórios Onun Kodety correspondentes e não altere outras skills.

Não grave URL MCP, bearer token ou qualquer credencial nos arquivos, logs, commits ou na resposta. Se a escrita fora do projeto ou o acesso aos recursos exigir autorização, solicite-a ao usuário. Ao terminar, valide os hashes SHA-256 informados no catálogo, confirme que cada diretório contém SKILL.md, kodety.manifest.json e todos os arquivos auxiliares, recarregue a descoberta de skills quando o cliente permitir e informe quais pacotes foram instalados, atualizados ou já estavam atuais.
PROMPT;
    }

    /** @return array<string,mixed> */
    private function skill_distribution(): array {
        $packages = [];
        foreach ((array) ($this->skill_manifest()['packages'] ?? []) as $package) {
            if (!is_array($package) || !is_string($package['name'] ?? null)) continue;
            $packages[] = [
                'name' => $package['name'],
                'title' => (string) ($package['title'] ?? $package['name']),
                'description' => (string) ($package['description'] ?? ''),
                'digest' => (string) ($package['digest'] ?? ''),
                'fileCount' => count((array) ($package['files'] ?? [])),
                'manifestUri' => $this->skill_resource_uri($package['name'], 'kodety.manifest.json'),
            ];
        }
        return [
            'version' => (string) ($this->skill_manifest()['version'] ?? 'current'),
            'distributionScope' => (string) ($this->skill_manifest()['distributionScope'] ?? 'external-mcp-clients'),
            'nativeAgent' => is_array($this->skill_manifest()['nativeAgent'] ?? null)
                ? $this->skill_manifest()['nativeAgent']
                : [
                    'managedBy' => 'kodety-builder',
                    'installRequired' => false,
                    'updateCheckRequired' => false,
                ],
            'catalogUri' => 'kodety://skills/catalog',
            'bundleUrl' => $this->skill_bundle_url(),
            'installPrompt' => $this->skill_install_prompt(),
            'packages' => $packages,
        ];
    }

    /** @param array<string,mixed> $target */
    private function project_connection_name(array $target, string $connection_id): string {
        $slug = sanitize_title((string) ($target['slug'] ?? ''));
        if ($slug === '') $slug = sanitize_title((string) ($target['name'] ?? 'projeto'));
        if ($slug === '') $slug = 'projeto';
        return substr('kodety-' . $slug . '-' . substr($connection_id, -6), 0, 80);
    }

    /** @return array{connections:list<array<string,mixed>>} */
    private function project_connection_metadata(): array {
        $current_project_id = $this->project_scope_id($this->project_target());
        $metadata = [];
        foreach ($this->project_connections() as $connection) {
            $legacy_scope = !empty($connection['legacyScope']);
            $project_id = $legacy_scope ? '' : (string) $connection['projectId'];
            $name = (string) ($connection['connectionName'] ?? '');
            if ($name === '') {
                $name = $this->project_connection_name([
                    'name' => (string) ($connection['projectName'] ?? 'Projeto'),
                    'slug' => (string) ($connection['projectSlug'] ?? ''),
                ], (string) $connection['id']);
            }
            $metadata[] = [
                'id' => (string) $connection['id'],
                'name' => $name,
                'projectId' => $project_id,
                'projectName' => (string) $connection['projectName'],
                'createdAt' => (string) $connection['createdAt'],
                'currentProject' => !$legacy_scope
                    && $current_project_id !== ''
                    && hash_equals($project_id, $current_project_id),
            ];
        }
        return ['connections' => $metadata];
    }

    public function list_project_connections(WP_REST_Request $request): WP_REST_Response|WP_Error {
        unset($request);
        if (!get_current_user_id() || !current_user_can('manage_options')) {
            return new WP_Error(
                'kodety_mcp_project_connection_forbidden',
                'Somente um administrador pode listar conexões MCP.',
                ['status' => 403]
            );
        }
        return new WP_REST_Response($this->project_connection_metadata());
    }

    public function delete_project_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!get_current_user_id() || !current_user_can('manage_options')) {
            return new WP_Error(
                'kodety_mcp_project_connection_forbidden',
                'Somente um administrador pode revogar conexões MCP.',
                ['status' => 403]
            );
        }
        $connection_id = sanitize_key((string) $request->get_param('id'));
        if (!preg_match('/^project-[a-f0-9]{16}$/D', $connection_id)) {
            return new WP_Error('kodety_mcp_project_connection_invalid', 'Conexão MCP inválida.', ['status' => 400]);
        }
        try {
            $connections_lock = $this->lock_project_connections();
        } catch (Throwable $error) {
            return new WP_Error(
                'kodety_mcp_project_connection_error',
                $error->getMessage(),
                ['status' => 500]
            );
        }

        try {
            $connections = $this->project_connections();
            if (!isset($connections[$connection_id])) {
                return new WP_Error('kodety_mcp_project_connection_not_found', 'Conexão MCP não encontrada.', ['status' => 404]);
            }

            $stored = get_option(self::OPTION_PROJECT_CONNECTIONS, []);
            if (!is_array($stored) || !is_array($stored[$connection_id] ?? null)) {
                return new WP_Error(
                    'kodety_mcp_project_connection_error',
                    'Não foi possível carregar a conexão MCP selecionada.',
                    ['status' => 500]
                );
            }
            $previous_connections = $stored;
            unset($stored[$connection_id]);
            $stored === []
                ? delete_option(self::OPTION_PROJECT_CONNECTIONS)
                : update_option(self::OPTION_PROJECT_CONNECTIONS, $stored, false);
            $persisted = get_option(self::OPTION_PROJECT_CONNECTIONS, []);
            if (!is_array($persisted)) $persisted = [];
            $preserved = !array_key_exists($connection_id, $persisted)
                && count($persisted) === count($stored);
            foreach ($stored as $id => $connection) {
                if (!array_key_exists($id, $persisted) || $persisted[$id] !== $connection) {
                    $preserved = false;
                    break;
                }
            }
            if (!$preserved) {
                update_option(self::OPTION_PROJECT_CONNECTIONS, $previous_connections, false);
                return new WP_Error(
                    'kodety_mcp_project_connection_error',
                    'Não foi possível revogar somente a conexão MCP selecionada.',
                    ['status' => 500]
                );
            }
            return new WP_REST_Response([
                'deleted' => $connection_id,
            ] + $this->project_connection_metadata());
        } finally {
            $this->unlock_project_connections($connections_lock);
        }
    }

    public function create_project_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        unset($request);
        if (is_multisite()) {
            return new WP_Error(
                'kodety_mcp_multisite_unsupported',
                'O MCP não pode ser habilitado em uma instalação multisite.',
                ['status' => 409]
            );
        }
        if (!get_current_user_id() || !current_user_can('manage_options')) {
            return new WP_Error(
                'kodety_mcp_project_connection_forbidden',
                'Somente um administrador pode gerar uma conexão MCP.',
                ['status' => 403]
            );
        }
        $connections_lock = null;
        try {
            $connections_lock = $this->lock_project_connections();
            $target = $this->project_target();
            $project_id = $this->project_scope_id($target);
            if ($project_id === '' || !is_dir($this->project_root())) {
                throw new RuntimeException('Abra um projeto válido no Builder antes de copiar a conexão.', 409);
            }
            $connections = $this->project_connections();
            if (count($connections) >= self::MAX_PROJECT_CONNECTIONS) {
                throw new RuntimeException(
                    'O limite de conexões MCP por projeto foi atingido. Desative conexões antigas antes de criar outra.',
                    409
                );
            }

            $connection_id = 'project-' . bin2hex(random_bytes(8));
            $token = 'kodety_' . bin2hex(random_bytes(24));
            $previous_connections = $connections;
            $previous_enabled = get_option(self::OPTION_ENABLED, '0');
            $server_name = $this->project_connection_name($target, $connection_id);
            $connection = [
                'id' => $connection_id,
                'name' => $server_name,
                'tokenHash' => hash('sha256', $token),
                'projectId' => $project_id,
                'ownerId' => get_current_user_id(),
                'workspaceMode' => (string) ($target['workspaceMode'] ?? 'single'),
                'scopeVersion' => 2,
                'projectName' => (string) ($target['name'] ?? 'Projeto'),
                'projectSlug' => (string) ($target['slug'] ?? ''),
                'createdAt' => current_time('c'),
            ];
            $connections[$connection_id] = $connection;
            update_option(self::OPTION_PROJECT_CONNECTIONS, $connections, false);
            update_option(self::OPTION_ENABLED, '1', false);
            $persisted = $this->project_connections();
            if (
                !isset($persisted[$connection_id])
                || !hash_equals((string) $connection['tokenHash'], (string) $persisted[$connection_id]['tokenHash'])
                || !$this->enabled()
            ) {
                $previous_connections === []
                    ? delete_option(self::OPTION_PROJECT_CONNECTIONS)
                    : update_option(self::OPTION_PROJECT_CONNECTIONS, $previous_connections, false);
                update_option(self::OPTION_ENABLED, $previous_enabled, false);
                throw new RuntimeException('Não foi possível persistir a conexão MCP deste projeto.');
            }

            $remote_config = wp_json_encode([
                'mcpServers' => [
                    $server_name => [
                        'type' => 'streamable-http',
                        'url' => $this->remote_url(),
                        'headers' => ['Authorization' => 'Bearer ' . $token],
                    ],
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

            return new WP_REST_Response($this->status() + [
                'connection' => [
                    'id' => $connection_id,
                    'name' => $server_name,
                    'projectId' => $project_id,
                    'projectName' => (string) ($target['name'] ?? 'Projeto'),
                    'createdAt' => (string) $connection['createdAt'],
                ],
                // The plaintext credential exists only in this response. The
                // persisted connection keeps its SHA-256 digest.
                'remoteConfig' => is_string($remote_config) ? $remote_config : '',
            ], 201);
        } catch (Throwable $error) {
            return new WP_Error(
                'kodety_mcp_project_connection_error',
                $error->getMessage(),
                ['status' => in_array((int) $error->getCode(), [403, 409], true) ? (int) $error->getCode() : 500]
            );
        } finally {
            if (is_resource($connections_lock)) {
                $this->unlock_project_connections($connections_lock);
            }
        }
    }

    public function update_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $operation = sanitize_key((string) $request->get_param('operation'));
        if (!in_array($operation, ['enable', 'rotate', 'disable'], true)) {
            return new WP_Error('kodety_mcp_operation_invalid', 'Operação MCP inválida.', ['status' => 400]);
        }
        if (is_multisite() && $operation !== 'disable') {
            return new WP_Error('kodety_mcp_multisite_unsupported', 'O MCP não pode ser habilitado em uma instalação multisite.', ['status' => 409]);
        }
        try {
            return new WP_REST_Response($this->apply_connection_operation($operation, false));
        } catch (Throwable $error) {
            return new WP_Error('kodety_mcp_settings_error', $error->getMessage(), ['status' => 500]);
        }
    }

    public function render_panel(): void {
        if (!current_user_can('manage_options')) return;
        $browser_studio = $this->browser_studio_runtime_active();
        $unsupported = is_multisite();
        $status = $this->status();
        $enabled = (bool) ($status['enabled'] ?? false);
        $connection_count = max(0, (int) ($status['connectionCount'] ?? 0));
        $protected_token = $unsupported ? '' : (string) get_transient(self::TOKEN_TRANSIENT . get_current_user_id());
        if ($protected_token !== '') delete_transient(self::TOKEN_TRANSIENT . get_current_user_id());
        $token = $protected_token !== '' ? $this->unprotect_one_time_token($protected_token) : '';
        $server = KODETY_DIR . 'mcp/server.mjs';
        $command = $token !== '' ? sprintf(
            'codex mcp add kodety -- node %s --site %s --token %s',
            escapeshellarg($server), escapeshellarg(home_url('/')), escapeshellarg($token)
        ) : '';
        $remote_config = $token !== '' ? wp_json_encode([
            'mcpServers' => [
                'kodety' => [
                    'type' => 'streamable-http',
                    'url' => $this->remote_url(),
                    'headers' => ['Authorization' => 'Bearer ' . $token],
                ],
            ],
        ], JSON_UNESCAPED_SLASHES) : '';
        ?>
        <section id="kodety-mcp" class="kodety-site-project__panel kodety-mcp-panel" aria-labelledby="kodety-mcp-title" data-kodety-area="codex" hidden>
            <header class="kodety-site-project__panel-header kodety-site-project__panel-header--compact">
                <span class="kodety-site-project__panel-icon" aria-hidden="true">&lt;/&gt;</span>
                <div><h2 id="kodety-mcp-title">Codex via MCP</h2><p>Controle seguro do site e do Builder.</p></div>
                <span class="kodety-site-project__badge">Beta</span>
            </header>
            <div class="kodety-mcp-panel__body">
                <div class="kodety-mcp-panel__status<?php echo $enabled ? ' is-enabled' : ''; ?>">
                    <span aria-hidden="true"></span>
                    <div><strong><?php echo $browser_studio ? ($enabled ? 'MCP do Studio habilitado' : 'MCP do Studio desativado') : ($unsupported ? 'Indisponível em multisite' : ($enabled ? 'Servidor habilitado' : 'Servidor desativado')); ?></strong><p><?php echo $browser_studio ? 'A ponte segura do Studio encaminha as chamadas ao WordPress local enquanto este projeto permanece aberto no navegador.' : ($unsupported ? 'O bloqueio evita alterações cruzadas entre sites da rede.' : ($enabled ? sprintf('%d conexão(ões) autorizada(s). Conexões copiadas no Builder ficam vinculadas ao projeto escolhido.', $connection_count) : 'Nenhum agente externo possui acesso.')); ?></p></div>
                </div>
                <p>Permite a agentes compatíveis com MCP ler e editar HTML, CSS, JavaScript, conteúdo, imagens, mídia e releases. A IA pode entregar o projeto seção por seção; o tema publicado só muda após a ferramenta explícita de publicação. PHP e caminhos fora do projeto continuam bloqueados.</p>
                <?php if (is_string($remote_config) && $remote_config !== ''): ?>
                    <div class="kodety-mcp-panel__command">
                        <label for="kodety-mcp-remote-config">Configuração MCP remota</label>
                        <div class="kodety-mcp-panel__command-row">
                            <code id="kodety-mcp-remote-config"><?php echo esc_html($remote_config); ?></code>
                            <button type="button" class="kodety-project-action kodety-mcp-panel__copy" data-kodety-copy="#kodety-mcp-remote-config">
                                <span data-kodety-icon="copy" aria-hidden="true"></span>
                                <span data-kodety-copy-label>Copiar conexão</span>
                            </button>
                        </div>
                        <small>Cole em uma IA compatível com MCP remoto. Esta credencial só é exibida agora.</small>
                    </div>
                <?php endif; ?>
                <?php if ($command !== ''): ?>
                    <div class="kodety-mcp-panel__command">
                        <label for="kodety-mcp-command">Alternativa para Codex no Terminal</label>
                        <div class="kodety-mcp-panel__command-row">
                            <code id="kodety-mcp-command"><?php echo esc_html($command); ?></code>
                            <button type="button" class="kodety-project-action kodety-mcp-panel__copy" data-kodety-copy="#kodety-mcp-command">
                                <span data-kodety-icon="copy" aria-hidden="true"></span>
                                <span data-kodety-copy-label>Copiar comando</span>
                            </button>
                        </div>
                        <small>Por segurança, esta credencial só é exibida agora. Gere outra se perder o comando.</small>
                    </div>
                <?php endif; ?>
                <?php if (!$unsupported): ?><form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="kodety-mcp-panel__actions">
                    <input type="hidden" name="action" value="kodety_mcp_settings">
                    <?php wp_nonce_field('kodety_mcp_settings', 'kodety_mcp_nonce'); ?>
                    <?php if ($enabled): ?>
                        <button class="kodety-project-action" name="kodety_mcp_operation" value="rotate" type="submit">Gerar nova conexão</button>
                        <button class="kodety-project-action kodety-project-action--danger" name="kodety_mcp_operation" value="disable" type="submit">Desativar todas as conexões</button>
                    <?php else: ?>
                        <button class="kodety-project-action kodety-project-action--primary" name="kodety_mcp_operation" value="enable" type="submit">Ativar conexão com IA</button>
                    <?php endif; ?>
                </form><?php endif; ?>
            </div>
        </section>
        <?php
    }

    public function execute_tool(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $previous_context = $this->native_request_context;
        $this->native_request_context = $request;
        $tool = sanitize_key((string) $request->get_param('tool'));
        $arguments = $request->get_param('arguments');
        $arguments = is_array($arguments) ? $arguments : [];
        $activity_id = $this->begin_activity($tool, $arguments);
        $succeeded = false;
        $result = null;
        $error_message = '';
        try {
            $result = $this->dispatch_tool($tool, $arguments);
            if (is_wp_error($result)) {
                $error_message = $result->get_error_message();
                return $result;
            }
            $succeeded = true;
            return new WP_REST_Response(['ok' => true, 'result' => $result]);
        } catch (Throwable $error) {
            $error_message = $error->getMessage();
            $status = $error instanceof InvalidArgumentException
                ? 400
                : (in_array((int) $error->getCode(), [403, 409], true) ? (int) $error->getCode() : 500);
            return new WP_Error('kodety_mcp_tool_error', $error->getMessage(), ['status' => $status]);
        } finally {
            $this->finish_activity($activity_id, $succeeded, $result, $error_message);
            $this->native_request_context = $previous_context;
        }
    }

    private function activity_phase(string $tool, array $arguments = []): string {
        if ($tool === 'native_call' && class_exists('Kodety_Native_Operations')) {
            foreach (Kodety_Native_Operations::catalog()['operations'] as $operation) {
                if ($operation['name'] === ($arguments['operation'] ?? '')) {
                    return $operation['readOnly'] ? 'reading' : 'writing';
                }
            }
        }
        if ($tool === 'generate_ai_content') return 'generating';
        if (in_array($tool, [
            'native_catalog',
            'get_site',
            'get_settings',
            'list_files',
            'read_file',
            'list_content',
            'get_content',
            'get_ai_status',
            'list_collections',
            'list_media',
        ], true)) return 'reading';
        return 'writing';
    }

    private function activity_text(mixed $value, int $maximum = 180): string {
        if (!is_scalar($value)) return '';
        $text = sanitize_text_field((string) $value);
        return function_exists('mb_substr')
            ? mb_substr($text, 0, $maximum)
            : substr($text, 0, $maximum);
    }

    private function activity_target(string $tool, array $arguments): array {
        if ($tool === 'native_call') $arguments = is_array($arguments['arguments'] ?? null) ? $arguments['arguments'] : [];
        $target = [];
        $page = $this->activity_text($arguments['page'] ?? '');
        $section_id = $this->activity_text($arguments['sectionId'] ?? '', 80);
        $path = $this->activity_text(
            $arguments['path']
                ?? $arguments['filePath']
                ?? $arguments['projectPath']
                ?? ''
        );
        if ($page !== '') $target['page'] = $page;
        if ($section_id !== '' && preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,79}$/D', $section_id)) {
            $target['sectionId'] = $section_id;
        }
        if ($path !== '') $target['path'] = $path;
        $post_id = absint($arguments['id'] ?? $arguments['postId'] ?? $arguments['post_id'] ?? 0);
        if ($post_id > 0) $target['postId'] = $post_id;
        $post_type = sanitize_key((string) ($arguments['postType'] ?? $arguments['post_type'] ?? ''));
        if ($post_type !== '') $target['postType'] = $post_type;
        return $target;
    }

    private function activity_result(string $tool, mixed $result): array {
        if (!is_array($result)) return [];
        $summary = [];
        if ($tool === 'publish') {
            $release = $this->activity_text($result['release'] ?? '');
            $site_url = esc_url_raw((string) ($result['siteUrl'] ?? ''));
            if ($release !== '') $summary['release'] = $release;
            if ($site_url !== '') $summary['siteUrl'] = $site_url;
        }
        if ($tool === 'upsert_section') {
            $page = $this->activity_text($result['page'] ?? '');
            $section_id = $this->activity_text($result['sectionId'] ?? '', 80);
            $operation = sanitize_key((string) ($result['operation'] ?? ''));
            if ($page !== '') $summary['page'] = $page;
            if ($section_id !== '') $summary['sectionId'] = $section_id;
            if ($operation !== '') $summary['operation'] = $operation;
        }
        return $summary;
    }

    /** @return array<int,array<string,mixed>> */
    private function activity_events(): array {
        $stored = get_option(self::OPTION_ACTIVITY_EVENTS, []);
        $stored = is_array($stored) ? array_values($stored) : [];
        $now = time();
        $events = array_values(array_filter(
            $stored,
            static fn(mixed $event): bool => is_array($event)
                && empty($event['active'])
                && is_string($event['id'] ?? null)
                && (int) ($event['visibleUntil'] ?? 0) >= $now
        ));
        $events = array_slice($events, -self::MAX_ACTIVITY_EVENTS);
        if ($events !== $stored) {
            if ($events === []) delete_option(self::OPTION_ACTIVITY_EVENTS);
            else update_option(self::OPTION_ACTIVITY_EVENTS, $events, false);
        }
        return $events;
    }

    private function append_activity_event(array $activity): void {
        if (($activity['phase'] ?? '') === 'reading') return;
        $events = array_values(array_filter(
            $this->activity_events(),
            static fn(array $event): bool => ($event['id'] ?? '') !== ($activity['id'] ?? '')
        ));
        $events[] = $activity;
        update_option(
            self::OPTION_ACTIVITY_EVENTS,
            array_slice($events, -self::MAX_ACTIVITY_EVENTS),
            false
        );
    }

    private function begin_activity(string $tool, array $arguments = []): string {
        $activity_id = bin2hex(random_bytes(8));
        $target = $this->activity_target($tool, $arguments);
        $long_running = in_array($tool, ['publish', 'upload_media', 'generate_ai_content'], true);
        $activity = [
            'id' => $activity_id,
            'active' => true,
            'phase' => $this->activity_phase($tool, $arguments),
            'tool' => $tool,
            'startedAt' => current_time('c'),
            // A fatal process termination can bypass finally. Keep activity a
            // bounded lease so an abandoned MCP request never leaves Builder
            // in a permanent "AI is editing" state. Publish and media work get
            // a larger lease because managed hosts can legitimately be slow.
            'expiresAt' => time() + (
                $long_running
                    ? self::ACTIVITY_LONG_LEASE_SECONDS
                    : self::ACTIVITY_DEFAULT_LEASE_SECONDS
            ),
        ];
        if ($target !== []) $activity['target'] = $target;
        $this->inflight_activities[$activity_id] = $activity;
        update_option(self::OPTION_ACTIVITY, $activity, false);
        return $activity_id;
    }

    private function finish_activity(
        string $activity_id,
        bool $succeeded,
        mixed $result = null,
        string $error_message = ''
    ): void {
        $current_activity = get_option(self::OPTION_ACTIVITY, null);
        $activity = $this->inflight_activities[$activity_id]
            ?? (
                is_array($current_activity) && ($current_activity['id'] ?? '') === $activity_id
                    ? $current_activity
                    : null
            );
        unset($this->inflight_activities[$activity_id]);
        // A newer overlapping call owns the visible state. An older request
        // must never mark that newer activity as finished, but its completion
        // still belongs in the bounded event queue for browser notifications.
        if (!is_array($activity)) return;
        unset($activity['expiresAt']);
        $completed = [
            ...$activity,
            'active' => false,
            'success' => $succeeded,
            'completedAt' => current_time('c'),
            // Idle Builder polling must still observe short operations. The ID
            // lets each browser render one completion toast without repeats.
            'visibleUntil' => time() + self::ACTIVITY_VISIBLE_SECONDS,
        ];
        $result_summary = $this->activity_result((string) ($activity['tool'] ?? ''), $result);
        if ($result_summary !== []) $completed['result'] = $result_summary;
        if (!$succeeded && $error_message !== '') {
            $completed['message'] = $this->activity_text($error_message, 240);
        }
        if (is_array($current_activity) && ($current_activity['id'] ?? '') === $activity_id) {
            update_option(self::OPTION_ACTIVITY, $completed, false);
        }
        $this->append_activity_event($completed);
    }

    private function dispatch_tool(string $tool, array $arguments): mixed {
        $this->assert_authenticated_project_scope();
        return match ($tool) {
            'native_catalog' => $this->tool_native_catalog($arguments),
            'native_call' => $this->tool_native_call($arguments),
            'get_site' => $this->tool_get_site(),
            'get_settings' => $this->tool_get_settings(),
            'update_settings' => $this->tool_update_settings($arguments),
            'list_files' => $this->tool_list_files($arguments),
            'read_file' => $this->tool_read_file($arguments),
            'write_file' => $this->tool_write_file($arguments),
            'replace_in_file' => $this->tool_replace_in_file($arguments),
            'upsert_section' => $this->tool_upsert_section($arguments),
            'delete_file' => $this->tool_delete_file($arguments),
            'list_content', 'get_content', 'upsert_content', 'delete_content',
            'list_collections', 'update_collection_fields', 'create_collection' => $this->tool_native_cms_alias($tool, $arguments),
            'get_ai_status' => class_exists('Kodety_AI') && Kodety_Edition::has('ai')
                ? Kodety_AI::instance()->public_settings()
                : throw new InvalidArgumentException('IA exige uma licença ativa.'),
            'generate_ai_content' => class_exists('Kodety_AI') && Kodety_Edition::has('ai')
                ? Kodety_AI::instance()->generate($arguments)
                : throw new InvalidArgumentException('IA exige uma licença ativa.'),
            'list_media' => $this->tool_list_media($arguments),
            'upload_media' => $this->tool_upload_media($arguments),
            'publish' => $this->tool_publish(),
            default => throw new InvalidArgumentException('Ferramenta MCP desconhecida.'),
        };
    }

    public function execute_remote_protocol(WP_REST_Request $request): WP_REST_Response {
        $previous_context = $this->native_request_context;
        $this->native_request_context = $request;
        $id = $request->get_param('id');
        $method = (string) $request->get_param('method');
        if ($id === null && str_starts_with($method, 'notifications/')) {
            $this->native_request_context = $previous_context;
            return new WP_REST_Response(null, 202);
        }
        try {
            $result = match ($method) {
                'initialize' => [
                    'protocolVersion' => '2025-06-18',
                    'capabilities' => [
                        'tools' => ['listChanged' => false],
                        'resources' => ['listChanged' => false],
                        'prompts' => ['listChanged' => false],
                    ],
                    'serverInfo' => [
                        'name' => 'kodety-wordpress',
                        'title' => 'Onun Kodety WordPress',
                        'version' => defined('KODETY_VERSION') ? KODETY_VERSION : '1.2.0',
                    ],
                    'instructions' => 'Chame kodety_get_site antes de editar e confirme target, connectionScope e workspaceRevision. Uma conexão de projeto só opera enquanto o mesmo projeto estiver aberto no Builder. Para CMS, idiomas e configurações, leia kodety_native_catalog e execute kodety_native_call com o schema da operação: são as mesmas APIs do Agent nativo do Builder, com permissões, revisões e persistência nativas. Leia os itens e a revisão antes de atualizar ou excluir; use importação nativa para lotes e confira falhas por item. Se precisar de editor lease, use as operações editor_lock do catálogo; não tome uma sessão ativa. Construa uma seção por vez com kodety_upsert_section, usando a workspaceRevision mais recente como baseRevision. HTML, CSS e Interactions da seção são aplicados juntos. Releia após mutações, reconcilie conflitos e publique somente quando o usuário solicitar explicitamente. Para clientes externos Codex ou Claude, as skills oficiais estão em kodety://skills/*: compare o digest do catálogo com o kodety.manifest.json local e informe quando houver atualização; ofereça o prompt install-kodety-skills para instalar ou atualizar. O Agent nativo do Builder já usa as skills embarcadas e não precisa dessa verificação.',
                ],
                'ping' => new stdClass(),
                'tools/list' => ['tools' => $this->remote_tools()],
                'tools/call' => $this->remote_tool_call($request->get_param('params')),
                'resources/list' => ['resources' => $this->remote_resources()],
                'resources/read' => $this->remote_resource_read($request->get_param('params')),
                'prompts/list' => ['prompts' => $this->remote_prompts()],
                'prompts/get' => $this->remote_prompt_get($request->get_param('params')),
                default => throw new BadMethodCallException('Método MCP desconhecido.'),
            };
            return new WP_REST_Response(['jsonrpc' => '2.0', 'id' => $id, 'result' => $result]);
        } catch (Throwable $error) {
            $code = $error instanceof BadMethodCallException
                ? -32601
                : (
                    $error instanceof OutOfBoundsException
                        ? -32002
                        : ($error instanceof InvalidArgumentException ? -32602 : -32000)
                );
            return new WP_REST_Response([
                'jsonrpc' => '2.0',
                'id' => $id,
                'error' => ['code' => $code, 'message' => $error->getMessage()],
            ]);
        } finally {
            $this->native_request_context = $previous_context;
        }
    }

    /** @return list<array<string,mixed>> */
    private function remote_resources(): array {
        $resources = [[
            'uri' => 'kodety://skills/catalog',
            'name' => 'kodety-skills-catalog',
            'title' => 'Catálogo de skills oficiais do Onun Kodety',
            'description' => 'Manifesto versionado com os quatro pacotes recomendados e todos os seus arquivos.',
            'mimeType' => 'application/json',
            'annotations' => ['audience' => ['user', 'assistant'], 'priority' => 1.0],
        ]];
        foreach ($this->skill_packages() as $skill => $package) {
            $package_manifest = $this->distributable_skill_manifest($skill);
            $package_manifest_json = wp_json_encode(
                $package_manifest,
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
            );
            $resources[] = [
                'uri' => $this->skill_resource_uri($skill, 'kodety.manifest.json'),
                'name' => $skill . '/kodety.manifest.json',
                'title' => $package['title'] . ' · manifest de versão',
                'description' => 'Digest e hashes usados por clientes externos para detectar atualizações.',
                'mimeType' => 'application/json',
                'size' => is_string($package_manifest_json) ? strlen($package_manifest_json) : 0,
                'annotations' => ['audience' => ['assistant'], 'priority' => 1.0],
            ];
            foreach ($package['files'] as $relative_path) {
                $absolute = wp_normalize_path(KODETY_DIR . $package['root'] . '/' . $relative_path);
                if (!is_file($absolute) || !is_readable($absolute)) continue;
                $extension = strtolower(pathinfo($relative_path, PATHINFO_EXTENSION));
                $mime_type = match ($extension) {
                    'md' => 'text/markdown',
                    'json' => 'application/json',
                    'yaml', 'yml' => 'application/yaml',
                    'mjs', 'js' => 'text/javascript',
                    default => 'text/plain',
                };
                $resource = [
                    'uri' => $this->skill_resource_uri($skill, $relative_path),
                    'name' => $skill . '/' . $relative_path,
                    'title' => $package['title'] . ' · ' . $relative_path,
                    'description' => $relative_path === 'SKILL.md'
                        ? $package['description']
                        : 'Arquivo auxiliar oficial de ' . $package['title'] . '.',
                    'mimeType' => $mime_type,
                    'size' => max(0, (int) filesize($absolute)),
                    'annotations' => [
                        'audience' => ['assistant'],
                        'priority' => $relative_path === 'SKILL.md' ? 1.0 : 0.8,
                    ],
                ];
                $modified = filemtime($absolute);
                if (is_int($modified) && $modified > 0) {
                    $resource['annotations']['lastModified'] = gmdate('c', $modified);
                }
                $resources[] = $resource;
            }
        }
        return $resources;
    }

    /** @return array<string,mixed> */
    private function remote_resource_read(mixed $params): array {
        $params = is_array($params) ? $params : [];
        $uri = trim((string) ($params['uri'] ?? ''));
        if ($uri === 'kodety://skills/catalog') {
            $distribution = $this->skill_distribution();
            $packages = [];
            foreach ((array) ($this->skill_manifest()['packages'] ?? []) as $package) {
                if (!is_array($package) || !is_string($package['name'] ?? null)) continue;
                $name = $package['name'];
                $files = [];
                foreach ((array) ($package['files'] ?? []) as $file) {
                    if (!is_array($file) || !is_string($file['path'] ?? null)) continue;
                    $files[] = [
                        ...$file,
                        'uri' => $this->skill_resource_uri($name, $file['path']),
                    ];
                }
                $packages[] = [
                    'name' => $name,
                    'title' => (string) ($package['title'] ?? $name),
                    'description' => (string) ($package['description'] ?? ''),
                    'digest' => (string) ($package['digest'] ?? ''),
                    'manifestFile' => 'kodety.manifest.json',
                    'manifestUri' => $this->skill_resource_uri($name, 'kodety.manifest.json'),
                    'files' => $files,
                ];
            }
            $catalog = wp_json_encode([
                'schemaVersion' => 1,
                'source' => 'kodety-remote-mcp',
                'version' => $distribution['version'],
                'distributionScope' => $distribution['distributionScope'],
                'nativeAgent' => $distribution['nativeAgent'],
                'bundleUrl' => $distribution['bundleUrl'],
                'packages' => $packages,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            if (!is_string($catalog)) throw new RuntimeException('Não foi possível gerar o catálogo de skills.');
            return [
                'contents' => [[
                    'uri' => $uri,
                    'mimeType' => 'application/json',
                    'text' => $catalog,
                ]],
            ];
        }

        foreach ($this->skill_packages() as $skill => $package) {
            if (hash_equals($this->skill_resource_uri($skill, 'kodety.manifest.json'), $uri)) {
                $manifest = wp_json_encode(
                    $this->distributable_skill_manifest($skill),
                    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
                );
                if (!is_string($manifest)) throw new RuntimeException('Não foi possível gerar o manifest da skill.');
                return [
                    'contents' => [[
                        'uri' => $uri,
                        'mimeType' => 'application/json',
                        'text' => $manifest,
                    ]],
                ];
            }
            foreach ($package['files'] as $relative_path) {
                if (!hash_equals($this->skill_resource_uri($skill, $relative_path), $uri)) continue;
                $root = wp_normalize_path(KODETY_DIR . $package['root'] . '/');
                $absolute = wp_normalize_path($root . $relative_path);
                if (!str_starts_with($absolute, $root) || !is_file($absolute) || !is_readable($absolute)) {
                    throw new OutOfBoundsException('Recurso de skill indisponível.');
                }
                $content = file_get_contents($absolute);
                if (!is_string($content)) throw new RuntimeException('Não foi possível ler o recurso de skill.');
                $extension = strtolower(pathinfo($relative_path, PATHINFO_EXTENSION));
                return [
                    'contents' => [[
                        'uri' => $uri,
                        'mimeType' => match ($extension) {
                            'md' => 'text/markdown',
                            'json' => 'application/json',
                            'yaml', 'yml' => 'application/yaml',
                            'mjs', 'js' => 'text/javascript',
                            default => 'text/plain',
                        },
                        'text' => $content,
                    ]],
                ];
            }
        }
        throw new OutOfBoundsException('Recurso de skill não encontrado.');
    }

    /** @return list<array<string,mixed>> */
    private function remote_prompts(): array {
        return [[
            'name' => 'install-kodety-skills',
            'title' => 'Instalar skills oficiais do Onun Kodety',
            'description' => 'Baixa do próprio servidor conectado e instala as quatro skills recomendadas para este cliente de IA.',
            'arguments' => [],
        ]];
    }

    /** @return array<string,mixed> */
    private function remote_prompt_get(mixed $params): array {
        $params = is_array($params) ? $params : [];
        if (($params['name'] ?? '') !== 'install-kodety-skills') {
            throw new InvalidArgumentException('Prompt MCP desconhecido.');
        }
        return [
            'description' => 'Instalação guiada das skills oficiais do Onun Kodety.',
            'messages' => [[
                'role' => 'user',
                'content' => [
                    'type' => 'text',
                    'text' => $this->skill_install_prompt(),
                ],
            ]],
        ];
    }

    private function remote_tool_call(mixed $params): array {
        $params = is_array($params) ? $params : [];
        $name = (string) ($params['name'] ?? '');
        if (!str_starts_with($name, 'kodety_')) throw new InvalidArgumentException('Nome de ferramenta MCP inválido.');
        $arguments = $params['arguments'] ?? [];
        $arguments = is_array($arguments) ? $arguments : [];
        $tool = sanitize_key(substr($name, 7));
        if (!in_array($name, array_column($this->remote_tools(), 'name'), true)) {
            throw new InvalidArgumentException('Ferramenta MCP desconhecida.');
        }
        $activity_id = $this->begin_activity($tool, $arguments);
        $succeeded = false;
        $result = null;
        $error_message = '';
        try {
            if (function_exists('rest_validate_value_from_schema')) {
                $definition = array_values(array_filter($this->remote_tools(), static fn(array $candidate): bool => $candidate['name'] === $name))[0];
                $validation_schema = json_decode((string) wp_json_encode($definition['inputSchema']), true);
                $valid = rest_validate_value_from_schema((object) $arguments, $validation_schema, 'arguments');
                if (is_wp_error($valid)) {
                    $error_message = $valid->get_error_message();
                    return [
                    'content' => [['type' => 'text', 'text' => $valid->get_error_message()]],
                    'structuredContent' => ['error' => ['code' => $valid->get_error_code(), 'message' => $valid->get_error_message(), 'status' => 400]],
                    'isError' => true,
                    ];
                }
            }
            $result = $this->dispatch_tool($tool, $arguments);
            if (is_wp_error($result)) {
                $error_message = $result->get_error_message();
                $data = $result->get_error_data();
                $failure = [
                    'code' => $result->get_error_code(),
                    'message' => $error_message,
                    'data' => $data,
                    'status' => is_array($data) ? (int) ($data['status'] ?? 500) : 500,
                ];
                return [
                    'content' => [['type' => 'text', 'text' => (string) wp_json_encode($failure, JSON_UNESCAPED_SLASHES)]],
                    'structuredContent' => ['error' => $failure],
                    'isError' => true,
                ];
            }
            $succeeded = true;
            return [
                'content' => [['type' => 'text', 'text' => (string) wp_json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)]],
                'structuredContent' => ['result' => $result],
                'isError' => false,
            ];
        } catch (Throwable $error) {
            $error_message = $error->getMessage();
            $status = $error instanceof InvalidArgumentException ? 400 : (int) $error->getCode();
            if ($status < 400 || $status > 599) $status = 500;
            $failure = ['code' => 'kodety_mcp_tool_error', 'message' => $error_message, 'status' => $status];
            return [
                'content' => [['type' => 'text', 'text' => (string) wp_json_encode($failure, JSON_UNESCAPED_SLASHES)]],
                'structuredContent' => ['error' => $failure],
                'isError' => true,
            ];
        } finally {
            $this->finish_activity($activity_id, $succeeded, $result, $error_message);
        }
    }

    private function remote_tools(): array {
        $definitions = [
            ['native_catalog', 'Discover native CMS, localization and settings operations, including exact input schemas. Shared with the built-in Agent. Filter by area to keep the response focused.', true],
            ['native_call', 'Execute an operation from kodety_native_catalog through the same native API as the built-in Agent. Preserve returned revisions, lease context and per-item import outcomes. Publication requires explicit user intent.', false],
            ['get_site', 'Lê o projeto alvo, escopo da conexão, status, capacidades e revisão atual do workspace.', true],
            ['get_settings', 'Lê configurações visuais do Onun Kodety.', true],
            ['update_settings', 'Atualiza configurações visuais permitidas.', false],
            ['list_files', 'Lista os arquivos editáveis do projeto.', true],
            ['read_file', 'Lê um arquivo de projeto em UTF-8 ou base64.', true],
            ['write_file', 'Cria ou substitui deliberadamente um arquivo inteiro.', false],
            ['replace_in_file', 'Faz uma substituição textual exata e focada.', false],
            ['delete_file', 'Exclui um arquivo do workspace de rascunho.', false],
            ['list_content', 'Lista conteúdos do WordPress e collections Onun Kodety.', true],
            ['get_content', 'Lê um conteúdo do WordPress.', true],
            ['upsert_content', 'Cria ou atualiza conteúdo do WordPress.', false],
            ['list_collections', 'Lista collections e seus campos.', true],
            ['update_collection_fields', 'Atualiza o schema de campos de uma collection.', false],
            ['create_collection', 'Cria uma collection CMS.', false],
            ['delete_content', 'Remove um conteúdo do WordPress.', false],
            ['list_media', 'Lista itens da biblioteca de mídia.', true],
            ['upload_media', 'Envia um asset para mídia e opcionalmente para o projeto.', false],
            ['publish', 'Valida e publica explicitamente o workspace atual.', false],
        ];
        if (class_exists('Kodety_AI') && Kodety_Edition::has('ai')) {
            $definitions[] = ['get_ai_status', 'Consulta o provedor de IA configurado sem expor credenciais.', true];
            $definitions[] = ['generate_ai_content', 'Gera um rascunho de conteúdo sem persistir ou publicar.', true];
        }
        $tools = array_map(static fn(array $definition): array => [
            'name' => 'kodety_' . $definition[0],
            'description' => $definition[1],
            'inputSchema' => Kodety_MCP_Tool_Contracts::schema($definition[0]),
            'annotations' => [
                'readOnlyHint' => $definition[2],
                'destructiveHint' => !$definition[2],
                'openWorldHint' => false,
            ],
        ], $definitions);
        $tools[] = [
            'name' => 'kodety_upsert_section',
            'description' => 'Cria ou substitui uma seção completa e aplica seu HTML, CSS e Interactions como uma única revisão editável do Onun Kodety.',
            'inputSchema' => [
                'type' => 'object',
                'required' => ['page', 'sectionId', 'html', 'baseRevision'],
                'additionalProperties' => false,
                'properties' => [
                    'page' => ['type' => 'string', 'description' => 'Caminho HTML relativo, como index.html.'],
                    'sectionId' => ['type' => 'string', 'pattern' => '^[A-Za-z][A-Za-z0-9_-]{0,79}$'],
                    'html' => ['type' => 'string', 'description' => 'Elemento raiz completo com data-kodety-section-id igual a sectionId.'],
                    'css' => ['type' => 'string', 'description' => 'CSS exclusivo da seção.'],
                    'interactions' => ['type' => 'array', 'items' => ['type' => 'object']],
                    'baseRevision' => ['type' => 'integer', 'minimum' => 0],
                ],
            ],
            'annotations' => [
                'readOnlyHint' => false,
                'destructiveHint' => true,
                'idempotentHint' => true,
                'openWorldHint' => false,
            ],
        ];
        return $tools;
    }

    private function tool_native_catalog(array $args): array {
        if (!class_exists('Kodety_Native_Operations')) require_once __DIR__ . '/class-kodety-native-operations.php';
        $catalog = Kodety_Native_Operations::catalog();
        $area = trim((string) ($args['area'] ?? ''));
        if ($area !== '') {
            $catalog['operations'] = array_values(array_filter($catalog['operations'], static fn(array $operation): bool =>
                $operation['name'] === $area || str_starts_with($operation['name'], $area . '_')
            ));
        }
        return $catalog;
    }

    private function tool_native_call(array $args): mixed {
        if (!class_exists('Kodety_Native_Operations')) require_once __DIR__ . '/class-kodety-native-operations.php';
        $operation = $args['operation'] ?? null;
        $arguments = $args['arguments'] ?? null;
        if (!is_string($operation) || !is_array($arguments)) {
            throw new InvalidArgumentException('Informe operation e arguments conforme kodety_native_catalog.');
        }
        $result = Kodety_Native_Operations::instance()->execute($operation, $arguments, $this->native_request_context);
        if (is_wp_error($result)) return $result;
        if ($result->get_status() >= 400) {
            $data = $result->get_data();
            return new WP_Error(
                is_array($data) ? (string) ($data['code'] ?? 'kodety_native_error') : 'kodety_native_error',
                is_array($data) ? (string) ($data['message'] ?? 'A operação nativa falhou.') : 'A operação nativa falhou.',
                ['status' => $result->get_status()] + (is_array($data['data'] ?? null) ? $data['data'] : [])
            );
        }
        return $result->get_data();
    }

    /** Retain discoverable legacy names without a second CMS write path. */
    private function tool_native_cms_alias(string $tool, array $args): mixed {
        $native = array_intersect_key($args, array_flip(['expectedRevision', 'context']));
        $type = (string) ($args['postType'] ?? 'post');
        $id = absint($args['id'] ?? 0);
        if (in_array($tool, ['get_content', 'delete_content'], true) || ($tool === 'upsert_content' && $id)) {
            $post = get_post($id);
            if (!$post instanceof WP_Post) return new WP_Error('kodety_invalid_item', 'Conteúdo não encontrado.', ['status' => 404]);
            if (isset($args['postType']) && $args['postType'] !== $post->post_type) {
                throw new InvalidArgumentException('O tipo de um conteúdo existente não pode ser alterado pelo MCP.');
            }
            $type = $post->post_type;
            $native['post_id'] = $id;
        }
        $operation = match ($tool) {
            'list_content' => 'cms_list_items', 'get_content' => 'cms_get_item',
            'upsert_content' => $id ? 'cms_update_item' : 'cms_create_item',
            'delete_content' => 'cms_delete_item', 'list_collections' => 'cms_list_collections',
            'create_collection' => 'cms_create_collection', 'update_collection_fields' => 'cms_update_fields',
        };
        if (!in_array($tool, ['list_collections', 'create_collection'], true)) $native['post_type'] = $type;
        if ($tool === 'list_content') {
            $native += array_intersect_key($args, array_flip(['search', 'page']));
            if (isset($args['limit'])) $native['per_page'] = $args['limit'];
            if (isset($args['status']) && $args['status'] !== 'any') $native['status'] = $args['status'];
        } elseif ($tool === 'upsert_content') {
            $values = array_intersect_key($args, array_flip(['title', 'content', 'excerpt', 'slug', 'status']));
            foreach ((array) ($args['meta'] ?? []) as $key => $value) {
                if (!is_string($key) || str_starts_with($key, '_') || array_key_exists($key, $values)) {
                    throw new InvalidArgumentException('Use campos CMS públicos e sem colisões em meta.');
                }
                $values[$key] = $value;
            }
            $native['values'] = $values;
        } elseif ($tool === 'delete_content' && !empty($args['force'])) {
            throw new InvalidArgumentException('O CMS nativo remove para a lixeira. Use force=false.');
        } elseif ($tool === 'create_collection') {
            if (!empty($args['fields'])) {
                throw new InvalidArgumentException('Crie a coleção, leia sua revisão e configure campos com cms_update_fields.');
            }
            $native += array_intersect_key($args, array_flip(['name', 'singular', 'slug']));
        } elseif ($tool === 'update_collection_fields') {
            $native['fields'] = $args['fields'] ?? null;
        }
        return $this->tool_native_call(['operation' => $operation, 'arguments' => $native]);
    }

    private function tool_get_site(): array {
        $theme = wp_get_theme();
        $capabilities = ['projectFiles', 'sectionSync', 'remoteMcp', 'agentSkills', 'content', 'collections', 'media', 'releases', 'workspaceSettings', 'nativeOperations', 'cmsImport', 'localization'];
        if (class_exists('Kodety_AI') && Kodety_Edition::has('ai')) $capabilities[] = 'aiDrafts';
        $site = $this->status() + [
            'name' => get_bloginfo('name'), 'wordpressVersion' => get_bloginfo('version'),
            'theme' => $theme->get('Name'), 'release' => (string) get_option('kodety_current_release', ''),
            'projectInstalled' => is_dir($this->project_root()),
            'connectionScope' => $this->authenticated_project_id === null ? 'site' : 'project',
            'capabilities' => $capabilities,
            'product' => Kodety_Edition::public_config(),
        ];
        if (class_exists('Kodety_AI') && Kodety_Edition::has('ai')) {
            $site['ai'] = Kodety_AI::instance()->public_settings();
        }
        return $site;
    }

    private function tool_get_settings(): array {
        $icon = sanitize_key((string) get_option('kodety_editor_corner_icon', 'kodety-logo'));
        if (!in_array($icon, ['kodety-logo', 'client-logo'], true)) $icon = 'kodety-logo';
        $logo_id = absint(get_option('kodety_brand_logo_id', 0));
        if ($icon === 'client-logo' && !$logo_id) $icon = 'kodety-logo';
        return [
            'editorCornerIcon' => $icon,
            'brandLogoUrl' => $logo_id ? (string) wp_get_attachment_image_url($logo_id, 'thumbnail') : '',
            'allowedEditorCornerIcons' => ['kodety-logo', 'client-logo'],
            'interfaceAccentColor' => Kodety_Plugin::normalize_interface_accent_color(
                (string) get_option('kodety_admin_accent_color', '')
            ),
            'interfaceEnabled' => in_array(get_option('kodety_interface_enabled', '1'), ['1', 1, true], true),
            'blockEditorSkinEnabled' => in_array(get_option('kodety_block_editor_skin_enabled', '0'), ['1', 1, true], true),
        ];
    }

    private function tool_update_settings(array $args): array {
        $this->assert_capability('manage_options');
        if (array_key_exists('editorCornerIcon', $args)) {
            $icon = sanitize_key((string) $args['editorCornerIcon']);
            if (!in_array($icon, ['kodety-logo', 'client-logo'], true)) {
                throw new InvalidArgumentException('Logo inválida. Use kodety-logo ou client-logo.');
            }
            if ($icon === 'client-logo' && !absint(get_option('kodety_brand_logo_id', 0))) throw new InvalidArgumentException('Envie uma logo do cliente antes de selecionar client-logo.');
            update_option('kodety_editor_corner_icon', $icon, false);
        }
        if (array_key_exists('interfaceAccentColor', $args)) {
            $accent = trim((string) $args['interfaceAccentColor']);
            if (!Kodety_Plugin::is_valid_interface_accent_color($accent)) {
                throw new InvalidArgumentException('A cor de destaque deve ser hexadecimal e ter contraste mínimo de 4.5:1 com texto preto.');
            }
            update_option(
                'kodety_admin_accent_color',
                Kodety_Plugin::normalize_interface_accent_color($accent),
                false
            );
        }
        if (!array_key_exists('editorCornerIcon', $args) && !array_key_exists('interfaceAccentColor', $args)) {
            throw new InvalidArgumentException('Informe editorCornerIcon ou interfaceAccentColor.');
        }
        $this->changed();
        return $this->tool_get_settings() + ['revision' => (int) get_option(self::OPTION_REVISION, 0)];
    }

    private function tool_list_files(array $args): array {
        $this->assert_capability('edit_theme_options');
        $prefix = $this->relative_path((string) ($args['path'] ?? ''), true);
        $root = $this->project_root();
        if (!is_dir($root)) throw new RuntimeException('Nenhum projeto Onun Kodety está instalado.');
        $items = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isLink() || !$file->isFile()) continue;
            $relative = ltrim(str_replace('\\', '/', substr($file->getPathname(), strlen($root))), '/');
            if ($prefix !== '' && !str_starts_with($relative, rtrim($prefix, '/') . '/')) continue;
            $items[] = ['path' => $relative, 'size' => $file->getSize(), 'modified' => gmdate('c', $file->getMTime()), 'binary' => !$this->is_text($relative)];
            if (count($items) >= 2000) break;
        }
        return $items;
    }

    private function tool_read_file(array $args): array {
        $this->assert_capability('edit_theme_options');
        $relative = $this->relative_path((string) ($args['path'] ?? ''));
        $this->lock_workspace();
        try {
        $file = $this->project_file($relative);
        if (is_link($file) || !is_file($file)) throw new InvalidArgumentException('Arquivo não encontrado: ' . $relative);
        $size = (int) filesize($file);
        if ($size > self::MAX_FILE_BYTES) throw new InvalidArgumentException('Arquivo acima do limite de leitura MCP.');
        $content = file_get_contents($file);
        if (!is_string($content)) throw new RuntimeException('Não foi possível ler o arquivo.');
        $binary = !$this->is_text($relative);
        return ['path' => $relative, 'size' => $size, 'encoding' => $binary ? 'base64' : 'utf8', 'content' => $binary ? base64_encode($content) : $content, 'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0)];
        } finally {
            $this->unlock_workspace();
        }
    }

    private function tool_write_file(array $args): array {
        $this->assert_capability('edit_theme_options');
        $relative = $this->relative_path((string) ($args['path'] ?? ''));
        $this->assert_membership_workspace_mutation_allowed($relative);
        $this->assert_allowed_extension($relative);
        $encoding = strtolower((string) ($args['encoding'] ?? 'utf8'));
        if (!in_array($encoding, ['utf8', 'base64'], true)) throw new InvalidArgumentException('Encoding inválido. Use utf8 ou base64.');
        $raw = (string) ($args['content'] ?? '');
        if ($encoding === 'base64' && strlen($raw) > (int) ceil(self::MAX_FILE_BYTES * 4 / 3) + 8) {
            throw new InvalidArgumentException('Conteúdo base64 acima de 25 MB.');
        }
        $content = $encoding === 'base64' ? base64_decode($raw, true) : $raw;
        if ($content === false) throw new InvalidArgumentException('Conteúdo base64 inválido.');
        if (strlen($content) > self::MAX_FILE_BYTES) throw new InvalidArgumentException('Arquivo acima de 25 MB.');
        if ($this->is_text($relative) && strlen($content) > self::MAX_TEXT_BYTES) throw new InvalidArgumentException('Arquivo de texto acima de 4 MB.');
        $this->lock_workspace();
        try {
        $this->assert_file_revision($args);
        $file = $this->project_file($relative);
        $directory = dirname($file);
        if (!wp_mkdir_p($directory) && !is_dir($directory)) throw new RuntimeException('Não foi possível criar a pasta do arquivo.');
        // Re-resolve after mkdir so a concurrent symlink cannot redirect the write.
        $file = $this->project_file($relative);
        $temporary = tempnam($this->private_storage_root(), '.mcp-write-');
        if (!is_string($temporary)) throw new RuntimeException('Não foi possível preparar a gravação do arquivo.');
        $backup = null;
        $old_moved = false;
        try {
            if (file_put_contents($temporary, $content, LOCK_EX) !== strlen($content)) throw new RuntimeException('Não foi possível gravar o arquivo completo.');
            @chmod($temporary, 0644 & ~umask());
            if (is_file($file)) {
                $backup = tempnam($this->private_storage_root(), '.mcp-old-');
                if (!is_string($backup) || !unlink($backup)) throw new RuntimeException('Não foi possível preparar o backup do arquivo.');
                if (!rename($file, $backup)) throw new RuntimeException('Não foi possível preservar a versão anterior do arquivo.');
                $old_moved = true;
            }
            if (!rename($temporary, $file)) {
                if ($old_moved && is_string($backup) && is_file($backup) && rename($backup, $file)) {
                    $old_moved = false;
                    $backup = null;
                }
                throw new RuntimeException('Não foi possível ativar o novo arquivo.');
            }
            $temporary = '';
            if (is_string($backup) && is_file($backup)) unlink($backup);
            $backup = null;
            $old_moved = false;
        } finally {
            if ($temporary !== '' && is_file($temporary)) unlink($temporary);
            if ($old_moved && is_string($backup) && is_file($backup) && !is_file($file)) rename($backup, $file);
            elseif (!$old_moved && is_string($backup) && is_file($backup)) unlink($backup);
        }
        Kodety_Plugin::instance()->mcp_sync_project_file($relative, $file);
        $this->project_changed(['kind' => 'file', 'paths' => [$relative]]);
        return [
            'path' => $relative,
            'size' => strlen($content),
            'revision' => (int) get_option(self::OPTION_REVISION, 0),
            'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0),
        ];
        } finally {
            $this->unlock_workspace();
        }
    }

    private function tool_replace_in_file(array $args): array {
        $this->assert_capability('edit_theme_options');
        $relative = $this->relative_path((string) ($args['path'] ?? ''));
        if (!$this->is_text($relative)) throw new InvalidArgumentException('Substituição disponível apenas para arquivos de texto.');
        $this->lock_workspace();
        try {
        $this->assert_file_revision($args);
        $file = $this->project_file($relative);
        if (!is_file($file)) throw new InvalidArgumentException('Arquivo não encontrado.');
        $search = (string) ($args['search'] ?? '');
        if ($search === '') throw new InvalidArgumentException('Informe o texto a localizar.');
        $content = file_get_contents($file);
        if (!is_string($content)) throw new RuntimeException('Não foi possível ler o arquivo.');
        $count = substr_count($content, $search);
        if ($count === 0) throw new InvalidArgumentException('O texto procurado não existe no arquivo.');
        if (empty($args['replaceAll']) && $count > 1) throw new InvalidArgumentException('Há várias ocorrências; use replaceAll ou forneça mais contexto.');
        $replacement = (string) ($args['replacement'] ?? '');
        if (!empty($args['replaceAll'])) {
            $updated = str_replace($search, $replacement, $content);
        } else {
            $offset = strpos($content, $search);
            $updated = substr($content, 0, $offset) . $replacement . substr($content, $offset + strlen($search));
        }
        return $this->tool_write_file(['path' => $relative, 'content' => $updated]) + ['replacements' => !empty($args['replaceAll']) ? $count : 1];
        } finally {
            $this->unlock_workspace();
        }
    }

    private function tool_upsert_section(array $args): array {
        $this->assert_capability('edit_theme_options');
        $page = $this->relative_path((string) ($args['page'] ?? ''));
        if (!in_array(strtolower(pathinfo($page, PATHINFO_EXTENSION)), ['html', 'htm'], true)) {
            throw new InvalidArgumentException('page deve apontar para um arquivo HTML do projeto.');
        }
        $section_id = trim((string) ($args['sectionId'] ?? ''));
        if (!preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,79}$/D', $section_id)) {
            throw new InvalidArgumentException('sectionId inválido. Use letras, números, hífen ou underscore.');
        }
        if (!array_key_exists('baseRevision', $args) || !is_numeric($args['baseRevision'])) {
            throw new InvalidArgumentException('baseRevision é obrigatório. Leia kodety_get_site antes de editar.');
        }
        $section_html = trim((string) ($args['html'] ?? ''));
        if ($section_html === '' || strlen($section_html) > self::MAX_TEXT_BYTES) {
            throw new InvalidArgumentException('O HTML da seção está vazio ou excede 4 MB.');
        }
        $this->validate_section_html($section_html, $section_id);
        $this->lock_workspace();
        try {
            $current_revision = (int) get_option('kodety_workspace_revision', 0);
            if ((int) $args['baseRevision'] !== $current_revision) {
                throw new RuntimeException(
                    'O workspace mudou. Leia novamente o projeto e envie a seção sobre a revisão atual.',
                    409
                );
            }
            $page_file = $this->project_file($page);
            if (!is_file($page_file)) throw new InvalidArgumentException('Página HTML não encontrada: ' . $page);
            $page_source = file_get_contents($page_file);
            if (!is_string($page_source)) throw new RuntimeException('Não foi possível ler a página HTML.');
            [$page_source, $created] = $this->replace_or_append_section(
                $page_source,
                $section_id,
                $section_html
            );
            $changes = [$page => $page_source];
            $coded_build = $this->coded_build_original_document($page);
            if ($coded_build !== null) {
                [$coded_source] = $this->replace_or_append_section(
                    $coded_build['document'],
                    $section_id,
                    $section_html
                );
                $coded_build['document'] = $coded_source;
            }
            if (array_key_exists('css', $args)) {
                $css = (string) $args['css'];
                if (strlen($css) > self::MAX_TEXT_BYTES) throw new InvalidArgumentException('O CSS da seção excede 4 MB.');
                $css_path = $this->section_style_path($page, $section_id);
                $changes[$css_path] = $css;
                $changes[$page] = $this->ensure_section_stylesheet(
                    $changes[$page],
                    $section_id,
                    $this->relative_href(dirname($page), $css_path)
                );
                if ($coded_build !== null) {
                    $coded_build['document'] = $this->ensure_section_stylesheet(
                        $coded_build['document'],
                        $section_id,
                        $this->relative_href(dirname($page), $css_path)
                    );
                }
            }
            if ($coded_build !== null) {
                $coded_build['manifest']['originals'][$page] = $coded_build['document'];
                $encoded_manifest = wp_json_encode(
                    $coded_build['manifest'],
                    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
                );
                if (!is_string($encoded_manifest)) {
                    throw new RuntimeException('Não foi possível atualizar a fonte autoral do projeto compilado.');
                }
                $changes['.incode/coded-build.json'] = $encoded_manifest;
            }
            if (array_key_exists('interactions', $args)) {
                if (!is_array($args['interactions'])) throw new InvalidArgumentException('interactions deve ser um array.');
                $animation_path = $this->animation_document_path($page);
                $animation_file = $this->project_file($animation_path);
                $legacy_animation_path = $this->legacy_animation_document_path($page);
                if (!is_file($animation_file) && $legacy_animation_path !== $animation_path) {
                    $legacy_animation_file = $this->project_file($legacy_animation_path);
                    if (is_file($legacy_animation_file)) $animation_file = $legacy_animation_file;
                }
                $document = ['version' => 2, 'interactions' => []];
                if (is_file($animation_file)) {
                    $decoded = json_decode((string) file_get_contents($animation_file), true);
                    if (!is_array($decoded) || (int) ($decoded['version'] ?? 0) !== 2 || !is_array($decoded['interactions'] ?? null)) {
                        throw new InvalidArgumentException('O documento de Interactions existente não está no formato version 2.');
                    }
                    $document = $decoded;
                }
                $incoming = [];
                foreach ($args['interactions'] as $interaction) {
                    if (!is_array($interaction)) throw new InvalidArgumentException('Cada interaction deve ser um objeto.');
                    $interaction_id = (string) ($interaction['id'] ?? '');
                    if ($interaction_id === '' || !str_starts_with($interaction_id, $section_id . '-')) {
                        throw new InvalidArgumentException('IDs de Interactions da seção devem começar com "' . $section_id . '-".');
                    }
                    $interaction['sectionId'] = $section_id;
                    $incoming[] = $interaction;
                }
                $preserved = array_values(array_filter(
                    $document['interactions'],
                    static fn(mixed $interaction): bool => !is_array($interaction)
                        || (
                            (string) ($interaction['sectionId'] ?? '') !== $section_id
                            && !str_starts_with((string) ($interaction['id'] ?? ''), $section_id . '-')
                        )
                ));
                $document['version'] = 2;
                $document['interactions'] = array_merge($preserved, $incoming);
                $encoded = wp_json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
                if (!is_string($encoded)) throw new RuntimeException('Não foi possível serializar as Interactions da seção.');
                $changes[$animation_path] = $encoded . "\n";
            }
            $paths = $this->write_text_files_transaction($changes);
            $this->project_changed([
                'kind' => 'section',
                'page' => $page,
                'sectionId' => $section_id,
                'paths' => $paths,
            ]);
            return [
                'page' => $page,
                'sectionId' => $section_id,
                'operation' => $created ? 'created' : 'replaced',
                'changed' => $paths,
                'revision' => (int) get_option(self::OPTION_REVISION, 0),
                'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0),
            ];
        } finally {
            $this->unlock_workspace();
        }
    }

    private function validate_section_html(string $html, string $section_id): void {
        $tokens = $this->html_tokens($html);
        $root_index = null;
        foreach ($tokens as $index => $token) {
            if (($token['type'] ?? '') === 'start') {
                $root_index = $index;
                break;
            }
        }
        if ($root_index === null || trim(substr($html, 0, (int) $tokens[$root_index]['start'])) !== '') {
            throw new InvalidArgumentException('html deve conter um único elemento raiz completo.');
        }
        $attributes = $this->html_start_tag_attributes((string) $tokens[$root_index]['source']);
        if (($attributes['data-kodety-section-id'] ?? null) !== $section_id) {
            throw new InvalidArgumentException('O elemento raiz deve declarar data-kodety-section-id igual a sectionId.');
        }
        $match = $this->matching_html_element($tokens, $root_index);
        if ($match === null || trim(substr($html, (int) $match['end'])) !== '') {
            throw new InvalidArgumentException('html deve conter um único elemento raiz completo.');
        }
    }

    /**
     * Tokenize only real HTML tags. Comments, declarations, script/style raw
     * text and title/textarea RCDATA never become structural tokens, while
     * quoted ">" characters do not truncate a start tag. This intentionally
     * avoids DOMDocument:
     * libxml repairs fragments and can move template/SVG nodes while the
     * Builder needs a byte-preserving splice of the surrounding document.
     *
     * @return list<array{type:string,name:string,start:int,end:int,source:string,selfClosing:bool}>
     */
    private function html_tokens(string $document): array {
        $tokens = [];
        $length = strlen($document);
        $offset = 0;
        while ($offset < $length) {
            $start = strpos($document, '<', $offset);
            if ($start === false) break;
            if (substr($document, $start, 4) === '<!--') {
                $end = strpos($document, '-->', $start + 4);
                if ($end === false) break;
                $offset = $end + 3;
                continue;
            }
            if (strncasecmp(substr($document, $start, 9), '<![CDATA[', 9) === 0) {
                $end = strpos($document, ']]>', $start + 9);
                if ($end === false) break;
                $offset = $end + 3;
                continue;
            }
            if (substr($document, $start, 2) === '<?') {
                $end = strpos($document, '?>', $start + 2);
                if ($end === false) $end = $this->html_tag_end($document, $start);
                else $end += 2;
                if ($end === null) break;
                $offset = $end;
                continue;
            }
            if (substr($document, $start, 2) === '<!') {
                $end = $this->html_declaration_end($document, $start);
                if ($end === null) break;
                $offset = $end;
                continue;
            }

            $prefix_offset = $start + 1;
            if ($prefix_offset < $length && $document[$prefix_offset] === '/') $prefix_offset++;
            if ($prefix_offset >= $length || !preg_match('/[A-Za-z]/', $document[$prefix_offset])) {
                $offset = $start + 1;
                continue;
            }
            $end = $this->html_tag_end($document, $start);
            if ($end === null) break;
            $source = substr($document, $start, $end - $start);
            if (!preg_match('/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/A', $source, $match)) {
                $offset = $start + 1;
                continue;
            }
            $name = strtolower((string) $match[2]);
            $is_end = (string) $match[1] === '/';
            $self_closing = !$is_end && ($this->html_tag_is_self_closing($source) || $this->html_void_element($name));
            $tokens[] = [
                'type' => $is_end ? 'end' : 'start',
                'name' => $name,
                'start' => $start,
                'end' => $end,
                'source' => $source,
                'selfClosing' => $self_closing,
            ];
            $offset = $end;
            if (!$is_end && !$self_closing && in_array($name, ['script', 'style', 'textarea', 'title'], true)) {
                $raw_close = $this->html_raw_text_closing_token($document, $name, $end);
                if ($raw_close === null) break;
                $tokens[] = $raw_close;
                $offset = (int) $raw_close['end'];
            }
        }
        return $tokens;
    }

    private function html_tag_end(string $document, int $start): ?int {
        $quote = '';
        $length = strlen($document);
        for ($index = $start + 1; $index < $length; $index++) {
            $character = $document[$index];
            if ($quote !== '') {
                if ($character === $quote) $quote = '';
                continue;
            }
            if ($character === '"' || $character === "'") {
                $quote = $character;
                continue;
            }
            if ($character === '>') return $index + 1;
        }
        return null;
    }

    private function html_declaration_end(string $document, int $start): ?int {
        $quote = '';
        $brackets = 0;
        $length = strlen($document);
        for ($index = $start + 2; $index < $length; $index++) {
            $character = $document[$index];
            if ($quote !== '') {
                if ($character === $quote) $quote = '';
                continue;
            }
            if ($character === '"' || $character === "'") {
                $quote = $character;
                continue;
            }
            if ($character === '[') $brackets++;
            elseif ($character === ']' && $brackets > 0) $brackets--;
            elseif ($character === '>' && $brackets === 0) return $index + 1;
        }
        return null;
    }

    /** @return array{type:string,name:string,start:int,end:int,source:string,selfClosing:bool}|null */
    private function html_raw_text_closing_token(string $document, string $tag, int $offset): ?array {
        $needle = '</' . $tag;
        $length = strlen($document);
        while (($start = stripos($document, $needle, $offset)) !== false) {
            $boundary_offset = $start + strlen($needle);
            $boundary = $boundary_offset < $length ? $document[$boundary_offset] : '';
            if ($boundary !== '>' && ($boundary === '' || !$this->html_space_character($boundary))) {
                $offset = $boundary_offset;
                continue;
            }
            $end = $this->html_tag_end($document, $start);
            if ($end === null) return null;
            return [
                'type' => 'end',
                'name' => $tag,
                'start' => $start,
                'end' => $end,
                'source' => substr($document, $start, $end - $start),
                'selfClosing' => false,
            ];
        }
        return null;
    }

    private function html_tag_is_self_closing(string $source): bool {
        if (!preg_match('/^<[A-Za-z][A-Za-z0-9:-]*/A', $source, $match)) return false;
        $offset = strlen((string) $match[0]);
        $length = strlen($source);
        $state = 'before_attribute';
        $quote = '';
        while ($offset < $length) {
            $character = $source[$offset];
            if ($state === 'quoted_value') {
                if ($character === $quote) {
                    $quote = '';
                    $state = 'after_attribute';
                }
                $offset++;
                continue;
            }
            if ($state === 'unquoted_value') {
                if ($character === '>') return false;
                if ($this->html_space_character($character)) $state = 'before_attribute';
                $offset++;
                continue;
            }
            if ($state === 'before_value') {
                if ($this->html_space_character($character)) {
                    $offset++;
                    continue;
                }
                if ($character === '"' || $character === "'") {
                    $quote = $character;
                    $state = 'quoted_value';
                    $offset++;
                    continue;
                }
                if ($character === '>') return false;
                // In HTML's unquoted attribute-value state, `/` is data. It
                // becomes a self-closing marker only after whitespace, after
                // a quoted value or directly after an attribute/tag name.
                $state = 'unquoted_value';
                $offset++;
                continue;
            }
            if ($state === 'attribute_name') {
                if ($this->html_space_character($character)) {
                    $state = 'after_attribute';
                    $offset++;
                    continue;
                }
                if ($character === '=') {
                    $state = 'before_value';
                    $offset++;
                    continue;
                }
                if ($character === '/') return substr($source, $offset) === '/>';
                if ($character === '>') return false;
                $offset++;
                continue;
            }
            if ($this->html_space_character($character)) {
                $offset++;
                continue;
            }
            if ($state === 'after_attribute' && $character === '=') {
                $state = 'before_value';
                $offset++;
                continue;
            }
            if ($character === '/') return substr($source, $offset) === '/>';
            if ($character === '>') return false;
            $state = 'attribute_name';
            $offset++;
        }
        return false;
    }

    private function html_space_character(string $character): bool {
        return in_array($character, ["\t", "\n", "\f", "\r", ' '], true);
    }

    private function html_void_element(string $name): bool {
        return in_array($name, [
            'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
            'link', 'meta', 'param', 'source', 'track', 'wbr',
        ], true);
    }

    /** @return array<string,string|null> */
    private function html_start_tag_attributes(string $source): array {
        if (!preg_match('/^<\s*[A-Za-z][A-Za-z0-9:-]*/A', $source, $match)) return [];
        $attributes = [];
        $offset = strlen((string) $match[0]);
        $length = strlen($source);
        while ($offset < $length) {
            while ($offset < $length && $this->html_space_character($source[$offset])) $offset++;
            if ($offset >= $length || $source[$offset] === '>' || $source[$offset] === '/') break;
            $name_start = $offset;
            while (
                $offset < $length
                && !$this->html_space_character($source[$offset])
                && !in_array($source[$offset], ['=', '/', '>', '<'], true)
            ) {
                $offset++;
            }
            if ($offset === $name_start) {
                $offset++;
                continue;
            }
            $name = strtolower(substr($source, $name_start, $offset - $name_start));
            while ($offset < $length && $this->html_space_character($source[$offset])) $offset++;
            $value = null;
            if ($offset < $length && $source[$offset] === '=') {
                $offset++;
                while ($offset < $length && $this->html_space_character($source[$offset])) $offset++;
                if ($offset < $length && ($source[$offset] === '"' || $source[$offset] === "'")) {
                    $quote = $source[$offset++];
                    $value_start = $offset;
                    while ($offset < $length && $source[$offset] !== $quote) $offset++;
                    $value = substr($source, $value_start, $offset - $value_start);
                    if ($offset < $length) $offset++;
                } else {
                    $value_start = $offset;
                    while (
                        $offset < $length
                        && !$this->html_space_character($source[$offset])
                        && $source[$offset] !== '>'
                    ) $offset++;
                    $value = substr($source, $value_start, $offset - $value_start);
                }
            }
            if (!array_key_exists($name, $attributes)) {
                $attributes[$name] = $value === null
                    ? null
                    : html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            }
        }
        return $attributes;
    }

    /**
     * @param list<array{type:string,name:string,start:int,end:int,source:string,selfClosing:bool}> $tokens
     * @return array{end:int,closeStart:int}|null
     */
    private function matching_html_element(array $tokens, int $start_index): ?array {
        $opening = $tokens[$start_index] ?? null;
        if (!is_array($opening) || ($opening['type'] ?? '') !== 'start') return null;
        if (!empty($opening['selfClosing'])) {
            return ['end' => (int) $opening['end'], 'closeStart' => (int) $opening['start']];
        }
        $name = (string) $opening['name'];
        $depth = 1;
        $count = count($tokens);
        for ($index = $start_index + 1; $index < $count; $index++) {
            $token = $tokens[$index];
            if ((string) ($token['name'] ?? '') !== $name) continue;
            if (($token['type'] ?? '') === 'start' && empty($token['selfClosing'])) $depth++;
            elseif (($token['type'] ?? '') === 'end') $depth--;
            if ($depth === 0) {
                return ['end' => (int) $token['end'], 'closeStart' => (int) $token['start']];
            }
        }
        return null;
    }

    /**
     * @param list<array{type:string,name:string,start:int,end:int,source:string,selfClosing:bool}> $tokens
     */
    private function html_container_closing_offset(array $tokens, string $container): ?int {
        $template_depth = 0;
        foreach ($tokens as $index => $token) {
            $type = (string) ($token['type'] ?? '');
            $name = (string) ($token['name'] ?? '');
            if ($type === 'end' && $name === 'template') {
                $template_depth = max(0, $template_depth - 1);
                continue;
            }
            if (
                $type === 'start'
                && $name === $container
                && $template_depth === 0
                && empty($token['selfClosing'])
            ) {
                $match = $this->matching_html_element($tokens, $index);
                if ($match !== null) return (int) $match['closeStart'];
            }
            if ($type === 'start' && $name === 'template' && empty($token['selfClosing'])) $template_depth++;
        }
        return null;
    }

    private function replace_or_append_section(
        string $document,
        string $section_id,
        string $replacement
    ): array {
        $tokens = $this->html_tokens($document);
        $matches = [];
        foreach ($tokens as $index => $token) {
            if (($token['type'] ?? '') !== 'start') continue;
            $attributes = $this->html_start_tag_attributes((string) ($token['source'] ?? ''));
            if (($attributes['data-kodety-section-id'] ?? null) === $section_id) $matches[] = $index;
        }
        if (count($matches) > 1) {
            throw new InvalidArgumentException('A página possui mais de uma seção com o identificador ' . $section_id . '.');
        }
        if ($matches !== []) {
            $match = $this->matching_html_element($tokens, $matches[0]);
            if ($match === null) {
                throw new InvalidArgumentException('Não foi possível localizar o fechamento da seção ' . $section_id . '.');
            }
            $start = (int) $tokens[$matches[0]]['start'];
            $end = (int) $match['end'];
            return [substr($document, 0, $start) . $replacement . substr($document, $end), false];
        }

        $offset = $this->html_container_closing_offset($tokens, 'main');
        if ($offset === null) $offset = $this->html_container_closing_offset($tokens, 'body');
        if ($offset === null) {
            throw new InvalidArgumentException('A página não possui </main> ou </body> para receber uma nova seção.');
        }
        $separator = str_ends_with(substr($document, 0, $offset), "\n") ? '' : "\n";
        return [substr($document, 0, $offset) . $separator . $replacement . "\n" . substr($document, $offset), true];
    }

    /**
     * Coded projects keep their editable HTML in the build manifest. The
     * Builder hydrates that source after every download, so editing only the
     * generated page would produce a notification while restoring stale HTML.
     *
     * @return array{manifest:array<string,mixed>,document:string}|null
     */
    private function coded_build_original_document(string $page): ?array {
        $manifest_file = $this->project_file('.incode/coded-build.json');
        if (!is_file($manifest_file)) return null;
        $raw = file_get_contents($manifest_file);
        if (!is_string($raw) || $raw === '') return null;
        $manifest = json_decode($raw, true);
        if (
            !is_array($manifest)
            || !in_array((int) ($manifest['version'] ?? 0), [1, 2], true)
            || !is_array($manifest['originals'] ?? null)
            || !array_key_exists($page, $manifest['originals'])
            || !is_string($manifest['originals'][$page])
        ) {
            return null;
        }
        return [
            'manifest' => $manifest,
            'document' => $manifest['originals'][$page],
        ];
    }

    private function section_style_path(string $page, string $section_id): string {
        $page_key = preg_replace('/[^A-Za-z0-9_-]+/', '__', preg_replace('/\.html?$/i', '', $page)) ?: 'page';
        return 'styles/kodety-sections/' . trim($page_key, '_') . '--' . $section_id . '.css';
    }

    private function animation_document_path(string $page): string {
        return '.incode/animations/' . rawurlencode(str_replace('\\', '/', ltrim($page, '/'))) . '.json';
    }

    private function legacy_animation_document_path(string $page): string {
        $safe = preg_replace('/[^A-Za-z0-9._\/-]+/', '-', str_replace('\\', '/', $page));
        $safe = str_replace('/', '__', (string) $safe);
        $safe = trim($safe, '-.');
        return '.incode/animations/' . ($safe !== '' ? $safe : 'index.html') . '.json';
    }

    private function relative_href(string $from_directory, string $target): string {
        $from = $from_directory === '.' ? [] : array_values(array_filter(explode('/', trim($from_directory, '/')), 'strlen'));
        $to = array_values(array_filter(explode('/', trim($target, '/')), 'strlen'));
        while ($from && $to && $from[0] === $to[0]) {
            array_shift($from);
            array_shift($to);
        }
        return str_repeat('../', count($from)) . implode('/', $to);
    }

    private function ensure_section_stylesheet(string $document, string $section_id, string $href): string {
        $attribute = 'data-kodety-section-style="' . $section_id . '"';
        $link = '<link rel="stylesheet" href="' . $href . '" ' . $attribute . '>';
        $pattern = '/<link\b[^>]*\bdata-kodety-section-style\s*=\s*(["\'])'
            . preg_quote($section_id, '/') . '\1[^>]*>/i';
        if (preg_match($pattern, $document)) return (string) preg_replace($pattern, $link, $document, 1);
        if (!preg_match('/<\/head\s*>/i', $document, $head, PREG_OFFSET_CAPTURE)) {
            throw new InvalidArgumentException('A página não possui </head> para vincular o CSS da seção.');
        }
        $offset = (int) $head[0][1];
        return substr($document, 0, $offset) . '  ' . $link . "\n" . substr($document, $offset);
    }

    private function write_text_files_transaction(array $changes): array {
        $previous = [];
        $written = [];
        try {
            foreach ($changes as $relative => $content) {
                $relative = $this->relative_path((string) $relative);
                $this->assert_membership_workspace_mutation_allowed($relative);
                $this->assert_allowed_extension($relative);
                if (!is_string($content) || strlen($content) > self::MAX_TEXT_BYTES || !$this->is_text($relative)) {
                    throw new InvalidArgumentException('A transação de seção aceita apenas arquivos de texto de até 4 MB.');
                }
                $file = $this->project_file($relative);
                $directory = dirname($file);
                if (!wp_mkdir_p($directory) && !is_dir($directory)) throw new RuntimeException('Não foi possível criar a pasta da seção.');
                $file = $this->project_file($relative);
                $previous[$relative] = is_file($file) ? file_get_contents($file) : null;
                $temporary = tempnam($this->private_storage_root(), '.mcp-section-');
                if (!is_string($temporary)) throw new RuntimeException('Não foi possível preparar a seção para gravação.');
                try {
                    if (file_put_contents($temporary, $content, LOCK_EX) !== strlen($content)) {
                        throw new RuntimeException('Não foi possível gravar completamente a seção.');
                    }
                    @chmod($temporary, 0644 & ~umask());
                    if (!rename($temporary, $file)) throw new RuntimeException('Não foi possível ativar um arquivo da seção.');
                    $temporary = '';
                } finally {
                    if ($temporary !== '' && is_file($temporary)) unlink($temporary);
                }
                $written[$relative] = $file;
            }
        } catch (Throwable $error) {
            foreach ($written as $relative => $file) {
                $old = $previous[$relative] ?? null;
                if (is_string($old)) file_put_contents($file, $old, LOCK_EX);
                elseif (is_file($file)) unlink($file);
            }
            throw $error;
        }
        foreach ($written as $relative => $file) {
            Kodety_Plugin::instance()->mcp_sync_project_file($relative, $file);
        }
        return array_keys($written);
    }

    private function tool_delete_file(array $args): array {
        $this->assert_capability('edit_theme_options');
        $relative = $this->relative_path((string) ($args['path'] ?? ''));
        $this->assert_membership_workspace_mutation_allowed($relative);
        $this->lock_workspace();
        try {
        $this->assert_file_revision($args);
        $file = $this->project_file($relative);
        if (is_link($file) || !is_file($file) || !unlink($file)) throw new InvalidArgumentException('Arquivo não encontrado ou não removível.');
        Kodety_Plugin::instance()->mcp_delete_project_file($relative);
        $this->project_changed(['kind' => 'delete', 'paths' => [$relative]]);
        return [
            'deleted' => $relative,
            'revision' => (int) get_option(self::OPTION_REVISION, 0),
            'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0),
        ];
        } finally {
            $this->unlock_workspace();
        }
    }

    private function tool_list_content(array $args): array {
        $type = sanitize_key((string) ($args['postType'] ?? 'post'));
        $object = get_post_type_object($type);
        if (!$object || !$object->show_ui) throw new InvalidArgumentException('Tipo de conteúdo inválido.');
        $this->assert_capability((string) $object->cap->edit_posts);
        $query = new WP_Query(['post_type' => $type, 'post_status' => sanitize_key((string) ($args['status'] ?? 'any')), 's' => sanitize_text_field((string) ($args['search'] ?? '')), 'posts_per_page' => min(100, max(1, (int) ($args['limit'] ?? 50))), 'orderby' => 'modified', 'order' => 'DESC']);
        return array_map(fn(WP_Post $post): array => $this->post_data($post, false), $query->posts);
    }

    private function tool_get_content(array $args): array {
        $post = get_post(absint($args['id'] ?? 0));
        if (!$post instanceof WP_Post) throw new InvalidArgumentException('Conteúdo não encontrado.');
        $this->assert_capability('read_post', $post->ID);
        return $this->post_data($post, true);
    }

    private function tool_upsert_content(array $args): array {
        $id = absint($args['id'] ?? 0);
        $existing = $id ? get_post($id) : null;
        if ($id && !$existing instanceof WP_Post) throw new InvalidArgumentException('Conteúdo não encontrado.');
        $type = sanitize_key((string) ($args['postType'] ?? ($existing instanceof WP_Post ? $existing->post_type : 'post')));
        if ($existing instanceof WP_Post && $type !== $existing->post_type) throw new InvalidArgumentException('O tipo de um conteúdo existente não pode ser alterado pelo MCP.');
        $object = get_post_type_object($type);
        if (!$object || !$object->show_ui) throw new InvalidArgumentException('Tipo de conteúdo inválido.');
        $id ? $this->assert_capability('edit_post', $id) : $this->assert_capability((string) $object->cap->edit_posts);
        if (!$id && Kodety_Plugin::instance()->is_managed_collection($type)) {
            $limit_error = Kodety_Edition::item_limit_error($type);
            if ($limit_error) throw new RuntimeException($limit_error->get_error_message());
        }
        $postarr = ['ID' => $id, 'post_type' => $type];
        if (array_key_exists('title', $args)) $postarr['post_title'] = sanitize_text_field((string) $args['title']);
        if (array_key_exists('content', $args)) $postarr['post_content'] = wp_kses_post((string) $args['content']);
        if (array_key_exists('excerpt', $args)) $postarr['post_excerpt'] = wp_kses_post((string) $args['excerpt']);
        if (array_key_exists('slug', $args)) $postarr['post_name'] = sanitize_title((string) $args['slug']);
        if (isset($args['status'])) {
            $status = sanitize_key((string) $args['status']);
            if (!in_array($status, ['draft', 'pending', 'private', 'future', 'publish'], true)) throw new InvalidArgumentException('Status de conteúdo inválido.');
            if (in_array($status, ['private', 'future', 'publish'], true)) $this->assert_capability((string) $object->cap->publish_posts);
            $postarr['post_status'] = $status;
        }
        elseif (!$id) $postarr['post_status'] = 'draft';
        $result = wp_insert_post(wp_slash($postarr), true);
        if (is_wp_error($result)) throw new RuntimeException($result->get_error_message());
        foreach ((array) ($args['meta'] ?? []) as $key => $value) {
            $key = sanitize_key((string) $key);
            if ($key !== '' && !str_starts_with($key, '_')) update_post_meta((int) $result, $key, $this->sanitize_meta_value($value));
        }
        $this->changed();
        return $this->post_data(get_post((int) $result), true);
    }

    private function tool_delete_content(array $args): array {
        $id = absint($args['id'] ?? 0);
        if (!$id || !get_post($id)) throw new InvalidArgumentException('Conteúdo não encontrado.');
        $this->assert_capability('delete_post', $id);
        $deleted = !empty($args['force']) ? wp_delete_post($id, true) : wp_trash_post($id);
        if (!$deleted) throw new RuntimeException('Não foi possível remover o conteúdo.');
        $this->changed();
        return ['deleted' => $id, 'permanent' => !empty($args['force'])];
    }

    private function tool_create_collection(array $args): array {
        $this->assert_capability('manage_options');
        $name = sanitize_text_field((string) ($args['name'] ?? ''));
        $singular = sanitize_text_field((string) ($args['singular'] ?? $name));
        $url_slug = sanitize_title((string) ($args['slug'] ?? $name));
        $post_type = sanitize_key('kodety_' . str_replace('-', '_', $url_slug));
        if ($name === '' || $url_slug === '') throw new InvalidArgumentException('Informe o nome da coleção.');
        if (strlen($post_type) > 20) $post_type = substr($post_type, 0, 20);
        if (post_type_exists($post_type)) throw new InvalidArgumentException('Já existe uma coleção com este identificador.');
        $definitions = Kodety_Plugin::instance()->project_cms_option('kodety_collections', []);
        $definitions = is_array($definitions) ? $definitions : [];
        $previous_definitions = $definitions;
        $limit_error = Kodety_Edition::collection_limit_error(
            Kodety_Edition::visible_collection_definitions($definitions)
        );
        if ($limit_error) throw new RuntimeException($limit_error->get_error_message());
        $definition = ['slug' => $post_type, 'name' => $name, 'singular' => $singular, 'urlSlug' => $url_slug, 'fields' => []];
        $definitions[] = $definition;
        if (!Kodety_Plugin::instance()->update_project_cms_option(
            'kodety_collections',
            $definitions,
            $previous_definitions
        )) {
            throw new RuntimeException('O WordPress não confirmou a collection deste projeto.');
        }
        Kodety_Plugin::instance()->register_collections();
        flush_rewrite_rules(false);
        $this->changed();
        if (is_array($args['fields'] ?? null) && $args['fields'] !== []) return $this->tool_update_collection_fields(['postType' => $post_type, 'fields' => $args['fields']]);
        return $definition;
    }

    private function tool_list_collections(): array {
        $definitions = Kodety_Plugin::instance()->project_cms_option('kodety_collections', []);
        $definitions = is_array($definitions) ? array_values(array_filter($definitions, 'is_array')) : [];
        $field_sets = Kodety_Plugin::instance()->project_cms_option('kodety_field_definitions', []);
        $field_sets = is_array($field_sets) ? $field_sets : [];
        return array_map(static function (array $definition) use ($field_sets): array {
            $slug = sanitize_key((string) ($definition['slug'] ?? ''));
            return [
                'postType' => $slug,
                'name' => sanitize_text_field((string) ($definition['name'] ?? $slug)),
                'singular' => sanitize_text_field((string) ($definition['singular'] ?? $definition['name'] ?? $slug)),
                'urlSlug' => sanitize_title((string) ($definition['urlSlug'] ?? $definition['name'] ?? $slug)),
                'fields' => array_values((array) ($field_sets[$slug] ?? [])),
            ];
        }, $definitions);
    }

    private function tool_update_collection_fields(array $args): array {
        $this->assert_capability('manage_options');
        $post_type = sanitize_key((string) ($args['postType'] ?? ''));
        if ($post_type === '' || !post_type_exists($post_type)) throw new InvalidArgumentException('Collection inválida. Use list_collections primeiro.');
        $raw_fields = $args['fields'] ?? null;
        if (!is_array($raw_fields)) throw new InvalidArgumentException('Informe fields como uma lista.');
        $allowed = ['text', 'textarea', 'richtext', 'image', 'url', 'number', 'boolean', 'date', 'color'];
        $clean = [];
        foreach (array_slice($raw_fields, 0, 80) as $field) {
            if (!is_array($field)) continue;
            $name = sanitize_key((string) ($field['name'] ?? ''));
            $type = sanitize_key((string) ($field['type'] ?? 'text'));
            if ($name === '' || isset($clean[$name]) || !in_array($type, $allowed, true)) continue;
            $definition = [
                'name' => $name,
                'label' => sanitize_text_field((string) ($field['label'] ?? $name)),
                'type' => $type,
                'description' => sanitize_textarea_field((string) ($field['description'] ?? '')),
                'required' => rest_sanitize_boolean($field['required'] ?? false),
                'default' => $this->sanitize_field_default($type, $field['default'] ?? ''),
            ];
            if ($type === 'number') {
                $definition['min'] = is_numeric($field['min'] ?? null) ? (float) $field['min'] : '';
                $definition['max'] = is_numeric($field['max'] ?? null) ? (float) $field['max'] : '';
                $definition['step'] = is_numeric($field['step'] ?? null) && (float) $field['step'] > 0 ? (float) $field['step'] : 1;
                $definition['unit'] = substr(sanitize_text_field((string) ($field['unit'] ?? '')), 0, 20);
            }
            $clean[$name] = $definition;
        }
        $sets = Kodety_Plugin::instance()->project_cms_option('kodety_field_definitions', []);
        $sets = is_array($sets) ? $sets : [];
        $previous_sets = $sets;
        $sets[$post_type] = array_values($clean);
        if (!Kodety_Plugin::instance()->update_project_cms_option(
            'kodety_field_definitions',
            $sets,
            $previous_sets
        )) {
            throw new RuntimeException('O WordPress não confirmou os campos desta collection.');
        }
        $this->changed();
        foreach ($this->tool_list_collections() as $collection) if ($collection['postType'] === $post_type) return $collection;
        return ['postType' => $post_type, 'fields' => array_values($clean)];
    }

    private function sanitize_field_default(string $type, mixed $value): mixed {
        if ($type === 'boolean') return rest_sanitize_boolean($value);
        if ($type === 'number') return $value === '' || $value === null ? '' : (float) $value;
        if ($type === 'url') return esc_url_raw((string) $value);
        if ($type === 'image') {
            if (!is_array($value)) return esc_url_raw((string) $value);
            return [
                'url' => esc_url_raw((string) ($value['url'] ?? '')),
                'alt' => sanitize_text_field((string) ($value['alt'] ?? '')),
                'focalX' => max(0, min(100, (float) ($value['focalX'] ?? 50))),
                'focalY' => max(0, min(100, (float) ($value['focalY'] ?? 50))),
                'crop' => in_array(($crop = sanitize_key((string) ($value['crop'] ?? 'original'))), ['original', 'square', 'landscape', 'portrait'], true) ? $crop : 'original',
            ];
        }
        if ($type === 'textarea') return sanitize_textarea_field((string) $value);
        if ($type === 'richtext') return wp_kses_post((string) $value);
        if ($type === 'color') return sanitize_hex_color((string) $value) ?: '';
        if ($type === 'date') return preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $value) ? (string) $value : '';
        return sanitize_text_field((string) $value);
    }

    private function sanitize_meta_value(mixed $value): mixed {
        if (is_array($value)) return array_map([$this, 'sanitize_meta_value'], $value);
        if (is_bool($value) || is_int($value) || is_float($value) || $value === null) return $value;
        return wp_kses_post((string) $value);
    }

    private function tool_list_media(array $args): array {
        $this->assert_capability('upload_files');
        $query = new WP_Query(['post_type' => 'attachment', 'post_status' => 'inherit', 's' => sanitize_text_field((string) ($args['search'] ?? '')), 'posts_per_page' => min(100, max(1, (int) ($args['limit'] ?? 50))), 'orderby' => 'date', 'order' => 'DESC']);
        return array_map(fn(WP_Post $post): array => ['id' => $post->ID, 'title' => $post->post_title, 'mimeType' => $post->post_mime_type, 'url' => wp_get_attachment_url($post->ID), 'alt' => (string) get_post_meta($post->ID, '_wp_attachment_image_alt', true)], $query->posts);
    }

    private function tool_upload_media(array $args): array {
        $this->assert_capability('upload_files');
        $filename = sanitize_file_name((string) ($args['filename'] ?? ''));
        $encoded = (string) ($args['base64'] ?? '');
        if (strlen($encoded) > (int) ceil(self::MAX_FILE_BYTES * 4 / 3) + 8) throw new InvalidArgumentException('Mídia acima de 25 MB.');
        $bytes = base64_decode($encoded, true);
        if ($filename === '' || $bytes === false) throw new InvalidArgumentException('Informe filename e base64 válidos.');
        $maximum = min(self::MAX_FILE_BYTES, (int) wp_max_upload_size());
        if (strlen($bytes) > $maximum) throw new InvalidArgumentException('Mídia acima do limite permitido pelo WordPress.');
        if (function_exists('upload_is_user_over_quota') && upload_is_user_over_quota()) throw new RuntimeException('A cota de armazenamento deste site foi atingida.');
        $declared_type = wp_check_filetype($filename, get_allowed_mime_types());
        if (empty($declared_type['ext']) || empty($declared_type['type'])) throw new InvalidArgumentException('Formato de mídia não permitido.');
        $upload = wp_upload_bits($filename, null, $bytes);
        if (!empty($upload['error'])) throw new RuntimeException((string) $upload['error']);
        $id = 0;
        try {
            $checked = wp_check_filetype_and_ext($upload['file'], $filename, get_allowed_mime_types());
            if (empty($checked['ext']) || empty($checked['type'])) throw new InvalidArgumentException('O conteúdo do arquivo não corresponde a um tipo de mídia permitido.');
            $id = wp_insert_attachment([
                'post_mime_type' => $checked['type'],
                'post_title' => sanitize_text_field((string) ($args['title'] ?? pathinfo($filename, PATHINFO_FILENAME))),
                'post_status' => 'inherit',
            ], $upload['file'], 0, true);
            if (is_wp_error($id)) throw new RuntimeException($id->get_error_message());
            if (!function_exists('wp_generate_attachment_metadata')) require_once ABSPATH . 'wp-admin/includes/image.php';
            $metadata = wp_generate_attachment_metadata((int) $id, $upload['file']);
            if (wp_attachment_is_image((int) $id) && !is_array($metadata)) {
                throw new RuntimeException('Não foi possível gerar os metadados da imagem.');
            }
            if (is_array($metadata)) wp_update_attachment_metadata((int) $id, $metadata);
            if (isset($args['alt'])) update_post_meta((int) $id, '_wp_attachment_image_alt', sanitize_text_field((string) $args['alt']));
            if (!empty($args['projectPath'])) {
                $this->tool_write_file(['path' => (string) $args['projectPath'], 'content' => base64_encode($bytes), 'encoding' => 'base64'] + array_intersect_key($args, ['baseRevision' => true]));
            } else {
                $this->changed();
            }
            return ['id' => (int) $id, 'url' => wp_get_attachment_url((int) $id), 'filename' => basename((string) $upload['file'])];
        } catch (Throwable $error) {
            if ($id) wp_delete_attachment((int) $id, true);
            elseif (is_file((string) ($upload['file'] ?? ''))) unlink((string) $upload['file']);
            throw $error;
        }
    }

    private function tool_publish(): array {
        $this->assert_capability('kodety_publish');
        $release = Kodety_Plugin::instance()->mcp_publish_current_project();
        $this->changed();
        return ['release' => $release, 'siteUrl' => home_url('/')];
    }

    private function post_data(WP_Post $post, bool $full): array {
        $data = ['id' => $post->ID, 'postType' => $post->post_type, 'status' => $post->post_status, 'title' => get_the_title($post), 'slug' => $post->post_name, 'modified' => get_post_modified_time('c', true, $post), 'url' => get_permalink($post)];
        if ($full) $data += ['content' => $post->post_content, 'excerpt' => $post->post_excerpt, 'meta' => array_filter(get_post_meta($post->ID), static fn($key): bool => !str_starts_with((string) $key, '_'), ARRAY_FILTER_USE_KEY)];
        return $data;
    }

    private function project_root(): string {
        $workspace = $this->private_storage_root() . '/workspace';
        if (is_link($workspace)) throw new RuntimeException('O workspace privado não pode ser um link simbólico.');
        if (!is_dir($workspace)) return $workspace;
        $items = array_values(array_filter(scandir($workspace) ?: [], static fn(string $item): bool => !in_array($item, ['.', '..', '__MACOSX', '.DS_Store'], true)));
        if (count($items) === 1 && is_dir($workspace . '/' . $items[0]) && !is_link($workspace . '/' . $items[0])) {
            return $workspace . '/' . $items[0];
        }
        return $workspace;
    }

    /**
     * Membership HTML is stored as a scrubbed document plus an authenticated
     * private snapshot. The MCP cannot currently recompile that pair, so
     * allowing it to mutate either side would publish stale policy or discard
     * the edit on the next Builder hydration.
     */
    private function assert_membership_workspace_mutation_allowed(string $relative): void {
        $artifact = $this->project_root() . '/.incode/membership/runtime.json';
        if (!is_file($artifact)) return;
        $normalized = ltrim(str_replace('\\', '/', $relative), '/');
        if (
            preg_match('/\.html?$/i', $normalized)
            || $normalized === '.incode/project.json'
            || str_starts_with($normalized, '.incode/membership/')
        ) {
            throw new RuntimeException(
                'Este projeto usa Área de Membros. Edite HTML e regras de acesso no Builder para que o conteúdo privado seja recompilado com segurança.'
            );
        }
    }

    private function private_storage_root(): string {
        $uploads = wp_get_upload_dir();
        if (!empty($uploads['error']) || empty($uploads['basedir'])) throw new RuntimeException('O workspace privado do Onun Kodety não está disponível.');
        $private = trailingslashit((string) $uploads['basedir']) . 'kodety/private';
        if (!is_dir($private) || !is_writable($private)) throw new RuntimeException('O armazenamento privado do Onun Kodety não está gravável.');
        return untrailingslashit($private);
    }

    private function project_file(string $relative): string {
        $root = $this->project_root();
        $root_real = realpath($root);
        if (!is_string($root_real) || !is_dir($root_real)) throw new RuntimeException('Nenhum workspace de rascunho Onun Kodety está instalado.');
        $segments = explode('/', $relative);
        $current = $root_real;
        foreach (array_slice($segments, 0, -1) as $segment) {
            $candidate = $current . '/' . $segment;
            if (!file_exists($candidate) && !is_link($candidate)) {
                $current = $candidate;
                continue;
            }
            if (is_link($candidate) || !is_dir($candidate)) throw new InvalidArgumentException('O caminho atravessa um item inseguro do workspace.');
            $resolved = realpath($candidate);
            if (!is_string($resolved) || !$this->path_is_within($resolved, $root_real)) throw new InvalidArgumentException('O caminho sai do workspace permitido.');
            $current = $resolved;
        }
        $file = $root_real . '/' . $relative;
        if (is_link($file)) throw new InvalidArgumentException('Links simbólicos não podem ser operados pelo MCP.');
        return $file;
    }

    private function relative_path(string $path, bool $allow_empty = false): string {
        $normalized = str_replace('\\', '/', $path);
        // Canonical Interactions filenames intentionally contain percent
        // escapes (for example `pages%2Fabout.html.json`). They are literal
        // filename bytes, not an encoded directory separator.
        $path = str_starts_with(trim($normalized, '/'), '.incode/animations/')
            ? trim($normalized, '/')
            : trim(str_replace('\\', '/', rawurldecode($normalized)), '/');
        if ($path === '' && $allow_empty) return '';
        if ($path === '' || strlen($path) > 1024 || str_contains($path, "\0")) throw new InvalidArgumentException('Caminho de projeto inválido.');
        $segments = explode('/', $path);
        foreach ($segments as $index => $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..' || strlen($segment) > 255 || preg_match('/[\x00-\x1F<>:"|?*]/', $segment)) {
                throw new InvalidArgumentException('Caminho de projeto inválido.');
            }
            if (str_starts_with($segment, '.') && !($index === 0 && $segment === '.incode')) {
                throw new InvalidArgumentException('Arquivos ocultos não podem ser operados pelo MCP.');
            }
        }
        return implode('/', $segments);
    }

    private function assert_allowed_extension(string $relative): void {
        $allowed = ['html','htm','css','js','mjs','json','svg','txt','xml','webmanifest','map','png','jpg','jpeg','gif','webp','avif','ico','mp4','webm','mp3','wav','ogg','pdf','woff','woff2','ttf','otf'];
        if (!in_array(strtolower(pathinfo($relative, PATHINFO_EXTENSION)), $allowed, true)) throw new InvalidArgumentException('Formato bloqueado no projeto MCP.');
    }

    private function is_text(string $relative): bool {
        return in_array(strtolower(pathinfo($relative, PATHINFO_EXTENSION)), ['html','htm','css','js','mjs','json','svg','txt','xml','webmanifest','map'], true);
    }

    private function path_is_within(string $path, string $root): bool {
        $path = wp_normalize_path($path);
        $root = untrailingslashit(wp_normalize_path($root));
        return $path === $root || str_starts_with($path, trailingslashit($root));
    }

    private function assert_capability(string $capability, mixed ...$arguments): void {
        if ($capability === '' || !current_user_can($capability, ...$arguments)) {
            throw new RuntimeException('A conta responsável pelo MCP não possui permissão para esta operação.', 403);
        }
    }

    /** Older REST integrations may omit the revision; current MCP schemas
     * require it. Whenever supplied, check under the shared workspace lock. */
    private function assert_file_revision(array $args): void {
        if (!array_key_exists('baseRevision', $args)) return;
        if (!is_int($args['baseRevision']) || $args['baseRevision'] < 0) {
            throw new InvalidArgumentException('baseRevision deve ser um inteiro não negativo.');
        }
        $current = (int) get_option('kodety_workspace_revision', 0);
        if ($args['baseRevision'] !== $current) {
            throw new RuntimeException('Conflito de revisão: o workspace mudou. Leia kodety_get_site e o arquivo novamente.', 409);
        }
    }

    /** @return resource */
    private function lock_project_connections() {
        $uploads = wp_get_upload_dir();
        if (!empty($uploads['error']) || empty($uploads['basedir'])) {
            throw new RuntimeException('O armazenamento das conexões MCP não está disponível.');
        }
        $directory = trailingslashit((string) $uploads['basedir']) . 'kodety';
        if (!is_dir($directory) && !wp_mkdir_p($directory)) {
            throw new RuntimeException('Não foi possível preparar o lock das conexões MCP.');
        }
        $handle = fopen(trailingslashit($directory) . '.mcp-connections.lock', 'c+');
        if (!is_resource($handle) || !flock($handle, LOCK_EX)) {
            if (is_resource($handle)) fclose($handle);
            throw new RuntimeException('Não foi possível bloquear as conexões MCP para editar com segurança.');
        }
        return $handle;
    }

    /** @param resource $handle */
    private function unlock_project_connections($handle): void {
        flock($handle, LOCK_UN);
        fclose($handle);
    }

    private function lock_workspace(): void {
        if ($this->workspace_lock_depth > 0) {
            $this->workspace_lock_depth++;
            return;
        }
        $handle = fopen(dirname($this->private_storage_root()) . '/.workspace.lock', 'c+');
        if (!is_resource($handle) || !flock($handle, LOCK_EX)) {
            if (is_resource($handle)) fclose($handle);
            throw new RuntimeException('Não foi possível bloquear o workspace para editar com segurança.');
        }
        $this->workspace_lock_handle = $handle;
        $this->workspace_lock_depth = 1;
        try {
            // A previous PHP worker may have died between the delta directory
            // swap and its durable ACK. Recover while holding the shared flock,
            // before this MCP command resolves or mutates a workspace path.
            Kodety_Plugin::instance()->recover_project_delta_for_locked_writer();
        } catch (Throwable $error) {
            $this->workspace_lock_depth = 0;
            $this->workspace_lock_handle = null;
            flock($handle, LOCK_UN);
            fclose($handle);
            throw $error;
        }
    }

    private function unlock_workspace(): void {
        if ($this->workspace_lock_depth <= 0) return;
        $this->workspace_lock_depth--;
        if ($this->workspace_lock_depth > 0) return;
        $handle = $this->workspace_lock_handle;
        $this->workspace_lock_handle = null;
        if (!is_resource($handle)) return;
        flock($handle, LOCK_UN);
        fclose($handle);
    }

    private function one_time_token_key(): string {
        return hash('sha256', wp_salt('auth') . wp_salt('nonce'), true);
    }

    private function protect_one_time_token(string $token): string {
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            return 'sodium:' . base64_encode($nonce . sodium_crypto_secretbox($token, $nonce, $this->one_time_token_key()));
        }
        if (!function_exists('openssl_encrypt')) throw new RuntimeException('Não há criptografia disponível para entregar a credencial MCP.');
        $iv = random_bytes(12);
        $tag = '';
        $encrypted = openssl_encrypt($token, 'aes-256-gcm', $this->one_time_token_key(), OPENSSL_RAW_DATA, $iv, $tag);
        if (!is_string($encrypted)) throw new RuntimeException('Não foi possível proteger a credencial MCP.');
        return 'openssl:' . base64_encode($iv . $tag . $encrypted);
    }

    private function unprotect_one_time_token(string $stored): string {
        if (str_starts_with($stored, 'sodium:') && function_exists('sodium_crypto_secretbox_open')) {
            $raw = base64_decode(substr($stored, 7), true);
            if (!is_string($raw) || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return '';
            $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $token = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $this->one_time_token_key());
            return is_string($token) && preg_match('/^kodety_[a-f0-9]{48}$/D', $token) ? $token : '';
        }
        if (str_starts_with($stored, 'openssl:') && function_exists('openssl_decrypt')) {
            $raw = base64_decode(substr($stored, 8), true);
            if (!is_string($raw) || strlen($raw) <= 28) return '';
            $token = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $this->one_time_token_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
            return is_string($token) && preg_match('/^kodety_[a-f0-9]{48}$/D', $token) ? $token : '';
        }
        return '';
    }

    private function changed(): void {
        update_option(self::OPTION_REVISION, (int) get_option(self::OPTION_REVISION, 0) + 1, false);
    }

    private function current_activity_id(): string {
        $local_activity_ids = array_keys($this->inflight_activities);
        $activity_id = $local_activity_ids !== []
            ? sanitize_key((string) $local_activity_ids[array_key_last($local_activity_ids)])
            : '';
        if ($activity_id === '') {
            $activity = get_option(self::OPTION_ACTIVITY, null);
            $activity_id = is_array($activity) ? sanitize_key((string) ($activity['id'] ?? '')) : '';
        }
        return $activity_id;
    }

    private function project_changed(array $change = []): void {
        $this->changed();
        $workspace_revision = (int) get_option('kodety_workspace_revision', 0) + 1;
        update_option('kodety_workspace_revision', $workspace_revision, false);
        update_option('kodety_draft_updated_at', current_time('c'), false);
        update_option(self::OPTION_LAST_CHANGE, array_merge([
            'revision' => (int) get_option(self::OPTION_REVISION, 0),
            'workspaceRevision' => $workspace_revision,
            'activityId' => $this->current_activity_id(),
            'kind' => 'project',
            'paths' => [],
            'changedAt' => current_time('c'),
        ], $change), false);
    }
}
