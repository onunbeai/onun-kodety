<?php
/**
 * Regressão de escala/idempotência do pipeline CSV.
 *
 * Execute com: php Wordpress/tests/email-marketing-import-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

function current_time(string $type, bool $gmt = false): string {
    return '2026-07-26 12:00:00';
}

function sanitize_key(string $value): string {
    return strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', $value));
}

function sanitize_text_field(string $value): string {
    return trim(strip_tags($value));
}

function sanitize_textarea_field(string $value): string {
    return sanitize_text_field($value);
}

function sanitize_title(string $value): string {
    return sanitize_key(str_replace(' ', '-', $value));
}

function sanitize_email(string $value): string {
    return filter_var(trim($value), FILTER_VALIDATE_EMAIL) ? strtolower(trim($value)) : '';
}

function is_email(string $value): bool {
    return filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
}

function absint(mixed $value): int {
    return abs((int) $value);
}

function wp_json_encode(mixed $value): string|false {
    return json_encode($value);
}

function get_current_user_id(): int {
    return 77;
}

function apply_filters(string $hook, mixed $value): mixed {
    return $value;
}

final class KodetyEmailImportWpdb {
    public string $prefix = 'wp_';
    public int $insert_id = 0;
    public int $rows_affected = 0;
    public string $last_error = '';
    /** @var array<int,mixed> */
    public array $calls = [];
    /** @var array<string,array> */
    public array $contacts = [];
    /** @var array<string,bool> */
    public array $suppressions = [];
    /** @var array<string,bool> */
    public array $memberships = [];
    public int $audit_rows = 0;

    public function prepare(string $query, mixed ...$args): array {
        return ['query' => $query, 'args' => $args];
    }

    public function get_var(mixed $prepared): mixed {
        $this->calls[] = $prepared;
        if (is_array($prepared) && str_contains($prepared['query'], 'kodety_email_lists')) {
            return (int) ($prepared['args'][0] ?? 0);
        }
        return null;
    }

    public function get_results(mixed $prepared, string $format): array {
        $this->calls[] = $prepared;
        if (!is_array($prepared)) return [];

        $query = (string) $prepared['query'];
        $hashes = array_map('strval', (array) $prepared['args']);
        if (str_contains($query, 'kodety_email_suppressions')) {
            return array_values(array_map(
                static fn(string $hash): array => ['email_hash' => $hash],
                array_values(array_filter(
                    $hashes,
                    fn(string $hash): bool => isset($this->suppressions[$hash])
                ))
            ));
        }
        if (str_contains($query, 'kodety_email_contacts')) {
            $rows = [];
            foreach ($hashes as $hash) {
                if (isset($this->contacts[$hash])) $rows[] = $this->contacts[$hash];
            }
            return $rows;
        }
        return [];
    }

    public function query(mixed $prepared): int|false {
        $this->calls[] = $prepared;
        $query = is_array($prepared) ? (string) $prepared['query'] : (string) $prepared;
        $args = is_array($prepared) ? (array) $prepared['args'] : [];

        if (!str_contains($query, 'INSERT')) return 1;

        if (str_contains($query, 'kodety_email_contacts')) {
            $affected = 0;
            foreach (array_chunk($args, 9) as $values) {
                [$email, $hash, $name, $status, $source, $consent_at, $attributes, $created_at, $updated_at] = $values;
                if (isset($this->contacts[$hash])) {
                    $current = $this->contacts[$hash];
                    $current['email'] = $email;
                    $current['name'] = $name;
                    $current['attributes'] = $attributes;
                    $current['updated_at'] = $updated_at;
                    if ($current['status'] === 'pending' && $status === 'subscribed') {
                        $current['status'] = 'subscribed';
                        $current['consent_source'] = $source;
                        $current['consent_at'] = $consent_at;
                    }
                    $this->contacts[$hash] = $current;
                    $affected += 2;
                    continue;
                }
                $this->contacts[$hash] = [
                    'id' => ++$this->insert_id,
                    'email' => $email,
                    'email_hash' => $hash,
                    'name' => $name,
                    'status' => $status,
                    'consent_source' => $source,
                    'consent_at' => $consent_at,
                    'attributes' => $attributes,
                    'created_at' => $created_at,
                    'updated_at' => $updated_at,
                ];
                $affected++;
            }
            $this->rows_affected = $affected;
            return $affected;
        }

        if (str_contains($query, 'kodety_email_list_contacts')) {
            foreach (array_chunk($args, 4) as $values) {
                $this->memberships[(int) $values[0] . ':' . (int) $values[1]] = true;
            }
            $this->rows_affected = count($args) / 4;
            return $this->rows_affected;
        }

        if (str_contains($query, 'kodety_email_consent_events')) {
            $rows = (int) (count($args) / 7);
            $this->audit_rows += $rows;
            $this->rows_affected = $rows;
            return $rows;
        }

        return 1;
    }
}

function kodety_email_import_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$wpdb = new KodetyEmailImportWpdb();

require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-schema.php';
require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-contacts.php';

$suppressed_email = 'pessoa13@example.test';
$wpdb->suppressions[Kodety_Email_Schema::email_hash($suppressed_email)] = true;

$lines = ['email,nome,plano'];
for ($index = 0; $index < 500; $index++) {
    $lines[] = "pessoa{$index}@example.test,Pessoa {$index},pro";
}
$lines[] = 'email-invalido,Inválido,free';
$csv = implode("\n", $lines) . "\n";

$first = Kodety_Email_Contacts::import_csv($csv, 12, 'import', true);
kodety_email_import_assert(
    $first === [
        'imported' => 499,
        'updated' => 0,
        'skipped' => 1,
        'invalid' => 1,
        'failed' => 0,
        'limited' => 0,
    ],
    'primeiro CSV deve separar novos, suprimidos e inválidos sem perder checkpoints'
);
kodety_email_import_assert(
    count($wpdb->calls) <= 18,
    '500 linhas válidas devem usar no máximo nove operações por chunk, não consultas por linha'
);
kodety_email_import_assert(
    count($wpdb->contacts) === 499
        && count($wpdb->memberships) === 499
        && $wpdb->audit_rows === 499,
    'contato, associação e auditoria devem ser confirmados juntos'
);
kodety_email_import_assert(
    count(array_filter(
        $wpdb->contacts,
        static fn(array $contact): bool => $contact['status'] !== 'subscribed'
    )) === 0,
    'consentimento confirmado deve ativar apenas os endereços não suprimidos'
);

$calls_before_reimport = count($wpdb->calls);
$second = Kodety_Email_Contacts::import_csv($csv, 12, 'import', true);
kodety_email_import_assert(
    $second['imported'] === 0
        && $second['updated'] === 499
        && $second['skipped'] === 1
        && $second['failed'] === 0,
    'reimportar o mesmo CSV deve ser idempotente e reportar atualizações'
);
kodety_email_import_assert(
    count($wpdb->calls) - $calls_before_reimport <= 18
        && count($wpdb->contacts) === 499
        && count($wpdb->memberships) === 499
        && $wpdb->audit_rows === 499,
    'reimportação não deve duplicar contatos, vínculos, auditoria nem voltar a N+1'
);

echo "Pipeline CSV de Email Marketing aprovado.\n";
