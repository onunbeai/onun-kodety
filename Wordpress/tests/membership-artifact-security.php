<?php

/**
 * Isolated at-rest security contract for protected membership snapshots.
 *
 * Run with: php Wordpress/tests/membership-artifact-security.php
 */

define('ABSPATH', __DIR__ . '/');
define('MB_IN_BYTES', 1024 * 1024);

function wp_salt(string $scheme = 'auth'): string {
    return 'kodety-artifact-test-salt-' . $scheme;
}

function sanitize_key(string $value): string {
    return preg_replace('/[^a-z0-9_\-]/', '', strtolower($value)) ?: '';
}

function wp_generate_password(int $length = 12, bool $special = true, bool $extra = false): string {
    return substr(bin2hex(random_bytes(max(8, $length))), 0, $length);
}

function wp_json_encode(mixed $value, int $flags = 0): string|false {
    return json_encode($value, $flags);
}

function trailingslashit(string $value): string {
    return rtrim($value, '/\\') . '/';
}

function get_temp_dir(): string { return sys_get_temp_dir() . '/'; }

function wp_mkdir_p(string $directory): bool {
    return is_dir($directory) || mkdir($directory, 0700, true);
}

$GLOBALS['kodety_artifact_managed_attachments'] = [];

function get_posts(array $arguments = []): array {
    if (($arguments['meta_key'] ?? '') !== '_kodety_managed') return [];
    return array_map(
        'intval',
        array_keys($GLOBALS['kodety_artifact_managed_attachments'])
    );
}

function get_post_meta(int $post_id, string $key, bool $single = false): mixed {
    return $GLOBALS['kodety_artifact_managed_attachments'][$post_id][$key]
        ?? ($single ? '' : []);
}

function get_attached_file(int $post_id): string|false {
    return $GLOBALS['kodety_artifact_managed_attachments'][$post_id]['file']
        ?? false;
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';

function kodety_artifact_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_artifact_private(object $target, string $method, mixed ...$arguments): mixed {
    $reflection = new ReflectionMethod($target, $method);
    $reflection->setAccessible(true);
    return $reflection->invoke($target, ...$arguments);
}

function kodety_artifact_remove_tree(string $path): void {
    if (!is_dir($path)) {
        if (is_file($path)) unlink($path);
        return;
    }
    foreach (new DirectoryIterator($path) as $item) {
        if ($item->isDot()) continue;
        if ($item->isDir() && !$item->isLink()) {
            kodety_artifact_remove_tree($item->getPathname());
        } else {
            unlink($item->getPathname());
        }
    }
    rmdir($path);
}

final class Kodety_Members {
    public static int $memberId = 0;

    public static function current_member_id(): int {
        return self::$memberId;
    }

    public static function evaluate_access(
        array $rule,
        ?int $user_id,
        string $project_id
    ): array {
        return [
            'allowed' => $project_id === 'asset-test' && $user_id === 77,
            'valid' => true,
        ];
    }
}

$root = sys_get_temp_dir() . '/kodety-membership-artifact-' . bin2hex(random_bytes(6));
$artifact_directory = $root . '/.incode/membership';
mkdir($artifact_directory, 0700, true);
$canary = 'PRIVATE_MEMBER_CANARY_8dc764e1';
$editor_html = '<!doctype html><html><body>' . $canary . '</body></html>';
$runtime = [
    'version' => 1,
    'enabled' => true,
    'projectId' => 'artifact-test',
    'pages' => [
        'index.html' => [
            'path' => 'index.html',
            'editorHtml' => $editor_html,
            'gates' => [],
        ],
    ],
];
$artifact_path = $artifact_directory . '/runtime.json';
file_put_contents($root . '/index.html', '<main hidden></main>', LOCK_EX);
file_put_contents($artifact_path, json_encode($runtime, JSON_UNESCAPED_SLASHES), LOCK_EX);

$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
kodety_artifact_private($plugin, 'seal_membership_artifact', $root);
$sealed_bytes = (string) file_get_contents($artifact_path);
$sealed = json_decode($sealed_bytes, true);
kodety_artifact_assert(is_array($sealed) && ($sealed['sealed'] ?? false) === true, 'snapshot deve ser selado');
kodety_artifact_assert(!str_contains($sealed_bytes, $canary), 'snapshot selado não pode expor conteúdo privado em repouso');
kodety_artifact_assert(
    kodety_artifact_private($plugin, 'read_membership_artifact', $artifact_path) === $runtime,
    'snapshot deve ser autenticado e descriptografado integralmente'
);

$snapshot_archive = kodety_artifact_private($plugin, 'package_editable_workspace_as_zip', $root, 'kodety-snapshot-test-', null, false);
$snapshot_zip = new ZipArchive();
kodety_artifact_assert($snapshot_zip->open($snapshot_archive) === true, 'snapshot protegido deve gerar um ZIP válido para o administrador');
$downloaded_runtime = json_decode((string) $snapshot_zip->getFromName('.incode/membership/runtime.json'), true);
kodety_artifact_assert(
    ($downloaded_runtime['pages']['index.html']['editorHtml'] ?? '') === $editor_html
        && $snapshot_zip->getFromName('.incode/template.json') === false,
    'download autorizado deve abrir o conteúdo protegido sem injetar configurações atuais'
);
$snapshot_zip->close();
unlink($snapshot_archive);
kodety_artifact_assert(
    file_get_contents($artifact_path) === $sealed_bytes
        && !str_contains((string) file_get_contents($root . '/index.html'), $canary),
    'baixar um snapshot deve manter os arquivos originais selados e o HTML público sem conteúdo privado'
);

$corrupted = $sealed;
$ciphertext = base64_decode((string) $corrupted['ciphertext'], true);
$ciphertext[0] = chr(ord($ciphertext[0]) ^ 1);
$corrupted['ciphertext'] = base64_encode($ciphertext);
file_put_contents($artifact_path, json_encode($corrupted, JSON_UNESCAPED_SLASHES), LOCK_EX);
kodety_artifact_assert(
    kodety_artifact_private($plugin, 'read_membership_artifact', $artifact_path) === [],
    'snapshot adulterado deve falhar fechado'
);

file_put_contents($artifact_path, $sealed_bytes, LOCK_EX);
kodety_artifact_private($plugin, 'hydrate_membership_workspace', $root);
kodety_artifact_assert(
    (string) file_get_contents($root . '/index.html') === $editor_html,
    'workspace editável deve recuperar exatamente o HTML autoral'
);
kodety_artifact_assert(!is_file($artifact_path), 'workspace hidratado não deve reter o snapshot transportável');

kodety_artifact_remove_tree($root);

$asset_rule = [
    'requirement' => ['type' => 'authenticated'],
    'anonymous' => ['type' => 'branch', 'branch' => 'guest'],
    'denied' => ['type' => 'branch', 'branch' => 'upgrade'],
];
$asset_root = sys_get_temp_dir() . '/kodety-membership-asset-' . bin2hex(random_bytes(6));
$asset_directory = $asset_root . '/.incode/membership/assets';
mkdir($asset_directory, 0700, true);
$asset_id = 'asset-0123456789abcdef01234567';
$asset_storage = '.incode/membership/assets/' . $asset_id . '.bin';
$asset_path = $asset_root . '/' . $asset_storage;
$asset_canary = 'PRIVATE_DOWNLOAD_CANARY_' . bin2hex(random_bytes(8));
$asset_plaintext = str_repeat('course-payload-', 90000) . $asset_canary;
$asset_runtime = [
    'version' => 1,
    'enabled' => true,
    'projectId' => 'asset-test',
    'pages' => [
        'index.html' => [
            'path' => 'index.html',
            'editorHtml' => '<main>Asset test</main>',
            'gates' => [],
        ],
    ],
    'assets' => [
        $asset_id => [
            'id' => $asset_id,
            'sourcePath' => 'downloads/course.zip',
            'storagePath' => $asset_storage,
            'filename' => 'course.zip',
            'mimeType' => 'application/zip',
            'size' => strlen($asset_plaintext),
            'sha256' => hash('sha256', $asset_plaintext),
            'contexts' => [['allOf' => [$asset_rule]]],
        ],
    ],
];
$asset_artifact = $asset_root . '/.incode/membership/runtime.json';
file_put_contents($asset_path, $asset_plaintext, LOCK_EX);
file_put_contents($asset_artifact, json_encode($asset_runtime, JSON_UNESCAPED_SLASHES), LOCK_EX);

kodety_artifact_private($plugin, 'seal_membership_assets', $asset_root);
$sealed_asset_runtime = json_decode((string) file_get_contents($asset_artifact), true);
$sealed_asset_bytes = (string) file_get_contents($asset_path);
kodety_artifact_assert(
    ($sealed_asset_runtime['assets'][$asset_id]['encryption']['algorithm'] ?? '') === 'aes-256-gcm-chunked-v1',
    'manifesto deve registrar criptografia autenticada por chunks'
);
kodety_artifact_assert(
    ($sealed_asset_runtime['assets'][$asset_id]['encryption']['chunkSize'] ?? 0) === 1024 * 1024,
    'manifesto deve registrar o tamanho canônico do chunk'
);
kodety_artifact_assert(str_starts_with($sealed_asset_bytes, 'KDAYA01!'), 'blob deve usar envelope protegido');
kodety_artifact_assert(!str_contains($sealed_asset_bytes, $asset_canary), 'blob selado não pode conter o canário plaintext');
kodety_artifact_assert(
    kodety_artifact_private($plugin, 'project_membership_runtime', $asset_root) === $sealed_asset_runtime,
    'WordPress deve aceitar o manifesto de download selado'
);

$historical_public_copy = tempnam(
    sys_get_temp_dir(),
    'kodety-public-course-'
);
kodety_artifact_assert(
    is_string($historical_public_copy),
    'teste deve conseguir preparar uma cópia pública histórica'
);
file_put_contents($historical_public_copy, $asset_plaintext, LOCK_EX);
$GLOBALS['kodety_artifact_managed_attachments'][41] = [
    '_kodety_asset_path' => 'downloads/course.zip',
    '_kodety_asset_paths' => ['downloads/course.zip'],
    'file' => $historical_public_copy,
];
$historical_path_blocked = false;
try {
    kodety_artifact_private(
        $plugin,
        'assert_no_public_managed_membership_asset_copies',
        $asset_root
    );
} catch (Throwable $error) {
    $historical_path_blocked = str_contains($error->getMessage(), 'anexo 41');
}
kodety_artifact_assert(
    $historical_path_blocked,
    'publicação deve bloquear uma cópia histórica com o mesmo caminho de mídia'
);

$GLOBALS['kodety_artifact_managed_attachments'][41]['_kodety_asset_path'] = 'legacy/renamed-course.zip';
$GLOBALS['kodety_artifact_managed_attachments'][41]['_kodety_asset_paths'] = ['legacy/renamed-course.zip'];
$historical_hash_blocked = false;
try {
    kodety_artifact_private(
        $plugin,
        'assert_no_public_managed_membership_asset_copies',
        $asset_root
    );
} catch (Throwable $error) {
    $historical_hash_blocked = str_contains($error->getMessage(), 'anexo 41');
}
kodety_artifact_assert(
    $historical_hash_blocked,
    'renomear uma cópia pública idêntica não pode contornar a proteção'
);
unlink($historical_public_copy);
$GLOBALS['kodety_artifact_managed_attachments'] = [];
kodety_artifact_private(
    $plugin,
    'assert_no_public_managed_membership_asset_copies',
    $asset_root
);

$opened_asset = $asset_root . '/opened-course.zip';
kodety_artifact_private(
    $plugin,
    'open_membership_asset',
    $asset_path,
    $opened_asset,
    $sealed_asset_runtime['assets'][$asset_id],
    'asset-test'
);
kodety_artifact_assert(
    (string) file_get_contents($opened_asset) === $asset_plaintext,
    'download autenticado deve reconstruir exatamente o arquivo original'
);
kodety_artifact_assert(
    (fileperms($opened_asset) & 0777) === 0600,
    'arquivo reconstruído deve permanecer privado no filesystem'
);
unlink($opened_asset);

$tampered_asset_bytes = $sealed_asset_bytes;
$tampered_offset = strlen($tampered_asset_bytes) - 1;
$tampered_asset_bytes[$tampered_offset] = chr(ord($tampered_asset_bytes[$tampered_offset]) ^ 1);
file_put_contents($asset_path, $tampered_asset_bytes, LOCK_EX);
$tampered_destination = $asset_root . '/tampered-course.zip';
$tamper_failed_closed = false;
try {
    kodety_artifact_private(
        $plugin,
        'open_membership_asset',
        $asset_path,
        $tampered_destination,
        $sealed_asset_runtime['assets'][$asset_id],
        'asset-test'
    );
} catch (Throwable) {
    $tamper_failed_closed = true;
}
kodety_artifact_assert($tamper_failed_closed, 'blob adulterado deve falhar fechado');
kodety_artifact_assert(!is_file($tampered_destination), 'adulteração não pode deixar um download parcial');
kodety_artifact_assert(
    (glob($tampered_destination . '.tmp-*') ?: []) === [],
    'adulteração não pode deixar plaintext temporário'
);
file_put_contents($asset_path, $sealed_asset_bytes, LOCK_EX);

kodety_artifact_private($plugin, 'seal_membership_artifact', $asset_root);
$sealed_asset_artifact = (string) file_get_contents($asset_artifact);
kodety_artifact_assert(
    !str_contains($sealed_asset_artifact, $asset_canary),
    'snapshot selado não pode expor metadados ou conteúdo do download'
);
kodety_artifact_assert(
    kodety_artifact_private($plugin, 'read_membership_artifact', $asset_artifact) === $sealed_asset_runtime,
    'snapshot selado deve preservar integralmente o manifesto do download'
);
kodety_artifact_remove_tree($asset_root);

$magic_root = sys_get_temp_dir() . '/kodety-membership-magic-' . bin2hex(random_bytes(6));
$magic_directory = $magic_root . '/.incode/membership/assets';
mkdir($magic_directory, 0700, true);
$magic_id = 'asset-fedcba9876543210fedcba98';
$magic_storage = '.incode/membership/assets/' . $magic_id . '.bin';
$magic_path = $magic_root . '/' . $magic_storage;
$magic_canary = 'MAGIC_PREFIX_PLAINTEXT_CANARY';
$magic_plaintext = 'KDAYA01!' . $magic_canary . str_repeat('-payload', 128);
$magic_runtime = [
    'version' => 1,
    'enabled' => true,
    'projectId' => 'magic-test',
    'pages' => [
        'index.html' => [
            'path' => 'index.html',
            'editorHtml' => '<main>Magic test</main>',
            'gates' => [],
        ],
    ],
    'assets' => [
        $magic_id => [
            'id' => $magic_id,
            'sourcePath' => 'downloads/magic.bin',
            'storagePath' => $magic_storage,
            'filename' => 'magic.bin',
            'mimeType' => 'application/octet-stream',
            'size' => strlen($magic_plaintext),
            'sha256' => hash('sha256', $magic_plaintext),
            'contexts' => [['allOf' => [$asset_rule]]],
        ],
    ],
];
$magic_artifact = $magic_root . '/.incode/membership/runtime.json';
file_put_contents($magic_path, $magic_plaintext, LOCK_EX);
file_put_contents($magic_artifact, json_encode($magic_runtime, JSON_UNESCAPED_SLASHES), LOCK_EX);
kodety_artifact_private($plugin, 'seal_membership_assets', $magic_root);
$magic_sealed_runtime = json_decode((string) file_get_contents($magic_artifact), true);
$magic_sealed_bytes = (string) file_get_contents($magic_path);
kodety_artifact_assert($magic_sealed_bytes !== $magic_plaintext, 'prefixo mágico plaintext não pode simular envelope');
kodety_artifact_assert(!str_contains($magic_sealed_bytes, $magic_canary), 'prefixo mágico não pode escapar da criptografia');
$magic_opened = $magic_root . '/opened-magic.bin';
kodety_artifact_private(
    $plugin,
    'open_membership_asset',
    $magic_path,
    $magic_opened,
    $magic_sealed_runtime['assets'][$magic_id],
    'magic-test'
);
kodety_artifact_assert(
    (string) file_get_contents($magic_opened) === $magic_plaintext,
    'arquivo com prefixo mágico deve continuar recuperável após criptografia real'
);
kodety_artifact_remove_tree($magic_root);

$theme_root = sys_get_temp_dir() . '/kodety-membership-shards-' . bin2hex(random_bytes(6));
mkdir($theme_root, 0700, true);
$base_page_canary = 'SHARDED_BASE_PAGE_CANARY';
$variant_page_canary = 'SHARDED_AB_PAGE_CANARY';
$theme_runtime = [
    'version' => 1,
    'enabled' => true,
    'projectId' => 'shard-test',
    'pages' => [
        'index.html' => [
            'path' => 'index.html',
            'editorHtml' => '<main>' . $base_page_canary . '</main>',
            'protectedHtml' => '<main>' . $base_page_canary . '</main>',
            'pageRule' => $asset_rule,
            'gates' => [],
        ],
        '.kodety-experiments/course/variant-a/index.html' => [
            'path' => '.incode/experiments/course/variant-a/project/index.html',
            'runtimePath' => '.kodety-experiments/course/variant-a/index.html',
            'authoredPath' => 'index.html',
            'editorHtml' => '<main>' . $variant_page_canary . '</main>',
            'protectedHtml' => '<main>' . $variant_page_canary . '</main>',
            'pageRule' => $asset_rule,
            'gates' => [],
        ],
    ],
    'assets' => [],
];
kodety_artifact_private($plugin, 'write_membership_theme_payload', $theme_root, $theme_runtime);
$theme_index_path = $theme_root . '/membership-content.php';
$theme_index_source = (string) file_get_contents($theme_index_path);
$theme_index = include $theme_index_path;
kodety_artifact_assert(is_array($theme_index), 'índice sharded deve ser um payload PHP válido');
kodety_artifact_assert(!isset($theme_index['pages']), 'índice sharded não deve carregar páginas privadas');
kodety_artifact_assert(
    isset(
        $theme_index['pageFiles']['index.html'],
        $theme_index['pageFiles']['.kodety-experiments/course/variant-a/index.html']
    ),
    'índice sharded deve mapear página base e variante A/B'
);
kodety_artifact_assert(
    !str_contains($theme_index_source, $base_page_canary)
        && !str_contains($theme_index_source, $variant_page_canary),
    'índice comum não pode agregar HTML privado das páginas'
);
$base_page = include $theme_root . '/membership-pages/' . $theme_index['pageFiles']['index.html'];
$variant_page = include $theme_root . '/membership-pages/'
    . $theme_index['pageFiles']['.kodety-experiments/course/variant-a/index.html'];
kodety_artifact_assert(
    !isset($base_page['editorHtml'], $variant_page['editorHtml']),
    'shards publicados não devem duplicar o HTML exclusivo do editor'
);
kodety_artifact_assert(
    str_contains((string) ($base_page['protectedHtml'] ?? ''), $base_page_canary),
    'shard base deve reter somente a página base'
);
kodety_artifact_assert(
    !str_contains((string) ($base_page['protectedHtml'] ?? ''), $variant_page_canary),
    'shard base não pode agregar a variante'
);
kodety_artifact_assert(
    str_contains((string) ($variant_page['protectedHtml'] ?? ''), $variant_page_canary),
    'shard A/B deve reter a variante correta'
);
kodety_artifact_remove_tree($theme_root);

$isolated_asset = [
    'contexts' => [['allOf' => [[
        'version' => 1,
        'requirement' => ['type' => 'authenticated'],
    ]]]],
];
Kodety_Members::$memberId = 0;
kodety_artifact_assert(
    kodety_artifact_private(
        $plugin,
        'membership_asset_is_authorized',
        $isolated_asset,
        'asset-test'
    ) === false,
    'sessão nativa do WordPress nunca deve autorizar download protegido'
);
Kodety_Members::$memberId = 77;
kodety_artifact_assert(
    kodety_artifact_private(
        $plugin,
        'membership_asset_is_authorized',
        $isolated_asset,
        'asset-test'
    ) === true,
    'download protegido deve usar exclusivamente a identidade da sessão Kodety'
);

fwrite(
    STDOUT,
    "Membership artifact: snapshots, protected assets, tamper resistance and sharded payloads verified.\n"
);
