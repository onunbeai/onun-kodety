<?php

declare(strict_types=1);

namespace KodetyRocket\Http;

use KodetyRocket\Settings\SettingsRepository;

/** Verifies that a completed response is safe to transform and/or persist. */
final class ResponseGate
{
    private SettingsRepository $settings;
    private string $lastReason = 'not_evaluated';

    public function __construct(SettingsRepository $settings)
    {
        $this->settings = $settings;
    }

    /** @param list<string>|null $headers */
    public function shouldCache(string $body, ?int $status = null, ?array $headers = null): bool
    {
        if (defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS) {
            return $this->deny('kill_switch');
        }

        $status = $status ?? $this->statusCode();
        if ($status !== 200) {
            return $this->deny('status_not_cacheable');
        }

        $length = strlen($body);
        if ($length === 0 || $length > (int) $this->settings->get('max_response_bytes', 5242880)) {
            return $this->deny('body_size');
        }

        $headers = $headers ?? $this->responseHeaders();
        $map = $this->headerMap($headers);

        if (!$this->isHtml($body, $map)) {
            return $this->deny('not_html');
        }

        $unsafeReason = $this->unsafeHeaderReason($map, false);
        if ($unsafeReason !== null) {
            return $this->deny($unsafeReason);
        }
        if (preg_match('/\snonce\s*=\s*(?:["\'][^"\']+["\']|[^\s>]+)/i', $body) === 1) {
            return $this->deny('document_nonce');
        }

        if (stripos($body, '<!-- kodety-rocket:no-cache -->') !== false
            || stripos($body, '<!--nocache-->') !== false) {
            return $this->deny('document_opt_out');
        }

        $this->lastReason = 'eligible';

        return true;
    }

    /**
     * Revalidates decisions already made by WordPress and the normal
     * template_redirect gates before a cached response replaces the request.
     * A stored representation may carry Kodety Rocket's own encoding/freshness.
     *
     * @param array<int|string, mixed>|null $headers
     */
    public function shouldServeCached(
        ?int $status = null,
        ?array $headers = null,
        bool $cachedRepresentation = false
    ): bool {
        if (defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS) {
            return $this->deny('kill_switch');
        }

        $status = $status ?? $this->statusCode();
        if ($status !== 200) {
            return $this->deny('status_not_cacheable');
        }

        $map = $this->headerMap($headers ?? $this->responseHeaders());
        if (!$this->contentTypeAllowsHtml($map)) {
            return $this->deny('not_html');
        }

        $unsafeReason = $this->unsafeHeaderReason($map, $cachedRepresentation);
        if ($unsafeReason !== null) {
            return $this->deny($unsafeReason);
        }

        $this->lastReason = 'eligible';

        return true;
    }

    /** @param list<string>|null $headers */
    public function shouldTransform(string $body, ?int $status = null, ?array $headers = null): bool
    {
        $status = $status ?? $this->statusCode();
        if ($status < 200
            || $status >= 300
            || $body === ''
            || strlen($body) > (int) $this->settings->get('max_response_bytes', 5242880)) {
            return false;
        }

        $headers = $headers ?? $this->responseHeaders();
        $map = $this->headerMap($headers);

        if ($this->hasNoTransformDirective($headers)) {
            return false;
        }

        return $this->isHtml($body, $map);
    }

    /** @param array<int|string, mixed>|null $headers */
    public function hasNoTransformDirective(?array $headers = null): bool
    {
        $map = $this->headerMap($headers ?? $this->responseHeaders());
        foreach (['cache-control', 'cdn-cache-control', 'surrogate-control'] as $name) {
            $policy = strtolower(implode(',', $map[$name] ?? []));
            if (preg_match('/(?:^|,)\s*no-transform\b/', $policy) === 1) {
                return true;
            }
        }

        return false;
    }

    /** @param array<int|string, mixed>|null $headers */
    public function variesByAcceptEncoding(?array $headers = null): bool
    {
        $map = $this->headerMap($headers ?? $this->responseHeaders());
        $tokens = preg_split('/\s*,\s*/', strtolower(implode(',', $map['vary'] ?? [])), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return in_array('accept-encoding', $tokens, true);
    }

    /** @return list<string> */
    public function responseHeaders(): array
    {
        if (!function_exists('headers_list')) {
            return [];
        }

        $headers = headers_list();

        return is_array($headers) ? array_values(array_filter($headers, 'is_string')) : [];
    }

    public function statusCode(): int
    {
        $status = function_exists('http_response_code') ? http_response_code() : 200;

        return is_int($status) && $status > 0 ? $status : 200;
    }

    public function lastReason(): string
    {
        return $this->lastReason;
    }

    /**
     * Retains only representation metadata which is safe to replay.
     *
     * @param array<int|string, mixed>|null $headers
     * @return array<string, string>
     */
    public function cacheableHeaders(?array $headers = null): array
    {
        $allowed = [
            'content-type',
            'content-language',
            'content-disposition',
            'link',
            'strict-transport-security',
            'content-security-policy',
            'content-security-policy-report-only',
            'x-content-type-options',
            'x-frame-options',
            'referrer-policy',
            'permissions-policy',
            'cross-origin-opener-policy',
            'cross-origin-embedder-policy',
            'cross-origin-resource-policy',
            'origin-agent-cluster',
            'reporting-endpoints',
            'report-to',
            'nel',
            'accept-ch',
            'critical-ch',
            'x-robots-tag',
            'x-pingback',
            'access-control-allow-origin',
            'access-control-allow-methods',
            'access-control-allow-headers',
            'access-control-allow-credentials',
            'timing-allow-origin',
        ];
        $result = [];

        foreach ($this->headerMap($headers ?? $this->responseHeaders()) as $name => $values) {
            if (in_array($name, $allowed, true) && $values !== []) {
                $result[$this->canonicalHeaderName($name)] = implode(', ', $values);
            }
        }

        if (!isset($result['Content-Type'])) {
            $result['Content-Type'] = 'text/html; charset=UTF-8';
        }

        return $result;
    }

    /** @param array<string, list<string>> $headers */
    private function isHtml(string $body, array $headers): bool
    {
        if (!$this->contentTypeAllowsHtml($headers)) {
            return false;
        }

        $sample = ltrim(substr($body, 0, 4096), "\xEF\xBB\xBF\x00\x09\x0A\x0D\x20");

        return preg_match('/^(?:<!doctype\s+html|<html\b|<!--.*?--\s*>\s*(?:<!doctype\s+html|<html\b))/is', $sample) === 1
            || stripos($sample, '<body') !== false;
    }

    /** @param array<string, list<string>> $headers */
    private function contentTypeAllowsHtml(array $headers): bool
    {
        if (!isset($headers['content-type'])) {
            return true;
        }

        $hasHtmlType = false;
        foreach ($headers['content-type'] as $value) {
            $mediaType = strtolower(trim((string) strtok($value, ';')));
            if (!in_array($mediaType, ['text/html', 'application/xhtml+xml'], true)) {
                // Multiple conflicting Content-Type fields are ambiguous and
                // must never be collapsed into a shared cached response.
                return false;
            }
            $hasHtmlType = true;
        }

        return $hasHtmlType;
    }

    /** @param array<string, list<string>> $map */
    private function unsafeHeaderReason(array $map, bool $cachedRepresentation): ?string
    {
        if (isset($map['set-cookie']) || isset($map['www-authenticate'])) {
            return 'private_header';
        }
        if (isset($map['location']) || isset($map['refresh'])) {
            return 'redirect_header';
        }
        if (isset($map['clear-site-data'])
            || (!$cachedRepresentation && isset($map['content-encoding']))) {
            return 'unsafe_replay_header';
        }

        $csp = implode(',', array_merge(
            $map['content-security-policy'] ?? [],
            $map['content-security-policy-report-only'] ?? []
        ));
        if ($csp !== '' && preg_match("/'nonce-[^']+'/i", $csp) === 1) {
            return 'csp_nonce';
        }

        foreach (['cache-control', 'cdn-cache-control', 'surrogate-control'] as $name) {
            $policy = strtolower(implode(',', $map[$name] ?? []));
            if (preg_match('/(?:^|,)\s*(?:private|no-store|no-cache)\b/', $policy) === 1) {
                return $name === 'cache-control' ? 'cache_control' : 'shared_cache_control';
            }
            if (!$cachedRepresentation
                && preg_match('/(?:^|,)\s*(?:(?:s-)?max-age\s*=|must-revalidate\b|proxy-revalidate\b)/', $policy) === 1) {
                // Do not silently replace an explicit origin freshness contract.
                return 'origin_freshness_policy';
            }
        }

        if (!$cachedRepresentation && isset($map['expires'])) {
            return 'origin_freshness_policy';
        }
        if (isset($map['pragma']) && stripos(implode(',', $map['pragma']), 'no-cache') !== false) {
            return 'pragma_no_cache';
        }
        if (isset($map['content-disposition']) && stripos(implode(',', $map['content-disposition']), 'attachment') !== false) {
            return 'attachment';
        }

        if (isset($map['vary'])) {
            $varyTokens = preg_split('/\s*,\s*/', strtolower(implode(',', $map['vary'])), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $allowedVary = $cachedRepresentation
                ? ['cookie', 'authorization', 'user-agent', 'sec-ch-ua-mobile', 'accept-encoding']
                : ['accept-encoding'];
            foreach ($varyTokens as $varyToken) {
                if (!in_array($varyToken, $allowedVary, true)) {
                    return $varyToken === '*' ? 'vary_all' : 'vary_not_keyed';
                }
            }
        }

        return null;
    }

    /**
     * @param array<int|string, mixed> $headers
     * @return array<string, list<string>>
     */
    private function headerMap(array $headers): array
    {
        $map = [];
        foreach ($headers as $key => $line) {
            if (is_string($key)) {
                $name = strtolower(trim($key));
                if ($name === '' || preg_match('/^[!#$%&\'*+.^_`|~0-9a-z-]+$/D', $name) !== 1) {
                    continue;
                }

                $values = is_array($line) ? $line : [$line];
                foreach ($values as $value) {
                    if (is_scalar($value) && preg_match('/[\r\n]/', (string) $value) !== 1) {
                        $map[$name][] = trim((string) $value);
                    }
                }
                continue;
            }

            if (!is_string($line) || strpos($line, ':') === false) {
                continue;
            }
            [$name, $value] = explode(':', $line, 2);
            $name = strtolower(trim($name));
            if ($name !== ''
                && preg_match('/^[!#$%&\'*+.^_`|~0-9a-z-]+$/D', $name) === 1
                && preg_match('/[\r\n]/', $value) !== 1) {
                $map[$name][] = trim($value);
            }
        }

        return $map;
    }

    private function canonicalHeaderName(string $name): string
    {
        return implode('-', array_map('ucfirst', explode('-', strtolower($name))));
    }

    private function deny(string $reason): bool
    {
        $this->lastReason = $reason;

        return false;
    }
}
