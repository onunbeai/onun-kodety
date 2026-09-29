<?php

declare(strict_types=1);
define('ABSPATH', __DIR__);

class WP_Error {
    public function __construct(private string $code, private string $message, private array $data = []) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_data(): array { return $this->data; }
}
class WP_REST_Server { public const CREATABLE = 'POST'; }
class WP_REST_Request {
    public function __construct(private array $input, private array $headers = []) {}
    public function get_json_params(): array { return $this->input; }
    public function get_body(): string { return json_encode($this->input, JSON_THROW_ON_ERROR); }
    public function get_header(string $name): string { return $this->headers[strtolower($name)] ?? ''; }
    public function get_route(): string { return '/kodety/v1/agents/network'; }
}
class WP_REST_Response {
    public function __construct(private mixed $data, public int $status = 200, public array $headers = []) {}
    public function get_data(): mixed { return $this->data; }
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
}
class Kodety_Agents {
    public bool|WP_Error $allowed = true;
    public function can_use_agents(): bool|WP_Error { return $this->allowed; }
}
$network_calls = [];
$network_filters = [];
$network_routes = [];
$network_upstream = ['status' => 200, 'headers' => ['content-type' => 'text/event-stream', 'set-cookie' => 'never-forward'], 'body' => "data: fixture\n\n"];
function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function wp_verify_nonce(string $nonce, string $action): bool { return $nonce === 'fixture-nonce' && $action === 'wp_rest'; }
function rest_url(): string { return 'https://site.test/subdirectory/wp-json/'; }
function status_header(int $status): void { $GLOBALS['network_status'] = $status; }
function register_rest_route(string $namespace, string $path, array $route): void { $GLOBALS['network_routes'][$namespace . $path] = $route; }
function add_filter(string $name, callable $callback, int $priority, int $args): void { $GLOBALS['network_filters'][$name] = $callback; }
function wp_remote_request(string $url, array $options): mixed { $GLOBALS['network_calls'][] = [$url, $options]; return $GLOBALS['network_upstream']; }
function wp_remote_retrieve_response_code(array $response): int { return $response['status']; }
function wp_remote_retrieve_body(array $response): string { return $response['body']; }
function wp_remote_retrieve_header(array $response, string $header): string { return $response['headers'][$header] ?? ''; }
function check_network(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function input_network(string $operation = 'responses', string $body = '{}'): array { return ['operation' => $operation, 'headers' => ['authorization' => 'Bearer fixture-token', 'content-type' => 'application/json', 'cookie' => 'never-forward'], 'body' => base64_encode($body)]; }
function request_network(?array $input = null, array $headers = []): WP_REST_Request { return new WP_REST_Request($input ?? input_network(), array_merge(['origin' => 'https://site.test', 'x-wp-nonce' => 'fixture-nonce', 'x-kodety-agent-network' => '1', 'content-type' => 'application/json'], $headers)); }

require dirname(__DIR__) . '/kodety/includes/class-kodety-agent-network.php';
$agents = new Kodety_Agents();
$network = new Kodety_Agent_Network($agents, false);
$network->register_routes();
check_network(isset($network_routes['kodety/v1/agents/network']), 'Network route must be registered.');
$local_failure = new WP_REST_Response(['error' => 'forbidden'], 403);
$network_filters['rest_post_dispatch']($local_failure, null, request_network());
check_network($local_failure->headers['X-Kodety-Agent-Relay'] === '1', 'Even permission errors must identify the real relay.');
check_network($network->can_relay(request_network()) === true, 'Licensed same-origin browser can relay.');
foreach ([['origin' => 'https://evil.test'], ['x-wp-nonce' => 'bad'], ['x-kodety-agent-network' => ''], ['sec-fetch-site' => 'cross-site'], ['origin' => 'null']] as $headers) {
    check_network(is_wp_error($network->can_relay(request_network(null, $headers))), 'Untrusted request must be denied.');
}
$agents->allowed = false;
check_network($network->can_relay(request_network()) === false, 'WordPress capability required.');
$agents->allowed = new WP_Error('license', 'License required.', ['status' => 403]);
check_network($network->can_relay(request_network())->get_error_code() === 'license', 'License check retained.');
$agents->allowed = true;
$result = $network->relay(request_network());
check_network($result instanceof WP_REST_Response && $result->status === 200, 'Upstream response is returned.');
check_network($result->headers['X-Kodety-Agent-Relay'] === '1', 'Browser can identify a real relay.');
check_network(!isset($result->headers['set-cookie']), 'No upstream cookie reaches the browser.');
[$url, $options] = $network_calls[0];
check_network($url === 'https://chatgpt.com/backend-api/codex/responses', 'Destination is fixed.');
check_network($options['headers']['authorization'] === 'Bearer fixture-token' && !isset($options['headers']['cookie']), 'Only explicit safe headers are forwarded.');
check_network($options['redirection'] === 0 && $options['cookies'] === [] && $options['sslverify'] === true, 'No redirects or cookies; TLS verified.');
ob_start();
$served = $network_filters['rest_pre_serve_request'](false, $result);
$raw = ob_get_clean();
check_network($served && $raw === "data: fixture\n\n", 'REST must preserve SSE bytes.');
foreach (['device-code' => 'https://auth.openai.com/api/accounts/deviceauth/usercode', 'device-token' => 'https://auth.openai.com/api/accounts/deviceauth/token', 'oauth-token' => 'https://auth.openai.com/oauth/token', 'usage' => 'https://chatgpt.com/backend-api/wham/usage'] as $operation => $target) {
    $decoded = Kodety_Agent_Network::decode_request(input_network($operation, $operation === 'usage' ? '' : '{}'));
    check_network(is_array($decoded) && $decoded['url'] === $target, 'Fixed operation target: ' . $operation);
}
foreach ([
    array_merge(input_network(), ['url' => 'https://evil.test']),
    array_merge(input_network(), ['operation' => '__proto__']),
    array_merge(input_network(), ['body' => 'YQ=']),
    array_merge(input_network(), ['body' => 'YR==']),
    array_merge(input_network(), ['headers' => ['authorization' => "Bearer a\r\ncookie: x"]]),
    array_merge(input_network(), ['headers' => []]),
    input_network('usage', '{}'),
] as $invalid) check_network(is_wp_error(Kodety_Agent_Network::decode_request($invalid)), 'Invalid proxy inputs must fail.');
$network_upstream = ['status' => 302, 'headers' => ['location' => 'https://evil.test'], 'body' => ''];
check_network($network->relay(request_network())->get_error_code() === 'agent_network_redirect', 'Reject upstream redirects.');
$network_upstream = new WP_Error('http_failure', 'fixture-secret-token');
check_network($network->relay(request_network())->get_error_code() === 'agent_network_unavailable', 'Sanitize HTTP diagnostics.');
$network_stream = new Kodety_Agent_Network($agents, true, static function (mixed $curl, callable $headers, callable $body): bool {
    $headers($curl, "HTTP/2 200\r\n");
    $headers($curl, "content-type: text/event-stream\r\n");
    $headers($curl, "set-cookie: fixture-secret\r\n");
    check_network($body($curl, "data: first\n\n") === 13, 'First SSE chunk is accepted.');
    check_network(ob_get_contents() === "data: first\n\n", 'First SSE chunk appears before transfer completion.');
    $body($curl, "data: second\n\n");
    return true;
});
$stream_result = $network_stream->relay(request_network());
ob_start();
$served_stream = $network_filters['rest_pre_serve_request'](false, $stream_result);
$stream_bytes = ob_get_clean();
check_network($served_stream && $network_status === 200 && $stream_bytes === "data: first\n\ndata: second\n\n", 'cURL relays SSE incrementally without extra JSON encoding.');
$network_redirect = new Kodety_Agent_Network($agents, true, static function (mixed $curl, callable $headers, callable $body): bool {
    $headers($curl, "HTTP/2 302\r\n");
    check_network($body($curl, 'fixture-secret') === 0, 'Redirect bodies must not stream.');
    return false;
});
$redirect_result = $network_redirect->relay(request_network());
ob_start();
$network_filters['rest_pre_serve_request'](false, $redirect_result);
$redirect_bytes = ob_get_clean();
check_network($network_status === 502 && !str_contains($redirect_bytes, 'fixture-secret'), 'Streaming redirects fail without leaking their response.');
$network_failed_stream = new Kodety_Agent_Network($agents, true, static function (mixed $curl, callable $headers, callable $body): bool {
    $headers($curl, "HTTP/2 200\r\n");
    $headers($curl, "content-type: text/event-stream\r\n");
    $body($curl, "data: started\n\n");
    return false;
});
$failed_stream_result = $network_failed_stream->relay(request_network());
ob_start();
$network_filters['rest_pre_serve_request'](false, $failed_stream_result);
$failed_stream_bytes = ob_get_clean();
check_network(str_contains($failed_stream_bytes, 'response.failed'), 'Interrupted SSE emits a provider failure event.');
define('KODETY_BROWSER_STUDIO_RUNTIME', 'playground');
check_network($network->can_relay(request_network())->get_error_code() === 'agent_network_host_required', 'PHP-WASM needs the actual Studio host relay.');
echo "Browser Agent network PHP: fixed targets, nonce/license/origin, raw SSE, redirect rejection and cookie isolation passed.\n";
