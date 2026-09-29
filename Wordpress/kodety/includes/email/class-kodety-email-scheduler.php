<?php
/**
 * Compatibilidade com agendamentos criados por versões antigas.
 *
 * Campanhas novas são exclusivamente manuais. Esta classe permanece carregada
 * para que callbacks ou integrações antigas falhem de forma segura e para que o
 * migrador consiga devolver linhas `scheduled` a rascunho sem enviar nada.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Scheduler {
    public const LEGACY_CRON_HOOK = 'kodety_email_dispatch_scheduled';

    /**
     * Tombstone da API antiga: nunca cria fila, evento ou status `scheduled`.
     *
     * Se uma integração antiga tentar reagendar uma linha legada, ela é
     * devolvida a rascunho e exige uma nova confirmação em "Enviar agora".
     *
     * @return array{ok:false,error:string,scheduled_at:string}
     */
    public static function schedule(
        int $campaign_id,
        string $local_datetime,
        string $expected_revision = ''
    ): array {
        unset($local_datetime, $expected_revision);
        self::cancel($campaign_id);
        return self::error(
            'O agendamento de campanhas foi removido. Salve o rascunho e confirme o envio manualmente em “Enviar agora”.'
        );
    }

    /**
     * Converte uma campanha legada em rascunho editável e remove toda reserva.
     */
    public static function cancel(int $campaign_id): bool {
        if ($campaign_id <= 0) return false;

        // Limpar primeiro torna a operação segura mesmo se o banco recusar a
        // transição; nenhum callback antigo deve permanecer prometendo envio.
        self::clear_legacy_event($campaign_id);
        $changed = Kodety_Email_Campaigns::compare_and_swap_status(
            $campaign_id,
            ['scheduled'],
            'draft',
            [
                'scheduled_at' => null,
                // Ao voltar a rascunho, o template selecionado volta a ser a
                // fonte editável e a entrega precisa ser confirmada novamente.
                'html' => '',
                'text_body' => '',
                'delivery_config' => null,
            ]
        );
        if (!$changed) return false;

        Kodety_Email_Queue::purge_campaign($campaign_id);
        return true;
    }

    /**
     * Tombstone para callbacks WP-Cron antigos. Converter é seguro; enviar não.
     */
    public static function dispatch(int $campaign_id): void {
        self::cancel($campaign_id);
    }

    /**
     * Compatibilidade para integrações antigas que chamavam o fallback em lote.
     *
     * Todas as linhas encontradas voltam a rascunho, independentemente da data.
     * O formato de retorno antigo é preservado, mas `queued` é sempre zero.
     *
     * @return array{processed:int,queued:int,failed:int}
     */
    public static function run_due(int $limit = 10): array {
        global $wpdb;

        $limit = max(1, min(50, $limit));
        $ids = $wpdb->get_col($wpdb->prepare(
            'SELECT id FROM ' . Kodety_Email_Schema::table('campaigns')
                . " WHERE status = 'scheduled' ORDER BY id ASC LIMIT %d",
            $limit
        ));

        $result = ['processed' => 0, 'queued' => 0, 'failed' => 0];
        foreach (is_array($ids) ? $ids : [] as $id) {
            $result['processed']++;
            if (!self::cancel((int) $id)) $result['failed']++;
        }
        return $result;
    }

    public static function clear_legacy_event(int $campaign_id): void {
        if ($campaign_id <= 0 || !function_exists('wp_clear_scheduled_hook')) return;
        wp_clear_scheduled_hook(self::LEGACY_CRON_HOOK, [$campaign_id]);
    }

    /** @return array{ok:false,error:string,scheduled_at:string} */
    private static function error(string $message): array {
        return ['ok' => false, 'error' => $message, 'scheduled_at' => ''];
    }
}
