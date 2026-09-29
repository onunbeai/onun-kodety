<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message,
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Response {
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
}

final class WP_REST_Request {
    public function __construct(private array $json = []) {}
    public function get_json_params(): array { return $this->json; }
}

final class Kodety_Plugin {
    public const CAP_USE_AI = 'kodety_use_ai';
}

final class Kodety_Edition {
    public static function has(string $feature): bool { return $feature === 'ai'; }
    public static function license_url(): string { return 'https://example.test/license'; }
}

$kodety_ai_configuration_options = [];

function add_action(...$args): void {}
function register_rest_route(...$args): void {}
function current_user_can(string $capability): bool { return true; }
function get_option(string $name, mixed $default = false): mixed {
    global $kodety_ai_configuration_options;
    return $kodety_ai_configuration_options[$name] ?? $default;
}
function sanitize_key(string $value): string {
    return preg_replace('/[^a-z0-9_\-]/', '', strtolower($value)) ?: '';
}
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }

function kodety_ai_configuration_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-ai.php';

$reflection = new ReflectionClass(Kodety_AI::class);
$ai = $reflection->newInstanceWithoutConstructor();
$response = $ai->generate_rest(new WP_REST_Request([
    'task' => 'translation',
    'prompt' => 'Traduza o conteúdo.',
    'context' => '{"title":"Olá"}',
    'language' => 'en-US',
]));

kodety_ai_configuration_assert(
    $response instanceof WP_Error,
    'gerar sem qualquer credencial deve falhar antes de contatar um provedor'
);
kodety_ai_configuration_assert(
    $response->get_error_code() === 'kodety_ai_configuration_required',
    'a ausência de credenciais precisa de um código estável para a interface oferecer Settings'
);
$data = $response->get_error_data();
kodety_ai_configuration_assert(
    is_array($data)
        && ($data['status'] ?? 0) === 409
        && ($data['reason'] ?? '') === 'no_provider_credentials'
        && ($data['retryable'] ?? true) === false
        && ($data['provider'] ?? '') === 'openai',
    'o erro deve distinguir configuração ausente de falha temporária do provedor'
);
kodety_ai_configuration_assert(
    !array_filter((array) ($data['configuredProviders'] ?? [])),
    'nenhum provedor pode ser anunciado como configurado sem uma chave protegida'
);

fwrite(STDOUT, "Kodety AI configuration boundary passed.\n");
