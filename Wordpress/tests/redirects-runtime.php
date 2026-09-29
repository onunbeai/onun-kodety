<?php

/** Isolated regression tests for the generated theme Redirect runtime. */
define('ABSPATH', __DIR__);

final class Kodety_License {
    public static function instance(): self { static $instance; return $instance ??= new self(); }
    public function is_active(): bool { return true; }
    public function public_status(): array { return ['valid' => true, 'limits' => []]; }
}

if (!function_exists('add_action')) {
    function add_action(string $hook, callable|string $callback, int $priority = 10, int $accepted_args = 1): bool {
        return true;
    }
}
if (!function_exists('is_admin')) {
    function is_admin(): bool { return (bool) ($GLOBALS['kodety_redirect_test_admin'] ?? false); }
}
if (!function_exists('wp_doing_ajax')) {
    function wp_doing_ajax(): bool { return (bool) ($GLOBALS['kodety_redirect_test_ajax'] ?? false); }
}
if (!function_exists('wp_doing_cron')) {
    function wp_doing_cron(): bool { return (bool) ($GLOBALS['kodety_redirect_test_cron'] ?? false); }
}

require dirname(__DIR__) . '/kodety/theme-runtime/redirects.php';
require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_redirect_test_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_redirect_fixture(array $overrides = []): array {
    return array_merge([
        'id' => 'redirect',
        'source' => '/old',
        'destination' => '/new',
        'match' => 'exact',
        'status' => 301,
        'preserveQuery' => true,
        'enabled' => true,
    ], $overrides);
}

function kodety_redirect_settings_fixture(array ...$entries): array {
    return ['version' => 1, 'entries' => $entries];
}

$legacy = kodety_normalize_redirect_settings([
    'redirects' => [
        [
            'id' => 'first',
            'from' => '/legacy/',
            'to' => '/current',
            'matchType' => 'prefix',
            'statusCode' => '308',
            'preserveQuery' => 'false',
        ],
        [
            'id' => 'disabled',
            'from' => '/disabled',
            'to' => '/never',
            'enabled' => 'false',
        ],
        [
            'id' => 'unsafe',
            'from' => '/unsafe',
            'to' => "https://example.test/\r\nLocation: https://evil.test",
        ],
        [
            'id' => 'fallback',
            'from' => '/fallback',
            'to' => '/target',
            'statusCode' => 999,
        ],
    ],
]);
kodety_redirect_test_assert($legacy['version'] === 1, 'runtime deve normalizar o contrato para v1');
kodety_redirect_test_assert(array_column($legacy['entries'], 'id') === ['first', 'fallback'], 'normalização deve preservar ordem e descartar regras desativadas/inseguras');
kodety_redirect_test_assert($legacy['entries'][0]['match'] === 'prefix' && $legacy['entries'][0]['status'] === 308, 'aliases legados de match/status devem ser preservados');
kodety_redirect_test_assert($legacy['entries'][0]['preserveQuery'] === false, 'string booleana false não pode virar true no runtime PHP');
kodety_redirect_test_assert($legacy['entries'][1]['status'] === 301, 'status desconhecido deve usar 301');
kodety_redirect_test_assert(
    kodety_normalize_redirect_settings($legacy) === $legacy,
    'normalização de redirects precisa ser idempotente'
);

$exact = kodety_resolve_redirect(
    kodety_redirect_settings_fixture(kodety_redirect_fixture(['status' => 308])),
    '/old/?utm=campaign#client-fragment',
    'GET',
    'https://site.test/'
);
kodety_redirect_test_assert(is_array($exact), 'match exato deve resolver');
kodety_redirect_test_assert($exact['location'] === 'https://site.test/new?utm=campaign', 'query deve sobreviver e fragmento do request não deve ser enviado ao servidor');
kodety_redirect_test_assert($exact['status'] === 308, 'resolver deve preservar status 308');

$head = kodety_resolve_redirect(
    kodety_redirect_settings_fixture(kodety_redirect_fixture()),
    '/old',
    'HEAD',
    'https://site.test/'
);
kodety_redirect_test_assert(is_array($head), 'HEAD deve usar redirects configurados');
kodety_redirect_test_assert(
    kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture()),
        '/old',
        'POST',
        'https://site.test/'
    ) === null,
    'POST nunca deve ser redirecionado pelo runtime de páginas'
);

$prefix = kodety_resolve_redirect(
    kodety_redirect_settings_fixture(kodety_redirect_fixture([
        'source' => '/learn',
        'destination' => '/docs?lang=pt#overview',
        'match' => 'prefix',
    ])),
    '/learn/course/lesson?lang=en&utm=one&utm=two',
    'GET',
    'https://site.test/'
);
kodety_redirect_test_assert(
    $prefix['location'] === 'https://site.test/docs/course/lesson?lang=pt&utm=one&utm=two#overview',
    'prefix deve anexar suffix, manter query repetida e dar precedência à query do destino'
);
kodety_redirect_test_assert(
    kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture([
            'source' => '/learn',
            'destination' => '/docs',
            'match' => 'prefix',
        ])),
        '/learned',
        'GET',
        'https://site.test/'
    ) === null,
    'prefix precisa respeitar fronteira de segmento'
);

$without_query = kodety_resolve_redirect(
    kodety_redirect_settings_fixture(kodety_redirect_fixture([
        'source' => '/learn',
        'destination' => '/docs',
        'match' => 'prefix',
        'preserveQuery' => false,
    ])),
    '/learn/course?utm=discard',
    'GET',
    'https://site.test/'
);
kodety_redirect_test_assert($without_query['location'] === 'https://site.test/docs/course', 'preserveQuery=false deve remover a query de origem');

$wildcard = kodety_resolve_redirect(
    kodety_redirect_settings_fixture(kodety_redirect_fixture([
        'source' => '/blog/*/post/*',
        'destination' => 'https://external.test/articles/*/entry/*?ref=fixed',
        'match' => 'wildcard',
        'status' => 302,
    ])),
    '/blog/design/post/42?ref=source&utm=campaign',
    'GET',
    'https://site.test/'
);
kodety_redirect_test_assert(
    $wildcard['location'] === 'https://external.test/articles/design/entry/42?ref=fixed&utm=campaign',
    'wildcard deve substituir captures na ordem e permitir destino externo'
);
kodety_redirect_test_assert($wildcard['status'] === 302, 'destino externo deve preservar o status configurado');

$ordered = kodety_redirect_settings_fixture(
    kodety_redirect_fixture([
        'id' => 'prefix-first',
        'source' => '/learn',
        'destination' => '/docs',
        'match' => 'prefix',
    ]),
    kodety_redirect_fixture([
        'id' => 'exact-second',
        'source' => '/learn/course',
        'destination' => '/academy',
        'match' => 'exact',
    ])
);
$priority = kodety_resolve_redirect($ordered, '/learn/course', 'GET', 'https://site.test/');
kodety_redirect_test_assert($priority['id'] === 'prefix-first', 'ordem da lista, não especificidade, deve definir prioridade');

foreach ([
    '/wp-admin',
    '/wp-admin/plugins.php',
    '/wp-login.php',
    '/wp-json/v2/posts',
    '/xmlrpc.php',
    '/wp-content/uploads/image.png',
    '/wp-includes/js/jquery.js',
    '/kodety',
    '/kodety/settings',
] as $reserved) {
    kodety_redirect_test_assert(
        kodety_resolve_redirect(
            kodety_redirect_settings_fixture(kodety_redirect_fixture([
                'source' => $reserved,
                'destination' => '/blocked',
                'match' => 'prefix',
            ])),
            $reserved,
            'GET',
            'https://site.test/'
        ) === null,
        "rota reservada {$reserved} não pode ser interceptada"
    );
}
kodety_redirect_test_assert(
    is_array(kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture([
            'source' => '/kodety-stories',
            'destination' => '/stories',
        ])),
        '/kodety-stories',
        'GET',
        'https://site.test/'
    )),
    'proteção de /kodety deve respeitar fronteira de segmento'
);
kodety_redirect_test_assert(
    kodety_normalize_redirect_source('/caf%C3%A9') === '/café',
    'rota Unicode codificada e literal devem compartilhar a mesma canonicalização'
);
$unicode_redirect = kodety_resolve_redirect(
    kodety_redirect_settings_fixture(kodety_redirect_fixture([
        'source' => '/café',
        'destination' => '/coffee',
    ])),
    '/caf%C3%A9',
    'GET',
    'https://site.test/'
);
kodety_redirect_test_assert(
    $unicode_redirect['location'] === 'https://site.test/coffee',
    'runtime público deve casar URL Unicode codificada com origem literal'
);
kodety_redirect_test_assert(
    kodety_redirect_is_reserved_path('/safe/%2e%2e/wp-admin') === true,
    'dot-segment codificado não pode contornar proteção de /wp-admin'
);
kodety_redirect_test_assert(
    kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture([
            'source' => '/safe/%2e%2e/wp-admin',
            'destination' => '/blocked',
        ])),
        '/safe/%2e%2e/wp-admin',
        'GET',
        'https://site.test/'
    ) === null,
    'origem canonicalizada para rota reservada deve permanecer inerte'
);
kodety_redirect_test_assert(
    kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture([
            'source' => '/assets/app.js',
            'destination' => '/download',
        ])),
        '/assets/app.js',
        'GET',
        'https://site.test/'
    ) === null,
    'assets estáticos não devem ser interceptados por regras de página'
);

$cycle = kodety_redirect_settings_fixture(
    kodety_redirect_fixture(['id' => 'a', 'source' => '/a', 'destination' => '/b']),
    kodety_redirect_fixture(['id' => 'b', 'source' => '/b', 'destination' => '/c']),
    kodety_redirect_fixture(['id' => 'c', 'source' => '/c', 'destination' => '/a'])
);
foreach (['/a', '/b', '/c'] as $source) {
    kodety_redirect_test_assert(
        kodety_resolve_redirect($cycle, $source, 'GET', 'https://site.test/') === null,
        "membro {$source} de ciclo não pode executar"
    );
}
$prefix_cycle = kodety_redirect_settings_fixture(
    kodety_redirect_fixture([
        'id' => 'prefix-a',
        'source' => '/a',
        'destination' => '/b',
        'match' => 'prefix',
    ]),
    kodety_redirect_fixture([
        'id' => 'prefix-b',
        'source' => '/b',
        'destination' => '/a',
        'match' => 'prefix',
    ])
);
kodety_redirect_test_assert(
    kodety_resolve_redirect($prefix_cycle, '/a/child', 'GET', 'https://site.test/') === null,
    'ciclo concreto de prefix/wildcard também deve ser bloqueado'
);
kodety_redirect_test_assert(
    kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture([
            'source' => '/docs',
            'destination' => '/target',
            'match' => 'wildcard',
        ])),
        '/docs',
        'GET',
        'https://site.test/'
    ) === null,
    'wildcard inválido sem * deve permanecer inerte'
);
kodety_redirect_test_assert(
    kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture([
            'source' => '/docs/*',
            'destination' => '/target/*',
            'match' => 'exact',
        ])),
        '/docs/guide',
        'GET',
        'https://site.test/'
    ) === null,
    'runtime não pode promover silenciosamente match explícito exact para wildcard'
);
kodety_redirect_test_assert(
    kodety_resolve_redirect(
        kodety_redirect_settings_fixture(kodety_redirect_fixture([
            'source' => '/same',
            'destination' => 'https://site.test/same',
        ])),
        'https://site.test/same',
        'GET',
        'https://site.test/'
    ) === null,
    'self-loop absoluto no mesmo domínio deve ser bloqueado'
);

$subdirectory = kodety_resolve_redirect(
    kodety_redirect_settings_fixture(kodety_redirect_fixture()),
    '/wordpress/old?one=1',
    'GET',
    'https://site.test/wordpress/'
);
kodety_redirect_test_assert(
    $subdirectory['location'] === 'https://site.test/wordpress/new?one=1',
    'instalações WordPress em subdiretório devem remover e restaurar a base uma única vez'
);
kodety_redirect_test_assert(
    kodety_redirect_request_path('/wordpress-old', 'https://site.test/wordpress/') === '/wordpress-old',
    'home path deve respeitar fronteira antes de ser removido'
);

kodety_redirect_test_assert(kodety_redirect_request_is_bypassed() === false, 'requisição pública comum deve permitir redirects');
foreach (['admin', 'ajax', 'cron'] as $context) {
    $GLOBALS['kodety_redirect_test_' . $context] = true;
    kodety_redirect_test_assert(
        kodety_redirect_request_is_bypassed() === true,
        "contexto WordPress {$context} deve ignorar redirects configurados"
    );
    $GLOBALS['kodety_redirect_test_' . $context] = false;
}
$redirect_runtime_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/theme-runtime/redirects.php');
kodety_redirect_test_assert(
    str_contains($redirect_runtime_source, "defined('REST_REQUEST') && REST_REQUEST")
        && str_contains($redirect_runtime_source, "defined('XMLRPC_REQUEST') && XMLRPC_REQUEST"),
    'REST e XML-RPC devem permanecer fora do hook de redirects'
);
kodety_redirect_test_assert(
    str_contains($redirect_runtime_source, "add_action('template_redirect', 'kodety_execute_configured_redirect', -100)"),
    'redirects precisam executar antes do canonical resolver do WordPress'
);

$projection_root = sys_get_temp_dir() . '/kodety-redirect-projection-' . bin2hex(random_bytes(5));
mkdir($projection_root . '/.incode', 0777, true);
$projection_metadata = [
    'version' => 1,
    'projectId' => 'private-project-id',
    'customCode' => ['entries' => [['code' => 'private-custom-code']]],
    'redirects' => [
        'version' => 1,
        'entries' => [
            kodety_redirect_fixture(['id' => 'first', 'source' => '/first', 'destination' => '/one']),
            kodety_redirect_fixture(['id' => 'disabled', 'source' => '/disabled', 'enabled' => false]),
            kodety_redirect_fixture(['id' => 'unsafe', 'source' => '/unsafe', 'destination' => "https://example.test/\r\nLocation: https://evil.test"]),
            kodety_redirect_fixture(['id' => 'second', 'source' => '/second', 'destination' => 'https://external.test/two', 'status' => 307]),
        ],
    ],
];
file_put_contents(
    $projection_root . '/.incode/project.json',
    json_encode($projection_metadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
);
$plugin_reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $plugin_reflection->newInstanceWithoutConstructor();
$project_redirects = $plugin_reflection->getMethod('project_redirects');
$public_projection = $project_redirects->invoke($plugin, $projection_root);
kodety_redirect_test_assert(
    array_column($public_projection['entries'], 'id') === ['first', 'second'],
    'publicação deve preservar prioridade e excluir regras desativadas/inseguras'
);
kodety_redirect_test_assert(
    !str_contains((string) json_encode($public_projection), 'private-project-id')
        && !str_contains((string) json_encode($public_projection), 'private-custom-code'),
    'redirects.json público não pode expor o restante da metadata privada'
);
$plugin_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
kodety_redirect_test_assert(
    str_contains($plugin_source, "'/redirects.json'")
        && str_contains($plugin_source, "'redirects.php'")
        && str_contains($plugin_source, 'theme_runtime_sources()'),
    'tema publicado deve conter apenas a projeção redirects.json e seu runtime'
);
@unlink($projection_root . '/.incode/project.json');
@rmdir($projection_root . '/.incode');
@rmdir($projection_root);

fwrite(STDOUT, "Redirect runtime tests passed.\n");
