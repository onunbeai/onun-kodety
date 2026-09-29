<?php

/** Isolated transactional regression test for native project delta autosave. */
define('ABSPATH', __DIR__);
defined('MB_IN_BYTES') || define('MB_IN_BYTES', 1024 * 1024);
defined('DAY_IN_SECONDS') || define('DAY_IN_SECONDS', 86400);

$GLOBALS['kodety_delta_options'] = [];
$GLOBALS['kodety_delta_enabled'] = true;

final class Kodety_Edition {
    public static function visible_collection_definitions(array $definitions): array { return $definitions; }
    public static function assert_project_collection_connections(array $files, array $slugs): void {}
}

final class WP_Error {
    public function __construct(
        private string $code,
        private string $message,
        private mixed $data = null
    ) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}

final class WP_REST_Response {
    private array $headers = [];
    public function __construct(private mixed $data = null, private int $status = 200) {}
    public function get_data(): mixed { return $this->data; }
    public function get_status(): int { return $this->status; }
    public function header(string $name, string $value): void { $this->headers[$name] = $value; }
    public function get_headers(): array { return $this->headers; }
}

final class WP_REST_Request {
    /** @param array<string,string> $headers */
    public function __construct(private string $body, private array $headers = []) {}
    public function get_body(): string { return $this->body; }
    public function get_header(string $name): string {
        $needle = strtolower($name);
        foreach ($this->headers as $header => $value) {
            if (strtolower($header) === $needle) return $value;
        }
        return '';
    }
}

function is_wp_error(mixed $value): bool { return $value instanceof WP_Error; }
function get_option(string $name, mixed $default = false): mixed {
    return array_key_exists($name, $GLOBALS['kodety_delta_options'])
        ? $GLOBALS['kodety_delta_options'][$name]
        : $default;
}
function update_option(string $name, mixed $value, bool $autoload = false): bool {
    $GLOBALS['kodety_delta_options'][$name] = $value;
    return true;
}
function apply_filters(string $hook, mixed $value, mixed ...$arguments): mixed {
    return $hook === 'kodety_project_delta_enabled'
        ? $GLOBALS['kodety_delta_enabled']
        : $value;
}
function wp_mkdir_p(string $directory): bool { return is_dir($directory) || mkdir($directory, 0777, true); }
function trailingslashit(string $value): string { return rtrim($value, '/\\') . '/'; }
function sanitize_file_name(string $name): string { return preg_replace('/[^A-Za-z0-9._-]+/', '-', $name) ?: ''; }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: ''; }
function sanitize_text_field(string $value): string { return trim(strip_tags($value)); }
function wp_trim_words(string $value, int $words, string $more = ''): string {
    $parts = preg_split('/\s+/', trim($value)) ?: [];
    return implode(' ', array_slice($parts, 0, $words)) . (count($parts) > $words ? $more : '');
}
function wp_generate_password(int $length = 12, bool $special = true, bool $extra = false): string {
    return substr(bin2hex(random_bytes(max(1, (int) ceil($length / 2)))), 0, $length);
}
function wp_salt(string $scheme = 'auth'): string { return 'kodety-delta-test-salt-' . $scheme; }
function wp_json_encode(mixed $value, int $flags = 0, int $depth = 512): string|false {
    return json_encode($value, $flags, $depth);
}
function current_time(string $type): string { return gmdate('c'); }
function wp_raise_memory_limit(string $context): void {}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_delta_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_delta_remove_tree(string $directory): void {
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    rmdir($directory);
}

/** @param list<array<string,mixed>> $upserts @param list<string> $deletes @param list<array{from:string,to:string}> $moves */
function kodety_delta_body(
    int $revision,
    string $digest,
    string $request_id,
    array $upserts = [],
    array $deletes = [],
    array $moves = []
): string {
    $json = json_encode([
        'protocolVersion' => 1,
        'baseRevision' => $revision,
        'baseDigest' => $digest,
        'requestId' => $request_id,
        'upserts' => $upserts,
        'deletes' => $deletes,
        'moves' => $moves,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($json)) throw new RuntimeException('fixture JSON failed');
    return $json;
}

function kodety_delta_text(string $path, string $content): array {
    return [
        'path' => $path,
        'encoding' => 'utf8',
        'content' => $content,
        'byteLength' => strlen($content),
        'sha256' => hash('sha256', $content),
    ];
}

function kodety_delta_binary(string $path, string $content): array {
    return [
        'path' => $path,
        'encoding' => 'base64',
        'content' => base64_encode($content),
        'byteLength' => strlen($content),
        'sha256' => hash('sha256', $content),
    ];
}

$temporary = sys_get_temp_dir() . '/kodety-project-delta-' . bin2hex(random_bytes(6));
$workspace = $temporary . '/private/workspace';
mkdir($workspace . '/.incode', 0777, true);
mkdir($workspace . '/assets', 0777, true);
mkdir($workspace . '/Layers', 0777, true);
file_put_contents($workspace . '/index.html', '<!doctype html><main class="hero">Original</main>');
file_put_contents($workspace . '/about.html', '<!doctype html><main>About</main>');
file_put_contents($workspace . '/styles.css', '.hero{color:red}');
file_put_contents($workspace . '/old.txt', 'remove me');
file_put_contents($workspace . '/one.txt', 'one');
file_put_contents($workspace . '/two.txt', 'two');
file_put_contents($workspace . '/README', 'root readme');
file_put_contents($workspace . '/Layers/Card.css', '.card{display:block}');
file_put_contents($workspace . '/assets/unchanged.png', "\x89PNG\r\nunchanged");
file_put_contents($workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Delta Test',
    'projectId' => 'delta-site',
    'mainHtmlPath' => 'index.html',
]));

$reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $reflection->newInstanceWithoutConstructor();
$storage = $reflection->getProperty('storage_dir');
$storage->setValue($plugin, $temporary);
$digest_method = $reflection->getMethod('css_digest_from_directory');
$initial_digest = $digest_method->invoke($plugin, $workspace);
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 7,
    'kodety_workspace_css_digest' => $initial_digest,
    'kodety_project_name' => 'Delta Test',
    'kodety_workspace_project_id' => 'delta-site',
];

$constants = $reflection->getConstants();
kodety_delta_assert($constants['PROJECT_DELTA_MAX_OPERATIONS'] >= 512, 'servidor deve aceitar o teto operacional conservador do cliente');
kodety_delta_assert($constants['PROJECT_DELTA_MAX_BODY_BYTES'] >= 10 * 1024 * 1024, 'servidor deve aceitar o teto JSON/Base64 de 10 MiB do cliente');
$canonical_path = $reflection->getMethod('project_delta_canonical_real_path');
$windows_like_path = 'C:\\Kodety\\Private\\agency\\project-a\\workspace\\';
$expected_windows_like_path = DIRECTORY_SEPARATOR === '\\'
    ? 'c:/kodety/private/agency/project-a/workspace'
    : 'C:/Kodety/Private/agency/project-a/workspace';
kodety_delta_assert(
    $canonical_path->invoke($plugin, $windows_like_path) === $expected_windows_like_path,
    'containment incremental deve normalizar separadores e case do host Windows'
);
$plugin_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
kodety_delta_assert(
    preg_match(
        '/if \(\$workspace_locator === \'workspace\'\) \{[\s\S]*?kodety_project_name[\s\S]*?kodety_workspace_project_id/',
        $plugin_source
    ) === 1,
    'autosave de snapshot Agency não ativo não deve sobrescrever identidade global do projeto ativo'
);
kodety_delta_assert(
    preg_match(
        '/hydrate_membership_workspace[\s\S]*?project_delta_canonical_real_path\(\$root_real\)[\s\S]*?project_delta_canonical_real_path\(\$target_parent\)/',
        $plugin_source
    ) === 1,
    'containment Membership deve normalizar os realpaths antes de comparar subpastas no Windows'
);
kodety_delta_assert(
    preg_match(
        '/private function membership_asset_file[\s\S]*?project_delta_canonical_real_path\(\$root\)[\s\S]*?project_delta_canonical_real_path\(\$file\)/',
        $plugin_source
    ) === 1
        && preg_match(
            '/private function open_membership_artifact_for_transport[\s\S]*?project_delta_canonical_real_path\(\$root_real\)[\s\S]*?project_delta_canonical_real_path\(\$parent\)/',
            $plugin_source
        ) === 1,
    'assets Membership devem normalizar origem e destino antes de containment no Windows'
);

$unchanged_inode = fileinode($workspace . '/assets/unchanged.png');
$original_index_inode = fileinode($workspace . '/index.html');
$next_css = '.hero{color:rebeccapurple;display:grid}';
$new_binary = "\x00\x01delta-binary\xff";
$body = kodety_delta_body(
    7,
    $initial_digest,
    'delta-request-00000001',
    [
        kodety_delta_text('styles.css', $next_css),
        kodety_delta_text('pages/about.html', '<!doctype html><main>About moved and edited</main>'),
        kodety_delta_binary('assets/new.bin', $new_binary),
    ],
    ['old.txt'],
    [
        ['from' => 'about.html', 'to' => 'pages/about.html'],
        ['from' => 'one.txt', 'to' => 'two.txt'],
        ['from' => 'two.txt', 'to' => 'one.txt'],
        ['from' => 'README', 'to' => 'README/archive.txt'],
    ]
);
$response = $plugin->save_project_draft_delta(new WP_REST_Request($body, [
    'X-Kodety-Expected-Revision' => '7',
]));
kodety_delta_assert($response instanceof WP_REST_Response, 'change-set válido deve retornar ACK REST');
$ack = $response->get_data();
kodety_delta_assert(
    is_array($ack)
        && $ack['success'] === true
        && $ack['workspaceRevision'] === 8
        && $ack['transport'] === 'delta'
        && preg_match('/^[a-f0-9]{64}$/', $ack['cssDigest']),
    'ACK deve confirmar revisão, digest e transporte incremental'
);
kodety_delta_assert(file_get_contents($workspace . '/styles.css') === $next_css, 'upsert UTF-8 deve chegar byte a byte');
kodety_delta_assert(file_get_contents($workspace . '/assets/new.bin') === $new_binary, 'upsert Base64 deve chegar byte a byte');
kodety_delta_assert(!is_file($workspace . '/old.txt'), 'delete deve remover somente o arquivo solicitado');
kodety_delta_assert(!is_file($workspace . '/about.html') && str_contains((string) file_get_contents($workspace . '/pages/about.html'), 'edited'), 'move seguido de upsert no destino deve ser atômico');
kodety_delta_assert(file_get_contents($workspace . '/one.txt') === 'two' && file_get_contents($workspace . '/two.txt') === 'one', 'moves cíclicos devem preservar ambos os arquivos');
kodety_delta_assert(file_get_contents($workspace . '/README/archive.txt') === 'root readme', 'move deve poder transformar o antigo arquivo em diretório de destino');
kodety_delta_assert(fileinode($workspace . '/assets/unchanged.png') === $unchanged_inode, 'asset binário inalterado deve sobreviver por hardlink sem nova cópia');
kodety_delta_assert(fileinode($workspace . '/index.html') !== $original_index_inode, 'HTML deve ser copiado, nunca hardlinked a passes mutantes');
kodety_delta_assert((int) get_option('kodety_workspace_revision') === 8, 'commit deve avançar uma única revisão');

// Exact replay returns the durable ACK before comparing the now-stale base.
$replay = $plugin->save_project_draft_delta(new WP_REST_Request($body, [
    'X-Kodety-Expected-Revision' => '7',
]));
kodety_delta_assert(
    $replay instanceof WP_REST_Response
        && $replay->get_data() === $ack
        && (int) get_option('kodety_workspace_revision') === 8,
    'replay idempotente deve devolver o mesmo ACK sem novo commit'
);

$same_id_different_body = kodety_delta_body(
    8,
    (string) $ack['cssDigest'],
    'delta-request-00000001',
    [kodety_delta_text('styles.css', '.hero{color:black}')]
);
$request_id_conflict = $plugin->save_project_draft_delta(new WP_REST_Request($same_id_different_body));
kodety_delta_assert(
    $request_id_conflict instanceof WP_Error
        && $request_id_conflict->get_error_code() === 'kodety_project_delta_request_conflict'
        && ($request_id_conflict->get_error_data()['status'] ?? 0) === 409,
    'requestId reutilizado com outros bytes deve falhar fechado'
);

$stale_body = kodety_delta_body(
    7,
    $initial_digest,
    'delta-request-00000002',
    [kodety_delta_text('styles.css', '.hero{color:orange}')]
);
$stale = $plugin->save_project_draft_delta(new WP_REST_Request($stale_body));
kodety_delta_assert(
    $stale instanceof WP_Error
        && $stale->get_error_code() === 'kodety_workspace_conflict'
        && ($stale->get_error_data()['status'] ?? 0) === 409,
    'CAS deve rejeitar revisão obsoleta sem fallback ZIP'
);

$committed_index = (string) file_get_contents($workspace . '/index.html');
$committed_styles = (string) file_get_contents($workspace . '/styles.css');
$committed_binary_hash = hash_file('sha256', $workspace . '/assets/unchanged.png');
$committed_revision = (int) get_option('kodety_workspace_revision');
$committed_digest = (string) get_option('kodety_workspace_css_digest');
$component_studio_body = kodety_delta_body(
    $committed_revision,
    $committed_digest,
    'delta-request-00000003',
    [kodety_delta_text('index.html', '<!doctype html><main data-kodety-component-studio>Temporary</main>')]
);
$component_rejected = $plugin->save_project_draft_delta(new WP_REST_Request($component_studio_body));
$component_rejected_data = $component_rejected instanceof WP_Error ? $component_rejected->get_error_data() : null;
kodety_delta_assert(
    $component_rejected instanceof WP_Error
        && is_array($component_rejected_data)
        && ($component_rejected_data['status'] ?? 0) === 422
        && ($component_rejected_data['fallbackToZip'] ?? false) === true
        && ($component_rejected_data['safeToRetryAsZip'] ?? false) === true,
    'canvas temporário deve falhar ainda no staging e negociar o ZIP após rollback'
);
kodety_delta_assert(
    file_get_contents($workspace . '/index.html') === $committed_index
        && file_get_contents($workspace . '/styles.css') === $committed_styles
        && hash_file('sha256', $workspace . '/assets/unchanged.png') === $committed_binary_hash
        && (int) get_option('kodety_workspace_revision') === $committed_revision
        && (string) get_option('kodety_workspace_css_digest') === $committed_digest,
    'falha semântica deve preservar workspace, opções e asset hardlinked byte a byte'
);

$unsafe_body = kodety_delta_body(
    $committed_revision,
    $committed_digest,
    'delta-request-00000004',
    [kodety_delta_text('uploads/runner.php', '<?php echo "unsafe";')]
);
$unsafe = $plugin->save_project_draft_delta(new WP_REST_Request($unsafe_body));
$unsafe_data = $unsafe instanceof WP_Error ? $unsafe->get_error_data() : null;
kodety_delta_assert(
    $unsafe instanceof WP_Error
        && $unsafe->get_error_code() === 'kodety_project_delta_file_fallback'
        && is_array($unsafe_data)
        && ($unsafe_data['status'] ?? 0) === 415
        && ($unsafe_data['fallbackToZip'] ?? false) === true
        && ($unsafe_data['safeToRetryAsZip'] ?? false) === true
        && !is_file($workspace . '/uploads/runner.php'),
    'tipo incompatível deve negociar fallback ZIP antes de criar staging vivo'
);

$drive_path_body = kodety_delta_body(
    $committed_revision,
    $committed_digest,
    'delta-request-drive-path-01',
    [kodety_delta_text('C:/index.html', '<main>unsafe drive path</main>')]
);
$drive_path = $plugin->save_project_draft_delta(new WP_REST_Request($drive_path_body));
$drive_path_data = $drive_path instanceof WP_Error ? $drive_path->get_error_data() : null;
kodety_delta_assert(
    $drive_path instanceof WP_Error
        && is_array($drive_path_data)
        && ($drive_path_data['status'] ?? 0) === 422
        && ($drive_path_data['fallbackToZip'] ?? false) === true
        && ($drive_path_data['safeToRetryAsZip'] ?? false) === true,
    'path com prefixo de drive deve negociar fallback antes de resolver o staging'
);

$case_collision_body = kodety_delta_body(
    $committed_revision,
    $committed_digest,
    'delta-request-00000005',
    [kodety_delta_text('layers/Other.css', '.other{display:grid}')]
);
$case_collision = $plugin->save_project_draft_delta(new WP_REST_Request($case_collision_body));
$case_collision_data = $case_collision instanceof WP_Error ? $case_collision->get_error_data() : null;
kodety_delta_assert(
    $case_collision instanceof WP_Error
        && is_array($case_collision_data)
        && ($case_collision_data['status'] ?? 0) === 422
        && ($case_collision_data['fallbackToZip'] ?? false) === true
        && ($case_collision_data['safeToRetryAsZip'] ?? false) === true
        && !is_file($workspace . '/layers/Other.css')
        && file_get_contents($workspace . '/Layers/Card.css') === '.card{display:block}',
    'manifest deve bloquear colisão case-fold em segmentos sem tocar no original'
);

// A one-directory wrapper is part of the Builder file graph. Delta paths must
// remain relative to the workspace container, exactly like entries in a ZIP.
$wrapped_storage = $temporary . '/wrapped-installation';
$wrapped_workspace = $wrapped_storage . '/private/workspace/site';
mkdir($wrapped_workspace . '/.incode', 0777, true);
file_put_contents($wrapped_workspace . '/index.html', '<!doctype html><main>Wrapped</main>');
file_put_contents($wrapped_workspace . '/styles.css', 'main{color:red}');
file_put_contents($wrapped_workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Wrapped',
    'projectId' => 'wrapped-site',
    'mainHtmlPath' => 'index.html',
]));
$wrapped_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($wrapped_plugin, $wrapped_storage);
$wrapped_digest = $digest_method->invoke($wrapped_plugin, dirname($wrapped_workspace));
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 21,
    'kodety_workspace_css_digest' => $wrapped_digest,
];
$wrapped_root_metadata = json_encode([
    'version' => 1,
    'name' => 'Wrapped',
    'projectId' => 'wrapped-site',
    'mainHtmlPath' => 'site/index.html',
    'rootPath' => 'site',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
$wrapped_body = kodety_delta_body(
    21,
    $wrapped_digest,
    'delta-request-00000006',
    [
        kodety_delta_text('site/styles.css', 'main{color:blue}'),
        kodety_delta_text('.incode/project.json', (string) $wrapped_root_metadata),
    ]
);
$wrapped_response = $wrapped_plugin->save_project_draft_delta(new WP_REST_Request($wrapped_body));
kodety_delta_assert(
    $wrapped_response instanceof WP_REST_Response
        && file_get_contents($wrapped_storage . '/private/workspace/site/styles.css') === 'main{color:blue}'
        && is_file($wrapped_storage . '/private/workspace/.incode/project.json')
        && !is_dir($wrapped_storage . '/private/workspace/site/site'),
    'workspace encapsulado deve aplicar paths no mesmo root lógico do ZIP'
);

// The lightweight Settings snapshot deliberately exposes the collapsed
// authored root. Its explicit header must keep those paths inside the wrapper,
// without changing the wrapper-inclusive contract exercised immediately above.
$surface_wrapped_storage = $temporary . '/surface-wrapped-installation';
$surface_wrapped_workspace = $surface_wrapped_storage . '/private/workspace/site';
mkdir($surface_wrapped_workspace . '/.incode', 0777, true);
file_put_contents($surface_wrapped_workspace . '/index.html', '<!doctype html><main>Surface original</main>');
file_put_contents($surface_wrapped_workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Surface wrapped',
    'projectId' => 'surface-wrapped-site',
    'mainHtmlPath' => 'index.html',
]));
$surface_wrapped_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($surface_wrapped_plugin, $surface_wrapped_storage);
$surface_wrapped_digest = $digest_method->invoke($surface_wrapped_plugin, dirname($surface_wrapped_workspace));
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 22,
    'kodety_workspace_css_digest' => $surface_wrapped_digest,
];
$surface_wrapped_metadata = json_encode([
    'version' => 1,
    'name' => 'Surface wrapped',
    'projectId' => 'surface-wrapped-site',
    'mainHtmlPath' => 'index.html',
    'rootPath' => '',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
$surface_wrapped_body = kodety_delta_body(
    22,
    $surface_wrapped_digest,
    'delta-request-00000007',
    [
        kodety_delta_text('index.html', '<!doctype html><main>Surface saved</main>'),
        kodety_delta_text('.incode/project.json', (string) $surface_wrapped_metadata),
    ]
);
$surface_wrapped_response = $surface_wrapped_plugin->save_project_draft_delta(new WP_REST_Request(
    $surface_wrapped_body,
    ['X-Kodety-Delta-Root' => 'project']
));
kodety_delta_assert(
    $surface_wrapped_response instanceof WP_REST_Response
        && file_get_contents($surface_wrapped_workspace . '/index.html') === '<!doctype html><main>Surface saved</main>'
        && is_file($surface_wrapped_workspace . '/.incode/project.json')
        && !is_dir($surface_wrapped_storage . '/private/workspace/.incode')
        && !is_file($surface_wrapped_storage . '/private/workspace/index.html'),
    'Settings leve deve salvar apenas dentro da raiz autoral colapsada'
);

// Legacy coded projects are persisted in their generated publication graph,
// but hydrateCodedProject() removes that graph before the Builder acknowledges
// its baseline. A CSS-only delta must therefore restore the untouched authorial
// HTML and remove generated files/manifest, otherwise the stale `originals`
// entry would overwrite a later HTML edit when the project reopens. The
// manifest stays at the transport root even when its project files are wrapped.
$coded_storage = $temporary . '/wrapped-coded-installation';
$coded_workspace = $coded_storage . '/private/workspace';
mkdir($coded_workspace . '/.incode', 0777, true);
mkdir($coded_workspace . '/site/src', 0777, true);
mkdir($coded_workspace . '/kodety-build/site/src', 0777, true);
$coded_author_html = '<!doctype html><main>Author source</main><script type="module" src="src/main.js"></script>';
$coded_generated_html = '<!doctype html><main>Generated transport</main><script type="module" src="../kodety-build/site/src/main.js"></script>';
$coded_metadata = json_encode([
    'version' => 1,
    'name' => 'Wrapped Coded',
    'projectId' => 'wrapped-coded-site',
    'mainHtmlPath' => 'site/index.html',
    'rootPath' => 'site',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
file_put_contents($coded_workspace . '/site/index.html', $coded_generated_html);
file_put_contents($coded_workspace . '/index.html', $coded_generated_html);
file_put_contents($coded_workspace . '/site/styles.css', 'main{color:red}');
file_put_contents($coded_workspace . '/site/src/main.js', 'document.body.dataset.author = "yes";');
file_put_contents($coded_workspace . '/kodety-build/site/src/main.js', '/* generated */document.body.dataset.build = "stale";');
file_put_contents($coded_workspace . '/.incode/project.json', (string) $coded_metadata);
file_put_contents($coded_workspace . '/.incode/coded-build.json', json_encode([
    'version' => 2,
    'originals' => ['site/index.html' => $coded_author_html],
    'generated' => ['index.html', 'kodety-build/site/src/main.js'],
    'entrypoints' => ['kodety-build/site/src/main.js'],
    'modules' => [],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
$coded_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($coded_plugin, $coded_storage);
$coded_digest = $digest_method->invoke($coded_plugin, $coded_workspace);
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 25,
    'kodety_workspace_css_digest' => $coded_digest,
    'kodety_project_name' => 'Wrapped Coded',
    'kodety_workspace_project_id' => 'wrapped-coded-site',
];
$coded_body = kodety_delta_body(
    25,
    $coded_digest,
    'delta-coded-wrapper-0001',
    [
        kodety_delta_text('site/styles.css', 'main{color:blue}'),
        kodety_delta_text('.incode/project.json', (string) $coded_metadata),
    ]
);
$coded_response = $coded_plugin->save_project_draft_delta(
    new WP_REST_Request($coded_body, ['X-Kodety-Expected-Revision' => '25'])
);
kodety_delta_assert(
    $coded_response instanceof WP_REST_Response
        && file_get_contents($coded_workspace . '/site/index.html') === $coded_author_html
        && file_get_contents($coded_workspace . '/site/styles.css') === 'main{color:blue}'
        && file_get_contents($coded_workspace . '/site/src/main.js') === 'document.body.dataset.author = "yes";'
        && !is_file($coded_workspace . '/index.html')
        && !is_file($coded_workspace . '/kodety-build/site/src/main.js')
        && !is_file($coded_workspace . '/.incode/coded-build.json')
        && (int) get_option('kodety_workspace_revision') === 26,
    'delta coded-build deve partir do grafo autoral hidratado mesmo com arquivos encapsulados'
);

// If an old-but-browser-hydratable manifest uses coercions outside the safe
// server subset, ZIP is the exact compatibility representation. The endpoint
// must advertise that fallback before even allocating a staging directory.
$coded_fallback_storage = $temporary . '/coded-fallback-installation';
$coded_fallback_workspace = $coded_fallback_storage . '/private/workspace';
mkdir($coded_fallback_workspace . '/.incode', 0777, true);
file_put_contents($coded_fallback_workspace . '/index.html', '<main>Generated legacy page</main>');
file_put_contents($coded_fallback_workspace . '/styles.css', 'main{color:red}');
file_put_contents($coded_fallback_workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Coded Fallback',
    'projectId' => 'coded-fallback-site',
    'mainHtmlPath' => 'index.html',
]));
file_put_contents($coded_fallback_workspace . '/.incode/coded-build.json', json_encode([
    'version' => 1,
    // hydrateCodedProject() applies String(123); PHP intentionally refuses to
    // guess JavaScript coercions and asks for the already-hydrated ZIP instead.
    'originals' => ['index.html' => 123],
    'generated' => [],
]));
$coded_fallback_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($coded_fallback_plugin, $coded_fallback_storage);
$coded_fallback_digest = $digest_method->invoke($coded_fallback_plugin, $coded_fallback_workspace);
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 27,
    'kodety_workspace_css_digest' => $coded_fallback_digest,
];
$coded_fallback_body = kodety_delta_body(
    27,
    $coded_fallback_digest,
    'delta-coded-fallback-01',
    [kodety_delta_text('styles.css', 'main{color:purple}')]
);
$coded_fallback_response = $coded_fallback_plugin->save_project_draft_delta(
    new WP_REST_Request($coded_fallback_body)
);
$coded_fallback_data = $coded_fallback_response instanceof WP_Error
    ? $coded_fallback_response->get_error_data()
    : null;
kodety_delta_assert(
    $coded_fallback_response instanceof WP_Error
        && $coded_fallback_response->get_error_code() === 'kodety_project_delta_coded_build_fallback'
        && is_array($coded_fallback_data)
        && ($coded_fallback_data['status'] ?? 0) === 413
        && ($coded_fallback_data['fallbackToZip'] ?? false) === true
        && ($coded_fallback_data['safeToRetryAsZip'] ?? false) === true
        && file_get_contents($coded_fallback_workspace . '/styles.css') === 'main{color:red}'
        && (int) get_option('kodety_workspace_revision') === 27
        && glob($coded_fallback_storage . '/private/.workspace-delta-*') === [],
    'coded-build fora do subset seguro deve cair em ZIP antes de staging ou mutação'
);

// A published Membership workspace stores scrubbed HTML and authenticated
// private assets below a single project wrapper. The Builder, however, diffs
// the hydrated authoring graph: editorHtml at the page path, plaintext at each
// sourcePath and no runtime transport artifact. Delta staging must reconstruct
// that exact base before applying even an unrelated CSS edit. Adding root
// metadata during the transaction must not make collapse_single_root() lose
// the already-resolved Membership root.
$membership_storage = $temporary . '/wrapped-membership-installation';
$membership_workspace = $membership_storage . '/private/workspace/site';
$membership_runtime_directory = $membership_workspace . '/.incode/membership/assets';
mkdir($membership_runtime_directory, 0777, true);
$membership_editor_html = '<!doctype html><main data-kodety-membership-gate="course">Private authoring page</main>';
$membership_public_html = '<!doctype html><main data-kodety-access-placeholder="course" hidden></main>';
$membership_asset_id = 'asset-0123456789abcdef01234567';
$membership_asset_storage = '.incode/membership/assets/' . $membership_asset_id . '.bin';
$membership_asset_plaintext = "PK\x03\x04protected-course-" . str_repeat('lesson-', 64);
$membership_rule = [
    'requirement' => ['type' => 'authenticated'],
    'anonymous' => ['type' => 'branch', 'branch' => 'guest'],
    'denied' => ['type' => 'branch', 'branch' => 'upgrade'],
];
$membership_runtime = [
    'version' => 1,
    'enabled' => true,
    'projectId' => 'wrapped-membership-site',
    'pages' => [
        'index.html' => [
            'path' => 'index.html',
            'runtimePath' => 'index.html',
            'authoredPath' => 'index.html',
            'editorHtml' => $membership_editor_html,
            'gates' => [],
        ],
    ],
    'assets' => [
        $membership_asset_id => [
            'id' => $membership_asset_id,
            'sourcePath' => 'downloads/course.zip',
            'storagePath' => $membership_asset_storage,
            'filename' => 'course.zip',
            'mimeType' => 'application/zip',
            'size' => strlen($membership_asset_plaintext),
            'sha256' => hash('sha256', $membership_asset_plaintext),
            'contexts' => [['allOf' => [$membership_rule]]],
        ],
    ],
];
file_put_contents($membership_workspace . '/index.html', $membership_public_html);
file_put_contents($membership_workspace . '/styles.css', 'main{color:red}');
file_put_contents($membership_workspace . '/' . $membership_asset_storage, $membership_asset_plaintext);
file_put_contents(
    $membership_workspace . '/.incode/membership/runtime.json',
    json_encode($membership_runtime, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
);
file_put_contents($membership_workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Wrapped Membership',
    'projectId' => 'wrapped-membership-site',
    'mainHtmlPath' => 'index.html',
]));
$seal_membership_assets = $reflection->getMethod('seal_membership_assets');
$seal_membership_assets->invoke($wrapped_plugin, $membership_workspace);
$seal_membership_artifact = $reflection->getMethod('seal_membership_artifact');
$seal_membership_artifact->invoke($wrapped_plugin, $membership_workspace);
kodety_delta_assert(
    str_starts_with(
        (string) file_get_contents($membership_workspace . '/' . $membership_asset_storage),
        'KDAYA01!'
    ),
    'fixture Membership deve começar com asset autenticado em repouso'
);

$membership_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($membership_plugin, $membership_storage);
$membership_digest = $digest_method->invoke($membership_plugin, dirname($membership_workspace));
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 31,
    'kodety_workspace_css_digest' => $membership_digest,
    'kodety_project_name' => 'Wrapped Membership',
    'kodety_workspace_project_id' => 'wrapped-membership-site',
];
$membership_root_metadata = json_encode([
    'version' => 1,
    'name' => 'Wrapped Membership',
    'projectId' => 'wrapped-membership-site',
    'mainHtmlPath' => 'site/index.html',
    'rootPath' => 'site',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
$membership_body = kodety_delta_body(
    31,
    $membership_digest,
    'delta-membership-wrap-01',
    [
        kodety_delta_text('site/styles.css', 'main{color:green}'),
        kodety_delta_text('.incode/project.json', (string) $membership_root_metadata),
    ]
);
$membership_response = $membership_plugin->save_project_draft_delta(
    new WP_REST_Request($membership_body, ['X-Kodety-Expected-Revision' => '31'])
);
$membership_committed = $membership_storage . '/private/workspace/site';
kodety_delta_assert(
    $membership_response instanceof WP_REST_Response
        && file_get_contents($membership_committed . '/styles.css') === 'main{color:green}'
        && file_get_contents($membership_committed . '/index.html') === $membership_editor_html
        && file_get_contents($membership_committed . '/downloads/course.zip') === $membership_asset_plaintext
        && !is_file($membership_committed . '/' . $membership_asset_storage)
        && !is_file($membership_committed . '/.incode/membership/runtime.json')
        && is_file($membership_storage . '/private/workspace/.incode/project.json'),
    'delta Membership encapsulado deve partir do grafo autoral e preservar página/asset sem runtime stale'
);

// The supported combined transport keeps both generated contracts at the ZIP
// root even when authored files live below a wrapper. Browser hydration runs
// coded-build first and Membership second, so editorHtml must win over the coded
// original while the protected asset returns to its authored path. A CSS-only
// delta proves this normalization is independent from the files being edited.
$combined_storage = $temporary . '/coded-membership-installation';
$combined_workspace = $combined_storage . '/private/workspace';
$combined_asset_id = 'asset-fedcba9876543210fedcba98';
$combined_asset_storage = '.incode/membership/assets/' . $combined_asset_id . '.bin';
$combined_asset_plaintext = "PK\x03\x04combined-guide-" . str_repeat('chapter-', 48);
$combined_coded_html = '<!doctype html><main>Coded author source</main>';
$combined_membership_html = '<!doctype html><main data-kodety-membership-gate="members">Membership author source</main>';
$combined_generated_html = '<!doctype html><main data-kodety-access-placeholder="members" hidden>Generated public source</main>';
mkdir($combined_workspace . '/.incode/membership/assets', 0777, true);
mkdir($combined_workspace . '/site', 0777, true);
mkdir($combined_workspace . '/kodety-build/site', 0777, true);
file_put_contents($combined_workspace . '/site/index.html', $combined_generated_html);
file_put_contents($combined_workspace . '/site/styles.css', 'main{color:red}');
file_put_contents($combined_workspace . '/kodety-build/site/main.js', '/* generated combined build */');
file_put_contents($combined_workspace . '/' . $combined_asset_storage, $combined_asset_plaintext);
file_put_contents($combined_workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Coded Membership',
    'projectId' => 'coded-membership-site',
    'mainHtmlPath' => 'site/index.html',
    'rootPath' => 'site',
]));
file_put_contents($combined_workspace . '/.incode/coded-build.json', json_encode([
    'version' => 2,
    'originals' => ['site/index.html' => $combined_coded_html],
    'generated' => ['kodety-build/site/main.js'],
    'entrypoints' => ['kodety-build/site/main.js'],
    'modules' => [],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
file_put_contents($combined_workspace . '/.incode/membership/runtime.json', json_encode([
    'version' => 1,
    'enabled' => true,
    'projectId' => 'coded-membership-site',
    'pages' => [
        'site/index.html' => [
            'path' => 'site/index.html',
            'runtimePath' => 'site/index.html',
            'authoredPath' => 'site/index.html',
            'editorHtml' => $combined_membership_html,
            'gates' => [],
        ],
    ],
    'assets' => [
        $combined_asset_id => [
            'id' => $combined_asset_id,
            'sourcePath' => 'site/downloads/guide.zip',
            'storagePath' => $combined_asset_storage,
            'filename' => 'guide.zip',
            'mimeType' => 'application/zip',
            'size' => strlen($combined_asset_plaintext),
            'sha256' => hash('sha256', $combined_asset_plaintext),
            'contexts' => [['allOf' => [$membership_rule]]],
        ],
    ],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
$combined_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($combined_plugin, $combined_storage);
$seal_membership_assets->invoke($combined_plugin, $combined_workspace);
$seal_membership_artifact->invoke($combined_plugin, $combined_workspace);
$combined_digest = $digest_method->invoke($combined_plugin, $combined_workspace);
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 35,
    'kodety_workspace_css_digest' => $combined_digest,
    'kodety_project_name' => 'Coded Membership',
    'kodety_workspace_project_id' => 'coded-membership-site',
];
$combined_body = kodety_delta_body(
    35,
    $combined_digest,
    'delta-coded-membership-01',
    [kodety_delta_text('site/styles.css', 'main{color:purple}')]
);
$combined_response = $combined_plugin->save_project_draft_delta(
    new WP_REST_Request($combined_body, ['X-Kodety-Expected-Revision' => '35'])
);
kodety_delta_assert(
    $combined_response instanceof WP_REST_Response
        && file_get_contents($combined_workspace . '/site/styles.css') === 'main{color:purple}'
        && file_get_contents($combined_workspace . '/site/index.html') === $combined_membership_html
        && file_get_contents($combined_workspace . '/site/index.html') !== $combined_coded_html
        && file_get_contents($combined_workspace . '/site/downloads/guide.zip') === $combined_asset_plaintext
        && !is_file($combined_workspace . '/' . $combined_asset_storage)
        && !is_file($combined_workspace . '/.incode/coded-build.json')
        && !is_file($combined_workspace . '/.incode/membership/runtime.json')
        && !is_file($combined_workspace . '/kodety-build/site/main.js')
        && (int) get_option('kodety_workspace_revision') === 36,
    'delta combinado deve hidratar coded-build antes de Membership e remover ambos os artefatos'
);

$cache_path_method = $reflection->getMethod('project_zip_cache_path');
$cache_revision_21 = $cache_path_method->invoke($wrapped_plugin, 21, str_repeat('a', 64));
$cache_revision_22 = $cache_path_method->invoke($wrapped_plugin, 22, str_repeat('a', 64));
kodety_delta_assert(
    $cache_revision_21 !== $cache_revision_22
        && str_contains($cache_revision_21, '-r21-')
        && str_contains($cache_revision_22, '-r22-'),
    'cache ZIP deve ser naturalmente isolado por revisão após commit delta'
);

// Receipts live in one WordPress option, but their identity is scoped to the
// exact mounted workspace. An identical request ID/fingerprint acknowledged
// for Agency A must never short-circuit a save against default/project B.
$scope_storage = $temporary . '/receipt-scope';
$scope_b_workspace = $scope_storage . '/private/workspace';
$scope_a_workspace = $scope_storage . '/private/agency/project-a/workspace';
mkdir($scope_b_workspace . '/.incode', 0777, true);
mkdir($scope_a_workspace . '/.incode', 0777, true);
file_put_contents($scope_b_workspace . '/index.html', '<!doctype html><main>Scope B</main>');
file_put_contents($scope_b_workspace . '/styles.css', 'main{color:navy}');
file_put_contents($scope_b_workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Scope B',
    'projectId' => 'scope-b',
    'mainHtmlPath' => 'index.html',
]));
file_put_contents($scope_a_workspace . '/index.html', '<!doctype html><main>Agency A</main>');
file_put_contents($scope_a_workspace . '/styles.css', 'main{color:maroon}');
file_put_contents($scope_a_workspace . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Agency A',
    'projectId' => 'agency-a',
    'mainHtmlPath' => 'index.html',
]));
$scope_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($scope_plugin, $scope_storage);
$scope_b_digest = $digest_method->invoke($scope_plugin, $scope_b_workspace);
$scope_request_id = 'delta-scope-request-0001';
$scope_next_css = 'main{color:teal}';
$scope_body = kodety_delta_body(
    50,
    $scope_b_digest,
    $scope_request_id,
    [kodety_delta_text('styles.css', $scope_next_css)]
);
$scope_fingerprint = hash('sha256', $scope_body);
$scope_a_ack = [
    'success' => true,
    'savedAt' => 'agency-a-time',
    'projectName' => 'Agency A',
    'projectId' => 'agency-a',
    'workspaceRevision' => 999,
    'cssDigest' => str_repeat('a', 64),
    'transport' => 'delta',
];
$scope_a_locator = 'agency/project-a/workspace';
$scope_a_receipt_key = hash('sha256', $scope_a_locator . "\0" . $scope_request_id);
$scope_a_hash_before = hash_file('sha256', $scope_a_workspace . '/styles.css');
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 50,
    'kodety_workspace_css_digest' => $scope_b_digest,
    'kodety_project_name' => 'Scope B',
    'kodety_workspace_project_id' => 'scope-b',
    'kodety_project_delta_receipts' => [
        $scope_a_receipt_key => [
            'createdAt' => time(),
            'workspaceLocator' => $scope_a_locator,
            'requestId' => $scope_request_id,
            'fingerprint' => $scope_fingerprint,
            'result' => $scope_a_ack,
        ],
        // Legacy unscoped records are deliberately ignored after this change.
        $scope_request_id => [
            'createdAt' => time(),
            'fingerprint' => $scope_fingerprint,
            'result' => $scope_a_ack,
        ],
    ],
];
$scope_response = $scope_plugin->save_project_draft_delta(new WP_REST_Request($scope_body));
$scope_ack = $scope_response instanceof WP_REST_Response ? $scope_response->get_data() : null;
kodety_delta_assert(
    $scope_response instanceof WP_REST_Response
        && is_array($scope_ack)
        && $scope_ack !== $scope_a_ack
        && $scope_ack['projectName'] === 'Scope B'
        && $scope_ack['workspaceRevision'] === 51
        && file_get_contents($scope_b_workspace . '/styles.css') === $scope_next_css
        && hash_file('sha256', $scope_a_workspace . '/styles.css') === $scope_a_hash_before,
    'receipt de Agency A não deve virar ACK nem impedir commit no workspace B'
);

// Simulate a killed PHP worker after the new workspace/options were exposed
// but before an idempotency receipt existed. The next locked operation must
// restore Agency project A from the durable journal even if the next request
// is mounted on the default/project B workspace.
$journal_storage = $temporary . '/journal-rollback';
$journal_workspace_locator = 'agency/project-a/workspace';
$journal_workspace = $journal_storage . '/private/' . $journal_workspace_locator;
$journal_context_b_workspace = $journal_storage . '/private/workspace';
$journal_backup_name = '.workspace-delta-backup-1111111111111111';
$journal_staging_name = '.workspace-delta-1111111111111111';
$journal_backup = $journal_storage . '/private/' . $journal_backup_name;
mkdir($journal_workspace, 0777, true);
mkdir($journal_context_b_workspace, 0777, true);
mkdir($journal_backup, 0777, true);
file_put_contents($journal_workspace . '/index.html', '<main>new unacknowledged</main>');
file_put_contents($journal_workspace . '/styles.css', 'main{color:new}');
file_put_contents($journal_context_b_workspace . '/index.html', '<main>project B remains mounted</main>');
file_put_contents($journal_context_b_workspace . '/styles.css', 'main{color:blue}');
file_put_contents($journal_backup . '/index.html', '<main>old durable</main>');
file_put_contents($journal_backup . '/styles.css', 'main{color:old}');
$journal_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($journal_plugin, $journal_storage);
$journal_previous_digest = $digest_method->invoke($journal_plugin, $journal_backup);
$journal_next_digest = $digest_method->invoke($journal_plugin, $journal_workspace);
$journal_previous_options = [
    'kodety_workspace_revision' => 30,
    'kodety_workspace_css_digest' => $journal_previous_digest,
    'kodety_draft_updated_at' => 'old-time',
    'kodety_project_delta_receipts' => [],
];
$journal_ack = [
    'success' => true,
    'savedAt' => 'new-time',
    'projectName' => 'New',
    'projectId' => 'new-site',
    'workspaceRevision' => 31,
    'cssDigest' => $journal_next_digest,
    'transport' => 'delta',
];
$GLOBALS['kodety_delta_options'] = array_merge($journal_previous_options, [
    'kodety_workspace_revision' => 31,
    'kodety_workspace_css_digest' => $journal_next_digest,
    'kodety_project_name' => 'Context B stays active',
    'kodety_workspace_project_id' => 'context-b',
]);
$write_journal = $reflection->getMethod('write_project_delta_journal');
$rollback_fingerprint = hash('sha256', 'rollback-after-process-death');
$write_journal->invoke($journal_plugin, [
    'version' => 1,
    'workspaceLocator' => $journal_workspace_locator,
    'requestId' => 'delta-journal-rollback-01',
    'fingerprint' => $rollback_fingerprint,
    'staging' => $journal_staging_name,
    'backup' => $journal_backup_name,
    'previousDigest' => $journal_previous_digest,
    'nextDigest' => $journal_next_digest,
    'nextRevision' => 31,
    'previousOptions' => $journal_previous_options,
    'ack' => $journal_ack,
]);
$context_b_hash_before_recovery = hash_file('sha256', $journal_context_b_workspace . '/index.html');
$external_lock = fopen($journal_storage . '/.workspace.lock', 'c+');
kodety_delta_assert(
    is_resource($external_lock) && flock($external_lock, LOCK_EX),
    'writer externo deve adquirir o mesmo flock do autosave delta'
);
$recover_locked_writer = $reflection->getMethod('recover_project_delta_for_locked_writer');
try {
    $recover_locked_writer->invoke($journal_plugin);
    file_put_contents($journal_workspace . '/mcp-after-recovery.txt', 'MCP ACK after recovery');
} finally {
    if (is_resource($external_lock)) {
        flock($external_lock, LOCK_UN);
        fclose($external_lock);
    }
}
$with_workspace_lock = $reflection->getMethod('with_workspace_lock');
$with_workspace_lock->invoke($journal_plugin, static fn(): bool => true);
kodety_delta_assert(
    file_get_contents($journal_workspace . '/index.html') === '<main>old durable</main>'
        && hash_file('sha256', $journal_context_b_workspace . '/index.html') === $context_b_hash_before_recovery
        && file_get_contents($journal_context_b_workspace . '/styles.css') === 'main{color:blue}'
        && (int) get_option('kodety_workspace_revision') === 30
        && (string) get_option('kodety_workspace_css_digest') === $journal_previous_digest
        && (string) get_option('kodety_project_name') === 'Context B stays active'
        && (string) get_option('kodety_workspace_project_id') === 'context-b'
        && file_get_contents($journal_workspace . '/mcp-after-recovery.txt') === 'MCP ACK after recovery'
        && !is_dir($journal_backup)
        && !is_file($journal_storage . '/private/.project-delta-journal.json'),
    'journal de Agency A deve reverter somente A mesmo sob contexto/default B'
);

$mcp_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-mcp.php');
kodety_delta_assert(
    preg_match(
        '/flock\(\$handle, LOCK_EX\)[\s\S]*?recover_project_delta_for_locked_writer\(\)/',
        $mcp_source
    ) === 1,
    'MCP deve recuperar journal pendente logo após adquirir o flock compartilhado'
);

// With the exact durable receipt, recovery completes the commit and removes
// only the obsolete backup instead of rolling the acknowledged revision back.
$journal_commit_storage = $temporary . '/journal-commit';
$journal_commit_workspace = $journal_commit_storage . '/private/workspace';
$journal_commit_backup_name = '.workspace-delta-backup-2222222222222222';
$journal_commit_staging_name = '.workspace-delta-2222222222222222';
$journal_commit_backup = $journal_commit_storage . '/private/' . $journal_commit_backup_name;
mkdir($journal_commit_workspace, 0777, true);
mkdir($journal_commit_backup, 0777, true);
file_put_contents($journal_commit_workspace . '/index.html', '<main>committed new</main>');
file_put_contents($journal_commit_workspace . '/styles.css', 'main{color:green}');
file_put_contents($journal_commit_backup . '/index.html', '<main>obsolete old</main>');
file_put_contents($journal_commit_backup . '/styles.css', 'main{color:gray}');
$journal_commit_plugin = $reflection->newInstanceWithoutConstructor();
$storage->setValue($journal_commit_plugin, $journal_commit_storage);
$commit_previous_digest = $digest_method->invoke($journal_commit_plugin, $journal_commit_backup);
$commit_next_digest = $digest_method->invoke($journal_commit_plugin, $journal_commit_workspace);
$commit_request_id = 'delta-journal-commit-0001';
$commit_fingerprint = hash('sha256', 'commit-after-process-death');
$commit_ack = [
    'success' => true,
    'savedAt' => 'commit-time',
    'projectName' => 'Committed',
    'projectId' => 'committed-site',
    'workspaceRevision' => 41,
    'cssDigest' => $commit_next_digest,
    'transport' => 'delta',
];
$commit_previous_options = [
    'kodety_workspace_revision' => 40,
    'kodety_workspace_css_digest' => $commit_previous_digest,
    'kodety_project_delta_receipts' => [],
];
$commit_workspace_locator = 'workspace';
$commit_receipt_key = hash('sha256', $commit_workspace_locator . "\0" . $commit_request_id);
$GLOBALS['kodety_delta_options'] = [
    'kodety_workspace_revision' => 41,
    'kodety_workspace_css_digest' => $commit_next_digest,
    'kodety_project_delta_receipts' => [
        $commit_receipt_key => [
            'createdAt' => time(),
            'workspaceLocator' => $commit_workspace_locator,
            'requestId' => $commit_request_id,
            'fingerprint' => $commit_fingerprint,
            'result' => $commit_ack,
        ],
    ],
];
$write_journal->invoke($journal_commit_plugin, [
    'version' => 1,
    'workspaceLocator' => $commit_workspace_locator,
    'requestId' => $commit_request_id,
    'fingerprint' => $commit_fingerprint,
    'staging' => $journal_commit_staging_name,
    'backup' => $journal_commit_backup_name,
    'previousDigest' => $commit_previous_digest,
    'nextDigest' => $commit_next_digest,
    'nextRevision' => 41,
    'previousOptions' => $commit_previous_options,
    'ack' => $commit_ack,
]);
$with_workspace_lock->invoke($journal_commit_plugin, static fn(): bool => true);
kodety_delta_assert(
    file_get_contents($journal_commit_workspace . '/index.html') === '<main>committed new</main>'
        && (int) get_option('kodety_workspace_revision') === 41
        && !is_dir($journal_commit_backup)
        && !is_file($journal_commit_storage . '/private/.project-delta-journal.json'),
    'journal com receipt deve concluir cleanup sem reverter commit confirmado'
);

$GLOBALS['kodety_delta_enabled'] = false;
$disabled = $plugin->save_project_draft_delta(new WP_REST_Request($unsafe_body));
$disabled_data = $disabled instanceof WP_Error ? $disabled->get_error_data() : [];
kodety_delta_assert(
    $disabled instanceof WP_Error
        && ($disabled_data['status'] ?? 0) === 501
        && ($disabled_data['fallbackToZip'] ?? false) === true
        && ($disabled_data['safeToRetryAsZip'] ?? false) === true,
    'capability desativada deve autorizar ZIP somente antes de qualquer mutação'
);

kodety_delta_remove_tree($temporary);
fwrite(STDOUT, "Project delta runtime: transação, CAS, idempotência e rollback aprovados.\n");
