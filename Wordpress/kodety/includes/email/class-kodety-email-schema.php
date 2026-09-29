<?php
/**
 * Tabelas, capabilities e migrações do módulo de Email Marketing.
 *
 * Todo o estado do módulo vive em tabelas próprias porque a fila de envio
 * precisa de lock por linha, retry e throttle — nada disso cabe na option
 * `cron` do WordPress nem em post meta.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Schema {
    public const DB_VERSION = 2;
    private const OPTION_DB_VERSION = 'kodety_email_db_version';

    public const CAP_MANAGE = 'kodety_manage_email_marketing';
    public const CAP_VIEW = 'kodety_view_email_marketing';

    /** Status possíveis de um contato. Só `subscribed` recebe campanha. */
    public const CONTACT_STATUSES = ['subscribed', 'pending', 'unsubscribed', 'bounced', 'complained'];

    /**
     * `scheduled` existe somente para reconhecer e cancelar dados de versões
     * antigas. Nenhuma API atual pode criar esse estado. `paused` pertence ao
     * processamento em lotes iniciado manualmente.
     */
    public const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'paused', 'sent', 'failed'];

    public static function table(string $suffix): string {
        global $wpdb;
        return $wpdb->prefix . 'kodety_email_' . $suffix;
    }

    public static function activate(): void {
        self::create_tables();
        self::backfill_consent_state();
        self::grant_capabilities();
        update_option(self::OPTION_DB_VERSION, self::DB_VERSION, false);
    }

    /**
     * Roda no `init` para que uma atualização do plugin por FTP — que nunca
     * dispara o hook de ativação — ainda assim crie as tabelas novas.
     */
    public static function maybe_upgrade(): void {
        if ((int) get_option(self::OPTION_DB_VERSION, 0) >= self::DB_VERSION) return;
        self::activate();
    }

    private static function grant_capabilities(): void {
        $administrator = get_role('administrator');
        if ($administrator) {
            $administrator->add_cap(self::CAP_MANAGE);
            $administrator->add_cap(self::CAP_VIEW);
        }
        // Enviar email em massa em nome do domínio queima reputação quando
        // usado errado. Editor lê relatórios, mas não dispara campanha.
        $editor = get_role('editor');
        if ($editor) {
            $editor->add_cap(self::CAP_VIEW);
            $editor->remove_cap(self::CAP_MANAGE);
        }
    }

    private static function create_tables(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $contacts = self::table('contacts');
        dbDelta("CREATE TABLE {$contacts} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            email varchar(320) NOT NULL DEFAULT '',
            email_hash char(64) NOT NULL DEFAULT '',
            name varchar(191) NOT NULL DEFAULT '',
            status varchar(20) NOT NULL DEFAULT 'subscribed',
            wp_user_id bigint(20) unsigned NOT NULL DEFAULT 0,
            consent_source varchar(60) NOT NULL DEFAULT '',
            consent_at datetime NULL,
            ip_hash char(64) NOT NULL DEFAULT '',
            locale varchar(20) NOT NULL DEFAULT '',
            attributes longtext NULL,
            unsubscribed_at datetime NULL,
            bounced_at datetime NULL,
            complaint_at datetime NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY email_hash (email_hash),
            KEY status_created (status, created_at),
            KEY wp_user_id (wp_user_id)
        ) {$charset};");

        $lists = self::table('lists');
        dbDelta("CREATE TABLE {$lists} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            name varchar(191) NOT NULL DEFAULT '',
            slug varchar(191) NOT NULL DEFAULT '',
            description text NULL,
            double_optin tinyint(1) NOT NULL DEFAULT 0,
            source varchar(60) NOT NULL DEFAULT 'manual',
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY slug (slug)
        ) {$charset};");

        $list_contacts = self::table('list_contacts');
        dbDelta("CREATE TABLE {$list_contacts} (
            list_id bigint(20) unsigned NOT NULL,
            contact_id bigint(20) unsigned NOT NULL,
            source varchar(60) NOT NULL DEFAULT 'manual',
            added_at datetime NOT NULL,
            PRIMARY KEY  (list_id, contact_id),
            KEY contact_id (contact_id)
        ) {$charset};");

        $segments = self::table('segments');
        dbDelta("CREATE TABLE {$segments} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            name varchar(191) NOT NULL DEFAULT '',
            filters_json longtext NULL,
            cached_count bigint(20) unsigned NOT NULL DEFAULT 0,
            refreshed_at datetime NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id)
        ) {$charset};");

        $templates = self::table('templates');
        dbDelta("CREATE TABLE {$templates} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            name varchar(191) NOT NULL DEFAULT '',
            kind varchar(20) NOT NULL DEFAULT 'campaign',
            project_json longtext NULL,
            html longtext NULL,
            text_body longtext NULL,
            thumbnail_id bigint(20) unsigned NOT NULL DEFAULT 0,
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY kind_updated (kind, updated_at)
        ) {$charset};");

        $campaigns = self::table('campaigns');
        dbDelta("CREATE TABLE {$campaigns} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            name varchar(191) NOT NULL DEFAULT '',
            subject varchar(255) NOT NULL DEFAULT '',
            preheader varchar(255) NOT NULL DEFAULT '',
            from_name varchar(191) NOT NULL DEFAULT '',
            from_email varchar(320) NOT NULL DEFAULT '',
            reply_to varchar(320) NOT NULL DEFAULT '',
            template_id bigint(20) unsigned NOT NULL DEFAULT 0,
            html longtext NULL,
            text_body longtext NULL,
            audience_json longtext NULL,
            delivery_config longtext NULL,
            status varchar(20) NOT NULL DEFAULT 'draft',
            scheduled_at datetime NULL,
            started_at datetime NULL,
            sent_at datetime NULL,
            stats_json longtext NULL,
            created_by bigint(20) unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY status_created (status, created_at)
        ) {$charset};");

        // `locked_until` é o que torna o tick seguro: dois workers concorrentes
        // (aba do navegador + WP-Cron) nunca reivindicam a mesma linha.
        $queue = self::table('queue');
        dbDelta("CREATE TABLE {$queue} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            campaign_id bigint(20) unsigned NOT NULL,
            contact_id bigint(20) unsigned NOT NULL,
            email varchar(320) NOT NULL DEFAULT '',
            status varchar(20) NOT NULL DEFAULT 'pending',
            attempts smallint(5) unsigned NOT NULL DEFAULT 0,
            next_attempt_at datetime NOT NULL,
            locked_until datetime NULL,
            lock_token varchar(32) NOT NULL DEFAULT '',
            verp_token varchar(64) NOT NULL DEFAULT '',
            message_id varchar(191) NOT NULL DEFAULT '',
            error text NULL,
            sent_at datetime NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY campaign_contact (campaign_id, contact_id),
            KEY claim (campaign_id, status, next_attempt_at),
            KEY lock_token (lock_token),
            KEY sent_at (sent_at),
            KEY verp_token (verp_token)
        ) {$charset};");

        $events = self::table('events');
        dbDelta("CREATE TABLE {$events} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            campaign_id bigint(20) unsigned NOT NULL DEFAULT 0,
            contact_id bigint(20) unsigned NOT NULL DEFAULT 0,
            type varchar(20) NOT NULL DEFAULT '',
            url text NULL,
            ip_hash char(64) NOT NULL DEFAULT '',
            user_agent varchar(500) NOT NULL DEFAULT '',
            occurred_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY campaign_type (campaign_id, type, occurred_at),
            KEY contact_type (contact_id, type)
        ) {$charset};");

        // Global e independente de campanha: um hard bounce nunca deve ser
        // reenviado por nenhuma campanha futura.
        $suppressions = self::table('suppressions');
        dbDelta("CREATE TABLE {$suppressions} (
            email_hash char(64) NOT NULL,
            email varchar(320) NOT NULL DEFAULT '',
            reason varchar(40) NOT NULL DEFAULT '',
            campaign_id bigint(20) unsigned NOT NULL DEFAULT 0,
            detail text NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY  (email_hash),
            KEY reason_created (reason, created_at)
        ) {$charset};");

        // Histórico imutável de consentimento. A suppression atual responde
        // "pode receber agora?"; este log responde "quem mudou, quando e por
        // quê?", inclusive depois de uma exclusão LGPD do contato.
        $consent_events = self::table('consent_events');
        dbDelta("CREATE TABLE {$consent_events} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            contact_id bigint(20) unsigned NOT NULL DEFAULT 0,
            email_hash char(64) NOT NULL DEFAULT '',
            action varchar(30) NOT NULL DEFAULT '',
            source varchar(60) NOT NULL DEFAULT '',
            actor_user_id bigint(20) unsigned NOT NULL DEFAULT 0,
            campaign_id bigint(20) unsigned NOT NULL DEFAULT 0,
            detail text NULL,
            occurred_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY email_occurred (email_hash, occurred_at),
            KEY contact_occurred (contact_id, occurred_at),
            KEY action_occurred (action, occurred_at)
        ) {$charset};");
    }

    /**
     * A v1 guardava descadastro somente na linha do contato. A migração para
     * v2 materializa esse estado em suppression antes que uma futura exclusão
     * ou reimportação possa apagá-lo, e inaugura a trilha de auditoria.
     */
    private static function backfill_consent_state(): void {
        global $wpdb;

        $contacts = self::table('contacts');
        $suppressions = self::table('suppressions');
        $events = self::table('consent_events');

        $wpdb->query(
            "INSERT IGNORE INTO {$suppressions}
                (email_hash, email, reason, campaign_id, detail, created_at)
             SELECT email_hash, email,
                    CASE status
                        WHEN 'complained' THEN 'complaint'
                        WHEN 'bounced' THEN 'bounce'
                        ELSE 'unsubscribe'
                    END,
                    0, 'Estado migrado da tabela de contatos',
                    COALESCE(complaint_at, bounced_at, unsubscribed_at, updated_at, created_at)
             FROM {$contacts}
             WHERE status IN ('unsubscribed', 'bounced', 'complained')"
        );

        $wpdb->query(
            "INSERT INTO {$events}
                (contact_id, email_hash, action, source, actor_user_id, campaign_id, detail, occurred_at)
             SELECT c.id, c.email_hash,
                    CASE c.status
                        WHEN 'subscribed' THEN 'subscribe'
                        WHEN 'unsubscribed' THEN 'unsubscribe'
                        WHEN 'bounced' THEN 'bounce'
                        WHEN 'complained' THEN 'complaint'
                        ELSE 'import_pending'
                    END,
                    COALESCE(NULLIF(c.consent_source, ''), 'migration'),
                    0, 0, 'Estado inicial migrado para trilha de consentimento',
                    COALESCE(c.consent_at, c.complaint_at, c.bounced_at, c.unsubscribed_at, c.created_at)
             FROM {$contacts} c
             WHERE NOT EXISTS (
                 SELECT 1 FROM {$events} e WHERE e.contact_id = c.id
             )"
        );
    }

    /**
     * Chave de deduplicação de email. Normaliza caixa e espaços para que
     * `Joao@Site.com ` e `joao@site.com` sejam o mesmo contato, e mantém o
     * índice único num tamanho indexável (320 chars estourariam utf8mb4).
     */
    public static function email_hash(string $email): string {
        return hash('sha256', self::normalize_email($email));
    }

    public static function normalize_email(string $email): string {
        return strtolower(trim($email));
    }

    public static function now(): string {
        return current_time('mysql', true);
    }
}
