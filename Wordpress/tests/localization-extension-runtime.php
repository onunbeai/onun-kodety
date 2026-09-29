<?php

define('ABSPATH', __DIR__ . '/');
define('KODETY_EDITION', 'pro');

$GLOBALS['kodety_localization_filters'] = [];
$GLOBALS['kodety_localization_actions'] = [];
$GLOBALS['kodety_localization_routes'] = [];

function add_filter(string $hook, callable $callback): bool {
    $GLOBALS['kodety_localization_filters'][$hook][] = $callback;
    return true;
}

function add_action(string $hook, callable $callback): bool {
    $GLOBALS['kodety_localization_actions'][$hook][] = $callback;
    return true;
}

function apply_filters(string $hook, mixed $value): mixed {
    foreach ($GLOBALS['kodety_localization_filters'][$hook] ?? [] as $callback) {
        $value = $callback($value);
    }
    return $value;
}

function __return_true(): bool { return true; }
function current_user_can(string $capability): bool { return $capability === Kodety_Plugin::CAP_EDIT_WORKSPACE; }
function register_rest_route(string $namespace, string $route, array $definition): bool {
    $GLOBALS['kodety_localization_routes'][$namespace . $route] = $definition;
    return true;
}
function admin_url(string $path = ''): string { return 'http://localhost/wp-admin/' . ltrim($path, '/'); }
function rest_url(string $path = ''): string { return 'http://localhost/wp-json/' . ltrim($path, '/'); }
function add_query_arg(string $key, string $value, string $url): string {
    return $url . (str_contains($url, '?') ? '&' : '?') . rawurlencode($key) . '=' . rawurlencode($value);
}

final class Kodety_Plugin {
    public const CAP_EDIT_WORKSPACE = 'kodety_edit_workspace';
    private static ?self $instance = null;
    public static function instance(): self { return self::$instance ??= new self(); }
    public function save_project_localization(): void {}
}

function kodety_localization_assert(bool $condition, string $message): void {
    if ($condition) return;
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-edition.php';

if (Kodety_Edition::has('localization')) {
    fwrite(STDERR, "FAIL: multi-idiomas não pode iniciar ativo no plugin principal.\n");
    exit(1);
}

require dirname(__DIR__) . '/extensions/kodety-localization/extension.php';

if (!Kodety_Edition::has('localization')) {
    fwrite(STDERR, "FAIL: a extensão ativa deve liberar multi-idiomas.\n");
    exit(1);
}

foreach ($GLOBALS['kodety_localization_actions']['rest_api_init'] ?? [] as $callback) $callback();
$route = $GLOBALS['kodety_localization_routes']['kodety/v1/project/localization'] ?? null;
kodety_localization_assert(is_array($route), 'a extensão precisa registrar o endpoint incremental de localização');
kodety_localization_assert(($route['methods'] ?? '') === 'POST', 'o endpoint incremental deve aceitar somente POST');
kodety_localization_assert(($route['permission_callback'])() === true, 'o endpoint deve exigir a capability de edição');
kodety_localization_assert(
    is_array($route['callback'] ?? null) && ($route['callback'][1] ?? '') === 'save_project_localization',
    'o endpoint deve apontar para o validador transacional do core'
);

$config = apply_filters('kodety_editor_shell_config', [
    'share' => ['active' => true, 'token' => 'share token'],
]);
$assets_root = dirname(__DIR__) . '/extensions/kodety-localization/assets';
$entry_file = $assets_root . '/localization.js';
$asset_version = $kodety_localization_asset_version($entry_file);
$asset_arguments = [
    'kodety_share_token' => 'share token',
    'ver' => $asset_version,
];
kodety_localization_assert(
    preg_match('/^[a-f0-9]{20}$/', $asset_version) === 1,
    'a versão imutável precisa cobrir o conteúdo compilado e a semântica de entrega'
);
kodety_localization_assert(
    ($config['localizationEntryUrl'] ?? '') === $kodety_localization_private_asset_url(
        'kodety_localization_asset',
        $asset_arguments
    ),
    'o entry privado precisa usar a URL canônica da extensão'
);
kodety_localization_assert(
    str_contains((string) ($config['localizationEntryUrl'] ?? ''), 'kodety_share_token=share%20token'),
    'o asset dinâmico precisa preservar a credencial do compartilhamento'
);
kodety_localization_assert(
    str_contains((string) ($config['localizationEntryUrl'] ?? ''), 'ver='),
    'o asset precisa receber versão imutável baseada no arquivo'
);
kodety_localization_assert(
    str_contains((string) ($config['localizationFileUrl'] ?? ''), 'kodety_localization_file')
        && str_contains((string) ($config['localizationFileUrl'] ?? ''), 'kodety_share_token=share%20token')
        && str_contains((string) ($config['localizationFileUrl'] ?? ''), 'ver='),
    'os chunks precisam continuar privados, versionados e preservar o compartilhamento'
);
kodety_localization_assert(
    str_contains((string) ($config['localizationFlagAssetUrl'] ?? ''), 'kodety_localization_flag')
        && str_contains((string) ($config['localizationFlagAssetUrl'] ?? ''), 'kodety_share_token=share%20token')
        && str_contains((string) ($config['localizationFlagAssetUrl'] ?? ''), 'ver='),
    'as bandeiras sob demanda precisam continuar privadas e versionadas'
);
kodety_localization_assert(
    is_array($config['localizationPreloadUrls'] ?? null)
        && count($config['localizationPreloadUrls']) === 1
        && str_contains((string) $config['localizationPreloadUrls'][0], 'kodety_localization_file')
        && str_contains((string) $config['localizationPreloadUrls'][0], 'file=chunks%2FWordPressLocalizationWorkspace-')
        && str_contains((string) $config['localizationPreloadUrls'][0], 'kodety_share_token=share%20token'),
    'o workspace principal precisa começar no head sem sair do endpoint autenticado'
);
$manifest = json_decode((string) file_get_contents($assets_root . '/manifest.json'), true);
$entry_manifest = is_array($manifest)
    ? ($manifest['Wordpress/editor/localization-main.tsx'] ?? null)
    : null;
$workspace_manifest = null;
$dynamic_imports = is_array($entry_manifest) && is_array($entry_manifest['dynamicImports'] ?? null)
    ? $entry_manifest['dynamicImports']
    : [];
foreach ($dynamic_imports as $import_key) {
    $import = $manifest[(string) $import_key] ?? null;
    if (is_array($import) && ($import['name'] ?? '') === 'WordPressLocalizationWorkspace') {
        $workspace_manifest = $import;
        break;
    }
}
$workspace_relative = is_array($workspace_manifest) ? (string) ($workspace_manifest['file'] ?? '') : '';
$workspace_url = $kodety_localization_private_asset_url(
    'kodety_localization_file',
    $asset_arguments,
    $workspace_relative
);
kodety_localization_assert(
    $workspace_relative !== '' && ($config['localizationPreloadUrls'][0] ?? '') === $workspace_url,
    'preload e import dinâmico precisam apontar byte a byte para o mesmo módulo de workspace'
);
$onboarding_manifest = $manifest['app/(builder)/kodety/html-editor/components/HtmlBuilderOnboarding.tsx'] ?? null;
$onboarding_relative = is_array($onboarding_manifest) ? (string) ($onboarding_manifest['file'] ?? '') : '';
kodety_localization_assert(
    $onboarding_relative !== '' && !in_array(
        $kodety_localization_private_asset_url('kodety_localization_file', $asset_arguments, $onboarding_relative),
        $config['localizationPreloadUrls'],
        true
    ),
    'o guia opcional precisa carregar apenas sob demanda, sem preload ao entrar em localização'
);
kodety_localization_assert(
    parse_url($workspace_url, PHP_URL_QUERY)
        === 'action=kodety_localization_file&kodety_share_token=share%20token&ver=' . $asset_version
            . '&file=' . rawurlencode($workspace_relative),
    'a identidade ESM canônica precisa manter action, compartilhamento, versão e arquivo nesta ordem'
);
$agent_manifest = is_array($manifest)
    ? ($manifest['app/(builder)/kodety/html-editor/components/HtmlAgentPanel.tsx'] ?? null)
    : null;
$agent_file = is_array($agent_manifest)
    ? $assets_root . '/' . (string) ($agent_manifest['file'] ?? '')
    : '';
$rewritten_agent = is_file($agent_file)
    ? $kodety_localization_rewrite_static_imports(
        (string) file_get_contents($agent_file),
        $agent_file,
        $asset_arguments
    )
    : '';
kodety_localization_assert(
    $rewritten_agent !== '' && str_contains($rewritten_agent, $workspace_url),
    'o Agent precisa importar a mesma instância do workspace publicada pelo preload e pelo loader'
);
$workspace_file = $assets_root . '/' . $workspace_relative;
$rewritten_workspace = is_file($workspace_file)
    ? $kodety_localization_rewrite_static_imports(
        (string) file_get_contents($workspace_file),
        $workspace_file,
        $asset_arguments
    )
    : '';
kodety_localization_assert(
    $rewritten_workspace !== ''
        && str_contains($rewritten_workspace, (string) ($config['localizationEntryUrl'] ?? '')),
    'imports compartilhados pelo workspace precisam voltar ao mesmo entry privado'
);
$legacy_workspace_url = add_query_arg(
    'file',
    $workspace_relative,
    admin_url('admin-ajax.php?action=kodety_localization_file')
);
$legacy_workspace_url = add_query_arg('kodety_share_token', 'share token', $legacy_workspace_url);
$legacy_workspace_url = add_query_arg('ver', $asset_version, $legacy_workspace_url);
kodety_localization_assert(
    $legacy_workspace_url !== $workspace_url,
    'a ordem legada file/share/ver deve permanecer detectável como uma segunda identidade ESM'
);
kodety_localization_assert(
    str_contains((string) ($config['localizationStyleUrl'] ?? ''), 'kodety_localization_style')
        && str_contains((string) ($config['localizationStyleUrl'] ?? ''), 'kodety_share_token=share%20token')
        && str_contains((string) ($config['localizationStyleUrl'] ?? ''), 'ver='),
    'o CSS compilado da extensão precisa ser autenticado, versionado e preservar o compartilhamento'
);
kodety_localization_assert(
    ($config['localizationSaveUrl'] ?? '') === 'http://localhost/wp-json/kodety/v1/project/localization',
    'o shell precisa expor o endpoint metadata-only para o workspace e o Builder'
);

fwrite(STDOUT, "Kodety localization extension: canonical private module graph passed.\n");
