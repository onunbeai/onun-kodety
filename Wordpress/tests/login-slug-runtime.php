<?php

/**
 * Isolated regression checks for the private login slug and the hardening
 * defaults.
 *
 * Run with: php Wordpress/tests/login-slug-runtime.php
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('KODETY_VERSION', 'test');

$kodety_options = [];
$kodety_transients = [];
$kodety_multisite = false;
$kodety_home = 'https://exemplo.test';

$kodety_hooks = [];
$kodety_logged_in = false;
$kodety_is_admin = false;
$kodety_pagenow = '';
$kodety_ssl = false;
$kodety_option_write_fails = false;

function add_action(string $hook, $callback = null, int $priority = 10, int $args = 1): void {
    $GLOBALS['kodety_hooks'][] = [$hook, $callback, $priority];
}
function add_filter(string $hook, $callback = null, int $priority = 10, int $args = 1): void {
    $GLOBALS['kodety_hooks'][] = [$hook, $callback, $priority];
}
function remove_action(...$args): void {}
function is_admin(): bool { return $GLOBALS['kodety_is_admin']; }
function wp_doing_ajax(): bool { return false; }
function wp_doing_cron(): bool { return false; }
function is_ssl(): bool { return $GLOBALS['kodety_ssl']; }

/** Interrompe o fluxo no lugar do exit que segue todo redirect do plugin. */
final class Kodety_Test_Redirect extends RuntimeException {
    public function __construct(public readonly string $target) { parent::__construct($target); }
}

function wp_safe_redirect(string $location, int $status = 302): void {
    throw new Kodety_Test_Redirect($location);
}

/** O destino de um handler que redireciona, ou '' quando ele deixa passar. */
function kodety_redirect_target(callable $handler): string {
    try {
        $handler();
        return '';
    } catch (Kodety_Test_Redirect $redirect) {
        return $redirect->target;
    }
}

/** Callbacks registrados para um hook, no formato "método@prioridade". */
function kodety_hooked(string $hook): array {
    $found = [];
    foreach ($GLOBALS['kodety_hooks'] as [$name, $callback, $priority]) {
        if ($name !== $hook || !is_array($callback)) continue;
        $found[] = $callback[1] . '@' . $priority;
    }
    return $found;
}
function apply_filters(string $hook, $value, ...$rest) { return $value; }
function wp_unslash($value) { return is_string($value) ? stripslashes($value) : $value; }
function is_multisite(): bool { return $GLOBALS['kodety_multisite']; }
function home_url(string $path = '/'): string { return $GLOBALS['kodety_home'] . '/' . ltrim($path, '/'); }
function wp_login_url(): string { return home_url('/wp-login.php'); }
function wp_parse_url(string $url, int $component = -1) { return parse_url($url, $component); }
function get_option(string $name, $default = false) { return $GLOBALS['kodety_options'][$name] ?? $default; }
function update_option(string $name, $value, $autoload = null): bool {
    if ($GLOBALS['kodety_option_write_fails']) return false;
    $GLOBALS['kodety_options'][$name] = $value;
    return true;
}
function add_option(string $name, $value, $x = '', $autoload = null): bool { $GLOBALS['kodety_options'][$name] ??= $value; return true; }
function get_transient(string $key) { return $GLOBALS['kodety_transients'][$key] ?? false; }
function set_transient(string $key, $value, int $ttl = 0): bool { $GLOBALS['kodety_transients'][$key] = $value; return true; }
function delete_transient(string $key): bool { unset($GLOBALS['kodety_transients'][$key]); return true; }
function is_user_logged_in(): bool { return $GLOBALS['kodety_logged_in']; }

function sanitize_title(string $title): string {
    $title = strtolower(remove_accents_basic($title));
    $title = preg_replace('/[^a-z0-9\s\-_]/', '', $title) ?? '';
    $title = preg_replace('/[\s_]+/', '-', trim($title)) ?? '';
    return trim(preg_replace('/-+/', '-', $title) ?? '', '-');
}

function remove_accents_basic(string $value): string {
    return strtr($value, ['á' => 'a', 'ã' => 'a', 'â' => 'a', 'é' => 'e', 'ê' => 'e', 'í' => 'i', 'ó' => 'o', 'õ' => 'o', 'ô' => 'o', 'ú' => 'u', 'ç' => 'c']);
}

final class WP_Error {
    public function __construct(private string $code, private string $message) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
}

require_once dirname(__DIR__) . '/kodety/includes/class-kodety-security.php';

function kodety_assert(bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, "Falha: {$message}\n");
        exit(1);
    }
}

$security = Kodety_Security::instance();

$slug_of = static fn(string $value): string => Kodety_Security::sanitize_slug($value);

kodety_assert($slug_of('kodety-admin') === 'kodety-admin', 'um slug simples precisa passar');
kodety_assert($slug_of('/Kodety Admin/') === 'kodety-admin', 'barras e maiúsculas precisam ser normalizadas');
kodety_assert($slug_of('painel/../wp-admin') === '', 'travessia de caminho não pode virar slug');
kodety_assert($slug_of('') === '', 'vazio significa manter o wp-login.php');
foreach (['wp-admin', 'wp-login', 'kodety', 'admin', 'login'] as $reserved) {
    kodety_assert($slug_of($reserved) === '', "o caminho reservado {$reserved} precisa ser recusado");
}

$settings = Kodety_Security::sanitize_settings(['admin_slug' => 'entrada']);
kodety_assert($settings['admin_slug'] === 'entrada', 'o slug sanitizado precisa ser preservado');
kodety_assert(
    $settings['login_throttle'] === true && $settings['block_enumeration'] === true
        && $settings['disable_xmlrpc'] === true && $settings['disable_file_edit'] === true,
    'as proteções de base precisam vir ligadas por padrão'
);
kodety_assert(
    Kodety_Security::defaults()['admin_slug'] === Kodety_Security::DEFAULT_SLUG,
    'uma instalação nova já nasce com o login movido para o endereço padrão'
);
kodety_assert(
    Kodety_Security::sanitize_settings(['admin_slug' => ''])['admin_slug'] === '',
    'limpar o campo precisa devolver o wp-login.php: o padrão não pode se rearmar sozinho'
);
kodety_assert(
    Kodety_Security::sanitize_settings(['disable_xmlrpc' => false])['disable_xmlrpc'] === false,
    'desligar uma proteção precisa persistir'
);
$custom_settings = Kodety_Security::sanitize_settings([
    'login_max_attempts' => 1,
    'login_attempt_window_minutes' => 999,
    'login_lockout_minutes' => 30,
    'session_hours' => 12,
    'remember_days' => 30,
    'frame_policy' => 'deny',
    'referrer_policy' => 'no-referrer',
    'permissions_policy' => true,
    'enable_hsts' => true,
    'hsts_max_age_days' => 365,
    'hsts_subdomains' => true,
]);
kodety_assert(
    $custom_settings['login_max_attempts'] === 3
        && $custom_settings['login_attempt_window_minutes'] === 120
        && $custom_settings['login_lockout_minutes'] === 30,
    'limites de força bruta precisam ser personalizáveis e confinados a faixas seguras'
);
kodety_assert(
    $custom_settings['frame_policy'] === 'deny'
        && $custom_settings['referrer_policy'] === 'no-referrer',
    'políticas HTTP válidas precisam persistir'
);
kodety_assert(
    Kodety_Security::sanitize_settings(['frame_policy' => 'injetado'])['frame_policy'] === 'sameorigin',
    'políticas HTTP desconhecidas precisam voltar ao padrão seguro'
);

$kodety_options['kodety_security_settings'] = Kodety_Security::sanitize_settings(['admin_slug' => 'entrada-secreta']);
$reset = static function (Kodety_Security $security): void {
    (new ReflectionProperty(Kodety_Security::class, 'settings'))->setValue($security, null);
};
$reset($security);
kodety_assert($security->active_slug() === 'entrada-secreta', 'o slug salvo precisa valer para a requisição');
kodety_assert(
    $security->login_url() === 'https://exemplo.test/entrada-secreta',
    'a URL de login precisa apontar para o slug privado'
);

$kodety_multisite = true;
kodety_assert($security->active_slug() === '', 'multisite compartilha o login da rede e fica de fora');
$kodety_multisite = false;

kodety_assert(
    $security->rewrite_login_url('https://exemplo.test/wp-login.php?action=logout&_wpnonce=abc')
        === 'https://exemplo.test/entrada-secreta?action=logout&_wpnonce=abc',
    'logout e demais URLs de login precisam seguir o slug privado'
);
kodety_assert(
    $security->rewrite_login_url('https://exemplo.test/wp-admin/') === 'https://exemplo.test/wp-admin/',
    'URLs que não são do login não podem ser reescritas'
);
kodety_assert($security->rewrite_login_url(null) === null, 'valores não textuais precisam passar intactos');
kodety_assert(
    $security->generic_login_error('Usuário desconhecido') === 'Não foi possível entrar com os dados informados.',
    'erros genéricos não podem confirmar se uma conta existe'
);

$kodety_options['kodety_security_settings'] = Kodety_Security::sanitize_settings([
    'admin_slug' => 'entrada-secreta',
    'custom_session_duration' => true,
    'session_hours' => 12,
    'remember_days' => 30,
    'security_headers' => true,
    'frame_policy' => 'deny',
    'referrer_policy' => 'no-referrer',
    'permissions_policy' => true,
    'enable_hsts' => true,
    'hsts_max_age_days' => 365,
    'hsts_subdomains' => true,
]);
$reset($security);
kodety_assert(
    $security->auth_cookie_expiration(0, 7, false) === 12 * HOUR_IN_SECONDS
        && $security->auth_cookie_expiration(0, 7, true) === 30 * DAY_IN_SECONDS,
    'sessões comuns e lembradas precisam respeitar durações independentes'
);
$kodety_ssl = true;
$headers = $security->filter_security_headers([]);
kodety_assert(
    ($headers['X-Content-Type-Options'] ?? '') === 'nosniff'
        && ($headers['X-Frame-Options'] ?? '') === 'DENY'
        && ($headers['Referrer-Policy'] ?? '') === 'no-referrer'
        && str_contains((string) ($headers['Permissions-Policy'] ?? ''), 'camera=()')
        && ($headers['Strict-Transport-Security'] ?? '') === 'max-age=31536000; includeSubDomains',
    'headers configurados precisam ser emitidos com HSTS apenas sobre HTTPS'
);
$kodety_ssl = false;
kodety_assert(
    !array_key_exists('Strict-Transport-Security', $security->filter_security_headers([])),
    'HSTS nunca pode ser enviado por uma conexão que o WordPress considera HTTP'
);

$kodety_options['kodety_security_settings'] = Kodety_Security::sanitize_settings([
    'admin_slug' => 'entrada-secreta',
    'login_throttle' => true,
    'login_max_attempts' => 3,
    'login_attempt_window_minutes' => 10,
    'login_lockout_minutes' => 30,
]);
$reset($security);
$kodety_transients = [];
$_SERVER['REMOTE_ADDR'] = '192.0.2.30';
$security->record_failed_login();
$security->record_failed_login();
kodety_assert(
    $security->refuse_locked_client('usuario') === 'usuario',
    'o limite personalizado ainda deve aceitar as falhas anteriores ao valor configurado'
);
$security->record_failed_login();
kodety_assert(
    $security->refuse_locked_client('usuario') instanceof WP_Error,
    'a tentativa que alcança o limite personalizado precisa bloquear o IP'
);

$kodety_options['kodety_security_settings'] = Kodety_Security::sanitize_settings(['admin_slug' => 'entrada-secreta']);
$reset($security);

$request_path = new ReflectionMethod(Kodety_Security::class, 'request_path');
$path_for = static function (string $uri) use ($security, $request_path): string {
    $_SERVER['REQUEST_URI'] = $uri;
    return (string) $request_path->invoke($security);
};
kodety_assert($path_for('/entrada-secreta') === 'entrada-secreta', 'a raiz precisa resolver o slug');
kodety_assert($path_for('/entrada-secreta/?redirect_to=x') === 'entrada-secreta', 'a query string não faz parte do caminho');
kodety_assert($path_for('/wp-login.php') === 'wp-login.php', 'o login público precisa ser reconhecido');

$kodety_home = 'https://exemplo.test/site';
kodety_assert(
    $path_for('/site/entrada-secreta') === 'entrada-secreta',
    'instalações em subdiretório precisam descontar o prefixo'
);
kodety_assert($path_for('/site') === '', 'a home do subdiretório não é o slug');
$kodety_home = 'https://exemplo.test';

$_SERVER['REMOTE_ADDR'] = '203.0.113.10';
for ($attempt = 0; $attempt < 4; $attempt++) $security->record_failed_login();
kodety_assert(
    $security->refuse_locked_client('usuario') === 'usuario',
    'quatro falhas ainda estão dentro do limite'
);
$security->record_failed_login();
$locked = $security->refuse_locked_client('usuario');
kodety_assert(
    $locked instanceof WP_Error && $locked->get_error_code() === 'kodety_login_locked',
    'a quinta falha precisa bloquear o IP mesmo com a senha correta'
);

$_SERVER['REMOTE_ADDR'] = '198.51.100.7';
kodety_assert(
    $security->refuse_locked_client('usuario') === 'usuario',
    'o bloqueio precisa valer por IP, não para o site inteiro'
);

$_SERVER['REMOTE_ADDR'] = '203.0.113.10';
$security->clear_failed_logins();
kodety_assert(
    $security->refuse_locked_client('usuario') === 'usuario',
    'um login bem-sucedido precisa zerar o contador'
);

$_SERVER['REMOTE_ADDR'] = 'nao-e-um-ip';
$security->record_failed_login();
kodety_assert(
    $security->refuse_locked_client('usuario') === 'usuario',
    'um endereço inválido não pode gerar bloqueio'
);

kodety_assert(
    $security->restrict_user_endpoints(['/wp/v2/users' => [], '/wp/v2/posts' => []])
        === ['/wp/v2/posts' => []],
    'a REST de usuários precisa sumir para visitantes'
);
kodety_assert($security->drop_users_sitemap('provider', 'users') === false, 'o sitemap de autores precisa ser removido');
kodety_assert($security->drop_users_sitemap('provider', 'posts') === 'provider', 'os demais sitemaps continuam');
kodety_assert(
    $security->strip_pingback_header(['X-Pingback' => 'x', 'Vary' => 'y']) === ['Vary' => 'y'],
    'o cabeçalho de pingback precisa sair com o XML-RPC desligado'
);

// --- Roteamento do login privado ------------------------------------------
// As três regras que definem o recurso: só o slug abre o formulário, o
// wp-login.php público vai para a home, e o wp-admin fecha para visitantes.
// Nada disso valia antes de um slug ser salvo — e é por isso que o /wp-admin
// continua respondendo normalmente enquanto o campo estiver vazio.

$boot_with = static function (string $slug, string $uri) use ($security, $reset): void {
    $GLOBALS['kodety_options']['kodety_security_settings'] = Kodety_Security::sanitize_settings(['admin_slug' => $slug]);
    $reset($security);
    $_SERVER['REQUEST_URI'] = $uri;
    $GLOBALS['kodety_hooks'] = [];
    $security->boot();
};

$boot_with('entrada-secreta', '/entrada-secreta');
kodety_assert(
    in_array('serve_login_form@0', kodety_hooked('wp_loaded'), true),
    'o slug privado precisa servir o formulário de login'
);
kodety_assert(
    in_array('close_admin_for_visitors@1', kodety_hooked('wp_loaded'), true),
    'com slug ativo o wp-admin precisa fechar para visitantes'
);

$boot_with('entrada-secreta', '/wp-login.php');
kodety_assert(
    in_array('send_home@0', kodety_hooked('wp_loaded'), true),
    'o wp-login.php público precisa cair na home, não no formulário'
);
kodety_assert(
    !in_array('serve_login_form@0', kodety_hooked('wp_loaded'), true),
    'o formulário não pode ser servido fora do slug privado'
);

$boot_with('entrada-secreta', '/qualquer-outra-pagina');
kodety_assert(
    kodety_hooked('wp_loaded') === ['close_admin_for_visitors@1'],
    'páginas comuns não podem servir nem redirecionar o login'
);

$boot_with('', '/wp-admin/');
kodety_assert(
    kodety_hooked('wp_loaded') === [],
    'sem slug salvo o recurso fica inteiro desligado — inclusive o bloqueio do wp-admin'
);

$kodety_is_admin = true;
$kodety_logged_in = false;
kodety_assert(
    kodety_redirect_target([$security, 'close_admin_for_visitors']) === 'https://exemplo.test/',
    'visitante deslogado no wp-admin precisa ser mandado para a home'
);
$kodety_logged_in = true;
kodety_assert(
    kodety_redirect_target([$security, 'close_admin_for_visitors']) === '',
    'quem já está logado continua entrando no wp-admin'
);
$kodety_logged_in = false;
$kodety_is_admin = false;
kodety_assert(
    kodety_redirect_target([$security, 'close_admin_for_visitors']) === '',
    'o bloqueio vale só para o wp-admin, nunca para o front-end'
);
$kodety_is_admin = true;
foreach (['admin-ajax.php', 'admin-post.php'] as $entry) {
    $GLOBALS['pagenow'] = $entry;
    kodety_assert(
        kodety_redirect_target([$security, 'close_admin_for_visitors']) === '',
        "{$entry} responde a visitantes e não pode ser bloqueado"
    );
}
unset($GLOBALS['pagenow']);
$kodety_is_admin = false;

// --- Onboarding: validate before writes, preserve other security settings ---
$onboarding_settings = Kodety_Security::sanitize_settings([
    'admin_slug' => Kodety_Security::DEFAULT_SLUG,
    'login_throttle' => false,
    'login_max_attempts' => 9,
    'login_lockout_minutes' => 37,
    'custom_session_duration' => true,
    'session_hours' => 12,
    'disable_xmlrpc' => false,
    'frame_policy' => 'deny',
    'enable_hsts' => true,
]);
$kodety_options['kodety_security_settings'] = $onboarding_settings;
$reset($security);
kodety_assert(!$security->login_slug_locked(), 'a instalação comum permite personalizar o login no onboarding');
foreach (['', '   ', null, [], 'admin', 'wp-admin', 'wp-login.php', 'foo/bar', '/entrada', 'Entrada', 'duas palavras', 'duplo--hifen', 'foo?bar', '%2f', 'ação', str_repeat('a', 81)] as $invalid_slug) {
    $rejected = false;
    try {
        $security->save_onboarding_slug(is_string($invalid_slug) ? $invalid_slug : null);
    } catch (InvalidArgumentException) {
        $rejected = true;
    }
    kodety_assert($rejected, 'o onboarding precisa recusar slugs vazios, inválidos, reservados e longos');
    kodety_assert($kodety_options['kodety_security_settings'] === $onboarding_settings, 'uma validação recusada não pode alterar a segurança');
}
try {
    $security->validate_onboarding_slug(['entrada']);
    kodety_assert(false, 'arrays de POST precisam ser recusados');
} catch (InvalidArgumentException) {
}
kodety_assert($security->validate_onboarding_slug(str_repeat('a', 80)) === str_repeat('a', 80), 'o limite de 80 caracteres deve ser aceito');
kodety_assert($security->validate_onboarding_slug('  minha-entrada-2026  ') === 'minha-entrada-2026', 'a URL exibida e a salva devem usar o mesmo segmento sem espaços externos');
$security->save_onboarding_slug('minha-entrada-2026');
$expected_onboarding_settings = $onboarding_settings;
$expected_onboarding_settings['admin_slug'] = 'minha-entrada-2026';
kodety_assert($kodety_options['kodety_security_settings'] === $expected_onboarding_settings, 'salvar o onboarding deve alterar somente admin_slug');
kodety_assert($security->login_url() === 'https://exemplo.test/minha-entrada-2026', 'o cache de segurança precisa refletir o novo login imediatamente');
$kodety_home = 'https://exemplo.test/subsite';
kodety_assert($security->login_url() === 'https://exemplo.test/subsite/minha-entrada-2026', 'o login do onboarding deve preservar subdiretórios');
$kodety_home = 'https://exemplo.test';
$kodety_option_write_fails = true;
try {
    $security->save_onboarding_slug('nao-foi-salvo');
    kodety_assert(false, 'falhas de persistência não podem ser anunciadas como sucesso');
} catch (RuntimeException) {
}
$kodety_option_write_fails = false;
kodety_assert($security->active_slug() === 'minha-entrada-2026', 'uma escrita recusada deve preservar o endereço ativo');

$kodety_options['kodety_security_settings']['admin_slug'] = str_repeat('legado', 20);
$reset($security);
kodety_assert($security->validate_onboarding_slug(str_repeat('legado', 20)) === str_repeat('legado', 20), 'um endereço legado válido não deve ser alterado por uma regra nova do onboarding');
$before_locked = $kodety_options['kodety_security_settings'];
$kodety_multisite = true;
kodety_assert($security->login_slug_locked(), 'o onboarding deve informar que a rede controla o login');
kodety_assert($security->validate_onboarding_slug(['forjado']) === null, 'em multisite o campo deve ser ignorado até em um POST forjado');
$security->save_onboarding_slug('nao-alterar-rede');
kodety_assert($kodety_options['kodety_security_settings'] === $before_locked, 'o onboarding não pode mudar a configuração latente de uma rede');
kodety_assert($security->login_url() === wp_login_url(), 'a rede deve exibir seu login efetivo');
$kodety_multisite = false;

define('KODETY_ADMIN_SLUG', 'entrada-do-servidor');
kodety_assert($security->login_slug_locked(), 'wp-config.php deve bloquear a edição no onboarding');
$security->save_onboarding_slug('ignorar-post');
kodety_assert($kodety_options['kodety_security_settings'] === $before_locked, 'o override do servidor deve preservar o valor no banco');
kodety_assert($security->login_url() === 'https://exemplo.test/entrada-do-servidor', 'o onboarding deve mostrar o override ativo, não a opção do banco');
define('KODETY_DISABLE_ADMIN_SLUG', true);
$security->save_onboarding_slug(null);
kodety_assert($security->login_url() === wp_login_url(), 'o modo de recuperação precisa mostrar wp-login.php mesmo com um slug forçado');
kodety_assert($kodety_options['kodety_security_settings'] === $before_locked, 'o modo de recuperação não deve ser desfeito pelo onboarding');

fwrite(STDOUT, "Contratos de login privado e endurecimento aprovados.\n");
