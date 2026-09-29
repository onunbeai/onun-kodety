<?php
/**
 * Contratos isolados da compatibilidade com agendamentos antigos.
 *
 * Execute com: php Wordpress/tests/email-marketing-scheduler-runtime.php
 */

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

$kodety_email_test_campaign = [
    'id' => 17,
    'status' => 'draft',
    'scheduled_at' => null,
    'html' => '',
    'text_body' => '',
    'delivery_config' => null,
];
$kodety_email_test_events = [];
$kodety_email_test_queue_total = 0;
$kodety_email_test_queue_purges = 0;

final class KodetyEmailSchedulerWpdb {
    public function prepare(string $query, mixed ...$args): array {
        return ['query' => $query, 'args' => $args];
    }

    public function get_col(array $prepared): array {
        global $kodety_email_test_campaign;
        if (
            str_contains($prepared['query'], "status = 'scheduled'")
            && (string) $kodety_email_test_campaign['status'] === 'scheduled'
        ) {
            return [(int) $kodety_email_test_campaign['id']];
        }
        return [];
    }
}

$wpdb = new KodetyEmailSchedulerWpdb();

function wp_clear_scheduled_hook(string $hook, array $args = []): int {
    global $kodety_email_test_events;
    $before = count($kodety_email_test_events);
    $kodety_email_test_events = array_values(array_filter(
        $kodety_email_test_events,
        static fn(array $event): bool => !(
            (string) ($event['hook'] ?? '') === $hook
            && (array) ($event['args'] ?? []) === $args
        )
    ));
    return $before - count($kodety_email_test_events);
}

final class Kodety_Email_Schema {
    public const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'paused', 'sent', 'failed'];

    public static function table(string $suffix): string {
        return 'wp_kodety_email_' . $suffix;
    }
}

final class Kodety_Email_Campaigns {
    public static function compare_and_swap_status(
        int $id,
        array $from_statuses,
        string $to_status,
        array $data = []
    ): bool {
        global $kodety_email_test_campaign;
        if (
            $id !== (int) $kodety_email_test_campaign['id']
            || !in_array((string) $kodety_email_test_campaign['status'], $from_statuses, true)
        ) {
            return false;
        }
        $kodety_email_test_campaign = array_merge(
            $kodety_email_test_campaign,
            $data,
            ['status' => $to_status]
        );
        return true;
    }
}

final class Kodety_Email_Queue {
    public static function purge_campaign(int $campaign_id): void {
        global $kodety_email_test_campaign, $kodety_email_test_queue_total, $kodety_email_test_queue_purges;
        if ($campaign_id !== (int) $kodety_email_test_campaign['id']) return;
        $kodety_email_test_queue_total = 0;
        $kodety_email_test_queue_purges++;
    }
}

require dirname(__DIR__) . '/kodety/includes/email/class-kodety-email-scheduler.php';

function kodety_email_scheduler_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$blocked = Kodety_Email_Scheduler::schedule(17, '2026-07-27T14:00', 'revision');
kodety_email_scheduler_assert(
    $blocked['ok'] === false
        && ($kodety_email_test_campaign['status'] ?? '') === 'draft'
        && array_key_exists('scheduled_at', $kodety_email_test_campaign)
        && $kodety_email_test_campaign['scheduled_at'] === null
        && $kodety_email_test_queue_total === 0
        && $kodety_email_test_events === [],
    'chamada PHP direta não pode criar status, fila ou evento de agendamento'
);

$kodety_email_test_campaign = array_merge($kodety_email_test_campaign, [
    'status' => 'scheduled',
    'scheduled_at' => '2026-07-27 17:00:00',
    'html' => '<p>snapshot antigo</p>',
    'text_body' => 'snapshot antigo',
    'delivery_config' => '{"legacy":true}',
]);
$kodety_email_test_queue_total = 24;
$kodety_email_test_events[] = [
    'hook' => Kodety_Email_Scheduler::LEGACY_CRON_HOOK,
    'args' => [17],
];
$blocked_legacy = Kodety_Email_Scheduler::schedule(17, '2026-07-28T14:00', 'revision');
kodety_email_scheduler_assert(
    $blocked_legacy['ok'] === false
        && ($kodety_email_test_campaign['status'] ?? '') === 'draft'
        && array_key_exists('scheduled_at', $kodety_email_test_campaign)
        && $kodety_email_test_campaign['scheduled_at'] === null
        && ($kodety_email_test_campaign['html'] ?? 'not-empty') === ''
        && array_key_exists('delivery_config', $kodety_email_test_campaign)
        && $kodety_email_test_campaign['delivery_config'] === null
        && $kodety_email_test_queue_total === 0
        && $kodety_email_test_events === [],
    'tentativa antiga de reagendar deve converter a linha legada em rascunho manual'
);

$kodety_email_test_campaign['status'] = 'scheduled';
$kodety_email_test_campaign['scheduled_at'] = '2026-07-27 17:00:00';
$kodety_email_test_queue_total = 10;
$kodety_email_test_events[] = [
    'hook' => Kodety_Email_Scheduler::LEGACY_CRON_HOOK,
    'args' => [17],
];
Kodety_Email_Scheduler::dispatch(17);
kodety_email_scheduler_assert(
    ($kodety_email_test_campaign['status'] ?? '') === 'draft'
        && array_key_exists('scheduled_at', $kodety_email_test_campaign)
        && $kodety_email_test_campaign['scheduled_at'] === null
        && $kodety_email_test_queue_total === 0
        && $kodety_email_test_events === [],
    'callback legado individual deve cancelar, jamais enviar'
);

$kodety_email_test_campaign['status'] = 'scheduled';
$kodety_email_test_campaign['scheduled_at'] = '2026-07-29 17:00:00';
$kodety_email_test_queue_total = 8;
$batch = Kodety_Email_Scheduler::run_due(10);
kodety_email_scheduler_assert(
    $batch === ['processed' => 1, 'queued' => 0, 'failed' => 0]
        && ($kodety_email_test_campaign['status'] ?? '') === 'draft'
        && array_key_exists('scheduled_at', $kodety_email_test_campaign)
        && $kodety_email_test_campaign['scheduled_at'] === null
        && $kodety_email_test_queue_total === 0,
    'fallback legado em lote deve converter qualquer horário em rascunho sem enfileirar'
);

kodety_email_scheduler_assert(
    $kodety_email_test_queue_purges === 3,
    'cada linha legada convertida deve remover a antiga reserva de destinatários'
);

echo "Compatibilidade manual-only do Email Marketing aprovada.\n";
