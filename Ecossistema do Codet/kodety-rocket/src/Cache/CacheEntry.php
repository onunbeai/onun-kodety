<?php

declare(strict_types=1);

namespace KodetyRocket\Cache;

use InvalidArgumentException;
use JsonException;

/**
 * Immutable cached HTTP representation.
 *
 * The body is deliberately kept out of metadata serialization. A metadata
 * record contains a SHA-256 digest so partial/corrupt writes become misses.
 */
final class CacheEntry
{
    /** @var array<string, string> */
    private array $headers;

    /** @var list<string> */
    private array $vary;

    /** @var list<string> */
    private array $tags;

    /** @var array<string, mixed> */
    private array $metadata;

    private bool $containsSetCookie = false;

    /**
     * @param array<string, string|int|float|list<string>> $headers
     * @param list<string>                                 $vary
     * @param list<string>                                 $tags
     * @param array<string, mixed>                         $metadata
     */
    public function __construct(
        private string $body,
        private int $ttl = 3600,
        array $headers = [],
        private int $status = 200,
        ?int $createdAt = null,
        array $vary = [],
        private string $encoding = 'identity',
        array $tags = [],
        array $metadata = [],
    ) {
        if ($ttl < 1) {
            throw new InvalidArgumentException('Cache TTL must be greater than zero.');
        }

        if ($status < 100 || $status > 599) {
            throw new InvalidArgumentException('Invalid cached HTTP status.');
        }

        if (! in_array($encoding, ['identity', 'gzip', 'br'], true)) {
            throw new InvalidArgumentException('Unsupported cache encoding.');
        }

        $createdAt ??= time();
        if ($createdAt < 0) {
            throw new InvalidArgumentException('Invalid cache creation time.');
        }

        $this->createdAt = $createdAt;
        $this->containsSetCookie = self::containsHeader($headers, 'set-cookie');
        $this->headers = self::normalizeHeaders($headers);

        $headerVary = isset($this->headers['Vary'])
            ? preg_split('/\s*,\s*/', $this->headers['Vary'], -1, PREG_SPLIT_NO_EMPTY)
            : [];
        $this->vary = self::normalizeTokens(array_merge($vary, $headerVary ?: []));
        if ($encoding !== 'identity' && ! in_array('Accept-Encoding', $this->vary, true)) {
            $this->vary[] = 'Accept-Encoding';
            sort($this->vary, SORT_STRING | SORT_FLAG_CASE);
        }

        if ($this->vary !== []) {
            $this->headers['Vary'] = implode(', ', $this->vary);
        } else {
            unset($this->headers['Vary']);
        }

        if ($encoding === 'identity') {
            unset($this->headers['Content-Encoding']);
        } else {
            $this->headers['Content-Encoding'] = $encoding;
        }

        $this->headers['Content-Length'] = (string) strlen($body);
        $this->headers['Last-Modified'] ??= gmdate('D, d M Y H:i:s', $createdAt) . ' GMT';
        $this->headers['ETag'] ??= '"' . hash('sha256', $body) . '"';

        $this->tags = self::normalizeTags($tags);
        $this->metadata = self::normalizeMetadata($metadata);
    }

    private int $createdAt;

    public function body(): string
    {
        return $this->body;
    }

    public function ttl(): int
    {
        return $this->ttl;
    }

    public function status(): int
    {
        return $this->status;
    }

    public function statusCode(): int
    {
        return $this->status;
    }

    public function createdAt(): int
    {
        return $this->createdAt;
    }

    public function expiresAt(): int
    {
        if ($this->createdAt > PHP_INT_MAX - $this->ttl) {
            return PHP_INT_MAX;
        }

        return $this->createdAt + $this->ttl;
    }

    public function isExpired(?int $at = null): bool
    {
        return ($at ?? time()) >= $this->expiresAt();
    }

    public function isFresh(?int $at = null): bool
    {
        return ! $this->isExpired($at);
    }

    /** @return array<string, string> */
    public function headers(): array
    {
        return $this->headers;
    }

    public function header(string $name): ?string
    {
        $name = self::canonicalHeaderName($name);

        return $this->headers[$name] ?? null;
    }

    /** @return list<string> */
    public function vary(): array
    {
        return $this->vary;
    }

    public function encoding(): string
    {
        return $this->encoding;
    }

    /** @return list<string> */
    public function tags(): array
    {
        return $this->tags;
    }

    /** @return array<string, mixed> */
    public function metadata(): array
    {
        return $this->metadata;
    }

    /**
     * A Vary: * response must never enter a shared page cache.
     */
    public function isSharedCacheable(): bool
    {
        $cacheControl = strtolower($this->headers['Cache-Control'] ?? '');

        return $this->status === 200
            && ! $this->containsSetCookie
            && ! in_array('*', $this->vary, true)
            && preg_match('/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s*(?:=|,|$))/', $cacheControl) !== 1
            && $this->ttl > 0;
    }

    /**
     * Creates another wire representation of the same logical response.
     */
    public function withBodyAndEncoding(string $body, string $encoding): self
    {
        $headers = $this->headers;
        unset($headers['Content-Length'], $headers['Content-Encoding'], $headers['ETag']);

        $entry = new self(
            $body,
            $this->ttl,
            $headers,
            $this->status,
            $this->createdAt,
            $this->vary,
            $encoding,
            $this->tags,
            $this->metadata,
        );
        $entry->containsSetCookie = $this->containsSetCookie;

        return $entry;
    }

    /** @param list<string> $tags */
    public function withTags(array $tags): self
    {
        $entry = new self(
            $this->body,
            $this->ttl,
            $this->headers,
            $this->status,
            $this->createdAt,
            $this->vary,
            $this->encoding,
            array_merge($this->tags, $tags),
            $this->metadata,
        );
        $entry->containsSetCookie = $this->containsSetCookie;

        return $entry;
    }

    /**
     * Serializes metadata only; the body is persisted separately.
     *
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    public function toMetadata(array $extra = []): array
    {
        return array_merge(
            self::normalizeMetadata($this->metadata),
            self::normalizeMetadata($extra),
            [
                'schema' => 1,
                'status' => $this->status,
                'headers' => $this->headers,
                'created_at' => $this->createdAt,
                'ttl' => $this->ttl,
                'expires_at' => $this->expiresAt(),
                'vary' => $this->vary,
                'encoding' => $this->encoding,
                'tags' => $this->tags,
                'body_bytes' => strlen($this->body),
                'body_sha256' => hash('sha256', $this->body),
            ],
        );
    }

    /**
     * @param array<string, mixed> $metadata
     */
    public static function fromMetadata(array $metadata, string $body): ?self
    {
        try {
            if ((int) ($metadata['schema'] ?? 0) !== 1) {
                return null;
            }

            $expectedLength = filter_var($metadata['body_bytes'] ?? null, FILTER_VALIDATE_INT);
            $expectedHash = (string) ($metadata['body_sha256'] ?? '');
            if ($expectedLength === false || $expectedLength !== strlen($body)) {
                return null;
            }
            if (preg_match('/^[a-f0-9]{64}$/', $expectedHash) !== 1
                || ! hash_equals($expectedHash, hash('sha256', $body))) {
                return null;
            }

            $headers = is_array($metadata['headers'] ?? null) ? $metadata['headers'] : [];
            $vary = is_array($metadata['vary'] ?? null) ? $metadata['vary'] : [];
            $tags = is_array($metadata['tags'] ?? null) ? $metadata['tags'] : [];
            $reserved = [
                'schema', 'status', 'headers', 'created_at', 'ttl', 'expires_at',
                'vary', 'encoding', 'tags', 'body_bytes', 'body_sha256',
            ];
            $extra = array_diff_key($metadata, array_fill_keys($reserved, true));

            return new self(
                $body,
                (int) ($metadata['ttl'] ?? 0),
                $headers,
                (int) ($metadata['status'] ?? 0),
                (int) ($metadata['created_at'] ?? 0),
                $vary,
                (string) ($metadata['encoding'] ?? 'identity'),
                $tags,
                $extra,
            );
        } catch (InvalidArgumentException | JsonException) {
            return null;
        }
    }

    /**
     * @param array<string, string|int|float|list<string>> $headers
     * @return array<string, string>
     */
    private static function normalizeHeaders(array $headers): array
    {
        $normalized = [];
        $hopByHop = [
            'Connection', 'Keep-Alive', 'Proxy-Authenticate', 'Proxy-Authorization',
            'TE', 'Trailer', 'Transfer-Encoding', 'Upgrade',
        ];

        foreach ($headers as $name => $value) {
            if (is_int($name) && is_string($value) && str_contains($value, ':')) {
                [$name, $value] = explode(':', $value, 2);
            }

            if (! is_string($name) || preg_match('/^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$/D', $name) !== 1) {
                continue;
            }

            $name = self::canonicalHeaderName($name);
            if (in_array($name, $hopByHop, true) || $name === 'Set-Cookie') {
                continue;
            }

            if (is_array($value)) {
                $value = implode(', ', array_map('strval', $value));
            } elseif (! is_scalar($value)) {
                continue;
            }

            $value = trim((string) $value);
            if ($value === '' || preg_match('/[\r\n]/', $value) === 1) {
                continue;
            }

            $normalized[$name] = $value;
        }

        ksort($normalized, SORT_STRING);

        return $normalized;
    }

    private static function canonicalHeaderName(string $name): string
    {
        $name = strtolower(trim($name));
        $name = implode('-', array_map('ucfirst', explode('-', $name)));

        return match ($name) {
            'Etag' => 'ETag',
            'Te' => 'TE',
            'Www-Authenticate' => 'WWW-Authenticate',
            default => $name,
        };
    }

    /** @param array<mixed> $headers */
    private static function containsHeader(array $headers, string $expected): bool
    {
        foreach ($headers as $name => $value) {
            if (is_string($name) && strtolower(trim($name)) === $expected) {
                return true;
            }
            if (is_int($name) && is_string($value) && str_contains($value, ':')) {
                $candidate = strtolower(trim((string) strstr($value, ':', true)));
                if ($candidate === $expected) {
                    return true;
                }
            }
        }

        return false;
    }

    /** @param list<mixed> $tokens @return list<string> */
    private static function normalizeTokens(array $tokens): array
    {
        $normalized = [];
        foreach ($tokens as $token) {
            if (! is_string($token)) {
                continue;
            }

            $token = trim($token);
            if ($token === '*') {
                $normalized['*'] = '*';
                continue;
            }

            if (preg_match('/^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$/D', $token) !== 1) {
                continue;
            }

            $canonical = self::canonicalHeaderName($token);
            $normalized[strtolower($canonical)] = $canonical;
        }

        $tokens = array_values($normalized);
        sort($tokens, SORT_STRING | SORT_FLAG_CASE);

        return $tokens;
    }

    /** @param list<mixed> $tags @return list<string> */
    private static function normalizeTags(array $tags): array
    {
        $normalized = [];
        foreach ($tags as $tag) {
            if (! is_scalar($tag)) {
                continue;
            }

            $tag = trim((string) $tag);
            if ($tag === '' || strlen($tag) > 190 || preg_match('/[\x00-\x1F\x7F]/', $tag) === 1) {
                continue;
            }

            $normalized[$tag] = true;
        }

        $tags = array_keys($normalized);
        sort($tags, SORT_STRING);

        return $tags;
    }

    /** @param array<string, mixed> $metadata @return array<string, mixed> */
    private static function normalizeMetadata(array $metadata): array
    {
        $normalized = self::normalizeMetadataValue($metadata, 0);

        return is_array($normalized) ? $normalized : [];
    }

    private static function normalizeMetadataValue(mixed $value, int $depth): mixed
    {
        if ($depth > 8) {
            return null;
        }

        if (is_array($value)) {
            $normalized = [];
            foreach ($value as $key => $item) {
                if (! is_int($key) && ! is_string($key)) {
                    continue;
                }
                $normalized[$key] = self::normalizeMetadataValue($item, $depth + 1);
            }

            return $normalized;
        }

        if (is_null($value) || is_bool($value) || is_int($value) || is_float($value) || is_string($value)) {
            return $value;
        }

        return null;
    }
}
