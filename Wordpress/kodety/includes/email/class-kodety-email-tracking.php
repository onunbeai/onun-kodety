<?php
/**
 * Abertura, clique e descadastro — sem webhook e sem serviço externo.
 *
 * Três endpoints públicos servidos pelo próprio WordPress:
 *   /kodety-email/o/<token>.gif   pixel de abertura
 *   /kodety-email/c/<token>?u=…   redirecionamento de clique assinado
 *   /kodety-email/u/<token>       descadastro
 *   /kodety-email/v/<token>       versão web da mensagem
 *
 * Todo token é um HMAC do par campanha+contato com o salt do site. Sem isso,
 * qualquer pessoa poderia descadastrar terceiros iterando ids — e o redirect
 * de clique viraria um open redirect.
 */

defined('ABSPATH') || exit;

final class Kodety_Email_Tracking {
    private static ?self $instance = null;

    private const QUERY_VAR = 'kodety_email_track';
    private const SIGNATURE_BYTES = 16;
    /** Um replay não grava mais de um clique da mesma URL nesta janela. */
    private const CLICK_DEDUPE_WINDOW = 900;

    public static function instance(): self {
        return self::$instance ??= new self();
    }

    private function __construct() {
        add_action('init', [$this, 'add_rewrite_rules'], 5);
        add_filter('query_vars', [$this, 'register_query_vars']);
        // Estes endereços são abertos pelo cliente de email do destinatário.
        // Um 404 aqui significa abertura e clique perdidos e descadastro
        // quebrado, então a rota não pode depender só da rewrite rule.
        add_action('parse_request', [$this, 'detect_direct_route'], 1);
        add_action('template_redirect', [$this, 'handle'], 0);
    }

    public function detect_direct_route(WP $wp): void {
        $path = Kodety_Email_Marketing::request_path();
        if (!preg_match('~^kodety-email/([ocuv])/([A-Za-z0-9_.-]+)$~', $path, $matches)) return;

        $wp->query_vars = [
            self::QUERY_VAR => $matches[1],
            'kodety_email_token' => $matches[2],
        ];
    }

    public function add_rewrite_rules(): void {
        add_rewrite_rule('^kodety-email/([ocuv])/([A-Za-z0-9_.-]+)/?$',
            'index.php?' . self::QUERY_VAR . '=$matches[1]&kodety_email_token=$matches[2]', 'top');
    }

    public function register_query_vars(array $vars): array {
        $vars[] = self::QUERY_VAR;
        $vars[] = 'kodety_email_token';
        return $vars;
    }

    public static function flush_rules(): void {
        self::instance()->add_rewrite_rules();
        flush_rewrite_rules(false);
    }

    // --- Geração de URLs --------------------------------------------------

    public static function open_url(int $campaign_id, int $contact_id): string {
        return home_url('/kodety-email/o/' . self::token('open', $campaign_id, $contact_id) . '.gif');
    }

    public static function click_url(int $campaign_id, int $contact_id, string $destination): string {
        $encoded = self::base64url_encode($destination);
        $token = self::token('click', $campaign_id, $contact_id, $destination);
        return add_query_arg('u', $encoded, home_url('/kodety-email/c/' . $token));
    }

    public static function unsubscribe_url(int $campaign_id, int $contact_id): string {
        return home_url('/kodety-email/u/' . self::token('unsub', $campaign_id, $contact_id));
    }

    public static function view_url(int $campaign_id, int $contact_id): string {
        return home_url('/kodety-email/v/' . self::token('view', $campaign_id, $contact_id));
    }

    private static function token(string $kind, int $campaign_id, int $contact_id, string $extra = ''): string {
        $payload = $kind . '|' . $campaign_id . '|' . $contact_id . '|' . $extra;
        $signature = hash_hmac('sha256', $payload, wp_salt('kodety_email'), true);
        return $campaign_id . '-' . $contact_id . '-' . self::base64url_encode(substr($signature, 0, self::SIGNATURE_BYTES));
    }

    /**
     * @return array{campaign_id:int,contact_id:int}|null
     */
    private static function verify(string $kind, string $token, string $extra = ''): ?array {
        $parts = explode('-', $token, 3);
        if (count($parts) !== 3) return null;

        $campaign_id = (int) $parts[0];
        $contact_id = (int) $parts[1];
        if ($contact_id <= 0) return null;

        $expected = self::token($kind, $campaign_id, $contact_id, $extra);
        // hash_equals evita vazar a posição do primeiro byte divergente.
        if (!hash_equals($expected, $token)) return null;

        return ['campaign_id' => $campaign_id, 'contact_id' => $contact_id];
    }

    // --- Endpoints --------------------------------------------------------

    public function handle(): void {
        $kind = (string) get_query_var(self::QUERY_VAR);
        if ($kind === '') return;

        $token = (string) get_query_var('kodety_email_token');

        switch ($kind) {
            case 'o':
                $this->serve_pixel(preg_replace('/\.gif$/', '', $token));
                return;
            case 'c':
                $this->serve_click($token);
                return;
            case 'u':
                $this->serve_unsubscribe($token);
                return;
            case 'v':
                $this->serve_view($token);
                return;
        }
    }

    private function serve_pixel(string $token): void {
        $claim = self::verify('open', $token);
        if ($claim) {
            // Primeira abertura é a métrica que interessa; repetições do mesmo
            // contato não inflam o relatório.
            self::record_once('open', $claim['campaign_id'], $claim['contact_id']);
        }

        // A query principal pode ter resolvido como 404; o pixel precisa sair
        // com 200 ou o cliente de email não registra a abertura.
        status_header(200);
        nocache_headers();
        header('Content-Type: image/gif');
        // GIF transparente 1x1.
        $pixel = (string) base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
        header('Content-Length: ' . strlen($pixel));
        echo $pixel;
        exit;
    }

    private function serve_click(string $token): void {
        $encoded = isset($_GET['u']) ? (string) wp_unslash($_GET['u']) : '';
        $destination = self::base64url_decode($encoded);

        $claim = $destination !== '' ? self::verify('click', $token, $destination) : null;
        if (!$claim) {
            // Assinatura inválida significa link adulterado. Manda para a home
            // em vez de redirecionar para onde o atacante quiser.
            wp_safe_redirect(home_url('/'), 302);
            exit;
        }

        // wp_sanitize_redirect + validação de esquema: só http(s) sai daqui.
        $scheme = strtolower((string) wp_parse_url($destination, PHP_URL_SCHEME));
        if (!in_array($scheme, ['http', 'https'], true)) {
            wp_safe_redirect(home_url('/'), 302);
            exit;
        }

        // Scanners e clientes podem requisitar o mesmo link repetidamente.
        // Mantemos cliques intencionais em momentos distintos, mas um replay
        // da mesma URL só ocupa uma linha por janela.
        self::record_windowed(
            'click',
            $claim['campaign_id'],
            $claim['contact_id'],
            $destination,
            self::CLICK_DEDUPE_WINDOW
        );

        nocache_headers();
        wp_redirect(wp_sanitize_redirect($destination), 302);
        exit;
    }

    private function serve_unsubscribe(string $token): void {
        $claim = self::verify('unsub', $token);
        if (!$claim) {
            wp_die('Link de descadastro inválido ou expirado.', 'Descadastro', ['response' => 400]);
        }

        $contact = Kodety_Email_Contacts::get($claim['contact_id']);
        if (!$contact) {
            wp_die('Contato não encontrado.', 'Descadastro', ['response' => 404]);
        }

        $is_post = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'POST';
        // RFC 8058 exige exatamente este parâmetro no corpo. Tratar qualquer
        // POST como one-click permitiria que scanners, proxies e formulários
        // genéricos descadastrassem o contato sem intenção.
        $one_click = $is_post && self::is_rfc8058_one_click();
        if ($is_post && !$one_click) {
            wp_die(
                'Requisição de descadastro automático inválida.',
                'Descadastro',
                ['response' => 400]
            );
        }

        $confirmed = $one_click
            || (isset($_GET['confirm']) && (string) wp_unslash($_GET['confirm']) === '1');

        if ($confirmed) {
            $unsubscribed = Kodety_Email_Contacts::unsubscribe(
                $claim['contact_id'],
                $claim['campaign_id'],
                $one_click ? 'list_unsubscribe_post' : 'unsubscribe_link'
            );
            if (!$unsubscribed) {
                wp_die(
                    'Não foi possível concluir o descadastro agora. Tente novamente.',
                    'Descadastro',
                    ['response' => 503]
                );
            }
            self::record_once('unsubscribe', $claim['campaign_id'], $claim['contact_id']);

            if ($one_click) {
                status_header(200);
                exit;
            }
            $this->render_page('Descadastro concluído',
                'Você não vai mais receber emails de ' . esc_html(get_bloginfo('name')) . '.', '');
        }

        $this->render_page(
            'Confirmar descadastro',
            'Você está prestes a parar de receber emails de ' . esc_html(get_bloginfo('name'))
                . ' no endereço <strong>' . esc_html((string) $contact['email']) . '</strong>.',
            '<a class="kodety-unsub-button" href="' . esc_url(add_query_arg('confirm', '1')) . '">Confirmar descadastro</a>'
        );
    }

    /**
     * Reconhece somente o corpo definido pelo RFC 8058:
     * `List-Unsubscribe=One-Click`.
     *
     * Lemos exclusivamente POST (nunca $_REQUEST, que também contém query
     * string). O fallback para php://input cobre servidores que não popularam
     * $_POST apesar de receberem o corpo form-urlencoded.
     */
    private static function is_rfc8058_one_click(): bool {
        if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
            return false;
        }

        $parameter = $_POST['List-Unsubscribe'] ?? null;
        if (is_scalar($parameter)) {
            $value = (string) $parameter;
            if (function_exists('wp_unslash')) $value = (string) wp_unslash($value);
            return hash_equals('One-Click', $value);
        }

        $raw_body = file_get_contents('php://input');
        if (!is_string($raw_body) || $raw_body === '') return false;

        $parsed = [];
        parse_str($raw_body, $parsed);
        $parameter = $parsed['List-Unsubscribe'] ?? null;
        return is_scalar($parameter) && hash_equals('One-Click', (string) $parameter);
    }

    private function serve_view(string $token): void {
        $claim = self::verify('view', $token);
        if (!$claim) {
            wp_die('Link da mensagem inválido ou expirado.', 'Ver no navegador', ['response' => 400]);
        }

        $campaign = Kodety_Email_Campaigns::get($claim['campaign_id']);
        $contact = Kodety_Email_Contacts::get($claim['contact_id']);
        if (!$campaign || !$contact) {
            wp_die('Mensagem não encontrada.', 'Ver no navegador', ['response' => 404]);
        }

        $settings = Kodety_Email_Settings::for_campaign($campaign);
        $message = Kodety_Email_Renderer::render($campaign, $contact, $settings);
        $html = self::browser_safe_html((string) $message['html']);

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=utf-8');
        header("Content-Security-Policy: default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: http: data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- HTML próprio da campanha, isolado por CSP.
        exit;
    }

    /**
     * Email permite markup que nunca deveria virar uma página ativa no mesmo
     * domínio do WordPress. O CSP é a defesa principal; esta limpeza remove
     * também vetores de navegação e execução em clientes antigos.
     */
    private static function browser_safe_html(string $html): string {
        $html = (string) preg_replace(
            '#<(script|iframe|object|embed|form|base)\b[^>]*>.*?</\1\s*>#is',
            '',
            $html
        );
        $html = (string) preg_replace('#<(script|iframe|object|embed|form|base)\b[^>]*/?>#is', '', $html);
        $html = (string) preg_replace('#<meta\b[^>]*http-equiv\s*=\s*(["\']?)(refresh|set-cookie)\1[^>]*>#is', '', $html);
        $html = (string) preg_replace('/\son[a-z]+\s*=\s*(["\']).*?\1/is', '', $html);
        $html = (string) preg_replace('/\son[a-z]+\s*=\s*[^\s>]+/is', '', $html);
        return $html;
    }

    private function render_page(string $title, string $message, string $action): void {
        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=utf-8');
        ?><!doctype html>
        <html lang="pt-BR"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="robots" content="noindex,nofollow">
        <title><?php echo esc_html($title); ?></title>
        <style>
            body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0f1113;color:#e9ecf0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
            main{width:min(440px,calc(100% - 40px));padding:32px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(255,255,255,.035);text-align:center}
            h1{margin:0 0 12px;font-size:20px;color:#fff}
            p{margin:0 0 20px;color:#9aa1ab}
            .kodety-unsub-button{display:inline-block;padding:11px 22px;border-radius:999px;background:#9393FF;color:#fff;font-weight:600;text-decoration:none}
        </style></head>
        <body><main><h1><?php echo esc_html($title); ?></h1><p><?php echo wp_kses_post($message); ?></p><?php echo wp_kses_post($action); ?></main></body></html>
        <?php
        exit;
    }

    // --- Eventos ----------------------------------------------------------

    public static function record(string $type, int $campaign_id, int $contact_id, string $url = ''): void {
        global $wpdb;

        $wpdb->insert(Kodety_Email_Schema::table('events'), [
            'campaign_id' => $campaign_id,
            'contact_id' => $contact_id,
            'type' => sanitize_key($type),
            'url' => mb_substr($url, 0, 2000),
            'ip_hash' => self::ip_hash(),
            'user_agent' => mb_substr(sanitize_text_field((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 500),
            'occurred_at' => Kodety_Email_Schema::now(),
        ]);
    }

    private static function record_once(string $type, int $campaign_id, int $contact_id): void {
        self::record_unique($type, $campaign_id, $contact_id);
    }

    /**
     * API idempotente para eventos que só podem existir uma vez por
     * campanha+contato+tipo+URL (por exemplo bounce e complaint vindos de
     * webhook/VERP, que podem sofrer retry).
     */
    public static function record_unique(
        string $type,
        int $campaign_id,
        int $contact_id,
        string $url = ''
    ): bool {
        return self::record_deduplicated($type, $campaign_id, $contact_id, $url);
    }

    private static function record_windowed(
        string $type,
        int $campaign_id,
        int $contact_id,
        string $url,
        int $window_seconds
    ): void {
        self::record_deduplicated(
            $type,
            $campaign_id,
            $contact_id,
            $url,
            max(1, $window_seconds)
        );
    }

    /**
     * SELECT + INSERT sozinho ainda permitiria duplicatas em duas requisições
     * simultâneas. O named lock serializa a chave lógica sem criar options ou
     * transients ilimitados. Se o lock estiver ocupado, descartamos somente a
     * métrica repetida; o redirect/pixel/descadastro continua respondendo.
     */
    private static function record_deduplicated(
        string $type,
        int $campaign_id,
        int $contact_id,
        string $url = '',
        int $window_seconds = 0
    ): bool {
        global $wpdb;

        $type = sanitize_key($type);
        if ($type === '' || $campaign_id < 0 || $contact_id <= 0) return false;

        $lock_name = 'kodety_email_evt_' . substr(
            hash('sha256', $type . '|' . $campaign_id . '|' . $contact_id . '|' . $url),
            0,
            40
        );
        $locked = (int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock_name)) === 1;
        if (!$locked) return false;

        try {
            $sql = 'SELECT COUNT(*) FROM ' . Kodety_Email_Schema::table('events')
                . ' WHERE campaign_id = %d AND contact_id = %d AND type = %s';
            $params = [$campaign_id, $contact_id, $type];
            if ($url !== '') {
                $sql .= ' AND url = %s';
                $params[] = $url;
            }
            if ($window_seconds > 0) {
                $sql .= ' AND occurred_at >= %s';
                $params[] = gmdate('Y-m-d H:i:s', time() - $window_seconds);
            }

            $exists = (int) $wpdb->get_var($wpdb->prepare($sql, ...$params));
            if ($exists > 0) return false;
            self::record($type, $campaign_id, $contact_id, $url);
            return true;
        } finally {
            $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock_name));
        }
    }

    /** IP nunca é armazenado em claro — só o hash, para contagem única. */
    private static function ip_hash(): string {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        return $ip === '' ? '' : hash('sha256', $ip . wp_salt('kodety_email'));
    }

    // --- Base64 URL-safe --------------------------------------------------

    private static function base64url_encode(string $value): string {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function base64url_decode(string $value): string {
        $value = strtr($value, '-_', '+/');
        $decoded = base64_decode($value, true);
        return is_string($decoded) ? $decoded : '';
    }
}
