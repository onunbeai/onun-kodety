<?php

declare(strict_types=1);

/**
 * Isolated regression suite for Kodety Rocket's safety-critical runtime.
 *
 * It intentionally uses small WordPress stubs so the release can be checked
 * without mutating a real installation.
 */

$testRoot = rtrim(sys_get_temp_dir(), '/\\') . '/kodety-rocket-runtime-' . getmypid() . '-' . bin2hex(random_bytes(4));
foreach ([
    $testRoot . '/wordpress/wp-includes',
    $testRoot . '/wp-content/plugins/sample/assets/images',
    $testRoot . '/wp-content/themes/sample',
] as $directory) {
    if (!mkdir($directory, 0777, true) && !is_dir($directory)) {
        fwrite(STDERR, "FAIL: could not create isolated test directory.\n");
        exit(1);
    }
}

define('ABSPATH', $testRoot . '/wordpress/');
define('WP_CONTENT_DIR', $testRoot . '/wp-content');
define('WP_PLUGIN_DIR', $testRoot . '/wp-content/plugins');
define('WPINC', 'wp-includes');
define('AUTH_SALT', 'kodety-rocket-isolated-test-salt');
define('KODETY_ROCKET_VERSION', '1.0.0-test');
define('KODETY_ROCKET_LOG_DIR', $testRoot . '/logs');
define('DAY_IN_SECONDS', 86400);

$GLOBALS['kr_options'] = [];
$GLOBALS['kr_site_options'] = [];
$GLOBALS['kr_filters'] = [];
$GLOBALS['kr_conditionals'] = [];
$GLOBALS['kr_cron'] = [];
$GLOBALS['kr_transients'] = [];
$GLOBALS['kr_remote_requests'] = [];
$GLOBALS['kr_remote_responses'] = [];
$GLOBALS['kr_remote_interceptor'] = null;
$GLOBALS['kr_schedule_interceptor'] = null;
$GLOBALS['kr_update_option_interceptor'] = null;
$GLOBALS['kr_cache_deletes'] = [];
$GLOBALS['kr_is_multisite'] = true;
$GLOBALS['kr_current_blog_id'] = 1;
$GLOBALS['kr_current_network_id'] = 7;
$GLOBALS['kr_sites_by_network'] = [7 => [1]];
$GLOBALS['kr_get_sites_queries'] = [];
$GLOBALS['kr_blog_stack'] = [];
$GLOBALS['kr_scope_network_options'] = false;
$GLOBALS['kr_network_site_options'] = [];

final class WP_Error
{
    public function __construct(private string $code, private string $message = '')
    {
    }

    public function get_error_code(): string
    {
        return $this->code;
    }

    public function get_error_message(): string
    {
        return $this->message;
    }
}

final class KR_WPDB_Stub
{
    public string $options = 'wp_options';
    public string $sitemeta = 'wp_sitemeta';
    public int $siteid = 7;
    /** @var list<mixed> */
    public array $preparedArgs = [];
    public string $preparedQuery = '';
    public int|false $queryResult = 1;
    public string $last_error = '';
    public mixed $resultsInterceptor = null;

    public function prepare(string $query, mixed ...$args): string
    {
        $this->preparedQuery = $query;
        $this->preparedArgs = $args;

        return $query;
    }

    public function query(string $query): int|false
    {
        return $this->queryResult;
    }

    /** @return array<int, array<string, mixed>>|null */
    public function get_results(string $query, string $output = 'OBJECT'): ?array
    {
        if (is_callable($this->resultsInterceptor)) {
            $rows = ($this->resultsInterceptor)($query, $this->preparedArgs);

            return is_array($rows) ? $rows : null;
        }

        return [];
    }
}

function get_option(string $name, mixed $default = false): mixed
{
    return array_key_exists($name, $GLOBALS['kr_options']) ? $GLOBALS['kr_options'][$name] : $default;
}

function add_option(string $name, mixed $value, string $deprecated = '', mixed $autoload = null): bool
{
    if (array_key_exists($name, $GLOBALS['kr_options'])) {
        return false;
    }
    $GLOBALS['kr_options'][$name] = $value;

    return true;
}

function update_option(string $name, mixed $value, mixed $autoload = null): bool
{
    $interceptor = $GLOBALS['kr_update_option_interceptor'] ?? null;
    if (is_callable($interceptor)) {
        $result = $interceptor($name, $value, $autoload);
        if ($result !== null) {
            return (bool) $result;
        }
    }
    $GLOBALS['kr_options'][$name] = $value;

    return true;
}

function delete_option(string $name): bool
{
    unset($GLOBALS['kr_options'][$name]);

    return true;
}

function get_site_option(string $name, mixed $default = false): mixed
{
    if ((bool) ($GLOBALS['kr_scope_network_options'] ?? false)) {
        $networkId = (int) ($GLOBALS['kr_current_network_id'] ?? 1);

        return array_key_exists($name, $GLOBALS['kr_network_site_options'][$networkId] ?? [])
            ? $GLOBALS['kr_network_site_options'][$networkId][$name]
            : $default;
    }

    return array_key_exists($name, $GLOBALS['kr_site_options']) ? $GLOBALS['kr_site_options'][$name] : $default;
}

function update_site_option(string $name, mixed $value): bool
{
    if ((bool) ($GLOBALS['kr_scope_network_options'] ?? false)) {
        $networkId = (int) ($GLOBALS['kr_current_network_id'] ?? 1);
        $GLOBALS['kr_network_site_options'][$networkId][$name] = $value;

        return true;
    }

    $GLOBALS['kr_site_options'][$name] = $value;

    return true;
}

function add_site_option(string $name, mixed $value): bool
{
    if ((bool) ($GLOBALS['kr_scope_network_options'] ?? false)) {
        $networkId = (int) ($GLOBALS['kr_current_network_id'] ?? 1);
        if (array_key_exists($name, $GLOBALS['kr_network_site_options'][$networkId] ?? [])) {
            return false;
        }
        $GLOBALS['kr_network_site_options'][$networkId][$name] = $value;

        return true;
    }

    if (array_key_exists($name, $GLOBALS['kr_site_options'])) {
        return false;
    }
    $GLOBALS['kr_site_options'][$name] = $value;

    return true;
}

function delete_site_option(string $name): bool
{
    if ((bool) ($GLOBALS['kr_scope_network_options'] ?? false)) {
        $networkId = (int) ($GLOBALS['kr_current_network_id'] ?? 1);
        unset($GLOBALS['kr_network_site_options'][$networkId][$name]);

        return true;
    }

    unset($GLOBALS['kr_site_options'][$name]);

    return true;
}

function wp_cache_delete(string|int $key, string $group = ''): bool
{
    $GLOBALS['kr_cache_deletes'][] = ['key' => (string) $key, 'group' => $group];

    return true;
}

function get_current_blog_id(): int
{
    return max(1, (int) ($GLOBALS['kr_current_blog_id'] ?? 1));
}

function get_current_network_id(): int
{
    return max(1, (int) ($GLOBALS['kr_current_network_id'] ?? 1));
}

/** @return list<int> */
function get_sites(array $args = []): array
{
    $GLOBALS['kr_get_sites_queries'][] = $args;
    $networkId = isset($args['network_id']) ? (int) $args['network_id'] : 0;
    if ($networkId > 0) {
        $sites = $GLOBALS['kr_sites_by_network'][$networkId] ?? [];
    } else {
        $sites = [];
        foreach (($GLOBALS['kr_sites_by_network'] ?? []) as $networkSites) {
            if (is_array($networkSites)) {
                $sites = array_merge($sites, $networkSites);
            }
        }
    }
    $sites = array_values(array_map('intval', is_array($sites) ? $sites : []));
    $offset = max(0, (int) ($args['offset'] ?? 0));
    $number = max(1, (int) ($args['number'] ?? 100));

    return array_slice($sites, $offset, $number);
}

function switch_to_blog(int $blogId): bool
{
    $GLOBALS['kr_blog_stack'][] = get_current_blog_id();
    $GLOBALS['kr_current_blog_id'] = max(1, $blogId);
    $GLOBALS['kr_switched_blogs'][] = max(1, $blogId);

    return true;
}

function restore_current_blog(): bool
{
    if (($GLOBALS['kr_blog_stack'] ?? []) === []) {
        return false;
    }
    $GLOBALS['kr_current_blog_id'] = (int) array_pop($GLOBALS['kr_blog_stack']);

    return true;
}

function get_main_site_id(?int $networkId = null): int
{
    $networkId ??= get_current_network_id();
    $sites = $GLOBALS['kr_sites_by_network'][$networkId] ?? [];

    return isset($sites[0]) ? max(1, (int) $sites[0]) : 1;
}

function is_main_site(?int $siteId = null, ?int $networkId = null): bool
{
    $siteId ??= get_current_blog_id();

    return $siteId === get_main_site_id($networkId);
}

function is_multisite(): bool
{
    return (bool) ($GLOBALS['kr_is_multisite'] ?? false);
}

function home_url(string $path = ''): string
{
    return 'https://example.test/' . ltrim($path, '/');
}

function site_url(string $path = ''): string
{
    return 'https://example.test/' . ltrim($path, '/');
}

function content_url(string $path = ''): string
{
    return 'https://example.test/wp-content/' . ltrim($path, '/');
}

function plugins_url(string $path = ''): string
{
    return 'https://example.test/wp-content/plugins/' . ltrim($path, '/');
}

function includes_url(string $path = ''): string
{
    return 'https://example.test/wp-includes/' . ltrim($path, '/');
}

function get_stylesheet_directory(): string
{
    return WP_CONTENT_DIR . '/themes/sample';
}

function get_template_directory(): string
{
    return WP_CONTENT_DIR . '/themes/sample';
}

function wp_mkdir_p(string $directory): bool
{
    return is_dir($directory) || mkdir($directory, 0777, true);
}

function wp_json_encode(mixed $value, int $flags = 0, int $depth = 512): string|false
{
    return json_encode($value, $flags, $depth);
}

function sanitize_text_field(string $value): string
{
    return trim(strip_tags(preg_replace('/[\r\n\t]+/', ' ', $value) ?? ''));
}

function esc_url(string $value): string
{
    return filter_var($value, FILTER_SANITIZE_URL) ?: '';
}

function esc_attr(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function is_wp_error(mixed $value): bool
{
    return $value instanceof WP_Error;
}

function add_filter(string $hook, callable $callback, int $priority = 10, int $acceptedArgs = 1): bool
{
    $GLOBALS['kr_filters'][$hook][$priority][] = $callback;

    return true;
}

function apply_filters(string $hook, mixed $value, mixed ...$args): mixed
{
    $priorities = $GLOBALS['kr_filters'][$hook] ?? [];
    ksort($priorities, SORT_NUMERIC);
    foreach ($priorities as $callbacks) {
        foreach ($callbacks as $callback) {
            $value = $callback($value, ...$args);
        }
    }

    return $value;
}

function is_admin(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_admin'] ?? false);
}

function wp_doing_ajax(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['wp_doing_ajax'] ?? false);
}

function wp_doing_cron(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['wp_doing_cron'] ?? false);
}

function is_user_logged_in(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_user_logged_in'] ?? false);
}

function is_feed(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_feed'] ?? false);
}

function is_trackback(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_trackback'] ?? false);
}

function is_preview(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_preview'] ?? false);
}

function is_customize_preview(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_customize_preview'] ?? false);
}

function is_robots(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_robots'] ?? false);
}

function is_search(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['is_search'] ?? false);
}

function wp_is_mobile(): bool
{
    return (bool) ($GLOBALS['kr_conditionals']['wp_is_mobile'] ?? false);
}

function wp_next_scheduled(string $hook, array $args = []): int|false
{
    return $GLOBALS['kr_cron'][$hook] ?? false;
}

function wp_schedule_single_event(int $timestamp, string $hook, array $args = [], bool $wpError = false): bool|WP_Error
{
    $interceptor = $GLOBALS['kr_schedule_interceptor'] ?? null;
    if (is_callable($interceptor)) {
        $result = $interceptor($timestamp, $hook, $args, $wpError);
        if ($result !== null) {
            return $result;
        }
    }
    $GLOBALS['kr_cron'][$hook] = $timestamp;

    return true;
}

function wp_clear_scheduled_hook(string $hook): int
{
    $hadEvent = isset($GLOBALS['kr_cron'][$hook]);
    unset($GLOBALS['kr_cron'][$hook]);

    return $hadEvent ? 1 : 0;
}

function get_transient(string $name): mixed
{
    return $GLOBALS['kr_transients'][$name] ?? false;
}

function set_transient(string $name, mixed $value, int $expiration = 0): bool
{
    $GLOBALS['kr_transients'][$name] = $value;

    return true;
}

function delete_transient(string $name): bool
{
    unset($GLOBALS['kr_transients'][$name]);

    return true;
}

function wp_safe_remote_get(string $url, array $args = []): array
{
    $GLOBALS['kr_remote_requests'][] = ['url' => $url, 'args' => $args];

    $interceptor = $GLOBALS['kr_remote_interceptor'] ?? null;
    if (is_callable($interceptor)) {
        $interceptor($url, $args);
    }

    if ($GLOBALS['kr_remote_responses'] !== []) {
        $response = array_shift($GLOBALS['kr_remote_responses']);

        return is_array($response) ? $response : ['response' => ['code' => 500]];
    }

    return ['response' => ['code' => 200]];
}

function wp_remote_retrieve_response_code(mixed $response): int
{
    return is_array($response) ? (int) ($response['response']['code'] ?? 0) : 0;
}

function wp_remote_retrieve_header(mixed $response, string $name): string
{
    if (!is_array($response) || !isset($response['headers']) || !is_array($response['headers'])) {
        return '';
    }

    return is_scalar($response['headers'][strtolower($name)] ?? null)
        ? (string) $response['headers'][strtolower($name)]
        : '';
}

function get_posts(array $args = []): array
{
    return [];
}

function get_post_types(array $args = [], string $output = 'names'): array
{
    return ['post', 'page'];
}

function get_permalink(int $postId): string|false
{
    return false;
}

function kr_remove_tree(string $directory, string $allowedRoot): void
{
    $normalized = rtrim(str_replace('\\', '/', $directory), '/');
    $allowed = rtrim(str_replace('\\', '/', $allowedRoot), '/');
    if ($normalized === '' || $normalized === '/' || ($normalized !== $allowed && !str_starts_with($normalized, $allowed . '/'))) {
        return;
    }
    if (is_link($directory) || is_file($directory)) {
        @unlink($directory);

        return;
    }
    if (!is_dir($directory)) {
        return;
    }
    foreach (new FilesystemIterator($directory, FilesystemIterator::SKIP_DOTS) as $item) {
        kr_remove_tree($item->getPathname(), $allowedRoot);
    }
    @rmdir($directory);
}

register_shutdown_function(static function () use ($testRoot): void {
    kr_remove_tree($testRoot, $testRoot);
});

$pluginRoot = dirname(__DIR__);
require $pluginRoot . '/src/Support/Autoloader.php';
\KodetyRocket\Support\Autoloader::register();
require $pluginRoot . '/vendor-prefixed/autoload.php';

$assertions = 0;
function kr_assert(bool $condition, string $message): void
{
    global $assertions;
    ++$assertions;
    if ($condition) {
        return;
    }
    fwrite(STDERR, "FAIL: {$message}\n");
    exit(1);
}

function kr_reset_request(string $uri = '/article/'): void
{
    $_SERVER = [
        'REQUEST_METHOD' => 'GET',
        'REQUEST_URI' => $uri,
        'HTTP_HOST' => 'example.test',
        'HTTPS' => 'on',
        'SERVER_PORT' => '443',
        'HTTP_ACCEPT' => 'text/html,application/xhtml+xml',
        'HTTP_SEC_FETCH_DEST' => 'document',
        'HTTP_ACCEPT_ENCODING' => 'gzip, deflate',
    ];
    $_GET = [];
    $_POST = [];
    $_COOKIE = [];
    $GLOBALS['kr_conditionals'] = [];
}

use KodetyRocket\Cache\CacheEntry;
use KodetyRocket\Cache\CacheInvalidator;
use KodetyRocket\Cache\CacheKey;
use KodetyRocket\Cache\FileCacheStore;
use KodetyRocket\Admin\AdminPage;
use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Http\PageCacheController;
use KodetyRocket\Http\RequestGate;
use KodetyRocket\Http\ResponseGate;
use KodetyRocket\Optimization\DeferScripts;
use KodetyRocket\Optimization\LocalAssetMinifier;
use KodetyRocket\Optimization\Pipeline;
use KodetyRocket\Preload\Preloader;
use KodetyRocket\Settings\SettingsRepository;
use KodetyRocket\Support\Icons;
use KodetyRocket\Support\Translator;
use KodetyRocket\Lifecycle\Activator;
use KodetyRocket\Lifecycle\Uninstaller;

// Network-wide activation must never cross the current network boundary.
$activationOptions = $GLOBALS['kr_options'];
$activationSites = $GLOBALS['kr_sites_by_network'];
$GLOBALS['kr_current_blog_id'] = 1;
$GLOBALS['kr_current_network_id'] = 7;
$GLOBALS['kr_sites_by_network'] = [7 => [1, 2], 8 => [3, 4]];
$GLOBALS['kr_get_sites_queries'] = [];
$GLOBALS['kr_switched_blogs'] = [];
Activator::activate(true);
kr_assert(
    $GLOBALS['kr_switched_blogs'] === [1, 2]
    && get_current_blog_id() === 1
    && count($GLOBALS['kr_get_sites_queries']) === 1
    && ($GLOBALS['kr_get_sites_queries'][0]['network_id'] ?? null) === 7,
    'network activation should visit only sites in the current network and restore the original blog'
);
$GLOBALS['kr_options'] = $activationOptions;
$GLOBALS['kr_sites_by_network'] = $activationSites;
$GLOBALS['kr_get_sites_queries'] = [];
$GLOBALS['kr_switched_blogs'] = [];

// Settings are conservative, bounded, reversible and reject unknown keys.
$settings = new SettingsRepository();
$defaults = $settings->defaults();
kr_assert($defaults['page_cache_enabled'] === true, 'page cache should be the only primary optimization enabled by default');
kr_assert($defaults['minify_css_enabled'] === false && $defaults['defer_js_enabled'] === false, 'risky transformations should be opt-in');
kr_assert($defaults['locale'] === 'en_US' && $defaults['remove_data_on_uninstall'] === false, 'English and data retention should be safe defaults');
$sanitized = $settings->sanitize([
    'page_cache_enabled' => 'off',
    'minify_css_enabled' => 'yes',
    'page_cache_ttl' => 1,
    'max_response_bytes' => 999999999,
    'locale' => 'invalid',
    'ignored_query_parameters' => "utm_source\nBad value!\ngclid\nutm_source",
    'excluded_paths' => "checkout\nhttps://example.test/account/?x=1\n\0bad",
    'remove_data_on_uninstall' => '1',
    'unknown_setting' => 'discard me',
]);
kr_assert($sanitized['page_cache_enabled'] === false && $sanitized['minify_css_enabled'] === true, 'boolean settings should sanitize deterministically');
kr_assert($sanitized['page_cache_ttl'] === 60 && $sanitized['max_response_bytes'] === 20971520, 'numeric settings should be bounded');
kr_assert($sanitized['locale'] === 'en_US' && !isset($sanitized['unknown_setting']), 'invalid and unknown settings should not persist');
kr_assert($sanitized['ignored_query_parameters'] === ['gclid', 'utm_source'], 'query parameter lists should be normalized and deduplicated');
kr_assert($sanitized['remove_data_on_uninstall'] === true, 'explicit uninstall cleanup should sanitize as a boolean');

$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = $defaults;
$updated = $settings->update(['minify_css_enabled' => true]);
kr_assert(is_array($updated) && $updated['minify_css_enabled'] === true, 'settings update should persist verified data');
$settings->update(['minify_js_enabled' => true]);
$rolledBack = $settings->rollback();
kr_assert(is_array($rolledBack) && $rolledBack['minify_css_enabled'] === true && $rolledBack['minify_js_enabled'] === false, 'rollback should restore the last verified snapshot');

// The hand-authored interface catalogue must stay complete in all locales.
$catalogues = Translator::catalogues();
$englishKeys = array_keys($catalogues['en_US']);
foreach (['en_US', 'pt_BR', 'es_ES'] as $locale) {
    kr_assert(array_keys($catalogues[$locale]) === $englishKeys, "translation keys should match for {$locale}");
    kr_assert(!in_array('', $catalogues[$locale], true), "translations should not be empty for {$locale}");
}
kr_assert(Translator::normalize('pt-BR') === 'pt_BR' && Translator::normalize('unknown') === 'en_US', 'locale aliases should normalize with an English fallback');
kr_assert(Translator::get('missing.translation', 'es_ES') === 'missing.translation', 'missing translations should fail visibly and safely');

$sprite = Icons::sprite();
kr_assert(str_contains($sprite, 'id="kr-solar-speedometer"') && str_contains($sprite, 'id="kr-keyline-activity"'), 'the sprite should include Solar navigation and Keyline action symbols');
kr_assert(str_contains($sprite, 'M2 12H5L8 4L16 20L19 12H22'), 'Keyline activity geometry should match the official source package');
kr_assert(!str_contains(strtolower($sprite), '<script'), 'the static icon sprite should never contain executable markup');
kr_assert(str_contains(Icons::icon('unknown'), '#kr-keyline-info'), 'unknown icon names should fall back to a known safe symbol');

// Cache keys include all HTML-affecting dimensions and reject uncertainty.
$keyA = CacheKey::fromUrl(
    'https://Example.Test:443/article/?b=2&utm_source=campaign&a=1',
    1,
    ['utm_source'],
    ['a', 'b']
);
$keyB = CacheKey::fromUrl('https://example.test/article/?a=1&b=2', 1, [], ['a', 'b']);
kr_assert($keyA instanceof CacheKey && $keyB instanceof CacheKey, 'valid same-origin URLs should create cache keys');
kr_assert($keyA->canonicalUrl() === 'https://example.test/article/?a=1&b=2', 'cache URLs should normalize ports, tracking parameters and query order');
kr_assert($keyA->hash() === $keyB->hash(), 'equivalent URLs should produce the same immutable key');
kr_assert(CacheKey::fromUrl('https://example.test/article/?unknown=1', 1, [], []) === null, 'unknown query parameters should bypass caching');
kr_assert(CacheKey::fromUrl('https://user:pass@example.test/private') === null, 'credential-bearing URLs should never become cache keys');
$variantKey = $keyA->variant('device:desktop');
kr_assert($variantKey->hash() !== $keyA->hash() && $variantKey->variants() === ['device:desktop'], 'logical HTML variants should change the key');

kr_reset_request('/article/');
$_SERVER['REQUEST_METHOD'] = 'POST';
kr_assert(CacheKey::fromRequest() === null, 'unsafe HTTP methods should not create cache keys');

// Cache entries retain only safe representation metadata and detect corruption.
$createdAt = time() - 10;
$entry = new CacheEntry(
    '<!doctype html><html><body>' . str_repeat('Rocket ', 100) . '</body></html>',
    3600,
    ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'public, max-age=60'],
    200,
    $createdAt,
    ['Cookie'],
    'identity',
    ['site', 'post:7'],
    ['purpose' => 'runtime-test']
);
kr_assert($entry->isSharedCacheable() && $entry->header('ETag') !== null, 'a public HTML entry should be cacheable and have validators');
kr_assert($entry->header('Content-Length') === (string) strlen($entry->body()), 'cached content length should match the wire body');
$metadata = $entry->toMetadata();
$roundTrip = CacheEntry::fromMetadata($metadata, $entry->body());
kr_assert($roundTrip instanceof CacheEntry && $roundTrip->body() === $entry->body(), 'entry metadata should round-trip with its body digest');
kr_assert(CacheEntry::fromMetadata($metadata, $entry->body() . 'tampered') === null, 'a corrupted body should become a cache miss');
$privateEntry = new CacheEntry('<!doctype html><html><body>Private</body></html>', 60, ['Set-Cookie' => 'secret=1']);
kr_assert(!$privateEntry->isSharedCacheable() && $privateEntry->header('Set-Cookie') === null, 'Set-Cookie responses should be rejected and never replay the header');
$expiredEntry = new CacheEntry('<!doctype html><html><body>Old</body></html>', 1, [], 200, time() - 2);
kr_assert($expiredEntry->isExpired(), 'expired entries should be recognizable without I/O');

// Filesystem persistence is atomic, gzip-aware, scoped, purgeable and bounded.
$cacheRoot = $testRoot . '/cache';
$store = new FileCacheStore($cacheRoot, null, 100, 1048576, true, 6, 3, 1048576, 1000, 500, 8);
kr_assert($store->put($keyA, $entry), 'a safe cache entry should be written');
$identityHit = $store->get($keyA, 'identity');
$gzipHit = $store->get($keyA, 'gzip');
kr_assert($identityHit instanceof CacheEntry && $identityHit->body() === $entry->body(), 'identity cache reads should return the original body');
kr_assert($gzipHit instanceof CacheEntry && $gzipHit->encoding() === 'gzip' && gzdecode($gzipHit->body()) === $entry->body(), 'gzip cache reads should return a valid encoded variant');
$guardKey = CacheKey::fromUrl('https://example.test/guarded-entry/', 1);
kr_assert(
    $guardKey instanceof CacheKey
    && !$store->put($guardKey, $entry, static fn (): bool => false)
    && $store->get($guardKey) === null,
    'a write guard rejected under the global lock must leave no cache artifact'
);
kr_assert(
    $store->put($guardKey, $entry, static fn (): bool => true)
    && $store->get($guardKey, 'identity', static fn (): bool => false) === null
    && $store->get($guardKey) instanceof CacheEntry,
    'read/write generation guards should run under the cache safety lock without deleting valid data'
);
$store->delete($guardKey);
$stats = $store->stats(1);
kr_assert($stats['entries'] === 1 && $stats['variants'] >= 2 && $stats['bytes'] > 0, 'cache diagnostics should count logical entries and wire variants');

$identityPath = $cacheRoot . '/' . $keyA->relativePath() . '.html';
file_put_contents($identityPath, 'corrupt');
kr_assert($store->get($keyA, 'identity') === null, 'filesystem corruption should fail open as a cache miss');
kr_assert($store->put($keyA, $entry), 'a valid write should repair a corrupted immutable artifact');
$staleBrotli = $entry->withBodyAndEncoding('stale-brotli-generation', 'br');
kr_assert($store->put($keyA, $staleBrotli) && $store->get($keyA, 'br')?->encoding() === 'br', 'an explicit Brotli representation should be readable');
kr_assert($store->put($keyA, $entry) && !is_file($cacheRoot . '/' . $keyA->relativePath() . '.html.br'), 'refreshing identity should remove a stale Brotli generation');
kr_assert($store->purgeByTags(['post:7'], 1) === 1 && $store->get($keyA) === null, 'tag invalidation should remove every representation of a logical entry');

kr_assert($store->put($keyA, $entry), 'entry should be writable again after invalidation');
$assetSentinel = $cacheRoot . '/1/assets/keep.txt';
wp_mkdir_p(dirname($assetSentinel));
file_put_contents($assetSentinel, 'keep');
kr_assert($store->purgeAll(1) === 1, 'site purge should report the removed logical page entry');
kr_assert(is_file($assetSentinel), 'page-cache purge should preserve independently managed asset cache data');
foreach (['index.php', '.htaccess', 'web.config'] as $protectionFile) {
    kr_assert(is_file($cacheRoot . '/1/pages/' . $protectionFile), "page cache should retain {$protectionFile} protection after purge");
}

// A transient purge-lock conflict must keep cache reads disabled until a
// retry succeeds; a zero delete count alone is not a success signal.
kr_assert($store->put($keyA, $entry), 'entry should exist before the invalidation-lock probe');
$purgeLock = fopen($cacheRoot . '/.purge.lock', 'c+b');
kr_assert(is_resource($purgeLock) && flock($purgeLock, LOCK_EX | LOCK_NB), 'the invalidation-lock probe should own the global lock');
$invalidator = new CacheInvalidator($store, ['utm_source'], ['a', 'b'], null, true);
kr_assert($invalidator->purgeSite(1) === 0 && !$store->lastPurgeSucceeded(), 'lock contention should be reported separately from an empty purge');
kr_assert((bool) get_option(CacheInvalidator::PENDING_OPTION, false), 'a failed invalidation should set the cache-bypass marker');
kr_assert(isset($GLOBALS['kr_cron'][CacheInvalidator::RETRY_SITE_HOOK]), 'a failed invalidation should schedule a bounded retry');
flock($purgeLock, LOCK_UN);
fclose($purgeLock);
$invalidator->retrySitePurge(1);
kr_assert($store->lastPurgeSucceeded() && !get_option(CacheInvalidator::PENDING_OPTION, false), 'a successful retry should clear the cache-bypass marker');
kr_assert($store->get($keyA) === null, 'the successful retry should remove the formerly locked cache entry');

// Two mutations handled by one invalidator instance must each purge. A public
// request can refill cache between hooks in the same WordPress request.
$repeatKey = CacheKey::fromUrl('https://example.test/repeated-mutation/', 1);
kr_assert($repeatKey instanceof CacheKey && $store->put($repeatKey, $entry), 'the repeated-mutation probe should create its first entry');
$invalidator->purgeSite(1);
kr_assert($store->put($repeatKey, $entry), 'cache can be refilled between two mutations in one request');
$invalidator->purgeSite(1);
kr_assert($store->get($repeatKey) === null, 'a second mutation in the same request must not be suppressed as already purged');

// Never follow a site-root symlink while writing or purging cache data.
$outsideCache = $testRoot . '/outside-cache';
wp_mkdir_p($outsideCache);
$outsideSentinel = $outsideCache . '/sentinel.txt';
file_put_contents($outsideSentinel, 'outside');
if (function_exists('symlink') && @symlink($outsideCache, $cacheRoot . '/2')) {
    $symlinkKey = CacheKey::fromUrl('https://example.test/symlink-probe/', 2);
    kr_assert($symlinkKey instanceof CacheKey && !$store->put($symlinkKey, $entry), 'cache writes should reject a symlinked site directory');
    $store->purgeAll(2);
    kr_assert(!$store->lastPurgeSucceeded() && file_get_contents($outsideSentinel) === 'outside', 'cache purge should reject a symlink without touching its target');
}

$quotaStore = new FileCacheStore($testRoot . '/quota-cache', null, 100, 1048576, false, 6, 2, 1048576, 1000, 500, 8);
$quotaKeys = [];
for ($index = 1; $index <= 3; ++$index) {
    $quotaKey = CacheKey::fromUrl('https://example.test/quota-' . $index . '/');
    kr_assert($quotaKey instanceof CacheKey, 'quota test key should be valid');
    $quotaKeys[] = $quotaKey;
    kr_assert($quotaStore->put($quotaKey, new CacheEntry('<!doctype html><html><body>' . str_repeat((string) $index, 2000) . '</body></html>')), 'quota test entry should write');
}
$quotaStats = $quotaStore->stats(1);
kr_assert($quotaStats['entries'] <= 2 && $quotaStore->get($quotaKeys[2]) instanceof CacheEntry, 'per-site quota should evict old entries while preserving the incoming one');

// Request and response gates are deliberately biased toward false negatives.
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = $defaults;
$requestGate = new RequestGate($settings);
kr_reset_request('/article/');
kr_assert($requestGate->shouldCache() && $requestGate->lastReason() === 'eligible', 'a public document GET should pass the request gate');
$_COOKIE['session_variant'] = 'A';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'private_credentials', 'an unknown cookie should bypass shared caching');
kr_reset_request('/article/');
$_COOKIE['_ga'] = 'GA1.2.test';
kr_assert($requestGate->shouldCache(), 'a known analytics cookie should not destroy public cacheability');
kr_reset_request('/article/?utm_source=test');
$_GET = ['utm_source' => 'test'];
kr_assert($requestGate->shouldCache(), 'configured tracking parameters should be ignored');
kr_assert(!$requestGate->shouldWriteCache() && $requestGate->lastReason() === 'ignored_query_write', 'a tracking URL may read the clean key but must never populate it');
kr_reset_request('/article/?preview_token=secret');
$_GET = ['preview_token' => 'secret'];
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'query_not_allowed', 'unknown query values should bypass caching');
kr_reset_request('/article/');
$_SERVER['HTTP_CACHE_CONTROL'] = 'max-age=0, no-cache';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'client_no_cache', 'a client refresh request should bypass cache reads and writes');
kr_reset_request('/article/');
$_SERVER['HTTP_CACHE_CONTROL'] = 'max-age=120, min-fresh=30';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'client_no_cache', 'unsupported client freshness constraints should bypass the cache conservatively');
kr_reset_request('/article/');
$_SERVER['HTTP_RANGE'] = 'bytes=0-99';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'range_request', 'range requests should bypass the page cache');
kr_reset_request('/article/');
$_SERVER['HTTP_ACCEPT'] = 'application/json';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'representation_not_html', 'non-HTML representations should bypass before rendering');
kr_reset_request('/article/');
$_SERVER['HTTP_ACCEPT'] = 'text/html;q=0, application/json;q=1, */*;q=1';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'representation_not_html', 'an explicit HTML q=0 should override a less-specific wildcard');
kr_reset_request('/article/');
$_SERVER['HTTP_ACCEPT_ENCODING'] = 'identity;q=0, gzip;q=0';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'representation_encoding_not_acceptable', 'a request forbidding every supported encoding should bypass');
kr_reset_request('/article/');
$_SERVER['HTTP_IF_MATCH'] = '"different-validator"';
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'unsupported_precondition', 'unsupported state-changing preconditions should be delegated to the origin');
kr_reset_request('/article/');
$GLOBALS['kr_options'][CacheInvalidator::PENDING_OPTION] = time();
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'invalidation_pending', 'a failed purge marker should disable cache reads and writes');
delete_option(CacheInvalidator::PENDING_OPTION);
kr_reset_request('/search/');
$GLOBALS['kr_conditionals']['is_search'] = true;
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'special_response', 'search pages should bypass caching');
kr_reset_request('/article/');
$_SERVER['HTTP_ACCEPT_ENCODING'] = 'gzip;q=0, *;q=1';
kr_assert(!$requestGate->acceptsGzip(), 'an explicit gzip q=0 should override a wildcard');
$_SERVER['HTTP_ACCEPT_ENCODING'] = 'br, *;q=0.5';
kr_assert($requestGate->acceptsGzip(), 'a positive wildcard should allow gzip when it is not explicitly excluded');

$responseGate = new ResponseGate($settings);
$html = '<!doctype html><html><head><title>Safe</title></head><body>Public</body></html>';
kr_assert($responseGate->shouldCache($html, 200, ['Content-Type: text/html; charset=UTF-8']), 'a public HTML response should pass the response gate');
kr_assert(!$responseGate->shouldCache('{"ok":true}', 200, ['Content-Type: application/json']), 'JSON should never enter the page cache');
kr_assert(!$responseGate->shouldCache($html, 200, ['Content-Type: text/html', 'Set-Cookie: account=1']), 'responses setting cookies should bypass');
kr_assert(!$responseGate->shouldCache($html, 200, ['Content-Type: text/html', 'Cache-Control: private, no-store']), 'private origin cache policies should be respected');
kr_assert(!$responseGate->shouldCache($html, 200, ['Content-Type: text/html', 'CDN-Cache-Control: no-store']), 'private CDN cache policies should be respected');
kr_assert(!$responseGate->shouldCache($html, 200, ['Content-Type: text/html', 'Location: /login/']), 'redirect headers should never enter a cached 200 response');
kr_assert(!$responseGate->shouldCache($html, 200, ['Content-Type: text/html', 'Vary: X-Customer']), 'unkeyed Vary dimensions should bypass');
kr_assert(!$responseGate->shouldCache($html, 200, ["Content-Type: text/html", "Content-Security-Policy: script-src 'nonce-secret'"]), 'per-request CSP nonces should bypass');
kr_assert(!$responseGate->shouldTransform($html, 200, ['Content-Type: text/html', 'Cache-Control: no-transform']), 'no-transform should disable HTML rewrites');
kr_assert($responseGate->shouldCache($html, 200, ['Content-Type: text/html', 'Cache-Control: no-transform']), 'no-transform should remain cacheable when its directive is preserved');
$storedHeaders = ['Content-Type' => 'text/html', 'Cache-Control' => 'public, max-age=300', 'Vary' => 'Cookie, Authorization, Accept-Encoding'];
kr_assert($responseGate->shouldServeCached(200, $storedHeaders, true), 'a stored response should accept only the built-in keyed Vary dimensions');
$storedHeaders['Vary'] .= ', X-Customer';
kr_assert(!$responseGate->shouldServeCached(200, $storedHeaders, true), 'a stored response with an unkeyed Vary dimension should become a miss');
kr_assert(!$responseGate->shouldServeCached(404, ['Content-Type' => 'text/html']), 'a current non-200 WordPress decision should block a cache hit');
$GLOBALS['kr_site_options'][CacheInvalidator::NETWORK_PENDING_OPTION] = time();
kr_reset_request('/article/');
kr_assert(!$requestGate->shouldCache() && $requestGate->lastReason() === 'invalidation_pending', 'a network purge marker should bypass cache on every site');
delete_site_option(CacheInvalidator::NETWORK_PENDING_OPTION);
$safeHeaders = $responseGate->cacheableHeaders(['Content-Type: text/html', 'X-Frame-Options: SAMEORIGIN', 'Server: secret', 'Set-Cookie: x=1']);
kr_assert(isset($safeHeaders['Content-Type'], $safeHeaders['X-Frame-Options']) && !isset($safeHeaders['Server'], $safeHeaders['Set-Cookie']), 'only allowlisted response metadata should be replayed');

// A failing transformer cannot poison the response or stop later transforms.
$silentLogger = new Logger($settings);
$pipeline = new Pipeline($silentLogger);
$pipeline
    ->add(static fn (string $value): string => $value . '<!--first-->', 10)
    ->add(static function (string $value): string {
        throw new RuntimeException('intentional test failure');
    }, 20)
    ->add(static fn (string $value): string => $value . '<!--last-->', 30);
$pipelineResult = $pipeline->process($html);
kr_assert(str_ends_with($pipelineResult, '<!--first--><!--last-->'), 'pipeline transforms should remain ordered and independently fail open');

// Cache generations make an invalidation linearizable with late response
// writes. Failed selective deletion leaves a dead file, never a servable HIT.
kr_reset_request('/generation-stale/');
$generationStore = new FileCacheStore($testRoot . '/generation-cache', null, 100, 1048576, true, 6, 20, 1048576, 1000, 500, 8);
$generationKey = CacheKey::fromUrl('https://example.test/generation-stale/', 1);
$generationBefore = CacheInvalidator::generationSnapshot(1);
$generationEntry = new CacheEntry(
    $html,
    3600,
    ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'public, max-age=60'],
    200,
    null,
    ['Cookie', 'Authorization', 'Accept-Encoding'],
    'identity',
    ['site'],
    ['cache_generation' => $generationBefore]
);
kr_assert($generationKey instanceof CacheKey && $generationStore->put($generationKey, $generationEntry), 'the generation probe should persist a versioned entry');
$generationPurgeLock = fopen($generationStore->baseDirectory() . '/.purge.lock', 'c+b');
kr_assert(is_resource($generationPurgeLock) && flock($generationPurgeLock, LOCK_EX | LOCK_NB), 'the selective-generation probe should hold the cache lock');
$generationInvalidator = new CacheInvalidator($generationStore);
$generationInvalidator->purgeUrl('https://example.test/generation-stale/', 1);
flock($generationPurgeLock, LOCK_UN);
fclose($generationPurgeLock);
$physicallyStaleEntry = $generationStore->get($generationKey);
$generationController = new PageCacheController(
    $settings,
    $generationStore,
    new RequestGate($settings),
    new ResponseGate($settings),
    new Pipeline($silentLogger),
    $silentLogger
);
$entryGenerationIsCurrent = new ReflectionMethod(PageCacheController::class, 'entryGenerationIsCurrent');
$entryGenerationIsCurrent->setAccessible(true);
kr_assert(
    $physicallyStaleEntry instanceof CacheEntry
    && $entryGenerationIsCurrent->invoke($generationController, $physicallyStaleEntry, $generationKey) === false,
    'a failed selective delete may leave bytes on disk but their old generation must never be served'
);
$currentGeneration = CacheInvalidator::generationSnapshot(1);
$currentGenerationEntry = new CacheEntry($html, 3600, [], 200, null, [], 'identity', [], ['cache_generation' => $currentGeneration]);
$legacyGenerationEntry = new CacheEntry($html);
kr_assert(
    $entryGenerationIsCurrent->invoke($generationController, $currentGenerationEntry, $generationKey) === true
    && $entryGenerationIsCurrent->invoke($generationController, $legacyGenerationEntry, $generationKey) === false,
    'only entries carrying the exact current generation should be eligible for a HIT'
);

// A response that began in an older generation cannot populate the cache,
// even if it finishes after the purge and all ordinary response gates pass.
kr_reset_request('/late-generation-write/');
$lateKey = CacheKey::fromUrl('https://example.test/late-generation-write/', 1)?->variant('device:desktop');
$lateGeneration = CacheInvalidator::generationSnapshot(1);
$lateController = new PageCacheController(
    $settings,
    $generationStore,
    new RequestGate($settings),
    new ResponseGate($settings),
    new Pipeline($silentLogger),
    $silentLogger
);
$requestKeyProperty = new ReflectionProperty(PageCacheController::class, 'requestKey');
$cacheEligibleProperty = new ReflectionProperty(PageCacheController::class, 'cacheEligible');
$cacheGenerationProperty = new ReflectionProperty(PageCacheController::class, 'cacheGeneration');
$requestKeyProperty->setAccessible(true);
$cacheEligibleProperty->setAccessible(true);
$cacheGenerationProperty->setAccessible(true);
$requestKeyProperty->setValue($lateController, $lateKey);
$cacheEligibleProperty->setValue($lateController, true);
$cacheGenerationProperty->setValue($lateController, $lateGeneration);
CacheInvalidator::rotateSiteGeneration(1);
$lateController->processResponse($html);
kr_assert($lateKey instanceof CacheKey && $generationStore->get($lateKey) === null, 'a late response from an invalidated generation must fail its write CAS');

// Manual admin purges must use the same generation/marker protocol as content
// hooks. A zero delete count is successful only for a physically empty cache.
kr_reset_request('/admin-manual-purge/');
$adminPurgeKey = CacheKey::fromUrl('https://example.test/admin-manual-purge/', 1);
$adminPurgeGeneration = CacheInvalidator::generationSnapshot(1);
$adminPurgeEntry = new CacheEntry(
    $html,
    3600,
    ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'public, max-age=60'],
    200,
    null,
    ['Cookie', 'Authorization', 'Accept-Encoding'],
    'identity',
    ['site'],
    ['cache_generation' => $adminPurgeGeneration]
);
$adminInvalidator = new CacheInvalidator($generationStore);
$adminPage = new AdminPage(
    $settings,
    $generationStore,
    $silentLogger,
    new Preloader($settings, $generationStore, $silentLogger),
    $adminInvalidator
);
$adminPurge = new ReflectionMethod(AdminPage::class, 'purgeCache');
$adminPurge->setAccessible(true);
kr_assert(
    $adminPurgeKey instanceof CacheKey
    && $generationStore->put($adminPurgeKey, $adminPurgeEntry)
    && is_int($adminPurge->invoke($adminPage))
    && CacheInvalidator::generationSnapshot(1) !== $adminPurgeGeneration
    && $generationStore->get($adminPurgeKey) === null,
    'a manual admin purge should rotate generation and physically remove the site cache'
);
kr_assert(
    !$generationStore->put(
        $adminPurgeKey,
        $adminPurgeEntry,
        static fn (): bool => hash_equals($adminPurgeGeneration, CacheInvalidator::generationSnapshot(1))
    ),
    'a response captured before a manual purge must fail its late-write generation guard'
);

$lockedAdminGeneration = CacheInvalidator::generationSnapshot(1);
$lockedAdminEntry = new CacheEntry($html, 3600, [], 200, null, [], 'identity', [], ['cache_generation' => $lockedAdminGeneration]);
kr_assert($generationStore->put($adminPurgeKey, $lockedAdminEntry), 'the failed manual-purge probe should create an entry');
$adminPurgeLock = fopen($generationStore->baseDirectory() . '/.purge.lock', 'c+b');
kr_assert(is_resource($adminPurgeLock) && flock($adminPurgeLock, LOCK_EX | LOCK_NB), 'the failed manual-purge probe should own the global cache lock');
kr_assert(
    $adminPurge->invoke($adminPage) === false
    && !$generationStore->lastPurgeSucceeded()
    && (bool) get_option(CacheInvalidator::PENDING_OPTION, false)
    && isset($GLOBALS['kr_cron'][CacheInvalidator::RETRY_SITE_HOOK]),
    'a physically blocked manual purge should report failure and retain its retry marker'
);
flock($adminPurgeLock, LOCK_UN);
fclose($adminPurgeLock);
$adminInvalidator->retrySitePurge(1);
kr_assert(
    $generationStore->lastPurgeSucceeded()
    && !get_option(CacheInvalidator::PENDING_OPTION, false)
    && $generationStore->get($adminPurgeKey) === null,
    'the manual-purge retry should clear its marker only after physical success'
);

// The request gate is checked again immediately before persistence, not only
// when buffering starts.
kr_reset_request('/late-private-write/');
$privateLateKey = CacheKey::fromUrl('https://example.test/late-private-write/', 1)?->variant('device:desktop');
$privateLateController = new PageCacheController(
    $settings,
    $generationStore,
    new RequestGate($settings),
    new ResponseGate($settings),
    new Pipeline($silentLogger),
    $silentLogger
);
$requestKeyProperty->setValue($privateLateController, $privateLateKey);
$cacheEligibleProperty->setValue($privateLateController, true);
$cacheGenerationProperty->setValue($privateLateController, CacheInvalidator::generationSnapshot(1));
$_COOKIE['session_became_private'] = '1';
$privateLateController->processResponse($html);
kr_assert($privateLateKey instanceof CacheKey && $generationStore->get($privateLateKey) === null, 'a request that becomes private before the callback must not populate shared cache');

// Cached HTML must not replace an upstream output buffer, even while that
// buffer is still empty.
kr_reset_request('/buffered-hit/');
$bufferedKey = CacheKey::fromUrl('https://example.test/buffered-hit/', 1)?->variant('device:desktop');
$bufferedGeneration = CacheInvalidator::generationSnapshot(1);
$bufferedEntry = new CacheEntry(
    $html,
    3600,
    ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'public, max-age=60'],
    200,
    null,
    ['Cookie', 'Authorization', 'Accept-Encoding'],
    'identity',
    ['site'],
    ['cache_generation' => $bufferedGeneration]
);
kr_assert($bufferedKey instanceof CacheKey && $generationStore->put($bufferedKey, $bufferedEntry), 'the output-buffer probe should create a valid page-cache HIT');
$bufferedController = new PageCacheController(
    $settings,
    $generationStore,
    new RequestGate($settings),
    new ResponseGate($settings),
    new Pipeline($silentLogger),
    $silentLogger
);
$bufferGuardReturned = false;
register_shutdown_function(static function () use (&$bufferGuardReturned): void {
    if (!$bufferGuardReturned) {
        fwrite(STDERR, "FAIL: a cache HIT exited through an existing output buffer.\n");
        exit(1);
    }
});
$bufferBaseLevel = ob_get_level();
ob_start();
$bufferedController->maybeServe();
$bufferGuardReturned = true;
while (ob_get_level() > $bufferBaseLevel) {
    ob_end_clean();
}
kr_assert(true, 'a cache HIT should return control when any upstream output buffer is active');

// Selective defer must avoid WordPress' sensitive script classes.
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['defer_js_enabled' => true]);
kr_reset_request('/article/');
$defer = new DeferScripts($settings, new RequestGate($settings));
$plainTag = '<script src="https://example.test/wp-content/plugins/sample/app.js"></script>';
kr_assert(str_contains($defer->filter($plainTag, 'sample-app'), 'defer="defer"'), 'eligible scripts should receive defer');
kr_assert($defer->filter($plainTag, 'jquery-core') === $plainTag, 'jQuery should remain blocking');
$moduleTag = '<script type="module" src="https://example.test/module.js"></script>';
kr_assert($defer->filter($moduleTag, 'module-app') === $moduleTag, 'module scripts should retain native execution semantics');

// Local asset minification only rewrites safe, same-origin, non-SRI files.
$assetDirectory = WP_PLUGIN_DIR . '/sample/assets';
$cssSource = $assetDirectory . '/site.css';
$nestedCss = $assetDirectory . '/nested.css';
$jsSource = $assetDirectory . '/site.js';
file_put_contents($nestedCss, ".nested { color: blue; }\n");
file_put_contents(
    $cssSource,
    '/* ' . str_repeat('removable development comment ', 30) . " */\n@import url(\"nested.css\");\n.hero { color: red; padding: 10px  20px; background-image: url(\"images/bg.png\"); }\n"
);
file_put_contents(
    $jsSource,
    '/* ' . str_repeat('removable development comment ', 30) . " */\nfunction launchRocket() {\n    const message = 'ready';\n    return message + ' now';\n}\nwindow.launchRocket = launchRocket;\n"
);
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, [
    'minify_css_enabled' => true,
    'minify_js_enabled' => true,
]);
kr_reset_request('/article/');
$minifier = new LocalAssetMinifier($settings, $silentLogger, new RequestGate($settings));
$styleTag = '<link rel="stylesheet" href="https://example.test/wp-content/plugins/sample/assets/site.css">';
$scriptTag = '<script src="https://example.test/wp-content/plugins/sample/assets/site.js"></script>';
$minifiedStyleTag = $minifier->filterStyleTag($styleTag, 'sample-style');
$minifiedScriptTag = $minifier->filterScriptTag($scriptTag, 'sample-script');
kr_assert($minifiedStyleTag !== $styleTag && str_contains($minifiedStyleTag, '/cache/kodety-rocket/1/assets/css/'), 'eligible local CSS should point at an immutable minified copy');
kr_assert($minifiedScriptTag !== $scriptTag && str_contains($minifiedScriptTag, '/cache/kodety-rocket/1/assets/js/'), 'eligible local JavaScript should point at an immutable minified copy');
$generatedCss = glob(WP_CONTENT_DIR . '/cache/kodety-rocket/1/assets/css/*.min.css') ?: [];
kr_assert(count($generatedCss) === 1, 'CSS minification should produce one immutable artifact');
$generatedCssBody = file_get_contents($generatedCss[0]);
kr_assert(is_string($generatedCssBody) && str_contains($generatedCssBody, '@import') && !str_contains($generatedCssBody, 'data:'), 'CSS imports should stay external and local files should never be embedded as data URIs');

// A reused immutable asset renews its lease. Automatic maintenance may only
// remove a lease older than the maximum page-cache TTL plus a wide margin.
$assetStaleTime = time() - 2592100;
touch($generatedCss[0], $assetStaleTime);
clearstatcache(true, $generatedCss[0]);
$leasedStyleTag = $minifier->filterStyleTag($styleTag, 'sample-style');
$leasedModified = filemtime($generatedCss[0]);
kr_assert(
    $leasedStyleTag === $minifiedStyleTag
    && is_int($leasedModified)
    && $leasedModified > $assetStaleTime,
    'reusing an immutable asset should renew its last-use lease under its persistent lock'
);
$freshPrune = \KodetyRocket\Optimization\AssetCacheMaintenance::prune(1);
kr_assert(
    is_file($generatedCss[0]) && $freshPrune['removed'] === 0,
    'automatic maintenance must preserve assets newer than the page-cache retention margin'
);

// Maintenance must never unlink an asset or replace its lock inode while a
// builder/consumer owns that lock. Once idle and older than the margin, only
// the immutable asset is removed; its persistent lock remains stable.
touch($generatedCss[0], $assetStaleTime);
$generatedCssLock = $generatedCss[0] . '.lock';
$heldAssetLock = fopen($generatedCssLock, 'c+b');
$assetLockInode = fileinode($generatedCssLock);
kr_assert(
    is_resource($heldAssetLock)
    && is_int($assetLockInode)
    && flock($heldAssetLock, LOCK_EX | LOCK_NB),
    'the asset-maintenance contention probe should own the persistent lock'
);
\KodetyRocket\Optimization\AssetCacheMaintenance::prune(1);
clearstatcache(true, $generatedCss[0]);
clearstatcache(true, $generatedCssLock);
kr_assert(
    is_file($generatedCss[0])
    && is_file($generatedCssLock)
    && fileinode($generatedCssLock) === $assetLockInode,
    'prune should preserve a busy asset and the exact lock inode coordinating its builders'
);
flock($heldAssetLock, LOCK_UN);
fclose($heldAssetLock);
\KodetyRocket\Optimization\AssetCacheMaintenance::prune(1);
clearstatcache(true, $generatedCss[0]);
clearstatcache(true, $generatedCssLock);
kr_assert(
    !is_file($generatedCss[0])
    && is_file($generatedCssLock)
    && fileinode($generatedCssLock) === $assetLockInode,
    'prune may remove an expired idle asset but must retain its stable lock inode'
);

// Quotas are soft when every candidate is recent: functionality wins over
// reclaiming space that may still be referenced by cached HTML. A sparse test
// fixture crosses the byte quota without consuming that amount of disk.
$freshQuotaAsset = dirname($generatedCss[0]) . '/' . str_repeat('a', 64) . '.min.css';
$freshQuotaHandle = fopen($freshQuotaAsset, 'w+b');
$freshQuotaSized = is_resource($freshQuotaHandle) && ftruncate($freshQuotaHandle, 268435457);
if (is_resource($freshQuotaHandle)) {
    fclose($freshQuotaHandle);
}
touch($freshQuotaAsset);
$quotaPrune = \KodetyRocket\Optimization\AssetCacheMaintenance::prune(1);
kr_assert(
    $freshQuotaSized
    && $quotaPrune['bytes'] > 268435456
    && $quotaPrune['removed'] === 0
    && is_file($freshQuotaAsset),
    'asset quota pressure must preserve every recently leased dependency'
);

$generatedJs = glob(WP_CONTENT_DIR . '/cache/kodety-rocket/1/assets/js/*.min.js') ?: [];
$generatedJsLock = isset($generatedJs[0]) ? $generatedJs[0] . '.lock' : '';
$heldPurgeLock = $generatedJsLock !== '' ? fopen($generatedJsLock, 'c+b') : false;
kr_assert(
    isset($generatedJs[0])
    && is_resource($heldPurgeLock)
    && flock($heldPurgeLock, LOCK_EX | LOCK_NB)
    && !\KodetyRocket\Optimization\AssetCacheMaintenance::purge(1)
    && is_file($generatedJs[0]),
    'explicit asset purge should fail open without removing an asset owned by another worker'
);
flock($heldPurgeLock, LOCK_UN);
fclose($heldPurgeLock);
kr_assert(
    \KodetyRocket\Optimization\AssetCacheMaintenance::purge(1)
    && !is_file($generatedJs[0])
    && is_file($generatedJsLock),
    'explicit purge should remove the idle asset while preserving its persistent lock'
);

$externalTag = '<script src="https://cdn.example.test/app.js"></script>';
kr_assert($minifier->filterScriptTag($externalTag, 'external') === $externalTag, 'external assets should remain untouched');
$sriTag = '<script src="https://example.test/wp-content/plugins/sample/assets/site.js" integrity="sha384-test"></script>';
kr_assert($minifier->filterScriptTag($sriTag, 'sample-sri') === $sriTag, 'SRI-protected assets should remain untouched');
$nonceTag = '<script nonce="request-secret" src="https://example.test/wp-content/plugins/sample/assets/site.js"></script>';
kr_assert($minifier->filterScriptTag($nonceTag, 'sample-nonce') === $nonceTag, 'nonce-bearing assets should remain untouched');
$jqueryTag = '<script src="https://example.test/wp-includes/js/jquery/jquery.js"></script>';
kr_assert($minifier->filterScriptTag($jqueryTag, 'jquery') === $jqueryTag, 'jQuery should not be minified or rewritten');

$assetRoot = WP_CONTENT_DIR . '/cache/kodety-rocket/1/assets';
$outsideAssetRoot = $testRoot . '/outside-assets';
wp_mkdir_p($outsideAssetRoot);
$outsideAssetSentinel = $outsideAssetRoot . '/sentinel.txt';
file_put_contents($outsideAssetSentinel, 'outside');
\KodetyRocket\Optimization\AssetCacheMaintenance::purge(1);
// Persistent lock files intentionally keep the cache root alive. The isolated
// test removes that now-idle fixture before replacing the root with a symlink.
kr_remove_tree($assetRoot, WP_CONTENT_DIR);
if (function_exists('symlink') && @symlink($outsideAssetRoot, $assetRoot)) {
    $symlinkedAssetTag = '<script src="https://example.test/wp-content/plugins/sample/assets/site.js?symlink-probe=1"></script>';
    kr_assert($minifier->filterScriptTag($symlinkedAssetTag, 'sample-symlink') === $symlinkedAssetTag, 'asset generation should reject a symlinked cache root');
    kr_assert(file_get_contents($outsideAssetSentinel) === 'outside', 'asset-cache rejection should never touch the symlink target');
}

// Diagnostics are opt-in, private and scrub credentials and filesystem paths.
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['diagnostics_enabled' => true]);
$logger = new Logger($settings);
$logger->warning('Request failed at /Users/private/site/plugin.php', [
    'token' => 'super-secret-token',
    'absolute_path' => '/Users/private/site/plugin.php',
    'url' => 'https://example.test/article/?secret=value',
    'ip' => '192.168.1.10',
]);
$records = $logger->recent(5);
$encodedRecords = json_encode($records, JSON_UNESCAPED_SLASHES);
kr_assert(count($records) === 1 && is_string($encodedRecords), 'enabled diagnostics should create readable JSONL records');
kr_assert(!str_contains($encodedRecords, 'super-secret-token') && !str_contains($encodedRecords, '/Users/private'), 'diagnostics should redact tokens and absolute paths');
kr_assert(str_contains($encodedRecords, '[redacted]') && str_contains($encodedRecords, 'sha256:'), 'diagnostics should make redaction explicit and hash IP addresses');
kr_assert($logger->purgeStorage() && !is_dir(dirname($logger->path())), 'diagnostic purge should remove only its site-scoped leaf directory');

$logLeaf = dirname($logger->path());
$outsideLogRoot = $testRoot . '/outside-logs';
wp_mkdir_p(dirname($logLeaf));
wp_mkdir_p($outsideLogRoot);
$outsideLogSentinel = $outsideLogRoot . '/sentinel.txt';
file_put_contents($outsideLogSentinel, 'outside');
if (function_exists('symlink') && @symlink($outsideLogRoot, $logLeaf)) {
    $logger->warning('This record must not cross the storage boundary.');
    kr_assert($logger->recent(5) === [], 'diagnostics should refuse to read through a symlinked site directory');
    kr_assert(file_get_contents($outsideLogSentinel) === 'outside', 'diagnostics should never write through a symlinked site directory');
}

// Preload accepts only canonical same-origin URLs and uses WordPress' safe client.
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['preload_enabled' => true]);
$GLOBALS['kr_cron'] = [];
$preloader = new Preloader($settings, $store, $silentLogger);
kr_assert(!$preloader->schedule(['https://evil.example/path']), 'cross-origin preload URLs should be rejected');
kr_assert($preloader->schedule(['https://example.test/article/#fragment']), 'a same-origin preload URL should schedule a bounded batch');
$preloader->run();
kr_assert(count($GLOBALS['kr_remote_requests']) === 1, 'the preload worker should request one queued URL');
$preloadRequest = $GLOBALS['kr_remote_requests'][0];
kr_assert($preloadRequest['url'] === 'https://example.test/article/' && ($preloadRequest['args']['reject_unsafe_urls'] ?? false) === true, 'preload should remove fragments and require unsafe-URL rejection');
kr_assert(($preloadRequest['args']['redirection'] ?? null) === 0, 'the HTTP client should never follow an unchecked redirect');
kr_assert(!str_contains((string) ($preloadRequest['args']['user-agent'] ?? ''), 'example.test'), 'the preload user agent should not disclose the site URL');
$preloadState = get_option(Preloader::STATE_OPTION, []);
kr_assert(is_array($preloadState) && $preloadState['status'] === 'complete' && $preloadState['processed'] === 1, 'preload should checkpoint and finish its queue');
kr_assert(!get_option(Preloader::LOCK_OPTION, false), 'the atomic preload lock should be released only by its owner');

$GLOBALS['kr_remote_requests'] = [];
$GLOBALS['kr_remote_responses'] = [
    ['response' => ['code' => 302], 'headers' => ['location' => '/final/']],
    ['response' => ['code' => 200]],
];
kr_assert($preloader->schedule(['https://example.test/redirect-me/']), 'same-origin redirect probe should schedule');
$preloader->run();
kr_assert(count($GLOBALS['kr_remote_requests']) === 2 && $GLOBALS['kr_remote_requests'][1]['url'] === 'https://example.test/final/', 'preload should follow a bounded same-origin redirect manually');

$GLOBALS['kr_remote_requests'] = [];
$GLOBALS['kr_remote_responses'] = [
    ['response' => ['code' => 302], 'headers' => ['location' => 'https://evil.example/collect']],
];
kr_assert($preloader->schedule(['https://example.test/cross-origin/']), 'cross-origin redirect probe should schedule its initial local URL');
$preloader->run();
$redirectState = get_option(Preloader::STATE_OPTION, []);
kr_assert(count($GLOBALS['kr_remote_requests']) === 1 && is_array($redirectState) && ($redirectState['failed'] ?? 0) === 1, 'preload should reject a cross-origin redirect without requesting it');

$GLOBALS['kr_remote_requests'] = [];
add_option(Preloader::LOCK_OPTION, 'foreign-worker|' . (time() + 300), '', false);
kr_assert($preloader->schedule(['https://example.test/locked/']), 'lock-contention probe should schedule');
$preloader->run();
kr_assert($GLOBALS['kr_remote_requests'] === [] && str_starts_with((string) get_option(Preloader::LOCK_OPTION, ''), 'foreign-worker|'), 'a preload worker should not steal or release another live lock');
delete_option(Preloader::LOCK_OPTION);

// New URLs arriving during a batch live in a separately locked inbox, so a
// worker checkpoint can never overwrite them.
$resetPreloader = static function (): void {
    foreach ([
        Preloader::STATE_OPTION,
        Preloader::LOCK_OPTION,
        Preloader::PENDING_OPTION,
        Preloader::PENDING_LOCK_OPTION,
        Preloader::GENERATION_OPTION,
    ] as $option) {
        delete_option($option);
    }
    unset($GLOBALS['kr_cron'][Preloader::HOOK], $GLOBALS['kr_cron'][Preloader::ENQUEUE_HOOK]);
    $GLOBALS['kr_remote_requests'] = [];
    $GLOBALS['kr_remote_responses'] = [];
    $GLOBALS['kr_remote_interceptor'] = null;
    $GLOBALS['kr_schedule_interceptor'] = null;
    $GLOBALS['kr_update_option_interceptor'] = null;
};

$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, [
    'preload_enabled' => true,
    'preload_batch_size' => 1,
]);
$worker = new Preloader($settings, $store, $silentLogger);
$producer = new Preloader($settings, $store, $silentLogger);
kr_assert($worker->schedule([
    'https://example.test/preload-a/',
    'https://example.test/preload-b/',
]), 'the concurrent-inbox probe should schedule its initial queue');
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$GLOBALS['kr_remote_interceptor'] = static function () use ($producer): void {
    $GLOBALS['kr_remote_interceptor'] = null;
    kr_assert($producer->enqueue(['https://example.test/preload-c/']), 'a producer should persist a URL while another worker owns the state lock');
};
$worker->run();
$concurrentState = get_option(Preloader::STATE_OPTION, []);
kr_assert(
    array_column($GLOBALS['kr_remote_requests'], 'url') === ['https://example.test/preload-a/']
    && ($concurrentState['queue'] ?? []) === ['https://example.test/preload-b/', 'https://example.test/preload-c/']
    && ($concurrentState['total'] ?? 0) === 3,
    'a checkpoint should merge, order and count URLs that arrived mid-batch'
);
kr_assert(!get_option(Preloader::PENDING_OPTION, false), 'the worker should atomically drain the pending preload inbox');
for ($remainingBatches = 0; $remainingBatches < 2; ++$remainingBatches) {
    unset($GLOBALS['kr_cron'][Preloader::HOOK]);
    $worker->run();
}
$concurrentState = get_option(Preloader::STATE_OPTION, []);
kr_assert(
    array_column($GLOBALS['kr_remote_requests'], 'url') === [
        'https://example.test/preload-a/',
        'https://example.test/preload-b/',
        'https://example.test/preload-c/',
    ] && ($concurrentState['status'] ?? '') === 'complete',
    'all concurrent preload URLs should run exactly once and finish'
);

// Repeated schedules merge into active state instead of replacing URLs that
// have not been warmed yet.
$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['preload_enabled' => true]);
$mergeScheduler = new Preloader($settings, $store, $silentLogger);
kr_assert($mergeScheduler->schedule([
    'https://example.test/merge-a/',
    'https://example.test/merge-b/',
]), 'the active-queue merge probe should schedule its first URLs');
kr_assert($mergeScheduler->schedule(['https://example.test/merge-c/']), 'a second schedule should merge into active work');
$mergedState = get_option(Preloader::STATE_OPTION, []);
kr_assert(
    ($mergedState['queue'] ?? []) === [
        'https://example.test/merge-a/',
        'https://example.test/merge-b/',
        'https://example.test/merge-c/',
    ],
    'a sequential schedule must preserve every unprocessed URL'
);

// Recovery scheduling must never write back a stale state snapshot outside
// the main preload lock; doing so could erase a concurrent schedule merge.
$staleRecoveryState = $mergedState;
$staleRecoveryState['updated_at'] = time() - 3600;
update_option(Preloader::STATE_OPTION, $staleRecoveryState, false);
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$mergeScheduler->maybeSchedule();
kr_assert(
    get_option(Preloader::STATE_OPTION, []) === $staleRecoveryState
    && isset($GLOBALS['kr_cron'][Preloader::HOOK]),
    'preload recovery should schedule a worker without rewriting an unlocked state snapshot'
);

// Pending input is acknowledged only after the merged state has been written
// and read back. A failed checkpoint therefore leaves the inbox recoverable.
$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, [
    'preload_enabled' => true,
    'preload_batch_size' => 1,
]);
$durableWorker = new Preloader($settings, $store, $silentLogger);
$durableProducer = new Preloader($settings, $store, $silentLogger);
kr_assert($durableWorker->schedule(['https://example.test/durable-a/']), 'the durable-inbox probe should schedule its base URL');
kr_assert($durableProducer->enqueue(['https://example.test/durable-b/']), 'the durable-inbox probe should persist a pending URL');
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$GLOBALS['kr_update_option_interceptor'] = static function (string $name): ?bool {
    if ($name !== Preloader::STATE_OPTION) {
        return null;
    }
    $GLOBALS['kr_update_option_interceptor'] = null;

    return false;
};
$durableWorker->run();
kr_assert(
    $GLOBALS['kr_remote_requests'] === []
    && is_array(get_option(Preloader::PENDING_OPTION, false))
    && isset($GLOBALS['kr_cron'][Preloader::HOOK]),
    'a failed state checkpoint must keep pending URLs and arrange a retry'
);
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$durableWorker->run();
$durableState = get_option(Preloader::STATE_OPTION, []);
kr_assert(
    array_column($GLOBALS['kr_remote_requests'], 'url') === ['https://example.test/durable-a/']
    && ($durableState['queue'] ?? []) === ['https://example.test/durable-b/']
    && !get_option(Preloader::PENDING_OPTION, false),
    'the retry should commit and acknowledge the durable inbox without losing its URL'
);

// Cancellation changes the generation but never removes a lock owned by a
// different request.
$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['preload_enabled' => true]);
$canceller = new Preloader($settings, $store, $silentLogger);
kr_assert($canceller->schedule(['https://example.test/cancel-queued/']), 'the cancellation probe should have queued state');
add_option(Preloader::LOCK_OPTION, 'foreign-canceller|' . (time() + 300), '', false);
$canceller->unschedule();
$cancelledState = get_option(Preloader::STATE_OPTION, []);
kr_assert(
    str_starts_with((string) get_option(Preloader::LOCK_OPTION, ''), 'foreign-canceller|')
    && ($cancelledState['status'] ?? '') === 'paused'
    && !isset($GLOBALS['kr_cron'][Preloader::HOOK]),
    'unschedule should pause work and preserve another worker lock'
);
(new Preloader($settings, $store, $silentLogger))->run();
kr_assert(!isset($GLOBALS['kr_cron'][Preloader::HOOK]), 'a stale callback blocked by another worker must not reschedule cancelled work');
delete_option(Preloader::LOCK_OPTION);

$lockProbe = new Preloader($settings, $store, $silentLogger);
$acquireOptionLock = new ReflectionMethod(Preloader::class, 'acquireOptionLock');
$releaseOptionLock = new ReflectionMethod(Preloader::class, 'releaseOptionLock');
$acquireOptionLock->setAccessible(true);
$releaseOptionLock->setAccessible(true);
kr_assert($acquireOptionLock->invoke($lockProbe, 'kodety_rocket_test_owner_lock', 60) === true, 'the owner-release probe should acquire its option lock');
update_option('kodety_rocket_test_owner_lock', 'replacement-owner|' . (time() + 300), false);
$releaseOptionLock->invoke($lockProbe, 'kodety_rocket_test_owner_lock');
kr_assert(
    str_starts_with((string) get_option('kodety_rocket_test_owner_lock', ''), 'replacement-owner|'),
    'an old preload owner must not delete a lock token that replaced its own'
);
delete_option('kodety_rocket_test_owner_lock');

$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, [
    'preload_enabled' => true,
    'preload_batch_size' => 2,
]);
$activeWorker = new Preloader($settings, $store, $silentLogger);
$activeCanceller = new Preloader($settings, $store, $silentLogger);
kr_assert($activeWorker->schedule([
    'https://example.test/cancel-a/',
    'https://example.test/cancel-b/',
]), 'the active-cancellation probe should schedule');
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$GLOBALS['kr_remote_interceptor'] = static function () use ($activeCanceller): void {
    $GLOBALS['kr_remote_interceptor'] = null;
    $activeCanceller->unschedule();
};
$activeWorker->run();
$cancelledState = get_option(Preloader::STATE_OPTION, []);
kr_assert(
    array_column($GLOBALS['kr_remote_requests'], 'url') === ['https://example.test/cancel-a/']
    && ($cancelledState['status'] ?? '') === 'paused'
    && ($cancelledState['queue'] ?? []) === ['https://example.test/cancel-b/']
    && !isset($GLOBALS['kr_cron'][Preloader::HOOK]),
    'generation cancellation should stop the active batch without losing its remaining URL'
);
kr_assert(!get_option(Preloader::LOCK_OPTION, false), 'only the active preload worker should release its own lock after cancellation');

// An uninstall-style terminal cancellation removes the generation entirely;
// an in-flight worker must stop without recreating any plugin option.
$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, [
    'preload_enabled' => true,
    'preload_batch_size' => 2,
]);
$terminalWorker = new Preloader($settings, $store, $silentLogger);
kr_assert($terminalWorker->schedule([
    'https://example.test/terminal-a/',
    'https://example.test/terminal-b/',
]), 'the terminal-cancellation probe should schedule');
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$GLOBALS['kr_remote_interceptor'] = static function (): void {
    $GLOBALS['kr_remote_interceptor'] = null;
    Preloader::cancelStoredWork();
    delete_option(Preloader::STATE_OPTION);
    delete_option(Preloader::PENDING_OPTION);
    delete_option(Preloader::GENERATION_OPTION);
};
$terminalWorker->run();
kr_assert(
    array_column($GLOBALS['kr_remote_requests'], 'url') === ['https://example.test/terminal-a/']
    && !get_option(Preloader::STATE_OPTION, false)
    && !get_option(Preloader::GENERATION_OPTION, false),
    'an in-flight worker must not recreate state or generation after terminal cancellation'
);

// Automatic work is revalidated at execution time, while an explicit admin
// warmup can still run independently from the automatic-preload setting.
$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['preload_enabled' => true]);
$disabledWorker = new Preloader($settings, $store, $silentLogger);
kr_assert($disabledWorker->schedule(['https://example.test/disabled-before-cron/']), 'the disabled-before-cron probe should initially schedule');
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['preload_enabled' => false]);
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$disabledWorker->run();
$disabledState = get_option(Preloader::STATE_OPTION, []);
kr_assert(
    $GLOBALS['kr_remote_requests'] === []
    && ($disabledState['status'] ?? '') === 'paused'
    && !isset($GLOBALS['kr_cron'][Preloader::HOOK]),
    'an automatic worker should not request or reschedule after preload is disabled'
);
kr_assert($disabledWorker->schedule(['https://example.test/manual-warmup/'], true), 'an explicit manual warmup should schedule while automation is disabled');
unset($GLOBALS['kr_cron'][Preloader::HOOK]);
$disabledWorker->run();
kr_assert(array_column($GLOBALS['kr_remote_requests'], 'url') === ['https://example.test/manual-warmup/'], 'manual warmup should remain functional when automatic preload is off');

// A concurrent cron insertion is success even when WordPress returns its
// duplicate-event error; a real scheduling failure remains visible.
$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['preload_enabled' => true]);
$raceScheduler = new Preloader($settings, $store, $silentLogger);
$GLOBALS['kr_schedule_interceptor'] = static function (int $timestamp, string $hook): WP_Error {
    $GLOBALS['kr_cron'][$hook] = $timestamp;

    return new WP_Error('duplicate_event');
};
kr_assert($raceScheduler->schedule(['https://example.test/cron-race/']), 'a concurrently inserted cron event should count as a successful schedule');
$raceState = get_option(Preloader::STATE_OPTION, []);
kr_assert(($raceState['status'] ?? '') === 'queued' && !isset($raceState['last_error']), 'a harmless cron race should not poison preload state');

$resetPreloader();
$GLOBALS['kr_options'][SettingsRepository::OPTION_NAME] = array_replace($defaults, ['preload_enabled' => true]);
$GLOBALS['kr_schedule_interceptor'] = static fn (): WP_Error => new WP_Error('schedule_failed');
kr_assert(!$raceScheduler->schedule(['https://example.test/cron-failure/']), 'a cron error without a resulting event should fail scheduling');
$raceState = get_option(Preloader::STATE_OPTION, []);
kr_assert(($raceState['status'] ?? '') === 'error' && ($raceState['last_error'] ?? '') === 'cron_schedule_failed', 'a genuine cron failure should be reported in state');
$GLOBALS['kr_schedule_interceptor'] = null;

// Network retry callbacks are idempotent and share one network-wide owner.
$networkStore = new FileCacheStore($testRoot . '/network-cache', null, 100, 1048576, false, 6, 20, 1048576, 1000, 500, 8);
$networkKey = CacheKey::fromUrl('https://example.test/network-retry/', 1);
kr_assert($networkKey instanceof CacheKey && $networkStore->put($networkKey, $entry), 'the network retry probe should create a cache entry');
delete_site_option(CacheInvalidator::NETWORK_PENDING_OPTION);
delete_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION);
$networkInvalidator = new CacheInvalidator($networkStore);
$networkInvalidator->retryNetworkPurge();
kr_assert($networkStore->get($networkKey) instanceof CacheEntry, 'an obsolete network retry callback should be a no-op');
kr_assert(!get_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, false), 'a no-op retry should not acquire a network lock');

update_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, 'pending-first');
(new CacheInvalidator($networkStore))->retryNetworkPurge();
kr_assert(!$networkStore->get($networkKey) && !get_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, false), 'the first valid network retry should purge and clear its marker');
kr_assert($networkStore->put($networkKey, $entry), 'new cache data should be writable after a successful network retry');
(new CacheInvalidator($networkStore))->retryNetworkPurge();
kr_assert($networkStore->get($networkKey) instanceof CacheEntry, 'a duplicate old callback must preserve cache created after the successful retry');

$lockedPendingToken = 'pending-locked';
update_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, $lockedPendingToken);
add_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, 'foreign-network|' . (time() + 300));
unset($GLOBALS['kr_cron'][CacheInvalidator::RETRY_NETWORK_HOOK]);
(new CacheInvalidator($networkStore))->retryNetworkPurge();
kr_assert(
    $networkStore->get($networkKey) instanceof CacheEntry
    && get_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, false) === $lockedPendingToken
    && str_starts_with((string) get_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, ''), 'foreign-network|')
    && isset($GLOBALS['kr_cron'][CacheInvalidator::RETRY_NETWORK_HOOK]),
    'network lock contention should preserve data, pending state and foreign ownership while scheduling one retry'
);
delete_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION);
(new CacheInvalidator($networkStore))->retryNetworkPurge();
kr_assert(
    !$networkStore->get($networkKey)
    && !get_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, false)
    && !get_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, false),
    'the next network retry should purge successfully and release only its own lock'
);

// Conditional marker deletion must never erase a newer invalidation token.
$markerInvalidator = new CacheInvalidator($networkStore);
$clearNetworkMarker = new ReflectionMethod(CacheInvalidator::class, 'clearNetworkPendingIfMatches');
$clearNetworkMarker->setAccessible(true);
update_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, 'newer-network-generation');
kr_assert(
    $clearNetworkMarker->invoke($markerInvalidator, 'older-network-generation') === false
    && get_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, false) === 'newer-network-generation',
    'a completed purge must preserve a newer network invalidation marker'
);
delete_site_option(CacheInvalidator::NETWORK_PENDING_OPTION);

// Every direct invalidation receives a unique marker, even inside one second.
add_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, 'foreign-network|' . (time() + 300));
(new CacheInvalidator($networkStore))->purgeAll(null);
$firstGeneration = (string) get_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, '');
(new CacheInvalidator($networkStore))->purgeAll(null);
$secondGeneration = (string) get_site_option(CacheInvalidator::NETWORK_PENDING_OPTION, '');
kr_assert(
    $firstGeneration !== '' && $secondGeneration !== '' && $firstGeneration !== $secondGeneration,
    'separate network invalidations should use unique generations rather than one-second timestamps'
);
delete_site_option(CacheInvalidator::NETWORK_PENDING_OPTION);
delete_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION);

// A network purge rotates and removes only the selected network. Caches and
// late-write generation guards in another network must remain untouched.
$networkScopeStore = new FileCacheStore($testRoot . '/network-scope-cache', null, 100, 1048576, false, 6, 20, 1048576, 1000, 500, 8);
$networkScopeKeyA = CacheKey::fromUrl('https://example.test/network-seven-a/', 1);
$networkScopeKeyB = CacheKey::fromUrl('https://example.test/network-seven-b/', 2);
$otherNetworkKey = CacheKey::fromUrl('https://example.test/network-eight/', 3);
$networkScopeEntry = new CacheEntry($html, 3600);
kr_assert(
    $networkScopeKeyA instanceof CacheKey
    && $networkScopeKeyB instanceof CacheKey
    && $otherNetworkKey instanceof CacheKey
    && $networkScopeStore->put($networkScopeKeyA, $networkScopeEntry)
    && $networkScopeStore->put($networkScopeKeyB, $networkScopeEntry)
    && $networkScopeStore->put($otherNetworkKey, $networkScopeEntry),
    'the multi-network purge probe should create entries for both networks'
);
$savedSitesByNetwork = $GLOBALS['kr_sites_by_network'];
$GLOBALS['kr_sites_by_network'] = [7 => [1, 2], 8 => [3]];
$GLOBALS['kr_scope_network_options'] = true;
$GLOBALS['kr_network_site_options'] = [7 => [], 8 => []];
$GLOBALS['kr_current_network_id'] = 8;
$GLOBALS['kr_current_blog_id'] = 3;
$otherNetworkGeneration = CacheInvalidator::generationSnapshot(3);
$GLOBALS['kr_current_network_id'] = 7;
$GLOBALS['kr_current_blog_id'] = 1;
$GLOBALS['kr_get_sites_queries'] = [];
(new CacheInvalidator($networkScopeStore))->purgeAll(null);
$networkScopeQueries = $GLOBALS['kr_get_sites_queries'];
kr_assert(
    $networkScopeStore->get($networkScopeKeyA) === null
    && $networkScopeStore->get($networkScopeKeyB) === null
    && $networkScopeStore->get($otherNetworkKey) instanceof CacheEntry
    && count($networkScopeQueries) === 1
    && ($networkScopeQueries[0]['network_id'] ?? null) === 7,
    'a network purge should physically target only site IDs from the current network'
);
$GLOBALS['kr_current_network_id'] = 8;
$GLOBALS['kr_current_blog_id'] = 3;
$otherNetworkLateKey = CacheKey::fromUrl('https://example.test/network-eight-late/', 3);
$otherNetworkLateEntry = new CacheEntry(
    $html,
    3600,
    [],
    200,
    null,
    [],
    'identity',
    [],
    ['cache_generation' => $otherNetworkGeneration]
);
kr_assert(
    CacheInvalidator::generationSnapshot(3) === $otherNetworkGeneration
    && $otherNetworkLateKey instanceof CacheKey
    && $networkScopeStore->put(
        $otherNetworkLateKey,
        $otherNetworkLateEntry,
        static fn (): bool => hash_equals($otherNetworkGeneration, CacheInvalidator::generationSnapshot(3))
    ),
    'purging one network must not rotate or reject an in-flight write from another network'
);
$GLOBALS['kr_scope_network_options'] = false;
$GLOBALS['kr_network_site_options'] = [];
$GLOBALS['kr_sites_by_network'] = $savedSitesByNetwork;
$GLOBALS['kr_current_network_id'] = 7;
$GLOBALS['kr_current_blog_id'] = 1;
$GLOBALS['kr_get_sites_queries'] = [];

// Releasing a stale owner must be conditional on the exact network token.
$networkLockProbe = new CacheInvalidator($networkStore);
$acquireNetworkLock = new ReflectionMethod(CacheInvalidator::class, 'acquireNetworkRetryLock');
$releaseNetworkLock = new ReflectionMethod(CacheInvalidator::class, 'releaseNetworkRetryLock');
$acquireNetworkLock->setAccessible(true);
$releaseNetworkLock->setAccessible(true);
kr_assert($acquireNetworkLock->invoke($networkLockProbe) === true, 'the network owner-release probe should acquire its lock');
update_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, 'replacement-network|' . (time() + 300));
$releaseNetworkLock->invoke($networkLockProbe);
kr_assert(
    str_starts_with((string) get_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, ''), 'replacement-network|'),
    'an old network owner must not delete a lock token that replaced its own'
);
delete_site_option(CacheInvalidator::NETWORK_RETRY_LOCK_OPTION);

// Production WordPress exposes $wpdb, so conditional deletes must also evict
// the exact persistent-object-cache key after their compare-and-delete query.
$GLOBALS['wpdb'] = new KR_WPDB_Stub();
$GLOBALS['kr_cache_deletes'] = [];
$databaseSiteGeneration = 'database-site-a';
$databaseNetworkGeneration = 'database-network-a';
$GLOBALS['wpdb']->resultsInterceptor = static function (string $query) use (&$databaseSiteGeneration, &$databaseNetworkGeneration): array {
    if (str_contains($query, 'wp_sitemeta')) {
        return [
            ['option_key' => CacheInvalidator::NETWORK_GENERATION_OPTION, 'option_value' => $databaseNetworkGeneration],
        ];
    }

    return [
        ['option_key' => CacheInvalidator::SITE_GENERATION_OPTION, 'option_value' => $databaseSiteGeneration],
    ];
};
$authoritativeSnapshot = CacheInvalidator::generationSnapshot(1);
update_option(CacheInvalidator::SITE_GENERATION_OPTION, 'stale-runtime-site-cache', false);
update_site_option(CacheInvalidator::NETWORK_GENERATION_OPTION, 'stale-runtime-network-cache');
kr_assert(
    CacheInvalidator::generationSnapshot(1) === $authoritativeSnapshot,
    'generation CAS reads should bypass process-local WordPress option caches'
);
$databaseSiteGeneration = 'database-site-b';
kr_assert(
    CacheInvalidator::generationSnapshot(1) !== $authoritativeSnapshot,
    'an authoritative database generation change should invalidate the captured snapshot'
);
$GLOBALS['wpdb']->resultsInterceptor = null;
$deleteOptionValue = new ReflectionMethod(Preloader::class, 'deleteOptionLockValue');
$deleteOptionValue->setAccessible(true);
kr_assert(
    $deleteOptionValue->invoke($lockProbe, 'kodety_rocket_sql_owner', 'owner-token') === true
    && $GLOBALS['wpdb']->preparedArgs === ['kodety_rocket_sql_owner', 'owner-token']
    && end($GLOBALS['kr_cache_deletes']) === ['key' => 'kodety_rocket_sql_owner', 'group' => 'options'],
    'preload lock release should use an atomic SQL value comparison and evict its option cache key'
);

$GLOBALS['kr_cache_deletes'] = [];
$deleteNetworkValue = new ReflectionMethod(CacheInvalidator::class, 'deleteNetworkOptionValue');
$deleteNetworkValue->setAccessible(true);
kr_assert(
    $deleteNetworkValue->invoke($markerInvalidator, 'kodety_rocket_sql_network', 'network-token', true) === true
    && $GLOBALS['wpdb']->preparedArgs === [7, 'kodety_rocket_sql_network', 'network-token']
    && end($GLOBALS['kr_cache_deletes']) === ['key' => '7:kodety_rocket_sql_network', 'group' => 'site-options'],
    'network compare-and-delete should evict the correctly ordered persistent object-cache key'
);

// On single-site, Core's site-option wrappers store values in wp_options. The
// conditional delete must follow that delegation rather than query sitemeta or
// fall back to a racy get/delete pair.
$GLOBALS['kr_is_multisite'] = false;
$GLOBALS['kr_cache_deletes'] = [];
kr_assert(
    $deleteNetworkValue->invoke($markerInvalidator, 'kodety_rocket_single_site_lock', 'single-token', true) === true
    && $GLOBALS['wpdb']->preparedArgs === ['kodety_rocket_single_site_lock', 'single-token']
    && str_contains($GLOBALS['wpdb']->preparedQuery, 'wp_options')
    && end($GLOBALS['kr_cache_deletes']) === ['key' => 'kodety_rocket_single_site_lock', 'group' => 'options'],
    'single-site network locks should use an atomic wp_options compare-and-delete'
);

// Uninstall cleanup must not delete a replacement network lock that appeared
// after the expired value was observed.
$GLOBALS['kr_is_multisite'] = true;
$GLOBALS['kr_cache_deletes'] = [];
$deleteUninstallNetworkValue = new ReflectionMethod(Uninstaller::class, 'deleteNetworkOptionIfMatches');
$deleteUninstallNetworkValue->setAccessible(true);
kr_assert(
    $deleteUninstallNetworkValue->invoke(null, 11, CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, 'expired-owner|1') === true
    && $GLOBALS['wpdb']->preparedArgs === [11, CacheInvalidator::NETWORK_RETRY_LOCK_OPTION, 'expired-owner|1']
    && end($GLOBALS['kr_cache_deletes']) === [
        'key' => '11:' . CacheInvalidator::NETWORK_RETRY_LOCK_OPTION,
        'group' => 'site-options',
    ],
    'uninstall should delete an expired network lock only through an owner-token CAS'
);
unset($GLOBALS['wpdb']);

printf("Kodety Rocket runtime checks passed (%d assertions).\n", $assertions);
