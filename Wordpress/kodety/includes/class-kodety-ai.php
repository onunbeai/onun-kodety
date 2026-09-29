<?php

defined('ABSPATH') || exit;

if (!class_exists('Kodety_Edition')) require_once __DIR__ . '/class-kodety-edition.php';

/** Server-side AI gateway shared by Settings, CMS and MCP. */
final class Kodety_AI {
    private static ?self $instance = null;
    private const OPTION_SETTINGS = 'kodety_ai_settings';
    private const OPTION_SECRET = 'kodety_ai_api_key';
    private const MAX_API_KEY_BYTES = 1024;
    private const MAX_RESPONSE_BYTES = 2097152;
    private const DEFAULT_TEMPERATURE = 1.0;
    private const LEGACY_DEFAULT_TEMPERATURE = 0.7;
    private const PROVIDERS = [
        'openai' => ['model' => 'gpt-5.6-luna', 'baseUrl' => 'https://api.openai.com/v1'],
        'codex' => ['model' => 'gpt-5.3-codex', 'baseUrl' => 'https://api.openai.com/v1'],
        'kimi' => ['model' => 'kimi-k2.6', 'baseUrl' => 'https://api.moonshot.ai/v1'],
        'openrouter' => ['model' => '~openai/gpt-latest', 'baseUrl' => 'https://openrouter.ai/api/v1'],
        'custom' => ['model' => '', 'baseUrl' => ''],
    ];

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function register_routes(): void {
        register_rest_route('kodety/v1', '/ai/settings', [
            [
                'methods' => 'GET',
                'callback' => fn(): WP_REST_Response => new WP_REST_Response($this->public_settings()),
                'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('manage_options'),
            ],
            [
                'methods' => 'POST',
                'callback' => [$this, 'save_settings'],
                'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('manage_options'),
                'args' => [
                    'provider' => ['required' => true, 'type' => 'string', 'enum' => array_keys(self::PROVIDERS)],
                    'model' => ['type' => 'string', 'maxLength' => 120],
                    'baseUrl' => ['type' => 'string', 'maxLength' => 2048],
                    'temperature' => ['type' => 'number', 'minimum' => 0, 'maximum' => 1.5],
                    'language' => ['type' => 'string', 'maxLength' => 80],
                    'tone' => ['type' => 'string', 'maxLength' => 160],
                    'apiKey' => ['type' => 'string', 'maxLength' => self::MAX_API_KEY_BYTES],
                    'clearKey' => ['type' => 'boolean'],
                ],
            ],
        ]);
        register_rest_route('kodety/v1', '/ai/test', [
            'methods' => 'POST',
            'callback' => [$this, 'test_connection'],
            'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission('manage_options'),
        ]);
        register_rest_route('kodety/v1', '/ai/generate', [
            'methods' => 'POST',
            'callback' => [$this, 'generate_rest'],
            'permission_callback' => fn(): bool|WP_Error => $this->licensed_permission(Kodety_Plugin::CAP_USE_AI),
            'args' => [
                'task' => ['type' => 'string', 'enum' => ['article', 'title', 'description', 'excerpt', 'seo', 'schema', 'social', 'rewrite', 'translation'], 'default' => 'article'],
                'prompt' => ['required' => true, 'type' => 'string', 'minLength' => 1, 'maxLength' => 12000],
                'context' => ['type' => 'string', 'maxLength' => 64000],
                'language' => ['type' => 'string', 'maxLength' => 80],
                'tone' => ['type' => 'string', 'maxLength' => 160],
            ],
        ]);
    }

    private function licensed_permission(string $capability): bool|WP_Error {
        if (!current_user_can($capability)) return false;
        if (Kodety_Edition::has('ai')) return true;
        return new WP_Error(
            'kodety_license_ai_required',
            'Ative uma licença Onun Kodety para usar Integrações e IA.',
            ['status' => 403, 'licenseUrl' => Kodety_Edition::license_url()]
        );
    }

    private function settings(): array {
        $stored = get_option(self::OPTION_SETTINGS, []);
        $stored = is_array($stored) ? $stored : [];
        $provider = sanitize_key((string) ($stored['provider'] ?? 'openai'));
        if (!isset(self::PROVIDERS[$provider])) $provider = 'openai';
        $base_url = $provider === 'custom'
            ? $this->sanitize_custom_endpoint((string) ($stored['baseUrl'] ?? ''))
            : self::PROVIDERS[$provider]['baseUrl'];
        return [
            'provider' => $provider,
            'model' => sanitize_text_field((string) ($stored['model'] ?? self::PROVIDERS[$provider]['model'])),
            'baseUrl' => $base_url,
            'temperature' => $this->stored_temperature($stored),
            'language' => sanitize_text_field((string) ($stored['language'] ?? 'Português do Brasil')),
            'tone' => sanitize_text_field((string) ($stored['tone'] ?? 'claro, humano e profissional')),
        ];
    }

    private function stored_temperature(array $stored): float {
        if (!array_key_exists('temperature', $stored) || !is_numeric($stored['temperature'])) {
            return self::DEFAULT_TEMPERATURE;
        }
        $temperature = (float) $stored['temperature'];
        if (!is_finite($temperature) || $temperature < 0 || $temperature > 1.5) {
            return self::DEFAULT_TEMPERATURE;
        }
        // Before this marker existed, 0.7 was written automatically by the
        // form even when the user had never chosen a creativity preference.
        // Move that legacy default to 1 while preserving every confirmed
        // selection (including an explicit 0.7 saved by the current UI).
        if (empty($stored['temperatureExplicit']) && abs($temperature - self::LEGACY_DEFAULT_TEMPERATURE) < 0.000001) {
            return self::DEFAULT_TEMPERATURE;
        }
        return $temperature;
    }

    private function requested_temperature(mixed $value, float $fallback): float {
        if ($value === null) return $fallback;
        if (!is_numeric($value)) return self::DEFAULT_TEMPERATURE;
        $temperature = (float) $value;
        return is_finite($temperature) && $temperature >= 0 && $temperature <= 1.5
            ? $temperature
            : self::DEFAULT_TEMPERATURE;
    }

    public function public_settings(): array {
        $settings = $this->settings();
        $secrets = $this->secret_map();
        $configured_providers = [];
        foreach (['openai', 'kimi', 'openrouter', 'custom'] as $provider) $configured_providers[$provider] = !empty($secrets[$provider]) && $this->decrypt((string) $secrets[$provider]) !== '';
        $configured_providers['codex'] = $configured_providers['openai'];
        $configured = $configured_providers[$settings['provider']] ?? false;
        return $settings + [
            'configured' => $configured,
            'configuredProviders' => $configured_providers,
            'keyHint' => $configured ? '••••••••' : '',
            'capabilities' => ['article', 'title', 'description', 'excerpt', 'seo', 'schema', 'social', 'rewrite', 'translation'],
        ];
    }

    public function save_settings(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $provider = sanitize_key((string) ($request->get_param('provider') ?: 'openai'));
        if (!isset(self::PROVIDERS[$provider])) return new WP_Error('kodety_ai_provider_invalid', 'Provedor de IA inválido.', ['status' => 400]);
        $base_url = $provider === 'custom'
            ? $this->sanitize_custom_endpoint((string) $request->get_param('baseUrl'))
            : self::PROVIDERS[$provider]['baseUrl'];
        if ($base_url === '') {
            return new WP_Error('kodety_ai_url_invalid', 'Informe um endpoint HTTPS público. Servidores locais só são aceitos em ambientes local/development.', ['status' => 400]);
        }
        $model = trim(sanitize_text_field((string) ($request->get_param('model') ?: self::PROVIDERS[$provider]['model'])));
        if ($model === '') return new WP_Error('kodety_ai_model_invalid', 'Informe o modelo de IA.', ['status' => 400]);
        $temperature = $this->requested_temperature(
            $request->get_param('temperature'),
            (float) $this->settings()['temperature']
        );
        $settings = [
            'provider' => $provider,
            'model' => $this->limit_text($model, 120),
            'baseUrl' => $base_url,
            'temperature' => $temperature,
            'temperatureExplicit' => true,
            'language' => $this->limit_text(sanitize_text_field((string) ($request->get_param('language') ?: 'Português do Brasil')), 80),
            'tone' => $this->limit_text(sanitize_text_field((string) ($request->get_param('tone') ?: 'claro, humano e profissional')), 160),
        ];
        $secrets = $this->secret_map();
        $secret_provider = $provider === 'codex' ? 'openai' : $provider;
        if (rest_sanitize_boolean($request->get_param('clearKey'))) unset($secrets[$secret_provider]);
        $new_key = trim((string) $request->get_param('apiKey'));
        // Mask values rendered by clients are display-only and must never replace
        // an already protected credential when a settings form is submitted.
        if ($new_key !== '' && !preg_match('/^[*\x{2022}]+$/u', $new_key)) {
            if (strlen($new_key) > self::MAX_API_KEY_BYTES || preg_match('/[\x00-\x1F\x7F]/', $new_key)) {
                return new WP_Error('kodety_ai_key_invalid', 'A API Key possui tamanho ou caracteres inválidos.', ['status' => 400]);
            }
            try {
                $secrets[$secret_provider] = $this->encrypt($new_key);
            } catch (Throwable $error) {
                return new WP_Error('kodety_ai_key_protection_failed', 'Não foi possível proteger a API Key neste servidor.', ['status' => 500]);
            }
        }
        $previous_secret = $this->option_snapshot(self::OPTION_SECRET);
        $previous_settings = $this->option_snapshot(self::OPTION_SETTINGS);
        try {
            update_option(self::OPTION_SECRET, $secrets, false);
            if (!$this->option_matches(self::OPTION_SECRET, $secrets)) {
                throw new RuntimeException('O WordPress não confirmou a gravação protegida da API Key.');
            }
            update_option(self::OPTION_SETTINGS, $settings, false);
            if (!$this->option_matches(self::OPTION_SETTINGS, $settings)) {
                throw new RuntimeException('O WordPress não confirmou a gravação da configuração de IA.');
            }
        } catch (Throwable $error) {
            // The secret and its provider/model form one logical setting. A
            // partial write could pair a new key with the previous endpoint,
            // so restore both snapshots and explicitly report any rollback
            // failure instead of returning a misleading successful response.
            $secret_restored = $this->restore_option_snapshot(self::OPTION_SECRET, $previous_secret);
            $settings_restored = $this->restore_option_snapshot(self::OPTION_SETTINGS, $previous_settings);
            return new WP_Error(
                'kodety_ai_settings_persistence_failed',
                $secret_restored && $settings_restored
                    ? 'Não foi possível salvar a configuração de IA. O estado anterior foi restaurado.'
                    : 'Não foi possível salvar nem restaurar completamente a configuração de IA. Revise as opções do WordPress antes de tentar novamente.',
                [
                    'status' => 500,
                    'retryable' => true,
                    'rollbackFailed' => !$secret_restored || !$settings_restored,
                ]
            );
        }
        return new WP_REST_Response($this->public_settings());
    }

    /** @return array{exists: bool, value: mixed} */
    private function option_snapshot(string $name): array {
        $missing = new stdClass();
        $value = get_option($name, $missing);
        return ['exists' => $value !== $missing, 'value' => $value !== $missing ? $value : null];
    }

    private function option_matches(string $name, mixed $expected): bool {
        $missing = new stdClass();
        $actual = get_option($name, $missing);
        return $actual !== $missing && $actual === $expected;
    }

    /** @param array{exists: bool, value: mixed} $snapshot */
    private function restore_option_snapshot(string $name, array $snapshot): bool {
        try {
            if ($snapshot['exists']) {
                update_option($name, $snapshot['value'], false);
                return $this->option_matches($name, $snapshot['value']);
            }
            delete_option($name);
            $missing = new stdClass();
            return get_option($name, $missing) === $missing;
        } catch (Throwable) {
            return false;
        }
    }

    public function test_connection(): WP_REST_Response|WP_Error {
        try {
            $result = $this->complete('Responda somente com JSON válido: {"ok":true,"message":"Conexão pronta"}.', 'Teste de conexão do CMS Onun Kodety.', 120);
            return new WP_REST_Response(['ok' => true, 'message' => sanitize_text_field((string) ($result['message'] ?? 'Conexão pronta')), 'settings' => $this->public_settings()]);
        } catch (Throwable $error) {
            return new WP_Error('kodety_ai_test_failed', $error->getMessage(), ['status' => 502]);
        }
    }

    public function generate_rest(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $configuration_error = $this->generation_configuration_error();
        if ($configuration_error instanceof WP_Error) return $configuration_error;
        try {
            return new WP_REST_Response($this->generate((array) $request->get_json_params()));
        } catch (Throwable $error) {
            return new WP_Error('kodety_ai_generation_failed', $error->getMessage(), ['status' => $error instanceof InvalidArgumentException ? 400 : 502]);
        }
    }

    private function generation_configuration_error(): ?WP_Error {
        $settings = $this->public_settings();
        if (!empty($settings['configured'])) return null;
        $configured_providers = is_array($settings['configuredProviders'] ?? null)
            ? $settings['configuredProviders']
            : [];
        $has_any_credentials = in_array(true, $configured_providers, true);
        return new WP_Error(
            'kodety_ai_configuration_required',
            $has_any_credentials
                ? 'O provedor de IA selecionado não possui uma API Key configurada.'
                : 'Nenhuma chave de IA está configurada.',
            [
                'status' => 409,
                'reason' => $has_any_credentials
                    ? 'selected_provider_credentials_missing'
                    : 'no_provider_credentials',
                'retryable' => false,
                'provider' => (string) ($settings['provider'] ?? ''),
                'configuredProviders' => $configured_providers,
            ]
        );
    }

    /** Generate a structured draft without persisting it. Also used by MCP. */
    public function generate(array $args): array {
        if (!Kodety_Edition::has('ai')) {
            throw new RuntimeException('Ative uma licença Onun Kodety para usar a geração com IA.');
        }
        $task = sanitize_key((string) ($args['task'] ?? 'article'));
        if (!in_array($task, ['article', 'title', 'description', 'excerpt', 'seo', 'schema', 'social', 'rewrite', 'translation'], true)) throw new InvalidArgumentException('Tipo de geração inválido.');
        $brief = trim(wp_strip_all_tags((string) ($args['prompt'] ?? '')));
        if ($brief === '') throw new InvalidArgumentException('Descreva o que a IA deve criar.');
        $brief_length = function_exists('mb_strlen') ? mb_strlen($brief) : strlen($brief);
        if ($brief_length > 12000) throw new InvalidArgumentException('O briefing é muito longo.');
        $settings = $this->settings();
        $language = $this->limit_text(sanitize_text_field((string) ($args['language'] ?? $settings['language'])), 80);
        $tone = $this->limit_text(sanitize_text_field((string) ($args['tone'] ?? $settings['tone'])), 160);
        $context = wp_strip_all_tags((string) ($args['context'] ?? ''));
        $site_name = get_bloginfo('name');
        $schemas = [
            'article' => '{"title":"...","slug":"...","excerpt":"...","content":"HTML sem markdown","seoTitle":"...","seoDescription":"..."}',
            'title' => '{"title":"...","alternatives":["...","..."]}',
            'description' => '{"description":"...","shortDescription":"..."}',
            'excerpt' => '{"excerpt":"..."}',
            'seo' => '{"seoTitle":"...","seoDescription":"...","keywords":["..."]}',
            'schema' => '{"schemaType":"tipo Schema.org","schema":{"@context":"https://schema.org","@type":"...","propriedade":"valor"}}. Gere somente propriedades sustentadas pelo contexto. Preserve literalmente expressões {{campo}} recebidas.',
            'social' => '{"socialTitle":"...","socialDescription":"..."}',
            'rewrite' => '{"content":"HTML sem markdown","summary":"..."}',
            'translation' => '{"translations":{"chave-original":"texto traduzido"}}. Preserve exatamente cada chave recebida e retorne todas elas.',
        ];
        $system = "Você é o assistente editorial do CMS Onun Kodety para o site {$site_name}. Escreva em {$language}, com tom {$tone}. O briefing e o contexto fornecido são as únicas fontes factuais autorizadas. Não invente nem deduza nomes, números, datas, preços, recursos, localizações, resultados, clientes, certificações ou depoimentos. Quando uma informação não estiver confirmada, omita-a ou use uma formulação neutra que não acrescente fatos. Entregue apenas JSON válido, sem bloco markdown. HTML deve ser semântico, acessível e pronto para WordPress. Formato obrigatório: {$schemas[$task]}";
        $trimmed_context = function_exists('mb_substr') ? mb_substr($context, 0, 16000) : substr($context, 0, 16000);
        $user = "Tarefa: {$task}\nBriefing: {$brief}" . ($context !== '' ? "\nContexto existente: " . $trimmed_context : '');
        $result = $this->sanitize_generated_draft($task, $this->complete($system, $user, in_array($task, ['article', 'rewrite', 'translation', 'schema'], true) ? 3200 : 900));
        if ($result === []) throw new RuntimeException('A IA retornou um rascunho vazio. Tente novamente.');
        return ['task' => $task, 'draft' => $result, 'model' => $settings['model'], 'generatedAt' => gmdate('c')];
    }

    private function complete(string $system, string $user, int $max_tokens): array {
        $settings = $this->settings();
        $key = $this->api_key((string) $settings['provider']);
        if ($key === '') throw new RuntimeException('Configure uma API Key de IA em Settings → IA e MCP.');
        $base_url = (string) $settings['baseUrl'];
        if ($base_url === '') throw new RuntimeException('Configure um endpoint de IA válido.');
        // Codex models are Responses-only. The same model can be selected from
        // either the OpenAI or Codex profile, both of which use the official
        // endpoint and the same encrypted OpenAI credential.
        $responses_api = in_array($settings['provider'], ['openai', 'codex'], true)
            && str_contains(strtolower((string) $settings['model']), 'codex');
        $endpoint = $base_url . ($responses_api ? '/responses' : '/chat/completions');
        $local_endpoint = $this->is_allowed_local_endpoint($endpoint);
        if ($responses_api) {
            $body = [
                'model' => $settings['model'],
                'instructions' => $system,
                'input' => $user,
                'max_output_tokens' => $max_tokens,
                'text' => ['format' => ['type' => 'json_object']],
                'store' => false,
            ];
        } else {
            $body = [
                'model' => $settings['model'],
                'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $user]],
                'temperature' => $settings['temperature'],
                'max_tokens' => $max_tokens,
                'response_format' => ['type' => 'json_object'],
            ];
            if (in_array($settings['provider'], ['openai', 'codex', 'kimi'], true)) {
                $body['max_completion_tokens'] = $body['max_tokens'];
                unset($body['max_tokens']);
            }
            if ($settings['provider'] === 'kimi') unset($body['temperature']);
        }
        $headers = ['Authorization' => 'Bearer ' . $key, 'Content-Type' => 'application/json'];
        if ($settings['provider'] === 'openrouter') {
            $headers['HTTP-Referer'] = home_url('/');
            $headers['X-OpenRouter-Title'] = get_bloginfo('name') . ' · Onun Kodety CMS';
        }
        $request = [
            'timeout' => 90,
            // A redirect could forward Authorization to a different host. The
            // configured endpoint must answer directly.
            'redirection' => 0,
            'reject_unsafe_urls' => !$local_endpoint,
            'limit_response_size' => self::MAX_RESPONSE_BYTES,
            'headers' => $headers,
            'body' => wp_json_encode($body),
        ];
        $response = $local_endpoint ? wp_remote_post($endpoint, $request) : wp_safe_remote_post($endpoint, $request);
        if (is_wp_error($response)) throw new RuntimeException('Falha ao conectar à IA: ' . $response->get_error_message());
        $status = wp_remote_retrieve_response_code($response);
        $payload = json_decode(wp_remote_retrieve_body($response), true);
        // Several local/OpenAI-compatible providers support JSON prompts but
        // not response_format. Retry once without it for broader compatibility.
        if (!$responses_api && $status === 400 && str_contains(strtolower(wp_remote_retrieve_body($response)), 'response_format')) {
            unset($body['response_format']);
            $request['body'] = wp_json_encode($body);
            $response = $local_endpoint ? wp_remote_post($endpoint, $request) : wp_safe_remote_post($endpoint, $request);
            if (is_wp_error($response)) throw new RuntimeException('Falha ao conectar à IA: ' . $response->get_error_message());
            $status = wp_remote_retrieve_response_code($response);
            $payload = json_decode(wp_remote_retrieve_body($response), true);
        }
        if ($status < 200 || $status >= 300) {
            $message = is_array($payload) ? (string) ($payload['error']['message'] ?? $payload['message'] ?? '') : '';
            $message = substr(sanitize_text_field(str_replace($key, '[credencial protegida]', $message)), 0, 500);
            throw new RuntimeException($message !== '' ? $message : 'O provedor de IA respondeu com erro ' . $status . '.');
        }
        $content = '';
        $refusal = '';
        if ($responses_api && is_array($payload)) {
            $content = is_string($payload['output_text'] ?? null) ? (string) $payload['output_text'] : '';
            $message_content = '';
            foreach (is_array($payload['output'] ?? null) ? $payload['output'] : [] as $output) {
                if (!is_array($output) || ($output['type'] ?? '') !== 'message') continue;
                foreach (is_array($output['content'] ?? null) ? $output['content'] : [] as $item) {
                    if (!is_array($item)) continue;
                    if (($item['type'] ?? '') === 'output_text' && is_string($item['text'] ?? null)) {
                        $message_content .= (string) $item['text'];
                    } elseif (($item['type'] ?? '') === 'refusal' && is_string($item['refusal'] ?? null)) {
                        $refusal = (string) $item['refusal'];
                    }
                }
            }
            if ($content === '') $content = $message_content;
        } elseif (is_array($payload)) {
            $content = (string) ($payload['choices'][0]['message']['content'] ?? '');
        }
        if ($content === '' && $refusal !== '') {
            throw new RuntimeException(
                substr(sanitize_text_field(str_replace($key, '[credencial protegida]', $refusal)), 0, 500)
            );
        }
        $content = trim(preg_replace('/^```(?:json)?|```$/m', '', $content));
        $decoded = json_decode($content, true);
        if (!is_array($decoded)) throw new RuntimeException('A IA não retornou um conteúdo estruturado válido. Tente novamente.');
        return $decoded;
    }

    private function sanitize_custom_endpoint(string $candidate): string {
        $url = untrailingslashit(esc_url_raw(trim($candidate)));
        if ($url === '') return '';
        $parts = wp_parse_url($url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) return '';
        $scheme = strtolower((string) $parts['scheme']);
        if ($scheme === 'http') return $this->is_allowed_local_endpoint($url) ? $url : '';
        if ($scheme !== 'https') return '';
        return wp_http_validate_url($url) ? $url : '';
    }

    private function limit_text(string $value, int $length): string {
        return function_exists('mb_substr') ? mb_substr($value, 0, $length) : substr($value, 0, $length);
    }

    private function sanitize_generated_draft(string $task, array $draft): array {
        $text = fn(mixed $value, int $length = 4000): string => $this->limit_text(sanitize_text_field((string) $value), $length);
        $html = fn(mixed $value): string => $this->limit_text(wp_kses_post((string) $value), 200000);
        $list = static function (mixed $value, int $limit = 30) use ($text): array {
            if (!is_array($value)) return [];
            return array_values(array_filter(array_map(fn(mixed $item): string => $text($item, 300), array_slice($value, 0, $limit)), static fn(string $item): bool => $item !== ''));
        };
        return match ($task) {
            'article' => array_filter([
                'title' => $text($draft['title'] ?? '', 300),
                'slug' => sanitize_title((string) ($draft['slug'] ?? '')),
                'excerpt' => $text($draft['excerpt'] ?? '', 1000),
                'content' => $html($draft['content'] ?? ''),
                'seoTitle' => $text($draft['seoTitle'] ?? '', 300),
                'seoDescription' => $text($draft['seoDescription'] ?? '', 600),
            ], static fn(mixed $value): bool => $value !== ''),
            'title' => array_filter([
                'title' => $text($draft['title'] ?? '', 300),
                'alternatives' => $list($draft['alternatives'] ?? [], 20),
            ], static fn(mixed $value): bool => $value !== '' && $value !== []),
            'description' => array_filter([
                'description' => $text($draft['description'] ?? '', 4000),
                'shortDescription' => $text($draft['shortDescription'] ?? '', 1000),
            ], static fn(mixed $value): bool => $value !== ''),
            'excerpt' => array_filter(['excerpt' => $text($draft['excerpt'] ?? '', 1000)], static fn(string $value): bool => $value !== ''),
            'seo' => array_filter([
                'seoTitle' => $text($draft['seoTitle'] ?? '', 300),
                'seoDescription' => $text($draft['seoDescription'] ?? '', 600),
                'keywords' => $list($draft['keywords'] ?? [], 50),
            ], static fn(mixed $value): bool => $value !== '' && $value !== []),
            'schema' => array_filter([
                'schemaType' => $text($draft['schemaType'] ?? '', 120),
                'schema' => $this->sanitize_schema($draft['schema'] ?? null),
            ], static fn(mixed $value): bool => $value !== '' && $value !== [] && $value !== null),
            'social' => array_filter([
                'socialTitle' => $text($draft['socialTitle'] ?? '', 300),
                'socialDescription' => $text($draft['socialDescription'] ?? '', 1000),
            ], static fn(mixed $value): bool => $value !== ''),
            'rewrite' => array_filter([
                'content' => $html($draft['content'] ?? ''),
                'summary' => $text($draft['summary'] ?? '', 1000),
            ], static fn(mixed $value): bool => $value !== ''),
            'translation' => array_filter(
                ['translations' => $this->sanitize_translations($draft['translations'] ?? [])],
                static fn(array $value): bool => $value !== []
            ),
            default => [],
        };
    }

    private function sanitize_schema(mixed $value, int $depth = 0): mixed {
        if ($depth > 12) return null;
        if (is_bool($value) || is_int($value) || is_float($value) || $value === null) return $value;
        if (is_string($value)) {
            $clean = wp_strip_all_tags($value);
            $clean = str_ireplace(['</script', '<script'], ['', ''], $clean);
            return $this->limit_text($clean, 4000);
        }
        if (!is_array($value) || count($value) > 300) return null;
        $clean = [];
        foreach ($value as $key => $child) {
            $normalized_key = is_int($key) ? $key : (string) $key;
            if (is_string($normalized_key) && !preg_match('/^[@A-Za-z0-9_.:-]{1,120}$/', $normalized_key)) continue;
            $normalized_child = $this->sanitize_schema($child, $depth + 1);
            if ($normalized_child !== null) $clean[$normalized_key] = $normalized_child;
        }
        return $clean;
    }

    private function sanitize_translations(mixed $translations): array {
        if (!is_array($translations)) return [];
        $clean = [];
        foreach (array_slice($translations, 0, 5000, true) as $key => $value) {
            $key = (string) $key;
            if ($key === '' || strlen($key) > 1000 || !is_scalar($value)) continue;
            $clean[$key] = $this->limit_text(wp_kses_post((string) $value), 16000);
        }
        return $clean;
    }

    private function is_allowed_local_endpoint(string $url): bool {
        $parts = wp_parse_url($url);
        $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
        if (($parts['scheme'] ?? '') !== 'http' || !in_array($host, ['localhost', '127.0.0.1', '::1'], true)) return false;
        $environment = function_exists('wp_get_environment_type') ? wp_get_environment_type() : 'production';
        $allowed = in_array($environment, ['local', 'development'], true)
            || (defined('KODETY_AI_ALLOW_LOCAL_ENDPOINTS') && KODETY_AI_ALLOW_LOCAL_ENDPOINTS === true);
        return (bool) apply_filters('kodety_ai_allow_local_endpoint', $allowed, $url);
    }

    private function secret_map(): array {
        $stored = get_option(self::OPTION_SECRET, []);
        if (is_array($stored)) return $stored;
        // Migrate the first single-provider implementation without exposing it.
        return is_string($stored) && $stored !== '' ? ['openai' => $stored] : [];
    }

    private function api_key(string $provider): string {
        $secrets = $this->secret_map();
        return $this->decrypt((string) ($secrets[$provider === 'codex' ? 'openai' : $provider] ?? ''));
    }

    private function encryption_key(): string {
        return hash('sha256', wp_salt('auth') . wp_salt('secure_auth'), true);
    }

    private function encrypt(string $plain): string {
        if ($plain === '') return '';
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            return 'sodium:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $this->encryption_key()));
        }
        if (!function_exists('openssl_encrypt')) throw new RuntimeException('Nenhum mecanismo de criptografia compatível está disponível.');
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $this->encryption_key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) throw new RuntimeException('Não foi possível proteger a API Key.');
        return 'openssl:' . base64_encode($iv . $tag . $cipher);
    }

    private function decrypt(string $stored): string {
        if ($stored === '') return '';
        if (str_starts_with($stored, 'sodium:') && function_exists('sodium_crypto_secretbox_open')) {
            $raw = base64_decode(substr($stored, 7), true);
            if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return '';
            $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $this->encryption_key());
            return $plain === false ? '' : $plain;
        }
        if (str_starts_with($stored, 'openssl:')) {
            if (!function_exists('openssl_decrypt')) return '';
            $raw = base64_decode(substr($stored, 8), true);
            if ($raw === false || strlen($raw) <= 28) return '';
            $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $this->encryption_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
            return $plain === false ? '' : $plain;
        }
        return '';
    }
}
