<?php

defined('ABSPATH') || exit;

/**
 * Opt-in, local performance diagnostics for the authenticated Onun Kodety editor.
 *
 * The feature deliberately has no remote transport. It emits one redacted JSON
 * line and response timing headers only when KODETY_PERFORMANCE_DEBUG is the
 * literal boolean true and the current, non-shared request is an administrator.
 */
final class Kodety_Observability {
    private const OPERATION_HEADER = 'X-Kodety-Operation-Id';
    private const OPERATION_ID_PATTERN = '/\A(?:obs|trace)-[0-9a-f]{32}\z/D';

    private const OPERATIONS = [
        'bootstrap',
        'config',
        'surface',
        'asset',
        'project_download',
        'unzip',
        'parse',
        'mount',
        'save',
        'publish',
    ];

    private const RESULTS = [
        'ok',
        'error',
        'aborted',
        'http_error',
        'not_modified',
        'cache_hit',
        'cache_miss',
        'fallback',
        'skipped',
    ];

    /** @var array<string,array{operation:string,operationId:string,startedAt:int}> */
    private static array $requests = [];

    /** @var null|array{operation:string,operationId:string,startedAt:int} */
    private static ?array $admin_post_request = null;

    /** @var null|callable(string):void */
    private static $log_sink = null;

    /** @var null|callable(string,string,bool):void */
    private static $header_sink = null;

    public static function register(): void {
        // Zero hooks and zero request work unless the explicit feature flag is
        // the literal boolean true. WP_DEBUG and filters cannot enable it.
        if (!self::flag_enabled() || !function_exists('add_filter')) return;
        add_filter('rest_request_before_callbacks', [self::class, 'before_callbacks'], 10, 3);
        add_filter('rest_post_dispatch', [self::class, 'finish_dispatch'], 10, 3);
        if (function_exists('add_action')) {
            add_action(
                'admin_post_kodety_download_editor_project',
                [self::class, 'before_admin_post_download'],
                0
            );
            add_action('shutdown', [self::class, 'finish_admin_post_download'], PHP_INT_MAX);
        }
    }

    private static function flag_enabled(): bool {
        return defined('KODETY_PERFORMANCE_DEBUG') && KODETY_PERFORMANCE_DEBUG === true;
    }

    public static function enabled_for_shell(bool $is_shared): bool {
        if (!self::flag_enabled() || $is_shared) return false;
        try {
            return function_exists('current_user_can') && current_user_can('manage_options');
        } catch (Throwable) {
            return false;
        }
    }

    public static function enabled_for_request(mixed $request = null): bool {
        if (!self::flag_enabled()) return false;
        try {
            if (!function_exists('current_user_can') || !current_user_can('manage_options')) return false;
            if (
                self::request_header($request, 'X-Kodety-Share') !== ''
                || self::request_header($request, 'X-Kodety-Invite') !== ''
            ) return false;
            if (class_exists('Kodety_Sharing') && method_exists('Kodety_Sharing', 'instance')) {
                $sharing = Kodety_Sharing::instance();
                if (method_exists($sharing, 'context') && is_array($sharing->context($request))) return false;
            }
        } catch (Throwable) {
            // An ambiguous capability, request or sharing context fails closed.
            return false;
        }
        return true;
    }

    public static function is_operation_id(mixed $value): bool {
        return is_string($value) && preg_match(self::OPERATION_ID_PATTERN, $value) === 1;
    }

    public static function new_operation_id(string $prefix = 'obs'): string {
        $safe_prefix = $prefix === 'trace' ? 'trace' : 'obs';
        try {
            return $safe_prefix . '-' . bin2hex(random_bytes(16));
        } catch (Throwable) {
            return $safe_prefix . '-' . substr(hash('sha256', uniqid('', true)), 0, 32);
        }
    }

    public static function before_callbacks(mixed $response, mixed $handler, mixed $request): mixed {
        if (!self::flag_enabled()) return $response;
        try {
            $operation = self::operation_for_request($request);
            if ($operation === '' || !self::enabled_for_request($request)) return $response;
            $operation_id = self::request_header($request, self::OPERATION_HEADER);
        } catch (Throwable) {
            return $response;
        }
        if (!self::is_operation_id($operation_id)) $operation_id = self::new_operation_id();
        self::$requests[self::request_key($request)] = [
            'operation' => $operation,
            'operationId' => $operation_id,
            'startedAt' => hrtime(true),
        ];
        return $response;
    }

    public static function finish_dispatch(mixed $response, mixed $server, mixed $request): mixed {
        if (!self::flag_enabled()) return $response;
        $key = self::request_key($request);
        $state = self::$requests[$key] ?? null;
        unset(self::$requests[$key]);
        if (!is_array($state)) return $response;

        $duration_ms = max(0.0, (hrtime(true) - $state['startedAt']) / 1_000_000);
        $status = self::response_status($response);
        $result = $status === 304
            ? 'not_modified'
            : ($status >= 200 && $status < 400 ? 'ok' : 'http_error');
        $entry = self::sanitize_fields([
            'operation' => $state['operation'],
            'operationId' => $state['operationId'],
            'durationMs' => $duration_ms,
            'result' => $result,
            'status' => $status,
        ]);
        if (!isset($entry['operation'], $entry['operationId'], $entry['durationMs'])) return $response;

        if (is_object($response) && method_exists($response, 'header')) {
            $response->header(self::OPERATION_HEADER, $entry['operationId']);
            $metric = 'kodety_' . str_replace('-', '_', $entry['operation']);
            $response->header(
                'Server-Timing',
                sprintf('%s;dur=%.2f', $metric, $entry['durationMs']),
                false
            );
        }
        self::write_performance_log($entry);
        return $response;
    }

    /** Begin correlation for the streamed admin-post project download. */
    public static function before_admin_post_download(): void {
        if (!self::flag_enabled() || self::$admin_post_request !== null) return;
        try {
            if (!self::enabled_for_request(null)) return;
            $operation_id = self::request_header(null, self::OPERATION_HEADER);
        } catch (Throwable) {
            return;
        }
        if (!self::is_operation_id($operation_id)) $operation_id = self::new_operation_id();
        self::$admin_post_request = [
            'operation' => 'project_download',
            'operationId' => $operation_id,
            'startedAt' => hrtime(true),
        ];
        self::emit_header(self::OPERATION_HEADER, $operation_id);
    }

    /** Finish exactly once, including when the download handler exits early. */
    public static function finish_admin_post_download(): void {
        if (!self::flag_enabled()) return;
        $state = self::$admin_post_request;
        self::$admin_post_request = null;
        if (!is_array($state)) return;

        $duration_ms = max(0.0, (hrtime(true) - $state['startedAt']) / 1_000_000);
        $status = http_response_code();
        $status = is_int($status) && $status >= 100 && $status <= 599 ? $status : 200;
        $entry = self::sanitize_fields([
            'operation' => $state['operation'],
            'operationId' => $state['operationId'],
            'durationMs' => $duration_ms,
            'result' => $status >= 200 && $status < 400 ? 'ok' : 'http_error',
            'status' => $status,
        ]);
        if (!isset($entry['operation'], $entry['operationId'], $entry['durationMs'])) return;

        $metric = 'kodety_' . str_replace('-', '_', $entry['operation']);
        self::emit_header(
            'Server-Timing',
            sprintf('%s;dur=%.2f', $metric, $entry['durationMs']),
            false
        );
        self::write_performance_log($entry);
    }

    /**
     * Keep only bounded scalar values from a closed schema. Unknown keys and
     * arbitrary strings (messages, URLs, paths, tokens and project data) drop.
     *
     * @return array<string,int|float|string>
     */
    public static function sanitize_fields(array $fields): array {
        $sanitized = [];
        $operation = is_string($fields['operation'] ?? null) ? $fields['operation'] : '';
        if (in_array($operation, self::OPERATIONS, true)) $sanitized['operation'] = $operation;
        $operation_id = $fields['operationId'] ?? null;
        if (self::is_operation_id($operation_id)) $sanitized['operationId'] = $operation_id;
        $duration = $fields['durationMs'] ?? null;
        if (is_int($duration) || is_float($duration)) {
            $duration = (float) $duration;
            if (is_finite($duration)) $sanitized['durationMs'] = round(min(3_600_000, max(0, $duration)), 2);
        }
        $result = is_string($fields['result'] ?? null) ? $fields['result'] : '';
        if (in_array($result, self::RESULTS, true)) $sanitized['result'] = $result;
        self::copy_bounded_integer($sanitized, $fields, 'status', 100, 599);
        self::copy_bounded_integer($sanitized, $fields, 'revision', 0, PHP_INT_MAX);
        self::copy_bounded_integer($sanitized, $fields, 'bytes', 0, PHP_INT_MAX);
        self::copy_bounded_integer($sanitized, $fields, 'attempt', 0, 100);
        self::copy_enum($sanitized, $fields, 'cache', ['hit', 'miss', 'bypass']);
        self::copy_enum($sanitized, $fields, 'fallback', ['none', 'full_project', 'archive']);
        self::copy_enum($sanitized, $fields, 'transport', [
            'surface',
            'asset',
            'project',
            'delta',
            'archive',
            'chunk',
            'publish',
        ]);
        return $sanitized;
    }

    /** @param array<string,int|float|string> $target */
    private static function copy_bounded_integer(
        array &$target,
        array $source,
        string $key,
        int $minimum,
        int $maximum
    ): void {
        $value = $source[$key] ?? null;
        if (!is_int($value) && !is_float($value)) return;
        if (!is_finite((float) $value)) return;
        $target[$key] = min($maximum, max($minimum, (int) round($value)));
    }

    /** @param array<string,int|float|string> $target */
    private static function copy_enum(array &$target, array $source, string $key, array $allowed): void {
        $value = $source[$key] ?? null;
        if (is_string($value) && in_array($value, $allowed, true)) $target[$key] = $value;
    }

    private static function operation_for_request(mixed $request): string {
        if (!is_object($request) || !method_exists($request, 'get_route')) return '';
        $route = rtrim((string) $request->get_route(), '/');
        $method = method_exists($request, 'get_method')
            ? strtoupper((string) $request->get_method())
            : 'GET';
        return match ($route) {
            '/kodety/v1/project/surface' => 'surface',
            '/kodety/v1/project/surface/asset' => 'asset',
            '/kodety/v1/project/chunk', '/kodety/v1/project/delta' => 'save',
            '/kodety/v1/project' => $method === 'GET' ? 'project_download' : 'save',
            '/kodety/v1/publish' => 'publish',
            default => '',
        };
    }

    private static function request_header(mixed $request, string $name): string {
        if (is_object($request) && method_exists($request, 'get_header')) {
            $value = $request->get_header($name);
            return is_string($value) ? trim($value) : '';
        }
        if ($request !== null) return '';
        $server_key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        $value = $_SERVER[$server_key] ?? '';
        return is_string($value) ? trim($value) : '';
    }

    private static function request_key(mixed $request): string {
        return is_object($request) ? 'request-' . spl_object_id($request) : 'request-none';
    }

    private static function response_status(mixed $response): int {
        if (is_object($response) && method_exists($response, 'get_status')) {
            $status = (int) $response->get_status();
            return $status >= 100 && $status <= 599 ? $status : 500;
        }
        if (function_exists('is_wp_error') && is_wp_error($response) && method_exists($response, 'get_error_data')) {
            $data = $response->get_error_data();
            $status = is_array($data) ? (int) ($data['status'] ?? 500) : 500;
            return $status >= 100 && $status <= 599 ? $status : 500;
        }
        return 200;
    }

    /** @param array<string,int|float|string> $entry */
    private static function write_log(array $entry): void {
        if (!self::flag_enabled()) return;
        $encoded = function_exists('wp_json_encode')
            ? wp_json_encode($entry, JSON_UNESCAPED_SLASHES)
            : json_encode($entry, JSON_UNESCAPED_SLASHES);
        if (!is_string($encoded)) return;
        if (is_callable(self::$log_sink)) {
            call_user_func(self::$log_sink, $encoded);
            return;
        }
        error_log($encoded);
    }

    /** @param array<string,int|float|string> $entry */
    private static function write_performance_log(array $entry): void {
        self::write_log(array_merge([
            'component' => 'kodety',
            'event' => 'wordpress.performance',
        ], $entry));
    }

    private static function emit_header(string $name, string $value, bool $replace = true): void {
        if (is_callable(self::$header_sink)) {
            call_user_func(self::$header_sink, $name, $value, $replace);
            return;
        }
        if (headers_sent()) return;
        header($name . ': ' . $value, $replace);
    }

    /** Test seam only; it never enables collection or changes redaction. */
    public static function set_log_sink_for_tests(?callable $sink): void {
        self::$log_sink = $sink;
    }

    /** Test seam only; production response headers still use PHP header(). */
    public static function set_header_sink_for_tests(?callable $sink): void {
        self::$header_sink = $sink;
    }
}
