<?php

defined('ABSPATH') || exit;

/**
 * Meta Conversions API integration.
 *
 * The access token is encrypted at rest and never returned to the editor or
 * published theme. Browser and server events share event_id so Meta can
 * deduplicate Pixel and CAPI deliveries.
 */
final class Kodety_Meta_CAPI {
    private const OPTION = 'kodety_meta_capi_settings';
    private const QUEUE_OPTION = 'kodety_meta_capi_retry_queue';
    private const RETRY_HOOK = 'kodety_meta_capi_retry';
    private const DEFAULT_GRAPH_VERSION = 'v23.0';
    private const MAX_QUEUE = 100;
    private const MAX_ATTEMPTS = 5;
    private const MAX_RETRY_AFTER = 3600;
    private const PUBLIC_RATE_LIMIT = 120;
    private const STANDARD_EVENTS = [
        'PageView',
        'ViewContent',
        'Search',
        'AddToCart',
        'AddToWishlist',
        'InitiateCheckout',
        'AddPaymentInfo',
        'Purchase',
        'Lead',
        'CompleteRegistration',
        'Contact',
        'CustomizeProduct',
        'Donate',
        'FindLocation',
        'Schedule',
        'StartTrial',
        'SubmitApplication',
        'Subscribe',
    ];

    private static ?self $instance = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('init', [$this, 'ensure_retry_schedule']);
        add_action('wp_footer', [$this, 'print_runtime'], 98);
        add_action(self::RETRY_HOOK, [$this, 'process_retry_queue']);
        add_action('kodety_member_registered', [$this, 'track_member_registration'], 10, 2);
        add_action('kodety_checkout_sale_projected', [$this, 'track_checkout_sale'], 10, 6);
    }

    public static function activate(): void {
        if (get_option(self::OPTION, null) === null) {
            add_option(self::OPTION, [
                'enabled' => false,
                'pixel_id' => '',
                'access_token' => '',
                'graph_version' => self::DEFAULT_GRAPH_VERSION,
                'test_event_code' => '',
                'data_processing_options' => [],
                'data_processing_country' => 0,
                'data_processing_state' => 0,
                'last_result' => null,
            ], '', false);
        }
        if (get_option(self::QUEUE_OPTION, null) === null) {
            add_option(self::QUEUE_OPTION, [], '', false);
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook(self::RETRY_HOOK);
    }

    public function register_rest_routes(): void {
        register_rest_route('kodety/v1', '/analytics/meta-capi/settings', [
            [
                'methods' => 'GET',
                'callback' => [$this, 'get_settings'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
            [
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => [$this, 'update_settings'],
                'permission_callback' => [$this, 'manage_permission'],
            ],
        ]);
        register_rest_route('kodety/v1', '/analytics/meta-capi/test', [
            'methods' => 'POST',
            'callback' => [$this, 'test_connection'],
            'permission_callback' => [$this, 'manage_permission'],
        ]);
        register_rest_route('kodety/v1', '/analytics/meta-capi/events', [
            'methods' => 'POST',
            'callback' => [$this, 'collect'],
            'permission_callback' => '__return_true',
        ]);
    }

    public function manage_permission(WP_REST_Request $request): bool|WP_Error {
        if (!current_user_can('kodety_manage_analytics')) {
            return new WP_Error('kodety_meta_capi_forbidden', 'Sem permissão para gerenciar a Meta CAPI.', ['status' => 403]);
        }
        if (class_exists('Kodety_Native_Operations')
            && Kodety_Native_Operations::is_authenticated_mcp_request($request)) return true;
        $nonce = $request->get_header('X-WP-Nonce');
        if ($nonce === '') $nonce = (string) $request->get_param('_wpnonce');
        if ($nonce === '' || !wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error('kodety_meta_capi_nonce', 'A sessão expirou.', ['status' => 403]);
        }
        return true;
    }

    private function licensed(): bool {
        return class_exists('Kodety_Edition')
            && Kodety_Edition::has('analyticsMetaCapi');
    }

    private function license_error(): WP_Error {
        $data = ['status' => 403, 'feature' => 'analyticsMetaCapi'];
        if (class_exists('Kodety_Edition')) {
            if (method_exists('Kodety_Edition', 'license_url')) {
                $data['licenseUrl'] = Kodety_Edition::license_url();
            }
            if (method_exists('Kodety_Edition', 'upgrade_url')) {
                $data['upgradeUrl'] = Kodety_Edition::upgrade_url();
            }
        }
        return new WP_Error(
            'kodety_meta_capi_pro_required',
            'Ative uma licença Pro do Onun Kodety para ativar ou executar a Meta CAPI.',
            $data
        );
    }

    public function get_settings(): WP_REST_Response {
        return $this->response($this->public_settings());
    }

    public function update_settings(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $input = $request->get_json_params();
        if (!is_array($input)) $input = [];
        $current = $this->settings();
        $enabled_was_requested = array_key_exists('enabled', $input);
        $enabled = $enabled_was_requested
            ? rest_sanitize_boolean($input['enabled'])
            : !empty($current['enabled']);
        if ($enabled_was_requested && $enabled && !$this->licensed()) {
            return $this->license_error();
        }
        $pixel_id = preg_replace('/\D+/', '', (string) ($input['pixelId'] ?? $current['pixel_id']));
        if ($pixel_id !== '' && !preg_match('/^\d{5,32}$/', $pixel_id)) {
            return new WP_Error('kodety_meta_capi_pixel', 'Informe um Pixel ID válido.', ['status' => 422]);
        }
        $graph_version = trim((string) ($input['graphVersion'] ?? $current['graph_version']));
        if (!preg_match('/^v\d{1,2}\.\d$/', $graph_version)) {
            return new WP_Error('kodety_meta_capi_graph_version', 'Versão da Graph API inválida.', ['status' => 422]);
        }
        $test_code = strtoupper(trim((string) ($input['testEventCode'] ?? $current['test_event_code'])));
        if ($test_code !== '' && !preg_match('/^TEST[A-Z0-9_-]{1,64}$/', $test_code)) {
            return new WP_Error('kodety_meta_capi_test_code', 'Código de teste inválido.', ['status' => 422]);
        }
        $token = trim((string) ($input['accessToken'] ?? ''));
        $encrypted = !empty($input['clearToken'])
            ? ''
            : ($token !== '' ? $this->encrypt($token) : (string) $current['access_token']);
        if (is_wp_error($encrypted)) return $encrypted;
        if ($enabled && ($pixel_id === '' || $encrypted === '')) {
            return new WP_Error(
                'kodety_meta_capi_incomplete',
                'Pixel ID e token de acesso são obrigatórios para ativar a CAPI.',
                ['status' => 422]
            );
        }
        $ldu = rest_sanitize_boolean($input['limitedDataUse'] ?? false);
        $next = [
            'enabled' => $enabled,
            'pixel_id' => $pixel_id,
            'access_token' => $encrypted,
            'graph_version' => $graph_version,
            'test_event_code' => $test_code,
            'data_processing_options' => $ldu ? ['LDU'] : [],
            'data_processing_country' => $ldu ? max(0, absint($input['dataProcessingCountry'] ?? 0)) : 0,
            'data_processing_state' => $ldu ? max(0, absint($input['dataProcessingState'] ?? 0)) : 0,
            'last_result' => $current['last_result'],
        ];
        update_option(self::OPTION, $next, false);
        return $this->response($this->public_settings($next));
    }

    public function test_connection(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        $settings = $this->settings();
        if ($settings['pixel_id'] === '' || $settings['access_token'] === '') {
            return new WP_Error('kodety_meta_capi_not_configured', 'Salve o Pixel ID e o token antes de testar.', ['status' => 422]);
        }
        if ($settings['test_event_code'] === '') {
            return new WP_Error(
                'kodety_meta_capi_test_code_required',
                'Informe o código da aba “Testar eventos” da Meta antes de enviar o teste.',
                ['status' => 422]
            );
        }
        $event = $this->prepare_event([
            'eventName' => 'KodetyCapiTest',
            'eventId' => 'kodety-test-' . wp_generate_uuid4(),
            'eventTime' => time(),
            'eventSourceUrl' => home_url('/'),
            'actionSource' => 'website',
            'customData' => ['content_name' => 'Teste de conexão Onun Kodety'],
        ], $request);
        if (is_wp_error($event)) return $event;
        $result = $this->deliver([$event], true);
        if (is_wp_error($result)) return $result;
        return $this->response(array_merge(
            ['message' => 'Evento de teste aceito pela Meta. Confira o Gerenciador de Eventos.'],
            $this->public_settings()
        ));
    }

    public function collect(WP_REST_Request $request): WP_REST_Response|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        $allowed = $this->public_request_allowed($request);
        if (is_wp_error($allowed)) {
            if ($allowed->get_error_code() === 'kodety_meta_capi_privacy') return $this->response(null, 204);
            return $allowed;
        }
        $settings = $this->settings();
        if (empty($settings['enabled'])) {
            return new WP_Error('kodety_meta_capi_disabled', 'Meta CAPI desativada.', ['status' => 503]);
        }
        $payload = $request->get_json_params();
        if (!is_array($payload)) {
            return new WP_Error('kodety_meta_capi_payload', 'Payload inválido.', ['status' => 400]);
        }
        $rows = isset($payload['events']) && is_array($payload['events']) ? $payload['events'] : [$payload];
        if (!$rows || count($rows) > 10) {
            return new WP_Error('kodety_meta_capi_batch', 'Lote vazio ou acima do limite.', ['status' => 400]);
        }
        $events = [];
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $event = $this->prepare_event($row, $request);
            if (!is_wp_error($event)) $events[] = $event;
        }
        if (!$events) return new WP_Error('kodety_meta_capi_events', 'Nenhum evento válido.', ['status' => 422]);
        $result = $this->deliver($events);
        if (is_wp_error($result)) {
            if ($this->should_retry($result)) {
                $queued = $this->enqueue($events, 1, $result->get_error_message(), $result);
                if (is_wp_error($queued)) return $queued;
                return $this->response(['accepted' => count($events), 'queued' => true], 202);
            }
            return $result;
        }
        return $this->response([
            'accepted' => count($events),
            'queued' => false,
            'eventsReceived' => absint($result['events_received'] ?? count($events)),
            'requestId' => sanitize_text_field((string) ($result['fbtrace_id'] ?? '')),
        ], 202);
    }

    /** @return array<string,mixed>|WP_Error */
    private function prepare_event(array $raw, ?WP_REST_Request $request = null): array|WP_Error {
        $name = trim((string) ($raw['eventName'] ?? $raw['event_name'] ?? ''));
        if (!preg_match('/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/', $name)) {
            return new WP_Error('kodety_meta_capi_event_name', 'Nome de evento inválido.', ['status' => 422]);
        }
        $event_id = trim((string) ($raw['eventId'] ?? $raw['event_id'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/', $event_id)) $event_id = wp_generate_uuid4();
        $event_time = absint($raw['eventTime'] ?? $raw['event_time'] ?? time());
        if ($event_time < time() - 7 * DAY_IN_SECONDS || $event_time > time() + 5 * MINUTE_IN_SECONDS) {
            $event_time = time();
        }
        $source_url = esc_url_raw((string) ($raw['eventSourceUrl'] ?? $raw['event_source_url'] ?? home_url('/')));
        if ($source_url === '') $source_url = home_url('/');
        $action_source = sanitize_key((string) ($raw['actionSource'] ?? $raw['action_source'] ?? 'website'));
        if (!in_array($action_source, ['website', 'app', 'phone_call', 'chat', 'email', 'physical_store', 'system_generated', 'other'], true)) {
            $action_source = 'website';
        }
        $user_data = is_array($raw['userData'] ?? null) ? $raw['userData'] : [];
        if ($request) {
            $user_data['client_ip_address'] = $this->request_ip();
            $user_data['client_user_agent'] = substr((string) $request->get_header('User-Agent'), 0, 500);
        }
        $event = [
            'event_name' => $name,
            'event_time' => $event_time,
            'event_id' => $event_id,
            'action_source' => $action_source,
            'event_source_url' => $source_url,
            'user_data' => $this->normalize_user_data($user_data),
        ];
        $custom_data = $this->normalize_custom_data(is_array($raw['customData'] ?? null) ? $raw['customData'] : []);
        if ($custom_data) $event['custom_data'] = $custom_data;
        return $event;
    }

    /** @return array<string,mixed> */
    private function normalize_user_data(array $input): array {
        $result = [];
        $aliases = [
            'email' => 'em', 'em' => 'em',
            'phone' => 'ph', 'ph' => 'ph',
            'firstName' => 'fn', 'fn' => 'fn',
            'lastName' => 'ln', 'ln' => 'ln',
            'city' => 'ct', 'ct' => 'ct',
            'state' => 'st', 'st' => 'st',
            'zip' => 'zp', 'postalCode' => 'zp', 'zp' => 'zp',
            'country' => 'country',
            'gender' => 'ge', 'ge' => 'ge',
            'dateOfBirth' => 'db', 'db' => 'db',
            'externalId' => 'external_id', 'external_id' => 'external_id',
        ];
        foreach ($aliases as $source => $target) {
            if (!array_key_exists($source, $input)) continue;
            $values = is_array($input[$source]) ? $input[$source] : [$input[$source]];
            $hashed = [];
            foreach (array_slice($values, 0, 5) as $value) {
                $normalized = $this->normalize_identity((string) $value, $target);
                if ($normalized === '') continue;
                $hashed[] = preg_match('/^[a-f0-9]{64}$/', $normalized)
                    ? strtolower($normalized)
                    : hash('sha256', $normalized);
            }
            if ($hashed) $result[$target] = count($hashed) === 1 ? $hashed[0] : array_values(array_unique($hashed));
        }
        foreach (['fbp', 'fbc'] as $key) {
            $value = substr(trim((string) ($input[$key] ?? '')), 0, 255);
            if ($value !== '' && preg_match('/^fb\.[12]\.\d{10,16}\.[A-Za-z0-9._-]+$/', $value)) $result[$key] = $value;
        }
        foreach (['client_ip_address', 'client_user_agent'] as $key) {
            $value = trim((string) ($input[$key] ?? ''));
            if ($value !== '') $result[$key] = substr($value, 0, $key === 'client_ip_address' ? 64 : 500);
        }
        return $result;
    }

    private function normalize_identity(string $value, string $field): string {
        $value = trim(function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value));
        if ($value === '') return '';
        if ($field === 'em') return sanitize_email($value);
        if ($field === 'ph') return preg_replace('/\D+/', '', $value);
        if ($field === 'db') return preg_replace('/\D+/', '', $value);
        if (in_array($field, ['fn', 'ln', 'ct', 'st', 'country', 'ge'], true)) {
            $ascii = remove_accents($value);
            return preg_replace('/[^a-z0-9]/', '', strtolower($ascii));
        }
        return substr($value, 0, 255);
    }

    /** @return array<string,mixed> */
    private function normalize_custom_data(array $input): array {
        $result = [];
        foreach (['content_name', 'content_category', 'content_type', 'order_id', 'search_string', 'status'] as $key) {
            if (!isset($input[$key])) continue;
            $value = sanitize_text_field(substr((string) $input[$key], 0, 255));
            if ($value !== '') $result[$key] = $value;
        }
        if (isset($input['value']) && is_numeric($input['value'])) $result['value'] = round((float) $input['value'], 4);
        $currency = strtoupper(sanitize_text_field((string) ($input['currency'] ?? '')));
        if (preg_match('/^[A-Z]{3}$/', $currency)) $result['currency'] = $currency;
        if (isset($input['num_items'])) $result['num_items'] = min(10000, absint($input['num_items']));
        if (is_array($input['content_ids'] ?? null)) {
            $ids = array_values(array_filter(array_map(
                static fn(mixed $value): string => sanitize_text_field(substr((string) $value, 0, 191)),
                array_slice($input['content_ids'], 0, 100)
            )));
            if ($ids) $result['content_ids'] = $ids;
        }
        if (is_array($input['contents'] ?? null)) {
            $contents = [];
            foreach (array_slice($input['contents'], 0, 100) as $item) {
                if (!is_array($item)) continue;
                $id = sanitize_text_field(substr((string) ($item['id'] ?? ''), 0, 191));
                if ($id === '') continue;
                $row = ['id' => $id, 'quantity' => max(1, min(10000, absint($item['quantity'] ?? 1)))];
                if (isset($item['item_price']) && is_numeric($item['item_price'])) $row['item_price'] = round((float) $item['item_price'], 4);
                $contents[] = $row;
            }
            if ($contents) $result['contents'] = $contents;
        }
        return $result;
    }

    /** @param array<int,array<string,mixed>> $events @return array<string,mixed>|WP_Error */
    private function deliver(array $events, bool $test = false): array|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        $settings = $this->settings();
        $token = $this->decrypt((string) $settings['access_token']);
        if (is_wp_error($token) || $token === '') {
            return new WP_Error('kodety_meta_capi_token', 'Token da Meta indisponível.', ['status' => 503]);
        }
        $body = ['data' => array_values($events)];
        if ($settings['data_processing_options']) {
            foreach ($body['data'] as &$event) {
                $event['data_processing_options'] = $settings['data_processing_options'];
                $event['data_processing_options_country'] = (int) $settings['data_processing_country'];
                $event['data_processing_options_state'] = (int) $settings['data_processing_state'];
            }
            unset($event);
        }
        if (($test || $settings['test_event_code'] !== '') && $settings['test_event_code'] !== '') {
            $body['test_event_code'] = $settings['test_event_code'];
        }
        $url = sprintf(
            'https://graph.facebook.com/%s/%s/events',
            rawurlencode((string) $settings['graph_version']),
            rawurlencode((string) $settings['pixel_id'])
        );
        $response = wp_safe_remote_post($url, [
            'timeout' => 12,
            'redirection' => 0,
            'reject_unsafe_urls' => true,
            'limit_response_size' => 1024 * 1024,
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
            ],
            'body' => wp_json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'data_format' => 'body',
        ]);
        if (is_wp_error($response)) {
            $this->record_result(false, $response->get_error_message(), '', 0);
            return $response;
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
        if (!is_array($decoded)) $decoded = [];
        if ($status < 200 || $status >= 300 || isset($decoded['error'])) {
            $message = sanitize_text_field((string) (
                $decoded['error']['error_user_msg']
                ?? $decoded['error']['message']
                ?? wp_remote_retrieve_response_message($response)
                ?? 'A Meta recusou o evento.'
            ));
            $this->record_result(false, $message, (string) ($decoded['error']['fbtrace_id'] ?? ''), $status);
            $error_data = [
                'status' => $status ?: 502,
                'retryable' => in_array($status, [408, 425, 429], true) || $status >= 500,
            ];
            $retry_after = $this->retry_after_seconds($response, $status);
            if ($retry_after > 0) $error_data['retry_after'] = $retry_after;
            return new WP_Error('kodety_meta_capi_delivery', $message, $error_data);
        }
        $events_received = $decoded['events_received'] ?? null;
        if (!is_int($events_received) || $events_received !== count($events)) {
            $message = 'A Meta não confirmou a entrega completa dos eventos.';
            $this->record_result(false, $message, (string) ($decoded['fbtrace_id'] ?? ''), $status);
            return new WP_Error('kodety_meta_capi_delivery', $message, [
                'status' => 502,
                'retryable' => true,
            ]);
        }
        $this->record_result(
            true,
            'Eventos aceitos pela Meta.',
            (string) ($decoded['fbtrace_id'] ?? ''),
            $status,
            $events_received
        );
        return $decoded;
    }

    /** @param array<int,array<string,mixed>> $events */
    private function enqueue(array $events, int $attempt, string $error, ?WP_Error $cause = null): bool|WP_Error {
        if (!$this->licensed()) return $this->license_error();
        $queue = get_option(self::QUEUE_OPTION, []);
        if (!is_array($queue)) $queue = [];
        $queue = array_values(array_filter($queue, 'is_array'));
        $queue[] = [
            'id' => wp_generate_uuid4(),
            'events' => $events,
            'attempt' => max(1, $attempt),
            'created_at' => time(),
            'next_attempt' => time() + $this->retry_delay($attempt, $cause),
            'last_error' => substr(sanitize_text_field($error), 0, 500),
        ];
        $queue = array_slice($queue, -self::MAX_QUEUE);
        if (!$this->persist_retry_queue($queue)) {
            return new WP_Error(
                'kodety_meta_capi_queue_storage',
                'O evento não pôde ser salvo na fila de tentativas da Meta.',
                ['status' => 503, 'retryable' => true, 'queuedPersisted' => false]
            );
        }
        $scheduled = $this->schedule_retry_at(
            min(array_map(
                static fn(array $item): int => absint($item['next_attempt'] ?? 0),
                $queue
            ))
        );
        if (is_wp_error($scheduled)) return $scheduled;
        return true;
    }

    public function process_retry_queue(): void {
        if (!$this->licensed()) return;
        $queue = get_option(self::QUEUE_OPTION, []);
        if (!is_array($queue) || !$queue) return;
        $remaining = [];
        $now = time();
        foreach ($queue as $item) {
            if (!is_array($item) || $now - absint($item['created_at'] ?? 0) > DAY_IN_SECONDS) continue;
            if (absint($item['next_attempt'] ?? 0) > $now) {
                $remaining[] = $item;
                continue;
            }
            $result = $this->deliver(is_array($item['events'] ?? null) ? $item['events'] : []);
            if (!is_wp_error($result)) continue;
            if (!$this->should_retry($result)) continue;
            $attempt = absint($item['attempt'] ?? 1) + 1;
            if ($attempt > self::MAX_ATTEMPTS) continue;
            $item['attempt'] = $attempt;
            $item['next_attempt'] = $now + $this->retry_delay($attempt, $result);
            $item['last_error'] = substr($result->get_error_message(), 0, 500);
            $remaining[] = $item;
        }
        $remaining = array_slice($remaining, -self::MAX_QUEUE);
        if (!$this->persist_retry_queue($remaining)) {
            error_log('[Onun Kodety] A fila de tentativas da Meta não pôde ser atualizada; os eventos anteriores foram preservados para nova tentativa.');
            $this->ensure_retry_schedule();
            return;
        }
        if ($remaining) {
            $next = min(array_map(static fn(array $item): int => absint($item['next_attempt'] ?? ($now + MINUTE_IN_SECONDS)), $remaining));
            $scheduled = $this->schedule_retry_at($next);
            if (is_wp_error($scheduled)) {
                error_log('[Onun Kodety] A fila da Meta foi preservada, mas o próximo worker não pôde ser agendado: ' . $scheduled->get_error_message());
            }
        }
    }

    /** Re-arm a durable queue after a previous cron scheduling failure. */
    public function ensure_retry_schedule(): void {
        if (!$this->licensed()) return;
        $queue = get_option(self::QUEUE_OPTION, []);
        if (!is_array($queue) || !$queue || wp_next_scheduled(self::RETRY_HOOK)) return;
        $queue = array_values(array_filter($queue, 'is_array'));
        if (!$queue) {
            $this->persist_retry_queue([]);
            return;
        }
        $now = time();
        $next = min(array_map(
            static fn(array $item): int => absint($item['next_attempt'] ?? ($now + MINUTE_IN_SECONDS)),
            $queue
        ));
        $scheduled = $this->schedule_retry_at($next);
        if (is_wp_error($scheduled)) {
            error_log('[Onun Kodety] Não foi possível rearmar a fila durável da Meta: ' . $scheduled->get_error_message());
        }
    }

    /** @param array<int,array<string,mixed>> $queue */
    private function persist_retry_queue(array $queue): bool {
        $queue = array_slice(array_values($queue), -self::MAX_QUEUE);
        update_option(self::QUEUE_OPTION, $queue, false);
        $stored = get_option(self::QUEUE_OPTION, null);
        return is_array($stored) && $stored === $queue;
    }

    private function schedule_retry_at(int $timestamp): bool|WP_Error {
        if (wp_next_scheduled(self::RETRY_HOOK)) return true;
        $scheduled = wp_schedule_single_event(
            max(time() + MINUTE_IN_SECONDS, $timestamp),
            self::RETRY_HOOK,
            [],
            true
        );
        if (is_wp_error($scheduled)) {
            return new WP_Error(
                'kodety_meta_capi_queue_schedule',
                'O evento foi preservado, mas o processamento da fila da Meta não pôde ser agendado.',
                [
                    'status' => 503,
                    'retryable' => true,
                    'queuedPersisted' => true,
                    'reason' => $scheduled->get_error_message(),
                ]
            );
        }
        if ($scheduled === false) {
            return new WP_Error(
                'kodety_meta_capi_queue_schedule',
                'O evento foi preservado, mas o processamento da fila da Meta não pôde ser agendado.',
                ['status' => 503, 'retryable' => true, 'queuedPersisted' => true]
            );
        }
        return true;
    }

    public function track_member_registration(int $user_id, ?WP_User $user = null): void {
        if (!$this->enabled()) return;
        $user = $user instanceof WP_User ? $user : get_user_by('id', $user_id);
        if (!$user instanceof WP_User) return;
        $event = $this->prepare_event([
            'eventName' => 'CompleteRegistration',
            'eventId' => 'member-' . $user_id . '-' . time(),
            'eventSourceUrl' => home_url('/'),
            'actionSource' => 'website',
            'userData' => ['email' => $user->user_email, 'externalId' => (string) $user_id],
            'customData' => ['content_name' => 'Membership registration', 'status' => 'completed'],
        ]);
        if (!is_wp_error($event)) $this->deliver_or_queue([$event]);
    }

    public function track_checkout_sale(
        string $sale_uuid,
        int $user_id,
        int $plan_id,
        string $status,
        string $access_status,
        array $commerce = []
    ): void {
        if (!$this->enabled() || $status !== 'paid' || !in_array($access_status, ['granted', 'blocked'], true)) return;
        $user = $user_id > 0 ? get_user_by('id', $user_id) : false;
        $user_data = ['externalId' => $user_id > 0 ? (string) $user_id : $sale_uuid];
        if ($user instanceof WP_User) $user_data['email'] = $user->user_email;
        elseif (is_email((string) ($commerce['customerEmail'] ?? ''))) $user_data['email'] = $commerce['customerEmail'];
        $amount = isset($commerce['amount']) && is_numeric($commerce['amount'])
            ? max(0, ((float) $commerce['amount']) / 100)
            : null;
        $currency = strtoupper(sanitize_text_field((string) ($commerce['currency'] ?? '')));
        $event = $this->prepare_event([
            'eventName' => 'Purchase',
            'eventId' => 'purchase-' . $sale_uuid,
            'eventTime' => is_string($commerce['occurredAt'] ?? null) ? strtotime($commerce['occurredAt']) : time(),
            'eventSourceUrl' => home_url('/'),
            'actionSource' => 'system_generated',
            'userData' => $user_data,
            'customData' => [
                'order_id' => $sale_uuid,
                'content_ids' => $plan_id > 0 ? [(string) $plan_id] : [],
                'content_type' => 'product',
                'status' => 'completed',
                'value' => $amount,
                'currency' => preg_match('/^[A-Z]{3}$/', $currency) ? $currency : '',
            ],
        ]);
        if (!is_wp_error($event)) $this->deliver_or_queue([$event]);
    }

    /** @param array<int,array<string,mixed>> $events */
    private function deliver_or_queue(array $events): void {
        $result = $this->deliver($events);
        if (is_wp_error($result) && $this->should_retry($result)) {
            $queued = $this->enqueue($events, 1, $result->get_error_message(), $result);
            if (is_wp_error($queued)) {
                error_log('[Onun Kodety] Evento da Meta não pôde entrar na fila durável: ' . $queued->get_error_message());
            }
        }
    }

    private function should_retry(WP_Error $error): bool {
        if ($error->get_error_code() === 'kodety_meta_capi_pro_required') return false;
        if ($error->get_error_code() !== 'kodety_meta_capi_delivery') return true;
        $data = $error->get_error_data();
        return is_array($data) && !empty($data['retryable']);
    }

    private function retry_after_seconds(array $response, int $status): int {
        if (!in_array($status, [429, 503], true)) return 0;
        $header = wp_remote_retrieve_header($response, 'retry-after');
        if (is_array($header)) $header = reset($header);
        $value = trim(is_scalar($header) ? (string) $header : '');
        if ($value === '') return 0;
        if (ctype_digit($value)) {
            $seconds = (int) $value;
        } else {
            $timestamp = strtotime($value);
            $seconds = $timestamp === false ? 0 : max(0, $timestamp - time());
        }
        return $seconds > 0 ? min(self::MAX_RETRY_AFTER, $seconds) : 0;
    }

    private function retry_delay(int $attempt, ?WP_Error $cause = null): int {
        $attempt = max(1, min(self::MAX_ATTEMPTS, $attempt));
        $backoff = min(HOUR_IN_SECONDS, 60 * (2 ** ($attempt - 1)));
        $data = $cause instanceof WP_Error ? $cause->get_error_data() : null;
        $retry_after = is_array($data) ? absint($data['retry_after'] ?? 0) : 0;
        return min(self::MAX_RETRY_AFTER, max($backoff, $retry_after));
    }

    public function print_runtime(): void {
        if (is_admin() || !$this->enabled()) return;
        $this->protect_runtime_response_from_cache();
        $settings = $this->settings();
        $config = [
            'endpoint' => rest_url('kodety/v1/analytics/meta-capi/events'),
            'pixelId' => $settings['pixel_id'],
            'consentRequired' => class_exists('Kodety_Analytics') && Kodety_Analytics::consent_manager_enabled(),
        ];
        ?>
        <script data-kodety-meta-capi="1">
        (() => {
          "use strict";
          if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
          const config = <?php echo wp_json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
          const marketingConsentGranted = () => {
            const manager = window.kodety?.consent;
            if (manager && typeof manager.hasIntegration === "function") return manager.hasIntegration("metaPixel") === true;
            if (manager && typeof manager.has === "function") return manager.has("marketing") === true;
            if (config.consentRequired) return window.__kodetyMarketingConsentGranted === true;
            return window.__kodetyMarketingConsentGranted !== false
              && window.__kodetyAnalyticsConsentGranted !== false;
          };
          const randomId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
          const cookie = name => document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(name + "="))?.slice(name.length + 1) || "";
          const fbc = () => {
            const stored = cookie("_fbc");
            if (stored) return stored;
            const fbclid = new URLSearchParams(location.search).get("fbclid");
            return fbclid ? `fb.1.${Date.now()}.${fbclid}` : "";
          };
          const allowed = new Set(<?php echo wp_json_encode(self::STANDARD_EVENTS); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>);
          const send = (eventName, customData = {}, userData = {}, options = {}) => {
            if (
              !marketingConsentGranted()
              || !window.__kodetyMetaPixelPageViewSent
              || navigator.doNotTrack === "1"
              || window.doNotTrack === "1"
              || navigator.globalPrivacyControl === true
            ) return "";
            const eventId = String(options.eventId || randomId());
            const body = {
              eventName: String(eventName || "PageView"),
              eventId,
              eventTime: Math.floor(Date.now() / 1000),
              eventSourceUrl: location.href,
              actionSource: "website",
              customData: customData && typeof customData === "object" ? customData : {},
              userData: { ...(userData && typeof userData === "object" ? userData : {}), fbp: cookie("_fbp"), fbc: fbc() },
            };
            fetch(config.endpoint, {
              method: "POST",
              credentials: "same-origin",
              keepalive: true,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }).catch(() => {});
            if (options.pixel !== false && typeof window.fbq === "function") {
              const method = allowed.has(body.eventName) ? "track" : "trackCustom";
              window.fbq(method, body.eventName, body.customData, { eventID: eventId });
            }
            return eventId;
          };
          const api = Object.freeze({ track: send, pageView: (data = {}, options = {}) => send("PageView", data, {}, options) });
          window.kodetyMeta = api;
          window.kodety = window.kodety || {};
          window.kodety.meta = api;
          window.addEventListener("kodety:meta-event", event => {
            const detail = event.detail || {};
            send(detail.eventName || detail.name || "PageView", detail.customData || {}, detail.userData || {}, detail.options || {});
          });
          window.addEventListener("kodety:analytics-event", event => {
            const detail = event.detail || {};
            const mapped = detail.type === "pageview" ? "PageView"
              : detail.type === "submit" ? "Lead"
              : detail.type === "conversion" ? (detail.name || "Lead")
              : "";
            if (!mapped || (mapped === "PageView" && window.__kodetyMetaPageViewSent)) return;
            if (mapped === "PageView") window.__kodetyMetaPageViewSent = true;
            send(mapped, detail.metadata || {}, {}, { eventId: detail.eventId });
          });
          const pageView = eventId => {
            if (window.__kodetyMetaPageViewSent) return;
            window.__kodetyMetaPageViewSent = true;
            send("PageView", {}, {}, { eventId: String(eventId || window.__kodetyMetaPageViewEventId || randomId()), pixel: !window.__kodetyMetaPixelPageViewSent });
          };
          if (window.__kodetyMetaPixelPageViewSent) pageView(window.__kodetyMetaPageViewEventId);
          else window.addEventListener("kodety:meta-pixel-ready", event => pageView(event.detail?.eventId), { once: true });
        })();
        </script>
        <?php
    }

    /** A cached Pixel/CAPI bridge must not survive a later license expiry. */
    private function protect_runtime_response_from_cache(): void {
        if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
        if (!defined('LSCACHE_NO_CACHE')) define('LSCACHE_NO_CACHE', true);
        if (function_exists('nocache_headers')) nocache_headers();
        if (headers_sent()) return;
        header('Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0', true);
        header('Pragma: no-cache', true);
        header('Vary: Cookie', false);
    }

    private function enabled(): bool {
        if (!$this->licensed()) return false;
        $settings = $this->settings();
        return !empty($settings['enabled']) && $settings['pixel_id'] !== '' && $settings['access_token'] !== '';
    }

    private function public_request_allowed(WP_REST_Request $request): bool|WP_Error {
        if ($request->get_header('DNT') === '1' || $request->get_header('Sec-GPC') === '1') {
            return new WP_Error('kodety_meta_capi_privacy', 'Preferência de privacidade respeitada.', ['status' => 204]);
        }
        if (class_exists('Kodety_Analytics') && Kodety_Analytics::consent_manager_enabled()) {
            $consent = isset($_COOKIE['kodety_consent_marketing'])
                ? sanitize_key(wp_unslash((string) $_COOKIE['kodety_consent_marketing']))
                : '';
            if (!hash_equals('granted', $consent)) {
                return new WP_Error('kodety_meta_capi_privacy', 'Consentimento para Marketing não concedido.', ['status' => 204]);
            }
        }
        $origin = trim($request->get_header('Origin'));
        $referer = trim($request->get_header('Referer'));
        $candidate = $origin !== '' && strtolower($origin) !== 'null' ? $origin : $referer;
        if ($candidate !== '') {
            $request_host = strtolower((string) wp_parse_url($candidate, PHP_URL_HOST));
            $home_host = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
            if ($request_host === '' || $home_host === '' || !hash_equals($home_host, $request_host)) {
                return new WP_Error('kodety_meta_capi_origin', 'Origem não autorizada.', ['status' => 403]);
            }
        }
        $fingerprint = hash_hmac('sha256', $this->request_ip(), wp_salt('nonce'));
        $key = 'kodety_mcapi_rate_' . substr($fingerprint, 0, 32);
        $rate = get_transient($key);
        $rate = is_array($rate) ? $rate : ['count' => 0, 'started' => time()];
        if (absint($rate['started'] ?? 0) < time() - MINUTE_IN_SECONDS) $rate = ['count' => 0, 'started' => time()];
        if (absint($rate['count'] ?? 0) >= self::PUBLIC_RATE_LIMIT) {
            return new WP_Error('kodety_meta_capi_rate', 'Limite temporário excedido.', ['status' => 429]);
        }
        $rate['count'] = absint($rate['count'] ?? 0) + 1;
        set_transient($key, $rate, 2 * MINUTE_IN_SECONDS);
        return true;
    }

    private function request_ip(): string {
        $value = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
        return filter_var($value, FILTER_VALIDATE_IP) ? $value : '';
    }

    /** @return array<string,mixed> */
    private function settings(): array {
        $stored = get_option(self::OPTION, []);
        if (!is_array($stored)) $stored = [];
        return array_merge([
            'enabled' => false,
            'pixel_id' => '',
            'access_token' => '',
            'graph_version' => self::DEFAULT_GRAPH_VERSION,
            'test_event_code' => '',
            'data_processing_options' => [],
            'data_processing_country' => 0,
            'data_processing_state' => 0,
            'last_result' => null,
        ], $stored);
    }

    /** @return array<string,mixed> */
    private function public_settings(?array $settings = null): array {
        $settings ??= $this->settings();
        $queue = get_option(self::QUEUE_OPTION, []);
        $licensed = $this->licensed();
        return [
            'enabled' => $licensed && !empty($settings['enabled']),
            'configured' => (string) $settings['access_token'] !== '',
            'pixelId' => (string) $settings['pixel_id'],
            'graphVersion' => (string) $settings['graph_version'],
            'testEventCode' => (string) $settings['test_event_code'],
            'limitedDataUse' => in_array('LDU', (array) $settings['data_processing_options'], true),
            'dataProcessingCountry' => absint($settings['data_processing_country']),
            'dataProcessingState' => absint($settings['data_processing_state']),
            'lastResult' => $licensed && is_array($settings['last_result']) ? $settings['last_result'] : null,
            'queuedEvents' => $licensed && is_array($queue) ? count($queue) : 0,
        ];
    }

    private function record_result(bool $success, string $message, string $request_id, int $status, int $events = 0): void {
        $settings = $this->settings();
        $settings['last_result'] = [
            'success' => $success,
            'message' => substr(sanitize_text_field($message), 0, 500),
            'requestId' => substr(sanitize_text_field($request_id), 0, 191),
            'httpStatus' => $status,
            'eventsReceived' => $events,
            'at' => gmdate('c'),
        ];
        update_option(self::OPTION, $settings, false);
    }

    private function encrypt(string $plain): string|WP_Error {
        if ($plain === '') return '';
        if (!function_exists('openssl_encrypt')) {
            return new WP_Error('kodety_meta_capi_crypto', 'OpenSSL é necessário para proteger o token.', ['status' => 503]);
        }
        try {
            $iv = random_bytes(12);
        } catch (Throwable) {
            return new WP_Error('kodety_meta_capi_crypto', 'Não foi possível proteger o token.', ['status' => 503]);
        }
        $tag = '';
        $key = hash('sha256', wp_salt('auth') . '|kodety-meta-capi', true);
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'kodety-meta-capi-v1');
        if ($cipher === false) return new WP_Error('kodety_meta_capi_crypto', 'Não foi possível proteger o token.', ['status' => 503]);
        return 'v1:' . base64_encode($iv . $tag . $cipher);
    }

    private function decrypt(string $stored): string|WP_Error {
        if ($stored === '') return '';
        if (!str_starts_with($stored, 'v1:') || !function_exists('openssl_decrypt')) {
            return new WP_Error('kodety_meta_capi_crypto', 'O token salvo não pôde ser lido.', ['status' => 503]);
        }
        $raw = base64_decode(substr($stored, 3), true);
        if (!is_string($raw) || strlen($raw) < 29) {
            return new WP_Error('kodety_meta_capi_crypto', 'O token salvo está corrompido.', ['status' => 503]);
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $cipher = substr($raw, 28);
        $key = hash('sha256', wp_salt('auth') . '|kodety-meta-capi', true);
        $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'kodety-meta-capi-v1');
        return is_string($plain)
            ? $plain
            : new WP_Error('kodety_meta_capi_crypto', 'O token salvo não pôde ser lido.', ['status' => 503]);
    }

    private function response(mixed $data, int $status = 200): WP_REST_Response {
        $response = new WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        return $response;
    }
}
