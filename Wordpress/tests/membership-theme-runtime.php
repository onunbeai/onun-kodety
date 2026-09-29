<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');
define('DONOTCACHEPAGE', true);
define('KODETY_URL', 'https://example.test/wp-content/plugins/kodety/');
define('KODETY_VERSION', 'test');

$membership_test_dir = sys_get_temp_dir() . '/kodety-membership-theme-' . bin2hex(random_bytes(6));
mkdir($membership_test_dir, 0700, true);
$GLOBALS['kodety_membership_test_dir'] = $membership_test_dir;
$GLOBALS['kodety_membership_test_logged_in'] = false;
$GLOBALS['kodety_membership_test_wp_logged_in'] = false;
$GLOBALS['kodety_membership_test_plans'] = [];

function get_template_directory(): string {
    return $GLOBALS['kodety_membership_test_dir'];
}

function get_current_user_id(): int {
    return $GLOBALS['kodety_membership_test_wp_logged_in'] ? 88 : 0;
}

function is_user_logged_in(): bool {
    return $GLOBALS['kodety_membership_test_wp_logged_in'];
}

function sanitize_key(string $value): string {
    return strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', $value));
}

function nocache_headers(): void {}
function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function wp_parse_url(string $value, int $component = -1): mixed { return parse_url($value, $component); }
function home_url(string $path = ''): string { return 'https://example.test' . $path; }
function untrailingslashit(string $value): string { return rtrim($value, '/'); }
function wp_validate_redirect(string $value, string $fallback = ''): string {
    $url = parse_url($value);
    return is_array($url) ? $value : $fallback;
}
function wp_safe_redirect(string $value, int $status = 302, string $by = ''): bool { return false; }
function wp_redirect(string $value, int $status = 302, string $by = ''): bool { return false; }
function esc_url_raw(string $value, array $protocols = []): string { return $value; }
function esc_url(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function sanitize_file_name(string $value): string {
    return trim((string) preg_replace('/[^A-Za-z0-9._-]+/', '-', basename($value)), '-');
}
function get_option(string $key, mixed $default = false): mixed {
    return $key === 'kodety_current_release' ? 'release-test' : $default;
}
function add_query_arg(array $arguments, string $url): string {
    $separator = str_contains($url, '?') ? '&' : '?';
    return $url . $separator . http_build_query($arguments, '', '&', PHP_QUERY_RFC3986);
}
function rest_url(string $path = ''): string {
    return 'https://example.test/wp-json/' . ltrim($path, '/');
}
function wp_json_encode(mixed $value, int $flags = 0): string|false {
    return json_encode($value, $flags);
}
function add_action(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): bool { return true; }
function add_filter(string $hook, mixed $callback, int $priority = 10, int $accepted_args = 1): bool { return true; }
function apply_filters(string $hook, mixed $value, mixed ...$arguments): mixed {
    return $hook === 'kodety_membership_runtime_enabled' ? true : $value;
}

final class Kodety_Members {
    public static function instance(): self {
        return new self();
    }

    public function resolve_claims(int $user_id): array {
        return [
            'authenticated' => $user_id > 0,
            'plans' => $user_id > 0 ? $GLOBALS['kodety_membership_test_plans'] : [],
        ];
    }

    public static function current_member_id(): int {
        return $GLOBALS['kodety_membership_test_logged_in'] ? 7 : 0;
    }

    public static function current_member_csrf_token(): string {
        return self::current_member_id() > 0 ? 'member-csrf-token' : '';
    }

    public static function is_current_project_enabled(): bool { return true; }

    public static function settings(): array {
        return [
            'registration_enabled' => true,
            'after_login_url' => '/account/',
            'after_logout_url' => '/',
        ];
    }

    public static function evaluate_access(array $rule, ?int $user_id, string $project_id): array {
        if ($project_id !== 'project-runtime') {
            return ['allowed' => false, 'valid' => true, 'reason' => 'project_not_enabled'];
        }
        $requirement = is_array($rule['requirement'] ?? null) ? $rule['requirement'] : [];
        $type = $requirement['type'] ?? '';
        if ($type === 'authenticated') {
            return [
                'allowed' => $user_id !== null,
                'valid' => true,
                'reason' => $user_id !== null ? 'allowed' : 'access_denied',
            ];
        }
        if ($type === 'plans') {
            $required = (array) ($requirement['planKeys'] ?? []);
            $matched = array_intersect($required, $GLOBALS['kodety_membership_test_plans']);
            $allowed = ($requirement['match'] ?? 'any') === 'all'
                ? count($matched) === count($required)
                : count($matched) > 0;
            return ['allowed' => $allowed, 'valid' => true, 'reason' => $allowed ? 'allowed' : 'access_denied'];
        }
        return ['allowed' => false, 'valid' => false, 'reason' => 'invalid_rule'];
    }
}

function membership_theme_assert(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$authenticated_rule = [
    'requirement' => ['type' => 'authenticated'],
    'anonymous' => ['type' => 'branch', 'branch' => 'guest'],
    'denied' => ['type' => 'branch', 'branch' => 'upgrade'],
];
$plan_rule = [
    'requirement' => ['type' => 'plans', 'match' => 'any', 'planKeys' => ['pro']],
    'anonymous' => ['type' => 'branch', 'branch' => 'guest'],
    'denied' => ['type' => 'branch', 'branch' => 'upgrade'],
];
$runtime = [
    'version' => 1,
    'enabled' => true,
    'projectId' => 'project-runtime',
    'assets' => [
        'asset-0123456789abcdef01234567' => [
            'id' => 'asset-0123456789abcdef01234567',
            'filename' => 'curso-pro.zip',
        ],
    ],
    'pages' => [
        'index.html' => [
            'path' => 'index.html',
            'audienceOverrides' => [
                'guest' => [
                    'aud-shell' => [
                        'visible' => false,
                        'styles' => ['color' => '#777'],
                    ],
                ],
                'member' => [
                    'aud-shell' => [
                        'visible' => true,
                        'styles' => ['display' => 'block', 'color' => '#c33'],
                    ],
                ],
                'plan:pro' => [
                    'aud-shell' => [
                        'styles' => ['color' => '#09f'],
                    ],
                ],
            ],
            'gates' => [
                'members:1' => [
                    'rule' => $authenticated_rule,
                    'protectedHtml' => '<section>MEMBER_SECRET<div data-kodety-access-placeholder="pro:2" hidden></div></section>',
                    'guestHtml' => '<aside>LOGIN_BRANCH</aside>',
                    'upgradeHtml' => '<aside>MEMBER_UPGRADE</aside>',
                ],
                'pro:2' => [
                    'rule' => $plan_rule,
                    'protectedHtml' => '<strong>PRO_SECRET</strong>'
                        . '<a href="#kodety-protected-download" '
                        . 'data-kodety-protected-asset="asset-0123456789abcdef01234567">'
                        . 'DOWNLOAD_SECRET</a>',
                    'guestHtml' => '<aside>PRO_LOGIN</aside>',
                    'upgradeHtml' => '<aside>PRO_UPGRADE</aside>',
                ],
            ],
        ],
        'private.html' => [
            'path' => 'private.html',
            'pageRule' => $authenticated_rule,
            'protectedHtml' => '<!doctype html><html><head>'
                . '<meta name="description" content="PRIVATE_META_SECRET">'
                . '<link rel="stylesheet icon" data-rel="PRIVATE_REL_SECRET" data-href="PRIVATE_PREVIEW_SECRET" '
                . 'href="assets/favicon-light.png" media="(prefers-color-scheme: light)" '
                . 'title="foo href=\'PRIVATE_QUOTED_HREF_SECRET\'" data-kodety-favicon="light" '
                . 'type="PRIVATE_TYPE_SECRET" sizes="PRIVATE_SIZES_SECRET" crossorigin="PRIVATE_CORS_SECRET" '
                . 'data-private="PRIVATE_ATTR_SECRET" onload="PRIVATE_HANDLER_SECRET">'
                . '<link rel="icon" href="assets/favicon-dark.png" media="(prefers-color-scheme: dark)" data-kodety-favicon="dark">'
                . '<link rel="shortcut icon" href="assets/favicon.png" data-kodety-favicon="fallback">'
                . '<link rel="icon" href="javascript:PRIVATE_JAVASCRIPT_SECRET" data-kodety-favicon="unsafe">'
                . '<link rel="icon" href="java&#x09;script:PRIVATE_ENTITY_SCHEME_SECRET" data-kodety-favicon="unsafe">'
                . '<script>const hiddenIcon = `<link rel="icon" href="PRIVATE_ICON_SECRET" data-kodety-favicon="literal">`;</script>'
                . '<template><link rel="icon" href="PRIVATE_TEMPLATE_SECRET" data-kodety-favicon="template"></template>'
                . '</head><body>PAGE_SECRET</body></html>',
            'gates' => [],
        ],
        'hidden.html' => [
            'path' => 'hidden.html',
            'pageRule' => [
                'requirement' => ['type' => 'authenticated'],
                'anonymous' => ['type' => 'hide'],
                'denied' => ['type' => 'hide'],
            ],
            'protectedHtml' => '<!doctype html><html><head>'
                . '<link rel="icon" href="assets/hidden.png" data-kodety-favicon="fallback">'
                . '</head><body>HIDDEN_PAGE_SECRET</body></html>',
            'gates' => [],
        ],
        '.kodety-experiments/course/variant-a/index.html' => [
            'path' => '.incode/experiments/course/variant-a/project/index.html',
            'runtimePath' => '.kodety-experiments/course/variant-a/index.html',
            'authoredPath' => 'index.html',
            'pageRule' => $authenticated_rule,
            'protectedHtml' => '<!doctype html><html><head>'
                . '<link rel="icon" href="assets/ab.png" data-kodety-favicon="fallback">'
                . '</head><body>AB_PAGE_SECRET</body></html>',
            'gates' => [],
        ],
    ],
];
$pages = $runtime['pages'];
unset($runtime['pages']);
$runtime['pageFiles'] = [];
mkdir($membership_test_dir . '/membership-pages', 0700, true);
foreach ($pages as $page_path => $page) {
    $filename = hash('sha256', $page_path) . '.php';
    $runtime['pageFiles'][$page_path] = $filename;
    $page_payload = "<?php\ndefined('ABSPATH') || exit;\nreturn " . var_export($page, true) . ";\n";
    file_put_contents($membership_test_dir . '/membership-pages/' . $filename, $page_payload, LOCK_EX);
}
$payload = "<?php\ndefined('ABSPATH') || exit;\nreturn " . var_export($runtime, true) . ";\n";
file_put_contents($membership_test_dir . '/membership-content.php', $payload, LOCK_EX);
membership_theme_assert(
    !str_contains($payload, 'MEMBER_SECRET')
        && !str_contains($payload, 'PAGE_SECRET')
        && !str_contains($payload, 'AB_PAGE_SECRET'),
    'índice sharded não pode agregar HTML privado'
);

require dirname(__DIR__) . '/kodety/theme-runtime/functions.php';

$placeholder = '<main data-kodety-audience-id="aud-shell"><div data-kodety-access-placeholder="members:1" hidden></div></main>';
$guest = kodety_render_membership_html($placeholder, 'index.html');
membership_theme_assert(str_contains($guest, 'LOGIN_BRANCH'), 'visitante deve receber branch de login');
membership_theme_assert(!str_contains($guest, 'MEMBER_SECRET'), 'segredo de membro vazou para visitante');
membership_theme_assert(
    str_contains($guest, 'data-kodety-membership-audience')
        && str_contains($guest, 'display:none')
        && !str_contains($guest, '!important')
        && str_contains($guest, 'hidden aria-hidden="true"'),
    'camada Visitante deve alterar estilo e visibilidade no runtime'
);

$GLOBALS['kodety_membership_test_wp_logged_in'] = true;
$wp_editor_only = kodety_render_membership_html($placeholder, 'index.html');
membership_theme_assert(
    str_contains($wp_editor_only, 'LOGIN_BRANCH')
        && !str_contains($wp_editor_only, 'MEMBER_SECRET'),
    'sessão nativa de editor não pode virar identidade da área de membros'
);
$GLOBALS['kodety_membership_test_wp_logged_in'] = false;

$GLOBALS['kodety_membership_test_logged_in'] = true;
$member = kodety_render_membership_html($placeholder, 'index.html');
membership_theme_assert(str_contains($member, 'MEMBER_SECRET'), 'membro logado não recebeu branch protegido externo');
membership_theme_assert(str_contains($member, 'PRO_UPGRADE'), 'membro sem plano deve receber upgrade no gate aninhado');
membership_theme_assert(!str_contains($member, 'PRO_SECRET'), 'segredo pro vazou para membro sem plano');
membership_theme_assert(
    !str_contains($member, 'kodety_member_asset='),
    'URL do download protegido vazou para membro sem o plano exigido'
);
membership_theme_assert(
    str_contains($member, 'color:#c33')
        && !str_contains($member, 'color:#09f')
        && !str_contains($member, '!important'),
    'membro sem plano deve receber somente a camada compartilhada de membro'
);

$GLOBALS['kodety_membership_test_plans'] = ['pro'];
$pro = kodety_render_membership_html($placeholder, 'index.html');
membership_theme_assert(str_contains($pro, 'MEMBER_SECRET'), 'membro pro perdeu o conteúdo externo');
membership_theme_assert(str_contains($pro, 'PRO_SECRET'), 'membro pro não recebeu gate aninhado');
membership_theme_assert(!str_contains($pro, 'data-kodety-access-placeholder'), 'placeholder privado sobreviveu ao runtime');
membership_theme_assert(
    str_contains($pro, 'kodety_member_asset=asset-0123456789abcdef01234567')
        && str_contains($pro, 'kodety_member_release=release-test'),
    'link protegido autorizado deve apontar para o endpoint opaco da release atual'
);
membership_theme_assert(
    str_contains($pro, 'download=&quot;curso-pro.zip&quot;')
        || str_contains($pro, 'download="curso-pro.zip"'),
    'link protegido deve forçar download com nome sanitizado'
);
membership_theme_assert(
    !str_contains($pro, 'href="#kodety-protected-download"'),
    'href autoral nunca pode sobreviver após autorização'
);
membership_theme_assert(
    str_contains($pro, 'color:#09f') && !str_contains($pro, '!important'),
    'plano deve herdar Membro e aplicar sua camada por último'
);

$page = kodety_render_membership_html(
    '<html><body><main data-kodety-page-access-placeholder="private.html" hidden></main></body></html>',
    'private.html'
);
membership_theme_assert(str_contains($page, 'PAGE_SECRET'), 'página protegida não foi restaurada para membro');

$GLOBALS['kodety_membership_test_logged_in'] = false;
$denied_page = kodety_render_membership_html('', 'private.html');
membership_theme_assert(str_contains($denied_page, 'Conteúdo exclusivo para membros'), 'página negada não exibiu fallback seguro');
membership_theme_assert(!str_contains($denied_page, 'PAGE_SECRET'), 'página protegida vazou no fallback');
membership_theme_assert(
    substr_count($denied_page, 'data-kodety-favicon=') === 3
        && str_contains($denied_page, 'href="assets/favicon-light.png"')
        && str_contains($denied_page, 'href="assets/favicon-dark.png"')
        && str_contains($denied_page, 'href="assets/favicon.png"'),
    'fallback de página protegida deve preservar somente os favicons autorados pelo Kodety'
);
membership_theme_assert(
    !str_contains($denied_page, 'PRIVATE_META_SECRET')
        && !str_contains($denied_page, 'PRIVATE_ICON_SECRET')
        && !str_contains($denied_page, 'PRIVATE_TEMPLATE_SECRET')
        && !str_contains($denied_page, 'PRIVATE_REL_SECRET')
        && !str_contains($denied_page, 'PRIVATE_PREVIEW_SECRET')
        && !str_contains($denied_page, 'PRIVATE_QUOTED_HREF_SECRET')
        && !str_contains($denied_page, 'PRIVATE_ATTR_SECRET')
        && !str_contains($denied_page, 'PRIVATE_HANDLER_SECRET')
        && !str_contains($denied_page, 'PRIVATE_JAVASCRIPT_SECRET')
        && !str_contains($denied_page, 'PRIVATE_ENTITY_SCHEME_SECRET')
        && !str_contains($denied_page, 'PRIVATE_TYPE_SECRET')
        && !str_contains($denied_page, 'PRIVATE_SIZES_SECRET')
        && !str_contains($denied_page, 'PRIVATE_CORS_SECRET')
        && !str_contains($denied_page, 'rel="stylesheet icon"'),
    'fallback deve reconstruir somente atributos allowlisted sem expor metadados ou markup privado'
);
$hidden_page = kodety_render_membership_html('', 'hidden.html');
membership_theme_assert(
    str_contains($hidden_page, 'href="assets/hidden.png"')
        && str_contains($hidden_page, '<body></body>')
        && !str_contains($hidden_page, 'HIDDEN_PAGE_SECRET'),
    'fallback hide deve permanecer visualmente vazio, noindex e preservar o favicon Kodety'
);

$ab_placeholder = '<html><body><main data-kodety-page-access-placeholder="'
    . '.kodety-experiments/course/variant-a/index.html" hidden></main></body></html>';
$ab_guest = kodety_render_membership_html(
    $ab_placeholder,
    '.kodety-experiments/course/variant-a/index.html'
);
membership_theme_assert(!str_contains($ab_guest, 'AB_PAGE_SECRET'), 'variante A/B protegida vazou para visitante');
membership_theme_assert(
    str_contains($ab_guest, 'Conteúdo exclusivo para membros'),
    'variante A/B negada deve usar fallback seguro'
);
membership_theme_assert(
    str_contains($ab_guest, 'href="assets/ab.png"'),
    'variante A/B negada deve preservar o favicon de seu snapshot autorado'
);

$GLOBALS['kodety_membership_test_logged_in'] = true;
$ab_member = kodety_render_membership_html(
    $ab_placeholder,
    '.kodety-experiments/course/variant-a/index.html'
);
membership_theme_assert(
    str_contains($ab_member, 'AB_PAGE_SECRET')
        && str_contains($ab_member, 'href="assets/ab.png"'),
    'rota materializada da variante A/B não carregou seu shard protegido'
);

$runtime_markup = kodety_inject_membership_runtime(
    '<html><body><form data-kodety-member-form="profile"></form></body></html>'
);
membership_theme_assert(
    str_contains($runtime_markup, '"memberCsrf":"member-csrf-token"')
        && !str_contains($runtime_markup, '"nonce"')
        && str_contains($runtime_markup, 'membership-runtime.js'),
    'runtime público deve receber somente o CSRF da sessão Kodety'
);

unlink($membership_test_dir . '/membership-content.php');
foreach (glob($membership_test_dir . '/membership-pages/*.php') ?: [] as $page_file) {
    unlink($page_file);
}
rmdir($membership_test_dir . '/membership-pages');
rmdir($membership_test_dir);

echo "Membership theme runtime tests passed.\n";
