<?php

/** Runtime contract for lightweight Settings/Analytics project snapshots. */
define('ABSPATH', __DIR__);

$GLOBALS['kodety_surface_options'] = [];
$GLOBALS['kodety_surface_can_edit'] = true;
$GLOBALS['kodety_surface_revision_sequence'] = [];
$GLOBALS['kodety_surface_share_context'] = null;
$GLOBALS['kodety_surface_share_can_edit'] = false;

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
    public function __construct(private array $params = []) {}
    public function get_param(string $name): mixed { return $this->params[$name] ?? null; }
}

final class Kodety_Sharing {
    private static ?self $instance = null;
    public static function instance(): self { return self::$instance ??= new self(); }
    public function context(?WP_REST_Request $request = null): ?array {
        return is_array($GLOBALS['kodety_surface_share_context'])
            ? $GLOBALS['kodety_surface_share_context']
            : null;
    }
    public function can_edit(?WP_REST_Request $request = null): bool {
        return (bool) $GLOBALS['kodety_surface_share_can_edit'];
    }
    public function project_id(): string { return 'single'; }
}

function get_option(string $name, mixed $default = false): mixed {
    if ($name === 'kodety_workspace_revision' && $GLOBALS['kodety_surface_revision_sequence']) {
        return array_shift($GLOBALS['kodety_surface_revision_sequence']);
    }
    return array_key_exists($name, $GLOBALS['kodety_surface_options'])
        ? $GLOBALS['kodety_surface_options'][$name]
        : $default;
}
function current_user_can(string $capability): bool {
    return $capability === 'kodety_edit'
        ? (bool) $GLOBALS['kodety_surface_can_edit']
        : true;
}
function sanitize_key(string $value): string {
    return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)) ?: '';
}
function wp_json_encode(mixed $value, int $flags = 0, int $depth = 512): string|false {
    return json_encode($value, $flags, $depth);
}
function wp_mkdir_p(string $directory): bool {
    return is_dir($directory) || mkdir($directory, 0777, true);
}
function wp_check_filetype(string $path): array {
    $extension = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
    return ['type' => match ($extension) {
        'html', 'htm' => 'text/html',
        'json' => 'application/json',
        'png' => 'image/png',
        'woff2' => 'font/woff2',
        default => '',
    }];
}
function get_bloginfo(string $field = ''): string { return 'Surface fixture'; }

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_surface_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_surface_remove_tree(string $directory): void {
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    }
    rmdir($directory);
}

$temporary = sys_get_temp_dir() . '/kodety-project-surface-' . bin2hex(random_bytes(6));
$workspace = $temporary . '/private/workspace';
$project_root = $workspace . '/meu-site';
mkdir($project_root . '/.incode/animations', 0777, true);
mkdir($project_root . '/.incode/experiments/home/variant-b/project', 0777, true);
mkdir($project_root . '/.kodety-experiments/home/variant-b', 0777, true);
mkdir($project_root . '/kodety-build', 0777, true);
mkdir($project_root . '/assets', 0777, true);
file_put_contents($project_root . '/index.html', '<!doctype html><main id="hero">Home</main>');
file_put_contents($project_root . '/about.html', '<!doctype html><main>About</main>');
file_put_contents(
    $project_root . '/styles.css',
    '@font-face{font-family:"Fixture Brand";src:url("./assets/social.woff2") format("woff2")}body{color:red}'
);
file_put_contents($project_root . '/runtime.js', 'window.fixture=true');
file_put_contents($project_root . '/assets/hero.png', "\x89PNG\r\nfixture");
file_put_contents($project_root . '/assets/social.woff2', 'font-fixture');
file_put_contents($project_root . '/.incode/animations/index.html.json', '{"version":1}');
file_put_contents($project_root . '/.incode/framer-import.json', '{"version":1,"runtime":false}');
file_put_contents($project_root . '/.incode/experiments/home/variant-b/project/index.html', '<main>Private variant</main>');
file_put_contents($project_root . '/.incode/experiments/home/variant-b/project/styles.css', 'body{color:purple}');
file_put_contents($project_root . '/.kodety-experiments/home/variant-b/index.html', '<main>Generated variant</main>');
file_put_contents($project_root . '/kodety-build/index.html', '<main>Generated coded build</main>');
file_put_contents($project_root . '/.incode/project.json', json_encode([
    'version' => 1,
    'name' => 'Surface fixture',
    'rootPath' => '',
    'mainHtmlPath' => 'index.html',
    'homeHtmlPath' => 'index.html',
    'cms' => ['privateToken' => 'never-expose'],
    'analytics' => [
        'experiments' => [['id' => 'hero-copy']],
        'utmCenter' => [
            'version' => 1,
            'profiles' => [['id' => 'checkout-principal', 'name' => 'Checkout principal']],
        ],
        'privateIntegration' => ['secret' => 'never-expose'],
    ],
]));
$GLOBALS['kodety_surface_options'] = [
    'kodety_workspace_revision' => 14,
    'kodety_workspace_css_digest' => str_repeat('a', 64),
    'kodety_project_name' => 'Surface fixture',
    'kodety_original_name' => 'surface-fixture.zip',
    'kodety_workspace_project_id' => 'surface-fixture',
];

$reflection = new ReflectionClass(Kodety_Plugin::class);
$plugin = $reflection->newInstanceWithoutConstructor();
$storage = $reflection->getProperty('storage_dir');
$storage->setValue($plugin, $temporary);
$write_manifest = $reflection->getMethod('write_preview_file_manifest');
$write_manifest->invoke($plugin, $project_root);
$surface_manifest = json_decode((string) file_get_contents($project_root . '/.incode/preview-files.json'), true);
kodety_surface_assert(($surface_manifest['version'] ?? null) === 3, 'índice server-side deve usar schema v3');
kodety_surface_assert(($surface_manifest['generatedBy'] ?? '') === 'kodety-server', 'índice deve ser marcado como canônico');
kodety_surface_assert(in_array('index.html', $surface_manifest['surfacePaths'] ?? [], true), 'índice deve conter páginas leves');
kodety_surface_assert(in_array('styles.css', $surface_manifest['surfacePaths'] ?? [], true), 'índice deve conter CSS necessário ao catálogo de fontes');
kodety_surface_assert(in_array('assets/social.woff2', $surface_manifest['surfacePaths'] ?? [], true), 'índice deve conter o path lazy da fonte');
kodety_surface_assert(
    !in_array('.incode/experiments/home/variant-b/project/index.html', $surface_manifest['surfacePaths'] ?? [], true)
        && !in_array('.incode/experiments/home/variant-b/project/styles.css', $surface_manifest['surfacePaths'] ?? [], true)
        && !in_array('.kodety-experiments/home/variant-b/index.html', $surface_manifest['surfacePaths'] ?? [], true)
        && !in_array('kodety-build/index.html', $surface_manifest['surfacePaths'] ?? [], true),
    'índice leve não deve conter variantes privadas ou builds gerados'
);
// Simulate a workspace created before the canonical server-side index. The
// first real surface payload must backfill it; revision-only revalidation must
// remain a zero-traversal fast path and must not create derived state.
unlink($project_root . '/.incode/preview-files.json');

try {
    $unchanged = $plugin->project_surface(new WP_REST_Request([
        'surface' => 'settings',
        'revision' => '14',
    ]));
    kodety_surface_assert($unchanged instanceof WP_REST_Response, 'revalidação deve retornar resposta REST');
    kodety_surface_assert(($unchanged->get_data()['notModified'] ?? false) === true, 'revisão idêntica deve evitar nova varredura');
    kodety_surface_assert(!isset($unchanged->get_data()['project']), 'revalidação idêntica não deve reenviar os textos');
    kodety_surface_assert(
        !is_file($project_root . '/.incode/preview-files.json'),
        'revalidação idêntica não deve percorrer nem materializar o índice legado'
    );

    // Exercise the narrower surface first. Its fallback still has to write the
    // canonical superset used by Settings, otherwise opening Analytics before
    // Settings would permanently omit CSS/font descriptors from the cache.
    $legacy_analytics = $plugin->project_surface(new WP_REST_Request(['surface' => 'analytics']));
    kodety_surface_assert($legacy_analytics instanceof WP_REST_Response, 'primeiro acesso legado de Analytics deve retornar snapshot REST');
    $legacy_analytics_files = $legacy_analytics->get_data()['project']['files'] ?? [];
    kodety_surface_assert(
        isset($legacy_analytics_files['index.html'], $legacy_analytics_files['.incode/project.json'])
            && !isset($legacy_analytics_files['styles.css'], $legacy_analytics_files['assets/social.woff2']),
        'fallback de Analytics deve manter seu payload mínimo enquanto cria o índice canônico'
    );

    $settings = $plugin->project_surface(new WP_REST_Request(['surface' => 'settings']));
    kodety_surface_assert($settings instanceof WP_REST_Response, 'Settings deve retornar snapshot REST');
    $settings_data = $settings->get_data();
    $settings_files = $settings_data['project']['files'] ?? [];
    kodety_surface_assert(($settings_data['workspaceRevision'] ?? null) === 14, 'snapshot deve confirmar revisão CAS');
    kodety_surface_assert(isset($settings_files['index.html'], $settings_files['about.html']), 'Settings deve incluir páginas HTML');
    kodety_surface_assert(isset($settings_files['.incode/project.json']), 'Settings deve incluir metadata canônica');
    kodety_surface_assert(isset($settings_files['.incode/animations/index.html.json']), 'Settings deve preservar companions de página');
    kodety_surface_assert(isset($settings_files['.incode/framer-import.json']), 'Settings deve preservar o modo de importação');
    kodety_surface_assert(isset($settings_files['styles.css']['text']), 'Settings deve incluir CSS textual para descobrir fontes do projeto');
    kodety_surface_assert(!isset($settings_files['runtime.js']), 'Settings não deve baixar JavaScript do projeto no bootstrap');
    kodety_surface_assert(
        ($settings_files['assets/social.woff2']['lazyAsset'] ?? false) === true
            && !isset($settings_files['assets/social.woff2']['text'])
            && !isset($settings_files['assets/social.woff2']['data']),
        'Settings deve enviar somente o descritor da fonte, nunca seus bytes no bootstrap'
    );
    kodety_surface_assert(!isset($settings_files['assets/hero.png']), 'Settings não deve baixar assets binários no bootstrap');
    kodety_surface_assert(
        !isset(
            $settings_files['.incode/experiments/home/variant-b/project/index.html'],
            $settings_files['.incode/experiments/home/variant-b/project/styles.css'],
            $settings_files['.kodety-experiments/home/variant-b/index.html'],
            $settings_files['kodety-build/index.html']
        ),
        'Settings não deve transferir variantes privadas nem saídas geradas'
    );

    $backfilled_manifest = json_decode(
        (string) file_get_contents($project_root . '/.incode/preview-files.json'),
        true
    );
    kodety_surface_assert(
        ($backfilled_manifest['version'] ?? null) === 3
            && ($backfilled_manifest['generatedBy'] ?? '') === 'kodety-server',
        'primeiro acesso legado deve persistir o índice canônico v3'
    );
    kodety_surface_assert(
        in_array('styles.css', $backfilled_manifest['surfacePaths'] ?? [], true)
            && in_array('assets/social.woff2', $backfilled_manifest['surfacePaths'] ?? [], true),
        'backfill deve preservar paths canônicos usados por Settings'
    );
    kodety_surface_assert(
        !in_array('.incode/experiments/home/variant-b/project/index.html', $backfilled_manifest['surfacePaths'] ?? [], true)
            && !in_array('.kodety-experiments/home/variant-b/index.html', $backfilled_manifest['surfacePaths'] ?? [], true)
            && !in_array('kodety-build/index.html', $backfilled_manifest['surfacePaths'] ?? [], true),
        'backfill não deve expor variantes privadas nem builds gerados'
    );

    // This direct fixture mutation deliberately bypasses every real write
    // path, which regenerates the manifest and revision. If a second request
    // recursively scanned the workspace, it would incorrectly discover this
    // file; an indexed request must not.
    $late_unindexed_path = $project_root . '/late-unindexed.html';
    file_put_contents($late_unindexed_path, '<main>Should stay outside the indexed snapshot</main>');
    $indexed_settings = $plugin->project_surface(new WP_REST_Request(['surface' => 'settings']));
    kodety_surface_assert($indexed_settings instanceof WP_REST_Response, 'segundo acesso deve usar o índice recém-criado');
    kodety_surface_assert(
        !isset($indexed_settings->get_data()['project']['files']['late-unindexed.html']),
        'segundo acesso não deve repetir a varredura recursiva após o backfill'
    );
    unlink($late_unindexed_path);

    $analytics = $plugin->project_surface(new WP_REST_Request(['surface' => 'analytics']));
    kodety_surface_assert($analytics instanceof WP_REST_Response, 'Analytics deve retornar snapshot REST');
    $analytics_files = $analytics->get_data()['project']['files'] ?? [];
    kodety_surface_assert(isset($analytics_files['index.html'], $analytics_files['.incode/project.json']), 'Analytics deve incluir HTML e metadata para targets');
    kodety_surface_assert(!isset($analytics_files['.incode/animations/index.html.json']), 'Analytics não deve carregar companions de edição');
    kodety_surface_assert(!isset($analytics_files['styles.css'], $analytics_files['assets/social.woff2']), 'Analytics não deve carregar catálogo de fontes de Settings');

    mkdir($project_root . '/.incode/membership', 0777, true);
    file_put_contents($project_root . '/.incode/membership/runtime.json', '{"sealed":true}');
    $membership_settings = $plugin->project_surface(new WP_REST_Request(['surface' => 'settings']));
    kodety_surface_assert(
        $membership_settings instanceof WP_REST_Response
            && ($membership_settings->get_data()['requiresFullProject'] ?? false) === true
            && !isset($membership_settings->get_data()['project']),
        'Settings deve exigir hidratação completa antes de editar uma Área de Membros selada'
    );
    unlink($project_root . '/.incode/membership/runtime.json');
    rmdir($project_root . '/.incode/membership');
    file_put_contents($project_root . '/.incode/coded-build.json', '{"version":1}');
    $coded_settings = $plugin->project_surface(new WP_REST_Request(['surface' => 'settings']));
    kodety_surface_assert(
        $coded_settings instanceof WP_REST_Response
            && ($coded_settings->get_data()['requiresFullProject'] ?? false) === true,
        'Settings deve exigir o projeto completo para restaurar fontes de um coded build legado'
    );
    unlink($project_root . '/.incode/coded-build.json');

    $GLOBALS['kodety_surface_can_edit'] = false;
    $viewer = $plugin->project_surface(new WP_REST_Request(['surface' => 'analytics']));
    kodety_surface_assert($viewer instanceof WP_REST_Response, 'viewer de Analytics deve receber paths sem fonte privada');
    $viewer_files = $viewer->get_data()['project']['files'] ?? [];
    kodety_surface_assert(($viewer_files['index.html']['text'] ?? null) === '', 'viewer sem edição não deve receber HTML privado');
    $viewer_metadata = json_decode((string) ($viewer_files['.incode/project.json']['text'] ?? ''), true);
    kodety_surface_assert(
        ($viewer_metadata['analytics']['utmCenter']['profiles'][0]['id'] ?? '') === 'checkout-principal'
            && ($viewer_metadata['analytics']['experiments'][0]['id'] ?? '') === 'hero-copy',
        'viewer de Analytics deve receber somente os modelos UTM e experimentos necessários'
    );
    kodety_surface_assert(
        !isset($viewer_metadata['cms'], $viewer_metadata['name'], $viewer_metadata['analytics']['privateIntegration']),
        'metadata sanitizada de Analytics não deve expor o restante do project.json'
    );

    // Share views receive CAP_EDIT_WORKSPACE for safe GET routes. The surface
    // must still honor the share permission itself before exposing source.
    $GLOBALS['kodety_surface_can_edit'] = true;
    $GLOBALS['kodety_surface_share_context'] = ['permission' => 'view'];
    $GLOBALS['kodety_surface_share_can_edit'] = false;
    $shared_viewer = $plugin->project_surface(new WP_REST_Request(['surface' => 'analytics']));
    kodety_surface_assert($shared_viewer instanceof WP_REST_Response, 'share view deve receber o surface sanitizado');
    $shared_viewer_files = $shared_viewer->get_data()['project']['files'] ?? [];
    $shared_viewer_metadata = json_decode(
        (string) ($shared_viewer_files['.incode/project.json']['text'] ?? ''),
        true
    );
    kodety_surface_assert(
        ($shared_viewer_files['index.html']['text'] ?? null) === ''
            && !isset($shared_viewer_metadata['cms'], $shared_viewer_metadata['analytics']['privateIntegration']),
        'share view de Analytics nunca deve herdar acesso ao source completo do grant de transporte'
    );

    $GLOBALS['kodety_surface_share_context'] = ['permission' => 'edit'];
    $GLOBALS['kodety_surface_share_can_edit'] = true;
    $shared_editor = $plugin->project_surface(new WP_REST_Request(['surface' => 'analytics']));
    kodety_surface_assert($shared_editor instanceof WP_REST_Response, 'share edit deve continuar recebendo o surface autoritativo');
    $shared_editor_files = $shared_editor->get_data()['project']['files'] ?? [];
    $shared_editor_metadata = json_decode(
        (string) ($shared_editor_files['.incode/project.json']['text'] ?? ''),
        true
    );
    kodety_surface_assert(
        str_contains((string) ($shared_editor_files['index.html']['text'] ?? ''), 'hero')
            && ($shared_editor_metadata['cms']['privateToken'] ?? '') === 'never-expose',
        'share edit autenticado deve manter acesso ao source necessário para autoria'
    );
    $GLOBALS['kodety_surface_share_context'] = null;
    $GLOBALS['kodety_surface_share_can_edit'] = false;
    $GLOBALS['kodety_surface_can_edit'] = true;

    $asset = $plugin->project_surface_asset(new WP_REST_Request([
        'path' => 'assets/social.woff2',
        'revision' => '14',
    ]));
    kodety_surface_assert($asset instanceof WP_REST_Response, 'asset lazy deve retornar resposta REST');
    kodety_surface_assert(
        base64_decode((string) ($asset->get_data()['data'] ?? ''), true) === 'font-fixture',
        'asset lazy deve preservar bytes exatos'
    );
    kodety_surface_assert(
        ($asset->get_data()['workspaceRevision'] ?? null) === 14,
        'asset lazy deve confirmar a mesma revisão solicitada'
    );
    $stale_asset = $plugin->project_surface_asset(new WP_REST_Request([
        'path' => 'assets/social.woff2',
        'revision' => '13',
    ]));
    kodety_surface_assert(
        $stale_asset instanceof WP_Error && $stale_asset->get_error_code() === 'kodety_project_surface_asset_conflict',
        'asset lazy deve recusar uma revisão obsoleta antes da leitura'
    );
    $GLOBALS['kodety_surface_revision_sequence'] = [14, 15];
    $swapped_asset = $plugin->project_surface_asset(new WP_REST_Request([
        'path' => 'assets/social.woff2',
        'revision' => '14',
    ]));
    kodety_surface_assert(
        $swapped_asset instanceof WP_Error && $swapped_asset->get_error_code() === 'kodety_project_surface_asset_conflict',
        'asset lazy deve recusar troca de revisão durante a leitura'
    );
    $oversized_path = $project_root . '/assets/oversized.bin';
    $oversized = fopen($oversized_path, 'wb');
    ftruncate($oversized, 20 * 1024 * 1024 + 1);
    fclose($oversized);
    $oversized_asset = $plugin->project_surface_asset(new WP_REST_Request([
        'path' => 'assets/oversized.bin',
        'revision' => '14',
    ]));
    kodety_surface_assert(
        $oversized_asset instanceof WP_Error && $oversized_asset->get_error_code() === 'kodety_project_surface_asset_too_large',
        'asset lazy deve rejeitar mais de 20 MB antes de alocar base64/JSON'
    );
    $escape = $plugin->project_surface_asset(new WP_REST_Request([
        'path' => '../wp-config.php',
        'revision' => '14',
    ]));
    kodety_surface_assert($escape instanceof WP_Error && $escape->get_error_code() === 'kodety_project_surface_asset_invalid', 'asset lazy deve bloquear traversal');
} finally {
    kodety_surface_remove_tree($temporary);
}

fwrite(STDOUT, "Project surface runtime: bootstrap text-only, privacy, asset lazy e CAS aprovados.\n");
