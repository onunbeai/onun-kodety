<?php

defined('ABSPATH') || exit;

/** Network-only relay. The Agent, tools, history and OAuth storage remain in
 * the browser. This class never installs Node or starts the server Agent. */
final class Kodety_Agent_Network {
    private const MAX_BODY_BYTES = 16_777_216;
    private const MAX_ENVELOPE_BYTES = 33_554_432;
    private const MAX_RESPONSE_BYTES = 67_108_864;
    private const OPERATIONS = [
        'device-code' => ['POST', 'https://auth.openai.com/api/accounts/deviceauth/usercode'],
        'device-token' => ['POST', 'https://auth.openai.com/api/accounts/deviceauth/token'],
        'oauth-token' => ['POST', 'https://auth.openai.com/oauth/token'],
        'responses' => ['POST', 'https://chatgpt.com/backend-api/codex/responses'],
        'usage' => ['GET', 'https://chatgpt.com/backend-api/wham/usage'],
    ];
    private const REQUEST_HEADERS = ['authorization', 'chatgpt-account-id', 'content-type', 'content-encoding', 'accept', 'openai-beta', 'originator', 'user-agent', 'session-id', 'x-client-request-id', 'x-codex-turn-state', 'version'];
    private const RESPONSE_HEADERS = ['content-type', 'retry-after', 'retry-after-ms', 'x-codex-turn-state', 'x-request-id'];

    public function __construct(private Kodety_Agents $agents, private bool $streaming = true, private ?Closure $curl_execute = null) {}

    public function register_routes(): void {
        register_rest_route('kodety/v1', '/agents/network', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => [$this, 'can_relay'],
            'callback' => [$this, 'relay'],
        ]);
        add_filter('rest_post_dispatch', static function (mixed $response, mixed $server, WP_REST_Request $request): mixed {
            if ($request->get_route() === '/kodety/v1/agents/network' && $response instanceof WP_REST_Response) {
                $response->header('X-Kodety-Agent-Relay', '1');
                $response->header('Cache-Control', 'no-store');
            }
            return $response;
        }, 10, 3);
    }

    private static function error(string $code, int $status = 400): WP_Error {
        return new WP_Error($code, 'Não foi possível conectar o Agent ao serviço da OpenAI.', ['status' => $status]);
    }

    private static function origin(string $url): string {
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) return '';
        $scheme = strtolower($parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) return '';
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        return $scheme . '://' . strtolower($parts['host']) . ':' . $port;
    }

    public function can_relay(WP_REST_Request $request): bool|WP_Error {
        $allowed = $this->agents->can_use_agents();
        if ($allowed !== true) return $allowed;
        $nonce = (string) $request->get_header('X-WP-Nonce');
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) return self::error('rest_cookie_invalid_nonce', 403);
        $origin = (string) $request->get_header('Origin');
        // A custom header plus same-origin validation excludes cross-site form
        // posts and fetches. WordPress may grant CORS elsewhere; this route does
        // not rely on its global CORS policy to protect credential-bearing data.
        if ($request->get_header('X-Kodety-Agent-Network') !== '1'
            || !preg_match('/^application\/json(?:;|$)/i', (string) $request->get_header('Content-Type'))
            || $origin === '' || self::origin($origin) !== self::origin(rest_url())
            || in_array($request->get_header('Sec-Fetch-Site'), ['cross-site', 'same-site'], true)) return self::error('agent_network_origin', 403);
        if ((defined('KODETY_BROWSER_STUDIO_RUNTIME') && is_string(KODETY_BROWSER_STUDIO_RUNTIME) && KODETY_BROWSER_STUDIO_RUNTIME !== '')
            || in_array(strtolower(PHP_OS), ['emscripten', 'wasi'], true)) {
            return new WP_Error('agent_network_host_required', 'O WordPress no navegador precisa da conexão de rede do Studio para acessar a OpenAI.', ['status' => 503]);
        }
        return true;
    }

    /** Hardcoded destinations and methods; callers cannot turn this into an
     * arbitrary HTTP proxy. Only the validated request's credentials are used. */
    public static function decode_request(mixed $input): array|WP_Error {
        if (!is_array($input) || array_diff(array_keys($input), ['operation', 'headers', 'body'])
            || !is_string($input['operation'] ?? null) || !isset(self::OPERATIONS[$input['operation']])
            || !is_array($input['headers'] ?? null) || count($input['headers']) > 40 || !is_string($input['body'] ?? null)) return self::error('agent_network_request');
        if (strlen($input['body']) > (int) ceil(self::MAX_BODY_BYTES / 3) * 4) return self::error('agent_network_size', 413);
        $body = base64_decode($input['body'], true);
        if ($body === false || base64_encode($body) !== $input['body']) return self::error('agent_network_request');
        if (strlen($body) > self::MAX_BODY_BYTES) return self::error('agent_network_size', 413);
        [$method, $url] = self::OPERATIONS[$input['operation']];
        if ($method === 'GET' && $body !== '') return self::error('agent_network_request');
        $headers = [];
        $header_bytes = 0;
        foreach ($input['headers'] as $name => $value) {
            $name = strtolower((string) $name);
            if (!in_array($name, self::REQUEST_HEADERS, true)) continue;
            if (!is_string($value) || strlen($value) > 16384 || preg_match('/[\r\n\x00]/', $value)) return self::error('agent_network_request');
            $header_bytes += strlen($name) + strlen($value);
            if ($header_bytes > 32768) return self::error('agent_network_request');
            $headers[$name] = $value;
        }
        if (in_array($input['operation'], ['responses', 'usage'], true) && !preg_match('/^Bearer [^\s]+$/D', $headers['authorization'] ?? '')) return self::error('agent_auth_required', 401);
        return ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];
    }

    public function relay(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $allowed = $this->can_relay($request);
        if ($allowed !== true) return $allowed === false ? self::error('agent_network_forbidden', 403) : $allowed;
        if (strlen($request->get_body()) > self::MAX_ENVELOPE_BYTES) return self::error('agent_network_size', 413);
        $input = $request->get_json_params();
        $decoded = self::decode_request($input);
        if (is_wp_error($decoded)) return $decoded;
        if ($input['operation'] === 'responses' && $this->streaming && function_exists('curl_init') && !defined('WP_PROXY_HOST')) {
            return $this->stream_response($decoded);
        }
        // WordPress's HTTP transport also works on hosts without cURL or Node.
        // No cookie jar, redirects, disk file or database entry holds tokens.
        $upstream = wp_remote_request($decoded['url'], [
            'method' => $decoded['method'],
            'headers' => $decoded['headers'],
            'body' => $decoded['body'],
            'cookies' => [],
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'sslverify' => true,
            'timeout' => $input['operation'] === 'responses' ? 300 : 45,
            'limit_response_size' => self::MAX_RESPONSE_BYTES + 1,
        ]);
        if (is_wp_error($upstream)) return self::error('agent_network_unavailable', 502);
        $status = (int) wp_remote_retrieve_response_code($upstream);
        if ($status < 200 || $status > 599 || ($status >= 300 && $status < 400)) return self::error('agent_network_redirect', 502);
        $body = (string) wp_remote_retrieve_body($upstream);
        if (strlen($body) > self::MAX_RESPONSE_BYTES) return self::error('agent_network_response_size', 502);
        $response = new WP_REST_Response($body, $status, [
            'Cache-Control' => 'no-store',
            'X-Kodety-Agent-Relay' => '1',
            'X-Content-Type-Options' => 'nosniff',
            'Cross-Origin-Resource-Policy' => 'same-origin',
            'Referrer-Policy' => 'no-referrer',
            'X-Accel-Buffering' => 'no',
        ]);
        foreach (self::RESPONSE_HEADERS as $name) {
            $value = (string) wp_remote_retrieve_header($upstream, $name);
            if ($value !== '' && !preg_match('/[\r\n\x00]/', $value)) $response->header($name, $value);
        }
        // Preserve OAuth JSON and SSE bytes without REST JSON encoding them.
        add_filter('rest_pre_serve_request', static function (bool $served, mixed $result) use ($response): bool {
            if ($served || $result !== $response) return $served;
            echo $response->get_data();
            return true;
        }, 10, 2);
        return $response;
    }

    /** Defer cURL until REST has finished processing its response. Emitting
     * during the route callback would send JSON/SSE before WordPress headers. */
    private function stream_response(array $decoded): WP_REST_Response {
        $response = new WP_REST_Response(null, 200, [
            'Cache-Control' => 'no-store',
            'X-Kodety-Agent-Relay' => '1',
            'X-Content-Type-Options' => 'nosniff',
            'Cross-Origin-Resource-Policy' => 'same-origin',
            'Referrer-Policy' => 'no-referrer',
            'X-Accel-Buffering' => 'no',
        ]);
        add_filter('rest_pre_serve_request', function (bool $served, mixed $result) use ($response, $decoded): bool {
            if ($served || $result !== $response) return $served;
            $this->stream_curl($decoded);
            return true;
        }, 10, 2);
        return $response;
    }

    private function stream_curl(array $decoded): void {
        $curl = curl_init($decoded['url']);
        $status = 0;
        $upstream_headers = [];
        $received = 0;
        $started = false;
        $failed = false;
        // Tests inject only transport execution; URL, headers and curl options
        // follow the exact production code, without using real credentials.
        $execute = $this->curl_execute;
        $prepare_headers = static function () use (&$status, &$upstream_headers, &$started, $execute): void {
            if ($started) return;
            $started = true;
            status_header($status);
            foreach ($upstream_headers as $name => $value) if (!headers_sent()) header($name . ': ' . $value, true);
            // PHP and nginx buffering otherwise hide the first tokens. Do not
            // interfere with the buffer collecting deterministic test output.
            if ($execute === null) {
                while (ob_get_level() > 0) {
                    if (!@ob_end_flush()) break;
                }
            }
        };
        $on_header = static function (mixed $handle, string $line) use (&$status, &$upstream_headers, &$failed): int {
            $length = strlen($line);
            if (preg_match('/^HTTP\/\S+\s+(\d{3})(?:\s|$)/i', $line, $match)) {
                $status = (int) $match[1];
                $upstream_headers = [];
                if ($status >= 300 && $status < 400 || $status > 599) $failed = true;
                return $length;
            }
            $separator = strpos($line, ':');
            if ($separator !== false) {
                $name = strtolower(trim(substr($line, 0, $separator)));
                $value = trim(substr($line, $separator + 1));
                if (in_array($name, self::RESPONSE_HEADERS, true) && strlen($value) <= 16384 && !preg_match('/[\r\n\x00]/', $value)) $upstream_headers[$name] = $value;
            }
            return $length;
        };
        $on_body = static function (mixed $handle, string $chunk) use (&$status, &$received, &$failed, $prepare_headers, $execute): int {
            $received += strlen($chunk);
            if ($failed || $status < 200 || $received > self::MAX_RESPONSE_BYTES || connection_aborted()) {
                $failed = true;
                return 0; // Stop the upstream transfer immediately.
            }
            $prepare_headers();
            echo $chunk;
            if ($execute === null) flush();
            return strlen($chunk);
        };
        $previous_abort = ignore_user_abort(true);
        try {
            if ($curl === false) throw new RuntimeException('agent_network_unavailable');
            $headers = [];
            foreach ($decoded['headers'] as $name => $value) $headers[] = $name . ': ' . $value;
            curl_setopt_array($curl, [
                CURLOPT_CUSTOMREQUEST => 'POST',
                CURLOPT_POSTFIELDS => $decoded['body'],
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_MAXREDIRS => 0,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_CONNECTTIMEOUT => 45,
                CURLOPT_TIMEOUT => 300,
                CURLOPT_ENCODING => '',
                CURLOPT_HEADERFUNCTION => $on_header,
                CURLOPT_WRITEFUNCTION => $on_body,
            ]);
            if (defined('WPINC')) {
                $certificates = ABSPATH . WPINC . '/certificates/ca-bundle.crt';
                if (is_file($certificates)) curl_setopt($curl, CURLOPT_CAINFO, $certificates);
            }
            $completed = $execute === null ? curl_exec($curl) : $execute($curl, $on_header, $on_body);
            if ($completed === false || $failed || $status < 200) throw new RuntimeException('agent_network_unavailable');
            if (!$started) $prepare_headers();
        } catch (Throwable) {
            if (!$started) {
                status_header(502);
                if (!headers_sent()) header('Content-Type: application/json; charset=utf-8', true);
                echo '{"error":"agent_network_unavailable"}';
            } elseif (!connection_aborted() && str_starts_with($upstream_headers['content-type'] ?? '', 'text/event-stream')) {
                // A late transport failure must not appear to be a completed
                // turn. The provider understands a failed Responses event.
                echo "\nevent: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"agent_network_unavailable\",\"message\":\"Agent network connection interrupted.\"}}}\n\n";
                if ($execute === null) flush();
            }
        } finally {
            if ($curl !== false) curl_close($curl);
            ignore_user_abort((bool) $previous_abort);
        }
    }
}
