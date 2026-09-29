<?php

defined('ABSPATH') || exit;

final class Kodety_Proposals_Addon {
    private const POST_TYPE = 'kodety_proposal';
    private const REST_NAMESPACE = 'kodety-proposals/v1';
    private const DATA_META = '_kodety_proposals_data';
    private const RESPONSES_META = '_kodety_proposals_responses';
    private const TEMPLATE_OPTION = 'kodety_proposals_template_path';
    private const ROUTE_VERSION_OPTION = 'kodety_proposals_addon_route_version';
    private const ROUTE_VERSION = '1';
    private const PROVIDER_ID = 'kodety-proposals';
    private const MAX_RESPONSES = 100;

    private static ?self $instance = null;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'register_post_type'], 4);
        add_action('init', [$this, 'register_routes'], 8);
        add_filter('query_vars', [$this, 'query_vars']);
        add_action('parse_request', [$this, 'detect_direct_route'], -5);
        add_action('template_redirect', [$this, 'serve_owned_route'], -120);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_filter('kodety_editor_shell_config', [$this, 'editor_shell_config'], 20, 2);
        add_filter('kodety_runtime_context', [$this, 'runtime_context']);
        add_action('wp_head', [$this, 'inject_public_runtime'], 2);
        add_filter('post_type_link', [$this, 'proposal_permalink'], 20, 2);
    }

    public static function activate(): void {
        $addon = self::instance();
        $addon->register_post_type();
        $addon->register_routes();
        flush_rewrite_rules(false);
    }

    public static function deactivate(): void {
        flush_rewrite_rules(false);
    }

    public function register_post_type(): void {
        register_post_type(self::POST_TYPE, [
            'labels' => ['name' => 'Propostas', 'singular_name' => 'Proposta'],
            'public' => true,
            'show_ui' => false,
            'show_in_rest' => false,
            'has_archive' => false,
            'rewrite' => ['slug' => 'proposta', 'with_front' => false],
            'supports' => ['title', 'author', 'revisions'],
            'capability_type' => 'page',
            'map_meta_cap' => true,
            'exclude_from_search' => true,
        ]);
    }

    public function register_routes(): void {
        add_rewrite_rule('^proposta/criar/?$', 'index.php?kodety_proposals_creator=1', 'top');
        add_rewrite_rule(
            '^proposta/_assets/(creator\.css|creator\.js|runtime\.js)$',
            'index.php?kodety_proposals_asset=$matches[1]',
            'top'
        );
        if ((string) get_option(self::ROUTE_VERSION_OPTION, '') !== self::ROUTE_VERSION) {
            update_option(self::ROUTE_VERSION_OPTION, self::ROUTE_VERSION, false);
            flush_rewrite_rules(false);
        }
    }

    public function query_vars(array $vars): array {
        $vars[] = 'kodety_proposals_creator';
        $vars[] = 'kodety_proposals_asset';
        return array_values(array_unique($vars));
    }

    public function detect_direct_route(WP $wp): void {
        $path = trim(rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)), '/');
        $home_path = trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');
        if ($home_path !== '' && ($path === $home_path || str_starts_with($path, $home_path . '/'))) {
            $path = trim(substr($path, strlen($home_path)), '/');
        }
        if ($path === 'proposta/criar') {
            $wp->query_vars = ['kodety_proposals_creator' => '1'];
            return;
        }
        if (preg_match('~^proposta/_assets/(creator\.css|creator\.js|runtime\.js)$~', $path, $matches)) {
            $wp->query_vars = ['kodety_proposals_asset' => (string) $matches[1]];
            return;
        }
        if (preg_match('~^proposta/([a-z0-9][a-z0-9-]{0,119})/?$~', $path, $matches)) {
            $wp->query_vars = ['post_type' => self::POST_TYPE, 'name' => sanitize_title((string) $matches[1])];
        }
    }

    public function serve_owned_route(): void {
        $asset = trim((string) get_query_var('kodety_proposals_asset'));
        if ($asset !== '') {
            $this->serve_asset($asset);
            exit;
        }
        if ((string) get_query_var('kodety_proposals_creator') !== '1') return;
        if (!is_user_logged_in() || !current_user_can('kodety_edit')) {
            auth_redirect();
            exit;
        }
        $this->render_creator();
        exit;
    }

    private function serve_asset(string $asset): void {
        if (!in_array($asset, ['creator.css', 'creator.js', 'runtime.js'], true)) {
            status_header(404);
            return;
        }
        $file = realpath(dirname(__DIR__) . '/assets/' . $asset);
        $root = realpath(dirname(__DIR__) . '/assets');
        if (!$root || !$file || !str_starts_with($file, trailingslashit($root)) || !is_file($file)) {
            status_header(404);
            return;
        }
        header('Content-Type: ' . (str_ends_with($asset, '.css') ? 'text/css; charset=UTF-8' : 'application/javascript; charset=UTF-8'));
        header('Cache-Control: public, max-age=3600');
        header('Content-Length: ' . (string) filesize($file));
        readfile($file);
    }

    public function register_rest_routes(): void {
        register_rest_route(self::REST_NAMESPACE, '/items', [
            ['methods' => 'GET', 'callback' => [$this, 'rest_list'], 'permission_callback' => [$this, 'can_edit']],
            ['methods' => 'POST', 'callback' => [$this, 'rest_save'], 'permission_callback' => [$this, 'can_edit']],
        ]);
        register_rest_route(self::REST_NAMESPACE, '/items/(?P<id>\d+)', [
            ['methods' => 'GET', 'callback' => [$this, 'rest_get'], 'permission_callback' => [$this, 'can_edit']],
            ['methods' => 'DELETE', 'callback' => [$this, 'rest_delete'], 'permission_callback' => [$this, 'can_edit']],
        ]);
        register_rest_route(self::REST_NAMESPACE, '/items/(?P<id>\d+)/response', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_response'],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::REST_NAMESPACE, '/template', [
            ['methods' => 'GET', 'callback' => [$this, 'rest_template'], 'permission_callback' => [$this, 'can_edit']],
            ['methods' => 'POST', 'callback' => [$this, 'rest_save_template'], 'permission_callback' => [$this, 'can_edit']],
        ]);
    }

    public function can_edit(): bool {
        return is_user_logged_in() && current_user_can('kodety_edit');
    }

    public function editor_shell_config(array $config, array $context): array {
        if (!$this->can_edit() || !empty($context['isShared'])) return $config;
        $providers = is_array($config['templateProviders'] ?? null) ? $config['templateProviders'] : [];
        $providers[] = [
            'id' => self::PROVIDER_ID,
            'name' => 'Proposta',
            'templatePath' => $this->template_path(),
            'templatesUrl' => rest_url(self::REST_NAMESPACE . '/template'),
            'fields' => self::fields(),
            'actions' => [
                ['id' => 'interested', 'label' => 'Tenho interesse em fechar'],
                ['id' => 'questions', 'label' => 'Ainda tenho dúvidas'],
            ],
        ];
        $config['templateProviders'] = $providers;
        return $config;
    }

    public function rest_template(): WP_REST_Response {
        return new WP_REST_Response(['templatePath' => $this->template_path()], 200);
    }

    public function rest_save_template(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $path = ltrim(str_replace('\\', '/', sanitize_text_field((string) $request->get_param('htmlPath'))), '/');
        if ($path !== '' && (!preg_match('/\.html?$/i', $path) || str_contains($path, '../') || str_contains($path, "\0"))) {
            return new WP_Error('kodety_proposals_invalid_template', 'Escolha uma página HTML válida.', ['status' => 400]);
        }
        update_option(self::TEMPLATE_OPTION, $path, false);
        return new WP_REST_Response(['templatePath' => $path], 200);
    }

    private function template_path(): string {
        $path = ltrim(str_replace('\\', '/', sanitize_text_field((string) get_option(self::TEMPLATE_OPTION, ''))), '/');
        return str_contains($path, '../') ? '' : $path;
    }

    public function runtime_context(array $context): array {
        if (!is_singular(self::POST_TYPE)) return $context;
        $path = $this->template_path();
        if ($path === '') return $context;
        $normalized = trim($path, '/');
        if (preg_match('~(?:^|/)index\.html?$~i', $normalized)) {
            $route = trim((string) preg_replace('~(?:^|/)index\.html?$~i', '', $normalized), '/');
        } else {
            $route = (string) preg_replace('/\.html?$/i', '', $normalized);
        }
        $context['route'] = $route;
        return $context;
    }

    public function inject_public_runtime(): void {
        if (!is_singular(self::POST_TYPE)) return;
        $post = get_queried_object();
        if (!$post instanceof WP_Post) return;
        $data = $this->proposal_data($post);
        $payload = [
            'provider' => self::PROVIDER_ID,
            'values' => $this->computed_values($post, $data),
            'responseEndpoint' => rest_url(self::REST_NAMESPACE . '/items/' . (int) $post->ID . '/response'),
            'responseToken' => wp_create_nonce('kodety_proposal_response_' . (int) $post->ID),
        ];
        echo '<meta name="robots" content="noindex,nofollow,noarchive">';
        echo '<script type="application/json" id="kodety-proposals-data">'
            . wp_json_encode($payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            . '</script>';
        echo '<script src="' . esc_url(home_url('/proposta/_assets/runtime.js')) . '" defer></script>';
    }

    public function proposal_permalink(string $permalink, WP_Post $post): string {
        if ($post->post_type !== self::POST_TYPE) return $permalink;
        return home_url(user_trailingslashit('proposta/' . sanitize_title($post->post_name ?: (string) $post->ID)));
    }

    public function rest_list(): WP_REST_Response {
        $posts = get_posts([
            'post_type' => self::POST_TYPE,
            'post_status' => ['publish', 'draft'],
            'posts_per_page' => 100,
            'orderby' => 'modified',
            'order' => 'DESC',
        ]);
        return new WP_REST_Response(['items' => array_map(fn(WP_Post $post): array => $this->proposal_payload($post), $posts)], 200);
    }

    public function rest_get(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $post = $this->proposal_post((int) $request['id']);
        return $post
            ? new WP_REST_Response($this->proposal_payload($post), 200)
            : new WP_Error('kodety_proposals_not_found', 'Proposta não encontrada.', ['status' => 404]);
    }

    public function rest_save(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $raw = $request->get_json_params();
        if (!is_array($raw)) return new WP_Error('kodety_proposals_invalid', 'Dados inválidos.', ['status' => 400]);
        $id = max(0, (int) ($raw['id'] ?? 0));
        if ($id > 0 && !$this->proposal_post($id)) {
            return new WP_Error('kodety_proposals_not_found', 'Proposta não encontrada.', ['status' => 404]);
        }
        $data = $this->sanitize_data($raw);
        if (is_wp_error($data)) return $data;
        $owner = get_page_by_path($data['slug'], OBJECT, self::POST_TYPE);
        if ($owner instanceof WP_Post && (int) $owner->ID !== $id) {
            return new WP_Error('kodety_proposals_slug_exists', 'Esta slug já está em uso.', ['status' => 409]);
        }
        $postarr = [
            'ID' => $id,
            'post_type' => self::POST_TYPE,
            'post_status' => 'publish',
            'post_name' => $data['slug'],
            'post_title' => $data['client_name'] . ' — ' . $data['proposal_title'],
        ];
        $saved = $id > 0 ? wp_update_post(wp_slash($postarr), true) : wp_insert_post(wp_slash($postarr), true);
        if (is_wp_error($saved) || (int) $saved <= 0) {
            return is_wp_error($saved) ? $saved : new WP_Error('kodety_proposals_save_failed', 'Não foi possível salvar.', ['status' => 500]);
        }
        update_post_meta((int) $saved, self::DATA_META, $data);
        $post = $this->proposal_post((int) $saved);
        return $post ? new WP_REST_Response($this->proposal_payload($post), $id > 0 ? 200 : 201) : new WP_Error('kodety_proposals_save_failed', 'Não foi possível reler a proposta.', ['status' => 500]);
    }

    public function rest_delete(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $post = $this->proposal_post((int) $request['id']);
        if (!$post) return new WP_Error('kodety_proposals_not_found', 'Proposta não encontrada.', ['status' => 404]);
        $deleted = wp_delete_post((int) $post->ID, true);
        return $deleted ? new WP_REST_Response(['deleted' => true], 200) : new WP_Error('kodety_proposals_delete_failed', 'Não foi possível excluir.', ['status' => 500]);
    }

    public function rest_response(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $post = $this->proposal_post((int) $request['id']);
        if (!$post) return new WP_Error('kodety_proposals_not_found', 'Proposta não encontrada.', ['status' => 404]);
        $token = sanitize_text_field((string) $request->get_param('token'));
        if (!wp_verify_nonce($token, 'kodety_proposal_response_' . (int) $post->ID)) {
            return new WP_Error('kodety_proposals_invalid_token', 'Esta proposta precisa ser recarregada.', ['status' => 403]);
        }
        $intent = sanitize_key((string) $request->get_param('intent'));
        if (!in_array($intent, ['interested', 'questions'], true)) {
            return new WP_Error('kodety_proposals_invalid_response', 'Resposta inválida.', ['status' => 400]);
        }
        $message = sanitize_textarea_field((string) $request->get_param('message'));
        $responses = get_post_meta((int) $post->ID, self::RESPONSES_META, true);
        if (!is_array($responses)) $responses = [];
        $responses[] = ['intent' => $intent, 'message' => $message, 'createdAt' => gmdate('c')];
        update_post_meta((int) $post->ID, self::RESPONSES_META, array_slice($responses, -self::MAX_RESPONSES));
        do_action('kodety_proposals_response_received', (int) $post->ID, end($responses));
        return new WP_REST_Response(['received' => true], 200);
    }

    private function proposal_post(int $id): ?WP_Post {
        $post = get_post($id);
        return $post instanceof WP_Post && $post->post_type === self::POST_TYPE ? $post : null;
    }

    private function proposal_data(WP_Post $post): array {
        $data = get_post_meta((int) $post->ID, self::DATA_META, true);
        return is_array($data) ? $data : [];
    }

    private function proposal_payload(WP_Post $post): array {
        $data = $this->proposal_data($post);
        return [
            'id' => (int) $post->ID,
            'slug' => (string) $post->post_name,
            'title' => (string) $post->post_title,
            'url' => $this->proposal_permalink('', $post),
            'modifiedAt' => get_post_modified_time('c', true, $post),
            'data' => $data,
            'values' => $this->computed_values($post, $data),
        ];
    }

    private function sanitize_data(array $raw): array|WP_Error {
        $truncate = static fn(string $value, int $limit): string => function_exists('mb_substr')
            ? mb_substr($value, 0, $limit)
            : substr($value, 0, $limit);
        $text = static fn(string $key, int $limit = 240): string => $truncate(sanitize_text_field((string) ($raw[$key] ?? '')), $limit);
        $textarea = static fn(string $key, int $limit = 12000): string => $truncate(sanitize_textarea_field((string) ($raw[$key] ?? '')), $limit);
        $client = $text('client_name', 160);
        $title = $text('proposal_title', 200);
        $slug = sanitize_title((string) ($raw['slug'] ?? $client));
        $total = max(0, (float) ($raw['total'] ?? 0));
        if ($client === '' || $title === '' || $slug === '') {
            return new WP_Error('kodety_proposals_required', 'Informe cliente, título e slug.', ['status' => 400]);
        }
        if ($total <= 0) return new WP_Error('kodety_proposals_total', 'O investimento deve ser maior que zero.', ['status' => 400]);
        if (in_array($slug, ['criar', '_assets'], true)) {
            return new WP_Error('kodety_proposals_reserved_slug', 'Escolha outra slug para a proposta.', ['status' => 400]);
        }
        return [
            'slug' => $slug,
            'client_name' => $client,
            'client_company' => $text('client_company', 160),
            'client_email' => sanitize_email((string) ($raw['client_email'] ?? '')),
            'client_image' => esc_url_raw((string) ($raw['client_image'] ?? '')),
            'proposal_title' => $title,
            'service_type' => $text('service_type', 160),
            'summary' => $textarea('summary', 3000),
            'objective' => $textarea('objective', 5000),
            'scope' => $textarea('scope'),
            'timeline' => $textarea('timeline'),
            'start_date' => $this->date_value($raw['start_date'] ?? ''),
            'delivery_date' => $this->date_value($raw['delivery_date'] ?? ''),
            'valid_until' => $this->date_value($raw['valid_until'] ?? ''),
            'currency' => in_array(strtoupper($text('currency', 3)), ['BRL', 'USD', 'EUR'], true) ? strtoupper($text('currency', 3)) : 'BRL',
            'total' => $total,
            'cash_discount_percent' => max(0, min(100, (float) ($raw['cash_discount_percent'] ?? 0))),
            'deposit_percent' => max(0, min(100, (float) ($raw['deposit_percent'] ?? 50))),
            'installments' => max(1, min(120, (int) ($raw['installments'] ?? 1))),
            'payment_notes' => $textarea('payment_notes', 5000),
            'terms' => $textarea('terms'),
            'contact_email' => sanitize_email((string) ($raw['contact_email'] ?? '')),
            'contact_whatsapp' => preg_replace('/[^0-9+]/', '', (string) ($raw['contact_whatsapp'] ?? '')),
            'accept_label' => $text('accept_label', 120) ?: 'Eu tenho interesse em fechar',
            'questions_label' => $text('questions_label', 120) ?: 'Ainda tenho algumas dúvidas',
        ];
    }

    private function date_value(mixed $value): string {
        $value = (string) $value;
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : '';
    }

    private function computed_values(WP_Post $post, array $data): array {
        $total = max(0, (float) ($data['total'] ?? 0));
        $discount = max(0, min(100, (float) ($data['cash_discount_percent'] ?? 0)));
        $deposit_percent = max(0, min(100, (float) ($data['deposit_percent'] ?? 50)));
        $installments = max(1, (int) ($data['installments'] ?? 1));
        $cash = $total * (1 - $discount / 100);
        $deposit = $total * ($deposit_percent / 100);
        $balance = max(0, $total - $deposit);
        $values = $data;
        $values['total_formatted'] = $this->money($total, (string) ($data['currency'] ?? 'BRL'));
        $values['cash_total'] = $cash;
        $values['cash_total_formatted'] = $this->money($cash, (string) ($data['currency'] ?? 'BRL'));
        $values['savings_total_formatted'] = $this->money($total - $cash, (string) ($data['currency'] ?? 'BRL'));
        $values['deposit_total'] = $deposit;
        $values['deposit_total_formatted'] = $this->money($deposit, (string) ($data['currency'] ?? 'BRL'));
        $values['balance_total'] = $balance;
        $values['balance_total_formatted'] = $this->money($balance, (string) ($data['currency'] ?? 'BRL'));
        $values['installment_total_formatted'] = $this->money($balance / $installments, (string) ($data['currency'] ?? 'BRL'));
        $values['public_url'] = $this->proposal_permalink('', $post);
        return $values;
    }

    private function money(float $value, string $currency): string {
        $symbols = ['BRL' => 'R$', 'USD' => 'US$', 'EUR' => '€'];
        return ($symbols[$currency] ?? $currency) . ' ' . number_format($value, 2, ',', '.');
    }

    public static function fields(): array {
        $field = static fn(string $key, string $label, string $type = 'text', string $group = 'Dados'): array => compact('key', 'label', 'type', 'group');
        return [
            $field('client_name', 'Nome do cliente'), $field('client_company', 'Empresa do cliente'),
            $field('client_email', 'E-mail do cliente'), $field('client_image', 'Imagem do cliente', 'image'),
            $field('proposal_title', 'Título da proposta'), $field('service_type', 'Tipo de serviço'),
            $field('summary', 'Resumo', 'richtext', 'Escopo'), $field('objective', 'Objetivo', 'richtext', 'Escopo'),
            $field('scope', 'Escopo', 'richtext', 'Escopo'), $field('timeline', 'Cronograma', 'richtext', 'Escopo'),
            $field('start_date', 'Data de início', 'date', 'Prazos'), $field('delivery_date', 'Data de entrega', 'date', 'Prazos'),
            $field('valid_until', 'Validade da proposta', 'date', 'Prazos'),
            $field('total_formatted', 'Investimento total', 'text', 'Investimento'),
            $field('cash_discount_percent', 'Desconto à vista (%)', 'number', 'Investimento'),
            $field('cash_total_formatted', 'Valor à vista', 'text', 'Investimento'),
            $field('savings_total_formatted', 'Economia à vista', 'text', 'Investimento'),
            $field('deposit_percent', 'Entrada (%)', 'number', 'Investimento'),
            $field('deposit_total_formatted', 'Valor da entrada', 'text', 'Investimento'),
            $field('balance_total_formatted', 'Saldo', 'text', 'Investimento'),
            $field('installments', 'Quantidade de parcelas', 'number', 'Investimento'),
            $field('installment_total_formatted', 'Valor da parcela', 'text', 'Investimento'),
            $field('payment_notes', 'Condições de pagamento', 'richtext', 'Investimento'),
            $field('terms', 'Termos', 'richtext', 'Condições'),
            $field('accept_label', 'Texto do botão de interesse', 'text', 'Resposta'),
            $field('questions_label', 'Texto do botão de dúvidas', 'text', 'Resposta'),
            $field('public_url', 'Link público', 'url', 'Resposta'),
        ];
    }

    private function render_creator(): void {
        $config = [
            'itemsUrl' => rest_url(self::REST_NAMESPACE . '/items'),
            'nonce' => wp_create_nonce('wp_rest'),
            'templatePath' => $this->template_path(),
            'builderUrl' => home_url('/kodety/editor/'),
        ];
        ?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Propostas — Onun Kodety</title>
    <link rel="stylesheet" href="<?php echo esc_url(home_url('/proposta/_assets/creator.css')); ?>">
    <script>window.kodetyProposals=<?php echo wp_json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES); ?>;</script>
</head>
<body>
<header class="topbar"><a href="<?php echo esc_url(home_url('/kodety/editor/')); ?>">← Builder</a><strong>Propostas</strong><span>Addon ativo</span></header>
<main class="layout">
    <aside class="library"><div class="library-head"><div><small>Biblioteca</small><h1>Propostas</h1></div><button type="button" data-new>Nova</button></div><div data-list class="proposal-list"></div></aside>
    <section class="editor">
        <div class="template-status <?php echo $this->template_path() === '' ? 'is-warning' : ''; ?>">
            <div><small>Template do Builder</small><strong><?php echo esc_html($this->template_path() ?: 'Nenhuma página definida'); ?></strong></div>
            <a href="<?php echo esc_url(home_url('/kodety/editor/')); ?>">Abrir Pages</a>
        </div>
        <form data-form>
            <input type="hidden" name="id" value="0">
            <section><header><small>01</small><h2>Cliente e proposta</h2></header><div class="grid two">
                <label>Nome do cliente<input required name="client_name"></label><label>Empresa<input name="client_company"></label>
                <label>E-mail<input type="email" name="client_email"></label><label>Imagem (URL)<input type="url" name="client_image"></label>
                <label class="wide">Título da proposta<input required name="proposal_title"></label><label>Tipo de serviço<input name="service_type"></label><label>Slug<input required name="slug" placeholder="nome-do-cliente"></label>
            </div></section>
            <section><header><small>02</small><h2>Escopo e prazos</h2></header><div class="grid two">
                <label class="wide">Resumo<textarea name="summary" rows="3"></textarea></label><label class="wide">Objetivo<textarea name="objective" rows="4"></textarea></label>
                <label class="wide">Escopo<textarea name="scope" rows="7" placeholder="Uma entrega por linha"></textarea></label><label class="wide">Cronograma<textarea name="timeline" rows="5"></textarea></label>
                <label>Início<input type="date" name="start_date"></label><label>Entrega<input type="date" name="delivery_date"></label><label>Validade<input type="date" name="valid_until"></label>
            </div></section>
            <section><header><small>03</small><h2>Investimento</h2></header><div class="grid four">
                <label>Moeda<select name="currency"><option>BRL</option><option>USD</option><option>EUR</option></select></label><label>Valor total<input required type="number" min="0" step="0.01" name="total"></label>
                <label>Desconto à vista (%)<input type="number" min="0" max="100" step="0.01" name="cash_discount_percent" value="0"></label><label>Entrada (%)<input type="number" min="0" max="100" step="0.01" name="deposit_percent" value="50"></label>
                <label>Parcelas<input type="number" min="1" max="120" name="installments" value="1"></label><label class="wide">Condições<textarea name="payment_notes" rows="4"></textarea></label>
                <label class="wide">Termos<textarea name="terms" rows="5"></textarea></label>
            </div></section>
            <section><header><small>04</small><h2>Resposta</h2></header><div class="grid two">
                <label>Texto de interesse<input name="accept_label" value="Eu tenho interesse em fechar"></label><label>Texto de dúvidas<input name="questions_label" value="Ainda tenho algumas dúvidas"></label>
                <label>E-mail de contato<input type="email" name="contact_email"></label><label>WhatsApp<input name="contact_whatsapp"></label>
            </div></section>
            <footer class="actions"><p data-status></p><button type="submit">Publicar proposta</button></footer>
        </form>
    </section>
</main>
<dialog data-success><button type="button" data-close>×</button><small>Proposta publicada</small><h2>Link pronto para enviar.</h2><input readonly data-public-url><div><button type="button" data-copy>Copiar link</button><a data-open target="_blank" rel="noopener">Abrir proposta</a></div></dialog>
<script src="<?php echo esc_url(home_url('/proposta/_assets/creator.js')); ?>" defer></script>
</body></html><?php
    }
}
