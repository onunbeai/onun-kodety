<?php
/**
 * Campanhas e templates.
 *
 * Campanhas saem somente após confirmação manual. Conteúdo, público e
 * configuração de entrega são congelados nesse ponto; a fila durável permite
 * acompanhar, pausar e retomar sem duplicar destinatários. O caminho
 * `scheduled` permanece apenas para ler e desfazer dados de versões antigas.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Campaigns {
    // --- Templates --------------------------------------------------------

    public static function save_template(array $data, int $template_id = 0): int {
        global $wpdb;

        $now = Kodety_Email_Schema::now();
        $html = (string) ($data['html'] ?? '');

        $row = [
            'name' => sanitize_text_field((string) ($data['name'] ?? 'Sem título')),
            'kind' => sanitize_key((string) ($data['kind'] ?? 'campaign')),
            'html' => $html,
            // Fonte de verdade do builder. Guardar o documento junto do HTML
            // permite reabrir e editar; o HTML sozinho só serviria para enviar.
            'project_json' => isset($data['project_json']) ? (string) $data['project_json'] : null,
            'text_body' => (string) ($data['text_body'] ?? Kodety_Email_Renderer::html_to_text($html)),
            'updated_at' => $now,
        ];

        if ($template_id > 0) {
            $wpdb->update(Kodety_Email_Schema::table('templates'), $row, ['id' => $template_id]);
            return $template_id;
        }

        $row['created_by'] = get_current_user_id();
        $row['created_at'] = $now;
        $wpdb->insert(Kodety_Email_Schema::table('templates'), $row);
        return (int) $wpdb->insert_id;
    }

    public static function get_template(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Kodety_Email_Schema::table('templates') . ' WHERE id = %d',
            $id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /**
     * Revisão opaca do conteúdo editável.
     *
     * `updated_at` tem resolução de um segundo no schema. Incluir os próprios
     * campos evita que duas gravações diferentes no mesmo segundo pareçam a
     * mesma revisão.
     */
    public static function template_revision(array $template): string {
        return hash('sha256', implode("\0", [
            (string) ($template['id'] ?? 0),
            (string) ($template['updated_at'] ?? ''),
            (string) ($template['name'] ?? ''),
            (string) ($template['project_json'] ?? ''),
            (string) ($template['html'] ?? ''),
            (string) ($template['text_body'] ?? ''),
        ]));
    }

    /**
     * Salva somente se a aba ainda estiver editando a versão que abriu.
     *
     * O SELECT FOR UPDATE serializa duas requisições simultâneas. A segunda
     * acorda depois do commit da primeira, recalcula a revisão e recebe
     * conflito em vez de sobrescrever silenciosamente o trabalho já salvo.
     *
     * @return array{ok:bool,reason:string}
     */
    public static function save_template_if_revision(
        int $id,
        array $data,
        string $expected_revision
    ): array {
        global $wpdb;

        $table = Kodety_Email_Schema::table('templates');
        $wpdb->query('START TRANSACTION');
        $template = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE id = %d FOR UPDATE",
            $id
        ), ARRAY_A);

        if (!is_array($template)) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'missing'];
        }

        $current_revision = self::template_revision($template);
        if (
            $expected_revision === ''
            || !hash_equals($current_revision, $expected_revision)
        ) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'conflict'];
        }

        self::save_template($data, $id);
        if ($wpdb->last_error !== '') {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'database'];
        }

        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'database'];
        }
        return ['ok' => true, 'reason' => ''];
    }

    public static function templates(): array {
        global $wpdb;
        $rows = $wpdb->get_results(
            'SELECT id, name, kind, thumbnail_id, updated_at FROM ' . Kodety_Email_Schema::table('templates')
            . " WHERE kind = 'campaign' ORDER BY updated_at DESC",
            ARRAY_A
        );
        return is_array($rows) ? $rows : [];
    }

    /** @return array{ok:bool,reason:string,usage:int} */
    public static function delete_template(int $id): array {
        global $wpdb;

        if ($id <= 0) return ['ok' => false, 'reason' => 'missing', 'usage' => 0];
        $templates = Kodety_Email_Schema::table('templates');
        $campaigns = Kodety_Email_Schema::table('campaigns');
        $deleted = $wpdb->query($wpdb->prepare(
            "DELETE t
             FROM {$templates} t
             LEFT JOIN {$campaigns} c ON c.template_id = t.id
             WHERE t.id = %d AND c.id IS NULL",
            $id
        ));
        if ($deleted === 1) return ['ok' => true, 'reason' => '', 'usage' => 0];
        if ($deleted === false || $wpdb->last_error !== '') {
            return ['ok' => false, 'reason' => 'database', 'usage' => 0];
        }

        $exists = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$templates} WHERE id = %d",
            $id
        ));
        if ($exists === 0) return ['ok' => false, 'reason' => 'missing', 'usage' => 0];

        $usage = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$campaigns} WHERE template_id = %d",
            $id
        ));
        return ['ok' => false, 'reason' => 'used', 'usage' => $usage];
    }

    /** Cria uma cópia independente e editável do documento do builder. */
    public static function duplicate_template(int $id): int {
        $source = self::get_template($id);
        if (!$source) return 0;

        return self::save_template([
            'name' => mb_substr((string) $source['name'], 0, 170) . ' (cópia)',
            'kind' => (string) $source['kind'],
            'project_json' => $source['project_json'],
            'html' => (string) $source['html'],
            'text_body' => (string) $source['text_body'],
        ]);
    }

    // --- Campanhas --------------------------------------------------------

    public static function create(array $data): int {
        global $wpdb;

        $settings = Kodety_Email_Settings::all();
        $now = Kodety_Email_Schema::now();

        $wpdb->insert(Kodety_Email_Schema::table('campaigns'), [
            'name' => sanitize_text_field((string) ($data['name'] ?? 'Nova campanha')),
            'subject' => sanitize_text_field((string) ($data['subject'] ?? '')),
            'preheader' => sanitize_text_field((string) ($data['preheader'] ?? '')),
            'from_name' => (string) $settings['from_name'],
            'from_email' => (string) $settings['from_email'],
            'reply_to' => (string) $settings['reply_to'],
            'template_id' => (int) ($data['template_id'] ?? 0),
            'audience_json' => wp_json_encode(['list_ids' => []]),
            'status' => 'draft',
            'created_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return (int) $wpdb->insert_id;
    }

    public static function update(int $id, array $data): void {
        global $wpdb;

        $allowed = ['name', 'subject', 'preheader', 'template_id', 'audience_json',
                    'status', 'started_at', 'sent_at', 'html', 'text_body',
                    'stats_json'];
        $row = array_intersect_key($data, array_flip($allowed));
        if (!$row) return;

        if (
            isset($row['status'])
            && (
                $row['status'] === 'scheduled'
                || !in_array($row['status'], Kodety_Email_Schema::CAMPAIGN_STATUSES, true)
            )
        ) {
            unset($row['status']);
        }
        if (!$row) return;
        foreach (['name', 'subject', 'preheader'] as $field) {
            if (isset($row[$field])) $row[$field] = sanitize_text_field((string) $row[$field]);
        }

        $row['updated_at'] = Kodety_Email_Schema::now();
        $wpdb->update(Kodety_Email_Schema::table('campaigns'), $row, ['id' => $id]);
    }

    /**
     * Transição de estado por compare-and-swap. Qualquer worker que perdeu a
     * corrida recebe false e não sobrescreve o estado vencedor.
     */
    public static function compare_and_swap_status(
        int $id,
        array $from_statuses,
        string $to_status,
        array $data = []
    ): bool {
        global $wpdb;

        $from_statuses = array_values(array_intersect(
            array_map('strval', $from_statuses),
            Kodety_Email_Schema::CAMPAIGN_STATUSES
        ));
        if (
            $id <= 0
            || !$from_statuses
            || $to_status === 'scheduled'
            || !in_array($to_status, Kodety_Email_Schema::CAMPAIGN_STATUSES, true)
        ) {
            return false;
        }

        $allowed = [
            'scheduled_at', 'started_at', 'sent_at', 'html', 'text_body',
            'stats_json', 'delivery_config', 'from_name', 'from_email', 'reply_to',
        ];
        $assignments = ['status = %s'];
        $params = [$to_status];
        foreach (array_intersect_key($data, array_flip($allowed)) as $field => $value) {
            // `scheduled_at` só sobrevive no schema para ser apagado durante a
            // migração de linhas antigas; nenhuma API atual pode preenchê-lo.
            if ($field === 'scheduled_at' && $value !== null) continue;
            if ($value === null) {
                $assignments[] = "{$field} = NULL";
                continue;
            }
            $assignments[] = "{$field} = %s";
            $params[] = (string) $value;
        }
        $assignments[] = 'updated_at = %s';
        $params[] = Kodety_Email_Schema::now();
        $params[] = $id;
        array_push($params, ...$from_statuses);

        $status_placeholders = implode(',', array_fill(0, count($from_statuses), '%s'));
        $sql = 'UPDATE ' . Kodety_Email_Schema::table('campaigns')
            . ' SET ' . implode(', ', $assignments)
            . " WHERE id = %d AND status IN ({$status_placeholders})";

        return $wpdb->query($wpdb->prepare($sql, ...$params)) === 1;
    }

    /**
     * Revisão opaca dos campos que uma aba de campanha consegue editar.
     * Incluir os valores evita colisões causadas pela resolução de um segundo
     * de `updated_at`, seguindo a mesma proteção usada nos templates.
     */
    public static function campaign_revision(array $campaign): string {
        return hash('sha256', implode("\0", [
            (string) ($campaign['id'] ?? 0),
            (string) ($campaign['updated_at'] ?? ''),
            (string) ($campaign['status'] ?? ''),
            (string) ($campaign['name'] ?? ''),
            (string) ($campaign['subject'] ?? ''),
            (string) ($campaign['preheader'] ?? ''),
            (string) ($campaign['template_id'] ?? 0),
            (string) ($campaign['audience_json'] ?? ''),
            (string) ($campaign['html'] ?? ''),
            (string) ($campaign['text_body'] ?? ''),
        ]));
    }

    /**
     * Preserva por alguns minutos um POST que perdeu uma disputa entre abas.
     * A tela reaplica os campos somente para o mesmo usuário, sem tocar no
     * banco, e exige uma nova confirmação de salvamento.
     */
    public static function stash_draft_recovery(int $id, array $data, array $list_ids): void {
        if ($id <= 0 || get_current_user_id() <= 0) return;

        set_transient(self::draft_recovery_key($id), [
            'name' => mb_substr(sanitize_text_field((string) ($data['name'] ?? '')), 0, 190),
            'subject' => mb_substr(sanitize_text_field((string) ($data['subject'] ?? '')), 0, 250),
            'preheader' => mb_substr(sanitize_text_field((string) ($data['preheader'] ?? '')), 0, 250),
            'template_id' => absint($data['template_id'] ?? 0),
            'list_ids' => array_values(array_unique(array_filter(array_map('absint', $list_ids)))),
        ], 15 * MINUTE_IN_SECONDS);
    }

    public static function consume_draft_recovery(int $id): ?array {
        if ($id <= 0 || get_current_user_id() <= 0) return null;

        $key = self::draft_recovery_key($id);
        $data = get_transient($key);
        delete_transient($key);
        return is_array($data) ? $data : null;
    }

    private static function draft_recovery_key(int $id): string {
        return 'kodety_email_campaign_recovery_' . get_current_user_id() . '_' . $id;
    }

    /**
     * Salva o formulário apenas se nenhuma outra aba alterou o rascunho.
     *
     * @return array{ok:bool,reason:string,revision:string}
     */
    public static function save_draft_if_revision(
        int $id,
        array $data,
        array $list_ids,
        string $expected_revision
    ): array {
        global $wpdb;

        if ($wpdb->query('START TRANSACTION') === false) {
            return ['ok' => false, 'reason' => 'database', 'revision' => ''];
        }

        $campaign = self::locked_campaign($id);
        if (!is_array($campaign)) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'missing', 'revision' => ''];
        }
        if (!self::is_editable($campaign)) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'locked', 'revision' => ''];
        }
        if (
            $expected_revision === ''
            || !hash_equals(self::campaign_revision($campaign), $expected_revision)
        ) {
            $wpdb->query('ROLLBACK');
            return [
                'ok' => false,
                'reason' => 'conflict',
                'revision' => self::campaign_revision($campaign),
            ];
        }

        $list_ids = array_values(array_unique(array_filter(array_map('absint', $list_ids))));
        if ($list_ids) {
            $placeholders = implode(',', array_fill(0, count($list_ids), '%d'));
            $locked_lists = $wpdb->get_col($wpdb->prepare(
                'SELECT id FROM ' . Kodety_Email_Schema::table('lists')
                    . " WHERE id IN ({$placeholders}) FOR UPDATE",
                ...$list_ids
            ));
            $locked_lists = array_values(array_unique(array_map('absint', (array) $locked_lists)));
            sort($locked_lists);
            $expected_lists = $list_ids;
            sort($expected_lists);
            if ($locked_lists !== $expected_lists) {
                $wpdb->query('ROLLBACK');
                return ['ok' => false, 'reason' => 'invalid_audience', 'revision' => ''];
            }
        }

        $template_id = absint($data['template_id'] ?? 0);
        if ($template_id > 0) {
            $template_exists = $wpdb->get_var($wpdb->prepare(
                'SELECT id FROM ' . Kodety_Email_Schema::table('templates')
                    . ' WHERE id = %d FOR UPDATE',
                $template_id
            ));
            if ((int) $template_exists !== $template_id) {
                $wpdb->query('ROLLBACK');
                return ['ok' => false, 'reason' => 'invalid_template', 'revision' => ''];
            }
        }

        if (!self::save_draft($id, $data, $list_ids) || $wpdb->last_error !== '') {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'database', 'revision' => ''];
        }

        $updated = self::locked_campaign($id);
        if (!is_array($updated) || $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'database', 'revision' => ''];
        }

        return [
            'ok' => true,
            'reason' => '',
            'revision' => self::campaign_revision($updated),
        ];
    }

    /**
     * Salva campos editáveis e audiência numa única CAS. Uma aba aberta antes
     * do clique em Enviar não consegue alterar a linha depois de `sending`.
     */
    public static function save_draft(int $id, array $data, array $list_ids): bool {
        global $wpdb;

        $name = sanitize_text_field((string) ($data['name'] ?? ''));
        $subject = sanitize_text_field((string) ($data['subject'] ?? ''));
        $preheader = sanitize_text_field((string) ($data['preheader'] ?? ''));
        $template_id = absint($data['template_id'] ?? 0);
        $audience_json = wp_json_encode([
            'list_ids' => array_values(array_unique(array_filter(array_map('absint', $list_ids)))),
        ]);
        $now = Kodety_Email_Schema::now();

        $changed = $wpdb->query($wpdb->prepare(
            'UPDATE ' . Kodety_Email_Schema::table('campaigns') . "
             SET name = %s, subject = %s, preheader = %s, template_id = %d,
                 audience_json = %s,
                 html = IF(status = 'failed', '', html),
                 text_body = IF(status = 'failed', '', text_body),
                 updated_at = %s
             WHERE id = %d AND status IN ('draft', 'failed')",
            $name,
            $subject,
            $preheader,
            $template_id,
            $audience_json,
            $now,
            $id
        ));
        if ($changed === 1) return true;
        if ($changed === false) return false;

        // UPDATE idempotente no mesmo segundo pode afetar zero linhas.
        $current = self::get($id);
        return $current
            && in_array((string) $current['status'], ['draft', 'failed'], true)
            && (string) $current['name'] === $name
            && (string) $current['subject'] === $subject
            && (string) $current['preheader'] === $preheader
            && (int) $current['template_id'] === $template_id
            && wp_json_encode((array) ($current['audience']['list_ids'] ?? [])) === wp_json_encode(
                json_decode((string) $audience_json, true)['list_ids'] ?? []
            );
    }

    public static function get(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Kodety_Email_Schema::table('campaigns') . ' WHERE id = %d',
            $id
        ), ARRAY_A);
        if (!is_array($row)) return null;

        $row['audience'] = json_decode((string) $row['audience_json'], true) ?: ['list_ids' => []];

        // Rascunho ainda não tem snapshot: mostra o template atual para
        // pré-visualizar e validar antes de enviar.
        if (trim((string) $row['html']) === '' && (int) $row['template_id'] > 0) {
            $template = self::get_template((int) $row['template_id']);
            if ($template) {
                $row['html'] = (string) $template['html'];
                $row['text_body'] = (string) $template['text_body'];
            }
        }

        return $row;
    }

    public static function delete(int $id): bool {
        global $wpdb;

        $wpdb->query('START TRANSACTION');
        $status = $wpdb->get_var($wpdb->prepare(
            'SELECT status FROM ' . Kodety_Email_Schema::table('campaigns') . ' WHERE id = %d FOR UPDATE',
            $id
        ));
        if (!in_array((string) $status, ['draft', 'scheduled', 'sent', 'failed'], true)) {
            $wpdb->query('ROLLBACK');
            return false;
        }

        Kodety_Email_Queue::purge_campaign($id);
        $deleted = $wpdb->query($wpdb->prepare(
            'DELETE FROM ' . Kodety_Email_Schema::table('campaigns') . ' WHERE id = %d AND status = %s',
            $id,
            (string) $status
        ));
        if ($deleted !== 1 || $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return false;
        }
        return true;
    }

    /**
     * Cria um rascunho a partir de uma campanha existente.
     *
     * Copia o que define a campanha (assunto, prévia, template, audiência) e
     * deixa de fora o que pertence ao disparo: fila, estatísticas, snapshot de
     * HTML e datas. A cópia pega a versão atual do template no próximo envio,
     * que é o esperado ao reaproveitar algo publicado semanas antes.
     */
    public static function duplicate(int $id): int {
        $source = self::get($id);
        if (!$source) return 0;

        $copy_id = self::create([
            'name' => mb_substr((string) $source['name'], 0, 170) . ' (cópia)',
            'subject' => (string) $source['subject'],
            'preheader' => (string) $source['preheader'],
            'template_id' => (int) $source['template_id'],
        ]);
        if ($copy_id === 0) return 0;

        if (!self::set_audience($copy_id, (array) ($source['audience']['list_ids'] ?? []))) {
            self::delete($copy_id);
            return 0;
        }
        return $copy_id;
    }

    /** Rascunho e falha ainda podem ser editados; enviada e enviando, não. */
    public static function is_editable(array $campaign): bool {
        return in_array((string) $campaign['status'], ['draft', 'failed'], true);
    }

    public static function set_audience(int $id, array $list_ids): bool {
        global $wpdb;

        $list_ids = array_values(array_unique(array_filter(array_map('absint', $list_ids))));
        if ($wpdb->query('START TRANSACTION') === false) return false;
        $campaign = $wpdb->get_row($wpdb->prepare(
            'SELECT id, status FROM ' . Kodety_Email_Schema::table('campaigns')
                . ' WHERE id = %d FOR UPDATE',
            $id
        ), ARRAY_A);
        if (
            !is_array($campaign)
            || !in_array((string) $campaign['status'], ['draft', 'failed'], true)
        ) {
            $wpdb->query('ROLLBACK');
            return false;
        }

        if ($list_ids) {
            $placeholders = implode(',', array_fill(0, count($list_ids), '%d'));
            $existing = $wpdb->get_col($wpdb->prepare(
                'SELECT id FROM ' . Kodety_Email_Schema::table('lists')
                    . " WHERE id IN ({$placeholders}) FOR UPDATE",
                ...$list_ids
            ));
            $existing = array_values(array_unique(array_map('absint', (array) $existing)));
            sort($existing);
            $expected = $list_ids;
            sort($expected);
            if ($existing !== $expected) {
                $wpdb->query('ROLLBACK');
                return false;
            }
        }

        $updated = $wpdb->query($wpdb->prepare(
            'UPDATE ' . Kodety_Email_Schema::table('campaigns')
                . " SET audience_json = %s, updated_at = %s
                   WHERE id = %d AND status IN ('draft', 'failed')",
            wp_json_encode(['list_ids' => $list_ids]),
            Kodety_Email_Schema::now(),
            $id
        ));
        if ($updated === false || $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return false;
        }
        return true;
    }

    /** Quantos contatos receberiam a campanha se ela fosse disparada agora. */
    public static function audience_size(array $list_ids): int {
        return self::audience_summary($list_ids)['total'];
    }

    /**
     * Contagem e assinatura order-independent do conjunto elegível.
     *
     * A assinatura impede que uma troca 1-por-1 entre membros das listas passe
     * apenas porque a contagem continuou igual entre a prévia e o clique.
     *
     * @return array{total:int,signature:string}
     */
    public static function audience_summary(array $list_ids): array {
        global $wpdb;

        $list_ids = array_values(array_unique(array_filter(array_map('absint', $list_ids))));
        if (!$list_ids) return ['total' => 0, 'signature' => ''];

        $contacts = Kodety_Email_Schema::table('contacts');
        $pivot = Kodety_Email_Schema::table('list_contacts');
        $suppressions = Kodety_Email_Schema::table('suppressions');
        $placeholders = implode(',', array_fill(0, count($list_ids), '%d'));

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) total,
                    COALESCE(BIT_XOR(CRC32(CONCAT(eligible.id, ':', eligible.email))), 0) xor_a,
                    COALESCE(SUM(CRC32(CONCAT(eligible.id, ':', eligible.email))), 0) sum_a,
                    COALESCE(BIT_XOR(CRC32(REVERSE(CONCAT(eligible.id, ':', eligible.email)))), 0) xor_b,
                    COALESCE(SUM(CRC32(REVERSE(CONCAT(eligible.id, ':', eligible.email)))), 0) sum_b
             FROM (
                 SELECT DISTINCT c.id, c.email
                 FROM {$contacts} c
                 INNER JOIN {$pivot} lc ON lc.contact_id = c.id
                 WHERE lc.list_id IN ({$placeholders})
                   AND c.status = 'subscribed'
                   AND NOT EXISTS (
                       SELECT 1 FROM {$suppressions} s WHERE s.email_hash = c.email_hash
                   )
             ) eligible",
            ...$list_ids
        ), ARRAY_A);
        if (!is_array($row)) return ['total' => 0, 'signature' => ''];

        return [
            'total' => (int) ($row['total'] ?? 0),
            'signature' => self::sign_audience_aggregate($row),
        ];
    }

    private static function queued_audience_signature(int $campaign_id): string {
        global $wpdb;

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) total,
                    COALESCE(BIT_XOR(CRC32(CONCAT(contact_id, ':', email))), 0) xor_a,
                    COALESCE(SUM(CRC32(CONCAT(contact_id, ':', email))), 0) sum_a,
                    COALESCE(BIT_XOR(CRC32(REVERSE(CONCAT(contact_id, ':', email)))), 0) xor_b,
                    COALESCE(SUM(CRC32(REVERSE(CONCAT(contact_id, ':', email)))), 0) sum_b
             FROM " . Kodety_Email_Schema::table('queue') . "
             WHERE campaign_id = %d",
            $campaign_id
        ), ARRAY_A);
        return is_array($row) ? self::sign_audience_aggregate($row) : '';
    }

    private static function sign_audience_aggregate(array $row): string {
        return hash_hmac('sha256', implode('|', [
            (string) ($row['total'] ?? 0),
            (string) ($row['xor_a'] ?? 0),
            (string) ($row['sum_a'] ?? 0),
            (string) ($row['xor_b'] ?? 0),
            (string) ($row['sum_b'] ?? 0),
        ]), wp_salt('kodety_email_audience'));
    }

    // --- Disparo ----------------------------------------------------------

    /**
     * Valida e enfileira. Não envia nada aqui: quem envia é o worker, um lote
     * por vez.
     *
     * A mudança de estado e a criação da fila vivem na mesma transação. O
     * compare-and-swap no status faz dois pedidos manuais concorrentes
     * convergirem para um único disparo.
     *
     * @return array{ok:bool,error:string,queued:int,already_started?:bool}
     */
    public static function send(
        int $id,
        string $expected_revision = '',
        ?int $expected_audience_size = null,
        string $expected_audience_signature = ''
    ): array {
        global $wpdb;

        $campaign = self::get($id);
        if (!$campaign) return self::send_error('Campanha não encontrada.');
        if (
            $expected_revision === ''
            || !hash_equals(self::campaign_revision($campaign), $expected_revision)
        ) {
            return self::send_error(
                'A campanha mudou em outra aba. Atualize a página e confirme novamente o público e o conteúdo.'
            );
        }

        if (in_array((string) $campaign['status'], ['sending', 'paused'], true)) {
            $progress = Kodety_Email_Queue::progress($id);
            if ($progress['total'] > 0) {
                return [
                    'ok' => true,
                    'error' => '',
                    'queued' => $progress['total'],
                    'already_started' => true,
                ];
            }
            return self::send_error('A campanha está em andamento, mas a fila não foi encontrada.');
        }
        if ((string) $campaign['status'] === 'sent') {
            return self::send_error('Esta campanha já foi disparada.');
        }
        if ((string) $campaign['status'] === 'scheduled') {
            return self::send_error(
                'Esta campanha veio de uma versão antiga com agendamento. Cancele-o e confirme o envio manualmente.'
            );
        }
        if (!in_array((string) $campaign['status'], ['draft', 'failed'], true)) {
            return self::send_error('Esta campanha não está em um estado válido para iniciar o envio.');
        }

        $validation = self::validate_for_send($campaign);
        if (!$validation['ok']) return self::send_error($validation['error']);
        $audience = self::audience_summary($validation['list_ids']);
        if (
            $expected_audience_size === null
            || $expected_audience_signature === ''
            || (int) $audience['total'] !== $expected_audience_size
            || !hash_equals((string) $audience['signature'], $expected_audience_signature)
        ) {
            return self::send_error(
                'O público mudou desde que esta tela foi aberta. Atualize a página e confirme os destinatários novamente.'
            );
        }

        $campaigns = Kodety_Email_Schema::table('campaigns');

        if ($wpdb->query('START TRANSACTION') === false) {
            return self::send_error('Não foi possível iniciar a transação de envio.');
        }

        // O preflight acima evita abrir uma transação quando a revisão ou o
        // público já são inválidos. Antes de congelar qualquer dado, porém,
        // relê campanha e template sob lock. Assim um save_draft concorrente
        // vence por inteiro ou perde por inteiro; nunca misturamos HTML/audiência
        // antigos com assunto e prévia que acabaram de ser salvos.
        $campaign = self::locked_campaign($id);
        if (!$campaign) {
            $wpdb->query('ROLLBACK');
            return self::send_error('Campanha não encontrada.');
        }
        if (
            $expected_revision === ''
            || !hash_equals(self::campaign_revision($campaign), $expected_revision)
        ) {
            $wpdb->query('ROLLBACK');
            return self::send_error(
                'A campanha mudou em outra aba. Atualize a página e confirme novamente o público e o conteúdo.'
            );
        }

        if (in_array((string) $campaign['status'], ['sending', 'paused'], true)) {
            $wpdb->query('ROLLBACK');
            $progress = Kodety_Email_Queue::progress($id);
            if ($progress['total'] > 0) {
                return [
                    'ok' => true,
                    'error' => '',
                    'queued' => $progress['total'],
                    'already_started' => true,
                ];
            }
            return self::send_error('A campanha está em andamento, mas a fila não foi encontrada.');
        }
        if ((string) $campaign['status'] === 'sent') {
            $wpdb->query('ROLLBACK');
            return self::send_error('Esta campanha já foi disparada.');
        }

        $now = Kodety_Email_Schema::now();
        if ((string) $campaign['status'] === 'scheduled') {
            $wpdb->query('ROLLBACK');
            return self::send_error(
                'Esta campanha veio de uma versão antiga com agendamento. Cancele-o e confirme o envio manualmente.'
            );
        }
        if (!in_array((string) $campaign['status'], ['draft', 'failed'], true)) {
            $wpdb->query('ROLLBACK');
            return self::send_error('Esta campanha não está em um estado válido para iniciar o envio.');
        }

        // A revisão bloqueada é a fonte de verdade do snapshot e da audiência.
        // Diagnósticos de reputação (SPF, DKIM, PTR, teste e bounce) são
        // recomendações e nunca impedem esta tentativa manual de envio.
        $validation = self::validate_for_send($campaign);
        if (!$validation['ok']) {
            $wpdb->query('ROLLBACK');
            return self::send_error($validation['error']);
        }
        $audience = self::audience_summary($validation['list_ids']);
        if (
            $expected_audience_size === null
            || $expected_audience_signature === ''
            || (int) $audience['total'] !== $expected_audience_size
            || !hash_equals((string) $audience['signature'], $expected_audience_signature)
        ) {
            $wpdb->query('ROLLBACK');
            return self::send_error(
                'O público mudou desde que esta tela foi aberta. Atualize a página e confirme os destinatários novamente.'
            );
        }

        $settings = $validation['settings'];
        $list_ids = $validation['list_ids'];
        $snapshot = Kodety_Email_Settings::campaign_snapshot($settings);
        $where = "id = %d AND status IN ('draft', 'failed')";
        $where_params = [$id];

        $changed = $wpdb->query($wpdb->prepare(
            "UPDATE {$campaigns}
             SET html = %s, text_body = %s, status = 'sending',
                 scheduled_at = NULL, started_at = %s, sent_at = NULL,
                 from_name = %s, from_email = %s, reply_to = %s,
                 delivery_config = %s, stats_json = NULL, updated_at = %s
             WHERE {$where}",
            (string) $campaign['html'],
            (string) $campaign['text_body'],
            $now,
            (string) $settings['from_name'],
            (string) $settings['from_email'],
            (string) $settings['reply_to'],
            wp_json_encode($snapshot),
            $now,
            ...$where_params
        ));

        if ($changed !== 1) {
            $wpdb->query('ROLLBACK');
            $latest = self::get($id);
            if ($latest && in_array((string) $latest['status'], ['sending', 'paused'], true)) {
                $progress = Kodety_Email_Queue::progress($id);
                if ($progress['total'] > 0) {
                    return [
                        'ok' => true,
                        'error' => '',
                        'queued' => $progress['total'],
                        'already_started' => true,
                    ];
                }
            }
            return self::send_error('A campanha mudou enquanto o envio era iniciado. Atualize a página e tente novamente.');
        }

        // O clique manual cria a fotografia aprovada dos destinatários dentro
        // da mesma transação que muda a campanha para `sending`.
        Kodety_Email_Queue::purge_campaign($id);
        $queued = Kodety_Email_Queue::enqueue_campaign($id, ['list_ids' => $list_ids]);
        if ($queued === 0 || $wpdb->last_error !== '') {
            $wpdb->query('ROLLBACK');
            return self::send_error(
                $wpdb->last_error !== ''
                    ? 'Não foi possível criar a fila de envio.'
                    : 'Nenhum contato elegível nas listas selecionadas.'
            );
        }
        if (
            $expected_audience_size !== $queued
            || !hash_equals(
                $expected_audience_signature,
                self::queued_audience_signature($id)
            )
        ) {
            $wpdb->query('ROLLBACK');
            return self::send_error(
                'O público mudou durante a preparação da fila. Nada foi enviado; atualize a página e confirme novamente.'
            );
        }

        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return self::send_error('Não foi possível confirmar a fila de envio.');
        }

        if (class_exists(Kodety_Email_Marketing::class)) {
            Kodety_Email_Marketing::schedule_campaign_worker($id);
        }
        return ['ok' => true, 'error' => '', 'queued' => $queued, 'already_started' => false];
    }

    /**
     * Preflight do disparo manual.
     *
     * @return array{ok:bool,error:string,list_ids:array<int,int>,settings:array}
     */
    public static function validate_for_send(array $campaign): array {
        $issues = Kodety_Email_Renderer::lint($campaign);
        if (Kodety_Email_Renderer::has_blocking_issue($issues)) {
            return self::validation_error('Corrija os erros apontados na revisão antes de enviar.');
        }

        $list_ids = array_values(array_filter(array_map(
            'absint',
            (array) ($campaign['audience']['list_ids'] ?? [])
        )));
        if (!$list_ids) return self::validation_error('Selecione ao menos uma lista de destino.');

        return [
            'ok' => true,
            'error' => '',
            'list_ids' => $list_ids,
            'settings' => Kodety_Email_Settings::all(),
        ];
    }

    public static function pause(int $id): void {
        if (self::compare_and_swap_status($id, ['sending'], 'paused')) {
            if (class_exists(Kodety_Email_Marketing::class)) {
                Kodety_Email_Marketing::clear_campaign_worker($id);
            }
        }
    }

    public static function pause_for_delivery_change(int $id): bool {
        $paused = self::compare_and_swap_status($id, ['sending'], 'paused', [
            'stats_json' => wp_json_encode([
                'pause_reason' => 'delivery_configuration_changed',
                'paused_at' => Kodety_Email_Schema::now(),
            ]),
        ]);
        if ($paused && class_exists(Kodety_Email_Marketing::class)) {
            Kodety_Email_Marketing::clear_campaign_worker($id);
        }
        return $paused;
    }

    /**
     * Estado fail-closed criado quando o provedor confirmou a mensagem, mas as
     * duas tentativas de persistir esse ACK falharam. Retomar sem reconciliar a
     * linha pendente poderia entregar o mesmo email novamente.
     *
     * @return array{queue_id:int,provider_message_id:string}|null
     */
    public static function transport_ack_reconciliation(array $campaign): ?array {
        if ((string) ($campaign['status'] ?? '') !== 'paused') return null;
        $stats = json_decode((string) ($campaign['stats_json'] ?? ''), true);
        if (
            !is_array($stats)
            || (string) ($stats['pause_reason'] ?? '') !== 'transport_ack_persistence_failed'
            || empty($stats['requires_manual_reconciliation'])
        ) {
            return null;
        }
        return [
            'queue_id' => absint($stats['queue_id'] ?? 0),
            'provider_message_id' => (string) ($stats['provider_message_id'] ?? ''),
        ];
    }

    /** @return array{ok:bool,error:string} */
    public static function resume(int $id): array {
        $campaign = self::get($id);
        if (!$campaign || (string) $campaign['status'] !== 'paused') {
            return ['ok' => false, 'error' => 'A campanha não está pausada.'];
        }

        $stats = json_decode((string) ($campaign['stats_json'] ?? ''), true);
        if (self::transport_ack_reconciliation($campaign) !== null) {
            return [
                'ok' => false,
                'error' => 'O provedor confirmou uma entrega que o banco não registrou. Reconcilie essa fila como entrega incerta antes de retomar; ela nunca pode ser reenviada automaticamente.',
            ];
        }
        $delivery_changed = is_array($stats)
            && (string) ($stats['pause_reason'] ?? '') === 'delivery_configuration_changed';
        $data = [];
        if ($delivery_changed) {
            $settings = Kodety_Email_Settings::all();
            $data = [
                'delivery_config' => wp_json_encode(Kodety_Email_Settings::campaign_snapshot($settings)),
                'from_name' => (string) $settings['from_name'],
                'from_email' => (string) $settings['from_email'],
                'reply_to' => (string) $settings['reply_to'],
                'stats_json' => null,
            ];
        }

        if (self::compare_and_swap_status($id, ['paused'], 'sending', $data)) {
            if (class_exists(Kodety_Email_Marketing::class)) {
                Kodety_Email_Marketing::schedule_campaign_worker($id);
            }
            return ['ok' => true, 'error' => ''];
        }
        return ['ok' => false, 'error' => 'A campanha mudou enquanto era retomada. Atualize a página.'];
    }

    /**
     * Terminaliza a única entrega já aceita pelo provedor e só depois retoma os
     * demais destinatários. Se a retomada falhar, a campanha permanece pausada,
     * mas a linha já reconciliada continua terminal e nunca volta ao transporte.
     *
     * @return array{ok:bool,error:string}
     */
    public static function reconcile_transport_ack(int $id, int $expected_queue_id): array {
        if ($id <= 0 || $expected_queue_id <= 0) {
            return ['ok' => false, 'error' => 'A referência da entrega incerta é inválida.'];
        }
        $campaign = self::get($id);
        $reconciliation = $campaign ? self::transport_ack_reconciliation($campaign) : null;
        if (
            !$reconciliation
            || (int) $reconciliation['queue_id'] !== $expected_queue_id
        ) {
            return [
                'ok' => false,
                'error' => 'A campanha ou a entrega incerta mudou. Atualize a página antes de reconciliar.',
            ];
        }

        // A fila segura campaign+queue sob lock, valida o motivo exato e é
        // idempotente. Ela nunca retoma a campanha: primeiro tornamos o ACK
        // terminal; só depois liberamos os demais destinatários.
        $reconciled = Kodety_Email_Queue::reconcile_transport_ack_failure(
            $id,
            $expected_queue_id,
        );
        if (empty($reconciled['ok'])) {
            return [
                'ok' => false,
                'error' => (string) (
                    $reconciled['error']
                    ?? 'Não foi possível registrar a entrega incerta. A campanha continua pausada.'
                ),
            ];
        }

        if (!self::compare_and_swap_status($id, ['paused'], 'sending', ['stats_json' => null])) {
            return [
                'ok' => false,
                'error' => 'A entrega incerta já está terminal e não será reenviada, mas a campanha continuou pausada. Atualize a página e tente continuar novamente.',
            ];
        }

        if (class_exists(Kodety_Email_Marketing::class)) {
            Kodety_Email_Marketing::schedule_campaign_worker($id);
        }
        return ['ok' => true, 'error' => ''];
    }

    /**
     * Envia uma cópia para um endereço só, sem tocar na fila. Usa um contato
     * fictício para que as merge tags apareçam preenchidas.
     *
     * @return array{ok:bool,error:string}
     */
    public static function send_test(int $id, string $to, string $expected_revision = ''): array {
        $campaign = self::get($id);
        if (!$campaign) return ['ok' => false, 'error' => 'Campanha não encontrada.'];
        if ((string) $campaign['status'] === 'scheduled') {
            return [
                'ok' => false,
                'error' => 'Cancele o agendamento legado antes de enviar um teste.',
            ];
        }
        if (
            $expected_revision === ''
            || !hash_equals(self::campaign_revision($campaign), $expected_revision)
        ) {
            return [
                'ok' => false,
                'error' => 'A campanha mudou em outra aba. Atualize a página antes de enviar o teste.',
            ];
        }

        $to = Kodety_Email_Schema::normalize_email($to);
        if ($to === '' || !is_email($to)) return ['ok' => false, 'error' => 'Endereço de teste inválido.'];

        $user = wp_get_current_user();
        $preview_contact = [
            'id' => 0,
            'email' => $to,
            'name' => (string) $user->display_name,
            'attributes' => wp_json_encode([]),
        ];

        // Rascunho/falha ainda serão iniciados com a configuração atual; testar
        // com o remetente antigo salvo na criação seria enganoso.
        $settings = in_array((string) $campaign['status'], ['draft', 'failed'], true)
            ? Kodety_Email_Settings::all()
            : Kodety_Email_Settings::for_campaign($campaign);
        $message = Kodety_Email_Renderer::render($campaign, $preview_contact, $settings, true);
        $transport = Kodety_Email_Transport::instance();
        $result = $transport->send([
            'to' => $to,
            'subject' => '[TESTE] ' . $message['subject'],
            'html' => $message['html'],
            'text' => $message['text'],
            'campaign_id' => $id,
            'settings' => $settings,
        ]);
        $transport->close();

        return ['ok' => (bool) $result['ok'], 'error' => (string) $result['error']];
    }

    /**
     * @return array{sent:int,failed:int,skipped:int,opens:int,clicks:int,bounces:int,unsubscribes:int,open_rate:float,click_rate:float}
     */
    public static function report(int $id): array {
        $reports = self::reports([$id]);
        return $reports[$id] ?? self::empty_report();
    }

    /**
     * Relatórios de várias campanhas em três consultas fixas, em vez de duas
     * consultas por card na dashboard.
     *
     * @param int[] $ids
     * @return array<int,array{sent:int,failed:int,skipped:int,opens:int,clicks:int,bounces:int,unsubscribes:int,open_rate:float,click_rate:float}>
     */
    public static function reports(array $ids): array {
        global $wpdb;

        $ids = array_values(array_unique(array_filter(array_map('absint', $ids))));
        if (!$ids) return [];

        $reports = [];
        foreach ($ids as $id) $reports[$id] = self::empty_report();

        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $events = Kodety_Email_Schema::table('events');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT campaign_id, type, COUNT(DISTINCT contact_id) total
             FROM {$events}
             WHERE campaign_id IN ({$placeholders})
             GROUP BY campaign_id, type",
            ...$ids
        ), ARRAY_A);

        foreach (is_array($rows) ? $rows : [] as $row) {
            $campaign_id = (int) $row['campaign_id'];
            $field = match ((string) $row['type']) {
                'sent' => 'event_sent',
                'open' => 'opens',
                'click' => 'clicks',
                'bounce' => 'bounces',
                'unsubscribe' => 'unsubscribes',
                default => '',
            };
            if ($field !== '' && isset($reports[$campaign_id])) {
                $reports[$campaign_id][$field] = (int) $row['total'];
            }
        }

        $queue_rows = $wpdb->get_results($wpdb->prepare(
            'SELECT campaign_id, status, COUNT(*) total FROM ' . Kodety_Email_Schema::table('queue')
                . " WHERE campaign_id IN ({$placeholders}) GROUP BY campaign_id, status",
            ...$ids
        ), ARRAY_A);
        foreach (is_array($queue_rows) ? $queue_rows : [] as $row) {
            $campaign_id = (int) $row['campaign_id'];
            $status = (string) $row['status'];
            if (isset($reports[$campaign_id]) && in_array($status, ['sent', 'failed', 'skipped'], true)) {
                $reports[$campaign_id]['queue_' . $status] = (int) $row['total'];
            }
        }

        $campaign_rows = $wpdb->get_results($wpdb->prepare(
            'SELECT id, stats_json FROM ' . Kodety_Email_Schema::table('campaigns')
                . " WHERE id IN ({$placeholders})",
            ...$ids
        ), ARRAY_A);
        foreach (is_array($campaign_rows) ? $campaign_rows : [] as $row) {
            $campaign_id = (int) $row['id'];
            $stats = json_decode((string) $row['stats_json'], true);
            if (!is_array($stats) || !isset($reports[$campaign_id])) continue;
            $reports[$campaign_id]['stats_sent'] = (int) ($stats['sent'] ?? 0);
            $reports[$campaign_id]['stats_failed'] = (int) ($stats['failed'] ?? 0);
            $reports[$campaign_id]['stats_skipped'] = (int) ($stats['skipped'] ?? 0);
        }

        foreach ($reports as &$report) {
            $report['sent'] = max($report['event_sent'], $report['queue_sent'], $report['stats_sent']);
            $report['failed'] = max($report['queue_failed'], $report['stats_failed']);
            $report['skipped'] = max($report['queue_skipped'], $report['stats_skipped']);
            $report['open_rate'] = $report['sent'] > 0
                ? round($report['opens'] / $report['sent'] * 100, 1)
                : 0.0;
            $report['click_rate'] = $report['sent'] > 0
                ? round($report['clicks'] / $report['sent'] * 100, 1)
                : 0.0;
            foreach ([
                'event_sent',
                'queue_sent',
                'queue_failed',
                'queue_skipped',
                'stats_sent',
                'stats_failed',
                'stats_skipped',
            ] as $internal) {
                unset($report[$internal]);
            }
        }
        unset($report);

        return $reports;
    }

    private static function send_error(string $message): array {
        return ['ok' => false, 'error' => $message, 'queued' => 0];
    }

    private static function validation_error(string $message): array {
        return [
            'ok' => false,
            'error' => $message,
            'list_ids' => [],
            'settings' => [],
        ];
    }

    /**
     * Lê a campanha e sua fonte de conteúdo sob lock.
     *
     * Deve ser chamado dentro de uma transação. Campanhas em andamento têm HTML
     * congelado na própria linha e não dependem mais do template; rascunhos
     * vazios bloqueiam também o template selecionado.
     */
    private static function locked_campaign(int $id): ?array {
        global $wpdb;

        $campaign = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Kodety_Email_Schema::table('campaigns')
                . ' WHERE id = %d FOR UPDATE',
            $id
        ), ARRAY_A);
        if (!is_array($campaign)) return null;

        $campaign['audience'] = json_decode((string) $campaign['audience_json'], true)
            ?: ['list_ids' => []];
        if (trim((string) $campaign['html']) === '' && (int) $campaign['template_id'] > 0) {
            $template = $wpdb->get_row($wpdb->prepare(
                'SELECT * FROM ' . Kodety_Email_Schema::table('templates')
                    . ' WHERE id = %d FOR UPDATE',
                (int) $campaign['template_id']
            ), ARRAY_A);
            if (is_array($template)) {
                $campaign['html'] = (string) $template['html'];
                $campaign['text_body'] = (string) $template['text_body'];
            }
        }

        return $campaign;
    }

    private static function empty_report(): array {
        return [
            'sent' => 0,
            'failed' => 0,
            'skipped' => 0,
            'opens' => 0,
            'clicks' => 0,
            'bounces' => 0,
            'unsubscribes' => 0,
            'open_rate' => 0.0,
            'click_rate' => 0.0,
            'event_sent' => 0,
            'queue_sent' => 0,
            'queue_failed' => 0,
            'queue_skipped' => 0,
            'stats_sent' => 0,
            'stats_failed' => 0,
            'stats_skipped' => 0,
        ];
    }
}
