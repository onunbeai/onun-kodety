<?php
/**
 * Ingestão assíncrona de bounce/complaint via VERP.
 *
 * O Onun Kodety não tenta adivinhar o formato de cada caixa IMAP. Em vez disso, um
 * MTA ou processador de DSN extrai o token de `bounce+token@dominio` e chama
 * este endpoint autenticado. O token localiza exatamente campanha/contato; o
 * segredo do webhook impede que o endereço VERP, visível em cabeçalhos, seja
 * suficiente para registrar uma reclamação falsa.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Bounces {
    private const LAST_SEEN_OPTION = 'kodety_email_bounce_webhook_last_seen';

    public static function register_route(): void {
        register_rest_route('kodety/v1', '/email/bounces/(?P<token>[a-fA-F0-9]{32})', [
            'methods' => 'POST',
            'permission_callback' => [self::class, 'authorize'],
            'callback' => [self::class, 'ingest'],
        ]);
    }

    public static function endpoint_template(): string {
        return rest_url('kodety/v1/email/bounces/{verp_token}');
    }

    public static function authorize(WP_REST_Request $request): bool|WP_Error {
        if (!Kodety_Email_Settings::get('bounce_enabled')) {
            return new WP_Error(
                'kodety_email_bounce_webhook_disabled',
                'O processamento VERP está desativado.',
                ['status' => 503]
            );
        }
        $expected = (string) Kodety_Email_Settings::get('bounce_webhook_secret');
        if (strlen($expected) < 24) {
            return new WP_Error(
                'kodety_email_bounce_webhook_unconfigured',
                'O webhook de retornos ainda não possui um segredo configurado.',
                ['status' => 503]
            );
        }

        $provided = trim((string) $request->get_header('x-kodety-bounce-secret'));
        if ($provided === '') {
            $authorization = trim((string) $request->get_header('authorization'));
            if (preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
                $provided = trim((string) $matches[1]);
            }
        }
        if ($provided === '' || !hash_equals($expected, $provided)) {
            return new WP_Error(
                'kodety_email_bounce_webhook_forbidden',
                'Credencial do webhook inválida.',
                ['status' => 401]
            );
        }
        return true;
    }

    public static function ingest(WP_REST_Request $request): WP_REST_Response|WP_Error {
        global $wpdb;

        $token = strtolower(sanitize_text_field((string) $request['token']));
        if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
            return new WP_Error('kodety_email_bounce_invalid', 'Retorno inválido.', ['status' => 400]);
        }

        $queue = Kodety_Email_Schema::table('queue');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT campaign_id, contact_id, email
             FROM {$queue}
             WHERE verp_token = %s
             LIMIT 1",
            $token
        ), ARRAY_A);
        if (!is_array($row)) {
            return new WP_Error(
                'kodety_email_bounce_unknown',
                'Token de retorno não encontrado ou fora da retenção.',
                ['status' => 404]
            );
        }

        $reason = sanitize_key((string) $request->get_param('reason'));
        if (!in_array($reason, ['bounce', 'complaint'], true)) $reason = 'bounce';
        $diagnostic = mb_substr(
            sanitize_text_field((string) $request->get_param('diagnostic')),
            0,
            500
        );
        $campaign_id = (int) $row['campaign_id'];
        $contact_id = (int) $row['contact_id'];
        $email = (string) $row['email'];

        Kodety_Email_Contacts::suppress(
            $email,
            $reason,
            $campaign_id,
            'async_verp_webhook' . ($diagnostic !== '' ? ': ' . $diagnostic : '')
        );
        $inserted = Kodety_Email_Tracking::record_unique(
            $reason,
            $campaign_id,
            $contact_id
        );

        update_option(self::LAST_SEEN_OPTION, [
            'received_at' => Kodety_Email_Schema::now(),
            'received_at_unix' => time(),
            'reason' => $reason,
            'token_hash' => hash_hmac('sha256', $token, wp_salt('kodety_email_bounce')),
        ], false);
        Kodety_Email_Health::flush();

        return new WP_REST_Response([
            'accepted' => true,
            'new_event' => $inserted,
            'reason' => $reason,
        ], 202);
    }

    public static function last_seen(): ?array {
        $value = get_option(self::LAST_SEEN_OPTION, []);
        return is_array($value) && !empty($value['received_at']) ? $value : null;
    }
}
