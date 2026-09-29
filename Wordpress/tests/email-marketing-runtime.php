<?php
/**
 * Regressões isoladas do núcleo de Email Marketing.
 *
 * Execute com: php Wordpress/tests/email-marketing-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message = '',
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

$kodety_email_runtime_options = [
    'kodety_email_marketing_settings' => [
        'transport' => 'smtp',
        'from_name' => 'Equipe Kodety',
        'from_email' => 'news@example.test',
        'reply_to' => 'respostas@example.test',
        'smtp_host' => 'smtp.example.test',
        'smtp_port' => 587,
        'smtp_secure' => 'tls',
        'smtp_username' => 'mailer',
        'smtp_password' => 'smtp-secret',
        'dkim_domain' => 'example.test',
        'dkim_selector' => 'kodety',
        'dkim_private_key' => 'dkim-secret',
        'bounce_password' => 'bounce-secret',
        'bounce_webhook_secret' => 'bounce-webhook-secret-value',
        'track_opens' => false,
        'track_clicks' => false,
    ],
    'blogname' => 'Kodety Teste',
    'admin_email' => 'admin@example.test',
];
$kodety_email_runtime_transients = [];

function get_option(string $key, mixed $default = false): mixed {
    global $kodety_email_runtime_options;
    return $kodety_email_runtime_options[$key] ?? $default;
}

function update_option(string $key, mixed $value, bool $autoload = false): bool {
    global $kodety_email_runtime_options;
    if (array_key_exists($key, $kodety_email_runtime_options) && $kodety_email_runtime_options[$key] === $value) {
        return false;
    }
    $kodety_email_runtime_options[$key] = $value;
    return true;
}

function is_wp_error(mixed $value): bool {
    return $value instanceof WP_Error;
}

function get_transient(string $key): mixed {
    global $kodety_email_runtime_transients;
    return $kodety_email_runtime_transients[$key] ?? false;
}

function set_transient(string $key, mixed $value, int $expiration): bool {
    global $kodety_email_runtime_transients;
    $kodety_email_runtime_transients[$key] = $value;
    return true;
}

function delete_transient(string $key): bool {
    global $kodety_email_runtime_transients;
    unset($kodety_email_runtime_transients[$key]);
    return true;
}

function home_url(string $path = ''): string {
    return 'https://example.test' . ($path === '' ? '' : '/' . ltrim($path, '/'));
}

function wp_parse_url(string $url, int $component = -1): mixed {
    return parse_url($url, $component);
}

function wp_json_encode(mixed $value): string|false {
    return json_encode($value);
}

function wp_salt(string $scheme = 'auth'): string {
    return 'test-salt-' . $scheme;
}

function current_time(string $type, bool $gmt = false): string {
    return '2026-07-26 12:00:00';
}

function sanitize_key(string $value): string {
    return strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', $value));
}

function sanitize_text_field(string $value): string {
    return trim(strip_tags($value));
}

function sanitize_email(string $value): string {
    return filter_var(trim($value), FILTER_VALIDATE_EMAIL) ? strtolower(trim($value)) : '';
}

function is_email(string $value): bool {
    return filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
}

function get_bloginfo(string $key): string {
    return $key === 'name' ? 'Kodety Teste' : '';
}

function esc_url(string $value): string {
    return $value;
}

function esc_html(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function wp_strip_all_tags(string $value): string {
    return strip_tags($value);
}

function remove_accents(string $value): string {
    return strtr($value, ['á' => 'a', 'ã' => 'a', 'ç' => 'c', 'é' => 'e']);
}

function add_query_arg(string $key, string $value, string $url = ''): string {
    return $url . (str_contains($url, '?') ? '&' : '?') . rawurlencode($key) . '=' . rawurlencode($value);
}

function size_format(int $bytes): string {
    return $bytes . ' B';
}

function absint(mixed $value): int {
    return abs((int) $value);
}

function get_current_user_id(): int {
    return 99;
}

final class KodetyEmailRuntimeWpdb {
    public string $prefix = 'wp_';
    public int $insert_id = 0;
    public int $rows_affected = 0;
    public string $last_error = '';
    public mixed $next_retry_seconds = null;
    public string $campaign_status = 'sending';
    public int $queue_sent_update_failures = 0;
    /** @var array<string,array> */
    public array $tables = [];

    public function prepare(string $query, mixed ...$args): array {
        return ['query' => $query, 'args' => $args];
    }

    public function get_row(array $prepared, string $format): ?array {
        $query = $prepared['query'];
        $value = $prepared['args'][0] ?? null;
        if (str_contains($query, 'kodety_email_contacts')) {
            foreach ($this->tables['wp_kodety_email_contacts'] ?? [] as $row) {
                if (
                    (str_contains($query, 'email_hash') && $row['email_hash'] === $value)
                    || (str_contains($query, 'WHERE id') && (int) $row['id'] === (int) $value)
                ) {
                    return $row;
                }
            }
        }
        if (str_contains($query, 'kodety_email_suppressions')) {
            return $this->tables['wp_kodety_email_suppressions'][(string) $value] ?? null;
        }
        if (str_contains($query, 'kodety_email_campaigns')) {
            foreach ($this->tables['wp_kodety_email_campaigns'] ?? [] as $row) {
                if ((int) ($row['id'] ?? 0) === (int) $value) return $row;
            }
        }
        if (str_contains($query, 'kodety_email_queue')) {
            $campaign_id = (int) ($prepared['args'][1] ?? 0);
            foreach ($this->tables['wp_kodety_email_queue'] ?? [] as $row) {
                if (
                    (int) ($row['id'] ?? 0) === (int) $value
                    && (int) ($row['campaign_id'] ?? 0) === $campaign_id
                ) return $row;
            }
        }
        return null;
    }

    public function get_var(mixed $query): mixed {
        if (is_array($query)) {
            $sql = (string) ($query['query'] ?? '');
            if (str_contains($sql, 'GET_LOCK(') || str_contains($sql, 'RELEASE_LOCK(')) {
                return 1;
            }
            if (str_contains($sql, 'SELECT status FROM')) {
                return $this->campaign_status;
            }
            if (str_contains($sql, 'SELECT COUNT(*)') && str_contains($sql, 'kodety_email_events')) {
                $args = $query['args'] ?? [];
                $matches = 0;
                foreach ($this->tables['wp_kodety_email_events'] ?? [] as $row) {
                    if (
                        (int) ($row['campaign_id'] ?? 0) !== (int) ($args[0] ?? 0)
                        || (int) ($row['contact_id'] ?? 0) !== (int) ($args[1] ?? 0)
                        || (string) ($row['type'] ?? '') !== (string) ($args[2] ?? '')
                    ) {
                        continue;
                    }
                    if (
                        str_contains($sql, 'url = %s')
                        && (string) ($row['url'] ?? '') !== (string) ($args[3] ?? '')
                    ) {
                        continue;
                    }
                    $matches++;
                }
                return $matches;
            }
        }
        return $this->next_retry_seconds;
    }

    public function query(string|array $statement): int|false {
        $query = is_array($statement)
            ? (string) ($statement['query'] ?? '')
            : $statement;
        if (in_array($query, ['START TRANSACTION', 'COMMIT', 'ROLLBACK'], true)) return 0;
        if (
            is_array($statement)
            && str_contains($query, 'UPDATE wp_kodety_email_campaigns')
            && str_contains($query, 'SET status = %s')
            && preg_match('/status IN \(([^)]+)\)/', $query, $matches)
        ) {
            $args = (array) ($statement['args'] ?? []);
            $from_count = substr_count((string) $matches[1], '%s');
            $id_index = count($args) - $from_count - 1;
            $id = (int) ($args[$id_index] ?? 0);
            $from_statuses = array_map('strval', array_slice($args, -$from_count));
            $table = 'wp_kodety_email_campaigns';
            $row = $this->tables[$table][$id] ?? null;
            if (!is_array($row) || !in_array((string) ($row['status'] ?? ''), $from_statuses, true)) {
                return 0;
            }
            $row['status'] = (string) ($args[0] ?? '');
            if (str_contains($query, 'stats_json = NULL')) $row['stats_json'] = null;
            $this->tables[$table][$id] = $row;
            return 1;
        }
        return 0;
    }

    public function insert(string $table, array $row): int|false {
        $this->rows_affected = 1;
        if (str_ends_with($table, '_contacts')) {
            $row['id'] = ++$this->insert_id;
            $this->tables[$table][$row['id']] = $row;
            return 1;
        }
        if (str_ends_with($table, '_suppressions')) {
            $this->tables[$table][$row['email_hash']] = $row;
            return 1;
        }
        if (str_ends_with($table, '_consent_events')) {
            $row['id'] = count($this->tables[$table] ?? []) + 1;
            $this->tables[$table][] = $row;
            return 1;
        }
        $this->tables[$table][] = $row;
        return 1;
    }

    public function update(string $table, array $changes, array $where): int|false {
        $this->rows_affected = 0;
        if (
            str_ends_with($table, '_queue')
            && ($changes['status'] ?? '') === 'sent'
            && $this->queue_sent_update_failures > 0
        ) {
            $this->queue_sent_update_failures--;
            $this->last_error = 'simulated post-transport ACK failure';
            return false;
        }
        foreach ($this->tables[$table] ?? [] as $key => $row) {
            $matches = true;
            foreach ($where as $field => $value) {
                if (($row[$field] ?? null) != $value) $matches = false;
            }
            if (!$matches) continue;
            $this->tables[$table][$key] = array_merge($row, $changes);
            $this->rows_affected++;
        }
        return $this->rows_affected;
    }

    public function delete(string $table, array $where): int|false {
        $this->rows_affected = 0;
        foreach ($this->tables[$table] ?? [] as $key => $row) {
            $matches = true;
            foreach ($where as $field => $value) {
                if (($row[$field] ?? null) != $value) $matches = false;
            }
            if (!$matches) continue;
            unset($this->tables[$table][$key]);
            $this->rows_affected++;
        }
        return $this->rows_affected;
    }
}

$wpdb = new KodetyEmailRuntimeWpdb();

require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-schema.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-settings.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-health.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-contacts.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-tracking.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-renderer.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-transport.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-campaigns.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-queue.php';

function kodety_email_runtime_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$default_pending_id = Kodety_Email_Contacts::upsert([
    'email' => 'sem-prova@example.test',
    'consent_source' => 'manual',
]);
kodety_email_runtime_assert(
    Kodety_Email_Contacts::get($default_pending_id)['status'] === 'pending',
    'upsert sem prova explícita nunca deve assumir subscribed'
);

$pending_id = Kodety_Email_Contacts::upsert([
    'email' => 'sync@example.test',
    'name' => 'Contato sincronizado',
    'status' => 'pending',
    'consent_source' => 'forms',
]);
kodety_email_runtime_assert(
    $pending_id > 0 && Kodety_Email_Contacts::get($pending_id)['status'] === 'pending',
    'sync sem prova de consentimento deve criar contato pending'
);
kodety_email_runtime_assert(
    Kodety_Email_Contacts::resubscribe($pending_id, 'admin_explicit') === true,
    'reinscrição explícita deve ativar contato pending'
);
kodety_email_runtime_assert(
    Kodety_Email_Contacts::unsubscribe($pending_id, 41, 'unsubscribe_link') === true
        && Kodety_Email_Contacts::suppression('sync@example.test')['reason'] === 'unsubscribe',
    'descadastro deve persistir suppression fora da linha do contato'
);

Kodety_Email_Contacts::upsert([
    'email' => 'sync@example.test',
    'status' => 'subscribed',
    'consent_source' => 'forms',
]);
kodety_email_runtime_assert(
    Kodety_Email_Contacts::get($pending_id)['status'] === 'unsubscribed',
    'upsert/sync não pode ressuscitar opt-out'
);
kodety_email_runtime_assert(
    Kodety_Email_Contacts::resubscribe($pending_id, 'admin_explicit') === true
        && !Kodety_Email_Contacts::is_suppressed('sync@example.test'),
    'reinscrição explícita auditável deve remover somente suppression de unsubscribe'
);

Kodety_Email_Contacts::suppress('sync@example.test', 'bounce', 41, '550 5.1.1');
kodety_email_runtime_assert(
    Kodety_Email_Contacts::get($pending_id)['status'] === 'bounced'
        && Kodety_Email_Contacts::resubscribe($pending_id, 'admin_explicit') === false,
    'reinscrição comum não pode apagar bounce'
);
kodety_email_runtime_assert(
    count($wpdb->tables['wp_kodety_email_consent_events'] ?? []) >= 5,
    'transições de consentimento devem deixar trilha auditável'
);

$replay_contact_id = Kodety_Email_Contacts::upsert([
    'email' => 'replay@example.test',
    'status' => 'subscribed',
    'consent_source' => 'confirmed_test',
]);
$consent_events_before_replay = count($wpdb->tables['wp_kodety_email_consent_events'] ?? []);
kodety_email_runtime_assert(
    Kodety_Email_Contacts::unsubscribe($replay_contact_id, 42, 'list_unsubscribe_post') === true
        && Kodety_Email_Contacts::unsubscribe($replay_contact_id, 42, 'list_unsubscribe_post') === true,
    'replay de unsubscribe válido deve responder como operação idempotente'
);
kodety_email_runtime_assert(
    count($wpdb->tables['wp_kodety_email_consent_events'] ?? []) === $consent_events_before_replay + 1,
    'replay de unsubscribe não pode duplicar a auditoria de consentimento'
);

$invalid_import = Kodety_Email_Contacts::import_csv(
    "email,nome\nnao-e-email,Inválido\n",
    0,
    'import',
    false
);
kodety_email_runtime_assert(
    $invalid_import['invalid'] === 1
        && $invalid_import['failed'] === 0
        && $invalid_import['imported'] === 0,
    'relatório do CSV deve separar linhas inválidas de checkpoints que falharam no banco'
);

$count_list_references = new ReflectionMethod(Kodety_Email_Contacts::class, 'count_list_references');
$count_list_references->setAccessible(true);
$reference_fixture = [
    ['audience_json' => '{"list_ids":[1,10]}'],
    ['audience_json' => '{"list_ids":[10]}'],
    ['audience_json' => '{"list_ids":["10","10"]}'],
    ['audience_json' => '{"list_ids":[100]}'],
    ['audience_json' => '{invalido'],
];
kodety_email_runtime_assert(
    $count_list_references->invoke(null, $reference_fixture, 1) === 1
        && $count_list_references->invoke(null, $reference_fixture, 10) === 3,
    'referência de lista deve comparar ids exatos, ignorar duplicatas e tolerar JSON legado inválido'
);

$snapshot = Kodety_Email_Settings::campaign_snapshot();
kodety_email_runtime_assert(!array_key_exists('smtp_password', $snapshot), 'snapshot não pode copiar senha SMTP');
kodety_email_runtime_assert(!array_key_exists('dkim_private_key', $snapshot), 'snapshot não pode copiar chave DKIM');
kodety_email_runtime_assert(!array_key_exists('bounce_password', $snapshot), 'snapshot não pode copiar senha de bounce');
kodety_email_runtime_assert(
    !empty($snapshot['delivery_fingerprint']) && !empty($snapshot['dkim_key_fingerprint']),
    'snapshot deve registrar fingerprints não reversíveis'
);
$stored_email_settings = $kodety_email_runtime_options['kodety_email_marketing_settings'];
$expected_email_secrets = [
    'smtp_password' => 'smtp-secret',
    'dkim_private_key' => 'dkim-secret',
    'bounce_password' => 'bounce-secret',
    'bounce_webhook_secret' => 'bounce-webhook-secret-value',
];
foreach ($expected_email_secrets as $key => $plain) {
    $stored = (string) ($stored_email_settings[$key] ?? '');
    kodety_email_runtime_assert(
        str_starts_with($stored, 'enc:v1:') && !str_contains($stored, $plain),
        'segredo ' . $key . ' deve migrar do texto puro para ciphertext autenticado'
    );
    kodety_email_runtime_assert(
        Kodety_Email_Settings::get($key) === $plain,
        'segredo ' . $key . ' deve ser descriptografado de forma transparente'
    );
}
$display_settings = Kodety_Email_Settings::for_display();
foreach (array_keys($expected_email_secrets) as $key) {
    kodety_email_runtime_assert(
        !array_key_exists($key, $display_settings) && !empty($display_settings[$key . '_configured']),
        'UI deve receber apenas o indicador configurado de ' . $key
    );
}
$protected_email_settings = $kodety_email_runtime_options['kodety_email_marketing_settings'];
$kodety_email_runtime_options['kodety_email_marketing_settings']['smtp_password'] = 'enc:v1:not-valid-base64';
kodety_email_runtime_assert(
    Kodety_Email_Settings::get('smtp_password') === '',
    'ciphertext corrompido deve falhar fechado e nunca chegar ao transporte'
);
$kodety_email_runtime_options['kodety_email_marketing_settings'] = $protected_email_settings;

$empty_secret_settings = Kodety_Email_Settings::sanitize(array_merge(
    Kodety_Email_Settings::all(),
    array_fill_keys(Kodety_Email_Settings::SECRET_KEYS, '')
));
$kodety_email_runtime_options['kodety_email_marketing_settings'] = $empty_secret_settings;
$idempotent_settings = Kodety_Email_Settings::update([]);
kodety_email_runtime_assert(
    is_array($idempotent_settings),
    'save idempotente deve ser sucesso mesmo quando update_option retorna false por valor idêntico'
);
$kodety_email_runtime_options['kodety_email_marketing_settings'] = $protected_email_settings;
$realigned_settings = Kodety_Email_Settings::sanitize(array_merge(
    Kodety_Email_Settings::all(),
    [
        'from_email' => 'news@novo.example.test',
        'dkim_domain' => 'dominio-antigo.example.test',
    ]
));
kodety_email_runtime_assert(
    $realigned_settings['dkim_domain'] === 'novo.example.test'
        && Kodety_Email_Settings::sender_domain_for($realigned_settings) === 'novo.example.test',
    'trocar o From deve realinhar o domínio DKIM usado por Saúde e transporte'
);
Kodety_Email_Settings::update([
    'emails_per_minute' => 7,
    'emails_per_hour' => 70,
    'batch_size' => 3,
]);

$disabled = Kodety_Email_Settings::apply_form([]);
kodety_email_runtime_assert(
    $disabled['track_opens'] === false
        && $disabled['track_clicks'] === false
        && $disabled['bounce_enabled'] === false,
    'checkboxes ausentes no formulário devem desligar opções booleanas'
);
$enabled = Kodety_Email_Settings::apply_form([
    'track_opens' => '1',
    'track_clicks' => '1',
    'bounce_enabled' => '1',
]);
kodety_email_runtime_assert(
    $enabled['track_opens'] === true
        && $enabled['track_clicks'] === true
        && $enabled['bounce_enabled'] === true,
    'checkboxes marcados devem voltar a ligar opções booleanas'
);

$campaign = [
    'id' => 41,
    'subject' => 'Olá {{contact.first_name}}',
    'preheader' => 'Olá & {{contact.name}}',
    'html' => '<a href="{{view_in_browser_url}}">Ver no navegador</a> <a href="{{unsubscribe_url}}">Sair</a>',
    'text_body' => '',
    'from_name' => 'Remetente congelado',
    'from_email' => 'frozen@example.test',
    'reply_to' => 'reply@example.test',
    'delivery_config' => wp_json_encode($snapshot),
];
$effective = Kodety_Email_Settings::for_campaign($campaign);
kodety_email_runtime_assert($effective['from_email'] === 'frozen@example.test', 'remetente da campanha deve permanecer congelado');
kodety_email_runtime_assert(
    $effective['track_opens'] === false && $effective['track_clicks'] === false,
    'tracking da campanha deve permanecer congelado no snapshot'
);
kodety_email_runtime_assert(
    $effective['emails_per_minute'] === 7
        && $effective['emails_per_hour'] === 70
        && $effective['batch_size'] === 3,
    'throttle e lote devem respeitar imediatamente os limites globais atuais'
);

$health_settings = Kodety_Email_Settings::all();
Kodety_Email_Health::record_delivery_test(true, 'destino@example.test', $health_settings);
$delivery_test_check = new ReflectionMethod(Kodety_Email_Health::class, 'check_delivery_test');
$delivery_test_check->setAccessible(true);
$test_check = $delivery_test_check->invoke(null, $health_settings);
kodety_email_runtime_assert(
    $test_check['status'] === Kodety_Email_Health::STATUS_OK,
    'teste aceito deve valer somente para o fingerprint exato da configuração usada'
);
$changed_health_settings = array_merge($health_settings, ['smtp_host' => 'smtp-novo.example.test']);
$stale_test_check = $delivery_test_check->invoke(null, $changed_health_settings);
kodety_email_runtime_assert(
    $stale_test_check['status'] === Kodety_Email_Health::STATUS_WARN,
    'alterar transporte deve invalidar o teste de entrega anterior'
);
Kodety_Email_Health::record_delivery_test(false, 'destino@example.test', $health_settings, 'Falha SMTP');
$failed_test_check = $delivery_test_check->invoke(null, $health_settings);
kodety_email_runtime_assert(
    $failed_test_check['status'] === Kodety_Email_Health::STATUS_FAIL,
    'falha nova da mesma configuração deve invalidar sucesso anterior'
);

$health_ready = new ReflectionMethod(Kodety_Email_Health::class, 'is_ready');
$health_ready->setAccessible(true);
$alternate_sender_checks = [
    ['id' => 'sender', 'status' => Kodety_Email_Health::STATUS_WARN],
    ['id' => 'spf', 'status' => Kodety_Email_Health::STATUS_WARN],
    ['id' => 'dkim', 'status' => Kodety_Email_Health::STATUS_OK],
    ['id' => 'port', 'status' => Kodety_Email_Health::STATUS_WARN],
    ['id' => 'test', 'status' => Kodety_Email_Health::STATUS_OK],
];
kodety_email_runtime_assert(
    $health_ready->invoke(null, $alternate_sender_checks) === true,
    'diagnósticos de saúde não devem bloquear uma tentativa manual'
);
$alternate_sender_checks[0]['status'] = Kodety_Email_Health::STATUS_FAIL;
kodety_email_runtime_assert(
    $health_ready->invoke(null, $alternate_sender_checks) === true,
    'até um diagnóstico pendente deve permitir que o transporte real tente enviar'
);

$health_optimized = new ReflectionMethod(Kodety_Email_Health::class, 'is_optimized');
$health_optimized->setAccessible(true);
kodety_email_runtime_assert(
    $health_optimized->invoke(null, $alternate_sender_checks) === false,
    'pendências devem continuar aparecendo como recomendações de entregabilidade'
);

$rendered = Kodety_Email_Renderer::render($campaign, [
    'id' => 7,
    'email' => 'pessoa@example.test',
    'name' => 'Pessoa Teste',
    'attributes' => '{}',
], $effective);
kodety_email_runtime_assert(
    str_contains($rendered['html'], '/kodety-email/v/41-7-'),
    'token view_in_browser_url deve apontar para endpoint assinado real'
);
kodety_email_runtime_assert(
    str_contains($rendered['html'], '/kodety-email/u/41-7-'),
    'descadastro deve continuar apontando para endpoint assinado'
);
kodety_email_runtime_assert(
    str_contains($rendered['html'], 'Olá &amp; Pessoa Teste')
        && !str_contains($rendered['html'], 'Olá &amp;amp; Pessoa Teste'),
    'preheader deve ser escapado exatamente uma vez'
);

$test_render = Kodety_Email_Renderer::render($campaign, [
    'id' => 0,
    'email' => 'teste@example.test',
    'name' => 'Teste',
    'attributes' => '{}',
], array_merge($effective, ['track_opens' => true, 'track_clicks' => true]), true);
kodety_email_runtime_assert(
    str_contains($test_render['html'], '#kodety-test-unsubscribe')
        && str_contains($test_render['html'], '#kodety-test-view-in-browser')
        && !str_contains($test_render['html'], '/kodety-email/'),
    'render de teste deve usar links não acionáveis e não gerar tracking para contact id 0'
);
kodety_email_runtime_assert(
    str_contains(
        Kodety_Email_Renderer::html_to_text('<p>Leia <a href="https://example.test/post">a matéria</a>.</p>'),
        'a matéria (https://example.test/post)'
    ),
    'versão texto deve preservar o destino dos links depois de remover HTML'
);

$missing_unsubscribe = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<p>{{unsubscribe_url}}</p>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($missing_unsubscribe),
    'token de descadastro solto no texto não deve liberar o envio'
);

$hidden_unsubscribe = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<div style="display:none"><a href="{{unsubscribe_url}}">Sair</a></div>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($hidden_unsubscribe),
    'link de descadastro dentro de ancestral oculto não deve liberar o envio'
);

$css_hidden_unsubscribe = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<style>.legal-hide{visibility:hidden}</style><a class="legal-hide" href="{{unsubscribe_url}}">Sair</a>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($css_hidden_unsubscribe),
    'link de descadastro oculto por regra CSS não deve liberar o envio'
);

$hidden_label_unsubscribe = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<a href="{{unsubscribe_url}}"><span hidden>Sair</span></a>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($hidden_label_unsubscribe),
    'rótulo oculto dentro de link vazio não deve contar como descadastro visível'
);

$commented_unsubscribe = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<!-- <a href="{{unsubscribe_url}}">Sair</a> --><p>Conteúdo</p>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($commented_unsubscribe),
    'link de descadastro em comentário HTML não deve liberar o envio'
);

$active_html = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<a href="{{unsubscribe_url}}">Sair</a><img src="https://example.test/a.png" onerror="alert(1)">',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($active_html),
    'event handlers devem bloquear o envio no servidor'
);

$unsafe_url = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<a href="{{unsubscribe_url}}">Sair</a><a href="java&#x73;cript:alert(1)">Abrir</a>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($unsafe_url),
    'protocolos ofuscados inseguros devem bloquear o envio no servidor'
);

$unknown_markup = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<a href="{{unsubscribe_url}}">Sair</a><custom-widget>Ativo</custom-widget>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($unknown_markup),
    'tags desconhecidas para clientes de email devem bloquear o envio'
);

$invalid_image = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<a href="{{unsubscribe_url}}">Sair</a><img src=../foto.png alt=imagem>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($invalid_image),
    'src relativo sem aspas e alt provisório devem bloquear o envio'
);

$unknown_merge_link = Kodety_Email_Renderer::lint([
    'subject' => 'Assunto',
    'html' => '<a href="{{unsubscribe_url}}">Sair</a><a href="{{unknown.url}}">Abrir</a>',
]);
kodety_email_runtime_assert(
    Kodety_Email_Renderer::has_blocking_issue($unknown_merge_link),
    'merge tag desconhecida em href não pode virar link vazio no envio'
);

$template_revision_fixture = [
    'id' => 9,
    'updated_at' => '2026-07-26 10:00:00',
    'name' => 'Newsletter',
    'project_json' => '{"version":2}',
    'html' => '<p>Versão A</p>',
    'text_body' => 'Versão A',
];
$template_revision_a = Kodety_Email_Campaigns::template_revision($template_revision_fixture);
$template_revision_fixture['html'] = '<p>Versão B</p>';
kodety_email_runtime_assert(
    !hash_equals($template_revision_a, Kodety_Email_Campaigns::template_revision($template_revision_fixture)),
    'revisão do template deve mudar mesmo quando duas edições ocorrem no mesmo segundo'
);

$campaign_revision_fixture = [
    'id' => 11,
    'updated_at' => '2026-07-26 10:00:00',
    'status' => 'draft',
    'name' => 'Campanha',
    'subject' => 'Assunto A',
    'preheader' => '',
    'template_id' => 9,
    'audience_json' => '{"list_ids":[3]}',
    'html' => '<p>Versão A</p>',
    'text_body' => 'Versão A',
];
$campaign_revision_a = Kodety_Email_Campaigns::campaign_revision($campaign_revision_fixture);
$campaign_revision_fixture['audience_json'] = '{"list_ids":[3,4]}';
kodety_email_runtime_assert(
    !hash_equals($campaign_revision_a, Kodety_Email_Campaigns::campaign_revision($campaign_revision_fixture)),
    'revisão da campanha deve mudar com a audiência mesmo no mesmo segundo'
);
$campaign_revision_fixture['audience_json'] = '{"list_ids":[3]}';
$campaign_revision_fixture['html'] = '<p>Template alterado</p>';
kodety_email_runtime_assert(
    !hash_equals($campaign_revision_a, Kodety_Email_Campaigns::campaign_revision($campaign_revision_fixture)),
    'revisão da campanha deve incluir o conteúdo atual do template'
);

$manual_only_fixture = [
    'id' => 91,
    'updated_at' => '2026-07-26 10:00:00',
    'status' => 'draft',
    'scheduled_at' => null,
    'name' => 'Somente manual',
    'subject' => 'Assunto',
    'preheader' => '',
    'template_id' => 0,
    'audience_json' => '{"list_ids":[3]}',
    'html' => '<a href="{{unsubscribe_url}}">Sair</a>',
    'text_body' => 'Sair',
];
$wpdb->tables['wp_kodety_email_campaigns'][91] = $manual_only_fixture;
Kodety_Email_Campaigns::update(91, [
    'status' => 'scheduled',
    'scheduled_at' => '2026-07-27 15:00:00',
]);
kodety_email_runtime_assert(
    $wpdb->tables['wp_kodety_email_campaigns'][91]['status'] === 'draft'
        && $wpdb->tables['wp_kodety_email_campaigns'][91]['scheduled_at'] === null,
    'update público não pode criar estado ou horário scheduled'
);
kodety_email_runtime_assert(
    Kodety_Email_Campaigns::compare_and_swap_status(91, ['draft'], 'scheduled', [
        'scheduled_at' => '2026-07-27 15:00:00',
    ]) === false,
    'compare-and-swap público não pode ter scheduled como destino'
);

$wpdb->tables['wp_kodety_email_campaigns'][91]['status'] = 'scheduled';
$wpdb->tables['wp_kodety_email_campaigns'][91]['scheduled_at'] = '2026-07-27 15:00:00';
$legacy_scheduled_fixture = $wpdb->tables['wp_kodety_email_campaigns'][91];
$legacy_send = Kodety_Email_Campaigns::send(
    91,
    Kodety_Email_Campaigns::campaign_revision($legacy_scheduled_fixture),
    1,
    'assinatura-inutilizada'
);
kodety_email_runtime_assert(
    $legacy_send['ok'] === false
        && str_contains((string) $legacy_send['error'], 'versão antiga'),
    'send público não pode iniciar uma linha scheduled nem após o horário legado'
);

$transport = Kodety_Email_Transport::instance();
$classify = new ReflectionMethod(Kodety_Email_Transport::class, 'classify');
$classify->setAccessible(true);

kodety_email_runtime_assert(
    Kodety_Email_Transport::is_public_ip('1.1.1.1')
        && Kodety_Email_Transport::is_public_ip('2001:4860:4860::8888'),
    'validador MX deve aceitar literais públicos IPv4 e IPv6'
);
foreach ([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.10.2',
    '192.0.2.10',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
] as $non_public_ip) {
    kodety_email_runtime_assert(
        !Kodety_Email_Transport::is_public_ip($non_public_ip),
        "MX não pode conectar no endereço não público {$non_public_ip}"
    );
}

$unknown_mailbox = $classify->invoke($transport, 'SMTP 550 5.1.1 User unknown');
kodety_email_runtime_assert(
    $unknown_mailbox['permanent'] === true && $unknown_mailbox['suppress'] === true,
    '5.1.1 deve ser hard bounce suprimível'
);

$policy = $classify->invoke($transport, 'SMTP 550 5.7.1 Message rejected by policy');
kodety_email_runtime_assert(
    $policy['permanent'] === true && $policy['suppress'] === false,
    '5.7.1 deve falhar a mensagem sem suprimir o destinatário'
);

$ambiguous_550 = $classify->invoke($transport, 'SMTP 550 Message rejected');
kodety_email_runtime_assert(
    $ambiguous_550['permanent'] === false && $ambiguous_550['suppress'] === false,
    '5xx sem enhanced status deve retentar e jamais suprimir globalmente'
);

$temporary = $classify->invoke($transport, 'SMTP 421 4.4.2 Connection dropped');
kodety_email_runtime_assert(
    $temporary['permanent'] === false && $temporary['suppress'] === false,
    '4xx deve permanecer temporário'
);

$one_click_check = new ReflectionMethod(Kodety_Email_Tracking::class, 'is_rfc8058_one_click');
$one_click_check->setAccessible(true);
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = ['List-Unsubscribe' => 'One-Click'];
kodety_email_runtime_assert(
    $one_click_check->invoke(null) === true,
    'POST RFC 8058 exato deve autorizar descadastro automático'
);
$_POST = ['List-Unsubscribe' => 'qualquer-coisa'];
kodety_email_runtime_assert(
    $one_click_check->invoke(null) === false,
    'POST genérico não pode ser interpretado como List-Unsubscribe one-click'
);
$_SERVER['REQUEST_METHOD'] = 'GET';
$_POST = ['List-Unsubscribe' => 'One-Click'];
kodety_email_runtime_assert(
    $one_click_check->invoke(null) === false,
    'parâmetro fora de POST nunca deve acionar RFC 8058'
);
$_POST = [];

$tracking_count_before = count($wpdb->tables['wp_kodety_email_events'] ?? []);
kodety_email_runtime_assert(
    Kodety_Email_Tracking::record_unique('complaint', 43, $replay_contact_id) === true
        && Kodety_Email_Tracking::record_unique('complaint', 43, $replay_contact_id) === false,
    'API de evento único deve absorver retries de webhook ou VERP'
);
$windowed_record = new ReflectionMethod(Kodety_Email_Tracking::class, 'record_windowed');
$windowed_record->setAccessible(true);
$windowed_record->invoke(null, 'click', 43, $replay_contact_id, 'https://example.test/oferta', 900);
$windowed_record->invoke(null, 'click', 43, $replay_contact_id, 'https://example.test/oferta', 900);
kodety_email_runtime_assert(
    count($wpdb->tables['wp_kodety_email_events'] ?? []) === $tracking_count_before + 2,
    'replay de click deve gravar no máximo uma linha por URL e janela'
);

kodety_email_runtime_assert(
    Kodety_Email_Queue::terminal_status(['sent' => 2, 'failed' => 1, 'skipped' => 0]) === 'sent',
    'entrega parcial deve concluir como sent e expor falhas em stats_json'
);
kodety_email_runtime_assert(
    Kodety_Email_Queue::terminal_status(['sent' => 0, 'failed' => 2, 'skipped' => 0]) === 'failed',
    'campanha sem nenhuma entrega deve concluir como failed'
);

$queue_table = Kodety_Email_Schema::table('queue');
$wpdb->tables[$queue_table][9001] = [
    'id' => 9001,
    'campaign_id' => 41,
    'contact_id' => $replay_contact_id,
    'email' => 'replay@example.test',
    'status' => 'pending',
    'lock_token' => 'ack-lock',
    'locked_until' => '2099-01-01 00:00:00',
    'message_id' => '',
    'error' => null,
    'sent_at' => null,
];
$persist_transport_ack = new ReflectionMethod(Kodety_Email_Queue::class, 'persist_transport_ack');
$persist_transport_ack->setAccessible(true);
$wpdb->queue_sent_update_failures = 1;
$ack_state = $persist_transport_ack->invoke(null, $wpdb->tables[$queue_table][9001], '<provider-ack@example.test>');
kodety_email_runtime_assert(
    $ack_state === 'delivery_uncertain'
        && ($wpdb->tables[$queue_table][9001]['status'] ?? '') === 'failed'
        && ($wpdb->tables[$queue_table][9001]['message_id'] ?? '') === '<provider-ack@example.test>'
        && ($wpdb->tables[$queue_table][9001]['sent_at'] ?? null) !== null
        && str_contains((string) ($wpdb->tables[$queue_table][9001]['error'] ?? ''), 'provedor aceitou'),
    'falha local depois do ACK do transporte deve virar estado terminal visível e nunca voltar para reenvio'
);

$reconcile_campaign_id = 9041;
$reconcile_queue_id = 9042;
$wpdb->tables[Kodety_Email_Schema::table('campaigns')][$reconcile_campaign_id] = [
    'id' => $reconcile_campaign_id,
    'status' => 'paused',
    'stats_json' => wp_json_encode([
        'pause_reason' => 'transport_ack_persistence_failed',
        'queue_id' => $reconcile_queue_id,
        'provider_message_id' => '<manual-reconcile@example.test>',
        'requires_manual_reconciliation' => true,
    ]),
];
$wpdb->tables[$queue_table][$reconcile_queue_id] = [
    'id' => $reconcile_queue_id,
    'campaign_id' => $reconcile_campaign_id,
    'status' => 'pending',
    'lock_token' => 'stuck-ack-lock',
    'locked_until' => '2099-01-01 00:00:00',
    'message_id' => '',
    'error' => null,
    'sent_at' => null,
];
$reconciled = Kodety_Email_Queue::reconcile_transport_ack_failure(
    $reconcile_campaign_id,
    $reconcile_queue_id
);
$reconciled_again = Kodety_Email_Queue::reconcile_transport_ack_failure(
    $reconcile_campaign_id,
    $reconcile_queue_id
);
kodety_email_runtime_assert(
    $reconciled['ok'] === true
        && $reconciled['already_reconciled'] === false
        && ($wpdb->tables[$queue_table][$reconcile_queue_id]['status'] ?? '') === 'failed'
        && ($wpdb->tables[$queue_table][$reconcile_queue_id]['lock_token'] ?? 'x') === ''
        && str_contains(
            (string) ($wpdb->tables[$queue_table][$reconcile_queue_id]['error'] ?? ''),
            'reenvio automático foi bloqueado'
        )
        && $reconciled_again['ok'] === true
        && $reconciled_again['already_reconciled'] === true,
    'reconciliação explícita deve terminalizar exatamente o ACK ambíguo e ser idempotente antes da retomada'
);

$campaign_reconcile_id = 9051;
$queue_reconcile_id = 9052;
$wpdb->tables[Kodety_Email_Schema::table('campaigns')][$campaign_reconcile_id] = [
    'id' => $campaign_reconcile_id,
    'status' => 'paused',
    'stats_json' => wp_json_encode([
        'pause_reason' => 'transport_ack_persistence_failed',
        'queue_id' => $queue_reconcile_id,
        'provider_message_id' => '<campaign-reconcile@example.test>',
        'requires_manual_reconciliation' => true,
    ]),
    'scheduled_at' => null,
    'updated_at' => '2026-07-26 12:00:00',
    'template_id' => 0,
    'audience_json' => '{"list_ids":[3]}',
    'html' => '<a href="{{unsubscribe_url}}">Sair</a>',
    'text_body' => 'Sair',
];
$wpdb->tables[$queue_table][$queue_reconcile_id] = [
    'id' => $queue_reconcile_id,
    'campaign_id' => $campaign_reconcile_id,
    'status' => 'pending',
    'lock_token' => 'campaign-reconcile-lock',
    'locked_until' => '2099-01-01 00:00:00',
    'message_id' => '',
    'error' => null,
    'sent_at' => null,
];
$unsafe_resume = Kodety_Email_Campaigns::resume($campaign_reconcile_id);
kodety_email_runtime_assert(
    $unsafe_resume['ok'] === false
        && str_contains((string) $unsafe_resume['error'], 'Reconcilie')
        && $wpdb->tables[$queue_table][$queue_reconcile_id]['status'] === 'pending',
    'retomada comum deve permanecer bloqueada enquanto o ACK aceito estiver pendente'
);
$safe_resume = Kodety_Email_Campaigns::reconcile_transport_ack(
    $campaign_reconcile_id,
    $queue_reconcile_id
);
kodety_email_runtime_assert(
    $safe_resume['ok'] === true
        && $wpdb->tables[$queue_table][$queue_reconcile_id]['status'] === 'failed'
        && $wpdb->tables[Kodety_Email_Schema::table('campaigns')][$campaign_reconcile_id]['status'] === 'sending'
        && $wpdb->tables[Kodety_Email_Schema::table('campaigns')][$campaign_reconcile_id]['stats_json'] === null,
    'CTA explícita deve terminalizar primeiro a entrega incerta e só então retomar os destinatários restantes'
);

$retry_after = new ReflectionMethod(Kodety_Email_Queue::class, 'next_retry_after');
$retry_after->setAccessible(true);
$wpdb->next_retry_seconds = 7200;
kodety_email_runtime_assert(
    $retry_after->invoke(null, 41) === 300,
    'backoff distante deve limitar o próximo poll a cinco minutos'
);
$wpdb->next_retry_seconds = -4;
kodety_email_runtime_assert(
    $retry_after->invoke(null, 41) === 2,
    'lock vencido/corrida entre workers deve retentar sem loop apertado'
);

$campaign_is_sending = new ReflectionMethod(Kodety_Email_Queue::class, 'campaign_is_sending');
$campaign_is_sending->setAccessible(true);
$wpdb->campaign_status = 'sending';
kodety_email_runtime_assert(
    $campaign_is_sending->invoke(null, 41) === true,
    'worker deve continuar somente enquanto a campanha ainda está sending'
);
$wpdb->campaign_status = 'paused';
kodety_email_runtime_assert(
    $campaign_is_sending->invoke(null, 41) === false,
    'worker deve observar pausa antes de iniciar o próximo destinatário'
);

echo "Contratos do backend de Email Marketing aprovados.\n";
