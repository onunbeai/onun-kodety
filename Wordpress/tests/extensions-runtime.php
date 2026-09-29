<?php

/** Isolated runtime regression test for the Kodety extension registry/installer. */
define('ABSPATH', __DIR__);
define('KODETY_VERSION', '1.34.2');

$kodety_extensions_root = sys_get_temp_dir() . '/kodety-extensions-test-' . bin2hex(random_bytes(6));
$kodety_extensions_uploads = $kodety_extensions_root . '/uploads';
define('WP_CONTENT_DIR', $kodety_extensions_root . '/wp-content');

if (!mkdir($kodety_extensions_uploads . '/kodety', 0777, true) && !is_dir($kodety_extensions_uploads . '/kodety')) {
    fwrite(STDERR, "FAIL: não foi possível preparar o diretório temporário.\n");
    exit(1);
}
file_put_contents($kodety_extensions_uploads . '/kodety/project-marker.json', '{"project":"untouched"}');

$kodety_extensions_options = [];
$kodety_extensions_actions = [];
$kodety_extensions_filters = [];
$kodety_extensions_assertions = 0;

class WP_Error {
    public function __construct(
        private string $code,
        private string $message,
    ) {}

    public function get_error_code(): string {
        return $this->code;
    }

    public function get_error_message(): string {
        return $this->message;
    }
}

function is_wp_error(mixed $value): bool {
    return $value instanceof WP_Error;
}

function add_action(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): bool {
    global $kodety_extensions_actions;
    $kodety_extensions_actions[$hook][] = compact('callback', 'priority', 'accepted_args');
    return true;
}

function do_action(string $hook, mixed ...$arguments): void {
    global $kodety_extensions_actions;
    $callbacks = $kodety_extensions_actions[$hook] ?? [];
    usort($callbacks, static fn(array $left, array $right): int => $left['priority'] <=> $right['priority']);
    foreach ($callbacks as $registered) {
        ($registered['callback'])(...array_slice($arguments, 0, (int) $registered['accepted_args']));
    }
}

function add_filter(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): bool {
    global $kodety_extensions_filters;
    $kodety_extensions_filters[$hook][] = compact('callback', 'priority', 'accepted_args');
    return true;
}

function apply_filters(string $hook, mixed $value, mixed ...$arguments): mixed {
    global $kodety_extensions_filters;
    $callbacks = $kodety_extensions_filters[$hook] ?? [];
    usort($callbacks, static fn(array $left, array $right): int => $left['priority'] <=> $right['priority']);
    foreach ($callbacks as $registered) {
        $accepted = max(1, (int) $registered['accepted_args']);
        $value = ($registered['callback'])(...array_slice([$value, ...$arguments], 0, $accepted));
    }
    return $value;
}

function get_option(string $name, mixed $default = false): mixed {
    global $kodety_extensions_options;
    return array_key_exists($name, $kodety_extensions_options)
        ? $kodety_extensions_options[$name]
        : $default;
}

function add_option(string $name, mixed $value, string $deprecated = '', bool $autoload = true): bool {
    global $kodety_extensions_options;
    if (array_key_exists($name, $kodety_extensions_options)) return false;
    $kodety_extensions_options[$name] = $value;
    return true;
}

function update_option(string $name, mixed $value, bool $autoload = true): bool {
    global $kodety_extensions_options;
    if (array_key_exists($name, $kodety_extensions_options) && $kodety_extensions_options[$name] === $value) {
        return false;
    }
    $kodety_extensions_options[$name] = $value;
    return true;
}

function wp_upload_dir(): array {
    global $kodety_extensions_uploads;
    return [
        'basedir' => $kodety_extensions_uploads,
        'baseurl' => 'https://example.test/uploads',
        'error' => false,
    ];
}

function wp_mkdir_p(string $directory): bool {
    return is_dir($directory) || mkdir($directory, 0777, true);
}

function trailingslashit(string $value): string {
    return rtrim($value, '/\\') . '/';
}

function wp_normalize_path(string $path): string {
    return str_replace('\\', '/', $path);
}

function sanitize_text_field(string $value): string {
    return trim(preg_replace('/[\r\n\t ]+/', ' ', strip_tags($value)) ?: '');
}

function sanitize_key(string $value): string {
    return strtolower(preg_replace('/[^a-z0-9_-]/', '', $value) ?: '');
}

function esc_url_raw(string $url): string {
    return filter_var($url, FILTER_VALIDATE_URL) ? $url : '';
}

function kodety_extensions_remove_tree(string $directory): void {
    if (!is_dir($directory)) return;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isLink() || $item->isFile()) unlink($item->getPathname());
        elseif ($item->isDir()) rmdir($item->getPathname());
    }
    rmdir($directory);
}

register_shutdown_function(static function () use ($kodety_extensions_root): void {
    kodety_extensions_remove_tree($kodety_extensions_root);
});

function kodety_extensions_assert(bool $condition, string $message): void {
    global $kodety_extensions_assertions;
    $kodety_extensions_assertions += 1;
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kodety_extensions_assert_error(mixed $value, string $message, ?string $expected_code = null): WP_Error {
    kodety_extensions_assert($value instanceof WP_Error, $message);
    if ($expected_code !== null) {
        kodety_extensions_assert(
            $value->get_error_code() === $expected_code,
            $message . ' (código recebido: ' . $value->get_error_code() . ')'
        );
    }
    return $value;
}

/** @param array<string,string> $entries */
function kodety_extensions_make_zip(string $path, array $entries): void {
    $zip = new ZipArchive();
    $opened = $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    kodety_extensions_assert($opened === true, 'fixture ZIP deve ser criada');
    foreach ($entries as $name => $contents) {
        kodety_extensions_assert($zip->addFromString($name, $contents), 'entrada ' . $name . ' deve entrar na fixture ZIP');
    }
    kodety_extensions_assert($zip->close(), 'fixture ZIP deve ser finalizada');
}

/** @return array<string,mixed> */
function kodety_extensions_manifest(string $slug, string $name): array {
    return [
        'schemaVersion' => 1,
        'type' => 'extension',
        'slug' => $slug,
        'name' => $name,
        'description' => 'Extensão isolada para validar o runtime do instalador Kodety.',
        'version' => '1.0.0',
        'entry' => 'extension.php',
        'requires' => [
            'php' => '8.0',
            'kodety' => '1.0.0',
        ],
    ];
}

/** @param array<string,mixed> $manifest */
function kodety_extensions_package(
    string $path,
    array $manifest,
    string $entry = "<?php\n"
): void {
    kodety_extensions_make_zip($path, [
        'kodety-extension.json' => json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
        'extension.php' => $entry,
    ]);
}

if (!class_exists('ZipArchive')) {
    fwrite(STDERR, "FAIL: a extensão ZIP do PHP é necessária para o teste de extensões.\n");
    exit(1);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-extensions.php';

$extension_manager_source = (string) file_get_contents(
    dirname(__DIR__) . '/kodety/includes/class-kodety-extensions.php'
);
kodety_extensions_assert(
    !preg_match('/\btrue\s*\|/', $extension_manager_source)
        && !preg_match('/:\s*never\b/', $extension_manager_source),
    'o manager deve permanecer compatível com o PHP 8.0 declarado pelo plugin'
);

Kodety_Extensions::activate();
$manager = Kodety_Extensions::instance();
kodety_extensions_assert(
    Kodety_Extensions::max_archive_bytes() === 256 * 1024 * 1024,
    'instalador de extensões deve aceitar arquivos ZIP de até 256 MB'
);

$expected_bundled = [
    'kodety-cms',
    'kodety-analytics',
    'kodety-settings',
    'kodety-emails',
];
$catalog = $manager->catalog();
kodety_extensions_assert(array_keys($catalog) === $expected_bundled, 'catálogo inicial deve conter CMS, Analytics, Settings e Emails');
foreach ($expected_bundled as $slug) {
    kodety_extensions_assert(!empty($catalog[$slug]['bundled']), $slug . ' deve ser marcada como built-in');
    kodety_extensions_assert(!empty($catalog[$slug]['installed']), $slug . ' deve vir instalada');
    kodety_extensions_assert(!empty($catalog[$slug]['active']), $slug . ' deve iniciar ativa');
    kodety_extensions_assert(!empty($catalog[$slug]['required']), $slug . ' deve ser obrigatória');
}
kodety_extensions_assert(
    $manager->active_slugs() === $expected_bundled,
    'as quatro superfícies nativas devem iniciar ativas'
);

$required_result = $manager->deactivate_extension('kodety-cms');
kodety_extensions_assert_error(
    $required_result,
    'CMS obrigatório não pode ser desativado',
    'kodety_extension_required'
);
kodety_extensions_assert($manager->is_active('kodety-cms'), 'CMS deve continuar ativo após tentativa de desativação');
kodety_extensions_assert(!empty($manager->get('kodety-settings')['required']), 'Settings também deve ser marcada como obrigatória');
kodety_extensions_assert(!empty($manager->get('kodety-emails')['required']), 'Emails também deve ser marcada como obrigatória');
kodety_extensions_assert_error(
    $manager->deactivate_extension('kodety-analytics'),
    'Analytics nativo não pode ser desativado',
    'kodety_extension_required'
);
kodety_extensions_assert_error(
    $manager->uninstall('kodety-analytics'),
    'Analytics nativo não pode ser removido',
    'kodety_extension_bundled'
);

$storage = wp_normalize_path($manager->storage_dir());
$project_workspace = wp_normalize_path($kodety_extensions_uploads . '/kodety');
kodety_extensions_assert(
    $storage === wp_normalize_path($kodety_extensions_uploads . '/kodety-extensions'),
    'extensões devem usar uploads/kodety-extensions'
);
kodety_extensions_assert(
    $storage !== $project_workspace && !str_starts_with($storage . '/', $project_workspace . '/'),
    'storage de extensões deve ficar fora do workspace substituível uploads/kodety'
);

$reserved_analytics_zip = $kodety_extensions_root . '/reserved-analytics.zip';
kodety_extensions_package(
    $reserved_analytics_zip,
    kodety_extensions_manifest('kodety-analytics', 'Analytics substituto'),
    "<?php\n\$GLOBALS['kodety_legacy_analytics_loaded'] = true;\n"
);
$registry_before_reserved_install = get_option('kodety_extensions_registry');
kodety_extensions_assert_error(
    $manager->install_zip($reserved_analytics_zip),
    'upload não pode substituir uma extensão nativa pelo mesmo slug',
    'kodety_extension_reserved_slug'
);
kodety_extensions_assert(
    get_option('kodety_extensions_registry') === $registry_before_reserved_install,
    'upload com slug nativo não pode alterar o registro'
);
kodety_extensions_assert(
    !is_dir($storage . '/kodety-analytics'),
    'upload com slug nativo não pode criar diretório externo definitivo'
);

$legacy_analytics_directory = $storage . '/kodety-analytics';
kodety_extensions_assert(
    mkdir($legacy_analytics_directory, 0777, true),
    'fixture da extensão Analytics legada deve ser criada'
);
file_put_contents(
    $legacy_analytics_directory . '/extension.php',
    "<?php\n\$GLOBALS['kodety_legacy_analytics_loaded'] = true;\n"
);
$legacy_registry = get_option('kodety_extensions_registry');
$legacy_registry['extensions']['kodety-analytics'] = [
    'manifest' => kodety_extensions_manifest('kodety-analytics', 'Analytics legado'),
    'active' => true,
    'bundled' => false,
    'installedAt' => '2025-01-01T00:00:00Z',
    'updatedAt' => '2025-01-01T00:00:00Z',
    'lastError' => '',
];
update_option('kodety_extensions_registry', $legacy_registry, false);
$legacy_catalog_item = $manager->get('kodety-analytics');
kodety_extensions_assert(
    !empty($legacy_catalog_item['bundled'])
        && !empty($legacy_catalog_item['required'])
        && ($legacy_catalog_item['name'] ?? '') === 'Kodety Analytics',
    'registro Analytics legado não pode sobrescrever a definição bundled'
);
$manager->load_active();
kodety_extensions_assert(
    !isset($GLOBALS['kodety_legacy_analytics_loaded']),
    'boot não pode executar o entrypoint Analytics legado quando o módulo é bundled'
);
unset($legacy_registry['extensions']['kodety-analytics']);
update_option('kodety_extensions_registry', $legacy_registry, false);
kodety_extensions_remove_tree($legacy_analytics_directory);

$single_zip = $kodety_extensions_root . '/acme-runtime.zip';
$single_manifest = kodety_extensions_manifest('acme-runtime', 'ACME Runtime');
$entry = <<<'PHP'
<?php
$GLOBALS['kodety_runtime_extension_entry_loads'] = ($GLOBALS['kodety_runtime_extension_entry_loads'] ?? 0) + 1;
add_action('kodety_runtime_extension_ping', static function (): void {
    $GLOBALS['kodety_runtime_extension_pings'] = ($GLOBALS['kodety_runtime_extension_pings'] ?? 0) + 1;
});
PHP;
kodety_extensions_package($single_zip, $single_manifest, $entry);

$single_install = $manager->install_zip($single_zip);
kodety_extensions_assert(!is_wp_error($single_install), 'ZIP individual válido deve ser instalado');
kodety_extensions_assert($single_install['type'] === 'extension', 'instalação individual deve informar type=extension');
kodety_extensions_assert(count($single_install['installed']) === 1, 'instalação individual deve retornar uma extensão');
kodety_extensions_assert(!$manager->is_active('acme-runtime'), 'extensão enviada deve instalar inativa');
kodety_extensions_assert(is_dir($storage . '/acme-runtime'), 'arquivos da extensão devem ser persistidos no storage dedicado');
kodety_extensions_assert(
    !isset($GLOBALS['kodety_runtime_extension_entry_loads']),
    'entrypoint não deve executar durante uma instalação inativa'
);

$executable_zip = $kodety_extensions_root . '/executable-asset.zip';
kodety_extensions_make_zip($executable_zip, [
    'kodety-extension.json' => json_encode(kodety_extensions_manifest('executable-asset', 'Executable Asset')),
    'extension.php' => "<?php\n",
    'assets/not-allowed.exe' => 'MZ',
]);
kodety_extensions_assert_error(
    $manager->install_zip($executable_zip),
    'a ampliação para mídia não pode liberar executáveis arbitrários',
    'kodety_extensions_archive_rejected'
);

$activate_result = $manager->activate_extension('acme-runtime');
kodety_extensions_assert($activate_result === true, 'extensão individual deve poder ser ativada');
kodety_extensions_assert($manager->is_active('acme-runtime'), 'extensão ativada deve refletir estado ativo');
kodety_extensions_assert(
    ($GLOBALS['kodety_runtime_extension_entry_loads'] ?? 0) === 1,
    'ativação deve carregar o entrypoint exatamente uma vez'
);
do_action('kodety_runtime_extension_ping');
kodety_extensions_assert(
    ($GLOBALS['kodety_runtime_extension_pings'] ?? 0) === 1,
    'entrypoint carregado deve poder registrar hooks WordPress funcionais'
);

$saved_settings = [
    'apiKey' => 'preserved-secret-reference',
    'audience' => 'customers',
    'nested' => ['enabled' => true],
];
kodety_extensions_assert(
    $manager->update_settings('acme-runtime', $saved_settings),
    'extensão instalada deve poder persistir configurações'
);
kodety_extensions_assert(
    $manager->uninstall('acme-runtime', false) === true,
    'extensão externa deve poder ser removida sem apagar configurações'
);
kodety_extensions_assert($manager->get('acme-runtime') === null, 'extensão removida deve sair do catálogo');
kodety_extensions_assert(!is_dir($storage . '/acme-runtime'), 'uninstall deve remover apenas a pasta da extensão');
kodety_extensions_assert(
    $manager->get_settings('acme-runtime') === $saved_settings,
    'configurações devem sobreviver ao uninstall padrão'
);

$single_reinstall = $manager->install_zip($single_zip);
kodety_extensions_assert(!is_wp_error($single_reinstall), 'extensão removida deve poder ser reinstalada');
kodety_extensions_assert(!$manager->is_active('acme-runtime'), 'reinstalação após uninstall deve continuar opt-in/inativa');
kodety_extensions_assert(
    $manager->get_settings('acme-runtime') === $saved_settings,
    'configurações devem reaparecer intactas após reinstalação'
);

$bundle_one_zip = $kodety_extensions_root . '/bundle-one.zip';
$bundle_two_zip = $kodety_extensions_root . '/bundle-two.zip';
kodety_extensions_package(
    $bundle_one_zip,
    kodety_extensions_manifest('bundle-one', 'Bundle One'),
    "<?php\n\$GLOBALS['bundle_one_loaded'] = true;\n"
);
kodety_extensions_package(
    $bundle_two_zip,
    kodety_extensions_manifest('bundle-two', 'Bundle Two'),
    "<?php\n\$GLOBALS['bundle_two_loaded'] = true;\n"
);
$bundle_zip = $kodety_extensions_root . '/valid-bundle.zip';
kodety_extensions_make_zip($bundle_zip, [
    'kodety-bundle.json' => json_encode([
        'schemaVersion' => 1,
        'type' => 'bundle',
        'packages' => ['packages/bundle-one.zip', 'packages/bundle-two.zip'],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
    'packages/bundle-one.zip' => (string) file_get_contents($bundle_one_zip),
    'packages/bundle-two.zip' => (string) file_get_contents($bundle_two_zip),
]);

$bundle_install = $manager->install_zip($bundle_zip);
kodety_extensions_assert(!is_wp_error($bundle_install), 'bundle válido deve ser instalado');
kodety_extensions_assert($bundle_install['type'] === 'bundle', 'bundle deve informar type=bundle');
kodety_extensions_assert(
    array_column($bundle_install['installed'], 'slug') === ['bundle-one', 'bundle-two'],
    'bundle deve confirmar seus dois pacotes na ordem declarada'
);
foreach (['bundle-one', 'bundle-two'] as $slug) {
    kodety_extensions_assert($manager->get($slug) !== null, $slug . ' deve entrar no catálogo no mesmo commit');
    kodety_extensions_assert(!$manager->is_active($slug), $slug . ' deve instalar inativa');
    kodety_extensions_assert(is_dir($storage . '/' . $slug), $slug . ' deve ter diretório final');
}

$dependency_base_zip = $kodety_extensions_root . '/dependency-base.zip';
$dependency_child_zip = $kodety_extensions_root . '/dependency-child.zip';
kodety_extensions_package(
    $dependency_base_zip,
    kodety_extensions_manifest('dependency-base', 'Dependency Base')
);
$dependency_child_manifest = kodety_extensions_manifest('dependency-child', 'Dependency Child');
$dependency_child_manifest['dependencies'] = ['dependency-base'];
kodety_extensions_package($dependency_child_zip, $dependency_child_manifest);
kodety_extensions_assert(
    !is_wp_error($manager->install_zip($dependency_base_zip))
        && !is_wp_error($manager->install_zip($dependency_child_zip)),
    'fixtures de dependência devem ser instaladas'
);
kodety_extensions_assert_error(
    $manager->activate_extension('dependency-child'),
    'dependente não pode ativar antes de sua base',
    'kodety_extension_dependency_inactive'
);
kodety_extensions_assert(
    $manager->activate_extension('dependency-base') === true
        && $manager->activate_extension('dependency-child') === true,
    'dependências devem ativar na ordem correta'
);
kodety_extensions_assert_error(
    $manager->deactivate_extension('dependency-base'),
    'base não pode desativar enquanto um dependente está ativo',
    'kodety_extension_has_dependents'
);
kodety_extensions_assert(
    $manager->deactivate_extension('dependency-child') === true
        && $manager->deactivate_extension('dependency-base') === true,
    'base pode desativar depois do dependente'
);

$topology_base_zip = $kodety_extensions_root . '/topology-base.zip';
$topology_child_zip = $kodety_extensions_root . '/topology-child.zip';
kodety_extensions_package(
    $topology_base_zip,
    kodety_extensions_manifest('z-topology-base', 'Topology Base'),
    "<?php\n\$GLOBALS['kodety_topology_order'][] = 'base';\n"
);
$topology_child_manifest = kodety_extensions_manifest('a-topology-child', 'Topology Child');
$topology_child_manifest['dependencies'] = ['z-topology-base'];
kodety_extensions_package(
    $topology_child_zip,
    $topology_child_manifest,
    "<?php\nif (empty(\$GLOBALS['kodety_topology_order'])) throw new RuntimeException('base missing');\n"
        . "\$GLOBALS['kodety_topology_order'][] = 'child';\n"
);
kodety_extensions_assert(
    !is_wp_error($manager->install_zip($topology_base_zip))
        && !is_wp_error($manager->install_zip($topology_child_zip)),
    'fixtures topológicas devem ser instaladas'
);
$topology_registry = get_option('kodety_extensions_registry');
$topology_registry['extensions']['z-topology-base']['active'] = true;
$topology_registry['extensions']['a-topology-child']['active'] = true;
update_option('kodety_extensions_registry', $topology_registry, false);
$manager->load_active();
kodety_extensions_assert(
    ($GLOBALS['kodety_topology_order'] ?? []) === ['base', 'child'],
    'boot deve carregar dependências antes dos dependentes, não em ordem lexical'
);
kodety_extensions_assert(
    $manager->is_active('z-topology-base') && $manager->is_active('a-topology-child'),
    'extensões topologicamente válidas devem permanecer ativas'
);

$topology_v2 = kodety_extensions_manifest('z-topology-base', 'Topology Base');
$topology_v2['version'] = '2.0.0';
kodety_extensions_package($topology_base_zip, $topology_v2, "<?php\n");
kodety_extensions_assert(
    !is_wp_error($manager->install_zip($topology_base_zip)),
    'atualização de uma extensão ativa deve ser instalada'
);
$updated_registry = get_option('kodety_extensions_registry');
kodety_extensions_assert(
    !empty($updated_registry['extensions']['z-topology-base']['pendingActivation']),
    'atualização ativa deve persistir migração para o próximo boot'
);

add_action('kodety_extension_after_install', static function (string $slug): void {
    if ($slug === 'hook-safe') throw new RuntimeException('observer failed after commit');
}, 10, 1);
$hook_safe_zip = $kodety_extensions_root . '/hook-safe.zip';
kodety_extensions_package($hook_safe_zip, kodety_extensions_manifest('hook-safe', 'Hook Safe'));
$hook_safe_install = $manager->install_zip($hook_safe_zip);
kodety_extensions_assert(
    !is_wp_error($hook_safe_install) && $manager->get('hook-safe') !== null,
    'falha em observer pós-commit não pode transformar instalação confirmada em erro'
);
kodety_extensions_assert(
    $manager->activate_extension('hook-safe') === true,
    'extensão do teste de lifecycle deve ativar'
);
$hook_safe_changed_manifest = kodety_extensions_manifest('hook-safe', 'Hook Safe');
kodety_extensions_package(
    $hook_safe_zip,
    $hook_safe_changed_manifest,
    "<?php\n\$GLOBALS['kodety_hook_safe_revision'] = 2;\n"
);
kodety_extensions_assert(
    !is_wp_error($manager->install_zip($hook_safe_zip)),
    'conteúdo alterado com a mesma versão deve ser instalado'
);
$hook_safe_registry = get_option('kodety_extensions_registry');
kodety_extensions_assert(
    !empty($hook_safe_registry['extensions']['hook-safe']['pendingActivation']),
    'checksum alterado de extensão ativa deve agendar lifecycle mesmo sem mudar a versão'
);
add_action('kodety_extension_before_uninstall', static function (string $slug): void {
    if ($slug === 'hook-safe') throw new RuntimeException('uninstall veto');
}, 10, 1);
kodety_extensions_assert_error(
    $manager->uninstall('hook-safe'),
    'veto antes do uninstall deve retornar erro controlado',
    'kodety_extension_remove_failed'
);
kodety_extensions_assert(
    $manager->is_active('hook-safe') && is_dir($storage . '/hook-safe'),
    'veto antes do uninstall deve preservar arquivos e estado ativo'
);

$atomic_good_zip = $kodety_extensions_root . '/atomic-good.zip';
$atomic_bad_zip = $kodety_extensions_root . '/atomic-bad.zip';
kodety_extensions_package($atomic_good_zip, kodety_extensions_manifest('atomic-good', 'Atomic Good'));
kodety_extensions_make_zip($atomic_bad_zip, [
    'kodety-extension.json' => '{"schemaVersion":1,"type":"extension","slug":"atomic-bad"',
    'extension.php' => "<?php\n",
]);
$invalid_bundle_zip = $kodety_extensions_root . '/invalid-bundle.zip';
kodety_extensions_make_zip($invalid_bundle_zip, [
    'kodety-bundle.json' => json_encode([
        'schemaVersion' => 1,
        'type' => 'bundle',
        'packages' => ['packages/good.zip', 'packages/bad.zip'],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
    'packages/good.zip' => (string) file_get_contents($atomic_good_zip),
    'packages/bad.zip' => (string) file_get_contents($atomic_bad_zip),
]);
$registry_before_invalid_bundle = get_option('kodety_extensions_registry');
$invalid_bundle_result = $manager->install_zip($invalid_bundle_zip);
kodety_extensions_assert_error($invalid_bundle_result, 'bundle com segundo pacote inválido deve ser rejeitado');
kodety_extensions_assert($manager->get('atomic-good') === null, 'primeiro pacote não pode vazar de bundle rejeitado');
kodety_extensions_assert($manager->get('atomic-bad') === null, 'pacote inválido não pode entrar no catálogo');
kodety_extensions_assert(!is_dir($storage . '/atomic-good'), 'bundle rejeitado não pode mover o pacote válido ao destino');
kodety_extensions_assert(
    get_option('kodety_extensions_registry') === $registry_before_invalid_bundle,
    'bundle rejeitado deve preservar o registro inteiro, provando atomicidade'
);

$traversal_zip = $kodety_extensions_root . '/traversal.zip';
kodety_extensions_make_zip($traversal_zip, [
    'kodety-extension.json' => json_encode(kodety_extensions_manifest('evil-traversal', 'Evil Traversal')),
    'extension.php' => "<?php\n",
    '../escaped.php' => "<?php\nthrow new RuntimeException('escaped');\n",
]);
$registry_before_traversal = get_option('kodety_extensions_registry');
$traversal_result = $manager->install_zip($traversal_zip);
kodety_extensions_assert_error(
    $traversal_result,
    'entrada com path traversal deve ser rejeitada',
    'kodety_extensions_archive_rejected'
);
kodety_extensions_assert(!is_file($storage . '/escaped.php'), 'path traversal não pode escrever no storage pai');
kodety_extensions_assert(!is_file($kodety_extensions_uploads . '/escaped.php'), 'path traversal não pode escrever fora do storage');
kodety_extensions_assert(
    get_option('kodety_extensions_registry') === $registry_before_traversal,
    'ZIP com traversal não pode alterar o registro'
);

$invalid_manifest_zip = $kodety_extensions_root . '/invalid-manifest.zip';
kodety_extensions_make_zip($invalid_manifest_zip, [
    'kodety-extension.json' => json_encode([
        'schemaVersion' => 99,
        'type' => 'extension',
        'slug' => 'invalid-schema',
        'name' => 'Invalid Schema',
        'description' => 'Manifesto incompatível para validar rejeição.',
        'version' => '1.0.0',
        'entry' => 'extension.php',
    ]),
    'extension.php' => "<?php\n",
]);
$registry_before_invalid_manifest = get_option('kodety_extensions_registry');
$invalid_manifest_result = $manager->install_zip($invalid_manifest_zip);
kodety_extensions_assert_error(
    $invalid_manifest_result,
    'manifesto com schema incompatível deve ser rejeitado',
    'kodety_extension_schema'
);
kodety_extensions_assert($manager->get('invalid-schema') === null, 'manifesto inválido não pode entrar no catálogo');
kodety_extensions_assert(
    get_option('kodety_extensions_registry') === $registry_before_invalid_manifest,
    'manifesto inválido não pode alterar o registro'
);

$absolute_entry_zip = $kodety_extensions_root . '/absolute-entry.zip';
$absolute_entry_manifest = kodety_extensions_manifest('absolute-entry', 'Absolute Entry');
$absolute_entry_manifest['entry'] = '/extension.php';
kodety_extensions_package($absolute_entry_zip, $absolute_entry_manifest);
kodety_extensions_assert_error(
    $manager->install_zip($absolute_entry_zip),
    'entrypoint absoluto deve ser rejeitado',
    'kodety_extension_manifest_path'
);
kodety_extensions_assert(
    $manager->get('absolute-entry') === null,
    'manifesto com entrypoint absoluto não pode entrar no catálogo'
);

kodety_extensions_assert(
    file_get_contents($project_workspace . '/project-marker.json') === '{"project":"untouched"}',
    'instalações, bundles e uninstall não podem tocar o workspace do projeto'
);

fwrite(STDOUT, "Kodety extensions runtime: {$kodety_extensions_assertions} assertions passed.\n");
