<?php

defined('ABSPATH') || exit;

/** One allow-listed transport for the Agent and MCP over the native REST APIs.
 * Authorization, project scope, revisions, leases, locks and persistence stay
 * in the native route. This class never invokes route callbacks directly,
 * switches users, fabricates a nonce/lease or accepts a caller-selected URL.
 */
final class Kodety_Native_Operations {
    private static ?self $instance = null;
    private static bool $dispatching_read_only = false;
    /** @var SplObjectStorage<WP_REST_Request,array{context:WP_REST_Request,ownerId:int}>|null */
    private static ?SplObjectStorage $authenticated_mcp_requests = null;
    private const MAX_BODY_BYTES = 64_000_000;
    private const CONTEXT_HEADERS = [
        'x-wp-nonce',
        'x-kodety-share',
        'x-kodety-invite',
        'x-kodety-editor-session',
        'x-kodety-editor-lease',
        'x-kodety-expected-revision',
        'x-kodety-css-digest',
        'x-kodety-project-digest',
    ];

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    /** @return array{schemaVersion:int,operations:list<array<string,mixed>>} */
    public static function catalog(): array {
        static $catalog = null;
        if (is_array($catalog)) return $catalog;
        $path = dirname(__DIR__) . '/agent-runtime/native-operations.json';
        $source = file_get_contents($path);
        $candidate = is_string($source) ? json_decode($source, true) : null;
        if (!is_array($candidate) || ($candidate['schemaVersion'] ?? null) !== 1
            || !is_array($candidate['operations'] ?? null)) {
            throw new RuntimeException('The native operation catalog is unavailable.');
        }
        $seen = [];
        foreach ($candidate['operations'] as $operation) {
            if (!is_array($operation)
                || !preg_match('/^[a-z][a-z0-9_]+$/D', (string) ($operation['name'] ?? ''))
                || isset($seen[$operation['name']])
                || !in_array($operation['method'] ?? '', ['GET', 'POST', 'PUT', 'DELETE'], true)
                || !preg_match('#^/kodety/v1/[a-zA-Z0-9_/{}/-]+$#D', (string) ($operation['route'] ?? ''))
                || str_starts_with($operation['route'], '/kodety/v1/automation')
                || ($operation['inputSchema']['type'] ?? '') !== 'object'
                || ($operation['inputSchema']['additionalProperties'] ?? null) !== false
                || !is_bool($operation['readOnly'] ?? null)
                || $operation['readOnly'] !== ($operation['method'] === 'GET')
                || !is_bool($operation['destructive'] ?? null)
                || !is_bool($operation['affectsWorkspace'] ?? null)) {
                throw new RuntimeException('The native operation catalog is invalid.');
            }
            $seen[$operation['name']] = true;
        }
        return $catalog = $candidate;
    }

    public function register_routes(): void {
        register_rest_route('kodety/v1', '/automation/tools', [
            'methods' => 'GET',
            'callback' => [$this, 'tools_rest'],
            'permission_callback' => [$this, 'authenticated_permission'],
        ]);
        register_rest_route('kodety/v1', '/automation/call', [
            'methods' => 'POST',
            'callback' => [$this, 'call_rest'],
            'permission_callback' => [$this, 'authenticated_permission'],
        ]);
    }

    /** Authentication here is only the outer gate. Each native route still
     * runs its own permission callback and REST dispatch filters. */
    public function authenticated_permission(): bool|WP_Error {
        return is_user_logged_in() ? true : new WP_Error(
            'kodety_automation_unauthorized', 'Authentication is required.', ['status' => 401]
        );
    }

    /** The POST wrapper is a read only when the exact catalog operation and
     * entire envelope validate. Unknown/malformed requests fail closed. */
    public static function request_is_read_only(WP_REST_Request $request): bool {
        if (in_array(strtoupper($request->get_method()), ['GET', 'HEAD', 'OPTIONS'], true)) return true;
        if ($request->get_method() !== 'POST'
            || $request->get_route() !== '/kodety/v1/automation/call'
            || strlen($request->get_body()) > self::MAX_BODY_BYTES) return false;
        $payload = $request->get_json_params();
        if (!is_array($payload)
            || array_diff(array_keys($payload), ['operation', 'arguments']) !== []
            || !is_string($payload['operation'] ?? null)
            || !is_array($payload['arguments'] ?? null)) return false;
        try {
            foreach (self::catalog()['operations'] as $operation) {
                if ($operation['name'] === $payload['operation']) {
                    return $operation['readOnly'] === true
                        && self::validate($payload['arguments'], $operation['inputSchema'], 'arguments') === null;
                }
            }
        } catch (Throwable) {
            return false;
        }
        return false;
    }

    /** Only true during a catalog-validated internal GET. This lets the
     * existing shared-view capability filter use the actual native method
     * instead of mistaking the outer HTTP POST for a write. */
    public static function is_dispatching_read_only(): bool {
        return self::$dispatching_read_only;
    }

    /** A nonce belongs to browser-cookie authentication. Native integrations
     * may instead accept a bearer request that the MCP authenticator actually
     * verified. The marker is attached to this exact in-process request object
     * only during REST dispatch; no HTTP header can create or copy it. */
    public static function is_authenticated_mcp_request(WP_REST_Request $request): bool {
        if (self::$authenticated_mcp_requests === null
            || !self::$authenticated_mcp_requests->contains($request)) return false;
        $record = self::$authenticated_mcp_requests[$request];
        return $record['ownerId'] > 0
            && $record['ownerId'] === get_current_user_id()
            && self::authenticated_mcp_context($record['context']);
    }

    private static function authenticated_mcp_context(?WP_REST_Request $request): bool {
        return $request !== null
            && class_exists('Kodety_MCP')
            && method_exists('Kodety_MCP', 'is_authenticated_native_context')
            && Kodety_MCP::instance()->is_authenticated_native_context($request);
    }

    public function tools_rest(): WP_REST_Response|WP_Error {
        try {
            $response = new WP_REST_Response(self::catalog());
            $response->header('Cache-Control', 'private, no-store');
            return $response;
        } catch (Throwable $error) {
            return new WP_Error('kodety_automation_unavailable', $error->getMessage(), ['status' => 503]);
        }
    }

    public function call_rest(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (strlen($request->get_body()) > self::MAX_BODY_BYTES) {
            return new WP_Error('kodety_automation_too_large', 'The operation exceeds the 64 MB limit.', ['status' => 413]);
        }
        $payload = $request->get_json_params();
        if (!is_array($payload)
            || array_diff(array_keys($payload), ['operation', 'arguments']) !== []
            || !is_string($payload['operation'] ?? null)
            || !is_array($payload['arguments'] ?? null)) {
            return new WP_Error('kodety_automation_invalid_call', 'Send only operation and arguments.', ['status' => 400]);
        }
        return $this->execute($payload['operation'], $payload['arguments'], $request);
    }

    public function execute(
        string $operation,
        array $arguments,
        ?WP_REST_Request $context = null
    ): WP_REST_Response|WP_Error {
        $permission = $this->authenticated_permission();
        if (is_wp_error($permission)) return $permission;
        try {
            $definition = null;
            foreach (self::catalog()['operations'] as $candidate) {
                if ($candidate['name'] === $operation) {
                    $definition = $candidate;
                    break;
                }
            }
        } catch (Throwable $error) {
            return new WP_Error('kodety_automation_unavailable', $error->getMessage(), ['status' => 503]);
        }
        if ($definition === null) {
            return new WP_Error('kodety_automation_unknown_operation', 'Unknown native operation.', ['status' => 404]);
        }
        $invalid = self::validate($arguments, $definition['inputSchema'], 'arguments');
        if ($invalid !== null) {
            return new WP_Error('kodety_automation_invalid_arguments', $invalid, ['status' => 400]);
        }
        foreach ($definition['inputSchema']['properties'] as $key => $schema) {
            if (!array_key_exists($key, $arguments) && array_key_exists('default', $schema)) {
                $arguments[$key] = $schema['default'];
            }
        }
        $provided_context = $arguments['context'] ?? [];
        unset($arguments['context']);
        $headers = [];
        if ($context !== null) {
            foreach (self::CONTEXT_HEADERS as $name) {
                $value = trim((string) $context->get_header($name));
                if ($value !== '') $headers[$name] = $value;
            }
        }
        foreach ([
            'editorSession' => 'x-kodety-editor-session',
            'editorLease' => 'x-kodety-editor-lease',
            'expectedWorkspaceRevision' => 'x-kodety-expected-revision',
        ] as $key => $header) {
            if (!array_key_exists($key, $provided_context)) continue;
            $value = (string) $provided_context[$key];
            if (isset($headers[$header]) && !hash_equals($headers[$header], $value)) {
                return new WP_Error('kodety_automation_context_conflict', 'Operation context differs from the authenticated request.', ['status' => 409, 'field' => $key]);
            }
            $headers[$header] = $value;
        }

        $route = preg_replace_callback('/\{([a-z_]+)\}/', static function (array $match) use (&$arguments): string {
            $value = rawurlencode((string) $arguments[$match[1]]);
            unset($arguments[$match[1]]);
            return $value;
        }, $definition['route']);
        if (!is_string($route) || str_contains($route, '{') || str_contains($route, '}')) {
            return new WP_Error('kodety_automation_invalid_route', 'The native route is incomplete.', ['status' => 500]);
        }
        $native = new WP_REST_Request($definition['method'], $route);
        foreach ($headers as $name => $value) $native->set_header($name, $value);
        if ($operation === 'project_apply_delta') {
            // project_get_settings returns collapsed project-relative paths.
            // Root mode participates in the native delta receipt fingerprint.
            $native->set_header('X-Kodety-Delta-Root', 'project');
        }
        if ($definition['readOnly']) {
            $native->set_query_params($arguments);
        } else {
            $encoded = wp_json_encode($arguments, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!is_string($encoded) || strlen($encoded) > self::MAX_BODY_BYTES) {
                return new WP_Error('kodety_automation_too_large', 'The operation exceeds the 64 MB limit.', ['status' => 413]);
            }
            $native->set_header('Content-Type', 'application/json');
            $native->set_body($encoded);
        }
        // Full REST dispatch is intentional: permission_callback,
        // rest_request_before_callbacks and rest_dispatch_request must run.
        $authenticated_mcp = self::authenticated_mcp_context($context);
        $previous_read_only = self::$dispatching_read_only;
        self::$dispatching_read_only = $definition['readOnly'];
        if ($authenticated_mcp) {
            self::$authenticated_mcp_requests ??= new SplObjectStorage();
            self::$authenticated_mcp_requests[$native] = [
                'context' => $context,
                'ownerId' => get_current_user_id(),
            ];
        }
        try {
            $response = rest_do_request($native);
        } finally {
            if ($authenticated_mcp) self::$authenticated_mcp_requests->detach($native);
            self::$dispatching_read_only = $previous_read_only;
        }
        if (is_wp_error($response)) return $response;
        $response = rest_ensure_response($response);
        if ($operation === 'localization_get' && $response->get_status() < 400) {
            $data = $response->get_data();
            if (!empty($data['requiresFullProject'])) {
                return new WP_Error('kodety_automation_full_project_required', 'This project requires the full authoring transport to read localization.', ['status' => 409]);
            }
            $text = $data['project']['files']['.incode/project.json']['text'] ?? null;
            $metadata = is_string($text) ? json_decode($text, true) : null;
            if (!is_array($metadata)) {
                return new WP_Error('kodety_automation_metadata_unavailable', 'Native project metadata is unavailable.', ['status' => 409]);
            }
            $response->set_data([
                'localization' => $metadata['localization'] ?? null,
                'workspaceRevision' => $data['workspaceRevision'] ?? null,
                'workspaceDigest' => $data['workspaceDigest'] ?? '',
            ]);
        }
        // Native settings routes already return public payloads. Keep a
        // defense-in-depth key filter if an integration extends its response.
        if (str_starts_with($operation, 'ai_settings_')
            || str_starts_with($operation, 'adobe_fonts_')
            || str_starts_with($operation, 'meta_capi_')) {
            $response->set_data(self::redact_secrets($response->get_data()));
        }
        $response->header('Cache-Control', 'private, no-store');
        return $response;
    }

    /** Validate the published JSON Schema subset without coercing bad types.
     * Semantic CMS/localization/delta checks remain in their native writers. */
    private static function validate(mixed $value, array $schema, string $path, int $depth = 0): ?string {
        if ($depth > 40) return $path . ' is nested too deeply.';
        $types = (array) ($schema['type'] ?? []);
        $matched = $types === [];
        foreach ($types as $type) {
            $matched = $matched || match ($type) {
                'object' => is_array($value) && ($value === [] || !self::is_list($value)),
                'array' => is_array($value) && self::is_list($value),
                'string' => is_string($value),
                'integer' => is_int($value),
                'number' => (is_int($value) || is_float($value)) && is_finite((float) $value),
                'boolean' => is_bool($value),
                'null' => $value === null,
                default => false,
            };
        }
        if (!$matched) return $path . ' has an invalid type.';
        if (isset($schema['enum']) && !in_array($value, $schema['enum'], true)) return $path . ' has an unsupported value.';
        if (is_string($value)) {
            $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
            if (isset($schema['minLength']) && $length < $schema['minLength']) return $path . ' is too short.';
            if (isset($schema['maxLength']) && $length > $schema['maxLength']) return $path . ' is too long.';
            if (isset($schema['pattern']) && preg_match('~' . str_replace('~', '\\~', $schema['pattern']) . '~D', $value) !== 1) return $path . ' has an invalid format.';
        }
        if (is_int($value) || is_float($value)) {
            if (isset($schema['minimum']) && $value < $schema['minimum']) return $path . ' is below its minimum.';
            if (isset($schema['maximum']) && $value > $schema['maximum']) return $path . ' exceeds its maximum.';
            if (isset($schema['exclusiveMinimum']) && $value <= $schema['exclusiveMinimum']) return $path . ' must exceed its minimum.';
        }
        if (is_array($value) && in_array('object', $types, true)) {
            foreach ($schema['required'] ?? [] as $key) {
                if (!array_key_exists($key, $value)) return $path . '.' . $key . ' is required.';
            }
            foreach ($value as $key => $entry) {
                if (!is_string($key)) return $path . ' must use string property names.';
                $child = $schema['properties'][$key] ?? null;
                if (!is_array($child)) {
                    if (($schema['additionalProperties'] ?? true) === false) return $path . '.' . $key . ' is not supported.';
                    $child = is_array($schema['additionalProperties'] ?? null) ? $schema['additionalProperties'] : [];
                }
                $error = self::validate($entry, $child, $path . '.' . $key, $depth + 1);
                if ($error !== null) return $error;
            }
        } elseif (is_array($value) && in_array('array', $types, true)) {
            if (isset($schema['minItems']) && count($value) < $schema['minItems']) return $path . ' needs more items.';
            if (isset($schema['maxItems']) && count($value) > $schema['maxItems']) return $path . ' contains too many items.';
            foreach ($value as $index => $entry) {
                $error = self::validate($entry, $schema['items'] ?? [], $path . '[' . $index . ']', $depth + 1);
                if ($error !== null) return $error;
            }
        }
        return null;
    }

    private static function is_list(array $value): bool {
        return $value === [] || array_keys($value) === range(0, count($value) - 1);
    }

    private static function redact_secrets(mixed $data): mixed {
        if (!is_array($data)) return $data;
        foreach ($data as $key => $value) {
            $normalized = strtolower(str_replace(['_', '-'], '', (string) $key));
            if (in_array($normalized, ['apikey', 'accesstoken', 'refreshtoken', 'clientsecret', 'password', 'authorization', 'secret', 'secrets'], true)) {
                unset($data[$key]);
            } else {
                $data[$key] = self::redact_secrets($value);
            }
        }
        return $data;
    }
}
