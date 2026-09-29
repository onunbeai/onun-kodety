<?php
/**
 * Contatos, listas e supressão.
 *
 * A fonte da verdade é uma tabela própria, não wp_users: um lead que só deixou
 * o email num formulário não deve virar usuário do WordPress. O vínculo com a
 * área de membros existe por `wp_user_id`, que é preenchido quando o contato
 * também é um membro.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Contacts {
    /** Limite síncrono; bases maiores devem ser divididas ou importadas em job. */
    private const MAX_SYNC_IMPORT_ROWS = 5000;
    /** Mantém cada statement abaixo dos limites usuais de placeholders/pacote. */
    private const IMPORT_CHUNK_SIZE = 250;
    private const BULK_CHUNK_SIZE = 500;

    // --- Contatos ---------------------------------------------------------

    /**
     * Cria ou atualiza pelo hash do email.
     *
     * Nunca ressuscita um contato descadastrado ou suprimido: se a pessoa
     * pediu para sair, um import de CSV não pode trazê-la de volta.
     */
    public static function upsert(array $data): int {
        global $wpdb;

        $email = Kodety_Email_Schema::normalize_email((string) ($data['email'] ?? ''));
        if ($email === '' || !is_email($email)) return 0;

        $hash = Kodety_Email_Schema::email_hash($email);
        $now = Kodety_Email_Schema::now();
        $existing = self::find_by_email($email);

        $attributes = $data['attributes'] ?? [];
        if ($existing && is_array($attributes)) {
            $previous = json_decode((string) $existing['attributes'], true);
            $attributes = array_merge(is_array($previous) ? $previous : [], $attributes);
        }

        $row = [
            'email' => $email,
            'email_hash' => $hash,
            'name' => sanitize_text_field((string) ($data['name'] ?? ($existing['name'] ?? ''))),
            'wp_user_id' => (int) ($data['wp_user_id'] ?? ($existing['wp_user_id'] ?? 0)),
            'attributes' => wp_json_encode(is_array($attributes) ? $attributes : []),
            'updated_at' => $now,
        ];

        if ($existing) {
            // Upsert atualiza identidade e atributos, nunca consentimento. Toda
            // transição para subscribed passa por resubscribe(), que remove
            // somente opt-out voluntário e deixa uma trilha auditável.
            $wpdb->update(Kodety_Email_Schema::table('contacts'), $row, ['id' => (int) $existing['id']]);
            return (int) $existing['id'];
        }

        $status = (string) ($data['status'] ?? 'pending');
        $row['status'] = in_array($status, Kodety_Email_Schema::CONTACT_STATUSES, true) ? $status : 'pending';
        $row['consent_source'] = sanitize_key((string) ($data['consent_source'] ?? 'manual'));
        $row['consent_at'] = $row['status'] === 'subscribed' ? $now : null;
        $row['ip_hash'] = (string) ($data['ip_hash'] ?? '');
        $row['locale'] = sanitize_text_field((string) ($data['locale'] ?? ''));
        $row['created_at'] = $now;

        // Um endereço já suprimido conserva a razão real; opt-out voluntário
        // não pode reaparecer como "bounce" nem ser apagado por reimportação.
        $suppression = self::suppression($email);
        if ($suppression) {
            $row['status'] = self::status_for_suppression((string) $suppression['reason']);
            $row['consent_at'] = null;
        }

        $wpdb->insert(Kodety_Email_Schema::table('contacts'), $row);
        $contact_id = (int) $wpdb->insert_id;
        if ($contact_id > 0) {
            $action = match ((string) $row['status']) {
                'subscribed' => 'subscribe',
                'unsubscribed' => 'unsubscribe',
                'bounced' => 'bounce',
                'complained' => 'complaint',
                default => 'import_pending',
            };
            self::audit_consent(
                $contact_id,
                $email,
                $action,
                (string) $row['consent_source']
            );
        }
        return $contact_id;
    }

    public static function find_by_email(string $email): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Kodety_Email_Schema::table('contacts') . ' WHERE email_hash = %s',
            Kodety_Email_Schema::email_hash($email)
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public static function get(int $id): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Kodety_Email_Schema::table('contacts') . ' WHERE id = %d',
            $id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /**
     * @return array{items:array,total:int}
     */
    public static function paginate(array $args = []): array {
        global $wpdb;

        $table = Kodety_Email_Schema::table('contacts');
        $where = ['1=1'];
        $params = [];

        $search = trim((string) ($args['search'] ?? ''));
        if ($search !== '') {
            $where[] = '(email LIKE %s OR name LIKE %s)';
            $like = '%' . $wpdb->esc_like($search) . '%';
            $params[] = $like;
            $params[] = $like;
        }

        $status = (string) ($args['status'] ?? '');
        if (in_array($status, Kodety_Email_Schema::CONTACT_STATUSES, true)) {
            $where[] = 'status = %s';
            $params[] = $status;
        }

        $list_id = (int) ($args['list_id'] ?? 0);
        $join = '';
        if ($list_id > 0) {
            $join = ' INNER JOIN ' . Kodety_Email_Schema::table('list_contacts')
                . ' lc ON lc.contact_id = c.id AND lc.list_id = %d';
            array_unshift($params, $list_id);
        }

        $clause = implode(' AND ', $where);
        $per_page = max(1, min(200, (int) ($args['per_page'] ?? 25)));
        $page = max(1, (int) ($args['page'] ?? 1));
        $offset = ($page - 1) * $per_page;

        if (array_key_exists('_known_total', $args)) {
            $total = max(0, (int) $args['_known_total']);
        } else {
            $total_sql = "SELECT COUNT(*) FROM {$table} c{$join} WHERE {$clause}";
            $total = (int) $wpdb->get_var($params ? $wpdb->prepare($total_sql, ...$params) : $total_sql);
        }

        $items_sql = "SELECT c.* FROM {$table} c{$join} WHERE {$clause} ORDER BY c.created_at DESC LIMIT %d OFFSET %d";
        $items = $wpdb->get_results(
            $wpdb->prepare($items_sql, ...array_merge($params, [$per_page, $offset])),
            ARRAY_A
        );

        return ['items' => is_array($items) ? $items : [], 'total' => $total];
    }

    /** @return array<string,int> Contagem por status. */
    public static function status_counts(): array {
        global $wpdb;
        $counts = array_fill_keys(Kodety_Email_Schema::CONTACT_STATUSES, 0);
        $rows = $wpdb->get_results(
            'SELECT status, COUNT(*) total FROM ' . Kodety_Email_Schema::table('contacts') . ' GROUP BY status',
            ARRAY_A
        );
        foreach (is_array($rows) ? $rows : [] as $row) {
            $counts[(string) $row['status']] = (int) $row['total'];
        }
        return $counts;
    }

    public static function set_status(int $contact_id, string $status, string $source = 'system'): void {
        if (!in_array($status, Kodety_Email_Schema::CONTACT_STATUSES, true)) return;

        if ($status === 'subscribed') {
            self::resubscribe($contact_id, $source);
            return;
        }
        if ($status === 'unsubscribed') {
            self::unsubscribe($contact_id, 0, $source);
            return;
        }

        $contact = self::get($contact_id);
        if (!$contact) return;
        if ($status === 'bounced' || $status === 'complained') {
            self::suppress(
                (string) $contact['email'],
                $status === 'complained' ? 'complaint' : 'bounce',
                0,
                $source
            );
            return;
        }

        global $wpdb;
        $wpdb->update(Kodety_Email_Schema::table('contacts'), [
            'status' => 'pending',
            'updated_at' => Kodety_Email_Schema::now(),
        ], ['id' => $contact_id]);
    }

    // --- Listas -----------------------------------------------------------

    public static function create_list(string $name, string $description = '', string $source = 'manual'): int {
        global $wpdb;

        $name = sanitize_text_field($name);
        if ($name === '') return 0;

        $slug = self::unique_list_slug(sanitize_title($name));
        $now = Kodety_Email_Schema::now();

        $wpdb->insert(Kodety_Email_Schema::table('lists'), [
            'name' => $name,
            'slug' => $slug,
            'description' => sanitize_textarea_field($description),
            'source' => sanitize_key($source),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return (int) $wpdb->insert_id;
    }

    private static function unique_list_slug(string $slug): string {
        global $wpdb;
        $slug = $slug !== '' ? $slug : 'lista';
        $table = Kodety_Email_Schema::table('lists');
        $candidate = $slug;
        $suffix = 2;

        while ((int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE slug = %s", $candidate)) > 0) {
            $candidate = $slug . '-' . $suffix;
            $suffix++;
        }
        return $candidate;
    }

    /**
     * Exclui uma lista sem deixar campanhas mutáveis apontando para um público
     * inexistente.
     *
     * O lock nas campanhas torna a verificação e a remoção uma única decisão:
     * um rascunho não pode trocar a audiência no meio da exclusão e uma lista
     * usada por campanha agendada nunca desaparece.
     *
     * @return array{ok:bool,reason:string,campaign_count:int}
     */
    public static function delete_list(int $list_id): array {
        global $wpdb;

        if ($list_id <= 0) {
            return ['ok' => false, 'reason' => 'not_found', 'campaign_count' => 0];
        }

        $lists = Kodety_Email_Schema::table('lists');
        $pivot = Kodety_Email_Schema::table('list_contacts');
        $campaigns = Kodety_Email_Schema::table('campaigns');

        if ($wpdb->query('START TRANSACTION') === false) {
            return ['ok' => false, 'reason' => 'database', 'campaign_count' => 0];
        }

        // Bloqueia todas as campanhas cujo público ainda pode depender de uma
        // lista. O decode em PHP evita falso positivo de LIKE (1 versus 10) e
        // funciona também com instalações sem funções JSON no banco.
        $rows = $wpdb->get_results(
            "SELECT id, audience_json
             FROM {$campaigns}
             WHERE status IN ('draft', 'failed', 'scheduled')
             FOR UPDATE",
            ARRAY_A
        );
        if (!is_array($rows)) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'database', 'campaign_count' => 0];
        }

        // A ordem campaign -> list acompanha o salvamento transacional de
        // rascunho e evita inversão de locks entre edição e exclusão.
        $list = $wpdb->get_row($wpdb->prepare(
            "SELECT id FROM {$lists} WHERE id = %d FOR UPDATE",
            $list_id
        ), ARRAY_A);
        if (!is_array($list)) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'not_found', 'campaign_count' => 0];
        }

        $references = self::count_list_references($rows, $list_id);
        if ($references > 0) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'referenced', 'campaign_count' => $references];
        }

        // Os contatos permanecem: apagar a lista não pode apagar a base.
        $removed_memberships = $wpdb->query($wpdb->prepare(
            "DELETE FROM {$pivot} WHERE list_id = %d",
            $list_id
        ));
        $removed_list = $wpdb->delete($lists, ['id' => $list_id]);
        if ($removed_memberships === false || $removed_list !== 1 || $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return ['ok' => false, 'reason' => 'database', 'campaign_count' => 0];
        }

        return ['ok' => true, 'reason' => '', 'campaign_count' => 0];
    }

    /** @return array<int,array> Listas com a contagem de inscritos ativos. */
    public static function lists(bool $include_campaign_references = false): array {
        global $wpdb;

        $lists = Kodety_Email_Schema::table('lists');
        $pivot = Kodety_Email_Schema::table('list_contacts');
        $contacts = Kodety_Email_Schema::table('contacts');

        $rows = $wpdb->get_results(
            "SELECT l.*, COALESCE(counts.total, 0) subscriber_count
             FROM {$lists} l
             LEFT JOIN (
                 SELECT lc.list_id, COUNT(*) total
                 FROM {$pivot} lc
                 INNER JOIN {$contacts} c ON c.id = lc.contact_id AND c.status = 'subscribed'
                 GROUP BY lc.list_id
             ) counts ON counts.list_id = l.id
             ORDER BY l.created_at DESC",
            ARRAY_A
        );

        if (!is_array($rows)) return [];

        if ($include_campaign_references) {
            $reference_counts = self::list_reference_counts();
            foreach ($rows as &$row) {
                $row['campaign_reference_count'] = $reference_counts[(int) $row['id']] ?? 0;
            }
            unset($row);
        }

        return $rows;
    }

    /**
     * @param array<int,array> $campaign_rows
     */
    private static function count_list_references(array $campaign_rows, int $list_id): int {
        $count = 0;
        foreach ($campaign_rows as $campaign) {
            $audience = json_decode((string) ($campaign['audience_json'] ?? ''), true);
            $list_ids = array_values(array_unique(array_filter(array_map(
                'absint',
                (array) ($audience['list_ids'] ?? [])
            ))));
            if (in_array($list_id, $list_ids, true)) $count++;
        }
        return $count;
    }

    /** @return array<int,int> */
    private static function list_reference_counts(): array {
        global $wpdb;

        $rows = $wpdb->get_results(
            'SELECT audience_json FROM ' . Kodety_Email_Schema::table('campaigns')
                . " WHERE status IN ('draft', 'failed', 'scheduled')",
            ARRAY_A
        );
        $counts = [];
        foreach (is_array($rows) ? $rows : [] as $campaign) {
            $audience = json_decode((string) ($campaign['audience_json'] ?? ''), true);
            $list_ids = array_values(array_unique(array_filter(array_map(
                'absint',
                (array) ($audience['list_ids'] ?? [])
            ))));
            foreach ($list_ids as $list_id) {
                $counts[$list_id] = ($counts[$list_id] ?? 0) + 1;
            }
        }
        return $counts;
    }

    public static function get_list(int $list_id): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Kodety_Email_Schema::table('lists') . ' WHERE id = %d',
            $list_id
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    /**
     * Nomes das listas de vários contatos, numa consulta só.
     *
     * Sem isso a tela não mostrava onde o contato já está — e adicionar em
     * massa viraria adivinhação. Em lote porque uma consulta por linha faria
     * a listagem custar dezenas de idas ao banco.
     *
     * @param int[] $contact_ids
     * @return array<int,string[]>
     */
    public static function lists_for_contacts(array $contact_ids): array {
        global $wpdb;

        $ids = self::sanitize_ids($contact_ids);
        if (!$ids) return [];

        $lists = Kodety_Email_Schema::table('lists');
        $pivot = Kodety_Email_Schema::table('list_contacts');
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT lc.contact_id, l.name FROM {$lists} l
             INNER JOIN {$pivot} lc ON lc.list_id = l.id
             WHERE lc.contact_id IN ({$placeholders})
             ORDER BY l.name",
            ...$ids
        ), ARRAY_A);

        $grouped = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $grouped[(int) $row['contact_id']][] = (string) $row['name'];
        }
        return $grouped;
    }

    public static function add_to_list(int $list_id, int $contact_id, string $source = 'manual'): bool {
        global $wpdb;
        if ($list_id <= 0 || $contact_id <= 0) return false;

        if ($wpdb->query('START TRANSACTION') === false) return false;
        $list_exists = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT id FROM ' . Kodety_Email_Schema::table('lists')
                . ' WHERE id = %d FOR UPDATE',
            $list_id
        )) === $list_id;
        if (!$list_exists) {
            $wpdb->query('ROLLBACK');
            return false;
        }

        // INSERT IGNORE porque a PK composta já garante unicidade; reimportar
        // o mesmo CSV não pode explodir em erro.
        $table = Kodety_Email_Schema::table('list_contacts');
        $inserted = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO {$table} (list_id, contact_id, source, added_at) VALUES (%d, %d, %s, %s)",
            $list_id,
            $contact_id,
            sanitize_key($source),
            Kodety_Email_Schema::now()
        ));
        if ($inserted === false || $wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return false;
        }
        return true;
    }

    public static function remove_from_list(int $list_id, int $contact_id): void {
        global $wpdb;
        $wpdb->delete(Kodety_Email_Schema::table('list_contacts'), [
            'list_id' => $list_id,
            'contact_id' => $contact_id,
        ]);
    }

    // --- Ações em lote ----------------------------------------------------

    /**
     * Ids que correspondem ao filtro atual, sem paginação.
     *
     * É o que permite "selecionar todos os 4.312 contatos deste filtro" sem
     * marcar caixinha por caixinha nem carregar tudo na tela.
     *
     * @return int[]
     */
    public static function ids_for_query(array $args): array {
        // Reusa a mesma montagem de filtro da listagem para que a seleção em
        // massa nunca divirja do que está sendo exibido.
        $args['page'] = 1;
        $args['per_page'] = 200;

        $limit = self::bulk_selection_limit();

        $ids = [];
        $total = null;
        do {
            if ($total !== null) $args['_known_total'] = $total;
            $result = self::paginate($args);
            $total ??= (int) $result['total'];
            foreach ($result['items'] as $item) $ids[] = (int) $item['id'];
            $args['page']++;
        } while (count($ids) < (int) $result['total'] && count($ids) < $limit && !empty($result['items']));

        return array_slice($ids, 0, $limit);
    }

    public static function bulk_selection_limit(): int {
        return max(1, min(50000, (int) apply_filters('kodety_email_bulk_selection_limit', 5000)));
    }

    /** @param int[] $contact_ids */
    public static function add_many_to_list(int $list_id, array $contact_ids, string $source = 'manual'): int {
        global $wpdb;

        $ids = self::sanitize_ids($contact_ids);
        if ($list_id <= 0 || !$ids) return 0;
        if ($wpdb->query('START TRANSACTION') === false) return 0;
        $list_exists = (int) $wpdb->get_var($wpdb->prepare(
            'SELECT id FROM ' . Kodety_Email_Schema::table('lists')
                . ' WHERE id = %d FOR UPDATE',
            $list_id
        )) === $list_id;
        if (!$list_exists) {
            $wpdb->query('ROLLBACK');
            return 0;
        }

        $table = Kodety_Email_Schema::table('list_contacts');
        $now = Kodety_Email_Schema::now();
        $source = sanitize_key($source);

        $affected = 0;
        foreach (array_chunk($ids, self::BULK_CHUNK_SIZE) as $chunk) {
            $values = [];
            $params = [];
            foreach ($chunk as $contact_id) {
                $values[] = '(%d, %d, %s, %s)';
                array_push($params, $list_id, $contact_id, $source, $now);
            }

            $sql = "INSERT IGNORE INTO {$table} (list_id, contact_id, source, added_at) VALUES "
                . implode(',', $values);
            if ($wpdb->query($wpdb->prepare($sql, ...$params)) === false) {
                $wpdb->query('ROLLBACK');
                return 0;
            }
            $affected += max(0, (int) $wpdb->rows_affected);
        }
        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            return 0;
        }
        return $affected;
    }

    /** @param int[] $contact_ids */
    public static function remove_many_from_list(int $list_id, array $contact_ids): int {
        global $wpdb;

        $ids = self::sanitize_ids($contact_ids);
        if ($list_id <= 0 || !$ids) return 0;

        $table = Kodety_Email_Schema::table('list_contacts');
        $affected = 0;
        foreach (array_chunk($ids, self::BULK_CHUNK_SIZE) as $chunk) {
            $placeholders = implode(',', array_fill(0, count($chunk), '%d'));
            $wpdb->query($wpdb->prepare(
                "DELETE FROM {$table} WHERE list_id = %d AND contact_id IN ({$placeholders})",
                $list_id,
                ...$chunk
            ));
            $affected += max(0, (int) $wpdb->rows_affected);
        }
        return $affected;
    }

    /** @param int[] $contact_ids */
    public static function set_status_many(array $contact_ids, string $status, string $source = 'admin_bulk'): int {
        $ids = self::sanitize_ids($contact_ids);
        if (!$ids || !in_array($status, Kodety_Email_Schema::CONTACT_STATUSES, true)) return 0;

        // Ação em massa só confirma contatos ainda pendentes. Opt-outs,
        // bounces e complaints exigem revisão individual com evidência.
        if ($status === 'subscribed') {
            return self::subscribe_pending_many($ids, $source);
        }
        if ($status === 'unsubscribed') {
            return self::unsubscribe_many($ids, $source);
        }

        // Transições que afetam consentimento não podem usar um UPDATE cego:
        // cada endereço precisa atualizar a suppression e deixar seu evento.
        if ($status !== 'pending') {
            $updated = 0;
            foreach ($ids as $contact_id) {
                $before = self::get($contact_id);
                if (!$before) continue;
                self::set_status($contact_id, $status, $source);
                $after = self::get($contact_id);
                if ($after && (string) $after['status'] === $status) $updated++;
            }
            return $updated;
        }

        global $wpdb;
        $table = Kodety_Email_Schema::table('contacts');
        $now = Kodety_Email_Schema::now();
        $updated = 0;
        foreach (array_chunk($ids, self::BULK_CHUNK_SIZE) as $chunk) {
            $placeholders = implode(',', array_fill(0, count($chunk), '%d'));
            $wpdb->query($wpdb->prepare(
                "UPDATE {$table} SET status = 'pending', updated_at = %s WHERE id IN ({$placeholders})",
                ...array_merge([$now], $chunk)
            ));
            $updated += max(0, (int) $wpdb->rows_affected);
        }
        return $updated;
    }

    /**
     * Confirma em lote somente quem está pending e não possui suppression.
     * Cada chunk é atômico e grava os eventos numa única inserção.
     *
     * @param int[] $ids
     */
    private static function subscribe_pending_many(array $ids, string $source): int {
        global $wpdb;

        $contacts_table = Kodety_Email_Schema::table('contacts');
        $suppressions = Kodety_Email_Schema::table('suppressions');
        $events = Kodety_Email_Schema::table('consent_events');
        $source = sanitize_key($source);
        $actor = function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
        $updated = 0;

        foreach (array_chunk($ids, self::BULK_CHUNK_SIZE) as $chunk) {
            $placeholders = implode(',', array_fill(0, count($chunk), '%d'));
            $wpdb->query('START TRANSACTION');
            $eligible = $wpdb->get_results($wpdb->prepare(
                "SELECT c.id, c.email_hash
                 FROM {$contacts_table} c
                 WHERE c.id IN ({$placeholders})
                   AND c.status = 'pending'
                   AND NOT EXISTS (
                       SELECT 1 FROM {$suppressions} s WHERE s.email_hash = c.email_hash
                   )
                 FOR UPDATE",
                ...$chunk
            ), ARRAY_A);

            if (!is_array($eligible) || !$eligible) {
                $wpdb->query('COMMIT');
                continue;
            }

            $eligible_ids = array_map(static fn(array $row): int => (int) $row['id'], $eligible);
            $eligible_placeholders = implode(',', array_fill(0, count($eligible_ids), '%d'));
            $now = Kodety_Email_Schema::now();
            $changed = $wpdb->query($wpdb->prepare(
                "UPDATE {$contacts_table}
                 SET status = 'subscribed', consent_source = %s, consent_at = %s,
                     unsubscribed_at = NULL, updated_at = %s
                 WHERE status = 'pending' AND id IN ({$eligible_placeholders})",
                ...array_merge([$source, $now, $now], $eligible_ids)
            ));
            if ($changed === false) {
                $wpdb->query('ROLLBACK');
                continue;
            }

            $values = [];
            $params = [];
            foreach ($eligible as $row) {
                $values[] = '(%d, %s, %s, %s, %d, 0, %s, %s)';
                array_push(
                    $params,
                    (int) $row['id'],
                    (string) $row['email_hash'],
                    'resubscribe',
                    $source,
                    $actor,
                    'Confirmação explícita em lote de contato pendente',
                    $now
                );
            }
            $inserted = $wpdb->query($wpdb->prepare(
                "INSERT INTO {$events}
                    (contact_id, email_hash, action, source, actor_user_id, campaign_id, detail, occurred_at)
                 VALUES " . implode(',', $values),
                ...$params
            ));
            if ($inserted === false || $wpdb->query('COMMIT') === false) {
                $wpdb->query('ROLLBACK');
                continue;
            }
            $updated += (int) $changed;
        }

        return $updated;
    }

    /** @param int[] $ids */
    private static function unsubscribe_many(array $ids, string $source): int {
        global $wpdb;

        $contacts_table = Kodety_Email_Schema::table('contacts');
        $suppressions = Kodety_Email_Schema::table('suppressions');
        $events = Kodety_Email_Schema::table('consent_events');
        $source = sanitize_key($source);
        $actor = function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
        $processed = 0;

        foreach (array_chunk($ids, self::BULK_CHUNK_SIZE) as $chunk) {
            $placeholders = implode(',', array_fill(0, count($chunk), '%d'));
            $wpdb->query('START TRANSACTION');
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT c.id, c.email, c.email_hash, s.reason suppression_reason
                 FROM {$contacts_table} c
                 LEFT JOIN {$suppressions} s ON s.email_hash = c.email_hash
                 WHERE c.id IN ({$placeholders})
                 FOR UPDATE",
                ...$chunk
            ), ARRAY_A);
            if (!is_array($rows) || !$rows) {
                $wpdb->query('COMMIT');
                continue;
            }

            $now = Kodety_Email_Schema::now();
            $values = [];
            $params = [];
            foreach ($rows as $row) {
                $values[] = '(%s, %s, %s, 0, %s, %s)';
                array_push(
                    $params,
                    (string) $row['email_hash'],
                    (string) $row['email'],
                    'unsubscribe',
                    mb_substr($source, 0, 500),
                    $now
                );
            }
            $inserted = $wpdb->query($wpdb->prepare(
                "INSERT IGNORE INTO {$suppressions}
                    (email_hash, email, reason, campaign_id, detail, created_at)
                 VALUES " . implode(',', $values),
                ...$params
            ));
            if ($inserted === false) {
                $wpdb->query('ROLLBACK');
                continue;
            }

            $groups = ['unsubscribed' => [], 'bounced' => [], 'complained' => []];
            foreach ($rows as $row) {
                $status = self::status_for_suppression((string) ($row['suppression_reason'] ?: 'unsubscribe'));
                $groups[$status][] = (int) $row['id'];
            }
            foreach ($groups as $status => $group_ids) {
                if (!$group_ids) continue;
                $group_placeholders = implode(',', array_fill(0, count($group_ids), '%d'));
                $timestamp = match ($status) {
                    'complained' => 'complaint_at',
                    'bounced' => 'bounced_at',
                    default => 'unsubscribed_at',
                };
                $changed = $wpdb->query($wpdb->prepare(
                    "UPDATE {$contacts_table}
                     SET status = %s, {$timestamp} = %s, updated_at = %s
                     WHERE id IN ({$group_placeholders})",
                    ...array_merge([$status, $now, $now], $group_ids)
                ));
                if ($changed === false) {
                    $wpdb->query('ROLLBACK');
                    continue 2;
                }
            }

            $event_values = [];
            $event_params = [];
            foreach ($rows as $row) {
                $event_values[] = '(%d, %s, %s, %s, %d, 0, %s, %s)';
                array_push(
                    $event_params,
                    (int) $row['id'],
                    (string) $row['email_hash'],
                    'unsubscribe',
                    $source,
                    $actor,
                    'Descadastro explícito em lote',
                    $now
                );
            }
            $audited = $wpdb->query($wpdb->prepare(
                "INSERT INTO {$events}
                    (contact_id, email_hash, action, source, actor_user_id, campaign_id, detail, occurred_at)
                 VALUES " . implode(',', $event_values),
                ...$event_params
            ));
            if ($audited === false || $wpdb->query('COMMIT') === false) {
                $wpdb->query('ROLLBACK');
                continue;
            }
            $processed += count($rows);
        }

        return $processed;
    }

    /**
     * Apaga contatos de vez. A supressão não é tocada de propósito: apagar um
     * endereço que sofreu bounce não pode reabri-lo para envio futuro.
     *
     * @param int[] $contact_ids
     */
    public static function delete_many(array $contact_ids): int {
        global $wpdb;

        $ids = self::sanitize_ids($contact_ids);
        if (!$ids) return 0;
        if (count($ids) > self::BULK_CHUNK_SIZE) {
            $deleted = 0;
            foreach (array_chunk($ids, self::BULK_CHUNK_SIZE) as $chunk) {
                $deleted += self::delete_many($chunk);
            }
            return $deleted;
        }

        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $contacts = $wpdb->get_results($wpdb->prepare(
            'SELECT id, email, status FROM ' . Kodety_Email_Schema::table('contacts')
                . " WHERE id IN ({$placeholders})",
            ...$ids
        ), ARRAY_A);

        foreach (is_array($contacts) ? $contacts : [] as $contact) {
            $reason = match ((string) $contact['status']) {
                'unsubscribed' => 'unsubscribe',
                'complained' => 'complaint',
                'bounced' => 'bounce',
                default => '',
            };
            if ($reason !== '') {
                self::persist_suppression((string) $contact['email'], $reason, 0, 'contact_deleted');
                // O hash basta para bloquear uma reimportação futura; o email
                // em claro não precisa sobreviver ao pedido de exclusão.
                $wpdb->update(Kodety_Email_Schema::table('suppressions'), [
                    'email' => '',
                ], [
                    'email_hash' => Kodety_Email_Schema::email_hash((string) $contact['email']),
                ]);
            }
            self::audit_consent(
                (int) $contact['id'],
                (string) $contact['email'],
                'delete_contact',
                'admin'
            );
        }

        $wpdb->query($wpdb->prepare(
            'DELETE FROM ' . Kodety_Email_Schema::table('list_contacts') . " WHERE contact_id IN ({$placeholders})",
            ...$ids
        ));
        // A fila não tem FK, então removemos o dado pessoal e impedimos que
        // um item ainda pendente tente enviar após a exclusão do contato.
        $wpdb->query($wpdb->prepare(
            'UPDATE ' . Kodety_Email_Schema::table('queue')
                . " SET email = '', error = IF(status = 'pending', 'Contato removido', error),"
                . " status = IF(status = 'pending', 'skipped', status)"
                . " WHERE contact_id IN ({$placeholders})",
            ...$ids
        ));
        // Preserva os agregados e COUNT(DISTINCT contact_id) com um surrogate
        // irreversível por campanha. URL pode conter query identificável, e
        // UA/IP hash permitem correlação; todos são apagados antes do contato.
        // O offset mantém o surrogate longe da faixa de ids reais.
        $event_anonymization_salt = wp_salt('kodety_email_event_deletion');
        $wpdb->query($wpdb->prepare(
            'UPDATE ' . Kodety_Email_Schema::table('events')
                . ' SET contact_id = 1152921504606846976'
                . ' + CONV(SUBSTRING(SHA2(CONCAT(%s, %s, campaign_id, %s, contact_id), 256), 1, 15), 16, 10),'
                . " url = '', ip_hash = '', user_agent = ''"
                . " WHERE contact_id IN ({$placeholders})",
            ...array_merge([$event_anonymization_salt, '|', '|'], $ids)
        ));
        // A trilha legal conserva o hash do endereço e a ação, mas deixa de
        // referenciar um id interno já excluído.
        $wpdb->query($wpdb->prepare(
            'UPDATE ' . Kodety_Email_Schema::table('consent_events')
                . " SET contact_id = 0 WHERE contact_id IN ({$placeholders})",
            ...$ids
        ));
        $wpdb->query($wpdb->prepare(
            'DELETE FROM ' . Kodety_Email_Schema::table('contacts') . " WHERE id IN ({$placeholders})",
            ...$ids
        ));
        return (int) $wpdb->rows_affected;
    }

    /** @return int[] */
    private static function sanitize_ids(array $ids): array {
        return array_values(array_unique(array_filter(array_map('absint', $ids))));
    }

    // --- Importação -------------------------------------------------------

    /**
     * Importa CSV com cabeçalho. Reconhece colunas `email`, `nome`/`name` e
     * trata todo o resto como atributo livre, utilizável em merge tag.
     *
     * @return array{imported:int,updated:int,skipped:int,invalid:int,failed:int,limited:int}
     */
    public static function import_csv(
        string $csv,
        int $list_id,
        string $source = 'import',
        bool $consent_confirmed = false
    ): array {
        $handle = fopen('php://temp', 'r+');
        if ($handle === false) return self::empty_import_result();

        fwrite($handle, $csv);
        rewind($handle);
        $result = self::import_csv_handle($handle, $list_id, $source, $consent_confirmed);
        fclose($handle);
        return $result;
    }

    /**
     * Importa diretamente do arquivo temporário do upload, sem manter uma
     * segunda cópia integral do CSV na memória.
     *
     * @return array{imported:int,updated:int,skipped:int,invalid:int,failed:int,limited:int}
     */
    public static function import_csv_file(
        string $path,
        int $list_id,
        string $source = 'import',
        bool $consent_confirmed = false
    ): array {
        if ($path === '' || !is_readable($path)) return self::empty_import_result();
        $handle = fopen($path, 'rb');
        if ($handle === false) return self::empty_import_result();

        $result = self::import_csv_handle($handle, $list_id, $source, $consent_confirmed);
        fclose($handle);
        return $result;
    }

    /**
     * @param resource $handle
     * @return array{imported:int,updated:int,skipped:int,invalid:int,failed:int,limited:int}
     */
    private static function import_csv_handle(
        $handle,
        int $list_id,
        string $source,
        bool $consent_confirmed
    ): array {
        $result = self::empty_import_result();
        $header = fgetcsv($handle, null, ',', '"', '');
        if (!is_array($header)) {
            return $result;
        }

        $header = array_map(
            static fn($column): string => strtolower(trim((string) $column)),
            $header
        );
        $email_index = self::column_index($header, ['email', 'e-mail', 'endereco', 'endereço']);
        $name_index = self::column_index($header, ['nome', 'name', 'first_name', 'nome completo']);

        if ($email_index === null) {
            return $result;
        }

        $processed = 0;
        $chunk = [];
        while (($row = fgetcsv($handle, null, ',', '"', '')) !== false) {
            if (!is_array($row)) continue;
            if ($processed >= self::MAX_SYNC_IMPORT_ROWS) {
                $result['limited'] = 1;
                break;
            }
            $processed++;

            $email = Kodety_Email_Schema::normalize_email((string) ($row[$email_index] ?? ''));
            if ($email === '' || !is_email($email)) {
                $result['invalid']++;
                continue;
            }

            $attributes = [];
            foreach ($header as $index => $column) {
                if ($index === $email_index || $index === $name_index || $column === '') continue;
                $value = trim((string) ($row[$index] ?? ''));
                if ($value !== '') $attributes[sanitize_key($column)] = sanitize_text_field($value);
            }

            $chunk[] = [
                'email' => $email,
                'name' => $name_index !== null ? (string) ($row[$name_index] ?? '') : '',
                'attributes' => $attributes,
            ];

            if (count($chunk) >= self::IMPORT_CHUNK_SIZE) {
                self::merge_import_result(
                    $result,
                    self::import_csv_chunk($chunk, $list_id, $source, $consent_confirmed)
                );
                $chunk = [];
            }
        }

        if ($chunk) {
            self::merge_import_result(
                $result,
                self::import_csv_chunk($chunk, $list_id, $source, $consent_confirmed)
            );
        }

        return $result;
    }

    /**
     * Persiste um checkpoint do CSV com um número constante de consultas.
     *
     * Para 5.000 linhas são no máximo 20 chunks, não dezenas de milhares de
     * round-trips. Cada chunk confirma contatos, vínculos de lista e auditoria
     * junto; em falha ele é revertido e o próximo checkpoint pode continuar.
     *
     * @param array<int,array{email:string,name:string,attributes:array}> $rows
     * @return array{imported:int,updated:int,skipped:int,invalid:int,failed:int,limited:int}
     */
    private static function import_csv_chunk(
        array $rows,
        int $list_id,
        string $source,
        bool $consent_confirmed
    ): array {
        global $wpdb;

        $result = self::empty_import_result();
        if (!$rows) return $result;

        // Duplicatas dentro do mesmo checkpoint são combinadas na ordem do
        // arquivo. A contagem ainda representa todas as linhas processadas.
        $grouped = [];
        foreach ($rows as $row) {
            $email = (string) $row['email'];
            $hash = Kodety_Email_Schema::email_hash($email);
            if (!isset($grouped[$hash])) {
                $grouped[$hash] = [
                    'email' => $email,
                    'name' => '',
                    'attributes' => [],
                    'occurrences' => 0,
                ];
            }
            $grouped[$hash]['occurrences']++;
            $name = sanitize_text_field((string) $row['name']);
            if ($name !== '') $grouped[$hash]['name'] = $name;
            $grouped[$hash]['attributes'] = array_merge(
                $grouped[$hash]['attributes'],
                is_array($row['attributes']) ? $row['attributes'] : []
            );
        }

        $row_count = array_sum(array_map(
            static fn(array $row): int => (int) $row['occurrences'],
            $grouped
        ));
        if ($wpdb->query('START TRANSACTION') === false) {
            $result['failed'] = $row_count;
            return $result;
        }

        // O vínculo não tem FK física. Manter a lista bloqueada até o COMMIT
        // impede que uma exclusão concorrente deixe pivôs órfãos.
        if ($list_id > 0) {
            $locked_list = (int) $wpdb->get_var($wpdb->prepare(
                'SELECT id FROM ' . Kodety_Email_Schema::table('lists')
                    . ' WHERE id = %d FOR UPDATE',
                $list_id
            ));
            if ($locked_list !== $list_id) {
                $wpdb->query('ROLLBACK');
                $result['failed'] = $row_count;
                return $result;
            }
        }

        $hashes = array_keys($grouped);
        $placeholders = implode(',', array_fill(0, count($hashes), '%s'));
        $suppressions_table = Kodety_Email_Schema::table('suppressions');
        $contacts_table = Kodety_Email_Schema::table('contacts');

        // Ordem suppression -> contact acompanha o fluxo de unsubscribe e
        // reduz o risco de deadlock com uma saída ocorrendo durante o import.
        $suppressed_rows = $wpdb->get_results($wpdb->prepare(
            "SELECT email_hash FROM {$suppressions_table}
             WHERE email_hash IN ({$placeholders})
             FOR UPDATE",
            ...$hashes
        ), ARRAY_A);
        $existing_rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, email_hash, name, status, attributes
             FROM {$contacts_table}
             WHERE email_hash IN ({$placeholders})
             FOR UPDATE",
            ...$hashes
        ), ARRAY_A);
        if (!is_array($suppressed_rows) || !is_array($existing_rows)) {
            $wpdb->query('ROLLBACK');
            $result['failed'] = $row_count;
            return $result;
        }

        $suppressed = [];
        foreach ($suppressed_rows as $row) {
            $suppressed[(string) $row['email_hash']] = true;
        }
        $existing = [];
        foreach ($existing_rows as $row) {
            $existing[(string) $row['email_hash']] = $row;
        }

        foreach (array_keys($grouped) as $hash) {
            if (!isset($suppressed[$hash])) continue;
            $result['skipped'] += (int) $grouped[$hash]['occurrences'];
            unset($grouped[$hash]);
        }
        if (!$grouped) {
            if ($wpdb->query('COMMIT') === false) $wpdb->query('ROLLBACK');
            return $result;
        }

        $now = Kodety_Email_Schema::now();
        $status = $consent_confirmed ? 'subscribed' : 'pending';
        $consent_source = sanitize_key($consent_confirmed ? $source . '_confirmed' : $source);
        $source = sanitize_key($source);
        $values = [];
        $params = [];
        foreach ($grouped as $hash => &$row) {
            $previous = $existing[$hash] ?? null;
            $previous_attributes = is_array($previous)
                ? json_decode((string) ($previous['attributes'] ?? ''), true)
                : [];
            $row['attributes'] = array_merge(
                is_array($previous_attributes) ? $previous_attributes : [],
                $row['attributes']
            );
            if ($row['name'] === '' && is_array($previous)) {
                $row['name'] = (string) ($previous['name'] ?? '');
            }

            $encoded_attributes = wp_json_encode($row['attributes']);
            $values[] = "(%s, %s, %s, %s, 0, %s, NULLIF(%s, ''), '', '', %s, %s, %s)";
            array_push(
                $params,
                (string) $row['email'],
                (string) $hash,
                sanitize_text_field((string) $row['name']),
                $status,
                $consent_source,
                $consent_confirmed ? $now : '',
                is_string($encoded_attributes) ? $encoded_attributes : '{}',
                $now,
                $now
            );
        }
        unset($row);

        // Consentimento de registros existentes só avança de pending para
        // subscribed. Opt-out, bounce e complaint nunca são sobrescritos.
        $upserted = $wpdb->query($wpdb->prepare(
            "INSERT INTO {$contacts_table}
                (email, email_hash, name, status, wp_user_id, consent_source,
                 consent_at, ip_hash, locale, attributes, created_at, updated_at)
             VALUES " . implode(',', $values) . "
             ON DUPLICATE KEY UPDATE
                 email = VALUES(email),
                 name = VALUES(name),
                 attributes = VALUES(attributes),
                 updated_at = VALUES(updated_at),
                 consent_source = IF(
                     status = 'pending' AND VALUES(status) = 'subscribed',
                     VALUES(consent_source),
                     consent_source
                 ),
                 consent_at = IF(
                     status = 'pending' AND VALUES(status) = 'subscribed',
                     VALUES(consent_at),
                     consent_at
                 ),
                 unsubscribed_at = IF(
                     status = 'pending' AND VALUES(status) = 'subscribed',
                     NULL,
                     unsubscribed_at
                 ),
                 status = IF(
                     status = 'pending' AND VALUES(status) = 'subscribed',
                     'subscribed',
                     status
                 )",
            ...$params
        ));
        if ($upserted === false) {
            $wpdb->query('ROLLBACK');
            $result['failed'] = self::import_group_occurrences($grouped);
            return $result;
        }

        $active_hashes = array_keys($grouped);
        $active_placeholders = implode(',', array_fill(0, count($active_hashes), '%s'));
        $saved_rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, email_hash FROM {$contacts_table}
             WHERE email_hash IN ({$active_placeholders})",
            ...$active_hashes
        ), ARRAY_A);
        if (!is_array($saved_rows) || count($saved_rows) !== count($grouped)) {
            $wpdb->query('ROLLBACK');
            $result['failed'] = self::import_group_occurrences($grouped);
            return $result;
        }

        $saved = [];
        foreach ($saved_rows as $row) {
            $saved[(string) $row['email_hash']] = (int) $row['id'];
        }

        if ($list_id > 0 && !self::insert_import_memberships($list_id, $saved, $source, $now)) {
            $wpdb->query('ROLLBACK');
            $result['failed'] = self::import_group_occurrences($grouped);
            return $result;
        }

        if (!self::insert_import_audits(
            $grouped,
            $existing,
            $saved,
            $source,
            $consent_source,
            $consent_confirmed,
            $now
        )) {
            $wpdb->query('ROLLBACK');
            $result['failed'] = self::import_group_occurrences($grouped);
            return $result;
        }

        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            $result['failed'] = self::import_group_occurrences($grouped);
            return $result;
        }

        foreach ($grouped as $hash => $row) {
            $occurrences = (int) $row['occurrences'];
            if (isset($existing[$hash])) {
                $result['updated'] += $occurrences;
            } else {
                $result['imported']++;
                $result['updated'] += max(0, $occurrences - 1);
            }
        }
        return $result;
    }

    /** @param array<string,int> $saved */
    private static function insert_import_memberships(
        int $list_id,
        array $saved,
        string $source,
        string $now
    ): bool {
        global $wpdb;

        if (!$saved) return true;
        $values = [];
        $params = [];
        foreach ($saved as $contact_id) {
            $values[] = '(%d, %d, %s, %s)';
            array_push($params, $list_id, $contact_id, $source, $now);
        }
        $sql = 'INSERT IGNORE INTO ' . Kodety_Email_Schema::table('list_contacts')
            . ' (list_id, contact_id, source, added_at) VALUES ' . implode(',', $values);
        return $wpdb->query($wpdb->prepare($sql, ...$params)) !== false;
    }

    /**
     * @param array<string,array> $grouped
     * @param array<string,array> $existing
     * @param array<string,int> $saved
     */
    private static function insert_import_audits(
        array $grouped,
        array $existing,
        array $saved,
        string $source,
        string $consent_source,
        bool $consent_confirmed,
        string $now
    ): bool {
        global $wpdb;

        $values = [];
        $params = [];
        $actor = function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
        foreach ($grouped as $hash => $row) {
            $previous = $existing[$hash] ?? null;
            if (is_array($previous) && (!$consent_confirmed || (string) $previous['status'] !== 'pending')) {
                continue;
            }
            $action = is_array($previous)
                ? 'resubscribe'
                : ($consent_confirmed ? 'subscribe' : 'import_pending');
            $detail = is_array($previous)
                ? 'Confirmação explícita durante importação'
                : 'Contato criado por importação em lote';
            $values[] = '(%d, %s, %s, %s, %d, 0, %s, %s)';
            array_push(
                $params,
                (int) ($saved[$hash] ?? 0),
                (string) $hash,
                $action,
                $consent_confirmed ? $consent_source : $source,
                $actor,
                $detail,
                $now
            );
        }
        if (!$values) return true;

        $sql = 'INSERT INTO ' . Kodety_Email_Schema::table('consent_events')
            . ' (contact_id, email_hash, action, source, actor_user_id, campaign_id, detail, occurred_at)'
            . ' VALUES ' . implode(',', $values);
        return $wpdb->query($wpdb->prepare($sql, ...$params)) !== false;
    }

    /** @param array<string,array> $grouped */
    private static function import_group_occurrences(array $grouped): int {
        return array_sum(array_map(
            static fn(array $row): int => (int) ($row['occurrences'] ?? 0),
            $grouped
        ));
    }

    private static function merge_import_result(array &$target, array $chunk): void {
        foreach (['imported', 'updated', 'skipped', 'invalid', 'failed'] as $key) {
            $target[$key] += (int) ($chunk[$key] ?? 0);
        }
    }

    /** @return array{imported:int,updated:int,skipped:int,invalid:int,failed:int,limited:int} */
    private static function empty_import_result(): array {
        return [
            'imported' => 0,
            'updated' => 0,
            'skipped' => 0,
            'invalid' => 0,
            'failed' => 0,
            'limited' => 0,
        ];
    }

    /** @param string[] $candidates */
    private static function column_index(array $header, array $candidates): ?int {
        foreach ($candidates as $candidate) {
            $index = array_search($candidate, $header, true);
            if ($index !== false) return (int) $index;
        }
        return null;
    }

    // --- Supressão --------------------------------------------------------

    public static function is_suppressed(string $email): bool {
        return self::suppression($email) !== null;
    }

    public static function suppression(string $email): ?array {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Kodety_Email_Schema::table('suppressions') . ' WHERE email_hash = %s',
            Kodety_Email_Schema::email_hash($email)
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public static function suppress(string $email, string $reason, int $campaign_id = 0, string $detail = ''): void {
        $email = Kodety_Email_Schema::normalize_email($email);
        if ($email === '') return;

        $reason = in_array($reason, ['bounce', 'complaint', 'unsubscribe'], true) ? $reason : 'bounce';
        $effective_reason = self::persist_suppression($email, $reason, $campaign_id, $detail);
        $contact = self::find_by_email($email);
        if ($contact) {
            self::apply_suppression_status((int) $contact['id'], $effective_reason);
            self::audit_consent(
                (int) $contact['id'],
                $email,
                $effective_reason,
                'delivery',
                $campaign_id,
                $detail
            );
        }
    }

    /**
     * Descadastro é persistido fora do contato. Assim, excluir e reimportar o
     * contato não apaga a decisão da pessoa.
     */
    public static function unsubscribe(
        int $contact_id,
        int $campaign_id = 0,
        string $source = 'unsubscribe_link'
    ): bool {
        global $wpdb;

        if ($contact_id <= 0) return false;
        $lock_name = 'kodety_email_unsub_' . substr(hash('sha256', (string) $contact_id), 0, 40);
        $locked = (int) $wpdb->get_var(
            $wpdb->prepare('SELECT GET_LOCK(%s, 1)', $lock_name)
        ) === 1;
        if (!$locked) return false;

        try {
            // Recarrega dentro do lock: duas requisições RFC 8058 simultâneas
            // não podem observar o mesmo estado antigo e duplicar auditoria.
            $contact = self::get($contact_id);
            if (!$contact) return false;

            $email = (string) $contact['email'];
            $previous_suppression = self::suppression($email);
            $previous_reason = is_array($previous_suppression)
                ? (string) $previous_suppression['reason']
                : '';
            $effective_reason = self::persist_suppression(
                $email,
                'unsubscribe',
                $campaign_id,
                $source
            );
            $stored_suppression = self::suppression($email);
            if (!$stored_suppression) return false;

            $target_status = self::status_for_suppression($effective_reason);
            $changed = $previous_reason !== $effective_reason
                || (string) $contact['status'] !== $target_status;
            if ($changed) {
                self::apply_suppression_status($contact_id, $effective_reason);
                self::audit_consent($contact_id, $email, 'unsubscribe', $source, $campaign_id);
            }
            return true;
        } finally {
            $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock_name));
        }
    }

    /**
     * Reinscrição é deliberadamente explícita e só desfaz opt-out voluntário.
     * Bounce e complaint exigem investigação — não são removidos por bulk/CSV.
     */
    public static function resubscribe(int $contact_id, string $source = 'manual_resubscribe'): bool {
        global $wpdb;

        $contact = self::get($contact_id);
        if (!$contact) return false;

        $email = (string) $contact['email'];
        $suppression = self::suppression($email);
        if ($suppression && (string) $suppression['reason'] !== 'unsubscribe') return false;

        if ($suppression) {
            $deleted = $wpdb->delete(Kodety_Email_Schema::table('suppressions'), [
                'email_hash' => Kodety_Email_Schema::email_hash($email),
                'reason' => 'unsubscribe',
            ]);
            if ($deleted !== 1) return false;
        }

        $now = Kodety_Email_Schema::now();
        $wpdb->update(Kodety_Email_Schema::table('contacts'), [
            'status' => 'subscribed',
            'consent_source' => sanitize_key($source),
            'consent_at' => $now,
            'unsubscribed_at' => null,
            'updated_at' => $now,
        ], ['id' => $contact_id]);
        self::audit_consent($contact_id, $email, 'resubscribe', $source);
        return true;
    }

    private static function persist_suppression(
        string $email,
        string $reason,
        int $campaign_id,
        string $detail
    ): string {
        global $wpdb;

        $email = Kodety_Email_Schema::normalize_email($email);
        $existing = self::suppression($email);
        $priority = ['unsubscribe' => 1, 'bounce' => 2, 'complaint' => 3];
        $existing_reason = is_array($existing) ? (string) $existing['reason'] : '';
        $effective_reason = ($priority[$existing_reason] ?? 0) > ($priority[$reason] ?? 0)
            ? $existing_reason
            : $reason;

        $table = Kodety_Email_Schema::table('suppressions');
        $data = [
            'email_hash' => Kodety_Email_Schema::email_hash($email),
            'email' => $email,
            'reason' => $effective_reason,
            'campaign_id' => $campaign_id,
            'detail' => mb_substr($detail, 0, 500),
            'created_at' => Kodety_Email_Schema::now(),
        ];

        if ($existing) {
            if ($effective_reason !== $existing_reason) {
                $wpdb->update($table, $data, ['email_hash' => $data['email_hash']]);
            }
        } else {
            $wpdb->insert($table, $data);
        }
        return $effective_reason;
    }

    private static function apply_suppression_status(int $contact_id, string $reason): void {
        global $wpdb;

        $now = Kodety_Email_Schema::now();
        $status = self::status_for_suppression($reason);
        $data = ['status' => $status, 'updated_at' => $now];
        if ($status === 'unsubscribed') $data['unsubscribed_at'] = $now;
        if ($status === 'bounced') $data['bounced_at'] = $now;
        if ($status === 'complained') $data['complaint_at'] = $now;
        $wpdb->update(Kodety_Email_Schema::table('contacts'), $data, ['id' => $contact_id]);
    }

    private static function status_for_suppression(string $reason): string {
        return match ($reason) {
            'unsubscribe' => 'unsubscribed',
            'complaint' => 'complained',
            default => 'bounced',
        };
    }

    private static function audit_consent(
        int $contact_id,
        string $email,
        string $action,
        string $source,
        int $campaign_id = 0,
        string $detail = ''
    ): void {
        global $wpdb;

        $wpdb->insert(Kodety_Email_Schema::table('consent_events'), [
            'contact_id' => $contact_id,
            'email_hash' => Kodety_Email_Schema::email_hash($email),
            'action' => sanitize_key($action),
            'source' => sanitize_key($source),
            'actor_user_id' => function_exists('get_current_user_id') ? (int) get_current_user_id() : 0,
            'campaign_id' => $campaign_id,
            'detail' => mb_substr($detail, 0, 500),
            'occurred_at' => Kodety_Email_Schema::now(),
        ]);
    }

    // --- Integrações internas --------------------------------------------

    /**
     * Traz membros da área de membros para uma lista.
     *
     * Membro é usuário do WordPress, então o vínculo fica em `wp_user_id` e
     * permite segmentar por plano depois sem duplicar cadastro.
     *
     * @return int Quantidade de contatos sincronizados.
     */
    public static function sync_from_members(int $list_id, string $role = ''): int {
        $query = ['fields' => ['ID', 'user_email', 'display_name']];
        if ($role !== '') $query['role'] = $role;

        $synced = 0;
        foreach (get_users($query) as $user) {
            $contact_id = self::upsert([
                'email' => (string) $user->user_email,
                'name' => (string) $user->display_name,
                'wp_user_id' => (int) $user->ID,
                'status' => 'pending',
                'consent_source' => 'members',
            ]);
            if ($contact_id > 0) {
                if (self::add_to_list($list_id, $contact_id, 'members')) $synced++;
            }
        }
        return $synced;
    }

    /**
     * Traz remetentes dos formulários do site (Kodety_Emails) para uma lista.
     * A origem do consentimento fica registrada como `forms`.
     */
    public static function sync_from_forms(int $list_id): int {
        global $wpdb;

        $submissions = $wpdb->prefix . 'kodety_email_submissions';
        if ((string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $submissions)) !== $submissions) {
            return 0;
        }

        $rows = $wpdb->get_results(
            "SELECT DISTINCT sender_email, sender_name FROM {$submissions}
             WHERE sender_email <> '' AND status <> 'spam'",
            ARRAY_A
        );

        $synced = 0;
        foreach (is_array($rows) ? $rows : [] as $row) {
            $contact_id = self::upsert([
                'email' => (string) $row['sender_email'],
                'name' => (string) $row['sender_name'],
                'status' => 'pending',
                'consent_source' => 'forms',
            ]);
            if ($contact_id > 0) {
                if (self::add_to_list($list_id, $contact_id, 'forms')) $synced++;
            }
        }
        return $synced;
    }
}
