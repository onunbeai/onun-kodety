<?php

declare(strict_types=1);

namespace KodetyRocket\Cache;

use InvalidArgumentException;
use JsonSerializable;

/**
 * Immutable, normalized identity for a page-cache entry.
 *
 * Query parameters are deliberately conservative: ignored parameters are
 * removed, allowed parameters become part of the key, and every unknown
 * parameter makes the request ineligible for caching.
 */
final class CacheKey implements JsonSerializable
{
    private const KEY_VERSION = 'page-v1';

    /**
     * @param array<string, mixed> $query
     * @param list<string>         $variants
     */
    private function __construct(
        private int $blogId,
        private string $scheme,
        private string $authority,
        private string $path,
        private array $query,
        private array $variants = [],
    ) {
    }

    /**
     * Builds a cache key from a request without trusting global state when
     * explicit request data is supplied.
     *
     * @param array<string, mixed>|null $server
     * @param array<string, mixed>|null $query
     * @param list<string>              $ignore Query keys that are safe to discard.
     * @param list<string>              $allow  Query keys whose values affect HTML.
     */
    public static function fromRequest(
        ?array $server = null,
        ?array $query = null,
        ?int $blogId = null,
        array $ignore = [],
        array $allow = [],
    ): ?self {
        $server ??= $_SERVER;

        $method = strtoupper((string) ($server['REQUEST_METHOD'] ?? 'GET'));
        if (! in_array($method, ['GET', 'HEAD'], true)) {
            return null;
        }

        $scheme = self::requestScheme($server);
        $rawHost = trim((string) ($server['HTTP_HOST'] ?? $server['SERVER_NAME'] ?? ''));
        $authority = self::normalizeAuthority($rawHost, $scheme);
        if ($authority === null) {
            return null;
        }

        $requestUri = (string) ($server['REQUEST_URI'] ?? '/');
        if ($requestUri === '' || preg_match('/[\x00-\x1F\x7F]/', $requestUri) === 1) {
            return null;
        }

        $parts = parse_url($requestUri);
        if ($parts === false) {
            return null;
        }

        $path = self::normalizePath((string) ($parts['path'] ?? '/'));
        if ($path === null) {
            return null;
        }

        if ($query === null) {
            $query = [];
            $rawQuery = (string) ($parts['query'] ?? '');
            if ($rawQuery !== '') {
                parse_str($rawQuery, $query);
            }
        }

        return self::create(
            $blogId ?? self::currentBlogId(),
            $scheme,
            $authority,
            $path,
            $query,
            $ignore,
            $allow,
        );
    }

    /**
     * @param list<string> $ignore
     * @param list<string> $allow
     */
    public static function fromUrl(
        string $url,
        ?int $blogId = null,
        array $ignore = [],
        array $allow = [],
    ): ?self {
        $url = trim($url);
        if ($url === '' || preg_match('/[\x00-\x1F\x7F]/', $url) === 1) {
            return null;
        }

        $parts = parse_url($url);
        if ($parts === false || ! isset($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? 'https'));
        if (! in_array($scheme, ['http', 'https'], true)) {
            return null;
        }

        $rawHost = (string) $parts['host'];
        if (isset($parts['port'])) {
            $rawHost = self::formatHostForAuthority($rawHost) . ':' . (int) $parts['port'];
        }

        $authority = self::normalizeAuthority($rawHost, $scheme);
        $path = self::normalizePath((string) ($parts['path'] ?? '/'));
        if ($authority === null || $path === null) {
            return null;
        }

        $query = [];
        if (isset($parts['query']) && $parts['query'] !== '') {
            parse_str((string) $parts['query'], $query);
        }

        return self::create(
            $blogId ?? self::currentBlogId(),
            $scheme,
            $authority,
            $path,
            $query,
            $ignore,
            $allow,
        );
    }

    /**
     * Adds a logical HTML dimension (for example "language:pt-BR").
     * Encodings are intentionally not variants: gzip/br represent the same
     * logical body and are handled by the cache store.
     */
    public function variant(string $variant): self
    {
        $variant = trim($variant);
        if ($variant === '') {
            return $this;
        }

        if (strlen($variant) > 192
            || preg_match('/[\x00-\x1F\x7F]/', $variant) === 1
            || preg_match('//u', $variant) !== 1) {
            throw new InvalidArgumentException('Invalid cache-key variant.');
        }

        $variants = $this->variants;
        $variants[] = $variant;
        $variants = array_values(array_unique($variants));
        sort($variants, SORT_STRING);

        return new self(
            $this->blogId,
            $this->scheme,
            $this->authority,
            $this->path,
            $this->query,
            $variants,
        );
    }

    public function hash(): string
    {
        $payload = json_encode(
            [
                'version' => self::KEY_VERSION,
                'blog' => $this->blogId,
                'scheme' => $this->scheme,
                'authority' => $this->authority,
                'path' => $this->path,
                'query' => $this->query,
                'variants' => $this->variants,
            ],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );

        return hash('sha256', $payload);
    }

    public function blogId(): int
    {
        return $this->blogId;
    }

    public function scheme(): string
    {
        return $this->scheme;
    }

    public function host(): string
    {
        return $this->authority;
    }

    public function path(): string
    {
        return $this->path;
    }

    /** @return array<string, mixed> */
    public function query(): array
    {
        return $this->query;
    }

    /** @return list<string> */
    public function variants(): array
    {
        return $this->variants;
    }

    public function canonicalUrl(): string
    {
        $url = $this->scheme . '://' . $this->authority . $this->path;
        if ($this->query !== []) {
            $url .= '?' . http_build_query($this->query, '', '&', PHP_QUERY_RFC3986);
        }

        return $url;
    }

    /**
     * Returns a path composed only of numeric and SHA-256 segments:
     * {blog}/pages/{host hash}/{path hash}/{full key hash}.
     */
    public function relativePath(): string
    {
        return $this->scopeRelativePath() . '/' . $this->hash();
    }

    /**
     * Directory shared by query and logical variants of one host/path.
     */
    public function scopeRelativePath(): string
    {
        $hostHash = hash('sha256', $this->scheme . '://' . $this->authority);
        $pathHash = hash('sha256', $this->path);

        return $this->blogId . '/pages/' . $hostHash . '/' . $pathHash;
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return [
            'blog_id' => $this->blogId,
            'scheme' => $this->scheme,
            'host' => $this->authority,
            'path' => $this->path,
            'query' => $this->query,
            'variants' => $this->variants,
            'canonical_url' => $this->canonicalUrl(),
            'hash' => $this->hash(),
        ];
    }

    /**
     * @param array<string, mixed> $query
     * @param list<string>         $ignore
     * @param list<string>         $allow
     */
    private static function create(
        int $blogId,
        string $scheme,
        string $authority,
        string $path,
        array $query,
        array $ignore,
        array $allow,
    ): ?self {
        if ($blogId < 1) {
            return null;
        }

        $normalizedQuery = self::normalizeQuery($query, $ignore, $allow);
        if ($normalizedQuery === null) {
            return null;
        }

        return new self($blogId, $scheme, $authority, $path, $normalizedQuery);
    }

    /**
     * @param array<string, mixed> $query
     * @param list<string>         $ignore
     * @param list<string>         $allow
     * @return array<string, mixed>|null
     */
    private static function normalizeQuery(array $query, array $ignore, array $allow): ?array
    {
        if (count($query) > 100) {
            return null;
        }

        $ignoreMap = self::parameterMap($ignore);
        $allowMap = self::parameterMap($allow);
        $allowAll = isset($allowMap['*']);
        $normalized = [];

        foreach ($query as $key => $value) {
            $key = (string) $key;
            if ($key === ''
                || strlen($key) > 190
                || preg_match('/[\x00-\x1F\x7F]/', $key) === 1
                || preg_match('//u', $key) !== 1) {
                return null;
            }

            if (isset($ignoreMap[$key])) {
                continue;
            }

            if (! $allowAll && ! isset($allowMap[$key])) {
                return null;
            }

            $value = self::normalizeQueryValue($value, 0);
            if ($value === null && $query[$key] !== null) {
                return null;
            }

            $normalized[$key] = $value;
        }

        ksort($normalized, SORT_STRING);

        return $normalized;
    }

    private static function normalizeQueryValue(mixed $value, int $depth): mixed
    {
        if ($depth > 6) {
            return null;
        }

        if (is_array($value)) {
            if (count($value) > 100) {
                return null;
            }

            $normalized = [];
            foreach ($value as $key => $item) {
                if (! is_int($key) && ! is_string($key)) {
                    return null;
                }

                $normalizedItem = self::normalizeQueryValue($item, $depth + 1);
                if ($normalizedItem === null && $item !== null) {
                    return null;
                }

                $normalized[$key] = $normalizedItem;
            }

            if (! self::isList($normalized)) {
                ksort($normalized, SORT_STRING);
            }

            return $normalized;
        }

        if ($value === null) {
            return '';
        }

        if (is_bool($value)) {
            return $value ? '1' : '0';
        }

        if (is_float($value) && ! is_finite($value)) {
            return null;
        }

        if (is_int($value) || is_float($value) || is_string($value)) {
            $value = (string) $value;

            return strlen($value) <= 4096 && preg_match('//u', $value) === 1 ? $value : null;
        }

        return null;
    }

    /** @param list<string> $parameters */
    private static function parameterMap(array $parameters): array
    {
        $map = [];
        foreach ($parameters as $parameter) {
            if (is_string($parameter) && $parameter !== '') {
                $map[$parameter] = true;
            }
        }

        return $map;
    }

    /** PHP 8.0-compatible equivalent of array_is_list(). */
    private static function isList(array $value): bool
    {
        $expected = 0;
        foreach ($value as $key => $unused) {
            if ($key !== $expected) {
                return false;
            }
            $expected++;
        }

        return true;
    }

    /** @param array<string, mixed> $server */
    private static function requestScheme(array $server): string
    {
        $https = strtolower((string) ($server['HTTPS'] ?? ''));
        if ($https !== '' && $https !== 'off' && $https !== '0') {
            return 'https';
        }

        if (strtolower((string) ($server['REQUEST_SCHEME'] ?? '')) === 'https') {
            return 'https';
        }

        return (int) ($server['SERVER_PORT'] ?? 0) === 443 ? 'https' : 'http';
    }

    private static function normalizeAuthority(string $authority, string $scheme): ?string
    {
        if ($authority === ''
            || strlen($authority) > 255
            || str_contains($authority, '@')
            || preg_match('/[\s\\\\\/?#]/', $authority) === 1) {
            return null;
        }

        $parts = parse_url($scheme . '://' . $authority);
        if ($parts === false || ! isset($parts['host'])) {
            return null;
        }

        $host = strtolower(rtrim((string) $parts['host'], '.'));
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $host = substr($host, 1, -1);
        }
        if ($host === '') {
            return null;
        }

        if (function_exists('idn_to_ascii') && preg_match('/[^\x20-\x7E]/', $host) === 1) {
            $ascii = idn_to_ascii($host, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if ($ascii === false) {
                return null;
            }
            $host = strtolower($ascii);
        }

        $isIp = filter_var($host, FILTER_VALIDATE_IP) !== false;
        if (! $isIp && preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $host) !== 1) {
            return null;
        }

        $port = isset($parts['port']) ? (int) $parts['port'] : null;
        if ($port !== null && ($port < 1 || $port > 65535)) {
            return null;
        }

        if (($scheme === 'http' && $port === 80) || ($scheme === 'https' && $port === 443)) {
            $port = null;
        }

        $normalized = self::formatHostForAuthority($host);

        return $port === null ? $normalized : $normalized . ':' . $port;
    }

    private static function formatHostForAuthority(string $host): string
    {
        return str_contains($host, ':') && $host[0] !== '[' ? '[' . $host . ']' : $host;
    }

    private static function normalizePath(string $path): ?string
    {
        if ($path === '') {
            return '/';
        }

        if (preg_match('/%(?![0-9A-Fa-f]{2})/', $path) === 1 || preg_match('/[\x00-\x1F\x7F]/', $path) === 1) {
            return null;
        }

        $path = '/' . ltrim($path, '/');
        $hadTrailingSlash = str_ends_with($path, '/');
        $segments = preg_split('#/+#', $path) ?: [];
        $normalized = [];

        foreach ($segments as $segment) {
            if ($segment === '') {
                continue;
            }

            $segment = self::normalizePathSegment($segment);
            if ($segment === '.') {
                continue;
            }
            if ($segment === '..') {
                array_pop($normalized);
                continue;
            }

            $normalized[] = $segment;
        }

        $result = '/' . implode('/', $normalized);
        if ($hadTrailingSlash && $result !== '/') {
            $result .= '/';
        }

        return $result;
    }

    private static function normalizePathSegment(string $segment): string
    {
        $result = '';
        $length = strlen($segment);
        $allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@";

        for ($index = 0; $index < $length; $index++) {
            $character = $segment[$index];
            if ($character === '%' && $index + 2 < $length) {
                $hex = strtoupper(substr($segment, $index + 1, 2));
                $decoded = chr((int) hexdec($hex));
                if (str_contains('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~', $decoded)) {
                    $result .= $decoded;
                } else {
                    $result .= '%' . $hex;
                }
                $index += 2;
                continue;
            }

            if (str_contains($allowed, $character)) {
                $result .= $character;
                continue;
            }

            $result .= sprintf('%%%02X', ord($character));
        }

        return $result;
    }

    private static function currentBlogId(): int
    {
        if (function_exists('get_current_blog_id')) {
            return max(1, (int) get_current_blog_id());
        }

        return 1;
    }
}
