<?php

/**
 * Isolated contract for Kodety's administration-language resolver.
 *
 * Run with: php Wordpress/tests/admin-i18n-runtime.php
 */

define('ABSPATH', __DIR__);
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_FILE', KODETY_DIR . 'kodety.php');
define('KODETY_URL', 'https://example.test/wp-content/plugins/kodety/');

$kodety_i18n_locale = 'pt_BR';
$kodety_i18n_options = [];
$kodety_i18n_enqueued = [];
$kodety_i18n_inline = [];

function add_action(string $hook, callable $callback, int $priority = 10): void {}
function apply_filters(string $hook, mixed $value, mixed ...$args): mixed { return $value; }
function plugin_basename(string $file): string { return 'kodety/kodety.php'; }
function load_plugin_textdomain(string $domain, bool $deprecated = false, string $path = ''): bool { return true; }
function register_setting(string $group, string $name, array $args = []): void {}
function untrailingslashit(string $value): string { return rtrim($value, '/\\'); }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function wp_unslash(string $value): string { return stripslashes($value); }
function determine_locale(): string { global $kodety_i18n_locale; return $kodety_i18n_locale; }
function wp_enqueue_script(string $handle, string $src = '', array $deps = [], string|bool|null $version = false, array|bool $args = false): void {
    global $kodety_i18n_enqueued;
    $kodety_i18n_enqueued[$handle] = compact('src', 'deps', 'version', 'args');
}
function wp_add_inline_script(string $handle, string $data, string $position = 'after'): bool {
    global $kodety_i18n_inline;
    $kodety_i18n_inline[$handle][] = compact('data', 'position');
    return true;
}
function wp_json_encode(mixed $value): string|false { return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); }
function get_option(string $name, mixed $default = false): mixed {
    global $kodety_i18n_options;
    return $kodety_i18n_options[$name] ?? $default;
}

require KODETY_DIR . 'includes/class-kodety-admin-i18n.php';

function kodety_i18n_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

$i18n = Kodety_Admin_I18n::instance();

kodety_i18n_assert($i18n->effective_locale() === 'pt-BR', 'pt_BR deve selecionar português');
$kodety_i18n_locale = 'pt_PT';
kodety_i18n_assert($i18n->effective_locale() === 'pt-BR', 'qualquer locale pt deve selecionar português');
$kodety_i18n_locale = 'es_ES';
kodety_i18n_assert($i18n->effective_locale() === 'en', 'idiomas sem catálogo devem usar inglês');
$kodety_i18n_locale = 'en_US';
$kodety_i18n_options[Kodety_Admin_I18n::OPTION] = 'pt-BR';
kodety_i18n_assert($i18n->effective_locale() === 'pt-BR', 'a escolha manual deve substituir o WordPress');
$kodety_i18n_options[Kodety_Admin_I18n::OPTION] = 'xx-invalid';
kodety_i18n_assert($i18n->effective_locale() === 'en', 'uma escolha inválida deve voltar ao automático');

$format_timestamp = strtotime('2026-08-03 17:05:00 UTC');
$kodety_i18n_options[Kodety_Admin_I18n::OPTION] = 'en';
kodety_i18n_assert($i18n->format_number(1234.5, 2) === '1,234.50', 'números em inglês devem usar separadores ingleses');
kodety_i18n_assert($i18n->format_date($format_timestamp, 'long_date', new DateTimeZone('UTC')) === 'Monday, August 3', 'data longa deve seguir o inglês do Kodety');
kodety_i18n_assert($i18n->format_date($format_timestamp, 'date_time', new DateTimeZone('UTC')) === '08/03/2026 at 5:05 PM', 'data e hora devem seguir o inglês do Kodety');
kodety_i18n_assert($i18n->format_relative_time(0, 7200) === '2 hours ago', 'tempo relativo deve seguir o inglês do Kodety');
$kodety_i18n_options[Kodety_Admin_I18n::OPTION] = 'pt-BR';
kodety_i18n_assert($i18n->format_number(1234.5, 2) === '1.234,50', 'números em português devem usar separadores brasileiros');
kodety_i18n_assert($i18n->format_date($format_timestamp, 'long_date', new DateTimeZone('UTC')) === 'segunda-feira, 3 de agosto', 'data longa deve seguir o português do Kodety');
kodety_i18n_assert($i18n->format_date($format_timestamp, 'date_time', new DateTimeZone('UTC')) === '03/08/2026 às 17:05', 'data e hora devem seguir o português do Kodety');
kodety_i18n_assert($i18n->format_relative_time(0, 7200) === 'há 2 horas', 'tempo relativo deve seguir o português do Kodety');
$kodety_i18n_options[Kodety_Admin_I18n::OPTION] = 'xx-invalid';

$catalogs = $i18n->catalogs();
kodety_i18n_assert(isset($catalogs['en'], $catalogs['pt-BR']), 'os catálogos pt-BR e en devem ser descobertos');
kodety_i18n_assert($i18n->message('common.save') === 'Save', 'mensagem do servidor deve seguir o idioma efetivo');
kodety_i18n_assert($i18n->translate('Carregando Kodety') === 'Loading Kodety', 'cópia PHP exata deve usar o catálogo inglês');
kodety_i18n_assert($i18n->translate('3 páginas') === '3 pages', 'cópia PHP deve resolver placeholders do catálogo');
kodety_i18n_assert($i18n->translate('3 de 10 enviados') === '3 of 10 sent', 'padrões completos devem vencer padrões genéricos');
kodety_i18n_assert($i18n->message('onboarding.step_counter', ['current' => '{total}', 'total' => '$&']) === '{total} of $&', 'valores não devem ser interpolados novamente');
kodety_i18n_assert($i18n->translate('O texto “{value1}” mudou ou não existe mais em $&.') === 'Text “{value1}” changed or no longer exists in $&.', 'substituições dinâmicas preservam dados literais');
$config = $i18n->client_config('document');
kodety_i18n_assert($config['scope'] === 'document', 'o escopo do Builder deve ser preservado');
kodety_i18n_assert(isset($config['direct']), 'o cliente deve receber traduções exatas');
kodety_i18n_assert(in_array('value', $config['attributes'], true), 'botões input devem permitir tradução do rótulo');
kodety_i18n_assert(!isset($config['glossary'], $config['legacy']), 'o cliente não deve receber tradução parcial por glossário');

$full_config_size = strlen((string) wp_json_encode($config));
$login_config = $i18n->client_config('login');
$login_config_size = strlen((string) wp_json_encode($login_config));
kodety_i18n_assert($login_config['scope'] === 'login', 'o escopo do login deve ser preservado');
kodety_i18n_assert($login_config['documentLocale'] === true, 'locales WordPress suportados devem compartilhar lang/dir com o shell');
kodety_i18n_assert($login_config['messages'] === [] && $login_config['aliases'] === [], 'o login não deve serializar mensagens e aliases do Builder');
kodety_i18n_assert(($login_config['direct']['Boas-vindas de volta'] ?? '') === 'Welcome back', 'a nova apresentação do login deve continuar traduzida');
kodety_i18n_assert(($login_config['direct']['Nome de usuário ou endereço de e-mail'] ?? '') === 'Username or Email Address', 'o login nativo em pt-BR deve poder virar inglês');
kodety_i18n_assert(($login_config['direct']['Ocultar senha'] ?? '') === 'Hide password', 'ações acessíveis de senha devem acompanhar o idioma escolhido');
kodety_i18n_assert(!isset($login_config['direct']['Configurações e integrações do CMS']), 'cópia do CMS não deve vazar para o login');
kodety_i18n_assert(!in_array('', $login_config['direct'], true), 'traduções vazias nunca devem apagar cópia do login');
kodety_i18n_assert(count($login_config['direct']) < 150, 'o subset do login deve permanecer auditável');
kodety_i18n_assert($login_config_size < 32768, 'a configuração inline do login deve permanecer abaixo de 32 KB');
kodety_i18n_assert($login_config_size * 8 < $full_config_size, 'o subset do login deve ser pelo menos oito vezes menor que o catálogo administrativo');

$kodety_i18n_options[Kodety_Admin_I18n::OPTION] = 'pt-BR';
$native_error = new class(['message' => 'Authentication is required.', 'data' => ['title' => 'Settings']]) {
    public function __construct(private array $data) {}
    public function get_data(): array { return $this->data; }
    public function set_data(array $data): void { $this->data = $data; }
};
$native_request = new class {
    public function get_route(): string { return '/kodety/v1/automation/call'; }
};
$i18n->translate_rest_response($native_error, null, $native_request);
kodety_i18n_assert($native_error->get_data()['message'] === 'Autenticação obrigatória.', 'erros nativos devem acompanhar o PT escolhido');
kodety_i18n_assert($native_error->get_data()['data']['title'] === 'Settings', 'dados autorais REST não devem ser traduzidos');
kodety_i18n_assert($i18n->translate('Create CMS item') === 'Criar item CMS', 'ações CMS devem funcionar do EN para PT');
kodety_i18n_assert($i18n->translate('arguments.fields[0].name is required.') === 'arguments.fields[0].name é obrigatório.', 'validação nativa deve traduzir sem alterar o caminho técnico');
$portuguese_login_config = $i18n->client_config('login');
kodety_i18n_assert(($portuguese_login_config['direct']['Username or Email Address'] ?? '') === 'Nome de usuário ou endereço de e-mail', 'o login nativo em inglês deve poder virar pt-BR');
kodety_i18n_assert(($portuguese_login_config['direct']['Get New Password'] ?? '') === 'Obter nova senha', 'recuperação de senha deve acompanhar o pt-BR');
kodety_i18n_assert(($portuguese_login_config['direct']['Show password'] ?? '') === 'Mostrar senha', 'o rótulo acessível da senha deve acompanhar o pt-BR');
kodety_i18n_assert(strlen((string) wp_json_encode($portuguese_login_config)) < 32768, 'o subset pt-BR do login deve respeitar o mesmo budget');
$kodety_i18n_options[Kodety_Admin_I18n::OPTION] = 'xx-invalid';
$kodety_i18n_locale = 'ar';
$unsupported_login_config = $i18n->client_config('login');
kodety_i18n_assert($unsupported_login_config['documentLocale'] === false, 'locale WordPress não suportado deve preservar lang/dir do documento nativo');
$kodety_i18n_locale = 'en_US';

$captured_die = [];
$die_handler = $i18n->filter_wp_die_handler(static function (mixed $message, mixed $title, mixed $args) use (&$captured_die): void {
    $captured_die = [$message, $title, $args];
});
$_SERVER['REQUEST_URI'] = '/wp-admin/plugins.php';
$die_handler('Você não tem permissão para acessar membros.', 'Acesso negado', ['response' => 403]);
kodety_i18n_assert($captured_die[0] === 'Você não tem permissão para acessar membros.', 'wp_die de outro produto deve permanecer intocado');
kodety_i18n_assert($captured_die[1] === 'Acesso negado', 'título wp_die de outro produto deve permanecer intocado');
$_REQUEST['page'] = 'kodety-members';
$die_handler('Você não tem permissão para acessar membros.', 'Acesso negado', ['response' => 403]);
kodety_i18n_assert($captured_die[0] === 'You do not have permission to access members.', 'wp_die deve traduzir a mensagem catalogada');
kodety_i18n_assert($captured_die[1] === 'Access denied', 'wp_die deve traduzir o título catalogado');
unset($_REQUEST['page']);
$_REQUEST['action'] = 'kodefy_download_kit';
$die_handler('Sem permissão.', '', ['response' => 403]);
kodety_i18n_assert($captured_die[0] === 'Permission denied.', 'wp_die da extensão Kodefy deve usar o mesmo catálogo');
unset($_REQUEST['action']);

$rest_response = new class(['message' => 'Você não tem permissão para acessar membros.']) {
    public function __construct(private array $data) {}
    public function get_data(): array { return $this->data; }
    public function set_data(array $data): void { $this->data = $data; }
};
$rest_request = new class {
    public function get_route(): string { return '/kodety/v1/membership/members'; }
};
$i18n->translate_rest_response($rest_response, null, $rest_request);
kodety_i18n_assert($rest_response->get_data()['message'] === 'You do not have permission to access members.', 'REST Kodety deve traduzir o envelope de mensagem');

$kodefy_response = new class(['message' => 'Sem permissão.']) {
    public function __construct(private array $data) {}
    public function get_data(): array { return $this->data; }
    public function set_data(array $data): void { $this->data = $data; }
};
$kodefy_request = new class {
    public function get_route(): string { return '/kodefy/v1/builder-data'; }
};
$i18n->translate_rest_response($kodefy_response, null, $kodefy_request);
kodety_i18n_assert($kodefy_response->get_data()['message'] === 'Permission denied.', 'REST Kodefy deve usar o catálogo do Kodety');

$external_response = new class(['message' => 'Sem permissão.']) {
    public function __construct(private array $data) {}
    public function get_data(): array { return $this->data; }
    public function set_data(array $data): void { $this->data = $data; }
};
$external_request = new class {
    public function get_route(): string { return '/external/v1/items'; }
};
$i18n->translate_rest_response($external_response, null, $external_request);
kodety_i18n_assert($external_response->get_data()['message'] === 'Sem permissão.', 'REST externo deve permanecer intocado');

$_GET = [];
$kodety_i18n_enqueued = [];
$kodety_i18n_inline = [];
$i18n->enqueue_admin_runtime('edit.php');
kodety_i18n_assert($kodety_i18n_enqueued === [], 'tela externa não deve carregar o catálogo administrativo');
kodety_i18n_assert($kodety_i18n_inline === [], 'tela externa não deve injetar a configuração administrativa');
$_GET['page'] = 'kodety-media';
$i18n->enqueue_admin_runtime('admin.php');
kodety_i18n_assert(isset($kodety_i18n_enqueued['kodety-admin-i18n']), 'tela Kodety deve carregar o runtime administrativo');
kodety_i18n_assert(isset($kodety_i18n_inline['kodety-admin-i18n']), 'tela Kodety deve receber a configuração administrativa');

$kodety_i18n_enqueued = [];
$kodety_i18n_inline = [];
$kodety_i18n_options['kodety_interface_enabled'] = '0';
$i18n->enqueue_login_runtime();
kodety_i18n_assert($kodety_i18n_enqueued === [] && $kodety_i18n_inline === [], 'interface nativa não deve carregar o tradutor do login Kodety');
$kodety_i18n_options['kodety_interface_enabled'] = '1';
$i18n->enqueue_login_runtime();
kodety_i18n_assert(isset($kodety_i18n_enqueued['kodety-admin-i18n']), 'interface Kodety deve carregar o tradutor do login');
kodety_i18n_assert(isset($kodety_i18n_inline['kodety-admin-i18n']), 'login Kodety deve receber apenas seu subset de idioma');

$kodety_i18n_enqueued = [];
$kodety_i18n_inline = [];
$i18n->enqueue_login_runtime();
kodety_i18n_assert(isset($kodety_i18n_enqueued['kodety-admin-i18n']), 'o login deve carregar o runtime de idioma');
$login_inline = (string) ($kodety_i18n_inline['kodety-admin-i18n'][0]['data'] ?? '');
kodety_i18n_assert(str_starts_with($login_inline, 'window.kodetyAdminI18n='), 'o login deve receber sua configuração antes do runtime');
kodety_i18n_assert(strlen($login_inline) < 33000, 'o script inline real do login deve respeitar o budget de 32 KB');

echo "Idioma administrativo do Kodety aprovado.\n";
