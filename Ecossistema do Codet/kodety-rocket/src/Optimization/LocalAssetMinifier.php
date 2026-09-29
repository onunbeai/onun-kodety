<?php

declare(strict_types=1);

namespace KodetyRocket\Optimization;

use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Http\RequestGate;
use KodetyRocket\Settings\SettingsRepository;

/**
 * Builds immutable minified copies of safe local assets. Sources are never
 * modified and any uncertainty returns the original loader tag.
 */
final class LocalAssetMinifier
{
    private SettingsRepository $settings;
    private Logger $logger;
    private ?RequestGate $requestGate;

    public function __construct(SettingsRepository $settings, Logger $logger, ?RequestGate $requestGate = null)
    {
        $this->settings = $settings;
        $this->logger = $logger;
        $this->requestGate = $requestGate;
    }

    public function register(): void
    {
        if (!function_exists('add_filter')) {
            return;
        }

        add_filter('style_loader_tag', [$this, 'filterStyleTag'], 10, 4);
        add_filter('script_loader_tag', [$this, 'filterScriptTag'], 10, 3);
    }

    public function filterStyleTag(string $html, string $handle, string $href = '', string $media = ''): string
    {
        if (!(bool) $this->settings->get('minify_css_enabled', false)) {
            return $html;
        }

        $href = $href !== '' ? $href : $this->attribute($html, 'href');

        return $this->filterTag($html, $handle, $href, 'css', 'href');
    }

    public function filterScriptTag(string $tag, string $handle, string $src = ''): string
    {
        if (!(bool) $this->settings->get('minify_js_enabled', false)) {
            return $tag;
        }

        $src = $src !== '' ? $src : $this->attribute($tag, 'src');

        return $this->filterTag($tag, $handle, $src, 'js', 'src');
    }

    private function filterTag(string $tag, string $handle, string $url, string $type, string $attribute): string
    {
        if ($url === ''
            || (defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS)
            || ($this->requestGate !== null && !$this->requestGate->allowsTransformations())
            || (function_exists('is_admin') && is_admin())
            || preg_match('/\sintegrity\s*=/i', $tag) === 1
            || preg_match('/\snonce\s*=/i', $tag) === 1
            || ($type === 'js' && $this->isSpecialScriptTag($tag))
            || preg_match('/\.min\.' . preg_quote($type, '/') . '(?:[?#]|$)/i', html_entity_decode($url, ENT_QUOTES), $matches) === 1
            || ($type === 'js' && $this->isJQuery($handle, $url))) {
            return $tag;
        }

        try {
            $path = $this->resolveLocalPath($url, $type);
            if ($path === null) {
                return $tag;
            }

            $replacement = $this->minifiedUrl($path, $type);
            if ($replacement === null) {
                return $tag;
            }

            return $this->replaceAttribute($tag, $attribute, $replacement);
        } catch (\Throwable $exception) {
            $this->logger->warning('Local asset minification failed open.', [
                'handle' => $handle,
                'type' => $type,
                'exception' => $exception,
            ]);

            return $tag;
        }
    }

    private function resolveLocalPath(string $url, string $type): ?string
    {
        $decodedUrl = html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $parts = parse_url($decodedUrl);
        if ($parts === false) {
            return null;
        }

        $candidateHost = strtolower(rtrim(trim((string) ($parts['host'] ?? ''), '[]'), '.'));
        $localOrigins = [];
        foreach (['home_url', 'site_url'] as $urlFunction) {
            if (function_exists($urlFunction)) {
                $origin = $this->origin((string) $urlFunction('/'));
                if ($origin !== null) {
                    $localOrigins[] = $origin;
                }
            }
        }

        if ($candidateHost !== '') {
            $candidateOrigin = $this->origin($decodedUrl);
            if ($candidateOrigin === null || !in_array($candidateOrigin, array_unique($localOrigins), true)) {
                return null;
            }
        }

        $urlPath = rawurldecode((string) ($parts['path'] ?? ''));
        if ($urlPath === '' || strtolower((string) pathinfo($urlPath, PATHINFO_EXTENSION)) !== $type) {
            return null;
        }
        if ($candidateHost === '' && substr($urlPath, 0, 1) !== '/') {
            // A relative URL resolves against the current document path and is
            // ambiguous without a browser URL resolver. WordPress enqueue URLs
            // are absolute, so uncertainty should preserve the original tag.
            return null;
        }

        $mappings = $this->urlPathMappings();
        usort($mappings, static fn (array $left, array $right): int => strlen($right['url_path']) <=> strlen($left['url_path']));
        $candidate = null;

        foreach ($mappings as $mapping) {
            $prefix = rtrim($mapping['url_path'], '/') . '/';
            if ($prefix !== '/' && strpos($urlPath . '/', $prefix) !== 0) {
                continue;
            }

            $relative = $prefix === '/' ? ltrim($urlPath, '/') : ltrim(substr($urlPath, strlen(rtrim($prefix, '/'))), '/');
            $candidate = rtrim($mapping['directory'], '/\\') . '/' . $relative;
            break;
        }

        if ($candidate === null) {
            return null;
        }

        $real = realpath($candidate);
        if ($real === false || !is_file($real) || !is_readable($real) || !$this->isAllowedPath($real)) {
            return null;
        }

        $size = @filesize($real);
        if (!is_int($size) || $size <= 0 || $size > (int) $this->settings->get('max_asset_bytes', 1048576)) {
            return null;
        }

        return $real;
    }

    private function origin(string $url): ?string
    {
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            return null;
        }
        $scheme = strtolower((string) $parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) {
            return null;
        }
        $host = strtolower(rtrim(trim((string) $parts['host'], '[]'), '.'));
        if ($host === '' || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }
        $port = isset($parts['port']) ? (int) $parts['port'] : ($scheme === 'https' ? 443 : 80);

        return $scheme . '://' . $host . ':' . $port;
    }

    /** @return list<array{url_path:string,directory:string}> */
    private function urlPathMappings(): array
    {
        $mappings = [];
        $pairs = [];

        if (defined('WP_CONTENT_DIR') && function_exists('content_url')) {
            $pairs[] = [(string) content_url('/'), (string) WP_CONTENT_DIR];
        }
        if (defined('WP_PLUGIN_DIR') && function_exists('plugins_url')) {
            $pairs[] = [(string) plugins_url('/'), (string) WP_PLUGIN_DIR];
        }
        if (defined('ABSPATH') && function_exists('includes_url') && defined('WPINC')) {
            $pairs[] = [(string) includes_url('/'), rtrim((string) ABSPATH, '/\\') . '/' . (string) WPINC];
        }
        if (defined('ABSPATH') && function_exists('site_url')) {
            $pairs[] = [(string) site_url('/'), (string) ABSPATH];
        }
        if (defined('ABSPATH') && function_exists('home_url')) {
            $pairs[] = [(string) home_url('/'), (string) ABSPATH];
        }

        foreach ($pairs as [$baseUrl, $directory]) {
            $path = parse_url($baseUrl, PHP_URL_PATH);
            $mappings[] = [
                'url_path' => is_string($path) && $path !== '' ? '/' . ltrim($path, '/') : '/',
                'directory' => $directory,
            ];
        }

        return $mappings;
    }

    private function isAllowedPath(string $path): bool
    {
        $roots = [];
        foreach (['ABSPATH', 'WP_CONTENT_DIR', 'WP_PLUGIN_DIR'] as $constant) {
            if (defined($constant)) {
                $roots[] = (string) constant($constant);
            }
        }
        foreach (['get_stylesheet_directory', 'get_template_directory'] as $function) {
            if (function_exists($function)) {
                $roots[] = (string) $function();
            }
        }
        if (function_exists('apply_filters')) {
            $roots = (array) apply_filters('kodety_rocket_asset_roots', $roots);
        }

        $normalizedPath = str_replace('\\', '/', $path);
        foreach ($roots as $root) {
            if (!is_string($root) || $root === '') {
                continue;
            }
            $realRoot = realpath($root);
            if ($realRoot === false) {
                continue;
            }
            $normalizedRoot = rtrim(str_replace('\\', '/', $realRoot), '/');
            if ($normalizedPath === $normalizedRoot || strpos($normalizedPath, $normalizedRoot . '/') === 0) {
                return true;
            }
        }

        return false;
    }

    private function minifiedUrl(string $source, string $type): ?string
    {
        if ($type === 'css' && !$this->isWithinContentDirectory($source)) {
            // Relative CSS references can be relocated safely only when the
            // source and immutable target share WP_CONTENT_DIR's filesystem to
            // URL topology. Custom core/plugin mappings otherwise diverge.
            return null;
        }

        if ($type === 'css' && class_exists('\\KodetyRocketVendor\\MatthiasMullie\\Minify\\CSS')) {
            $class = ConservativeCssMinifier::class;
        } elseif ($type === 'js' && class_exists('\\KodetyRocketVendor\\MatthiasMullie\\Minify\\JS')) {
            $class = '\\KodetyRocketVendor\\MatthiasMullie\\Minify\\JS';
        } elseif (defined('KODETY_ROCKET_DEV_MODE') && KODETY_ROCKET_DEV_MODE) {
            if ($type === 'css') {
                if (!class_exists('\\MatthiasMullie\\Minify\\CSS')) {
                    return null;
                }
                $class = ConservativeGlobalCssMinifier::class;
            } else {
                if (!class_exists('\\MatthiasMullie\\Minify\\JS')) {
                    return null;
                }
                $class = '\\MatthiasMullie\\Minify\\JS';
            }
        } else {
            return null;
        }
        if (!class_exists($class)) {
            return null;
        }

        $sourceHash = @hash_file('sha256', $source);
        if (!is_string($sourceHash) || preg_match('/^[a-f0-9]{64}$/', $sourceHash) !== 1) {
            return null;
        }

        $engineVersion = defined('KODETY_ROCKET_VERSION') ? (string) KODETY_ROCKET_VERSION : '1.0.0';
        $hash = hash('sha256', $sourceHash . '|' . $type . '|' . $class . '|' . $engineVersion);
        $blogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;
        $contentDirectory = defined('WP_CONTENT_DIR') ? (string) WP_CONTENT_DIR : '';
        if ($contentDirectory === '') {
            return null;
        }

        $relativeDirectory = 'cache/kodety-rocket/' . $blogId . '/assets/' . $type;
        $directory = rtrim($contentDirectory, '/\\') . '/' . $relativeDirectory;
        $target = $directory . '/' . $hash . '.min.' . $type;

        if (!$this->validCachedAsset($target)) {
            if (!$this->ensureDirectory($directory) || !$this->buildAsset($class, $source, $target)) {
                return null;
            }
        }

        // Refresh the last-use lease under the same persistent lock used by
        // maintenance. Automatic pruning retains leases for much longer than
        // the maximum page-cache TTL, so cached HTML cannot point to a removed
        // dependency. Contention or an uncertain inode fails open.
        if (!$this->markCachedAssetUsed($target)) {
            return null;
        }

        if (!function_exists('content_url')) {
            return null;
        }

        return (string) content_url('/' . $relativeDirectory . '/' . basename($target)) . '?ver=' . substr($hash, 0, 12);
    }

    private function isWithinContentDirectory(string $path): bool
    {
        if (!defined('WP_CONTENT_DIR')) {
            return false;
        }
        $root = realpath((string) WP_CONTENT_DIR);
        if ($root === false) {
            return false;
        }
        $normalizedPath = str_replace('\\', '/', $path);
        $normalizedRoot = rtrim(str_replace('\\', '/', $root), '/');

        return $normalizedPath === $normalizedRoot || strpos($normalizedPath, $normalizedRoot . '/') === 0;
    }

    private function buildAsset(string $class, string $source, string $target): bool
    {
        $directory = dirname($target);
        if (!$this->assetDirectoryIsSafe($directory)) {
            return false;
        }

        $lock = $this->openLock($target . '.lock');
        if ($lock === false) {
            return false;
        }

        $temporary = null;
        try {
            if (!@flock($lock, LOCK_EX | LOCK_NB)) {
                return false;
            }
            if ($this->validCachedAsset($target)) {
                return true;
            }

            $minifier = new $class($source);
            // execute($target) rewrites relative CSS url()/@import references
            // for the immutable cache location without letting the library
            // write the destination non-atomically. JS safely ignores $target.
            $output = $minifier->execute($target);
            $originalSize = @filesize($source);
            if (!is_string($output) || trim($output) === '' || !is_int($originalSize) || strlen($output) >= $originalSize) {
                return false;
            }

            $temporary = @tempnam($directory, '.kodety-rocket-');
            if (!is_string($temporary)
                || is_link($temporary)
                || !$this->assetPathIsSafe($temporary)) {
                return false;
            }
            if (!$this->writeAndSync($temporary, $output)) {
                return false;
            }
            @chmod($temporary, 0644);

            if (!$this->assetDirectoryIsSafe($directory)) {
                return false;
            }
            $renamed = @rename($temporary, $target);
            if ($renamed) {
                AssetCacheMaintenance::prune();
            }

            return $renamed;
        } catch (\Throwable $exception) {
            $this->logger->warning('Asset minifier library failed.', [
                'source' => $source,
                'exception' => $exception,
            ]);

            return false;
        } finally {
            if (is_string($temporary) && is_file($temporary)) {
                @unlink($temporary);
            }
            @flock($lock, LOCK_UN);
            @fclose($lock);
        }
    }

    private function validCachedAsset(string $path): bool
    {
        $size = @filesize($path);

        return is_file($path)
            && !is_link($path)
            && $this->assetPathIsSafe($path)
            && is_int($size)
            && $size > 0;
    }

    private function markCachedAssetUsed(string $path): bool
    {
        $lock = $this->openLock($path . '.lock');
        if ($lock === false) {
            return false;
        }

        try {
            if (!@flock($lock, LOCK_SH | LOCK_NB)) {
                return false;
            }
            clearstatcache(true, $path);
            if (!$this->validCachedAsset($path) || !@touch($path)) {
                return false;
            }
            clearstatcache(true, $path);

            return $this->validCachedAsset($path);
        } finally {
            @flock($lock, LOCK_UN);
            @fclose($lock);
        }
    }

    private function writeAndSync(string $path, string $contents): bool
    {
        if (is_link($path) || !$this->assetPathIsSafe($path)) {
            return false;
        }
        $handle = @fopen($path, 'c+b');
        if ($handle === false) {
            return false;
        }
        if (!$this->openedFileMatchesPath($handle, $path) || !@ftruncate($handle, 0)) {
            @fclose($handle);

            return false;
        }

        $length = strlen($contents);
        $written = 0;
        $success = true;
        try {
            while ($written < $length) {
                $bytes = @fwrite($handle, substr($contents, $written));
                if (!is_int($bytes) || $bytes < 1) {
                    $success = false;
                    break;
                }
                $written += $bytes;
            }
            if ($success && !@fflush($handle)) {
                $success = false;
            }
            if ($success && function_exists('fsync') && !@fsync($handle)) {
                $success = false;
            }
        } finally {
            @fclose($handle);
        }

        return $success;
    }

    private function ensureDirectory(string $directory): bool
    {
        $created = is_dir($directory);
        if ($created && (is_link($directory) || !$this->assetDirectoryIsSafe($directory))) {
            return false;
        }
        if (!$created) {
            $created = function_exists('wp_mkdir_p')
                ? (bool) wp_mkdir_p($directory)
                : (@mkdir($directory, 0755, true) || is_dir($directory));
        }
        if (!$created
            || !is_dir($directory)
            || is_link($directory)
            || !$this->assetDirectoryIsSafe($directory)) {
            return false;
        }

        $index = $directory . '/index.php';
        if (is_link($index)) {
            return false;
        }
        if (!is_file($index)) {
            $handle = @fopen($index, 'x+b');
            if ($handle !== false) {
                @fwrite($handle, "<?php\n// Silence is golden.\n");
                @fflush($handle);
                @fclose($handle);
                @chmod($index, 0644);
            }
        }

        return true;
    }

    /** @return resource|false */
    private function openLock(string $path)
    {
        if (is_link($path) || !$this->assetDirectoryIsSafe(dirname($path))) {
            return false;
        }
        $handle = @fopen($path, 'x+b');
        if ($handle === false) {
            if (!is_file($path) || is_link($path)) {
                return false;
            }
            $handle = @fopen($path, 'c+b');
        }
        if ($handle === false
            || !$this->openedFileMatchesPath($handle, $path)
            || !$this->assetDirectoryIsSafe(dirname($path))) {
            if (is_resource($handle)) {
                @fclose($handle);
            }

            return false;
        }

        return $handle;
    }

    private function assetDirectoryIsSafe(string $directory): bool
    {
        $root = $this->assetRoot();
        if ($root === null) {
            return false;
        }
        $directory = rtrim(str_replace('\\', '/', $directory), '/');
        $rootReal = realpath($root);
        $directoryReal = realpath($directory);
        if ($rootReal === false || $directoryReal === false) {
            return false;
        }
        $rootReal = rtrim(str_replace('\\', '/', $rootReal), '/');
        $directoryReal = rtrim(str_replace('\\', '/', $directoryReal), '/');
        $suffix = $directoryReal === $rootReal
            ? ''
            : (in_array($directoryReal, [$rootReal . '/css', $rootReal . '/js'], true)
                ? substr($directoryReal, strlen($rootReal))
                : null);
        if ($suffix === null) {
            return false;
        }

        $controlledBase = dirname(dirname($root));
        if (!is_dir($controlledBase) || is_link($controlledBase)) {
            return false;
        }
        $current = $controlledBase;
        $configuredDirectory = $root . $suffix;
        $relative = substr($configuredDirectory, strlen($controlledBase) + 1);
        foreach (explode('/', $relative) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return false;
            }
            $current .= '/' . $segment;
            if (is_link($current) || (file_exists($current) && !is_dir($current))) {
                return false;
            }
        }
        if (!is_dir($directory) || is_link($directory)) {
            return false;
        }

        $contentReal = realpath((string) WP_CONTENT_DIR);
        if ($contentReal === false) {
            return false;
        }
        $contentReal = rtrim(str_replace('\\', '/', $contentReal), '/');

        return $directoryReal === $contentReal || strpos($directoryReal . '/', $contentReal . '/') === 0;
    }

    private function assetPathIsSafe(string $path): bool
    {
        if (is_link($path) || !$this->assetDirectoryIsSafe(dirname($path))) {
            return false;
        }
        $pathReal = realpath($path);
        $rootReal = realpath((string) $this->assetRoot());
        if ($pathReal === false || $rootReal === false) {
            return false;
        }
        $pathReal = rtrim(str_replace('\\', '/', $pathReal), '/');
        $rootReal = rtrim(str_replace('\\', '/', $rootReal), '/');

        return strpos($pathReal . '/', $rootReal . '/') === 0;
    }

    private function assetRoot(): ?string
    {
        if (!defined('WP_CONTENT_DIR')) {
            return null;
        }
        $content = rtrim(str_replace('\\', '/', (string) WP_CONTENT_DIR), '/');
        if ($content === '' || $content === '/') {
            return null;
        }
        $blogId = function_exists('get_current_blog_id') ? max(1, (int) get_current_blog_id()) : 1;

        return $content . '/cache/kodety-rocket/' . $blogId . '/assets';
    }

    /** @param resource $handle */
    private function openedFileMatchesPath($handle, string $path): bool
    {
        if (is_link($path)) {
            return false;
        }
        $opened = @fstat($handle);
        $named = @lstat($path);

        return is_array($opened)
            && is_array($named)
            && isset($opened['dev'], $opened['ino'], $named['dev'], $named['ino'])
            && (string) $opened['dev'] === (string) $named['dev']
            && (string) $opened['ino'] === (string) $named['ino'];
    }

    private function replaceAttribute(string $tag, string $attribute, string $url): string
    {
        $escaped = function_exists('esc_url') ? esc_url($url) : htmlspecialchars($url, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $pattern = '/(\b' . preg_quote($attribute, '/') . '\s*=\s*)(["\'])(.*?)\2/i';
        $updated = preg_replace_callback(
            $pattern,
            static fn (array $match): string => $match[1] . $match[2] . $escaped . $match[2],
            $tag,
            1
        );

        return is_string($updated) ? $updated : $tag;
    }

    private function attribute(string $tag, string $name): string
    {
        if (preg_match('/\b' . preg_quote($name, '/') . '\s*=\s*(["\'])(.*?)\1/i', $tag, $match) !== 1) {
            return '';
        }

        return html_entity_decode((string) ($match[2] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    private function isJQuery(string $handle, string $url): bool
    {
        $value = strtolower($handle . ' ' . $url);

        return preg_match('/(^|[\/_\-. ])jquery(?:[\/_\-.? ]|$)/', $value) === 1;
    }

    private function isSpecialScriptTag(string $tag): bool
    {
        return preg_match('/\snomodule(?:\s|=|>)/i', $tag) === 1
            || preg_match('/\stype\s*=\s*(?:["\'](?:module|importmap|speculationrules)["\']|(?:module|importmap|speculationrules)(?=\s|>))/i', $tag) === 1;
    }
}
