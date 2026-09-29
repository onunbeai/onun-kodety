<?php

/** Run with: php Wordpress/tests/agents-browser-runtime.php */
define('ABSPATH', __DIR__);

final class Kodety_Edition {}
final class Kodety_Sitemap {}
final class Kodety_Publication_Optimizer {}
final class Kodety_Sharing {
    public static function instance(): self { return new self(); }
    public function context(): ?array { return $GLOBALS['browser_test_shared'] ? ['token' => 'share'] : null; }
    public static function share_url(string $token, string $app): string { return 'https://site.test/kodety/share/' . $token . '/' . $app . '/'; }
}
function get_query_var(string $name): mixed { return $GLOBALS['browser_test_query'][$name] ?? ''; }
function current_user_can(string $capability): bool { return $GLOBALS['browser_test_ai']; }
function wp_unslash(string $value): string { return stripslashes($value); }
function home_url(string $path): string { return 'https://site.test' . $path; }
function add_query_arg(string $key, string $value, string $url): string { return $url . '?' . http_build_query([$key => $value]); }
function browser_runtime_check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

require dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php';
$plugin = (new ReflectionClass(Kodety_Plugin::class))->newInstanceWithoutConstructor();
$cases = [
    ['editor query', 'editor', ['kodety_agent_runtime' => 'webcontainer'], [], true, false, '', true],
    ['settings cookie', 'settings', [], ['kodety_agent_runtime' => 'webcontainer'], true, false, '', true],
    ['query overrides server cookie', 'editor', ['kodety_agent_runtime' => 'webcontainer'], ['kodety_agent_runtime' => 'server'], true, false, '', true],
    ['server overrides browser cookie', 'editor', ['kodety_agent_runtime' => 'server'], ['kodety_agent_runtime' => 'webcontainer'], true, false, '', false],
    ['invalid query never falls back', 'editor', ['kodety_agent_runtime' => 'other'], ['kodety_agent_runtime' => 'webcontainer'], true, false, '', false],
    ['array query never falls back', 'editor', ['kodety_agent_runtime' => ['webcontainer']], ['kodety_agent_runtime' => 'webcontainer'], true, false, '', false],
    ['empty query never falls back', 'settings', ['kodety_agent_runtime' => ''], ['kodety_agent_runtime' => 'webcontainer'], true, false, '', false],
    ['invalid cookie', 'editor', [], ['kodety_agent_runtime' => 'WebContainer'], true, false, '', false],
    ['array cookie', 'editor', [], ['kodety_agent_runtime' => ['webcontainer']], true, false, '', false],
    ['default remains server', 'editor', [], [], true, false, '', false],
    ['public pages', '', ['kodety_agent_runtime' => 'webcontainer'], ['kodety_agent_runtime' => 'webcontainer'], true, false, '', false],
    ['CMS', 'cms', ['kodety_agent_runtime' => 'webcontainer'], [], true, false, '', false],
    ['analytics', 'analytics', [], ['kodety_agent_runtime' => 'webcontainer'], true, false, '', false],
    ['shared context', 'editor', ['kodety_agent_runtime' => 'webcontainer'], [], true, true, '', false],
    ['shared route', 'settings', ['kodety_agent_runtime' => 'webcontainer'], [], true, false, 'share', false],
    ['missing AI capability', 'editor', ['kodety_agent_runtime' => 'webcontainer'], [], false, false, '', false],
];
foreach ($cases as [$name, $app, $query, $cookies, $can_ai, $shared, $share_token, $expected]) {
    $_GET = $query;
    $_COOKIE = $cookies;
    $browser_test_query = ['kodety_app' => $app, 'kodety_share' => $share_token];
    $browser_test_ai = $can_ai;
    $browser_test_shared = $shared;
    browser_runtime_check($plugin->browser_agent_runtime_requested() === $expected, $name);
}

$plugin_source = (string) file_get_contents(dirname(__DIR__) . '/kodety/includes/class-kodety-plugin.php');
$method = new ReflectionMethod(Kodety_Plugin::class, 'app_template');
$method_source = implode('', array_slice(explode("\n", $plugin_source), $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1));
browser_runtime_check(preg_match('/current_user_can\(\$required_capability\).*nocache_headers\(\);\s*if \(\$this->browser_agent_runtime_requested\(\) && !headers_sent\(\)\) \{\s*header\(\'Cross-Origin-Opener-Policy: same-origin\', true\);\s*header\(\'Cross-Origin-Embedder-Policy: credentialless\', true\);/s', $method_source) === 1, 'Isolation headers must follow authorization and apply only to the opted-in private shell.');
browser_runtime_check(substr_count($plugin_source, "header('Cross-Origin-Opener-Policy:") === 1 && substr_count($plugin_source, "header('Cross-Origin-Embedder-Policy:") === 1, 'No global or public isolation header hook.');

$shell = (string) file_get_contents(dirname(__DIR__) . '/kodety/templates/editor-shell.php');
browser_runtime_check(str_contains($shell, "'agentBrowser' => [") && str_contains($shell, "'selected' => \$browser_agent_runtime ? 'webcontainer' : 'server'") && str_contains($shell, "'userId' => get_current_user_id()"), 'Bootstrap exposes the server-selected runtime and current user identity.');
$start = strpos($shell, '$surface_url = static function');
$end = strpos($shell, "\n};", $start);
browser_runtime_check($start !== false && $end !== false, 'The shell retains its surface URL builder.');
$surface_builder = substr($shell, $start, $end - $start + 3);
foreach ([
    [true, true, false, 'editor', 'https://site.test/kodety/editor/?kodety_agent_runtime=webcontainer'],
    [true, true, false, 'settings', 'https://site.test/kodety/settings/?kodety_agent_runtime=webcontainer'],
    [false, true, false, 'editor', 'https://site.test/kodety/editor/?kodety_agent_runtime=server'],
    [false, false, false, 'editor', 'https://site.test/kodety/editor/'],
    [true, true, false, 'cms', 'https://site.test/kodety/cms/'],
    [true, true, true, 'editor', 'https://site.test/kodety/share/share/editor/'],
] as [$browser_agent_runtime, $preserve_agent_runtime_selection, $is_shared, $app, $expected]) {
    $share_token = 'share';
    eval($surface_builder);
    browser_runtime_check($surface_url($app) === $expected, 'Runtime query preservation stays scoped to private editor/settings navigation.');
}

echo "Browser Agent PHP: selection precedence, private surface isolation, bootstrap identity and navigation scope passed.\n";
