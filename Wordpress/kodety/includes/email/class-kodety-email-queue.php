<?php
/**
 * Fila de envio.
 *
 * Enviar 5.000 emails não cabe numa requisição HTTP, então cada destinatário é
 * uma linha com estado próprio. O worker assume que vai morrer no meio: o
 * claim reivindica um lote com token exclusivo, e tudo que não foi concluído
 * volta para a fila quando o lock expira.
 *
 * Quem chama o worker é indiferente — a aba do navegador, o evento individual
 * de retomada ou o watchdog. A fila só é criada depois do clique manual em
 * "Enviar agora".
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Queue {
    /** Backoff por tentativa: 1min, 5min, 30min, 2h, 6h. */
    private const BACKOFF = [60, 300, 1800, 7200, 21600];
    private const MAX_ATTEMPTS = 5;

    /** Tempo do lock de um lote reivindicado. */
    private const LOCK_SECONDS = 180;

    /** O tick para antes disso para não ser morto pelo max_execution_time. */
    private const TIME_BUDGET = 20.0;

    /**
     * Monta a fila da campanha.
     *
     * Tudo em SQL de conjunto: uma base de 100 mil contatos não pode passar
     * pela memória do PHP só para virar linhas de fila.
     *
     * @return int Quantidade enfileirada.
     */
    public static function enqueue_campaign(int $campaign_id, array $audience): int {
        global $wpdb;

        $list_ids = array_values(array_filter(array_map('absint', (array) ($audience['list_ids'] ?? []))));
        if (!$list_ids) return 0;

        $queue = Kodety_Email_Schema::table('queue');
        $contacts = Kodety_Email_Schema::table('contacts');
        $pivot = Kodety_Email_Schema::table('list_contacts');
        $suppressions = Kodety_Email_Schema::table('suppressions');

        $placeholders = implode(',', array_fill(0, count($list_ids), '%d'));
        $now = Kodety_Email_Schema::now();

        // O token VERP é derivado de campanha+contato+salt: estável entre
        // reenvios e único por linha, sem precisar de round-trip ao PHP.
        $sql = "INSERT IGNORE INTO {$queue}
                    (campaign_id, contact_id, email, status, attempts, next_attempt_at, verp_token, created_at)
                SELECT %d, c.id, c.email, 'pending', 0, %s,
                       SUBSTRING(SHA2(CONCAT(%d, ':', c.id, ':', %s), 256), 1, 32), %s
                FROM {$contacts} c
                INNER JOIN {$pivot} lc ON lc.contact_id = c.id
                WHERE lc.list_id IN ({$placeholders})
                  AND c.status = 'subscribed'
                  AND NOT EXISTS (SELECT 1 FROM {$suppressions} s WHERE s.email_hash = c.email_hash)";

        $params = array_merge(
            [$campaign_id, $now, $campaign_id, wp_salt('kodety_email'), $now],
            $list_ids
        );

        $wpdb->query($wpdb->prepare($sql, ...$params));
        return (int) $wpdb->rows_affected;
    }

    /**
     * Processa um lote.
     *
     * @return array{sent:int,failed:int,skipped:int,pending:int,throttled:bool,retry_after:int,done:bool}
     */
    public static function tick(int $campaign_id): array {
        $campaign = Kodety_Email_Campaigns::get($campaign_id);
        $progress = self::progress($campaign_id);

        if ($progress['pending'] === 0) {
            self::finalize($campaign_id);
            return self::result(0, $progress['failed'], $progress['skipped'], 0, false, 0, true);
        }
        if (!$campaign) {
            return self::result(0, 0, 0, $progress['pending'], false, 0, true);
        }

        // O limite por minuto/hora é global. Um lock consultivo do MySQL fica
        // retido durante o lote, portanto dois workers de campanhas diferentes
        // não podem observar a mesma allowance e reservar ambos o limite todo.
        // Se o processo morrer, o MySQL libera o lock junto com a conexão.
        if (!self::acquire_sender_lock()) {
            return self::result(0, 0, 0, $progress['pending'], true, 2, false);
        }

        $transport = null;
        try {
            // A campanha pode ter sido pausada enquanto este worker aguardava
            // o lock global de envio. Recarregar aqui evita iniciar um lote a
            // partir do snapshot de estado lido antes da espera.
            $campaign = Kodety_Email_Campaigns::get($campaign_id);
            if (!$campaign || (string) $campaign['status'] !== 'sending') {
                return self::result(0, 0, 0, $progress['pending'], false, 0, false);
            }

            $settings = Kodety_Email_Settings::for_campaign($campaign);
            if (empty($settings['_campaign_delivery_current'])) {
                Kodety_Email_Campaigns::pause_for_delivery_change($campaign_id);
                return self::result(0, 0, 0, $progress['pending'], false, 0, false);
            }
            $allowance = self::allowance($settings);
            if ($allowance <= 0) {
                // Não é erro: o limite existe justamente para segurar o ritmo.
                return self::result(0, 0, 0, $progress['pending'], true, 60, false);
            }

            $batch = self::claim($campaign_id, min($allowance, (int) $settings['batch_size']));
            if (!$batch) {
                return self::result(
                    0,
                    0,
                    0,
                    $progress['pending'],
                    false,
                    self::next_retry_after($campaign_id),
                    false
                );
            }

            $transport = Kodety_Email_Transport::instance();
            $started = microtime(true);
            $sent = 0;
            $failed = 0;
            $skipped = 0;

            foreach ($batch as $index => $item) {
                // Pausar deve valer no máximo após o email que já entrou no
                // transporte. As linhas ainda não iniciadas voltam ao pool sem
                // consumir tentativa e ficam intactas para uma futura retomada.
                if (!self::campaign_is_sending($campaign_id)) {
                    self::release(array_slice($batch, (int) $index));
                    break;
                }

                if (microtime(true) - $started > self::TIME_BUDGET) {
                    // Devolve o que sobrou do lote para o próximo ciclo em vez de
                    // arriscar ser morto no meio de um envio.
                    self::release([$item]);
                    continue;
                }

                $contact = Kodety_Email_Contacts::get((int) $item['contact_id']);
                if (
                    !$contact
                    || $contact['status'] !== 'subscribed'
                    || Kodety_Email_Contacts::is_suppressed((string) $item['email'])
                ) {
                    // O contato pode ter se descadastrado depois de enfileirado.
                    self::mark_skipped((int) $item['id']);
                    $skipped++;
                    continue;
                }

                // A fila é a fotografia aprovada. Se o cadastro for editado
                // depois, este disparo mantém o endereço reservado e usa o
                // mesmo valor também nas merge tags.
                $contact['email'] = (string) $item['email'];
                $message = Kodety_Email_Renderer::render($campaign, $contact, $settings);
                $result = $transport->send([
                    'to' => (string) $item['email'],
                    'to_name' => (string) $contact['name'],
                    'subject' => $message['subject'],
                    'html' => $message['html'],
                    'text' => $message['text'],
                    'verp_token' => (string) $item['verp_token'],
                    'campaign_id' => $campaign_id,
                    'list_unsubscribe' => '<' . $message['unsubscribe_url'] . '>',
                    'list_unsubscribe_post' => true,
                    'settings' => $settings,
                ]);

                if ($result['ok']) {
                    $ack_state = self::persist_transport_ack($item, (string) $result['message_id']);
                    if ($ack_state === 'sent') {
                        Kodety_Email_Tracking::record('sent', $campaign_id, (int) $contact['id']);
                        $sent++;
                        continue;
                    }
                    if ($ack_state === 'delivery_uncertain') {
                        // The SMTP/provider ACK is an external side effect and
                        // cannot be rolled back. Keep the queue row terminal and
                        // visible as a failure instead of ever retrying it.
                        $failed++;
                        continue;
                    }

                    // Both local persistence attempts failed. Do not release the
                    // acknowledged row back to `pending`: that would silently
                    // send it again as soon as its lock expires. Pause the whole
                    // campaign and release only recipients that were not started.
                    self::pause_after_ack_persistence_failure(
                        $campaign_id,
                        $item,
                        (string) $result['message_id']
                    );
                    self::release(array_slice($batch, (int) $index + 1));
                    break;
                }

                $failed += self::mark_failure(
                    $item,
                    $result,
                    $campaign_id,
                    (string) $item['email']
                ) ? 1 : 0;
            }

            $progress = self::progress($campaign_id);
            $done = $progress['pending'] === 0;
            if ($done) self::finalize($campaign_id);

            return self::result($sent, $failed, $skipped, $progress['pending'], false, 2, $done);
        } finally {
            // Também fecha quando renderização, tracking ou persistência lançam:
            // um lote abortado não pode deixar a conexão SMTP viva.
            if ($transport instanceof Kodety_Email_Transport) $transport->close();
            self::release_sender_lock();
        }
    }

    /**
     * Quantos emails ainda podem sair agora sem furar o limite por minuto ou
     * por hora. O limite é global, não por campanha: quem sofre com excesso é
     * a reputação do IP, que é uma só.
     */
    private static function allowance(array $settings): int {
        global $wpdb;

        $queue = Kodety_Email_Schema::table('queue');
        $last_minute = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$queue} WHERE sent_at >= UTC_TIMESTAMP() - INTERVAL 1 MINUTE"
        );
        $last_hour = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$queue} WHERE sent_at >= UTC_TIMESTAMP() - INTERVAL 1 HOUR"
        );

        return (int) min(
            (int) $settings['emails_per_minute'] - $last_minute,
            (int) $settings['emails_per_hour'] - $last_hour
        );
    }

    private static function sender_lock_name(): string {
        global $wpdb;
        $database = defined('DB_NAME') ? (string) DB_NAME : (string) home_url('/');
        $prefix = isset($wpdb->base_prefix)
            ? (string) $wpdb->base_prefix
            : (string) $wpdb->prefix;
        return 'kodety_email_sender_' . substr(hash('sha256', $database . ':' . $prefix), 0, 32);
    }

    private static function acquire_sender_lock(): bool {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            'SELECT GET_LOCK(%s, 0)',
            self::sender_lock_name()
        )) === 1;
    }

    private static function release_sender_lock(): void {
        global $wpdb;
        $wpdb->get_var($wpdb->prepare(
            'SELECT RELEASE_LOCK(%s)',
            self::sender_lock_name()
        ));
    }

    private static function campaign_is_sending(int $campaign_id): bool {
        global $wpdb;
        return (string) $wpdb->get_var($wpdb->prepare(
            'SELECT status FROM ' . Kodety_Email_Schema::table('campaigns') . ' WHERE id = %d',
            $campaign_id
        )) === 'sending';
    }

    /**
     * Reivindica um lote com token exclusivo.
     *
     * O UPDATE marca as linhas; o SELECT seguinte lê só o que este worker
     * marcou. Dois ticks simultâneos — aba aberta e WP-Cron no mesmo segundo —
     * nunca pegam o mesmo destinatário.
     *
     * @return array<int,array>
     */
    private static function claim(int $campaign_id, int $limit): array {
        global $wpdb;
        if ($limit <= 0) return [];

        $queue = Kodety_Email_Schema::table('queue');
        $token = wp_generate_password(32, false, false);

        $wpdb->query($wpdb->prepare(
            "UPDATE {$queue}
             SET lock_token = %s,
                 locked_until = UTC_TIMESTAMP() + INTERVAL %d SECOND,
                 attempts = attempts + 1
             WHERE campaign_id = %d
               AND status = 'pending'
               AND next_attempt_at <= UTC_TIMESTAMP()
               AND (locked_until IS NULL OR locked_until < UTC_TIMESTAMP())
             ORDER BY id
             LIMIT %d",
            $token,
            self::LOCK_SECONDS,
            $campaign_id,
            $limit
        ));

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$queue} WHERE lock_token = %s",
            $token
        ), ARRAY_A);

        return is_array($rows) ? $rows : [];
    }

    /**
     * Quando nenhuma linha pode ser reivindicada, acorda perto do primeiro
     * retry/lock — não a cada cinco segundos durante um backoff de horas.
     */
    private static function next_retry_after(int $campaign_id): int {
        global $wpdb;

        $seconds = $wpdb->get_var($wpdb->prepare(
            "SELECT MIN(
                 TIMESTAMPDIFF(
                     SECOND,
                     UTC_TIMESTAMP(),
                     GREATEST(
                         next_attempt_at,
                         COALESCE(locked_until, '1970-01-01 00:00:00')
                     )
                 )
             )
             FROM " . Kodety_Email_Schema::table('queue') . "
             WHERE campaign_id = %d AND status = 'pending'",
            $campaign_id
        ));

        if ($seconds === null) return 5;
        // Cinco minutos mantém a UI responsiva e impede milhares de polls;
        // o worker de cron usa o mesmo valor para seu próximo evento curto.
        return max(2, min(300, (int) $seconds + 1));
    }

    /** Devolve itens ao pool sem consumir tentativa. */
    private static function release(array $items): void {
        global $wpdb;
        if (!$items) return;

        $ids = array_map(static fn(array $item): int => (int) $item['id'], $items);
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $queue = Kodety_Email_Schema::table('queue');

        $wpdb->query($wpdb->prepare(
            "UPDATE {$queue}
             SET locked_until = NULL, lock_token = '', attempts = GREATEST(attempts - 1, 0)
             WHERE id IN ({$placeholders})",
            ...$ids
        ));
    }

    /**
     * Persist the provider ACK. The fallback is deliberately terminal: after an
     * SMTP success there is no safe automatic retry without provider-level
     * idempotency.
     *
     * @return 'sent'|'delivery_uncertain'|'unpersisted'
     */
    private static function persist_transport_ack(array $item, string $message_id): string {
        if (self::mark_sent($item, $message_id)) return 'sent';
        if (self::mark_acknowledged_delivery_uncertain($item, $message_id)) {
            return 'delivery_uncertain';
        }
        return 'unpersisted';
    }

    private static function mark_sent(array $item, string $message_id): bool {
        global $wpdb;
        return $wpdb->update(Kodety_Email_Schema::table('queue'), [
            'status' => 'sent',
            'locked_until' => null,
            'lock_token' => '',
            'message_id' => mb_substr($message_id, 0, 191),
            'error' => null,
            'sent_at' => Kodety_Email_Schema::now(),
        ], [
            'id' => (int) $item['id'],
            'status' => 'pending',
            'lock_token' => (string) ($item['lock_token'] ?? ''),
        ]) === 1;
    }

    /**
     * A provider accepted the message but the normal local ACK failed. Record a
     * terminal, explicit uncertainty so reports never call it a confirmed send
     * and workers never retry it automatically.
     */
    private static function mark_acknowledged_delivery_uncertain(array $item, string $message_id): bool {
        global $wpdb;
        return $wpdb->update(Kodety_Email_Schema::table('queue'), [
            'status' => 'failed',
            'locked_until' => null,
            'lock_token' => '',
            'message_id' => mb_substr($message_id, 0, 191),
            'error' => 'O provedor aceitou a mensagem, mas o estado local não pôde ser confirmado. Verifique o provedor antes de qualquer reenvio.',
            // The transport accepted this item, so it must still consume the
            // throttle allowance even though reporting remains conservative.
            'sent_at' => Kodety_Email_Schema::now(),
        ], [
            'id' => (int) $item['id'],
            'status' => 'pending',
            'lock_token' => (string) ($item['lock_token'] ?? ''),
        ]) === 1;
    }

    /**
     * Last-resort fail-closed path when even the terminal fallback cannot be
     * written. The current row keeps its lock and the campaign stops before any
     * other recipient is handed to the transport.
     */
    private static function pause_after_ack_persistence_failure(
        int $campaign_id,
        array $item,
        string $message_id
    ): void {
        $paused = Kodety_Email_Campaigns::compare_and_swap_status(
            $campaign_id,
            ['sending'],
            'paused',
            [
                'stats_json' => wp_json_encode([
                    'pause_reason' => 'transport_ack_persistence_failed',
                    'queue_id' => (int) ($item['id'] ?? 0),
                    'provider_message_id' => mb_substr($message_id, 0, 191),
                    'paused_at' => Kodety_Email_Schema::now(),
                    'requires_manual_reconciliation' => true,
                ]),
            ]
        );
        error_log(sprintf(
            '[Onun Kodety Email] Provedor confirmou a fila #%d da campanha #%d, mas o ACK local falhou%s.',
            (int) ($item['id'] ?? 0),
            $campaign_id,
            $paused ? '; campanha pausada para reconciliação manual' : '; não foi possível pausar a campanha'
        ));
    }

    /**
     * Explicit recovery for `transport_ack_persistence_failed`.
     *
     * This method never resumes the campaign. It only converts the exact
     * provider-acknowledged queue row into a terminal, visible uncertainty while
     * holding both records in one transaction. The caller may resume the
     * remaining recipients only after this returns `ok=true`.
     *
     * @return array{ok:bool,error:string,already_reconciled:bool,queue_status:string}
     */
    public static function reconcile_transport_ack_failure(
        int $campaign_id,
        int $queue_id
    ): array {
        global $wpdb;
        $failure = static fn(string $error): array => [
            'ok' => false,
            'error' => $error,
            'already_reconciled' => false,
            'queue_status' => '',
        ];
        if ($campaign_id <= 0 || $queue_id <= 0) {
            return $failure('Campanha ou item de fila inválido.');
        }
        if ($wpdb->query('START TRANSACTION') === false) {
            return $failure('Não foi possível iniciar a reconciliação.');
        }

        $campaigns = Kodety_Email_Schema::table('campaigns');
        $queue = Kodety_Email_Schema::table('queue');
        try {
            $campaign = $wpdb->get_row($wpdb->prepare(
                "SELECT status, stats_json FROM {$campaigns} WHERE id = %d FOR UPDATE",
                $campaign_id
            ), ARRAY_A);
            $stats = is_array($campaign)
                ? json_decode((string) ($campaign['stats_json'] ?? ''), true)
                : null;
            if (
                !is_array($campaign)
                || (string) ($campaign['status'] ?? '') !== 'paused'
                || !is_array($stats)
                || (string) ($stats['pause_reason'] ?? '') !== 'transport_ack_persistence_failed'
                || empty($stats['requires_manual_reconciliation'])
                || (int) ($stats['queue_id'] ?? 0) !== $queue_id
            ) {
                $wpdb->query('ROLLBACK');
                return $failure('Esta campanha não possui esse ACK pendente de reconciliação.');
            }

            $item = $wpdb->get_row($wpdb->prepare(
                "SELECT id, campaign_id, status, message_id, error
                 FROM {$queue}
                 WHERE id = %d AND campaign_id = %d
                 FOR UPDATE",
                $queue_id,
                $campaign_id
            ), ARRAY_A);
            if (!is_array($item)) {
                $wpdb->query('ROLLBACK');
                return $failure('O item de fila confirmado pelo provedor não foi encontrado.');
            }

            $status = (string) ($item['status'] ?? '');
            if (in_array($status, ['sent', 'failed', 'skipped'], true)) {
                if ($wpdb->query('COMMIT') === false) {
                    $wpdb->query('ROLLBACK');
                    return $failure('Não foi possível confirmar a reconciliação já aplicada.');
                }
                return [
                    'ok' => true,
                    'error' => '',
                    'already_reconciled' => true,
                    'queue_status' => $status,
                ];
            }
            if ($status !== 'pending') {
                $wpdb->query('ROLLBACK');
                return $failure('O item de fila está em um estado incompatível com a reconciliação.');
            }

            $message_id = mb_substr((string) (
                $stats['provider_message_id']
                ?? $item['message_id']
                ?? ''
            ), 0, 191);
            $updated = $wpdb->update($queue, [
                'status' => 'failed',
                'locked_until' => null,
                'lock_token' => '',
                'message_id' => $message_id,
                'error' => 'Entrega incerta reconciliada manualmente: o provedor confirmou a mensagem e o reenvio automático foi bloqueado.',
                'sent_at' => Kodety_Email_Schema::now(),
            ], [
                'id' => $queue_id,
                'campaign_id' => $campaign_id,
                'status' => 'pending',
            ]);
            if ($updated !== 1 || $wpdb->query('COMMIT') === false) {
                $wpdb->query('ROLLBACK');
                return $failure('Não foi possível tornar a entrega incerta terminal.');
            }
            return [
                'ok' => true,
                'error' => '',
                'already_reconciled' => false,
                'queue_status' => 'failed',
            ];
        } catch (Throwable $error) {
            $wpdb->query('ROLLBACK');
            return $failure('Não foi possível concluir a reconciliação.');
        }
    }

    private static function mark_skipped(int $id): void {
        global $wpdb;
        $wpdb->update(Kodety_Email_Schema::table('queue'), [
            'status' => 'skipped',
            'locked_until' => null,
            'lock_token' => '',
            'error' => 'Contato não está mais inscrito.',
        ], ['id' => $id]);
    }

    /**
     * @return bool True quando a falha é definitiva (conta como falha no
     *              relatório); false quando ainda vai ser retentada.
     */
    private static function mark_failure(array $item, array $result, int $campaign_id, string $email): bool {
        global $wpdb;

        $queue = Kodety_Email_Schema::table('queue');
        $attempts = (int) $item['attempts'];
        $permanent = (bool) $result['permanent'];
        $exhausted = $attempts >= self::MAX_ATTEMPTS;

        if ($permanent || $exhausted) {
            $wpdb->update($queue, [
                'status' => 'failed',
                'locked_until' => null,
                'lock_token' => '',
                'error' => (string) $result['error'],
            ], ['id' => (int) $item['id']]);

            // Só uma classificação explícita de caixa inválida entra em
            // supressão. 5xx de política/conteúdo e tentativas esgotadas ficam
            // visíveis como falha, sem banir o endereço para sempre.
            if (!empty($result['suppress'])) {
                Kodety_Email_Contacts::suppress($email, 'bounce', $campaign_id, (string) $result['error']);
                Kodety_Email_Tracking::record('bounce', $campaign_id, (int) $item['contact_id']);
            }
            return true;
        }

        $delay = self::BACKOFF[min($attempts, count(self::BACKOFF)) - 1] ?? end(self::BACKOFF);
        $wpdb->query($wpdb->prepare(
            "UPDATE {$queue}
             SET status = 'pending', locked_until = NULL, lock_token = '',
                 next_attempt_at = UTC_TIMESTAMP() + INTERVAL %d SECOND, error = %s
             WHERE id = %d",
            $delay,
            (string) $result['error'],
            (int) $item['id']
        ));
        return false;
    }

    /**
     * @return array{total:int,sent:int,failed:int,skipped:int,pending:int}
     */
    public static function progress(int $campaign_id): array {
        global $wpdb;

        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT status, COUNT(*) total FROM ' . Kodety_Email_Schema::table('queue')
            . ' WHERE campaign_id = %d GROUP BY status',
            $campaign_id
        ), ARRAY_A);

        $counts = ['pending' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $counts[(string) $row['status']] = (int) $row['total'];
        }

        return [
            'total' => array_sum($counts),
            'sent' => $counts['sent'],
            'failed' => $counts['failed'],
            'skipped' => $counts['skipped'],
            'pending' => $counts['pending'],
        ];
    }

    private static function finalize(int $campaign_id): void {
        $progress = self::progress($campaign_id);
        $status = self::terminal_status($progress);
        $completed_at = Kodety_Email_Schema::now();
        Kodety_Email_Campaigns::compare_and_swap_status($campaign_id, ['sending'], $status, [
            'sent_at' => $status === 'sent' ? $completed_at : null,
            'stats_json' => wp_json_encode([
                'total' => $progress['total'],
                'sent' => $progress['sent'],
                'failed' => $progress['failed'],
                'skipped' => $progress['skipped'],
                'completed_with_errors' => ($progress['failed'] + $progress['skipped']) > 0,
                'completed_at' => $completed_at,
            ]),
        ]);
    }

    /** @param array{sent:int,failed:int,skipped:int} $progress */
    public static function terminal_status(array $progress): string {
        $sent = (int) ($progress['sent'] ?? 0);
        $not_delivered = (int) ($progress['failed'] ?? 0) + (int) ($progress['skipped'] ?? 0);
        return $sent === 0 && $not_delivered > 0 ? 'failed' : 'sent';
    }

    public static function purge_campaign(int $campaign_id): void {
        global $wpdb;
        $wpdb->delete(Kodety_Email_Schema::table('queue'), ['campaign_id' => $campaign_id]);
    }

    private static function result(
        int $sent,
        int $failed,
        int $skipped,
        int $pending,
        bool $throttled,
        int $retry_after,
        bool $done
    ): array {
        return [
            'sent' => $sent,
            'failed' => $failed,
            'skipped' => $skipped,
            'pending' => $pending,
            'throttled' => $throttled,
            'retry_after' => $retry_after,
            'done' => $done,
        ];
    }
}
