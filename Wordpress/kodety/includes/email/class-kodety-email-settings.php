<?php
/**
 * Configurações do módulo de Email Marketing.
 *
 * Segredos (senha SMTP, chave privada DKIM e credenciais de bounce) nunca
 * voltam para a tela depois de salvos — o formulário mostra apenas se estão
 * configurados, seguindo o mesmo contrato já usado em Kodety_Emails.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Settings {
    private const OPTION = 'kodety_email_marketing_settings';
    private const SECRET_PREFIX = 'enc:v1:';
    private const SECRET_CONTEXT = 'kodety-email-marketing-settings-v1';

    /** Campos que nunca são devolvidos para o navegador. */
    public const SECRET_KEYS = [
        'smtp_password',
        'dkim_private_key',
        'bounce_password',
        'bounce_webhook_secret',
    ];

    public static function defaults(): array {
        $host = wp_parse_url((string) home_url(), PHP_URL_HOST);
        $domain = is_string($host) ? preg_replace('/^www\./i', '', $host) : '';

        return [
            'transport' => 'local',

            'from_name' => (string) get_option('blogname', ''),
            'from_email' => $domain !== '' ? 'contato@' . $domain : (string) get_option('admin_email', ''),
            'reply_to' => (string) get_option('admin_email', ''),

            'smtp_host' => '',
            'smtp_port' => 587,
            'smtp_secure' => 'tls',
            'smtp_username' => '',
            'smtp_password' => '',

            'dkim_domain' => (string) $domain,
            'dkim_selector' => 'kodety',
            'dkim_private_key' => '',
            'dkim_public_key' => '',

            // 60/min e 500/h são conservadores de propósito: um domínio novo
            // que dispara milhares de emails de uma vez entra em blocklist.
            'emails_per_minute' => 60,
            'emails_per_hour' => 500,
            'batch_size' => 25,
            'warmup_enabled' => true,

            'track_opens' => true,
            'track_clicks' => true,
            'retention_days' => 365,

            'bounce_enabled' => false,
            'bounce_protocol' => 'imap',
            'bounce_host' => '',
            'bounce_port' => 993,
            'bounce_username' => '',
            'bounce_password' => '',
            'bounce_mailbox' => 'INBOX',
            'bounce_webhook_secret' => '',
        ];
    }

    public static function all(): array {
        $stored = get_option(self::OPTION, []);
        $stored = is_array($stored) ? $stored : [];
        $settings = array_merge(self::defaults(), $stored);
        $migrated = $stored;
        $changed = false;

        foreach (self::SECRET_KEYS as $key) {
            $value = (string) ($settings[$key] ?? '');
            if ($value === '') continue;
            if (str_starts_with($value, self::SECRET_PREFIX)) {
                $plain = self::decrypt_secret($value, $key);
                // Salt rotation/corruption must fail closed: ciphertext is
                // never passed to SMTP, DKIM or webhook verification as data.
                $settings[$key] = is_wp_error($plain) ? '' : $plain;
                continue;
            }

            // Transparent migration for installations created before secrets
            // were encrypted. Keep this request operational and rewrite the
            // option in place as soon as authenticated encryption is available.
            $protected = self::encrypt_secret($value, $key);
            if (!is_wp_error($protected)) {
                $migrated[$key] = $protected;
                $changed = true;
            }
        }
        if ($changed) update_option(self::OPTION, $migrated, false);
        return $settings;
    }

    public static function get(string $key): mixed {
        $settings = self::all();
        return $settings[$key] ?? null;
    }

    /**
     * Versão segura para a UI: segredos viram booleanos "está configurado?".
     */
    public static function for_display(): array {
        $settings = self::all();
        foreach (self::SECRET_KEYS as $key) {
            $settings[$key . '_configured'] = trim((string) ($settings[$key] ?? '')) !== '';
            unset($settings[$key]);
        }
        return $settings;
    }

    public static function update(array $changes): array|WP_Error {
        $settings = array_merge(self::all(), $changes);
        $settings = self::sanitize($settings);
        $protected = self::protect_settings($settings);
        if (is_wp_error($protected)) return $protected;
        $stored = get_option(self::OPTION, []);
        if ($protected !== $stored && !update_option(self::OPTION, $protected, false)) {
            return new WP_Error(
                'kodety_email_settings_store',
                'Não foi possível salvar as configurações de email.',
                ['status' => 500]
            );
        }
        return $settings;
    }

    public static function sanitize(array $input): array {
        $defaults = self::defaults();
        $out = [];

        $transport = sanitize_key((string) ($input['transport'] ?? $defaults['transport']));
        $out['transport'] = in_array($transport, ['local', 'smtp', 'mx_direct'], true) ? $transport : 'local';

        $out['from_name'] = sanitize_text_field((string) ($input['from_name'] ?? $defaults['from_name']));
        $out['from_email'] = sanitize_email((string) ($input['from_email'] ?? $defaults['from_email']));
        $out['reply_to'] = sanitize_email((string) ($input['reply_to'] ?? $defaults['reply_to']));

        $out['smtp_host'] = sanitize_text_field((string) ($input['smtp_host'] ?? ''));
        $out['smtp_port'] = max(1, min(65535, (int) ($input['smtp_port'] ?? $defaults['smtp_port'])));
        $secure = sanitize_key((string) ($input['smtp_secure'] ?? $defaults['smtp_secure']));
        $out['smtp_secure'] = in_array($secure, ['tls', 'ssl', 'none'], true) ? $secure : 'tls';
        $out['smtp_username'] = sanitize_text_field((string) ($input['smtp_username'] ?? ''));
        $out['smtp_password'] = (string) ($input['smtp_password'] ?? '');

        $configured_dkim_domain = strtolower(sanitize_text_field((string) ($input['dkim_domain'] ?? $defaults['dkim_domain'])));
        // A tela não expõe um domínio DKIM independente: o contrato do módulo
        // é assinar alinhado ao From. Ao trocar o remetente, manter aqui o
        // domínio antigo faria a Saúde consultar um TXT e o PHPMailer assinar
        // outro, quebrando o alinhamento DMARC apesar de a UI parecer pronta.
        $out['dkim_domain'] = self::sender_domain_for([
            'from_email' => $out['from_email'],
            'dkim_domain' => $configured_dkim_domain,
        ]);
        $selector = sanitize_key((string) ($input['dkim_selector'] ?? $defaults['dkim_selector']));
        $out['dkim_selector'] = $selector !== '' ? $selector : 'kodety';
        $out['dkim_private_key'] = (string) ($input['dkim_private_key'] ?? '');
        $out['dkim_public_key'] = (string) ($input['dkim_public_key'] ?? '');

        $out['emails_per_minute'] = max(1, min(3000, (int) ($input['emails_per_minute'] ?? $defaults['emails_per_minute'])));
        $out['emails_per_hour'] = max(1, min(100000, (int) ($input['emails_per_hour'] ?? $defaults['emails_per_hour'])));
        $out['batch_size'] = max(1, min(200, (int) ($input['batch_size'] ?? $defaults['batch_size'])));
        $out['warmup_enabled'] = !empty($input['warmup_enabled']);

        $out['track_opens'] = !empty($input['track_opens']);
        $out['track_clicks'] = !empty($input['track_clicks']);
        $out['retention_days'] = max(30, min(3650, (int) ($input['retention_days'] ?? $defaults['retention_days'])));

        $out['bounce_enabled'] = !empty($input['bounce_enabled']);
        $protocol = sanitize_key((string) ($input['bounce_protocol'] ?? $defaults['bounce_protocol']));
        $out['bounce_protocol'] = in_array($protocol, ['imap', 'pop3'], true) ? $protocol : 'imap';
        $out['bounce_host'] = sanitize_text_field((string) ($input['bounce_host'] ?? ''));
        $out['bounce_port'] = max(1, min(65535, (int) ($input['bounce_port'] ?? $defaults['bounce_port'])));
        $out['bounce_username'] = sanitize_text_field((string) ($input['bounce_username'] ?? ''));
        $out['bounce_password'] = (string) ($input['bounce_password'] ?? '');
        $out['bounce_mailbox'] = sanitize_text_field((string) ($input['bounce_mailbox'] ?? $defaults['bounce_mailbox']));
        $out['bounce_webhook_secret'] = mb_substr(
            sanitize_text_field((string) ($input['bounce_webhook_secret'] ?? '')),
            0,
            190
        );

        return $out;
    }

    /**
     * Aplica um POST de formulário preservando segredos não reenviados.
     *
     * Campo de senha vazio significa "mantenha o que está salvo"; só o
     * checkbox `clear_<campo>` apaga de fato.
     */
    public static function apply_form(array $post): array|WP_Error {
        $current = self::all();
        $changes = $post;

        // Checkbox desmarcado não aparece no POST. Se apenas mesclássemos com
        // o valor atual, seria impossível desligar estas opções pela tela.
        foreach (['warmup_enabled', 'track_opens', 'track_clicks', 'bounce_enabled'] as $key) {
            $changes[$key] = !empty($post[$key]);
        }

        foreach (self::SECRET_KEYS as $key) {
            $submitted = trim((string) ($post[$key] ?? ''));
            if (!empty($post['clear_' . $key])) {
                $changes[$key] = '';
                continue;
            }
            $changes[$key] = $submitted !== '' ? $submitted : (string) ($current[$key] ?? '');
        }

        return self::update($changes);
    }

    /**
     * Domínio usado no Return-Path e nas checagens de DNS. Deriva do
     * remetente porque é ele que o destinatário valida contra SPF/DKIM.
     */
    public static function sender_domain(): string {
        return self::sender_domain_for(self::all());
    }

    /**
     * Resolve o domínio efetivo de uma configuração/snapshot específico.
     *
     * Não usa a option global para que campanhas e testes trabalhem com a
     * fotografia que realmente chegou ao transporte.
     */
    public static function sender_domain_for(array $settings): string {
        $from = strtolower(trim((string) ($settings['from_email'] ?? '')));
        $at = strrpos($from, '@');
        $domain = $at === false
            ? (string) ($settings['dkim_domain'] ?? '')
            : substr($from, $at + 1);
        return strtolower(rtrim(trim($domain), '.'));
    }

    /**
     * Configuração não secreta congelada no instante em que a campanha começa.
     *
     * Senhas e chave privada continuam somente na option protegida do módulo.
     * Os fingerprints permitem detectar rotação durante um envio sem duplicar
     * esses segredos em cada campanha.
     */
    public static function campaign_snapshot(?array $settings = null): array {
        $settings ??= self::all();
        $keys = [
            'transport',
            'from_name',
            'from_email',
            'reply_to',
            'smtp_host',
            'smtp_port',
            'smtp_secure',
            'smtp_username',
            'dkim_domain',
            'dkim_selector',
            'emails_per_minute',
            'emails_per_hour',
            'batch_size',
            'warmup_enabled',
            'track_opens',
            'track_clicks',
            'bounce_enabled',
        ];

        $snapshot = array_intersect_key($settings, array_flip($keys));
        $snapshot['delivery_fingerprint'] = self::delivery_fingerprint($settings);
        $snapshot['dkim_key_fingerprint'] = self::secret_fingerprint((string) ($settings['dkim_private_key'] ?? ''));
        $snapshot['captured_at'] = Kodety_Email_Schema::now();
        return $snapshot;
    }

    /**
     * Resolve a configuração efetiva de uma campanha.
     *
     * Remetente e tracking pertencem ao disparo e permanecem estáveis.
     * Throttle, lote e warmup são controles globais de segurança: sempre usam
     * o valor atual, de modo que reduzir o limite interrompa imediatamente o
     * ritmo de todas as campanhas, inclusive as antigas. Configuração de
     * conexão só é restaurada quando os segredos atuais ainda correspondem ao
     * fingerprint capturado; após uma rotação, usa-se a conexão atual inteira
     * para não combinar host antigo com senha nova ou seletor DKIM antigo com
     * chave nova.
     */
    public static function for_campaign(array $campaign): array {
        $current = self::all();
        $snapshot = json_decode((string) ($campaign['delivery_config'] ?? ''), true);
        if (!is_array($snapshot)) $snapshot = [];

        foreach (['track_opens', 'track_clicks', 'bounce_enabled'] as $key) {
            if (array_key_exists($key, $snapshot)) $current[$key] = $snapshot[$key];
        }

        $snapshot_fingerprint = (string) ($snapshot['delivery_fingerprint'] ?? '');
        $delivery_current = $snapshot_fingerprint !== ''
            && hash_equals($snapshot_fingerprint, self::delivery_fingerprint($current));
        $current['_campaign_delivery_current'] = $delivery_current;
        if ($delivery_current) {
            foreach ([
                'transport',
                'smtp_host',
                'smtp_port',
                'smtp_secure',
                'smtp_username',
                'dkim_domain',
                'dkim_selector',
            ] as $key) {
                if (array_key_exists($key, $snapshot)) $current[$key] = $snapshot[$key];
            }
        }

        $from_email = sanitize_email((string) ($campaign['from_email'] ?? ''));
        if ($from_email !== '') $current['from_email'] = $from_email;
        if (isset($campaign['from_name'])) {
            $current['from_name'] = sanitize_text_field((string) $campaign['from_name']);
        }
        $reply_to = sanitize_email((string) ($campaign['reply_to'] ?? ''));
        if ($reply_to !== '') $current['reply_to'] = $reply_to;

        return $current;
    }

    /**
     * Identifica a configuração realmente usada pelo transporte sem expor
     * credenciais. Serve para invalidar um teste de entrega assim que remetente,
     * conexão ou chave DKIM forem alterados.
     */
    public static function delivery_fingerprint(?array $settings = null): string {
        $settings ??= self::all();
        $material = [
            'transport' => (string) ($settings['transport'] ?? ''),
            'from_email' => (string) ($settings['from_email'] ?? ''),
            'smtp_host' => (string) ($settings['smtp_host'] ?? ''),
            'smtp_port' => (int) ($settings['smtp_port'] ?? 0),
            'smtp_secure' => (string) ($settings['smtp_secure'] ?? ''),
            'smtp_username' => (string) ($settings['smtp_username'] ?? ''),
            'smtp_password' => self::secret_fingerprint((string) ($settings['smtp_password'] ?? '')),
            'dkim_domain' => (string) ($settings['dkim_domain'] ?? ''),
            'dkim_selector' => (string) ($settings['dkim_selector'] ?? ''),
            'dkim_private_key' => self::secret_fingerprint((string) ($settings['dkim_private_key'] ?? '')),
        ];
        return hash('sha256', (string) wp_json_encode($material));
    }

    private static function secret_fingerprint(string $secret): string {
        return $secret === '' ? '' : hash_hmac('sha256', $secret, wp_salt('kodety_email_settings'));
    }

    private static function protect_settings(array $settings): array|WP_Error {
        foreach (self::SECRET_KEYS as $key) {
            $protected = self::encrypt_secret((string) ($settings[$key] ?? ''), $key);
            if (is_wp_error($protected)) return $protected;
            $settings[$key] = $protected;
        }
        return $settings;
    }

    private static function encrypt_secret(string $plain, string $field): string|WP_Error {
        if ($plain === '') return '';
        if (!function_exists('openssl_encrypt')) {
            return new WP_Error(
                'kodety_email_settings_crypto',
                'OpenSSL é necessário para proteger as credenciais de email.',
                ['status' => 503]
            );
        }
        try {
            $iv = random_bytes(12);
        } catch (Throwable) {
            return new WP_Error(
                'kodety_email_settings_crypto',
                'Não foi possível proteger as credenciais de email.',
                ['status' => 503]
            );
        }
        $tag = '';
        $cipher = openssl_encrypt(
            $plain,
            'aes-256-gcm',
            self::encryption_key(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            self::secret_context($field),
            16
        );
        if (!is_string($cipher) || strlen($tag) !== 16) {
            return new WP_Error(
                'kodety_email_settings_crypto',
                'Não foi possível proteger as credenciais de email.',
                ['status' => 503]
            );
        }
        return self::SECRET_PREFIX . base64_encode($iv . $tag . $cipher);
    }

    private static function decrypt_secret(string $stored, string $field): string|WP_Error {
        if ($stored === '') return '';
        if (!str_starts_with($stored, self::SECRET_PREFIX) || !function_exists('openssl_decrypt')) {
            return new WP_Error(
                'kodety_email_settings_crypto',
                'Uma credencial de email salva não pôde ser lida.',
                ['status' => 503]
            );
        }
        $raw = base64_decode(substr($stored, strlen(self::SECRET_PREFIX)), true);
        if (!is_string($raw) || strlen($raw) < 29) {
            return new WP_Error(
                'kodety_email_settings_crypto',
                'Uma credencial de email salva está corrompida.',
                ['status' => 503]
            );
        }
        $plain = openssl_decrypt(
            substr($raw, 28),
            'aes-256-gcm',
            self::encryption_key(),
            OPENSSL_RAW_DATA,
            substr($raw, 0, 12),
            substr($raw, 12, 16),
            self::secret_context($field)
        );
        return is_string($plain)
            ? $plain
            : new WP_Error(
                'kodety_email_settings_crypto',
                'Uma credencial de email salva não pôde ser lida.',
                ['status' => 503]
            );
    }

    private static function encryption_key(): string {
        return hash('sha256', wp_salt('auth') . '|' . self::SECRET_CONTEXT, true);
    }

    private static function secret_context(string $field): string {
        return self::SECRET_CONTEXT . ':' . $field;
    }
}
