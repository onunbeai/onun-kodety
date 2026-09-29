<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_VERSION', 'test');
define('KODETY_URL', getenv('KODETY_ONBOARDING_ASSET_BASE') ?: 'https://example.test/wp-content/plugins/kodety/');
require_once dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_branding_assert(bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, "Falha: {$message}\n");
        exit(1);
    }
}

kodety_branding_assert(
    Kodety_Plugin::DEFAULT_ADMIN_ACCENT_COLOR === '#9393FF',
    'o violeta Kodety é a cor de destaque padrão'
);
kodety_branding_assert(
    Kodety_Plugin::DEFAULT_ADMIN_ACCENT_HOVER_COLOR === '#AFAFFF',
    'o hover claro precisa usar o segundo tom oficial da paleta'
);
kodety_branding_assert(
    Kodety_Plugin::is_valid_interface_accent_color(Kodety_Plugin::DEFAULT_ADMIN_ACCENT_COLOR),
    'a cor padrão precisa contrastar com texto preto'
);
kodety_branding_assert(
    Kodety_Plugin::interface_accent_contrast_ratio(Kodety_Plugin::DEFAULT_ADMIN_ACCENT_COLOR) >= 4.5,
    'o violeta padrão precisa manter o mínimo WCAG contra o texto preto'
);
kodety_branding_assert(
    Kodety_Plugin::interface_accent_contrast_ratio(Kodety_Plugin::DEFAULT_ADMIN_ACCENT_HOVER_COLOR) >= 4.5,
    'o hover claro precisa manter o mínimo WCAG contra o texto preto'
);
kodety_branding_assert(
    Kodety_Plugin::is_valid_interface_accent_color('#ff0000'),
    'vermelho puro alcança o contraste WCAG mínimo contra preto'
);
kodety_branding_assert(
    Kodety_Plugin::is_valid_interface_accent_color('#757575'),
    'o limite claro de cinza deve ser aceito'
);
kodety_branding_assert(
    !Kodety_Plugin::is_valid_interface_accent_color('#747474'),
    'o limite escuro de cinza deve ser rejeitado'
);
kodety_branding_assert(
    !Kodety_Plugin::is_valid_interface_accent_color('#0000ff'),
    'azul escuro não pode receber texto preto'
);
kodety_branding_assert(
    !Kodety_Plugin::is_valid_interface_accent_color('#000000'),
    'preto sobre preto precisa ser rejeitado'
);
kodety_branding_assert(
    !Kodety_Plugin::is_valid_interface_accent_color('#fff;display:none'),
    'valores capazes de injetar CSS precisam ser rejeitados'
);
kodety_branding_assert(
    Kodety_Plugin::normalize_interface_accent_color('#0000ff')
        === Kodety_Plugin::DEFAULT_ADMIN_ACCENT_COLOR,
    'uma opção legada inválida deve cair no padrão seguro'
);
kodety_branding_assert(
    Kodety_Plugin::interface_accent_contrast_ratio('#757575') >= 4.5,
    'o cálculo de contraste precisa usar a luminância relativa sRGB'
);

// Exercise the real standalone renderer and completion handler with in-memory
// WordPress options. No account, live database or installed plugin is changed.
$branding_options = [];
$branding_writes = [];
$branding_can_manage = true;
$branding_nonce_valid = true;
$branding_multisite = false;
$branding_locale = in_array('--english', $argv ?? [], true) ? 'en_US' : 'pt_BR';
$branding_site = 'https://example.test/site';
$branding_elementor_pages = [];
$branding_elementor_content = [];
$branding_elementor_templates = [];

function add_action(...$args): void {}
function add_filter(...$args): void {}
function apply_filters(string $hook, mixed $value, mixed ...$args): mixed { return $value; }
function current_user_can(string $cap): bool { return $GLOBALS['branding_can_manage']; }
function get_option(string $key, mixed $fallback = false): mixed { return $GLOBALS['branding_options'][$key] ?? $fallback; }
function update_option(string $key, mixed $value, mixed $autoload = null): bool {
    $GLOBALS['branding_writes'][] = $key;
    $GLOBALS['branding_options'][$key] = $value;
    return true;
}
function get_bloginfo(string $name): string { return 'Studio Aurora'; }
function get_posts(array $args = []): array {
    $post_type = $args['post_type'] ?? 'any';
    if ($post_type === 'elementor_library' && !isset($args['meta_key'])) {
        return $GLOBALS['branding_elementor_templates'];
    }
    if (!in_array(($args['meta_key'] ?? ''), ['_elementor_edit_mode', '_elementor_data'], true)) return [];
    if ($post_type === 'page') return $GLOBALS['branding_elementor_pages'];
    if ($post_type === 'any') {
        return array_merge($GLOBALS['branding_elementor_pages'], $GLOBALS['branding_elementor_content']);
    }
    return [];
}
function get_locale(): string { return $GLOBALS['branding_locale']; }
function determine_locale(): string { return get_locale(); }
function is_rtl(): bool { return false; }
function is_multisite(): bool { return $GLOBALS['branding_multisite']; }
function absint(mixed $value): int { return abs((int) $value); }
function wp_unslash(mixed $value): mixed { return is_string($value) ? stripslashes($value) : $value; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)); }
function sanitize_title(string $value): string { return trim(preg_replace('/[^a-z0-9_-]+/', '-', strtolower($value)), '-'); }
function trailingslashit(string $value): string { return rtrim($value, '/') . '/'; }
function untrailingslashit(string $value): string { return rtrim($value, '/'); }
function home_url(string $path = ''): string { return $GLOBALS['branding_site'] . $path; }
function admin_url(string $path = ''): string { return home_url('/wp-admin/' . $path); }
function wp_login_url(): string { return home_url('/wp-login.php'); }
function wp_parse_url(string $value, int $component = -1): mixed { return parse_url($value, $component); }
function esc_attr(mixed $value): string { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
function esc_html(mixed $value): string { return esc_attr($value); }
function esc_url(mixed $value): string { return esc_attr($value); }
function wp_json_encode(mixed $value): string { return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); }
function wp_get_attachment_image_url(int $id, string $size): string { return ''; }
function add_query_arg(string $key, string $value, string $url): string {
    return $url . (str_contains($url, '?') ? '&' : '?') . rawurlencode($key) . '=' . rawurlencode($value);
}
function wp_nonce_url(string $url, string $action, string $name = '_wpnonce'): string {
    return $url . '&' . rawurlencode($name) . '=fixture-' . rawurlencode($action);
}
function checked(mixed $value, mixed $expected = true): void { if ((string) $value === (string) $expected) echo 'checked="checked"'; }
function disabled(mixed $value, mixed $expected = true): void { if ((string) $value === (string) $expected) echo 'disabled="disabled"'; }
function wp_nonce_field(string $action, string $name): void { echo '<input type="hidden" name="' . esc_attr($name) . '" value="fixture-nonce">'; }
function nocache_headers(): void {}

final class Kodety_Branding_Response extends RuntimeException {
    public function __construct(public readonly int $status, public readonly string $target = '') { parent::__construct($target); }
}
function wp_die(string $message, string $title = '', array $args = []): never { throw new Kodety_Branding_Response($args['response'] ?? 500, $message); }
function wp_safe_redirect(string $url): never { throw new Kodety_Branding_Response(302, $url); }
function status_header(int $status): never { throw new Kodety_Branding_Response($status); }
function check_admin_referer(string $action, string $field): void {
    kodety_branding_assert($action === 'kodety_complete_onboarding' && $field === 'kodety_onboarding_nonce', 'o onboarding precisa verificar seu nonce próprio');
    if (!$GLOBALS['branding_nonce_valid']) throw new Kodety_Branding_Response(403);
}

require_once KODETY_DIR . 'includes/class-kodety-security.php';
require_once KODETY_DIR . 'includes/class-kodety-admin-i18n.php';
$branding_options['kodety_security_settings'] = Kodety_Security::defaults();
$branding_options['kodety_project_name'] = 'Studio Aurora';
$branding_options['kodety_onboarding_status'] = 'pending';
$branding_storage = sys_get_temp_dir() . '/kodety-onboarding-test-' . bin2hex(random_bytes(5));
mkdir($branding_storage . '/private/workspace', 0700, true);
$branding_plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
(new ReflectionProperty(Kodety_Plugin::class, 'storage_dir'))->setValue($branding_plugin, $branding_storage);

$render_onboarding = static function (array $state = []) use ($branding_plugin): string {
    ob_start();
    $branding_plugin->onboarding_page($state);
    return (string) ob_get_clean();
};
$onboarding_dom = static function (string $html): DOMXPath {
    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">' . $html);
    libxml_clear_errors();
    return new DOMXPath($doc);
};
$reset_security = static function (): void {
    (new ReflectionProperty(Kodety_Security::class, 'settings'))->setValue(Kodety_Security::instance(), null);
};
$run_completion = static function () use ($branding_plugin): Kodety_Branding_Response {
    try {
        $branding_plugin->complete_onboarding();
        throw new RuntimeException('O handler não retornou uma resposta.');
    } catch (Kodety_Branding_Response $response) {
        return $response;
    }
};

try {
    // --render emits the actual PHP template with sample data for browser QA.
    if (in_array('--render', $argv ?? [], true)) {
        $_GET['onboarding'] = 'teste';
        if (in_array('--fresh', $argv, true)) rmdir($branding_storage . '/private/workspace');
        if (in_array('--locked', $argv, true)) $branding_multisite = true;
        echo $render_onboarding();
    } else {
        $html = $render_onboarding();
        $xpath = $onboarding_dom($html);
        $config = json_decode($xpath->query('//*[@data-kodety-onboarding]')->item(0)->getAttribute('data-config'), true, 512, JSON_THROW_ON_ERROR);
        kodety_branding_assert($xpath->query('//*[@data-kodety-step]')->length === 4, 'o onboarding deve renderizar quatro etapas');
        kodety_branding_assert($xpath->query('//link[@rel="stylesheet"]')->length === 1, 'o onboarding precisa carregar somente seu stylesheet próprio');
        kodety_branding_assert(!str_contains($html, 'load-styles.php') && !str_contains($html, 'wp-admin/css') && !str_contains($html, 'wpadminbar'), 'o documento deve ser independente do chrome e CSS do WordPress');
        kodety_branding_assert($xpath->query('//input[@name="kodety_project_source" and @value="existing" and @checked]')->length === 1, 'reinstalar deve selecionar o projeto existente');
        kodety_branding_assert($config['login']['url'] === 'https://example.test/site/kodety-admin', 'a URL inicial deve conter o padrão e o subdiretório');
        kodety_branding_assert($xpath->query('//input[@name="kodety_login_saved" and @required]')->length === 1, 'guardar o link deve ser uma confirmação explícita');
        kodety_branding_assert(str_contains($html, 'Login seguro') && !str_contains($html, 'Abrir na aba Site'), 'uma hospedagem normal deve manter o fluxo de login seguro');
        kodety_branding_assert($xpath->query('//*[@data-kodety-step and @hidden]')->length === 0, 'sem JS todas as etapas devem continuar acessíveis');
        kodety_branding_assert(strlen(wp_json_encode($config)) < 6000, 'o onboarding não deve carregar o dicionário completo do Builder');
        kodety_branding_assert($xpath->query('//*[@data-kodety-elementor-warning]')->length === 0, 'um site sem páginas Elementor não deve receber alerta falso');

        $studio_runtime_fixture = [
            'kind' => 'kodety-studio-browser',
            'enabled' => true,
            'projectId' => 'project-12345678',
            'projectName' => 'Studio Aurora',
            'projectSlug' => 'studio-aurora',
            'studioOrigin' => 'http://127.0.0.1:4173',
            'studioLanguage' => 'pt',
            'wordpressLocale' => 'pt_BR',
        ];
        $branding_options['kodety_browser_runtime'] = $studio_runtime_fixture;
        $html = $render_onboarding();
        kodety_branding_assert(str_contains($html, 'Login seguro') && !str_contains($html, 'Abrir na aba Site'), 'a opção persistida não pode ativar o Studio fora do PHP-WASM atual');

        define('KODETY_BROWSER_STUDIO_RUNTIME', 'project-12345678');
        $branding_options['kodety_browser_runtime']['studioOrigin'] = 'https://user:password@example.test';
        $html = $render_onboarding();
        kodety_branding_assert(str_contains($html, 'Login seguro') && !str_contains($html, 'Abrir na aba Site'), 'um origin com credenciais não pode se passar pelo Studio');

        $branding_options['kodety_browser_runtime']['studioOrigin'] = 'https://studio.self-hosted.example';
        $html = $render_onboarding();
        kodety_branding_assert(str_contains($html, 'Projeto local'), 'um Studio HTTPS auto-hospedado deve funcionar com o marcador PHP-WASM válido');

        $branding_options['kodety_browser_runtime'] = $studio_runtime_fixture;
        $html = $render_onboarding();
        $xpath = $onboarding_dom($html);
        $config = json_decode($xpath->query('//*[@data-kodety-onboarding]')->item(0)->getAttribute('data-config'), true, 512, JSON_THROW_ON_ERROR);
        $site_action = $xpath->query('//a[contains(concat(" ", normalize-space(@class), " "), " kodety-onboarding__studio-site-action ")]')->item(0);
        kodety_branding_assert(str_contains($html, 'Projeto local') && str_contains($html, 'Volte pela biblioteca de projetos'), 'o PHP-WASM validado deve receber a etapa local do Studio');
        kodety_branding_assert($xpath->query('//input[@name="kodety_login_saved" and @required]')->length === 0, 'o Studio não deve exigir que a pessoa guarde o endereço técnico');
        kodety_branding_assert($site_action instanceof DOMElement && $site_action->getAttribute('target') === '_blank', 'a prévia local deve abrir em uma nova guia');
        kodety_branding_assert(str_contains($site_action->getAttribute('href'), 'kodety-preview=project-12345678'), 'a prévia deve voltar ao proxy local do Studio, não abrir o scope técnico do Playground');
        kodety_branding_assert(($config['studio']['displayPath'] ?? '') === '/studio-aurora', 'o Studio deve expor apenas o endereço amigável do projeto');
        unset($branding_options['kodety_browser_runtime']);

        $branding_elementor_pages = [41, 42, 43];
        $branding_elementor_content = [51, 52];
        $branding_elementor_templates = [61];
        $branding_options['page_on_front'] = 41;
        $html = $render_onboarding();
        $xpath = $onboarding_dom($html);
        $elementor_warning = $xpath->query('//*[@data-kodety-elementor-warning]')->item(0);
        kodety_branding_assert($elementor_warning instanceof DOMElement, 'páginas Elementor precisam gerar um aviso já na primeira etapa');
        kodety_branding_assert($elementor_warning->getAttribute('data-elementor-pages') === '3', 'o aviso precisa informar quantas páginas Elementor foram encontradas');
        kodety_branding_assert($elementor_warning->getAttribute('data-elementor-content') === '2', 'o aviso precisa contar outros conteúdos Elementor');
        kodety_branding_assert($elementor_warning->getAttribute('data-elementor-templates') === '1', 'o aviso precisa contar templates do Theme Builder');
        kodety_branding_assert($elementor_warning->getAttribute('data-elementor-front-page') === 'true', 'o aviso precisa destacar quando a página inicial usa Elementor');
        kodety_branding_assert($xpath->query('//*[@data-kodety-elementor-inspect]')->length === 1, 'o aviso inicial precisa levar à inspeção das páginas Elementor');
        $elementor_inspector = $xpath->query('//*[@data-kodety-elementor-inspect]')->item(0);
        $elementor_converter = $xpath->query('//button[@data-kodety-elementor-confirm and @name="kodety_elementor_convert_now" and @value="1"]')->item(0);
        kodety_branding_assert(
            $elementor_inspector instanceof DOMElement
                && $elementor_inspector->tagName === 'button'
                && $elementor_converter instanceof DOMElement
                && $elementor_converter->tagName === 'button',
            'o aviso deve inspecionar primeiro e a etapa do projeto deve confirmar a conversão no formulário autenticado'
        );
        kodety_branding_assert($xpath->query('//input[@name="kodety_project_source" and @value="elementor"]')->length === 1, 'o onboarding precisa expor Elementor como origem do projeto');
        kodety_branding_assert(
            $xpath->query('//fieldset[contains(concat(" ", normalize-space(@class), " "), " has-elementor ")]')->length === 1,
            'três origens com Elementor precisam ativar o grid próprio'
        );
        kodety_branding_assert(
            str_contains($elementor_warning->textContent, 'Elementor detectado')
                && str_contains($elementor_warning->textContent, 'incluindo a página inicial')
                && str_contains($elementor_warning->textContent, '2 outros conteúdos')
                && str_contains($elementor_warning->textContent, '1 modelo global')
                && str_contains($elementor_warning->textContent, 'não altera nem apaga o Elementor')
                && str_contains($elementor_warning->textContent, 'dados continuem salvos no WordPress'),
            'o aviso deve separar claramente onboarding seguro do risco posterior de publicação'
        );
        $branding_elementor_pages = [];
        $branding_elementor_content = [];
        $branding_elementor_templates = [];
        unset($branding_options['page_on_front']);

        $branding_options['kodety_security_settings']['admin_slug'] = 'entrada-existente';
        $reset_security();
        $xpath = $onboarding_dom($render_onboarding());
        kodety_branding_assert($xpath->query('//input[@name="kodety_admin_slug"]')->item(0)->getAttribute('value') === 'entrada-existente', 'a edição deve preservar um login personalizado');
        $branding_multisite = true;
        $xpath = $onboarding_dom($render_onboarding());
        kodety_branding_assert($xpath->query('//input[@name="kodety_admin_slug"]')->length === 0, 'a rede não pode oferecer um campo que não terá efeito');
        kodety_branding_assert($xpath->query('//*[@data-kodety-login-url]')->item(0)->getAttribute('value') === wp_login_url(), 'a rede deve mostrar o login compartilhado efetivo');
        $branding_multisite = false;

        $branding_locale = 'en_US';
        $html = $render_onboarding();
        kodety_branding_assert(str_contains($html, 'Your next sign-in starts here.') && str_contains($html, 'I’ve saved this link'), 'o documento próprio deve traduzir o conteúdo no servidor');
        kodety_branding_assert(!str_contains($html, 'Guardei este link') && str_contains($html, 'lang="en"'), 'o onboarding em inglês não pode depender da tradução tardia do wp-admin');
        $branding_locale = 'pt_BR';
        $html = $render_onboarding(['step' => 4, 'error' => '<script>alert(1)</script>', 'name' => '\" onfocus=\"alert(1)', 'slug' => '\"><script>alert(2)</script>']);
        kodety_branding_assert(!str_contains($html, '<script>alert(') && str_contains($html, 'role="alert"'), 'erros e valores devolvidos precisam ser escapados');
        $xpath = $onboarding_dom($html);
        $config = json_decode($xpath->query('//*[@data-kodety-onboarding]')->item(0)->getAttribute('data-config'), true, 512, JSON_THROW_ON_ERROR);
        kodety_branding_assert($config['initialStep'] === 4, 'erros devem retornar à etapa correspondente');

        $valid_post = ['kodety_project_source' => 'existing', 'kodety_admin_slug' => 'acesso-aurora', 'kodety_login_saved' => '1', 'kodety_admin_accent_color' => '#9393ff'];
        $_POST = $valid_post;
        $branding_can_manage = false;
        kodety_branding_assert($run_completion()->status === 403 && $branding_writes === [], 'a conclusão exige manage_options antes de qualquer escrita');
        kodety_branding_assert($render_onboarding() === '', 'o documento não pode vazar para usuários sem permissão');
        $branding_can_manage = true;
        $branding_nonce_valid = false;
        kodety_branding_assert($run_completion()->status === 403 && $branding_writes === [], 'um nonce inválido deve impedir mudanças');
        $branding_nonce_valid = true;
        foreach ([['kodety_admin_slug' => 'wp-admin'], ['kodety_admin_slug' => ['injetado']], ['kodety_login_saved' => '0'], ['kodety_project_source' => 'import']] as $invalid) {
            $_POST = array_merge($valid_post, $invalid);
            kodety_branding_assert($run_completion()->status === 400 && $branding_writes === [], 'login, confirmação ou importação inválidos não podem persistir opções');
        }
        $_POST = ['kodety_onboarding_test' => '1', 'kodety_admin_slug' => 'ignorar'];
        $response = $run_completion();
        kodety_branding_assert($response->target === admin_url() && $branding_writes === [], 'encerrar a prévia deve ser uma operação sem escrita');
        $_POST = $valid_post;
        $before_security = Kodety_Security::instance()->settings();
        $response = $run_completion();
        $expected_security = array_merge($before_security, ['admin_slug' => 'acesso-aurora']);
        kodety_branding_assert($response->target === home_url('/kodety/editor/'), 'concluir deve abrir o Builder');
        kodety_branding_assert($branding_options['kodety_security_settings'] === $expected_security, 'o formulário deve persistir somente a mudança de endereço na segurança');
        kodety_branding_assert($branding_options['kodety_onboarding_status'] === 'complete', 'o onboarding só termina após salvar a segurança');
        kodety_branding_assert(is_dir($branding_storage . '/private/workspace') && $branding_options['kodety_project_name'] === 'Studio Aurora', 'continuar o projeto deve preservar o workspace e seu nome');
        fwrite(STDOUT, "Contratos de identidade, contraste e onboarding aprovados.\n");
    }
} finally {
    if (is_dir($branding_storage . '/private/workspace')) rmdir($branding_storage . '/private/workspace');
    rmdir($branding_storage . '/private');
    rmdir($branding_storage);
}
