<?php
/**
 * Fachada do módulo de Email Marketing.
 *
 * Addon nativo do Onun Kodety: não é um plugin WordPress separado, vive dentro do
 * mesmo pacote e pendura suas telas como submenus do item "Emails" que
 * Kodety_Emails já registra.
 *
 * Esta classe é só orquestração — schema, settings, transporte, fila,
 * campanhas e telas moram em arquivos próprios de propósito, para o módulo não
 * repetir o crescimento de class-kodety-plugin.php.
 */

defined('ABSPATH') || exit;

require_once __DIR__ . '/class-kodety-email-schema.php';
require_once __DIR__ . '/class-kodety-email-settings.php';
require_once __DIR__ . '/class-kodety-email-transport.php';
require_once __DIR__ . '/class-kodety-email-health.php';
require_once __DIR__ . '/class-kodety-email-contacts.php';
require_once __DIR__ . '/class-kodety-email-tracking.php';
require_once __DIR__ . '/class-kodety-email-bounces.php';
require_once __DIR__ . '/class-kodety-email-renderer.php';
require_once __DIR__ . '/class-kodety-email-campaigns.php';
require_once __DIR__ . '/class-kodety-email-queue.php';
require_once __DIR__ . '/class-kodety-email-scheduler.php';
require_once __DIR__ . '/class-kodety-email-admin.php';
require_once __DIR__ . '/class-kodety-email-admin-audience.php';
require_once __DIR__ . '/class-kodety-email-admin-campaigns.php';
require_once __DIR__ . '/class-kodety-email-admin-templates.php';

final class Kodety_Email_Marketing {
    private static ?self $instance = null;

    public const PAGE_CAMPAIGNS = 'kodety-email-campaigns';
    public const PAGE_TEMPLATES = 'kodety-email-templates';
    public const PAGE_CONTACTS = 'kodety-email-contacts';
    public const PAGE_LISTS = 'kodety-email-lists';
    public const PAGE_HEALTH = 'kodety-email-health';
    public const PAGE_SETTINGS = 'kodety-email-settings';

    private const CRON_HOOK = 'kodety_email_tick';
    private const CLEANUP_HOOK = 'kodety_email_cleanup';
    private const CLEANUP_LOCK = 'kodety_email_cleanup_lock';
    public const WORKER_HOOK = 'kodety_email_process_campaign';

    /**
     * Versão das rewrite rules do módulo. Incrementar força uma regravação na
     * próxima carga, o que cobre atualização por FTP — que nunca dispara o
     * hook de ativação e deixaria as rotas novas em 404.
     */
    private const REWRITE_VERSION = 2;
    private const OPTION_REWRITE_VERSION = 'kodety_email_rewrite_version';
    // v2 também recolhe linhas criadas pela API legada que ainda existia após
    // a primeira migração visual para envio manual.
    private const MANUAL_ONLY_VERSION = 2;
    private const OPTION_MANUAL_ONLY_VERSION = 'kodety_email_manual_only_version';

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [Kodety_Email_Schema::class, 'maybe_upgrade'], 3);
        add_action('init', [$this, 'add_rewrite_rules'], 5);
        add_action('init', [$this, 'enforce_manual_only'], 6);
        add_action('init', [$this, 'maybe_flush_rules'], 20);
        add_action('init', [$this, 'ensure_cron'], 30);
        add_filter('query_vars', [$this, 'register_query_vars']);
        // Mesma rede de segurança que Kodety_Plugin::detect_direct_route usa:
        // a rota precisa funcionar mesmo com permalink "Simples" ou regras
        // desatualizadas, situações em que a rewrite rule sozinha dá 404.
        add_action('parse_request', [$this, 'detect_direct_route'], 1);
        add_filter('template_include', [$this, 'editor_template']);
        Kodety_Email_Tracking::instance();

        // Prioridade 26 coloca os submenus logo abaixo do item "Emails",
        // registrado por Kodety_Emails em 25.
        add_action('admin_menu', [$this, 'admin_menu'], 26);
        add_action('admin_enqueue_scripts', [$this, 'admin_assets']);
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action(self::CRON_HOOK, [$this, 'cron_tick']);
        add_action(self::CLEANUP_HOOK, [$this, 'cleanup']);
        add_action(self::WORKER_HOOK, [$this, 'cron_campaign_worker'], 10, 1);

        foreach ([
            'save_settings', 'generate_dkim', 'send_test', 'recheck',
            'create_list', 'delete_list', 'add_contact', 'import_csv', 'sync_source', 'bulk_contacts',
            'create_campaign', 'save_campaign', 'send_campaign', 'test_campaign',
            'delete_template', 'duplicate_template',
            'pause_campaign', 'resume_campaign', 'reconcile_campaign_ack', 'duplicate_campaign', 'delete_campaign',
            'cancel_schedule',
        ] as $action) {
            add_action('admin_post_kodety_email_' . $action, [$this, 'handle_' . $action]);
        }
    }

    public static function activate(): void {
        Kodety_Email_Schema::activate();
        Kodety_Email_Tracking::flush_rules();

        // Rede de segurança para campanha cuja aba foi fechada no meio. O
        // caminho principal é o tick do navegador; este é o resgate.
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 300, 'hourly', self::CRON_HOOK);
        }
        if (!wp_next_scheduled(self::CLEANUP_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_HOOK);
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook(self::CRON_HOOK);
        wp_clear_scheduled_hook(self::CLEANUP_HOOK);
        if (function_exists('wp_unschedule_hook')) {
            wp_unschedule_hook(Kodety_Email_Scheduler::LEGACY_CRON_HOOK);
            wp_unschedule_hook(self::WORKER_HOOK);
            wp_unschedule_hook('kodety_email_run_scheduled_batch');
        }
    }

    /** Agenda um único tick curto, deduplicado por campanha. */
    public static function schedule_campaign_worker(int $campaign_id, int $delay = 1): void {
        if ($campaign_id <= 0 || !function_exists('wp_schedule_single_event')) return;
        $args = [$campaign_id];
        if (wp_next_scheduled(self::WORKER_HOOK, $args)) return;
        wp_schedule_single_event(time() + max(1, min(DAY_IN_SECONDS, $delay)), self::WORKER_HOOK, $args);
    }

    public static function clear_campaign_worker(int $campaign_id): void {
        if ($campaign_id <= 0 || !function_exists('wp_clear_scheduled_hook')) return;
        wp_clear_scheduled_hook(self::WORKER_HOOK, [$campaign_id]);
    }

    /** Recria eventos recorrentes perdidos por limpeza manual do cron. */
    public function ensure_cron(): void {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 300, 'hourly', self::CRON_HOOK);
        }
        if (!wp_next_scheduled(self::CLEANUP_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_HOOK);
        }
    }

    /**
     * Scheduling was exposed by an earlier build. Convert every legacy item
     * back to an editable draft and remove its reserved queue/event so no
     * campaign can start without a fresh manual confirmation.
     */
    public function enforce_manual_only(): void {
        if ((int) get_option(self::OPTION_MANUAL_ONLY_VERSION, 0) >= self::MANUAL_ONLY_VERSION) return;

        if (function_exists('wp_unschedule_hook')) {
            wp_unschedule_hook(Kodety_Email_Scheduler::LEGACY_CRON_HOOK);
            wp_unschedule_hook('kodety_email_run_scheduled_batch');
        }

        global $wpdb;
        $ids = $wpdb->get_col(
            'SELECT id FROM ' . Kodety_Email_Schema::table('campaigns')
                . " WHERE status = 'scheduled' ORDER BY id ASC LIMIT 1000"
        );
        foreach (is_array($ids) ? $ids : [] as $id) {
            Kodety_Email_Scheduler::cancel((int) $id);
        }

        $remaining = (int) $wpdb->get_var(
            'SELECT COUNT(*) FROM ' . Kodety_Email_Schema::table('campaigns')
                . " WHERE status = 'scheduled'"
        );
        if ($remaining === 0) {
            update_option(self::OPTION_MANUAL_ONLY_VERSION, self::MANUAL_ONLY_VERSION, false);
        }
    }

    // --- Construtor de email ---------------------------------------------

    public function add_rewrite_rules(): void {
        add_rewrite_rule('^kodety/email-editor/?$', 'index.php?kodety_email_editor=1', 'top');
    }

    public function register_query_vars(array $vars): array {
        $vars[] = 'kodety_email_editor';
        return $vars;
    }

    public function maybe_flush_rules(): void {
        if ((int) get_option(self::OPTION_REWRITE_VERSION, 0) === self::REWRITE_VERSION) return;

        flush_rewrite_rules(false);
        update_option(self::OPTION_REWRITE_VERSION, self::REWRITE_VERSION, false);
    }

    /**
     * Resolve a rota do construtor sem depender de rewrite rules.
     *
     * Roda depois de Kodety_Plugin::detect_direct_route (prioridade 0), cujo
     * padrão não casa com esta rota — então chegar aqui significa que nenhuma
     * rota do editor de sites foi reivindicada.
     */
    public function detect_direct_route(WP $wp): void {
        if (self::request_path() !== 'kodety/email-editor') return;
        $wp->query_vars = ['kodety_email_editor' => '1'];
    }

    /** Caminho da requisição relativo à home, sem barras nas pontas. */
    public static function request_path(): string {
        $path = trim(rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH)), '/');
        $home = trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');

        // Instalação em subdiretório: o prefixo da home não faz parte da rota.
        if ($home !== '' && str_starts_with($path, $home . '/')) {
            $path = trim(substr($path, strlen($home)), '/');
        }
        return $path;
    }

    /**
     * Serve a casca do construtor numa rota própria, com bundle próprio. O
     * editor de sites continua intocado em /kodety/editor/.
     */
    public function editor_template(string $template): string {
        if ((string) get_query_var('kodety_email_editor') === '') return $template;

        if (!is_user_logged_in()) {
            auth_redirect();
            exit;
        }
        if (!current_user_can(Kodety_Email_Schema::CAP_MANAGE)) {
            wp_die('Você não tem permissão para usar o construtor de email.', 'Acesso negado', ['response' => 403]);
        }

        status_header(200);
        nocache_headers();
        return KODETY_DIR . 'templates/email-editor-shell.php';
    }

    public static function editor_url(int $template_id = 0): string {
        $url = home_url('/kodety/email-editor/');
        return $template_id > 0 ? add_query_arg('template', $template_id, $url) : $url;
    }

    /**
     * Menu próprio, separado de "Emails".
     *
     * "Emails" é a caixa de entrada dos formulários do site — recebe mensagens.
     * Marketing envia campanhas. Empilhar os dois no mesmo menu fazia parecer
     * um sistema só e confundia o que cada tela faz.
     */
    public function admin_menu(): void {
        $i18n = class_exists('Kodety_Admin_I18n') ? Kodety_Admin_I18n::instance() : null;
        $translate = static fn(string $source): string => $i18n ? $i18n->translate($source) : $source;
        // A página do topo é Campanhas: um menu cujo primeiro clique cai numa
        // visão geral vazia só adiciona um passo.
        add_menu_page(
            $translate('Onun Kodety Email Marketing'),
            $translate('Marketing'),
            Kodety_Email_Schema::CAP_VIEW,
            self::PAGE_CAMPAIGNS,
            [Kodety_Email_Admin_Campaigns::class, 'render'],
            'dashicons-megaphone',
            // Posição fracionária evita sobrescrever outro menu que já ocupe
            // um índice inteiro vizinho.
            26.5
        );

        $pages = [
            [self::PAGE_CAMPAIGNS, 'Campanhas', 'Campanhas', Kodety_Email_Schema::CAP_VIEW, [Kodety_Email_Admin_Campaigns::class, 'render']],
            [self::PAGE_TEMPLATES, 'Templates de email', 'Templates', Kodety_Email_Schema::CAP_VIEW, [Kodety_Email_Admin_Templates::class, 'render']],
            [self::PAGE_CONTACTS, 'Contatos', 'Contatos', Kodety_Email_Schema::CAP_VIEW, [Kodety_Email_Admin_Audience::class, 'render_contacts']],
            [self::PAGE_LISTS, 'Listas', 'Listas', Kodety_Email_Schema::CAP_VIEW, [Kodety_Email_Admin_Audience::class, 'render_lists']],
            [self::PAGE_HEALTH, 'Saúde de entrega', 'Saúde de entrega', Kodety_Email_Schema::CAP_VIEW, [Kodety_Email_Admin::class, 'render_health']],
            [self::PAGE_SETTINGS, 'Email Marketing — Configurações', 'Config. de envio', Kodety_Email_Schema::CAP_MANAGE, [Kodety_Email_Admin::class, 'render_settings']],
        ];

        foreach ($pages as [$slug, $title, $label, $capability, $callback]) {
            add_submenu_page(self::PAGE_CAMPAIGNS, $translate($title), $translate($label), $capability, $slug, $callback);
        }
    }

    public function admin_assets(string $hook): void {
        $pages = [self::PAGE_CAMPAIGNS, self::PAGE_TEMPLATES, self::PAGE_CONTACTS, self::PAGE_LISTS, self::PAGE_HEALTH, self::PAGE_SETTINGS];
        $matched = false;
        foreach ($pages as $page) {
            if (str_contains($hook, $page)) $matched = true;
        }
        if (!$matched) return;

        // A UI reusa a folha de Emails para herdar exatamente a mesma
        // linguagem visual (tabs, cards, tabelas) e só adiciona o que é novo.
        $base = KODETY_DIR . 'admin/emails.css';
        wp_enqueue_style(
            'kodety-emails',
            KODETY_URL . 'admin/emails.css',
            [],
            is_file($base) ? (string) filemtime($base) : KODETY_VERSION
        );

        $extension_dir = defined('KODETY_MARKETING_DIR') ? KODETY_MARKETING_DIR : KODETY_DIR;
        $extension_url = defined('KODETY_MARKETING_URL') ? KODETY_MARKETING_URL : KODETY_URL;
        $css = $extension_dir . 'admin/email-marketing.css';
        wp_enqueue_style(
            'kodety-email-marketing',
            $extension_url . 'admin/email-marketing.css',
            ['kodety-emails'],
            is_file($css) ? (string) filemtime($css) : KODETY_VERSION
        );

        $icons = KODETY_DIR . 'admin/components/kodety-icons.bundle.js';
        wp_enqueue_script('kodety-admin-icons', KODETY_URL . 'admin/components/kodety-icons.bundle.js', [], is_file($icons) ? (string) filemtime($icons) : KODETY_VERSION, true);

        $js = $extension_dir . 'admin/email-marketing.js';
        wp_enqueue_script(
            'kodety-email-marketing',
            $extension_url . 'admin/email-marketing.js',
            ['kodety-admin-icons'],
            is_file($js) ? (string) filemtime($js) : KODETY_VERSION,
            true
        );
    }

    // --- REST -------------------------------------------------------------

    public function register_routes(): void {
        $can_manage = static fn(): bool => current_user_can(Kodety_Email_Schema::CAP_MANAGE);

        Kodety_Email_Bounces::register_route();
        register_rest_route('kodety/v1', '/email/campaigns/(?P<id>\d+)/tick', [
            'methods' => 'POST',
            'permission_callback' => $can_manage,
            'callback' => [$this, 'rest_tick'],
        ]);
        register_rest_route('kodety/v1', '/email/templates', [
            'methods' => 'POST',
            'permission_callback' => $can_manage,
            'callback' => [$this, 'rest_create_template'],
        ]);
        register_rest_route('kodety/v1', '/email/templates/(?P<id>\d+)', [
            [
                'methods' => 'GET',
                'permission_callback' => $can_manage,
                'callback' => [$this, 'rest_get_template'],
            ],
            [
                'methods' => 'POST',
                'permission_callback' => $can_manage,
                'callback' => [$this, 'rest_update_template'],
            ],
        ]);
    }

    public function rest_get_template(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $template = Kodety_Email_Campaigns::get_template(absint($request['id']));
        if (!$template) return new WP_Error('kodety_email_template_missing', 'Template não encontrado.', ['status' => 404]);

        return new WP_REST_Response(self::template_payload($template), 200);
    }

    public function rest_create_template(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = Kodety_Email_Campaigns::save_template(self::template_input($request));
        $template = $id > 0 ? Kodety_Email_Campaigns::get_template($id) : null;
        if (!$template) {
            return new WP_Error(
                'kodety_email_template_create_failed',
                'Não foi possível criar o template no banco de dados. Seu rascunho local foi preservado.',
                ['status' => 500]
            );
        }
        return new WP_REST_Response(self::template_payload($template), 201);
    }

    public function rest_update_template(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $id = absint($request['id']);
        $result = Kodety_Email_Campaigns::save_template_if_revision(
            $id,
            self::template_input($request),
            sanitize_text_field((string) $request->get_param('expected_revision'))
        );
        if ($result['reason'] === 'missing') {
            return new WP_Error('kodety_email_template_missing', 'Template não encontrado.', ['status' => 404]);
        }
        if ($result['reason'] === 'conflict') {
            return new WP_Error(
                'kodety_email_template_conflict',
                'Este template foi salvo em outra aba. Seu rascunho local foi preservado; recarregue para comparar antes de salvar novamente.',
                ['status' => 409]
            );
        }
        if (!$result['ok']) {
            return new WP_Error(
                'kodety_email_template_save_failed',
                'Não foi possível salvar o template no banco de dados.',
                ['status' => 500]
            );
        }
        return new WP_REST_Response(self::template_payload(Kodety_Email_Campaigns::get_template($id) ?? []), 200);
    }

    /**
     * O HTML do construtor é gerado por código nosso e vai para dentro de um
     * email, não para uma página do site — passar por wp_kses aqui destruiria
     * os conditional comments do Outlook e os atributos de tabela.
     */
    private static function template_input(WP_REST_Request $request): array {
        return [
            'name' => (string) $request->get_param('name'),
            'html' => (string) $request->get_param('html'),
            'text_body' => (string) $request->get_param('text_body'),
            'project_json' => (string) $request->get_param('project_json'),
        ];
    }

    private static function template_payload(array $template): array {
        return [
            'id' => (int) ($template['id'] ?? 0),
            'name' => (string) ($template['name'] ?? ''),
            'html' => (string) ($template['html'] ?? ''),
            'projectJson' => $template['project_json'] ?? null,
            'updatedAt' => (string) ($template['updated_at'] ?? ''),
            'revision' => Kodety_Email_Campaigns::template_revision($template),
        ];
    }

    /**
     * O motor do envio manual: enquanto a tela da campanha está aberta, ela
     * chama esta rota e processa um lote por vez. É o que dispensa cron
     * configurado e tráfego no site.
     */
    public function rest_tick(WP_REST_Request $request): WP_REST_Response {
        $id = absint($request['id']);
        $campaign = Kodety_Email_Campaigns::get($id);

        if (!$campaign || $campaign['status'] !== 'sending') {
            $progress = Kodety_Email_Queue::progress($id);
            return new WP_REST_Response([
                'sent' => $progress['sent'],
                'failed' => $progress['failed'],
                'skipped' => $progress['skipped'],
                'pending' => $campaign && $campaign['status'] === 'paused' ? $progress['pending'] : 0,
                'total' => $progress['total'],
                'throttled' => false,
                'retry_after' => 0,
                'done' => !$campaign || $campaign['status'] !== 'paused',
                'status' => $campaign['status'] ?? 'missing',
            ], 200);
        }

        $result = Kodety_Email_Queue::tick($id);
        $progress = Kodety_Email_Queue::progress($id);
        $current = Kodety_Email_Campaigns::get($id);

        return new WP_REST_Response(array_merge($result, [
            'sent' => $progress['sent'],
            'failed' => $progress['failed'],
            'skipped' => $progress['skipped'],
            'total' => $progress['total'],
            'status' => $current['status'] ?? ($result['done'] ? 'sent' : 'sending'),
        ]), 200);
    }

    /** Retomada best-effort de campanhas cuja aba foi fechada. */
    public function cron_tick(): void {
        global $wpdb;

        $started = microtime(true);
        $ids = $wpdb->get_col(
            'SELECT id FROM ' . Kodety_Email_Schema::table('campaigns')
                . " WHERE status = 'sending' ORDER BY started_at ASC LIMIT 3"
        );
        foreach (is_array($ids) ? $ids : [] as $id) {
            if (microtime(true) - $started > 45.0) break;
            $this->cron_campaign_worker((int) $id);
        }
    }

    /**
     * Um evento processa no máximo um lote. Se ainda houver trabalho, agenda
     * o próximo conforme retry_after; concorrência com a aba é segura porque
     * a fila reivindica linhas com lock_token.
     */
    public function cron_campaign_worker(int $campaign_id): void {
        $campaign = Kodety_Email_Campaigns::get($campaign_id);
        if (!$campaign || (string) $campaign['status'] !== 'sending') {
            self::clear_campaign_worker($campaign_id);
            return;
        }

        $result = Kodety_Email_Queue::tick($campaign_id);
        $current = Kodety_Email_Campaigns::get($campaign_id);
        if (!empty($result['done']) || !$current || (string) $current['status'] !== 'sending') {
            self::clear_campaign_worker($campaign_id);
            return;
        }

        self::schedule_campaign_worker($campaign_id, max(2, (int) ($result['retry_after'] ?? 2)));
    }

    /**
     * Retenção de dados operacionais. Suppressions e consent_events não são
     * removidos: o primeiro impede reenvio e o segundo prova a decisão.
     *
     * @return array{events:int,queue:int,locked:bool}
     */
    public function cleanup(): array {
        global $wpdb;

        $lock = (int) get_option(self::CLEANUP_LOCK, 0);
        if ($lock > time() - 15 * MINUTE_IN_SECONDS) {
            return ['events' => 0, 'queue' => 0, 'locked' => true];
        }
        if ($lock > 0) delete_option(self::CLEANUP_LOCK);
        if (!add_option(self::CLEANUP_LOCK, time(), '', false)) {
            return ['events' => 0, 'queue' => 0, 'locked' => true];
        }

        $deleted_events = 0;
        $deleted_queue = 0;
        try {
            $days = max(30, min(3650, (int) Kodety_Email_Settings::get('retention_days')));
            $cutoff = gmdate('Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS);

            $wpdb->query($wpdb->prepare(
                'DELETE FROM ' . Kodety_Email_Schema::table('events') . ' WHERE occurred_at < %s',
                $cutoff
            ));
            $deleted_events = max(0, (int) $wpdb->rows_affected);

            $queue = Kodety_Email_Schema::table('queue');
            $campaigns = Kodety_Email_Schema::table('campaigns');
            $wpdb->query($wpdb->prepare(
                "DELETE q FROM {$queue} q
                 INNER JOIN {$campaigns} c ON c.id = q.campaign_id
                 WHERE c.status IN ('sent', 'failed')
                   AND q.status IN ('sent', 'failed', 'skipped')
                   AND COALESCE(q.sent_at, q.created_at) < %s",
                $cutoff
            ));
            $deleted_queue = max(0, (int) $wpdb->rows_affected);
        } finally {
            delete_option(self::CLEANUP_LOCK);
        }

        return ['events' => $deleted_events, 'queue' => $deleted_queue, 'locked' => false];
    }

    // --- Ações de configuração -------------------------------------------

    public function handle_save_settings(): void {
        $this->guard('kodety_email_save_settings', Kodety_Email_Schema::CAP_MANAGE);
        $saved = Kodety_Email_Settings::apply_form(wp_unslash($_POST));
        if (is_wp_error($saved)) {
            $this->redirect(self::PAGE_SETTINGS, [
                'done' => 'error',
                'message' => rawurlencode($saved->get_error_message()),
            ]);
        }
        Kodety_Email_Health::flush();
        $this->redirect(self::PAGE_SETTINGS, ['updated' => '1']);
    }

    public function handle_generate_dkim(): void {
        $this->guard('kodety_email_generate_dkim', Kodety_Email_Schema::CAP_MANAGE);

        $settings = Kodety_Email_Settings::all();
        $domain = Kodety_Email_Settings::sender_domain();
        if ($domain === '') $this->redirect(self::PAGE_HEALTH, ['dkim' => 'nodomain']);

        try {
            $keys = Kodety_Email_Health::generate_dkim_keys($domain, (string) $settings['dkim_selector']);
        } catch (\Throwable $exception) {
            $this->redirect(self::PAGE_HEALTH, ['dkim' => 'error', 'message' => rawurlencode($exception->getMessage())]);
            return;
        }

        $saved = Kodety_Email_Settings::update([
            'dkim_domain' => $domain,
            'dkim_private_key' => $keys['private'],
            'dkim_public_key' => $keys['public'],
        ]);
        if (is_wp_error($saved)) {
            $this->redirect(self::PAGE_HEALTH, [
                'dkim' => 'error',
                'message' => rawurlencode($saved->get_error_message()),
            ]);
        }
        Kodety_Email_Health::flush();
        $this->redirect(self::PAGE_HEALTH, ['dkim' => 'generated']);
    }

    public function handle_send_test(): void {
        $this->guard('kodety_email_send_test', Kodety_Email_Schema::CAP_MANAGE);

        $to = sanitize_email((string) wp_unslash($_POST['test_email'] ?? ''));
        if ($to === '' || !is_email($to)) $this->redirect(self::PAGE_HEALTH, ['test' => 'invalid']);

        $settings = Kodety_Email_Settings::all();
        $transport = Kodety_Email_Transport::instance();
        $result = $transport->send([
            'to' => $to,
            'subject' => 'Teste de entrega — ' . get_bloginfo('name'),
            'html' => $this->test_message_html(),
            'text' => $this->test_message_text(),
            'settings' => $settings,
        ]);
        $transport->close();
        Kodety_Email_Health::record_delivery_test(
            (bool) $result['ok'],
            $to,
            $settings,
            (string) ($result['error'] ?? '')
        );

        $this->redirect(self::PAGE_HEALTH, $result['ok']
            ? ['test' => 'sent']
            : ['test' => 'failed', 'message' => rawurlencode($result['error'])]);
    }

    public function handle_recheck(): void {
        $this->guard('kodety_email_recheck', Kodety_Email_Schema::CAP_VIEW);
        Kodety_Email_Health::flush();
        Kodety_Email_Health::report(true);
        $this->redirect(self::PAGE_HEALTH, ['rechecked' => '1']);
    }

    // --- Ações de audiência ----------------------------------------------

    public function handle_create_list(): void {
        $this->guard('kodety_email_create_list', Kodety_Email_Schema::CAP_MANAGE);

        $id = Kodety_Email_Contacts::create_list(
            (string) wp_unslash($_POST['name'] ?? ''),
            (string) wp_unslash($_POST['description'] ?? '')
        );
        $this->redirect(self::PAGE_LISTS, $id > 0
            ? ['done' => 'list_created']
            : ['done' => 'error', 'message' => rawurlencode('Informe um nome para a lista.')]);
    }

    public function handle_delete_list(): void {
        $this->guard('kodety_email_delete_list', Kodety_Email_Schema::CAP_MANAGE);
        $result = Kodety_Email_Contacts::delete_list(absint($_POST['list_id'] ?? 0));
        if (!$result['ok']) {
            $message = match ($result['reason']) {
                'referenced' => sprintf(
                    'Esta lista é usada por %d campanha(s) em rascunho, com falha ou agendada. Troque a audiência dessas campanhas antes de apagar a lista.',
                    (int) $result['campaign_count']
                ),
                'not_found' => 'A lista não existe mais.',
                default => 'Não foi possível apagar a lista. Tente novamente.',
            };
            $this->redirect(self::PAGE_LISTS, [
                'done' => 'error',
                'message' => rawurlencode($message),
            ]);
        }
        $this->redirect(self::PAGE_LISTS, ['done' => 'list_deleted']);
    }

    public function handle_add_contact(): void {
        $this->guard('kodety_email_add_contact', Kodety_Email_Schema::CAP_MANAGE);

        $consent_confirmed = !empty($_POST['consent_confirmed']);
        $contact_id = Kodety_Email_Contacts::upsert([
            'email' => (string) wp_unslash($_POST['email'] ?? ''),
            'name' => (string) wp_unslash($_POST['name'] ?? ''),
            'status' => $consent_confirmed ? 'subscribed' : 'pending',
            'consent_source' => $consent_confirmed ? 'manual_confirmed' : 'manual',
        ]);
        if ($contact_id === 0) {
            $this->redirect(self::PAGE_CONTACTS, ['done' => 'error', 'message' => rawurlencode('Endereço de email inválido.')]);
        }
        $contact = Kodety_Email_Contacts::get($contact_id);
        if ($consent_confirmed && $contact && (string) $contact['status'] === 'pending') {
            Kodety_Email_Contacts::set_status_many([$contact_id], 'subscribed', 'manual_confirmed');
        }

        $list_id = absint($_POST['list_id'] ?? 0);
        if ($list_id > 0 && !Kodety_Email_Contacts::add_to_list($list_id, $contact_id, 'manual')) {
            $this->redirect(self::PAGE_CONTACTS, [
                'done' => 'error',
                'message' => rawurlencode('O contato foi criado, mas a lista selecionada não existe mais. Associe-o a outra lista.'),
            ]);
        }

        $this->redirect(self::PAGE_CONTACTS, ['done' => 'contact_added']);
    }

    public function handle_import_csv(): void {
        $this->guard('kodety_email_import_csv', Kodety_Email_Schema::CAP_MANAGE);

        $file = $_FILES['csv'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            $this->redirect(self::PAGE_CONTACTS, ['done' => 'error', 'message' => rawurlencode('Não foi possível ler o arquivo enviado.')]);
        }

        // Importação é síncrona e limitada a 5 mil linhas; 4 MB evita prender
        // um worker PHP com uma base que deveria ser dividida em lotes.
        if ((int) ($file['size'] ?? 0) > 4 * MB_IN_BYTES) {
            $this->redirect(self::PAGE_CONTACTS, ['done' => 'error', 'message' => rawurlencode('O arquivo excede 4 MB.')]);
        }

        $list_id = absint($_POST['list_id'] ?? 0);
        if ($list_id > 0 && !Kodety_Email_Contacts::get_list($list_id)) {
            $this->redirect(self::PAGE_CONTACTS, [
                'done' => 'error',
                'message' => rawurlencode('A lista de destino não existe mais. Escolha outra lista e envie o CSV novamente.'),
            ]);
        }

        $result = Kodety_Email_Contacts::import_csv_file(
            (string) $file['tmp_name'],
            $list_id,
            'import',
            !empty($_POST['consent_confirmed'])
        );

        $summary = sprintf(
            '%d novos, %d atualizados, %d suprimidos ignorados, %d inválidos, %d não gravados.',
            $result['imported'],
            $result['updated'],
            $result['skipped'],
            $result['invalid'],
            $result['failed']
        );
        if (!empty($result['limited'])) {
            $summary .= ' Limite de 5.000 linhas atingido; divida o restante em outro arquivo.';
        }
        $this->redirect(self::PAGE_CONTACTS, ['done' => 'imported', 'message' => rawurlencode($summary)]);
    }

    public function handle_bulk_contacts(): void {
        $this->guard('kodety_email_bulk_contacts', Kodety_Email_Schema::CAP_MANAGE);

        $bulk = sanitize_key((string) wp_unslash($_POST['bulk_action'] ?? ''));
        $list_id = absint($_POST['list_id'] ?? 0);

        // "Todos que correspondem" resolve os ids pelo mesmo filtro da tela, em
        // vez de confiar nas caixas marcadas — que só cobrem a página atual.
        if (!empty($_POST['select_all_matching'])) {
            $filter_args = [
                'search' => sanitize_text_field((string) wp_unslash($_POST['filter_s'] ?? '')),
                'status' => sanitize_key((string) wp_unslash($_POST['filter_status'] ?? '')),
                'list_id' => absint($_POST['filter_list'] ?? 0),
            ];
            $count = Kodety_Email_Contacts::paginate(array_merge($filter_args, [
                'page' => 1,
                'per_page' => 1,
            ]))['total'];
            $limit = Kodety_Email_Contacts::bulk_selection_limit();
            if ($count > $limit) {
                $this->redirect(self::PAGE_CONTACTS, [
                    'done' => 'error',
                    'message' => rawurlencode(sprintf(
                        'O filtro corresponde a %d contatos. Refine-o para no máximo %d por operação.',
                        $count,
                        $limit
                    )),
                ]);
            }
            $ids = Kodety_Email_Contacts::ids_for_query($filter_args);
        } else {
            $ids = array_map('absint', (array) ($_POST['contact_ids'] ?? []));
        }
        $ids = array_values(array_filter($ids));

        if (!$bulk || !$ids) {
            $this->redirect(self::PAGE_CONTACTS, [
                'done' => 'error',
                'message' => rawurlencode('Selecione ao menos um contato e uma ação.'),
            ]);
        }

        $needs_list = in_array($bulk, ['add_to_list', 'remove_from_list'], true);
        if ($needs_list && $list_id === 0) {
            $this->redirect(self::PAGE_CONTACTS, [
                'done' => 'error',
                'message' => rawurlencode('Escolha a lista de destino.'),
            ]);
        }

        $affected = match ($bulk) {
            'add_to_list' => Kodety_Email_Contacts::add_many_to_list($list_id, $ids, 'manual'),
            'remove_from_list' => Kodety_Email_Contacts::remove_many_from_list($list_id, $ids),
            'subscribe' => Kodety_Email_Contacts::set_status_many($ids, 'subscribed', 'admin_bulk_resubscribe'),
            'unsubscribe' => Kodety_Email_Contacts::set_status_many($ids, 'unsubscribed', 'admin_bulk_unsubscribe'),
            'delete' => Kodety_Email_Contacts::delete_many($ids),
            default => 0,
        };

        $labels = [
            'add_to_list' => 'adicionado(s) à lista',
            'remove_from_list' => 'removido(s) da lista',
            'subscribe' => 'marcado(s) como inscrito',
            'unsubscribe' => 'marcado(s) como descadastrado',
            'delete' => 'apagado(s)',
        ];

        $this->redirect(self::PAGE_CONTACTS, [
            'done' => 'bulk',
            'count' => (string) $affected,
            'message' => rawurlencode((string) ($labels[$bulk] ?? '')),
        ]);
    }

    public function handle_sync_source(): void {
        $this->guard('kodety_email_sync_source', Kodety_Email_Schema::CAP_MANAGE);

        $list_id = absint($_POST['list_id'] ?? 0);
        if ($list_id === 0) {
            $this->redirect(self::PAGE_LISTS, ['done' => 'error', 'message' => rawurlencode('Escolha a lista de destino.')]);
        }

        $source = sanitize_key((string) wp_unslash($_POST['source'] ?? 'forms'));
        $synced = $source === 'members'
            ? Kodety_Email_Contacts::sync_from_members($list_id)
            : Kodety_Email_Contacts::sync_from_forms($list_id);

        $this->redirect(self::PAGE_LISTS, ['done' => 'synced', 'count' => (string) $synced]);
    }

    // --- Ações de campanha ------------------------------------------------

    public function handle_create_campaign(): void {
        $this->guard('kodety_email_create_campaign', Kodety_Email_Schema::CAP_MANAGE);

        $id = Kodety_Email_Campaigns::create(['name' => (string) wp_unslash($_POST['name'] ?? '')]);
        $this->redirect(self::PAGE_CAMPAIGNS, ['campaign' => (string) $id, 'done' => 'campaign_saved']);
    }

    public function handle_save_campaign(): void {
        $this->guard('kodety_email_save_campaign', Kodety_Email_Schema::CAP_MANAGE);

        $id = absint($_POST['campaign_id'] ?? 0);
        $campaign = Kodety_Email_Campaigns::get($id);
        if (!$campaign || !Kodety_Email_Campaigns::is_editable($campaign)) {
            $this->redirect(self::PAGE_CAMPAIGNS, [
                'campaign' => (string) $id,
                'done' => 'error',
                'message' => rawurlencode('Esta campanha não pode mais ser editada. Duplique-a para criar uma nova versão.'),
            ]);
        }
        $draft = [
            'name' => (string) wp_unslash($_POST['name'] ?? ''),
            'subject' => (string) wp_unslash($_POST['subject'] ?? ''),
            'preheader' => (string) wp_unslash($_POST['preheader'] ?? ''),
            'template_id' => absint($_POST['template_id'] ?? 0),
        ];
        $list_ids = (array) ($_POST['list_ids'] ?? []);
        $result = Kodety_Email_Campaigns::save_draft_if_revision(
            $id,
            $draft,
            $list_ids,
            sanitize_text_field((string) wp_unslash($_POST['expected_revision'] ?? ''))
        );
        if (!$result['ok']) {
            if ($result['reason'] === 'conflict') {
                Kodety_Email_Campaigns::stash_draft_recovery($id, $draft, $list_ids);
                $this->redirect(self::PAGE_CAMPAIGNS, [
                    'campaign' => (string) $id,
                    'done' => 'campaign_conflict',
                ]);
            }

            $message = match ($result['reason']) {
                'missing' => 'A campanha não existe mais.',
                'locked' => 'A campanha começou a enviar em outra aba. Suas alterações não foram aplicadas.',
                'invalid_audience' => 'Uma lista selecionada não existe mais. Revise o público da campanha e salve novamente.',
                'invalid_template' => 'O template selecionado não existe mais. Escolha outro conteúdo e salve novamente.',
                default => 'Não foi possível salvar a campanha. Tente novamente sem fechar esta tela.',
            };
            $this->redirect(self::PAGE_CAMPAIGNS, [
                'campaign' => (string) $id,
                'done' => 'error',
                'message' => rawurlencode($message),
            ]);
        }

        $this->redirect(self::PAGE_CAMPAIGNS, ['campaign' => (string) $id, 'done' => 'campaign_saved']);
    }

    public function handle_send_campaign(): void {
        $this->guard('kodety_email_send_campaign', Kodety_Email_Schema::CAP_MANAGE);

        $id = absint($_POST['campaign_id'] ?? 0);
        $result = Kodety_Email_Campaigns::send(
            $id,
            sanitize_text_field((string) wp_unslash($_POST['expected_revision'] ?? '')),
            absint($_POST['expected_audience_size'] ?? 0),
            sanitize_text_field((string) wp_unslash($_POST['expected_audience_signature'] ?? ''))
        );

        $this->redirect(self::PAGE_CAMPAIGNS, $result['ok']
            ? ['campaign' => (string) $id, 'done' => 'campaign_queued', 'count' => (string) $result['queued']]
            : ['campaign' => (string) $id, 'done' => 'error', 'message' => rawurlencode($result['error'])]);
    }

    public function handle_test_campaign(): void {
        $this->guard('kodety_email_test_campaign', Kodety_Email_Schema::CAP_MANAGE);

        $id = absint($_POST['campaign_id'] ?? 0);
        $result = Kodety_Email_Campaigns::send_test(
            $id,
            (string) wp_unslash($_POST['test_email'] ?? ''),
            sanitize_text_field((string) wp_unslash($_POST['expected_revision'] ?? ''))
        );

        $this->redirect(self::PAGE_CAMPAIGNS, $result['ok']
            ? ['campaign' => (string) $id, 'done' => 'test_sent']
            : ['campaign' => (string) $id, 'done' => 'error', 'message' => rawurlencode($result['error'])]);
    }

    public function handle_delete_template(): void {
        $this->guard('kodety_email_delete_template', Kodety_Email_Schema::CAP_MANAGE);
        $result = Kodety_Email_Campaigns::delete_template(absint($_POST['template_id'] ?? 0));
        if ($result['ok']) {
            $this->redirect(self::PAGE_TEMPLATES, ['done' => 'template_deleted']);
        }

        $message = match ($result['reason']) {
            'used' => sprintf(
                'Este template está ligado a %d campanha(s). Reatribua ou apague essas campanhas antes de remover o conteúdo.',
                (int) $result['usage']
            ),
            'missing' => 'Template não encontrado.',
            default => 'Não foi possível apagar o template no banco de dados.',
        };
        $this->redirect(self::PAGE_TEMPLATES, [
            'done' => 'error',
            'message' => rawurlencode($message),
        ]);
    }

    public function handle_duplicate_template(): void {
        $this->guard('kodety_email_duplicate_template', Kodety_Email_Schema::CAP_MANAGE);
        $copy_id = Kodety_Email_Campaigns::duplicate_template(absint($_POST['template_id'] ?? 0));
        $this->redirect(self::PAGE_TEMPLATES, $copy_id > 0
            ? ['done' => 'template_duplicated', 'template' => (string) $copy_id]
            : ['done' => 'error', 'message' => rawurlencode('Template não encontrado.')]);
    }

    public function handle_duplicate_campaign(): void {
        $this->guard('kodety_email_duplicate_campaign', Kodety_Email_Schema::CAP_MANAGE);

        $copy_id = Kodety_Email_Campaigns::duplicate(absint($_POST['campaign_id'] ?? 0));
        $this->redirect(self::PAGE_CAMPAIGNS, $copy_id > 0
            ? ['campaign' => (string) $copy_id, 'done' => 'duplicated']
            : ['done' => 'error', 'message' => rawurlencode('Campanha não encontrada.')]);
    }

    public function handle_cancel_schedule(): void {
        $this->guard('kodety_email_cancel_schedule', Kodety_Email_Schema::CAP_MANAGE);

        $id = absint($_POST['campaign_id'] ?? 0);
        $cancelled = Kodety_Email_Scheduler::cancel($id);
        $this->redirect(self::PAGE_CAMPAIGNS, $cancelled
            ? ['campaign' => (string) $id, 'done' => 'schedule_cancelled']
            : [
                'campaign' => (string) $id,
                'done' => 'error',
                'message' => rawurlencode('A campanha não está agendada.'),
            ]);
    }

    public function handle_delete_campaign(): void {
        $this->guard('kodety_email_delete_campaign', Kodety_Email_Schema::CAP_MANAGE);

        $id = absint($_POST['campaign_id'] ?? 0);
        if (!Kodety_Email_Campaigns::delete($id)) {
            $this->redirect(self::PAGE_CAMPAIGNS, [
                'campaign' => (string) $id,
                'done' => 'error',
                'message' => rawurlencode('Não é possível apagar uma campanha enquanto ela está enviando ou pausada.'),
            ]);
        }
        self::clear_campaign_worker($id);
        Kodety_Email_Scheduler::clear_legacy_event($id);
        $this->redirect(self::PAGE_CAMPAIGNS, ['done' => 'campaign_deleted']);
    }

    public function handle_pause_campaign(): void {
        $this->guard('kodety_email_pause_campaign', Kodety_Email_Schema::CAP_MANAGE);
        $id = absint($_POST['campaign_id'] ?? 0);
        Kodety_Email_Campaigns::pause($id);
        $this->redirect(self::PAGE_CAMPAIGNS, ['campaign' => (string) $id]);
    }

    public function handle_resume_campaign(): void {
        $this->guard('kodety_email_resume_campaign', Kodety_Email_Schema::CAP_MANAGE);
        $id = absint($_POST['campaign_id'] ?? 0);
        $result = Kodety_Email_Campaigns::resume($id);
        $this->redirect(self::PAGE_CAMPAIGNS, $result['ok']
            ? ['campaign' => (string) $id]
            : [
                'campaign' => (string) $id,
                'done' => 'error',
                'message' => rawurlencode($result['error']),
            ]);
    }

    public function handle_reconcile_campaign_ack(): void {
        $this->guard('kodety_email_reconcile_campaign_ack', Kodety_Email_Schema::CAP_MANAGE);
        $id = absint($_POST['campaign_id'] ?? 0);
        $result = Kodety_Email_Campaigns::reconcile_transport_ack(
            $id,
            absint($_POST['queue_id'] ?? 0)
        );
        $this->redirect(self::PAGE_CAMPAIGNS, $result['ok']
            ? ['campaign' => (string) $id, 'done' => 'campaign_ack_reconciled']
            : [
                'campaign' => (string) $id,
                'done' => 'error',
                'message' => rawurlencode($result['error']),
            ]);
    }

    // --- Utilidades -------------------------------------------------------

    private function test_message_html(): string {
        $domain = esc_html(Kodety_Email_Settings::sender_domain());
        return '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">'
            . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;">'
            . '<tr><td style="padding:32px;color:#1c1e21;font-size:15px;line-height:1.6;">'
            . '<h1 style="margin:0 0 12px;font-size:20px;color:#111;">A entrega está funcionando</h1>'
            . '<p style="margin:0 0 16px;color:#444;">Este é o email de teste do módulo de Email Marketing do Onun Kodety, enviado por <strong>' . $domain . '</strong>.</p>'
            . '<p style="margin:0;color:#666;font-size:13px;">Abra o cabeçalho original desta mensagem e confira <strong>dkim=pass</strong> e <strong>spf=pass</strong>. Se os dois passarem, o domínio está autenticado.</p>'
            . '</td></tr></table></td></tr></table></body></html>';
    }

    private function test_message_text(): string {
        return "A entrega está funcionando.\n\n"
            . 'Email de teste do módulo de Email Marketing do Onun Kodety, enviado por '
            . Kodety_Email_Settings::sender_domain() . ".\n\n"
            . "Abra o cabeçalho original e confira dkim=pass e spf=pass.\n";
    }

    private function guard(string $nonce_action, string $capability): void {
        if (!current_user_can($capability)) {
            wp_die('Você não tem permissão para esta ação.', 'Acesso negado', ['response' => 403]);
        }
        check_admin_referer($nonce_action);
    }

    /** @param array<string,string> $args */
    private function redirect(string $page, array $args): void {
        wp_safe_redirect(add_query_arg(array_merge(['page' => $page], $args), admin_url('admin.php')));
        exit;
    }
}
