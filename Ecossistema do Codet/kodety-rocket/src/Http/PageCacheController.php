<?php

declare(strict_types=1);

namespace KodetyRocket\Http;

use KodetyRocket\Cache\CacheEntry;
use KodetyRocket\Cache\CacheInvalidator;
use KodetyRocket\Cache\CacheKey;
use KodetyRocket\Cache\FileCacheStore;
use KodetyRocket\Diagnostics\Logger;
use KodetyRocket\Optimization\Pipeline;
use KodetyRocket\Settings\SettingsRepository;

/** Coordinates post-gate cache hits and late, fail-open response capture. */
final class PageCacheController
{
    private SettingsRepository $settings;
    private FileCacheStore $store;
    private RequestGate $requestGate;
    private ResponseGate $responseGate;
    private Pipeline $pipeline;
    private Logger $logger;
    private ?CacheKey $requestKey = null;
    private bool $cacheEligible = false;
    private bool $transformEligible = false;
    private bool $bufferStarted = false;
    private bool $streamedResponse = false;
    private bool $runtimeCompressionEnabled = false;
    private ?string $cacheGeneration = null;

    public function __construct(
        SettingsRepository $settings,
        FileCacheStore $store,
        RequestGate $requestGate,
        ResponseGate $responseGate,
        Pipeline $pipeline,
        Logger $logger
    ) {
        $this->settings = $settings;
        $this->store = $store;
        $this->requestGate = $requestGate;
        $this->responseGate = $responseGate;
        $this->pipeline = $pipeline;
        $this->logger = $logger;
    }

    public function register(): void
    {
        if (!function_exists('add_action')) {
            return;
        }

        // One final callback keeps Kodety Rocket's output buffer inactive while
        // normal redirect, access-control and response-policy gates run.
        add_action('template_redirect', [$this, 'handleTemplateRedirect'], PHP_INT_MAX);
    }

    public function handleTemplateRedirect(): void
    {
        $this->maybeServe();
        $this->maybeStartBuffer();
    }

    public function maybeServe(): void
    {
        $this->runtimeCompressionEnabled = $this->detectRuntimeCompression();
        $currentHeaders = $this->responseGate->responseHeaders();
        $currentStatus = $this->responseGate->statusCode();
        if ($this->bufferStarted
            || !$this->requestGate->shouldCache()
            || (function_exists('ob_get_level') && ob_get_level() > 0)
            || headers_sent()
            || $this->responseAlreadyEncoded()
            || !$this->responseGate->shouldServeCached($currentStatus, $currentHeaders)) {
            return;
        }

        $key = $this->key();
        if ($key === null) {
            return;
        }

        try {
            $generation = null;
            $readGuard = function () use ($key, &$generation): bool {
                if (!$this->requestGate->shouldCache()) {
                    return false;
                }
                // Capture from the authoritative store only after the cache's
                // shared lock has been acquired.
                $generation = CacheInvalidator::generationSnapshot($key->blogId());

                return true;
            };
            $encoding = $this->preferredEncoding();
            $entry = $this->store->get($key, $encoding, $readGuard);
            if ($entry === null && $encoding !== 'identity') {
                $entry = $this->store->get($key, 'identity', $readGuard);
            }
            if ($entry === null
                || !is_string($generation)
                || !$this->entryGenerationIsCurrent($entry, $key, $generation)) {
                return;
            }

            $encodingAccepted = $this->requestGate->acceptsEncoding($entry->encoding());
            if (!$encodingAccepted
                && !($entry->encoding() === 'identity'
                    && $this->outputCompressionEnabled()
                    && $this->requestGate->acceptsGzip())) {
                return;
            }
            if (!$entry->isSharedCacheable()
                || !$this->responseGate->shouldServeCached($entry->statusCode(), $entry->headers(), true)) {
                return;
            }

            // WordPress or another plugin can change request/response policy
            // while a filesystem read is in progress. Revalidate immediately
            // before replacing the origin response.
            $currentHeaders = $this->responseGate->responseHeaders();
            $currentStatus = $this->responseGate->statusCode();
            if (!$this->requestGate->shouldCache()
                || !$this->generationIsCurrent($key, $generation)
                || !$this->responseGate->shouldServeCached($currentStatus, $currentHeaders)) {
                return;
            }

            $this->serve(
                $entry,
                $this->responseGate->hasNoTransformDirective($currentHeaders),
                $this->responseGate->variesByAcceptEncoding($currentHeaders)
            );
        } catch (\Throwable $exception) {
            $this->logger->warning('Page-cache read failed open.', ['exception' => $exception]);
        }
    }

    public function maybeStartBuffer(): void
    {
        $this->runtimeCompressionEnabled = $this->detectRuntimeCompression();
        if ($this->bufferStarted
            || headers_sent()
            || $this->responseAlreadyEncoded()
            || (defined('KODETY_ROCKET_BYPASS') && (bool) KODETY_ROCKET_BYPASS)) {
            return;
        }

        $existingBufferLength = ob_get_level() > 0 ? ob_get_length() : 0;
        if (is_int($existingBufferLength) && $existingBufferLength > 0) {
            return;
        }

        $this->cacheEligible = $this->requestGate->shouldWriteCache()
            && $this->requestGate->method() === 'GET'
            && $this->key() !== null;
        $this->cacheGeneration = $this->cacheEligible && $this->requestKey !== null
            ? CacheInvalidator::generationSnapshot($this->requestKey->blogId())
            : null;
        $this->transformEligible = $this->requestGate->shouldOptimizeHtml();

        if (!$this->cacheEligible && !$this->transformEligible) {
            return;
        }

        // The output callback itself never invokes ob_*; buffering begins only
        // here at the WordPress lifecycle boundary.
        $maximumBytes = max(262144, min(
            20971520,
            (int) $this->settings->get('max_response_bytes', 5242880)
        ));
        // The callback sees a non-final phase as soon as max+1 bytes are
        // buffered, switches to pass-through streaming and never retains a
        // larger document for transformation or caching.
        $started = ob_start([$this, 'processResponse'], $maximumBytes + 1);
        $this->bufferStarted = $started !== false;
    }

    /**
     * Output-buffer callback. It must always return usable output and must not
     * invoke ob_start(), ob_get_*(), ob_end_*() or ob_clean().
     */
    public function processResponse(string $body, int $phase = 8): string
    {
        $finalFlag = defined('PHP_OUTPUT_HANDLER_FINAL') ? PHP_OUTPUT_HANDLER_FINAL : 8;
        if (($phase & $finalFlag) === 0) {
            // Explicit downstream flushes mean we no longer own a complete
            // document. Preserve streaming and skip cache/transformation.
            $this->streamedResponse = true;

            return $body;
        }
        if ($this->streamedResponse) {
            return $body;
        }

        $headers = $this->responseGate->responseHeaders();
        $status = $this->responseGate->statusCode();
        $output = $body;

        if ($this->transformEligible && $this->responseGate->shouldTransform($body, $status, $headers)) {
            try {
                $output = $this->pipeline->process($body);
            } catch (\Throwable $exception) {
                $this->logger->warning('Response optimization failed open.', ['exception' => $exception]);
                $output = $body;
            }
        }

        if ($output !== $body && !headers_sent() && function_exists('header_remove')) {
            header_remove('Content-Length');
        }

        if ($this->cacheEligible
            && $this->requestGate->shouldWriteCache()
            && $this->requestKey !== null
            && $this->cacheGeneration !== null
            && $this->responseGate->shouldCache($output, $status, $headers)) {
            $this->persist($this->requestKey, $output, $headers, $status);
        }

        return $output;
    }

    private function persist(CacheKey $key, string $body, array $responseHeaders, int $status): void
    {
        try {
            $generation = $this->cacheGeneration;
            if ($generation === null
                || !$this->requestGate->shouldWriteCache()
                || !$this->responseGate->shouldCache($body, $status, $responseHeaders)) {
                return;
            }
            $ttl = (int) $this->settings->get('page_cache_ttl', 3600);
            $browserTtl = (int) $this->settings->get('browser_cache_ttl', 300);
            $headers = $this->responseGate->cacheableHeaders($responseHeaders);
            $headers['Cache-Control'] = 'public, max-age=' . max(0, $browserTtl);
            if ($this->responseGate->hasNoTransformDirective($responseHeaders)) {
                $headers['Cache-Control'] = $this->appendHeaderToken($headers['Cache-Control'], 'no-transform');
            }

            // Prevent browser/CDN caches from reusing an anonymous response
            // after authentication or cookie state changes.
            $mandatoryVary = ['Cookie', 'Authorization'];
            if (function_exists('wp_is_mobile')) {
                $mandatoryVary[] = 'User-Agent';
                $mandatoryVary[] = 'Sec-CH-UA-Mobile';
            }
            if ((bool) $this->settings->get('gzip_enabled', true)
                || $this->responseGate->variesByAcceptEncoding($responseHeaders)) {
                $mandatoryVary[] = 'Accept-Encoding';
            }
            $vary = $mandatoryVary;
            if (function_exists('apply_filters')) {
                $filteredVary = apply_filters('kodety_rocket_cache_vary_headers', $vary);
                if (is_array($filteredVary)) {
                    $vary = $filteredVary;
                }
            }
            $vary = $this->normalizeVaryHeaders($vary, $mandatoryVary);
            $headers['Vary'] = implode(', ', $vary);

            $entry = new CacheEntry(
                $body,
                max(60, $ttl),
                $headers,
                $status,
                null,
                $vary,
                'identity',
                $this->responseTags(),
                [
                    'url' => $key->canonicalUrl(),
                    'cache_generation' => $generation,
                ]
            );

            // This callback runs after FileCacheStore acquires its global
            // shared lock. An invalidation either changes the generation first
            // (making this false) or waits for this write and purges it next.
            $writeGuard = function () use ($key, $generation): bool {
                return $this->requestGate->shouldWriteCache()
                    && $this->generationIsCurrent($key, $generation);
            };
            if (!$this->requestGate->shouldWriteCache()
                || !$this->responseGate->shouldCache(
                    $body,
                    $this->responseGate->statusCode(),
                    $this->responseGate->responseHeaders()
                )
                || !$this->store->put($key, $entry, $writeGuard)) {
                return;
            }

            if (!headers_sent()) {
                header('X-Kodety-Rocket-Cache: MISS');
                $etag = (string) $entry->header('ETag');
                header('ETag: ' . ($this->outputCompressionEnabled() ? 'W/' . $etag : $etag));
                header('Last-Modified: ' . (string) $entry->header('Last-Modified'));
                header('Cache-Control: ' . $headers['Cache-Control']);
                header('Vary: ' . implode(', ', $vary), true);
            }
        } catch (\Throwable $exception) {
            $this->logger->warning('Page-cache write failed open.', ['exception' => $exception]);
        }
    }

    private function generationIsCurrent(CacheKey $key, string $expected): bool
    {
        return hash_equals($expected, CacheInvalidator::generationSnapshot($key->blogId()));
    }

    private function entryGenerationIsCurrent(
        CacheEntry $entry,
        CacheKey $key,
        ?string $expected = null
    ): bool
    {
        $metadata = $entry->metadata();
        $stored = $metadata['cache_generation'] ?? null;

        return is_string($stored)
            && $stored !== ''
            && ($expected === null
                ? $this->generationIsCurrent($key, $stored)
                : hash_equals($expected, $stored));
    }

    private function serve(
        CacheEntry $entry,
        bool $preserveNoTransform = false,
        bool $preserveAcceptEncodingVary = false
    ): void
    {
        $entryHeaders = $entry->headers();
        if ($preserveNoTransform) {
            $entryHeaders['Cache-Control'] = $this->appendHeaderToken(
                $entryHeaders['Cache-Control'] ?? '',
                'no-transform'
            );
        }
        if ($preserveAcceptEncodingVary) {
            $entryHeaders['Vary'] = $this->appendHeaderToken(
                $entryHeaders['Vary'] ?? '',
                'Accept-Encoding'
            );
        }

        $etag = $entry->header('ETag');
        $runtimeCompression = $entry->encoding() === 'identity' && $this->outputCompressionEnabled();
        if ($runtimeCompression && $etag !== null && stripos($etag, 'W/') !== 0) {
            $etag = 'W/' . $etag;
        }
        $lastModified = $entry->header('Last-Modified');
        $notModified = $this->notModified($etag, $lastModified);

        if (function_exists('status_header')) {
            status_header($notModified ? 304 : $entry->statusCode());
        } elseif (function_exists('http_response_code')) {
            http_response_code($notModified ? 304 : $entry->statusCode());
        }

        foreach ($entryHeaders as $name => $value) {
            $lowerName = strtolower($name);
            if ($lowerName === 'etag'
                || ($runtimeCompression && $lowerName === 'content-length')
                || ($notModified && in_array($lowerName, ['content-length', 'content-type', 'content-encoding'], true))) {
                continue;
            }
            header($name . ': ' . $value, true);
        }

        if ($etag !== null) {
            header('ETag: ' . $etag, true);
        }

        header('Age: ' . max(0, time() - $entry->createdAt()));
        header('X-Kodety-Rocket-Cache: HIT');

        if (!$notModified && $this->requestGate->method() !== 'HEAD') {
            echo $entry->body();
        }

        exit;
    }

    private function notModified(?string $etag, ?string $lastModified): bool
    {
        $ifNoneMatch = isset($_SERVER['HTTP_IF_NONE_MATCH']) && is_string($_SERVER['HTTP_IF_NONE_MATCH'])
            ? trim($_SERVER['HTTP_IF_NONE_MATCH'])
            : '';

        if ($ifNoneMatch !== '' && $etag !== null) {
            foreach (explode(',', $ifNoneMatch) as $candidate) {
                $candidate = trim($candidate);
                if ($candidate === '*' || $this->weakEtag($candidate) === $this->weakEtag($etag)) {
                    return true;
                }
            }

            return false;
        }

        $ifModifiedSince = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) && is_string($_SERVER['HTTP_IF_MODIFIED_SINCE'])
            ? strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE'])
            : false;
        $modified = $lastModified !== null ? strtotime($lastModified) : false;

        return $ifModifiedSince !== false && $modified !== false && $modified <= $ifModifiedSince;
    }

    private function weakEtag(string $etag): string
    {
        return preg_replace('/^W\//i', '', trim($etag)) ?? trim($etag);
    }

    private function appendHeaderToken(string $value, string $token): string
    {
        foreach (preg_split('/\s*,\s*/', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $existing) {
            $name = strtolower(trim((string) strstr($existing . ';', ';', true)));
            if ($name === strtolower($token)) {
                return $value;
            }
        }

        return trim($value) === '' ? $token : rtrim($value) . ', ' . $token;
    }

    /**
     * Filters extension output to dimensions that are either gated by the
     * request layer or represented by Kodety Rocket's built-in cache variants.
     *
     * @param array<mixed> $candidates
     * @param list<string> $required
     * @return list<string>
     */
    private function normalizeVaryHeaders(array $candidates, array $required): array
    {
        $allowed = [
            'cookie' => 'Cookie',
            'authorization' => 'Authorization',
            'user-agent' => 'User-Agent',
            'sec-ch-ua-mobile' => 'Sec-CH-UA-Mobile',
            'accept-encoding' => 'Accept-Encoding',
        ];
        $normalized = [];

        foreach (array_merge($required, $candidates) as $candidate) {
            if (!is_scalar($candidate)) {
                continue;
            }
            foreach (explode(',', (string) $candidate) as $token) {
                $key = strtolower(trim($token));
                if (isset($allowed[$key])) {
                    $normalized[$key] = $allowed[$key];
                }
            }
        }

        return array_values($normalized);
    }

    private function preferredEncoding(): string
    {
        return !$this->outputCompressionEnabled() && $this->requestGate->acceptsGzip() ? 'gzip' : 'identity';
    }

    private function outputCompressionEnabled(): bool
    {
        return $this->runtimeCompressionEnabled;
    }

    /** Called only before our output-buffer callback is installed. */
    private function detectRuntimeCompression(): bool
    {
        $zlib = strtolower(trim((string) ini_get('zlib.output_compression')));
        if (!in_array($zlib, ['', '0', 'off', 'false'], true)) {
            return true;
        }

        if (!function_exists('ob_list_handlers')) {
            return false;
        }
        foreach (ob_list_handlers() as $handler) {
            $handler = strtolower((string) $handler);
            if (strpos($handler, 'zlib') !== false
                || strpos($handler, 'gzip') !== false
                || strpos($handler, 'gzhandler') !== false
                || strpos($handler, 'brotli') !== false) {
                return true;
            }
        }

        return false;
    }

    /** An already encoded response is never safe to replace at this layer. */
    private function responseAlreadyEncoded(): bool
    {
        if (!function_exists('headers_list')) {
            return false;
        }
        foreach (headers_list() as $header) {
            if (!is_string($header) || stripos($header, 'Content-Encoding:') !== 0) {
                continue;
            }
            $encoding = strtolower(trim(substr($header, strlen('Content-Encoding:'))));
            if ($encoding !== '' && $encoding !== 'identity') {
                return true;
            }
        }

        return false;
    }

    private function key(): ?CacheKey
    {
        if ($this->requestKey === null) {
            $key = CacheKey::fromRequest(
                null,
                null,
                null,
                $this->requestGate->ignoredQueryParameters(),
                $this->requestGate->allowedQueryParameters()
            );
            if ($key === null) {
                return null;
            }

            $variants = [];
            if (function_exists('wp_is_mobile')) {
                $variants[] = wp_is_mobile() ? 'device:mobile' : 'device:desktop';
            }
            if (function_exists('apply_filters')) {
                $filtered = apply_filters('kodety_rocket_cache_variants', $variants, $key->canonicalUrl());
                if (is_array($filtered)) {
                    $variants = $filtered;
                }
            }
            try {
                foreach ($variants as $variant) {
                    if (is_scalar($variant) && (string) $variant !== '') {
                        $key = $key->variant((string) $variant);
                    }
                }
            } catch (\Throwable $exception) {
                $this->logger->warning('A cache-key variant was rejected.', ['exception' => $exception]);

                return null;
            }

            $this->requestKey = $key;
        }

        return $this->requestKey;
    }

    /** @return list<string> */
    private function responseTags(): array
    {
        $tags = ['site'];
        if (function_exists('is_front_page') && is_front_page()) {
            $tags[] = 'front-page';
        }
        if (function_exists('is_home') && is_home()) {
            $tags[] = 'posts-page';
        }
        if (function_exists('get_queried_object_id')) {
            $objectId = (int) get_queried_object_id();
            if ($objectId > 0) {
                $tags[] = 'object:' . $objectId;
                if (function_exists('is_singular') && is_singular()) {
                    $tags[] = 'post:' . $objectId;
                }
                if ((function_exists('is_category') && is_category())
                    || (function_exists('is_tag') && is_tag())
                    || (function_exists('is_tax') && is_tax())) {
                    $tags[] = 'term:' . $objectId;
                }
            }
        }

        return $tags;
    }
}
