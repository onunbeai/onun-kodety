<?php

defined('ABSPATH') || exit;

if (!class_exists('Kodety_Edition')) require_once __DIR__ . '/class-kodety-edition.php';
require_once __DIR__ . '/class-kodety-agent-network.php';

/**
 * Authenticated WordPress facade for local and hosted Codex runtimes.
 *
 * The browser never receives the bridge secret, filesystem roots or a raw App
 * Server transport. WordPress resolves those values from the signed-in user
 * and forwards only the small method surface required by the Builder UI.
 */
final class Kodety_Agents {
    private static ?self $instance = null;

    private const OPTION_BRIDGE_PID = 'kodety_agent_bridge_pid';
    private const OPTION_START_LOCK = 'kodety_agent_bridge_start_lock';
    private const OPTION_INSTALL_LOCK = 'kodety_agent_runtime_install_lock';
    private const OPTION_RUNTIME_VERSION = 'kodety_agent_runtime_version';
    private const OPTION_DATA_DIR = 'kodety_agent_private_data_dir';
    private const OPTION_EXECUTION_DIR = 'kodety_agent_private_execution_dir';
    private const OPTION_TRANSPORT = 'kodety_agent_transport';
    private const EXPECTED_BRIDGE_VERSION = '1.0.4';
    private const START_BACKOFF = 'kodety_agent_bridge_start_backoff';
    private const START_STALL_SECONDS = 90;
    private const RETRY_PATH = 'config/retry';
    private const USER_META_PREFERENCES = 'kodety_agent_preferences';
    private const DEFAULT_MODEL = 'gpt-5.6-sol';
    private const ALLOWED_MODELS = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'];
    private const DEFAULT_EFFORT = 'medium';
    private const DEFAULT_SKILLS = ['kodety-editor'];
    private const SKILLS_SELECTION_VERSION = 2;
    private const LEGACY_DEFAULT_SKILLS = [
        'kodety-editor', 'kodety-widgets', 'figma', 'figma-design-to-code',
        'figma:figma-design-to-code', 'figma-use', 'figma:figma-use',
    ];
    private const MAX_PROXY_BODY_BYTES = 8_388_608;
    private const MAX_PROXY_RESPONSE_BYTES = 12_582_912;
    private const MAX_SKILL_BYTES = 5_242_880;
    private const MAX_SKILL_FILES = 100;
    private const MAX_USER_SKILLS = 24;
    private const MAX_USER_SKILL_BYTES = 26_214_400;
    private const MAX_ATTACHMENT_BYTES = 10_485_760;
    private const MAX_ATTACHMENT_TEXT_BYTES = 2_097_152;
    private const MAX_ATTACHMENTS_PER_TURN = 6;
    private const MAX_USER_ATTACHMENT_BYTES = 52_428_800;
    private const ATTACHMENT_TTL_SECONDS = 604_800;
    private const SKILL_LOCK_SECONDS = 90;
    private const MIN_RUNTIME_FREE_BYTES = 734_003_200;
    private const RUNTIME_DOWNLOAD_CHUNK_BYTES = 2_097_152;
    private const RUNTIME_DOWNLOAD_TIMEOUT = 20;
    private const RUNTIME_DOWNLOAD_FALLBACK_TIMEOUT = 300;
    private const RUNTIME_DOWNLOAD_RETRY_AFTER_MS = 1000;
    private const RUNTIME_INSTALL_TTL = 86_400;

    private ?WP_Error $runtime_provision_error = null;
    private ?array $runtime_provision_progress = null;
    private bool $runtime_probe_retry = false;
    /** @var array<string,string> Validated for this PHP request only. */
    private array $runtime_executables = [];
    private ?string $validated_node_path = null;

    /** @var array<string,true> */
    private const RPC_METHODS = [
        'account/read' => true,
        'account/rateLimits/read' => true,
        'account/login/start' => true,
        'account/login/cancel' => true,
        'account/logout' => true,
        'model/list' => true,
        'skills/list' => true,
        'skills/config/write' => true,
        'thread/list' => true,
        'thread/read' => true,
        'thread/start' => true,
        'thread/resume' => true,
        'thread/name/set' => true,
        'thread/archive' => true,
        'turn/start' => true,
        'turn/interrupt' => true,
        'figma/status' => true,
        'figma/install' => true,
    ];

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    public static function activate(): void {
        try {
            $instance = self::instance();
            if ($instance->remote_mode() || $instance->browser_runtime_unavailable() !== null) return;
            $instance->bridge_secret();
            $instance->runtime_root();
            update_option(self::OPTION_RUNTIME_VERSION, defined('KODETY_VERSION') ? KODETY_VERSION : '', false);
        } catch (Throwable) {
            // Hosts without a writable private directory can still activate the
            // plugin. GET /agents/config reports the unavailable runtime.
        }
    }

    public static function deactivate(): void {
        $instance = self::instance();
        if (!$instance->remote_mode() && $instance->browser_runtime_unavailable() === null) $instance->stop_bridge();
        delete_option(self::OPTION_INSTALL_LOCK);
        delete_option(self::OPTION_RUNTIME_VERSION);
    }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action('init', [$this, 'handle_runtime_upgrade'], 1);
        add_action('upgrader_process_complete', [$this, 'handle_upgrader_complete'], 10, 2);
    }

    public function register_routes(): void {
        (new Kodety_Agent_Network($this))->register_routes();
        register_rest_route('kodety/v1', '/agents/config', [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [$this, 'config'],
                'permission_callback' => [$this, 'can_read_config'],
            ],
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [$this, 'save_config'],
                'permission_callback' => [$this, 'can_use_agents'],
            ],
        ]);
        register_rest_route('kodety/v1', '/agents/config/retry', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'retry_config'],
            'permission_callback' => [$this, 'can_use_agents'],
        ]);
        register_rest_route('kodety/v1', '/agents/remote/session', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'remote_session'],
            'permission_callback' => [$this, 'can_create_remote_session'],
        ]);
        register_rest_route('kodety/v1', '/agents/transport', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'set_transport'],
            'permission_callback' => [$this, 'can_change_transport'],
        ]);
        register_rest_route('kodety/v1', '/agents/rpc', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'rpc'],
            'permission_callback' => [$this, 'can_use_agents'],
        ]);
        register_rest_route('kodety/v1', '/agents/events', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'events'],
            'permission_callback' => [$this, 'can_use_agents'],
        ]);
        register_rest_route('kodety/v1', '/agents/respond', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'respond'],
            'permission_callback' => [$this, 'can_use_agents'],
        ]);
        register_rest_route('kodety/v1', '/agents/attachments', [
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [$this, 'upload_attachment'],
                'permission_callback' => [$this, 'can_use_agents'],
            ],
            [
                'methods' => WP_REST_Server::DELETABLE,
                'callback' => [$this, 'delete_attachment'],
                'permission_callback' => [$this, 'can_use_agents'],
            ],
        ]);
        register_rest_route('kodety/v1', '/agents/skills', [
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [$this, 'install_skill'],
                'permission_callback' => [$this, 'can_manage_skills'],
            ],
            [
                'methods' => WP_REST_Server::DELETABLE,
                'callback' => [$this, 'delete_skill'],
                'permission_callback' => [$this, 'can_manage_skills'],
            ],
        ]);
    }

    public function handle_runtime_upgrade(): void {
        if ($this->remote_mode() || $this->browser_runtime_unavailable() !== null) return;
        $current = defined('KODETY_VERSION') ? (string) KODETY_VERSION : '';
        $stored = (string) get_option(self::OPTION_RUNTIME_VERSION, '');
        if (
            ($stored !== '' && !hash_equals($stored, $current))
            || ($stored === '' && get_option(self::OPTION_BRIDGE_PID, false) !== false)
        ) {
            $this->stop_bridge();
        }
        if ($stored !== $current) update_option(self::OPTION_RUNTIME_VERSION, $current, false);
    }

    public function handle_upgrader_complete(mixed $upgrader, mixed $details): void {
        if ($this->remote_mode() || $this->browser_runtime_unavailable() !== null) return;
        if (!is_array($details) || ($details['type'] ?? '') !== 'plugin' || ($details['action'] ?? '') !== 'update') {
            return;
        }
        $targets = [];
        if (is_string($details['plugin'] ?? null)) $targets[] = $details['plugin'];
        if (is_array($details['plugins'] ?? null)) $targets = array_merge($targets, $details['plugins']);
        $basename = function_exists('plugin_basename') ? plugin_basename(KODETY_FILE) : basename(KODETY_DIR) . '/kodety.php';
        if (!in_array($basename, array_filter($targets, 'is_string'), true)) return;
        $this->stop_bridge();
        // The callback still executes the PHP code loaded before the update.
        // Leave the marker empty so the next request records the new version.
        delete_option(self::OPTION_RUNTIME_VERSION);
    }

    public function can_read_config(): bool {
        return is_user_logged_in()
            && current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE)
            && current_user_can(Kodety_Plugin::CAP_USE_AI);
    }

    public function can_use_agents(): bool|WP_Error {
        return $this->can_read_config();
    }

    public function can_manage_skills(): bool|WP_Error {
        return $this->can_use_agents();
    }

    public function can_create_remote_session(WP_REST_Request $request): bool|WP_Error {
        $allowed = $this->can_use_agents();
        if ($allowed !== true) return $allowed;
        $nonce = (string) $request->get_header('X-WP-Nonce');
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error('rest_cookie_invalid_nonce', 'Atualize o Builder para renovar sua sessão.', ['status' => 403]);
        }
        return true;
    }

    private function remote_mode(): bool {
        // Code Cloud was replaced by the browser runtime. Old database options
        // and gateway constants must not silently send server-mode work there.
        // WebContainers execute in the client and do not use these PHP routes.
        return false;
    }

    /** Detect the live PHP-WASM runtime, never an exported database marker. */
    private function browser_runtime_unavailable(): ?WP_Error {
        $browser_runtime = defined('KODETY_BROWSER_STUDIO_RUNTIME')
            && is_string(KODETY_BROWSER_STUDIO_RUNTIME) && KODETY_BROWSER_STUDIO_RUNTIME !== '';
        if (!$browser_runtime && !in_array(strtolower(PHP_OS), ['emscripten', 'wasi'], true)) return null;
        return new WP_Error(
            'kodety_agents_browser_runtime',
            'O WordPress está rodando no navegador e não pode iniciar o processo local do Codex App Server.',
            ['status' => 503]
        );
    }

    public function can_change_transport(WP_REST_Request $request): bool|WP_Error {
        $allowed = $this->can_create_remote_session($request);
        if ($allowed !== true) return $allowed;
        if (!current_user_can('manage_options')) {
            return new WP_Error('kodety_agents_transport_forbidden', 'Somente o administrador pode alterar o transporte do servidor.', ['status' => 403]);
        }
        return true;
    }

    public function set_transport(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $allowed = $this->can_change_transport($request);
        if ($allowed !== true) return is_wp_error($allowed) ? $allowed : new WP_Error('rest_forbidden', 'Acesso negado.', ['status' => 403]);
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        if (count($body) !== 1 || ($body['transport'] ?? null) !== 'local') {
            return new WP_Error('kodety_agents_transport_invalid', 'A execução no navegador é configurada diretamente no Builder.', ['status' => 400]);
        }
        update_option(self::OPTION_TRANSPORT, $body['transport'], false);
        return $this->config();
    }

    private function remote_gateway_url(): WP_Error {
        return new WP_Error('kodety_agents_remote_disabled', 'O serviço comercial de sessões foi removido. Use a execução local ou no navegador.', ['status' => 410]);
    }

    private function local_transport_disabled(): WP_Error {
        return new WP_Error('kodety_agents_remote_transport', 'Esta instalação usa o serviço remoto do Agent. Reconecte pelo Builder.', ['status' => 409]);
    }

    public function remote_session(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $allowed = $this->can_create_remote_session($request);
        if ($allowed !== true) return is_wp_error($allowed) ? $allowed : new WP_Error('rest_forbidden', 'Acesso negado.', ['status' => 403]);
        return $this->remote_gateway_url();
    }

    public function config(): WP_REST_Response {
        $licensed = true;
        $preferences = $this->preferences();
        $remote = $this->remote_mode();
        if ($remote) {
            $gateway = $this->remote_gateway_url();
            $progress = null;
            $health = !$licensed ? new WP_Error('kodety_agents_unlicensed', 'O runtime requer uma licença ativa.')
                : (is_wp_error($gateway) ? $gateway : ['ok' => true, 'version' => '']);
        } else {
            $browser_error = $this->browser_runtime_unavailable();
            $provision_error = $browser_error ?? $this->runtime_provision_error;
            $progress = $licensed && $browser_error === null
                ? ($this->runtime_provision_progress ?? $this->current_runtime_installation()) : null;
            if (
                $progress !== null
                && is_wp_error($provision_error)
                && $provision_error->get_error_code() === 'kodety_agents_runtime_install_busy'
            ) {
                $progress['message'] = 'O servidor continua preparando este componente…';
                $progress['retryAfterMs'] = 2000;
            }
            $this->runtime_provision_error = null;
            $this->runtime_provision_progress = null;
            $retry_native = $this->runtime_probe_retry;
            $health = $licensed
                ? ($provision_error ?? ($progress !== null
                    ? new WP_Error('kodety_agents_runtime_install_busy', 'Preparação em etapas.')
                    : $this->bridge_health(true)))
                : new WP_Error('kodety_agents_unlicensed', 'O runtime requer uma licença ativa.');
            if (!is_wp_error($health)) $health = $this->codex_readiness($retry_native);
            $this->runtime_probe_retry = false;
            if (is_wp_error($health) && in_array($health->get_error_code(), ['kodety_agents_codex_starting', 'kodety_agents_start_in_progress'], true)) {
                $native = $health->get_error_code() === 'kodety_agents_codex_starting';
                $progress = [
                    'phase' => $native ? 'start_codex' : 'start_bridge',
                    'message' => $native
                        ? 'Iniciando e verificando o Codex; a preparação continuará até ele responder…'
                        : 'Iniciando o serviço local do Agent; a preparação continuará até ele responder…',
                    'step' => $native ? 10 : 9,
                    'stepCount' => 10,
                    'downloadedBytes' => 0,
                    'totalBytes' => null,
                    'retryAfterMs' => 1000,
                ];
            }
        }
        $available = !is_wp_error($health);
        $payload = [
            'transport' => $remote ? 'remote' : 'local',
            'transportOptions' => [
                'canChange' => false,
                'selected' => $remote ? 'remote' : 'local',
                'browserLabel' => 'No navegador',
            ],
            'enabled' => $licensed,
            'available' => $available,
            'licenseRequired' => !$licensed,
            'licenseUrl' => Kodety_Edition::license_url(),
            'upgradeUrl' => Kodety_Edition::upgrade_url(),
            'bridgeVersion' => $available ? (string) ($health['version'] ?? '') : '',
            'defaultModel' => $preferences['model'],
            'defaultEffort' => $preferences['effort'],
            'enabledSkills' => $preferences['enabledSkills'],
            'canManageSkills' => $licensed,
            'retryPath' => self::RETRY_PATH,
            'skillUpload' => [
                'format' => 'files-base64',
                'maxBytes' => self::MAX_SKILL_BYTES,
                'maxFiles' => self::MAX_SKILL_FILES,
                'maxSkills' => self::MAX_USER_SKILLS,
                'maxTotalBytes' => self::MAX_USER_SKILL_BYTES,
            ],
            'attachmentUpload' => [
                'format' => 'multipart',
                'accept' => ['.txt', '.doc', '.docx', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'],
                'maxBytes' => self::MAX_ATTACHMENT_BYTES,
                'maxTextBytes' => self::MAX_ATTACHMENT_TEXT_BYTES,
                'maxFilesPerTurn' => self::MAX_ATTACHMENTS_PER_TURN,
                'maxTotalBytes' => self::MAX_USER_ATTACHMENT_BYTES,
                'ttlSeconds' => self::ATTACHMENT_TTL_SECONDS,
            ],
            'project' => [
                'id' => sanitize_key((string) get_option('kodety_workspace_project_id', '')),
                'name' => substr(sanitize_text_field((string) get_option('kodety_project_name', 'Projeto atual')), 0, 160),
                'workspaceRevision' => (int) get_option('kodety_workspace_revision', 0),
            ],
        ];
        if ($remote) $payload['remote'] = ['sessionPath' => 'remote/session'];
        if (!$available && is_wp_error($health)) {
            $diagnostics = $remote && $health->get_error_code() === 'kodety_agents_remote_config'
                ? ['code' => 'remote_config', 'message' => $health->get_error_message(), 'action' => 'Peça ao administrador para verificar a configuração do serviço remoto.', 'retryable' => false, 'retryPath' => self::RETRY_PATH]
                : $this->public_runtime_diagnostics($health);
            $payload['unavailableReason'] = $diagnostics['code'];
            $payload['runtimeDiagnostics'] = $diagnostics;
        }
        if ($progress !== null) $payload['runtimeInstallation'] = $progress;
        $response = new WP_REST_Response($payload);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $response;
    }

    /**
     * Explicit recovery endpoint for the Agent panel. GET /config already
     * performs a best-effort start; retry additionally clears the short
     * failure backoff so the user does not have to wait after fixing a host
     * dependency such as Node or the Codex binary.
     */
    public function retry_config(): WP_REST_Response {
        if ($this->remote_mode() || $this->browser_runtime_unavailable() !== null) return $this->config();
        $this->runtime_probe_retry = true;
        delete_transient(self::START_BACKOFF);
        $locked_at = (int) get_option(self::OPTION_START_LOCK, 0);
        if ($locked_at > 0 && $locked_at < time() - 20) delete_option(self::OPTION_START_LOCK);
        if (Kodety_Edition::has('ai') && $this->managed_runtime_enabled()) {
            try {
                $prepared = $this->ensure_managed_runtime();
                if (is_wp_error($prepared)) $this->runtime_provision_error = $prepared;
                elseif (is_array($prepared)) $this->runtime_provision_progress = $prepared;
            } catch (Throwable) {
                $this->runtime_provision_error = new WP_Error(
                    'kodety_agents_bridge_config',
                    'Não foi possível preparar o armazenamento privado do Agent.',
                    ['status' => 503]
                );
            }
        }
        return $this->config();
    }

    public function save_config(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        $current = $this->preferences();
        $model = array_key_exists('model', $body) && is_string($body['model'])
            ? trim($body['model'])
            : (array_key_exists('model', $body) ? '' : $current['model']);
        if (!in_array($model, self::ALLOWED_MODELS, true)) {
            return new WP_Error('kodety_agents_model_invalid', 'Use Astra, Sol, Terra, Luna ou GPT-5.5.', ['status' => 400]);
        }
        $effort = array_key_exists('effort', $body) && is_string($body['effort'])
            ? $body['effort']
            : (array_key_exists('effort', $body) ? '' : $current['effort']);
        if (!in_array($effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], true)) {
            return new WP_Error('kodety_agents_effort_invalid', 'O nível de raciocínio selecionado é inválido.', ['status' => 400]);
        }
        $enabled_skills = $current['enabledSkills'];
        if (array_key_exists('enabledSkills', $body)) {
            if (!is_array($body['enabledSkills'])) {
                return new WP_Error('kodety_agents_skills_invalid', 'A seleção de skills é inválida.', ['status' => 400]);
            }
            $enabled_skills = [];
            foreach (array_slice($body['enabledSkills'], 0, 16) as $candidate) {
                $name = $this->skill_name($candidate);
                if ($name !== '') $enabled_skills[] = $name;
            }
            $enabled_skills = array_values(array_unique($enabled_skills));
        }
        // The editor integration is a permanent capability of Agent mode. It
        // remains active even when the user deselects optional skills.
        if (!in_array('kodety-editor', $enabled_skills, true)) array_unshift($enabled_skills, 'kodety-editor');
        $preferences = [
            'model' => $model,
            'effort' => $effort,
            'enabledSkills' => $enabled_skills,
            'skillsSelectionVersion' => self::SKILLS_SELECTION_VERSION,
        ];
        update_user_meta(get_current_user_id(), self::USER_META_PREFERENCES, $preferences);
        $response = new WP_REST_Response([
            'success' => true,
            'defaultModel' => $model,
            'defaultEffort' => $effort,
            'enabledSkills' => $enabled_skills,
        ]);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $response;
    }

    public function rpc(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if ($this->remote_mode()) return $this->local_transport_disabled();
        $browser_error = $this->browser_runtime_unavailable();
        if ($browser_error !== null) return $this->runtime_rest_error($browser_error);
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        $method = isset($body['method']) && is_string($body['method']) ? trim($body['method']) : '';
        if (!isset(self::RPC_METHODS[$method])) {
            return new WP_Error(
                'kodety_agents_method_forbidden',
                'Esta operação do App Server não está disponível no Builder.',
                ['status' => 403]
            );
        }
        $params = $body['params'] ?? [];
        if (!is_array($params)) {
            return new WP_Error('kodety_agents_params_invalid', 'Os parâmetros da operação são inválidos.', ['status' => 400]);
        }
        if ($method === 'thread/start' || $method === 'thread/resume' || $method === 'turn/start') {
            $preferences = $this->preferences();
            if (!is_string($params['model'] ?? null) || trim($params['model']) === '') {
                $params['model'] = $preferences['model'];
            }
            if ($method === 'turn/start') {
                if (!is_string($params['effort'] ?? null) || trim($params['effort']) === '') {
                    $params['effort'] = $preferences['effort'];
                }
                $skills = is_array($params['skills'] ?? null) ? $params['skills'] : $preferences['enabledSkills'];
                $skills = array_values(array_unique(array_filter(
                    array_map([$this, 'skill_name'], array_slice($skills, 0, 16))
                )));
                if (!in_array('kodety-editor', $skills, true)) array_unshift($skills, 'kodety-editor');
                $params['skills'] = $skills;
                $attachments = is_array($params['attachments'] ?? null)
                    ? array_values($params['attachments'])
                    : [];
                if (count($attachments) > self::MAX_ATTACHMENTS_PER_TURN) {
                    return new WP_Error(
                        'kodety_agents_attachment_count',
                        'Envie no máximo ' . self::MAX_ATTACHMENTS_PER_TURN . ' anexos por mensagem.',
                        ['status' => 400, 'maxFiles' => self::MAX_ATTACHMENTS_PER_TURN]
                    );
                }
                $attachment_ids = [];
                foreach ($attachments as $candidate) {
                    $attachment_id = $this->attachment_id($candidate);
                    if ($attachment_id === '') {
                        return new WP_Error('kodety_agents_attachment_invalid', 'Um dos anexos é inválido.', ['status' => 400]);
                    }
                    $attachment_ids[] = $attachment_id;
                }
                $params['attachments'] = array_values(array_unique($attachment_ids));
            }
        }
        $timeout = $method === 'figma/install' ? 125 : ($method === 'turn/start' ? 60 : 35);
        return $this->proxy('/rpc', ['method' => $method, 'params' => $params], $timeout);
    }

    public function events(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if ($this->remote_mode()) return $this->local_transport_disabled();
        $browser_error = $this->browser_runtime_unavailable();
        if ($browser_error !== null) return $this->runtime_rest_error($browser_error);
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        $thread_id = isset($body['threadId']) && is_string($body['threadId']) ? trim($body['threadId']) : '';
        if (!preg_match('/^[A-Za-z0-9_-]{8,160}$/D', $thread_id)) {
            return new WP_Error('kodety_agents_thread_invalid', 'A sessão do Agent é inválida.', ['status' => 400]);
        }
        $cursor = isset($body['cursor']) && is_numeric($body['cursor']) ? max(0, (int) $body['cursor']) : 0;
        return $this->proxy('/events', ['threadId' => $thread_id, 'cursor' => $cursor], 20);
    }

    public function respond(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if ($this->remote_mode()) return $this->local_transport_disabled();
        $browser_error = $this->browser_runtime_unavailable();
        if ($browser_error !== null) return $this->runtime_rest_error($browser_error);
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        $request_id = isset($body['requestId']) && is_string($body['requestId']) ? trim($body['requestId']) : '';
        if (!preg_match('/^[A-Za-z0-9._:-]{1,180}$/D', $request_id)) {
            return new WP_Error('kodety_agents_request_invalid', 'A solicitação do Agent é inválida.', ['status' => 400]);
        }
        $result = $body['result'] ?? [];
        if (!is_array($result)) {
            return new WP_Error('kodety_agents_response_invalid', 'A resposta da aprovação é inválida.', ['status' => 400]);
        }
        return $this->proxy('/respond', ['requestId' => $request_id, 'result' => $result], 25);
    }

    public function upload_attachment(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if ($this->remote_mode()) return $this->local_transport_disabled();
        $browser_error = $this->browser_runtime_unavailable();
        if ($browser_error !== null) return $this->runtime_rest_error($browser_error);
        $files = $request->get_file_params();
        $file = is_array($files['file'] ?? null) ? $files['file'] : null;
        if (!$file) {
            return new WP_Error('kodety_agents_attachment_missing', 'Selecione um arquivo para anexar.', ['status' => 400]);
        }
        $validated = $this->validate_attachment_upload($file);
        if (is_wp_error($validated)) return $validated;

        try {
            $runtime = $this->runtime_context();
            $root = $this->attachment_root($runtime);
            $this->cleanup_attachments($root);
            $used = $this->directory_bytes($root, self::MAX_USER_ATTACHMENT_BYTES + self::MAX_ATTACHMENT_BYTES);
            if ($used + $validated['size'] > self::MAX_USER_ATTACHMENT_BYTES) {
                return new WP_Error(
                    'kodety_agents_attachment_quota',
                    'O armazenamento privado de anexos deste projeto atingiu o limite.',
                    ['status' => 413, 'maxTotalBytes' => self::MAX_USER_ATTACHMENT_BYTES]
                );
            }
            $id = bin2hex(random_bytes(16));
            $target = $root . '/' . $id . '.' . $validated['extension'];
            $metadata_path = $root . '/' . $id . '.json';
            if (!is_uploaded_file($validated['tmpName']) || !@move_uploaded_file($validated['tmpName'], $target)) {
                return new WP_Error('kodety_agents_attachment_move', 'Não foi possível guardar o anexo com segurança.', ['status' => 500]);
            }
            @chmod($target, 0600);
            $sha256 = hash_file('sha256', $target);
            if (!is_string($sha256) || !preg_match('/^[a-f0-9]{64}$/D', $sha256)) {
                @unlink($target);
                return new WP_Error('kodety_agents_attachment_hash', 'Não foi possível verificar o anexo.', ['status' => 500]);
            }
            $metadata = [
                'version' => 1,
                'id' => $id,
                'name' => $validated['name'],
                'mime' => $validated['mime'],
                'kind' => $validated['kind'],
                'extension' => $validated['extension'],
                'size' => $validated['size'],
                'sha256' => $sha256,
                'createdAt' => time(),
            ];
            $encoded = wp_json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $temporary_metadata = $root . '/.' . $id . '.json.tmp';
            if (
                !is_string($encoded)
                || @file_put_contents($temporary_metadata, $encoded, LOCK_EX) === false
                || !@rename($temporary_metadata, $metadata_path)
            ) {
                @unlink($temporary_metadata);
                @unlink($target);
                return new WP_Error('kodety_agents_attachment_metadata', 'Não foi possível concluir o anexo.', ['status' => 500]);
            }
            @chmod($metadata_path, 0600);
        } catch (Throwable) {
            return new WP_Error('kodety_agents_attachment_storage', 'O armazenamento privado de anexos não está disponível.', ['status' => 503]);
        }

        $response = new WP_REST_Response(['attachment' => $this->public_attachment_metadata($metadata)]);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $response;
    }

    public function delete_attachment(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if ($this->remote_mode()) return $this->local_transport_disabled();
        $browser_error = $this->browser_runtime_unavailable();
        if ($browser_error !== null) return $this->runtime_rest_error($browser_error);
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        $id = $this->attachment_id($body['attachmentId'] ?? '');
        if ($id === '') {
            return new WP_Error('kodety_agents_attachment_invalid', 'O anexo é inválido.', ['status' => 400]);
        }
        try {
            $root = $this->attachment_root($this->runtime_context());
            $metadata_path = $root . '/' . $id . '.json';
            $metadata = $this->read_attachment_metadata($metadata_path);
            if (is_array($metadata)) {
                $extension = $this->attachment_extension($metadata['extension'] ?? '');
                if ($extension !== '') @unlink($root . '/' . $id . '.' . $extension);
            } else {
                foreach (['txt', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'gif'] as $extension) {
                    @unlink($root . '/' . $id . '.' . $extension);
                }
            }
            @unlink($metadata_path);
        } catch (Throwable) {
            return new WP_Error('kodety_agents_attachment_storage', 'O armazenamento privado de anexos não está disponível.', ['status' => 503]);
        }
        $response = new WP_REST_Response(['ok' => true, 'attachmentId' => $id]);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $response;
    }

    public function install_skill(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if ($this->remote_mode()) return $this->local_transport_disabled();
        $browser_error = $this->browser_runtime_unavailable();
        if ($browser_error !== null) return $this->runtime_rest_error($browser_error);
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        $name = $this->uploaded_skill_name($body['name'] ?? '');
        if ($name === '' || in_array(strtolower($name), ['figma', 'kodety-site-code', 'kodety-editor', 'kodety-widgets', 'kodety-motion', 'kodety-performance', 'kodety-languages'], true)) {
            return new WP_Error('kodety_agents_skill_name', 'Use um nome exclusivo para a skill.', ['status' => 400]);
        }
        $files = is_array($body['files'] ?? null) ? array_values($body['files']) : [];
        $validated = $this->validate_skill_files($files);
        if (is_wp_error($validated)) return $validated;
        $lock = $this->acquire_skill_lock();
        if (is_wp_error($lock)) return $lock;
        try {
            $quota = $this->check_skill_quota($name, $validated['bytes']);
            if (is_wp_error($quota)) return $quota;
            $response = $this->proxy('/skills/install', ['name' => $name, 'files' => $files], 45);
            if (!is_wp_error($response)) {
                $data = $response->get_data();
                if (is_array($data)) {
                    unset($data['path']);
                    $response->set_data($data);
                }
            }
            return $response;
        } finally {
            $this->release_skill_lock($lock);
        }
    }

    public function delete_skill(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if ($this->remote_mode()) return $this->local_transport_disabled();
        $browser_error = $this->browser_runtime_unavailable();
        if ($browser_error !== null) return $this->runtime_rest_error($browser_error);
        $body = $this->json_body($request);
        if (is_wp_error($body)) return $body;
        $name = $this->uploaded_skill_name($body['name'] ?? '');
        if ($name === '' || in_array(strtolower($name), ['figma', 'kodety-site-code', 'kodety-editor', 'kodety-widgets', 'kodety-motion', 'kodety-performance', 'kodety-languages'], true)) {
            return new WP_Error('kodety_agents_skill_protected', 'Esta skill padrão não pode ser removida.', ['status' => 400]);
        }
        $lock = $this->acquire_skill_lock();
        if (is_wp_error($lock)) return $lock;
        try {
            return $this->proxy('/skills/delete', ['name' => $name], 30);
        } finally {
            $this->release_skill_lock($lock);
        }
    }

    /** @return array<string,mixed>|WP_Error */
    private function json_body(WP_REST_Request $request): array|WP_Error {
        $raw = $request->get_body();
        if (strlen($raw) > self::MAX_PROXY_BODY_BYTES) {
            return new WP_Error('kodety_agents_payload_too_large', 'A solicitação ultrapassa o limite permitido.', ['status' => 413]);
        }
        $body = $request->get_json_params();
        if (!is_array($body)) {
            return new WP_Error('kodety_agents_json_invalid', 'Envie um objeto JSON válido.', ['status' => 400]);
        }
        return $body;
    }

    private function skill_name(mixed $value): string {
        $name = is_string($value) ? trim($value) : '';
        return preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/D', $name) ? $name : '';
    }

    private function uploaded_skill_name(mixed $value): string {
        $name = is_string($value) ? trim($value) : '';
        return preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/D', $name) ? $name : '';
    }

    private function attachment_id(mixed $value): string {
        $id = is_string($value) ? strtolower(trim($value)) : '';
        return preg_match('/^[a-f0-9]{32}$/D', $id) ? $id : '';
    }

    private function attachment_extension(mixed $value): string {
        $extension = is_string($value) ? strtolower(trim($value)) : '';
        return in_array($extension, ['txt', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'gif'], true)
            ? $extension
            : '';
    }

    /**
     * @param array<string,mixed> $file
     * @return array{name:string,tmpName:string,size:int,extension:string,mime:string,kind:string}|WP_Error
     */
    private function validate_attachment_upload(array $file): array|WP_Error {
        $error = is_numeric($file['error'] ?? null) ? (int) $file['error'] : UPLOAD_ERR_NO_FILE;
        if ($error !== UPLOAD_ERR_OK) {
            return new WP_Error('kodety_agents_attachment_upload', 'O upload do anexo não foi concluído.', ['status' => 400]);
        }
        $tmp_name = is_string($file['tmp_name'] ?? null) ? $file['tmp_name'] : '';
        $original_name = is_string($file['name'] ?? null) ? $file['name'] : '';
        $basename = basename(str_replace('\\', '/', str_replace("\0", '', $original_name)));
        $extension = $this->attachment_extension(pathinfo($basename, PATHINFO_EXTENSION));
        if ($tmp_name === '' || !is_file($tmp_name) || !is_readable($tmp_name) || $extension === '') {
            return new WP_Error(
                'kodety_agents_attachment_type',
                'Use TXT, DOC, DOCX, PNG, JPEG, WebP ou GIF.',
                ['status' => 415]
            );
        }
        $size = @filesize($tmp_name);
        if (!is_int($size) || $size < 1 || $size > self::MAX_ATTACHMENT_BYTES) {
            return new WP_Error(
                'kodety_agents_attachment_size',
                'O anexo deve ter no máximo 10 MB.',
                ['status' => 413, 'maxBytes' => self::MAX_ATTACHMENT_BYTES]
            );
        }
        if ($extension === 'txt' && $size > self::MAX_ATTACHMENT_TEXT_BYTES) {
            return new WP_Error(
                'kodety_agents_attachment_text_size',
                'O arquivo TXT deve ter no máximo 2 MB.',
                ['status' => 413, 'maxBytes' => self::MAX_ATTACHMENT_TEXT_BYTES]
            );
        }

        $handle = @fopen($tmp_name, 'rb');
        $header = is_resource($handle) ? (string) fread($handle, 65_536) : '';
        if (is_resource($handle)) fclose($handle);
        $mime = '';
        if (class_exists('finfo')) {
            $detector = new finfo(FILEINFO_MIME_TYPE);
            $detected = @$detector->file($tmp_name);
            if (is_string($detected)) $mime = strtolower(trim($detected));
        } elseif (function_exists('mime_content_type')) {
            $detected = @mime_content_type($tmp_name);
            if (is_string($detected)) $mime = strtolower(trim($detected));
        }

        $kind = '';
        if (in_array($extension, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true)) {
            $image = @getimagesize($tmp_name);
            $image_mime = is_array($image) && is_string($image['mime'] ?? null) ? strtolower($image['mime']) : '';
            $expected = [
                'png' => 'image/png',
                'jpg' => 'image/jpeg',
                'jpeg' => 'image/jpeg',
                'webp' => 'image/webp',
                'gif' => 'image/gif',
            ][$extension];
            if ($image_mime !== $expected) {
                return new WP_Error('kodety_agents_attachment_image', 'A imagem anexada é inválida.', ['status' => 415]);
            }
            $mime = $expected;
            $kind = 'image';
            if ($extension === 'jpeg') $extension = 'jpg';
        } elseif ($extension === 'txt') {
            $utf16 = str_starts_with($header, "\xFF\xFE") || str_starts_with($header, "\xFE\xFF");
            if (str_contains($header, "\0") && !$utf16) {
                return new WP_Error('kodety_agents_attachment_text', 'O arquivo TXT contém dados binários.', ['status' => 415]);
            }
            $mime = 'text/plain';
            $kind = 'text';
        } elseif ($extension === 'docx') {
            if (!str_starts_with($header, "PK\x03\x04") && !str_starts_with($header, "PK\x05\x06")) {
                return new WP_Error('kodety_agents_attachment_docx', 'O arquivo DOCX é inválido.', ['status' => 415]);
            }
            if (class_exists('ZipArchive')) {
                $archive = new ZipArchive();
                $opened = @$archive->open($tmp_name);
                $valid_docx = $opened === true
                    && $archive->locateName('[Content_Types].xml') !== false
                    && $archive->locateName('word/document.xml') !== false;
                if ($opened === true) $archive->close();
                if (!$valid_docx) {
                    return new WP_Error('kodety_agents_attachment_docx', 'O arquivo DOCX não contém um documento Word válido.', ['status' => 415]);
                }
            }
            $mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            $kind = 'docx';
        } else {
            $ole_signature = "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1";
            if (!str_starts_with($header, $ole_signature)) {
                return new WP_Error('kodety_agents_attachment_doc', 'O arquivo DOC é inválido.', ['status' => 415]);
            }
            $mime = 'application/msword';
            $kind = 'doc';
        }

        $name = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $basename) ?: ('anexo.' . $extension);
        $name = trim(preg_replace('/\s+/u', ' ', $name) ?: $name);
        if (function_exists('mb_substr')) $name = mb_substr($name, 0, 180);
        else $name = substr($name, 0, 180);
        if ($name === '') $name = 'anexo.' . $extension;

        return [
            'name' => $name,
            'tmpName' => $tmp_name,
            'size' => $size,
            'extension' => $extension,
            'mime' => $mime,
            'kind' => $kind,
        ];
    }

    /** @param array{cwd:string} $runtime */
    private function attachment_root(array $runtime): string {
        $cwd = is_string($runtime['cwd'] ?? null) ? untrailingslashit($runtime['cwd']) : '';
        if (!$this->absolute_path($cwd)) throw new RuntimeException('O workspace privado do Agent é inválido.');
        $root = $cwd . '/.attachments';
        if (!is_dir($root) && !wp_mkdir_p($root)) {
            throw new RuntimeException('Não foi possível preparar os anexos do Agent.');
        }
        @chmod($root, 0700);
        $resolved = realpath($root);
        if (!is_string($resolved) || !$this->path_is_within($resolved, $cwd)) {
            throw new RuntimeException('O diretório de anexos do Agent é inválido.');
        }
        return untrailingslashit($this->normalize_filesystem_path($resolved));
    }

    /** @return array<string,mixed>|null */
    private function read_attachment_metadata(string $path): ?array {
        if (!is_file($path) || is_link($path)) return null;
        $size = @filesize($path);
        if (!is_int($size) || $size < 2 || $size > 8192) return null;
        $decoded = json_decode((string) @file_get_contents($path), true);
        return is_array($decoded) ? $decoded : null;
    }

    /** @param array<string,mixed> $metadata */
    private function public_attachment_metadata(array $metadata): array {
        return [
            'id' => $this->attachment_id($metadata['id'] ?? ''),
            'name' => is_string($metadata['name'] ?? null) ? substr($metadata['name'], 0, 180) : 'Anexo',
            'mime' => is_string($metadata['mime'] ?? null) ? substr($metadata['mime'], 0, 120) : '',
            'kind' => in_array($metadata['kind'] ?? '', ['image', 'text', 'doc', 'docx'], true) ? $metadata['kind'] : 'text',
            'size' => max(0, (int) ($metadata['size'] ?? 0)),
        ];
    }

    private function cleanup_attachments(string $root): void {
        $entries = @scandir($root);
        if (!is_array($entries)) return;
        $cutoff = time() - self::ATTACHMENT_TTL_SECONDS;
        $known = [];
        foreach ($entries as $entry) {
            if (!preg_match('/^([a-f0-9]{32})\.json$/D', $entry, $match)) continue;
            $metadata_path = $root . '/' . $entry;
            $metadata = $this->read_attachment_metadata($metadata_path);
            $id = $match[1];
            $created_at = is_array($metadata) ? (int) ($metadata['createdAt'] ?? 0) : 0;
            if ($created_at >= $cutoff) {
                $known[$id] = true;
                continue;
            }
            $extension = is_array($metadata) ? $this->attachment_extension($metadata['extension'] ?? '') : '';
            if ($extension !== '') @unlink($root . '/' . $id . '.' . $extension);
            @unlink($metadata_path);
        }
        foreach ($entries as $entry) {
            if (!preg_match('/^([a-f0-9]{32})\.(txt|doc|docx|png|jpe?g|webp|gif)$/D', $entry, $match)) continue;
            if (isset($known[$match[1]])) continue;
            $path = $root . '/' . $entry;
            $modified = @filemtime($path);
            if (!is_int($modified) || $modified < $cutoff) @unlink($path);
        }
    }

    /** @return array{model:string,effort:string,enabledSkills:list<string>} */
    private function preferences(): array {
        $stored = get_user_meta(get_current_user_id(), self::USER_META_PREFERENCES, true);
        $stored = is_array($stored) ? $stored : [];
        $model = is_string($stored['model'] ?? null) ? trim($stored['model']) : '';
        if (!in_array($model, self::ALLOWED_MODELS, true)) $model = self::DEFAULT_MODEL;
        $effort = is_string($stored['effort'] ?? null) ? $stored['effort'] : '';
        if (!in_array($effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], true)) {
            $effort = self::DEFAULT_EFFORT;
        }
        $enabled_skills = [];
        foreach (is_array($stored['enabledSkills'] ?? null) ? array_slice($stored['enabledSkills'], 0, 16) : [] as $candidate) {
            $name = $this->skill_name($candidate);
            if ($name !== '') $enabled_skills[] = $name;
        }
        $enabled_skills = array_values(array_unique($enabled_skills));
        // Migrate only the former automatic selection, without resetting custom skills.
        if ((int) ($stored['skillsSelectionVersion'] ?? 0) < self::SKILLS_SELECTION_VERSION
            && in_array('kodety-editor', $enabled_skills, true)
            && in_array('kodety-widgets', $enabled_skills, true)
            && !array_diff($enabled_skills, self::LEGACY_DEFAULT_SKILLS)
        ) {
            $enabled_skills = self::DEFAULT_SKILLS;
        }
        if (!$enabled_skills) $enabled_skills = self::DEFAULT_SKILLS;
        if (!in_array('kodety-editor', $enabled_skills, true)) array_unshift($enabled_skills, 'kodety-editor');
        return [
            'model' => $model,
            'effort' => $effort,
            'enabledSkills' => $enabled_skills,
        ];
    }

    /**
     * @param list<mixed> $files
     * @return array{bytes:int}|WP_Error
     */
    private function validate_skill_files(array $files): array|WP_Error {
        if (!$files || count($files) > self::MAX_SKILL_FILES) {
            return new WP_Error('kodety_agents_skill_files', 'A skill possui uma quantidade inválida de arquivos.', ['status' => 400]);
        }
        $total = 0;
        $paths = [];
        $has_manifest = false;
        foreach ($files as $file) {
            if (!is_array($file)) {
                return new WP_Error('kodety_agents_skill_file', 'A skill contém um arquivo inválido.', ['status' => 400]);
            }
            $path = isset($file['path']) && is_string($file['path'])
                ? str_replace('\\', '/', trim($file['path']))
                : '';
            $path = preg_replace('#^\./#', '', $path) ?: '';
            $segments = $path === '' ? [] : explode('/', $path);
            if (
                $path === ''
                || strlen($path) > 220
                || str_starts_with($path, '/')
                || str_contains($path, "\0")
                || array_filter($segments, static fn(string $segment): bool => $segment === '' || $segment === '.' || $segment === '..')
                || isset($paths[strtolower($path)])
            ) {
                return new WP_Error('kodety_agents_skill_path', 'A skill contém um caminho inseguro ou duplicado.', ['status' => 400]);
            }
            $encoded = isset($file['contentBase64']) && is_string($file['contentBase64'])
                ? $file['contentBase64']
                : '';
            $decoded = base64_decode($encoded, true);
            if (!is_string($decoded) || str_contains($decoded, "\0")) {
                return new WP_Error('kodety_agents_skill_content', 'A skill contém dados inválidos ou binários.', ['status' => 400]);
            }
            $total += strlen($decoded);
            if ($total > self::MAX_SKILL_BYTES) {
                return new WP_Error('kodety_agents_skill_size', 'A skill ultrapassa o limite de 5 MB.', ['status' => 413]);
            }
            $paths[strtolower($path)] = true;
            if ($path === 'SKILL.md') $has_manifest = true;
        }
        if (!$has_manifest) {
            return new WP_Error('kodety_agents_skill_manifest', 'A skill precisa ter SKILL.md na raiz.', ['status' => 400]);
        }
        return ['bytes' => $total];
    }

    /** @return array{name:string,token:string}|WP_Error */
    private function acquire_skill_lock(): array|WP_Error {
        $user_id = get_current_user_id();
        if ($user_id < 1) {
            return new WP_Error('kodety_agents_skill_identity', 'A identidade do editor não está disponível.', ['status' => 403]);
        }
        $name = 'kodety_agent_skill_lock_' . $user_id;
        try {
            $token = bin2hex(random_bytes(16));
        } catch (Throwable) {
            return new WP_Error('kodety_agents_skill_lock', 'Não foi possível proteger esta operação de skill.', ['status' => 503]);
        }
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $value = ['token' => $token, 'expires' => time() + self::SKILL_LOCK_SECONDS];
            if (add_option($name, $value, '', false)) return ['name' => $name, 'token' => $token];
            $current = get_option($name, []);
            if (!is_array($current) || (int) ($current['expires'] ?? 0) >= time()) break;
            delete_option($name);
        }
        return new WP_Error(
            'kodety_agents_skill_busy',
            'Outra operação de skill ainda está em andamento. Tente novamente em instantes.',
            ['status' => 409]
        );
    }

    /** @param array{name:string,token:string} $lock */
    private function release_skill_lock(array $lock): void {
        $current = get_option($lock['name'], []);
        if (
            is_array($current)
            && is_string($current['token'] ?? null)
            && hash_equals($lock['token'], $current['token'])
        ) {
            delete_option($lock['name']);
        }
    }

    private function check_skill_quota(string $incoming_name, int $incoming_bytes): bool|WP_Error {
        $user_id = get_current_user_id();
        if ($user_id < 1) {
            return new WP_Error('kodety_agents_skill_identity', 'A identidade do editor não está disponível.', ['status' => 403]);
        }
        try {
            $root = $this->runtime_root() . '/user-' . $user_id . '/uploaded-skills';
            if (!is_dir($root)) return true;
            $entries = @scandir($root);
            if (!is_array($entries)) {
                return new WP_Error('kodety_agents_skill_quota_unavailable', 'Não foi possível validar a quota de skills.', ['status' => 503]);
            }
            $count = 0;
            $total = 0;
            $replacing_bytes = 0;
            foreach ($entries as $entry) {
                if ($entry === '.' || $entry === '..') continue;
                $skill_path = $root . '/' . $entry;
                if (is_link($skill_path)) continue;
                $bytes = is_dir($skill_path)
                    ? $this->directory_bytes($skill_path, self::MAX_USER_SKILL_BYTES + self::MAX_SKILL_BYTES)
                    : (is_file($skill_path) ? max(0, (int) @filesize($skill_path)) : 0);
                $total += $bytes;
                if ($this->uploaded_skill_name($entry) === '' || !is_dir($skill_path)) continue;
                $count++;
                if ($entry === $incoming_name) $replacing_bytes = $bytes;
                if ($total > self::MAX_USER_SKILL_BYTES + self::MAX_SKILL_BYTES) break;
            }
            $is_replacement = is_dir($root . '/' . $incoming_name) && !is_link($root . '/' . $incoming_name);
            if (!$is_replacement && $count >= self::MAX_USER_SKILLS) {
                return new WP_Error(
                    'kodety_agents_skill_count_quota',
                    'Você atingiu o limite de skills locais deste usuário.',
                    ['status' => 409, 'maxSkills' => self::MAX_USER_SKILLS]
                );
            }
            if ($total - $replacing_bytes + $incoming_bytes > self::MAX_USER_SKILL_BYTES) {
                return new WP_Error(
                    'kodety_agents_skill_storage_quota',
                    'Você atingiu o limite de armazenamento para skills locais.',
                    ['status' => 413, 'maxTotalBytes' => self::MAX_USER_SKILL_BYTES]
                );
            }
            return true;
        } catch (Throwable) {
            return new WP_Error('kodety_agents_skill_quota_unavailable', 'Não foi possível validar a quota de skills.', ['status' => 503]);
        }
    }

    private function directory_bytes(string $directory, int $stop_after): int {
        $total = 0;
        $visited = 0;
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iterator as $file) {
            if (++$visited > 5_000) return $stop_after + 1;
            if (!$file instanceof SplFileInfo || $file->isLink() || !$file->isFile()) continue;
            $size = $file->getSize();
            if (is_int($size) && $size > 0) $total += $size;
            if ($total > $stop_after) break;
        }
        return $total;
    }

    private function proxy(string $path, array $body, int $timeout): WP_REST_Response|WP_Error {
        try {
            $payload = array_merge($body, [
                'userId' => (string) get_current_user_id(),
                'runtime' => $this->runtime_context(),
            ]);
        } catch (Throwable) {
            return $this->runtime_rest_error(new WP_Error('kodety_agents_bridge_config', '', ['status' => 503]));
        }
        $encoded = wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($encoded) || strlen($encoded) > self::MAX_PROXY_BODY_BYTES) {
            return new WP_Error('kodety_agents_payload_too_large', 'A solicitação ultrapassa o limite permitido.', ['status' => 413]);
        }
        $response = $this->bridge_request($path, 'POST', $encoded, $timeout, true);
        if (is_wp_error($response)) return $this->runtime_rest_error($response);
        $decoded = $this->decode_bridge_response($response);
        if (is_wp_error($decoded)) return $this->runtime_rest_error($decoded);
        $rest = new WP_REST_Response($decoded);
        $rest->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        return $rest;
    }

    /** @return array<string,mixed>|WP_Error */
    private function bridge_health(bool $start_if_missing): array|WP_Error {
        $response = $this->bridge_request('/health', 'GET', null, 2, $start_if_missing);
        if (is_wp_error($response)) return $response;
        $decoded = $this->decode_bridge_response($response);
        if (is_wp_error($decoded)) return $decoded;
        if (
            $start_if_missing
            && !hash_equals(self::EXPECTED_BRIDGE_VERSION, (string) ($decoded['version'] ?? ''))
        ) {
            $this->stop_bridge();
            $response = $this->bridge_request('/health', 'GET', null, 2, true);
            if (is_wp_error($response)) return $response;
            $decoded = $this->decode_bridge_response($response);
            if (is_wp_error($decoded)) return $decoded;
        }
        if (empty($decoded['ok'])) {
            return new WP_Error('kodety_agents_bridge_unhealthy', 'O runtime local não está pronto.', ['status' => 503]);
        }
        if (!hash_equals(self::EXPECTED_BRIDGE_VERSION, (string) ($decoded['version'] ?? ''))) {
            return new WP_Error('kodety_agents_bridge_version', 'O runtime local precisa ser atualizado.', ['status' => 503]);
        }
        return $decoded;
    }

    /** Readiness is user-scoped and non-blocking, unlike a socket-only health check. */
    private function codex_readiness(bool $retry): array|WP_Error {
        try {
            $body = wp_json_encode([
                'userId' => (string) get_current_user_id(),
                'runtime' => $this->runtime_context(),
                'retry' => $retry,
            ]);
        } catch (Throwable) {
            return new WP_Error('kodety_agents_bridge_config', 'Configuração privada indisponível.', ['status' => 503]);
        }
        if (!is_string($body)) return new WP_Error('kodety_agents_bridge_config', 'Configuração inválida.', ['status' => 503]);
        $response = $this->bridge_request('/ready', 'POST', $body, 2, false);
        if (is_wp_error($response)) return $response;
        $ready = $this->decode_bridge_response($response);
        if (is_wp_error($ready)) return $ready;
        if (!hash_equals(self::EXPECTED_BRIDGE_VERSION, (string) ($ready['version'] ?? ''))) {
            return new WP_Error('kodety_agents_bridge_version', 'Atualização do serviço necessária.', ['status' => 503]);
        }
        if (($ready['state'] ?? '') === 'ready' && ($ready['ok'] ?? false) === true) return $ready;
        if (($ready['state'] ?? '') === 'starting') {
            return new WP_Error('kodety_agents_codex_starting', 'O Codex está iniciando.', ['status' => 503]);
        }
        if (($ready['state'] ?? '') === 'stalled') {
            return new WP_Error(
                'kodety_agents_codex_start_stalled',
                'O Codex parou de responder durante a inicialização.',
                ['status' => 503]
            );
        }
        $code = (string) ($ready['code'] ?? '');
        if ($code === 'codex_start_timeout') {
            return new WP_Error('kodety_agents_codex_starting', 'O Codex continua iniciando.', ['status' => 503]);
        }
        if (!in_array($code, ['codex_exec_failed', 'codex_permission_profile', 'codex_start_failed'], true)) {
            $code = 'codex_start_failed';
        }
        return new WP_Error('kodety_agents_' . $code, 'O Codex não ficou pronto.', ['status' => 503]);
    }

    private function bridge_request(
        string $path,
        string $method,
        ?string $body,
        int $timeout,
        bool $start_if_missing
    ): array|WP_Error {
        try {
            $url = $this->bridge_endpoint($path);
            $secret = $this->bridge_secret();
        } catch (Throwable $error) {
            return new WP_Error('kodety_agents_bridge_config', $error->getMessage(), ['status' => 503]);
        }
        $args = [
            'method' => $method,
            'timeout' => max(1, $timeout),
            'redirection' => 0,
            'reject_unsafe_urls' => false,
            'limit_response_size' => self::MAX_PROXY_RESPONSE_BYTES,
            'headers' => [
                'Accept' => 'application/json',
                'Authorization' => 'Bearer ' . $secret,
            ],
        ];
        if ($body !== null) {
            $args['headers']['Content-Type'] = 'application/json; charset=utf-8';
            $args['body'] = $body;
            $args['data_format'] = 'body';
        }
        $response = wp_remote_request($url, $args);
        if (is_wp_error($response) && $start_if_missing) {
            $started = $this->maybe_start_bridge();
            if (is_wp_error($started)) return $started;
            $response = wp_remote_request($url, $args);
        }
        if (is_wp_error($response)) {
            return new WP_Error(
                'kodety_agents_bridge_unavailable',
                'O runtime local do Codex App Server não está disponível.',
                ['status' => 503]
            );
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300) {
            $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
            $message = is_array($decoded) && is_string($decoded['error'] ?? null)
                ? substr(sanitize_text_field($decoded['error']), 0, 600)
                : 'O runtime local recusou a operação.';
            // A stale/mismatched server secret must not be described as a user
            // authentication failure by the Builder.
            if ($status === 401) {
                $status = 503;
                $message = 'O runtime local não reconheceu a configuração deste servidor.';
                return new WP_Error('kodety_agents_bridge_secret_mismatch', $message, ['status' => $status]);
            } elseif ($status >= 500) {
                // App Server stderr can contain local paths and process details.
                // Keep those in the private bridge log instead of reflecting
                // them through an authenticated but non-admin REST response.
                $message = 'O runtime local falhou ao processar a operação.';
            }
            return new WP_Error('kodety_agents_bridge_error', $message, [
                'status' => max(400, min(599, $status ?: 502)),
            ]);
        }
        return $response;
    }

    /** @return array<string,mixed>|WP_Error */
    private function decode_bridge_response(array $response): array|WP_Error {
        $body = (string) wp_remote_retrieve_body($response);
        if ($body === '' || strlen($body) > self::MAX_PROXY_RESPONSE_BYTES) {
            return new WP_Error('kodety_agents_bridge_response', 'O runtime retornou uma resposta inválida.', ['status' => 502]);
        }
        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            return new WP_Error('kodety_agents_bridge_json', 'O runtime retornou JSON inválido.', ['status' => 502]);
        }
        return $decoded;
    }

    private function runtime_rest_error(WP_Error $error): WP_Error {
        $data = $error->get_error_data();
        $status = is_array($data) ? (int) ($data['status'] ?? 503) : 503;
        // A rejected attachment or approval is not a runtime outage. Preserve
        // the bridge's bounded validation errors and their HTTP semantics.
        if ($error->get_error_code() === 'kodety_agents_bridge_error' && $status >= 400 && $status < 500) return $error;
        $diagnostics = $this->public_runtime_diagnostics($error);
        return new WP_Error($error->get_error_code(), $diagnostics['message'], [
            'status' => $status,
            'runtimeDiagnostics' => $diagnostics,
        ]);
    }

    /** @return array{code:string,message:string,action:string,retryable:bool,retryPath:string} */
    private function public_runtime_diagnostics(WP_Error $error): array {
        $diagnostics = [
            'kodety_agents_browser_runtime' => [
                'browser_runtime_unsupported',
                'Este WordPress roda no navegador e não pode manter o processo local do Codex App Server.',
                false,
            ],
            'kodety_agents_unlicensed' => [
                'license_required',
                'Uma licença Onun Kodety ativa é necessária para usar o modo Agent.',
                false,
            ],
            'kodety_agents_autostart_disabled' => [
                'manual_start_required',
                'O início automático está desativado; o administrador precisa iniciar o App Server.',
                false,
            ],
            'kodety_agents_exec_unavailable' => [
                'exec_unavailable',
                'O host bloqueia a criação do processo necessário ao App Server.',
                false,
            ],
            'kodety_agents_platform_unsupported' => [
                'autostart_unsupported',
                'O início automático não é suportado neste servidor; use um supervisor externo.',
                false,
            ],
            'kodety_agents_sidecar_missing' => [
                'sidecar_missing',
                'A instalação do plugin está incompleta: o bridge do Agent não foi encontrado.',
                false,
            ],
            'kodety_agents_node_missing' => [
                'node_missing',
                'Node.js 18 ou superior não foi encontrado pelo WordPress.',
                true,
            ],
            'kodety_agents_node_too_old' => [
                'node_too_old',
                'A versão de Node.js do servidor é antiga; instale a versão 18 ou superior.',
                true,
            ],
            'kodety_agents_node_invalid' => [
                'node_invalid',
                'O Node.js não respondeu corretamente ao teste de execução.',
                true,
            ],
            'kodety_agents_codex_missing' => [
                'codex_missing',
                'O Codex CLI com suporte a app-server não foi encontrado pelo WordPress.',
                true,
            ],
            'kodety_agents_codex_invalid' => [
                'codex_invalid',
                'O executável Codex configurado não é válido.',
                true,
            ],
            'kodety_agents_codex_app_server_unsupported' => [
                'codex_app_server_unsupported',
                'A versão instalada do Codex CLI não oferece o comando app-server.',
                true,
            ],
            'kodety_agents_runtime_platform' => [
                'runtime_platform_unsupported',
                'Este servidor ainda não possui um runtime do Agent compatível.',
                false,
            ],
            'kodety_agents_runtime_manifest' => [
                'runtime_package_invalid',
                'O pacote do Agent está incompleto e precisa ser reinstalado.',
                false,
            ],
            'kodety_agents_runtime_install_busy' => [
                'runtime_installing',
                'O Agent já está sendo preparado. Tente novamente em alguns instantes.',
                true,
            ],
            'kodety_agents_runtime_lock_unavailable' => [
                'runtime_lock_unavailable',
                'A hospedagem não permitiu proteger a instalação contra processos simultâneos.',
                false,
            ],
            'kodety_agents_runtime_disk' => [
                'runtime_storage_unavailable',
                'Não há espaço privado suficiente para preparar o Agent neste servidor.',
                false,
            ],
            'kodety_agents_runtime_noexec' => [
                'runtime_noexec',
                'A pasta privada está em um armazenamento que bloqueia a execução de programas (noexec).',
                false,
            ],
            'kodety_agents_runtime_download' => [
                'runtime_download_failed',
                'Não foi possível baixar o runtime privado do Agent.',
                true,
            ],
            'kodety_agents_runtime_download_timeout' => [
                'runtime_download_timeout',
                'A hospedagem demorou demais para baixar um bloco do Agent. O progresso anterior foi preservado.',
                true,
            ],
            'kodety_agents_runtime_download_dns' => [
                'runtime_download_dns',
                'A hospedagem não conseguiu localizar o servidor de download do Agent (DNS).',
                true,
            ],
            'kodety_agents_runtime_download_tls' => [
                'runtime_download_tls',
                'A hospedagem não conseguiu validar o certificado HTTPS do download.',
                false,
            ],
            'kodety_agents_runtime_download_blocked' => [
                'runtime_download_blocked',
                'O acesso ao servidor de download do Agent foi recusado.',
                false,
            ],
            'kodety_agents_runtime_download_missing' => [
                'runtime_download_missing',
                'Um pacote da versão do Agent não foi encontrado no servidor de download.',
                false,
            ],
            'kodety_agents_runtime_range_unsupported' => [
                'runtime_range_unsupported',
                'O servidor de download ou um proxy não aceitou o download em partes. O Agent pode tentar o modo compatível.',
                true,
            ],
            'kodety_agents_runtime_integrity' => [
                'runtime_integrity_failed',
                'A verificação de segurança do runtime do Agent falhou.',
                true,
            ],
            'kodety_agents_runtime_extract' => [
                'runtime_install_failed',
                'Não foi possível instalar o runtime privado do Agent neste servidor.',
                true,
            ],
            'kodety_agents_start_in_progress' => [
                'runtime_starting',
                'O App Server está iniciando. Tente novamente em alguns segundos.',
                true,
            ],
            'kodety_agents_codex_starting' => [
                'runtime_starting',
                'O Codex está iniciando e verificando as permissões do Agent.',
                true,
            ],
            'kodety_agents_codex_exec_failed' => [
                'codex_exec_failed',
                'O serviço iniciou, mas a hospedagem não conseguiu executar o Codex.',
                false,
            ],
            'kodety_agents_codex_permission_profile' => [
                'codex_permission_profile',
                'O Codex instalado não confirmou o perfil de permissões obrigatório do Agent.',
                false,
            ],
            'kodety_agents_codex_start_failed' => [
                'codex_start_failed',
                'O processo Codex encerrou ou falhou durante a inicialização.',
                true,
            ],
            'kodety_agents_codex_start_stalled' => [
                'codex_start_stalled',
                'A hospedagem não conseguiu manter a inicialização do Agent respondendo.',
                false,
            ],
            'kodety_agents_bridge_version' => [
                'sidecar_version_mismatch',
                'O serviço do Agent em execução não corresponde à versão do plugin.',
                true,
            ],
            'kodety_agents_start_failed' => [
                'sidecar_start_failed',
                'O processo do App Server não pôde ser iniciado neste servidor.',
                true,
            ],
            'kodety_agents_start_stalled' => [
                'sidecar_start_stalled',
                'A hospedagem iniciou o Agent, mas não conseguiu manter o processo respondendo.',
                false,
            ],
            'kodety_agents_start_timeout' => [
                'sidecar_start_timeout',
                'O processo iniciou, mas não ficou pronto dentro do tempo esperado.',
                true,
            ],
            'kodety_agents_bridge_secret_mismatch' => [
                'sidecar_configuration_mismatch',
                'Outro processo está usando a porta do Agent com uma configuração diferente.',
                false,
            ],
            'kodety_agents_bridge_config' => [
                'invalid_server_configuration',
                'A configuração privada do App Server é inválida ou não pôde ser preparada.',
                false,
            ],
        ];
        foreach (['node' => 'Node.js', 'codex' => 'Codex'] as $kind => $name) {
            foreach ([
                'execution_denied' => ['A hospedagem negou a execução do ' . $name . '.', false],
                'system_incompatible' => ['O ' . $name . ' precisa de bibliotecas do sistema que não estão disponíveis ou são incompatíveis nesta hospedagem.', false],
                'architecture' => ['O ' . $name . ' não é compatível com a arquitetura ou as instruções do processador deste servidor.', false],
                'resources' => ['A hospedagem interrompeu o ' . $name . ' ou recusou os recursos necessários para executá-lo.', true],
                'probe_timeout' => ['O ' . $name . ' não respondeu ao teste de execução dentro do tempo permitido.', true],
            ] as $reason => [$message, $retryable]) {
                $code = $kind . '_' . $reason;
                $diagnostics['kodety_agents_' . $code] = [$code, $message, $retryable];
            }
        }
        [$code, $message, $retryable] = $diagnostics[$error->get_error_code()] ?? [
            'sidecar_unavailable',
            'O Codex App Server não está disponível neste servidor.',
            true,
        ];
        $action = match ($code) {
            'license_required' => 'Ative a licença do projeto antes de conectar a conta OpenAI.',
            'browser_runtime_unsupported' => 'Escolha Onun Kodety Cloud para executar o Agent remotamente ou conecte um cliente pelo MCP do Studio.',
            'manual_start_required' => 'Peça ao administrador para iniciar o serviço do Agent e verifique novamente.',
            'exec_unavailable' => 'Consulte a hospedagem sobre exec() ou proc_open() e processos persistentes. Baixar novamente não libera essa restrição.',
            'autostart_unsupported', 'runtime_platform_unsupported' => 'O runtime gerenciado requer Linux ou macOS de 64 bits (x64 ou arm64).',
            'sidecar_missing', 'runtime_package_invalid', 'runtime_download_missing' => 'Atualize ou reinstale o plugin com um pacote completo da mesma versão.',
            'node_missing', 'node_too_old', 'codex_missing' => 'Use Tentar novamente para preparar os componentes compatíveis em etapas.',
            'node_invalid', 'codex_invalid', 'codex_app_server_unsupported', 'codex_exec_failed' => 'Peça à hospedagem para conferir a compatibilidade dos executáveis e se a pasta privada permite execução (noexec).',
            'runtime_noexec', 'node_execution_denied', 'codex_execution_denied' => 'Não foi encontrada uma alternativa privada executável. A hospedagem pode liberar uma pasta fora do site público; o administrador pode indicá-la em KODETY_AGENT_RUNTIME_DIR. Baixar novamente não remove o bloqueio.',
            'node_system_incompatible', 'codex_system_incompatible' => 'Peça à hospedagem um executável compatível com seu sistema e bibliotecas (glibc/libstdc++). O administrador pode indicar os caminhos em KODETY_AGENT_NODE_BINARY e KODETY_CODEX_BINARY.',
            'node_architecture', 'codex_architecture' => 'Confirme com a hospedagem a arquitetura de 64 bits e o suporte do processador ao binário. Remova uma substituição manual incorreta ou indique um executável compatível.',
            'node_resources', 'codex_resources' => 'Confira os limites de RAM, CPU e processos da conta de hospedagem. Uma conta com muitos sites pode compartilhar esses limites.',
            'node_probe_timeout', 'codex_probe_timeout' => 'Tente novamente. Se persistir, peça à hospedagem para verificar sobrecarga, limites de processos e a execução dos binários.',
            'codex_permission_profile' => 'Atualize o Codex ou remova a substituição manual do executável para usar a versão gerenciada. Não desative o isolamento do Agent.',
            'sidecar_version_mismatch' => 'Verifique novamente para reiniciar o serviço. Se ele usa um supervisor externo, peça ao administrador para atualizá-lo e reiniciá-lo.',
            'runtime_starting' => 'Aguarde a verificação do processo. O login só será liberado quando o Codex estiver pronto.',
            'invalid_server_configuration' => 'Confira as permissões e open_basedir. O Agent precisa de uma pasta privada gravável fora da pasta pública do site.',
            'runtime_storage_unavailable' => 'Libere ao menos 700 MiB para iniciar a instalação no armazenamento privado da hospedagem.',
            'runtime_download_dns', 'runtime_download_blocked', 'runtime_download_failed' => 'Peça à hospedagem para verificar DNS, firewall e acesso HTTPS a nodejs.org e registry.npmjs.org.',
            'runtime_download_tls' => 'Peça à hospedagem para atualizar os certificados CA e conferir o relógio do servidor. Não desative a validação HTTPS.',
            'runtime_download_timeout' => 'Tente novamente para continuar do último bloco salvo. Se persistir, verifique os limites de rede e de tempo da hospedagem.',
            'runtime_range_unsupported' => 'Tente novamente. O Agent alternará para o download compatível sem depender dos cabeçalhos Range e Content-Range.',
            'runtime_integrity_failed' => 'O arquivo inválido não será executado. Tente novamente para baixar uma cópia íntegra.',
            'runtime_install_failed' => 'Confira espaço, permissões de escrita e a disponibilidade do utilitário tar na hospedagem.',
            'runtime_installing' => 'Mantenha o painel aberto para continuar. Se fechar, use Tentar novamente para retomar a preparação salva.',
            'runtime_lock_unavailable' => 'Peça à hospedagem para conferir as permissões da pasta privada e o suporte a flock() nesse armazenamento.',
            'sidecar_configuration_mismatch' => 'Peça ao administrador para conferir a porta e a configuração do serviço do Agent.',
            'sidecar_start_stalled', 'codex_start_stalled' => 'Hospedagens compartilhadas costumam bloquear ou interromper processos persistentes. Continue pelo MCP ou use uma hospedagem que permita esse tipo de processo.',
            'sidecar_start_failed', 'sidecar_start_timeout', 'sidecar_unavailable', 'codex_start_failed' => 'Verifique processos persistentes, limites de memória e comunicação local (loopback) com a hospedagem.',
            default => 'Tente novamente. Se persistir, informe este código ao administrador da hospedagem.',
        };
        return [
            'code' => $code,
            'message' => $message,
            'action' => $action,
            'retryable' => $retryable,
            'retryPath' => self::RETRY_PATH,
        ];
    }

    /** @return array{cwd:string,skillRoots:list<string>,projectName:string,readOnly:bool} */
    private function runtime_context(): array {
        $user_id = get_current_user_id();
        if ($user_id < 1) throw new RuntimeException('A identidade do editor não está disponível.');
        $project_id = sanitize_key((string) get_option('kodety_workspace_project_id', '')) ?: 'single';
        $site_key = substr(hash('sha256', home_url('/') . '|' . get_current_blog_id()), 0, 16);
        $project_key = substr(hash('sha256', $project_id), 0, 20);
        $cwd = $this->runtime_root()
            . '/workspaces/site-' . $site_key
            . '/user-' . $user_id
            . '/project-' . $project_key;
        if (!is_dir($cwd) && !wp_mkdir_p($cwd)) {
            throw new RuntimeException('Não foi possível preparar o workspace isolado do Agent.');
        }
        @chmod($cwd, 0700);
        $roots = apply_filters('kodety_agents_skill_roots', [KODETY_DIR . 'agent-skills'], $user_id, $project_id);
        $skill_roots = [];
        foreach (is_array($roots) ? $roots : [] as $root) {
            if (!is_string($root) || $root === '' || !$this->absolute_path($root) || !is_dir($root)) continue;
            $skill_roots[] = untrailingslashit($root);
        }
        $skill_roots = array_values(array_unique($skill_roots));
        return [
            'cwd' => $cwd,
            'skillRoots' => array_slice($skill_roots, 0, 12),
            'projectName' => substr(sanitize_text_field((string) get_option('kodety_project_name', 'Projeto atual')), 0, 160),
            'readOnly' => !current_user_can(Kodety_Plugin::CAP_EDIT_WORKSPACE),
        ];
    }

    private function runtime_root(): string {
        if (defined('KODETY_AGENT_DATA_DIR') && !is_string(KODETY_AGENT_DATA_DIR)) throw new RuntimeException('KODETY_AGENT_DATA_DIR inválido.');
        if (defined('KODETY_AGENT_DATA_DIR') && is_string(KODETY_AGENT_DATA_DIR) && KODETY_AGENT_DATA_DIR !== '') {
            return $this->prepare_private_runtime_directory(KODETY_AGENT_DATA_DIR);
        }
        $saved = get_option(self::OPTION_DATA_DIR, '');
        if (is_string($saved) && $saved !== '') return $this->prepare_private_runtime_directory($saved);
        $site_key = substr(hash('sha256', home_url('/') . '|' . ABSPATH), 0, 18);
        $root = untrailingslashit($this->normalize_filesystem_path(sys_get_temp_dir())) . '/kodety-agent-' . $site_key;
        // Never move an existing account store just because executable files
        // need a different filesystem. Only new/unavailable stores fall back.
        if (@is_dir($root)) return $this->prepare_private_runtime_directory($root);
        try {
            return $this->prepare_private_runtime_directory($root);
        } catch (Throwable $error) {
            foreach ($this->private_runtime_parents() as $parent) {
                try {
                    $fallback = $this->prepare_private_runtime_directory($parent . '/.kodety-agent-data-' . $site_key);
                    update_option(self::OPTION_DATA_DIR, $fallback, false);
                    if (get_option(self::OPTION_DATA_DIR) !== $fallback) throw new RuntimeException('Não foi possível persistir o armazenamento privado.');
                    return $fallback;
                } catch (Throwable) {
                    // open_basedir and permissions differ between hosting plans.
                }
            }
            throw $error;
        }
    }

    private function prepare_private_runtime_directory(string $root): string {
        $root = untrailingslashit($this->normalize_filesystem_path($root));
        if (!$this->absolute_path($root) || dirname($root) === '/' || @is_link($root)) {
            throw new RuntimeException('O Agent precisa de um diretório privado absoluto e dedicado.');
        }
        $this->assert_runtime_root_location($root);
        if (!@is_dir($root) && !@wp_mkdir_p($root)) {
            throw new RuntimeException('Não foi possível preparar o armazenamento privado do Agent.');
        }
        $resolved = @realpath($root);
        if (is_string($resolved) && $resolved !== '') $root = $this->normalize_filesystem_path($resolved);
        $this->assert_runtime_root_location($root);
        $this->enforce_private_permissions($root, 0700, 'armazenamento privado do Agent');
        return $root;
    }

    /** @return list<string> Account-owned parents, never a public directory. */
    private function private_runtime_parents(): array {
        $parents = [(string) getenv('HOME')];
        if ($this->function_available('posix_getpwuid') && $this->function_available('posix_geteuid')) {
            $account = posix_getpwuid(posix_geteuid());
            if (is_array($account) && is_string($account['dir'] ?? null)) $parents[] = $account['dir'];
        }
        foreach ([ABSPATH, (string) ($_SERVER['DOCUMENT_ROOT'] ?? '')] as $public_root) {
            $probe = rtrim($public_root, '/\\');
            for ($depth = 0; $depth < 4 && $this->absolute_path($probe); $depth++) {
                if (in_array(basename($probe), ['public_html', 'httpdocs', 'htdocs', 'www', 'html'], true)) {
                    $parents[] = dirname($probe);
                    break;
                }
                if (dirname($probe) === $probe) break;
                $probe = dirname($probe);
            }
        }
        $parents = apply_filters('kodety_agents_private_runtime_parents', $parents);
        $safe = [];
        foreach (is_array($parents) ? array_slice($parents, 0, 12) : [] as $parent) {
            if (!is_string($parent) || !$this->absolute_path($parent)) continue;
            $parent = @realpath($parent);
            if (!is_string($parent) || dirname($parent) === '/' || !@is_writable($parent) || !$this->directory_is_safe_for_executable_search($parent)) continue;
            try {
                $this->assert_runtime_root_location($parent . '/.kodety-private-probe');
                $safe[] = $parent;
            } catch (Throwable) {
                continue;
            }
        }
        return array_values(array_unique($safe));
    }

    /** Only binaries may relocate; auth, locks and download checkpoints stay put. */
    private function managed_runtime_root(): string {
        $configured = defined('KODETY_AGENT_RUNTIME_DIR') ? KODETY_AGENT_RUNTIME_DIR : '';
        if (!is_string($configured)) throw new RuntimeException('KODETY_AGENT_RUNTIME_DIR inválido.');
        $saved = $configured !== '' ? $configured : get_option(self::OPTION_EXECUTION_DIR, '');
        $root = is_string($saved) && $saved !== '' ? $saved : $this->runtime_root() . '/managed-runtime';
        if (@is_link($root)) throw new RuntimeException('O diretório dos executáveis não pode ser um link simbólico.');
        $root = $this->canonicalize_candidate_path($root);
        if (!$this->absolute_path($root) || dirname($root) === '/' || $root === $this->runtime_root()) {
            throw new RuntimeException('O diretório dos executáveis precisa ser privado e dedicado.');
        }
        $this->assert_runtime_root_location($root);
        return $root;
    }

    private function path_has_noexec(string $path): ?bool {
        if (PHP_OS_FAMILY !== 'Linux') return null;
        $mounts = @file_get_contents('/proc/self/mountinfo', false, null, 0, 1_048_576);
        return is_string($mounts) ? $this->mountinfo_has_noexec($this->canonicalize_candidate_path($path), $mounts) : null;
    }

    private function mountinfo_has_noexec(string $path, string $mounts): ?bool {
        $longest = -1;
        $noexec = null;
        foreach (explode("\n", $mounts) as $line) {
            $fields = explode(' ', explode(' - ', $line, 2)[0]);
            if (count($fields) < 6) continue;
            $mount = preg_replace_callback('/\\\\([0-7]{3})/', static fn(array $match): string => chr(octdec($match[1])), $fields[4]);
            if (!is_string($mount) || strlen($mount) < $longest || ($mount !== '/' && !$this->path_is_within($path, $mount))) continue;
            $longest = strlen($mount);
            $noexec = in_array('noexec', explode(',', $fields[5]), true);
        }
        return $noexec;
    }

    private function select_executable_runtime_root(): bool {
        if (defined('KODETY_AGENT_RUNTIME_DIR') && KODETY_AGENT_RUNTIME_DIR !== '') return false;
        $current = $this->managed_runtime_root();
        $site_key = substr(hash('sha256', home_url('/') . '|' . ABSPATH), 0, 18);
        $probe_source = $this->system_executable(['/usr/bin/true', '/bin/true']);
        if ($probe_source === null || @filesize($probe_source) > 1_048_576) return false;
        foreach ($this->private_runtime_parents() as $parent) {
            $candidate = $parent . '/.kodety-agent-runtime-' . $site_key;
            if ($this->canonicalize_candidate_path($candidate) === $current || $this->path_has_noexec($candidate) === true) continue;
            $probe = null;
            try {
                $candidate = $this->prepare_private_runtime_directory($candidate);
                // Execute a small system binary, not an interpreted script:
                // invoking sh on a script would not detect a noexec mount.
                $probe = $candidate . '/.exec-probe-' . bin2hex(random_bytes(8));
                $copied = @is_readable($probe_source) && @copy($probe_source, $probe);
                if (!$copied && (string) ini_get('open_basedir') !== '') {
                    // The fixed system utility may be visible to processes but
                    // not to PHP. Both destination creation and chmod must still
                    // pass PHP's private-directory and open_basedir checks.
                    $cp = $this->system_executable(['/bin/cp', '/usr/bin/cp']);
                    if ($cp !== null) $copied = $this->run_runtime_process([$cp, $probe_source, $probe], $this->runtime_root(), 1.0)['status'] === 0;
                }
                if (!$copied || !@chmod($probe, 0700)) continue;
                $result = $this->run_runtime_process([$probe], $this->runtime_root(), 1.0);
                if ($result['status'] !== 0 || $result['timedOut']) continue;
                update_option(self::OPTION_EXECUTION_DIR, $candidate, false);
                if (get_option(self::OPTION_EXECUTION_DIR) !== $candidate) continue;
                $this->runtime_executables = [];
                return true;
            } catch (Throwable) {
                continue;
            } finally {
                if ($probe !== null) @unlink($probe);
            }
        }
        return false;
    }

    private function assert_runtime_root_location(string $root): void {
        $comparison_root = $this->canonicalize_candidate_path($root);
        $uploads = wp_get_upload_dir();
        $uploads_root = empty($uploads['basedir']) ? '' : (string) $uploads['basedir'];
        $uploads_real = $uploads_root !== '' ? @realpath($uploads_root) : false;
        if (is_string($uploads_real) && $uploads_real !== '') $uploads_root = $uploads_real;
        if ($uploads_root !== '' && $this->path_is_within($comparison_root, $uploads_root)) {
            throw new RuntimeException('KODETY_AGENT_DATA_DIR não pode ficar no diretório público de uploads.');
        }
        $document_root = isset($_SERVER['DOCUMENT_ROOT']) && is_string($_SERVER['DOCUMENT_ROOT'])
            ? $_SERVER['DOCUMENT_ROOT']
            : '';
        if ($document_root !== '' && $this->absolute_path($document_root)) {
            $document_real = @realpath($document_root);
            $document_root = is_string($document_real) && $document_real !== '' ? $document_real : $document_root;
            if ($this->path_is_within($comparison_root, $document_root)) {
                throw new RuntimeException('KODETY_AGENT_DATA_DIR precisa ficar fora do document root do servidor.');
            }
        }
        $wordpress_root = @realpath(ABSPATH);
        $wordpress_root = is_string($wordpress_root) && $wordpress_root !== '' ? $wordpress_root : ABSPATH;
        if (
            $this->path_is_within($comparison_root, $wordpress_root)
            && apply_filters('kodety_agents_allow_webroot_data_dir', false, $root) !== true
        ) {
            throw new RuntimeException('KODETY_AGENT_DATA_DIR precisa ficar fora do webroot do WordPress.');
        }
    }

    private function canonicalize_candidate_path(string $path): string {
        $path = $this->normalize_filesystem_path($path);
        $probe = $path;
        $tail = [];
        while ($probe !== '' && !@file_exists($probe)) {
            $parent = dirname($probe);
            if ($parent === $probe) break;
            array_unshift($tail, basename($probe));
            $probe = $parent;
        }
        $resolved = $probe !== '' ? @realpath($probe) : false;
        if (!is_string($resolved) || $resolved === '') return $path;
        return $this->normalize_filesystem_path(
            untrailingslashit($resolved) . ($tail ? '/' . implode('/', $tail) : '')
        );
    }

    private function bridge_secret(): string {
        if (defined('KODETY_AGENT_SECRET') && is_string(KODETY_AGENT_SECRET)) {
            $secret = trim(KODETY_AGENT_SECRET);
            if (strlen($secret) < 32) throw new RuntimeException('KODETY_AGENT_SECRET precisa ter ao menos 32 caracteres.');
            $this->write_secret_file($secret);
            return $secret;
        }
        $path = $this->runtime_root() . '/bridge.secret';
        $secret = is_file($path) && is_readable($path) ? trim((string) file_get_contents($path)) : '';
        if (strlen($secret) >= 32) {
            $this->enforce_private_permissions($path, 0600, 'segredo do runtime local');
            return $secret;
        }
        $secret = bin2hex(random_bytes(32));
        $handle = @fopen($path, 'x');
        if (is_resource($handle)) {
            try {
                if (fwrite($handle, $secret . "\n") === false) {
                    throw new RuntimeException('Não foi possível salvar o segredo do runtime local.');
                }
                fflush($handle);
            } finally {
                fclose($handle);
            }
            $this->enforce_private_permissions($path, 0600, 'segredo do runtime local');
            return $secret;
        }
        $stored = is_file($path) && is_readable($path) ? trim((string) file_get_contents($path)) : '';
        if (strlen($stored) < 32) throw new RuntimeException('Não foi possível preparar o segredo do runtime local.');
        $this->enforce_private_permissions($path, 0600, 'segredo do runtime local');
        return $stored;
    }

    private function write_secret_file(string $secret): void {
        $path = $this->runtime_root() . '/bridge.secret';
        $stored = is_file($path) && is_readable($path) ? trim((string) file_get_contents($path)) : '';
        if (hash_equals($secret, $stored)) {
            $this->enforce_private_permissions($path, 0600, 'segredo do runtime local');
            return;
        }
        if (file_put_contents($path, $secret . "\n", LOCK_EX) === false) {
            throw new RuntimeException('Não foi possível salvar o segredo do runtime local.');
        }
        $this->enforce_private_permissions($path, 0600, 'segredo do runtime local');
    }

    private function enforce_private_permissions(string $path, int $mode, string $label): void {
        @chmod($path, $mode);
        if (DIRECTORY_SEPARATOR === '\\') return;
        clearstatcache(true, $path);
        $permissions = @fileperms($path);
        if (!is_int($permissions) || ($permissions & 0777) !== $mode) {
            throw new RuntimeException('Não foi possível proteger o ' . $label . '.');
        }
    }

    private function bridge_url(): string {
        $url = defined('KODETY_AGENT_BRIDGE_URL') && is_string(KODETY_AGENT_BRIDGE_URL)
            ? KODETY_AGENT_BRIDGE_URL
            : $this->default_bridge_url();
        $url = (string) apply_filters('kodety_agents_bridge_url', $url);
        $parts = wp_parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $port = (int) ($parts['port'] ?? 0);
        $path = (string) ($parts['path'] ?? '');
        if (
            $scheme !== 'http'
            || !in_array($host, ['127.0.0.1', '::1', '[::1]', 'localhost'], true)
            || $port < 1024
            || $port > 65535
            || ($path !== '' && $path !== '/')
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])
        ) {
            throw new RuntimeException('A ponte do Agent precisa usar HTTP em um endereço loopback com porta explícita.');
        }
        return untrailingslashit($url);
    }

    private function default_bridge_url(): string {
        $site_fingerprint = home_url('/') . '|' . ABSPATH . '|' . get_current_blog_id();
        // A 20k-port range keeps the value deterministic for one installation
        // while avoiding the single fixed-port collision across independent
        // WordPress sites on the same host.
        $port = 41_000 + (hexdec(substr(hash('sha256', $site_fingerprint), 0, 4)) % 20_000);
        return 'http://127.0.0.1:' . $port;
    }

    private function bridge_endpoint(string $path): string {
        if (!preg_match('#^/[a-z/]+$#D', $path)) throw new RuntimeException('O endpoint interno do Agent é inválido.');
        return $this->bridge_url() . $path;
    }

    private function maybe_start_bridge(): bool|WP_Error {
        $autostart = defined('KODETY_AGENT_AUTOSTART')
            ? KODETY_AGENT_AUTOSTART === true
            : true;
        if (apply_filters('kodety_agents_bridge_autostart', $autostart) !== true) {
            return new WP_Error(
                'kodety_agents_autostart_disabled',
                'O início automático do App Server está desativado.',
                ['status' => 503]
            );
        }
        $backoff = get_transient(self::START_BACKOFF);
        // Older releases recorded a timeout while the process could still be
        // starting normally. Never preserve that artificial deadline.
        if ($backoff === 'timeout') {
            delete_transient(self::START_BACKOFF);
            $backoff = false;
        }
        if ($backoff) {
            return new WP_Error('kodety_agents_start_failed', 'O App Server não pôde ser iniciado recentemente.', [
                'status' => 503,
                'retryAfter' => 30,
            ]);
        }
        if (DIRECTORY_SEPARATOR === '\\') {
            return new WP_Error(
                'kodety_agents_platform_unsupported',
                'Use um supervisor externo para iniciar o App Server neste sistema.',
                ['status' => 503]
            );
        }
        if (!$this->process_execution_available()) {
            return new WP_Error(
                'kodety_agents_exec_unavailable',
                'O host não permite iniciar processos com exec() ou proc_open().',
                ['status' => 503]
            );
        }

        $lock = $this->acquire_runtime_lock('bridge-start.lock', 'kodety_agents_start_in_progress');
        if (is_wp_error($lock)) return $lock;

        try {
            // Another request may have started the bridge before we acquired
            // the lock. Never launch a second process from a stale probe.
            $existing = $this->bridge_health(false);
            if (!is_wp_error($existing)) return true;
            if ($existing->get_error_code() === 'kodety_agents_bridge_secret_mismatch') return $existing;
            $record = $this->normalize_process_record(get_option(self::OPTION_BRIDGE_PID, false));
            if ($record !== null && $this->bridge_process_matches($record)) {
                $stalled = $record['startedAt'] > 0
                    && $record['startedAt'] <= time() - self::START_STALL_SECONDS;
                if ($stalled && $this->runtime_probe_retry) {
                    $this->stop_bridge();
                    return new WP_Error(
                        'kodety_agents_start_in_progress',
                        'O App Server está sendo reiniciado.',
                        ['status' => 503, 'retryAfter' => 1]
                    );
                }
                if ($stalled) {
                    return new WP_Error(
                        'kodety_agents_start_stalled',
                        'O App Server parou de responder durante a inicialização.',
                        ['status' => 503]
                    );
                }
                return new WP_Error(
                    'kodety_agents_start_in_progress',
                    'O App Server continua iniciando.',
                    ['status' => 503, 'retryAfter' => 1]
                );
            }
            $server = KODETY_DIR . 'agent-runtime/server.mjs';
            if (!is_file($server) || !is_readable($server)) {
                return new WP_Error(
                    'kodety_agents_sidecar_missing',
                    'O arquivo agent-runtime/server.mjs não está disponível.',
                    ['status' => 503]
                );
            }
            $parts = wp_parse_url($this->bridge_url());
            $port = (int) ($parts['port'] ?? 0);
            $root = $this->runtime_root();
            $log = $root . '/bridge.log';
            if (is_link($log) || (!is_file($log) && !@touch($log))) {
                return new WP_Error('kodety_agents_bridge_config', 'Não foi possível proteger o log privado.', ['status' => 503]);
            }
            $this->enforce_private_permissions($log, 0600, 'log do Agent');
            $node = $this->resolve_runtime_executable('node');
            if (is_wp_error($node)) return $node;
            $codex = $this->resolve_runtime_executable('codex');
            if (is_wp_error($codex)) return $codex;
            $environment_binary = $this->system_executable(['/usr/bin/env', '/bin/env']);
            $nohup_binary = $this->system_executable(['/usr/bin/nohup', '/bin/nohup']);
            if ($environment_binary === null || $nohup_binary === null) {
                return new WP_Error(
                    'kodety_agents_start_failed',
                    'O host não oferece os utilitários necessários para iniciar o processo isolado.',
                    ['status' => 503]
                );
            }
            $environment = [
                'PATH' => $this->runtime_executable_path($node, $codex),
                'HOME' => $root,
                'LANG' => (string) (getenv('LANG') ?: 'C.UTF-8'),
                'NODE_ENV' => 'production',
                'KODETY_AGENT_PORT' => (string) $port,
                'KODETY_AGENT_SECRET_FILE' => $root . '/bridge.secret',
                'KODETY_AGENT_DATA_DIR' => $root,
                'KODETY_CODEX_BINARY' => $codex,
            ];
            $this->bridge_secret();
            $assignments = [];
            foreach ($environment as $name => $value) {
                $assignments[] = $name . '=' . escapeshellarg($value);
            }
            $command = escapeshellarg($nohup_binary) . ' ' . escapeshellarg($environment_binary)
                . ' -i ' . implode(' ', $assignments)
                . ' ' . escapeshellarg($node)
                . ' ' . escapeshellarg($server)
                . ' >> ' . escapeshellarg($log)
                . ' 2>&1 < /dev/null & echo $!';
            $launch = $this->run_runtime_process(['/bin/sh', '-c', $command], $root, 3.0, 1024);
            $pid_text = trim($launch['output']);
            $pid = ctype_digit($pid_text) ? (int) $pid_text : 0;
            if ($launch['status'] !== 0 || $pid < 1) {
                set_transient(self::START_BACKOFF, 'failed', 30);
                return new WP_Error(
                    'kodety_agents_start_failed',
                    'O shell do servidor não iniciou o processo do App Server.',
                    ['status' => 503]
                );
            }
            $resolved_server = realpath($server);
            update_option(self::OPTION_BRIDGE_PID, [
                'pid' => $pid,
                'server' => $this->normalize_filesystem_path(
                    is_string($resolved_server) && $resolved_server !== '' ? $resolved_server : $server
                ),
                'port' => $port,
                'secretFile' => $root . '/bridge.secret',
                'startedAt' => time(),
            ], false);
            delete_transient(self::START_BACKOFF);
            return new WP_Error(
                'kodety_agents_start_in_progress',
                'O App Server foi iniciado e está preparando a conexão.',
                ['status' => 503, 'retryAfter' => 1]
            );
        } catch (Throwable $error) {
            set_transient(self::START_BACKOFF, 'failed', 30);
            return new WP_Error(
                'kodety_agents_bridge_config',
                'Não foi possível preparar o runtime privado do App Server.',
                ['status' => 503]
            );
        } finally {
            $this->release_runtime_lock($lock);
        }
    }

    private function stop_bridge(): void {
        $stored = get_option(self::OPTION_BRIDGE_PID, false);
        // Remove coordination state even when a stale PID cannot be proven to
        // belong to us. Failing closed is safer than signalling an unrelated
        // process after PID reuse.
        delete_option(self::OPTION_BRIDGE_PID);
        delete_option(self::OPTION_START_LOCK);
        delete_transient(self::START_BACKOFF);
        $record = $this->normalize_process_record($stored);
        if ($record === null) return;
        try {
            if (!$this->bridge_process_matches($record)) return;
            $pid = $record['pid'];
            if (function_exists('posix_kill')) {
                @posix_kill($pid, defined('SIGTERM') ? SIGTERM : 15);
                return;
            }
            if (!$this->process_execution_available()) return;
            $this->run_runtime_process(['/bin/kill', '-TERM', (string) $pid], $this->runtime_root(), 2.0);
        } catch (Throwable) {
            // Lifecycle cleanup must never make plugin deactivation or an
            // upgrade request fail.
        }
    }

    /** @return array{pid:int,server:string,port:int,secretFile:string,startedAt:int,legacy:bool}|null */
    private function normalize_process_record(mixed $stored): ?array {
        $legacy = false;
        if (is_numeric($stored) && !is_array($stored)) {
            $pid = (int) $stored;
            $legacy = true;
            $server = KODETY_DIR . 'agent-runtime/server.mjs';
            try {
                $secret_file = $this->runtime_root() . '/bridge.secret';
            } catch (Throwable) {
                return null;
            }
            $port = 0;
            $started_at = 0;
        } elseif (is_array($stored)) {
            $pid = isset($stored['pid']) && is_numeric($stored['pid']) ? (int) $stored['pid'] : 0;
            $server = is_string($stored['server'] ?? null) ? $stored['server'] : '';
            $port = isset($stored['port']) && is_numeric($stored['port']) ? (int) $stored['port'] : 0;
            $secret_file = is_string($stored['secretFile'] ?? null) ? $stored['secretFile'] : '';
            $started_at = isset($stored['startedAt']) && is_numeric($stored['startedAt'])
                ? max(0, (int) $stored['startedAt'])
                : 0;
        } else {
            return null;
        }
        $parent_pid = function_exists('posix_getppid') ? (int) posix_getppid() : 0;
        if ($pid < 2 || $pid === getmypid() || ($parent_pid > 0 && $pid === $parent_pid)) return null;
        $expected_server = realpath(KODETY_DIR . 'agent-runtime/server.mjs');
        $expected_server = is_string($expected_server) && $expected_server !== ''
            ? $this->normalize_filesystem_path($expected_server)
            : $this->normalize_filesystem_path(KODETY_DIR . 'agent-runtime/server.mjs');
        $server_real = $server !== '' ? realpath($server) : false;
        $server = is_string($server_real) && $server_real !== ''
            ? $this->normalize_filesystem_path($server_real)
            : $this->normalize_filesystem_path($server);
        $secret_file = $this->normalize_filesystem_path($secret_file);
        if (
            $server === ''
            || !hash_equals($expected_server, $server)
            || !$this->absolute_path($secret_file)
            || basename($secret_file) !== 'bridge.secret'
            || (!$legacy && ($port < 1024 || $port > 65535))
        ) {
            return null;
        }
        return [
            'pid' => $pid,
            'server' => $server,
            'port' => $port,
            'secretFile' => $secret_file,
            'startedAt' => $started_at,
            'legacy' => $legacy,
        ];
    }

    /** @param array{pid:int,server:string,port:int,secretFile:string,startedAt:int,legacy:bool} $record */
    private function bridge_process_matches(array $record): bool {
        $pid = $record['pid'];
        $server_matches = false;
        $cmdline_path = '/proc/' . $pid . '/cmdline';
        if (is_file($cmdline_path) && is_readable($cmdline_path)) {
            $raw = @file_get_contents($cmdline_path);
            if (!is_string($raw) || $raw === '') return false;
            foreach (array_filter(explode("\0", $raw), 'strlen') as $argument) {
                if (!is_string($argument) || !$this->absolute_path($argument)) continue;
                $resolved = realpath($argument);
                $candidate = $this->normalize_filesystem_path(
                    is_string($resolved) && $resolved !== '' ? $resolved : $argument
                );
                if (hash_equals($record['server'], $candidate)) {
                    $server_matches = true;
                    break;
                }
            }
            if (!$server_matches) return false;
            $environment_path = '/proc/' . $pid . '/environ';
            if (is_file($environment_path) && is_readable($environment_path)) {
                $environment = @file_get_contents($environment_path);
                if (is_string($environment) && $environment !== '') {
                    return $this->bridge_environment_matches($record, $environment);
                }
            }
        }
        if (!$this->process_execution_available()) return false;
        $ps = $this->system_executable(['/bin/ps', '/usr/bin/ps']);
        if ($ps === null) return false;
        $result = $this->run_runtime_process([$ps, 'eww', '-p', (string) $pid, '-o', 'command='], $this->runtime_root(), 2.0, 65_536);
        if ($result['status'] !== 0 || $result['truncated'] || $result['output'] === '') return false;
        $description = $result['output'];
        $launch_server = $this->normalize_filesystem_path(KODETY_DIR . 'agent-runtime/server.mjs');
        return (str_contains($description, $record['server']) || str_contains($description, $launch_server))
            && $this->bridge_environment_matches($record, $description);
    }

    /** @param array{pid:int,server:string,port:int,secretFile:string,startedAt:int,legacy:bool} $record */
    private function bridge_environment_matches(array $record, string $environment): bool {
        if (!$this->environment_assignment_matches(
            $environment,
            'KODETY_AGENT_SECRET_FILE',
            $record['secretFile']
        )) {
            return false;
        }
        return $record['legacy'] || $this->environment_assignment_matches(
            $environment,
            'KODETY_AGENT_PORT',
            (string) $record['port']
        );
    }

    private function environment_assignment_matches(string $environment, string $name, string $value): bool {
        $needle = $name . '=' . $value;
        $offset = 0;
        while (($position = strpos($environment, $needle, $offset)) !== false) {
            $before = $position === 0 ? "\0" : $environment[$position - 1];
            $after_position = $position + strlen($needle);
            $after = $after_position >= strlen($environment) ? "\0" : $environment[$after_position];
            $before_boundary = $before === "\0" || str_contains(" \t\r\n", $before);
            $after_boundary = $after === "\0" || str_contains(" \t\r\n", $after);
            if ($before_boundary && $after_boundary) return true;
            $offset = $position + 1;
        }
        return false;
    }

    private function function_available(string $name): bool {
        if (!function_exists($name)) return false;
        $disabled = array_filter(array_map('trim', explode(',', (string) ini_get('disable_functions'))));
        return !in_array($name, $disabled, true);
    }

    private function bounded_process_api_available(): bool {
        foreach (['proc_open', 'proc_get_status', 'proc_terminate', 'proc_close', 'stream_set_blocking'] as $function) {
            if (!$this->function_available($function)) return false;
        }
        return true;
    }

    private function process_execution_available(): bool {
        return $this->bounded_process_api_available() || $this->function_available('exec');
    }

    /**
     * Prefer a shell-free, bounded process with a minimal environment. The exec
     * fallback preserves support for hosts that disable proc_open; GNU timeout
     * bounds that fallback when supplied by the host. Raw output stays private.
     * @param list<string> $arguments
     * @return array{status:int,output:string,timedOut:bool,truncated:bool}
     */
    private function run_runtime_process(array $arguments, string $root, float $timeout = 3.0, int $limit = 16_384, bool $report_exec_errors = true): array {
        $result = ['status' => 127, 'output' => '', 'timedOut' => false, 'truncated' => false];
        if (!$arguments || !$this->absolute_path($arguments[0])) return $result;
        $paths = [$arguments[0]];
        if ($this->validated_node_path !== null) $paths[] = $this->validated_node_path;
        $environment = ['PATH' => $this->minimal_executable_path($paths), 'HOME' => $root, 'LANG' => 'C', 'LC_ALL' => 'C'];
        if ($this->bounded_process_api_available()) {
            $pipes = [];
            $process_arguments = $arguments;
            $env_binary = $report_exec_errors ? $this->system_executable(['/usr/bin/env', '/bin/env']) : null;
            if ($env_binary !== null) {
                // env reports loader/permission failures on stderr, whereas
                // PHP's own exec failure can otherwise lose that reason.
                $process_arguments = array_merge([$env_binary], $arguments);
            }
            try {
                $process = @proc_open($process_arguments, [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['redirect', 1]], $pipes, $root, $environment);
            } catch (Throwable) {
                $process = false;
            }
            if (is_resource($process)) {
                stream_set_blocking($pipes[1], false);
                $deadline = microtime(true) + max(0.1, $timeout);
                $kill_deadline = null;
                try {
                    do {
                        $chunk = (string) fread($pipes[1], 8192);
                        $remaining = max(0, $limit - strlen($result['output']));
                        if (strlen($chunk) > $remaining) $result['truncated'] = true;
                        $result['output'] .= substr($chunk, 0, $remaining);
                        $status = proc_get_status($process);
                        if (!$status['running']) {
                            $result['status'] = $status['exitcode'] >= 0 ? $status['exitcode'] : ($status['signaled'] ? 128 + $status['termsig'] : 1);
                            // Drain the bounded remainder after the child exits.
                            for ($reads = 0; $reads <= (int) ceil($limit / 8192); $reads++) {
                                $chunk = fread($pipes[1], 8192);
                                if ($chunk === false || $chunk === '') break;
                                $remaining = max(0, $limit - strlen($result['output']));
                                if (strlen($chunk) > $remaining) $result['truncated'] = true;
                                $result['output'] .= substr($chunk, 0, $remaining);
                            }
                            break;
                        }
                        if (microtime(true) >= $deadline && !$result['timedOut']) {
                            $result['timedOut'] = true;
                            @proc_terminate($process, 15);
                            $kill_deadline = microtime(true) + 0.2;
                        }
                        if ($kill_deadline !== null && microtime(true) >= $kill_deadline) {
                            @proc_terminate($process, 9);
                            $kill_deadline = null;
                        }
                        usleep(10_000);
                    } while (true);
                } finally {
                    fclose($pipes[1]);
                    proc_close($process);
                }
                return $result;
            }
        }
        if (!$this->function_available('exec')) return $result;
        $env = $this->system_executable(['/usr/bin/env', '/bin/env']);
        if ($env === null) return $result;
        $command = escapeshellarg($env) . ' -i';
        foreach ($environment as $name => $value) $command .= ' ' . $name . '=' . escapeshellarg($value);
        foreach ($arguments as $argument) $command .= ' ' . escapeshellarg($argument);
        $timer = $this->system_executable(['/usr/bin/timeout', '/bin/timeout']);
        if ($timer !== null) $command = escapeshellarg($timer) . ' -k 1s ' . escapeshellarg((string) max(1, (int) ceil($timeout)) . 's') . ' ' . $command;
        $output = [];
        @exec($command . ' 2>&1', $output, $result['status']);
        $text = implode("\n", $output);
        $result['output'] = substr($text, 0, $limit);
        $result['truncated'] = strlen($text) > $limit;
        $result['timedOut'] = $timer !== null && $result['status'] === 124;
        return $result;
    }

    private function managed_runtime_enabled(): bool {
        $autostart = defined('KODETY_AGENT_AUTOSTART')
            ? KODETY_AGENT_AUTOSTART === true
            : true;
        $managed = defined('KODETY_AGENT_MANAGED_RUNTIME')
            ? KODETY_AGENT_MANAGED_RUNTIME === true
            : true;
        return apply_filters('kodety_agents_managed_runtime', $autostart && $managed) === true;
    }

    /** One bounded installation step; only an explicit POST advances it. */
    private function ensure_managed_runtime(): bool|array|WP_Error {
        if (!$this->managed_runtime_enabled()) return true;
        if (DIRECTORY_SEPARATOR === '\\') {
            return new WP_Error(
                'kodety_agents_runtime_platform',
                'O runtime privado do Agent ainda não oferece suporte a este sistema.',
                ['status' => 503]
            );
        }
        if (!$this->process_execution_available()) {
            return new WP_Error(
                'kodety_agents_exec_unavailable',
                'O host não permite iniciar processos com exec() ou proc_open().',
                ['status' => 503]
            );
        }

        $node = $this->runtime_component_status('node');
        $codex = $this->runtime_component_status('codex');
        if ($node === true && $codex === true && $this->current_runtime_installation() === null) return true;
        if ($this->runtime_binary_is_explicit('node') && $node !== true) return $node;
        if ($this->runtime_binary_is_explicit('codex') && $codex !== true) return $codex;

        $target = $this->managed_runtime_target();
        if (is_wp_error($target)) return $target;
        $manifest = $this->managed_runtime_manifest($target);
        if (is_wp_error($manifest)) return $manifest;
        $lock = $this->acquire_runtime_install_lock();
        if (is_wp_error($lock)) return $lock;
        try {
            // Another request may have completed installation while this one
            // waited for the lock.
            if ($this->runtime_component_status('node') === true
                && $this->runtime_component_status('codex') === true
                && $this->current_runtime_installation() === null) {
                return true;
            }
            if (function_exists('ignore_user_abort')) @ignore_user_abort(true);
            return $this->install_managed_runtime($manifest, $this->runtime_executables);
        } finally {
            $this->release_runtime_lock($lock);
        }
    }

    private function runtime_component_status(string $kind): bool|WP_Error {
        $binary = $this->resolve_runtime_executable($kind);
        return is_wp_error($binary) ? $binary : true;
    }

    private function runtime_binary_is_explicit(string $kind): bool {
        $constant_name = $kind === 'node' ? 'KODETY_AGENT_NODE_BINARY' : 'KODETY_CODEX_BINARY';
        if (!defined($constant_name)) return false;
        $value = constant($constant_name);
        return !is_string($value) || trim($value) !== '';
    }

    private function managed_runtime_target(): string|WP_Error {
        $os = match (PHP_OS_FAMILY) {
            'Linux' => 'linux',
            'Darwin' => 'darwin',
            default => '',
        };
        $machine = strtolower(trim((string) php_uname('m')));
        $architecture = match ($machine) {
            'x86_64', 'amd64' => 'x64',
            'aarch64', 'arm64' => 'arm64',
            default => '',
        };
        if ($os === '' || $architecture === '' || PHP_INT_SIZE < 8) {
            return new WP_Error(
                'kodety_agents_runtime_platform',
                'O sistema ou a arquitetura do servidor não é compatível com o runtime privado do Agent.',
                ['status' => 503]
            );
        }
        return $os . '-' . $architecture;
    }

    /**
     * @return array{
     *   target:string,
     *   nodeVersion:string,
     *   codexVersion:string,
     *   node:array{url:string,sha256:string,archivePath:string,maxBytes:int},
     *   codex:array{url:string,sha512:string,vendorPath:string,maxBytes:int}
     * }|WP_Error
     */
    private function managed_runtime_manifest(string $target): array|WP_Error {
        $path = KODETY_DIR . 'agent-runtime/runtime-manifest.json';
        $source = is_file($path) && is_readable($path) ? file_get_contents($path) : false;
        if (!is_string($source) || $source === '' || strlen($source) > 65_536) {
            return new WP_Error('kodety_agents_runtime_manifest', 'O manifesto do runtime não está disponível.', ['status' => 503]);
        }
        $decoded = json_decode($source, true);
        $node = is_array($decoded['node'] ?? null) ? $decoded['node'] : [];
        $codex = is_array($decoded['codex'] ?? null) ? $decoded['codex'] : [];
        $node_target = is_array($node['targets'][$target] ?? null) ? $node['targets'][$target] : [];
        $codex_target = is_array($codex['targets'][$target] ?? null) ? $codex['targets'][$target] : [];
        $node_version = is_string($node['version'] ?? null) ? $node['version'] : '';
        $codex_version = is_string($codex['version'] ?? null) ? $codex['version'] : '';
        $node_url = is_string($node_target['url'] ?? null) ? $node_target['url'] : '';
        $codex_url = is_string($codex_target['url'] ?? null) ? $codex_target['url'] : '';
        $node_hash = is_string($node_target['sha256'] ?? null) ? strtolower($node_target['sha256']) : '';
        $codex_hash = is_string($codex_target['sha512'] ?? null) ? $codex_target['sha512'] : '';
        $archive_path = is_string($node_target['archivePath'] ?? null) ? $node_target['archivePath'] : '';
        $vendor_path = is_string($codex_target['vendorPath'] ?? null) ? $codex_target['vendorPath'] : '';
        $node_max = (int) ($node['maxDownloadBytes'] ?? 0);
        $codex_max = (int) ($codex['maxDownloadBytes'] ?? 0);
        $codex_hash_bytes = base64_decode($codex_hash, true);
        if (
            (int) ($decoded['schemaVersion'] ?? 0) !== 1
            || preg_match('/^\d+\.\d+\.\d+$/D', $node_version) !== 1
            || preg_match('/^[0-9A-Za-z][0-9A-Za-z.+-]{1,79}$/D', $codex_version) !== 1
            || !$this->runtime_artifact_url($node_url, 'nodejs.org')
            || !$this->runtime_artifact_url($codex_url, 'registry.npmjs.org')
            || preg_match('/^[a-f0-9]{64}$/D', $node_hash) !== 1
            || !is_string($codex_hash_bytes)
            || strlen($codex_hash_bytes) !== 64
            || preg_match('#^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+$#D', $archive_path) !== 1
            || preg_match('#^package/vendor/[A-Za-z0-9._-]+$#D', $vendor_path) !== 1
            || $node_max < 10_485_760
            || $node_max > 157_286_400
            || $codex_max < 10_485_760
            || $codex_max > 262_144_000
        ) {
            return new WP_Error('kodety_agents_runtime_manifest', 'O manifesto do runtime é inválido.', ['status' => 503]);
        }
        return [
            'target' => $target,
            'nodeVersion' => $node_version,
            'codexVersion' => $codex_version,
            'node' => [
                'url' => $node_url,
                'sha256' => $node_hash,
                'archivePath' => $archive_path,
                'maxBytes' => $node_max,
            ],
            'codex' => [
                'url' => $codex_url,
                'sha512' => $codex_hash,
                'vendorPath' => $vendor_path,
                'maxBytes' => $codex_max,
            ],
        ];
    }

    private function runtime_artifact_url(string $url, string $expected_host): bool {
        if ($url === '' || strlen($url) > 500 || str_contains($url, "\0")) return false;
        $parts = wp_parse_url($url);
        return is_array($parts)
            && strtolower((string) ($parts['scheme'] ?? '')) === 'https'
            && strtolower((string) ($parts['host'] ?? '')) === $expected_host
            && (!isset($parts['port']) || (int) $parts['port'] === 443)
            && !isset($parts['user']) && !isset($parts['pass'])
            && !isset($parts['query']) && !isset($parts['fragment']);
    }

    private function managed_runtime_binary(string $kind): string {
        $target = $this->managed_runtime_target();
        if (is_wp_error($target)) return '';
        $manifest = $this->managed_runtime_manifest($target);
        if (is_wp_error($manifest)) return '';
        $directory = $this->managed_runtime_root() . '/' . $target;
        $marker = $this->read_runtime_state($directory . '/runtime.json');
        if (
            !is_array($marker)
            || ($marker['target'] ?? '') !== $target
            || ($marker['nodeVersion'] ?? '') !== $manifest['nodeVersion']
            || ($marker['codexVersion'] ?? '') !== $manifest['codexVersion']
            || ($marker['components'][$kind] ?? true) !== true
        ) {
            return '';
        }
        return $kind === 'node'
            ? $directory . '/node/bin/node'
            : $directory . '/codex/bin/codex';
    }

    /** @return array{handle:resource}|WP_Error */
    private function acquire_runtime_install_lock(): array|WP_Error {
        return $this->acquire_runtime_lock('runtime-install.lock', 'kodety_agents_runtime_install_busy');
    }

    /** @return array{handle:resource}|WP_Error */
    private function acquire_runtime_lock(string $name, string $busy_code): array|WP_Error {
        // An OS lock is released even when PHP is killed mid-request. A stale
        // database lease used to delay recovery after a hosting timeout.
        try {
            $path = $this->runtime_root() . '/' . $name;
        } catch (Throwable) {
            return new WP_Error('kodety_agents_bridge_config', 'Armazenamento privado indisponível.', ['status' => 503]);
        }
        if (is_link($path)) return new WP_Error('kodety_agents_runtime_integrity', 'Lock inválido.', ['status' => 503]);
        $handle = null;
        $would_block = 0;
        try {
            if (!$this->function_available('flock')) throw new RuntimeException('Lock indisponível.');
            $handle = @fopen($path, 'c');
            if ($handle === false) throw new RuntimeException('Lock indisponível.');
            $this->enforce_private_permissions($path, 0600, 'lock do Agent');
            if (@flock($handle, LOCK_EX | LOCK_NB, $would_block)) return ['handle' => $handle];
        } catch (Throwable) {
            $would_block = 0;
        }
        if (is_resource($handle)) fclose($handle);
        if ($would_block !== 1) {
            return new WP_Error('kodety_agents_runtime_lock_unavailable', 'Não foi possível proteger a instalação.', ['status' => 503]);
        }
        return new WP_Error(
            $busy_code,
            'Outro request já está preparando o runtime privado do Agent.',
            ['status' => 409, 'retryAfter' => 5]
        );
    }

    /** @param array{handle:resource} $lock */
    private function release_runtime_lock(array $lock): void {
        if (is_resource($lock['handle'])) {
            flock($lock['handle'], LOCK_UN);
            fclose($lock['handle']);
        }
    }

    private function runtime_install_directory(array $manifest): string {
        $fingerprint = substr(hash('sha256', (string) wp_json_encode($manifest)), 0, 16);
        return $this->runtime_root() . '/managed-runtime/.install-' . $manifest['target'] . '-' . $fingerprint;
    }

    private function read_runtime_state(string $path): ?array {
        if (@is_link($path) || !@is_file($path) || @filesize($path) > 16_384) return null;
        $source = @file_get_contents($path);
        $state = is_string($source) ? json_decode($source, true) : null;
        return is_array($state) ? $state : null;
    }

    private function write_runtime_state(string $path, array $state): bool {
        $temporary = $path . '.tmp';
        if (is_link($path) || is_link($temporary)) return false;
        $source = wp_json_encode($state, JSON_UNESCAPED_SLASHES);
        if (!is_string($source) || @file_put_contents($temporary, $source, LOCK_EX) !== strlen($source)) {
            @unlink($temporary);
            return false;
        }
        @chmod($temporary, 0600);
        if (!@rename($temporary, $path)) {
            @unlink($temporary);
            return false;
        }
        return true;
    }

    /** Reading config reports saved progress, but never downloads a block. */
    private function current_runtime_installation(): ?array {
        if (!$this->managed_runtime_enabled()) return null;
        try {
            $target = $this->managed_runtime_target();
            if (is_wp_error($target)) return null;
            $manifest = $this->managed_runtime_manifest($target);
            if (is_wp_error($manifest)) return null;
            $staging = $this->runtime_install_directory($manifest);
            if (!is_dir($staging) || is_link($staging) || (int) @filemtime($staging) < time() - self::RUNTIME_INSTALL_TTL) return null;
            $state = $this->read_runtime_state($staging . '/installation.json');
            return $state === null ? null : $this->runtime_installation_progress($manifest, $staging, $state);
        } catch (Throwable) {
            return null;
        }
    }

    /** Only public labels and byte counts cross the WordPress boundary. */
    private function runtime_installation_progress(array $manifest, string $staging, array $state): array {
        $phases = [
            'download_node' => 'Baixando Node.js em partes…',
            'extract_node' => 'Instalando Node.js…',
            'validate_node' => 'Verificando a execução do Node.js…',
            'download_codex' => 'Baixando Codex em partes…',
            'inspect_codex' => 'Conferindo o pacote Codex…',
            'extract_codex' => 'Instalando Codex…',
            'validate_codex' => 'Verificando a execução do Codex…',
            'activate' => 'Ativando o Agent…',
        ];
        $candidate = is_string($state['phase'] ?? null) ? $state['phase'] : '';
        $phase = isset($phases[$candidate]) ? $candidate : 'download_node';
        $message = $phases[$phase];
        if ($phase === 'validate_node' && !empty($state['external']['node'])) $message = 'Verificando o Node.js disponível na hospedagem…';
        if ($phase === 'validate_codex' && !empty($state['external']['codex'])) $message = 'Verificando o Codex disponível na hospedagem…';
        $step = array_search($phase, array_keys($phases), true) + 1;
        $downloaded = 0;
        $total = null;
        if (str_starts_with($phase, 'download_')) {
            $kind = $phase === 'download_node' ? 'node' : 'codex';
            $filename = $kind === 'node' ? '/node.tar.gz' : '/codex.tgz';
            $download = $this->read_runtime_state($staging . $filename . '.download.json') ?? [];
            $downloaded = max(0, min($manifest[$kind]['maxBytes'], (int) ($download['offset'] ?? 0)));
            $size = (int) ($download['total'] ?? 0);
            if ($size > 0 && $size <= $manifest[$kind]['maxBytes']) $total = $size;
            if ($total !== null && $downloaded === $total) {
                $phase = 'verify_' . $kind;
                $message = $kind === 'node' ? 'Verificando a integridade do Node.js…' : 'Verificando a integridade do Codex…';
            }
        }
        return [
            'phase' => $phase,
            'message' => $message,
            'step' => $step,
            'stepCount' => count($phases) + 2,
            'downloadedBytes' => $downloaded,
            'totalBytes' => $total,
            'resumable' => true,
            'retryAfterMs' => self::RUNTIME_DOWNLOAD_RETRY_AFTER_MS,
        ];
    }

    /**
     * @param array{
     *   target:string,
     *   nodeVersion:string,
     *   codexVersion:string,
     *   node:array{url:string,sha256:string,archivePath:string,maxBytes:int},
     *   codex:array{url:string,sha512:string,vendorPath:string,maxBytes:int}
     * } $manifest
     */
    private function install_managed_runtime(array $manifest, array $available = []): bool|array|WP_Error {
        $root = $this->runtime_root();
        $data_managed_root = $root . '/managed-runtime';
        $managed_root = $this->managed_runtime_root();
        $needs_managed_files = false;
        foreach (['node', 'codex'] as $kind) {
            $binary = $available[$kind] ?? null;
            if (!is_string($binary) || !$this->absolute_path($binary)
                || $this->path_is_within($binary, $managed_root) || $this->path_is_within($binary, $data_managed_root)) {
                $needs_managed_files = true;
            }
        }
        if ($needs_managed_files && $this->path_has_noexec($managed_root) === true) {
            if (!$this->select_executable_runtime_root()) {
                return new WP_Error('kodety_agents_runtime_noexec', 'A pasta privada não permite executar os binários.', ['status' => 503]);
            }
            $managed_root = $this->managed_runtime_root();
        }
        if (is_link($managed_root)) return new WP_Error('kodety_agents_runtime_integrity', 'Armazenamento inválido.', ['status' => 503]);
        $this->prepare_private_runtime_directory($managed_root);
        $this->prepare_private_runtime_directory($data_managed_root);
        $this->cleanup_stale_runtime_installs($managed_root);
        if ($managed_root !== $data_managed_root) $this->cleanup_stale_runtime_installs($data_managed_root);
        $staging = $this->runtime_install_directory($manifest);
        $execution_staging = $managed_root . '/' . basename($staging);
        if (is_link($staging)) return new WP_Error('kodety_agents_runtime_integrity', 'Área de instalação inválida.', ['status' => 503]);
        $free = @disk_free_space($managed_root);
        if (!is_dir($staging) && is_numeric($free) && (float) $free < self::MIN_RUNTIME_FREE_BYTES) {
            return new WP_Error('kodety_agents_runtime_disk', 'Não há espaço livre suficiente para instalar o runtime.', ['status' => 507]);
        }
        $tar = $this->system_executable(['/usr/bin/tar', '/bin/tar']);
        if ($tar === null) {
            return new WP_Error('kodety_agents_runtime_extract', 'O servidor não oferece um extrator de arquivos compatível.', ['status' => 503]);
        }

        $final = $managed_root . '/' . $manifest['target'];
        $state_path = $staging . '/installation.json';
        $state = $this->read_runtime_state($state_path) ?? [];
        if (($state['schemaVersion'] ?? null) !== 2) {
            // Upgrade old checkpoints without discarding verified archives.
            // Node is now validated before spending time downloading Codex.
            $state = ['schemaVersion' => 2, 'id' => bin2hex(random_bytes(12)), 'phase' => 'download_node'];
        }
        $final_marker = $this->read_runtime_state($final . '/runtime.json');
        if (($state['phase'] ?? '') === 'activate' && !is_dir($execution_staging)
            && is_string($state['id'] ?? null) && ($final_marker['installationId'] ?? null) === $state['id']) {
            return $this->finish_runtime_installation($staging, $execution_staging, $final, $data_managed_root);
        }
        $external = [];
        foreach (['node', 'codex'] as $kind) {
            $binary = $available[$kind] ?? null;
            // A previous managed install is swapped during activation and
            // cannot be treated as an independently installed host binary.
            if (is_string($binary) && $this->absolute_path($binary)
                && !$this->path_is_within($binary, $managed_root) && !$this->path_is_within($binary, $data_managed_root)) {
                $external[$kind] = $binary;
            }
            if (isset($state['external'][$kind]) && !isset($external[$kind])) $state['phase'] = 'download_node';
        }
        if (isset($state['executionRoot']) && $state['executionRoot'] !== $managed_root && $state['phase'] !== 'download_node') $state['phase'] = 'extract_node';
        $state['external'] = $external;
        $state['executionRoot'] = $managed_root;
        // Skipped steps do not download, copy or replace a working host runtime.
        $skip = [
            'download_node' => ['node', 'extract_node'], 'extract_node' => ['node', 'validate_node'],
            'download_codex' => ['codex', 'inspect_codex'], 'inspect_codex' => ['codex', 'extract_codex'],
            'extract_codex' => ['codex', 'validate_codex'],
        ];
        while (isset($skip[$state['phase'] ?? '']) && isset($external[$skip[$state['phase']][0]])) {
            $state['phase'] = $skip[$state['phase']][1];
        }
        $this->prepare_private_runtime_directory($staging);
        $this->prepare_private_runtime_directory($execution_staging);
        if (!wp_mkdir_p($execution_staging . '/node/bin') || !wp_mkdir_p($execution_staging . '/codex-package')) {
            return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível criar a área de instalação do runtime.', ['status' => 503]);
        }
        @touch($staging);
        @touch($execution_staging);
        if (!$this->write_runtime_state($state_path, $state)) {
            return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível salvar o progresso.', ['status' => 503]);
        }
        $node_archive = $staging . '/node.tar.gz';
        $codex_archive = $staging . '/codex.tgz';
        switch ($state['phase'] ?? null) {
        case 'download_node':
        case 'download_codex':
            $kind = $state['phase'] === 'download_node' ? 'node' : 'codex';
            $algorithm = $kind === 'node' ? 'sha256' : 'sha512';
            $download = $this->download_runtime_artifact(
                $manifest[$kind]['url'],
                $kind === 'node' ? $node_archive : $codex_archive,
                $algorithm,
                $manifest[$kind][$algorithm],
                $manifest[$kind]['maxBytes']
            );
            if (is_wp_error($download)) return $download;
            if (is_array($download)) return $this->runtime_installation_progress($manifest, $staging, $state);
            $state['phase'] = $kind === 'node' ? 'extract_node' : 'inspect_codex';
            break;
        case 'extract_node':
            $node_extracted = $this->run_tar($tar, [
                '-xzf',
                $node_archive,
                '-C',
                $execution_staging . '/node/bin',
                '--strip-components=2',
                $manifest['node']['archivePath'],
            ]);
            if (!$node_extracted || !is_file($execution_staging . '/node/bin/node')) {
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível extrair Node.js.', ['status' => 503]);
            }
            $state['phase'] = 'validate_node';
            break;
        case 'inspect_codex':
            if (!$this->tar_archive_is_safe($tar, $codex_archive, 'package/')) {
                return new WP_Error('kodety_agents_runtime_integrity', 'O pacote Codex contém caminhos não permitidos.', ['status' => 503]);
            }
            $state['phase'] = 'extract_codex';
            break;
        case 'extract_codex':
            // Extraction is replayable if the previous PHP request ended
            // before its phase marker was committed. Keep verified archives.
            $removed = $this->remove_managed_tree($execution_staging . '/codex', $execution_staging);
            if (is_wp_error($removed)) return $removed;
            $codex_extracted = $this->run_tar($tar, [
                '-xzf',
                $codex_archive,
                '-C',
                $execution_staging . '/codex-package',
            ]);
            $vendor = $execution_staging . '/codex-package/' . $manifest['codex']['vendorPath'];
            if (!$codex_extracted || !is_dir($vendor) || is_link($vendor)) {
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível extrair o Codex App Server.', ['status' => 503]);
            }
            if (!@rename($vendor, $execution_staging . '/codex')) {
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível finalizar a instalação do Codex.', ['status' => 503]);
            }
            $package_removed = $this->remove_managed_tree($execution_staging . '/codex-package', $execution_staging);
            if (is_wp_error($package_removed)) return $package_removed;
            $state['phase'] = 'validate_codex';
            break;
        case 'validate_node':
            $secured = $this->secure_managed_runtime_tree($execution_staging);
            if (is_wp_error($secured)) return $secured;
            $node_binary = $external['node'] ?? $execution_staging . '/node/bin/node';
            if (!isset($external['node'])) @chmod($node_binary, 0700);
            $node_valid = $this->validate_node_version($node_binary, $root);
            if (is_wp_error($node_valid)) {
                if (!isset($external['node']) && $node_valid->get_error_code() === 'kodety_agents_node_execution_denied' && $this->select_executable_runtime_root()) {
                    $state['phase'] = 'extract_node';
                    break;
                }
                return $node_valid;
            }
            $state['phase'] = 'download_codex';
            break;
        case 'validate_codex':
            $secured = $this->secure_managed_runtime_tree($execution_staging);
            if (is_wp_error($secured)) return $secured;
            $codex_binary = $external['codex'] ?? $execution_staging . '/codex/bin/codex';
            if (!isset($external['codex']) && !is_file($codex_binary)) {
                return new WP_Error('kodety_agents_runtime_extract', 'O executável Codex não foi encontrado no pacote.', ['status' => 503]);
            }
            if (!isset($external['codex'])) @chmod($codex_binary, 0700);
            $this->validated_node_path = $external['node'] ?? $execution_staging . '/node/bin/node';
            $codex_valid = $this->validate_codex_app_server($codex_binary, $root);
            if (is_wp_error($codex_valid)) {
                if (!isset($external['codex']) && $codex_valid->get_error_code() === 'kodety_agents_codex_execution_denied' && $this->select_executable_runtime_root()) {
                    $state['phase'] = 'extract_node';
                    break;
                }
                return $codex_valid;
            }
            $state['phase'] = 'activate';
            break;
        case 'activate':
            foreach (['node', 'codex'] as $kind) {
                if (!isset($external[$kind]) && !is_file($execution_staging . '/' . $kind . '/bin/' . $kind)) {
                    return new WP_Error('kodety_agents_runtime_integrity', 'Um componente verificado não está mais disponível.', ['status' => 503]);
                }
            }
            $marker = wp_json_encode([
                'schemaVersion' => 1,
                'target' => $manifest['target'],
                'nodeVersion' => $manifest['nodeVersion'],
                'codexVersion' => $manifest['codexVersion'],
                'installationId' => $state['id'],
                'components' => ['node' => !isset($external['node']), 'codex' => !isset($external['codex'])],
            ], JSON_UNESCAPED_SLASHES);
            if (!is_string($marker) || file_put_contents($execution_staging . '/runtime.json', $marker . "\n", LOCK_EX) === false) {
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível registrar o runtime instalado.', ['status' => 503]);
            }
            @chmod($execution_staging . '/runtime.json', 0600);
            foreach ([$node_archive, $codex_archive] as $archive) {
                foreach (['', '.download.json', '.part'] as $suffix) {
                    if (is_file($archive . $suffix) && !@unlink($archive . $suffix)) {
                        return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível limpar os pacotes temporários.', ['status' => 503]);
                    }
                }
            }
            $activated = $this->activate_managed_runtime_directory($execution_staging, $final, $managed_root);
            if (is_wp_error($activated)) return $activated;
            return $this->finish_runtime_installation($staging, $execution_staging, $final, $data_managed_root);
        default:
            return new WP_Error('kodety_agents_runtime_integrity', 'Etapa de instalação inválida.', ['status' => 503]);
        }
        if (!$this->write_runtime_state($state_path, $state)) {
            return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível salvar o progresso.', ['status' => 503]);
        }
        return $this->runtime_installation_progress($manifest, $staging, $state);
    }

    private function finish_runtime_installation(string $staging, string $execution_staging, string $final, string $data_managed_root): bool|WP_Error {
        @chmod($final, 0700);
        @unlink($final . '/installation.json');
        if ($staging !== $execution_staging) {
            $removed = $this->remove_managed_tree($staging, $data_managed_root);
            if (is_wp_error($removed)) return $removed;
        }
        $this->runtime_executables = [];
        $this->validated_node_path = null;
        return true;
    }

    private function activate_managed_runtime_directory(string $staging, string $final, string $managed_root): bool|WP_Error {
        $lock = $this->acquire_runtime_lock('bridge-start.lock', 'kodety_agents_start_in_progress');
        if (is_wp_error($lock)) return $lock;
        $backup = $final . '.previous';
        try {
            if (is_link($final) || is_link($backup) || is_link($staging) || !is_dir($staging)) {
                return new WP_Error('kodety_agents_runtime_integrity', 'Diretório de ativação inválido.', ['status' => 503]);
            }
            // Recover a previous activation interrupted between its two
            // renames. No existing runtime is recursively deleted to swap it.
            if (is_dir($backup) && !is_dir($final) && !@rename($backup, $final)) {
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível restaurar a instalação anterior.', ['status' => 503]);
            }
            if (is_dir($backup)) {
                $removed = $this->remove_managed_tree($backup, $managed_root);
                if (is_wp_error($removed)) return $removed;
            }
            $this->stop_bridge();
            $had_previous = is_dir($final);
            if ($had_previous && !@rename($final, $backup)) {
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível preservar a instalação anterior.', ['status' => 503]);
            }
            if (!@rename($staging, $final)) {
                if ($had_previous) @rename($backup, $final);
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível ativar a nova instalação. A cópia anterior foi preservada.', ['status' => 503]);
            }
            return true;
        } finally {
            $this->release_runtime_lock($lock);
        }
    }

    private function download_runtime_artifact(
        string $url,
        string $destination,
        string $algorithm,
        string $expected_hash,
        int $maximum_bytes
    ): bool|array|WP_Error {
        $metadata = $destination . '.download.json';
        $part = $destination . '.part';
        foreach ([$destination, $metadata, $metadata . '.tmp', $part] as $path) {
            if (is_link($path)) return new WP_Error('kodety_agents_runtime_integrity', 'Caminho de download inválido.', ['status' => 503]);
        }
        $fingerprint = hash('sha256', $url . '|' . $algorithm . '|' . $expected_hash . '|' . $maximum_bytes);
        $initial = ['fingerprint' => $fingerprint, 'offset' => 0, 'total' => 0, 'verified' => false];
        $state = $this->read_runtime_state($metadata);
        $output = @fopen($destination, 'c+b');
        if ($output === false) return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível gravar o download privado.', ['status' => 503]);
        @chmod($destination, 0600);
        try {
            $size = (int) (fstat($output)['size'] ?? 0);
            if (
                $state === null
                || ($state['fingerprint'] ?? '') !== $fingerprint
                || !is_int($state['offset'] ?? null)
                || !is_int($state['total'] ?? null)
                || $state['offset'] < 0
                || $state['total'] < $state['offset']
                || $state['total'] > $maximum_bytes
                || $size < $state['offset']
            ) {
                $state = $initial;
            }
            $offset = $state['offset'];
            // A request can die after appending bytes but before saving its
            // marker. Roll back only that uncommitted tail, never the prefix.
            if (($size !== $offset && !ftruncate($output, $offset)) || !$this->write_runtime_state($metadata, $state)) {
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível salvar o download privado.', ['status' => 503]);
            }
            if ($offset > 0 && $offset === $state['total']) {
                if (($state['verified'] ?? false) === true) return true;
                // Hashing is its own request, separate from the last network
                // block. Nothing is extracted or activated before this check.
                $raw_hash = @hash_file($algorithm, $destination, $algorithm === 'sha512');
                $actual_hash = $algorithm === 'sha512' && is_string($raw_hash)
                    ? base64_encode($raw_hash)
                    : (is_string($raw_hash) ? strtolower($raw_hash) : '');
                if ($actual_hash === '' || !hash_equals($expected_hash, $actual_hash)) {
                    ftruncate($output, 0);
                    $this->write_runtime_state($metadata, $initial);
                    return new WP_Error('kodety_agents_runtime_integrity', 'O componente não corresponde ao hash fixado na release.', ['status' => 503]);
                }
                $state['verified'] = true;
                if (!$this->write_runtime_state($metadata, $state)) {
                    return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível registrar a verificação.', ['status' => 503]);
                }
                return true;
            }

            $end = min($offset + self::RUNTIME_DOWNLOAD_CHUNK_BYTES, $maximum_bytes) - 1;
            $part_handle = @fopen($part, 'wb');
            if ($part_handle === false) return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível gravar um bloco privado.', ['status' => 503]);
            fclose($part_handle);
            @chmod($part, 0600);
            $response = wp_remote_get($url, [
                'timeout' => self::RUNTIME_DOWNLOAD_TIMEOUT,
                'httpversion' => '1.1',
                'redirection' => 0,
                'reject_unsafe_urls' => true,
                'sslverify' => true,
                'decompress' => false,
                'stream' => true,
                'filename' => $part,
                'limit_response_size' => self::RUNTIME_DOWNLOAD_CHUNK_BYTES + 1,
                'headers' => [
                    'Accept' => 'application/octet-stream',
                    'Accept-Encoding' => 'identity',
                    'Range' => 'bytes=' . $offset . '-' . $end,
                ],
            ]);
            if (is_wp_error($response)) return $this->runtime_download_error($response);
            $status = (int) wp_remote_retrieve_response_code($response);
            if ($status !== 200 && $status !== 206) {
                $reason = match ($status) {
                    401, 403 => 'kodety_agents_runtime_download_blocked',
                    404 => 'kodety_agents_runtime_download_missing',
                    default => 'kodety_agents_runtime_download',
                };
                return new WP_Error($reason, 'O servidor recusou um bloco do download.', ['status' => 503]);
            }
            clearstatcache(true, $part);
            $part_size = (int) @filesize($part);
            $encoding = wp_remote_retrieve_header($response, 'content-encoding');
            $whole_download = false;
            if ($status === 206) {
                if ($encoding !== '' && $encoding !== 'identity') {
                    return new WP_Error('kodety_agents_runtime_download', 'O bloco retornou uma codificação incompatível.', ['status' => 503]);
                }
                $range = wp_remote_retrieve_header($response, 'content-range');
                if ($range === '') {
                    // A few CDN edges return the requested slice with 206 but
                    // omit Content-Range. Without a trustworthy total, stage a
                    // bounded complete response and let the pinned hash decide.
                    $whole = $this->download_runtime_artifact_whole($url, $part, $maximum_bytes);
                    if (is_wp_error($whole)) return $whole;
                    $offset = 0;
                    $part_size = $whole;
                    $total = $whole;
                    $whole_download = true;
                } elseif (!is_string($range) || preg_match('/^bytes (\d+)-(\d+)\/(\d+)$/D', $range, $match) !== 1) {
                    return new WP_Error('kodety_agents_runtime_download', 'O servidor não informou corretamente o intervalo baixado.', ['status' => 503]);
                } else {
                    $start = (int) $match[1];
                    $last = (int) $match[2];
                    $total = (int) $match[3];
                    if (
                        $start !== $offset || $last < $start || $last !== min($end, $total - 1)
                        || $total < 1 || $total > $maximum_bytes
                        || $part_size !== $last - $start + 1
                        || ($state['total'] > 0 && $state['total'] !== $total)
                    ) {
                        return new WP_Error('kodety_agents_runtime_download', 'O bloco retornado não corresponde ao intervalo solicitado.', ['status' => 503]);
                    }
                }
            } else {
                // Some otherwise compatible CDNs and reverse proxies ignore
                // Range and answer with HTTP 200. Keep chunking as the default,
                // but retry this component once as a bounded whole-file stream.
                $total = $part_size;
                $content_length = wp_remote_retrieve_header($response, 'content-length');
                $complete_small_response = $offset === 0
                    && $part_size <= self::RUNTIME_DOWNLOAD_CHUNK_BYTES
                    && ($encoding === '' || $encoding === 'identity')
                    && ($content_length === '' || (is_numeric($content_length) && (int) $content_length === $part_size));
                if (!$complete_small_response) {
                    $whole = $this->download_runtime_artifact_whole($url, $part, $maximum_bytes);
                    if (is_wp_error($whole)) return $whole;
                    $offset = 0;
                    $part_size = $whole;
                    $total = $whole;
                    $whole_download = true;
                }
            }
            $part_limit = $whole_download ? $maximum_bytes : self::RUNTIME_DOWNLOAD_CHUNK_BYTES;
            if ($part_size < 1 || $part_size > $part_limit || $offset + $part_size > $maximum_bytes) {
                return new WP_Error('kodety_agents_runtime_download', 'O bloco possui tamanho inválido.', ['status' => 503]);
            }
            $input = @fopen($part, 'rb');
            if ($input === false) return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível ler o bloco privado.', ['status' => 503]);
            $copied = fseek($output, $offset) === 0 ? stream_copy_to_stream($input, $output, $part_size) : false;
            fclose($input);
            $next = ['fingerprint' => $fingerprint, 'offset' => $offset + $part_size, 'total' => $total, 'verified' => false];
            $truncated = !$whole_download || ($copied === $part_size && ftruncate($output, $part_size));
            if ($copied !== $part_size || !$truncated || !fflush($output) || !$this->write_runtime_state($metadata, $next)) {
                ftruncate($output, (int) ($state['offset'] ?? 0));
                return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível salvar o bloco baixado.', ['status' => 503]);
            }
            return $next;
        } finally {
            fclose($output);
            @unlink($part);
        }
    }

    /** Download a complete artifact only when a server ignores byte ranges. */
    private function download_runtime_artifact_whole(string $url, string $part, int $maximum_bytes): int|WP_Error {
        if ($this->function_available('set_time_limit')) @set_time_limit(self::RUNTIME_DOWNLOAD_FALLBACK_TIMEOUT + 30);
        $response = wp_remote_get($url, [
            'timeout' => self::RUNTIME_DOWNLOAD_FALLBACK_TIMEOUT,
            'httpversion' => '1.1',
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'sslverify' => true,
            'decompress' => false,
            'stream' => true,
            'filename' => $part,
            'limit_response_size' => $maximum_bytes + 1,
            'headers' => [
                'Accept' => 'application/octet-stream',
                'Accept-Encoding' => 'identity',
            ],
        ]);
        if (is_wp_error($response)) return $this->runtime_download_error($response);
        $status = (int) wp_remote_retrieve_response_code($response);
        if ($status !== 200) {
            $reason = match ($status) {
                401, 403 => 'kodety_agents_runtime_download_blocked',
                404 => 'kodety_agents_runtime_download_missing',
                default => 'kodety_agents_runtime_download',
            };
            return new WP_Error($reason, 'O servidor recusou o download compatível.', ['status' => 503]);
        }
        $encoding = wp_remote_retrieve_header($response, 'content-encoding');
        if ($encoding !== '' && $encoding !== 'identity') {
            return new WP_Error('kodety_agents_runtime_download', 'O download retornou uma codificação incompatível.', ['status' => 503]);
        }
        clearstatcache(true, $part);
        $size = (int) @filesize($part);
        $content_length = wp_remote_retrieve_header($response, 'content-length');
        if (
            $size < 1
            || $size > $maximum_bytes
            || ($content_length !== '' && (!is_numeric($content_length) || (int) $content_length !== $size))
        ) {
            return new WP_Error('kodety_agents_runtime_download', 'O download compatível ficou incompleto ou ultrapassou o limite permitido.', ['status' => 503]);
        }
        @chmod($part, 0600);
        return $size;
    }

    private function runtime_download_error(WP_Error $error): WP_Error {
        // Transport details can contain local certificate/proxy paths. Use
        // them only to classify the failure, never return the raw message.
        $detail = strtolower($error->get_error_message());
        $code = match (true) {
            str_contains($detail, 'curl error 28'), str_contains($detail, 'timed out'), str_contains($detail, 'timeout') => 'kodety_agents_runtime_download_timeout',
            str_contains($detail, 'curl error 6:'), str_contains($detail, 'resolve host'), str_contains($detail, 'getaddrinfo') => 'kodety_agents_runtime_download_dns',
            str_contains($detail, 'certificate'), str_contains($detail, 'ssl'), str_contains($detail, 'tls') => 'kodety_agents_runtime_download_tls',
            $error->get_error_code() === 'http_request_not_executed' => 'kodety_agents_runtime_download_blocked',
            default => 'kodety_agents_runtime_download',
        };
        return new WP_Error($code, 'Não foi possível baixar um bloco do Agent.', ['status' => 503]);
    }

    /** @param list<string> $arguments */
    private function run_tar(string $tar, array $arguments): bool {
        if (!$this->absolute_path($tar) || !$arguments) return false;
        $result = $this->run_runtime_process(array_merge([$tar], $arguments), $this->runtime_root(), 20.0);
        return $result['status'] === 0 && !$result['timedOut'];
    }

    private function tar_archive_is_safe(string $tar, string $archive, string $required_prefix): bool {
        if (!$this->absolute_path($tar) || !$this->absolute_path($archive)) return false;
        $result = $this->run_runtime_process([$tar, '-tzf', $archive], $this->runtime_root(), 20.0, 65_536);
        $output = explode("\n", trim($result['output']));
        if ($result['status'] !== 0 || $result['timedOut'] || $result['truncated'] || !$output || count($output) > 128) return false;
        foreach ($output as $entry) {
            $entry = trim((string) $entry);
            if ($entry === '' || str_starts_with($entry, '/') || str_contains($entry, "\0")) return false;
            $segments = explode('/', rtrim($entry, '/'));
            if (!$segments || in_array('..', $segments, true) || !str_starts_with($entry, $required_prefix)) return false;
        }
        return true;
    }

    private function secure_managed_runtime_tree(string $root): bool|WP_Error {
        try {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::SELF_FIRST
            );
            @chmod($root, 0700);
            foreach ($iterator as $item) {
                if (!$item instanceof SplFileInfo || $item->isLink()) {
                    return new WP_Error('kodety_agents_runtime_integrity', 'O runtime contém um caminho não permitido.', ['status' => 503]);
                }
                $path = $item->getPathname();
                if ($item->isDir()) {
                    @chmod($path, 0700);
                    continue;
                }
                if (!$item->isFile()) {
                    return new WP_Error('kodety_agents_runtime_integrity', 'O runtime contém um tipo de arquivo não permitido.', ['status' => 503]);
                }
                $mode = ($item->getPerms() & 0111) !== 0 ? 0700 : 0600;
                @chmod($path, $mode);
            }
            return true;
        } catch (Throwable) {
            return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível proteger os arquivos do runtime.', ['status' => 503]);
        }
    }

    private function remove_managed_tree(string $path, string $allowed_parent): bool|WP_Error {
        $path = $this->normalize_filesystem_path($path);
        $parent = rtrim($this->normalize_filesystem_path($allowed_parent), '/');
        if ($path === '' || $parent === '' || !str_starts_with($path, $parent . '/')) {
            return new WP_Error('kodety_agents_runtime_extract', 'O caminho de limpeza do runtime é inválido.', ['status' => 503]);
        }
        if (is_link($path) || is_file($path)) return @unlink($path)
            ? true
            : new WP_Error('kodety_agents_runtime_extract', 'Não foi possível limpar um arquivo temporário.', ['status' => 503]);
        if (!is_dir($path)) return true;
        try {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($iterator as $item) {
                $item_path = $item->getPathname();
                if ($item->isLink() || $item->isFile()) {
                    if (!@unlink($item_path)) throw new RuntimeException('unlink failed');
                } elseif ($item->isDir() && !@rmdir($item_path)) {
                    throw new RuntimeException('rmdir failed');
                }
            }
            if (!@rmdir($path)) throw new RuntimeException('root rmdir failed');
            return true;
        } catch (Throwable) {
            return new WP_Error('kodety_agents_runtime_extract', 'Não foi possível limpar a instalação anterior do runtime.', ['status' => 503]);
        }
    }

    private function cleanup_stale_runtime_installs(string $managed_root): void {
        $entries = @scandir($managed_root);
        if (!is_array($entries)) return;
        $cutoff = time() - self::RUNTIME_INSTALL_TTL;
        foreach ($entries as $entry) {
            if (preg_match('/^\.install-[a-z0-9-]+-[a-f0-9]{16}$/D', $entry) !== 1) continue;
            $path = $managed_root . '/' . $entry;
            $modified = @filemtime($path);
            if (!is_int($modified) || $modified >= $cutoff) continue;
            $this->remove_managed_tree($path, $managed_root);
        }
    }

    private function resolve_runtime_executable(string $kind): string|WP_Error {
        if (isset($this->runtime_executables[$kind])) return $this->runtime_executables[$kind];
        $is_node = $kind === 'node';
        $constant_name = $is_node ? 'KODETY_AGENT_NODE_BINARY' : 'KODETY_CODEX_BINARY';
        $configured = defined($constant_name) ? constant($constant_name) : null;
        if ($configured !== null && !is_string($configured)) {
            return new WP_Error(
                $is_node ? 'kodety_agents_node_invalid' : 'kodety_agents_codex_invalid',
                'O caminho do executável configurado é inválido.',
                ['status' => 503]
            );
        }
        $configured = is_string($configured) ? trim($configured) : '';
        if (
            $configured !== ''
            && (
                strlen($configured) > 500
                || str_contains($configured, "\0")
                || (!$this->absolute_path($configured) && preg_match('#^[A-Za-z0-9_.+-]+$#D', $configured) !== 1)
            )
        ) {
            return new WP_Error(
                $is_node ? 'kodety_agents_node_invalid' : 'kodety_agents_codex_invalid',
                'O caminho do executável configurado é inválido.',
                ['status' => 503]
            );
        }

        $candidates = [];
        if ($configured !== '' && $this->absolute_path($configured)) {
            $candidates[] = $configured;
        } else {
            $binary_name = $configured !== '' ? $configured : ($is_node ? 'node' : 'codex');
            if ($configured === '') {
                $managed = $this->managed_runtime_binary($kind);
                if ($managed !== '') $candidates[] = $managed;
            }
            foreach ($this->executable_search_directories() as $directory) {
                $candidates[] = $directory . '/' . $binary_name;
                if ($is_node && $configured === '') $candidates[] = $directory . '/nodejs';
            }
            if ($configured === '') {
                $candidates = array_merge(
                    $candidates,
                    $is_node ? $this->desktop_node_candidates() : $this->desktop_codex_candidates()
                );
            }
        }

        $first_error = null;
        $deadline = microtime(true) + 4.0;
        $root = $this->runtime_root();
        foreach (array_values(array_unique($candidates)) as $candidate) {
            if (microtime(true) >= $deadline) break;
            if (!$this->absolute_path($candidate)) continue;
            $visible_to_php = @is_file($candidate) && @is_executable($candidate);
            // Some managed/local WordPress stacks apply open_basedir to PHP's
            // filesystem functions while still allowing exec() to launch a
            // trusted absolute executable. Probe through the same shell path
            // that will start the sidecar before declaring the runtime absent.
            if (!$visible_to_php && ((string) ini_get('open_basedir') === '' || !$this->shell_path_is_executable($candidate))) continue;
            $resolved = @realpath($candidate);
            $binary = is_string($resolved) && $resolved !== '' && $this->absolute_path($resolved) ? $resolved : $candidate;
            $remaining = $deadline - microtime(true);
            if ($remaining < 0.1) break;
            $valid = $is_node
                ? $this->validate_node_version($binary, $root, min(3.0, $remaining))
                : $this->validate_codex_app_server($binary, $root, min(3.0, $remaining));
            if ($valid === true) return $this->runtime_executables[$kind] = $binary;
            $first_error ??= $valid;
        }
        if ($first_error !== null) return $first_error;
        return new WP_Error(
            $is_node ? 'kodety_agents_node_missing' : 'kodety_agents_codex_missing',
            $is_node
                ? 'Node.js 18 ou superior não foi encontrado.'
                : 'O Codex CLI com suporte a app-server não foi encontrado.',
            ['status' => 503]
        );
    }

    private function shell_path_is_executable(string $path): bool {
        if (!$this->absolute_path($path)) return false;
        if (!$this->function_available('exec')) {
            if (!$this->bounded_process_api_available()) return false;
            $result = $this->run_runtime_process(['/bin/sh', '-c', 'test -f ' . escapeshellarg($path) . ' -a -x ' . escapeshellarg($path)], $this->runtime_root(), 1.0, 1024, false);
            return $result['status'] === 0;
        }
        $output = [];
        $status = 1;
        exec('test -f ' . escapeshellarg($path) . ' -a -x ' . escapeshellarg($path), $output, $status);
        return $status === 0;
    }

    /** @return list<string> */
    private function executable_search_directories(): array {
        $directories = [];
        $path = (string) getenv('PATH');
        foreach (explode(PATH_SEPARATOR, $path) as $candidate) {
            $candidate = rtrim(trim($candidate), '/\\');
            if (
                $this->absolute_path($candidate)
                && @is_dir($candidate)
                && $this->directory_is_safe_for_executable_search($candidate)
            ) {
                $directories[] = $candidate;
            }
        }
        $directories = array_merge($directories, [
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/usr/bin',
            '/bin',
            '/snap/bin',
        ]);
        // Control panels often keep their supported Node outside PHP-FPM's
        // PATH. Prefer newer majors, but validate every binary before choosing.
        foreach ([24, 22, 20, 18] as $major) {
            $directories[] = '/opt/alt/alt-nodejs' . $major . '/root/usr/bin';
            $directories[] = '/opt/cpanel/ea-nodejs' . $major . '/bin';
            $directories[] = '/opt/plesk/node/' . $major . '/bin';
        }
        $home = (string) getenv('HOME');
        if ($this->absolute_path($home)) {
            $home = rtrim($home, '/\\');
            $directories[] = $home . '/.local/bin';
            $directories[] = $home . '/.volta/bin';
            foreach ([$home . '/.nvm/versions/node', $home . '/.local/share/fnm/node-versions'] as $versions) {
                if (!$this->directory_is_safe_for_executable_search($versions)) continue;
                $entries = @scandir($versions);
                if (!is_array($entries)) continue;
                $entries = array_values(array_filter($entries, static fn(string $entry): bool => preg_match('/^v\d+\.\d+\.\d+$/D', $entry) === 1));
                usort($entries, static fn(string $left, string $right): int => version_compare(substr($right, 1), substr($left, 1)));
                foreach (array_slice($entries, 0, 8) as $entry) {
                    $directories[] = $versions . '/' . $entry . (str_contains($versions, '/fnm/') ? '/installation/bin' : '/bin');
                }
            }
        }
        return array_values(array_unique(array_filter(
            $directories,
            fn(string $directory): bool => $this->absolute_path($directory)
                && (!@is_dir($directory) || $this->directory_is_safe_for_executable_search($directory))
        )));
    }

    /** @return list<string> */
    private function desktop_node_candidates(): array {
        $candidates = [
            '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node',
            '/Applications/Codex.app/Contents/Resources/cua_node/bin/node',
        ];
        $home = (string) getenv('HOME');
        if ($this->absolute_path($home)) {
            $home = rtrim($home, '/\\');
            $candidates[] = $home . '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node';
            $candidates[] = $home . '/Applications/Codex.app/Contents/Resources/cua_node/bin/node';
        }
        return $candidates;
    }

    /** @return list<string> */
    private function desktop_codex_candidates(): array {
        $candidates = [
            '/Applications/ChatGPT.app/Contents/Resources/codex',
            '/Applications/Codex.app/Contents/Resources/codex',
        ];
        $home = (string) getenv('HOME');
        if ($this->absolute_path($home)) {
            $home = rtrim($home, '/\\');
            $candidates[] = $home . '/Applications/ChatGPT.app/Contents/Resources/codex';
            $candidates[] = $home . '/Applications/Codex.app/Contents/Resources/codex';
        }
        return $candidates;
    }

    private function validate_node_version(string $node, string $runtime_root, float $timeout = 3.0): bool|WP_Error {
        $result = $this->run_runtime_process([$node, '--version'], $runtime_root, $timeout);
        $version = trim($result['output']);
        if ($result['status'] !== 0 || $result['timedOut'] || $result['truncated'] || preg_match('/(?:^|\s)v?(\d+)(?:\.\d+){1,2}(?:\s|$)/', $version, $match) !== 1) {
            return $this->runtime_execution_error('node', $result, 'invalid');
        }
        if ((int) $match[1] < 18) {
            return new WP_Error(
                'kodety_agents_node_too_old',
                'O Agent requer Node.js 18 ou superior.',
                ['status' => 503]
            );
        }
        $this->validated_node_path = $node;
        return true;
    }

    private function validate_codex_app_server(string $codex, string $runtime_root, float $timeout = 3.0): bool|WP_Error {
        $result = $this->run_runtime_process([$codex, 'app-server', '--help'], $runtime_root, $timeout);
        if ($result['status'] !== 0 || $result['timedOut'] || $result['truncated'] || !str_contains(strtolower($result['output']), 'app-server')) {
            return $this->runtime_execution_error('codex', $result, 'app_server_unsupported');
        }
        return true;
    }

    private function runtime_execution_error(string $kind, array $result, string $fallback): WP_Error {
        $detail = strtolower((string) ($result['output'] ?? ''));
        $status = (int) ($result['status'] ?? 1);
        $reason = match (true) {
            !empty($result['timedOut']) => 'probe_timeout',
            str_contains($detail, 'permission denied'), str_contains($detail, 'operation not permitted') => 'execution_denied',
            str_contains($detail, 'glibc'), str_contains($detail, 'cxxabi'), str_contains($detail, 'shared libraries'),
            str_contains($detail, 'library not loaded'), str_contains($detail, 'symbol not found'),
            str_contains($detail, 'no such file or directory'), str_contains($detail, 'bad interpreter') => 'system_incompatible',
            $status === 132, str_contains($detail, 'exec format'), str_contains($detail, 'bad cpu'),
            str_contains($detail, 'cannot execute binary'), str_contains($detail, 'wrong elf') => 'architecture',
            $status === 137, str_contains($detail, 'cannot allocate memory'), str_contains($detail, 'out of memory'),
            str_contains($detail, 'resource temporarily unavailable'), str_contains($detail, 'pthread_create') => 'resources',
            default => $fallback,
        };
        return new WP_Error('kodety_agents_' . $kind . '_' . $reason, 'Não foi possível executar o componente do Agent.', ['status' => 503]);
    }

    private function runtime_executable_path(string $node, string $codex): string {
        return $this->minimal_executable_path([$node, $codex]);
    }

    /** @param list<string> $executables */
    private function minimal_executable_path(array $executables): string {
        $directories = array_map('dirname', $executables);
        $directories = array_merge($directories, [
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/usr/bin',
            '/bin',
            '/snap/bin',
        ]);
        return implode(PATH_SEPARATOR, array_values(array_unique(array_filter(
            $directories,
            fn(string $directory): bool => $this->absolute_path($directory)
        ))));
    }

    /** @param list<string> $candidates */
    private function system_executable(array $candidates): ?string {
        foreach ($candidates as $candidate) {
            if ((!@is_file($candidate) || !@is_executable($candidate)) && !$this->shell_path_is_executable($candidate)) continue;
            $resolved = @realpath($candidate);
            if (is_string($resolved) && $resolved !== '' && $this->absolute_path($resolved)) return $resolved;
            if ($this->absolute_path($candidate)) return $candidate;
        }
        return null;
    }

    private function directory_is_safe_for_executable_search(string $directory): bool {
        if (DIRECTORY_SEPARATOR === '\\') return false;
        $permissions = @fileperms($directory);
        // Never discover a privileged runtime executable through a directory
        // writable by every local account (for example /tmp in a poisoned PATH).
        return is_int($permissions) && ($permissions & 0002) === 0;
    }

    private function absolute_path(string $path): bool {
        if ($path === '' || str_contains($path, "\0")) return false;
        if (DIRECTORY_SEPARATOR === '\\') return preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1;
        return str_starts_with($path, '/');
    }

    private function normalize_filesystem_path(string $path): string {
        $path = str_replace('\\', '/', trim($path));
        $prefix = '';
        if (preg_match('#^[A-Za-z]:/#', $path, $match)) {
            $prefix = strtoupper(substr($match[0], 0, 2)) . '/';
            $path = substr($path, 3);
        } elseif (str_starts_with($path, '/')) {
            $prefix = '/';
            $path = ltrim($path, '/');
        }
        $segments = [];
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.') continue;
            if ($segment === '..') {
                if ($segments) array_pop($segments);
                continue;
            }
            $segments[] = $segment;
        }
        return $prefix . implode('/', $segments);
    }

    private function path_is_within(string $path, string $root): bool {
        $path = rtrim($this->normalize_filesystem_path($path), '/');
        $root = rtrim($this->normalize_filesystem_path($root), '/');
        if ($path === '' || $root === '') return false;
        if (DIRECTORY_SEPARATOR === '\\') {
            $path = strtolower($path);
            $root = strtolower($root);
        }
        return $path === $root || str_starts_with($path, $root . '/');
    }
}
