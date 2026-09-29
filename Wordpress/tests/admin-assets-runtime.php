<?php

declare(strict_types=1);

/** Run the real route asset planner without a WordPress install or database. */
define('ABSPATH', __DIR__ . '/');
define('KODETY_DIR', dirname(__DIR__) . '/kodety/');
define('KODETY_URL', 'https://example.test/wp-content/plugins/kodety/');
define('KODETY_VERSION', 'test');

final class WP_Screen {
    public function __construct(
        public string $id,
        public string $base,
        public string $post_type = '',
        public string $taxonomy = '',
        private bool $block = false,
    ) {}
    public function is_block_editor(): bool { return $this->block; }
}

$admin_asset_state = [];
$admin_asset_checks = 0;
$admin_asset_reports = [];
function get_current_screen(): ?WP_Screen { return $GLOBALS['admin_asset_state']['screen']; }
function get_option(string $key, mixed $fallback = false): mixed { return $GLOBALS['admin_asset_state']['options'][$key] ?? $fallback; }
function sanitize_key(string $value): string { return preg_replace('/[^a-z0-9_-]/', '', strtolower($value)); }
function sanitize_html_class(string $value): string { return preg_replace('/[^a-zA-Z0-9_-]/', '', $value); }
function absint(mixed $value): int { return abs((int) $value); }
function determine_locale(): string { return 'en_US'; }
function admin_url(string $path = ''): string { return 'https://example.test/wp-admin/' . $path; }
function home_url(string $path = ''): string { return 'https://example.test' . $path; }
function wp_logout_url(string $redirect = ''): string { return 'https://example.test/wp-login.php?action=logout&amp;redirect_to=%2F&amp;_wpnonce=fixture'; }
function wp_get_attachment_image_url(int $id, string $size): string { return ''; }
function wp_json_encode(mixed $value): string { return json_encode($value, JSON_THROW_ON_ERROR); }
function is_network_admin(): bool { return $GLOBALS['admin_asset_state']['network']; }
function is_user_admin(): bool { return false; }
function current_user_can(string $capability): bool { return $GLOBALS['admin_asset_state']['capabilities'][$capability] ?? true; }
function is_multisite(): bool { return $GLOBALS['admin_asset_state']['network']; }
function get_post_type_object(string $name): object { return (object) ['_builtin' => in_array($name, ['post', 'page', 'attachment'], true)]; }
function get_taxonomy(string $name): object { return (object) ['_builtin' => in_array($name, ['category', 'post_tag'], true)]; }
function wp_enqueue_style(string $handle, string $src = '', array $deps = [], mixed $ver = false, string $media = 'all'): void {
    $GLOBALS['admin_asset_state']['styles'][$handle] = compact('src', 'deps');
}
function wp_enqueue_script(string $handle, string $src = '', array $deps = [], mixed $ver = false, mixed $args = false): void {
    $GLOBALS['admin_asset_state']['scripts'][$handle] = compact('src', 'deps', 'args');
}
function add_action(string $hook, callable $callback, int $priority = 10, int $accepted_args = 1): void { $GLOBALS['admin_asset_state']['hooks'][$hook][] = $callback; }
function wp_add_inline_style(string $handle, string $data): void { $GLOBALS['admin_asset_state']['inline_styles'][$handle][] = $data; }
function wp_add_inline_script(string $handle, string $data, string $position = 'after'): void { $GLOBALS['admin_asset_state']['inline_scripts'][$handle][] = $data; }
function wp_script_is(string $handle, string $status = 'enqueued'): bool { return in_array($handle, $GLOBALS['admin_asset_state']['native_scripts'], true); }
function wp_style_is(string $handle, string $status = 'enqueued'): bool { return false; }
function wp_get_theme(): object { return new class { public function get_stylesheet(): string { return 'test'; } public function get_template(): string { return 'test'; } }; }
function wp_get_themes(): array { return ['test' => wp_get_theme()]; }
function wp_nonce_url(string $url, string $action): string { return $url . '&_wpnonce=fixture'; }

require KODETY_DIR . 'includes/class-kodety-plugin.php';
$admin_asset_plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();

function asset_check(bool $pass, string $message): void {
    $GLOBALS['admin_asset_checks']++;
    if (!$pass) throw new RuntimeException($message);
}

/** @return array{styles: array, scripts: array, classes: string} */
function asset_route(WP_Screen $screen, array $options = [], array $native_scripts = [], bool $network = false, array $capabilities = []): array {
    $GLOBALS['admin_asset_state'] = [
        'screen' => $screen, 'options' => $options, 'native_scripts' => $native_scripts,
        'network' => $network, 'styles' => [], 'scripts' => [], 'inline_styles' => [], 'inline_scripts' => [],
        'capabilities' => $capabilities,
    ];
    $GLOBALS['admin_asset_plugin']->admin_assets();
    $GLOBALS['admin_asset_state']['classes'] = $GLOBALS['admin_asset_plugin']->admin_body_classes('wp-admin');
    $state = $GLOBALS['admin_asset_state'];
    foreach (['styles', 'scripts'] as $kind) {
        foreach ($state[$kind] as $handle => $asset) {
            asset_check(str_starts_with($asset['src'], KODETY_URL . 'admin/'), "{$screen->id}: the skin must use local admin assets.");
            asset_check(!preg_match('~/(login|onboarding)\.(css|js)$~', $asset['src']), "{$screen->id}: login/onboarding assets must stay isolated.");
            asset_check(is_file(KODETY_DIR . substr($asset['src'], strlen(KODETY_URL))), "{$screen->id}: {$handle} must point to an existing file.");
            foreach ($asset['deps'] as $dependency) {
                if (!str_starts_with($dependency, 'kodety-')) continue;
                asset_check(isset($state[$kind][$dependency]), "{$screen->id}: dependency {$dependency} must be present with {$handle}.");
            }
        }
    }
    return $state;
}

function has_asset(array $state, string $filename): bool {
    foreach (['styles', 'scripts'] as $kind) {
        foreach ($state[$kind] as $asset) {
            if (str_ends_with($asset['src'], '/' . $filename)) return true;
        }
    }
    return false;
}

function asset_weight(array $state): array {
    $weight = ['cssFiles' => count($state['styles']), 'jsFiles' => count($state['scripts']), 'rawBytes' => 0, 'gzipBytes' => 0];
    foreach (['styles', 'scripts'] as $kind) {
        foreach ($state[$kind] as $asset) {
            $content = file_get_contents(KODETY_DIR . substr($asset['src'], strlen(KODETY_URL)));
            $weight['rawBytes'] += strlen($content);
            $weight['gzipBytes'] += strlen(gzencode($content, 6));
        }
    }
    return $weight;
}

// Deployed adapters must match their readable sources, not a stale generated file.
foreach (['shell', 'native-workspace', 'native-tools'] as $adapter) {
    $source = file_get_contents(KODETY_DIR . "admin/components/{$adapter}.js");
    $bundle = file_get_contents(KODETY_DIR . "admin/components/{$adapter}.bundle.js");
    asset_check(str_contains($bundle, 'source-sha256: ' . hash('sha256', $source)), "{$adapter}: rebuild the admin runtime after editing its source.");
    if ($adapter === 'shell') {
        foreach (['navigation-loading.js', 'native-select.js'] as $dependency) {
            $dependency_source = file_get_contents(KODETY_DIR . "admin/components/{$dependency}");
            asset_check(str_contains($bundle, 'dependency-sha256: ' . $dependency . '=' . hash('sha256', $dependency_source)), "shell: rebuild the admin runtime after editing {$dependency}.");
        }
    }
}

foreach (['shell' => [''], 'design-system' => [''], 'dashboard' => [''], 'wp-admin-audit' => ['', '.standard', '.dashboard', '.settings', '.catalog', '.menus', '.tools', '.lists', '.comments', '.plugins', '.media', '.apps']] as $style => $variants) {
    $source = file_get_contents(KODETY_DIR . "admin/components/{$style}.css");
    foreach ($variants as $variant) {
        $bundle = file_get_contents(KODETY_DIR . "admin/components/{$style}{$variant}.bundle.css");
        asset_check(str_contains($bundle, 'source-sha256: ' . hash('sha256', $source)), "{$style}{$variant}: rebuild CSS after editing its readable source.");
    }
}

$list_css = file_get_contents(KODETY_DIR . 'admin/components/wp-admin-audit.lists.bundle.css');
$standard_css = file_get_contents(KODETY_DIR . 'admin/components/wp-admin-audit.standard.bundle.css');
asset_check(str_contains($list_css, '.quicktags-toolbar') && str_contains($list_css, '.media-modal-content') && str_contains($list_css, '.plugin-details-modal'), 'Lists must retain native reply editors and media dialogs, including plugins that enqueue media later.');
asset_check(!str_contains($list_css, '.kdw-form-card--grouped'), 'List routes must not download the settings workspace layout.');
asset_check(!str_contains($standard_css, '.kdw-row-menu'), 'Other native routes must not download the list actions adapter styling.');
asset_check(!str_contains($standard_css, '.connectors-page') && !str_contains($list_css, '.font-library-page'), 'Core React applications must not add page-specific CSS to classic lists or forms.');

// Composition variants retain native dialogs while omitting unrelated families.
foreach (['lists', 'comments', 'plugins', 'dashboard'] as $variant) {
    $css = file_get_contents(KODETY_DIR . "admin/components/wp-admin-audit.{$variant}.bundle.css");
    asset_check(str_contains($css, '.quicktags-toolbar') && str_contains($css, '.media-modal-content') && str_contains($css, '.plugin-details-modal'), "{$variant}: native editor and modal controls must remain available.");
    asset_check(str_contains($css, '.kdw-comment-row') === ($variant === 'comments'), "{$variant}: comment composition must be exclusive to comments.");
    asset_check(str_contains($css, '.kdw-plugin-status') === ($variant === 'plugins'), "{$variant}: plugin composition must be exclusive to plugin tables.");
}
asset_check(!str_contains($standard_css, '.theme-browser') && !str_contains($standard_css, '#kodety_dashboard'), 'Standard forms and updates must not download catalog or dashboard composition.');

// Each family exercises native body classes as well as the route asset graph.
$families = [
    ['dashboard', 'dashboard', '', '', true, false, false],
    ['edit-post', 'edit', 'post', '', false, true, false],
    ['edit-page', 'edit', 'page', '', false, true, false],
    ['edit-comments', 'edit-comments', '', '', false, true, false],
    ['users', 'users', '', '', false, true, false],
    ['plugins', 'plugins', '', '', false, true, false],
    ['edit-category', 'edit-tags', 'post', 'category', false, true, false],
    ['link-manager', 'link-manager', '', '', false, true, false],
    ['export-personal-data', 'export-personal-data', '', '', false, true, false],
    ['erase-personal-data', 'erase-personal-data', '', '', false, true, false],
    ['upload', 'upload', 'attachment', '', false, true, true],
    ['media', 'media', 'attachment', '', false, false, true],
    ['profile', 'profile', '', '', false, false, false],
    ['options-connectors', 'options-connectors', '', '', false, false, false],
    ['font-library', 'font-library', '', '', false, false, false],
    ['options-general', 'options-general', '', '', false, false, false],
    ['site-health', 'site-health', '', '', false, false, false],
    ['tools', 'tools', '', '', false, false, false],
    ['export', 'export', '', '', false, false, false],
    ['import', 'import', '', '', false, false, false],
    ['export-personal-data', 'export-personal-data', '', '', false, true, false],
    ['erase-personal-data', 'erase-personal-data', '', '', false, true, false],
    ['update-core', 'update-core', '', '', false, false, false],
    ['themes', 'themes', '', '', false, false, false],
    ['plugin-install', 'plugin-install', '', '', false, false, false],
];
foreach ($families as [$id, $base, $post_type, $taxonomy, $dashboard, $lists, $media]) {
    $state = asset_route(new WP_Screen($id, $base, $post_type, $taxonomy));
    $audit_variant = match (true) {
        $base === 'dashboard' => 'dashboard',
        $base === 'edit-comments' => 'comments',
        $base === 'plugins' => 'plugins',
        in_array($base, ['options-connectors','font-library'],true) => 'apps',
        in_array($base, ['tools','import','export','site-health','export-personal-data','erase-personal-data'],true) => 'tools',
        in_array($base, ['upload','media'],true) => 'media',
        $lists => 'lists',
        in_array($base, ['themes','theme-install','plugin-install'],true) => 'catalog',
        in_array($base, ['nav-menus','widgets'],true) => 'menus',
        str_starts_with($base,'options-') || in_array($base,['profile','user-edit','user-new','site-settings','site-info'],true) => 'settings',
        default => 'standard',
    };
    foreach (['shell.bundle.css', 'design-system.bundle.css', "wp-admin-audit.{$audit_variant}.bundle.css", 'kodety-icons.bundle.js', 'shell.bundle.js', 'native-workspace.bundle.js'] as $shared) {
        asset_check(has_asset($state, $shared), "{$id}: shared visual foundation {$shared} must be present.");
    }
    asset_check(has_asset($state, 'dashboard.bundle.css') === $dashboard, "{$id}: dashboard styling must remain dashboard-only.");
    foreach (['dashboard.js', 'lists.css', 'lists.js', 'media.css', 'media.js', 'native-plugin-surface.css'] as $legacy) {
        asset_check(!has_asset($state, $legacy), "{$id}: obsolete {$legacy} must not enter the new workspace graph.");
    }
    asset_check(count($state['scripts']) === ($audit_variant === 'tools' ? 4 : 3), "{$id}: only Tools routes may add the tools layout adapter.");
    asset_check(has_asset($state, 'native-tools.bundle.js') === ($audit_variant === 'tools'), "{$id}: tools behavior must not be downloaded on unrelated routes.");
    foreach (['kodety-admin-icons', 'kodety-ui-shell', 'kodety-native-workspace'] as $handle) {
        asset_check(($state['scripts'][$handle]['args']['strategy'] ?? '') === 'defer' && empty($state['scripts'][$handle]['args']['in_footer']), "{$id}: the custom frame must begin loading in the head without blocking parsing.");
    }
    asset_check(count($state['styles']) === ($dashboard ? 4 : 3), "{$id}: one visual source must style native and plugin surfaces.");
    asset_check(str_contains($state['classes'], 'kodety-admin-native'), "{$id}: native administration must receive the Kodety theme class.");
    asset_check(!has_asset($state, 'editor-chrome.css'), "{$id}: classic routes must not load the fullscreen editor adapter.");
    asset_check(!has_asset($state, 'plugin-information.css'), "{$id}: plugin details styling must stay exclusive to its iframe.");
    $weight = asset_weight($state);
    // Rounded transfer ceilings prevent a later global enqueue from quietly
    // adding route-specific modules or a framework to the visual replacement.
    // The Tools-only adapter and composed import/export controls get a bounded
    // 2 KB allowance; unrelated routes keep the original transfer ceiling.
    $gzip_limit = 60_000 + ($dashboard ? 4_000 : 0) + ($audit_variant === 'tools' ? 2_000 : 0);
    asset_check($weight['gzipBytes'] <= $gzip_limit, "{$id}: the optional admin skin must stay within its {$gzip_limit}-byte gzip budget.");
    $admin_asset_reports[$id] = $weight;
}

// JSON URLs are assigned to href properties and must not retain HTML entities.
$config_script = $state['inline_scripts']['kodety-admin-icons'][0];
$config = json_decode(substr($config_script, strlen('window.kodetyAdmin='), -1), true, 512, JSON_THROW_ON_ERROR);
parse_str(parse_url($config['logoutUrl'], PHP_URL_QUERY), $logout_query);
asset_check(($logout_query['_wpnonce'] ?? '') === 'fixture' && isset($logout_query['redirect_to']), 'Account logout must preserve the nonce and redirect as actual query parameters.');

foreach ([['kodety_import' => false], ['kodety_publish' => false], ['edit_theme_options' => false], ['manage_options' => false]] as $capabilities) {
    $restricted = asset_route(new WP_Screen('dashboard', 'dashboard'), [], [], false, $capabilities);
    $config_script = $restricted['inline_scripts']['kodety-admin-icons'][0];
    $config = json_decode(substr($config_script, strlen('window.kodetyAdmin='), -1), true, 512, JSON_THROW_ON_ERROR);
    asset_check($config['projectAreas']['import'] === !array_intersect_key($capabilities, array_flip(['kodety_import', 'kodety_publish', 'edit_theme_options'])), 'Import navigation must match the actual import panel capabilities.');
    asset_check($config['projectAreas']['extensions'] === !isset($capabilities['manage_options']), 'Extensions navigation must respect administrator access.');
    asset_check($config['projectAreas']['security'] === !isset($capabilities['manage_options']), 'Security navigation must respect administrator access.');
}

// The details iframe loads only its own small addition to the shared styles.
$saved_query = $_GET;
$_GET['tab'] = 'plugin-information';
$details = asset_route(new WP_Screen('plugin-install', 'plugin-install'));
asset_check(has_asset($details, 'plugin-information.css'), 'Plugin details iframe must receive its dedicated styles.');
asset_check(in_array('kodety-wp-admin-audit', $details['styles']['kodety-plugin-information']['deps'], true), 'Plugin details must reuse the shared foundation.');
$_GET = $saved_query;

// A classic form or plugin may open WordPress' media modal without being the library.
foreach ([new WP_Screen('post', 'post', 'post'), new WP_Screen('edit-post', 'edit', 'post')] as $screen) {
    $state = asset_route($screen, [], ['media-views']);
    asset_check((has_asset($state, 'wp-admin-audit.standard.bundle.css') || has_asset($state, 'wp-admin-audit.lists.bundle.css')) && !has_asset($state, 'media.js'), "{$screen->id}: media dialogs use the common stylesheet without another runtime.");
    asset_check(!has_asset($state, 'dashboard.js'), "{$screen->id}: a modal must not pull in dashboard behavior.");
}

// Kodety-owned pages use the same visual source and add only their actual page assets.
foreach (['toplevel_page_kodety', 'kodety_page_kodety-emails', 'toplevel_page_kodety-manual'] as $id) {
    $state = asset_route(new WP_Screen($id, $id));
    asset_check(!has_asset($state, 'native-workspace.bundle.js') && has_asset($state, 'wp-admin-audit.bundle.css') && str_contains($state['classes'], 'kodety-admin-owned'), "{$id}: product pages share the native workspace foundation.");
    asset_check(!has_asset($state, 'native-plugin-surface.css') && !has_asset($state, 'dashboard.js'), "{$id}: no competing legacy visual layer is loaded.");
    if ($id === 'toplevel_page_kodety') {
        asset_check(has_asset($state, 'kodety-page.css') && has_asset($state, 'kodety-page.js'), 'The product project page retains its controls and dedicated stylesheet.');
        asset_check(in_array('kodety-wp-admin-audit', $state['styles']['kodety-project-page']['deps'], true), 'Project styles must follow the shared visual foundation.');
    }
    $admin_asset_reports[$id] = asset_weight($state);
}

// Third-party plugin pages retain their own content CSS and native handlers.
foreach (['toplevel_page_example', 'settings_page_example', 'example_page_reports'] as $id) {
    $state = asset_route(new WP_Screen($id, $id), [], ['media-views']);
    asset_check(count($state['styles']) === 1 && has_asset($state, 'shell.bundle.css'), "{$id}: only the surrounding shell stylesheet may be enqueued.");
    asset_check(count($state['scripts']) === 2 && !has_asset($state, 'native-workspace.bundle.js'), "{$id}: no native content adapter may run on a third-party page.");
    asset_check(str_contains($state['classes'], 'kodety-admin-third-party'), "{$id}: content ownership must be explicit.");
    $inline = implode('', $state['inline_scripts']['kodety-admin-icons'] ?? []);
    asset_check(str_contains($inline, '"adminSurface":"third-party"') && str_contains($inline, "if (native) root.classList.add('kodety-native-pending')"), "{$id}: the recovery boot must only wait for native content.");
}

// Fullscreen editor UI is styled without rebuilding navigation or touching its canvas.
foreach ([
    new WP_Screen('post', 'post', 'post', '', true),
    new WP_Screen('site-editor', 'site-editor'),
    new WP_Screen('widgets', 'widgets', '', '', true),
    new WP_Screen('customize', 'customize'),
] as $screen) {
    foreach (['0', '1'] as $legacy_beta) {
        $state = asset_route($screen, ['kodety_block_editor_skin_enabled' => $legacy_beta]);
        asset_check(count($state['styles']) === 1 && has_asset($state, 'editor-chrome.css'), "{$screen->id}: the editor must load exactly its lightweight stylesheet.");
        asset_check($state['scripts'] === [], "{$screen->id}: the editor skin must add no JavaScript.");
        asset_check(!str_contains($state['classes'], 'kodety-admin-skin'), "{$screen->id}: generic native admin skin must not affect the editor.");
        asset_check($state['classes'] !== 'wp-admin', "{$screen->id}: the editor chrome must opt into its scoped CSS even without the old beta flag.");
        asset_check(asset_weight($state)['gzipBytes'] <= 4_000, "{$screen->id}: the CSS-only editor skin must remain at most 4 KB gzip.");
    }
}

foreach (['sites', 'site-users', 'site-themes', 'themes', 'users'] as $base) {
    $network = asset_route(new WP_Screen($base . '-network', $base), [], [], true);
    asset_check(str_contains($network['classes'], 'kodety-network-admin'), 'Multisite must retain its explicit body class.');
    asset_check(has_asset($network, 'shell.bundle.css'), 'Multisite administration must keep the shared design.');
    $variant = in_array($base, ['site-themes', 'themes'], true) ? 'plugins' : 'lists';
    asset_check(has_asset($network, "wp-admin-audit.{$variant}.bundle.css"), "{$base}: network theme tables must retain the plugin table composition.");
    asset_check(has_asset($network, 'native-workspace.bundle.js') && !has_asset($network, 'lists.js'), "{$base}-network: native network tables use the shared structural adapter.");
    asset_check(!has_asset($network, 'dashboard.js') && !has_asset($network, 'media.js'), "{$base}-network: network tables must avoid unrelated UI modules.");
    $admin_asset_reports[$base . '-network'] = asset_weight($network);
}

foreach ([new WP_Screen('dashboard', 'dashboard'), new WP_Screen('post', 'post', 'post', '', true)] as $screen) {
    $state = asset_route($screen, ['kodety_interface_enabled' => '0']);
    asset_check($state['styles'] === [] && $state['scripts'] === [], "{$screen->id}: disabling the interface must remove the optional skin.");
    asset_check($state['classes'] === 'wp-admin', "{$screen->id}: disabling the interface must preserve the native body classes.");
}
$onboarding = asset_route(new WP_Screen('admin_page_kodety-onboarding', 'admin_page'));
asset_check($onboarding['styles'] === [] && $onboarding['scripts'] === [], 'The standalone onboarding document must not pull in admin assets.');

echo 'Admin asset routes and editor isolation passed (' . $admin_asset_checks . " checks).\n";
if (in_array('--report', $argv ?? [], true)) echo json_encode($admin_asset_reports, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
