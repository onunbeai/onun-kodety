<?php

declare(strict_types=1);

namespace KodetyRocket\Http;

use KodetyRocket\Settings\SettingsRepository;

/**
 * Conservative request eligibility gate. A false negative costs performance;
 * a false positive can leak personalized content, so uncertain requests fail
 * closed for caching while the rest of the site keeps running normally.
 */
final class RequestGate
{
    private SettingsRepository $settings;
    private string $lastReason = 'not_evaluated';

    public function __construct(SettingsRepository $settings)
    {
        $this->settings = $settings;
    }

    public function shouldCache(): bool
    {
        if ($this->bypassed()) {
            return $this->deny('kill_switch');
        }

        if (!(bool) $this->settings->get('page_cache_enabled', true)) {
            return $this->deny('cache_disabled');
        }

        if ($this->invalidationPending()) {
            return $this->deny('invalidation_pending');
        }

        $method = $this->method();
        if (!in_array($method, ['GET', 'HEAD'], true)) {
            return $this->deny('unsafe_method');
        }

        if (!empty($_SERVER['HTTP_RANGE']) || !empty($_SERVER['HTTP_IF_RANGE'])) {
            return $this->deny('range_request');
        }

        if (!empty($_SERVER['HTTP_IF_MATCH']) || !empty($_SERVER['HTTP_IF_UNMODIFIED_SINCE'])) {
            return $this->deny('unsupported_precondition');
        }

        if (!$this->acceptsHtml()) {
            return $this->deny('representation_not_html');
        }

        if (!$this->acceptsSupportedEncoding()) {
            return $this->deny('representation_encoding_not_acceptable');
        }

        if (!empty($_POST)) {
            return $this->deny('request_body');
        }

        if ($this->requestsFreshResponse()) {
            return $this->deny('client_no_cache');
        }

        if ((defined('DONOTCACHEPAGE') && DONOTCACHEPAGE)
            || (defined('WP_CACHE') && !WP_CACHE && defined('KODETY_ROCKET_REQUIRE_WP_CACHE') && KODETY_ROCKET_REQUIRE_WP_CACHE)) {
            return $this->deny('wordpress_no_cache');
        }

        if ((defined('REST_REQUEST') && REST_REQUEST)
            || (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST)
            || (defined('WP_CLI') && WP_CLI)
            || (defined('DOING_AJAX') && DOING_AJAX)
            || (defined('DOING_CRON') && DOING_CRON)) {
            return $this->deny('non_page_runtime');
        }

        if ((function_exists('is_admin') && is_admin())
            || (function_exists('wp_doing_ajax') && wp_doing_ajax())
            || (function_exists('wp_doing_cron') && wp_doing_cron())
            || (function_exists('is_user_logged_in') && is_user_logged_in())) {
            return $this->deny('private_runtime');
        }

        foreach (['is_feed', 'is_trackback', 'is_preview', 'is_customize_preview', 'is_robots', 'is_search'] as $conditional) {
            if (function_exists($conditional) && $conditional()) {
                return $this->deny('special_response');
            }
        }

        if ($this->hasAuthorization() || $this->hasSensitiveCookie()) {
            return $this->deny('private_credentials');
        }

        if (!$this->hostIsLocal()) {
            return $this->deny('unrecognized_host');
        }

        $path = $this->path();
        if ($this->isExcludedPath($path)) {
            return $this->deny('excluded_path');
        }

        if (!$this->queryIsAllowed()) {
            return $this->deny('query_not_allowed');
        }

        $this->lastReason = 'eligible';

        return true;
    }

    /**
     * Ignored query parameters may reuse a clean cached representation, but a
     * response rendered with those values must never populate that clean key.
     */
    public function shouldWriteCache(): bool
    {
        if (!$this->shouldCache()) {
            return false;
        }

        if ($this->hasIgnoredQueryParameters()) {
            return $this->deny('ignored_query_write');
        }

        return true;
    }

    public function shouldOptimizeHtml(): bool
    {
        return $this->allowsTransformations()
            && (bool) $this->settings->get('lazy_load_enabled', false);
    }

    public function allowsTransformations(): bool
    {
        if ($this->bypassed()
            || $this->method() !== 'GET'
            || !$this->acceptsHtml()
            || $this->isCurrentPathExcluded()
            || $this->requestForbidsTransformation()
            || (defined('REST_REQUEST') && REST_REQUEST)
            || (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST)
            || (function_exists('is_admin') && is_admin())
            || (function_exists('wp_doing_ajax') && wp_doing_ajax())
            || (function_exists('wp_doing_cron') && wp_doing_cron())
            || (function_exists('is_user_logged_in') && is_user_logged_in())
            || $this->hasAuthorization()
            || $this->hasSensitiveCookie()) {
            return false;
        }

        foreach (['is_feed', 'is_trackback', 'is_preview', 'is_customize_preview', 'is_robots', 'is_search'] as $conditional) {
            if (function_exists($conditional) && $conditional()) {
                return false;
            }
        }

        return true;
    }

    public function method(): string
    {
        return strtoupper(isset($_SERVER['REQUEST_METHOD']) && is_string($_SERVER['REQUEST_METHOD'])
            ? $_SERVER['REQUEST_METHOD']
            : 'GET');
    }

    public function path(): string
    {
        $uri = isset($_SERVER['REQUEST_URI']) && is_string($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
        $path = parse_url($uri, PHP_URL_PATH);

        return is_string($path) && $path !== '' ? '/' . ltrim(rawurldecode($path), '/') : '/';
    }

    public function acceptsGzip(): bool
    {
        return (bool) $this->settings->get('gzip_enabled', true)
            && $this->contentCodingQuality('gzip') > 0.0;
    }

    public function acceptsIdentity(): bool
    {
        return $this->contentCodingQuality('identity') > 0.0;
    }

    public function acceptsEncoding(string $encoding): bool
    {
        return match (strtolower($encoding)) {
            'gzip' => $this->acceptsGzip(),
            'identity' => $this->acceptsIdentity(),
            default => false,
        };
    }

    public function lastReason(): string
    {
        return $this->lastReason;
    }

    public function isCurrentPathExcluded(): bool
    {
        return $this->isExcludedPath($this->path());
    }

    /** @return list<string> */
    public function ignoredQueryParameters(): array
    {
        $value = $this->settings->get('ignored_query_parameters', []);

        return is_array($value) ? array_values(array_map('strval', $value)) : [];
    }

    /** @return list<string> */
    public function allowedQueryParameters(): array
    {
        $value = $this->settings->get('query_allowlist', []);

        return is_array($value) ? array_values(array_map('strval', $value)) : [];
    }

    public function hasIgnoredQueryParameters(): bool
    {
        if (empty($_GET)) {
            return false;
        }

        $ignored = array_flip($this->ignoredQueryParameters());
        foreach (array_keys($_GET) as $rawKey) {
            if (isset($ignored[(string) $rawKey])) {
                return true;
            }
        }

        return false;
    }

    private function queryIsAllowed(): bool
    {
        if (empty($_GET)) {
            return true;
        }

        $ignored = array_flip($this->ignoredQueryParameters());
        $allowed = array_flip($this->allowedQueryParameters());

        foreach (array_keys($_GET) as $rawKey) {
            $key = (string) $rawKey;
            if (isset($ignored[$key])) {
                continue;
            }
            if (!isset($allowed[$key])) {
                return false;
            }

            $value = $_GET[$rawKey] ?? null;
            if (is_array($value) && count($value) > 50) {
                return false;
            }
        }

        return true;
    }

    private function hasAuthorization(): bool
    {
        return !empty($_SERVER['HTTP_AUTHORIZATION'])
            || !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])
            || !empty($_SERVER['PHP_AUTH_USER'])
            || !empty($_SERVER['PHP_AUTH_PW']);
    }

    private function requestsFreshResponse(): bool
    {
        $cacheControl = isset($_SERVER['HTTP_CACHE_CONTROL']) && is_string($_SERVER['HTTP_CACHE_CONTROL'])
            ? strtolower($_SERVER['HTTP_CACHE_CONTROL'])
            : '';
        if (preg_match('/(?:^|,)\s*(?:no-cache|no-store)\b/', $cacheControl) === 1
            || preg_match('/(?:^|,)\s*(?:max-age|min-fresh)\b/', $cacheControl) === 1) {
            return true;
        }

        $pragma = isset($_SERVER['HTTP_PRAGMA']) && is_string($_SERVER['HTTP_PRAGMA'])
            ? strtolower($_SERVER['HTTP_PRAGMA'])
            : '';

        return strpos($pragma, 'no-cache') !== false;
    }

    private function requestForbidsTransformation(): bool
    {
        $cacheControl = isset($_SERVER['HTTP_CACHE_CONTROL']) && is_string($_SERVER['HTTP_CACHE_CONTROL'])
            ? strtolower($_SERVER['HTTP_CACHE_CONTROL'])
            : '';

        return preg_match('/(?:^|,)\s*no-transform\b/', $cacheControl) === 1;
    }

    private function acceptsHtml(): bool
    {
        $destination = isset($_SERVER['HTTP_SEC_FETCH_DEST']) && is_string($_SERVER['HTTP_SEC_FETCH_DEST'])
            ? strtolower(trim($_SERVER['HTTP_SEC_FETCH_DEST']))
            : '';
        if ($destination !== '' && !in_array($destination, ['document', 'iframe'], true)) {
            return false;
        }

        $accept = isset($_SERVER['HTTP_ACCEPT']) && is_string($_SERVER['HTTP_ACCEPT'])
            ? strtolower($_SERVER['HTTP_ACCEPT'])
            : '';

        if ($accept === '') {
            return true;
        }

        $htmlQuality = $this->mediaTypeQuality($accept, 'text', 'html');
        if ($htmlQuality <= 0.0 && $this->hasExactMediaRange($accept, 'text', 'html')) {
            // An explicit text/html refusal wins over a broader wildcard. Code
            // Rocket cannot assume WordPress will switch to XHTML later.
            return false;
        }

        return $htmlQuality > 0.0
            || $this->mediaTypeQuality($accept, 'application', 'xhtml+xml') > 0.0;
    }

    private function acceptsSupportedEncoding(): bool
    {
        return $this->acceptsIdentity() || $this->acceptsGzip();
    }

    private function contentCodingQuality(string $coding): float
    {
        $header = isset($_SERVER['HTTP_ACCEPT_ENCODING']) && is_string($_SERVER['HTTP_ACCEPT_ENCODING'])
            ? strtolower(trim($_SERVER['HTTP_ACCEPT_ENCODING']))
            : '';
        if ($header === '') {
            return $coding === 'identity' ? 1.0 : 0.0;
        }

        $exact = null;
        $wildcard = null;
        foreach (explode(',', $header) as $item) {
            $parts = array_map('trim', explode(';', $item));
            $name = strtolower((string) array_shift($parts));
            if ($name !== $coding && $name !== '*') {
                continue;
            }

            $quality = $this->qualityParameter($parts);
            if ($name === $coding) {
                $exact = $exact === null ? $quality : min($exact, $quality);
            } else {
                $wildcard = $wildcard === null ? $quality : min($wildcard, $quality);
            }
        }

        if ($exact !== null) {
            return $exact;
        }
        if ($wildcard !== null) {
            return $wildcard;
        }

        return $coding === 'identity' ? 1.0 : 0.0;
    }

    private function mediaTypeQuality(string $header, string $type, string $subtype): float
    {
        $bestSpecificity = -1;
        $bestQuality = 0.0;

        foreach (explode(',', $header) as $item) {
            $parts = array_map('trim', explode(';', $item));
            $range = strtolower((string) array_shift($parts));
            if (preg_match('@^([!#$%&\'*+.^_`|~0-9a-z-]+|\*)/([!#$%&\'*+.^_`|~0-9a-z-]+|\*)$@D', $range, $match) !== 1) {
                continue;
            }

            $rangeType = $match[1];
            $rangeSubtype = $match[2];
            if (($rangeType !== '*' && $rangeType !== $type)
                || ($rangeSubtype !== '*' && $rangeSubtype !== $subtype)) {
                continue;
            }

            $specificity = $rangeType === '*' ? 0 : ($rangeSubtype === '*' ? 1 : 2);
            $quality = $this->qualityParameter($parts);
            if ($specificity > $bestSpecificity) {
                $bestSpecificity = $specificity;
                $bestQuality = $quality;
            } elseif ($specificity === $bestSpecificity) {
                $bestQuality = max($bestQuality, $quality);
            }
        }

        return $bestSpecificity >= 0 ? $bestQuality : 0.0;
    }

    private function hasExactMediaRange(string $header, string $type, string $subtype): bool
    {
        $expected = strtolower($type . '/' . $subtype);
        foreach (explode(',', $header) as $item) {
            $range = strtolower(trim((string) strtok($item, ';')));
            if ($range === $expected) {
                return true;
            }
        }

        return false;
    }

    /** @param list<string> $parameters */
    private function qualityParameter(array $parameters): float
    {
        $quality = 1.0;
        foreach ($parameters as $parameter) {
            if (strpos($parameter, '=') === false) {
                continue;
            }
            [$name, $value] = array_map('trim', explode('=', $parameter, 2));
            if (strtolower($name) !== 'q') {
                continue;
            }

            if (preg_match('/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/D', $value) !== 1) {
                return 0.0;
            }
            $quality = min($quality, (float) $value);
        }

        return $quality;
    }

    private function invalidationPending(): bool
    {
        $sitePending = function_exists('get_option')
            && (bool) get_option('kodety_rocket_cache_purge_pending', false);
        $networkPending = function_exists('get_site_option')
            && (bool) get_site_option('kodety_rocket_cache_network_purge_pending', false);

        return $sitePending || $networkPending;
    }

    private function hostIsLocal(): bool
    {
        $requestAuthority = isset($_SERVER['HTTP_HOST']) && is_string($_SERVER['HTTP_HOST'])
            ? trim($_SERVER['HTTP_HOST'])
            : '';
        if ($requestAuthority === '') {
            return false;
        }

        $https = isset($_SERVER['HTTPS']) ? strtolower((string) $_SERVER['HTTPS']) : '';
        $scheme = ($https !== '' && $https !== 'off' && $https !== '0')
            || strtolower((string) ($_SERVER['REQUEST_SCHEME'] ?? '')) === 'https'
            || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443
            ? 'https'
            : 'http';
        $requestOrigin = $this->normalizedOrigin($scheme . '://' . $requestAuthority . '/');
        if ($requestOrigin === null) {
            return false;
        }

        $localOrigins = [];
        foreach (['home_url', 'site_url'] as $function) {
            if (!function_exists($function)) {
                continue;
            }
            $origin = $this->normalizedOrigin((string) $function('/'));
            if ($origin !== null) {
                $localOrigins[] = $origin;
            }
        }

        // During isolated tests WordPress URL helpers may be absent; CacheKey
        // still validates host syntax before a filesystem path is produced.
        return $localOrigins === [] || in_array($requestOrigin, array_unique($localOrigins), true);
    }

    private function normalizedOrigin(string $url): ?string
    {
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['host'])) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true)) {
            return null;
        }
        $host = strtolower(rtrim(trim((string) $parts['host'], '[]'), '.'));
        if ($host === '') {
            return null;
        }
        $port = isset($parts['port']) ? (int) $parts['port'] : ($scheme === 'https' ? 443 : 80);

        return $scheme . '://' . $host . ':' . $port;
    }

    private function hasSensitiveCookie(): bool
    {
        if (empty($_COOKIE)) {
            return false;
        }

        $safePatterns = [
            '/^wordpress_test_cookie$/i',
            '/^wpEmojiSettingsSupports$/',
            '/^_ga(?:_[A-Z0-9]+)?$/i',
            '/^_gid$/i',
            '/^_gat(?:_[A-Z0-9_]+)?$/i',
            '/^_gcl_au$/i',
            '/^_fbp$/i',
            '/^__utm[a-z]$/i',
            '/^__cf_bm$/i',
            '/^_cfuvid$/i',
        ];
        if (function_exists('apply_filters')) {
            $safePatterns = (array) apply_filters('kodety_rocket_safe_cookie_patterns', $safePatterns);
        }

        foreach (array_keys($_COOKIE) as $cookieName) {
            $safe = false;
            foreach ($safePatterns as $pattern) {
                if (is_string($pattern) && @preg_match($pattern, (string) $cookieName) === 1) {
                    $safe = true;
                    break;
                }
            }
            if (!$safe) {
                return true;
            }
        }

        return false;
    }

    private function isExcludedPath(string $path): bool
    {
        $excluded = $this->settings->get('excluded_paths', []);
        if (!is_array($excluded)) {
            return false;
        }

        foreach ($excluded as $candidate) {
            $candidate = '/' . ltrim((string) $candidate, '/');
            if ($candidate !== '/' && (strcasecmp($path, rtrim($candidate, '/')) === 0 || stripos($path, $candidate) === 0)) {
                return true;
            }
        }

        return false;
    }

    private function bypassed(): bool
    {
        return defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS;
    }

    private function deny(string $reason): bool
    {
        $this->lastReason = $reason;

        return false;
    }
}
